// ── themedDerived — per-car themed versions of the derived telemetry widgets ──
// The 12 irDerived combined-channel widgets (slip angle, steering lock, rotation
// rates, attitude, fuel laps-left, sun position, GPS heading, race-control flags,
// shift point, engine telltale, spotter, session id) rendered in each car family's
// signature palette, matching the themed cluster/rev signatures. Twelve
// palette-parametrized renderers × six car families = 72 themed widgets, generated
// from one source of truth so they stay consistent and NaN-safe.
import type { ReactElement, ReactNode } from 'react'
import type { HifiWidgetModule, HifiWidgetProps, TelemetryField } from '../types'
import {
  Bar,
  BigNum,
  C,
  FONT_BIG,
  FONT_LABEL,
  FONT_NUM,
  GaugeArc,
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

export interface ThemePal {
  key: string
  name: string
  suffix: string
  main: string
  accent: string
  aux: string
  ramp: string[]
}

const CARS: ThemePal[] = [
  { key: 'ferrari', name: 'Ferrari', suffix: 'Ferrari', main: '#DC0000', accent: '#FFD21F', aux: '#1B7CFF', ramp: ['#00e676', '#ffd21f', '#ff8a00', '#DC0000'] },
  { key: 'porsche', name: 'Porsche', suffix: 'Porsche', main: '#E30613', accent: '#F5F7FA', aux: '#7fd4ff', ramp: ['#ffffff', '#f5f7fa', '#ff3845', '#E30613'] },
  { key: 'amg', name: 'Mercedes-AMG', suffix: 'Amg', main: '#00A19B', accent: '#D6FFF9', aux: '#ff3045', ramp: ['#00A19B', '#58ffe8', '#ffd42a', '#ff3045'] },
  { key: 'mclaren', name: 'McLaren', suffix: 'Mclaren', main: '#FF8000', accent: '#FFE15A', aux: '#00e5ff', ramp: ['#00ffd0', '#8cff00', '#ffd600', '#FF8000', '#ff2b1f'] },
  { key: 'corvette', name: 'Corvette', suffix: 'Corvette', main: '#FFD700', accent: '#F33A22', aux: '#f8f8f8', ramp: ['#20ff60', '#FFD700', '#ff9a00', '#F33A22'] },
  { key: 'lambo', name: 'Lamborghini', suffix: 'Lambo', main: '#A6D608', accent: '#7A3CFF', aux: '#ff2f45', ramp: ['#A6D608', '#dfff35', '#7A3CFF', '#ff2f45'] }
]

function Root({ width, height, children }: HifiWidgetProps & { children: ReactNode }): ReactElement {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={width ?? W} height={height ?? H} preserveAspectRatio="xMidYMid meet" role="img">
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

/** Small themed accent underline drawn beneath a hero value. */
function AccentBar({ pal, cx, y, w }: { pal: ThemePal; cx: number; y: number; w: number }): ReactElement {
  return <rect x={cx - w / 2} y={y} width={w} height={5} rx={2.5} fill={pal.accent} opacity={0.85} />
}

function Label({ text, x, y, color = C.dim }: { text: string; x: number; y: number; color?: string }): ReactElement {
  return (
    <text x={x} y={y} textAnchor="middle" fill={color} fontFamily={FONT_LABEL} fontSize={22} fontWeight={800} letterSpacing={3} stroke="rgba(0,0,0,0.55)" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">
      {text}
    </text>
  )
}

// ── 1. Slip angle ─────────────────────────────────────────────────────────────
function slipAngle(pal: ThemePal) {
  return function ThemedSlipAngle({ width, height, snapshot }: HifiWidgetProps): ReactElement {
    const vx = num(snapshot?.velocityX)
    const vy = num(snapshot?.velocityY)
    const has = vx != null && vy != null
    const slipRad = has ? Math.atan2(vy as number, vx as number) : undefined
    const slipDeg = slipRad == null ? undefined : slipRad * RAD2DEG
    const hot = slipDeg != null && Math.abs(slipDeg) >= 8
    const color = slipDeg == null ? C.dim : hot ? pal.accent : pal.main
    const cx = 148
    const cy = 118
    const len = 74
    const ang = slipRad ?? 0
    const ex = cx + Math.sin(ang) * len
    const ey = cy - Math.cos(ang) * len
    return (
      <Root width={width} height={height} snapshot={snapshot}>
        <rect x={cx - 22} y={cy - 42} width={44} height={84} rx={12} fill="rgba(255,255,255,0.06)" stroke={pal.main} strokeWidth={3} opacity={0.75} />
        <line x1={cx} y1={cy} x2={cx} y2={cy - len} stroke={C.stroke} strokeWidth={2} strokeDasharray="4 5" />
        {has ? <line x1={cx} y1={cy} x2={ex} y2={ey} stroke={color} strokeWidth={5} strokeLinecap="round" /> : null}
        {has ? <circle cx={ex} cy={ey} r={6} fill={pal.accent} /> : null}
        <BigNum x={320} y={116} value={slipDeg == null ? '—' : fixed(Math.abs(slipDeg), 1)} unit="°" color={color} size={70} />
        <Label text="SLIP" x={320} y={156} />
      </Root>
    )
  }
}

// ── 2. Steering lock ──────────────────────────────────────────────────────────
function steeringLock(pal: ThemePal) {
  return function ThemedSteeringLock({ width, height, snapshot }: HifiWidgetProps): ReactElement {
    const ang = num(snapshot?.steerAngleDeg)
    const max = num(snapshot?.steeringAngleMaxDeg)
    const pct = ang != null && max != null && max > 0 ? clamp01(Math.abs(ang) / max) : undefined
    const color = pct == null ? C.dim : pct >= 0.9 ? pal.accent : pal.main
    return (
      <Root width={width} height={height} snapshot={snapshot}>
        <GaugeArc cx={W / 2} cy={140} r={92} thickness={20} f={pct ?? 0} color={color} />
        <BigNum x={W / 2} y={150} value={pct == null ? '—' : fixed(pct * 100, 0)} unit="%" color={color} size={64} />
        <Label text={ang == null || max == null ? 'LOCK' : `${fixed(Math.abs(ang), 0)}° / ${fixed(max, 0)}°`} x={W / 2} y={196} />
      </Root>
    )
  }
}

// ── 3. Rotation rates ─────────────────────────────────────────────────────────
function rotationRates(pal: ThemePal) {
  return function ThemedRotationRates({ width, height, snapshot }: HifiWidgetProps): ReactElement {
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
          const ff = r.v == null ? 0 : Math.max(-1, Math.min(1, r.v / r.max))
          const barW = Math.abs(ff) * half
          const bx = ff >= 0 ? cx : cx - barW
          const color = r.v == null ? C.dim : pal.main
          return (
            <g key={r.label}>
              <text x={26} y={y + 22} fill={C.dim} fontFamily={FONT_LABEL} fontSize={24} fontWeight={900} letterSpacing={2} stroke="rgba(0,0,0,0.55)" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">{r.label}</text>
              <rect x={cx - half} y={y} width={half * 2} height={16} rx={8} fill={C.recess} stroke={C.stroke} strokeWidth={0.5} />
              <rect x={bx} y={y} width={barW} height={16} rx={8} fill={color} />
              <rect x={cx - 0.75} y={y - 4} width={1.5} height={24} fill={pal.accent} />
              <text x={408} y={y - 4} textAnchor="end" fill={color} fontFamily={FONT_NUM} fontSize={20} fontWeight={800} stroke="rgba(0,0,0,0.55)" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">
                {r.v == null ? '—' : `${r.v >= 0 ? '+' : ''}${r.v.toFixed(0)}°/s`}
              </text>
            </g>
          )
        })}
      </Root>
    )
  }
}

// ── 4. Car attitude ───────────────────────────────────────────────────────────
function carAttitude(pal: ThemePal) {
  return function ThemedCarAttitude({ width, height, snapshot }: HifiWidgetProps): ReactElement {
    const pitch = deg(num(snapshot?.pitchRad))
    const roll = deg(num(snapshot?.rollRad))
    const yawDeg = normHeading(num(snapshot?.yawRad))
    const cx = 150
    const cy = 118
    const r = 84
    const rollDeg = roll ?? 0
    const pitchOffset = Math.max(-r, Math.min(r, (pitch ?? 0) * 2))
    const clipId = `themedDerivedAtt-${pal.key}`
    return (
      <Root width={width} height={height} snapshot={snapshot}>
        <defs>
          <clipPath id={clipId}>
            <circle cx={cx} cy={cy} r={r} />
          </clipPath>
        </defs>
        <circle cx={cx} cy={cy} r={r} fill="rgba(255,255,255,0.04)" stroke={pal.main} strokeWidth={3} opacity={0.8} />
        <g clipPath={`url(#${clipId})`}>
          <g transform={`rotate(${-rollDeg} ${cx} ${cy}) translate(0 ${pitchOffset})`}>
            <rect x={cx - r * 1.6} y={cy - r * 2} width={r * 3.2} height={r * 2} fill={pal.aux} opacity={0.18} />
            <rect x={cx - r * 1.6} y={cy} width={r * 3.2} height={r * 2} fill="rgba(120,90,50,0.22)" />
            <line x1={cx - r * 1.6} y1={cy} x2={cx + r * 1.6} y2={cy} stroke={C.text} strokeWidth={3} />
          </g>
        </g>
        <line x1={cx - 26} y1={cy} x2={cx - 8} y2={cy} stroke={pal.accent} strokeWidth={4} strokeLinecap="round" />
        <line x1={cx + 8} y1={cy} x2={cx + 26} y2={cy} stroke={pal.accent} strokeWidth={4} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={3} fill={pal.accent} />
        <BigNum x={322} y={104} value={yawDeg == null ? '—' : fixed(yawDeg, 0)} unit="°" color={pal.main} size={54} />
        <Label text="HDG" x={322} y={138} />
        <text x={322} y={186} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={19} fontWeight={700} stroke="rgba(0,0,0,0.55)" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">
          {`P ${fixed(pitch, 0)}°  R ${fixed(roll, 0)}°`}
        </text>
      </Root>
    )
  }
}

// ── 5. Fuel laps left ─────────────────────────────────────────────────────────
function fuelLapsLeft(pal: ThemePal) {
  return function ThemedFuelLapsLeft({ width, height, snapshot, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
    const laps = fuelLapsRemainingOf(snapshot)
    const perLapLiters = fuelPerLapLitersOf(snapshot)
    const color = laps == null ? C.dim : laps < 2 ? pal.accent : pal.main
    const perLapReading = formatMeasurement(perLapLiters, 'fuel-per-lap-l', unitSystem, { decimals: 2 })
    return (
      <Root width={width} height={height} snapshot={snapshot}>
        <BigNum x={W / 2} y={126} value={laps == null ? '—' : fixed(laps, 1)} color={color} size={104} />
        {laps != null ? <AccentBar pal={pal} cx={W / 2} y={148} w={150} /> : null}
        <Label text="LAPS LEFT" x={W / 2} y={182} />
        <text x={W / 2} y={214} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={20} fontWeight={700} stroke="rgba(0,0,0,0.55)" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">
          {perLapLiters == null ? '—' : `${perLapReading.display} ${perLapReading.unit}`}
        </text>
      </Root>
    )
  }
}

// ── 6. Sun position ───────────────────────────────────────────────────────────
function sunPosition(pal: ThemePal) {
  return function ThemedSunPosition({ width, height, snapshot }: HifiWidgetProps): ReactElement {
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
    return (
      <Root width={width} height={height} snapshot={snapshot}>
        <path d={`M ${cx - R} ${horizonY} A ${R} ${R} 0 0 1 ${cx + R} ${horizonY}`} fill={pal.aux} fillOpacity={0.06} stroke={C.stroke} strokeWidth={2} />
        <line x1={cx - R} y1={horizonY} x2={cx + R} y2={horizonY} stroke={pal.main} strokeWidth={3} opacity={0.7} />
        {has && day ? (
          <>
            {Array.from({ length: 12 }, (_, i) => {
              const a = (Math.PI * 2 * i) / 12
              return <line key={i} x1={sx + Math.cos(a) * 22} y1={sy + Math.sin(a) * 22} x2={sx + Math.cos(a) * 32} y2={sy + Math.sin(a) * 32} stroke={pal.accent} strokeWidth={4} strokeLinecap="round" opacity={0.7} />
            })}
            <circle cx={sx} cy={sy} r={17} fill={pal.accent} />
          </>
        ) : null}
        {has && !day ? <circle cx={cx} cy={horizonY - 6} r={14} fill={C.muted} opacity={0.7} /> : null}
        <BigNum x={cx} y={horizonY + 40} value={altDeg == null ? '—' : fixed(altDeg, 0)} unit="°" color={pal.main} size={46} />
        <Label text={`SUN ALT · AZ ${azDeg == null ? '—' : `${fixed(azDeg, 0)}°`}`} x={cx} y={horizonY + 62} />
      </Root>
    )
  }
}

// ── 7. GPS heading ────────────────────────────────────────────────────────────
function fmtCoord(v: number | undefined, pos: string, neg: string): string {
  if (v == null) return '—'
  const hemi = v >= 0 ? pos : neg
  const a = Math.abs(v)
  const d = Math.floor(a)
  const m = (a - d) * 60
  return `${d}°${m.toFixed(3)}'${hemi}`
}

function gpsHeading(pal: ThemePal) {
  return function ThemedGpsHeading({ width, height, snapshot }: HifiWidgetProps): ReactElement {
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
        <circle cx={cx} cy={cy} r={r} fill="rgba(255,255,255,0.04)" stroke={pal.main} strokeWidth={3} opacity={0.8} />
        {['N', 'E', 'S', 'W'].map((d, i) => {
          const a = (i * Math.PI) / 2
          return (
            <text key={d} x={cx + Math.sin(a) * (r - 16)} y={cy - Math.cos(a) * (r - 16) + 7} textAnchor="middle" fill={d === 'N' ? pal.accent : C.dim} fontFamily={FONT_LABEL} fontSize={20} fontWeight={900} stroke="rgba(0,0,0,0.55)" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">{d}</text>
          )
        })}
        {hdg != null ? <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={pal.main} strokeWidth={5} strokeLinecap="round" /> : null}
        <circle cx={cx} cy={cy} r={5} fill={pal.accent} />
        <text x={222} y={94} fill={C.text} fontFamily={FONT_NUM} fontSize={28} fontWeight={800} stroke="rgba(0,0,0,0.55)" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">{fmtCoord(lat, 'N', 'S')}</text>
        <text x={222} y={136} fill={C.text} fontFamily={FONT_NUM} fontSize={28} fontWeight={800} stroke="rgba(0,0,0,0.55)" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">{fmtCoord(lon, 'E', 'W')}</text>
        <text x={222} y={190} fill={pal.main} fontFamily={FONT_BIG} fontSize={40} fontWeight={800} {...legibleStroke(40)}>{hdg == null ? '—' : `${fixed(hdg, 0)}°`}</text>
      </Root>
    )
  }
}

// ── 8. Race control flags ─────────────────────────────────────────────────────
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

function raceControlFlags(pal: ThemePal) {
  return function ThemedRaceControlFlags({ width, height, snapshot }: HifiWidgetProps): ReactElement {
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
              <rect x={x} y={y} width={cw} height={ch} rx={10} fill={C.recess} stroke={on ? f.color : pal.main} strokeWidth={on ? 3 : 1} strokeOpacity={on ? 1 : 0.5} />
              <rect x={x + 10} y={y + 10} width={cw - 20} height={8} rx={4} fill={on ? f.color : pal.main} opacity={on ? 1 : 0.4} />
              <text x={x + cw / 2} y={y + 48} textAnchor="middle" fill={on ? f.color : C.dim} fontFamily={FONT_LABEL} fontSize={22} fontWeight={900} stroke="rgba(0,0,0,0.55)" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">{f.label}</text>
            </g>
          )
        })}
      </Root>
    )
  }
}

// ── 9. Shift point ────────────────────────────────────────────────────────────
function shiftPoint(pal: ThemePal) {
  return function ThemedShiftPoint({ width, height, snapshot }: HifiWidgetProps): ReactElement {
    const shiftRpm = num(snapshot?.shiftRpm)
    const rpm = num(snapshot?.rpm)
    const maxRpm = num(snapshot?.maxRpm)
    const f = rpm != null && maxRpm != null && maxRpm > 0 ? clamp01(rpm / maxRpm) : 0
    const shiftF = shiftRpm != null && maxRpm != null && maxRpm > 0 ? clamp01(shiftRpm / maxRpm) : undefined
    const upshift = shiftRpm != null && rpm != null && rpm >= shiftRpm
    const near = shiftRpm != null && rpm != null && rpm >= shiftRpm * 0.95
    const color = upshift ? SHIFT_STROBE_BLUE : near ? pal.accent : pal.main
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
        <Label text={rpm == null ? 'UPSHIFT' : `${fixed(rpm, 0)} rpm`} x={W / 2} y={206} />
      </Root>
    )
  }
}

// ── 10. Engine telltale ───────────────────────────────────────────────────────
function engineTelltale(pal: ThemePal) {
  return function ThemedEngineTelltale({ width, height, snapshot }: HifiWidgetProps): ReactElement {
    const running = snapshot?.engineRunning
    const rpm = num(snapshot?.rpm)
    const state = running == null ? '—' : running ? (rpm != null && rpm < 300 ? 'STALL' : 'RUN') : 'OFF'
    const color = state === 'STALL' ? pal.accent : state === 'RUN' ? pal.main : state === 'OFF' ? C.muted : C.dim
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
        <Label text="ENGINE" x={318} y={152} />
      </Root>
    )
  }
}

// ── 11. Spotter (raw enum) ────────────────────────────────────────────────────
function spotterRaw(pal: ThemePal) {
  return function ThemedSpotterRaw({ width, height, snapshot }: HifiWidgetProps): ReactElement {
    const raw = num(snapshot?.carLeftRightRaw)
    const e = raw == null ? undefined : Math.trunc(raw)
    const left = e === 2 || e === 4 || e === 5
    const right = e === 3 || e === 4 || e === 6
    const active = left || right
    const label = e == null ? '—' : e === 2 ? 'CAR LEFT' : e === 3 ? 'CAR RIGHT' : e === 4 ? 'BOTH' : e === 5 ? '2 CARS L' : e === 6 ? '2 CARS R' : 'CLEAR'
    const leftColor = e === 5 ? pal.accent : left ? pal.main : C.recess
    const rightColor = e === 6 ? pal.accent : right ? pal.main : C.recess
    const cx = W / 2
    return (
      <Root width={width} height={height} snapshot={snapshot}>
        <path d="M188 56 h44 l24 52 v58 l-20 26 h-52 l-20 -26 v-58 z" fill="rgba(255,255,255,0.06)" stroke={active ? C.text : C.dim} strokeWidth={5} strokeLinejoin="round" opacity={active ? 0.95 : 0.5} />
        <path d="M186 112 h48 M180 154 h60" stroke={active ? C.text : C.dim} strokeWidth={4} strokeLinecap="round" opacity={active ? 0.85 : 0.36} />
        <path d="M60 118 L134 66 V100 H172 V140 H134 V172 Z" fill={leftColor} stroke={left ? leftColor : C.stroke} strokeWidth={3} opacity={left ? 1 : 0.32} />
        <path d="M360 118 L286 66 V100 H248 V140 H286 V172 Z" fill={rightColor} stroke={right ? rightColor : C.stroke} strokeWidth={3} opacity={right ? 1 : 0.32} />
        <text x={cx} y={222} textAnchor="middle" fill={active ? pal.main : C.dim} fontFamily={FONT_LABEL} fontSize={36} fontWeight={900} letterSpacing={2} {...legibleStroke(36)}>{label}</text>
      </Root>
    )
  }
}

// ── 12. Session tag ───────────────────────────────────────────────────────────
function sessionTagSize(tag: string): number {
  if (tag === '—') return 72
  return Math.max(32, Math.min(72, (W - 96) / (tag.length * 0.92)))
}

function sessionTag(pal: ThemePal) {
  return function ThemedSessionTag({ width, height, snapshot }: HifiWidgetProps): ReactElement {
    const id = num(snapshot?.sessionUniqueId)
    const tag = id == null ? '—' : `#${Math.trunc(id)}`
    const color = id == null ? C.dim : pal.main
    return (
      <Root width={width} height={height} snapshot={snapshot}>
        <rect x={40} y={70} width={W - 80} height={100} rx={16} fill="rgba(255,255,255,0.04)" stroke={pal.main} strokeWidth={1.5} strokeOpacity={0.6} />
        <BigNum x={W / 2} y={140} value={tag} color={color} size={sessionTagSize(tag)} />
        {id != null ? <AccentBar pal={pal} cx={W / 2} y={158} w={130} /> : null}
        <Label text="SESSION ID" x={W / 2} y={196} />
      </Root>
    )
  }
}

interface DerivedSpec {
  base: string
  title: string
  category: string
  requires: TelemetryField[]
  alternativeRequires?: TelemetryField[][]
  build: (pal: ThemePal) => (props: HifiWidgetProps) => ReactElement
  tags: string[]
}

const SPECS: DerivedSpec[] = [
  { base: 'slipAngle', title: 'Slip Angle', category: 'chassis', requires: ['velocityX', 'velocityY'], build: slipAngle, tags: ['slip', 'chassis', 'velocity'] },
  { base: 'steeringLock', title: 'Steering Lock', category: 'inputs', requires: ['steerAngleDeg', 'steeringAngleMaxDeg'], build: steeringLock, tags: ['steering', 'lock', 'gauge'] },
  { base: 'rotationRates', title: 'Rotation Rates', category: 'chassis', requires: ['yawRateRadSec', 'pitchRateRadSec', 'rollRateRadSec'], build: rotationRates, tags: ['yaw', 'pitch', 'roll', 'rate'] },
  { base: 'carAttitude', title: 'Car Attitude', category: 'chassis', requires: ['pitchRad', 'rollRad', 'yawRad'], build: carAttitude, tags: ['attitude', 'horizon', 'heading'] },
  { base: 'fuelLapsLeft', title: 'Fuel Laps Left', category: 'fuel', requires: ['fuelLapsRemaining'], alternativeRequires: [['fuelLiters', 'fuelPerLapLiters']], build: fuelLapsLeft, tags: ['fuel', 'laps', 'range'] },
  { base: 'sunPosition', title: 'Sun Position', category: 'weather', requires: ['solarAltitudeRad', 'solarAzimuthRad'], build: sunPosition, tags: ['sun', 'solar', 'sky'] },
  { base: 'gpsHeading', title: 'GPS & Heading', category: 'map', requires: ['lat', 'lon', 'yawNorth'], build: gpsHeading, tags: ['gps', 'heading', 'compass'] },
  { base: 'raceControlFlags', title: 'Race Control Flags', category: 'session', requires: ['sessionFlagsRaw'], build: raceControlFlags, tags: ['flags', 'race-control'] },
  { base: 'shiftPoint', title: 'Shift Point', category: 'engine', requires: ['shiftRpm', 'rpm', 'maxRpm'], build: shiftPoint, tags: ['shift', 'upshift', 'rpm'] },
  { base: 'engineTelltale', title: 'Engine Telltale', category: 'engine', requires: ['engineRunning', 'rpm'], build: engineTelltale, tags: ['engine', 'telltale'] },
  { base: 'spotterRaw', title: 'Spotter', category: 'gap', requires: ['carLeftRightRaw'], build: spotterRaw, tags: ['spotter', 'proximity'] },
  { base: 'sessionTag', title: 'Session ID', category: 'session', requires: ['sessionUniqueId'], build: sessionTag, tags: ['session', 'id'] }
]

/** 72 themed derived widgets: 12 combined-channel widgets × 6 car families. */
export const THEMED_DERIVED_WIDGETS: HifiWidgetModule[] = CARS.flatMap((car) =>
  SPECS.map((spec) => ({
    id: `${spec.base}${car.suffix}`,
    title: `${car.name} ${spec.title}`,
    description: `${car.name}-themed ${spec.title.toLowerCase()} widget in the car's signature palette.`,
    category: spec.category,
    tags: [...spec.tags, car.key, 'themed', 'derived', 'clean'],
    requires: spec.requires,
    alternativeRequires: spec.alternativeRequires,
    defaultSize: { w: W, h: H },
    render: spec.build(car)
  }))
)
