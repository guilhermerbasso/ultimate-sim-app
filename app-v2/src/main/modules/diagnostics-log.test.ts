import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import type { ModuleContext } from '../module-context'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import { instrumentBroadcast, instrumentIpcMain, register } from './diagnostics-log'
import { logger } from './logger'

// These taps must be invisible in normal operation and only emit verbose lines
// when the user has explicitly enabled diagnostic capture. They must NEVER alter
// the behaviour of the thing they wrap (broadcast / ipcMain), since the whole app
// — including iFlag/rev-lights, config-export internal signals, etc. — runs through
// them.

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('instrumentBroadcast', () => {
  it('always forwards to the underlying broadcast, verbose off or on', () => {
    vi.spyOn(logger, 'isVerbose').mockReturnValue(false)
    const verbose = vi.spyOn(logger, 'verbose').mockImplementation(() => {})
    const underlying = vi.fn()
    const broadcast = instrumentBroadcast(underlying)

    broadcast('telemetry:snapshot', { a: 1 })
    expect(underlying).toHaveBeenCalledWith('telemetry:snapshot', { a: 1 })
    expect(verbose).not.toHaveBeenCalled() // no-op when verbose is OFF
  })

  it('logs the channel (only) when verbose is on, and still forwards the payload', () => {
    vi.spyOn(logger, 'isVerbose').mockReturnValue(true)
    const verbose = vi.spyOn(logger, 'verbose').mockImplementation(() => {})
    const underlying = vi.fn()
    const broadcast = instrumentBroadcast(underlying)

    broadcast('overlay:update', { big: 'payload' })
    expect(underlying).toHaveBeenCalledWith('overlay:update', { big: 'payload' })
    expect(verbose).toHaveBeenCalledTimes(1)
    expect(verbose.mock.calls[0][0]).toBe('ipc')
    expect(String(verbose.mock.calls[0][1])).toContain('overlay:update')
  })

  it('does not let a logger failure break the broadcast', () => {
    vi.spyOn(logger, 'isVerbose').mockReturnValue(true)
    vi.spyOn(logger, 'verbose').mockImplementation(() => {
      throw new Error('disk full')
    })
    const underlying = vi.fn()
    const broadcast = instrumentBroadcast(underlying)

    expect(() => broadcast('any:channel', 1)).not.toThrow()
    expect(underlying).toHaveBeenCalledWith('any:channel', 1)
  })
})

describe('instrumentIpcMain', () => {
  function fakeIpc(): { ipc: IpcMain; handle: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn>; removeHandler: ReturnType<typeof vi.fn> } {
    const handle = vi.fn()
    const on = vi.fn()
    const emit = vi.fn()
    const removeHandler = vi.fn()
    const ipc = { handle, on, emit, removeHandler } as unknown as IpcMain
    return { ipc, handle, on, emit, removeHandler }
  }

  it('passes through non-handle methods unchanged (emit/on/removeHandler still work)', () => {
    const { ipc, on, emit, removeHandler } = fakeIpc()
    const inst = instrumentIpcMain(ipc)

    // config-export emits internal signals through ctx.ipcMain.emit / .on — these
    // MUST reach the real ipcMain untouched.
    inst.emit('config:reset-signal', 'dashboards')
    inst.on('config:reset-signal', () => {})
    inst.removeHandler('logs:export')

    expect(emit).toHaveBeenCalledWith('config:reset-signal', 'dashboards')
    expect(on).toHaveBeenCalledWith('config:reset-signal', expect.any(Function))
    expect(removeHandler).toHaveBeenCalledWith('logs:export')
  })

  it('registers handlers on the underlying ipcMain and preserves the listener result', async () => {
    vi.spyOn(logger, 'isVerbose').mockReturnValue(false)
    const { ipc, handle } = fakeIpc()
    const inst = instrumentIpcMain(ipc)

    const listener = vi.fn().mockResolvedValue(42)
    inst.handle('demo:channel', listener)

    expect(handle).toHaveBeenCalledTimes(1)
    expect(handle.mock.calls[0][0]).toBe('demo:channel')
    const wrapped = handle.mock.calls[0][1] as (...a: unknown[]) => unknown

    const event = { sender: {} }
    const result = await wrapped(event, 'arg1', 2)
    expect(listener).toHaveBeenCalledWith(event, 'arg1', 2)
    expect(result).toBe(42)
  })

  it('logs the channel when verbose is on, without altering the result', async () => {
    vi.spyOn(logger, 'isVerbose').mockReturnValue(true)
    const verbose = vi.spyOn(logger, 'verbose').mockImplementation(() => {})
    const { ipc, handle } = fakeIpc()
    const inst = instrumentIpcMain(ipc)

    inst.handle('demo:verbose', vi.fn().mockReturnValue('ok'))
    const wrapped = handle.mock.calls[0][1] as (...a: unknown[]) => unknown
    const result = await wrapped({}, 'x')

    expect(result).toBe('ok')
    expect(verbose).toHaveBeenCalledTimes(1)
    expect(verbose.mock.calls[0][0]).toBe('ipc')
    expect(String(verbose.mock.calls[0][1])).toContain('demo:verbose')
  })

  it('does not let a logging failure break the real handler', () => {
    vi.spyOn(logger, 'isVerbose').mockReturnValue(true)
    vi.spyOn(logger, 'verbose').mockImplementation(() => {
      throw new Error('boom')
    })
    const { ipc, handle } = fakeIpc()
    const inst = instrumentIpcMain(ipc)

    inst.handle('demo:resilient', vi.fn().mockReturnValue('still-ok'))
    const wrapped = handle.mock.calls[0][1] as (...a: unknown[]) => unknown
    expect(() => wrapped({}, 1)).not.toThrow()
    expect(wrapped({}, 1)).toBe('still-ok')
  })
})

describe('register — telemetry discrete-change tap', () => {
  // Capture the snapshot listener the tap registers, plus every verbose() message.
  function setup(): { drive: (s: TelemetrySnapshot | null) => void; messages: () => string[]; verbose: ReturnType<typeof vi.spyOn> } {
    let listener: ((s: TelemetrySnapshot | null) => void) | undefined
    const ctx = {
      telemetryHub: {
        on: (event: string, cb: (s: TelemetrySnapshot | null) => void) => {
          if (event === 'snapshot') listener = cb
        }
      }
    } as unknown as ModuleContext
    vi.spyOn(logger, 'isVerbose').mockReturnValue(true)
    const verbose = vi.spyOn(logger, 'verbose').mockImplementation(() => {})
    register(ctx)
    return {
      drive: (s) => listener?.(s),
      messages: () => verbose.mock.calls.map((c) => String(c[1])),
      verbose
    }
  }

  const snap = (over: Partial<TelemetrySnapshot>): TelemetrySnapshot =>
    ({ connected: true, gear: 0, ...over }) as TelemetrySnapshot

  it('emits immediate change lines for REAL keys (sessionFlagsRaw, onPitRoad)', () => {
    const t = setup()
    t.drive(snap({ onPitRoad: true, currentLap: 1, gear: 0, sessionFlagsRaw: 0 }))
    t.verbose.mockClear()

    // A flag-bitmask transition that exists ONLY between two periodic dumps must be
    // captured immediately — this is the Major the QA caught (was a dead key).
    t.drive(snap({ onPitRoad: true, currentLap: 1, gear: 0, sessionFlagsRaw: 0x0004 }))
    expect(t.messages()).toContain('change sessionFlagsRaw')

    t.verbose.mockClear()
    t.drive(snap({ onPitRoad: false, currentLap: 1, gear: 0, sessionFlagsRaw: 0x0004 }))
    expect(t.messages()).toContain('change onPitRoad')
  })

  it('logs connection exactly once per transition (no duplicate "change connected")', () => {
    const t = setup()
    t.drive(snap({ onPitRoad: false, currentLap: 1, gear: 0, sessionFlagsRaw: 0 }))
    const msgs = t.messages()
    expect(msgs).toContain('connection up') // explicit connect line
    expect(msgs).not.toContain('change connected') // not double-logged via DISCRETE_KEYS
  })

  it('does nothing when verbose is OFF', () => {
    let listener: ((s: TelemetrySnapshot | null) => void) | undefined
    const ctx = {
      telemetryHub: { on: (e: string, cb: (s: TelemetrySnapshot | null) => void) => { if (e === 'snapshot') listener = cb } }
    } as unknown as ModuleContext
    vi.spyOn(logger, 'isVerbose').mockReturnValue(false)
    const verbose = vi.spyOn(logger, 'verbose').mockImplementation(() => {})
    register(ctx)
    verbose.mockClear() // ignore the one-time "tap installed" line
    listener?.(snap({ onPitRoad: true, gear: 3, sessionFlagsRaw: 1 }))
    expect(verbose).not.toHaveBeenCalled()
  })
})
