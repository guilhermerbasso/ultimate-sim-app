import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModuleContext } from '../module-context'
import type { TelemetrySnapshot } from '../../shared/telemetry'

const readiness = vi.hoisted(() => {
  let release = (): void => undefined
  let promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return {
    ready: false,
    profileKind: 'standard' as 'standard' | 'deaf-hoh',
    get promise() {
      return promise
    },
    reset() {
      this.ready = false
      this.profileKind = 'standard'
      promise = new Promise<void>((resolve) => {
        release = resolve
      })
    },
    release() {
      this.ready = true
      release()
    }
  }
})

vi.mock('./accessibility-cues', async () => {
  const shared = await vi.importActual<
    typeof import('../../shared/accessibility-cues')
  >('../../shared/accessibility-cues')
  return {
    getActiveAccessibilityCueProfile: () =>
      readiness.ready
        ? readiness.profileKind === 'deaf-hoh'
          ? shared.DEAF_HOH_CUE_PROFILE
          : shared.STANDARD_CUE_PROFILE
        : null,
    whenAccessibilityCueProfileReady: () => readiness.promise
  }
})

vi.mock('./haptics', () => ({
  dispatchAccessibilityCueHaptic: vi.fn(),
  isAccessibilityHapticsEnabled: () => false
}))

vi.mock('../settings/events', () => ({
  settingsEvents: { onChanged: vi.fn(() => () => undefined) }
}))

function liveSnapshot(
  timestamp: number,
  fuelLiters: number
): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp,
    speedKmh: 100,
    rpm: 5000,
    gear: 3,
    throttle: 0.5,
    brake: 0,
    clutch: 0,
    fuelLiters,
    fuelPerLap: 1,
    replayContext: {
      state: 'live',
      reason: 'confirmed-live',
      inputs: {},
      active: false,
      revision: 1,
      token: '1:1',
      sessionIdentity: 'session-a',
      connectionEpoch: 1
    }
  }
}

function harness(withDevice = false) {
  const listeners: Array<(snapshot: TelemetrySnapshot | null) => void> = []
  const broadcast = vi.fn()
  const handlers = new Map<string, (...args: any[]) => any>()
  const device = {
    id: 'simx',
    isOpen: () => true,
    sendRaw: vi.fn(async (_command: string) => undefined),
    sendOled: vi.fn(async () => undefined),
    sendBigNum: vi.fn(async () => undefined)
  }
  const ctx = {
    app: {
      getPath: () => 'C:\\cue-startup-test',
      prependOnceListener: vi.fn(),
      once: vi.fn()
    },
    ipcMain: {
      handle: (channel: string, handler: (...args: any[]) => any) =>
        handlers.set(channel, handler)
    },
    telemetryHub: {
      on: (event: string, handler: (snapshot: TelemetrySnapshot | null) => void) => {
        if (event === 'snapshot') listeners.push(handler)
      }
    },
    serialHub: {
      getPrimary: () => (withDevice ? device : null),
      getPrimaryId: () => (withDevice ? 'simx' : null),
      getDevice: (id: string) => (withDevice && id === 'simx' ? device : null),
      on: vi.fn(),
      off: vi.fn()
    },
    broadcast
  } as unknown as ModuleContext
  return {
    ctx,
    broadcast,
    device,
    emit(snapshot: TelemetrySnapshot | null) {
      for (const listener of listeners) listener(snapshot)
    }
  }
}

beforeEach(() => {
  readiness.reset()
  vi.resetModules()
})

describe('accessibility cue startup readiness', () => {
  it('queues live alerts and emits no cue/hardware route before the persisted profile is ready', async () => {
    const testHarness = harness()
    const { register } = await import('./alerts')
    register(testHarness.ctx)
    await new Promise<void>((resolve) => setTimeout(resolve, 30))

    testHarness.emit(liveSnapshot(1000, 10))
    testHarness.emit(liveSnapshot(2000, 2))
    expect(
      testHarness.broadcast.mock.calls.filter(
        ([channel]) => channel === 'alerts:event'
      )
    ).toHaveLength(1)
    expect(
      testHarness.broadcast.mock.calls.filter(
        ([channel]) => channel === 'accessibilityCues:routed'
      )
    ).toHaveLength(0)

    readiness.release()
    await vi.waitFor(() => {
      expect(
        testHarness.broadcast.mock.calls.filter(
          ([channel]) => channel === 'accessibilityCues:routed'
        )
      ).toHaveLength(1)
    })
  })

  it('uses only the taught steady lamp command for reduced-motion profiles', async () => {
    readiness.profileKind = 'deaf-hoh'
    readiness.release()
    const testHarness = harness(true)
    const { register } = await import('./alerts')
    register(testHarness.ctx)
    await new Promise<void>((resolve) => setTimeout(resolve, 30))

    testHarness.emit(liveSnapshot(1000, 10))
    testHarness.emit({
      ...liveSnapshot(2000, 10),
      flags: {
        green: false,
        yellow: true,
        blue: false,
        white: false,
        checkered: false,
        red: false,
        black: false,
        meatball: false,
        repair: false,
        disqualify: false,
        greenWhiteCheckered: false
      }
    })
    await vi.waitFor(() => expect(testHarness.device.sendRaw).toHaveBeenCalled())
    const commands = testHarness.device.sendRaw.mock.calls.map(([command]) => command)
    expect(commands).toContain('S1')
    expect(commands.some((command) => /^B|^R/.test(command))).toBe(false)
  })
})
