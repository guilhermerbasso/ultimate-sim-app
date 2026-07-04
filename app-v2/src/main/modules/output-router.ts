import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { ExpressionValue } from '../../shared/expr'
import {
  OUTPUTS_CHANNELS,
  type OutputRoute,
  type OutputRoutesPayload,
  type OutputSecondScreenUpdate,
  type OutputSource,
  type OutputTarget,
  type OutputValueBatch,
  type OutputValueUpdate,
  formatOutputValue,
  interpolateTemplate,
  isOutputFormat,
  isOutputSource,
  isOutputTarget,
  readDottedPath
} from '../../shared/outputs'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import type { ModuleContext } from '../module-context'

// Persisted store filename inside `userData/`.
const STORE_FILE = 'output-routes.json'

// Throttle floors. Serial bus saturates fast — cap at 20Hz per route. Renderer
// broadcasts coalesce around 10Hz so we never flood the IPC bridge.
const MIN_SERIAL_INTERVAL_MS = 50 // ≤20Hz per route
const VALUE_BROADCAST_INTERVAL_MS = 100 // ~10Hz batched renderer broadcasts

// Optional injection point: the expression engine module can hand the router a
// resolver later. Until that wiring exists, expression-typed routes no-op (the
// router computes nothing rather than throwing). This keeps the routing
// backbone independent of `expression-engine.ts`.
export interface ExpressionResolver {
  (exprId: string, snapshot: TelemetrySnapshot | null): ExpressionValue | undefined
}

export interface OutputRouterApi {
  setExpressionResolver(resolver: ExpressionResolver | null): void
  // Read-only snapshot of the last computed value per route id.
  getValuesSnapshot(): Record<string, OutputValueUpdate>
  getRoutes(): OutputRoute[]
}

// Module-level handle so future agents (expression engine, alerts, etc.) can
// reach in via `ctx.outputRouter` once we add it to ModuleContext. For now we
// expose it through a small `register()` return value used only internally
// (the registrars array discards it, which is intentional — the surface stays
// minimal until consumers actually need it).
export function register(ctx: ModuleContext): OutputRouterApi {
  const router = new OutputRouter(ctx)
  router.initialize()
  return router.api()
}

class OutputRouter {
  private routes: OutputRoute[] = []
  private loaded = false
  private loadPromise: Promise<void> | null = null

  // routeId → last computed update (also exposed via `outputs:getValues`).
  private values = new Map<string, OutputValueUpdate>()
  // routeId → last serial send timestamp (ms). Used for ≤20Hz throttling.
  private lastSerialAt = new Map<string, number>()
  // routeId → last *serial rendered string* per route (dedup identical sends).
  private lastSerialPayload = new Map<string, string>()
  // routeId → whether its dashboard action source was truthy on the previous tick.
  private lastDashboardActive = new Map<string, boolean>()
  // Updates collected between renderer broadcast ticks.
  private pendingUpdates = new Map<string, OutputValueUpdate>()
  private broadcastTimer: ReturnType<typeof setInterval> | null = null

  private resolver: ExpressionResolver | null = null

  constructor(private readonly ctx: ModuleContext) {}

  initialize(): void {
    this.loadPromise = this.loadRoutes().catch((error) => {
      console.warn('[output-router] Failed to load routes, starting empty:', error)
      this.routes = []
      this.loaded = true
    })

    this.ctx.telemetryHub.on('snapshot', (snapshot: TelemetrySnapshot | null) => {
      this.onSnapshot(snapshot)
    })

    this.startBroadcastTimer()
    this.registerIpc()

    this.ctx.app.once('before-quit', () => {
      if (this.broadcastTimer) {
        clearInterval(this.broadcastTimer)
        this.broadcastTimer = null
      }
    })
  }

  api(): OutputRouterApi {
    return {
      setExpressionResolver: (resolver) => {
        this.resolver = resolver ?? null
      },
      getValuesSnapshot: () => Object.fromEntries(this.values),
      getRoutes: () => this.routes.slice()
    }
  }

  // ─── IPC ─────────────────────────────────────────────────────────────────

  private registerIpc(): void {
    this.ctx.ipcMain.handle(OUTPUTS_CHANNELS.getRoutes, async () => {
      await this.ensureLoaded()
      return this.routes
    })
    this.ctx.ipcMain.handle(OUTPUTS_CHANNELS.setRoutes, async (_event, input: unknown) => {
      await this.ensureLoaded()
      const next = normalizeRoutes(input)
      this.routes = next
      this.pruneStaleState(new Set(next.map((route) => route.id)))
      // A route's serial target (deviceId/template) can change while keeping its
      // id — drop ALL serial dedup/throttle state so retargeted routes re-send to
      // the new device/template on the next tick instead of being skipped.
      this.lastSerialAt.clear()
      this.lastSerialPayload.clear()
      await this.saveRoutes()
      this.ctx.broadcast(OUTPUTS_CHANNELS.routesChanged, { routes: next })
      return next
    })
    this.ctx.ipcMain.handle(OUTPUTS_CHANNELS.getValues, async () => {
      await this.ensureLoaded()
      return Object.fromEntries(this.values) as Record<string, OutputValueUpdate>
    })
  }

  // ─── Snapshot handling ───────────────────────────────────────────────────

  private onSnapshot(snapshot: TelemetrySnapshot | null): void {
    if (!this.loaded) return
    if (this.routes.length === 0) return

    for (const route of this.routes) {
      if (!route.enabled) continue
      const raw = this.evaluateSource(route.source, snapshot)
      if (raw === undefined) {
        // Source not resolvable (yet) — skip; we don't broadcast "" by mistake.
        continue
      }
      const formatted = formatOutputValue(raw, route.format)
      const fieldHint = sourceFieldName(route.source)

      const update: OutputValueUpdate = {
        routeId: route.id,
        name: targetDisplayName(route.target),
        value: formatted,
        raw
      }

      const previous = this.values.get(route.id)
      const changed = !previous || previous.value !== update.value || previous.name !== update.name

      this.values.set(route.id, update)
      this.dispatchToTarget(route, update, fieldHint)

      if (changed) {
        this.pendingUpdates.set(route.id, update)
      }
    }
  }

  private evaluateSource(source: OutputSource, snapshot: TelemetrySnapshot | null): ExpressionValue | undefined {
    switch (source.kind) {
      case 'telemetry':
        if (!snapshot) return undefined
        return readDottedPath(snapshot, source.field)
      case 'expression':
        if (!this.resolver) return undefined
        return this.resolver(source.exprId, snapshot)
      case 'literal':
        return source.value
      default:
        return undefined
    }
  }

  // ─── Target dispatch ─────────────────────────────────────────────────────

  private dispatchToTarget(route: OutputRoute, update: OutputValueUpdate, fieldHint: string | undefined): void {
    const target = route.target
    switch (target.kind) {
      case 'dashboardVar':
      case 'overlay':
        // Dashboards/overlays subscribe to the batched `outputs:value` channel.
        // Nothing to push immediately — the batch timer handles it.
        return
      case 'serial':
        this.dispatchSerial(route, target, update, fieldHint)
        return
      case 'secondScreen':
        this.dispatchSecondScreen(route, target, update)
        return
      case 'dashboard':
        this.dispatchDashboard(route, target, update)
        return
      default:
        return
    }
  }

  private dispatchSerial(
    route: OutputRoute,
    target: Extract<OutputTarget, { kind: 'serial' }>,
    update: OutputValueUpdate,
    fieldHint: string | undefined
  ): void {
    const now = Date.now()
    const last = this.lastSerialAt.get(route.id) ?? 0
    if (now - last < MIN_SERIAL_INTERVAL_MS) return

    const rendered = interpolateTemplate(target.template, {
      value: update.value,
      field: fieldHint
    })
    if (!rendered) return

    // Route to the targeted device (custom serial devices) via the multi-device
    // hub, or the primary SIM-X box when no deviceId is set.
    const device = target.deviceId
      ? this.ctx.serialHub.getDevice(target.deviceId)
      : this.ctx.serialHub.getPrimary()
    if (!device || !device.isOpen()) {
      // Device absent/closed — drop the dedup cache so the value re-sends once it
      // reconnects (the board resets on port open and loses its output state).
      this.lastSerialPayload.delete(route.id)
      return
    }

    const previousPayload = this.lastSerialPayload.get(route.id)
    if (previousPayload === rendered) return

    this.lastSerialAt.set(route.id, now)
    this.lastSerialPayload.set(route.id, rendered)
    void device.sendRaw(rendered).catch((error: unknown) => {
      // Transient failures (e.g. a write error) should re-send next tick, so we
      // drop the dedup entry. But a PERMANENT error (command longer than the
      // firmware's serial buffer) must NOT be retried at ~20Hz forever — keep it
      // deduped so it logs at most once per distinct rendered value.
      const message = error instanceof Error ? error.message : String(error)
      if (!/excede o buffer|m[áa]x/i.test(message)) {
        this.lastSerialPayload.delete(route.id)
      }
      console.warn(`[output-router] Serial send failed for route ${route.id}:`, error)
    })
  }

  private dispatchSecondScreen(
    route: OutputRoute,
    target: Extract<OutputTarget, { kind: 'secondScreen' }>,
    update: OutputValueUpdate
  ): void {
    const payload: OutputSecondScreenUpdate = {
      routeId: route.id,
      slot: target.slot,
      value: update.value,
      raw: update.raw,
      timestamp: Date.now()
    }
    this.ctx.broadcast(OUTPUTS_CHANNELS.secondScreen, payload)
  }

  private dispatchDashboard(
    route: OutputRoute,
    target: Extract<OutputTarget, { kind: 'dashboard' }>,
    update: OutputValueUpdate
  ): void {
    const active = isTruthy(update.raw)
    const wasActive = this.lastDashboardActive.get(route.id) ?? false
    this.lastDashboardActive.set(route.id, active)
    if (!active || wasActive) return
    this.ctx.broadcast('app:dash:activateRequest', {
      routeId: route.id,
      dashboardId: target.dashboardId,
      dashboardName: target.dashboardName
    })
  }

  // ─── Batched renderer broadcast (~10Hz) ─────────────────────────────────

  private startBroadcastTimer(): void {
    if (this.broadcastTimer) return
    this.broadcastTimer = setInterval(() => this.flushPending(), VALUE_BROADCAST_INTERVAL_MS)
  }

  private flushPending(): void {
    if (this.pendingUpdates.size === 0) return
    const updates = Array.from(this.pendingUpdates.values())
    this.pendingUpdates.clear()
    const batch: OutputValueBatch = { updates, timestamp: Date.now() }
    this.ctx.broadcast(OUTPUTS_CHANNELS.value, batch)
  }

  // ─── Persistence ─────────────────────────────────────────────────────────

  private get storePath(): string {
    return join(this.ctx.app.getPath('userData'), STORE_FILE)
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    if (this.loadPromise) await this.loadPromise
  }

  private async loadRoutes(): Promise<void> {
    try {
      const raw = await readFile(this.storePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<OutputRoutesPayload>
      const routes = Array.isArray(parsed.routes) ? normalizeRoutes(parsed.routes) : []
      this.routes = routes
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        console.warn('[output-router] Failed to read routes file, starting empty:', error)
      }
      this.routes = []
      if (code === 'ENOENT') await this.saveRoutes()
    } finally {
      this.loaded = true
    }
  }

  private async saveRoutes(): Promise<void> {
    const payload: OutputRoutesPayload = {
      version: 1,
      routes: this.routes,
      updatedAt: new Date().toISOString()
    }
    await mkdir(dirname(this.storePath), { recursive: true })
    await writeFile(this.storePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  }

  private pruneStaleState(activeIds: Set<string>): void {
    for (const id of [...this.values.keys()]) {
      if (!activeIds.has(id)) this.values.delete(id)
    }
    for (const id of [...this.lastSerialAt.keys()]) {
      if (!activeIds.has(id)) this.lastSerialAt.delete(id)
    }
    for (const id of [...this.lastSerialPayload.keys()]) {
      if (!activeIds.has(id)) this.lastSerialPayload.delete(id)
    }
    for (const id of [...this.lastDashboardActive.keys()]) {
      if (!activeIds.has(id)) this.lastDashboardActive.delete(id)
    }
    for (const id of [...this.pendingUpdates.keys()]) {
      if (!activeIds.has(id)) this.pendingUpdates.delete(id)
    }
  }
}

// ─── Normalization helpers ────────────────────────────────────────────────

function normalizeRoutes(input: unknown): OutputRoute[] {
  if (!Array.isArray(input)) {
    throw new Error('Lista de rotas de saída inválida.')
  }
  const seenIds = new Set<string>()
  return input.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Rota #${index + 1} inválida: payload não é objeto.`)
    }
    const candidate = item as Partial<OutputRoute>
    const id = ensureString(candidate.id, `Rota #${index + 1}: id ausente.`)
    if (seenIds.has(id)) throw new Error(`Rota #${index + 1}: id duplicado "${id}".`)
    seenIds.add(id)

    const name = typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim() : id
    if (!isOutputSource(candidate.source)) {
      throw new Error(`Rota #${index + 1} (${id}): source inválido.`)
    }
    if (!isOutputTarget(candidate.target)) {
      throw new Error(`Rota #${index + 1} (${id}): target inválido.`)
    }
    if (candidate.format !== undefined && !isOutputFormat(candidate.format)) {
      throw new Error(`Rota #${index + 1} (${id}): formato inválido.`)
    }
    const enabled = candidate.enabled === undefined ? true : Boolean(candidate.enabled)
    const updatedAt =
      typeof candidate.updatedAt === 'string' && candidate.updatedAt
        ? candidate.updatedAt
        : new Date().toISOString()

    return {
      id,
      name,
      enabled,
      source: candidate.source,
      target: candidate.target,
      format: candidate.format,
      updatedAt
    }
  })
}

function ensureString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message)
  return value.trim()
}

function sourceFieldName(source: OutputSource): string | undefined {
  switch (source.kind) {
    case 'telemetry':
      return source.field
    case 'expression':
      return source.exprId
    case 'literal':
      return undefined
    default:
      return undefined
  }
}

function targetDisplayName(target: OutputTarget): string {
  switch (target.kind) {
    case 'dashboardVar':
    case 'overlay':
      return target.name
    case 'serial':
      return target.deviceId ? `serial:${target.deviceId}` : 'serial'
    case 'secondScreen':
      return `secondScreen:${target.slot}`
    case 'dashboard':
      return `dashboard:${target.dashboardName}`
    default:
      return ''
  }
}

function isTruthy(value: ExpressionValue | undefined): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  return value.trim().length > 0
}
