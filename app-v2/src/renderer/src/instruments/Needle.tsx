// ── Needle ────────────────────────────────────────────────────────────────────
// A tapered gauge needle with a counterweight tail and a hub cap. Renders a <g>
// (compose inside an <svg>, e.g. AnalogDial). Angle is degrees CLOCKWISE from 12
// o'clock (same convention as TickScale). Pure.
//
// Props: { cx, cy, length, angleDeg, color?, width?, tail?, hubRadius?, idPrefix? }

import { type ReactElement } from 'react'
import { INSTRUMENT_COLORS, safe } from './tokens'

export interface NeedleProps {
  cx: number
  cy: number
  /** Length from hub to tip in px. */
  length: number
  /** Rotation in degrees clockwise from 12 o'clock. */
  angleDeg: number
  color?: string
  /** Base width of the needle in px (default ~ length*0.05). */
  width?: number
  /** Counterweight tail length in px (default ~ length*0.22). */
  tail?: number
  hubRadius?: number
  idPrefix?: string
}

export function Needle({
  cx,
  cy,
  length,
  angleDeg,
  color = INSTRUMENT_COLORS.accent,
  width,
  tail,
  hubRadius
}: NeedleProps): ReactElement {
  const len = Math.max(1, safe(length, 1))
  const w = Math.max(1, width ?? len * 0.05)
  const tl = Math.max(0, tail ?? len * 0.22)
  const hub = Math.max(1, hubRadius ?? w * 1.6)
  const angle = safe(angleDeg, 0)

  // Built pointing up (−y); rotate into place around the hub.
  const tip = -len
  const base = tl
  const points = [
    `0,${tip}`,
    `${w / 2},${-len * 0.12}`,
    `${w * 0.7},${base}`,
    `${-w * 0.7},${base}`,
    `${-w / 2},${-len * 0.12}`
  ].join(' ')

  return (
    <g transform={`translate(${cx},${cy}) rotate(${angle})`}>
      <polygon points={points} fill={color} />
      <circle cx={0} cy={0} r={hub} fill="#0a0a0a" stroke={color} strokeWidth={1.5} />
      <circle cx={0} cy={0} r={Math.max(0.5, hub * 0.35)} fill={color} />
    </g>
  )
}
