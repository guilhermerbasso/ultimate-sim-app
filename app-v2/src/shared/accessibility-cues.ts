import type {
  AlertEvent,
  AlertOutputButtonboxPreset,
  AlertSeverity,
  AlertType
} from './alerts'

export const ACCESSIBILITY_CUE_CHANNELS = {
  getState: 'accessibilityCues:getState',
  saveProfile: 'accessibilityCues:saveProfile',
  setActiveProfile: 'accessibilityCues:setActiveProfile',
  resetProfile: 'accessibilityCues:resetProfile',
  stateEvent: 'accessibilityCues:state',
  routedEvent: 'accessibilityCues:routed'
} as const

export const CUE_MODALITIES = ['caption', 'audio', 'symbol', 'led', 'haptic'] as const
export type CueModality = (typeof CUE_MODALITIES)[number]
export type CueSource = 'live' | 'replay' | 'preview'
export type CueSpatialPosition = 'left' | 'center' | 'right'
export type CueProfileKind = 'standard' | 'low-vision-blind' | 'deaf-hoh' | 'custom'
export type CueLedPattern =
  | 'steady'
  | 'single-pulse'
  | 'double-pulse'
  | 'triple-pulse'
  | 'fast-pulse'
export type CueHapticPattern = 'single' | 'double' | 'triple' | 'long'

export type CueEventId = `alert.${AlertType}`

export interface CueManifest {
  eventId: CueEventId
  alertType: AlertType
  title: string
  meaning: string
  severity: AlertSeverity
  preserveCritical: boolean
  defaultModalities: Record<CueModality, boolean>
  symbol: {
    token: string
    label: string
  }
  led: {
    pattern: CueLedPattern
    patternLabel: string
    color: 'blue' | 'amber' | 'red' | 'white' | 'green'
    preset: AlertOutputButtonboxPreset
    durationMs: number
    revLevel?: number
  }
  haptic: {
    pattern: CueHapticPattern
    patternLabel: string
    intensity: number
  }
}

const VISUAL_DEFAULTS: Record<CueModality, boolean> = {
  caption: true,
  audio: false,
  symbol: true,
  led: false,
  haptic: false
}

function manifest(
  alertType: AlertType,
  config: Omit<CueManifest, 'eventId' | 'alertType' | 'defaultModalities'> & {
    defaultModalities?: Partial<Record<CueModality, boolean>>
  }
): CueManifest {
  return {
    eventId: `alert.${alertType}`,
    alertType,
    ...config,
    defaultModalities: { ...VISUAL_DEFAULTS, ...config.defaultModalities }
  }
}

export const CUE_MANIFESTS: readonly CueManifest[] = [
  manifest('pitLimiter', {
    title: 'Pit limiter',
    meaning: 'Pit limiter state needs attention.',
    severity: 'info',
    preserveCritical: false,
    symbol: { token: 'PIT', label: 'Pit limiter symbol' },
    led: {
      pattern: 'steady',
      patternLabel: 'Steady lamp',
      color: 'green',
      preset: 'startLedFlash',
      durationMs: 900
    },
    haptic: { pattern: 'single', patternLabel: 'One short pulse', intensity: 0.45 }
  }),
  manifest('flag', {
    title: 'Race flag',
    meaning: 'A race-control flag changed.',
    severity: 'warning',
    preserveCritical: false,
    symbol: { token: 'FLAG', label: 'Race flag symbol' },
    led: {
      pattern: 'double-pulse',
      patternLabel: 'Two distinct pulses',
      color: 'amber',
      preset: 'revLightsPulse',
      durationMs: 1200,
      revLevel: 3
    },
    haptic: { pattern: 'double', patternLabel: 'Two short pulses', intensity: 0.65 }
  }),
  manifest('lowFuel', {
    title: 'Low fuel',
    meaning: 'Fuel margin is critically low.',
    severity: 'critical',
    preserveCritical: true,
    symbol: { token: 'FUEL', label: 'Low-fuel symbol' },
    led: {
      pattern: 'triple-pulse',
      patternLabel: 'Three urgent pulses',
      color: 'red',
      preset: 'revLightsPulse',
      durationMs: 1800,
      revLevel: 4
    },
    haptic: { pattern: 'triple', patternLabel: 'Three strong pulses', intensity: 0.9 },
    defaultModalities: { audio: true }
  }),
  manifest('shiftPoint', {
    title: 'Shift point',
    meaning: 'The configured shift point was reached.',
    severity: 'info',
    preserveCritical: false,
    symbol: { token: 'SHIFT', label: 'Shift-point symbol' },
    led: {
      pattern: 'fast-pulse',
      patternLabel: 'Fast repeated blink',
      color: 'blue',
      preset: 'shiftBlink',
      durationMs: 650
    },
    haptic: { pattern: 'single', patternLabel: 'One crisp pulse', intensity: 0.55 }
  }),
  manifest('incidentLimit', {
    title: 'Incident limit',
    meaning: 'The remaining incident allowance is low.',
    severity: 'warning',
    preserveCritical: false,
    symbol: { token: 'INC', label: 'Incident-limit symbol' },
    led: {
      pattern: 'double-pulse',
      patternLabel: 'Two distinct pulses',
      color: 'amber',
      preset: 'startLedFlash',
      durationMs: 1300
    },
    haptic: { pattern: 'double', patternLabel: 'Two medium pulses', intensity: 0.7 }
  }),
  manifest('tyrePressure', {
    title: 'Tyre pressure',
    meaning: 'A measured tyre pressure crossed the configured range.',
    severity: 'warning',
    preserveCritical: false,
    symbol: { token: 'PSI', label: 'Tyre-pressure symbol' },
    led: {
      pattern: 'double-pulse',
      patternLabel: 'Two distinct pulses',
      color: 'amber',
      preset: 'startLedFlash',
      durationMs: 1200
    },
    haptic: { pattern: 'double', patternLabel: 'Two corner-aware pulses', intensity: 0.65 }
  }),
  manifest('tyreTemp', {
    title: 'Tyre temperature',
    meaning: 'A measured tyre temperature crossed the configured limit.',
    severity: 'warning',
    preserveCritical: false,
    symbol: { token: 'TYRE', label: 'Tyre-temperature symbol' },
    led: {
      pattern: 'double-pulse',
      patternLabel: 'Two distinct pulses',
      color: 'amber',
      preset: 'startLedFlash',
      durationMs: 1200
    },
    haptic: { pattern: 'double', patternLabel: 'Two corner-aware pulses', intensity: 0.65 }
  }),
  manifest('brakeTemp', {
    title: 'Brake temperature',
    meaning: 'A measured brake temperature crossed the configured limit.',
    severity: 'warning',
    preserveCritical: false,
    symbol: { token: 'BRK', label: 'Brake-temperature symbol' },
    led: {
      pattern: 'double-pulse',
      patternLabel: 'Two distinct pulses',
      color: 'red',
      preset: 'startLedFlash',
      durationMs: 1400
    },
    haptic: { pattern: 'double', patternLabel: 'Two corner-aware pulses', intensity: 0.7 }
  }),
  manifest('drsAvailable', {
    title: 'DRS available',
    meaning: 'DRS became available.',
    severity: 'info',
    preserveCritical: false,
    symbol: { token: 'DRS', label: 'DRS-available symbol' },
    led: {
      pattern: 'single-pulse',
      patternLabel: 'One clear pulse',
      color: 'green',
      preset: 'startLedFlash',
      durationMs: 750
    },
    haptic: { pattern: 'single', patternLabel: 'One short pulse', intensity: 0.45 }
  }),
  manifest('blueFlag', {
    title: 'Blue flag',
    meaning: 'A blue-flag warning is active.',
    severity: 'warning',
    preserveCritical: false,
    symbol: { token: 'BLUE', label: 'Blue-flag text symbol' },
    led: {
      pattern: 'double-pulse',
      patternLabel: 'Two distinct pulses',
      color: 'blue',
      preset: 'revLightsPulse',
      durationMs: 1300,
      revLevel: 2
    },
    haptic: { pattern: 'double', patternLabel: 'Two medium pulses', intensity: 0.65 }
  })
] as const

const MANIFEST_BY_ID = new Map<CueEventId, CueManifest>(
  CUE_MANIFESTS.map((entry) => [entry.eventId, entry])
)

export interface CueOverride {
  modalities?: Partial<Record<CueModality, boolean>>
}

export interface CueProfile {
  version: 1
  id: string
  kind: CueProfileKind
  name: string
  modalities: Record<CueModality, boolean>
  textScale: number
  highContrast: boolean
  spatialAudio: boolean
  persistentCaptions: boolean
  captionDurationMs: number
  reducedMotion: boolean
  hapticIntensity: number
  overrides: Record<string, CueOverride>
  updatedAt: number
}

export interface AccessibilityCueStore {
  version: 1
  activeProfileId: string
  profiles: CueProfile[]
  updatedAt: number
}

export const STANDARD_CUE_PROFILE: CueProfile = {
  version: 1,
  id: 'standard',
  kind: 'standard',
  name: 'Standard multimodal',
  modalities: { ...VISUAL_DEFAULTS },
  textScale: 1,
  highContrast: false,
  spatialAudio: false,
  persistentCaptions: false,
  captionDurationMs: 5000,
  reducedMotion: false,
  hapticIntensity: 0.7,
  overrides: {},
  updatedAt: 0
}

export const LOW_VISION_BLIND_CUE_PROFILE: CueProfile = {
  version: 1,
  id: 'low-vision-blind',
  kind: 'low-vision-blind',
  name: 'Low vision / blind',
  modalities: {
    caption: true,
    audio: true,
    symbol: true,
    led: false,
    haptic: true
  },
  textScale: 1.45,
  highContrast: true,
  spatialAudio: true,
  persistentCaptions: false,
  captionDurationMs: 7000,
  reducedMotion: true,
  hapticIntensity: 0.85,
  overrides: {},
  updatedAt: 0
}

export const DEAF_HOH_CUE_PROFILE: CueProfile = {
  version: 1,
  id: 'deaf-hoh',
  kind: 'deaf-hoh',
  name: 'Deaf / hard of hearing',
  modalities: {
    caption: true,
    audio: false,
    symbol: true,
    led: true,
    haptic: true
  },
  textScale: 1.25,
  highContrast: true,
  spatialAudio: false,
  persistentCaptions: true,
  captionDurationMs: 10000,
  reducedMotion: true,
  hapticIntensity: 0.9,
  overrides: {},
  updatedAt: 0
}

export const BUILTIN_CUE_PROFILES: readonly CueProfile[] = [
  STANDARD_CUE_PROFILE,
  LOW_VISION_BLIND_CUE_PROFILE,
  DEAF_HOH_CUE_PROFILE
] as const

export const DEFAULT_ACCESSIBILITY_CUE_STORE: AccessibilityCueStore = {
  version: 1,
  activeProfileId: STANDARD_CUE_PROFILE.id,
  profiles: BUILTIN_CUE_PROFILES.map(cloneCueProfile),
  updatedAt: 0
}

export interface SemanticCueEvent {
  id: string
  message: string
  severity: AlertSeverity
  timestamp: number
  source: CueSource
  position: CueSpatialPosition
}

export interface CueCapabilities {
  caption: boolean
  audio: boolean
  symbol: boolean
  led: boolean
  haptic: boolean
}

export const DEFAULT_CUE_CAPABILITIES: CueCapabilities = {
  caption: true,
  audio: true,
  symbol: true,
  led: false,
  haptic: false
}

export type CueOutputDelivery = 'renderer' | 'hardware' | 'simulated'

export interface RoutedCueOutput {
  modality: CueModality
  semanticId: CueEventId
  message: string
  accessibleLabel: string
  delivery: CueOutputDelivery
  symbol?: string
  pattern?: CueLedPattern | CueHapticPattern
  patternLabel?: string
  color?: CueManifest['led']['color']
  oledText?: string
  spatialPan?: number
  intensity?: number
}

export type CueRouteIssueCode =
  | 'unknown-event'
  | 'unknown-source'
  | 'modality-unavailable'
  | 'replay-hardware-blocked'
  | 'preview-hardware-simulated'
  | 'critical-modality-preserved'
  | 'critical-redundancy-unavailable'

export interface CueRouteIssue {
  code: CueRouteIssueCode
  modality?: CueModality
  detail?: string
}

export type CueProfileConflictCode =
  | 'unknown-override-event'
  | 'critical-insufficient-redundancy'
  | 'critical-hardware-only'

export interface CueProfileConflict {
  code: CueProfileConflictCode
  severity: 'warning' | 'error'
  eventId: string
  message: string
}

export interface CuePresentation {
  profileId: string
  profileKind: CueProfileKind
  textScale: number
  highContrast: boolean
  persistentCaptions: boolean
  captionDurationMs: number
  reducedMotion: boolean
}

export interface CueRoute {
  status: 'routed' | 'degraded' | 'suppressed' | 'blocked'
  eventId: string
  source: CueSource | 'unknown'
  severity: AlertSeverity
  message: string
  outputs: RoutedCueOutput[]
  issues: CueRouteIssue[]
  conflicts: CueProfileConflict[]
  presentation: CuePresentation
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isCueSource(value: unknown): value is CueSource {
  return value === 'live' || value === 'replay' || value === 'preview'
}

function isCueProfileKind(value: unknown): value is CueProfileKind {
  return (
    value === 'standard' ||
    value === 'low-vision-blind' ||
    value === 'deaf-hoh' ||
    value === 'custom'
  )
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback
}

function normalizeTimestamp(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : fallback
}

function normalizeProfileId(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-').slice(0, 64)
  return normalized || fallback
}

function normalizeProfileName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().replace(/\s+/g, ' ').slice(0, 80)
  return normalized || fallback
}

function normalizeModalities(
  value: unknown,
  fallback: Record<CueModality, boolean>
): Record<CueModality, boolean> {
  const input = isRecord(value) ? value : {}
  return Object.fromEntries(
    CUE_MODALITIES.map((modality) => [
      modality,
      typeof input[modality] === 'boolean' ? input[modality] : fallback[modality]
    ])
  ) as Record<CueModality, boolean>
}

function normalizeOverride(value: unknown): CueOverride {
  if (!isRecord(value)) return {}
  if (!isRecord(value.modalities)) return {}
  const modalities: Partial<Record<CueModality, boolean>> = {}
  for (const modality of CUE_MODALITIES) {
    if (typeof value.modalities[modality] === 'boolean') {
      modalities[modality] = value.modalities[modality]
    }
  }
  return Object.keys(modalities).length > 0 ? { modalities } : {}
}

function normalizeOverrides(value: unknown): Record<string, CueOverride> {
  if (!isRecord(value)) return {}
  const overrides: Record<string, CueOverride> = {}
  for (const [eventId, override] of Object.entries(value)) {
    if (!eventId || eventId.length > 100) continue
    overrides[eventId] = normalizeOverride(override)
  }
  return overrides
}

export function cloneCueProfile(profile: CueProfile): CueProfile {
  return {
    ...profile,
    modalities: { ...profile.modalities },
    overrides: Object.fromEntries(
      Object.entries(profile.overrides).map(([eventId, override]) => [
        eventId,
        {
          ...override,
          modalities: override.modalities ? { ...override.modalities } : undefined
        }
      ])
    )
  }
}

export function cloneAccessibilityCueStore(store: AccessibilityCueStore): AccessibilityCueStore {
  return {
    ...store,
    profiles: store.profiles.map(cloneCueProfile)
  }
}

export function normalizeCueProfile(
  value: unknown,
  fallback: CueProfile = STANDARD_CUE_PROFILE
): CueProfile {
  const input = isRecord(value) ? value : {}
  const id = normalizeProfileId(input.id, fallback.id)
  return {
    version: 1,
    id,
    kind: isCueProfileKind(input.kind) ? input.kind : fallback.kind,
    name: normalizeProfileName(input.name, fallback.name),
    modalities: normalizeModalities(input.modalities, fallback.modalities),
    textScale: clamp(input.textScale, 0.8, 2, fallback.textScale),
    highContrast:
      typeof input.highContrast === 'boolean' ? input.highContrast : fallback.highContrast,
    spatialAudio:
      typeof input.spatialAudio === 'boolean' ? input.spatialAudio : fallback.spatialAudio,
    persistentCaptions:
      typeof input.persistentCaptions === 'boolean'
        ? input.persistentCaptions
        : fallback.persistentCaptions,
    captionDurationMs: Math.round(
      clamp(input.captionDurationMs, 2000, 30000, fallback.captionDurationMs)
    ),
    reducedMotion:
      typeof input.reducedMotion === 'boolean' ? input.reducedMotion : fallback.reducedMotion,
    hapticIntensity: clamp(input.hapticIntensity, 0, 1, fallback.hapticIntensity),
    overrides: normalizeOverrides(input.overrides),
    updatedAt: normalizeTimestamp(input.updatedAt, fallback.updatedAt)
  }
}

export function normalizeAccessibilityCueStore(value: unknown): AccessibilityCueStore {
  const input = isRecord(value) ? value : {}
  const rawProfiles = Array.isArray(input.profiles) ? input.profiles : []
  const profiles: CueProfile[] = []
  const usedIds = new Set<string>()

  for (const builtin of BUILTIN_CUE_PROFILES) {
    const persisted = rawProfiles.find(
      (candidate) => isRecord(candidate) && candidate.id === builtin.id
    )
    profiles.push(normalizeCueProfile(persisted, builtin))
    usedIds.add(builtin.id)
  }

  for (const rawProfile of rawProfiles) {
    if (!isRecord(rawProfile)) continue
    const rawId = normalizeProfileId(rawProfile.id, '')
    if (!rawId || usedIds.has(rawId)) continue
    const customFallback: CueProfile = {
      ...STANDARD_CUE_PROFILE,
      id: rawId,
      kind: 'custom',
      name: rawId
    }
    const normalized = normalizeCueProfile(rawProfile, customFallback)
    profiles.push({ ...normalized, kind: 'custom' })
    usedIds.add(normalized.id)
  }

  const requestedActive =
    typeof input.activeProfileId === 'string' ? input.activeProfileId : STANDARD_CUE_PROFILE.id
  const activeProfileId = usedIds.has(requestedActive)
    ? requestedActive
    : STANDARD_CUE_PROFILE.id

  return {
    version: 1,
    activeProfileId,
    profiles,
    updatedAt: normalizeTimestamp(input.updatedAt)
  }
}

export function parseAccessibilityCueStore(text: string): AccessibilityCueStore {
  try {
    return normalizeAccessibilityCueStore(JSON.parse(text) as unknown)
  } catch {
    return cloneAccessibilityCueStore(DEFAULT_ACCESSIBILITY_CUE_STORE)
  }
}

export function serializeAccessibilityCueStore(store: AccessibilityCueStore): string {
  return `${JSON.stringify(normalizeAccessibilityCueStore(store), null, 2)}\n`
}

export function getActiveCueProfile(store: AccessibilityCueStore): CueProfile {
  return (
    store.profiles.find((profile) => profile.id === store.activeProfileId) ??
    store.profiles.find((profile) => profile.id === STANDARD_CUE_PROFILE.id) ??
    cloneCueProfile(STANDARD_CUE_PROFILE)
  )
}

export function upsertCueProfile(
  store: AccessibilityCueStore,
  value: unknown,
  now = Date.now()
): AccessibilityCueStore {
  const input = isRecord(value) ? value : {}
  const requestedId = normalizeProfileId(input.id, STANDARD_CUE_PROFILE.id)
  const existing = store.profiles.find((profile) => profile.id === requestedId)
  const builtin = BUILTIN_CUE_PROFILES.find((profile) => profile.id === requestedId)
  const fallback =
    existing ??
    builtin ?? {
      ...STANDARD_CUE_PROFILE,
      id: requestedId,
      kind: 'custom' as const,
      name: requestedId
    }
  const profile = normalizeCueProfile(input, fallback)
  const nextProfile = {
    ...profile,
    kind: builtin ? builtin.kind : profile.kind === 'custom' ? 'custom' : profile.kind,
    updatedAt: normalizeTimestamp(now)
  }
  const profiles = store.profiles.some((candidate) => candidate.id === nextProfile.id)
    ? store.profiles.map((candidate) =>
        candidate.id === nextProfile.id ? nextProfile : cloneCueProfile(candidate)
      )
    : [...store.profiles.map(cloneCueProfile), nextProfile]

  return normalizeAccessibilityCueStore({
    ...store,
    profiles,
    updatedAt: normalizeTimestamp(now)
  })
}

export function activateCueProfile(
  store: AccessibilityCueStore,
  profileId: unknown,
  now = Date.now()
): AccessibilityCueStore {
  const requested = typeof profileId === 'string' ? profileId : ''
  if (!store.profiles.some((profile) => profile.id === requested)) {
    return cloneAccessibilityCueStore(store)
  }
  return normalizeAccessibilityCueStore({
    ...store,
    activeProfileId: requested,
    updatedAt: normalizeTimestamp(now)
  })
}

export function resetCueProfile(
  store: AccessibilityCueStore,
  profileId: unknown,
  now = Date.now()
): AccessibilityCueStore {
  if (typeof profileId !== 'string') return cloneAccessibilityCueStore(store)
  const builtin = BUILTIN_CUE_PROFILES.find((profile) => profile.id === profileId)
  if (!builtin) return cloneAccessibilityCueStore(store)
  return upsertCueProfile(store, { ...builtin, updatedAt: now }, now)
}

export function alertCueEventId(type: AlertType): CueEventId {
  return `alert.${type}`
}

export function getCueManifest(eventId: string): CueManifest | undefined {
  return MANIFEST_BY_ID.get(eventId as CueEventId)
}

export function semanticCueEventFromAlert(
  event: AlertEvent,
  source: CueSource = 'live'
): SemanticCueEvent {
  const corner = event.context?.corner
  const position: CueSpatialPosition =
    corner === 'lf' || corner === 'lr'
      ? 'left'
      : corner === 'rf' || corner === 'rr'
        ? 'right'
        : 'center'
  return {
    id: alertCueEventId(event.type),
    message: event.message,
    severity: event.severity,
    timestamp: event.timestamp,
    source,
    position
  }
}

export function effectiveCueModalities(
  profile: CueProfile,
  eventId: string
): Record<CueModality, boolean> {
  const override = profile.overrides[eventId]?.modalities
  return Object.fromEntries(
    CUE_MODALITIES.map((modality) => [
      modality,
      typeof override?.[modality] === 'boolean'
        ? override[modality]
        : profile.modalities[modality]
    ])
  ) as Record<CueModality, boolean>
}

export function analyzeCueProfile(profileValue: unknown): CueProfileConflict[] {
  const profile = normalizeCueProfile(profileValue)
  const conflicts: CueProfileConflict[] = []
  for (const eventId of Object.keys(profile.overrides)) {
    if (!getCueManifest(eventId)) {
      conflicts.push({
        code: 'unknown-override-event',
        severity: 'error',
        eventId,
        message: `Unknown cue override "${eventId}" is retained for review but never routed.`
      })
    }
  }

  for (const cue of CUE_MANIFESTS) {
    if (!cue.preserveCritical) continue
    const enabled = CUE_MODALITIES.filter(
      (modality) => effectiveCueModalities(profile, cue.eventId)[modality]
    )
    if (enabled.length < 2) {
      conflicts.push({
        code: 'critical-insufficient-redundancy',
        severity: 'error',
        eventId: cue.eventId,
        message: `${cue.title} needs at least two modalities; safe fallbacks will be restored at route time.`
      })
    }
    if (
      enabled.length > 0 &&
      enabled.every((modality) => modality === 'led' || modality === 'haptic')
    ) {
      conflicts.push({
        code: 'critical-hardware-only',
        severity: 'error',
        eventId: cue.eventId,
        message: `${cue.title} cannot depend only on optional hardware.`
      })
    }
  }
  return conflicts
}

function fallbackOrder(profile: CueProfile): readonly CueModality[] {
  if (profile.kind === 'low-vision-blind') {
    return ['audio', 'haptic', 'caption', 'symbol', 'led']
  }
  if (profile.kind === 'deaf-hoh') {
    return ['caption', 'symbol', 'haptic', 'led', 'audio']
  }
  return ['caption', 'symbol', 'audio', 'haptic', 'led']
}

function routeDelivery(source: CueSource, modality: CueModality): CueOutputDelivery | null {
  const physical = modality === 'led' || modality === 'haptic'
  if (!physical) return 'renderer'
  if (source === 'preview') return 'simulated'
  if (source === 'replay') return null
  return 'hardware'
}

function spatialPan(position: CueSpatialPosition): number {
  if (position === 'left') return -0.75
  if (position === 'right') return 0.75
  return 0
}

function buildOutput(
  manifestEntry: CueManifest,
  event: SemanticCueEvent,
  profile: CueProfile,
  modality: CueModality,
  delivery: CueOutputDelivery
): RoutedCueOutput {
  const base: RoutedCueOutput = {
    modality,
    semanticId: manifestEntry.eventId,
    message: event.message,
    accessibleLabel: `${manifestEntry.title}: ${event.message}`,
    delivery
  }
  switch (modality) {
    case 'caption':
      return base
    case 'audio':
      return {
        ...base,
        spatialPan: profile.spatialAudio ? spatialPan(event.position) : undefined
      }
    case 'symbol':
      return { ...base, symbol: manifestEntry.symbol.token }
    case 'led':
      return {
        ...base,
        pattern: manifestEntry.led.pattern,
        patternLabel: manifestEntry.led.patternLabel,
        color: manifestEntry.led.color,
        oledText: event.message
      }
    case 'haptic':
      return {
        ...base,
        pattern: manifestEntry.haptic.pattern,
        patternLabel: manifestEntry.haptic.patternLabel,
        intensity: clamp(
          manifestEntry.haptic.intensity * profile.hapticIntensity,
          0,
          1,
          manifestEntry.haptic.intensity
        )
      }
  }
}

function blockedRoute(
  event: SemanticCueEvent,
  profile: CueProfile,
  issue: CueRouteIssue
): CueRoute {
  return {
    status: 'blocked',
    eventId: event.id,
    source: isCueSource(event.source) ? event.source : 'unknown',
    severity: event.severity,
    message: event.message,
    outputs: [],
    issues: [issue],
    conflicts: analyzeCueProfile(profile),
    presentation: presentationFor(profile)
  }
}

function presentationFor(profile: CueProfile): CuePresentation {
  return {
    profileId: profile.id,
    profileKind: profile.kind,
    textScale: profile.textScale,
    highContrast: profile.highContrast,
    persistentCaptions: profile.persistentCaptions,
    captionDurationMs: profile.captionDurationMs,
    reducedMotion: profile.reducedMotion
  }
}

export function routeSemanticCue(
  eventValue: SemanticCueEvent,
  profileValue: unknown,
  capabilitiesValue: Partial<CueCapabilities> = DEFAULT_CUE_CAPABILITIES
): CueRoute {
  const profile = normalizeCueProfile(profileValue)
  const event = eventValue
  if (!isCueSource(event.source)) {
    return blockedRoute(event, profile, {
      code: 'unknown-source',
      detail: String(event.source)
    })
  }
  const manifestEntry = getCueManifest(event.id)
  if (!manifestEntry) {
    return blockedRoute(event, profile, {
      code: 'unknown-event',
      detail: event.id
    })
  }

  const capabilities: CueCapabilities = {
    ...DEFAULT_CUE_CAPABILITIES,
    ...capabilitiesValue
  }
  const enabled = effectiveCueModalities(profile, event.id)
  const outputs: RoutedCueOutput[] = []
  const issues: CueRouteIssue[] = []
  const conflicts = analyzeCueProfile(profile)

  const tryAdd = (modality: CueModality, preserveCritical = false): boolean => {
    if (outputs.some((output) => output.modality === modality)) return true
    const delivery = routeDelivery(event.source, modality)
    if (!delivery) {
      issues.push({ code: 'replay-hardware-blocked', modality })
      return false
    }
    if (event.source !== 'preview' && !capabilities[modality]) {
      issues.push({ code: 'modality-unavailable', modality })
      return false
    }
    if (delivery === 'simulated') {
      issues.push({ code: 'preview-hardware-simulated', modality })
    }
    outputs.push(buildOutput(manifestEntry, event, profile, modality, delivery))
    if (preserveCritical) {
      issues.push({ code: 'critical-modality-preserved', modality })
    }
    return true
  }

  for (const modality of CUE_MODALITIES) {
    if (enabled[modality]) tryAdd(modality)
  }

  const critical = event.severity === 'critical' || manifestEntry.preserveCritical
  if (critical) {
    for (const modality of fallbackOrder(profile)) {
      if (outputs.length >= 2) break
      tryAdd(modality, true)
    }
    if (outputs.length < 2) {
      issues.push({
        code: 'critical-redundancy-unavailable',
        detail: `${outputs.length}/2 modalities available`
      })
    }
  }

  const status: CueRoute['status'] =
    outputs.length === 0
      ? 'suppressed'
      : issues.length > 0 || conflicts.some((conflict) => conflict.severity === 'error')
        ? 'degraded'
        : 'routed'

  return {
    status,
    eventId: manifestEntry.eventId,
    source: event.source,
    severity: event.severity,
    message: event.message,
    outputs,
    issues,
    conflicts,
    presentation: presentationFor(profile)
  }
}

export function hardwareOutputsForCueRoute(route: CueRoute): RoutedCueOutput[] {
  if (route.source !== 'live') return []
  return route.outputs.filter(
    (output) =>
      output.delivery === 'hardware' &&
      (output.modality === 'led' || output.modality === 'haptic')
  )
}

export function cueRouteHasModality(route: CueRoute, modality: CueModality): boolean {
  return route.outputs.some((output) => output.modality === modality)
}
