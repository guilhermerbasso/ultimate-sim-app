import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { SimxAutostartController, type SimxAutostartDeps } from './simx-autostart'
import type { PortInfo } from '../../shared/ipc'
import type { SimXEnrollment } from '../../shared/simx-enrollment'

const ENROLLED_VID = '2341'
const ENROLLED_PID = '8036'

// A port carrying the ENROLLED board's USB identity, wherever Windows put it.
const enrolledBoard = (path: string, serialNumber = 'BOX-A'): PortInfo => ({
  path,
  isSimX: true,
  vendorId: ENROLLED_VID,
  productId: ENROLLED_PID,
  serialNumber
})

// A DIFFERENT board that the old vendor-wide heuristic still flags as "SIM-X".
const strangerFlaggedSimX = (path: string, vendorId = '239a'): PortInfo => ({
  path,
  isSimX: true,
  vendorId,
  productId: '800c',
  serialNumber: 'OTHER'
})

const other = (path: string): PortInfo => ({ path, isSimX: false })

const enrollment = (over: Partial<SimXEnrollment> = {}): SimXEnrollment => ({
  version: 1,
  vendorId: ENROLLED_VID,
  productId: ENROLLED_PID,
  serialNumber: 'BOX-A',
  enrolledAt: '2026-01-01T00:00:00.000Z',
  ...over
})

class FakeSerial extends EventEmitter {
  ports: PortInfo[] = []
  connectCalls: string[] = []
  failConnect = false
  async listPorts(): Promise<PortInfo[]> {
    return this.ports
  }
  async connect(path: string): Promise<unknown> {
    this.connectCalls.push(path)
    if (this.failConnect) throw new Error('connect failed')
    // Mirror the real SerialManager, which emits 'connect' with a DeviceInfo.
    this.emit('connect', { path })
    return { path }
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
}

describe('SimxAutostartController', () => {
  let serial: FakeSerial
  let enabled: boolean
  let enrolled: SimXEnrollment | null
  let revlights: boolean[]

  const makeDeps = (over: Partial<SimxAutostartDeps> = {}): SimxAutostartDeps => ({
    serial,
    setRevlightsEnabled: async (on) => {
      revlights.push(on)
    },
    isEnabled: () => enabled,
    loadEnrollment: () => enrolled,
    retryMs: 3000,
    ...over
  })

  beforeEach(() => {
    vi.useFakeTimers()
    serial = new FakeSerial()
    enabled = true
    enrolled = enrollment()
    revlights = []
  })
  afterEach(() => vi.useRealTimers())

  it('connects the ENROLLED SIM-X on boot and activates rev-lights AFTER connecting', async () => {
    serial.ports = [other('COM1'), enrolledBoard('COM5')]
    const c = new SimxAutostartController(makeDeps())
    c.start()
    await flush()
    expect(serial.connectCalls).toEqual(['COM5'])
    expect(revlights).toEqual([true]) // enabled only after the connect event
    expect(c.isConnected()).toBe(true)
    expect(c.getQuarantine()).toBeNull()
    c.dispose()
  })

  it('follows the enrolled board to a NEW COM path after re-enumeration', async () => {
    // Windows moved the board from COM5 to COM21 and gave COM5 to something else.
    serial.ports = [strangerFlaggedSimX('COM5'), enrolledBoard('COM21')]
    const c = new SimxAutostartController(makeDeps())
    c.start()
    await flush()
    expect(serial.connectCalls).toEqual(['COM21'])
    c.dispose()
  })

  // ─── P0-09 / §24-15: the quarantine gate ────────────────────────────────────

  it('never opens ANY port while no board is enrolled', async () => {
    enrolled = null
    serial.ports = [enrolledBoard('COM5'), strangerFlaggedSimX('COM9')]
    const c = new SimxAutostartController(makeDeps())
    c.start()
    await flush()
    expect(serial.connectCalls).toEqual([])
    expect(c.getQuarantine()?.reason).toBe('not-enrolled')
    expect(c.getQuarantine()?.candidatePaths).toEqual(['COM5', 'COM9'])
    // It keeps watching, but it never probes.
    expect(c.hasPendingRetry()).toBe(true)
    await vi.advanceTimersByTimeAsync(30_000)
    await flush()
    expect(serial.connectCalls).toEqual([])
    c.dispose()
  })

  it('never opens an unrelated vendor-flagged board (Arduino/SparkFun/Adafruit)', async () => {
    serial.ports = [strangerFlaggedSimX('COM9', '239a'), strangerFlaggedSimX('COM10', '1b4f')]
    const c = new SimxAutostartController(makeDeps())
    c.start()
    await flush()
    expect(serial.connectCalls).toEqual([])
    expect(c.getQuarantine()?.reason).toBe('enrolled-board-absent')
    c.dispose()
  })

  it('never falls back to the remembered COM path when the enrolled board is gone', async () => {
    // Something else now answers on the path the SIM-X used to occupy.
    serial.ports = [strangerFlaggedSimX('COM18')]
    enrolled = enrollment({ lastKnownPath: 'COM18' })
    const c = new SimxAutostartController(makeDeps())
    c.start()
    await flush()
    expect(serial.connectCalls).toEqual([])
    expect(c.getQuarantine()?.reason).toBe('enrolled-board-absent')
    c.dispose()
  })

  it('refuses rather than guess when two boards share the enrolled identity', async () => {
    enrolled = enrollment({ serialNumber: undefined })
    serial.ports = [enrolledBoard('COM3', ''), enrolledBoard('COM7', '')]
    const c = new SimxAutostartController(makeDeps())
    c.start()
    await flush()
    expect(serial.connectCalls).toEqual([])
    expect(c.getQuarantine()?.reason).toBe('ambiguous-identity')
    c.dispose()
  })

  it('quarantines instead of probing when the enrolment cannot be read', async () => {
    serial.ports = [enrolledBoard('COM5')]
    const c = new SimxAutostartController(
      makeDeps({
        loadEnrollment: () => {
          throw new Error('corrupt enrolment file')
        }
      })
    )
    c.start()
    await flush()
    expect(serial.connectCalls).toEqual([])
    expect(c.getQuarantine()?.reason).toBe('not-enrolled')
    c.dispose()
  })

  it('picks the quarantine up the moment the user enrols the board', async () => {
    enrolled = null
    serial.ports = [enrolledBoard('COM5')]
    const c = new SimxAutostartController(makeDeps())
    c.start()
    await flush()
    expect(serial.connectCalls).toEqual([])
    // The user presses Connect once → the identity is enrolled.
    enrolled = enrollment()
    await vi.advanceTimersByTimeAsync(3000)
    await flush()
    expect(serial.connectCalls).toEqual(['COM5'])
    expect(c.getQuarantine()).toBeNull()
    c.dispose()
  })

  // ─── Existing lifecycle behaviour, now identity-gated ────────────────────────

  it('retries in the background until the enrolled SIM-X appears', async () => {
    serial.ports = [] // nothing yet
    const c = new SimxAutostartController(makeDeps())
    c.start()
    await flush()
    expect(serial.connectCalls).toEqual([])
    expect(c.hasPendingRetry()).toBe(true)
    // The box shows up before the next retry tick.
    serial.ports = [enrolledBoard('COM5')]
    await vi.advanceTimersByTimeAsync(3000)
    await flush()
    expect(serial.connectCalls).toEqual(['COM5'])
    expect(c.isConnected()).toBe(true)
    c.dispose()
  })

  it('reconnects after a mid-session disconnect', async () => {
    serial.ports = [enrolledBoard('COM5')]
    const c = new SimxAutostartController(makeDeps())
    c.start()
    await flush()
    expect(c.isConnected()).toBe(true)
    serial.emit('disconnect')
    expect(c.isConnected()).toBe(false)
    expect(c.hasPendingRetry()).toBe(true)
    await vi.advanceTimersByTimeAsync(3000)
    await flush()
    expect(serial.connectCalls).toEqual(['COM5', 'COM5']) // reconnected
    expect(c.isConnected()).toBe(true)
    c.dispose()
  })

  it('activates rev-lights ONCE — a reconnect does not re-force them', async () => {
    serial.ports = [enrolledBoard('COM5')]
    const c = new SimxAutostartController(makeDeps())
    c.start()
    await flush()
    expect(revlights).toEqual([true]) // first connect
    serial.emit('disconnect') // spontaneous drop
    await vi.advanceTimersByTimeAsync(3000)
    await flush()
    expect(serial.connectCalls).toEqual(['COM5', 'COM5'])
    expect(revlights).toEqual([true]) // NOT re-forced on reconnect (respects user's off)
    c.dispose()
  })

  it('suppresses auto-reconnect after a USER-initiated disconnect', async () => {
    serial.ports = [enrolledBoard('COM5')]
    const c = new SimxAutostartController(makeDeps())
    c.start()
    await flush()
    expect(c.isConnected()).toBe(true)
    // User clicks Disconnect → SerialManager emits 'user-disconnect' then 'disconnect'.
    serial.emit('user-disconnect')
    serial.emit('disconnect')
    expect(c.isConnected()).toBe(false)
    expect(c.hasPendingRetry()).toBe(false) // do NOT fight the user
    await vi.advanceTimersByTimeAsync(6000)
    await flush()
    expect(serial.connectCalls).toEqual(['COM5']) // no auto-reconnect
    c.dispose()
  })

  it('does NOT activate rev-lights when the connect attempt fails', async () => {
    serial.ports = [enrolledBoard('COM5')]
    serial.failConnect = true
    const c = new SimxAutostartController(makeDeps())
    c.start()
    await flush()
    expect(revlights).toEqual([]) // no rev-lights without a real connect
    expect(c.hasPendingRetry()).toBe(true) // and it will retry
    c.dispose()
  })

  it('does nothing when the feature is disabled', async () => {
    enabled = false
    serial.ports = [enrolledBoard('COM5')]
    const c = new SimxAutostartController(makeDeps())
    c.start()
    await flush()
    expect(serial.connectCalls).toEqual([])
    expect(c.hasPendingRetry()).toBe(false)
    c.dispose()
  })

  it('reacts to a live toggle: ON starts the loop, OFF stops the retry', async () => {
    enabled = false
    serial.ports = [] // not present yet
    const c = new SimxAutostartController(makeDeps())
    c.start()
    await flush()
    expect(c.hasPendingRetry()).toBe(false)
    // User flips it ON.
    enabled = true
    c.onSettingsChanged()
    await flush()
    expect(c.hasPendingRetry()).toBe(true) // now retrying for the SIM-X
    // User flips it OFF → retry stops.
    enabled = false
    c.onSettingsChanged()
    expect(c.hasPendingRetry()).toBe(false)
    c.dispose()
  })

  it('still activates rev-lights on a MANUAL connect (connect event)', async () => {
    enrolled = null
    serial.ports = [] // auto-attempt is quarantined anyway
    const c = new SimxAutostartController(makeDeps())
    c.start()
    await flush()
    expect(serial.connectCalls).toEqual([])
    // The user connects manually via the UI → SerialManager emits 'connect'.
    serial.emit('connect', { path: 'COM9' })
    await flush()
    expect(revlights).toEqual([true])
    expect(c.isConnected()).toBe(true)
    expect(c.getQuarantine()).toBeNull()
    c.dispose()
  })
})
