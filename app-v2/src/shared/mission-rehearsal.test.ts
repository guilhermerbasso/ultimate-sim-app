import { describe, expect, it, vi } from 'vitest'
import {
  BLAMELESS_DEBRIEF_STATEMENT,
  DEFAULT_MISSION_REHEARSAL_MANIFEST,
  MISSION_MAX_IMPORT_CHARS,
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
  missionManifestChecksum,
  parseMissionManifestJson,
  parseMissionRunHistoryJson,
  parseMissionRunJson,
  scoreMissionRun,
  serializeMissionManifest,
  serializeMissionRun,
  serializeMissionRunHistory,
  validateMissionManifest,
  type MissionRun,
  type MissionScenarioManifest
} from './mission-rehearsal'
import {
  MISSION_REHEARSAL_STORAGE_PREFIX,
  archiveMissionRun,
  finalizeMissionRun,
  isMissionRehearsalStorageKey,
  loadMissionResume,
  loadMissionRunHistory,
  missionHistoryStorageKey,
  missionResumeStorageKey,
  resetAllMissionTrainingData,
  resetMissionTrainingBoundary,
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

function longRunFixture(): { manifest: MissionScenarioManifest; run: MissionRun } {
  const manifest = manifestClone()
  manifest.roles = [{
    id: 'runner',
    name: 'Runner',
    description: 'Completes the bounded long-run fixture.',
    permissions: ['run', 'decide', 'debrief']
  }]
  manifest.entryCheckpointId = `checkpoint-00-${'c'.repeat(100)}`
  manifest.checkpoints = Array.from({ length: 100 }, (_, index) => {
    const checkpointId = `checkpoint-${index.toString().padStart(2, '0')}-${'c'.repeat(100)}`
    const decisionId = `decision-${index.toString().padStart(2, '0')}-${'d'.repeat(102)}`
    const nextCheckpointId = index === 99
      ? null
      : `checkpoint-${(index + 1).toString().padStart(2, '0')}-${'c'.repeat(100)}`
    return {
      id: checkpointId,
      title: `Checkpoint ${index + 1}`,
      briefing: 'Advance the deterministic long-run fixture.',
      expectedDecisionId: decisionId,
      syntheticEvents: [],
      decisions: [{
        id: decisionId,
        label: `Decision ${index + 1}`,
        description: 'Advance to the next bounded checkpoint.',
        allowedRoleIds: ['runner'],
        score: 100,
        nextCheckpointId,
        outcomes: [{
          id: `outcome-${index.toString().padStart(2, '0')}`,
          title: 'Advanced',
          description: 'The deterministic fixture advanced.',
          tone: 'positive' as const
        }]
      }]
    }
  })
  const base = createMissionRun(manifest, 'runner', { id: 'run-long-fixture', now: 1_000 })
  const run: MissionRun = {
    ...base,
    updatedAt: 1_100,
    status: 'completed',
    currentCheckpointId: null,
    steps: manifest.checkpoints.map((checkpoint, index) => ({
      checkpointId: checkpoint.id,
      decisionId: checkpoint.decisions[0].id,
      decidedByRoleId: 'runner',
      decidedAt: 1_001 + index
    }))
  }
  return { manifest, run }
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

class FailingHistoryStorage extends MemoryStorage {
  failHistoryWrites = true

  override setItem(key: string, value: string): void {
    if (this.failHistoryWrites && key.includes('.run-history.')) {
      throw new Error('history write failed')
    }
    super.setItem(key, value)
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

  it('rejects a manifest whose exported envelope would exceed the import boundary', () => {
    const manifest = manifestClone()
    manifest.checkpoints[0].syntheticEvents[0].payload = {
      oversized: 'x'.repeat(MISSION_MAX_IMPORT_CHARS)
    }

    const result = validateMissionManifest(manifest)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.message.includes('serialized manifest file'))).toBe(true)
    }
    expect(() => serializeMissionManifest(manifest)).toThrow(MissionSchemaError)
  })

  it('keeps every serialized file within its parser boundary and round-trips retained history', () => {
    const { manifest, run } = longRunFixture()
    const manifestText = serializeMissionManifest(manifest, 1_000)
    const runText = serializeMissionRun(manifest, run, 1_100)
    const runs = Array.from({ length: 50 }, (_, index) => ({
      ...run,
      id: `run-long-${index.toString().padStart(2, '0')}`
    }))
    const historyText = serializeMissionRunHistory(manifest, runs, 1_200)
    const retained = parseMissionRunHistoryJson(historyText, manifest)

    expect(manifestText.length).toBeLessThanOrEqual(MISSION_MAX_IMPORT_CHARS)
    expect(runText.length).toBeLessThanOrEqual(MISSION_MAX_IMPORT_CHARS)
    expect(historyText.length).toBeLessThanOrEqual(MISSION_MAX_IMPORT_CHARS)
    expect(parseMissionManifestJson(manifestText)).toEqual(manifest)
    expect(parseMissionRunJson(runText, manifest)).toEqual(run)
    expect(retained.length).toBeLessThan(runs.length)
    expect(retained.map((entry) => entry.id)).toEqual(runs.slice(-retained.length).map((entry) => entry.id))
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

  it('orders equal-offset synthetic events without locale-sensitive comparison', () => {
    const manifest = manifestClone()
    const template = manifest.checkpoints[0].syntheticEvents[0]
    manifest.checkpoints[0].syntheticEvents = [
      { ...template, id: 'z-event', offsetMs: 500 },
      { ...template, id: 'a-event', offsetMs: 500 }
    ]
    const localeCompare = vi.spyOn(String.prototype, 'localeCompare').mockReturnValue(-1)

    try {
      expect(materializeMissionEvents(manifest, 'neutralization-call', 'race-engineer').map((event) => event.id))
        .toEqual(['a-event', 'z-event'])
      expect(localeCompare).not.toHaveBeenCalled()
    } finally {
      localeCompare.mockRestore()
    }
  })
})

describe('mission rehearsal role permissions and checkpoint resume', () => {
  it('keeps debrief observers out of the runnable-role set', () => {
    const manifest = manifestClone()
    const observer = manifest.roles.find((role) => role.id === 'observer')!

    expect(observer.permissions).not.toContain('run')
    expect(canRoleSelectMissionDecision(
      manifest,
      'observer',
      'neutralization-call',
      'confirm-neutralized-pace'
    )).toBe(false)
    expect(() => createMissionRun(manifest, 'observer', { id: 'run-observer', now: 100 }))
      .toThrow(/cannot run/)
  })

  it('rejects a runnable role that has no permitted terminal branch', () => {
    const manifest = manifestClone()
    const observer = manifest.roles.find((role) => role.id === 'observer')!
    observer.permissions = ['run', 'decide', 'debrief']

    const result = validateMissionManifest(manifest)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.message.includes('every permitted branch')))
        .toBe(true)
    }
  })

  it('rejects a runnable role with one safe choice and one dead-end choice', () => {
    const manifest = manifestClone()
    manifest.checkpoints[0].decisions[1].nextCheckpointId = 'crew-only-end'
    manifest.checkpoints.push({
      id: 'crew-only-end',
      title: 'Crew-only closeout',
      briefing: 'Only the crew chief can close this branch.',
      expectedDecisionId: 'crew-closeout',
      syntheticEvents: [],
      decisions: [{
        id: 'crew-closeout',
        label: 'Close the crew-only branch',
        description: 'Complete the branch as crew chief.',
        allowedRoleIds: ['crew-chief'],
        score: 100,
        nextCheckpointId: null,
        outcomes: [{
          id: 'crew-closed',
          title: 'Crew branch closed',
          description: 'The crew chief completed the branch.',
          tone: 'positive'
        }]
      }]
    })

    const result = validateMissionManifest(manifest)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.message.includes('every permitted branch')))
        .toBe(true)
    }
  })

  it('rejects a manifest with no runnable role', () => {
    const manifest = manifestClone()
    manifest.roles.forEach((role) => {
      role.permissions = role.permissions.filter((permission) => permission !== 'run')
    })

    const result = validateMissionManifest(manifest)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues).toContainEqual({
        path: '$.roles',
        message: 'must contain at least one runnable role'
      })
    }
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

  it('partitions resume and history keys by manifest revision and checksum', () => {
    const revisionOne = manifestClone()
    const revisionTwo = manifestClone()
    revisionTwo.revision = 2
    const changedChecksum = manifestClone()
    changedChecksum.title = 'Same revision, changed content'

    expect(missionResumeStorageKey(revisionOne)).not.toBe(missionResumeStorageKey(revisionTwo))
    expect(missionResumeStorageKey(revisionOne)).not.toBe(missionResumeStorageKey(changedChecksum))
    expect(missionHistoryStorageKey(revisionOne)).not.toBe(missionHistoryStorageKey(revisionTwo))
    expect(missionHistoryStorageKey(revisionOne)).not.toBe(missionHistoryStorageKey(changedChecksum))
  })

  it('migrates compatible id-only storage keys without consuming another manifest revision', () => {
    const manifest = manifestClone()
    const otherRevision = manifestClone()
    otherRevision.revision += 1
    const storage = new MemoryStorage()
    const resumed = createMissionRun(manifest, 'race-engineer', { id: 'run-legacy-resume', now: 1_000 })
    const completed = expectedRun('run-legacy-history')
    const legacyResumeKey = `${MISSION_REHEARSAL_STORAGE_PREFIX}active.${manifest.id}`
    const legacyHistoryKey = `${MISSION_REHEARSAL_STORAGE_PREFIX}run-history.${manifest.id}`
    storage.setItem(legacyResumeKey, serializeMissionRun(manifest, resumed, 1_100))
    storage.setItem(legacyHistoryKey, serializeMissionRunHistory(manifest, [completed], 1_200))

    expect(loadMissionResume(storage, otherRevision)).toEqual({ value: null, error: null })
    expect(loadMissionRunHistory(storage, otherRevision)).toEqual({ value: [], error: null })
    expect(storage.getItem(legacyResumeKey)).not.toBeNull()
    expect(storage.getItem(legacyHistoryKey)).not.toBeNull()

    expect(loadMissionResume(storage, manifest)).toEqual({ value: resumed, error: null })
    expect(loadMissionRunHistory(storage, manifest)).toEqual({ value: [completed], error: null })
    expect(storage.getItem(missionResumeStorageKey(manifest))).not.toBeNull()
    expect(storage.getItem(missionHistoryStorageKey(manifest))).not.toBeNull()
    expect(storage.getItem(legacyResumeKey)).toBeNull()
    expect(storage.getItem(legacyHistoryKey)).toBeNull()
  })

  it('clears matching legacy checkpoints inside the explicit training boundary', () => {
    const manifest = manifestClone()
    const storage = new MemoryStorage()
    const legacyResumeKey = `${MISSION_REHEARSAL_STORAGE_PREFIX}active.${manifest.id}`
    const run = createMissionRun(manifest, 'race-engineer', { id: 'run-legacy-reset', now: 1_000 })
    storage.setItem(legacyResumeKey, serializeMissionRun(manifest, run, 1_100))

    const removed = resetMissionTrainingBoundary(storage, manifest)

    expect(removed).toContain(legacyResumeKey)
    expect(storage.getItem(legacyResumeKey)).toBeNull()
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

  it('keeps a completed resume recoverable until history archival succeeds', () => {
    const manifest = manifestClone()
    const storage = new FailingHistoryStorage()
    const completed = expectedRun('run-finalize-recovery')

    const failed = finalizeMissionRun(storage, manifest, completed, 4_000)
    expect(failed.value).toBeNull()
    expect(failed.error).toBeInstanceOf(MissionSchemaError)
    expect(loadMissionResume(storage, manifest).value).toEqual(completed)

    storage.failHistoryWrites = false
    const retried = finalizeMissionRun(storage, manifest, completed, 5_000)
    expect(retried.error).toBeNull()
    expect(retried.value?.map((run) => run.id)).toEqual(['run-finalize-recovery'])
    expect(loadMissionResume(storage, manifest).value).toBeNull()
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
