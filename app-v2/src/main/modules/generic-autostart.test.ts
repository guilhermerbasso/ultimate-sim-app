import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GenericAutostartController,
  type GenericAutostartConnectedDevice,
  type GenericAutostartDeps,
  type GenericAutostartDeviceConfig,
  type GenericAutostartSerialEvent
} from './generic-autostart'
import type { PortInfo } from '../../shared/ipc'

const portInfo = (
  path: string,
  ids: { vendorId?: string; productId?: string; serialNumber?: string } = {}
): PortInfo => ({ path, ...ids })

// Minimal fake of the multi-device SerialHub surface used by the controller.
class FakeHub {
  ports: PortInfo[] = []
  connected: GenericAutostartConnectedDevice[] = []
  connectCalls: Array<{ path: string; id?: string }> = []
  failConnect = false
  // Models the REAL hub: connectDevice emits 'device-added' BEFORE opening the
  // port, then rolls back with 'device-removed' and rejects when open fails.
  failOpenAfterAdd = false
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>()

  async listPorts(): Promise<PortInfo[]> {
    return this.ports
  }

  listConnected(): GenericAutostartConnectedDevice[] {
    return this.connected.slice()
  }

  async connectDevice(opts: { path: string; id?: string; label: string; baud: number }): Promise<unknown> {
    this.connectCalls.push({ path: opts.path, id: opts.id })
    if (this.failConnect) throw new Error(`Opening ${opts.path}: File not found`)
    const id = opts.id ?? `gen-${this.connected.length + 1}`
    const device: GenericAutostartConnectedDevice = { id, path: opts.path, kind: 'generic' }
    this.connected.push(device)
    this.emit('device-added', device)
    if (this.failOpenAfterAdd) {
      // Roll back exactly like SerialHub.connectDevice does on an open error.
      this.connected = this.connected.filter((d) => d.id !== id)
      this.emit('device-removed', device)
      throw new Error(`Opening ${opts.path}: Access denied`)
    }
    return device
  }

  on(event: GenericAutostartSerialEvent, handler: (...args: unknown[]) => void): void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(handler)
  }

  off(event: GenericAutostartSerialEvent, handler: (...args: unknown[]) => void): void {
    this.listeners.get(event)?.delete(handler)
  }

  emit(event: GenericAutostartSerialEvent, payload: unknown): void {
    for (const handler of this.listeners.get(event) ?? []) handler(payload)
  }

  // Simulate a (spontaneous or user) disconnect: remove from the open set and fire
  // 'device-removed' as the real hub does.
  drop(id: string): void {
    const index = this.connected.findIndex((d) => d.id === id)
    const device = index >= 0 ? this.connected[index] : { id, path: '', kind: 'generic' }
    if (index >= 0) this.connected.splice(index, 1)
    this.emit('device-removed', { id: device.id, path: device.path, kind: device.kind })
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve()
}

const iflag = (over: Partial<GenericAutostartDeviceConfig> = {}): GenericAutostartDeviceConfig => ({
  id: 'gen-1',
  path: 'COM15',
  label: 'iFlag',
  baud: 115200,
  autoConnect: true,
  ...over
})

describe('GenericAutostartController', () => {
  let hub: FakeHub
  let enabled: boolean
  let devices: GenericAutostartDeviceConfig[]
  let saved: Array<{ id?: string; path: string }>

  const makeDeps = (over: Partial<GenericAutostartDeps> = {}): GenericAutostartDeps => ({
    serial: hub,
    isEnabled: () => enabled,
    loadDevices: () => devices,
    saveDevicePath: (config, path) => {
      saved.push({ id: config.id, path })
    },
    retryMs: 3000,
    ...over
  })

  beforeEach(() => {
    vi.useFakeTimers()
    hub = new FakeHub()
    enabled = true
    devices = []
    saved = []
  })
  afterEach(() => vi.useRealTimers())

  it('connects an autoConnect device on boot when its port is present', async () => {
    hub.ports = [portInfo('COM3'), portInfo('COM15')]
    devices = [iflag()]
    const c = new GenericAutostartController(makeDeps())
    c.start()
    await flush()
    expect(hub.connectCalls).toEqual([{ path: 'COM15', id: 'gen-1' }])
    expect(hub.connected.map((d) => d.path)).toEqual(['COM15'])
    expect(c.hasPendingRetry()).toBe(false)
    c.dispose()
  })

  it('does NOT re-open a device the fleet one-shot (or a manual connect) already opened', async () => {
    hub.ports = [portInfo('COM15')]
    hub.connected = [{ id: 'gen-1', path: 'COM15', kind: 'generic' }]
    devices = [iflag()]
    const c = new GenericAutostartController(makeDeps())
    c.start()
    await flush()
    expect(hub.connectCalls).toEqual([]) // already open → skipped
    expect(c.hasPendingRetry()).toBe(false)
    c.dispose()
  })

  it('retries in the background until the device appears ("File not found" tolerant)', async () => {
    hub.ports = [] // iFlag not enumerated yet
    devices = [iflag()]
    const c = new GenericAutostartController(makeDeps())
    c.start()
    await flush()
    expect(hub.connectCalls).toEqual([])
    expect(c.hasPendingRetry()).toBe(true)
    // It shows up before the next retry tick.
    hub.ports = [portInfo('COM15')]
    await vi.advanceTimersByTimeAsync(3000)
    await flush()
    expect(hub.connectCalls).toEqual([{ path: 'COM15', id: 'gen-1' }])
    expect(c.hasPendingRetry()).toBe(false)
    c.dispose()
  })

  it('schedules a retry when the connect attempt fails', async () => {
    hub.ports = [portInfo('COM15')]
    hub.failConnect = true
    devices = [iflag()]
    const c = new GenericAutostartController(makeDeps())
    c.start()
    await flush()
    expect(hub.connectCalls).toEqual([{ path: 'COM15', id: 'gen-1' }])
    expect(hub.connected).toEqual([]) // failed to open
    expect(c.hasPendingRetry()).toBe(true)
    c.dispose()
  })

  it('reconnects after a spontaneous disconnect', async () => {
    hub.ports = [portInfo('COM15')]
    devices = [iflag()]
    const c = new GenericAutostartController(makeDeps())
    c.start()
    await flush()
    expect(hub.connected.length).toBe(1)
    hub.drop('gen-1') // cable glitch
    expect(c.hasPendingRetry()).toBe(true) // backs off, doesn't reconnect instantly
    await vi.advanceTimersByTimeAsync(3000)
    await flush()
    expect(hub.connectCalls).toEqual([
      { path: 'COM15', id: 'gen-1' },
      { path: 'COM15', id: 'gen-1' }
    ])
    expect(hub.connected.length).toBe(1)
    c.dispose()
  })

  it('suppresses auto-reconnect after a USER-initiated disconnect', async () => {
    hub.ports = [portInfo('COM15')]
    devices = [iflag()]
    const c = new GenericAutostartController(makeDeps())
    c.start()
    await flush()
    expect(hub.connected.length).toBe(1)
    // User clicks Disconnect → hub signals user intent, then the port closes.
    hub.emit('user-disconnect', { id: 'gen-1', path: 'COM15', kind: 'generic' })
    hub.drop('gen-1')
    await flush()
    expect(c.hasPendingRetry()).toBe(false) // do NOT fight the user
    await vi.advanceTimersByTimeAsync(6000)
    await flush()
    expect(hub.connectCalls).toEqual([{ path: 'COM15', id: 'gen-1' }]) // no auto-reconnect
    c.dispose()
  })

  it('keeps a USER-disconnected device suppressed while ANOTHER device drives the shared retry timer', async () => {
    // The fleet runs ONE shared retry timer. A (gen-1/COM15) is up; B (gen-2/COM16) is
    // not enumerated yet, so the retry timer stays alive. The user disconnects A to
    // flash its firmware. When B's retry tick fires it must connect B but NEVER reopen
    // A — the pre-fix bug cleared A's latch on its own device-removed, so this tick
    // resurrected the port the user was flashing.
    hub.ports = [portInfo('COM15')]
    devices = [iflag(), iflag({ id: 'gen-2', path: 'COM16', label: 'iFlag2' })]
    const c = new GenericAutostartController(makeDeps())
    c.start()
    await flush()
    expect(hub.connected.map((d) => d.id)).toEqual(['gen-1']) // A up, B pending
    expect(c.hasPendingRetry()).toBe(true) // B keeps the timer alive

    // User disconnects A (to flash firmware) — its COM port goes away.
    hub.emit('user-disconnect', { id: 'gen-1', path: 'COM15', kind: 'generic' })
    hub.drop('gen-1')
    await flush()

    // B finally enumerates; the shared retry tick connects B but leaves A suppressed.
    hub.ports = [portInfo('COM16')]
    await vi.advanceTimersByTimeAsync(3000)
    await flush()
    expect(hub.connected.some((d) => d.id === 'gen-2')).toBe(true) // retry ran (B up)
    expect(hub.connected.some((d) => d.id === 'gen-1')).toBe(false) // A still suppressed
    expect(hub.connectCalls.filter((call) => call.id === 'gen-1').length).toBe(1) // only the boot connect
    c.dispose()
  })

  it('clears user-disconnect suppression when autoConnect is toggled OFF then ON', async () => {
    hub.ports = [portInfo('COM15')]
    devices = [iflag()]
    const c = new GenericAutostartController(makeDeps())
    c.start()
    await flush()
    hub.emit('user-disconnect', { id: 'gen-1', path: 'COM15', kind: 'generic' })
    hub.drop('gen-1')
    await flush()
    expect(hub.connected.some((d) => d.id === 'gen-1')).toBe(false)

    // Toggle OFF then ON — an explicit opt back in clears the suppression latch.
    enabled = false
    c.onSettingsChanged()
    enabled = true
    c.onSettingsChanged()
    await flush()
    expect(hub.connected.some((d) => d.id === 'gen-1')).toBe(true) // reconnected after re-enable
    c.dispose()
  })

  it('does nothing when the feature is disabled', async () => {
    enabled = false
    hub.ports = [portInfo('COM15')]
    devices = [iflag()]
    const c = new GenericAutostartController(makeDeps())
    c.start()
    await flush()
    expect(hub.connectCalls).toEqual([])
    expect(c.hasPendingRetry()).toBe(false)
    c.dispose()
  })

  it('reacts to a live toggle: ON starts the loop, OFF stops the retry', async () => {
    enabled = false
    hub.ports = [] // not present yet
    devices = [iflag()]
    const c = new GenericAutostartController(makeDeps())
    c.start()
    await flush()
    expect(c.hasPendingRetry()).toBe(false)
    enabled = true
    c.onSettingsChanged()
    await flush()
    expect(c.hasPendingRetry()).toBe(true) // now retrying for the iFlag
    enabled = false
    c.onSettingsChanged()
    expect(c.hasPendingRetry()).toBe(false)
    c.dispose()
  })

  it('connects only autoConnect devices and skips the rest', async () => {
    hub.ports = [portInfo('COM15'), portInfo('COM16')]
    devices = [
      iflag(),
      iflag({ id: 'gen-2', path: 'COM16', label: 'Pedals', autoConnect: false })
    ]
    const c = new GenericAutostartController(makeDeps())
    c.start()
    await flush()
    expect(hub.connectCalls).toEqual([{ path: 'COM15', id: 'gen-1' }])
    c.dispose()
  })

  it('follows a device that moved COM ports and persists the new path', async () => {
    // Stored on COM15; Windows reassigned it to COM22. Identity carries it over.
    devices = [
      iflag({ vendorId: '2e8a', productId: '000a', serialNumber: 'IFLAG-001' })
    ]
    hub.ports = [portInfo('COM22', { vendorId: '2e8a', productId: '000a', serialNumber: 'IFLAG-001' })]
    const c = new GenericAutostartController(makeDeps())
    c.start()
    await flush()
    expect(hub.connectCalls).toEqual([{ path: 'COM22', id: 'gen-1' }])
    expect(saved).toEqual([{ id: 'gen-1', path: 'COM22' }]) // new path persisted
    c.dispose()
  })

  it('logs each attempt and result symmetrically', async () => {
    const infos: Array<{ message: string; detail?: unknown }> = []
    const verboses: Array<{ message: string; detail?: unknown }> = []
    const logger = {
      info: (_area: string, message: string, detail?: unknown) => infos.push({ message, detail }),
      verbose: (_area: string, message: string, detail?: unknown) => verboses.push({ message, detail })
    }
    // First boot: no port yet → verbose "no candidate port yet".
    hub.ports = []
    devices = [iflag()]
    const c = new GenericAutostartController(makeDeps({ logger }))
    c.start()
    await flush()
    expect(verboses.some((e) => e.message === 'generic auto-start: no candidate port yet')).toBe(true)
    // Now it appears → info "auto-start: connecting" then "device auto-connected".
    hub.ports = [portInfo('COM15')]
    await vi.advanceTimersByTimeAsync(3000)
    await flush()
    expect(infos.some((e) => e.message === 'auto-start: connecting')).toBe(true)
    expect(infos.some((e) => e.message === 'device auto-connected')).toBe(true)
    c.dispose()
  })

  it('does not tight-loop when a device enumerates but fails to open (add then rollback-remove)', async () => {
    hub.ports = [portInfo('COM15')]
    hub.failOpenAfterAdd = true
    devices = [iflag()]
    const c = new GenericAutostartController(makeDeps())
    c.start()
    await flush()
    // Exactly ONE attempt despite the hub emitting device-added + device-removed,
    // and a single pending retry (3s backoff) — not a spin.
    expect(hub.connectCalls).toEqual([{ path: 'COM15', id: 'gen-1' }])
    expect(c.hasPendingRetry()).toBe(true)
    // Each retry tick is one bounded attempt, not a runaway loop.
    await vi.advanceTimersByTimeAsync(3000)
    await flush()
    expect(hub.connectCalls.length).toBe(2)
    c.dispose()
  })

  it('dispose() unsubscribes and cancels retries', async () => {
    hub.ports = []
    devices = [iflag()]
    const c = new GenericAutostartController(makeDeps())
    c.start()
    await flush()
    expect(c.hasPendingRetry()).toBe(true)
    c.dispose()
    expect(c.hasPendingRetry()).toBe(false)
    // A post-dispose event is ignored (no persist, no connect).
    hub.emit('device-added', { id: 'gen-1', path: 'COM15', kind: 'generic' })
    await flush()
    expect(saved).toEqual([])
  })
})
