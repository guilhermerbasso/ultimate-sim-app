import { describe, expect, it } from 'vitest'
import {
  RIG_PREFLIGHT_CHECK_IDS,
  type RigEvidenceMeta,
  type RigPreflightObservation
} from '../../shared/rig-preflight'
import {
  RigPreflightService,
  type RigPreflightPersistence
} from './service'

class MemoryPersistence implements RigPreflightPersistence {
  content: string | null = null

  async read(): Promise<string | null> {
    return this.content
  }

  async write(content: string): Promise<void> {
    this.content = content
  }
}

function observation(now: number): RigPreflightObservation {
  const meta: RigEvidenceMeta = {
    observedAt: now,
    provenance: [{ kind: 'runtime', source: 'restart test' }]
  }
  return {
    collectedAt: now,
    simulator: {
      meta,
      source: 'auto',
      active: 'iracing',
      connected: true,
      snapshotAt: now
    },
    displays: {
      meta,
      displayIds: [1],
      openDashboardWindows: 0
    },
    audio: {
      meta,
      enumerationAvailable: true,
      audioEngineOk: true,
      outputCount: 1,
      outputLabels: ['System default'],
      inputCount: 0,
      inputLabels: []
    }
  }
}

describe('RigPreflightService persistence', () => {
  it('restores history, baseline, waivers, fault evidence, and the active certificate after restart', async () => {
    let now = 10_000
    let id = 0
    const persistence = new MemoryPersistence()
    const options = {
      persistence,
      now: () => now,
      createId: () => `id-${++id}`,
      collectObservation: async () => observation(now)
    }
    const first = new RigPreflightService(options)
    await first.setProfile({
      requirements: {
        requireKnownGood: true
      }
    })

    const baselineCandidate = await first.run()
    expect(baselineCandidate.certificate.decision).toBe('blocked')
    expect(baselineCandidate.eligibleAsKnownGood).toBe(true)
    await first.acceptKnownGood(baselineCandidate.id, 'Crew chief')
    await first.createWaiver({
      checkId: RIG_PREFLIGHT_CHECK_IDS.simx,
      reason: 'No SIM-X is in this profile; retained as operator note',
      owner: 'Crew chief',
      expiresAt: now + 60_000
    })
    const certified = await first.run()
    expect(certified.certificate.decision).toBe('ready')
    expect(certified.certificate.drift).toBe('match')
    await first.runFaultMatrix()

    now += 1000
    const restarted = new RigPreflightService({
      ...options,
      now: () => now
    })
    const restored = await restarted.getState()
    expect(restored.history).toHaveLength(2)
    expect(restored.knownGood?.runId).toBe(baselineCandidate.id)
    expect(restored.waivers).toHaveLength(1)
    expect(restored.faultHistory[0]?.passed).toBe(restored.faultHistory[0]?.total)
    expect(restored.activeCertificate?.runId).toBe(certified.id)
    expect(restored.activeCertificate?.invalidatedAt).toBeNull()
    expect(restored.activeCertificateExpired).toBe(false)
  })

  it('marks a persisted certificate expired after the clock advances', async () => {
    let now = 20_000
    const persistence = new MemoryPersistence()
    const service = new RigPreflightService({
      persistence,
      now: () => now,
      createId: () => `id-${now}`,
      collectObservation: async () => observation(now)
    })
    const run = await service.run()
    now = run.certificate.expiresAt + 1
    expect((await service.getState()).activeCertificateExpired).toBe(true)
  })

  it('keeps the known-good signature stable when only the app process PID changes', async () => {
    let now = 30_000
    let ownerPid = 101
    let id = 0
    const persistence = new MemoryPersistence()
    const service = new RigPreflightService({
      persistence,
      now: () => now,
      createId: () => `stable-${++id}`,
      collectObservation: async () => ({
        collectedAt: now,
        streaming: {
          meta: {
            observedAt: now,
            provenance: [{ kind: 'os', source: 'port owner test' }]
          },
          running: true,
          port: 47655,
          accessMode: 'local',
          autoTunnelAvailable: false,
          ownerState: 'app',
          ownerPid,
          ownerName: 'ultimate-sim-app'
        }
      })
    })
    await service.setProfile({
      requirements: {
        requireSimulator: false,
        minDisplays: 0,
        requireAudioOutput: false,
        requireStreaming: true,
        streamingPort: 47655,
        requireKnownGood: true
      }
    })
    const baseline = await service.run()
    await service.acceptKnownGood(baseline.id)
    ownerPid = 202
    now += 1000
    const rerun = await service.run()
    expect(rerun.certificate.drift).toBe('match')
    expect(rerun.certificate.decision).toBe('ready')
  })
})
