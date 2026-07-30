import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STALE_POLL_LIMIT, TelemetryHub } from './hub'
import type { TelemetryProvider } from './provider'
import type { SimId, TelemetrySnapshot } from '../../shared/telemetry'

// ---------------------------------------------------------------------------
// SYNTHETIC EVIDENCE, NOT A REAL CAPTURE.
//
// FakeSimProvider reproduces the lifecycle that ACC/AC/AMS2/LMU actually implement
// (see src/main/sims/*.ts): `start()` can only attach while the sim's shared memory
// already exists, `start()` early-returns while a handle is still held, and the handle
// stays open — so `isConnected()` keeps reporting true — after the sim exits. Those are
// the two properties that made "close the sim and reopen it" require an app restart.
// A real Windows + simulator smoke test is still required to confirm the mapping
// really is re-acquirable in-process.
// ---------------------------------------------------------------------------

class FakeSimProvider implements TelemetryProvider {
  /** Whether the simulator process is running (its shared memory exists). */
  simRunning = false
  /** Handle held by this provider — survives the sim exiting, exactly like the real ones. */
  private attached = false
  startCalls = 0
  stopCalls = 0

  constructor(readonly id: SimId) {}

  start(): void {
    // Mirrors `if (this.physics || …) return` in ac.ts / ams2.ts / lmu.ts.
    this.startCalls += 1
    if (this.attached) return
    if (!this.simRunning) return
    this.attached = true
  }

  stop(): void {
    this.stopCalls += 1
    this.attached = false
  }

  isConnected(): boolean {
    // The stale-handle lie: still "connected" against a mapping whose sim has exited.
    return this.attached
  }

  poll(): TelemetrySnapshot | null {
    if (!this.attached || !this.simRunning) return null
    return { sim: this.id, connected: true, timestamp: Date.now() } as TelemetrySnapshot
  }
}

describe('TelemetryHub provider reconnection (P1-01)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('attaches to a simulator that is launched AFTER the source was selected', async () => {
    const hub = new TelemetryHub()
    const acc = new FakeSimProvider('acc')
    hub.register(acc)

    // The sim is not running yet — this is the case that used to need an app restart.
    await hub.setSource('acc')
    expect(acc.isConnected()).toBe(false)
    expect(hub.getLatest()).toBeNull()

    acc.simRunning = true
    await vi.advanceTimersByTimeAsync(2500)

    expect(acc.isConnected()).toBe(true)
    await vi.advanceTimersByTimeAsync(100)
    expect(hub.getLatest()?.sim).toBe('acc')

    await hub.dispose()
  })

  it('re-attaches after the simulator is closed and reopened, without a restart', async () => {
    const hub = new TelemetryHub()
    const ams2 = new FakeSimProvider('ams2')
    ams2.simRunning = true
    hub.register(ams2)

    await hub.setSource('ams2')
    await vi.advanceTimersByTimeAsync(100)
    expect(hub.getLatest()?.sim).toBe('ams2')

    // Sim exits. The handle stays open, so isConnected() keeps lying.
    ams2.simRunning = false
    expect(ams2.isConnected()).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(hub.getLatest()).toBeNull()
    // The dead handle must have been released rather than held forever.
    expect(ams2.stopCalls).toBeGreaterThan(0)

    // Sim relaunches.
    ams2.simRunning = true
    await vi.advanceTimersByTimeAsync(2500)
    await vi.advanceTimersByTimeAsync(100)

    expect(ams2.isConnected()).toBe(true)
    expect(hub.getLatest()?.sim).toBe('ams2')

    await hub.dispose()
  })

  it('recycles a provider that still claims to be connected but has stopped sampling', async () => {
    const hub = new TelemetryHub()
    const lmu = new FakeSimProvider('lmu')
    lmu.simRunning = true
    hub.register(lmu)

    await hub.setSource('lmu')
    await vi.advanceTimersByTimeAsync(50)
    const stopsBefore = lmu.stopCalls

    lmu.simRunning = false
    // Poll at 60 Hz: STALE_POLL_LIMIT nulls is well under the 2 s reconnect sweep.
    await vi.advanceTimersByTimeAsync(Math.ceil((STALE_POLL_LIMIT + 5) * (1000 / 60)))

    expect(lmu.stopCalls).toBeGreaterThan(stopsBefore)

    await hub.dispose()
  })

  it('in auto mode retries every real provider but never the mock', async () => {
    const hub = new TelemetryHub()
    const ac = new FakeSimProvider('ac')
    const acc = new FakeSimProvider('acc')
    const mock = new FakeSimProvider('mock')
    hub.register(ac)
    hub.register(acc)
    hub.register(mock)

    await hub.setSource('auto')
    const mockStartsAfterSourceChange = mock.startCalls
    await vi.advanceTimersByTimeAsync(6000)

    expect(ac.startCalls).toBeGreaterThan(1)
    expect(acc.startCalls).toBeGreaterThan(1)
    // The mock must never win the auto race by being restarted behind the user's back.
    expect(mock.startCalls).toBe(mockStartsAfterSourceChange)

    // The first sim to appear is the one that gets picked up.
    acc.simRunning = true
    await vi.advanceTimersByTimeAsync(2500)
    await vi.advanceTimersByTimeAsync(100)
    expect(hub.getLatest()?.sim).toBe('acc')

    await hub.dispose()
  })

  it('stops retrying once the source is switched off', async () => {
    const hub = new TelemetryHub()
    const acc = new FakeSimProvider('acc')
    hub.register(acc)

    await hub.setSource('acc')
    await vi.advanceTimersByTimeAsync(2500)
    const startsWhileOn = acc.startCalls
    expect(startsWhileOn).toBeGreaterThan(1)

    await hub.setSource('off')
    await vi.advanceTimersByTimeAsync(10_000)

    expect(acc.startCalls).toBe(startsWhileOn)

    await hub.dispose()
  })

  it('does not thrash a healthy connected provider', async () => {
    const hub = new TelemetryHub()
    const iracing = new FakeSimProvider('iracing')
    iracing.simRunning = true
    hub.register(iracing)

    await hub.setSource('iracing')
    await vi.advanceTimersByTimeAsync(100)
    const stopsAfterConnect = iracing.stopCalls

    await vi.advanceTimersByTimeAsync(10_000)

    expect(iracing.stopCalls).toBe(stopsAfterConnect)
    expect(hub.getLatest()?.sim).toBe('iracing')

    await hub.dispose()
  })
})
