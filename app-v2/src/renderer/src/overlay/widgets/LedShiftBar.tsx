// Reusable, data-driven rev / shift-light LED rig — the signature element of a GT3
// steering-wheel cluster. Pure and deterministic: it renders the LED state for a
// given `pct`, so it slots into any cluster/overlay and into static-markup tests.
//
// Fidelity: each LED is individually modelled on the shared RevLedBar dome+bloom
// material (instruments/defs) — a per-LED dark stroke + a diffuse radial "off"
// muscle for unlit LEDs, a radial-gradient "on" dome for lit LEDs, and an
// feGaussianBlur LED-bloom that overflows the LED so lit LEDs read as glowing domes
// rather than flat fills. Bloom is applied to LIT LEDs only and backed by a single
// shared filter def, so the hot path stays cheap. The redline `blink` is still a
// class hook + full-flash white state; the consumer owns the CSS keyframes
// (e.g. `.led-shift-bar.is-blink { animation… }`). The public prop contract is
// unchanged, so every widget that renders <LedShiftBar> upgrades automatically.

import type { CSSProperties, ReactElement } from 'react'
import { bloomFilter, ledOffGradient, ledOnGradient, useUid } from '../../instruments'

export interface LedShiftZone {
  /** Fraction of the bar in [0,1] where this colour zone begins. */
  at: number
  color: string
}

export const DEFAULT_SHIFT_ZONES: LedShiftZone[] = [
  { at: 0, color: '#13c27b' },
  { at: 0.55, color: '#ffb000' },
  { at: 0.82, color: '#ff2d2d' }
]

export const REDLINE_FLASH_COLOR = '#ffffff'

export interface LedShiftBarProps {
  /** Shift-light band position, 0..1 (use telemetry `shiftIndicatorPct`). */
  pct: number
  /** LED count (GT3 wheels typically run 10–16). */
  segments?: number
  /** Redline blink — when true every LED flashes the redline colour. */
  blink?: boolean
  /** Colour stops, ascending by `at`. Defaults to green → amber → red. */
  zones?: LedShiftZone[]
  /** Opacity of an unlit LED. */
  dimOpacity?: number
  /** Bar height in px (it stretches to the container width). */
  height?: number
  className?: string
  style?: CSSProperties
}

const CELL = 10
const GAP = 2

export function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0
  return Math.min(1, Math.max(0, pct))
}

export function litCount(pct: number, segments: number): number {
  return Math.round(clampPct(pct) * segments)
}

export function zoneColorAt(frac: number, zones: LedShiftZone[] = DEFAULT_SHIFT_ZONES): string {
  let color = zones[0]?.color ?? DEFAULT_SHIFT_ZONES[0].color
  for (const zone of zones) {
    if (frac >= zone.at) color = zone.color
  }
  return color
}

export function LedShiftBar({
  pct,
  segments = 15,
  blink = false,
  zones = DEFAULT_SHIFT_ZONES,
  dimOpacity = 0.16,
  height = 16,
  className,
  style
}: LedShiftBarProps): ReactElement {
  const uid = useUid()
  const count = Math.max(1, Math.floor(segments))
  const lit = litCount(pct, count)
  const vbWidth = count * CELL

  // LED geometry within each 10px cell (GAP between neighbours). Rounded-rect LEDs
  // keep the bar stretchable (preserveAspectRatio="none") while the radial "on"
  // gradient gives each lit LED a domed sheen.
  const ledW = CELL - GAP
  const y = 2
  const h = Math.max(1, height - 4)
  const rx = Math.min(ledW, h) * 0.3
  const bloomStd = Math.max(0.8, Math.min(ledW, h) * 0.5)

  const offId = `${uid}-off`
  const bloomId = `${uid}-bloom`

  const meta = Array.from({ length: count }, (_, i) => {
    const frac = count === 1 ? 0 : i / (count - 1)
    const isLit = blink ? true : i < lit
    const color = blink ? REDLINE_FLASH_COLOR : zoneColorAt(frac, zones)
    return { i, isLit, color }
  })
  // One "on" gradient per distinct lit colour (shared across identical LEDs).
  const onColors = Array.from(new Set(meta.filter((m) => m.isLit).map((m) => m.color)))
  const onGradId = (c: string): string => `${uid}-on-${onColors.indexOf(c)}`
  const litLeds = meta.filter((m) => m.isLit)
  const unlitLeds = meta.filter((m) => !m.isLit)

  const rootClass = ['led-shift-bar', blink ? 'is-blink' : '', className].filter(Boolean).join(' ')

  return (
    <svg
      className={rootClass}
      viewBox={`0 0 ${vbWidth} ${height}`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
      aria-hidden="true"
      style={style}
    >
      <defs>
        {ledOffGradient(offId, '#0a0a0a')}
        {onColors.map((c) => (
          <g key={c}>{ledOnGradient(onGradId(c), c)}</g>
        ))}
        {litLeds.length ? bloomFilter(bloomId, bloomStd, 1) : null}
      </defs>
      {/* Unlit: diffuse radial "off" muscle + dark stroke, dimmed, no bloom. */}
      {unlitLeds.map(({ i }) => (
        <rect
          key={`off-${i}`}
          x={i * CELL}
          y={y}
          width={ledW}
          height={h}
          rx={rx}
          fill={`url(#${offId})`}
          stroke="#1a1a1a"
          strokeWidth={0.6}
          opacity={dimOpacity}
        />
      ))}
      {/* Bloom: ONE shared gaussian-blur layer behind ALL lit LEDs (a single blur
          region per frame, not one filter per LED — bounded 60 Hz cost). */}
      {litLeds.length ? (
        <g filter={`url(#${bloomId})`}>
          {litLeds.map(({ i, color }) => (
            <rect key={`glow-${i}`} x={i * CELL} y={y} width={ledW} height={h} rx={rx} fill={color} />
          ))}
        </g>
      ) : null}
      {/* Lit domes drawn sharp on top of the shared bloom. */}
      {litLeds.map(({ i, color }) => (
        <rect
          key={`on-${i}`}
          x={i * CELL}
          y={y}
          width={ledW}
          height={h}
          rx={rx}
          fill={`url(#${onGradId(color)})`}
          stroke={blink ? REDLINE_FLASH_COLOR : color}
          strokeWidth={0.75}
        />
      ))}
    </svg>
  )
}
