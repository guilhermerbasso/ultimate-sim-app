import type { ReplayContextState } from './replay'
import type { StreamingAccessMode } from './streaming'

export const STORY_ENGINE_CHANNELS = {
  state: 'story:state',
  generate: 'story:generate',
  decide: 'story:decide',
  exportApproved: 'story:export-approved',
  reset: 'story:reset',
  changed: 'story:changed'
} as const

export const STORY_ENGINE_SCHEMA = 'ultimate-sim-story-engine.v1'
export const STORY_EXPORT_SCHEMA = 'ultimate-sim-story-cards.v1'
export const STORY_APPROVAL_TTL_MS = 24 * 60 * 60 * 1_000
export const STORY_MAX_EVENTS = 1_000
export const STORY_MAX_EVIDENCE = 1_000
export const STORY_MAX_CARDS_PER_MINUTE = 3
export const STORY_TIMELINE_TOLERANCE_MS = 2_000

export type StoryDestination = StreamingAccessMode
export type StoryFactValue = string | number | boolean | null
export type StoryFactMap = Record<string, StoryFactValue>
export type StoryPrivacyClass = 'D0' | 'D1' | 'D2' | 'D3' | 'D4' | 'D5'
export type StoryRightsState = 'cleared' | 'unknown' | 'revoked' | 'prohibited'
export type StoryRightsScope = 'local' | 'team' | 'public' | 'prohibited'
export type StoryConsentState = 'granted' | 'not-required' | 'unknown' | 'revoked'
export type StoryEvidenceSource =
  | 'telemetry'
  | 'incident-clip'
  | 'replay-bookmark'
  | 'media-mark'
  | 'stream-event'
  | 'manual-attestation'

export type StoryEventType =
  | 'position-change'
  | 'fastest-lap'
  | 'finish'
  | 'lap-complete'
  | 'incident'
  | 'incident-count'
  | 'flag'
  | 'pit-stop'
  | 'replay-bookmark'
  | 'media-mark'
  | 'explicit'

export type StoryIntegrityFlag =
  | 'stale'
  | 'gap'
  | 'derived'
  | 'redacted'
  | 'externally-attested'
  | 'missing'
  | 'corrupt'

export interface StoryClockReference {
  clock: 'sim' | 'monotonic' | 'replay' | 'media' | 'stream'
  sourceTimeMs: number
  toSessionOffsetMs: number
  uncertaintyMs?: number
}

export interface StoryCaptureRange {
  start: number
  end: number
  unit: 'ms' | 'tick' | 'frame'
}

export interface StoryRights {
  state: StoryRightsState
  scope: StoryRightsScope
  ownerRef?: string
  checkedAt: number
  expiresAt?: number
}

export interface StoryConsent {
  state: StoryConsentState
  subjectRef?: string
  epoch: number
  checkedAt: number
  expiresAt?: number
}

export interface StoryPiiToken {
  kind: 'name' | 'email' | 'phone' | 'ip' | 'account-id' | 'other'
  value: string
  replacement?: string
}

export interface StoryPiiAttestation {
  status: 'none-detected' | 'pii-declared'
  method: string
  checkedAt: number
}

export interface StoryEvidence {
  id: string
  source: StoryEvidenceSource
  eventType: StoryEventType
  statement: string
  contentHash: string
  contentLocator?: string
  contentCommitted: boolean
  schemaFingerprint: string
  captureRange: StoryCaptureRange
  origin: {
    producer: string
    version: string
  }
  transformLineage: string[]
  confidence: {
    score: number
    method: string
  }
  clock: StoryClockReference
  rights: StoryRights
  consent: StoryConsent
  privacyClass: StoryPrivacyClass
  integrityFlags?: StoryIntegrityFlag[]
  pii?: StoryPiiToken[]
  piiAttestation: StoryPiiAttestation
  claim: StoryClaim
  facts?: StoryFactMap
  replayState?: ReplayContextState
}

export interface StoryClaim {
  subjectRef: string
  predicate: string
  value: StoryFactValue
}

export interface StoryTimelineEvent {
  id: string
  type: StoryEventType
  eventClass: 'fact' | 'inference' | 'recommendation'
  sessionTimeMs: number
  endSessionTimeMs?: number
  lap?: number
  evidenceRefs: string[]
  assertionId: string
  claim: StoryClaim
  facts: StoryFactMap
  priority?: number
  supersedesEventId?: string
  title?: string
  statement?: string
}

export interface StoryRaceTimeline {
  id: string
  sessionRef: string
  completed: boolean
  trackName?: string
  carName?: string
  startedAt?: number
  endedAt?: number
  events: StoryTimelineEvent[]
  evidence: StoryEvidence[]
}

export type StoryGenerationIssueCode =
  | 'timeline-not-complete'
  | 'timeline-too-large'
  | 'non-fact-event'
  | 'missing-evidence'
  | 'invalid-evidence'
  | 'missing-confidence'
  | 'timeline-mismatch'
  | 'contradictory-events'
  | 'invalid-event'
  | 'causal-language'
  | 'duplicate-card'
  | 'spam-cap'

export interface StoryGenerationIssue {
  code: StoryGenerationIssueCode
  message: string
  eventIds?: string[]
  evidenceIds?: string[]
}

export interface StoryRedaction {
  kind: StoryPiiToken['kind']
  replacement: string
  reason: 'explicit-pii' | 'pattern-detected'
  evidenceRef?: string
}

export interface StoryEvidenceProvenance {
  id: string
  source: StoryEvidenceSource
  contentHash: string
  contentLocator?: string
  contentCommitted: boolean
  schemaFingerprint: string
  captureRange: StoryCaptureRange
  origin: StoryEvidence['origin']
  transformLineage: string[]
  confidenceMethod: string
  normalizedSessionTimeMs: number
  clockOffsetMs: number
  clockUncertaintyMs: number
  integrityFlags: StoryIntegrityFlag[]
  replayState?: ReplayContextState
}

export interface StoryPolicySnapshot {
  rightsState: StoryRightsState
  rightsScope: StoryRightsScope
  consentState: StoryConsentState
  authorizationRef: string
  privacyClass: StoryPrivacyClass
  policyCheckedAt: number
  expiresAt?: number
  piiRedacted: boolean
}

export interface StoryDestinationPreview {
  destination: StoryDestination
  status: 'ready' | 'redacted' | 'blocked'
  title: string
  body: string
  reasons: string[]
  streamSafe: boolean
  publication: 'preview-only'
}

export type StoryCardStatus = 'candidate' | 'approved' | 'rejected' | 'exported'

export interface StoryHumanDecision {
  decision: 'approved' | 'rejected'
  reviewer: string
  decidedAt: number
  note?: string
}

export interface StoryApprovalReceipt {
  id: string
  reviewer: string
  destination: StoryDestination
  approvedAt: number
  expiresAt: number
  scope: string
  oneShot: true
  consumedAt?: number
}

export interface StoryCard {
  id: string
  dedupeKey: string
  revision: string
  sessionRef: string
  timelineId: string
  eventType: StoryEventType
  eventIds: string[]
  createdAt: number
  observedInterval: {
    startSessionTimeMs: number
    endSessionTimeMs: number
  }
  lap?: number
  title: string
  body: string
  rank: number
  confidence: {
    score: number
    level: 'low' | 'medium' | 'high'
    method: 'minimum-explicit-evidence-v1'
    reasons: string[]
  }
  provenance: StoryEvidenceProvenance[]
  redactions: StoryRedaction[]
  policy: StoryPolicySnapshot
  previews: StoryDestinationPreview[]
  status: StoryCardStatus
  decision?: StoryHumanDecision
  approval?: StoryApprovalReceipt
  exportedAt?: number
}

export interface StoryGenerationResult {
  timelineId: string
  sessionRef: string
  generatedAt: number
  candidates: StoryCard[]
  issues: StoryGenerationIssue[]
}

export interface StoryEngineState {
  schema: typeof STORY_ENGINE_SCHEMA
  updatedAt: number
  cards: StoryCard[]
  issues: StoryGenerationIssue[]
  exportJournal: StoryExportJournalEntry[]
  lastGeneration?: {
    timelineId: string
    sessionRef: string
    generatedAt: number
    candidateCount: number
    issueCount: number
  }
}

export interface StoryExportJournalEntry {
  id: string
  fileName: string
  destination: StoryDestination
  format: StoryExportRequest['format']
  cardIds: string[]
  exportedAt: number
  contentHash: string
  status: 'committed' | 'finalized'
}

export interface StoryDecisionRequest {
  cardId: string
  revision: string
  decision: 'approved' | 'rejected'
  reviewer: string
  destination?: StoryDestination
  note?: string
  humanConfirmed: boolean
}

export interface StoryExportRequest {
  destination: StoryDestination
  format: 'json' | 'markdown'
  cardIds?: string[]
}

export interface StoryExportResult {
  path: string
  format: StoryExportRequest['format']
  destination: StoryDestination
  cardIds: string[]
  exportedAt: number
  offlineOnly: true
}

const DESTINATIONS: readonly StoryDestination[] = ['local', 'lan', 'internet']
const INVALID_INTEGRITY_FLAGS = new Set<StoryIntegrityFlag>(['stale', 'gap', 'missing', 'corrupt'])
const CONTENT_HASH_RE = /^(?:sha256:)?[a-f0-9]{64}$/i
const CAUSAL_LANGUAGE_RE =
  /\b(?:because|caused?|due to|therefore|led to|as a result|por causa|causou|devido a|provocou|porque|debido a|à cause de|a cause de|wegen)\b/i

const PRIVACY_RANK: Record<StoryPrivacyClass, number> = {
  D0: 0,
  D1: 1,
  D2: 2,
  D3: 3,
  D4: 4,
  D5: 5
}

const RIGHTS_RANK: Record<StoryRightsState, number> = {
  cleared: 0,
  unknown: 1,
  revoked: 2,
  prohibited: 3
}

const SCOPE_RANK: Record<StoryRightsScope, number> = {
  prohibited: -1,
  local: 0,
  team: 1,
  public: 2
}

const DESTINATION_SCOPE: Record<StoryDestination, number> = {
  local: 0,
  lan: 1,
  internet: 2
}

const CONSENT_RANK: Record<StoryConsentState, number> = {
  'not-required': 0,
  granted: 0,
  unknown: 1,
  revoked: 2
}

const STORY_SOURCES = new Set<StoryEvidenceSource>([
  'telemetry',
  'incident-clip',
  'replay-bookmark',
  'media-mark',
  'stream-event',
  'manual-attestation'
])
const STORY_CLOCKS = new Set<StoryClockReference['clock']>(['sim', 'monotonic', 'replay', 'media', 'stream'])
const STORY_PRIVACY_CLASSES = new Set<StoryPrivacyClass>(['D0', 'D1', 'D2', 'D3', 'D4', 'D5'])
const STORY_RIGHTS_STATES = new Set<StoryRightsState>(['cleared', 'unknown', 'revoked', 'prohibited'])
const STORY_RIGHTS_SCOPES = new Set<StoryRightsScope>(['local', 'team', 'public', 'prohibited'])
const STORY_CONSENT_STATES = new Set<StoryConsentState>(['granted', 'not-required', 'unknown', 'revoked'])
const STORY_CAPTURE_UNITS = new Set<StoryCaptureRange['unit']>(['ms', 'tick', 'frame'])
const STORY_REPLAY_STATES = new Set<ReplayContextState>(['live', 'replay', 'unknown'])
const STORY_PII_KINDS = new Set<StoryPiiToken['kind']>(['name', 'email', 'phone', 'ip', 'account-id', 'other'])
const STORY_PII_ATTESTATION_STATUSES = new Set<StoryPiiAttestation['status']>(['none-detected', 'pii-declared'])
const STORY_EVENT_TYPES = new Set<StoryEventType>([
  'position-change',
  'fastest-lap',
  'finish',
  'lap-complete',
  'incident',
  'incident-count',
  'flag',
  'pit-stop',
  'replay-bookmark',
  'media-mark',
  'explicit'
])

const STORY_EVENT_PREDICATES: Partial<Record<StoryEventType, ReadonlySet<string>>> = {
  'position-change': new Set(['position-at-observed-time']),
  'fastest-lap': new Set(['recorded-fastest-lap-time', 'fastest-observed-since-capture']),
  finish: new Set(['recorded-finish-position', 'terminal-classification-position']),
  'lap-complete': new Set(['lap-complete-time']),
  incident: new Set(['incident-classification']),
  'incident-count': new Set(['incident-count-at-observed-time']),
  flag: new Set(['flag-state']),
  'pit-stop': new Set(['pit-road-state']),
  'replay-bookmark': new Set(['replay-bookmark']),
  'media-mark': new Set(['media-mark'])
}

interface RedactionRule {
  kind: StoryPiiToken['kind']
  pattern: RegExp
  replacement: string
  reason: StoryRedaction['reason']
  evidenceRef?: string
  priority: number
}

interface StoryTemplate {
  title: string
  body: string
  baseRank: number
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)])
    )
  }
  return value
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(stableValue(value))
}

function shortHash(value: unknown): string {
  const text = stableSerialize(value)
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index))
    hash = (hash * prime) & mask
  }
  return hash.toString(16).padStart(16, '0')
}

function opaqueRef(prefix: string, value: string): string {
  return `${prefix}-${shortHash(value)}`
}

function canonicalContentHash(value: string): string {
  return value.toLowerCase().replace(/^sha256:/, '')
}

function isFactValue(value: unknown): value is StoryFactValue {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || finite(value)
}

function isFactMap(value: unknown): value is StoryFactMap {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every(isFactValue)
  )
}

function isClaim(value: unknown): value is StoryClaim {
  const claim = value as Partial<StoryClaim> | null
  return Boolean(
    claim &&
    typeof claim.subjectRef === 'string' &&
    claim.subjectRef.trim() &&
    typeof claim.predicate === 'string' &&
    claim.predicate.trim() &&
    isFactValue(claim.value)
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function factNumber(facts: StoryFactMap, key: string): number | undefined {
  const value = facts[key]
  return finite(value) ? value : undefined
}

function factString(facts: StoryFactMap, key: string): string | undefined {
  const value = facts[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function lapSuffix(event: StoryTimelineEvent): string {
  const lap = finite(event.lap) ? Math.max(0, Math.trunc(event.lap)) : undefined
  return lap === undefined ? '' : ` on lap ${lap}`
}

function formatLapTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds - minutes * 60
  return minutes > 0 ? `${minutes}:${remaining.toFixed(3).padStart(6, '0')}` : `${remaining.toFixed(3)} s`
}

function storyTemplate(event: StoryTimelineEvent): StoryTemplate | null {
  const subject = factString(event.facts, 'subjectLabel') ?? 'The car'
  switch (event.type) {
    case 'position-change': {
      const from = factNumber(event.facts, 'fromPosition')
      const to = factNumber(event.facts, 'toPosition')
      if (!from || !to || from < 1 || to < 1) return null
      return {
        title: `Position change: P${Math.trunc(from)} → P${Math.trunc(to)}`,
        body: `${subject} was recorded moving from P${Math.trunc(from)} to P${Math.trunc(to)}${lapSuffix(event)}.`,
        baseRank: to < from ? 0.88 : 0.7
      }
    }
    case 'fastest-lap': {
      const lapTimeSec = factNumber(event.facts, 'lapTimeSec')
      if (!lapTimeSec || lapTimeSec <= 0) return null
      const lap = finite(event.lap) ? `Lap ${Math.trunc(event.lap)} ` : 'A lap '
      const fastestScope = factString(event.facts, 'fastestScope')
      if (fastestScope === 'since-capture') {
        return {
          title: `Fastest observed since capture: ${formatLapTime(lapTimeSec)}`,
          body: `${lap}is the fastest lap explicitly observed since this local capture began, at ${formatLapTime(lapTimeSec)}.`,
          baseRank: 0.76
        }
      }
      if (fastestScope !== 'session-best') return null
      return {
        title: `Recorded fastest lap: ${formatLapTime(lapTimeSec)}`,
        body: `${lap}matches the explicit session-best value at ${formatLapTime(lapTimeSec)}.`,
        baseRank: 0.84
      }
    }
    case 'finish': {
      const position = factNumber(event.facts, 'position')
      if (!position || position < 1) return null
      const totalCars = factNumber(event.facts, 'totalCars')
      const resultKind = factString(event.facts, 'resultKind')
      if (resultKind === 'terminal-classification') {
        return {
          title: `Recorded terminal classification: P${Math.trunc(position)}`,
          body: `${subject} was explicitly recorded in P${Math.trunc(position)}${totalCars && totalCars >= position ? ` of ${Math.trunc(totalCars)}` : ''} at the terminal race state.`,
          baseRank: 0.94
        }
      }
      return {
        title: `Recorded finish: P${Math.trunc(position)}`,
        body: `${subject} was recorded finishing P${Math.trunc(position)}${totalCars && totalCars >= position ? ` of ${Math.trunc(totalCars)}` : ''}.`,
        baseRank: 1
      }
    }
    case 'lap-complete': {
      const lapTimeSec = factNumber(event.facts, 'lapTimeSec')
      if (!lapTimeSec || lapTimeSec <= 0) return null
      return {
        title: `Lap completed: ${formatLapTime(lapTimeSec)}`,
        body: `${subject} completed${lapSuffix(event)} in ${formatLapTime(lapTimeSec)}.`,
        baseRank: 0.48
      }
    }
    case 'incident': {
      const incidentType = factString(event.facts, 'incidentType')
      const severity = factString(event.facts, 'severity')
      if (!incidentType) return null
      return {
        title: `Recorded incident: ${incidentType}`,
        body: `The incident evidence explicitly records ${severity ? `${severity} ` : ''}${incidentType}${lapSuffix(event)}.`,
        baseRank: severity === 'major' ? 0.9 : severity === 'moderate' ? 0.78 : 0.66
      }
    }
    case 'incident-count': {
      const from = factNumber(event.facts, 'fromCount')
      const to = factNumber(event.facts, 'toCount')
      if (from === undefined || to === undefined || to <= from) return null
      return {
        title: `Incident counter: ${Math.trunc(from)} → ${Math.trunc(to)}`,
        body: `The supplied race timeline records the incident counter changing from ${Math.trunc(from)} to ${Math.trunc(to)}${lapSuffix(event)}.`,
        baseRank: 0.62
      }
    }
    case 'flag': {
      const flag = factString(event.facts, 'flag')
      if (!flag) return null
      return {
        title: `Flag recorded: ${flag}`,
        body: `The race timeline explicitly records a ${flag} flag state${lapSuffix(event)}.`,
        baseRank: flag.toLowerCase() === 'checkered' ? 0.82 : 0.58
      }
    }
    case 'pit-stop':
      return {
        title: 'Pit-lane event recorded',
        body: `${subject} was explicitly recorded in the pit lane${lapSuffix(event)}.`,
        baseRank: 0.58
      }
    case 'replay-bookmark':
      return {
        title: event.title?.trim() || 'Replay bookmark',
        body: event.statement?.trim() || `A replay bookmark was recorded${lapSuffix(event)}.`,
        baseRank: 0.6
      }
    case 'media-mark':
      return {
        title: event.title?.trim() || 'Media mark',
        body: event.statement?.trim() || `A media mark was recorded${lapSuffix(event)}.`,
        baseRank: 0.6
      }
    case 'explicit': {
      const title = event.title?.trim()
      const body = event.statement?.trim()
      if (!title || !body) return null
      return {
        title,
        body,
        baseRank: clamp(factNumber(event.facts, 'rank') ?? 0.55, 0, 1)
      }
    }
    default:
      return null
  }
}

function normalizeEvidenceTimeMs(evidence: StoryEvidence): number {
  return evidence.clock.sourceTimeMs + evidence.clock.toSessionOffsetMs
}

function distanceToEventMs(event: StoryTimelineEvent, evidenceTimeMs: number): number {
  const start = event.sessionTimeMs
  const end = finite(event.endSessionTimeMs) ? Math.max(start, event.endSessionTimeMs) : start
  if (evidenceTimeMs < start) return start - evidenceTimeMs
  if (evidenceTimeMs > end) return evidenceTimeMs - end
  return 0
}

function validateEvidence(
  event: StoryTimelineEvent,
  evidence: StoryEvidence
): StoryGenerationIssue | null {
  if (
    typeof evidence.id !== 'string' ||
    !evidence.id.trim() ||
    !STORY_SOURCES.has(evidence.source) ||
    !STORY_EVENT_TYPES.has(evidence.eventType) ||
    typeof evidence.statement !== 'string' ||
    !evidence.statement.trim() ||
    !CONTENT_HASH_RE.test(evidence.contentHash ?? '') ||
    evidence.contentCommitted !== true ||
    typeof evidence.schemaFingerprint !== 'string' ||
    !evidence.schemaFingerprint.trim() ||
    typeof evidence.origin?.producer !== 'string' ||
    !evidence.origin.producer.trim() ||
    typeof evidence.origin?.version !== 'string' ||
    !evidence.origin.version.trim() ||
    !Array.isArray(evidence.transformLineage) ||
    evidence.transformLineage.some((item) => typeof item !== 'string' || !item.trim()) ||
    !finite(evidence.captureRange?.start) ||
    !finite(evidence.captureRange?.end) ||
    evidence.captureRange.end < evidence.captureRange.start ||
    !STORY_CAPTURE_UNITS.has(evidence.captureRange?.unit) ||
    !STORY_CLOCKS.has(evidence.clock?.clock) ||
    !finite(evidence.clock?.sourceTimeMs) ||
    !finite(evidence.clock?.toSessionOffsetMs) ||
    !STORY_PRIVACY_CLASSES.has(evidence.privacyClass) ||
    !STORY_RIGHTS_STATES.has(evidence.rights?.state) ||
    !STORY_RIGHTS_SCOPES.has(evidence.rights?.scope) ||
    !finite(evidence.rights?.checkedAt) ||
    (evidence.rights.expiresAt !== undefined && !finite(evidence.rights.expiresAt)) ||
    !STORY_CONSENT_STATES.has(evidence.consent?.state) ||
    !Number.isSafeInteger(evidence.consent?.epoch) ||
    evidence.consent.epoch < 0 ||
    !finite(evidence.consent?.checkedAt) ||
    (evidence.consent.expiresAt !== undefined && !finite(evidence.consent.expiresAt)) ||
    !isClaim(evidence.claim) ||
    !isFactMap(evidence.facts) ||
    (evidence.replayState !== undefined && !STORY_REPLAY_STATES.has(evidence.replayState)) ||
    (evidence.pii !== undefined && (
      !Array.isArray(evidence.pii) ||
      evidence.pii.some((item) =>
        !item ||
        !STORY_PII_KINDS.has(item.kind) ||
        typeof item.value !== 'string' ||
        !item.value.trim() ||
        item.value.length > 500
      )
    )) ||
    !STORY_PII_ATTESTATION_STATUSES.has(evidence.piiAttestation?.status) ||
    typeof evidence.piiAttestation?.method !== 'string' ||
    !evidence.piiAttestation.method.trim() ||
    !finite(evidence.piiAttestation?.checkedAt) ||
    (evidence.integrityFlags !== undefined && (
      !Array.isArray(evidence.integrityFlags) ||
      evidence.integrityFlags.some((flag) => ![
        'stale',
        'gap',
        'derived',
        'redacted',
        'externally-attested',
        'missing',
        'corrupt'
      ].includes(flag))
    ))
  ) {
    return {
      code: 'invalid-evidence',
      message: `Linked evidence is incomplete, invalid, or not committed for ${opaqueRef('event', event.id)}.`,
      eventIds: [opaqueRef('event', event.id)],
      evidenceIds: evidence.id ? [opaqueRef('evidence', evidence.id)] : undefined
    }
  }
  if (
    !finite(evidence.confidence?.score) ||
    evidence.confidence.score < 0 ||
    evidence.confidence.score > 1 ||
    typeof evidence.confidence?.method !== 'string' ||
    !evidence.confidence.method.trim()
  ) {
    return {
      code: 'missing-confidence',
      message: `Evidence ${opaqueRef('evidence', evidence.id)} has no valid confidence value and method.`,
      eventIds: [opaqueRef('event', event.id)],
      evidenceIds: [opaqueRef('evidence', evidence.id)]
    }
  }
  const integrityFlags = evidence.integrityFlags ?? []
  if (integrityFlags.some((flag) => INVALID_INTEGRITY_FLAGS.has(flag))) {
    return {
      code: 'invalid-evidence',
      message: `Evidence ${opaqueRef('evidence', evidence.id)} is stale, gapped, missing, or corrupt.`,
      eventIds: [opaqueRef('event', event.id)],
      evidenceIds: [opaqueRef('evidence', evidence.id)]
    }
  }
  const piiTokens = evidence.pii ?? []
  if (
    (evidence.piiAttestation.status === 'pii-declared' && piiTokens.length === 0) ||
    (evidence.piiAttestation.status === 'none-detected' && piiTokens.length > 0)
  ) {
    return {
      code: 'invalid-evidence',
      message: `Evidence ${opaqueRef('evidence', evidence.id)} has inconsistent PII attestation metadata.`,
      eventIds: [opaqueRef('event', event.id)],
      evidenceIds: [opaqueRef('evidence', evidence.id)]
    }
  }
  const piiScanText = [
    evidence.statement,
    typeof evidence.claim.value === 'string' ? evidence.claim.value : '',
    ...Object.values(evidence.facts ?? {}).filter((value): value is string => typeof value === 'string')
  ].join('\n')
  const detectedPiiKinds = detectAutomaticPiiKinds(piiScanText)
  if (evidence.piiAttestation.status === 'none-detected' && detectedPiiKinds.length > 0) {
    return {
      code: 'invalid-evidence',
      message: `Evidence ${opaqueRef('evidence', evidence.id)} failed PII attestation (${detectedPiiKinds.join(', ')} detected).`,
      eventIds: [opaqueRef('event', event.id)],
      evidenceIds: [opaqueRef('evidence', evidence.id)]
    }
  }
  const normalized = normalizeEvidenceTimeMs(evidence)
  const uncertainty = finite(evidence.clock.uncertaintyMs) ? Math.max(0, evidence.clock.uncertaintyMs) : 0
  if (distanceToEventMs(event, normalized) > STORY_TIMELINE_TOLERANCE_MS + uncertainty) {
    return {
      code: 'timeline-mismatch',
      message: `Evidence ${opaqueRef('evidence', evidence.id)} does not align with ${opaqueRef('event', event.id)} after applying its explicit clock offset.`,
      eventIds: [opaqueRef('event', event.id)],
      evidenceIds: [opaqueRef('evidence', evidence.id)]
    }
  }
  return null
}

function validateEventSemantics(event: StoryTimelineEvent): StoryGenerationIssue | null {
  const predicates = STORY_EVENT_PREDICATES[event.type]
  if (predicates && !predicates.has(event.claim.predicate)) {
    return {
      code: 'invalid-event',
      message: `${opaqueRef('event', event.id)} uses a claim predicate that does not match ${event.type}.`,
      eventIds: [opaqueRef('event', event.id)]
    }
  }
  if (event.type === 'fastest-lap') {
    const lapTimeSec = factNumber(event.facts, 'lapTimeSec')
    const bestLapTimeSec = factNumber(event.facts, 'bestLapTimeSec')
    const fastestScope = factString(event.facts, 'fastestScope')
    const explicitSessionBest =
      event.claim.predicate === 'recorded-fastest-lap-time' &&
      fastestScope === 'session-best' &&
      lapTimeSec !== undefined &&
      bestLapTimeSec !== undefined &&
      lapTimeSec === bestLapTimeSec
    const observedSinceCapture =
      event.claim.predicate === 'fastest-observed-since-capture' &&
      fastestScope === 'since-capture' &&
      lapTimeSec !== undefined
    if (!explicitSessionBest && !observedSinceCapture) {
      return {
        code: 'invalid-event',
        message: `${opaqueRef('event', event.id)} lacks explicit session-best equality or since-capture scope.`,
        eventIds: [opaqueRef('event', event.id)]
      }
    }
  }
  const expectedClaimValue = (() => {
    switch (event.type) {
      case 'position-change':
        return event.facts.toPosition
      case 'fastest-lap':
      case 'lap-complete':
        return event.facts.lapTimeSec
      case 'finish':
        return event.facts.position
      case 'incident':
        return typeof event.facts.incidentType === 'string' && typeof event.facts.severity === 'string'
          ? `${event.facts.incidentType}:${event.facts.severity}`
          : undefined
      case 'incident-count':
        return event.facts.toCount
      case 'flag':
        return event.facts.flag
      case 'pit-stop':
        return true
      default:
        return undefined
    }
  })()
  if (
    expectedClaimValue !== undefined &&
    stableSerialize(event.claim.value) !== stableSerialize(expectedClaimValue)
  ) {
    return {
      code: 'invalid-event',
      message: `${opaqueRef('event', event.id)} has a claim value that contradicts its rendered facts.`,
      eventIds: [opaqueRef('event', event.id)]
    }
  }
  const template = storyTemplate(event)
  if (!template) {
    return {
      code: 'invalid-event',
      message: `${opaqueRef('event', event.id)} does not contain the explicit facts required by ${event.type}.`,
      eventIds: [opaqueRef('event', event.id)]
    }
  }
  if (CAUSAL_LANGUAGE_RE.test(`${template.title} ${template.body}`)) {
    return {
      code: 'causal-language',
      message: `${opaqueRef('event', event.id)} contains causal wording and was not surfaced.`,
      eventIds: [opaqueRef('event', event.id)]
    }
  }
  return null
}

function validateEvidenceBinding(
  event: StoryTimelineEvent,
  evidence: readonly StoryEvidence[]
): StoryGenerationIssue | null {
  const semanticIssue = validateEventSemantics(event)
  if (semanticIssue) return semanticIssue
  if (evidence.some((item) =>
    item.consent.state !== 'not-required' &&
    (!item.consent.subjectRef || item.consent.subjectRef !== event.claim.subjectRef)
  )) {
    return {
      code: 'invalid-evidence',
      message: `Consent metadata for ${opaqueRef('event', event.id)} is not scoped to the claim subject.`,
      eventIds: [opaqueRef('event', event.id)],
      evidenceIds: evidence.map((item) => opaqueRef('evidence', item.id))
    }
  }
  if (evidence.some((item) => item.eventType !== event.type)) {
    return {
      code: 'invalid-evidence',
      message: `Evidence linked to ${opaqueRef('event', event.id)} does not attest event type ${event.type}.`,
      eventIds: [opaqueRef('event', event.id)],
      evidenceIds: evidence.map((item) => opaqueRef('evidence', item.id))
    }
  }
  if (evidence.some((item) => stableSerialize(item.claim) !== stableSerialize(event.claim))) {
    return {
      code: 'invalid-evidence',
      message: `Evidence linked to ${opaqueRef('event', event.id)} does not attest the event claim.`,
      eventIds: [opaqueRef('event', event.id)],
      evidenceIds: evidence.map((item) => opaqueRef('evidence', item.id))
    }
  }

  const renderedFacts: StoryFactMap = { ...event.facts }
  if (finite(event.lap)) renderedFacts.lap = Math.max(0, Math.trunc(event.lap))
  if (
    (event.type === 'explicit' || event.type === 'replay-bookmark' || event.type === 'media-mark') &&
    event.title?.trim()
  ) {
    renderedFacts.title = event.title.trim()
  }
  if (
    (event.type === 'explicit' || event.type === 'replay-bookmark' || event.type === 'media-mark') &&
    event.statement?.trim()
  ) {
    renderedFacts.statement = event.statement.trim()
  }

  for (const [key, expected] of Object.entries(renderedFacts)) {
    const observed = evidence
      .filter((item) => item.facts && Object.prototype.hasOwnProperty.call(item.facts, key))
      .map((item) => item.facts?.[key] as StoryFactValue)
    if (observed.length === 0) {
      return {
        code: 'invalid-evidence',
        message: `Evidence for ${opaqueRef('event', event.id)} does not contain rendered fact ${key}.`,
        eventIds: [opaqueRef('event', event.id)],
        evidenceIds: evidence.map((item) => opaqueRef('evidence', item.id))
      }
    }
    const values = new Set(observed.map(stableSerialize))
    if (values.size > 1) {
      return {
        code: 'contradictory-events',
        message: `Evidence for ${opaqueRef('event', event.id)} contradicts rendered fact ${key}.`,
        eventIds: [opaqueRef('event', event.id)],
        evidenceIds: evidence.map((item) => opaqueRef('evidence', item.id))
      }
    }
    if (!observed.some((value) => stableSerialize(value) === stableSerialize(expected))) {
      return {
        code: 'invalid-evidence',
        message: `Evidence for ${opaqueRef('event', event.id)} does not support rendered fact ${key}.`,
        eventIds: [opaqueRef('event', event.id)],
        evidenceIds: evidence.map((item) => opaqueRef('evidence', item.id))
      }
    }
  }
  return null
}

function explicitRedactionRules(evidence: readonly StoryEvidence[]): RedactionRule[] {
  const rules: RedactionRule[] = []
  const tokens = evidence.flatMap((item) =>
    (item.pii ?? []).map((pii) => ({
      evidenceId: item.id,
      pii,
      value: pii.value?.normalize('NFC').trim() ?? ''
    }))
  )
    .filter((item) => item.value.length > 0)
    .sort((left, right) => right.value.length - left.value.length)
  for (const { evidenceId, pii, value } of tokens) {
    const replacement =
      pii.kind === 'name'
        ? '[driver]'
        : pii.kind === 'account-id'
          ? '[account]'
          : pii.kind === 'other'
            ? '[redacted]'
            : `[${pii.kind}]`
    rules.push({
      kind: pii.kind,
      pattern: pii.kind === 'email'
        ? explicitMailboxPattern(value)
        : new RegExp(escapeRegExp(value), 'gi'),
      replacement,
      reason: 'explicit-pii',
      evidenceRef: opaqueRef('evidence', evidenceId),
      priority: pii.kind === 'email' ? 110 : pii.kind === 'name' || pii.kind === 'other' ? 20 : 80
    })
  }
  return rules
}

function isIpv4Token(value: string): boolean {
  const octets = value.split('.')
  return octets.length === 4 && octets.every((octet) => {
    if (!/^\d{1,3}$/.test(octet)) return false
    const number = Number(octet)
    return number >= 0 && number <= 255
  })
}

function isIpv6Token(value: string): boolean {
  if (!value.includes(':')) return false
  const mixedMatch = value.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)
  const ipv4Segments = mixedMatch ? 2 : 0
  if (mixedMatch && !isIpv4Token(mixedMatch[1])) return false
  let hextetPart = mixedMatch ? value.slice(0, -mixedMatch[1].length) : value
  if (hextetPart.endsWith(':') && !hextetPart.endsWith('::')) hextetPart = hextetPart.slice(0, -1)
  if (!/^[A-Fa-f0-9:]+$/.test(hextetPart)) return false
  const compressedParts = hextetPart.split('::')
  if (compressedParts.length > 2) return false
  const segments = (part: string): string[] => part ? part.split(':') : []
  const validSegments = (items: string[]): boolean =>
    items.every((item) => /^[A-Fa-f0-9]{1,4}$/.test(item))
  if (compressedParts.length === 2) {
    const left = segments(compressedParts[0])
    const right = segments(compressedParts[1])
    return validSegments(left) && validSegments(right) && left.length + right.length + ipv4Segments < 8
  }
  const full = segments(hextetPart)
  return full.length + ipv4Segments === 8 && validSegments(full)
}

function ipv6RedactionRules(text: string): RedactionRule[] {
  const normalized = text.normalize('NFC')
  const tokens = new Set(
    [
      ...(normalized.match(/[A-Fa-f0-9:]+(?:\d{1,3}\.){3}\d{1,3}/g) ?? []),
      ...(normalized.match(/[A-Fa-f0-9:]{2,}/g) ?? [])
    ]
      .map((value) => value.trim())
      .filter(isIpv6Token)
  )
  return [...tokens]
    .sort((left, right) => right.length - left.length)
    .map((token) => ({
      kind: 'ip' as const,
      pattern: new RegExp(escapeRegExp(token), 'gi'),
      replacement: '[ip]',
      reason: 'pattern-detected' as const,
      priority: 100
    }))
}

function normalizeAutomaticPiiScanText(text: string): string {
  return text.normalize('NFC').replace(/\p{Pd}/gu, '-')
}

const EMAIL_ASCII_ATEXT_SOURCE = String.raw`[A-Z0-9!#$%&'*+/=?^_\x60{|}~-]`
const EMAIL_UTF8_NON_ASCII_SOURCE = String.raw`[^\x00-\x7F]`
const EMAIL_ATEXT_SOURCE =
  String.raw`(?:${EMAIL_ASCII_ATEXT_SOURCE}|${EMAIL_UTF8_NON_ASCII_SOURCE})`
const EMAIL_LOCAL_BOUNDARY_SOURCE =
  String.raw`(?:[A-Z0-9!#$%&'*+/=?^_\x60{|}~.-]|${EMAIL_UTF8_NON_ASCII_SOURCE})`
const EMAIL_DOMAIN_EDGE_SOURCE = String.raw`[\p{L}\p{M}\p{N}]`
const EMAIL_DOMAIN_INTERIOR_SOURCE =
  String.raw`(?:[\p{L}\p{M}\p{N}-]|(?<=l)\u00B7(?=l))`
const EMAIL_DOMAIN_LABEL_SOURCE =
  String.raw`${EMAIL_DOMAIN_EDGE_SOURCE}(?:${EMAIL_DOMAIN_INTERIOR_SOURCE}{0,61}${EMAIL_DOMAIN_EDGE_SOURCE})?`
const EMAIL_U_LABEL_TLD_SOURCE =
  String.raw`${EMAIL_DOMAIN_EDGE_SOURCE}${EMAIL_DOMAIN_INTERIOR_SOURCE}{0,61}${EMAIL_DOMAIN_EDGE_SOURCE}`
const EMAIL_TLD_SOURCE =
  String.raw`(?:xn--[A-Z0-9](?:[A-Z0-9-]{0,57}[A-Z0-9])?|${EMAIL_U_LABEL_TLD_SOURCE})`
const EMAIL_EXPLICIT_DOMAIN_CONTINUATION_SOURCE =
  String.raw`(?:[\p{L}\p{M}\p{N}\u00B7-]|\.(?=[\p{L}\p{M}\p{N}]))`

function completeMailboxPattern(): RegExp {
  return new RegExp(
    String.raw`(?<!${EMAIL_LOCAL_BOUNDARY_SOURCE})${EMAIL_ATEXT_SOURCE}+(?:\.${EMAIL_ATEXT_SOURCE}+)*@(?:${EMAIL_DOMAIN_LABEL_SOURCE}\.)+${EMAIL_TLD_SOURCE}(?![\p{L}\p{M}\p{N}\u00B7-])`,
    'giu'
  )
}

function explicitMailboxPattern(value: string): RegExp {
  return new RegExp(
    String.raw`(?<!${EMAIL_LOCAL_BOUNDARY_SOURCE})${escapeRegExp(value)}(?!${EMAIL_EXPLICIT_DOMAIN_CONTINUATION_SOURCE})`,
    'giu'
  )
}

function automaticRedactionRules(text = ''): RedactionRule[] {
  const normalized = text.normalize('NFC')
  const emailRules: RedactionRule[] = normalized.includes('@')
    ? [{
        kind: 'email',
        pattern: completeMailboxPattern(),
        replacement: '[email]',
        reason: 'pattern-detected',
        priority: 90
      }]
    : []
  return [
    ...emailRules,
    ...ipv6RedactionRules(normalized),
    {
      kind: 'ip',
      pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
      replacement: '[ip]',
      reason: 'pattern-detected',
      priority: 70
    },
    {
      kind: 'phone',
      pattern: /(?<![\p{L}\p{N}.])(?:\+\p{Nd}{1,3}[\s().\p{Pd}]*)?(?:\p{Nd}[\s().\p{Pd}]*){8,14}\p{Nd}(?![\p{L}\p{N}])/gu,
      replacement: '[phone]',
      reason: 'pattern-detected',
      priority: 90
    }
  ]
}

function detectAutomaticPiiKinds(text: string): StoryPiiToken['kind'][] {
  const normalized = normalizeAutomaticPiiScanText(text)
  const kinds = new Set<StoryPiiToken['kind']>()
  for (const rule of automaticRedactionRules(normalized)) {
    rule.pattern.lastIndex = 0
    if (rule.pattern.test(normalized)) kinds.add(rule.kind)
  }
  return [...kinds]
}

function redactStoryText(
  title: string,
  body: string,
  evidence: readonly StoryEvidence[]
): { title: string; body: string; redactions: StoryRedaction[] } {
  let safeTitle = title.normalize('NFC')
  let safeBody = body.normalize('NFC')
  const redactions: StoryRedaction[] = []
  const seen = new Set<string>()
  const explicitRules = explicitRedactionRules(evidence)
  const rules = [
    ...automaticRedactionRules(`${safeTitle}\n${safeBody}`),
    ...explicitRules
  ].sort((left, right) => right.priority - left.priority)
  for (const rule of rules) {
    rule.pattern.lastIndex = 0
    const titleMatched = rule.pattern.test(safeTitle)
    rule.pattern.lastIndex = 0
    const bodyMatched = rule.pattern.test(safeBody)
    rule.pattern.lastIndex = 0
    if (!titleMatched && !bodyMatched) continue
    safeTitle = safeTitle.replace(rule.pattern, rule.replacement)
    rule.pattern.lastIndex = 0
    safeBody = safeBody.replace(rule.pattern, rule.replacement)
    const key = `${rule.kind}:${rule.replacement}:${rule.evidenceRef ?? ''}`
    if (!seen.has(key)) {
      seen.add(key)
      redactions.push({
        kind: rule.kind,
        replacement: rule.replacement,
        reason: rule.reason,
        evidenceRef: rule.evidenceRef
      })
    }
  }
  return { title: safeTitle, body: safeBody, redactions }
}

function policySnapshot(
  evidence: readonly StoryEvidence[],
  redactions: readonly StoryRedaction[]
): StoryPolicySnapshot {
  let rightsState: StoryRightsState = 'cleared'
  let rightsScope: StoryRightsScope = 'public'
  let consentState: StoryConsentState = 'not-required'
  let privacyClass: StoryPrivacyClass = 'D0'
  let policyCheckedAt = Number.POSITIVE_INFINITY
  let expiresAt: number | undefined

  for (const item of evidence) {
    const itemRightsState = STORY_RIGHTS_STATES.has(item.rights.state) ? item.rights.state : 'prohibited'
    const itemRightsScope = STORY_RIGHTS_SCOPES.has(item.rights.scope) ? item.rights.scope : 'prohibited'
    const itemPrivacyClass = STORY_PRIVACY_CLASSES.has(item.privacyClass) ? item.privacyClass : 'D5'
    const itemConsentState = STORY_CONSENT_STATES.has(item.consent.state) ? item.consent.state : 'revoked'
    if (RIGHTS_RANK[itemRightsState] > RIGHTS_RANK[rightsState]) rightsState = itemRightsState
    if (SCOPE_RANK[itemRightsScope] < SCOPE_RANK[rightsScope]) rightsScope = itemRightsScope
    if (PRIVACY_RANK[itemPrivacyClass] > PRIVACY_RANK[privacyClass]) privacyClass = itemPrivacyClass
    policyCheckedAt = Math.min(policyCheckedAt, item.rights.checkedAt, item.consent.checkedAt)
    for (const expiry of [item.rights.expiresAt, item.consent.expiresAt]) {
      if (finite(expiry)) expiresAt = expiresAt === undefined ? expiry : Math.min(expiresAt, expiry)
    }
    if (CONSENT_RANK[itemConsentState] > CONSENT_RANK[consentState]) {
      consentState = itemConsentState
    } else if (consentState === 'not-required' && itemConsentState === 'granted') {
      consentState = 'granted'
    }
  }

  const authorizationRef = opaqueRef('authorization', stableSerialize(
    evidence.map((item) => ({
      rights: {
        state: item.rights.state,
        scope: item.rights.scope,
        ownerRef: item.rights.ownerRef,
        checkedAt: item.rights.checkedAt,
        expiresAt: item.rights.expiresAt
      },
      consent: {
        state: item.consent.state,
        subjectRef: item.consent.subjectRef,
        epoch: item.consent.epoch,
        checkedAt: item.consent.checkedAt,
        expiresAt: item.consent.expiresAt
      },
      piiAttestation: {
        status: item.piiAttestation.status,
        method: item.piiAttestation.method,
        checkedAt: item.piiAttestation.checkedAt
      }
    }))
  ))

  return {
    rightsState,
    rightsScope,
    consentState,
    authorizationRef,
    privacyClass,
    policyCheckedAt: Number.isFinite(policyCheckedAt) ? policyCheckedAt : 0,
    expiresAt,
    piiRedacted: redactions.length > 0
  }
}

function destinationPreview(
  destination: StoryDestination,
  title: string,
  body: string,
  policy: StoryPolicySnapshot,
  now: number
): StoryDestinationPreview {
  const reasons: string[] = []
  if (policy.rightsState !== 'cleared') reasons.push(`rights:${policy.rightsState}`)
  if (policy.rightsScope === 'prohibited' || SCOPE_RANK[policy.rightsScope] < DESTINATION_SCOPE[destination]) {
    reasons.push(`scope:${policy.rightsScope}`)
  }
  if (finite(policy.expiresAt) && policy.expiresAt <= now) reasons.push('policy:expired')
  if (policy.consentState === 'revoked') reasons.push('consent:revoked')
  if (policy.consentState === 'unknown' && destination !== 'local') reasons.push('consent:unknown')
  if (destination !== 'local' && PRIVACY_RANK[policy.privacyClass] >= PRIVACY_RANK.D3) {
    reasons.push(`privacy:${policy.privacyClass}`)
  }
  const blocked = reasons.length > 0
  return {
    destination,
    status: blocked ? 'blocked' : policy.piiRedacted ? 'redacted' : 'ready',
    title,
    body,
    reasons,
    streamSafe: !blocked && PRIVACY_RANK[policy.privacyClass] <= PRIVACY_RANK.D2,
    publication: 'preview-only'
  }
}

function isStructurallyValidEvent(value: unknown): value is StoryTimelineEvent {
  const event = value as Partial<StoryTimelineEvent> | null
  return Boolean(
    event &&
    typeof event.id === 'string' &&
    event.id.trim() &&
    STORY_EVENT_TYPES.has(event.type as StoryEventType) &&
    (event.eventClass === 'fact' || event.eventClass === 'inference' || event.eventClass === 'recommendation') &&
    finite(event.sessionTimeMs) &&
    (event.endSessionTimeMs === undefined || finite(event.endSessionTimeMs)) &&
    typeof event.assertionId === 'string' &&
    event.assertionId.trim() &&
    isClaim(event.claim) &&
    isFactMap(event.facts) &&
    Array.isArray(event.evidenceRefs) &&
    event.evidenceRefs.every((id) => typeof id === 'string' && id.trim()) &&
    (event.title === undefined || typeof event.title === 'string') &&
    (event.statement === undefined || typeof event.statement === 'string') &&
    (event.supersedesEventId === undefined || typeof event.supersedesEventId === 'string')
  )
}

function canonicalClaimIdentity(event: StoryTimelineEvent): string {
  switch (event.type) {
    case 'finish':
      return 'terminal-classification-position'
    case 'fastest-lap':
      return 'fastest-lap-time'
    case 'position-change':
      return 'position-at-observed-time'
    case 'lap-complete':
      return 'completed-lap-time'
    case 'incident':
      return 'incident-classification'
    case 'incident-count':
      return 'incident-count-at-observed-time'
    case 'flag':
      return 'flag-state'
    case 'pit-stop':
      return 'pit-road-state'
    default:
      return event.claim.predicate.trim().toLowerCase().replace(/\s+/g, '-')
  }
}

function canonicalTemporalScope(event: StoryTimelineEvent): string {
  if (event.type === 'finish') return 'session-terminal'
  if ((event.type === 'lap-complete' || event.type === 'fastest-lap') && finite(event.lap)) {
    return `lap:${Math.trunc(event.lap)}`
  }
  const start = Math.round(event.sessionTimeMs)
  const end = finite(event.endSessionTimeMs) ? Math.round(Math.max(event.sessionTimeMs, event.endSessionTimeMs)) : start
  return `${start}:${end}`
}

function canonicalClaimKey(event: StoryTimelineEvent): string {
  return stableSerialize({
    identity: canonicalClaimIdentity(event),
    subject: event.claim.subjectRef.trim().toLowerCase(),
    temporalScope: canonicalTemporalScope(event)
  })
}

function canonicalClaimPayload(event: StoryTimelineEvent): string {
  const semanticFacts: Record<string, unknown> = (() => {
    switch (event.type) {
      case 'position-change':
        return {
          fromPosition: event.facts.fromPosition,
          toPosition: event.facts.toPosition
        }
      case 'fastest-lap':
      case 'lap-complete':
        return { lapTimeSec: event.facts.lapTimeSec }
      case 'finish':
        return {
          position: event.facts.position,
          totalCars: event.facts.totalCars,
          resultKind: event.facts.resultKind
        }
      case 'incident':
        return {
          incidentType: event.facts.incidentType,
          severity: event.facts.severity
        }
      case 'incident-count':
        return {
          fromCount: event.facts.fromCount,
          toCount: event.facts.toCount
        }
      case 'flag':
        return { flag: event.facts.flag }
      case 'pit-stop':
        return { inPitRoad: true }
      default:
        return {
          claimValue: event.claim.value,
          title: event.title ?? null,
          statement: event.statement ?? null
        }
    }
  })()
  return stableSerialize({
    claimValue: event.claim.value,
    lap: finite(event.lap) ? Math.trunc(event.lap) : null,
    semanticFacts
  })
}

function contradictionState(
  events: readonly StoryTimelineEvent[],
  validSuperseders: ReadonlySet<string>
): {
  superseded: Set<string>
  contradictory: Set<string>
  issues: StoryGenerationIssue[]
} {
  const superseded = new Set<string>()
  const contradictory = new Set<string>()
  const issues: StoryGenerationIssue[] = []
  const byClaim = new Map<string, StoryTimelineEvent[]>()
  for (const event of events) {
    if (
      !isStructurallyValidEvent(event) ||
      event.eventClass !== 'fact' ||
      validateEventSemantics(event) !== null
    ) {
      continue
    }
    const claimKey = canonicalClaimKey(event)
    const list = byClaim.get(claimKey) ?? []
    list.push(event)
    byClaim.set(claimKey, list)
    if (event.supersedesEventId && validSuperseders.has(event.id)) superseded.add(event.supersedesEventId)
  }
  for (const [claimKey, group] of byClaim) {
    const active = group.filter((event) => !superseded.has(event.id))
    const values = new Set(active.map(canonicalClaimPayload))
    if (values.size <= 1) continue
    for (const event of active) contradictory.add(event.id)
    issues.push({
      code: 'contradictory-events',
      message: `Canonical claim ${opaqueRef('claim', claimKey)} has contradictory active facts and was not surfaced.`,
      eventIds: active.map((event) => opaqueRef('event', event.id))
    })
  }
  return { superseded, contradictory, issues }
}

function candidateFromEvent(
  timeline: StoryRaceTimeline,
  event: StoryTimelineEvent,
  evidence: readonly StoryEvidence[],
  now: number
): { card?: StoryCard; issue?: StoryGenerationIssue } {
  const template = storyTemplate(event)
  if (!template) {
    return {
      issue: {
        code: 'invalid-event',
        message: `${opaqueRef('event', event.id)} does not contain the explicit facts required by ${event.type}.`,
        eventIds: [opaqueRef('event', event.id)]
      }
    }
  }
  if (CAUSAL_LANGUAGE_RE.test(`${template.title} ${template.body}`)) {
    return {
      issue: {
        code: 'causal-language',
        message: `${opaqueRef('event', event.id)} contains causal wording and was not surfaced.`,
        eventIds: [opaqueRef('event', event.id)]
      }
    }
  }

  const safe = redactStoryText(template.title, template.body, evidence)
  const policy = policySnapshot(evidence, safe.redactions)
  const previews = DESTINATIONS.map((destination) =>
    destinationPreview(destination, safe.title, safe.body, policy, now)
  )
  const confidenceScore = Math.min(...evidence.map((item) => item.confidence.score))
  const confidenceLevel: StoryCard['confidence']['level'] =
    confidenceScore >= 0.85 ? 'high' : confidenceScore >= 0.65 ? 'medium' : 'low'
  const priority = clamp(finite(event.priority) ? event.priority : 0.5, 0, 1)
  const rank = clamp(template.baseRank * 0.7 + confidenceScore * 0.2 + priority * 0.1, 0, 1)
  const provenance: StoryEvidenceProvenance[] = evidence.map((item) => ({
    id: opaqueRef('evidence', item.id),
    source: item.source,
    contentHash: canonicalContentHash(item.contentHash),
    contentLocator: item.contentLocator ? opaqueRef(`${item.source}-locator`, item.contentLocator) : undefined,
    contentCommitted: item.contentCommitted,
    schemaFingerprint: opaqueRef('schema', item.schemaFingerprint),
    captureRange: item.captureRange,
    origin: {
      producer: opaqueRef('producer', item.origin.producer),
      version: opaqueRef('version', item.origin.version)
    },
    transformLineage: item.transformLineage.map((transform) => opaqueRef('transform', transform)),
    confidenceMethod: opaqueRef('confidence-method', item.confidence.method),
    normalizedSessionTimeMs: normalizeEvidenceTimeMs(item),
    clockOffsetMs: item.clock.toSessionOffsetMs,
    clockUncertaintyMs: finite(item.clock.uncertaintyMs) ? Math.max(0, item.clock.uncertaintyMs) : 0,
    integrityFlags: (item.integrityFlags ?? []).slice(),
    replayState: item.replayState
  }))
  const dedupeMaterial = {
    sessionRef: timeline.sessionRef,
    eventType: event.type,
    claim: event.claim,
    title: safe.title,
    body: safe.body,
    lap: event.lap,
    evidenceHashes: provenance.map((item) => item.contentHash).sort()
  }
  const dedupeKey = `story-dedupe-v1:${shortHash(dedupeMaterial)}`
  const sessionRef = opaqueRef('session', timeline.sessionRef)
  const timelineId = opaqueRef('timeline', timeline.id)
  const observedInterval = {
    startSessionTimeMs: event.sessionTimeMs,
    endSessionTimeMs: finite(event.endSessionTimeMs) ? Math.max(event.sessionTimeMs, event.endSessionTimeMs) : event.sessionTimeMs
  }
  const lap = finite(event.lap) ? Math.max(0, Math.trunc(event.lap)) : undefined
  const confidence: StoryCard['confidence'] = {
    score: confidenceScore,
    level: confidenceLevel,
    method: 'minimum-explicit-evidence-v1',
    reasons: [
      `${evidence.length} explicit evidence item${evidence.length === 1 ? '' : 's'}`,
      'minimum source confidence; no causal inference'
    ]
  }
  const revision = shortHash({
    dedupeKey,
    sessionRef,
    timelineId,
    eventType: event.type,
    observedInterval,
    lap,
    title: safe.title,
    body: safe.body,
    rank,
    confidence,
    redactions: safe.redactions,
    policy,
    provenance,
    previews
  })

  return {
    card: {
      id: `story-${shortHash(dedupeKey)}`,
      dedupeKey,
      revision,
      sessionRef,
      timelineId,
      eventType: event.type,
      eventIds: [opaqueRef('event', event.id)],
      createdAt: now,
      observedInterval,
      lap,
      title: safe.title,
      body: safe.body,
      rank,
      confidence,
      provenance,
      redactions: safe.redactions,
      policy,
      previews,
      status: 'candidate'
    }
  }
}

export function storyPreview(
  card: StoryCard,
  destination: StoryDestination
): StoryDestinationPreview | undefined {
  return card.previews.find((preview) => preview.destination === destination)
}

export function storyApprovalBlockReason(
  card: StoryCard,
  destination: StoryDestination,
  now = Date.now()
): string | null {
  const preview = storyPreview(card, destination)
  if (!preview || preview.status === 'blocked') return preview?.reasons.join(', ') || 'destination:blocked'
  if (finite(card.policy.expiresAt) && card.policy.expiresAt <= now) return 'policy:expired'
  if (card.policy.rightsState !== 'cleared') return `rights:${card.policy.rightsState}`
  if (card.policy.consentState === 'revoked') return 'consent:revoked'
  return null
}

export function generateStoryCards(
  timeline: StoryRaceTimeline,
  now = Date.now()
): StoryGenerationResult {
  const issues: StoryGenerationIssue[] = []
  const empty = (): StoryGenerationResult => ({
    timelineId: typeof timeline?.id === 'string' ? opaqueRef('timeline', timeline.id) : '',
    sessionRef: typeof timeline?.sessionRef === 'string' ? opaqueRef('session', timeline.sessionRef) : '',
    generatedAt: now,
    candidates: [],
    issues
  })

  if (timeline?.completed !== true) {
    issues.push({
      code: 'timeline-not-complete',
      message: 'Story candidates are generated only from a completed post-race timeline.'
    })
    return empty()
  }
  if (
    typeof timeline.id !== 'string' ||
    !timeline.id.trim() ||
    typeof timeline.sessionRef !== 'string' ||
    !timeline.sessionRef.trim()
  ) {
    issues.push({
      code: 'invalid-event',
      message: 'Timeline identity is missing or invalid.'
    })
    return empty()
  }
  if (
    !Array.isArray(timeline.events) ||
    !Array.isArray(timeline.evidence) ||
    timeline.events.length > STORY_MAX_EVENTS ||
    timeline.evidence.length > STORY_MAX_EVIDENCE
  ) {
    issues.push({
      code: 'timeline-too-large',
      message: `Timeline exceeds the local limit of ${STORY_MAX_EVENTS} events and ${STORY_MAX_EVIDENCE} evidence items.`
    })
    return empty()
  }

  const duplicateRefs = (values: unknown[], prefix: string): string[] => {
    const seen = new Set<string>()
    const duplicates = new Set<string>()
    for (const value of values) {
      const id = value && typeof value === 'object'
        ? (value as { id?: unknown }).id
        : undefined
      if (typeof id !== 'string' || !id.trim()) continue
      if (seen.has(id)) duplicates.add(opaqueRef(prefix, id))
      seen.add(id)
    }
    return [...duplicates]
  }
  const duplicateEvidenceIds = duplicateRefs(timeline.evidence, 'evidence')
  const duplicateEventIds = duplicateRefs(timeline.events, 'event')
  if (duplicateEvidenceIds.length > 0 || duplicateEventIds.length > 0) {
    issues.push({
      code: 'invalid-evidence',
      message: 'Timeline contains duplicate event or evidence identifiers and was rejected.',
      eventIds: duplicateEventIds.length > 0 ? duplicateEventIds : undefined,
      evidenceIds: duplicateEvidenceIds.length > 0 ? duplicateEvidenceIds : undefined
    })
    return empty()
  }

  const evidenceById = new Map(
    timeline.evidence
      .filter((item): item is StoryEvidence => Boolean(item && typeof item.id === 'string'))
      .map((item) => [item.id, item])
  )
  const eventById = new Map(
    timeline.events
      .filter(isStructurallyValidEvent)
      .map((item) => [item.id, item])
  )
  const supersessionEdges = new Map<string, string>()
  for (const event of timeline.events) {
    if (!isStructurallyValidEvent(event) || event.eventClass !== 'fact' || !event.supersedesEventId) continue
    if (validateEventSemantics(event) !== null) continue
    const target = eventById.get(event.supersedesEventId)
    if (!target || canonicalClaimKey(target) !== canonicalClaimKey(event)) continue
    const evidence = event.evidenceRefs
      .map((id) => evidenceById.get(id))
      .filter((item): item is StoryEvidence => Boolean(item))
    if (evidence.length !== event.evidenceRefs.length) continue
    if (evidence.some((item) => validateEvidence(event, item) !== null)) continue
    if (validateEvidenceBinding(event, evidence) !== null) continue
    if (event.id === target.id) {
      issues.push({
        code: 'invalid-event',
        message: `${opaqueRef('event', event.id)} cannot supersede itself.`,
        eventIds: [opaqueRef('event', event.id)]
      })
      continue
    }
    supersessionEdges.set(event.id, target.id)
  }
  const cyclicSuperseders = new Set<string>()
  const reportedCycles = new Set<string>()
  for (const start of supersessionEdges.keys()) {
    const path: string[] = []
    const pathIndex = new Map<string, number>()
    let current: string | undefined = start
    while (current && supersessionEdges.has(current)) {
      const existingIndex = pathIndex.get(current)
      if (existingIndex !== undefined) {
        const cycle = path.slice(existingIndex)
        cycle.forEach((id) => cyclicSuperseders.add(id))
        const cycleKey = [...cycle].sort().join(':')
        if (!reportedCycles.has(cycleKey)) {
          reportedCycles.add(cycleKey)
          issues.push({
            code: 'invalid-event',
            message: 'Cyclic story-event supersession was rejected.',
            eventIds: cycle.map((id) => opaqueRef('event', id))
          })
        }
        break
      }
      pathIndex.set(current, path.length)
      path.push(current)
      current = supersessionEdges.get(current)
    }
  }
  const validSuperseders = new Set(
    [...supersessionEdges.keys()].filter((id) => !cyclicSuperseders.has(id))
  )
  const { superseded, contradictory, issues: contradictionIssues } = contradictionState(
    timeline.events,
    validSuperseders
  )
  issues.push(...contradictionIssues)
  const generated: StoryCard[] = []

  for (const event of timeline.events) {
    if (!event || typeof event.id !== 'string' || superseded.has(event.id) || contradictory.has(event.id)) continue
    const eventRef = opaqueRef('event', event.id)
    if (!isStructurallyValidEvent(event as unknown)) {
      issues.push({
        code: 'invalid-event',
        message: `${eventRef} has invalid event, claim, fact, or evidence metadata.`,
        eventIds: [eventRef]
      })
      continue
    }
    if (event.eventClass !== 'fact') {
      issues.push({
        code: 'non-fact-event',
        message: `${opaqueRef('event', event.id)} is ${event.eventClass}; the story engine surfaces explicit facts only.`,
        eventIds: [opaqueRef('event', event.id)]
      })
      continue
    }
    if (
      !finite(event.sessionTimeMs) ||
      !Array.isArray(event.evidenceRefs) ||
      event.evidenceRefs.length === 0
    ) {
      issues.push({
        code: 'missing-evidence',
        message: `${opaqueRef('event', event.id)} has no complete fact assertion and evidence references.`,
        eventIds: [opaqueRef('event', event.id)]
      })
      continue
    }
    const evidence = event.evidenceRefs.map((id) => evidenceById.get(id)).filter((item): item is StoryEvidence => Boolean(item))
    if (evidence.length !== event.evidenceRefs.length) {
      issues.push({
        code: 'missing-evidence',
        message: `${opaqueRef('event', event.id)} references evidence that is not present in the timeline.`,
        eventIds: [opaqueRef('event', event.id)],
        evidenceIds: event.evidenceRefs.map((id) => opaqueRef('evidence', id))
      })
      continue
    }
    const validationIssue = evidence
      .map((item) => validateEvidence(event, item))
      .find((issue): issue is StoryGenerationIssue => issue !== null)
    if (validationIssue) {
      issues.push(validationIssue)
      continue
    }
    const bindingIssue = validateEvidenceBinding(event, evidence)
    if (bindingIssue) {
      issues.push(bindingIssue)
      continue
    }
    const candidate = candidateFromEvent(timeline, event, evidence, now)
    if (candidate.issue) issues.push(candidate.issue)
    if (candidate.card) generated.push(candidate.card)
  }

  generated.sort((left, right) =>
    right.rank - left.rank ||
    left.observedInterval.startSessionTimeMs - right.observedInterval.startSessionTimeMs ||
    left.id.localeCompare(right.id)
  )

  const deduped: StoryCard[] = []
  const byDedupe = new Map<string, StoryCard>()
  const conflictedDedupe = new Set<string>()
  for (const card of generated) {
    if (conflictedDedupe.has(card.dedupeKey)) continue
    const existing = byDedupe.get(card.dedupeKey)
    if (existing) {
      if (existing.revision !== card.revision) {
        const index = deduped.findIndex((item) => item.dedupeKey === card.dedupeKey)
        if (index >= 0) deduped.splice(index, 1)
        byDedupe.delete(card.dedupeKey)
        conflictedDedupe.add(card.dedupeKey)
        issues.push({
          code: 'invalid-evidence',
          message: `Duplicate story candidate ${card.id} has conflicting policy, provenance, or review data and was not surfaced.`,
          eventIds: [...new Set([...existing.eventIds, ...card.eventIds])]
        })
        continue
      }
      existing.eventIds = [...new Set([...existing.eventIds, ...card.eventIds])]
      issues.push({
        code: 'duplicate-card',
        message: `Duplicate story candidate ${card.id} was collapsed.`,
        eventIds: card.eventIds
      })
      continue
    }
    byDedupe.set(card.dedupeKey, card)
    deduped.push(card)
  }

  const minuteCounts = new Map<number, number>()
  const surfaced: StoryCard[] = []
  for (const card of deduped) {
    const minute = Math.floor(Math.max(0, card.observedInterval.startSessionTimeMs) / 60_000)
    const count = minuteCounts.get(minute) ?? 0
    if (count >= STORY_MAX_CARDS_PER_MINUTE) {
      issues.push({
        code: 'spam-cap',
        message: `Card ${card.id} was not surfaced because minute ${minute} already has ${STORY_MAX_CARDS_PER_MINUTE} cards.`,
        eventIds: card.eventIds
      })
      continue
    }
    minuteCounts.set(minute, count + 1)
    surfaced.push(card)
  }

  return {
    timelineId: opaqueRef('timeline', timeline.id),
    sessionRef: opaqueRef('session', timeline.sessionRef),
    generatedAt: now,
    candidates: surfaced,
    issues
  }
}

export function emptyStoryEngineState(now = Date.now()): StoryEngineState {
  return {
    schema: STORY_ENGINE_SCHEMA,
    updatedAt: now,
    cards: [],
    issues: [],
    exportJournal: []
  }
}
