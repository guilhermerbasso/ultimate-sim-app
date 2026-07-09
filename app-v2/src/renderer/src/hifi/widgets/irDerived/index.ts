import {
  carAttitudeWidget,
  engineTelltaleWidget,
  fuelLapsLeftWidget,
  gpsHeadingWidget,
  raceControlFlagsWidget,
  rotationRatesWidget,
  sessionTagWidget,
  shiftPointWidget,
  slipAngleWidget,
  spotterRawWidget,
  steeringLockWidget,
  sunPositionWidget
} from './widgets'
import type { HifiWidgetModule } from '../types'

export const IR_DERIVED_WIDGETS: HifiWidgetModule[] = [
  slipAngleWidget,
  steeringLockWidget,
  rotationRatesWidget,
  carAttitudeWidget,
  fuelLapsLeftWidget,
  sunPositionWidget,
  gpsHeadingWidget,
  raceControlFlagsWidget,
  shiftPointWidget,
  engineTelltaleWidget,
  spotterRawWidget,
  sessionTagWidget
]
