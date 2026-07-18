import {
  MissionSchemaError,
  parseMissionManifestJson,
  parseMissionRunHistoryJson,
  parseMissionRunJson,
  serializeMissionManifest,
  serializeMissionRun,
  serializeMissionRunHistory,
  type MissionRun,
  type MissionScenarioManifest
} from './mission-rehearsal'

export const MISSION_REHEARSAL_STORAGE_PREFIX = 'usa.training.mission-rehearsal.v1.'
export const MISSION_REHEARSAL_DRAFT_KEY = `${MISSION_REHEARSAL_STORAGE_PREFIX}manifest-draft`

export interface MissionStorageLike {
  readonly length?: number
  getItem(key: string): string | null
  key?(index: number): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface MissionStorageLoadResult<T> {
  value: T | null
  error: MissionSchemaError | null
}

export interface MissionResetOptions {
  includeDraft?: boolean
  includeHistory?: boolean
}

function manifestKeyPart(manifestId: string): string {
  return manifestId.replace(/[^a-z0-9._-]/g, '_')
}

export function missionResumeStorageKey(manifestId: string): string {
  return `${MISSION_REHEARSAL_STORAGE_PREFIX}active.${manifestKeyPart(manifestId)}`
}

export function missionHistoryStorageKey(manifestId: string): string {
  return `${MISSION_REHEARSAL_STORAGE_PREFIX}run-history.${manifestKeyPart(manifestId)}`
}

export function isMissionRehearsalStorageKey(key: string): boolean {
  return key.startsWith(MISSION_REHEARSAL_STORAGE_PREFIX)
}

function asSchemaError(error: unknown, label: string): MissionSchemaError {
  if (error instanceof MissionSchemaError) return error
  return new MissionSchemaError(label, [{ path: '$', message: error instanceof Error ? error.message : String(error) }])
}

export function saveMissionDraft(
  storage: MissionStorageLike,
  manifest: MissionScenarioManifest,
  now = Date.now()
): void {
  storage.setItem(MISSION_REHEARSAL_DRAFT_KEY, serializeMissionManifest(manifest, now))
}

export function loadMissionDraft(storage: MissionStorageLike): MissionStorageLoadResult<MissionScenarioManifest> {
  const raw = storage.getItem(MISSION_REHEARSAL_DRAFT_KEY)
  if (!raw) return { value: null, error: null }
  try {
    return { value: parseMissionManifestJson(raw), error: null }
  } catch (error) {
    return { value: null, error: asSchemaError(error, 'Saved mission rehearsal draft is corrupt.') }
  }
}

export function saveMissionResume(
  storage: MissionStorageLike,
  manifest: MissionScenarioManifest,
  run: MissionRun,
  now = Date.now()
): void {
  storage.setItem(missionResumeStorageKey(manifest.id), serializeMissionRun(manifest, run, now))
}

export function loadMissionResume(
  storage: MissionStorageLike,
  manifest: MissionScenarioManifest
): MissionStorageLoadResult<MissionRun> {
  const raw = storage.getItem(missionResumeStorageKey(manifest.id))
  if (!raw) return { value: null, error: null }
  try {
    return { value: parseMissionRunJson(raw, manifest), error: null }
  } catch (error) {
    return { value: null, error: asSchemaError(error, 'Saved mission rehearsal checkpoint is corrupt.') }
  }
}

export function clearMissionResume(storage: MissionStorageLike, manifestId: string): void {
  storage.removeItem(missionResumeStorageKey(manifestId))
}

export function loadMissionRunHistory(
  storage: MissionStorageLike,
  manifest: MissionScenarioManifest
): MissionStorageLoadResult<MissionRun[]> {
  const raw = storage.getItem(missionHistoryStorageKey(manifest.id))
  if (!raw) return { value: [], error: null }
  try {
    return { value: parseMissionRunHistoryJson(raw, manifest), error: null }
  } catch (error) {
    return { value: null, error: asSchemaError(error, 'Saved mission rehearsal history is corrupt.') }
  }
}

export function archiveMissionRun(
  storage: MissionStorageLike,
  manifest: MissionScenarioManifest,
  run: MissionRun,
  now = Date.now()
): MissionStorageLoadResult<MissionRun[]> {
  const loaded = loadMissionRunHistory(storage, manifest)
  if (loaded.error) return loaded
  const current = loaded.value ?? []
  const next = [...current.filter((entry) => entry.id !== run.id), run].slice(-50)
  try {
    storage.setItem(missionHistoryStorageKey(manifest.id), serializeMissionRunHistory(manifest, next, now))
    return { value: next, error: null }
  } catch (error) {
    return { value: null, error: asSchemaError(error, 'Mission rehearsal history could not be saved.') }
  }
}

export function resetMissionTrainingBoundary(
  storage: MissionStorageLike,
  manifestId: string,
  options: MissionResetOptions = {}
): string[] {
  const removed = [missionResumeStorageKey(manifestId)]
  if (options.includeHistory) removed.push(missionHistoryStorageKey(manifestId))
  if (options.includeDraft) removed.push(MISSION_REHEARSAL_DRAFT_KEY)
  removed.forEach((key) => storage.removeItem(key))
  return removed
}

export function resetAllMissionTrainingData(storage: MissionStorageLike): string[] {
  const keys = new Set<string>([MISSION_REHEARSAL_DRAFT_KEY])
  if (typeof storage.length === 'number' && storage.key) {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key && isMissionRehearsalStorageKey(key)) keys.add(key)
    }
  }
  const removed = [...keys]
  removed.forEach((key) => storage.removeItem(key))
  return removed
}
