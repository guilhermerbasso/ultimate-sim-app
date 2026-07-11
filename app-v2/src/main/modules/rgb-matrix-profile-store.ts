import type { DeviceProfile, RgbMatrixComponent } from '../../shared/devices'
import {
  RGB_MATRIX_PROFILE_VERSION,
  normalizeMatrixLayout,
  normalizeRgbMatrixEffects,
  type RgbMatrixProfile
} from '../../shared/rgb-matrix'

export interface RgbMatrixProfileBinding {
  profileLabel?: string
  componentLabel?: string
}

export interface RgbMatrixProfilesPayload {
  version: number
  profiles: Record<string, RgbMatrixProfile>
  bindings?: Record<string, RgbMatrixProfileBinding>
  updatedAt: string
}

export interface ParsedRgbMatrixProfilesPayload {
  payload: RgbMatrixProfilesPayload
  profileCount: number
  migrated: boolean
}

export interface RgbMatrixTarget {
  key: string
  profileLabel: string
  componentLabel: string
}

export interface BoundRgbMatrixProfiles {
  profiles: Record<string, RgbMatrixProfile>
  sourceKeyByTarget: Record<string, string>
  sourceProfileCount: number
  appliedTargetCount: number
  unmatchedSourceKeys: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function profileFileError(message: string): Error {
  return new Error(`Invalid iFlag profile file: ${message}`)
}

function normalizeLabel(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

function parseProfile(input: unknown, key: string): RgbMatrixProfile {
  if (!isRecord(input)) {
    throw profileFileError(`profile "${key}" is not an object.`)
  }
  if (
    typeof input.version === 'number' &&
    Number.isFinite(input.version) &&
    input.version > RGB_MATRIX_PROFILE_VERSION
  ) {
    throw profileFileError(
      `profile "${key}" uses version ${input.version}, but this app supports up to version ${RGB_MATRIX_PROFILE_VERSION}.`
    )
  }
  const hasLayout = 'layout' in input
  const hasEffects = 'effects' in input
  if (!hasLayout && !hasEffects) {
    throw profileFileError(`profile "${key}" has neither a matrix layout nor an effect stack.`)
  }
  if (hasLayout && !isRecord(input.layout)) {
    throw profileFileError(`profile "${key}" has an invalid matrix layout.`)
  }
  if (hasEffects && !Array.isArray(input.effects)) {
    throw profileFileError(`profile "${key}" has an invalid effect stack.`)
  }
  return {
    version: RGB_MATRIX_PROFILE_VERSION,
    layout: normalizeMatrixLayout(input.layout),
    effects: normalizeRgbMatrixEffects(input.effects)
  }
}

function parseBindings(input: unknown, keys: ReadonlySet<string>): Record<string, RgbMatrixProfileBinding> | undefined {
  if (!isRecord(input)) return undefined
  const bindings: Record<string, RgbMatrixProfileBinding> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!keys.has(key) || !isRecord(value)) continue
    const profileLabel = typeof value.profileLabel === 'string' ? value.profileLabel : undefined
    const componentLabel = typeof value.componentLabel === 'string' ? value.componentLabel : undefined
    if (profileLabel || componentLabel) bindings[key] = { profileLabel, componentLabel }
  }
  return Object.keys(bindings).length > 0 ? bindings : undefined
}

export function parseRgbMatrixProfilesPayload(input: unknown): ParsedRgbMatrixProfilesPayload {
  if (input === null || input === undefined) {
    throw new Error('No iFlag profiles were found. Save at least one RGB matrix profile before exporting or importing.')
  }
  if (!isRecord(input)) {
    throw profileFileError('expected a JSON object.')
  }

  let rawProfiles: unknown
  let rawBindings: unknown
  let updatedAt: string | undefined
  let declaredVersion: number | undefined
  let migrated = false

  if ('profiles' in input) {
    rawProfiles = input.profiles
    rawBindings = input.bindings
    updatedAt = typeof input.updatedAt === 'string' ? input.updatedAt : undefined
    declaredVersion = typeof input.version === 'number' && Number.isFinite(input.version) ? input.version : undefined
    if (declaredVersion !== undefined && declaredVersion > RGB_MATRIX_PROFILE_VERSION) {
      throw profileFileError(
        `file version ${declaredVersion} is newer than the supported version ${RGB_MATRIX_PROFILE_VERSION}. Update the app and try again.`
      )
    }
    migrated = declaredVersion !== RGB_MATRIX_PROFILE_VERSION || updatedAt === undefined
  } else if ('layout' in input || 'effects' in input) {
    // Old single-profile exports are still useful: bind the one profile to the
    // destination machine's matrix target during load.
    rawProfiles = [input]
    migrated = true
  } else {
    // Legacy raw key -> profile maps (without the payload wrapper).
    rawProfiles = input
    migrated = true
  }

  let entries: Array<[string, unknown]>
  if (Array.isArray(rawProfiles)) {
    entries = rawProfiles.map((profile, index) => [`legacy-${index + 1}`, profile])
    migrated = true
  } else if (isRecord(rawProfiles)) {
    entries = Object.entries(rawProfiles)
  } else {
    throw profileFileError('the "profiles" field must be an object or a legacy array.')
  }

  if (entries.length === 0) {
    throw new Error('No iFlag profiles were found in this file.')
  }

  const profiles: Record<string, RgbMatrixProfile> = {}
  for (const [key, value] of entries) {
    if (!key.trim()) throw profileFileError('a profile key is empty.')
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw profileFileError(`profile key "${key}" is reserved.`)
    }
    profiles[key] = parseProfile(value, key)
  }
  const bindings = parseBindings(rawBindings, new Set(Object.keys(profiles)))
  const payload: RgbMatrixProfilesPayload = {
    version: RGB_MATRIX_PROFILE_VERSION,
    profiles,
    updatedAt: updatedAt ?? new Date().toISOString()
  }
  if (bindings) payload.bindings = bindings
  return { payload, profileCount: entries.length, migrated }
}

export function rgbMatrixTargetsFromDeviceProfiles(profiles: readonly DeviceProfile[]): RgbMatrixTarget[] {
  const targets: RgbMatrixTarget[] = []
  for (const profile of profiles) {
    for (const component of profile.components) {
      if (component.type !== 'rgbMatrix') continue
      const matrix = component as RgbMatrixComponent
      targets.push({
        key: `${profile.id}:${matrix.id}`,
        profileLabel: profile.label,
        componentLabel: matrix.label
      })
    }
  }
  return targets
}

export function bindRgbMatrixProfilesToTargets(
  payload: RgbMatrixProfilesPayload,
  targets: readonly RgbMatrixTarget[]
): BoundRgbMatrixProfiles {
  const active: Record<string, RgbMatrixProfile> = {}
  const sourceKeyByTarget: Record<string, string> = {}
  const sourceEntries = Object.entries(payload.profiles)
  const unmatchedSources = new Map(sourceEntries)
  const unmatchedTargets = new Map(targets.map((target) => [target.key, target]))
  const matchedSources = new Set<string>()

  const bind = (sourceKey: string, target: RgbMatrixTarget): void => {
    const profile = payload.profiles[sourceKey]
    if (!profile) return
    active[target.key] = profile
    sourceKeyByTarget[target.key] = sourceKey
    matchedSources.add(sourceKey)
    unmatchedSources.delete(sourceKey)
    unmatchedTargets.delete(target.key)
  }

  // Same machine or a full bundle that also restored the sender's device store.
  for (const target of targets) {
    if (payload.profiles[target.key]) bind(target.key, target)
  }

  // New files carry human labels so multiple iFlags can be paired across machines
  // without depending on timestamp-generated device/component IDs.
  for (const [sourceKey] of [...unmatchedSources]) {
    const binding = payload.bindings?.[sourceKey]
    if (!binding) continue
    const profileLabel = normalizeLabel(binding.profileLabel)
    const componentLabel = normalizeLabel(binding.componentLabel)
    const candidates = [...unmatchedTargets.values()].filter((target) => {
      if (componentLabel && normalizeLabel(target.componentLabel) !== componentLabel) return false
      if (profileLabel && normalizeLabel(target.profileLabel) !== profileLabel) return false
      return Boolean(profileLabel || componentLabel)
    })
    if (candidates.length === 1) bind(sourceKey, candidates[0])
  }

  const remainingSources = [...unmatchedSources.keys()]
  const remainingTargets = [...unmatchedTargets.values()]
  if (remainingSources.length === 1 && remainingTargets.length > 0) {
    // The common share-with-a-friend case: one saved iFlag profile should work on
    // the brother's differently-IDed panel (and can safely clone to multiple panels).
    for (const target of remainingTargets) {
      const sourceKey = remainingSources[0]
      active[target.key] = payload.profiles[sourceKey]
      sourceKeyByTarget[target.key] = sourceKey
      matchedSources.add(sourceKey)
      unmatchedTargets.delete(target.key)
    }
    unmatchedSources.delete(remainingSources[0])
  } else if (remainingSources.length > 0 && remainingSources.length === remainingTargets.length) {
    // Backward compatibility for old multi-profile files without labels. Preserve
    // JSON insertion order and the local device/component order deterministically.
    remainingSources.forEach((sourceKey, index) => bind(sourceKey, remainingTargets[index]))
  }

  return {
    profiles: active,
    sourceKeyByTarget,
    sourceProfileCount: sourceEntries.length,
    appliedTargetCount: Object.keys(active).length,
    unmatchedSourceKeys: sourceEntries.map(([key]) => key).filter((key) => !matchedSources.has(key))
  }
}

export function addCurrentRgbMatrixBindings(
  payload: RgbMatrixProfilesPayload,
  targets: readonly RgbMatrixTarget[]
): void {
  const next = { ...(payload.bindings ?? {}) }
  for (const target of targets) {
    if (!payload.profiles[target.key]) continue
    next[target.key] = {
      profileLabel: target.profileLabel,
      componentLabel: target.componentLabel
    }
  }
  if (Object.keys(next).length > 0) payload.bindings = next
}
