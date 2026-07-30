import type { ModuleContext } from '../module-context'
import { ACProvider } from '../sims/ac'
import { ACCProvider } from '../sims/acc'
import { AMS2Provider } from '../sims/ams2'
import { LMUProvider } from '../sims/lmu'
import {
  acpmfNeedsUserChoice,
  describeAcpmfIdentity,
  type AcpmfIdentity
} from '../sims/acpmf-identity'

/** IPC channel exposing which simulator owns the shared `Local\acpmf_*` memory. */
export const ACPMF_STATUS_CHANNEL = 'sims:acpmfStatus'

export interface AcpmfStatus {
  identity: AcpmfIdentity
  /**
   * True when auto-detection found a page it cannot attribute. The app deliberately does
   * NOT guess: the user resolves it by choosing Assetto Corsa or Competizione as the
   * telemetry source, which is already persisted as the default source.
   */
  needsUserChoice: boolean
  message: string
}

export function buildAcpmfStatus(identity: AcpmfIdentity, autoDetecting: boolean): AcpmfStatus {
  return {
    identity,
    needsUserChoice: acpmfNeedsUserChoice(identity, autoDetecting ? 'auto' : 'explicit'),
    message: describeAcpmfIdentity(identity)
  }
}

export function register(ctx: ModuleContext): void {
  const acc = new ACCProvider()
  const ac = new ACProvider()
  ctx.telemetryHub.register(acc)
  ctx.telemetryHub.register(ac)
  ctx.telemetryHub.register(new AMS2Provider())
  ctx.telemetryHub.register(new LMUProvider())

  // Neither AC nor ACC connecting while a page IS present is otherwise indistinguishable
  // from "no simulator running". Expose the reason so the UI can tell the user to pick a
  // simulator rather than leaving them staring at an empty Telemetry screen.
  ctx.ipcMain.handle(ACPMF_STATUS_CHANNEL, (): AcpmfStatus => {
    const fromAcc = acc.identity()
    const identity = fromAcc.kind === 'absent' ? ac.identity() : fromAcc
    return buildAcpmfStatus(identity, ctx.telemetryHub.status().source === 'auto')
  })
}
