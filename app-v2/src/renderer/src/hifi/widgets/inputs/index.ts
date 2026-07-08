import type { HifiWidgetModule } from '../types'
import { brakeWidget } from './brake'
import { clutchWidget } from './clutch'
import { inputsBrakeThrottleWidget } from './inputsBrakeThrottle'
import { inputsComboWidget } from './inputsCombo'
import { steeringWidget } from './steering'
import { throttleWidget } from './throttle'

export const INPUTS_WIDGETS: HifiWidgetModule[] = [
  throttleWidget,
  brakeWidget,
  clutchWidget,
  steeringWidget,
  inputsComboWidget,
  inputsBrakeThrottleWidget
]
