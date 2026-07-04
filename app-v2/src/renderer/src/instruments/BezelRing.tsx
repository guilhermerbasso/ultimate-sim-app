// ── BezelRing ─────────────────────────────────────────────────────────────────
// A layered circular bezel for analog gauges: an outer dark rim, a brushed-metal /
// chrome mid ring and an inner hairline lip. Warm-chrome discipline (no cool tint).
// Pure. Used standalone or composed inside AnalogDial.
//
// Props: { size, thickness?, kind?, material?, colors?, idPrefix? }

import { type ReactElement } from 'react'
import { resolveColors, safe, type BezelKind, type InstrumentColors, type MaterialKind } from './tokens'
import { bezelGradient, materialFill, useUid } from './defs'

export interface BezelRingProps {
  /** Outer diameter in px. */
  size: number
  /** Ring thickness in px (default ~7% of size). */
  thickness?: number
  /** Bezel style (default 'chrome'). */
  kind?: BezelKind
  /** Inner face material drawn under the ring (default 'matte'). */
  material?: MaterialKind
  colors?: Partial<InstrumentColors>
  idPrefix?: string
}

export function BezelRing({
  size,
  thickness,
  kind = 'chrome',
  material = 'matte',
  colors: colorOverrides,
  idPrefix
}: BezelRingProps): ReactElement {
  const uid = useUid(idPrefix)
  const colors = resolveColors(colorOverrides)
  const d = Math.max(8, safe(size, 8))
  const t = Math.max(1, thickness ?? d * 0.07)
  const cx = d / 2
  const cy = d / 2
  const rOuter = d / 2 - 0.5
  const gradId = `${uid}-bezgrad`
  const face = materialFill(material, uid, colors)

  if (kind === 'none') {
    return (
      <svg width={d} height={d} viewBox={`0 0 ${d} ${d}`} role="presentation">
        <defs>{face.defs}</defs>
        <circle cx={cx} cy={cy} r={rOuter} fill={face.fill} stroke={colors.stroke} strokeWidth={1} />
      </svg>
    )
  }

  const ringFill = kind === 'thin' ? colors.bezel : `url(#${gradId})`
  return (
    <svg width={d} height={d} viewBox={`0 0 ${d} ${d}`} role="presentation">
      <defs>
        {bezelGradient(gradId, colors)}
        {face.defs}
      </defs>
      {/* Outer dark rim */}
      <circle cx={cx} cy={cy} r={rOuter} fill="#000000" />
      {/* Brushed/chrome ring */}
      <circle
        cx={cx}
        cy={cy}
        r={rOuter - t / 2}
        fill="none"
        stroke={ringFill}
        strokeWidth={t}
      />
      {kind === 'double' ? (
        <circle
          cx={cx}
          cy={cy}
          r={rOuter - t * 1.4}
          fill="none"
          stroke={colors.bezelLo}
          strokeWidth={Math.max(1, t * 0.35)}
        />
      ) : null}
      {/* Inner face */}
      <circle cx={cx} cy={cy} r={Math.max(1, rOuter - t)} fill={face.fill} stroke={colors.strokeHot} strokeWidth={1} />
      {/* Inner hairline lip for depth */}
      <circle
        cx={cx}
        cy={cy}
        r={Math.max(1, rOuter - t - 1)}
        fill="none"
        stroke="#000000"
        strokeOpacity={0.6}
        strokeWidth={1}
      />
    </svg>
  )
}
