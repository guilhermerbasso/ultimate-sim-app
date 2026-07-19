import { describe, expect, it } from 'vitest'
import { PiperEngineHealth } from './piper-engine-health'

describe('PiperEngineHealth', () => {
  it('moves success through runtime failure to disabled without stale healthy cache', () => {
    const health = new PiperEngineHealth(2)

    expect(health.recordSuccess('voice-a')).toEqual({
      engine: 'sherpa',
      ok: true
    })
    const first = health.recordFailure('voice-a', 'worker crashed')
    expect(first).toMatchObject({
      count: 1,
      disabled: false,
      status: { engine: 'sherpa', ok: false }
    })
    expect(health.cachedStatus?.ok).toBe(false)
    const second = health.recordFailure('voice-a', 'worker crashed again')
    expect(second).toMatchObject({
      count: 2,
      disabled: true,
      status: { engine: 'sherpa', ok: false }
    })
    expect(health.isDisabled('voice-a')).toBe(true)
    health.recordSuccess('voice-b')
    expect(health.isDisabled('voice-a')).toBe(true)
  })

  it('supports recovery after a voice reset and successful synthesis', () => {
    const health = new PiperEngineHealth(1)
    health.recordFailure('voice-a', 'bad model')
    expect(health.isDisabled('voice-a')).toBe(true)

    health.resetVoice('voice-a')
    expect(health.cachedStatus).toBeNull()
    expect(health.isDisabled('voice-a')).toBe(false)
    expect(health.recordSuccess('voice-a').ok).toBe(true)
  })
})
