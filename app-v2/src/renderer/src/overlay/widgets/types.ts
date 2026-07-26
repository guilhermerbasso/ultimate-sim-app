import type { OverlayTriggerResult, OverlayWidgetConfig } from '../../../../shared/overlays'
import type { AlertsConfig } from '../../../../shared/alerts'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import type { DashboardPreviewMode } from '../../dashboard/DashboardRoot'

export interface WidgetProps {
  snapshot: TelemetrySnapshot | null
  config: OverlayWidgetConfig
  visibility?: OverlayTriggerResult
  alertsConfig?: AlertsConfig
  // Non-live render mode. Undefined is the live overlay/dashboard path, so every existing
  // caller keeps live behaviour; a preview mode tells a widget its frame is static.
  preview?: DashboardPreviewMode
}
