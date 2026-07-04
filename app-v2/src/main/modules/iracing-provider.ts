import type { ModuleContext } from '../module-context'
import { IRacingProvider } from '../iracing/provider'
import { settingsEvents } from '../settings/events'

export function register(ctx: ModuleContext): void {
  const provider = new IRacingProvider()
  ctx.telemetryHub.register(provider)
  // Keep the DERIVED tcActive sensitivity in sync with the settings store. The store is
  // owned by app-shell-ui, registered AFTER this module, and emits the initial settings on
  // load (see app-shell-ui), so this subscriber receives both the boot value and live edits.
  settingsEvents.onChanged((settings) => provider.setTcSensitivity(settings.tcSensitivity))
}
