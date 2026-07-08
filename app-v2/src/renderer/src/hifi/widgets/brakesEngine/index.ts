import { absWidget, brakeBiasWidget, brakeTempFLWidget, brakeTempFRWidget, brakeTempRLWidget, brakeTempRRWidget, brakeTempWidget, engineMapWidget, ersWidget, oilPressureWidget, oilTempWidget, tcWidget, waterTempWidget } from './widgets'
import type { HifiWidgetModule } from '../types'

export const BRAKES_ENGINE_WIDGETS: HifiWidgetModule[] = [
  brakeTempWidget,
  brakeTempFLWidget,
  brakeTempFRWidget,
  brakeTempRLWidget,
  brakeTempRRWidget,
  brakeBiasWidget,
  oilTempWidget,
  waterTempWidget,
  oilPressureWidget,
  tcWidget,
  absWidget,
  engineMapWidget,
  ersWidget
]
