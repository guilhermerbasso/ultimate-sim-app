import { assertFiniteTimestamp } from './validation'

export interface SocialClockV1 {
  nowMs(): number
}

export class FixedSocialClock implements SocialClockV1 {
  readonly #nowMs: number

  constructor(nowMs: number) {
    assertFiniteTimestamp(nowMs, 'clock.nowMs')
    this.#nowMs = nowMs
  }

  nowMs(): number {
    return this.#nowMs
  }
}

export class ManualSocialClock implements SocialClockV1 {
  #nowMs: number

  constructor(nowMs: number) {
    assertFiniteTimestamp(nowMs, 'clock.nowMs')
    this.#nowMs = nowMs
  }

  nowMs(): number {
    return this.#nowMs
  }

  setNowMs(nowMs: number): void {
    assertFiniteTimestamp(nowMs, 'clock.nowMs')
    if (nowMs < this.#nowMs) throw new Error('clock.nowMs must be monotonic')
    this.#nowMs = nowMs
  }

  advanceBy(deltaMs: number): void {
    assertFiniteTimestamp(deltaMs, 'clock.deltaMs')
    if (deltaMs < 0) throw new Error('clock.deltaMs must be non-negative')
    const next = this.#nowMs + deltaMs
    assertFiniteTimestamp(next, 'clock.nowMs')
    this.#nowMs = next
  }
}
