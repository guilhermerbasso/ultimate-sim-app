import { powerAdjustWidget, strengthOfFieldWidget, timeOfDayWidget, weightPenaltyWidget } from './widgets'
import type { HifiWidgetModule } from '../types'

export const IR_SESSION2_WIDGETS: HifiWidgetModule[] = [
  strengthOfFieldWidget,
  timeOfDayWidget,
  weightPenaltyWidget,
  powerAdjustWidget
]
