import { type ReactElement } from 'react'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { C, CleanTile, FONT_BIG, FONT_LABEL, FONT_NUM, SHIFT_STROBE_BLUE, ShiftStrobe, atShiftPoint, condColor, fixed, gearLabel, lapTime, legibleStroke, num, resolveRevLightPct, signed, tempColor } from '../kit'
import { formatMeasurement, type UnitSystem } from '../../../../../shared/units'

const DASH_W = 1024
const DASH_H = 600
const BLUE = '#2387ff'
const BLUE_2 = '#54a8ff'
const WHITE = '#f8fbff'
const RED = '#ff1b22'
const DARK = '#020508'
const TAGS = ['ford', 'mustang', 'mustang-gtd', 'car', 'ir'] as const

function rpmFraction(snapshot: HifiWidgetProps['snapshot']): number {
  return resolveRevLightPct(snapshot)
}

function rpmMissing(snapshot: HifiWidgetProps['snapshot']): boolean {
  return snapshot == null || (
    num(snapshot.rpm) == null &&
    num(snapshot.shiftIndicatorPct) == null &&
    num(snapshot.revLights?.pct) == null
  )
}

function tyrePressure(snapshot: HifiWidgetProps['snapshot'], corner: 'lf' | 'rf' | 'lr' | 'rr'): number | undefined {
  return num(snapshot?.tyres?.[corner]?.pressureKpa) ?? num(snapshot?.tireColdPressuresKpa?.[corner])
}

function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
}

function arcPath(cx: number, cy: number, r: number, start: number, end: number): string {
  const s = polar(cx, cy, r, start)
  const e = polar(cx, cy, r, end)
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${Math.abs(end - start) > 180 ? 1 : 0} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`
}

function tickLine(cx: number, cy: number, r1: number, r2: number, deg: number): { x1: number; y1: number; x2: number; y2: number } {
  const a = polar(cx, cy, r1, deg)
  const b = polar(cx, cy, r2, deg)
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }
}

function GtdDefs({ id }: { id: string }): ReactElement {
  return (
    <defs>
      <filter id={`${id}-glow`} x="-70%" y="-70%" width="240%" height="240%">
        <feGaussianBlur stdDeviation="6" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <linearGradient id={`${id}-sweep`} x1="0" x2="1" y1="0" y2="0">
        <stop offset="0%" stopColor={BLUE} />
        <stop offset="56%" stopColor={BLUE_2} />
        <stop offset="76%" stopColor={WHITE} />
        <stop offset="88%" stopColor={WHITE} />
        <stop offset="100%" stopColor={RED} />
      </linearGradient>
      <radialGradient id={`${id}-halo`} cx="50%" cy="15%" r="72%">
        <stop offset="0%" stopColor="rgba(35,135,255,0.24)" />
        <stop offset="48%" stopColor="rgba(255,255,255,0.08)" />
        <stop offset="100%" stopColor="rgba(0,0,0,0)" />
      </radialGradient>
    </defs>
  )
}

function ShiftNeedle({ cx, cy, r1, r2, f, id, shift }: { cx: number; cy: number; r1: number; r2: number; f: number; id: string; shift: boolean }): ReactElement {
  const deg = 180 + 180 * Math.max(0, Math.min(1, f || 0))
  const t = tickLine(cx, cy, r1, r2, deg)
  return <line {...t} stroke={shift ? SHIFT_STROBE_BLUE : WHITE} strokeWidth={shift ? 17 : 13} strokeLinecap="round" filter={`url(#${id}-glow)`} />
}

function SweepingArcTach({
  snapshot,
  width = 520,
  height = 300,
  id = 'gtd-arc',
  labels = true,
  glow = true,
  labelInset = 72,
  centerLabelInset,
  labelFontSize,
  hideZeroLabel = false
}: {
  snapshot: HifiWidgetProps['snapshot']
  width?: number
  height?: number
  id?: string
  labels?: boolean
  glow?: boolean
  labelInset?: number
  centerLabelInset?: number
  labelFontSize?: number
  hideZeroLabel?: boolean
}): ReactElement {
  const f = rpmFraction(snapshot)
  const missing = rpmMissing(snapshot)
  const shift = !missing && atShiftPoint(f, snapshot?.revLights?.blink)
  const tachColor = (base: string): string => shift ? SHIFT_STROBE_BLUE : base
  const cx = width / 2
  const cy = height * 0.82
  const r = Math.min(width * 0.47, height * 1.35)
  const start = 180
  const end = 360
  const litEnd = shift ? end : start + (end - start) * (missing ? 0 : f)
  const major = Array.from({ length: 10 }, (_, i) => i)
  const minor = Array.from({ length: 46 }, (_, i) => i)
  return (
    <g>
      <ShiftStrobe active={shift} />
      <GtdDefs id={id} />
      {glow ? <path d={arcPath(cx, cy, r - 22, start, end)} stroke={`url(#${id}-halo)`} strokeWidth={52} fill="none" /> : null}
      {shift ? <path d={arcPath(cx, cy, r - 6, start, end)} stroke={SHIFT_STROBE_BLUE} strokeWidth={38} fill="none" strokeLinecap="butt" opacity={0.48} filter={`url(#${id}-glow)`} /> : null}
      <path d={arcPath(cx, cy, r, start, end)} stroke={shift ? SHIFT_STROBE_BLUE : 'rgba(255,255,255,0.14)'} strokeWidth={24} fill="none" strokeLinecap="butt" />
      <path d={arcPath(cx, cy, r, start, 318)} stroke={tachColor(BLUE)} strokeWidth={shift ? 11 : 8} fill="none" filter={shift ? `url(#${id}-glow)` : undefined} />
      <path d={arcPath(cx, cy, r, 318, 340)} stroke={tachColor(WHITE)} strokeWidth={shift ? 11 : 8} fill="none" filter={shift ? `url(#${id}-glow)` : undefined} />
      <path d={arcPath(cx, cy, r, 340, end)} stroke={tachColor(RED)} strokeWidth={shift ? 11 : 8} fill="none" filter={shift ? `url(#${id}-glow)` : undefined} />
      <path d={arcPath(cx, cy, r - 54, start + 8, end - 8)} stroke={tachColor(BLUE)} strokeWidth={shift ? 5 : 3} fill="none" opacity={0.95} />
      {(!missing || shift) && litEnd > start ? <path d={arcPath(cx, cy, r - 12, start, litEnd)} stroke={shift ? SHIFT_STROBE_BLUE : `url(#${id}-sweep)`} strokeWidth={shift ? 24 : 18} fill="none" strokeLinecap="butt" opacity={0.95} filter={shift ? `url(#${id}-glow)` : undefined} /> : null}
      {minor.map((i) => {
        const deg = start + (i / 45) * 180
        const red = deg > 338
        const t = tickLine(cx, cy, r - 8, r - 23, deg)
        return <line key={i} {...t} stroke={tachColor(red ? RED : deg > 305 ? WHITE : BLUE_2)} strokeWidth={shift ? 2.5 : 1.7} opacity={0.88} />
      })}
      {major.map((n) => {
        const deg = start + (n / 9) * 180
        const red = n >= 8
        const t = tickLine(cx, cy, r + 3, r - 32, deg)
        const p = polar(cx, cy, r - (n === 4 || n === 5 ? centerLabelInset ?? labelInset : labelInset), deg)
        const fs = labelFontSize ?? Math.max(20, height * 0.12)
        return (
          <g key={n}>
            <line {...t} stroke={tachColor(red ? RED : n >= 5 ? WHITE : BLUE_2)} strokeWidth={shift ? 6 : n === 0 || n === 9 ? 5 : 4} filter={shift ? `url(#${id}-glow)` : undefined} />
            {labels && !(hideZeroLabel && n === 0) ? <text x={p.x} y={p.y + 9} textAnchor="middle" fill={tachColor(red ? RED : n >= 5 ? WHITE : BLUE_2)} fontFamily={FONT_NUM} fontWeight={900} fontSize={fs} {...legibleStroke(fs)}>{n}</text> : null}
          </g>
        )
      })}
      <ShiftNeedle cx={cx} cy={cy} r1={r - 5} r2={r - 62} f={missing ? 0.76 : Math.max(0.76, f)} id={id} shift={shift} />
    </g>
  )
}

function OilIcon({ color = BLUE }: { color?: string }): ReactElement {
  return <g fill="none" stroke={color} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round"><path d="M5 28 h34 l10 -13 l-6 -5 l-11 8 H19 l-5 -8 H5 Z" /><path d="M44 24 c8 2 10 7 4 12" /><circle cx="57" cy="37" r="2.5" fill={color} stroke="none" /></g>
}

function WaterIcon({ color = BLUE }: { color?: string }): ReactElement {
  return <g fill="none" stroke={color} strokeWidth={4} strokeLinecap="round"><path d="M26 5 v31" /><path d="M18 13 h16 M18 22 h16" /><path d="M12 41 c7 -6 14 -6 21 0 c7 6 14 6 21 0" /><path d="M8 52 c8 -6 16 -6 24 0 c8 6 16 6 24 0" /></g>
}

function TempRows({ snapshot, x, y, unitSystem }: { snapshot: HifiWidgetProps['snapshot']; x: number; y: number; unitSystem: UnitSystem }): ReactElement {
  const oil = num(snapshot?.oilTempC)
  const water = num(snapshot?.waterTempC)
  const row = (dy: number, label: string, value: number | undefined, icon: ReactElement) => {
    const reading = formatMeasurement(value, 'temperature-c', unitSystem, { decimals: 0 })
    return (
      <g transform={`translate(${x},${y + dy})`}>
        <g transform="translate(0,-28)">{icon}</g>
        <text x={96} y={0} fill={BLUE_2} fontFamily={FONT_LABEL} fontWeight={900} fontSize={27} letterSpacing={1.5} {...legibleStroke(27)}>{label}</text>
        <text x={246} y={2} textAnchor="end" fill={value == null ? C.dim : WHITE} fontFamily={FONT_NUM} fontWeight={900} fontSize={36} {...legibleStroke(36)}>{reading.display}</text>
        <text x={270} y={0} fill={tempColor(value, 85, 115)} fontFamily={FONT_LABEL} fontWeight={900} fontSize={24} {...legibleStroke(24)}>{reading.unit.replace('°', '')}</text>
      </g>
    )
  }
  return <g>{row(0, 'OIL', oil, <OilIcon />)}<line x1={x} y1={y + 18} x2={x + 310} y2={y + 18} stroke={BLUE} opacity={0.85} />{row(70, 'WATER', water, <WaterIcon />)}</g>
}

function TyreGrid({ snapshot, x, y, unitSystem, compact = false }: { snapshot: HifiWidgetProps['snapshot']; x: number; y: number; unitSystem: UnitSystem; compact?: boolean }): ReactElement {
  const fs = compact ? 30 : 36
  const ls = compact ? 27 : 31
  const data: [string, string, number | undefined][] = [
    ['FL', 'lf', tyrePressure(snapshot, 'lf')],
    ['FR', 'rf', tyrePressure(snapshot, 'rf')],
    ['RL', 'lr', tyrePressure(snapshot, 'lr')],
    ['RR', 'rr', tyrePressure(snapshot, 'rr')]
  ]
  const pressureUnit = formatMeasurement(undefined, 'pressure-kpa', unitSystem).unit
  return (
    <g transform={`translate(${x},${y})`}>
      {data.map(([label, key, value], i) => {
        const col = i % 2
        const row = Math.floor(i / 2)
        const ox = col * (compact ? 142 : 155)
        const oy = row * (compact ? 58 : 70)
        return (
          <g key={key} transform={`translate(${ox},${oy})`}>
            <text x={0} y={0} fill={BLUE_2} fontFamily={FONT_LABEL} fontWeight={900} fontSize={ls} {...legibleStroke(ls)}>{label}</text>
            <text x={compact ? 74 : 88} y={2} textAnchor="middle" fill={value == null ? C.dim : WHITE} fontFamily={FONT_NUM} fontWeight={900} fontSize={fs} {...legibleStroke(fs)}>{formatMeasurement(value, 'pressure-kpa', unitSystem, { decimals: 1 }).display}</text>
            {col === 1 ? <text x={compact ? 125 : 145} y={0} fill={BLUE_2} fontFamily={FONT_LABEL} fontWeight={900} fontSize={compact ? 18 : 24} {...legibleStroke(24)}>{pressureUnit}</text> : null}
          </g>
        )
      })}
      <line x1={compact ? 124 : 138} y1={-28} x2={compact ? 124 : 138} y2={compact ? 70 : 88} stroke={BLUE} strokeWidth={1.5} opacity={0.8} />
      <line x1={-8} y1={compact ? 23 : 27} x2={compact ? 270 : 325} y2={compact ? 23 : 27} stroke={BLUE} strokeWidth={1.5} opacity={0.8} />
    </g>
  )
}

function GtdDash({ snapshot, width, height, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
  const gear = num(snapshot?.gear)
  const speed = formatMeasurement(num(snapshot?.speedKmh), 'speed-kmh', unitSystem, { decimals: 0 })
  const tachWidth = 852
  const tachHeight = 512
  const tachX = (DASH_W - tachWidth) / 2
  return (
    <CleanTile width={width ?? DASH_W} height={height ?? DASH_H}>
      <rect width={DASH_W} height={DASH_H} fill={DARK} />
      <rect x={0} y={0} width={DASH_W} height={DASH_H} fill="url(#gtd-dash-halo)" opacity={0.55} />
      <g transform={`translate(${tachX},0)`}>
        <SweepingArcTach snapshot={snapshot} width={tachWidth} height={tachHeight} id="gtd-dash" labelInset={118} centerLabelInset={82} labelFontSize={56} hideZeroLabel />
      </g>
      <text x={512} y={302} textAnchor="middle" fill={gear == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={900} fontSize={150} {...legibleStroke(150)}>{gearLabel(gear)}</text>
      <text x={512} y={403} textAnchor="middle" fill={speed.value == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={900} fontSize={72} {...legibleStroke(72)}>{speed.display}</text>
      <text x={512} y={438} textAnchor="middle" fill={WHITE} fontFamily={FONT_LABEL} fontWeight={900} fontSize={26} {...legibleStroke(26)}>{speed.unit}</text>
      <TempRows snapshot={snapshot} x={28} y={458} unitSystem={unitSystem} />
      <TyreGrid snapshot={snapshot} x={700} y={458} unitSystem={unitSystem} compact />
      <path d="M12 580 H398 l20 -22 h188 l20 22 H1012" fill="none" stroke={BLUE} strokeWidth={2.2} />
      <path d="M418 580 l20 -22 h148 l20 22 l-18 16 h-152 Z" fill="rgba(0,0,0,0.84)" stroke={BLUE} strokeWidth={2.2} />
      <text x={512} y={586} textAnchor="middle" fill={BLUE} fontFamily={FONT_BIG} fontStyle="italic" fontWeight={900} fontSize={30} {...legibleStroke(30)}>TRACK</text>
    </CleanTile>
  )
}

function ArcTachWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 520
  const h = height ?? 300
  return <CleanTile width={w} height={h}><SweepingArcTach snapshot={snapshot} width={w} height={h} id="gtd-arc-widget" /></CleanTile>
}

function GearWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 240
  const h = height ?? 220
  const gear = num(snapshot?.gear)
  return <CleanTile width={w} height={h}><text x={w / 2} y={h * 0.78} textAnchor="middle" fill={gear == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={900} fontSize={h * 0.84} {...legibleStroke(h * 0.84)}>{gearLabel(gear)}</text></CleanTile>
}

function SpeedWidget({ snapshot, width, height, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
  const w = width ?? 330
  const h = height ?? 170
  const speed = formatMeasurement(num(snapshot?.speedKmh), 'speed-kmh', unitSystem, { decimals: 0 })
  return <CleanTile width={w} height={h}><text x={w / 2} y={h * 0.6} textAnchor="middle" fill={speed.value == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={900} fontSize={h * 0.5} {...legibleStroke(h * 0.5)}>{speed.display}</text><text x={w / 2} y={h * 0.83} textAnchor="middle" fill={BLUE_2} fontFamily={FONT_LABEL} fontWeight={900} fontSize={h * 0.17} {...legibleStroke(h * 0.17)}>{speed.unit}</text></CleanTile>
}

function SingleMetric({ width = 280, height = 145, label, value, unit, color = WHITE }: { width?: number; height?: number; label: string; value: string; unit?: string; color?: string }): ReactElement {
  return (
    <CleanTile width={width} height={height}>
      <text x={width / 2} y={height * 0.3} textAnchor="middle" fill={BLUE_2} fontFamily={FONT_LABEL} fontWeight={900} fontSize={height * 0.22} letterSpacing={2} {...legibleStroke(height * 0.22)}>{label}</text>
      <text x={width / 2} y={height * 0.76} textAnchor="middle" fill={value === '—' ? C.dim : color} fontFamily={FONT_BIG} fontWeight={900} fontSize={height * 0.42} {...legibleStroke(height * 0.42)}>{value}{unit ? <tspan fill={BLUE_2} fontFamily={FONT_LABEL} fontSize={height * 0.22}> {unit}</tspan> : null}</text>
    </CleanTile>
  )
}

function OilWidget({ snapshot, width, height, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
  const v = num(snapshot?.oilTempC)
  const reading = formatMeasurement(v, 'temperature-c', unitSystem, { decimals: 0 })
  return <SingleMetric width={width ?? 260} height={height ?? 145} label="OIL" value={reading.display} unit={reading.unit} color={tempColor(v, 85, 115)} />
}

function WaterWidget({ snapshot, width, height, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
  const v = num(snapshot?.waterTempC)
  const reading = formatMeasurement(v, 'temperature-c', unitSystem, { decimals: 0 })
  return <SingleMetric width={width ?? 280} height={height ?? 145} label="WATER" value={reading.display} unit={reading.unit} color={tempColor(v, 80, 105)} />
}

function TyrePressWidget({ snapshot, width, height, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
  const w = width ?? 360
  const h = height ?? 190
  return <CleanTile width={w} height={h}><TyreGrid snapshot={snapshot} x={34} y={68} unitSystem={unitSystem} compact /></CleanTile>
}

function DeltaWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const delta = num(snapshot?.deltaToBestSec)
  return <SingleMetric width={width ?? 280} height={height ?? 140} label="DELTA" value={signed(delta, 2)} color={condColor(delta, { positiveIsGood: false, deadzone: 0.01, good: '#22e06a', bad: RED, neutral: WHITE })} />
}

function LastLapWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  return <SingleMetric width={width ?? 390} height={height ?? 140} label="LAST LAP" value={lapTime(num(snapshot?.lastLapTimeSec))} />
}

function PositionWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  return <SingleMetric width={width ?? 240} height={height ?? 140} label="POS" value={fixed(num(snapshot?.position))} />
}

function FuelWidget({ snapshot, width, height, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
  const reading = formatMeasurement(num(snapshot?.fuelLiters), 'fuel-volume-l', unitSystem, { decimals: 1 })
  return <SingleMetric width={width ?? 250} height={height ?? 140} label="FUEL" value={reading.display} unit={reading.unit} />
}

const dashRequires: HifiWidgetModule['requires'] = ['rpm', 'maxRpm', 'shiftIndicatorPct', 'gear', 'speedKmh', 'oilTempC', 'waterTempC', 'tyres', 'tireColdPressuresKpa']

export const gtdDash: HifiWidgetModule = { id: 'gtdDash', title: 'Ford Mustang GTD Track dash', description: 'Full Mustang GTD Track-style cluster with sweeping arc tachometer, central gear and global-unit speed, oil/water, tire pressures and TRACK mode tag.', category: 'cars', tags: [...TAGS, 'dashboard', 'cluster', 'track', 'sweeping-arc', 'tach', 'gear', 'speed', 'oil', 'water', 'tyre-pressure'], requires: dashRequires, defaultSize: { w: 1024, h: 600 }, render: (props) => <GtdDash {...props} /> }
export const gtdArcTach: HifiWidgetModule = { id: 'gtdArcTach', title: 'Ford Mustang GTD arc tach', description: 'Clean Mustang GTD sweeping blue-white-red arc tachometer.', category: 'cars', tags: [...TAGS, 'rpm', 'tach', 'sweeping-arc', 'clean'], requires: ['rpm', 'maxRpm', 'shiftIndicatorPct'], defaultSize: { w: 520, h: 300 }, render: (props) => <ArcTachWidget {...props} /> }
export const gtdGear: HifiWidgetModule = { id: 'gtdGear', title: 'Ford Mustang GTD gear', description: 'Clean Mustang GTD central gear digit.', category: 'cars', tags: [...TAGS, 'gear', 'clean'], requires: ['gear'], defaultSize: { w: 240, h: 220 }, render: (props) => <GearWidget {...props} /> }
export const gtdSpeed: HifiWidgetModule = { id: 'gtdSpeed', title: 'Ford Mustang GTD speed', description: 'Clean Mustang GTD speed readout using the global unit system.', category: 'cars', tags: [...TAGS, 'speed', 'clean'], requires: ['speedKmh'], defaultSize: { w: 330, h: 170 }, render: (props) => <SpeedWidget {...props} /> }
export const gtdOil: HifiWidgetModule = { id: 'gtdOil', title: 'Ford Mustang GTD oil temp', description: 'Clean Mustang GTD oil temperature readout.', category: 'cars', tags: [...TAGS, 'oil', 'temperature', 'clean'], requires: ['oilTempC'], defaultSize: { w: 260, h: 145 }, render: (props) => <OilWidget {...props} /> }
export const gtdWater: HifiWidgetModule = { id: 'gtdWater', title: 'Ford Mustang GTD water temp', description: 'Clean Mustang GTD water temperature readout.', category: 'cars', tags: [...TAGS, 'water', 'temperature', 'clean'], requires: ['waterTempC'], defaultSize: { w: 280, h: 145 }, render: (props) => <WaterWidget {...props} /> }
export const gtdTyrePress: HifiWidgetModule = { id: 'gtdTyrePress', title: 'Ford Mustang GTD tire pressures', description: 'Clean Mustang GTD four-corner tire pressure grid using the global unit system.', category: 'cars', tags: [...TAGS, 'tyre-pressure', 'tire-pressure', 'clean'], requires: ['tyres', 'tireColdPressuresKpa'], defaultSize: { w: 360, h: 190 }, render: (props) => <TyrePressWidget {...props} /> }
export const gtdDelta: HifiWidgetModule = { id: 'gtdDelta', title: 'Ford Mustang GTD delta', description: 'Clean Mustang GTD delta-to-best readout colored by gain or loss.', category: 'cars', tags: [...TAGS, 'delta', 'delta-to-best', 'clean'], requires: ['deltaToBestSec'], defaultSize: { w: 280, h: 140 }, render: (props) => <DeltaWidget {...props} /> }
export const gtdLastLap: HifiWidgetModule = { id: 'gtdLastLap', title: 'Ford Mustang GTD last lap', description: 'Clean Mustang GTD last-lap time readout.', category: 'cars', tags: [...TAGS, 'last-lap', 'lap-time', 'clean'], requires: ['lastLapTimeSec'], defaultSize: { w: 390, h: 140 }, render: (props) => <LastLapWidget {...props} /> }
export const gtdPosition: HifiWidgetModule = { id: 'gtdPosition', title: 'Ford Mustang GTD position', description: 'Clean Mustang GTD race position readout.', category: 'cars', tags: [...TAGS, 'position', 'clean'], requires: ['position'], defaultSize: { w: 240, h: 140 }, render: (props) => <PositionWidget {...props} /> }
export const gtdFuel: HifiWidgetModule = { id: 'gtdFuel', title: 'Ford Mustang GTD fuel', description: 'Clean Mustang GTD fuel liters readout.', category: 'cars', tags: [...TAGS, 'fuel', 'clean'], requires: ['fuelLiters'], defaultSize: { w: 250, h: 140 }, render: (props) => <FuelWidget {...props} /> }

export const MUSTANGGTD_WIDGETS: HifiWidgetModule[] = [
  gtdDash,
  gtdArcTach,
  gtdGear,
  gtdSpeed,
  gtdOil,
  gtdWater,
  gtdTyrePress,
  gtdDelta,
  gtdLastLap,
  gtdPosition,
  gtdFuel
]
