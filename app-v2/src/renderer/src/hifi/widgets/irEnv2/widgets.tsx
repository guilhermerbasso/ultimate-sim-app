// ── irEnv2 — environment telemetry (v6, gpt-image referenced) ─────────────────
// Clean, transparent, title-less widgets for the environment channels surfaced in
// v6: fog density, relative humidity (percent + fill bar with a distinguishing
// glyph), wind (compass ring + direction arrow + speed), and sun altitude (horizon
// arc + sun dot + elevation degrees). Built to match concepts/refs/ref-ir-*.png.
import { useSurfaceRole } from '../a11y'
import type { ReactElement } from 'react'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { Bar, BigNum, C, FONT_LABEL, LEGIBLE, fixed, num } from '../kit'
import { formatMeasurement } from '../../../../../shared/units'

const W = 360
const H = 300

/** fogPct / humidityPct are stored 0..1 — present as 0..100 %. */
function asPercent(v: number | undefined): number | undefined {
  if (v == null) return undefined
  return v <= 1 ? v * 100 : v
}

function PercentBar({ width, height, value, color, glyph }: HifiWidgetProps & { value: number | undefined; color: string; glyph: 'fog' | 'drop' }): ReactElement {
  const p = asPercent(value)
  const f = p == null ? 0 : Math.max(0, Math.min(1, p / 100))
  const gx = 44
  const gy = 214
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={width ?? W} height={height ?? H} preserveAspectRatio="xMidYMid meet" {...useSurfaceRole()}>
      <BigNum x={W / 2} y={150} value={p == null ? '—' : fixed(p, 0)} unit="%" color={p == null ? C.dim : color} size={112} />
      {glyph === 'drop' ? (
        <path d={`M${gx} ${gy - 12} q9 12 9 19 a9 9 0 0 1 -18 0 q0 -7 9 -19 z`} fill="none" stroke={color} strokeWidth={2} opacity={0.9} />
      ) : (
        <g stroke={color} strokeWidth={2.4} strokeLinecap="round" opacity={0.9}>
          <path d={`M${gx - 9} ${gy - 4} h18`} />
          <path d={`M${gx - 11} ${gy + 3} h22`} />
          <path d={`M${gx - 8} ${gy + 10} h16`} />
        </g>
      )}
      <Bar x={68} y={206} w={W - 108} h={16} f={f} color={p == null ? C.recess : color} />
      <text x={68} y={248} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={18} fontWeight={700} {...LEGIBLE}>0</text>
      <text x={W - 40} y={248} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={18} fontWeight={700} {...LEGIBLE}>100</text>
    </svg>
  )
}

function WindCompass({ width, height, snapshot, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
  const dir = num(snapshot?.windDirRad)
  const speed = num(snapshot?.windSpeedMs)
  const speedReading = formatMeasurement(speed, 'speed-ms', unitSystem, { decimals: 1 })
  const cx = W / 2
  const cy = 150
  const r = 96
  const ux = dir == null ? 0 : Math.sin(dir)
  const uy = dir == null ? 0 : -Math.cos(dir)
  const tipX = cx + r * ux
  const tipY = cy + r * uy
  const baseX = cx + (r - 26) * ux
  const baseY = cy + (r - 26) * uy
  const px = -uy
  const py = ux
  const labels: Array<[string, number, number]> = [
    ['N', cx, cy - r - 12],
    ['E', cx + r + 14, cy + 6],
    ['S', cx, cy + r + 24],
    ['W', cx - r - 16, cy + 6]
  ]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={width ?? W} height={height ?? H} preserveAspectRatio="xMidYMid meet" {...useSurfaceRole()}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.cyan} strokeWidth={1.5} opacity={0.55} />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (Math.PI * 2 * i) / 12
        const x1 = cx + Math.cos(a) * (r - 6)
        const y1 = cy + Math.sin(a) * (r - 6)
        const x2 = cx + Math.cos(a) * r
        const y2 = cy + Math.sin(a) * r
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.35)" strokeWidth={1.5} />
      })}
      {labels.map(([t, x, y]) => (
        <text key={t} x={x} y={y} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={20} fontWeight={800} {...LEGIBLE}>{t}</text>
      ))}
      {dir != null ? (
        <g>
          <line x1={cx + (r - 48) * ux} y1={cy + (r - 48) * uy} x2={baseX} y2={baseY} stroke={C.cyan} strokeWidth={5} strokeLinecap="round" />
          <polygon points={`${tipX},${tipY} ${baseX + 10 * px},${baseY + 10 * py} ${baseX - 10 * px},${baseY - 10 * py}`} fill={C.cyan} />
        </g>
      ) : null}
      <text x={cx} y={cy + 8} textAnchor="middle" fill={speed == null ? C.dim : C.text} fontFamily={FONT_LABEL} fontSize={54} fontWeight={800} {...LEGIBLE}>{speedReading.display}</text>
      <text x={cx} y={cy + 34} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={18} fontWeight={700} {...LEGIBLE}>{speedReading.unit}</text>
    </svg>
  )
}

function SolarArc({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const alt = num(snapshot?.solarAltitudeRad)
  const cx = W / 2
  const baseY = 220
  const r = 118
  const frac = alt == null ? null : Math.max(0, Math.min(1, alt / (Math.PI / 2)))
  const t = frac == null ? null : frac * (Math.PI / 2)
  const sunX = t == null ? null : cx - r * Math.cos(t)
  const sunY = t == null ? null : baseY - r * Math.sin(t)
  const deg = alt == null ? null : (alt * 180) / Math.PI
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={width ?? W} height={height ?? H} preserveAspectRatio="xMidYMid meet" {...useSurfaceRole()}>
      <line x1={cx - r - 6} y1={baseY} x2={cx + r + 6} y2={baseY} stroke="rgba(255,255,255,0.28)" strokeWidth={1.5} />
      <path d={`M${cx - r} ${baseY} A ${r} ${r} 0 0 1 ${cx + r} ${baseY}`} fill="none" stroke={C.cyan} strokeWidth={1.5} opacity={0.5} />
      {sunX != null && sunY != null ? (
        <g>
          <circle cx={sunX} cy={sunY} r={16} fill={C.amber} opacity={0.28} />
          <circle cx={sunX} cy={sunY} r={9} fill={C.amber} />
        </g>
      ) : null}
      <text x={cx} y={baseY - 40} textAnchor="middle" fill={deg == null ? C.dim : C.amber} fontFamily={FONT_LABEL} fontSize={64} fontWeight={800} {...LEGIBLE}>{deg == null ? '—' : `${fixed(deg, 0)}°`}</text>
    </svg>
  )
}

export const fogWidget: HifiWidgetModule = {
  id: 'fog',
  title: 'Fog',
  description: 'Fog density percent with a fill bar.',
  category: 'weather',
  tags: ['fog', 'weather', 'percent', 'bar', 'clean'],
  requires: ['fogPct'],
  defaultSize: { w: W, h: H },
  render: (props) => <PercentBar {...props} value={num(props.snapshot?.fogPct)} color={C.dim} glyph="fog" />
}

export const humidityWidget: HifiWidgetModule = {
  id: 'humidity',
  title: 'Humidity',
  description: 'Relative humidity percent with a fill bar and droplet glyph.',
  category: 'weather',
  tags: ['humidity', 'weather', 'percent', 'bar', 'clean'],
  requires: ['humidityPct'],
  defaultSize: { w: W, h: H },
  render: (props) => <PercentBar {...props} value={num(props.snapshot?.humidityPct)} color={C.cyan} glyph="drop" />
}

export const windWidget: HifiWidgetModule = {
  id: 'wind',
  title: 'Wind',
  description: 'Wind direction compass arrow with speed in the centre.',
  category: 'weather',
  tags: ['wind', 'weather', 'compass', 'direction', 'clean'],
  requires: ['windDirRad', 'windSpeedMs'],
  defaultSize: { w: W, h: H },
  render: (props) => <WindCompass {...props} />
}

export const solarAltitudeWidget: HifiWidgetModule = {
  id: 'solarAltitude',
  title: 'Sun Altitude',
  description: 'Sun elevation over a horizon arc with the angle in degrees.',
  category: 'weather',
  tags: ['sun', 'solar', 'weather', 'arc', 'clean'],
  requires: ['solarAltitudeRad'],
  defaultSize: { w: W, h: H },
  render: (props) => <SolarArc {...props} />
}
