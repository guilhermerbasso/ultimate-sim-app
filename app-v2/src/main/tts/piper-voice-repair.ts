import type { EnsureVoiceResult } from '../../shared/spotter'
import type { PiperEngineHealth } from './piper-engine-health'

export interface VoiceInstallHashes {
  onnx: string
  tokens: string
}

export function voiceInstallHashesMatch(
  expected: VoiceInstallHashes,
  actual: VoiceInstallHashes
): boolean {
  return (
    expected.onnx === actual.onnx &&
    expected.tokens === actual.tokens
  )
}

export class PiperVoiceRepairCoordinator {
  private readonly inflight = new Map<
    string,
    Promise<EnsureVoiceResult>
  >()

  constructor(
    private readonly health: PiperEngineHealth,
    private readonly isInstalled: (voiceId: string) => boolean,
    private readonly install: (
      voiceId: string
    ) => Promise<EnsureVoiceResult>
  ) {}

  ensure(voiceId: string): Promise<EnsureVoiceResult> {
    if (
      this.isInstalled(voiceId) &&
      !this.health.needsRepair(voiceId)
    ) {
      return Promise.resolve({
        ok: true,
        voiceId,
        installed: true
      })
    }
    const existing = this.inflight.get(voiceId)
    if (existing) return existing

    const repair = this.install(voiceId)
      .then((result) => {
        if (result.ok && result.installed) {
          this.health.resetVoice(voiceId)
        }
        return result
      })
      .finally(() => {
        this.inflight.delete(voiceId)
      })
    this.inflight.set(voiceId, repair)
    return repair
  }
}
