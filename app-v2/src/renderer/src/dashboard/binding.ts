import type { TelemetrySnapshot } from '../../../shared/telemetry'
import type { ExpressionResultEntry, ExpressionResultsBatch, ExpressionValue } from '../../../shared/expr'
import { EXPR_CHANNELS } from '../../../shared/expr'
import type { OutputValueBatch, OutputValueUpdate } from '../../../shared/outputs'
import { OUTPUTS_CHANNELS } from '../../../shared/outputs'
import { IRACING_VARIABLES, getIracingTelemetryValue } from '../../../shared/iracing-vars'
import type { IracingVarDef } from '../../../shared/iracing-vars'
import {
  formatMeasurement,
  measurementKindForUnit,
  measurementUnit,
  type MeasurementKind,
  type UnitSystem
} from '../../../shared/units'

// Resolve uma chave de binding em (valor exibido, pct numérico 0–1 quando aplicável).
// Bindings derivados são pré-calculados aqui para que os componentes só apliquem estilo.

function fmtTime(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—:--.---'
  const sign = seconds < 0 ? '-' : ''
  const abs = Math.abs(seconds)
  const minutes = Math.floor(abs / 60)
  const rest = abs - minutes * 60
  return `${sign}${minutes}:${rest.toFixed(3).padStart(6, '0')}`
}

function fmtClock(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '--:--'
  const abs = Math.max(0, seconds)
  const hours = Math.floor(abs / 3600)
  const minutes = Math.floor((abs - hours * 3600) / 60)
  const secs = Math.floor(abs - hours * 3600 - minutes * 60)
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

function fmtDelta(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '±0.000'
  const sign = seconds > 0 ? '+' : seconds < 0 ? '-' : '±'
  return `${sign}${Math.abs(seconds).toFixed(3)}`
}

function fmtGear(gear?: number): string {
  if (gear === undefined) return '—'
  if (gear < 0) return 'R'
  if (gear === 0) return 'N'
  return String(gear)
}

function getNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return undefined
}

function gapAhead(snap: TelemetrySnapshot | null): number | undefined {
  if (!snap?.drivers) return undefined
  let nearest: number | undefined
  for (const driver of snap.drivers) {
    if (driver.isPlayer) continue
    const gap = driver.gapToPlayerSec
    if (typeof gap !== 'number' || !Number.isFinite(gap) || gap <= 0) continue
    if (nearest === undefined || gap < nearest) nearest = gap
  }
  return nearest
}

function gapBehind(snap: TelemetrySnapshot | null): number | undefined {
  if (!snap?.drivers) return undefined
  let nearest: number | undefined
  for (const driver of snap.drivers) {
    if (driver.isPlayer) continue
    const gap = driver.gapToPlayerSec
    if (typeof gap !== 'number' || !Number.isFinite(gap) || gap >= 0) continue
    if (nearest === undefined || gap > nearest) nearest = gap
  }
  return nearest
}

function fuelLapsLeft(snap: TelemetrySnapshot | null): number | undefined {
  if (!snap?.fuelLiters || !snap.fuelPerLap || snap.fuelPerLap <= 0) return undefined
  return snap.fuelLiters / snap.fuelPerLap
}

type Corner = 'lf' | 'rf' | 'lr' | 'rr'

function tyreField(snap: TelemetrySnapshot | null, corner: Corner, field: 'tempC' | 'pressureKpa' | 'wearPct'): number | undefined {
  const info = snap?.tyres?.[corner]
  const v = info?.[field]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function brakeField(snap: TelemetrySnapshot | null, corner: Corner): number | undefined {
  const v = snap?.brakeTempC?.[corner]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function avg(values: Array<number | undefined>): number | undefined {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (nums.length === 0) return undefined
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

// Retorna {key,label,color} da bandeira ativa de maior prioridade, ou null.
// Prioridade: red > checkered > black > meatball > yellow > blue > white > green.
interface FlagState {
  key: string
  label: string
  color: string
}
function activeFlag(snap: TelemetrySnapshot | null): FlagState | null {
  const f = snap?.flags
  if (!f) return null
  if (f.red) return { key: 'red', label: 'RED', color: '#ff2a3a' }
  if (f.checkered) return { key: 'checkered', label: 'CHECKERED', color: '#f6fbff' }
  if (f.black) return { key: 'black', label: 'BLACK', color: '#0a0c10' }
  if (f.meatball) return { key: 'meatball', label: 'MEATBALL', color: '#ff8a00' }
  if (f.yellow) return { key: 'yellow', label: 'YELLOW', color: '#ffd400' }
  if (f.blue) return { key: 'blue', label: 'BLUE', color: '#2e8bff' }
  if (f.white) return { key: 'white', label: 'WHITE', color: '#f6fbff' }
  if (f.greenWhiteCheckered) return { key: 'gwc', label: 'GREEN/WHITE', color: '#2dd96a' }
  if (f.green) return { key: 'green', label: 'GREEN', color: '#2dd96a' }
  return null
}

// Re-exporta utilitário para renderers de elementos de bandeira/dualbar.
export function getActiveFlag(snap: TelemetrySnapshot | null): FlagState | null {
  return activeFlag(snap)
}

export interface BindingResult {
  text: string
  numeric?: number
  displayNumeric?: number
  pct?: number
  unit?: string
}

// ─── Output-router and expression caches (live lifecycle) ─────
// `binding.ts` is imported by the main renderer's DashboardRoot which renders
// many elements per frame. We avoid any per-element subscription by keeping
// two module-level caches filled by one subscription set retained while live
// dashboard elements are mounted. Reads from `resolveBinding` stay synchronous, so
// dashboards can bind to `var:<name>` and `expr:<name>` (or `expr:#<exprId>`)
// with zero changes to DashboardRoot.
//
// IPC wiring is lifecycle-managed, so importing this module is pure. Live mounts
// hydrate via `outputs:getValues` + `expr:getResults`, then follow both broadcasts.

interface VarCacheEntry {
  value: string | number | boolean | null
  // Always-formatted text suitable for direct display.
  text: string
  // Numeric form when the raw value is a finite number.
  numeric?: number
}

const varCache = new Map<string, VarCacheEntry>()
const exprCacheByName = new Map<string, VarCacheEntry>()
const exprCacheById = new Map<string, VarCacheEntry>()
const varCacheByRouteId = new Map<string, { name: string; entry: VarCacheEntry; revision: number }>()
const varCacheRouteByName = new Map<string, string>()
const exprNameById = new Map<string, string>()
let varCacheRevision = 0

function rebuildVarName(name: string): void {
  const candidates = [...varCacheByRouteId.values()].filter((item) => item.name === name)
  const latest = candidates.reduce<(typeof candidates)[number] | undefined>(
    (selected, item) => (!selected || item.revision > selected.revision ? item : selected),
    undefined
  )
  if (latest) {
    varCache.set(name, latest.entry)
    const route = [...varCacheByRouteId.entries()].find(([, item]) => item === latest)
    if (route) varCacheRouteByName.set(name, route[0])
  } else {
    varCache.delete(name)
    varCacheRouteByName.delete(name)
  }
}

export function applyOutputValueCacheUpdate(update: OutputValueUpdate): void {
  const previous = varCacheByRouteId.get(update.routeId)
  if (update.deleted) {
    varCacheByRouteId.delete(update.routeId)
    if (previous && varCacheRouteByName.get(previous.name) === update.routeId) rebuildVarName(previous.name)
    return
  }
  const entry = buildVarEntry(update)
  varCacheRevision += 1
  varCacheByRouteId.set(update.routeId, { name: update.name, entry, revision: varCacheRevision })
  if (
    previous &&
    previous.name !== update.name &&
    varCacheRouteByName.get(previous.name) === update.routeId
  ) {
    rebuildVarName(previous.name)
  }
  varCache.set(update.name, entry)
  varCacheRouteByName.set(update.name, update.routeId)
}

export function applyExpressionResultCacheUpdate(exprId: string, entry: ExpressionResultEntry): void {
  const previousName = exprNameById.get(exprId)
  if (entry.deleted) {
    exprCacheById.delete(exprId)
    exprNameById.delete(exprId)
    if (previousName) exprCacheByName.delete(previousName)
    if (entry.name) exprCacheByName.delete(entry.name)
    return
  }

  const cacheEntry = buildExprEntry(entry)
  exprCacheById.set(exprId, cacheEntry)
  if (previousName && previousName !== entry.name) exprCacheByName.delete(previousName)
  if (entry.name) {
    exprNameById.set(exprId, entry.name)
    exprCacheByName.set(entry.name, cacheEntry)
  }
}

export function clearDynamicBindingCaches(): void {
  varCache.clear()
  exprCacheByName.clear()
  exprCacheById.clear()
  varCacheByRouteId.clear()
  varCacheRouteByName.clear()
  exprNameById.clear()
  varCacheRevision = 0
}

function rawToText(raw: unknown): string {
  if (raw === undefined || raw === null) return '—'
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return '—'
    return Number.isInteger(raw) ? raw.toString() : raw.toFixed(3)
  }
  if (typeof raw === 'boolean') return raw ? '1' : '0'
  return String(raw)
}

function rawToNumeric(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'boolean') return raw ? 1 : 0
  return undefined
}

function buildVarEntry(update: OutputValueUpdate): VarCacheEntry {
  // Prefer the router's pre-formatted string for display. Numeric is derived
  // from the raw (pre-format) value when available so bar/gauge bindings can
  // still operate on numbers without re-parsing the formatted string.
  const numeric = rawToNumeric(update.raw)
  const value = (update.raw ?? update.value) as VarCacheEntry['value']
  return {
    value,
    text: update.value ?? rawToText(update.raw),
    numeric
  }
}

function buildExprEntry(entry: ExpressionResultEntry): VarCacheEntry {
  return {
    value: entry.value,
    text: rawToText(entry.value),
    numeric: rawToNumeric(entry.value)
  }
}

function bindingFromEntry(entry: VarCacheEntry | undefined): BindingResult | null {
  if (!entry) return null
  const result: BindingResult = { text: entry.text }
  if (entry.numeric !== undefined) {
    result.numeric = entry.numeric
    if (entry.numeric >= 0 && entry.numeric <= 1) result.pct = entry.numeric
  }
  return result
}

interface IpcLike {
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>
  subscribe<T = unknown>(channel: string, callback: (payload: T) => void): () => void
}

function getIpc(): IpcLike | null {
  if (typeof window === 'undefined') return null
  const ipc = (window as unknown as { ipc?: IpcLike }).ipc
  return ipc ?? null
}

let cacheUsers = 0
let stopCaches: (() => void) | null = null
function startCaches(): () => void {
  const ipc = getIpc()
  if (!ipc) return () => undefined
  let active = true

  const offValues = ipc.subscribe<OutputValueBatch>(OUTPUTS_CHANNELS.value, (batch) => {
    if (!batch || !Array.isArray(batch.updates)) return
    for (const update of batch.updates) {
      if (!update || typeof update.name !== 'string' || update.name.length === 0) continue
      applyOutputValueCacheUpdate(update)
    }
  })

  const offExpressions = ipc.subscribe<ExpressionResultsBatch>(EXPR_CHANNELS.results, (batch) => {
    if (!batch || !batch.results) return
    for (const [exprId, entry] of Object.entries(batch.results)) {
      if (!entry) continue
      applyExpressionResultCacheUpdate(exprId, entry)
    }
  })

  // Hydrate once so dashboards opened mid-session render values immediately.
  void ipc
    .invoke<Record<string, OutputValueUpdate>>(OUTPUTS_CHANNELS.getValues)
    .then((snapshot) => {
      if (!active || !snapshot) return
      for (const update of Object.values(snapshot)) {
        if (!update || typeof update.name !== 'string' || update.name.length === 0) continue
        applyOutputValueCacheUpdate(update)
      }
    })
    .catch(() => undefined)

  void ipc
    .invoke<Record<string, ExpressionResultEntry>>(EXPR_CHANNELS.getResults)
    .then((snapshot) => {
      if (!active || !snapshot) return
      for (const [exprId, entry] of Object.entries(snapshot)) {
        if (!entry) continue
        applyExpressionResultCacheUpdate(exprId, entry)
      }
    })
    .catch(() => undefined)
  return () => {
    active = false
    offValues()
    offExpressions()
  }
}

export function retainBindingIpc(): () => void {
  cacheUsers += 1
  if (cacheUsers === 1) stopCaches = startCaches()
  let released = false
  return () => {
    if (released) return
    released = true
    cacheUsers -= 1
    if (cacheUsers === 0) {
      stopCaches?.()
      stopCaches = null
    }
  }
}

// Test-only seam: lets callers prime caches without going through the live
// IPC subscriptions (e.g. mock renderers, unit tests). Kept intentionally
// permissive — it never throws and never overrides real subscriptions.
export function __setBindingCacheForTesting(entries: {
  vars?: Record<string, ExpressionValue>
  exprByName?: Record<string, ExpressionValue>
  exprById?: Record<string, ExpressionValue>
}): void {
  if (entries.vars) {
    for (const [name, value] of Object.entries(entries.vars)) {
      varCache.set(name, {
        value: value as VarCacheEntry['value'],
        text: rawToText(value),
        numeric: rawToNumeric(value)
      })
    }
  }
  if (entries.exprByName) {
    for (const [name, value] of Object.entries(entries.exprByName)) {
      exprCacheByName.set(name, {
        value: value as VarCacheEntry['value'],
        text: rawToText(value),
        numeric: rawToNumeric(value)
      })
    }
  }
  if (entries.exprById) {
    for (const [id, value] of Object.entries(entries.exprById)) {
      exprCacheById.set(id, {
        value: value as VarCacheEntry['value'],
        text: rawToText(value),
        numeric: rawToNumeric(value)
      })
    }
  }
}

const DIRECT_KEYS: Array<keyof TelemetrySnapshot> = [
  'speedKmh', 'rpm', 'gear', 'maxRpm', 'shiftIndicatorPct',
  'steerAngleDeg', 'brakeBiasPct', 'waterTempC', 'oilTempC', 'oilPressureKpa',
  'currentLap', 'lapsRemaining', 'lapDistPct', 'position', 'classPosition', 'totalCars',
  'lastLapTimeSec', 'bestLapTimeSec', 'currentLapTimeSec', 'estimatedLapTimeSec',
  'deltaToBestSec', 'deltaToSessionBestSec', 'sessionTimeRemainingSec',
  'fuelLiters', 'fuelPerLap', 'fuelCapacityLiters',
  'incidentCount', 'incidentLimit',
  'trackTempC', 'airTempC', 'trackWetnessPct', 'gripPct',
  'latAccelG', 'longAccelG', 'vertAccelG', 'yawRateRadSec', 'strengthOfField'
]

// ─── iRacing channel bindings (`ir:<VarId>`) ───────────────────────────────────
// Lets the dashboard expose ONE clean widget per mapped iRacing variable without
// hand-writing a binding for each. The catalog binds `ir:<id>`; here we resolve
// it to the nicest available value:
//   1. hero channels with a polished formatter → delegate to the derived key
//   2. anything else with a telemetryField → read straight from the snapshot
//   3. no telemetryField → fall back to the live `var:<id>` output cache
const IRACING_VAR_BY_ID = new Map<string, IracingVarDef>(IRACING_VARIABLES.map((v) => [v.id, v]))

// iRacing var id → an existing derived binding key that already formats it well.
const IRACING_ID_TO_BINDING: Record<string, string> = {
  Speed: 'speedKmh',
  RPM: 'rpm',
  Engine0_RPM: 'rpm',
  Gear: 'gearLabel',
  ShiftIndicatorPct: 'shiftPct',
  Throttle: 'throttle',
  ThrottleRaw: 'throttle',
  Brake: 'brake',
  BrakeRaw: 'brake',
  Clutch: 'clutch',
  ClutchRaw: 'clutch',
  HandbrakeRaw: 'handbrake',
  Lap: 'currentLap',
  LapCurrentLapTime: 'currentLapFmt',
  LapLastLapTime: 'lastLapFmt',
  LapBestLapTime: 'bestLapFmt',
  LapDeltaToBestLap: 'deltaBestFmt',
  LapDeltaToBestLap_DD: 'deltaBestFmt',
  LapDeltaToSessionBestLap: 'deltaSessionBestFmt',
  EstimatedLapTime: 'estLapFmt',
  SessionTimeRemain: 'sessionTimeLeftFmt',
  SessionLapsRemain: 'lapsRemaining',
  SessionLapsRemainEx: 'lapsRemaining',
  SessionType: 'sessionType',
  TrackName: 'trackName',
  CarName: 'carName',
  PlayerCarPosition: 'position',
  PlayerCarClassPosition: 'classPosition',
  TotalCars: 'totalCars',
  StrengthOfField: 'strengthOfField',
  FuelLevel: 'fuelLitersStr',
  FuelLevelPct: 'fuelPct',
  FuelUsePerLap: 'fuelPerLapStr',
  DriverCarFuelMaxLtr: 'fuelCapacityLiters',
  AirTemp: 'airTempC',
  TrackTemp: 'trackTempC',
  TrackTempCrew: 'trackTempC',
  TrackWetness: 'trackWetnessPct',
  TrackGripStatus: 'gripPct',
  WaterTemp: 'waterTempC',
  OilTemp: 'oilTempC',
  OilPressure: 'oilPressureKpa',
  OnPitRoad: 'inPits',
  PitSpeedLimiter: 'pitLimiter',
  ABSActive: 'absActive',
  TCActive: 'tcActive',
  DRS_Status: 'drs',
  PlayerCarMyIncidentCount: 'incidentCount',
  PlayerCarTeamIncidentCount: 'incidentCount',
  PlayerCarDriverIncidentCount: 'incidentCount',
  PlayerCarMaxIncidentCount: 'incidentLimit'
}

function formatIracingRaw(raw: ExpressionValue | undefined, def: IracingVarDef): BindingResult | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw === 'boolean') {
    return { text: raw ? 'ON' : 'OFF', numeric: raw ? 1 : 0, pct: raw ? 1 : 0 }
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null
    // 0..1 ratios stored as fractions (wear, wetness, grip, indicators) → percent.
    if (def.unit === '%' && raw >= 0 && raw <= 1) {
      return { text: (raw * 100).toFixed(0), numeric: raw, pct: raw }
    }
    const abs = Math.abs(raw)
    const decimals = abs >= 100 || Number.isInteger(raw) ? 0 : abs >= 10 ? 1 : 2
    const result: BindingResult = { text: raw.toFixed(decimals), numeric: raw }
    if (raw >= 0 && raw <= 1) result.pct = raw
    return result
  }
  return { text: String(raw) }
}


function resolveBindingCanonical(
  binding: string | undefined,
  snap: TelemetrySnapshot | null
): BindingResult {
  if (!binding) return { text: '' }

  // iRacing channel binding (`ir:<VarId>`) — used by the auto-generated widget
  // catalog so a single clean `value` widget can bind any of the ~104 mapped
  // iRacing variables. Resolution order: polished derived key → raw
  // telemetryField → live `var:` output cache.
  if (binding.startsWith('ir:')) {
    const id = binding.slice(3)
    const def = IRACING_VAR_BY_ID.get(id)
    const derivedKey = IRACING_ID_TO_BINDING[id]
    if (derivedKey) {
      const derived = resolveBindingCanonical(derivedKey, snap)
      if (derived.text && derived.text !== '—') return derived
    }
    if (def && snap) {
      const raw = getIracingTelemetryValue(snap, def)
      const formatted = formatIracingRaw(raw, def)
      if (formatted) return formatted
    }
    const entry = varCache.get(id)
    const cached = bindingFromEntry(entry)
    return cached ?? { text: '—' }
  }


  // other route that happens to share that name — the cache is keyed by the
  // broadcast `update.name`). Resolves from the module-level cache populated
  // by the `outputs:value` subscription. Works regardless of telemetry state.
  if (binding.startsWith('var:')) {
    const name = binding.slice(4)
    const entry = varCache.get(name)
    const result = bindingFromEntry(entry)
    return result ?? { text: '—' }
  }

  // Expression results — either by legacy name (`expr:<name>`) or by the stable
  // raw id (`expr:#<exprId>`). New destinations always use the id form. The
  // engine broadcasts on `expr:results` regardless of whether the expression
  // has any output targets, so this works for ad-hoc expressions too.
  if (binding.startsWith('expr:')) {
    const rest = binding.slice(5)
    const entry = rest.startsWith('#') ? exprCacheById.get(rest.slice(1)) : exprCacheByName.get(rest)
    const result = bindingFromEntry(entry)
    return result ?? { text: '—' }
  }

  if (!snap) {
    // valores neutros sem telemetria
    if (binding.endsWith('Fmt')) return { text: '—:--.---' }
    if (binding === 'gearLabel') return { text: '—' }
    return { text: '—' }
  }

  // Derivados
  switch (binding) {
    case 'gearLabel':
      return { text: fmtGear(snap.gear), numeric: snap.gear }
    case 'rpmPct': {
      const max = snap.maxRpm ?? 0
      const pct = max > 0 ? Math.min(1, Math.max(0, snap.rpm / max)) : 0
      return { text: (pct * 100).toFixed(0), numeric: pct * 100, pct }
    }
    case 'shiftPct': {
      // Per-car shift-light band from the provider (0 below SLFirstRPM, 1 at/after
      // SLShiftRPM). revLights.pct is the same band, kept as a fallback. Never
      // rpm/maxRpm — that lights the bar proportionally at all RPM.
      const pct = Math.min(1, Math.max(0, snap.shiftIndicatorPct ?? snap.revLights?.pct ?? 0))
      return { text: (pct * 100).toFixed(0), numeric: pct, pct }
    }
    case 'fuelPct': {
      if (!snap.fuelCapacityLiters || snap.fuelCapacityLiters <= 0) {
        return { text: '0', numeric: 0, pct: 0 }
      }
      const pct = Math.min(1, Math.max(0, (snap.fuelLiters ?? 0) / snap.fuelCapacityLiters))
      return { text: (pct * 100).toFixed(0), numeric: pct, pct }
    }
    case 'fuelLitersStr':
      return { text: snap.fuelLiters !== undefined ? snap.fuelLiters.toFixed(1) : '—', numeric: snap.fuelLiters }
    case 'fuelPerLapStr':
      return { text: snap.fuelPerLap !== undefined ? snap.fuelPerLap.toFixed(2) : '—', numeric: snap.fuelPerLap }
    case 'fuelLapsLeftStr': {
      const lapsLeft = fuelLapsLeft(snap)
      return { text: lapsLeft !== undefined ? lapsLeft.toFixed(1) : '—', numeric: lapsLeft }
    }
    case 'currentLapFmt':
      return { text: fmtTime(snap.currentLapTimeSec), numeric: snap.currentLapTimeSec }
    case 'lastLapFmt':
      return { text: fmtTime(snap.lastLapTimeSec), numeric: snap.lastLapTimeSec }
    case 'bestLapFmt':
      return { text: fmtTime(snap.bestLapTimeSec), numeric: snap.bestLapTimeSec }
    case 'deltaBestFmt':
      return { text: fmtDelta(snap.deltaToBestSec), numeric: snap.deltaToBestSec }
    case 'deltaSessionBestFmt':
      return { text: fmtDelta(snap.deltaToSessionBestSec), numeric: snap.deltaToSessionBestSec }
    case 'sessionTimeLeftFmt':
      return { text: fmtClock(snap.sessionTimeRemainingSec), numeric: snap.sessionTimeRemainingSec }
    case 'gapAhead': {
      const v = gapAhead(snap)
      return { text: v !== undefined ? v.toFixed(3) : '—', numeric: v }
    }
    case 'gapBehind': {
      const v = gapBehind(snap)
      return { text: v !== undefined ? Math.abs(v).toFixed(3) : '—', numeric: v }
    }
    case 'gapAheadFmt': {
      const v = gapAhead(snap)
      return { text: v !== undefined ? `−${v.toFixed(3)}s` : '—', numeric: v }
    }
    case 'gapBehindFmt': {
      const v = gapBehind(snap)
      return { text: v !== undefined ? `+${Math.abs(v).toFixed(3)}s` : '—', numeric: v }
    }
    case 'throttleBrake': {
      // valor "puxa para acelerador" mapeado 0..1 (1 = full throttle, 0 = full brake).
      const t = snap.throttle ?? 0
      const b = snap.brake ?? 0
      const pct = Math.min(1, Math.max(0, 0.5 + 0.5 * (t - b)))
      return { text: `${(t * 100).toFixed(0)}/${(b * 100).toFixed(0)}`, numeric: pct, pct }
    }
    case 'deltaSec': {
      const v = snap.deltaToSessionBestSec ?? snap.deltaToBestSec
      return { text: fmtDelta(v), numeric: v }
    }
    case 'lastLapDeltaSec': {
      if (snap.lastLapTimeSec === undefined || snap.bestLapTimeSec === undefined) {
        return { text: fmtDelta(undefined), numeric: undefined }
      }
      const v = snap.lastLapTimeSec - snap.bestLapTimeSec
      return { text: fmtDelta(v), numeric: v }
    }
    case 'flagAny': {
      const f = activeFlag(snap)
      return { text: f ? f.label : '', numeric: f ? 1 : 0 }
    }
    case 'flagColor': {
      const f = activeFlag(snap)
      return { text: f ? f.color : 'transparent' }
    }
    case 'flagLabel': {
      const f = activeFlag(snap)
      return { text: f ? f.label : '' }
    }
    case 'inPits':
      return { text: snap.onPitRoad ? 'PIT' : '', numeric: snap.onPitRoad ? 1 : 0 }
    case 'pitLimiter':
      return { text: snap.pitLimiter ? 'LIMITER' : '', numeric: snap.pitLimiter ? 1 : 0 }
    case 'driversCount': {
      const n = snap.drivers?.length ?? 0
      return { text: String(n), numeric: n }
    }
    case 'speedMph': {
      const v = snap.speedKmh
      return { text: v !== undefined ? v.toFixed(0) : '—', numeric: v }
    }
    case 'absActive':
      return { text: snap.absActive ? 'ABS' : '', numeric: snap.absActive ? 1 : 0 }
    case 'absEnabled':
      return { text: snap.absEnabled ? 'ON' : 'OFF', numeric: snap.absEnabled ? 1 : 0 }
    case 'absLevel': {
      const v = snap.absLevel
      const n = getNumber(v)
      return { text: v !== undefined ? String(v) : '—', numeric: n }
    }
    case 'tcActive':
      return { text: snap.tcActive ? 'TC' : '', numeric: snap.tcActive ? 1 : 0 }
    case 'tcEnabled':
      return { text: snap.tcEnabled ? 'ON' : 'OFF', numeric: snap.tcEnabled ? 1 : 0 }
    case 'tcLevel': {
      const v = snap.tcLevel
      const n = getNumber(v)
      return { text: v !== undefined ? String(v) : '—', numeric: n }
    }
    case 'engineMap': {
      const v = snap.engineMap
      const n = getNumber(v)
      return { text: v !== undefined ? String(v) : '—', numeric: n }
    }
    case 'brakeBiasPct':
      return { text: snap.brakeBiasPct !== undefined ? snap.brakeBiasPct.toFixed(1) : '—', numeric: snap.brakeBiasPct }
    case 'drs':
      return { text: snap.drs ? 'DRS' : '', numeric: snap.drs ? 1 : 0 }
    case 'handbrake': {
      const pct = Math.min(1, Math.max(0, snap.handbrake ?? 0))
      return { text: (pct * 100).toFixed(0), numeric: pct, pct }
    }
    case 'waterTempC':
      return { text: snap.waterTempC !== undefined ? snap.waterTempC.toFixed(0) : '—', numeric: snap.waterTempC }
    case 'oilTempC':
      return { text: snap.oilTempC !== undefined ? snap.oilTempC.toFixed(0) : '—', numeric: snap.oilTempC }
    case 'oilPressureKpa':
      return { text: snap.oilPressureKpa !== undefined ? snap.oilPressureKpa.toFixed(0) : '—', numeric: snap.oilPressureKpa }
    case 'relativeAheadName':
      return { text: snap.relatives?.ahead?.name ?? '—' }
    case 'relativeBehindName':
      return { text: snap.relatives?.behind?.name ?? '—' }
    case 'relativeAheadLastLapFmt':
      return { text: fmtTime(snap.relatives?.ahead?.lastLapTimeSec), numeric: snap.relatives?.ahead?.lastLapTimeSec }
    case 'relativeBehindLastLapFmt':
      return { text: fmtTime(snap.relatives?.behind?.lastLapTimeSec), numeric: snap.relatives?.behind?.lastLapTimeSec }
    case 'radarCarsCount': {
      const n = snap.radarCars?.length ?? 0
      return { text: String(n), numeric: n }
    }
    // ── Tires por canto ────────────────────────────────────────────────────
    case 'tyreLfTempC': case 'tyreRfTempC': case 'tyreLrTempC': case 'tyreRrTempC': {
      const corner = binding.slice(4, 6).toLowerCase() as Corner
      const v = tyreField(snap, corner, 'tempC')
      return { text: v !== undefined ? v.toFixed(0) : '—', numeric: v }
    }
    case 'tyreLfPressureKpa': case 'tyreRfPressureKpa': case 'tyreLrPressureKpa': case 'tyreRrPressureKpa': {
      const corner = binding.slice(4, 6).toLowerCase() as Corner
      const v = tyreField(snap, corner, 'pressureKpa')
      return { text: v !== undefined ? v.toFixed(1) : '—', numeric: v }
    }
    case 'tyreLfWearPct': case 'tyreRfWearPct': case 'tyreLrWearPct': case 'tyreRrWearPct': {
      const corner = binding.slice(4, 6).toLowerCase() as Corner
      const v = tyreField(snap, corner, 'wearPct')
      const pct = v !== undefined ? Math.min(1, Math.max(0, v)) : undefined
      return { text: pct !== undefined ? (pct * 100).toFixed(0) : '—', numeric: pct, pct }
    }
    // ── Freios por canto ───────────────────────────────────────────────────
    case 'brakeLfTempC': case 'brakeRfTempC': case 'brakeLrTempC': case 'brakeRrTempC': {
      const corner = binding.slice(5, 7).toLowerCase() as Corner
      const v = brakeField(snap, corner)
      return { text: v !== undefined ? v.toFixed(0) : '—', numeric: v }
    }
    case 'brakeFrontAvgTempC': {
      const v = avg([brakeField(snap, 'lf'), brakeField(snap, 'rf')])
      return { text: v !== undefined ? v.toFixed(0) : '—', numeric: v }
    }
    case 'brakeRearAvgTempC': {
      const v = avg([brakeField(snap, 'lr'), brakeField(snap, 'rr')])
      return { text: v !== undefined ? v.toFixed(0) : '—', numeric: v }
    }
    // ── Clima / pista ──────────────────────────────────────────────────────
    case 'isRaining':
      return { text: snap.isRaining ? 'RAIN' : '', numeric: snap.isRaining ? 1 : 0 }
    case 'trackWetnessPct': {
      const pct = Math.min(1, Math.max(0, snap.trackWetnessPct ?? 0))
      return { text: (pct * 100).toFixed(0), numeric: pct, pct }
    }
    case 'gripPct': {
      const pct = Math.min(1, Math.max(0, snap.gripPct ?? 0))
      return { text: (pct * 100).toFixed(0), numeric: pct, pct }
    }
    // ── Session (texto) ─────────────────────────────────────────────────────
    case 'sessionType':
      return { text: snap.sessionType ?? '—' }
    case 'carName':
      return { text: snap.carName ?? '—' }
    case 'trackName':
      return { text: snap.trackName ?? '—' }
    case 'estLapFmt':
      return { text: fmtTime(snap.estimatedLapTimeSec), numeric: snap.estimatedLapTimeSec }
  }

  // Direta no snapshot (keyof)
  if ((DIRECT_KEYS as readonly string[]).includes(binding)) {
    const value = (snap as unknown as Record<string, unknown>)[binding]
    const num = getNumber(value)
    if (num !== undefined) {
      return { text: num.toFixed(0), numeric: num }
    }
    return { text: value !== undefined && value !== null ? String(value) : '—' }
  }

  // Inputs 0..1 expostos como pct (throttle/brake/clutch/fuelPct etc.)
  if (binding === 'throttle' || binding === 'brake' || binding === 'clutch') {
    const value = (snap as unknown as Record<string, unknown>)[binding]
    const num = getNumber(value) ?? 0
    const pct = Math.min(1, Math.max(0, num))
    return { text: (pct * 100).toFixed(0), numeric: pct, pct }
  }

  return { text: '—' }
}

function measurementKindForBinding(binding: string | undefined): MeasurementKind | undefined {
  if (!binding) return undefined
  if (binding.startsWith('ir:')) {
    const id = binding.slice(3)
    const derived = IRACING_ID_TO_BINDING[id]
    if (derived) return measurementKindForBinding(derived)
    return measurementKindForUnit(IRACING_VAR_BY_ID.get(id)?.unit)
  }

  if (binding === 'speedKmh' || binding === 'speedMph') return 'speed-kmh'
  if (binding === 'fuelLitersStr' || binding === 'fuelLiters' || binding === 'fuelCapacityLiters') return 'fuel-volume-l'
  if (binding === 'fuelPerLapStr' || binding === 'fuelPerLap') return 'fuel-per-lap-l'
  if (/TempC$/.test(binding) || /TempC:/.test(binding)) return 'temperature-c'
  if (/PressureKpa$/.test(binding) || /PressureKpa:/.test(binding)) return 'pressure-kpa'
  return undefined
}

export function displayUnitLabel(
  label: string | undefined,
  binding: string | undefined,
  canonicalUnit: string | null | undefined,
  unitSystem: UnitSystem
): string | undefined {
  if (!label || unitSystem === 'metric') return label

  const kind =
    measurementKindForBinding(binding) ??
    measurementKindForUnit(canonicalUnit) ??
    measurementKindForUnit(label)
  if (measurementKindForUnit(label)) return kind ? measurementUnit(kind, unitSystem) : label

  let display = label
    .replace(/km\s*\/\s*h/gi, measurementUnit('speed-kmh', unitSystem))
    .replace(/°\s*C/gi, measurementUnit('temperature-c', unitSystem))
    .replace(/\bkPa\b/g, measurementUnit('pressure-kpa', unitSystem))
    .replace(/\bbar\b/gi, measurementUnit('pressure-bar', unitSystem))
    .replace(/\bL\s*\/\s*lap\b/gi, measurementUnit('fuel-per-lap-l', unitSystem))

  if (kind === 'fuel-volume-l') display = display.replace(/\bL\b/g, measurementUnit(kind, unitSystem))
  if (kind === 'fuel-per-lap-l') {
    display = display
      .replace(/\bL\s*\/\s*LAP\b/gi, measurementUnit(kind, unitSystem))
      .replace(/\bL\b/g, measurementUnit('fuel-volume-l', unitSystem))
  }
  if (kind === 'distance-km') display = display.replace(/\bkm\b/gi, measurementUnit(kind, unitSystem))
  if (kind === 'distance-m') display = display.replace(/\bm\b/g, measurementUnit(kind, unitSystem))
  return display
}

function measurementDecimals(binding: string | undefined, kind: MeasurementKind): number {
  if (kind === 'fuel-per-lap-l') return 2
  if (kind === 'fuel-volume-l') return 1
  if (kind === 'pressure-bar') return 2
  if (kind === 'pressure-kpa') return binding?.includes('tyre') || binding?.includes('Pressure') ? 1 : 0
  if (kind === 'distance-m' || kind === 'distance-km' || kind === 'speed-ms') return 1
  return 0
}

export function resolveBinding(
  binding: string | undefined,
  snap: TelemetrySnapshot | null,
  unitSystem: UnitSystem = 'metric'
): BindingResult {
  const result = resolveBindingCanonical(binding, snap)
  const kind = measurementKindForBinding(binding)
  if (!kind) return result
  const formatted = formatMeasurement(result.numeric, kind, unitSystem, {
    decimals: measurementDecimals(binding, kind)
  })
  return {
    ...result,
    text: formatted.display,
    displayNumeric: formatted.value,
    unit: formatted.unit
  }
}
