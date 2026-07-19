// Reusable FULL dashboard editing canvas.
//
// A self-contained editor surface that lets the user ADD widgets (from the shared
// catalog gallery), REMOLE, MOLE, RESIZE and CONFIGURE them on a scaled board —
// exactly the operations the normal builder offers. It is intentionally view-
// agnostic: it edits a plain `{ width, height, bg, elements }` board and reports
// changes through `onChange`. The per-moment FRAME editor (AdaptiveDashboardView)
// uses it to author a complete layout for a single race-moment, and the read-only
// surface (`DashboardCanvasSurface`) is shared with the AI Dashboard preview so
// both render widgets identically.
//
// Pure geometry math lives in shared/dashboard-layout.ts (unit-tested); this file
// only owns the React/pointer UI. Honors the warm-accent palette.

import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { DashboardElement, DashboardElementStyle } from '../../../../shared/dashboards'
import { sortElementsByZ } from '../../../../shared/dashboards'
import type { AlertsConfig } from '../../../../shared/alerts'
import {
  CANVAS_RESIZE_HANDLES,
  computeCanvasMove,
  computeCanvasResize,
  constrainCanvasGeometry,
  type CanvasGeometry,
  type CanvasResizeHandle
} from '../../../../shared/dashboard-layout'
import { renderGt3Widget } from '../../dashboard/widgets/gt3-widgets'
import { PREVIEW_SNAPSHOT } from '../../dashboard/widgets/gt3-theme'
import { renderDashboardElement } from '../../dashboard/DashboardRoot'
import { useUnitSystem } from '../../lib/units'
import { WidgetGallery, variantToElement, type WidgetVariant } from './widget-catalog'
import { resolveWidgetComponent } from '../../overlay/widgets'
import '../../dashboard/dashboard-runtime.css'

const CHROME = 'var(--accent-primary)'
const DANGER = 'var(--accent-danger)'

export interface EditableBoard {
  width: number
  height: number
  bg: string
  elements: DashboardElement[]
}

function cursorFor(handle: CanvasResizeHandle): string {
  const map: Record<CanvasResizeHandle, string> = {
    n: 'ns-resize',
    ne: 'nesw-resize',
    e: 'ew-resize',
    se: 'nwse-resize',
    s: 'ns-resize',
    sw: 'nesw-resize',
    w: 'ew-resize',
    nw: 'nwse-resize'
  }
  return map[handle]
}

function FallbackTile({ element }: { element: DashboardElement }): ReactElement {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--surface-sunken)',
        border: '1px solid var(--border-default)',
        color: 'var(--text-muted)',
        fontSize: 12,
        textAlign: 'center',
        padding: 4,
        boxSizing: 'border-box'
      }}
    >
      {element.name ?? element.type}
    </div>
  )
}

// ─── Single element rendering (shared, read-only) ────────────────────────────

/**
 * Render ONE element's visual at the origin. Defers to `renderGt3Widget`, which
 * covers EVERY renderable widget family (GT3, extra, telemetry, futuristic,
 * minimal, prediction, coach-heatmap, coach-engineer, curated metrics); only a
 * truly unknown type returns null and falls back to a labelled tile. This mirrors
 * what the live dashboard renders, so the editor canvas is faithfully WYSIWYG
 * (e.g. coach-heatmap previews live instead of showing a gray placeholder).
 *
 * The `overlaywidget` element family is mounted directly (mirroring DashboardRoot)
 * since `renderGt3Widget` dispatches only the semantic GT3 element types.
 */
export function CanvasElementVisual({
  element,
  showTriggerOnlyActive = false,
  alertsConfig
}: {
  element: DashboardElement
  showTriggerOnlyActive?: boolean
  alertsConfig?: AlertsConfig
}): ReactElement {
  const unitSystem = useUnitSystem()
  const norm: DashboardElement = { ...element, x: 0, y: 0 }
  if (element.type === 'overlaywidget') {
    const widgetId =
      element.widgetId ??
      (element.hifiModuleId
        ? (`hifi:${element.hifiModuleId}` as DashboardElement['widgetId'])
        : undefined)
    if (!widgetId || !resolveWidgetComponent(widgetId)) {
      return <FallbackTile element={element} />
    }
    return renderDashboardElement({
      element: norm,
      snapshot: PREVIEW_SNAPSHOT,
      preview: 'inert',
      alertsConfig,
      forceTriggerActive: showTriggerOnlyActive
    }) ?? <FallbackTile element={element} />
  }
  return renderGt3Widget({ element: norm, snapshot: PREVIEW_SNAPSHOT, unitSystem }) ?? <FallbackTile element={element} />
}

/**
 * Read-only board surface: paints every (visible) element in z-order on a scaled
 * board. Shared by the AI Dashboard preview and the canvas editor.
 */
export function DashboardCanvasSurface({
  board,
  maxWidth = 720,
  showTriggerOnlyActive = false,
  alertsConfig
}: {
  board: EditableBoard
  maxWidth?: number
  showTriggerOnlyActive?: boolean
  alertsConfig?: AlertsConfig
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(maxWidth)
  useEffect(() => {
    const measure = (): void => {
      if (ref.current) setWidth(ref.current.clientWidth)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  const scale = width / board.width
  const sorted = useMemo(() => sortElementsByZ(board.elements), [board.elements])
  return (
    <div
      ref={ref}
      style={{
        width: '100%',
        height: Math.round(board.height * scale),
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-default)'
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: board.width,
          height: board.height,
          background: board.bg || '#000',
          transform: `scale(${scale})`,
          transformOrigin: 'top left'
        }}
      >
        {sorted
          .filter((el) => el.visible !== false)
          .map((el) => (
            <div
              key={el.id}
              style={{
                position: 'absolute',
                left: el.x,
                top: el.y,
                width: el.w,
                height: el.h,
                borderRadius: el.style.radius ?? 8,
                overflow: 'hidden'
              }}
            >
              <CanvasElementVisual
                element={el}
                showTriggerOnlyActive={showTriggerOnlyActive}
                alertsConfig={alertsConfig}
              />
            </div>
          ))}
      </div>
    </div>
  )
}

// ─── Editable canvas ─────────────────────────────────────────────────────────

interface PointerEditState {
  elementId: string
  mode: 'move' | 'resize'
  handle?: CanvasResizeHandle
  pointerId: number
  startX: number
  startY: number
  start: CanvasGeometry
  scale: number
  step: number
}

export function DashboardCanvasEditor({
  board,
  onChange,
  maxWidth = 760,
  maxHeight = 460,
  showTriggerOnlyActive = false,
  alertsConfig
}: {
  board: EditableBoard
  onChange: (next: EditableBoard) => void
  maxWidth?: number
  maxHeight?: number
  showTriggerOnlyActive?: boolean
  alertsConfig?: AlertsConfig
}): ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [gridStep, setGridStep] = useState(8)
  const activeEdit = useRef<PointerEditState | null>(null)

  const selected = board.elements.find((el) => el.id === selectedId) ?? null
  const sorted = useMemo(() => sortElementsByZ(board.elements), [board.elements])

  const sx = maxWidth / board.width
  const sy = maxHeight / board.height
  const scale = Math.min(sx, sy)
  const viewW = Math.round(board.width * scale)
  const viewH = Math.round(board.height * scale)
  const snapStep = snapEnabled ? gridStep : 1
  const handleSize = Math.max(8, 10 / Math.max(scale, 0.01))

  const patchElements = useCallback(
    (elements: DashboardElement[]) => onChange({ ...board, elements }),
    [board, onChange]
  )

  const addVariant = useCallback(
    (variant: WidgetVariant) => {
      const seed = variantToElement(variant, 0, 0)
      const geom = constrainCanvasGeometry(
        {
          x: Math.round((board.width - seed.w) / 2),
          y: Math.round((board.height - seed.h) / 2),
          w: seed.w,
          h: seed.h
        },
        board
      )
      const el: DashboardElement = { ...seed, ...geom }
      patchElements([...board.elements, el])
      setSelectedId(el.id)
    },
    [board, patchElements]
  )

  const patchElement = useCallback(
    (id: string, patch: Partial<DashboardElement>) => {
      patchElements(board.elements.map((el) => (el.id === id ? { ...el, ...patch } : el)))
    },
    [board.elements, patchElements]
  )

  const patchStyle = useCallback(
    (id: string, stylePatch: Partial<DashboardElementStyle>) => {
      patchElements(
        board.elements.map((el) => (el.id === id ? { ...el, style: { ...el.style, ...stylePatch } } : el))
      )
    },
    [board.elements, patchElements]
  )

  const removeElement = useCallback(
    (id: string) => {
      patchElements(board.elements.filter((el) => el.id !== id))
      setSelectedId((cur) => (cur === id ? null : cur))
    },
    [board.elements, patchElements]
  )

  const setGeometry = useCallback(
    (id: string, geom: CanvasGeometry) => {
      patchElements(
        board.elements.map((el) =>
          el.id === id ? { ...el, x: geom.x, y: geom.y, w: geom.w, h: geom.h } : el
        )
      )
    },
    [board.elements, patchElements]
  )

  const beginEdit = useCallback(
    (event: ReactPointerEvent<HTMLElement>, el: DashboardElement, mode: 'move' | 'resize', handle?: CanvasResizeHandle) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      setSelectedId(el.id)
      event.currentTarget.setPointerCapture(event.pointerId)
      activeEdit.current = {
        elementId: el.id,
        mode,
        handle,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        start: { x: el.x, y: el.y, w: el.w, h: el.h },
        scale,
        step: snapStep
      }
    },
    [scale, snapStep]
  )

  const moveEdit = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const active = activeEdit.current
      if (!active || active.pointerId !== event.pointerId) return
      event.preventDefault()
      const dx = (event.clientX - active.startX) / active.scale
      const dy = (event.clientY - active.startY) / active.scale
      const step = event.altKey ? 1 : active.step
      const geom =
        active.mode === 'move'
          ? computeCanvasMove(active.start, dx, dy, board, step)
          : computeCanvasResize(active.start, active.handle ?? 'se', dx, dy, board, step)
      setGeometry(active.elementId, geom)
    },
    [board, setGeometry]
  )

  const endEdit = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const active = activeEdit.current
    if (!active || active.pointerId !== event.pointerId) return
    event.preventDefault()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    activeEdit.current = null
  }, [])

  useEffect(() => () => { activeEdit.current = null }, [])

  const gridBg =
    snapEnabled && gridStep > 1
      ? `repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0 1px, transparent 1px ${gridStep}px),
         repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 1px, transparent 1px ${gridStep}px)`
      : undefined

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) 1fr minmax(220px, 280px)', gap: 12 }}>
      {/* Left: widget gallery */}
      <div style={panel}>
        <h3 style={panelTitle}>Add widget</h3>
        <WidgetGallery
          onAdd={addVariant}
          showTriggerOnlyActive={showTriggerOnlyActive}
          alertsConfig={alertsConfig}
        />
      </div>

      {/* Center: canvas */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, alignSelf: 'stretch', flexWrap: 'wrap' }}>
          <label style={toolLabel}>
            <input type="checkbox" checked={snapEnabled} onChange={(e) => setSnapEnabled(e.target.checked)} /> Snap
          </label>
          {snapEnabled && (
            <select value={gridStep} onChange={(e) => setGridStep(Number(e.target.value))} style={selectStyle}>
              {[4, 8, 16, 24, 32].map((s) => (
                <option key={s} value={s}>
                  {s}px
                </option>
              ))}
            </select>
          )}
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Alt = free movement · {board.elements.length} widget(s)</span>
        </div>

        <div
          onPointerDown={() => setSelectedId(null)}
          style={{
            width: viewW,
            height: viewH,
            background: board.bg || '#000',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)',
            position: 'relative',
            overflow: 'hidden',
            userSelect: 'none',
            touchAction: 'none'
          }}
        >
          <div
            style={{
              width: board.width,
              height: board.height,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              position: 'absolute',
              left: 0,
              top: 0,
              backgroundImage: gridBg,
              backgroundSize: gridBg ? `${gridStep}px ${gridStep}px` : undefined
            }}
          >
            {sorted.map((el) => (
              <CanvasEditableElement
                key={el.id}
                element={el}
                selected={el.id === selectedId}
                handleSize={handleSize}
                onSelect={() => setSelectedId(el.id)}
                onBodyPointerDown={(e) => beginEdit(e, el, 'move')}
                onHandlePointerDown={(e, h) => beginEdit(e, el, 'resize', h)}
                onPointerMove={moveEdit}
                onPointerUp={endEdit}
                onPointerCancel={endEdit}
                showTriggerOnlyActive={showTriggerOnlyActive}
                alertsConfig={alertsConfig}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Right: inspector */}
      <div style={panel}>
        <h3 style={panelTitle}>Propriedades</h3>
        {!selected ? (
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 12 }}>
            Select a widget on the canvas to configure, or add one from the gallery.
          </p>
        ) : (
          <Inspector
            element={selected}
            onPatch={(patch) => patchElement(selected.id, patch)}
            onPatchStyle={(patch) => patchStyle(selected.id, patch)}
            onRemove={() => removeElement(selected.id)}
            board={board}
          />
        )}
      </div>
    </div>
  )
}

function CanvasEditableElement({
  element,
  selected,
  handleSize,
  onSelect,
  onBodyPointerDown,
  onHandlePointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  showTriggerOnlyActive,
  alertsConfig
}: {
  element: DashboardElement
  selected: boolean
  handleSize: number
  onSelect: () => void
  onBodyPointerDown: (e: ReactPointerEvent<HTMLElement>) => void
  onHandlePointerDown: (e: ReactPointerEvent<HTMLElement>, handle: CanvasResizeHandle) => void
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void
  showTriggerOnlyActive: boolean
  alertsConfig?: AlertsConfig
}): ReactElement {
  const dimmed = element.visible === false
  return (
    <div
      onClick={onSelect}
      onPointerDown={onBodyPointerDown}
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
        outline: selected ? `2px dashed ${CHROME}` : undefined,
        outlineOffset: 2,
        opacity: dimmed ? 0.35 : 1,
        touchAction: 'none',
        zIndex: element.style.zIndex ?? 0
      }}
    >
      <CanvasElementVisual
        element={element}
        showTriggerOnlyActive={showTriggerOnlyActive}
        alertsConfig={alertsConfig}
      />
      {selected &&
        CANVAS_RESIZE_HANDLES.map((h) => (
          <div
            key={h}
            onPointerDown={(e) => onHandlePointerDown(e, h)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            style={resizeHandleStyle(h, handleSize)}
          />
        ))}
    </div>
  )
}

function resizeHandleStyle(handle: CanvasResizeHandle, size: number): CSSProperties {
  const half = size / 2
  const style: CSSProperties = {
    position: 'absolute',
    width: size,
    height: size,
    background: CHROME,
    border: '1px solid #05070a',
    borderRadius: 4,
    cursor: cursorFor(handle),
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

// ─── Inspector ───────────────────────────────────────────────────────────────

function Inspector({
  element,
  onPatch,
  onPatchStyle,
  onRemove,
  board
}: {
  element: DashboardElement
  onPatch: (patch: Partial<DashboardElement>) => void
  onPatchStyle: (patch: Partial<DashboardElementStyle>) => void
  onRemove: () => void
  board: EditableBoard
}): ReactElement {
  const num = (v: number): number => (Number.isFinite(v) ? v : 0)
  const setGeom = (patch: Partial<CanvasGeometry>): void => {
    const geom = constrainCanvasGeometry(
      { x: element.x, y: element.y, w: element.w, h: element.h, ...patch },
      board
    )
    onPatch({ x: geom.x, y: geom.y, w: geom.w, h: geom.h })
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <strong style={{ flex: 1, color: 'var(--text-primary)', fontSize: 13 }}>
          {element.name ?? element.style.label ?? element.type}
        </strong>
        <span style={{ color: 'var(--text-muted)', fontSize: 10, fontFamily: 'monospace' }}>{element.type}</span>
      </div>

      <Field label="Name">
        <input
          type="text"
          value={element.name ?? ''}
          onChange={(e) => onPatch({ name: e.target.value || undefined })}
          style={inputStyle}
        />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field label="X">
          <input type="number" value={num(element.x)} onChange={(e) => setGeom({ x: Number(e.target.value) })} style={inputStyle} />
        </Field>
        <Field label="Y">
          <input type="number" value={num(element.y)} onChange={(e) => setGeom({ y: Number(e.target.value) })} style={inputStyle} />
        </Field>
        <Field label="Width">
          <input type="number" value={num(element.w)} onChange={(e) => setGeom({ w: Number(e.target.value) })} style={inputStyle} />
        </Field>
        <Field label="Height">
          <input type="number" value={num(element.h)} onChange={(e) => setGeom({ h: Number(e.target.value) })} style={inputStyle} />
        </Field>
      </div>

      <Field label="Binding (channel)">
        <input
          type="text"
          value={element.binding ?? ''}
          placeholder="ex.: speedKmh"
          onChange={(e) => onPatch({ binding: e.target.value || undefined })}
          style={inputStyle}
        />
      </Field>

      <Field label="Rotulo / titulo">
        <input
          type="text"
          value={element.style.title ?? element.style.label ?? ''}
          onChange={(e) => onPatchStyle({ label: e.target.value || undefined, title: e.target.value || undefined })}
          style={inputStyle}
        />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field label="Accent color">
          <input
            type="color"
            value={element.style.accentColor ?? '#FF7A00'}
            onChange={(e) => onPatchStyle({ accentColor: e.target.value })}
            style={colorStyle}
          />
        </Field>
        <Field label="Text color">
          <input
            type="color"
            value={element.style.color ?? '#F4F4F4'}
            onChange={(e) => onPatchStyle({ color: e.target.value })}
            style={colorStyle}
          />
        </Field>
      </div>

      <Field label="Z-order">
        <input
          type="number"
          value={element.style.zIndex ?? 0}
          onChange={(e) => onPatchStyle({ zIndex: Number(e.target.value) })}
          style={inputStyle}
        />
      </Field>

      <label style={toolLabel}>
        <input
          type="checkbox"
          checked={element.visible !== false}
          onChange={(e) => onPatch({ visible: e.target.checked ? undefined : false })}
        />
        Lisivel
      </label>

      <button type="button" onClick={onRemove} style={dangerBtn}>
        Remove widget
      </button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactElement }): ReactElement {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 700 }}>{label}</span>
      {children}
    </label>
  )
}

// ─── styles ──────────────────────────────────────────────────────────────────

const panel: CSSProperties = {
  background: 'var(--surface-sunken)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  padding: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  maxHeight: 520,
  overflowY: 'auto'
}

const panelTitle: CSSProperties = { margin: 0, fontSize: 13, color: 'var(--text-primary)' }

const toolLabel: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  color: 'var(--text-secondary)',
  cursor: 'pointer'
}

const inputStyle: CSSProperties = {
  background: 'var(--surface-base)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-default)',
  borderRadius: 6,
  padding: '5px 8px',
  fontSize: 12,
  width: '100%',
  boxSizing: 'border-box'
}

const colorStyle: CSSProperties = {
  width: '100%',
  height: 28,
  padding: 0,
  border: '1px solid var(--border-default)',
  borderRadius: 6,
  background: 'transparent',
  cursor: 'pointer'
}

const selectStyle: CSSProperties = {
  background: 'var(--surface-base)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-default)',
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: 12
}

const dangerBtn: CSSProperties = {
  background: 'transparent',
  color: DANGER,
  border: `1px solid ${DANGER}`,
  borderRadius: 6,
  padding: '6px 12px',
  fontWeight: 700,
  cursor: 'pointer',
  marginTop: 4
}
