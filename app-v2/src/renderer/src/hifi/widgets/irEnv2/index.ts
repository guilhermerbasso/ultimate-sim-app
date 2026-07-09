import { fogWidget, humidityWidget, solarAltitudeWidget, windWidget } from './widgets'
import type { HifiWidgetModule } from '../types'

export const IR_ENV2_WIDGETS: HifiWidgetModule[] = [
  fogWidget,
  humidityWidget,
  windWidget,
  solarAltitudeWidget
]
