// Natural-language → dashboard mapper (PURE, dependency-free).
//
// This is the deterministic core of the F6 "Dashboard AI" builder. It turns a
// free-text phrase ("quero fuel, position e temp de tire") into a list of
// widget ids drawn from the shared widget catalog, and packs the chosen widgets
// into a clean DashboardElement[] grid.
//
// Everything here is pure and React/Electron/node-free so it can be imported by
// main (the orchestrator), the renderer (the builder view) AND unit tests. The
// LLM path in src/main/ai/dashboard-builder.ts parses the phrase into widget ids
// and then reuses the SAME packer; the deterministic path uses the keyword map
// below directly. There is therefore always a working fallback without the LLM.
//
// The catalog is INJECTED (CatalogWidget[]) so this module never imports the
// renderer-side widget-catalog-data.ts: pass `ALL_VARIANTS` from there (it is
// structurally a CatalogWidget[]) or any fixture/subset in tests.

import {
  createDashboardId,
  createElementId,
  type Dashboard,
  type DashboardElement,
  type DashboardElementStyle,
  type DashboardElementType
} from './dashboards'
import type { WidgetCategoryTag } from './widget-taxonomy'

// ─── Catalog projection ──────────────────────────────────────────────────────
// Minimal structural shape of a catalog widget the mapper + packer depend on.
// The renderer's WidgetVariant / NormalizedVariant satisfy this directly.
export interface CatalogWidget {
  id: string
  type: DashboardElementType
  w: number
  h: number
  style: DashboardElementStyle
  label?: string
  name?: string
  binding?: string
  category?: string
  tags?: readonly string[]
}

// ─── Concepts ────────────────────────────────────────────────────────────────
// A telemetry "concept" the user can ask for. The same vocabulary is reused by
// the adaptive engine (dashboard-adaptive.ts) so phrasing and emphasis stay
// consistent.
export type DashboardConcept =
  | 'speed'
  | 'gear'
  | 'rpm'
  | 'shift'
  | 'delta'
  | 'laptime'
  | 'fuel'
  | 'tyres'
  | 'brakes'
  | 'position'
  | 'gaps'
  | 'relatives'
  | 'standings'
  | 'radar'
  | 'trackmap'
  | 'inputs'
  | 'steering'
  | 'weather'
  | 'enginetemps'
  | 'flags'
  | 'pit'
  | 'assists'
  | 'incidents'
  | 'gforce'

export interface ConceptDef {
  concept: DashboardConcept
  /** Catalog category this concept lives in (fallback resolution). */
  category: WidgetCategoryTag
  /** Catalog widget ids that represent the concept, in priority order. */
  preferredIds: string[]
  /** Normalized (lowercase, accent-free) keywords/synonyms — PT-BR + EN. */
  synonyms: string[]
}

// The keyword/synonym map. Synonyms are stored already normalized (lowercase,
// no diacritics) so matching is a simple substring test. Order defines the order
// widgets appear in the generated grid.
export const DASHBOARD_CONCEPTS: ConceptDef[] = [
  {
    concept: 'speed',
    category: 'Speed/Engine',
    preferredIds: ['speed-clean', 'value-speed', 'ana-speed', 'seg-speed', 'speed-elaborate'],
    synonyms: ['speed', 'speed', 'velocimetro', 'kmh', 'km/h', 'mph', 'andamento']
  },
  {
    concept: 'gear',
    category: 'Speed/Engine',
    preferredIds: ['gearcluster', 'gear-clean', 'value-gear', 'seg-gear', 'gear-elaborate'],
    synonyms: ['gear', 'gear', 'gears', 'cambio', 'gearbox', 'engrenagem']
  },
  {
    concept: 'rpm',
    category: 'Speed/Engine',
    preferredIds: ['rpm-clean', 'valuegauge-rpm', 'ana-rpm', 'seg-rpm', 'rpm-elaborate'],
    synonyms: ['rpm', 'rotacao', 'rotacoes', 'giros', 'tacometro', 'tach']
  },
  {
    concept: 'shift',
    category: 'Speed/Engine',
    preferredIds: ['shiftbar-18', 'shiftbar-12', 'shiftbar-24', 'shiftlights'],
    synonyms: ['shift', 'shiftlight', 'shift light', 'shift lights', 'rev light', 'rev lights', 'revlight', 'luzes de troca', 'led de troca']
  },
  {
    concept: 'delta',
    category: 'Timing/Delta',
    preferredIds: ['deltatile', 'delta-clean', 'delta-elaborate'],
    synonyms: ['delta', 'preditivo', 'predictive', 'diferenca de tempo', 'ganho de tempo']
  },
  {
    concept: 'laptime',
    category: 'Timing/Delta',
    preferredIds: ['laptiming', 'lap-clean', 'clk-current', 'seg-laps', 'lap-elaborate'],
    synonyms: ['lap time', 'laptime', 'lap time', 'tempos de lap', 'lap', 'laps', 'best lap', 'melhor lap', 'ultima lap', 'last lap', 'current lap']
  },
  {
    concept: 'fuel',
    category: 'Fuel',
    preferredIds: ['fuelstint', 'fuel-clean', 'valuegauge-fuel', 'ana-fuel', 'lin-fuel', 'fuel-elaborate'],
    synonyms: ['fuel', 'fuel', 'gasolina', 'tanque', 'stint', 'consumo']
  },
  {
    concept: 'tyres',
    category: 'Tyres/Brakes',
    preferredIds: ['tyregrid-temp', 'tyres-clean', 'tyres-elaborate', 'tyregrid-press', 'tyregrid-wear', 'cornerstack'],
    synonyms: ['tyre', 'tire', 'tyres', 'tires', 'tire', 'tires', 'temp de tire', 'tyre temp', 'borracha', 'tire pressure', 'tire pressure', 'wear']
  },
  {
    concept: 'brakes',
    category: 'Tyres/Brakes',
    preferredIds: ['brakegrid'],
    synonyms: ['brake temp', 'brake temperature', 'brake', 'brakes', 'brakes', 'brake disc']
  },
  {
    concept: 'position',
    category: 'Position/Standings',
    preferredIds: ['positiongaps', 'position-clean', 'seg-position', 'position-elaborate'],
    synonyms: ['posicao', 'position', 'colocacao', 'classificacao', 'minha posicao']
  },
  {
    concept: 'gaps',
    category: 'Position/Standings',
    preferredIds: ['positiongaps', 'relatives-clean'],
    synonyms: ['gap', 'gaps', 'intervalo', 'diferenca para', 'distancia para', 'frente e atras']
  },
  {
    concept: 'relatives',
    category: 'Position/Standings',
    preferredIds: ['relatives-clean', 'relatives-elaborate', 'standings-relative'],
    synonyms: ['relative', 'relativo', 'relativos', 'carros proximos', 'proximidade', 'adversario', 'adversarios']
  },
  {
    concept: 'standings',
    category: 'Position/Standings',
    preferredIds: ['standings-tower', 'standings-relative', 'table'],
    synonyms: ['standings', 'classificacao geral', 'tabela', 'leaderboard', 'torre', 'tower', 'grid de largada']
  },
  {
    concept: 'radar',
    category: 'Track/Radar',
    preferredIds: ['radar-clean', 'radar-elaborate'],
    synonyms: ['radar', 'proximidade lateral', 'ponto cego', 'blind spot']
  },
  {
    concept: 'trackmap',
    category: 'Track/Radar',
    preferredIds: ['trackmap-clean', 'trackmini', 'trackmap-elaborate'],
    synonyms: ['track map', 'trackmap', 'track map', 'mapa', 'circuito', 'mini map', 'minimapa', 'progresso da lap']
  },
  {
    concept: 'inputs',
    category: 'Inputs',
    preferredIds: ['inputbars', 'inputtrace', 'inputs-clean', 'inputs-elaborate'],
    synonyms: ['input', 'inputs', 'pedais', 'acelerador', 'throttle', 'entradas', 'trace de pedal']
  },
  {
    concept: 'steering',
    category: 'Inputs',
    preferredIds: ['steering'],
    synonyms: ['steering', 'steering', 'angulo do steering', 'direcao']
  },
  {
    concept: 'weather',
    category: 'Track/Radar',
    preferredIds: ['weather'],
    synonyms: ['weather', 'weather', 'rain', 'rain', 'pista molhada', 'temperatura da pista', 'track temp', 'grip']
  },
  {
    concept: 'enginetemps',
    category: 'Speed/Engine',
    preferredIds: ['enginetemps', 'temps-clean', 'ana-water', 'ana-oil', 'temps-elaborate'],
    synonyms: ['temperatura do motor', 'engine temp', 'agua', 'water temp', 'oleo', 'oil temp', 'oil pressure', 'temperatura de agua']
  },
  {
    concept: 'flags',
    category: 'Flags/Status',
    preferredIds: ['flagoverlay', 'flags-clean', 'flags-elaborate'],
    synonyms: ['flag', 'flags', 'flag', 'flags', 'flag warning']
  },
  {
    concept: 'pit',
    category: 'Flags/Status',
    preferredIds: ['pitlimiter-clean', 'pitlimiter-elaborate'],
    synonyms: ['pit', 'pit limiter', 'limitador', 'pit stop', 'pitstop', 'pitlane', 'pit road', 'stop no box']
  },
  {
    concept: 'assists',
    category: 'Flags/Status',
    preferredIds: ['setupstrip', 'abs-clean', 'tc-clean', 'bb-clean', 'map-clean'],
    synonyms: ['abs', 'tc', 'traction', 'controle de tracao', 'engine map', 'engine map', 'brake bias', 'brake bias', 'assist', 'assists']
  },
  {
    concept: 'incidents',
    category: 'Flags/Status',
    preferredIds: ['incidents-clean', 'incidents-elaborate'],
    synonyms: ['incidente', 'incidentes', 'incident', 'incidents', 'penalidade', 'limite de incidentes']
  },
  {
    concept: 'gforce',
    category: 'Analog',
    preferredIds: ['gforce'],
    synonyms: ['g-force', 'gforce', 'g force', 'forca g', 'forcas g', 'g lateral', 'aceleracao lateral']
  }
]

/** Ordered list of all known concepts (reused by the adaptive engine). */
export const DASHBOARD_CONCEPT_LIST: DashboardConcept[] = DASHBOARD_CONCEPTS.map((c) => c.concept)

const CONCEPT_BY_KEY: Record<DashboardConcept, ConceptDef> = DASHBOARD_CONCEPTS.reduce(
  (acc, def) => {
    acc[def.concept] = def
    return acc
  },
  {} as Record<DashboardConcept, ConceptDef>
)

// Sensible default dashboard when the phrase matches nothing.
export const DEFAULT_WIDGET_IDS: string[] = ['gearcluster', 'speed-clean', 'rpm-clean', 'deltatile', 'positiongaps', 'fuel-clean']

// ─── Text normalization + matching ───────────────────────────────────────────

/** Lowercase + strip diacritics + collapse whitespace. */
export function normalizePhrase(phrase: string): string {
  return phrase
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export type DetailLevel = 'auto' | 'clean' | 'elaborate'

const ELABORATE_HINTS = ['elaborate', 'elaborado', 'detalhado', 'detalhada', 'detailed', 'completo', 'completa', 'full', 'rico', 'rica', 'denso', 'densa', 'grande']
const CLEAN_HINTS = ['clean', 'simples', 'minimal', 'minimalista', 'enxuto', 'enxuta', 'limpo', 'limpa', 'basico', 'basica']

/** Detect whether the user asked for a clean/minimal or elaborate/detailed look. */
export function detectDetail(phrase: string): DetailLevel {
  const n = normalizePhrase(phrase)
  if (ELABORATE_HINTS.some((h) => n.includes(h))) return 'elaborate'
  if (CLEAN_HINTS.some((h) => n.includes(h))) return 'clean'
  return 'auto'
}

/** Concepts whose synonyms appear in the phrase, in canonical concept order. */
export function matchConcepts(phrase: string): DashboardConcept[] {
  const n = normalizePhrase(phrase)
  if (!n) return []
  const out: DashboardConcept[] = []
  for (const def of DASHBOARD_CONCEPTS) {
    if (def.synonyms.some((s) => n.includes(s))) out.push(def.concept)
  }
  return out
}

// Reorder a concept's preferred ids to honour the requested detail level by
// floating ids whose suffix matches (`-elaborate` / `-clean`) to the front.
function orderByDetail(ids: string[], detail: DetailLevel): string[] {
  if (detail === 'auto') return ids
  const suffix = detail === 'elaborate' ? '-elaborate' : '-clean'
  const preferred = ids.filter((id) => id.endsWith(suffix))
  const rest = ids.filter((id) => !id.endsWith(suffix))
  return [...preferred, ...rest]
}

/**
 * Resolve a concept to a concrete widget id that EXISTS in the given catalog.
 * Tries the preferred ids first (honouring detail), then falls back to the first
 * catalog widget in the concept's category. Returns undefined if nothing fits.
 */
export function resolveWidgetIdForConcept(
  concept: DashboardConcept,
  catalog: readonly CatalogWidget[],
  detail: DetailLevel = 'auto'
): string | undefined {
  const def = CONCEPT_BY_KEY[concept]
  if (!def) return undefined
  const present = new Set(catalog.map((w) => w.id))
  for (const id of orderByDetail(def.preferredIds, detail)) {
    if (present.has(id)) return id
  }
  // Category fallback — pick a widget tagged with the concept's domain category.
  const byCategory = catalog.filter((w) => w.category === def.category)
  if (byCategory.length === 0) return undefined
  if (detail !== 'auto') {
    const suffix = detail === 'elaborate' ? '-elaborate' : '-clean'
    const detailed = byCategory.find((w) => w.id.endsWith(suffix))
    if (detailed) return detailed.id
  }
  return byCategory[0].id
}

export interface MapOptions {
  detail?: DetailLevel
  /** Hard cap on how many widgets to return (default 12). */
  max?: number
}

/**
 * Deterministically map a phrase to an ordered, de-duplicated list of widget ids
 * present in the catalog. Returns [] when nothing matches (callers may then fall
 * back to DEFAULT_WIDGET_IDS).
 */
export function mapPhraseToWidgetIds(phrase: string, catalog: readonly CatalogWidget[], opts: MapOptions = {}): string[] {
  const detail = opts.detail ?? detectDetail(phrase)
  const max = opts.max ?? 12
  const concepts = matchConcepts(phrase)
  const ids: string[] = []
  const seen = new Set<string>()
  for (const concept of concepts) {
    const id = resolveWidgetIdForConcept(concept, catalog, detail)
    if (id && !seen.has(id)) {
      seen.add(id)
      ids.push(id)
      if (ids.length >= max) break
    }
  }
  return ids
}

/** Resolve an ordered list of ids to catalog widgets (dedup, skip unknown). */
export function resolveWidgetsByIds(ids: readonly string[], catalog: readonly CatalogWidget[]): CatalogWidget[] {
  const byId = new Map(catalog.map((w) => [w.id, w]))
  const out: CatalogWidget[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) continue
    const w = byId.get(id)
    if (w) {
      seen.add(id)
      out.push(w)
    }
  }
  return out
}

// ─── Layout packer ───────────────────────────────────────────────────────────

export interface PackOptions {
  width?: number
  height?: number
  margin?: number
  gap?: number
  /** Maximum columns in the grid (default 4). */
  maxCols?: number
}

const DEFAULT_PACK: Required<PackOptions> = { width: 1024, height: 600, margin: 16, gap: 12, maxCols: 4 }

/** Column count for n widgets — a near-square grid capped at maxCols. */
export function gridColumns(count: number, maxCols = DEFAULT_PACK.maxCols): number {
  if (count <= 1) return 1
  return Math.max(1, Math.min(maxCols, Math.ceil(Math.sqrt(count))))
}

/**
 * Arrange widgets into a clean, non-overlapping DashboardElement[] grid that
 * fills the canvas. Each widget is sized to its cell (widgets are designed to
 * scale). Integer maths guarantees cells never overlap.
 */
export function packWidgetsIntoGrid(widgets: readonly CatalogWidget[], opts: PackOptions = {}): DashboardElement[] {
  const { width, height, margin, gap, maxCols } = { ...DEFAULT_PACK, ...opts }
  const n = widgets.length
  if (n === 0) return []
  const cols = gridColumns(n, maxCols)
  const rows = Math.ceil(n / cols)
  const cellW = Math.max(1, Math.floor((width - 2 * margin - (cols - 1) * gap) / cols))
  const cellH = Math.max(1, Math.floor((height - 2 * margin - (rows - 1) * gap) / rows))
  return widgets.map((widget, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = margin + col * (cellW + gap)
    const y = margin + row * (cellH + gap)
    return {
      id: createElementId(),
      type: widget.type,
      x,
      y,
      w: cellW,
      h: cellH,
      binding: widget.binding,
      name: widget.name ?? widget.label,
      style: { ...widget.style }
    }
  })
}

// ─── Dashboard assembly ──────────────────────────────────────────────────────

export interface BuildOptions extends PackOptions, MapOptions {
  name?: string
  bg?: string
  description?: string
  /** When phrase matches nothing, fall back to DEFAULT_WIDGET_IDS (default true). */
  useDefaultWhenEmpty?: boolean
}

const DEFAULT_BG = '#000000'

function clampName(phrase: string): string {
  const trimmed = phrase.trim().replace(/\s+/g, ' ')
  if (!trimmed) return 'AI Dashboard'
  const short = trimmed.length > 42 ? `${trimmed.slice(0, 42).trim()}…` : trimmed
  return `AI · ${short}`
}

/** Build a Dashboard from an explicit, ordered list of widget ids. */
export function buildDashboardFromWidgetIds(ids: readonly string[], catalog: readonly CatalogWidget[], opts: BuildOptions = {}): Dashboard {
  const widgets = resolveWidgetsByIds(ids, catalog)
  const elements = packWidgetsIntoGrid(widgets, opts)
  const now = Date.now()
  return {
    id: createDashboardId(),
    name: opts.name ?? 'AI Dashboard',
    width: opts.width ?? DEFAULT_PACK.width,
    height: opts.height ?? DEFAULT_PACK.height,
    bg: opts.bg ?? DEFAULT_BG,
    elements,
    scaleMode: 'fit',
    description: opts.description,
    author: 'Dashboard AI',
    createdAt: now,
    updatedAt: now
  }
}

export interface BuildFromPhraseResult {
  dashboard: Dashboard
  widgetIds: string[]
  matched: DashboardConcept[]
  usedDefault: boolean
}

/** Full deterministic path: phrase → matched concepts → widget ids → Dashboard. */
export function buildDashboardFromPhrase(phrase: string, catalog: readonly CatalogWidget[], opts: BuildOptions = {}): BuildFromPhraseResult {
  const matched = matchConcepts(phrase)
  let widgetIds = mapPhraseToWidgetIds(phrase, catalog, opts)
  let usedDefault = false
  if (widgetIds.length === 0 && (opts.useDefaultWhenEmpty ?? true)) {
    widgetIds = resolveWidgetsByIds(DEFAULT_WIDGET_IDS, catalog).map((w) => w.id)
    usedDefault = true
  }
  const dashboard = buildDashboardFromWidgetIds(widgetIds, catalog, {
    ...opts,
    name: opts.name ?? clampName(phrase),
    description: opts.description ?? `Generated from: "${phrase.trim()}"`
  })
  return { dashboard, widgetIds, matched, usedDefault }
}

// ─── Element → concept (used by the adaptive engine) ─────────────────────────

// Best-effort map from a DashboardElement type to its concept. Covers the
// representative widget kinds; unknown/primitive types fall back to the binding.
const TYPE_CONCEPT: Partial<Record<string, DashboardConcept>> = {
  'speed-clean': 'speed',
  'speed-elaborate': 'speed',
  'gear-clean': 'gear',
  'gear-elaborate': 'gear',
  gearcluster: 'gear',
  'rpm-clean': 'rpm',
  'rpm-elaborate': 'rpm',
  shiftbar: 'shift',
  shiftlights: 'shift',
  'delta-clean': 'delta',
  'delta-elaborate': 'delta',
  deltatile: 'delta',
  'sci-fi-delta-futuristic': 'delta',
  'lap-clean': 'laptime',
  'lap-elaborate': 'laptime',
  laptiming: 'laptime',
  digitalclock: 'laptime',
  'fuel-clean': 'fuel',
  'fuel-elaborate': 'fuel',
  fuelstint: 'fuel',
  'tyres-clean': 'tyres',
  'tyres-elaborate': 'tyres',
  tyregrid: 'tyres',
  cornerstack: 'tyres',
  'cold-pressures-futuristic': 'tyres',
  'cold-pressures-minimal': 'tyres',
  brakegrid: 'brakes',
  'position-clean': 'position',
  'position-elaborate': 'position',
  positiongaps: 'position',
  'relatives-clean': 'relatives',
  'relatives-elaborate': 'relatives',
  standings: 'standings',
  table: 'standings',
  'radar-clean': 'radar',
  'radar-elaborate': 'radar',
  radar: 'radar',
  'trackmap-clean': 'trackmap',
  'trackmap-elaborate': 'trackmap',
  trackmini: 'trackmap',
  map: 'trackmap',
  'inputs-clean': 'inputs',
  'inputs-elaborate': 'inputs',
  inputbars: 'inputs',
  inputtrace: 'inputs',
  'clutch-clean': 'inputs',
  'clutch-elaborate': 'inputs',
  steering: 'steering',
  weather: 'weather',
  'weather-status-futuristic': 'weather',
  'weather-status-minimal': 'weather',
  'temps-clean': 'enginetemps',
  'temps-elaborate': 'enginetemps',
  enginetemps: 'enginetemps',
  'flags-clean': 'flags',
  'flags-elaborate': 'flags',
  flagoverlay: 'flags',
  flag: 'flags',
  'pitlimiter-clean': 'pit',
  'pitlimiter-elaborate': 'pit',
  'pit-status-futuristic': 'pit',
  'pit-status-minimal': 'pit',
  'abs-clean': 'assists',
  'abs-elaborate': 'assists',
  'tc-clean': 'assists',
  'tc-elaborate': 'assists',
  'bb-clean': 'assists',
  'bb-elaborate': 'assists',
  'map-clean': 'assists',
  'map-elaborate': 'assists',
  'drs-clean': 'assists',
  'drs-elaborate': 'assists',
  setupstrip: 'assists',
  'incidents-clean': 'incidents',
  'incidents-elaborate': 'incidents',
  gforcemeter: 'gforce'
}

// Binding key → concept fallback for generic value/bar/gauge widgets.
const BINDING_CONCEPT: Array<{ test: (b: string) => boolean; concept: DashboardConcept }> = [
  { test: (b) => b.includes('fuel'), concept: 'fuel' },
  { test: (b) => b.includes('speed'), concept: 'speed' },
  { test: (b) => b.startsWith('rpm') || b === 'rpmPct', concept: 'rpm' },
  { test: (b) => b.includes('gear'), concept: 'gear' },
  { test: (b) => b.includes('shift'), concept: 'shift' },
  { test: (b) => b.includes('delta'), concept: 'delta' },
  { test: (b) => b.includes('Lap') || b.includes('lap'), concept: 'laptime' },
  { test: (b) => b.includes('tyre') || b.includes('tire'), concept: 'tyres' },
  { test: (b) => b.includes('brake') && b.includes('Temp'), concept: 'brakes' },
  { test: (b) => b.includes('throttle') || b.includes('brake') || b.includes('clutch'), concept: 'inputs' },
  { test: (b) => b.includes('position') || b.includes('Position'), concept: 'position' },
  { test: (b) => b.includes('gap') || b.includes('Gap'), concept: 'gaps' },
  { test: (b) => b.includes('relative') || b.includes('Relative'), concept: 'relatives' },
  { test: (b) => b.includes('water') || b.includes('oil') || b.includes('Temp'), concept: 'enginetemps' },
  { test: (b) => b.includes('flag') || b.includes('Flag'), concept: 'flags' },
  { test: (b) => b.includes('pit') || b.includes('Pit') || b.includes('limiter'), concept: 'pit' },
  { test: (b) => b.includes('incident') || b.includes('Incident'), concept: 'incidents' },
  { test: (b) => b.includes('steer') || b.includes('Steer'), concept: 'steering' },
  { test: (b) => b.includes('rain') || b.includes('grip') || b.includes('track') || b.includes('Track'), concept: 'weather' }
]

/** Best-effort concept for a placed dashboard element (type first, then binding). */
export function conceptForElement(el: { type: string; binding?: string }): DashboardConcept | undefined {
  const direct = TYPE_CONCEPT[el.type]
  if (direct) return direct
  // Curated/clean-elaborate types collapse to their base concept token.
  const base = el.type.replace(/-(clean|elaborate|futuristic|minimal)$/, '')
  if (base !== el.type && TYPE_CONCEPT[base]) return TYPE_CONCEPT[base]
  if (el.binding) {
    for (const rule of BINDING_CONCEPT) {
      if (rule.test(el.binding)) return rule.concept
    }
  }
  return undefined
}
