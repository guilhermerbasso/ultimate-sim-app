import { type ReactElement, type ReactNode } from 'react'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { Bar, C, FONT_BIG, FONT_LABEL, FONT_NUM, GaugeArc, LedRow, fixed, frac, gearLabel, num } from '../kit'

const W = 420
const H = 286
const CYAN = '#19c9ff'
const BLUE = '#1ea7ff'
const GREEN = '#28dd4b'
const YELLOW = '#ffd32d'
const RED = '#ff2026'
const WHITE = '#f4f5f7'

interface TileProps {
  label: string
  width?: number
  height?: number
  children: ReactNode
}

interface Tick {
  value: number
  label: string
}

function cleanId(label: string, w: number, h: number): string {
  return `drive-${label.replace(/\W+/g, '-').toLowerCase()}-${Math.round(w)}-${Math.round(h)}`
}

function Tile({ label, width, height, children }: TileProps): ReactElement {
  const w = width ?? W
  const h = height ?? H
  const id = cleanId(label, w, h)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} preserveAspectRatio="xMidYMid meet" role="img" aria-label={label}>
      <defs>
        <pattern id={`${id}-carbon`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <rect width="8" height="8" fill="#050607" />
          <path d="M0 0 h2 v8 h-2z" fill="rgba(255,255,255,0.025)" />
        </pattern>
        <linearGradient id={`${id}-rim`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="rgba(255,255,255,0.36)" />
          <stop offset="0.5" stopColor="rgba(255,255,255,0.08)" />
          <stop offset="1" stopColor="rgba(255,255,255,0.28)" />
        </linearGradient>
        <filter id={`${id}-soft-glow`} x="-55%" y="-55%" width="210%" height="210%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id={`${id}-led-glow`} x="-90%" y="-90%" width="280%" height="280%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect width={w} height={h} rx={20} fill={C.bg} />
      <rect x={2} y={2} width={w - 4} height={h - 4} rx={20} fill={`url(#${id}-carbon)`} stroke={`url(#${id}-rim)`} strokeWidth={2} />
      <rect x={16} y={20} width={w - 32} height={h - 40} rx={13} fill="rgba(0,0,0,0.42)" stroke={CYAN} strokeWidth={1.2} />
      <rect x={28} y={19} width={92} height={3} fill="#070808" />
      <rect x={w - 120} y={19} width={92} height={3} fill="#070808" />
      <text x={w / 2} y={30} textAnchor="middle" fill="#c9cbd0" fontFamily={FONT_LABEL} fontSize={22} fontWeight={800} letterSpacing={5}>
        {label.toUpperCase()}
      </text>
      <g filter={`url(#${id}-soft-glow)`}>{children}</g>
    </svg>
  )
}

function valueColor(value: number | undefined, color = WHITE): string {
  return value == null ? C.dim : color
}

function rpmFraction(rpm: number | undefined, maxRpm: number | undefined): number {
  const max = maxRpm != null && maxRpm > 0 ? maxRpm : undefined
  return max != null && rpm != null ? frac(rpm, 0, max) : 0
}

function rpmColor(f: number, missing: boolean): string {
  if (missing) return C.dim
  if (f < 0.62) return CYAN
  if (f < 0.78) return GREEN
  if (f < 0.9) return YELLOW
  return RED
}

function SpeedWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const speed = num(snapshot?.speedKmh)
  return (
    <Tile label="Speed" width={width} height={height}>
      <text x="50%" y="55%" textAnchor="middle" dominantBaseline="middle" fill={valueColor(speed)} fontFamily={FONT_BIG} fontSize={106} fontWeight={900} letterSpacing={-5}>
        {fixed(speed)}
      </text>
      <text x="50%" y={H - 58} textAnchor="middle" fill={speed == null ? C.dim : CYAN} fontFamily={FONT_LABEL} fontSize={34} fontWeight={700}>
        km/h
      </text>
    </Tile>
  )
}

function RpmTicks({ rpm, maxRpm, cx, cy, radius }: { rpm: number | undefined; maxRpm: number | undefined; cx: number; cy: number; radius: number }): ReactElement {
  const max = maxRpm != null && maxRpm > 0 ? maxRpm : 16000
  const current = rpm ?? -1
  const ticks = Array.from({ length: 61 }, (_, i) => {
    const pct = i / 60
    const rpmAtTick = pct * max
    const angle = (-220 + pct * 280) * (Math.PI / 180)
    const major = i % 10 === 0
    const r1 = radius - (major ? 24 : 15)
    const r2 = radius - 4
    const x1 = cx + Math.cos(angle) * r1
    const y1 = cy + Math.sin(angle) * r1
    const x2 = cx + Math.cos(angle) * r2
    const y2 = cy + Math.sin(angle) * r2
    const zone = pct
    const color = rpmAtTick <= current ? rpmColor(zone, false) : zone > 0.84 ? RED : zone > 0.72 ? YELLOW : CYAN
    return <path key={i} d={`M${x1} ${y1} L${x2} ${y2}`} stroke={color} strokeWidth={major ? 4 : 2.2} opacity={rpmAtTick <= current ? 1 : 0.62} />
  })
  const labels: Tick[] = [0, 2, 4, 6, 8, 10, 12, 14, 16].map((v) => ({ value: v, label: String(v) }))
  return (
    <g>
      {ticks}
      {labels.map((tick) => {
        const pct = tick.value / 16
        const angle = (-220 + pct * 280) * (Math.PI / 180)
        const x = cx + Math.cos(angle) * (radius - 50)
        const y = cy + Math.sin(angle) * (radius - 50) + 8
        return (
          <text key={tick.value} x={x} y={y} textAnchor="middle" fill={tick.value >= 14 ? RED : WHITE} fontFamily={FONT_NUM} fontSize={22} fontWeight={800}>
            {tick.label}
          </text>
        )
      })}
    </g>
  )
}

function RpmWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const rpm = num(snapshot?.rpm)
  const maxRpm = num(snapshot?.maxRpm)
  const f = rpmFraction(rpm, maxRpm)
  return (
    <Tile label="RPM" width={width} height={height}>
      <GaugeArc cx={210} cy={167} r={84} thickness={11} f={f} color={rpmColor(f, rpm == null)} />
      <RpmTicks rpm={rpm} maxRpm={maxRpm} cx={210} cy={167} radius={124} />
      <circle cx={210} cy={167} r={58} fill="rgba(2,4,6,0.78)" stroke="rgba(25,201,255,0.45)" />
      <text x={210} y={165} textAnchor="middle" fill={valueColor(rpm)} fontFamily={FONT_NUM} fontSize={38} fontWeight={900} letterSpacing={-1}>
        {fixed(rpm)}
      </text>
      <text x={210} y={198} textAnchor="middle" fill={rpm == null ? C.dim : CYAN} fontFamily={FONT_LABEL} fontSize={24} fontWeight={800} letterSpacing={4}>
        RPM
      </text>
    </Tile>
  )
}

function SegmentedRpmBar({ f, x, y, w, h, missing }: { f: number; x: number; y: number; w: number; h: number; missing: boolean }): ReactElement {
  const count = 20
  const gap = 4
  const cellW = (w - gap * (count - 1)) / count
  const lit = Math.round(Math.max(0, Math.min(1, f)) * count)
  return (
    <g>
      {Array.from({ length: count }, (_, i) => {
        const pct = i / (count - 1)
        const color = pct < 0.36 ? BLUE : pct < 0.62 ? GREEN : pct < 0.8 ? YELLOW : RED
        return <rect key={i} x={x + i * (cellW + gap)} y={y} width={cellW} height={h} rx={3} fill={i < lit && !missing ? color : C.recess} stroke="rgba(255,255,255,0.10)" opacity={i < lit && !missing ? 1 : 0.58} />
      })}
    </g>
  )
}

function RpmBarWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const rpm = num(snapshot?.rpm)
  const maxRpm = num(snapshot?.maxRpm)
  const f = rpmFraction(rpm, maxRpm)
  const ticks: Tick[] = [0, 4, 8, 12, 16].map((value) => ({ value, label: String(value) }))
  return (
    <Tile label="RPM Bar" width={width} height={height}>
      <SegmentedRpmBar f={f} x={36} y={112} w={348} h={58} missing={rpm == null} />
      <path d="M36 180 h348" stroke="rgba(255,255,255,0.32)" strokeWidth={2} />
      {ticks.map((tick) => {
        const x = 36 + (tick.value / 16) * 348
        return (
          <g key={tick.value}>
            <path d={`M${x} 176 v8`} stroke="rgba(255,255,255,0.65)" strokeWidth={2} />
            <text x={x} y={204} textAnchor="middle" fill={tick.value === 16 ? RED : WHITE} fontFamily={FONT_NUM} fontSize={20} fontWeight={800}>
              {tick.label}
            </text>
          </g>
        )
      })}
      <text x={210} y={230} textAnchor="middle" fill={rpm == null ? C.dim : CYAN} fontFamily={FONT_LABEL} fontSize={22} fontWeight={800} letterSpacing={2}>
        x1000 RPM
      </text>
      <Bar x={84} y={244} w={252} h={5} f={f} color={rpmColor(f, rpm == null)} />
    </Tile>
  )
}

function GearWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const gear = num(snapshot?.gear)
  const label = gearLabel(gear)
  return (
    <Tile label="Gear" width={width} height={height}>
      <text x="50%" y="56%" textAnchor="middle" dominantBaseline="middle" fill={gear == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontSize={174} fontWeight={900}>
        {label}
      </text>
    </Tile>
  )
}

function ShiftLedArc({ f, missing }: { f: number; missing: boolean }): ReactElement {
  const count = 8
  const lit = Math.round(Math.max(0, Math.min(1, f)) * count)
  return (
    <g>
      {Array.from({ length: count }, (_, i) => {
        const t = i / (count - 1)
        const x = 72 + i * 39.5
        const y = 151 - Math.sin(t * Math.PI) * 29
        const color = t < 0.28 ? BLUE : t < 0.58 ? GREEN : t < 0.78 ? YELLOW : RED
        const on = !missing && i < lit
        return (
          <g key={i} filter={on ? 'url(#drive-shift-rev-lights-420-286-led-glow)' : undefined}>
            <circle cx={x} cy={y} r={16} fill={on ? color : '#111419'} opacity={on ? 0.32 : 0.8} />
            <circle cx={x} cy={y} r={11} fill={on ? color : C.recess} stroke={on ? color : 'rgba(255,255,255,0.16)'} strokeWidth={2} />
            <circle cx={x - 4} cy={y - 5} r={3.5} fill="rgba(255,255,255,0.75)" opacity={on ? 0.85 : 0.18} />
          </g>
        )
      })}
    </g>
  )
}

function RevLightsWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const shiftPct = num(snapshot?.shiftIndicatorPct)
  const f = shiftPct == null ? 0 : Math.max(0, Math.min(1, shiftPct))
  return (
    <Tile label="Shift / Rev Lights" width={width} height={height}>
      <LedRow x={69} y={106} w={282} h={8} f={f} count={8} />
      <ShiftLedArc f={f} missing={shiftPct == null} />
      <text x={210} y={222} textAnchor="middle" fill={shiftPct == null ? C.dim : CYAN} fontFamily={FONT_NUM} fontSize={24} fontWeight={800}>
        {shiftPct == null ? '—' : `${fixed(f * 100)}%`}
      </text>
    </Tile>
  )
}

function SpeedGearWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const speed = num(snapshot?.speedKmh)
  const gear = num(snapshot?.gear)
  return (
    <Tile label="Speed + Gear" width={width} height={height}>
      <text x={142} y={157} textAnchor="middle" fill={valueColor(speed)} fontFamily={FONT_BIG} fontSize={78} fontWeight={900} letterSpacing={-4}>
        {fixed(speed)}
      </text>
      <text x={142} y={198} textAnchor="middle" fill={speed == null ? C.dim : CYAN} fontFamily={FONT_LABEL} fontSize={28} fontWeight={700}>
        km/h
      </text>
      <path d="M268 70 v166" stroke={gear == null && speed == null ? C.dim : CYAN} strokeWidth={1.4} opacity={0.75} />
      <text x={336} y={163} textAnchor="middle" fill={gear == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontSize={90} fontWeight={900}>
        {gearLabel(gear)}
      </text>
    </Tile>
  )
}

export const speedWidget: HifiWidgetModule = {
  id: 'speed',
  title: 'Speed',
  description: 'Large speed readout in km/h.',
  category: 'drive',
  tags: ['speed', 'bignum'],
  requires: ['speedKmh'],
  defaultSize: { w: W, h: H },
  render: (props) => <SpeedWidget {...props} />
}

export const rpmWidget: HifiWidgetModule = {
  id: 'rpm',
  title: 'RPM',
  description: 'Radial tachometer gauge with current RPM value.',
  category: 'drive',
  tags: ['rpm', 'gauge'],
  requires: ['rpm', 'maxRpm'],
  defaultSize: { w: W, h: H },
  render: (props) => <RpmWidget {...props} />
}

export const rpmBarWidget: HifiWidgetModule = {
  id: 'rpmBar',
  title: 'RPM Bar',
  description: 'Segmented horizontal tachometer bar.',
  category: 'drive',
  tags: ['rpm', 'bar'],
  requires: ['rpm', 'maxRpm'],
  defaultSize: { w: W, h: H },
  render: (props) => <RpmBarWidget {...props} />
}

export const gearWidget: HifiWidgetModule = {
  id: 'gear',
  title: 'Gear',
  description: 'Huge current gear indicator.',
  category: 'drive',
  tags: ['gear', 'bignum'],
  requires: ['gear'],
  defaultSize: { w: W, h: H },
  render: (props) => <GearWidget {...props} />
}

export const revlightsWidget: HifiWidgetModule = {
  id: 'revlights',
  title: 'Rev Lights',
  description: 'Blue-to-red shift LED arc with shift percentage.',
  category: 'drive',
  tags: ['revlights', 'led', 'shift'],
  requires: ['shiftIndicatorPct'],
  defaultSize: { w: W, h: H },
  render: (props) => <RevLightsWidget {...props} />
}

export const speedGearWidget: HifiWidgetModule = {
  id: 'speedGear',
  title: 'Speed + Gear',
  description: 'Combined speed and gear tile.',
  category: 'drive',
  tags: ['speed', 'gear'],
  requires: ['speedKmh', 'gear'],
  defaultSize: { w: W, h: H },
  render: (props) => <SpeedGearWidget {...props} />
}
