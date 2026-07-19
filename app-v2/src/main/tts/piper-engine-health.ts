import type { TtsEngineStatus } from '../../shared/spotter'

export class PiperEngineHealth {
  private readonly crashCounts = new Map<string, number>()
  private cached: TtsEngineStatus | null = null

  constructor(private readonly maxCrashes = 2) {}

  get cachedStatus(): TtsEngineStatus | null {
    return this.cached
  }

  setProbeStatus(status: TtsEngineStatus): TtsEngineStatus {
    this.cached = status
    return status
  }

  recordSuccess(voiceId: string): TtsEngineStatus {
    this.crashCounts.delete(voiceId)
    this.cached = { engine: 'sherpa', ok: true }
    return this.cached
  }

  recordFailure(
    voiceId: string,
    reason: string
  ): { count: number; disabled: boolean; status: TtsEngineStatus } {
    const count = (this.crashCounts.get(voiceId) ?? 0) + 1
    this.crashCounts.set(voiceId, count)
    const disabled = count >= this.maxCrashes
    this.cached = {
      engine: 'sherpa',
      ok: false,
      reason: disabled
        ? `Piper disabled for ${voiceId} after ${count} runtime failures: ${reason}`
        : `Piper runtime synthesis failed for ${voiceId}: ${reason}`
    }
    return { count, disabled, status: this.cached }
  }

  isDisabled(voiceId: string): boolean {
    return (this.crashCounts.get(voiceId) ?? 0) >= this.maxCrashes
  }

  resetVoice(voiceId: string): void {
    this.crashCounts.delete(voiceId)
    this.cached = null
  }
}
