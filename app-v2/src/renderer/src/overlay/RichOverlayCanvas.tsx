import { Fragment, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { DashboardElement } from '../../../shared/dashboards'
import { sortElementsByZ } from '../../../shared/dashboards'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import { renderDashboardElement } from '../dashboard/DashboardRoot'
import { retainBindingIpc } from '../dashboard/binding'

// Renders a free-form canvas of dashboard widgets (DashboardElement[]) using the
// EXACT same element renderer the dashboards use (renderDashboardElement) — but
// over a transparent background and with NO dashboard backplate. The design
// canvas (canvasWidth × canvasHeight) is scaled to whatever box the component is
// placed in (the transparent overlay window, or the builder preview). This is the
// single reuse point that lets every dashboard widget + image + per-slot styling
// work inside an overlay without re-implementing the renderer.
//
// Importing renderDashboardElement also pulls dashboard-runtime.css (the `.dash-*`
// + GT3 widget styles) as a side effect, so the widgets render identically.

interface RichOverlayCanvasProps {
  widgets: DashboardElement[]
  canvasWidth: number
  canvasHeight: number
  snapshot: TelemetrySnapshot | null
  // 'stretch' → fill the box exactly (window resize maps 1:1 to the canvas).
  // 'fit'     → letterbox, preserving the canvas aspect ratio.
  scaleMode?: 'stretch' | 'fit'
  className?: string
}

export function RichOverlayCanvas({
  widgets,
  canvasWidth,
  canvasHeight,
  snapshot,
  scaleMode = 'stretch',
  className
}: RichOverlayCanvasProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState<{ w: number; h: number }>({ w: canvasWidth, h: canvasHeight })

  useEffect(() => retainBindingIpc(), [])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = (): void => setBox({ w: el.clientWidth || canvasWidth, h: el.clientHeight || canvasHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [canvasWidth, canvasHeight])

  const baseW = canvasWidth > 0 ? canvasWidth : 1
  const baseH = canvasHeight > 0 ? canvasHeight : 1
  const sx = box.w / baseW
  const sy = box.h / baseH
  let scaleX = sx
  let scaleY = sy
  let left = 0
  let top = 0
  if (scaleMode === 'fit') {
    const s = Math.min(sx, sy)
    scaleX = s
    scaleY = s
    left = Math.floor((box.w - baseW * s) / 2)
    top = Math.floor((box.h - baseH * s) / 2)
  }

  const canvasStyle: CSSProperties = {
    position: 'absolute',
    left,
    top,
    width: baseW,
    height: baseH,
    transformOrigin: '0 0',
    transform: scaleX === scaleY ? `scale(${scaleX})` : `scale(${scaleX}, ${scaleY})`,
    background: 'transparent'
  }

  const sorted = sortElementsByZ(widgets)

  return (
    <div
      ref={wrapRef}
      className={`rich-overlay-canvas${className ? ` ${className}` : ''}`}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: 'transparent' }}
    >
      <div className="dashboard-canvas" style={canvasStyle}>
        {sorted.map((element) => (
          <Fragment key={element.id}>{renderDashboardElement({ element, snapshot })}</Fragment>
        ))}
      </div>
    </div>
  )
}
