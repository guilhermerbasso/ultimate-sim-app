import { type ReactElement, type ReactNode } from 'react'
import type { HifiWidgetModule, HifiWidgetProps, TelemetryField } from '../types'
import { C, CleanTile, FONT_NUM, condColor, lapTime, legibleStroke, num, signed } from '../kit'

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

type ValueKind = 'time' | 'big'

interface TileProps {
  width?: number
  height?: number
  children: ReactNode
}

interface ValueWidgetOptions {
  accent?: string
  value: string
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

function Tile({ width, height, children }: TileProps): ReactElement {
  const w = width ?? TILE_W
  const h = height ?? TILE_H
  return <CleanTile width={w} height={h}>{children}</CleanTile>
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
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      dominantBaseline="central"
      fill={color}
      fontFamily={`${FONT_NUM}, 'DSEG7 Classic', 'Digital-7', monospace`}
      fontSize={size}
      fontWeight={800}
      letterSpacing={value.length > 6 ? -2 : 0}
      {...legibleStroke(size)}
    >
      {value}
    </text>
  )
}

function ValueWidget({ accent = CYAN, value, kind = 'big', width, height }: ValueWidgetOptions): ReactElement {
  const w = width ?? SMALL_W
  const h = height ?? SMALL_H
  const color = valueColor(value, accent)
  const size = kind === 'time' ? Math.min(h * 0.38, w / Math.max(4.8, value.length * 0.58)) : Math.min(h * 0.52, w / Math.max(2.6, value.length * 0.6))
  return (
    <Tile width={w} height={h}>
      <DigitalText x={w / 2} y={h / 2} value={value} size={size} color={color} />
    </Tile>
  )
}

function DeltaWidget({ value, width, height }: { value: unknown; width?: number; height?: number }): ReactElement {
  const w = width ?? TILE_W
  const h = height ?? TILE_H
  const delta = num(value)
  const text = delta == null ? '—' : signed(delta, 2)
  const color = condColor(delta, { positiveIsGood: false, deadzone: 0.005, neutral: C.text })
  const max = 1.5
  const mag = delta == null ? 0 : Math.min(1, Math.abs(delta) / max)
  const barX = 18
  const barY = h - 42
  const barW = w - 36
  const barH = 24
  const center = barX + barW / 2
  const segs = 20
  const fillW = (barW / 2) * mag
  const size = Math.min(h * 0.42, w / Math.max(3.8, text.length * 0.58))
  return (
    <Tile width={w} height={h}>
      <DigitalText x={w / 2} y={h / 2} value={text} size={size} color={color} />
      <g>
        <rect x={barX} y={barY - 9} width={barW} height={3} rx={1.5} fill="rgba(255,255,255,0.16)" />
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
              opacity={lit ? 1 : 0.18}
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
  const text = pos === '—' && total === '—' ? '—' : `${pos === '—' ? '—' : `P${pos}`} / ${total}`
  const size = Math.min(h * 0.44, w / Math.max(4.2, text.length * 0.58))
  return (
    <Tile width={w} height={h}>
      <DigitalText x={w / 2} y={h / 2} value={text} size={size} color={pos === '—' ? C.dim : CYAN} />
    </Tile>
  )
}

function ClassPositionWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const pos = nonNegativeInt(snapshot?.classPosition)
  return <ValueWidget value={pos === '—' ? pos : `P${pos}`} accent={CYAN} kind="time" width={width} height={height} />
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
    render: ({ snapshot, width, height }) => <DeltaWidget value={snapshot?.deltaToBestSec} width={width} height={height} />
  }),
  makeWidget({
    id: 'deltaSession',
    title: 'Delta Session',
    description: 'Diverging gain/loss bar against the session best lap.',
    tags: ['delta', 'bar'],
    requires: ['deltaToSessionBestSec'],
    defaultSize: { w: TILE_W, h: TILE_H },
    render: ({ snapshot, width, height }) => <DeltaWidget value={snapshot?.deltaToSessionBestSec} width={width} height={height} />
  }),
  makeWidget({
    id: 'lapCurrent',
    title: 'Current Lap Time',
    description: 'Current lap time in mm:ss.mmm format.',
    tags: ['laps', 'digital'],
    requires: ['currentLapTimeSec'],
    defaultSize: { w: TILE_W, h: TILE_H },
    render: ({ snapshot, width, height }) => <ValueWidget value={formatLap(snapshot?.currentLapTimeSec)} accent={CYAN} kind="time" width={width} height={height} />
  }),
  makeWidget({
    id: 'lapLast',
    title: 'Last Lap Time',
    description: 'Previous completed lap time in mm:ss.mmm format.',
    tags: ['laps', 'digital'],
    requires: ['lastLapTimeSec'],
    defaultSize: { w: TILE_W, h: TILE_H },
    render: ({ snapshot, width, height }) => <ValueWidget value={formatLap(snapshot?.lastLapTimeSec)} accent={CYAN} kind="time" width={width} height={height} />
  }),
  makeWidget({
    id: 'lapBest',
    title: 'Best Lap Time',
    description: 'Best lap time with a purple timing accent.',
    tags: ['laps', 'digital', 'best'],
    requires: ['bestLapTimeSec'],
    defaultSize: { w: TILE_W, h: TILE_H },
    render: ({ snapshot, width, height }) => <ValueWidget value={formatLap(snapshot?.bestLapTimeSec)} accent={PURPLE} kind="time" width={width} height={height} />
  }),
  makeWidget({
    id: 'lapNumber',
    title: 'Lap Number',
    description: 'Current race lap number.',
    tags: ['laps', 'bignum'],
    requires: ['currentLap'],
    defaultSize: { w: SMALL_W, h: SMALL_H },
    render: ({ snapshot, width, height }) => <ValueWidget value={nonNegativeInt(snapshot?.currentLap)} accent={CYAN} width={width} height={height} />
  }),
  makeWidget({
    id: 'lapsRemaining',
    title: 'Laps Remaining',
    description: 'Remaining race laps.',
    tags: ['laps', 'bignum'],
    requires: ['lapsRemaining'],
    defaultSize: { w: SMALL_W, h: SMALL_H },
    render: ({ snapshot, width, height }) => <ValueWidget value={nonNegativeInt(snapshot?.lapsRemaining)} accent={CYAN} width={width} height={height} />
  }),
  makeWidget({
    id: 'timeRemaining',
    title: 'Time Remaining',
    description: 'Session countdown clock in mm:ss format.',
    tags: ['session', 'clock'],
    requires: ['sessionTimeRemainingSec'],
    defaultSize: { w: TILE_W, h: SMALL_H },
    render: ({ snapshot, width, height }) => <ValueWidget value={formatClock(snapshot?.sessionTimeRemainingSec)} accent={CYAN} kind="time" width={width} height={height} />
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
