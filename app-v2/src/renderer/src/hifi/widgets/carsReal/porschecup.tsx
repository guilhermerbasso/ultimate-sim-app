import { type ReactElement } from 'react'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { C, CleanTile, FONT_BIG, FONT_LABEL, FONT_NUM, ShiftStrobe, atShiftPoint, condColor, fixed, frac, gearLabel, lapTime, legibleStroke, num, revFill, signed } from '../kit'
import { formatMeasurement } from '../../../../../shared/units'

const DASH_W = 1024
const DASH_H = 600
const WHITE = '#F8F8F8'
const RED = '#FF1010'
const GREEN = '#2ACB34'
const YELLOW = '#FFD02A'
const DARK = '#010101'
const RECESS = '#161616'
const TAGS = ['porsche', 'porsche-911-gt3-cup', 'gt3-cup', 'car', 'ir'] as const

function shiftFrac(snapshot: HifiWidgetProps['snapshot']): { f: number; missing: boolean; flash: boolean } {
  const pct = num(snapshot?.shiftIndicatorPct)
  if (pct != null) return { f: frac(pct, 0, 1), missing: false, flash: pct >= 0.96 || snapshot?.revLights?.blink === true }
  const rpm = num(snapshot?.rpm)
  const max = num(snapshot?.maxRpm)
  if (rpm != null && max != null && max > 0) return { f: frac(rpm, 0, max), missing: false, flash: rpm >= max * 0.96 }
  return { f: 0, missing: true, flash: false }
}

function segmentColor(i: number, count: number): string {
  const p = i / Math.max(1, count - 1)
  if (p >= 0.74) return RED
  if (p >= 0.58) return YELLOW
  return GREEN
}

function SegmentRevBar({
  snapshot,
  x,
  y,
  w,
  h,
  count = 20,
  dim = RECESS
}: {
  snapshot: HifiWidgetProps['snapshot']
  x: number
  y: number
  w: number
  h: number
  count?: number
  dim?: string
}): ReactElement {
  const { f, missing, flash } = shiftFrac(snapshot)
  const shift = atShiftPoint(f)
  const lit = shift ? count : missing ? 0 : Math.round(f * count)
  const gap = Math.max(3, w * 0.004)
  const cell = (w - gap * (count - 1)) / count
  return (
    <g>
      <ShiftStrobe active={shift} />
      {Array.from({ length: count }, (_, i) => {
        const limiter = flash && i >= count - 3
        const on = !missing && (i < lit || limiter)
        const color = revFill(segmentColor(i, count), shift)
        return (
          <rect
            key={i}
            x={x + i * (cell + gap)}
            y={y}
            width={cell}
            height={h}
            fill={on ? color : dim}
            opacity={on ? 1 : 0.72}
          />
        )
      })}
    </g>
  )
}

function compactLap(sec: number | undefined): string {
  const value = lapTime(sec)
  return value.startsWith('--') ? '—' : value.replace(/\.\d{3}$/, (m) => m.slice(0, 2))
}

function PcupDash({ snapshot, width, height, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
  const gear = num(snapshot?.gear)
  const speed = num(snapshot?.speedKmh)
  const fuel = num(snapshot?.fuelLiters)
  const oil = num(snapshot?.oilTempC)
  const speedReading = formatMeasurement(speed, 'speed-kmh', unitSystem, { decimals: 0 })
  const fuelReading = formatMeasurement(fuel, 'fuel-volume-l', unitSystem, { decimals: 1 })
  const oilReading = formatMeasurement(oil, 'temperature-c', unitSystem, { decimals: 0 })
  const lap = compactLap(num(snapshot?.lastLapTimeSec))
  const delta = num(snapshot?.deltaToBestSec)
  return (
    <CleanTile width={width ?? DASH_W} height={height ?? DASH_H}>
      <rect width={DASH_W} height={DASH_H} fill={DARK} />
      <SegmentRevBar snapshot={snapshot} x={40} y={30} w={944} h={52} count={20} dim="#080808" />
      <text x={512} y={360} textAnchor="middle" fill={gear == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={400} fontSize={270} {...legibleStroke(270)}>{gearLabel(gear)}</text>
      <text x={512} y={458} textAnchor="middle" fill={speed == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={400} fontSize={84} {...legibleStroke(84)}>{speedReading.display}</text>
      <text x={512} y={492} textAnchor="middle" fill={WHITE} fontFamily={FONT_LABEL} fontWeight={600} fontSize={27} letterSpacing={1} {...legibleStroke(27)}>{speedReading.unit}</text>
      <rect x={18} y={510} width={988} height={1.8} fill={WHITE} opacity={0.95} />
      <text x={46} y={558} fill={WHITE} fontFamily={FONT_LABEL} fontWeight={700} fontSize={38} letterSpacing={2} {...legibleStroke(38)}>FUEL</text>
      <text x={230} y={558} textAnchor="end" fill={fuel == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={400} fontSize={44} {...legibleStroke(44)}>{fuelReading.display}</text>
      <text x={256} y={558} fill={WHITE} fontFamily={FONT_LABEL} fontWeight={600} fontSize={28} {...legibleStroke(28)}>{fuelReading.unit}</text>
      <text x={46} y={596} fill={WHITE} fontFamily={FONT_LABEL} fontWeight={700} fontSize={38} letterSpacing={2} {...legibleStroke(38)}>OIL</text>
      <text x={230} y={596} textAnchor="end" fill={oil == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={400} fontSize={44} {...legibleStroke(44)}>{oilReading.display}</text>
      <text x={256} y={596} fill={WHITE} fontFamily={FONT_LABEL} fontWeight={600} fontSize={28} {...legibleStroke(28)}>{oilReading.unit}</text>
      <text x={790} y={552} textAnchor="end" fill={WHITE} fontFamily={FONT_LABEL} fontWeight={700} fontSize={38} letterSpacing={2} {...legibleStroke(38)}>LAP</text>
      <text x={972} y={552} textAnchor="end" fill={lap === '—' ? C.dim : WHITE} fontFamily={FONT_NUM} fontWeight={400} fontSize={38} {...legibleStroke(38)}>{lap}</text>
      <text x={973} y={599} textAnchor="end" fill={delta == null ? C.dim : RED} fontFamily={FONT_BIG} fontWeight={400} fontSize={54} {...legibleStroke(54)}>{signed(delta, 2)}</text>
    </CleanTile>
  )
}

function GearWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const gear = num(snapshot?.gear)
  const w = width ?? 260
  const h = height ?? 220
  return <CleanTile width={w} height={h}><text x={w / 2} y={h * 0.8} textAnchor="middle" fill={gear == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={400} fontSize={h * 0.88} {...legibleStroke(h * 0.88)}>{gearLabel(gear)}</text></CleanTile>
}

function SpeedWidget({ snapshot, width, height, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
  const speed = num(snapshot?.speedKmh)
  const reading = formatMeasurement(speed, 'speed-kmh', unitSystem, { decimals: 0 })
  const w = width ?? 340
  const h = height ?? 150
  return <CleanTile width={w} height={h}><text x={w / 2} y={h * 0.64} textAnchor="middle" fill={speed == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={400} fontSize={h * 0.48} {...legibleStroke(h * 0.48)}>{reading.display}</text><text x={w / 2} y={h * 0.88} textAnchor="middle" fill={WHITE} fontFamily={FONT_LABEL} fontWeight={600} fontSize={h * 0.2} {...legibleStroke(h * 0.2)}>{reading.unit}</text></CleanTile>
}

function RevBarWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 960
  const h = height ?? 90
  return <CleanTile width={w} height={h}><SegmentRevBar snapshot={snapshot} x={0} y={h * 0.22} w={w} h={h * 0.56} count={20} /></CleanTile>
}

function RpmWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const rpm = num(snapshot?.rpm)
  const w = width ?? 300
  const h = height ?? 120
  return <CleanTile width={w} height={h}><text x={w / 2} y={h * 0.68} textAnchor="middle" fill={rpm == null ? C.dim : WHITE} fontFamily={FONT_NUM} fontWeight={400} fontSize={h * 0.42} {...legibleStroke(h * 0.42)}>{fixed(rpm)}</text></CleanTile>
}

function LabelValue({ width = 260, height = 130, label, value, unit, color = WHITE }: { width?: number; height?: number; label: string; value: string; unit?: string; color?: string }): ReactElement {
  return (
    <CleanTile width={width} height={height}>
      <text x={width * 0.1} y={height * 0.46} fill={WHITE} fontFamily={FONT_LABEL} fontWeight={700} fontSize={height * 0.3} letterSpacing={2} {...legibleStroke(height * 0.3)}>{label}</text>
      <text x={width * 0.9} y={height * 0.72} textAnchor="end" fill={value === '—' ? C.dim : color} fontFamily={FONT_BIG} fontWeight={400} fontSize={height * 0.4} {...legibleStroke(height * 0.4)}>{value}{unit ? <tspan fill={WHITE} fontFamily={FONT_LABEL} fontSize={height * 0.25}> {unit}</tspan> : null}</text>
    </CleanTile>
  )
}

function FuelWidget(props: HifiWidgetProps): ReactElement {
  const reading = formatMeasurement(num(props.snapshot?.fuelLiters), 'fuel-volume-l', props.unitSystem ?? 'metric', { decimals: 1 })
  return <LabelValue width={props.width ?? 260} height={props.height ?? 130} label="FUEL" value={reading.display} unit={reading.unit} />
}
function OilWidget(props: HifiWidgetProps): ReactElement {
  const reading = formatMeasurement(num(props.snapshot?.oilTempC), 'temperature-c', props.unitSystem ?? 'metric', { decimals: 0 })
  return <LabelValue width={props.width ?? 260} height={props.height ?? 130} label="OIL" value={reading.display} unit={reading.unit} />
}
function WaterWidget(props: HifiWidgetProps): ReactElement {
  const reading = formatMeasurement(num(props.snapshot?.waterTempC), 'temperature-c', props.unitSystem ?? 'metric', { decimals: 0 })
  return <LabelValue width={props.width ?? 300} height={props.height ?? 130} label="WATER" value={reading.display} unit={reading.unit} />
}

function LastLapWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 360
  const h = height ?? 130
  const value = compactLap(num(snapshot?.lastLapTimeSec))
  return <CleanTile width={w} height={h}><text x={w * 0.14} y={h * 0.58} fill={WHITE} fontFamily={FONT_LABEL} fontWeight={700} fontSize={h * 0.32} letterSpacing={2} {...legibleStroke(h * 0.32)}>LAP</text><text x={w * 0.94} y={h * 0.7} textAnchor="end" fill={value === '—' ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={400} fontSize={h * 0.38} {...legibleStroke(h * 0.38)}>{value}</text></CleanTile>
}

function DeltaWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const delta = num(snapshot?.deltaToBestSec)
  const w = width ?? 260
  const h = height ?? 120
  return <CleanTile width={w} height={h}><text x={w / 2} y={h * 0.72} textAnchor="middle" fill={condColor(delta, { positiveIsGood: false, deadzone: 0.01, good: '#35F06B', bad: RED, neutral: WHITE })} fontFamily={FONT_BIG} fontWeight={400} fontSize={h * 0.52} {...legibleStroke(h * 0.52)}>{signed(delta, 2)}</text></CleanTile>
}

function PositionWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const position = num(snapshot?.position)
  const total = num(snapshot?.totalCars)
  const w = width ?? 260
  const h = height ?? 130
  return <CleanTile width={w} height={h}><text x={w / 2} y={h * 0.68} textAnchor="middle" fill={position == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={400} fontSize={h * 0.45} {...legibleStroke(h * 0.45)}>{position == null ? 'P—' : `P${Math.trunc(position)}`}<tspan fill={total == null ? C.dim : WHITE} fontFamily={FONT_LABEL} fontSize={h * 0.28}> / {fixed(total)}</tspan></text></CleanTile>
}

const dashRequires: HifiWidgetModule['requires'] = ['gear', 'speedKmh', 'rpm', 'maxRpm', 'shiftIndicatorPct', 'fuelLiters', 'oilTempC', 'lastLapTimeSec', 'deltaToBestSec']

export const pcupDash: HifiWidgetModule = { id: 'pcupDash', title: 'Porsche 911 GT3 Cup (992) dash', description: 'Full Porsche 911 GT3 Cup (992) Cosworth ICD-style cluster with segmented rev bar, gear, speed, fuel, oil, lap and delta.', category: 'cars', tags: [...TAGS, 'dashboard', 'cluster', 'cosworth-icd', 'rev-bar', 'gear', 'speed', 'fuel', 'oil', 'lap', 'delta'], requires: dashRequires, defaultSize: { w: DASH_W, h: DASH_H }, render: (props) => <PcupDash {...props} /> }
export const pcupGear: HifiWidgetModule = { id: 'pcupGear', title: 'Porsche 911 GT3 Cup (992) gear', description: 'Minimal thin white gear readout for the Porsche 911 GT3 Cup (992).', category: 'cars', tags: [...TAGS, 'gear', 'clean'], requires: ['gear'], defaultSize: { w: 260, h: 220 }, render: (props) => <GearWidget {...props} /> }
export const pcupSpeed: HifiWidgetModule = { id: 'pcupSpeed', title: 'Porsche 911 GT3 Cup (992) speed', description: 'Minimal Porsche 911 GT3 Cup (992) speed readout in km/h.', category: 'cars', tags: [...TAGS, 'speed', 'clean'], requires: ['speedKmh'], defaultSize: { w: 340, h: 150 }, render: (props) => <SpeedWidget {...props} /> }
export const pcupRevBar: HifiWidgetModule = { id: 'pcupRevBar', title: 'Porsche 911 GT3 Cup (992) rev bar', description: 'Straight segmented Porsche 911 GT3 Cup (992) Cosworth-style green-yellow-red rev bar.', category: 'cars', tags: [...TAGS, 'rev-bar', 'shift-lights', 'segmented', 'clean'], requires: ['shiftIndicatorPct', 'rpm', 'maxRpm'], defaultSize: { w: 960, h: 90 }, render: (props) => <RevBarWidget {...props} /> }
export const pcupRpm: HifiWidgetModule = { id: 'pcupRpm', title: 'Porsche 911 GT3 Cup (992) RPM', description: 'Thin numeric Porsche 911 GT3 Cup (992) RPM readout.', category: 'cars', tags: [...TAGS, 'rpm', 'numeric', 'clean'], requires: ['rpm'], defaultSize: { w: 300, h: 120 }, render: (props) => <RpmWidget {...props} /> }
export const pcupFuel: HifiWidgetModule = { id: 'pcupFuel', title: 'Porsche 911 GT3 Cup (992) fuel', description: 'Minimal Porsche 911 GT3 Cup (992) fuel liters readout.', category: 'cars', tags: [...TAGS, 'fuel', 'clean'], requires: ['fuelLiters'], defaultSize: { w: 260, h: 130 }, render: (props) => <FuelWidget {...props} /> }
export const pcupOil: HifiWidgetModule = { id: 'pcupOil', title: 'Porsche 911 GT3 Cup (992) oil', description: 'Minimal Porsche 911 GT3 Cup (992) oil temperature readout.', category: 'cars', tags: [...TAGS, 'oil', 'temperature', 'clean'], requires: ['oilTempC'], defaultSize: { w: 260, h: 130 }, render: (props) => <OilWidget {...props} /> }
export const pcupWater: HifiWidgetModule = { id: 'pcupWater', title: 'Porsche 911 GT3 Cup (992) water', description: 'Minimal Porsche 911 GT3 Cup (992) water temperature readout.', category: 'cars', tags: [...TAGS, 'water', 'temperature', 'clean'], requires: ['waterTempC'], defaultSize: { w: 300, h: 130 }, render: (props) => <WaterWidget {...props} /> }
export const pcupLastLap: HifiWidgetModule = { id: 'pcupLastLap', title: 'Porsche 911 GT3 Cup (992) last lap', description: 'Minimal Porsche 911 GT3 Cup (992) last-lap time readout.', category: 'cars', tags: [...TAGS, 'last-lap', 'lap-time', 'clean'], requires: ['lastLapTimeSec'], defaultSize: { w: 360, h: 130 }, render: (props) => <LastLapWidget {...props} /> }
export const pcupDelta: HifiWidgetModule = { id: 'pcupDelta', title: 'Porsche 911 GT3 Cup (992) delta', description: 'Minimal Porsche 911 GT3 Cup (992) delta-to-best readout colored by gain or loss.', category: 'cars', tags: [...TAGS, 'delta', 'delta-to-best', 'clean'], requires: ['deltaToBestSec'], defaultSize: { w: 260, h: 120 }, render: (props) => <DeltaWidget {...props} /> }
export const pcupPosition: HifiWidgetModule = { id: 'pcupPosition', title: 'Porsche 911 GT3 Cup (992) position', description: 'Minimal Porsche 911 GT3 Cup (992) race-position readout.', category: 'cars', tags: [...TAGS, 'position', 'race-position', 'clean'], requires: ['position', 'totalCars'], defaultSize: { w: 260, h: 130 }, render: (props) => <PositionWidget {...props} /> }

export const PORSCHECUP_WIDGETS: HifiWidgetModule[] = [
  pcupDash,
  pcupGear,
  pcupSpeed,
  pcupRevBar,
  pcupRpm,
  pcupFuel,
  pcupOil,
  pcupWater,
  pcupLastLap,
  pcupDelta,
  pcupPosition
]
