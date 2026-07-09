import { drsWidget, pushToPassCountWidget, pushToPassWidget } from './widgets'
import type { HifiWidgetModule } from '../types'

export const IR_ELECTRONICS_WIDGETS: HifiWidgetModule[] = [
  drsWidget,
  pushToPassWidget,
  pushToPassCountWidget
]
