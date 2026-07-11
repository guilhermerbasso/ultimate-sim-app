// ── irChassis — chassis attitude / motion (v6, gpt-image referenced) ──────────
// Clean, transparent, title-less widgets for iRacing chassis telemetry surfaced in
// v6: pitch/roll attitude, yaw rate, steering FFB torque, vertical acceleration and
// altitude. Built to match concepts/refs/ref-ir-*.png.
import type { ReactElement } from 'react'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { Bar, BigNum, C, FONT_BIG, FONT_LABEL, FONT_NUM, GaugeArc, Hairline, LEGIBLE, fixed, legibleStroke, num } from '../kit'
import { formatMeasurement } from '../../../../../shared/units'

const ROUND_W = 360
const ROUND_H = 300
const READOUT_W = 420
const READOUT_H = 240
const RAD_TO_DEG = 180 / Math.PI

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function signedFixed(v: number | undefined, digits: number): string {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}${fixed(v, digits)}`
}

function valueColor(v: number | undefined, warn: number, danger: number): string {
  if (v == null) return C.dim
  const a = Math.abs(v)
  if (a >= danger) return C.red
  if (a >= warn) return C.amber
  return C.cyan
}

function AttitudeInstrument({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const pitch = num(snapshot?.pitchRad) ?? 0
  const roll = num(snapshot?.rollRad) ?? 0
  const pitchDeg = pitch * RAD_TO_DEG
  const rollDeg = roll * RAD_TO_DEG
  const cx = ROUND_W / 2
  const cy = ROUND_H / 2
  const r = 116
  const shift = clamp(pitchDeg * 2.4, -44, 44)
  const clipId = `ir-chassis-attitude-clip-${Math.round(width ?? ROUND_W)}-${Math.round(height ?? ROUND_H)}`
  const ticks = [-60, -45, -30, -15, 0, 15, 30, 45, 60]
  const ladder = [-20, -10, 10, 20]

  return (
    <svg viewBox={`0 0 ${ROUND_W} ${ROUND_H}`} width={width ?? ROUND_W} height={height ?? ROUND_H} preserveAspectRatio="xMidYMid meet" role="img">
      <defs>
        <clipPath id={clipId}>
          <circle cx={cx} cy={cy} r={r} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <g transform={`rotate(${rollDeg} ${cx} ${cy})`}>
          <rect x={cx - 260} y={cy - 360 + shift} width={520} height={360} fill={C.cyan} opacity={0.96} />
          <rect x={cx - 260} y={cy + shift} width={520} height={360} fill="#171b1f" opacity={0.98} />
          <line x1={cx - 260} y1={cy + shift} x2={cx + 260} y2={cy + shift} stroke={C.text} strokeWidth={3} />
          <g stroke={C.text} strokeLinecap="round" fill={C.text} opacity={0.96}>
            {ladder.map((deg) => {
              const y = cy + shift - deg * 3.4
              const long = Math.abs(deg) === 20
              return (
                <g key={deg}>
                  <line x1={cx - (long ? 42 : 30)} y1={y} x2={cx + (long ? 42 : 30)} y2={y} strokeWidth={2.6} />
                  <text x={cx - 58} y={y + 8} textAnchor="middle" fontFamily={FONT_LABEL} fontSize={22} fontWeight={800} {...LEGIBLE}>{deg}</text>
                  <text x={cx + 58} y={y + 8} textAnchor="middle" fontFamily={FONT_LABEL} fontSize={22} fontWeight={800} {...LEGIBLE}>{deg}</text>
                </g>
              )
            })}
          </g>
        </g>
      </g>
      <circle cx={cx} cy={cy} r={r + 2} fill="none" stroke="#06090c" strokeWidth={11} />
      <circle cx={cx} cy={cy} r={r - 1} fill="none" stroke="rgba(255,255,255,0.42)" strokeWidth={1.5} />
      {ticks.map((deg) => {
        const a = (deg - 90) / RAD_TO_DEG
        const major = deg === 0 || Math.abs(deg) === 60
        const x1 = cx + Math.cos(a) * (r - (major ? 20 : 13))
        const y1 = cy + Math.sin(a) * (r - (major ? 20 : 13))
        const x2 = cx + Math.cos(a) * (r - 4)
        const y2 = cy + Math.sin(a) * (r - 4)
        return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.text} strokeWidth={major ? 5 : 3.5} opacity={0.92} />
      })}
      <path d={`M${cx - 43} ${cy + 28} L${cx - 16} ${cy} L${cx} ${cy + 18} L${cx + 16} ${cy} L${cx + 43} ${cy + 28}`} fill="none" stroke="rgba(0,0,0,0.58)" strokeWidth={11} strokeLinejoin="miter" strokeLinecap="square" />
      <path d={`M${cx - 43} ${cy + 28} L${cx - 16} ${cy} L${cx} ${cy + 18} L${cx + 16} ${cy} L${cx + 43} ${cy + 28}`} fill="none" stroke={C.text} strokeWidth={7} strokeLinejoin="miter" strokeLinecap="square" />
    </svg>
  )
}

function YawRateScale({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const yaw = num(snapshot?.yawRateRadSec)
  const deg = yaw == null ? undefined : yaw * RAD_TO_DEG
  const x0 = 52
  const x1 = ROUND_W - 52
  const y = 214
  const markerX = x0 + (x1 - x0) * ((clamp(deg ?? 0, -90, 90) + 90) / 180)
  const color = valueColor(deg, 45, 75)

  return (
    <svg viewBox={`0 0 ${ROUND_W} ${ROUND_H}`} width={width ?? ROUND_W} height={height ?? ROUND_H} preserveAspectRatio="xMidYMid meet" role="img">
      <BigNum x={ROUND_W / 2} y={112} value={deg == null ? '—' : fixed(deg, 0)} unit="deg/s" color={color} size={82} />
      <GaugeArc cx={ROUND_W / 2} cy={150} r={34} thickness={5} f={0.68} color={C.cyan} />
      <path d={`M${ROUND_W / 2 + 21} 161 l18 0 l-13 13 z`} fill={C.cyan} opacity={0.95} />
      <Hairline x={x0} y={y} len={x1 - x0} opacity={0.22} />
      {Array.from({ length: 37 }, (_, i) => {
        const v = -90 + i * 5
        const x = x0 + ((x1 - x0) * i) / 36
        const major = v % 30 === 0
        return <line key={v} x1={x} y1={y - (major ? 22 : 13)} x2={x} y2={y + (major ? 22 : 13)} stroke={major ? C.cyan : 'rgba(255,255,255,0.48)'} strokeWidth={major ? 2 : 1.2} />
      })}
      {[-90, -60, -30, 0, 30, 60, 90].map((v) => {
        const x = x0 + ((x1 - x0) * (v + 90)) / 180
        return <text key={v} x={x} y={y + 49} textAnchor="middle" fill={C.cyan} fontFamily={FONT_NUM} fontSize={20} fontWeight={800} {...LEGIBLE}>{v}</text>
      })}
      <line x1={markerX} y1={y - 30} x2={markerX} y2={y + 24} stroke={deg == null ? C.dim : C.amber} strokeWidth={4} opacity={0.95} />
      <path d={`M${markerX - 10} ${y - 37} L${markerX + 10} ${y - 37} L${markerX} ${y - 18} Z`} fill="none" stroke={deg == null ? C.dim : C.amber} strokeWidth={2.4} />
    </svg>
  )
}

function TorqueBar({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const raw = num(snapshot?.steeringTorquePct)
  const pct = raw == null ? undefined : raw * 100
  const f = pct == null ? 0 : clamp(pct / 100, 0, 1)
  const x = 44
  const y = 165
  const w = READOUT_W - 88
  const h = 20
  const markerX = x + w * f
  const gradId = `ir-chassis-ffb-grad-${Math.round(width ?? READOUT_W)}-${Math.round(height ?? READOUT_H)}`
  const clipId = `ir-chassis-ffb-clip-${Math.round(width ?? READOUT_W)}-${Math.round(height ?? READOUT_H)}`
  const color = pct == null ? C.dim : pct >= 92 ? C.red : pct >= 70 ? C.amber : C.cyan

  return (
    <svg viewBox={`0 0 ${READOUT_W} ${READOUT_H}`} width={width ?? READOUT_W} height={height ?? READOUT_H} preserveAspectRatio="xMidYMid meet" role="img">
      <defs>
        <linearGradient id={gradId} x1={x} x2={x + w} y1="0" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={C.cyan} />
          <stop offset="0.48" stopColor={C.cyan} />
          <stop offset="0.72" stopColor={C.amber} />
          <stop offset="1" stopColor={C.red} />
        </linearGradient>
        <clipPath id={clipId}>
          <rect x={x} y={y} width={w * f} height={h} rx={4} />
        </clipPath>
      </defs>
      <BigNum x={READOUT_W / 2} y={112} value={pct == null ? '—' : fixed(pct, 0)} unit="%" color={color} size={96} />
      <Bar x={x} y={y} w={w} h={h} f={1} color="rgba(255,255,255,0.08)" />
      <rect x={x} y={y} width={w} height={h} rx={4} fill={`url(#${gradId})`} opacity={0.32} />
      <rect x={x} y={y} width={w} height={h} rx={4} fill={`url(#${gradId})`} clipPath={`url(#${clipId})`} />
      {pct != null ? <rect x={markerX - 2} y={y - 12} width={4} height={h + 24} rx={2} fill={color} /> : null}
      {[0, 25, 50, 75, 100].map((v) => {
        const tx = x + (w * v) / 100
        return (
          <g key={v}>
            <line x1={tx} y1={y - 14} x2={tx} y2={y + h + 14} stroke="rgba(255,255,255,0.45)" strokeWidth={1.4} />
            <text x={tx} y={y + h + 38} textAnchor="middle" fill={C.text} fontFamily={FONT_LABEL} fontSize={24} fontWeight={800} {...LEGIBLE}>{v}</text>
          </g>
        )
      })}
    </svg>
  )
}

function CenterZeroReadout({ width, height, value, unit, min, max, digits }: HifiWidgetProps & { value: number | undefined; unit: string; min: number; max: number; digits: number }): ReactElement {
  const range = Math.max(Math.abs(min), Math.abs(max))
  const f = value == null ? 0 : clamp(value / range, -1, 1)
  const cx = READOUT_W / 2
  const y = 176
  const half = 126
  const color = valueColor(value, range * 0.55, range * 0.85)
  return (
    <svg viewBox={`0 0 ${READOUT_W} ${READOUT_H}`} width={width ?? READOUT_W} height={height ?? READOUT_H} preserveAspectRatio="xMidYMid meet" role="img">
      <text x={cx} y={125} textAnchor="middle" fill={color} fontFamily={FONT_BIG} fontWeight={800} fontSize={84} {...legibleStroke(84)}>
        {signedFixed(value, digits)}
        <tspan fill={C.dim} fontFamily={FONT_LABEL} fontSize={28}> {unit}</tspan>
      </text>
      <Hairline x={cx - half} y={y} len={half * 2} opacity={0.26} />
      <line x1={cx} y1={y - 15} x2={cx} y2={y + 15} stroke={C.dim} strokeWidth={1.8} />
      {value != null ? <rect x={f >= 0 ? cx : cx + half * f} y={y - 7} width={Math.abs(half * f)} height={14} rx={7} fill={color} /> : null}
      <text x={cx - half} y={y + 37} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={20} fontWeight={700} {...LEGIBLE}>{min}</text>
      <text x={cx} y={y + 37} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={20} fontWeight={700} {...LEGIBLE}>0</text>
      <text x={cx + half} y={y + 37} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={20} fontWeight={700} {...LEGIBLE}>{max}</text>
    </svg>
  )
}

function AltitudeReadout({ width, height, snapshot, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
  const altitude = num(snapshot?.altitudeM)
  const reading = formatMeasurement(altitude, 'distance-m', unitSystem, { decimals: 0 })
  const f = altitude == null ? 0 : clamp(altitude / 500, 0, 1)
  const sx = 76
  const ex = READOUT_W - 76
  const sy = 178
  return (
    <svg viewBox={`0 0 ${READOUT_W} ${READOUT_H}`} width={width ?? READOUT_W} height={height ?? READOUT_H} preserveAspectRatio="xMidYMid meet" role="img">
      <BigNum x={READOUT_W / 2} y={126} value={reading.display} unit={reading.unit} color={altitude == null ? C.dim : C.text} size={94} />
      <Hairline x={sx} y={sy} len={ex - sx} opacity={0.28} />
      {altitude != null ? <rect x={sx + (ex - sx) * f - 1.5} y={sy - 9} width={3} height={18} rx={1} fill={C.cyan} /> : null}
      <text x={sx} y={sy + 29} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={20} fontWeight={700} {...LEGIBLE}>0</text>
      <text x={ex} y={sy + 29} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={20} fontWeight={700} {...LEGIBLE}>500</text>
    </svg>
  )
}

export const attitudeWidget: HifiWidgetModule = {
  id: 'attitude',
  title: 'Attitude',
  description: 'Artificial-horizon pitch and roll instrument for chassis attitude.',
  category: 'car',
  tags: ['attitude', 'pitch', 'roll', 'horizon', 'clean'],
  requires: ['pitchRad', 'rollRad'],
  defaultSize: { w: ROUND_W, h: ROUND_H },
  render: (props) => <AttitudeInstrument {...props} />
}

export const yawRateWidget: HifiWidgetModule = {
  id: 'yawRate',
  title: 'Yaw Rate',
  description: 'Centre-zero yaw-rate scale with degrees-per-second readout.',
  category: 'car',
  tags: ['yaw', 'rotation', 'scale', 'clean'],
  requires: ['yawRateRadSec'],
  defaultSize: { w: ROUND_W, h: ROUND_H },
  render: (props) => <YawRateScale {...props} />
}

export const ffbTorqueWidget: HifiWidgetModule = {
  id: 'ffbTorque',
  title: 'FFB Torque',
  description: 'Steering force-feedback torque percent with cyan-to-red clipping bar.',
  category: 'car',
  tags: ['ffb', 'steering', 'torque', 'bar', 'clean'],
  requires: ['steeringTorquePct'],
  defaultSize: { w: READOUT_W, h: READOUT_H },
  render: (props) => <TorqueBar {...props} />
}

export const vertGWidget: HifiWidgetModule = {
  id: 'vertG',
  title: 'Vertical G',
  description: 'Vertical acceleration in G with a centre-zero bar.',
  category: 'car',
  tags: ['vertical', 'acceleration', 'g-load', 'bar', 'clean'],
  requires: ['vertAccelG'],
  defaultSize: { w: READOUT_W, h: READOUT_H },
  render: (props) => <CenterZeroReadout {...props} value={num(props.snapshot?.vertAccelG)} unit="g" min={-2} max={2} digits={2} />
}

export const altitudeWidget: HifiWidgetModule = {
  id: 'altitude',
  title: 'Altitude',
  description: 'Track altitude in metres with a clean digital readout.',
  category: 'car',
  tags: ['altitude', 'elevation', 'digital', 'clean'],
  requires: ['altitudeM'],
  defaultSize: { w: READOUT_W, h: READOUT_H },
  render: (props) => <AltitudeReadout {...props} />
}
