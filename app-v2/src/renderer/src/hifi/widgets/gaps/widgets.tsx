import { type ReactElement, type ReactNode } from 'react'
import type { DriverEntry, RadarCarEntry, RelativeCarEntry, TelemetrySnapshot } from '../../../../../shared/telemetry'
import type { HifiWidgetModule, HifiWidgetProps, TelemetryField } from '../types'
import { Bar, BigNum, C, FONT_LABEL, FONT_NUM, fixed, num, signed } from '../kit'

const BIG_W = 232
const BIG_H = 172
const DELTA_W = 276
const DELTA_H = 172
const LIST_W = 338
const LIST_H = 206
const RADAR_W = 258
const RADAR_H = 258
const CYAN = '#38d8ef'
const GREEN = '#54df4b'
const RED = '#ff3045'
const AMBER = '#ffb020'
const PURPLE = '#9b59ff'
const ORANGE = '#ff6a26'
const LMP = '#35d66b'

interface RowData {
  key: string
  pos: string
  klass: string
  classColor: string
  carNumber: string
  name: string
  gap: string
  isPlayer: boolean
}

function safeText(value: unknown, fallback = '—'): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

function shortName(value: unknown, max = 11): string {
  const text = safeText(value)
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function classLabel(value: unknown): string {
  const text = safeText(value, 'GT3')
  return text.length > 5 ? text.slice(0, 5).toUpperCase() : text.toUpperCase()
}

function classColor(value: unknown, fallback = PURPLE): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(text) ? text : fallback
}

function fmtGap(value: unknown): string {
  const v = num(value)
  if (v == null) return '—'
  if (Math.abs(v) >= 99) return `${v > 0 ? '+' : ''}${v.toFixed(0)}s`
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}s`
}

function gapValue(snapshot: TelemetrySnapshot | null | undefined, side: 'ahead' | 'behind'): number | undefined {
  const direct = num(snapshot?.relatives?.[side]?.gapSec)
  if (direct != null) return direct
  const player = snapshot?.drivers?.find((driver) => driver.isPlayer || driver.carIdx === snapshot.playerCarIdx)
  if (!player) return undefined
  const sorted = [...(snapshot?.drivers ?? [])].filter((driver) => num(driver.position) != null).sort((a, b) => (num(a.position) ?? 0) - (num(b.position) ?? 0))
  const index = sorted.findIndex((driver) => driver.carIdx === player.carIdx)
  const other = side === 'ahead' ? sorted[index - 1] : sorted[index + 1]
  return num(other?.gapToPlayerSec)
}

function fallbackEntry(snapshot: TelemetrySnapshot | null | undefined, side: 'ahead' | 'behind'): RelativeCarEntry | undefined {
  const direct = snapshot?.relatives?.[side]
  if (direct) return direct
  const player = snapshot?.drivers?.find((driver) => driver.isPlayer || driver.carIdx === snapshot.playerCarIdx)
  if (!player) return undefined
  const sorted = [...(snapshot?.drivers ?? [])].filter((driver) => num(driver.position) != null).sort((a, b) => (num(a.position) ?? 0) - (num(b.position) ?? 0))
  const index = sorted.findIndex((driver) => driver.carIdx === player.carIdx)
  const driver = side === 'ahead' ? sorted[index - 1] : sorted[index + 1]
  if (!driver) return undefined
  return {
    carIdx: driver.carIdx,
    name: driver.name,
    carNumber: driver.carNumber,
    position: driver.position,
    classPosition: driver.classPosition,
    gapSec: driver.gapToPlayerSec,
    classColor: driver.classColor
  }
}

function playerDriver(snapshot: TelemetrySnapshot | null | undefined): DriverEntry | undefined {
  return snapshot?.drivers?.find((driver) => driver.isPlayer || driver.carIdx === snapshot.playerCarIdx)
}

function Tile({
  label,
  w,
  h,
  accent = CYAN,
  children
}: {
  label: string
  w: number
  h: number
  accent?: string
  children: ReactNode
}): ReactElement {
  const pid = `gaps-${label.replace(/\W+/g, '-').toLowerCase()}-${Math.round(w)}x${Math.round(h)}`
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} preserveAspectRatio="xMidYMid meet" role="img" aria-label={label}>
      <defs>
        <pattern id={`${pid}-carbon`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <rect width="8" height="8" fill="#0b0d10" />
          <path d="M0 0 h2 v8 h-2z" fill="rgba(255,255,255,0.028)" />
        </pattern>
        <filter id={`${pid}-glow`} x="-35%" y="-35%" width="170%" height="170%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect width={w} height={h} rx={16} fill={C.bg} />
      <rect x={1.5} y={1.5} width={w - 3} height={h - 3} rx={16} fill={`url(#${pid}-carbon)`} stroke="rgba(255,255,255,0.20)" />
      <rect x={8} y={8} width={w - 16} height={h - 16} rx={11} fill="#030405" stroke="rgba(255,255,255,0.08)" />
      <text x={w / 2} y={30} textAnchor="middle" fill="#a8adb4" fontFamily={FONT_LABEL} fontSize={22} fontWeight={800} letterSpacing={2.4}>
        {label.toUpperCase()}
      </text>
      <rect x={13} y={43} width={w - 26} height={1.4} fill={accent} opacity={0.95} />
      <g filter={`url(#${pid}-glow)`}>{children}</g>
    </svg>
  )
}

function GapBig({ snapshot, width, height, side }: HifiWidgetProps & { side: 'ahead' | 'behind' }): ReactElement {
  const w = width ?? BIG_W
  const h = height ?? BIG_H
  const value = gapValue(snapshot, side)
  const color = value == null ? C.dim : CYAN
  const arrow = side === 'ahead' ? '▲' : '▼'
  return (
    <Tile label={side === 'ahead' ? 'Gap Ahead' : 'Gap Behind'} w={w} h={h} accent={color}>
      <text x={34} y={92} fill={color} fontFamily={FONT_LABEL} fontSize={34} fontWeight={900}>
        {arrow}
      </text>
      <BigNum x={w / 2 + 8} y={118} value={value == null ? '—' : signed(value, 2)} unit="s" color={color} size={Math.min(52, w * 0.22)} />
      <text x={w / 2} y={148} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={14} fontWeight={700} letterSpacing={1.4}>
        PLAYER-CENTRIC RELATIVE
      </text>
    </Tile>
  )
}

function DeltaBars({ snapshot, width, height, side }: HifiWidgetProps & { side: 'ahead' | 'behind' }): ReactElement {
  const w = width ?? DELTA_W
  const h = height ?? DELTA_H
  const value = gapValue(snapshot, side)
  const text = value == null ? '—' : signed(value, 2)
  const improving = value != null && value <= 0
  const color = value == null ? C.dim : CYAN
  const mag = value == null ? 0 : Math.min(1, Math.abs(value) / 5)
  const x = 24
  const y = 126
  const barW = w - 48
  const center = x + barW / 2
  const segs = 18
  return (
    <Tile label={side === 'ahead' ? 'Delta Ahead' : 'Delta Behind'} w={w} h={h} accent={color}>
      <text x={w / 2} y={104} textAnchor="middle" fill={color} fontFamily={FONT_NUM} fontSize={58} fontWeight={900} letterSpacing={-1.5}>
        {text}
      </text>
      <Bar x={x} y={y - 14} w={barW} h={3} f={mag} color={improving ? GREEN : RED} />
      <rect x={x} y={y} width={barW} height={24} rx={4} fill="#121417" stroke="rgba(255,255,255,0.12)" />
      {Array.from({ length: segs }, (_, i) => {
        const left = i < segs / 2
        const sideLit = value != null && ((value < 0 && left) || (value > 0 && !left))
        const lit = sideLit && (left ? (segs / 2 - i) / (segs / 2) <= mag : (i - segs / 2 + 1) / (segs / 2) <= mag)
        return <rect key={i} x={x + i * (barW / segs) + 2} y={y + 4} width={barW / segs - 4} height={16} rx={2} fill={left ? GREEN : RED} opacity={lit ? 1 : 0.24} />
      })}
      <rect x={center - 1.5} y={y - 5} width={3} height={34} fill={C.text} opacity={0.8} />
    </Tile>
  )
}

function ClassPill({ x, y, label, color }: { x: number; y: number; label: string; color: string }): ReactElement {
  return (
    <g>
      <rect x={x} y={y} width={45} height={25} rx={5} fill={color} opacity={0.9} />
      <text x={x + 22.5} y={y + 17.5} textAnchor="middle" fill="#fff" fontFamily={FONT_LABEL} fontSize={14} fontWeight={900} fontStyle="italic">
        {label}
      </text>
    </g>
  )
}

function RelativeRow({ row, y, w }: { row: RowData; y: number; w: number }): ReactElement {
  return (
    <g>
      <rect x={13} y={y} width={w - 26} height={43} rx={7} fill={row.isPlayer ? 'rgba(34,195,255,0.10)' : '#080a0c'} stroke={row.isPlayer ? CYAN : 'rgba(255,255,255,0.10)'} />
      <rect x={15} y={y + 2} width={4} height={39} rx={2} fill={row.classColor} />
      <text x={39} y={y + 28} textAnchor="middle" fill={C.text} fontFamily={FONT_NUM} fontSize={20} fontWeight={800}>
        {row.pos}
      </text>
      <ClassPill x={62} y={y + 9} label={row.klass} color={row.classColor} />
      <text x={126} y={y + 28} fill={C.text} fontFamily={FONT_NUM} fontSize={18} fontWeight={900}>
        {row.carNumber}
      </text>
      <text x={174} y={y + 28} fill={row.isPlayer ? C.text : '#d8dde3'} fontFamily={FONT_LABEL} fontSize={21} fontWeight={900}>
        {row.name}
      </text>
      <text x={w - 15} y={y + 28} textAnchor="end" fill={row.gap === '—' ? C.dim : CYAN} fontFamily={FONT_NUM} fontSize={17} fontWeight={800}>
        {row.gap}
      </text>
    </g>
  )
}

function relativeRows(snapshot: TelemetrySnapshot | null): RowData[] {
  const ahead = fallbackEntry(snapshot, 'ahead')
  const behind = fallbackEntry(snapshot, 'behind')
  const player = playerDriver(snapshot)
  const baseClass = classLabel(player?.className)
  const baseColor = classColor(player?.classColor, ORANGE)
  return [
    {
      key: 'ahead',
      pos: fixed(num(ahead?.position), 0),
      klass: classLabel((ahead as RelativeCarEntry & { className?: string } | undefined)?.className),
      classColor: classColor(ahead?.classColor, PURPLE),
      carNumber: safeText(ahead?.carNumber),
      name: shortName(ahead?.name, 8),
      gap: fmtGap(ahead?.gapSec),
      isPlayer: false
    },
    {
      key: 'player',
      pos: fixed(num(player?.position ?? snapshot?.position), 0),
      klass: baseClass,
      classColor: baseColor,
      carNumber: safeText(player?.carNumber),
      name: 'YOU',
      gap: '—',
      isPlayer: true
    },
    {
      key: 'behind',
      pos: fixed(num(behind?.position), 0),
      klass: classLabel((behind as RelativeCarEntry & { className?: string } | undefined)?.className),
      classColor: classColor(behind?.classColor, ORANGE),
      carNumber: safeText(behind?.carNumber),
      name: shortName(behind?.name, 8),
      gap: fmtGap(behind?.gapSec),
      isPlayer: false
    }
  ]
}

function RelativeList({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? LIST_W
  const h = height ?? LIST_H
  const rows = relativeRows(snapshot)
  return (
    <Tile label="Relative" w={w} h={h} accent={CYAN}>
      {rows.map((row, i) => <RelativeRow key={row.key} row={row} y={58 + i * 46} w={w} />)}
    </Tile>
  )
}

function standingsRows(snapshot: TelemetrySnapshot | null): RowData[] {
  const drivers = [...(snapshot?.drivers ?? [])].filter((driver) => num(driver.position) != null).sort((a, b) => (num(a.position) ?? 0) - (num(b.position) ?? 0))
  const playerIndex = Math.max(0, drivers.findIndex((driver) => driver.isPlayer || driver.carIdx === snapshot?.playerCarIdx))
  const start = Math.max(0, Math.min(Math.max(0, drivers.length - 5), playerIndex - 2))
  const visible = drivers.slice(start, start + 5)
  const placeholders = Array.from({ length: Math.max(0, 5 - visible.length) }, (_, i) => i)
  return [
    ...visible.map((driver) => ({
      key: String(driver.carIdx),
      pos: fixed(num(driver.position), 0),
      klass: classLabel(driver.className ?? (driver.classId === 1 ? 'LMP2' : 'GT3')),
      classColor: classColor(driver.classColor, driver.classId === 1 ? LMP : PURPLE),
      carNumber: safeText(driver.carNumber),
      name: driver.isPlayer || driver.carIdx === snapshot?.playerCarIdx ? 'YOU' : shortName(driver.name, 8),
      gap: driver.isPlayer || driver.carIdx === snapshot?.playerCarIdx ? '—' : fmtGap(driver.gapToPlayerSec),
      isPlayer: driver.isPlayer || driver.carIdx === snapshot?.playerCarIdx
    })),
    ...placeholders.map((i) => ({
      key: `placeholder-${i}`,
      pos: '—',
      klass: 'GT3',
      classColor: PURPLE,
      carNumber: '—',
      name: '—',
      gap: '—',
      isPlayer: false
    }))
  ]
}

function Standings({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? LIST_W
  const h = height ?? 262
  const rows = standingsRows(snapshot)
  return (
    <Tile label="Standings" w={w} h={h} accent={CYAN}>
      {rows.map((row, i) => <RelativeRow key={row.key} row={row} y={55 + i * 39} w={w} />)}
    </Tile>
  )
}

function radarFallback(snapshot: TelemetrySnapshot | null | undefined): RadarCarEntry[] {
  const cars = snapshot?.radarCars?.filter((car) => num(car.relativeX) != null && num(car.relativeY) != null) ?? []
  if (cars.length > 0) return cars
  const ahead = fallbackEntry(snapshot, 'ahead')
  const behind = fallbackEntry(snapshot, 'behind')
  return [
    ...(ahead ? [{ carIdx: ahead.carIdx, name: ahead.name, relativeX: -3, relativeY: 12, gapSec: ahead.gapSec, classColor: ahead.classColor }] : []),
    ...(behind ? [{ carIdx: behind.carIdx, name: behind.name, relativeX: 3, relativeY: -12, gapSec: behind.gapSec, classColor: behind.classColor }] : [])
  ]
}

function Radar({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? RADAR_W
  const h = height ?? RADAR_H
  const cx = w / 2
  const cy = h / 2 + 14
  const cars = radarFallback(snapshot).slice(0, 8)
  return (
    <Tile label="Radar" w={w} h={h} accent={CYAN}>
      <g transform={`translate(${cx},${cy})`}>
        {[34, 62, 90].map((r) => <circle key={r} cx={0} cy={0} r={r} fill="none" stroke="rgba(255,255,255,0.16)" strokeDasharray={r === 62 ? '4 5' : undefined} />)}
        <line x1={0} x2={0} y1={-96} y2={96} stroke="rgba(255,255,255,0.16)" />
        <line x1={-96} x2={96} y1={0} y2={0} stroke="rgba(255,255,255,0.08)" />
        <g>
          <rect x={-12} y={-25} width={24} height={50} rx={7} fill="#18222a" stroke={CYAN} strokeWidth={2} />
          <rect x={-7} y={-17} width={14} height={12} rx={3} fill="rgba(56,216,239,0.22)" />
          <text x={0} y={42} textAnchor="middle" fill={C.text} fontFamily={FONT_LABEL} fontSize={13} fontWeight={900}>
            YOU
          </text>
        </g>
        {cars.map((car) => {
          const x = Math.max(-88, Math.min(88, (num(car.relativeX) ?? 0) * 7))
          const y = Math.max(-88, Math.min(88, -(num(car.relativeY) ?? 0) * 4.2))
          const color = classColor(car.classColor, GREEN)
          return (
            <g key={car.carIdx} transform={`translate(${x},${y})`}>
              <circle r={14} fill={color} stroke="rgba(255,255,255,0.35)" strokeWidth={1.5} />
              <text y={5} textAnchor="middle" fill="#fff" fontFamily={FONT_NUM} fontSize={13} fontWeight={900}>
                {safeText(car.name, String(car.carIdx)).slice(0, 2).toUpperCase()}
              </text>
            </g>
          )
        })}
      </g>
      <text x={w / 2} y={h - 15} textAnchor="middle" fill={cars.length > 0 ? CYAN : C.dim} fontFamily={FONT_LABEL} fontSize={14} fontWeight={800} letterSpacing={1.6}>
        {cars.length > 0 ? 'PROXIMITY LIVE' : 'NO CARS NEARBY'}
      </text>
    </Tile>
  )
}

function makeWidget(
  id: string,
  title: string,
  description: string,
  tags: string[],
  requires: TelemetryField[],
  defaultSize: { w: number; h: number },
  render: (props: HifiWidgetProps) => ReactElement
): HifiWidgetModule {
  return { id, title, description, category: 'gaps', tags, requires, defaultSize, render }
}

export const widgets: HifiWidgetModule[] = [
  makeWidget('gapAhead', 'Gap Ahead', 'Big signed seconds to the car ahead with an up arrow.', ['gap-ahead', 'bignum'], ['relatives'], { w: BIG_W, h: BIG_H }, (props) => <GapBig {...props} side="ahead" />),
  makeWidget('gapBehind', 'Gap Behind', 'Big signed seconds to the car behind with a down arrow.', ['gap-behind', 'bignum'], ['relatives'], { w: BIG_W, h: BIG_H }, (props) => <GapBig {...props} side="behind" />),
  makeWidget('deltaAhead', 'Delta Ahead', 'Gap trend to the car ahead with diverging micro-bars.', ['gap-ahead', 'delta', 'bar'], ['relatives'], { w: DELTA_W, h: DELTA_H }, (props) => <DeltaBars {...props} side="ahead" />),
  makeWidget('deltaBehind', 'Delta Behind', 'Gap trend to the car behind with diverging micro-bars.', ['gap-behind', 'delta', 'bar'], ['relatives'], { w: DELTA_W, h: DELTA_H }, (props) => <DeltaBars {...props} side="behind" />),
  makeWidget('relative', 'Relative', 'Compact three-row relative list with the player highlighted.', ['relative', 'list'], ['relatives', 'drivers', 'playerCarIdx'], { w: LIST_W, h: LIST_H }, (props) => <RelativeList {...props} />),
  makeWidget('standings', 'Standings', 'Compact five-row leaderboard with class tabs and gaps.', ['standings', 'list'], ['drivers', 'playerCarIdx'], { w: LIST_W, h: 262 }, (props) => <Standings {...props} />),
  makeWidget('radar', 'Radar', 'Proximity radar with central player car and surrounding rivals.', ['radar', 'proximity'], ['radarCars', 'relatives'], { w: RADAR_W, h: RADAR_H }, (props) => <Radar {...props} />)
]
