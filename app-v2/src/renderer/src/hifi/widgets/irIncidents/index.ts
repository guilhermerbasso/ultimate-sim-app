import type { HifiWidgetModule } from '../types'
import { fastRepairsWidget, incidentsMineWidget, incidentsTeamWidget } from './widgets'

export const IR_INCIDENTS_WIDGETS: HifiWidgetModule[] = [
  incidentsMineWidget,
  incidentsTeamWidget,
  fastRepairsWidget
]
