import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmulationEngine, type NutModule } from './emulation'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function backend(overrides: Partial<NutModule['keyboard']> = {}): {
  nut: NutModule
  pressKey: ReturnType<typeof vi.fn>
  releaseKey: ReturnType<typeof vi.fn>
} {
  const pressKey = vi.fn(overrides.pressKey ?? (() => undefined))
  const releaseKey = vi.fn(overrides.releaseKey ?? (() => undefined))
  return {
    nut: {
      keyboard: { pressKey, releaseKey },
      Key: { V: 'V', H: 'H', PageUp: 'PageUp' }
    },
    pressKey,
    releaseKey
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('EmulationEngine Touch hold serialization', () => {
  it('registers cancellation before pressDelay and never presses after a quick release', async () => {
    vi.useFakeTimers()
    const fake = backend()
    const engine = new EmulationEngine({ nut: fake.nut })

    const begin = engine.beginKeyboardHold('radio:main', {
      mode: 'hold',
      keys: ['V'],
      pressDelayMs: 100
    })
    const end = engine.endKeyboardHold('radio:main')
    await vi.advanceTimersByTimeAsync(100)

    await expect(begin).resolves.toMatchObject({ ok: true })
    await expect(end).resolves.toMatchObject({ ok: true })
    expect(fake.pressKey).not.toHaveBeenCalled()
    expect(fake.releaseKey).not.toHaveBeenCalled()
  })

  it('releases immediately when pointer-up races an in-flight key press', async () => {
    const pendingPress = deferred()
    const fake = backend({ pressKey: () => pendingPress.promise })
    const engine = new EmulationEngine({ nut: fake.nut })

    const begin = engine.beginKeyboardHold('radio:main', { mode: 'hold', keys: ['V'] })
    expect(fake.pressKey).toHaveBeenCalledWith('V')
    const end = engine.endKeyboardHold('radio:main')
    pendingPress.resolve()

    await begin
    await end
    expect(fake.releaseKey).toHaveBeenCalledTimes(1)
    expect(fake.releaseKey).toHaveBeenCalledWith('V')
    expect(fake.pressKey.mock.invocationCallOrder[0]).toBeLessThan(fake.releaseKey.mock.invocationCallOrder[0])
  })

  it('serializes replacement holds for the same token', async () => {
    const firstPress = deferred()
    let pressCount = 0
    const fake = backend({
      pressKey: () => {
        pressCount += 1
        return pressCount === 1 ? firstPress.promise : undefined
      }
    })
    const engine = new EmulationEngine({ nut: fake.nut })

    const first = engine.beginKeyboardHold('radio:main', { mode: 'hold', keys: ['V'] })
    const second = engine.beginKeyboardHold('radio:main', { mode: 'hold', keys: ['H'] })
    expect(fake.pressKey).toHaveBeenCalledTimes(1)
    firstPress.resolve()
    await first
    await second

    expect(fake.releaseKey).toHaveBeenCalledWith('V')
    expect(fake.pressKey).toHaveBeenNthCalledWith(2, 'H')
    await engine.endKeyboardHold('radio:main')
    expect(fake.releaseKey).toHaveBeenCalledWith('H')
  })
})

describe('EmulationEngine Touch latching teardown', () => {
  it('cancels an in-flight toggle activation and releases any late key-down', async () => {
    const pendingPress = deferred()
    const fake = backend({ pressKey: () => pendingPress.promise })
    const engine = new EmulationEngine({ nut: fake.nut })
    const command = { mode: 'toggle' as const, keys: ['H'] }

    const on = engine.setTouchKeyboardToggle('lights:latching', command, true)
    await vi.waitFor(() => expect(fake.pressKey).toHaveBeenCalledTimes(1))
    const off = engine.setTouchKeyboardToggle('lights:latching', command, false)
    pendingPress.resolve()
    await on
    await off

    expect(fake.pressKey).toHaveBeenCalledTimes(1)
    expect(fake.releaseKey).toHaveBeenCalledTimes(1)
    expect(fake.releaseKey).toHaveBeenCalledWith('H')
  })

  it('releases active Touch toggles during engine disposal', async () => {
    const fake = backend()
    const engine = new EmulationEngine({ nut: fake.nut })
    await engine.setTouchKeyboardToggle('lights:latching', { mode: 'toggle', keys: ['H'] }, true)

    await engine.dispose()

    expect(fake.pressKey).toHaveBeenCalledWith('H')
    expect(fake.releaseKey).toHaveBeenCalledWith('H')
  })
})