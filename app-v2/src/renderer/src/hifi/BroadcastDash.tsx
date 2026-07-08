// ── BroadcastDash ─────────────────────────────────────────────────────────────
// TV-broadcast standings overlay: pure SVG on a 1024x600 viewBox, SSR-safe and
// NaN-safe. Missing live data renders as em-dashes; no driver names are invented.
import { type ReactElement, type ReactNode } from 'react'
import type { DriverEntry, TelemetrySnapshot } from '../../../shared/telemetry'

const W = 1024
const H = 600
const ROWS = 8

const COL = {
  bg: '#07090a',
  panel: '#101415',
  panel2: '#171c1e',
  line: 'rgba(205,220,224,0.28)',
  lineStrong: 'rgba(235,245,248,0.38)',
  text: '#eff0ee',
  dim: '#a8aba9',
  muted: '#6d7472',
  cyan: '#14c7df',
  orange: '#f4a51c',
  green: '#62bd54',
  red: '#f05b4f',
  purple: '#7f2db4',
  purpleHi: '#b875ea',
  yellow: '#e5cd26'
}

function n(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const p = Number.parseFloat(v)
    return Number.isFinite(p) ? p : undefined
  }
  return undefined
}

function safeInt(v: unknown): number | undefined {
  const value = n(v)
  return value != null && value > 0 ? Math.trunc(value) : undefined
}

function lapTime(sec: number | undefined): string {
  if (sec == null || sec <= 0) return '—'
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s.toFixed(3).padStart(6, '0')}`
}

function gapText(sec: number | undefined, signed = true): string {
  if (sec == null) return '—'
  if (Math.abs(sec) < 0.001) return '—'
  const sign = signed && sec > 0 ? '+' : ''
  return `${sign}${sec.toFixed(3)}`
}

function color(v: string | undefined, fallback: string): string {
  return v && /^#[0-9a-f]{3,8}$/i.test(v) ? v : fallback
}

function shortName(name: string | undefined): string {
  const clean = (name ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) return '—'
  const parts = clean.split(' ')
  if (parts.length === 1) return parts[0].toUpperCase()
  return `${parts[0][0]}. ${parts[parts.length - 1]}`.toUpperCase()
}

function clsLabel(d: DriverEntry | undefined): string {
  return (d?.className ?? '').trim().toUpperCase().slice(0, 6) || '—'
}

function skewPath(x: number, y: number, w: number, h: number, slant = 10): string {
  return `M${x + slant} ${y}H${x + w}L${x + w - slant} ${y + h}H${x}Z`
}

function Label({ x, y, children, anchor = 'start', size = 16, fill = COL.text }: { x: number; y: number; children: ReactNode; anchor?: 'start' | 'middle' | 'end'; size?: number; fill?: string }): ReactElement {
  return (
    <text x={x} y={y} textAnchor={anchor} fill={fill} fontFamily="'Rajdhani','Barlow Condensed',Arial,sans-serif" fontSize={size} fontWeight={800} fontStyle="italic" letterSpacing={0.8}>
      {children}
    </text>
  )
}

function Mono({ x, y, children, anchor = 'start', size = 22, fill = COL.text }: { x: number; y: number; children: ReactNode; anchor?: 'start' | 'middle' | 'end'; size?: number; fill?: string }): ReactElement {
  return (
    <text x={x} y={y} textAnchor={anchor} fill={fill} fontFamily="'Chakra Petch','Rajdhani',monospace" fontSize={size} fontWeight={800} letterSpacing={1}>
      {children}
    </text>
  )
}

function TimingBug({ s }: { s: TelemetrySnapshot }): ReactElement {
  const lap = safeInt(s.currentLap)
  const total = safeInt(s.lapsRemaining) != null && lap != null ? lap + safeInt(s.lapsRemaining)! : undefined
  const delta = n(s.deltaToBestSec)
  const deltaColor = delta == null ? COL.dim : delta <= 0 ? COL.green : COL.red
  return (
    <g>
      <path d={skewPath(28, 28, 220, 138, 10)} fill={COL.panel} stroke={COL.lineStrong} />
      <rect x={32} y={28} width={7} height={32} fill={COL.cyan} />
      <path d="M110 28H248L242 60H104Z" fill="#15191b" stroke={COL.line} />
      <Label x={50} y={53} size={23}>LAP</Label>
      <Mono x={216} y={53} anchor="end" size={23}>{lap != null ? `${lap} / ${total ?? '—'}` : '—'}</Mono>
      {[
        ['CURRENT LAP', lapTime(n(s.currentLapTimeSec)), COL.text],
        ['LAST LAP', lapTime(n(s.lastLapTimeSec)), COL.text],
        ['DELTA', delta == null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(3)}`, deltaColor]
      ].map((row, i) => {
        const y = 60 + i * 35
        return (
          <g key={row[0]}>
            <path d={`M28 ${y}H248L246 ${y + 35}H28Z`} fill={i % 2 ? '#111617' : '#0d1112'} stroke={COL.line} />
            <path d={`M136 ${y}H248L246 ${y + 35}H130Z`} fill="#14191b" stroke={COL.line} />
            <Label x={40} y={y + 24} size={14}>{row[0]}</Label>
            <Mono x={236} y={y + 25} anchor="end" size={i === 0 ? 19 : 21} fill={row[2]}>{row[1]}</Mono>
          </g>
        )
      })}
    </g>
  )
}

function LeaderChip({ drivers }: { drivers: DriverEntry[] }): ReactElement {
  const leader = drivers[0]
  const leaderName = shortName(leader?.name)
  return (
    <g>
      <path d={skewPath(696, 28, 310, 46, 8)} fill={COL.panel} stroke={COL.lineStrong} />
      <rect x={696} y={28} width={6} height={46} fill={COL.orange} />
      <path d="M756 28H900L894 74H756Z" fill={COL.panel2} stroke={COL.line} />
      <path d="M900 28H1006L998 74H894Z" fill="#161b1d" stroke={COL.line} />
      <Label x={714} y={61} size={28}>P{safeInt(leader?.position) ?? '—'}</Label>
      <Label x={768} y={59} size={18}>{leaderName}</Label>
      <Label x={952} y={46} anchor="middle" size={10} fill={COL.dim}>GAP TO LEADER</Label>
      <Mono x={952} y={64} anchor="middle" size={15}>—</Mono>
    </g>
  )
}

function FastestBanner({ drivers }: { drivers: DriverEntry[] }): ReactElement {
  const fastest = drivers.reduce<DriverEntry | undefined>((best, d) => {
    const lap = n(d.lastLapTimeSec)
    if (lap == null || lap <= 0) return best
    const bestLap = n(best?.lastLapTimeSec)
    return bestLap == null || lap < bestLap ? d : best
  }, undefined)
  return (
    <g>
      <path d={skewPath(264, 396, 496, 43, 12)} fill="#120d18" stroke={COL.purpleHi} strokeWidth={1.5} />
      <path d={skewPath(264, 396, 60, 43, 12)} fill={COL.purple} stroke={COL.purpleHi} />
      <circle cx={294} cy={417} r={12} fill="none" stroke={COL.text} strokeWidth={2} />
      <path d="M294 417V409M294 417L300 421M288 402H300M283 407L279 403M305 407L309 403" stroke={COL.text} strokeWidth={2} strokeLinecap="round" />
      <Label x={332} y={424} size={17} fill={COL.purpleHi}>FASTEST LAP</Label>
      <path d={skewPath(456, 400, 50, 35, 6)} fill={COL.purple} />
      <Mono x={481} y={425} anchor="middle" size={24}>{fastest?.carNumber ?? '—'}</Mono>
      <Label x={528} y={424} size={21}>{shortName(fastest?.name)}</Label>
      <Mono x={746} y={425} anchor="end" size={22} fill={COL.purpleHi}>{lapTime(n(fastest?.lastLapTimeSec))}</Mono>
      <line x1={444} y1={403} x2={438} y2={432} stroke={COL.line} />
      <line x1={642} y1={403} x2={636} y2={432} stroke={COL.line} />
    </g>
  )
}

function StandingsStrip({ drivers }: { drivers: DriverEntry[] }): ReactElement {
  const rows = Array.from({ length: ROWS }, (_, i) => drivers[i])
  const leaderGap = n(drivers[0]?.gapToPlayerSec) ?? 0
  return (
    <g>
      <path d="M26 445H1000V590H16Z" fill="#111616" stroke={COL.lineStrong} />
      <path d="M28 445H1000V466H24Z" fill="rgba(255,255,255,0.035)" />
      {rows.map((d, i) => {
        const y = 445 + i * 18
        const rowFill = i % 2 ? '#111617' : '#0e1314'
        const classFill = color(d?.classColor, i < 3 ? [COL.purple, '#ca3a2d', '#2770ba'][i] : [COL.yellow, '#4caa42', '#2b99c0', '#f06a20', '#808487'][i - 3] ?? COL.muted)
        const gap = d && i > 0 && n(d.gapToPlayerSec) != null ? leaderGap - n(d.gapToPlayerSec)! : undefined
        const chipText = clsLabel(d)
        const chipTextColor = classFill === COL.yellow ? '#131718' : COL.text
        return (
          <g key={d?.carIdx ?? `empty-${i}`}>
            <path d={`M${26 - i * 1.4} ${y}H1000V${y + 18}H${24 - i * 1.4}Z`} fill={rowFill} stroke={COL.line} strokeWidth={0.8} />
            <Label x={48} y={y + 13.5} size={17}>P{safeInt(d?.position) ?? '—'}</Label>
            <path d={skewPath(100, y + 1, 64, 16, 4)} fill={d ? classFill : '#2b3032'} stroke="rgba(0,0,0,0.25)" />
            <Mono x={132} y={y + 14} anchor="middle" size={16}>{d?.carNumber ?? '—'}</Mono>
            <Label x={190} y={y + 13.5} size={17}>{shortName(d?.name)}</Label>
            <path d={skewPath(638, y + 3, 64, 13, 2)} fill={d ? classFill : '#2b3032'} opacity={d ? 0.95 : 0.65} />
            <Label x={670} y={y + 13} anchor="middle" size={12} fill={chipTextColor}>{chipText}</Label>
            <Mono x={895} y={y + 14} anchor="middle" size={16}>{gapText(gap)}</Mono>
          </g>
        )
      })}
      <line x1={174} y1={445} x2={166} y2={590} stroke={COL.line} />
      <line x1={742} y1={445} x2={720} y2={590} stroke={COL.line} />
    </g>
  )
}

export interface BroadcastDashProps {
  snapshot: TelemetrySnapshot
  width?: number
  height?: number
}

export function BroadcastDash({ snapshot, width, height }: BroadcastDashProps): ReactElement {
  const drivers = [...(snapshot.drivers ?? [])]
    .filter((d) => d && safeInt(d.position) != null)
    .sort((a, b) => (safeInt(a.position) ?? 999) - (safeInt(b.position) ?? 999))
    .slice(0, ROWS)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={width ?? W} height={height ?? H} preserveAspectRatio="xMidYMid meet" role="img" aria-label="TV broadcast standings overlay">
      <defs>
        <pattern id="broadcast-grid" width={20} height={20} patternUnits="userSpaceOnUse">
          <rect width={20} height={20} fill={COL.bg} />
          <rect width={10} height={10} fill="#0d1011" />
          <rect x={10} y={10} width={10} height={10} fill="#0d1011" />
        </pattern>
        <linearGradient id="broadcast-vignette" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity={0.1} />
          <stop offset="0.55" stopColor="#000" stopOpacity={0.38} />
          <stop offset="1" stopColor="#000" stopOpacity={0.12} />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={W} height={H} fill="url(#broadcast-grid)" />
      <rect x={0} y={0} width={W} height={H} fill="url(#broadcast-vignette)" />
      <TimingBug s={snapshot} />
      <LeaderChip drivers={drivers} />
      <FastestBanner drivers={drivers} />
      <StandingsStrip drivers={drivers} />
    </svg>
  )
}
