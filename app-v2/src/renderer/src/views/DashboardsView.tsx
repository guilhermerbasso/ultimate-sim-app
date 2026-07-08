import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent, ReactElement, ReactNode } from 'react'
import type {
  Dashboard,
  DashboardDisplayInfo,
  DashboardElement,
  DashboardElementType,
  DashboardOpenState,
  DashboardPlaylist,
  DashboardPlaylistItem,
  DashboardScaleMode,
  DashboardSummary,
  InstrumentBezelKind,
  InstrumentMaterialKind,
  InstrumentStyleSpec,
  InstrumentTemplate,
  TextSlotStyle,
  WidgetSlotDef
} from '../../../shared/dashboards'
import {
  BUILTIN_PRESETS,
  DASHBOARD_BINDINGS,
  DASHBOARD_FONT_OPTIONS,
  WIDGET_SLOTS,
  applySlotField,
  composeImageFilter,
  createBlankAdaptiveDashboard,
  createElementId,
  reorderElements,
  sortElementsByZ
} from '../../../shared/dashboards'
import { ADAPTIVE_DASHBOARD_ID } from '../../../shared/dashboard-adaptive-preset'
import { isTouchPanelPlaylistItem, type ButtonBoxSummary } from '../../../shared/touch-panel'
import { buildKioskOpenOptions } from '../../../shared/kiosk'
import type { ActionBinding, ActionDefinition, AppActionName, HidButtonControl } from '../../../shared/actions'
import type { AppViewProps } from '../App'
import { setActionRuntimeSuppressed } from '../lib/action-runtime'
import { SectionExportImport } from '../components/SectionExportImport'
import { findFirstPressedButton } from '../lib/gamepad'
import { renderGt3Widget, GT3_WIDGET_TYPES } from '../dashboard/widgets/gt3-widgets'
import { PREVIEW_SNAPSHOT } from '../dashboard/widgets/gt3-theme'
import { WidgetGallery, variantToElement } from './dashboard/widget-catalog'
import type { WidgetVariant } from './dashboard/widget-catalog'
import { PresetGallery } from './dashboard/preset-gallery'
import '../dashboard/dashboard-runtime.css'

const ACCENT = 'var(--accent-primary)'
const PANEL_BG = '#0e1116'
const PANEL_BORDER = '#1f2733'
const TEXT_DIM = '#9aa6b2'
const TEXT_FG = '#f6fbff'

type CycleDirection = 'next' | 'prev'

interface DashboardCycleControls {
  next: HidButtonControl | null
  prev: HidButtonControl | null
}

const CYCLE_ACTION_NAME: Record<CycleDirection, AppActionName> = {
  next: 'dash:cycleNext',
  prev: 'dash:cyclePrev'
}

const CYCLE_BINDING_LABEL: Record<CycleDirection, string> = {
  next: 'Dashboard · next (playlist)',
  prev: 'Dashboard · anterior (playlist)'
}

const CYCLE_FIELD_LABEL: Record<CycleDirection, string> = {
  next: 'Advance (next)',
  prev: 'Back (previous)'
}

function createBindingId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `binding-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function isCycleBinding(binding: ActionBinding, direction: CycleDirection): boolean {
  return binding.action.type === 'app' && binding.action.command.name === CYCLE_ACTION_NAME[direction]
}

function sameButton(a: HidButtonControl, b: HidButtonControl): boolean {
  return a.buttonIndex === b.buttonIndex && (a.gamepadIndex ?? null) === (b.gamepadIndex ?? null)
}

const ELEMENT_TYPES: Array<{ value: DashboardElementType; label: string }> = [
  { value: 'text', label: 'Texto' },
  { value: 'rect', label: 'Rectangle' },
  { value: 'bar', label: 'Barra' },
  { value: 'barv', label: 'Barra vertical' },
  { value: 'dualbar', label: 'Dualbar (throttle/brake)' },
  { value: 'deltabar', label: 'Delta bar (±s)' },
  { value: 'gauge', label: 'Mostrador (gauge)' },
  { value: 'shiftlights', label: 'Shift LEDs' },
  { value: 'map', label: 'Mapa da pista' },
  { value: 'radar', label: 'Radar' },
  { value: 'image', label: 'Imagem' },
  { value: 'flag', label: 'Flag' },
  { value: 'trace', label: 'Trace (sparkline)' },
  { value: 'table', label: 'Tabela' },
  { value: 'standings', label: 'Standings' },
  // GT3 widgets
  { value: 'shiftbar', label: 'Shift Bar v2 (GT3)' },
  { value: 'gearcluster', label: 'Gear + Speed (GT3)' },
  { value: 'tyregrid', label: 'Grid de Tyres (GT3)' },
  { value: 'brakegrid', label: 'Grid de Brakes (GT3)' },
  { value: 'cornerstack', label: 'Health por Canto (GT3)' },
  { value: 'fuelstint', label: 'Fuel / Stint (GT3)' },
  { value: 'deltatile', label: 'Predictive Delta (GT3)' },
  { value: 'laptiming', label: 'Lap Times (GT3)' },
  { value: 'positiongaps', label: 'Position + Gaps (GT3)' },
  { value: 'flagoverlay', label: 'Flag / Alert v2 (GT3)' },
  { value: 'inputbars', label: 'Input Bars (GT3)' },
  { value: 'inputtrace', label: 'Input Trace (GT3)' },
  { value: 'steering', label: 'Steering (GT3)' },
  { value: 'setupstrip', label: 'Strip ABS/TC/MAP/BB (GT3)' },
  { value: 'enginetemps', label: 'Engine Temps (GT3)' },
  { value: 'weather', label: 'Weather / Track (GT3)' },
  { value: 'trackmini', label: 'Mini Map (GT3)' },
  // Clean value widgets (qualquer channel via ir:<id>)
  { value: 'value', label: 'Valor limpo' },
  { value: 'valuebar', label: 'Valor + barra' },
  { value: 'valuegauge', label: 'Valor + mostrador' }
]

const SCALE_MODES: Array<{ value: DashboardScaleMode; label: string; hint: string }> = [
  { value: 'fit', label: 'Fit (letterbox)', hint: 'Preserva proportion. Pode deixar bordas vazias.' },
  { value: 'fill', label: 'Fill (cover)', hint: 'Cobre a tela. Pode cortar nas bordas.' },
  { value: 'stretch', label: 'Stretch', hint: 'Distorce X/Y p/ preencher exatamente. Sem espacos, sem cortes.' }
]

const DEFAULT_TABLE_COLS = ['pos', 'number', 'name', 'gap', 'class']


interface SimhubImportScreen {
  index: number
  name: string
  elementCount: number
  score: number
  selected: boolean
  inGame: boolean
  idle: boolean
  pit: boolean
}

interface SimhubImportResponse {
  summary?: DashboardSummary
  summaries?: DashboardSummary[]
  notes: string[]
  screens?: SimhubImportScreen[]
  selectedScreenIndex?: number
  filePath?: string
}

interface SimhubImportPicker {
  filePath: string
  screens: SimhubImportScreen[]
  selectedScreenIndex: number
  notes: string[]
}

const NEW_RESOLUTION_PRESETS: Array<{ id: string; label: string; width: number; height: number }> = [
  { id: '1024x600', label: '1024×600 (7")', width: 1024, height: 600 },
  { id: '1920x1080', label: '1920×1080 (FHD)', width: 1920, height: 1080 },
  { id: '1280x720', label: '1280×720 (HD)', width: 1280, height: 720 },
  { id: '600x1024', label: '600×1024 (Portrait)', width: 600, height: 1024 }
]

const SNAP_STEPS = [1, 4, 8, 16, 32] as const
type SnapStep = (typeof SNAP_STEPS)[number]
type ElementGeometry = Pick<DashboardElement, 'x' | 'y' | 'w' | 'h'>
type ResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'

const MIN_ELEMENT_SIZE = 8
const RESIZE_HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

function snap(value: number, step: number): number {
  if (step <= 1) return Math.round(value)
  return Math.round(value / step) * step
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function constrainElementGeometry(geometry: ElementGeometry, dashboard: Pick<Dashboard, 'width' | 'height'>): ElementGeometry {
  const maxW = Math.max(MIN_ELEMENT_SIZE, dashboard.width)
  const maxH = Math.max(MIN_ELEMENT_SIZE, dashboard.height)
  const w = clamp(geometry.w, MIN_ELEMENT_SIZE, maxW)
  const h = clamp(geometry.h, MIN_ELEMENT_SIZE, maxH)
  return {
    x: clamp(geometry.x, 0, Math.max(0, dashboard.width - w)),
    y: clamp(geometry.y, 0, Math.max(0, dashboard.height - h)),
    w,
    h
  }
}

function newBlankDashboard(name: string, width = 1280, height = 720): Dashboard {
  const now = Date.now()
  return {
    id: '',
    name,
    width,
    height,
    bg: '#05070a',
    elements: [],
    createdAt: now,
    updatedAt: now
  }
}

function ensureId(dash: Dashboard): Dashboard {
  if (dash.id && dash.id.length > 0) return dash
  return { ...dash, id: `dash-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` }
}

function defaultStyleFor(type: DashboardElementType): DashboardElement['style'] {
  switch (type) {
    case 'text':
      return { color: TEXT_FG, fontFamily: 'Segoe UI, sans-serif', fontSize: 24, fontWeight: 700, align: 'left', text: 'Texto' }
    case 'rect':
      return { background: PANEL_BG, border: PANEL_BORDER, borderWidth: 1, radius: 12 }
    case 'bar':
      return { background: 'var(--surface-sunken)', radius: 8, fillColor: ACCENT, warnColor: '#ffb84d', dangerColor: '#ff5468', warnAt: 0.7, dangerAt: 0.9 }
    case 'barv':
      return { background: 'var(--surface-sunken)', radius: 6, fillColor: ACCENT, warnColor: '#ffb84d', dangerColor: '#ff5468', warnAt: 0.7, dangerAt: 0.9 }
    case 'dualbar':
      return { background: 'var(--surface-sunken)', radius: 6, fillColor: '#2dd96a', secondaryColor: '#ff5468', secondaryBinding: 'brake' }
    case 'deltabar':
      return { background: 'rgba(255,255,255,0.04)', radius: 8, fillColor: '#2dd96a', dangerColor: '#ff5468', deltaRangeSec: 1 }
    case 'gauge':
      return { background: 'transparent', color: TEXT_FG, fillColor: ACCENT, warnColor: '#ffb84d', dangerColor: '#ff5468', warnAt: 0.7, dangerAt: 0.9 }
    case 'shiftlights':
      return { background: 'var(--surface-sunken)', border: PANEL_BORDER, borderWidth: 1, radius: 10, segments: 12, fillColor: '#3ea0ff', warnColor: '#ffb84d', dangerColor: '#ff5468', warnAt: 0.6, dangerAt: 0.85 }
    case 'map':
      return { background: PANEL_BG, color: '#5a6a7a', fillColor: ACCENT, radius: 12 }
    case 'radar':
      return { background: PANEL_BG, color: TEXT_DIM, fillColor: ACCENT, radius: 12 }
    case 'image':
      return { background: 'transparent', radius: 8, fit: 'contain', opacity: 1 }
    case 'flag':
      return { background: 'rgba(255,255,255,0.04)', color: '#0a0c10', radius: 8, fontSize: 22, fontWeight: 900 }
    case 'trace':
      return { background: 'rgba(255,255,255,0.04)', radius: 8, fillColor: ACCENT, traceColor2: '#ff5468', traceLength: 120, traceWidth: 1.6 }
    case 'table':
    case 'standings':
      return {
        background: 'rgba(10,12,16,0.85)',
        color: TEXT_FG,
        radius: 10,
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: 14,
        fontWeight: 600,
        tableColumns: DEFAULT_TABLE_COLS,
        tableMaxRows: 8,
        showHeader: true,
        highlightPlayer: true,
        headerColor: TEXT_DIM,
        padding: 6
      }
    case 'shiftbar':
      return { background: '#101722', border: '#2B3545', borderWidth: 1, radius: 8, segments: 18, flashAt: 0.98, glow: true, segmentShape: 'led', warnAt: 0.75, dangerAt: 0.9 }
    case 'gearcluster':
      return { background: '#101722', border: '#2B3545', borderWidth: 1, radius: 18, accentColor: ACCENT, showRpm: true }
    case 'tyregrid':
      return { background: '#101722', border: '#2B3545', borderWidth: 1, radius: 12, gridMode: 'temp', showAverage: true, showLabels: true, targetValue: 165, tolerance: 7 }
    case 'brakegrid':
      return { background: '#101722', border: '#2B3545', borderWidth: 1, radius: 12, showAverage: true }
    case 'cornerstack':
      return { background: '#101722', border: '#2B3545', borderWidth: 1, radius: 12, targetValue: 165, tolerance: 7 }
    case 'fuelstint':
      return { background: '#101722', border: '#2B3545', borderWidth: 1, radius: 12, reserveLaps: 1, warnAtLaps: 2 }
    case 'deltatile':
      return { background: '#101722', border: '#2B3545', borderWidth: 1, radius: 14, deltaReference: 'session', deltaRangeSec: 1 }
    case 'laptiming':
      return { background: '#101722', border: '#2B3545', borderWidth: 1, radius: 12, showCurrent: true, showLast: true, showBest: true }
    case 'positiongaps':
      return { background: '#101722', border: '#2B3545', borderWidth: 1, radius: 12, showTotal: true }
    case 'flagoverlay':
      return { background: '#101722', border: '#2B3545', borderWidth: 1, radius: 10, includeIncidents: true }
    case 'inputbars':
      return { background: '#101722', border: '#2B3545', borderWidth: 1, radius: 12, channels: ['throttle', 'brake'] }
    case 'inputtrace':
      return { background: '#101722', border: '#2B3545', borderWidth: 1, radius: 10, channels: ['throttle', 'brake'], traceLength: 160, traceWidth: 1.8 }
    case 'steering':
      return { background: '#101722', border: '#2B3545', borderWidth: 1, radius: 12, maxDegrees: 540, showNumeric: true }
    case 'setupstrip':
      return { background: '#101722', border: '#2B3545', borderWidth: 1, radius: 12, fields: ['abs', 'tc', 'map', 'bb', 'limiter', 'inc'] }
    case 'enginetemps':
      return { background: '#101722', border: '#2B3545', borderWidth: 1, radius: 12, hotAt: 108, criticalAt: 122 }
    case 'weather':
      return { background: '#101722', border: '#2B3545', borderWidth: 1, radius: 12 }
    case 'trackmini':
      return { background: '#101722', border: '#2B3545', borderWidth: 1, radius: 12, accentColor: ACCENT }
    case 'value':
      return { background: '#000000', border: '#1F1F1F', borderWidth: 1, radius: 2, color: '#F4F4F4', label: 'VALOR', accentColor: '#00E7FF', minFontSize: 12 }
    case 'valuebar':
      return { background: '#000000', border: '#1F1F1F', borderWidth: 1, radius: 2, color: '#F4F4F4', label: 'VALOR', suffix: '%', accentColor: '#2FFF67', minFontSize: 10 }
    case 'valuegauge':
      return { background: '#000000', borderWidth: 0, radius: 2, color: '#F4F4F4', label: 'VALOR', accentColor: '#FFB000', warnAt: 0.6, dangerAt: 0.85, minFontSize: 10 }
    default:
      return {}
  }
}

function defaultElement(type: DashboardElementType, base: Dashboard): DashboardElement {
  const x = Math.round((base.width - 240) / 2)
  const y = Math.round((base.height - 80) / 2)
  let w = 240
  let h = 80
  if (type === 'shiftlights') {
    w = Math.min(base.width - 80, 800)
    h = 48
  } else if (type === 'bar') {
    h = 24
  } else if (type === 'rect') {
    h = 120
  } else if (type === 'barv') {
    w = 32
    h = 160
  } else if (type === 'dualbar') {
    w = 80
    h = 180
  } else if (type === 'deltabar') {
    w = Math.min(base.width - 80, 480)
    h = 24
  } else if (type === 'image') {
    w = 200
    h = 120
  } else if (type === 'flag') {
    w = 120
    h = 60
  } else if (type === 'trace') {
    w = 320
    h = 120
  } else if (type === 'table' || type === 'standings') {
    w = Math.min(base.width - 80, 520)
    h = 280
  } else if (type === 'shiftbar') {
    w = Math.min(base.width - 80, 760)
    h = 44
  } else if (type === 'gearcluster') {
    w = 320
    h = 240
  } else if (type === 'tyregrid' || type === 'brakegrid') {
    w = 240
    h = 220
  } else if (type === 'cornerstack') {
    w = 300
    h = 300
  } else if (type === 'fuelstint') {
    w = 300
    h = 92
  } else if (type === 'deltatile') {
    w = 320
    h = 96
  } else if (type === 'laptiming') {
    w = 300
    h = 96
  } else if (type === 'positiongaps') {
    w = 300
    h = 92
  } else if (type === 'flagoverlay') {
    w = Math.min(base.width - 80, 760)
    h = 48
  } else if (type === 'inputbars') {
    w = 160
    h = 150
  } else if (type === 'inputtrace') {
    w = 320
    h = 130
  } else if (type === 'steering') {
    w = 260
    h = 90
  } else if (type === 'setupstrip') {
    w = Math.min(base.width - 80, 760)
    h = 56
  } else if (type === 'enginetemps') {
    w = 300
    h = 110
  } else if (type === 'weather') {
    w = 300
    h = 92
  } else if (type === 'trackmini') {
    w = 200
    h = 200
  } else if (type === 'value') {
    w = 200
    h = 96
  } else if (type === 'valuebar') {
    w = 200
    h = 104
  } else if (type === 'valuegauge') {
    w = 150
    h = 150
  }
  return {
    id: createElementId(),
    type,
    x,
    y,
    w,
    h,
    style: defaultStyleFor(type)
  }
}

// ── Pure playlist-row resolver (unit-tested; no React/DOM) ────────────────────
// A playlist can interleave dashboards with editable RGB button-box ("touch")
// panels. Touch-panel rows carry a panel id (not a dashboard id) and must be
// resolved against the touch-panel summaries — otherwise the UI shows a bogus
// "Dashboard not found" + raw id (the reported blocker).
export interface PlaylistRowLabel {
  kind: 'dashboard' | 'touch-panel'
  name: string
  subtitle: string
  found: boolean
}

export function resolvePlaylistRowLabel(
  item: DashboardPlaylistItem,
  dashboardSummaries: ReadonlyArray<Pick<DashboardSummary, 'id' | 'name' | 'width' | 'height'>>,
  touchSummaries: ReadonlyArray<Pick<ButtonBoxSummary, 'id' | 'name' | 'columns' | 'rows'>>
): PlaylistRowLabel {
  if (isTouchPanelPlaylistItem(item)) {
    const id = item.touchPanelId ?? item.dashboardId
    const panel = touchSummaries.find((s) => s.id === id)
    return {
      kind: 'touch-panel',
      name: panel?.name ?? id,
      subtitle: panel ? `Touch panel · ${panel.columns}×${panel.rows}` : 'Touch panel not found',
      found: Boolean(panel)
    }
  }
  const dash = dashboardSummaries.find((s) => s.id === item.dashboardId)
  return {
    kind: 'dashboard',
    name: dash?.name ?? item.dashboardId,
    subtitle: dash ? `${dash.width}×${dash.height}` : 'Dashboard not found',
    found: Boolean(dash)
  }
}

// ── Pure `style.instrument` writers (unit-tested; no React/DOM) ────────────────
// The instrument fidelity spec is ADDITIVE/OPTIONAL. These helpers immutably
// patch it, dropping keys set back to `undefined` and returning `undefined` when
// the whole spec becomes empty so the element cleanly reverts to its flat look.
function isEmptyRecord(obj: Record<string, unknown>): boolean {
  return Object.keys(obj).every((k) => obj[k] === undefined)
}

export function applyInstrumentPatch(
  style: DashboardElement['style'] | undefined,
  patch: Partial<InstrumentStyleSpec>
): InstrumentStyleSpec | undefined {
  const next: Record<string, unknown> = { ...(style?.instrument ?? {}) }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key]
    else next[key] = value
  }
  if (Object.keys(next).length === 0) return undefined
  return next as InstrumentStyleSpec
}

export function applyInstrumentPart(
  style: DashboardElement['style'] | undefined,
  part: string,
  field: string,
  value: unknown
): InstrumentStyleSpec | undefined {
  const cur = (style?.instrument ?? {}) as Record<string, unknown>
  const parts: Record<string, unknown> = { ...((cur.parts as Record<string, unknown>) ?? {}) }
  const partObj: Record<string, unknown> = { ...((parts[part] as Record<string, unknown>) ?? {}) }
  if (value === undefined) delete partObj[field]
  else partObj[field] = value
  if (Object.keys(partObj).length === 0 || isEmptyRecord(partObj)) delete parts[part]
  else parts[part] = partObj
  const next: Record<string, unknown> = { ...cur }
  if (Object.keys(parts).length === 0) delete next.parts
  else next.parts = parts
  if (Object.keys(next).length === 0) return undefined
  return next as InstrumentStyleSpec
}

export default function DashboardsView({ showToast }: AppViewProps): ReactElement {
  const [summaries, setSummaries] = useState<DashboardSummary[]>([])
  const [openStates, setOpenStates] = useState<DashboardOpenState[]>([])
  const [displays, setDisplays] = useState<DashboardDisplayInfo[]>([])
  const [playlist, setPlaylist] = useState<DashboardPlaylist>({ items: [], updatedAt: 0 })
  const [touchSummaries, setTouchSummaries] = useState<ButtonBoxSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedDashboardIds, setSelectedDashboardIds] = useState<Set<string>>(() => new Set())
  const [selectedDash, setSelectedDash] = useState<Dashboard | null>(null)
  const [selectedDisplayId, setSelectedDisplayId] = useState<number | null>(null)
  const [fullscreen, setFullscreen] = useState<boolean>(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const [snapEnabled, setSnapEnabled] = useState<boolean>(true)
  const [snapStep, setSnapStep] = useState<SnapStep>(8)
  const [galleryOpen, setGalleryOpen] = useState<boolean>(true)
  const [previewMode, setPreviewMode] = useState<'static' | 'sim'>('sim')
  const [importDiagnostics, setImportDiagnostics] = useState<string[]>([])
  const [importPicker, setImportPicker] = useState<SimhubImportPicker | null>(null)
  const [cycleControls, setCycleControls] = useState<DashboardCycleControls>({ next: null, prev: null })
  const [captureCycle, setCaptureCycle] = useState<CycleDirection | null>(null)
  const dirtyRef = useRef(false)
  // Espelho em estado do `dirtyRef` (que e so uma ref e not dispara render) para a
  // UI poder mostrar o indicador "not saved" e habilitar o button Save so quando ha
  // mudancas pendentes. `markDirty`/`markClean` mantem ref e estado em sincronia.
  const [dirty, setDirty] = useState(false)
  const markDirty = useCallback((): void => {
    dirtyRef.current = true
    setDirty(true)
  }, [])
  const markClean = useCallback((): void => {
    dirtyRef.current = false
    setDirty(false)
  }, [])
  const hidCaptureStateRef = useRef(new Map<string, boolean>())

  const applyDisplays = useCallback((screens: DashboardDisplayInfo[]) => {
    setDisplays(screens)
    setSelectedDisplayId((current) => {
      if (current !== null && screens.some((screen) => screen.id === current)) return current
      if (screens.length === 0) return null
      const primary = screens.find((screen) => screen.isPrimary) ?? screens[0]
      return primary.id
    })
  }, [])

  const refreshAll = useCallback(async () => {
    const [list, opens, screens, savedPlaylist, panels] = await Promise.all([
      window.ipc.invoke<DashboardSummary[]>('app:dash:list'),
      window.ipc.invoke<DashboardOpenState[]>('app:dash:listOpen'),
      window.ipc.invoke<DashboardDisplayInfo[]>('app:dash:listDisplays'),
      window.ipc.invoke<DashboardPlaylist>('app:dash:playlist:get'),
      window.ipc
        .invoke<ButtonBoxSummary[]>('app:touchpanel:list')
        .catch(() => [] as ButtonBoxSummary[])
    ])
    setSummaries(list)
    setOpenStates(opens)
    applyDisplays(screens)
    setPlaylist(savedPlaylist)
    setTouchSummaries(Array.isArray(panels) ? panels : [])
    setSelectedId((current) => {
      if (current) return current
      return list[0]?.id ?? null
    })
  }, [applyDisplays])

  useEffect(() => {
    void refreshAll().catch((err) =>
      setError(err instanceof Error ? err.message : 'Falha ao carregar dashboards')
    )
    const offList = window.ipc.subscribe<DashboardSummary[]>('app:dash:list', setSummaries)
    const offOpen = window.ipc.subscribe<DashboardOpenState[]>('app:dash:openState', setOpenStates)
    const offDisplays = window.ipc.subscribe<DashboardDisplayInfo[]>('app:dash:displaysChanged', applyDisplays)
    const offPlaylist = window.ipc.subscribe<DashboardPlaylist>('app:dash:playlist', setPlaylist)
    const offTouch = window.ipc.subscribe<ButtonBoxSummary[]>('app:touchpanel:list', (panels) =>
      setTouchSummaries(Array.isArray(panels) ? panels : [])
    )
    const offCycle = window.ipc.subscribe<DashboardCycleControls>('app:dash:cycleControl', setCycleControls)
    void window.ipc
      .invoke<DashboardCycleControls>('app:dash:cycleControl:get')
      .then(setCycleControls)
      .catch(() => undefined)
    return () => {
      offList()
      offOpen()
      offDisplays()
      offPlaylist()
      offTouch()
      offCycle()
    }
  }, [applyDisplays, refreshAll])

  useEffect(() => {
    const validIds = new Set(summaries.map((dash) => dash.id))
    setSelectedDashboardIds((current) => {
      const next = new Set(Array.from(current).filter((id) => validIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [summaries])

  useEffect(() => {
    if (!selectedId) {
      setSelectedDash(null)
      return
    }
    let canceled = false
    void window.ipc
      .invoke<Dashboard | null>('app:dash:get', selectedId)
      .then((dash) => {
        if (canceled) return
        setSelectedDash(dash)
        setSelectedElementId(dash && dash.elements.length > 0 ? dash.elements[0].id : null)
        markClean()
      })
      .catch((err: unknown) => {
        if (canceled) return
        setError(err instanceof Error ? err.message : 'Falha ao carregar dashboard')
      })
    return () => {
      canceled = true
    }
  }, [selectedId])

  // Avisa o usuario (nativo do browser/Electron) ao fechar/recarregar a janela com
  // changes de dashboard ainda not saved, evitando perda de edicao acidental.
  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao executar acao')
    } finally {
      setBusy(false)
    }
  }, [])

  const bindCycleButton = useCallback(
    async (direction: CycleDirection, control: HidButtonControl): Promise<void> => {
      const actionName = CYCLE_ACTION_NAME[direction]
      const action: ActionDefinition = { type: 'app', command: { name: actionName } }
      const timestamp = new Date().toISOString()
      const allBindings = await window.ipc.invoke<ActionBinding[]>('actions:getBindings')
      const conflict = allBindings.find(
        (binding) => binding.enabled && sameButton(binding.control, control) && !isCycleBinding(binding, direction)
      )
      const existingIndex = allBindings.findIndex((binding) => isCycleBinding(binding, direction))

      let nextBindings: ActionBinding[]
      if (existingIndex >= 0) {
        const existing = allBindings[existingIndex]
        nextBindings = allBindings.map((binding, index) =>
          index === existingIndex
            ? { ...existing, enabled: true, label: existing.label.trim() || CYCLE_BINDING_LABEL[direction], control, action, updatedAt: timestamp }
            : binding
        )
      } else {
        nextBindings = [
          ...allBindings,
          {
            id: createBindingId(),
            label: CYCLE_BINDING_LABEL[direction],
            enabled: true,
            control,
            action,
            createdAt: timestamp,
            updatedAt: timestamp
          }
        ]
      }

      const saved = await window.ipc.invoke<ActionBinding[]>('actions:setBindings', nextBindings)
      const savedControl = saved.find((binding) => isCycleBinding(binding, direction))?.control ?? control
      setCycleControls((current) => ({ ...current, [direction]: savedControl }))

      if (conflict) {
        showToast(
          `Button ${control.buttonIndex + 1} ja esta vinculado a "${conflict.label}" em Controls & Keyboard. As duas acoes vao disparar juntas.`,
          'info'
        )
      } else {
        showToast(`Button ${control.buttonIndex + 1} vinculado para ${CYCLE_FIELD_LABEL[direction].toLowerCase()}.`, 'success')
      }
    },
    [showToast]
  )

  const clearCycleButton = useCallback(
    async (direction: CycleDirection): Promise<void> => {
      const allBindings = await window.ipc.invoke<ActionBinding[]>('actions:getBindings')
      const nextBindings = allBindings.filter((binding) => !isCycleBinding(binding, direction))
      if (nextBindings.length !== allBindings.length) {
        await window.ipc.invoke<ActionBinding[]>('actions:setBindings', nextBindings)
        setCycleControls((current) => ({ ...current, [direction]: null }))
        showToast(`Atalho de ${CYCLE_FIELD_LABEL[direction].toLowerCase()} removido.`, 'info')
      }
      setCaptureCycle((current) => (current === direction ? null : current))
    },
    [showToast]
  )

  useEffect(() => {
    setActionRuntimeSuppressed(captureCycle !== null)
    return () => setActionRuntimeSuppressed(false)
  }, [captureCycle])

  useEffect(() => {
    if (captureCycle === null) return undefined
    const direction = captureCycle
    hidCaptureStateRef.current = new Map<string, boolean>()
    let frame = 0
    const tick = (): void => {
      const pressed = findFirstPressedButton(hidCaptureStateRef.current)
      if (pressed) {
        setCaptureCycle(null)
        void bindCycleButton(direction, {
          source: 'gamepad',
          gamepadId: pressed.gamepadId,
          gamepadIndex: pressed.gamepadIndex,
          buttonIndex: pressed.buttonIndex
        }).catch((err) => setError(err instanceof Error ? err.message : 'Falha ao vincular button'))
        return
      }
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [captureCycle, bindCycleButton])

  function patchSelected(patch: Partial<Dashboard>): void {
    setSelectedDash((current) => (current ? { ...current, ...patch } : current))
    markDirty()
  }

  function patchElement(elementId: string, patch: Partial<DashboardElement>): void {
    setSelectedDash((current) => {
      if (!current) return current
      return {
        ...current,
        elements: current.elements.map((el) =>
          el.id === elementId ? { ...el, ...patch, style: { ...el.style, ...(patch.style ?? {}) } } : el
        )
      }
    })
    markDirty()
  }

  function patchElementStyle(elementId: string, stylePatch: Partial<DashboardElement['style']>): void {
    setSelectedDash((current) => {
      if (!current) return current
      return {
        ...current,
        elements: current.elements.map((el) =>
          el.id === elementId ? { ...el, style: { ...el.style, ...stylePatch } } : el
        )
      }
    })
    markDirty()
  }

  function addElement(type: DashboardElementType): void {
    setSelectedDash((current) => {
      if (!current) return current
      const el = defaultElement(type, current)
      setSelectedElementId(el.id)
      return { ...current, elements: [...current.elements, el] }
    })
    markDirty()
  }

  function addVariant(variant: WidgetVariant): void {
    setSelectedDash((current) => {
      if (!current) return current
      const x = Math.max(0, Math.round((current.width - variant.w) / 2))
      const y = Math.max(0, Math.round((current.height - variant.h) / 2))
      const el = variantToElement(variant, x, y)
      setSelectedElementId(el.id)
      return { ...current, elements: [...current.elements, el] }
    })
    markDirty()
  }

  function removeElement(elementId: string): void {
    setSelectedDash((current) => {
      if (!current) return current
      const next = current.elements.filter((el) => el.id !== elementId)
      if (selectedElementId === elementId) setSelectedElementId(next[0]?.id ?? null)
      return { ...current, elements: next }
    })
    markDirty()
  }

  function duplicateElement(elementId: string): void {
    setSelectedDash((current) => {
      if (!current) return current
      const el = current.elements.find((e) => e.id === elementId)
      if (!el) return current
      const clone: DashboardElement = {
        ...el,
        id: createElementId(),
        x: el.x + 16,
        y: el.y + 16,
        name: `${el.name ?? el.type} copy`,
        style: { ...el.style }
      }
      setSelectedElementId(clone.id)
      return { ...current, elements: [...current.elements, clone] }
    })
    markDirty()
  }

  function nudgeElement(elementId: string, dx: number, dy: number): void {
    setSelectedDash((current) => {
      if (!current) return current
      return {
        ...current,
        elements: current.elements.map((el) =>
          el.id === elementId
            ? {
                ...el,
                x: Math.max(0, Math.min(current.width - el.w, el.x + dx)),
                y: Math.max(0, Math.min(current.height - el.h, el.y + dy))
              }
            : el
        )
      }
    })
    markDirty()
  }

  function alignElement(elementId: string, axis: 'h' | 'v'): void {
    setSelectedDash((current) => {
      if (!current) return current
      return {
        ...current,
        elements: current.elements.map((el) => {
          if (el.id !== elementId) return el
          if (axis === 'h') {
            return { ...el, x: Math.max(0, Math.round((current.width - el.w) / 2)) }
          }
          return { ...el, y: Math.max(0, Math.round((current.height - el.h) / 2)) }
        })
      }
    })
    markDirty()
  }

  function reorderElement(elementId: string, direction: 'front' | 'back' | 'forward' | 'backward'): void {
    setSelectedDash((current) => {
      if (!current) return current
      const next = reorderElements(current.elements, elementId, direction)
      if (next === current.elements) return current
      return { ...current, elements: next }
    })
    markDirty()
  }

  const patchElementGeometry = useCallback(
    (
      elementId: string,
      geometry: Partial<ElementGeometry>,
      options?: { snap?: boolean }
    ): void => {
      setSelectedDash((current) => {
        if (!current) return current
        return {
          ...current,
          elements: current.elements.map((el) => {
            if (el.id !== elementId) return el
            const step = options?.snap === false ? 1 : snapEnabled ? snapStep : 1
            const next: DashboardElement = { ...el }
            if (geometry.x !== undefined) next.x = snap(geometry.x, step)
            if (geometry.y !== undefined) next.y = snap(geometry.y, step)
            if (geometry.w !== undefined) next.w = Math.max(MIN_ELEMENT_SIZE, snap(geometry.w, step))
            if (geometry.h !== undefined) next.h = Math.max(MIN_ELEMENT_SIZE, snap(geometry.h, step))
            return { ...next, ...constrainElementGeometry(next, current) }
          })
        }
      })
      markDirty()
    },
    [snapEnabled, snapStep, markDirty]
  )

  async function saveCurrent(): Promise<Dashboard | null> {
    if (!selectedDash) return null
    const next = ensureId(selectedDash)
    const summary = await window.ipc.invoke<DashboardSummary>('app:dash:save', next)
    setSelectedId(summary.id)
    setSelectedDash(next)
    markClean()
    showToast(`Dashboard "${summary.name}" saved.`, 'success')
    return next
  }

  // Troca de dashboard selecionado na lista, confirmando o descarte quando ha
  // changes pendentes (clicar em outro item recarrega e sobrescreve o current).
  function selectDashboard(id: string): void {
    if (id === selectedId) return
    if (dirtyRef.current && !window.confirm('Ha changes not saved neste dashboard. Descarta-las e abrir outro?')) return
    setSelectedId(id)
  }

  async function openSelected(): Promise<void> {
    if (!selectedDash) return
    let dash = selectedDash
    if (dirtyRef.current) {
      const saved = await saveCurrent()
      if (saved) dash = saved
    }
    if (selectedDisplayId === null) throw new Error('Selecione um monitor primeiro.')
    await window.ipc.invoke('app:dash:open', dash.id, {
      displayId: selectedDisplayId,
      fullscreen
    })
    showToast('Dashboard aberto no monitor selecionado.', 'success')
  }

  async function closeOpen(id: string): Promise<void> {
    await window.ipc.invoke('app:dash:close', id)
  }

  // ── 7" touch launchers ─────────────────────────────────────────────────────
  async function openKiosk(): Promise<void> {
    if (!selectedDash) return
    let dash = selectedDash
    if (dirtyRef.current) {
      const saved = await saveCurrent()
      if (saved) dash = saved
    }
    if (selectedDisplayId === null) throw new Error('Selecione um monitor primeiro.')
    await window.ipc.invoke('app:dash:open', dash.id, buildKioskOpenOptions(selectedDisplayId))
    showToast('Dashboard aberto em modo Kiosk (deslize para trocar de preset).', 'success')
  }

  async function deleteCurrent(): Promise<void> {
    if (!selectedDash) return
    const confirmed = window.confirm(`Delete o dashboard "${selectedDash.name}"?`)
    if (!confirmed) return
    await window.ipc.invoke('app:dash:delete', selectedDash.id)
    setSelectedId(null)
    setSelectedDash(null)
    showToast('Dashboard deleted.', 'info')
  }

  function toggleDashboardSelection(id: string): void {
    setSelectedDashboardIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectionMode(): void {
    setSelectionMode((current) => {
      const next = !current
      if (!next) setSelectedDashboardIds(new Set())
      return next
    })
  }

  function selectAllDashboards(): void {
    setSelectedDashboardIds(new Set(summaries.map((dash) => dash.id)))
  }

  async function deleteSelectedDashboards(): Promise<void> {
    const ids = Array.from(selectedDashboardIds)
    if (ids.length === 0) return
    const confirmed = window.confirm(`Delete ${ids.length} dashboard${ids.length === 1 ? '' : 's'} selecionado${ids.length === 1 ? '' : 's'}?`)
    if (!confirmed) return
    const results = await Promise.allSettled(ids.map((id) => window.ipc.invoke('app:dash:delete', id)))
    const failed = results.filter((r) => r.status === 'rejected').length
    // Reconcile from the backend rather than trusting an optimistic filter, so a
    // partial failure never leaves already-deleted (or still-present) rows stale.
    await refreshAll().catch(() => undefined)
    setSelectedDashboardIds(new Set())
    setSelectionMode(false)
    if (selectedId && ids.includes(selectedId)) {
      setSelectedId(null)
      setSelectedDash(null)
    }
    const deleted = ids.length - failed
    if (failed > 0) {
      showToast(`${deleted} deleted${deleted === 1 ? '' : 's'}, ${failed} falhou.`, 'error')
    } else {
      showToast(`${deleted} dashboard${deleted === 1 ? '' : 's'} deleted${deleted === 1 ? '' : 's'}.`, 'info')
    }
  }

  function finishImport(result: SimhubImportResponse | null): void {
    if (!result) return
    setImportDiagnostics(result.notes ?? [])
    const picked = result.summary ?? result.summaries?.[0]
    if (picked) setSelectedId(picked.id)
    if (result.summaries && result.summaries.length > 1) {
      showToast(`${result.summaries.length} telas importadas como dashboards separados.`, 'success')
      return
    }
    if (result.summary) {
      showToast(
        result.notes.length > 0 ? `Importado com avisos: ${result.notes[0]}` : `Importado: ${result.summary.name}`,
        result.notes.length > 0 ? 'info' : 'success'
      )
    }
  }

  async function importSimhub(): Promise<void> {
    try {
      const result = await window.ipc.invoke<SimhubImportResponse | null>(
        'app:dash:importSimhub',
        undefined,
        { inspectOnly: true }
      )
      if (!result) return
      if (!result.summary && result.filePath && result.screens && result.screens.length > 1) {
        setImportPicker({
          filePath: result.filePath,
          screens: result.screens,
          selectedScreenIndex: result.selectedScreenIndex ?? result.screens.find((screen) => screen.selected)?.index ?? result.screens[0].index,
          notes: result.notes
        })
        setImportDiagnostics(result.notes ?? [])
        showToast('Selecione qual tela do .simhubdash importar.', 'info')
        return
      }
      finishImport(result)
    } catch {
      // Importacao cancelada ou falhou — sem acao.
    }
  }

  async function completeSimhubImport(importAll = false): Promise<void> {
    if (!importPicker) return
    const result = await window.ipc.invoke<SimhubImportResponse | null>(
      'app:dash:importSimhub',
      importPicker.filePath,
      importAll ? { importAll: true } : { screenIndex: importPicker.selectedScreenIndex }
    )
    setImportPicker(null)
    finishImport(result)
  }

  async function exportSimhub(): Promise<void> {
    if (!selectedDash) return
    let dash = selectedDash
    if (dirtyRef.current) {
      const saved = await saveCurrent()
      if (saved) dash = saved
    }
    const result = await window.ipc.invoke<{ path: string }>('app:dash:exportSimhub', dash.id)
    showToast(`Exportado em: ${result.path}`, 'success')
  }

  async function newFromPreset(presetId: string): Promise<void> {
    const summary = await window.ipc.invoke<DashboardSummary>('app:dash:createPreset', presetId)
    setSelectedId(summary.id)
    showToast(`Preset "${summary.name}" criado.`, 'success')
  }

  function newEmpty(width = 1280, height = 720, suggestedName = 'New dashboard'): void {
    const blank = newBlankDashboard(suggestedName, width, height)
    // Default to letterbox 'fit' so the canvas always scales to the target panel
    // without cropping, regardless of aspect ratio.
    blank.scaleMode = 'fit'
    setSelectedDash(blank)
    setSelectedId(null)
    setSelectedElementId(null)
    markDirty()
  }

  // Start a BLANK adaptive dashboard (adaptive mode on, empty widgets + moments)
  // instead of cloning the full adaptive preset. Mirrors `newEmpty`.
  function newBlankAdaptive(): void {
    const blank = createBlankAdaptiveDashboard()
    setSelectedDash(blank)
    setSelectedId(null)
    setSelectedElementId(null)
    markDirty()
  }

  const savePlaylist = useCallback(async (items: DashboardPlaylistItem[]): Promise<void> => {
    const saved = await window.ipc.invoke<DashboardPlaylist>('app:dash:playlist:set', { items, updatedAt: Date.now() })
    setPlaylist(saved)
  }, [])

  function addSelectedToPlaylist(): void {
    if (!selectedId) return
    const dashboardId = selectedId
    const displayId = selectedDisplayId ?? displays.find((display) => display.isPrimary)?.id ?? displays[0]?.id
    void run(async () => {
      await savePlaylist([...playlist.items, { dashboardId, displayId, fullscreen }])
      showToast('Dashboard added a playlist.', 'success')
    })
  }

  function patchPlaylistItem(index: number, patch: Partial<DashboardPlaylistItem>): void {
    void run(async () => {
      await savePlaylist(playlist.items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)))
    })
  }

  function removePlaylistItem(index: number): void {
    void run(async () => {
      await savePlaylist(playlist.items.filter((_, itemIndex) => itemIndex !== index))
      showToast('Item removido da playlist.', 'info')
    })
  }

  function movePlaylistItem(index: number, delta: -1 | 1): void {
    const nextIndex = index + delta
    if (nextIndex < 0 || nextIndex >= playlist.items.length) return
    const items = [...playlist.items]
    const [item] = items.splice(index, 1)
    items.splice(nextIndex, 0, item)
    void run(async () => savePlaylist(items))
  }

  const selectedElement = useMemo(() => {
    if (!selectedDash || !selectedElementId) return null
    return selectedDash.elements.find((el) => el.id === selectedElementId) ?? null
  }, [selectedDash, selectedElementId])

  const isOpen = useMemo(() => {
    return selectedDash ? openStates.some((s) => s.id === selectedDash.id) : false
  }, [openStates, selectedDash])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 0 }}>
      <section style={panelHeader()}>
        <div>
          <h3 style={{ margin: 0 }}>Dashboards</h3>
          <p style={{ margin: '6px 0 0', color: TEXT_DIM }}>
            Janelas own no monitor 1/2 com telemetria ao vivo. Importa/exporta <code>.simhubdash</code> (SimHub Dash Studio) e tem construtor basico.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <SectionExportImport sectionId="dashboards" label="Dashboards" onImported={() => void refreshAll()} />
          <button style={btn('primary')} disabled={busy} onClick={() => run(importSimhub)}>
            Importar .simhubdash…
          </button>
          <button style={btn()} disabled={busy || !selectedDash} onClick={() => run(exportSimhub)}>
            Exportar .simhubdash…
          </button>
          <button style={btn()} disabled={busy} onClick={() => newEmpty(1280, 720, 'New dashboard')}>
            New (vazio)
          </button>
          {NEW_RESOLUTION_PRESETS.map((p) => (
            <button
              key={p.id}
              style={btn()}
              disabled={busy}
              onClick={() => newEmpty(p.width, p.height, `New ${p.label}`)}
              title={`Cria um dashboard vazio em ${p.width}×${p.height}`}
            >
              + {p.label}
            </button>
          ))}
        </div>
      </section>

      {error && <section style={panel({ borderColor: '#ff5468' })}>{error}</section>}

      {importPicker && (
        <section style={panel({ borderColor: ACCENT })}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div>
              <h4 style={{ margin: '0 0 4px' }}>Escolha a tela do .simhubdash</h4>
              <p style={{ margin: 0, color: TEXT_DIM, fontSize: 13 }}>
                O arquivo tem multiple telas. A tela sugerida ja esta selected; voce tambem pode importar todas como dashboards separados.
              </p>
            </div>
            <button style={btn()} disabled={busy} onClick={() => setImportPicker(null)}>Cancel</button>
          </div>
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            {importPicker.screens.map((screen) => (
              <label key={screen.index} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 10, border: `1px solid ${PANEL_BORDER}`, borderRadius: 'var(--radius-sm)', background: 'var(--surface-sunken)', cursor: 'pointer' }}>
                <input
                  type="radio"
                  checked={importPicker.selectedScreenIndex === screen.index}
                  onChange={() => setImportPicker((current) => current ? { ...current, selectedScreenIndex: screen.index } : current)}
                />
                <div style={{ flex: 1 }}>
                  <strong style={{ color: screen.selected ? ACCENT : TEXT_FG }}>{screen.name}</strong>
                  <div style={{ color: TEXT_DIM, fontSize: 12 }}>
                    {screen.elementCount} elements · score {screen.score}
                    {screen.inGame ? ' · corrida' : ''}{screen.pit ? ' · pit' : ''}{screen.idle ? ' · idle' : ''}
                  </div>
                </div>
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button style={btn('primary')} disabled={busy} onClick={() => run(() => completeSimhubImport(false))}>
              Importar tela selected
            </button>
            <button style={btn()} disabled={busy} onClick={() => run(() => completeSimhubImport(true))}>
              Importar todas as telas
            </button>
          </div>
        </section>
      )}

      {importDiagnostics.length > 0 && (
        <section style={panel({ borderColor: '#ffb84d' })}>
          <h4 style={{ margin: '0 0 8px' }}>Diagnostics da import</h4>
          <ul style={{ margin: 0, paddingLeft: 18, color: TEXT_DIM, fontSize: 13 }}>
            {importDiagnostics.map((note, index) => (
              <li key={`${index}-${note.slice(0, 24)}`}>{note}</li>
            ))}
          </ul>
        </section>
      )}

      <section style={panel()}>
        <h4 style={{ margin: '0 0 4px' }}>Preset gallery</h4>
        <p style={{ margin: '0 0 12px', color: TEXT_DIM, fontSize: 13 }}>
          Ready layouts with a real model preview. Filter by multiple tags and click <strong>Duplicate and edit</strong> to create an editable copy (original presets are never changed). Look for <strong>Dashboard Adaptive</strong> (the “Adaptive” badge, tag <code>adaptive</code>): it reorganizes itself live based on the session phase and lap moment.
        </p>
        <PresetGallery presets={BUILTIN_PRESETS} busy={busy} onPick={(id) => (id === ADAPTIVE_DASHBOARD_ID ? newBlankAdaptive() : run(() => newFromPreset(id)))} />
      </section>


      <section style={panel()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <h4 style={{ margin: '0 0 4px' }}>Playlist de corrida</h4>
            <p style={{ margin: 0, color: TEXT_DIM, fontSize: 13 }}>
              Monte a ordem dos dashboards e capture um button do buttonbox abaixo para alternar durante a corrida. O atalho e saved junto com <strong>Controls &amp; Keyboard</strong> e aparece la automaticamente.
            </p>
          </div>
          <button style={btn('primary')} disabled={busy || !selectedId} onClick={addSelectedToPlaylist}>
            Add selecionado
          </button>
        </div>
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${PANEL_BORDER}` }}>
          <div style={{ color: TEXT_FG, fontWeight: 700, fontSize: 14, marginBottom: 2 }}>Button para alternar dashboards</div>
          <p style={{ margin: '0 0 10px', color: TEXT_DIM, fontSize: 13 }}>
            Arme a captura e pressione o button do buttonbox. O vinculo e gravado no mesmo lugar de <strong>Controls &amp; Keyboard</strong> e fica sincronizado nos dois menus.
          </p>
          <div style={{ display: 'grid', gap: 8 }}>
            {(['next', 'prev'] as CycleDirection[]).map((direction) => {
              const control = cycleControls[direction]
              const arming = captureCycle === direction
              const otherArming = captureCycle !== null && !arming
              return (
                <div
                  key={direction}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    flexWrap: 'wrap',
                    padding: 10,
                    border: `1px solid ${arming ? ACCENT : PANEL_BORDER}`,
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--surface-sunken)'
                  }}
                >
                  <div style={{ minWidth: 150 }}>
                    <div style={{ color: TEXT_FG, fontWeight: 700, fontSize: 13 }}>{CYCLE_FIELD_LABEL[direction]}</div>
                    <div style={{ color: TEXT_DIM, fontSize: 12 }}>{direction === 'next' ? 'Next dashboard da playlist' : 'Dashboard anterior da playlist'}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 130, color: arming ? ACCENT : control ? TEXT_FG : TEXT_DIM, fontWeight: 700, fontSize: 14 }}>
                    {arming ? 'Pressione um button…' : control ? `Button ${control.buttonIndex + 1}` : 'None button'}
                  </div>
                  {arming ? (
                    <button style={btn('danger')} onClick={() => setCaptureCycle(null)}>Cancel</button>
                  ) : (
                    <button style={btn('primary')} disabled={busy || otherArming} onClick={() => setCaptureCycle(direction)}>
                      {control ? 'Recapturar' : 'Capturar button'}
                    </button>
                  )}
                  {control && !arming && (
                    <button style={btn()} disabled={busy} onClick={() => run(() => clearCycleButton(direction))}>Clear</button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {playlist.items.length === 0 && <div style={{ color: TEXT_DIM, fontSize: 13 }}>Playlist vazia. Selecione um dashboard e adicione a sequence.</div>}
          {playlist.items.map((item, index) => {
            const label = resolvePlaylistRowLabel(item, summaries, touchSummaries)
            const open = openStates.find((state) => state.id === item.dashboardId)
            const isTouch = label.kind === 'touch-panel'
            return (
              <div key={`${item.dashboardId}-${index}`} style={{ display: 'grid', gridTemplateColumns: '32px minmax(180px, 1fr) 220px 120px 190px', gap: 8, alignItems: 'center', padding: 10, border: `1px solid ${PANEL_BORDER}`, borderRadius: 'var(--radius-sm)', background: 'var(--surface-sunken)' }}>
                <strong style={{ color: ACCENT }}>#{index + 1}</strong>
                <div>
                  <div style={{ color: TEXT_FG, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {isTouch && (
                      <span aria-hidden title="Touch panel" style={{ fontSize: 11, fontWeight: 800, color: '#0a0c10', background: ACCENT, borderRadius: 4, padding: '1px 5px' }}>
                        TOUCH
                      </span>
                    )}
                    {label.name}
                  </div>
                  <div style={{ color: label.found ? TEXT_DIM : 'var(--accent-danger)', fontSize: 12 }}>
                    {label.subtitle}{open ? ` · aberto no monitor ${open.displayId}` : ''}
                  </div>
                </div>
                <select
                  value={item.displayId ?? ''}
                  onChange={(event) => patchPlaylistItem(index, { displayId: event.target.value ? Number(event.target.value) : undefined })}
                  style={input()}
                >
                  <option value="">Monitor primary</option>
                  {displays.map((display) => (
                    <option key={display.id} value={display.id}>
                      {display.label} · {display.bounds.width}×{display.bounds.height}{display.isPrimary ? ' · primary' : ''}
                    </option>
                  ))}
                </select>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: TEXT_DIM, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={item.fullscreen ?? true}
                    onChange={(event) => patchPlaylistItem(index, { fullscreen: event.target.checked })}
                  />
                  Tela cheia
                </label>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <button style={btn()} disabled={busy || index === 0} onClick={() => movePlaylistItem(index, -1)}>↑</button>
                  <button style={btn()} disabled={busy || index === playlist.items.length - 1} onClick={() => movePlaylistItem(index, 1)}>↓</button>
                  <button style={btn('danger')} disabled={busy} onClick={() => removePlaylistItem(index)}>Remove</button>
                </div>
              </div>
            )
          })}
        </div>
        <p style={{ margin: '10px 0 0', color: TEXT_DIM, fontSize: 12 }}>
          Estado current: {openStates.length === 0 ? 'no dashboard aberto' : openStates.map((state) => `${summaries.find((dash) => dash.id === state.id)?.name ?? touchSummaries.find((p) => p.id === state.id)?.name ?? state.id} no monitor ${state.displayId}`).join(' · ')}.
        </p>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16 }}>
        <section style={panel({ padding: 0 })}>
          <div style={{ padding: 12, borderBottom: `1px solid ${PANEL_BORDER}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div>
              <strong>Meus dashboards</strong>
              <span style={{ color: TEXT_DIM, fontSize: 12, marginLeft: 8 }}>{selectionMode ? `${selectedDashboardIds.size} selecionado${selectedDashboardIds.size === 1 ? '' : 's'}` : summaries.length}</span>
            </div>
            <button type="button" style={btn(selectionMode ? 'primary' : 'default')} disabled={busy || summaries.length === 0} onClick={toggleSelectionMode}>
              {selectionMode ? 'Cancel' : 'Select'}
            </button>
          </div>
          {selectionMode && (
            <div style={{ padding: 10, borderBottom: `1px solid ${PANEL_BORDER}`, display: 'flex', gap: 6, flexWrap: 'wrap', background: 'var(--surface-sunken)' }}>
              <button type="button" style={btn()} disabled={busy || summaries.length === 0} onClick={selectAllDashboards}>Select tudo</button>
              <button type="button" style={btn()} disabled={busy || selectedDashboardIds.size === 0} onClick={() => setSelectedDashboardIds(new Set())}>Clear</button>
              <button type="button" style={btn('danger')} disabled={busy || selectedDashboardIds.size === 0} onClick={() => run(deleteSelectedDashboards)}>Delete selecionados</button>
            </div>
          )}
          <div style={{ maxHeight: 460, overflowY: 'auto' }}>
            {summaries.length === 0 && (
              <div style={{ padding: 16, color: TEXT_DIM }}>
                None dashboard. Use um preset ou importe um <code>.simhubdash</code>.
              </div>
            )}
            {summaries.map((s) => {
              const open = openStates.find((o) => o.id === s.id)
              const active = s.id === selectedId
              return (
                <button
                  key={s.id}
                  onClick={() => selectionMode ? toggleDashboardSelection(s.id) : selectDashboard(s.id)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 12px',
                    background: selectedDashboardIds.has(s.id) ? 'rgba(255,84,104,0.16)' : active ? `${ACCENT}22` : 'transparent',
                    color: TEXT_FG,
                    border: 'none',
                    borderBottom: `1px solid ${PANEL_BORDER}`,
                    borderLeft: selectedDashboardIds.has(s.id) ? '3px solid #ff5468' : active ? `3px solid ${ACCENT}` : '3px solid transparent',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      {selectionMode && (
                        <input
                          type="checkbox"
                          checked={selectedDashboardIds.has(s.id)}
                          onChange={() => toggleDashboardSelection(s.id)}
                          onClick={(event) => event.stopPropagation()}
                        />
                      )}
                      <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</strong>
                    </span>
                    {open && <span style={{ color: ACCENT, fontSize: 11, fontWeight: 700, flex: '0 0 auto' }}>ABERTO</span>}
                  </div>
                  <div style={{ color: TEXT_DIM, fontSize: 12, paddingLeft: selectionMode ? 24 : 0 }}>
                    {s.width}×{s.height} · {s.elementCount} elements
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        <section style={panel()}>
          {!selectedDash ? (
            <div style={{ color: TEXT_DIM, padding: 16 }}>Selecione um dashboard a esquerda ou crie um novo.</div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label style={fieldLabel()}>Name</label>
                  <input
                    type="text"
                    value={selectedDash.name}
                    onChange={(e) => patchSelected({ name: e.target.value })}
                    style={input()}
                  />
                </div>
                <div style={{ width: 110 }}>
                  <label style={fieldLabel()}>Width</label>
                  <input
                    type="number"
                    value={selectedDash.width}
                    onChange={(e) => patchSelected({ width: Math.max(320, Number(e.target.value) || 320) })}
                    style={input()}
                  />
                </div>
                <div style={{ width: 110 }}>
                  <label style={fieldLabel()}>Height</label>
                  <input
                    type="number"
                    value={selectedDash.height}
                    onChange={(e) => patchSelected({ height: Math.max(240, Number(e.target.value) || 240) })}
                    style={input()}
                  />
                </div>
                <div style={{ width: 140 }}>
                  <label style={fieldLabel()}>Cor de fundo</label>
                  <input
                    type="color"
                    value={hexFromCss(selectedDash.bg)}
                    onChange={(e) => patchSelected({ bg: e.target.value })}
                    style={{ ...input(), padding: 2, height: 36 }}
                  />
                </div>
                <div style={{ width: 220 }}>
                  <label style={fieldLabel()}>Escala na janela</label>
                  <select
                    value={selectedDash.scaleMode ?? 'fit'}
                    onChange={(e) =>
                      patchSelected({ scaleMode: e.target.value as DashboardScaleMode })
                    }
                    style={input()}
                    title={
                      SCALE_MODES.find((m) => m.value === (selectedDash.scaleMode ?? 'fit'))?.hint ??
                      ''
                    }
                  >
                    {SCALE_MODES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p style={{ margin: '6px 0 0', color: TEXT_DIM, fontSize: 12 }}>
                {SCALE_MODES.find((m) => m.value === (selectedDash.scaleMode ?? 'fit'))?.hint}
              </p>

              <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <label style={{ ...fieldLabel(), margin: 0 }}>Monitor</label>
                <select
                  value={selectedDisplayId ?? ''}
                  onChange={(e) => setSelectedDisplayId(Number(e.target.value))}
                  style={input({ width: 'auto' })}
                >
                  {displays.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label} · {d.bounds.width}×{d.bounds.height}{d.isPrimary ? ' · primary' : ''}
                    </option>
                  ))}
                </select>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: TEXT_DIM, fontSize: 13 }}>
                  <input type="checkbox" checked={fullscreen} onChange={(e) => setFullscreen(e.target.checked)} />
                  Tela cheia
                </label>
                <button style={btn('primary')} disabled={busy || !selectedDash} onClick={() => run(openSelected)}>
                  {isOpen ? 'Reabrir aqui' : 'Open no monitor'}
                </button>
                {isOpen && (
                  <button style={btn('danger')} disabled={busy} onClick={() => run(() => closeOpen(selectedDash.id))}>
                    Fechar janela
                  </button>
                )}
                <button
                  style={btn(dirty ? 'primary' : 'default')}
                  disabled={busy || !dirty}
                  onClick={() => run(async () => { await saveCurrent() })}
                  title={dirty ? 'Save as changes deste dashboard' : 'No alteracao pendente'}
                >
                  Save dashboard
                </button>
                <span
                  style={{ fontSize: 12, fontWeight: 700, color: dirty ? '#ffb84d' : TEXT_DIM, whiteSpace: 'nowrap' }}
                  title={dirty ? 'Ha changes not saved neste dashboard' : 'All as changes foram saved'}
                >
                  {dirty ? '● not saved' : '✓ saved'}
                </span>
                <button style={btn('danger')} disabled={busy || !selectedId} onClick={() => run(deleteCurrent)}>
                  Delete
                </button>
              </div>

              <div
                style={{
                  marginTop: 16,
                  padding: 14,
                  borderRadius: 10,
                  border: `1px solid ${PANEL_BORDER}`,
                  background: '#0b0e13',
                  display: 'grid',
                  gap: 14
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 18 }} aria-hidden>📟</span>
                  <strong style={{ color: TEXT_FG, fontSize: 14, letterSpacing: '0.04em' }}>
                    Tela 7&quot; / Kiosk
                  </strong>
                </div>

                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    <button
                      style={{ ...btn('primary'), display: 'flex', alignItems: 'center', gap: 6 }}
                      disabled={busy || !selectedDash}
                      onClick={() => run(openKiosk)}
                      title="Abre o dashboard selecionado em tela cheia, com gestos de toque (deslizar/tocar nas bordas troca de preset)."
                    >
                      <span aria-hidden>🖐</span> Open como Kiosk
                    </button>
                    <span style={{ color: TEXT_DIM, fontSize: 12 }}>
                      Abre o dashboard selecionado em tela cheia no monitor escolhido acima, com
                      deslize/toque para trocar de preset (ideal para a tela de 7&quot; no cockpit).
                    </span>
                  </div>
                  <p style={{ margin: 0, color: TEXT_DIM, fontSize: 12 }}>
                    ℹ Painel de Pit foi movido para Touch Controls Dash.
                  </p>
                </div>
              </div>

              <hr style={{ border: 0, borderTop: `1px solid ${PANEL_BORDER}`, margin: '16px 0' }} />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                    <button
                      type="button"
                      style={{ ...btn(galleryOpen ? 'primary' : 'default'), display: 'flex', alignItems: 'center', gap: 6 }}
                      onClick={() => setGalleryOpen((v) => !v)}
                      title="Mostrar/ocultar a galeria de widgets"
                    >
                      {galleryOpen ? '▾' : '▸'} Galeria de widgets
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <label style={{ color: TEXT_DIM, fontSize: 12 }}>Add avancado</label>
                      <select
                        value=""
                        onChange={(e) => {
                          const v = e.target.value as DashboardElementType
                          if (v) addElement(v)
                          e.target.value = ''
                        }}
                        style={{ ...input({ width: 'auto' }), padding: '4px 8px', fontSize: 12 }}
                      >
                        <option value="">+ tipo…</option>
                        {ELEMENT_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {galleryOpen && (
                    <div
                      style={{
                        maxHeight: 320,
                        overflowY: 'auto',
                        padding: 12,
                        marginBottom: 10,
                        background: '#07090c',
                        border: `1px solid ${PANEL_BORDER}`,
                        borderRadius: 'var(--radius-sm)'
                      }}
                    >
                      <WidgetGallery onAdd={addVariant} busy={busy} />
                    </div>
                  )}
                  <div
                    style={{
                      display: 'flex',
                      gap: 12,
                      alignItems: 'center',
                      marginBottom: 8,
                      padding: '6px 10px',
                      background: 'var(--surface-sunken)',
                      border: `1px solid ${PANEL_BORDER}`,
                      borderRadius: 'var(--radius-sm)',
                      flexWrap: 'wrap'
                    }}
                  >
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: TEXT_DIM, fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={snapEnabled}
                        onChange={(e) => setSnapEnabled(e.target.checked)}
                      />
                      Snap a grade
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: TEXT_DIM, fontSize: 12 }}>
                      Passo
                      <select
                        value={snapStep}
                        onChange={(e) => setSnapStep(Number(e.target.value) as SnapStep)}
                        style={{ ...input({ width: 'auto' }), padding: '2px 6px', fontSize: 12 }}
                      >
                        {SNAP_STEPS.map((s) => (
                          <option key={s} value={s}>{s}px</option>
                        ))}
                      </select>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: TEXT_DIM, fontSize: 12 }}>
                      Preview
                      <select
                        value={previewMode}
                        onChange={(e) => setPreviewMode(e.target.value as 'static' | 'sim')}
                        style={{ ...input({ width: 'auto' }), padding: '2px 6px', fontSize: 12 }}
                      >
                        <option value="sim">Telemetria simulada</option>
                        <option value="static">Estatico</option>
                      </select>
                    </label>
                    <span style={{ color: TEXT_DIM, fontSize: 11 }}>
                      {selectedDash.elements.length} elements · canvas {selectedDash.width}×{selectedDash.height}
                    </span>
                  </div>
                  <DashboardPreview
                    dashboard={selectedDash}
                    selectedId={selectedElementId}
                    onSelect={setSelectedElementId}
                    onChangeGeometry={patchElementGeometry}
                    snapEnabled={snapEnabled}
                    showGrid={snapEnabled}
                    gridStep={snapStep}
                    simulate={previewMode === 'sim'}
                  />
                  <p style={{ color: TEXT_DIM, fontSize: 12, margin: '8px 0 0' }}>
                    {previewMode === 'sim'
                      ? 'Preview com telemetria simulada (estado "em corrida"). Clique, arraste ou redimensione pelos handles para editar.'
                      : 'Preview static (sem telemetria). Clique, arraste ou redimensione pelos handles para editar.'}
                    {snapEnabled ? ` Grade ${snapStep}px active: ajustes de posicao/tamanho sao arredondata.` : ''}
                  </p>
                </div>
                <div>
                  <ElementInspector
                    dashboard={selectedDash}
                    element={selectedElement}
                    snapStep={snapEnabled ? snapStep : 1}
                    onChange={(patch) =>
                      selectedElement && patchElement(selectedElement.id, patch)
                    }
                    onChangeGeometry={(geo) =>
                      selectedElement && patchElementGeometry(selectedElement.id, geo)
                    }
                    onChangeStyle={(stylePatch) =>
                      selectedElement && patchElementStyle(selectedElement.id, stylePatch)
                    }
                    onDuplicate={() => selectedElement && duplicateElement(selectedElement.id)}
                    onRemove={() => selectedElement && removeElement(selectedElement.id)}
                    onNudge={(dx, dy) => selectedElement && nudgeElement(selectedElement.id, dx, dy)}
                    onAlign={(axis) => selectedElement && alignElement(selectedElement.id, axis)}
                    onReorder={(dir) => selectedElement && reorderElement(selectedElement.id, dir)}
                  />
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

interface PreviewProps {
  dashboard: Dashboard
  selectedId: string | null
  onSelect(id: string): void
  onChangeGeometry(
    id: string,
    geometry: Partial<ElementGeometry>,
    options?: { snap?: boolean }
  ): void
  snapEnabled?: boolean
  showGrid?: boolean
  gridStep?: number
  simulate?: boolean
}

interface PointerEditState {
  elementId: string
  mode: 'move' | 'resize'
  handle?: ResizeHandle
  pointerId: number
  startClientX: number
  startClientY: number
  startGeometry: ElementGeometry
  scaleX: number
  scaleY: number
  snapStep: number
}

function handleCursor(handle: ResizeHandle): string {
  const cursors: Record<ResizeHandle, string> = {
    n: 'ns-resize',
    ne: 'nesw-resize',
    e: 'ew-resize',
    se: 'nwse-resize',
    s: 'ns-resize',
    sw: 'nesw-resize',
    w: 'ew-resize',
    nw: 'nwse-resize'
  }
  return cursors[handle]
}

function resizeHandleStyle(handle: ResizeHandle, size: number): CSSProperties {
  const half = size / 2
  const style: CSSProperties = {
    position: 'absolute',
    width: size,
    height: size,
    background: ACCENT,
    border: '1px solid #05070a',
    borderRadius: 'var(--radius-sm)',
    
    cursor: handleCursor(handle),
    zIndex: 3,
    touchAction: 'none'
  }

  if (handle.includes('n')) style.top = -half
  if (handle.includes('s')) style.bottom = -half
  if (handle.includes('w')) style.left = -half
  if (handle.includes('e')) style.right = -half
  if (handle === 'n' || handle === 's') {
    style.left = '50%'
    style.transform = 'translateX(-50%)'
  }
  if (handle === 'e' || handle === 'w') {
    style.top = '50%'
    style.transform = 'translateY(-50%)'
  }
  return style
}

function computeResizeGeometry(
  start: ElementGeometry,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  dashboard: Pick<Dashboard, 'width' | 'height'>,
  step: number
): ElementGeometry {
  let left = start.x
  let top = start.y
  let right = start.x + start.w
  let bottom = start.y + start.h

  if (handle.includes('w')) left = snap(start.x + dx, step)
  if (handle.includes('e')) right = snap(start.x + start.w + dx, step)
  if (handle.includes('n')) top = snap(start.y + dy, step)
  if (handle.includes('s')) bottom = snap(start.y + start.h + dy, step)

  if (right - left < MIN_ELEMENT_SIZE) {
    if (handle.includes('w')) left = right - MIN_ELEMENT_SIZE
    else right = left + MIN_ELEMENT_SIZE
  }
  if (bottom - top < MIN_ELEMENT_SIZE) {
    if (handle.includes('n')) top = bottom - MIN_ELEMENT_SIZE
    else bottom = top + MIN_ELEMENT_SIZE
  }

  if (left < 0) left = 0
  if (top < 0) top = 0
  if (right > dashboard.width) right = dashboard.width
  if (bottom > dashboard.height) bottom = dashboard.height

  if (right - left < MIN_ELEMENT_SIZE) {
    if (handle.includes('w')) left = Math.max(0, right - MIN_ELEMENT_SIZE)
    else right = Math.min(dashboard.width, left + MIN_ELEMENT_SIZE)
  }
  if (bottom - top < MIN_ELEMENT_SIZE) {
    if (handle.includes('n')) top = Math.max(0, bottom - MIN_ELEMENT_SIZE)
    else bottom = Math.min(dashboard.height, top + MIN_ELEMENT_SIZE)
  }

  return constrainElementGeometry({ x: left, y: top, w: right - left, h: bottom - top }, dashboard)
}

function DashboardPreview({
  dashboard,
  selectedId,
  onSelect,
  onChangeGeometry,
  snapEnabled,
  showGrid,
  gridStep,
  simulate
}: PreviewProps): ReactElement {
  const maxW = 640
  const maxH = 360
  const _sx = maxW / dashboard.width
  const _sy = maxH / dashboard.height
  const scaleMode = dashboard.scaleMode ?? 'fit'
  let scaleX: number
  let scaleY: number
  if (scaleMode === 'stretch') {
    scaleX = _sx
    scaleY = _sy
  } else if (scaleMode === 'fill') {
    const _s = Math.max(_sx, _sy)
    scaleX = _s
    scaleY = _s
  } else {
    const _s = Math.min(_sx, _sy)
    scaleX = _s
    scaleY = _s
  }
  const previewW = scaleMode === 'fit' ? Math.round(dashboard.width * scaleX) : maxW
  const previewH = scaleMode === 'fit' ? Math.round(dashboard.height * scaleY) : maxH
  const offsetX = Math.floor((previewW - dashboard.width * scaleX) / 2)
  const offsetY = Math.floor((previewH - dashboard.height * scaleY) / 2)
  const snapStep = snapEnabled && gridStep ? gridStep : 1
  const activeEditRef = useRef<PointerEditState | null>(null)
  // Paint in z-order so the editor preview matches DashboardRoot runtime
  // stacking (WYSIWYG). Selection/drag stay keyed by stable element ids, so
  // sorting only affects paint order, not which element is selected/dragged.
  const sortedElements = useMemo(() => sortElementsByZ(dashboard.elements), [dashboard.elements])
  const handleSize = Math.max(8, 10 / Math.max((scaleX + scaleY) / 2, 0.01))
  const gridBg =
    showGrid && gridStep && gridStep > 1
      ? `repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0 1px, transparent 1px ${gridStep}px),
         repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 1px, transparent 1px ${gridStep}px)`
      : undefined

  useEffect(() => {
    return () => {
      activeEditRef.current = null
    }
  }, [])

  function beginPointerEdit(
    event: PointerEvent<HTMLElement>,
    element: DashboardElement,
    mode: PointerEditState['mode'],
    handle?: ResizeHandle
  ): void {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    onSelect(element.id)
    event.currentTarget.setPointerCapture(event.pointerId)
    activeEditRef.current = {
      elementId: element.id,
      mode,
      handle,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startGeometry: { x: element.x, y: element.y, w: element.w, h: element.h },
      scaleX,
      scaleY,
      snapStep
    }
  }

  function updatePointerEdit(event: PointerEvent<HTMLElement>): void {
    const active = activeEditRef.current
    if (!active || active.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()

    const dx = (event.clientX - active.startClientX) / active.scaleX
    const dy = (event.clientY - active.startClientY) / active.scaleY
    const step = event.altKey ? 1 : active.snapStep
    const geometry =
      active.mode === 'move'
        ? constrainElementGeometry(
            {
              ...active.startGeometry,
              x: snap(active.startGeometry.x + dx, step),
              y: snap(active.startGeometry.y + dy, step)
            },
            dashboard
          )
        : computeResizeGeometry(active.startGeometry, active.handle ?? 'se', dx, dy, dashboard, step)

    onChangeGeometry(active.elementId, geometry, { snap: false })
  }

  function endPointerEdit(event: PointerEvent<HTMLElement>): void {
    const active = activeEditRef.current
    if (!active || active.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    activeEditRef.current = null
  }

  return (
    <div
      style={{
        width: previewW,
        height: previewH,
        background: dashboard.bg,
        border: `1px solid ${PANEL_BORDER}`,
        borderRadius: 'var(--radius-sm)',
        position: 'relative',
        overflow: 'hidden',
        userSelect: 'none',
        touchAction: 'none'
      }}
    >
      <div
        style={{
          position: 'absolute',
          right: 8,
          top: 8,
          zIndex: 5,
          padding: '3px 6px',
          borderRadius: 'var(--radius-sm)',
          background: 'rgba(5,7,10,0.72)',
          border: `1px solid ${PANEL_BORDER}`,
          color: TEXT_DIM,
          fontSize: 10,
          pointerEvents: 'none'
        }}
      >
        Snap {snapStep > 1 ? `${snapStep}px` : 'livre'} · Alt = livre
      </div>
      <div
        style={{
          width: dashboard.width,
          height: dashboard.height,
          transform: scaleX === scaleY ? `scale(${scaleX})` : `scale(${scaleX}, ${scaleY})`,
          transformOrigin: 'top left',
          position: 'absolute',
          left: offsetX,
          top: offsetY,
          backgroundImage: gridBg,
          backgroundSize: gridBg ? `${gridStep}px ${gridStep}px` : undefined
        }}
      >
        {sortedElements.map((el) => (
          <PreviewElement
            key={el.id}
            element={el}
            selected={el.id === selectedId}
            handleSize={handleSize}
            onSelect={() => onSelect(el.id)}
            onPointerDown={(event) => beginPointerEdit(event, el, 'move')}
            onPointerMove={updatePointerEdit}
            onPointerUp={endPointerEdit}
            onPointerCancel={endPointerEdit}
            onResizePointerDown={(event, handle) => beginPointerEdit(event, el, 'resize', handle)}
            simulate={simulate}
          />
        ))}
      </div>
    </div>
  )
}

// Wrapper de selecao para um widget GT3 renderizado ao vivo no editor. O widget
// posiciona a si mesmo (classe .dash-element, absoluto) dentro deste wrapper.
function Gt3PreviewElement({
  element,
  selected,
  handleSize,
  onSelect,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onResizePointerDown
}: {
  element: DashboardElement
  selected: boolean
  handleSize: number
  onSelect(): void
  onPointerDown(event: PointerEvent<HTMLElement>): void
  onPointerMove(event: PointerEvent<HTMLElement>): void
  onPointerUp(event: PointerEvent<HTMLElement>): void
  onPointerCancel(event: PointerEvent<HTMLElement>): void
  onResizePointerDown(event: PointerEvent<HTMLElement>, handle: ResizeHandle): void
}): ReactElement {
  const norm: DashboardElement = { ...element, x: 0, y: 0 }
  return (
    <div
      onClick={onSelect}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      style={{
        position: 'absolute',
        left: element.x,
        top: element.y,
        width: element.w,
        height: element.h,
        cursor: 'move',
        boxSizing: 'border-box',
        borderRadius: element.style.radius ?? 8,
        outline: selected ? `2px dashed ${ACCENT}` : undefined,
        outlineOffset: 2,
        touchAction: 'none'
      }}
    >
      {renderGt3Widget({ element: norm, snapshot: PREVIEW_SNAPSHOT })}
      {selected && (
        <ResizeHandles
          size={handleSize}
          onPointerDown={onResizePointerDown}
        />
      )}
    </div>
  )
}

function PreviewElement({
  element,
  selected,
  handleSize,
  onSelect,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onResizePointerDown,
  simulate
}: {
  element: DashboardElement
  selected: boolean
  handleSize: number
  onSelect(): void
  onPointerDown(event: PointerEvent<HTMLElement>): void
  onPointerMove(event: PointerEvent<HTMLElement>): void
  onPointerUp(event: PointerEvent<HTMLElement>): void
  onPointerCancel(event: PointerEvent<HTMLElement>): void
  onResizePointerDown(event: PointerEvent<HTMLElement>, handle: ResizeHandle): void
  simulate?: boolean
}): ReactElement {
  if (simulate && (GT3_WIDGET_TYPES as readonly string[]).includes(element.type)) {
    return (
      <Gt3PreviewElement
        element={element}
        selected={selected}
        handleSize={handleSize}
        onSelect={onSelect}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onResizePointerDown={onResizePointerDown}
      />
    )
  }
  const baseStyle: CSSProperties = {
    position: 'absolute',
    left: element.x,
    top: element.y,
    width: element.w,
    height: element.h,
    background: element.style.background ?? 'transparent',
    border: selected
      ? `2px dashed ${ACCENT}`
      : element.style.borderWidth
        ? `${element.style.borderWidth}px solid ${element.style.border ?? 'transparent'}`
        : '1px dashed rgba(255,255,255,0.05)',
    borderRadius: element.style.radius ?? 0,
    color: element.style.color ?? TEXT_FG,
    fontFamily: element.style.fontFamily ?? 'Segoe UI, sans-serif',
    fontSize: element.style.fontSize ?? 18,
    fontWeight: element.style.fontWeight ?? 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent:
      element.style.align === 'center' ? 'center' : element.style.align === 'right' ? 'flex-end' : 'flex-start',
    padding: element.style.padding ?? 0,
    cursor: 'move',
    overflow: selected ? 'visible' : 'hidden',
    boxSizing: 'border-box',
    touchAction: 'none'
  }

  let content: ReactElement | string | null = null
  if (element.type === 'text') {
    content = element.binding ? `[${element.binding}]` : element.style.text ?? ''
  } else if (element.type === 'shiftlights') {
    const segments = Math.max(1, element.style.segments ?? 12)
    content = (
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${segments}, 1fr)`, gap: 4, width: '100%', height: '100%', padding: 4 }}>
        {Array.from({ length: segments }, (_, i) => (
          <div key={i} style={{ background: i < segments * 0.4 ? element.style.fillColor : '#1a1a1a', borderRadius: 'var(--radius-sm)' }} />
        ))}
      </div>
    )
  } else if (element.type === 'bar') {
    content = (
      <div style={{ width: '100%', height: '100%', borderRadius: element.style.radius ?? 0, overflow: 'hidden' }}>
        <div style={{ width: '50%', height: '100%', background: element.style.fillColor ?? ACCENT }} />
      </div>
    )
  } else if (element.type === 'barv') {
    content = (
      <div style={{ width: '100%', height: '100%', position: 'relative', borderRadius: element.style.radius ?? 0, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '50%', background: element.style.fillColor ?? ACCENT }} />
      </div>
    )
  } else if (element.type === 'dualbar') {
    const c1 = element.style.fillColor ?? '#2dd96a'
    const c2 = element.style.secondaryColor ?? '#ff5468'
    content = (
      <div style={{ display: 'flex', gap: 4, width: '100%', height: '100%', padding: 2 }}>
        {[c1, c2].map((c, i) => (
          <div key={i} style={{ flex: 1, background: 'rgba(255,255,255,0.06)', position: 'relative', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: i === 0 ? '70%' : '30%', background: c }} />
          </div>
        ))}
      </div>
    )
  } else if (element.type === 'deltabar') {
    content = (
      <div style={{ width: '100%', height: '100%', position: 'relative', borderRadius: element.style.radius ?? 0, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 2, background: 'rgba(255,255,255,0.3)', transform: 'translateX(-1px)' }} />
        <div style={{ position: 'absolute', left: '30%', width: '20%', top: '15%', bottom: '15%', background: element.style.fillColor ?? '#2dd96a', borderRadius: 'var(--radius-sm)' }} />
      </div>
    )
  } else if (element.type === 'image') {
    content = element.style.src ? (
      <img
        src={element.style.src}
        alt={element.name ?? 'image'}
        style={{
          width: '100%',
          height: '100%',
          objectFit: element.style.fit === 'cover' ? 'cover' : element.style.fit === 'fill' ? 'fill' : element.style.fit === 'none' ? 'none' : 'contain',
          borderRadius: 'inherit',
          opacity: element.style.opacity ?? 1,
          filter: composeImageFilter(element.style) || undefined
        }}
        draggable={false}
      />
    ) : (
      <div style={{ color: TEXT_DIM, fontSize: 12 }}>[image: sem src]</div>
    )
  } else if (element.type === 'flag') {
    content = (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: element.style.fillColor ?? 'rgba(255,255,255,0.06)', color: element.style.color ?? '#0a0c10', fontWeight: 900, borderRadius: 'inherit' }}>
        {element.style.text ?? (element.style.flagKey?.toUpperCase() ?? 'FLAG')}
      </div>
    )
  } else if (element.type === 'trace') {
    content = (
      <svg width="100%" height="100%" viewBox="0 0 100 40" preserveAspectRatio="none">
        <path d="M0,28 L10,22 L20,30 L30,18 L40,12 L50,20 L60,8 L70,16 L80,6 L90,14 L100,10" fill="none" stroke={element.style.fillColor ?? ACCENT} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      </svg>
    )
  } else if (element.type === 'table' || element.type === 'standings') {
    const cols = element.style.tableColumns ?? DEFAULT_TABLE_COLS
    content = (
      <div style={{ width: '100%', height: '100%', overflow: 'hidden', padding: 4, fontSize: 11, color: TEXT_DIM }}>
        <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 2 }}>
          {cols.map((c) => (
            <span key={`h-${c}`} style={{ flex: c === 'name' ? 2 : 1, textTransform: 'uppercase', fontSize: 9 }}>{c}</span>
          ))}
        </div>
        {Array.from({ length: 3 }).map((_, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 6, padding: '2px 0', color: idx === 1 ? ACCENT : TEXT_FG }}>
            {cols.map((c) => (
              <span key={`b-${idx}-${c}`} style={{ flex: c === 'name' ? 2 : 1, fontSize: 10 }}>
                {c === 'pos' ? idx + 1 : c === 'name' ? `Driver ${idx + 1}` : c === 'gap' ? (idx === 1 ? '0.000' : '+0.420') : '—'}
              </span>
            ))}
          </div>
        ))}
      </div>
    )
  } else if (element.type === 'map' || element.type === 'radar' || element.type === 'gauge') {
    content = (
      <div style={{ color: TEXT_DIM, fontSize: 12 }}>[{element.type}]</div>
    )
  } else if ((GT3_WIDGET_TYPES as readonly string[]).includes(element.type)) {
    const label = ELEMENT_TYPES.find((t) => t.value === element.type)?.label ?? element.type
    content = (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', color: ACCENT, fontSize: 12, fontWeight: 700, textAlign: 'center', padding: 4 }}>
        {label}
      </div>
    )
  }

  return (
    <div
      style={baseStyle}
      onClick={onSelect}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {content}
      {selected && (
        <ResizeHandles
          size={handleSize}
          onPointerDown={onResizePointerDown}
        />
      )}
    </div>
  )
}

function ResizeHandles({
  size,
  onPointerDown
}: {
  size: number
  onPointerDown(event: PointerEvent<HTMLElement>, handle: ResizeHandle): void
}): ReactElement {
  return (
    <>
      {RESIZE_HANDLES.map((handle) => (
        <span
          key={handle}
          aria-hidden="true"
          style={resizeHandleStyle(handle, size)}
          onPointerDown={(event) => onPointerDown(event, handle)}
        />
      ))}
    </>
  )
}

interface InspectorProps {
  dashboard: Dashboard
  element: DashboardElement | null
  snapStep: number
  onChange(patch: Partial<DashboardElement>): void
  onChangeGeometry(geo: Partial<Pick<DashboardElement, 'x' | 'y' | 'w' | 'h'>>): void
  onChangeStyle(stylePatch: Partial<DashboardElement['style']>): void
  onDuplicate(): void
  onRemove(): void
  onNudge(dx: number, dy: number): void
  onAlign(axis: 'h' | 'v'): void
  onReorder(direction: 'front' | 'back' | 'forward' | 'backward'): void
}

function ElementInspector({
  dashboard,
  element,
  snapStep,
  onChange,
  onChangeGeometry,
  onChangeStyle,
  onDuplicate,
  onRemove,
  onNudge,
  onAlign,
  onReorder
}: InspectorProps): ReactElement {
  const groups = useMemo(() => groupBindings(), [])
  if (!element) {
    return <div style={{ color: TEXT_DIM }}>Selecione um elemento no preview.</div>
  }

  const nudgeStep = snapStep > 1 ? snapStep : 1
  const bigStep = Math.max(nudgeStep * 4, 16)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={fieldLabel()}>Name</label>
        <input type="text" value={element.name ?? ''} onChange={(e) => onChange({ name: e.target.value })} style={input()} />
      </div>
      <div>
        <label style={fieldLabel()}>Tipo</label>
        <div style={{ color: TEXT_FG, fontSize: 13 }}>{ELEMENT_TYPES.find((t) => t.value === element.type)?.label}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <NumberField label="X" value={element.x} onChange={(v) => onChangeGeometry({ x: v })} max={dashboard.width} />
        <NumberField label="Y" value={element.y} onChange={(v) => onChangeGeometry({ y: v })} max={dashboard.height} />
        <NumberField label="Width" value={element.w} onChange={(v) => onChangeGeometry({ w: v })} max={dashboard.width} />
        <NumberField label="Height" value={element.h} onChange={(v) => onChangeGeometry({ h: v })} max={dashboard.height} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={fieldLabel()}>Mover (passo {nudgeStep}px · shift = {bigStep}px)</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
          <button style={btn()} title={`← ${nudgeStep}px`} onClick={() => onNudge(-nudgeStep, 0)}>←</button>
          <button style={btn()} title={`↑ ${nudgeStep}px`} onClick={() => onNudge(0, -nudgeStep)}>↑</button>
          <button style={btn()} title={`↓ ${nudgeStep}px`} onClick={() => onNudge(0, nudgeStep)}>↓</button>
          <button style={btn()} title={`→ ${nudgeStep}px`} onClick={() => onNudge(nudgeStep, 0)}>→</button>
          <button style={btn()} title={`← ${bigStep}px`} onClick={() => onNudge(-bigStep, 0)}>« {bigStep}</button>
          <button style={btn()} title={`↑ ${bigStep}px`} onClick={() => onNudge(0, -bigStep)}>↟ {bigStep}</button>
          <button style={btn()} title={`↓ ${bigStep}px`} onClick={() => onNudge(0, bigStep)}>↡ {bigStep}</button>
          <button style={btn()} title={`→ ${bigStep}px`} onClick={() => onNudge(bigStep, 0)}>» {bigStep}</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <button style={btn()} title="Centralizar horizontalmente no canvas" onClick={() => onAlign('h')}>Centrar X</button>
          <button style={btn()} title="Centralizar verticalmente no canvas" onClick={() => onAlign('v')}>Centrar Y</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={fieldLabel()}>Ordem de empilhamento (Z)</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
          <button style={btn()} title="Para tras (1 level)" onClick={() => onReorder('backward')}>↓ tras</button>
          <button style={btn()} title="Para front (1 level)" onClick={() => onReorder('forward')}>↑ front</button>
          <button style={btn()} title="Para o fundo" onClick={() => onReorder('back')}>⤓ fundo</button>
          <button style={btn()} title="Para o topo" onClick={() => onReorder('front')}>⤒ topo</button>
        </div>
      </div>

      <div>
        <label style={fieldLabel()}>Binding</label>
        <select value={element.binding ?? ''} onChange={(e) => onChange({ binding: e.target.value || undefined })} style={input()}>
          <option value="">(sem binding — usa texto literal)</option>
          {Object.entries(groups).map(([groupName, items]) => (
            <optgroup key={groupName} label={groupName}>
              {items.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {element.type === 'text' && (
        <>
          <div>
            <label style={fieldLabel()}>Texto (sem binding)</label>
            <input
              type="text"
              value={element.style.text ?? ''}
              onChange={(e) => onChangeStyle({ text: e.target.value })}
              style={input()}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div style={{ gridColumn: 'span 2' }}>
              <FontFamilyField label="Font (familia)" value={String(element.style.fontFamily ?? '')} onChange={(v) => onChangeStyle({ fontFamily: v || undefined })} />
            </div>
            <NumberField label="Font (px)" value={Number(element.style.fontSize ?? 18)} onChange={(v) => onChangeStyle({ fontSize: v })} min={8} max={400} />
            <div>
              <label style={fieldLabel()}>Peso</label>
              <select
                value={String(element.style.fontWeight ?? 700)}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  onChangeStyle({ fontWeight: Number.isFinite(n) ? n : e.target.value })
                }}
                style={input()}
              >
                {[300, 400, 500, 600, 700, 800, 900].map((w) => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={fieldLabel()}>Alinhamento</label>
              <select value={element.style.align ?? 'left'} onChange={(e) => onChangeStyle({ align: e.target.value as 'left' | 'center' | 'right' })} style={input()}>
                <option value="left">Esquerda</option>
                <option value="center">Centro</option>
                <option value="right">Direita</option>
              </select>
            </div>
            <ColorField label="Text color" value={element.style.color ?? TEXT_FG} onChange={(v) => onChangeStyle({ color: v })} />
            <div>
              <label style={fieldLabel()}>Prefixo</label>
              <input type="text" value={element.style.prefix ?? ''} onChange={(e) => onChangeStyle({ prefix: e.target.value })} style={input()} />
            </div>
            <div>
              <label style={fieldLabel()}>Sufixo</label>
              <input type="text" value={element.style.suffix ?? ''} onChange={(e) => onChangeStyle({ suffix: e.target.value })} style={input()} />
            </div>
            <NumberField label="Casas decimais" value={element.style.decimals ?? 0} onChange={(v) => onChangeStyle({ decimals: Math.max(0, Math.min(4, Math.round(v))) })} min={0} max={4} />
            <NumberField label="Spacing (px)" value={Number(element.style.slots?.value?.letterSpacing ?? 0)} onChange={(v) => onChangeStyle({ slots: applySlotField(element.style, 'value', 'letterSpacing', Number.isFinite(v) && v !== 0 ? v : undefined) })} min={-5} max={30} step={0.5} />
            <SelectField label="Transformar" value={String(element.style.slots?.value?.textTransform ?? 'none')} options={TRANSFORM_OPTIONS} onChange={(v) => onChangeStyle({ slots: applySlotField(element.style, 'value', 'textTransform', v === 'none' ? undefined : v) })} />
            <ToggleField label="Sombra/glow" value={Boolean(element.style.slots?.value?.shadow)} onChange={(on) => onChangeStyle({ slots: applySlotField(element.style, 'value', 'shadow', on ? '0 2px 6px rgba(0,0,0,0.65)' : undefined) })} />
          </div>
        </>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <ColorField label="Fundo" value={element.style.background ?? 'transparent'} onChange={(v) => onChangeStyle({ background: v })} />
        <ColorField label="Borda" value={element.style.border ?? 'transparent'} onChange={(v) => onChangeStyle({ border: v })} />
        <NumberField label="Borda (px)" value={element.style.borderWidth ?? 0} onChange={(v) => onChangeStyle({ borderWidth: Math.max(0, Math.round(v)) })} min={0} max={20} />
        <NumberField label="Radius (px)" value={element.style.radius ?? 0} onChange={(v) => onChangeStyle({ radius: Math.max(0, Math.round(v)) })} min={0} max={80} />
      </div>

      {(element.type === 'bar' ||
        element.type === 'gauge' ||
        element.type === 'shiftlights' ||
        element.type === 'barv' ||
        element.type === 'dualbar' ||
        element.type === 'deltabar' ||
        element.type === 'trace') && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <ColorField label="Preenchimento" value={element.style.fillColor ?? ACCENT} onChange={(v) => onChangeStyle({ fillColor: v })} />
          <ColorField label="Aviso" value={element.style.warnColor ?? '#ffb84d'} onChange={(v) => onChangeStyle({ warnColor: v })} />
          <ColorField label="Perigo" value={element.style.dangerColor ?? '#ff5468'} onChange={(v) => onChangeStyle({ dangerColor: v })} />
          {(element.type === 'bar' ||
            element.type === 'barv' ||
            element.type === 'gauge' ||
            element.type === 'shiftlights') && (
            <>
              <NumberField label="Aviso a partir de (0–1)" value={element.style.warnAt ?? 0.7} onChange={(v) => onChangeStyle({ warnAt: Math.max(0, Math.min(1, v)) })} min={0} max={1} step={0.05} />
              <NumberField label="Perigo a partir de (0–1)" value={element.style.dangerAt ?? 0.9} onChange={(v) => onChangeStyle({ dangerAt: Math.max(0, Math.min(1, v)) })} min={0} max={1} step={0.05} />
            </>
          )}
          {element.type === 'shiftlights' && (
            <NumberField label="Segmentos" value={element.style.segments ?? 12} onChange={(v) => onChangeStyle({ segments: Math.max(4, Math.min(24, Math.round(v))) })} min={4} max={24} />
          )}
          {element.type === 'barv' && (
            <div>
              <label style={fieldLabel()}>Direction</label>
              <select
                value={element.style.reverse ? 'down' : 'up'}
                onChange={(e) => onChangeStyle({ reverse: e.target.value === 'down' })}
                style={input()}
              >
                <option value="up">Baixo → cima</option>
                <option value="down">Cima → baixo</option>
              </select>
            </div>
          )}
          {element.type === 'dualbar' && (
            <>
              <div>
                <label style={fieldLabel()}>Binding secondary</label>
                <select
                  value={element.style.secondaryBinding ?? 'brake'}
                  onChange={(e) => onChangeStyle({ secondaryBinding: e.target.value || undefined })}
                  style={input()}
                >
                  <option value="">(no)</option>
                  {Object.entries(groups).map(([groupName, items]) => (
                    <optgroup key={groupName} label={groupName}>
                      {items.map((b) => (
                        <option key={b.key} value={b.key}>{b.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <ColorField label="Cor secondary" value={element.style.secondaryColor ?? '#ff5468'} onChange={(v) => onChangeStyle({ secondaryColor: v })} />
            </>
          )}
          {element.type === 'deltabar' && (
            <NumberField label="Range ±s" value={element.style.deltaRangeSec ?? 1} onChange={(v) => onChangeStyle({ deltaRangeSec: Math.max(0.05, v) })} min={0.05} max={10} step={0.05} />
          )}
          {element.type === 'trace' && (
            <>
              <NumberField label="Amostras" value={element.style.traceLength ?? 120} onChange={(v) => onChangeStyle({ traceLength: Math.max(8, Math.min(2048, Math.round(v))) })} min={8} max={2048} step={1} />
              <NumberField label="Espessura" value={element.style.traceWidth ?? 1.6} onChange={(v) => onChangeStyle({ traceWidth: Math.max(0.5, Math.min(8, v)) })} min={0.5} max={8} step={0.1} />
              <div>
                <label style={fieldLabel()}>Binding secondary</label>
                <select
                  value={element.style.secondaryBinding ?? ''}
                  onChange={(e) => onChangeStyle({ secondaryBinding: e.target.value || undefined })}
                  style={input()}
                >
                  <option value="">(no)</option>
                  {Object.entries(groups).map(([groupName, items]) => (
                    <optgroup key={groupName} label={groupName}>
                      {items.map((b) => (
                        <option key={b.key} value={b.key}>{b.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <ColorField label="Cor series 2" value={element.style.traceColor2 ?? '#ff5468'} onChange={(v) => onChangeStyle({ traceColor2: v })} />
            </>
          )}
        </div>
      )}

      {element.type === 'image' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
          <div>
            <label style={fieldLabel()}>Arquivo de imagem</label>
            <label style={{ ...btn('primary'), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              Escolher imagem…
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return
                  void fileToDataUrl(file)
                    .then((url) => onChangeStyle({ src: url }))
                    .catch(() => undefined)
                }}
              />
            </label>
            <p style={{ margin: '4px 0 0', color: TEXT_DIM, fontSize: 11 }}>Imagens grandes ({'>'}3MB) sao reduzidas automaticamente.</p>
          </div>
          <div>
            <label style={fieldLabel()}>URL ou data: URL</label>
            <input
              type="text"
              value={element.style.src ?? ''}
              onChange={(e) => onChangeStyle({ src: e.target.value })}
              placeholder="data:image/png;base64,…  ou  file:///…"
              style={input()}
            />
          </div>
          {element.style.src && (
            <button style={btn('danger')} onClick={() => onChangeStyle({ src: undefined })}>Remove imagem</button>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={fieldLabel()}>Ajuste</label>
              <select
                value={element.style.fit ?? 'contain'}
                onChange={(e) => onChangeStyle({ fit: e.target.value as 'contain' | 'cover' | 'fill' | 'none' })}
                style={input()}
              >
                <option value="contain">contain</option>
                <option value="cover">cover</option>
                <option value="fill">fill</option>
                <option value="none">none</option>
              </select>
            </div>
            <NumberField label="Opacidade" value={element.style.opacity ?? 1} onChange={(v) => onChangeStyle({ opacity: Math.max(0, Math.min(1, v)) })} min={0} max={1} step={0.05} />
          </div>
          <div>
            <label style={fieldLabel()}>Ordem (z)</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
              <button style={btn()} title="Para tras" onClick={() => onReorder('backward')}>↓ tras</button>
              <button style={btn()} title="Para front" onClick={() => onReorder('forward')}>↑ front</button>
              <button style={btn()} title="Para o fundo" onClick={() => onReorder('back')}>⤓ fundo</button>
              <button style={btn()} title="Para o topo" onClick={() => onReorder('front')}>⤒ topo</button>
            </div>
          </div>
          <div>
            <label style={fieldLabel()}>Filtros — predefinicoes</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {IMAGE_FILTER_PRESETS.map((p) => (
                <button key={p.id} style={btn()} onClick={() => onChangeStyle(p.patch)}>{p.label}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <SliderField label="Preto&branco" value={element.style.filterGrayscale ?? 0} onChange={(v) => onChangeStyle({ filterGrayscale: v || undefined })} min={0} max={1} step={0.05} />
            <SliderField label="Vermelho" value={element.style.redTint ?? 0} onChange={(v) => onChangeStyle({ redTint: v || undefined })} min={0} max={1} step={0.05} />
            <SliderField label="Sepia" value={element.style.filterSepia ?? 0} onChange={(v) => onChangeStyle({ filterSepia: v || undefined })} min={0} max={1} step={0.05} />
            <SliderField label="Inverter" value={element.style.invert ?? 0} onChange={(v) => onChangeStyle({ invert: v || undefined })} min={0} max={1} step={0.05} />
            <SliderField label="Brilho" value={element.style.brightness ?? 1} onChange={(v) => onChangeStyle({ brightness: v === 1 ? undefined : v })} min={0} max={2} step={0.05} />
            <SliderField label="Contraste" value={element.style.contrast ?? 1} onChange={(v) => onChangeStyle({ contrast: v === 1 ? undefined : v })} min={0} max={2} step={0.05} />
            <SliderField label="Saturation" value={element.style.saturate ?? 1} onChange={(v) => onChangeStyle({ saturate: v === 1 ? undefined : v })} min={0} max={3} step={0.05} />
            <SliderField label="Matiz (°)" value={element.style.hueRotate ?? 0} onChange={(v) => onChangeStyle({ hueRotate: v || undefined })} min={-180} max={180} step={1} />
            <SliderField label="Desfoque (px)" value={element.style.blur ?? 0} onChange={(v) => onChangeStyle({ blur: v || undefined })} min={0} max={10} step={0.5} />
          </div>
        </div>
      )}

      {element.type === 'flag' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <label style={fieldLabel()}>Flag observada</label>
            <select
              value={element.style.flagKey ?? ''}
              onChange={(e) => onChangeStyle({ flagKey: e.target.value || undefined })}
              style={input()}
            >
              <option value="">(qualquer active)</option>
              <option value="green">green</option>
              <option value="yellow">yellow</option>
              <option value="blue">blue</option>
              <option value="white">white</option>
              <option value="checkered">checkered</option>
              <option value="red">red</option>
              <option value="black">black</option>
              <option value="meatball">meatball (black+orange)</option>
              <option value="greenWhiteCheckered">greenWhiteCheckered</option>
            </select>
          </div>
          <div>
            <label style={fieldLabel()}>Texto (override)</label>
            <input
              type="text"
              value={element.style.text ?? ''}
              onChange={(e) => onChangeStyle({ text: e.target.value })}
              placeholder="(usa label automatic)"
              style={input()}
            />
          </div>
        </div>
      )}

      {(element.type === 'table' || element.type === 'standings') && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={fieldLabel()}>Columns (comma)</label>
            <input
              type="text"
              value={(element.style.tableColumns ?? DEFAULT_TABLE_COLS).join(',')}
              onChange={(e) =>
                onChangeStyle({
                  tableColumns: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)
                })
              }
              placeholder="pos,number,name,gap,class"
              style={input()}
            />
            <p style={{ margin: '4px 0 0', color: TEXT_DIM, fontSize: 11 }}>
              Available: pos, classPos, number, name, gap, class, license, iRating, laps
            </p>
          </div>
          <NumberField label="Rows max." value={element.style.tableMaxRows ?? 8} onChange={(v) => onChangeStyle({ tableMaxRows: Math.max(1, Math.min(64, Math.round(v))) })} min={1} max={64} />
          <NumberField label="Tamanho fonte" value={Number(element.style.fontSize ?? 14)} onChange={(v) => onChangeStyle({ fontSize: Math.max(8, Math.min(64, v)) })} min={8} max={64} />
          <div>
            <label style={fieldLabel()}>Mostrar header</label>
            <select
              value={element.style.showHeader === false ? 'no' : 'yes'}
              onChange={(e) => onChangeStyle({ showHeader: e.target.value === 'yes' })}
              style={input()}
            >
              <option value="yes">Sim</option>
              <option value="no">Nao</option>
            </select>
          </div>
          <div>
            <label style={fieldLabel()}>Destacar jogador</label>
            <select
              value={element.style.highlightPlayer === false ? 'no' : 'yes'}
              onChange={(e) => onChangeStyle({ highlightPlayer: e.target.value === 'yes' })}
              style={input()}
            >
              <option value="yes">Sim</option>
              <option value="no">Nao</option>
            </select>
          </div>
        </div>
      )}

      {(GT3_WIDGET_TYPES as readonly string[]).includes(element.type) && (
        <Gt3Config element={element} onChangeStyle={onChangeStyle} groups={groups} />
      )}

      {(WIDGET_SLOTS[element.type]?.length ?? 0) > 0 && (
        <SlotStyleEditor element={element} slots={WIDGET_SLOTS[element.type]} onChangeStyle={onChangeStyle} />
      )}

      <InstrumentConfig element={element} onChangeStyle={onChangeStyle} />

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button style={btn()} onClick={onDuplicate}>Duplicar</button>
        <button style={btn('danger')} onClick={onRemove}>Remove</button>
      </div>
    </div>
  )
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step
}: {
  label: string
  value: number
  onChange(v: number): void
  min?: number
  max?: number
  step?: number
}): ReactElement {
  return (
    <div>
      <label style={fieldLabel()}>{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))}
        style={input()}
      />
    </div>
  )
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }): ReactElement {
  return (
    <div>
      <label style={fieldLabel()}>{label}</label>
      <div style={{ display: 'flex', gap: 4 }}>
        <input type="color" value={hexFromCss(value)} onChange={(e) => onChange(e.target.value)} style={{ width: 36, height: 32, padding: 0, border: 'none', background: 'transparent' }} />
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} style={input({ flex: 1 })} />
      </div>
    </div>
  )
}

// ─── Controles reutilizaveis do inspetor GT3 ──────────────────────────────────
function SectionLabel({ children }: { children: ReactNode }): ReactElement {
  return (
    <div style={{ gridColumn: 'span 2', color: ACCENT, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, margin: '8px 0 -2px' }}>
      {children}
    </div>
  )
}

function ToggleField({ label, value, onChange }: { label: string; value: boolean; onChange(v: boolean): void }): ReactElement {
  return (
    <div>
      <label style={fieldLabel()}>{label}</label>
      <select value={value ? 'yes' : 'no'} onChange={(e) => onChange(e.target.value === 'yes')} style={input()}>
        <option value="yes">Sim</option>
        <option value="no">Nao</option>
      </select>
    </div>
  )
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange(v: string): void }): ReactElement {
  return (
    <div>
      <label style={fieldLabel()}>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={input()}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

function SliderField({ label, value, onChange, min, max, step }: { label: string; value: number; onChange(v: number): void; min: number; max: number; step?: number }): ReactElement {
  return (
    <div>
      <label style={fieldLabel()}>{label} <span style={{ color: TEXT_DIM, fontWeight: 400 }}>{Number.isInteger(value) ? value : value.toFixed(2)}</span></label>
      <input type="range" min={min} max={max} step={step ?? 0.01} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: '100%' }} />
    </div>
  )
}

function FontFamilyField({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }): ReactElement {
  const known = DASHBOARD_FONT_OPTIONS.some((o) => o.value === value)
  const options = known || value === '' ? DASHBOARD_FONT_OPTIONS : [...DASHBOARD_FONT_OPTIONS, { value, label: `Personalizada` }]
  return <SelectField label={label} value={value} options={options} onChange={onChange} />
}

// `applySlotField` (escrita do slot, simetrica a `resolveSlotStyle`) vive em
// shared/dashboards.ts para ser reusada pelo renderer/testes.

const WEIGHT_OPTIONS = [
  { value: '', label: '(auto)' },
  ...[300, 400, 500, 600, 700, 800, 900].map((w) => ({ value: String(w), label: String(w) }))
]

const ALIGN_OPTIONS = [
  { value: '', label: '(auto)' },
  { value: 'left', label: 'Esquerda' },
  { value: 'center', label: 'Centro' },
  { value: 'right', label: 'Direita' }
]

const TRANSFORM_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'uppercase', label: 'UPPERCASE' },
  { value: 'lowercase', label: 'lowercase' },
  { value: 'capitalize', label: 'Capitalizar' }
]

// Editor de estilo por slot de texto (granular). Mostra um seletor de slot e, para
// o slot ativo, os controles de fonte/cor/peso/alinhamento/espacamento/transform/
// sombra. Cada campo grava em style.slots[slot].
function SlotStyleEditor({ element, slots, onChangeStyle }: {
  element: DashboardElement
  slots: WidgetSlotDef[]
  onChangeStyle(stylePatch: Partial<DashboardElement['style']>): void
}): ReactElement {
  const [active, setActive] = useState<string>(slots[0]?.slot ?? 'value')
  const slot = slots.some((sd) => sd.slot === active) ? active : (slots[0]?.slot ?? 'value')
  const cur: Partial<TextSlotStyle> = element.style.slots?.[slot] ?? {}
  const set = (field: keyof TextSlotStyle, value: unknown): void =>
    onChangeStyle({ slots: applySlotField(element.style, slot, field, value) })
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      <SectionLabel>Style por texto (granular)</SectionLabel>
      <div style={{ gridColumn: 'span 2', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {slots.map((sd) => {
          const touched = Boolean(element.style.slots?.[sd.slot] && Object.keys(element.style.slots[sd.slot]).length > 0)
          return (
            <button
              key={sd.slot}
              style={btn(sd.slot === slot ? 'primary' : 'default')}
              title={touched ? 'Custom' : 'Default'}
              onClick={() => setActive(sd.slot)}
            >
              {sd.label}{touched ? ' •' : ''}
            </button>
          )
        })}
      </div>
      <FontFamilyField label="Font" value={String(cur.fontFamily ?? '')} onChange={(v) => set('fontFamily', v || undefined)} />
      <NumberField label="Tamanho (0=auto)" value={Number(cur.fontSize ?? 0)} onChange={(v) => set('fontSize', v > 0 ? Math.round(v) : undefined)} min={0} max={400} />
      <ColorField label="Cor" value={String(cur.fontColor ?? '')} onChange={(v) => set('fontColor', v || undefined)} />
      <SelectField label="Peso" value={String(cur.fontWeight ?? '')} options={WEIGHT_OPTIONS} onChange={(v) => set('fontWeight', v ? Number(v) : undefined)} />
      <SelectField label="Alinhamento" value={String(cur.align ?? '')} options={ALIGN_OPTIONS} onChange={(v) => set('align', v || undefined)} />
      <NumberField label="Spacing (px)" value={Number(cur.letterSpacing ?? 0)} onChange={(v) => set('letterSpacing', Number.isFinite(v) && v !== 0 ? v : undefined)} min={-5} max={30} step={0.5} />
      <SelectField label="Transformar" value={String(cur.textTransform ?? 'none')} options={TRANSFORM_OPTIONS} onChange={(v) => set('textTransform', v === 'none' ? undefined : v)} />
      <ToggleField label="Sombra/glow" value={Boolean(cur.shadow)} onChange={(on) => set('shadow', on ? '0 2px 6px rgba(0,0,0,0.65)' : undefined)} />
      {cur.shadow !== undefined && (
        <div style={{ gridColumn: 'span 2' }}>
          <label style={fieldLabel()}>Sombra (CSS text-shadow)</label>
          <input type="text" value={cur.shadow} onChange={(e) => set('shadow', e.target.value || undefined)} placeholder="0 0 8px #00BFFF" style={input()} />
        </div>
      )}
    </div>
  )
}

const INSTRUMENT_TEMPLATE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '(padrao — sem instrumento)' },
  { value: 'revled', label: 'Rev LEDs' },
  { value: 'dial', label: 'Mostrador analog (dial)' },
  { value: 'segment', label: 'Display de segmentos' },
  { value: 'tile', label: 'Tile de data' },
  { value: 'telltale', label: 'Telltale (alerta)' },
  { value: 'alarm', label: 'Faixa de alarme' },
  { value: 'bezelring', label: 'Anel com moldura' }
]

const INSTRUMENT_BEZEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '(padrao)' },
  { value: 'none', label: 'No' },
  { value: 'thin', label: 'Fina' },
  { value: 'chrome', label: 'Cromada' },
  { value: 'double', label: 'Dupla' }
]

const INSTRUMENT_MATERIAL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '(padrao)' },
  { value: 'matte', label: 'Fosco (matte)' },
  { value: 'carbon', label: 'Fibra de carbono' },
  { value: 'brushed', label: 'Metal escovado' }
]

const INSTRUMENT_LED_SHAPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'led', label: 'LED (redondo)' },
  { value: 'bar', label: 'Barra' },
  { value: 'trapezoid', label: 'Trapezio' }
]

const INSTRUMENT_SEGMENT_MODE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '7', label: '7 segmentos' },
  { value: '14', label: '14 segmentos' }
]

// ── Skin (v2.39 two-skin system) picker options ──────────────────────────────
const SKIN_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Default (GT3)' },
  { value: 'gt3', label: 'GT3 — display real' },
  { value: 'hud', label: 'HUD moderno' }
]
const BRAND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Generic' },
  { value: 'stuttgart', label: 'Stuttgart' },
  { value: 'bavaria', label: 'Bavaria' },
  { value: 'maranello', label: 'Maranello' }
]

// ── "Instrumento / Fidelidade" collapsible ────────────────────────────────────
// Surfaces the ADDITIVE `style.instrument.*` fidelity knobs plus the v2.39 skin
// selector (previously data-only and unreachable from the UI). Choosing a template
// opts ANY widget into the high-fidelity SVG instrument look; clearing it reverts
// to the flat renderer. All writes go through the pure `applyInstrument*` helpers.
function InstrumentConfig({
  element,
  onChangeStyle
}: {
  element: DashboardElement
  onChangeStyle(stylePatch: Partial<DashboardElement['style']>): void
}): ReactElement {
  const inst = element.style.instrument ?? {}
  const template = inst.template
  const [open, setOpen] = useState<boolean>(() => Boolean(inst.template))

  const setTop = (field: keyof InstrumentStyleSpec, value: unknown): void =>
    onChangeStyle({ instrument: applyInstrumentPatch(element.style, { [field]: value } as Partial<InstrumentStyleSpec>) })
  const setPart = (part: string, field: string, value: unknown): void =>
    onChangeStyle({ instrument: applyInstrumentPart(element.style, part, field, value) })

  const led = inst.parts?.led ?? {}
  const dial = inst.parts?.dial ?? {}
  const needle = inst.parts?.needle ?? {}
  const segment = inst.parts?.segment ?? {}
  const tile = inst.parts?.tile ?? {}

  return (
    <div style={{ border: `1px solid ${PANEL_BORDER}`, borderRadius: 'var(--radius-sm)', padding: 10 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ ...btn(), width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        title="Active os primitivos de instrumento de alta fidelidade (SVG)"
      >
        <span style={{ fontWeight: 800, letterSpacing: 0.5 }}>Instrumento / Fidelidade{template ? ` · ${template}` : ''}</span>
        <span aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
          <SelectField
            label="Skin"
            value={String(element.style.skin ?? '')}
            options={SKIN_OPTIONS}
            onChange={(v) => onChangeStyle({ skin: v ? (v as 'gt3' | 'hud') : undefined })}
          />
          <SelectField
            label="Marca"
            value={String(element.style.brandStyle ?? '')}
            options={BRAND_OPTIONS}
            onChange={(v) => onChangeStyle({ brandStyle: v ? (v as 'generic' | 'stuttgart' | 'bavaria' | 'maranello') : undefined })}
          />
          <div style={{ gridColumn: 'span 2' }}>
            <SelectField
              label="Template do instrumento"
              value={String(template ?? '')}
              options={INSTRUMENT_TEMPLATE_OPTIONS}
              onChange={(v) => setTop('template', v ? (v as InstrumentTemplate) : undefined)}
            />
          </div>

          <SelectField label="Moldura (bezel)" value={String(inst.bezel ?? '')} options={INSTRUMENT_BEZEL_OPTIONS} onChange={(v) => setTop('bezel', v ? (v as InstrumentBezelKind) : undefined)} />
          <SelectField label="Material" value={String(inst.material ?? '')} options={INSTRUMENT_MATERIAL_OPTIONS} onChange={(v) => setTop('material', v ? (v as InstrumentMaterialKind) : undefined)} />
          <ToggleField label="Glow" value={Boolean(inst.glow)} onChange={(on) => setTop('glow', on ? true : undefined)} />

          {(template === 'revled' || template === 'alarm') && (
            <>
              <SectionLabel>LEDs</SectionLabel>
              <NumberField label="Segmentos" value={Number(led.segments ?? 15)} onChange={(v) => setPart('led', 'segments', v > 0 ? Math.round(v) : undefined)} min={1} max={40} />
              <SelectField label="Format" value={String(led.shape ?? 'led')} options={INSTRUMENT_LED_SHAPE_OPTIONS} onChange={(v) => setPart('led', 'shape', v === 'led' ? undefined : v)} />
              <SliderField label="Bloom" value={Number(led.bloom ?? 0)} onChange={(v) => setPart('led', 'bloom', v > 0 ? v : undefined)} min={0} max={2} step={0.05} />
              <SliderField label="Aviso a partir de" value={Number(led.warnAt ?? 0)} onChange={(v) => setPart('led', 'warnAt', v > 0 ? v : undefined)} min={0} max={1} step={0.01} />
              <SliderField label="Perigo a partir de" value={Number(led.dangerAt ?? 0)} onChange={(v) => setPart('led', 'dangerAt', v > 0 ? v : undefined)} min={0} max={1} step={0.01} />
            </>
          )}

          {(template === 'dial' || template === 'bezelring') && (
            <>
              <SectionLabel>Mostrador (dial)</SectionLabel>
              <NumberField label="Marcas maiores" value={Number(dial.majorTicks ?? 0)} onChange={(v) => setPart('dial', 'majorTicks', v > 0 ? Math.round(v) : undefined)} min={0} max={24} />
              <NumberField label="Menores por maior" value={Number(dial.minorPerMajor ?? 0)} onChange={(v) => setPart('dial', 'minorPerMajor', v > 0 ? Math.round(v) : undefined)} min={0} max={10} />
              <SliderField label="Amortecimento (damp)" value={Number(dial.damp ?? 0)} onChange={(v) => setPart('dial', 'damp', v > 0 ? v : undefined)} min={0} max={1} step={0.01} />
              <SectionLabel>Ponteiro (needle)</SectionLabel>
              <ColorField label="Cor do ponteiro" value={String(needle.color ?? '')} onChange={(v) => setPart('needle', 'color', v || undefined)} />
              <NumberField label="Espessura" value={Number(needle.width ?? 0)} onChange={(v) => setPart('needle', 'width', v > 0 ? v : undefined)} min={0} max={20} step={0.5} />
            </>
          )}

          {template === 'segment' && (
            <>
              <SectionLabel>Segmentos</SectionLabel>
              <SelectField label="Modo" value={String(segment.mode ?? '7')} options={INSTRUMENT_SEGMENT_MODE_OPTIONS} onChange={(v) => setPart('segment', 'mode', v === '7' ? undefined : v)} />
              <NumberField label="Digits" value={Number(segment.digits ?? 0)} onChange={(v) => setPart('segment', 'digits', v > 0 ? Math.round(v) : undefined)} min={0} max={8} />
              <ToggleField label="Digits fantasma" value={Boolean(segment.ghost)} onChange={(on) => setPart('segment', 'ghost', on ? true : undefined)} />
            </>
          )}

          {template === 'tile' && (
            <>
              <SectionLabel>Tile</SectionLabel>
              <ToggleField label="Numeric (tabular)" value={Boolean(tile.numeric)} onChange={(on) => setPart('tile', 'numeric', on ? true : undefined)} />
            </>
          )}

          <p style={{ gridColumn: 'span 2', margin: '2px 0 0', color: TEXT_DIM, fontSize: 11 }}>
            Deixe o template em “(padrao)” para renderizar o widget no estilo plano de sempre.
          </p>
        </div>
      )}
    </div>
  )
}

const IMAGE_FILTER_PRESETS: Array<{ id: string; label: string; patch: Partial<DashboardElement['style']> }> = [
  { id: 'original', label: 'Original', patch: { filterGrayscale: undefined, filterSepia: undefined, redTint: undefined, brightness: undefined, contrast: undefined, saturate: undefined, hueRotate: undefined, invert: undefined, blur: undefined } },
  { id: 'bw', label: 'Preto & Branco', patch: { filterGrayscale: 1, filterSepia: undefined, redTint: undefined, brightness: undefined, contrast: 1.05, saturate: undefined, hueRotate: undefined, invert: undefined } },
  { id: 'red', label: 'Vermelho', patch: { filterGrayscale: 1, filterSepia: undefined, redTint: 1, brightness: 0.95, contrast: 1.1, saturate: undefined, hueRotate: undefined, invert: undefined } },
  { id: 'sepia', label: 'Sepia', patch: { filterGrayscale: undefined, filterSepia: 1, redTint: undefined, brightness: 1.02, contrast: undefined, saturate: undefined, hueRotate: undefined, invert: undefined } }
]

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('falha ao carregar imagem'))
    img.src = src
  })
}

// Le um File como data-URL. Acima de ~3MB, redimensiona via canvas (max. 1600px no
// maior lado) e recodifica em JPEG com qualidade decrescente ate caber no limite.
async function fileToDataUrl(file: File): Promise<string> {
  const LIMIT = 3_000_000
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('falha ao ler arquivo'))
    reader.readAsDataURL(file)
  })
  if (raw.length <= LIMIT) return raw
  try {
    const img = await loadImageEl(raw)
    const maxDim = 1600
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return raw
    ctx.drawImage(img, 0, 0, w, h)
    let quality = 0.9
    let out = canvas.toDataURL('image/jpeg', quality)
    while (out.length > LIMIT && quality > 0.4) {
      quality -= 0.1
      out = canvas.toDataURL('image/jpeg', quality)
    }
    return out
  } catch {
    return raw
  }
}

const CHANNEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'throttle', label: 'Acelerador' },
  { value: 'brake', label: 'Freio' },
  { value: 'clutch', label: 'Embreagem' },
  { value: 'steering', label: 'Steering' }
]

function ChannelsField({ value, onChange }: { value: string[]; onChange(v: string[]): void }): ReactElement {
  const current = value.length > 0 ? value : ['throttle', 'brake']
  function toggle(ch: string): void {
    if (current.includes(ch)) onChange(current.filter((c) => c !== ch))
    else onChange([...current, ch])
  }
  return (
    <div style={{ gridColumn: 'span 2' }}>
      <label style={fieldLabel()}>Canais</label>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {CHANNEL_OPTIONS.map((o) => (
          <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: 5, color: TEXT_DIM, fontSize: 12 }}>
            <input type="checkbox" checked={current.includes(o.value)} onChange={() => toggle(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  )
}

const SETUP_FIELD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'abs', label: 'ABS' },
  { value: 'tc', label: 'TC' },
  { value: 'map', label: 'MAP' },
  { value: 'bb', label: 'BB%' },
  { value: 'limiter', label: 'Limitador' },
  { value: 'inc', label: 'Incidents' }
]

function FieldsToggle({ value, onChange }: { value: string[]; onChange(v: string[]): void }): ReactElement {
  const current = value.length > 0 ? value : ['abs', 'tc', 'map', 'bb', 'limiter', 'inc']
  function toggle(f: string): void {
    if (current.includes(f)) onChange(current.filter((c) => c !== f))
    else onChange([...SETUP_FIELD_OPTIONS.map((o) => o.value).filter((o) => current.includes(o) || o === f)])
  }
  return (
    <div style={{ gridColumn: 'span 2' }}>
      <label style={fieldLabel()}>Campos exibidos</label>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {SETUP_FIELD_OPTIONS.map((o) => (
          <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: 5, color: TEXT_DIM, fontSize: 12 }}>
            <input type="checkbox" checked={current.includes(o.value)} onChange={() => toggle(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  )
}

function BindingSelect({ label, value, groups, onChange, placeholder }: { label: string; value: string; groups: Record<string, typeof DASHBOARD_BINDINGS>; onChange(v: string): void; placeholder?: string }): ReactElement {
  return (
    <div style={{ gridColumn: 'span 2' }}>
      <label style={fieldLabel()}>{label}</label>
      <div style={{ display: 'flex', gap: 4 }}>
        <select value={value && (DASHBOARD_BINDINGS.some((b) => b.key === value)) ? value : ''} onChange={(e) => onChange(e.target.value)} style={input({ flex: 1 })}>
          <option value="">(via var:/expr: abaixo)</option>
          {Object.entries(groups).map(([groupName, items]) => (
            <optgroup key={groupName} label={groupName}>
              {items.map((b) => (
                <option key={b.key} value={b.key}>{b.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? 'var:campo'} style={input({ flex: 1 })} />
      </div>
    </div>
  )
}

// Config agrupada (Data / Visual / Limiares / Comportamento) por widget GT3.
function Gt3Config({
  element,
  onChangeStyle,
  groups
}: {
  element: DashboardElement
  onChangeStyle(stylePatch: Partial<DashboardElement['style']>): void
  groups: Record<string, typeof DASHBOARD_BINDINGS>
}): ReactElement {
  const s = element.style
  const t = element.type
  const grid: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }

  if (t === 'shiftbar') {
    return (
      <div style={grid}>
        <SectionLabel>Visual</SectionLabel>
        <NumberField label="Segmentos" value={s.segments ?? 18} onChange={(v) => onChangeStyle({ segments: Math.max(4, Math.min(30, Math.round(v))) })} min={4} max={30} />
        <SelectField label="Format" value={s.segmentShape ?? 'led'} options={[{ value: 'led', label: 'LED' }, { value: 'bar', label: 'Barra fina' }, { value: 'trapezoid', label: 'Trapezio' }]} onChange={(v) => onChangeStyle({ segmentShape: v as 'led' | 'bar' | 'trapezoid' })} />
        <ToggleField label="Glow (brilho)" value={s.glow !== false} onChange={(v) => onChangeStyle({ glow: v })} />
        <ToggleField label="Override limitador" value={s.pitLimiterOverride !== false} onChange={(v) => onChangeStyle({ pitLimiterOverride: v })} />
        <SectionLabel>Limiares</SectionLabel>
        <NumberField label="Aviso (0–1)" value={s.warnAt ?? 0.75} onChange={(v) => onChangeStyle({ warnAt: Math.max(0, Math.min(1, v)) })} min={0} max={1} step={0.01} />
        <NumberField label="Perigo (0–1)" value={s.dangerAt ?? 0.9} onChange={(v) => onChangeStyle({ dangerAt: Math.max(0, Math.min(1, v)) })} min={0} max={1} step={0.01} />
        <NumberField label="Flash (0–1)" value={s.flashAt ?? 0.97} onChange={(v) => onChangeStyle({ flashAt: Math.max(0, Math.min(1, v)) })} min={0} max={1} step={0.01} />
        <ColorField label="Cor flash" value={s.flashColor ?? '#F6FBFF'} onChange={(v) => onChangeStyle({ flashColor: v })} />
      </div>
    )
  }
  if (t === 'gearcluster') {
    return (
      <div style={grid}>
        <SectionLabel>Data</SectionLabel>
        <SelectField label="Unit veloc." value={s.unit === 'mph' ? 'mph' : 'kmh'} options={[{ value: 'kmh', label: 'km/h' }, { value: 'mph', label: 'mph' }]} onChange={(v) => onChangeStyle({ unit: v === 'mph' ? 'mph' : undefined })} />
        <ToggleField label="Mostrar RPM" value={s.showRpm !== false} onChange={(v) => onChangeStyle({ showRpm: v })} />
        <SectionLabel>Visual</SectionLabel>
        <ColorField label="Accent color" value={s.accentColor ?? 'var(--accent-primary)'} onChange={(v) => onChangeStyle({ accentColor: v })} />
        <NumberField label="Flash (0–1)" value={s.flashAt ?? 0.97} onChange={(v) => onChangeStyle({ flashAt: Math.max(0, Math.min(1, v)) })} min={0} max={1} step={0.01} />
      </div>
    )
  }
  if (t === 'tyregrid') {
    const mode = s.gridMode ?? 'temp'
    return (
      <div style={grid}>
        <SectionLabel>Data</SectionLabel>
        <SelectField label="Modo" value={mode} options={[{ value: 'temp', label: 'Temperature' }, { value: 'pressure', label: 'Pressure' }, { value: 'wear', label: 'Wear' }]} onChange={(v) => onChangeStyle({ gridMode: v as 'temp' | 'pressure' | 'wear' })} />
        {mode === 'temp' && <SelectField label="Unit" value={s.unit === 'F' ? 'F' : 'C'} options={[{ value: 'C', label: '°C' }, { value: 'F', label: '°F' }]} onChange={(v) => onChangeStyle({ unit: v === 'F' ? 'F' : undefined })} />}
        {mode === 'pressure' && <SelectField label="Unit" value={s.unit ?? 'kPa'} options={[{ value: 'kPa', label: 'kPa' }, { value: 'psi', label: 'psi' }, { value: 'bar', label: 'bar' }]} onChange={(v) => onChangeStyle({ unit: v })} />}
        <ToggleField label="Mostrar labels" value={s.showLabels !== false} onChange={(v) => onChangeStyle({ showLabels: v })} />
        <ToggleField label="Mostrar average" value={s.showAverage === true} onChange={(v) => onChangeStyle({ showAverage: v })} />
        {mode === 'temp' && (
          <>
            <SectionLabel>Limiares °C</SectionLabel>
            <NumberField label="Frio <" value={s.coldAt ?? 70} onChange={(v) => onChangeStyle({ coldAt: v })} />
            <NumberField label="Optimal ≥" value={s.optimalAt ?? 85} onChange={(v) => onChangeStyle({ optimalAt: v })} />
            <NumberField label="Quente ≥" value={s.hotAt ?? 105} onChange={(v) => onChangeStyle({ hotAt: v })} />
            <NumberField label="Critical ≥" value={s.criticalAt ?? 115} onChange={(v) => onChangeStyle({ criticalAt: v })} />
          </>
        )}
        {mode === 'pressure' && (
          <>
            <SectionLabel>Alvo</SectionLabel>
            <NumberField label="Alvo (kPa)" value={s.targetValue ?? 165} onChange={(v) => onChangeStyle({ targetValue: v })} />
            <NumberField label="Tolerance" value={s.tolerance ?? 7} onChange={(v) => onChangeStyle({ tolerance: v })} />
          </>
        )}
      </div>
    )
  }
  if (t === 'brakegrid') {
    return (
      <div style={grid}>
        <SectionLabel>Data</SectionLabel>
        <SelectField label="Unit" value={s.unit === 'F' ? 'F' : 'C'} options={[{ value: 'C', label: '°C' }, { value: 'F', label: '°F' }]} onChange={(v) => onChangeStyle({ unit: v === 'F' ? 'F' : undefined })} />
        <ToggleField label="Mostrar average" value={s.showAverage === true} onChange={(v) => onChangeStyle({ showAverage: v })} />
        <SectionLabel>Limiares °C</SectionLabel>
        <NumberField label="Frio <" value={s.coldAt ?? 250} onChange={(v) => onChangeStyle({ coldAt: v })} />
        <NumberField label="Trab. ≥" value={s.optimalAt ?? 650} onChange={(v) => onChangeStyle({ optimalAt: v })} />
        <NumberField label="Quente ≥" value={s.hotAt ?? 850} onChange={(v) => onChangeStyle({ hotAt: v })} />
      </div>
    )
  }
  if (t === 'cornerstack') {
    return (
      <div style={grid}>
        <SectionLabel>Data</SectionLabel>
        <SelectField label="Unit temp." value={s.unit === 'F' ? 'F' : 'C'} options={[{ value: 'C', label: '°C' }, { value: 'F', label: '°F' }]} onChange={(v) => onChangeStyle({ unit: v === 'F' ? 'F' : undefined })} />
        <SectionLabel>Pressure alvo</SectionLabel>
        <NumberField label="Alvo (kPa)" value={s.targetValue ?? 165} onChange={(v) => onChangeStyle({ targetValue: v })} />
        <NumberField label="Tolerance" value={s.tolerance ?? 7} onChange={(v) => onChangeStyle({ tolerance: v })} />
      </div>
    )
  }
  if (t === 'fuelstint') {
    return (
      <div style={grid}>
        <SectionLabel>Data</SectionLabel>
        <SelectField label="Unit" value={s.unit === 'gal' ? 'gal' : 'L'} options={[{ value: 'L', label: 'Liters' }, { value: 'gal', label: 'Gallons' }]} onChange={(v) => onChangeStyle({ unit: v === 'gal' ? 'gal' : undefined })} />
        <ToggleField label="Modo enduro" value={s.enduranceMode === true} onChange={(v) => onChangeStyle({ enduranceMode: v })} />
        <SectionLabel>Comportamento</SectionLabel>
        <NumberField label="Reserva (laps)" value={s.reserveLaps ?? 1} onChange={(v) => onChangeStyle({ reserveLaps: Math.max(0, v) })} min={0} max={10} step={0.5} />
        <NumberField label="Alerta < laps" value={s.warnAtLaps ?? 2} onChange={(v) => onChangeStyle({ warnAtLaps: Math.max(0, v) })} min={0} max={20} step={0.5} />
      </div>
    )
  }
  if (t === 'deltatile') {
    return (
      <div style={grid}>
        <SectionLabel>Data</SectionLabel>
        <SelectField label="Reference" value={s.deltaReference ?? 'session'} options={[{ value: 'session', label: 'Best of session' }, { value: 'best', label: 'My best' }, { value: 'last', label: 'Last lap' }]} onChange={(v) => onChangeStyle({ deltaReference: v as 'session' | 'best' | 'last' })} />
        <NumberField label="Range ±s" value={s.deltaRangeSec ?? 1} onChange={(v) => onChangeStyle({ deltaRangeSec: Math.max(0.05, v) })} min={0.05} max={10} step={0.05} />
      </div>
    )
  }
  if (t === 'laptiming') {
    return (
      <div style={grid}>
        <SectionLabel>Rows exibidas</SectionLabel>
        <ToggleField label="Atual" value={s.showCurrent !== false} onChange={(v) => onChangeStyle({ showCurrent: v })} />
        <ToggleField label="Last" value={s.showLast !== false} onChange={(v) => onChangeStyle({ showLast: v })} />
        <ToggleField label="Melhor" value={s.showBest !== false} onChange={(v) => onChangeStyle({ showBest: v })} />
        <ToggleField label="Estimada" value={s.showEstimated === true} onChange={(v) => onChangeStyle({ showEstimated: v })} />
      </div>
    )
  }
  if (t === 'positiongaps') {
    return (
      <div style={grid}>
        <SectionLabel>Visual</SectionLabel>
        <ToggleField label="Mostrar total" value={s.showTotal !== false} onChange={(v) => onChangeStyle({ showTotal: v })} />
        <ColorField label="Accent color" value={s.accentColor ?? 'var(--accent-primary)'} onChange={(v) => onChangeStyle({ accentColor: v })} />
      </div>
    )
  }
  if (t === 'flagoverlay') {
    return (
      <div style={grid}>
        <SectionLabel>Comportamento</SectionLabel>
        <ToggleField label="Incluir incidents" value={s.includeIncidents === true} onChange={(v) => onChangeStyle({ includeIncidents: v })} />
        <ToggleField label="Compacto" value={s.compact === true} onChange={(v) => onChangeStyle({ compact: v })} />
      </div>
    )
  }
  if (t === 'inputbars' || t === 'inputtrace') {
    return (
      <div style={grid}>
        <SectionLabel>Data</SectionLabel>
        <ChannelsField value={s.channels ?? []} onChange={(v) => onChangeStyle({ channels: v })} />
        {t === 'inputtrace' && (
          <>
            <NumberField label="Amostras" value={s.traceLength ?? 160} onChange={(v) => onChangeStyle({ traceLength: Math.max(16, Math.min(2048, Math.round(v))) })} min={16} max={2048} />
            <NumberField label="Espessura" value={s.traceWidth ?? 1.8} onChange={(v) => onChangeStyle({ traceWidth: Math.max(0.5, Math.min(8, v)) })} min={0.5} max={8} step={0.1} />
            <NumberField label="Steering max.°" value={s.maxDegrees ?? 540} onChange={(v) => onChangeStyle({ maxDegrees: Math.max(90, Math.round(v)) })} min={90} max={1440} step={10} />
          </>
        )}
      </div>
    )
  }
  if (t === 'steering') {
    return (
      <div style={grid}>
        <SectionLabel>Data</SectionLabel>
        <NumberField label="Angle max.°" value={s.maxDegrees ?? 540} onChange={(v) => onChangeStyle({ maxDegrees: Math.max(90, Math.round(v)) })} min={90} max={1440} step={10} />
        <ToggleField label="Mostrar numerico" value={s.showNumeric !== false} onChange={(v) => onChangeStyle({ showNumeric: v })} />
      </div>
    )
  }
  if (t === 'setupstrip') {
    return (
      <div style={grid}>
        <SectionLabel>Campos</SectionLabel>
        <FieldsToggle value={s.fields ?? []} onChange={(v) => onChangeStyle({ fields: v })} />
        <SectionLabel>Bindings (MAP/BB exigem provedor)</SectionLabel>
        <BindingSelect label="MAP" value={s.bindingMap ?? ''} groups={groups} onChange={(v) => onChangeStyle({ bindingMap: v || undefined })} placeholder="var:engineMap" />
        <BindingSelect label="Brake bias" value={s.bindingBrakeBias ?? ''} groups={groups} onChange={(v) => onChangeStyle({ bindingBrakeBias: v || undefined })} placeholder="var:brakeBiasPct" />
        <BindingSelect label="ABS (level)" value={s.bindingAbs ?? ''} groups={groups} onChange={(v) => onChangeStyle({ bindingAbs: v || undefined })} placeholder="var:absLevel" />
        <BindingSelect label="TC (level)" value={s.bindingTc ?? ''} groups={groups} onChange={(v) => onChangeStyle({ bindingTc: v || undefined })} placeholder="var:tcLevel" />
      </div>
    )
  }
  if (t === 'enginetemps') {
    return (
      <div style={grid}>
        <SectionLabel>Data (exigem provedor)</SectionLabel>
        <SelectField label="Unit" value={s.unit === 'F' ? 'F' : 'C'} options={[{ value: 'C', label: '°C' }, { value: 'F', label: '°F' }]} onChange={(v) => onChangeStyle({ unit: v === 'F' ? 'F' : undefined })} />
        <div />
        <BindingSelect label="Water" value={s.bindingWater ?? ''} groups={groups} onChange={(v) => onChangeStyle({ bindingWater: v || undefined })} placeholder="var:waterTempC" />
        <BindingSelect label="Oil" value={s.bindingOil ?? ''} groups={groups} onChange={(v) => onChangeStyle({ bindingOil: v || undefined })} placeholder="var:oilTempC" />
        <BindingSelect label="Pressure oleo" value={s.bindingOilPressure ?? ''} groups={groups} onChange={(v) => onChangeStyle({ bindingOilPressure: v || undefined })} placeholder="var:oilPressureKpa" />
        <SectionLabel>Limiares</SectionLabel>
        <NumberField label="Quente ≥" value={s.hotAt ?? 108} onChange={(v) => onChangeStyle({ hotAt: v })} />
        <NumberField label="Critical ≥" value={s.criticalAt ?? 122} onChange={(v) => onChangeStyle({ criticalAt: v })} />
      </div>
    )
  }
  if (t === 'weather') {
    return (
      <div style={grid}>
        <SectionLabel>Data</SectionLabel>
        <SelectField label="Unit" value={s.unit === 'F' ? 'F' : 'C'} options={[{ value: 'C', label: '°C' }, { value: 'F', label: '°F' }]} onChange={(v) => onChangeStyle({ unit: v === 'F' ? 'F' : undefined })} />
      </div>
    )
  }
  if (t === 'trackmini') {
    return (
      <div style={grid}>
        <SectionLabel>Visual</SectionLabel>
        <ColorField label="Accent color" value={s.accentColor ?? 'var(--accent-primary)'} onChange={(v) => onChangeStyle({ accentColor: v })} />
      </div>
    )
  }
  return <></>
}


function hexFromCss(value: string | undefined): string {
  if (!value) return '#000000'
  const trimmed = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed
  if (/^#[0-9a-f]{8}$/i.test(trimmed)) return `#${trimmed.slice(1, 7)}`
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const r = trimmed[1]
    const g = trimmed[2]
    const b = trimmed[3]
    return `#${r}${r}${g}${g}${b}${b}`
  }
  const rgb = trimmed.match(/^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i)
  if (rgb) {
    const r = Number(rgb[1]).toString(16).padStart(2, '0')
    const g = Number(rgb[2]).toString(16).padStart(2, '0')
    const b = Number(rgb[3]).toString(16).padStart(2, '0')
    return `#${r}${g}${b}`
  }
  return '#000000'
}

function groupBindings(): Record<string, typeof DASHBOARD_BINDINGS> {
  const out: Record<string, typeof DASHBOARD_BINDINGS> = {}
  for (const b of DASHBOARD_BINDINGS) {
    if (!out[b.group]) out[b.group] = []
    out[b.group].push(b)
  }
  return out
}

function panel(extra: { borderColor?: string; padding?: number } = {}): CSSProperties {
  return {
    background: PANEL_BG,
    border: `1px solid ${extra.borderColor ?? PANEL_BORDER}`,
    borderRadius: 'var(--radius-sm)',
    padding: extra.padding ?? 16,
    color: TEXT_FG
  }
}

function panelHeader(): CSSProperties {
  return {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
    background: PANEL_BG,
    border: `1px solid ${PANEL_BORDER}`,
    borderRadius: 'var(--radius-sm)',
    padding: 16,
    color: TEXT_FG
  }
}

function btn(tone: 'primary' | 'danger' | 'default' = 'default'): CSSProperties {
  const bg = tone === 'primary' ? 'var(--accent-primary)' : tone === 'danger' ? 'var(--accent-danger)' : 'transparent'
  const color = tone === 'default' ? 'var(--text-primary)' : 'var(--text-on-accent)'
  return {
    background: bg,
    color,
    border: tone === 'default' ? '1px solid var(--border-strong)' : '1px solid transparent',
    borderRadius: 'var(--radius-sm)',
    padding: '6px 12px',
    cursor: 'pointer',
    fontFamily: '"Rajdhani", sans-serif',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    fontSize: 13
  }
}

function input(extra: CSSProperties = {}): CSSProperties {
  return {
    width: '100%',
    boxSizing: 'border-box',
    background: 'var(--surface-sunken)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-sm)',
    padding: '0 var(--space-4)',
    height: 36,
    fontSize: 13,
    fontFamily: '"Instrument Sans", sans-serif',
    ...extra
  }
}

function fieldLabel(): CSSProperties {
  return {
    display: 'block',
    color: 'var(--text-muted)',
    fontSize: 11,
    fontFamily: '"Barlow Condensed", sans-serif',
    fontWeight: 600,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: '0.08em'
  }
}
