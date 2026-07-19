import { type ReactElement, type ReactNode } from 'react'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import { formatMeasurement } from '../../../shared/units'
import { useUnitSystem } from '../lib/units'
import { SHIFT_STROBE_BLUE, ShiftStrobe, resolveRevLightPct, resolveRevLightState } from '../lib/rev-lights'

const W = 1024
const H = 600

const COL = {
  bg: '#000000',
  text: '#f8f8f8',
  dim: '#d7d7d7',
  muted: '#777777',
  line: 'rgba(255,255,255,0.42)',
  lineSoft: 'rgba(255,255,255,0.28)',
  amber: '#ffad20',
  cyan: '#23f4ff',
  green: '#20f18b',
  red: '#ff2b3b'
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

function signed(v: number | undefined, d = 2): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(d)}`
}

function lapTime(sec: number | undefined): string {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return '—'
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s.toFixed(2).padStart(5, '0')}`
}

function gearLabel(g: number | undefined): string {
  if (typeof g !== 'number' || !Number.isFinite(g)) return '—'
  if (g < 0) return 'R'
  if (g === 0) return 'N'
  return String(Math.trunc(g))
}

function pos(v: number | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? String(Math.trunc(v)) : '—'
}

function Label({ x, y, children }: { x: number; y: number; children: ReactNode }): ReactElement {
  return (
    <text x={x} y={y} fill={COL.text} fontSize={18} fontWeight={500} letterSpacing={7} fontFamily="'Inter','Segoe UI',Arial,sans-serif">
      {children}
    </text>
  )
}

function ShiftLine({ pct, blink }: { pct: number; blink?: boolean }): ReactElement {
  const count = 22
  const state = resolveRevLightState(pct, blink)
  const lit = state.atShiftPoint ? count : Math.round(state.pct * count)
  const x0 = 80
  const gap = 37
  const leds: ReactElement[] = []

  for (let i = 0; i < count; i++) {
    const active = i < lit
    const warm = active && i >= 8 && i <= 14
    const fill = state.atShiftPoint ? SHIFT_STROBE_BLUE : warm ? COL.amber : active ? '#f2f2f2' : '#7e7e7e'
    leds.push(
      <circle
        key={i}
        cx={x0 + i * gap}
        cy={62}
        r={4}
        fill={fill}
        opacity={active ? 1 : 0.58}
        filter={warm ? 'url(#amberGlow)' : undefined}
      />
    )
  }

  return <g><ShiftStrobe active={state.atShiftPoint} />{leds}</g>
}

function Tile({
  y,
  label,
  primary,
  secondary,
  primarySize = 70
}: {
  y: number
  label: string
  primary: string
  secondary: string
  primarySize?: number
}): ReactElement {
  return (
    <g>
      <Label x={818} y={y}>{label}</Label>
      <text x={815} y={y + 63} fill={COL.text} fontSize={primarySize} fontWeight={300} fontFamily="'Inter','Segoe UI',Arial,sans-serif">
        {primary}
      </text>
      {secondary !== '' && (
        <text x={820} y={y + 94} fill={COL.dim} fontSize={23} fontWeight={300} letterSpacing={5} fontFamily="'Inter','Segoe UI',Arial,sans-serif">
          {secondary}
        </text>
      )}
    </g>
  )
}

export interface MinimalDashProps {
  snapshot: TelemetrySnapshot
  width?: number
  height?: number
}

export function MinimalDash({ snapshot: s, width, height }: MinimalDashProps): ReactElement {
  const unitSystem = useUnitSystem()
  const speed = formatMeasurement(n(s.speedKmh), 'speed-kmh', unitSystem, { decimals: 0 })
  const delta = n(s.deltaToBestSec)
  const shiftPct = resolveRevLightPct(s)
  const fuel = n(s.fuelLiters)
  const fuelPerLap = n(s.fuelPerLap)
  const fuelLaps = fuel != null && fuelPerLap != null && fuelPerLap > 0 ? fuel / fuelPerLap : undefined
  const deltaColor = delta == null ? COL.dim : delta <= 0 ? COL.cyan : COL.red
  const markerX = delta == null ? 499 : 499 + Math.max(-1, Math.min(1, delta / 1.2)) * 150
  const deltaText = signed(delta, 2)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={width ?? W} height={height ?? H} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Minimal GT3 dash">
      <defs>
        <filter id="amberGlow" x="-220%" y="-220%" width="540%" height="540%">
          <feGaussianBlur stdDeviation={3.2} result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect x={0} y={0} width={W} height={H} fill={COL.bg} />

      <ShiftLine pct={shiftPct} blink={s.revLights?.blink} />

      <path d="M45 106 H938" stroke={COL.lineSoft} strokeWidth={1} />
      <path d="M499 100 V112" stroke={COL.line} strokeWidth={1} />
      <path d="M746 120 V540" stroke={COL.lineSoft} strokeWidth={1} />
      <path d="M758 266 H938 M758 419 H938" stroke={COL.lineSoft} strokeWidth={1} />

      <text x={492} y={344} textAnchor="middle" fill={COL.text} fontSize={246} fontWeight={700} fontFamily="'Inter','Segoe UI',Arial,sans-serif">
        {gearLabel(n(s.gear))}
      </text>

      <path d="M345 366 H499" stroke={COL.green} strokeWidth={3} strokeLinecap="round" />
      <path d="M499 366 H648" stroke={COL.red} strokeWidth={3} strokeLinecap="round" />
      <path d="M499 359 V373" stroke={COL.text} strokeWidth={1} />
      <path d={`M${markerX.toFixed(1)} 361 V371`} stroke={deltaColor} strokeWidth={1.5} />
      <text x={498} y={415} textAnchor="middle" fill={deltaColor} fontSize={42} fontWeight={300} letterSpacing={3} fontFamily="'Inter','Segoe UI',Arial,sans-serif">
        {deltaText}
      </text>

      <text x={102} y={495} fill={COL.text} fontSize={124} fontWeight={300} letterSpacing={-7} fontFamily="'Inter','Segoe UI',Arial,sans-serif">
        {speed.display}
      </text>
      <text x={178} y={545} fill={COL.text} fontSize={28} fontWeight={300} letterSpacing={4} fontFamily="'Inter','Segoe UI',Arial,sans-serif">
        {speed.unit}
      </text>

      <Tile y={137} label="FUEL" primary={fixed(fuelLaps, 1)} secondary="LAPS" />
      <Tile y={292} label="LAP" primary={lapTime(n(s.currentLapTimeSec))} secondary="" primarySize={53} />
      <Tile y={445} label="POSITION" primary={pos(n(s.position))} secondary={`/ ${pos(n(s.totalCars))}`} primarySize={66} />
    </svg>
  )
}
