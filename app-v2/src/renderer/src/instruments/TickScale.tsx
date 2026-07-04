// ── TickScale ─────────────────────────────────────────────────────────────────
// A graduated tick scale around any arc sweep. Uses d3-shape (`line`) to build the
// tick-mark paths. Angle convention: degrees measured CLOCKWISE from 12 o'clock
// (0° = up). Major ticks optionally carry numeric labels mapped from [min,max].
// Pure + NaN-safe.
//
// Props: { cx, cy, radius, startAngleDeg, endAngleDeg, majorTicks?, minorPerMajor?,
//          min?, max?, color?, labelColor?, showLabels?, majorLen?, minorLen?,
//          decimals?, idPrefix? }

import { line } from 'd3-shape'
import { type ReactElement } from 'react'
import { clamp, fmtNum, safe, FONT_TECH } from './tokens'
import { INSTRUMENT_COLORS } from './tokens'

export interface TickScaleProps {
  cx: number
  cy: number
  radius: number
  startAngleDeg: number
  endAngleDeg: number
  majorTicks?: number
  minorPerMajor?: number
  min?: number
  max?: number
  color?: string
  labelColor?: string
  showLabels?: boolean
  majorLen?: number
  minorLen?: number
  decimals?: number
  idPrefix?: string
}

/** Point on a circle, degrees clockwise from 12 o'clock. */
export function pointOnArc(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const rad = (safe(angleDeg, 0) * Math.PI) / 180
  return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)]
}

export function TickScale({
  cx,
  cy,
  radius,
  startAngleDeg,
  endAngleDeg,
  majorTicks = 9,
  minorPerMajor = 4,
  min = 0,
  max = 100,
  color = INSTRUMENT_COLORS.text,
  labelColor = INSTRUMENT_COLORS.textDim,
  showLabels = true,
  majorLen,
  minorLen,
  decimals = 0,
  idPrefix
}: TickScaleProps): ReactElement {
  const r = Math.max(1, safe(radius, 1))
  const start = safe(startAngleDeg, -135)
  const end = safe(endAngleDeg, 135)
  const majors = Math.max(2, Math.min(64, Math.trunc(majorTicks) || 2))
  const minors = Math.max(0, Math.min(20, Math.trunc(minorPerMajor)))
  const mLen = majorLen ?? r * 0.16
  const nLen = minorLen ?? r * 0.09
  const lo = safe(min, 0)
  const hi = safe(max, 100)
  const path = line()

  const segments = majors - 1
  const elements: ReactElement[] = []

  for (let i = 0; i < majors; i++) {
    const frac = i / segments
    const angle = start + (end - start) * frac
    const [x1, y1] = pointOnArc(cx, cy, r, angle)
    const [x2, y2] = pointOnArc(cx, cy, r - mLen, angle)
    const dStr = path([
      [x1, y1],
      [x2, y2]
    ])
    elements.push(
      <path key={`maj-${i}`} d={dStr ?? undefined} stroke={color} strokeWidth={2} strokeLinecap="round" />
    )
    if (showLabels) {
      const [lx, ly] = pointOnArc(cx, cy, r - mLen - r * 0.13, angle)
      const value = lo + (hi - lo) * frac
      elements.push(
        <text
          key={`lbl-${i}`}
          x={lx}
          y={ly}
          fill={labelColor}
          fontSize={Math.max(6, r * 0.11)}
          fontFamily={FONT_TECH}
          fontWeight={600}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {fmtNum(value, clamp(decimals, 0, 4))}
        </text>
      )
    }
    // minor ticks between this major and the next
    if (i < majors - 1 && minors > 0) {
      for (let j = 1; j <= minors; j++) {
        const mf = (i + j / (minors + 1)) / segments
        const ma = start + (end - start) * mf
        const [mx1, my1] = pointOnArc(cx, cy, r, ma)
        const [mx2, my2] = pointOnArc(cx, cy, r - nLen, ma)
        const md = path([
          [mx1, my1],
          [mx2, my2]
        ])
        elements.push(
          <path
            key={`min-${i}-${j}`}
            d={md ?? undefined}
            stroke={color}
            strokeOpacity={0.55}
            strokeWidth={1}
            strokeLinecap="round"
          />
        )
      }
    }
  }

  return <g>{elements}</g>
}
