import { carInfoWidget, paceModeWidget, sessionStateWidget, trackInfoWidget } from './widgets'
import type { HifiWidgetModule } from '../types'

export const IR_SESSIONINFO_WIDGETS: HifiWidgetModule[] = [
  sessionStateWidget,
  paceModeWidget,
  carInfoWidget,
  trackInfoWidget
]
