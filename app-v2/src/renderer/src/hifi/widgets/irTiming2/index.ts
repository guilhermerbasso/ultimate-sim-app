import type { HifiWidgetModule } from '../types'
import { deltaToDriverBestWidget, deltaToOptimalWidget, deltaToSessionOptimalWidget, estimatedLapWidget } from './widgets'

export const IR_TIMING2_WIDGETS: HifiWidgetModule[] = [
  deltaToOptimalWidget,
  deltaToSessionOptimalWidget,
  deltaToDriverBestWidget,
  estimatedLapWidget
]
