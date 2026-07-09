import { type ReactElement } from 'react'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { C } from '../kit'
import { PercentBarWidget, SINGLE_H, SINGLE_W } from './shared'

export function BrakeWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  return <PercentBarWidget snapshot={snapshot} width={width} height={height} label="Brake" color={C.red} value={snapshot?.brake} />
}

export const brakeWidget: HifiWidgetModule = {
  id: 'brake',
  title: 'Brake',
  description: 'Vertical brake input bar with percentage readout.',
  category: 'inputs',
  tags: ['inputs', 'bar', 'clean'],
  requires: ['brake'],
  defaultSize: { w: SINGLE_W, h: SINGLE_H },
  render: (props) => <BrakeWidget {...props} />
}
