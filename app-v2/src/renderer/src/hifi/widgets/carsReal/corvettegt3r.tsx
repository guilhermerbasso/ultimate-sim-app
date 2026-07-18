import { type ReactElement } from 'react'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { C, CleanTile, FONT_BIG, FONT_LABEL, FONT_NUM, ShiftStrobe, atShiftPoint, condColor, fixed, gearLabel, lapTime, legibleStroke, num, resolveRevLightPct, revFill, signed, tempColor } from '../kit'
import { formatMeasurement, type UnitSystem } from '../../../../../shared/units'

const DASH_W = 1024
const DASH_H = 600
const CORVETTE_YELLOW = '#FFD100'
const AMBER = '#ffb000'
const WHITE = '#fbfbfb'
const GREEN = '#42f000'
const RED = '#ff2018'
const BLUE = '#9fd0ff'
const DARK = '#010201'
const TAGS = ['chevrolet', 'corvette', 'corvette-z06-gt3r', 'gt3', 'car', 'bosch-ddu', 'ir'] as const

function rpmFraction(snapshot: HifiWidgetProps['snapshot']): number {
  return resolveRevLightPct(snapshot)
}

function rpmMissing(snapshot: HifiWidgetProps['snapshot']): boolean {
  return snapshot == null || (num(snapshot.rpm) == null && num(snapshot.shiftIndicatorPct) == null && num(snapshot.revLights?.pct) == null)
}

function tyrePressure(snapshot: HifiWidgetProps['snapshot'], corner: 'lf' | 'rf' | 'lr' | 'rr'): number | undefined {
  return num(snapshot?.tyres?.[corner]?.pressureKpa) ?? num(snapshot?.tireColdPressuresKpa?.[corner])
}

function lapShort(sec: number | undefined): string {
  const s = lapTime(sec)
  return s.startsWith('--') ? '--:--.-' : s.replace(/\.\d{3}$/, (m) => m.slice(0, 2))
}

function BoschDefs({ id }: { id: string }): ReactElement {
  return (
    <defs>
      <filter id={`${id}-glow`} x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="5" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <linearGradient id={`${id}-bar`} x1="0" x2="1" y1="0" y2="0">
        <stop offset="0%" stopColor={GREEN} />
        <stop offset="55%" stopColor={GREEN} />
        <stop offset="76%" stopColor={CORVETTE_YELLOW} />
        <stop offset="88%" stopColor={AMBER} />
        <stop offset="100%" stopColor={RED} />
      </linearGradient>
    </defs>
  )
}

function ledColor(i: number, count: number): string {
  const p = i / Math.max(1, count - 1)
  if (p >= 0.9) return BLUE
  if (p >= 0.75) return RED
  if (p >= 0.38) return CORVETTE_YELLOW
  return GREEN
}

function ShiftLedRow({ snapshot, x, y, w, h, count = 18, id = 'cv-leds' }: { snapshot: HifiWidgetProps['snapshot']; x: number; y: number; w: number; h: number; count?: number; id?: string }): ReactElement {
  const f = rpmFraction(snapshot)
  const missing = rpmMissing(snapshot)
  const shift = atShiftPoint(f, snapshot?.revLights?.blink)
  const lit = shift ? count : missing ? 0 : Math.round(f * count)
  const blink = atShiftPoint(f, snapshot?.revLights?.blink, 0.96)
  const gap = w / Math.max(1, count - 1)
  const r = h / 2
  return (
    <g>
      <ShiftStrobe active={shift} />
      <BoschDefs id={id} />
      {Array.from({ length: count }, (_, i) => {
        const redline = i >= count - 2 && blink
        const on = !missing && (i < lit || redline)
        const color = revFill(ledColor(i, count), shift)
        const cx = x + i * gap
        return (
          <g key={i}>
            <circle cx={cx} cy={y} r={r + 10} fill={on ? color : 'transparent'} opacity={on ? 0.22 : 0} filter={`url(#${id}-glow)`} />
            <circle cx={cx} cy={y} r={r} fill={on ? color : '#111'} stroke={on ? color : 'rgba(255,255,255,0.22)'} strokeWidth={2} opacity={on ? 1 : 0.55} filter={on ? `url(#${id}-glow)` : undefined} />
            <circle cx={cx} cy={y} r={r * 0.35} fill={on ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.08)'} />
          </g>
        )
      })}
    </g>
  )
}

function RpmSegmentBar({ snapshot, x, y, w, h, id = 'cv-rpm', labels = true }: { snapshot: HifiWidgetProps['snapshot']; x: number; y: number; w: number; h: number; id?: string; labels?: boolean }): ReactElement {
  const f = rpmFraction(snapshot)
  const missing = rpmMissing(snapshot)
  const shift = atShiftPoint(f, snapshot?.revLights?.blink)
  const cells = 42
  const gap = 4
  const cellW = (w - gap * (cells - 1)) / cells
  const lit = shift ? cells : missing ? 0 : Math.round(f * cells)
  return (
    <g>
      <ShiftStrobe active={shift} />
      <BoschDefs id={id} />
      {labels ? (
        <g>
          <text x={x + w / 2} y={y - 44} textAnchor="middle" fill={WHITE} fontFamily={FONT_LABEL} fontWeight={900} fontSize={28} letterSpacing={1.5} {...legibleStroke(28)}>RPM x1000</text>
          {[0, 2, 4, 6, 8, 10, 12].map((t) => {
            const tx = x + (t / 12) * w
            const hot = t >= 6
            return (
              <g key={t}>
                <text x={tx} y={y - 18} textAnchor="middle" fill={hot ? CORVETTE_YELLOW : WHITE} fontFamily={FONT_NUM} fontWeight={900} fontSize={26} {...legibleStroke(26)}>{t}</text>
                <rect x={tx - 1} y={y - 10} width={2} height={10} fill={hot ? CORVETTE_YELLOW : WHITE} />
              </g>
            )
          })}
        </g>
      ) : null}
      {Array.from({ length: cells }, (_, i) => {
        const p = i / (cells - 1)
        const color = revFill(p > 0.87 ? RED : p > 0.58 ? CORVETTE_YELLOW : GREEN, shift)
        return <rect key={i} x={x + i * (cellW + gap)} y={y} width={cellW} height={h} fill={i < lit ? color : '#101010'} stroke={i < lit ? 'none' : 'rgba(255,255,255,0.22)'} strokeWidth={1} opacity={i < lit ? 1 : 0.82} />
      })}
    </g>
  )
}

function AngledPanel({ d, children }: { d: string; children: ReactElement | ReactElement[] }): ReactElement {
  return <g><path d={d} fill="rgba(0,0,0,0.9)" stroke={CORVETTE_YELLOW} strokeWidth={2.2} />{children}</g>
}

function CarDiagram({ x, y, scale = 1 }: { x: number; y: number; scale?: number }): ReactElement {
  return (
    <g transform={`translate(${x},${y}) scale(${scale})`} fill="none" stroke={CORVETTE_YELLOW} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M0 8 h24 l7 -7 h30 l7 7 h24" />
      <path d="M0 128 h24 l7 7 h30 l7 -7 h24" />
      <path d="M46 14 v114" />
      <circle cx="46" cy="70" r="7" fill={CORVETTE_YELLOW} />
      <path d="M0 0 v32 M92 0 v32 M0 104 v32 M92 104 v32" />
    </g>
  )
}

function DashTyres({ snapshot, unitSystem }: { snapshot: HifiWidgetProps['snapshot']; unitSystem: UnitSystem }): ReactElement {
  const lf = tyrePressure(snapshot, 'lf')
  const rf = tyrePressure(snapshot, 'rf')
  const lr = tyrePressure(snapshot, 'lr')
  const rr = tyrePressure(snapshot, 'rr')
  const value = (label: string, x: number, y: number, v: number | undefined) => (
    <g>
      <text x={x - 92} y={y - 48} fill={CORVETTE_YELLOW} fontFamily={FONT_LABEL} fontWeight={900} fontSize={22} {...legibleStroke(22)}>{label}</text>
      <text x={x} y={y} textAnchor="end" fill={v == null ? C.dim : WHITE} fontFamily={FONT_NUM} fontWeight={900} fontSize={44} {...legibleStroke(44)}>{formatMeasurement(v, 'pressure-kpa', unitSystem, { decimals: 1 }).display}</text>
    </g>
  )
  return (
    <g>
      {value('FL', 414, 466, lf)}
      {value('FR', 700, 466, rf)}
      {value('RL', 414, 540, lr)}
      {value('RR', 700, 540, rr)}
      <line x1={420} y1={480} x2={474} y2={480} stroke={CORVETTE_YELLOW} strokeWidth={2} />
      <line x1={554} y1={480} x2={608} y2={480} stroke={CORVETTE_YELLOW} strokeWidth={2} />
      <CarDiagram x={486} y={422} scale={0.58} />
      <text x={512} y={554} textAnchor="middle" fill={CORVETTE_YELLOW} fontFamily={FONT_LABEL} fontWeight={900} fontSize={26} letterSpacing={2} {...legibleStroke(26)}>{formatMeasurement(undefined, 'pressure-kpa', unitSystem).unit}</text>
    </g>
  )
}

function CorvetteDash({ snapshot, width, height, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
  const gear = num(snapshot?.gear)
  const speed = num(snapshot?.speedKmh)
  const fuel = num(snapshot?.fuelLiters)
  const speedReading = formatMeasurement(speed, 'speed-kmh', unitSystem, { decimals: 0 })
  const fuelReading = formatMeasurement(fuel, 'fuel-volume-l', unitSystem, { decimals: 0 })
  const lap = lapShort(num(snapshot?.lastLapTimeSec))
  const delta = num(snapshot?.deltaToBestSec)
  return (
    <CleanTile width={width ?? DASH_W} height={height ?? DASH_H}>
      <rect width={DASH_W} height={DASH_H} rx={8} fill={DARK} />
      <rect x={2} y={2} width={DASH_W - 4} height={DASH_H - 4} rx={8} fill="none" stroke="rgba(255,255,255,0.12)" />
      <ShiftLedRow snapshot={snapshot} x={60} y={44} w={904} h={22} count={18} id="cv-dash-leds" />
      <RpmSegmentBar snapshot={snapshot} x={52} y={142} w={920} h={52} id="cv-dash-rpm" />
      <text x={512} y={350} textAnchor="middle" fill={gear == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={900} fontSize={156} {...legibleStroke(156)}>{gearLabel(gear)}</text>
      <AngledPanel d="M28 392 H276 L292 408 V550 L278 568 H42 L28 554 Z">
        <text x={52} y={428} fill={CORVETTE_YELLOW} fontFamily={FONT_LABEL} fontWeight={900} fontSize={28} letterSpacing={2} {...legibleStroke(28)}>SPD</text>
        <text x={278} y={478} textAnchor="end" fill={speed == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={900} fontSize={60} {...legibleStroke(60)}>{speedReading.display}</text>
        <text x={278} y={496} textAnchor="end" fill={CORVETTE_YELLOW} fontFamily={FONT_LABEL} fontWeight={900} fontSize={18} {...legibleStroke(18)}>{speedReading.unit}</text>
        <line x1={42} y1={498} x2={278} y2={498} stroke={CORVETTE_YELLOW} strokeWidth={2} />
        <text x={52} y={532} fill={CORVETTE_YELLOW} fontFamily={FONT_LABEL} fontWeight={900} fontSize={26} letterSpacing={2} {...legibleStroke(26)}>FUEL</text>
        <text x={242} y={552} textAnchor="end" fill={fuel == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={900} fontSize={42} {...legibleStroke(42)}>{fuelReading.display}</text>
        <text x={254} y={552} fill={CORVETTE_YELLOW} fontFamily={FONT_LABEL} fontWeight={900} fontSize={24} {...legibleStroke(24)}>{fuelReading.unit}</text>
      </AngledPanel>
      <AngledPanel d="M306 400 H718 L730 412 V548 L710 570 H318 L298 548 V412 Z">
        <DashTyres snapshot={snapshot} unitSystem={unitSystem} />
      </AngledPanel>
      <AngledPanel d="M742 408 L758 392 H986 L998 404 V554 L984 568 H758 L742 548 Z">
        <text x={766} y={420} fill={CORVETTE_YELLOW} fontFamily={FONT_LABEL} fontWeight={900} fontSize={30} letterSpacing={2} {...legibleStroke(30)}>LAP</text>
        <text x={974} y={488} textAnchor="end" fill={lap.startsWith('--') ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={900} fontSize={50} {...legibleStroke(50)}>{lap}</text>
        <line x1={756} y1={506} x2={986} y2={506} stroke={CORVETTE_YELLOW} strokeWidth={2} />
        <text x={974} y={548} textAnchor="end" fill={delta == null ? C.dim : condColor(delta, { positiveIsGood: false, deadzone: 0.01, good: CORVETTE_YELLOW, bad: RED, neutral: WHITE })} fontFamily={FONT_BIG} fontWeight={900} fontSize={42} {...legibleStroke(42)}>{signed(delta, 2)}</text>
      </AngledPanel>
    </CleanTile>
  )
}

function GearWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 260
  const h = height ?? 220
  const gear = num(snapshot?.gear)
  return <CleanTile width={w} height={h}><text x={w / 2} y={h * 0.78} textAnchor="middle" fill={gear == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={900} fontSize={h * 0.82} {...legibleStroke(h * 0.82)}>{gearLabel(gear)}</text></CleanTile>
}

function SpeedWidget({ snapshot, width, height, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
  const w = width ?? 330
  const h = height ?? 165
  const speed = num(snapshot?.speedKmh)
  const reading = formatMeasurement(speed, 'speed-kmh', unitSystem, { decimals: 0 })
  return <CleanTile width={w} height={h}><text x={w / 2} y={h * 0.62} textAnchor="middle" fill={speed == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={900} fontSize={h * 0.52} {...legibleStroke(h * 0.52)}>{reading.display}</text><text x={w / 2} y={h * 0.85} textAnchor="middle" fill={CORVETTE_YELLOW} fontFamily={FONT_LABEL} fontWeight={900} fontSize={h * 0.16} {...legibleStroke(h * 0.16)}>{reading.unit}</text></CleanTile>
}

function RevLightsWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 960
  const h = height ?? 90
  return <CleanTile width={w} height={h}><ShiftLedRow snapshot={snapshot} x={48} y={h / 2} w={w - 96} h={Math.min(30, h * 0.48)} count={18} id="cv-strip-leds" /></CleanTile>
}

function RpmBarWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 960
  const h = height ?? 90
  return <CleanTile width={w} height={h}><RpmSegmentBar snapshot={snapshot} x={24} y={h * 0.48} w={w - 48} h={h * 0.34} id="cv-bar-widget" labels={false} /></CleanTile>
}

function SingleMetric({ width = 280, height = 145, label, value, unit, color = WHITE }: { width?: number; height?: number; label: string; value: string; unit?: string; color?: string }): ReactElement {
  return (
    <CleanTile width={width} height={height}>
      <text x={width / 2} y={height * 0.3} textAnchor="middle" fill={CORVETTE_YELLOW} fontFamily={FONT_LABEL} fontWeight={900} fontSize={height * 0.22} letterSpacing={2} {...legibleStroke(height * 0.22)}>{label}</text>
      <text x={width / 2} y={height * 0.76} textAnchor="middle" fill={value === '—' || value.startsWith('--') ? C.dim : color} fontFamily={FONT_BIG} fontWeight={900} fontSize={height * 0.42} {...legibleStroke(height * 0.42)}>{value}{unit ? <tspan fill={CORVETTE_YELLOW} fontFamily={FONT_LABEL} fontSize={height * 0.22}> {unit}</tspan> : null}</text>
    </CleanTile>
  )
}

function FuelWidget({ snapshot, width, height, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
  const reading = formatMeasurement(num(snapshot?.fuelLiters), 'fuel-volume-l', unitSystem, { decimals: 1 })
  return <SingleMetric width={width ?? 250} height={height ?? 140} label="FUEL" value={reading.display} unit={reading.unit} />
}

function TyrePressWidget({ snapshot, width, height, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
  const w = width ?? 390
  const h = height ?? 210
  const data: [string, number | undefined, number, number, 'start' | 'end'][] = [
    ['FL', tyrePressure(snapshot, 'lf'), w * 0.3, h * 0.34, 'end'],
    ['FR', tyrePressure(snapshot, 'rf'), w * 0.7, h * 0.34, 'start'],
    ['RL', tyrePressure(snapshot, 'lr'), w * 0.3, h * 0.73, 'end'],
    ['RR', tyrePressure(snapshot, 'rr'), w * 0.7, h * 0.73, 'start']
  ]
  return (
    <CleanTile width={w} height={h}>
      <CarDiagram x={w / 2 - 46} y={h * 0.18} scale={0.76} />
      {data.map(([label, value, x, y, anchor]) => (
        <g key={label}>
          <text x={anchor === 'end' ? x - 6 : x + 6} y={y - 34} textAnchor={anchor} fill={CORVETTE_YELLOW} fontFamily={FONT_LABEL} fontWeight={900} fontSize={22} {...legibleStroke(22)}>{label}</text>
          <text x={x} y={y} textAnchor={anchor} fill={value == null ? C.dim : WHITE} fontFamily={FONT_NUM} fontWeight={900} fontSize={42} {...legibleStroke(42)}>{formatMeasurement(value, 'pressure-kpa', unitSystem, { decimals: 1 }).display}</text>
        </g>
      ))}
      <text x={w / 2} y={h - 8} textAnchor="middle" fill={CORVETTE_YELLOW} fontFamily={FONT_LABEL} fontWeight={900} fontSize={26} letterSpacing={2} {...legibleStroke(26)}>{formatMeasurement(undefined, 'pressure-kpa', unitSystem).unit}</text>
    </CleanTile>
  )
}

function LastLapWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  return <SingleMetric width={width ?? 360} height={height ?? 140} label="LAST LAP" value={lapShort(num(snapshot?.lastLapTimeSec))} />
}

function DeltaWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const delta = num(snapshot?.deltaToBestSec)
  return <SingleMetric width={width ?? 280} height={height ?? 140} label="DELTA" value={signed(delta, 2)} color={condColor(delta, { positiveIsGood: false, deadzone: 0.01, good: '#22e06a', bad: RED, neutral: WHITE })} />
}

function PositionWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const pos = num(snapshot?.position)
  const total = num(snapshot?.totalCars)
  const value = pos == null ? '—' : `P${Math.trunc(pos)}${total == null ? '' : ` / ${Math.trunc(total)}`}`
  return <SingleMetric width={width ?? 300} height={height ?? 140} label="POS" value={value} />
}

function WaterWidget({ snapshot, width, height, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
  const v = num(snapshot?.waterTempC)
  const reading = formatMeasurement(v, 'temperature-c', unitSystem, { decimals: 0 })
  return <SingleMetric width={width ?? 280} height={height ?? 140} label="WATER" value={reading.display} unit={reading.unit} color={tempColor(v, 80, 105)} />
}

const dashRequires: HifiWidgetModule['requires'] = ['rpm', 'maxRpm', 'shiftIndicatorPct', 'gear', 'speedKmh', 'fuelLiters', 'tyres', 'tireColdPressuresKpa', 'lastLapTimeSec', 'deltaToBestSec', 'position', 'totalCars', 'waterTempC']

export const cvDash: HifiWidgetModule = { id: 'cvDash', title: 'Chevrolet Corvette Z06 GT3.R Bosch DDU dash', description: 'Full Corvette Z06 GT3.R Bosch DDU cluster with top shift LEDs, segmented RPM bar, dominant gear, speed, fuel, tire pressures, lap and delta.', category: 'cars', tags: [...TAGS, 'dashboard', 'cluster', 'shift-lights', 'rpm', 'gear', 'speed', 'fuel', 'tyre-pressure', 'lap', 'delta'], requires: dashRequires, defaultSize: { w: DASH_W, h: DASH_H }, render: (props) => <CorvetteDash {...props} /> }
export const cvGear: HifiWidgetModule = { id: 'cvGear', title: 'Chevrolet Corvette Z06 GT3.R gear', description: 'Clean Corvette Z06 GT3.R dominant gear digit.', category: 'cars', tags: [...TAGS, 'gear', 'clean'], requires: ['gear'], defaultSize: { w: 260, h: 220 }, render: (props) => <GearWidget {...props} /> }
export const cvSpeed: HifiWidgetModule = { id: 'cvSpeed', title: 'Chevrolet Corvette Z06 GT3.R speed', description: 'Clean Corvette Z06 GT3.R speed readout using the global unit system.', category: 'cars', tags: [...TAGS, 'speed', 'clean'], requires: ['speedKmh'], defaultSize: { w: 330, h: 165 }, render: (props) => <SpeedWidget {...props} /> }
export const cvRevLights: HifiWidgetModule = { id: 'cvRevLights', title: 'Chevrolet Corvette Z06 GT3.R rev lights', description: 'Clean Corvette Z06 GT3.R Bosch DDU top shift LED row.', category: 'cars', tags: [...TAGS, 'rev-lights', 'shift-lights', 'clean'], requires: ['shiftIndicatorPct', 'rpm', 'maxRpm'], defaultSize: { w: 960, h: 90 }, render: (props) => <RevLightsWidget {...props} /> }
export const cvRpmBar: HifiWidgetModule = { id: 'cvRpmBar', title: 'Chevrolet Corvette Z06 GT3.R RPM bar', description: 'Clean Corvette Z06 GT3.R horizontal segmented RPM bar.', category: 'cars', tags: [...TAGS, 'rpm', 'bar', 'clean'], requires: ['rpm', 'maxRpm', 'shiftIndicatorPct'], defaultSize: { w: 960, h: 90 }, render: (props) => <RpmBarWidget {...props} /> }
export const cvFuel: HifiWidgetModule = { id: 'cvFuel', title: 'Chevrolet Corvette Z06 GT3.R fuel', description: 'Clean Corvette Z06 GT3.R fuel readout using the global unit system.', category: 'cars', tags: [...TAGS, 'fuel', 'clean'], requires: ['fuelLiters'], defaultSize: { w: 250, h: 140 }, render: (props) => <FuelWidget {...props} /> }
export const cvTyrePress: HifiWidgetModule = { id: 'cvTyrePress', title: 'Chevrolet Corvette Z06 GT3.R tire pressures', description: 'Clean Corvette Z06 GT3.R four-corner tire pressure grid using the global unit system.', category: 'cars', tags: [...TAGS, 'tyre-pressure', 'tire-pressure', 'clean'], requires: ['tyres', 'tireColdPressuresKpa'], defaultSize: { w: 390, h: 210 }, render: (props) => <TyrePressWidget {...props} /> }
export const cvLastLap: HifiWidgetModule = { id: 'cvLastLap', title: 'Chevrolet Corvette Z06 GT3.R last lap', description: 'Clean Corvette Z06 GT3.R last-lap time readout.', category: 'cars', tags: [...TAGS, 'last-lap', 'lap-time', 'clean'], requires: ['lastLapTimeSec'], defaultSize: { w: 360, h: 140 }, render: (props) => <LastLapWidget {...props} /> }
export const cvDelta: HifiWidgetModule = { id: 'cvDelta', title: 'Chevrolet Corvette Z06 GT3.R delta', description: 'Clean Corvette Z06 GT3.R delta-to-best readout colored by gain or loss.', category: 'cars', tags: [...TAGS, 'delta', 'delta-to-best', 'clean'], requires: ['deltaToBestSec'], defaultSize: { w: 280, h: 140 }, render: (props) => <DeltaWidget {...props} /> }
export const cvPosition: HifiWidgetModule = { id: 'cvPosition', title: 'Chevrolet Corvette Z06 GT3.R position', description: 'Clean Corvette Z06 GT3.R race position readout.', category: 'cars', tags: [...TAGS, 'position', 'clean'], requires: ['position', 'totalCars'], defaultSize: { w: 300, h: 140 }, render: (props) => <PositionWidget {...props} /> }
export const cvWater: HifiWidgetModule = { id: 'cvWater', title: 'Chevrolet Corvette Z06 GT3.R water temp', description: 'Clean Corvette Z06 GT3.R water temperature readout.', category: 'cars', tags: [...TAGS, 'water', 'temperature', 'clean'], requires: ['waterTempC'], defaultSize: { w: 280, h: 140 }, render: (props) => <WaterWidget {...props} /> }

export const CORVETTEGT3R_WIDGETS: HifiWidgetModule[] = [
  cvDash,
  cvGear,
  cvSpeed,
  cvRevLights,
  cvRpmBar,
  cvFuel,
  cvTyrePress,
  cvLastLap,
  cvDelta,
  cvPosition,
  cvWater
]
