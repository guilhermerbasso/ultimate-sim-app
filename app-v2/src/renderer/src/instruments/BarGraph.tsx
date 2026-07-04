// BarGraph — a labelled, scaled telemetry bar (horizontal or vertical) with
// ok→warn→crit colour ramp, optional ticks, and an auto-fit value readout.
// Renders as a nested <svg x y width height viewBox> so it drops into any parent
// widget SVG at a grid cell (or stands alone). Consumes a skin token only.
import { type ReactElement } from 'react'
import type { SkinToken } from '../skins/tokens'
import { FitText } from '../skins/FitText'

export interface BarGraphProps {
  x?: number
  y?: number
  width: number
  height: number
  /** Fill fraction 0..1 (NaN/undefined → 0). */
  fraction: number
  label?: string
  /** Preformatted value (e.g. "28.4"). */
  valueText?: string
  unit?: string
  orientation?: 'h' | 'v'
  /** Fraction thresholds; ≥ warnAt → warn colour, ≥ critAt → crit colour. */
  warnAt?: number
  critAt?: number
  /** Invert severity (low is bad, e.g. fuel): ≤ warnAt → warn, ≤ critAt → crit. */
  invert?: boolean
  showTicks?: number
  skin: SkinToken
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0
}

export function BarGraph({
  x = 0,
  y = 0,
  width,
  height,
  fraction,
  label,
  valueText,
  unit,
  orientation = 'h',
  warnAt,
  critAt,
  invert = false,
  showTicks,
  skin
}: BarGraphProps): ReactElement {
  const f = clamp01(fraction)
  const { palette, typography, material, segment } = skin

  const severe = (frac: number, at?: number): boolean =>
    at === undefined ? false : invert ? frac <= at : frac >= at
  const fillColor = severe(f, critAt) ? palette.crit : severe(f, warnAt) ? palette.warn : palette.ok

  const pad = Math.max(2, Math.min(width, height) * 0.06)
  const hasLabelRow = Boolean(label || valueText)
  const labelH = hasLabelRow && orientation === 'h' ? Math.min(height * 0.42, 22) : 0

  // Track geometry.
  const tx = pad
  const ty = pad + labelH
  const tw = Math.max(1, width - pad * 2)
  const th = Math.max(1, height - pad * 2 - labelH)

  let fillRect: { x: number; y: number; w: number; h: number }
  if (orientation === 'v') {
    const fh = th * f
    fillRect = { x: tx, y: ty + (th - fh), w: tw, h: fh }
  } else {
    fillRect = { x: tx, y: ty, w: tw * f, h: th }
  }

  const ticks =
    showTicks && showTicks > 1
      ? Array.from({ length: showTicks }, (_, i) => i / (showTicks - 1))
      : []

  return (
    <svg x={x} y={y} width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', overflow: 'visible' }}>
      {hasLabelRow && orientation === 'h' && (
        <>
          {label && (
            <FitText
              x={tx}
              y={pad + labelH / 2}
              boxW={tw * 0.62}
              boxH={labelH}
              text={label.toUpperCase()}
              anchor="start"
              fontFamily={typography.label}
              fill={palette.textDim}
              minFontPx={9}
              maxFontPx={labelH}
              weight={600}
            />
          )}
          {valueText && (
            <FitText
              x={tx + tw}
              y={pad + labelH / 2}
              boxW={tw * 0.42}
              boxH={labelH}
              text={unit ? `${valueText}${unit}` : valueText}
              anchor="end"
              fontFamily={segment.numeric}
              fill={palette.text}
              minFontPx={10}
              maxFontPx={labelH}
            />
          )}
        </>
      )}
      {/* track */}
      <rect x={tx} y={ty} width={tw} height={th} rx={Math.min(4, th / 2)} fill={material.base} stroke={material.border} strokeWidth={1} />
      {/* fill */}
      {f > 0 && (
        <rect
          x={fillRect.x}
          y={fillRect.y}
          width={Math.max(0, fillRect.w)}
          height={Math.max(0, fillRect.h)}
          rx={Math.min(4, th / 2)}
          fill={fillColor}
        />
      )}
      {/* ticks */}
      {ticks.map((t, i) =>
        orientation === 'h' ? (
          <line key={i} x1={tx + tw * t} y1={ty} x2={tx + tw * t} y2={ty + th} stroke={palette.bg} strokeWidth={1} opacity={0.5} />
        ) : (
          <line key={i} x1={tx} y1={ty + th * (1 - t)} x2={tx + tw} y2={ty + th * (1 - t)} stroke={palette.bg} strokeWidth={1} opacity={0.5} />
        )
      )}
    </svg>
  )
}
