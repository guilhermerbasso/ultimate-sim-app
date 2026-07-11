// ── irVitals — engine/driveline vitals (v6, gpt-image referenced) ─────────────
// Clean, transparent, title-less DIGITAL READOUTS for the iRacing channels surfaced
// in v6 (voltage, manifold/fuel pressure, coolant/oil level). Each shows one big
// self-explanatory value + unit over a hairline min→max micro-scale with a
// health-coloured value tick (conditional colour: red = below safe, amber = high).
// Built to match concepts/refs/ref-ir-*.png (Bosch DDU / MoTeC style).
import type { ReactElement } from 'react'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { BigNum, C, FONT_LABEL, Hairline, LEGIBLE, fixed, num } from '../kit'
import { formatMeasurement, type MeasurementKind } from '../../../../../shared/units'

const W = 420
const H = 240

interface VitalSpec {
  value: number | undefined
  unit: string
  kind?: MeasurementKind
  min: number
  max: number
  digits: number
  /** Below this the reading is unsafe → red. */
  okLow?: number
  /** Above this the reading is high → amber. */
  okHigh?: number
}

function healthColor(v: number | undefined, okLow?: number, okHigh?: number): string {
  if (v == null) return C.dim
  if (okLow != null && v < okLow) return C.red
  if (okHigh != null && v > okHigh) return C.amber
  return C.text
}

function DigitalReadout({ width, height, value, unit, kind, min, max, digits, okLow, okHigh, unitSystem = 'metric' }: HifiWidgetProps & VitalSpec): ReactElement {
  const w = width ?? W
  const h = height ?? H
  const color = healthColor(value, okLow, okHigh)
  const f = value == null || max === min ? 0 : Math.max(0, Math.min(1, (value - min) / (max - min)))
  const sx = 70
  const ex = W - 70
  const sy = 188
  const tickX = sx + (ex - sx) * f
  const reading = kind ? formatMeasurement(value, kind, unitSystem, { decimals: digits }) : { display: value == null ? '—' : fixed(value, digits), unit }
  const minDisplay = kind ? formatMeasurement(min, kind, unitSystem, { decimals: digits }).display : fixed(min, digits)
  const maxDisplay = kind ? formatMeasurement(max, kind, unitSystem, { decimals: digits }).display : fixed(max, digits)
  const ticks = 5
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={w} height={h} preserveAspectRatio="xMidYMid meet" role="img">
      <BigNum x={W / 2} y={130} value={reading.display} unit={reading.unit} color={color} size={104} />
      <Hairline x={sx} y={sy} len={ex - sx} opacity={0.28} />
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const tx = sx + ((ex - sx) * i) / ticks
        return <rect key={i} x={tx} y={sy - 4} width={1} height={8} fill="rgba(255,255,255,0.28)" />
      })}
      {value != null ? <rect x={tickX - 1.5} y={sy - 9} width={3} height={18} rx={1} fill={color} /> : null}
      <text x={sx} y={sy + 26} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={20} fontWeight={700} {...LEGIBLE}>{minDisplay}</text>
      <text x={ex} y={sy + 26} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={20} fontWeight={700} {...LEGIBLE}>{maxDisplay}</text>
    </svg>
  )
}

export const voltageWidget: HifiWidgetModule = {
  id: 'voltage',
  title: 'Voltage',
  description: 'Electrical system voltage digital readout with a health micro-scale.',
  category: 'brakesEngine',
  tags: ['voltage', 'electrical', 'digital', 'clean', 'vitals'],
  requires: ['voltage'],
  defaultSize: { w: W, h: H },
  render: (props) => <DigitalReadout {...props} value={num(props.snapshot?.voltage)} unit="V" min={11.5} max={14.5} digits={1} okLow={11.8} okHigh={14.8} />
}

export const manifoldPressWidget: HifiWidgetModule = {
  id: 'manifoldPress',
  title: 'Manifold Pressure',
  description: 'Manifold / boost pressure digital readout with a micro-scale.',
  category: 'brakesEngine',
  tags: ['manifold', 'boost', 'pressure', 'digital', 'clean', 'vitals'],
  requires: ['manifoldPressBar'],
  defaultSize: { w: W, h: H },
  render: (props) => <DigitalReadout {...props} value={num(props.snapshot?.manifoldPressBar)} unit="bar" kind="pressure-bar" min={0} max={2.5} digits={2} />
}

export const fuelPressWidget: HifiWidgetModule = {
  id: 'fuelPress',
  title: 'Fuel Pressure',
  description: 'Fuel pressure digital readout; red below the safe threshold.',
  category: 'brakesEngine',
  tags: ['fuel-press', 'pressure', 'digital', 'clean', 'vitals'],
  requires: ['fuelPressBar'],
  defaultSize: { w: W, h: H },
  render: (props) => <DigitalReadout {...props} value={num(props.snapshot?.fuelPressBar)} unit="bar" kind="pressure-bar" min={0} max={7} digits={1} okLow={2.5} />
}

export const waterLevelWidget: HifiWidgetModule = {
  id: 'waterLevel',
  title: 'Coolant Level',
  description: 'Coolant / water level digital readout; red when low.',
  category: 'brakesEngine',
  tags: ['coolant', 'water', 'level', 'digital', 'clean', 'vitals'],
  requires: ['waterLevelL'],
  defaultSize: { w: W, h: H },
  render: (props) => <DigitalReadout {...props} value={num(props.snapshot?.waterLevelL)} unit="L" kind="fuel-volume-l" min={0} max={8} digits={1} okLow={2} />
}

export const oilLevelWidget: HifiWidgetModule = {
  id: 'oilLevel',
  title: 'Oil Level',
  description: 'Engine oil level digital readout; red when low.',
  category: 'brakesEngine',
  tags: ['oil', 'level', 'digital', 'clean', 'vitals'],
  requires: ['oilLevelL'],
  defaultSize: { w: W, h: H },
  render: (props) => <DigitalReadout {...props} value={num(props.snapshot?.oilLevelL)} unit="L" kind="fuel-volume-l" min={0} max={6} digits={1} okLow={1.5} />
}
