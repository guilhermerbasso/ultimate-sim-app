import type { DashboardSummary } from './dashboards'
import type { StreamingLayoutKind } from './streaming'
import type { ButtonBoxSummary } from './touch-panel'

export const STREAM_TARGET_SETTINGS_SCHEMA_VERSION = 1 as const

export interface StreamTargetSource {
  kind: StreamingLayoutKind
  id: string
  label: string
}

export interface StreamTargetProfile {
  id: string
  kind: StreamingLayoutKind
  sourceId: string
  label: string
}

export interface StreamTargetSettings {
  schemaVersion: typeof STREAM_TARGET_SETTINGS_SCHEMA_VERSION
  profiles: StreamTargetProfile[]
  selectedProfileId: string | null
}

export interface StreamTargetSelection {
  kind: StreamingLayoutKind
  sourceId: string
}

export interface ResolvedStreamTargetProfile extends StreamTargetProfile {
  source: StreamTargetSource | null
  missing: boolean
}

export type StreamTargetProfileIdFactory = () => string

const MAX_PROFILE_ID_LENGTH = 128
const MAX_SOURCE_ID_LENGTH = 256
const MAX_LABEL_LENGTH = 96

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLength || /[\u0000-\u001f\u007f]/.test(trimmed)) return null
  return trimmed
}

function normalizeKind(value: unknown): StreamingLayoutKind | null {
  if (value === 'dashboard' || value === 'touch') return value
  return null
}

function normalizeProfile(value: unknown): StreamTargetProfile | null {
  const record = recordOf(value)
  if (!record) return null
  const id = cleanText(record.id, MAX_PROFILE_ID_LENGTH)
  const kind = normalizeKind(record.kind)
  const sourceId = cleanText(record.sourceId ?? record.targetId ?? record.layoutId, MAX_SOURCE_ID_LENGTH)
  const label = cleanText(record.label ?? record.name, MAX_LABEL_LENGTH)
  if (!id || !kind || !sourceId || !label) return null
  return { id, kind, sourceId, label }
}

export function emptyStreamTargetSettings(): StreamTargetSettings {
  return {
    schemaVersion: STREAM_TARGET_SETTINGS_SCHEMA_VERSION,
    profiles: [],
    selectedProfileId: null
  }
}

export function cloneStreamTargetSettings(settings: StreamTargetSettings): StreamTargetSettings {
  return {
    schemaVersion: STREAM_TARGET_SETTINGS_SCHEMA_VERSION,
    profiles: settings.profiles.map((profile) => ({ ...profile })),
    selectedProfileId: settings.selectedProfileId
  }
}

export function normalizeStreamTargetSettings(value: unknown): StreamTargetSettings {
  const record = recordOf(value)
  if (!record) return emptyStreamTargetSettings()
  const seen = new Set<string>()
  const profiles = Array.isArray(record.profiles)
    ? record.profiles
        .map(normalizeProfile)
        .filter((profile): profile is StreamTargetProfile => {
          if (!profile || seen.has(profile.id)) return false
          seen.add(profile.id)
          return true
        })
    : []
  const requestedSelection = cleanText(record.selectedProfileId, MAX_PROFILE_ID_LENGTH)
  const selectedProfileId = requestedSelection && seen.has(requestedSelection)
    ? requestedSelection
    : profiles[0]?.id ?? null
  return {
    schemaVersion: STREAM_TARGET_SETTINGS_SCHEMA_VERSION,
    profiles,
    selectedProfileId
  }
}

export function streamTargetSourceKey(source: Pick<StreamTargetSource, 'kind' | 'id'>): string {
  return `${source.kind}:${source.id}`
}

export function listUserAddedStreamTargetSources(
  dashboards: readonly DashboardSummary[],
  touchPanels: readonly ButtonBoxSummary[]
): StreamTargetSource[] {
  const sources: StreamTargetSource[] = []
  const seen = new Set<string>()
  const add = (source: StreamTargetSource): void => {
    const key = streamTargetSourceKey(source)
    if (seen.has(key)) return
    seen.add(key)
    sources.push(source)
  }

  for (const dashboard of dashboards) {
    const id = cleanText(dashboard.id, MAX_SOURCE_ID_LENGTH)
    if (dashboard.hidden || dashboard.builtIn || !id) continue
    add({ kind: 'dashboard', id, label: cleanText(dashboard.name, MAX_LABEL_LENGTH) ?? id })
  }
  for (const panel of touchPanels) {
    const id = cleanText(panel.id, MAX_SOURCE_ID_LENGTH)
    if (panel.hidden || !id) continue
    add({ kind: 'touch', id, label: cleanText(panel.name, MAX_LABEL_LENGTH) ?? id })
  }
  return sources
}

function selectionFromValue(value: unknown): StreamTargetSelection | null {
  if (typeof value === 'string') {
    const separator = value.indexOf(':')
    if (separator <= 0) return null
    const kind = normalizeKind(value.slice(0, separator))
    const sourceId = cleanText(value.slice(separator + 1), MAX_SOURCE_ID_LENGTH)
    return kind && sourceId ? { kind, sourceId } : null
  }
  const record = recordOf(value)
  if (!record) return null
  const kind = normalizeKind(record.kind ?? record.layoutKind)
  const sourceId = cleanText(record.sourceId ?? record.targetId ?? record.layoutId, MAX_SOURCE_ID_LENGTH)
  return kind && sourceId ? { kind, sourceId } : null
}

function legacySelectionFromSettings(value: unknown): StreamTargetSelection | null {
  const record = recordOf(value)
  if (!record) return selectionFromValue(value)
  return selectionFromValue(record.selectedTarget) ??
    selectionFromValue(record.target) ??
    selectionFromValue(record)
}

export function createStreamTargetProfileId(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return uuid ? `stream-target-${uuid}` : `stream-target-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function migrateStreamTargetSettings(
  value: unknown,
  sources: readonly StreamTargetSource[],
  legacySelection?: StreamTargetSelection | null,
  createId: StreamTargetProfileIdFactory = createStreamTargetProfileId
): StreamTargetSettings {
  const normalized = normalizeStreamTargetSettings(value)
  if (normalized.profiles.length > 0) return normalized
  const selection = legacySelection ?? legacySelectionFromSettings(value)
  if (!selection) return normalized
  const source = sources.find((candidate) =>
    candidate.kind === selection.kind && candidate.id === selection.sourceId
  )
  if (!source) return normalized
  return addStreamTargetProfile(normalized, source, source.label, createId)
}

export function addStreamTargetProfile(
  settings: StreamTargetSettings,
  source: StreamTargetSource,
  label: string = source.label,
  createId: StreamTargetProfileIdFactory = createStreamTargetProfileId
): StreamTargetSettings {
  const profileId = cleanText(createId(), MAX_PROFILE_ID_LENGTH)
  const sourceId = cleanText(source.id, MAX_SOURCE_ID_LENGTH)
  const profileLabel = cleanText(label, MAX_LABEL_LENGTH)
  if (!profileId || !sourceId || !profileLabel || !normalizeKind(source.kind)) {
    throw new Error('Invalid stream target profile.')
  }
  if (settings.profiles.some((profile) => profile.id === profileId)) {
    throw new Error(`Duplicate stream target profile id: ${profileId}`)
  }
  return {
    schemaVersion: STREAM_TARGET_SETTINGS_SCHEMA_VERSION,
    profiles: [...settings.profiles.map((profile) => ({ ...profile })), {
      id: profileId,
      kind: source.kind,
      sourceId,
      label: profileLabel
    }],
    selectedProfileId: profileId
  }
}

export function renameStreamTargetProfile(
  settings: StreamTargetSettings,
  profileId: string,
  label: string
): StreamTargetSettings {
  const profileLabel = cleanText(label, MAX_LABEL_LENGTH)
  if (!profileLabel) throw new Error('Stream target label is required.')
  return {
    schemaVersion: STREAM_TARGET_SETTINGS_SCHEMA_VERSION,
    profiles: settings.profiles.map((profile) =>
      profile.id === profileId ? { ...profile, label: profileLabel } : { ...profile }
    ),
    selectedProfileId: settings.selectedProfileId
  }
}

export function deleteStreamTargetProfile(
  settings: StreamTargetSettings,
  profileId: string
): StreamTargetSettings {
  const removedIndex = settings.profiles.findIndex((profile) => profile.id === profileId)
  if (removedIndex < 0) return cloneStreamTargetSettings(settings)
  const profiles = settings.profiles
    .filter((profile) => profile.id !== profileId)
    .map((profile) => ({ ...profile }))
  const selectedProfileId = settings.selectedProfileId === profileId
    ? profiles[Math.min(removedIndex, Math.max(0, profiles.length - 1))]?.id ?? null
    : settings.selectedProfileId
  return {
    schemaVersion: STREAM_TARGET_SETTINGS_SCHEMA_VERSION,
    profiles,
    selectedProfileId
  }
}

export function moveStreamTargetProfile(
  settings: StreamTargetSettings,
  profileId: string,
  direction: -1 | 1
): StreamTargetSettings {
  const profiles = settings.profiles.map((profile) => ({ ...profile }))
  const index = profiles.findIndex((profile) => profile.id === profileId)
  const nextIndex = index + direction
  if (index < 0 || nextIndex < 0 || nextIndex >= profiles.length) {
    return { ...cloneStreamTargetSettings(settings) }
  }
  const current = profiles[index]
  profiles[index] = profiles[nextIndex]
  profiles[nextIndex] = current
  return {
    schemaVersion: STREAM_TARGET_SETTINGS_SCHEMA_VERSION,
    profiles,
    selectedProfileId: settings.selectedProfileId
  }
}

export function selectStreamTargetProfile(
  settings: StreamTargetSettings,
  profileId: string
): StreamTargetSettings {
  if (!settings.profiles.some((profile) => profile.id === profileId)) {
    return cloneStreamTargetSettings(settings)
  }
  return {
    ...cloneStreamTargetSettings(settings),
    selectedProfileId: profileId
  }
}

export function resolveStreamTargetProfiles(
  settings: StreamTargetSettings,
  sources: readonly StreamTargetSource[]
): ResolvedStreamTargetProfile[] {
  const sourceByKey = new Map(sources.map((source) => [streamTargetSourceKey(source), source]))
  return settings.profiles.map((profile) => {
    const source = sourceByKey.get(streamTargetSourceKey({ kind: profile.kind, id: profile.sourceId })) ?? null
    return {
      ...profile,
      source: source ? { ...source } : null,
      missing: source === null
    }
  })
}

export function clearMissingStreamTargetProfiles(
  settings: StreamTargetSettings,
  sources: readonly StreamTargetSource[]
): StreamTargetSettings {
  const missingIds = new Set(
    resolveStreamTargetProfiles(settings, sources)
      .filter((profile) => profile.missing)
      .map((profile) => profile.id)
  )
  let next = cloneStreamTargetSettings(settings)
  for (const profileId of missingIds) next = deleteStreamTargetProfile(next, profileId)
  return next
}

export function streamTargetSettingsEqual(left: StreamTargetSettings, right: StreamTargetSettings): boolean {
  return left.selectedProfileId === right.selectedProfileId &&
    left.profiles.length === right.profiles.length &&
    left.profiles.every((profile, index) => {
      const other = right.profiles[index]
      return other !== undefined &&
        profile.id === other.id &&
        profile.kind === other.kind &&
        profile.sourceId === other.sourceId &&
        profile.label === other.label
    })
}
