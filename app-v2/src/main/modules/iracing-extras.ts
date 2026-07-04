import type { ModuleContext } from '../module-context'

export function register(_ctx: ModuleContext): void {
  // iRacing extras (drivers, standings, flags, pit service, incidents and rain/wetness)
  // are normalized directly by IRacingProvider so every telemetry consumer receives the
  // same enriched TelemetrySnapshot through the central hub.
}
