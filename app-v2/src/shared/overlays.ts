import type { DashboardElement } from './dashboards'
import type { TelemetrySnapshot } from './telemetry'
import {
  semanticAlertVisibility as createSemanticAlertVisibility,
  type OverlayRole,
  type OverlaySemanticTriggerId,
  type OverlayTrigger
} from './overlay-trigger'
import {
  simSupportPrefix,
  type TelemetryRequirement
} from './sim-coverage'
import {
  RELEASE_A_CATALOG_ORDER,
  RELEASE_A_RELEASED_AT
} from './catalog-order'
export {
  OverlayTriggerController,
  MonotonicTemporalTriggerEngine,
  defaultTriggerForHifiModule,
  evaluateOverlayTrigger,
  isSemanticTriggerWithEdges,
  isSemanticTriggerWithHold,
  hifiModuleRole,
  overlayTriggerTags,
  sanitizeOverlayTrigger,
  sanitizeOverlayTriggerForRole,
  semanticAlertVisibility,
  semanticOverlayTrigger,
  semanticTriggerForHifiModule,
  simulateOverlayTriggerSnapshot
} from './overlay-trigger'
export type {
  OverlayRole,
  OverlaySemanticTriggerId,
  OverlayTrigger,
  OverlayTriggerKind,
  OverlayTriggerResult,
  OverlayVisibilityMetadata,
  TemporalTriggerMode
} from './overlay-trigger'

export type OverlayWidgetId =
  | 'revlights'
  | 'gearSpeed'
  | 'deltaLap'
  | 'inputs'
  | 'fuel'
  | 'gforce'
  | 'relative'
  | 'flags'
  | 'tyresBrakes'
  | 'weather'
  | 'standings'
  | 'inputsTrace'
  | 'tyresDetail'
  | 'trackMap'
  | 'trackMapNav3D'
  | 'proximityRadar'
  | 'carSilhouetteRadar'
  | 'sessionWeather'
  | 'customValue'
  | 'tireWear'
  | 'teamFuel'
  | 'gt3Cluster'
  | 'gt3Alarm'
  | 'engineVitalsStrip'
  | 'relativesStrip'
  | 'compactHud'
  | 'symbolStatus'
  | 'gridStackDash'
  | 'gridProDash'
  | 'bosch296Dash'
  | 'ringDash'
  | 'lmuEnduranceDash'
  | 'lmuStintDash'
  | 'raceconRc01Dash'
  | 'raceconRc02Dash'
  | 'raceconRc03Dash'
  | 'raceconRc04Dash'
  | 'raceconRc05Dash'
  | 'raceconRc06Dash'
  | 'raceconRc07Dash'
  | 'raceconRc08Dash'
  | 'raceconRc09Dash'
  | 'hifiDdu'
  | 'hifiEndurance'
  | 'hifiEngineer'
  | 'hifiMinimal'
  | 'hifiBroadcast'
  | 'perCornerTyrePressure'
  | 'brakeTempCorners'
  | 'fuelDeltaTile'
  | 'shiftPointBar'
  | 'engineVitalsDial'
  | 'sessionInfoTile'
  | 'revComet'
  | 'sideRadarGlyph'
  | 'orbitRadar'
  | 'relativeBeacons'
  | 'relativeLadder'
  | 'deltaNeedle'
  | 'deltaRibbon'
  | 'gearRing'
  | 'speedGlyph'
  | 'fuelOrb'
  | 'fuelPips'
  | 'inputsVector'
  | 'inputsScope'
  | 'tyreHaloGrid'
  | 'brakeHeatTiles'
  | 'trackRibbonFuture'
  | 'trackSectorPulse'
  | 'weatherGripGlyph'
  | 'flagIconStack'
  | 'gapAhead'
  | 'gapBehind'
  // ─── R16 batch: new futuristic + minimalist overlays ───────────────────────
  // Futuristic (neon/glow/segments/scanlines/grid):
  | 'ersBattery'
  | 'ersFlow'
  | 'pushToPassHud'
  | 'pitStatusHud'
  | 'coldPressureGrid'
  | 'trackClock'
  | 'wetRadar'
  | 'surfaceScope'
  | 'neonGearBar'
  | 'apexRadar'
  // Minimalist (restraint, space, monochrome + 1 accent):
  | 'ersBar'
  | 'pushToPassPips'
  | 'pitTicket'
  | 'coldPressureCard'
  | 'sessionClock'
  | 'wetTag'
  | 'surfaceTag'
  | 'bopBadge'
  | 'deltaBar'
  | 'lapReadout'
  // ─── WS-H: predictor overlays ──────────────────────────────────────────────
  | 'predCatchAhead'
  | 'predCaughtBehind'
  | 'predFuelMargin'
  | 'predTireWear'
  | 'predPaceProjected'
  // ─── WS-M: coaching heatmap overlay ────────────────────────────────────────
  | 'coachHeatmap'
  // ─── R19: Live Coach / AI Engineer text + graph overlays ───────────────────
  // Implemented in overlay/widgets/CoachEngineerWidgets.tsx (WS-WIDGETS). Read the
  // live coach report + engineer messages. Additive.
  | 'coachTips' // live coach: latest actionable tip(s) as text
  | 'coachFindings' // live coach: findings list (improve/lose/good)
  | 'coachSectorGraph' // live coach: per-sector delta bars
  | 'engineerFeed' // AI engineer: latest message/answer as text
  // ─── B-widgets: overlays for the new iRacing telemetry signals ─────────────
  | 'engineTellTales' // FIA-style engine warning lamp grid (engineWarnings)
  | 'absCut' // ABS brake-pressure cut gauge (absCutPct)
  | 'sessionBanner' // overall session-phase banner (sessionState)
  | 'paceRestart' // pace formation + pace flags (paceMode / paceFlags)
  | 'sideProximity' // 1-vs-2-car blind-spot proximity (carLeftRightCount)
  // ─── T4: GT3 instrument-style cluster widgets (brand-neutral) ──────────────
  | 'analogTach' // round analog tachometer with sweeping needle + digital gear/speed
  | 'cupCluster' // Porsche-Cup-style LED rev bar + giant gear + speed/delta
  | 'enduranceMulti' // dense endurance multifunction (stint/fuel/tyres/temps)
  | 'oledStrip' // thin minimalist horizontal cluster strip
  | 'motecDense' // dense MoTeC/AiM-like multi-field data panel
  | 'gt3Wheel' // GT3 steering-wheel face: telltales + TC/ABS/MAP/BB knobs
  | `hifi:${string}`

export type OverlayStylePresetId =
  | 'minimal'
  | 'neon'
  | 'glass'
  | 'race'
  | 'carbon'
  | 'gulf'
  | 'lemans'
  | 'broadcast'
  | 'stealth'
  | 'amber'
  | 'terminal'
  | 'bauhaus'
  | 'analog'
  | 'heatmap'
  | 'apexIgnition'
  | 'ionEmber'
  | 'vectorPulse'
  | 'cinderGlass'
  | 'thermalGhost'
  | 'emberCircuit'
  | 'radarClear'
  | 'orangeCore'
  | 'blackGold'
  | 'redlineVoid'
  | 'amberVector'
  | 'copperMesh'
  | 'moltenCarbon'
  | 'safetyGreen'
  | 'laserGrid'
  | 'solarFlare'
  | 'obsidianRing'
  | 'brakeGlow'
  | 'nightStint'

export interface OverlayPosition {
  x: number
  y: number
  width: number
  height: number
}

export interface OverlayDisplayRef {
  id: number
  index: number
  bounds: OverlayPosition
  workArea: OverlayPosition
}

export interface OverlayDisplayInfo extends OverlayDisplayRef {
  label: string
  primary: boolean
}

export interface OverlayPointer {
  x: number
  y: number
}

export type OverlayGestureMode = 'move' | 'resize'

export interface OverlayGestureState {
  mode: OverlayGestureMode
  dir: string
  startPointer: OverlayPointer
  basePosition: OverlayPosition
}

export interface OverlayWidgetStyle {
  background: string
  accent: string
  border: string
  borderColor?: string
  borderWidth?: number
  radius: number
  fontFamily: string
  opacity?: number
  showDivider?: boolean
  lines?: OverlayWidgetLine[]
}

export interface OverlayWidgetLine {
  color: string
}

export interface OverlayStylePreset {
  id: OverlayStylePresetId
  title: string
  description: string
  style: OverlayWidgetStyle
}

export interface OverlayWidgetDefinition {
  id: OverlayWidgetId
  title: string
  description: string
  defaultPosition: OverlayPosition
  /** Telemetry fields this widget needs LIVE. Drives the per-sim availability filter
   *  + the computed "(IR/ACC/LMU)" prefix. Omitted/empty = available on every sim. */
  requires?: TelemetryRequirement[]
  /** Alternative AND-groups; support requires the primary group OR any alternative. */
  alternativeRequires?: TelemetryRequirement[][]
  /** Function/category tag (e.g. 'delta', 'fuel', 'tyres', 'inputs', 'map'). */
  category?: string
  /** Free-form tags for filtering (style + category). Sim tags (IR/ACC/…) are
   *  derived automatically from `requires` and merged by the tag helper. */
  tags?: string[]
  role?: OverlayRole
  defaultTrigger?: OverlayTrigger
  catalogOrder?: number
  releasedAt?: string
  priority?: number
}

/** Display title with the computed multi-sim support prefix, e.g. "(IR/ACC/LMU) Tyres". */
export function overlayWidgetDisplayTitle(def: OverlayWidgetDefinition): string {
  return `${simSupportPrefix(def.requires, def.alternativeRequires)}${def.title}`
}

function releaseAAlertMetadata(semantic: OverlaySemanticTriggerId): Pick<
  OverlayWidgetDefinition,
  'role' | 'defaultTrigger' | 'catalogOrder' | 'releasedAt'
> {
  const visibility = createSemanticAlertVisibility(semantic)
  return {
    role: visibility.role,
    defaultTrigger: visibility.trigger,
    catalogOrder: RELEASE_A_CATALOG_ORDER,
    releasedAt: RELEASE_A_RELEASED_AT
  }
}

export interface OverlayWidgetConfig {
  id: OverlayWidgetId
  enabled: boolean
  locked: boolean
  // User-pinned shortcut flag. Does not affect rendering — only bubbles the
  // overlay up the configuration list (below the currently-active ones).
  favorite: boolean
  position: OverlayPosition
  opacity: number
  stylePreset: OverlayStylePresetId
  style: OverlayWidgetStyle
  // v4: user-hidden (moved to the "Hidden" section). Does NOT delete the config.
  hidden?: boolean
  role?: OverlayRole
  // v4: visibility trigger — when set (and not 'always'), the overlay is shown
  // ONLY while evaluateOverlayTrigger(trigger, snapshot) is true (spotter-style).
  trigger?: OverlayTrigger | null
  display?: OverlayDisplayRef | null
  hifiModuleId?: string
}

// ─── Custom overlays (user-built designer) ──────────────────────────────────
// Dynamic overlays authored in the Overlays "designer". Each one is rendered in
// its own transparent always-on-top window just like the built-in widgets.
//
// Two flavours coexist (back-compat preserved):
//   • LEGACY: `elements` = simple text/value cards, each bound to a saved
//     Expression (see shared/expr.ts) or a raw telemetry channel and evaluated
//     live against the TelemetrySnapshot (CustomOverlayWidget legacy branch).
//   • RICH:  `widgets` = the FULL dashboard widget model (DashboardElement[]),
//     rendered with the EXACT same renderer the dashboards use (gauges, gear
//     clusters, tyre grids, radars, images with filters, per-slot text styling,
//     z-order, …) inside the transparent overlay window. A def is "rich" iff it
//     carries a `widgets` array (see isRichCustomOverlay). `canvasWidth/Height`
//     describe the free-form design canvas that gets scaled to the window.

export const CUSTOM_OVERLAY_ID_PREFIX = 'custom:'

export type CustomOverlayElementAlign = 'left' | 'center' | 'right'

export interface CustomOverlayElement {
  id: string
  // Reference to the bound ExpressionDef.id (canonical link to the Expressions menu).
  expressionId: string
  // Denormalized copy of the bound expression formula + name captured at design
  // time. Keeps each element self-contained / resilient if the expression is
  // renamed or removed; the live value still re-reads the latest formula when
  // available.
  expression: string
  expressionName: string
  label: string
  // null = show the raw value; 0..4 = fixed decimal places for numeric values.
  decimals: number | null
  suffix: string
  // Layout inside the overlay card surface, in pixels from the top-left corner.
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  // Empty string = inherit the overlay accent color.
  color: string
  align: CustomOverlayElementAlign
}

export interface CustomOverlayDef {
  // Always shaped like `custom:<uuid>`.
  id: string
  title: string
  enabled: boolean
  locked: boolean
  // User-pinned shortcut flag (see OverlayWidgetConfig.favorite).
  favorite: boolean
  position: OverlayPosition
  opacity: number
  stylePreset: OverlayStylePresetId
  style: OverlayWidgetStyle
  hidden?: boolean
  createdAt?: number
  updatedAt?: number
  trigger?: OverlayTrigger | null
  display?: OverlayDisplayRef | null
  // LEGACY content (expression/channel text cards). Kept for back-compat.
  elements: CustomOverlayElement[]
  // RICH content: the dashboard widget model rendered with the dashboard
  // renderer. Presence of this array (even empty) marks the overlay as "rich"
  // (see isRichCustomOverlay). Absent on legacy overlays.
  widgets?: DashboardElement[]
  // Free-form design canvas (px) for the rich widgets, scaled to the window.
  // Default to the position width/height when omitted.
  canvasWidth?: number
  canvasHeight?: number
}

export interface CustomOverlayListItem extends CustomOverlayDef {
  visible: boolean
}

export interface OverlaysConfig {
  configMode: boolean
  overlayCompositorEnabled?: boolean
  widgets: Record<OverlayWidgetId, OverlayWidgetConfig>
  customOverlays: CustomOverlayDef[]
}

export interface OverlayListItem extends OverlayWidgetDefinition, OverlayWidgetConfig {
  visible: boolean
}

export function isCustomOverlayId(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(CUSTOM_OVERLAY_ID_PREFIX)
}

// A custom overlay is "rich" (renders dashboard widgets) iff it carries a
// `widgets` array. Legacy overlays (expression/channel text cards) never do, so
// this predicate is the single source of truth used by the renderer + builder.
export function isRichCustomOverlay(def: { widgets?: unknown } | null | undefined): boolean {
  return Array.isArray(def?.widgets)
}

export const DEFAULT_CUSTOM_OVERLAY_POSITION: OverlayPosition = { x: 320, y: 320, width: 320, height: 200 }

// Larger default canvas for rich (dashboard-widget) overlays — a wide HUD strip.
export const DEFAULT_RICH_OVERLAY_CANVAS: { width: number; height: number } = { width: 960, height: 320 }
export const DEFAULT_RICH_OVERLAY_POSITION: OverlayPosition = {
  x: 160,
  y: 160,
  width: DEFAULT_RICH_OVERLAY_CANVAS.width,
  height: DEFAULT_RICH_OVERLAY_CANVAS.height
}

const RICH_OVERLAY_MAX_WIDGETS = 200
const RICH_OVERLAY_COORD_LIMIT = 16000
// Cap nested extension arrays at 4096 logical slots.
const WIDGET_EXTENSION_MAX_DEPTH = 32, WIDGET_EXTENSION_NODE_BUDGET = 10_000, WIDGET_EXTENSION_ARRAY_LIMIT = 4096

function clampRichCoord(value: unknown, fallback: number, min = -RICH_OVERLAY_COORD_LIMIT): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(RICH_OVERLAY_COORD_LIMIT, Math.max(min, value))
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch { return false }
}

const BLOCKED_WIDGET_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const CANONICAL_WIDGET_KEYS = new Set(['id', 'type', 'x', 'y', 'w', 'h', 'style', 'binding', 'name', 'visible', 'sourceType', 'widgetId', 'hifiModuleId'])
const UNSAFE_WIDGET_VALUE = Symbol('unsafe-widget-value'), UNSAFE_WIDGET_GRAPH = Symbol('unsafe-widget-graph')
type WidgetCloneState = { nodes: number; seen: WeakSet<object> }

function cloneJsonSafe(value: unknown, state: WidgetCloneState, depth = 0): unknown {
  try {
    if (depth > WIDGET_EXTENSION_MAX_DEPTH || ++state.nodes > WIDGET_EXTENSION_NODE_BUDGET) return UNSAFE_WIDGET_GRAPH
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
    if (typeof value === 'number') return Number.isFinite(value) ? value : UNSAFE_WIDGET_VALUE
    if (typeof value !== 'object') return UNSAFE_WIDGET_VALUE
    if (state.seen.has(value)) return UNSAFE_WIDGET_GRAPH
    const isArray = Array.isArray(value)
    if (!isArray && !isPlainRecord(value)) return UNSAFE_WIDGET_VALUE
    state.seen.add(value)
    if (isArray) {
      const length = boundedArrayLength(value, WIDGET_EXTENSION_ARRAY_LIMIT)
      if (length === null || (state.nodes += length) > WIDGET_EXTENSION_NODE_BUDGET) return UNSAFE_WIDGET_GRAPH
      const clone = new Array(length)
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (!descriptor?.enumerable || !('value' in descriptor)) continue
        const item = cloneJsonSafe(descriptor.value, state, depth + 1)
        if (item === UNSAFE_WIDGET_GRAPH) return item
        if (item !== UNSAFE_WIDGET_VALUE) {
          Object.defineProperty(clone, index, { value: item, enumerable: true, writable: true, configurable: true })
        }
      }
      return clone
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>
    const clone: Record<string, unknown> = {}
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (++state.nodes > WIDGET_EXTENSION_NODE_BUDGET) {
        return UNSAFE_WIDGET_GRAPH
      }
      if (!descriptor.enumerable || !('value' in descriptor) || BLOCKED_WIDGET_KEYS.has(key)) continue
      const item = cloneJsonSafe(descriptor.value, state, depth + 1)
      if (item === UNSAFE_WIDGET_GRAPH) return item
      if (item !== UNSAFE_WIDGET_VALUE) {
        Object.defineProperty(clone, key, { value: item, enumerable: true, writable: true, configurable: true })
      }
    }
    return clone
  } catch { return UNSAFE_WIDGET_VALUE }
}

function ownDataValue(descriptors: Record<string, PropertyDescriptor>, key: string): unknown {
  const descriptor = descriptors[key]; return descriptor && 'value' in descriptor ? descriptor.value : undefined
}
function boundedArrayLength(value: object, limit: number): number | null { const descriptor = Object.getOwnPropertyDescriptor(value, 'length'), length = descriptor && 'value' in descriptor ? descriptor.value : null; return Number.isSafeInteger(length) && (length as number) >= 0 && (length as number) <= limit ? length as number : null }

// Structural sanitizer for one rich widget. Canonical fields are rebuilt after
// safe extension cloning, so extensions can never bypass geometry/type handling.
export function sanitizeCustomOverlayWidget(value: unknown, index = 0): DashboardElement | null {
  try {
    if (!isPlainRecord(value)) return null
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const type = ownDataValue(descriptors, 'type')
    if (typeof type !== 'string' || type.length === 0) return null
    const style = cloneJsonSafe(ownDataValue(descriptors, 'style'), { nodes: 0, seen: new WeakSet<object>([value]) })
    const state: WidgetCloneState = { nodes: 0, seen: new WeakSet<object>([value]) }
    const widget = {} as DashboardElement & Record<string, unknown>
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (++state.nodes > WIDGET_EXTENSION_NODE_BUDGET) break
      if (!descriptor.enumerable || !('value' in descriptor) || CANONICAL_WIDGET_KEYS.has(key) || BLOCKED_WIDGET_KEYS.has(key)) continue
      const item = cloneJsonSafe(descriptor.value, state)
      if (item !== UNSAFE_WIDGET_VALUE && item !== UNSAFE_WIDGET_GRAPH) {
        Object.defineProperty(widget, key, { value: item, enumerable: true, writable: true, configurable: true })
      }
    }
    const id = ownDataValue(descriptors, 'id')
    widget.id = typeof id === 'string' && id.trim() ? id.trim() : `w-${Date.now().toString(36)}-${index}`; widget.type = type as DashboardElement['type']
    widget.x = clampRichCoord(ownDataValue(descriptors, 'x'), 0); widget.y = clampRichCoord(ownDataValue(descriptors, 'y'), 0)
    widget.w = clampRichCoord(ownDataValue(descriptors, 'w'), 120, 1); widget.h = clampRichCoord(ownDataValue(descriptors, 'h'), 60, 1)
    widget.style = (isPlainRecord(style) ? style : {}) as DashboardElement['style']
    const binding = ownDataValue(descriptors, 'binding'), name = ownDataValue(descriptors, 'name')
    const visible = ownDataValue(descriptors, 'visible'), sourceType = ownDataValue(descriptors, 'sourceType')
    if (typeof binding === 'string' && binding.length > 0) widget.binding = binding; if (typeof name === 'string') widget.name = name
    if (typeof visible === 'boolean') widget.visible = visible; if (typeof sourceType === 'string') widget.sourceType = sourceType
    if (type === 'overlaywidget') {
      const widgetId = ownDataValue(descriptors, 'widgetId'), hifiModuleId = ownDataValue(descriptors, 'hifiModuleId')
      if (typeof widgetId === 'string' && widgetId.trim()) widget.widgetId = widgetId as DashboardElement['widgetId']
      if (typeof hifiModuleId === 'string' && hifiModuleId.trim()) widget.hifiModuleId = hifiModuleId
    }
    return widget
  } catch { return null }
}

// Sanitize a `widgets` field. Returns undefined when the field is absent / not an
// array (keeps the overlay LEGACY); returns a (possibly empty) array when present
// (marks the overlay RICH). Rejects arrays whose length exceeds the maximum,
// returning an empty array instead of truncating.
export function sanitizeCustomOverlayWidgets(value: unknown): DashboardElement[] | undefined {
  let isArray = false
  try {
    isArray = Array.isArray(value)
    if (!isArray) return undefined
    const length = boundedArrayLength(value as object, RICH_OVERLAY_MAX_WIDGETS)
    if (length === null) return []
    const out: DashboardElement[] = []
    for (let i = 0; i < length && out.length < RICH_OVERLAY_MAX_WIDGETS; i += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i))
      if (!descriptor?.enumerable || !('value' in descriptor)) continue
      const widget = sanitizeCustomOverlayWidget(descriptor.value, i)
      if (widget) out.push(widget)
    }
    return out
  } catch { return isArray ? [] : undefined }
}

let customElementCounter = 0

export function createCustomOverlayElement(partial: Partial<CustomOverlayElement> = {}): CustomOverlayElement {
  customElementCounter += 1
  return {
    id: partial.id ?? `el-${Date.now().toString(36)}-${customElementCounter}`,
    expressionId: partial.expressionId ?? '',
    expression: partial.expression ?? '',
    expressionName: partial.expressionName ?? '',
    label: partial.label ?? '',
    decimals: partial.decimals ?? null,
    suffix: partial.suffix ?? '',
    x: partial.x ?? 16,
    y: partial.y ?? 16,
    width: partial.width ?? 220,
    height: partial.height ?? 56,
    fontSize: partial.fontSize ?? 26,
    color: partial.color ?? '',
    align: partial.align ?? 'left'
  }
}

export function createCustomOverlayDef(partial: Partial<CustomOverlayDef> = {}): CustomOverlayDef {
  const stylePreset = getOverlayStylePreset(partial.stylePreset).id
  const now = Date.now()
  const def: CustomOverlayDef = {
    id: partial.id ?? `${CUSTOM_OVERLAY_ID_PREFIX}${Date.now().toString(36)}`,
    title: partial.title ?? 'Custom overlay',
    enabled: partial.enabled ?? false,
    locked: partial.locked ?? false,
    favorite: partial.favorite ?? false,
    position: { ...(partial.position ?? DEFAULT_CUSTOM_OVERLAY_POSITION) },
    opacity: partial.opacity ?? 100,
    stylePreset,
    style: partial.style ? { ...partial.style } : createDefaultOverlayStyle(stylePreset),
    hidden: partial.hidden ?? false,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? partial.createdAt ?? now,
    trigger: partial.trigger ?? null,
    display: partial.display ?? null,
    elements: (partial.elements ?? []).map((element) => createCustomOverlayElement(element))
  }
  // Rich content is optional — preserve "richness" iff a widgets array was given.
  const widgets = sanitizeCustomOverlayWidgets(partial.widgets)
  if (widgets) {
    def.widgets = widgets
    // Canvas defaults to the (resolved) window size so the overlay opens 1:1.
    def.canvasWidth = clampRichCoord(partial.canvasWidth, def.position.width, 1)
    def.canvasHeight = clampRichCoord(partial.canvasHeight, def.position.height, 1)
  }
  return def
}

// Convenience for the builder: a fresh RICH overlay (dashboard-widget canvas).
// Always carries a `widgets` array so isRichCustomOverlay(def) === true.
export function createRichCustomOverlayDef(partial: Partial<CustomOverlayDef> = {}): CustomOverlayDef {
  return createCustomOverlayDef({
    title: 'Novo overlay',
    enabled: true,
    position: { ...(partial.position ?? DEFAULT_RICH_OVERLAY_POSITION) },
    canvasWidth: partial.canvasWidth ?? DEFAULT_RICH_OVERLAY_CANVAS.width,
    canvasHeight: partial.canvasHeight ?? DEFAULT_RICH_OVERLAY_CANVAS.height,
    ...partial,
    widgets: partial.widgets ?? []
  })
}

export const OVERLAY_STYLE_PRESETS: OverlayStylePreset[] = [
  {
    id: 'minimal',
    title: 'Minimal',
    description: 'Clean shape: subtle lines, minimal chrome, and distraction-free readability.',
    style: {
      background: 'rgba(5, 10, 18, 0.72)',
      accent: '#ff6a00',
      border: 'rgba(138, 164, 200, 0.30)',
      radius: 16,
      fontFamily: 'Segoe UI, sans-serif'
    }
  },
  {
    id: 'broadcast',
    title: 'Broadcast',
    description: 'TV/lower-third shape: bold blocks, tabs, and cells for streaming.',
    style: {
      background: 'rgba(8, 10, 14, 0.88)',
      accent: '#f5a623',
      border: 'rgba(245, 166, 35, 0.42)',
      radius: 8,
      fontFamily: 'DIN Condensed, Bahnschrift, Segoe UI, sans-serif'
    }
  },
  {
    id: 'analog',
    title: 'Analog',
    description: 'Classic cockpit shape: circular dials, needles, arcs, and bezels.',
    style: {
      background: 'rgba(10, 8, 5, 0.88)',
      accent: '#ff8c00',
      border: 'rgba(200, 170, 110, 0.36)',
      radius: 20,
      fontFamily: 'Bahnschrift, Segoe UI, sans-serif'
    }
  },
  {
    id: 'heatmap',
    title: 'Heatmap',
    description: 'Engineering shape: dense grids, cells, and bars encoded by intensity.',
    style: {
      background: 'rgba(5, 5, 12, 0.86)',
      accent: '#ff6a00',
      border: 'rgba(255, 106, 0, 0.36)',
      radius: 14,
      fontFamily: 'Bahnschrift, Segoe UI, sans-serif'
    }
  },
  {
    id: 'neon',
    title: 'Neon',
    description: 'Futuristic HUD shape: floating segments, rings/bars, and vector glow.',
    style: {
      background: 'rgba(18, 8, 2, 0.82)',
      accent: '#ff6a00',
      border: 'rgba(255, 106, 0, 0.62)',
      radius: 18,
      fontFamily: 'Bahnschrift, Segoe UI, sans-serif'
    }
  }
]

export const OVERLAY_FORMS = OVERLAY_STYLE_PRESETS

export const DEFAULT_OVERLAY_STYLE_PRESET: OverlayStylePresetId = 'minimal'

export function getOverlayStylePreset(id?: string): OverlayStylePreset {
  const exact = OVERLAY_STYLE_PRESETS.find((preset) => preset.id === id)
  if (exact) return exact
  const family = overlayDesignFamily(id)
  const formId: OverlayStylePresetId = family === 'analog' || family === 'broadcast' || family === 'heatmap' || family === 'neon'
    ? family
    : family === 'bauhaus'
      ? 'broadcast'
      : 'minimal'
  return OVERLAY_STYLE_PRESETS.find((preset) => preset.id === formId) ?? OVERLAY_STYLE_PRESETS[0]
}

export function createDefaultOverlayStyle(preset: OverlayStylePresetId = DEFAULT_OVERLAY_STYLE_PRESET): OverlayWidgetStyle {
  return { ...getOverlayStylePreset(preset).style }
}

// ─── Overlay DESIGN FAMILIES ──────────────────────────────────────────────────
//
// A style preset only swaps the surface COLORS (`OverlayWidgetStyle`). A design
// family swaps the LAYOUT + TYPOGRAPHY language, so a widget can render
// *structurally* different per family (a gauge vs a bar vs a bracketed readout)
// while still reading its colors from the resolved preset. Every preset belongs
// to exactly one family via `OVERLAY_PRESET_FAMILY`; widgets should branch on
// `overlayDesignFamily(config.stylePreset)` instead of raw preset ids.
//
// GLOBAL COLOR ROLE RULE (applies to every family):
//   • Warm tokens (red / orange / amber) carry CHROME: accents, highlights,
//     redline/limit, attention and "hot" telemetry.
//   • Cool / green / blue are reserved for a genuinely positive "good" state:
//     faster delta, full battery/charge, dry track, optimal shift band, radar
//     clear. Never use cool hues as default chrome.
//   • Neutral metallics (silver, steel, gold, gray) are allowed as quiet chrome —
//     it is the *saturated* cool hues that signal "good".
//
// The full prose spec (with the preset→family mapping table) lives in
// `visual-audit/DESIGN-FAMILIES.md`; the per-family summary below is the
// machine-readable mirror used by the harness and the redesign fleet.
//
// FAMILIES
//   minimal   — Layout: one value per line, hairline dividers, generous negative
//               space, muted labels. Type: Segoe UI, regular body / light labels,
//               tabular numerals. Shape: soft 12–20px radius, near-flat, single
//               hairline border, no glow. Motion: opacity cross-fade only.
//               Shines: long stints, road/GT cockpits, telemetry that disappears.
//               Color: mono surface + one warm accent on the live value; neutral
//               grays as chrome; cool/green only on a confirmed good state.
//   neon      — Layout: floating HUD segments, ring/bar emphasis, vector linework
//               over a dark void, sparse text. Type: Bahnschrift/condensed big
//               numbers + monospace tags/units, uppercase. Shape: emissive
//               strokes, segmented arcs, scanline/grid hints, glowing borders.
//               Motion: glow pulse on threshold (shift/limit) only.
//               Shines: night races, futuristic builds, stream spectacle.
//               Color: hot orange/red/amber emission for chrome + redline;
//               cyan/green glow ONLY for a positive event (good shift, gain, clear).
//   glass     — Layout: layered translucent cards, soft shadow depth, content
//               floats over a blurred backdrop. Type: Segoe UI light/regular, airy
//               tracking, low-opacity labels. Shape: large 22–30px radius, frosted
//               low-alpha fill, bright thin top edge, soft inner glow.
//               Motion: gentle fade/parallax, specular shift on alert.
//               Shines: premium overlays over varied backgrounds, demo/show cars.
//               Color: warm accent tints the frost; a cool/blue frost tint is
//               reserved to signal a genuinely good/optimal state.
//   broadcast — Layout: horizontal lower-thirds, boxed label+value cells, strong
//               baseline grid, position/gap chips. Type: DIN Condensed/Bahnschrift,
//               bold uppercase labels, condensed numerics, max legibility. Shape:
//               small 6–12px radius, solid filled blocks, colored label tab + value
//               field, thick separators. Motion: slide/clip reveal like a TV bug.
//               Shines: streaming, spectating, multiclass standings/relative.
//               Color: warm accent on label tabs + live highlights; cool/green only
//               on a "good" chip (P-gain, faster, clear).
//   terminal  — Layout: fixed-width rows, bracketed [fields], column-aligned
//               key:value, ASCII/box-drawing rules. Type: monospace
//               (Cascadia/Consolas), uppercase keys, everything tabular. Shape:
//               near-zero radius, thin mono border, CRT scan tint, brackets &
//               dividers instead of fills. Motion: caret blink / typewriter at most.
//               Shines: data/debug overlays, retro cockpits, dense readouts.
//               Color: amber/orange phosphor on near-black; green phosphor ONLY for
//               an OK/good status line; red for limits.
//   bauhaus   — Layout: hard modular grid of colored blocks, one giant focal value,
//               primary shapes (circle/square/triangle) as indicators. Type: heavy
//               display (Impact/Arial Narrow), oversized numerics, ALL-CAPS short
//               labels. Shape: zero radius, flat saturated blocks, thick rules,
//               aggressive diagonal cuts. Motion: snap/step changes, instant flips.
//               Shines: bold single-metric overlays (gear, rev, flag), poster dashes.
//               Color: primary warm blocks carry chrome + alerts; a blue/green block
//               only for a confirmed good state.
//   analog    — Layout: circular dials, needles/arcs, tick rings, sub-readouts in
//               the dial face, radar/sweep variants. Type: Bahnschrift/Segoe dial
//               numerals, engraved labels, centered readouts. Shape: round bezels,
//               beveled depth, needle + tick marks, metallic/bronze chrome.
//               Motion: smooth needle sweep with inertia, no flashing.
//               Shines: rev/speed/fuel gauges, radar/relative, heritage cockpits.
//               Color: warm needle/redline arc + chrome bezel; a green/blue zone
//               ONLY for the healthy/optimal band (clear radar, good shift band).
//   heatmap   — Layout: tightly packed grids/cells/bars, every channel visible at
//               once, numeric label per cell. Type: Bahnschrift/condensed tabular
//               numerals, tiny dense labels, high info density. Shape: small radius,
//               filled cells/tiles, intensity-mapped fills, segmented bars, mesh.
//               Motion: cells re-color in place, no layout movement.
//               Shines: tyres/brakes/pressures, multi-channel telemetry, engineers.
//               Color: cold→hot ramp where HOT (orange/red) = high/attention and
//               COOL (blue/green) = low/in-range (the genuinely good state) — the
//               one place a gradient is allowed, still anchored by good=cool/hot=warn.

/**
 * Ordered list of overlay design families (canonical order for harness / pickers /
 * the redesign fleet). The `OverlayDesignFamily` union is derived from this list,
 * so the two can never drift.
 */
export const OVERLAY_DESIGN_FAMILIES = [
  'minimal',
  'neon',
  'glass',
  'broadcast',
  'terminal',
  'bauhaus',
  'analog',
  'heatmap'
] as const

export type OverlayDesignFamily = (typeof OVERLAY_DESIGN_FAMILIES)[number]

export interface OverlayDesignFamilySpec {
  id: OverlayDesignFamily
  title: string
  /** One-line essence of the family. */
  tagline: string
  /** How information is arranged on the surface. */
  layout: string
  /** Type system: families, weights, casing. */
  typography: string
  /** Shape language, radius, borders, surface treatment. */
  shape: string
  /** Motion restraint — what (little) is allowed to move. */
  motion: string
  /** Scenarios where the family is the right call. */
  shines: string
  /** Family-specific reading of the global warm-chrome / cool-good color rule. */
  colorRole: string
}

/**
 * Machine-readable mirror of the per-family spec in
 * `visual-audit/DESIGN-FAMILIES.md`. Consumed by the visual harness and the
 * later widget-redesign fleet to drive layout/typography decisions per family.
 */
export const OVERLAY_DESIGN_FAMILY_SPECS: Record<OverlayDesignFamily, OverlayDesignFamilySpec> = {
  minimal: {
    id: 'minimal',
    title: 'Minimal',
    tagline: 'Restrained telemetry that gets out of the way.',
    layout: 'One value per line, hairline dividers, generous negative space, muted labels.',
    typography: 'Segoe UI — regular body, light/medium labels, tabular numerals.',
    shape: 'Soft 12–20px radius, near-flat panels, single hairline border, no glow.',
    motion: 'Opacity / cross-fade only; chrome never pulses.',
    shines: 'Long stints, road & GT cockpits, drivers who want telemetry that disappears.',
    colorRole: 'Mono surface + one warm accent on the live value; neutral grays as chrome; cool/green only on a confirmed good state.'
  },
  neon: {
    id: 'neon',
    title: 'Neon',
    tagline: 'Glowing cyber HUD for the dark.',
    layout: 'Floating HUD segments, ring/bar emphasis, vector linework over a dark void, sparse text.',
    typography: 'Bahnschrift/condensed big numbers + monospace tags/units, uppercase accents.',
    shape: 'Emissive strokes, segmented arcs, scanline/grid hints, glowing borders, medium radius.',
    motion: 'Glow pulse on threshold (shift/limit) only; steady otherwise.',
    shines: 'Night races, futuristic builds, streamers who want spectacle.',
    colorRole: 'Hot orange/red/amber emission for chrome + redline; cyan/green glow ONLY for a positive event (good shift, gain, clear).'
  },
  glass: {
    id: 'glass',
    title: 'Glass',
    tagline: 'Frosted depth that floats over anything.',
    layout: 'Layered translucent cards, soft shadow depth, content floats over a blurred backdrop.',
    typography: 'Segoe UI light/regular, airy letter-spacing, low-opacity labels.',
    shape: 'Large 22–30px radius, frosted low-alpha fill, bright thin top edge, soft inner glow.',
    motion: 'Gentle fade/parallax; specular shift on alert; no hard flashes.',
    shines: 'Premium overlays over varied backgrounds, demo & show-car builds.',
    colorRole: 'Warm accent tints the frost; a cool/blue frost tint is reserved to signal a genuinely good/optimal state.'
  },
  broadcast: {
    id: 'broadcast',
    title: 'Broadcast',
    tagline: 'TV lower-third legible from across the room.',
    layout: 'Horizontal lower-thirds, boxed label+value cells, strong baseline grid, position/gap chips.',
    typography: 'DIN Condensed/Bahnschrift, bold uppercase labels, condensed numerics, max legibility.',
    shape: 'Small 6–12px radius, solid filled blocks, colored label tab + value field, thick separators.',
    motion: 'Slide-in / clip reveal like a TV bug; no idle motion.',
    shines: 'Streaming, spectating, multiclass standings & relative at distance.',
    colorRole: 'Warm accent on label tabs + live highlights; cool/green only on a "good" chip (P-gain, faster, clear).'
  },
  terminal: {
    id: 'terminal',
    title: 'Terminal',
    tagline: 'Bracketed monospace readout, CRT cockpit.',
    layout: 'Fixed-width rows, bracketed [fields], column-aligned key:value, ASCII/box-drawing rules.',
    typography: 'Monospace (Cascadia/Consolas), uppercase keys, everything tabular.',
    shape: 'Near-zero radius, thin mono border, CRT scan tint, brackets & dividers instead of fills.',
    motion: 'Caret blink / typewriter reveal at most; otherwise static.',
    shines: 'Data/debug overlays, retro cockpits, drivers who like dense readouts.',
    colorRole: 'Amber/orange phosphor on near-black; green phosphor ONLY for an OK/good status line; red for limits.'
  },
  bauhaus: {
    id: 'bauhaus',
    title: 'Bauhaus',
    tagline: 'Geometric blocks and one giant number.',
    layout: 'Hard modular grid of colored blocks, one giant focal value, primary shapes as indicators.',
    typography: 'Heavy display (Impact/Arial Narrow), oversized numerics, ALL-CAPS short labels.',
    shape: 'Zero radius, flat saturated blocks, thick rules, aggressive diagonal cuts.',
    motion: 'Snap / step changes, instant state flips, no easing.',
    shines: 'Bold single-metric overlays (gear, rev, flag), poster-like dashboards.',
    colorRole: 'Primary warm blocks carry chrome + alerts; a blue/green block only for a confirmed good state.'
  },
  analog: {
    id: 'analog',
    title: 'Analog',
    tagline: 'Skeuomorphic dials, needles and sweeps.',
    layout: 'Circular dials, needles/arcs, tick rings, sub-readouts in the dial face, radar/sweep variants.',
    typography: 'Bahnschrift/Segoe dial numerals, engraved-style labels, centered readouts.',
    shape: 'Round bezels, beveled depth, needle + tick marks, metallic/bronze chrome.',
    motion: 'Smooth needle sweep with inertia; no flashing.',
    shines: 'Rev/speed/fuel gauges, radar & relative position, heritage cockpit looks.',
    colorRole: 'Warm needle/redline arc + chrome bezel; a green/blue zone ONLY for the healthy/optimal band (clear radar, good shift band).'
  },
  heatmap: {
    id: 'heatmap',
    title: 'Heatmap',
    tagline: 'Data-dense cells coded cold-to-hot.',
    layout: 'Tightly packed grids/cells/bars, every channel visible at once, numeric label per cell.',
    typography: 'Bahnschrift/condensed tabular numerals, tiny dense labels, high info density.',
    shape: 'Small radius, filled cells/tiles, intensity-mapped fills, segmented bars, mesh.',
    motion: 'Cells re-color in place; no layout movement.',
    shines: 'Tyres/brakes/pressures, multi-channel telemetry, race engineers.',
    colorRole: 'Cold→hot ramp where HOT (orange/red) = high/attention and COOL (blue/green) = low/in-range (the good state); the one allowed gradient, still anchored by good=cool / hot=warn.'
  }
}

/**
 * Canonical mapping of every current or legacy style preset to a structural
 * family. Only five forms are selectable now; legacy structural ids stay accepted
 * so persisted configs and old tests render with their previous layout.
 */
export const OVERLAY_PRESET_FAMILY: Record<OverlayStylePresetId, OverlayDesignFamily> = {
  // Five user-facing structural forms.
  minimal: 'minimal',
  broadcast: 'broadcast',
  analog: 'analog',
  heatmap: 'heatmap',
  neon: 'neon',
  // Legacy archetypes preserved for persisted configs.
  glass: 'glass',
  terminal: 'terminal',
  bauhaus: 'bauhaus',
  // Original color variants.
  race: 'broadcast',
  carbon: 'broadcast',
  gulf: 'broadcast',
  lemans: 'analog',
  stealth: 'minimal',
  amber: 'analog',
  // R16 batch: futuristic + minimalist color/style variants.
  apexIgnition: 'neon',
  ionEmber: 'minimal',
  vectorPulse: 'neon',
  cinderGlass: 'minimal',
  thermalGhost: 'heatmap',
  emberCircuit: 'neon',
  radarClear: 'analog',
  orangeCore: 'neon',
  blackGold: 'minimal',
  redlineVoid: 'broadcast',
  amberVector: 'neon',
  copperMesh: 'heatmap',
  moltenCarbon: 'broadcast',
  safetyGreen: 'analog',
  laserGrid: 'neon',
  solarFlare: 'analog',
  obsidianRing: 'analog',
  brakeGlow: 'heatmap',
  nightStint: 'minimal'
}
/**
 * Resolve a style preset id to its design family. Unknown or missing ids fall
 * back to the family of the default preset (`minimal`). Widgets should switch
 * their LAYOUT on this instead of comparing raw preset ids, so every preset in a
 * family inherits the redesigned layout for free.
 */
export function overlayDesignFamily(presetId?: string): OverlayDesignFamily {
  if (presetId && Object.prototype.hasOwnProperty.call(OVERLAY_PRESET_FAMILY, presetId)) {
    return OVERLAY_PRESET_FAMILY[presetId as OverlayStylePresetId]
  }
  return OVERLAY_PRESET_FAMILY[DEFAULT_OVERLAY_STYLE_PRESET]
}

export const OVERLAY_WIDGETS: OverlayWidgetDefinition[] = [
  {
    id: 'revlights',
    title: 'Rev / shift lights',
    description: 'RPM band with shift point and limiter alert.',
    defaultPosition: { x: 640, y: 34, width: 560, height: 88 },
    requires: ['rpm', 'maxRpm']
  },
  {
    id: 'gearSpeed',
    title: 'Gear + speed',
    description: 'Current gear, speed, and active assists.',
    defaultPosition: { x: 820, y: 130, width: 260, height: 150 },
    requires: ['gear', 'speedKmh']
  },
  {
    id: 'deltaLap',
    title: 'Delta / laptime',
    description: 'Delta to best lap, current lap, and last lap.',
    defaultPosition: { x: 50, y: 650, width: 380, height: 150 },
    requires: ['deltaToBestSec']
  },
  {
    id: 'inputs',
    title: 'Inputs',
    description: 'Throttle, brake, clutch, and steering.',
    defaultPosition: { x: 1450, y: 560, width: 330, height: 230 },
    requires: ['throttle', 'brake']
  },

  {
    id: 'gforce',
    title: 'G Forces',
    description: 'G-ball with live lateral and longitudinal acceleration trail.',
    defaultPosition: { x: 1180, y: 500, width: 320, height: 320 },
    requires: ['latAccelG', 'longAccelG']
  },
  {
    id: 'fuel',
    title: 'Fuel',
    description: 'Litros, consumo por lap e laps estimadas.',
    defaultPosition: { x: 50, y: 460, width: 300, height: 160 },
    requires: ['fuelLiters']
  },
  {
    id: 'teamFuel',
    title: 'Team Fuel',
    description: 'Fuel e stint dos peers da sala LAN.',
    defaultPosition: { x: 50, y: 620, width: 420, height: 190 },
    requires: ['fuelLiters', 'sessionUniqueId']
  },
  {
    id: 'tireWear',
    title: 'Desgaste de tires',
    description: 'Vida dos 4 tires, taxa por lap e laps remaining.',
    defaultPosition: { x: 370, y: 460, width: 300, height: 220 },
    requires: ['tyres']
  },
  {
    id: 'relative',
    title: 'Relativo / standings',
    description: 'Nearby cars with class colors and gap.',
    defaultPosition: { x: 1420, y: 120, width: 420, height: 390 },
    requires: ['relatives']
  },
  {
    id: 'flags',
    title: 'Flags',
    description: 'Track state and driving alerts.',
    defaultPosition: { x: 760, y: 820, width: 420, height: 92 },
    requires: ['flags'],
    tags: ['flags', 'race-control', 'trigger-only', 'release-a'],
    ...releaseAAlertMetadata('raceControlFlags')
  },
  {
    id: 'tyresBrakes',
    title: 'Tires / brakes',
    description: 'Temperatures, pressures, wear, and brakes by corner.',
    defaultPosition: { x: 50, y: 120, width: 360, height: 300 },
    requires: ['tyres']
  },
  {
    id: 'weather',
    title: 'Weather / track',
    description: 'Temperature, rain, wetness, and grip.',
    defaultPosition: { x: 1220, y: 820, width: 360, height: 115 },
    requires: ['trackTempC']
  },
  {
    id: 'standings',
    title: 'Full standings',
    description: 'Expanded list with positions, class, pits, and gaps.',
    defaultPosition: { x: 1390, y: 70, width: 500, height: 620 },
    requires: ['drivers']
  },
  {
    id: 'inputsTrace',
    title: 'Input trace',
    description: 'Live history of throttle, brake, clutch, and steering.',
    defaultPosition: { x: 1360, y: 560, width: 420, height: 260 },
    requires: ['throttle', 'brake']
  },
  {
    id: 'tyresDetail',
    title: 'Detailed tires',
    description: 'Pressure, temperature, wear, and brake with bars by corner.',
    defaultPosition: { x: 40, y: 90, width: 430, height: 420 },
    requires: ['tyres']
  },
  {
    id: 'trackMap',
    title: 'Track map',
    description: 'Mini map by lap distance with nearby cars.',
    defaultPosition: { x: 690, y: 720, width: 500, height: 210 },
    requires: ['lapDistPct']
  },
  {
    id: 'trackMapNav3D',
    title: '3D navigation map',
    description: 'Track-up Waze-style 3D ribbon map with follow camera, zoom, and rival markers.',
    defaultPosition: { x: 620, y: 520, width: 680, height: 400 },
    requires: ['lapDistPct', 'drivers'],
    category: 'map',
    tags: ['3d', 'nav', 'neon', 'track-up']
  },
  {
    id: 'proximityRadar',
    title: 'Proximity radar',
    description: 'Side/front/rear alert for cars very close by.',
    defaultPosition: { x: 780, y: 300, width: 300, height: 300 },
    requires: ['radarCars']
  },
  {
    id: 'carSilhouetteRadar',
    title: 'Silhouette radar (spotter)',
    description: 'Top-down view of your car with red edges when cars are alongside ? Crew Chief-style spotter.',
    defaultPosition: { x: 870, y: 290, width: 220, height: 310 },
    requires: ['carLeftRight']
  },
  {
    id: 'sessionWeather',
    title: 'Session + weather',
    description: 'Time remaining, lap, incidents, track, and conditions.',
    defaultPosition: { x: 1180, y: 760, width: 430, height: 210 },
    requires: ['sessionTimeRemainingSec', 'trackTempC']
  },
  {
    id: 'customValue',
    title: 'Custom value',
    description: 'Shows the result of an expression or routed output variable.',
    defaultPosition: { x: 60, y: 820, width: 280, height: 110 }
  },
  {
    id: 'gt3Cluster',
    title: 'GT3 Cluster',
    description: 'Compact cluster inspired by the Porsche GT3 Cup ICD Race page.',
    defaultPosition: { x: 690, y: 92, width: 540, height: 220 },
    requires: ['rpm', 'gear', 'speedKmh']
  },
  {
    id: 'gt3Alarm',
    title: 'GT3 Alarm',
    description: 'Priority alarm in Cosworth ICD style for flags, pit limiter, and vitals.',
    defaultPosition: { x: 720, y: 330, width: 480, height: 190 },
    requires: ['flags']
  },
  {
    id: 'engineVitalsStrip',
    title: 'Engine vitals strip',
    description: 'Compact bar with water, oil, oil pressure, and fuel.',
    defaultPosition: { x: 640, y: 40, width: 640, height: 92 },
    requires: ['waterTempC', 'oilTempC', 'oilPressureKpa']
  },
  {
    id: 'relativesStrip',
    title: 'Relatives strip',
    description: 'Horizontal strip with class-colored bubbles and track position — broadcast style.',
    defaultPosition: { x: 30, y: 956, width: 1860, height: 72 },
    requires: ['relatives']
  },
  {
    id: 'compactHud',
    title: 'Compact HUD',
    description: 'Rounded HUD: gear + RPM ring, KPH, RPM, position, and weather strip.',
    defaultPosition: { x: 700, y: 810, width: 520, height: 110 },
    requires: ['rpm', 'gear', 'speedKmh']
  },
  {
    id: 'symbolStatus',
    title: 'Symbol status',
    description: 'Icon panel: TC, ABS, pit limiter, fuel, engine, oil, temperature, and flags.',
    defaultPosition: { x: 20, y: 250, width: 470, height: 120 },
    requires: ['absActive', 'tcActive']
  }
  ,
  {
    id: 'revComet',
    title: 'Rev Comet',
    description: 'Comet-shaped LED ribbon for a futuristic shift point.',
    defaultPosition: { x: 660, y: 32, width: 600, height: 112 },
    requires: ['rpm', 'maxRpm']
  },
  {
    id: 'sideRadarGlyph',
    title: 'Side Radar Glyph',
    description: 'Top silhouette with green sides when clear and red sides when alongside.',
    defaultPosition: { x: 830, y: 310, width: 260, height: 260 },
    requires: ['carLeftRight'],
    tags: ['radar', 'traffic', 'trigger-only', 'release-a'],
    ...releaseAAlertMetadata('sideProximity')
  },
  {
    id: 'orbitRadar',
    title: 'Orbit Radar',
    description: 'Textless orbital radar with blips by proximity and class.',
    defaultPosition: { x: 800, y: 280, width: 320, height: 320 },
    requires: ['radarCars']
  },
  {
    id: 'relativeBeacons',
    title: 'Relative Beacons',
    description: 'Nearby car markers along a lap axis, without text rows.',
    defaultPosition: { x: 560, y: 930, width: 800, height: 86 },
    requires: ['relatives']
  },
  {
    id: 'relativeLadder',
    title: 'Relative Ladder',
    description: 'Vertical gap ladder ahead/behind with two graphic beacons.',
    defaultPosition: { x: 1740, y: 330, width: 110, height: 360 },
    requires: ['relatives']
  },
  {
    id: 'deltaNeedle',
    title: 'Delta Needle',
    description: 'Delta arc with needle: green only when faster.',
    defaultPosition: { x: 680, y: 775, width: 360, height: 180 },
    requires: ['deltaToBestSec']
  },
  {
    id: 'deltaRibbon',
    title: 'Delta Ribbon',
    description: 'Central delta line with hot/cold performance marker.',
    defaultPosition: { x: 650, y: 690, width: 520, height: 90 },
    requires: ['deltaToBestSec']
  },
  {
    id: 'gearRing',
    title: 'Gear Ring',
    description: 'Giant gear inside an RPM ring, minimal and symbolic.',
    defaultPosition: { x: 850, y: 130, width: 230, height: 230 },
    requires: ['gear', 'rpm']
  },
  {
    id: 'speedGlyph',
    title: 'Speed Glyph',
    description: 'Speed as a numeric glyph with a graphic segmented bar.',
    defaultPosition: { x: 780, y: 720, width: 360, height: 130 },
    requires: ['speedKmh']
  },
  {
    id: 'fuelOrb',
    title: 'Fuel Orb',
    description: 'Fuel orb with circular gauge and color-coded state.',
    defaultPosition: { x: 52, y: 500, width: 180, height: 180 },
    requires: ['fuelLiters']
  },
  {
    id: 'fuelPips',
    title: 'Fuel Pips',
    description: 'Segmented range pips by laps, nearly text-free.',
    defaultPosition: { x: 50, y: 690, width: 390, height: 92 },
    requires: ['fuelLiters']
  },
  {
    id: 'inputsVector',
    title: 'Inputs Vector',
    description: 'Pedals as vector columns and a steering point.',
    defaultPosition: { x: 1470, y: 610, width: 260, height: 220 },
    requires: ['throttle', 'brake']
  },
  {
    id: 'inputsScope',
    title: 'Inputs Scope',
    description: 'Graphic oscilloscope for throttle/brake/clutch.',
    defaultPosition: { x: 1380, y: 610, width: 390, height: 180 },
    requires: ['throttle', 'brake']
  },
  {
    id: 'tyreHaloGrid',
    title: 'Tyre Halo Grid',
    description: 'Four tire halos with wear and temperature by color.',
    defaultPosition: { x: 50, y: 125, width: 260, height: 260 },
    requires: ['tyres']
  },
  {
    id: 'brakeHeatTiles',
    title: 'Brake Heat Tiles',
    description: 'Brake grid in thermal tiles for detecting overheating.',
    defaultPosition: { x: 325, y: 125, width: 220, height: 220 },
    requires: ['brakeTempC']
  },
  {
    id: 'trackRibbonFuture',
    title: 'Track Ribbon Future',
    description: 'Simplified orbital map with cars as particles on the trajectory.',
    defaultPosition: { x: 690, y: 815, width: 540, height: 190 },
    requires: ['lapDistPct']
  },
  {
    id: 'trackSectorPulse',
    title: 'Track Sector Pulse',
    description: 'Lap progression by sectors/segmented pulses.',
    defaultPosition: { x: 610, y: 965, width: 700, height: 70 },
    requires: ['lapDistPct']
  },
  {
    id: 'weatherGripGlyph',
    title: 'Weather Grip Glyph',
    description: 'Grip and wetness glyph with green only for a healthy track.',
    defaultPosition: { x: 1280, y: 820, width: 220, height: 160 },
    requires: ['gripPct']
  },
  {
    id: 'flagIconStack',
    title: 'Flag Icon Stack',
    description: 'Stack of glowing icons for flags, pit limiter, and alerts.',
    defaultPosition: { x: 720, y: 850, width: 480, height: 88 },
    requires: ['flags'],
    tags: ['flags', 'race-control', 'trigger-only', 'release-a'],
    ...releaseAAlertMetadata('raceControlFlags')
  },
  {
    id: 'gapAhead',
    title: 'Gap ahead',
    description: 'Large, readable gap to the car immediately ahead ? green when you are closing.',
    defaultPosition: { x: 1560, y: 40, width: 240, height: 150 },
    requires: ['relatives']
  },
  {
    id: 'gapBehind',
    title: 'Gap behind',
    description: 'Large, readable gap to the car immediately behind ? green when you are pulling away.',
    defaultPosition: { x: 1560, y: 210, width: 240, height: 150 },
    requires: ['relatives']
  },
  // ─── R16 batch — futuristic overlays ──────────────────────────────────────
  {
    id: 'ersBattery',
    title: 'ERS Battery',
    description: 'Hybrid battery/ERS in neon cells with charge ring ? green only with a full pack.',
    defaultPosition: { x: 60, y: 430, width: 240, height: 150 },
    requires: ['ersBatteryPct']
  },
  {
    id: 'ersFlow',
    title: 'ERS Flow',
    description: 'ERS deploy/harvest band with energy scan; orange flare when push-to-pass triggers.',
    defaultPosition: { x: 60, y: 600, width: 380, height: 84 },
    requires: ['ersBatteryPct']
  },
  {
    id: 'pushToPassHud',
    title: 'Push-to-Pass HUD',
    description: 'Highlighted P2P boost — green when ready, pulsing orange when active, with remaining uses.',
    defaultPosition: { x: 840, y: 300, width: 220, height: 160 },
    requires: ['pushToPass', 'pushToPassCount'],
    tags: ['push-to-pass', 'strategy', 'trigger-only', 'release-a'],
    ...releaseAAlertMetadata('pushToPassState')
  },
  {
    id: 'pitStatusHud',
    title: 'Pit Status HUD',
    description: 'Pit lane HUD with headline and lamps for repair, box, and service ? green when pits are open.',
    defaultPosition: { x: 700, y: 540, width: 380, height: 140 },
    requires: ['pit']
  },
  {
    id: 'coldPressureGrid',
    title: 'Cold Pressure Grid',
    description: 'Cold pressures for all 4 tires in LF/RF/LR/RR columns; out-of-balance corner lights orange.',
    defaultPosition: { x: 50, y: 120, width: 250, height: 230 },
    requires: ['tireColdPressuresKpa']
  },
  {
    id: 'trackClock',
    title: 'Track Clock',
    description: 'Session time with sun/moon arc ? amber by day, blue at night (SessionTimeOfDay).',
    defaultPosition: { x: 1620, y: 760, width: 230, height: 170 },
    requires: ['sessionTimeOfDay']
  },
  {
    id: 'wetRadar',
    title: 'Wet Radar',
    description: 'Wet track alert with rain scanlines and WET DECLARED banner — green when dry.',
    defaultPosition: { x: 1200, y: 800, width: 300, height: 130 },
    requires: ['isRaining', 'trackWetnessPct']
  },
  {
    id: 'surfaceScope',
    title: 'Surface Scope',
    description: 'Surface material under the car; pulses red when leaving the track (grass/dirt/gravel).',
    defaultPosition: { x: 870, y: 470, width: 200, height: 170 },
    requires: ['trackSurfaceMaterial']
  },
  {
    id: 'neonGearBar',
    title: 'Neon Gear Bar',
    description: 'Neon RPM band with giant gear and speed; blue flash at the optimal shift point.',
    defaultPosition: { x: 660, y: 40, width: 600, height: 120 },
    requires: ['rpm', 'gear', 'speedKmh']
  },
  {
    id: 'apexRadar',
    title: 'Apex Radar',
    description: 'Sci-fi proximity radar with sweep line and class blips; threats in red.',
    defaultPosition: { x: 800, y: 280, width: 300, height: 300 },
    requires: ['radarCars']
  },
  // ─── R16 batch — minimalist overlays ──────────────────────────────────────
  {
    id: 'ersBar',
    title: 'ERS Bar',
    description: 'Thin ERS charge bar with percentage readout ? clean, monochrome with 1 accent.',
    defaultPosition: { x: 60, y: 760, width: 240, height: 84 },
    requires: ['ersBatteryPct']
  },
  {
    id: 'pushToPassPips',
    title: 'Push-to-Pass Pips',
    description: 'Remaining P2P uses as minimalist pips ? green while boost is available.',
    defaultPosition: { x: 840, y: 480, width: 220, height: 84 },
    requires: ['pushToPassCount']
  },
  {
    id: 'pitTicket',
    title: 'Pit Ticket',
    description: 'Minimal pit card with status headline and accent dot ? green when pits are open.',
    defaultPosition: { x: 700, y: 700, width: 260, height: 96 },
    requires: ['pit']
  },
  {
    id: 'coldPressureCard',
    title: 'Cold Pressure Card',
    description: 'Cold tire pressures in a 2?2 card (psi); highlights the coldest corner.',
    defaultPosition: { x: 60, y: 360, width: 250, height: 130 },
    requires: ['tireColdPressuresKpa']
  },
  {
    id: 'sessionClock',
    title: 'Session Clock',
    description: 'Session clock HH:MM with sun/moon glyph and day phase ? blue only at night.',
    defaultPosition: { x: 1640, y: 40, width: 200, height: 120 },
    requires: ['sessionTimeOfDay']
  },
  {
    id: 'wetTag',
    title: 'Wet Tag',
    description: 'DRY/WET chip with wetness percentage ? green when dry, amber/red when wet.',
    defaultPosition: { x: 1280, y: 960, width: 220, height: 100 },
    requires: ['trackWetnessPct'],
    tags: ['weather', 'wetness', 'trigger-only', 'release-a'],
    ...releaseAAlertMetadata('trackWetness')
  },
  {
    id: 'surfaceTag',
    title: 'Surface Tag',
    description: 'Minimal surface-material tag with green/amber/red status dot.',
    defaultPosition: { x: 880, y: 660, width: 220, height: 96 },
    requires: ['trackSurfaceMaterial']
  },
  {
    id: 'bopBadge',
    title: 'BoP Badge',
    description: 'BoP ballast (kg) and power adjustment (%) ? amber with handicap, green when clean.',
    defaultPosition: { x: 60, y: 870, width: 250, height: 120 },
    requires: ['weightPenaltyKg', 'powerAdjustPct']
  },
  {
    id: 'deltaBar',
    title: 'Delta Bar',
    description: 'Delta bar centered on zero ? green to the left when faster, orange to the right when slower.',
    defaultPosition: { x: 700, y: 690, width: 360, height: 90 },
    requires: ['deltaToBestSec']
  },
  {
    id: 'lapReadout',
    title: 'Lap Readout',
    description: 'Leitura limpa de last lap, melhor lap e delta — acento na melhor lap.',
    defaultPosition: { x: 60, y: 690, width: 300, height: 150 },
    requires: ['lastLapTimeSec', 'bestLapTimeSec']
  },
  // ─── WS-H: predictor overlays ────────────────────────────────────────────────
  {
    id: 'predCatchAhead',
    title: 'Predictor ? Time to catch',
    description: 'Estimated time and laps to catch the car ahead.',
    defaultPosition: { x: 60, y: 300, width: 300, height: 120 }
  },
  {
    id: 'predCaughtBehind',
    title: 'Predictor ? Threat behind',
    description: 'Estimated time and laps until the car behind catches you.',
    defaultPosition: { x: 60, y: 430, width: 300, height: 120 }
  },
  {
    id: 'predFuelMargin',
    title: 'Predictor ? Fuel to the end',
    description: 'Projected fuel margin to the end of the race.',
    defaultPosition: { x: 60, y: 560, width: 300, height: 120 }
  },
  {
    id: 'predTireWear',
    title: 'Predictor ? Tire wear/cliff',
    description: 'Wear per lap and estimated laps until the grip cliff.',
    defaultPosition: { x: 60, y: 690, width: 320, height: 130 }
  },
  {
    id: 'predPaceProjected',
    title: 'Preditor · Pace projetado',
    description: 'Projected pace for the next laps with confidence level.',
    defaultPosition: { x: 60, y: 830, width: 300, height: 120 }
  },
  // ─── WS-M: coaching heatmap overlay ──────────────────────────────────────────
  {
    id: 'coachHeatmap',
    title: 'Coaching heatmap',
    description:
      'Track map colored by corner (red=losing, green=baseline, blue=best) ? quick read.',
    defaultPosition: { x: 1560, y: 380, width: 260, height: 260 }
  },
  // ─── R19: Live Coach / AI Engineer text + graph overlays ─────────────────────
  {
    id: 'coachTips',
    title: 'Coach — tips',
    description: 'The top actionable Live Coach tips as text (newest first).',
    defaultPosition: { x: 1560, y: 60, width: 280, height: 150 }
  },
  {
    id: 'coachFindings',
    title: 'Coach — lista de pontos',
    description: 'Compact list of Live Coach improvement/gain points by corner/sector.',
    defaultPosition: { x: 1560, y: 220, width: 280, height: 200 }
  },
  {
    id: 'coachSectorGraph',
    title: 'Coach ? chart by sector',
    description: 'Bars by sector: green = on baseline, orange = time lost.',
    defaultPosition: { x: 1560, y: 430, width: 280, height: 150 }
  },
  {
    id: 'engineerFeed',
    title: 'Engineer — messages',
    description: 'Latest AI Engineer messages in radio style (newest first).',
    defaultPosition: { x: 60, y: 60, width: 300, height: 150 }
  }
  // ── WS-DASH: full-frame dashboards moved OUT of the floating-overlay picker ──
  // gridStackDash, gridProDash, bosch296Dash, ringDash, lmuEnduranceDash and
  // lmuStintDash are full-SCREEN dashboards, not floating overlays, so they are no
  // longer registered here (they no longer appear in the Overlays picker). They
  // now live in the DASHBOARDS system as BUILTIN_PRESETS (shared/dashboards.ts),
  // embedded via a single `overlaywidget` element. Their OverlayWidgetId union
  // members AND WIDGET_COMPONENTS entries (overlay/widgets/index.ts) intentionally
  // STAY so the dashboard embed can still resolve each component by id.
  ,
  { id: 'perCornerTyrePressure', title: 'Tire pressure (corners)', description: 'Pressure by corner (2×2) with target band. Live on ACC/LMU; explicitly cold-labelled on iRacing.', defaultPosition: { x: 1500, y: 60, width: 300, height: 200 }, requires: ['liveTyrePressureKpa'], alternativeRequires: [['tireColdPressuresKpa']] },
  { id: 'brakeTempCorners', title: 'Brake temperature (corners)', description: 'Disc temperature by corner (2×2) with cold/optimal/hot bands + peak.', defaultPosition: { x: 1500, y: 280, width: 300, height: 200 }, requires: ['brakeTempC'] },
  { id: 'fuelDeltaTile', title: 'Fuel delta', description: 'Lap margin, L/lap, laps to empty, and liters delta to target.', defaultPosition: { x: 1500, y: 500, width: 300, height: 180 }, requires: ['fuelLiters', 'fuelPerLapLiters'] },
  { id: 'shiftPointBar', title: 'Shift point', description: 'Large LED shift bar + RPM/gear, with redline flash.', defaultPosition: { x: 560, y: 40, width: 800, height: 90 }, requires: ['shiftIndicatorPct'] },
  { id: 'engineVitalsDial', title: 'Engine vitals (dials)', description: 'Water/oil gauges (?C) and oil pressure (bar).', defaultPosition: { x: 60, y: 500, width: 360, height: 180 }, requires: ['waterTempC'] },
  { id: 'sessionInfoTile', title: 'Session info', description: 'Session type, time remaining, laps, position, and incidents.', defaultPosition: { x: 60, y: 60, width: 360, height: 150 }, requires: ['sessionType'] }
  ,
  // ─── B-widgets: overlays for the new iRacing telemetry signals ───────────────
  {
    id: 'engineTellTales',
    title: 'Engine warnings',
    description: 'FIA lamp panel: oil pressure/temperature and water, fuel, rev/pit limiter, engine stopped, and required/optional repair.',
    defaultPosition: { x: 60, y: 240, width: 360, height: 200 },
    requires: ['engineWarnings'],
    tags: ['engine', 'warning', 'trigger-only', 'release-a'],
    ...releaseAAlertMetadata('engineWarnings')
  },
  {
    id: 'absCut',
    title: 'ABS cut',
    description: 'ABS brake pressure cut bar (BrakeABSCutPct, 0?100%). Complements the ABS lamp.',
    defaultPosition: { x: 60, y: 460, width: 300, height: 96 },
    requires: ['absCutPct'],
    tags: ['abs', 'intervention', 'trigger-only', 'release-a'],
    ...releaseAAlertMetadata('absCut')
  },
  {
    id: 'sessionBanner',
    title: 'Session state',
    description: 'Strip with session phase: GET IN / WARMUP / PARADE / RACING / CHECKERED / COOLDOWN.',
    defaultPosition: { x: 700, y: 40, width: 320, height: 110 },
    requires: ['sessionState']
  },
  {
    id: 'paceRestart',
    title: 'Pace / restart',
    description: 'Pace mode (single/double-file start/restart, not pacing) + active flags (end of line / free pass / waved around).',
    defaultPosition: { x: 700, y: 170, width: 360, height: 150 },
    requires: ['paceMode'],
    tags: ['pace', 'race-control', 'trigger-only', 'release-a'],
    ...releaseAAlertMetadata('paceMode')
  },
  {
    id: 'sideProximity',
    title: 'Side proximity (2-car)',
    description: 'Side blind spot: distinguishes one car alongside from TWO (CAR LEFT vs 2 LEFT / 3-wide) using carLeftRightCount.',
    defaultPosition: { x: 800, y: 600, width: 320, height: 140 },
    requires: ['carLeftRight', 'carLeftRightCount'],
    tags: ['radar', 'traffic', 'trigger-only', 'release-a'],
    ...releaseAAlertMetadata('sideProximity')
  },
  // ─── T4: GT3 instrument-style cluster widgets (brand-neutral) ───────────────
  // Each is BOTH a floating overlay (here) AND a dashboard-catalog widget. `requires`
  // lists the LIVE telemetry each needs so the per-sim filter only offers it where the
  // sim publishes those fields, and computes the "(IR/…)" support prefix.
  {
    id: 'analogTach',
    title: 'Analog tachometer',
    description: 'Round analog tachometer with needle sweeping an arc, redline zone, and digital gear + speed in the center.',
    defaultPosition: { x: 820, y: 120, width: 240, height: 260 },
    requires: ['rpm', 'maxRpm', 'gear', 'speedKmh']
  },
  {
    id: 'cupCluster',
    title: 'Cup cluster',
    description: 'Porsche-Cup-style cluster: rev LED bar on top, giant gear, and speed + delta below.',
    defaultPosition: { x: 800, y: 120, width: 300, height: 300 },
    requires: ['rpm', 'maxRpm', 'gear', 'speedKmh']
  },
  {
    id: 'enduranceMulti',
    title: 'Endurance multifunction',
    description: 'Endurance multifunction panel: stint timer, fuel to the end, laps remaining, tire temperatures/pressures, and water/oil.',
    defaultPosition: { x: 60, y: 120, width: 380, height: 320 },
    requires: ['fuelLiters', 'tyres']
  },
  {
    id: 'oledStrip',
    title: 'OLED strip',
    description: 'Minimalist horizontal strip: gear | speed | mini LED bar | delta | fuel, for a narrow overlay.',
    defaultPosition: { x: 560, y: 40, width: 720, height: 72 },
    requires: ['gear', 'speedKmh']
  },
  {
    id: 'motecDense',
    title: 'MoTeC data panel',
    description: 'Dense MoTeC/AiM-style panel: gear/speed/rpm/delta/lap/fuel/temperatures + TC/ABS/MAP/BB in a hairline grid.',
    defaultPosition: { x: 60, y: 120, width: 420, height: 260 },
    requires: ['rpm', 'gear', 'speedKmh']
  },
  {
    id: 'gt3Wheel',
    title: 'GT3 wheel face',
    description: 'GT3 steering wheel face: telltale lamps (flags/TC/ABS/pit/rain) above TC / ABS / MAP / BB rotary buttons with their current levels.',
    defaultPosition: { x: 700, y: 480, width: 360, height: 240 },
    requires: ['absLevel', 'tcLevel']
  }
]

export function createDefaultOverlaysConfig(): OverlaysConfig {
  return {
    configMode: false,
    overlayCompositorEnabled: false,
    widgets: Object.fromEntries(
      OVERLAY_WIDGETS.map((widget) => [
        widget.id,
        {
          id: widget.id,
          enabled: false,
          locked: false,
          favorite: false,
          position: { ...widget.defaultPosition },
          opacity: 100,
          stylePreset: DEFAULT_OVERLAY_STYLE_PRESET,
          style: createDefaultOverlayStyle(),
          ...(widget.role ? { role: widget.role } : {}),
          ...(widget.defaultTrigger ? { trigger: widget.defaultTrigger } : {}),
          display: null
        }
      ])
    ) as Record<OverlayWidgetId, OverlayWidgetConfig>,
    customOverlays: []
  }
}

// ─── iRacing fullscreen detection / auto-switch (feedback: overlays in fullscreen)
// Window overlays cannot draw over DirectX *exclusive* fullscreen. The app reads
// the iRacing app.ini to report the current display mode and can switch the sim
// to borderless (backup + restart required). Types shared by main + renderer.
export type IracingDisplayMode = 'exclusive' | 'borderless' | 'windowed' | 'unknown'

export interface IracingGraphicsStatus {
  supported: boolean
  platform: string
  iniPath: string | null
  exists: boolean
  mode: IracingDisplayMode
  fullScreen: boolean | null
  borderlessWindowed: boolean | null
  overlaysWillShow: boolean
  message: string
}

export interface FixIracingFullscreenResult {
  ok: boolean
  changed: boolean
  backupPath: string | null
  message: string
}
