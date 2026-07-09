// ── irTiming2 — iRacing optimal/session/driver timing deltas ─────────────────
// Clean, transparent, title-less SVG readouts modelled after the generated timing
// references: signed deltas over a centre-zero faster/slower bar, plus estimated lap.
import type { ReactElement } from 'react'
import type { HifiWidgetModule, HifiWidgetProps, TelemetryField } from '../types'
import { BigNum, C, FONT_BIG, FONT_LABEL, FONT_NUM, Hairline, LEGIBLE, fixed, legibleStroke, num } from '../kit'
import { formatLapTime } from '../../../../../shared/stint-debrief'

const W = 420
const H = 240
const BAR_X = 54
const BAR_Y = 176
const BAR_W = W - BAR_X * 2
const BAR_H = 32
const DELTA_MAX = 1.2

interface DeltaSpec {
  id: string
  title: string
  description: string
  field: TelemetryField
  tag: string
}

function deltaColor(value: number | undefined): string {
  if (value == null || Math.abs(value) < 0.0005) return C.dim
  return value < 0 ? C.green : C.red
}

function signedDelta(value: number | undefined): string {
  if (value == null) return '—'
  const text = fixed(value, 2)
  return value >= 0 ? `+${text}` : text
}

function DeltaBar({ value, color }: { value: number | undefined; color: string }): ReactElement {
  const center = BAR_X + BAR_W / 2
  const half = BAR_W / 2
  const mag = value == null ? 0 : Math.min(1, Math.abs(value) / DELTA_MAX)
  const fillW = half * mag
  const ticks = 42

  return (
    <g>
      <Hairline x={BAR_X} y={BAR_Y + 3} len={BAR_W} opacity={0.22} />
      {value != null && value < 0 ? <rect x={center - fillW} y={BAR_Y} width={fillW} height={7} rx={3.5} fill={color} opacity={0.95} /> : null}
      {value != null && value > 0 ? <rect x={center} y={BAR_Y} width={fillW} height={7} rx={3.5} fill={color} opacity={0.95} /> : null}
      {Array.from({ length: ticks }, (_, i) => {
        const left = i < ticks / 2
        const tx = BAR_X + (i * BAR_W) / (ticks - 1)
        const tMag = left ? (ticks / 2 - i) / (ticks / 2) : (i - ticks / 2 + 1) / (ticks / 2)
        const lit = value != null && ((value < 0 && left && tMag <= mag) || (value > 0 && !left && tMag <= mag))
        return <rect key={i} x={tx - 1} y={BAR_Y + 10} width={2} height={BAR_H - 10} rx={1} fill={left ? C.green : C.red} opacity={lit ? 1 : 0.28} />
      })}
      <rect x={center - 1.5} y={BAR_Y - 11} width={3} height={BAR_H + 18} rx={1.5} fill={C.text} opacity={0.78} />
      <text x={center} y={BAR_Y + 56} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={28} fontWeight={800} {...LEGIBLE}>
        0
      </text>
    </g>
  )
}

function DeltaReadout({ snapshot, width, height, field, tag }: HifiWidgetProps & { field: TelemetryField; tag: string }): ReactElement {
  const w = width ?? W
  const h = height ?? H
  const value = num(snapshot?.[field])
  const color = deltaColor(value)
  const display = signedDelta(value)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={w} height={h} preserveAspectRatio="xMidYMid meet" role="img">
      <text x={W - 28} y={34} textAnchor="end" fill={C.dim} fontFamily={FONT_LABEL} fontSize={21} fontWeight={800} letterSpacing={2.5} opacity={0.62} {...LEGIBLE}>
        {tag}
      </text>
      <BigNum x={W / 2 - 8} y={126} value={display} unit="s" color={color} size={92} />
      <DeltaBar value={value} color={color} />
    </svg>
  )
}

function lapDisplay(seconds: number | undefined): string {
  const text = formatLapTime(seconds)
  return text === '—' ? text : text.replace(',', '.')
}

function EstimatedLapReadout({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? W
  const h = height ?? H
  const value = num(snapshot?.estimatedLapTimeSec)
  const display = lapDisplay(value)
  const size = display === '—' ? 104 : Math.min(92, (W - 60) / Math.max(4.4, display.length * 0.62))
  const color = value == null ? C.dim : C.text

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={w} height={h} preserveAspectRatio="xMidYMid meet" role="img">
      <text
        x={W / 2}
        y={122}
        textAnchor="middle"
        dominantBaseline="central"
        fill={color}
        fontFamily={`${FONT_NUM}, ${FONT_BIG}, monospace`}
        fontSize={size}
        fontWeight={800}
        letterSpacing={-2}
        {...legibleStroke(size)}
      >
        {display}
      </text>
      <Hairline x={50} y={172} len={W - 100} opacity={0.5} />
      <rect x={50} y={171} width={W - 100} height={2} fill={value == null ? C.dim : C.cyan} opacity={0.72} />
    </svg>
  )
}

function makeDeltaWidget({ id, title, description, field, tag }: DeltaSpec): HifiWidgetModule {
  return {
    id,
    title,
    description,
    category: 'timing',
    tags: ['iracing', 'delta', 'optimal', 'clean', 'center-zero', tag.toLowerCase()],
    requires: [field],
    defaultSize: { w: W, h: H },
    render: (props) => <DeltaReadout {...props} field={field} tag={tag} />
  }
}

export const deltaToOptimalWidget = makeDeltaWidget({
  id: 'deltaToOptimal',
  title: 'Delta to Optimal',
  description: 'Signed iRacing delta to the optimal lap, with green faster / red slower centre-zero bar.',
  field: 'deltaToOptimalSec',
  tag: 'OPT'
})

export const deltaToSessionOptimalWidget = makeDeltaWidget({
  id: 'deltaToSessionOptimal',
  title: 'Delta to Session Optimal',
  description: 'Signed iRacing delta to the session optimal lap, with green faster / red slower centre-zero bar.',
  field: 'deltaToSessionOptimalSec',
  tag: 'SES'
})

export const deltaToDriverBestWidget = makeDeltaWidget({
  id: 'deltaToDriverBest',
  title: 'Delta to Driver Best',
  description: 'Signed iRacing delta to the driver best lap, with green faster / red slower centre-zero bar.',
  field: 'deltaToDriverBestSec',
  tag: 'DRV'
})

export const estimatedLapWidget: HifiWidgetModule = {
  id: 'estimatedLap',
  title: 'Estimated Lap',
  description: 'Estimated lap-time readout formatted as m:ss.mmm over a cyan-white hairline.',
  category: 'timing',
  tags: ['iracing', 'lap-time', 'estimated', 'digital', 'clean'],
  requires: ['estimatedLapTimeSec'],
  defaultSize: { w: W, h: H },
  render: (props) => <EstimatedLapReadout {...props} />
}
