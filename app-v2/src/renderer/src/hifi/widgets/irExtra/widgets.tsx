// ── irExtra — additional iRacing hi-fi telemetry widgets ──────────────────────
// Clean, transparent, title-less widgets for fuel, brake pressure, skies,
// rev-lights and spotter proximity channels surfaced from iRacing.
import type { ReactElement, ReactNode } from 'react'
import type { CarLeftRightState } from '../../../../../shared/telemetry'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { Bar, BigNum, C, FONT_LABEL, LEGIBLE, VBar, clamp01, fixed, legibleStroke, num } from '../kit'
import { ShiftStrobe, resolveRevLightState, revFill, revLightRowLayout } from '../../../lib/rev-lights'
import { formatMeasurement, type UnitSystem } from '../../../../../shared/units'

const W = 420
const H = 240
const WIDE_W = 600
const WIDE_H = 120

function Root({ width, height, w = W, h = H, children }: HifiWidgetProps & { w?: number; h?: number; children: ReactNode }): ReactElement {
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={width ?? w} height={height ?? h} preserveAspectRatio="xMidYMid meet" role="img">
      {children}
    </svg>
  )
}

function fuelLevelColor(f: number | undefined): string {
  if (f == null) return C.dim
  if (f <= 0.08) return C.red
  if (f <= 0.22) return C.amber
  return C.cyan
}

function FuelLevel({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const raw = num(snapshot?.fuelLevelPct)
  const f = raw == null ? undefined : clamp01(raw)
  const color = fuelLevelColor(f)
  const display = f == null ? '—' : fixed(f * 100, 0)
  return (
    <Root width={width} height={height} snapshot={snapshot}>
      <defs>
        <filter id="irExtraFuelGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="7" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <g filter={f != null ? 'url(#irExtraFuelGlow)' : undefined}>
        <BigNum x={182} y={144} value={display} unit="%" color={color} size={104} />
        <VBar x={328} y={42} w={34} h={156} f={f ?? 0} color={color} />
        <path d="M325 32 h34 a17 17 0 0 1 17 17 v14 h-14 v-11 a7 7 0 0 0 -7 -7 h-30 z" fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" opacity={f == null ? 0.35 : 0.9} />
      </g>
      <text x={328} y={218} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={18} fontWeight={800} {...LEGIBLE}>E</text>
      <text x={362} y={36} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={18} fontWeight={800} {...LEGIBLE}>F</text>
    </Root>
  )
}

function fuelRateColor(v: number | undefined): string {
  if (v == null) return C.dim
  if (v >= 6) return C.red
  if (v >= 4.5) return C.amber
  return C.text
}

function FuelRate({ width, height, snapshot, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
  const v = num(snapshot?.fuelUsePerHourKg)
  const f = v == null ? 0 : clamp01(v / 8)
  const color = fuelRateColor(v)
  const reading = formatMeasurement(v, 'mass-flow-kg-hour', unitSystem, { decimals: 1 })
  const valueSize = reading.unit === 'lb/h' ? 82 : 98
  return (
    <Root width={width} height={height} snapshot={snapshot}>
      <BigNum x={W / 2} y={132} value={reading.display} unit={reading.unit} color={color} size={valueSize} />
      <Bar x={72} y={182} w={276} h={14} f={f} color={color} />
      <text x={72} y={218} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={18} fontWeight={800} {...LEGIBLE}>{formatMeasurement(0, 'mass-flow-kg-hour', unitSystem, { decimals: 0 }).display}</text>
      <text x={348} y={218} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={18} fontWeight={800} {...LEGIBLE}>{formatMeasurement(8, 'mass-flow-kg-hour', unitSystem, { decimals: 0 }).display}</text>
    </Root>
  )
}

function brakeColor(v: number | undefined): string {
  if (v == null) return C.dim
  if (v >= 75) return C.amber
  return C.cyan
}

function BrakeCell({ label, x, y, value, unitSystem }: { label: string; x: number; y: number; value: number | undefined; unitSystem: UnitSystem }): ReactElement {
  const color = brakeColor(value)
  const f = value == null ? 0 : clamp01(value / 100)
  const reading = formatMeasurement(value, 'pressure-bar', unitSystem, { decimals: unitSystem === 'imperial' ? 0 : 1 })
  return (
    <g>
      <text x={x} y={y + 20} fill={C.dim} fontFamily={FONT_LABEL} fontSize={22} fontWeight={900} {...LEGIBLE}>{label}</text>
      <Bar x={x + 42} y={y + 6} w={112} h={16} f={f} color={color} />
      <text x={x + 154} y={y + 68} textAnchor="end" fill={color} fontFamily={FONT_LABEL} fontSize={44} fontWeight={900} {...legibleStroke(44)}>{reading.display}</text>
      <text x={x + 158} y={y + 68} fill={C.dim} fontFamily={FONT_LABEL} fontSize={18} fontWeight={800} {...LEGIBLE}>{reading.unit}</text>
    </g>
  )
}

function BrakeLinePress({ width, height, snapshot, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
  const p = snapshot?.brakeLinePressBar
  return (
    <Root width={width} height={height} snapshot={snapshot}>
      <BrakeCell label="FL" x={38} y={42} value={num(p?.lf)} unitSystem={unitSystem} />
      <BrakeCell label="FR" x={226} y={42} value={num(p?.rf)} unitSystem={unitSystem} />
      <BrakeCell label="RL" x={38} y={142} value={num(p?.lr)} unitSystem={unitSystem} />
      <BrakeCell label="RR" x={226} y={142} value={num(p?.rr)} unitSystem={unitSystem} />
    </Root>
  )
}

const SKIES_LABELS = ['CLEAR', 'PARTLY', 'MOSTLY', 'OVERCAST'] as const

function skiesLabel(raw: number | undefined): string | undefined {
  if (raw == null) return undefined
  return SKIES_LABELS[Math.trunc(raw)]
}

function SkiesGlyph({ label, color }: { label: string | undefined; color: string }): ReactElement {
  const active = label != null
  const cloudOpacity = label === 'OVERCAST' ? 1 : label === 'MOSTLY' ? 0.82 : label === 'PARTLY' ? 0.55 : 0.22
  return (
    <g opacity={active ? 1 : 0.32}>
      <circle cx={162} cy={88} r={34} fill={label === 'CLEAR' ? C.amber : 'rgba(255,176,32,0.24)'} stroke={label === 'CLEAR' ? C.amber : C.dim} strokeWidth={5} opacity={label === 'OVERCAST' ? 0.22 : 1} />
      {Array.from({ length: 10 }, (_, i) => {
        const a = (Math.PI * 2 * i) / 10
        return <line key={i} x1={162 + Math.cos(a) * 46} y1={88 + Math.sin(a) * 46} x2={162 + Math.cos(a) * 58} y2={88 + Math.sin(a) * 58} stroke={C.amber} strokeWidth={4} strokeLinecap="round" opacity={label === 'OVERCAST' ? 0.08 : 0.45} />
      })}
      <path d="M143 136 C146 111 166 98 190 105 C202 82 229 75 251 89 C267 99 276 115 276 136 C299 137 315 154 315 175 C315 199 295 215 269 215 H148 C118 215 96 197 96 172 C96 150 114 135 143 136" fill="rgba(34,195,255,0.10)" stroke={color} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" opacity={cloudOpacity} />
    </g>
  )
}

function Skies({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const label = skiesLabel(num(snapshot?.skies))
  const color = label == null ? C.dim : label === 'OVERCAST' ? C.dim : label === 'CLEAR' ? C.amber : C.cyan
  return (
    <Root width={width} height={height} snapshot={snapshot}>
      <defs>
        <filter id="irExtraSkiesGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="8" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <g filter={label ? 'url(#irExtraSkiesGlow)' : undefined}>
        <SkiesGlyph label={label} color={color} />
      </g>
      <BigNum x={W / 2} y={218} value={label ?? '—'} color={color} size={label == null ? 78 : label.length > 7 ? 48 : 62} />
    </Root>
  )
}

function RevLightsBar({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const state = resolveRevLightState(
    num(snapshot?.revLights?.pct),
    snapshot?.revLights?.blink
  )
  const w = width ?? WIDE_W
  const viewH = height ?? WIDE_H
  const layout = revLightRowLayout(w, viewH, 18, {
    gap: Math.max(3, Math.round((Number.isFinite(w) ? w : WIDE_W) / 180)),
    heightRatio: 0.62,
    minLedHeight: Math.min(8, Math.max(1, Number.isFinite(viewH) ? viewH : WIDE_H))
  })
  const lit = state.atShiftPoint ? layout.count : Math.round(state.pct * layout.count)
  return (
    <svg
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      width={layout.width}
      height={layout.height}
      preserveAspectRatio="none"
      role="img"
      aria-label="rev lights"
      style={{ display: 'block', background: 'transparent' }}
    >
      <defs>
        <filter id="irExtraRevGlow" x="-20%" y="-80%" width="140%" height="260%">
          <feGaussianBlur stdDeviation="9" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <g filter={state.atShiftPoint ? 'url(#irExtraRevGlow)' : undefined}>
        <ShiftStrobe active={state.atShiftPoint} />
        {Array.from({ length: layout.count }, (_, i) => {
          const z = i / (layout.count - 1)
          const base = z < 0.52 ? C.green : z < 0.78 ? C.amber : C.red
          const on = i < lit
          return <rect key={i} x={layout.positions[i]} y={layout.y} width={layout.ledWidth} height={layout.ledHeight} rx={Math.min(8, layout.ledHeight / 4)} fill={on ? revFill(base, state.atShiftPoint) : C.recess} stroke={on ? revFill(base, state.atShiftPoint) : C.stroke} strokeWidth={1.5} opacity={on ? 1 : 0.46} />
        })}
      </g>
    </svg>
  )
}

function spotterState(v: unknown): CarLeftRightState {
  return v === 'left' || v === 'right' || v === 'both' ? v : 'clear'
}

function CarsAlongside({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const side = spotterState(snapshot?.carLeftRight)
  const count = num(snapshot?.carLeftRightCount)
  const left = side === 'left' || side === 'both'
  const right = side === 'right' || side === 'both'
  const active = left || right
  const label = active ? (side === 'both' ? 'BOTH' : side.toUpperCase()) : 'CLEAR'
  const shownCount = active && count != null && count > 1 ? fixed(count, 0) : ''
  return (
    <Root width={width} height={height} snapshot={snapshot}>
      <defs>
        <filter id="irExtraSpotterGlow" x="-70%" y="-70%" width="240%" height="240%">
          <feGaussianBlur stdDeviation="10" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <g filter={active ? 'url(#irExtraSpotterGlow)' : undefined}>
        <path d="M196 60 h28 l23 48 v64 l-20 28 h-34 l-20 -28 v-64 z" fill="rgba(255,255,255,0.08)" stroke={active ? C.text : C.dim} strokeWidth={5} strokeLinejoin="round" opacity={active ? 0.95 : 0.48} />
        <path d="M190 116 h40 M184 164 h52" stroke={active ? C.text : C.dim} strokeWidth={4} strokeLinecap="round" opacity={active ? 0.86 : 0.36} />
        <path d="M58 120 L132 70 V101 H168 V139 H132 V170 Z" fill={left ? C.amber : C.recess} stroke={left ? C.amber : C.stroke} strokeWidth={3} opacity={left ? 1 : 0.34} />
        <path d="M362 120 L288 70 V101 H252 V139 H288 V170 Z" fill={right ? C.amber : C.recess} stroke={right ? C.amber : C.stroke} strokeWidth={3} opacity={right ? 1 : 0.34} />
      </g>
      <text x={W / 2} y={224} textAnchor="middle" fill={active ? C.amber : C.dim} fontFamily={FONT_LABEL} fontSize={38} fontWeight={900} letterSpacing={2} {...legibleStroke(38)}>
        {label}{shownCount ? ` ${shownCount}` : ''}
      </text>
    </Root>
  )
}

export const fuelLevelPctWidget: HifiWidgetModule = {
  id: 'fuelLevelPct',
  title: 'Fuel Level Percent',
  description: 'Fuel level as a percent with a slim vertical column and low-fuel warning colour.',
  category: 'fuel',
  tags: ['fuel', 'level', 'percent', 'bar', 'clean'],
  requires: ['fuelLevelPct'],
  defaultSize: { w: W, h: H },
  render: (props) => <FuelLevel {...props} />
}

export const fuelRateWidget: HifiWidgetModule = {
  id: 'fuelRate',
  title: 'Fuel Rate',
  description: 'Fuel usage rate in kg/h with a high-consumption amber warning.',
  category: 'fuel',
  tags: ['fuel', 'rate', 'kg-h', 'digital', 'clean'],
  requires: ['fuelUsePerHourKg'],
  defaultSize: { w: W, h: H },
  render: (props) => <FuelRate {...props} />
}

export const brakeLinePressWidget: HifiWidgetModule = {
  id: 'brakeLinePress',
  title: 'Brake Line Pressure',
  description: 'Per-corner hydraulic brake line pressure grid in bar.',
  category: 'brakesEngine',
  tags: ['brake', 'pressure', 'corners', 'bar', 'clean'],
  requires: ['brakeLinePressBar'],
  defaultSize: { w: W, h: H },
  render: (props) => <BrakeLinePress {...props} />
}

export const skiesWidget: HifiWidgetModule = {
  id: 'skies',
  title: 'Skies',
  description: 'iRacing skies enum as an uppercase label with a weather glyph.',
  category: 'weather',
  tags: ['skies', 'weather', 'cloud', 'enum', 'clean'],
  requires: ['skies'],
  defaultSize: { w: W, h: H },
  render: (props) => <Skies {...props} />
}

export const revLightsBarWidget: HifiWidgetModule = {
  id: 'revLightsBar',
  title: 'Rev Lights Bar',
  description: 'Wide rev-light LED strip driven by iRacing revLights pct with blue shift strobe.',
  category: 'revlights',
  tags: ['rev-lights', 'led', 'shift', 'strobe', 'clean'],
  requires: ['revLights'],
  defaultSize: { w: WIDE_W, h: WIDE_H },
  render: (props) => <RevLightsBar {...props} />
}

export const carsAlongsideWidget: HifiWidgetModule = {
  id: 'carsAlongside',
  title: 'Cars Alongside',
  description: 'Spotter side indicator for cars left, right, or both sides.',
  category: 'gap',
  tags: ['spotter', 'alongside', 'left-right', 'gap', 'clean'],
  requires: ['carLeftRightCount', 'carLeftRight'],
  defaultSize: { w: W, h: H },
  render: (props) => <CarsAlongside {...props} />
}
