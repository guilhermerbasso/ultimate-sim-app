import { type ReactElement } from 'react'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { C, CleanTile, FONT_BIG, FONT_LABEL, FONT_NUM, ShiftStrobe, atShiftPoint, condColor, fixed, gearLabel, legibleStroke, num, resolveRevLightPct, revFill, signed } from '../kit'
import { formatMeasurement, type UnitSystem } from '../../../../../shared/units'

const DASH_W = 1024
const DASH_H = 600
const LIME = '#A6D608'
const GREEN = '#1FD113'
const LIME_YELLOW = '#D9FF00'
const RED = '#D71920'
const WHITE = '#F8F8F8'
const DARK = '#020402'
const RECESS = '#071006'
const TAGS = ['lamborghini', 'huracan', 'huracan-gt3', 'gt3', 'car', 'ir'] as const

function safeText(v: unknown): string {
  return v == null || v === '' ? '—' : String(v)
}

function rpmFraction(snapshot: HifiWidgetProps['snapshot']): number {
  return resolveRevLightPct(snapshot)
}

function shiftState(snapshot: HifiWidgetProps['snapshot']): { f: number; missing: boolean; flash: boolean } {
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

function lapShort(sec: number | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return '--:--.-'
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

function hexPath(cx: number, cy: number, w: number, h: number): string {
  const hw = w / 2
  const hh = h / 2
  const cut = Math.min(hw * 0.42, hh)
  return `M${cx - hw + cut} ${cy - hh} H${cx + hw - cut} L${cx + hw} ${cy} L${cx + hw - cut} ${cy + hh} H${cx - hw + cut} L${cx - hw} ${cy} Z`
}

function angularFramePath(x: number, y: number, w: number, h: number, nose: 'left' | 'right' | 'both' = 'both'): string {
  const c = Math.min(52, h * 0.46)
  const left = nose !== 'right' ? c : 8
  const right = nose !== 'left' ? c : 8
  return `M${x + left} ${y} H${x + w - right} L${x + w} ${y + h / 2} L${x + w - right} ${y + h} H${x + left} L${x} ${y + h / 2} Z`
}

function shiftColor(i: number, count: number): string {
  const p = i / Math.max(1, count - 1)
  if (p > 0.82) return RED
  if (p > 0.52) return LIME_YELLOW
  return GREEN
}

function GlowDefs({ id }: { id: string }): ReactElement {
  return (
    <defs>
      <filter id={`${id}-glow`} x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="4" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <linearGradient id={`${id}-gear`} x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="58%" stopColor="#ffffff" />
        <stop offset="100%" stopColor="#d7d7d7" />
      </linearGradient>
    </defs>
  )
}

function HexShiftRow({ snapshot, x, y, w, h, count = 20, id = 'lh-shift' }: { snapshot: HifiWidgetProps['snapshot']; x: number; y: number; w: number; h: number; count?: number; id?: string }): ReactElement {
  const { f, missing, flash } = shiftState(snapshot)
  const shift = atShiftPoint(f, snapshot?.revLights?.blink)
  const lit = shift ? count : missing ? 0 : Math.round(f * count)
  const gap = Math.max(3, w * 0.006)
  const cell = (w - gap * (count - 1)) / count
  return (
    <g>
      <ShiftStrobe active={shift} />
      <GlowDefs id={id} />
      {Array.from({ length: count }, (_, i) => {
        const on = !missing && (i < lit || (flash && i >= count - 2))
        const color = revFill(shiftColor(i, count), shift)
        const cx = x + cell / 2 + i * (cell + gap)
        return (
          <path
            key={i}
            d={hexPath(cx, y + h / 2, cell, h)}
            fill={on ? color : RECESS}
            stroke={on ? color : 'rgba(166,214,8,0.28)'}
            strokeWidth={on ? 2.3 : 1.3}
            opacity={on ? 1 : 0.52}
            filter={on ? `url(#${id}-glow)` : undefined}
          />
        )
      })}
    </g>
  )
}

function TopShiftFrame({ snapshot }: { snapshot: HifiWidgetProps['snapshot'] }): ReactElement {
  return (
    <g>
      <path d="M48 48 H128 M896 48 H976 L1000 84 L976 120 H896" fill="none" stroke={LIME} strokeWidth={3} />
      <path d="M128 56 H896 M128 112 H896 M48 48 L24 84 L48 120 H128" fill="none" stroke={LIME} strokeWidth={3} />
      <path d={hexPath(75, 84, 52, 45)} fill="none" stroke={LIME} strokeWidth={1.4} opacity={0.5} />
      <HexShiftRow snapshot={snapshot} x={108} y={63} w={838} h={42} count={20} id="lh-dash-shift" />
    </g>
  )
}

function HexGearFrame({ snapshot, unitSystem }: { snapshot: HifiWidgetProps['snapshot']; unitSystem: UnitSystem }): ReactElement {
  const gear = num(snapshot?.gear)
  const speed = num(snapshot?.speedKmh)
  const speedReading = formatMeasurement(speed, 'speed-kmh', unitSystem, { decimals: 0 })
  return (
    <g>
      <GlowDefs id="lh-center" />
      <path d={hexPath(512, 307, 380, 265)} fill="rgba(0,0,0,0.72)" stroke={LIME} strokeWidth={3.2} />
      <path d="M412 180 H624 M400 285 L476 166 H548 M625 448 H412 M624 166 H642 M400 448 H382 M642 166 L714 286 M382 448 L310 328 M714 328 L642 448" fill="none" stroke={LIME} strokeWidth={2.2} opacity={0.95} />
      <text x={512} y={335} textAnchor="middle" fill={gear == null ? C.dim : `url(#lh-center-gear)`} fontFamily={FONT_BIG} fontWeight={900} fontSize={160} {...legibleStroke(160)}>{gearLabel(gear)}</text>
      <text x={512} y={430} textAnchor="middle" fill={speed == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={900} fontSize={42} {...legibleStroke(42)}>{speedReading.display}</text>
    </g>
  )
}

function Honeycomb({ x, y, rows = 4, cols = 3, size = 13 }: { x: number; y: number; rows?: number; cols?: number; size?: number }): ReactElement {
  return (
    <g opacity={0.22}>
      {Array.from({ length: rows * cols }, (_, i) => {
        const r = Math.floor(i / cols)
        const c = i % cols
        return <path key={i} d={hexPath(x + c * size * 1.45 + (r % 2) * size * 0.72, y + r * size * 1.22, size, size * 1.08)} fill="none" stroke={LIME} strokeWidth={1} />
      })}
    </g>
  )
}

function DashInfoFrame({ x, y, w, h, side, children }: { x: number; y: number; w: number; h: number; side: 'left' | 'right'; children: ReactElement | ReactElement[] }): ReactElement {
  return (
    <g>
      <path d={angularFramePath(x, y, w, h, side === 'left' ? 'right' : 'left')} fill="rgba(0,0,0,0.82)" stroke={LIME} strokeWidth={3} />
      <path d={`M${x + 40} ${y + 18} H${x + w - 46} M${x + 44} ${y + h - 16} H${x + w - 44}`} stroke={LIME} strokeWidth={1.7} opacity={0.85} />
      <line x1={x + 42} y1={y + h / 2 + 12} x2={x + w - 40} y2={y + h / 2 + 12} stroke={LIME} strokeWidth={1.7} opacity={0.78} />
      {side === 'left' ? <Honeycomb x={x + 32} y={y + 35} /> : <Honeycomb x={x + w - 82} y={y + 35} />}
      {children}
    </g>
  )
}

function DashPair({ x, y, label, value, unit, valueColor = WHITE }: { x: number; y: number; label: string; value: string; unit?: string; valueColor?: string }): ReactElement {
  const valueX = x + 176
  const valueSize = Math.max(24, Math.min(34, 112 / (Math.max(1, value.length) * 0.72)))
  return (
    <g>
      <text x={x} y={y} fill={LIME} fontFamily={FONT_LABEL} fontWeight={900} fontSize={24} letterSpacing={2} {...legibleStroke(24)}>{label}</text>
      <text x={valueX} y={y + 3} textAnchor="end" fill={value === '—' || value.startsWith('--') ? C.dim : valueColor} fontFamily={FONT_BIG} fontWeight={900} fontSize={valueSize} {...legibleStroke(valueSize)}>{value}</text>
      {unit ? <text x={valueX + 12} y={y + 2} fill={LIME} fontFamily={FONT_LABEL} fontWeight={900} fontSize={18} {...legibleStroke(18)}>{unit}</text> : null}
    </g>
  )
}

function CenterBand({ snapshot }: { snapshot: HifiWidgetProps['snapshot'] }): ReactElement {
  const bb = num(snapshot?.brakeBiasPct)
  const tc = safeText(snapshot?.tcLevel)
  return (
    <g>
      <path d={angularFramePath(306, 505, 412, 76, 'both')} fill="rgba(0,0,0,0.84)" stroke={LIME} strokeWidth={3} />
      <path d="M360 530 L386 557 H638 L664 530 M350 567 H674" fill="none" stroke={LIME} strokeWidth={1.7} opacity={0.88} />
      <text x={390} y={552} textAnchor="middle" fill={LIME} fontFamily={FONT_LABEL} fontWeight={900} fontSize={29} letterSpacing={2} {...legibleStroke(29)}>BB</text>
      <text x={470} y={556} textAnchor="middle" fill={bb == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={900} fontSize={38} {...legibleStroke(38)}>{fixed(bb)}</text>
      <text x={514} y={552} textAnchor="middle" fill={WHITE} fontFamily={FONT_LABEL} fontWeight={900} fontSize={23} {...legibleStroke(23)}>%</text>
      <line x1={548} y1={525} x2={548} y2={562} stroke={LIME} strokeWidth={2} />
      <text x={596} y={552} textAnchor="middle" fill={LIME} fontFamily={FONT_LABEL} fontWeight={900} fontSize={29} letterSpacing={2} {...legibleStroke(29)}>TC</text>
      <text x={660} y={556} textAnchor="middle" fill={tc === '—' ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={900} fontSize={38} {...legibleStroke(38)}>{tc}</text>
    </g>
  )
}

function LamboDash({ snapshot, width, height, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
  const speed = num(snapshot?.speedKmh)
  const fuel = num(snapshot?.fuelLiters)
  const speedReading = formatMeasurement(speed, 'speed-kmh', unitSystem, { decimals: 0 })
  const fuelReading = formatMeasurement(fuel, 'fuel-volume-l', unitSystem, { decimals: 1 })
  const lap = lapShort(num(snapshot?.lastLapTimeSec))
  const delta = num(snapshot?.deltaToBestSec)
  return (
    <CleanTile width={width ?? DASH_W} height={height ?? DASH_H}>
      <rect width={DASH_W} height={DASH_H} fill={DARK} />
      <TopShiftFrame snapshot={snapshot} />
      <HexGearFrame snapshot={snapshot} unitSystem={unitSystem} />
      <DashInfoFrame x={22} y={410} w={300} h={142} side="left">
        <DashPair x={72} y={465} label="SPD" value={speedReading.display} unit={speedReading.unit} />
        <DashPair x={72} y={530} label="FUEL" value={fuelReading.display} unit={fuelReading.unit} />
      </DashInfoFrame>
      <CenterBand snapshot={snapshot} />
      <DashInfoFrame x={702} y={412} w={300} h={140} side="right">
        <text x={738} y={465} textAnchor="start" fill={LIME} fontFamily={FONT_LABEL} fontWeight={900} fontSize={28} letterSpacing={2} {...legibleStroke(28)}>LAP</text>
        <text x={948} y={468} textAnchor="end" fill={lap.startsWith('--') ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={900} fontSize={34} {...legibleStroke(34)}>{lap}</text>
        <text x={924} y={531} textAnchor="end" fill={condColor(delta, { positiveIsGood: false, deadzone: 0.01, good: LIME, bad: RED, neutral: WHITE })} fontFamily={FONT_BIG} fontWeight={900} fontSize={46} {...legibleStroke(46)}>{signed(delta, 2)}</text>
      </DashInfoFrame>
    </CleanTile>
  )
}

function GearWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 280
  const h = height ?? 240
  const gear = num(snapshot?.gear)
  return (
    <CleanTile width={w} height={h}>
      <path d={hexPath(w / 2, h / 2, w * 0.86, h * 0.72)} fill="none" stroke={LIME} strokeWidth={Math.max(2, h * 0.018)} opacity={0.96} />
      <text x={w / 2} y={h * 0.75} textAnchor="middle" fill={gear == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={900} fontSize={h * 0.7} {...legibleStroke(h * 0.7)}>{gearLabel(gear)}</text>
    </CleanTile>
  )
}

function SpeedWidget({ snapshot, width, height, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
  const w = width ?? 360
  const h = height ?? 170
  const speed = num(snapshot?.speedKmh)
  const reading = formatMeasurement(speed, 'speed-kmh', unitSystem, { decimals: 0 })
  return <CleanTile width={w} height={h}><text x={w / 2} y={h * 0.67} textAnchor="middle" fill={speed == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={900} fontSize={h * 0.52} {...legibleStroke(h * 0.52)}>{reading.display}</text><text x={w / 2} y={h * 0.9} textAnchor="middle" fill={LIME} fontFamily={FONT_LABEL} fontWeight={900} fontSize={h * 0.16}>{reading.unit}</text></CleanTile>
}

function RevLightsWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 960
  const h = height ?? 90
  return <CleanTile width={w} height={h}><HexShiftRow snapshot={snapshot} x={18} y={h * 0.26} w={w - 36} h={h * 0.48} count={20} id="lh-clean-shift" /></CleanTile>
}

function RpmWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 360
  const h = height ?? 150
  const rpm = num(snapshot?.rpm)
  const f = rpmFraction(snapshot)
  return (
    <CleanTile width={w} height={h}>
      <HexShiftRow snapshot={snapshot} x={28} y={h * 0.58} w={w - 56} h={h * 0.18} count={12} id="lh-rpm-mini" />
      <text x={w / 2} y={h * 0.45} textAnchor="middle" fill={rpm == null ? C.dim : WHITE} fontFamily={FONT_NUM} fontWeight={900} fontSize={h * 0.32} {...legibleStroke(h * 0.32)}>{fixed(rpm)}</text>
      <path d={angularFramePath(38, h * 0.88, (w - 76) * f, 6, 'both')} fill={LIME} opacity={rpm == null ? 0.18 : 0.92} />
    </CleanTile>
  )
}

function SingleValue({ width = 300, height = 150, label, value, unit, color = WHITE }: { width?: number; height?: number; label?: string; value: string; unit?: string; color?: string }): ReactElement {
  return (
    <CleanTile width={width} height={height}>
      {label ? <text x={width / 2} y={height * 0.32} textAnchor="middle" fill={LIME} fontFamily={FONT_LABEL} fontWeight={900} fontSize={height * 0.22} letterSpacing={2} {...legibleStroke(height * 0.22)}>{label}</text> : null}
      <text x={width / 2} y={height * 0.74} textAnchor="middle" fill={value === '—' || value.startsWith('--') ? C.dim : color} fontFamily={FONT_BIG} fontWeight={900} fontSize={height * 0.42} {...legibleStroke(height * 0.42)}>
        {value}{unit ? <tspan fill={LIME} fontFamily={FONT_LABEL} fontSize={height * 0.22}> {unit}</tspan> : null}
      </text>
    </CleanTile>
  )
}

function FuelWidget(props: HifiWidgetProps): ReactElement {
  const reading = formatMeasurement(num(props.snapshot?.fuelLiters), 'fuel-volume-l', props.unitSystem ?? 'metric', { decimals: 1 })
  return <SingleValue width={props.width ?? 300} height={props.height ?? 150} label="FUEL" value={reading.display} unit={reading.unit} />
}
function BrakeBiasWidget(props: HifiWidgetProps): ReactElement { return <SingleValue width={props.width ?? 300} height={props.height ?? 150} label="BB" value={fixed(num(props.snapshot?.brakeBiasPct))} unit="%" /> }
function TcWidget(props: HifiWidgetProps): ReactElement { return <SingleValue width={props.width ?? 240} height={props.height ?? 150} label="TC" value={safeText(props.snapshot?.tcLevel)} /> }
function LastLapWidget(props: HifiWidgetProps): ReactElement { return <SingleValue width={props.width ?? 380} height={props.height ?? 150} label="LAP" value={lapShort(num(props.snapshot?.lastLapTimeSec))} /> }
function DeltaWidget(props: HifiWidgetProps): ReactElement {
  const delta = num(props.snapshot?.deltaToBestSec)
  return <SingleValue width={props.width ?? 300} height={props.height ?? 150} value={signed(delta, 2)} color={condColor(delta, { positiveIsGood: false, deadzone: 0.01, good: LIME, bad: RED, neutral: WHITE })} />
}
function PositionWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 280
  const h = height ?? 145
  const pos = num(snapshot?.position)
  const total = num(snapshot?.totalCars)
  const value = pos == null ? 'P—' : `P${Math.trunc(pos)}`
  return (
    <CleanTile width={w} height={h}>
      <text x={w / 2} y={h * 0.68} textAnchor="middle" fill={pos == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={900} fontSize={h * 0.48} {...legibleStroke(h * 0.48)}>{value}<tspan fill={LIME} fontFamily={FONT_LABEL} fontSize={h * 0.22}> / {total == null ? '—' : Math.trunc(total)}</tspan></text>
    </CleanTile>
  )
}

const dashRequires: HifiWidgetModule['requires'] = ['gear', 'speedKmh', 'rpm', 'maxRpm', 'shiftIndicatorPct', 'fuelLiters', 'brakeBiasPct', 'tcLevel', 'lastLapTimeSec', 'deltaToBestSec']

export const lhDash: HifiWidgetModule = { id: 'lhDash', title: 'Lamborghini Huracán GT3 EVO2 dash', description: 'Full angular Lamborghini Huracán GT3 EVO2-style cluster with hex shift row, gear, speed, fuel, brake bias, TC, lap and delta.', category: 'cars', tags: [...TAGS, 'dashboard', 'cluster', 'shift-lights', 'gear', 'speed', 'fuel', 'brake-bias', 'tc', 'lap', 'delta'], requires: dashRequires, defaultSize: { w: DASH_W, h: DASH_H }, render: (props) => <LamboDash {...props} /> }
export const lhGear: HifiWidgetModule = { id: 'lhGear', title: 'Lamborghini Huracán GT3 EVO2 gear', description: 'Clean Lamborghini Huracán GT3 EVO2 gear readout in an angular lime hex frame.', category: 'cars', tags: [...TAGS, 'gear', 'clean'], requires: ['gear'], defaultSize: { w: 280, h: 240 }, render: (props) => <GearWidget {...props} /> }
export const lhSpeed: HifiWidgetModule = { id: 'lhSpeed', title: 'Lamborghini Huracán GT3 EVO2 speed', description: 'Clean Lamborghini Huracán GT3 EVO2 speed readout.', category: 'cars', tags: [...TAGS, 'speed', 'clean'], requires: ['speedKmh'], defaultSize: { w: 360, h: 170 }, render: (props) => <SpeedWidget {...props} /> }
export const lhRevLights: HifiWidgetModule = { id: 'lhRevLights', title: 'Lamborghini Huracán GT3 EVO2 rev lights', description: 'Clean Lamborghini Huracán GT3 EVO2 angular hex shift-light row.', category: 'cars', tags: [...TAGS, 'rev-lights', 'shift-lights', 'clean'], requires: ['shiftIndicatorPct', 'rpm', 'maxRpm'], defaultSize: { w: 960, h: 90 }, render: (props) => <RevLightsWidget {...props} /> }
export const lhRpm: HifiWidgetModule = { id: 'lhRpm', title: 'Lamborghini Huracán GT3 EVO2 RPM', description: 'Clean Lamborghini Huracán GT3 EVO2 RPM readout with mini angular shift segments.', category: 'cars', tags: [...TAGS, 'rpm', 'clean'], requires: ['rpm', 'maxRpm', 'shiftIndicatorPct'], defaultSize: { w: 360, h: 150 }, render: (props) => <RpmWidget {...props} /> }
export const lhFuel: HifiWidgetModule = { id: 'lhFuel', title: 'Lamborghini Huracán GT3 EVO2 fuel', description: 'Clean Lamborghini Huracán GT3 EVO2 fuel liters readout.', category: 'cars', tags: [...TAGS, 'fuel', 'clean'], requires: ['fuelLiters'], defaultSize: { w: 300, h: 150 }, render: (props) => <FuelWidget {...props} /> }
export const lhBrakeBias: HifiWidgetModule = { id: 'lhBrakeBias', title: 'Lamborghini Huracán GT3 EVO2 brake bias', description: 'Clean Lamborghini Huracán GT3 EVO2 BB percentage readout.', category: 'cars', tags: [...TAGS, 'brake-bias', 'bb', 'clean'], requires: ['brakeBiasPct'], defaultSize: { w: 300, h: 150 }, render: (props) => <BrakeBiasWidget {...props} /> }
export const lhTc: HifiWidgetModule = { id: 'lhTc', title: 'Lamborghini Huracán GT3 EVO2 TC', description: 'Clean Lamborghini Huracán GT3 EVO2 traction-control level readout.', category: 'cars', tags: [...TAGS, 'tc', 'traction-control', 'clean'], requires: ['tcLevel'], defaultSize: { w: 240, h: 150 }, render: (props) => <TcWidget {...props} /> }
export const lhLastLap: HifiWidgetModule = { id: 'lhLastLap', title: 'Lamborghini Huracán GT3 EVO2 last lap', description: 'Clean Lamborghini Huracán GT3 EVO2 last-lap time readout.', category: 'cars', tags: [...TAGS, 'last-lap', 'lap-time', 'clean'], requires: ['lastLapTimeSec'], defaultSize: { w: 380, h: 150 }, render: (props) => <LastLapWidget {...props} /> }
export const lhDelta: HifiWidgetModule = { id: 'lhDelta', title: 'Lamborghini Huracán GT3 EVO2 delta', description: 'Clean Lamborghini Huracán GT3 EVO2 delta-to-best readout colored green for gains and red for losses.', category: 'cars', tags: [...TAGS, 'delta', 'delta-to-best', 'clean'], requires: ['deltaToBestSec'], defaultSize: { w: 300, h: 150 }, render: (props) => <DeltaWidget {...props} /> }
export const lhPosition: HifiWidgetModule = { id: 'lhPosition', title: 'Lamborghini Huracán GT3 EVO2 position', description: 'Clean Lamborghini Huracán GT3 EVO2 race position readout.', category: 'cars', tags: [...TAGS, 'position', 'race-position', 'clean'], requires: ['position', 'totalCars'], defaultSize: { w: 280, h: 145 }, render: (props) => <PositionWidget {...props} /> }

export const LAMBOHURACAN_WIDGETS: HifiWidgetModule[] = [
  lhDash,
  lhGear,
  lhSpeed,
  lhRevLights,
  lhRpm,
  lhFuel,
  lhBrakeBias,
  lhTc,
  lhLastLap,
  lhDelta,
  lhPosition
]
