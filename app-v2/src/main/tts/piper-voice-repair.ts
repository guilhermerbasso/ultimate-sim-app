import type { EnsureVoiceResult } from '../../shared/spotter'
import type { PiperEngineHealth } from './piper-engine-health'

export class PiperVoiceRepairCoordinator {
  private readonly inflight = new Map<
    string,
    Promise<EnsureVoiceResult>
  >()

  constructor(
    private readonly health: PiperEngineHealth,
    private readonly isInstalled: (
      voiceId: string
    ) => boolean | Promise<boolean>,
    private readonly install: (
      voiceId: string
    ) => Promise<EnsureVoiceResult>
  ) {}

  ensure(voiceId: string): Promise<EnsureVoiceResult> {
    const existing = this.inflight.get(voiceId)
    if (existing) return existing
    const repair = (async () => {
      if (
        await this.isInstalled(voiceId) &&
        !this.health.needsRepair(voiceId)
      ) {
        return {
          ok: true,
          voiceId,
          installed: true
        }
      }
      const result = await this.install(voiceId)
      if (result.ok && result.installed) {
        this.health.resetVoice(voiceId)
      }
      return result
    })().finally(() => {
        this.inflight.delete(voiceId)
      })
    this.inflight.set(voiceId, repair)
    return repair
  }
}
