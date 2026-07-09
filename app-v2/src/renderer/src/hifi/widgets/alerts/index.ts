import {
  alertCarLeftWidget,
  alertCarRightWidget,
  alertFlagWidget,
  alertLowFuelWidget,
  alertPitLimiterWidget,
  alertProximityRadarWidget,
  alertShiftFlashWidget
} from './widgets'
import type { HifiWidgetModule } from '../types'

export const ALERTS_WIDGETS: HifiWidgetModule[] = [
  alertCarLeftWidget,
  alertCarRightWidget,
  alertProximityRadarWidget,
  alertShiftFlashWidget,
  alertPitLimiterWidget,
  alertFlagWidget,
  alertLowFuelWidget
]

