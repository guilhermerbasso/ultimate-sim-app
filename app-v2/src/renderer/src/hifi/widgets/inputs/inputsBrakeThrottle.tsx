import { type ReactElement } from 'react'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { C } from '../kit'
import { COMBO_H, COMBO_W, TraceBar, WidgetSvg, pctFrac } from './shared'

export function InputsBrakeThrottleWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? COMBO_W
  const h = height ?? COMBO_H
  const graphX = 36
  const graphY = 128
  const graphW = w - 72
  return (
    <WidgetSvg w={w} h={h} label="Brake / Throttle" accent={C.cyan}>
      <g>
        <TraceBar x={36} y={50} w={w - 72} label="THR" color={C.green} value={snapshot?.throttle} />
        <TraceBar x={36} y={88} w={w - 72} label="BRK" color={C.red} value={snapshot?.brake} />
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={graphX + graphW * f} x2={graphX + graphW * f} y1={graphY} y2={graphY + 52} stroke="rgba(255,255,255,0.07)" />
        ))}
        <rect x={graphX + 8} y={graphY + 11} width={Math.max(0, (graphW - 16) * pctFrac(snapshot?.throttle))} height={10} rx={5} fill={C.green} />
        <rect x={graphX + 8} y={graphY + 31} width={Math.max(0, (graphW - 16) * pctFrac(snapshot?.brake))} height={10} rx={5} fill={C.red} />
      </g>
    </WidgetSvg>
  )
}

export const inputsBrakeThrottleWidget: HifiWidgetModule = {
  id: 'inputsBrakeThrottle',
  title: 'Brake / Throttle',
  description: 'Overlaid throttle and brake horizontal percentage bars.',
  category: 'inputs',
  tags: ['inputs', 'bar', 'trace', 'clean'],
  requires: ['throttle', 'brake'],
  defaultSize: { w: COMBO_W, h: COMBO_H },
  render: (props) => <InputsBrakeThrottleWidget {...props} />
}
