import { rainStateWidget, trackSurfaceWidget, wetDeclaredWidget } from './widgets'
import type { HifiWidgetModule } from '../types'

export const IR_CONDITIONS2_WIDGETS: HifiWidgetModule[] = [
  rainStateWidget,
  wetDeclaredWidget,
  trackSurfaceWidget
]
