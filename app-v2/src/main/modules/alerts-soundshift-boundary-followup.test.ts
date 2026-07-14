import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModuleContext } from '../module-context'
import type { ReplayContext, ReplayContextState } from '../../shared/replay'
import { SOUNDSHIFT_CHANNELS } from '../../shared/soundshift'
import type { TelemetrySnapshot } from '../../shared/telemetry'

vi.mock('../settings/events', () => ({
  settingsEvents: { onChanged: vi.fn() }
}))

vi.mock('./logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

const scratchDirs: string[] = []

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.doUnmock('node:fs/promises')
  vi.useRealTimers()
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(name: string): string {
  const dir = join(process.cwd(), `.boundary-followup-${name}-${process.pid}-${Date.now()}-${scratchDirs.length}`)
  mkdirSync(dir, { recursive: true })
  scratchDirs.push(dir)
  return dir
}

function context(
  state: ReplayContextState,
  revision: number,
  token = `1:${revision}`,
  sessionIdentity = 'session-a',
  connectionEpoch = 1
): ReplayContext {
  return {
    state,
    reason: state === 'live' ? 'confirmed-live' : state === 'replay' ? 'replay-playing' : 'missing-metadata',
    inputs: {},
    active: state !== 'live',
    revision,
    token,
    sessionIdentity,
    connectionEpoch
  }
}

function snapshot(
  state: ReplayContextState,
  revision: number,
  overrides: Partial<TelemetrySnapshot> = {},
  token = `1:${revision}`
): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 1_000 + revision * 100,
    speedKmh: 180,
    rpm: 6_000,
    gear: 3,
    throttle: 0.8,
    brake: 0,
    clutch: 0,
    replayContext: context(state, revision, token),
    ...overrides
  }
}

interface HarnessOptions {
  sendRaw?: (command: string) => Promise<void>
  sendOled?: (line1: string, line2: string, line3: string) => Promise<void>
  sendBigNum?: (value: string) => Promise<void>
}

function moduleHarness(name: string, options: HarnessOptions = {}) {
  const userData = scratch(name)
  const handlers = new Map<string, (...args: any[]) => any>()
  const listeners: Array<(value: TelemetrySnapshot | null) => void> = []
  const serialListeners = new Map<string, Set<(summary: unknown) => void>>()
  const teardowns: Array<() => Promise<void> | void> = []
  const broadcast = vi.fn()
  const device = {
    sendRaw: vi.fn(options.sendRaw ?? (async (_command: string) => undefined)),
    sendOled: vi.fn(options.sendOled ?? (async (_line1: string, _line2: string, _line3: string) => undefined)),
    sendBigNum: vi.fn(options.sendBigNum ?? (async (_value: string) => undefined)),
    isOpen: vi.fn(() => true)
  }
  let currentDevice = device
  let latest: TelemetrySnapshot | null = null
  const ctx = {
    app: { getPath: () => userData },
    ipcMain: {
      handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler)
    },
    telemetryHub: {
      on: (event: string, handler: (value: TelemetrySnapshot | null) => void) => {
        if (event === 'snapshot') listeners.push(handler)
      },
      getLatest: () => latest
    },
    serialHub: {
      getPrimary: () => currentDevice,
      getPrimaryId: () => 'simx',
      getDevice: (id: string) => (id === 'simx' ? currentDevice : null),
      on: (event: string, handler: (summary: unknown) => void) => {
        const handlersForEvent = serialListeners.get(event) ?? new Set()
        handlersForEvent.add(handler)
        serialListeners.set(event, handlersForEvent)
      },
      off: (event: string, handler: (summary: unknown) => void) => {
        serialListeners.get(event)?.delete(handler)
      }
    },
    broadcast,
    getMainWindow: () => null,
    registerGracefulTeardown: vi.fn((task: () => Promise<void> | void) => {
      teardowns.push(task)
      return () => undefined
    })
  } as unknown as ModuleContext

  return {
    ctx,
    handlers,
    broadcast,
    device,
    teardowns,
    setDevice(nextDevice: typeof device) {
      currentDevice = nextDevice
    },
    emit(value: TelemetrySnapshot | null) {
      latest = value
      for (const listener of listeners) listener(value)
    },
    emitSerial(event: string, summary: unknown) {
      for (const listener of serialListeners.get(event) ?? []) listener(summary)
    }
  }
}

async function settleConfigLoad(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 50))
}

function callsFor(broadcast: ReturnType<typeof vi.fn>, channel: string): unknown[] {
  return broadcast.mock.calls.filter(([actual]) => actual === channel).map(([, payload]) => payload)
}

async function settleSoundshiftConfigLoad(broadcast: ReturnType<typeof vi.fn>): Promise<void> {
  await vi.waitFor(() => {
    expect(callsFor(broadcast, SOUNDSHIFT_CHANNELS.configEvent)).toHaveLength(1)
  })
}

async function settleHardwareWrites(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('alerts hardware boundary cleanup', () => {
  it('waits for persisted config and silently seeds the latest live shift frame', async () => {
    const configRead = deferred<string>()
    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
      return {
        ...actual,
        readFile: vi.fn(() => configRead.promise)
      }
    })
    const { register } = await import('./alerts')
    const harness = moduleHarness('alerts-delayed-config')
    register(harness.ctx)

    const low = { rpm: 6_000, maxRpm: 8_000, shiftIndicatorPct: 0.2 }
    const active = { rpm: 7_000, maxRpm: 8_000, shiftIndicatorPct: 0.85 }
    harness.emit(snapshot('live', 0, active))
    harness.emit(snapshot('live', 0, { ...active, timestamp: 1_100 }))
    await settleHardwareWrites()
    expect(callsFor(harness.broadcast, 'alerts:event')).toEqual([])
    expect(harness.device.sendRaw).not.toHaveBeenCalled()

    configRead.resolve(
      JSON.stringify({
        shiftPoint: {
          enabled: true,
          shiftIndicatorPct: 0.8,
          rpmPct: 0.85,
          outputs: [{ kind: 'buttonbox', preset: 'startLedFlash', durationMs: 1_000 }]
        }
      })
    )
    await vi.waitFor(() => {
      expect(harness.handlers.get('alerts:getConfig')?.()).toMatchObject({
        shiftPoint: { shiftIndicatorPct: 0.8, rpmPct: 0.85 }
      })
    })

    vi.useFakeTimers()
    harness.emit(snapshot('live', 0, { ...active, timestamp: 1_200 }))
    harness.emit(snapshot('live', 0, { ...active, timestamp: 1_300 }))
    await settleHardwareWrites()
    expect(callsFor(harness.broadcast, 'alerts:event')).toEqual([])
    expect(harness.device.sendRaw).not.toHaveBeenCalled()

    harness.emit(snapshot('live', 0, { ...low, timestamp: 1_400 }))
    harness.emit(snapshot('live', 0, { ...active, timestamp: 1_500 }))
    await settleHardwareWrites()
    expect(callsFor(harness.broadcast, 'alerts:event')).toEqual([
      expect.objectContaining({ type: 'shiftPoint' })
    ])
    expect(harness.device.sendRaw.mock.calls.map(([command]) => command)).toEqual(['S1'])

    harness.emit(snapshot('replay', 1))
    await settleHardwareWrites()
  })

  it('seeds only the latest live context when a boundary occurs during config load', async () => {
    const configRead = deferred<string>()
    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
      return {
        ...actual,
        readFile: vi.fn(() => configRead.promise)
      }
    })
    const { register } = await import('./alerts')
    const harness = moduleHarness('alerts-delayed-config-boundary')
    register(harness.ctx)

    const low = { rpm: 6_000, maxRpm: 8_000, shiftIndicatorPct: 0.2 }
    const active = { rpm: 7_000, maxRpm: 8_000, shiftIndicatorPct: 0.85 }
    harness.emit(snapshot('live', 0, active))
    harness.emit(snapshot('unknown', 1, active))
    const nextContext = context('live', 2, '2:2', 'session-b', 2)
    harness.emit(snapshot('live', 2, { ...low, replayContext: nextContext }))

    configRead.resolve(
      JSON.stringify({
        shiftPoint: {
          enabled: true,
          shiftIndicatorPct: 0.8,
          rpmPct: 0.85,
          outputs: [{ kind: 'buttonbox', preset: 'startLedFlash', durationMs: 1_000 }]
        }
      })
    )
    await vi.waitFor(() => {
      expect(harness.handlers.get('alerts:getConfig')?.()).toMatchObject({
        shiftPoint: { shiftIndicatorPct: 0.8, rpmPct: 0.85 }
      })
    })

    vi.useFakeTimers()
    harness.emit(
      snapshot('live', 2, {
        ...active,
        timestamp: 1_300,
        replayContext: nextContext
      })
    )
    await settleHardwareWrites()
    expect(callsFor(harness.broadcast, 'alerts:event')).toEqual([
      expect.objectContaining({ type: 'shiftPoint' })
    ])
    expect(harness.device.sendRaw.mock.calls.map(([command]) => command)).toEqual(['S1'])

    harness.emit(snapshot('replay', 3))
    await settleHardwareWrites()
  })

  it('does not let a stopped registration seed a newer registration', async () => {
    const stoppedConfigRead = deferred<string>()
    const currentConfigRead = deferred<string>()
    const configReads = [stoppedConfigRead.promise, currentConfigRead.promise]
    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
      return {
        ...actual,
        readFile: vi.fn(() => configReads.shift() ?? Promise.reject(new Error('unexpected config read')))
      }
    })
    const { register } = await import('./alerts')
    const stoppedHarness = moduleHarness('alerts-stopped-config')
    register(stoppedHarness.ctx)

    const low = { rpm: 6_000, maxRpm: 8_000, shiftIndicatorPct: 0.2 }
    const heldByStoppedRegistration = { rpm: 6_000, maxRpm: 8_000, shiftIndicatorPct: 0.75 }
    const active = { rpm: 7_000, maxRpm: 8_000, shiftIndicatorPct: 0.85 }
    stoppedHarness.emit(snapshot('live', 0, heldByStoppedRegistration))
    await Promise.resolve(stoppedHarness.teardowns[0]())

    const currentHarness = moduleHarness('alerts-current-config')
    register(currentHarness.ctx)
    currentHarness.emit(snapshot('live', 0, low))
    currentConfigRead.resolve(
      JSON.stringify({
        shiftPoint: {
          enabled: true,
          shiftIndicatorPct: 0.8,
          rpmPct: 0.85,
          outputs: [{ kind: 'buttonbox', preset: 'startLedFlash', durationMs: 1_000 }]
        }
      })
    )
    await vi.waitFor(() => {
      expect(currentHarness.handlers.get('alerts:getConfig')?.()).toMatchObject({
        shiftPoint: { shiftIndicatorPct: 0.8, rpmPct: 0.85 }
      })
    })

    stoppedConfigRead.resolve(
      JSON.stringify({
        shiftPoint: {
          enabled: true,
          shiftIndicatorPct: 0.7,
          rpmPct: 0.7,
          outputs: [{ kind: 'buttonbox', preset: 'startLedFlash', durationMs: 1_000 }]
        }
      })
    )
    await settleHardwareWrites()
    expect(currentHarness.handlers.get('alerts:getConfig')?.()).toMatchObject({
      shiftPoint: { shiftIndicatorPct: 0.8, rpmPct: 0.85 }
    })

    vi.useFakeTimers()
    currentHarness.emit(snapshot('live', 0, { ...active, timestamp: 1_100 }))
    await settleHardwareWrites()
    expect(callsFor(currentHarness.broadcast, 'alerts:event')).toEqual([
      expect.objectContaining({ type: 'shiftPoint' })
    ])
    expect(currentHarness.device.sendRaw.mock.calls.map(([command]) => command)).toEqual(['S1'])

    currentHarness.emit(snapshot('replay', 1))
    await settleHardwareWrites()
  })

  it('neutralizes every active SIM-X output before cancelling timers and only once per non-live boundary', async () => {
    const { register } = await import('./alerts')
    const harness = moduleHarness('alerts-neutralize')
    register(harness.ctx)
    await settleConfigLoad()
    await harness.handlers.get('alerts:setConfig')?.(undefined, {
      pitLimiter: {
        outputs: [
          { kind: 'buttonbox', preset: 'startLedFlash', durationMs: 5_000 },
          { kind: 'buttonbox', preset: 'revLightsPulse', revLevel: 3, durationMs: 5_000 },
          { kind: 'buttonbox', preset: 'shiftBlink', durationMs: 5_000 },
          { kind: 'buttonbox', preset: 'oledMessage', oledLine1: 'PIT', durationMs: 5_000 },
          { kind: 'buttonbox', preset: 'bigNum', bigNumValue: '7' },
          { kind: 'sound', toneHz: 1_200, durationMs: 80, volume: 0.5 }
        ]
      }
    })

    vi.useFakeTimers()
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    harness.emit(snapshot('live', 0, { pitLimiter: false }))
    harness.broadcast.mockClear()

    harness.emit(snapshot('live', 0, { timestamp: 1_100, pitLimiter: true }))
    await settleHardwareWrites()
    expect(callsFor(harness.broadcast, 'alerts:event')).toEqual([
      expect.objectContaining({ type: 'pitLimiter', sound: { toneHz: 1_200, durationMs: 80, volume: 0.5 } })
    ])
    expect(harness.device.sendRaw.mock.calls.map(([command]) => command)).toEqual(['S1', 'R3', 'B1'])
    expect(harness.device.sendOled).toHaveBeenCalledWith('PIT', '', '')
    expect(harness.device.sendBigNum).toHaveBeenCalledWith('7')

    const replay = snapshot('replay', 1, { pitLimiter: true })
    const clearsBeforeBoundary = clearTimeoutSpy.mock.invocationCallOrder.length
    harness.emit(replay)
    await settleHardwareWrites()

    expect(harness.device.sendRaw.mock.calls.map(([command]) => command)).toEqual([
      'S1',
      'R3',
      'B1',
      'S0',
      'R0',
      'B0'
    ])
    expect(harness.device.sendOled.mock.calls.filter((args) => args.every((value) => value === ''))).toHaveLength(1)

    const neutralizerOrders = [
      ...harness.device.sendRaw.mock.invocationCallOrder.slice(3),
      ...harness.device.sendOled.mock.invocationCallOrder.slice(1)
    ]
    const boundaryClearOrders = clearTimeoutSpy.mock.invocationCallOrder.slice(clearsBeforeBoundary)
    expect(Math.max(...neutralizerOrders)).toBeLessThan(Math.min(...boundaryClearOrders))

    const rawCount = harness.device.sendRaw.mock.calls.length
    const oledCount = harness.device.sendOled.mock.calls.length
    harness.emit(replay)
    await vi.advanceTimersByTimeAsync(6_000)
    await settleHardwareWrites()
    expect(harness.device.sendRaw).toHaveBeenCalledTimes(rawCount)
    expect(harness.device.sendOled).toHaveBeenCalledTimes(oledCount)
  })

  it('silently seeds active alert conditions after replay and token-only live context changes', async () => {
    const { register } = await import('./alerts')
    const harness = moduleHarness('alerts-seed')
    register(harness.ctx)
    await settleConfigLoad()
    await harness.handlers.get('alerts:setConfig')?.(undefined, {
      pitLimiter: {
        outputs: [
          { kind: 'buttonbox', preset: 'startLedFlash', durationMs: 1_000 },
          { kind: 'sound', toneHz: 1_100 }
        ]
      },
      flags: {
        outputs: [
          { kind: 'buttonbox', preset: 'revLightsPulse', revLevel: 2, durationMs: 1_000 },
          { kind: 'sound', toneHz: 900 }
        ]
      }
    })

    vi.useFakeTimers()
    const clearFlags = { yellow: false } as TelemetrySnapshot['flags']
    const yellowFlags = { yellow: true } as TelemetrySnapshot['flags']
    harness.emit(snapshot('live', 0, { pitLimiter: false, flags: clearFlags }))
    harness.emit(snapshot('replay', 1, { pitLimiter: true, flags: yellowFlags }))
    harness.broadcast.mockClear()
    harness.device.sendRaw.mockClear()

    harness.emit(snapshot('live', 2, { pitLimiter: true, flags: yellowFlags }))
    harness.emit(snapshot('live', 2, { timestamp: 1_300, pitLimiter: true, flags: yellowFlags }))
    expect(callsFor(harness.broadcast, 'alerts:event')).toEqual([])
    expect(harness.device.sendRaw).not.toHaveBeenCalled()

    harness.emit(snapshot('live', 2, { timestamp: 1_400, pitLimiter: false, flags: clearFlags }))
    harness.emit(snapshot('live', 2, { timestamp: 1_500, pitLimiter: true, flags: yellowFlags }))
    await settleHardwareWrites()
    expect(callsFor(harness.broadcast, 'alerts:event')).toEqual([
      expect.objectContaining({ type: 'pitLimiter', sound: expect.any(Object) }),
      expect.objectContaining({ type: 'flag', sound: expect.any(Object) })
    ])
    expect(harness.device.sendRaw.mock.calls.map(([command]) => command)).toEqual(['S1', 'R2'])

    await vi.advanceTimersByTimeAsync(1_000)
    await settleHardwareWrites()
    harness.emit(snapshot('live', 2, { timestamp: 1_600, pitLimiter: false, flags: clearFlags }))
    harness.broadcast.mockClear()
    harness.device.sendRaw.mockClear()

    harness.emit(snapshot('live', 2, { timestamp: 1_700, pitLimiter: true, flags: yellowFlags }, 'token-b'))
    harness.emit(snapshot('live', 2, { timestamp: 1_800, pitLimiter: true, flags: yellowFlags }, 'token-b'))
    expect(callsFor(harness.broadcast, 'alerts:event')).toEqual([])
    expect(harness.device.sendRaw).not.toHaveBeenCalled()

    harness.emit(snapshot('live', 2, { timestamp: 1_900, pitLimiter: false, flags: clearFlags }, 'token-b'))
    harness.emit(snapshot('live', 2, { timestamp: 2_000, pitLimiter: true, flags: yellowFlags }, 'token-b'))
    await settleHardwareWrites()
    expect(callsFor(harness.broadcast, 'alerts:event').map((event: any) => event.type)).toEqual([
      'pitLimiter',
      'flag'
    ])
    expect(harness.device.sendRaw.mock.calls.map(([command]) => command)).toEqual(['S1', 'R2'])

    harness.emit(snapshot('replay', 3))
    await settleHardwareWrites()
  })

  it('keeps a shared start LED asserted until the last overlapping lease expires', async () => {
    const { register } = await import('./alerts')
    const harness = moduleHarness('alerts-start-leases')
    register(harness.ctx)
    await settleConfigLoad()
    await harness.handlers.get('alerts:setConfig')?.(undefined, {
      pitLimiter: {
        outputs: [{ kind: 'buttonbox', preset: 'startLedFlash', durationMs: 500 }]
      },
      flags: {
        outputs: [{ kind: 'buttonbox', preset: 'startLedFlash', durationMs: 1_000 }]
      }
    })

    vi.useFakeTimers()
    const clearFlags = { yellow: false } as TelemetrySnapshot['flags']
    const yellowFlags = { yellow: true } as TelemetrySnapshot['flags']
    harness.emit(snapshot('live', 0, { pitLimiter: false, flags: clearFlags }))
    harness.emit(snapshot('live', 0, { timestamp: 1_100, pitLimiter: true, flags: yellowFlags }))
    await settleHardwareWrites()
    expect(harness.device.sendRaw.mock.calls.map(([command]) => command)).toEqual(['S1'])

    await vi.advanceTimersByTimeAsync(500)
    await settleHardwareWrites()
    expect(harness.device.sendRaw.mock.calls.map(([command]) => command)).toEqual(['S1'])

    await vi.advanceTimersByTimeAsync(500)
    await settleHardwareWrites()
    expect(harness.device.sendRaw.mock.calls.map(([command]) => command)).toEqual(['S1', 'S0'])
  })

  it('restores the remaining BigNum lease when a newer OLED lease expires', async () => {
    const { register } = await import('./alerts')
    const harness = moduleHarness('alerts-display-leases')
    register(harness.ctx)
    await settleConfigLoad()
    await harness.handlers.get('alerts:setConfig')?.(undefined, {
      pitLimiter: {
        outputs: [{ kind: 'buttonbox', preset: 'bigNum', bigNumValue: '7' }]
      },
      flags: {
        outputs: [{ kind: 'buttonbox', preset: 'oledMessage', oledLine1: 'YELLOW', durationMs: 500 }]
      }
    })

    vi.useFakeTimers()
    const clearFlags = { yellow: false } as TelemetrySnapshot['flags']
    const yellowFlags = { yellow: true } as TelemetrySnapshot['flags']
    harness.emit(snapshot('live', 0, { pitLimiter: false, flags: clearFlags }))
    harness.emit(snapshot('live', 0, { timestamp: 1_100, pitLimiter: true, flags: yellowFlags }))
    await settleHardwareWrites()
    expect(harness.device.sendBigNum.mock.calls).toEqual([['7']])
    expect(harness.device.sendOled.mock.calls).toEqual([['YELLOW', '', '']])

    await vi.advanceTimersByTimeAsync(500)
    await settleHardwareWrites()
    expect(harness.device.sendBigNum.mock.calls).toEqual([['7'], ['7']])
    expect(harness.device.sendOled.mock.calls).toEqual([['YELLOW', '', '']])

    harness.emit(snapshot('replay', 1))
    await settleHardwareWrites()
    expect(harness.device.sendOled.mock.calls).toEqual([
      ['YELLOW', '', ''],
      ['', '', '']
    ])
  })

  it('retains a failed neutralization and retries it without duplicate writes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let neutralAttempts = 0
    const harness = moduleHarness('alerts-neutral-retry', {
      sendRaw: async (command) => {
        if (command !== 'S0') return
        neutralAttempts += 1
        if (neutralAttempts === 1) throw new Error('first neutral write failed')
      }
    })
    const { register } = await import('./alerts')
    register(harness.ctx)
    await settleConfigLoad()
    await harness.handlers.get('alerts:setConfig')?.(undefined, {
      pitLimiter: {
        outputs: [{ kind: 'buttonbox', preset: 'startLedFlash', durationMs: 100 }]
      }
    })

    vi.useFakeTimers()
    harness.emit(snapshot('live', 0, { pitLimiter: false }))
    harness.emit(snapshot('live', 0, { timestamp: 1_100, pitLimiter: true }))
    await settleHardwareWrites()

    await vi.advanceTimersByTimeAsync(100)
    await settleHardwareWrites()
    expect(neutralAttempts).toBe(1)

    await vi.advanceTimersByTimeAsync(100)
    await settleHardwareWrites()
    expect(neutralAttempts).toBe(2)
    expect(harness.device.sendRaw.mock.calls.map(([command]) => command)).toEqual(['S1', 'S0', 'S0'])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('retries retained neutralization immediately when the device reconnects', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let neutralAttempts = 0
    const harness = moduleHarness('alerts-neutral-reconnect', {
      sendRaw: async (command) => {
        if (command !== 'S0') return
        neutralAttempts += 1
        if (neutralAttempts === 1) throw new Error('disconnected during neutral')
      }
    })
    const { register } = await import('./alerts')
    register(harness.ctx)
    await settleConfigLoad()
    await harness.handlers.get('alerts:setConfig')?.(undefined, {
      pitLimiter: {
        outputs: [{ kind: 'buttonbox', preset: 'startLedFlash', durationMs: 100 }]
      }
    })

    vi.useFakeTimers()
    harness.emit(snapshot('live', 0, { pitLimiter: false }))
    harness.emit(snapshot('live', 0, { timestamp: 1_100, pitLimiter: true }))
    await settleHardwareWrites()
    await vi.advanceTimersByTimeAsync(100)
    await settleHardwareWrites()
    expect(neutralAttempts).toBe(1)

    harness.emitSerial('device-updated', { id: 'simx', connected: true })
    await settleHardwareWrites()
    expect(neutralAttempts).toBe(2)

    await vi.advanceTimersByTimeAsync(500)
    await settleHardwareWrites()
    expect(neutralAttempts).toBe(2)
  })

  it('bounds never-settling activation and neutral writes while neutralizing immediately at a boundary', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const harness = moduleHarness('alerts-never-settling-boundary', {
      sendRaw: () => new Promise<void>(() => undefined)
    })
    const { register } = await import('./alerts')
    register(harness.ctx)
    await settleConfigLoad()
    await harness.handlers.get('alerts:setConfig')?.(undefined, {
      pitLimiter: {
        outputs: [{ kind: 'buttonbox', preset: 'startLedFlash', durationMs: 5_000 }]
      }
    })

    vi.useFakeTimers()
    harness.emit(snapshot('live', 0, { pitLimiter: false }))
    harness.emit(snapshot('live', 0, { timestamp: 1_100, pitLimiter: true }))
    expect(harness.device.sendRaw.mock.calls.map(([command]) => command)).toEqual(['S1'])

    harness.emit(snapshot('replay', 1))
    expect(harness.device.sendRaw.mock.calls.map(([command]) => command)).toEqual(['S1', 'S0'])

    await vi.advanceTimersByTimeAsync(400)
    await settleHardwareWrites()
    expect(harness.device.sendRaw.mock.calls.map(([command]) => command)).toEqual(['S1', 'S0', 'S0'])
  })

  it('ignores late completion from a timed-out neutral attempt without deleting newer state', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const lateNeutral = deferred<void>()
    let neutralAttempts = 0
    const harness = moduleHarness('alerts-late-neutral', {
      sendRaw: (command) => {
        if (command !== 'S0') return Promise.resolve()
        neutralAttempts += 1
        return neutralAttempts === 1 ? lateNeutral.promise : Promise.resolve()
      }
    })
    const { register } = await import('./alerts')
    register(harness.ctx)
    await settleConfigLoad()
    await harness.handlers.get('alerts:setConfig')?.(undefined, {
      pitLimiter: {
        outputs: [{ kind: 'buttonbox', preset: 'startLedFlash', durationMs: 500 }]
      }
    })

    vi.useFakeTimers()
    harness.emit(snapshot('live', 0, { pitLimiter: false }))
    harness.emit(snapshot('live', 0, { timestamp: 1_100, pitLimiter: true }))
    await settleHardwareWrites()
    harness.emit(snapshot('replay', 1))

    await vi.advanceTimersByTimeAsync(400)
    await settleHardwareWrites()
    expect(neutralAttempts).toBe(2)

    harness.emit(snapshot('live', 2, { pitLimiter: false }))
    harness.emit(snapshot('live', 2, { timestamp: 1_300, pitLimiter: true }))
    await settleHardwareWrites()
    lateNeutral.resolve()
    await settleHardwareWrites()

    await vi.advanceTimersByTimeAsync(500)
    await settleHardwareWrites()
    expect(harness.device.sendRaw.mock.calls.map(([command]) => command)).toEqual([
      'S1',
      'S0',
      'S0',
      'S1',
      'S0'
    ])
  })

  it('reissues pending neutralization to a replacement device on reconnect', async () => {
    const oldNeutral = deferred<void>()
    const replacementNeutral = deferred<void>()
    let oldNeutralAttempts = 0
    let replacementNeutralAttempts = 0
    const harness = moduleHarness('alerts-reconnect-pending-neutral', {
      sendRaw: (command) => {
        if (command !== 'S0') return Promise.resolve()
        oldNeutralAttempts += 1
        return oldNeutral.promise
      }
    })
    const replacement = {
      sendRaw: vi.fn((command: string) => {
        if (command !== 'S0') return Promise.resolve()
        replacementNeutralAttempts += 1
        return replacementNeutralAttempts === 1 ? replacementNeutral.promise : Promise.resolve()
      }),
      sendOled: vi.fn(async (_line1: string, _line2: string, _line3: string) => undefined),
      sendBigNum: vi.fn(async (_value: string) => undefined),
      isOpen: vi.fn(() => true)
    }
    const { register } = await import('./alerts')
    register(harness.ctx)
    await settleConfigLoad()
    await harness.handlers.get('alerts:setConfig')?.(undefined, {
      pitLimiter: {
        outputs: [{ kind: 'buttonbox', preset: 'startLedFlash', durationMs: 5_000 }]
      }
    })

    harness.emit(snapshot('live', 0, { pitLimiter: false }))
    harness.emit(snapshot('live', 0, { timestamp: 1_100, pitLimiter: true }))
    await settleHardwareWrites()
    harness.emit(snapshot('replay', 1))
    expect(oldNeutralAttempts).toBe(1)

    harness.setDevice(replacement)
    harness.emitSerial('device-updated', { id: 'simx', connected: true })
    expect(replacementNeutralAttempts).toBe(1)

    oldNeutral.resolve()
    await settleHardwareWrites()
    expect(replacementNeutralAttempts).toBe(1)
    replacementNeutral.resolve()
    await settleHardwareWrites()

    harness.emit(snapshot('live', 2, { pitLimiter: false }))
    harness.emit(snapshot('live', 2, { timestamp: 1_300, pitLimiter: true }))
    await settleHardwareWrites()
    expect(replacement.sendRaw.mock.calls.map(([command]) => command)).toEqual(['S0', 'S1'])

    harness.emit(snapshot('replay', 3))
    await settleHardwareWrites()
  })

  it('silently seeds an initially active live alert before allowing a real edge', async () => {
    const { register } = await import('./alerts')
    const harness = moduleHarness('alerts-initial-live')
    register(harness.ctx)
    await settleConfigLoad()
    await harness.handlers.get('alerts:setConfig')?.(undefined, {
      pitLimiter: {
        outputs: [
          { kind: 'buttonbox', preset: 'startLedFlash', durationMs: 1_000 },
          { kind: 'sound', toneHz: 1_100 }
        ]
      }
    })

    vi.useFakeTimers()
    harness.emit(snapshot('live', 0, { pitLimiter: true }))
    await settleHardwareWrites()
    expect(callsFor(harness.broadcast, 'alerts:event')).toEqual([])
    expect(harness.device.sendRaw).not.toHaveBeenCalled()

    harness.emit(snapshot('live', 0, { timestamp: 1_100, pitLimiter: false }))
    harness.emit(snapshot('live', 0, { timestamp: 1_200, pitLimiter: true }))
    await settleHardwareWrites()
    expect(callsFor(harness.broadcast, 'alerts:event')).toEqual([
      expect.objectContaining({ type: 'pitLimiter', sound: expect.any(Object) })
    ])
    expect(harness.device.sendRaw.mock.calls.map(([command]) => command)).toEqual(['S1'])

    harness.emit(snapshot('replay', 1))
    await settleHardwareWrites()
  })

  it('stops new effects and awaits a retried neutral write during graceful teardown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const order: string[] = []
    let neutralAttempts = 0
    let resolveDrain: (() => void) | undefined
    const harness = moduleHarness('alerts-teardown-drain', {
      sendRaw: (command) => {
        if (command !== 'S0') {
          order.push(command)
          return Promise.resolve()
        }
        neutralAttempts += 1
        order.push(`S0:${neutralAttempts}`)
        if (neutralAttempts === 1) return Promise.reject(new Error('retry teardown neutral'))
        return new Promise<void>((resolve) => {
          resolveDrain = () => {
            order.push('S0:drained')
            resolve()
          }
        })
      }
    })
    const { register } = await import('./alerts')
    register(harness.ctx)
    await settleConfigLoad()
    await harness.handlers.get('alerts:setConfig')?.(undefined, {
      pitLimiter: {
        outputs: [{ kind: 'buttonbox', preset: 'startLedFlash', durationMs: 5_000 }]
      }
    })

    harness.emit(snapshot('live', 0, { pitLimiter: false }))
    harness.emit(snapshot('live', 0, { timestamp: 1_100, pitLimiter: true }))
    await settleHardwareWrites()
    expect(order).toEqual(['S1'])
    expect(harness.teardowns).toHaveLength(1)

    const teardownPromise = Promise.resolve(harness.teardowns[0]())
    await vi.waitFor(() => expect(neutralAttempts).toBe(2))

    harness.emit(snapshot('live', 0, { timestamp: 1_200, pitLimiter: false }))
    harness.emit(snapshot('live', 0, { timestamp: 1_300, pitLimiter: true }))
    await settleHardwareWrites()
    expect(order.filter((entry) => entry === 'S1')).toHaveLength(1)

    let settled = false
    void teardownPromise.then(() => {
      settled = true
    })
    await settleHardwareWrites()
    expect(settled).toBe(false)

    resolveDrain?.()
    await teardownPromise
    order.push('disconnect')
    expect(order).toEqual(['S1', 'S0:1', 'S0:2', 'S0:drained', 'disconnect'])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('fails graceful teardown explicitly after bounded neutralization retries', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let neutralAttempts = 0
    const harness = moduleHarness('alerts-teardown-failure', {
      sendRaw: async (command) => {
        if (command !== 'S0') return
        neutralAttempts += 1
        throw new Error('neutral unavailable')
      }
    })
    const { register } = await import('./alerts')
    register(harness.ctx)
    await settleConfigLoad()
    await harness.handlers.get('alerts:setConfig')?.(undefined, {
      pitLimiter: {
        outputs: [{ kind: 'buttonbox', preset: 'startLedFlash', durationMs: 5_000 }]
      }
    })

    harness.emit(snapshot('live', 0, { pitLimiter: false }))
    harness.emit(snapshot('live', 0, { timestamp: 1_100, pitLimiter: true }))
    await settleHardwareWrites()

    await expect(Promise.resolve(harness.teardowns[0]())).rejects.toThrow(
      'Failed to neutralize alert hardware actuators'
    )
    expect(neutralAttempts).toBe(3)
  })

  it('bounds never-settling teardown writes and allows shutdown ordering to continue', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const order: string[] = []
    const harness = moduleHarness('alerts-teardown-timeout', {
      sendRaw: (command) => {
        order.push(command)
        return new Promise<void>(() => undefined)
      }
    })
    const { register } = await import('./alerts')
    register(harness.ctx)
    await settleConfigLoad()
    await harness.handlers.get('alerts:setConfig')?.(undefined, {
      pitLimiter: {
        outputs: [{ kind: 'buttonbox', preset: 'startLedFlash', durationMs: 5_000 }]
      }
    })

    vi.useFakeTimers({ now: 0 })
    harness.emit(snapshot('live', 0, { pitLimiter: false }))
    harness.emit(snapshot('live', 0, { timestamp: 1_100, pitLimiter: true }))
    const teardownPromise = Promise.resolve(harness.teardowns[0]())
    const observedTeardown = teardownPromise.catch((error: unknown) => error)
    expect(order).toEqual(['S1', 'S0'])

    await vi.advanceTimersByTimeAsync(1_000)
    const teardownError = await observedTeardown
    expect(teardownError).toBeInstanceOf(Error)
    expect((teardownError as Error).message).toContain('Failed to neutralize alert hardware actuators')
    expect(order).toEqual(['S1', 'S0', 'S0', 'S0'])

    order.push('disconnect')
    expect(order.at(-1)).toBe('disconnect')
    expect(Date.now()).toBeLessThan(2_500)
  })
})

describe('soundshift boundary seeding', () => {
  it('waits for persisted config and silently seeds the latest live frame before processing edges', async () => {
    const configRead = deferred<string>()
    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
      return {
        ...actual,
        readFile: vi.fn(() => configRead.promise)
      }
    })
    const { register } = await import('./soundshift')
    const harness = moduleHarness('soundshift-delayed-config')
    register(harness.ctx)

    const low = {
      rpm: 6_000,
      maxRpm: 8_000,
      shiftRpm: 7_000,
      shiftIndicatorPct: 0.2,
      brake: 0.8,
      absActive: false,
      throttle: 0.8,
      tcActive: false
    }
    const active = {
      ...low,
      rpm: 7_100,
      shiftIndicatorPct: 1,
      absActive: true,
      tcActive: true
    }

    harness.emit(snapshot('live', 0, active))
    harness.emit(snapshot('live', 0, { ...active, timestamp: 1_100 }))
    expect(callsFor(harness.broadcast, SOUNDSHIFT_CHANNELS.configEvent)).toEqual([])
    expect(callsFor(harness.broadcast, SOUNDSHIFT_CHANNELS.cueEvent)).toEqual([])

    configRead.resolve(
      JSON.stringify({
        soundshift: { enabled: true, defaultMode: 'exact', leadMs: 0 },
        abs: { enabled: true, triggerMode: 'start', inputThreshold: 0.2, repeatMs: 75 },
        tcs: { enabled: true, triggerMode: 'start', inputThreshold: 0.2, repeatMs: 75 }
      })
    )
    await settleSoundshiftConfigLoad(harness.broadcast)
    harness.broadcast.mockClear()

    harness.emit(snapshot('live', 0, { ...active, timestamp: 1_200 }))
    expect(callsFor(harness.broadcast, SOUNDSHIFT_CHANNELS.cueEvent)).toEqual([])

    harness.emit(snapshot('live', 0, { ...low, timestamp: 1_300 }))
    harness.emit(snapshot('live', 0, { ...active, timestamp: 1_400 }))
    expect(callsFor(harness.broadcast, SOUNDSHIFT_CHANNELS.cueEvent).map((cue: any) => cue.id)).toEqual([
      'soundshift',
      'abs',
      'tcs'
    ])
  })

  it('silently seeds initially active shift, ABS, and TCS baselines before real edges', async () => {
    const { register } = await import('./soundshift')
    const harness = moduleHarness('soundshift-initial-live')
    register(harness.ctx)
    await settleSoundshiftConfigLoad(harness.broadcast)
    await harness.handlers.get(SOUNDSHIFT_CHANNELS.setConfig)?.(undefined, {
      soundshift: { enabled: true, defaultMode: 'exact', leadMs: 0 },
      abs: { enabled: true, triggerMode: 'start', inputThreshold: 0.2, repeatMs: 75 },
      tcs: { enabled: true, triggerMode: 'start', inputThreshold: 0.2, repeatMs: 75 }
    })
    harness.broadcast.mockClear()

    const low = {
      rpm: 6_000,
      maxRpm: 8_000,
      shiftRpm: 7_000,
      shiftIndicatorPct: 0.2,
      brake: 0.8,
      absActive: false,
      throttle: 0.8,
      tcActive: false
    }
    const active = {
      ...low,
      rpm: 7_100,
      shiftIndicatorPct: 1,
      absActive: true,
      tcActive: true
    }

    harness.emit(snapshot('live', 0, active))
    harness.emit(snapshot('live', 0, { ...active, timestamp: 1_100 }))
    expect(callsFor(harness.broadcast, SOUNDSHIFT_CHANNELS.cueEvent)).toEqual([])

    harness.emit(snapshot('live', 0, { ...low, timestamp: 1_200 }))
    harness.emit(snapshot('live', 0, { ...active, timestamp: 1_300 }))
    expect(callsFor(harness.broadcast, SOUNDSHIFT_CHANNELS.cueEvent).map((cue: any) => cue.id)).toEqual([
      'soundshift',
      'abs',
      'tcs'
    ])
  })

  it('suppresses re-entry shift/ABS/TCS cues, preserves real edges, and deduplicates non-live cancellation', async () => {
    const { register } = await import('./soundshift')
    const harness = moduleHarness('soundshift-seed')
    register(harness.ctx)
    await settleSoundshiftConfigLoad(harness.broadcast)
    await harness.handlers.get(SOUNDSHIFT_CHANNELS.setConfig)?.(undefined, {
      soundshift: { enabled: true, defaultMode: 'exact', leadMs: 0 },
      abs: { enabled: true, triggerMode: 'start', inputThreshold: 0.2, repeatMs: 75 },
      tcs: { enabled: true, triggerMode: 'start', inputThreshold: 0.2, repeatMs: 75 }
    })
    harness.broadcast.mockClear()

    const low = {
      rpm: 6_000,
      maxRpm: 8_000,
      shiftRpm: 7_000,
      shiftIndicatorPct: 0.2,
      brake: 0.8,
      absActive: false,
      throttle: 0.8,
      tcActive: false
    }
    const active = {
      ...low,
      rpm: 7_100,
      shiftIndicatorPct: 1,
      absActive: true,
      tcActive: true
    }

    harness.emit(snapshot('live', 0, low))
    harness.emit(snapshot('live', 0, { ...active, timestamp: 1_100 }))
    expect(callsFor(harness.broadcast, SOUNDSHIFT_CHANNELS.cueEvent).map((cue: any) => cue.id)).toEqual([
      'soundshift',
      'abs',
      'tcs'
    ])

    harness.broadcast.mockClear()
    const replay = snapshot('replay', 1, active)
    harness.emit(replay)
    harness.emit(replay)
    expect(callsFor(harness.broadcast, SOUNDSHIFT_CHANNELS.cueEvent)).toEqual([])

    harness.broadcast.mockClear()
    harness.emit(snapshot('live', 2, active))
    harness.emit(snapshot('live', 2, { ...active, timestamp: 1_300 }))
    expect(callsFor(harness.broadcast, SOUNDSHIFT_CHANNELS.cueEvent)).toEqual([])

    harness.emit(snapshot('live', 2, { ...low, timestamp: 1_400 }))
    harness.emit(snapshot('live', 2, { ...active, timestamp: 1_500 }))
    expect(callsFor(harness.broadcast, SOUNDSHIFT_CHANNELS.cueEvent).map((cue: any) => cue.id)).toEqual([
      'soundshift',
      'abs',
      'tcs'
    ])

    harness.emit(snapshot('live', 2, { ...low, timestamp: 1_600 }))
    harness.broadcast.mockClear()
    harness.emit(snapshot('live', 2, { ...active, timestamp: 1_700 }, 'token-b'))
    harness.emit(snapshot('live', 2, { ...active, timestamp: 1_800 }, 'token-b'))
    expect(callsFor(harness.broadcast, SOUNDSHIFT_CHANNELS.cueEvent)).toEqual([])

    harness.emit(snapshot('live', 2, { ...low, timestamp: 1_900 }, 'token-b'))
    harness.emit(snapshot('live', 2, { ...active, timestamp: 2_000 }, 'token-b'))
    expect(callsFor(harness.broadcast, SOUNDSHIFT_CHANNELS.cueEvent).map((cue: any) => cue.id)).toEqual([
      'soundshift',
      'abs',
      'tcs'
    ])
  })

  it('allows disabled shift, ABS, and TCS cues to fire when enabled while active', async () => {
    const { register } = await import('./soundshift')
    const harness = moduleHarness('soundshift-enable-active')
    register(harness.ctx)
    await settleSoundshiftConfigLoad(harness.broadcast)
    await harness.handlers.get(SOUNDSHIFT_CHANNELS.setConfig)?.(undefined, {
      soundshift: { enabled: false, defaultMode: 'exact', leadMs: 0 },
      abs: { enabled: false, triggerMode: 'start', inputThreshold: 0.2, repeatMs: 75 },
      tcs: { enabled: false, triggerMode: 'start', inputThreshold: 0.2, repeatMs: 75 }
    })

    vi.useFakeTimers({ now: 10_000 })
    const active = {
      rpm: 7_100,
      maxRpm: 8_000,
      shiftRpm: 7_000,
      shiftIndicatorPct: 1,
      brake: 0.8,
      absActive: true,
      throttle: 0.8,
      tcActive: true
    }
    harness.emit(snapshot('live', 0, active))
    expect(callsFor(harness.broadcast, SOUNDSHIFT_CHANNELS.cueEvent)).toEqual([])

    await harness.handlers.get(SOUNDSHIFT_CHANNELS.setConfig)?.(undefined, {
      soundshift: { enabled: true },
      abs: { enabled: true },
      tcs: { enabled: true }
    })
    harness.broadcast.mockClear()

    harness.emit(snapshot('live', 0, { ...active, timestamp: 1_100 }))
    expect(callsFor(harness.broadcast, SOUNDSHIFT_CHANNELS.cueEvent).map((cue: any) => cue.id)).toEqual([
      'soundshift',
      'abs',
      'tcs'
    ])
  })

  it('starts the ABS repeat interval when a disabled active cue is enabled', async () => {
    const { register } = await import('./soundshift')
    const harness = moduleHarness('soundshift-enable-active-abs-repeat')
    register(harness.ctx)
    await settleSoundshiftConfigLoad(harness.broadcast)
    await harness.handlers.get(SOUNDSHIFT_CHANNELS.setConfig)?.(undefined, {
      soundshift: {},
      abs: { enabled: false, triggerMode: 'repeat', inputThreshold: 0.2, repeatMs: 250 }
    })
    expect(await harness.handlers.get(SOUNDSHIFT_CHANNELS.getConfig)?.()).toMatchObject({
      abs: { enabled: false, triggerMode: 'repeat', repeatMs: 250 }
    })

    vi.useFakeTimers({ now: 10_000 })
    const active = { brake: 0.8, absActive: true }
    harness.emit(snapshot('live', 0, active))
    expect(callsFor(harness.broadcast, SOUNDSHIFT_CHANNELS.cueEvent)).toEqual([])

    await harness.handlers.get(SOUNDSHIFT_CHANNELS.setConfig)?.(undefined, {
      soundshift: {},
      abs: { enabled: true }
    })
    expect(await harness.handlers.get(SOUNDSHIFT_CHANNELS.getConfig)?.()).toMatchObject({
      abs: { enabled: true, triggerMode: 'repeat', repeatMs: 250 }
    })
    harness.broadcast.mockClear()

    harness.emit(snapshot('live', 0, { ...active, timestamp: 1_100 }))
    expect(callsFor(harness.broadcast, SOUNDSHIFT_CHANNELS.cueEvent)).toEqual([
      expect.objectContaining({ id: 'abs' })
    ])

    harness.broadcast.mockClear()
    vi.setSystemTime(10_249)
    harness.emit(snapshot('live', 0, { ...active, timestamp: 1_200 }))
    expect(callsFor(harness.broadcast, SOUNDSHIFT_CHANNELS.cueEvent)).toEqual([])

    vi.setSystemTime(10_250)
    harness.emit(snapshot('live', 0, { ...active, timestamp: 1_300 }))
    expect(callsFor(harness.broadcast, SOUNDSHIFT_CHANNELS.cueEvent)).toEqual([
      expect.objectContaining({ id: 'abs' })
    ])
  })

  it('starts an already-active repeating ABS cue from a fresh repeat interval', async () => {
    const { register } = await import('./soundshift')
    const harness = moduleHarness('soundshift-abs-repeat')
    register(harness.ctx)
    await settleSoundshiftConfigLoad(harness.broadcast)
    await harness.handlers.get(SOUNDSHIFT_CHANNELS.setConfig)?.(undefined, {
      soundshift: {},
      abs: { enabled: true, triggerMode: 'repeat', inputThreshold: 0.2, repeatMs: 250 }
    })
    expect(await harness.handlers.get(SOUNDSHIFT_CHANNELS.getConfig)?.()).toMatchObject({
      abs: { enabled: true, triggerMode: 'repeat', repeatMs: 250 }
    })

    vi.useFakeTimers({ now: 10_000 })
    harness.emit(snapshot('live', 0, { brake: 0.8, absActive: false }))
    harness.emit(snapshot('replay', 1, { brake: 0.8, absActive: true }))
    harness.broadcast.mockClear()

    harness.emit(snapshot('live', 2, { brake: 0.8, absActive: true }))
    harness.emit(snapshot('live', 2, { timestamp: 1_300, brake: 0.8, absActive: true }))
    expect(callsFor(harness.broadcast, SOUNDSHIFT_CHANNELS.cueEvent)).toEqual([])

    vi.setSystemTime(10_250)
    harness.emit(snapshot('live', 2, { timestamp: 1_400, brake: 0.8, absActive: true }))
    expect(callsFor(harness.broadcast, SOUNDSHIFT_CHANNELS.cueEvent)).toEqual([
      expect.objectContaining({ id: 'abs' })
    ])
  })
})
