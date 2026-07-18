import { describe, expect, it } from 'vitest'
import {
  RIG_PREFLIGHT_CHECK_IDS,
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
      connectedConfiguredIdentities: []
    }
    const check = evaluateRigPreflightChecks(fullProfile(), observation, [], NOW)
      .find((candidate) => candidate.id === RIG_PREFLIGHT_CHECK_IDS.configuredSerial)
    expect(check?.state).toBe('fail')
    expect(check?.observed).toContain('serial:iflag-001')
    expect(check?.remediation.join(' ')).toContain('COM-port')
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
