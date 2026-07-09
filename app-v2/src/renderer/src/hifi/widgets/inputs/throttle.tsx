import { type ReactElement } from 'react'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { C } from '../kit'
import { PercentBarWidget, SINGLE_H, SINGLE_W } from './shared'

export function ThrottleWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  return <PercentBarWidget snapshot={snapshot} width={width} height={height} label="Throttle" color={C.green} value={snapshot?.throttle} />
}

export const throttleWidget: HifiWidgetModule = {
  id: 'throttle',
  title: 'Throttle',
  description: 'Vertical throttle input bar with percentage readout.',
  category: 'inputs',
  tags: ['inputs', 'bar', 'clean'],
  requires: ['throttle'],
  defaultSize: { w: SINGLE_W, h: SINGLE_H },
  render: (props) => <ThrottleWidget {...props} />
}
