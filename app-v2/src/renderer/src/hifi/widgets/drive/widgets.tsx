import { type ReactElement } from 'react'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { C, CleanTile, FONT_BIG, FONT_LABEL, FONT_NUM, GaugeArc, Hairline, fixed, frac, gearLabel, legibleStroke, num } from '../kit'
import { ShiftStrobe, atShiftPoint, resolveRevLightPct, revFill, revLightRowLayout } from '../../../lib/rev-lights'
import { formatMeasurement } from '../../../../../shared/units'

const W = 420
const H = 286
const CYAN = '#19c9ff'
const GREEN = '#28dd4b'
const YELLOW = '#ffd32d'
const RED = '#ff2026'
const WHITE = '#f4f5f7'

function valueColor(value: number | undefined, color = WHITE): string {
  return value == null ? C.dim : color
}

function driveGearLabel(gear: number | undefined): string {
  return gear == null ? '?' : gearLabel(gear)
}

function rpmFraction(rpm: number | undefined, maxRpm: number | undefined): number {
  // Mechanical tach gauge only; every shift/rev-light fill uses shiftFraction().
  const max = maxRpm != null && maxRpm > 0 ? maxRpm : undefined
  return max != null && rpm != null ? frac(rpm, 0, max) : 0
}

function rpmColor(f: number, missing: boolean): string {
  if (missing) return C.dim
  if (f < 0.62) return CYAN
  if (f < 0.78) return GREEN
  if (f < 0.9) return YELLOW
  return RED
}

function shiftFraction(snapshot: HifiWidgetProps['snapshot']): { f: number; missing: boolean } {
  const rpm = num(snapshot?.rpm)
  const maxRpm = num(snapshot?.maxRpm)
  const hasSource =
    num(snapshot?.shiftIndicatorPct) != null ||
    num(snapshot?.revLights?.pct) != null ||
    (rpm != null && maxRpm != null && maxRpm > 0)
  return { f: resolveRevLightPct(snapshot), missing: !hasSource }
}

function SpeedWidget({ snapshot, width, height, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
  const speed = formatMeasurement(num(snapshot?.speedKmh), 'speed-kmh', unitSystem, { decimals: 0 })
  return (
    <CleanTile width={width ?? W} height={height ?? H}>
      <text x="50%" y="53%" textAnchor="middle" dominantBaseline="middle" fill={valueColor(speed.value)} fontFamily={FONT_BIG} fontSize={112} fontWeight={900} letterSpacing={-5} {...legibleStroke(112)}>
        {speed.display}
      </text>
      <text x="50%" y={224} textAnchor="middle" fill={speed.value == null ? C.dim : CYAN} fontFamily={FONT_LABEL} fontSize={34} fontWeight={700} {...legibleStroke(34)}>
        {speed.unit}
      </text>
    </CleanTile>
  )
}

function RpmTicks({ rpm, maxRpm, cx, cy, radius }: { rpm: number | undefined; maxRpm: number | undefined; cx: number; cy: number; radius: number }): ReactElement {
  const max = maxRpm != null && maxRpm > 0 ? maxRpm : 16000
  const current = rpm ?? -1
  const ticks = Array.from({ length: 61 }, (_, i) => {
    const pct = i / 60
    const rpmAtTick = pct * max
    const angle = (-220 + pct * 280) * (Math.PI / 180)
    const major = i % 10 === 0
    const r1 = radius - (major ? 24 : 15)
    const r2 = radius - 4
    const x1 = cx + Math.cos(angle) * r1
    const y1 = cy + Math.sin(angle) * r1
    const x2 = cx + Math.cos(angle) * r2
    const y2 = cy + Math.sin(angle) * r2
    const color = rpmAtTick <= current ? rpmColor(pct, false) : pct > 0.84 ? RED : pct > 0.72 ? YELLOW : CYAN
    return <path key={i} d={`M${x1} ${y1} L${x2} ${y2}`} stroke={color} strokeWidth={major ? 4 : 2.2} opacity={rpmAtTick <= current ? 1 : 0.62} />
  })
  return <g>{ticks}</g>
}

function RpmWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const rpm = num(snapshot?.rpm)
  const maxRpm = num(snapshot?.maxRpm)
  const f = rpmFraction(rpm, maxRpm)
  return (
    <CleanTile width={width ?? W} height={height ?? H}>
      <GaugeArc cx={210} cy={154} r={86} thickness={12} f={f} color={rpmColor(f, rpm == null)} />
      <RpmTicks rpm={rpm} maxRpm={maxRpm} cx={210} cy={154} radius={124} />
      <circle cx={210} cy={154} r={59} fill="rgba(0,0,0,0.22)" stroke="rgba(255,255,255,0.10)" />
      <text x={210} y={165} textAnchor="middle" fill={valueColor(rpm)} fontFamily={FONT_NUM} fontSize={42} fontWeight={900} letterSpacing={-1} {...legibleStroke(42)}>
        {fixed(rpm)}
      </text>
    </CleanTile>
  )
}

function SegmentedRpmBar({ f, x, y, w, h, missing, shift }: { f: number; x: number; y: number; w: number; h: number; missing: boolean; shift: boolean }): ReactElement {
  const count = 20
  const layout = revLightRowLayout(w, h, count, { gap: 5 })
  const lit = shift ? layout.count : Math.round(frac(f, 0, 1) * layout.count)
  return (
    <g>
      <ShiftStrobe active={shift} />
      {Array.from({ length: layout.count }, (_, i) => {
        const pct = i / (layout.count - 1)
        const color = pct < 0.55 ? GREEN : pct < 0.78 ? YELLOW : RED
        const on = shift || (i < lit && !missing)
        return <rect key={i} x={x + layout.positions[i]} y={y + layout.y} width={layout.ledWidth} height={layout.ledHeight} rx={Math.min(5, layout.ledHeight / 2)} fill={on ? revFill(color, shift) : C.recess} opacity={on ? 1 : 0.42} />
      })}
    </g>
  )
}

function RpmBarWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const { f, missing } = shiftFraction(snapshot)
  const shift = atShiftPoint(f, snapshot?.revLights?.blink)
  const w = width ?? REV_WIDE_W
  const h = height ?? REV_WIDE_H
  const barH = Math.max(6, h * 0.62)
  return (
    <CleanTile width={w} height={h}>
      <SegmentedRpmBar f={f} x={0} y={(h - barH) / 2} w={w} h={barH} missing={missing} shift={shift} />
    </CleanTile>
  )
}

function GearWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const gear = num(snapshot?.gear)
  const { f } = shiftFraction(snapshot)
  const color = gear == null ? C.dim : rpmColor(f, false)
  return (
    <CleanTile width={width ?? W} height={height ?? H}>
      <text x="50%" y="53%" textAnchor="middle" dominantBaseline="middle" fill={color} fontFamily={FONT_BIG} fontSize={184} fontWeight={900} {...legibleStroke(184)}>
        {driveGearLabel(gear)}
      </text>
    </CleanTile>
  )
}

function RevLedStrip({ f, missing, shift, width, height }: { f: number; missing: boolean; shift: boolean; width: number; height: number }): ReactElement {
  const count = 16
  const layout = revLightRowLayout(width, height, count, {
    gap: Math.max(2, Math.round(width / count / 12)),
    heightRatio: 0.72,
    minLedHeight: Math.min(6, Math.max(1, height))
  })
  const lit = shift ? layout.count : Math.round(frac(f, 0, 1) * layout.count)
  return (
    <g>
      <ShiftStrobe active={shift} />
      {Array.from({ length: layout.count }, (_, i) => {
        const pct = i / (layout.count - 1)
        const color = pct < 0.5 ? GREEN : pct < 0.75 ? YELLOW : RED
        const on = shift || (i < lit && !missing)
        return (
          <g key={i}>
            <rect x={layout.positions[i]} y={layout.y} width={layout.ledWidth} height={layout.ledHeight} rx={Math.min(4, layout.ledHeight / 2)} fill={on ? revFill(color, shift) : C.recess} opacity={on ? 1 : 0.45} />
            {on ? <rect x={layout.positions[i] + 3} y={layout.y + Math.min(4, layout.ledHeight * 0.18)} width={Math.max(0, layout.ledWidth - 6)} height={Math.max(1, layout.ledHeight * 0.18)} rx={2} fill="rgba(255,255,255,0.34)" /> : null}
          </g>
        )
      })}
    </g>
  )
}

function RevLightsWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const { f, missing } = shiftFraction(snapshot)
  const shift = atShiftPoint(f, snapshot?.revLights?.blink)
  const w = width ?? REV_WIDE_W
  const h = height ?? REV_WIDE_H
  return (
    <CleanTile width={w} height={h}>
      <RevLedStrip f={f} missing={missing} shift={shift} width={w} height={h} />
    </CleanTile>
  )
}

function SpeedGearWidget({ snapshot, width, height, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
  const speed = formatMeasurement(num(snapshot?.speedKmh), 'speed-kmh', unitSystem, { decimals: 0 })
  const gear = num(snapshot?.gear)
  return (
    <CleanTile width={width ?? W} height={height ?? H}>
      <text x={142} y={157} textAnchor="middle" fill={valueColor(speed.value)} fontFamily={FONT_BIG} fontSize={82} fontWeight={900} letterSpacing={-4} {...legibleStroke(82)}>
        {speed.display}
      </text>
      <text x={142} y={199} textAnchor="middle" fill={speed.value == null ? C.dim : CYAN} fontFamily={FONT_LABEL} fontSize={28} fontWeight={700} {...legibleStroke(28)}>
        {speed.unit}
      </text>
      <Hairline x={268} y={62} len={172} vertical opacity={0.22} />
      <text x={336} y={166} textAnchor="middle" fill={gear == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontSize={96} fontWeight={900} {...legibleStroke(96)}>
        {driveGearLabel(gear)}
      </text>
    </CleanTile>
  )
}

const REV_WIDE_W = 960
const REV_WIDE_H = 90
const REV_MUSTANG_W = 520
const REV_MUSTANG_H = 90
const ORANGE = '#ff7a00'

function revRampColor(pct: number): string {
  if (pct < 0.32) return GREEN
  if (pct < 0.58) return YELLOW
  if (pct < 0.75) return '#ffb020'
  if (pct < 0.88) return ORANGE
  return RED
}

function RevlightsGradientWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const { f, missing } = shiftFraction(snapshot)
  const shift = atShiftPoint(f, snapshot?.revLights?.blink)
  const w = width ?? REV_WIDE_W
  const h = height ?? REV_WIDE_H
  const x = 0
  const barW = w
  const barH = Math.max(1, h * 0.62)
  const y = (h - barH) / 2
  const litW = shift ? barW : missing ? 0 : barW * f
  return (
    <CleanTile width={w} height={h}>
      <defs>
        <linearGradient id="drive-revlights-gradient-fill" x1={x} x2={x + barW} y1="0" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#12ff00" />
          <stop offset="42%" stopColor="#f8ff00" />
          <stop offset="68%" stopColor={ORANGE} />
          <stop offset="100%" stopColor={RED} />
        </linearGradient>
        <clipPath id="drive-revlights-gradient-clip">
          <rect x={x} y={y} width={barW} height={barH} rx={barH / 2} />
        </clipPath>
        <filter id="drive-revlights-gradient-glow" x="-10%" y="-120%" width="120%" height="340%">
          <feGaussianBlur stdDeviation="7" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect x={x} y={y} width={barW} height={barH} rx={barH / 2} fill={C.recess} opacity={0.5} />
      <g clipPath="url(#drive-revlights-gradient-clip)">
        <ShiftStrobe active={shift} />
        <rect x={x} y={y} width={litW} height={barH} fill={revFill('url(#drive-revlights-gradient-fill)', shift)} filter={litW > 0 ? 'url(#drive-revlights-gradient-glow)' : undefined} />
      </g>
    </CleanTile>
  )
}

function RevlightsLedStripWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const { f, missing } = shiftFraction(snapshot)
  const shift = atShiftPoint(f, snapshot?.revLights?.blink)
  const w = width ?? REV_WIDE_W
  const h = height ?? REV_WIDE_H
  const count = 42
  const layout = revLightRowLayout(w, h, count, {
    gap: 7,
    heightRatio: 0.64,
    minLedHeight: Math.min(6, Math.max(1, h))
  })
  const lit = shift ? layout.count : missing ? 0 : Math.round(f * layout.count)
  return (
    <CleanTile width={w} height={h}>
      <g>
        <ShiftStrobe active={shift} />
        {Array.from({ length: layout.count }, (_, i) => {
          const pct = i / (layout.count - 1)
          const on = shift || i < lit
          return <rect key={i} x={layout.positions[i]} y={layout.y} width={layout.ledWidth} height={layout.ledHeight} rx={Math.min(4, layout.ledHeight / 4)} fill={on ? revFill(revRampColor(pct), shift) : C.recess} opacity={on ? 1 : 0.48} />
        })}
      </g>
    </CleanTile>
  )
}

function RevlightsLedBarWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const { f, missing } = shiftFraction(snapshot)
  const shift = atShiftPoint(f, snapshot?.revLights?.blink)
  const w = width ?? REV_WIDE_W
  const h = height ?? REV_WIDE_H
  const count = 16
  const layout = revLightRowLayout(w, h, count, {
    gap: 12,
    heightRatio: 0.66,
    minLedHeight: Math.min(8, Math.max(1, h))
  })
  const lit = shift ? layout.count : missing ? 0 : Math.round(f * layout.count)
  return (
    <CleanTile width={w} height={h}>
      <g>
        <ShiftStrobe active={shift} />
        {Array.from({ length: layout.count }, (_, i) => {
          const pct = i / (layout.count - 1)
          const on = shift || i < lit
          const color = revFill(revRampColor(pct), shift)
          return (
            <g key={i}>
              <rect x={layout.positions[i]} y={layout.y} width={layout.ledWidth} height={layout.ledHeight} rx={Math.min(7, layout.ledHeight / 4)} fill={on ? color : C.recess} opacity={on ? 1 : 0.45} />
              {on ? <rect x={layout.positions[i] + 6} y={layout.y + Math.max(1, layout.ledHeight * 0.08)} width={Math.max(0, layout.ledWidth - 12)} height={Math.max(1, layout.ledHeight * 0.16)} rx={3} fill="rgba(255,255,255,0.28)" /> : null}
            </g>
          )
        })}
      </g>
    </CleanTile>
  )
}

function mustangDotColor(index: number, half: 'left' | 'right', countPerSide: number): string {
  const outward = index / Math.max(1, countPerSide - 1)
  if (half === 'left') return outward < 0.45 ? YELLOW : GREEN
  return outward < 0.45 ? '#ffb020' : RED
}

function RevlightsMustangWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const { f, missing } = shiftFraction(snapshot)
  const shift = atShiftPoint(f, snapshot?.revLights?.blink)
  const w = width ?? REV_MUSTANG_W
  const h = height ?? REV_MUSTANG_H
  const countPerSide = 8
  const centerX = w / 2
  const cy = h / 2
  const r = Math.max(0.5, Math.min(14, h * 0.18, w / (countPerSide * 2)))
  const margin = r
  const centerGap = Math.min(
    Math.max(r * 2 + 8, w * 0.05),
    Math.max(0, w - margin * 2)
  )
  const gap = Math.max(0, centerX - centerGap / 2 - margin) / Math.max(1, countPerSide - 1)
  const litPairs = shift ? countPerSide : missing ? 0 : Math.round(f * countPerSide)
  return (
    <CleanTile width={w} height={h}>
      <g>
        <ShiftStrobe active={shift} />
        {Array.from({ length: countPerSide }, (_, i) => {
          const pairLit = shift || i < litPairs
          const leftX = centerX - centerGap / 2 - i * gap
          const rightX = centerX + centerGap / 2 + i * gap
          return (
            <g key={i}>
              <circle cx={leftX} cy={cy} r={r} fill={pairLit ? revFill(mustangDotColor(i, 'left', countPerSide), shift) : C.recess} opacity={pairLit ? 1 : 0.45} />
              <circle cx={rightX} cy={cy} r={r} fill={pairLit ? revFill(mustangDotColor(i, 'right', countPerSide), shift) : C.recess} opacity={pairLit ? 1 : 0.45} />
            </g>
          )
        })}
      </g>
    </CleanTile>
  )
}

export const speedWidget: HifiWidgetModule = {
  id: 'speed',
  title: 'Speed',
  description: 'Large speed readout in km/h.',
  category: 'drive',
  tags: ['speed', 'bignum'],
  requires: ['speedKmh'],
  defaultSize: { w: W, h: H },
  render: (props) => <SpeedWidget {...props} />
}

export const rpmWidget: HifiWidgetModule = {
  id: 'rpm',
  title: 'RPM',
  description: 'Radial tachometer gauge with current RPM value.',
  category: 'drive',
  tags: ['rpm', 'gauge'],
  requires: ['rpm', 'maxRpm'],
  defaultSize: { w: W, h: H },
  render: (props) => <RpmWidget {...props} />
}

export const rpmBarWidget: HifiWidgetModule = {
  id: 'rpmBar',
  title: 'RPM Bar',
  description: 'Segmented horizontal tachometer bar.',
  category: 'drive',
  tags: ['rpm', 'bar'],
  requires: ['rpm', 'maxRpm'],
  defaultSize: { w: W, h: H },
  render: (props) => <RpmBarWidget {...props} />
}

export const gearWidget: HifiWidgetModule = {
  id: 'gear',
  title: 'Gear',
  description: 'Huge current gear indicator.',
  category: 'drive',
  tags: ['gear', 'bignum'],
  requires: ['gear'],
  defaultSize: { w: W, h: H },
  render: (props) => <GearWidget {...props} />
}

export const revlightsWidget: HifiWidgetModule = {
  id: 'revlights',
  title: 'Rev Lights',
  description: 'Blue-to-red shift LED strip.',
  category: 'drive',
  tags: ['revlights', 'led', 'shift'],
  requires: ['shiftIndicatorPct'],
  defaultSize: { w: REV_WIDE_W, h: REV_WIDE_H },
  render: (props) => <RevLightsWidget {...props} />
}

export const speedGearWidget: HifiWidgetModule = {
  id: 'speedGear',
  title: 'Speed + Gear',
  description: 'Combined speed and gear tile.',
  category: 'drive',
  tags: ['speed', 'gear'],
  requires: ['speedKmh', 'gear'],
  defaultSize: { w: W, h: H },
  render: (props) => <SpeedGearWidget {...props} />
}

export const revlightsGradientWidget: HifiWidgetModule = {
  id: 'revlightsGradient',
  title: 'Rev Lights Gradient',
  description: 'Smooth horizontal rev-lights gradient bar.',
  category: 'drive',
  tags: ['rev-lights', 'gradient', 'rpm', 'shift'],
  requires: ['shiftIndicatorPct', 'rpm', 'maxRpm'],
  defaultSize: { w: REV_WIDE_W, h: REV_WIDE_H },
  render: (props) => <RevlightsGradientWidget {...props} />
}

export const revlightsLedStripWidget: HifiWidgetModule = {
  id: 'revlightsLedStrip',
  title: 'Rev Lights LED Strip',
  description: 'Dense thin-segment rev-lights strip.',
  category: 'drive',
  tags: ['rev-lights', 'led-strip', 'rpm', 'shift'],
  requires: ['shiftIndicatorPct', 'rpm', 'maxRpm'],
  defaultSize: { w: REV_WIDE_W, h: REV_WIDE_H },
  render: (props) => <RevlightsLedStripWidget {...props} />
}

export const revlightsLedBarWidget: HifiWidgetModule = {
  id: 'revlightsLedBar',
  title: 'Rev Lights LED Bar',
  description: 'Chunky LED rev-lights bar with blue over-rev LEDs.',
  category: 'drive',
  tags: ['rev-lights', 'led-bar', 'rpm', 'shift'],
  requires: ['shiftIndicatorPct', 'rpm', 'maxRpm'],
  defaultSize: { w: REV_WIDE_W, h: REV_WIDE_H },
  render: (props) => <RevlightsLedBarWidget {...props} />
}

export const revlightsMustangWidget: HifiWidgetModule = {
  id: 'revlightsMustang',
  title: 'Rev Lights Mustang',
  description: 'Center-out Mustang-style shift dot cluster.',
  category: 'drive',
  tags: ['rev-lights', 'mustang', 'rpm', 'shift', 'center'],
  requires: ['shiftIndicatorPct', 'rpm', 'maxRpm'],
  defaultSize: { w: REV_MUSTANG_W, h: REV_MUSTANG_H },
  render: (props) => <RevlightsMustangWidget {...props} />
}
