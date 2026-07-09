import { altitudeWidget, attitudeWidget, ffbTorqueWidget, vertGWidget, yawRateWidget } from './widgets'
import type { HifiWidgetModule } from '../types'

export const IR_CHASSIS_WIDGETS: HifiWidgetModule[] = [
  attitudeWidget,
  yawRateWidget,
  ffbTorqueWidget,
  vertGWidget,
  altitudeWidget
]
