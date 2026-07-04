import type { ModuleContext } from '../module-context'
import { ACProvider } from '../sims/ac'
import { ACCProvider } from '../sims/acc'
import { AMS2Provider } from '../sims/ams2'
import { LMUProvider } from '../sims/lmu'

export function register(ctx: ModuleContext): void {
  ctx.telemetryHub.register(new ACCProvider())
  ctx.telemetryHub.register(new ACProvider())
  ctx.telemetryHub.register(new AMS2Provider())
  ctx.telemetryHub.register(new LMUProvider())
}
