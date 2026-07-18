import { type ReactElement } from 'react'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { C, CleanTile, FONT_BIG, FONT_LABEL, FONT_NUM, ShiftStrobe, atShiftPoint, condColor, fixed, gearLabel, lapTime, legibleStroke, num, resolveRevLightPct, resolveRpmGaugePct, revFill, signed } from '../kit'
import { formatMeasurement } from '../../../../../shared/units'

const DASH_W = 1024
const DASH_H = 600
const RED = '#DC0000'
const YELLOW = '#FFE100'
const WHITE = '#F7F7F7'
const BLUE = '#287BFF'
const GREEN = '#52FF25'
const ORANGE = '#FF7A16'
const DARK = '#020202'
const RECESS = '#202020'
const TAGS = ['ferrari', 'ferrari-296-gt3', 'gt3', 'car', 'ir'] as const

function safeText(v: unknown): string {
  return v == null || v === '' ? '—' : String(v)
}

function shiftFrac(snapshot: HifiWidgetProps['snapshot']): { f: number; missing: boolean; flash: boolean } {
  const rpm = num(snapshot?.rpm)
  const max = num(snapshot?.maxRpm)
  const missing =
    snapshot == null ||
    (num(snapshot.shiftIndicatorPct) == null &&
      num(snapshot.revLights?.pct) == null &&
      !(rpm != null && max != null && max > 0))
  const f = resolveRevLightPct(snapshot)
  return { f, missing, flash: !missing && atShiftPoint(f, snapshot?.revLights?.blink, 0.96) }
}

function rpmFrac(snapshot: HifiWidgetProps['snapshot']): number {
  return resolveRpmGaugePct(snapshot)
}

function ledColor(i: number, count: number): string {
  const p = i / Math.max(1, count - 1)
  if (p > 0.88) return BLUE
  if (p > 0.74) return '#FF1D25'
  if (p > 0.55) return ORANGE
  if (p > 0.34) return YELLOW
  return GREEN
}

function GlowDefs({ id }: { id: string }): ReactElement {
  return (
    <defs>
      <filter id={`${id}-glow`} x="-90%" y="-90%" width="280%" height="280%">
        <feGaussianBlur stdDeviation="5" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id={`${id}-soft`} x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="1.5" />
      </filter>
      <linearGradient id={`${id}-rpm`} x1="0" x2="1" y1="0" y2="0">
        <stop offset="0%" stopColor="#2b2b2b" />
        <stop offset="39%" stopColor="#6a6a6a" />
        <stop offset="62%" stopColor="#f1f1f1" />
        <stop offset="80%" stopColor={YELLOW} />
        <stop offset="100%" stopColor="#ff1010" />
      </linearGradient>
    </defs>
  )
}

function RoundLedStrip({ snapshot, x, y, w, count = 17, id = 'f296-leds', r = 15 }: { snapshot: HifiWidgetProps['snapshot']; x: number; y: number; w: number; count?: number; id?: string; r?: number }): ReactElement {
  const { f, missing, flash } = shiftFrac(snapshot)
  const shift = atShiftPoint(f, snapshot?.revLights?.blink)
  const lit = shift ? count : missing ? 0 : Math.round(f * count)
  const gap = count === 1 ? 0 : w / (count - 1)
  return (
    <g>
      <ShiftStrobe active={shift} />
      <GlowDefs id={id} />
      {Array.from({ length: count }, (_, i) => {
        const overRev = i >= count - 2 && flash
        const on = !missing && (i < lit || overRev)
        const color = revFill(ledColor(i, count), shift)
        return (
          <g key={i}>
            <circle cx={x + i * gap} cy={y} r={r + 8} fill={on ? color : 'transparent'} opacity={on ? 0.17 : 0} filter={`url(#${id}-soft)`} />
            <circle cx={x + i * gap} cy={y} r={r} fill={on ? color : '#121212'} stroke={on ? color : 'rgba(255,255,255,0.10)'} strokeWidth={2} opacity={on ? 1 : 0.45} filter={on ? `url(#${id}-glow)` : undefined} />
            <circle cx={x + i * gap} cy={y} r={r * 0.72} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={1} strokeDasharray="1 2" />
          </g>
        )
      })}
    </g>
  )
}

function angledBoxPath(x: number, y: number, w: number, h: number): string {
  return `M${x + 18} ${y} H${x + w - 18} L${x + w} ${y + 14} V${y + h - 8} L${x + w - 12} ${y + h} H${x + 118} L${x + 112} ${y + h + 5} H${x + 12} L${x} ${y + h - 8} V${y + 14} Z`
}

function InfoBox({
  x,
  y,
  w,
  h,
  label,
  value,
  unit,
  iconSide = 'left',
  labelFontSize = 30,
  valueFontSize = 54,
  valueOffsetX = 0,
  valueBottom = 14,
  iconScale = 1,
  children
}: {
  x: number
  y: number
  w: number
  h: number
  label: string
  value: string
  unit?: string
  iconSide?: 'left' | 'right'
  labelFontSize?: number
  valueFontSize?: number
  valueOffsetX?: number
  valueBottom?: number
  iconScale?: number
  children?: ReactElement
}): ReactElement {
  return (
    <g>
      <path d={angledBoxPath(x, y, w, h)} fill="rgba(0,0,0,0.86)" stroke={RED} strokeWidth={1.8} />
      <path d={`M${x + 118} ${y + h} H${x + w - 38}`} stroke={RED} strokeWidth={2.2} />
      <text x={x + w / 2} y={y + 28} textAnchor="middle" fill={YELLOW} fontFamily={FONT_LABEL} fontWeight={900} fontSize={labelFontSize} letterSpacing={3} {...legibleStroke(labelFontSize)}>{label}</text>
      {children ? <g transform={`translate(${iconSide === 'right' ? x + w - 70 : x + 34},${y + 50}) scale(${iconScale})`}>{children}</g> : null}
      <text x={x + w / 2 - (unit ? 20 : 0) + valueOffsetX} y={y + h - valueBottom} textAnchor="middle" fill={value === '—' ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={900} fontSize={valueFontSize} {...legibleStroke(valueFontSize)}>{value}</text>
      {unit ? <text x={x + w - 52} y={y + h - valueBottom} fill={value === '—' ? C.dim : WHITE} fontFamily={FONT_LABEL} fontWeight={900} fontSize={28} {...legibleStroke(28)}>{unit}</text> : null}
    </g>
  )
}

function FuelIcon({ color = YELLOW }: { color?: string }): ReactElement {
  return <g fill="none" stroke={color} strokeWidth={5} strokeLinejoin="round" strokeLinecap="round"><path d="M0 3 h24 v42 H0 Z" fill={color} stroke={color} /><path d="M24 10 c13 5 13 14 13 24 c0 13 12 13 12 1 V23 c0 -7 -4 -11 -9 -15" /><path d="M36 7 l8 8" /></g>
}

function SlipIcon({ color = YELLOW }: { color?: string }): ReactElement {
  return <g fill="none" stroke={color} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round"><path d="M8 20 h38 l-5 -12 H15 Z" /><path d="M12 20 l-5 10 h43 l-5 -10" /><circle cx="16" cy="31" r="4" fill={color} /><circle cx="41" cy="31" r="4" fill={color} /><path d="M0 45 c8 -8 16 -8 24 0 M30 45 c8 -8 16 -8 24 0" /></g>
}

function StopwatchIcon({ color = '#ff2a35' }: { color?: string }): ReactElement {
  return <g fill="none" stroke={color} strokeWidth={4.5} strokeLinecap="round"><circle cx="28" cy="29" r="21" /><path d="M28 8 V0 M20 0 h16 M42 12 l5 -5 M28 29 V14 l11 12" /></g>
}

function AbsIcon({ color = '#ff2a35' }: { color?: string }): ReactElement {
  return <g fill="none" stroke={color} strokeWidth={4} strokeLinecap="round"><circle cx="30" cy="30" r="19" /><path d="M8 14 C0 25 0 35 8 46 M52 14 c8 11 8 21 0 32" /><text x="30" y="37" textAnchor="middle" fill={color} stroke="none" fontFamily={FONT_LABEL} fontWeight={900} fontSize={20}>ABS</text></g>
}

function MapIcon({ color = '#ff2a35' }: { color?: string }): ReactElement {
  return <g fill="none" stroke={color} strokeWidth={4} strokeLinejoin="round"><path d="M2 8 l15 -7 l16 9 l16 -9 l15 7 v45 l-15 8 l-16 -9 l-16 9 l-15 -8 Z" /><path d="M17 1 v60 M33 10 v42 M49 1 v60" /></g>
}

function RpmBarGraphic({ snapshot, x, y, w, h, id = 'f296-rpm', scale = true }: { snapshot: HifiWidgetProps['snapshot']; x: number; y: number; w: number; h: number; id?: string; scale?: boolean }): ReactElement {
  const f = rpmFrac(snapshot)
  const rpm = num(snapshot?.rpm)
  const maxRpm = num(snapshot?.maxRpm)
  const missing = rpm == null || maxRpm == null || maxRpm <= 0
  const cells = 32
  const gap = 2
  const cell = (w - gap * (cells - 1)) / cells
  const lit = missing ? 0 : Math.round(f * cells)
  return (
    <g data-rpm-gauge="f296-rpm-bar" data-rpm-pct={f.toFixed(4)} data-rpm-lit={lit}>
      <GlowDefs id={id} />
      {scale ? (
        <g>
          {[0, 2, 4, 6, 8, 10, 12].map((t) => <text key={t} x={x + (t / 12) * w} y={y - 12} textAnchor="middle" fill={WHITE} fontFamily={FONT_NUM} fontWeight={800} fontSize={22} {...legibleStroke(22)}>{t}</text>)}
          {[0, 2, 4, 6, 8, 10, 12].map((t) => <rect key={t} x={x + (t / 12) * w - 1} y={y - 7} width={2} height={8} fill={WHITE} />)}
        </g>
      ) : null}
      <rect x={x - 2} y={y - 2} width={w + 4} height={h + 4} fill="#050505" stroke="rgba(255,255,255,0.22)" strokeWidth={1.5} />
      {Array.from({ length: cells }, (_, i) => {
        const pct = i / (cells - 1)
        const color = pct > 0.78 ? '#ff1010' : pct > 0.62 ? YELLOW : pct > 0.42 ? WHITE : '#343434'
        return <rect key={i} x={x + i * (cell + gap)} y={y} width={cell} height={h} fill={i < lit ? color : RECESS} opacity={i < lit ? 1 : 0.62} />
      })}
    </g>
  )
}

function F296Dash({ snapshot, width, height, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
  const gear = num(snapshot?.gear)
  const speed = num(snapshot?.speedKmh)
  const fuel = num(snapshot?.fuelLiters)
  const speedReading = formatMeasurement(speed, 'speed-kmh', unitSystem, { decimals: 0 })
  const fuelReading = formatMeasurement(fuel, 'fuel-volume-l', unitSystem, { decimals: 0 })
  const tc = safeText(snapshot?.tcLevel)
  const abs = safeText(snapshot?.absLevel)
  const map = safeText(snapshot?.engineMap)
  const lastLap = lapTime(num(snapshot?.lastLapTimeSec)).replace(/\.\d{3}$/, (m) => m.slice(0, 2))
  const sideMargin = 20
  const sideWidth = 286
  const rightX = DASH_W - sideMargin - sideWidth
  return (
    <CleanTile width={width ?? DASH_W} height={height ?? DASH_H}>
      <rect width={DASH_W} height={DASH_H} fill={DARK} />
      <RoundLedStrip snapshot={snapshot} x={62} y={56} w={900} count={17} id="f296-dash-leds" r={15} />
      <InfoBox x={sideMargin} y={140} w={sideWidth} h={112} label="FUEL" value={fuelReading.display} unit={fuelReading.unit} valueOffsetX={16}><FuelIcon /></InfoBox>
      <InfoBox x={sideMargin} y={278} w={sideWidth} h={112} label="TC" value={tc}><SlipIcon /></InfoBox>
      <InfoBox x={rightX} y={140} w={sideWidth} h={112} label="LAST LAP" value={lastLap} valueFontSize={46} valueOffsetX={-24} iconSide="right"><StopwatchIcon /></InfoBox>
      <InfoBox x={rightX} y={272} w={sideWidth} h={112} label="ABS" value={abs} iconSide="right"><AbsIcon /></InfoBox>
      <InfoBox x={rightX} y={400} w={sideWidth} h={96} label="MAP" value={map} labelFontSize={26} valueFontSize={48} valueBottom={10} iconScale={0.82} iconSide="right"><MapIcon /></InfoBox>
      <text x={512} y={330} textAnchor="middle" fill={gear == null ? C.dim : WHITE} stroke={RED} strokeWidth={4} paintOrder="stroke" fontFamily={FONT_BIG} fontWeight={900} fontSize={190} fontStyle="italic">{gearLabel(gear)}</text>
      <text x={512} y={430} textAnchor="middle" fill={speed == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={900} fontSize={70} {...legibleStroke(70)}>{speedReading.display}</text>
      <text x={512} y={466} textAnchor="middle" fill={WHITE} fontFamily={FONT_LABEL} fontWeight={900} fontSize={26} letterSpacing={1} {...legibleStroke(26)}>{speedReading.unit}</text>
      <text x={512} y={512} textAnchor="middle" fill={WHITE} fontFamily={FONT_LABEL} fontWeight={900} fontSize={22} letterSpacing={2} {...legibleStroke(22)}>RPM x1000</text>
      <RpmBarGraphic snapshot={snapshot} x={56} y={550} w={912} h={30} id="f296-dash-rpm" />
      <rect x={806} y={542} width={8} height={48} rx={3} fill="#f3f3f3" stroke="#ff2020" strokeWidth={3} />
    </CleanTile>
  )
}

function HugeGear({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const gear = num(snapshot?.gear)
  const w = width ?? 280
  const h = height ?? 240
  return <CleanTile width={w} height={h}><text x={w / 2} y={h * 0.78} textAnchor="middle" fill={gear == null ? C.dim : WHITE} stroke={RED} strokeWidth={Math.max(3, h * 0.022)} paintOrder="stroke" fontFamily={FONT_BIG} fontWeight={900} fontSize={h * 0.86} fontStyle="italic">{gearLabel(gear)}</text></CleanTile>
}

function SpeedWidget({ snapshot, width, height, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
  const speed = num(snapshot?.speedKmh)
  const reading = formatMeasurement(speed, 'speed-kmh', unitSystem, { decimals: 0 })
  const w = width ?? 360
  const h = height ?? 180
  return <CleanTile width={w} height={h}><text x={w / 2} y={h * 0.58} textAnchor="middle" fill={speed == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={900} fontSize={h * 0.52} {...legibleStroke(h * 0.52)}>{reading.display}</text><text x={w / 2} y={h * 0.82} textAnchor="middle" fill={YELLOW} fontFamily={FONT_LABEL} fontWeight={900} fontSize={h * 0.17} letterSpacing={1} {...legibleStroke(h * 0.17)}>{reading.unit}</text></CleanTile>
}

function RevLightsWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 960
  const h = height ?? 90
  return <CleanTile width={w} height={h}><RoundLedStrip snapshot={snapshot} x={44} y={h / 2} w={w - 88} count={17} id="f296-strip-leds" r={Math.min(18, h * 0.24)} /></CleanTile>
}

function RpmBarWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 760
  const h = height ?? 130
  const rpm = num(snapshot?.rpm)
  return <CleanTile width={w} height={h}><text x={w / 2} y={28} textAnchor="middle" fill={WHITE} fontFamily={FONT_LABEL} fontWeight={900} fontSize={24} letterSpacing={2} {...legibleStroke(24)}>RPM x1000</text><RpmBarGraphic snapshot={snapshot} x={42} y={78} w={w - 84} h={28} id="f296-rpmbar" /><text x={w - 44} y={44} textAnchor="end" fill={rpm == null ? C.dim : YELLOW} fontFamily={FONT_NUM} fontWeight={900} fontSize={28} {...legibleStroke(28)}>{rpm == null ? '—' : fixed(rpm)}</text></CleanTile>
}

function SingleValue({ width = 280, height = 160, label, value, unit, color = WHITE, icon }: { width?: number; height?: number; label: string; value: string; unit?: string; color?: string; icon?: ReactElement }): ReactElement {
  return (
    <CleanTile width={width} height={height}>
      {icon ? <g transform={`translate(${width * 0.08},${height * 0.38}) scale(${height / 150})`}>{icon}</g> : null}
      <text x={width / 2} y={height * 0.32} textAnchor="middle" fill={YELLOW} fontFamily={FONT_LABEL} fontWeight={900} fontSize={height * 0.22} letterSpacing={2} {...legibleStroke(height * 0.22)}>{label}</text>
      <text x={width / 2} y={height * 0.76} textAnchor="middle" fill={value === '—' ? C.dim : color} fontFamily={FONT_BIG} fontWeight={900} fontSize={height * 0.44} {...legibleStroke(height * 0.44)}>{value}{unit ? <tspan fill={WHITE} fontFamily={FONT_LABEL} fontSize={height * 0.22}> {unit}</tspan> : null}</text>
    </CleanTile>
  )
}

function FuelWidget(props: HifiWidgetProps): ReactElement {
  const reading = formatMeasurement(num(props.snapshot?.fuelLiters), 'fuel-volume-l', props.unitSystem ?? 'metric', { decimals: 0 })
  return <SingleValue width={props.width ?? 300} height={props.height ?? 160} label="FUEL" value={reading.display} unit={reading.unit} icon={<FuelIcon />} />
}
function TcWidget(props: HifiWidgetProps): ReactElement { return <SingleValue width={props.width ?? 260} height={props.height ?? 160} label="TC" value={safeText(props.snapshot?.tcLevel)} icon={<SlipIcon />} /> }
function AbsWidget(props: HifiWidgetProps): ReactElement { return <SingleValue width={props.width ?? 260} height={props.height ?? 160} label="ABS" value={safeText(props.snapshot?.absLevel)} icon={<AbsIcon />} /> }
function MapWidget(props: HifiWidgetProps): ReactElement { return <SingleValue width={props.width ?? 260} height={props.height ?? 160} label="MAP" value={safeText(props.snapshot?.engineMap)} icon={<MapIcon />} /> }
function LastLapWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 400
  const h = height ?? 160
  const value = lapTime(num(snapshot?.lastLapTimeSec))
  const size = h * 0.28
  return (
    <CleanTile width={w} height={h}>
      <g transform={`translate(${w * 0.06},${h * 0.44}) scale(${h / 190})`}><StopwatchIcon /></g>
      <text x={w / 2} y={h * 0.31} textAnchor="middle" fill={YELLOW} fontFamily={FONT_LABEL} fontWeight={900} fontSize={h * 0.2} letterSpacing={2} {...legibleStroke(h * 0.2)}>LAST LAP</text>
      <text x={w * 0.6} y={h * 0.72} textAnchor="middle" fill={value.startsWith('--') ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={900} fontSize={size} {...legibleStroke(size)}>{value}</text>
    </CleanTile>
  )
}
function DeltaWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const delta = num(snapshot?.deltaToBestSec)
  return <SingleValue width={width ?? 300} height={height ?? 150} label="DELTA" value={signed(delta, 2)} color={condColor(delta, { positiveIsGood: false, deadzone: 0.01, good: '#2BFF66', bad: '#ff3030', neutral: WHITE })} />
}

const commonRequires: HifiWidgetModule['requires'] = ['gear', 'speedKmh', 'rpm', 'maxRpm', 'shiftIndicatorPct', 'fuelLiters', 'tcLevel', 'lastLapTimeSec', 'absLevel', 'engineMap']

export const f296Dash: HifiWidgetModule = { id: 'f296Dash', title: 'Ferrari 296 GT3 dash', description: 'Full Ferrari 296 GT3-style cluster with shift LEDs, dominant gear, speed, RPM, fuel, TC, lap, ABS and MAP.', category: 'cars', tags: [...TAGS, 'dashboard', 'cluster', 'shift-lights', 'gear', 'speed', 'rpm', 'fuel', 'tc', 'lap', 'abs', 'map'], requires: commonRequires, defaultSize: { w: DASH_W, h: DASH_H }, render: (props) => <F296Dash {...props} /> }
export const f296Gear: HifiWidgetModule = { id: 'f296Gear', title: 'Ferrari 296 GT3 gear', description: 'Clean Ferrari 296 GT3 huge gear digit.', category: 'cars', tags: [...TAGS, 'gear', 'clean'], requires: ['gear'], defaultSize: { w: 280, h: 240 }, render: (props) => <HugeGear {...props} /> }
export const f296Speed: HifiWidgetModule = { id: 'f296Speed', title: 'Ferrari 296 GT3 speed', description: 'Clean Ferrari 296 GT3 speed readout using the global unit system.', category: 'cars', tags: [...TAGS, 'speed', 'clean'], requires: ['speedKmh'], defaultSize: { w: 360, h: 180 }, render: (props) => <SpeedWidget {...props} /> }
export const f296RevLights: HifiWidgetModule = { id: 'f296RevLights', title: 'Ferrari 296 GT3 rev lights', description: 'Clean Ferrari 296 GT3 round shift LED strip.', category: 'cars', tags: [...TAGS, 'rev-lights', 'shift-lights', 'clean'], requires: ['shiftIndicatorPct', 'rpm', 'maxRpm'], defaultSize: { w: 960, h: 90 }, render: (props) => <RevLightsWidget {...props} /> }
export const f296RpmBar: HifiWidgetModule = { id: 'f296RpmBar', title: 'Ferrari 296 GT3 RPM bar', description: 'Clean Ferrari 296 GT3 horizontal RPM bar with scale.', category: 'cars', tags: [...TAGS, 'rpm', 'bar', 'clean'], requires: ['rpm', 'maxRpm', 'shiftIndicatorPct'], defaultSize: { w: 760, h: 130 }, render: (props) => <RpmBarWidget {...props} /> }
export const f296Fuel: HifiWidgetModule = { id: 'f296Fuel', title: 'Ferrari 296 GT3 fuel', description: 'Clean Ferrari 296 GT3 fuel readout using the global unit system.', category: 'cars', tags: [...TAGS, 'fuel', 'clean'], requires: ['fuelLiters'], defaultSize: { w: 300, h: 160 }, render: (props) => <FuelWidget {...props} /> }
export const f296Tc: HifiWidgetModule = { id: 'f296Tc', title: 'Ferrari 296 GT3 TC', description: 'Clean Ferrari 296 GT3 traction-control level readout.', category: 'cars', tags: [...TAGS, 'tc', 'traction-control', 'clean'], requires: ['tcLevel'], defaultSize: { w: 260, h: 160 }, render: (props) => <TcWidget {...props} /> }
export const f296Abs: HifiWidgetModule = { id: 'f296Abs', title: 'Ferrari 296 GT3 ABS', description: 'Clean Ferrari 296 GT3 ABS level readout.', category: 'cars', tags: [...TAGS, 'abs', 'clean'], requires: ['absLevel'], defaultSize: { w: 260, h: 160 }, render: (props) => <AbsWidget {...props} /> }
export const f296Map: HifiWidgetModule = { id: 'f296Map', title: 'Ferrari 296 GT3 engine map', description: 'Clean Ferrari 296 GT3 engine MAP value.', category: 'cars', tags: [...TAGS, 'map', 'engine-map', 'clean'], requires: ['engineMap'], defaultSize: { w: 260, h: 160 }, render: (props) => <MapWidget {...props} /> }
export const f296LastLap: HifiWidgetModule = { id: 'f296LastLap', title: 'Ferrari 296 GT3 last lap', description: 'Clean Ferrari 296 GT3 last-lap time readout.', category: 'cars', tags: [...TAGS, 'last-lap', 'lap-time', 'clean'], requires: ['lastLapTimeSec'], defaultSize: { w: 420, h: 160 }, render: (props) => <LastLapWidget {...props} /> }
export const f296Delta: HifiWidgetModule = { id: 'f296Delta', title: 'Ferrari 296 GT3 delta', description: 'Clean Ferrari 296 GT3 delta-to-best readout colored by gain/loss.', category: 'cars', tags: [...TAGS, 'delta', 'delta-to-best', 'clean'], requires: ['deltaToBestSec'], defaultSize: { w: 300, h: 150 }, render: (props) => <DeltaWidget {...props} /> }
