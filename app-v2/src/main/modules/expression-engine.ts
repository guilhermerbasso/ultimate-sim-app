import { join } from 'node:path'
import { evaluateExpression, flattenExpressionScope } from '../../shared/expr-eval'
import {
  EXPR_CHANNELS,
  type ExpressionDef,
  type ExpressionResultEntry,
  type ExpressionResultsBatch,
  type ExpressionScope,
  type ExpressionValue
} from '../../shared/expr'
import {
  resolveExpressionDestinationPlacements,
  validateExpressionDestinationsForCapabilities,
  withExpressionDestinationStatus,
  type ExpressionDestinationCapability,
  type ExpressionPlacementRequest,
  type ExpressionStudioMutation,
  type ExpressionStudioPayload,
  type ExpressionStudioSnapshot
} from '../../shared/expression-studio'
import { buildIracingExpressionScope } from '../../shared/iracing-vars'
import type { OutputRoute } from '../../shared/outputs'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import {
  CONFIG_SECTION_RELOAD_SIGNAL,
  CONFIG_SECTION_RESET_SIGNAL
} from '../../shared/config-io'
import type { ModuleContext } from '../module-context'
import { getDashboardManager } from './dashboards'
import { getOverlayManager } from './overlays-core'
import { ExpressionStudioStore } from './expression-studio-store'

const STORE_FILE = 'expressions.json'
const RESULTS_BROADCAST_INTERVAL_MS = 100
const VISUAL_PRESENTATIONS = ['value', 'bar', 'gauge', 'status'] as const

type OutputSink = (routes: OutputRoute[], activeExpressionIds: string[]) => void

export interface ExpressionEngineApi {
  getResultsSnapshot(): Record<string, ExpressionResultEntry>
  getOutputRoutes(): Promise<OutputRoute[]>
  setOutputSink(sink: OutputSink | null): void
}

export function register(ctx: ModuleContext): ExpressionEngineApi {
  const engine = new ExpressionEngine(ctx)
  engine.initialize()

  ctx.ipcMain.handle(EXPR_CHANNELS.getStudio, () => engine.getStudio())
  ctx.ipcMain.handle(EXPR_CHANNELS.mutateStudio, (_event, mutation: unknown) => engine.mutateStudio(mutation))
  ctx.ipcMain.handle(EXPR_CHANNELS.getPlacements, (_event, request: unknown) => engine.getPlacements(request))
  ctx.ipcMain.handle(EXPR_CHANNELS.getExpressions, () => engine.getExpressions())
  ctx.ipcMain.handle(EXPR_CHANNELS.getEnabledVars, () => engine.getEnabledVars())
  ctx.ipcMain.handle(EXPR_CHANNELS.evaluate, (_event, expr: unknown, snapshot?: TelemetrySnapshot) =>
    engine.evaluate(expr, snapshot)
  )
  ctx.ipcMain.handle(EXPR_CHANNELS.getResults, () => engine.getResultsSnapshot())

  // v3 has one revision-checked mutation. Keep the old channels registered so
  // stale renderers fail clearly instead of silently splitting expression and
  // destination writes across two stores.
  const legacyMutationError = (): never => {
    throw new Error(`Expression Studio v3 requires ${EXPR_CHANNELS.mutateStudio}. Refresh this view and retry.`)
  }
  ctx.ipcMain.handle(EXPR_CHANNELS.setExpressions, legacyMutationError)
  ctx.ipcMain.handle(EXPR_CHANNELS.setEnabledVars, legacyMutationError)

  return {
    getResultsSnapshot: () => engine.getResultsSnapshot(),
    getOutputRoutes: () => engine.getOutputRoutes(),
    setOutputSink: (sink) => engine.setOutputSink(sink)
  }
}

class ExpressionEngine {
  private readonly studio: ExpressionStudioStore
  private loaded = false
  private loadPromise: Promise<void> | null = null
  private outputSink: OutputSink | null = null
  private readonly results = new Map<string, ExpressionResultEntry>()
  private readonly pendingResults = new Map<string, ExpressionResultEntry>()
  private broadcastTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly ctx: ModuleContext) {
    this.studio = new ExpressionStudioStore(join(ctx.app.getPath('userData'), STORE_FILE))
  }

  initialize(): void {
    this.loadPromise = this.studio
      .load()
      .then((payload) => {
        this.loaded = true
        this.pushOutputs(payload)
      })
      .catch((error) => {
        console.warn('[expr] Failed to load Expression Studio store:', error)
        throw error
      })

    this.ctx.telemetryHub.on('snapshot', (snapshot: TelemetrySnapshot | null) => {
      this.onSnapshot(snapshot)
    })
    this.startBroadcastTimer()

    const onSectionReload = (_event: unknown, sectionId: string): void => {
      if (sectionId !== 'expressions') return
      const previousExpressions = this.studio.snapshot().expressions
      void this.studio
        .reloadImported()
        .then((payload) => this.afterStudioCommit(payload, previousExpressions))
        .catch((error) => console.warn('[expr] Failed to apply imported Expression Studio store:', error))
    }
    const onSectionReset = (_event: unknown, sectionId: string): void => {
      if (sectionId !== 'expressions') return
      const previousExpressions = this.studio.snapshot().expressions
      const payload = this.studio.dropInMemoryForReset()
      this.afterStudioCommit(payload, previousExpressions)
    }
    this.ctx.ipcMain.on(CONFIG_SECTION_RELOAD_SIGNAL, onSectionReload)
    this.ctx.ipcMain.on(CONFIG_SECTION_RESET_SIGNAL, onSectionReset)

    this.ctx.app.once('before-quit', () => {
      if (this.broadcastTimer) {
        clearInterval(this.broadcastTimer)
        this.broadcastTimer = null
      }
      this.ctx.ipcMain.off(CONFIG_SECTION_RELOAD_SIGNAL, onSectionReload)
      this.ctx.ipcMain.off(CONFIG_SECTION_RESET_SIGNAL, onSectionReset)
    })
  }

  async getStudio(): Promise<ExpressionStudioSnapshot> {
    await this.ensureLoaded()
    return withExpressionDestinationStatus(this.studio.peek(), this.capabilities())
  }

  async mutateStudio(input: unknown): Promise<ExpressionStudioSnapshot> {
    await this.ensureLoaded()
    const capabilities = this.capabilities()
    const previousExpressions = this.studio.snapshot().expressions
    const payload = await this.studio.mutate(
      input as ExpressionStudioMutation,
      (next) => validateExpressionDestinationsForCapabilities(next, capabilities)
    )
    this.afterStudioCommit(payload, previousExpressions)
    return withExpressionDestinationStatus(payload, this.capabilities())
  }

  async getPlacements(input: unknown) {
    await this.ensureLoaded()
    const request = normalizePlacementRequest(input)
    return resolveExpressionDestinationPlacements(this.studio.peek(), this.capabilities(), request)
  }

  async getExpressions() {
    await this.ensureLoaded()
    return this.studio.snapshot().expressions
  }

  async getEnabledVars() {
    await this.ensureLoaded()
    return this.studio.snapshot().enabledVars
  }

  async getOutputRoutes(): Promise<OutputRoute[]> {
    await this.ensureLoaded()
    return this.studio.snapshot().outputs
  }

  setOutputSink(sink: OutputSink | null): void {
    this.outputSink = sink
    if (sink && this.loaded) this.pushOutputs(this.studio.peek())
  }

  async evaluate(input: unknown, snapshot?: TelemetrySnapshot): Promise<ExpressionValue> {
    await this.ensureLoaded()
    if (typeof input !== 'string' || !input.trim()) throw new Error('Empty expression.')
    const latest = snapshot ?? this.ctx.telemetryHub.getLatest()
    return evaluateExpression(input, this.buildScope(latest))
  }

  getResultsSnapshot(): Record<string, ExpressionResultEntry> {
    return Object.fromEntries(this.results)
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    if (this.loadPromise) await this.loadPromise
  }

  private afterStudioCommit(
    payload: ExpressionStudioPayload,
    previousExpressions: readonly ExpressionDef[] = []
  ): void {
    this.loaded = true
    this.pushOutputs(payload)
    this.pruneStaleResults(
      new Set(payload.expressions.map((expression) => expression.id)),
      previousExpressions
    )
    const snapshot = withExpressionDestinationStatus(payload, this.capabilities())
    this.ctx.broadcast(EXPR_CHANNELS.studioChanged, snapshot)
  }

  private onSnapshot(snapshot: TelemetrySnapshot | null): void {
    if (!this.loaded) return
    const payload = this.studio.peek()
    if (payload.expressions.length === 0) return
    const scope = this.buildScope(snapshot)
    for (const definition of payload.expressions) {
      const formula = definition.expr.trim()
      if (!formula) continue
      let value: ExpressionValue
      try {
        value = evaluateExpression(formula, scope)
      } catch {
        continue
      }
      const entry: ExpressionResultEntry = { name: definition.name, value }
      const previous = this.results.get(definition.id)
      this.results.set(definition.id, entry)
      if (!previous || previous.value !== value || previous.name !== entry.name || previous.deleted) {
        this.pendingResults.set(definition.id, entry)
      }
    }
  }

  private buildScope(snapshot: TelemetrySnapshot | null): ExpressionScope {
    return {
      ...flattenExpressionScope(snapshot),
      ...buildIracingExpressionScope(snapshot, this.studio.peek().enabledVars)
    }
  }

  private startBroadcastTimer(): void {
    if (this.broadcastTimer) return
    this.broadcastTimer = setInterval(() => this.flushPending(), RESULTS_BROADCAST_INTERVAL_MS)
  }

  private flushPending(): void {
    if (this.pendingResults.size === 0) return
    const results = Object.fromEntries(this.pendingResults) as Record<string, ExpressionResultEntry>
    this.pendingResults.clear()
    const batch: ExpressionResultsBatch = { results, timestamp: Date.now() }
    this.ctx.broadcast(EXPR_CHANNELS.results, batch)
  }

  private pruneStaleResults(
    activeIds: ReadonlySet<string>,
    previousExpressions: readonly ExpressionDef[]
  ): void {
    for (const [id, previous] of [...this.results.entries()]) {
      if (activeIds.has(id)) continue
      this.results.delete(id)
      this.pendingResults.set(id, { name: previous.name, value: null, deleted: true })
    }
    for (const [id, pending] of [...this.pendingResults.entries()]) {
      if (!activeIds.has(id) && !pending.deleted) {
        this.pendingResults.set(id, { name: pending.name, value: null, deleted: true })
      }
    }
    for (const definition of previousExpressions) {
      if (!activeIds.has(definition.id)) {
        this.pendingResults.set(definition.id, {
          name: definition.name,
          value: null,
          deleted: true
        })
      }
    }
  }

  private capabilities(): ExpressionDestinationCapability[] {
    const dashboardManager = getDashboardManager()
    const overlayManager = getOverlayManager()
    const dashboards = dashboardManager?.list().map((summary) => ({
      id: summary.id,
      label: summary.name,
      width: summary.width,
      height: summary.height,
      kind: 'dashboard' as const
    })) ?? []
    const overlays = overlayManager?.listCustom().map((overlay) => ({
      id: overlay.id,
      label: overlay.title,
      width: overlay.canvasWidth ?? overlay.position.width,
      height: overlay.canvasHeight ?? overlay.position.height,
      kind: 'custom-overlay' as const
    })) ?? []

    return [
      {
        surface: 'dashboard',
        available: Boolean(dashboardManager),
        reason: dashboardManager ? undefined : 'Dashboard manager is unavailable.',
        presentations: [...VISUAL_PRESENTATIONS],
        targets: dashboards
      },
      {
        surface: 'overlay',
        available: Boolean(overlayManager),
        reason: overlayManager ? undefined : 'Overlay manager is unavailable.',
        presentations: [...VISUAL_PRESENTATIONS],
        targets: overlays
      },
      {
        surface: 'oled',
        available: false,
        reason: 'OLED expression slots are deferred until device-specific character and line limits are complete.',
        presentations: [],
        targets: []
      },
      {
        surface: 'touch',
        available: false,
        reason: 'Touch binding is deferred until existing controls advertise value/active/warning/disabled state capability.',
        presentations: [],
        targets: []
      }
    ]
  }

  private pushOutputs(payload: Readonly<ExpressionStudioPayload>): void {
    this.outputSink?.(
      payload.outputs,
      payload.expressions.map((expression) => expression.id)
    )
  }
}

function normalizePlacementRequest(input: unknown): ExpressionPlacementRequest {
  if (!input || typeof input !== 'object') throw new Error('Invalid expression placement request.')
  const request = input as Partial<ExpressionPlacementRequest>
  if (request.surface !== 'dashboard' && request.surface !== 'overlay') {
    throw new Error('Expression placements are available only for dashboard and overlay.')
  }
  if (typeof request.targetId !== 'string' || !request.targetId.trim()) {
    throw new Error('Expression placement request requires an exact targetId.')
  }
  return { surface: request.surface, targetId: request.targetId.trim() }
}
