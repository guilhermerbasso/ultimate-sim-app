// ── EnduranceCluster ──────────────────────────────────────────────────────────
// Race-car endurance/IMSA dashboard matching ref-endurance-1024x600.png. Pure SVG
// on a 1024x600 viewBox, SSR-safe and NaN-safe: absent telemetry renders as em-dash.
import { type ReactElement, type ReactNode } from 'react'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import { formatMeasurement, type UnitSystem } from '../../../shared/units'
import { useUnitSystem } from '../lib/units'
import { SHIFT_STROBE_BLUE, ShiftStrobe, resolveRevLightPct, resolveRevLightState } from '../lib/rev-lights'

const W = 1024
const H = 600
const ERS_MJ_MAX = 4

const COL = {
  bg: '#000000',
  shell: '#07090b',
  panel: '#050708',
  panel2: '#090c0f',
  line: 'rgba(175,205,232,0.22)',
  lineStrong: 'rgba(175,205,232,0.34)',
  text: '#f2f4f7',
  dim: '#7390b7',
  muted: '#5d7088',
  green: '#5fd24a',
  cyan: '#56dcf4',
  amber: '#f2a92e',
  red: '#ff3b3b'
}

function n(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const p = Number.parseFloat(v)
    return Number.isFinite(p) ? p : undefined
  }
  return undefined
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0
}

function fixed(v: number | undefined, d = 0): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—'
}

function signed(v: number | undefined, d = 3): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(d)}`
}

function lapTime(sec: number | undefined): string {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return '—'
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s.toFixed(3).padStart(6, '0')}`
}

function pos(v: number | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? String(Math.trunc(v)) : '—'
}

function tempColor(t: number | undefined, kind: 'tyre' | 'brake'): string {
  if (typeof t !== 'number' || !Number.isFinite(t)) return COL.dim
  if (kind === 'brake') return t > 650 ? COL.red : t > 500 ? COL.amber : COL.red
  if (t < 70) return COL.cyan
  if (t <= 95) return COL.cyan
  if (t <= 105) return COL.amber
  return COL.red
}

function Panel({ x, y, w, h, r = 12, children }: { x: number; y: number; w: number; h: number; r?: number; children?: ReactNode }): ReactElement {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={r} fill={COL.panel} stroke={COL.line} strokeWidth={1.4} />
      <rect x={x + 2} y={y + 2} width={w - 4} height={h - 4} rx={Math.max(2, r - 2)} fill="none" stroke="rgba(255,255,255,0.035)" />
      {children}
    </g>
  )
}

function Label({ x, y, children, anchor = 'start', size = 17 }: { x: number; y: number; children: ReactNode; anchor?: 'start' | 'middle' | 'end'; size?: number }): ReactElement {
  return (
    <text x={x} y={y} textAnchor={anchor} fill={COL.dim} fontFamily="'Rajdhani','Barlow Condensed',sans-serif" fontSize={size} fontWeight={800} letterSpacing={4}>
      {children}
    </text>
  )
}

function LedStrip({ pct, blink }: { pct: number; blink?: boolean }): ReactElement {
  const count = 19
  const state = resolveRevLightState(pct, blink)
  const lit = state.atShiftPoint ? count : Math.round(state.pct * count)
  const leds: ReactElement[] = []
  for (let i = 0; i < count; i++) {
    const zone = i / (count - 1)
    const c = state.atShiftPoint ? SHIFT_STROBE_BLUE : zone < 0.34 ? COL.green : zone < 0.73 ? '#ffca25' : COL.red
    const on = i < lit
    leds.push(
      <g key={i}>
        <circle cx={164 + i * 38.5} cy={56} r={on ? 8.4 : 7.3} fill={on ? c : '#101315'} opacity={on ? 1 : 0.7} />
        {on && <circle cx={164 + i * 38.5} cy={56} r={14} fill={c} opacity={0.2} />}
      </g>
    )
  }
  return (
    <g>
      <ShiftStrobe active={state.atShiftPoint} />
      <rect x={140} y={34} width={744} height={46} rx={23} fill="#030405" stroke={COL.line} />
      {leds}
    </g>
  )
}

function SegBar({ x, y, w, h, pct, color, segments = 20 }: { x: number; y: number; w: number; h: number; pct: number; color: string; segments?: number }): ReactElement {
  const gap = 3
  const sw = (w - gap * (segments - 1)) / segments
  const lit = Math.round(clamp01(pct) * segments)
  return (
    <g>
      {Array.from({ length: segments }, (_, i) => (
        <rect key={i} x={x + i * (sw + gap)} y={y} width={sw} height={h} fill={i < lit ? color : '#151719'} opacity={i < lit ? 1 : 0.75} />
      ))}
    </g>
  )
}

function DeltaBar({ delta }: { delta: number | undefined }): ReactElement {
  const color = delta == null ? COL.dim : delta <= 0 ? COL.green : COL.red
  const f = delta == null ? 0.5 : clamp01(0.5 + delta / 3)
  return (
    <g>
      <text x={382} y={255} textAnchor="end" fill={COL.green} fontSize={20} fontWeight={800} fontFamily="'Chakra Petch',monospace">-1.5</text>
      <text x={698} y={255} fill={COL.red} fontSize={20} fontWeight={800} fontFamily="'Chakra Petch',monospace">+1.5</text>
      <rect x={400} y={240} width={84} height={12} fill="rgba(95,210,74,0.82)" />
      <rect x={489} y={240} width={84} height={12} fill="rgba(95,210,74,0.65)" />
      <rect x={578} y={240} width={40} height={12} fill="#191b1e" />
      <rect x={623} y={240} width={40} height={12} fill="#191b1e" />
      <rect x={668} y={240} width={30} height={12} fill="#191b1e" />
      <rect x={400 + 298 * f - 1.5} y={233} width={3} height={26} fill="#f0f3f5" />
      <text x={512} y={216} textAnchor="middle" fill={COL.dim} fontSize={17} fontWeight={800} letterSpacing={3} fontFamily="'Rajdhani',sans-serif">DELTA</text>
      <text x={552} y={224} fill={color} fontSize={44} fontWeight={800} fontFamily="'Chakra Petch',monospace">{signed(delta)}</text>
    </g>
  )
}

function CarIcon({ x, y }: { x: number; y: number }): ReactElement {
  return (
    <g transform={`translate(${x},${y}) scale(0.72)`} opacity={0.92}>
      <path d="M50 8 C72 14 82 38 78 72 L72 190 C70 206 62 214 50 216 C38 214 30 206 28 190 L22 72 C18 38 28 14 50 8 Z" fill="#161a1f" stroke="rgba(255,255,255,0.28)" />
      <path d="M36 42 C42 32 58 32 64 42 L70 82 L60 78 L40 78 L30 82 Z" fill="#0a0c0e" stroke="rgba(255,255,255,0.18)" />
      <path d="M34 100 C40 90 60 90 66 100 L66 166 C58 176 42 176 34 166 Z" fill="#35383c" stroke="rgba(255,255,255,0.16)" />
      <path d="M50 118 L55 202 H45 Z" fill="#050607" />
      <path d="M18 64 h-10 c-5 10 -5 32 0 42 h12 Z M82 64 h10 c5 10 5 32 0 42 h-12 Z M22 162 h-12 c-5 11 -5 35 0 46 h15 Z M78 162 h12 c5 11 5 35 0 46 h-15 Z" fill="#111417" stroke="rgba(255,255,255,0.18)" />
      <path d="M28 214 H72" stroke="rgba(255,255,255,0.35)" strokeWidth={2} />
    </g>
  )
}

function CornerBox({ x, y, label, tyre, brake, side, unitSystem }: { x: number; y: number; label: string; tyre: number | undefined; brake: number | undefined; side: 'left' | 'right'; unitSystem: UnitSystem }): ReactElement {
  const tyreX = side === 'left' ? x + 82 : x + 104
  const brakeX = side === 'left' ? x + 82 : x + 104
  const tyreReading = formatMeasurement(tyre, 'temperature-c', unitSystem, { decimals: 0 })
  const brakeReading = formatMeasurement(brake, 'temperature-c', unitSystem, { decimals: 0 })
  return (
    <g>
      <rect x={x} y={y} width={150} height={74} rx={7} fill="#060809" stroke={COL.line} />
      <text x={x + 10} y={y + 23} fill={COL.dim} fontSize={16} fontWeight={800} fontFamily="'Rajdhani',sans-serif">{label}</text>
      <text x={tyreX} y={y + 38} textAnchor="middle" fill={tempColor(tyre, 'tyre')} fontSize={25} fontWeight={800} fontFamily="'Chakra Petch',monospace">{tyreReading.display}</text>
      <text x={tyreX + 24} y={y + 37} fill={tempColor(tyre, 'tyre')} fontSize={13} fontWeight={800} fontFamily="'Rajdhani',sans-serif">{tyreReading.unit}</text>
      <path d={`M${x + 10} ${y + 47} H${x + 140}`} stroke={COL.line} />
      <text x={brakeX} y={y + 66} textAnchor="middle" fill={COL.red} fontSize={21} fontWeight={800} fontFamily="'Chakra Petch',monospace">{brakeReading.display}</text>
      <text x={brakeX + 24} y={y + 65} fill={COL.red} fontSize={12} fontWeight={800} fontFamily="'Rajdhani',sans-serif">{brakeReading.unit}</text>
      <rect x={side === 'left' ? x + 126 : x + 38} y={y + 12} width={8} height={52} fill={COL.cyan} />
      <rect x={side === 'left' ? x + 138 : x + 52} y={y + 12} width={8} height={52} fill={COL.cyan} opacity={0.9} />
    </g>
  )
}

function TyreBrakeMatrix({ s, unitSystem }: { s: TelemetrySnapshot; unitSystem: UnitSystem }): ReactElement {
  const lf = n(s.tyres?.lf?.tempC)
  const rf = n(s.tyres?.rf?.tempC)
  const lr = n(s.tyres?.lr?.tempC)
  const rr = n(s.tyres?.rr?.tempC)
  const blf = n(s.brakeTempC?.lf)
  const brf = n(s.brakeTempC?.rf)
  const blr = n(s.brakeTempC?.lr)
  const brr = n(s.brakeTempC?.rr)
  return (
    <Panel x={514} y={316} w={480} h={190}>
      <Label x={620} y={338} anchor="middle" size={16}>TYRE TEMP</Label>
      <Label x={906} y={338} anchor="middle" size={16}>BRAKE TEMP</Label>
      <CarIcon x={718} y={342} />
      <CornerBox x={528} y={346} label="FL" tyre={lf} brake={blf} side="left" unitSystem={unitSystem} />
      <CornerBox x={528} y={426} label="RL" tyre={lr} brake={blr} side="left" unitSystem={unitSystem} />
      <CornerBox x={832} y={346} label="FR" tyre={rf} brake={brf} side="right" unitSystem={unitSystem} />
      <CornerBox x={832} y={426} label="RR" tyre={rr} brake={brr} side="right" unitSystem={unitSystem} />
    </Panel>
  )
}

export interface EnduranceClusterProps {
  snapshot: TelemetrySnapshot
  width?: number
  height?: number
}

export function EnduranceCluster({ snapshot: s, width, height }: EnduranceClusterProps): ReactElement {
  const unitSystem = useUnitSystem()
  const speed = formatMeasurement(n(s.speedKmh), 'speed-kmh', unitSystem, { decimals: 0 })
  const shiftPct = resolveRevLightPct(s)
  const ersPct = n(s.ersBatteryPct)
  const ersFrac = ersPct != null ? (ersPct > 1 ? ersPct / 100 : ersPct) : 0
  const ersMj = ersPct != null ? ersFrac * ERS_MJ_MAX : undefined
  const delta = n(s.deltaToBestSec)
  const fuel = n(s.fuelLiters)
  const fuelReading = formatMeasurement(fuel, 'fuel-volume-l', unitSystem, { decimals: 1 })
  const fuelPerLap = n(s.fuelPerLap)
  const lapsToEmpty = fuel != null && fuelPerLap != null && fuelPerLap > 0 ? fuel / fuelPerLap : undefined
  const targetLap = n(s.estimatedLapTimeSec) ?? n(s.bestLapTimeSec)
  const stintLaps = n(s.currentLap)
  const position = n(s.position)
  const classPosition = n(s.classPosition)
  const gapAhead = n(s.relatives?.ahead?.gapSec)
  const gapBehind = n(s.relatives?.behind?.gapSec)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={width ?? W} height={height ?? H} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Endurance IMSA race dashboard">
      <defs>
        <filter id="enduranceGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <rect width={W} height={H} fill={COL.bg} />
      <path d="M22 80 C32 42 40 34 70 32 H954 C984 34 992 42 1002 80 V570 C1000 588 990 594 970 594 H54 C34 594 24 588 22 570 Z" fill={COL.shell} stroke="rgba(155,184,210,0.23)" strokeWidth={2} />
      <path d="M28 82 H996 M30 514 H994 M284 92 V300 M730 92 V300" stroke={COL.lineStrong} strokeWidth={1.2} />
      <LedStrip pct={shiftPct} blink={s.revLights?.blink} />

      <g filter="url(#enduranceGlow)">
        <Label x={120} y={122} anchor="middle">SPEED</Label>
        <text x={84} y={190} fill={COL.text} fontSize={74} fontWeight={800} fontFamily="'Chakra Petch','Michroma',sans-serif">{speed.display}</text>
        <text x={124} y={218} fill={COL.dim} fontSize={22} fontWeight={800} fontFamily="'Rajdhani',sans-serif">{speed.unit}</text>
        <path d="M42 236 H262" stroke={COL.lineStrong} />
        <Label x={128} y={260} anchor="middle" size={16}>ERS DEPLOY</Label>
        <text x={120} y={296} textAnchor="middle" fill={COL.green} fontSize={35} fontWeight={800} fontFamily="'Chakra Petch',monospace">{ersPct == null ? '—' : `${Math.round(ersFrac * 100)}%`}</text>
        <SegBar x={42} y={312} w={220} h={13} pct={ersFrac} color={COL.green} />
        <text x={128} y={350} textAnchor="middle" fill={COL.green} fontSize={18} fontWeight={800} fontFamily="'Chakra Petch',monospace">{ersMj == null ? '—' : `${ersMj.toFixed(1)} / ${ERS_MJ_MAX.toFixed(1)} MJ`}</text>

        <Label x={512} y={122} anchor="middle">CURRENT LAP</Label>
        <text x={512} y={192} textAnchor="middle" fill={COL.text} fontSize={72} fontWeight={800} fontFamily="'Chakra Petch',monospace">{lapTime(n(s.currentLapTimeSec))}</text>
        <path d="M324 235 H704" stroke={COL.lineStrong} />
        <DeltaBar delta={delta} />

        <Label x={770} y={122}>FUEL REMAINING</Label>
        <text x={770} y={168} fill={COL.text} fontSize={46} fontWeight={800} fontFamily="'Chakra Petch',monospace">{fuelReading.display}</text>
        <text x={870} y={168} fill={COL.dim} fontSize={20} fontWeight={800} fontFamily="'Rajdhani',sans-serif">{fuelReading.unit}</text>
        <path d="M748 182 H972" stroke={COL.lineStrong} />
        <Label x={770} y={206} size={15}>LAPS TO EMPTY</Label>
        <text x={770} y={246} fill={COL.text} fontSize={38} fontWeight={800} fontFamily="'Chakra Petch',monospace">{fixed(lapsToEmpty, 1)}</text>
        <path d="M748 260 H972" stroke={COL.lineStrong} />
        <Label x={770} y={276} size={15}>TARGET LAP</Label>
        <text x={770} y={308} fill={COL.text} fontSize={30} fontWeight={800} fontFamily="'Chakra Petch',monospace">{lapTime(targetLap)}</text>
      </g>

      <Panel x={28} y={326} w={480} h={180}>
        <Label x={268} y={350} anchor="middle">STINT</Label>
        <path d="M36 364 H500 M188 378 V486 M364 378 V486" stroke={COL.lineStrong} />
        <Label x={58} y={404} size={17}>STINT LAPS</Label>
        <text x={72} y={460} fill={COL.text} fontSize={54} fontWeight={800} fontFamily="'Chakra Petch',monospace">{pos(stintLaps)}</text>
        <text x={82} y={488} fill={COL.dim} fontSize={25} fontWeight={800} fontFamily="'Rajdhani',sans-serif">/ {pos(n(s.lapsRemaining))}</text>
        <Label x={220} y={404} size={17}>TIME IN STINT</Label>
        <text x={206} y={460} fill={COL.text} fontSize={34} fontWeight={800} fontFamily="'Chakra Petch',monospace">—</text>
        <Label x={398} y={404} size={17}>TYRE AGE</Label>
        <text x={406} y={460} fill={COL.text} fontSize={54} fontWeight={800} fontFamily="'Chakra Petch',monospace">—</text>
        <text x={414} y={488} fill={COL.dim} fontSize={22} fontWeight={800} fontFamily="'Rajdhani',sans-serif">LAPS</text>
      </Panel>

      <TyreBrakeMatrix s={s} unitSystem={unitSystem} />

      <g>
        <path d="M28 514 H996" stroke={COL.lineStrong} />
        <path d="M312 526 V582 M510 526 V582 M720 526 V582" stroke={COL.lineStrong} />
        <Label x={80} y={548} size={17}>POSITION</Label>
        <text x={108} y={582} fill={COL.text} fontSize={44} fontWeight={800} fontFamily="'Chakra Petch',monospace">{pos(position)}</text>
        <rect x={202} y={544} width={64} height={38} rx={6} fill="none" stroke={COL.dim} strokeWidth={2} />
        <text x={233} y={574} textAnchor="middle" fill={COL.dim} fontSize={34} fontWeight={800} fontFamily="'Rajdhani',sans-serif">P{pos(classPosition)}</text>
        <Label x={408} y={548} anchor="middle" size={17}>GAP AHEAD</Label>
        <text x={408} y={582} textAnchor="middle" fill={COL.text} fontSize={37} fontWeight={800} fontFamily="'Chakra Petch',monospace">{signed(gapAhead, 3)}</text>
        <Label x={618} y={548} anchor="middle" size={17}>GAP BEHIND</Label>
        <text x={618} y={582} textAnchor="middle" fill={COL.text} fontSize={37} fontWeight={800} fontFamily="'Chakra Petch',monospace">{signed(gapBehind, 3)}</text>
        <Label x={835} y={548} anchor="middle" size={17}>NEXT PIT</Label>
        <text x={835} y={582} textAnchor="middle" fill={COL.text} fontSize={42} fontWeight={800} fontFamily="'Chakra Petch',monospace">—</text>
      </g>
    </svg>
  )
}
