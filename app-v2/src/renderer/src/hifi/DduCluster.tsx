// ── DduCluster ────────────────────────────────────────────────────────────────
// A high-fidelity, race-car GT3 DDU cluster (Bosch/MoTeC-style), built to match the
// gpt-image reference `ref-ddu-cockpit-1024x600.png`. Pure SVG on a 1024x600 viewBox
// so it scales/letterboxes to ANY device (1024x600 panels, desktop, phone, tablet)
// via the parent's fit-scaler. SSR-safe (renderToStaticMarkup) and NaN-safe: every
// value comes from the live TelemetrySnapshot and shows an em-dash when absent —
// nothing is faked. Warm hues = decoration/alerts; cool/green = a genuinely good state.
import { type ReactElement, type ReactNode } from 'react'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import { convertMeasurement, formatMeasurement, type UnitSystem } from '../../../shared/units'
import { useUnitSystem } from '../lib/units'

const W = 1024
const H = 600
const COL = {
  bg: '#000000',
  panel: '#0b0d10',
  panelStroke: 'rgba(255,255,255,0.10)',
  text: '#f5f7fa',
  dim: '#9aa3ad',
  muted: '#5b636c',
  cyan: '#22c3ff',
  amber: '#ffb020',
  red: '#ff3b30',
  green: '#22e06a',
  blue: '#2f7bff'
}

// ── NaN-safe helpers ──────────────────────────────────────────────────────────
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
function lapTime(sec: number | undefined): string {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return '--:--.--'
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s.toFixed(2).padStart(5, '0')}`
}
function gearLabel(g: number | undefined): string {
  if (typeof g !== 'number' || !Number.isFinite(g)) return '–'
  if (g < 0) return 'R'
  if (g === 0) return 'N'
  return String(Math.trunc(g))
}
function tempColor(t: number | undefined): string {
  if (typeof t !== 'number' || !Number.isFinite(t)) return COL.dim
  if (t < 70) return COL.cyan
  if (t < 85) return COL.green
  if (t < 95) return COL.amber
  return COL.red
}

// ── Small building blocks ─────────────────────────────────────────────────────
function Panel({ x, y, w, h, children }: { x: number; y: number; w: number; h: number; children?: ReactNode }): ReactElement {
  return (
    <>
      <rect x={x} y={y} width={w} height={h} rx={12} fill={COL.panel} stroke={COL.panelStroke} />
      {children}
    </>
  )
}

function label(text: string, x: number, y: number, anchor: 'start' | 'middle' | 'end' = 'start', color = COL.dim, size = 15): ReactElement {
  return (
    <text x={x} y={y} textAnchor={anchor} fill={color} fontFamily="'Rajdhani','Barlow Condensed',sans-serif" fontSize={size} fontWeight={700} letterSpacing={2}>
      {text.toUpperCase()}
    </text>
  )
}

function scaleBar(x: number, y: number, w: number, frac: number, color: string, lo: string, mid: string, hi: string): ReactElement {
  const f = clamp01(frac)
  return (
    <>
      <rect x={x} y={y} width={w} height={8} rx={4} fill="#1a1d21" />
      <rect x={x} y={y} width={Math.max(2, w * f)} height={8} rx={4} fill={color} />
      <text x={x} y={y + 22} fill={COL.muted} fontSize={11} fontFamily="'Rajdhani',sans-serif">{lo}</text>
      <text x={x + w / 2} y={y + 22} textAnchor="middle" fill={COL.muted} fontSize={11} fontFamily="'Rajdhani',sans-serif">{mid}</text>
      <text x={x + w} y={y + 22} textAnchor="end" fill={COL.muted} fontSize={11} fontFamily="'Rajdhani',sans-serif">{hi}</text>
    </>
  )
}

function OilIcon({ x, y, c }: { x: number; y: number; c: string }): ReactElement {
  return (
    <g transform={`translate(${x},${y})`} fill="none" stroke={c} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round">
      <path d="M2 14 h20 v-6 h-9 l-4 -3 h-7 z" />
      <path d="M22 10 c6 -4 9 -8 9 -8" />
      <circle cx={31} cy={2} r={2.2} fill={c} stroke="none" />
      <path d="M5 14 v3 h12 v-3" />
    </g>
  )
}
function ThermoIcon({ x, y, c }: { x: number; y: number; c: string }): ReactElement {
  return (
    <g transform={`translate(${x},${y})`} stroke={c} strokeWidth={2.4} fill="none" strokeLinecap="round">
      <path d="M8 2 v10 a4 4 0 1 0 4 0 V2 a2 2 0 0 0 -4 0 z" />
      <circle cx={10} cy={16} r={2.4} fill={c} stroke="none" />
      <path d="M14 5 h4 M14 9 h4" />
    </g>
  )
}
function BatteryIcon({ x, y, c }: { x: number; y: number; c: string }): ReactElement {
  return (
    <g transform={`translate(${x},${y})`} stroke={c} strokeWidth={2.2} fill="none" strokeLinecap="round">
      <rect x={2} y={5} width={26} height={13} rx={2} />
      <path d="M9 3 v2 M21 3 v2" />
      <path d="M9 11 h4 M11 9 v4 M18 11 h4" />
    </g>
  )
}

function ShiftArc({ pct }: { pct: number }): ReactElement {
  const count = 15
  const lit = Math.round(clamp01(pct) * count)
  const x0 = 60
  const x1 = W - 60
  const step = (x1 - x0) / (count - 1)
  const leds: ReactElement[] = []
  for (let i = 0; i < count; i++) {
    const cx = x0 + i * step
    const t = (cx - W / 2) / (W / 2)
    const cy = 44 - (1 - t * t) * 16
    const zone = i / (count - 1)
    const color = zone < 0.33 ? COL.blue : zone < 0.53 ? COL.green : zone < 0.75 ? COL.amber : COL.red
    const on = i < lit
    leds.push(<circle key={i} cx={cx} cy={cy} r={on ? 9 : 7.5} fill={on ? color : '#15181c'} stroke={on ? color : 'rgba(255,255,255,0.08)'} strokeWidth={1} opacity={on ? 1 : 0.55} />)
  }
  return <g>{leds}</g>
}

function RpmStepBar({ frac, x, y, w, h }: { frac: number; x: number; y: number; w: number; h: number }): ReactElement {
  const steps = 10
  const lit = Math.round(clamp01(frac) * steps)
  const bars: ReactElement[] = []
  for (let i = 0; i < steps; i++) {
    const level = i / (steps - 1)
    const color = level < 0.5 ? COL.blue : level < 0.7 ? COL.green : level < 0.85 ? COL.amber : COL.red
    const rowY = y + h - (i + 1) * (h / steps) + 2
    const rowW = 14 + (w - 14) * (i / (steps - 1))
    bars.push(<rect key={i} x={x} y={rowY} width={rowW} height={h / steps - 3} rx={2} fill={i < lit ? color : '#15181c'} opacity={i < lit ? 1 : 0.5} />)
  }
  return (
    <g>
      {bars}
      <text x={x + w + 8} y={y + 6} fill={COL.muted} fontSize={11} fontFamily="'Rajdhani',sans-serif">10</text>
      <text x={x + w + 8} y={y + h} fill={COL.muted} fontSize={11} fontFamily="'Rajdhani',sans-serif">0</text>
      <text x={x + w + 8} y={y + h + 16} fill={COL.muted} fontSize={11} fontFamily="'Rajdhani',sans-serif">x1000</text>
    </g>
  )
}

function TyreGrid({ x, y, w, h, s, unitSystem }: { x: number; y: number; w: number; h: number; s: TelemetrySnapshot; unitSystem: UnitSystem }): ReactElement {
  const corners: Array<{ k: string; t: number | undefined; cx: number; cy: number; anchor: 'start' | 'end' }> = [
    { k: 'FL', t: n(s.tyres?.lf?.tempC), cx: x + 44, cy: y + 40, anchor: 'start' },
    { k: 'FR', t: n(s.tyres?.rf?.tempC), cx: x + w - 44, cy: y + 40, anchor: 'end' },
    { k: 'RL', t: n(s.tyres?.lr?.tempC), cx: x + 44, cy: y + h - 30, anchor: 'start' },
    { k: 'RR', t: n(s.tyres?.rr?.tempC), cx: x + w - 44, cy: y + h - 30, anchor: 'end' }
  ]
  const midX = x + w / 2
  return (
    <g>
      {label('Tyre Temp', midX, y - 8, 'middle', COL.dim, 14)}
      <rect x={midX - 16} y={y + 8} width={32} height={h - 20} rx={14} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth={2} />
      {[y + 20, y + h - 34].map((ty, i) => (
        <g key={i}>
          <rect x={midX - 22} y={ty} width={8} height={16} rx={2} fill="rgba(255,255,255,0.12)" />
          <rect x={midX + 14} y={ty} width={8} height={16} rx={2} fill="rgba(255,255,255,0.12)" />
        </g>
      ))}
      {corners.map((c) => (
        <g key={c.k}>
          <text x={c.cx} y={c.cy - 22} textAnchor={c.anchor} fill={COL.dim} fontSize={13} fontFamily="'Rajdhani',sans-serif" fontWeight={700}>{c.k}</text>
          <text x={c.cx} y={c.cy + 8} textAnchor={c.anchor} fill={tempColor(c.t)} fontSize={30} fontWeight={800} fontFamily="'Chakra Petch','Michroma',sans-serif">{formatMeasurement(c.t, 'temperature-c', unitSystem, { decimals: 0 }).display}</text>
          <text x={c.cx} y={c.cy + 24} textAnchor={c.anchor} fill={COL.muted} fontSize={11} fontFamily="'Rajdhani',sans-serif">{formatMeasurement(c.t, 'temperature-c', unitSystem).unit}</text>
        </g>
      ))}
    </g>
  )
}

export interface DduClusterProps {
  snapshot: TelemetrySnapshot
  width?: number
  height?: number
}

/** The full GT3 DDU cluster, rendered from live telemetry to match the reference. */
export function DduCluster({ snapshot: s, width, height }: DduClusterProps): ReactElement {
  const unitSystem = useUnitSystem()
  const speed = formatMeasurement(n(s.speedKmh), 'speed-kmh', unitSystem, { decimals: 0 })
  const rpm = n(s.rpm)
  const maxRpm = n(s.maxRpm) ?? 8500
  const shiftPct = n(s.shiftIndicatorPct) ?? (rpm != null ? rpm / maxRpm : 0)
  const rpmFrac = rpm != null ? clamp01(rpm / maxRpm) : 0
  const delta = n(s.deltaToBestSec)
  const fuel = n(s.fuelLiters)
  const fuelReading = formatMeasurement(fuel, 'fuel-volume-l', unitSystem, { decimals: 1 })
  const fuelCap = n(s.fuelCapacityLiters)
  const fuelFrac = fuel != null && fuelCap ? clamp01(fuel / fuelCap) : 0
  const oil = n(s.oilTempC)
  const water = n(s.waterTempC)
  const oilPress = n(s.oilPressureKpa)
  const battery = n((s as { batteryLapge?: number }).batteryLapge)
  const deltaColor = delta == null ? COL.dim : delta <= 0 ? COL.green : COL.red
  const deltaFrac = delta == null ? 0.5 : clamp01(0.5 + delta / 2)
  const oilTemp = formatMeasurement(oil, 'temperature-c', unitSystem, { decimals: 0 })
  const waterTemp = formatMeasurement(water, 'temperature-c', unitSystem, { decimals: 0 })
  const oilPressure = formatMeasurement(oilPress != null ? oilPress / 100 : undefined, 'pressure-bar', unitSystem, { decimals: 1 })
  const tempScale = [50, 100, 150].map((value) => fixed(convertMeasurement(value, 'temperature-c', unitSystem), 0))
  const pressureScale = [0, 5, 10].map((value) => fixed(convertMeasurement(value, 'pressure-bar', unitSystem), unitSystem === 'imperial' ? 0 : 0))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={width ?? W} height={height ?? H} preserveAspectRatio="xMidYMid meet" role="img" aria-label="GT3 DDU cluster">
      <rect x={0} y={0} width={W} height={H} fill={COL.bg} />
      <ShiftArc pct={shiftPct} />

      <Panel x={16} y={70} w={232} h={112}>
        {label('Fuel', 32, 96)}
        <text x={32} y={140} fill={COL.text} fontSize={44} fontWeight={800} fontFamily="'Chakra Petch','Michroma',sans-serif">{fuelReading.display}</text>
        <text x={168} y={140} fill={COL.dim} fontSize={14} fontFamily="'Rajdhani',sans-serif">{fuelReading.unit.toUpperCase()}</text>
        <text x={22} y={166} fill={COL.red} fontSize={13} fontWeight={800} fontFamily="'Rajdhani',sans-serif">E</text>
        <rect x={36} y={158} width={186} height={10} rx={3} fill="#15181c" />
        <rect x={36} y={158} width={Math.max(2, 186 * fuelFrac)} height={10} rx={3} fill={fuelFrac < 0.15 ? COL.red : fuelFrac < 0.3 ? COL.amber : COL.green} />
        <text x={228} y={166} textAnchor="end" fill={COL.dim} fontSize={13} fontWeight={800} fontFamily="'Rajdhani',sans-serif">F</text>
      </Panel>

      <Panel x={16} y={190} w={232} h={110}>
        {label('Lap Time', 32, 216)}
        <text x={32} y={262} fill={COL.text} fontSize={40} fontWeight={800} fontFamily="'Chakra Petch',monospace">{lapTime(n(s.currentLapTimeSec))}</text>
        <text x={32} y={288} fill={COL.cyan} fontSize={13} fontWeight={700} fontFamily="'Rajdhani',sans-serif">BEST</text>
        <text x={92} y={288} fill={COL.dim} fontSize={18} fontFamily="'Chakra Petch',monospace">{lapTime(n(s.bestLapTimeSec))}</text>
      </Panel>

      <Panel x={16} y={308} w={232} h={162}>
        {label('Position', 32, 334)}
        <text x={32} y={430} fill={COL.text} fontSize={96} fontWeight={800} fontFamily="'Michroma','Chakra Petch',sans-serif">{s.position && s.position > 0 ? String(s.position) : '–'}</text>
        <text x={150} y={430} fill={COL.muted} fontSize={26} fontFamily="'Rajdhani',sans-serif">/ {s.totalCars && s.totalCars > 0 ? s.totalCars : '—'}</text>
      </Panel>

      <Panel x={262} y={70} w={478} h={400}>
        <text x={286} y={178} fill={COL.cyan} fontSize={20} fontWeight={700} fontFamily="'Rajdhani',sans-serif" letterSpacing={2}>SPEED</text>
        <text x={286} y={258} fill={COL.text} fontSize={72} fontWeight={800} fontFamily="'Chakra Petch','Michroma',sans-serif">{speed.display}</text>
        <text x={286} y={296} fill={COL.cyan} fontSize={18} fontFamily="'Rajdhani',sans-serif">{speed.unit}</text>

        <text x={501} y={352} textAnchor="middle" fill={COL.text} fontSize={184} fontWeight={800} fontFamily="'Michroma','Chakra Petch',sans-serif">{gearLabel(s.gear)}</text>

        <text x={724} y={168} textAnchor="end" fill={COL.cyan} fontSize={18} fontWeight={700} fontFamily="'Rajdhani',sans-serif">RPM</text>
        <text x={724} y={214} textAnchor="end" fill={COL.text} fontSize={44} fontWeight={800} fontFamily="'Chakra Petch',monospace">{rpm != null ? String(Math.round(rpm)) : '—'}</text>
        <RpmStepBar frac={rpmFrac} x={648} y={236} w={52} h={140} />

        <rect x={286} y={412} width={430} height={38} rx={8} fill="#0a0c0e" stroke={COL.panelStroke} />
        <rect x={286} y={412} width={215} height={38} rx={8} fill="rgba(34,224,106,0.14)" />
        <rect x={501} y={412} width={215} height={38} rx={8} fill="rgba(255,59,48,0.14)" />
        <rect x={delta == null ? 499 : 286 + 430 * deltaFrac - 2} y={412} width={4} height={38} fill={deltaColor} />
        <text x={501} y={439} textAnchor="middle" fill={deltaColor} fontSize={24} fontWeight={800} fontFamily="'Chakra Petch',monospace">{delta == null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`}</text>
      </Panel>

      <Panel x={754} y={70} w={254} h={210}>
        <TyreGrid x={764} y={92} w={234} h={178} s={s} unitSystem={unitSystem} />
      </Panel>
      <Panel x={754} y={288} w={122} h={92}>
        {label('TC', 774, 314, 'start', COL.dim, 14)}
        <text x={774} y={362} fill={COL.cyan} fontSize={40} fontWeight={800} fontFamily="'Chakra Petch',monospace">{fixed(n(s.tcLevel))}</text>
      </Panel>
      <Panel x={886} y={288} w={122} h={92}>
        {label('ABS', 906, 314, 'start', COL.dim, 14)}
        <text x={906} y={362} fill={COL.cyan} fontSize={40} fontWeight={800} fontFamily="'Chakra Petch',monospace">{fixed(n(s.absLevel))}</text>
      </Panel>
      <Panel x={754} y={388} w={254} h={82}>
        {label('Brake Bias', 774, 414)}
        <text x={774} y={456} fill={COL.text} fontSize={36} fontWeight={800} fontFamily="'Chakra Petch',monospace">{fixed(n(s.brakeBiasPct), 1)}</text>
        <text x={984} y={456} textAnchor="end" fill={COL.dim} fontSize={16} fontFamily="'Rajdhani',sans-serif">%</text>
      </Panel>

      {[
        { x: 16, w: 240, icon: 'oil', name: 'Oil Temp', val: oilTemp.display, unit: oilTemp.unit, frac: oil != null ? (oil - 50) / 100 : 0, color: COL.green, lo: tempScale[0], mid: tempScale[1], hi: tempScale[2] },
        { x: 268, w: 240, icon: 'water', name: 'Water Temp', val: waterTemp.display, unit: waterTemp.unit, frac: water != null ? (water - 50) / 100 : 0, color: COL.cyan, lo: tempScale[0], mid: tempScale[1], hi: tempScale[2] },
        { x: 520, w: 240, icon: 'oilp', name: 'Oil Press', val: oilPressure.display, unit: oilPressure.unit, frac: oilPress != null ? (oilPress / 100) / 10 : 0, color: COL.amber, lo: pressureScale[0], mid: pressureScale[1], hi: pressureScale[2] },
        { x: 772, w: 236, icon: 'batt', name: 'Battery', val: fixed(battery, 1), unit: 'V', frac: battery != null ? (battery - 10) / 6 : 0, color: COL.red, lo: '10', mid: '12', hi: '16' }
      ].map((t) => (
        <g key={t.name}>
          <Panel x={t.x} y={480} w={t.w} h={106} />
          {t.icon === 'oil' && <OilIcon x={t.x + 16} y={498} c={COL.green} />}
          {t.icon === 'water' && <ThermoIcon x={t.x + 18} y={496} c={COL.cyan} />}
          {t.icon === 'oilp' && <OilIcon x={t.x + 16} y={498} c={COL.amber} />}
          {t.icon === 'batt' && <BatteryIcon x={t.x + 14} y={498} c={COL.red} />}
          <text x={t.x + 60} y={512} fill={COL.dim} fontSize={14} fontWeight={700} letterSpacing={1.5} fontFamily="'Rajdhani',sans-serif">{t.name.toUpperCase()}</text>
          <text x={t.x + 60} y={556} fill={COL.text} fontSize={40} fontWeight={800} fontFamily="'Chakra Petch',monospace">{t.val}</text>
          <text x={t.x + 152} y={556} fill={COL.dim} fontSize={15} fontFamily="'Rajdhani',sans-serif">{t.unit}</text>
          {scaleBar(t.x + 16, 570, t.w - 32, clamp01(t.frac), t.color, t.lo, t.mid, t.hi)}
        </g>
      ))}
    </svg>
  )
}
