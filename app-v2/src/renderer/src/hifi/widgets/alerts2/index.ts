import {
  alert2BadSurfaceWidget,
  alert2BlueFlagWidget,
  alert2BrakePressureLowWidget,
  alert2EngineWarningWidget,
  alert2OilPressureLowWidget,
  alert2OilTempCriticalWidget,
  alert2TyreTempCriticalWidget,
  alert2WaterTempCriticalWidget
} from './widgets'
import type { HifiWidgetModule } from '../types'

export const ALERTS2_WIDGETS: HifiWidgetModule[] = [
  alert2EngineWarningWidget,
  alert2WaterTempCriticalWidget,
  alert2OilTempCriticalWidget,
  alert2OilPressureLowWidget,
  alert2BadSurfaceWidget,
  alert2BlueFlagWidget,
  alert2TyreTempCriticalWidget,
  alert2BrakePressureLowWidget
]
