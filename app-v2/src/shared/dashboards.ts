// Modelo de dashboards (item 5/11) — janelas tela-cheia/janela em monitor 1 ou 2
// alimentadas por telemetria. Estilo inspirado no SimHub Dash Studio mas com
// modelo próprio, mais simples: cada dashboard tem largura/altura base, cor de
// fundo, e uma lista de elementos posicionados em pixels (x,y,w,h) sobre essa
// base — o renderer aplica scale para preencher a janela.
//
// Cada elemento tem um binding opcional a uma chave da telemetria normalizada
// (ver src/shared/telemetry.ts). Bindings reconhecidos:
//   - chaves simples: 'speedKmh', 'gear', 'rpm', 'maxRpm', 'currentLapTimeSec', etc.
//   - chaves derivadas (computadas no renderer): 'shiftPct', 'rpmPct', 'gearLabel',
//     'currentLapFmt', 'lastLapFmt', 'bestLapFmt', 'deltaBestFmt', 'deltaSessionBestFmt',
//     'sessionTimeLeftFmt', 'fuelLitersStr', 'fuelPerLapStr', 'fuelLapsLeftStr'
// Para elementos especiais ('shiftlights','bar','gauge','map','radar') o binding
// determina a métrica de entrada (ex.: 'shiftPct' para shiftlights, 'fuelLitersPct'
// para barras de fuel, etc.).

// Wave-16 dashboards (futuristic + minimalist) live in a separate owned module
// and are spread into BUILTIN_PRESETS below. dashboards-r16.ts only imports
// TYPES from here (erased at compile time), so this stays a one-way dependency
// with no runtime import cycle.
import { R16_PRESETS } from './dashboards-r16'
import { QUALI_PRESETS } from './dashboards-quali'
import { RACE_WET_PRESETS } from './dashboards-race-wet'
import { RACE_SUN_PRESETS } from './dashboards-race-sun'
import { RACE_FIRST_PRESETS } from './dashboards-race-first'
import { RACE_CHASE_PRESETS } from './dashboards-race-chase'
import { GT3_DENSE_50_PRESETS } from './dashboards-gt3-dense-50'
// Hi-fi COMPOSITION dashboards (self-contained leaf modules; each imports only the
// composition kit which imports TYPES from here). Authored in parallel, one file per
// theme, and spread into BUILTIN_PRESETS below. They compose the hi-fi per-telemetry
// widgets (`hifi:<id>`) into 1024×600 layouts.
import { HIFI_RACE_PRESETS } from './dashboards-hifi-race'
import { HIFI_ENDURANCE_PRESETS } from './dashboards-hifi-endurance'
import { HIFI_COACH_PRESETS } from './dashboards-hifi-coach'
import { HIFI_FAMILY_PRESETS } from './dashboards-hifi-family'
import {
  dashboardThirdPartyMetadataValidationError,
  type DashboardThirdPartyMetadata
} from './third-party-dashboard-catalog'
import { HIFI_CARS_PRESETS } from './dashboards-hifi-cars'
import { HIFI_COMPARE_PRESETS } from './dashboards-hifi-compare'
import { HIFI_DIAG_PRESETS } from './dashboards-hifi-diagnostics'
import { HIFI_THEMED_CAR_PRESETS } from './dashboards-hifi-themed-cars2'
// WS-5 cross-agent contract: the adaptive-dashboards agent owns this NEW module
// and exports ADAPTIVE_DASHBOARD_PRESET (a BUILTIN_PRESETS entry). It only imports
// the Dashboard TYPE from here, so this stays a one-way dependency with no runtime
// cycle. Registered first/prominent in BUILTIN_PRESETS below.
import {
  ADAPTIVE_DASHBOARD_ID,
  ADAPTIVE_DASHBOARD_PRESET,
  ADAPTIVE_DASHBOARD_TAGS,
  ADAPTIVE_MARKER,
  createAdaptiveDashboardPreset
} from './dashboard-adaptive-preset'
// WS-DASH cross-module contract: the full-frame dashboards (gridStackDash …
// lmuStintDash) live as overlay-widget COMPONENTS but are full-screen DASHBOARDS,
// so they are embedded into BUILTIN_PRESETS below via a single `overlaywidget`
// element that carries a `widgetId`. Only the TYPE is imported here, so this stays
// a compile-time (erased) reference with no runtime import cycle, even though
// overlays.ts imports the DashboardElement type from this module.
import type { OverlayWidgetId } from './overlays'
import {
  RELEASE_A_CATALOG_ORDER,
  RELEASE_A_RELEASED_AT,
  RELEASE_A_TAG
} from './catalog-order'
import { DASHBOARD_IDENTITY_CATALOG } from './dashboard-identity-catalog.generated'

export const DASHBOARD_ELEMENT_TYPES = [
  'text', 'rect', 'bar', 'barv', 'dualbar', 'deltabar', 'gauge', 'shiftlights',
  'map', 'radar', 'image', 'table', 'standings', 'flag', 'trace',
  'shiftbar', 'gearcluster', 'tyregrid', 'brakegrid', 'cornerstack', 'fuelstint',
  'deltatile', 'laptiming', 'positiongaps', 'flagoverlay', 'inputbars',
  'inputtrace', 'steering', 'setupstrip', 'enginetemps', 'weather', 'trackmini',
  'tyres-clean', 'tyres-elaborate', 'abs-clean', 'abs-elaborate', 'tc-clean',
  'tc-elaborate', 'map-clean', 'map-elaborate', 'bb-clean', 'bb-elaborate',
  'pitlimiter-clean', 'pitlimiter-elaborate', 'incidents-clean',
  'incidents-elaborate', 'relatives-clean', 'relatives-elaborate', 'radar-clean',
  'radar-elaborate', 'trackmap-clean', 'trackmap-elaborate', 'speed-clean',
  'speed-elaborate', 'gear-clean', 'gear-elaborate', 'rpm-clean', 'rpm-elaborate',
  'delta-clean', 'delta-elaborate', 'fuel-clean', 'fuel-elaborate', 'lap-clean',
  'lap-elaborate', 'position-clean', 'position-elaborate', 'flags-clean',
  'flags-elaborate', 'inputs-clean', 'inputs-elaborate', 'temps-clean',
  'temps-elaborate', 'clutch-clean', 'clutch-elaborate', 'drs-clean',
  'drs-elaborate', 'value', 'valuebar', 'valuegauge', 'analoggauge',
  'linearmeter', 'gforcemeter', 'segment7', 'digitalclock', 'bigtext',
  'historygraph', 'barchart', 'radialbars', 'donut', 'segmentbars', 'ringgauge',
  'ledbar', 'heatmap', 'statuslamp', 'ers-bar-futuristic', 'ers-bar-minimal',
  'ers-radial-futuristic', 'ers-radial-minimal', 'p2p-futuristic', 'p2p-minimal',
  'weather-status-futuristic', 'weather-status-minimal',
  'track-surface-futuristic', 'track-surface-minimal', 'bop-futuristic',
  'bop-minimal', 'cold-pressures-futuristic', 'cold-pressures-minimal',
  'clock-futuristic', 'clock-minimal', 'pit-status-futuristic',
  'pit-status-minimal', 'neon-ring-futuristic', 'segmented-gauge-futuristic',
  'sci-fi-delta-futuristic', 'hud-tile-futuristic', 'neon-bar-futuristic',
  'grid-gauge-futuristic', 'mono-tile-minimal', 'typo-readout-minimal',
  'hairline-bar-minimal', 'dot-gauge-minimal', 'stacked-readout-minimal',
  'arc-minimal', 'pred-catch-ahead-futuristic', 'pred-catch-ahead-minimal',
  'pred-caught-behind-futuristic', 'pred-caught-behind-minimal',
  'pred-fuel-margin-futuristic', 'pred-fuel-margin-minimal',
  'pred-tire-wear-futuristic', 'pred-tire-wear-minimal', 'pred-pace-futuristic',
  'pred-pace-minimal', 'coach-heatmap', 'coach-tips', 'coach-findings',
  'coach-sector-graph', 'engineer-feed', 'overlaywidget'
] as const

export type DashboardElementType = (typeof DASHBOARD_ELEMENT_TYPES)[number]

const DASHBOARD_ELEMENT_TYPE_SET = new Set<string>(DASHBOARD_ELEMENT_TYPES)

export function isDashboardElementType(value: unknown): value is DashboardElementType {
  return typeof value === 'string' && DASHBOARD_ELEMENT_TYPE_SET.has(value)
}

export type TextAlign = 'left' | 'center' | 'right'

export type TextTransform = 'none' | 'uppercase' | 'lowercase' | 'capitalize'

export type DashboardScaleMode = 'fit' | 'fill' | 'stretch'

export const DASHBOARD_TABLE_COLUMNS = [
  'pos', 'classPos', 'number', 'name', 'gap', 'class', 'license', 'iRating', 'laps'
] as const

export const DASHBOARD_DELTA_RANGE_SEC_MIN = 0.05
export const DASHBOARD_DELTA_RANGE_SEC_MAX = 10
export const DASHBOARD_TRACE_WIDTH_MIN = 0.5
export const DASHBOARD_TRACE_WIDTH_MAX = 8

export const DASHBOARD_CONFIG_MUTATION_DISABLED_REASON =
  'Dashboard import, reset, and delete are disabled until atomic dashboard directory transactions are available.'

export interface DashboardMutationToken {
  epoch: string
  revision: string | null
}

export interface DashboardStorageMetadata {
  storageEpoch?: string
  storageRevision?: string
}

export const EDITOR_VERSION_CONFLICT = 'EDITOR_VERSION_CONFLICT' as const
export interface EditorVersionConflict {
  code: typeof EDITOR_VERSION_CONFLICT
  id: string
  kind: 'updated' | 'deleted'
  remoteVersion: string | null
}
export type EditorRefreshAction = 'none' | 'reload' | 'conflict'

export function dashboardStorageVersion(value: DashboardStorageMetadata | null | undefined): string | null {
  return typeof value?.storageEpoch === 'string' && typeof value.storageRevision === 'string'
    ? `${value.storageEpoch}:${value.storageRevision}`
    : null
}

export function editorRefreshAction(dirty: boolean, loadedVersion: string | null, remoteVersion: string | null): EditorRefreshAction {
  return loadedVersion === remoteVersion ? 'none' : dirty ? 'conflict' : 'reload'
}

export function editorVersionConflict(id: string, remoteVersion: string | null): EditorVersionConflict {
  return { code: EDITOR_VERSION_CONFLICT, id, kind: remoteVersion === null ? 'deleted' : 'updated', remoteVersion }
}

export const DASHBOARD_STORAGE_UNAVAILABLE = 'DASHBOARD_STORAGE_UNAVAILABLE' as const
export type DashboardStorageUnavailableState = 'unloaded' | 'loading' | 'recovery' | 'unregistered'

export class DashboardStorageUnavailableError extends Error {
  readonly code = DASHBOARD_STORAGE_UNAVAILABLE
  constructor(readonly state: DashboardStorageUnavailableState, readonly reason: string) {
    super(`${DASHBOARD_STORAGE_UNAVAILABLE}: ${reason}`)
    this.name = 'DashboardStorageUnavailableError'
  }
}

export function isDashboardStorageUnavailableError(value: unknown): value is DashboardStorageUnavailableError {
  return value instanceof DashboardStorageUnavailableError ||
    (Boolean(value) && typeof value === 'object' && (value as { code?: unknown }).code === DASHBOARD_STORAGE_UNAVAILABLE)
}

export interface DashboardStorageSnapshot {
  files: Record<string, unknown>
  sizeBytes: number
  itemCount: number
  modifiedAt: number | null
}

export function observedDashboardMutationToken(
  value: DashboardStorageMetadata
): DashboardMutationToken {
  if (typeof value.storageEpoch !== 'string' || typeof value.storageRevision !== 'string') {
    throw new Error('Dashboard storage version is missing; refresh before changing saved dashboards.')
  }
  return { epoch: value.storageEpoch, revision: value.storageRevision }
}

// ── Estilo granular por "slot" de texto dentro de um widget ───────────────────
// Widgets compostos (ex.: um valor rotulado, tabelas/standings, gauges) desenham
// vários textos internos a partir de UM único DashboardElementStyle. Para estilizar
// CADA texto sestopmente, o estilo pode declarar overrides por slot em
// `slots[<nome>]`. Cada campo é opcional e cai no default do renderer quando missing
// (retro-compatibilidade: presets sem `slots` renderizam idênticos).
export interface TextSlotStyle {
  fontFamily?: string
  fontSize?: number
  fontColor?: string
  fontWeight?: number | string
  align?: TextAlign
  letterSpacing?: number // px
  textTransform?: TextTransform
  shadow?: string // valor CSS text-shadow (ex.: '0 0 6px #00BFFF'); '' desliga
}

// ── Instrument fidelity sub-spec (P0 instrument-primitive library) ────────────
// ADDITIVE & OPTIONAL. Drives the high-fidelity SVG instrument primitives in
// renderer/src/instruments (RevLedBar / AnalogDial / SegmentReadout / Telltale /
// DataTile / AlarmStrip). When `instrument` is absent EVERY widget renders exactly
// as before — these are pure fidelity knobs layered on top of the existing flat
// fields, never a replacement. See instruments/index.ts for the consuming API.
export type InstrumentTemplate =
  | 'revled'
  | 'dial'
  | 'segment'
  | 'telltale'
  | 'tile'
  | 'alarm'
  | 'bezelring'

export type InstrumentBezelKind = 'none' | 'thin' | 'chrome' | 'double'
export type InstrumentMaterialKind = 'matte' | 'carbon' | 'brushed'
export type InstrumentLedShape = 'led' | 'bar' | 'trapezoid'

// Per-part fine knobs. All optional; each falls back to the primitive's own default.
export interface InstrumentPartsSpec {
  led?: {
    segments?: number
    shape?: InstrumentLedShape
    bloom?: number // bloom strength as a fraction of LED radius
    flashAt?: number // 0..1 redline-flash threshold
    warnAt?: number // 0..1 green→amber boundary
    dangerAt?: number // 0..1 amber→red boundary
  }
  dial?: {
    startAngleDeg?: number
    endAngleDeg?: number
    majorTicks?: number
    minorPerMajor?: number
    damp?: number // 0..1 damped-needle retention per frame
    warnFrom?: number // value (gauge units) for the amber zone
    redlineFrom?: number // value (gauge units) for the red zone
  }
  needle?: { color?: string; width?: number; tail?: number }
  scale?: { showLabels?: boolean; majorLen?: number; minorLen?: number }
  segment?: { mode?: '7' | '14'; ghost?: boolean; digits?: number }
  tile?: { align?: TextAlign; numeric?: boolean }
}

export interface InstrumentStyleSpec {
  /** Which instrument primitive family this element should render as. */
  template?: InstrumentTemplate
  /** Bezel treatment for dial/ring templates. */
  bezel?: InstrumentBezelKind
  /** Surface material (matte / carbon weave / brushed metal). */
  material?: InstrumentMaterialKind
  /** Master glow toggle (LEDs/alerts only). */
  glow?: boolean
  /** Per-part fine knobs. */
  parts?: InstrumentPartsSpec
}

export interface DashboardElementStyle {
  background?: string
  border?: string
  borderWidth?: number
  radius?: number
  color?: string
  fontFamily?: string
  fontSize?: number
  fontWeight?: number | string
  align?: TextAlign
  padding?: number
  // Para bar/gauge/shiftlights/barv/dualbar/deltabar:
  fillColor?: string
  warnColor?: string
  dangerColor?: string
  warnAt?: number // 0..1
  dangerAt?: number // 0..1
  segments?: number // shiftlights
  // Texto literal (quando não há binding) ou prefixo/sufixo (com binding)
  text?: string
  prefix?: string
  suffix?: string
  decimals?: number
  // ── Imagem ────────────────────────────────────────────────────────────────
  // src: data-URL (data:image/...;base64,...) ou caminho file:// / http(s)
  src?: string
  fit?: 'cover' | 'contain' | 'fill' | 'none'
  opacity?: number // 0..1
  // ── Filtros de cor da imagem (compostos num único CSS `filter`) ─────────────
  // Todos opcionais e aditivos. Ausentes = identidade (imagem original intacta).
  filterGrayscale?: number // 0..1 — preto&branco
  filterSepia?: number // 0..1 — sépia
  redTint?: number // 0..1 — monocromático em tons de vermelho
  brightness?: number // 0..2 (1 = normal)
  contrast?: number // 0..2 (1 = normal)
  saturate?: number // 0..3 (1 = normal)
  hueRotate?: number // graus (-180..180)
  invert?: number // 0..1
  blur?: number // px
  // ── Dualbar (ex.: throttle + brake): binding secundário + cor secundária ──
  secondaryBinding?: string
  secondaryColor?: string
  dryndaryBinding?: string
  dryndaryColor?: string
  // ── Deltabar: range em segundos para mapear o ponteiro (default 1.0) ─────
  deltaRangeSec?: number
  // ── Flag: chave da flag a observar (ex.: 'yellow','blue','red','checkered')
  flagKey?: string
  // ── Trace (sparkline rolling): nº de amostras e cores extras ─────────────
  traceLength?: number // default 120
  traceColor2?: string // cor da segunda série (se houver secondaryBinding)
  traceWidth?: number // espessura da linha (default 1.5)
  // ── Table / standings: configuração das colunas e linhas máximas ─────────
  // colunas suportadas: 'pos','classPos','number','name','gap','class','license','iRating','laps'
  tableColumns?: string[]
  tableMaxRows?: number // default 8
  rowHeight?: number // px (sobre a base) — default = altura/linhas
  highlightPlayer?: boolean // default true
  showHeader?: boolean // default true
  headerColor?: string
  rowAltBackground?: string
  // ── Barv (vertical bar): direção de preenchimento de baixo p/ cima ───────
  reverse?: boolean // se true, preenche de cima p/ baixo
  // ── Widgets GT3 (config semântica) ─────────────────────────────────────────
  // Todos opcionais e aditivos. Lidos pelos renderers GT3 (gt3-widgets.tsx) e
  // pelos previews do editor. Defaults sensatos quando missing.
  flashAt?: number // shiftbar: ponto de flash (0..1) — default 0.97
  flashColor?: string // cor do flash (default branco/azul)
  glow?: boolean // brilho/LED glow nos segmentos ativos
  segmentShape?: 'led' | 'trapezoid' | 'bar' // shiftbar
  pitLimiterOverride?: boolean // shiftbar: pulso azul/branco quando limitador ativo
  unit?: string // 'kmh'|'mph'|'C'|'F'|'kpa'|'psi'|'bar'|'L'|'gal'
  accentColor?: string // cor de destaque do cluster/cartão
  showRpm?: boolean // gearcluster: mostrar mini-barra/numeral de RPM
  gridMode?: 'temp' | 'pressure' | 'wear' // tyregrid
  showLabels?: boolean // grids: rótulos LF/RF/LR/RR
  showAverage?: boolean // grids: média no centro
  // Limiares de rampa térmica (em unidade base: °C ou kPa) — override do default:
  coldAt?: number
  optimalAt?: number
  hotAt?: number
  criticalAt?: number
  targetValue?: number // tyregrid pressão: alvo (kPa)
  tolerance?: number // tyregrid pressão: tolerância (kPa)
  // Fuel/stint:
  reserveLaps?: number // laps de reserva a manter
  warnAtLaps?: number // alerta quando laps remaining < x
  enduranceMode?: boolean
  // Delta/lap timing:
  deltaReference?: 'best' | 'session' | 'last' // referência do delta
  showCurrent?: boolean
  showLast?: boolean
  showBest?: boolean
  showEstimated?: boolean
  // Position/flag/strip:
  showTotal?: boolean // positiongaps: mostrar /N total
  compact?: boolean
  includeIncidents?: boolean // flagoverlay/setupstrip
  // Inputs / steering:
  channels?: string[] // inputbars/inputtrace: ex.: ['throttle','brake','clutch']
  orientation?: 'h' | 'v'
  maxDegrees?: number // steering: range do steering
  showNumeric?: boolean
  // Multi-binding (widgets que precisam de várias séries; podem usar var:/expr:):
  fields?: string[] // setupstrip/enginetemps: subcampos visíveis
  bindingWater?: string
  bindingOil?: string
  bindingOilPressure?: string
  bindingAbs?: string
  bindingTc?: string
  bindingMap?: string
  bindingBrakeBias?: string
  // Curated widgets: display label/reference and auto-fit tuning.
  label?: string
  reference?: string
  minFontSize?: number
  maxFontSize?: number
  showIcon?: boolean
  showNeedle?: boolean
  // Cabeçalho genérico de cartão (rótulo curto em maiúsculas):
  title?: string
  // ── Round-7 extra widgets (analog/digital/graph/chart/ring/led/heatmap/status) ─
  // Todos opcionais e aditivos; lidos por dashboard/widgets/extra-widgets.tsx.
  gaugeMin?: number // início da escala (analoggauge/linearmeter/ringgauge/segment); default 0
  gaugeMax?: number // end da escala; default depende do canal (ex.: 320 km/h)
  ticks?: number // nº de marcações maiores na escala analógica (default 8)
  showValue?: boolean // mostrar leitura numérica no centro/abaixo (default true)
  graphStyle?: 'line' | 'area' | 'sparkline' // historygraph (default 'line')
  graphFill?: boolean // historygraph: preencher abaixo da linha
  autoRange?: boolean // historygraph: auto-escala min/max pela janela (default quando sem gaugeMin/Max)
  chartSource?: 'tyreTemp' | 'tyrePressure' | 'tyreWear' | 'brakeTemp' | 'inputs' | 'fuel' | 'lap'
  heatSource?: 'tyre' | 'brake' // heatmap
  statusKind?: 'abs' | 'tc' | 'drs' | 'pit' | 'flag' | 'rain' | 'limiter' // statuslamp
  statusOnText?: string // arbitrary-binding statuslamp true label
  statusOffText?: string // arbitrary-binding statuslamp false label
  digits?: number // segment7: nº de dígitos do backdrop fantasma (default 3)
  ghost?: boolean // segment7: desenhar dígitos "88:88" apagados behind (default true)
  needleColor?: string // cor do ponteiro analog (default = accentColor)
  ringThickness?: number // ringgauge/donut: espessura do anel em px (default auto)
  // ── Estilo granular por slot de texto (ver TextSlotStyle) ───────────────────
  // Mapa nome-do-slot → overrides. Slots bem conhecidos: 'label','value','header',
  // 'unit','title'. Widgets específicos expõem slots extras (ver WIDGET_SLOTS).
  slots?: Record<string, Partial<TextSlotStyle>>
  // ── Ordem de empilhamento (z) honrada pelo renderer ─────────────────────────
  // Ausente = 0. Empate desempata pela ordem do array (estável).
  zIndex?: number
  // ── Instrument fidelity sub-spec (ADDITIVE / OPTIONAL) ──────────────────────
  // High-fidelity SVG instrument knobs consumed by renderer/src/instruments.
  // Absent ⇒ widget renders exactly as before. Never replaces existing fields.
  instrument?: InstrumentStyleSpec
  // ── Skin system (ADDITIVE / OPTIONAL) ───────────────────────────────────────
  // Selects the two-skin visual language + brand style variant consumed by the
  // renderer skins/ + instruments/. Absent ⇒ the renderer default (gt3/generic).
  skin?: 'gt3' | 'hud'
  brandStyle?: 'generic' | 'stuttgart' | 'bavaria' | 'maranello'
}

export interface DashboardElement {
  id: string
  type: DashboardElementType
  x: number
  y: number
  w: number
  h: number
  binding?: string
  style: DashboardElementStyle
  name?: string
  visible?: boolean
  // Origem na importação (best-effort), para diagnóstico:
  sourceType?: string
  // ── WS-DASH: only for `type: 'overlaywidget'` ──────────────────────────────
  // Which registered overlay widget (WIDGET_COMPONENTS[widgetId]) to mount inside
  // this element's box. Ignored by every other element type.
  widgetId?: OverlayWidgetId
  // Renderer-only hi-fi module metadata for dynamic `hifi:<id>` overlay widgets.
  hifiModuleId?: string
}

// ── R19 seam: adaptive dashboard rule model (owned/extended by WS-ADAPTIVE) ────
// A single blink directive: pulse a target between its normal look and `color` at
// `hz` cycles/sec (default ~1.5). Used per-element and for the whole dashboard.
export interface AdaptiveBlink {
  color: string
  hz?: number
}

// What to do to ONE element while a given race-moment is active.
export interface AdaptiveElementRule {
  visible?: boolean // explicitly show (true) / hide (false) this element
  emphasis?: number // visual emphasis multiplier (1 = normal; >1 scales + raises z)
  blink?: AdaptiveBlink // blink this element in a colour
}

// A COMPLETE per-moment layout ("frame"). When a moment rule carries a frame,
// the adaptive runtime renders THIS element list instead of the base dashboard's
// — a full layout swap authored in the dashboard editor for that single moment.
// `elements` is a normal DashboardElement[] (same model the builder edits), so a
// frame can add/remove/resize/move/configure widgets freely. `bg` optionally
// overrides the dashboard background while the frame is active.
export interface AdaptiveMomentFrame {
  elements: DashboardElement[]
  bg?: string
  updatedAt?: number
}

// User rule for ONE race-moment / session-phase: which elements appear/disappear,
// per-element emphasis/blink, and an optional whole-dashboard blink. OPTIONALLY a
// full per-moment `frame` (complete layout swap). Precedence at runtime: if the
// active moment's rule has a `frame`, the runtime renders the frame's elements
// (full swap) and the light `elements`/`blink` overlay still applies ON TOP of
// the frame; when no frame is present the existing light-overlay behaviour over
// the base dashboard is used (back-compat).
export interface AdaptiveMomentRule {
  moment: string // race-moment / session-phase id (see shared/race-moment.ts)
  enabled?: boolean // default true; lets the user keep a rule but turn it off
  elements?: Record<string, AdaptiveElementRule> // elementId → rule
  blinkDashboard?: AdaptiveBlink // blink the WHOLE dashboard in a colour
  frame?: AdaptiveMomentFrame // OPTIONAL full layout for this moment (swap)
}

// Per-dashboard adaptive configuration stored ON the Dashboard. When enabled, the
// runtime applies these USER rules on top of the built-in adaptive plan.
export interface DashboardAdaptiveConfig {
  enabled?: boolean // master switch (default false → authored render)
  rules?: AdaptiveMomentRule[] // ordered; later rules win on conflicts
}

export interface Dashboard extends DashboardStorageMetadata {
  id: string
  name: string
  width: number
  height: number
  bg: string
  elements: DashboardElement[]
  // Como o canvas é escalado para a janela:
  //   'fit'     → letterbox (preserva proporção; pode deixar barras vazias) — padrão.
  //   'fill'    → cobre toda a janela (preserva proporção; pode cortar nas bordas).
  //   'stretch' → distorce X/Y independentes para preencher exatamente a janela.
  // Opcional para retro-compatibilidade: missing equivale a 'fit'.
  scaleMode?: DashboardScaleMode
  // ── R19 seam: per-race-moment adaptive rules (owned/extended by WS-ADAPTIVE) ──
  // When present + enabled, DashboardRoot applies these USER rules on top of the
  // built-in adaptive plan: per-element show/hide + emphasis + blink, and an
  // optional whole-dashboard blink, keyed by a race-moment / session-phase id.
  // Absent/disabled → dashboard renders exactly as authored (back-compat).
  adaptive?: DashboardAdaptiveConfig
  // Metadados opcionais (preview base64 PNG vindos do .simhubdash, autor, etc.)
  description?: string
  author?: string
  previewPng?: string // base64 (sem prefixo data:)
  thirdParty?: DashboardThirdPartyMetadata
  createdAt?: number
  updatedAt?: number
  hidden?: boolean
}

export const DEFAULT_DASHBOARD_PRESET_PRIORITY = 1000

export interface DashboardPreset {
  id: string
  name: string
  build: () => Dashboard
  tags?: string[]
  /** Lower values appear earlier in the preset gallery. Missing values use 1000. */
  priority?: number
  catalogOrder?: number
  releasedAt?: string
}

export interface DashboardSummary extends DashboardStorageMetadata {
  id: string
  name: string
  width: number
  height: number
  elementCount: number
  hasPreview: boolean
  description?: string
  author?: string
  thirdParty?: DashboardThirdPartyMetadata
  createdAt?: number
  updatedAt?: number
  hidden?: boolean
  /** Registry metadata only; never persisted into the dashboard document. */
  builtIn?: boolean
}

export interface DashboardDisplayInfo {
  id: number
  label: string
  bounds: { x: number; y: number; width: number; height: number }
  workArea: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  isPrimary: boolean
  isInternal: boolean
}

export interface DashboardOpenState {
  id: string
  displayId: number
  fullscreen: boolean
}

export interface DashboardStorageIssue {
  file: string
  path: string
  code?: string
  quarantinedFile?: string
  error: string
}

export interface DashboardOpenOptions {
  displayId?: number
  fullscreen?: boolean
  /** When true, the dashboard window opens in touch-kiosk mode (`?kiosk=1`). */
  kiosk?: boolean
}

export interface DashboardPlaylistItem {
  dashboardId: string
  displayId?: number
  fullscreen?: boolean
  // ── Additive (Touch Controls Dash) ──────────────────────────────────────────
  // A playlist entry can also reference an editable RGB button-box panel instead
  // of a dashboard. When `kind === 'touch-panel'`, `dashboardId` carries the panel
  // id (so the existing string-keyed persistence keeps the item) and `touchPanelId`
  // mirrors it. Absent/`'dashboard'` → a regular dashboard entry (back-compat).
  kind?: 'dashboard' | 'touch-panel'
  touchPanelId?: string
}

export interface DashboardPlaylist extends DashboardStorageMetadata {
  items: DashboardPlaylistItem[]
  updatedAt: number
}

const DANGEROUS_ID_KEYS = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype'])
function isDangerousId(value: string): boolean { return DANGEROUS_ID_KEYS.has(value) }
function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

export function dashboardIdRecord<T>(source?: Readonly<Record<string, T>>): Record<string, T> {
  const out = Object.create(null) as Record<string, T>
  for (const [key, value] of Object.entries(source ?? {})) if (!isDangerousId(key)) out[key] = value
  return out
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isSafeTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

const MAX_DASHBOARD_DIMENSION = 32_768
const MAX_DASHBOARD_ELEMENTS = 2_048
const MAX_ADAPTIVE_RULES = 256
const MAX_ADAPTIVE_ELEMENT_RULES = 2_048
const MAX_PLAIN_JSON_DEPTH = 64
const MAX_PLAIN_JSON_NODES = 200_000
const MAX_PLAIN_JSON_ARRAY_ITEMS = 8_192
const MAX_PLAIN_JSON_OBJECT_FIELDS = 4_096

interface PlainJsonValidationState {
  nodes: number
  stack: WeakSet<object>
}

function childPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`
}

function validatePlainJsonValue(
  value: unknown,
  path: string,
  state: PlainJsonValidationState,
  depth: number,
  allowUndefined: boolean
): string | null {
  state.nodes += 1
  if (state.nodes > MAX_PLAIN_JSON_NODES) return `${path} exceeds the plain JSON node limit.`
  if (depth > MAX_PLAIN_JSON_DEPTH) return `${path} exceeds the plain JSON depth limit.`
  if (value === undefined) return allowUndefined ? null : `${path} must not be undefined.`
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return null
  if (typeof value === 'number') return Number.isFinite(value) ? null : `${path} must contain only finite JSON numbers.`
  if (typeof value !== 'object') return `${path} must contain plain JSON data.`
  if (state.stack.has(value)) return `${path} must not contain a circular reference.`
  state.stack.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return `${path} must use the standard Array.prototype.`
      if (value.length > MAX_PLAIN_JSON_ARRAY_ITEMS) return `${path} has too many array entries.`
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string') return `${path} must not contain symbol keys.`
        if (key === 'length') continue
        if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) return `${path} contains a custom array key.`
      }
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (!descriptor) return `${path}[${index}] must not be a sparse array entry.`
        if (!descriptor.enumerable || !('value' in descriptor)) return `${path}[${index}] must be an enumerable data value.`
        const error = validatePlainJsonValue(descriptor.value, `${path}[${index}]`, state, depth + 1, false)
        if (error) return error
      }
      return null
    }
    if (!isRecord(value)) return `${path} must contain plain JSON objects.`
    const keys = Reflect.ownKeys(value)
    if (keys.length > MAX_PLAIN_JSON_OBJECT_FIELDS) return `${path} has too many object fields.`
    for (const key of keys) {
      if (typeof key !== 'string') return `${path} must not contain symbol keys.`
      const nextPath = childPath(path, key)
      if (isDangerousId(key)) return `${nextPath} is a dangerous key.`
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable || !('value' in descriptor)) return `${nextPath} must be an enumerable data value.`
      const error = validatePlainJsonValue(descriptor.value, nextPath, state, depth + 1, true)
      if (error) return error
    }
    return null
  } finally {
    state.stack.delete(value)
  }
}

function plainJsonValidationError(value: unknown, path = 'Dashboard'): string | null {
  try {
    return validatePlainJsonValue(value, path, { nodes: 0, stack: new WeakSet<object>() }, 0, false)
  } catch {
    return `${path} must contain plain JSON data.`
  }
}

const words = (value: string): string[] => value.split(' ')
const STYLE_STRINGS = words('background border color fontFamily fillColor warnColor dangerColor text prefix suffix src secondaryBinding secondaryColor dryndaryBinding dryndaryColor flagKey traceColor2 headerColor rowAltBackground flashColor unit accentColor bindingWater bindingOil bindingOilPressure bindingAbs bindingTc bindingMap bindingBrakeBias label reference title statusOnText statusOffText needleColor')
const STYLE_NUMBERS = words('borderWidth radius fontSize padding warnAt dangerAt segments decimals opacity filterGrayscale filterSepia redTint brightness contrast saturate hueRotate invert blur deltaRangeSec traceLength traceWidth tableMaxRows rowHeight flashAt coldAt optimalAt hotAt criticalAt targetValue tolerance reserveLaps warnAtLaps maxDegrees minFontSize maxFontSize gaugeMin gaugeMax ticks digits ringThickness zIndex')
const STYLE_BOOLEANS = words('highlightPlayer showHeader reverse glow pitLimiterOverride showRpm showLabels showAverage enduranceMode showCurrent showLast showBest showEstimated showTotal compact includeIncidents showNumeric showIcon showNeedle showValue graphFill autoRange ghost')
const STYLE_ARRAYS = words('tableColumns channels fields')
const STYLE_BINDINGS = words('secondaryBinding dryndaryBinding bindingWater bindingOil bindingOilPressure bindingAbs bindingTc bindingMap bindingBrakeBias flagKey')
const COUNT_BOUNDS: Record<string, readonly [number, number]> = {
  segments: [1, 256], decimals: [0, 6], traceLength: [8, 2_048],
  tableMaxRows: [1, 64], ticks: [1, 128], digits: [1, 32]
}
const STYLE_NUMBER_BOUNDS: Record<string, readonly [number, number]> = {
  borderWidth: [0, 4_096], radius: [0, MAX_DASHBOARD_DIMENSION],
  fontSize: [0, 4_096], padding: [0, MAX_DASHBOARD_DIMENSION],
  warnAt: [0, 1], dangerAt: [0, 1], opacity: [0, 1],
  filterGrayscale: [0, 1], filterSepia: [0, 1], redTint: [0, 1],
  brightness: [0, 2], contrast: [0, 2], saturate: [0, 3],
  hueRotate: [-180, 180], invert: [0, 1], blur: [0, 1_024],
  deltaRangeSec: [DASHBOARD_DELTA_RANGE_SEC_MIN, DASHBOARD_DELTA_RANGE_SEC_MAX],
  traceWidth: [DASHBOARD_TRACE_WIDTH_MIN, DASHBOARD_TRACE_WIDTH_MAX],
  rowHeight: [0, MAX_DASHBOARD_DIMENSION], flashAt: [0, 1],
  coldAt: [-1_000_000, 1_000_000], optimalAt: [-1_000_000, 1_000_000],
  hotAt: [-1_000_000, 1_000_000], criticalAt: [-1_000_000, 1_000_000],
  targetValue: [-1_000_000_000, 1_000_000_000], tolerance: [0, 1_000_000_000],
  reserveLaps: [0, 1_000_000], warnAtLaps: [0, 1_000_000],
  maxDegrees: [0, 1_000_000], minFontSize: [0, 4_096], maxFontSize: [0, 4_096],
  gaugeMin: [-1_000_000_000_000, 1_000_000_000_000],
  gaugeMax: [-1_000_000_000_000, 1_000_000_000_000],
  ringThickness: [0, 4_096], zIndex: [-1_000_000, 1_000_000]
}
const TABLE_COLUMNS = new Set<string>(DASHBOARD_TABLE_COLUMNS)
const STYLE_ENUMS: Record<string, readonly string[]> = {
  align: words('left center right'), fit: words('cover contain fill none'),
  segmentShape: words('led trapezoid bar'), gridMode: words('temp pressure wear'),
  deltaReference: words('best session last'), orientation: words('h v'),
  graphStyle: words('line area sparkline'),
  chartSource: words('tyreTemp tyrePressure tyreWear brakeTemp inputs fuel lap'),
  heatSource: words('tyre brake'), statusKind: words('abs tc drs pit flag rain limiter'),
  skin: words('gt3 hud'), brandStyle: words('generic stuttgart bavaria maranello')
}

function validateElementStyle(value: unknown, path: string): string | null {
  if (!isRecord(value)) return `${path} must be an object.`
  for (const key of STYLE_STRINGS) if (value[key] !== undefined && typeof value[key] !== 'string') return `${path}.${key} must be a string.`
  for (const key of STYLE_NUMBERS) if (value[key] !== undefined && !isFiniteNumber(value[key])) return `${path}.${key} must be a finite number.`
  for (const key of STYLE_BOOLEANS) if (value[key] !== undefined && typeof value[key] !== 'boolean') return `${path}.${key} must be a boolean.`
  for (const key of STYLE_ARRAYS) {
    if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key].some((item) => typeof item !== 'string'))) {
      return `${path}.${key} must be an array of strings.`
    }
    const array = value[key] as string[] | undefined
    if (array && array.length > (key === 'tableColumns' ? 16 : 64)) return `${path}.${key} has too many entries.`
    if (key === 'tableColumns' && array?.some((column) => !TABLE_COLUMNS.has(column))) return `${path}.tableColumns contains an unsupported column.`
    if (key === 'tableColumns' && array && new Set(array).size !== array.length) return `${path}.tableColumns contains duplicate columns.`
    if (array?.some(isDangerousId)) return `${path}.${key} contains a dangerous key.`
  }
  for (const key of STYLE_BINDINGS) if (typeof value[key] === 'string' && isDangerousId(value[key])) return `${path}.${key} is dangerous.`
  for (const [key, [min, max]] of Object.entries(COUNT_BOUNDS)) {
    if (value[key] !== undefined && (!Number.isInteger(value[key]) || (value[key] as number) < min || (value[key] as number) > max)) return `${path}.${key} must be an integer from ${min} to ${max}.`
  }
  for (const [key, [min, max]] of Object.entries(STYLE_NUMBER_BOUNDS)) {
    if (value[key] !== undefined && ((value[key] as number) < min || (value[key] as number) > max)) {
      return `${path}.${key} must be from ${min} to ${max}.`
    }
  }
  for (const [key, allowed] of Object.entries(STYLE_ENUMS)) {
    if (value[key] !== undefined && !allowed.includes(value[key] as string)) return `${path}.${key} is invalid.`
  }
  if (value.fontWeight !== undefined && typeof value.fontWeight !== 'string' && !isFiniteNumber(value.fontWeight)) {
    return `${path}.fontWeight must be a string or finite number.`
  }
  if (typeof value.fontWeight === 'number' && (value.fontWeight < 1 || value.fontWeight > 1_000)) {
    return `${path}.fontWeight must be from 1 to 1000.`
  }
  if (isFiniteNumber(value.gaugeMin) && isFiniteNumber(value.gaugeMax) && value.gaugeMax <= value.gaugeMin) {
    return `${path}.gaugeMax must be greater than gaugeMin.`
  }
  if (isFiniteNumber(value.minFontSize) && isFiniteNumber(value.maxFontSize) && value.maxFontSize < value.minFontSize) {
    return `${path}.maxFontSize must be greater than or equal to minFontSize.`
  }
  if (value.slots !== undefined) {
    if (!isRecord(value.slots)) return `${path}.slots must be an object.`
    if (Object.keys(value.slots).length > 128) return `${path}.slots has too many entries.`
    for (const [slot, raw] of Object.entries(value.slots)) {
      const slotPath = `${path}.slots[${JSON.stringify(slot)}]`
      if (isDangerousId(slot)) return `${slotPath} is dangerous.`
      if (!isRecord(raw)) return `${slotPath} must be an object.`
      for (const key of ['fontFamily', 'fontColor', 'shadow'] as const) if (raw[key] !== undefined && typeof raw[key] !== 'string') return `${slotPath}.${key} must be a string.`
      for (const key of ['fontSize', 'letterSpacing'] as const) if (raw[key] !== undefined && !isFiniteNumber(raw[key])) return `${slotPath}.${key} must be a finite number.`
      if (raw.fontWeight !== undefined && typeof raw.fontWeight !== 'string' && !isFiniteNumber(raw.fontWeight)) return `${slotPath}.fontWeight is invalid.`
      if (isFiniteNumber(raw.fontSize) && (raw.fontSize < 0 || raw.fontSize > 4_096)) return `${slotPath}.fontSize is out of range.`
      if (isFiniteNumber(raw.letterSpacing) && Math.abs(raw.letterSpacing) > 4_096) return `${slotPath}.letterSpacing is out of range.`
      if (typeof raw.fontWeight === 'number' && (raw.fontWeight < 1 || raw.fontWeight > 1_000)) return `${slotPath}.fontWeight is out of range.`
      if (raw.align !== undefined && !['left', 'center', 'right'].includes(raw.align as string)) return `${slotPath}.align is invalid.`
      if (raw.textTransform !== undefined && !['none', 'uppercase', 'lowercase', 'capitalize'].includes(raw.textTransform as string)) return `${slotPath}.textTransform is invalid.`
    }
  }
  if (value.instrument !== undefined) {
    if (!isRecord(value.instrument)) return `${path}.instrument must be an object.`
    const instrument = value.instrument
    for (const [key, allowed] of Object.entries({
      template: ['revled', 'dial', 'segment', 'telltale', 'tile', 'alarm', 'bezelring'],
      bezel: ['none', 'thin', 'chrome', 'double'],
      material: ['matte', 'carbon', 'brushed']
    })) if (instrument[key] !== undefined && !allowed.includes(instrument[key] as string)) return `${path}.instrument.${key} is invalid.`
    if (instrument.glow !== undefined && typeof instrument.glow !== 'boolean') return `${path}.instrument.glow must be a boolean.`
    if (instrument.parts !== undefined) {
      if (!isRecord(instrument.parts)) return `${path}.instrument.parts must be an object.`
      const partNumberBounds: Record<string, Readonly<Record<string, readonly [number, number]>>> = {
        led: {
          segments: [1, 256], bloom: [0, 16], flashAt: [0, 1], warnAt: [0, 1], dangerAt: [0, 1]
        },
        dial: {
          startAngleDeg: [-3_600, 3_600], endAngleDeg: [-3_600, 3_600],
          majorTicks: [1, 128], minorPerMajor: [0, 32], damp: [0, 1],
          warnFrom: [-1_000_000_000, 1_000_000_000],
          redlineFrom: [-1_000_000_000, 1_000_000_000]
        },
        needle: { width: [0, 4_096], tail: [-4_096, 4_096] },
        scale: { majorLen: [0, 4_096], minorLen: [0, 4_096] },
        segment: { digits: [1, 32] }
      }
      for (const [partName, bounds] of Object.entries(partNumberBounds)) {
        const part = instrument.parts[partName]
        if (part === undefined) continue
        if (!isRecord(part)) return `${path}.instrument.parts.${partName} must be an object.`
        for (const [key, [min, max]] of Object.entries(bounds)) {
          if (part[key] !== undefined && !isFiniteNumber(part[key])) return `${path}.instrument.parts.${partName}.${key} must be finite.`
          if (isFiniteNumber(part[key]) && ((part[key] as number) < min || (part[key] as number) > max)) {
            return `${path}.instrument.parts.${partName}.${key} must be from ${min} to ${max}.`
          }
        }
      }
      const { led, needle, scale, segment, tile } = instrument.parts
      const countBounds: Array<[unknown, string, number, number]> = [
        [isRecord(led) ? led.segments : undefined, 'led.segments', 1, 256],
        [isRecord(instrument.parts.dial) ? instrument.parts.dial.majorTicks : undefined, 'dial.majorTicks', 1, 128],
        [isRecord(instrument.parts.dial) ? instrument.parts.dial.minorPerMajor : undefined, 'dial.minorPerMajor', 0, 32],
        [isRecord(segment) ? segment.digits : undefined, 'segment.digits', 1, 32]
      ]
      for (const [raw, key, min, max] of countBounds) if (raw !== undefined && (!Number.isInteger(raw) || (raw as number) < min || (raw as number) > max)) return `${path}.instrument.parts.${key} is out of range.`
      if (isRecord(led) && led.shape !== undefined && !['led', 'bar', 'trapezoid'].includes(led.shape as string)) return `${path}.instrument.parts.led.shape is invalid.`
      if (isRecord(needle) && needle.color !== undefined && typeof needle.color !== 'string') return `${path}.instrument.parts.needle.color must be a string.`
      if (isRecord(scale) && scale.showLabels !== undefined && typeof scale.showLabels !== 'boolean') return `${path}.instrument.parts.scale.showLabels must be a boolean.`
      if (isRecord(segment)) {
        if (segment.mode !== undefined && segment.mode !== '7' && segment.mode !== '14') return `${path}.instrument.parts.segment.mode is invalid.`
        if (segment.ghost !== undefined && typeof segment.ghost !== 'boolean') return `${path}.instrument.parts.segment.ghost must be a boolean.`
      }
      if (tile !== undefined) {
        if (!isRecord(tile)) return `${path}.instrument.parts.tile must be an object.`
        if (tile.align !== undefined && !['left', 'center', 'right'].includes(tile.align as string)) return `${path}.instrument.parts.tile.align is invalid.`
        if (tile.numeric !== undefined && typeof tile.numeric !== 'boolean') return `${path}.instrument.parts.tile.numeric must be a boolean.`
      }
    }
  }
  return null
}

function validateBlink(value: unknown, path: string): string | null {
  if (!isRecord(value) || typeof value.color !== 'string' || !value.color) {
    return `${path} must contain a non-empty color.`
  }
  if (value.hz !== undefined && (!isFiniteNumber(value.hz) || value.hz < 0.01 || value.hz > 120)) {
    return `${path}.hz must be a finite number from 0.01 to 120.`
  }
  return null
}

function validateElementList(value: unknown, width: number, height: number, path: string): string | null {
  if (!Array.isArray(value)) return `${path} must be an array.`
  if (value.length > MAX_DASHBOARD_ELEMENTS) return `${path} has too many elements.`
  const ids = new Set<string>()
  for (let index = 0; index < value.length; index += 1) {
    const element = value[index]
    const elementPath = `${path}[${index}]`
    if (!isRecord(element)) return `${elementPath} must be an object.`
    if (typeof element.id !== 'string' || !element.id.trim()) return `${elementPath}.id is required.`
    if (element.id.length > 512) return `${elementPath}.id is too long.`
    if (isDangerousId(element.id)) return `${elementPath}.id is dangerous.`
    if (ids.has(element.id)) return `${path} contains duplicate element id "${element.id}".`
    ids.add(element.id)
    if (!isDashboardElementType(element.type)) return `${elementPath}.type is not supported.`
    for (const key of ['widgetId', 'hifiModuleId'] as const) {
      if (element[key] !== undefined && (typeof element[key] !== 'string' || !element[key].trim())) return `${elementPath}.${key} must be a non-empty string.`
      if (typeof element[key] === 'string' && element[key].length > 512) return `${elementPath}.${key} is too long.`
      if (typeof element[key] === 'string' && isDangerousId(element[key])) return `${elementPath}.${key} is dangerous.`
    }
    if (element.type !== 'overlaywidget' && (element.widgetId !== undefined || element.hifiModuleId !== undefined)) {
      return `${elementPath} may only declare widgetId or hifiModuleId for overlaywidget elements.`
    }
    if (element.type === 'overlaywidget') {
      if (!element.widgetId && !element.hifiModuleId) return `${elementPath} overlaywidget requires widgetId or hifiModuleId.`
      if (typeof element.widgetId === 'string' && element.widgetId.startsWith('hifi:')) {
        const moduleId = element.widgetId.slice('hifi:'.length)
        if (!moduleId) return `${elementPath}.widgetId requires a hi-fi module id.`
        if (isDangerousId(moduleId)) return `${elementPath}.widgetId contains a dangerous hi-fi module id.`
        if (typeof element.hifiModuleId === 'string' && element.hifiModuleId !== moduleId) {
          return `${elementPath}.widgetId and hifiModuleId must identify the same hi-fi module.`
        }
      } else if (element.widgetId && element.hifiModuleId) {
        return `${elementPath}.hifiModuleId requires a hifi: widgetId.`
      }
    }
    if (!isFiniteNumber(element.x) || !isFiniteNumber(element.y) ||
      !isFiniteNumber(element.w) || !isFiniteNumber(element.h)) {
      return `${elementPath} geometry must contain finite numbers.`
    }
    if (element.x < 0 || element.y < 0 || element.w <= 0 || element.h <= 0 ||
      element.x + element.w > width || element.y + element.h > height) {
      return `${elementPath} geometry must stay inside the dashboard without clamping.`
    }
    const styleError = validateElementStyle(element.style, `${elementPath}.style`)
    if (styleError) return styleError
    if (element.binding !== undefined && typeof element.binding !== 'string') return `${elementPath}.binding must be a string.`
    if (typeof element.binding === 'string' && !element.binding.trim()) return `${elementPath}.binding must be a non-empty string.`
    if (typeof element.binding === 'string' && isDangerousId(element.binding)) return `${elementPath}.binding is dangerous.`
    if (element.name !== undefined && typeof element.name !== 'string') return `${elementPath}.name must be a string.`
    if (element.sourceType !== undefined && typeof element.sourceType !== 'string') return `${elementPath}.sourceType must be a string.`
    if (element.visible !== undefined && typeof element.visible !== 'boolean') return `${elementPath}.visible must be a boolean.`
  }
  return null
}

function validateAdaptive(value: unknown, width: number, height: number): string | null {
  if (!isRecord(value)) return 'adaptive must be an object.'
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
    return 'adaptive.enabled must be a boolean.'
  }
  if (value.rules === undefined) return null
  if (!Array.isArray(value.rules)) return 'adaptive.rules must be an array.'
  if (value.rules.length > MAX_ADAPTIVE_RULES) return 'adaptive.rules has too many entries.'
  const moments = new Set<string>()
  for (let index = 0; index < value.rules.length; index += 1) {
    const rule = value.rules[index]
    const path = `adaptive.rules[${index}]`
    if (!isRecord(rule) || typeof rule.moment !== 'string' || !rule.moment.trim()) return `${path}.moment is required.`
    if (rule.moment.length > 512) return `${path}.moment is too long.`
    if (isDangerousId(rule.moment)) return `${path}.moment is dangerous.`
    if (moments.has(rule.moment)) return `adaptive.rules contains duplicate moment "${rule.moment}".`
    moments.add(rule.moment)
    if (rule.enabled !== undefined && typeof rule.enabled !== 'boolean') return `${path}.enabled must be a boolean.`
    if (rule.blinkDashboard !== undefined) {
      const error = validateBlink(rule.blinkDashboard, `${path}.blinkDashboard`)
      if (error) return error
    }
    if (rule.elements !== undefined) {
      if (!isRecord(rule.elements)) return `${path}.elements must be an object.`
      if (Object.keys(rule.elements).length > MAX_ADAPTIVE_ELEMENT_RULES) return `${path}.elements has too many entries.`
      for (const [elementId, rawElementRule] of Object.entries(rule.elements)) {
        const elementPath = `${path}.elements[${JSON.stringify(elementId)}]`
        if (!elementId.trim() || !isRecord(rawElementRule)) return `${elementPath} must be an object.`
        if (isDangerousId(elementId)) return `${elementPath} is dangerous.`
        if (rawElementRule.visible !== undefined && typeof rawElementRule.visible !== 'boolean') return `${elementPath}.visible must be a boolean.`
        if (rawElementRule.emphasis !== undefined &&
          (!isFiniteNumber(rawElementRule.emphasis) || rawElementRule.emphasis <= 0 || rawElementRule.emphasis > 64)) {
          return `${elementPath}.emphasis must be a finite number greater than 0 and at most 64.`
        }
        if (rawElementRule.blink !== undefined) {
          const error = validateBlink(rawElementRule.blink, `${elementPath}.blink`)
          if (error) return error
        }
      }
    }
    if (rule.frame !== undefined) {
      if (!isRecord(rule.frame)) return `${path}.frame must be an object.`
      const error = validateElementList(rule.frame.elements, width, height, `${path}.frame.elements`)
      if (error) return error
      if (rule.frame.bg !== undefined && typeof rule.frame.bg !== 'string') return `${path}.frame.bg must be a string.`
      if (rule.frame.updatedAt !== undefined && !isSafeTimestamp(rule.frame.updatedAt)) return `${path}.frame.updatedAt must be a safe integer.`
    }
  }
  return null
}

function dashboardValidationErrorUnsafe(value: unknown): string | null {
  const plainJsonError = plainJsonValidationError(value)
  if (plainJsonError) return plainJsonError
  if (!isRecord(value)) return 'Dashboard must be an object.'
  if (typeof value.id !== 'string' || !value.id.trim()) return 'Dashboard id is required.'
  if (value.id.length > 512) return 'Dashboard id is too long.'
  if (isDangerousId(value.id)) return 'Dashboard id is dangerous.'
  if (typeof value.name !== 'string' || !value.name.trim()) return 'Dashboard name is required.'
  if (typeof value.bg !== 'string') return 'Dashboard background must be a string.'
  if (!isFiniteNumber(value.width) || value.width <= 0 || value.width > MAX_DASHBOARD_DIMENSION) return `Dashboard width must be positive, finite, and at most ${MAX_DASHBOARD_DIMENSION}.`
  if (!isFiniteNumber(value.height) || value.height <= 0 || value.height > MAX_DASHBOARD_DIMENSION) return `Dashboard height must be positive, finite, and at most ${MAX_DASHBOARD_DIMENSION}.`
  if (value.scaleMode !== undefined && value.scaleMode !== 'fit' && value.scaleMode !== 'fill' && value.scaleMode !== 'stretch') return 'Dashboard scaleMode is invalid.'
  if (value.hidden !== undefined && typeof value.hidden !== 'boolean') return 'Dashboard hidden must be a boolean.'
  for (const key of ['description', 'author', 'previewPng'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') return `Dashboard ${key} must be a string.`
  }
  if (value.thirdParty !== undefined) {
    const thirdPartyError = dashboardThirdPartyMetadataValidationError(value.thirdParty)
    if (thirdPartyError) return `Dashboard ${thirdPartyError}`
  }
  for (const key of ['storageEpoch', 'storageRevision'] as const) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || !value[key].trim())) {
      return `Dashboard ${key} must be a non-empty string.`
    }
  }
  if ((value.storageEpoch === undefined) !== (value.storageRevision === undefined)) {
    return 'Dashboard storageEpoch and storageRevision must be provided together.'
  }
  if (value.createdAt !== undefined && !isSafeTimestamp(value.createdAt)) return 'Dashboard createdAt must be a safe integer.'
  if (value.updatedAt !== undefined && !isSafeTimestamp(value.updatedAt)) return 'Dashboard updatedAt must be a safe integer.'
  const elementError = validateElementList(value.elements, value.width, value.height, 'elements')
  if (elementError) return elementError
  return value.adaptive === undefined ? null : validateAdaptive(value.adaptive, value.width, value.height)
}

export function dashboardValidationError(value: unknown): string | null {
  try {
    return dashboardValidationErrorUnsafe(value)
  } catch {
    return 'Dashboard contains an unreadable or unsafe value.'
  }
}

export interface DashboardIdentityCatalogEntry {
  id: string
  type: DashboardElementType
  label?: string
  name?: string
  binding?: string
  widgetId?: string
  hifiModuleId?: string
}

export interface DashboardStorageValidationOptions {
  identityCatalog?: readonly DashboardIdentityCatalogEntry[]
}

export type DashboardStorageMigrationCode =
  | 'table-column-last-to-laps'
  | 'derive-widget-id'
  | 'derive-hifi-module-id'
  | 'catalog-overlay-identity'
  | 'remove-empty-binding'
  | 'remove-empty-overlay-identity'

export interface DashboardStorageMigration {
  code: DashboardStorageMigrationCode
  path: string
  from: unknown
  to: unknown
}

export type DashboardStorageValidationResult =
  | { status: 'valid'; dashboard: Dashboard; migrations: DashboardStorageMigration[] }
  | { status: 'migrated'; dashboard: Dashboard; migrations: DashboardStorageMigration[] }
  | { status: 'quarantine'; error: string; migrations: DashboardStorageMigration[] }

interface CatalogElementIdentity {
  widgetId?: string
  hifiModuleId?: string
}

function catalogIdentityKey(type: string, name: string, binding: string | undefined): string {
  return JSON.stringify([type, name, binding ?? null])
}

function catalogIdentityIndex(
  catalog: readonly DashboardIdentityCatalogEntry[]
): Map<string, CatalogElementIdentity[]> {
  const index = new Map<string, CatalogElementIdentity[]>()
  for (const entry of catalog) {
    if (entry.type !== 'overlaywidget') continue
    let widgetId = typeof entry.widgetId === 'string' && entry.widgetId.trim() ? entry.widgetId : undefined
    let hifiModuleId = typeof entry.hifiModuleId === 'string' && entry.hifiModuleId.trim() ? entry.hifiModuleId : undefined
    if (!widgetId && hifiModuleId) widgetId = `hifi:${hifiModuleId}`
    if (widgetId?.startsWith('hifi:') && !hifiModuleId) hifiModuleId = widgetId.slice('hifi:'.length) || undefined
    if (!widgetId && !hifiModuleId) continue
    if (widgetId?.startsWith('hifi:') && hifiModuleId && widgetId !== `hifi:${hifiModuleId}`) continue
    const identity = { widgetId, hifiModuleId }
    const names = new Set([entry.id, entry.label, entry.name].filter((name): name is string => Boolean(name)))
    for (const name of names) {
      const key = catalogIdentityKey(entry.type, name, entry.binding)
      const existing = index.get(key) ?? []
      if (!existing.some((candidate) => candidate.widgetId === widgetId && candidate.hifiModuleId === hifiModuleId)) {
        existing.push(identity)
        index.set(key, existing)
      }
    }
  }
  return index
}

function migrateStoredElement(
  element: Record<string, unknown>,
  path: string,
  identityIndex: ReadonlyMap<string, CatalogElementIdentity[]>,
  migrations: DashboardStorageMigration[]
): void {
  if (element.binding === '') {
    delete element.binding
    migrations.push({ code: 'remove-empty-binding', path: `${path}.binding`, from: '', to: undefined })
  }
  if (isRecord(element.style) && Array.isArray(element.style.tableColumns) &&
    element.style.tableColumns.some((column) => column === 'last')) {
    const from = [...element.style.tableColumns]
    const to = element.style.tableColumns.map((column) => column === 'last' ? 'laps' : column)
    element.style.tableColumns = to
    migrations.push({ code: 'table-column-last-to-laps', path: `${path}.style.tableColumns`, from, to: [...to] })
  }
  if (element.type !== 'overlaywidget') return

  for (const key of ['widgetId', 'hifiModuleId'] as const) {
    if (typeof element[key] === 'string' && !element[key].trim()) {
      const from = element[key]
      delete element[key]
      migrations.push({ code: 'remove-empty-overlay-identity', path: `${path}.${key}`, from, to: undefined })
    }
  }

  const widgetId = typeof element.widgetId === 'string' ? element.widgetId : undefined
  const hifiModuleId = typeof element.hifiModuleId === 'string' ? element.hifiModuleId : undefined
  if (element.widgetId === undefined && hifiModuleId) {
    const next = `hifi:${hifiModuleId}`
    element.widgetId = next
    migrations.push({ code: 'derive-widget-id', path: `${path}.widgetId`, from: undefined, to: next })
    return
  }
  if (widgetId?.startsWith('hifi:') && element.hifiModuleId === undefined) {
    const next = widgetId.slice('hifi:'.length)
    if (next) {
      element.hifiModuleId = next
      migrations.push({ code: 'derive-hifi-module-id', path: `${path}.hifiModuleId`, from: undefined, to: next })
    }
    return
  }
  if (widgetId || hifiModuleId) return

  const name = typeof element.name === 'string' ? element.name : undefined
  const binding = typeof element.binding === 'string' ? element.binding : undefined
  if (!name) return
  const candidates = identityIndex.get(catalogIdentityKey('overlaywidget', name, binding)) ?? []
  if (candidates.length !== 1) return
  const [identity] = candidates
  if (identity.widgetId) element.widgetId = identity.widgetId
  if (identity.hifiModuleId) element.hifiModuleId = identity.hifiModuleId
  migrations.push({
    code: 'catalog-overlay-identity',
    path,
    from: { widgetId: undefined, hifiModuleId: undefined },
    to: { ...(identity.widgetId ? { widgetId: identity.widgetId } : {}), ...(identity.hifiModuleId ? { hifiModuleId: identity.hifiModuleId } : {}) }
  })
}

function migrateStoredElementList(
  value: unknown,
  path: string,
  identityIndex: ReadonlyMap<string, CatalogElementIdentity[]>,
  migrations: DashboardStorageMigration[]
): void {
  if (!Array.isArray(value)) return
  for (let index = 0; index < value.length; index += 1) {
    if (isRecord(value[index])) migrateStoredElement(value[index], `${path}[${index}]`, identityIndex, migrations)
  }
}

/**
 * Per-file storage contract. Unambiguous legacy shapes are returned as a migrated
 * dashboard to rewrite atomically; all other invalid files are explicitly marked
 * for quarantine so a caller can keep loading unrelated valid dashboard files.
 */
function dashboardStorageValidationResultUnsafe(
  value: unknown,
  options: DashboardStorageValidationOptions = {}
): DashboardStorageValidationResult {
  const plainJsonError = plainJsonValidationError(value)
  if (plainJsonError) return { status: 'quarantine', error: plainJsonError, migrations: [] }

  let migratedValue: unknown
  try {
    migratedValue = structuredClone(value)
  } catch {
    return { status: 'quarantine', error: 'Dashboard could not be cloned as plain JSON data.', migrations: [] }
  }
  const migrations: DashboardStorageMigration[] = []
  const identityIndex = catalogIdentityIndex(options.identityCatalog ?? [])
  if (isRecord(migratedValue)) {
    migrateStoredElementList(migratedValue.elements, 'elements', identityIndex, migrations)
    if (isRecord(migratedValue.adaptive) && Array.isArray(migratedValue.adaptive.rules)) {
      for (let index = 0; index < migratedValue.adaptive.rules.length; index += 1) {
        const rule = migratedValue.adaptive.rules[index]
        if (isRecord(rule) && isRecord(rule.frame)) {
          migrateStoredElementList(rule.frame.elements, `adaptive.rules[${index}].frame.elements`, identityIndex, migrations)
        }
      }
    }
  }
  const error = dashboardValidationError(migratedValue)
  if (error) return { status: 'quarantine', error, migrations }
  if (migrations.length > 0) return { status: 'migrated', dashboard: migratedValue as Dashboard, migrations }
  return { status: 'valid', dashboard: value as Dashboard, migrations }
}

export function dashboardStorageValidationResult(
  value: unknown,
  options: DashboardStorageValidationOptions = {}
): DashboardStorageValidationResult {
  try {
    return dashboardStorageValidationResultUnsafe(value, options)
  } catch {
    return { status: 'quarantine', error: 'Dashboard contains an unreadable or unsafe value.', migrations: [] }
  }
}

export function isDashboard(value: unknown): value is Dashboard {
  return dashboardValidationError(value) === null
}

function dashboardPlaylistValidationErrorUnsafe(value: unknown): string | null {
  const plainJsonError = plainJsonValidationError(value, 'Dashboard playlist')
  if (plainJsonError) return plainJsonError
  if (!isRecord(value) || !Array.isArray(value.items)) return 'Dashboard playlist must contain an items array.'
  if (value.items.length > MAX_PLAIN_JSON_ARRAY_ITEMS) return 'Dashboard playlist has too many items.'
  if (!isSafeTimestamp(value.updatedAt)) return 'Dashboard playlist updatedAt must be a safe integer.'
  for (let index = 0; index < value.items.length; index += 1) {
    const item = value.items[index]
    const path = `items[${index}]`
    if (!isRecord(item) || typeof item.dashboardId !== 'string' || !item.dashboardId) return `${path}.dashboardId is required.`
    if (isDangerousId(item.dashboardId)) return `${path}.dashboardId is dangerous.`
    if (item.displayId !== undefined && !isFiniteNumber(item.displayId)) return `${path}.displayId must be finite.`
    if (item.fullscreen !== undefined && typeof item.fullscreen !== 'boolean') return `${path}.fullscreen must be a boolean.`
    if (item.kind !== undefined && item.kind !== 'dashboard' && item.kind !== 'touch-panel') return `${path}.kind is invalid.`
    if (item.touchPanelId !== undefined && typeof item.touchPanelId !== 'string') return `${path}.touchPanelId must be a string.`
    if (typeof item.touchPanelId === 'string' && isDangerousId(item.touchPanelId)) return `${path}.touchPanelId is dangerous.`
  }
  return null
}

export function dashboardPlaylistValidationError(value: unknown): string | null {
  try {
    return dashboardPlaylistValidationErrorUnsafe(value)
  } catch {
    return 'Dashboard playlist contains an unreadable or unsafe value.'
  }
}

// ─── Chaves de binding reconhecidas pelo renderer ─────────────────────────────
// Lista exposta para UI (autocomplete/selectbox no construtor).
export interface DashboardBindingDef {
  key: string
  label: string
  group: string
  numeric: boolean
}

export const DASHBOARD_BINDINGS: DashboardBindingDef[] = [
  { key: 'speedKmh', label: 'Speed (km/h)', group: 'Car', numeric: true },
  { key: 'rpm', label: 'RPM', group: 'Car', numeric: true },
  { key: 'rpmPct', label: 'RPM (% of max)', group: 'Car', numeric: true },
  { key: 'shiftPct', label: 'Shift indicator (0–1)', group: 'Car', numeric: true },
  { key: 'gear', label: 'Gear (number)', group: 'Car', numeric: true },
  { key: 'gearLabel', label: 'Gear (text: R/N/1..n)', group: 'Car', numeric: false },
  { key: 'throttle', label: 'Throttle (0?1)', group: 'Inputs', numeric: true },
  { key: 'brake', label: 'Brake (0–1)', group: 'Inputs', numeric: true },
  { key: 'clutch', label: 'Clutch (0?1)', group: 'Inputs', numeric: true },
  { key: 'handbrake', label: 'Handbrake (0?1)', group: 'Inputs', numeric: true },
  { key: 'absActive', label: 'ABS active (bool)', group: 'Assists', numeric: false },
  { key: 'absEnabled', label: 'ABS enabled (bool)', group: 'Assists', numeric: false },
  { key: 'absLevel', label: 'ABS level', group: 'Assists', numeric: true },
  { key: 'tcActive', label: 'TC active (bool)', group: 'Assists', numeric: false },
  { key: 'tcEnabled', label: 'TC enabled (bool)', group: 'Assists', numeric: false },
  { key: 'tcLevel', label: 'TC level', group: 'Assists', numeric: true },
  { key: 'engineMap', label: 'Engine map', group: 'Assists', numeric: true },
  { key: 'brakeBiasPct', label: 'Brake bias (%)', group: 'Assists', numeric: true },
  { key: 'drs', label: 'DRS (bool)', group: 'Assists', numeric: false },
  { key: 'currentLap', label: 'Current lap (n)', group: 'Session', numeric: true },
  { key: 'lapsRemaining', label: 'Laps remaining', group: 'Session', numeric: true },
  { key: 'currentLapFmt', label: 'Current lap (mm:ss.mmm)', group: 'Session', numeric: false },
  { key: 'lastLapFmt', label: 'Last lap (mm:ss.mmm)', group: 'Session', numeric: false },
  { key: 'bestLapFmt', label: 'Best lap (mm:ss.mmm)', group: 'Session', numeric: false },
  { key: 'deltaBestFmt', label: 'Delta to best (±s)', group: 'Session', numeric: false },
  { key: 'deltaSessionBestFmt', label: 'Delta to session best (?s)', group: 'Session', numeric: false },
  { key: 'sessionTimeLeftFmt', label: 'Time remaining (mm:ss)', group: 'Session', numeric: false },
  { key: 'position', label: 'Position', group: 'Session', numeric: true },
  { key: 'classPosition', label: 'Class position', group: 'Session', numeric: true },
  { key: 'totalCars', label: 'Total cars', group: 'Session', numeric: true },
  { key: 'incidentCount', label: 'Incidents', group: 'Session', numeric: true },
  { key: 'incidentLimit', label: 'Incident limit', group: 'Session', numeric: true },
  { key: 'fuelLiters', label: 'Fuel (L)', group: 'Fuel', numeric: true },
  { key: 'fuelLitersStr', label: 'Fuel (L, 1 decimal)', group: 'Fuel', numeric: false },
  { key: 'fuelPerLap', label: 'Fuel/lap (L)', group: 'Fuel', numeric: true },
  { key: 'fuelPerLapStr', label: 'Fuel/lap (1 decimal)', group: 'Fuel', numeric: false },
  { key: 'fuelLapsLeftStr', label: 'Fuel range in laps', group: 'Fuel', numeric: false },
  { key: 'fuelPct', label: 'Fuel (0–1)', group: 'Fuel', numeric: true },
  { key: 'trackTempC', label: 'Track temp (?C)', group: 'Weather', numeric: true },
  { key: 'airTempC', label: 'Air temp (?C)', group: 'Weather', numeric: true },
  { key: 'waterTempC', label: 'Water temp (?C)', group: 'Engine', numeric: true },
  { key: 'oilTempC', label: 'Oil temp (?C)', group: 'Engine', numeric: true },
  { key: 'oilPressureKpa', label: 'Oil pressure (kPa)', group: 'Engine', numeric: true },
  { key: 'gapAhead', label: 'Gap ahead (s)', group: 'Relatives', numeric: true },
  { key: 'gapBehind', label: 'Gap behind (s)', group: 'Relatives', numeric: true },
  { key: 'gapAheadFmt', label: 'Gap ahead (text)', group: 'Relatives', numeric: false },
  { key: 'gapBehindFmt', label: 'Gap behind (text)', group: 'Relatives', numeric: false },
  { key: 'relativeAheadName', label: 'Relative ahead (name)', group: 'Relatives', numeric: false },
  { key: 'relativeAheadLastLapFmt', label: 'Relative ahead last lap', group: 'Relatives', numeric: false },
  { key: 'relativeBehindName', label: 'Relative behind (name)', group: 'Relatives', numeric: false },
  { key: 'relativeBehindLastLapFmt', label: 'Relative behind last lap', group: 'Relatives', numeric: false },
  { key: 'radarCarsCount', label: 'Cars on radar', group: 'Relatives', numeric: true },
  // ── Derivados extras (para os novos elementos) ─────────────────────────────
  { key: 'throttleBrake', label: 'Throttle vs Brake (dualbar)', group: 'Inputs', numeric: true },
  { key: 'deltaSec', label: 'Numeric delta (s)', group: 'Session', numeric: true },
  { key: 'lastLapDeltaSec', label: '? last vs best (s)', group: 'Session', numeric: true },
  { key: 'flagAny', label: 'Active flag (any)', group: 'Flags', numeric: false },
  { key: 'flagColor', label: 'Active flag color', group: 'Flags', numeric: false },
  { key: 'flagLabel', label: 'Flag label', group: 'Flags', numeric: false },
  { key: 'inPits', label: 'On pit road (bool)', group: 'Session', numeric: false },
  { key: 'pitLimiter', label: 'Pit limiter active (bool)', group: 'Session', numeric: false },
  { key: 'driversCount', label: 'Number of drivers (snap.drivers)', group: 'Relatives', numeric: true },
  { key: 'speedMph', label: 'Speed (mph)', group: 'Car', numeric: true },
  // ── Tires por canto (°C) ───────────────────────────────────────────────────
  { key: 'tyreLfTempC', label: 'LF tire temp (?C)', group: 'Tires', numeric: true },
  { key: 'tyreRfTempC', label: 'RF tire temp (?C)', group: 'Tires', numeric: true },
  { key: 'tyreLrTempC', label: 'LR tire temp (?C)', group: 'Tires', numeric: true },
  { key: 'tyreRrTempC', label: 'RR tire temp (?C)', group: 'Tires', numeric: true },
  { key: 'tyreLfPressureKpa', label: 'LF tire pressure (kPa)', group: 'Tires', numeric: true },
  { key: 'tyreRfPressureKpa', label: 'RF tire pressure (kPa)', group: 'Tires', numeric: true },
  { key: 'tyreLrPressureKpa', label: 'LR tire pressure (kPa)', group: 'Tires', numeric: true },
  { key: 'tyreRrPressureKpa', label: 'RR tire pressure (kPa)', group: 'Tires', numeric: true },
  { key: 'tyreLfWearPct', label: 'LF tire wear (0?1)', group: 'Tires', numeric: true },
  { key: 'tyreRfWearPct', label: 'RF tire wear (0?1)', group: 'Tires', numeric: true },
  { key: 'tyreLrWearPct', label: 'LR tire wear (0?1)', group: 'Tires', numeric: true },
  { key: 'tyreRrWearPct', label: 'RR tire wear (0?1)', group: 'Tires', numeric: true },
  // ── Brakes por canto (°C) ──────────────────────────────────────────────────
  { key: 'brakeLfTempC', label: 'LF brake temp (?C)', group: 'Brakes', numeric: true },
  { key: 'brakeRfTempC', label: 'RF brake temp (?C)', group: 'Brakes', numeric: true },
  { key: 'brakeLrTempC', label: 'LR brake temp (?C)', group: 'Brakes', numeric: true },
  { key: 'brakeRrTempC', label: 'RR brake temp (?C)', group: 'Brakes', numeric: true },
  { key: 'brakeFrontAvgTempC', label: 'Front brake avg (?C)', group: 'Brakes', numeric: true },
  { key: 'brakeRearAvgTempC', label: 'Rear brake avg (?C)', group: 'Brakes', numeric: true },
  // ── Clima / pista ──────────────────────────────────────────────────────────
  { key: 'trackWetnessPct', label: 'Track wetness (0?1)', group: 'Weather', numeric: true },
  { key: 'gripPct', label: 'Grip (0?1)', group: 'Weather', numeric: true },
  { key: 'isRaining', label: 'Raining (bool)', group: 'Weather', numeric: false },
  // ── Session (texto) ─────────────────────────────────────────────────────────
  { key: 'sessionType', label: 'Session type (text)', group: 'Session', numeric: false },
  { key: 'carName', label: 'Car (text)', group: 'Session', numeric: false },
  { key: 'trackName', label: 'Track (text)', group: 'Session', numeric: false },
  { key: 'estLapFmt', label: 'Estimated lap (mm:ss.mmm)', group: 'Session', numeric: false },
  { key: 'strengthOfField', label: 'Strength of Field', group: 'Session', numeric: true }
]

export function createDashboardId(): string {
  return `dash-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function copyDashboardAsNew(dashboard: Dashboard): Dashboard {
  const cloned = structuredClone(dashboard)
  const { storageEpoch: _epoch, storageRevision: _revision, ...copy } = cloned
  const now = Date.now()
  return { ...copy, id: createDashboardId(), name: `${copy.name} copy`, createdAt: now, updatedAt: now }
}

export function createElementId(): string {
  return `el-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

// A BLANK adaptive dashboard: empty canvas (no pre-filled widgets, no moment
// frames/rules) but with adaptive mode enabled and the durable adaptive marker
// embedded in `description`, so `isAdaptiveDashboard()` recognises it and the
// runtime drives it live. Use this to start an adaptive board from scratch
// instead of cloning the full `createAdaptiveDashboardPreset()` layout.
export function createBlankAdaptiveDashboard(
  name = 'Adaptive Dashboard (empty)',
  width = 1024,
  height = 600
): Dashboard {
  const now = Date.now()
  return {
    id: '',
    name,
    width,
    height,
    bg: '#000000',
    scaleMode: 'fit',
    description: `Empty adaptive dashboard ? add your widgets. ${ADAPTIVE_MARKER}`,
    elements: [],
    adaptive: { enabled: true, rules: [] },
    createdAt: now,
    updatedAt: now
  }
}

// ─── Built-in presets ─────────────────────────────────────────────────────────
// Original, manufacturer-free motorsport dashboards. These only use the existing
// DashboardElement model and renderer bindings; import/export contracts stay intact.

export const RACE_BG = '#000000'
const PANEL = '#000000'
const PANEL_DEEP = '#000000'
export const TEXT = '#F4F4F4'
export const MUTED = '#7A7A7A'
export const CYAN = '#00BFFF'
export const TEAL = '#1AFF6E'
export const GREEN = '#1AFF6E'
export const AMBER = '#FFB800'
export const ORANGE = '#FF7A00'
export const RED = '#FF2200'
export const BLUE = '#00BFFF'
const MAGENTA = '#FF2200'
const PURPLE = '#00BFFF'
const STROKE = '#1F1F1F'
const FONT_TECH = '"Avenir Next", "Bahnschrift", "Segoe UI", system-ui, sans-serif'
const FONT_COND = '"Avenir Next Condensed", "DIN Condensed", "Arial Narrow", system-ui, sans-serif'
export const FONT_NUM = '"DSEG7 Classic", "DS-Digital", "SF Mono", "Cascadia Mono", ui-monospace, monospace'
const WARM_PANEL = '#000000'
const WARM_PANEL_DEEP = '#000000'
const WARM_STROKE = '#1F1F1F'
const WARM_WHITE = '#F4F4F4'

// ── Warm accent palette for the 20 colour-variant presets ─────────────────────
const CRIMSON   = '#CC1133' // deep crimson
const VERML     = '#E84010' // vermilion
const TANGER    = '#FF6000' // tangerine
const GOLD_W    = '#D4A000' // warm gold
const ROSE_W    = '#E03060' // warm rose
const RUST_W    = '#C04010' // rust
const COPPER_W  = '#A05018' // copper
const BRICK_W   = '#B33000' // brick red
const MAROON_W  = '#AA1122' // maroon
const DKAMBER   = '#E09000' // dark amber
const SUNSET_W  = '#FF5500' // sunset orange
const CHERRY_W  = '#CC2040' // cherry
const AUTUMN_W  = '#D05010' // autumn
const BRONZE_W  = '#8A6018' // bronze
const TERRACT   = '#B04010' // terracotta
const DEEPGOLD  = '#C49000' // deep gold
const FLAME_W   = '#E84040' // flame red
const MAHOG     = '#8B2000' // mahogany
const CORAL_W   = '#FF4040' // coral

// ── WS-5 self-hosted display + numeral font stacks ────────────────────────────
// Bundled offline via src/renderer/src/assets/fonts/dashboard-display-fonts.css
// (Orbitron/Oxanium/Saira Condensed/Teko) + dashboard-runtime.css ttf (Chakra
// Petch/Rajdhani). Each new preset pairs a DISPLAY face (labels/headers) with a
// NUMERAL face (the big readouts) for a genuinely distinct typographic voice.
const FONT_CHAKRA = '"Chakra Petch", "Bahnschrift", system-ui, sans-serif'
const FONT_SAIRA = '"Saira Condensed", "Arial Narrow", system-ui, sans-serif'
const FONT_OXANIUM = '"Oxanium", "Chakra Petch", system-ui, sans-serif'
const FONT_TEKO = '"Teko", "Saira Condensed", system-ui, sans-serif'
const FONT_ORBITRON = '"Orbitron", "Chakra Petch", system-ui, sans-serif'
const FONT_RAJDHANI = '"Rajdhani", "Saira Condensed", system-ui, sans-serif'

// Slot families: numeral face on the readouts, display face on the chrome/labels.
const NUMERAL_SLOTS = ['value', 'gear', 'speed', 'rpm', 'gap', 'sub', 'unit', 'current', 'last', 'best', 'est'] as const
const DISPLAY_SLOTS = ['label', 'header', 'title', 'gearLabel', 'speedLabel', 'corner'] as const
// Non-text widgets that don't need slot font injection.
const NON_TEXT_TYPES = new Set<DashboardElementType>(['rect', 'image', 'shiftbar', 'shiftlights', 'bar', 'barv', 'deltabar', 'dualbar'])

// Inject a preset's typographic voice into one element: numeral face on the value
// slots, display face on the label/header slots, plus the root fontFamily so
// generic value widgets pick up the numeral face too. Font-only (no fontSize), so
// the fill engine still grows every readout to its tile.
function withFonts(el: DashboardElement, numFont: string, dispFont: string): DashboardElement {
  if (NON_TEXT_TYPES.has(el.type)) return el
  const slots: Record<string, Partial<TextSlotStyle>> = { ...(el.style.slots ?? {}) }
  for (const s of NUMERAL_SLOTS) slots[s] = { ...slots[s], fontFamily: numFont }
  for (const s of DISPLAY_SLOTS) slots[s] = { ...slots[s], fontFamily: dispFont }
  return { ...el, style: { ...el.style, fontFamily: numFont, slots } }
}

function applyFonts(els: DashboardElement[], numFont: string, dispFont: string): DashboardElement[] {
  return els.map((el) => withFonts(el, numFont, dispFont))
}

// Every built-in dashboard ships at this exact canvas size. Presets are still
// authored in whatever working resolution reads cleanest, and dashboard() then
// rescales their elements onto this fixed 1024×600 surface so the whole built-in
// library is uniform and never relies on a panel-specific aspect ratio.
const TARGET_W = 1024
const TARGET_H = 600

export function style(extra: Partial<DashboardElementStyle> = {}): DashboardElementStyle {
  return {
    background: PANEL,
    border: STROKE,
    borderWidth: 1,
    radius: 12,
    color: TEXT,
    fontFamily: FONT_TECH,
    ...extra
  }
}

export function w(
  type: DashboardElementType,
  x: number,
  y: number,
  width: number,
  height: number,
  st: DashboardElementStyle,
  options: { binding?: string; name?: string } = {}
): DashboardElement {
  return { id: createElementId(), type, x, y, w: width, h: height, style: st, binding: options.binding, name: options.name }
}

function text(
  x: number,
  y: number,
  width: number,
  height: number,
  name: string,
  st: DashboardElementStyle,
  binding?: string
): DashboardElement {
  return w('text', x, y, width, height, { background: 'transparent', fontFamily: FONT_TECH, color: TEXT, ...st }, { name, binding })
}

function tile(
  x: number,
  y: number,
  width: number,
  height: number,
  name: string,
  label: string,
  binding: string,
  accent: string,
  options: Partial<DashboardElementStyle> = {}
): DashboardElement[] {
  const labelH = Math.max(16, Math.floor(height * 0.24))
  return [
    w('rect', x, y, width, height, style({ radius: 9, background: PANEL_DEEP, border: accent, borderWidth: 1, ...options }), { name: `${name}Bg` }),
    text(x + 8, y + 6, width - 16, labelH, `${name}Label`, { text: label, color: accent, fontSize: Math.max(10, Math.floor(height * 0.16)), fontWeight: 900, align: 'left', fontFamily: FONT_COND }),
    text(x + 8, y + labelH + 4, width - 16, height - labelH - 10, `${name}Value`, { color: TEXT, fontSize: Math.max(20, Math.floor(height * 0.42)), fontWeight: 950, align: 'right', fontFamily: FONT_NUM }, binding)
  ]
}

function warmStyle(extra: Partial<DashboardElementStyle> = {}): DashboardElementStyle {
  return style({
    background: WARM_PANEL,
    border: WARM_STROKE,
    color: WARM_WHITE,
    accentColor: ORANGE,
    warnColor: AMBER,
    dangerColor: RED,
    minFontSize: 14,
    radius: 12,
    ...extra
  })
}

function warmWidget(
  type: DashboardElementType,
  x: number,
  y: number,
  width: number,
  height: number,
  name: string,
  label: string,
  accent: string,
  options: Partial<DashboardElementStyle> = {},
  binding?: string
): DashboardElement {
  return w(type, x, y, width, height, warmStyle({ label, title: label, accentColor: accent, minFontSize: 16, maxFontSize: 92, ...options }), { binding, name })
}

function warmTextTile(
  x: number,
  y: number,
  width: number,
  height: number,
  name: string,
  label: string,
  binding: string,
  accent = ORANGE,
  options: Partial<DashboardElementStyle> = {}
): DashboardElement[] {
  return tile(x, y, width, height, name, label, binding, accent, {
    background: WARM_PANEL_DEEP,
    border: accent,
    color: WARM_WHITE,
    minFontSize: 18,
    maxFontSize: 58,
    ...options
  })
}

export function dashboard(name: string, width: number, height: number, description: string, elements: DashboardElement[]): Dashboard {
  const now = Date.now()
  // Every preset is normalised to a single 1024×600 canvas. Presets authored at
  // other working resolutions get their element geometry (and explicit font
  // sizes) rescaled onto the target surface; widgets keep auto-fitting their
  // text so nothing crops. The "· W×H" suffix in the name is rewritten too.
  const sx = TARGET_W / width
  const sy = TARGET_H / height
  // Uniform scale (preserve aspect ratio) + center within the 1024×600 canvas, so
  // an off-aspect preset LETTERBOXES instead of stretching/squishing. Native
  // 1024×600 presets are identity (sf=1, no offset). Geometry and fonts both use
  // the SAME factor so nothing is distorted.
  const sf = Math.min(sx, sy)
  const offsetX = Math.round((TARGET_W - width * sf) / 2)
  const offsetY = Math.round((TARGET_H - height * sf) / 2)
  const scaled =
    sf === 1 && offsetX === 0 && offsetY === 0
      ? elements
      : elements.map((el) => ({
          ...el,
          x: Math.round(el.x * sf) + offsetX,
          y: Math.round(el.y * sf) + offsetY,
          w: Math.round(el.w * sf),
          h: Math.round(el.h * sf),
          style: scaleStyleFonts(el.style, sf)
        }))
  const cleanName = name.replace(/\s*·\s*\d+\s*[×x]\s*\d+\s*$/i, '').trim()
  const finalName = `${cleanName} · ${TARGET_W}×${TARGET_H}`
  // 'fit' letterboxes the canvas so the whole layout stays visible on any panel
  // (e.g. a 1024×600 preset on a 7" 800×480 screen) instead of cropping edges.
  return { id: createDashboardId(), name: finalName, width: TARGET_W, height: TARGET_H, bg: RACE_BG, scaleMode: 'fit', description, elements: scaled, createdAt: now, updatedAt: now }
}

// Rescale only the explicit pixel font sizes on a style by a uniform factor so a
// rescaled preset keeps sensible type. AutoFit still has the final say, so this
// just keeps min/max bounds proportional rather than pixel-exact.
function scaleStyleFonts(st: DashboardElementStyle, sf: number): DashboardElementStyle {
  if (sf === 1) return st
  const out: DashboardElementStyle = { ...st }
  if (typeof out.fontSize === 'number') out.fontSize = Math.max(8, Math.round(out.fontSize * sf))
  if (typeof out.minFontSize === 'number') out.minFontSize = Math.max(8, Math.round(out.minFontSize * sf))
  if (typeof out.maxFontSize === 'number') out.maxFontSize = Math.max(10, Math.round(out.maxFontSize * sf))
  return out
}

// ── Clean-black preset kit ────────────────────────────────────────────────────
// Helpers used by the GT3-reference presets (Porsche Cup / Mercedes-AMG / Ferrari
// and the minimal Spotter). Everything floats on pure black with hairline-only
// separation: NO panel boxes, shadows, textures or gradients.

// Borderless floating value (the minimal readout): big value, optional tiny label.
export function cv(
  binding: string,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  opts: Partial<DashboardElementStyle> = {},
  type: DashboardElementType = 'value'
): DashboardElement {
  return w(
    type,
    x,
    y,
    width,
    height,
    { background: 'transparent', borderWidth: 0, color: TEXT, fontFamily: FONT_NUM, label, ...opts },
    { binding, name: (label || binding).replace(/\s+/g, '') }
  )
}

// The single dominant gear numeral every GT3 dash is anchored on.
export function heroGear(x: number, y: number, width: number, height: number): DashboardElement {
  return cv('gearLabel', x, y, width, height, '', {
    fontFamily: FONT_COND,
    color: TEXT,
    minFontSize: 80,
    maxFontSize: 460
  })
}

// The one top RPM/shift bar — segmented green→amber→red, NO numbers, no box.
export function topRevBar(x: number, y: number, width: number, height: number, segments = 22): DashboardElement {
  return w(
    'shiftbar',
    x,
    y,
    width,
    height,
    { background: 'transparent', borderWidth: 0, radius: 1, segments, flashAt: 0.97, warnAt: 0.55, dangerAt: 0.8, segmentShape: 'led', fillColor: GREEN, warnColor: AMBER, dangerColor: RED, accentColor: GREEN },
    { binding: 'shiftPct', name: 'TopRevBar' }
  )
}

// Hairline separator (1px) — the only permitted divider.
export function hairline(x: number, y: number, width: number, height: number): DashboardElement {
  return w('rect', x, y, width, height, { background: STROKE, borderWidth: 0, radius: 0 }, { name: 'Hairline' })
}

// ── Dense recreation kit ──────────────────────────────────────────────────────
// Helpers shared by the dense GT3/ACC-style recreations. They favour the
// label-left / value-right readout rows that real DDU screens use, plus framed
// outline cards, so a 1024×600 canvas can be packed edge-to-edge without empty
// gaps while every value stays large and auto-fits (never crops).

// One label-left / value-right readout row (the staple DDU list line).
function lvRow(
  x: number,
  y: number,
  width: number,
  height: number,
  name: string,
  label: string,
  binding: string,
  accent = AMBER,
  opts: Partial<DashboardElementStyle> = {}
): DashboardElement[] {
  const fs = Math.max(13, Math.round(height * 0.62))
  const labelW = Math.round(width * 0.5)
  return [
    text(x, y, labelW, height, `${name}L`, { text: label, color: accent, fontSize: Math.max(11, Math.round(height * 0.46)), minFontSize: 9, fontWeight: 800, align: 'left', fontFamily: FONT_COND }),
    text(x + labelW, y, width - labelW, height, `${name}V`, { color: WARM_WHITE, fontSize: fs, minFontSize: 11, fontWeight: 900, align: 'right', fontFamily: FONT_NUM, ...opts }, binding)
  ]
}

// A thin outline card (warm hairline) used to frame a cluster, à la the GRID DDU.
function card(x: number, y: number, width: number, height: number, accent: string, name = 'Card'): DashboardElement {
  return w('rect', x, y, width, height, { background: '#000000', border: accent, borderWidth: 1, radius: 8 }, { name })
}

// Card title chip (short uppercase label centred on the card's top edge).
function cardTitle(x: number, y: number, width: number, name: string, label: string, accent: string, fs = 15): DashboardElement {
  return text(x, y, width, Math.round(fs * 1.3), name, { text: label, color: accent, fontSize: fs, minFontSize: 9, fontWeight: 900, align: 'center', fontFamily: FONT_COND })
}

// Big borderless value with a small caption underneath (center column readouts).
function bigValue(
  binding: string,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  color = WARM_WHITE,
  opts: Partial<DashboardElementStyle> = {}
): DashboardElement {
  return cv(binding, x, y, width, height, label, {
    background: 'transparent',
    borderWidth: 0,
    color,
    fontFamily: FONT_NUM,
    minFontSize: 16,
    maxFontSize: Math.round(height * 0.72),
    ...opts
  })
}

function denseRevBar(x: number, y: number, width: number, height: number, segments = 24): DashboardElement {
  return w(
    'shiftbar',
    x,
    y,
    width,
    height,
    warmStyle({
      background: 'transparent',
      borderWidth: 0,
      radius: 4,
      segments,
      flashAt: 0.97,
      warnAt: 0.55,
      dangerAt: 0.8,
      glow: true,
      segmentShape: 'led',
      fillColor: GREEN,
      warnColor: AMBER,
      dangerColor: RED,
      accentColor: AMBER
    }),
    { binding: 'shiftPct', name: 'DenseShiftLeds' }
  )
}

function createSpotterRacePreset(): Dashboard {
  const elements: DashboardElement[] = [
    w('rect', 0, 0, 1024, 600, { background: RACE_BG, borderWidth: 0, radius: 0 }, { name: 'Backplate' }),
    topRevBar(16, 10, 992, 18, 20),
    heroGear(396, 36, 252, 310),
    cv('speedKmh', 396, 354, 252, 90, '', { fontFamily: FONT_NUM, suffix: 'km/h', minFontSize: 30, maxFontSize: 70 }),
    w('relatives-clean', 16, 36, 360, 410, { background: 'transparent', borderWidth: 0, radius: 0, accentColor: MUTED, reference: '', showIcon: false }, { name: 'Relatives' }),
    w('radar-clean', 660, 36, 348, 196, { background: 'transparent', borderWidth: 0, radius: 0, accentColor: CYAN, showIcon: false }, { name: 'Radar' }),
    w('trackmap-clean', 660, 240, 348, 196, { background: 'transparent', borderWidth: 0, radius: 0, accentColor: CYAN, color: MUTED, showIcon: false }, { binding: 'lapDistPct', name: 'TrackMap' }),
    cv('position', 16, 456, 168, 120, 'POS', { accentColor: AMBER, minFontSize: 30, maxFontSize: 64 }),
    cv('deltaSec', 192, 456, 168, 120, 'DELTA', { accentColor: GREEN, minFontSize: 26, maxFontSize: 56 }),
    cv('gapAheadFmt', 660, 456, 168, 120, 'AHEAD', { accentColor: GREEN, minFontSize: 22, maxFontSize: 44 }),
    cv('gapBehindFmt', 836, 456, 172, 120, 'BEHIND', { accentColor: RED, minFontSize: 22, maxFontSize: 44 })
  ]
  return dashboard('Spotter / Race', 1024, 600, 'Minimal spotter dash: dominant gear, top revlights, interactive track map, proximity radar and relatives that turn green when you are approaching the car ahead or pulling away from the car behind.', elements)
}

function createPorscheCupPreset(): Dashboard {
  const elements: DashboardElement[] = [
    w('rect', 0, 0, 1024, 600, { background: RACE_BG, borderWidth: 0, radius: 0 }, { name: 'Backplate' }),
    topRevBar(60, 32, 904, 32, 24),
    cv('flagLabel', 16, 26, 40, 40, '', { accentColor: AMBER, minFontSize: 14, maxFontSize: 26 }),
    cv('pitLimiter', 968, 26, 40, 40, '', { accentColor: CYAN, minFontSize: 14, maxFontSize: 26 }),
    heroGear(390, 100, 244, 330),
    cv('speedKmh', 60, 200, 300, 180, '', { fontFamily: FONT_NUM, suffix: 'km/h', minFontSize: 60, maxFontSize: 150 }),
    cv('deltaSec', 664, 170, 300, 120, 'DELTA', { accentColor: GREEN, minFontSize: 40, maxFontSize: 96 }),
    cv('lastLapFmt', 664, 295, 300, 110, 'LAST', { accentColor: TEXT, minFontSize: 30, maxFontSize: 64 }),
    hairline(60, 452, 904, 1),
    cv('position', 64, 462, 220, 120, 'POS', { accentColor: AMBER, minFontSize: 40, maxFontSize: 96 }),
    cv('bestLapFmt', 402, 468, 220, 100, 'BEST', { accentColor: MUTED, minFontSize: 24, maxFontSize: 52 }),
    cv('waterTempC', 738, 462, 220, 120, 'WATER', { accentColor: TEXT, suffix: '°', minFontSize: 26, maxFontSize: 56 })
  ]
  return dashboard('Porsche Cup Wide', 1024, 600, 'Porsche 911 GT3 Cup inspired dash: deep black, one dominant central gear, a single top segmented RPM bar (no numbers) with flag/limiter tells flanking it, and small secondary speed, lap and delta.', elements)
}

function createMercedesAmgPreset(): Dashboard {
  const elements: DashboardElement[] = [
    w('rect', 0, 0, 1024, 600, { background: RACE_BG, borderWidth: 0, radius: 0 }, { name: 'Backplate' }),
    topRevBar(51, 28, 922, 28, 20),
    heroGear(384, 88, 256, 288),
    cv('speedKmh', 384, 390, 256, 100, '', { fontFamily: FONT_NUM, suffix: 'km/h', minFontSize: 30, maxFontSize: 72 }),
    cv('absActive', 51, 100, 192, 83, 'ABS', { accentColor: AMBER, minFontSize: 20, maxFontSize: 40 }),
    cv('tcActive', 51, 198, 192, 83, 'TC', { accentColor: AMBER, minFontSize: 20, maxFontSize: 40 }),
    cv('pitLimiter', 51, 295, 192, 83, 'PIT', { accentColor: CYAN, minFontSize: 18, maxFontSize: 36 }),
    cv('position', 781, 100, 192, 83, 'POS', { accentColor: AMBER, minFontSize: 26, maxFontSize: 60 }),
    cv('incidentCount', 781, 198, 192, 83, 'INC', { accentColor: RED, minFontSize: 26, maxFontSize: 60 }),
    cv('fuelLitersStr', 781, 295, 192, 83, 'FUEL', { accentColor: AMBER, minFontSize: 22, maxFontSize: 44 }),
    hairline(51, 490, 922, 1),
    w('relatives-clean', 51, 502, 460, 80, style({ background: 'transparent', borderWidth: 0, accentColor: AMBER, minFontSize: 14, maxFontSize: 26 }), { name: 'AmgRelatives' }),
    cv('lastLapFmt', 524, 502, 220, 80, 'LAST', { accentColor: TEXT, minFontSize: 18, maxFontSize: 36 }),
    cv('deltaSec', 756, 502, 220, 80, 'DELTA', { accentColor: GREEN, minFontSize: 18, maxFontSize: 36 })
  ]
  return dashboard('Mercedes-AMG Compact', 1024, 600, 'Mercedes-AMG GT3 inspired compact dash: big central gear anchor, tight top RPM band (no numbers), colored ABS/TC/pit/temperature tells, and small speed, lap and delta along the bottom.', elements)
}

function createFerrariGt3Preset(): Dashboard {
  // Ferrari 296 / 488 GT3 style: deep matte black, large bold central gear, top
  // segmented RPM bar (no numbers), tiny speed lower-left, lap/delta lower-middle,
  // temps lower-right only if needed. No icons, no branding.
  const elements: DashboardElement[] = [
    w('rect', 0, 0, 1024, 600, { background: RACE_BG, borderWidth: 0, radius: 0 }, { name: 'Backplate' }),
    topRevBar(60, 40, 904, 34, 24),
    // Large bold central gear.
    heroGear(372, 120, 280, 320),
    // Lower row: speed (left), lap + delta (middle), incidents (right — water/oil omitted).
    hairline(60, 470, 904, 1),
    cv('speedKmh', 60, 482, 220, 96, '', { fontFamily: FONT_NUM, suffix: 'km/h', minFontSize: 32, maxFontSize: 76 }),
    cv('deltaSec', 320, 482, 200, 96, 'DELTA', { accentColor: GREEN, minFontSize: 26, maxFontSize: 56 }),
    cv('lastLapFmt', 540, 482, 200, 96, 'LAST', { accentColor: TEXT, minFontSize: 22, maxFontSize: 48 }),
    cv('incidentCount', 764, 482, 200, 96, 'INC', { accentColor: RED, minFontSize: 26, maxFontSize: 56 }),
    // One small position tell and relatives strip, top-left area.
    cv('position', 60, 96, 180, 80, 'POS', { accentColor: AMBER, minFontSize: 26, maxFontSize: 56 }),
    w('relatives-clean', 60, 182, 290, 72, style({ background: 'transparent', borderWidth: 0, accentColor: AMBER, minFontSize: 14, maxFontSize: 24 }), { name: 'FerRelatives' })
  ]
  return dashboard('Ferrari GT3 · 1024×600', 1024, 600, 'Ferrari 296/488 GT3 inspired dash: deep matte black, one large bold central gear, a single top segmented RPM bar (no numbers), tiny speed lower-left, lap/delta lower-middle and a water-temp tell lower-right.', elements)
}

function createGt3EnduranceClusterPreset(): Dashboard {
  const elements: DashboardElement[] = [
    w('rect', 0, 0, 1024, 600, style({ background: '#000000', borderWidth: 0, radius: 0 }), { name: 'Backplate' }),
    w('shiftbar', 15, 15, 994, 30, style({ segments: 12, flashAt: 0.95, warnAt: 0.5, dangerAt: 0.75, glow: false, segmentShape: 'led', radius: 1, accentColor: CYAN }), { binding: 'shiftPct', name: 'TopRevRail' }),
    w('gearcluster', 15, 60, 333, 525, style({ radius: 2, accentColor: CYAN, showRpm: false, flashAt: 0.95, dangerAt: 0.75, unit: 'kmh' }), { name: 'GiantGearSpeed' }),
    // Right-top: relatives + position/incidents (replaces enginetemps)
    w('relatives-clean', 364, 60, 645, 110, style({ radius: 6, accentColor: AMBER, minFontSize: 14, maxFontSize: 28 }), { name: 'EndRelatives' }),
    w('positiongaps', 364, 178, 320, 62, style({ radius: 4, showTotal: true, accentColor: CYAN, minFontSize: 18, maxFontSize: 42 }), { name: 'EndPos' }),
    bigValue('incidentCount', 692, 178, 317, 62, 'INC', RED, { maxFontSize: 40 }),
    // Right-mid: setup strip (bb/tc/abs/map/limiter)
    w('setupstrip', 364, 248, 645, 160, style({ radius: 2, fields: ['bb', 'tc', 'abs', 'map', 'limiter'], accentColor: CYAN, maxFontSize: 32 }), { name: 'EndSetupStrip' }),
    w('deltatile', 364, 423, 645, 163, style({ title: 'DELTA', deltaReference: 'session', deltaRangeSec: 1, radius: 2, accentColor: GREEN }), { name: 'DeltaTile' })
  ]
  return dashboard('GT3 Endurance Cluster', 1024, 600, 'GT3 endurance cluster: giant gear/speed left, relatives + position/incidents top-right, setup strip mid, predictive delta bottom.', elements)
}

function createAimColorfulPreset(): Dashboard {
  const elements: DashboardElement[] = [
    w('rect', 0, 0, 1024, 600, style({ background: '#000000', borderWidth: 0, radius: 0 }), { name: 'CarbonBackplate' }),
    w('shiftbar', 26, 25, 972, 20, style({ segments: 10, flashAt: 0.95, glow: false, segmentShape: 'led', radius: 1 }), { binding: 'shiftPct', name: 'TopRevRail' }),
    w('gearcluster', 26, 70, 448, 505, style({ radius: 2, showRpm: true, flashAt: 0.95, dangerAt: 0.8 }), { name: 'CentralTach' }),
    // Right panel: relatives + position/incidents + speed + laptiming
    w('relatives-clean', 500, 70, 498, 108, style({ radius: 2, accentColor: AMBER, minFontSize: 14, maxFontSize: 28 }), { name: 'AimRelatives' }),
    w('positiongaps', 500, 184, 244, 108, style({ radius: 2, showTotal: true, accentColor: AMBER, minFontSize: 18, maxFontSize: 48 }), { name: 'AimPos' }),
    bigValue('incidentCount', 752, 184, 246, 108, 'INC', RED, { maxFontSize: 58 }),
    bigValue('speedKmh', 500, 298, 498, 46, 'KPH', WARM_WHITE, { maxFontSize: 38 }),
    w('laptiming', 500, 350, 498, 225, style({ radius: 2 }), { name: 'LapTiming' })
  ]
  return dashboard('AiM MXG Colorful', 1024, 600, 'AiM MXG inspired: large left tachometer arc, relatives + position + incidents right-top, speed, lap timing. All mandatory elements present.', elements)
}

function createMinimalDarkPreset(): Dashboard {
  const elements: DashboardElement[] = [
    w('rect', 0, 0, 1024, 600, style({ background: '#000000', borderWidth: 0, radius: 0 }), { name: 'Backplate' }),
    w('shiftbar', 128, 38, 768, 15, style({ segments: 16, flashAt: 0.95, glow: false, segmentShape: 'led', radius: 1 }), { binding: 'shiftPct', name: 'TopRevRail' }),
    // Left: relatives + positiongaps + incidents + speed (replacing enginetemps)
    w('relatives-clean', 51, 188, 230, 110, style({ radius: 2, accentColor: AMBER, minFontSize: 14, maxFontSize: 26 }), { name: 'McLarenRelatives' }),
    w('positiongaps', 51, 306, 230, 90, style({ radius: 2, showTotal: true, accentColor: AMBER, minFontSize: 16, maxFontSize: 42 }), { name: 'McLarenPos' }),
    bigValue('incidentCount', 51, 404, 230, 76, 'INC', RED, { maxFontSize: 48 }),
    bigValue('speedKmh', 51, 488, 230, 76, 'KPH', WARM_WHITE, { maxFontSize: 46 }),
    w('gearcluster', 320, 100, 384, 450, style({ radius: 2, showRpm: false, flashAt: 0.95, unit: 'kmh' }), { name: 'Gear' }),
    w('deltatile', 742, 188, 230, 313, style({ title: 'DELTA', deltaReference: 'session', radius: 2, accentColor: GREEN }), { name: 'RightStats' })
  ]
  return dashboard('McLaren Minimal', 1024, 600, 'Ultra-minimal dark dashboard: big gear/speed cluster centre, relatives + position + incidents left, predictive delta right.', elements)
}

function createFormulaPreset(): Dashboard {
  const elements: DashboardElement[] = [
    w('rect', 0, 0, 1024, 600, style({ background: '#000000', borderWidth: 0, radius: 0 }), { name: 'FormulaBackplate' }),
    w('shiftbar', 24, 18, 976, 60, style({ segments: 28, flashAt: 0.98, warnAt: 0.62, dangerAt: 0.84, glow: true, segmentShape: 'led', radius: 10, fillColor: GREEN, warnColor: AMBER, dangerColor: RED }), { binding: 'shiftPct', name: 'FormulaRevBar' }),
    w('gearcluster', 388, 92, 248, 330, style({ radius: 24, accentColor: CYAN, showRpm: true, flashAt: 0.98 }), { name: 'FormulaGear' }),
    w('deltatile', 28, 92, 238, 160, style({ title: 'DELTA', deltaReference: 'session', deltaRangeSec: 1, radius: 12, accentColor: GREEN }), { name: 'DeltaPanel' }),
    w('positiongaps', 758, 92, 238, 160, style({ showTotal: true, radius: 12, accentColor: AMBER }), { name: 'PositionPanel' }),
    w('laptiming', 28, 264, 238, 158, style({ title: 'TIMING', showCurrent: true, showLast: true, showBest: true, radius: 12, accentColor: CYAN }), { name: 'LapTiming' }),
    w('fuelstint', 758, 264, 238, 158, style({ title: 'FUEL', reserveLaps: 1, warnAtLaps: 2, radius: 12, accentColor: GREEN }), { name: 'Fuel' }),
    w('tyregrid', 278, 92, 96, 330, style({ gridMode: 'pressure', title: 'TYRE P', targetValue: 165, tolerance: 7, radius: 12, accentColor: AMBER }), { name: 'TyrePress' }),
    w('inputbars', 650, 92, 96, 330, style({ channels: ['throttle', 'brake'], radius: 12, accentColor: CYAN }), { name: 'Pedals' }),
    w('deltabar', 278, 430, 468, 26, style({ background: '#000000', radius: 999, fillColor: GREEN, dangerColor: RED, deltaRangeSec: 1 }), { binding: 'deltaSec', name: 'FormulaDeltaBar' }),
    w('setupstrip', 28, 464, 360, 88, style({ fields: ['abs', 'tc', 'map', 'bb', 'limiter'], radius: 10, accentColor: MAGENTA }), { name: 'ModeDiffStrip' }),
    w('flagoverlay', 400, 464, 224, 88, style({ compact: true, includeIncidents: true, radius: 10, accentColor: AMBER }), { name: 'FlagStrip' }),
    w('trackmini', 636, 464, 128, 88, style({ radius: 10, accentColor: CYAN }), { binding: 'lapDistPct', name: 'TrackProgress' }),
    w('relatives-clean', 770, 464, 226, 88, style({ radius: 10, accentColor: AMBER, minFontSize: 13, maxFontSize: 24 }), { name: 'FormulaRelatives' })
  ]
  return dashboard('Formula Wheel Race Display', 1024, 600, 'Original formula-style steering wheel screen: central gear, multi-color rev bar, shift flash, delta bar and mode/diff readouts.', elements)
}

function createEndurancePreset(): Dashboard {
  const elements: DashboardElement[] = [
    w('rect', 0, 0, 1024, 600, style({ background: '#000000', borderWidth: 0, radius: 0 }), { name: 'EnduranceBackplate' }),
    w('shiftbar', 20, 14, 984, 42, style({ segments: 22, flashAt: 0.975, warnAt: 0.7, dangerAt: 0.88, glow: true, segmentShape: 'led', radius: 8, accentColor: CYAN }), { binding: 'shiftPct', name: 'EnduranceShift' }),
    w('flagoverlay', 20, 64, 984, 34, style({ compact: true, includeIncidents: true, radius: 8, accentColor: AMBER }), { name: 'FlagBanner' }),
    w('fuelstint', 20, 118, 300, 154, style({ title: 'STINT FUEL', enduranceMode: true, reserveLaps: 2, warnAtLaps: 3, radius: 14, accentColor: GREEN }), { name: 'StintFuel' }),
    w('laptiming', 344, 118, 336, 154, style({ title: 'LAP / LAST / BEST', showCurrent: true, showLast: true, showBest: true, showEstimated: true, radius: 14, accentColor: CYAN }), { name: 'LapTiming' }),
    w('positiongaps', 704, 118, 300, 154, style({ showTotal: true, radius: 14, accentColor: AMBER }), { name: 'PositionGaps' }),
    w('gearcluster', 344, 292, 212, 176, style({ radius: 18, accentColor: CYAN, showRpm: true }), { name: 'GearSpeed' }),
    w('cornerstack', 20, 292, 300, 176, style({ title: 'TYRE / BRAKE', targetValue: 165, tolerance: 7, radius: 14, accentColor: GREEN }), { name: 'CornerHealth' }),
    w('tyregrid', 580, 292, 204, 176, style({ gridMode: 'pressure', title: 'TYRE PRESS', targetValue: 165, tolerance: 7, radius: 14, accentColor: AMBER }), { name: 'TyrePress' }),
    w('brakegrid', 800, 292, 204, 176, style({ title: 'BRAKES', showAverage: true, radius: 14, accentColor: ORANGE }), { name: 'Brakes' }),
    ...tile(20, 488, 156, 78, 'ClockTile', 'CLOCK', 'sessionTimeLeftFmt', CYAN),
    ...tile(190, 488, 156, 78, 'BestTile', 'BEST', 'bestLapFmt', GREEN),
    ...tile(360, 488, 156, 78, 'LastTile', 'LAST', 'lastLapFmt', AMBER),
    ...tile(530, 488, 156, 78, 'FuelPerLapTile', 'L / LAP', 'fuelPerLapStr', BLUE),
    w('weather', 700, 488, 140, 78, style({ title: 'TRACK', radius: 12, accentColor: CYAN }), { name: 'Weather' }),
    w('setupstrip', 854, 488, 150, 78, style({ fields: ['limiter', 'inc'], radius: 12, accentColor: RED }), { name: 'PitIncStrip' })
  ]
  return dashboard('Endurance DDU Long Run', 1024, 600, 'Original endurance DDU: stint/fuel, lap/last/best, position, large race clock and long-run tyre/brake health.', elements)
}

function createGt3RaceWarmPreset(): Dashboard {
  const elements: DashboardElement[] = [
    w('rect', 0, 0, 1024, 600, warmStyle({ background: '#000000', borderWidth: 0, radius: 0 }), { name: 'WarmRaceBackplate' }),
    w('shiftbar', 18, 12, 988, 50, warmStyle({ segments: 28, flashAt: 0.98, warnAt: 0.64, dangerAt: 0.86, glow: true, segmentShape: 'led', fillColor: ORANGE, warnColor: AMBER, dangerColor: RED, radius: 9 }), { binding: 'shiftPct', name: 'TopWarmShiftRail' }),
    warmWidget('flags-elaborate', 18, 72, 330, 72, 'RaceFlags', 'FLAGS', AMBER, { maxFontSize: 46 }),
    warmWidget('pitlimiter-elaborate', 362, 72, 170, 72, 'PitLimiter', 'PIT', ORANGE, { maxFontSize: 42 }),
    warmWidget('incidents-elaborate', 546, 72, 170, 72, 'Incidents', 'INC', RED, { maxFontSize: 42 }),
    warmWidget('position-elaborate', 730, 72, 276, 72, 'Position', 'POSITION', AMBER, { maxFontSize: 42 }),
    warmWidget('speed-elaborate', 18, 160, 210, 118, 'Speed', 'SPEED', WARM_WHITE, { maxFontSize: 64 }),
    warmWidget('gear-elaborate', 248, 150, 244, 212, 'Gear', 'GEAR', AMBER, { maxFontSize: 140 }),
    warmWidget('rpm-elaborate', 512, 160, 210, 118, 'Rpm', 'RPM', ORANGE, { maxFontSize: 58 }),
    warmWidget('delta-elaborate', 740, 160, 266, 118, 'Delta', 'DELTA', RED, { deltaRangeSec: 1, maxFontSize: 58 }, 'deltaSec'),
    warmWidget('fuel-elaborate', 18, 296, 210, 106, 'Fuel', 'FUEL', AMBER, { maxFontSize: 54 }),
    warmWidget('lap-elaborate', 512, 296, 210, 106, 'Lap', 'LAP', ORANGE, { maxFontSize: 54 }),
    warmWidget('abs-clean', 740, 296, 126, 76, 'Abs', 'ABS', AMBER, { maxFontSize: 48 }),
    warmWidget('tc-clean', 880, 296, 126, 76, 'Tc', 'TC', ORANGE, { maxFontSize: 48 }),
    warmWidget('map-clean', 740, 386, 126, 76, 'Map', 'MAP', AMBER, { maxFontSize: 48 }),
    warmWidget('bb-clean', 880, 386, 126, 76, 'BrakeBias', 'BB', ORANGE, { maxFontSize: 48 }),
    warmWidget('relatives-clean', 18, 420, 330, 72, 'Relatives', 'RELATIVES', AMBER, { maxFontSize: 34 }),
    warmWidget('radar-clean', 366, 382, 126, 110, 'Radar', 'RADAR', RED, { maxFontSize: 28 }),
    warmWidget('trackmap-clean', 512, 420, 210, 72, 'TrackMap', 'TRACK', AMBER, { maxFontSize: 28 }, 'lapDistPct'),
    warmWidget('inputs-elaborate', 740, 478, 266, 92, 'Inputs', 'INPUTS', ORANGE, { channels: ['throttle', 'brake'], traceLength: 180, maxFontSize: 32 }),
    warmWidget('tyres-clean', 18, 500, 330, 92, 'Tyres', 'TYRES', AMBER, { maxFontSize: 30 }),
    warmWidget('temps-clean', 366, 500, 356, 92, 'EngineTemps', 'ENGINE', ORANGE, { maxFontSize: 30 })
  ]
  return dashboard('GT3 Race Warm', 1024, 600, 'Dense warm GT3 race preset with red/orange/amber status panels, readable core values, relatives, radar, tyres, setup and pit context.', elements)
}

function createEnduranceDduWarmPreset(): Dashboard {
  const elements: DashboardElement[] = [
    w('rect', 0, 0, 1024, 600, warmStyle({ background: '#000000', borderWidth: 0, radius: 0 }), { name: 'EnduranceWarmBackplate' }),
    w('shiftbar', 14, 10, 996, 44, warmStyle({ segments: 28, flashAt: 0.98, warnAt: 0.66, dangerAt: 0.87, glow: true, segmentShape: 'bar', fillColor: ORANGE, warnColor: AMBER, dangerColor: RED, radius: 8 }), { binding: 'shiftPct', name: 'EnduranceWarmRevRail' }),
    warmWidget('flags-elaborate', 14, 60, 280, 54, 'Flags', 'FLAGS', AMBER, { maxFontSize: 40 }),
    warmWidget('position-elaborate', 302, 60, 196, 54, 'Position', 'POSITION', ORANGE, { maxFontSize: 40 }),
    warmWidget('pitlimiter-clean', 506, 60, 132, 54, 'PitLimiter', 'PIT', RED, { maxFontSize: 36 }),
    warmWidget('incidents-clean', 646, 60, 132, 54, 'Incidents', 'INC', RED, { maxFontSize: 36 }),
    warmWidget('temps-clean', 786, 60, 224, 54, 'EngineTemps', 'ENGINE', ORANGE, { maxFontSize: 28 }),
    warmWidget('fuel-elaborate', 14, 120, 218, 130, 'Fuel', 'FUEL', AMBER, { maxFontSize: 64 }),
    w('fuelstint', 240, 120, 218, 130, warmStyle({ title: 'STINT PLAN', enduranceMode: true, reserveLaps: 2, warnAtLaps: 3, accentColor: ORANGE, maxFontSize: 40 }), { name: 'FuelStintPlan' }),
    w('laptiming', 466, 120, 268, 130, warmStyle({ title: 'LAP STACK', showCurrent: true, showLast: true, showBest: true, showEstimated: true, accentColor: AMBER, maxFontSize: 36 }), { name: 'LapStack' }),
    warmWidget('relatives-elaborate', 742, 120, 268, 130, 'Relatives', 'RELATIVES', AMBER, { maxFontSize: 30 }),
    warmWidget('tyres-elaborate', 14, 256, 254, 194, 'Tyres', 'TYRES', ORANGE, { maxFontSize: 30 }),
    warmWidget('radar-elaborate', 276, 256, 100, 194, 'Radar', 'RADAR', RED, { maxFontSize: 24 }),
    warmWidget('gear-elaborate', 384, 256, 256, 194, 'Gear', 'GEAR', AMBER, { maxFontSize: 130 }),
    warmWidget('trackmap-elaborate', 648, 256, 254, 194, 'TrackMap', 'TRACK MAP', AMBER, { maxFontSize: 28 }, 'lapDistPct'),
    w('setupstrip', 910, 256, 100, 194, warmStyle({ title: 'SETUP', fields: ['abs', 'tc', 'map', 'bb', 'limiter', 'inc'], compact: true, accentColor: ORANGE, maxFontSize: 24 }), { name: 'SetupTower' }),
    ...warmTextTile(14, 456, 158, 130, 'Clock', 'TIME LEFT', 'sessionTimeLeftFmt', AMBER),
    ...warmTextTile(180, 456, 158, 130, 'BestLap', 'BEST', 'bestLapFmt', ORANGE),
    ...warmTextTile(346, 456, 158, 130, 'LastLap', 'LAST', 'lastLapFmt', WARM_WHITE),
    ...warmTextTile(512, 456, 158, 130, 'FuelPerLap', 'L / LAP', 'fuelPerLapStr', AMBER),
    warmWidget('inputs-elaborate', 678, 456, 168, 130, 'Inputs', 'INPUTS', ORANGE, { channels: ['throttle', 'brake'], traceLength: 200, maxFontSize: 26 }),
    w('weather', 854, 456, 156, 130, warmStyle({ title: 'TRACK', accentColor: AMBER, maxFontSize: 26 }), { name: 'Weather' })
  ]
  return dashboard('Endurance DDU Warm', 1024, 600, 'Large endurance DDU preset that fills 1024×600 with stint planning, lap stack, traffic, track map, tyres and warm race status colors.', elements)
}

function createCleanMinimalRedPreset(): Dashboard {
  const elements: DashboardElement[] = [
    w('rect', 0, 0, 1024, 600, warmStyle({ background: '#000000', borderWidth: 0, radius: 0 }), { name: 'RedMinimalBackplate' }),
    w('shiftbar', 33, 23, 958, 43, warmStyle({ segments: 22, flashAt: 0.98, warnAt: 0.65, dangerAt: 0.85, glow: true, segmentShape: 'bar', fillColor: ORANGE, warnColor: AMBER, dangerColor: RED, radius: 999 }), { binding: 'shiftPct', name: 'MinimalWarmShift' }),
    warmWidget('speed-clean', 49, 93, 215, 130, 'Speed', 'SPEED', WARM_WHITE, { background: '#000000', maxFontSize: 72 }),
    warmWidget('gear-clean', 289, 88, 446, 283, 'Gear', 'GEAR', AMBER, { background: '#000000', radius: 26, maxFontSize: 168 }),
    warmWidget('delta-clean', 760, 93, 215, 130, 'Delta', 'DELTA', RED, { background: '#000000', deltaRangeSec: 1, maxFontSize: 60 }, 'deltaSec'),
    warmWidget('rpm-clean', 49, 245, 215, 100, 'Rpm', 'RPM', ORANGE, { maxFontSize: 52 }),
    warmWidget('fuel-clean', 760, 245, 215, 100, 'Fuel', 'FUEL', AMBER, { maxFontSize: 48 }),
    w('deltabar', 166, 393, 692, 28, warmStyle({ background: '#000000', fillColor: AMBER, dangerColor: RED, deltaRangeSec: 1, radius: 999 }), { binding: 'deltaSec', name: 'MinimalDeltaBar' }),
    warmWidget('lap-clean', 49, 450, 184, 103, 'Lap', 'LAP', ORANGE, { maxFontSize: 46 }),
    warmWidget('position-clean', 253, 450, 184, 103, 'Position', 'POS', AMBER, { maxFontSize: 46 }),
    warmWidget('flags-clean', 458, 450, 205, 103, 'Flags', 'FLAGS', AMBER, { maxFontSize: 44 }),
    warmWidget('abs-clean', 684, 450, 133, 103, 'Abs', 'ABS', ORANGE, { maxFontSize: 42 }),
    warmWidget('tc-clean', 837, 450, 138, 103, 'Tc', 'TC', ORANGE, { maxFontSize: 42 })
  ]
  return dashboard('Clean Minimal Red', 1024, 600, 'Sporty red minimal wheel display: giant gear, big speed/delta, compact race state and setup without wasted space.', elements)
}

function createQualyCleanWarmPreset(): Dashboard {
  const elements: DashboardElement[] = [
    w('rect', 0, 0, 1024, 600, warmStyle({ background: '#000000', borderWidth: 0, radius: 0 }), { name: 'QualyBackplate' }),
    w('shiftbar', 20, 16, 984, 48, warmStyle({ segments: 30, flashAt: 0.985, warnAt: 0.7, dangerAt: 0.9, glow: true, segmentShape: 'led', fillColor: ORANGE, warnColor: AMBER, dangerColor: RED, radius: 8 }), { binding: 'shiftPct', name: 'QualyShift' }),
    warmWidget('delta-elaborate', 20, 82, 292, 136, 'Delta', 'DELTA', RED, { deltaRangeSec: 0.8, maxFontSize: 70 }, 'deltaSec'),
    w('laptiming', 332, 82, 360, 136, warmStyle({ title: 'TIMING', showCurrent: true, showLast: true, showBest: true, showEstimated: true, accentColor: AMBER, maxFontSize: 44 }), { name: 'QualyTiming' }),
    warmWidget('position-elaborate', 712, 82, 292, 136, 'Position', 'POSITION', AMBER, { maxFontSize: 66 }),
    warmWidget('speed-clean', 20, 238, 166, 106, 'Speed', 'SPEED', WARM_WHITE, { maxFontSize: 70 }),
    warmWidget('gear-clean', 204, 238, 200, 162, 'Gear', 'GEAR', AMBER, { maxFontSize: 104 }),
    warmWidget('rpm-clean', 422, 238, 166, 106, 'Rpm', 'RPM', ORANGE, { maxFontSize: 58 }),
    warmWidget('trackmap-clean', 606, 238, 190, 162, 'TrackMap', 'TRACK', AMBER, { maxFontSize: 34 }, 'lapDistPct'),
    warmWidget('radar-clean', 814, 238, 190, 162, 'Radar', 'RADAR', RED, { maxFontSize: 34 }),
    warmWidget('tyres-clean', 20, 420, 250, 130, 'Tyres', 'TYRES', AMBER, { maxFontSize: 34 }),
    w('brakegrid', 290, 420, 170, 130, warmStyle({ title: 'BRAKES', showAverage: true, accentColor: ORANGE, maxFontSize: 30 }), { name: 'Brakes' }),
    warmWidget('fuel-clean', 480, 420, 150, 130, 'Fuel', 'FUEL', AMBER, { maxFontSize: 54 }),
    warmWidget('map-clean', 650, 420, 110, 130, 'Map', 'MAP', ORANGE, { maxFontSize: 52 }),
    warmWidget('bb-clean', 780, 420, 110, 130, 'BrakeBias', 'BB', AMBER, { maxFontSize: 52 }),
    warmWidget('inputs-clean', 910, 420, 94, 130, 'Inputs', 'INPUTS', ORANGE, { channels: ['throttle', 'brake'], maxFontSize: 28 })
  ]
  return dashboard('Qualy Clean Warm', 1024, 600, 'Qualifying-focused clean preset with large delta/timing, apex-exit radar, compact setup controls and warm high-contrast telemetry.', elements)
}

function createRelativesRadarWarmPreset(): Dashboard {
  const elements: DashboardElement[] = [
    w('rect', 0, 0, 1024, 600, warmStyle({ background: '#000000', borderWidth: 0, radius: 0 }), { name: 'TrafficBackplate' }),
    w('shiftbar', 22, 16, 980, 42, warmStyle({ segments: 26, flashAt: 0.98, warnAt: 0.66, dangerAt: 0.86, glow: true, segmentShape: 'bar', fillColor: ORANGE, warnColor: AMBER, dangerColor: RED, radius: 8 }), { binding: 'shiftPct', name: 'TrafficShift' }),
    warmWidget('relatives-elaborate', 22, 78, 430, 178, 'Relatives', 'RELATIVES', AMBER, { maxFontSize: 40 }),
    warmWidget('radar-elaborate', 474, 78, 246, 248, 'Radar', 'RADAR', RED, { maxFontSize: 38 }),
    warmWidget('trackmap-elaborate', 742, 78, 260, 248, 'TrackMap', 'TRACK MAP', AMBER, { maxFontSize: 34 }, 'lapDistPct'),
    warmWidget('gear-elaborate', 22, 276, 196, 176, 'Gear', 'GEAR', AMBER, { maxFontSize: 94 }),
    warmWidget('speed-elaborate', 238, 276, 214, 82, 'Speed', 'SPEED', WARM_WHITE, { maxFontSize: 54 }),
    warmWidget('delta-clean', 238, 372, 214, 80, 'Delta', 'DELTA', RED, { deltaRangeSec: 1.2, maxFontSize: 48 }, 'deltaSec'),
    warmWidget('position-elaborate', 474, 348, 246, 104, 'Position', 'POSITION', AMBER, { maxFontSize: 58 }),
    warmWidget('flags-elaborate', 742, 348, 260, 104, 'Flags', 'FLAGS', AMBER, { maxFontSize: 52 }),
    warmWidget('pitlimiter-clean', 22, 474, 138, 82, 'PitLimiter', 'PIT', ORANGE, { maxFontSize: 44 }),
    warmWidget('incidents-clean', 176, 474, 138, 82, 'Incidents', 'INC', RED, { maxFontSize: 44 }),
    warmWidget('fuel-clean', 330, 474, 160, 82, 'Fuel', 'FUEL', AMBER, { maxFontSize: 44 }),
    warmWidget('lap-clean', 506, 474, 160, 82, 'Lap', 'LAP', ORANGE, { maxFontSize: 44 }),
    warmWidget('inputs-elaborate', 682, 474, 320, 82, 'Inputs', 'INPUTS', ORANGE, { channels: ['throttle', 'brake'], traceLength: 180, maxFontSize: 30 })
  ]
  return dashboard('Relatives + Radar Warm', 1024, 600, 'Traffic-management preset with a dominant relatives table, large radar, track map, race flags and compact warm core telemetry.', elements)
}

function createTyresBrakesWarmPreset(): Dashboard {
  const elements: DashboardElement[] = [
    w('rect', 0, 0, 1024, 600, warmStyle({ background: '#000000', borderWidth: 0, radius: 0 }), { name: 'TyreBrakeBackplate' }),
    w('shiftbar', 18, 14, 988, 42, warmStyle({ segments: 24, flashAt: 0.98, warnAt: 0.66, dangerAt: 0.86, glow: true, segmentShape: 'led', fillColor: ORANGE, warnColor: AMBER, dangerColor: RED, radius: 8 }), { binding: 'shiftPct', name: 'TyreBrakeShift' }),
    warmWidget('tyres-elaborate', 18, 76, 390, 250, 'Tyres', 'TYRES', ORANGE, { coldAt: 72, optimalAt: 88, hotAt: 104, criticalAt: 118, maxFontSize: 40 }),
    w('cornerstack', 426, 76, 230, 250, warmStyle({ title: 'CORNER HEALTH', targetValue: 165, tolerance: 7, accentColor: AMBER, maxFontSize: 34 }), { name: 'CornerHealth' }),
    w('brakegrid', 674, 76, 160, 250, warmStyle({ title: 'BRAKES', showAverage: true, accentColor: ORANGE, maxFontSize: 34 }), { name: 'BrakeTemps' }),
    warmWidget('temps-elaborate', 852, 76, 154, 250, 'Temps', 'ENGINE', ORANGE, { maxFontSize: 30 }),
    warmWidget('gear-clean', 18, 348, 154, 120, 'Gear', 'GEAR', AMBER, { maxFontSize: 78 }),
    warmWidget('speed-clean', 190, 348, 154, 120, 'Speed', 'SPEED', WARM_WHITE, { maxFontSize: 64 }),
    warmWidget('delta-clean', 362, 348, 154, 120, 'Delta', 'DELTA', RED, { deltaRangeSec: 1, maxFontSize: 54 }, 'deltaSec'),
    warmWidget('abs-elaborate', 534, 348, 110, 120, 'Abs', 'ABS', AMBER, { maxFontSize: 48 }),
    warmWidget('tc-elaborate', 662, 348, 110, 120, 'Tc', 'TC', ORANGE, { maxFontSize: 48 }),
    warmWidget('bb-elaborate', 790, 348, 102, 120, 'BrakeBias', 'BB', AMBER, { maxFontSize: 46 }),
    warmWidget('map-elaborate', 910, 348, 96, 120, 'Map', 'MAP', ORANGE, { maxFontSize: 46 }),
    warmWidget('inputs-elaborate', 18, 490, 260, 82, 'Inputs', 'INPUTS', ORANGE, { channels: ['throttle', 'brake'], traceLength: 180, maxFontSize: 30 }),
    w('weather', 296, 490, 182, 82, warmStyle({ title: 'TRACK', accentColor: AMBER, maxFontSize: 30 }), { name: 'Weather' }),
    warmWidget('fuel-clean', 496, 490, 142, 82, 'Fuel', 'FUEL', AMBER, { maxFontSize: 42 }),
    warmWidget('lap-clean', 656, 490, 142, 82, 'Lap', 'LAP', ORANGE, { maxFontSize: 42 }),
    warmWidget('flags-clean', 816, 490, 190, 82, 'Flags', 'FLAGS', AMBER, { maxFontSize: 42 })
  ]
  return dashboard('Tyres & Brakes Warm', 1024, 600, 'Engineering-heavy preset for tyre and brake management, pairing rich corner data with readable core driving and setup widgets.', elements)
}

function createApexNightStintPreset(): Dashboard {
  const elements: DashboardElement[] = [
    w('rect', 0, 0, 1024, 600, warmStyle({ background: '#000000', borderWidth: 0, radius: 0 }), { name: 'ApexNightBackplate' }),
    w('shiftbar', 31, 23, 962, 38, warmStyle({ segments: 24, flashAt: 0.98, warnAt: 0.66, dangerAt: 0.86, glow: true, segmentShape: 'bar', fillColor: ORANGE, warnColor: AMBER, dangerColor: RED, radius: 999 }), { binding: 'shiftPct', name: 'NightShiftRail' }),
    w('fuelstint', 31, 90, 302, 210, warmStyle({ title: 'STINT RANGE', enduranceMode: true, reserveLaps: 2, warnAtLaps: 3, accentColor: AMBER, maxFontSize: 58 }), { name: 'StintRange' }),
    warmWidget('gear-clean', 364, 90, 297, 250, 'Gear', 'GEAR', AMBER, { background: '#000000', maxFontSize: 132 }),
    warmWidget('position-clean', 691, 90, 302, 98, 'Position', 'POS', ORANGE, { maxFontSize: 46 }),
    warmWidget('flags-clean', 691, 208, 302, 93, 'Flags', 'FLAGS', AMBER, { maxFontSize: 40 }),
    warmWidget('speed-clean', 31, 325, 205, 105, 'Speed', 'SPEED', WARM_WHITE, { maxFontSize: 56 }),
    warmWidget('delta-clean', 261, 325, 205, 105, 'Delta', 'DELTA', RED, { deltaRangeSec: 1, maxFontSize: 50 }, 'deltaSec'),
    w('laptiming', 491, 365, 502, 105, warmStyle({ title: 'LAPS', showCurrent: false, showLast: true, showBest: true, showEstimated: true, accentColor: AMBER, maxFontSize: 34 }), { name: 'NightLapStack' }),
    warmWidget('temps-clean', 31, 455, 205, 105, 'Engine', 'ENGINE', ORANGE, { maxFontSize: 30 }),
    warmWidget('relatives-clean', 261, 485, 379, 75, 'Traffic', 'TRAFFIC', AMBER, { maxFontSize: 28 }),
    w('setupstrip', 666, 490, 328, 70, warmStyle({ fields: ['limiter', 'inc', 'bb'], compact: true, accentColor: ORANGE, maxFontSize: 24 }), { name: 'NightSetupStrip' })
  ]
  return dashboard('Apex Night Stint', 1024, 600, 'Original night/endurance GT3 page focused on stint range, fuel margin, flags, position and compact traffic context.', elements)
}

function createRedlineQualyAttackPreset(): Dashboard {
  const elements: DashboardElement[] = [
    w('rect', 0, 0, 1024, 600, warmStyle({ background: '#000000', borderWidth: 0, radius: 0 }), { name: 'RedlineQualyBackplate' }),
    w('shiftbar', 20, 16, 984, 46, warmStyle({ segments: 30, flashAt: 0.985, warnAt: 0.7, dangerAt: 0.9, glow: true, segmentShape: 'led', fillColor: ORANGE, warnColor: AMBER, dangerColor: RED, radius: 8 }), { binding: 'shiftPct', name: 'QualyAttackShift' }),
    w('deltatile', 20, 84, 330, 142, warmStyle({ title: 'PREDICTIVE DELTA', deltaReference: 'session', deltaRangeSec: 0.8, accentColor: RED, maxFontSize: 82 }), { binding: 'deltaSec', name: 'PredictiveDelta' }),
    w('deltabar', 374, 132, 276, 28, warmStyle({ background: '#000000', fillColor: AMBER, dangerColor: RED, deltaRangeSec: 0.8, radius: 999 }), { binding: 'deltaSec', name: 'AttackDeltaBar' }),
    w('laptiming', 674, 84, 330, 142, warmStyle({ title: 'LAP STACK', showCurrent: true, showLast: true, showBest: true, showEstimated: true, accentColor: AMBER, maxFontSize: 44 }), { name: 'AttackTiming' }),
    warmWidget('speed-clean', 54, 258, 178, 110, 'Speed', 'SPEED', WARM_WHITE, { maxFontSize: 72 }),
    warmWidget('gear-clean', 262, 238, 236, 178, 'Gear', 'GEAR', AMBER, { maxFontSize: 118 }),
    warmWidget('rpm-clean', 528, 258, 178, 110, 'Rpm', 'RPM', ORANGE, { maxFontSize: 62 }),
    warmWidget('trackmap-clean', 736, 238, 238, 178, 'TrackMap', 'TRACK', AMBER, { maxFontSize: 34 }, 'lapDistPct'),
    warmWidget('tyres-clean', 20, 448, 250, 106, 'Tyres', 'TYRES', ORANGE, { maxFontSize: 32 }),
    warmWidget('bb-clean', 292, 448, 130, 106, 'BrakeBias', 'BB', AMBER, { maxFontSize: 48 }),
    warmWidget('map-clean', 444, 448, 130, 106, 'Map', 'MAP', ORANGE, { maxFontSize: 48 }),
    warmWidget('inputs-elaborate', 596, 448, 218, 106, 'Inputs', 'INPUTS', ORANGE, { channels: ['throttle', 'brake'], traceLength: 160, maxFontSize: 28 }),
    warmWidget('flags-clean', 836, 448, 168, 106, 'Flags', 'FLAGS', AMBER, { maxFontSize: 44 })
  ]
  return dashboard('Redline Qualy Attack · 1024×600', 1024, 600, 'Original qualifying GT3 page with dominant predictive delta, lap stack, central gear and setup/input context for push laps.', elements)
}

function createTyreWindowEngineerPreset(): Dashboard {
  const elements: DashboardElement[] = [
    w('rect', 0, 0, 1024, 600, warmStyle({ background: '#000000', borderWidth: 0, radius: 0 }), { name: 'TyreWindowBackplate' }),
    w('shiftbar', 24, 18, 976, 36, warmStyle({ segments: 24, flashAt: 0.98, warnAt: 0.66, dangerAt: 0.86, glow: true, segmentShape: 'bar', fillColor: ORANGE, warnColor: AMBER, dangerColor: RED, radius: 8 }), { binding: 'shiftPct', name: 'TyreWindowShift' }),
    warmWidget('tyres-elaborate', 24, 78, 412, 280, 'Tyres', 'TYRE WINDOW', ORANGE, { coldAt: 72, optimalAt: 88, hotAt: 104, criticalAt: 118, maxFontSize: 42 }),
    w('tyregrid', 456, 78, 190, 134, warmStyle({ gridMode: 'pressure', title: 'PRESSURES', targetValue: 165, tolerance: 7, accentColor: AMBER, maxFontSize: 32 }), { name: 'PressureGrid' }),
    w('brakegrid', 456, 224, 190, 134, warmStyle({ title: 'BRAKES', showAverage: true, accentColor: ORANGE, maxFontSize: 32 }), { name: 'BrakeGrid' }),
    w('cornerstack', 666, 78, 334, 280, warmStyle({ title: 'CORNER HEALTH', targetValue: 165, tolerance: 7, accentColor: AMBER, maxFontSize: 34 }), { name: 'CornerStack' }),
    warmWidget('gear-clean', 24, 386, 132, 90, 'Gear', 'GEAR', AMBER, { maxFontSize: 68 }),
    warmWidget('speed-clean', 176, 386, 132, 90, 'Speed', 'SPEED', WARM_WHITE, { maxFontSize: 56 }),
    warmWidget('delta-clean', 328, 386, 150, 90, 'Delta', 'DELTA', RED, { deltaRangeSec: 1, maxFontSize: 48 }, 'deltaSec'),
    warmWidget('temps-elaborate', 498, 386, 160, 90, 'Engine', 'ENGINE', ORANGE, { maxFontSize: 28 }),
    w('weather', 678, 386, 150, 90, warmStyle({ title: 'TRACK', accentColor: AMBER, maxFontSize: 28 }), { name: 'TrackWeather' }),
    warmWidget('inputs-elaborate', 848, 386, 152, 90, 'Inputs', 'INPUTS', ORANGE, { channels: ['throttle', 'brake'], maxFontSize: 26 }),
    w('setupstrip', 24, 502, 976, 58, warmStyle({ fields: ['abs', 'tc', 'map', 'bb', 'limiter', 'inc'], compact: true, accentColor: ORANGE, maxFontSize: 26 }), { name: 'EngineerSetupStrip' })
  ]
  return dashboard('Tyre Window Engineer · 1024×600', 1024, 600, 'Original engineering page for managing tyre temperature, pressure, brake heat and setup while retaining core speed/gear/delta.', elements)
}

function createDeltaFocusSquarePreset(): Dashboard {
  const elements: DashboardElement[] = [
    w('rect', 0, 0, 1024, 600, warmStyle({ background: '#000000', borderWidth: 0, radius: 0 }), { name: 'DeltaSquareBackplate' }),
    w('shiftbar', 20, 10, 984, 34, warmStyle({ segments: 20, flashAt: 0.98, warnAt: 0.66, dangerAt: 0.86, glow: true, segmentShape: 'bar', fillColor: ORANGE, warnColor: AMBER, dangerColor: RED, radius: 999 }), { binding: 'shiftPct', name: 'SquareShift' }),
    cv('currentLapFmt', 20, 52, 480, 88, 'LAP', { accentColor: TEXT, minFontSize: 22, maxFontSize: 52 }),
    cv('bestLapFmt', 524, 52, 480, 88, 'BEST', { accentColor: MUTED, minFontSize: 22, maxFontSize: 52 }),
    warmWidget('delta-elaborate', 20, 148, 984, 152, 'Delta', 'DELTA', RED, { deltaRangeSec: 1, maxFontSize: 80 }, 'deltaSec'),
    warmWidget('gear-clean', 202, 312, 620, 196, 'Gear', 'GEAR', AMBER, { background: '#000000', maxFontSize: 140 }),
    warmWidget('speed-clean', 20, 516, 305, 68, 'Speed', 'SPEED', WARM_WHITE, { maxFontSize: 44 }),
    warmWidget('lap-clean', 359, 516, 306, 68, 'Lap', 'LAP', ORANGE, { maxFontSize: 40 }),
    warmWidget('fuel-clean', 699, 516, 305, 68, 'Fuel', 'FUEL', AMBER, { maxFontSize: 40 })
  ]
  return dashboard('Delta Focus Square', 1024, 600, 'Original square wheel page redesigned for 1024×600: predictive delta first, current and best lap at top, central gear, speed, lap and fuel.', elements)
}

function createTrafficAttackCompactPreset(): Dashboard {
  const elements: DashboardElement[] = [
    w('rect', 0, 0, 1024, 600, warmStyle({ background: '#000000', borderWidth: 0, radius: 0 }), { name: 'TrafficAttackBackplate' }),
    w('shiftbar', 28, 20, 968, 43, warmStyle({ segments: 22, flashAt: 0.98, warnAt: 0.66, dangerAt: 0.86, glow: true, segmentShape: 'led', fillColor: ORANGE, warnColor: AMBER, dangerColor: RED, radius: 8 }), { binding: 'shiftPct', name: 'TrafficAttackShift' }),
    warmWidget('relatives-elaborate', 28, 90, 399, 168, 'Relatives', 'RELATIVES', AMBER, { maxFontSize: 34 }),
    warmWidget('radar-elaborate', 453, 90, 215, 230, 'Radar', 'RADAR', RED, { maxFontSize: 32 }),
    warmWidget('position-elaborate', 694, 90, 302, 110, 'Position', 'POSITION', ORANGE, { maxFontSize: 50 }),
    warmWidget('flags-clean', 694, 218, 302, 103, 'Flags', 'FLAGS', AMBER, { maxFontSize: 42 }),
    warmWidget('gear-clean', 49, 293, 218, 175, 'Gear', 'GEAR', AMBER, { maxFontSize: 88 }),
    warmWidget('speed-clean', 294, 345, 174, 103, 'Speed', 'SPEED', WARM_WHITE, { maxFontSize: 50 }),
    warmWidget('delta-clean', 494, 345, 174, 103, 'Delta', 'DELTA', RED, { deltaRangeSec: 1.2, maxFontSize: 44 }, 'deltaSec'),
    warmWidget('trackmap-clean', 694, 345, 302, 103, 'TrackMap', 'TRACK', AMBER, { maxFontSize: 28 }, 'lapDistPct'),
    warmWidget('fuel-clean', 28, 495, 161, 75, 'Fuel', 'FUEL', AMBER, { maxFontSize: 34 }),
    warmWidget('lap-clean', 210, 495, 161, 75, 'Lap', 'LAP', ORANGE, { maxFontSize: 34 }),
    w('setupstrip', 392, 495, 604, 75, warmStyle({ fields: ['abs', 'tc', 'bb', 'limiter', 'inc'], compact: true, accentColor: ORANGE, maxFontSize: 24 }), { name: 'TrafficAttackSetup' })
  ]
  return dashboard('Traffic Attack Compact', 1024, 600, 'Original compact race page for multiclass traffic: relatives and radar first, with clear gear/speed/delta and flag status.', elements)
}


// ── Dense recreations (replace the old thin "24-bit Cup" presets) ─────────────
// Six original, manufacturer-free 1024×600 dashboards rebuilt from real DDU /
// HUD reference layouts. Every one prioritises tyres, incidents, the relative
// car ahead+behind (name/number/gap), lap/last/best/delta, fuel/stint, position
// and the shift bar, and packs the canvas edge-to-edge. Water/oil are kept small
// or omitted. Warm chrome (red/orange/amber); cool/green only signals good state.

function backplate(name: string): DashboardElement {
  return w('rect', 0, 0, TARGET_W, TARGET_H, { background: '#000000', borderWidth: 0, radius: 0 }, { name })
}

function gearHero(x: number, y: number, width: number, height: number, color = WARM_WHITE): DashboardElement {
  return cv('gearLabel', x, y, width, height, '', {
    fontFamily: FONT_COND,
    color,
    minFontSize: 90,
    maxFontSize: Math.round(height * 0.92)
  })
}

// (a) GT3 Cup DDU — fuel variant (recreates R.png: shift LEDs, DRY/light, big
// centre gear, speed, FUEL/REM.LAPS/CONS/TANK stack, LAP TIME + DELTA, temps +
// INC + tyre temps, TIME/POS/BEST, bottom BIAS/ABS-TC-MAP-BB/INC/POS).
function createGt3CupDduFuelPreset(): Dashboard {
  const elements: DashboardElement[] = [
    backplate('CupFuelBackplate'),
    denseRevBar(12, 10, 1000, 24, 26),
    w('weather', 206, 40, 184, 44, warmStyle({ title: 'TRACK', accentColor: AMBER, maxFontSize: 24 }), { name: 'HdrWeather' }),
    card(437, 38, 150, 46, ORANGE, 'SpeedBox'),
    bigValue('speedKmh', 437, 38, 150, 46, 'SPEED', WARM_WHITE, { maxFontSize: 34 }),
    ...lvRow(636, 44, 372, 34, 'HdrLap', 'LAP', 'currentLap', ORANGE),
    hairline(302, 92, 1, 408),
    hairline(716, 92, 1, 408),
    // Left: fuel stack.
    ...lvRow(16, 102, 278, 52, 'Fuel', 'FUEL', 'fuelLitersStr', AMBER, { suffix: 'L' }),
    ...lvRow(16, 160, 278, 52, 'RemLaps', 'REM.LAPS', 'fuelLapsLeftStr', AMBER),
    ...lvRow(16, 218, 278, 52, 'Cons', 'CONS', 'fuelPerLapStr', AMBER),
    ...lvRow(16, 276, 278, 52, 'Tank', 'TANK', 'fuelPct', AMBER, { suffix: '%' }),
    // Centre: hero gear + rpm.
    gearHero(322, 92, 380, 210, AMBER),
    bigValue('rpm', 352, 306, 320, 44, 'RPM', ORANGE, { maxFontSize: 40 }),
    // Right: lap time + delta.
    text(724, 96, 284, 24, 'LapTimeLbl', { text: 'LAP TIME', color: ORANGE, fontSize: 18, fontWeight: 900, align: 'left', fontFamily: FONT_COND }),
    bigValue('currentLapFmt', 724, 120, 284, 70, '', WARM_WHITE, { maxFontSize: 56 }),
    w('deltatile', 724, 196, 284, 130, warmStyle({ title: 'DELTA', deltaReference: 'session', deltaRangeSec: 1, accentColor: RED, maxFontSize: 64 }), { binding: 'deltaSec', name: 'CupFuelDelta' }),
    // Mid: temps + inc | tyre temps | time/pos/best.
    ...lvRow(16, 360, 278, 44, 'Air', 'AIR', 'airTempC', ORANGE, { suffix: '°' }),
    ...lvRow(16, 408, 278, 44, 'Track', 'TRACK', 'trackTempC', ORANGE, { suffix: '°' }),
    ...lvRow(16, 456, 278, 44, 'Inc', 'INC', 'incidentCount', RED),
    w('tyregrid', 312, 356, 396, 146, warmStyle({ gridMode: 'temp', title: 'TYRE °C', showLabels: true, accentColor: AMBER, maxFontSize: 30 }), { name: 'CupFuelTyres' }),
    ...lvRow(724, 360, 284, 44, 'TimeLeft', 'TIME LEFT', 'sessionTimeLeftFmt', AMBER),
    ...lvRow(724, 408, 284, 44, 'Pos', 'POSITION', 'position', AMBER),
    ...lvRow(724, 456, 284, 44, 'Best', 'BEST', 'bestLapFmt', ORANGE),
    // Footer: bias / setup / inc / pos.
    bigValue('brakeBiasPct', 16, 514, 178, 74, 'BIAS', AMBER, { maxFontSize: 46 }),
    w('setupstrip', 206, 522, 520, 60, warmStyle({ fields: ['abs', 'tc', 'map', 'bb'], compact: true, accentColor: ORANGE, maxFontSize: 26 }), { name: 'CupFuelSetup' }),
    bigValue('incidentCount', 740, 514, 124, 74, 'INC', RED, { maxFontSize: 48 }),
    bigValue('position', 874, 514, 134, 74, 'POS', AMBER, { maxFontSize: 48 })
  ]
  return dashboard('GT3 Cup DDU · Fuel', 1024, 600, 'Dense GT3 Cup DDU recreation (fuel page): top shift LEDs, big centre gear + rpm, fuel/laps/cons/tank stack, lap time + predictive delta, tyre temps, air/track/incidents and a bias/ABS/TC/MAP/BB setup footer.', elements)
}

// (b) GT3 Cup DDU — track-map variant (recreates dash2.png: same Cup DDU but the
// left hero block is a live track map; fuel moves to a stint tile, relatives sit
// centre, tyre pressures left-bottom).
function createGt3CupDduTrackmapPreset(): Dashboard {
  const elements: DashboardElement[] = [
    backplate('CupMapBackplate'),
    denseRevBar(12, 10, 1000, 24, 26),
    w('weather', 206, 40, 184, 44, warmStyle({ title: 'TRACK', accentColor: AMBER, maxFontSize: 24 }), { name: 'HdrWeather' }),
    card(437, 38, 150, 46, ORANGE, 'SpeedBox'),
    bigValue('speedKmh', 437, 38, 150, 46, 'SPEED', WARM_WHITE, { maxFontSize: 34 }),
    ...lvRow(636, 44, 372, 34, 'HdrLap', 'LAP', 'currentLap', ORANGE),
    hairline(302, 92, 1, 408),
    hairline(716, 92, 1, 408),
    // Left hero: live track map.
    w('trackmap-elaborate', 14, 96, 282, 250, warmStyle({ accentColor: AMBER, color: MUTED, maxFontSize: 26 }), { binding: 'lapDistPct', name: 'CupMapTrack' }),
    // Centre: hero gear + rpm.
    gearHero(322, 92, 380, 210, AMBER),
    bigValue('rpm', 352, 306, 320, 44, 'RPM', ORANGE, { maxFontSize: 40 }),
    // Right: lap time + delta.
    text(724, 96, 284, 24, 'LapTimeLbl', { text: 'LAP TIME', color: ORANGE, fontSize: 18, fontWeight: 900, align: 'left', fontFamily: FONT_COND }),
    bigValue('currentLapFmt', 724, 120, 284, 70, '', WARM_WHITE, { maxFontSize: 56 }),
    w('deltatile', 724, 196, 284, 130, warmStyle({ title: 'DELTA', deltaReference: 'session', deltaRangeSec: 1, accentColor: RED, maxFontSize: 64 }), { binding: 'deltaSec', name: 'CupMapDelta' }),
    // Mid: tyre pressures | relatives ahead/behind | fuel stint.
    w('tyregrid', 14, 356, 282, 146, warmStyle({ gridMode: 'pressure', title: 'TYRE PRESS', targetValue: 165, tolerance: 7, showLabels: true, accentColor: AMBER, maxFontSize: 28 }), { name: 'CupMapTyrePress' }),
    w('relatives-elaborate', 312, 356, 396, 146, warmStyle({ accentColor: AMBER, maxFontSize: 32 }), { name: 'CupMapRelatives' }),
    w('fuelstint', 724, 356, 284, 146, warmStyle({ title: 'FUEL / STINT', reserveLaps: 1, warnAtLaps: 2, accentColor: AMBER, maxFontSize: 52 }), { name: 'CupMapFuel' }),
    // Footer: bias / setup / inc / pos.
    bigValue('brakeBiasPct', 16, 514, 178, 74, 'BIAS', AMBER, { maxFontSize: 46 }),
    w('setupstrip', 206, 522, 520, 60, warmStyle({ fields: ['abs', 'tc', 'map', 'bb'], compact: true, accentColor: ORANGE, maxFontSize: 26 }), { name: 'CupMapSetup' }),
    bigValue('incidentCount', 740, 514, 124, 74, 'INC', RED, { maxFontSize: 48 }),
    bigValue('position', 874, 514, 134, 74, 'POS', AMBER, { maxFontSize: 48 })
  ]
  return dashboard('GT3 Cup DDU · Track Map', 1024, 600, 'Dense GT3 Cup DDU recreation (track-map page): live track map hero, big centre gear + rpm, lap time + delta, tyre pressures, relative car ahead/behind with gaps, fuel/stint and a setup footer.', elements)
}

// (c-1) GT3 Cup DDU — tyres variant: left hero = elaborate 4-tyre grid (temps).
// Color theme: ORANGE primary, RED danger (hot tyre management).
function createGt3CupDduTyresPreset(): Dashboard {
  const elements: DashboardElement[] = [
    backplate('CupTyresBackplate'),
    denseRevBar(12, 10, 1000, 24, 26),
    w('weather', 206, 40, 184, 44, warmStyle({ title: 'TRACK', accentColor: ORANGE, maxFontSize: 24 }), { name: 'HdrWeather' }),
    card(437, 38, 150, 46, RED, 'SpeedBox'),
    bigValue('speedKmh', 437, 38, 150, 46, 'SPEED', WARM_WHITE, { maxFontSize: 34 }),
    ...lvRow(636, 44, 372, 34, 'HdrLap', 'LAP', 'currentLap', RED),
    hairline(302, 92, 1, 408),
    hairline(716, 92, 1, 408),
    w('tyres-elaborate', 14, 96, 282, 250, warmStyle({ accentColor: ORANGE, coldAt: 72, optimalAt: 88, hotAt: 104, criticalAt: 118, maxFontSize: 32 }), { name: 'CupTyresHero' }),
    gearHero(322, 92, 380, 210, ORANGE),
    bigValue('rpm', 352, 306, 320, 44, 'RPM', RED, { maxFontSize: 40 }),
    text(724, 96, 284, 24, 'LapTimeLbl', { text: 'LAP TIME', color: RED, fontSize: 18, fontWeight: 900, align: 'left', fontFamily: FONT_COND }),
    bigValue('currentLapFmt', 724, 120, 284, 70, '', WARM_WHITE, { maxFontSize: 56 }),
    w('deltatile', 724, 196, 284, 130, warmStyle({ title: 'DELTA', deltaReference: 'session', deltaRangeSec: 1, accentColor: RED, maxFontSize: 64 }), { binding: 'deltaSec', name: 'CupTyresDelta' }),
    w('tyregrid', 14, 356, 282, 146, warmStyle({ gridMode: 'pressure', title: 'TYRE PRESS', targetValue: 165, tolerance: 7, showLabels: true, accentColor: ORANGE, maxFontSize: 26 }), { name: 'CupTyresPressure' }),
    w('brakegrid', 312, 356, 196, 146, warmStyle({ title: 'BRAKES', showAverage: true, accentColor: RED, maxFontSize: 28 }), { name: 'CupTyresBrakes' }),
    ...lvRow(724, 360, 284, 44, 'TimeLeft', 'TIME LEFT', 'sessionTimeLeftFmt', ORANGE),
    ...lvRow(724, 408, 284, 44, 'Pos', 'POSITION', 'position', RED),
    ...lvRow(724, 456, 284, 44, 'Best', 'BEST', 'bestLapFmt', ORANGE),
    w('cornerstack', 516, 356, 192, 146, warmStyle({ targetValue: 165, tolerance: 7, accentColor: ORANGE, maxFontSize: 22 }), { name: 'CupTyresCorners' }),
    bigValue('brakeBiasPct', 16, 514, 178, 74, 'BIAS', ORANGE, { maxFontSize: 46 }),
    w('setupstrip', 206, 522, 520, 60, warmStyle({ fields: ['abs', 'tc', 'map', 'bb'], compact: true, accentColor: RED, maxFontSize: 26 }), { name: 'CupTyresSetup' }),
    bigValue('incidentCount', 740, 514, 124, 74, 'INC', RED, { maxFontSize: 48 }),
    bigValue('position', 874, 514, 134, 74, 'POS', ORANGE, { maxFontSize: 48 })
  ]
  return dashboard('GT3 Cup DDU · Tyres', 1024, 600, 'Dense GT3 Cup DDU (tyres page): elaborate 4-tyre temp hero, tyre pressure grid and corner health mid, big centre gear, lap time + delta, and orange/red heat theme.', elements)
}

// (c-2) GT3 Cup DDU — relatives variant: left hero = elaborate relatives table.
// Color theme: AMBER primary (race awareness).
function createGt3CupDduRelativesPreset(): Dashboard {
  const elements: DashboardElement[] = [
    backplate('CupRelBackplate'),
    denseRevBar(12, 10, 1000, 24, 26),
    w('weather', 206, 40, 184, 44, warmStyle({ title: 'TRACK', accentColor: AMBER, maxFontSize: 24 }), { name: 'HdrWeather' }),
    card(437, 38, 150, 46, ORANGE, 'SpeedBox'),
    bigValue('speedKmh', 437, 38, 150, 46, 'SPEED', WARM_WHITE, { maxFontSize: 34 }),
    ...lvRow(636, 44, 372, 34, 'HdrLap', 'LAP', 'currentLap', AMBER),
    hairline(302, 92, 1, 408),
    hairline(716, 92, 1, 408),
    w('relatives-elaborate', 14, 96, 282, 250, warmStyle({ accentColor: AMBER, reference: 'AHEAD / BEHIND', maxFontSize: 30 }), { name: 'CupRelHero' }),
    gearHero(322, 92, 380, 210, AMBER),
    bigValue('rpm', 352, 306, 320, 44, 'RPM', ORANGE, { maxFontSize: 40 }),
    text(724, 96, 284, 24, 'LapTimeLbl', { text: 'LAP TIME', color: AMBER, fontSize: 18, fontWeight: 900, align: 'left', fontFamily: FONT_COND }),
    bigValue('currentLapFmt', 724, 120, 284, 70, '', WARM_WHITE, { maxFontSize: 56 }),
    w('deltatile', 724, 196, 284, 130, warmStyle({ title: 'DELTA', deltaReference: 'session', deltaRangeSec: 1, accentColor: RED, maxFontSize: 64 }), { binding: 'deltaSec', name: 'CupRelDelta' }),
    w('positiongaps', 14, 356, 282, 146, warmStyle({ showTotal: true, accentColor: AMBER, maxFontSize: 60 }), { name: 'CupRelPosGaps' }),
    w('tyregrid', 312, 356, 196, 146, warmStyle({ gridMode: 'temp', title: 'TYRES °C', showLabels: true, accentColor: AMBER, maxFontSize: 26 }), { name: 'CupRelTyres' }),
    ...lvRow(724, 360, 284, 44, 'TimeLeft', 'TIME LEFT', 'sessionTimeLeftFmt', AMBER),
    ...lvRow(724, 408, 284, 44, 'Pos', 'POSITION', 'position', AMBER),
    ...lvRow(724, 456, 284, 44, 'Best', 'BEST', 'bestLapFmt', ORANGE),
    w('fuelstint', 516, 356, 192, 146, warmStyle({ title: 'FUEL', reserveLaps: 1, warnAtLaps: 2, accentColor: AMBER, maxFontSize: 40 }), { name: 'CupRelFuel' }),
    bigValue('brakeBiasPct', 16, 514, 178, 74, 'BIAS', AMBER, { maxFontSize: 46 }),
    w('setupstrip', 206, 522, 520, 60, warmStyle({ fields: ['abs', 'tc', 'map', 'bb'], compact: true, accentColor: ORANGE, maxFontSize: 26 }), { name: 'CupRelSetup' }),
    bigValue('incidentCount', 740, 514, 124, 74, 'INC', RED, { maxFontSize: 48 }),
    bigValue('position', 874, 514, 134, 74, 'POS', AMBER, { maxFontSize: 48 })
  ]
  return dashboard('GT3 Cup DDU · Relatives', 1024, 600, 'Dense GT3 Cup DDU (relatives page): elaborate traffic hero showing car ahead/behind, position gaps, fuel peek mid, big centre gear, lap time + delta.', elements)
}

// (c-3) GT3 Cup DDU — inputs/trace variant: left hero = multi-channel input trace.
// Color theme: ORANGE primary, warm-white neutral (driver input focus).
function createGt3CupDduInputsPreset(): Dashboard {
  const elements: DashboardElement[] = [
    backplate('CupInputsBackplate'),
    denseRevBar(12, 10, 1000, 24, 26),
    w('weather', 206, 40, 184, 44, warmStyle({ title: 'TRACK', accentColor: ORANGE, maxFontSize: 24 }), { name: 'HdrWeather' }),
    card(437, 38, 150, 46, ORANGE, 'SpeedBox'),
    bigValue('speedKmh', 437, 38, 150, 46, 'SPEED', WARM_WHITE, { maxFontSize: 34 }),
    ...lvRow(636, 44, 372, 34, 'HdrLap', 'LAP', 'currentLap', ORANGE),
    hairline(302, 92, 1, 408),
    hairline(716, 92, 1, 408),
    w('inputtrace', 14, 96, 282, 180, warmStyle({ channels: ['throttle', 'brake', 'steering'], traceLength: 200, accentColor: ORANGE, maxFontSize: 24 }), { name: 'CupInputsTrace' }),
    w('steering', 14, 284, 282, 66, warmStyle({ title: 'STEERING', maxDegrees: 360, showNumeric: true, accentColor: ORANGE, maxFontSize: 28 }), { name: 'CupInputsSteering' }),
    gearHero(322, 92, 380, 210, WARM_WHITE),
    bigValue('rpm', 352, 306, 320, 44, 'RPM', ORANGE, { maxFontSize: 40 }),
    text(724, 96, 284, 24, 'LapTimeLbl', { text: 'LAP TIME', color: ORANGE, fontSize: 18, fontWeight: 900, align: 'left', fontFamily: FONT_COND }),
    bigValue('currentLapFmt', 724, 120, 284, 70, '', WARM_WHITE, { maxFontSize: 56 }),
    w('deltatile', 724, 196, 284, 130, warmStyle({ title: 'DELTA', deltaReference: 'session', deltaRangeSec: 1, accentColor: RED, maxFontSize: 64 }), { binding: 'deltaSec', name: 'CupInputsDelta' }),
    w('enginetemps', 14, 356, 282, 146, warmStyle({ accentColor: ORANGE, maxFontSize: 30 }), { name: 'CupInputsEngine' }),
    w('tyregrid', 312, 356, 396, 146, warmStyle({ gridMode: 'temp', title: 'TYRE °C', showLabels: true, accentColor: AMBER, maxFontSize: 30 }), { name: 'CupInputsTyres' }),
    ...lvRow(724, 360, 284, 44, 'TimeLeft', 'TIME LEFT', 'sessionTimeLeftFmt', ORANGE),
    ...lvRow(724, 408, 284, 44, 'Pos', 'POSITION', 'position', AMBER),
    ...lvRow(724, 456, 284, 44, 'Best', 'BEST', 'bestLapFmt', ORANGE),
    bigValue('brakeBiasPct', 16, 514, 178, 74, 'BIAS', ORANGE, { maxFontSize: 46 }),
    w('setupstrip', 206, 522, 520, 60, warmStyle({ fields: ['abs', 'tc', 'map', 'bb'], compact: true, accentColor: ORANGE, maxFontSize: 26 }), { name: 'CupInputsSetup' }),
    bigValue('incidentCount', 740, 514, 124, 74, 'INC', RED, { maxFontSize: 48 }),
    bigValue('position', 874, 514, 134, 74, 'POS', AMBER, { maxFontSize: 48 })
  ]
  return dashboard('GT3 Cup DDU · Inputs', 1024, 600, 'Dense GT3 Cup DDU (inputs page): rolling throttle/brake/steering trace hero, engine temps mid, big centre gear, lap time + delta, orange driver-input theme.', elements)
}

// (c-4) GT3 Cup DDU — standings variant: left hero = live standings table.
// Color theme: AMBER/ORANGE (championship awareness).
function createGt3CupDduStandingsPreset(): Dashboard {
  const elements: DashboardElement[] = [
    backplate('CupStandBackplate'),
    denseRevBar(12, 10, 1000, 24, 26),
    w('weather', 206, 40, 184, 44, warmStyle({ title: 'TRACK', accentColor: AMBER, maxFontSize: 24 }), { name: 'HdrWeather' }),
    card(437, 38, 150, 46, AMBER, 'SpeedBox'),
    bigValue('speedKmh', 437, 38, 150, 46, 'SPEED', WARM_WHITE, { maxFontSize: 34 }),
    ...lvRow(636, 44, 372, 34, 'HdrLap', 'LAP', 'currentLap', AMBER),
    hairline(302, 92, 1, 408),
    hairline(716, 92, 1, 408),
    w('standings', 14, 96, 282, 250, warmStyle({ tableColumns: ['pos', 'number', 'name', 'gap'], tableMaxRows: 7, highlightPlayer: true, showHeader: true, headerColor: AMBER, accentColor: AMBER, rowHeight: 32, maxFontSize: 24 }), { name: 'CupStandTable' }),
    gearHero(322, 92, 380, 210, AMBER),
    bigValue('rpm', 352, 306, 320, 44, 'RPM', ORANGE, { maxFontSize: 40 }),
    text(724, 96, 284, 24, 'LapTimeLbl', { text: 'LAP TIME', color: AMBER, fontSize: 18, fontWeight: 900, align: 'left', fontFamily: FONT_COND }),
    bigValue('currentLapFmt', 724, 120, 284, 70, '', WARM_WHITE, { maxFontSize: 56 }),
    w('deltatile', 724, 196, 284, 130, warmStyle({ title: 'DELTA', deltaReference: 'session', deltaRangeSec: 1, accentColor: RED, maxFontSize: 64 }), { binding: 'deltaSec', name: 'CupStandDelta' }),
    w('positiongaps', 14, 356, 282, 146, warmStyle({ showTotal: true, accentColor: AMBER, maxFontSize: 56 }), { name: 'CupStandPos' }),
    w('tyregrid', 312, 356, 396, 146, warmStyle({ gridMode: 'temp', title: 'TYRE °C', showLabels: true, accentColor: AMBER, maxFontSize: 30 }), { name: 'CupStandTyres' }),
    ...lvRow(724, 360, 284, 44, 'TimeLeft', 'TIME LEFT', 'sessionTimeLeftFmt', AMBER),
    ...lvRow(724, 408, 284, 44, 'Pos', 'POSITION', 'position', AMBER),
    ...lvRow(724, 456, 284, 44, 'Best', 'BEST', 'bestLapFmt', ORANGE),
    bigValue('brakeBiasPct', 16, 514, 178, 74, 'BIAS', AMBER, { maxFontSize: 46 }),
    w('setupstrip', 206, 522, 520, 60, warmStyle({ fields: ['abs', 'tc', 'map', 'bb'], compact: true, accentColor: AMBER, maxFontSize: 26 }), { name: 'CupStandSetup' }),
    bigValue('incidentCount', 740, 514, 124, 74, 'INC', RED, { maxFontSize: 48 }),
    bigValue('position', 874, 514, 134, 74, 'POS', AMBER, { maxFontSize: 48 })
  ]
  return dashboard('GT3 Cup DDU · Standings', 1024, 600, 'Dense GT3 Cup DDU (standings page): live class standings table hero, position gaps mid, big centre gear, lap time + delta, amber championship theme.', elements)
}

// (c-5) GT3 Cup DDU — engine vitals variant: left hero = engine temps + vitals.
// Color theme: RED primary, ORANGE secondary (thermal management).
function createGt3CupDduEnginePreset(): Dashboard {
  const elements: DashboardElement[] = [
    backplate('CupEngineBackplate'),
    denseRevBar(12, 10, 1000, 24, 26),
    w('weather', 206, 40, 184, 44, warmStyle({ title: 'TRACK', accentColor: RED, maxFontSize: 24 }), { name: 'HdrWeather' }),
    card(437, 38, 150, 46, RED, 'SpeedBox'),
    bigValue('speedKmh', 437, 38, 150, 46, 'SPEED', WARM_WHITE, { maxFontSize: 34 }),
    ...lvRow(636, 44, 372, 34, 'HdrLap', 'LAP', 'currentLap', RED),
    hairline(302, 92, 1, 408),
    hairline(716, 92, 1, 408),
    w('temps-elaborate', 14, 96, 282, 250, warmStyle({ accentColor: RED, maxFontSize: 34 }), { name: 'CupEngineHero' }),
    gearHero(322, 92, 380, 210, RED),
    bigValue('rpm', 352, 306, 320, 44, 'RPM', ORANGE, { maxFontSize: 40 }),
    text(724, 96, 284, 24, 'LapTimeLbl', { text: 'LAP TIME', color: RED, fontSize: 18, fontWeight: 900, align: 'left', fontFamily: FONT_COND }),
    bigValue('currentLapFmt', 724, 120, 284, 70, '', WARM_WHITE, { maxFontSize: 56 }),
    w('deltatile', 724, 196, 284, 130, warmStyle({ title: 'DELTA', deltaReference: 'session', deltaRangeSec: 1, accentColor: RED, maxFontSize: 64 }), { binding: 'deltaSec', name: 'CupEngineDelta' }),
    w('fuelstint', 14, 356, 282, 146, warmStyle({ title: 'FUEL / STINT', enduranceMode: true, reserveLaps: 1, warnAtLaps: 2, accentColor: ORANGE, maxFontSize: 48 }), { name: 'CupEngineFuel' }),
    w('tyregrid', 312, 356, 396, 146, warmStyle({ gridMode: 'temp', title: 'TYRE °C', showLabels: true, accentColor: AMBER, maxFontSize: 30 }), { name: 'CupEngineTyres' }),
    ...lvRow(724, 360, 284, 44, 'TimeLeft', 'TIME LEFT', 'sessionTimeLeftFmt', ORANGE),
    ...lvRow(724, 408, 284, 44, 'Pos', 'POSITION', 'position', RED),
    ...lvRow(724, 456, 284, 44, 'Best', 'BEST', 'bestLapFmt', ORANGE),
    bigValue('brakeBiasPct', 16, 514, 178, 74, 'BIAS', RED, { maxFontSize: 46 }),
    w('setupstrip', 206, 522, 520, 60, warmStyle({ fields: ['abs', 'tc', 'map', 'bb'], compact: true, accentColor: RED, maxFontSize: 26 }), { name: 'CupEngineSetup' }),
    bigValue('incidentCount', 740, 514, 124, 74, 'INC', RED, { maxFontSize: 48 }),
    bigValue('position', 874, 514, 134, 74, 'POS', ORANGE, { maxFontSize: 48 })
  ]
  return dashboard('GT3 Cup DDU · Engine', 1024, 600, 'Dense GT3 Cup DDU (engine page): elaborate water/oil/pressure hero, fuel/stint mid, big centre gear, lap time + delta, red thermal management theme.', elements)
}

// (c-6) GT3 Cup DDU — radar variant: left hero = radar + track map stacked.
// Color theme: ORANGE primary, RED danger (spatial awareness).
function createGt3CupDduRadarPreset(): Dashboard {
  const elements: DashboardElement[] = [
    backplate('CupRadarBackplate'),
    denseRevBar(12, 10, 1000, 24, 26),
    w('weather', 206, 40, 184, 44, warmStyle({ title: 'TRACK', accentColor: ORANGE, maxFontSize: 24 }), { name: 'HdrWeather' }),
    card(437, 38, 150, 46, ORANGE, 'SpeedBox'),
    bigValue('speedKmh', 437, 38, 150, 46, 'SPEED', WARM_WHITE, { maxFontSize: 34 }),
    ...lvRow(636, 44, 372, 34, 'HdrLap', 'LAP', 'currentLap', ORANGE),
    hairline(302, 92, 1, 408),
    hairline(716, 92, 1, 408),
    w('radar-elaborate', 14, 96, 282, 128, warmStyle({ accentColor: RED, maxFontSize: 26 }), { name: 'CupRadarHero' }),
    w('trackmap-elaborate', 14, 232, 282, 114, warmStyle({ accentColor: ORANGE, color: MUTED, maxFontSize: 22 }), { binding: 'lapDistPct', name: 'CupRadarTrack' }),
    gearHero(322, 92, 380, 210, ORANGE),
    bigValue('rpm', 352, 306, 320, 44, 'RPM', RED, { maxFontSize: 40 }),
    text(724, 96, 284, 24, 'LapTimeLbl', { text: 'LAP TIME', color: ORANGE, fontSize: 18, fontWeight: 900, align: 'left', fontFamily: FONT_COND }),
    bigValue('currentLapFmt', 724, 120, 284, 70, '', WARM_WHITE, { maxFontSize: 56 }),
    w('deltatile', 724, 196, 284, 130, warmStyle({ title: 'DELTA', deltaReference: 'session', deltaRangeSec: 1, accentColor: RED, maxFontSize: 64 }), { binding: 'deltaSec', name: 'CupRadarDelta' }),
    w('weather', 14, 356, 282, 146, warmStyle({ title: 'TRACK', accentColor: ORANGE, maxFontSize: 30 }), { name: 'CupRadarWeather' }),
    w('tyregrid', 312, 356, 396, 146, warmStyle({ gridMode: 'temp', title: 'TYRE °C', showLabels: true, accentColor: AMBER, maxFontSize: 30 }), { name: 'CupRadarTyres' }),
    ...lvRow(724, 360, 284, 44, 'TimeLeft', 'TIME LEFT', 'sessionTimeLeftFmt', ORANGE),
    ...lvRow(724, 408, 284, 44, 'Pos', 'POSITION', 'position', AMBER),
    ...lvRow(724, 456, 284, 44, 'Best', 'BEST', 'bestLapFmt', ORANGE),
    bigValue('brakeBiasPct', 16, 514, 178, 74, 'BIAS', ORANGE, { maxFontSize: 46 }),
    w('setupstrip', 206, 522, 520, 60, warmStyle({ fields: ['abs', 'tc', 'map', 'bb'], compact: true, accentColor: ORANGE, maxFontSize: 26 }), { name: 'CupRadarSetup' }),
    bigValue('incidentCount', 740, 514, 124, 74, 'INC', RED, { maxFontSize: 48 }),
    bigValue('position', 874, 514, 134, 74, 'POS', AMBER, { maxFontSize: 48 })
  ]
  return dashboard('GT3 Cup DDU · Radar', 1024, 600, 'Dense GT3 Cup DDU (radar page): proximity radar + track map hero, weather/grip mid, big centre gear, lap time + delta, orange spatial-awareness theme.', elements)
}

// (c-7) GT3 Cup DDU — brakes variant: left hero = brake heat grid + corner stack.
// Color theme: RED primary, ORANGE secondary (brake management).
function createGt3CupDduBrakesPreset(): Dashboard {
  const elements: DashboardElement[] = [
    backplate('CupBrakesBackplate'),
    denseRevBar(12, 10, 1000, 24, 26),
    w('weather', 206, 40, 184, 44, warmStyle({ title: 'TRACK', accentColor: RED, maxFontSize: 24 }), { name: 'HdrWeather' }),
    card(437, 38, 150, 46, RED, 'SpeedBox'),
    bigValue('speedKmh', 437, 38, 150, 46, 'SPEED', WARM_WHITE, { maxFontSize: 34 }),
    ...lvRow(636, 44, 372, 34, 'HdrLap', 'LAP', 'currentLap', RED),
    hairline(302, 92, 1, 408),
    hairline(716, 92, 1, 408),
    w('brakegrid', 14, 96, 282, 128, warmStyle({ title: 'BRAKES', showAverage: true, accentColor: RED, maxFontSize: 30 }), { name: 'CupBrakesHero' }),
    w('cornerstack', 14, 232, 282, 114, warmStyle({ targetValue: 165, tolerance: 7, accentColor: ORANGE, maxFontSize: 22 }), { name: 'CupBrakesCorner' }),
    gearHero(322, 92, 380, 210, RED),
    bigValue('rpm', 352, 306, 320, 44, 'RPM', ORANGE, { maxFontSize: 40 }),
    text(724, 96, 284, 24, 'LapTimeLbl', { text: 'LAP TIME', color: RED, fontSize: 18, fontWeight: 900, align: 'left', fontFamily: FONT_COND }),
    bigValue('currentLapFmt', 724, 120, 284, 70, '', WARM_WHITE, { maxFontSize: 56 }),
    w('deltatile', 724, 196, 284, 130, warmStyle({ title: 'DELTA', deltaReference: 'session', deltaRangeSec: 1, accentColor: RED, maxFontSize: 64 }), { binding: 'deltaSec', name: 'CupBrakesDelta' }),
    w('tyregrid', 14, 356, 282, 146, warmStyle({ gridMode: 'pressure', title: 'TYRE PRESS', targetValue: 165, tolerance: 7, showLabels: true, accentColor: AMBER, maxFontSize: 26 }), { name: 'CupBrakesTyres' }),
    w('inputbars', 312, 356, 196, 146, warmStyle({ channels: ['throttle', 'brake'], accentColor: RED, maxFontSize: 26 }), { name: 'CupBrakesInputs' }),
    ...lvRow(724, 360, 284, 44, 'TimeLeft', 'TIME LEFT', 'sessionTimeLeftFmt', RED),
    ...lvRow(724, 408, 284, 44, 'Pos', 'POSITION', 'position', ORANGE),
    ...lvRow(724, 456, 284, 44, 'Best', 'BEST', 'bestLapFmt', RED),
    w('setupstrip', 516, 356, 192, 146, warmStyle({ fields: ['bb', 'abs', 'tc', 'map'], compact: true, accentColor: RED, maxFontSize: 24 }), { name: 'CupBrakesSetup' }),
    bigValue('brakeBiasPct', 16, 514, 178, 74, 'BIAS', RED, { maxFontSize: 46 }),
    w('setupstrip', 206, 522, 520, 60, warmStyle({ fields: ['abs', 'tc', 'map', 'bb'], compact: true, accentColor: RED, maxFontSize: 26 }), { name: 'CupBrakesFooterSetup' }),
    bigValue('incidentCount', 740, 514, 124, 74, 'INC', RED, { maxFontSize: 48 }),
    bigValue('position', 874, 514, 134, 74, 'POS', ORANGE, { maxFontSize: 48 })
  ]
  return dashboard('GT3 Cup DDU · Brakes', 1024, 600, 'Dense GT3 Cup DDU (brakes page): brake heat grid + corner health hero, tyre pressures and input bars mid, big centre gear, lap time + delta, red brake management theme.', elements)
}

// (c) GRID dense DDU — the gold standard for density + correct info (recreates
// screen-dash-1024x576.jpg): per-corner tyre temp/press/wear, fuel+inputs,
// RPM/SPEED + big gear, delta/time stack, CAR AHEAD/BEHIND relatives, and a
// POS/INC/BIAS/TC/ABS/MAP footer.
function createGridDenseDduPreset(): Dashboard {
  const elements: DashboardElement[] = [
    backplate('GridBackplate'),
    denseRevBar(8, 8, 1008, 18, 30),
    ...lvRow(8, 30, 220, 22, 'GridClock', 'TIME', 'sessionTimeLeftFmt', AMBER),
    ...lvRow(248, 30, 210, 22, 'GridAir', 'AIR', 'airTempC', ORANGE, { suffix: '°' }),
    bigValue('sessionType', 828, 28, 188, 24, '', ORANGE, { fontFamily: FONT_COND, align: 'right', maxFontSize: 22 }),
    // Col 1: per-corner tyres (temp/press/wear + brake).
    w('cornerstack', 8, 58, 236, 318, warmStyle({ title: 'TYRES', targetValue: 165, tolerance: 7, accentColor: GREEN, maxFontSize: 30 }), { name: 'GridCorners' }),
    // Col 2: fuel + throttle/brake.
    w('fuelstint', 252, 58, 210, 168, warmStyle({ title: 'FUEL / TEMPS', reserveLaps: 1, warnAtLaps: 2, accentColor: AMBER, maxFontSize: 50 }), { name: 'GridFuel' }),
    ...lvRow(252, 230, 210, 34, 'GridLast', 'LAST', 'lastLapFmt', ORANGE),
    w('inputbars', 252, 270, 210, 106, warmStyle({ channels: ['throttle', 'brake'], accentColor: ORANGE, maxFontSize: 24 }), { name: 'GridInputs' }),
    // Centre: rpm / speed + big gear + small water/oil.
    bigValue('rpm', 470, 58, 82, 46, 'RPM', ORANGE, { maxFontSize: 34 }),
    bigValue('speedKmh', 558, 58, 82, 46, 'SPD', WARM_WHITE, { maxFontSize: 34 }),
    gearHero(470, 110, 170, 222, WARM_WHITE),
    ...lvRow(470, 342, 170, 32, 'GridWater', 'WTR', 'waterTempC', MUTED, { suffix: '°' }),
    // Col 4: delta + time stack.
    card(648, 58, 172, 318, ORANGE, 'GridDeltaCard'),
    cardTitle(648, 62, 172, 'GridDeltaTitle', 'DELTA / TIME', ORANGE, 14),
    w('deltatile', 652, 82, 164, 104, warmStyle({ title: '', deltaReference: 'session', deltaRangeSec: 1, accentColor: RED, maxFontSize: 56 }), { binding: 'deltaSec', name: 'GridDelta' }),
    ...lvRow(656, 192, 156, 34, 'GridBest', 'BEST', 'bestLapFmt', ORANGE),
    ...lvRow(656, 230, 156, 34, 'GridCur', 'CUR', 'currentLapFmt', AMBER),
    ...lvRow(656, 268, 156, 34, 'GridLaps', 'LAPS', 'lapsRemaining', ORANGE),
    ...lvRow(656, 306, 156, 34, 'GridRem', 'REM', 'sessionTimeLeftFmt', AMBER),
    // Col 5: CAR AHEAD / CAR BEHIND.
    w('relatives-elaborate', 826, 58, 190, 318, warmStyle({ accentColor: AMBER, reference: 'AHEAD / BEHIND', maxFontSize: 30 }), { name: 'GridRelatives' }),
    // Footer chips.
    w('positiongaps', 8, 384, 168, 80, warmStyle({ showTotal: true, accentColor: AMBER, maxFontSize: 46 }), { name: 'GridPos' }),
    bigValue('incidentCount', 184, 384, 120, 80, 'INC', RED, { maxFontSize: 48 }),
    bigValue('brakeBiasPct', 312, 384, 156, 80, 'BRAKE BIAS', AMBER, { maxFontSize: 46 }),
    w('setupstrip', 476, 392, 408, 66, warmStyle({ fields: ['tc', 'abs', 'map', 'bb'], compact: true, accentColor: ORANGE, maxFontSize: 26 }), { name: 'GridSetup' }),
    w('weather', 892, 384, 124, 80, warmStyle({ title: 'TRACK', accentColor: AMBER, maxFontSize: 24 }), { name: 'GridWeather' })
  ]
  return dashboard('GRID Dense DDU', 1024, 600, 'Gold-standard dense DDU recreation: per-corner tyre temp/press/wear, fuel + throttle/brake, RPM/SPEED with a big gear, predictive delta and a full time stack, the relative car ahead and behind with gaps, and a position/incidents/bias/TC/ABS/MAP footer. Water/oil are intentionally tiny.', elements)
}

// (d) ACC-style full (recreates maxresdefault.jpg): top RPM LED bar, 4 tyre
// graphics with temps+pressures, centre digital gear + KM/H, LAP GAIN/LOSS delta,
// TIME/BEST/LAST, gap/delta sector chips, and a setup + fuel footer.
function createAccStyleFullPreset(): Dashboard {
  const elements: DashboardElement[] = [
    backplate('AccFullBackplate'),
    denseRevBar(8, 8, 1008, 26, 32),
    text(10, 38, 140, 22, 'AccDrsL', { text: 'DRS', color: MUTED, fontSize: 18, fontWeight: 900, align: 'left', fontFamily: FONT_COND }),
    text(874, 38, 140, 22, 'AccDrsR', { text: 'DRS', color: MUTED, fontSize: 18, fontWeight: 900, align: 'right', fontFamily: FONT_COND }),
    // Left: 4 tyre graphics (temps + pressures).
    w('tyres-elaborate', 8, 64, 360, 356, warmStyle({ accentColor: ORANGE, maxFontSize: 40 }), { name: 'AccFullTyres' }),
    // Centre: digital gear + km/h.
    card(384, 64, 172, 356, ORANGE, 'AccFullGearCard'),
    text(384, 70, 172, 22, 'AccFullGearLbl', { text: 'GEAR', color: ORANGE, fontSize: 16, fontWeight: 900, align: 'center', fontFamily: FONT_COND }),
    gearHero(388, 92, 164, 196, WARM_WHITE),
    bigValue('speedKmh', 388, 300, 164, 110, 'KM/H', WARM_WHITE, { maxFontSize: 78 }),
    // Right: lap gain/loss + time stack + gap chips.
    w('deltatile', 566, 64, 450, 96, warmStyle({ title: 'LAP GAIN / LOSS', deltaReference: 'session', deltaRangeSec: 1, accentColor: RED, maxFontSize: 70 }), { binding: 'deltaSec', name: 'AccFullDelta' }),
    w('laptiming', 566, 170, 450, 158, warmStyle({ title: 'TIME / BEST / LAST', showCurrent: true, showLast: true, showBest: true, accentColor: AMBER, maxFontSize: 44 }), { name: 'AccFullTiming' }),
    bigValue('deltaSec', 566, 338, 144, 80, 'DELTA', WARM_WHITE, { maxFontSize: 46 }),
    bigValue('gapAheadFmt', 718, 338, 146, 80, 'AHEAD', AMBER, { maxFontSize: 40 }),
    bigValue('gapBehindFmt', 872, 338, 144, 80, 'BEHIND', ORANGE, { maxFontSize: 40 }),
    // Footer row 1: setup + small engine + weather.
    w('setupstrip', 8, 436, 632, 66, warmStyle({ fields: ['bb', 'abs', 'tc', 'map', 'limiter'], compact: true, accentColor: ORANGE, maxFontSize: 26 }), { name: 'AccFullSetup' }),
    w('temps-clean', 648, 436, 184, 66, warmStyle({ accentColor: MUTED, reference: '', maxFontSize: 26 }), { name: 'AccFullEngine' }),
    w('weather', 840, 436, 176, 66, warmStyle({ title: 'TRACK', accentColor: AMBER, maxFontSize: 24 }), { name: 'AccFullWeather' }),
    // Footer row 2: fuel + position + incidents + relatives.
    bigValue('fuelLitersStr', 8, 510, 150, 80, 'LITERS', AMBER, { suffix: 'L', maxFontSize: 48 }),
    bigValue('fuelPerLapStr', 168, 510, 150, 80, 'AVG', AMBER, { maxFontSize: 48 }),
    bigValue('fuelLapsLeftStr', 328, 510, 150, 80, 'F.REM.L', AMBER, { maxFontSize: 48 }),
    w('positiongaps', 488, 510, 150, 80, warmStyle({ showTotal: true, accentColor: AMBER, maxFontSize: 46 }), { name: 'AccFullPos' }),
    bigValue('incidentCount', 648, 510, 110, 80, 'INC', RED, { maxFontSize: 48 }),
    w('relatives-clean', 768, 508, 248, 82, warmStyle({ accentColor: AMBER, maxFontSize: 26 }), { name: 'AccFullRelatives' })
  ]
  return dashboard('ACC Style Full', 1024, 600, 'ACC-style full recreation: top RPM LED bar with DRS tells, four tyre graphics (temps + pressures), centre digital gear + KM/H, lap gain/loss delta, time/best/last stack, delta + gap-ahead/behind chips, and a setup + fuel/position/incidents/relatives footer.', elements)
}

// (e) ACC default (recreates c7b9b766…png): status strip + centre delta bar, big
// gear + rpm bar, 4-corner tyres, RACE/POS/LAP, lap times predicted/last/best,
// fuel L/AVG/LAPS, relatives, and a TC/ABS/BB/MAP/limiter footer.
function createAccDefaultPreset(): Dashboard {
  const elements: DashboardElement[] = [
    backplate('AccDefBackplate'),
    w('flagoverlay', 8, 12, 360, 46, warmStyle({ compact: true, includeIncidents: true, accentColor: AMBER, maxFontSize: 30 }), { name: 'AccDefStatus' }),
    // Centre: delta bar + gear + rpm bar.
    w('deltabar', 388, 16, 224, 26, warmStyle({ background: '#000000', fillColor: AMBER, dangerColor: RED, deltaRangeSec: 1, radius: 999 }), { binding: 'deltaSec', name: 'AccDefDeltaBar' }),
    gearHero(384, 56, 232, 232, WARM_WHITE),
    w('shiftbar', 388, 300, 224, 18, warmStyle({ segments: 22, flashAt: 0.97, warnAt: 0.55, dangerAt: 0.8, glow: true, segmentShape: 'led', fillColor: GREEN, warnColor: AMBER, dangerColor: RED, radius: 2 }), { binding: 'shiftPct', name: 'AccDefRpmBar' }),
    bigValue('rpm', 384, 322, 232, 40, 'RPM', ORANGE, { maxFontSize: 34 }),
    // Left: four-corner tyres.
    w('tyres-elaborate', 8, 70, 360, 300, warmStyle({ accentColor: ORANGE, maxFontSize: 40 }), { name: 'AccDefTyres' }),
    // Right top: race / pos / lap.
    bigValue('sessionTimeLeftFmt', 632, 12, 130, 72, 'RACE', WARM_WHITE, { maxFontSize: 40 }),
    bigValue('position', 770, 12, 110, 72, 'POS', AMBER, { maxFontSize: 48 }),
    bigValue('currentLap', 888, 12, 128, 72, 'LAP', ORANGE, { maxFontSize: 48 }),
    // Right: lap times stack.
    w('laptiming', 632, 92, 384, 170, warmStyle({ title: 'LAP TIMES', showCurrent: true, showLast: true, showBest: true, accentColor: AMBER, maxFontSize: 46 }), { name: 'AccDefTiming' }),
    // Right: fuel.
    bigValue('fuelLitersStr', 632, 272, 124, 92, 'LITRES', AMBER, { suffix: 'L', maxFontSize: 50 }),
    bigValue('fuelPerLapStr', 762, 272, 124, 92, 'AVG', AMBER, { maxFontSize: 50 }),
    bigValue('fuelLapsLeftStr', 892, 272, 124, 92, 'LAPS', AMBER, { maxFontSize: 50 }),
    // Mid: relatives + position gaps + incidents.
    w('relatives-elaborate', 8, 384, 520, 110, warmStyle({ accentColor: AMBER, maxFontSize: 32 }), { name: 'AccDefRelatives' }),
    w('positiongaps', 540, 384, 220, 110, warmStyle({ showTotal: true, accentColor: AMBER, maxFontSize: 56 }), { name: 'AccDefPos' }),
    bigValue('incidentCount', 772, 384, 116, 110, 'INC', RED, { maxFontSize: 56 }),
    w('weather', 900, 384, 116, 110, warmStyle({ title: 'TRACK', accentColor: AMBER, maxFontSize: 24 }), { name: 'AccDefWeather' }),
    // Footer: TC / ABS / BB / MAP / limiter.
    w('setupstrip', 8, 506, 1008, 84, warmStyle({ fields: ['tc', 'abs', 'bb', 'map', 'limiter'], compact: true, accentColor: ORANGE, maxFontSize: 34 }), { name: 'AccDefSetup' })
  ]
  return dashboard('ACC Default', 1024, 600, 'ACC default recreation: status/flag strip, centre delta bar over a big gear + rpm bar, four-corner tyres, RACE/POS/LAP, predicted/last/best lap times, fuel litres/avg/laps, relative car ahead/behind with gaps, incidents and a TC/ABS/BB/MAP/limiter footer.', elements)
}

// (f) Compact HUD (recreates image-3.png as a full-canvas variant): a circular
// gear+rpm cluster, big KPH / RPM / POS readouts, delta + lap stack and a wide
// weather strip — the rounded minimal HUD scaled to fill 1024×600.
function createCompactHudPreset(): Dashboard {
  const elements: DashboardElement[] = [
    backplate('HudBackplate'),
    denseRevBar(40, 22, 944, 24, 28),
    w('gearcluster', 40, 70, 360, 384, warmStyle({ radius: 24, accentColor: ORANGE, showRpm: true, flashAt: 0.97, dangerAt: 0.8, unit: 'kmh' }), { name: 'HudGearCluster' }),
    bigValue('speedKmh', 420, 70, 280, 152, 'KPH', WARM_WHITE, { maxFontSize: 120 }),
    bigValue('rpm', 420, 234, 280, 108, 'RPM', ORANGE, { maxFontSize: 80 }),
    bigValue('position', 720, 70, 264, 152, 'POS', AMBER, { maxFontSize: 110 }),
    w('deltatile', 720, 234, 264, 108, warmStyle({ title: 'DELTA', deltaReference: 'session', deltaRangeSec: 1, accentColor: RED, maxFontSize: 64 }), { binding: 'deltaSec', name: 'HudDelta' }),
    w('laptiming', 420, 354, 564, 96, warmStyle({ title: 'LAP / LAST / BEST', showCurrent: true, showLast: true, showBest: true, accentColor: AMBER, maxFontSize: 38 }), { name: 'HudTiming' }),
    w('weather', 40, 466, 944, 110, warmStyle({ title: 'TRACK', accentColor: AMBER, maxFontSize: 34 }), { name: 'HudWeather' })
  ]
  return dashboard('Compact HUD', 1024, 600, 'Compact rounded HUD recreation scaled to fill the canvas: a circular gear + rpm cluster, oversized KPH / RPM / position readouts, predictive delta, a lap/last/best stack and a wide track/weather strip.', elements)
}

// ─── 20 colour-variant presets ────────────────────────────────────────────────
// All 1024×600, dark bg, warm accent colours only.
// Every preset contains: shiftbar, gear, speed, incidentCount, position, relatives.

// 1. Crimson – tyres-elaborate hero, tyre-pressure + cornerstack mid
function createNpCrimsonTyresPreset(): Dashboard {
  const A = CRIMSON, A2 = ROSE_W
  const elements: DashboardElement[] = [
    backplate('CrimsonBP'),
    denseRevBar(12, 10, 1000, 24, 26),
    w('weather', 206, 40, 184, 44, warmStyle({ title: 'TRACK', accentColor: A, maxFontSize: 24 }), { name: 'HdrWeather' }),
    card(437, 38, 150, 46, A, 'SpeedBox'),
    bigValue('speedKmh', 437, 38, 150, 46, 'SPEED', WARM_WHITE, { maxFontSize: 34 }),
    ...lvRow(636, 44, 372, 34, 'HdrLap', 'LAP', 'currentLap', A),
    hairline(302, 92, 1, 408), hairline(716, 92, 1, 408),
    w('tyres-elaborate', 14, 96, 282, 250, warmStyle({ accentColor: A, coldAt: 72, optimalAt: 88, hotAt: 104, criticalAt: 118, maxFontSize: 32 }), { name: 'CrimsonTyresHero' }),
    gearHero(322, 92, 380, 210, A),
    bigValue('rpm', 352, 306, 320, 44, 'RPM', A2, { maxFontSize: 40 }),
    text(724, 96, 284, 24, 'LTLbl', { text: 'LAP TIME', color: A, fontSize: 18, fontWeight: 900, align: 'left', fontFamily: FONT_COND }),
    bigValue('currentLapFmt', 724, 120, 284, 70, '', WARM_WHITE, { maxFontSize: 56 }),
    w('deltatile', 724, 196, 284, 130, warmStyle({ title: 'DELTA', deltaReference: 'session', deltaRangeSec: 1, accentColor: RED, maxFontSize: 64 }), { binding: 'deltaSec', name: 'CrimsonDelta' }),
    w('relatives-elaborate', 14, 356, 282, 146, warmStyle({ accentColor: AMBER, maxFontSize: 32 }), { name: 'CrimsonRelatives' }),
    w('tyregrid', 312, 356, 196, 146, warmStyle({ gridMode: 'pressure', title: 'TYRE PRESS', targetValue: 165, tolerance: 7, showLabels: true, accentColor: A, maxFontSize: 26 }), { name: 'CrimsonPress' }),
    w('cornerstack', 516, 356, 192, 146, warmStyle({ targetValue: 165, tolerance: 7, accentColor: A2, maxFontSize: 22 }), { name: 'CrimsonCorners' }),
    ...lvRow(724, 360, 284, 44, 'TLeft', 'TIME LEFT', 'sessionTimeLeftFmt', A),
    ...lvRow(724, 408, 284, 44, 'Pos', 'POSITION', 'position', A),
    ...lvRow(724, 456, 284, 44, 'Best', 'BEST', 'bestLapFmt', A),
    bigValue('brakeBiasPct', 16, 514, 178, 74, 'BIAS', A, { maxFontSize: 46 }),
    w('setupstrip', 206, 522, 520, 60, warmStyle({ fields: ['abs', 'tc', 'map', 'bb'], compact: true, accentColor: A, maxFontSize: 26 }), { name: 'CrimsonSetup' }),
    bigValue('incidentCount', 740, 514, 124, 74, 'INC', RED, { maxFontSize: 48 }),
    bigValue('position', 874, 514, 134, 74, 'POS', A, { maxFontSize: 48 })
  ]
  return dashboard('NP Crimson · Tyres', 1024, 600, 'Crimson DDU: tyre-temp hero, tyre-pressure + corner-health mid, big gear, lap time + delta. Warm crimson/rose theme.', elements)
}

// 2. Scarlet – radar hero, position-gaps + brake temps mid
function createNpScarletRelativesPreset(): Dashboard {
  const A = CHERRY_W, A2 = MAROON_W
  const elements: DashboardElement[] = [
    backplate('ScarletBP'),
    denseRevBar(12, 10, 1000, 24, 26),
    w('weather', 206, 40, 184, 44, warmStyle({ title: 'TRACK', accentColor: A, maxFontSize: 24 }), { name: 'HdrWeather' }),
    card(437, 38, 150, 46, A, 'SpeedBox'),
    bigValue('speedKmh', 437, 38, 150, 46, 'SPEED', WARM_WHITE, { maxFontSize: 34 }),
    ...lvRow(636, 44, 372, 34, 'HdrLap', 'LAP', 'currentLap', A),
    hairline(302, 92, 1, 408), hairline(716, 92, 1, 408),
    w('radar-elaborate', 14, 96, 282, 250, warmStyle({ accentColor: A, maxFontSize: 26 }), { name: 'ScarletRadarHero' }),
    gearHero(322, 92, 380, 210, A),
    bigValue('rpm', 352, 306, 320, 44, 'RPM', A2, { maxFontSize: 40 }),
    text(724, 96, 284, 24, 'LTLbl', { text: 'LAP TIME', color: A, fontSize: 18, fontWeight: 900, align: 'left', fontFamily: FONT_COND }),
    bigValue('currentLapFmt', 724, 120, 284, 70, '', WARM_WHITE, { maxFontSize: 56 }),
    w('deltatile', 724, 196, 284, 130, warmStyle({ title: 'DELTA', deltaReference: 'session', deltaRangeSec: 1, accentColor: RED, maxFontSize: 64 }), { binding: 'deltaSec', name: 'ScarletDelta' }),
    w('relatives-elaborate', 14, 356, 282, 146, warmStyle({ accentColor: AMBER, maxFontSize: 32 }), { name: 'ScarletRelatives' }),
    w('positiongaps', 312, 356, 196, 146, warmStyle({ showTotal: true, accentColor: A, minFontSize: 20, maxFontSize: 52 }), { name: 'ScarletPosGaps' }),
    w('brakegrid', 516, 356, 192, 146, warmStyle({ title: 'BRAKES', showAverage: true, accentColor: A2, maxFontSize: 28 }), { name: 'ScarletBrakes' }),
    ...lvRow(724, 360, 284, 44, 'TLeft', 'TIME LEFT', 'sessionTimeLeftFmt', A),
    ...lvRow(724, 408, 284, 44, 'Pos', 'POSITION', 'position', A),
    ...lvRow(724, 456, 284, 44, 'Best', 'BEST', 'bestLapFmt', A),
    bigValue('brakeBiasPct', 16, 514, 178, 74, 'BIAS', A, { maxFontSize: 46 }),
    w('setupstrip', 206, 522, 520, 60, warmStyle({ fields: ['abs', 'tc', 'map', 'bb'], compact: true, accentColor: A, maxFontSize: 26 }), { name: 'ScarletSetup' }),
    bigValue('incidentCount', 740, 514, 124, 74, 'INC', RED, { maxFontSize: 48 }),
    bigValue('position', 874, 514, 134, 74, 'POS', A, { maxFontSize: 48 })
  ]
  return dashboard('NP Scarlet · Radar', 1024, 600, 'Scarlet cherry DDU: proximity-radar hero, position-gaps + brake temps mid, big gear, delta. Traffic-awareness focus.', elements)
}

// 3. Vermilion – brakegrid hero, tyre-temp + cornerstack mid
function createNpVermilionBrakesPreset(): Dashboard {
  const A = VERML, A2 = BRICK_W
  const elements: DashboardElement[] = [
    backplate('VermilionBP'),
    denseRevBar(12, 10, 1000, 24, 26),
    w('weather', 206, 40, 184, 44, warmStyle({ title: 'TRACK', accentColor: A, maxFontSize: 24 }), { name: 'HdrWeather' }),
    card(437, 38, 150, 46, A, 'SpeedBox'),
    bigValue('speedKmh', 437, 38, 150, 46, 'SPEED', WARM_WHITE, { maxFontSize: 34 }),
    ...lvRow(636, 44, 372, 34, 'HdrLap', 'LAP', 'currentLap', A),
    hairline(302, 92, 1, 408), hairline(716, 92, 1, 408),
    w('brakegrid', 14, 96, 282, 250, warmStyle({ title: 'BRAKES', showAverage: true, accentColor: A, maxFontSize: 36 }), { name: 'VermBrakeHero' }),
    gearHero(322, 92, 380, 210, A),
    bigValue('rpm', 352, 306, 320, 44, 'RPM', A2, { maxFontSize: 40 }),
    text(724, 96, 284, 24, 'LTLbl', { text: 'LAP TIME', color: A, fontSize: 18, fontWeight: 900, align: 'left', fontFamily: FONT_COND }),
    bigValue('currentLapFmt', 724, 120, 284, 70, '', WARM_WHITE, { maxFontSize: 56 }),
    w('deltatile', 724, 196, 284, 130, warmStyle({ title: 'DELTA', deltaReference: 'session', deltaRangeSec: 1, accentColor: RED, maxFontSize: 64 }), { binding: 'deltaSec', name: 'VermDelta' }),
    w('relatives-elaborate', 14, 356, 282, 146, warmStyle({ accentColor: AMBER, maxFontSize: 32 }), { name: 'VermRelatives' }),
    w('tyregrid', 312, 356, 196, 146, warmStyle({ gridMode: 'temp', title: 'TYRE °C', showLabels: true, accentColor: AMBER, maxFontSize: 26 }), { name: 'VermTyreTemp' }),
    w('cornerstack', 516, 356, 192, 146, warmStyle({ targetValue: 165, tolerance: 7, accentColor: A2, maxFontSize: 22 }), { name: 'VermCorners' }),
    ...lvRow(724, 360, 284, 44, 'TLeft', 'TIME LEFT', 'sessionTimeLeftFmt', A),
    ...lvRow(724, 408, 284, 44, 'Pos', 'POSITION', 'position', A),
    ...lvRow(724, 456, 284, 44, 'Best', 'BEST', 'bestLapFmt', A),
    bigValue('brakeBiasPct', 16, 514, 178, 74, 'BIAS', A, { maxFontSize: 46 }),
    w('setupstrip', 206, 522, 520, 60, warmStyle({ fields: ['abs', 'tc', 'map', 'bb'], compact: true, accentColor: A, maxFontSize: 26 }), { name: 'VermSetup' }),
    bigValue('incidentCount', 740, 514, 124, 74, 'INC', RED, { maxFontSize: 48 }),
    bigValue('position', 874, 514, 134, 74, 'POS', A, { maxFontSize: 48 })
  ]
  return dashboard('NP Vermilion · Brakes', 1024, 600, 'Vermilion DDU: full brake-temp hero, tyre temps + corner health mid, big gear, delta. Brake-management focus.', elements)
}

// 4. Tangerine – delta-elaborate hero, position-gaps + setup tower mid
function createNpTangerineDeltaPreset(): Dashboard {
  const A = TANGER, A2 = GOLD_W
  const elements: DashboardElement[] = [
    backplate('TangerineBP'),
    denseRevBar(12, 10, 1000, 24, 26),
    w('weather', 206, 40, 184, 44, warmStyle({ title: 'TRACK', accentColor: A, maxFontSize: 24 }), { name: 'HdrWeather' }),
    card(437, 38, 150, 46, A, 'SpeedBox'),
    bigValue('speedKmh', 437, 38, 150, 46, 'SPEED', WARM_WHITE, { maxFontSize: 34 }),
    ...lvRow(636, 44, 372, 34, 'HdrLap', 'LAP', 'currentLap', A),
    hairline(302, 92, 1, 408), hairline(716, 92, 1, 408),
    w('delta-elaborate', 14, 96, 282, 250, warmStyle({ title: 'DELTA', deltaReference: 'session', deltaRangeSec: 0.8, accentColor: GREEN, maxFontSize: 84 }), { binding: 'deltaSec', name: 'TangDeltaHero' }),
    gearHero(322, 92, 380, 210, A),
    bigValue('rpm', 352, 306, 320, 44, 'RPM', A2, { maxFontSize: 40 }),
    text(724, 96, 284, 24, 'LTLbl', { text: 'LAP TIME', color: A, fontSize: 18, fontWeight: 900, align: 'left', fontFamily: FONT_COND }),
    bigValue('currentLapFmt', 724, 120, 284, 70, '', WARM_WHITE, { maxFontSize: 56 }),
    w('deltatile', 724, 196, 284, 130, warmStyle({ title: 'DELTA', deltaReference: 'session', deltaRangeSec: 1, accentColor: RED, maxFontSize: 64 }), { binding: 'deltaSec', name: 'TangDeltaTile' }),
    w('relatives-elaborate', 14, 356, 282, 146, warmStyle({ accentColor: AMBER, maxFontSize: 32 }), { name: 'TangRelatives' }),
    w('positiongaps', 312, 356, 196, 146, warmStyle({ showTotal: true, accentColor: A, minFontSize: 20, maxFontSize: 52 }), { name: 'TangPosGaps' }),
    w('setupstrip', 516, 356, 192, 146, warmStyle({ title: 'SETUP', fields: ['abs', 'tc', 'map', 'bb', 'limiter'], compact: true, accentColor: A2, maxFontSize: 28 }), { name: 'TangSetupStack' }),
    ...lvRow(724, 360, 284, 44, 'TLeft', 'TIME LEFT', 'sessionTimeLeftFmt', A),
    ...lvRow(724, 408, 284, 44, 'Pos', 'POSITION', 'position', A),
    ...lvRow(724, 456, 284, 44, 'Best', 'BEST', 'bestLapFmt', A),
    bigValue('brakeBiasPct', 16, 514, 178, 74, 'BIAS', A, { maxFontSize: 46 }),
    w('setupstrip', 206, 522, 520, 60, warmStyle({ fields: ['abs', 'tc', 'map', 'bb'], compact: true, accentColor: A, maxFontSize: 26 }), { name: 'TangSetup' }),
    bigValue('incidentCount', 740, 514, 124, 74, 'INC', RED, { maxFontSize: 48 }),
    bigValue('position', 874, 514, 134, 74, 'POS', A, { maxFontSize: 48 })
  ]
  return dashboard('NP Tangerine · Delta', 1024, 600, 'Tangerine DDU: big live-delta hero, relatives + position-gaps + setup mid, big gear. Delta-attack focus.', elements)
}

// 5. Gold – fuelstint hero, tyre-temp + brakegrid mid
function createNpGoldFuelPreset(): Dashboard {
  const A = GOLD_W, A2 = DKAMBER
  const elements: DashboardElement[] = [
    backplate('GoldFuelBP'),
    denseRevBar(12, 10, 1000, 24, 26),
    w('weather', 206, 40, 184, 44, warmStyle({ title: 'TRACK', accentColor: A, maxFontSize: 24 }), { name: 'HdrWeather' }),
    card(437, 38, 150, 46, A, 'SpeedBox'),
    bigValue('speedKmh', 437, 38, 150, 46, 'SPEED', WARM_WHITE, { maxFontSize: 34 }),
    ...lvRow(636, 44, 372, 34, 'HdrLap', 'LAP', 'currentLap', A),
    hairline(302, 92, 1, 408), hairline(716, 92, 1, 408),
    w('fuelstint', 14, 96, 282, 250, warmStyle({ title: 'FUEL / STINT', reserveLaps: 1, warnAtLaps: 2, accentColor: A, maxFontSize: 52 }), { name: 'GoldFuelHero' }),
    gearHero(322, 92, 380, 210, A),
    bigValue('rpm', 352, 306, 320, 44, 'RPM', A2, { maxFontSize: 40 }),
    text(724, 96, 284, 24, 'LTLbl', { text: 'LAP TIME', color: A, fontSize: 18, fontWeight: 900, align: 'left', fontFamily: FONT_COND }),
    bigValue('currentLapFmt', 724, 120, 284, 70, '', WARM_WHITE, { maxFontSize: 56 }),
    w('deltatile', 724, 196, 284, 130, warmStyle({ title: 'DELTA', deltaReference: 'session', deltaRangeSec: 1, accentColor: RED, maxFontSize: 64 }), { binding: 'deltaSec', name: 'GoldDelta' }),
    w('relatives-elaborate', 14, 356, 282, 146, warmStyle({ accentColor: AMBER, maxFontSize: 32 }), { name: 'GoldRelatives' }),
    w('tyregrid', 312, 356, 196, 146, warmStyle({ gridMode: 'temp', title: 'TYRE °C', showLabels: true, accentColor: A, maxFontSize: 26 }), { name: 'GoldTyreTemp' }),
    w('brakegrid', 516, 356, 192, 146, warmStyle({ title: 'BRAKES', showAverage: true, accentColor: A2, maxFontSize: 28 }), { name: 'GoldBrakes' }),
    ...lvRow(724, 360, 284, 44, 'TLeft', 'TIME LEFT', 'sessionTimeLeftFmt', A),
    ...lvRow(724, 408, 284, 44, 'Pos', 'POSITION', 'position', A),
    ...lvRow(724, 456, 284, 44, 'Best', 'BEST', 'bestLapFmt', A),
    bigValue('brakeBiasPct', 16, 514, 178, 74, 'BIAS', A, { maxFontSize: 46 }),
    w('setupstrip', 206, 522, 520, 60, warmStyle({ fields: ['abs', 'tc', 'map', 'bb'], compact: true, accentColor: A, maxFontSize: 26 }), { name: 'GoldSetup' }),
    bigValue('incidentCount', 740, 514, 124, 74, 'INC', RED, { maxFontSize: 48 }),
    bigValue('position', 874, 514, 134, 74, 'POS', A, { maxFontSize: 48 })
  ]
  return dashboard('NP Gold · Fuel', 1024, 600, 'Gold DDU: fuel/stint hero, tyre temps + brake temps mid, big gear, lap time + delta. Fuel-management focus.', elements)
}

// 6. Rose – inputtrace hero, inputbars + tyre-temp mid
function createNpRoseInputsPreset(): Dashboard {
  const A = ROSE_W, A2 = CORAL_W
  const elements: DashboardElement[] = [
    backplate('RoseBP'),
    denseRevBar(12, 10, 1000, 24, 26),
    w('weather', 206, 40, 184, 44, warmStyle({ title: 'TRACK', accentColor: A, maxFontSize: 24 }), { name: 'HdrWeather' }),
    card(437, 38, 150, 46, A, 'SpeedBox'),
    bigValue('speedKmh', 437, 38, 150, 46, 'SPEED', WARM_WHITE, { maxFontSize: 34 }),
    ...lvRow(636, 44, 372, 34, 'HdrLap', 'LAP', 'currentLap', A),
    hairline(302, 92, 1, 408), hairline(716, 92, 1, 408),
    w('inputtrace', 14, 96, 282, 250, warmStyle({ title: 'INPUTS', channels: ['throttle', 'brake'], traceLength: 200, accentColor: A, maxFontSize: 28 }), { name: 'RoseInputHero' }),
    gearHero(322, 92, 380, 210, A),
    bigValue('rpm', 352, 306, 320, 44, 'RPM', A2, { maxFontSize: 40 }),
    text(724, 96, 284, 24, 'LTLbl', { text: 'LAP TIME', color: A, fontSize: 18, fontWeight: 900, align: 'left', fontFamily: FONT_COND }),
    bigValue('currentLapFmt', 724, 120, 284, 70, '', WARM_WHITE, { maxFontSize: 56 }),
    w('deltatile', 724, 196, 284, 130, warmStyle({ title: 'DELTA', deltaReference: 'session', deltaRangeSec: 1, accentColor: RED, maxFontSize: 64 }), { binding: 'deltaSec', name: 'RoseDelta' }),
    w('relatives-elaborate', 14, 356, 282, 146, warmStyle({ accentColor: AMBER, maxFontSize: 32 }), { name: 'RoseRelatives' }),
    w('inputbars', 312, 356, 196, 146, warmStyle({ title: 'PEDALS', channels: ['throttle', 'brake'], accentColor: A, maxFontSize: 28 }), { name: 'RoseInputBars' }),
    w('tyregrid', 516, 356, 192, 146, warmStyle({ gridMode: 'temp', title: 'TYRE °C', showLabels: true, accentColor: A2, maxFontSize: 24 }), { name: 'RoseTyreTemp' }),
    ...lvRow(724, 360, 284, 44, 'TLeft', 'TIME LEFT', 'sessionTimeLeftFmt', A),
    ...lvRow(724, 408, 284, 44, 'Pos', 'POSITION', 'position', A),
    ...lvRow(724, 456, 284, 44, 'Best', 'BEST', 'bestLapFmt', A),
    bigValue('brakeBiasPct', 16, 514, 178, 74, 'BIAS', A, { maxFontSize: 46 }),
    w('setupstrip', 206, 522, 520, 60, warmStyle({ fields: ['abs', 'tc', 'map', 'bb'], compact: true, accentColor: A, maxFontSize: 26 }), { name: 'RoseSetup' }),
    bigValue('incidentCount', 740, 514, 124, 74, 'INC', RED, { maxFontSize: 48 }),
    bigValue('position', 874, 514, 134, 74, 'POS', A, { maxFontSize: 48 })
  ]
  return dashboard('NP Rose · Inputs', 1024, 600, 'Rose DDU: input-trace hero, live pedal bars + tyre temps mid, big gear, delta. Driving-style focus.', elements)
}

// 7. Rust – standings hero, position-gaps + tyre-temp mid
function createNpRustStandingsPreset(): Dashboard {
  const A = RUST_W, A2 = COPPER_W
  const elements: DashboardElement[] = [
    backplate('RustBP'),
    denseRevBar(12, 10, 1000, 24, 26),
    w('weather', 206, 40, 184, 44, warmStyle({ title: 'TRACK', accentColor: A, maxFontSize: 24 }), { name: 'HdrWeather' }),
    card(437, 38, 150, 46, A, 'SpeedBox'),
    bigValue('speedKmh', 437, 38, 150, 46, 'SPEED', WARM_WHITE, { maxFontSize: 34 }),
    ...lvRow(636, 44, 372, 34, 'HdrLap', 'LAP', 'currentLap', A),
    hairline(302, 92, 1, 408), hairline(716, 92, 1, 408),
    w('standings', 14, 96, 282, 250, warmStyle({ accentColor: A, maxFontSize: 22 }), { name: 'RustStandingsHero' }),
    gearHero(322, 92, 380, 210, A),
    bigValue('rpm', 352, 306, 320, 44, 'RPM', A2, { maxFontSize: 40 }),
    text(724, 96, 284, 24, 'LTLbl', { text: 'LAP TIME', color: A, fontSize: 18, fontWeight: 900, align: 'left', fontFamily: FONT_COND }),
    bigValue('currentLapFmt', 724, 120, 284, 70, '', WARM_WHITE, { maxFontSize: 56 }),
    w('deltatile', 724, 196, 284, 130, warmStyle({ title: 'DELTA', deltaReference: 'session', deltaRangeSec: 1, accentColor: RED, maxFontSize: 64 }), { binding: 'deltaSec', name: 'RustDelta' }),
    w('relatives-elaborate', 14, 356, 282, 146, warmStyle({ accentColor: AMBER, maxFontSize: 32 }), { name: 'RustRelatives' }),
    w('positiongaps', 312, 356, 196, 146, warmStyle({ showTotal: true, accentColor: A, minFontSize: 20, maxFontSize: 52 }), { name: 'RustPosGaps' }),
    w('tyregrid', 516, 356, 192, 146, warmStyle({ gridMode: 'temp', title: 'TYRE °C', showLabels: true, accentColor: A2, maxFontSize: 24 }), { name: 'RustTyre' }),
    ...lvRow(724, 360, 284, 44, 'TLeft', 'TIME LEFT', 'sessionTimeLeftFmt', A),
    ...lvRow(724, 408, 284, 44, 'Pos', 'POSITION', 'position', A),
    ...lvRow(724, 456, 284, 44, 'Best', 'BEST', 'bestLapFmt', A),
    bigValue('brakeBiasPct', 16, 514, 178, 74, 'BIAS', A, { maxFontSize: 46 }),
    w('setupstrip', 206, 522, 520, 60, warmStyle({ fields: ['abs', 'tc', 'map', 'bb'], compact: true, accentColor: A, maxFontSize: 26 }), { name: 'RustSetup' }),
    bigValue('incidentCount', 740, 514, 124, 74, 'INC', RED, { maxFontSize: 48 }),
    bigValue('position', 874, 514, 134, 74, 'POS', A, { maxFontSize: 48 })
  ]
  return dashboard('NP Rust · Standings', 1024, 600, 'Rust DDU: class-standings hero, position-gaps + tyre temps mid, big gear, delta. Race-awareness focus.', elements)
}

// 8. Copper – radar hero, tyre-pressure + position-gaps mid
function createNpCopperRadarPreset(): Dashboard {
  const A = COPPER_W, A2 = AUTUMN_W
  const elements: DashboardElement[] = [
    backplate('CopperBP'),
    denseRevBar(12, 10, 1000, 24, 26),
    w('weather', 206, 40, 184, 44, warmStyle({ title: 'TRACK', accentColor: A, maxFontSize: 24 }), { name: 'HdrWeather' }),
    card(437, 38, 150, 46, A, 'SpeedBox'),
    bigValue('speedKmh', 437, 38, 150, 46, 'SPEED', WARM_WHITE, { maxFontSize: 34 }),
    ...lvRow(636, 44, 372, 34, 'HdrLap', 'LAP', 'currentLap', A),
    hairline(302, 92, 1, 408), hairline(716, 92, 1, 408),
    w('radar-elaborate', 14, 96, 282, 250, warmStyle({ accentColor: A, maxFontSize: 26 }), { name: 'CopperRadarHero' }),
    gearHero(322, 92, 380, 210, A),
    bigValue('rpm', 352, 306, 320, 44, 'RPM', A2, { maxFontSize: 40 }),
    text(724, 96, 284, 24, 'LTLbl', { text: 'LAP TIME', color: A, fontSize: 18, fontWeight: 900, align: 'left', fontFamily: FONT_COND }),
    bigValue('currentLapFmt', 724, 120, 284, 70, '', WARM_WHITE, { maxFontSize: 56 }),
    w('deltatile', 724, 196, 284, 130, warmStyle({ title: 'DELTA', deltaReference: 'session', deltaRangeSec: 1, accentColor: RED, maxFontSize: 64 }), { binding: 'deltaSec', name: 'CopperDelta' }),
    w('relatives-elaborate', 14, 356, 282, 146, warmStyle({ accentColor: AMBER, maxFontSize: 32 }), { name: 'CopperRelatives' }),
    w('tyregrid', 312, 356, 196, 146, warmStyle({ gridMode: 'pressure', title: 'TYRE PRESS', targetValue: 165, tolerance: 7, showLabels: true, accentColor: A, maxFontSize: 26 }), { name: 'CopperTyrePress' }),
    w('positiongaps', 516, 356, 192, 146, warmStyle({ showTotal: true, accentColor: A2, minFontSize: 20, maxFontSize: 52 }), { name: 'CopperPosGaps' }),
    ...lvRow(724, 360, 284, 44, 'TLeft', 'TIME LEFT', 'sessionTimeLeftFmt', A),
    ...lvRow(724, 408, 284, 44, 'Pos', 'POSITION', 'position', A),
    ...lvRow(724, 456, 284, 44, 'Best', 'BEST', 'bestLapFmt', A),
    bigValue('brakeBiasPct', 16, 514, 178, 74, 'BIAS', A, { maxFontSize: 46 }),
    w('setupstrip', 206, 522, 520, 60, warmStyle({ fields: ['abs', 'tc', 'map', 'bb'], compact: true, accentColor: A, maxFontSize: 26 }), { name: 'CopperSetup' }),
    bigValue('incidentCount', 740, 514, 124, 74, 'INC', RED, { maxFontSize: 48 }),
    bigValue('position', 874, 514, 134, 74, 'POS', A, { maxFontSize: 48 })
  ]
  return dashboard('NP Copper · Radar', 1024, 600, 'Copper DDU: proximity-radar hero, tyre pressures + position-gaps mid, big gear, delta. Copper/autumn palette.', elements)
}

// 9. Brick – cornerstack hero, tyre-pressure + brakegrid mid
function createNpBrickCornersPreset(): Dashboard {
  const A = BRICK_W, A2 = RUST_W
  const elements: DashboardElement[] = [
    backplate('BrickBP'),
    denseRevBar(12, 10, 1000, 24, 26),
    w('weather', 206, 40, 184, 44, warmStyle({ title: 'TRACK', accentColor: A, maxFontSize: 24 }), { name: 'HdrWeather' }),
    card(437, 38, 150, 46, A, 'SpeedBox'),
    bigValue('speedKmh', 437, 38, 150, 46, 'SPEED', WARM_WHITE, { maxFontSize: 34 }),
    ...lvRow(636, 44, 372, 34, 'HdrLap', 'LAP', 'currentLap', A),
    hairline(302, 92, 1, 408), hairline(716, 92, 1, 408),
    w('cornerstack', 14, 96, 282, 250, warmStyle({ title: 'CORNER HEALTH', targetValue: 165, tolerance: 7, accentColor: A, maxFontSize: 32 }), { name: 'BrickCornerHero' }),
    gearHero(322, 92, 380, 210, A),
    bigValue('rpm', 352, 306, 320, 44, 'RPM', A2, { maxFontSize: 40 }),
    text(724, 96, 284, 24, 'LTLbl', { text: 'LAP TIME', color: A, fontSize: 18, fontWeight: 900, align: 'left', fontFamily: FONT_COND }),
    bigValue('currentLapFmt', 724, 120, 284, 70, '', WARM_WHITE, { maxFontSize: 56 }),
    w('deltatile', 724, 196, 284, 130, warmStyle({ title: 'DELTA', deltaReference: 'session', deltaRangeSec: 1, accentColor: RED, maxFontSize: 64 }), { binding: 'deltaSec', name: 'BrickDelta' }),
    w('relatives-elaborate', 14, 356, 282, 146, warmStyle({ accentColor: AMBER, maxFontSize: 32 }), { name: 'BrickRelatives' }),
    w('tyregrid', 312, 356, 196, 146, warmStyle({ gridMode: 'pressure', title: 'TYRE PRESS', targetValue: 165, tolerance: 7, showLabels: true, accentColor: A, maxFontSize: 26 }), { name: 'BrickTyrePress' }),
    w('brakegrid', 516, 356, 192, 146, warmStyle({ title: 'BRAKES', showAverage: true, accentColor: A2, maxFontSize: 28 }), { name: 'BrickBrakes' }),
    ...lvRow(724, 360, 284, 44, 'TLeft', 'TIME LEFT', 'sessionTimeLeftFmt', A),
    ...lvRow(724, 408, 284, 44, 'Pos', 'POSITION', 'position', A),
    ...lvRow(724, 456, 284, 44, 'Best', 'BEST', 'bestLapFmt', A),
    bigValue('brakeBiasPct', 16, 514, 178, 74, 'BIAS', A, { maxFontSize: 46 }),
    w('setupstrip', 206, 522, 520, 60, warmStyle({ fields: ['abs', 'tc', 'map', 'bb'], compact: true, accentColor: A, maxFontSize: 26 }), { name: 'BrickSetup' }),
    bigValue('incidentCount', 740, 514, 124, 74, 'INC', RED, { maxFontSize: 48 }),
    bigValue('position', 874, 514, 134, 74, 'POS', A, { maxFontSize: 48 })
  ]
  return dashboard('NP Brick · Corners', 1024, 600, 'Brick-red DDU: corner-health hero, tyre pressures + brake temps mid, big gear, delta. Engineering-heavy brick/rust palette.', elements)
}

// 10. Maroon – trackmap hero, position-gaps + fuelstint mid
function createNpMaroonTrackmapPreset(): Dashboard {
  const A = DKAMBER, A2 = MAHOG
  const elements: DashboardElement[] = [
    backplate('MaroonBP'),
    denseRevBar(12, 10, 1000, 24, 26),
    w('weather', 206, 40, 184, 44, warmStyle({ title: 'TRACK', accentColor: A, maxFontSize: 24 }), { name: 'HdrWeather' }),
    card(437, 38, 150, 46, A, 'SpeedBox'),
    bigValue('speedKmh', 437, 38, 150, 46, 'SPEED', WARM_WHITE, { maxFontSize: 34 }),
    ...lvRow(636, 44, 372, 34, 'HdrLap', 'LAP', 'currentLap', A),
    hairline(302, 92, 1, 408), hairline(716, 92, 1, 408),
    w('trackmap-elaborate', 14, 96, 282, 250, warmStyle({ accentColor: A, color: MUTED, maxFontSize: 26 }), { binding: 'lapDistPct', name: 'MaroonTrackHero' }),
    gearHero(322, 92, 380, 210, A),
    bigValue('rpm', 352, 306, 320, 44, 'RPM', A2, { maxFontSize: 40 }),
    text(724, 96, 284, 24, 'LTLbl', { text: 'LAP TIME', color: A, fontSize: 18, fontWeight: 900, align: 'left', fontFamily: FONT_COND }),
    bigValue('currentLapFmt', 724, 120, 284, 70, '', WARM_WHITE, { maxFontSize: 56 }),
    w('deltatile', 724, 196, 284, 130, warmStyle({ title: 'DELTA', deltaReference: 'session', deltaRangeSec: 1, accentColor: RED, maxFontSize: 64 }), { binding: 'deltaSec', name: 'MaroonDelta' }),
    w('relatives-elaborate', 14, 356, 282, 146, warmStyle({ accentColor: AMBER, maxFontSize: 32 }), { name: 'MaroonRelatives' }),
    w('positiongaps', 312, 356, 196, 146, warmStyle({ showTotal: true, accentColor: A, minFontSize: 20, maxFontSize: 52 }), { name: 'MaroonPosGaps' }),
    w('fuelstint', 516, 356, 192, 146, warmStyle({ title: 'FUEL', reserveLaps: 1, warnAtLaps: 2, accentColor: A2, maxFontSize: 40 }), { name: 'MaroonFuel' }),
    ...lvRow(724, 360, 284, 44, 'TLeft', 'TIME LEFT', 'sessionTimeLeftFmt', A),
    ...lvRow(724, 408, 284, 44, 'Pos', 'POSITION', 'position', A),
    ...lvRow(724, 456, 284, 44, 'Best', 'BEST', 'bestLapFmt', A),
    bigValue('brakeBiasPct', 16, 514, 178, 74, 'BIAS', A, { maxFontSize: 46 }),
    w('setupstrip', 206, 522, 520, 60, warmStyle({ fields: ['abs', 'tc', 'map', 'bb'], compact: true, accentColor: A, maxFontSize: 26 }), { name: 'MaroonSetup' }),
    bigValue('incidentCount', 740, 514, 124, 74, 'INC', RED, { maxFontSize: 48 }),
    bigValue('position', 874, 514, 134, 74, 'POS', A, { maxFontSize: 48 })
  ]
  return dashboard('NP Maroon · Track Map', 1024, 600, 'Dark amber/maroon DDU: live track-map hero, position-gaps + fuel-stint mid, big gear. Dark gold palette.', elements)
}

// 11. Amber Wide Center – huge gear, relatives + TC/ABS, tyre grid + timing band
function createNpAmberWideCenterPreset(): Dashboard {
  const A = AMBER, A2 = ORANGE
  const elements: DashboardElement[] = [
    backplate('AmberWideBP'),
    w('shiftbar', 16, 12, 992, 44, warmStyle({ segments: 28, flashAt: 0.98, warnAt: 0.64, dangerAt: 0.86, glow: true, segmentShape: 'bar', fillColor: GREEN, warnColor: A2, dangerColor: RED, radius: 8 }), { binding: 'shiftPct', name: 'AmberShift' }),
    warmWidget('relatives-elaborate', 16, 68, 328, 170, 'Relatives', 'RELATIVES', A, { maxFontSize: 36 }),
    warmWidget('gear-elaborate', 360, 64, 298, 274, 'Gear', 'GEAR', A, { maxFontSize: 178 }),
    warmWidget('speed-elaborate', 674, 68, 208, 82, 'Speed', 'SPEED', WARM_WHITE, { maxFontSize: 52 }),
    warmWidget('rpm-elaborate', 674, 160, 208, 82, 'Rpm', 'RPM', A2, { maxFontSize: 48 }),
    warmWidget('delta-elaborate', 896, 64, 112, 274, 'Delta', 'DELTA', RED, { deltaRangeSec: 1, maxFontSize: 48 }, 'deltaSec'),
    warmWidget('position-elaborate', 16, 250, 162, 82, 'Position', 'POS', A, { maxFontSize: 54 }),
    warmWidget('incidents-elaborate', 188, 250, 156, 82, 'Incidents', 'INC', RED, { maxFontSize: 50 }),
    warmWidget('tc-clean', 674, 252, 100, 82, 'Tc', 'TC', A2, { maxFontSize: 44 }),
    warmWidget('abs-clean', 784, 252, 100, 82, 'Abs', 'ABS', A, { maxFontSize: 44 }),
    w('tyregrid', 16, 352, 328, 132, warmStyle({ gridMode: 'temp', title: 'TYRES', showLabels: true, accentColor: A, maxFontSize: 26 }), { name: 'AmberTyres' }),
    w('laptiming', 360, 352, 526, 132, warmStyle({ title: 'TIMING', showCurrent: true, showLast: true, showBest: true, accentColor: A, maxFontSize: 44 }), { name: 'AmberTiming' }),
    warmWidget('bb-clean', 898, 352, 110, 132, 'Bb', 'BB', A2, { maxFontSize: 52 }),
    w('setupstrip', 16, 498, 526, 76, warmStyle({ fields: ['abs', 'tc', 'map', 'bb', 'limiter'], compact: true, accentColor: A2, maxFontSize: 28 }), { name: 'AmberSetup' }),
    bigValue('brakeBiasPct', 558, 498, 210, 76, 'BIAS', A, { maxFontSize: 50 }),
    bigValue('position', 784, 498, 224, 76, 'POS', A, { maxFontSize: 50 })
  ]
  return dashboard('NP Amber Wide Center', 1024, 600, 'Amber wide: huge gear center, relatives top-left, speed/rpm right, TC/ABS, tyre grid + timing band, setup footer.', elements)
}

// 12. Sunset Race – sunset orange/flame 3-row warmWidget race grid
function createNpSunsetRacePreset(): Dashboard {
  const A = SUNSET_W, A2 = FLAME_W
  const elements: DashboardElement[] = [
    backplate('SunsetBP'),
    w('shiftbar', 14, 10, 996, 46, warmStyle({ segments: 30, flashAt: 0.98, warnAt: 0.65, dangerAt: 0.87, glow: true, segmentShape: 'led', fillColor: GREEN, warnColor: A, dangerColor: A2, radius: 8 }), { binding: 'shiftPct', name: 'SunsetShift' }),
    warmWidget('speed-elaborate', 14, 70, 218, 112, 'Speed', 'SPEED', WARM_WHITE, { maxFontSize: 64 }),
    warmWidget('gear-elaborate', 248, 62, 270, 228, 'Gear', 'GEAR', A, { maxFontSize: 150 }),
    warmWidget('rpm-elaborate', 534, 70, 218, 112, 'Rpm', 'RPM', A, { maxFontSize: 58 }),
    warmWidget('delta-elaborate', 768, 70, 242, 112, 'Delta', 'DELTA', RED, { deltaRangeSec: 1, maxFontSize: 58 }, 'deltaSec'),
    warmWidget('position-elaborate', 14, 194, 218, 96, 'Position', 'POS', A, { maxFontSize: 56 }),
    warmWidget('incidents-elaborate', 534, 194, 218, 96, 'Incidents', 'INC', A2, { maxFontSize: 52 }),
    warmWidget('lap-elaborate', 768, 194, 242, 96, 'Lap', 'LAP', A, { maxFontSize: 48 }),
    warmWidget('relatives-elaborate', 14, 304, 538, 118, 'Relatives', 'RELATIVES', A, { maxFontSize: 34 }),
    warmWidget('radar-clean', 568, 304, 198, 118, 'Radar', 'RADAR', A2, { maxFontSize: 34 }),
    warmWidget('trackmap-clean', 782, 304, 228, 118, 'TrackMap', 'TRACK', A, { maxFontSize: 28 }, 'lapDistPct'),
    w('tyregrid', 14, 436, 328, 138, warmStyle({ gridMode: 'temp', title: 'TYRES', showLabels: true, accentColor: A, maxFontSize: 26 }), { name: 'SunsetTyres' }),
    warmWidget('tc-clean', 358, 436, 126, 66, 'Tc', 'TC', A, { maxFontSize: 44 }),
    warmWidget('abs-clean', 358, 510, 126, 64, 'Abs', 'ABS', A2, { maxFontSize: 44 }),
    warmWidget('bb-clean', 500, 436, 126, 66, 'Bb', 'BB', A, { maxFontSize: 44 }),
    w('setupstrip', 642, 436, 368, 138, warmStyle({ fields: ['abs', 'tc', 'map', 'bb', 'limiter', 'inc'], compact: true, accentColor: A2, maxFontSize: 26 }), { name: 'SunsetSetup' })
  ]
  return dashboard('NP Sunset Race', 1024, 600, 'Sunset orange/flame: huge gear, relatives band, radar + track map, tyre grid, TC/ABS/BB controls, full race info.', elements)
}

// 13. Cherry Cluster – large gearcluster left, tyre temps + relatives right
function createNpCherryClusterPreset(): Dashboard {
  const A = CHERRY_W, A2 = ROSE_W
  const elements: DashboardElement[] = [
    backplate('CherryClusterBP'),
    w('shiftbar', 14, 10, 996, 44, warmStyle({ segments: 26, flashAt: 0.98, warnAt: 0.64, dangerAt: 0.86, glow: true, segmentShape: 'led', fillColor: GREEN, warnColor: A2, dangerColor: A, radius: 8 }), { binding: 'shiftPct', name: 'CherryShift' }),
    w('gearcluster', 14, 68, 328, 436, warmStyle({ radius: 24, accentColor: A, showRpm: true, flashAt: 0.98, dangerAt: 0.86, unit: 'kmh' }), { name: 'CherryGearCluster' }),
    warmWidget('tyres-elaborate', 358, 68, 298, 216, 'Tyres', 'TYRES', A, { coldAt: 72, optimalAt: 88, hotAt: 104, criticalAt: 118, maxFontSize: 36 }),
    warmWidget('relatives-elaborate', 672, 68, 338, 216, 'Relatives', 'RELATIVES', A, { maxFontSize: 38 }),
    w('tyregrid', 358, 298, 298, 206, warmStyle({ gridMode: 'pressure', title: 'TYRE PRESS', targetValue: 165, tolerance: 7, showLabels: true, accentColor: A2, maxFontSize: 28 }), { name: 'CherryPress' }),
    warmWidget('delta-elaborate', 672, 298, 162, 206, 'Delta', 'DELTA', RED, { deltaRangeSec: 1, maxFontSize: 72 }, 'deltaSec'),
    warmWidget('incidents-clean', 850, 298, 160, 100, 'Incidents', 'INC', A, { maxFontSize: 48 }),
    warmWidget('position-clean', 850, 406, 160, 98, 'Position', 'POS', A2, { maxFontSize: 48 }),
    bigValue('brakeBiasPct', 14, 516, 178, 68, 'BIAS', A, { maxFontSize: 44 }),
    w('setupstrip', 206, 524, 520, 60, warmStyle({ fields: ['abs', 'tc', 'map', 'bb'], compact: true, accentColor: A, maxFontSize: 26 }), { name: 'CherrySetup' }),
    w('laptiming', 740, 516, 270, 68, warmStyle({ title: 'LAP / BEST', showCurrent: true, showBest: true, accentColor: A2, maxFontSize: 36 }), { name: 'CherryTiming' })
  ]
  return dashboard('NP Cherry Cluster', 1024, 600, 'Cherry/rose: large gearcluster left, tyre temps + relatives center-right, delta, incidents, bias, lap-timing footer.', elements)
}

// 14. Autumn Band – big horizontal gear, relatives + delta left stack
function createNpAutumnBandPreset(): Dashboard {
  const A = AUTUMN_W, A2 = BRONZE_W
  const elements: DashboardElement[] = [
    backplate('AutumnBandBP'),
    w('shiftbar', 14, 10, 996, 44, warmStyle({ segments: 28, flashAt: 0.98, warnAt: 0.64, dangerAt: 0.86, glow: true, segmentShape: 'bar', fillColor: GREEN, warnColor: A, dangerColor: RED, radius: 8 }), { binding: 'shiftPct', name: 'AutumnShift' }),
    warmWidget('relatives-elaborate', 14, 68, 398, 118, 'Relatives', 'RELATIVES', A, { maxFontSize: 36 }),
    warmWidget('speed-elaborate', 428, 68, 208, 56, 'Speed', 'SPEED', WARM_WHITE, { maxFontSize: 40 }),
    warmWidget('position-elaborate', 652, 68, 188, 56, 'Position', 'POS', A, { maxFontSize: 40 }),
    warmWidget('incidents-elaborate', 856, 68, 154, 56, 'Incidents', 'INC', RED, { maxFontSize: 36 }),
    warmWidget('gear-elaborate', 428, 134, 582, 256, 'Gear', 'GEAR', A, { maxFontSize: 192 }),
    warmWidget('delta-elaborate', 14, 198, 398, 112, 'Delta', 'DELTA', RED, { deltaRangeSec: 1, maxFontSize: 68 }, 'deltaSec'),
    warmWidget('lap-clean', 14, 320, 194, 70, 'Lap', 'LAP', A, { maxFontSize: 46 }),
    warmWidget('fuel-clean', 218, 320, 194, 70, 'Fuel', 'FUEL', A2, { maxFontSize: 46 }),
    w('tyregrid', 14, 402, 398, 114, warmStyle({ gridMode: 'temp', title: 'TYRES', showLabels: true, accentColor: A, maxFontSize: 24 }), { name: 'AutumnTyres' }),
    w('setupstrip', 428, 400, 582, 94, warmStyle({ title: 'SETUP', fields: ['abs', 'tc', 'map', 'bb', 'limiter'], compact: true, accentColor: A2, maxFontSize: 30 }), { name: 'AutumnSetup' }),
    bigValue('brakeBiasPct', 14, 528, 194, 58, 'BIAS', A, { maxFontSize: 36 }),
    w('laptiming', 222, 528, 788, 58, warmStyle({ title: 'LAP / LAST / BEST', showCurrent: true, showLast: true, showBest: true, accentColor: A, maxFontSize: 36 }), { name: 'AutumnTiming' })
  ]
  return dashboard('NP Autumn Band', 1024, 600, 'Autumn band: big horizontal gear block, relatives + delta stack left, tyre grid, setup strip, lap/last/best footer.', elements)
}

// 15. Bronze HUD – track map center hero, all mandatories around it
function createNpBronzeHudPreset(): Dashboard {
  const A = BRONZE_W, A2 = COPPER_W
  const elements: DashboardElement[] = [
    backplate('BronzeHudBP'),
    w('shiftbar', 14, 10, 996, 44, warmStyle({ segments: 28, flashAt: 0.98, warnAt: 0.64, dangerAt: 0.86, glow: true, segmentShape: 'bar', fillColor: GREEN, warnColor: A, dangerColor: RED, radius: 8 }), { binding: 'shiftPct', name: 'BronzeShift' }),
    warmWidget('gear-elaborate', 14, 68, 238, 218, 'Gear', 'GEAR', A, { maxFontSize: 140 }),
    warmWidget('speed-elaborate', 14, 296, 116, 90, 'Speed', 'SPEED', WARM_WHITE, { maxFontSize: 52 }),
    warmWidget('rpm-elaborate', 140, 296, 112, 90, 'Rpm', 'RPM', A, { maxFontSize: 48 }),
    w('trackmap-elaborate', 268, 68, 482, 318, warmStyle({ accentColor: A, color: MUTED, maxFontSize: 28 }), { binding: 'lapDistPct', name: 'BronzeTrackHero' }),
    warmWidget('position-elaborate', 766, 68, 244, 118, 'Position', 'POS', A, { maxFontSize: 72 }),
    warmWidget('incidents-elaborate', 766, 196, 244, 110, 'Incidents', 'INC', RED, { maxFontSize: 64 }),
    warmWidget('delta-clean', 766, 316, 244, 70, 'Delta', 'DELTA', RED, { deltaRangeSec: 1, maxFontSize: 44 }, 'deltaSec'),
    warmWidget('relatives-elaborate', 14, 400, 736, 108, 'Relatives', 'RELATIVES', A, { maxFontSize: 34 }),
    warmWidget('tc-clean', 766, 400, 118, 54, 'Tc', 'TC', A2, { maxFontSize: 40 }),
    warmWidget('abs-clean', 894, 400, 120, 54, 'Abs', 'ABS', A, { maxFontSize: 40 }),
    warmWidget('bb-clean', 766, 462, 118, 46, 'Bb', 'BB', A, { maxFontSize: 36 }),
    w('setupstrip', 14, 522, 736, 62, warmStyle({ fields: ['abs', 'tc', 'map', 'bb', 'limiter', 'inc'], compact: true, accentColor: A2, maxFontSize: 28 }), { name: 'BronzeSetup' }),
    bigValue('brakeBiasPct', 766, 522, 248, 62, 'BIAS', A, { maxFontSize: 40 })
  ]
  return dashboard('NP Bronze HUD', 1024, 600, 'Bronze HUD: track-map center, gear/speed left, position/incidents/delta right, relatives wide band, setup footer.', elements)
}

// 16. Terracotta Race – full warmWidget race grid, terracotta/rust
function createNpTerracottaRacePreset(): Dashboard {
  const A = TERRACT, A2 = RUST_W
  const elements: DashboardElement[] = [
    backplate('TerracottaBP'),
    w('shiftbar', 14, 10, 996, 46, warmStyle({ segments: 28, flashAt: 0.98, warnAt: 0.65, dangerAt: 0.87, glow: true, segmentShape: 'led', fillColor: GREEN, warnColor: A, dangerColor: RED, radius: 8 }), { binding: 'shiftPct', name: 'TerracottaShift' }),
    warmWidget('flags-elaborate', 14, 68, 308, 64, 'Flags', 'FLAGS', A, { maxFontSize: 42 }),
    warmWidget('position-elaborate', 338, 68, 194, 64, 'Position', 'POSITION', A, { maxFontSize: 42 }),
    warmWidget('incidents-elaborate', 548, 68, 158, 64, 'Incidents', 'INC', RED, { maxFontSize: 40 }),
    warmWidget('pitlimiter-clean', 722, 68, 128, 64, 'PitLimiter', 'PIT', A2, { maxFontSize: 38 }),
    warmWidget('lap-clean', 866, 68, 144, 64, 'Lap', 'LAP', A, { maxFontSize: 36 }),
    warmWidget('speed-elaborate', 14, 148, 210, 114, 'Speed', 'SPEED', WARM_WHITE, { maxFontSize: 64 }),
    warmWidget('gear-elaborate', 240, 140, 260, 212, 'Gear', 'GEAR', A, { maxFontSize: 142 }),
    warmWidget('rpm-elaborate', 516, 148, 210, 114, 'Rpm', 'RPM', A, { maxFontSize: 58 }),
    warmWidget('delta-elaborate', 742, 148, 268, 114, 'Delta', 'DELTA', RED, { deltaRangeSec: 1, maxFontSize: 58 }, 'deltaSec'),
    warmWidget('fuel-elaborate', 14, 276, 210, 76, 'Fuel', 'FUEL', A, { maxFontSize: 46 }),
    warmWidget('tc-clean', 516, 276, 100, 76, 'Tc', 'TC', A2, { maxFontSize: 46 }),
    warmWidget('abs-clean', 632, 276, 100, 76, 'Abs', 'ABS', A, { maxFontSize: 46 }),
    warmWidget('bb-clean', 748, 276, 100, 76, 'Bb', 'BB', A2, { maxFontSize: 44 }),
    warmWidget('map-clean', 864, 276, 146, 76, 'Map', 'MAP', A, { maxFontSize: 44 }),
    warmWidget('relatives-elaborate', 14, 366, 498, 114, 'Relatives', 'RELATIVES', A, { maxFontSize: 34 }),
    warmWidget('radar-clean', 528, 366, 202, 114, 'Radar', 'RADAR', A2, { maxFontSize: 34 }),
    warmWidget('trackmap-clean', 746, 366, 264, 114, 'TrackMap', 'TRACK', A, { maxFontSize: 30 }, 'lapDistPct'),
    w('tyregrid', 14, 494, 328, 90, warmStyle({ gridMode: 'temp', title: 'TYRES', showLabels: true, accentColor: A, maxFontSize: 24 }), { name: 'TerracottaTyres' }),
    w('setupstrip', 358, 494, 652, 90, warmStyle({ title: 'SETUP', fields: ['abs', 'tc', 'map', 'bb', 'limiter', 'inc'], compact: true, accentColor: A2, maxFontSize: 30 }), { name: 'TerracottaSetup' })
  ]
  return dashboard('NP Terracotta Race', 1024, 600, 'Terracotta/rust full race grid: flag bar, gear hero, relatives + radar + track map, tyre grid, full setup strip.', elements)
}

// 17. Deep Gold Dense – flag/pos/inc header, gear hero, relatives + radar band
function createNpDeepGoldDensePreset(): Dashboard {
  const A = DEEPGOLD, A2 = GOLD_W
  const elements: DashboardElement[] = [
    backplate('DeepGoldBP'),
    w('shiftbar', 14, 10, 996, 44, warmStyle({ segments: 30, flashAt: 0.98, warnAt: 0.65, dangerAt: 0.87, glow: true, segmentShape: 'led', fillColor: GREEN, warnColor: A, dangerColor: RED, radius: 8 }), { binding: 'shiftPct', name: 'DeepGoldShift' }),
    warmWidget('flags-elaborate', 14, 68, 288, 62, 'Flags', 'FLAGS', A, { maxFontSize: 40 }),
    warmWidget('position-elaborate', 318, 68, 188, 62, 'Position', 'POSITION', A, { maxFontSize: 40 }),
    warmWidget('incidents-elaborate', 522, 68, 158, 62, 'Incidents', 'INC', RED, { maxFontSize: 38 }),
    warmWidget('lap-clean', 696, 68, 158, 62, 'Lap', 'LAP', A, { maxFontSize: 36 }),
    warmWidget('fuel-clean', 870, 68, 140, 62, 'Fuel', 'FUEL', A2, { maxFontSize: 34 }),
    warmWidget('speed-elaborate', 14, 146, 216, 116, 'Speed', 'SPEED', WARM_WHITE, { maxFontSize: 70 }),
    warmWidget('gear-elaborate', 246, 140, 262, 220, 'Gear', 'GEAR', A, { maxFontSize: 150 }),
    warmWidget('rpm-elaborate', 524, 146, 216, 116, 'Rpm', 'RPM', A, { maxFontSize: 60 }),
    warmWidget('delta-elaborate', 756, 146, 254, 116, 'Delta', 'DELTA', RED, { deltaRangeSec: 1, maxFontSize: 60 }, 'deltaSec'),
    w('tyregrid', 14, 276, 216, 84, warmStyle({ gridMode: 'temp', title: 'TYRES', showLabels: false, accentColor: A, maxFontSize: 22 }), { name: 'DeepGoldTyres' }),
    warmWidget('tc-elaborate', 524, 276, 108, 84, 'Tc', 'TC', A, { maxFontSize: 46 }),
    warmWidget('abs-elaborate', 648, 276, 108, 84, 'Abs', 'ABS', A2, { maxFontSize: 46 }),
    warmWidget('bb-elaborate', 772, 276, 108, 84, 'Bb', 'BB', A, { maxFontSize: 44 }),
    warmWidget('map-elaborate', 896, 276, 114, 84, 'Map', 'MAP', A2, { maxFontSize: 44 }),
    warmWidget('relatives-elaborate', 14, 374, 498, 110, 'Relatives', 'RELATIVES', A, { maxFontSize: 34 }),
    warmWidget('radar-elaborate', 528, 374, 216, 110, 'Radar', 'RADAR', A2, { maxFontSize: 32 }),
    warmWidget('trackmap-elaborate', 760, 374, 250, 110, 'TrackMap', 'TRACK MAP', A, { maxFontSize: 28 }, 'lapDistPct'),
    bigValue('brakeBiasPct', 14, 498, 178, 74, 'BIAS', A, { maxFontSize: 46 }),
    w('setupstrip', 206, 506, 520, 62, warmStyle({ fields: ['abs', 'tc', 'map', 'bb'], compact: true, accentColor: A2, maxFontSize: 26 }), { name: 'DeepGoldSetup' }),
    bigValue('incidentCount', 740, 498, 124, 74, 'INC', RED, { maxFontSize: 48 }),
    bigValue('position', 878, 498, 132, 74, 'POS', A, { maxFontSize: 48 })
  ]
  return dashboard('NP Deep Gold Dense', 1024, 600, 'Deep gold dense: flag/pos/inc bar, gear hero, relatives + radar + track map band, tyre grid, DDU footer. Gold palette.', elements)
}

// 18. Flame Race Dense – relatives + pos/inc header, gear + tyres + radar, setup footer
function createNpFlameRaceDensePreset(): Dashboard {
  const A = FLAME_W, A2 = CRIMSON
  const elements: DashboardElement[] = [
    backplate('FlameBP'),
    w('shiftbar', 14, 10, 996, 46, warmStyle({ segments: 28, flashAt: 0.98, warnAt: 0.65, dangerAt: 0.87, glow: true, segmentShape: 'bar', fillColor: GREEN, warnColor: A, dangerColor: A2, radius: 8 }), { binding: 'shiftPct', name: 'FlameShift' }),
    warmWidget('relatives-elaborate', 14, 68, 458, 126, 'Relatives', 'RELATIVES', A, { maxFontSize: 36 }),
    warmWidget('position-elaborate', 488, 68, 238, 60, 'Position', 'POSITION', A, { maxFontSize: 40 }),
    warmWidget('incidents-elaborate', 742, 68, 268, 60, 'Incidents', 'INC', A2, { maxFontSize: 40 }),
    warmWidget('speed-elaborate', 488, 138, 238, 56, 'Speed', 'SPEED', WARM_WHITE, { maxFontSize: 40 }),
    warmWidget('delta-elaborate', 742, 138, 268, 56, 'Delta', 'DELTA', RED, { deltaRangeSec: 1, maxFontSize: 38 }, 'deltaSec'),
    warmWidget('gear-elaborate', 14, 208, 476, 224, 'Gear', 'GEAR', A, { maxFontSize: 158 }),
    warmWidget('tyres-elaborate', 506, 208, 258, 224, 'Tyres', 'TYRES', A, { coldAt: 72, optimalAt: 88, hotAt: 104, criticalAt: 118, maxFontSize: 30 }),
    warmWidget('radar-elaborate', 780, 208, 230, 224, 'Radar', 'RADAR', A2, { maxFontSize: 30 }),
    warmWidget('tc-clean', 14, 446, 118, 64, 'Tc', 'TC', A, { maxFontSize: 44 }),
    warmWidget('abs-clean', 148, 446, 118, 64, 'Abs', 'ABS', A2, { maxFontSize: 44 }),
    warmWidget('bb-clean', 282, 446, 118, 64, 'Bb', 'BB', A, { maxFontSize: 44 }),
    warmWidget('fuel-clean', 416, 446, 118, 64, 'Fuel', 'FUEL', A, { maxFontSize: 44 }),
    warmWidget('lap-clean', 550, 446, 158, 64, 'Lap', 'LAP', A, { maxFontSize: 40 }),
    w('setupstrip', 724, 446, 286, 64, warmStyle({ fields: ['abs', 'tc', 'map', 'bb'], compact: true, accentColor: A2, maxFontSize: 28 }), { name: 'FlameSetup' }),
    bigValue('brakeBiasPct', 14, 524, 178, 62, 'BIAS', A, { maxFontSize: 40 }),
    w('laptiming', 206, 524, 804, 62, warmStyle({ title: 'LAP / LAST / BEST', showCurrent: true, showLast: true, showBest: true, accentColor: A, maxFontSize: 38 }), { name: 'FlameTiming' })
  ]
  return dashboard('NP Flame Race Dense', 1024, 600, 'Flame/crimson dense race: relatives + pos/inc header, big gear + tyre temps + radar, TC/ABS/BB, timing footer.', elements)
}

// 19. Mahogany Full – most comprehensive warmWidget grid, mahogany/brick
function createNpMahoganyFullPreset(): Dashboard {
  const A = MAHOG, A2 = BRICK_W
  const elements: DashboardElement[] = [
    backplate('MahoganyBP'),
    w('shiftbar', 14, 10, 996, 44, warmStyle({ segments: 28, flashAt: 0.98, warnAt: 0.65, dangerAt: 0.87, glow: true, segmentShape: 'bar', fillColor: GREEN, warnColor: A2, dangerColor: A, radius: 8 }), { binding: 'shiftPct', name: 'MahoganyShift' }),
    warmWidget('flags-elaborate', 14, 68, 278, 60, 'Flags', 'FLAGS', A2, { maxFontSize: 38 }),
    warmWidget('position-elaborate', 308, 68, 198, 60, 'Position', 'POSITION', A2, { maxFontSize: 38 }),
    warmWidget('incidents-elaborate', 522, 68, 168, 60, 'Incidents', 'INC', RED, { maxFontSize: 38 }),
    warmWidget('pitlimiter-clean', 706, 68, 138, 60, 'PitLimiter', 'PIT', A, { maxFontSize: 34 }),
    warmWidget('fuel-clean', 860, 68, 150, 60, 'Fuel', 'FUEL', A2, { maxFontSize: 32 }),
    warmWidget('speed-elaborate', 14, 142, 214, 114, 'Speed', 'SPEED', WARM_WHITE, { maxFontSize: 64 }),
    warmWidget('gear-elaborate', 244, 138, 268, 216, 'Gear', 'GEAR', A2, { maxFontSize: 144 }),
    warmWidget('rpm-elaborate', 528, 142, 214, 114, 'Rpm', 'RPM', A2, { maxFontSize: 58 }),
    warmWidget('delta-elaborate', 758, 142, 252, 114, 'Delta', 'DELTA', RED, { deltaRangeSec: 1, maxFontSize: 58 }, 'deltaSec'),
    warmWidget('tyres-elaborate', 14, 268, 214, 86, 'Tyres', 'TYRES', A2, { maxFontSize: 22 }),
    warmWidget('abs-elaborate', 528, 270, 106, 82, 'Abs', 'ABS', A, { maxFontSize: 46 }),
    warmWidget('tc-elaborate', 650, 270, 106, 82, 'Tc', 'TC', A2, { maxFontSize: 46 }),
    warmWidget('bb-elaborate', 772, 270, 108, 82, 'Bb', 'BB', A, { maxFontSize: 44 }),
    warmWidget('map-elaborate', 896, 270, 118, 82, 'Map', 'MAP', A2, { maxFontSize: 44 }),
    warmWidget('relatives-elaborate', 14, 368, 478, 114, 'Relatives', 'RELATIVES', A2, { maxFontSize: 34 }),
    warmWidget('radar-elaborate', 508, 368, 226, 114, 'Radar', 'RADAR', A, { maxFontSize: 32 }),
    warmWidget('trackmap-elaborate', 750, 368, 260, 114, 'TrackMap', 'TRACK MAP', A2, { maxFontSize: 28 }, 'lapDistPct'),
    bigValue('brakeBiasPct', 14, 496, 180, 78, 'BIAS', A2, { maxFontSize: 50 }),
    w('setupstrip', 208, 504, 520, 64, warmStyle({ fields: ['abs', 'tc', 'map', 'bb', 'limiter'], compact: true, accentColor: A, maxFontSize: 26 }), { name: 'MahoganySetup' }),
    bigValue('incidentCount', 742, 496, 124, 78, 'INC', RED, { maxFontSize: 50 }),
    bigValue('position', 880, 496, 134, 78, 'POS', A2, { maxFontSize: 50 })
  ]
  return dashboard('NP Mahogany Full', 1024, 600, 'Mahogany/brick full preset: all mandatories + radar + track map + tyres + TC/ABS/BB/MAP. Most comprehensive warm-dark palette.', elements)
}

// 20. Coral Sprint – delta + timing top, gear + radar, relatives band, qualy focus
function createNpCoralSprintPreset(): Dashboard {
  const A = CORAL_W, A2 = VERML
  const elements: DashboardElement[] = [
    backplate('CoralSprintBP'),
    w('shiftbar', 14, 10, 996, 48, warmStyle({ segments: 30, flashAt: 0.985, warnAt: 0.7, dangerAt: 0.9, glow: true, segmentShape: 'led', fillColor: GREEN, warnColor: A, dangerColor: A2, radius: 8 }), { binding: 'shiftPct', name: 'CoralShift' }),
    warmWidget('delta-elaborate', 14, 72, 308, 150, 'Delta', 'DELTA', RED, { deltaRangeSec: 0.8, maxFontSize: 78 }, 'deltaSec'),
    w('laptiming', 338, 72, 338, 150, warmStyle({ title: 'TIMING', showCurrent: true, showLast: true, showBest: true, showEstimated: true, accentColor: A, maxFontSize: 46 }), { name: 'CoralTiming' }),
    warmWidget('position-elaborate', 692, 72, 316, 72, 'Position', 'POSITION', A, { maxFontSize: 46 }),
    warmWidget('incidents-elaborate', 692, 154, 316, 68, 'Incidents', 'INC', A2, { maxFontSize: 42 }),
    warmWidget('speed-elaborate', 14, 236, 176, 108, 'Speed', 'SPEED', WARM_WHITE, { maxFontSize: 68 }),
    warmWidget('gear-elaborate', 206, 232, 278, 190, 'Gear', 'GEAR', A, { maxFontSize: 154 }),
    warmWidget('rpm-elaborate', 500, 236, 190, 108, 'Rpm', 'RPM', A, { maxFontSize: 56 }),
    warmWidget('radar-elaborate', 706, 236, 304, 186, 'Radar', 'RADAR', A2, { maxFontSize: 36 }),
    warmWidget('fuel-clean', 14, 358, 176, 64, 'Fuel', 'FUEL', A, { maxFontSize: 44 }),
    warmWidget('tc-clean', 500, 358, 94, 64, 'Tc', 'TC', A, { maxFontSize: 42 }),
    warmWidget('abs-clean', 608, 358, 82, 64, 'Abs', 'ABS', A2, { maxFontSize: 40 }),
    warmWidget('relatives-elaborate', 14, 436, 498, 110, 'Relatives', 'RELATIVES', A, { maxFontSize: 34 }),
    w('tyregrid', 528, 436, 248, 110, warmStyle({ gridMode: 'temp', title: 'TYRES', showLabels: true, accentColor: A, maxFontSize: 24 }), { name: 'CoralTyres' }),
    warmWidget('trackmap-clean', 792, 436, 218, 110, 'TrackMap', 'TRACK', A, { maxFontSize: 30 }, 'lapDistPct'),
    bigValue('brakeBiasPct', 14, 558, 180, 28, 'BIAS', A, { maxFontSize: 22 }),
    w('setupstrip', 208, 554, 802, 32, warmStyle({ fields: ['abs', 'tc', 'map', 'bb', 'limiter', 'inc'], compact: true, accentColor: A2, maxFontSize: 22 }), { name: 'CoralSetup' })
  ]
  return dashboard('NP Coral Sprint', 1024, 600, 'Coral/vermilion sprint: large delta + timing top, big gear + radar, relatives band, tyre grid, track map. Qualy/sprint-attack focus.', elements)
}


// ─── 20 futuristic graphic-first presets ──────────────────────────────────────
// Native 1024×600 HUDs with minimal text. Every preset contains: revlights,
// gear, speed, incidents, position and two graphic relative chips (ahead/behind).
// No engine/oil/water/air/track temperature widgets are used in this section.

type FxLayout = 'halo' | 'blade' | 'wing' | 'traffic' | 'matrix'

interface FxTheme {
  id: string
  name: string
  a: string
  a2: string
  a3: string
  layout: FxLayout
  concept: string
  tags: string[]
}

function fxPanel(x: number, y: number, width: number, height: number, accent: string, name: string, radius = 18): DashboardElement {
  return w('rect', x, y, width, height, warmStyle({ background: '#020100', border: accent, borderWidth: 1, radius, opacity: 0.92 }), { name })
}

function fxBlade(x: number, y: number, width: number, height: number, accent: string, name: string): DashboardElement {
  return w('rect', x, y, width, height, { background: accent, borderWidth: 0, radius: 999, opacity: 0.72 }, { name })
}

function fxBigNumber(binding: string, x: number, y: number, width: number, height: number, glyph: string, accent: string, maxFontSize: number, suffix = ''): DashboardElement[] {
  return [
    text(x + 8, y + 6, 34, Math.min(44, height - 12), `${glyph}${binding}Glyph`, { text: glyph, color: accent, fontSize: Math.min(28, height * 0.38), fontWeight: 950, align: 'center', fontFamily: FONT_COND }),
    cv(binding, x + 46, y + 4, width - 54, height - 8, '', { color: WARM_WHITE, suffix, minFontSize: 18, maxFontSize, fontFamily: FONT_NUM, align: 'right', accentColor: accent })
  ]
}

function fxRelativeChips(x: number, y: number, width: number, height: number, accent: string, accent2: string, name: string): DashboardElement[] {
  const gap = 10
  const chipH = Math.floor((height - gap) / 2)
  return [
    fxPanel(x, y, width, chipH, accent, `${name}AheadShell`, 14),
    fxBlade(x + 10, y + 10, 7, chipH - 20, accent, `${name}AheadBlade`),
    text(x + 24, y + 6, 46, chipH - 12, `${name}AheadIcon`, { text: '▲', color: accent, fontSize: Math.max(22, chipH * 0.42), fontWeight: 950, align: 'center', fontFamily: FONT_COND }),
    cv('gapAheadFmt', x + 76, y + 4, width - 88, chipH - 8, '', { color: WARM_WHITE, minFontSize: 16, maxFontSize: Math.round(chipH * 0.58), fontFamily: FONT_NUM, align: 'right', accentColor: accent }),
    fxPanel(x, y + chipH + gap, width, chipH, accent2, `${name}BehindShell`, 14),
    fxBlade(x + 10, y + chipH + gap + 10, 7, chipH - 20, accent2, `${name}BehindBlade`),
    text(x + 24, y + chipH + gap + 6, 46, chipH - 12, `${name}BehindIcon`, { text: '▼', color: accent2, fontSize: Math.max(22, chipH * 0.42), fontWeight: 950, align: 'center', fontFamily: FONT_COND }),
    cv('gapBehindFmt', x + 76, y + chipH + gap + 4, width - 88, chipH - 8, '', { color: WARM_WHITE, minFontSize: 16, maxFontSize: Math.round(chipH * 0.58), fontFamily: FONT_NUM, align: 'right', accentColor: accent2 })
  ]
}

function fxRevRail(accent: string, accent2: string, name: string, y = 10, height = 44, segments = 32): DashboardElement {
  return w('shiftbar', 14, y, 996, height, warmStyle({ segments, flashAt: 0.985, warnAt: 0.68, dangerAt: 0.88, glow: true, segmentShape: 'bar', fillColor: accent2, warnColor: accent, dangerColor: RED, flashColor: BLUE, radius: 999 }), { binding: 'shiftPct', name })
}

function fxCoreFooter(accent: string, accent2: string, y = 510): DashboardElement[] {
  return [
    fxPanel(14, y, 168, 74, accent, 'FxBiasPanel', 14),
    ...fxBigNumber('brakeBiasPct', 22, y + 8, 152, 58, '◐', accent, 40),
    w('setupstrip', 196, y, 476, 74, warmStyle({ fields: ['tc', 'abs', 'bb', 'limiter'], compact: true, accentColor: accent2, maxFontSize: 28, radius: 14 }), { name: 'FxSetupStrip' }),
    w('deltabar', 686, y + 20, 324, 34, warmStyle({ background: '#000000', fillColor: GREEN, dangerColor: RED, deltaRangeSec: 1, radius: 999, border: accent, borderWidth: 1 }), { binding: 'deltaSec', name: 'FxDeltaRail' })
  ]
}

function createFxFuturisticPreset(theme: FxTheme): Dashboard {
  const { a: A, a2: A2, a3: A3 } = theme
  const elements: DashboardElement[] = [
    backplate(`${theme.id}Backplate`),
    fxRevRail(A, A2, `${theme.id}RevLights`),
    fxBlade(16, 68, 188, 4, A, `${theme.id}TopBladeL`),
    fxBlade(820, 68, 188, 4, A2, `${theme.id}TopBladeR`),
    fxBlade(508, 62, 8, 10, A3, `${theme.id}CenterNotch`)
  ]

  if (theme.layout === 'halo') {
    elements.push(
      fxPanel(344, 76, 336, 322, A, 'HaloCore'),
      w('gearcluster', 364, 92, 296, 246, warmStyle({ radius: 26, accentColor: A, showRpm: true, flashAt: 0.985, dangerAt: 0.88, unit: 'kmh' }), { name: 'HaloGearSpeed' }),
      ...fxBigNumber('speedKmh', 396, 338, 232, 50, '◇', WARM_WHITE, 42),
      fxPanel(18, 82, 300, 110, A, 'HaloPosShell'),
      ...fxBigNumber('position', 32, 98, 132, 74, '⚑', A, 62),
      ...fxBigNumber('incidentCount', 174, 98, 130, 74, '!', RED, 58),
      w('radar-elaborate', 704, 82, 300, 168, warmStyle({ accentColor: A2, radius: 22, maxFontSize: 30 }), { name: 'HaloRadar' }),
      w('trackmap-elaborate', 704, 262, 300, 136, warmStyle({ accentColor: A, color: MUTED, radius: 22, maxFontSize: 24 }), { binding: 'lapDistPct', name: 'HaloTrackMap' }),
      ...fxRelativeChips(18, 210, 300, 188, A, A2, 'HaloRel'),
      w('tyregrid', 18, 414, 300, 78, warmStyle({ gridMode: 'temp', title: '◉', showLabels: false, accentColor: A, maxFontSize: 22, radius: 14 }), { name: 'HaloTyres' }),
      w('deltatile', 344, 414, 336, 78, warmStyle({ title: 'Δ', deltaReference: 'session', deltaRangeSec: 1, accentColor: RED, maxFontSize: 44, radius: 14 }), { binding: 'deltaSec', name: 'HaloDelta' }),
      w('inputbars', 704, 414, 300, 78, warmStyle({ channels: ['throttle', 'brake'], accentColor: A2, radius: 14, maxFontSize: 22 }), { name: 'HaloPedals' }),
      ...fxCoreFooter(A, A2)
    )
  } else if (theme.layout === 'blade') {
    elements.push(
      fxPanel(22, 82, 372, 374, A, 'BladeGearShell'),
      warmWidget('gear-elaborate', 42, 104, 332, 240, 'FxGear', '⚙', A, { background: '#000000', maxFontSize: 188, radius: 24 }),
      ...fxBigNumber('speedKmh', 54, 354, 296, 76, '◆', WARM_WHITE, 66),
      fxPanel(418, 82, 256, 172, A2, 'BladeTrafficShell'),
      w('radar-elaborate', 432, 96, 228, 144, warmStyle({ accentColor: A2, radius: 18, maxFontSize: 28 }), { name: 'BladeRadar' }),
      fxPanel(696, 82, 306, 172, A, 'BladeStatusShell'),
      ...fxBigNumber('position', 712, 100, 134, 58, '⚑', A, 50),
      ...fxBigNumber('incidentCount', 854, 100, 132, 58, '!', RED, 50),
      w('deltatile', 712, 168, 274, 68, warmStyle({ title: 'Δ', deltaReference: 'session', deltaRangeSec: 1, accentColor: RED, maxFontSize: 42, radius: 12 }), { binding: 'deltaSec', name: 'BladeDelta' }),
      ...fxRelativeChips(418, 270, 256, 186, A, A2, 'BladeRel'),
      w('trackmap-elaborate', 696, 270, 306, 186, warmStyle({ accentColor: A, color: MUTED, radius: 18, maxFontSize: 28 }), { binding: 'lapDistPct', name: 'BladeTrack' }),
      w('tyregrid', 22, 472, 290, 106, warmStyle({ gridMode: 'pressure', title: '◉', showLabels: false, targetValue: 165, tolerance: 7, accentColor: A2, maxFontSize: 24, radius: 16 }), { name: 'BladeTyrePress' }),
      w('setupstrip', 330, 472, 360, 106, warmStyle({ fields: ['tc', 'abs', 'bb'], compact: true, accentColor: A, maxFontSize: 30, radius: 16 }), { name: 'BladeSetup' }),
      w('inputtrace', 708, 472, 294, 106, warmStyle({ channels: ['throttle', 'brake'], traceLength: 180, accentColor: A2, maxFontSize: 22, radius: 16 }), { name: 'BladeTrace' })
    )
  } else if (theme.layout === 'wing') {
    elements.push(
      w('deltatile', 28, 84, 316, 156, warmStyle({ title: 'Δ', deltaReference: 'session', deltaRangeSec: 0.8, accentColor: RED, maxFontSize: 76, radius: 20 }), { binding: 'deltaSec', name: 'WingDeltaHero' }),
      w('laptiming', 360, 84, 304, 156, warmStyle({ title: '◷', showCurrent: true, showLast: true, showBest: true, accentColor: A, maxFontSize: 44, radius: 20 }), { name: 'WingTiming' }),
      fxPanel(680, 84, 316, 156, A, 'WingRaceShell'),
      ...fxBigNumber('position', 700, 104, 136, 52, '⚑', A, 48),
      ...fxBigNumber('incidentCount', 846, 104, 130, 52, '!', RED, 48),
      ...fxBigNumber('speedKmh', 724, 166, 226, 54, '◇', WARM_WHITE, 48),
      warmWidget('gear-elaborate', 250, 258, 262, 176, 'WingGear', '⚙', A, { background: '#000000', maxFontSize: 152, radius: 22 }),
      w('radar-elaborate', 36, 258, 198, 176, warmStyle({ accentColor: A2, radius: 18, maxFontSize: 28 }), { name: 'WingRadar' }),
      w('trackmap-elaborate', 528, 258, 250, 176, warmStyle({ accentColor: A, color: MUTED, radius: 18, maxFontSize: 28 }), { binding: 'lapDistPct', name: 'WingTrack' }),
      ...fxRelativeChips(794, 258, 202, 176, A, A2, 'WingRel'),
      w('tyregrid', 28, 452, 276, 110, warmStyle({ gridMode: 'temp', title: '◉', showLabels: true, accentColor: A, maxFontSize: 24, radius: 16 }), { name: 'WingTyres' }),
      w('brakegrid', 320, 452, 164, 110, warmStyle({ title: '◌', showAverage: true, accentColor: A2, maxFontSize: 24, radius: 16 }), { name: 'WingBrakes' }),
      w('setupstrip', 500, 452, 496, 110, warmStyle({ fields: ['tc', 'abs', 'bb', 'limiter'], compact: true, accentColor: A, maxFontSize: 32, radius: 16 }), { name: 'WingSetup' })
    )
  } else if (theme.layout === 'traffic') {
    elements.push(
      fxPanel(24, 84, 388, 204, A, 'TrafficRelShell'),
      ...fxRelativeChips(42, 108, 352, 156, A, A2, 'TrafficRel'),
      w('radar-elaborate', 432, 84, 260, 292, warmStyle({ accentColor: A2, radius: 24, maxFontSize: 34 }), { name: 'TrafficRadarHero' }),
      w('trackmap-elaborate', 712, 84, 288, 160, warmStyle({ accentColor: A, color: MUTED, radius: 20, maxFontSize: 26 }), { binding: 'lapDistPct', name: 'TrafficTrack' }),
      fxPanel(712, 258, 288, 118, A, 'TrafficRaceShell'),
      ...fxBigNumber('position', 728, 276, 128, 78, '⚑', A, 62),
      ...fxBigNumber('incidentCount', 864, 276, 120, 78, '!', RED, 58),
      warmWidget('gear-elaborate', 24, 306, 188, 164, 'TrafficGear', '⚙', A, { background: '#000000', maxFontSize: 122, radius: 20 }),
      ...fxBigNumber('speedKmh', 230, 336, 174, 78, '◇', WARM_WHITE, 64),
      w('deltatile', 230, 420, 174, 50, warmStyle({ title: 'Δ', deltaReference: 'session', deltaRangeSec: 1, accentColor: RED, maxFontSize: 34, radius: 12 }), { binding: 'deltaSec', name: 'TrafficDelta' }),
      w('tyregrid', 432, 392, 260, 88, warmStyle({ gridMode: 'temp', title: '◉', showLabels: false, accentColor: A, maxFontSize: 22, radius: 16 }), { name: 'TrafficTyres' }),
      w('setupstrip', 712, 392, 288, 88, warmStyle({ fields: ['tc', 'abs', 'bb', 'limiter'], compact: true, accentColor: A2, maxFontSize: 28, radius: 16 }), { name: 'TrafficSetup' }),
      ...fxCoreFooter(A, A2, 500)
    )
  } else {
    elements.push(
      w('tyregrid', 24, 84, 330, 226, warmStyle({ gridMode: 'temp', title: '◉', showLabels: true, accentColor: A, maxFontSize: 34, radius: 22 }), { name: 'MatrixTyresHero' }),
      w('trackmap-elaborate', 670, 84, 330, 226, warmStyle({ accentColor: A, color: MUTED, radius: 22, maxFontSize: 30 }), { binding: 'lapDistPct', name: 'MatrixTrackHero' }),
      warmWidget('gear-elaborate', 380, 92, 264, 218, 'MatrixGear', '⚙', A, { background: '#000000', maxFontSize: 156, radius: 24 }),
      fxPanel(24, 328, 330, 148, A2, 'MatrixLeftStatus'),
      ...fxBigNumber('speedKmh', 44, 346, 142, 54, '◇', WARM_WHITE, 48),
      ...fxBigNumber('position', 196, 346, 132, 54, '⚑', A, 48),
      ...fxBigNumber('incidentCount', 112, 408, 144, 52, '!', RED, 48),
      w('deltatile', 380, 328, 264, 148, warmStyle({ title: 'Δ', deltaReference: 'session', deltaRangeSec: 1, accentColor: RED, maxFontSize: 72, radius: 18 }), { binding: 'deltaSec', name: 'MatrixDelta' }),
      ...fxRelativeChips(670, 328, 330, 148, A, A2, 'MatrixRel'),
      w('brakegrid', 24, 494, 186, 86, warmStyle({ title: '◌', showAverage: true, accentColor: A2, maxFontSize: 24, radius: 14 }), { name: 'MatrixBrakes' }),
      w('inputbars', 224, 494, 146, 86, warmStyle({ channels: ['throttle', 'brake'], accentColor: A, maxFontSize: 22, radius: 14 }), { name: 'MatrixInputs' }),
      w('setupstrip', 384, 494, 616, 86, warmStyle({ fields: ['tc', 'abs', 'bb', 'limiter'], compact: true, accentColor: A2, maxFontSize: 30, radius: 14 }), { name: 'MatrixSetup' })
    )
  }

  return dashboard(theme.name, 1024, 600, `${theme.concept} Graphic-first 1024×600 futuristic HUD with revlights, gear, speed, incidents, position and ahead/behind relative chips.`, elements)
}

const FX_FUTURE_THEMES: FxTheme[] = [
  { id: 'fx_neon_furnace_halo', name: 'FX Neon Furnace Halo', a: '#ff3b1f', a2: '#ff6a00', a3: '#ffb000', layout: 'halo', concept: 'Molten red/orange circular command core with radar and track sweep.', tags: ['futuristic', 'halo', 'red', 'orange', 'graphic'] },
  { id: 'fx_amber_quantum_blade', name: 'FX Amber Quantum Blade', a: '#ffb000', a2: '#ff6a00', a3: '#cc1133', layout: 'blade', concept: 'Amber blade cockpit with oversized left gear monolith.', tags: ['futuristic', 'blade', 'amber', 'graphic'] },
  { id: 'fx_vermilion_delta_wing', name: 'FX Vermilion Delta Wing', a: '#e84010', a2: '#b33000', a3: '#ffb000', layout: 'wing', concept: 'Vermilion attack wing centered on delta and lap-time geometry.', tags: ['futuristic', 'delta', 'wing', 'vermilion'] },
  { id: 'fx_copper_traffic_orbit', name: 'FX Copper Traffic Orbit', a: '#a05018', a2: '#d05010', a3: '#ffb000', layout: 'traffic', concept: 'Copper traffic-control orbit with giant radar and relative markers.', tags: ['futuristic', 'traffic', 'copper', 'radar'] },
  { id: 'fx_crimson_tyre_matrix', name: 'FX Crimson Tyre Matrix', a: '#cc1133', a2: '#e03060', a3: '#ff6a00', layout: 'matrix', concept: 'Crimson tyre matrix paired with track-map geometry.', tags: ['futuristic', 'matrix', 'tyres', 'crimson'] },
  { id: 'fx_solar_flare_halo', name: 'FX Solar Flare Halo', a: '#ff5500', a2: '#e84040', a3: '#d4a000', layout: 'halo', concept: 'Solar-flare halo with intense warm chrome and clear center cluster.', tags: ['futuristic', 'halo', 'solar', 'orange'] },
  { id: 'fx_bronze_vector_blade', name: 'FX Bronze Vector Blade', a: '#8a6018', a2: '#a05018', a3: '#d4a000', layout: 'blade', concept: 'Bronze vector slabs with big numeric readouts and map/radar modules.', tags: ['futuristic', 'blade', 'bronze', 'vector'] },
  { id: 'fx_cherry_apex_wing', name: 'FX Cherry Apex Wing', a: '#cc2040', a2: '#e03060', a3: '#ff4040', layout: 'wing', concept: 'Cherry apex wing: delta-first sprint HUD with symbol-heavy telemetry.', tags: ['futuristic', 'wing', 'cherry', 'sprint'] },
  { id: 'fx_tangerine_radar_lock', name: 'FX Tangerine Radar Lock', a: '#ff6000', a2: '#d05010', a3: '#ffb000', layout: 'traffic', concept: 'Tangerine radar-lock traffic display with paired relative chips.', tags: ['futuristic', 'traffic', 'tangerine', 'radar'] },
  { id: 'fx_deep_gold_matrix', name: 'FX Deep Gold Matrix', a: '#c49000', a2: '#e09000', a3: '#ff6000', layout: 'matrix', concept: 'Deep-gold matrix for tyre/track awareness and quick setup scanning.', tags: ['futuristic', 'matrix', 'gold', 'tyres'] },
  { id: 'fx_rose_ion_halo', name: 'FX Rose Ion Halo', a: '#e03060', a2: '#ff4040', a3: '#ff6a00', layout: 'halo', concept: 'Rose ion halo with compact traffic, tyres and pedal graphics.', tags: ['futuristic', 'halo', 'rose', 'graphic'] },
  { id: 'fx_brick_orbital_blade', name: 'FX Brick Orbital Blade', a: '#b33000', a2: '#c04010', a3: '#e09000', layout: 'blade', concept: 'Brick-red orbital blade with large gear slab and track-map panel.', tags: ['futuristic', 'blade', 'brick', 'trackmap'] },
  { id: 'fx_gold_delta_wing', name: 'FX Gold Delta Wing', a: '#d4a000', a2: '#ff6000', a3: '#cc1133', layout: 'wing', concept: 'Gold delta wing balancing lap attack, radar and setup controls.', tags: ['futuristic', 'wing', 'gold', 'delta'] },
  { id: 'fx_mahogany_traffic_grid', name: 'FX Mahogany Traffic Grid', a: '#8b2000', a2: '#b33000', a3: '#d4a000', layout: 'traffic', concept: 'Mahogany traffic grid with radar as the dominant spatial instrument.', tags: ['futuristic', 'traffic', 'mahogany', 'radar'] },
  { id: 'fx_coral_synapse_matrix', name: 'FX Coral Synapse Matrix', a: '#ff4040', a2: '#e84010', a3: '#ffb000', layout: 'matrix', concept: 'Coral synapse matrix: tyres, map, delta and relative chips in blocks.', tags: ['futuristic', 'matrix', 'coral', 'synapse'] },
  { id: 'fx_rust_reactor_halo', name: 'FX Rust Reactor Halo', a: '#c04010', a2: '#a05018', a3: '#d4a000', layout: 'halo', concept: 'Rust reactor halo with molten segmented meters and clean big numerals.', tags: ['futuristic', 'halo', 'rust', 'reactor'] },
  { id: 'fx_dark_amber_blade', name: 'FX Dark Amber Blade', a: '#e09000', a2: '#8a6018', a3: '#ff3b1f', layout: 'blade', concept: 'Dark-amber blade layout with wide speed and relative traffic markers.', tags: ['futuristic', 'blade', 'amber', 'minimal-text'] },
  { id: 'fx_flame_vector_wing', name: 'FX Flame Vector Wing', a: '#e84040', a2: '#ff5500', a3: '#ffb000', layout: 'wing', concept: 'Flame vector wing for sprint racing with delta, radar and track sweep.', tags: ['futuristic', 'wing', 'flame', 'sprint'] },
  { id: 'fx_terracotta_lockon', name: 'FX Terracotta Lock-On', a: '#b04010', a2: '#c04010', a3: '#e09000', layout: 'traffic', concept: 'Terracotta lock-on display with traffic chips, radar and fast race state.', tags: ['futuristic', 'traffic', 'terracotta', 'lockon'] },
  { id: 'fx_lava_pulse_matrix', name: 'FX Lava Pulse Matrix', a: '#ff6a00', a2: '#ff3b1f', a3: '#ffb000', layout: 'matrix', concept: 'Lava pulse matrix with tyre/map symmetry and oversized mandatory values.', tags: ['futuristic', 'matrix', 'lava', 'graphic'] }
]

// ── WS-5 typographic showcase presets ─────────────────────────────────────────
// Three production-grade racing HUDs, each built on a DISTINCT self-hosted font
// pairing and a distinct layout + warm colour identity, all on the new fill
// engine so every primary numeral grows to fill its tile. Warm chrome throughout;
// cool/green is reserved for "good" states (delta ahead, healthy shift LEDs).

// Preset A — "Apex GT": Chakra Petch display + Saira Condensed numerals. Crimson
// chrome, classic centre-gear DDU symmetry. Balanced, authoritative.
function createApexGtPreset(): Dashboard {
  const A = CRIMSON
  const elements: DashboardElement[] = [
    w('rect', 0, 0, 1024, 600, warmStyle({ background: '#050405', borderWidth: 0, radius: 0 }), { name: 'ApexGtBackplate' }),
    w('shiftbar', 16, 14, 992, 40, warmStyle({ segments: 26, flashAt: 0.98, warnAt: 0.6, dangerAt: 0.84, glow: true, segmentShape: 'led', fillColor: GREEN, warnColor: AMBER, dangerColor: RED, accentColor: A, radius: 6 }), { binding: 'shiftPct', name: 'ApexShift' }),
    warmWidget('speed-clean', 16, 64, 232, 200, 'Speed', 'SPEED', WARM_WHITE, { accentColor: A, maxFontSize: 150 }),
    warmWidget('gear-elaborate', 372, 64, 280, 200, 'Gear', 'GEAR', WARM_WHITE, { accentColor: A, background: '#0B0507', maxFontSize: 210 }),
    warmWidget('rpm-clean', 776, 64, 232, 200, 'Rpm', 'RPM', ORANGE, { accentColor: A, maxFontSize: 130 }),
    warmWidget('position-clean', 16, 276, 232, 150, 'Position', 'POS', AMBER, { accentColor: A, maxFontSize: 100 }),
    warmWidget('delta-elaborate', 264, 276, 496, 150, 'Delta', 'PREDICTIVE DELTA', RED, { accentColor: A, deltaRangeSec: 1, maxFontSize: 120 }, 'deltaSec'),
    warmWidget('flags-clean', 776, 276, 232, 150, 'Flags', 'FLAGS', AMBER, { accentColor: A, maxFontSize: 84 }),
    w('fuelstint', 16, 438, 300, 146, warmStyle({ title: 'FUEL STINT', reserveLaps: 2, warnAtLaps: 3, accentColor: A, maxFontSize: 100 }), { name: 'ApexFuel' }),
    warmWidget('tyres-elaborate', 332, 438, 360, 146, 'Tyres', 'TYRES', ORANGE, { accentColor: A, maxFontSize: 60 }),
    warmWidget('relatives-elaborate', 708, 438, 300, 146, 'Relatives', 'TRAFFIC', AMBER, { accentColor: A, maxFontSize: 44 })
  ]
  return dashboard('Apex GT', 1024, 600, 'Typographic showcase A — Chakra Petch headers over Saira Condensed numerals in a crimson, centre-gear GT3 DDU. Every readout grows to fill its tile via the new fit engine; cool/green only appears on healthy shift LEDs and a faster predictive delta.', applyFonts(elements, FONT_SAIRA, FONT_CHAKRA))
}

// Preset B — "Neon Circuit": Oxanium display + Teko numerals. Vermilion/tangerine
// neon, deliberately ASYMMETRIC — a dominant predictive-delta slab on the left,
// offset gear, pedal-trace and radar. Aggressive, arcade-tech.
function createNeonCircuitPreset(): Dashboard {
  const A = VERML
  const A2 = TANGER
  const elements: DashboardElement[] = [
    w('rect', 0, 0, 1024, 600, warmStyle({ background: '#070404', borderWidth: 0, radius: 0 }), { name: 'NeonBackplate' }),
    w('shiftbar', 20, 16, 984, 44, warmStyle({ segments: 32, flashAt: 0.985, warnAt: 0.62, dangerAt: 0.85, glow: true, segmentShape: 'led', fillColor: GREEN, warnColor: AMBER, dangerColor: RED, accentColor: A2, radius: 999 }), { binding: 'shiftPct', name: 'NeonShift' }),
    w('deltatile', 20, 76, 420, 200, warmStyle({ title: 'PREDICTIVE DELTA', deltaReference: 'session', deltaRangeSec: 0.8, accentColor: A, maxFontSize: 160 }), { binding: 'deltaSec', name: 'NeonDelta' }),
    warmWidget('gear-elaborate', 470, 76, 250, 200, 'Gear', 'GEAR', WARM_WHITE, { accentColor: A2, background: '#0A0505', maxFontSize: 200 }),
    warmWidget('speed-clean', 740, 76, 130, 96, 'Speed', 'SPD', WARM_WHITE, { accentColor: A2, maxFontSize: 84 }),
    warmWidget('rpm-clean', 884, 76, 120, 96, 'Rpm', 'RPM', ORANGE, { accentColor: A2, maxFontSize: 72 }),
    warmWidget('radar-clean', 740, 188, 264, 88, 'Radar', 'RADAR', RED, { accentColor: A, maxFontSize: 30 }),
    warmWidget('inputs-elaborate', 20, 290, 420, 150, 'Inputs', 'PEDAL TRACE', A2, { channels: ['throttle', 'brake'], traceLength: 180, accentColor: A2, maxFontSize: 40 }),
    w('laptiming', 470, 290, 250, 150, warmStyle({ title: 'LAP STACK', showCurrent: true, showLast: true, showBest: true, showEstimated: true, accentColor: A2, maxFontSize: 42 }), { name: 'NeonLaps' }),
    warmWidget('trackmap-elaborate', 740, 290, 264, 150, 'TrackMap', 'TRACK', A2, { accentColor: A2, color: MUTED, maxFontSize: 34 }),
    warmWidget('tyres-clean', 20, 452, 232, 132, 'Tyres', 'TYRES', ORANGE, { accentColor: A, maxFontSize: 48 }),
    warmWidget('temps-clean', 264, 452, 200, 132, 'Engine', 'ENGINE', A2, { accentColor: A2, maxFontSize: 40 }),
    warmWidget('relatives-elaborate', 476, 452, 300, 132, 'Relatives', 'TRAFFIC', AMBER, { accentColor: A, maxFontSize: 40 }),
    warmWidget('flags-clean', 788, 452, 216, 132, 'Flags', 'FLAGS', AMBER, { accentColor: A2, maxFontSize: 64 })
  ]
  return dashboard('Neon Circuit', 1024, 600, 'Typographic showcase B — Oxanium headers over Teko numerals in an asymmetric vermilion/tangerine neon layout: a dominant predictive-delta slab, offset gear, pedal-trace, radar and traffic. Big fill-engine readouts; cool/green only for a faster delta and healthy shift LEDs.', applyFonts(elements, FONT_TEKO, FONT_OXANIUM))
}

// Preset C — "Classic Tach": Orbitron display + Rajdhani numerals. Warm gold /
// dark-amber vintage instrument feel built around a big analog rev dial, with
// generous editorial spacing. Distinct from the two flat DDU layouts above.
function createClassicTachPreset(): Dashboard {
  const A = GOLD_W
  const A2 = DKAMBER
  const elements: DashboardElement[] = [
    w('rect', 0, 0, 1024, 600, warmStyle({ background: '#080602', borderWidth: 0, radius: 0 }), { name: 'TachBackplate' }),
    w('shiftbar', 24, 18, 976, 30, warmStyle({ segments: 22, flashAt: 0.98, warnAt: 0.62, dangerAt: 0.85, glow: true, segmentShape: 'bar', fillColor: GREEN, warnColor: AMBER, dangerColor: RED, accentColor: A, radius: 4 }), { binding: 'shiftPct', name: 'TachShift' }),
    warmWidget('rpm-elaborate', 24, 68, 376, 376, 'Rpm', 'RPM', A, { accentColor: A, maxFontSize: 150 }),
    warmWidget('gear-elaborate', 424, 68, 300, 260, 'Gear', 'GEAR', WARM_WHITE, { accentColor: A2, background: '#0A0702', maxFontSize: 230 }),
    warmWidget('speed-clean', 748, 68, 252, 124, 'Speed', 'SPEED', WARM_WHITE, { accentColor: A, maxFontSize: 100 }),
    warmWidget('delta-elaborate', 748, 208, 252, 140, 'Delta', 'DELTA', RED, { accentColor: A2, deltaRangeSec: 1, maxFontSize: 96 }, 'deltaSec'),
    warmWidget('position-clean', 424, 344, 150, 100, 'Position', 'POS', A2, { accentColor: A2, maxFontSize: 76 }),
    warmWidget('flags-clean', 590, 344, 134, 100, 'Flags', 'FLAGS', A, { accentColor: A, maxFontSize: 60 }),
    w('fuelstint', 24, 460, 360, 124, warmStyle({ title: 'FUEL', reserveLaps: 1, warnAtLaps: 2, accentColor: A, maxFontSize: 84 }), { name: 'TachFuel' }),
    w('laptiming', 400, 460, 360, 124, warmStyle({ title: 'TIMING', showCurrent: true, showLast: true, showBest: true, accentColor: A2, maxFontSize: 38 }), { name: 'TachLaps' }),
    warmWidget('temps-clean', 776, 460, 224, 124, 'Engine', 'ENGINE', A2, { accentColor: A2, maxFontSize: 38 })
  ]
  return dashboard('Classic Tach', 1024, 600, 'Typographic showcase C — Orbitron headers over Rajdhani numerals in a warm gold/amber vintage instrument layout anchored by a large analog rev dial with editorial spacing. Fill-engine readouts throughout; cool/green only for a faster delta and healthy shift LEDs.', applyFonts(elements, FONT_RAJDHANI, FONT_ORBITRON))
}

// ─── WS-DASH: full-frame dashboards embedded from the overlay-widget library ───
// gridStackDash / gridProDash / bosch296Dash / ringDash / lmuEnduranceDash /
// lmuStintDash are self-contained, telemetry-driven FULL-SCREEN panels. They ship
// as overlay-widget COMPONENTS (kept in WIDGET_COMPONENTS) but belong in the
// DASHBOARDS system, not the floating-overlay picker — so each is wrapped here as
// a Dashboard with a single `overlaywidget` element that fills the canvas and
// carries the widget id. DashboardRoot resolves WIDGET_COMPONENTS[widgetId] and
// mounts it with the live snapshot. The native authoring canvas is the standard
// 1024×600 surface, so the element is identity-mapped to fill it 1:1.
function overlayWidgetDashboard(name: string, widgetId: OverlayWidgetId, description: string, scaleMode: DashboardScaleMode = 'fit'): Dashboard {
  const el: DashboardElement = {
    ...w('overlaywidget', 0, 0, TARGET_W, TARGET_H, style({ background: '#000000', borderWidth: 0, radius: 0 }), { name }),
    widgetId
  }
  return { ...dashboard(name, TARGET_W, TARGET_H, description, [el]), scaleMode }
}

// Canonical preset-id ↔ widget-id ↔ metadata table for the six embedded
// dashboards. Spread into BUILTIN_PRESETS below and re-exported so callers/tests
// can map a preset id to its widget id without rebuilding the dashboards.
export const OVERLAY_DASHBOARD_PRESETS: Array<{
  id: string
  name: string
  widgetId: OverlayWidgetId
  description: string
  tags: string[]
  scaleMode?: DashboardScaleMode
}> = [
  {
    id: 'grid_stack_dash',
    name: 'GT3 — Grid (SimHub)',
    widgetId: 'gridStackDash',
    description:
      'Full-screen SimHub-style replica: tile grid with colored borders, gear + shift bar, map, LL/SB/PB, and fuel group.',
    tags: ['gt3', 'dashboard', 'fullscreen']
  },
  {
    id: 'grid_pro_dash',
    name: 'GT3 — Pro (neon)',
    widgetId: 'gridProDash',
    description:
      'Full-screen GRID/Bosch-style replica: neon tiles, tire temps, fuel/temps column, central RPM/gear/SPEED, car ahead/behind, and status line.',
    tags: ['gt3', 'dashboard', 'fullscreen']
  },
  {
    id: 'bosch_296_dash',
    name: 'GT3 — Bosch 296',
    widgetId: 'bosch296Dash',
    description:
      'Full-screen Bosch Motorsport 296-style replica: RPM bar, central gear with tell-tales, 2?2 pressure/temperature grids, and status banner.',
    tags: ['gt3', 'dashboard', 'fullscreen']
  },
  {
    id: 'ring_dash',
    name: 'GT3 — Anel circular',
    widgetId: 'ringDash',
    description:
      'Full-screen Vantage-style replica: circular gear with RPM ring, PIT/FCY, fuel/speed/water + last/best columns, 2?2 tires, and a row of colored coins.',
    tags: ['gt3', 'dashboard', 'fullscreen']
  },
  {
    id: 'lmu_endurance_dash',
    name: 'LMU — Endurance',
    widgetId: 'lmuEnduranceDash',
    description:
      'Le Mans Ultimate-style engineer screen (endurance/MoTeC): tire+brake temps, gear/RPM/speed, last/best/delta, gap, and fuel/stint strip. Works in any sim that provides the data.',
    tags: ['lmu', 'dashboard', 'fullscreen']
  },
  {
    id: 'lmu_stint_dash',
    name: 'LMU — Stint/Fuel',
    widgetId: 'lmuStintDash',
    description:
      'Le Mans Ultimate-style strategy board: fuel remaining + laps to empty + fuel/lap, stint timer, tire wear, weather, and gaps. Works in any sim that provides the data.',
    tags: ['lmu', 'dashboard', 'fullscreen']
  },
  {
    id: 'racecon_rc01_dash',
    name: 'RaceCon RC-01 Apex Strike',
    widgetId: 'raceconRc01Dash',
    description:
      'Full-screen RC-01 live telemetry dashboard: gear-aware shift bars, fresh channel status, timing trace, tyre temperatures, and fail-closed alerts.',
    tags: ['racecon', 'dashboard', 'fullscreen', 'telemetry'],
    scaleMode: 'stretch'
  },
  {
    id: 'racecon_rc02_dash',
    name: 'RaceCon RC-02 Purple Lap',
    widgetId: 'raceconRc02Dash',
    description:
      'Full-screen RC-02 one-lap qualifying dashboard: a bidirectional delta spine, measured sector deltas, source-bound predicted lap, personal-best pace accent and tyre build-up.',
    tags: ['racecon', 'dashboard', 'fullscreen', 'qualifying'],
    scaleMode: 'stretch'
  },
  {
    id: 'racecon_rc04_dash',
    name: 'RaceCon RC-04 Box Now',
    widgetId: 'raceconRc04Dash',
    description:
      'Full-screen RC-04 pit entry, stop and exit sequence: a five-step phase ribbon, a dominant pit-speed-versus-limit safety bar, limiter state, crew service status and one imperative action line, with state-gated pit alerts.',
    tags: ['racecon', 'dashboard', 'fullscreen', 'pit'],
    scaleMode: 'stretch'
  },
  {
    id: 'racecon_rc05_dash',
    name: 'RaceCon RC-05 Thermal Window',
    widgetId: 'raceconRc05Dash',
    description:
      'Full-screen RC-05 tyre thermal dashboard: a four-corner radial temperature and pressure mandala with computed window bands, a centre delta linking pace to tyre care, TC and brake-temp minis, a measured per-lap trend column and per-corner window alerts.',
    tags: ['racecon', 'dashboard', 'fullscreen', 'tyres'],
    scaleMode: 'stretch'
  },
  {
    id: 'racecon_rc06_dash',
    name: 'RaceCon RC-06 Save Mode',
    widgetId: 'raceconRc06Dash',
    description:
      'Full-screen RC-06 fuel-save strategy ledger: engineer target versus measured burn in two columns, a signed running balance hero with arrow and sign, the time cost of saving, a computed lift-and-coast track and per-lap budget-deviation alerts.',
    tags: ['racecon', 'dashboard', 'fullscreen', 'fuel', 'strategy'],
    scaleMode: 'stretch'
  },
  {
    id: 'racecon_rc07_dash',
    name: 'RaceCon RC-07 Blue Flags',
    widgetId: 'raceconRc07Dash',
    description:
      'Full-screen RC-07 multiclass awareness display: a proximity radar whose blip radii are computed from each contact\u2019s own distance, class-coded gap-behind and gap-ahead panels with direction-only closing glyphs, a fail-closed flag ribbon that never assumes green, and blue-flag, fast-closing and imminent-proximity alerts.',
    tags: ['racecon', 'dashboard', 'fullscreen', 'traffic', 'radar'],
    scaleMode: 'stretch'
  },
  {
    id: 'hifi_ddu_cockpit',
    name: 'GT3 — DDU Cockpit (hi-fi)',
    widgetId: 'hifiDdu',
    description:
      'Photorealistic GT3 DDU cluster: shift-LED arc, huge gear, speed/RPM step bar, live delta, 4-corner tyre grid, TC/ABS/brake-bias and oil/water/oil-press/battery vitals. 1024×600, scales to any screen.',
    tags: ['gt3', 'dashboard', 'fullscreen', 'hifi', '1024x600']
  },
  {
    id: 'hifi_endurance',
    name: 'Endurance — Stint (hi-fi)',
    widgetId: 'hifiEndurance',
    description:
      'Endurance/IMSA prototype dash: ERS deploy, current lap + delta, fuel remaining and laps-to-empty, stint panel, 4-corner tyre + brake temperature matrix with car pictogram, position and gaps. 1024×600, adaptive.',
    tags: ['endurance', 'prototype', 'dashboard', 'fullscreen', 'hifi', '1024x600']
  },
  {
    id: 'hifi_engineer',
    name: 'Engineer — MoTeC Analysis (hi-fi)',
    widgetId: 'hifiEngineer',
    description:
      'MoTeC-style engineer screen: live multi-channel speed/throttle/brake traces, gear-step trace, G-G diagram, sector and lap-time tables, min/max/avg and a per-corner tyre-temperature strip. 1024×600, adaptive.',
    tags: ['engineer', 'motec', 'analysis', 'dashboard', 'fullscreen', 'hifi', '1024x600']
  },
  {
    id: 'hifi_minimal',
    name: 'GT3 — Minimal (hi-fi)',
    widgetId: 'hifiMinimal',
    description:
      'Minimal, elegant GT3 dash: slim shift-LED line, one huge gear digit, speed, a thin live delta bar and three quiet tiles (fuel laps, lap, position). Lots of negative space. 1024×600, adaptive.',
    tags: ['gt3', 'minimal', 'dashboard', 'fullscreen', 'hifi', '1024x600']
  },
  {
    id: 'hifi_broadcast',
    name: 'Broadcast — Standings (hi-fi)',
    widgetId: 'hifiBroadcast',
    description:
      'TV broadcast/stream overlay: top timing bug (current/last lap + delta), leader/gap chip, purple fastest-lap banner and an 8-row standings strip with car numbers, class colours and gaps. 1024×600, adaptive.',
    tags: ['broadcast', 'stream', 'standings', 'dashboard', 'fullscreen', 'hifi', '1024x600']
  }
]

function withDefaultPresetPriority(presets: DashboardPreset[]): DashboardPreset[] {
  return presets.map((preset) => ({
    ...preset,
    priority: preset.priority ?? DEFAULT_DASHBOARD_PRESET_PRIORITY
  }))
}

function withPresetReleaseCohort(
  presets: DashboardPreset[],
  catalogOrder: number,
  releasedAt: string
): DashboardPreset[] {
  return presets.map((preset) => ({
    ...preset,
    catalogOrder,
    releasedAt,
    tags: [...new Set([...(preset.tags ?? []), RELEASE_A_TAG])]
  }))
}

export const BUILTIN_PRESETS: DashboardPreset[] = withDefaultPresetPriority([
  ...withPresetReleaseCohort(
    GT3_DENSE_50_PRESETS,
    RELEASE_A_CATALOG_ORDER,
    RELEASE_A_RELEASED_AT
  ),
  // ── WS-5 cross-agent: adaptive dashboard preset (owned by the adaptive agent) ──
  { id: ADAPTIVE_DASHBOARD_ID, name: ADAPTIVE_DASHBOARD_PRESET.name, build: createAdaptiveDashboardPreset, tags: [...ADAPTIVE_DASHBOARD_TAGS] },
  // ── WS-5 typographic showcase presets (offline self-hosted font families) ──
  { id: 'apex_gt_chakra', name: 'Apex GT · Chakra/Saira · 1024×600', build: createApexGtPreset, tags: ['WS5', 'apex', 'GT3', 'chakra-petch', 'saira', 'crimson', 'fill', 'race', 'motorsport'] },
  { id: 'neon_circuit_oxanium', name: 'Neon Circuit · Oxanium/Teko · 1024×600', build: createNeonCircuitPreset, tags: ['WS5', 'neon', 'oxanium', 'teko', 'vermilion', 'delta', 'radar', 'fill', 'race', 'motorsport'] },
  { id: 'classic_tach_orbitron', name: 'Classic Tach · Orbitron/Rajdhani · 1024×600', build: createClassicTachPreset, tags: ['WS5', 'classic', 'orbitron', 'rajdhani', 'gold', 'analog', 'tach', 'fill', 'motorsport'] },
  // ── WS-DASH: full-frame dashboards moved out of the floating-overlay picker ──
  // Each wraps ONE registered overlay widget (WIDGET_COMPONENTS[widgetId]) as a
  // single full-canvas `overlaywidget` element (see overlayWidgetDashboard).
  ...OVERLAY_DASHBOARD_PRESETS.map((preset) => ({
    id: preset.id,
    name: `${preset.name} · ${TARGET_W}×${TARGET_H}`,
    build: (): Dashboard => overlayWidgetDashboard(preset.name, preset.widgetId, preset.description, preset.scaleMode),
    tags: preset.tags
  })),
  // ── Dense recreations (gold-standard correct info: tyres, incidents, relatives, delta, fuel) ──
  { id: 'gt3_cup_ddu_fuel', name: 'GT3 Cup DDU · Fuel · 1024×600', build: createGt3CupDduFuelPreset, tags: ['GT3', 'cup', 'DDU', 'dense', 'fuel', 'tyres', 'race', 'motorsport'] },
  { id: 'gt3_cup_ddu_trackmap', name: 'GT3 Cup DDU · Track Map · 1024×600', build: createGt3CupDduTrackmapPreset, tags: ['GT3', 'cup', 'DDU', 'dense', 'trackmap', 'relatives', 'race', 'motorsport'] },
  { id: 'gt3_cup_ddu_tyres', name: 'GT3 Cup DDU · Tyres · 1024×600', build: createGt3CupDduTyresPreset, tags: ['GT3', 'cup', 'DDU', 'dense', 'tyres', 'brakes', 'race', 'motorsport'] },
  { id: 'gt3_cup_ddu_relatives', name: 'GT3 Cup DDU · Relatives · 1024×600', build: createGt3CupDduRelativesPreset, tags: ['GT3', 'cup', 'DDU', 'dense', 'relatives', 'traffic', 'race', 'motorsport'] },
  { id: 'gt3_cup_ddu_inputs', name: 'GT3 Cup DDU · Inputs · 1024×600', build: createGt3CupDduInputsPreset, tags: ['GT3', 'cup', 'DDU', 'dense', 'inputs', 'trace', 'race', 'motorsport'] },
  { id: 'gt3_cup_ddu_standings', name: 'GT3 Cup DDU · Standings · 1024×600', build: createGt3CupDduStandingsPreset, tags: ['GT3', 'cup', 'DDU', 'dense', 'standings', 'race', 'motorsport'] },
  { id: 'gt3_cup_ddu_engine', name: 'GT3 Cup DDU · Engine · 1024×600', build: createGt3CupDduEnginePreset, tags: ['GT3', 'cup', 'DDU', 'dense', 'engine', 'temps', 'race', 'motorsport'] },
  { id: 'gt3_cup_ddu_radar', name: 'GT3 Cup DDU · Radar · 1024×600', build: createGt3CupDduRadarPreset, tags: ['GT3', 'cup', 'DDU', 'dense', 'radar', 'trackmap', 'race', 'motorsport'] },
  { id: 'gt3_cup_ddu_brakes', name: 'GT3 Cup DDU · Brakes · 1024×600', build: createGt3CupDduBrakesPreset, tags: ['GT3', 'cup', 'DDU', 'dense', 'brakes', 'tyres', 'race', 'motorsport'] },
  { id: 'grid_dense_ddu', name: 'GRID Dense DDU · 1024×600', build: createGridDenseDduPreset, tags: ['GT3', 'DDU', 'dense', 'tyres', 'relatives', 'incidents', 'delta', 'race', 'motorsport'] },
  { id: 'acc_style_full', name: 'ACC Style Full · 1024×600', build: createAccStyleFullPreset, tags: ['GT3', 'ACC', 'dense', 'tyres', 'delta', 'fuel', 'race', 'motorsport'] },
  { id: 'acc_default', name: 'ACC Default · 1024×600', build: createAccDefaultPreset, tags: ['GT3', 'ACC', 'dense', 'tyres', 'laptimes', 'relatives', 'race', 'motorsport'] },
  { id: 'compact_hud', name: 'Compact HUD · 1024×600', build: createCompactHudPreset, tags: ['HUD', 'compact', 'minimal', 'gauge', 'motorsport'] },
  // ── Existing library (now normalised to 1024×600) ──
  { id: 'spotter_race', name: 'Spotter / Race · 1024×600', build: createSpotterRacePreset, tags: ['spotter', 'race', 'minimal', 'radar', 'relatives', 'clean', 'motorsport'] },
  { id: 'porsche_cup_wide', name: 'Porsche Cup Wide · 1024×600', build: createPorscheCupPreset, tags: ['porsche', 'cup', 'wide', 'clean', 'minimal', 'motorsport'] },
  { id: 'mercedes_amg_compact', name: 'Mercedes-AMG Compact · 1024×600', build: createMercedesAmgPreset, tags: ['mercedes', 'amg', 'GT3', 'compact', 'clean', 'minimal', 'motorsport'] },
  { id: 'ferrari_gt3', name: 'Ferrari GT3 · 1024×600', build: createFerrariGt3Preset, tags: ['ferrari', 'GT3', 'clean', 'minimal', 'motorsport'] },
  { id: 'bosch_ddu_gt3', name: 'Bosch DDU GT3 · 1024×600', build: createGt3EnduranceClusterPreset, tags: ['GT3', 'Bosch', 'endurance', 'motorsport'] },
  { id: 'aim_mxg', name: 'AiM MXG · 1024×600', build: createAimColorfulPreset, tags: ['GT3', '7 inch', 'dense', 'motorsport'] },
  { id: 'mclaren_minimal', name: 'McLaren Minimal · 1024×600', build: createMinimalDarkPreset, tags: ['wheel', 'minimal', 'motorsport'] },
  { id: 'formula', name: 'Formula Wheel · 1024×600', build: createFormulaPreset, tags: ['formula', 'wheel', 'motorsport'] },
  { id: 'endurance', name: 'Endurance DDU · 1024×600', build: createEndurancePreset, tags: ['endurance', '7 inch', 'DDU', 'motorsport'] },
  { id: 'gt3_race_warm', name: 'GT3 Race Warm · 1024×600', build: createGt3RaceWarmPreset, tags: ['GT3', 'warm', 'dense', 'race', 'motorsport'] },
  { id: 'endurance_ddu_warm', name: 'Endurance DDU Warm · 1024×600', build: createEnduranceDduWarmPreset, tags: ['endurance', 'warm', 'DDU', 'dense', 'motorsport'] },
  { id: 'clean_minimal_red', name: 'Clean Minimal Red · 1024×600', build: createCleanMinimalRedPreset, tags: ['minimal', 'warm', 'red', 'wheel', 'motorsport'] },
  { id: 'qualy_clean_warm', name: 'Qualy Clean Warm · 1024×600', build: createQualyCleanWarmPreset, tags: ['qualy', 'warm', 'clean', 'motorsport'] },
  { id: 'relatives_radar_warm', name: 'Relatives + Radar Warm · 1024×600', build: createRelativesRadarWarmPreset, tags: ['traffic', 'warm', 'radar', 'race', 'motorsport'] },
  { id: 'tyres_brakes_warm', name: 'Tyres & Brakes Warm · 1024×600', build: createTyresBrakesWarmPreset, tags: ['tyres', 'brakes', 'warm', 'engineering', 'motorsport'] },
  { id: 'apex_night_stint', name: 'Apex Night Stint · 1024×600', build: createApexNightStintPreset, tags: ['GT3', 'endurance', 'night', 'fuel', 'stint', 'warm', 'motorsport'] },
  { id: 'redline_qualy_attack', name: 'Redline Qualy Attack · 1024×600', build: createRedlineQualyAttackPreset, tags: ['GT3', 'qualy', 'delta', 'sprint', 'warm', 'motorsport'] },
  { id: 'tyre_window_engineer', name: 'Tyre Window Engineer · 1024×600', build: createTyreWindowEngineerPreset, tags: ['GT3', 'tyres', 'brakes', 'engineering', 'warm', 'motorsport'] },
  { id: 'delta_focus_square', name: 'Delta Focus · 1024×600', build: createDeltaFocusSquarePreset, tags: ['GT3', 'minimal', 'delta', 'warm', 'motorsport'] },
  { id: 'traffic_attack_compact', name: 'Traffic Attack Compact · 1024×600', build: createTrafficAttackCompactPreset, tags: ['GT3', 'traffic', 'radar', 'race', 'warm', 'motorsport'] },
  // ── 20 colour-variant presets ──────────────────────────────────────────────
  { id: 'np_crimson_tyres', name: 'NP Crimson · Tyres · 1024×600', build: createNpCrimsonTyresPreset, tags: ['DDU', 'crimson', 'tyres', 'race', 'motorsport'] },
  { id: 'np_scarlet_relatives', name: 'NP Scarlet · Radar · 1024×600', build: createNpScarletRelativesPreset, tags: ['DDU', 'scarlet', 'radar', 'relatives', 'race', 'motorsport'] },
  { id: 'np_vermilion_brakes', name: 'NP Vermilion · Brakes · 1024×600', build: createNpVermilionBrakesPreset, tags: ['DDU', 'vermilion', 'brakes', 'race', 'motorsport'] },
  { id: 'np_tangerine_delta', name: 'NP Tangerine · Delta · 1024×600', build: createNpTangerineDeltaPreset, tags: ['DDU', 'tangerine', 'delta', 'race', 'motorsport'] },
  { id: 'np_gold_fuel', name: 'NP Gold · Fuel · 1024×600', build: createNpGoldFuelPreset, tags: ['DDU', 'gold', 'fuel', 'race', 'motorsport'] },
  { id: 'np_rose_inputs', name: 'NP Rose · Inputs · 1024×600', build: createNpRoseInputsPreset, tags: ['DDU', 'rose', 'inputs', 'trace', 'race', 'motorsport'] },
  { id: 'np_rust_standings', name: 'NP Rust · Standings · 1024×600', build: createNpRustStandingsPreset, tags: ['DDU', 'rust', 'standings', 'race', 'motorsport'] },
  { id: 'np_copper_radar', name: 'NP Copper · Radar · 1024×600', build: createNpCopperRadarPreset, tags: ['DDU', 'copper', 'radar', 'tyres', 'race', 'motorsport'] },
  { id: 'np_brick_corners', name: 'NP Brick · Corners · 1024×600', build: createNpBrickCornersPreset, tags: ['DDU', 'brick', 'corners', 'brakes', 'race', 'motorsport'] },
  { id: 'np_maroon_trackmap', name: 'NP Maroon · Track Map · 1024×600', build: createNpMaroonTrackmapPreset, tags: ['DDU', 'maroon', 'trackmap', 'fuel', 'race', 'motorsport'] },
  { id: 'np_amber_wide_center', name: 'NP Amber Wide Center · 1024×600', build: createNpAmberWideCenterPreset, tags: ['amber', 'wide', 'gear', 'relatives', 'warm', 'motorsport'] },
  { id: 'np_sunset_race', name: 'NP Sunset Race · 1024×600', build: createNpSunsetRacePreset, tags: ['sunset', 'flame', 'race', 'radar', 'trackmap', 'warm', 'motorsport'] },
  { id: 'np_cherry_cluster', name: 'NP Cherry Cluster · 1024×600', build: createNpCherryClusterPreset, tags: ['cherry', 'cluster', 'tyres', 'relatives', 'warm', 'motorsport'] },
  { id: 'np_autumn_band', name: 'NP Autumn Band · 1024×600', build: createNpAutumnBandPreset, tags: ['autumn', 'band', 'delta', 'tyres', 'warm', 'motorsport'] },
  { id: 'np_bronze_hud', name: 'NP Bronze HUD · 1024×600', build: createNpBronzeHudPreset, tags: ['bronze', 'HUD', 'trackmap', 'relatives', 'warm', 'motorsport'] },
  { id: 'np_terracotta_race', name: 'NP Terracotta Race · 1024×600', build: createNpTerracottaRacePreset, tags: ['terracotta', 'rust', 'race', 'radar', 'trackmap', 'warm', 'motorsport'] },
  { id: 'np_deep_gold_dense', name: 'NP Deep Gold Dense · 1024×600', build: createNpDeepGoldDensePreset, tags: ['gold', 'dense', 'radar', 'trackmap', 'warm', 'motorsport'] },
  { id: 'np_flame_race_dense', name: 'NP Flame Race Dense · 1024×600', build: createNpFlameRaceDensePreset, tags: ['flame', 'crimson', 'dense', 'tyres', 'radar', 'warm', 'motorsport'] },
  { id: 'np_mahogany_full', name: 'NP Mahogany Full · 1024×600', build: createNpMahoganyFullPreset, tags: ['mahogany', 'brick', 'full', 'radar', 'trackmap', 'tyres', 'warm', 'motorsport'] },
  { id: 'np_coral_sprint', name: 'NP Coral Sprint · 1024×600', build: createNpCoralSprintPreset, tags: ['coral', 'vermilion', 'sprint', 'delta', 'radar', 'warm', 'motorsport'] },
  // ── 20 futuristic graphic-first presets (native 1024×600) ─────────────────
  ...FX_FUTURE_THEMES.map((theme) => ({
    id: theme.id,
    name: `${theme.name} · 1024×600`,
    build: () => createFxFuturisticPreset(theme),
    tags: ['futuristic', 'graphic-first', 'minimal-text', '1024x600', 'motorsport', ...theme.tags]
  })),
  // ── Wave-16 futuristic + minimalist dashboards (compose the new widgets) ──
  ...R16_PRESETS,
  // ── v2.40 strategy dashboards: Quali, Race Wet/Sun, Race First (defend), Race Chase (attack) ──
  ...QUALI_PRESETS,
  ...RACE_WET_PRESETS,
  ...RACE_SUN_PRESETS,
  ...RACE_FIRST_PRESETS,
  ...RACE_CHASE_PRESETS,
  // ── Hi-fi composition dashboards (per-theme leaf modules; authored in parallel) ──
  ...HIFI_RACE_PRESETS,
  ...HIFI_ENDURANCE_PRESETS,
  ...HIFI_COACH_PRESETS,
  ...HIFI_FAMILY_PRESETS,
  ...HIFI_CARS_PRESETS,
  ...HIFI_COMPARE_PRESETS,
  ...HIFI_DIAG_PRESETS,
  ...HIFI_THEMED_CAR_PRESETS
])

export function getDashboardIdentityCatalog(): readonly DashboardIdentityCatalogEntry[] {
  return DASHBOARD_IDENTITY_CATALOG
}

export function summarizeDashboard(dash: Dashboard): DashboardSummary {
  return {
    id: dash.id,
    name: dash.name,
    width: dash.width,
    height: dash.height,
    elementCount: dash.elements.length,
    hasPreview: Boolean(dash.previewPng),
    description: dash.description,
    author: dash.author,
    ...(dash.thirdParty ? { thirdParty: structuredClone(dash.thirdParty) } : {}),
    createdAt: dash.createdAt,
    updatedAt: dash.updatedAt,
    hidden: Boolean(dash.hidden),
    ...(typeof dash.storageEpoch === 'string' ? { storageEpoch: dash.storageEpoch } : {}),
    ...(typeof dash.storageRevision === 'string' ? { storageRevision: dash.storageRevision } : {})
  }
}

// ─── Estilo granular por slot ─────────────────────────────────────────────────

// Forma já normalizada para o renderer aplicar diretamente num CSSProperties.
export interface ResolvedTextSlot {
  fontFamily?: string
  fontSize?: number
  color?: string
  fontWeight?: number | string
  align?: TextAlign
  letterSpacing?: string
  textTransform?: TextTransform
  textShadow?: string
}

// Resolve o estilo efetivo de um slot de texto: parte dos `defaults` do renderer
// (que refletem o comportamento atual do widget) e sobrepõe os overrides do usuário
// declarados em `style.slots[slot]`. Quando o slot não existe, retorna os defaults
// intactos — garantindo retro-compatibilidade total.
export function resolveSlotStyle(
  style: DashboardElementStyle | undefined,
  slot: string,
  defaults: ResolvedTextSlot = {}
): ResolvedTextSlot {
  const out: ResolvedTextSlot = { ...defaults }
  const o = style?.slots?.[slot]
  if (!o) return out
  if (o.fontFamily !== undefined && o.fontFamily !== '') out.fontFamily = o.fontFamily
  if (o.fontSize !== undefined && Number.isFinite(o.fontSize)) out.fontSize = o.fontSize
  if (o.fontColor !== undefined && o.fontColor !== '') out.color = o.fontColor
  if (o.fontWeight !== undefined && o.fontWeight !== '') out.fontWeight = o.fontWeight
  if (o.align !== undefined) out.align = o.align
  if (o.letterSpacing !== undefined && Number.isFinite(o.letterSpacing)) out.letterSpacing = `${o.letterSpacing}px`
  if (o.textTransform !== undefined) out.textTransform = o.textTransform
  if (o.shadow !== undefined) out.textShadow = o.shadow === '' ? undefined : o.shadow
  return out
}

// Aplica (imutável) um campo de slot ao mapa `style.slots`, removendo o campo (e o
// slot inteiro quando esvaziado) ao receber undefined/''. Mantém o estilo enxuto e
// a retro-compatibilidade (presets sem `slots` permanecem sem `slots`). É o ponto de
// escrita do editor (DashboardsView) — par simétrico de `resolveSlotStyle` (leitura
// do renderer); ambos cobertos pelos testes do contrato editor → renderer.
export function applySlotField(
  style: DashboardElementStyle,
  slot: string,
  field: keyof TextSlotStyle,
  value: unknown
): Record<string, Partial<TextSlotStyle>> {
  const prev = style.slots ?? {}
  const nextSlot: Record<string, unknown> = { ...(prev[slot] ?? {}) }
  if (value === undefined || value === '') delete nextSlot[field]
  else nextSlot[field] = value
  const nextSlots: Record<string, Partial<TextSlotStyle>> = { ...prev, [slot]: nextSlot as Partial<TextSlotStyle> }
  if (Object.keys(nextSlot).length === 0) delete nextSlots[slot]
  return nextSlots
}

// Reformata uma leitura de binding com casas decimais explícitas (style.decimals)
// quando há um valor numérico finito; caso contrário devolve o texto original
// (retro-compatível: sem `decimals`, ou sem numérico, nada muda). Compartilhado
// pelos widgets numéricos genéricos (value/segment7/bigtext) para que o controle
// "Casas decimais" do editor tenha efeito real.
export function applyDecimals(text: string, numeric: number | undefined, decimals: number | undefined): string {
  if (decimals === undefined || numeric === undefined || !Number.isFinite(numeric)) return text
  return numeric.toFixed(Math.max(0, Math.min(6, Math.round(decimals))))
}

// ─── Filtros de imagem ────────────────────────────────────────────────────────

function clampNum(v: number | undefined, lo: number, hi: number): number | undefined {
  if (v === undefined || !Number.isFinite(v)) return undefined
  return Math.min(hi, Math.max(lo, v))
}

// Compõe um único valor CSS `filter` a partir dos campos de filtro do estilo.
// Retorna '' quando nenhum filtro está ativo (imagem original) — preservando
// retro-compatibilidade para os elementos `image` existentes.
export function composeImageFilter(style: DashboardElementStyle | undefined): string {
  if (!style) return ''
  const parts: string[] = []
  const gray = clampNum(style.filterGrayscale, 0, 1)
  if (gray) parts.push(`grayscale(${gray})`)
  const sepia = clampNum(style.filterSepia, 0, 1)
  if (sepia) parts.push(`sepia(${sepia})`)
  // Monocromático em tons de vermelho: sépia + saturação + rotação de matiz p/ o
  // vermelho, escalado pela intensidade. Combine com grayscale(1) para um tom
  // 100% vermelho.
  const red = clampNum(style.redTint, 0, 1)
  if (red) {
    parts.push(`sepia(${red.toFixed(3)})`)
    parts.push(`saturate(${(1 + 5 * red).toFixed(3)})`)
    parts.push(`hue-rotate(${Math.round(-50 * red)}deg)`)
  }
  const bright = clampNum(style.brightness, 0, 4)
  if (bright !== undefined && bright !== 1) parts.push(`brightness(${bright})`)
  const contrast = clampNum(style.contrast, 0, 4)
  if (contrast !== undefined && contrast !== 1) parts.push(`contrast(${contrast})`)
  const sat = clampNum(style.saturate, 0, 4)
  if (sat !== undefined && sat !== 1) parts.push(`saturate(${sat})`)
  const hue = clampNum(style.hueRotate, -360, 360)
  if (hue !== undefined && hue !== 0) parts.push(`hue-rotate(${Math.round(hue)}deg)`)
  const inv = clampNum(style.invert, 0, 1)
  if (inv) parts.push(`invert(${inv})`)
  const blur = clampNum(style.blur, 0, 40)
  if (blur) parts.push(`blur(${blur}px)`)
  return parts.join(' ')
}

// ─── Ordem de empilhamento (z-order) ──────────────────────────────────────────

export type ReorderOp = 'front' | 'back' | 'forward' | 'backward'

// Reordena (imutável) o array de elementos movendo `id` segundo a operação. A
// ordem do array é a fonte primária de empilhamento honrada pelo renderer.
export function reorderElements(
  elements: DashboardElement[],
  id: string,
  op: ReorderOp
): DashboardElement[] {
  const idx = elements.findIndex((e) => e.id === id)
  if (idx < 0) return elements
  const arr = [...elements]
  const [item] = arr.splice(idx, 1)
  let nextIdx = idx
  if (op === 'front') nextIdx = arr.length
  else if (op === 'back') nextIdx = 0
  else if (op === 'forward') nextIdx = Math.min(arr.length, idx + 1)
  else if (op === 'backward') nextIdx = Math.max(0, idx - 1)
  arr.splice(nextIdx, 0, item)
  return arr
}

// Ordena (imutável e estável) por `style.zIndex` (missing = 0). Empates preservam
// a ordem do array. O renderer mapeia nesta ordem, então índices maiores são
// desenhados por último (no topo). Sem zIndex em nenhum elemento, devolve a mesma
// ordem do array — retro-compatível.
export function sortElementsByZ(elements: DashboardElement[]): DashboardElement[] {
  return elements
    .map((el, i) => ({ el, i }))
    .sort((a, b) => {
      const za = a.el.style?.zIndex ?? 0
      const zb = b.el.style?.zIndex ?? 0
      if (za !== zb) return za - zb
      return a.i - b.i
    })
    .map((x) => x.el)
}

// ─── Metadados de slots por widget (para o editor) ────────────────────────────

export interface WidgetSlotDef {
  slot: string
  label: string
}

// ── Slot presets for the wave-16 widgets ─────────────────────────────────────
// Shared definitions so the -futuristic/-minimal variants of a concept declare
// the same editable text slots without hand-duplicating ~30 entries.
const SLOT_LABEL: WidgetSlotDef = { slot: 'label', label: 'Label' }
const SLOT_VALUE: WidgetSlotDef = { slot: 'value', label: 'Value' }
const SLOT_UNIT: WidgetSlotDef = { slot: 'unit', label: 'Unit' }
const LVU_SLOTS: WidgetSlotDef[] = [SLOT_LABEL, SLOT_VALUE, SLOT_UNIT]
const LV_SLOTS: WidgetSlotDef[] = [SLOT_LABEL, SLOT_VALUE]
const PRED_SLOTS: WidgetSlotDef[] = [SLOT_LABEL, SLOT_VALUE, SLOT_UNIT, { slot: 'sub', label: 'Sub-label' }]
const NEW_WIDGET_SLOTS: Record<string, WidgetSlotDef[]> = {
  'ers-bar-futuristic': LVU_SLOTS,
  'ers-bar-minimal': LVU_SLOTS,
  'ers-radial-futuristic': LVU_SLOTS,
  'ers-radial-minimal': LVU_SLOTS,
  'p2p-futuristic': [SLOT_LABEL, SLOT_VALUE, { slot: 'status', label: 'State' }],
  'p2p-minimal': [SLOT_LABEL, SLOT_VALUE, { slot: 'status', label: 'State' }],
  'weather-status-futuristic': [SLOT_LABEL, SLOT_VALUE, { slot: 'sub', label: 'Sub-label' }],
  'weather-status-minimal': [SLOT_LABEL, SLOT_VALUE, { slot: 'sub', label: 'Sub-label' }],
  'track-surface-futuristic': LV_SLOTS,
  'track-surface-minimal': LV_SLOTS,
  'bop-futuristic': [SLOT_LABEL, { slot: 'value', label: 'Weight (kg)' }, { slot: 'power', label: 'Power (%)' }, SLOT_UNIT],
  'bop-minimal': [SLOT_LABEL, { slot: 'value', label: 'Weight (kg)' }, { slot: 'power', label: 'Power (%)' }, SLOT_UNIT],
  'cold-pressures-futuristic': [{ slot: 'header', label: 'Header' }, { slot: 'label', label: 'Corner labels' }, SLOT_VALUE, SLOT_UNIT],
  'cold-pressures-minimal': [{ slot: 'header', label: 'Header' }, { slot: 'label', label: 'Corner labels' }, SLOT_VALUE, SLOT_UNIT],
  'clock-futuristic': [SLOT_LABEL, { slot: 'value', label: 'Hora' }],
  'clock-minimal': [SLOT_LABEL, { slot: 'value', label: 'Hora' }],
  'pit-status-futuristic': [SLOT_LABEL, { slot: 'tag', label: 'State labels' }, SLOT_VALUE],
  'pit-status-minimal': [SLOT_LABEL, { slot: 'tag', label: 'State labels' }, SLOT_VALUE],
  'neon-ring-futuristic': LVU_SLOTS,
  'segmented-gauge-futuristic': LVU_SLOTS,
  'sci-fi-delta-futuristic': LV_SLOTS,
  'hud-tile-futuristic': LVU_SLOTS,
  'neon-bar-futuristic': LVU_SLOTS,
  'grid-gauge-futuristic': LVU_SLOTS,
  'mono-tile-minimal': LVU_SLOTS,
  'typo-readout-minimal': LVU_SLOTS,
  'hairline-bar-minimal': LVU_SLOTS,
  'dot-gauge-minimal': LV_SLOTS,
  'stacked-readout-minimal': LVU_SLOTS,
  'arc-minimal': LVU_SLOTS,
  // ── WS-H: predictor widgets (label/value/unit/sub) ──────────────────────────
  'pred-catch-ahead-futuristic': PRED_SLOTS,
  'pred-catch-ahead-minimal': PRED_SLOTS,
  'pred-caught-behind-futuristic': PRED_SLOTS,
  'pred-caught-behind-minimal': PRED_SLOTS,
  'pred-fuel-margin-futuristic': PRED_SLOTS,
  'pred-fuel-margin-minimal': PRED_SLOTS,
  'pred-tire-wear-futuristic': PRED_SLOTS,
  'pred-tire-wear-minimal': PRED_SLOTS,
  'pred-pace-futuristic': PRED_SLOTS,
  'pred-pace-minimal': PRED_SLOTS,
  // ── WS-M: coaching heatmap (label only) ─────────────────────────────────────
  'coach-heatmap': [SLOT_LABEL]
}

// Quais slots de texto cada tipo de widget expõe (para o editor mostrar só o que
// é aplicável). Widgets missing deste mapa só expõem o estilo principal via os
// campos top-level (fontFamily/fontSize/color/...).
export const WIDGET_SLOTS: Record<string, WidgetSlotDef[]> = {
  value: [
    { slot: 'label', label: 'Label' },
    { slot: 'value', label: 'Value' },
    { slot: 'unit', label: 'Unit' }
  ],
  valuebar: [
    { slot: 'label', label: 'Label' },
    { slot: 'value', label: 'Value' },
    { slot: 'unit', label: 'Unit' }
  ],
  valuegauge: [
    { slot: 'label', label: 'Label' },
    { slot: 'value', label: 'Value' },
    { slot: 'unit', label: 'Unit' }
  ],
  laptiming: [
    { slot: 'label', label: 'Labels (LAP/LAST/BEST)' },
    { slot: 'current', label: 'Current lap' },
    { slot: 'last', label: 'Last lap' },
    { slot: 'best', label: 'Best lap' }
  ],
  gearcluster: [
    { slot: 'gear', label: 'Gear' },
    { slot: 'gearLabel', label: 'Label "GEAR"' },
    { slot: 'speed', label: 'Speed' },
    { slot: 'speedLabel', label: 'Label "KM/H"' },
    { slot: 'value', label: 'RPM (tachometer mode)' },
    { slot: 'label', label: 'Label "RPM"' }
  ],
  fuelstint: [
    { slot: 'header', label: 'Header' },
    { slot: 'value', label: 'Value (laps)' },
    { slot: 'label', label: 'Labels (LAP/ADD)' }
  ],
  deltatile: [
    { slot: 'label', label: 'Label "LAP ?"' },
    { slot: 'value', label: 'Delta' }
  ],
  positiongaps: [
    { slot: 'value', label: 'Position' },
    { slot: 'label', label: 'Class' },
    { slot: 'gap', label: 'Gaps ahead/behind' }
  ],
  flagoverlay: [{ slot: 'value', label: 'Flag text' }],
  tyregrid: [
    { slot: 'header', label: 'Header' },
    { slot: 'label', label: 'Corner labels' },
    { slot: 'value', label: 'Values' }
  ],
  brakegrid: [
    { slot: 'header', label: 'Header' },
    { slot: 'label', label: 'Corner labels' },
    { slot: 'value', label: 'Values' }
  ],
  cornerstack: [
    { slot: 'label', label: 'Labels' },
    { slot: 'value', label: 'Values' }
  ],
  weather: [
    { slot: 'header', label: 'Header' },
    { slot: 'label', label: 'Labels' },
    { slot: 'value', label: 'Values' }
  ],
  inputbars: [
    { slot: 'label', label: 'Channel labels' },
    { slot: 'value', label: 'Values (%)' }
  ],
  steering: [
    { slot: 'label', label: 'Label (STEERING)' },
    { slot: 'value', label: 'Angle (?)' }
  ],
  setupstrip: [
    { slot: 'label', label: 'Labels (ABS/TC/?)' },
    { slot: 'value', label: 'Values' }
  ],
  enginetemps: [
    { slot: 'label', label: 'Labels (WATER/OIL)' },
    { slot: 'value', label: 'Values' },
    { slot: 'unit', label: 'Unit' }
  ],
  trackmini: [{ slot: 'value', label: 'Progress (%)' }],
  // ── Round-7 extra widgets ───────────────────────────────────────────────────
  analoggauge: [
    { slot: 'label', label: 'Label' },
    { slot: 'value', label: 'Value' },
    { slot: 'unit', label: 'Unit' }
  ],
  linearmeter: [
    { slot: 'label', label: 'Label' },
    { slot: 'value', label: 'Value' },
    { slot: 'unit', label: 'Unit' }
  ],
  ringgauge: [
    { slot: 'label', label: 'Label' },
    { slot: 'value', label: 'Value' },
    { slot: 'unit', label: 'Unit' }
  ],
  donut: [
    { slot: 'label', label: 'Label' },
    { slot: 'value', label: 'Value' }
  ],
  segment7: [
    { slot: 'label', label: 'Label' },
    { slot: 'value', label: 'Value' }
  ],
  digitalclock: [
    { slot: 'label', label: 'Label' },
    { slot: 'value', label: 'Time' }
  ],
  bigtext: [
    { slot: 'label', label: 'Caption' },
    { slot: 'value', label: 'Value' }
  ],
  gforcemeter: [
    { slot: 'label', label: 'Label' },
    { slot: 'value', label: 'Magnitude (g)' }
  ],
  historygraph: [
    { slot: 'label', label: 'Label' },
    { slot: 'value', label: 'Current value' }
  ],
  barchart: [
    { slot: 'label', label: 'Labels' },
    { slot: 'value', label: 'Values' }
  ],
  segmentbars: [
    { slot: 'label', label: 'Label' },
    { slot: 'value', label: 'Value' }
  ],
  ledbar: [{ slot: 'label', label: 'Label' }],
  radialbars: [{ slot: 'label', label: 'Center label' }],
  heatmap: [
    { slot: 'label', label: 'Title' },
    { slot: 'corner', label: 'Corner labels' },
    { slot: 'value', label: 'Values' }
  ],
  statuslamp: [
    { slot: 'label', label: 'Label' },
    { slot: 'value', label: 'State' }
  ],
  // ── Wave-16 widgets (futuristic + minimalist) ───────────────────────────────
  // Both -futuristic and -minimal variants of a concept share the same text slots.
  ...NEW_WIDGET_SLOTS
}

// Os widgets "curated" expõem variantes -clean e -elaborate do MESMO conceito;
// ambas compartilham os mesmos slots de texto. Geramos as 2 chaves por conceito
// (em vez de ~60 entradas duplicadas à hand) para que o editor encontre
// `WIDGET_SLOTS[element.type]` em qualquer variante e mostre o editor por-texto
// (fonte/cor/tamanho) para TODOS eles. Aditivo e retro-compatível: presets sem
// `slots` continuam renderizando idênticos.
const METRIC_SLOTS: WidgetSlotDef[] = [
  { slot: 'header', label: 'Header/ref' },
  { slot: 'value', label: 'Value' },
  { slot: 'unit', label: 'Unit' }
]
const CURATED_SLOTS: Record<string, WidgetSlotDef[]> = {
  speed: METRIC_SLOTS,
  gear: METRIC_SLOTS,
  rpm: METRIC_SLOTS,
  delta: METRIC_SLOTS,
  fuel: METRIC_SLOTS,
  lap: METRIC_SLOTS,
  position: METRIC_SLOTS,
  flags: METRIC_SLOTS,
  abs: METRIC_SLOTS,
  tc: METRIC_SLOTS,
  map: METRIC_SLOTS,
  bb: METRIC_SLOTS,
  pitlimiter: METRIC_SLOTS,
  incidents: METRIC_SLOTS,
  clutch: METRIC_SLOTS,
  drs: METRIC_SLOTS,
  tyres: [
    { slot: 'header', label: 'Header' },
    { slot: 'label', label: 'Corner labels' },
    { slot: 'value', label: 'Temperatures' },
    { slot: 'sub', label: 'Pressure ? wear' }
  ],
  relatives: [
    { slot: 'header', label: 'Header' },
    { slot: 'value', label: 'Driver name' },
    { slot: 'gap', label: 'Gap' },
    { slot: 'label', label: 'Last lap' }
  ],
  radar: [{ slot: 'label', label: 'Alerts (L/R/ref)' }],
  trackmap: [{ slot: 'label', label: 'Track name' }],
  inputs: [
    { slot: 'label', label: 'Channel labels' },
    { slot: 'value', label: 'Values (%)' }
  ],
  temps: [
    { slot: 'header', label: 'Header' },
    { slot: 'label', label: 'Labels (WATER/OIL)' },
    { slot: 'value', label: 'Values' }
  ]
}
for (const [concept, defs] of Object.entries(CURATED_SLOTS)) {
  WIDGET_SLOTS[`${concept}-clean`] = defs
  WIDGET_SLOTS[`${concept}-elaborate`] = defs
}

// ─── Famílias de fonte oferecidas no editor ───────────────────────────────────
// Inclui as fontes empacotadas (numérica/condensada/técnica) + fontes de sistema
// comuns. Os valores são strings CSS font-family completas.
export const DASHBOARD_FONT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '(widget default)' },
  { value: FONT_NUM, label: '7-seg numeric (DSEG)' },
  { value: FONT_COND, label: 'Condensada (DIN)' },
  { value: FONT_TECH, label: 'Technical (Avenir/Bahnschrift)' },
  { value: '"Chakra Petch", monospace', label: 'Chakra Petch' },
  { value: '"Rajdhani", sans-serif', label: 'Rajdhani' },
  { value: FONT_ORBITRON, label: 'Orbitron (display)' },
  { value: FONT_OXANIUM, label: 'Oxanium (display)' },
  { value: FONT_SAIRA, label: 'Saira Condensed (numerals)' },
  { value: FONT_TEKO, label: 'Teko (numerals)' },
  { value: '"Segoe UI", system-ui, sans-serif', label: 'Segoe UI' },
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { value: '"Arial Narrow", Arial, sans-serif', label: 'Arial Narrow' },
  { value: '"Times New Roman", Georgia, serif', label: 'Times New Roman' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: '"Courier New", ui-monospace, monospace', label: 'Courier New' },
  { value: '"Consolas", ui-monospace, monospace', label: 'Consolas' },
  { value: 'Impact, "Arial Black", sans-serif', label: 'Impact' },
  { value: 'system-ui, sans-serif', label: 'System UI' }
]
