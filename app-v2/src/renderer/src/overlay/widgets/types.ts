import type { OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'

export interface WidgetProps {
  snapshot: TelemetrySnapshot | null
  config: OverlayWidgetConfig
}
