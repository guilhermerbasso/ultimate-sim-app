// ── RevLedBar ─────────────────────────────────────────────────────────────────
// A rev/shift LED bar of individually-modelled LEDs:
//   • dark stroke + diffuse radial "off" muscle for unlit LEDs,
//   • radial-gradient "on" dome + an feGaussianBlur LED-bloom for lit LEDs,
//   • green → amber → red zone ramp keyed by each LED's position,
//   • one shared shift state: every LED turns strong blue and strobes uniformly.
// Pure + NaN-safe. Composes inside a parent widget <svg> via optional x/y (renders
// a nested <svg>), or standalone. Accepts a skin `LedProfile` which drives
// count / zones / shape / redline colour / mirrored fill / bloom in one object.
//
// Backward compatible: every pre-existing prop keeps its meaning and defaults.

import { type ReactElement } from 'react'
import type { LedProfile } from '../skins/tokens'
import {
  SHIFT_STROBE_BLUE,
  ShiftStrobe,
  atShiftPoint,
  revLightRowLayout
} from '../lib/rev-lights'
import {
  clamp01,
  resolveColors,
  revZoneColor,
  type InstrumentColors
} from './tokens'
import { bloomFilter, ledOffGradient, ledOnGradient, useUid } from './defs'

export type LedShape = 'led' | 'bar' | 'trapezoid'

export interface RevLedBarProps {
  /** Overall rev fraction, 0..1 (NaN/undefined → 0). */
  pct: number
  /** Number of LED segments (default 15). */
  segments?: number
  /** LED geometry (default 'led'). */
  shape?: LedShape
  /** Overall width/height in px (defaults 300×34). */
  width?: number
  height?: number
  /** Position when nested inside a parent widget <svg> (default 0,0). */
  x?: number
  y?: number
  /** Gap between LEDs in px (default 4). */
  gap?: number
  /** green→amber boundary fraction across the bar (default 0.55). */
  warnAt?: number
  /** amber→red boundary fraction across the bar (default 0.8). */
  dangerAt?: number
  /** redline-flash threshold fraction (default 0.97). */
  flashAt?: number
  /** enable the redline flash behaviour (default true). */
  redlineFlash?: boolean
  /** @deprecated The shared SVG strobe owns its animation phase. */
  flashOn?: boolean
  /** @deprecated Shift-point colour is always the shared strong blue. */
  redlineColor?: string
  /** Explicit provider shift/blink state; the shared threshold still applies. */
  shiftActive?: boolean
  /** fill from the centre outward (Porsche/AiM) instead of left→right. */
  mirrored?: boolean
  /** Override the per-LED zone colours by ascending boundary fraction. */
  zones?: Array<{ at: number; color: string }>
  /** Render the LED bloom glow (default true). */
  glow?: boolean
  /** Bloom strength as a fraction of LED radius (default 0.35). */
  bloom?: number
  /** Skin LED profile — when set, drives count/zones/shape/redline/mirror/bloom. */
  profile?: LedProfile
  colors?: Partial<InstrumentColors>
  idPrefix?: string
}

function zoneColorFor(
  ledFrac: number,
  colors: InstrumentColors,
  warnAt: number,
  dangerAt: number,
  zones?: Array<{ at: number; color: string }>
): string {
  if (zones && zones.length) {
    let picked = zones[0].color
    for (const z of zones) {
      if (ledFrac >= clamp01(z.at)) picked = z.color
    }
    return picked
  }
  return revZoneColor(ledFrac, colors, warnAt, dangerAt)
}

export function RevLedBar({
  pct,
  segments = 15,
  shape = 'led',
  width = 300,
  height = 34,
  x = 0,
  y = 0,
  gap = 4,
  warnAt = 0.55,
  dangerAt = 0.8,
  flashAt = 0.97,
  redlineFlash = true,
  shiftActive = false,
  mirrored = false,
  zones,
  glow = true,
  bloom = 0.35,
  profile,
  colors: colorOverrides,
  idPrefix
}: RevLedBarProps): ReactElement {
  const uid = useUid(idPrefix)
  const colors = resolveColors(colorOverrides)

  // Skin profile (when provided) maps onto the primitive's knobs. LedProfile.zones
  // use UPPER-bound semantics (upTo = where a colour ENDS), but zoneColorFor below
  // is LOWER-bound (pick the last zone whose `at` ≤ ledFrac), so convert: each
  // zone starts at the PREVIOUS zone's upTo (0 for the first). Without this the
  // whole bar shifts up a full zone (green until ~80%, red only in the top 2%).
  const effSegments = profile ? profile.count : segments
  const effShape: LedShape = profile ? (profile.shape === 'round' ? 'led' : 'bar') : shape
  const effZones = profile
    ? profile.zones.map((z, i) => ({ at: i === 0 ? 0 : profile.zones[i - 1].upTo, color: z.color }))
    : zones
  const effMirror = profile ? profile.mirrored : mirrored
  const effGlow = profile ? profile.bloom : glow
  const bloomStrength = Number.isFinite(bloom) ? Math.max(0, bloom) : 0.35
  const n = Math.max(1, Math.min(64, Math.trunc(effSegments) || 1))
  const frac = clamp01(pct)
  const flashing = redlineFlash && (shiftActive || atShiftPoint(frac, flashAt))

  const g = Number.isFinite(gap) ? Math.max(0, gap) : 4
  const layout = revLightRowLayout(width, height, n, { gap: g })
  const safeX = Number.isFinite(x) ? x : 0
  const safeY = Number.isFinite(y) ? y : 0
  const cell = layout.ledWidth
  const ledR = Math.max(0.5, Math.min(cell, layout.ledHeight) / 2)
  const cy = layout.y + layout.ledHeight / 2
  const bloomId = `${uid}-bloom`
  const offId = `${uid}-off`

  // lit state + zone fraction per LED (left→right, or mirrored from centre).
  const center = (n - 1) / 2
  const maxD = center <= 0 ? 1 : center
  const litCount = flashing ? n : Math.round(frac * n)
  const ledMeta = Array.from({ length: n }, (_, i) => {
    let lit: boolean
    let zf: number
    if (effMirror) {
      zf = Math.abs(i - center) / maxD // 0 at centre, 1 at edges
      lit = zf <= frac + 1e-6
    } else {
      zf = (i + 0.5) / n
      lit = i < litCount
    }
    if (flashing) lit = true
    const color = flashing ? SHIFT_STROBE_BLUE : zoneColorFor(zf, colors, warnAt, dangerAt, effZones)
    return { i, lit, color }
  })
  const onColors = Array.from(new Set(ledMeta.filter((m) => m.lit).map((m) => m.color)))
  const onGradId = (c: string): string => `${uid}-on-${onColors.indexOf(c)}`

  function ledShape(cx: number, fill: string, stroke: string, filter?: string): ReactElement {
    if (effShape === 'bar' || effShape === 'trapezoid') {
      const w = cell
      const bx = cx - w / 2
      const h = layout.ledHeight
      const by = layout.y
      if (effShape === 'trapezoid') {
        const inset = w * 0.18
        return (
          <polygon
            points={`${bx + inset},${by} ${bx + w - inset},${by} ${bx + w},${by + h} ${bx},${by + h}`}
            fill={fill}
            stroke={stroke}
            strokeWidth={1}
            filter={filter}
          />
        )
      }
      return (
        <rect x={bx} y={by} width={w} height={h} rx={Math.min(2, h / 2)} fill={fill} stroke={stroke} strokeWidth={1} filter={filter} />
      )
    }
    return <circle cx={cx} cy={cy} r={ledR} fill={fill} stroke={stroke} strokeWidth={1.25} filter={filter} />
  }

  return (
    <svg
      x={safeX}
      y={safeY}
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="rev lights"
      data-rev-shift={flashing ? 'strobe' : 'normal'}
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        {ledOffGradient(offId, colors.recess)}
        {onColors.map((c) => (
          <g key={c}>{ledOnGradient(onGradId(c), c)}</g>
        ))}
        {effGlow ? bloomFilter(bloomId, Math.max(0.6, ledR * bloomStrength), 0.7) : null}
      </defs>
      <g>
        <ShiftStrobe active={flashing} />
        {ledMeta.map(({ i, lit, color }) => {
          const cx = layout.positions[i] + cell / 2
          if (!lit) {
            return <g key={i}>{ledShape(cx, `url(#${offId})`, '#1a1a1a')}</g>
          }
          return (
            <g key={i}>
              {effGlow ? ledShape(cx, color, 'none', `url(#${bloomId})`) : null}
              {ledShape(cx, `url(#${onGradId(color)})`, color, undefined)}
            </g>
          )
        })}
      </g>
    </svg>
  )
}
