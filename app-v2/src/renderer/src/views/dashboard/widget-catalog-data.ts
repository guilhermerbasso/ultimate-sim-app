// Pure data + taxonomy layer for the shared widget catalog. React-free and
// DOM-free so it can be imported by the renderer gallery (widget-catalog.tsx)
// AND by unit tests in the node environment. The React preview/gallery UI lives
// in widget-catalog.tsx and imports from here.

import type { DashboardElement, DashboardElementType } from '../../../../shared/dashboards'
import { createElementId, OVERLAY_DASHBOARD_PRESETS } from '../../../../shared/dashboards'
import type { OverlayWidgetId } from '../../../../shared/overlays'
import { OVERLAY_WIDGETS, overlayWidgetDisplayTitle } from '../../../../shared/overlays'
import {
  IRACING_VARIABLES,
  IRACING_VAR_CATEGORY_LABELS,
  IRACING_VAR_CATEGORY_ORDER
} from '../../../../shared/iracing-vars'
import type { IracingVarDef, IracingVarCategory } from '../../../../shared/iracing-vars'
import {
  filterVariants as filterVariantsByQuery,
  groupVariantsByCategory,
  type WidgetCategoryTag,
  type WidgetStyleFamily,
  type WidgetClusterTag,
  type WidgetHardwareFamily,
  type WidgetTaxon,
  type WidgetFilterQuery
} from '../../../../shared/widget-taxonomy'
import {
  ALL_FIELDS,
  widgetSupportedSims,
  type CoverageSimId,
  type TelemetryRequirement
} from '../../../../shared/sim-coverage'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { compareCatalogEntries } from '../../../../shared/catalog-order'
import { HIFI_WIDGETS, hifiWidgetTags } from '../../hifi/widgets/registry'
// v2.40 extra widget variants (separate files; they import nx from ./widget-nx so
// there is NO import cycle back into this module). Added as a WIDGET_CATALOG category.
import { EXTRA_READOUT_VARIANTS } from './widgets-extra-readouts'
import { EXTRA_GAUGE_VARIANTS } from './widgets-extra-gauges'
import { EXTRA_BAR_VARIANTS } from './widgets-extra-bars'
import { EXTRA_STRATEGY_VARIANTS } from './widgets-extra-strategy'

export const ACCENT = 'var(--accent-primary)'
// Surfaces match the live GT3 widgets: matte black panels with a hairline stroke
// (was blue-gray #101722 / #2B3545, which read "decorative dashboard" not "cluster").
export const GT3_PANEL = '#000000'
export const GT3_STROKE = '#1F1F1F'
export const TEXT_FG = '#f6fbff'
export const TEXT_DIM = '#9aa6b2'

// Warm chrome accents are the DEFAULT for decorative category/widget accents
// (amber/gold/orange/dim). Cool/green is reserved for LIVE measured "good" states
// only (e.g. a fuel ring that is actually comfortable), never as a static accent.
const GOLD = '#D4A000'
const AMBER = '#FFB000'
const ORANGE = '#FF7A00'
const CHROME = '#C9C5BC'
const CHROME_DIM = '#9A8C6E'
const GREEN = '#2FFF67'
const CYAN = '#00E7FF'
const RED = '#FF2436'
const BLUE = '#158BFF'

export interface WidgetVariant {
  id: string
  label: string
  hint?: string
  type: DashboardElementType
  w: number
  h: number
  binding?: string
  style: DashboardElement['style']
  /** Telemetry domain / role — sections the gallery and powers category chips. */
  category?: WidgetCategoryTag
  /** Visual form — powers style chips (named `styleFamily` to avoid clashing with
   *  the existing element `style` object on this same interface). */
  styleFamily?: WidgetStyleFamily
  /** Free-form search tags (matched alongside label/category/style). */
  tags?: string[]
  /** Hardware/use-case cluster (real-dashboard grouping axis — see taxonomy). */
  cluster?: WidgetClusterTag
  /** Optional manufacturer-inspired style family (cosmetic, search-only). */
  hardwareFamily?: WidgetHardwareFamily
  /** For `type: 'overlaywidget'` full-frame dashboards — which registered overlay
   *  widget (WIDGET_COMPONENTS[widgetId]) to mount inside the placed element. */
  widgetId?: OverlayWidgetId
  /** Dynamic hi-fi module id for `widgetId: hifi:<id>` overlay widgets. */
  hifiModuleId?: string
  /** Explicit coverage requirements for composite/hi-fi widgets. */
  telemetryRequires?: TelemetryRequirement[]
  /** Alternative AND-groups; support requires the primary group OR any alternative. */
  telemetryAlternativeRequires?: TelemetryRequirement[][]
  /** Generated/secondary entry (raw iRacing channel tile) demoted behind the
   *  collapsed "Advanced iRacing Channels" section in the gallery. */
  advanced?: boolean
  /** Campos de telemetria ainda not fornecidos por todos os provedores. */
  missing?: string
  catalogOrder?: number
  releasedAt?: string
  priority?: number
}

export interface WidgetCategory {
  id: string
  label: string
  variants: WidgetVariant[]
  /** Dryndary group (the generated iRacing channel catalogues) — rendered in a
   *  collapsed/secondary accordion so curated GT3 widgets lead. */
  advanced?: boolean
}

// A fully-categorised variant (category + styleFamily guaranteed). The gallery
// and tests operate on these so every entry is searchable/filterable.
export type NormalizedVariant = WidgetVariant & {
  category: WidgetCategoryTag
  styleFamily: WidgetStyleFamily
  /** Playable sims whose live telemetry can drive this variant (see sim-coverage). */
  supportedSims: CoverageSimId[]
}

export function filterHiddenVariants<T extends { id: string }>(variants: readonly T[], hiddenIds: ReadonlySet<string>): T[] {
  return variants.filter((variant) => !hiddenIds.has(variant.id))
}

// ─── Per-yes coverage ────────────────────────────────────────────────────────
// Each variant binds telemetry via `binding`. We derive the single TelemetrySnapshot
// ROOT field it needs so the gallery can label / filter by which live sims drive it:
//   • `ir:<id>`        → IRACING_VARIABLES[id].telemetryField (e.g. 'tyres.lf.tempC'),
//                        whose ROOT segment ('tyres') is the keyof TelemetrySnapshot.
//   • `var:` / `expr:` → expression-driven, no single field → no yes requirement.
//   • bare field name  → that TelemetrySnapshot field directly (round-7 widgets),
//                        when it is a real key; derived preview names (e.g. 'rpmPct',
//                        'gearLabel') resolve to no requirement.
//   • no binding       → no requirement.
// A variant with no field requirement is available on every PLAYABLE_SIM; otherwise
// only on the sims whose live coverage includes that field.
type TelemetryField = keyof TelemetrySnapshot

const TELEMETRY_FIELD_SET: ReadonlySet<string> = new Set<string>(ALL_FIELDS as readonly string[])

// A telemetryField may be a dotted path into a structured field (e.g. 'tyres.lf.tempC',
// 'flags.yellow', 'pit.svStatus'); the coverage model keys on the ROOT object field,
// so we resolve to the first segment and keep it only when it's a real snapshot key.
function rootTelemetryField(name: string | undefined | null): TelemetryField | null {
  if (!name) return null
  const root = name.split('.')[0]
  return TELEMETRY_FIELD_SET.has(root) ? (root as TelemetryField) : null
}

/** Preview/derived binding aliases (not real TelemetrySnapshot keys) whose per-yes
 *  availability differs from "all sims". Only `shiftPct` needs this: it resolves from
 *  shiftIndicatorPct (iRacing-only live), so without the map it would wrongly badge as
 *  "all sims". The sibling aliases (rpmPct/gearLabel/fuelPct) map to universally-
 *  available fields, so leaving them field-less already yields the correct "all sims". */
const PREVIEW_ALIAS_FIELD: Record<string, TelemetryField> = {
  shiftPct: 'shiftIndicatorPct'
}

// Semantic element types that render directly from the snapshot (no `ir:` binding) but
// still need a SIM-RESTRICTED field — so the per-yes filter/badge is accurate. Types
// that only need universal fields (gear/speed/rpm/fuel level) are intentionally absent
// (→ "all sims"). AI/predictor types (pred-*, coach-*, engineer-feed) are app-derived
// → absent → available everywhere.
const TYPE_REQUIRED_FIELD: Partial<Record<DashboardElementType, TelemetryField>> = {
  tyregrid: 'tyres',
  cornerstack: 'tyres',
  heatmap: 'tyres',
  standings: 'drivers',
  positiongaps: 'relatives',
  weather: 'trackTempC',
  enginetemps: 'waterTempC',
  deltatile: 'deltaToBestSec',
  laptiming: 'deltaToBestSec',
  shiftlights: 'shiftIndicatorPct',
  setupstrip: 'absLevel',
  fuelstint: 'fuelPerLap'
}

/** The single TelemetrySnapshot field a variant requires, or `null` when it needs
 *  nothing yes-specific. Prefers the binding's field; falls back to a semantic
 *  element-type requirement (tyregrid→tyres, standings→drivers, …). */
export function variantRequiredField(variant: { binding?: string; type?: DashboardElementType }): TelemetryField | null {
  const binding = variant.binding
  if (binding && !binding.startsWith('var:') && !binding.startsWith('expr:')) {
    if (binding.startsWith('ir:')) {
      const def = IRACING_VARIABLES.find((v) => v.id === binding.slice(3))
      const field = rootTelemetryField(def?.telemetryField)
      if (field) return field
    } else {
      const field = PREVIEW_ALIAS_FIELD[binding] ?? rootTelemetryField(binding)
      if (field) return field
    }
  }
  return (variant.type && TYPE_REQUIRED_FIELD[variant.type]) ?? null
}

/** The PLAYABLE_SIMS whose live telemetry can drive `variant` (all of them when the
 *  variant has no field requirement). Powers the gallery's per-yes badge + filter.
 *  An `ir:<id>` binding whose iRacing variable has NO unified telemetryField is an
 *  iRacing-exclusive channel (only the iRacing provider fills the `var:` namespace it
 *  reads), so it is restricted to iRacing rather than mislabeled "all sims". */
export function variantSupportedSims(variant: {
  binding?: string
  type?: DashboardElementType
  telemetryRequires?: TelemetryRequirement[]
  telemetryAlternativeRequires?: TelemetryRequirement[][]
}): CoverageSimId[] {
  if (
    (variant.telemetryRequires?.length ?? 0) > 0 ||
    (variant.telemetryAlternativeRequires?.length ?? 0) > 0
  ) {
    return widgetSupportedSims(
      variant.telemetryRequires,
      variant.telemetryAlternativeRequires
    )
  }
  const field = variantRequiredField(variant)
  if (field) return widgetSupportedSims([field])
  const binding = variant.binding
  if (binding && binding.startsWith('ir:')) return ['iracing']
  return widgetSupportedSims(undefined)
}

function gt3(extra: Partial<DashboardElement['style']> = {}): DashboardElement['style'] {
  // No `fontFamily`: the ValueWidget now picks the value font by CONTENT
  // (numeric→DSEG, text→condensed). Setting Segoe UI here forced every value tile
  // into the same sans-serif look (the catalog "sameness" root cause).
  return { background: GT3_PANEL, border: GT3_STROKE, borderWidth: 1, radius: 12, color: TEXT_FG, ...extra }
}

interface CuratedMeta {
  cluster?: WidgetClusterTag
  hardwareFamily?: WidgetHardwareFamily
}

function curated(
  id: string,
  label: string,
  type: DashboardElementType,
  w: number,
  h: number,
  accent = ACCENT,
  extra: Partial<DashboardElement['style']> = {},
  meta: CuratedMeta = {}
): WidgetVariant {
  return {
    id,
    label,
    type,
    w,
    h,
    cluster: meta.cluster,
    hardwareFamily: meta.hardwareFamily,
    style: gt3({ accentColor: accent, label, reference: 'LIVE', minFontSize: 10, ...extra })
  }
}

// ─── Catalogo gerado de channels iRacing ───────────────────────────────────────
// Decorative category accents are WARM CHROME (amber/gold/orange/dim). Cool/green
// is intentionally absent here — it is reserved for live measured good-states.
const IRACING_ACCENT: Record<string, string> = {
  car: AMBER,
  inputs: CHROME,
  timing: GOLD,
  session: AMBER,
  standings: GOLD,
  fuel: GOLD,
  tyres: AMBER,
  weather: CHROME_DIM,
  flags: AMBER,
  pit: ORANGE,
  controls: CHROME_DIM,
  damage: RED
}

// Maps an iRacing channel category to the hardware/use-case cluster the channel
// belongs to, so the demoted raw tiles stay searchable by real-dashboard grouping.
const IRACING_CLUSTER_MAP: Record<IracingVarCategory, WidgetClusterTag> = {
  car: 'Engine Vitals',
  inputs: 'Driver Aids',
  timing: 'Timing / Delta',
  session: 'Stint / Endurance',
  standings: 'Radar / Relative',
  fuel: 'Stint / Endurance',
  tyres: 'Tyre / Brake',
  weather: 'Weather / Track',
  flags: 'Race Control / Flags',
  pit: 'Race Control / Flags',
  controls: 'Driver Aids',
  damage: 'Tell-tales / Warning lamps'
}

const BOUNDED_CHANNEL_IDS = new Set<string>([
  'Throttle', 'Brake', 'Clutch', 'ThrottleRaw', 'BrakeRaw', 'ClutchRaw', 'HandbrakeRaw',
  'ShiftIndicatorPct', 'FuelLevelPct', 'LapDistPct', 'TrackWetness', 'TrackGripStatus',
  'dcBrakeBias'
])

// Maps an iRacing channel category to the gallery's domain category taxonomy.
const IRACING_CATEGORY_MAP: Record<IracingVarCategory, WidgetCategoryTag> = {
  car: 'Speed/Engine',
  inputs: 'Inputs',
  timing: 'Timing/Delta',
  session: 'Position/Standings',
  standings: 'Position/Standings',
  fuel: 'Fuel',
  tyres: 'Tyres/Brakes',
  weather: 'Track/Radar',
  flags: 'Flags/Status',
  pit: 'Flags/Status',
  controls: 'Inputs',
  damage: 'Tyres/Brakes'
}

function irValueStyle(def: IracingVarDef): DashboardElement['style'] {
  return {
    background: '#000000',
    borderWidth: 1,
    border: '#1F1F1F',
    radius: 2,
    color: '#F4F4F4',
    // No fontFamily: numerals fall to DSEG via the ValueWidget content-font fix;
    // textual channels render condensed automatically.
    label: def.label,
    suffix: def.unit ?? '',
    minFontSize: 10,
    accentColor: IRACING_ACCENT[def.category] ?? ACCENT
  }
}

function irVariant(def: IracingVarDef, type: DashboardElementType, w: number, h: number, idSuffix = ''): WidgetVariant {
  return {
    id: `ir-${def.id}${idSuffix}`,
    label: def.label,
    hint: `${def.id}${def.unit ? ` · ${def.unit}` : ''}`,
    type,
    w,
    h,
    binding: `ir:${def.id}`,
    style: irValueStyle(def),
    category: IRACING_CATEGORY_MAP[def.category],
    styleFamily: type === 'valuebar' ? 'bar' : 'clean',
    cluster: IRACING_CLUSTER_MAP[def.category],
    advanced: true,
    tags: ['iracing', def.category, def.id.toLowerCase(), 'advanced', 'channel']
  }
}

function buildIracingChannelCategories(): WidgetCategory[] {
  const byCategory = new Map<string, IracingVarDef[]>()
  for (const def of IRACING_VARIABLES) {
    const list = byCategory.get(def.category) ?? []
    list.push(def)
    byCategory.set(def.category, list)
  }
  const cats: WidgetCategory[] = []
  for (const category of IRACING_VAR_CATEGORY_ORDER) {
    const defs = byCategory.get(category)
    if (!defs || defs.length === 0) continue
    cats.push({
      id: `ir-${category}`,
      label: `iRacing · ${IRACING_VAR_CATEGORY_LABELS[category]}`,
      advanced: true,
      variants: defs.map((def) => {
        const type: DashboardElementType = BOUNDED_CHANNEL_IDS.has(def.id) ? 'valuebar' : 'value'
        const h = type === 'valuebar' ? 104 : 96
        return irVariant(def, type, 200, h)
      })
    })
  }
  return cats
}

const IRACING_CHANNEL_CATEGORIES: WidgetCategory[] = buildIracingChannelCategories()

// ─── Round-7 extra widgets (>=50 new variants in varied styles) ──────────────
// Each carries explicit category + styleFamily + tags and binds real telemetry.
function nx(
  id: string,
  label: string,
  type: DashboardElementType,
  w: number,
  h: number,
  category: WidgetCategoryTag,
  styleFamily: WidgetStyleFamily,
  binding: string | undefined,
  style: Partial<DashboardElement['style']>,
  tags: string[] = [],
  missing?: string
): WidgetVariant {
  return { id, label, type, w, h, binding, category, styleFamily, tags, missing, style: gt3({ minFontSize: 10, ...style }) }
}

// ANALOG — needle dials, linear sweep meters, g-force ball
const EXTRA_ANALOG: WidgetVariant[] = [
  nx('ana-speed', 'Speed dial', 'analoggauge', 200, 200, 'Speed/Engine', 'analog', 'speedKmh', { label: 'SPEED', suffix: 'km/h', gaugeMax: 320, accentColor: GOLD, ticks: 8 }, ['speed', 'needle', 'dial']),
  nx('ana-speed-mph', 'Speed dial · mph', 'analoggauge', 200, 200, 'Speed/Engine', 'analog', 'speedMph', { label: 'SPEED', suffix: 'mph', gaugeMax: 200, accentColor: GOLD, ticks: 8 }, ['speed', 'needle', 'mph']),
  nx('ana-rpm', 'RPM dial', 'analoggauge', 200, 200, 'Speed/Engine', 'analog', 'rpm', { label: 'RPM', gaugeMax: 8200, warnAt: 0.8, dangerAt: 0.9, flashAt: 0.97, accentColor: AMBER, ticks: 9 }, ['rpm', 'tacho', 'needle']),
  nx('ana-water', 'Water temp dial', 'analoggauge', 180, 180, 'Speed/Engine', 'analog', 'waterTempC', { label: 'WATER', suffix: '°C', gaugeMin: 40, gaugeMax: 130, warnAt: 0.7, dangerAt: 0.85, accentColor: GOLD }, ['water', 'temp', 'engine']),
  nx('ana-oil', 'Oil temp dial', 'analoggauge', 180, 180, 'Speed/Engine', 'analog', 'oilTempC', { label: 'OIL', suffix: '°C', gaugeMin: 40, gaugeMax: 150, warnAt: 0.7, dangerAt: 0.88, accentColor: GOLD }, ['oil', 'temp', 'engine']),
  nx('ana-oilpress', 'Oil pressure dial', 'analoggauge', 180, 180, 'Speed/Engine', 'analog', 'oilPressureKpa', { label: 'OIL P', suffix: 'kPa', gaugeMax: 700, accentColor: '#C9C5BC' }, ['oil', 'pressure']),
  nx('ana-fuel', 'Fuel dial', 'analoggauge', 180, 180, 'Fuel', 'analog', 'fuelLiters', { label: 'FUEL', suffix: 'L', gaugeMax: 120, accentColor: GREEN }, ['fuel', 'needle']),
  nx('lin-fuel', 'Fuel meter', 'linearmeter', 280, 96, 'Fuel', 'analog', 'fuelLiters', { label: 'FUEL', suffix: 'L', gaugeMax: 120, accentColor: GREEN, ticks: 10 }, ['fuel', 'sweep']),
  nx('lin-speed', 'Speed sweep meter', 'linearmeter', 300, 96, 'Analog', 'analog', 'speedKmh', { label: 'SPEED', suffix: 'km/h', gaugeMax: 320, accentColor: GOLD, ticks: 10 }, ['speed', 'sweep', 'analog']),
  nx('lin-rpm', 'RPM sweep meter', 'linearmeter', 300, 96, 'Analog', 'analog', 'rpm', { label: 'RPM', gaugeMax: 8200, warnAt: 0.8, dangerAt: 0.9, flashAt: 0.97, accentColor: AMBER, ticks: 10 }, ['rpm', 'sweep', 'analog']),
  nx('lin-water', 'Water sweep meter', 'linearmeter', 280, 90, 'Analog', 'analog', 'waterTempC', { label: 'WATER', suffix: '°C', gaugeMin: 40, gaugeMax: 130, warnAt: 0.7, dangerAt: 0.85, accentColor: GOLD, ticks: 9 }, ['water', 'temp', 'analog']),
  nx('gforce', 'G-force meter', 'gforcemeter', 200, 200, 'Analog', 'analog', undefined, { label: 'G-FORCE', gaugeMax: 2, accentColor: AMBER }, ['gforce', 'gg', 'accel', 'analog'])
]

// DIGITAL — 7-segment numerics + clocks
const EXTRA_DIGITAL: WidgetVariant[] = [
  nx('seg-gear', 'Gear · 7-seg', 'segment7', 150, 170, 'Speed/Engine', 'digital', 'gearLabel', { label: 'GEAR', accentColor: AMBER }, ['gear', '7seg', 'digital']),
  nx('seg-speed', 'Speed · 7-seg', 'segment7', 220, 120, 'Speed/Engine', 'digital', 'speedKmh', { label: 'SPEED', accentColor: GOLD }, ['speed', '7seg']),
  nx('seg-rpm', 'RPM · 7-seg', 'segment7', 240, 120, 'Speed/Engine', 'digital', 'rpm', { label: 'RPM', accentColor: AMBER }, ['rpm', '7seg']),
  nx('seg-position', 'Position · 7-seg', 'segment7', 160, 150, 'Position/Standings', 'digital', 'position', { label: 'POS', prefix: 'P', accentColor: AMBER }, ['position', '7seg']),
  nx('seg-laps', 'Laps left · 7-seg', 'segment7', 200, 120, 'Timing/Delta', 'digital', 'lapsRemaining', { label: 'LAPS', accentColor: GOLD }, ['laps', '7seg']),
  nx('clk-current', 'Current lap clock', 'digitalclock', 280, 120, 'Timing/Delta', 'digital', 'currentLapFmt', { label: 'CURRENT', accentColor: CYAN }, ['lap', 'clock', 'time']),
  nx('clk-last', 'Last lap clock', 'digitalclock', 280, 120, 'Timing/Delta', 'digital', 'lastLapFmt', { label: 'LAST', accentColor: CYAN }, ['lap', 'clock', 'time']),
  nx('clk-best', 'Best lap clock', 'digitalclock', 280, 120, 'Timing/Delta', 'digital', 'bestLapFmt', { label: 'BEST', accentColor: GREEN }, ['lap', 'clock', 'best']),
  nx('clk-session', 'Session clock', 'digitalclock', 300, 120, 'Timing/Delta', 'digital', 'sessionTimeLeftFmt', { label: 'TIME LEFT', accentColor: GOLD }, ['session', 'clock', 'time']),
  nx('seg-gear-show', 'Gear (digital showcase)', 'segment7', 180, 200, 'Digital', 'digital', 'gearLabel', { accentColor: AMBER }, ['gear', '7seg', 'showcase']),
  nx('seg-rpm-show', 'RPM (digital showcase)', 'segment7', 260, 130, 'Digital', 'digital', 'rpm', { label: 'RPM', accentColor: GOLD }, ['rpm', '7seg', 'showcase'])
]

// DIGITAL CLEAN — flat oversized numerics with a tiny caption
const EXTRA_CLEAN: WidgetVariant[] = [
  nx('big-speed', 'Big speed', 'bigtext', 240, 140, 'Speed/Engine', 'clean', 'speedKmh', { label: 'KM/H', background: '#000000', border: '#1F1F1F', accentColor: TEXT_FG }, ['speed', 'big', 'clean']),
  nx('big-gear', 'Big gear', 'bigtext', 160, 160, 'Speed/Engine', 'clean', 'gearLabel', { label: 'GEAR', background: '#000000', border: '#1F1F1F', accentColor: AMBER }, ['gear', 'big', 'clean']),
  nx('big-pos', 'Big position', 'bigtext', 200, 140, 'Position/Standings', 'clean', 'position', { label: 'POSITION', prefix: 'P', background: '#000000', border: '#1F1F1F', accentColor: AMBER }, ['position', 'big', 'clean']),
  nx('big-delta', 'Big delta', 'bigtext', 240, 130, 'Timing/Delta', 'clean', 'deltaBestFmt', { label: 'DELTA', background: '#000000', border: '#1F1F1F', accentColor: CYAN }, ['delta', 'big', 'clean']),
  nx('big-fuel', 'Big fuel', 'bigtext', 220, 130, 'Fuel', 'clean', 'fuelLitersStr', { label: 'FUEL', suffix: ' L', background: '#000000', border: '#1F1F1F', accentColor: GREEN }, ['fuel', 'big', 'clean'])
]

// GRAPH — rolling line / area / sparkline
const EXTRA_GRAPH: WidgetVariant[] = [
  nx('graph-speed', 'Speed trace', 'historygraph', 320, 130, 'Charts/Graphs', 'graph', 'speedKmh', { label: 'SPEED', suffix: 'km/h', graphStyle: 'line', accentColor: GOLD, traceLength: 200 }, ['speed', 'trace', 'line']),
  nx('graph-rpm', 'RPM area graph', 'historygraph', 320, 130, 'Charts/Graphs', 'graph', 'rpmPct', { label: 'RPM %', graphStyle: 'area', gaugeMin: 0, gaugeMax: 1, accentColor: AMBER, traceLength: 200 }, ['rpm', 'area', 'graph']),
  nx('graph-throttle', 'Throttle sparkline', 'historygraph', 240, 90, 'Inputs', 'graph', 'throttle', { graphStyle: 'sparkline', gaugeMin: 0, gaugeMax: 1, accentColor: GREEN, traceLength: 160 }, ['throttle', 'sparkline']),
  nx('graph-brake', 'Brake sparkline', 'historygraph', 240, 90, 'Inputs', 'graph', 'brake', { graphStyle: 'sparkline', gaugeMin: 0, gaugeMax: 1, accentColor: RED, traceLength: 160 }, ['brake', 'sparkline']),
  nx('graph-delta', 'Delta history', 'historygraph', 320, 120, 'Timing/Delta', 'graph', 'deltaToSessionBestSec', { label: 'DELTA', suffix: 's', graphStyle: 'line', accentColor: CYAN, traceLength: 240 }, ['delta', 'history', 'line']),
  nx('graph-steer', 'Steering trace', 'historygraph', 300, 110, 'Inputs', 'graph', 'steerAngleDeg', { label: 'STEER', suffix: '°', graphStyle: 'line', accentColor: CYAN, traceLength: 180 }, ['steering', 'trace']),
  nx('graph-gforce', 'Lateral-G trace', 'historygraph', 300, 110, 'Charts/Graphs', 'graph', 'latAccelG', { label: 'LAT G', graphStyle: 'line', accentColor: AMBER, traceLength: 200 }, ['gforce', 'lateral', 'trace']),
  nx('graph-tyre-lf', 'LF tyre temp trace', 'historygraph', 300, 110, 'Tyres/Brakes', 'graph', 'tyreLfTempC', { label: 'LF TEMP', suffix: '°C', graphStyle: 'line', accentColor: '#35F2B8', traceLength: 220 }, ['tyre', 'temp', 'history'])
]

// CHART — bar / radial / donut / segmented
const EXTRA_CHART: WidgetVariant[] = [
  nx('chart-tyre-temp', 'Tyre temp bars', 'barchart', 260, 180, 'Tyres/Brakes', 'chart', undefined, { label: 'TYRE °C', chartSource: 'tyreTemp' }, ['tyre', 'temp', 'bars']),
  nx('chart-tyre-press', 'Tyre pressure bars', 'barchart', 260, 180, 'Tyres/Brakes', 'chart', undefined, { label: 'PRESSURE', chartSource: 'tyrePressure' }, ['tyre', 'pressure', 'bars']),
  nx('chart-tyre-wear', 'Tyre wear bars', 'barchart', 260, 180, 'Tyres/Brakes', 'chart', undefined, { label: 'WEAR', chartSource: 'tyreWear' }, ['tyre', 'wear', 'bars'], 'Wear depends on yes'),
  nx('chart-brake-temp', 'Brake temp bars', 'barchart', 260, 180, 'Tyres/Brakes', 'chart', undefined, { label: 'BRAKE °C', chartSource: 'brakeTemp' }, ['brake', 'temp', 'bars'], 'Brake temp depends on yes'),
  nx('chart-inputs', 'Inputs bars', 'barchart', 220, 170, 'Inputs', 'chart', undefined, { label: 'INPUTS', chartSource: 'inputs' }, ['throttle', 'brake', 'clutch', 'bars']),
  nx('radial-tyre-wear', 'Tyre wear rings', 'radialbars', 220, 220, 'Tyres/Brakes', 'chart', undefined, { label: 'WEAR', chartSource: 'tyreWear' }, ['tyre', 'wear', 'radial', 'rings'], 'Wear depends on yes'),
  nx('radial-inputs', 'Inputs rings', 'radialbars', 200, 200, 'Inputs', 'chart', undefined, { label: 'INPUTS', chartSource: 'inputs' }, ['inputs', 'radial', 'rings']),
  nx('donut-fuel', 'Fuel donut', 'donut', 180, 180, 'Fuel', 'chart', 'fuelPct', { label: 'FUEL', accentColor: GREEN }, ['fuel', 'donut', 'pie']),
  nx('donut-lap', 'Lap progress donut', 'donut', 180, 180, 'Track/Radar', 'chart', 'lapDistPct', { label: 'LAP', accentColor: CYAN }, ['lap', 'progress', 'donut']),
  nx('donut-wetness', 'Track wetness donut', 'donut', 180, 180, 'Track/Radar', 'chart', 'trackWetnessPct', { label: 'WET', accentColor: CYAN }, ['wet', 'rain', 'donut']),
  nx('seg-throttle', 'Throttle segment bar', 'segmentbars', 280, 90, 'Inputs', 'bar', 'throttle', { label: 'THROTTLE', segments: 16, accentColor: GREEN }, ['throttle', 'segments', 'bar']),
  nx('seg-rpm-bar', 'RPM segment bar', 'segmentbars', 320, 80, 'Speed/Engine', 'bar', 'rpmPct', { label: 'RPM', segments: 20, warnAt: 0.6, dangerAt: 0.85, flashAt: 0.97, accentColor: GREEN }, ['rpm', 'segments', 'bar']),
  nx('seg-fuel-bar', 'Fuel segment bar', 'segmentbars', 280, 90, 'Fuel', 'bar', 'fuelPct', { label: 'FUEL', segments: 16, accentColor: GREEN }, ['fuel', 'segments', 'bar'])
]

// RING — thick arc gauges
const EXTRA_RING: WidgetVariant[] = [
  nx('ring-rpm', 'RPM ring', 'ringgauge', 180, 180, 'Speed/Engine', 'ring', 'rpmPct', { label: 'RPM', warnAt: 0.8, dangerAt: 0.9, flashAt: 0.97, accentColor: GOLD, ringThickness: 10 }, ['rpm', 'ring', 'arc']),
  nx('ring-fuel', 'Fuel ring', 'ringgauge', 180, 180, 'Fuel', 'ring', 'fuelPct', { label: 'FUEL', suffix: '%', accentColor: GREEN }, ['fuel', 'ring', 'arc']),
  nx('ring-throttle', 'Throttle ring', 'ringgauge', 170, 170, 'Inputs', 'ring', 'throttle', { label: 'THR', suffix: '%', accentColor: GREEN }, ['throttle', 'ring']),
  nx('ring-grip', 'Grip ring', 'ringgauge', 170, 170, 'Track/Radar', 'ring', 'gripPct', { label: 'GRIP', suffix: '%', accentColor: GREEN }, ['grip', 'ring']),
  nx('ring-wetness', 'Wetness ring', 'ringgauge', 170, 170, 'Track/Radar', 'ring', 'trackWetnessPct', { label: 'WET', suffix: '%', accentColor: CYAN }, ['wet', 'rain', 'ring'])
]

// LED — generic segmented LED bars
const EXTRA_LED: WidgetVariant[] = [
  nx('led-rpm-h', 'RPM LED bar', 'ledbar', 360, 56, 'Speed/Engine', 'led', 'rpmPct', { label: 'RPM', segments: 18, warnAt: 0.6, dangerAt: 0.85, flashAt: 0.97, accentColor: GREEN, orientation: 'h' }, ['rpm', 'led', 'shift']),
  nx('led-throttle-v', 'Throttle LED column', 'ledbar', 80, 200, 'Inputs', 'led', 'throttle', { label: 'THR', segments: 14, accentColor: GREEN, orientation: 'v' }, ['throttle', 'led', 'vertical']),
  nx('led-brake-v', 'Brake LED column', 'ledbar', 80, 200, 'Inputs', 'led', 'brake', { label: 'BRK', segments: 14, accentColor: RED, orientation: 'v' }, ['brake', 'led', 'vertical']),
  nx('led-fuel-h', 'Fuel LED bar', 'ledbar', 300, 50, 'Fuel', 'led', 'fuelPct', { label: 'FUEL', segments: 16, accentColor: GREEN, orientation: 'h' }, ['fuel', 'led'])
]

// HEATMAP — 2×2 tyre/brake heat cells
const EXTRA_HEATMAP: WidgetVariant[] = [
  nx('heat-tyre', 'Tyre heatmap', 'heatmap', 220, 220, 'Tyres/Brakes', 'heatmap', undefined, { label: 'TYRE °C', heatSource: 'tyre' }, ['tyre', 'temp', 'heatmap']),
  nx('heat-brake', 'Brake heatmap', 'heatmap', 220, 220, 'Tyres/Brakes', 'heatmap', undefined, { label: 'BRAKE °C', heatSource: 'brake' }, ['brake', 'temp', 'heatmap'], 'Brake temp depends on yes')
]

// STATUS — icon/status lamps
const EXTRA_STATUS: WidgetVariant[] = [
  nx('lamp-abs', 'ABS lamp', 'statuslamp', 160, 90, 'Flags/Status', 'status', undefined, { statusKind: 'abs', accentColor: AMBER }, ['abs', 'lamp', 'status']),
  nx('lamp-tc', 'TC lamp', 'statuslamp', 160, 90, 'Flags/Status', 'status', undefined, { statusKind: 'tc', accentColor: BLUE }, ['tc', 'lamp', 'status']),
  nx('lamp-drs', 'DRS lamp', 'statuslamp', 160, 90, 'Flags/Status', 'status', undefined, { statusKind: 'drs', accentColor: GREEN }, ['drs', 'lamp', 'status']),
  nx('lamp-pit', 'Pit limiter lamp', 'statuslamp', 180, 90, 'Flags/Status', 'status', undefined, { statusKind: 'pit', accentColor: BLUE }, ['pit', 'limiter', 'lamp']),
  nx('lamp-flag', 'Flag lamp', 'statuslamp', 200, 90, 'Flags/Status', 'status', undefined, { statusKind: 'flag', accentColor: GREEN }, ['flag', 'lamp', 'status']),
  nx('lamp-rain', 'Rain lamp', 'statuslamp', 160, 90, 'Flags/Status', 'status', undefined, { statusKind: 'rain', accentColor: CYAN }, ['rain', 'weather', 'lamp'])
]

// Flat list of the round-7 NEW variants (used by the gallery + tests).
export const NEW_VARIANTS: WidgetVariant[] = [
  ...EXTRA_ANALOG,
  ...EXTRA_DIGITAL,
  ...EXTRA_CLEAN,
  ...EXTRA_GRAPH,
  ...EXTRA_CHART,
  ...EXTRA_RING,
  ...EXTRA_LED,
  ...EXTRA_HEATMAP,
  ...EXTRA_STATUS
]

// New widget KINDS introduced this round (custom-drawn components).
export const NEW_WIDGET_KINDS: DashboardElementType[] = [
  'analoggauge', 'linearmeter', 'gforcemeter', 'segment7', 'digitalclock', 'bigtext',
  'historygraph', 'barchart', 'radialbars', 'donut', 'segmentbars', 'ringgauge',
  'ledbar', 'heatmap', 'statuslamp'
]

// ─── Full-frame dashboards (overlay-widget presets surfaced in the catalog) ───
// The full-screen dashboard widgets ship as BUILTIN_PRESETS (each an
// `overlaywidget` element mounting WIDGET_COMPONENTS[widgetId]). They were absent
// from the gallery, leaving the 'Full-Frame Dashboards' cluster empty. We surface
// them here as curated catalog variants tagged to that cluster: adding one drops a
// single full-canvas `overlaywidget` element bound to the right widget id. Most are
// telemetry-driven with no identity requirement; RC-01 is explicitly limited to
// providers that expose its live-session identity contract.
const RC_IDENTITY_REQUIRES: TelemetryRequirement[] = ['sessionUniqueId']
const RC_IDENTITY_ALTERNATIVES: TelemetryRequirement[][] = [['replayContext']]
/** RaceCon full-frame dashboards refuse mock/replay feeds, so they need live-session identity. */
const IDENTITY_SCOPED_WIDGET_IDS = new Set<string>(['raceconRc01Dash', 'raceconRc02Dash', 'raceconRc04Dash'])

function fullFrameVariant(preset: (typeof OVERLAY_DASHBOARD_PRESETS)[number]): WidgetVariant {
  const identityScoped = IDENTITY_SCOPED_WIDGET_IDS.has(preset.widgetId)
  return {
    id: `dash-${preset.id}`,
    label: preset.name,
    hint: preset.description,
    type: 'overlaywidget',
    widgetId: preset.widgetId,
    telemetryRequires: identityScoped ? RC_IDENTITY_REQUIRES : undefined,
    telemetryAlternativeRequires: identityScoped ? RC_IDENTITY_ALTERNATIVES : undefined,
    w: 1024,
    h: 600,
    category: 'Speed/Engine',
    styleFamily: 'clean',
    cluster: 'Full-Frame Dashboards',
    tags: ['fullframe', 'dashboard', 'fullscreen', ...preset.tags],
    style: gt3({ background: '#000000', border: '#1F1F1F', borderWidth: 0, radius: 0, label: preset.name })
  }
}

const FULL_FRAME_VARIANTS: WidgetVariant[] = OVERLAY_DASHBOARD_PRESETS.map(fullFrameVariant)

// ─── New-signal overlays surfaced in the dashboard catalog ───────────────────
// Each new iRacing telemetry signal ships a dedicated overlay widget; we ALSO surface
// it here as an `overlaywidget` catalog variant so a single click drops the live overlay
// onto a dashboard. The variant's `binding` is the snapshot field the overlay reads — it
// is ignored by the overlaywidget renderer (which mounts by `widgetId`) but drives the
// per-yes coverage helper (variantRequiredField → widgetSupportedSims), so the gallery
// badges/filters it to the sims that actually publish the field (iRacing here). The label
// reuses overlayWidgetDisplayTitle so it carries the same "(IR)" support prefix as the
// floating-overlay picker.
const OVERLAY_DEF_BY_ID = new Map(OVERLAY_WIDGETS.map((def) => [def.id, def]))

function signalOverlayVariant(
  widgetId: OverlayWidgetId,
  binding: TelemetryField,
  cluster: WidgetClusterTag,
  w: number,
  h: number,
  tags: string[]
): WidgetVariant {
  const def = OVERLAY_DEF_BY_ID.get(widgetId)
  const label = def ? overlayWidgetDisplayTitle(def) : widgetId
  return {
    id: `signal-${widgetId}`,
    label,
    hint: def?.description,
    type: 'overlaywidget',
    widgetId,
    binding,
    w,
    h,
    category: 'Flags/Status',
    styleFamily: 'status',
    cluster,
    tags: ['overlay', 'signal', ...tags],
    style: gt3({ background: '#000000', border: '#1F1F1F', borderWidth: 0, radius: 0, label })
  }
}

const SIGNAL_OVERLAY_VARIANTS: WidgetVariant[] = [
  signalOverlayVariant('engineTellTales', 'engineWarnings', 'Tell-tales / Warning lamps', 360, 200, ['engine', 'warning', 'lamp', 'telltale', 'fia']),
  signalOverlayVariant('absCut', 'absCutPct', 'Driver Aids', 300, 96, ['abs', 'brake', 'cut', 'gauge']),
  signalOverlayVariant('sessionBanner', 'sessionState', 'Race Control / Flags', 320, 110, ['session', 'state', 'phase', 'racing', 'banner']),
  signalOverlayVariant('paceRestart', 'paceMode', 'Race Control / Flags', 360, 150, ['pace', 'restart', 'formation', 'flag']),
  signalOverlayVariant('sideProximity', 'carLeftRightCount', 'Radar / Relative', 320, 140, ['radar', 'proximity', 'blindspot', 'side', '3-wide']),
  signalOverlayVariant('trackMapNav3D', 'lapDistPct', 'Radar / Relative', 680, 400, ['3d', 'nav', 'map', 'track-up', 'waze', 'position'])
]

// ─── GT3 instrument-style cluster widgets surfaced in the dashboard catalog ───
// Each GT3 instrument widget (analog tach, Cup cluster, endurance multifunction, OLED
// strip, MoTeC panel, wheel face) is ALSO a placeable dashboard widget. Like the
// signal overlays we surface them as `overlaywidget` variants mounting WIDGET_COMPONENTS
// by id; the `binding` is a single representative field so the gallery badges/filters
// each to the same sims as its overlay-picker entry. The label reuses
// overlayWidgetDisplayTitle, carrying the same "(IR/…)" support prefix.
function gt3InstrumentVariant(
  widgetId: OverlayWidgetId,
  binding: TelemetryField,
  cluster: WidgetClusterTag,
  category: WidgetCategoryTag,
  w: number,
  h: number,
  tags: string[]
): WidgetVariant {
  const def = OVERLAY_DEF_BY_ID.get(widgetId)
  const label = def ? overlayWidgetDisplayTitle(def) : widgetId
  return {
    id: `gt3-${widgetId}`,
    label,
    hint: def?.description,
    type: 'overlaywidget',
    widgetId,
    binding,
    w,
    h,
    category,
    styleFamily: 'digital',
    cluster,
    tags: ['overlay', 'gt3', 'instrument', 'cluster', ...tags],
    style: gt3({ background: '#000000', border: '#1F1F1F', borderWidth: 0, radius: 0, label })
  }
}

const GT3_INSTRUMENT_VARIANTS: WidgetVariant[] = [
  gt3InstrumentVariant('analogTach', 'rpm', 'DDU / Cluster', 'Speed/Engine', 240, 260, ['tach', 'tachometer', 'analog', 'needle', 'rpm', 'gear']),
  gt3InstrumentVariant('cupCluster', 'rpm', 'DDU / Cluster', 'Speed/Engine', 300, 300, ['cup', 'porsche', 'rev', 'led', 'gear', 'delta']),
  gt3InstrumentVariant('enduranceMulti', 'tyres', 'Stint / Endurance', 'Fuel', 380, 320, ['endurance', 'stint', 'fuel', 'tyre', 'pressure', 'multifunction']),
  gt3InstrumentVariant('oledStrip', 'speedKmh', 'DDU / Cluster', 'Speed/Engine', 720, 72, ['oled', 'strip', 'minimal', 'narrow', 'gear', 'speed']),
  gt3InstrumentVariant('motecDense', 'rpm', 'DDU / Cluster', 'Digital', 420, 260, ['motec', 'aim', 'cosworth', 'dense', 'data', 'panel']),
  gt3InstrumentVariant('gt3Wheel', 'tcLevel', 'Driver Aids', 'Flags/Status', 360, 240, ['wheel', 'steering', 'telltale', 'tc', 'abs', 'map', 'bb', 'knob'])
]

const HIFI_CATEGORY_MAP: Record<string, WidgetCategoryTag> = {
  inputs: 'Inputs',
  drive: 'Speed/Engine',
  engine: 'Speed/Engine',
  timing: 'Timing/Delta',
  gaps: 'Position/Standings',
  standings: 'Position/Standings',
  fuel: 'Fuel',
  tyres: 'Tyres/Brakes',
  brakesEngine: 'Speed/Engine',
  sessionEnv: 'Flags/Status',
  session: 'Flags/Status',
  weather: 'Flags/Status',
  pit: 'Flags/Status',
  map: 'Track/Radar',
  identity: 'Text/Image',
  ai: 'Text/Image'
}

const HIFI_CLUSTER_MAP: Record<string, WidgetClusterTag> = {
  inputs: 'DDU / Cluster',
  drive: 'DDU / Cluster',
  engine: 'Engine Vitals',
  timing: 'Timing / Delta',
  gaps: 'Radar / Relative',
  standings: 'Radar / Relative',
  fuel: 'Stint / Endurance',
  tyres: 'Tyre / Brake',
  brakesEngine: 'Engine Vitals',
  sessionEnv: 'Race Control / Flags',
  session: 'Race Control / Flags',
  weather: 'Weather / Track',
  pit: 'Stint / Endurance',
  map: 'Weather / Track',
  identity: 'DDU / Cluster',
  ai: 'Race Control / Flags'
}

function hifiHasTag(module: (typeof HIFI_WIDGETS)[number], tag: string): boolean {
  return module.tags.includes(tag)
}

function hifiStyleFamily(module: (typeof HIFI_WIDGETS)[number]): WidgetStyleFamily {
  if (hifiHasTag(module, 'table')) return 'table'
  if (hifiHasTag(module, 'corner-grid')) return 'heatmap'
  if (hifiHasTag(module, 'vector') || hifiHasTag(module, 'radar')) return 'graph'
  if (hifiHasTag(module, 'track-map')) return 'chart'
  if (hifiHasTag(module, 'status') || hifiHasTag(module, 'indicator')) return 'status'
  if (hifiHasTag(module, 'radial')) return 'gauge'
  if (hifiHasTag(module, 'linear')) return 'bar'
  if (hifiHasTag(module, 'digital') || hifiHasTag(module, 'bignum')) return 'digital'
  return 'clean'
}

function hifiCluster(module: (typeof HIFI_WIDGETS)[number]): WidgetClusterTag {
  if (hifiHasTag(module, 'radar') || hifiHasTag(module, 'relative')) {
    return 'Radar / Relative'
  }
  if (hifiHasTag(module, 'corner-grid')) return 'Tyre / Brake'
  if (hifiHasTag(module, 'track-map')) return 'Weather / Track'
  if (hifiHasTag(module, 'status') || hifiHasTag(module, 'indicator')) {
    return 'Tell-tales / Warning lamps'
  }
  return HIFI_CLUSTER_MAP[module.category] ?? 'DDU / Cluster'
}

function hifiVariantAccent(module: (typeof HIFI_WIDGETS)[number]): string {
  if (hifiHasTag(module, 'futuristic')) return '#35C8E8'
  if (hifiHasTag(module, 'ddu')) return '#FFB000'
  return '#F5F7FA'
}

function toHifiCatalogVariant(module: (typeof HIFI_WIDGETS)[number]): WidgetVariant {
  const generatedVariant = hifiHasTag(module, 'telemetry-framework')
  const accent = hifiVariantAccent(module)
  return {
    id: `hifi-${module.id}`,
    label: module.title,
    hint: module.description,
    type: 'overlaywidget',
    widgetId: `hifi:${module.id}`,
    hifiModuleId: module.id,
    binding: module.requires[0],
    telemetryRequires: [...module.requires],
    telemetryAlternativeRequires: module.alternativeRequires?.map((group) => [...group]),
    w: Math.max(160, Math.round(module.defaultSize.w)),
    h: Math.max(70, Math.round(module.defaultSize.h)),
    category: HIFI_CATEGORY_MAP[module.category] ?? 'Digital',
    styleFamily: hifiStyleFamily(module),
    cluster: hifiCluster(module),
    tags: ['hifi', 'overlay', module.category, ...hifiWidgetTags(module)],
    catalogOrder: module.catalogOrder,
    releasedAt: module.releasedAt,
    priority: module.priority,
    style: gt3({
      background: generatedVariant ? 'transparent' : '#000000',
      border: generatedVariant ? 'transparent' : '#1F1F1F',
      borderWidth: 0,
      radius: 0,
      accentColor: accent,
      fillColor: accent,
      warnColor: '#FFB020',
      dangerColor: '#FF3B30',
      label: module.title
    })
  }
}

const TELEMETRY_FRAMEWORK_VARIANTS: WidgetVariant[] = HIFI_WIDGETS
  .filter((module) => hifiHasTag(module, 'telemetry-framework'))
  .map(toHifiCatalogVariant)

const HIFI_WIDGET_VARIANTS: WidgetVariant[] = HIFI_WIDGETS
  .filter((module) => !hifiHasTag(module, 'telemetry-framework'))
  .map(toHifiCatalogVariant)

// ─── Catalogo ────────────────────────────────────────────────────────────────
export const WIDGET_CATALOG: WidgetCategory[] = [
  {
    id: 'telemetry-style-variants',
    label: 'Telemetry · Competition / Futuristic / DDU',
    variants: TELEMETRY_FRAMEWORK_VARIANTS
  },
  {
    id: 'hifi-per-telemetry',
    label: 'Hi-Fi · per telemetry',
    variants: HIFI_WIDGET_VARIANTS
  },
  {
    id: 'full-frame',
    label: 'Dashboards full-frame',
    variants: FULL_FRAME_VARIANTS
  },
  {
    id: 'signal-overlays',
    label: 'Signal overlays (new iRacing channels)',
    variants: SIGNAL_OVERLAY_VARIANTS
  },
  {
    id: 'gt3-instruments',
    label: 'GT3 instruments (clusters)',
    variants: GT3_INSTRUMENT_VARIANTS
  },
  {
    id: 'clean-value',
    label: 'Clean values (any channel)',
    variants: [
      { id: 'value-speed', label: 'Value · Speed', type: 'value', w: 200, h: 96, binding: 'ir:Speed', category: 'Speed/Engine', styleFamily: 'clean', style: { background: '#000000', border: '#1F1F1F', borderWidth: 1, radius: 2, color: '#F4F4F4', label: 'SPEED', suffix: 'km/h', accentColor: '#00E7FF', minFontSize: 10 } },
      { id: 'value-gear', label: 'Value · Gear', type: 'value', w: 140, h: 140, binding: 'gearLabel', category: 'Speed/Engine', styleFamily: 'clean', style: { background: '#000000', border: '#1F1F1F', borderWidth: 1, radius: 2, color: '#F4F4F4', label: 'GEAR', accentColor: 'var(--accent-warning)', minFontSize: 12, maxFontSize: 120 } },
      { id: 'valuebar-throttle', label: 'Value bar · Throttle', type: 'valuebar', w: 200, h: 104, binding: 'throttle', category: 'Inputs', styleFamily: 'bar', style: { background: '#000000', border: '#1F1F1F', borderWidth: 1, radius: 2, color: '#F4F4F4', label: 'THROTTLE', suffix: '%', accentColor: '#2FFF67', minFontSize: 10 } },
      { id: 'valuebar-brake', label: 'Value bar · Brake', type: 'valuebar', w: 200, h: 104, binding: 'brake', category: 'Inputs', styleFamily: 'bar', style: { background: '#000000', border: '#1F1F1F', borderWidth: 1, radius: 2, color: '#F4F4F4', label: 'BRAKE', suffix: '%', accentColor: '#FF2436', minFontSize: 10 } },
      { id: 'valuegauge-rpm', label: 'Value gauge · RPM %', type: 'valuegauge', w: 150, h: 150, binding: 'rpmPct', category: 'Speed/Engine', styleFamily: 'gauge', style: { background: '#000000', borderWidth: 0, radius: 2, color: '#F4F4F4', label: 'RPM %', suffix: '%', accentColor: '#FFB000', warnAt: 0.55, dangerAt: 0.8, minFontSize: 10 } },
      { id: 'valuegauge-fuel', label: 'Value gauge · Fuel %', type: 'valuegauge', w: 150, h: 150, binding: 'fuelPct', category: 'Fuel', styleFamily: 'gauge', style: { background: '#000000', borderWidth: 0, radius: 2, color: '#F4F4F4', label: 'FUEL', accentColor: '#2FFF67', minFontSize: 10 } }
    ]
  },
  {
    id: 'gt3',
    label: 'GT3 Main',
    variants: [
      { id: 'shiftbar-18', label: 'Shift Bar · 18 LED', type: 'shiftbar', w: 760, h: 44, binding: 'shiftPct', category: 'Speed/Engine', styleFamily: 'led', cluster: 'DDU / Cluster', hardwareFamily: 'MoTeC C127', style: gt3({ segments: 18, flashAt: 0.98, glow: true, segmentShape: 'led', radius: 8 }) },
      { id: 'shiftbar-12', label: 'Shift Bar · 12 LED', type: 'shiftbar', w: 600, h: 48, binding: 'shiftPct', category: 'Speed/Engine', styleFamily: 'led', cluster: 'DDU / Cluster', hardwareFamily: 'Bosch DDU 296', style: gt3({ segments: 12, flashAt: 0.97, glow: true, segmentShape: 'led', radius: 8 }) },
      { id: 'shiftbar-24', label: 'Shift Bar · 24 thin', type: 'shiftbar', w: 900, h: 40, binding: 'shiftPct', category: 'Speed/Engine', styleFamily: 'led', cluster: 'DDU / Cluster', hardwareFamily: 'Cosworth ICD', style: gt3({ segments: 24, flashAt: 0.98, glow: true, segmentShape: 'bar', radius: 6 }) },
      { id: 'gearcluster', label: 'Gear + Speed', type: 'gearcluster', w: 320, h: 240, category: 'Speed/Engine', styleFamily: 'digital', cluster: 'DDU / Cluster', hardwareFamily: 'MoTeC C127', style: gt3({ radius: 18, accentColor: ACCENT, showRpm: true }) },
      { id: 'gearcluster-tile', label: 'Gear (tile)', type: 'gearcluster', w: 200, h: 180, category: 'Speed/Engine', styleFamily: 'digital', cluster: 'DDU / Cluster', hardwareFamily: 'Porsche Cup', style: gt3({ radius: 14, accentColor: ACCENT, showRpm: false }) },
      { id: 'deltatile', label: 'Predictive Delta (tile)', type: 'deltatile', w: 320, h: 96, category: 'Timing/Delta', styleFamily: 'clean', cluster: 'Timing / Delta', style: gt3({ radius: 14, deltaReference: 'session', deltaRangeSec: 1, title: 'Delta' }) },
      { id: 'fuelstint', label: 'Fuel / Stint', type: 'fuelstint', w: 300, h: 92, category: 'Fuel', styleFamily: 'clean', cluster: 'Stint / Endurance', style: gt3({ reserveLaps: 1, warnAtLaps: 2, title: 'Fuel' }) },
      { id: 'flagoverlay', label: 'Flag / Alert v2', type: 'flagoverlay', w: 760, h: 48, category: 'Flags/Status', styleFamily: 'status', cluster: 'Race Control / Flags', style: gt3({ radius: 8, includeIncidents: true }) }
    ]
  },
  {
    id: 'tyres',
    label: 'Tyres & Brakes',
    variants: [
      { id: 'tyregrid-temp', label: 'Tyres · Temperature', type: 'tyregrid', w: 240, h: 220, category: 'Tyres/Brakes', styleFamily: 'chart', cluster: 'Tyre / Brake', style: gt3({ gridMode: 'temp', showAverage: true, title: 'Tyres °C' }) },
      { id: 'tyregrid-press', label: 'Tyres · Pressure', type: 'tyregrid', w: 240, h: 220, category: 'Tyres/Brakes', styleFamily: 'chart', cluster: 'Tyre / Brake', style: gt3({ gridMode: 'pressure', targetValue: 165, tolerance: 7, title: 'Pressure' }) },
      { id: 'tyregrid-wear', label: 'Tyres · Wear', type: 'tyregrid', w: 240, h: 220, category: 'Tyres/Brakes', styleFamily: 'chart', cluster: 'Tyre / Brake', style: gt3({ gridMode: 'wear', title: 'Wear' }), missing: 'Wear depends on yes' },
      { id: 'brakegrid', label: 'Brakes · Temperature', type: 'brakegrid', w: 240, h: 220, category: 'Tyres/Brakes', styleFamily: 'chart', cluster: 'Tyre / Brake', style: gt3({ showAverage: true, title: 'Brakes °C' }), missing: 'Brake temp depends on yes' },
      { id: 'cornerstack', label: 'Health por canto', type: 'cornerstack', w: 300, h: 300, category: 'Tyres/Brakes', styleFamily: 'chart', cluster: 'Tyre / Brake', style: gt3({ radius: 12, targetValue: 165, tolerance: 7 }) }
    ]
  },
  {
    id: 'context',
    label: 'Race Context',
    variants: [
      { id: 'positiongaps', label: 'Position + Gaps', type: 'positiongaps', w: 300, h: 92, category: 'Position/Standings', styleFamily: 'clean', cluster: 'Radar / Relative', style: gt3({ showTotal: true }) },
      { id: 'laptiming', label: 'Lap Times', type: 'laptiming', w: 300, h: 96, category: 'Timing/Delta', styleFamily: 'clean', cluster: 'Timing / Delta', style: gt3({ showCurrent: true, showLast: true, showBest: true, title: 'Tempos' }) },
      { id: 'standings-relative', label: 'Relative (3 linhas)', type: 'standings', w: 560, h: 92, category: 'Position/Standings', styleFamily: 'table', cluster: 'Radar / Relative', style: gt3({ radius: 10, fontSize: 13, tableColumns: ['pos', 'number', 'name', 'gap'], tableMaxRows: 3, showHeader: false, highlightPlayer: true }) },
      { id: 'standings-tower', label: 'Tower (9 linhas)', type: 'standings', w: 360, h: 480, category: 'Position/Standings', styleFamily: 'table', cluster: 'Radar / Relative', style: gt3({ radius: 12, fontSize: 14, tableColumns: ['pos', 'number', 'name', 'gap', 'class'], tableMaxRows: 9, showHeader: true, highlightPlayer: true }) },
      { id: 'trackmini', label: 'Mini Map', type: 'trackmini', w: 200, h: 200, binding: 'lapDistPct', category: 'Track/Radar', styleFamily: 'chart', cluster: 'Radar / Relative', style: gt3({ radius: 12, accentColor: ACCENT }) },
      { id: 'weather', label: 'Weather / Track', type: 'weather', w: 300, h: 92, category: 'Track/Radar', styleFamily: 'status', cluster: 'Weather / Track', style: gt3({ radius: 12, title: 'Weather' }) },
      { id: 'coach-heatmap', label: 'Coaching · curvas (heatmap)', type: 'coach-heatmap', w: 240, h: 240, category: 'Track/Radar', styleFamily: 'heatmap', cluster: 'Driver Aids', style: gt3({ radius: 12, accentColor: ACCENT, label: 'Coaching · curvas' }) },
      { id: 'coach-tips', label: 'Coach · tips (text)', type: 'coach-tips', w: 300, h: 150, category: 'Track/Radar', styleFamily: 'status', cluster: 'Driver Aids', style: gt3({ radius: 12, accentColor: ACCENT, label: 'Coach tips' }) },
      { id: 'coach-findings', label: 'Coach · achados (lista)', type: 'coach-findings', w: 300, h: 220, category: 'Track/Radar', styleFamily: 'status', cluster: 'Driver Aids', style: gt3({ radius: 12, accentColor: ACCENT, label: 'Achados do coach' }) },
      { id: 'coach-sector-graph', label: 'Coach · setores (grafico)', type: 'coach-sector-graph', w: 260, h: 160, category: 'Track/Radar', styleFamily: 'chart', cluster: 'Timing / Delta', style: gt3({ radius: 12, accentColor: ACCENT, label: 'Sectors ? loss' }) },
      { id: 'engineer-feed', label: 'Engenheiro · radio (texto)', type: 'engineer-feed', w: 320, h: 200, category: 'Track/Radar', styleFamily: 'status', cluster: 'Driver Aids', style: gt3({ radius: 12, accentColor: ACCENT, label: 'Engenheiro · radio' }) }
    ]
  },
  {
    id: 'inputs',
    label: 'Driver Inputs',
    variants: [
      { id: 'inputbars', label: 'Input Bars', type: 'inputbars', w: 160, h: 150, category: 'Inputs', styleFamily: 'bar', cluster: 'Driver Aids', style: gt3({ radius: 12, channels: ['throttle', 'brake'] }) },
      { id: 'inputtrace', label: 'Input Trace', type: 'inputtrace', w: 320, h: 130, category: 'Inputs', styleFamily: 'graph', cluster: 'Driver Aids', style: gt3({ radius: 10, channels: ['throttle', 'brake'], traceLength: 160, traceWidth: 1.8 }) },
      { id: 'steering', label: 'Steering (gauge)', type: 'steering', w: 260, h: 90, category: 'Inputs', styleFamily: 'bar', cluster: 'Driver Aids', style: gt3({ radius: 12, maxDegrees: 540, showNumeric: true, title: 'Steering' }) }
    ]
  },
  {
    id: 'setup',
    label: 'Car Setup',
    variants: [
      { id: 'setupstrip', label: 'ABS / TC / MAP / BB', type: 'setupstrip', w: 760, h: 56, category: 'Flags/Status', styleFamily: 'status', cluster: 'Tell-tales / Warning lamps', style: gt3({ fields: ['abs', 'tc', 'map', 'bb', 'limiter', 'inc'] }), missing: 'MAP/BB require provider support' },
      { id: 'enginetemps', label: 'Engine Temps', type: 'enginetemps', w: 300, h: 110, category: 'Speed/Engine', styleFamily: 'clean', cluster: 'Engine Vitals', style: gt3({ radius: 12, title: 'Motor' }), missing: 'Water/oleo exigem suporte do provedor' }
    ]
  },
  {
    id: 'extra-analog',
    label: 'Round-7 · Analogicos',
    variants: EXTRA_ANALOG
  },
  {
    id: 'extra-digital',
    label: 'Round-7 · Digital (7-seg)',
    variants: EXTRA_DIGITAL
  },
  {
    id: 'extra-clean',
    label: 'Round-7 · Digital limpo',
    variants: EXTRA_CLEAN
  },
  {
    id: 'extra-graph',
    label: 'Round-7 · Graficos',
    variants: EXTRA_GRAPH
  },
  {
    id: 'extra-chart',
    label: 'Round-7 · Charts',
    variants: EXTRA_CHART
  },
  {
    id: 'extra-ring',
    label: 'Round-7 · Aneis & Arcos',
    variants: EXTRA_RING
  },
  {
    id: 'extra-led',
    label: 'Round-7 · LED bars',
    variants: EXTRA_LED
  },
  {
    id: 'extra-heatmap',
    label: 'Round-7 · Heatmaps',
    variants: EXTRA_HEATMAP
  },
  {
    id: 'extra-status',
    label: 'Round-7 · Status & Icones',
    variants: EXTRA_STATUS
  },
  {
    id: 'curated-core',
    label: 'iRacing Curated · Essenciais',
    variants: [
      curated('speed-clean', 'Speed clean', 'speed-clean', 220, 96, ACCENT, {}, { cluster: 'DDU / Cluster', hardwareFamily: 'MoTeC C127' }),
      curated('speed-elaborate', 'Speed elaborate', 'speed-elaborate', 260, 140, ACCENT, {}, { cluster: 'DDU / Cluster', hardwareFamily: 'MoTeC C127' }),
      curated('gear-clean', 'Gear clean', 'gear-clean', 160, 140, 'var(--accent-warning)', {}, { cluster: 'DDU / Cluster', hardwareFamily: 'Bosch DDU 296' }),
      curated('gear-elaborate', 'Gear elaborate', 'gear-elaborate', 220, 180, 'var(--accent-warning)', {}, { cluster: 'DDU / Cluster', hardwareFamily: 'Bosch DDU 296' }),
      curated('rpm-clean', 'RPM clean', 'rpm-clean', 260, 96, 'var(--accent-warning)', {}, { cluster: 'DDU / Cluster', hardwareFamily: 'Cosworth ICD' }),
      curated('rpm-elaborate', 'RPM gauge elaborate', 'rpm-elaborate', 300, 150, 'var(--accent-warning)', {}, { cluster: 'DDU / Cluster', hardwareFamily: 'AiM' }),
      curated('delta-clean', 'Delta clean', 'delta-clean', 240, 96, 'var(--accent-primary)', {}, { cluster: 'Timing / Delta' }),
      curated('delta-elaborate', 'Delta elaborate', 'delta-elaborate', 300, 140, 'var(--accent-primary)', {}, { cluster: 'Timing / Delta' }),
      curated('fuel-clean', 'Fuel clean', 'fuel-clean', 220, 96, GOLD, {}, { cluster: 'Stint / Endurance' }),
      curated('fuel-elaborate', 'Fuel elaborate', 'fuel-elaborate', 280, 140, GOLD, {}, { cluster: 'Stint / Endurance' }),
      curated('lap-clean', 'Lap clean', 'lap-clean', 220, 92, ACCENT, {}, { cluster: 'Timing / Delta' }),
      curated('lap-elaborate', 'Lap elaborate', 'lap-elaborate', 280, 132, ACCENT, {}, { cluster: 'Timing / Delta' }),
      curated('position-clean', 'Position clean', 'position-clean', 220, 96, 'var(--accent-warning)', {}, { cluster: 'Radar / Relative' }),
      curated('position-elaborate', 'Position elaborate', 'position-elaborate', 280, 140, 'var(--accent-warning)', {}, { cluster: 'Radar / Relative' })
    ]
  },
  {
    id: 'curated-car',
    label: 'iRacing Curated · Car systems',
    variants: [
      curated('tyres-clean', 'Tyres clean', 'tyres-clean', 320, 230, AMBER, { reference: 'TEMP / PRESS / WEAR' }, { cluster: 'Tyre / Brake' }),
      curated('tyres-elaborate', 'Tyres graphic elaborate', 'tyres-elaborate', 400, 300, AMBER, { reference: 'TYRE GRAPHIC' }, { cluster: 'Tyre / Brake' }),
      curated('abs-clean', 'ABS clean', 'abs-clean', 180, 90, AMBER, {}, { cluster: 'Tell-tales / Warning lamps' }),
      curated('abs-elaborate', 'ABS symbol elaborate', 'abs-elaborate', 220, 130, AMBER, {}, { cluster: 'Tell-tales / Warning lamps' }),
      curated('tc-clean', 'TC clean', 'tc-clean', 180, 90, AMBER, {}, { cluster: 'Tell-tales / Warning lamps' }),
      curated('tc-elaborate', 'TC symbol elaborate', 'tc-elaborate', 220, 130, AMBER, {}, { cluster: 'Tell-tales / Warning lamps' }),
      curated('map-clean', 'MAP clean', 'map-clean', 180, 90, CHROME_DIM, {}, { cluster: 'Driver Aids' }),
      curated('map-elaborate', 'MAP elaborate', 'map-elaborate', 220, 130, CHROME_DIM, {}, { cluster: 'Driver Aids' }),
      curated('bb-clean', 'Brake bias clean', 'bb-clean', 190, 90, 'var(--accent-warning)', {}, { cluster: 'Driver Aids' }),
      curated('bb-elaborate', 'Brake bias elaborate', 'bb-elaborate', 230, 130, 'var(--accent-warning)', {}, { cluster: 'Driver Aids' }),
      curated('temps-clean', 'Engine temps clean', 'temps-clean', 300, 110, GOLD, {}, { cluster: 'Engine Vitals' }),
      curated('temps-elaborate', 'Engine temps elaborate', 'temps-elaborate', 360, 150, GOLD, {}, { cluster: 'Engine Vitals' }),
      curated('clutch-clean', 'Clutch clean', 'clutch-clean', 180, 90, CHROME, {}, { cluster: 'Driver Aids' }),
      curated('clutch-elaborate', 'Clutch elaborate', 'clutch-elaborate', 220, 130, CHROME, {}, { cluster: 'Driver Aids' }),
      curated('drs-clean', 'DRS clean', 'drs-clean', 180, 90, AMBER, {}, { cluster: 'Tell-tales / Warning lamps' }),
      curated('drs-elaborate', 'DRS elaborate', 'drs-elaborate', 220, 130, AMBER, {}, { cluster: 'Tell-tales / Warning lamps' })
    ]
  },
  {
    id: 'curated-race',
    label: 'iRacing Curated · Race context',
    variants: [
      curated('pitlimiter-clean', 'Pit limiter clean', 'pitlimiter-clean', 220, 90, ORANGE, {}, { cluster: 'Race Control / Flags' }),
      curated('pitlimiter-elaborate', 'Pit limiter elaborate', 'pitlimiter-elaborate', 260, 130, ORANGE, {}, { cluster: 'Race Control / Flags' }),
      curated('incidents-clean', 'Incidents clean', 'incidents-clean', 180, 90, RED, {}, { cluster: 'Race Control / Flags' }),
      curated('incidents-elaborate', 'Incidents elaborate', 'incidents-elaborate', 220, 130, RED, {}, { cluster: 'Race Control / Flags' }),
      curated('flags-clean', 'Flags clean', 'flags-clean', 260, 80, 'var(--accent-warning)', {}, { cluster: 'Race Control / Flags' }),
      curated('flags-elaborate', 'Flags elaborate', 'flags-elaborate', 360, 120, 'var(--accent-warning)', {}, { cluster: 'Race Control / Flags' }),
      curated('relatives-clean', 'Relatives clean', 'relatives-clean', 420, 132, 'var(--accent-warning)', { reference: '±1 CAR' }, { cluster: 'Radar / Relative' }),
      curated('relatives-elaborate', 'Relatives elaborate', 'relatives-elaborate', 520, 180, 'var(--accent-warning)', { reference: 'NAME / GAP / LAST' }, { cluster: 'Radar / Relative' }),
      curated('radar-clean', 'Radar clean', 'radar-clean', 220, 220, AMBER, {}, { cluster: 'Radar / Relative' }),
      curated('radar-elaborate', 'Radar elaborate', 'radar-elaborate', 280, 280, AMBER, {}, { cluster: 'Radar / Relative' }),
      curated('trackmap-clean', 'Track map clean', 'trackmap-clean', 280, 220, ACCENT, {}, { cluster: 'Radar / Relative' }),
      curated('trackmap-elaborate', 'Track map elaborate', 'trackmap-elaborate', 380, 300, ACCENT, {}, { cluster: 'Radar / Relative' }),
      curated('inputs-clean', 'Inputs clean', 'inputs-clean', 180, 150, ACCENT, {}, { cluster: 'Driver Aids' }),
      curated('inputs-elaborate', 'Inputs trace elaborate', 'inputs-elaborate', 340, 140, ACCENT, {}, { cluster: 'Driver Aids' })
    ]
  },
  {
    id: 'utility',
    label: 'Utilitarios',
    variants: [
      { id: 'text', label: 'Text', type: 'text', w: 240, h: 64, category: 'Text/Image', styleFamily: 'text', style: gt3({ background: 'transparent', border: 'transparent', borderWidth: 0, color: TEXT_FG, fontSize: 28, fontWeight: 800, align: 'left', text: 'Text' }) },
      { id: 'rect', label: 'Rectangle / Painel', type: 'rect', w: 240, h: 120, category: 'Text/Image', styleFamily: 'image', style: gt3({ radius: 12 }) },
      { id: 'bar', label: 'Bar generica', type: 'bar', w: 240, h: 24, binding: 'throttle', category: 'Charts/Graphs', styleFamily: 'bar', style: gt3({ background: '#0a0c10', radius: 8, fillColor: ACCENT, warnColor: '#ffb84d', dangerColor: '#ff5468', warnAt: 0.7, dangerAt: 0.9 }) },
      { id: 'gauge', label: 'Mostrador generico', type: 'gauge', w: 200, h: 120, binding: 'rpmPct', category: 'Charts/Graphs', styleFamily: 'gauge', style: gt3({ background: 'transparent', border: 'transparent', borderWidth: 0, fillColor: ACCENT, warnColor: '#ffb84d', dangerColor: '#ff5468', warnAt: 0.7, dangerAt: 0.9 }) },
      { id: 'shiftbar-led', label: 'Shift Bar · LED zonas', type: 'shiftbar', w: 600, h: 48, binding: 'shiftPct', category: 'Speed/Engine', styleFamily: 'led', cluster: 'DDU / Cluster', style: gt3({ segments: 15, flashAt: 0.97, glow: true, segmentShape: 'led', radius: 8 }) },
      { id: 'shiftlights', label: 'Shift LEDs (legado)', type: 'shiftlights', w: 600, h: 48, binding: 'shiftPct', category: 'Speed/Engine', styleFamily: 'led', style: gt3({ background: '#0a0c10', radius: 10, segments: 12, fillColor: GREEN, warnColor: AMBER, dangerColor: RED, warnAt: 0.6, dangerAt: 0.85 }) },
      { id: 'image', label: 'Image / Logo', type: 'image', w: 200, h: 120, category: 'Text/Image', styleFamily: 'image', style: gt3({ background: 'transparent', border: 'transparent', borderWidth: 0, radius: 8, fit: 'contain', opacity: 1 }) },
      { id: 'table', label: 'Table', type: 'table', w: 520, h: 280, category: 'Position/Standings', styleFamily: 'table', style: gt3({ radius: 10, fontSize: 14, tableColumns: ['pos', 'number', 'name', 'gap', 'class'], tableMaxRows: 8, showHeader: true, highlightPlayer: true }) }
    ]
  },
  {
    id: 'predictors',
    label: 'Preditores',
    variants: [
      { id: 'pred-catch-ahead-fut', label: 'Preditor · Alcancar (futurista)', type: 'pred-catch-ahead-futuristic', w: 300, h: 120, category: 'Position/Standings', styleFamily: 'led', style: gt3({ radius: 12, accentColor: AMBER, label: 'Alcancar a front' }) },
      { id: 'pred-catch-ahead-min', label: 'Preditor · Alcancar (minimal)', type: 'pred-catch-ahead-minimal', w: 300, h: 120, category: 'Position/Standings', styleFamily: 'clean', style: gt3({ radius: 12, accentColor: AMBER, label: 'Alcancar a front' }) },
      { id: 'pred-caught-behind-fut', label: 'Preditor · Ameaca back (futurista)', type: 'pred-caught-behind-futuristic', w: 300, h: 120, category: 'Position/Standings', styleFamily: 'led', style: gt3({ radius: 12, accentColor: AMBER, label: 'Ameaca back' }) },
      { id: 'pred-caught-behind-min', label: 'Preditor · Ameaca back (minimal)', type: 'pred-caught-behind-minimal', w: 300, h: 120, category: 'Position/Standings', styleFamily: 'clean', style: gt3({ radius: 12, accentColor: AMBER, label: 'Ameaca back' }) },
      { id: 'pred-fuel-margin-fut', label: 'Preditor · Fuel (futurista)', type: 'pred-fuel-margin-futuristic', w: 300, h: 120, category: 'Fuel', styleFamily: 'led', style: gt3({ radius: 12, accentColor: GOLD, label: 'Fuel ate o fim' }) },
      { id: 'pred-fuel-margin-min', label: 'Preditor · Fuel (minimal)', type: 'pred-fuel-margin-minimal', w: 300, h: 120, category: 'Fuel', styleFamily: 'clean', style: gt3({ radius: 12, accentColor: GOLD, label: 'Fuel ate o fim' }) },
      { id: 'pred-tire-wear-fut', label: 'Preditor · Tire (futurista)', type: 'pred-tire-wear-futuristic', w: 320, h: 130, category: 'Tyres/Brakes', styleFamily: 'led', style: gt3({ radius: 12, accentColor: AMBER, label: 'Tire wear/penhasco' }) },
      { id: 'pred-tire-wear-min', label: 'Preditor · Tire (minimal)', type: 'pred-tire-wear-minimal', w: 320, h: 130, category: 'Tyres/Brakes', styleFamily: 'clean', style: gt3({ radius: 12, accentColor: AMBER, label: 'Tire wear/penhasco' }) },
      { id: 'pred-pace-fut', label: 'Preditor · Pace (futurista)', type: 'pred-pace-futuristic', w: 300, h: 120, category: 'Timing/Delta', styleFamily: 'led', style: gt3({ radius: 12, accentColor: CHROME, label: 'Pace projetado' }) },
      { id: 'pred-pace-min', label: 'Preditor · Pace (minimal)', type: 'pred-pace-minimal', w: 300, h: 120, category: 'Timing/Delta', styleFamily: 'clean', style: gt3({ radius: 12, accentColor: CHROME, label: 'Pace projetado' }) }
    ]
  },
  {
    id: 'extra-v240',
    label: 'Extras v2.40',
    variants: [
      ...EXTRA_READOUT_VARIANTS,
      ...EXTRA_GAUGE_VARIANTS,
      ...EXTRA_BAR_VARIANTS,
      ...EXTRA_STRATEGY_VARIANTS
    ]
  },
  ...IRACING_CHANNEL_CATEGORIES
]

// ─── Categorizacao (fallback) ─────────────────────────────────────────────────
// Curated/legacy variants that don't declare category/styleFamily inline are
// classified here by concept so EVERY variant ends up fully categorised.
const CONCEPT_CATEGORY: Record<string, WidgetCategoryTag> = {
  speed: 'Speed/Engine', gear: 'Speed/Engine', rpm: 'Speed/Engine', temps: 'Speed/Engine',
  delta: 'Timing/Delta', lap: 'Timing/Delta',
  fuel: 'Fuel',
  tyres: 'Tyres/Brakes',
  position: 'Position/Standings', relatives: 'Position/Standings',
  inputs: 'Inputs', clutch: 'Inputs',
  flags: 'Flags/Status', abs: 'Flags/Status', tc: 'Flags/Status', map: 'Flags/Status',
  bb: 'Flags/Status', pitlimiter: 'Flags/Status', incidents: 'Flags/Status', drs: 'Flags/Status',
  radar: 'Track/Radar', trackmap: 'Track/Radar'
}

const CONCEPT_STYLE: Record<string, WidgetStyleFamily> = {
  tyres: 'chart', relatives: 'table', radar: 'chart', trackmap: 'chart', inputs: 'graph'
}

function concept(type: string): string {
  return type.replace(/-(clean|elaborate)$/, '')
}

function deriveTaxon(v: WidgetVariant): { category: WidgetCategoryTag; styleFamily: WidgetStyleFamily } {
  if (v.category && v.styleFamily) return { category: v.category, styleFamily: v.styleFamily }
  const c = concept(v.type)
  const category = v.category ?? CONCEPT_CATEGORY[c] ?? 'Text/Image'
  const styleFamily = v.styleFamily ?? CONCEPT_STYLE[c] ?? 'clean'
  return { category, styleFamily }
}

export function normalizeVariant(v: WidgetVariant): NormalizedVariant {
  const { category, styleFamily } = deriveTaxon(v)
  return { ...v, category, styleFamily, supportedSims: variantSupportedSims(v) }
}

// Flattened, fully-categorised catalog — the single source the gallery filters
// and the tests assert against.
export const ALL_VARIANTS: NormalizedVariant[] = WIDGET_CATALOG
  .flatMap((category) => category.variants)
  .map(normalizeVariant)
  .sort(compareCatalogEntries)

export function variantToElement(v: WidgetVariant, x: number, y: number): DashboardElement {
  return {
    id: createElementId(),
    type: v.type,
    x,
    y,
    w: v.w,
    h: v.h,
    binding: v.binding,
    name: v.label,
    ...(v.widgetId ? { widgetId: v.widgetId } : {}),
    ...(v.hifiModuleId ? { hifiModuleId: v.hifiModuleId } : {}),
    style: { ...v.style }
  }
}

// ─── Sim-aware filtering ─────────────────────────────────────────────────────
/** Catalog filter query: the shared taxonomy facets plus an optional per-yes filter. */
export interface WidgetCatalogFilterQuery extends WidgetFilterQuery {
  /** Keep only variants whose live telemetry coverage includes this yes. `null`/absent = all sims. */
  yes?: CoverageSimId | null
}

/** A taxon that also carries precomputed per-yes coverage (every NormalizedVariant does). */
type SimFilterable = WidgetTaxon & { supportedSims: readonly CoverageSimId[] }

/**
 * Sim-aware superset of the shared taxonomy filter: applies the existing search /
 * category / styleFamily facets, then narrows to variants supported on `yes` (when set).
 * A `null`/absent `yes` leaves the result unfiltered by yes, so existing callers keep
 * their behaviour and the new chip row opts in by passing a yes.
 */
export function filterVariants<T extends SimFilterable>(
  variants: readonly T[],
  query: WidgetCatalogFilterQuery
): T[] {
  const byQuery = filterVariantsByQuery(variants, query)
  const yes = query.yes
  if (!yes) return byQuery
  return byQuery.filter((v) => v.supportedSims.includes(yes))
}

export {
  groupVariantsByCategory,
  groupVariantsByCluster,
  partitionByAdvanced,
  isAdvancedVariant,
  availableClusters
} from '../../../../shared/widget-taxonomy'
