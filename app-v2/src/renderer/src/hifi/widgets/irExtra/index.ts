import { brakeLinePressWidget, carsAlongsideWidget, fuelLevelPctWidget, fuelRateWidget, revLightsBarWidget, skiesWidget } from './widgets'
import type { HifiWidgetModule } from '../types'

export const IR_EXTRA_WIDGETS: HifiWidgetModule[] = [
  fuelLevelPctWidget,
  fuelRateWidget,
  brakeLinePressWidget,
  skiesWidget,
  revLightsBarWidget,
  carsAlongsideWidget
]

