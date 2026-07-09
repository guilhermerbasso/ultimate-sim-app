import { aiConfidenceWidget, coachFindingsWidget, coachTipWidget, engineerRadioWidget, proactiveAlertWidget, strategyCallWidget } from './widgets'
import type { HifiWidgetModule } from '../types'

export const AI_WIDGETS: HifiWidgetModule[] = [
  coachTipWidget,
  coachFindingsWidget,
  engineerRadioWidget,
  proactiveAlertWidget,
  strategyCallWidget,
  aiConfidenceWidget
]
