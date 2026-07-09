import {
  gearWidget,
  revlightsGradientWidget,
  revlightsLedBarWidget,
  revlightsLedStripWidget,
  revlightsMustangWidget,
  revlightsWidget,
  rpmBarWidget,
  rpmWidget,
  speedGearWidget,
  speedWidget
} from './widgets'
import type { HifiWidgetModule } from '../types'

export const DRIVE_WIDGETS: HifiWidgetModule[] = [
  speedWidget,
  rpmWidget,
  gearWidget,
  rpmBarWidget,
  revlightsWidget,
  speedGearWidget,
  revlightsGradientWidget,
  revlightsLedStripWidget,
  revlightsLedBarWidget,
  revlightsMustangWidget
]
