import { absStateWidget, engineWarningsWidget, handbrakeWidget, tcStateWidget } from './widgets'
import type { HifiWidgetModule } from '../types'

export const IR_AIDS_WIDGETS: HifiWidgetModule[] = [
  absStateWidget,
  tcStateWidget,
  handbrakeWidget,
  engineWarningsWidget
]
