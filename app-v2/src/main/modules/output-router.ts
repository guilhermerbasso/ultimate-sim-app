import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
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
  setExpressionRoutes(routes: OutputRoute[], activeExpressionIds?: readonly string[]): void
  getLegacyExpressionRoutes(): Promise<OutputRoute[]>
  removeLegacyExpressionRoutes(routeIds: readonly string[]): Promise<void>
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
  // Routes persisted by the general Output Routing screen.
  private routes: OutputRoute[] = []
  // Expression-owned v3 outputs live atomically in expressions.json and are
  // injected here at runtime. They never get copied back to output-routes.json.
  private expressionRoutes: OutputRoute[] = []
  private activeExpressionIds: Set<string> | null = null
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
      setExpressionRoutes: (routes, activeExpressionIds = []) => {
        this.expressionRoutes = normalizeRoutes(routes)
        this.activeExpressionIds = new Set(activeExpressionIds)
        this.pruneStaleState(new Set(this.effectiveRoutes().map((route) => route.id)))
        this.lastSerialAt.clear()
        this.lastSerialPayload.clear()
        this.ctx.broadcast(OUTPUTS_CHANNELS.routesChanged, { routes: this.effectiveRoutes() })
      },
      getLegacyExpressionRoutes: () => this.getLegacyExpressionRoutes(),
      removeLegacyExpressionRoutes: (routeIds) => this.removeLegacyExpressionRoutes(routeIds),
      getValuesSnapshot: () => Object.fromEntries(this.values),
      getRoutes: () => this.effectiveRoutes()
    }
  }

  // ─── IPC ─────────────────────────────────────────────────────────────────

  private registerIpc(): void {
    this.ctx.ipcMain.handle(OUTPUTS_CHANNELS.getRoutes, async () => {
      await this.ensureLoaded()
      return this.effectiveRoutes()
    })
    this.ctx.ipcMain.handle(OUTPUTS_CHANNELS.setRoutes, async (_event, input: unknown) => {
      await this.ensureLoaded()
      const next = normalizeRoutes(input)
      const managedIds = new Set(this.expressionRoutes.map((route) => route.id))
      const protectedLegacy = this.routes.filter(isLegacyExpressionManagedRoute)
      const merged = new Map(
        next
          .filter((route) => !managedIds.has(route.id) && !isLegacyExpressionManagedRoute(route))
          .map((route) => [route.id, route])
      )
      for (const route of protectedLegacy) {
        if (!merged.has(route.id)) merged.set(route.id, route)
      }
      const nextRoutes = [...merged.values()]
      const nextEffective = this.effectiveRoutesFor(nextRoutes)
      await this.saveRoutes(nextRoutes)
      this.routes = nextRoutes
      this.pruneStaleState(new Set(nextEffective.map((route) => route.id)))
      // A route's serial target (deviceId/template) can change while keeping its
      // id — drop ALL serial dedup/throttle state so retargeted routes re-send to
      // the new device/template on the next tick instead of being skipped.
      this.lastSerialAt.clear()
      this.lastSerialPayload.clear()
      this.ctx.broadcast(OUTPUTS_CHANNELS.routesChanged, { routes: nextEffective })
      return nextEffective
    })
    this.ctx.ipcMain.handle(OUTPUTS_CHANNELS.getValues, async () => {
      await this.ensureLoaded()
      return Object.fromEntries(this.values) as Record<string, OutputValueUpdate>
    })
  }

  // ─── Snapshot handling ───────────────────────────────────────────────────

  private onSnapshot(snapshot: TelemetrySnapshot | null): void {
    if (!this.loaded) return
    const routes = this.effectiveRoutes()
    if (routes.length === 0) return

    for (const route of routes) {
      if (!route.enabled) continue
      const raw = this.evaluateSource(route.source, snapshot)
      if (raw === undefined) {
        // Audit P0-13 / §24-13: an EXPRESSION route that has already driven a
        // value and then stops resolving (evaluation error, expression removed
        // from the studio) must not leave that value latched on the physical
        // target. Publish one explicit invalidation so the serial device /
        // second screen / dashboard clears instead of holding a stale reading.
        // Scoped to expression sources on purpose: telemetry sources go
        // undefined routinely between sessions and their safe-off behaviour is
        // owned by the hardware-safety work (P0-10), not by this change.
        if (route.source.kind === 'expression') this.invalidateRoute(route)
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

  // Publishes a single invalidation for a route whose source stopped resolving
  // after it had already produced a value, then forgets the route so repeated
  // failures on following ticks stay silent. A route that never resolved has
  // nothing latched and is left alone.
  private invalidateRoute(route: OutputRoute): void {
    const previous = this.values.get(route.id)
    if (!previous || previous.invalid) return
    const update: OutputValueUpdate = {
      routeId: route.id,
      name: targetDisplayName(route.target),
      value: '',
      raw: null,
      invalid: true
    }
    this.values.set(route.id, update)
    this.dispatchToTarget(route, update, sourceFieldName(route.source))
    this.pendingUpdates.set(route.id, update)
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
      if (!/exceeds o buffer|m[áa]x/i.test(message)) {
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

  private async saveRoutes(routes: readonly OutputRoute[] = this.routes): Promise<void> {
    const payload: OutputRoutesPayload = {
      version: 1,
      routes: [...routes],
      updatedAt: new Date().toISOString()
    }
    await mkdir(dirname(this.storePath), { recursive: true })
    const temporaryPath = `${this.storePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
    try {
      await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
      try {
        await rename(temporaryPath, this.storePath)
      } catch (renameError: unknown) {
        const code = (renameError as NodeJS.ErrnoException).code
        if (code !== 'EPERM' && code !== 'EEXIST') throw renameError
        await rm(this.storePath, { force: true })
        await rename(temporaryPath, this.storePath)
      }
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  private pruneStaleState(activeIds: Set<string>): void {
    for (const [id, previous] of [...this.values.entries()]) {
      if (!activeIds.has(id)) {
        this.values.delete(id)
        this.pendingUpdates.set(id, {
          routeId: id,
          name: previous.name,
          value: '',
          deleted: true
        })
      }
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
      const pending = this.pendingUpdates.get(id)
      if (!activeIds.has(id) && pending && !pending.deleted) {
        this.pendingUpdates.set(id, {
          routeId: id,
          name: pending.name,
          value: '',
          deleted: true
        })
      }
    }
  }

  private effectiveRoutes(): OutputRoute[] {
    return this.effectiveRoutesFor(this.routes)
  }

  private effectiveRoutesFor(routes: readonly OutputRoute[]): OutputRoute[] {
    const merged = new Map<string, OutputRoute>()
    const legacyById = new Map<string, OutputRoute>()
    for (const route of routes) {
      if (isLegacyExpressionManagedRoute(route)) legacyById.set(route.id, route)
      if (
        route.source.kind === 'expression' &&
        this.activeExpressionIds &&
        !this.activeExpressionIds.has(route.source.exprId)
      ) {
        continue
      }
      merged.set(route.id, route)
    }
    for (const route of this.expressionRoutes) {
      const legacy = legacyById.get(route.id)
      merged.set(route.id, legacy ? {
        ...route,
        enabled: legacy.enabled,
        format: legacy.format ? { ...legacy.format } : undefined,
        updatedAt: legacy.updatedAt
      } : route)
    }
    return [...merged.values()]
  }

  private async getLegacyExpressionRoutes(): Promise<OutputRoute[]> {
    await this.ensureLoaded()
    return this.routes
      .filter(isLegacyExpressionManagedRoute)
      .map((route) => ({
        ...route,
        source: { ...route.source },
        target: { ...route.target } as OutputTarget,
        format: route.format ? { ...route.format } : undefined
      }))
  }

  private async removeLegacyExpressionRoutes(routeIds: readonly string[]): Promise<void> {
    await this.ensureLoaded()
    const ids = new Set(routeIds)
    if (ids.size === 0) return
    const next = this.routes.filter((route) => !(ids.has(route.id) && isLegacyExpressionManagedRoute(route)))
    if (next.length === this.routes.length) return
    await this.saveRoutes(next)
    this.routes = next
    const effective = this.effectiveRoutes()
    this.pruneStaleState(new Set(effective.map((route) => route.id)))
    this.ctx.broadcast(OUTPUTS_CHANNELS.routesChanged, { routes: effective })
  }
}

// ─── Normalization helpers ────────────────────────────────────────────────

function normalizeRoutes(input: unknown): OutputRoute[] {
  if (!Array.isArray(input)) {
    throw new Error('Invalid output route list.')
  }
  const seenIds = new Set<string>()
  return input.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Route #${index + 1} invalid: payload is not an object.`)
    }
    const candidate = item as Partial<OutputRoute>
    const id = ensureString(candidate.id, `Route #${index + 1}: missing id.`)
    if (seenIds.has(id)) throw new Error(`Route #${index + 1}: duplicate id "${id}".`)
    seenIds.add(id)

    const name = typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim() : id
    if (!isOutputSource(candidate.source)) {
      throw new Error(`Route #${index + 1} (${id}): invalid source.`)
    }
    if (!isOutputTarget(candidate.target)) {
      throw new Error(`Route #${index + 1} (${id}): invalid target.`)
    }
    if (candidate.format !== undefined && !isOutputFormat(candidate.format)) {
      throw new Error(`Route #${index + 1} (${id}): invalid format.`)
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

function isLegacyExpressionManagedRoute(route: OutputRoute): boolean {
  return route.id.startsWith('expr:') && route.source.kind === 'expression'
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
