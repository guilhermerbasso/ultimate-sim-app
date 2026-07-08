import { type ReactElement } from 'react'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { C } from '../kit'
import { PercentBarWidget, SINGLE_H, SINGLE_W } from './shared'

export function ClutchWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  return <PercentBarWidget snapshot={snapshot} width={width} height={height} label="Clutch" color={C.amber} value={snapshot?.clutch} />
}

export const clutchWidget: HifiWidgetModule = {
  id: 'clutch',
  title: 'Clutch',
  description: 'Vertical clutch input bar with percentage readout.',
  category: 'inputs',
  tags: ['inputs', 'bar', 'clean'],
  requires: ['clutch'],
  defaultSize: { w: SINGLE_W, h: SINGLE_H },
  render: (props) => <ClutchWidget {...props} />
}
