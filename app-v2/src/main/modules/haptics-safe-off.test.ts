import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { ModuleContext } from '../module-context'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import { HAPTICS_CHANNELS } from '../../shared/haptics'
import { HAPTICS_ZONAL_CHANNELS } from '../../shared/haptics-zonal'
import { register as registerHaptics, safeOff as hapticsSafeOff } from './haptics'
import { register as registerZonal, safeOff as zonalSafeOff } from './haptics-zonal'

// P0-10 — output safe-off.
//
// The haptic actuator is a physical motor/piezo driven over serial. Nothing in
// this file touches a real port: the "device" is a fake transport that records
// the frames the module would have written, exactly like rgb-matrix.test.ts.
//
// The companion buzzer firmware documents `Z0:0` as silence
// (firmware/companion-buzzer/companion_buzzer.ino: startTone(0, 0) → stopTone()
// → noTone(pin)), so an off command IS a specific byte sequence we can assert.
const SILENCE_FRAME = 'Z0:0'
const DEVICE_ID = 'gen-buzz'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

interface Harness {
  ctx: ModuleContext
  sent: string[]
  handlers: Map<string, IpcHandler>
  emitSnapshot: (snapshot: TelemetrySnapshot | null) => void
  emitBeforeQuit: () => void
  deviceOpen: { value: boolean }
  cleanup: () => void
}

function makeHarness(): Harness {
  const root = mkdtempSync(join(process.cwd(), 'haptics-safeoff-test-'))
  const sent: string[] = []
  const handlers = new Map<string, IpcHandler>()
  const snapshotListeners: ((snapshot: TelemetrySnapshot | null) => void)[] = []
  const beforeQuitListeners: (() => void)[] = []
  const deviceOpen = { value: true }

  const device = {
    id: DEVICE_ID,
    kind: 'generic' as const,
    isOpen: () => deviceOpen.value,
    sendRaw: (frame: string): Promise<void> => {
      sent.push(frame)
      return Promise.resolve()
    }
  }

  const ctx = {
    app: {
      getPath: () => root,
      once: (event: string, handler: () => void) => {
        if (event === 'before-quit') beforeQuitListeners.push(handler)
      },
      on: () => undefined
    },
    ipcMain: {
      handle: (channel: string, handler: IpcHandler) => {
        handlers.set(channel, handler)
      }
    },
    telemetryHub: {
      on: (event: string, handler: (snapshot: TelemetrySnapshot | null) => void) => {
        if (event === 'snapshot') snapshotListeners.push(handler)
      },
      off: () => undefined
    },
    serialHub: {
      getDevice: (id: string) => (id === DEVICE_ID ? device : null),
      getPrimaryId: () => null,
      on: () => undefined,
      off: () => undefined
    },
    broadcast: () => undefined
  } as unknown as ModuleContext

  return {
    ctx,
    sent,
    handlers,
    deviceOpen,
    emitSnapshot: (snapshot) => {
      for (const listener of snapshotListeners) listener(snapshot)
    },
    emitBeforeQuit: () => {
      for (const listener of beforeQuitListeners) listener()
    },
    cleanup: () => rmSync(root, { recursive: true, force: true })
  }
}

// The modules load their JSON config with real async I/O on register(), so the
// harness must let that settle (and land BEFORE the setConfig patch) rather than
// just draining microtasks.
const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 25))
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

describe('haptics safe-off (P0-10)', () => {
  let h: Harness

  beforeEach(async () => {
    h = makeHarness()
    registerHaptics(h.ctx)
    await settle()
    const setConfig = h.handlers.get(HAPTICS_CHANNELS.setConfig)
    await setConfig?.(null, {
      enabled: true,
      muted: false,
      masterGain: 1,
      arduino: { enabled: true, deviceId: DEVICE_ID, minIntervalMs: 40 }
    })
    h.sent.length = 0
  })

  afterEach(() => h.cleanup())

  it('writes an explicit silence frame to the actuator when the app quits', async () => {
    h.emitBeforeQuit()
    await settle()
    expect(h.sent).toContain(SILENCE_FRAME)
  })

  it('exposes a safeOff() the ordered quit teardown can await', async () => {
    await hapticsSafeOff(h.ctx)
    expect(h.sent).toContain(SILENCE_FRAME)
  })

  it('de-energises when telemetry is lost mid-session', async () => {
    h.emitSnapshot(null)
    await settle()
    expect(h.sent).toContain(SILENCE_FRAME)
  })

  it('does not spam the bus while telemetry stays lost', async () => {
    h.emitSnapshot(null)
    h.emitSnapshot(null)
    h.emitSnapshot(null)
    await settle()
    expect(h.sent.filter((frame) => frame === SILENCE_FRAME)).toHaveLength(1)
  })

  it('never writes to a closed port', async () => {
    h.deviceOpen.value = false
    await hapticsSafeOff(h.ctx)
    expect(h.sent).toEqual([])
  })

  it('stays silent after the quit safe-off even if a late snapshot arrives', async () => {
    await hapticsSafeOff(h.ctx)
    h.sent.length = 0
    h.emitSnapshot({ ts: Date.now() } as unknown as TelemetrySnapshot)
    await settle()
    expect(h.sent).toEqual([])
  })
})

describe('zonal haptics safe-off (P0-10)', () => {
  let h: Harness

  beforeEach(async () => {
    h = makeHarness()
    registerZonal(h.ctx)
    await settle()
    const setConfig = h.handlers.get(HAPTICS_ZONAL_CHANNELS.setConfig)
    await setConfig?.(null, {
      enabled: true,
      muted: false,
      arduino: { enabled: true, deviceId: DEVICE_ID }
    })
    h.sent.length = 0
  })

  afterEach(() => h.cleanup())

  it('writes an explicit silence frame to the actuator when the app quits', async () => {
    h.emitBeforeQuit()
    await settle()
    expect(h.sent).toContain(SILENCE_FRAME)
  })

  it('exposes a safeOff() the ordered quit teardown can await', async () => {
    await zonalSafeOff(h.ctx)
    expect(h.sent).toContain(SILENCE_FRAME)
  })

  it('de-energises when telemetry is lost mid-session', async () => {
    h.emitSnapshot(null)
    await settle()
    expect(h.sent).toContain(SILENCE_FRAME)
  })
})
