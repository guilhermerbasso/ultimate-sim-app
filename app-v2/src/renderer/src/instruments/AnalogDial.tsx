// ── AnalogDial ────────────────────────────────────────────────────────────────
// An anti-aliased circular gauge composed from BezelRing + TickScale + Needle plus
// a d3-shape value arc. Supports any sweep angle, an optional damped needle, warn/
// redline zone bands and a DSEG centre readout. Pure + NaN-safe; an out-of-range
// value clamps the needle to the sweep ends (never overshoots).
//
// Angle convention: degrees CLOCKWISE from 12 o'clock. Defaults sweep −135°→135°.
//
// Props: { value, min?, max?, size?, startAngleDeg?, endAngleDeg?, majorTicks?,
//          minorPerMajor?, unit?, label?, showValue?, decimals?, bezel?, material?,
//          needleColor?, damp?, warnFrom?, redlineFrom?, showTicks?, colors?,
//          idPrefix? }

import { arc } from 'd3-shape'
import { useEffect, useMemo, useRef, type ReactElement } from 'react'
import {
  clamp,
  dampStep,
  deg2rad,
  fmtNum,
  fraction,
  resolveColors,
  safe,
  FONT_SEG7,
  FONT_COND,
  type InstrumentColors,
  type BezelKind,
  type MaterialKind
} from './tokens'
import { useUid } from './defs'
import { BezelRing } from './BezelRing'
import { TickScale } from './TickScale'
import { Needle } from './Needle'

export interface AnalogDialProps {
  value: number
  min?: number
  max?: number
  /** Diameter in px (default 200). */
  size?: number
  startAngleDeg?: number
  endAngleDeg?: number
  majorTicks?: number
  minorPerMajor?: number
  unit?: string
  label?: string
  showValue?: boolean
  decimals?: number
  showTicks?: boolean
  /** Bezel style (default 'chrome'). 'none' disables the ring. */
  bezel?: BezelKind
  material?: MaterialKind
  needleColor?: string
  /** Damped-needle: fraction of the gap retained per render (0 = snap). */
  damp?: number
  /** Value at which the arc/zone turns warn (amber). */
  warnFrom?: number
  /** Value at which the arc/zone turns danger (red) — the redline. */
  redlineFrom?: number
  colors?: Partial<InstrumentColors>
  idPrefix?: string
}

export function AnalogDial({
  value,
  min = 0,
  max = 100,
  size = 200,
  startAngleDeg = -135,
  endAngleDeg = 135,
  majorTicks = 9,
  minorPerMajor = 4,
  unit,
  label,
  showValue = true,
  decimals = 0,
  showTicks = true,
  bezel = 'chrome',
  material = 'matte',
  needleColor,
  damp = 0,
  warnFrom,
  redlineFrom,
  colors: colorOverrides,
  idPrefix
}: AnalogDialProps): ReactElement {
  const uid = useUid(idPrefix)
  const colors = resolveColors(colorOverrides)
  const d = Math.max(24, safe(size, 200))
  const cx = d / 2
  const cy = d / 2
  const lo = safe(min, 0)
  const hi = safe(max, 100)
  const start = safe(startAngleDeg, -135)
  const end = safe(endAngleDeg, 135)

  const frac = fraction(value, lo, hi)
  const targetAngle = start + (end - start) * frac

  // Optional damped needle — retains the previous angle across renders. The damp
  // step is PURE in render (reads the ref only); the ref is committed in an effect
  // so the render body has no side-effects (StrictMode / concurrent-safe).
  const prev = useRef<number>(targetAngle)
  const angle = damp > 0 ? dampStep(prev.current, targetAngle, damp) : targetAngle
  useEffect(() => {
    prev.current = angle
  })

  const ringT = d * 0.07
  const faceR = d / 2 - (bezel === 'none' ? 1 : ringT) - 2
  const arcR = faceR - 3
  const arcW = Math.max(2, d * 0.03)

  // Zone color for the value arc (warm chrome by default; state ramp via thresholds).
  let valueColor = needleColor ?? colors.accent
  if (typeof redlineFrom === 'number' && safe(value, lo) >= redlineFrom) valueColor = colors.danger
  else if (typeof warnFrom === 'number' && safe(value, lo) >= warnFrom) valueColor = colors.warn

  const arcGen = arc()
  const trackPath =
    arcGen({
      innerRadius: arcR - arcW,
      outerRadius: arcR,
      startAngle: deg2rad(start),
      endAngle: deg2rad(end)
    }) ?? undefined
  const valuePath =
    arcGen({
      innerRadius: arcR - arcW,
      outerRadius: arcR,
      startAngle: deg2rad(start),
      endAngle: deg2rad(angle)
    }) ?? undefined

  // Optional redline band drawn on the track.
  let redlineBand: string | undefined
  if (typeof redlineFrom === 'number') {
    const rf = fraction(redlineFrom, lo, hi)
    redlineBand =
      arcGen({
        innerRadius: arcR - arcW,
        outerRadius: arcR + arcW * 0.4,
        startAngle: deg2rad(start + (end - start) * rf),
        endAngle: deg2rad(end)
      }) ?? undefined
  }

  const valueStr = fmtNum(value, clamp(decimals, 0, 4))

  // The bezel + tick scale are static for a given size/threshold config: memoize
  // them so the 60 Hz value/needle updates don't rebuild these heavy subtrees.
  const bezelEl = useMemo(
    () => (
      <BezelRing size={d} thickness={ringT} kind={bezel} material={material} colors={colorOverrides} idPrefix={`${uid}-bz`} />
    ),
    [d, ringT, bezel, material, colorOverrides, uid]
  )
  const ticksEl = useMemo(
    () =>
      showTicks ? (
        <TickScale
          cx={cx}
          cy={cy}
          radius={arcR - arcW - 2}
          startAngleDeg={start}
          endAngleDeg={end}
          majorTicks={majorTicks}
          minorPerMajor={minorPerMajor}
          min={lo}
          max={hi}
          color={colors.text}
          labelColor={colors.textDim}
          idPrefix={`${uid}-tk`}
        />
      ) : null,
    [showTicks, cx, cy, arcR, arcW, start, end, majorTicks, minorPerMajor, lo, hi, colors.text, colors.textDim, uid]
  )

  return (
    <svg
      width={d}
      height={d}
      viewBox={`0 0 ${d} ${d}`}
      role="img"
      aria-label={label ?? 'gauge'}
      style={{ display: 'block' }}
    >
      {/* Bezel + face (its own nested svg keeps ids scoped). */}
      <g>{bezelEl}</g>
      {/* Arc track + value fill (translated to centre because d3 arc is origin-based). */}
      <g transform={`translate(${cx},${cy})`}>
        <path d={trackPath} fill={colors.recess} stroke={colors.stroke} strokeWidth={0.75} />
        {redlineBand ? <path d={redlineBand} fill={colors.danger} fillOpacity={0.25} /> : null}
        <path d={valuePath} fill={valueColor} />
      </g>
      {ticksEl}
      <Needle cx={cx} cy={cy} length={faceR * 0.86} angleDeg={angle} color={needleColor ?? colors.accent} idPrefix={`${uid}-nd`} />
      {label ? (
        <text
          x={cx}
          y={cy + faceR * 0.42}
          fill={colors.textDim}
          fontSize={Math.max(7, d * 0.07)}
          fontFamily={FONT_COND}
          fontWeight={600}
          textAnchor="middle"
          dominantBaseline="central"
          letterSpacing={1}
        >
          {label.toUpperCase()}
        </text>
      ) : null}
      {showValue ? (
        <text
          x={cx}
          y={cy + faceR * 0.66}
          fill={colors.text}
          fontSize={Math.max(9, d * 0.12)}
          fontFamily={FONT_SEG7}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {valueStr}
          {unit ? (
            <tspan fontFamily={FONT_COND} fontSize={Math.max(6, d * 0.06)} fill={colors.textDim} dx={d * 0.02}>
              {unit}
            </tspan>
          ) : null}
        </text>
      ) : null}
    </svg>
  )
}
