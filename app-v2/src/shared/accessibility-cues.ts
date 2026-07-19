import type {
  AlertEvent,
  AlertEventContext,
  AlertSeverity,
  AlertType
} from './alerts'

export const ACCESSIBILITY_CUE_PROTOCOL_VERSION = 1 as const
export const ACCESSIBILITY_CUE_STORE_VERSION = 2 as const

export const ACCESSIBILITY_CUE_CHANNELS = {
  getState: 'accessibilityCues:getState',
  saveProfile: 'accessibilityCues:saveProfile',
  setActiveProfile: 'accessibilityCues:setActiveProfile',
  resetProfile: 'accessibilityCues:resetProfile',
  setAudioAvailability: 'accessibilityCues:setAudioAvailability',
  stateEvent: 'accessibilityCues:state',
  routedEvent: 'accessibilityCues:routed'
} as const

export const CUE_MODALITIES = ['caption', 'audio', 'symbol', 'led', 'haptic'] as const
export type CueModality = (typeof CUE_MODALITIES)[number]
export type CueModalityPolicy = 'inherit' | 'on' | 'off'
export type CueSensoryChannel = 'visual' | 'auditory' | 'tactile'
export type CueSource = 'live' | 'replay' | 'preview'
export type CueSpatialPosition = 'left' | 'center' | 'right'
export type CueProfileKind = 'standard' | 'low-vision-blind' | 'deaf-hoh' | 'custom'
export type CueLedPattern = 'steady'
export type CueHapticPattern = 'single' | 'double' | 'triple' | 'long'
export type CueEventId = `alert.${AlertType}`

export const CUE_MODALITY_CHANNEL: Readonly<Record<CueModality, CueSensoryChannel>> = {
  caption: 'visual',
  symbol: 'visual',
  led: 'visual',
  audio: 'auditory',
  haptic: 'tactile'
}

export interface CueManifest {
  eventId: CueEventId
  alertType: AlertType
  labelKey: string
  meaningKey: string
  severity: AlertSeverity
  preserveCritical: boolean
  defaultModalities: Record<CueModality, boolean>
  symbol: {
    token: string
    labelKey: string
  }
  led: {
    // SIM-X currently guarantees a steady start lamp plus transient OLED text.
    // Do not teach unsupported color/pulse sequences.
    pattern: 'steady'
    patternLabelKey: string
    color: 'device-default'
    durationMs: number
  }
  haptic: {
    pattern: CueHapticPattern
    patternLabelKey: string
    intensity: number
  }
}

const BASE_MANIFEST_MODALITIES: Record<CueModality, boolean> = {
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
    defaultModalities: {
      ...BASE_MANIFEST_MODALITIES,
      ...config.defaultModalities
    }
  }
}

function safeLed(durationMs: number): CueManifest['led'] {
  return {
    pattern: 'steady',
    patternLabelKey: 'accessibilityCues.pattern.led.steadyActual',
    color: 'device-default',
    durationMs
  }
}

export const CUE_MANIFESTS: readonly CueManifest[] = [
  manifest('pitLimiter', {
    labelKey: 'accessibilityCues.event.alert.pitLimiter',
    meaningKey: 'accessibilityCues.meaning.alert.pitLimiter',
    severity: 'info',
    preserveCritical: false,
    symbol: {
      token: 'PIT',
      labelKey: 'accessibilityCues.symbol.alert.pitLimiter'
    },
    led: safeLed(1000),
    haptic: {
      pattern: 'single',
      patternLabelKey: 'accessibilityCues.pattern.haptic.single',
      intensity: 0.45
    }
  }),
  manifest('flag', {
    labelKey: 'accessibilityCues.event.alert.flag',
    meaningKey: 'accessibilityCues.meaning.alert.flag',
    severity: 'warning',
    preserveCritical: false,
    symbol: {
      token: 'FLAG',
      labelKey: 'accessibilityCues.symbol.alert.flag'
    },
    led: safeLed(1400),
    haptic: {
      pattern: 'double',
      patternLabelKey: 'accessibilityCues.pattern.haptic.double',
      intensity: 0.65
    }
  }),
  manifest('lowFuel', {
    labelKey: 'accessibilityCues.event.alert.lowFuel',
    meaningKey: 'accessibilityCues.meaning.alert.lowFuel',
    severity: 'critical',
    preserveCritical: true,
    symbol: {
      token: 'FUEL',
      labelKey: 'accessibilityCues.symbol.alert.lowFuel'
    },
    led: safeLed(2200),
    haptic: {
      pattern: 'triple',
      patternLabelKey: 'accessibilityCues.pattern.haptic.triple',
      intensity: 0.9
    },
    defaultModalities: { audio: true, haptic: true }
  }),
  manifest('shiftPoint', {
    labelKey: 'accessibilityCues.event.alert.shiftPoint',
    meaningKey: 'accessibilityCues.meaning.alert.shiftPoint',
    severity: 'info',
    preserveCritical: false,
    symbol: {
      token: 'SHIFT',
      labelKey: 'accessibilityCues.symbol.alert.shiftPoint'
    },
    led: safeLed(700),
    haptic: {
      pattern: 'single',
      patternLabelKey: 'accessibilityCues.pattern.haptic.single',
      intensity: 0.55
    }
  }),
  manifest('incidentLimit', {
    labelKey: 'accessibilityCues.event.alert.incidentLimit',
    meaningKey: 'accessibilityCues.meaning.alert.incidentLimit',
    severity: 'warning',
    preserveCritical: false,
    symbol: {
      token: 'INC',
      labelKey: 'accessibilityCues.symbol.alert.incidentLimit'
    },
    led: safeLed(1600),
    haptic: {
      pattern: 'double',
      patternLabelKey: 'accessibilityCues.pattern.haptic.double',
      intensity: 0.7
    }
  }),
  manifest('tyrePressure', {
    labelKey: 'accessibilityCues.event.alert.tyrePressure',
    meaningKey: 'accessibilityCues.meaning.alert.tyrePressure',
    severity: 'warning',
    preserveCritical: false,
    symbol: {
      token: 'PSI',
      labelKey: 'accessibilityCues.symbol.alert.tyrePressure'
    },
    led: safeLed(1500),
    haptic: {
      pattern: 'double',
      patternLabelKey: 'accessibilityCues.pattern.haptic.double',
      intensity: 0.65
    }
  }),
  manifest('tyreTemp', {
    labelKey: 'accessibilityCues.event.alert.tyreTemp',
    meaningKey: 'accessibilityCues.meaning.alert.tyreTemp',
    severity: 'warning',
    preserveCritical: false,
    symbol: {
      token: 'TYRE',
      labelKey: 'accessibilityCues.symbol.alert.tyreTemp'
    },
    led: safeLed(1500),
    haptic: {
      pattern: 'double',
      patternLabelKey: 'accessibilityCues.pattern.haptic.double',
      intensity: 0.65
    }
  }),
  manifest('brakeTemp', {
    labelKey: 'accessibilityCues.event.alert.brakeTemp',
    meaningKey: 'accessibilityCues.meaning.alert.brakeTemp',
    severity: 'warning',
    preserveCritical: false,
    symbol: {
      token: 'BRK',
      labelKey: 'accessibilityCues.symbol.alert.brakeTemp'
    },
    led: safeLed(1700),
    haptic: {
      pattern: 'double',
      patternLabelKey: 'accessibilityCues.pattern.haptic.double',
      intensity: 0.7
    }
  }),
  manifest('drsAvailable', {
    labelKey: 'accessibilityCues.event.alert.drsAvailable',
    meaningKey: 'accessibilityCues.meaning.alert.drsAvailable',
    severity: 'info',
    preserveCritical: false,
    symbol: {
      token: 'DRS',
      labelKey: 'accessibilityCues.symbol.alert.drsAvailable'
    },
    led: safeLed(800),
    haptic: {
      pattern: 'single',
      patternLabelKey: 'accessibilityCues.pattern.haptic.single',
      intensity: 0.45
    }
  }),
  manifest('blueFlag', {
    labelKey: 'accessibilityCues.event.alert.blueFlag',
    meaningKey: 'accessibilityCues.meaning.alert.blueFlag',
    severity: 'warning',
    preserveCritical: false,
    symbol: {
      token: 'BLUE',
      labelKey: 'accessibilityCues.symbol.alert.blueFlag'
    },
    led: safeLed(1600),
    haptic: {
      pattern: 'double',
      patternLabelKey: 'accessibilityCues.pattern.haptic.double',
      intensity: 0.65
    }
  })
] as const

const MANIFEST_BY_ID = new Map<CueEventId, CueManifest>(
  CUE_MANIFESTS.map((entry) => [entry.eventId, entry])
)

export interface CueOverride {
  modalities?: Partial<Record<CueModality, boolean>>
}

export interface CueProfile {
  version: 2
  id: string
  kind: CueProfileKind
  name: string
  modalities: Record<CueModality, CueModalityPolicy>
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
  version: 2
  revision: number
  activeProfileId: string
  profiles: CueProfile[]
  updatedAt: number
}

export interface AccessibilityCueStateEnvelope {
  protocolVersion: typeof ACCESSIBILITY_CUE_PROTOCOL_VERSION
  ready: boolean
  revision: number
  state: AccessibilityCueStore
}

export interface SaveCueProfileRequest {
  protocolVersion: typeof ACCESSIBILITY_CUE_PROTOCOL_VERSION
  expectedRevision: number
  profile: CueProfile
}

export interface SelectCueProfileRequest {
  protocolVersion: typeof ACCESSIBILITY_CUE_PROTOCOL_VERSION
  expectedRevision: number
  profileId: string
}

export interface SetCueAudioAvailabilityRequest {
  protocolVersion: typeof ACCESSIBILITY_CUE_PROTOCOL_VERSION
  available: boolean
}

export const STANDARD_CUE_PROFILE: CueProfile = {
  version: 2,
  id: 'standard',
  kind: 'standard',
  name: 'Standard multimodal',
  modalities: {
    caption: 'inherit',
    audio: 'inherit',
    symbol: 'inherit',
    led: 'off',
    haptic: 'off'
  },
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
  version: 2,
  id: 'low-vision-blind',
  kind: 'low-vision-blind',
  name: 'Low vision / blind',
  modalities: {
    caption: 'inherit',
    audio: 'on',
    symbol: 'inherit',
    led: 'off',
    haptic: 'on'
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
  version: 2,
  id: 'deaf-hoh',
  kind: 'deaf-hoh',
  name: 'Deaf / hard of hearing',
  modalities: {
    caption: 'inherit',
    audio: 'off',
    symbol: 'inherit',
    led: 'on',
    haptic: 'on'
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
  version: 2,
  revision: 0,
  activeProfileId: STANDARD_CUE_PROFILE.id,
  profiles: BUILTIN_CUE_PROFILES.map(cloneCueProfile),
  updatedAt: 0
}

export interface SemanticCueEvent {
  instanceId: string
  id: string
  messageKey: string
  context?: AlertEventContext
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
  sensoryChannel: CueSensoryChannel
  semanticId: CueEventId
  messageKey: string
  context?: AlertEventContext
  delivery: CueOutputDelivery
  symbol?: string
  symbolLabelKey?: string
  pattern?: CueLedPattern | CueHapticPattern
  patternLabelKey?: string
  color?: CueManifest['led']['color']
  hardwareTextToken?: string
  spatialPan?: number
  intensity?: number
  durationMs?: number
}

export type CueRouteIssueCode =
  | 'unknown-event'
  | 'unknown-source'
  | 'modality-unavailable'
  | 'replay-hardware-blocked'
  | 'preview-hardware-simulated'
  | 'critical-modality-preserved'
  | 'critical-redundancy-unavailable'
  | 'reduced-motion-pattern-substituted'

export interface CueRouteIssue {
  code: CueRouteIssueCode
  modality?: CueModality
  detail?: string
}

export type CueProfileConflictCode =
  | 'unknown-override-event'
  | 'critical-insufficient-independent-redundancy'
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
  instanceId: string
  eventId: string
  source: CueSource | 'unknown'
  severity: AlertSeverity
  timestamp: number
  messageKey: string
  context?: AlertEventContext
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

function isCueModalityPolicy(value: unknown): value is CueModalityPolicy {
  return value === 'inherit' || value === 'on' || value === 'off'
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
  const normalized = value
    .trim()
    .replace(/[^a-z0-9-]/gi, '-')
    .replace(/-+/g, '-')
    .slice(0, 64)
  return normalized || fallback
}

function normalizeProfileName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().replace(/\s+/g, ' ').slice(0, 80)
  return normalized || fallback
}

function normalizeModalityPolicies(
  value: unknown,
  fallback: Record<CueModality, CueModalityPolicy>
): Record<CueModality, CueModalityPolicy> {
  const input = isRecord(value) ? value : {}
  return Object.fromEntries(
    CUE_MODALITIES.map((modality) => {
      const candidate = input[modality]
      const policy = isCueModalityPolicy(candidate)
        ? candidate
        : typeof candidate === 'boolean'
          ? candidate
            ? 'on'
            : 'off'
          : fallback[modality]
      return [modality, policy]
    })
  ) as Record<CueModality, CueModalityPolicy>
}

function normalizeOverride(value: unknown): CueOverride {
  if (!isRecord(value) || !isRecord(value.modalities)) return {}
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

export function cloneAccessibilityCueStore(
  store: AccessibilityCueStore
): AccessibilityCueStore {
  return {
    ...store,
    profiles: store.profiles.map(cloneCueProfile)
  }
}

export function createAccessibilityCueStateEnvelope(
  store: AccessibilityCueStore,
  ready: boolean
): AccessibilityCueStateEnvelope {
  return {
    protocolVersion: ACCESSIBILITY_CUE_PROTOCOL_VERSION,
    ready,
    revision: store.revision,
    state: cloneAccessibilityCueStore(store)
  }
}

export function normalizeCueProfile(
  value: unknown,
  fallback: CueProfile = STANDARD_CUE_PROFILE
): CueProfile {
  const input = isRecord(value) ? value : {}
  return {
    version: 2,
    id: normalizeProfileId(input.id, fallback.id),
    kind: isCueProfileKind(input.kind) ? input.kind : fallback.kind,
    name: normalizeProfileName(input.name, fallback.name),
    modalities: normalizeModalityPolicies(input.modalities, fallback.modalities),
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
    profiles.push({
      ...normalizeCueProfile(rawProfile, customFallback),
      kind: 'custom'
    })
    usedIds.add(rawId)
  }

  const requestedActive =
    typeof input.activeProfileId === 'string'
      ? input.activeProfileId
      : STANDARD_CUE_PROFILE.id

  return {
    version: 2,
    revision: normalizeTimestamp(input.revision),
    activeProfileId: usedIds.has(requestedActive)
      ? requestedActive
      : STANDARD_CUE_PROFILE.id,
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

function nextRevision(store: AccessibilityCueStore, revision?: number): number {
  return Math.max(store.revision + 1, normalizeTimestamp(revision, store.revision + 1))
}

export function upsertCueProfile(
  store: AccessibilityCueStore,
  value: unknown,
  now = Date.now(),
  revision?: number
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
  const normalized = normalizeCueProfile(input, fallback)
  const nextProfile: CueProfile = {
    ...normalized,
    kind: builtin ? builtin.kind : 'custom',
    updatedAt: normalizeTimestamp(now)
  }
  const profiles = store.profiles.some((candidate) => candidate.id === nextProfile.id)
    ? store.profiles.map((candidate) =>
        candidate.id === nextProfile.id ? nextProfile : cloneCueProfile(candidate)
      )
    : [...store.profiles.map(cloneCueProfile), nextProfile]
  return normalizeAccessibilityCueStore({
    ...store,
    revision: nextRevision(store, revision),
    profiles,
    updatedAt: normalizeTimestamp(now)
  })
}

export function activateCueProfile(
  store: AccessibilityCueStore,
  profileId: unknown,
  now = Date.now(),
  revision?: number
): AccessibilityCueStore {
  const requested = typeof profileId === 'string' ? profileId : ''
  if (!store.profiles.some((profile) => profile.id === requested)) {
    return cloneAccessibilityCueStore(store)
  }
  return normalizeAccessibilityCueStore({
    ...store,
    revision: nextRevision(store, revision),
    activeProfileId: requested,
    updatedAt: normalizeTimestamp(now)
  })
}

export function resetCueProfile(
  store: AccessibilityCueStore,
  profileId: unknown,
  now = Date.now(),
  revision?: number
): AccessibilityCueStore {
  if (typeof profileId !== 'string') return cloneAccessibilityCueStore(store)
  const builtin = BUILTIN_CUE_PROFILES.find((profile) => profile.id === profileId)
  if (!builtin) return cloneAccessibilityCueStore(store)
  return upsertCueProfile(store, { ...builtin, updatedAt: now }, now, revision)
}

export function alertCueEventId(type: AlertType): CueEventId {
  return `alert.${type}`
}

export function getCueManifest(eventId: string): CueManifest | undefined {
  return MANIFEST_BY_ID.get(eventId as CueEventId)
}

function messageKeyForAlert(event: AlertEvent): string {
  if (event.type === 'flag' && event.context?.flag) {
    return `accessibilityCues.live.alert.flag.${event.context.flag}`
  }
  if (event.type === 'tyrePressure' && event.context?.direction) {
    return `accessibilityCues.live.alert.tyrePressure.${event.context.direction}`
  }
  return `accessibilityCues.live.alert.${event.type}`
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
    instanceId: event.id,
    id: alertCueEventId(event.type),
    messageKey: messageKeyForAlert(event),
    context: event.context ? { ...event.context } : undefined,
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
  const manifestEntry = getCueManifest(eventId)
  const override = profile.overrides[eventId]?.modalities
  return Object.fromEntries(
    CUE_MODALITIES.map((modality) => {
      if (typeof override?.[modality] === 'boolean') {
        return [
          modality,
          override[modality] &&
            (modality !== 'haptic' ||
              isActuatingHapticIntensity(profile.hapticIntensity))
        ]
      }
      const policy = profile.modalities[modality]
      if (
        modality === 'haptic' &&
        !isActuatingHapticIntensity(profile.hapticIntensity)
      ) {
        return [modality, false]
      }
      return [
        modality,
        policy === 'on'
          ? true
          : policy === 'off'
            ? false
            : Boolean(manifestEntry?.defaultModalities[modality])
      ]
    })
  ) as Record<CueModality, boolean>
}

function isExplicitlyOff(
  profile: CueProfile,
  eventId: string,
  modality: CueModality
): boolean {
  if (
    modality === 'haptic' &&
    !isActuatingHapticIntensity(profile.hapticIntensity)
  ) {
    return true
  }
  const override = profile.overrides[eventId]?.modalities?.[modality]
  if (override === false) return true
  if (override === true) return false
  return profile.modalities[modality] === 'off'
}

export function isActuatingHapticIntensity(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function independentCueChannels(
  outputs: readonly RoutedCueOutput[]
): Set<CueSensoryChannel> {
  return new Set(
    outputs
      .filter(
        (output) =>
          output.modality !== 'haptic' ||
          output.intensity === undefined ||
          isActuatingHapticIntensity(output.intensity)
      )
      .map((output) => output.sensoryChannel)
  )
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
        message: `Unknown cue override "${eventId}" is never routed.`
      })
    }
  }

  for (const cue of CUE_MANIFESTS) {
    if (!cue.preserveCritical) continue
    const enabled = CUE_MODALITIES.filter(
      (modality) => effectiveCueModalities(profile, cue.eventId)[modality]
    )
    const channels = new Set(enabled.map((modality) => CUE_MODALITY_CHANNEL[modality]))
    if (channels.size < 2) {
      conflicts.push({
        code: 'critical-insufficient-independent-redundancy',
        severity: 'error',
        eventId: cue.eventId,
        message: `${cue.eventId} needs two independent sensory channels.`
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
        message: `${cue.eventId} cannot depend only on optional hardware.`
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
    return ['haptic', 'caption', 'symbol', 'led', 'audio']
  }
  return ['audio', 'haptic', 'caption', 'symbol', 'led']
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

function hapticPatternFor(
  manifestEntry: CueManifest,
  profile: CueProfile
): CueHapticPattern {
  if (!profile.reducedMotion) return manifestEntry.haptic.pattern
  return manifestEntry.haptic.pattern === 'single' ? 'single' : 'long'
}

function hapticPatternLabelKey(pattern: CueHapticPattern): string {
  return `accessibilityCues.pattern.haptic.${pattern}`
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
    sensoryChannel: CUE_MODALITY_CHANNEL[modality],
    semanticId: manifestEntry.eventId,
    messageKey: event.messageKey,
    context: event.context ? { ...event.context } : undefined,
    delivery
  }
  if (modality === 'audio') {
    return {
      ...base,
      spatialPan: profile.spatialAudio ? spatialPan(event.position) : undefined
    }
  }
  if (modality === 'symbol') {
    return {
      ...base,
      symbol: manifestEntry.symbol.token,
      symbolLabelKey: manifestEntry.symbol.labelKey
    }
  }
  if (modality === 'led') {
    return {
      ...base,
      pattern: manifestEntry.led.pattern,
      patternLabelKey: manifestEntry.led.patternLabelKey,
      color: manifestEntry.led.color,
      hardwareTextToken: manifestEntry.symbol.token,
      durationMs: manifestEntry.led.durationMs
    }
  }
  if (modality === 'haptic') {
    const pattern = hapticPatternFor(manifestEntry, profile)
    return {
      ...base,
      pattern,
      patternLabelKey: hapticPatternLabelKey(pattern),
      intensity: clamp(
        manifestEntry.haptic.intensity * profile.hapticIntensity,
        0,
        1,
        manifestEntry.haptic.intensity
      )
    }
  }
  return base
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

function blockedRoute(
  event: SemanticCueEvent,
  profile: CueProfile,
  issue: CueRouteIssue
): CueRoute {
  return {
    status: 'blocked',
    instanceId: event.instanceId,
    eventId: event.id,
    source: isCueSource(event.source) ? event.source : 'unknown',
    severity: event.severity,
    timestamp: event.timestamp,
    messageKey: event.messageKey,
    context: event.context ? { ...event.context } : undefined,
    outputs: [],
    issues: [issue],
    conflicts: analyzeCueProfile(profile),
    presentation: presentationFor(profile)
  }
}

export function routeSemanticCue(
  event: SemanticCueEvent,
  profileValue: unknown,
  capabilitiesValue: Partial<CueCapabilities> = DEFAULT_CUE_CAPABILITIES
): CueRoute {
  const profile = normalizeCueProfile(profileValue)
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

  const pushIssue = (issue: CueRouteIssue): void => {
    if (
      !issues.some(
        (candidate) =>
          candidate.code === issue.code &&
          candidate.modality === issue.modality &&
          candidate.detail === issue.detail
      )
    ) {
      issues.push(issue)
    }
  }

  const tryAdd = (modality: CueModality, preserved = false): boolean => {
    if (outputs.some((output) => output.modality === modality)) return true
    const delivery = routeDelivery(event.source, modality)
    if (!delivery) {
      pushIssue({ code: 'replay-hardware-blocked', modality })
      return false
    }
    const previewPhysical =
      event.source === 'preview' &&
      (modality === 'led' || modality === 'haptic')
    if (!previewPhysical && !capabilities[modality]) {
      pushIssue({ code: 'modality-unavailable', modality })
      return false
    }
    const output = buildOutput(manifestEntry, event, profile, modality, delivery)
    if (
      modality === 'haptic' &&
      !isActuatingHapticIntensity(output.intensity)
    ) {
      pushIssue({
        code: 'modality-unavailable',
        modality,
        detail: 'zero-intensity'
      })
      return false
    }
    outputs.push(output)
    if (delivery === 'simulated') {
      pushIssue({ code: 'preview-hardware-simulated', modality })
    }
    if (
      modality === 'haptic' &&
      profile.reducedMotion &&
      output.pattern !== manifestEntry.haptic.pattern
    ) {
      pushIssue({
        code: 'reduced-motion-pattern-substituted',
        modality,
        detail: `${manifestEntry.haptic.pattern}->${String(output.pattern)}`
      })
    }
    if (preserved) {
      pushIssue({ code: 'critical-modality-preserved', modality })
    }
    return true
  }

  for (const modality of CUE_MODALITIES) {
    if (enabled[modality]) tryAdd(modality)
  }

  const critical = event.severity === 'critical' || manifestEntry.preserveCritical
  if (critical) {
    for (const modality of fallbackOrder(profile)) {
      if (independentCueChannels(outputs).size >= 2) break
      if (isExplicitlyOff(profile, event.id, modality)) continue
      tryAdd(modality, !enabled[modality])
    }
    if (independentCueChannels(outputs).size < 2) {
      pushIssue({
        code: 'critical-redundancy-unavailable',
        detail: `${independentCueChannels(outputs).size}/2 sensory channels available`
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
    instanceId: event.instanceId,
    eventId: manifestEntry.eventId,
    source: event.source,
    severity: event.severity,
    timestamp: event.timestamp,
    messageKey: event.messageKey,
    context: event.context ? { ...event.context } : undefined,
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
      (output.modality === 'led' ||
        (output.modality === 'haptic' &&
          (output.intensity === undefined ||
            isActuatingHapticIntensity(output.intensity))))
  )
}

export function cueRouteHasModality(route: CueRoute, modality: CueModality): boolean {
  return route.outputs.some((output) => output.modality === modality)
}
