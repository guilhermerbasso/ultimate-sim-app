import type { PrivacyClass, TelemetryContext } from './phase02-contracts'
import type { Phase02TapStatus } from './phase02-tap'

export const STINT_PASSPORT_CONTRACT_VERSION = 1 as const
export const STINT_PASSPORT_ITEM_COUNT = 12 as const

export type PassportRole = 'driver' | 'engineer' | 'crew-chief' | 'spotter' | 'team-manager'
export type PassportItemId =
  | 'session-identity'
  | 'incoming-driver'
  | 'car-track'
  | 'fuel-load'
  | 'stint-target'
  | 'race-profile'
  | 'buttonbox-profile'
  | 'required-devices'
  | 'critical-controls'
  | 'audio-comms'
  | 'weather-assumption'
  | 'final-acknowledgement'
export type PassportItemStatus =
  | 'unknown'
  | 'verified'
  | 'manual-confirmed'
  | 'waived-with-reason'
  | 'not-applicable'
  | 'mismatch'
  | 'expired'
export type PassportLifecycle =
  | 'awaiting-checklist'
  | 'ready'
  | 'closed'
  | 'interrupted'
export type PassportCloseReason =
  | 'driver-swap'
  | 'session-boundary'
  | 'car-track-boundary'
  | 'disconnect'
  | 'replay-boundary'
  | 'restart-recovery'
  | 'manual'
export type PassportDataClass = Extract<PrivacyClass, 'D1' | 'D2' | 'D3'>
export type WeatherAssumption = 'dry' | 'wet' | 'any'
export type PassportExportProfile = 'full-local' | 'pseudonymized' | 'race-only'

export interface PassportOwner {
  memberId: string
  role: PassportRole
}

export interface PassportRosterMember {
  memberId: string
  displayName: string
  roles: PassportRole[]
  active: boolean
}

export interface PassportItemDefinition {
  id: PassportItemId
  required: boolean
  critical: boolean
  dataClass: PassportDataClass
  allowedRoles: PassportRole[]
  ttlMs: number
}

export const PASSPORT_ITEM_DEFINITIONS: readonly PassportItemDefinition[] = [
  { id: 'session-identity', required: true, critical: true, dataClass: 'D2', allowedRoles: ['engineer', 'team-manager'], ttlMs: 15_000 },
  { id: 'incoming-driver', required: true, critical: true, dataClass: 'D3', allowedRoles: ['driver', 'team-manager'], ttlMs: 30_000 },
  { id: 'car-track', required: true, critical: true, dataClass: 'D2', allowedRoles: ['driver', 'engineer'], ttlMs: 30_000 },
  { id: 'fuel-load', required: true, critical: true, dataClass: 'D2', allowedRoles: ['engineer', 'crew-chief'], ttlMs: 15_000 },
  { id: 'stint-target', required: true, critical: true, dataClass: 'D2', allowedRoles: ['engineer', 'crew-chief'], ttlMs: 60_000 },
  { id: 'race-profile', required: true, critical: true, dataClass: 'D2', allowedRoles: ['driver', 'engineer'], ttlMs: 60_000 },
  { id: 'buttonbox-profile', required: true, critical: true, dataClass: 'D2', allowedRoles: ['driver', 'engineer'], ttlMs: 60_000 },
  { id: 'required-devices', required: true, critical: true, dataClass: 'D1', allowedRoles: ['engineer', 'crew-chief'], ttlMs: 30_000 },
  { id: 'critical-controls', required: true, critical: true, dataClass: 'D1', allowedRoles: ['driver', 'engineer'], ttlMs: 60_000 },
  { id: 'audio-comms', required: true, critical: true, dataClass: 'D1', allowedRoles: ['driver', 'spotter', 'engineer'], ttlMs: 60_000 },
  { id: 'weather-assumption', required: true, critical: false, dataClass: 'D2', allowedRoles: ['engineer', 'crew-chief'], ttlMs: 30_000 },
  { id: 'final-acknowledgement', required: true, critical: true, dataClass: 'D3', allowedRoles: ['driver', 'team-manager'], ttlMs: 5 * 60_000 }
] as const

export interface PassportItemEvidence {
  source: string
  summary: string
  contentHash: string
  capturedAt: number
  state: 'available' | 'retention-redacted' | 'unavailable'
}

export interface PassportItem {
  id: PassportItemId
  status: PassportItemStatus
  owner?: PassportOwner
  detail: string
  overrideReason?: string
  verifiedAt?: number
  expiresAt?: number
  evidence?: PassportItemEvidence
  revision: number
}

export interface StintIdentity {
  stintId: string
  sessionRef: string
  trackRef: string
  trackLabel: string
  carRef: string
  carLabel: string
  driverRef: string
  driverLabel: string
  teamRef?: string
  teamLabel?: string
  startedAt: number
}

export interface StintPassport {
  contractVersion: typeof STINT_PASSPORT_CONTRACT_VERSION
  identity: StintIdentity
  lifecycle: PassportLifecycle
  telemetryContext: TelemetryContext
  items: PassportItem[]
  coverage: number
  applicableItems: number
  coveredItems: number
  challengeCompletedAt?: number
  challengeOwner?: PassportOwner
  closedAt?: number
  closeReason?: PassportCloseReason
  interrupted: boolean
  persisted: boolean
}

export interface PassportConfig {
  expectedRaceProfileId: string
  expectedButtonboxProfile: string
  requiredDeviceIds: string[]
  requiredControlIds: string[]
  requiredAudioOutputDeviceId: string
  requiredAudioCallouts: string[]
  communicationChannel: string
  minimumFuelLiters: number
  targetStintLaps: number
  weatherAssumption: WeatherAssumption
  updatedAt: number
}

export const DEFAULT_PASSPORT_CONFIG: PassportConfig = {
  expectedRaceProfileId: '',
  expectedButtonboxProfile: '',
  requiredDeviceIds: ['simx'],
  requiredControlIds: ['sw1', 'sw2'],
  requiredAudioOutputDeviceId: '',
  requiredAudioCallouts: ['proximity.spotter', 'pit.speeding', 'fuel.box'],
  communicationChannel: '',
  minimumFuelLiters: 0,
  targetStintLaps: 0,
  weatherAssumption: 'any',
  updatedAt: 0
}

export interface PassportRetentionSettings {
  D1: number
  D2: number
  D3: number
}

export interface PassportPrivacySettings {
  identityPersistenceOptIn: boolean
  retentionDays: PassportRetentionSettings
  updatedAt: number
}

export const DEFAULT_PASSPORT_PRIVACY: PassportPrivacySettings = {
  identityPersistenceOptIn: false,
  retentionDays: { D1: 90, D2: 30, D3: 7 },
  updatedAt: 0
}

export interface PassportIntegrityState {
  state: 'unanchored' | 'corrupt' | 'unavailable'
  verified: false
  scope: 'incremental' | 'bounded' | 'full'
  checkedEvents: number
  totalEvents?: number
  headHash?: string
  lastCheckedAt: number
  message?: string
}

export interface PassportRuntimeState {
  telemetryContext: TelemetryContext | 'disconnected'
  queue: Phase02TapStatus
  overflowBlocked: boolean
  cleanFramesSinceOverflow: number
  lastError?: string
}

export interface PassportSnapshot {
  contractVersion: typeof STINT_PASSPORT_CONTRACT_VERSION
  current: StintPassport | null
  history: StintPassport[]
  roster: PassportRosterMember[]
  config: PassportConfig
  privacy: PassportPrivacySettings
  runtime: PassportRuntimeState
  integrity: PassportIntegrityState
}

export interface PassportItemResolutionInput {
  stintId: string
  itemId: PassportItemId
  status: Extract<PassportItemStatus, 'manual-confirmed' | 'waived-with-reason' | 'not-applicable'>
  owner: PassportOwner
  reason?: string
}

export interface PassportChallengeInput {
  stintId: string
  owner: PassportOwner
}

export interface PassportExportResult {
  ok: boolean
  canceled: boolean
  fileName?: string
  packageHash?: string
}

export interface PassportDeleteResult {
  deletedStints: number
  redactedEvidence: number
  dataClass: PassportDataClass
}

export interface PassportFullAuditResult {
  integrity: PassportIntegrityState
  durationMs: number
}

export const STINT_PASSPORT_CHANNELS = {
  getSnapshot: 'stintPassport:getSnapshot',
  updated: 'stintPassport:updated',
  setRoster: 'stintPassport:setRoster',
  setConfig: 'stintPassport:setConfig',
  setPrivacy: 'stintPassport:setPrivacy',
  resolveItem: 'stintPassport:resolveItem',
  completeChallenge: 'stintPassport:completeChallenge',
  closeCurrent: 'stintPassport:closeCurrent',
  setKillSwitch: 'stintPassport:setKillSwitch',
  saveExport: 'stintPassport:saveExport',
  deleteByClass: 'stintPassport:deleteByClass',
  runFullAudit: 'stintPassport:runFullAudit'
} as const

export function isCoveredStatus(status: PassportItemStatus): boolean {
  return status === 'verified' ||
    status === 'manual-confirmed' ||
    status === 'waived-with-reason' ||
    status === 'not-applicable'
}

export function calculatePassportCoverage(items: readonly PassportItem[]): {
  coverage: number
  applicableItems: number
  coveredItems: number
} {
  const applicable = items.filter((item) => item.status !== 'not-applicable')
  const covered = applicable.filter((item) => isCoveredStatus(item.status))
  return {
    coverage: applicable.length === 0 ? 1 : covered.length / applicable.length,
    applicableItems: applicable.length,
    coveredItems: covered.length
  }
}

export function passportItemDefinition(id: PassportItemId): PassportItemDefinition {
  const definition = PASSPORT_ITEM_DEFINITIONS.find((candidate) => candidate.id === id)
  if (!definition) throw new Error(`Unknown Passport item: ${id}`)
  return definition
}

export function isPassportRole(value: unknown): value is PassportRole {
  return value === 'driver' ||
    value === 'engineer' ||
    value === 'crew-chief' ||
    value === 'spotter' ||
    value === 'team-manager'
}
