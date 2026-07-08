import { type ReactElement } from 'react'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { C, FONT_NUM, LEGIBLE } from '../kit'
import { COMBO_H, COMBO_W, MiniVBar, WidgetSvg } from './shared'

export function InputsComboWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? COMBO_W
  const h = height ?? COMBO_H
  const barY = 56
  const barH = 120
  return (
    <WidgetSvg w={w} h={h} label="Inputs" accent={C.green}>
      <g>
        {[0, 50, 100].map((tick) => {
          const y = barY + barH - (tick / 100) * barH
          return (
            <g key={tick}>
              <line x1={36} x2={43} y1={y} y2={y} stroke={C.dim} strokeWidth={1} />
              <text x={32} y={y + 4} textAnchor="end" fill={C.text} fontFamily={FONT_NUM} fontSize={12} {...LEGIBLE}>
                {tick}
              </text>
            </g>
          )
        })}
        <MiniVBar x={52} y={barY} w={46} h={barH} label="THR" color={C.green} value={snapshot?.throttle} />
        <MiniVBar x={137} y={barY} w={46} h={barH} label="BRK" color={C.red} value={snapshot?.brake} />
        <MiniVBar x={222} y={barY} w={46} h={barH} label="CLT" color={C.amber} value={snapshot?.clutch} />
      </g>
    </WidgetSvg>
  )
}

export const inputsComboWidget: HifiWidgetModule = {
  id: 'inputsCombo',
  title: 'Inputs Combo',
  description: 'Throttle, brake, and clutch vertical bars side by side.',
  category: 'inputs',
  tags: ['inputs', 'bar', 'clean'],
  requires: ['throttle', 'brake', 'clutch'],
  defaultSize: { w: COMBO_W, h: COMBO_H },
  render: (props) => <InputsComboWidget {...props} />
}
