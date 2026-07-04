import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { evaluateExpression, flattenExpressionScope } from '../../shared/expr-eval'
import { buildIracingExpressionScope } from '../../shared/iracing-vars'
import {
  EXPR_CHANNELS,
  type EnabledIracingVars,
  type ExpressionDef,
  type ExpressionResultEntry,
  type ExpressionResultsBatch,
  type ExpressionScope,
  type ExpressionValue
} from '../../shared/expr'
import { isOutputTarget, type OutputTarget } from '../../shared/outputs'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import type { ModuleContext } from '../module-context'

const STORE_FILE = 'expressions.json'

// Persisted schema version. Bumped from 1 → 2 alongside the optional
// `targets` / `outputName` fields on ExpressionDef. The loader still accepts
// v1 payloads transparently (the new fields are optional).
const STORE_SCHEMA_VERSION = 2

// Renderer broadcast cadence for batched results — mirrors output-router's
// `outputs:value` (~10Hz) so consumers can subscribe to either without
// scheduling mismatches.
const RESULTS_BROADCAST_INTERVAL_MS = 100

interface ExpressionStorePayload {
  version: number
  expressions: ExpressionDef[]
  enabledVars: EnabledIracingVars
  updatedAt: string
}

export interface ExpressionEngineApi {
  getResultsSnapshot(): ReturnType<ExpressionStore['getResultsSnapshot']>
}

export function register(ctx: ModuleContext): ExpressionEngineApi {
  const store = new ExpressionStore(ctx)
  store.initialize()

  ctx.ipcMain.handle(EXPR_CHANNELS.getExpressions, () => store.getExpressions())
  ctx.ipcMain.handle(EXPR_CHANNELS.setExpressions, (_event, expressions: unknown) => store.setExpressions(expressions))
  ctx.ipcMain.handle(EXPR_CHANNELS.getEnabledVars, () => store.getEnabledVars())
  ctx.ipcMain.handle(EXPR_CHANNELS.setEnabledVars, (_event, enabledVars: unknown) => store.setEnabledVars(enabledVars))
  ctx.ipcMain.handle(EXPR_CHANNELS.evaluate, (_event, expr: unknown, snapshot?: TelemetrySnapshot) =>
    store.evaluate(expr, snapshot)
  )
  ctx.ipcMain.handle(EXPR_CHANNELS.getResults, () => store.getResultsSnapshot())

  // Bridge for the output-router's expression-source routes: the orchestrator
  // wires `router.setExpressionResolver(...)` to read live values from here via
  // `getResultsSnapshot()` (both modules share the main process).
  return { getResultsSnapshot: () => store.getResultsSnapshot() }
}

class ExpressionStore {
  private loaded = false
  private loadPromise: Promise<void> | null = null
  private expressions: ExpressionDef[] = []
  private enabledVars: EnabledIracingVars = []

  // routeId → latest evaluated entry. Keyed by ExpressionDef.id.
  private results = new Map<string, ExpressionResultEntry>()
  // Pending results awaiting the next broadcast tick (changes only).
  private pendingResults = new Map<string, ExpressionResultEntry>()
  private broadcastTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly ctx: ModuleContext) {}

  initialize(): void {
    this.loadPromise = this.ensureLoaded().catch((error) => {
      console.warn('[expr] Failed to load expression store, starting empty:', error)
      this.expressions = []
      this.enabledVars = []
      this.loaded = true
    })

    this.ctx.telemetryHub.on('snapshot', (snapshot: TelemetrySnapshot | null) => {
      this.onSnapshot(snapshot)
    })

    this.startBroadcastTimer()

    this.ctx.app.once('before-quit', () => {
      if (this.broadcastTimer) {
        clearInterval(this.broadcastTimer)
        this.broadcastTimer = null
      }
    })
  }

  async getExpressions(): Promise<ExpressionDef[]> {
    await this.ensureLoaded()
    return this.expressions
  }

  async setExpressions(input: unknown): Promise<ExpressionDef[]> {
    await this.ensureLoaded()
    this.expressions = normalizeExpressions(input)
    await this.save()
    this.pruneStaleResults(new Set(this.expressions.map((expr) => expr.id)))
    return this.expressions
  }

  async getEnabledVars(): Promise<EnabledIracingVars> {
    await this.ensureLoaded()
    return this.enabledVars
  }

  async setEnabledVars(input: unknown): Promise<EnabledIracingVars> {
    await this.ensureLoaded()
    this.enabledVars = normalizeEnabledVars(input)
    await this.save()
    return this.enabledVars
  }

  async evaluate(input: unknown, snapshot?: TelemetrySnapshot): Promise<ExpressionValue> {
    await this.ensureLoaded()
    if (typeof input !== 'string' || !input.trim()) throw new Error('Expressão vazia.')
    const latest = snapshot ?? ctxLatest(this.ctx)
    const scope = this.buildScope(latest)
    return evaluateExpression(input, scope)
  }

  getResultsSnapshot(): Record<string, ExpressionResultEntry> {
    return Object.fromEntries(this.results)
  }

  // ─── Snapshot handling ─────────────────────────────────────────────────────

  private onSnapshot(snapshot: TelemetrySnapshot | null): void {
    if (!this.loaded) return
    if (this.expressions.length === 0) return
    const scope = this.buildScope(snapshot)
    for (const definition of this.expressions) {
      const formula = definition.expr.trim()
      if (!formula) continue
      let value: ExpressionValue
      try {
        value = evaluateExpression(formula, scope)
      } catch {
        // Per-tick eval failures are common (missing telemetry, type
        // mismatches) — keep the engine alive and just skip this tick.
        continue
      }
      const entry: ExpressionResultEntry = { name: definition.name, value }
      const previous = this.results.get(definition.id)
      this.results.set(definition.id, entry)
      if (!previous || previous.value !== value || previous.name !== entry.name) {
        this.pendingResults.set(definition.id, entry)
      }
    }
  }

  private buildScope(snapshot: TelemetrySnapshot | null): ExpressionScope {
    return {
      ...flattenExpressionScope(snapshot),
      ...buildIracingExpressionScope(snapshot, this.enabledVars)
    }
  }

  // ─── Batched renderer broadcast (~10Hz) ────────────────────────────────────

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

  private pruneStaleResults(activeIds: Set<string>): void {
    for (const id of [...this.results.keys()]) {
      if (!activeIds.has(id)) this.results.delete(id)
    }
    for (const id of [...this.pendingResults.keys()]) {
      if (!activeIds.has(id)) this.pendingResults.delete(id)
    }
  }

  // ─── Persistence ───────────────────────────────────────────────────────────

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    if (this.loadPromise) {
      await this.loadPromise
      return
    }
    try {
      const raw = JSON.parse(await readFile(this.storePath, 'utf8')) as Partial<ExpressionStorePayload>
      this.expressions = normalizeExpressions(Array.isArray(raw.expressions) ? raw.expressions : [])
      this.enabledVars = normalizeEnabledVars(Array.isArray(raw.enabledVars) ? raw.enabledVars : [])
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') console.warn('[expr] Failed to load expression store, using empty list.', error)
      this.expressions = []
      this.enabledVars = []
      if (code === 'ENOENT') await this.save()
    }
    this.loaded = true
  }

  private async save(): Promise<void> {
    const payload: ExpressionStorePayload = {
      version: STORE_SCHEMA_VERSION,
      expressions: this.expressions,
      enabledVars: this.enabledVars,
      updatedAt: new Date().toISOString()
    }
    await mkdir(dirname(this.storePath), { recursive: true })
    await writeFile(this.storePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  }

  private get storePath(): string {
    return join(this.ctx.app.getPath('userData'), STORE_FILE)
  }
}

function ctxLatest(ctx: ModuleContext): TelemetrySnapshot | null {
  return ctx.telemetryHub.getLatest()
}

function normalizeExpressions(input: unknown): ExpressionDef[] {
  if (!Array.isArray(input)) throw new Error('Lista de expressões inválida.')
  const seenIds = new Set<string>()
  return input.map((item, index) => {
    if (!isObject(item)) throw new Error(`Expressão #${index + 1} inválida: payload não é objeto.`)
    const id = normalizeString(item.id, `Expressão #${index + 1}: id ausente.`)
    if (seenIds.has(id)) throw new Error(`Expressão #${index + 1}: id duplicado "${id}".`)
    seenIds.add(id)
    const name = normalizeString(item.name, `Expressão #${index + 1}: nome ausente.`)
    const expr = normalizeString(item.expr, `Expressão #${index + 1}: fórmula ausente.`)
    const definition: ExpressionDef = { id, name, expr }
    const targets = normalizeOptionalTargets(item.targets, index)
    if (targets) definition.targets = targets
    const outputName = normalizeOptionalString(item.outputName)
    if (outputName) definition.outputName = outputName
    return definition
  })
}

function normalizeOptionalTargets(value: unknown, index: number): OutputTarget[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) {
    throw new Error(`Expressão #${index + 1}: lista de targets inválida.`)
  }
  if (value.length === 0) return undefined
  const targets: OutputTarget[] = []
  value.forEach((target, targetIndex) => {
    if (!isOutputTarget(target)) {
      throw new Error(`Expressão #${index + 1}: target #${targetIndex + 1} inválido.`)
    }
    targets.push(target)
  })
  return targets
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function normalizeEnabledVars(input: unknown): EnabledIracingVars {
  if (!Array.isArray(input)) throw new Error('Lista de variáveis inválida.')
  return [...new Set(input.map((item) => normalizeString(item, 'Variável inválida.')))]
}

function normalizeString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message)
  return value.trim()
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
