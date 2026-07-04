import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { SimxAutostartController, type SimxAutostartDeps } from './simx-autostart'
import type { PortInfo } from '../../shared/ipc'

const simx = (path: string): PortInfo => ({ path, isSimX: true })
const other = (path: string): PortInfo => ({ path, isSimX: false })

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
  let lastPort: string | null
  let revlights: boolean[]
  let saved: string[]

  const makeDeps = (over: Partial<SimxAutostartDeps> = {}): SimxAutostartDeps => ({
    serial,
    setRevlightsEnabled: async (on) => {
      revlights.push(on)
    },
    isEnabled: () => enabled,
    loadLastPort: () => lastPort,
    saveLastPort: (p) => {
      saved.push(p)
      lastPort = p
    },
    retryMs: 3000,
    ...over
  })

  beforeEach(() => {
    vi.useFakeTimers()
    serial = new FakeSerial()
    enabled = true
    lastPort = null
    revlights = []
    saved = []
  })
  afterEach(() => vi.useRealTimers())

  it('connects the SIM-X on boot and activates rev-lights AFTER connecting', async () => {
    serial.ports = [other('COM1'), simx('COM5')]
    const c = new SimxAutostartController(makeDeps())
    c.start()
    await flush()
    expect(serial.connectCalls).toEqual(['COM5'])
    expect(revlights).toEqual([true]) // enabled only after the connect event
    expect(saved).toEqual(['COM5']) // last port persisted
    expect(c.isConnected()).toBe(true)
    c.dispose()
  })

  it('prefers the persisted last port even if its isSimX heuristic is false', async () => {
    lastPort = 'COM7'
    serial.ports = [simx('COM5'), other('COM7')]
    const c = new SimxAutostartController(makeDeps())
    c.start()
    await flush()
    expect(serial.connectCalls).toEqual(['COM7'])
    c.dispose()
  })

  it('retries in the background until the SIM-X appears', async () => {
    serial.ports = [] // nothing yet
    const c = new SimxAutostartController(makeDeps())
    c.start()
    await flush()
    expect(serial.connectCalls).toEqual([])
    expect(c.hasPendingRetry()).toBe(true)
    // The panel shows up before the next retry tick.
    serial.ports = [simx('COM5')]
    await vi.advanceTimersByTimeAsync(3000)
    await flush()
    expect(serial.connectCalls).toEqual(['COM5'])
    expect(c.isConnected()).toBe(true)
    c.dispose()
  })

  it('reconnects after a mid-session disconnect', async () => {
    serial.ports = [simx('COM5')]
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
    serial.ports = [simx('COM5')]
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
    serial.ports = [simx('COM5')]
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
    serial.ports = [simx('COM5')]
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
    serial.ports = [simx('COM5')]
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

  it('still persists the port + activates rev-lights on a MANUAL connect (connect event)', async () => {
    serial.ports = [] // auto-attempt finds nothing
    const c = new SimxAutostartController(makeDeps())
    c.start()
    await flush()
    expect(serial.connectCalls).toEqual([])
    // The user connects manually via the UI → SerialManager emits 'connect'.
    serial.emit('connect', { path: 'COM9' })
    await flush()
    expect(saved).toEqual(['COM9'])
    expect(revlights).toEqual([true])
    expect(c.isConnected()).toBe(true)
    c.dispose()
  })

  it('dispose() unsubscribes and cancels retries', async () => {
    serial.ports = []
    const c = new SimxAutostartController(makeDeps())
    c.start()
    await flush()
    expect(c.hasPendingRetry()).toBe(true)
    c.dispose()
    expect(c.hasPendingRetry()).toBe(false)
    // A post-dispose connect event is ignored.
    serial.emit('connect', { path: 'COM5' })
    await flush()
    expect(revlights).toEqual([])
  })
})
