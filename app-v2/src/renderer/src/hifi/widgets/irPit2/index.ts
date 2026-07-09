import { pitRoadWidget, pitServiceWidget, pitStatusWidget } from './widgets'
import type { HifiWidgetModule } from '../types'

export const IR_PIT2_WIDGETS: HifiWidgetModule[] = [
  pitRoadWidget,
  pitServiceWidget,
  pitStatusWidget
]
