import { type ReactElement } from 'react'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { C, FONT_BIG, FONT_LABEL, FONT_NUM, GaugeArc, LEGIBLE, clamp01, fixed, legibleStroke, num } from '../kit'
import { SINGLE_H, SINGLE_W, WidgetSvg } from './shared'

function angleFrac(angle: number | undefined): number {
  return angle == null ? 0.5 : clamp01((angle + 90) / 180)
}

function needlePath(cx: number, cy: number, r: number, angle: number | undefined): string {
  const deg = angle == null ? 0 : Math.max(-90, Math.min(90, angle))
  const rad = ((deg - 90) * Math.PI) / 180
  const x = cx + Math.cos(rad) * r
  const y = cy + Math.sin(rad) * r
  return `M${cx} ${cy} L${x.toFixed(2)} ${y.toFixed(2)}`
}

export function SteeringWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? SINGLE_W
  const h = height ?? SINGLE_H
  const angle = num(snapshot?.steerAngleDeg)
  const f = angleFrac(angle)
  const cx = w / 2
  const cy = 134
  const r = 68
  const display = fixed(angle, 0)
  const signedDisplay = angle != null && angle > 0 ? `+${display}` : display
  return (
    <WidgetSvg w={w} h={h} label="Steering" accent={C.cyan}>
      <g>
        <GaugeArc cx={cx} cy={cy} r={r} thickness={6} f={f} color={angle == null ? C.dim : C.cyan} />
        {[-90, -45, 0, 45, 90].map((tick) => {
          const rad = ((tick - 90) * Math.PI) / 180
          const tx = cx + Math.cos(rad) * (r + 12)
          const ty = cy + Math.sin(rad) * (r + 12)
          return (
            <text key={tick} x={tx} y={ty + 4} textAnchor="middle" fill={tick === 0 ? C.text : C.dim} fontFamily={FONT_NUM} fontSize={11} {...LEGIBLE}>
              {tick}
            </text>
          )
        })}
        {Array.from({ length: 25 }, (_, i) => {
          const deg = -90 + i * 7.5
          const rad = ((deg - 90) * Math.PI) / 180
          const inner = r - (i % 3 === 0 ? 11 : 7)
          const outer = r - 1
          return (
            <line
              key={i}
              x1={cx + Math.cos(rad) * inner}
              y1={cy + Math.sin(rad) * inner}
              x2={cx + Math.cos(rad) * outer}
              y2={cy + Math.sin(rad) * outer}
              stroke={deg <= (angle ?? -91) ? C.cyan : C.dim}
              strokeWidth={i % 3 === 0 ? 2 : 1.2}
              opacity={0.9}
            />
          )
        })}
        <path d={needlePath(cx, cy, r - 24, angle)} stroke={angle == null ? C.dim : C.cyan} strokeWidth={4} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={5} fill={C.text} />
        <text x={cx} y={176} textAnchor="middle" fill={angle == null ? C.dim : C.text} fontFamily={FONT_BIG} fontSize={34} fontWeight={800} {...legibleStroke(34)}>
          {signedDisplay}
        </text>
        <text x={cx + 38} y={162} fill={angle == null ? C.dim : C.cyan} fontFamily={FONT_LABEL} fontSize={18} fontWeight={800} {...LEGIBLE}>
          °
        </text>
      </g>
    </WidgetSvg>
  )
}

export const steeringWidget: HifiWidgetModule = {
  id: 'steering',
  title: 'Steering',
  description: 'Centered steering angle arc and degree readout.',
  category: 'inputs',
  tags: ['inputs', 'gauge'],
  requires: ['steerAngleDeg'],
  defaultSize: { w: SINGLE_W, h: SINGLE_H },
  render: (props) => <SteeringWidget {...props} />
}
