import { describe, expect, it } from 'vitest'
import {
  BLAMELESS_DEBRIEF_STATEMENT,
  DEFAULT_MISSION_REHEARSAL_MANIFEST,
  MISSION_REHEARSAL_SOURCE,
  MissionSchemaError,
  advanceMissionRun,
  assertMissionManifest,
  buildMissionDebrief,
  canRoleSelectMissionDecision,
  compareMissionRuns,
  createMissionRun,
  materializeMissionEvents,
  missionChecksum,
  parseMissionManifestJson,
  parseMissionRunJson,
  scoreMissionRun,
  serializeMissionManifest,
  serializeMissionRun,
  validateMissionManifest,
  type MissionRun,
  type MissionScenarioManifest
} from './mission-rehearsal'
import {
  MISSION_REHEARSAL_STORAGE_PREFIX,
  archiveMissionRun,
  isMissionRehearsalStorageKey,
  loadMissionResume,
  loadMissionRunHistory,
  resetAllMissionTrainingData,
  saveMissionDraft,
  saveMissionResume,
  type MissionStorageLike
} from './mission-rehearsal-storage'

function manifestClone(): MissionScenarioManifest {
  return JSON.parse(JSON.stringify(DEFAULT_MISSION_REHEARSAL_MANIFEST)) as MissionScenarioManifest
}

function expectedRun(id: string, start = 1_000): MissionRun {
  const manifest = manifestClone()
  let run = createMissionRun(manifest, 'race-engineer', { id, now: start })
  run = advanceMissionRun(manifest, run, 'confirm-neutralized-pace', start + 100)
  run = advanceMissionRun(manifest, run, 'prepare-wet-stop', start + 200)
  return advanceMissionRun(manifest, run, 'fallback-protocol', start + 300)
}

function riskRun(id: string, start = 2_000): MissionRun {
  const manifest = manifestClone()
  let run = createMissionRun(manifest, 'race-engineer', { id, now: start })
  run = advanceMissionRun(manifest, run, 'protect-gap-before-yellow', start + 100)
  return advanceMissionRun(manifest, run, 'defend-without-timeline', start + 200)
}

class MemoryStorage implements MissionStorageLike {
  readonly values = new Map<string, string>()
  readonly writes: string[] = []
  readonly removals: string[] = []

  get length(): number {
    return this.values.size
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.writes.push(key)
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.removals.push(key)
    this.values.delete(key)
  }
}

describe('mission rehearsal manifest and deterministic branches', () => {
  it('accepts the bundled v1 manifest and rejects unknown schema fields', () => {
    expect(assertMissionManifest(manifestClone()).schemaVersion).toBe(1)

    const unknown = { ...manifestClone(), liveTelemetry: true }
    const result = validateMissionManifest(unknown)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues).toContainEqual({ path: '$.liveTelemetry', message: 'unknown field' })
  })

  it('materializes the same synthetic events and branch for repeated inputs', () => {
    const manifest = manifestClone()
    const firstEvents = materializeMissionEvents(manifest, 'weather-window', 'race-engineer')
    const secondEvents = materializeMissionEvents(manifest, 'weather-window', 'race-engineer')
    expect(secondEvents).toEqual(firstEvents)
    expect(firstEvents.every((event) => event.source === MISSION_REHEARSAL_SOURCE)).toBe(true)

    let first = createMissionRun(manifest, 'race-engineer', { id: 'run-determinism-a', now: 100 })
    let second = createMissionRun(manifest, 'race-engineer', { id: 'run-determinism-b', now: 900 })
    for (const decisionId of ['confirm-neutralized-pace', 'prepare-wet-stop', 'fallback-protocol']) {
      first = advanceMissionRun(manifest, first, decisionId, first.updatedAt + 10)
      second = advanceMissionRun(manifest, second, decisionId, second.updatedAt + 50)
    }

    expect(first.steps.map(({ checkpointId, decisionId }) => ({ checkpointId, decisionId }))).toEqual(
      second.steps.map(({ checkpointId, decisionId }) => ({ checkpointId, decisionId }))
    )
    expect(first.status).toBe('completed')
    expect(scoreMissionRun(manifest, first).percent).toBe(scoreMissionRun(manifest, second).percent)
  })
})

describe('mission rehearsal role permissions and checkpoint resume', () => {
  it('allows observers to follow a run but never to make a protected decision', () => {
    const manifest = manifestClone()
    const run = createMissionRun(manifest, 'observer', { id: 'run-observer', now: 100 })

    expect(canRoleSelectMissionDecision(
      manifest,
      'observer',
      'neutralization-call',
      'confirm-neutralized-pace'
    )).toBe(false)
    expect(() => advanceMissionRun(manifest, run, 'confirm-neutralized-pace', 200)).toThrow(
      /not permitted/
    )
  })

  it('round-trips a checksummed checkpoint and resumes the same deterministic branch', () => {
    const manifest = manifestClone()
    const storage = new MemoryStorage()
    let original = createMissionRun(manifest, 'race-engineer', { id: 'run-resume', now: 1_000 })
    original = advanceMissionRun(manifest, original, 'confirm-neutralized-pace', 1_100)
    saveMissionResume(storage, manifest, original, 1_150)

    const loaded = loadMissionResume(storage, manifest)
    expect(loaded.error).toBeNull()
    expect(loaded.value).toEqual(original)

    let resumed = loaded.value!
    original = advanceMissionRun(manifest, original, 'prepare-wet-stop', 1_200)
    resumed = advanceMissionRun(manifest, resumed, 'prepare-wet-stop', 1_200)
    expect(resumed).toEqual(original)
    expect(resumed.currentCheckpointId).toBe('degraded-comms')
  })
})

describe('mission rehearsal synthetic/live isolation', () => {
  it('writes and resets only the dedicated training namespace', () => {
    const manifest = manifestClone()
    const storage = new MemoryStorage()
    storage.setItem('usa.telemetry.history', '{"live":true}')
    storage.setItem('usa.live.session-history', '{"laps":12}')

    const run = createMissionRun(manifest, 'race-engineer', { id: 'run-isolation', now: 100 })
    saveMissionDraft(storage, manifest, 110)
    saveMissionResume(storage, manifest, run, 120)
    storage.setItem(`${MISSION_REHEARSAL_STORAGE_PREFIX}active.other-scenario`, '{"training":true}')
    resetAllMissionTrainingData(storage)

    expect(storage.getItem('usa.telemetry.history')).toBe('{"live":true}')
    expect(storage.getItem('usa.live.session-history')).toBe('{"laps":12}')
    expect(storage.getItem(`${MISSION_REHEARSAL_STORAGE_PREFIX}active.other-scenario`)).toBeNull()
    expect(storage.writes.slice(2).every(isMissionRehearsalStorageKey)).toBe(true)
    expect(storage.removals.every((key) => key.startsWith(MISSION_REHEARSAL_STORAGE_PREFIX))).toBe(true)
    expect(manifest.boundary.syntheticDataPolicy).toBe('never-write-live-telemetry-or-history')
    expect(run.source).toBe('synthetic-training')
  })

  it('rejects any event or run that claims a live source', () => {
    const manifest = manifestClone()
    manifest.checkpoints[0].syntheticEvents[0].source = 'live' as typeof MISSION_REHEARSAL_SOURCE
    const manifestResult = validateMissionManifest(manifest)
    expect(manifestResult.ok).toBe(false)
    if (!manifestResult.ok) {
      expect(manifestResult.issues.some((issue) => issue.path.endsWith('.source'))).toBe(true)
    }

    const validManifest = manifestClone()
    const run = {
      ...createMissionRun(validManifest, 'race-engineer', { id: 'run-live-source', now: 100 }),
      source: 'live'
    }
    expect(() => serializeMissionRun(validManifest, run as MissionRun)).toThrow(/run is invalid/)
  })
})

describe('mission rehearsal scoring, debrief, and repeat comparison', () => {
  it('scores expected decisions and produces a blameless debrief for variances', () => {
    const manifest = manifestClone()
    const strong = expectedRun('run-score-strong')
    const risk = riskRun('run-score-risk')

    expect(scoreMissionRun(manifest, strong)).toMatchObject({
      points: 300,
      maxPoints: 300,
      percent: 100,
      completed: true
    })
    const riskScore = scoreMissionRun(manifest, risk)
    expect(riskScore.percent).toBe(33)
    const debrief = buildMissionDebrief(manifest, risk)
    expect(debrief.blamelessStatement).toBe(BLAMELESS_DEBRIEF_STATEMENT)
    expect(debrief.reviewPrompts.length).toBeGreaterThan(0)
    expect(debrief.reviewPrompts.join(' ')).toContain('not individual fault')
  })

  it('compares repeat runs across changed branches and archives them deterministically', () => {
    const manifest = manifestClone()
    const storage = new MemoryStorage()
    const baseline = riskRun('run-repeat-baseline')
    const current = expectedRun('run-repeat-current')
    const comparison = compareMissionRuns(manifest, baseline, current)

    expect(comparison.percentDelta).toBeGreaterThan(0)
    expect(comparison.changedCheckpointIds).toContain('neutralization-call')
    expect(comparison.improvedCheckpointIds).toContain('neutralization-call')
    expect(comparison.currentPercent).toBe(100)

    expect(archiveMissionRun(storage, manifest, baseline, 4_000).error).toBeNull()
    expect(archiveMissionRun(storage, manifest, current, 5_000).error).toBeNull()
    const history = loadMissionRunHistory(storage, manifest)
    expect(history.error).toBeNull()
    expect(history.value?.map((run) => run.id)).toEqual(['run-repeat-baseline', 'run-repeat-current'])
  })
})

describe('mission rehearsal tamper and corruption handling', () => {
  it('rejects corrupt JSON and checksum-tampered manifests', () => {
    const manifest = manifestClone()
    expect(() => parseMissionManifestJson('{not-json')).toThrow(MissionSchemaError)

    const tampered = JSON.parse(serializeMissionManifest(manifest, 1_000)) as {
      manifest: MissionScenarioManifest
    }
    tampered.manifest.title = 'Tampered title'
    expect(() => parseMissionManifestJson(JSON.stringify(tampered))).toThrow(/integrity check/)
  })

  it('rejects a re-checksummed run whose checkpoint state does not match its decisions', () => {
    const manifest = manifestClone()
    const run = createMissionRun(manifest, 'race-engineer', { id: 'run-tamper', now: 100 })
    const file = JSON.parse(serializeMissionRun(manifest, run, 200)) as Record<string, unknown> & {
      run: MissionRun
      integrity: { algorithm: 'fnv1a32'; checksum: string }
    }
    file.run.currentCheckpointId = 'steward-review'
    const base = {
      kind: file.kind,
      schemaVersion: file.schemaVersion,
      exportedAt: file.exportedAt,
      run: file.run
    }
    file.integrity.checksum = missionChecksum(base)

    try {
      parseMissionRunJson(JSON.stringify(file), manifest)
      throw new Error('Expected the tampered run to be rejected.')
    } catch (error) {
      expect(error).toBeInstanceOf(MissionSchemaError)
      expect((error as MissionSchemaError).issues.some((issue) =>
        issue.message.includes('deterministic branch state')
      )).toBe(true)
    }
  })

  it('surfaces corrupt saved checkpoints instead of silently resuming them', () => {
    const manifest = manifestClone()
    const storage = new MemoryStorage()
    saveMissionResume(
      storage,
      manifest,
      createMissionRun(manifest, 'race-engineer', { id: 'run-corrupt-storage', now: 100 }),
      200
    )
    const key = storage.writes.at(-1)!
    storage.values.set(key, '{"kind":"broken"}')

    const loaded = loadMissionResume(storage, manifest)
    expect(loaded.value).toBeNull()
    expect(loaded.error).toBeInstanceOf(MissionSchemaError)
  })
})
