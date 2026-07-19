import { describe, expect, it, vi } from 'vitest'
import { PiperEngineHealth } from './piper-engine-health'
import {
  PiperVoiceRepairCoordinator,
  voiceInstallHashesMatch
} from './piper-voice-repair'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('PiperVoiceRepairCoordinator', () => {
  it('forces one concurrent reinstall for an existing crash-disabled voice and resets only on success', async () => {
    const health = new PiperEngineHealth(1)
    health.recordFailure('voice-a', 'runtime crash')
    const pending = deferred<{
      ok: boolean
      voiceId: string
      installed: boolean
    }>()
    const install = vi.fn(() => pending.promise)
    const coordinator = new PiperVoiceRepairCoordinator(
      health,
      () => true,
      install
    )

    const first = coordinator.ensure('voice-a')
    const second = coordinator.ensure('voice-a')
    expect(install).toHaveBeenCalledTimes(1)
    pending.resolve({
      ok: true,
      voiceId: 'voice-a',
      installed: true
    })

    await expect(first).resolves.toMatchObject({ ok: true, installed: true })
    await expect(second).resolves.toMatchObject({ ok: true, installed: true })
    expect(health.isDisabled('voice-a')).toBe(false)
    expect(health.recordSuccess('voice-a').ok).toBe(true)
  })

  it.each(['download failed', 'integrity hash mismatch'])(
    'keeps a failed repair disabled when %s',
    async (error) => {
      const health = new PiperEngineHealth(1)
      health.recordFailure('voice-a', 'runtime crash')
      const coordinator = new PiperVoiceRepairCoordinator(
        health,
        () => true,
        vi.fn(async () => ({
          ok: false,
          voiceId: 'voice-a',
          installed: false,
          error
        }))
      )

      await expect(coordinator.ensure('voice-a')).resolves.toMatchObject({
        ok: false,
        installed: false,
        error
      })
      expect(health.isDisabled('voice-a')).toBe(true)
      expect(health.cachedStatus?.ok).toBe(false)
    }
  )

  it('repairs an existing voice after the first runtime failure before hard disable', async () => {
    const health = new PiperEngineHealth(2)
    health.recordFailure('voice-a', 'transient crash')
    const install = vi.fn(async () => ({
      ok: true,
      voiceId: 'voice-a',
      installed: true
    }))
    const coordinator = new PiperVoiceRepairCoordinator(
      health,
      () => true,
      install
    )

    expect(health.isDisabled('voice-a')).toBe(false)
    expect(health.needsRepair('voice-a')).toBe(true)
    await coordinator.ensure('voice-a')

    expect(install).toHaveBeenCalledTimes(1)
    expect(health.needsRepair('voice-a')).toBe(false)
  })

  it('keeps a healthy existing voice on the no-download path', async () => {
    const health = new PiperEngineHealth(1)
    const install = vi.fn()
    const coordinator = new PiperVoiceRepairCoordinator(
      health,
      () => true,
      install
    )

    await expect(coordinator.ensure('voice-a')).resolves.toEqual({
      ok: true,
      voiceId: 'voice-a',
      installed: true
    })
    expect(install).not.toHaveBeenCalled()
  })
})

describe('voiceInstallHashesMatch', () => {
  it('accepts only exact model and token digests', () => {
    const expected = { onnx: 'a'.repeat(64), tokens: 'b'.repeat(64) }
    expect(voiceInstallHashesMatch(expected, expected)).toBe(true)
    expect(
      voiceInstallHashesMatch(expected, {
        ...expected,
        onnx: 'c'.repeat(64)
      })
    ).toBe(false)
    expect(
      voiceInstallHashesMatch(expected, {
        ...expected,
        tokens: 'd'.repeat(64)
      })
    ).toBe(false)
  })
})
