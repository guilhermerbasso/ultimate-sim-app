import {
  MISSION_MAX_IMPORT_CHARS,
  MissionSchemaError,
  missionManifestChecksum,
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

function manifestIdentityKeyPart(manifest: MissionScenarioManifest): string {
  const checksum = missionManifestChecksum(manifest).replace(':', '-')
  return `${manifestKeyPart(manifest.id)}.r${manifest.revision}.${checksum}`
}

function legacyMissionResumeStorageKey(manifestId: string): string {
  return `${MISSION_REHEARSAL_STORAGE_PREFIX}active.${manifestKeyPart(manifestId)}`
}

function legacyMissionHistoryStorageKey(manifestId: string): string {
  return `${MISSION_REHEARSAL_STORAGE_PREFIX}run-history.${manifestKeyPart(manifestId)}`
}

export function missionResumeStorageKey(manifest: MissionScenarioManifest): string {
  return `${MISSION_REHEARSAL_STORAGE_PREFIX}active.${manifestIdentityKeyPart(manifest)}`
}

export function missionHistoryStorageKey(manifest: MissionScenarioManifest): string {
  return `${MISSION_REHEARSAL_STORAGE_PREFIX}run-history.${manifestIdentityKeyPart(manifest)}`
}

export function isMissionRehearsalStorageKey(key: string): boolean {
  return key.startsWith(MISSION_REHEARSAL_STORAGE_PREFIX)
}

function asSchemaError(error: unknown, label: string): MissionSchemaError {
  if (error instanceof MissionSchemaError) return error
  return new MissionSchemaError(label, [{ path: '$', message: error instanceof Error ? error.message : String(error) }])
}

function legacyPayloadTargetsManifest(
  raw: string,
  manifest: MissionScenarioManifest,
  kind: 'resume' | 'history'
): boolean {
  if (raw.length > MISSION_MAX_IMPORT_CHARS) return true
  try {
    const file = JSON.parse(raw) as Record<string, unknown>
    const identity = kind === 'resume' && file.run && typeof file.run === 'object'
      ? file.run as Record<string, unknown>
      : file
    if (
      typeof identity.manifestId !== 'string'
      || typeof identity.manifestRevision !== 'number'
      || typeof identity.manifestChecksum !== 'string'
    ) {
      return true
    }
    return identity.manifestId === manifest.id
      && identity.manifestRevision === manifest.revision
      && identity.manifestChecksum === missionManifestChecksum(manifest)
  } catch {
    return true
  }
}

function migrateLegacyValue<T>(
  storage: MissionStorageLike,
  currentKey: string,
  legacyKey: string,
  raw: string,
  value: T,
  label: string
): MissionStorageLoadResult<T> {
  try {
    storage.setItem(currentKey, raw)
    storage.removeItem(legacyKey)
    return { value, error: null }
  } catch (error) {
    return { value, error: asSchemaError(error, label) }
  }
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
  storage.setItem(missionResumeStorageKey(manifest), serializeMissionRun(manifest, run, now))
}

export function loadMissionResume(
  storage: MissionStorageLike,
  manifest: MissionScenarioManifest
): MissionStorageLoadResult<MissionRun> {
  const currentKey = missionResumeStorageKey(manifest)
  const raw = storage.getItem(currentKey)
  if (raw) {
    try {
      return { value: parseMissionRunJson(raw, manifest), error: null }
    } catch (error) {
      return { value: null, error: asSchemaError(error, 'Saved mission rehearsal checkpoint is corrupt.') }
    }
  }

  const legacyKey = legacyMissionResumeStorageKey(manifest.id)
  const legacyRaw = storage.getItem(legacyKey)
  if (!legacyRaw || !legacyPayloadTargetsManifest(legacyRaw, manifest, 'resume')) {
    return { value: null, error: null }
  }
  try {
    const value = parseMissionRunJson(legacyRaw, manifest)
    return migrateLegacyValue(
      storage,
      currentKey,
      legacyKey,
      legacyRaw,
      value,
      'Saved mission rehearsal checkpoint was loaded, but its legacy storage key could not be migrated.'
    )
  } catch (error) {
    return { value: null, error: asSchemaError(error, 'Saved mission rehearsal checkpoint is corrupt.') }
  }
}

export function clearMissionResume(storage: MissionStorageLike, manifest: MissionScenarioManifest): void {
  storage.removeItem(missionResumeStorageKey(manifest))
  const legacyKey = legacyMissionResumeStorageKey(manifest.id)
  const legacyRaw = storage.getItem(legacyKey)
  if (legacyRaw && legacyPayloadTargetsManifest(legacyRaw, manifest, 'resume')) {
    storage.removeItem(legacyKey)
  }
}

export function loadMissionRunHistory(
  storage: MissionStorageLike,
  manifest: MissionScenarioManifest
): MissionStorageLoadResult<MissionRun[]> {
  const currentKey = missionHistoryStorageKey(manifest)
  const raw = storage.getItem(currentKey)
  if (raw) {
    try {
      return { value: parseMissionRunHistoryJson(raw, manifest), error: null }
    } catch (error) {
      return { value: null, error: asSchemaError(error, 'Saved mission rehearsal history is corrupt.') }
    }
  }

  const legacyKey = legacyMissionHistoryStorageKey(manifest.id)
  const legacyRaw = storage.getItem(legacyKey)
  if (!legacyRaw || !legacyPayloadTargetsManifest(legacyRaw, manifest, 'history')) {
    return { value: [], error: null }
  }
  try {
    const value = parseMissionRunHistoryJson(legacyRaw, manifest)
    return migrateLegacyValue(
      storage,
      currentKey,
      legacyKey,
      legacyRaw,
      value,
      'Saved mission rehearsal history was loaded, but its legacy storage key could not be migrated.'
    )
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
    const serialized = serializeMissionRunHistory(manifest, next, now)
    storage.setItem(missionHistoryStorageKey(manifest), serialized)
    return { value: parseMissionRunHistoryJson(serialized, manifest), error: null }
  } catch (error) {
    return { value: null, error: asSchemaError(error, 'Mission rehearsal history could not be saved.') }
  }
}

export function finalizeMissionRun(
  storage: MissionStorageLike,
  manifest: MissionScenarioManifest,
  run: MissionRun,
  now = Date.now()
): MissionStorageLoadResult<MissionRun[]> {
  try {
    saveMissionResume(storage, manifest, run, now)
  } catch (error) {
    return { value: null, error: asSchemaError(error, 'Completed mission rehearsal could not be checkpointed.') }
  }

  const archived = archiveMissionRun(storage, manifest, run, now)
  if (archived.error) return archived
  try {
    clearMissionResume(storage, manifest)
    return archived
  } catch (error) {
    return {
      value: archived.value,
      error: asSchemaError(error, 'Completed mission rehearsal was archived, but its resume checkpoint could not be cleared.')
    }
  }
}

export function resetMissionTrainingBoundary(
  storage: MissionStorageLike,
  manifest: MissionScenarioManifest,
  options: MissionResetOptions = {}
): string[] {
  const removed = [missionResumeStorageKey(manifest)]
  const legacyResumeKey = legacyMissionResumeStorageKey(manifest.id)
  const legacyResume = storage.getItem(legacyResumeKey)
  if (legacyResume && legacyPayloadTargetsManifest(legacyResume, manifest, 'resume')) {
    removed.push(legacyResumeKey)
  }
  if (options.includeHistory) {
    removed.push(missionHistoryStorageKey(manifest))
    const legacyHistoryKey = legacyMissionHistoryStorageKey(manifest.id)
    const legacyHistory = storage.getItem(legacyHistoryKey)
    if (legacyHistory && legacyPayloadTargetsManifest(legacyHistory, manifest, 'history')) {
      removed.push(legacyHistoryKey)
    }
  }
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
