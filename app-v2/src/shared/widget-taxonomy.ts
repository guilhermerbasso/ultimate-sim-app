// Pure taxonomy + search/filter logic for the shared widget catalog (item: round-7
// widget library expansion). This module is React-free and DOM-free so it can be
// imported by both the renderer catalog (widget-catalog-data.ts) AND unit tests
// running in the node environment. It models the TWO independent axes the picker
// filters by:
//   • category    → the telemetry DOMAIN / role (Speed/Engine, Fuel, Tyres…)
//   • styleFamily → the VISUAL form (analog, digital, graph, chart, …)
// plus free-form tags. The gallery sections the catalog by `category` and offers
// category + style filter chips and a text search box.

export type WidgetCategoryTag =
  | 'Speed/Engine'
  | 'Timing/Delta'
  | 'Fuel'
  | 'Tyres/Brakes'
  | 'Position/Standings'
  | 'Inputs'
  | 'Flags/Status'
  | 'Track/Radar'
  | 'Charts/Graphs'
  | 'Analog'
  | 'Digital'
  | 'Text/Image'

// ─── Hardware / use-case dimension (real-cluster grouping) ───────────────────
// A SECOND, independent axis added in the catalog redesign. While `category`
// models the telemetry DOMAIN, `cluster` models how a widget maps onto a real
// race dashboard/cluster page (a DDU page, a tell-tale lamp bank, a stint panel…)
// so the gallery can lead with curated clusters instead of a wall of look-alike
// value tiles. It is OPTIONAL and ADDITIVE — existing `WidgetCategoryTag`
// consumers (sectioning + the per-sim filter) are untouched.
export type WidgetClusterTag =
  | 'Full-Frame Dashboards'
  | 'DDU / Cluster'
  | 'Tell-tales / Warning lamps'
  | 'Race Control / Flags'
  | 'Stint / Endurance'
  | 'Driver Aids'
  | 'Tyre / Brake'
  | 'Radar / Relative'
  | 'Timing / Delta'
  | 'Engine Vitals'
  | 'Weather / Track'

export const WIDGET_CLUSTER_ORDER: WidgetClusterTag[] = [
  'Full-Frame Dashboards',
  'DDU / Cluster',
  'Tell-tales / Warning lamps',
  'Race Control / Flags',
  'Stint / Endurance',
  'Driver Aids',
  'Tyre / Brake',
  'Radar / Relative',
  'Timing / Delta',
  'Engine Vitals',
  'Weather / Track'
]

export const WIDGET_CLUSTER_LABELS: Record<WidgetClusterTag, string> = {
  'Full-Frame Dashboards': 'Dashboards full-frame',
  'DDU / Cluster': 'DDU / Cluster',
  'Tell-tales / Warning lamps': 'Tell-tales / Luzes de aviso',
  'Race Control / Flags': 'Race Control / Bandeiras',
  'Stint / Endurance': 'Stint / Endurance',
  'Driver Aids': 'Driver Aids',
  'Tyre / Brake': 'Tires / Brakes',
  'Radar / Relative': 'Radar / Relativo',
  'Timing / Delta': 'Tempos / Delta',
  'Engine Vitals': 'Vitais do motor',
  'Weather / Track': 'Clima / Pista'
}

// Manufacturer-inspired style family (OPTIONAL cosmetic axis). Lets curated
// widgets nod to the real cluster hardware they evoke without affecting layout
// or coverage. Purely informational today (search/labelling only).
export type WidgetHardwareFamily =
  | 'MoTeC C127'
  | 'Cosworth ICD'
  | 'Bosch DDU 296'
  | 'Porsche Cup'
  | 'AiM'

export const WIDGET_HARDWARE_ORDER: WidgetHardwareFamily[] = [
  'MoTeC C127',
  'Cosworth ICD',
  'Bosch DDU 296',
  'Porsche Cup',
  'AiM'
]

// Visual style family. `style` was the field name suggested by the brief, but
// `WidgetVariant.style` is already the element's `DashboardElementStyle`; to avoid
// overloading that field across ~260 existing variants we expose the visual
// classification as `styleFamily` instead (same intent, no breaking rename).
export type WidgetStyleFamily =
  | 'analog'
  | 'digital'
  | 'clean'
  | 'graph'
  | 'chart'
  | 'bar'
  | 'ring'
  | 'led'
  | 'heatmap'
  | 'status'
  | 'text'
  | 'image'
  | 'gauge'
  | 'table'

// Ordered list used to section the gallery. Domain categories first, then the
// form-defined showcase categories.
export const WIDGET_CATEGORY_ORDER: WidgetCategoryTag[] = [
  'Speed/Engine',
  'Timing/Delta',
  'Fuel',
  'Tyres/Brakes',
  'Position/Standings',
  'Inputs',
  'Flags/Status',
  'Track/Radar',
  'Charts/Graphs',
  'Analog',
  'Digital',
  'Text/Image'
]

export const WIDGET_CATEGORY_LABELS: Record<WidgetCategoryTag, string> = {
  'Speed/Engine': 'Velocidade & Motor',
  'Timing/Delta': 'Tempos & Delta',
  Fuel: 'Fuel',
  'Tyres/Brakes': 'Tires & Brakes',
  'Position/Standings': 'Position & Qualifying',
  Inputs: 'Inputs do piloto',
  'Flags/Status': 'Bandeiras & Status',
  'Track/Radar': 'Pista & Radar',
  'Charts/Graphs': 'Graphs & Charts',
  Analog: 'Analog',
  Digital: 'Digitais (7-seg)',
  'Text/Image': 'Texto & Imagem'
}

export const WIDGET_STYLE_ORDER: WidgetStyleFamily[] = [
  'analog',
  'digital',
  'clean',
  'graph',
  'chart',
  'bar',
  'ring',
  'led',
  'heatmap',
  'status',
  'text',
  'image',
  'gauge',
  'table'
]

export const WIDGET_STYLE_LABELS: Record<WidgetStyleFamily, string> = {
  analog: 'Analog',
  digital: 'Digital 7-seg',
  clean: 'Digital limpo',
  graph: 'Graph (line)',
  chart: 'Chart (barras)',
  bar: 'Barra segmentada',
  ring: 'Anel / Arco',
  led: 'LED bar',
  heatmap: 'Heatmap',
  status: 'Status / Icon',
  text: 'Texto grande',
  image: 'Imagem',
  gauge: 'Mostrador',
  table: 'Tabela'
}

// Minimal projection of a catalog entry needed for search/filter/group. The full
// `WidgetVariant` (renderer side) structurally satisfies this, so the pure
// functions below operate on real variants without importing any React.
export interface WidgetTaxon {
  id: string
  label: string
  category: WidgetCategoryTag
  styleFamily: WidgetStyleFamily
  tags?: string[]
  hint?: string
  /** Optional hardware/use-case cluster (real-dashboard grouping axis). */
  cluster?: WidgetClusterTag
  /** Optional manufacturer-inspired style family (cosmetic axis). */
  hardwareFamily?: WidgetHardwareFamily
  /** Marks generated/secondary entries (e.g. the raw iRacing channel tiles) that
   *  the gallery demotes behind a collapsed "advanced" section. */
  advanced?: boolean
}

export interface WidgetFilterQuery {
  /** Free text — matches label, category, style, tags and hint (case-insensitive). */
  search?: string
  /** Exact category match when set (null/undefined = all). */
  category?: WidgetCategoryTag | null
  /** Exact style-family match when set (null/undefined = all). */
  styleFamily?: WidgetStyleFamily | null
  /** Exact hardware/use-case cluster match when set (null/undefined = all). */
  cluster?: WidgetClusterTag | null
  sim?: string | null
}

function haystack(v: WidgetTaxon): string {
  return [
    v.label,
    v.id,
    v.category,
    WIDGET_CATEGORY_LABELS[v.category] ?? '',
    v.styleFamily,
    WIDGET_STYLE_LABELS[v.styleFamily] ?? '',
    v.hint ?? '',
    v.cluster ?? '',
    v.cluster ? WIDGET_CLUSTER_LABELS[v.cluster] ?? '' : '',
    v.hardwareFamily ?? '',
    ...(v.tags ?? [])
  ]
    .join(' ')
    .toLowerCase()
}

// True when the variant matches every active facet of the query. An empty/blank
// search matches everything; multi-word searches require ALL tokens to be present
// (AND semantics) so "tyre temp" narrows progressively.
export function matchesQuery(v: WidgetTaxon, query: WidgetFilterQuery): boolean {
  if (query.category && v.category !== query.category) return false
  if (query.styleFamily && v.styleFamily !== query.styleFamily) return false
  if (query.cluster && v.cluster !== query.cluster) return false
  const search = (query.search ?? '').trim().toLowerCase()
  if (!search) return true
  const hay = haystack(v)
  return search.split(/\s+/).every((token) => hay.includes(token))
}

export function filterVariants<T extends WidgetTaxon>(variants: readonly T[], query: WidgetFilterQuery): T[] {
  return variants.filter((v) => matchesQuery(v, query))
}

export interface WidgetSection<T extends WidgetTaxon> {
  category: WidgetCategoryTag
  label: string
  variants: T[]
}

// Group variants into ordered sections by category, preserving input order within
// each section and dropping empty sections. Unknown categories (should not happen
// with typed data) are appended last under their own raw label.
export function groupVariantsByCategory<T extends WidgetTaxon>(variants: readonly T[]): WidgetSection<T>[] {
  const byCat = new Map<WidgetCategoryTag, T[]>()
  const extras = new Map<string, T[]>()
  for (const v of variants) {
    if (WIDGET_CATEGORY_ORDER.includes(v.category)) {
      const list = byCat.get(v.category) ?? []
      list.push(v)
      byCat.set(v.category, list)
    } else {
      const key = String(v.category)
      const list = extras.get(key) ?? []
      list.push(v)
      extras.set(key, list)
    }
  }
  const sections: WidgetSection<T>[] = []
  for (const category of WIDGET_CATEGORY_ORDER) {
    const list = byCat.get(category)
    if (list && list.length > 0) {
      sections.push({ category, label: WIDGET_CATEGORY_LABELS[category], variants: list })
    }
  }
  for (const [key, list] of extras) {
    sections.push({ category: key as WidgetCategoryTag, label: key, variants: list })
  }
  return sections
}

// Categories/styles that actually appear in a variant set — used to render only
// the relevant filter chips (keeps the palette honest as the catalog evolves).
export function availableCategories<T extends WidgetTaxon>(variants: readonly T[]): WidgetCategoryTag[] {
  const seen = new Set<WidgetCategoryTag>()
  for (const v of variants) seen.add(v.category)
  return WIDGET_CATEGORY_ORDER.filter((c) => seen.has(c))
}

export function availableStyles<T extends WidgetTaxon>(variants: readonly T[]): WidgetStyleFamily[] {
  const seen = new Set<WidgetStyleFamily>()
  for (const v of variants) seen.add(v.styleFamily)
  return WIDGET_STYLE_ORDER.filter((s) => seen.has(s))
}

// ─── Curated vs advanced partition ───────────────────────────────────────────
// The catalog leads with CURATED widgets; generated/secondary entries (the ~201
// raw iRacing channel tiles flagged `advanced`) are demoted behind a collapsed
// section. These pure helpers let the gallery and tests split the two cleanly.
export function isAdvancedVariant(v: WidgetTaxon): boolean {
  return v.advanced === true
}

export function partitionByAdvanced<T extends WidgetTaxon>(
  variants: readonly T[]
): { curated: T[]; advanced: T[] } {
  const curated: T[] = []
  const advanced: T[] = []
  for (const v of variants) (isAdvancedVariant(v) ? advanced : curated).push(v)
  return { curated, advanced }
}

// ─── Cluster (hardware/use-case) grouping ────────────────────────────────────
export interface WidgetClusterSection<T extends WidgetTaxon> {
  cluster: WidgetClusterTag
  label: string
  variants: T[]
}

// Group variants that declare a `cluster` into ordered cluster sections. Variants
// without a cluster are skipped (they still group fine by domain `category`).
export function groupVariantsByCluster<T extends WidgetTaxon>(
  variants: readonly T[]
): WidgetClusterSection<T>[] {
  const byCluster = new Map<WidgetClusterTag, T[]>()
  for (const v of variants) {
    if (!v.cluster) continue
    const list = byCluster.get(v.cluster) ?? []
    list.push(v)
    byCluster.set(v.cluster, list)
  }
  const sections: WidgetClusterSection<T>[] = []
  for (const cluster of WIDGET_CLUSTER_ORDER) {
    const list = byCluster.get(cluster)
    if (list && list.length > 0) {
      sections.push({ cluster, label: WIDGET_CLUSTER_LABELS[cluster], variants: list })
    }
  }
  return sections
}

export function availableClusters<T extends WidgetTaxon>(variants: readonly T[]): WidgetClusterTag[] {
  const seen = new Set<WidgetClusterTag>()
  for (const v of variants) if (v.cluster) seen.add(v.cluster)
  return WIDGET_CLUSTER_ORDER.filter((c) => seen.has(c))
}
