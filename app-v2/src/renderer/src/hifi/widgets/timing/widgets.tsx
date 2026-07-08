import { type ReactElement, type ReactNode } from 'react'
import type { HifiWidgetModule, HifiWidgetProps, TelemetryField } from '../types'
import { BigNum, C, FONT_LABEL, FONT_NUM, fixed, lapTime, num, signed } from '../kit'

const TILE_W = 256
const TILE_H = 184
const SMALL_W = 232
const SMALL_H = 172
const WIDE_W = 292
const WIDE_H = 172
const GREEN = '#54df4b'
const CYAN = '#38d8ef'
const PURPLE = '#b75cff'
const RED = '#ff3045'
const WHITE = '#f0f2f5'

type ValueKind = 'time' | 'big'

interface TileProps {
  label: string
  width?: number
  height?: number
  children: ReactNode
}

interface ValueWidgetOptions {
  label: string
  accent?: string
  value: string
  unit?: string
  kind?: ValueKind
  width?: number
  height?: number
}

function safeInt(v: unknown): number | undefined {
  const n = num(v)
  return n == null ? undefined : Math.trunc(n)
}

function nonNegativeInt(v: unknown): string {
  const n = safeInt(v)
  return n == null || n < 0 ? '—' : String(n)
}

function formatLap(v: unknown): string {
  const n = num(v)
  return n == null ? '—' : lapTime(n)
}

function formatClock(v: unknown): string {
  const n = num(v)
  if (n == null) return '—'
  const sec = Math.max(0, Math.floor(n))
  const minutes = Math.floor(sec / 60)
  const seconds = sec % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function valueColor(value: string, accent: string): string {
  return value === '—' ? C.dim : accent
}

function Tile({ label, width, height, children }: TileProps): ReactElement {
  const w = width ?? TILE_W
  const h = height ?? TILE_H
  const pid = `timing-${label.replace(/\W+/g, '-').toLowerCase()}-${Math.round(w)}x${Math.round(h)}`
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} preserveAspectRatio="xMidYMid meet" role="img" aria-label={label}>
      <defs>
        <pattern id={`${pid}-carbon`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <rect width="8" height="8" fill="#111316" />
          <path d="M0 0 h2 v8 h-2z" fill="rgba(255,255,255,0.025)" />
        </pattern>
        <filter id={`${pid}-glow`} x="-45%" y="-45%" width="190%" height="190%">
          <feGaussianBlur stdDeviation="2.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id={`${pid}-rim`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="rgba(255,255,255,0.34)" />
          <stop offset="0.5" stopColor="rgba(255,255,255,0.08)" />
          <stop offset="1" stopColor="rgba(255,255,255,0.28)" />
        </linearGradient>
      </defs>
      <rect width={w} height={h} rx={18} fill={C.bg} />
      <rect x={1.5} y={1.5} width={w - 3} height={h - 3} rx={18} fill={`url(#${pid}-carbon)`} stroke={`url(#${pid}-rim)`} strokeWidth={1.5} />
      <rect x={5.5} y={5.5} width={w - 11} height={h - 11} rx={14} fill="none" stroke="rgba(255,255,255,0.08)" />
      <text x={w / 2} y={34} textAnchor="middle" fill="#a8adb4" fontFamily={FONT_LABEL} fontSize={24} fontWeight={800} letterSpacing={2.2}>
        {label.toUpperCase()}
      </text>
      <rect x={8} y={49} width={w - 16} height={h - 58} rx={12} fill="#030405" stroke="rgba(255,255,255,0.16)" />
      <rect x={12} y={53} width={w - 24} height={h - 66} rx={9} fill="none" stroke="rgba(255,255,255,0.04)" />
      <g filter={`url(#${pid}-glow)`}>{children}</g>
    </svg>
  )
}

function DigitalText({
  x,
  y,
  value,
  size,
  color,
  anchor = 'middle'
}: {
  x: number
  y: number
  value: string
  size: number
  color: string
  anchor?: 'start' | 'middle' | 'end'
}): ReactElement {
  return (
    <text x={x} y={y} textAnchor={anchor} fill={color} fontFamily={`${FONT_NUM}, 'DSEG7 Classic', 'Digital-7', monospace`} fontSize={size} fontWeight={800} letterSpacing={value.length > 6 ? -2 : 0}>
      {value}
    </text>
  )
}

function ValueWidget({ label, accent = CYAN, value, unit, kind = 'big', width, height }: ValueWidgetOptions): ReactElement {
  const w = width ?? SMALL_W
  const h = height ?? SMALL_H
  const color = valueColor(value, accent)
  const size = kind === 'time' ? Math.min(48, w / Math.max(5.2, value.length * 0.68)) : Math.min(86, w * 0.42)
  return (
    <Tile label={label} width={w} height={h}>
      {kind === 'big' ? (
        <BigNum x={w / 2} y={h * 0.72} value={value} unit={unit} color={color} size={size} />
      ) : (
        <DigitalText x={w / 2} y={h * 0.68} value={value} size={size} color={color} />
      )}
    </Tile>
  )
}

function DeltaWidget({ label, value, width, height }: { label: string; value: unknown; width?: number; height?: number }): ReactElement {
  const w = width ?? TILE_W
  const h = height ?? TILE_H
  const delta = num(value)
  const text = delta == null ? '—' : signed(delta, 2)
  const color = delta == null ? C.dim : delta <= 0 ? GREEN : RED
  const max = 1.5
  const mag = delta == null ? 0 : Math.min(1, Math.abs(delta) / max)
  const barX = 18
  const barY = h - 42
  const barW = w - 36
  const barH = 24
  const center = barX + barW / 2
  const segs = 20
  const fillW = (barW / 2) * mag
  return (
    <Tile label={label} width={w} height={h}>
      <DigitalText x={w / 2} y={h * 0.68} value={text} size={70} color={color} />
      <g>
        <rect x={barX} y={barY} width={barW} height={barH} rx={3} fill="#121417" stroke="rgba(255,255,255,0.10)" />
        <rect x={barX} y={barY - 9} width={barW} height={3} rx={1.5} fill="#15181c" stroke="rgba(255,255,255,0.10)" strokeWidth={0.5} />
        {delta != null && delta <= 0 ? <rect x={center - fillW} y={barY - 9} width={fillW} height={3} rx={1.5} fill={GREEN} /> : null}
        {delta != null && delta > 0 ? <rect x={center} y={barY - 9} width={fillW} height={3} rx={1.5} fill={RED} /> : null}
        {Array.from({ length: segs }, (_, i) => {
          const left = i < segs / 2
          const lit = delta != null && ((delta <= 0 && left && (segs / 2 - i) / (segs / 2) <= mag) || (delta > 0 && !left && (i - segs / 2 + 1) / (segs / 2) <= mag))
          return (
            <rect
              key={i}
              x={barX + i * (barW / segs) + 2}
              y={barY + 3}
              width={barW / segs - 4}
              height={barH - 6}
              rx={1.5}
              fill={left ? GREEN : RED}
              opacity={lit ? 1 : 0.28}
            />
          )
        })}
        <rect x={center - 1.5} y={barY - 3} width={3} height={barH + 6} fill="#bfc4c9" opacity={0.75} />
      </g>
    </Tile>
  )
}

function PositionWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? WIDE_W
  const h = height ?? SMALL_H
  const pos = nonNegativeInt(snapshot?.position)
  const total = nonNegativeInt(snapshot?.totalCars)
  return (
    <Tile label="Position" width={w} height={h}>
      <DigitalText x={w * 0.18} y={h * 0.68} value={pos === '—' ? '—' : `P${pos}`} size={68} color={valueColor(pos, CYAN)} anchor="start" />
      <text x={w - 26} y={h * 0.68} textAnchor="end" fill={WHITE} fontFamily={FONT_NUM} fontSize={48} fontWeight={800}>
        <tspan fill={WHITE}>/</tspan>
        <tspan fill={valueColor(total, WHITE)}> {total}</tspan>
      </text>
    </Tile>
  )
}

function ClassPositionWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const pos = nonNegativeInt(snapshot?.classPosition)
  return <ValueWidget label="Class Pos" value={pos === '—' ? pos : `P${pos}`} accent={CYAN} kind="time" width={width} height={height} />
}

function makeWidget({
  id,
  title,
  description,
  tags,
  requires,
  defaultSize,
  render
}: {
  id: string
  title: string
  description: string
  tags: string[]
  requires: TelemetryField[]
  defaultSize: { w: number; h: number }
  render: (props: HifiWidgetProps) => ReactElement
}): HifiWidgetModule {
  return { id, title, description, category: 'timing', tags, requires, defaultSize, render }
}

export const TIMING_WIDGETS: HifiWidgetModule[] = [
  makeWidget({
    id: 'deltaBest',
    title: 'Delta Best',
    description: 'Diverging gain/loss bar against personal best lap.',
    tags: ['delta', 'bar'],
    requires: ['deltaToBestSec'],
    defaultSize: { w: TILE_W, h: TILE_H },
    render: ({ snapshot, width, height }) => <DeltaWidget label="Delta" value={snapshot?.deltaToBestSec} width={width} height={height} />
  }),
  makeWidget({
    id: 'deltaSession',
    title: 'Delta Session',
    description: 'Diverging gain/loss bar against the session best lap.',
    tags: ['delta', 'bar'],
    requires: ['deltaToSessionBestSec'],
    defaultSize: { w: TILE_W, h: TILE_H },
    render: ({ snapshot, width, height }) => <DeltaWidget label="Session Δ" value={snapshot?.deltaToSessionBestSec} width={width} height={height} />
  }),
  makeWidget({
    id: 'lapCurrent',
    title: 'Current Lap Time',
    description: 'Current lap time in mm:ss.mmm format.',
    tags: ['laps', 'digital'],
    requires: ['currentLapTimeSec'],
    defaultSize: { w: TILE_W, h: TILE_H },
    render: ({ snapshot, width, height }) => <ValueWidget label="Lap Time" value={formatLap(snapshot?.currentLapTimeSec)} accent={CYAN} kind="time" width={width} height={height} />
  }),
  makeWidget({
    id: 'lapLast',
    title: 'Last Lap Time',
    description: 'Previous completed lap time in mm:ss.mmm format.',
    tags: ['laps', 'digital'],
    requires: ['lastLapTimeSec'],
    defaultSize: { w: TILE_W, h: TILE_H },
    render: ({ snapshot, width, height }) => <ValueWidget label="Last Lap" value={formatLap(snapshot?.lastLapTimeSec)} accent={CYAN} kind="time" width={width} height={height} />
  }),
  makeWidget({
    id: 'lapBest',
    title: 'Best Lap Time',
    description: 'Best lap time with a purple timing accent.',
    tags: ['laps', 'digital', 'best'],
    requires: ['bestLapTimeSec'],
    defaultSize: { w: TILE_W, h: TILE_H },
    render: ({ snapshot, width, height }) => <ValueWidget label="Best Lap" value={formatLap(snapshot?.bestLapTimeSec)} accent={PURPLE} kind="time" width={width} height={height} />
  }),
  makeWidget({
    id: 'lapNumber',
    title: 'Lap Number',
    description: 'Current race lap number.',
    tags: ['laps', 'bignum'],
    requires: ['currentLap'],
    defaultSize: { w: SMALL_W, h: SMALL_H },
    render: ({ snapshot, width, height }) => <ValueWidget label="Lap" value={nonNegativeInt(snapshot?.currentLap)} accent={CYAN} width={width} height={height} />
  }),
  makeWidget({
    id: 'lapsRemaining',
    title: 'Laps Remaining',
    description: 'Remaining race laps.',
    tags: ['laps', 'bignum'],
    requires: ['lapsRemaining'],
    defaultSize: { w: SMALL_W, h: SMALL_H },
    render: ({ snapshot, width, height }) => <ValueWidget label="Laps Left" value={fixed(num(snapshot?.lapsRemaining), 0)} accent={CYAN} width={width} height={height} />
  }),
  makeWidget({
    id: 'timeRemaining',
    title: 'Time Remaining',
    description: 'Session countdown clock in mm:ss format.',
    tags: ['session', 'clock'],
    requires: ['sessionTimeRemainingSec'],
    defaultSize: { w: TILE_W, h: SMALL_H },
    render: ({ snapshot, width, height }) => <ValueWidget label="Time Left" value={formatClock(snapshot?.sessionTimeRemainingSec)} accent={CYAN} kind="time" width={width} height={height} />
  }),
  makeWidget({
    id: 'position',
    title: 'Position',
    description: 'Overall race position with total car count.',
    tags: ['position', 'bignum'],
    requires: ['position', 'totalCars'],
    defaultSize: { w: WIDE_W, h: SMALL_H },
    render: (props) => <PositionWidget {...props} />
  }),
  makeWidget({
    id: 'classPosition',
    title: 'Class Position',
    description: 'Current class position.',
    tags: ['position', 'bignum', 'class'],
    requires: ['classPosition'],
    defaultSize: { w: SMALL_W, h: SMALL_H },
    render: (props) => <ClassPositionWidget {...props} />
  })
]
