import { Component, useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ErrorInfo, ReactElement } from 'react'
import type { CustomOverlayDef, CustomOverlayElement, CustomOverlayElementAlign, CustomOverlayListItem, IracingGraphicsStatus, FixIracingFullscreenResult, OverlayListItem, OverlayPosition, OverlayWidgetId, OverlayWidgetStyle, OverlaysConfig } from '../../../shared/overlays'
import {
  createCustomOverlayDef,
  createCustomOverlayElement,
  createRichCustomOverlayDef,
  isRichCustomOverlay,
  OVERLAY_FORMS,
  overlayDesignFamily,
  overlayWidgetDisplayTitle,
  type OverlayWidgetDefinition
} from '../../../shared/overlays'
import type { Corners, DriverEntry, Flags, PitStatus, RadarCarEntry, RelativeCars, SimId, TelemetrySnapshot, TyreInfo } from '../../../shared/telemetry'
import { PLAYABLE_SIMS, simLabel, widgetSupportedSims } from '../../../shared/sim-coverage'
import { compareCatalogEntries, compareCreatedAtEntries } from '../../../shared/catalog-order'
import { OverlayWidgetBuilder } from './overlay/OverlayWidgetBuilder'
import { consumeEditorTarget } from '../lib/app-navigation'
import { EXPR_CHANNELS, type ExpressionDef } from '../../../shared/expr'
import { IRACING_VARIABLES, IRACING_VAR_CATEGORY_LABELS, IRACING_VAR_CATEGORY_ORDER } from '../../../shared/iracing-vars'
import type { AppViewProps } from '../App'
import type { AlertsConfig } from '../../../shared/alerts'
import { tt } from '../i18n'
import { useDevices } from '../lib/devices/DeviceRegistry'
import { SectionExportImport } from '../components/SectionExportImport'
import {
  TriggerPreviewToggle,
  useEditorTriggerPreviewPreference,
  useOverlayPositioningPreviewChannel
} from '../components/TriggerPreviewToggle'
import { TagFilter, filterByTags } from '../components/TagFilter'
import { ALL_OVERLAY_WIDGETS, createDefaultOverlaysConfigWithHifi, hasAllHifiOverlayConfigs, mergeHifiOverlayConfigs, mergeHifiOverlayItems, resolveOverlayTrigger } from '../overlay/hifi-overlays'
import { resolveWidgetComponent } from '../overlay/widgets'
import { useAlertsConfig } from '../lib/alerts-config'
import {
  createEditorTriggerPreviewFrame,
  resolveEditorPreviewTrigger
} from '../overlay/editor-trigger-preview'
import '../overlay/overlay-runtime.css'
import '../overlay/overlay-view.css'

const POSITION_KEYS: Array<keyof OverlayPosition> = ['x', 'y', 'width', 'height']
const ELEMENT_BOX_KEYS: Array<keyof Pick<CustomOverlayElement, 'x' | 'y' | 'width' | 'height'>> = ['x', 'y', 'width', 'height']
const DECIMALS_OPTIONS: string[] = [
  'auto',
  '0',
  '1',
  '2',
  '3',
  '4'
]
const ALIGN_OPTIONS: CustomOverlayElementAlign[] = ['left', 'center', 'right']
const FONT_OPTIONS = [
  'Segoe UI, sans-serif',
  'Bahnschrift, Segoe UI, sans-serif',
  'DIN Condensed, Bahnschrift, Segoe UI, sans-serif',
  'Consolas, Cascadia Mono, monospace'
]

const PREVIEW_MAX_W = 290
const PREVIEW_MAX_H = 150

function corners<T>(lf: T, rf: T, lr: T, rr: T): Corners<T> {
  return { lf, rf, lr, rr }
}

function previewTyre(tempC: number, wearPct: number, pressureKpa: number): TyreInfo {
  return {
    tempC,
    tempLeftC: tempC + 6,
    tempMiddleC: tempC,
    tempRightC: tempC - 4,
    surfaceTempLeftC: tempC + 10,
    surfaceTempMiddleC: tempC + 3,
    surfaceTempRightC: tempC - 1,
    pressureKpa,
    wearPct
  }
}

function previewFlags(): Flags {
  return {
    green: true,
    yellow: true,
    blue: false,
    white: false,
    checkered: false,
    red: false,
    black: false,
    meatball: false,
    repair: false,
    disqualify: false,
    greenWhiteCheckered: false
  }
}

function previewDrivers(): DriverEntry[] {
  const gt3 = '#E8A23D'
  const gt4 = '#49C5B1'
  const lmp = '#7AA2FF'
  return [
    { carIdx: 2, name: 'L. Hoffmann', carNumber: '11', position: 1, classPosition: 1, classId: 1, className: 'GT3', classColor: gt3, gapToPlayerSec: -18.4, lapDistPct: 0.61, lastLapTimeSec: 102.31, iRating: 5240, license: 'A 4.21', isPlayer: false },
    { carIdx: 4, name: 'M. Rossi', carNumber: '23', position: 2, classPosition: 2, classId: 1, className: 'GT3', classColor: gt3, gapToPlayerSec: -9.8, lapDistPct: 0.55, lastLapTimeSec: 102.66, iRating: 4880, license: 'A 3.97', isPlayer: false },
    { carIdx: 9, name: 'K. Tanaka', carNumber: '7', position: 3, classPosition: 3, classId: 1, className: 'GT3', classColor: gt3, gapToPlayerSec: -1.42, lapDistPct: 0.50, lastLapTimeSec: 102.95, iRating: 4510, license: 'A 3.55', inPits: false, isPlayer: false },
    { carIdx: 7, name: 'G. Basso', carNumber: '42', position: 4, classPosition: 4, classId: 1, className: 'GT3', classColor: gt3, gapToPlayerSec: 0, lapDistPct: 0.485, lastLapTimeSec: 103.12, iRating: 4320, license: 'A 3.40', isPlayer: true },
    { carIdx: 12, name: 'F. Dubois', carNumber: '88', position: 5, classPosition: 5, classId: 1, className: 'GT3', classColor: gt3, gapToPlayerSec: 0.88, lapDistPct: 0.47, lastLapTimeSec: 103.40, iRating: 4180, license: 'A 3.12', isPlayer: false },
    { carIdx: 18, name: 'S. Novak', carNumber: '5', position: 6, classPosition: 6, classId: 1, className: 'GT3', classColor: gt3, gapToPlayerSec: 4.6, lapDistPct: 0.41, lastLapTimeSec: 103.77, iRating: 3990, license: 'B 4.05', isPlayer: false },
    { carIdx: 21, name: 'A. Costa', carNumber: '14', position: 7, classPosition: 1, classId: 2, className: 'GT4', classColor: gt4, gapToPlayerSec: 11.9, lapDistPct: 0.33, lastLapTimeSec: 108.21, iRating: 3120, license: 'B 3.44', isPlayer: false },
    { carIdx: 25, name: 'R. Meyer', carNumber: '57', position: 8, classPosition: 2, classId: 2, className: 'GT4', classColor: gt4, gapToPlayerSec: 16.2, lapDistPct: 0.28, lastLapTimeSec: 108.66, iRating: 2870, license: 'C 3.90', inPits: true, isPlayer: false },
    { carIdx: 31, name: 'P. Andersen', carNumber: '3', position: 9, classPosition: 1, classId: 3, className: 'LMP3', classColor: lmp, gapToPlayerSec: 22.7, lapDistPct: 0.20, lastLapTimeSec: 99.84, iRating: 6010, license: 'A 4.80', isPlayer: false },
    { carIdx: 33, name: 'T. Weber', carNumber: '19', position: 10, classPosition: 7, classId: 1, className: 'GT3', classColor: gt3, gapToPlayerSec: -25.1, lapsBehind: 0, lapDistPct: 0.72, lastLapTimeSec: 104.02, iRating: 3760, license: 'B 2.98', isPlayer: false }
  ]
}

function previewRelatives(): RelativeCars {
  return {
    ahead: { carIdx: 9, name: 'K. Tanaka', carNumber: '7', position: 3, classPosition: 3, gapSec: -1.42, lastLapTimeSec: 102.95, classColor: '#E8A23D' },
    behind: { carIdx: 12, name: 'F. Dubois', carNumber: '88', position: 5, classPosition: 5, gapSec: 0.88, lastLapTimeSec: 103.40, classColor: '#E8A23D' }
  }
}

function previewRadar(): RadarCarEntry[] {
  return [
    { carIdx: 12, name: 'F. Dubois', relativeX: -2.1, relativeY: 1.4, gapSec: 0.31, classColor: '#E8A23D' },
    { carIdx: 25, name: 'R. Meyer', relativeX: 3.0, relativeY: -6.2, gapSec: 0.74, classColor: '#49C5B1' }
  ]
}

function previewPit(): PitStatus {
  return { repairNeeded: false, optRepairNeeded: true, pitsOpen: true, inPitStall: false, svStatus: 0 }
}

function createOverlayPreviewSnapshot(): TelemetrySnapshot {
  const maxRpm = 8200
  const rpm = 7480
  return {
    sim: 'iracing',
    connected: true,
    timestamp: Date.now(),
    speedKmh: 214,
    rpm,
    gear: 4,
    maxRpm,
    engineRunning: true,
    shiftIndicatorPct: 0.86,
    shiftRpm: 7850,
    revLights: { firstRpm: 6200, shiftRpm: 7850, lastRpm: 8050, blinkRpm: 8100, pct: 0.86, blink: false },
    throttle: 0.83,
    brake: 0,
    clutch: 0,
    steerAngleDeg: -14,
    latAccelG: -1.18,
    longAccelG: 0.42,
    vertAccelG: 0.06,
    yawRateRadSec: 0.21,
    drs: false,
    absActive: false,
    absEnabled: true,
    absLevel: 3,
    tcActive: true,
    tcEnabled: true,
    tcLevel: 4,
    engineMap: 5,
    brakeBiasPct: 54.5,
    handbrake: 0,
    waterTempC: 96,
    oilTempC: 108,
    oilPressureKpa: 470,
    ersBatteryPct: 0.62,
    pushToPass: true,
    pushToPassCount: 6,
    sessionType: 'Race',
    carName: 'Mercedes-AMG GT3 Evo',
    trackName: 'Spa-Francorchamps',
    sessionTimeRemainingSec: 1865,
    lapsRemaining: 18,
    currentLap: 12,
    lapDistPct: 0.485,
    lastLapTimeSec: 103.12,
    bestLapTimeSec: 102.88,
    currentLapTimeSec: 47.36,
    estimatedLapTimeSec: 102.74,
    deltaToBestSec: -0.143,
    deltaToSessionBestSec: 0.212,
    position: 4,
    classPosition: 4,
    totalCars: 24,
    strengthOfField: 4180,
    sessionUniqueId: 990217,
    driverName: 'G. Basso',
    sessionTimeOfDay: 15 * 3600 + 42 * 60,
    weightPenaltyKg: 15,
    powerAdjustPct: -1.5,
    fuelLiters: 38.4,
    fuelPerLap: 2.86,
    fuelUsePerHourKg: 71.5,
    fuelPerLapKg: 2.12,
    fuelCapacityLiters: 120,
    tyres: corners(
      previewTyre(88, 0.91, 168),
      previewTyre(94, 0.88, 171),
      previewTyre(85, 0.93, 165),
      previewTyre(90, 0.90, 167)
    ),
    brakeTempC: corners(486, 512, 372, 398),
    tireColdPressuresKpa: corners(165, 166, 163, 164),
    flags: previewFlags(),
    sessionFlagsRaw: 0,
    pitLimiter: false,
    onPitRoad: false,
    pitServiceFlags: ['fuel', 'lf', 'rf'],
    pit: previewPit(),
    incidentCount: 6,
    incidentCountMy: 6,
    incidentCountTeam: 6,
    incidentLimit: 17,
    fastRepairsUsed: 0,
    fastRepairsAvailable: 1,
    trackTempC: 34,
    airTempC: 25,
    trackWetnessPct: 0.08,
    isRaining: false,
    gripPct: 0.96,
    weatherDeclaredWet: false,
    trackSurfaceMaterial: 1,
    playerCarIdx: 7,
    drivers: previewDrivers(),
    relatives: previewRelatives(),
    radarCars: previewRadar(),
    carLeftRight: 'left',
    carLeftRightRaw: 2,
    lat: 50.4372,
    lon: 5.9714,
    velocityX: 59.4,
    velocityY: 1.2,
    yawNorth: 2.31
  }
}

const OVERLAY_PREVIEW_SNAPSHOT = createOverlayPreviewSnapshot()

// Each custom-overlay element binds to EITHER a saved expression (expressionId =
// `expr-…`) OR a raw iRacing telemetry channel. Channels are encoded in the SAME
// expressionId field as `channel:<VarId>` (e.g. `channel:Speed`), so no
// CustomOverlayElement model / persistence change is needed — the overlay widget
// resolves the var id as a trivial expression against the live TelemetrySnapshot.
const CHANNEL_BINDING_PREFIX = 'channel:'

function channelVarIdFromBinding(expressionId: string): string | null {
  return expressionId.startsWith(CHANNEL_BINDING_PREFIX) ? expressionId.slice(CHANNEL_BINDING_PREFIX.length) : null
}

// Directly-bindable telemetry channels = catalog vars that map to a
// TelemetrySnapshot field (telemetryField). Grouped by category to mirror the
// Expressions menu so the picker is always populated even with zero saved expressions.
const BINDABLE_TELEMETRY_GROUPS = IRACING_VAR_CATEGORY_ORDER
  .map((category) => ({
    category,
    label: IRACING_VAR_CATEGORY_LABELS[category],
    variables: IRACING_VARIABLES.filter((item) => item.category === category && item.telemetryField)
  }))
  .filter((group) => group.variables.length > 0)

const BINDABLE_TELEMETRY_COUNT = BINDABLE_TELEMETRY_GROUPS.reduce((sum, group) => sum + group.variables.length, 0)

function configModeFrom(items: OverlayListItem[], fallback: OverlaysConfig): OverlaysConfig {
  return {
    ...fallback,
    overlayCompositorEnabled: fallback.overlayCompositorEnabled ?? false,
    widgets: {
      ...fallback.widgets,
      ...Object.fromEntries(items.map((item) => [item.id, {
        id: item.id,
        enabled: item.enabled,
        locked: item.locked,
        favorite: item.favorite,
        position: item.position,
        display: item.display,
        opacity: item.opacity,
        stylePreset: item.stylePreset,
        style: item.style,
        hidden: item.hidden,
        role: item.role,
        trigger: item.trigger,
        hifiModuleId: item.hifiModuleId
      }]))
    } as OverlaysConfig['widgets']
  }
}

function definitionTags(def: { category?: string; tags?: string[] } | undefined): string[] {
  if (!def) return []
  return [...new Set([def.category, ...(def.tags ?? [])].filter((tag): tag is string => Boolean(tag)))]
}

// Configuration-list ordering is intentionally independent from enabled state:
// toggling an overlay must not move its card and make the page jump.
function sortOverlayEntries<T extends OverlayListItem>(entries: T[]): T[] {
  return [...entries].sort((left, right) => compareCatalogEntries(left, right, true))
}

function sortCustomOverlayEntries<T extends CustomOverlayListItem>(entries: T[]): T[] {
  return [...entries].sort(compareCreatedAtEntries)
}

class OverlayPreviewErrorBoundary extends Component<
  { id: string; fallback: string; children: ReactElement },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[overlays] preview "${this.props.id}" failed:`, error.message, info.componentStack)
  }

  render(): ReactElement {
    if (this.state.failed) return <div style={{ color: 'rgba(255,255,255,0.56)', fontSize: 12 }}>{this.props.fallback}</div>
    return this.props.children
  }
}

function overlayShellVars(config: OverlayListItem): CSSProperties {
  return {
    '--overlay-bg': config.style.background,
    '--overlay-accent': config.style.accent,
    '--overlay-border': config.style.border,
    '--overlay-radius': `${config.style.radius}px`,
    '--overlay-font': config.style.fontFamily,
    '--overlay-content-opacity': '1'
  } as CSSProperties
}

export function OverlayRuntimePreview({
  item,
  definition,
  fallback,
  alertsConfig,
  showTriggerOnlyActive
}: {
  item: OverlayListItem
  definition: OverlayWidgetDefinition | undefined
  fallback: string
  alertsConfig: AlertsConfig
  showTriggerOnlyActive: boolean
}): ReactElement {
  const Widget = resolveWidgetComponent(item.id)
  const runtimeTrigger = resolveOverlayTrigger(definition, item)
  const trigger = showTriggerOnlyActive
    ? resolveEditorPreviewTrigger(runtimeTrigger, definition?.defaultTrigger)
    : runtimeTrigger
  const triggerPreview = createEditorTriggerPreviewFrame(
    OVERLAY_PREVIEW_SNAPSHOT,
    trigger,
    showTriggerOnlyActive && definition?.role === 'alert',
    alertsConfig,
    `preview:${item.id}`,
  )
  const previewSnapshot = triggerPreview.snapshot
  const visibility = triggerPreview.visibility
  const renderWidget = definition?.role !== 'alert' || visibility.visible
  const natW = Math.max(1, item.position.width)
  const natH = Math.max(1, item.position.height)
  const scale = Math.min(1, PREVIEW_MAX_W / natW, PREVIEW_MAX_H / natH)
  const stageStyle: CSSProperties = {
    position: 'relative',
    width: Math.round(natW * scale),
    height: Math.round(natH * scale),
    margin: '0 auto',
    pointerEvents: 'none'
  }
  const shellStyle: CSSProperties = {
    ...overlayShellVars(item),
    position: 'absolute',
    top: 0,
    left: 0,
    width: natW,
    height: natH,
    opacity: Math.max(0, Math.min(100, item.opacity)) / 100,
    transform: `scale(${scale})`,
    transformOrigin: 'top left'
  }

  return (
    <div
      data-trigger-preview-visible={visibility.visible ? 'true' : 'false'}
      data-trigger-preview-forced={triggerPreview.forced ? 'true' : 'false'}
      style={{
        display: 'grid',
        placeItems: 'center',
        minHeight: PREVIEW_MAX_H + 18,
        overflow: 'hidden',
        border: '1px solid rgba(138, 164, 200, 0.16)',
        borderRadius: 14,
        background: 'rgba(2, 6, 12, 0.34)',
        backgroundImage:
          'linear-gradient(45deg, rgba(255,255,255,0.035) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.035) 75%), linear-gradient(45deg, rgba(255,255,255,0.035) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.035) 75%)',
        backgroundSize: '18px 18px',
        backgroundPosition: '0 0, 9px 9px',
        padding: 9
      }}
      aria-hidden="true"
    >
      <div style={stageStyle}>
        <main className="overlay-shell" style={shellStyle}>
          <OverlayPreviewErrorBoundary id={item.id} fallback={fallback}>
            <>
              {Widget && renderWidget
                ? (
                    <Widget
                      snapshot={previewSnapshot}
                      config={item}
                      visibility={visibility}
                      alertsConfig={triggerPreview.alertsConfig}
                    />
                  )
                : Widget
                  ? null
                  : <div>{fallback}</div>}
            </>
          </OverlayPreviewErrorBoundary>
        </main>
      </div>
    </div>
  )
}

// Flattened quick-access entry for the "Active overlays" panel — unifies built-in
// widgets and custom overlays so each can be toggled/favorited from one place.
type ActiveOverlayEntry = { id: string; title: string; favorite: boolean; kind: 'widget' | 'custom' }

function isSelectedOverlayForm(currentPreset: string | undefined, formPreset: string): boolean {
  return overlayDesignFamily(currentPreset) === overlayDesignFamily(formPreset)
}

export default function OverlaysView({ language }: AppViewProps): ReactElement {
  const [items, setItems] = useState<OverlayListItem[]>([])
  const [config, setConfig] = useState<OverlaysConfig>(createDefaultOverlaysConfigWithHifi())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [posDrafts, setPosDrafts] = useState<Record<string, string>>({})
  const [iracingGfx, setIracingGfx] = useState<IracingGraphicsStatus | null>(null)
  // Monitors/displays come from the shared device registry so Overlays and
  // Dashboards target the same screens detected in the Devices hub.
  const { displays, refreshDisplays } = useDevices()
  const [gfxNote, setGfxNote] = useState<string | null>(null)
  const [customOverlays, setCustomOverlays] = useState<CustomOverlayListItem[]>([])
  const [expressions, setExpressions] = useState<ExpressionDef[]>([])
  const [designerOpen, setDesignerOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<CustomOverlayDef | null>(null)
  // Rich widget builder ("Create new overlay") — separate from the legacy
  // expression/channel designer above.
  const [builderOpen, setBuilderOpen] = useState(false)
  const [builderEditingId, setBuilderEditingId] = useState<string | null>(null)
  const [builderDraft, setBuilderDraft] = useState<CustomOverlayDef | null>(null)
  const [editorTargetId, setEditorTargetId] = useState<string | null>(() => consumeEditorTarget('overlay'))
  const alertsConfig = useAlertsConfig()
  const enabledCount = useMemo(() => items.filter((item) => item.enabled).length, [items])
  const sortedItems = useMemo(() => sortOverlayEntries(items), [items])
  const [selectedWidgetIds, setSelectedWidgetIds] = useState<Set<string>>(() => new Set())
  const [selectedCustomIds, setSelectedCustomIds] = useState<Set<string>>(() => new Set())
  // Per-yes availability: a widget is shown for the chosen yes only when that yes's
  // live telemetry provides every field the widget requires (sim-coverage). 'all'
  // shows everything. The title is prefixed "(IR/ACC/LMU)" with its supported sims.
  const [simFilter, setSimFilter] = useState<SimId | 'all'>('all')
  const [tagFilters, setTagFilters] = useState<string[]>([])
  const [showTriggerOnlyActive, setShowTriggerOnlyActive] =
    useEditorTriggerPreviewPreference()
  useOverlayPositioningPreviewChannel(showTriggerOnlyActive)
  const tr = useCallback((key: string, vars: Record<string, string | number> = {}) => tt(language, `overlays.${key}`, vars), [language])
  const defById = useMemo(() => new Map(ALL_OVERLAY_WIDGETS.map((def) => [def.id, def])), [])
  const displayTitleFor = useCallback(
    (id: string, fallback: string): string => {
      const def = defById.get(id as OverlayWidgetId)
      return def ? overlayWidgetDisplayTitle(def) : fallback
    },
    [defById]
  )
  const simFilteredItems = useMemo(() => {
    return sortedItems.filter((item) => {
      if (item.hidden) return false
      const def = defById.get(item.id as OverlayWidgetId)
      return simFilter === 'all' ||
        !def ||
        widgetSupportedSims(def.requires, def.alternativeRequires).includes(simFilter)
    })
  }, [sortedItems, simFilter, defById])
  const hiddenItems = useMemo(() => sortedItems.filter((item) => item.hidden), [sortedItems])
  const visibleItems = useMemo(() => {
    return filterByTags(simFilteredItems, tagFilters, (item) => definitionTags(defById.get(item.id as OverlayWidgetId)))
  }, [simFilteredItems, tagFilters, defById])
  const sortedCustomOverlays = useMemo(() => sortCustomOverlayEntries(customOverlays), [customOverlays])
  const visibleCustomOverlays = useMemo(() => sortedCustomOverlays.filter((overlay) => !overlay.hidden), [sortedCustomOverlays])
  const hiddenCustomOverlays = useMemo(() => sortedCustomOverlays.filter((overlay) => overlay.hidden), [sortedCustomOverlays])
  const activeOverlays = useMemo<ActiveOverlayEntry[]>(() => [
    ...items
      .filter((item) => item.enabled && !item.hidden)
      .map((item) => ({ id: item.id, title: item.title, favorite: Boolean(item.favorite), kind: 'widget' as const })),
    ...customOverlays
      .filter((overlay) => overlay.enabled && !overlay.hidden)
      .map((overlay) => ({ id: overlay.id, title: overlay.title, favorite: Boolean(overlay.favorite), kind: 'custom' as const }))
  ], [items, customOverlays])
  const displayOptions = useMemo(() => displays.map((display) => ({
    value: String(display.id),
    label: display.label
  })), [displays])

  async function refreshIracingGfx(): Promise<void> {
    const status = await window.ipc.invoke<IracingGraphicsStatus>('overlays:iracingGraphicsStatus')
    setIracingGfx(status)
  }

  async function fixIracingFullscreen(): Promise<void> {
    const ok = window.confirm(
      tr('fixIracingConfirm')
    )
    if (!ok) return
    setBusy(true)
    setError(null)
    setGfxNote(null)
    try {
      const result = await window.ipc.invoke<FixIracingFullscreenResult>('overlays:fixIracingFullscreen')
      setGfxNote(result.message)
      await refreshIracingGfx()
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('errorAdjustIracing'))
    } finally {
      setBusy(false)
    }
  }

  async function refresh(): Promise<void> {
    const [nextItems, loadedConfig, nextCustom, nextExpressions, compositorEnabled] = await Promise.all([
      window.ipc.invoke<OverlayListItem[]>('overlays:list'),
      window.ipc.invoke<OverlaysConfig>('overlays:getConfig'),
      window.ipc.invoke<CustomOverlayListItem[]>('overlays:listCustom'),
      window.ipc.invoke<ExpressionDef[]>(EXPR_CHANNELS.getExpressions),
      window.ipc.invoke<boolean>('overlays:getCompositorEnabled')
    ])
    const nextConfig = hasAllHifiOverlayConfigs(loadedConfig)
      ? mergeHifiOverlayConfigs(loadedConfig)
      : mergeHifiOverlayConfigs(await window.ipc.invoke<OverlaysConfig>('overlays:setConfig', mergeHifiOverlayConfigs(loadedConfig)))
    setItems(mergeHifiOverlayItems(nextItems, nextConfig))
    setConfig({ ...nextConfig, overlayCompositorEnabled: Boolean(compositorEnabled) })
    setCustomOverlays(Array.isArray(nextCustom) ? nextCustom : [])
    setExpressions(Array.isArray(nextExpressions) ? nextExpressions : [])
    void refreshDisplays().catch(() => undefined)
  }

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await action()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('errorUpdate'))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refresh().catch((err) => setError(err instanceof Error ? err.message : tr('errorLoad')))
    void refreshIracingGfx().catch(() => { /* status card stays in loading state */ })
    const off = window.ipc.subscribe<OverlayListItem[]>('overlays:state', (nextItems) => {
      setConfig((current) => {
        const nextConfig = mergeHifiOverlayConfigs(configModeFrom(nextItems, current))
        setItems(mergeHifiOverlayItems(nextItems, nextConfig))
        return nextConfig
      })
    })
    const offCustom = window.ipc.subscribe<CustomOverlayListItem[]>('overlays:customState', (nextCustom) => {
      setCustomOverlays(Array.isArray(nextCustom) ? nextCustom : [])
    })
    const offCompositor = window.ipc.subscribe<boolean>('overlays:compositorEnabled', (enabled) => {
      setConfig((current) => ({ ...current, overlayCompositorEnabled: Boolean(enabled) }))
    })
    return () => {
      off()
      offCustom()
      offCompositor()
    }
  }, [tr])

  function patchItem(id: OverlayWidgetId, patch: Partial<OverlayListItem>): void {
    setItems((currentItems) => currentItems.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  function positionDraftKey(id: OverlayWidgetId, key: keyof OverlayPosition): string {
    return `${id}:${key}`
  }

  function onPositionInput(id: OverlayWidgetId, key: keyof OverlayPosition, raw: string): void {
    setPosDrafts((drafts) => ({ ...drafts, [positionDraftKey(id, key)]: raw }))
    const numericValue = Number(raw)
    // Live-update the preview only when the field holds a complete number.
    // Intermediate states like "" or "-" stay as drafts so the user can type
    // negative coordinates (secondary monitor positioned left of / above the
    // primary one), which a controlled type="number" input silently dropped.
    if (raw.trim() !== '' && raw.trim() !== '-' && Number.isFinite(numericValue)) {
      const current = items.find((item) => item.id === id)
      if (current) patchItem(id, { position: { ...current.position, [key]: numericValue } })
    }
  }

  function commitPosition(id: OverlayWidgetId, key: keyof OverlayPosition): void {
    const draftKey = positionDraftKey(id, key)
    const raw = posDrafts[draftKey]
    setPosDrafts((drafts) => {
      const next = { ...drafts }
      delete next[draftKey]
      return next
    })
    const current = items.find((item) => item.id === id)
    if (!current) return
    const numericValue = raw === undefined ? current.position[key] : Number(raw)
    const nextPosition = Number.isFinite(numericValue)
      ? { ...current.position, [key]: numericValue }
      : current.position
    patchItem(id, { position: nextPosition })
    void run(async () => {
      await window.ipc.invoke('overlays:setPosition', id, nextPosition)
    })
  }

  function selectedDisplayValue(item: OverlayListItem): string {
    if (!item.display) return 'auto'
    return displays.some((display) => display.id === item.display?.id) ? String(item.display.id) : `missing:${item.display.id}`
  }

  function selectedDisplayLabel(item: OverlayListItem): string {
    if (!item.display) return tr('displayAuto')
    return displays.find((display) => display.id === item.display?.id)?.label ?? tr('displayMissing', { width: item.display.bounds.width, height: item.display.bounds.height })
  }

  function changeDisplay(id: OverlayWidgetId, value: string): void {
    const parsed = value === 'auto' || value.startsWith('missing:') ? null : Number(value)
    const displayId = typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
    void run(async () => {
      const nextItems = await window.ipc.invoke<OverlayListItem[]>('overlays:setDisplayTarget', id, displayId)
      setItems(nextItems)
    })
  }

  function updateStyle(id: OverlayWidgetId, key: keyof OverlayWidgetStyle, value: string | number): void {
    const current = items.find((item) => item.id === id)
    if (!current) return
    patchItem(id, { style: { ...current.style, [key]: value } })
  }

  function toggleEditMode(): void {
    void run(async () => {
      const next = await window.ipc.invoke<OverlaysConfig>('overlays:setConfig', { configMode: !config.configMode })
      setConfig((current) => ({ ...next, overlayCompositorEnabled: current.overlayCompositorEnabled ?? false }))
    })
  }

  function toggleCompositorMode(): void {
    void run(async () => {
      const enabled = await window.ipc.invoke<boolean>('overlays:setCompositorEnabled', !config.overlayCompositorEnabled)
      setConfig((current) => ({ ...current, overlayCompositorEnabled: enabled }))
    })
  }

  function patchCustomLocal(id: string, patch: Partial<CustomOverlayListItem>): void {
    setCustomOverlays((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  function applyCustomPatch(id: string, patch: Partial<CustomOverlayDef>): void {
    void run(async () => {
      const next = await window.ipc.invoke<CustomOverlayListItem[]>('overlays:updateCustom', id, patch)
      if (Array.isArray(next)) setCustomOverlays(next)
    })
  }

  function toggleWidgetSelected(id: string): void {
    setSelectedWidgetIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleCustomSelected(id: string): void {
    setSelectedCustomIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function setWidgetHidden(ids: string[], hidden: boolean): void {
    if (ids.length === 0) return
    void run(async () => {
      for (const id of ids) {
        await window.ipc.invoke<OverlayListItem[]>('overlays:setHidden', id as OverlayWidgetId, hidden)
      }
      setSelectedWidgetIds(new Set())
    })
  }

  function setCustomHidden(ids: string[], hidden: boolean): void {
    if (ids.length === 0) return
    void run(async () => {
      for (const id of ids) {
        await window.ipc.invoke<CustomOverlayListItem[]>('overlays:updateCustom', id, { hidden })
      }
      setSelectedCustomIds(new Set())
    })
  }

  function toggleWidgetFavorite(id: OverlayWidgetId, favorite: boolean): void {
    void run(async () => {
      const nextItems = await window.ipc.invoke<OverlayListItem[]>('overlays:setFavorite', id, favorite)
      setItems(nextItems)
    })
  }

  function toggleActiveFavorite(entry: ActiveOverlayEntry): void {
    if (entry.kind === 'widget') toggleWidgetFavorite(entry.id as OverlayWidgetId, !entry.favorite)
    else applyCustomPatch(entry.id, { favorite: !entry.favorite })
  }

  function deactivateOverlay(entry: ActiveOverlayEntry): void {
    if (entry.kind === 'widget') {
      void run(async () => {
        const nextItems = await window.ipc.invoke<OverlayListItem[]>('overlays:toggle', entry.id as OverlayWidgetId, false)
        setItems(nextItems)
      })
    } else {
      applyCustomPatch(entry.id, { enabled: false })
    }
  }

  function removeCustomOverlay(id: string): void {
    if (!window.confirm(tr('removeCustomConfirm'))) return
    void run(async () => {
      const next = await window.ipc.invoke<CustomOverlayListItem[]>('overlays:removeCustom', id)
      if (Array.isArray(next)) setCustomOverlays(next)
    })
  }

  function loadExpressionsForDesigner(): void {
    void window.ipc
      .invoke<ExpressionDef[]>(EXPR_CHANNELS.getExpressions)
      .then((entries) => { if (Array.isArray(entries)) setExpressions(entries) })
      .catch(() => undefined)
  }

  function openDesignerForNew(): void {
    setEditingId(null)
    setDraft(createCustomOverlayDef({ enabled: true, title: tr('newOverlayTitle'), elements: [createCustomOverlayElement()] }))
    setDesignerOpen(true)
    loadExpressionsForDesigner()
  }

  function openDesignerForEdit(overlay: CustomOverlayListItem): void {
    setEditingId(overlay.id)
    setDraft(createCustomOverlayDef(overlay))
    setDesignerOpen(true)
    loadExpressionsForDesigner()
  }

  function closeDesigner(): void {
    setDesignerOpen(false)
    setDraft(null)
    setEditingId(null)
  }

  function updateDraft(patch: Partial<CustomOverlayDef>): void {
    setDraft((current) => (current ? { ...current, ...patch } : current))
  }

  function updateDraftElement(elementId: string, patch: Partial<CustomOverlayElement>): void {
    setDraft((current) => current ? {
      ...current,
      elements: current.elements.map((element) => (element.id === elementId ? { ...element, ...patch } : element))
    } : current)
  }

  function addDraftElement(): void {
    setDraft((current) => (current ? { ...current, elements: [...current.elements, createCustomOverlayElement()] } : current))
  }

  function removeDraftElement(elementId: string): void {
    setDraft((current) => current ? { ...current, elements: current.elements.filter((element) => element.id !== elementId) } : current)
  }

  function bindElementExpression(elementId: string, selection: string): void {
    // Raw telemetry channel binding (`channel:<VarId>`): store the var id as the
    // element formula so the overlay widget evaluates it directly against the snapshot.
    const channelVarId = channelVarIdFromBinding(selection)
    if (channelVarId) {
      const variable = IRACING_VARIABLES.find((item) => item.id === channelVarId)
      setDraft((current) => current ? {
        ...current,
        elements: current.elements.map((element) => {
          if (element.id !== elementId) return element
          return {
            ...element,
            expressionId: selection,
            expression: channelVarId,
            expressionName: variable?.label ?? channelVarId,
            label: element.label.trim() ? element.label : (variable?.label ?? channelVarId)
          }
        })
      } : current)
      return
    }

    // Saved expression binding (existing behaviour).
    const expression = expressions.find((item) => item.id === selection)
    setDraft((current) => current ? {
      ...current,
      elements: current.elements.map((element) => {
        if (element.id !== elementId) return element
        return {
          ...element,
          expressionId: selection,
          expression: expression?.expr ?? (selection ? element.expression : ''),
          expressionName: expression?.name ?? '',
          label: element.label.trim() ? element.label : (expression?.name ?? element.label)
        }
      })
    } : current)
  }

  function saveDesigner(): void {
    if (!draft) return
    const payload = draft
    const targetId = editingId
    void run(async () => {
      const next = targetId
        ? await window.ipc.invoke<CustomOverlayListItem[]>('overlays:updateCustom', targetId, payload)
        : await window.ipc.invoke<CustomOverlayListItem[]>('overlays:addCustom', payload)
      if (Array.isArray(next)) setCustomOverlays(next)
    })
    closeDesigner()
  }

  // ── Rich widget builder ("Create new overlay") ──────────────────────────────
  function openBuilderForNew(): void {
    setBuilderEditingId(null)
    setBuilderDraft(createRichCustomOverlayDef({ enabled: true, title: tr('newOverlayTitle') }))
    setBuilderOpen(true)
  }

  function openBuilderForEdit(overlay: CustomOverlayListItem): void {
    setBuilderEditingId(overlay.id)
    // Ensure a rich shape (widgets array present) even if some fields were stripped.
    setBuilderDraft(createRichCustomOverlayDef(overlay))
    setBuilderOpen(true)
  }

  function closeBuilder(): void {
    setBuilderOpen(false)
    setBuilderDraft(null)
    setBuilderEditingId(null)
  }

  function saveBuilder(payload: CustomOverlayDef): void {
    const targetId = builderEditingId
    void run(async () => {
      const next = targetId
        ? await window.ipc.invoke<CustomOverlayListItem[]>('overlays:updateCustom', targetId, payload)
        : await window.ipc.invoke<CustomOverlayListItem[]>('overlays:addCustom', payload)
      if (Array.isArray(next)) setCustomOverlays(next)
    })
    closeBuilder()
  }

  // Route the "Edit" action by overlay flavour: rich overlays open the widget
  // builder, legacy (expression/channel) overlays open the original designer.
  function editCustomOverlay(overlay: CustomOverlayListItem): void {
    if (isRichCustomOverlay(overlay)) openBuilderForEdit(overlay)
    else openDesignerForEdit(overlay)
  }

  useEffect(() => {
    if (!editorTargetId) return
    const overlay = customOverlays.find((item) => item.id === editorTargetId)
    if (!overlay) return
    editCustomOverlay(overlay)
    setEditorTargetId(null)
  }, [customOverlays, editorTargetId])

  return (
    <div className="overlays-view">
      <section className="panel overlays-header">
        <div>
          <h3>{tr('title')}</h3>
          <p>{tr('subtitle')}</p>
          <p className="overlay-help">
            {config.configMode
              ? tr('helpEditMode')
              : tr('helpRaceMode')}
          </p>
        </div>
        <div className="overlay-actions">
          <SectionExportImport sectionId="overlays" label={tr('exportAll')} onImported={() => void refresh()} />
          <SectionExportImport sectionId="overlay-layout" label={tr('exportLayout')} onImported={() => void refresh()} />
          <button
            className={config.configMode ? 'overlay-button danger' : 'primary-action'}
            disabled={busy}
            onClick={toggleEditMode}
          >
            {config.configMode ? tr('turnOffEditing') : tr('editPosition')}
          </button>
          <button
            className="ghost-action"
            disabled={busy || enabledCount === items.length}
            onClick={() => run(async () => {
              for (const item of items) await window.ipc.invoke('overlays:toggle', item.id, true)
            })}
          >
            {tr('turnAllOn')}
          </button>
          <button
            className="ghost-action"
            disabled={busy || enabledCount === 0}
            onClick={() => run(async () => {
              for (const item of items) await window.ipc.invoke('overlays:toggle', item.id, false)
            })}
          >
            {tr('turnAllOff')}
          </button>
        </div>
      </section>

      {activeOverlays.length > 0 && (
        <section className="panel overlays-active">
          <div className="overlays-active-head">
            <h3>{tr('activeTitle')} <span className="overlays-active-count">{activeOverlays.length}</span></h3>
            <p className="overlay-help">{tr('activeHelp')}</p>
          </div>
          <div className="overlays-active-chips">
            {activeOverlays.map((entry) => (
              <div key={entry.id} className="overlay-active-chip">
                <button
                  className={entry.favorite ? 'overlay-fav is-fav' : 'overlay-fav'}
                  disabled={busy}
                  title={entry.favorite ? tr('removeFavorite') : tr('favorite')}
                  aria-label={entry.favorite ? tr('removeFavorite') : tr('favorite')}
                  aria-pressed={entry.favorite}
                  onClick={() => toggleActiveFavorite(entry)}
                >
                  {entry.favorite ? '★' : '☆'}
                </button>
                <span className="overlay-active-chip-title">{entry.title}</span>
                <button
                  className="overlay-active-chip-off"
                  disabled={busy}
                  title={tr('turnOverlayOff')}
                  onClick={() => deactivateOverlay(entry)}
                >
                  {tr('turnOff')}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <h4 style={{ margin: '0 0 8px', color: '#f6fbff' }}>{tr('positionTitle')}</h4>
        <p className="overlay-help">
          {tr('positionHelp')}
        </p>
        <label className="designer-check" style={{ margin: '12px 0 0' }}>
          <input
            type="checkbox"
            checked={Boolean(config.overlayCompositorEnabled)}
            disabled={busy}
            onChange={toggleCompositorMode}
          />
          {tr('compositorMode')}
        </label>
        <p className="overlay-help" style={{ marginTop: 8 }}>
          {tr('compositorHelp')}
        </p>
        <TriggerPreviewToggle
          checked={showTriggerOnlyActive}
          onChange={setShowTriggerOnlyActive}
          language={language}
          style={{ marginTop: 12 }}
        />
      </section>

      <section className="panel">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h4 style={{ margin: '0 0 8px', color: '#f6fbff' }}>{tr('iracingFullscreen')}</h4>
          {iracingGfx && (
            <span className={iracingGfx.mode === 'exclusive' ? 'status-pill' : 'status-pill on'}>
              {iracingGfx.mode === 'exclusive' ? tr('modeExclusive')
                : iracingGfx.mode === 'borderless' ? tr('modeBorderless')
                : iracingGfx.mode === 'windowed' ? tr('modeWindowed')
                : tr('modeUnknown')}
            </span>
          )}
        </div>
        <p className="overlay-help">
          {iracingGfx ? iracingGfx.message : tr('checkingIracing')}
        </p>
        <p className="overlay-help">
          {tr('iracingFullscreenHelp')}
        </p>
        <div className="overlay-actions">
          <button
            className="primary-action"
            disabled={busy || !iracingGfx?.supported || iracingGfx?.mode === 'borderless' || iracingGfx?.mode === 'windowed'}
            onClick={() => void fixIracingFullscreen()}
            title={iracingGfx?.supported ? tr('fixIracingTitle') : tr('windowsOnly')}
          >
            {tr('fixIracing')}
          </button>
          <button className="ghost-action" disabled={busy} onClick={() => void refreshIracingGfx()}>
            {tr('checkAgain')}
          </button>
        </div>
        {gfxNote && <p className="overlay-help" style={{ color: 'var(--accent-success)' }}>{gfxNote}</p>}
      </section>

      <section className="panel custom-overlays-panel">
        <div className="custom-overlays-head">
          <div>
            <h4 style={{ margin: '0 0 6px', color: '#f6fbff' }}>{tr('customTitle')}</h4>
            <p className="overlay-help">
              {tr('customHelp')}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button className="primary-action" disabled={busy} onClick={openBuilderForNew}>
              {tr('createNewOverlay')}
            </button>
            <button className="ghost-action" disabled={busy} onClick={openDesignerForNew}>
              {tr('createExpressionOverlay')}
            </button>
          </div>
        </div>

        {visibleCustomOverlays.length === 0 ? (
          <p className="overlay-help">
            {tr('customEmpty')}
          </p>
        ) : (
          <div className="overlay-grid">
            {visibleCustomOverlays.map((overlay) => (
              <article key={overlay.id} className={overlay.enabled ? 'overlay-config-card is-enabled' : 'overlay-config-card'}>
                <div className="overlay-card-top">
                  <div>
                    <label className="designer-check" style={{ margin: '0 0 6px' }}>
                      <input
                        type="checkbox"
                        checked={selectedCustomIds.has(overlay.id)}
                        disabled={busy}
                        onChange={() => toggleCustomSelected(overlay.id)}
                      />
                      {tr('select')}
                    </label>
                    <h4>{overlay.title}</h4>
                    <p>
                      {isRichCustomOverlay(overlay)
                        ? tr('customWidgetCount', { count: overlay.widgets?.length ?? 0 })
                        : tr('customElementCount', { count: overlay.elements.length })}
                    </p>
                  </div>
                  <div className="overlay-card-badges">
                    <button
                      className={overlay.favorite ? 'overlay-fav is-fav' : 'overlay-fav'}
                      disabled={busy}
                      title={overlay.favorite ? tr('removeFavorite') : tr('favorite')}
                      aria-label={overlay.favorite ? tr('removeFavorite') : tr('favorite')}
                      aria-pressed={overlay.favorite}
                      onClick={() => applyCustomPatch(overlay.id, { favorite: !overlay.favorite })}
                    >
                      {overlay.favorite ? '★' : '☆'}
                    </button>
                    <span className={overlay.enabled ? 'status-pill on' : 'status-pill'}>{overlay.enabled ? tr('statusOn') : tr('statusOff')}</span>
                  </div>
                </div>

                <div className="overlay-toggles">
                  <button
                    className={overlay.enabled ? 'overlay-button danger' : 'primary-action'}
                    disabled={busy}
                    onClick={() => applyCustomPatch(overlay.id, { enabled: !overlay.enabled })}
                  >
                    {overlay.enabled ? tr('turnOff') : tr('turnOn')}
                  </button>
                  <button
                    className="ghost-action"
                    disabled={busy || !overlay.enabled}
                    onClick={() => applyCustomPatch(overlay.id, { locked: !overlay.locked })}
                  >
                    {overlay.locked ? tr('pinned') : tr('floating')}
                  </button>
                  <button className="ghost-action" disabled={busy} onClick={() => editCustomOverlay(overlay)}>
                    {tr('edit')}
                  </button>
                  <button className="ghost-action danger" disabled={busy} onClick={() => removeCustomOverlay(overlay.id)}>
                    {tr('remove')}
                  </button>
                  <button className="ghost-action" disabled={busy} onClick={() => setCustomHidden([overlay.id], true)}>
                    {tr('hide')}
                  </button>
                </div>

                <div className="opacity-control">
                  <label>
                    {tr('opacity')} <strong style={{ color: "var(--accent-primary)" }}>{overlay.opacity}%</strong>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={overlay.opacity}
                      disabled={busy || !overlay.enabled}
                      onChange={(event) => patchCustomLocal(overlay.id, { opacity: Number(event.target.value) })}
                      onMouseUp={(event) => applyCustomPatch(overlay.id, { opacity: Number(event.currentTarget.value) })}
                      onTouchEnd={(event) => applyCustomPatch(overlay.id, { opacity: Number(event.currentTarget.value) })}
                    />
                  </label>
                </div>

                {!isRichCustomOverlay(overlay) && (
                  <div className="preset-row">
                    {OVERLAY_FORMS.map((preset) => (
                      <button
                        key={preset.id}
                        className={isSelectedOverlayForm(overlay.stylePreset, preset.id) ? 'preset-button active' : 'preset-button'}
                        disabled={busy}
                        title={preset.description}
                        onClick={() => applyCustomPatch(overlay.id, { stylePreset: preset.id, style: preset.style })}
                      >
                        {preset.title}
                      </button>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
        {(visibleCustomOverlays.length > 0 || hiddenCustomOverlays.length > 0) && (
          <div className="overlay-actions" style={{ marginTop: 12 }}>
            <button className="ghost-action" disabled={busy || selectedCustomIds.size === 0} onClick={() => setCustomHidden(Array.from(selectedCustomIds), true)}>
              {tr('hideSelected')}
            </button>
          </div>
        )}
        {hiddenCustomOverlays.length > 0 && (
          <details style={{ marginTop: 14 }}>
            <summary style={{ color: '#f6fbff', cursor: 'pointer', fontWeight: 700 }}>{tr('hiddenCustom', { count: hiddenCustomOverlays.length })}</summary>
            <div className="overlays-active-chips" style={{ marginTop: 10 }}>
              {hiddenCustomOverlays.map((overlay) => (
                <div key={overlay.id} className="overlay-active-chip">
                  <label className="designer-check" style={{ margin: 0 }}>
                    <input type="checkbox" checked={selectedCustomIds.has(overlay.id)} onChange={() => toggleCustomSelected(overlay.id)} />
                    <span className="overlay-active-chip-title">{overlay.title}</span>
                  </label>
                  <button className="overlay-active-chip-off" disabled={busy} onClick={() => setCustomHidden([overlay.id], false)}>{tr('restore')}</button>
                </div>
              ))}
            </div>
            <button className="ghost-action" style={{ marginTop: 10 }} disabled={busy || selectedCustomIds.size === 0} onClick={() => setCustomHidden(Array.from(selectedCustomIds), false)}>{tr('restoreSelected')}</button>
          </details>
        )}
      </section>

      {error && <section className="panel overlay-help">{error}</section>}

      <section className="overlay-grid">
        <div className="overlay-yes-filter" style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{tr('filterBySim')}</span>
          {(['all', ...PLAYABLE_SIMS] as const).map((yes) => (
            <button
              key={yes}
              type="button"
              className={simFilter === yes ? 'overlay-fav is-fav' : 'overlay-fav'}
              onClick={() => setSimFilter(yes)}
              style={{ padding: '2px 10px', fontSize: 12 }}
            >
              {yes === 'all' ? tr('all') : simLabel(yes)}
            </button>
          ))}
          {simFilter !== 'all' && (
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{tr('simFilteredCount', { count: visibleItems.length })}</span>
          )}
          <span style={{ width: 1, height: 18, background: 'var(--border-default)', margin: '0 2px' }} />
          <TagFilter
            items={simFilteredItems}
            selectedTags={tagFilters}
            onSelectedTagsChange={setTagFilters}
            getTags={(item) => definitionTags(defById.get(item.id as OverlayWidgetId))}
          />
          <button className="ghost-action" disabled={busy || selectedWidgetIds.size === 0} onClick={() => setWidgetHidden(Array.from(selectedWidgetIds), true)}>
            {tr('hideSelected')}
          </button>
        </div>
        {visibleItems.map((item) => (
          <article key={item.id} className={item.enabled ? 'overlay-config-card is-enabled' : 'overlay-config-card'}>
            <div className="overlay-card-top">
              <div>
                <label className="designer-check" style={{ margin: '0 0 6px' }}>
                  <input
                    type="checkbox"
                    checked={selectedWidgetIds.has(item.id)}
                    disabled={busy}
                    onChange={() => toggleWidgetSelected(item.id)}
                  />
                  {tr('select')}
                </label>
                <h4>{displayTitleFor(item.id, item.title)}</h4>
                <p>{item.description}</p>
              </div>
              <div className="overlay-card-badges">
                <button
                  className={item.favorite ? 'overlay-fav is-fav' : 'overlay-fav'}
                  disabled={busy}
                  title={item.favorite ? tr('removeFavorite') : tr('favorite')}
                  aria-label={item.favorite ? tr('removeFavorite') : tr('favorite')}
                  aria-pressed={item.favorite}
                  onClick={() => toggleWidgetFavorite(item.id, !item.favorite)}
                >
                  {item.favorite ? '★' : '☆'}
                </button>
                <span className={item.enabled ? 'status-pill on' : 'status-pill'}>{item.enabled ? tr('statusOn') : tr('statusOff')}</span>
              </div>
            </div>

            <OverlayRuntimePreview
              item={item}
              definition={defById.get(item.id)}
              fallback={tr('previewUnavailable')}
              alertsConfig={alertsConfig}
              showTriggerOnlyActive={showTriggerOnlyActive}
            />

            <div className="overlay-toggles">
              <button
                className={item.enabled ? 'overlay-button danger' : 'primary-action'}
                disabled={busy}
                onClick={() => run(async () => {
                  const nextItems = await window.ipc.invoke<OverlayListItem[]>('overlays:toggle', item.id)
                  setItems(nextItems)
                })}
              >
                {item.enabled ? tr('turnOff') : tr('turnOn')}
              </button>
              <button
                className="ghost-action"
                disabled={busy || !item.enabled}
                onClick={() => run(async () => {
                  const nextItems = await window.ipc.invoke<OverlayListItem[]>('overlays:setLocked', item.id, !item.locked)
                  setItems(nextItems)
                })}
              >
                {item.locked ? tr('pinned') : tr('floating')}
              </button>
              <button
                className="ghost-action"
                disabled={busy || !item.enabled}
                onClick={() => run(async () => {
                  const nextItems = await window.ipc.invoke<OverlayListItem[]>('overlays:setPosition', item.id, item.position)
                  setItems(nextItems)
                })}
              >
                {tr('applyPosition')}
              </button>
              <button className="ghost-action" disabled={busy} onClick={() => setWidgetHidden([item.id], true)}>
                {tr('hide')}
              </button>
            </div>

            <label className="monitor-control">
              {tr('monitorMove')}
              <select
                value={selectedDisplayValue(item)}
                disabled={busy}
                onChange={(event) => changeDisplay(item.id, event.target.value)}
                title={selectedDisplayLabel(item)}
              >
                <option value="auto">{tr('displayAuto')}</option>
                {item.display && !displays.some((display) => display.id === item.display?.id) && (
                  <option value={`missing:${item.display.id}`}>{selectedDisplayLabel(item)}</option>
                )}
                {displayOptions.map((display) => <option key={display.value} value={display.value}>{display.label}</option>)}
              </select>
            </label>

            <div className="position-grid">
              {POSITION_KEYS.map((key) => (
                <label key={key}>
                  {key}
                  <input
                    className="position-input"
                    type="text"
                    inputMode="numeric"
                    value={posDrafts[positionDraftKey(item.id, key)] ?? String(item.position[key])}
                    disabled={busy}
                    onChange={(event) => onPositionInput(item.id, key, event.target.value)}
                    onBlur={() => commitPosition(item.id, key)}
                  />
                </label>
              ))}
            </div>

            <div className="opacity-control">
              <label>
                {tr('opacity')} <strong style={{ color: "var(--accent-primary)" }}>{item.opacity}%</strong>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={item.opacity}
                  disabled={busy || !item.enabled}
                  onChange={(event) => patchItem(item.id, { opacity: Number(event.target.value) })}
                  onMouseUp={(event) => run(async () => {
                    await window.ipc.invoke('overlays:setOpacity', item.id, Number(event.currentTarget.value))
                  })}
                  onTouchEnd={(event) => run(async () => {
                    await window.ipc.invoke('overlays:setOpacity', item.id, Number(event.currentTarget.value))
                  })}
                />
              </label>
            </div>

            <div className="preset-row">
              {OVERLAY_FORMS.map((preset) => (
                <button
                  key={preset.id}
                  className={isSelectedOverlayForm(item.stylePreset, preset.id) ? 'preset-button active' : 'preset-button'}
                  disabled={busy}
                  title={preset.description}
                  onClick={() => run(async () => {
                    const nextItems = await window.ipc.invoke<OverlayListItem[]>('overlays:setStyle', item.id, {
                      stylePreset: preset.id,
                      style: preset.style
                    })
                    setItems(nextItems)
                  })}
                >
                  {preset.title}
                </button>
              ))}
            </div>

            <div className="style-grid">
              <label>
                {tr('background')}
                <input
                  type="color"
                  value={item.style.background.startsWith('#') ? item.style.background : '#050a12'}
                  disabled={busy}
                  onChange={(event) => updateStyle(item.id, 'background', event.target.value)}
                  onBlur={() => run(async () => {
                    await window.ipc.invoke('overlays:setStyle', item.id, { style: item.style })
                  })}
                />
              </label>
              <label>
                {tr('accent')}
                <input
                  type="color"
                  value={item.style.accent.startsWith('#') ? item.style.accent : 'var(--accent-primary)'}
                  disabled={busy}
                  onChange={(event) => updateStyle(item.id, 'accent', event.target.value)}
                  onBlur={() => run(async () => {
                    await window.ipc.invoke('overlays:setStyle', item.id, { style: item.style })
                  })}
                />
              </label>
              <label>
                {tr('border')}
                <input
                  type="color"
                  value={item.style.border.startsWith('#') ? item.style.border : '#8aa4c8'}
                  disabled={busy}
                  onChange={(event) => updateStyle(item.id, 'border', event.target.value)}
                  onBlur={() => run(async () => {
                    await window.ipc.invoke('overlays:setStyle', item.id, { style: item.style })
                  })}
                />
              </label>
              <label>
                {tr('radius')}
                <input
                  className="position-input"
                  type="number"
                  min="0"
                  max="36"
                  value={item.style.radius}
                  disabled={busy}
                  onChange={(event) => updateStyle(item.id, 'radius', Number(event.target.value))}
                  onBlur={() => run(async () => {
                    await window.ipc.invoke('overlays:setStyle', item.id, { style: item.style })
                  })}
                />
              </label>
            </div>

            <label className="font-control">
              {tr('font')}
              <select
                value={item.style.fontFamily}
                disabled={busy}
                onChange={(event) => run(async () => {
                  const nextStyle = { ...item.style, fontFamily: event.target.value }
                  patchItem(item.id, { style: nextStyle })
                  await window.ipc.invoke('overlays:setStyle', item.id, { style: nextStyle })
                })}
              >
                {FONT_OPTIONS.map((font) => <option key={font} value={font}>{font.split(',')[0]}</option>)}
              </select>
            </label>
          </article>
        ))}
        {hiddenItems.length > 0 && (
          <div style={{ gridColumn: '1 / -1' }}>
            <details>
              <summary style={{ color: '#f6fbff', cursor: 'pointer', fontWeight: 800 }}>{tr('hiddenWidgets', { count: hiddenItems.length })}</summary>
              <div className="overlays-active-chips" style={{ marginTop: 10 }}>
                {hiddenItems.map((item) => (
                  <div key={item.id} className="overlay-active-chip">
                    <label className="designer-check" style={{ margin: 0 }}>
                      <input type="checkbox" checked={selectedWidgetIds.has(item.id)} onChange={() => toggleWidgetSelected(item.id)} />
                      <span className="overlay-active-chip-title">{displayTitleFor(item.id, item.title)}</span>
                    </label>
                    <button className="overlay-active-chip-off" disabled={busy} onClick={() => setWidgetHidden([item.id], false)}>{tr('restore')}</button>
                  </div>
                ))}
              </div>
              <button className="ghost-action" style={{ marginTop: 10 }} disabled={busy || selectedWidgetIds.size === 0} onClick={() => setWidgetHidden(Array.from(selectedWidgetIds), false)}>{tr('restoreSelected')}</button>
            </details>
          </div>
        )}
      </section>


      {designerOpen && draft && (
        <div className="overlay-designer-backdrop" role="dialog" aria-modal="true">
          <div className="overlay-designer">
            <div className="overlay-designer-head">
              <h4>{editingId ? tr('editCustomOverlay') : tr('newCustomOverlay')}</h4>
              <button className="ghost-action" disabled={busy} onClick={closeDesigner}>{tr('close')}</button>
            </div>

            <div className="overlay-designer-body">
              <label className="designer-field">
                {tr('fieldTitle')}
                <input
                  type="text"
                  value={draft.title}
                  disabled={busy}
                  maxLength={60}
                  onChange={(event) => updateDraft({ title: event.target.value })}
                />
              </label>

              <div className="designer-settings">
                <label className="designer-check">
                  <input type="checkbox" checked={draft.enabled} disabled={busy} onChange={(event) => updateDraft({ enabled: event.target.checked })} />
                  {tr('showOverlay')}
                </label>
                <label className="designer-check">
                  <input type="checkbox" checked={draft.locked} disabled={busy} onChange={(event) => updateDraft({ locked: event.target.checked })} />
                  {tr('pinnedClickThrough')}
                </label>
                <label className="designer-field">
                  {tr('style')}
                  <select
                    value={draft.stylePreset}
                    disabled={busy}
                    onChange={(event) => {
                      const preset = OVERLAY_FORMS.find((item) => item.id === event.target.value)
                      if (preset) updateDraft({ stylePreset: preset.id, style: { ...preset.style } })
                    }}
                  >
                    {OVERLAY_FORMS.map((preset) => <option key={preset.id} value={preset.id}>{preset.title}</option>)}
                  </select>
                </label>
              </div>

              {expressions.length === 0 && BINDABLE_TELEMETRY_COUNT === 0 && (
                <p className="overlay-help">
                  {tr('noExpressionsNoTelemetry')}
                </p>
              )}
              {expressions.length === 0 && BINDABLE_TELEMETRY_COUNT > 0 && (
                <p className="overlay-help">
                  {tr('noExpressionsTelemetry')}
                </p>
              )}

              <div className="designer-elements">
                {draft.elements.map((element, index) => (
                  <div key={element.id} className="designer-element">
                    <div className="designer-element-head">
                      <strong style={{ color: "var(--accent-primary)" }}>{tr('elementNumber', { index: index + 1 })}</strong>
                      <button className="ghost-action danger" disabled={busy} onClick={() => removeDraftElement(element.id)}>{tr('remove')}</button>
                    </div>

                    <label className="designer-field">
                      {tr('expressionOrChannel')}
                      <select value={element.expressionId} disabled={busy} onChange={(event) => bindElementExpression(element.id, event.target.value)}>
                        <option value="">{tr('chooseExpressionOrChannel')}</option>
                        {element.expressionId !== '' &&
                          channelVarIdFromBinding(element.expressionId) === null &&
                          !expressions.some((item) => item.id === element.expressionId) && (
                            <option value={element.expressionId}>{element.expressionName || tr('removedExpression')} {tr('unavailableParen')}</option>
                          )}
                        {element.expressionId !== '' &&
                          channelVarIdFromBinding(element.expressionId) !== null &&
                          !IRACING_VARIABLES.some((item) => `${CHANNEL_BINDING_PREFIX}${item.id}` === element.expressionId && item.telemetryField) && (
                            <option value={element.expressionId}>{element.expressionName || channelVarIdFromBinding(element.expressionId)} {tr('channelUnavailableParen')}</option>
                          )}
                        {expressions.length > 0 && (
                          <optgroup label={tr('myExpressions')}>
                            {expressions.map((expression) => <option key={expression.id} value={expression.id}>{expression.name}</option>)}
                          </optgroup>
                        )}
                        {BINDABLE_TELEMETRY_GROUPS.map((group) => (
                          <optgroup key={group.category} label={tr('telemetryGroup', { label: group.label })}>
                            {group.variables.map((variable) => (
                              <option key={variable.id} value={`${CHANNEL_BINDING_PREFIX}${variable.id}`}>
                                {variable.label}{variable.unit ? ` (${variable.unit})` : ''} · {variable.id}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </label>

                    <div className="designer-grid-2">
                      <label className="designer-field">
                        {tr('label')}
                        <input type="text" value={element.label} disabled={busy} maxLength={80} onChange={(event) => updateDraftElement(element.id, { label: event.target.value })} />
                      </label>
                      <label className="designer-field">
                        {tr('suffix')}
                        <input type="text" value={element.suffix} disabled={busy} maxLength={16} onChange={(event) => updateDraftElement(element.id, { suffix: event.target.value })} />
                      </label>
                    </div>

                    <div className="designer-grid-4">
                      <label className="designer-field">
                        {tr('decimals')}
                        <select
                          value={element.decimals === null ? 'auto' : String(element.decimals)}
                          disabled={busy}
                          onChange={(event) => updateDraftElement(element.id, { decimals: event.target.value === 'auto' ? null : Number(event.target.value) })}
                        >
                          {DECIMALS_OPTIONS.map((option) => <option key={option} value={option}>{option === 'auto' ? tr('auto') : option}</option>)}
                        </select>
                      </label>
                      <label className="designer-field">
                        {tr('fontPx')}
                        <input type="number" min={8} max={240} value={element.fontSize} disabled={busy} onChange={(event) => updateDraftElement(element.id, { fontSize: Number(event.target.value) })} />
                      </label>
                      <label className="designer-field">
                        {tr('align')}
                        <select value={element.align} disabled={busy} onChange={(event) => updateDraftElement(element.id, { align: event.target.value as CustomOverlayElementAlign })}>
                          {ALIGN_OPTIONS.map((align) => <option key={align} value={align}>{align}</option>)}
                        </select>
                      </label>
                      <label className="designer-field">
                        {tr('color')}
                        <input
                          type="color"
                          value={element.color && element.color.startsWith('#') ? element.color : 'var(--accent-primary)'}
                          disabled={busy || element.color === ''}
                          onChange={(event) => updateDraftElement(element.id, { color: event.target.value })}
                        />
                      </label>
                    </div>

                    <label className="designer-check">
                      <input
                        type="checkbox"
                        checked={element.color === ''}
                        disabled={busy}
                        onChange={(event) => updateDraftElement(element.id, { color: event.target.checked ? '' : 'var(--accent-primary)' })}
                      />
                      {tr('useThemeColor')}
                    </label>

                    <div className="designer-grid-4">
                      {ELEMENT_BOX_KEYS.map((key) => (
                        <label key={key} className="designer-field">
                          {key}
                          <input
                            type="number"
                            value={element[key]}
                            disabled={busy}
                            onChange={(event) => updateDraftElement(element.id, { [key]: Number(event.target.value) } as Partial<CustomOverlayElement>)}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <button className="ghost-action" disabled={busy} onClick={addDraftElement}>{tr('addElement')}</button>
            </div>

            <div className="overlay-designer-foot">
              <button className="ghost-action" disabled={busy} onClick={closeDesigner}>{tr('cancel')}</button>
              <button className="primary-action" disabled={busy || !draft.title.trim()} onClick={saveDesigner}>
                {editingId ? tr('saveChanges') : tr('createOverlay')}
              </button>
            </div>
          </div>
        </div>
      )}

      {builderOpen && builderDraft && (
        <OverlayWidgetBuilder
          initial={builderDraft}
          editing={Boolean(builderEditingId)}
          busy={busy}
          showTriggerOnlyActive={showTriggerOnlyActive}
          onShowTriggerOnlyActiveChange={setShowTriggerOnlyActive}
          triggerPreviewLabel={tt(language, 'triggerPreview.label')}
          triggerPreviewHelp={tt(language, 'triggerPreview.help')}
          alertsConfig={alertsConfig}
          onSave={saveBuilder}
          onCancel={closeBuilder}
        />
      )}
    </div>
  )
}
