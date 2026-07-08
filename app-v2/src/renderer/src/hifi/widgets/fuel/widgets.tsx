import { type ReactElement, type ReactNode } from 'react'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { Bar, BigNum, C, FONT_LABEL, Frame, GaugeArc, VBar, fixed, num, signed } from '../kit'

const W = 420
const H = 286
const AMBER = '#f2b42b'
const WHITE = '#f2f3f5'
const RED = '#ff4338'
const GREEN = '#65d85a'
const CYAN = '#31d9f0'
const MAX_FUEL_PER_LAP_L = 5
const MAX_DELTA_LAPS = 4

function validPositive(v: number | undefined): number | undefined {
  return v != null && v > 0 ? v : undefined
}

function fuelLapsRemaining(snapshot: HifiWidgetProps['snapshot']): number | undefined {
  const fuel = num(snapshot?.fuelLiters)
  const perLap = validPositive(num(snapshot?.fuelPerLap))
  return fuel != null && perLap != null ? fuel / perLap : undefined
}

function fuelFraction(snapshot: HifiWidgetProps['snapshot']): number {
  const fuel = num(snapshot?.fuelLiters)
  const capacity = validPositive(num(snapshot?.fuelCapacityLiters))
  return fuel != null && capacity != null ? fuel / capacity : 0
}

function fuelLevelColor(f: number): string {
  if (f <= 0.15) return RED
  if (f <= 0.3) return AMBER
  return GREEN
}

function FuelIcon({ x, y, color = AMBER }: { x: number; y: number; color?: string }): ReactElement {
  return (
    <g transform={`translate(${x},${y})`} fill="none" stroke={color} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 6 h22 v43 h-22 z" />
      <path d="M12 10 h14 v13 h-14 z" />
      <path d="M30 15 c9 3 12 9 12 16 v15 c0 5 8 5 8 0 v-21" />
      <path d="M43 9 l8 8 v9" />
      <path d="M4 49 h31" />
    </g>
  )
}

function Tile({
  width,
  height,
  label,
  children,
  aria
}: {
  width?: number
  height?: number
  label: string
  children: ReactNode
  aria?: string
}): ReactElement {
  const w = width ?? W
  const h = height ?? H
  const id = `fuel-${label.replace(/\W+/g, '-').toLowerCase()}-${Math.round(w)}-${Math.round(h)}`
  return (
    <Frame w={w} h={h} label={aria ?? label} accent={AMBER}>
      <defs>
        <pattern id={`${id}-carbon`} width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <rect width="9" height="9" fill="#070808" />
          <path d="M0 0 h2 v9 h-2z" fill="rgba(255,255,255,0.025)" />
        </pattern>
        <filter id={`${id}-glow`} x="-45%" y="-45%" width="190%" height="190%">
          <feGaussianBlur stdDeviation="2.8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect x={8} y={8} width={w - 16} height={h - 16} rx={16} fill={`url(#${id}-carbon)`} stroke="rgba(242,180,43,0.8)" />
      <rect x={14} y={14} width={w - 28} height={h - 28} rx={13} fill="none" stroke="rgba(255,255,255,0.07)" />
      <FuelIcon x={28} y={28} />
      <text x={86} y={60} fill={AMBER} fontFamily={FONT_LABEL} fontSize={30} fontWeight={800} letterSpacing={4}>
        {label.toUpperCase()}
      </text>
      <g filter={`url(#${id}-glow)`}>{children}</g>
    </Frame>
  )
}

function FuelLevelTicks({ x, y, h }: { x: number; y: number; h: number }): ReactElement {
  const ticks: ReactElement[] = []
  for (let i = 1; i < 8; i++) {
    const yy = y + (h * i) / 8
    ticks.push(<path key={i} d={`M${x} ${yy} h8`} stroke="rgba(255,255,255,0.42)" strokeWidth={1} />)
  }
  return <g>{ticks}</g>
}

function SegmentedFuelBar({ x, y, w, h, f, color }: { x: number; y: number; w: number; h: number; f: number; color: string }): ReactElement {
  const count = 10
  const gap = 3
  const cellH = (h - gap * (count - 1)) / count
  const lit = Math.round(Math.max(0, Math.min(1, f)) * count)
  return (
    <g>
      <rect x={x - 4} y={y - 5} width={w + 8} height={h + 10} rx={8} fill="none" stroke="rgba(255,255,255,0.42)" strokeWidth={1.5} />
      <g opacity={0.22}>
        <VBar x={x} y={y} w={w} h={h} f={f} color={color} />
      </g>
      {Array.from({ length: count }, (_, i) => {
        const fromBottom = count - 1 - i
        return <rect key={i} x={x} y={y + i * (cellH + gap)} width={w} height={cellH} rx={1.5} fill={fromBottom < lit ? color : C.recess} opacity={fromBottom < lit ? 1 : 0.72} />
      })}
    </g>
  )
}

export function FuelWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const fuel = num(snapshot?.fuelLiters)
  const f = fuelFraction(snapshot)
  const color = fuel == null ? C.dim : fuelLevelColor(f)
  return (
    <Tile width={width} height={height} label="Fuel">
      <BigNum x={170} y={176} value={fixed(fuel, 1)} unit="L" color={fuel == null ? C.dim : WHITE} size={86} />
      <text x={342} y={88} fill={C.text} fontFamily={FONT_LABEL} fontSize={22} fontWeight={800}>
        F
      </text>
      <SegmentedFuelBar x={300} y={90} w={30} h={132} f={f} color={color} />
      <FuelLevelTicks x={340} y={88} h={134} />
      <text x={342} y={226} fill={C.text} fontFamily={FONT_LABEL} fontSize={22} fontWeight={800}>
        E
      </text>
    </Tile>
  )
}

export function FuelLapsWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const laps = fuelLapsRemaining(snapshot)
  return (
    <Tile width={width} height={height} label="Fuel Laps">
      <BigNum x={210} y={178} value={fixed(laps, 1)} unit="" color={laps == null ? C.dim : WHITE} size={96} />
      <text x={316} y={222} textAnchor="middle" fill={AMBER} fontFamily={FONT_LABEL} fontSize={34} fontWeight={800} letterSpacing={3}>
        LAPS
      </text>
    </Tile>
  )
}

export function FuelPerLapWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const perLap = num(snapshot?.fuelPerLap)
  const f = perLap != null ? perLap / MAX_FUEL_PER_LAP_L : 0
  const cx = 210
  const cy = 126
  return (
    <Tile width={width} height={height} label="Fuel Per Lap">
      <GaugeArc cx={cx} cy={cy} r={50} thickness={7} f={f} color={perLap == null ? C.dim : AMBER} />
      <GaugeArc cx={cx} cy={cy} r={50} thickness={3} f={0.36} color={CYAN} />
      {Array.from({ length: 17 }, (_, i) => {
        const a = -135 + (270 * i) / 16
        const rad = (a * Math.PI) / 180
        const r1 = 40
        const r2 = i % 4 === 0 ? 54 : 49
        const x1 = cx + Math.cos(rad) * r1
        const y1 = cy + Math.sin(rad) * r1
        const x2 = cx + Math.cos(rad) * r2
        const y2 = cy + Math.sin(rad) * r2
        return <path key={i} d={`M${x1} ${y1} L${x2} ${y2}`} stroke={i < 6 ? CYAN : i > 12 ? AMBER : 'rgba(255,255,255,0.35)'} strokeWidth={i % 4 === 0 ? 3 : 1.8} />
      })}
      <BigNum x={178} y={238} value={fixed(perLap, 2)} unit="" color={perLap == null ? C.dim : WHITE} size={56} />
      <text x={278} y={238} fill={AMBER} fontFamily={FONT_LABEL} fontSize={24} fontWeight={800} letterSpacing={1.5}>
        L/LAP
      </text>
    </Tile>
  )
}

export function FuelDeltaWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const fuelLaps = fuelLapsRemaining(snapshot)
  const raceLaps = num(snapshot?.lapsRemaining)
  const delta = fuelLaps != null && raceLaps != null ? fuelLaps - raceLaps : undefined
  const color = delta == null ? C.dim : delta >= 0 ? GREEN : RED
  const barF = delta == null ? 0.5 : 0.5 + Math.max(-MAX_DELTA_LAPS, Math.min(MAX_DELTA_LAPS, delta)) / (MAX_DELTA_LAPS * 2)
  const magnitude = Math.abs(barF - 0.5) * 2
  return (
    <Tile width={width} height={height} label="Fuel Delta">
      <BigNum x={204} y={156} value={signed(delta, 1)} unit="" color={color} size={82} />
      <text x={306} y={196} fill={color} fontFamily={FONT_LABEL} fontSize={30} fontWeight={800} letterSpacing={2}>
        LAPS
      </text>
      <path d="M54 216 h312" stroke="rgba(255,255,255,0.45)" strokeWidth={2} strokeLinecap="round" />
      <path d="M210 204 l8 14 h-16 z" fill="rgba(255,255,255,0.45)" />
      <rect x={210 - 1} y={220} width={2} height={38} fill="rgba(255,255,255,0.55)" />
      <text x={60} y={252} fill={RED} fontFamily={FONT_LABEL} fontSize={28} fontWeight={800}>
        −
      </text>
      <text x={360} y={252} textAnchor="end" fill={GREEN} fontFamily={FONT_LABEL} fontSize={28} fontWeight={800}>
        +
      </text>
      <rect x={78} y={236} width={264} height={4} rx={2} fill="rgba(255,255,255,0.12)" />
      {delta != null && delta >= 0 ? <Bar x={210} y={236} w={132} h={4} f={magnitude} color={color} /> : null}
      {delta != null && delta < 0 ? (
        <g transform="translate(210 0) scale(-1 1)">
          <Bar x={0} y={236} w={132} h={4} f={magnitude} color={color} />
        </g>
      ) : null}
      {Array.from({ length: 17 }, (_, i) => {
        const x = 82 + i * 16
        const c = i < 8 ? RED : i > 8 ? GREEN : 'rgba(255,255,255,0.55)'
        return <path key={i} d={`M${x} 236 v22`} stroke={c} strokeWidth={2.2} opacity={i === 8 ? 0.9 : 0.85} />
      })}
    </Tile>
  )
}

export const fuelWidget: HifiWidgetModule = {
  id: 'fuel',
  title: 'Fuel',
  description: 'Big fuel liters readout with a vertical E-to-F tank level bar.',
  category: 'fuel',
  tags: ['fuel', 'bignum', 'bar'],
  requires: ['fuelLiters', 'fuelCapacityLiters'],
  defaultSize: { w: W, h: H },
  render: (props) => <FuelWidget {...props} />
}

export const fuelLapsWidget: HifiWidgetModule = {
  id: 'fuelLaps',
  title: 'Fuel Laps',
  description: 'Estimated laps remaining from current fuel load and fuel-per-lap consumption.',
  category: 'fuel',
  tags: ['fuel-laps', 'bignum'],
  requires: ['fuelLiters', 'fuelPerLap'],
  defaultSize: { w: W, h: H },
  render: (props) => <FuelLapsWidget {...props} />
}

export const fuelPerLapWidget: HifiWidgetModule = {
  id: 'fuelPerLap',
  title: 'Fuel Per Lap',
  description: 'Fuel burn per lap with a compact arc gauge.',
  category: 'fuel',
  tags: ['fuel', 'gauge'],
  requires: ['fuelPerLap'],
  defaultSize: { w: W, h: H },
  render: (props) => <FuelPerLapWidget {...props} />
}

export const fuelDeltaWidget: HifiWidgetModule = {
  id: 'fuelDelta',
  title: 'Fuel Delta',
  description: 'Fuel surplus or deficit versus the race end, expressed in laps.',
  category: 'fuel',
  tags: ['fuel', 'delta', 'bar'],
  requires: ['fuelLiters', 'fuelPerLap', 'lapsRemaining'],
  defaultSize: { w: W, h: H },
  render: (props) => <FuelDeltaWidget {...props} />
}
