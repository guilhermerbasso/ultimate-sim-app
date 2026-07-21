import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import type { ReplayContext } from '../../shared/replay'
import { TelemetryHub } from '../telemetry/hub'
import { Phase02TapKernel } from './tap-kernel'

const kernels: Phase02TapKernel[] = []

afterEach(() => {
  for (const kernel of kernels.splice(0)) kernel.dispose()
})
function context(revision = 0): ReplayContext {
  return {
    state: 'live',
    reason: 'confirmed-live',
    inputs: {},
    active: false,
    revision,
    token: `1:${revision}`,
    sessionIdentity: '10:20:30:1',
    connectionEpoch: 1
  }
}

function snapshot(sequence: number): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 1_000 + sequence,
    speedKmh: 180,
    rpm: 7_000,
    gear: 4,
    throttle: 0.8,
    brake: 0,
    clutch: 0,
    currentLap: sequence,
    lapDistPct: 0.2,
    sessionType: 'Race',
    trackName: 'Spa',
    trackConfigName: 'Grand Prix',
    carName: 'GT3 R',
    carPath: 'gt3-r',
    driverName: 'Driver A',
    fuelLiters: 50,
    fuelPerLap: 2.5,
    replayContext: context(sequence),
    drivers: [{
      carIdx: 0,
      name: 'Driver A',
      carNumber: '7',
      position: 1,
      classPosition: 1,
      classId: 1,
      custId: 10,
      teamId: 20,
      teamName: 'Team A',
      isPlayer: true
    }]
  }
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
  await new Promise<void>((resolve) => setImmediate(resolve))
}

describe('Phase02TapKernel bounded asynchronous isolation', () => {
  it('does not execute Passport consumers inside the TelemetryHub callback', async () => {
    const hub = new TelemetryHub()
    const kernel = new Phase02TapKernel(hub, () => 2_000, () => 5_000n)
    kernels.push(kernel)
    const consumer = vi.fn()
    kernel.subscribe('passport', {
      maxItems: 4,
      maxBytes: 64 * 1024,
      maxAgeMs: 5_000,
      maxDrainBatch: 2
    }, consumer)

    hub.emit('snapshot', snapshot(1))
    expect(consumer).not.toHaveBeenCalled()
    await settle()
    expect(consumer).toHaveBeenCalledOnce()
  })

  it('contains consumer errors and continues delivering to independent subscribers', async () => {
    const hub = new TelemetryHub()
    const kernel = new Phase02TapKernel(hub)
    kernels.push(kernel)
    const healthy = vi.fn()
    const failing = kernel.subscribe('failing', {
      maxItems: 4,
      maxBytes: 64 * 1024,
      maxAgeMs: 5_000,
      maxDrainBatch: 4
    }, () => {
      throw new Error('consumer failed')
    })
    kernel.subscribe('healthy', {
      maxItems: 4,
      maxBytes: 64 * 1024,
      maxAgeMs: 5_000,
      maxDrainBatch: 4
    }, healthy)

    hub.emit('snapshot', snapshot(1))
    await settle()
    expect(healthy).toHaveBeenCalledOnce()
    expect(failing.status()).toMatchObject({
      consumerErrors: 1,
      lastError: 'consumer failed'
    })
  })

  describe('Phase02TapKernel lifecycle shutdown boundaries', () => {
    it('preserves both overflow gap evidence and the lifecycle boundary after saturation', async () => {
      const hub = new TelemetryHub()
      const kernel = new Phase02TapKernel(hub)
      kernels.push(kernel)
      let release!: () => void
      const barrier = new Promise<void>((resolve) => { release = resolve })
      const deliveries: Array<{ context: string; flags: string[] }> = []
      const subscription = kernel.subscribe('passport-boundary', {
        maxItems: 2,
        maxBytes: 64 * 1024,
        maxAgeMs: 10_000,
        maxDrainBatch: 1
      }, async (delivery) => {
        deliveries.push({
          context: delivery.event.telemetryContext,
          flags: [...delivery.event.integrityFlags]
        })
        if (deliveries.length === 1) await barrier
      })

      hub.emit('snapshot', snapshot(1))
      await settle()
      for (let index = 2; index <= 10; index += 1) hub.emit('snapshot', snapshot(index))
      hub.emit('snapshot', null)
      await settle()
      const overflow = subscription.status()
      release()
      await settle()
      await settle()

      expect(overflow.dropped).toBeGreaterThan(0)
      expect(deliveries.some((item) => item.flags.includes('gap'))).toBe(true)
      expect(deliveries.at(-1)?.context).not.toBe('live')
      expect(subscription.status()).toMatchObject({
        queuedItems: 0,
        queuedBytes: 0,
        gapPending: false
      })
    })

    it('preserves a live-to-null boundary before over-capacity live telemetry', async () => {
      const hub = new TelemetryHub()
      const kernel = new Phase02TapKernel(hub)
      kernels.push(kernel)
      let release!: () => void
      const barrier = new Promise<void>((resolve) => { release = resolve })
      const contexts: string[] = []
      const subscription = kernel.subscribe('passport-null-boundary', {
        maxItems: 2,
        maxBytes: 64 * 1024,
        maxAgeMs: 10_000,
        maxDrainBatch: 1
      }, async (delivery) => {
        contexts.push(delivery.event.telemetryContext)
        if (contexts.length === 1) await barrier
      })

      hub.emit('snapshot', snapshot(1))
      await settle()
      hub.emit('snapshot', null)
      for (let index = 2; index <= 12; index += 1) hub.emit('snapshot', snapshot(index))
      await settle()
      expect(subscription.status().dropped).toBeGreaterThan(0)

      release()
      for (let index = 0; index < 6; index += 1) await settle()

      const boundaryIndex = contexts.findIndex((context) => context !== 'live')
      expect(boundaryIndex).toBeGreaterThan(0)
      expect(contexts.slice(boundaryIndex + 1)).toContain('live')
      expect(subscription.status().queuedItems).toBe(0)
    })

    it('coalesces repeated replay boundaries while a consumer is blocked', async () => {
      const hub = new TelemetryHub()
      const kernel = new Phase02TapKernel(hub)
      kernels.push(kernel)
      let release!: () => void
      const barrier = new Promise<void>((resolve) => { release = resolve })
      const contexts: string[] = []
      const subscription = kernel.subscribe('passport-replay-coalesce', {
        maxItems: 2,
        maxBytes: 64 * 1024,
        maxAgeMs: 10_000,
        maxDrainBatch: 1
      }, async (delivery) => {
        contexts.push(delivery.event.telemetryContext)
        if (contexts.length === 1) await barrier
      })

      hub.emit('snapshot', snapshot(1))
      await settle()
      for (let index = 2; index <= 20; index += 1) {
        const replay = snapshot(index)
        replay.replayContext = {
          ...replay.replayContext!,
          state: 'replay',
          reason: 'replay-playing',
          active: true
        }
        hub.emit('snapshot', replay)
        await settle()
        expect(subscription.status().queuedItems).toBeLessThanOrEqual(1)
      }

      release()
      await settle()
      await settle()
      expect(contexts).toEqual(['live', 'replay'])
      expect(subscription.status().queuedItems).toBe(0)
    })

    it('delivers no callback when a subscription is disposed while its drain is scheduled', async () => {
      const hub = new TelemetryHub()
      const kernel = new Phase02TapKernel(hub)
      kernels.push(kernel)
      const consumer = vi.fn()
      const subscription = kernel.subscribe('passport-dispose', {
        maxItems: 4,
        maxBytes: 64 * 1024,
        maxAgeMs: 5_000,
        maxDrainBatch: 2
      }, consumer)

      hub.emit('snapshot', snapshot(1))
      await new Promise<void>((resolve) => setImmediate(resolve))
      subscription.dispose()
      await settle()

      expect(consumer).not.toHaveBeenCalled()
      expect(subscription.status()).toMatchObject({
        enabled: false,
        queuedItems: 0,
        queuedBytes: 0,
        accepted: 1,
        delivered: 0
      })
      expect(kernel.status('passport-dispose')).toBeNull()
    })

    it('keeps kill, boundary enqueue, and disposal races bounded with no hidden backlog', async () => {
      const hub = new TelemetryHub()
      const kernel = new Phase02TapKernel(hub)
      kernels.push(kernel)
      const consumer = vi.fn()
      const subscription = kernel.subscribe('passport-kill-dispose', {
        maxItems: 4,
        maxBytes: 64 * 1024,
        maxAgeMs: 5_000,
        maxDrainBatch: 2
      }, consumer)

      hub.emit('snapshot', snapshot(1))
      await new Promise<void>((resolve) => setImmediate(resolve))
      subscription.setKillSwitch(true)
      hub.emit('snapshot', null)
      await new Promise<void>((resolve) => setImmediate(resolve))
      subscription.dispose()
      hub.emit('snapshot', snapshot(2))
      await settle()

      expect(consumer).not.toHaveBeenCalled()
      expect(subscription.status()).toMatchObject({
        enabled: false,
        killSwitch: true,
        queuedItems: 0,
        queuedBytes: 0,
        delivered: 0
      })
      expect(kernel.status('passport-kill-dispose')).toBeNull()
    })
  })

  it('isolates subscriber payload mutation', async () => {
    const hub = new TelemetryHub()
    const kernel = new Phase02TapKernel(hub)
    kernels.push(kernel)
    let healthyDriver = ''
    kernel.subscribe('mutating', {
      maxItems: 4,
      maxBytes: 64 * 1024,
      maxAgeMs: 5_000,
      maxDrainBatch: 4
    }, (delivery) => {
      const driver = delivery.event.facts.find((fact) => fact.name === 'driver.name')
      if (driver?.value?.kind === 'string') driver.value.value = 'MUTATED'
    })
    kernel.subscribe('healthy', {
      maxItems: 4,
      maxBytes: 64 * 1024,
      maxAgeMs: 5_000,
      maxDrainBatch: 4
    }, (delivery) => {
      const driver = delivery.event.facts.find((fact) => fact.name === 'driver.name')
      if (driver?.value?.kind === 'string') healthyDriver = driver.value.value
    })

    hub.emit('snapshot', snapshot(1))
    await settle()
    expect(healthyDriver).toBe('Driver A')
  })

  it('bounds overflow, reports drops, and marks the surviving frame with a gap', async () => {
    const hub = new TelemetryHub()
    const kernel = new Phase02TapKernel(hub)
    kernels.push(kernel)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const delivered: string[] = []
    const subscription = kernel.subscribe('passport', {
      maxItems: 1,
      maxBytes: 64 * 1024,
      maxAgeMs: 10_000,
      maxDrainBatch: 1
    }, async (delivery) => {
      delivered.push(delivery.event.integrityFlags.join(','))
      if (delivered.length === 1) await gate
    })

    hub.emit('snapshot', snapshot(1))
    await settle()
    for (let index = 2; index <= 12; index += 1) hub.emit('snapshot', snapshot(index))
    await settle()
    expect(subscription.status().dropped).toBeGreaterThan(0)
    expect(subscription.status().overflowCount).toBeGreaterThan(0)
    release()
    await settle()
    await settle()
    expect(delivered.some((flags) => flags.includes('gap'))).toBe(true)
    expect(subscription.status().queuedItems).toBeLessThanOrEqual(1)
  })

  it('enforces the kill switch without accumulating a hidden backlog', async () => {
    const hub = new TelemetryHub()
    const kernel = new Phase02TapKernel(hub)
    kernels.push(kernel)
    const consumer = vi.fn()
    const subscription = kernel.subscribe('passport', {
      maxItems: 4,
      maxBytes: 64 * 1024,
      maxAgeMs: 5_000,
      maxDrainBatch: 4
    }, consumer)
    subscription.setKillSwitch(true)
    for (let index = 1; index <= 5; index += 1) hub.emit('snapshot', snapshot(index))
    await settle()
    expect(consumer).not.toHaveBeenCalled()
    hub.emit('snapshot', null)
    await settle()
    expect(consumer).toHaveBeenCalledOnce()
    expect(subscription.status()).toMatchObject({
      killSwitch: true,
      enabled: false,
      queuedItems: 0,
      queuedBytes: 0
    })
  })

  it('marks an age-expired involuntary drop as a gap on the next delivery', async () => {
      const hub = new TelemetryHub()
      let now = 0
      const kernel = new Phase02TapKernel(hub, () => now, () => BigInt(now + 1))
      kernels.push(kernel)
      const deliveries: string[][] = []
      const subscription = kernel.subscribe('passport', {
        maxItems: 4,
        maxBytes: 64 * 1024,
        maxAgeMs: 100,
        maxDrainBatch: 4
      }, (delivery) => {
        deliveries.push(delivery.event.integrityFlags)
      })
      hub.emit('snapshot', snapshot(1))
      now = 1_000
      await settle()
      expect(subscription.status().dropped).toBe(1)
      expect(deliveries).toEqual([])
      now = 1_001
      hub.emit('snapshot', snapshot(2))
      await settle()
      expect(deliveries[0]).toContain('gap')
      expect(subscription.status().gapPending).toBe(false)
  })
})
