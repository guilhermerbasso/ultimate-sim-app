// ── irSession2 — clean iRacing session micro-readouts ────────────────────────
// Transparent, title-less SVG widgets inspired by the generated session refs:
// SoF outline numeral, glowing time-of-day clock, ballast weight, and power adjust.
import type { ReactElement } from 'react'
import { formatTimeOfDay } from '../../../../../shared/telemetry'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { Bar, BigNum, C, FONT_BIG, FONT_LABEL, FONT_NUM, Hairline, LEGIBLE, fixed, legibleStroke, num } from '../kit'
import { formatMeasurement } from '../../../../../shared/units'

const W = 420
const H = 240

function Root({ width, height, children }: HifiWidgetProps & { children: ReactElement | ReactElement[] }): ReactElement {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={width ?? W} height={height ?? H} preserveAspectRatio="xMidYMid meet" role="img">
      {children}
    </svg>
  )
}

function Glow({ color, opacity = 0.22 }: { color: string; opacity?: number }): ReactElement {
  return (
    <defs>
      <filter id={`glow-${color.replace(/[^a-z0-9]/gi, '')}`} x="-30%" y="-40%" width="160%" height="180%">
        <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor={color} floodOpacity={opacity} />
      </filter>
    </defs>
  )
}

function signedValue(v: number | undefined, digits: number): string {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}${fixed(v, digits)}`
}

function StrengthOfField({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const sof = num(snapshot?.strengthOfField)
  const display = sof == null ? '—' : fixed(Math.round(sof), 0)
  const valueSize = display === '—' ? 108 : Math.max(48, Math.min(108, (W - 72) / (display.length * 0.9)))
  return (
    <Root snapshot={snapshot} width={width} height={height}>
      <Glow color={C.cyan} />
      <text x={48} y={44} fill={C.dim} fontFamily={FONT_LABEL} fontSize={26} fontWeight={800} letterSpacing={3} {...LEGIBLE}>
        SoF
      </text>
      <text
        x={W / 2}
        y={166}
        textAnchor="middle"
        fill="rgba(255,255,255,0.08)"
        stroke={C.cyan}
        strokeWidth={3.2}
        paintOrder="stroke"
        strokeLinejoin="round"
        fontFamily={FONT_BIG}
        fontSize={valueSize}
        fontWeight={900}
        filter="url(#glow-22c3ff)"
      >
        {display}
      </text>
      <Hairline x={70} y={205} len={280} opacity={0.2} />
    </Root>
  )
}

function SunGlyph({ x, y, color }: { x: number; y: number; color: string }): ReactElement {
  return (
    <g transform={`translate(${x},${y})`} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round" filter="url(#glow-22c3ff)">
      <circle cx={0} cy={0} r={22} />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (Math.PI * 2 * i) / 8
        const x1 = Math.cos(a) * 36
        const y1 = Math.sin(a) * 36
        const x2 = Math.cos(a) * 52
        const y2 = Math.sin(a) * 52
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />
      })}
    </g>
  )
}

function TimeOfDay({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const time = num(snapshot?.sessionTimeOfDay)
  const display = formatTimeOfDay(time) ?? '—'
  return (
    <Root snapshot={snapshot} width={width} height={height}>
      <Glow color={C.cyan} opacity={0.34} />
      <SunGlyph x={68} y={120} color="#dffaff" />
      <text x={246} y={151} textAnchor="middle" fill="#eaffff" fontFamily={FONT_NUM} fontSize={92} fontWeight={900} letterSpacing={2} {...legibleStroke(92)} filter="url(#glow-22c3ff)">
        {display}
      </text>
    </Root>
  )
}

function WeightGlyph({ x, y, color }: { x: number; y: number; color: string }): ReactElement {
  return (
    <g transform={`translate(${x},${y})`} fill={color} {...legibleStroke(20)}>
      <path d="M28 24 h46 l18 87 H10 Z" />
      <circle cx={51} cy={20} r={17} fill="none" stroke={color} strokeWidth={9} />
    </g>
  )
}

function WeightPenalty({ snapshot, width, height, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
  const penalty = num(snapshot?.weightPenaltyKg)
  const reading = formatMeasurement(penalty, 'mass-kg', unitSystem, { decimals: 0 })
  const display = signedValue(reading.value, 0)
  return (
    <Root snapshot={snapshot} width={width} height={height}>
      <WeightGlyph x={26} y={70} color={C.amber} />
      <BigNum x={248} y={153} value={display} unit={penalty == null ? undefined : reading.unit} color={C.amber} size={105} />
      <Bar x={146} y={178} w={178} h={7} f={penalty == null ? 0 : Math.min(1, Math.abs(penalty) / 60)} color={C.amber} />
    </Root>
  )
}

function PowerAdjust({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const adjust = num(snapshot?.powerAdjustPct)
  const display = signedValue(adjust, 1)
  const color = adjust == null ? C.dim : adjust < 0 ? C.red : adjust > 0 ? C.green : C.text
  return (
    <Root snapshot={snapshot} width={width} height={height}>
      <text x={W / 2} y={155} textAnchor="middle" fill={color} fontFamily={FONT_BIG} fontSize={112} fontWeight={900} letterSpacing={1} {...legibleStroke(112)}>
        {display}
        {adjust == null ? null : (
          <tspan fill={color} fontFamily={FONT_LABEL} fontSize={44} baselineShift="-4">
            %
          </tspan>
        )}
      </text>
      <Hairline x={88} y={179} len={244} opacity={0.18} />
      <Bar x={134} y={190} w={152} h={7} f={adjust == null ? 0 : Math.min(1, Math.abs(adjust) / 10)} color={color} />
    </Root>
  )
}

export const strengthOfFieldWidget: HifiWidgetModule = {
  id: 'strengthOfField',
  title: 'Strength of Field',
  description: 'iRacing strength of field readout with a small SoF distinguisher.',
  category: 'session',
  tags: ['iracing', 'session', 'sof', 'clean', 'digital'],
  requires: ['strengthOfField'],
  defaultSize: { w: W, h: H },
  render: (props) => <StrengthOfField {...props} />
}

export const timeOfDayWidget: HifiWidgetModule = {
  id: 'timeOfDay',
  title: 'Time of Day',
  description: 'Session time of day formatted from seconds since midnight.',
  category: 'session',
  tags: ['iracing', 'session', 'clock', 'clean', 'digital'],
  requires: ['sessionTimeOfDay'],
  defaultSize: { w: W, h: H },
  render: (props) => <TimeOfDay {...props} />
}

export const weightPenaltyWidget: HifiWidgetModule = {
  id: 'weightPenalty',
  title: 'Weight Penalty',
  description: 'Signed iRacing ballast / BoP weight penalty in kilograms.',
  category: 'session',
  tags: ['iracing', 'session', 'ballast', 'bop', 'clean'],
  requires: ['weightPenaltyKg'],
  defaultSize: { w: W, h: H },
  render: (props) => <WeightPenalty {...props} />
}

export const powerAdjustWidget: HifiWidgetModule = {
  id: 'powerAdjust',
  title: 'Power Adjust',
  description: 'Signed iRacing BoP power adjustment percentage.',
  category: 'session',
  tags: ['iracing', 'session', 'power', 'bop', 'clean'],
  requires: ['powerAdjustPct'],
  defaultSize: { w: W, h: H },
  render: (props) => <PowerAdjust {...props} />
}
