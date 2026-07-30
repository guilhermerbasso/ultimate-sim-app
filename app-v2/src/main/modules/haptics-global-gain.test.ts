import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { ModuleContext } from '../module-context'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import { HAPTICS_CHANNELS } from '../../shared/haptics'
import { register as registerHaptics } from './haptics'

// P1-10(A) â€” the Arduino/serial haptics path must honour the GLOBAL enable,
// mute and master gain, exactly like the renderer bass-shaker path and the
// zonal path already do. "Muted" that still drives a physical motor is a lie.
//
// No serial port is opened: the actuator is a fake transport that records frames.
const DEVICE_ID = 'gen-buzz'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

interface Harness {
  ctx: ModuleContext
  sent: string[]
  setConfig: (patch: Record<string, unknown>) => Promise<unknown>
  emitSnapshot: (snapshot: TelemetrySnapshot | null) => void
  cleanup: () => void
}

function makeHarness(): Harness {
  const root = mkdtempSync(join(process.cwd(), 'haptics-gain-test-'))
  const sent: string[] = []
  const handlers = new Map<string, IpcHandler>()
  const snapshotListeners: ((snapshot: TelemetrySnapshot | null) => void)[] = []

  const device = {
    id: DEVICE_ID,
    kind: 'generic' as const,
    isOpen: () => true,
    sendRaw: (frame: string): Promise<void> => {
      sent.push(frame)
      return Promise.resolve()
    }
  }

  const ctx = {
    app: { getPath: () => root, once: () => undefined, on: () => undefined },
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
    setConfig: async (patch) => handlers.get(HAPTICS_CHANNELS.setConfig)?.(null, patch),
    emitSnapshot: (snapshot) => {
      for (const listener of snapshotListeners) listener(snapshot)
    },
    cleanup: () => rmSync(root, { recursive: true, force: true })
  }
}

const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 25))
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

// Two consecutive frames with a gear change â†’ deriveHapticsFrame reports
// gearShift, which is one of the effects routed to the Arduino buzzer.
const frame = (timestamp: number, gear: number): TelemetrySnapshot =>
  ({
    connected: true,
    timestamp,
    gear,
    rpm: 6000,
    maxRpm: 8000,
    throttle: 1,
    brake: 0,
    speedKph: 180
  }) as unknown as TelemetrySnapshot

const buzzes = (sent: string[]): string[] => sent.filter((f) => f.startsWith('Z') && f !== 'Z0:0')

describe('haptics global mute / master gain on the Arduino path (P1-10)', () => {
  let h: Harness

  beforeEach(async () => {
    h = makeHarness()
    registerHaptics(h.ctx)
    await settle()
  })

  afterEach(() => h.cleanup())

  const arduinoOn = { enabled: true, deviceId: DEVICE_ID, minIntervalMs: 40 }
  // The gear-shift effect is off by default; route it to the Arduino buzzer.
  const effectsOn = { gearShift: { enabled: true, arduino: true } }

  it('buzzes the actuator when haptics are enabled and unmuted', async () => {
    await h.setConfig({ enabled: true, muted: false, masterGain: 1, effects: effectsOn, arduino: arduinoOn })
    h.sent.length = 0
    h.emitSnapshot(frame(1000, 3))
    h.emitSnapshot(frame(1100, 4))
    await settle()
    expect(buzzes(h.sent).length).toBeGreaterThan(0)
  })

  it('does NOT drive the motor while haptics are MUTED', async () => {
    await h.setConfig({ enabled: true, muted: true, masterGain: 1, effects: effectsOn, arduino: arduinoOn })
    h.sent.length = 0
    h.emitSnapshot(frame(1000, 3))
    h.emitSnapshot(frame(1100, 4))
    await settle()
    expect(buzzes(h.sent)).toEqual([])
  })

  it('does NOT drive the motor while haptics are globally DISABLED', async () => {
    await h.setConfig({ enabled: false, muted: false, masterGain: 1, effects: effectsOn, arduino: arduinoOn })
    h.sent.length = 0
    h.emitSnapshot(frame(1000, 3))
    h.emitSnapshot(frame(1100, 4))
    await settle()
    expect(buzzes(h.sent)).toEqual([])
  })

  it('does NOT drive the motor at master gain 0', async () => {
    await h.setConfig({ enabled: true, muted: false, masterGain: 0, effects: effectsOn, arduino: arduinoOn })
    h.sent.length = 0
    h.emitSnapshot(frame(1000, 3))
    h.emitSnapshot(frame(1100, 4))
    await settle()
    expect(buzzes(h.sent)).toEqual([])
  })

  it('scales the pulse with master gain instead of ignoring it', async () => {
    await h.setConfig({ enabled: true, muted: false, masterGain: 1, effects: effectsOn, arduino: arduinoOn })
    h.sent.length = 0
    h.emitSnapshot(frame(1000, 3))
    h.emitSnapshot(frame(1100, 4))
    await settle()
    const full = buzzes(h.sent)[0]
    h.cleanup()

    h = makeHarness()
    registerHaptics(h.ctx)
    await settle()
    await h.setConfig({ enabled: true, muted: false, masterGain: 0.2, effects: effectsOn, arduino: arduinoOn })
    h.sent.length = 0
    h.emitSnapshot(frame(1000, 3))
    h.emitSnapshot(frame(1100, 4))
    await settle()
    const quiet = buzzes(h.sent)[0]

    expect(full).toBeDefined()
    expect(quiet).toBeDefined()
    const durationOf = (raw: string): number => Number(raw.split(':')[1])
    expect(durationOf(quiet)).toBeLessThan(durationOf(full))
  })

  it('resumes as soon as the user unmutes', async () => {
    await h.setConfig({ enabled: true, muted: true, masterGain: 1, effects: effectsOn, arduino: arduinoOn })
    h.emitSnapshot(frame(1000, 3))
    h.emitSnapshot(frame(1100, 4))
    await settle()
    await h.setConfig({ muted: false })
    h.sent.length = 0
    h.emitSnapshot(frame(2000, 3))
    h.emitSnapshot(frame(2100, 4))
    await settle()
    expect(buzzes(h.sent).length).toBeGreaterThan(0)
  })
})
