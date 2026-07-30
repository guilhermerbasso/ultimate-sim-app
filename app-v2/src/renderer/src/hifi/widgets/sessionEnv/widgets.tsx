import { type ReactElement, type ReactNode } from 'react'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { BigNum, C, CleanTile, FONT_BIG, FONT_LABEL, FONT_NUM, GaugeArc, LEGIBLE, fixed, legibleStroke, num } from '../kit'
import { formatMeasurement } from '../../../../../shared/units'

const TILE_W = 264
const TILE_H = 336
const WIDE_W = 312
const MAP_W = 280
const CYAN = '#25d8ff'
const AMBER = '#ffb000'
const GREEN = '#43e53a'
const WHITE = '#f2f4f7'
const YELLOW = '#ffd12a'
const BLUE = '#2e8cff'
const RED = '#ff3b30'
const GREY = '#9aa3ad'

interface TileProps {
  label: string
  width?: number
  height?: number
  accent?: string
  children: ReactNode
}

interface FlagState {
  name: string
  color: string
  text: string
}

function present(value: number | undefined): boolean {
  return value != null
}

function clamp(x: number, min: number, max: number): number {
  return Number.isFinite(x) ? Math.max(min, Math.min(max, x)) : min
}

function clamp01(x: number): number {
  return clamp(x, 0, 1)
}

function pctText(v: number | undefined): string {
  return v == null ? '—' : `${Math.round(clamp01(v) * 100)}%`
}

function safeInt(v: unknown): number | undefined {
  const n = num(v)
  return n == null ? undefined : Math.trunc(n)
}

function intText(v: unknown): string {
  const n = safeInt(v)
  return n == null ? '—' : String(Math.max(0, n))
}

function formatClock(v: unknown): string {
  const n = num(v)
  if (n == null) return '—'
  const sec = Math.max(0, Math.floor(n))
  const minutes = Math.floor(sec / 60)
  const seconds = sec % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function tileId(label: string, w: number, h: number): string {
  return `session-env-${label.replace(/\W+/g, '-').toLowerCase()}-${Math.round(w)}-${Math.round(h)}`
}

function Tile({ label, width, height, accent, children }: TileProps): ReactElement {
  const w = width ?? TILE_W
  const h = height ?? TILE_H
  const id = tileId(label, w, h)
  return (
    <CleanTile width={w} height={h}>
      <defs>
        <filter id={`${id}-glow`} x="-65%" y="-65%" width="230%" height="230%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id={`${id}-shadow`} x="-35%" y="-35%" width="170%" height="170%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#000" floodOpacity="0.75" />
        </filter>
      </defs>
      <g filter={`url(#${id}-glow)`}>{children}</g>
    </CleanTile>
  )
}

function flagState(snapshot: HifiWidgetProps['snapshot']): FlagState {
  const flags = snapshot?.flags
  if (!flags) return { name: 'none', color: C.dim, text: 'NONE' }
  if (flags.checkered || flags.greenWhiteCheckered) return { name: 'checkered', color: WHITE, text: 'CHECKER' }
  if (flags.yellow) return { name: 'yellow', color: YELLOW, text: 'YELLOW' }
  if (flags.blue) return { name: 'blue', color: BLUE, text: 'BLUE' }
  if (flags.white) return { name: 'white', color: WHITE, text: 'WHITE' }
  if (flags.red) return { name: 'red', color: RED, text: 'RED' }
  if (flags.green) return { name: 'green', color: GREEN, text: 'GREEN' }
  return { name: 'none', color: C.dim, text: 'NONE' }
}

function FlagIcon({ x, y, color, checkered }: { x: number; y: number; color: string; checkered: boolean }): ReactElement {
  const cells = Array.from({ length: 16 }, (_, i) => {
    const cx = x + 34 + (i % 4) * 22
    const cy = y + 17 + Math.floor(i / 4) * 15 + Math.sin(i) * 2
    const fill = checkered ? (i + Math.floor(i / 4)) % 2 === 0 ? WHITE : '#1d2024' : color
    return <rect key={i} x={cx} y={cy} width={22} height={16} fill={fill} opacity={checkered ? 1 : 0.9 - (i % 4) * 0.05} />
  })
  return (
    <g filter="url(#flag-shadow)">
      <path d={`M${x + 17} ${y + 15} V${y + 122}`} stroke={color} strokeWidth={9} strokeLinecap="round" />
      <path d={`M${x + 26} ${y + 27} C${x + 55} ${y + 13},${x + 83} ${y + 47},${x + 120} ${y + 29} V${y + 104} C${x + 83} ${y + 122},${x + 55} ${y + 88},${x + 26} ${y + 102} Z`} fill={checkered ? 'none' : color} opacity={checkered ? 1 : 0.9} />
      {checkered ? <clipPath id="flag-checker-clip"><path d={`M${x + 26} ${y + 27} C${x + 55} ${y + 13},${x + 83} ${y + 47},${x + 120} ${y + 29} V${y + 104} C${x + 83} ${y + 122},${x + 55} ${y + 88},${x + 26} ${y + 102} Z`} /></clipPath> : null}
      {checkered ? <g clipPath="url(#flag-checker-clip)">{cells}</g> : null}
    </g>
  )
}

function FlagWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const state = flagState(snapshot)
  const w = width ?? TILE_W
  const h = height ?? TILE_H
  return (
    <Tile label="Flag" width={width} height={height} accent={state.color}>
      <defs>
        <filter id="flag-shadow"><feDropShadow dx="0" dy="0" stdDeviation="4" floodColor={state.color} floodOpacity="0.65" /></filter>
      </defs>
      <FlagIcon x={w * 0.23} y={h * 0.3} color={state.color} checkered={state.name === 'checkered'} />
    </Tile>
  )
}

function PitLimiterWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const active = snapshot?.pitLimiter === true
  const color = active ? AMBER : C.dim
  const cells = Array.from({ length: 32 }, (_, i) => {
    const a = (i / 32) * Math.PI * 2 - Math.PI / 2
    const cx = 132 + Math.cos(a) * 78
    const cy = 178 + Math.sin(a) * 78
    return <rect key={i} x={cx - 4} y={cy - 8} width={8} height={16} rx={2} fill={active || i % 4 === 0 ? color : C.recess} opacity={active ? 1 : 0.45} transform={`rotate(${(a * 180) / Math.PI + 90} ${cx} ${cy})`} />
  })
  return (
    <Tile label="Pit Limiter" width={width} height={height} accent={color}>
      <g filter={active ? undefined : 'none'}>
        {cells}
        <circle cx={132} cy={178} r={61} fill="rgba(255,176,0,0.08)" stroke={color} strokeWidth={active ? 3 : 1.5} opacity={active ? 1 : 0.55} />
        <path d="M105 155 H159 V204 H105 Z M113 165 H151 M113 178 H151 M113 191 H151" fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </Tile>
  )
}

function WarningTriangle({ x, y, color }: { x: number; y: number; color: string }): ReactElement {
  return (
    <g transform={`translate(${x},${y})`} fill="none" stroke={color} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round">
      <path d="M31 2 L60 54 H2 Z" />
      <path d="M31 18 v19" />
      <circle cx={31} cy={45} r={2.5} fill={color} stroke="none" />
    </g>
  )
}

function IncidentsWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const count = safeInt(snapshot?.incidentCount)
  const text = count == null || count < 0 ? '—' : `${count}x`
  const color = count == null ? C.dim : count >= 8 ? RED : count >= 4 ? YELLOW : WHITE
  return (
    <Tile label="Incidents" width={width} height={height} accent={YELLOW}>
      <BigNum x={132} y={210} value={text} color={color} size={108} />
      <WarningTriangle x={101} y={238} color={count == null ? C.dim : YELLOW} />
    </Tile>
  )
}

function WeatherIcon({ x, y }: { x: number; y: number }): ReactElement {
  return (
    <g transform={`translate(${x},${y})`}>
      <circle cx={44} cy={34} r={24} fill={AMBER} />
      {Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2
        return <path key={i} d={`M${44 + Math.cos(a) * 34} ${34 + Math.sin(a) * 34} L${44 + Math.cos(a) * 48} ${34 + Math.sin(a) * 48}`} stroke={AMBER} strokeWidth={3} strokeLinecap="round" />
      })}
      <path d="M54 78 h88 a25 25 0 0 0 -20 -40 a36 36 0 0 0 -60 -4 a28 28 0 0 0 -8 44z" fill="#eceff3" stroke="#ffffff" strokeWidth={2} />
      <path d="M54 78 h88" stroke="rgba(0,0,0,0.35)" strokeWidth={4} />
    </g>
  )
}

function WeatherWidget({ snapshot, width, height, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
  const air = num(snapshot?.airTempC)
  const track = num(snapshot?.trackTempC)
  const airReading = formatMeasurement(air, 'temperature-c', unitSystem, { decimals: 0, includeUnit: true })
  const trackReading = formatMeasurement(track, 'temperature-c', unitSystem, { decimals: 0, includeUnit: true })
  return (
    <Tile label="Weather" width={width} height={height} accent={CYAN}>
      <WeatherIcon x={55} y={82} />
      <path d="M28 222 H236 M28 278 H236" stroke="rgba(255,255,255,0.16)" />
      <text x={54} y={263} fill={present(air) ? CYAN : C.dim} fontFamily={FONT_NUM} fontSize={38} fontWeight={800} {...legibleStroke(38)}>{airReading.display}</text>
      <path d="M37 237 v30" stroke={CYAN} strokeWidth={4} strokeLinecap="round" opacity={present(air) ? 1 : 0.45} />
      <circle cx={37} cy={273} r={9} fill="none" stroke={CYAN} strokeWidth={4} opacity={present(air) ? 1 : 0.45} />
      <text x={54} y={315} fill={present(track) ? CYAN : C.dim} fontFamily={FONT_NUM} fontSize={38} fontWeight={800} {...legibleStroke(38)}>{trackReading.display}</text>
      <path d="M29 307 h22 m-18 -10 h14 m-10 -10 h6" stroke={CYAN} strokeWidth={4} strokeLinecap="round" opacity={present(track) ? 1 : 0.45} />
    </Tile>
  )
}

function RainCloud({ x, y }: { x: number; y: number }): ReactElement {
  return (
    <g transform={`translate(${x},${y})`}>
      <path d="M20 59 h128 a27 27 0 0 0 -24 -40 a31 31 0 0 0 -53 -7 a24 24 0 0 0 -34 21 a25 25 0 0 0 -17 26z" fill="#b9bdc2" stroke="#f5f7fa" strokeWidth={2} />
      {Array.from({ length: 8 }, (_, i) => <path key={i} d={`M${42 + (i % 4) * 25} ${82 + Math.floor(i / 4) * 24} c-7 12 -4 18 4 17 c8 -4 8 -11 -4 -17z`} fill={CYAN} />)}
    </g>
  )
}

function WetnessWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const wetness = num(snapshot?.trackWetnessPct)
  const f = wetness == null ? 0 : clamp01(wetness)
  const cells = Array.from({ length: 16 }, (_, i) => <rect key={i} x={28 + i * 13} y={296} width={10} height={20} rx={2} fill={i / 16 < f ? CYAN : C.recess} opacity={i / 16 < f ? 1 : 0.65} />)
  return (
    <Tile label="Wetness" width={width} height={height} accent={CYAN}>
      <RainCloud x={49} y={91} />
      <text x={132} y={265} textAnchor="middle" fill={wetness == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontSize={50} fontWeight={900} {...legibleStroke(50)}>{pctText(wetness)}</text>
      {cells}
    </Tile>
  )
}

function GripWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const grip = num(snapshot?.gripPct)
  const f = grip == null ? 0 : clamp01(grip)
  return (
    <Tile label="Grip" width={width} height={height} accent={CYAN}>
      <GaugeArc cx={132} cy={132} r={82} thickness={13} f={f} color={grip == null ? C.dim : CYAN} />
      <text x={132} y={278} textAnchor="middle" fill={grip == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontSize={50} fontWeight={900} {...legibleStroke(50)}>{pctText(grip)}</text>
      <text x={42} y={320} fill={WHITE} fontFamily={FONT_LABEL} fontSize={18} fontWeight={700} {...LEGIBLE}>0%</text>
      <text x={222} y={320} textAnchor="end" fill={WHITE} fontFamily={FONT_LABEL} fontSize={18} fontWeight={700} {...LEGIBLE}>100%</text>
    </Tile>
  )
}

const trackPoints: Array<[number, number]> = [
  [69, 74], [105, 78], [128, 104], [123, 139], [143, 162], [177, 171], [195, 195], [226, 205], [241, 250], [226, 286], [202, 290], [188, 315], [168, 305], [148, 278], [128, 288], [122, 318], [100, 307], [78, 286], [65, 246], [47, 226], [59, 190], [54, 150], [38, 132], [34, 90], [48, 76]
]

function interpolate(points: Array<[number, number]>, progress: number): [number, number] {
  const p = clamp01(progress)
  const closed = [...points, points[0]]
  const lengths = closed.slice(0, -1).map((point, i) => Math.hypot(closed[i + 1][0] - point[0], closed[i + 1][1] - point[1]))
  const total = lengths.reduce((sum, length) => sum + length, 0)
  let target = p * total
  for (let i = 0; i < lengths.length; i++) {
    if (target <= lengths[i]) {
      const t = lengths[i] === 0 ? 0 : target / lengths[i]
      return [closed[i][0] + (closed[i + 1][0] - closed[i][0]) * t, closed[i][1] + (closed[i + 1][1] - closed[i][1]) * t]
    }
    target -= lengths[i]
  }
  return points[0]
}

function trackPath(points: Array<[number, number]>): string {
  return `M${points.map((point) => point.join(' ')).join(' L')} Z`
}

function TrackMap2DWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const progress = num(snapshot?.lapDistPct)
  const [x, y] = interpolate(trackPoints, progress ?? 0)
  return (
    <Tile label="Track Map" width={width ?? MAP_W} height={height} accent={CYAN}>
      <g opacity="0.34" stroke="rgba(255,255,255,0.08)" strokeWidth={0.8}>
        {Array.from({ length: 13 }, (_, i) => <path key={`v${i}`} d={`M${30 + i * 18} 56 V318`} />)}
        {Array.from({ length: 14 }, (_, i) => <path key={`h${i}`} d={`M30 ${56 + i * 20} H250`} />)}
      </g>
      <path d={trackPath(trackPoints)} fill="none" stroke="rgba(0,0,0,0.75)" strokeWidth={12} strokeLinejoin="round" strokeLinecap="round" />
      <path d={trackPath(trackPoints)} fill="none" stroke={WHITE} strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x} cy={y} r={10} fill={CYAN} stroke="#bdf5ff" strokeWidth={2} />
    </Tile>
  )
}

function TrackMap3DWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const progress = num(snapshot?.lapDistPct)
  const iso = trackPoints.map(([x, y]) => [x + (y - 190) * 0.28, 58 + y * 0.75] as [number, number])
  const [x, y] = interpolate(iso, progress ?? 0)
  return (
    <Tile label="Track Map 3D" width={width ?? MAP_W} height={height} accent={CYAN}>
      <g transform="translate(0 4)">
        <path d={trackPath(iso.map(([px, py]) => [px, py + 16]))} fill="none" stroke="rgba(37,216,255,0.22)" strokeWidth={14} strokeLinejoin="round" strokeLinecap="round" />
        <path d={trackPath(iso)} fill="none" stroke="rgba(0,0,0,0.85)" strokeWidth={16} strokeLinejoin="round" strokeLinecap="round" />
        <path d={trackPath(iso)} fill="none" stroke="#e8edf2" strokeWidth={6} strokeLinejoin="round" strokeLinecap="round" />
        <path d={trackPath(iso)} fill="none" stroke={CYAN} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" opacity="0.75" />
        <circle cx={x} cy={y} r={9} fill={CYAN} stroke="#bdf5ff" strokeWidth={2} />
        <path d={`M${x} ${y + 9} l10 14 h-20 z`} fill="rgba(37,216,255,0.28)" />
      </g>
    </Tile>
  )
}

function GForceWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const lat = num(snapshot?.latAccelG)
  const lon = num(snapshot?.longAccelG)
  const cx = 132
  const cy = 184
  const r = 82
  const limit = 1.5
  const dotX = cx + clamp(lat ?? 0, -limit, limit) / limit * r
  const dotY = cy - clamp(lon ?? 0, -limit, limit) / limit * r
  const has = lat != null && lon != null
  return (
    <Tile label="G-Force" width={width} height={height} accent={CYAN}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.32)" strokeWidth={1.5} />
      {[0.33, 0.66].map((f) => <circle key={f} cx={cx} cy={cy} r={r * f} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={1} strokeDasharray="4 4" />)}
      <path d={`M${cx - r} ${cy} H${cx + r} M${cx} ${cy - r} V${cy + r}`} stroke="rgba(255,255,255,0.28)" />
      <text x={cx} y={cy - r - 9} textAnchor="middle" fill={WHITE} fontFamily={FONT_NUM} fontSize={16} {...LEGIBLE}>1.5G</text>
      <text x={cx - r - 5} y={cy + 4} textAnchor="end" fill={WHITE} fontFamily={FONT_NUM} fontSize={15} {...LEGIBLE}>-1.5G</text>
      <text x={cx + r + 5} y={cy + 4} fill={WHITE} fontFamily={FONT_NUM} fontSize={15} {...LEGIBLE}>1.5G</text>
      <text x={cx} y={cy + r + 18} textAnchor="middle" fill={WHITE} fontFamily={FONT_NUM} fontSize={16} {...LEGIBLE}>-1.5G</text>
      <circle cx={dotX} cy={dotY} r={has ? 9 : 0} fill={CYAN} stroke="#a7f2ff" strokeWidth={2} />
    </Tile>
  )
}

function SessionWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const type = snapshot?.sessionType ? String(snapshot.sessionType).toUpperCase() : '—'
  const lap = intText(snapshot?.currentLap)
  const current = safeInt(snapshot?.currentLap)
  const lapsRemaining = safeInt(snapshot?.lapsRemaining)
  const total = current != null && lapsRemaining != null && current >= 0 && lapsRemaining >= 0 ? String(current + lapsRemaining) : '—'
  return (
    <Tile label="Session" width={width} height={height} accent={CYAN}>
      <text x={132} y={180} textAnchor="middle" fill={type === '—' ? C.dim : CYAN} fontFamily={FONT_BIG} fontSize={54} fontWeight={900} {...legibleStroke(54)}>{type}</text>
      <path d="M28 232 H236" stroke="rgba(255,255,255,0.16)" />
      <path d="M42 260 h48 m-48 22 h36 m-36 -44 v62" stroke={WHITE} strokeWidth={5} strokeLinecap="round" opacity="0.82" />
      <text x={230} y={285} textAnchor="end" fill={WHITE} fontFamily={FONT_NUM} fontSize={32} fontWeight={800} {...legibleStroke(32)}>{lap} / {total}</text>
    </Tile>
  )
}

function ClockWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const time = formatClock(snapshot?.sessionTimeRemainingSec)
  return (
    <Tile label="Clock" width={width} height={height} accent={WHITE}>
      <circle cx={132} cy={182} r={68} fill="none" stroke={GREY} strokeWidth={5} opacity="0.72" />
      <path d="M132 182 v-39 M132 182 h34" stroke={GREY} strokeWidth={6} strokeLinecap="round" opacity="0.82" />
      <text x={132} y={286} textAnchor="middle" fill={time === '—' ? C.dim : WHITE} fontFamily={FONT_BIG} fontSize={50} fontWeight={900} {...legibleStroke(50)}>{time}</text>
    </Tile>
  )
}

export const SESSION_ENV_WIDGETS: HifiWidgetModule[] = [
  {
    id: 'flag',
    title: 'Flag',
    description: 'Current race-control flag status.',
    category: 'sessionEnv',
    tags: ['flags', 'icon'],
    requires: ['flags'],
    defaultSize: { w: TILE_W, h: TILE_H },
    render: (props) => <FlagWidget {...props} />
  },
  {
    id: 'pitLimiter',
    title: 'Pit Limiter',
    description: 'Pit-limiter active indicator ring.',
    category: 'sessionEnv',
    tags: ['pit', 'icon'],
    requires: ['pitLimiter'],
    defaultSize: { w: TILE_W, h: TILE_H },
    render: (props) => <PitLimiterWidget {...props} />
  },
  {
    id: 'incidents',
    title: 'Incidents',
    description: 'Driver incident count with warning icon.',
    category: 'sessionEnv',
    tags: ['incidents', 'bignum'],
    requires: ['incidentCount'],
    defaultSize: { w: TILE_W, h: TILE_H },
    render: (props) => <IncidentsWidget {...props} />
  },
  {
    id: 'weather',
    title: 'Weather',
    description: 'Air and track temperature summary.',
    category: 'sessionEnv',
    tags: ['weather'],
    requires: ['airTempC', 'trackTempC'],
    defaultSize: { w: TILE_W, h: TILE_H },
    render: (props) => <WeatherWidget {...props} />
  },
  {
    id: 'wetness',
    title: 'Wetness',
    description: 'Track wetness percentage and rain bar.',
    category: 'sessionEnv',
    tags: ['wetness', 'bar'],
    requires: ['trackWetnessPct'],
    defaultSize: { w: TILE_W, h: TILE_H },
    render: (props) => <WetnessWidget {...props} />
  },
  {
    id: 'grip',
    title: 'Grip',
    description: 'Estimated track grip percentage.',
    category: 'sessionEnv',
    tags: ['grip', 'gauge'],
    requires: ['gripPct'],
    defaultSize: { w: TILE_W, h: TILE_H },
    render: (props) => <GripWidget {...props} />
  },
  {
    id: 'trackMap2D',
    title: 'Track Map 2D',
    description: 'Stylized circuit outline with car position.',
    category: 'sessionEnv',
    tags: ['track-map', 'map'],
    requires: ['lapDistPct'],
    defaultSize: { w: MAP_W, h: TILE_H },
    render: (props) => <TrackMap2DWidget {...props} />
  },
  {
    id: 'trackMap3D',
    title: 'Track Map 3D',
    description: 'SSR-safe isometric SVG circuit map.',
    category: 'sessionEnv',
    tags: ['track-map', 'map', '3d'],
    requires: ['lapDistPct'],
    defaultSize: { w: MAP_W, h: TILE_H },
    render: (props) => <TrackMap3DWidget {...props} />
  },
  {
    id: 'gForce',
    title: 'G-Force',
    description: 'Lateral and longitudinal G plot.',
    category: 'sessionEnv',
    tags: ['g-force', 'plot'],
    requires: ['latAccelG', 'longAccelG'],
    defaultSize: { w: TILE_W, h: TILE_H },
    render: (props) => <GForceWidget {...props} />
  },
  {
    id: 'session',
    title: 'Session',
    description: 'Session type and lap progress.',
    category: 'sessionEnv',
    tags: ['session'],
    requires: ['sessionType', 'currentLap', 'lapsRemaining'],
    defaultSize: { w: TILE_W, h: TILE_H },
    render: (props) => <SessionWidget {...props} />
  },
  {
    id: 'clock',
    title: 'Clock',
    description: 'Session time remaining countdown.',
    category: 'sessionEnv',
    tags: ['clock', 'session'],
    requires: ['sessionTimeRemainingSec'],
    defaultSize: { w: WIDE_W, h: TILE_H },
    render: (props) => <ClockWidget {...props} />
  }
]
