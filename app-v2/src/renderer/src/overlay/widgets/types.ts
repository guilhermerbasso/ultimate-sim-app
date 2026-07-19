import type { OverlayTriggerResult, OverlayWidgetConfig } from '../../../../shared/overlays'
import type { AlertsConfig } from '../../../../shared/alerts'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'

export interface WidgetProps {
  snapshot: TelemetrySnapshot | null
  config: OverlayWidgetConfig
  visibility?: OverlayTriggerResult
  alertsConfig?: AlertsConfig
}
