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
    expect(subscription.status()).toMatchObject({
      killSwitch: true,
      enabled: false,
      queuedItems: 0,
      queuedBytes: 0
    })
  })
})
