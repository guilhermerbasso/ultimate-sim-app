import { describe, expect, it } from 'vitest'
import {
  RIG_PREFLIGHT_CHECK_IDS,
  canonicalRigEsp32Identity,
  createRigPreflightProfile,
  evaluateRigPreflightChecks,
  normalizeEvidenceTimestamp,
  runRigPreflightFaultMatrix,
  summarizeRigPreflightChecks,
  type RigEvidenceMeta,
  type RigPreflightObservation,
  type RigPreflightProfile,
  type RigPreflightWaiver
} from './rig-preflight'

const NOW = 1_000_000

function meta(observedAt = NOW): RigEvidenceMeta {
  return {
    observedAt,
    owner: 'Test owner',
    provenance: [{ kind: 'runtime', source: 'test fixture' }]
  }
}

function readyObservation(): RigPreflightObservation {
  return {
    collectedAt: NOW,
    simulator: {
      meta: meta(),
      source: 'auto',
      active: 'iracing',
      connected: true,
      snapshotAt: NOW
    },
    displays: {
      meta: meta(),
      displayIds: [1, 2],
      openDashboardWindowIdentities: ['race@2:fullscreen']
    },
    serial: {
      meta: meta(),
      availablePorts: ['COM3', 'COM4'],
      simxConnected: true,
      simxIdentity: 'COM3',
      configuredIdentities: ['serial:iflag-001'],
      connectedConfiguredIdentities: ['serial:iflag-001'],
      observedConfiguredIdentities: [
        'serial:iflag-001=>vid=2341;pid=0043;serial=iflag-001'
      ],
      configuredIdentityStatuses: [{
        desiredIdentity: 'serial:iflag-001',
        observedIdentity: 'vid=2341;pid=0043;serial=iflag-001',
        state: 'verified',
        reason: 'Observed VID, PID, and serial match the saved hardware identity.',
        sources: ['serial-store:iflag-001']
      }],
      esp32RequiredIdentities: ['profile:esp32-s3'],
      esp32ConnectedIdentities: ['profile:esp32-s3']
    },
    audio: {
      meta: meta(),
      enumerationSucceeded: true,
      audioEngineOk: true,
      audioContextState: 'running',
      outputIdentities: ['audio-output:default', 'audio-output:bass'],
      outputLabels: ['System default', 'Bass shaker'],
      inputIdentities: ['audio-input:mic'],
      inputLabels: ['Microphone']
    },
    tts: {
      meta: meta(),
      enginePresent: true,
      engineOk: true,
      installedVoiceIds: ['voice:pt_BR-faber-medium']
    },
    stt: {
      meta: meta(),
      enabled: true,
      binaryPresent: true,
      modelPresent: true,
      vadModelPresent: true
    },
    haptics: {
      meta: meta(),
      enabled: true,
      muted: false,
      enabledEffects: 2,
      outputDeviceId: 'bass',
      audioRouteAvailable: true,
      arduinoEnabled: false,
      arduinoDeviceId: '',
      arduinoConnected: false
    },
    controls: {
      meta: meta(),
      gamepadIdentities: ['gamepad:Wheel'],
      bindingIdentities: ['binding:pit', 'binding:radio', 'binding:wiper'],
      enabledBindingIdentities: ['binding:pit', 'binding:radio', 'binding:wiper'],
      keyboardEmulationAvailable: true,
      gamepadEmulationAvailable: true
    },
    streaming: {
      meta: meta(),
      running: true,
      port: 47655,
      accessMode: 'local',
      autoTunnelAvailable: true,
      ownerState: 'app',
      ownerPid: 101
    }
  }
}

function fullProfile(): RigPreflightProfile {
  const profile = createRigPreflightProfile('full-rig', NOW, 'Crew chief')
  profile.requirements.requireEsp32 = true
  profile.requirements.streamingPort = 47655
  profile.requirements.requireStreamingTunnel = true
  profile.requirements.requireKnownGood = false
  return profile
}

describe('rig preflight evidence evaluation', () => {
  it('fails required serial devices after a disconnect', () => {
    const observation = readyObservation()
    observation.serial = {
      ...observation.serial!,
      connectedConfiguredIdentities: [],
      configuredIdentityStatuses: [{
        ...observation.serial!.configuredIdentityStatuses[0],
        state: 'fail',
        reason: 'Configured device is not connected.'
      }]
    }
    const check = evaluateRigPreflightChecks(fullProfile(), observation, [], NOW)
      .find((candidate) => candidate.id === RIG_PREFLIGHT_CHECK_IDS.configuredSerial)
    expect(check?.state).toBe('fail')
    expect(check?.observed).toContain('serial:iflag-001')
    expect(check?.remediation.join(' ')).toContain('COM-port')
  })

  it('keeps identity-less serial hardware unknown unless an existing governed waiver applies', () => {
    const observation = readyObservation()
    observation.serial!.connectedConfiguredIdentities = []
    observation.serial!.configuredIdentityStatuses = [{
      desiredIdentity: 'serial:iflag-001',
      observedIdentity: 'vid=1a86;pid=7523;serial=?',
      state: 'unknown',
      reason: 'This hardware exposes no USB serial identity; use an existing governed preflight waiver if operation is explicitly approved.',
      sources: ['serial-store:iflag-001']
    }]
    const profile = fullProfile()
    let check = evaluateRigPreflightChecks(profile, observation, [], NOW)
      .find((candidate) => candidate.id === RIG_PREFLIGHT_CHECK_IDS.configuredSerial)
    expect(check?.state).toBe('unknown')
    expect(check?.remediation.join(' ')).toContain('time-bounded preflight waiver')

    const waiver: RigPreflightWaiver = {
      id: 'serial-less-waiver',
      checkId: RIG_PREFLIGHT_CHECK_IDS.configuredSerial,
      reason: 'Crew verified the single serial-less adapter at scrutineering',
      owner: 'Crew chief',
      createdAt: NOW - 1,
      expiresAt: NOW + 5_000
    }
    check = evaluateRigPreflightChecks(profile, observation, [waiver], NOW)
      .find((candidate) => candidate.id === RIG_PREFLIGHT_CHECK_IDS.configuredSerial)
    expect(check?.state).toBe('waived-with-reason')
    expect(check?.underlyingState).toBe('unknown')
  })

  it('canonicalizes profile and Wi-Fi ESP32 identities onto the same physical device', () => {
    const observation = readyObservation()
    observation.serial!.esp32RequiredIdentities = ['profile:rig-a']
    observation.serial!.esp32ConnectedIdentities = ['wifi:rig-a']
    const check = evaluateRigPreflightChecks(fullProfile(), observation, [], NOW)
      .find((candidate) => candidate.id === RIG_PREFLIGHT_CHECK_IDS.esp32)

    expect(canonicalRigEsp32Identity('profile:rig-a')).toBe('esp32:rig-a')
    expect(canonicalRigEsp32Identity('wifi:rig-a')).toBe('esp32:rig-a')
    expect(check?.state).toBe('verified')
    expect(check?.signatureMaterial).toContain('esp32:rig-a')
  })

  it('preserves nested ESP32 payloads without namespace collisions and round-trips canonically', () => {
    const nested = canonicalRigEsp32Identity('profile:wifi:rig-a')
    const simple = canonicalRigEsp32Identity('wifi:rig-a')
    expect(nested).toBe('esp32:wifi%3Arig-a')
    expect(simple).toBe('esp32:rig-a')
    expect(nested).not.toBe(simple)
    expect(canonicalRigEsp32Identity(nested)).toBe(nested)
    expect(canonicalRigEsp32Identity('wifi:wifi:rig-a')).toBe(nested)
    expect(canonicalRigEsp32Identity('rig-a')).toBeNull()
    expect(canonicalRigEsp32Identity('profile:')).toBeNull()
    expect(canonicalRigEsp32Identity('esp32:%not-encoded')).toBeNull()

    const nestedObservation = readyObservation()
    nestedObservation.serial!.esp32RequiredIdentities = ['profile:wifi:rig-a']
    nestedObservation.serial!.esp32ConnectedIdentities = ['wifi:wifi:rig-a']
    const nestedCheck = evaluateRigPreflightChecks(
      fullProfile(),
      nestedObservation,
      [],
      NOW
    ).find((candidate) => candidate.id === RIG_PREFLIGHT_CHECK_IDS.esp32)
    const collisionObservation = readyObservation()
    collisionObservation.serial!.esp32RequiredIdentities = ['profile:wifi:rig-a']
    collisionObservation.serial!.esp32ConnectedIdentities = ['wifi:rig-a']
    const collisionCheck = evaluateRigPreflightChecks(
      fullProfile(),
      collisionObservation,
      [],
      NOW
    ).find((candidate) => candidate.id === RIG_PREFLIGHT_CHECK_IDS.esp32)
    expect(nestedCheck?.state).toBe('verified')
    expect(collisionCheck?.state).toBe('fail')
    expect(nestedCheck?.signatureMaterial).not.toBe(collisionCheck?.signatureMaterial)

    const legacyObservation = readyObservation()
    legacyObservation.serial!.esp32RequiredIdentities = ['rig-a']
    legacyObservation.serial!.esp32ConnectedIdentities = ['wifi:rig-a']
    const legacyCheck = evaluateRigPreflightChecks(
      fullProfile(),
      legacyObservation,
      [],
      NOW
    ).find((candidate) => candidate.id === RIG_PREFLIGHT_CHECK_IDS.esp32)
    expect(legacyCheck?.state).toBe('unknown')
    expect(legacyCheck?.delta.join(' ')).toContain('invalid required ESP32 identity')
  })

  it('binds observed serial and haptics route identities into signature material', () => {
    const profile = fullProfile()
    const initial = readyObservation()
    const initialChecks = evaluateRigPreflightChecks(profile, initial, [], NOW)
    const initialSerial = initialChecks.find(
      (candidate) => candidate.id === RIG_PREFLIGHT_CHECK_IDS.configuredSerial
    )
    const initialHaptics = initialChecks.find(
      (candidate) => candidate.id === RIG_PREFLIGHT_CHECK_IDS.haptics
    )

    const replaced = readyObservation()
    replaced.serial!.observedConfiguredIdentities = [
      'serial:iflag-001=>vid=2341;pid=0043;serial=iflag-replacement'
    ]
    replaced.serial!.configuredIdentityStatuses = [{
      desiredIdentity: 'serial:iflag-001',
      observedIdentity: 'vid=2341;pid=0043;serial=iflag-replacement',
      state: 'verified',
      reason: 'Observed identity changed.',
      sources: ['serial-store:iflag-001']
    }]
    replaced.haptics!.outputDeviceId = 'replacement-bass-shaker'
    const replacedChecks = evaluateRigPreflightChecks(profile, replaced, [], NOW)
    const replacedSerial = replacedChecks.find(
      (candidate) => candidate.id === RIG_PREFLIGHT_CHECK_IDS.configuredSerial
    )
    const replacedHaptics = replacedChecks.find(
      (candidate) => candidate.id === RIG_PREFLIGHT_CHECK_IDS.haptics
    )

    expect(replacedSerial?.state).toBe('verified')
    expect(replacedSerial?.observed).toContain('iflag-replacement')
    expect(replacedSerial?.signatureMaterial).not.toBe(initialSerial?.signatureMaterial)
    expect(replacedHaptics?.state).toBe('verified')
    expect(replacedHaptics?.observed).toContain('replacement-bass-shaker')
    expect(replacedHaptics?.signatureMaterial).not.toBe(initialHaptics?.signatureMaterial)

    const arduinoA = readyObservation()
    arduinoA.haptics = {
      ...arduinoA.haptics!,
      audioRouteAvailable: false,
      arduinoEnabled: true,
      arduinoConnected: true,
      arduinoDeviceId: 'iflag-left'
    }
    const arduinoB = readyObservation()
    arduinoB.haptics = {
      ...arduinoB.haptics!,
      audioRouteAvailable: false,
      arduinoEnabled: true,
      arduinoConnected: true,
      arduinoDeviceId: 'iflag-right'
    }
    const arduinoCheckA = evaluateRigPreflightChecks(profile, arduinoA, [], NOW)
      .find((candidate) => candidate.id === RIG_PREFLIGHT_CHECK_IDS.haptics)
    const arduinoCheckB = evaluateRigPreflightChecks(profile, arduinoB, [], NOW)
      .find((candidate) => candidate.id === RIG_PREFLIGHT_CHECK_IDS.haptics)
    expect(arduinoCheckA?.state).toBe('verified')
    expect(arduinoCheckB?.state).toBe('verified')
    expect(arduinoCheckA?.signatureMaterial).not.toBe(arduinoCheckB?.signatureMaterial)

    const profileLinked = readyObservation()
    profileLinked.serial!.configuredIdentityStatuses[0].sources.push('profile:iflag-profile')
    const profileLinkedCheck = evaluateRigPreflightChecks(profile, profileLinked, [], NOW)
      .find((candidate) => candidate.id === RIG_PREFLIGHT_CHECK_IDS.configuredSerial)
    expect(profileLinkedCheck?.state).toBe('verified')
    expect(profileLinkedCheck?.signatureMaterial).not.toBe(initialSerial?.signatureMaterial)
  })

  it('downgrades otherwise-good stale evidence to unknown', () => {
    const profile = fullProfile()
    const observation = readyObservation()
    const staleAt = NOW - profile.evidenceMaxAgeMs - 1
    observation.simulator!.meta.observedAt = staleAt
    observation.simulator!.snapshotAt = staleAt
    const check = evaluateRigPreflightChecks(profile, observation, [], NOW)
      .find((candidate) => candidate.id === RIG_PREFLIGHT_CHECK_IDS.simulator)
    expect(check?.state).toBe('unknown')
    expect(check?.summary).toContain('stale')
  })

  it('keeps evidence valid at age 59,999ms and rejects it at 60,001ms', () => {
    const profile = fullProfile()
    profile.evidenceMaxAgeMs = 60_000
    const observation = readyObservation()
    let check = evaluateRigPreflightChecks(
      profile,
      observation,
      [],
      NOW + 59_999
    ).find((candidate) => candidate.id === RIG_PREFLIGHT_CHECK_IDS.simulator)
    expect(check?.state).toBe('verified')
    expect(check?.freshUntil).toBe(NOW + 60_000)

    check = evaluateRigPreflightChecks(
      profile,
      observation,
      [],
      NOW + 60_001
    ).find((candidate) => candidate.id === RIG_PREFLIGHT_CHECK_IDS.simulator)
    expect(check?.state).toBe('unknown')
  })

  it('verifies app port ownership and fails a foreign owner with PID remediation', () => {
    const profile = fullProfile()
    const observation = readyObservation()
    let check = evaluateRigPreflightChecks(profile, observation, [], NOW)
      .find((candidate) => candidate.id === RIG_PREFLIGHT_CHECK_IDS.streamingPort)
    expect(check?.state).toBe('verified')

    observation.streaming = {
      ...observation.streaming!,
      running: false,
      ownerState: 'foreign',
      ownerPid: 4242,
      ownerName: 'other-server'
    }
    check = evaluateRigPreflightChecks(profile, observation, [], NOW)
      .find((candidate) => candidate.id === RIG_PREFLIGHT_CHECK_IDS.streamingPort)
    expect(check?.state).toBe('fail')
    expect(check?.remediation.join(' ')).toContain('PID 4242')
  })

  it('reports missing speech binaries and models as resource failures', () => {
    const observation = readyObservation()
    observation.tts = {
      ...observation.tts!,
      enginePresent: false,
      engineOk: false,
      engineReason: 'missing'
    }
    observation.stt = {
      ...observation.stt!,
      binaryPresent: false,
      modelPresent: false
    }
    const checks = evaluateRigPreflightChecks(fullProfile(), observation, [], NOW)
    expect(checks.find((check) => check.id === RIG_PREFLIGHT_CHECK_IDS.ttsEngineResource)?.state).toBe('fail')
    expect(checks.find((check) => check.id === RIG_PREFLIGHT_CHECK_IDS.sttBinaryResource)?.state).toBe('fail')
    expect(checks.find((check) => check.id === RIG_PREFLIGHT_CHECK_IDS.sttModelResource)?.state).toBe('fail')
  })

  it('honors only a non-expired waiver with a reason', () => {
    const profile = fullProfile()
    const observation = readyObservation()
    observation.serial = { ...observation.serial!, simxConnected: false }
    const waiver: RigPreflightWaiver = {
      id: 'w1',
      checkId: RIG_PREFLIGHT_CHECK_IDS.simx,
      reason: 'Spare button box approved for this session',
      owner: 'Crew chief',
      createdAt: NOW - 1000,
      expiresAt: NOW + 1000
    }
    let check = evaluateRigPreflightChecks(profile, observation, [waiver], NOW)
      .find((candidate) => candidate.id === RIG_PREFLIGHT_CHECK_IDS.simx)
    expect(check?.state).toBe('waived-with-reason')
    expect(check?.waiver?.reason).toBe(waiver.reason)

    check = evaluateRigPreflightChecks(profile, observation, [waiver], NOW + 1001)
      .find((candidate) => candidate.id === RIG_PREFLIGHT_CHECK_IDS.simx)
    expect(check?.state).toBe('fail')
    expect(check?.remediation[0]).toContain('expired')
  })

  it('keeps no-hardware rigs explicit instead of silently assuming devices are ready', () => {
    const profile = createRigPreflightProfile('no-hardware', NOW)
    const checks = evaluateRigPreflightChecks(profile, readyObservation(), [], NOW)
    for (const id of [
      RIG_PREFLIGHT_CHECK_IDS.simx,
      RIG_PREFLIGHT_CHECK_IDS.configuredSerial,
      RIG_PREFLIGHT_CHECK_IDS.esp32,
      RIG_PREFLIGHT_CHECK_IDS.haptics,
      RIG_PREFLIGHT_CHECK_IDS.gamepad
    ]) {
      const check = checks.find((candidate) => candidate.id === id)
      expect(check?.applicability).toBe('not-required')
      expect(check?.summary).toContain('Explicitly excluded')
    }
    expect(summarizeRigPreflightChecks(checks).decision).toBe('ready')
  })

  it('requires successful audio enumeration and a running AudioContext', () => {
    const profile = fullProfile()
    const observation = readyObservation()
    observation.audio = {
      ...observation.audio!,
      enumerationSucceeded: false
    }
    let check = evaluateRigPreflightChecks(profile, observation, [], NOW)
      .find((candidate) => candidate.id === RIG_PREFLIGHT_CHECK_IDS.audioOutput)
    expect(check?.state).toBe('fail')

    observation.audio = {
      ...observation.audio!,
      enumerationSucceeded: true,
      audioContextState: 'suspended'
    }
    check = evaluateRigPreflightChecks(profile, observation, [], NOW)
      .find((candidate) => candidate.id === RIG_PREFLIGHT_CHECK_IDS.audioOutput)
    expect(check?.state).toBe('fail')
  })

  it('sorts stable identities and detects same-count device replacement', () => {
    const profile = fullProfile()
    const first = readyObservation()
    first.serial!.configuredIdentities = ['serial:b', 'serial:a']
    first.serial!.connectedConfiguredIdentities = ['serial:b', 'serial:a']
    const reordered = readyObservation()
    reordered.serial!.configuredIdentities = ['serial:a', 'serial:b']
    reordered.serial!.connectedConfiguredIdentities = ['serial:a', 'serial:b']
    const replaced = readyObservation()
    replaced.serial!.configuredIdentities = ['serial:a', 'serial:c']
    replaced.serial!.connectedConfiguredIdentities = ['serial:a', 'serial:c']
    const material = (observation: RigPreflightObservation): string | undefined =>
      evaluateRigPreflightChecks(profile, observation, [], NOW)
        .find((check) => check.id === RIG_PREFLIGHT_CHECK_IDS.configuredSerial)
        ?.signatureMaterial
    expect(material(first)).toBe(material(reordered))
    expect(material(replaced)).not.toBe(material(first))
  })

  it('preserves old timestamps, rejects invalid values, and caps only future evidence', () => {
    expect(normalizeEvidenceTimestamp(NOW - 600_000, NOW)).toBe(NOW - 600_000)
    expect(normalizeEvidenceTimestamp(Number.NaN, NOW)).toBe(0)
    expect(normalizeEvidenceTimestamp(-1, NOW)).toBe(0)
    expect(normalizeEvidenceTimestamp(NOW + 60_000, NOW)).toBe(NOW)

    const profile = fullProfile()
    const observation = readyObservation()
    observation.audio!.meta.observedAt = Number.NaN
    const check = evaluateRigPreflightChecks(profile, observation, [], NOW)
      .find((candidate) => candidate.id === RIG_PREFLIGHT_CHECK_IDS.audioOutput)
    expect(check?.state).toBe('unknown')
    expect(check?.observed).toBe('No evidence')
  })

  it('detects every safe seeded fault without hardware actuation', () => {
    const results = runRigPreflightFaultMatrix(fullProfile(), readyObservation(), NOW)
    expect(results).toHaveLength(6)
    expect(results.every((result) => result.detected)).toBe(true)
  })
})
