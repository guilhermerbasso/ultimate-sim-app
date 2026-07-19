import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react'
import type { AlertsConfig } from '../../../../shared/alerts'
import type { CustomOverlayDef, OverlayWidgetConfig, OverlayWidgetId, OverlayWidgetLine } from '../../../../shared/overlays'
import { DEFAULT_OVERLAY_STYLE_PRESET, DEFAULT_RICH_OVERLAY_CANVAS, createDefaultOverlayStyle } from '../../../../shared/overlays'
import type { DashboardElement, DashboardElementStyle, TextSlotStyle } from '../../../../shared/dashboards'
import {
  DASHBOARD_FONT_OPTIONS,
  WIDGET_SLOTS,
  createElementId,
  reorderElements,
  sortElementsByZ
} from '../../../../shared/dashboards'
import { renderDashboardElement } from '../../dashboard/DashboardRoot'
import { PREVIEW_SNAPSHOT } from '../../dashboard/widgets/gt3-theme'
import { resolveWidgetComponent } from '../../overlay/widgets'
import { HifiWidgetHost } from '../../overlay/widgets/HifiWidgetHost'
import {
  ALL_OVERLAY_WIDGETS,
  resolveOverlayTrigger
} from '../../overlay/hifi-overlays'
import {
  createEditorPreviewAlertsConfig,
  createEditorTriggerPreviewFrame,
  isTriggerOnlyPreview
} from '../../overlay/editor-trigger-preview'
import { TriggerPreviewToggle } from '../../components/TriggerPreviewToggle'
import { WidgetGallery, variantToElement } from '../dashboard/widget-catalog'
import type { WidgetVariant } from '../dashboard/widget-catalog'
import '../../dashboard/dashboard-runtime.css'

// "Create new overlay" builder — assembles a RICH custom overlay (a free-form
// canvas of dashboard widgets + images) reusing the SAME widget palette
// (WidgetGallery) and the SAME element renderer (renderDashboardElement) the
// dashboards use, plus an equivalent granular styling inspector (per-slot fonts,
// borders, image filters, z-order). The saved def opens in a transparent
// always-on-top overlay window via CustomOverlayWidget's rich branch.

const RESIZE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
type ResizeHandle = (typeof RESIZE_HANDLES)[number]
const MIN_SIZE = 8

const TRANSFORM_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'uppercase', label: 'UPPERCASE' },
  { value: 'lowercase', label: 'lowercase' },
  { value: 'capitalize', label: 'Capitalizar' }
]
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
const IMAGE_FILTER_PRESETS: Array<{ id: string; label: string; patch: Partial<DashboardElementStyle> }> = [
  { id: 'original', label: 'Original', patch: { filterGrayscale: undefined, filterSepia: undefined, redTint: undefined, brightness: undefined, contrast: undefined, saturate: undefined, hueRotate: undefined, invert: undefined, blur: undefined } },
  { id: 'bw', label: 'B&W', patch: { filterGrayscale: 1, filterSepia: undefined, redTint: undefined, brightness: undefined, contrast: 1.05, saturate: undefined, hueRotate: undefined, invert: undefined } },
  { id: 'red', label: 'Red', patch: { filterGrayscale: 1, filterSepia: undefined, redTint: 1, brightness: 0.95, contrast: 1.1, saturate: undefined, hueRotate: undefined, invert: undefined } },
  { id: 'sepia', label: 'Sepia', patch: { filterGrayscale: undefined, filterSepia: 1, redTint: undefined, brightness: 1.02, contrast: undefined, saturate: undefined, hueRotate: undefined, invert: undefined } }
]

type BuilderElementStyle = DashboardElementStyle & {
  borderColor?: string
  showDivider?: boolean
  lines?: OverlayWidgetLine[]
}
type BuilderStylePatch = Partial<DashboardElementStyle> & {
  borderColor?: string
  showDivider?: boolean
  lines?: OverlayWidgetLine[]
}

const BUILDER_PREVIEW_SNAPSHOT = {
  ...PREVIEW_SNAPSHOT,
  timestamp: Date.now(),
  rpm: 7860,
  speedKmh: 248,
  gear: 5,
  maxRpm: 8300,
  shiftIndicatorPct: 0.92,
  revLights: { firstRpm: 6400, shiftRpm: 8050, lastRpm: 8350, blinkRpm: 8250, pct: 0.92, blink: false },
  throttle: 0.94,
  brake: 0.08,
  clutch: 0,
  steerAngleDeg: -11,
  steeringTorquePct: 0.34,
  steeringAngleMaxDeg: 540,
  latAccelG: 1.18,
  longAccelG: -0.22,
  waterTempC: 91,
  oilTempC: 104,
  oilPressureKpa: 420,
  manifoldPressBar: 1.72,
  fuelPressBar: 4.2,
  voltage: 13.8,
  absCutPct: 0.18,
  deltaToBestSec: -0.173,
  deltaToSessionBestSec: 0.082,
  deltaToOptimalSec: 0.318,
  fuelLiters: 39.4,
  fuelLevelPct: 0.42,
  brakeLinePressBar: { lf: 34, rf: 36, lr: 18, rr: 19 },
  tireColdPressuresKpa: { lf: 159, rf: 160, lr: 158, rr: 159 },
  carLeftRight: 'right',
  carLeftRightRaw: 3,
  carLeftRightCount: 1
} satisfies typeof PREVIEW_SNAPSHOT

class PreviewErrorBoundary extends Component<{ children: ReactNode; boundaryKey: string }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidUpdate(prevProps: { boundaryKey: string }): void {
    if (prevProps.boundaryKey !== this.props.boundaryKey && this.state.failed) this.setState({ failed: false })
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className="overlay-builder-preview-error">
          preview error
        </div>
      )
    }
    return this.props.children
  }
}

// ── Pure style helpers (mirrors the dashboard editor; kept local + stateless) ──
function hexFromCss(value: string | undefined): string {
  if (!value) return '#000000'
  const t = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(t)) return t
  if (/^#[0-9a-f]{8}$/i.test(t)) return `#${t.slice(1, 7)}`
  if (/^#[0-9a-f]{3}$/i.test(t)) return `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`
  const rgb = t.match(/^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i)
  if (rgb) {
    const r = Number(rgb[1]).toString(16).padStart(2, '0')
    const g = Number(rgb[2]).toString(16).padStart(2, '0')
    const b = Number(rgb[3]).toString(16).padStart(2, '0')
    return `#${r}${g}${b}`
  }
  return '#000000'
}

function applySlotField(
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

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('failed to load image'))
    img.src = src
  })
}

async function fileToDataUrl(file: File): Promise<string> {
  const LIMIT = 3_000_000
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('failed to read file'))
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

function constrainGeo(
  geo: { x: number; y: number; w: number; h: number },
  cw: number,
  ch: number
): { x: number; y: number; w: number; h: number } {
  const w = Math.max(MIN_SIZE, Math.min(Math.round(geo.w), cw))
  const h = Math.max(MIN_SIZE, Math.min(Math.round(geo.h), ch))
  const x = Math.max(0, Math.min(Math.round(geo.x), cw - w))
  const y = Math.max(0, Math.min(Math.round(geo.y), ch - h))
  return { x, y, w, h }
}

function resizeGeo(
  start: { x: number; y: number; w: number; h: number },
  handle: ResizeHandle,
  dx: number,
  dy: number
): { x: number; y: number; w: number; h: number } {
  let { x, y, w, h } = start
  if (handle.includes('e')) w = start.w + dx
  if (handle.includes('s')) h = start.h + dy
  if (handle.includes('w')) {
    w = start.w - dx
    x = start.x + dx
  }
  if (handle.includes('n')) {
    h = start.h - dy
    y = start.y + dy
  }
  if (w < MIN_SIZE) {
    if (handle.includes('w')) x = start.x + (start.w - MIN_SIZE)
    w = MIN_SIZE
  }
  if (h < MIN_SIZE) {
    if (handle.includes('n')) y = start.y + (start.h - MIN_SIZE)
    h = MIN_SIZE
  }
  return { x, y, w, h }
}

function handleCursor(handle: ResizeHandle): string {
  switch (handle) {
    case 'n':
    case 's':
      return 'ns-resize'
    case 'e':
    case 'w':
      return 'ew-resize'
    case 'ne':
    case 'sw':
      return 'nesw-resize'
    default:
      return 'nwse-resize'
  }
}

// ── Small reusable fields ─────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <label className="designer-field">
      {label}
      {children}
    </label>
  )
}

function NumberField({ label, value, onChange, min, max, step }: { label: string; value: number; onChange(v: number): void; min?: number; max?: number; step?: number }): ReactElement {
  return (
    <Field label={label}>
      <input type="number" value={value} min={min} max={max} step={step ?? 1} onChange={(e) => onChange(Number(e.target.value))} />
    </Field>
  )
}

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange(v: string): void; placeholder?: string }): ReactElement {
  return (
    <Field label={label}>
      <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Field>
  )
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange(v: string): void }): ReactElement {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </Field>
  )
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }): ReactElement {
  return (
    <Field label={label}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input type="color" value={hexFromCss(value)} style={{ width: 40, flex: '0 0 auto' }} onChange={(e) => onChange(e.target.value)} />
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </Field>
  )
}

function SliderField({ label, value, onChange, min, max, step }: { label: string; value: number; onChange(v: number): void; min: number; max: number; step?: number }): ReactElement {
  return (
    <Field label={`${label} · ${Number.isInteger(value) ? value : value.toFixed(2)}`}>
      <input type="range" min={min} max={max} step={step ?? 0.01} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </Field>
  )
}

function ToggleField({ label, value, onChange }: { label: string; value: boolean; onChange(v: boolean): void }): ReactElement {
  return (
    <Field label={label}>
      <select value={value ? 'yes' : 'no'} onChange={(e) => onChange(e.target.value === 'yes')}>
        <option value="yes">Sim</option>
        <option value="no">Nao</option>
      </select>
    </Field>
  )
}

const FONT_OPTIONS = DASHBOARD_FONT_OPTIONS

const OVERLAY_BUILDER_LAYOUT_CSS = `
.overlay-designer.overlay-builder {
  width: min(1500px, calc(100vw - 48px));
}

.overlay-builder-grid {
  flex: 1 1 auto;
  grid-template-columns: minmax(260px, 300px) minmax(360px, 1fr) minmax(300px, 340px);
}

.overlay-builder-grid > * {
  min-width: 0;
}

.overlay-builder-palette,
.overlay-builder-inspector {
  max-height: none;
}

.overlay-builder-center {
  align-items: stretch;
  min-height: 0;
  overflow: hidden;
}

.overlay-builder-stage-shell {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  min-height: 260px;
  overflow: hidden;
  width: 100%;
}

.overlay-builder-preview-error {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  border: 1px solid rgba(255, 84, 104, 0.55);
  border-radius: 8px;
  background: rgba(36, 6, 10, 0.68);
  color: #ffb3be;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

@media (max-width: 1100px) {
  .overlay-builder-grid {
    grid-template-columns: minmax(240px, 300px) minmax(0, 1fr);
  }

  .overlay-builder-inspector {
    grid-column: 1 / -1;
    max-height: 260px;
  }
}

@media (max-width: 820px) {
  .overlay-builder-grid {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }

  .overlay-builder-palette,
  .overlay-builder-inspector {
    max-height: none;
  }
}
`

// ── Canvas (scaled live preview with selection + drag/resize) ─────────────────
interface CanvasProps {
  widgets: DashboardElement[]
  canvasWidth: number
  canvasHeight: number
  selectedId: string | null
  onSelect(id: string | null): void
  onGeometry(id: string, geo: { x: number; y: number; w: number; h: number }): void
  showTriggerOnlyActive: boolean
  alertsConfig?: AlertsConfig
}

interface ActiveEdit {
  id: string
  mode: 'move' | 'resize'
  handle?: ResizeHandle
  pointerId: number
  startX: number
  startY: number
  start: { x: number; y: number; w: number; h: number }
}

function overlayConfigFromElement(element: DashboardElement, widgetId: OverlayWidgetId): OverlayWidgetConfig {
  const style = element.style as BuilderElementStyle
  const base = createDefaultOverlayStyle()
  const borderColor = style.borderColor ?? style.border ?? base.border
  return {
    id: widgetId,
    enabled: true,
    locked: true,
    favorite: false,
    position: { x: element.x, y: element.y, width: element.w, height: element.h },
    opacity: 100,
    stylePreset: DEFAULT_OVERLAY_STYLE_PRESET,
    style: {
      ...base,
      background: style.background ?? base.background,
      accent: style.accentColor ?? style.fillColor ?? base.accent,
      border: style.border ?? borderColor,
      borderColor,
      borderWidth: Number.isFinite(style.borderWidth) ? Math.max(0, Math.round(style.borderWidth ?? 0)) : undefined,
      radius: Math.max(0, Math.round(style.radius ?? base.radius)),
      fontFamily: style.fontFamily ?? base.fontFamily,
      opacity: Number.isFinite(style.opacity) ? Math.max(0, Math.min(1, style.opacity ?? 1)) : undefined,
      showDivider: style.showDivider,
      lines: style.lines
    },
    display: null,
    hifiModuleId: element.hifiModuleId
  }
}

export function RuntimeWidgetPreview({
  element,
  showTriggerOnlyActive,
  alertsConfig
}: {
  element: DashboardElement
  showTriggerOnlyActive: boolean
  alertsConfig?: AlertsConfig
}): ReactElement {
  const widgetId =
    element.widgetId ??
    (element.hifiModuleId
      ? (`hifi:${element.hifiModuleId}` as OverlayWidgetId)
      : undefined)
  const Widget = widgetId ? resolveWidgetComponent(widgetId) : undefined
  const resolvedElement =
    widgetId && widgetId !== element.widgetId
      ? { ...element, widgetId }
      : element
  const fallbackAlertsConfig = showTriggerOnlyActive
    ? createEditorPreviewAlertsConfig(alertsConfig)
    : alertsConfig
  if ((!element.widgetId && element.hifiModuleId) || !widgetId || !Widget) {
    return renderDashboardElement({
      element: resolvedElement,
      snapshot: BUILDER_PREVIEW_SNAPSHOT,
      preview: 'inert',
      alertsConfig: fallbackAlertsConfig,
      forceTriggerActive: showTriggerOnlyActive
    })
  }
  const style = element.style as BuilderElementStyle
  const borderColor = style.borderColor ?? style.border
  const isHifi = widgetId.startsWith('hifi:')
  const config = overlayConfigFromElement(element, widgetId)
  const definition = ALL_OVERLAY_WIDGETS.find((item) => item.id === widgetId)
  const trigger = resolveOverlayTrigger(definition, config)
  const triggerPreview =
    showTriggerOnlyActive && isTriggerOnlyPreview(definition?.role, trigger)
      ? createEditorTriggerPreviewFrame(
          BUILDER_PREVIEW_SNAPSHOT,
          trigger,
          true,
          alertsConfig,
          `overlay-builder:${element.id}`
        )
      : null
  const renderSnapshot = triggerPreview?.snapshot ?? BUILDER_PREVIEW_SNAPSHOT
  const visibility = triggerPreview?.visibility
  const renderAlertsConfig = triggerPreview?.alertsConfig ?? alertsConfig

  const containerStyle: CSSProperties = {
    position: 'absolute',
    left: element.x,
    top: element.y,
    width: element.w,
    height: element.h,
    display: 'block',
    pointerEvents: 'none',
    background: isHifi ? 'transparent' : (style.background ?? 'transparent'),
    borderRadius: isHifi ? 0 : (style.radius ?? 0),
    border: !isHifi && style.borderWidth ? `${Math.max(0, Math.round(style.borderWidth))}px solid ${borderColor ?? 'transparent'}` : undefined
  }
  return (
    <div
      className="dash-element dash-overlaywidget"
      style={containerStyle}
      data-trigger-preview-visible={visibility?.visible ? 'true' : undefined}
    >
      {isHifi ? (
        <HifiWidgetHost
          snapshot={renderSnapshot}
          config={config}
          visibility={visibility}
          preview="inert"
          alertsConfig={renderAlertsConfig}
        />
      ) : (
        <Widget
          snapshot={renderSnapshot}
          config={config}
          visibility={visibility}
          alertsConfig={renderAlertsConfig}
        />
      )}
    </div>
  )
}

function BuilderCanvas({
  widgets,
  canvasWidth,
  canvasHeight,
  selectedId,
  onSelect,
  onGeometry,
  showTriggerOnlyActive,
  alertsConfig
}: CanvasProps): ReactElement {
  const stageBoxRef = useRef<HTMLDivElement | null>(null)
  const activeRef = useRef<ActiveEdit | null>(null)
  const [stageBox, setStageBox] = useState({ width: 760, height: 460 })
  const sorted = useMemo(() => sortElementsByZ(widgets), [widgets])
  const safeCanvasWidth = Math.max(1, canvasWidth)
  const safeCanvasHeight = Math.max(1, canvasHeight)
  const scale = Math.min(stageBox.width / safeCanvasWidth, stageBox.height / safeCanvasHeight)
  const previewW = Math.round(safeCanvasWidth * scale)
  const previewH = Math.round(safeCanvasHeight * scale)
  const handleSize = Math.max(8, 11 / scale)

  useEffect(() => {
    const node = stageBoxRef.current
    if (!node) return undefined

    const update = (): void => {
      setStageBox({
        width: Math.max(240, node.clientWidth),
        height: Math.max(180, node.clientHeight)
      })
    }

    update()
    const ResizeObserverCtor = typeof ResizeObserver !== 'undefined' ? ResizeObserver : undefined
    if (ResizeObserverCtor) {
      const observer = new ResizeObserverCtor(update)
      observer.observe(node)
      return () => observer.disconnect()
    }

    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      const active = activeRef.current
      if (!active || active.pointerId !== event.pointerId) return
      event.preventDefault()
      const dx = (event.clientX - active.startX) / scale
      const dy = (event.clientY - active.startY) / scale
      const geo =
        active.mode === 'move'
          ? constrainGeo({ ...active.start, x: active.start.x + dx, y: active.start.y + dy }, canvasWidth, canvasHeight)
          : constrainGeo(resizeGeo(active.start, active.handle ?? 'se', dx, dy), canvasWidth, canvasHeight)
      onGeometry(active.id, geo)
    },
    [scale, canvasWidth, canvasHeight, onGeometry]
  )

  const endEdit = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    const active = activeRef.current
    if (!active || active.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    activeRef.current = null
  }, [])

  function beginEdit(event: ReactPointerEvent<HTMLElement>, el: DashboardElement, mode: 'move' | 'resize', handle?: ResizeHandle): void {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    onSelect(el.id)
    event.currentTarget.setPointerCapture(event.pointerId)
    activeRef.current = {
      id: el.id,
      mode,
      handle,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      start: { x: el.x, y: el.y, w: el.w, h: el.h }
    }
  }

  return (
    <div className="overlay-builder-stage-shell" ref={stageBoxRef}>
      <div
        className="overlay-builder-stage"
        style={{ width: previewW, height: previewH }}
        onPointerDown={() => onSelect(null)}
      >
        <div
          className="overlay-builder-canvas"
          style={{ width: safeCanvasWidth, height: safeCanvasHeight, transform: `scale(${scale})` }}
        >
          {sorted.map((el) => (
            <div key={el.id} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              <PreviewErrorBoundary boundaryKey={`${el.id}:${el.widgetId ?? el.type}`}>
                <RuntimeWidgetPreview
                  element={el}
                  showTriggerOnlyActive={showTriggerOnlyActive}
                  alertsConfig={alertsConfig}
                />
              </PreviewErrorBoundary>
            </div>
          ))}
          {sorted.map((el) => {
            const selected = el.id === selectedId
            return (
              <div
                key={`sel-${el.id}`}
                role="button"
                tabIndex={-1}
                onPointerDown={(event) => beginEdit(event, el, 'move')}
                onPointerMove={onPointerMove}
                onPointerUp={endEdit}
                onPointerCancel={endEdit}
                style={{
                  position: 'absolute',
                  left: el.x,
                  top: el.y,
                  width: el.w,
                  height: el.h,
                  cursor: 'move',
                  border: selected ? '2px solid var(--accent-primary, #ff7a1a)' : '1px dashed rgba(255,170,90,0.45)',
                  background: selected ? 'rgba(255,122,26,0.07)' : 'transparent',
                  boxSizing: 'border-box',
                  touchAction: 'none'
                }}
              >
                {selected &&
                  RESIZE_HANDLES.map((handle) => {
                    const isW = handle.includes('w')
                    const isE = handle.includes('e')
                    const isN = handle.includes('n')
                    const isS = handle.includes('s')
                    const left = isW ? -handleSize / 2 : isE ? el.w - handleSize / 2 : el.w / 2 - handleSize / 2
                    const top = isN ? -handleSize / 2 : isS ? el.h - handleSize / 2 : el.h / 2 - handleSize / 2
                    return (
                      <div
                        key={handle}
                        onPointerDown={(event) => beginEdit(event, el, 'resize', handle)}
                        onPointerMove={onPointerMove}
                        onPointerUp={endEdit}
                        onPointerCancel={endEdit}
                        style={{
                          position: 'absolute',
                          left,
                          top,
                          width: handleSize,
                          height: handleSize,
                          background: 'var(--accent-primary, #ff7a1a)',
                          border: '1px solid #1a0f06',
                          borderRadius: 2,
                          cursor: handleCursor(handle),
                          touchAction: 'none'
                        }}
                      />
                    )
                  })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Inspector ─────────────────────────────────────────────────────────────────
interface InspectorProps {
  element: DashboardElement | null
  canvasWidth: number
  canvasHeight: number
  onChange(patch: Partial<DashboardElement>): void
  onChangeStyle(patch: BuilderStylePatch): void
  onReorder(direction: 'front' | 'back' | 'forward' | 'backward'): void
  onDuplicate(): void
  onRemove(): void
}

function SlotEditor({ element, slots, onChangeStyle }: { element: DashboardElement; slots: Array<{ slot: string; label: string }>; onChangeStyle(p: BuilderStylePatch): void }): ReactElement {
  const [active, setActive] = useState<string>(slots[0]?.slot ?? 'value')
  const slot = slots.some((s) => s.slot === active) ? active : (slots[0]?.slot ?? 'value')
  const cur: Partial<TextSlotStyle> = element.style.slots?.[slot] ?? {}
  const set = (field: keyof TextSlotStyle, value: unknown): void => onChangeStyle({ slots: applySlotField(element.style, slot, field, value) })
  return (
    <div className="overlay-builder-section">
      <div className="overlay-builder-section-title">Style por texto (granular)</div>
      <div className="overlay-builder-slot-tabs">
        {slots.map((s) => {
          const touched = Boolean(element.style.slots?.[s.slot] && Object.keys(element.style.slots[s.slot]).length > 0)
          return (
            <button key={s.slot} className={s.slot === slot ? 'ghost-action active' : 'ghost-action'} onClick={() => setActive(s.slot)}>
              {s.label}{touched ? ' •' : ''}
            </button>
          )
        })}
      </div>
      <div className="designer-grid-2">
        <SelectField label="Font" value={String(cur.fontFamily ?? '')} options={FONT_OPTIONS} onChange={(v) => set('fontFamily', v || undefined)} />
        <NumberField label="Size (0=auto)" value={Number(cur.fontSize ?? 0)} onChange={(v) => set('fontSize', v > 0 ? Math.round(v) : undefined)} min={0} max={400} />
        <ColorField label="Color" value={String(cur.fontColor ?? '')} onChange={(v) => set('fontColor', v || undefined)} />
        <SelectField label="Weight" value={String(cur.fontWeight ?? '')} options={WEIGHT_OPTIONS} onChange={(v) => set('fontWeight', v ? Number(v) : undefined)} />
        <SelectField label="Alignment" value={String(cur.align ?? '')} options={ALIGN_OPTIONS} onChange={(v) => set('align', v || undefined)} />
        <NumberField label="Spacing (px)" value={Number(cur.letterSpacing ?? 0)} onChange={(v) => set('letterSpacing', Number.isFinite(v) && v !== 0 ? v : undefined)} min={-5} max={30} step={0.5} />
        <SelectField label="Transform" value={String(cur.textTransform ?? 'none')} options={TRANSFORM_OPTIONS} onChange={(v) => set('textTransform', v === 'none' ? undefined : v)} />
        <ToggleField label="Shadow/glow" value={Boolean(cur.shadow)} onChange={(on) => set('shadow', on ? '0 2px 6px rgba(0,0,0,0.65)' : undefined)} />
      </div>
    </div>
  )
}

function DividerLinesEditor({ style, onChangeStyle }: { style: BuilderElementStyle; onChangeStyle(p: BuilderStylePatch): void }): ReactElement {
  const lines = style.lines ?? []
  const updateLine = (index: number, color: string): void => {
    const next = lines.map((line, i) => (i === index ? { ...line, color } : line))
    onChangeStyle({ lines: next })
  }
  const removeLine = (index: number): void => {
    const next = lines.filter((_, i) => i !== index)
    onChangeStyle({ lines: next.length > 0 ? next : undefined, showDivider: next.length > 0 ? style.showDivider : false })
  }
  return (
    <div className="overlay-builder-section">
      <div className="overlay-builder-section-title">Divider lines</div>
      <ToggleField label="Show divider lines" value={Boolean(style.showDivider)} onChange={(on) => onChangeStyle({ showDivider: on, lines: on && lines.length === 0 ? [{ color: style.borderColor ?? style.border ?? '#ff7a1a' }] : lines })} />
      {style.showDivider && (
        <>
          <div className="overlay-builder-slot-tabs">
            <button className="ghost-action" onClick={() => onChangeStyle({ lines: [...lines, { color: style.borderColor ?? style.border ?? '#ff7a1a' }], showDivider: true })}>+ line</button>
          </div>
          {lines.map((line, index) => (
            <div key={index} className="designer-grid-2">
              <ColorField label={`Line ${index + 1}`} value={line.color} onChange={(v) => updateLine(index, v)} />
              <Field label="Action">
                <button className="ghost-action danger" onClick={() => removeLine(index)}>Remove</button>
              </Field>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function Inspector({ element, canvasWidth, canvasHeight, onChange, onChangeStyle, onReorder, onDuplicate, onRemove }: InspectorProps): ReactElement {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  if (!element) {
    return <p className="overlay-help">Select a widget on the canvas to edit position, size, fonts, borders, filters, and order.</p>
  }
  const s = element.style as BuilderElementStyle
  const isBarLike = ['bar', 'gauge', 'shiftlights', 'barv', 'dualbar', 'deltabar', 'trace'].includes(element.type)
  const isImage = element.type === 'image'
  const isFlag = element.type === 'flag'
  const isText = element.type === 'text'
  const slots = WIDGET_SLOTS[element.type] ?? []
  // Semantic GT3/extra/curated widgets (everything that is not a primitive text,
  // image, flag or bar/gauge). These honour accent/threshold colours, opacity,
  // unit/prefix/suffix/decimals and the show-labels/icon toggles below.
  const isDataWidget = !isText && !isImage && !isFlag && !isBarLike

  return (
    <div className="overlay-builder-inspector-body">
      <TextField label="Name" value={element.name ?? ''} onChange={(v) => onChange({ name: v })} />
      <div className="overlay-builder-section">
        <div className="overlay-builder-section-title">Position e tamanho</div>
        <div className="designer-grid-4">
          <NumberField label="X" value={element.x} onChange={(v) => onChange({ x: Math.max(0, Math.min(Math.round(v), canvasWidth - element.w)) })} min={0} max={canvasWidth} />
          <NumberField label="Y" value={element.y} onChange={(v) => onChange({ y: Math.max(0, Math.min(Math.round(v), canvasHeight - element.h)) })} min={0} max={canvasHeight} />
          <NumberField label="Width" value={element.w} onChange={(v) => onChange({ w: Math.max(MIN_SIZE, Math.min(Math.round(v), canvasWidth)) })} min={MIN_SIZE} max={canvasWidth} />
          <NumberField label="Height" value={element.h} onChange={(v) => onChange({ h: Math.max(MIN_SIZE, Math.min(Math.round(v), canvasHeight)) })} min={MIN_SIZE} max={canvasHeight} />
        </div>
        <div className="overlay-builder-section-title">Ordem (z)</div>
        <div className="designer-grid-4">
          <button className="ghost-action" onClick={() => onReorder('backward')}>↓ tras</button>
          <button className="ghost-action" onClick={() => onReorder('forward')}>↑ front</button>
          <button className="ghost-action" onClick={() => onReorder('back')}>⤓ fundo</button>
          <button className="ghost-action" onClick={() => onReorder('front')}>⤒ topo</button>
        </div>
      </div>

      <div className="overlay-builder-section">
        <div className="overlay-builder-section-title">Background and border</div>
        <div className="designer-grid-2">
          <ColorField label="Background" value={s.background ?? 'transparent'} onChange={(v) => onChangeStyle({ background: v })} />
          <ColorField label="Border" value={s.border ?? 'transparent'} onChange={(v) => onChangeStyle({ border: v, borderColor: v })} />
          <ColorField label="Border color" value={s.borderColor ?? s.border ?? 'transparent'} onChange={(v) => onChangeStyle({ borderColor: v, border: v })} />
          <NumberField label="Border (px)" value={s.borderWidth ?? 0} onChange={(v) => onChangeStyle({ borderWidth: Math.max(0, Math.round(v)) })} min={0} max={20} />
          <NumberField label="Radius (px)" value={s.radius ?? 0} onChange={(v) => onChangeStyle({ radius: Math.max(0, Math.round(v)) })} min={0} max={120} />
        </div>
      </div>
      <DividerLinesEditor style={s} onChangeStyle={onChangeStyle} />

      {(isText || slots.length === 0) && !isImage && !isFlag && (
        <div className="overlay-builder-section">
          <div className="overlay-builder-section-title">Text</div>
          {isText && <TextField label="Text (no binding)" value={s.text ?? ''} onChange={(v) => onChangeStyle({ text: v })} />}
          <div className="designer-grid-2">
            <SelectField label="Font" value={String(s.fontFamily ?? '')} options={FONT_OPTIONS} onChange={(v) => onChangeStyle({ fontFamily: v || undefined })} />
            <NumberField label="Font (px)" value={Number(s.fontSize ?? 18)} onChange={(v) => onChangeStyle({ fontSize: v })} min={8} max={400} />
            <ColorField label="Text color" value={s.color ?? '#f6fbff'} onChange={(v) => onChangeStyle({ color: v })} />
            <SelectField label="Weight" value={String(s.fontWeight ?? 700)} options={WEIGHT_OPTIONS.filter((o) => o.value !== '')} onChange={(v) => onChangeStyle({ fontWeight: Number(v) })} />
            <SelectField label="Alignment" value={String(s.align ?? 'left')} options={ALIGN_OPTIONS.filter((o) => o.value !== '')} onChange={(v) => onChangeStyle({ align: v as 'left' | 'center' | 'right' })} />
            <TextField label="Prefix" value={s.prefix ?? ''} onChange={(v) => onChangeStyle({ prefix: v || undefined })} />
            <TextField label="Suffix" value={s.suffix ?? ''} onChange={(v) => onChangeStyle({ suffix: v || undefined })} />
            <NumberField label="Decimal places" value={s.decimals ?? 0} onChange={(v) => onChangeStyle({ decimals: Math.max(0, Math.min(4, Math.round(v))) })} min={0} max={4} />
          </div>
        </div>
      )}

      {isBarLike && (
        <div className="overlay-builder-section">
          <div className="overlay-builder-section-title">Bars / gauges</div>
          <div className="designer-grid-2">
            <ColorField label="Fill" value={s.fillColor ?? 'var(--accent-primary)'} onChange={(v) => onChangeStyle({ fillColor: v })} />
            <ColorField label="Warning" value={s.warnColor ?? '#ffb84d'} onChange={(v) => onChangeStyle({ warnColor: v })} />
            <ColorField label="Danger" value={s.dangerColor ?? '#ff5468'} onChange={(v) => onChangeStyle({ dangerColor: v })} />
            <NumberField label="Warning (0–1)" value={s.warnAt ?? 0.7} onChange={(v) => onChangeStyle({ warnAt: Math.max(0, Math.min(1, v)) })} min={0} max={1} step={0.05} />
            <NumberField label="Danger (0–1)" value={s.dangerAt ?? 0.9} onChange={(v) => onChangeStyle({ dangerAt: Math.max(0, Math.min(1, v)) })} min={0} max={1} step={0.05} />
            {element.type === 'shiftlights' && (
              <NumberField label="Segments" value={s.segments ?? 12} onChange={(v) => onChangeStyle({ segments: Math.max(4, Math.min(24, Math.round(v))) })} min={4} max={24} />
            )}
          </div>
        </div>
      )}

      {isDataWidget && (
        <div className="overlay-builder-section">
          <div className="overlay-builder-section-title">Data, cores e formatacao</div>
          <div className="designer-grid-2">
            <ColorField label="Accent color" value={s.accentColor ?? ''} onChange={(v) => onChangeStyle({ accentColor: v || undefined })} />
            <SliderField label="Opacity" value={s.opacity ?? 1} onChange={(v) => onChangeStyle({ opacity: v >= 1 ? undefined : Math.max(0, Math.min(1, v)) })} min={0} max={1} step={0.05} />
            <NumberField label="Decimal places" value={s.decimals ?? 0} onChange={(v) => onChangeStyle({ decimals: Number.isFinite(v) && v > 0 ? Math.min(6, Math.round(v)) : undefined })} min={0} max={6} />
            <TextField label="Prefix" value={s.prefix ?? ''} onChange={(v) => onChangeStyle({ prefix: v || undefined })} />
            <TextField label="Suffix / unit" value={s.suffix ?? ''} onChange={(v) => onChangeStyle({ suffix: v || undefined })} />
            <ToggleField label="Show labels" value={s.showLabels !== false} onChange={(on) => onChangeStyle({ showLabels: on ? undefined : false })} />
            <ToggleField label="Show icon" value={s.showIcon !== false} onChange={(on) => onChangeStyle({ showIcon: on ? undefined : false })} />
          </div>
          <div className="overlay-builder-section-title">Color thresholds</div>
          <div className="designer-grid-2">
            <ColorField label="Warning" value={s.warnColor ?? '#ffb84d'} onChange={(v) => onChangeStyle({ warnColor: v || undefined })} />
            <ColorField label="Danger" value={s.dangerColor ?? '#ff5468'} onChange={(v) => onChangeStyle({ dangerColor: v || undefined })} />
            <NumberField label="Warning (0–1)" value={s.warnAt ?? 0} onChange={(v) => onChangeStyle({ warnAt: v > 0 ? Math.max(0, Math.min(1, v)) : undefined })} min={0} max={1} step={0.05} />
            <NumberField label="Danger (0–1)" value={s.dangerAt ?? 0} onChange={(v) => onChangeStyle({ dangerAt: v > 0 ? Math.max(0, Math.min(1, v)) : undefined })} min={0} max={1} step={0.05} />
          </div>
        </div>
      )}

      {isFlag && (
        <div className="overlay-builder-section">
          <div className="overlay-builder-section-title">Flag</div>
          <SelectField
            label="Flag observada"
            value={s.flagKey ?? ''}
            options={[
              { value: '', label: '(qualquer active)' },
              ...['green', 'yellow', 'blue', 'white', 'checkered', 'red', 'black', 'meatball', 'greenWhiteCheckered'].map((f) => ({ value: f, label: f }))
            ]}
            onChange={(v) => onChangeStyle({ flagKey: v || undefined })}
          />
        </div>
      )}

      {isImage && (
        <div className="overlay-builder-section">
          <div className="overlay-builder-section-title">Image</div>
          <button className="primary-action" onClick={() => fileInputRef.current?.click()}>Escolher imagem…</button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              void fileToDataUrl(file).then((url) => onChangeStyle({ src: url })).catch(() => undefined)
            }}
          />
          <TextField label="URL or data: URL" value={s.src ?? ''} onChange={(v) => onChangeStyle({ src: v || undefined })} placeholder="data:image/png;base64,…" />
          {s.src && <button className="ghost-action danger" onClick={() => onChangeStyle({ src: undefined })}>Remove image</button>}
          <div className="designer-grid-2">
            <SelectField label="Fit" value={s.fit ?? 'contain'} options={[{ value: 'contain', label: 'contain' }, { value: 'cover', label: 'cover' }, { value: 'fill', label: 'fill' }, { value: 'none', label: 'none' }]} onChange={(v) => onChangeStyle({ fit: v as 'contain' | 'cover' | 'fill' | 'none' })} />
            <NumberField label="Opacity" value={s.opacity ?? 1} onChange={(v) => onChangeStyle({ opacity: Math.max(0, Math.min(1, v)) })} min={0} max={1} step={0.05} />
          </div>
          <div className="overlay-builder-section-title">Filtros</div>
          <div className="overlay-builder-slot-tabs">
            {IMAGE_FILTER_PRESETS.map((p) => (
              <button key={p.id} className="ghost-action" onClick={() => onChangeStyle(p.patch)}>{p.label}</button>
            ))}
          </div>
          <div className="designer-grid-2">
            <SliderField label="B&W" value={s.filterGrayscale ?? 0} onChange={(v) => onChangeStyle({ filterGrayscale: v || undefined })} min={0} max={1} step={0.05} />
            <SliderField label="Red" value={s.redTint ?? 0} onChange={(v) => onChangeStyle({ redTint: v || undefined })} min={0} max={1} step={0.05} />
            <SliderField label="Sepia" value={s.filterSepia ?? 0} onChange={(v) => onChangeStyle({ filterSepia: v || undefined })} min={0} max={1} step={0.05} />
            <SliderField label="Invert" value={s.invert ?? 0} onChange={(v) => onChangeStyle({ invert: v || undefined })} min={0} max={1} step={0.05} />
            <SliderField label="Brightness" value={s.brightness ?? 1} onChange={(v) => onChangeStyle({ brightness: v === 1 ? undefined : v })} min={0} max={2} step={0.05} />
            <SliderField label="Contrast" value={s.contrast ?? 1} onChange={(v) => onChangeStyle({ contrast: v === 1 ? undefined : v })} min={0} max={2} step={0.05} />
            <SliderField label="Saturation" value={s.saturate ?? 1} onChange={(v) => onChangeStyle({ saturate: v === 1 ? undefined : v })} min={0} max={3} step={0.05} />
            <SliderField label="Matiz (°)" value={s.hueRotate ?? 0} onChange={(v) => onChangeStyle({ hueRotate: v || undefined })} min={-180} max={180} step={1} />
            <SliderField label="Blur (px)" value={s.blur ?? 0} onChange={(v) => onChangeStyle({ blur: v || undefined })} min={0} max={10} step={0.5} />
          </div>
        </div>
      )}

      {slots.length > 0 && <SlotEditor element={element} slots={slots} onChangeStyle={onChangeStyle} />}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="ghost-action" onClick={onDuplicate}>Duplicar</button>
        <button className="ghost-action danger" onClick={onRemove}>Remove widget</button>
      </div>
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────
export interface OverlayWidgetBuilderProps {
  initial: CustomOverlayDef
  editing: boolean
  busy?: boolean
  showTriggerOnlyActive: boolean
  onShowTriggerOnlyActiveChange(active: boolean): void
  triggerPreviewLabel: string
  triggerPreviewHelp: string
  alertsConfig?: AlertsConfig
  onSave(def: CustomOverlayDef): void
  onCancel(): void
}

export function OverlayWidgetBuilder({
  initial,
  editing,
  busy,
  showTriggerOnlyActive,
  onShowTriggerOnlyActiveChange,
  triggerPreviewLabel,
  triggerPreviewHelp,
  alertsConfig,
  onSave,
  onCancel
}: OverlayWidgetBuilderProps): ReactElement {
  const [def, setDef] = useState<CustomOverlayDef>(() => ({ ...initial, widgets: [...(initial.widgets ?? [])] }))
  const [selectedId, setSelectedId] = useState<string | null>(initial.widgets?.[0]?.id ?? null)
  const widgets = def.widgets ?? []
  const canvasWidth = def.canvasWidth ?? DEFAULT_RICH_OVERLAY_CANVAS.width
  const canvasHeight = def.canvasHeight ?? DEFAULT_RICH_OVERLAY_CANVAS.height
  const selected = widgets.find((w) => w.id === selectedId) ?? null

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const patchDef = useCallback((patch: Partial<CustomOverlayDef>): void => {
    setDef((cur) => ({ ...cur, ...patch }))
  }, [])

  const setWidgets = useCallback((next: DashboardElement[]): void => {
    setDef((cur) => ({ ...cur, widgets: next }))
  }, [])

  const addVariant = useCallback((variant: WidgetVariant): void => {
    setDef((cur) => {
      const list = cur.widgets ?? []
      const n = list.length
      const cw = cur.canvasWidth ?? DEFAULT_RICH_OVERLAY_CANVAS.width
      const ch = cur.canvasHeight ?? DEFAULT_RICH_OVERLAY_CANVAS.height
      const x = Math.min(40 + (n % 6) * 24, Math.max(0, cw - variant.w))
      const y = Math.min(40 + (n % 6) * 24, Math.max(0, ch - variant.h))
      const el = variantToElement(variant, x, y)
      setSelectedId(el.id)
      return { ...cur, widgets: [...list, el] }
    })
  }, [])

  const addImage = useCallback((): void => {
    setDef((cur) => {
      const list = cur.widgets ?? []
      const n = list.length
      const cw = cur.canvasWidth ?? DEFAULT_RICH_OVERLAY_CANVAS.width
      const ch = cur.canvasHeight ?? DEFAULT_RICH_OVERLAY_CANVAS.height
      const el: DashboardElement = {
        id: createElementId(),
        type: 'image',
        x: Math.min(40 + (n % 6) * 24, Math.max(0, cw - 240)),
        y: Math.min(40 + (n % 6) * 24, Math.max(0, ch - 135)),
        w: 240,
        h: 135,
        name: 'Image',
        style: { fit: 'contain', opacity: 1 }
      }
      setSelectedId(el.id)
      return { ...cur, widgets: [...list, el] }
    })
  }, [])

  const patchSelected = useCallback(
    (patch: Partial<DashboardElement>): void => {
      if (!selectedId) return
      setWidgets(widgets.map((w) => (w.id === selectedId ? { ...w, ...patch } : w)))
    },
    [selectedId, widgets, setWidgets]
  )

  const patchSelectedStyle = useCallback(
    (patch: BuilderStylePatch): void => {
      if (!selectedId) return
      setWidgets(widgets.map((w) => (w.id === selectedId ? { ...w, style: { ...w.style, ...patch } } : w)))
    },
    [selectedId, widgets, setWidgets]
  )

  const reorderSelected = useCallback(
    (direction: 'front' | 'back' | 'forward' | 'backward'): void => {
      if (!selectedId) return
      setWidgets(reorderElements(widgets, selectedId, direction))
    },
    [selectedId, widgets, setWidgets]
  )

  const duplicateSelected = useCallback((): void => {
    if (!selected) return
    const copy: DashboardElement = { ...selected, id: createElementId(), x: selected.x + 16, y: selected.y + 16, style: { ...selected.style } }
    setWidgets([...widgets, copy])
    setSelectedId(copy.id)
  }, [selected, widgets, setWidgets])

  const removeSelected = useCallback((): void => {
    if (!selectedId) return
    setWidgets(widgets.filter((w) => w.id !== selectedId))
    setSelectedId(null)
  }, [selectedId, widgets, setWidgets])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (!selectedId) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return
      e.preventDefault()
      removeSelected()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedId, removeSelected])

  const onGeometry = useCallback(
    (id: string, geo: { x: number; y: number; w: number; h: number }): void => {
      setWidgets(widgets.map((w) => (w.id === id ? { ...w, ...geo } : w)))
    },
    [widgets, setWidgets]
  )

  function handleSave(): void {
    // Keep window size in sync with the design canvas so the overlay opens 1:1.
    const next: CustomOverlayDef = {
      ...def,
      widgets,
      canvasWidth,
      canvasHeight,
      position: { ...def.position, width: canvasWidth, height: canvasHeight }
    }
    onSave(next)
  }

  return (
    <div className="overlay-designer-backdrop" role="dialog" aria-modal="true">
      <style>{OVERLAY_BUILDER_LAYOUT_CSS}</style>
      <div className="overlay-designer overlay-builder">
        <div className="overlay-designer-head">
          <h4>{editing ? 'Edit widget overlay' : 'Create new overlay (dashboard widgets)'}</h4>
          <button className="ghost-action" disabled={busy} onClick={onCancel}>Close</button>
        </div>

        <div className="overlay-builder-grid">
          <aside className="overlay-builder-palette">
            <label className="designer-field">
              Titulo
              <input type="text" value={def.title} maxLength={60} onChange={(e) => patchDef({ title: e.target.value })} />
            </label>
            <div className="designer-grid-2">
              <label className="designer-field">
                Canvas largura
                <input type="number" min={64} max={8000} value={canvasWidth} onChange={(e) => patchDef({ canvasWidth: Math.max(64, Math.min(8000, Math.round(Number(e.target.value)))) })} />
              </label>
              <label className="designer-field">
                Canvas altura
                <input type="number" min={64} max={8000} value={canvasHeight} onChange={(e) => patchDef({ canvasHeight: Math.max(64, Math.min(8000, Math.round(Number(e.target.value)))) })} />
              </label>
            </div>
            <div className="designer-settings">
              <label className="designer-check">
                <input type="checkbox" checked={def.enabled} onChange={(e) => patchDef({ enabled: e.target.checked })} />
                Show
              </label>
              <label className="designer-check">
                <input type="checkbox" checked={def.locked} onChange={(e) => patchDef({ locked: e.target.checked })} />
                Pinned (click-through)
              </label>
            </div>
            <label className="designer-field">
              Opacity · {def.opacity}%
              <input type="range" min={0} max={100} value={def.opacity} onChange={(e) => patchDef({ opacity: Number(e.target.value) })} />
            </label>
            <button className="ghost-action" onClick={addImage}>+ Image</button>
            <TriggerPreviewToggle
              checked={showTriggerOnlyActive}
              onChange={onShowTriggerOnlyActiveChange}
              label={triggerPreviewLabel}
              help={triggerPreviewHelp}
            />
            <div className="overlay-builder-gallery">
              <WidgetGallery
                onAdd={addVariant}
                busy={busy}
                showTriggerOnlyActive={showTriggerOnlyActive}
                alertsConfig={alertsConfig}
              />
            </div>
          </aside>

          <section className="overlay-builder-center">
            <BuilderCanvas
              widgets={widgets}
              canvasWidth={canvasWidth}
              canvasHeight={canvasHeight}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onGeometry={onGeometry}
              showTriggerOnlyActive={showTriggerOnlyActive}
              alertsConfig={alertsConfig}
            />
            <p className="overlay-help">
              {widgets.length} widget(s) · drag to move, pull the corners to resize. Preview with simulated telemetry.
            </p>
          </section>

          <aside className="overlay-builder-inspector">
            <Inspector
              element={selected}
              canvasWidth={canvasWidth}
              canvasHeight={canvasHeight}
              onChange={patchSelected}
              onChangeStyle={patchSelectedStyle}
              onReorder={reorderSelected}
              onDuplicate={duplicateSelected}
              onRemove={removeSelected}
            />
          </aside>
        </div>

        <div className="overlay-designer-foot">
          <button className="ghost-action" disabled={busy} onClick={onCancel}>Cancel</button>
          <button className="primary-action" disabled={busy || !def.title.trim()} onClick={handleSave}>
            {editing ? 'Save changes' : 'Create overlay'}
          </button>
        </div>
      </div>
    </div>
  )
}
