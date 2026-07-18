// ── irDerived — combined/derived iRacing telemetry widgets ────────────────────
// Clean, transparent, title-less widgets that COMBINE already-surfaced iRacing
// channels into information that only makes sense together, closing the last of
// the telemetry-coverage gap (user ask: use every telemetry, combine where it
// makes sense). Every widget is NaN-safe and renders em-dashes when data is
// absent — never fake values.
//
//   slipAngle        ← velocityX + velocityY          (chassis slip from velocity)
//   steeringLock     ← steerAngleDeg + steeringAngleMaxDeg (% of available lock)
//   rotationRates    ← yaw/pitch/rollRateRadSec        (3-axis body rates, °/s)
//   carAttitude      ← pitchRad + rollRad + yawRad      (artificial horizon + hdg)
//   fuelLapsLeft     ← canonical fuelLapsRemaining / litres-per-lap
//   sunPosition      ← solarAltitudeRad + solarAzimuthRad (sky-dome sun plot)
//   gpsHeading       ← lat + lon + yawNorth             (GPS fix + compass heading)
//   raceControlFlags ← sessionFlagsRaw                  (decoded flag lamp panel)
//   shiftPoint       ← shiftRpm + rpm + maxRpm          (optimal upshift cue)
//   engineTelltale   ← engineRunning + rpm             (run / off / stall lamp)
//   spotterRaw       ← carLeftRightRaw                  (full left/right proximity)
//   sessionTag       ← sessionUniqueId                  (unique session identity)
import type { ReactElement, ReactNode } from 'react'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import {
  Bar,
  BigNum,
  C,
  FONT_BIG,
  FONT_LABEL,
  FONT_NUM,
  GaugeArc,
  LEGIBLE,
  SHIFT_STROBE_BLUE,
  ShiftStrobe,
  clamp01,
  fixed,
  legibleStroke,
  num
} from '../kit'
import { formatMeasurement } from '../../../../../shared/units'
import {
  fuelLapsRemainingOf,
  fuelPerLapLitersOf
} from '../../../../../shared/telemetry'

const W = 420
const H = 240
const RAD2DEG = 180 / Math.PI

function Root({ width, height, w = W, h = H, children }: HifiWidgetProps & { w?: number; h?: number; children: ReactNode }): ReactElement {
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={width ?? w} height={height ?? h} preserveAspectRatio="xMidYMid meet" role="img">
      {children}
    </svg>
  )
}

function deg(rad: number | undefined): number | undefined {
  return rad == null ? undefined : rad * RAD2DEG
}

function normHeading(rad: number | undefined): number | undefined {
  if (rad == null) return undefined
  const d = (rad * RAD2DEG) % 360
  return d < 0 ? d + 360 : d
}

// ── Slip angle (velocityX forward, velocityY lateral) ─────────────────────────
function SlipAngle({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const vx = num(snapshot?.velocityX)
  const vy = num(snapshot?.velocityY)
  const has = vx != null && vy != null
  const slipRad = has ? Math.atan2(vy as number, vx as number) : undefined
  const slipDeg = slipRad == null ? undefined : slipRad * RAD2DEG
  const color = slipDeg == null ? C.dim : Math.abs(slipDeg) < 3 ? C.green : Math.abs(slipDeg) < 8 ? C.amber : C.red
  const side = slipDeg == null ? '' : slipDeg > 0.5 ? 'R' : slipDeg < -0.5 ? 'L' : ''
  const cx = 148
  const cy = 118
  const len = 74
  const ang = slipRad ?? 0
  const ex = cx + Math.sin(ang) * len
  const ey = cy - Math.cos(ang) * len
  return (
    <Root width={width} height={height} snapshot={snapshot}>
      <rect x={cx - 22} y={cy - 42} width={44} height={84} rx={12} fill="rgba(255,255,255,0.06)" stroke={C.dim} strokeWidth={3} />
      <line x1={cx} y1={cy} x2={cx} y2={cy - len} stroke={C.stroke} strokeWidth={2} strokeDasharray="4 5" />
      {has ? <line x1={cx} y1={cy} x2={ex} y2={ey} stroke={color} strokeWidth={5} strokeLinecap="round" /> : null}
      {has ? <circle cx={ex} cy={ey} r={6} fill={color} /> : null}
      <BigNum x={320} y={116} value={slipDeg == null ? '—' : fixed(Math.abs(slipDeg), 1)} unit="°" color={color} size={70} />
      <text x={320} y={156} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={22} fontWeight={800} letterSpacing={3} {...LEGIBLE}>
        {`SLIP${side ? ` ${side}` : ''}`}
      </text>
    </Root>
  )
}

// ── Steering % of lock ────────────────────────────────────────────────────────
function SteeringLock({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const ang = num(snapshot?.steerAngleDeg)
  const max = num(snapshot?.steeringAngleMaxDeg)
  const pct = ang != null && max != null && max > 0 ? clamp01(Math.abs(ang) / max) : undefined
  const color = pct == null ? C.dim : pct < 0.7 ? C.cyan : pct < 0.9 ? C.amber : C.red
  return (
    <Root width={width} height={height} snapshot={snapshot}>
      <GaugeArc cx={W / 2} cy={140} r={92} thickness={20} f={pct ?? 0} color={color} />
      <BigNum x={W / 2} y={150} value={pct == null ? '—' : fixed(pct * 100, 0)} unit="%" color={color} size={64} />
      <text x={W / 2} y={196} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={22} fontWeight={800} letterSpacing={2} {...LEGIBLE}>
        {ang == null || max == null ? 'LOCK' : `${fixed(Math.abs(ang), 0)}° / ${fixed(max, 0)}°`}
      </text>
    </Root>
  )
}

// ── Chassis rotation rates (yaw/pitch/roll, °/s, bipolar) ──────────────────────
function BipolarBar({ cx, y, half, f, color, h = 16 }: { cx: number; y: number; half: number; f: number; color: string; h?: number }): ReactElement {
  const ff = Math.max(-1, Math.min(1, Number.isFinite(f) ? f : 0))
  const barW = Math.abs(ff) * half
  const bx = ff >= 0 ? cx : cx - barW
  return (
    <>
      <rect x={cx - half} y={y} width={half * 2} height={h} rx={h / 2} fill={C.recess} stroke={C.stroke} strokeWidth={0.5} />
      <rect x={bx} y={y} width={barW} height={h} rx={h / 2} fill={color} />
      <rect x={cx - 0.75} y={y - 4} width={1.5} height={h + 8} fill={C.dim} />
    </>
  )
}

function RotationRates({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const rows: { label: string; v: number | undefined; max: number }[] = [
    { label: 'YAW', v: deg(num(snapshot?.yawRateRadSec)), max: 60 },
    { label: 'PIT', v: deg(num(snapshot?.pitchRateRadSec)), max: 40 },
    { label: 'ROL', v: deg(num(snapshot?.rollRateRadSec)), max: 40 }
  ]
  const cx = 244
  const half = 116
  return (
    <Root width={width} height={height} snapshot={snapshot}>
      {rows.map((r, i) => {
        const y = 52 + i * 62
        const color = r.v == null ? C.dim : C.cyan
        return (
          <g key={r.label}>
            <text x={26} y={y + 22} fill={C.dim} fontFamily={FONT_LABEL} fontSize={24} fontWeight={900} letterSpacing={2} {...LEGIBLE}>{r.label}</text>
            <BipolarBar cx={cx} y={y} half={half} f={r.v == null ? 0 : r.v / r.max} color={color} />
            <text x={408} y={y - 4} textAnchor="end" fill={color} fontFamily={FONT_NUM} fontSize={20} fontWeight={800} {...LEGIBLE}>
              {r.v == null ? '—' : `${r.v >= 0 ? '+' : ''}${r.v.toFixed(0)}°/s`}
            </text>
          </g>
        )
      })}
    </Root>
  )
}

// ── Car attitude — artificial horizon (pitch/roll) + heading (yaw) ────────────
function CarAttitude({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const pitch = deg(num(snapshot?.pitchRad))
  const roll = deg(num(snapshot?.rollRad))
  const yawDeg = normHeading(num(snapshot?.yawRad))
  const cx = 150
  const cy = 118
  const r = 84
  const rollDeg = roll ?? 0
  const pitchOffset = Math.max(-r, Math.min(r, (pitch ?? 0) * 2))
  const clipId = `irDerivedAttClip-${Math.round(width ?? cx * 2)}-${Math.round(height ?? cy * 2)}`
  return (
    <Root width={width} height={height} snapshot={snapshot}>
      <defs>
        <clipPath id={clipId}>
          <circle cx={cx} cy={cy} r={r} />
        </clipPath>
      </defs>
      <circle cx={cx} cy={cy} r={r} fill="rgba(34,195,255,0.05)" stroke={C.dim} strokeWidth={3} />
      <g clipPath={`url(#${clipId})`}>
        <g transform={`rotate(${-rollDeg} ${cx} ${cy}) translate(0 ${pitchOffset})`}>
          <rect x={cx - r * 1.6} y={cy - r * 2} width={r * 3.2} height={r * 2} fill="rgba(34,120,255,0.16)" />
          <rect x={cx - r * 1.6} y={cy} width={r * 3.2} height={r * 2} fill="rgba(150,96,44,0.20)" />
          <line x1={cx - r * 1.6} y1={cy} x2={cx + r * 1.6} y2={cy} stroke={C.text} strokeWidth={3} />
        </g>
      </g>
      <line x1={cx - 26} y1={cy} x2={cx - 8} y2={cy} stroke={C.amber} strokeWidth={4} strokeLinecap="round" />
      <line x1={cx + 8} y1={cy} x2={cx + 26} y2={cy} stroke={C.amber} strokeWidth={4} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={3} fill={C.amber} />
      <BigNum x={322} y={104} value={yawDeg == null ? '—' : fixed(yawDeg, 0)} unit="°" color={C.cyan} size={54} />
      <text x={322} y={138} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={20} fontWeight={800} letterSpacing={3} {...LEGIBLE}>HDG</text>
      <text x={322} y={186} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={19} fontWeight={700} {...LEGIBLE}>
        {`P ${fixed(pitch, 0)}°  R ${fixed(roll, 0)}°`}
      </text>
    </Root>
  )
}

// ── Fuel laps-left (canonical litres-based estimate) ──────────────────────────
function FuelLapsLeft({ width, height, snapshot, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
  const laps = fuelLapsRemainingOf(snapshot)
  const perLapLiters = fuelPerLapLitersOf(snapshot)
  const color = laps == null ? C.dim : laps < 2 ? C.red : laps < 4 ? C.amber : C.green
  const perLapReading = formatMeasurement(perLapLiters, 'fuel-per-lap-l', unitSystem, { decimals: 2 })
  return (
    <Root width={width} height={height} snapshot={snapshot}>
      <BigNum x={W / 2} y={128} value={laps == null ? '—' : fixed(laps, 1)} color={color} size={104} />
      <text x={W / 2} y={168} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={24} fontWeight={800} letterSpacing={3} {...LEGIBLE}>LAPS LEFT</text>
      <text x={W / 2} y={210} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={20} fontWeight={700} {...LEGIBLE}>
        {perLapLiters == null ? '—' : `${perLapReading.display} ${perLapReading.unit}`}
      </text>
    </Root>
  )
}

// ── Sun position (azimuth = horizontal, altitude = height) ────────────────────
function SunPosition({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const altRad = num(snapshot?.solarAltitudeRad)
  const azRad = num(snapshot?.solarAzimuthRad)
  const altDeg = altRad == null ? undefined : altRad * RAD2DEG
  const azDeg = normHeading(azRad)
  const has = altRad != null && azRad != null
  const cx = 210
  const horizonY = 178
  const R = 148
  const alt01 = altDeg == null ? 0 : clamp01(altDeg / 90)
  const sx = cx + Math.sin(azRad ?? 0) * R * 0.92
  const sy = horizonY - alt01 * (R - 20)
  const day = (altDeg ?? -1) > 0
  const sunColor = altDeg == null ? C.dim : altDeg < 6 ? C.red : altDeg < 20 ? C.amber : '#ffd54a'
  return (
    <Root width={width} height={height} snapshot={snapshot}>
      <path d={`M ${cx - R} ${horizonY} A ${R} ${R} 0 0 1 ${cx + R} ${horizonY}`} fill="rgba(34,120,255,0.06)" stroke={C.stroke} strokeWidth={2} />
      <line x1={cx - R} y1={horizonY} x2={cx + R} y2={horizonY} stroke={C.dim} strokeWidth={3} />
      {has && day ? (
        <>
          {Array.from({ length: 12 }, (_, i) => {
            const a = (Math.PI * 2 * i) / 12
            return <line key={i} x1={sx + Math.cos(a) * 22} y1={sy + Math.sin(a) * 22} x2={sx + Math.cos(a) * 32} y2={sy + Math.sin(a) * 32} stroke={sunColor} strokeWidth={4} strokeLinecap="round" opacity={0.7} />
          })}
          <circle cx={sx} cy={sy} r={17} fill={sunColor} />
        </>
      ) : null}
      {has && !day ? <circle cx={cx} cy={horizonY - 6} r={14} fill={C.muted} opacity={0.7} /> : null}
      <BigNum x={cx} y={horizonY + 40} value={altDeg == null ? '—' : fixed(altDeg, 0)} unit="°" color={sunColor} size={46} />
      <text x={cx} y={horizonY + 62} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={18} fontWeight={800} letterSpacing={2} {...LEGIBLE}>
        {`SUN ALT · AZ ${azDeg == null ? '—' : `${fixed(azDeg, 0)}°`}`}
      </text>
    </Root>
  )
}

// ── GPS fix + compass heading (lat/lon + yawNorth) ────────────────────────────
function fmtCoord(v: number | undefined, pos: string, neg: string): string {
  if (v == null) return '—'
  const hemi = v >= 0 ? pos : neg
  const a = Math.abs(v)
  const d = Math.floor(a)
  const m = (a - d) * 60
  return `${d}°${m.toFixed(3)}'${hemi}`
}

function GpsHeading({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const lat = num(snapshot?.lat)
  const lon = num(snapshot?.lon)
  const hdg = normHeading(num(snapshot?.yawNorth))
  const cx = 116
  const cy = 118
  const r = 80
  const needle = ((hdg ?? 0) * Math.PI) / 180
  const nx = cx + Math.sin(needle) * (r - 16)
  const ny = cy - Math.cos(needle) * (r - 16)
  return (
    <Root width={width} height={height} snapshot={snapshot}>
      <circle cx={cx} cy={cy} r={r} fill="rgba(255,255,255,0.04)" stroke={C.dim} strokeWidth={3} />
      {['N', 'E', 'S', 'W'].map((d, i) => {
        const a = (i * Math.PI) / 2
        return (
          <text key={d} x={cx + Math.sin(a) * (r - 16)} y={cy - Math.cos(a) * (r - 16) + 7} textAnchor="middle" fill={d === 'N' ? C.red : C.dim} fontFamily={FONT_LABEL} fontSize={20} fontWeight={900} {...LEGIBLE}>{d}</text>
        )
      })}
      {hdg != null ? <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={C.cyan} strokeWidth={5} strokeLinecap="round" /> : null}
      <circle cx={cx} cy={cy} r={5} fill={C.cyan} />
      <text x={222} y={94} fill={C.text} fontFamily={FONT_NUM} fontSize={28} fontWeight={800} {...LEGIBLE}>{fmtCoord(lat, 'N', 'S')}</text>
      <text x={222} y={136} fill={C.text} fontFamily={FONT_NUM} fontSize={28} fontWeight={800} {...LEGIBLE}>{fmtCoord(lon, 'E', 'W')}</text>
      <text x={222} y={190} fill={C.cyan} fontFamily={FONT_BIG} fontSize={40} fontWeight={800} {...legibleStroke(40)}>{hdg == null ? '—' : `${fixed(hdg, 0)}°`}</text>
    </Root>
  )
}

// ── Race-control flags (decoded iRacing SessionFlags bitfield) ────────────────
const FLAG_BITS: { key: string; bit: number; label: string; color: string }[] = [
  { key: 'green', bit: 0x00000004, label: 'GREEN', color: C.green },
  { key: 'yellow', bit: 0x00000008, label: 'YELLOW', color: C.amber },
  { key: 'blue', bit: 0x00000020, label: 'BLUE', color: C.blue },
  { key: 'white', bit: 0x00000002, label: 'WHITE', color: C.text },
  { key: 'checkered', bit: 0x00000001, label: 'CHK', color: C.text },
  { key: 'red', bit: 0x00000010, label: 'RED', color: C.red },
  { key: 'black', bit: 0x00010000, label: 'BLACK', color: C.muted },
  { key: 'repair', bit: 0x00100000, label: 'REPAIR', color: C.amber },
  { key: 'dq', bit: 0x00020000, label: 'DQ', color: C.red }
]

function RaceControlFlags({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const raw = num(snapshot?.sessionFlagsRaw)
  const bits = raw == null ? undefined : Math.trunc(raw)
  const cw = 124
  const ch = 64
  const gx = 12
  const gy = 12
  const x0 = 14
  const y0 = 14
  return (
    <Root width={width} height={height} snapshot={snapshot}>
      {FLAG_BITS.map((f, i) => {
        const col = i % 3
        const row = Math.floor(i / 3)
        const x = x0 + col * (cw + gx)
        const y = y0 + row * (ch + gy)
        const on = bits != null && (bits & f.bit) !== 0
        return (
          <g key={f.key} opacity={on ? 1 : 0.42}>
            <rect x={x} y={y} width={cw} height={ch} rx={10} fill={C.recess} stroke={on ? f.color : C.stroke} strokeWidth={on ? 3 : 1} />
            <rect x={x + 10} y={y + 10} width={cw - 20} height={8} rx={4} fill={on ? f.color : C.stroke} />
            <text x={x + cw / 2} y={y + 48} textAnchor="middle" fill={on ? f.color : C.dim} fontFamily={FONT_LABEL} fontSize={22} fontWeight={900} letterSpacing={1} {...LEGIBLE}>{f.label}</text>
          </g>
        )
      })}
    </Root>
  )
}

// ── Shift point (optimal upshift RPM cue) ─────────────────────────────────────
function ShiftPoint({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const shiftRpm = num(snapshot?.shiftRpm)
  const rpm = num(snapshot?.rpm)
  const maxRpm = num(snapshot?.maxRpm)
  const f = rpm != null && maxRpm != null && maxRpm > 0 ? clamp01(rpm / maxRpm) : 0
  const shiftF = shiftRpm != null && maxRpm != null && maxRpm > 0 ? clamp01(shiftRpm / maxRpm) : undefined
  const upshift = snapshot?.revLights?.blink ?? (shiftRpm != null && rpm != null && rpm >= shiftRpm)
  const near = shiftRpm != null && rpm != null && rpm >= shiftRpm * 0.95
  const color = upshift ? SHIFT_STROBE_BLUE : near ? C.amber : C.green
  const barX = 40
  const barY = 150
  const barW = W - 80
  const markX = shiftF == null ? undefined : barX + barW * shiftF
  return (
    <Root width={width} height={height} snapshot={snapshot}>
      <g>
        {upshift ? <ShiftStrobe active={upshift} /> : null}
        <BigNum x={W / 2} y={104} value={upshift ? 'SHIFT' : shiftRpm == null ? '—' : fixed(shiftRpm, 0)} unit={upshift ? undefined : 'rpm'} color={color} size={upshift ? 86 : 66} />
      </g>
      <Bar x={barX} y={barY} w={barW} h={18} f={f} color={color} />
      {markX != null ? <rect x={markX - 2} y={barY - 8} width={4} height={34} rx={2} fill={SHIFT_STROBE_BLUE} /> : null}
      <text x={W / 2} y={206} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={20} fontWeight={800} letterSpacing={2} {...LEGIBLE}>
        {rpm == null ? 'UPSHIFT' : `${fixed(rpm, 0)} rpm`}
      </text>
    </Root>
  )
}

// ── Engine telltale (run / off / stall) ───────────────────────────────────────
function EngineTelltale({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const running = snapshot?.engineRunning
  const rpm = num(snapshot?.rpm)
  const state = running == null ? '—' : running ? (rpm != null && rpm < 300 ? 'STALL' : 'RUN') : 'OFF'
  const color = state === 'RUN' ? C.green : state === 'STALL' ? C.red : state === 'OFF' ? C.muted : C.dim
  const cx = 148
  const cy = 116
  return (
    <Root width={width} height={height} snapshot={snapshot}>
      <g opacity={state === '—' ? 0.5 : 1}>
        <rect x={cx - 46} y={cy - 34} width={92} height={68} rx={12} fill="rgba(255,255,255,0.05)" stroke={color} strokeWidth={4} />
        <circle cx={cx - 22} cy={cy - 46} r={9} fill="none" stroke={color} strokeWidth={4} />
        <rect x={cx - 30} y={cy - 12} width={60} height={24} rx={5} fill={color} opacity={0.85} />
        <rect x={cx + 30} y={cy - 6} width={18} height={12} rx={3} fill={color} />
        <rect x={cx - 48} y={cy - 6} width={18} height={12} rx={3} fill={color} />
      </g>
      <BigNum x={318} y={112} value={state} color={color} size={state.length > 3 ? 48 : 64} />
      <text x={318} y={152} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={20} fontWeight={800} letterSpacing={3} {...LEGIBLE}>ENGINE</text>
    </Root>
  )
}

// ── Spotter (raw carLeftRight enum: 0 off,1 clear,2 L,3 R,4 both,5 2L,6 2R) ────
function SpotterRaw({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const raw = num(snapshot?.carLeftRightRaw)
  const e = raw == null ? undefined : Math.trunc(raw)
  const left = e === 2 || e === 4 || e === 5
  const right = e === 3 || e === 4 || e === 6
  const active = left || right
  const label = e == null ? '—' : e === 2 ? 'CAR LEFT' : e === 3 ? 'CAR RIGHT' : e === 4 ? 'BOTH' : e === 5 ? '2 CARS L' : e === 6 ? '2 CARS R' : 'CLEAR'
  const leftColor = e === 5 ? C.red : left ? C.amber : C.recess
  const rightColor = e === 6 ? C.red : right ? C.amber : C.recess
  const cx = W / 2
  return (
    <Root width={width} height={height} snapshot={snapshot}>
      <path d="M188 56 h44 l24 52 v58 l-20 26 h-52 l-20 -26 v-58 z" fill="rgba(255,255,255,0.06)" stroke={active ? C.text : C.dim} strokeWidth={5} strokeLinejoin="round" opacity={active ? 0.95 : 0.5} />
      <path d="M186 112 h48 M180 154 h60" stroke={active ? C.text : C.dim} strokeWidth={4} strokeLinecap="round" opacity={active ? 0.85 : 0.36} />
      <path d="M60 118 L134 66 V100 H172 V140 H134 V172 Z" fill={leftColor} stroke={left ? leftColor : C.stroke} strokeWidth={3} opacity={left ? 1 : 0.32} />
      <path d="M360 118 L286 66 V100 H248 V140 H286 V172 Z" fill={rightColor} stroke={right ? rightColor : C.stroke} strokeWidth={3} opacity={right ? 1 : 0.32} />
      <text x={cx} y={222} textAnchor="middle" fill={active ? (e === 5 || e === 6 ? C.red : C.amber) : C.dim} fontFamily={FONT_LABEL} fontSize={36} fontWeight={900} letterSpacing={2} {...legibleStroke(36)}>{label}</text>
    </Root>
  )
}

// ── Session tag (unique session identity) ─────────────────────────────────────
function sessionTagSize(tag: string): number {
  if (tag === '—') return 72
  return Math.max(32, Math.min(72, (W - 96) / (tag.length * 0.92)))
}

function SessionTag({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const id = num(snapshot?.sessionUniqueId)
  const tag = id == null ? '—' : `#${Math.trunc(id)}`
  const color = id == null ? C.dim : C.cyan
  return (
    <Root width={width} height={height} snapshot={snapshot}>
      <rect x={40} y={70} width={W - 80} height={100} rx={16} fill="rgba(255,255,255,0.04)" stroke={C.stroke} strokeWidth={1.5} />
      <BigNum x={W / 2} y={142} value={tag} color={color} size={sessionTagSize(tag)} />
      <text x={W / 2} y={196} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={22} fontWeight={800} letterSpacing={4} {...LEGIBLE}>SESSION ID</text>
    </Root>
  )
}

export const slipAngleWidget: HifiWidgetModule = {
  id: 'slipAngle',
  title: 'Slip Angle',
  description: 'Chassis slip angle derived from the car-frame velocity vector (velocityX/velocityY).',
  category: 'chassis',
  tags: ['slip', 'chassis', 'velocity', 'vector', 'derived', 'clean'],
  requires: ['velocityX', 'velocityY'],
  defaultSize: { w: W, h: H },
  render: (props) => <SlipAngle {...props} />
}

export const steeringLockWidget: HifiWidgetModule = {
  id: 'steeringLock',
  title: 'Steering Lock',
  description: 'Steering input as a percentage of the available lock (steerAngle ÷ steeringAngleMax).',
  category: 'inputs',
  tags: ['steering', 'lock', 'percent', 'gauge', 'derived', 'clean'],
  requires: ['steerAngleDeg', 'steeringAngleMaxDeg'],
  defaultSize: { w: W, h: H },
  render: (props) => <SteeringLock {...props} />
}

export const rotationRatesWidget: HifiWidgetModule = {
  id: 'rotationRates',
  title: 'Rotation Rates',
  description: 'Three-axis body rotation rates (yaw, pitch, roll) in degrees per second.',
  category: 'chassis',
  tags: ['yaw', 'pitch', 'roll', 'rate', 'chassis', 'derived', 'clean'],
  requires: ['yawRateRadSec', 'pitchRateRadSec', 'rollRateRadSec'],
  defaultSize: { w: W, h: H },
  render: (props) => <RotationRates {...props} />
}

export const carAttitudeWidget: HifiWidgetModule = {
  id: 'carAttitude',
  title: 'Car Attitude',
  description: 'Artificial-horizon pitch and roll attitude with a compass heading readout.',
  category: 'chassis',
  tags: ['attitude', 'pitch', 'roll', 'heading', 'horizon', 'derived', 'clean'],
  requires: ['pitchRad', 'rollRad', 'yawRad'],
  defaultSize: { w: W, h: H },
  render: (props) => <CarAttitude {...props} />
}

export const fuelLapsLeftWidget: HifiWidgetModule = {
  id: 'fuelLapsLeft',
  title: 'Fuel Laps Left',
  description: 'Estimated laps to empty from tank litres and fuel used per lap.',
  category: 'fuel',
  tags: ['fuel', 'laps', 'range', 'strategy', 'derived', 'clean'],
  requires: ['fuelLapsRemaining'],
  alternativeRequires: [['fuelLiters', 'fuelPerLapLiters']],
  defaultSize: { w: W, h: H },
  render: (props) => <FuelLapsLeft {...props} />
}

export const sunPositionWidget: HifiWidgetModule = {
  id: 'sunPosition',
  title: 'Sun Position',
  description: 'Sky-dome plot of the sun by altitude (height) and azimuth (compass direction).',
  category: 'weather',
  tags: ['sun', 'solar', 'altitude', 'azimuth', 'sky', 'derived', 'clean'],
  requires: ['solarAltitudeRad', 'solarAzimuthRad'],
  defaultSize: { w: W, h: H },
  render: (props) => <SunPosition {...props} />
}

export const gpsHeadingWidget: HifiWidgetModule = {
  id: 'gpsHeading',
  title: 'GPS & Heading',
  description: 'Geographic latitude/longitude fix with a compass needle for heading relative to North.',
  category: 'map',
  tags: ['gps', 'lat', 'lon', 'heading', 'compass', 'derived', 'clean'],
  requires: ['lat', 'lon', 'yawNorth'],
  defaultSize: { w: W, h: H },
  render: (props) => <GpsHeading {...props} />
}

export const raceControlFlagsWidget: HifiWidgetModule = {
  id: 'raceControlFlags',
  title: 'Race Control Flags',
  description: 'Decoded iRacing session flag bitfield shown as a panel of lit flag lamps.',
  category: 'session',
  tags: ['flags', 'race-control', 'session', 'lamps', 'derived', 'clean'],
  requires: ['sessionFlagsRaw'],
  defaultSize: { w: W, h: H },
  render: (props) => <RaceControlFlags {...props} />
}

export const shiftPointWidget: HifiWidgetModule = {
  id: 'shiftPoint',
  title: 'Shift Point',
  description: 'Optimal upshift RPM cue with a live RPM bar and a strong-blue SHIFT prompt.',
  category: 'engine',
  tags: ['shift', 'upshift', 'rpm', 'engine', 'derived', 'clean'],
  requires: ['shiftRpm', 'rpm', 'maxRpm', 'revLights'],
  defaultSize: { w: W, h: H },
  render: (props) => <ShiftPoint {...props} />
}

export const engineTelltaleWidget: HifiWidgetModule = {
  id: 'engineTelltale',
  title: 'Engine Telltale',
  description: 'Engine running lamp showing run, off, or stalled from the engine state and RPM.',
  category: 'engine',
  tags: ['engine', 'running', 'ignition', 'telltale', 'derived', 'clean'],
  requires: ['engineRunning', 'rpm'],
  defaultSize: { w: W, h: H },
  render: (props) => <EngineTelltale {...props} />
}

export const spotterRawWidget: HifiWidgetModule = {
  id: 'spotterRaw',
  title: 'Spotter',
  description: 'Full left/right proximity spotter from the raw car-left-right enum, including two-wide.',
  category: 'gap',
  tags: ['spotter', 'proximity', 'left-right', 'gap', 'derived', 'clean'],
  requires: ['carLeftRightRaw'],
  defaultSize: { w: W, h: H },
  render: (props) => <SpotterRaw {...props} />
}

export const sessionTagWidget: HifiWidgetModule = {
  id: 'sessionTag',
  title: 'Session ID',
  description: 'Unique iRacing session identity tag (useful for team fuel sharing and logs).',
  category: 'session',
  tags: ['session', 'id', 'identity', 'tag', 'derived', 'clean'],
  requires: ['sessionUniqueId'],
  defaultSize: { w: W, h: H },
  render: (props) => <SessionTag {...props} />
}
