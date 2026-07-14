// Unified output routing — shared types and helpers.
//
// An OutputRoute glues a SOURCE (where the value comes from) to a TARGET (where
// it lands). The expression engine, the alerts module, the dashboards layer and
// the (future) multi-device serial hub all plug into the same plumbing exposed
// by `src/main/modules/output-router.ts`.
//
// Keep this file dependency-free (only imports from `./expr` and primitive
// types) so renderer, preload and main can all consume it.

import type { ExpressionValue } from './expr'

// ─── Source ────────────────────────────────────────────────────────────────

export type OutputSource =
  // Pull a value directly from the normalized telemetry snapshot via a dotted
  // path (e.g. `speedKmh`, `fuel.remainLiters`, `tyres.lf.tempC`).
  | { kind: 'telemetry'; field: string }
  // Reuse a value computed by the expression engine (`ExpressionDef.id`).
  | { kind: 'expression'; exprId: string }
  // Static literal — useful for "press button" style routes or testing.
  | { kind: 'literal'; value: string | number }

// ─── Target ────────────────────────────────────────────────────────────────

export type OutputTarget =
  // Named dashboard/overlay variable. Consumers bind to it with `var:<name>`.
  | { kind: 'dashboardVar'; name: string }
  // Serial command template with `${value}` / `${field}` interpolation.
  // `deviceId` is reserved for the upcoming multi-device serial hub; until then
  // the router sends to the primary serial device.
  | { kind: 'serial'; deviceId?: string; template: string }
  // Push a value to a slot on the secondary screen renderer.
  | { kind: 'secondScreen'; slot: string }
  // Mirror an overlay-named value (same shape as dashboardVar but tagged so the
  // overlay subsystem can distinguish UI-bound vs dashboard-bound writes).
  | { kind: 'overlay'; name: string }
  // Switch the active dashboard when the source value becomes truthy.
  | { kind: 'dashboard'; dashboardId: string; dashboardName: string }

export type OutputTargetKind = OutputTarget['kind']

// ─── Formatting ────────────────────────────────────────────────────────────

export interface OutputFormat {
  // Decimal places when the value is numeric. `undefined` → no rounding.
  decimals?: number
  // Prefix/suffix glued around the formatted value (e.g. " L", "RPM ").
  prefix?: string
  suffix?: string
  // Optional multiplier applied before rounding (e.g. m/s → km/h).
  scale?: number
}

// ─── Route ─────────────────────────────────────────────────────────────────

export interface OutputRoute {
  id: string
  name: string
  enabled: boolean
  source: OutputSource
  target: OutputTarget
  format?: OutputFormat
  // ISO-8601 timestamp. Updated whenever the route is changed via IPC.
  updatedAt: string
}

// ─── Persisted store payload ────────────────────────────────────────────────

export interface OutputRoutesPayload {
  version: 1
  routes: OutputRoute[]
  updatedAt: string
}

// ─── Runtime broadcasts ─────────────────────────────────────────────────────

// Single value update — emitted by the router when a route's value changes.
export interface OutputValueUpdate {
  routeId: string
  // The target's name/slot, lifted to top-level so dashboard/overlay
  // subscribers don't have to introspect the full route.
  name: string
  // The formatted, ready-to-render string. Always present.
  value: string
  // The raw (pre-format) value when available — handy for numeric bindings.
  raw?: ExpressionValue
  // Route-deletion tombstone. Consumers must remove cached values by route id/name.
  deleted?: true
}

// Batched payload broadcast on `outputs:value` (~10Hz).
export interface OutputValueBatch {
  updates: OutputValueUpdate[]
  // ms since epoch — set on the broadcasting side.
  timestamp: number
}

// Second-screen broadcast: a single named slot got a new value.
export interface OutputSecondScreenUpdate {
  routeId: string
  slot: string
  value: string
  raw?: ExpressionValue
  timestamp: number
}

// ─── IPC channels (string constants — keep all channel names here) ──────────

export const OUTPUTS_CHANNELS = {
  getRoutes: 'outputs:getRoutes',
  setRoutes: 'outputs:setRoutes',
  getValues: 'outputs:getValues',
  // Broadcast channels (main → renderers).
  value: 'outputs:value',
  secondScreen: 'outputs:secondScreen',
  routesChanged: 'outputs:routesChanged'
} as const

export type OutputsChannel = (typeof OUTPUTS_CHANNELS)[keyof typeof OUTPUTS_CHANNELS]

// ─── Template interpolation (NO eval) ───────────────────────────────────────

// Render a template string with `${name}` placeholders against a values map.
// Recognised, well-known placeholders:
//   - `${value}` → the formatted output value (string)
//   - `${field}` → the raw source field name (telemetry path, expr id, …)
// Anything else is looked up in `extras` and falls back to an empty string.
// Crucially: this never runs JS — it's a tiny string substitution.
export function interpolateTemplate(
  template: string,
  values: { value: string; field?: string; extras?: Record<string, string | number | boolean | null | undefined> }
): string {
  if (!template) return ''
  return template.replace(/\$\{([^}]+)\}/g, (_match, rawKey: string) => {
    const key = rawKey.trim()
    if (!key) return ''
    if (key === 'value') return values.value
    if (key === 'field') return values.field ?? ''
    const extra = values.extras?.[key]
    if (extra === undefined || extra === null) return ''
    return String(extra)
  })
}

// ─── Value formatting ──────────────────────────────────────────────────────

// Convert any ExpressionValue (number/boolean/string/null) into a display
// string honouring `OutputFormat`. Returns '' for null/undefined.
export function formatOutputValue(value: ExpressionValue | undefined, format?: OutputFormat): string {
  if (value === null || value === undefined) return ''
  let working: number | string | boolean = value
  if (typeof working === 'number') {
    if (format?.scale !== undefined && Number.isFinite(format.scale)) {
      working = working * format.scale
    }
    if (!Number.isFinite(working as number)) {
      // Never let NaN/Infinity leak into a serial command or display.
      working = ''
    } else if (format?.decimals !== undefined && Number.isFinite(format.decimals)) {
      const decimals = Math.max(0, Math.min(20, Math.floor(format.decimals)))
      working = (working as number).toFixed(decimals)
    } else {
      working = String(working)
    }
  } else if (typeof working === 'boolean') {
    working = working ? '1' : '0'
  }
  const stringified = typeof working === 'string' ? working : String(working)
  const prefix = format?.prefix ?? ''
  const suffix = format?.suffix ?? ''
  return `${prefix}${stringified}${suffix}`
}

// ─── Source path accessor (dotted telemetry path) ──────────────────────────

// Safely reach into a snapshot-like object using dotted notation. Returns
// undefined for any missing segment. Arrays are supported via numeric index
// (e.g. `cars.0.position`).
export function readDottedPath(source: unknown, path: string): ExpressionValue | undefined {
  if (!path) return undefined
  if (source === null || source === undefined) return undefined
  const segments = path.split('.')
  let cursor: unknown = source
  for (const segment of segments) {
    if (cursor === null || cursor === undefined) return undefined
    if (typeof cursor !== 'object') return undefined
    if (Array.isArray(cursor)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= cursor.length) return undefined
      cursor = cursor[index]
      continue
    }
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  if (cursor === undefined) return undefined
  if (cursor === null || typeof cursor === 'number' || typeof cursor === 'boolean' || typeof cursor === 'string') {
    return cursor
  }
  // Non-scalar leaves (objects/arrays) are not valid output values.
  return undefined
}

// ─── Validation / normalization helpers ─────────────────────────────────────

export function isOutputRoute(value: unknown): value is OutputRoute {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<OutputRoute>
  if (typeof candidate.id !== 'string' || !candidate.id) return false
  if (typeof candidate.name !== 'string') return false
  if (typeof candidate.enabled !== 'boolean') return false
  if (!isOutputSource(candidate.source)) return false
  if (!isOutputTarget(candidate.target)) return false
  if (candidate.format !== undefined && !isOutputFormat(candidate.format)) return false
  if (typeof candidate.updatedAt !== 'string') return false
  return true
}

export function isOutputSource(value: unknown): value is OutputSource {
  if (!value || typeof value !== 'object') return false
  const source = value as Partial<OutputSource> & { kind?: string }
  switch (source.kind) {
    case 'telemetry':
      return typeof (source as { field?: unknown }).field === 'string'
    case 'expression':
      return typeof (source as { exprId?: unknown }).exprId === 'string'
    case 'literal': {
      const v = (source as { value?: unknown }).value
      return typeof v === 'string' || typeof v === 'number'
    }
    default:
      return false
  }
}

export function isOutputTarget(value: unknown): value is OutputTarget {
  if (!value || typeof value !== 'object') return false
  const target = value as Partial<OutputTarget> & { kind?: string }
  switch (target.kind) {
    case 'dashboardVar':
    case 'overlay':
      return typeof (target as { name?: unknown }).name === 'string' && (target as { name: string }).name.length > 0
    case 'serial':
      return typeof (target as { template?: unknown }).template === 'string'
    case 'secondScreen':
      return typeof (target as { slot?: unknown }).slot === 'string' && (target as { slot: string }).slot.length > 0
    case 'dashboard':
      return (
        typeof (target as { dashboardId?: unknown }).dashboardId === 'string' &&
        (target as { dashboardId: string }).dashboardId.length > 0 &&
        typeof (target as { dashboardName?: unknown }).dashboardName === 'string' &&
        (target as { dashboardName: string }).dashboardName.length > 0
      )
    default:
      return false
  }
}

export function isOutputFormat(value: unknown): value is OutputFormat {
  if (!value || typeof value !== 'object') return false
  const format = value as Partial<OutputFormat>
  if (
    format.decimals !== undefined &&
    (typeof format.decimals !== 'number' ||
      !Number.isFinite(format.decimals) ||
      !Number.isInteger(format.decimals) ||
      format.decimals < 0 ||
      format.decimals > 20)
  ) return false
  if (format.prefix !== undefined && typeof format.prefix !== 'string') return false
  if (format.suffix !== undefined && typeof format.suffix !== 'string') return false
  if (format.scale !== undefined && (typeof format.scale !== 'number' || !Number.isFinite(format.scale))) return false
  return true
}
