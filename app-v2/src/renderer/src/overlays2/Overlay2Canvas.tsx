import { type CSSProperties, type ReactElement } from 'react'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import type { OverlayDesignFamily } from '../../../shared/overlays'
import { MatrixWidget } from '../widgets2'
import { overlay2FamilyStyle } from './familyStyle'
import type { Overlay2Def } from './catalog'

export interface Overlay2CanvasProps {
  overlay: Overlay2Def
  family: OverlayDesignFamily
  snapshot: TelemetrySnapshot
  width?: number
  height?: number
}

function safeSize(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function columnsFor(count: number, width: number): number {
  if (count <= 2) return count
  if (width >= 680) return Math.min(4, count)
  if (width >= 460) return Math.min(3, count)
  return Math.min(2, count)
}

export interface Overlay2CanvasGridMetrics {
  columns: number
  rows: number
  widgetWidth: number
  widgetHeight: number
}

export function overlay2CanvasGridMetrics(
  count: number,
  width: number,
  height: number,
  padding: number,
  gap: number
): Overlay2CanvasGridMetrics {
  const columns = Math.max(1, columnsFor(count, width))
  const rows = Math.max(1, Math.ceil(count / columns))
  const usableWidth = Math.max(1, width - padding * 2 - gap * Math.max(0, columns - 1))
  const usableHeight = Math.max(1, height - padding * 2 - gap * Math.max(0, rows - 1))
  return {
    columns,
    rows,
    widgetWidth: Math.max(1, Math.floor(usableWidth / columns)),
    widgetHeight: Math.max(1, Math.floor(usableHeight / rows))
  }
}

export function Overlay2Canvas({
  overlay,
  family,
  snapshot,
  width,
  height
}: Overlay2CanvasProps): ReactElement {
  const style = overlay2FamilyStyle(family)
  const safeWidth = safeSize(width, overlay.w)
  const safeHeight = safeSize(height, overlay.h)
  const count = Math.max(1, overlay.specIds.length)
  const { columns, rows, widgetWidth, widgetHeight } = overlay2CanvasGridMetrics(
    count,
    safeWidth,
    safeHeight,
    style.padding,
    style.gap
  )

  const rootStyle: CSSProperties = {
    width: safeWidth,
    height: safeHeight,
    boxSizing: 'border-box',
    display: 'grid',
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
    gap: style.gap,
    padding: style.padding,
    borderRadius: style.radius,
    background: style.background,
    border: style.border,
    boxShadow: style.boxShadow,
    color: style.colors.text,
    fontFamily: style.fontFamily,
    overflow: 'hidden'
  }

  const cellStyle: CSSProperties = {
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: 'stretch'
  }

  return (
    <section data-overlay2-id={overlay.id} data-overlay2-family={family} style={rootStyle}>
      {overlay.specIds.map((specId) => (
        <div key={specId} data-overlay2-spec={specId} style={cellStyle}>
          <MatrixWidget specId={specId} snapshot={snapshot} width={widgetWidth} height={widgetHeight} colors={style.colors} />
        </div>
      ))}
    </section>
  )
}
