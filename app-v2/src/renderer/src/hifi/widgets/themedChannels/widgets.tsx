// ── themedChannels — per-car themed single-channel telemetry widgets ──────────
// Expands the per-car themed set beyond the derived widgets to a broad curated set
// of core scalar telemetry channels (speed, rpm, gear, pedals, temps, fuel, delta,
// position, lap, track/air temp). One generic palette-parametrized renderer × a
// channel table × six car families, generated from a single source of truth so
// every channel gets a consistent, NaN-safe, car-themed widget.
import type { ReactElement, ReactNode } from 'react'
import type { HifiWidgetModule, HifiWidgetProps, TelemetryField } from '../types'
import { Bar, BigNum, C, FONT_LABEL, fixed, frac, gearLabel, num, signed } from '../kit'
import { formatMeasurement, measurementKindForUnit } from '../../../../../shared/units'

const W = 420
const H = 240

interface ChannelPal {
  key: string
  name: string
  suffix: string
  main: string
  accent: string
}

const CARS: ChannelPal[] = [
  { key: 'ferrari', name: 'Ferrari', suffix: 'Ferrari', main: '#DC0000', accent: '#FFD21F' },
  { key: 'porsche', name: 'Porsche', suffix: 'Porsche', main: '#E30613', accent: '#F5F7FA' },
  { key: 'amg', name: 'Mercedes-AMG', suffix: 'Amg', main: '#00A19B', accent: '#D6FFF9' },
  { key: 'mclaren', name: 'McLaren', suffix: 'Mclaren', main: '#FF8000', accent: '#FFE15A' },
  { key: 'corvette', name: 'Corvette', suffix: 'Corvette', main: '#FFD700', accent: '#F33A22' },
  { key: 'lambo', name: 'Lamborghini', suffix: 'Lambo', main: '#A6D608', accent: '#7A3CFF' }
]

type ChannelMode = 'bar' | 'gear' | 'signed' | 'value'

interface ChannelSpec {
  field: TelemetryField
  base: string
  label: string
  title: string
  category: string
  unit?: string
  decimals?: number
  min?: number
  max?: number
  mode: ChannelMode
  scale?: (v: number) => number
}

const CHANNELS: ChannelSpec[] = [
  { field: 'speedKmh', base: 'speed', label: 'SPEED', title: 'Speed', category: 'drive', unit: 'km/h', decimals: 0, min: 0, max: 320, mode: 'bar' },
  { field: 'rpm', base: 'rpm', label: 'RPM', title: 'RPM', category: 'engine', decimals: 0, min: 0, max: 9000, mode: 'bar' },
  { field: 'gear', base: 'gear', label: 'GEAR', title: 'Gear', category: 'drive', mode: 'gear' },
  { field: 'throttle', base: 'throttle', label: 'THROTTLE', title: 'Throttle', category: 'inputs', unit: '%', decimals: 0, min: 0, max: 100, mode: 'bar', scale: (v) => v * 100 },
  { field: 'brake', base: 'brake', label: 'BRAKE', title: 'Brake', category: 'inputs', unit: '%', decimals: 0, min: 0, max: 100, mode: 'bar', scale: (v) => v * 100 },
  { field: 'clutch', base: 'clutch', label: 'CLUTCH', title: 'Clutch', category: 'inputs', unit: '%', decimals: 0, min: 0, max: 100, mode: 'bar', scale: (v) => v * 100 },
  { field: 'steerAngleDeg', base: 'steer', label: 'STEER', title: 'Steering', category: 'inputs', unit: '°', decimals: 0, mode: 'signed' },
  { field: 'waterTempC', base: 'water', label: 'WATER', title: 'Water Temp', category: 'brakesEngine', unit: '°C', decimals: 0, min: 40, max: 120, mode: 'bar' },
  { field: 'oilTempC', base: 'oil', label: 'OIL', title: 'Oil Temp', category: 'brakesEngine', unit: '°C', decimals: 0, min: 40, max: 140, mode: 'bar' },
  { field: 'fuelLiters', base: 'fuel', label: 'FUEL', title: 'Fuel', category: 'fuel', unit: 'L', decimals: 1, min: 0, max: 120, mode: 'bar' },
  { field: 'fuelLevelPct', base: 'fuelPct', label: 'FUEL', title: 'Fuel Percent', category: 'fuel', unit: '%', decimals: 0, min: 0, max: 100, mode: 'bar', scale: (v) => v * 100 },
  { field: 'deltaToBestSec', base: 'deltaBest', label: 'DELTA', title: 'Delta Best', category: 'delta', unit: 's', decimals: 2, mode: 'signed' },
  { field: 'deltaToSessionBestSec', base: 'deltaSession', label: 'SES Δ', title: 'Delta Session', category: 'delta', unit: 's', decimals: 2, mode: 'signed' },
  { field: 'position', base: 'position', label: 'POSITION', title: 'Position', category: 'timing', decimals: 0, mode: 'value' },
  { field: 'lapDistPct', base: 'lapPct', label: 'LAP', title: 'Lap Percent', category: 'timing', unit: '%', decimals: 0, min: 0, max: 100, mode: 'bar', scale: (v) => v * 100 },
  { field: 'trackTempC', base: 'trackTemp', label: 'TRACK', title: 'Track Temp', category: 'weather', unit: '°C', decimals: 0, min: 10, max: 60, mode: 'bar' },
  { field: 'airTempC', base: 'airTemp', label: 'AIR', title: 'Air Temp', category: 'weather', unit: '°C', decimals: 0, min: 5, max: 45, mode: 'bar' }
]

function Root({ width, height, children }: HifiWidgetProps & { children: ReactNode }): ReactElement {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={width ?? W} height={height ?? H} preserveAspectRatio="xMidYMid meet" role="img">
      {children}
    </svg>
  )
}

function Label({ text, x, y }: { text: string; x: number; y: number }): ReactElement {
  return (
    <text x={x} y={y} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={22} fontWeight={800} letterSpacing={3} stroke="rgba(0,0,0,0.55)" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">
      {text}
    </text>
  )
}

function channelRenderer(pal: ChannelPal, ch: ChannelSpec) {
  return function ThemedChannel({ width, height, snapshot, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
    const raw = num(snapshot?.[ch.field])
    const color = raw == null ? C.dim : pal.main
    let display: string
    let unit = ch.unit
    let barF: number | undefined
    if (ch.mode === 'gear') {
      display = gearLabel(raw)
      unit = undefined
    } else if (ch.mode === 'signed') {
      display = raw == null ? '—' : signed(raw, ch.decimals ?? 2)
    } else {
      const scaled = raw == null ? undefined : ch.scale ? ch.scale(raw) : raw
      const kind = measurementKindForUnit(ch.unit)
      if (kind) {
        const reading = formatMeasurement(scaled, kind, unitSystem, { decimals: ch.decimals ?? 0 })
        display = reading.display
        unit = reading.unit
      } else {
        display = scaled == null ? '—' : fixed(scaled, ch.decimals ?? 0)
      }
      if (ch.min != null && ch.max != null) barF = frac(scaled, ch.min, ch.max)
    }
    const isGear = ch.mode === 'gear'
    return (
      <Root width={width} height={height} snapshot={snapshot}>
        <BigNum x={W / 2} y={isGear ? 148 : 120} value={display} unit={unit} color={color} size={isGear ? 128 : display.length > 6 ? 74 : 96} />
        {barF != null ? <Bar x={60} y={166} w={W - 120} h={16} f={barF} color={pal.main} /> : null}
        {barF == null && !isGear && raw != null ? <rect x={W / 2 - 70} y={150} width={140} height={5} rx={2.5} fill={pal.accent} opacity={0.85} /> : null}
        <Label text={ch.label} x={W / 2} y={isGear ? 202 : 206} />
      </Root>
    )
  }
}

/** Per-car themed single-channel widgets: core telemetry channels × 6 car families. */
export const THEMED_CHANNEL_WIDGETS: HifiWidgetModule[] = CARS.flatMap((car) =>
  CHANNELS.map((ch) => ({
    id: `${ch.base}Themed${car.suffix}`,
    title: `${car.name} ${ch.title}`,
    description: `${car.name}-themed ${ch.title.toLowerCase()} channel widget in the car's signature palette.`,
    category: ch.category,
    tags: [ch.base, car.key, 'themed', 'channel', 'clean'],
    requires: [ch.field] as TelemetryField[],
    defaultSize: { w: W, h: H },
    render: channelRenderer(car, ch)
  }))
)
