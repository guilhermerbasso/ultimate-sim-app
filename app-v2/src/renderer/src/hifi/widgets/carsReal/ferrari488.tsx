import { arc } from 'd3-shape'
import { type ReactElement } from 'react'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { C, CleanTile, FONT_BIG, FONT_LABEL, FONT_NUM, ShiftStrobe, atShiftPoint, condColor, fixed, frac, gearLabel, lapTime, legibleStroke, num, revFill, signed, tempColor } from '../kit'

const DASH_W = 1024
const DASH_H = 600
const RED = '#ff171d'
const DEEP_RED = '#d90000'
const YELLOW = '#ffd400'
const WHITE = '#f8f8f8'
const GREEN = '#48f01f'
const BLUE = '#1e63ff'
const DARK = '#010101'
const TAGS = ['ferrari', 'ferrari-488-challenge', 'challenge', 'car', 'ir'] as const

function rpmFraction(snapshot: HifiWidgetProps['snapshot']): number {
  const pct = num(snapshot?.shiftIndicatorPct ?? snapshot?.revLights?.pct)
  if (pct != null) return frac(pct, 0, 1)
  const rpm = num(snapshot?.rpm)
  const max = num(snapshot?.maxRpm)
  return rpm != null && max != null && max > 0 ? frac(rpm, 0, max) : 0
}

function rpmMissing(snapshot: HifiWidgetProps['snapshot']): boolean {
  return snapshot == null || (num(snapshot.rpm) == null && num(snapshot.shiftIndicatorPct) == null && num(snapshot.revLights?.pct) == null)
}

function lapShort(sec: number | undefined): string {
  const s = lapTime(sec)
  return s.startsWith('--') ? '--:--.-' : s.replace(/\.\d{3}$/, (m) => m.slice(0, 2))
}

function ledColor(i: number, count: number): string {
  const p = i / Math.max(1, count - 1)
  if (p >= 0.82) return BLUE
  if (p >= 0.66) return RED
  if (p >= 0.42) return YELLOW
  return GREEN
}

function GlowDefs({ id }: { id: string }): ReactElement {
  return (
    <defs>
      <filter id={`${id}-glow`} x="-90%" y="-90%" width="280%" height="280%">
        <feGaussianBlur stdDeviation="7" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id={`${id}-soft`} x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="2.5" />
      </filter>
    </defs>
  )
}

function ShiftLedRow({ snapshot, x, y, w, count = 12, id = 'f488-leds', r = 18 }: { snapshot: HifiWidgetProps['snapshot']; x: number; y: number; w: number; count?: number; id?: string; r?: number }): ReactElement {
  const f = rpmFraction(snapshot)
  const missing = rpmMissing(snapshot)
  const shift = atShiftPoint(f)
  const lit = shift ? count : missing ? 0 : Math.round(f * count)
  const gap = w / Math.max(1, count - 1)
  return (
    <g>
      <ShiftStrobe active={shift} />
      <GlowDefs id={id} />
      {Array.from({ length: count }, (_, i) => {
        const on = !missing && i < lit
        const color = revFill(ledColor(i, count), shift)
        const cx = x + i * gap
        return (
          <g key={i}>
            <circle cx={cx} cy={y} r={r + 14} fill={on ? color : 'transparent'} opacity={on ? 0.24 : 0} filter={`url(#${id}-glow)`} />
            <circle cx={cx} cy={y} r={r} fill={on ? color : '#101010'} stroke={on ? color : 'rgba(255,255,255,0.16)'} strokeWidth={2} opacity={on ? 1 : 0.5} filter={on ? `url(#${id}-glow)` : undefined} />
            <circle cx={cx - r * 0.24} cy={y - r * 0.28} r={r * 0.28} fill={on ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.08)'} />
          </g>
        )
      })}
    </g>
  )
}

function segArc(inner: number, outer: number, a0: number, a1: number): string {
  return arc()({
    innerRadius: inner,
    outerRadius: outer,
    startAngle: (a0 * Math.PI) / 180,
    endAngle: (a1 * Math.PI) / 180
  }) ?? ''
}

function CurvedRpmBar({ snapshot, cx, cy, id = 'f488-rpm', scale = true, compact = false }: { snapshot: HifiWidgetProps['snapshot']; cx: number; cy: number; id?: string; scale?: boolean; compact?: boolean }): ReactElement {
  const f = rpmFraction(snapshot)
  const missing = rpmMissing(snapshot)
  const shift = atShiftPoint(f)
  const cells = compact ? 28 : 34
  const lit = shift ? cells : missing ? 0 : Math.round(f * cells)
  const start = -112
  const sweep = 224
  const inner = compact ? 106 : 214
  const outer = compact ? 130 : 252
  const gap = 1.4
  return (
    <g transform={`translate(${cx},${cy})`}>
      <GlowDefs id={id} />
      <path d={segArc(inner - 9, outer + 8, start - 3, start + sweep + 3)} fill="none" stroke="rgba(255,255,255,0.88)" strokeWidth={compact ? 2 : 3} />
      {Array.from({ length: cells }, (_, i) => {
        const p = i / (cells - 1)
        const a0 = start + p * sweep
        const a1 = start + ((i + 1) / cells) * sweep - gap
        const color = revFill(p > 0.78 ? RED : p > 0.56 ? '#ff9e19' : p > 0.22 ? YELLOW : GREEN, shift)
        return <path key={i} d={segArc(inner, outer, a0, a1)} fill={i < lit ? color : '#111'} stroke={DARK} strokeWidth={1.5} opacity={i < lit ? 1 : 0.72} filter={i < lit && !compact ? `url(#${id}-glow)` : undefined} />
      })}
      {scale ? (
        <g>
          <text x={-180} y={98} fill={WHITE} fontFamily={FONT_NUM} fontWeight={900} fontSize={25} {...legibleStroke(25)}>0</text>
          <text x={176} y={98} fill={WHITE} fontFamily={FONT_NUM} fontWeight={900} fontSize={25} {...legibleStroke(25)}>10</text>
          <text x={0} y={67} textAnchor="middle" fill={WHITE} fontFamily={FONT_LABEL} fontWeight={900} fontSize={26} letterSpacing={1.5} {...legibleStroke(26)}>RPM x 1000</text>
          {Array.from({ length: 10 }, (_, i) => <circle key={i} cx={-86 + i * 19} cy={91} r={5.2} fill="rgba(255,255,255,0.68)" />)}
        </g>
      ) : null}
    </g>
  )
}

function FuelIcon({ color = RED }: { color?: string }): ReactElement {
  return <g fill="none" stroke={color} strokeWidth={5} strokeLinejoin="round" strokeLinecap="round"><path d="M4 4 h28 v52 H4 Z" fill={color} /><path d="M32 12 c15 6 15 18 15 31 c0 15 13 14 13 1 V29 c0 -8 -5 -14 -11 -18" /><path d="M44 10 l9 10" /></g>
}

function OilIcon({ color = RED }: { color?: string }): ReactElement {
  return <g fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round"><path d="M5 30 l30 15 l35 -24 l9 11 l-34 31 H10 Z" /><path d="M32 23 v-13 h18 v12" /><path d="M75 48 c10 9 10 16 0 20 c-10 -4 -10 -11 0 -20 Z" fill={color} /></g>
}

function WaterIcon({ color = RED }: { color?: string }): ReactElement {
  return <g fill="none" stroke={color} strokeWidth={5} strokeLinecap="round"><path d="M36 4 v48" /><path d="M28 4 h16 M30 17 h11 M30 31 h11 M30 45 h11" /><path d="M19 61 c8 -9 16 -9 24 0 c8 9 16 9 24 0" /><path d="M5 73 c8 -9 16 -9 24 0 c8 9 16 9 24 0 c8 -9 16 -9 24 0" /></g>
}

function BottomCell({ x, w, label, value, unit, icon, color = WHITE }: { x: number; w: number; label: string; value: string; unit?: string; icon: ReactElement; color?: string }): ReactElement {
  const valueX = x + 124
  const unitX = x + w - 46
  return (
    <g>
      <rect x={x} y={500} width={w} height={86} fill="rgba(0,0,0,0.84)" stroke={RED} strokeWidth={2} />
      <g transform={`translate(${x + 38},516) scale(0.72)`}>{icon}</g>
      <text x={valueX} y={534} fill={RED} fontFamily={FONT_LABEL} fontWeight={900} fontSize={25} letterSpacing={2} {...legibleStroke(25)}>{label}</text>
      <text x={valueX} y={572} fill={value === '—' ? C.dim : color} fontFamily={FONT_BIG} fontWeight={900} fontSize={42} {...legibleStroke(42)}>{value}</text>
      {unit ? <text x={unitX} y={571} textAnchor="end" fill={WHITE} fontFamily={FONT_LABEL} fontWeight={900} fontSize={27} {...legibleStroke(27)}>{unit}</text> : null}
    </g>
  )
}

function F488Dash({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const gear = num(snapshot?.gear)
  const speed = num(snapshot?.speedKmh)
  const fuel = num(snapshot?.fuelLiters)
  const oil = num(snapshot?.oilTempC)
  const water = num(snapshot?.waterTempC)
  const delta = num(snapshot?.deltaToBestSec)
  return (
    <CleanTile width={width ?? DASH_W} height={height ?? DASH_H}>
      <rect width={DASH_W} height={DASH_H} rx={36} fill={DARK} />
      <rect x={22} y={128} width={980} height={458} rx={24} fill="none" stroke={RED} strokeWidth={2.8} />
      <ShiftLedRow snapshot={snapshot} x={166} y={66} w={700} count={12} id="f488-dash-leds" r={17} />
      <path d="M24 500 H276 L322 376 C305 274 336 188 418 138 H294 L258 96 H62 C40 96 24 112 24 134 Z" fill="rgba(0,0,0,0.9)" stroke={RED} strokeWidth={2.5} />
      <path d="M1000 500 H748 L702 376 C719 274 688 188 606 138 H730 L766 96 H962 C984 96 1000 112 1000 134 Z" fill="rgba(0,0,0,0.9)" stroke={RED} strokeWidth={2.5} />
      <CurvedRpmBar snapshot={snapshot} cx={512} cy={358} id="f488-dash-rpm" />
      <text x={512} y={382} textAnchor="middle" fill={gear == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={900} fontSize={178} {...legibleStroke(178)}>{gearLabel(gear)}</text>
      <text x={58} y={226} fill={RED} fontFamily={FONT_LABEL} fontWeight={900} fontSize={39} letterSpacing={2} {...legibleStroke(39)}>SPD</text>
      <text x={54} y={356} fill={speed == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={900} fontSize={98} {...legibleStroke(98)}>{fixed(speed, 0)}</text>
      <text x={61} y={407} fill={WHITE} fontFamily={FONT_LABEL} fontWeight={900} fontSize={31} {...legibleStroke(31)}>km/h</text>
      <text x={898} y={226} textAnchor="middle" fill={RED} fontFamily={FONT_LABEL} fontWeight={900} fontSize={39} letterSpacing={2} {...legibleStroke(39)}>LAP</text>
      <text x={944} y={314} textAnchor="end" fill={snapshot?.lastLapTimeSec == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={900} fontSize={58} {...legibleStroke(58)}>{lapShort(num(snapshot?.lastLapTimeSec))}</text>
      <line x1={794} y1={352} x2={970} y2={352} stroke={RED} strokeWidth={3} />
      <text x={944} y={426} textAnchor="end" fill={condColor(delta, { positiveIsGood: false, deadzone: 0.01, good: '#25e86a', bad: RED, neutral: YELLOW })} fontFamily={FONT_BIG} fontWeight={900} fontSize={56} {...legibleStroke(56)}>{signed(delta, 2)}</text>
      <BottomCell x={24} w={318} label="FUEL" value={fixed(fuel, 0)} unit="L" icon={<FuelIcon />} />
      <BottomCell x={342} w={340} label="OIL" value={fixed(oil, 0)} unit="C" icon={<OilIcon />} color={tempColor(oil, 80, 115)} />
      <BottomCell x={682} w={318} label="H2O" value={fixed(water, 0)} unit="C" icon={<WaterIcon />} color={tempColor(water, 75, 105)} />
    </CleanTile>
  )
}

function GearWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 260
  const h = height ?? 220
  const gear = num(snapshot?.gear)
  return <CleanTile width={w} height={h}><text x={w / 2} y={h * 0.78} textAnchor="middle" fill={gear == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={900} fontSize={h * 0.82} {...legibleStroke(h * 0.82)}>{gearLabel(gear)}</text></CleanTile>
}

function SpeedWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 320
  const h = height ?? 160
  const speed = num(snapshot?.speedKmh)
  return <CleanTile width={w} height={h}><text x={w / 2} y={h * 0.62} textAnchor="middle" fill={speed == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={900} fontSize={h * 0.55} {...legibleStroke(h * 0.55)}>{fixed(speed, 0)}</text><text x={w / 2} y={h * 0.85} textAnchor="middle" fill={YELLOW} fontFamily={FONT_LABEL} fontWeight={900} fontSize={h * 0.17} {...legibleStroke(h * 0.17)}>km/h</text></CleanTile>
}

function RevLightsWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 760
  const h = height ?? 90
  return <CleanTile width={w} height={h}><ShiftLedRow snapshot={snapshot} x={44} y={h / 2} w={w - 88} count={12} id="f488-strip-leds" r={Math.min(18, h * 0.24)} /></CleanTile>
}

function RpmBarWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 360
  const h = height ?? 280
  return <CleanTile width={w} height={h}><CurvedRpmBar snapshot={snapshot} cx={w / 2} cy={h * 0.48} id="f488-rpm-widget" scale={false} compact /></CleanTile>
}

function SingleMetric({ width = 280, height = 140, label, value, unit, color = WHITE, icon }: { width?: number; height?: number; label: string; value: string; unit?: string; color?: string; icon?: ReactElement }): ReactElement {
  return (
    <CleanTile width={width} height={height}>
      {icon ? <g transform={`translate(${width * 0.08},${height * 0.42}) scale(${height / 185})`}>{icon}</g> : null}
      <text x={width / 2} y={height * 0.32} textAnchor="middle" fill={RED} fontFamily={FONT_LABEL} fontWeight={900} fontSize={height * 0.23} letterSpacing={2} {...legibleStroke(height * 0.23)}>{label}</text>
      <text x={width / 2} y={height * 0.76} textAnchor="middle" fill={value === '—' || value.startsWith('--') ? C.dim : color} fontFamily={FONT_BIG} fontWeight={900} fontSize={height * 0.42} {...legibleStroke(height * 0.42)}>{value}{unit ? <tspan fill={YELLOW} fontFamily={FONT_LABEL} fontSize={height * 0.22}> {unit}</tspan> : null}</text>
    </CleanTile>
  )
}

function FuelWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  return <SingleMetric width={width ?? 260} height={height ?? 140} label="FUEL" value={fixed(num(snapshot?.fuelLiters), 0)} unit="L" icon={<FuelIcon />} />
}

function OilWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const v = num(snapshot?.oilTempC)
  return <SingleMetric width={width ?? 260} height={height ?? 140} label="OIL" value={fixed(v, 0)} unit="C" color={tempColor(v, 80, 115)} icon={<OilIcon />} />
}

function WaterWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const v = num(snapshot?.waterTempC)
  return <SingleMetric width={width ?? 260} height={height ?? 140} label="H2O" value={fixed(v, 0)} unit="C" color={tempColor(v, 75, 105)} icon={<WaterIcon />} />
}

function LastLapWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  return <SingleMetric width={width ?? 340} height={height ?? 140} label="LAP" value={lapShort(num(snapshot?.lastLapTimeSec))} />
}

function DeltaWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const delta = num(snapshot?.deltaToBestSec)
  return <SingleMetric width={width ?? 280} height={height ?? 140} label="DELTA" value={signed(delta, 2)} color={condColor(delta, { positiveIsGood: false, deadzone: 0.01, good: '#22e06a', bad: DEEP_RED, neutral: YELLOW })} />
}

function PositionWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const pos = num(snapshot?.position)
  const total = num(snapshot?.totalCars)
  const value = pos == null ? '—' : `P${Math.trunc(pos)}${total == null ? '' : ` / ${Math.trunc(total)}`}`
  return <SingleMetric width={width ?? 280} height={height ?? 140} label="POS" value={value} color={YELLOW} />
}

const dashRequires: HifiWidgetModule['requires'] = ['gear', 'speedKmh', 'rpm', 'maxRpm', 'shiftIndicatorPct', 'fuelLiters', 'oilTempC', 'waterTempC', 'lastLapTimeSec', 'deltaToBestSec', 'position', 'totalCars']

export const f488Dash: HifiWidgetModule = { id: 'f488Dash', title: 'Ferrari 488 Challenge dash', description: 'Full Ferrari 488 Challenge single-make cluster with top shift LEDs, curved RPM bar, dominant gear, speed, lap, delta and bottom fuel/oil/water band.', category: 'cars', tags: [...TAGS, 'dashboard', 'cluster', 'shift-lights', 'rpm', 'gear', 'speed', 'fuel', 'oil', 'water', 'lap', 'delta'], requires: dashRequires, defaultSize: { w: DASH_W, h: DASH_H }, render: (props) => <F488Dash {...props} /> }
export const f488Gear: HifiWidgetModule = { id: 'f488Gear', title: 'Ferrari 488 Challenge gear', description: 'Clean Ferrari 488 Challenge dominant gear digit.', category: 'cars', tags: [...TAGS, 'gear', 'clean'], requires: ['gear'], defaultSize: { w: 260, h: 220 }, render: (props) => <GearWidget {...props} /> }
export const f488Speed: HifiWidgetModule = { id: 'f488Speed', title: 'Ferrari 488 Challenge speed', description: 'Clean Ferrari 488 Challenge speed readout in km/h.', category: 'cars', tags: [...TAGS, 'speed', 'clean'], requires: ['speedKmh'], defaultSize: { w: 320, h: 160 }, render: (props) => <SpeedWidget {...props} /> }
export const f488RevLights: HifiWidgetModule = { id: 'f488RevLights', title: 'Ferrari 488 Challenge rev lights', description: 'Clean Ferrari 488 Challenge top shift LED row with shared blue shift strobe.', category: 'cars', tags: [...TAGS, 'rev-lights', 'shift-lights', 'clean'], requires: ['shiftIndicatorPct', 'rpm', 'maxRpm'], defaultSize: { w: 760, h: 90 }, render: (props) => <RevLightsWidget {...props} /> }
export const f488RpmBar: HifiWidgetModule = { id: 'f488RpmBar', title: 'Ferrari 488 Challenge RPM bar', description: 'Clean Ferrari 488 Challenge curved RPM bar.', category: 'cars', tags: [...TAGS, 'rpm', 'bar', 'curved', 'clean'], requires: ['rpm', 'maxRpm', 'shiftIndicatorPct'], defaultSize: { w: 360, h: 280 }, render: (props) => <RpmBarWidget {...props} /> }
export const f488Fuel: HifiWidgetModule = { id: 'f488Fuel', title: 'Ferrari 488 Challenge fuel', description: 'Clean Ferrari 488 Challenge fuel liters readout.', category: 'cars', tags: [...TAGS, 'fuel', 'clean'], requires: ['fuelLiters'], defaultSize: { w: 260, h: 140 }, render: (props) => <FuelWidget {...props} /> }
export const f488Oil: HifiWidgetModule = { id: 'f488Oil', title: 'Ferrari 488 Challenge oil temp', description: 'Clean Ferrari 488 Challenge oil temperature readout.', category: 'cars', tags: [...TAGS, 'oil', 'temperature', 'clean'], requires: ['oilTempC'], defaultSize: { w: 260, h: 140 }, render: (props) => <OilWidget {...props} /> }
export const f488Water: HifiWidgetModule = { id: 'f488Water', title: 'Ferrari 488 Challenge water temp', description: 'Clean Ferrari 488 Challenge water temperature readout.', category: 'cars', tags: [...TAGS, 'water', 'h2o', 'temperature', 'clean'], requires: ['waterTempC'], defaultSize: { w: 260, h: 140 }, render: (props) => <WaterWidget {...props} /> }
export const f488LastLap: HifiWidgetModule = { id: 'f488LastLap', title: 'Ferrari 488 Challenge last lap', description: 'Clean Ferrari 488 Challenge last-lap time readout.', category: 'cars', tags: [...TAGS, 'last-lap', 'lap-time', 'clean'], requires: ['lastLapTimeSec'], defaultSize: { w: 340, h: 140 }, render: (props) => <LastLapWidget {...props} /> }
export const f488Delta: HifiWidgetModule = { id: 'f488Delta', title: 'Ferrari 488 Challenge delta', description: 'Clean Ferrari 488 Challenge delta-to-best readout colored by gain or loss.', category: 'cars', tags: [...TAGS, 'delta', 'delta-to-best', 'clean'], requires: ['deltaToBestSec'], defaultSize: { w: 280, h: 140 }, render: (props) => <DeltaWidget {...props} /> }
export const f488Position: HifiWidgetModule = { id: 'f488Position', title: 'Ferrari 488 Challenge position', description: 'Clean Ferrari 488 Challenge race position readout.', category: 'cars', tags: [...TAGS, 'position', 'clean'], requires: ['position', 'totalCars'], defaultSize: { w: 280, h: 140 }, render: (props) => <PositionWidget {...props} /> }

export const FERRARI488_WIDGETS: HifiWidgetModule[] = [
  f488Dash,
  f488Gear,
  f488Speed,
  f488RevLights,
  f488RpmBar,
  f488Fuel,
  f488Oil,
  f488Water,
  f488LastLap,
  f488Delta,
  f488Position
]
