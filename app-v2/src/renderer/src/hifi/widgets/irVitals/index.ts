import { fuelPressWidget, manifoldPressWidget, oilLevelWidget, voltageWidget, waterLevelWidget } from './widgets'
import type { HifiWidgetModule } from '../types'

export const IR_VITALS_WIDGETS: HifiWidgetModule[] = [
  voltageWidget,
  manifoldPressWidget,
  fuelPressWidget,
  waterLevelWidget,
  oilLevelWidget
]
