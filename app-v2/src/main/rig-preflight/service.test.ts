import { describe, expect, it } from 'vitest'
import {
  RIG_PREFLIGHT_CHECK_IDS,
  applyRigPreflightPreset,
  type RigEvidenceMeta,
  type RigPreflightObservation,
  type RigPreflightProfilePatch
} from '../../shared/rig-preflight'
import {
  LEGACY_UNBOUND_PROFILE_HASH,
  RigPreflightProfileConflictError,
  RigPreflightService,
  RigPreflightStorageBlockedError,
  type RigPreflightPersistence
} from './service'

class MemoryPersistence implements RigPreflightPersistence {
  content: string | null = null
  quarantines: string[] = []
  readError: Error | null = null
  writeError: Error | null = null

  async read(): Promise<string | null> {
    if (this.readError) throw this.readError
    return this.content
  }

  async write(content: string): Promise<void> {
    if (this.writeError) throw this.writeError
    this.content = content
  }

  async quarantine(reason: string): Promise<string | null> {
    this.quarantines.push(reason)
    this.content = null
    return 'rig-preflight.json.corrupt-test.json'
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
      openDashboardWindowIdentities: ['race@1:fullscreen']
    },
    serial: {
      meta,
      availablePorts: ['COM3', 'COM4'],
      simxConnected: true,
      simxIdentity: 'serial:simx-001',
      configuredIdentities: ['serial:iflag-001'],
      connectedConfiguredIdentities: ['serial:iflag-001'],
      observedConfiguredIdentities: [
        'serial:iflag-001=>vid=2341;pid=0043;serial=iflag-001'
      ],
      configuredIdentityStatuses: [{
        desiredIdentity: 'serial:iflag-001',
        observedIdentity: 'vid=2341;pid=0043;serial=iflag-001',
        state: 'verified',
        reason: 'Observed VID, PID, and serial match the saved hardware identity.'
      }],
      esp32RequiredIdentities: ['profile:esp32-001'],
      esp32ConnectedIdentities: ['wifi:esp32-001']
    },
    audio: {
      meta,
      enumerationSucceeded: true,
      audioEngineOk: true,
      audioContextState: 'running',
      outputIdentities: ['audio-output:default'],
      outputLabels: ['System default'],
      inputIdentities: ['audio-input:mic'],
      inputLabels: ['Microphone']
    },
    tts: {
      meta,
      enginePresent: true,
      engineOk: true,
      installedVoiceIds: ['voice:en_US-lessac-medium']
    },
    stt: {
      meta,
      enabled: true,
      binaryPresent: true,
      modelPresent: true,
      vadModelPresent: true
    },
    haptics: {
      meta,
      enabled: true,
      muted: false,
      enabledEffects: 1,
      outputDeviceId: 'default',
      audioRouteAvailable: true,
      arduinoEnabled: false,
      arduinoDeviceId: '',
      arduinoConnected: false
    },
    controls: {
      meta,
      gamepadIdentities: ['gamepad:wheel-001'],
      bindingIdentities: ['binding:pit'],
      enabledBindingIdentities: ['binding:pit'],
      keyboardEmulationAvailable: true,
      gamepadEmulationAvailable: true
    },
    streaming: {
      meta,
      running: true,
      port: 47655,
      accessMode: 'local',
      autoTunnelAvailable: true,
      ownerState: 'app',
      ownerPid: 100
    }
  }
}

async function saveProfile(
  service: RigPreflightService,
  patch: RigPreflightProfilePatch
): Promise<void> {
  const state = await service.getState()
  await service.setProfile({
    ...patch,
    revision: state.profile.revision,
    hash: state.profile.hash
  })
}

async function runBound(service: RigPreflightService) {
  const state = await service.getState()
  return service.run({ profile: state.profile })
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
    await saveProfile(first, {
      requirements: {
        requireKnownGood: true
      }
    })

    const baselineCandidate = await runBound(first)
    expect(baselineCandidate.certificate.decision).toBe('blocked')
    expect(baselineCandidate.eligibleAsKnownGood).toBe(true)
    await first.acceptKnownGood(baselineCandidate.id, 'Crew chief')
    await first.createWaiver({
      checkId: RIG_PREFLIGHT_CHECK_IDS.simx,
      reason: 'No SIM-X is in this profile; retained as operator note',
      owner: 'Crew chief',
      expiresAt: now + 60_000
    })
    const certified = await runBound(first)
    expect(certified.certificate.decision).toBe('ready')
    expect(certified.certificate.drift).toBe('match')
    await first.runFaultMatrix({ profile: (await first.getState()).profile })

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
    const run = await runBound(service)
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
    await saveProfile(service, {
      requirements: {
        requireSimulator: false,
        minDisplays: 0,
        requireAudioOutput: false,
        requireStreaming: true,
        streamingPort: 47655,
        requireKnownGood: true
      }
    })
    const baseline = await runBound(service)
    await service.acceptKnownGood(baseline.id)
    ownerPid = 202
    now += 1000
    const rerun = await runBound(service)
    expect(rerun.certificate.drift).toBe('match')
    expect(rerun.certificate.decision).toBe('ready')
  })

  it('caps certificate expiry at the earliest active waiver expiry', async () => {
    let now = 40_000
    const current = observation(now)
    current.serial!.simxConnected = false
    current.audio!.inputIdentities = []
    const service = new RigPreflightService({
      persistence: new MemoryPersistence(),
      now: () => now,
      createId: () => `waiver-${now}`,
      collectObservation: async () => current
    })
    await saveProfile(service, {
      requirements: {
        requireSimX: true,
        requireAudioInput: true,
        requireKnownGood: false
      }
    })
    const waiverExpiry = now + 5_000
    await service.createWaiver({
      checkId: RIG_PREFLIGHT_CHECK_IDS.simx,
      reason: 'Approved spare controls for one short session',
      owner: 'Crew chief',
      expiresAt: waiverExpiry
    })
    await service.createWaiver({
      checkId: RIG_PREFLIGHT_CHECK_IDS.audioInput,
      reason: 'Use push-to-talk from the crew station for this session',
      owner: 'Crew chief',
      expiresAt: now + 10_000
    })
    const run = await runBound(service)
    expect(run.certificate.decision).toBe('ready-with-waivers')
    expect(run.certificate.expiresAt).toBe(waiverExpiry)
    expect(run.certificate.expiryBasis).toBe('waiver')
    now = waiverExpiry
    expect(await service.expireActiveCertificate()).toBe(true)
    expect((await service.getState()).activeCertificate?.invalidationReason).toContain(
      'earliest active waiver'
    )
  })

  it('rejects unsaved, stale, and concurrently changed profile revisions', async () => {
    let now = 50_000
    let releaseCollection: () => void = () => undefined
    let blockCollection = false
    const service = new RigPreflightService({
      persistence: new MemoryPersistence(),
      now: () => now,
      createId: () => `profile-${now}`,
      collectObservation: async () => {
        if (blockCollection) {
          await new Promise<void>((resolve) => {
            releaseCollection = resolve
          })
        }
        return observation(now)
      }
    })
    const initial = (await service.getState()).profile
    const unsaved = { ...initial, name: 'Unsaved local edit' }
    await expect(service.run({ profile: unsaved })).rejects.toBeInstanceOf(
      RigPreflightProfileConflictError
    )

    await service.setProfile({ ...initial, name: 'Saved once' })
    await expect(
      service.setProfile({ ...initial, name: 'Stale overwrite' })
    ).rejects.toBeInstanceOf(RigPreflightProfileConflictError)

    const bound = (await service.getState()).profile
    blockCollection = true
    const runPromise = service.run({ profile: bound })
    await Promise.resolve()
    await service.setProfile({ ...bound, name: 'Concurrent save' })
    releaseCollection()
    await expect(runPromise).rejects.toBeInstanceOf(RigPreflightProfileConflictError)
  })

  it('requires fresh full revalidation after restart before restoring readiness', async () => {
    let now = 60_000
    const persistence = new MemoryPersistence()
    const makeService = () => new RigPreflightService({
      persistence,
      now: () => now,
      createId: () => `restart-${now}`,
      collectObservation: async () => observation(now)
    })
    const first = makeService()
    const run = await runBound(first)
    expect(run.certificate.decision).toBe('ready')

    now += 1_000
    const restarted = makeService()
    expect(await restarted.requireStartupRevalidation()).toBe(true)
    let state = await restarted.getState()
    expect(state.activeCertificateRevalidationRequired).toBe(true)

    const result = await restarted.revalidate({ profile: state.profile })
    expect(result.status).toBe('verified')
    state = await restarted.getState()
    expect(state.activeCertificateRevalidationRequired).toBe(false)
    expect(state.activeCertificate?.lastValidatedAt).toBe(now)
  })

  it('uses the earliest required evidence deadline as the canonical freshUntil', async () => {
    const now = 64_000
    const current = observation(now)
    current.audio!.meta = {
      ...current.audio!.meta,
      observedAt: now - 10_000
    }
    const service = new RigPreflightService({
      persistence: new MemoryPersistence(),
      now: () => now,
      createId: () => `minimum-deadline-${now}`,
      collectObservation: async () => current
    })

    await runBound(service)
    const state = await service.getState()
    expect(state.activeCertificate?.freshUntil).toBe(
      current.audio!.meta.observedAt + state.profile.evidenceMaxAgeMs
    )
  })

  it('does not re-age near-expiry evidence from revalidation completion', async () => {
    const evidenceAt = 65_000
    let now = evidenceAt
    const service = new RigPreflightService({
      persistence: new MemoryPersistence(),
      now: () => now,
      createId: () => `heartbeat-${now}`,
      collectObservation: async () => observation(evidenceAt)
    })
    await runBound(service)
    let state = await service.getState()
    const maxAgeMs = state.profile.evidenceMaxAgeMs
    const originalFreshUntil = evidenceAt + maxAgeMs
    expect(state.activeCertificate?.freshUntil).toBe(originalFreshUntil)

    now = evidenceAt + 59_999
    const heartbeat = await service.revalidate({ profile: state.profile })
    expect(heartbeat).toEqual({ changed: true, status: 'verified' })
    state = await service.getState()
    expect(state.activeCertificate?.lastValidatedAt).toBe(now)
    expect(state.activeCertificate?.freshUntil).toBe(originalFreshUntil)

    expect(await service.expireStaleEvidenceHeartbeat()).toBe(false)
    now = evidenceAt + 60_001
    expect(await service.expireStaleEvidenceHeartbeat()).toBe(true)
    state = await service.getState()
    expect(state.activeCertificate?.invalidatedAt).toBe(now)
    expect(state.activeCertificate?.invalidationReason).toContain('freshness deadline')
    expect(state.activeCertificate?.invalidationProvenance[0]?.source).toContain(
      'main-process'
    )
  })

  it('persists the canonical evidence deadline across restart and revokes synchronously', async () => {
    const evidenceAt = 130_000
    let now = evidenceAt
    const persistence = new MemoryPersistence()
    const makeService = () => new RigPreflightService({
      persistence,
      now: () => now,
      createId: () => `restart-deadline-${now}`,
      collectObservation: async () => observation(evidenceAt)
    })
    const first = makeService()
    await runBound(first)
    const initial = await first.getState()
    const freshUntil = initial.activeCertificate!.freshUntil
    expect(freshUntil).toBe(evidenceAt + initial.profile.evidenceMaxAgeMs)
    const persisted = JSON.parse(persistence.content as string) as {
      activeCertificate: { freshUntil: number }
    }
    persisted.activeCertificate.freshUntil = freshUntil + 999_999
    persistence.content = JSON.stringify(persisted)

    now = evidenceAt + 30_000
    const restarted = makeService()
    let restored = await restarted.getState()
    expect(restored.activeCertificate?.freshUntil).toBe(freshUntil)
    expect(restored.activeCertificate?.invalidatedAt).toBeNull()

    now = freshUntil + 1
    restored = await restarted.getState()
    expect(restored.activeCertificate?.freshUntil).toBe(freshUntil)
    expect(restored.activeCertificate?.invalidatedAt).toBe(now)
    expect(restored.activeCertificate?.invalidationReason).toContain('freshness deadline')
  })

  it('invalidates on every required monitored subsystem and same-count identity drift', async () => {
    const cases: Array<{
      name: string
      prepare?(value: RigPreflightObservation): void
      mutate(value: RigPreflightObservation): void
    }> = [
      {
        name: 'dashboard windows',
        mutate: (value) => { value.displays!.openDashboardWindowIdentities = [] }
      },
      {
        name: 'ESP32 identity',
        mutate: (value) => { value.serial!.esp32ConnectedIdentities = ['profile:esp32-replacement'] }
      },
      {
        name: 'observed serial identity',
        mutate: (value) => {
          value.serial!.observedConfiguredIdentities = [
            'serial:iflag-001=>vid=2341;pid=0043;serial=iflag-replacement'
          ]
          value.serial!.configuredIdentityStatuses = [{
            desiredIdentity: 'serial:iflag-001',
            observedIdentity: 'vid=2341;pid=0043;serial=iflag-replacement',
            state: 'verified',
            reason: 'Observed identity changed.'
          }]
        }
      },
      {
        name: 'streaming ownership',
        mutate: (value) => { value.streaming!.ownerState = 'foreign' }
      },
      {
        name: 'audio context',
        mutate: (value) => { value.audio!.audioContextState = 'suspended' }
      },
      {
        name: 'TTS',
        mutate: (value) => { value.tts!.engineOk = false }
      },
      {
        name: 'STT',
        mutate: (value) => { value.stt!.binaryPresent = false }
      },
      {
        name: 'haptics',
        mutate: (value) => { value.haptics!.enabled = false }
      },
      {
        name: 'haptics output identity',
        mutate: (value) => { value.haptics!.outputDeviceId = 'replacement-output' }
      },
      {
        name: 'haptics Arduino identity',
        prepare: (value) => {
          value.haptics!.audioRouteAvailable = false
          value.haptics!.arduinoEnabled = true
          value.haptics!.arduinoConnected = true
          value.haptics!.arduinoDeviceId = 'iflag-left'
        },
        mutate: (value) => { value.haptics!.arduinoDeviceId = 'iflag-right' }
      },
      {
        name: 'controls same-count replacement',
        mutate: (value) => { value.controls!.gamepadIdentities = ['gamepad:replacement'] }
      },
      {
        name: 'required resource',
        mutate: (value) => { value.streaming!.autoTunnelAvailable = false }
      }
    ]

    for (let index = 0; index < cases.length; index += 1) {
      let now = 70_000 + index * 1_000
      let current = observation(now)
      cases[index].prepare?.(current)
      const service = new RigPreflightService({
        persistence: new MemoryPersistence(),
        now: () => now,
        createId: () => `${cases[index].name}-${now}`,
        collectObservation: async () => current
      })
      const saved = (await service.getState()).profile
      const full = applyRigPreflightPreset(saved, 'full-rig', now)
      await service.setProfile({
        ...full,
        requirements: {
          ...full.requirements,
          requireEsp32: true,
          requireStreamingTunnel: true,
          streamingPort: 47655,
          requireKnownGood: false
        }
      })
      const run = await runBound(service)
      expect(run.certificate.decision, cases[index].name).toBe('ready')
      current = JSON.parse(JSON.stringify(current)) as RigPreflightObservation
      cases[index].mutate(current)
      now += 100
      const state = await service.getState()
      const result = await service.revalidate({ profile: state.profile })
      expect(result.status, cases[index].name).toBe('invalidated')
      expect((await service.getState()).activeCertificate?.invalidatedAt, cases[index].name).toBe(now)
    }
  })

  it('quarantines corrupt storage, surfaces the blocker, and refuses relaxed runs', async () => {
    const persistence = new MemoryPersistence()
    persistence.content = '{not-json'
    const service = new RigPreflightService({
      persistence,
      now: () => 80_000,
      collectObservation: async () => observation(80_000)
    })
    const state = await service.getState()
    expect(state.storage.state).toBe('quarantined')
    expect(state.storage.blocked).toBe(true)
    expect(state.storage.quarantinePath).toContain('corrupt-test')
    expect(state.profile.mode).toBe('full-rig')
    expect(state.profile.requirements.requireStreamingTunnel).toBe(true)
    await expect(service.run({ profile: state.profile })).rejects.toBeInstanceOf(
      RigPreflightStorageBlockedError
    )
    expect(persistence.quarantines).toHaveLength(1)

    const recovered = await service.setProfile({
      ...state.profile,
      name: 'Explicitly recovered profile'
    })
    expect(recovered.storage.state).toBe('ok')
    expect(recovered.storage.blocked).toBe(false)
  })

  it('surfaces storage read errors and never falls back to a relaxed runnable profile', async () => {
    const persistence = new MemoryPersistence()
    persistence.readError = new Error('access denied')
    const service = new RigPreflightService({
      persistence,
      now: () => 85_000,
      collectObservation: async () => observation(85_000)
    })
    const state = await service.getState()
    expect(state.storage.state).toBe('error')
    expect(state.storage.blocked).toBe(true)
    expect(state.storage.message).toContain('access denied')
    expect(state.profile.mode).toBe('full-rig')
    await expect(service.run({ profile: state.profile })).rejects.toBeInstanceOf(
      RigPreflightStorageBlockedError
    )
  })

  it('migrates the prior profile/certificate format without discarding valid evidence', async () => {
    const persistence = new MemoryPersistence()
    const first = new RigPreflightService({
      persistence,
      now: () => 87_000,
      collectObservation: async () => observation(87_000)
    })
    await runBound(first)
    const legacy = JSON.parse(persistence.content as string) as {
      profile: Record<string, unknown>
      history: Array<Record<string, unknown> & { certificate: Record<string, unknown> }>
      activeCertificate: Record<string, unknown> & { certificate: Record<string, unknown> }
    }
    delete legacy.profile.revision
    delete legacy.profile.hash
    for (const run of legacy.history) {
      delete run.profileRevision
      delete run.profileHash
      delete run.certificate.expiryBasis
      delete run.certificate.profileRevision
      delete run.certificate.profileHash
    }
    delete legacy.activeCertificate.revalidationRequired
    delete legacy.activeCertificate.lastValidatedAt
    delete legacy.activeCertificate.freshUntil
    delete legacy.activeCertificate.certificate.expiryBasis
    delete legacy.activeCertificate.certificate.profileRevision
    delete legacy.activeCertificate.certificate.profileHash
    persistence.content = JSON.stringify(legacy)

    const migrated = new RigPreflightService({
      persistence,
      now: () => 88_000,
      collectObservation: async () => observation(88_000)
    })
    const state = await migrated.getState()
    expect(state.storage.state).toBe('ok')
    expect(state.profile.revision).toBe(1)
    expect(state.profile.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(state.history).toHaveLength(1)
    expect(state.history[0].profileHash).toBe(LEGACY_UNBOUND_PROFILE_HASH)
    expect(state.activeCertificate?.certificate.profileHash).toBe(LEGACY_UNBOUND_PROFILE_HASH)
    expect(state.activeCertificate?.freshUntil).toBe(
      state.activeCertificate!.certificate.issuedAt + state.profile.evidenceMaxAgeMs
    )
    await migrated.requireStartupRevalidation()
    const reloaded = new RigPreflightService({
      persistence,
      now: () => 89_000,
      collectObservation: async () => observation(89_000)
    })
    expect((await reloaded.getState()).storage.state).toBe('ok')
  })

  it('fails closed and rolls back in-memory profile changes after a storage write error', async () => {
    const persistence = new MemoryPersistence()
    const service = new RigPreflightService({
      persistence,
      now: () => 90_000,
      collectObservation: async () => observation(90_000)
    })
    const before = await service.getState()
    persistence.writeError = new Error('disk full')
    await expect(
      service.setProfile({ ...before.profile, name: 'Must not survive' })
    ).rejects.toBeInstanceOf(RigPreflightStorageBlockedError)
    const after = await service.getState()
    expect(after.profile.name).toBe(before.profile.name)
    expect(after.profile.revision).toBe(before.profile.revision)
    expect(after.storage.state).toBe('error')
    expect(after.storage.blocked).toBe(true)
    expect(after.storage.message).toContain('disk full')
  })
})
