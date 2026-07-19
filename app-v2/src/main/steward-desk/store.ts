import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeSync
} from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  STEWARD_CASE_SCHEMA_VERSION,
  STEWARD_PACKAGE_MAX_BYTES,
  STEWARD_EXPORT_MAGIC,
  STEWARD_EXPORT_VERSION,
  type StewardActor,
  type StewardClaimedActorRole,
  type StewardActorRole,
  type StewardAppeal,
  type StewardAppealInput,
  type StewardAppealResolution,
  type StewardAppealResolutionInput,
  type StewardBookmarkAddInput,
  type StewardBookmarkSource,
  type StewardCase,
  type StewardCaseAssignmentInput,
  type StewardCaseCreateInput,
  type StewardCaseEventSummary,
  type StewardCaseEventType,
  type StewardCaseIntegrity,
  type StewardCaseStatus,
  type StewardCaseStatusInput,
  type StewardDissent,
  type StewardDissentInput,
  type StewardEvidenceLock,
  type StewardEvidenceDetails,
  type StewardEvidenceLockInput,
  type StewardEvidenceProvenance,
  type StewardEvidenceTrust,
  type StewardExportBundle,
  type StewardExportEvidence,
  type StewardExportEvent,
  type StewardExportProfile,
  type StewardHumanVerdict,
  type StewardImportProvenance,
  type StewardIncidentBookmark,
  type StewardIncidentBookmarkInput,
  type StewardManualReviewMigration,
  type StewardPortableCase,
  type StewardRaceSessionIdentity,
  type StewardRecordAuthority,
  type StewardRuleCitation,
  type StewardRuleCitationInput,
  type StewardVerdictFinding,
  type StewardVerdictInput
} from '../../shared/steward-desk'
import {
  INCIDENT_CAPTURE_SESSION_SCHEMA_VERSION,
  type IncidentCaptureSessionIdentity
} from '../../shared/incidents'
import { thirdPartyDistributionRestrictionReason } from '../../shared/third-party-dashboard-catalog'
import { assertVerifiedIncidentClip, type VerifiedIncidentClip } from '../incidents/clip-store'
import { trustedImportActor } from './actors'
import {
  PACKAGE_MAX_CANONICAL_BYTES,
  canonicalStringify,
  cloneJson,
  isPlainObject,
  sha256Canonical,
  sha256Text
} from './canonical'

const ZERO_HASH = '0'.repeat(64)
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/
const SHA256 = /^[a-f0-9]{64}$/
const CASE_FILE = /^case-[A-Za-z0-9._:@-]+\.jsonl$/
const SUPPORTED_EVENT_TYPES = new Set<StewardCaseEventType>([
  'case-created',
  'case-assigned',
  'case-status-set',
  'bookmark-added',
  'evidence-locked',
  'rule-version-cited',
  'human-verdict-recorded',
  'dissent-recorded',
  'appeal-filed',
  'appeal-resolved',
  'case-imported',
  'import-completed'
])
const ACTOR_ROLES = new Set<StewardActorRole>([
  'steward',
  'chief-steward',
  'league-admin',
  'participant',
  'observer',
  'source-claim'
])
const DECISION_ROLES = new Set<StewardActorRole>(['steward', 'chief-steward', 'league-admin'])
const CASE_STATUSES = new Set<StewardCaseStatus>(['triage', 'under-review', 'decided', 'appealed', 'closed'])
const BOOKMARK_SOURCES = new Set<StewardBookmarkSource>(['incident-recorder', 'replay', 'manual', 'import'])
const FINDINGS = new Set<StewardVerdictFinding>([
  'no-breach',
  'breach',
  'insufficient-evidence',
  'procedural'
])
const RESOLUTIONS = new Set(['upheld', 'modified', 'remanded', 'dismissed'])
const EVIDENCE_TRUST = new Set<StewardEvidenceTrust>([
  'local-user-sealed',
  'manual-unverified',
  'imported-source-claim'
])
const STEWARD_EXPORT_TRUST_MODEL: StewardExportBundle['trustModel'] = Object.freeze({
  clipSeal: 'local-user-sealed',
  corruptionAndRendererTamperProtected: true,
  appOriginAuthenticated: false,
  sameUserProcessAuthenticity: false,
  authoritativeVerdictsRequireManualReview: true
})

type StewardEventRecord = StewardExportEvent

interface CaseCreatedPayload {
  title: string
  identity: StewardRaceSessionIdentity
  incident: StewardIncidentBookmark
  primaryIncidentFingerprint: string
  assignedTo?: StewardActor
}

interface LoadedCase {
  value: StewardCase
  records: StewardEventRecord[]
}

export interface StewardCaseStoreOptions {
  rootDir: string
  now?: () => number
  idFactory?: () => string
  importFault?: (stage: 'after-evidence' | 'after-stage-write' | 'before-publish') => void
}

export interface StewardCaseImportOutcome {
  caseValue: StewardCase
  deduplicated: boolean
  retried: boolean
}

function text(value: unknown, label: string, maxLength = 500): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`)
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${label} must contain 1-${maxLength} characters.`)
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)) {
    throw new Error(`${label} contains unsupported control characters.`)
  }
  return normalized
}

function optionalText(value: unknown, label: string, maxLength = 2_000): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return text(value, label, maxLength)
}

function identifier(value: unknown, label: string): string {
  const normalized = text(value, label, 128)
  if (!SAFE_ID.test(normalized)) throw new Error(`${label} contains unsupported characters.`)
  return normalized
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${label} must be a SHA-256 digest.`)
  return value
}

function recordAuthority(value: unknown, label: string): StewardRecordAuthority {
  if (value === undefined) return 'local-trusted'
  if (
    value === 'local-trusted' ||
    value === 'imported-source-claim' ||
    value === 'legacy-unconfirmed'
  ) return value
  throw new Error(`${label} is not supported.`)
}

function numberValue(
  value: unknown,
  label: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a number from ${minimum} through ${maximum}.`)
  }
  return value
}

function optionalNumber(
  value: unknown,
  label: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER
): number | undefined {
  if (value === undefined || value === null) return undefined
  return numberValue(value, label, minimum, maximum)
}

function plain(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object.`)
  return value
}

function array(value: unknown, label: string, maxLength = 5_000): unknown[] {
  if (!Array.isArray(value) || value.length > maxLength) throw new Error(`${label} must be an array.`)
  return value
}

function onlyKeys(source: Record<string, unknown>, label: string, allowed: readonly string[]): void {
  const allowedKeys = new Set(allowed)
  const unexpected = Object.keys(source).filter((key) => !allowedKeys.has(key))
  if (unexpected.length > 0) throw new Error(`${label} contains undeclared field ${unexpected[0]}.`)
}

function actor(value: unknown, label = 'actor'): StewardActor {
  const source = plain(value, label)
  onlyKeys(source, label, ['id', 'displayName', 'role', 'claimedRole'])
  const role = text(source.role, `${label}.role`, 32) as StewardActorRole
  if (!ACTOR_ROLES.has(role)) throw new Error(`${label}.role is not supported.`)
  const claimedRole = source.claimedRole === undefined
    ? undefined
    : text(source.claimedRole, `${label}.claimedRole`, 32) as StewardClaimedActorRole
  if (
    (role === 'source-claim' &&
      (!claimedRole || source.claimedRole === 'source-claim' || !ACTOR_ROLES.has(claimedRole))) ||
    (role !== 'source-claim' && claimedRole !== undefined)
  ) {
    throw new Error(`${label}.claimedRole is valid only for an explicit source-claim actor.`)
  }
  return {
    id: identifier(source.id, `${label}.id`),
    displayName: text(source.displayName, `${label}.displayName`, 120),
    role,
    ...(claimedRole ? { claimedRole } : {})
  }
}

function decisionActor(value: unknown, label = 'actor'): StewardActor {
  const normalized = actor(value, label)
  if (!DECISION_ROLES.has(normalized.role)) {
    throw new Error('A human steward, chief steward, or league admin must own this decision.')
  }
  return normalized
}

function decisionOrSourceClaimActor(value: unknown, label = 'actor'): StewardActor {
  const normalized = actor(value, label)
  if (normalized.role !== 'source-claim' && !DECISION_ROLES.has(normalized.role)) {
    throw new Error('A human steward, chief steward, league admin, or imported source claim must own this record.')
  }
  return normalized
}

function actorsMatch(left: StewardActor, right: StewardActor): boolean {
  return left.id === right.id &&
    left.displayName === right.displayName &&
    left.role === right.role &&
    left.claimedRole === right.claimedRole
}

function requireMatchingActor(eventActor: StewardActor, payloadActor: StewardActor, label: string): void {
  if (!actorsMatch(eventActor, payloadActor)) throw new Error(`${label} actor does not match its payload actor.`)
}

function incidentCaptureSession(value: unknown): IncidentCaptureSessionIdentity {
  const source = plain(value, 'incident.captureSession')
  onlyKeys(source, 'incident.captureSession', [
    'schemaVersion',
    'captureSessionId',
    'sim',
    'startedAt',
    'lifecycleGeneration',
    'sessionUniqueId',
    'sessionNumber',
    'sessionType',
    'trackName',
    'trackConfigName'
  ])
  if (source.schemaVersion !== INCIDENT_CAPTURE_SESSION_SCHEMA_VERSION) {
    throw new Error('incident.captureSession schemaVersion is unsupported.')
  }
  const sessionUniqueId = optionalNumber(source.sessionUniqueId, 'incident.captureSession.sessionUniqueId')
  const sessionNumber = optionalNumber(source.sessionNumber, 'incident.captureSession.sessionNumber')
  const lifecycleGeneration = optionalNumber(
    source.lifecycleGeneration,
    'incident.captureSession.lifecycleGeneration',
    1
  )
  const sessionType = optionalText(source.sessionType, 'incident.captureSession.sessionType', 80)
  const trackName = optionalText(source.trackName, 'incident.captureSession.trackName', 200)
  const trackConfigName = optionalText(source.trackConfigName, 'incident.captureSession.trackConfigName', 200)
  return {
    schemaVersion: INCIDENT_CAPTURE_SESSION_SCHEMA_VERSION,
    captureSessionId: text(source.captureSessionId, 'incident.captureSession.captureSessionId', 200),
    sim: text(source.sim, 'incident.captureSession.sim', 80) as IncidentCaptureSessionIdentity['sim'],
    startedAt: numberValue(source.startedAt, 'incident.captureSession.startedAt'),
    ...(lifecycleGeneration === undefined ? {} : { lifecycleGeneration: Math.trunc(lifecycleGeneration) }),
    ...(sessionUniqueId === undefined ? {} : { sessionUniqueId }),
    ...(sessionNumber === undefined ? {} : { sessionNumber }),
    ...(sessionType ? { sessionType } : {}),
    ...(trackName ? { trackName } : {}),
    ...(trackConfigName ? { trackConfigName } : {})
  }
}

function incidentClipIdentity(value: unknown): { id: string; captureSession: IncidentCaptureSessionIdentity } {
  const source = plain(value, 'incident clip')
  return {
    id: text(source.id, 'incident clip.id', 300),
    captureSession: incidentCaptureSession(source.captureSession)
  }
}

function normalizedIdentityText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

function assertIncidentCaptureSession(
  caseIdentity: StewardRaceSessionIdentity,
  captureSession: IncidentCaptureSessionIdentity
): void {
  if (
    caseIdentity.sessionId !== captureSession.captureSessionId ||
    normalizedIdentityText(caseIdentity.sim) !== normalizedIdentityText(captureSession.sim) ||
    (captureSession.sessionType !== undefined &&
      normalizedIdentityText(caseIdentity.sessionType) !== normalizedIdentityText(captureSession.sessionType)) ||
    (captureSession.trackName !== undefined &&
      normalizedIdentityText(caseIdentity.trackName) !== normalizedIdentityText(captureSession.trackName))
  ) {
    throw new Error('Incident clip capture-session identity does not match the immutable steward case session.')
  }
}

function identity(value: unknown): StewardRaceSessionIdentity {
  const source = plain(value, 'identity')
  onlyKeys(source, 'identity', [
    'leagueId',
    'leagueName',
    'eventId',
    'eventName',
    'sessionId',
    'sim',
    'sessionType',
    'trackName',
    'startedAt'
  ])
  const startedAt = optionalNumber(source.startedAt, 'identity.startedAt')
  return {
    leagueId: text(source.leagueId, 'identity.leagueId', 160),
    leagueName: text(source.leagueName, 'identity.leagueName', 200),
    eventId: text(source.eventId, 'identity.eventId', 160),
    eventName: text(source.eventName, 'identity.eventName', 200),
    sessionId: text(source.sessionId, 'identity.sessionId', 200),
    sim: text(source.sim, 'identity.sim', 80),
    sessionType: text(source.sessionType, 'identity.sessionType', 80),
    trackName: text(source.trackName, 'identity.trackName', 200),
    ...(startedAt === undefined ? {} : { startedAt })
  }
}

function bookmarkInput(value: unknown): StewardIncidentBookmarkInput {
  const source = plain(value, 'bookmark')
  const bookmarkSource = text(source.source, 'bookmark.source', 32) as StewardBookmarkSource
  if (!BOOKMARK_SOURCES.has(bookmarkSource)) throw new Error('bookmark.source is not supported.')
  const bookmarkId = source.bookmarkId === undefined ? undefined : identifier(source.bookmarkId, 'bookmark.bookmarkId')
  const occurredAt = optionalNumber(source.occurredAt, 'bookmark.occurredAt')
  const sessionTimeSec = optionalNumber(source.sessionTimeSec, 'bookmark.sessionTimeSec')
  const lap = optionalNumber(source.lap, 'bookmark.lap', 0, 1_000_000)
  const lapDistPct = optionalNumber(source.lapDistPct, 'bookmark.lapDistPct', 0, 1)
  const replayFrame = optionalNumber(source.replayFrame, 'bookmark.replayFrame', 0, Number.MAX_SAFE_INTEGER)
  const captureSessionId = optionalText(source.captureSessionId, 'bookmark.captureSessionId', 200)
  const notes = optionalText(source.notes, 'bookmark.notes', 2_000)
  return {
    ...(bookmarkId ? { bookmarkId } : {}),
    source: bookmarkSource,
    sourceId: text(source.sourceId, 'bookmark.sourceId', 300),
    label: text(source.label, 'bookmark.label', 300),
    ...(occurredAt === undefined ? {} : { occurredAt }),
    ...(sessionTimeSec === undefined ? {} : { sessionTimeSec }),
    ...(lap === undefined ? {} : { lap }),
    ...(lapDistPct === undefined ? {} : { lapDistPct }),
    ...(replayFrame === undefined ? {} : { replayFrame }),
    ...(captureSessionId ? { captureSessionId } : {}),
    windowBeforeSec: numberValue(source.windowBeforeSec, 'bookmark.windowBeforeSec', 0, 120),
    windowAfterSec: numberValue(source.windowAfterSec, 'bookmark.windowAfterSec', 0, 120),
    ...(notes ? { notes } : {})
  }
}

function bookmarkRecord(value: unknown): StewardIncidentBookmark {
  const source = plain(value, 'bookmark')
  onlyKeys(source, 'bookmark', [
    'bookmarkId',
    'source',
    'sourceId',
    'label',
    'occurredAt',
    'sessionTimeSec',
    'lap',
    'lapDistPct',
    'replayFrame',
    'captureSessionId',
    'windowBeforeSec',
    'windowAfterSec',
    'notes',
    'createdAt',
    'createdBy'
  ])
  const input = bookmarkInput(source)
  return {
    ...input,
    bookmarkId: identifier(source.bookmarkId, 'bookmark.bookmarkId'),
    createdAt: numberValue(source.createdAt, 'bookmark.createdAt'),
    createdBy: decisionOrSourceClaimActor(source.createdBy, 'bookmark.createdBy')
  }
}

function evidenceProvenance(value: unknown): StewardEvidenceProvenance {
  const source = plain(value, 'evidence.provenance')
  onlyKeys(source, 'evidence.provenance', [
    'sourceKind',
    'sourceRef',
    'producer',
    'producerVersion',
    'capturedAt',
    'sessionRef',
    'captureRange',
    'transform',
    'notes',
    'trust'
  ])
  const sourceKind = text(source.sourceKind, 'evidence.provenance.sourceKind', 40)
  if (![
    ...BOOKMARK_SOURCES,
    'document',
    'telemetry',
    'media',
    'other'
  ].includes(sourceKind as StewardEvidenceProvenance['sourceKind'])) {
    throw new Error('evidence.provenance.sourceKind is not supported.')
  }
  const sessionRef = optionalText(source.sessionRef, 'evidence.provenance.sessionRef', 300)
  const captureRange = optionalText(source.captureRange, 'evidence.provenance.captureRange', 300)
  const transform = optionalText(source.transform, 'evidence.provenance.transform', 300)
  const notes = optionalText(source.notes, 'evidence.provenance.notes', 1_000)
  const trust = source.trust === undefined
    ? 'manual-unverified'
    : text(source.trust, 'evidence.provenance.trust', 40) as StewardEvidenceTrust
  if (!EVIDENCE_TRUST.has(trust)) throw new Error('evidence.provenance.trust is not supported.')
  return {
    sourceKind: sourceKind as StewardEvidenceProvenance['sourceKind'],
    sourceRef: text(source.sourceRef, 'evidence.provenance.sourceRef', 500),
    producer: text(source.producer, 'evidence.provenance.producer', 160),
    producerVersion: text(source.producerVersion, 'evidence.provenance.producerVersion', 80),
    capturedAt: numberValue(source.capturedAt, 'evidence.provenance.capturedAt'),
    ...(sessionRef ? { sessionRef } : {}),
    ...(captureRange ? { captureRange } : {}),
    ...(transform ? { transform } : {}),
    ...(notes ? { notes } : {}),
    trust
  }
}

function evidenceRecord(value: unknown): StewardEvidenceLock {
  const source = plain(value, 'evidence')
  onlyKeys(source, 'evidence', [
    'evidenceId',
    'summary',
    'mediaType',
    'contentHash',
    'byteLength',
    'provenance',
    'lockedAt',
    'lockedBy',
    'state'
  ])
  const state = text(source.state, 'evidence.state', 20) as StewardEvidenceLock['state']
  if (!['available', 'missing', 'corrupt', 'redacted'].includes(state)) {
    throw new Error('evidence.state is not supported.')
  }
  return {
    evidenceId: identifier(source.evidenceId, 'evidence.evidenceId'),
    summary: text(source.summary, 'evidence.summary', 1_000),
    mediaType: text(source.mediaType, 'evidence.mediaType', 120),
    contentHash: hash(source.contentHash, 'evidence.contentHash'),
    byteLength: numberValue(source.byteLength, 'evidence.byteLength', 0, 4 * 1024 * 1024),
    provenance: evidenceProvenance(source.provenance),
    lockedAt: numberValue(source.lockedAt, 'evidence.lockedAt'),
    lockedBy: decisionOrSourceClaimActor(source.lockedBy, 'evidence.lockedBy'),
    state
  }
}

function ruleRecord(value: unknown): StewardRuleCitation {
  const source = plain(value, 'rule')
  onlyKeys(source, 'rule', [
    'citationId',
    'rulesetId',
    'version',
    'section',
    'title',
    'text',
    'source',
    'contentHash',
    'citedAt',
    'citedBy'
  ])
  const citation: StewardRuleCitation = {
    citationId: identifier(source.citationId, 'rule.citationId'),
    rulesetId: text(source.rulesetId, 'rule.rulesetId', 160),
    version: text(source.version, 'rule.version', 100),
    section: text(source.section, 'rule.section', 160),
    title: text(source.title, 'rule.title', 300),
    text: text(source.text, 'rule.text', 20_000),
    source: text(source.source, 'rule.source', 500),
    contentHash: hash(source.contentHash, 'rule.contentHash'),
    citedAt: numberValue(source.citedAt, 'rule.citedAt'),
    citedBy: decisionOrSourceClaimActor(source.citedBy, 'rule.citedBy')
  }
  const expectedHash = sha256Canonical({
    rulesetId: citation.rulesetId,
    version: citation.version,
    section: citation.section,
    title: citation.title,
    text: citation.text,
    source: citation.source
  })
  if (citation.contentHash !== expectedHash) throw new Error('rule.contentHash does not match the cited rule version.')
  return citation
}

function stringIds(value: unknown, label: string): string[] {
  const values = array(value, label, 1_000).map((entry, index) => identifier(entry, `${label}[${index}]`))
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicate ids.`)
  return values
}

function verdictRecord(value: unknown): StewardHumanVerdict {
  const source = plain(value, 'verdict')
  onlyKeys(source, 'verdict', [
    'verdictId',
    'finding',
    'decisionText',
    'actionText',
    'ruleCitationIds',
    'evidenceIds',
    'supersedesVerdictId',
    'authority',
    'manualReviewConfirmed',
    'decidedAt',
    'decidedBy'
  ])
  const finding = text(source.finding, 'verdict.finding', 40) as StewardVerdictFinding
  if (!FINDINGS.has(finding)) throw new Error('verdict.finding is not supported.')
  const actionText = optionalText(source.actionText, 'verdict.actionText', 4_000)
  const supersedesVerdictId = source.supersedesVerdictId === undefined
    ? undefined
    : identifier(source.supersedesVerdictId, 'verdict.supersedesVerdictId')
  const declaredAuthority = recordAuthority(source.authority, 'verdict.authority')
  const explicitManualReview = source.manualReviewConfirmed === true
  const authority = declaredAuthority === 'local-trusted' && !explicitManualReview
    ? 'legacy-unconfirmed'
    : declaredAuthority
  const manualReviewConfirmed = authority === 'local-trusted' && explicitManualReview
  const decidedBy = authority === 'imported-source-claim'
    ? actor(source.decidedBy, 'verdict.decidedBy')
    : decisionActor(source.decidedBy, 'verdict.decidedBy')
  if (
    (authority === 'imported-source-claim' && decidedBy.role !== 'source-claim') ||
    (authority !== 'imported-source-claim' && decidedBy.role === 'source-claim')
  ) {
    throw new Error('Verdict authority does not match its actor trust.')
  }
  return {
    verdictId: identifier(source.verdictId, 'verdict.verdictId'),
    finding,
    decisionText: text(source.decisionText, 'verdict.decisionText', 8_000),
    ...(actionText ? { actionText } : {}),
    ruleCitationIds: stringIds(source.ruleCitationIds, 'verdict.ruleCitationIds'),
    evidenceIds: stringIds(source.evidenceIds, 'verdict.evidenceIds'),
    ...(supersedesVerdictId ? { supersedesVerdictId } : {}),
    authority,
    manualReviewConfirmed,
    decidedAt: numberValue(source.decidedAt, 'verdict.decidedAt'),
    decidedBy
  }
}

function dissentRecord(value: unknown): StewardDissent {
  const source = plain(value, 'dissent')
  onlyKeys(source, 'dissent', [
    'dissentId',
    'verdictId',
    'statement',
    'grounds',
    'submittedAt',
    'submittedBy'
  ])
  const submittedBy = actor(source.submittedBy, 'dissent.submittedBy')
  if (submittedBy.role === 'observer') throw new Error('Observers cannot submit dissent.')
  return {
    dissentId: identifier(source.dissentId, 'dissent.dissentId'),
    verdictId: identifier(source.verdictId, 'dissent.verdictId'),
    statement: text(source.statement, 'dissent.statement', 8_000),
    grounds: text(source.grounds, 'dissent.grounds', 4_000),
    submittedAt: numberValue(source.submittedAt, 'dissent.submittedAt'),
    submittedBy
  }
}

function resolutionRecord(value: unknown): StewardAppealResolution {
  const source = plain(value, 'appeal.resolution')
  onlyKeys(source, 'appeal.resolution', [
    'resolutionId',
    'resolution',
    'reasoning',
    'authority',
    'resolvedAt',
    'resolvedBy'
  ])
  const resolution = text(source.resolution, 'appeal.resolution.resolution', 30)
  if (!RESOLUTIONS.has(resolution)) throw new Error('appeal resolution is not supported.')
  const authority = recordAuthority(source.authority, 'appeal.resolution.authority')
  const resolvedBy = authority === 'imported-source-claim'
    ? actor(source.resolvedBy, 'appeal.resolution.resolvedBy')
    : decisionActor(source.resolvedBy, 'appeal.resolution.resolvedBy')
  if (
    (authority === 'imported-source-claim' && resolvedBy.role !== 'source-claim') ||
    (authority !== 'imported-source-claim' && resolvedBy.role === 'source-claim')
  ) {
    throw new Error('Appeal resolution authority does not match its actor trust.')
  }
  return {
    resolutionId: identifier(source.resolutionId, 'appeal.resolution.resolutionId'),
    resolution: resolution as StewardAppealResolution['resolution'],
    reasoning: text(source.reasoning, 'appeal.resolution.reasoning', 8_000),
    authority,
    resolvedAt: numberValue(source.resolvedAt, 'appeal.resolution.resolvedAt'),
    resolvedBy
  }
}

function appealRecord(value: unknown): StewardAppeal {
  const source = plain(value, 'appeal')
  onlyKeys(source, 'appeal', [
    'appealId',
    'verdictId',
    'grounds',
    'requestedRemedy',
    'authority',
    'filedAt',
    'filedBy',
    'status',
    'resolutions'
  ])
  const status = text(source.status, 'appeal.status', 20)
  if (status !== 'open' && status !== 'resolved') throw new Error('appeal.status is not supported.')
  const resolutions = array(source.resolutions, 'appeal.resolutions', 1_000).map(resolutionRecord)
  if (new Set(resolutions.map((entry) => entry.resolutionId)).size !== resolutions.length) {
    throw new Error('appeal.resolutions contains duplicate ids.')
  }
  if ((status === 'open' && resolutions.length > 0) || (status === 'resolved' && resolutions.length === 0)) {
    throw new Error('appeal.status does not match its resolution history.')
  }
  const authority = recordAuthority(source.authority, 'appeal.authority')
  if (resolutions.some((entry) => entry.authority !== authority)) {
    throw new Error('Appeal resolution authority must match the appeal authority.')
  }
  const filedBy = actor(source.filedBy, 'appeal.filedBy')
  if (authority === 'imported-source-claim') {
    if (filedBy.role !== 'source-claim') throw new Error('Imported appeal claims require a source-claim actor.')
  } else if (filedBy.role === 'observer' || filedBy.role === 'source-claim') {
    throw new Error('Observers and source claims cannot file trusted local appeals.')
  }
  return {
    appealId: identifier(source.appealId, 'appeal.appealId'),
    verdictId: identifier(source.verdictId, 'appeal.verdictId'),
    grounds: text(source.grounds, 'appeal.grounds', 8_000),
    requestedRemedy: text(source.requestedRemedy, 'appeal.requestedRemedy', 4_000),
    authority,
    filedAt: numberValue(source.filedAt, 'appeal.filedAt'),
    filedBy,
    status,
    resolutions
  }
}

function manualReviewMigrationRecord(value: unknown): StewardManualReviewMigration {
  const source = plain(value, 'manualReviewMigration')
  onlyKeys(source, 'manualReviewMigration', [
    'reason',
    'legacyVerdictIds',
    'pendingVerdictIds',
    'resolvedByVerdictIds',
    'derivedFromCanonicalChain'
  ])
  if (
    source.reason !== 'legacy-verdict-missing-native-confirmation' ||
    source.derivedFromCanonicalChain !== true
  ) {
    throw new Error('Manual review migration provenance is invalid.')
  }
  const legacyVerdictIds = stringIds(source.legacyVerdictIds, 'manualReviewMigration.legacyVerdictIds')
  const pendingVerdictIds = stringIds(source.pendingVerdictIds, 'manualReviewMigration.pendingVerdictIds')
  const resolvedByVerdictIds = stringIds(
    source.resolvedByVerdictIds,
    'manualReviewMigration.resolvedByVerdictIds'
  )
  if (pendingVerdictIds.some((id) => !legacyVerdictIds.includes(id))) {
    throw new Error('Manual review migration pending ids are not legacy verdicts.')
  }
  return {
    reason: 'legacy-verdict-missing-native-confirmation',
    legacyVerdictIds,
    pendingVerdictIds,
    resolvedByVerdictIds,
    derivedFromCanonicalChain: true
  }
}

function importProvenanceRecord(value: unknown): StewardImportProvenance {
  const source = plain(value, 'importProvenance')
  onlyKeys(source, 'importProvenance', [
    'sourcePackageHash',
    'sourceHeadHash',
    'sourceCaseRef',
    'profile',
    'importedAt',
    'sourceManualReviewMigration'
  ])
  const profile = text(source.profile, 'importProvenance.profile', 20)
  if (profile !== 'full-local' && profile !== 'anonymized') {
    throw new Error('importProvenance.profile is not supported.')
  }
  return {
    sourcePackageHash: hash(source.sourcePackageHash, 'importProvenance.sourcePackageHash'),
    sourceHeadHash: hash(source.sourceHeadHash, 'importProvenance.sourceHeadHash'),
    sourceCaseRef: text(source.sourceCaseRef, 'importProvenance.sourceCaseRef', 160),
    profile,
    importedAt: numberValue(source.importedAt, 'importProvenance.importedAt'),
    ...(source.sourceManualReviewMigration
      ? { sourceManualReviewMigration: manualReviewMigrationRecord(source.sourceManualReviewMigration) }
      : {})
  }
}

function eventUnsigned(record: Omit<StewardEventRecord, 'eventHash'>): Omit<StewardEventRecord, 'eventHash'> {
  return record
}

function normalizedFingerprintText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

function legacyEventFingerprint(identityValue: StewardRaceSessionIdentity, bookmark: StewardIncidentBookmarkInput): string {
  return sha256Canonical({
    leagueId: identityValue.leagueId.toLowerCase(),
    eventId: identityValue.eventId.toLowerCase(),
    sessionId: identityValue.sessionId.toLowerCase(),
    source: bookmark.source,
    sourceId: bookmark.sourceId,
    occurredAt: bookmark.occurredAt ?? null,
    sessionTimeSec: bookmark.sessionTimeSec ?? null,
    lap: bookmark.lap ?? null,
    replayFrame: bookmark.replayFrame ?? null
  })
}

function eventFingerprint(identityValue: StewardRaceSessionIdentity, bookmark: StewardIncidentBookmarkInput): string {
  const hasStablePosition =
    bookmark.sessionTimeSec !== undefined ||
    bookmark.lap !== undefined ||
    bookmark.lapDistPct !== undefined ||
    bookmark.replayFrame !== undefined
  const sourceKey = hasStablePosition
    ? null
    : bookmark.source === 'manual'
      ? normalizedFingerprintText(bookmark.label)
      : normalizedFingerprintText(bookmark.sourceId)
  return sha256Canonical({
    leagueId: normalizedFingerprintText(identityValue.leagueId),
    eventId: normalizedFingerprintText(identityValue.eventId),
    sessionId: normalizedFingerprintText(identityValue.sessionId),
    sim: normalizedFingerprintText(identityValue.sim),
    sessionType: normalizedFingerprintText(identityValue.sessionType),
    source: bookmark.source,
    sourceKey,
    ...(bookmark.captureSessionId
      ? { captureSessionId: normalizedFingerprintText(bookmark.captureSessionId) }
      : {}),
    sessionTimeSec: bookmark.sessionTimeSec === undefined
      ? null
      : Math.round(bookmark.sessionTimeSec * 10) / 10,
    lap: bookmark.lap === undefined ? null : Math.trunc(bookmark.lap),
    lapDistPct: bookmark.lapDistPct === undefined
      ? null
      : Math.round(bookmark.lapDistPct * 10_000) / 10_000,
    replayFrame: bookmark.replayFrame === undefined ? null : Math.trunc(bookmark.replayFrame)
  })
}

function assertUnique<T>(values: readonly T[], key: (value: T) => string, label: string): void {
  const ids = values.map(key)
  if (new Set(ids).size !== ids.length) throw new Error(`${label} contains duplicate ids.`)
}

function assertVerdictInvariants(
  verdict: StewardHumanVerdict,
  rules: readonly StewardRuleCitation[],
  evidence: readonly StewardEvidenceLock[],
  priorVerdicts: readonly StewardHumanVerdict[]
): void {
  if (verdict.ruleCitationIds.length === 0 || verdict.evidenceIds.length === 0) {
    throw new Error('A human verdict requires at least one locked evidence item and one versioned rule citation.')
  }
  for (const id of verdict.ruleCitationIds) {
    if (!rules.some((entry) => entry.citationId === id)) throw new Error(`Unknown rule citation ${id}.`)
  }
  for (const id of verdict.evidenceIds) {
    const locked = evidence.find((entry) => entry.evidenceId === id)
    if (!locked || locked.state !== 'available') throw new Error(`Evidence ${id} is not available.`)
  }
  if (
    verdict.supersedesVerdictId &&
    !priorVerdicts.some((entry) => entry.verdictId === verdict.supersedesVerdictId)
  ) {
    throw new Error(`Superseded verdict ${verdict.supersedesVerdictId} does not exist before this verdict.`)
  }
}

function isTrustedLocalVerdict(value: StewardHumanVerdict): boolean {
  return value.authority === 'local-trusted'
}

function isTrustedLocalAppeal(value: StewardAppeal): boolean {
  return value.authority === 'local-trusted'
}

function requireDecisionOrImportedClaimEventActor(
  value: StewardActor,
  importProvenance: StewardImportProvenance | undefined,
  label: string
): void {
  if (value.role === 'source-claim') {
    if (!importProvenance) throw new Error(`${label} source claim lacks verified source-package context.`)
    return
  }
  decisionActor(value, label)
}

function deriveManualReviewMigration(
  verdicts: readonly StewardHumanVerdict[]
): StewardManualReviewMigration | undefined {
  const legacyVerdicts = verdicts.filter((entry) => entry.authority === 'legacy-unconfirmed')
  if (legacyVerdicts.length === 0) return undefined
  const byId = new Map(verdicts.map((entry) => [entry.verdictId, entry]))
  const resolved = new Set<string>()
  for (const verdict of verdicts.filter(isTrustedLocalVerdict)) {
    let supersededId = verdict.supersedesVerdictId
    const visited = new Set<string>()
    while (supersededId && !visited.has(supersededId)) {
      visited.add(supersededId)
      const superseded = byId.get(supersededId)
      if (!superseded) break
      if (superseded.authority === 'legacy-unconfirmed') resolved.add(superseded.verdictId)
      supersededId = superseded.supersedesVerdictId
    }
  }
  const legacyVerdictIds = legacyVerdicts.map((entry) => entry.verdictId)
  return {
    reason: 'legacy-verdict-missing-native-confirmation',
    legacyVerdictIds,
    pendingVerdictIds: legacyVerdictIds.filter((id) => !resolved.has(id)),
    resolvedByVerdictIds: verdicts
      .filter(isTrustedLocalVerdict)
      .filter((entry) => {
        let supersededId = entry.supersedesVerdictId
        const visited = new Set<string>()
        while (supersededId && !visited.has(supersededId)) {
          visited.add(supersededId)
          const superseded = byId.get(supersededId)
          if (!superseded) return false
          if (superseded.authority === 'legacy-unconfirmed') return true
          supersededId = superseded.supersedesVerdictId
        }
        return false
      })
      .map((entry) => entry.verdictId),
    derivedFromCanonicalChain: true
  }
}

function emptyIntegrity(failures: string[], checkedEvents: number, headHash?: string): StewardCaseIntegrity {
  const chainValid = failures.length === 0
  return {
    state: chainValid ? 'unanchored' : 'corrupt',
    verified: false,
    chainValid,
    evidenceValid: chainValid,
    checkedEvents,
    ...(headHash ? { headHash } : {}),
    checkedAt: Date.now(),
    message: chainValid
      ? 'Local append-only hash chain verified. No external anchor exists; state remains unanchored.'
      : 'The local case chain is corrupt and has been quarantined.',
    failures
  }
}

function placeholderCase(caseId: string, failures: string[]): StewardCase {
  const systemActor: StewardActor = { id: 'system-corrupt', displayName: 'Corrupt local case', role: 'observer' }
  return {
    schemaVersion: STEWARD_CASE_SCHEMA_VERSION,
    caseId,
    title: 'Corrupt local steward case',
    createdAt: 0,
    createdBy: systemActor,
    identity: {
      leagueId: 'unavailable',
      leagueName: 'Unavailable',
      eventId: 'unavailable',
      eventName: 'Unavailable',
      sessionId: 'unavailable',
      sim: 'Unavailable',
      sessionType: 'Unavailable',
      trackName: 'Unavailable'
    },
    primaryIncidentFingerprint: ZERO_HASH,
    status: 'triage',
    bookmarks: [],
    evidence: [],
    rules: [],
    verdicts: [],
    dissents: [],
    appeals: [],
    history: [],
    integrity: emptyIntegrity(failures, 0)
  }
}

function portableCase(value: StewardCase): StewardPortableCase {
  const { history: _history, integrity: _integrity, ...portable } = value
  return cloneJson(portable, PACKAGE_MAX_CANONICAL_BYTES)
}

function comparableImportedCase(value: StewardPortableCase): unknown {
  const {
    caseId: _caseId,
    importProvenance: _importProvenance,
    importCompleted: _importCompleted,
    ...comparable
  } = value
  return comparable
}

const ANONYMIZED_EVIDENCE_SCHEMA_VERSION = 1 as const
const INCIDENT_TYPES = new Set(['spin', 'off-track', 'contact', 'lockup'])
const INCIDENT_SEVERITIES = new Set(['minor', 'moderate', 'major'])
const INCIDENT_NUMERIC_FIELDS = [
  'lap',
  'lapDistPct',
  'speedKmh',
  'rpm',
  'gear',
  'throttle',
  'brake',
  'steerAngleDeg',
  'latAccelG',
  'longAccelG',
  'vertAccelG',
  'yawRateRadSec',
  'speedDropKmh',
  'gSpike'
] as const

function finiteField(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function anonymizedIncidentContent(
  value: unknown,
  captureSessionId: string,
  normalizeTime: (value: number) => number
): unknown | null {
  if (!isPlainObject(value) ||
      !INCIDENT_TYPES.has(String(value.type)) ||
      !INCIDENT_SEVERITIES.has(String(value.severity)) ||
      !Array.isArray(value.window) ||
      !isPlainObject(value.metrics)) {
    return null
  }
  const at = finiteField(value, 'at')
  const createdAt = finiteField(value, 'createdAt')
  const triggerIndex = finiteField(value, 'triggerIndex')
  if (at === undefined || createdAt === undefined || triggerIndex === undefined) return null
  const metrics = Object.fromEntries(
    INCIDENT_NUMERIC_FIELDS.flatMap((key) => {
      const field = finiteField(value.metrics as Record<string, unknown>, key)
      return field === undefined ? [] : [[key, field]]
    })
  )
  const samples = value.window.slice(0, 5_000).map((entry) => {
    if (!isPlainObject(entry)) return { t: 0 }
    const timestamp = finiteField(entry, 't')
    const numeric = Object.fromEntries(
      INCIDENT_NUMERIC_FIELDS.flatMap((key) => {
        const field = finiteField(entry, key)
        return field === undefined ? [] : [[key, field]]
      })
    )
    return {
      t: timestamp === undefined ? 0 : normalizeTime(timestamp),
      ...numeric,
      ...(typeof entry.onPitRoad === 'boolean' ? { onPitRoad: entry.onPitRoad } : {})
    }
  })
  return {
    schemaVersion: ANONYMIZED_EVIDENCE_SCHEMA_VERSION,
    kind: 'incident-telemetry',
    incidentType: value.type,
    severity: value.severity,
    occurredAt: normalizeTime(at),
    ...(finiteField(value, 'lap') === undefined ? {} : { lap: finiteField(value, 'lap') }),
    ...(finiteField(value, 'lapDistPct') === undefined
      ? {}
      : { lapDistPct: finiteField(value, 'lapDistPct') }),
    metrics,
    samples,
    triggerIndex: Math.trunc(triggerIndex),
    capturedAt: normalizeTime(createdAt),
    captureSession: {
      schemaVersion: INCIDENT_CAPTURE_SESSION_SCHEMA_VERSION,
      captureSessionId
    }
  }
}

function anonymizedEvidenceContent(
  evidence: StewardEvidenceLock,
  value: unknown,
  captureSessionId: string,
  normalizeTime: (value: number) => number
): unknown {
  if (evidence.mediaType === 'application/vnd.ultimate-sim.incident+json') {
    const projected = anonymizedIncidentContent(value, captureSessionId, normalizeTime)
    if (projected) return projected
  }
  return {
    schemaVersion: ANONYMIZED_EVIDENCE_SCHEMA_VERSION,
    kind: 'redacted',
    reason: evidence.mediaType === 'text/plain'
      ? 'free-form-content-removed'
      : 'unsupported-content-schema'
  }
}

function validateAnonymizedEvidenceContent(value: unknown): unknown {
  const source = plain(value, 'anonymized evidence content')
  if (source.schemaVersion !== ANONYMIZED_EVIDENCE_SCHEMA_VERSION) {
    throw new Error('Anonymized evidence schemaVersion is unsupported.')
  }
  if (source.kind === 'redacted') {
    onlyKeys(source, 'anonymized evidence content', ['schemaVersion', 'kind', 'reason'])
    if (source.reason !== 'free-form-content-removed' && source.reason !== 'unsupported-content-schema') {
      throw new Error('Anonymized evidence redaction reason is unsupported.')
    }
    return cloneJson(source)
  }
  if (source.kind !== 'incident-telemetry') throw new Error('Anonymized evidence kind is unsupported.')
  onlyKeys(source, 'anonymized evidence content', [
    'schemaVersion',
    'kind',
    'incidentType',
    'severity',
    'occurredAt',
    'lap',
    'lapDistPct',
    'metrics',
    'samples',
    'triggerIndex',
    'capturedAt',
    'captureSession'
  ])
  if (!INCIDENT_TYPES.has(String(source.incidentType)) ||
      !INCIDENT_SEVERITIES.has(String(source.severity))) {
    throw new Error('Anonymized incident type or severity is unsupported.')
  }
  numberValue(source.occurredAt, 'anonymized evidence occurredAt')
  optionalNumber(source.lap, 'anonymized evidence lap')
  optionalNumber(source.lapDistPct, 'anonymized evidence lapDistPct', 0, 1)
  numberValue(source.triggerIndex, 'anonymized evidence triggerIndex', 0)
  numberValue(source.capturedAt, 'anonymized evidence capturedAt')
  const metrics = plain(source.metrics, 'anonymized evidence metrics')
  onlyKeys(metrics, 'anonymized evidence metrics', INCIDENT_NUMERIC_FIELDS)
  for (const [key, entry] of Object.entries(metrics)) {
    numberValue(entry, `anonymized evidence metrics.${key}`, -Number.MAX_SAFE_INTEGER)
  }
  for (const [index, entry] of array(source.samples, 'anonymized evidence samples', 5_000).entries()) {
    const sample = plain(entry, `anonymized evidence samples[${index}]`)
    onlyKeys(sample, `anonymized evidence samples[${index}]`, ['t', ...INCIDENT_NUMERIC_FIELDS, 'onPitRoad'])
    numberValue(sample.t, `anonymized evidence samples[${index}].t`)
    for (const key of INCIDENT_NUMERIC_FIELDS) {
      if (sample[key] !== undefined) {
        numberValue(sample[key], `anonymized evidence samples[${index}].${key}`, -Number.MAX_SAFE_INTEGER)
      }
    }
    if (sample.onPitRoad !== undefined && typeof sample.onPitRoad !== 'boolean') {
      throw new Error(`anonymized evidence samples[${index}].onPitRoad must be boolean.`)
    }
  }
  const captureSession = plain(source.captureSession, 'anonymized evidence captureSession')
  onlyKeys(captureSession, 'anonymized evidence captureSession', ['schemaVersion', 'captureSessionId'])
  if (captureSession.schemaVersion !== INCIDENT_CAPTURE_SESSION_SCHEMA_VERSION) {
    throw new Error('Anonymized capture-session schemaVersion is unsupported.')
  }
  text(captureSession.captureSessionId, 'anonymized evidence captureSession.captureSessionId', 200)
  return cloneJson(source)
}

function evidenceRightsRestriction(value: unknown, path = 'content', depth = 0): string | null {
  if (depth > 32) return `${path}: rights metadata nesting exceeds the supported depth.`
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const restriction = evidenceRightsRestriction(value[index], `${path}[${index}]`, depth + 1)
      if (restriction) return restriction
    }
    return null
  }
  if (!isPlainObject(value)) return null
  if (Object.prototype.hasOwnProperty.call(value, 'thirdParty')) {
    const restriction = thirdPartyDistributionRestrictionReason(value.thirdParty, 'reExport')
    if (restriction) return `${path}.thirdParty: ${restriction}`
  }
  for (const [key, entry] of Object.entries(value)) {
    const restriction = evidenceRightsRestriction(entry, `${path}.${key}`, depth + 1)
    if (restriction) return restriction
  }
  return null
}

function aliasActors(value: StewardPortableCase): Map<string, StewardActor> {
  const aliases = new Map<string, StewardActor>()
  const counters = new Map<string, number>()
  const all: StewardActor[] = [
    value.createdBy,
    ...(value.assignedTo ? [value.assignedTo] : []),
    ...value.bookmarks.map((entry) => entry.createdBy),
    ...value.evidence.map((entry) => entry.lockedBy),
    ...value.rules.map((entry) => entry.citedBy),
    ...value.verdicts.map((entry) => entry.decidedBy),
    ...value.dissents.map((entry) => entry.submittedBy),
    ...value.appeals.flatMap((entry) => [entry.filedBy, ...entry.resolutions.map((item) => item.resolvedBy)])
  ]
  for (const entry of all) {
    const key = canonicalStringify(entry)
    if (aliases.has(key)) continue
    const group = entry.role === 'source-claim'
      ? `source-claim-${entry.claimedRole ?? 'observer'}`
      : entry.role
    const next = (counters.get(group) ?? 0) + 1
    counters.set(group, next)
    aliases.set(key, {
      id: `anon-${group}-${next}`,
      displayName: `${group.split('-').map((part) =>
        `${part[0].toUpperCase()}${part.slice(1)}`).join(' ')} ${next}`,
      role: entry.role,
      ...(entry.claimedRole ? { claimedRole: entry.claimedRole } : {})
    })
  }
  return aliases
}

function anonymizeCase(
  sourceCase: StewardPortableCase,
  evidenceContents: StewardExportEvidence[],
  aliasSeed: string
): { caseValue: StewardPortableCase; evidence: StewardExportEvidence[]; redactions: string[] } {
  const aliases = aliasActors(sourceCase)
  const actorAlias = (value: StewardActor): StewardActor =>
    cloneJson(aliases.get(canonicalStringify(value)) ?? value)
  const baseTime = sourceCase.createdAt
  const relativeTime = (value: number): number => Math.max(0, Math.round((value - baseTime) / 60_000) * 60_000)
  const optionalRelative = (value: number | undefined): number | undefined =>
    value === undefined ? undefined : relativeTime(value)
  const evidenceIdMap = new Map(sourceCase.evidence.map((entry, index) => [entry.evidenceId, `evidence-${index + 1}`]))
  const ruleIdMap = new Map(sourceCase.rules.map((entry, index) => [entry.citationId, `rule-${index + 1}`]))
  const verdictIdMap = new Map(sourceCase.verdicts.map((entry, index) => [entry.verdictId, `verdict-${index + 1}`]))
  const dissentIdMap = new Map(sourceCase.dissents.map((entry, index) => [entry.dissentId, `dissent-${index + 1}`]))
  const appealIdMap = new Map(sourceCase.appeals.map((entry, index) => [entry.appealId, `appeal-${index + 1}`]))
  const anonymizedSessionId = `session-${sha256Text(`${aliasSeed}:${sourceCase.identity.sessionId}`).slice(0, 8)}`
  const bookmarkAlias = (entry: StewardIncidentBookmark, index: number): StewardIncidentBookmark => {
    const occurredAt = optionalRelative(entry.occurredAt)
    const sessionTimeSec = entry.sessionTimeSec === undefined ? undefined : Math.round(entry.sessionTimeSec / 5) * 5
    const lapDistPct = entry.lapDistPct === undefined ? undefined : Math.round(entry.lapDistPct * 100) / 100
    return {
      bookmarkId: `bookmark-${index + 1}`,
      source: 'import',
      sourceId: `incident-${sha256Canonical({
        aliasSeed,
        bookmarkId: entry.bookmarkId,
        sourceId: entry.sourceId
      }).slice(0, 10)}`,
      label: `Incident bookmark ${index + 1}`,
      ...(occurredAt === undefined ? {} : { occurredAt }),
      ...(sessionTimeSec === undefined ? {} : { sessionTimeSec }),
      ...(entry.lap === undefined ? {} : { lap: entry.lap }),
      ...(lapDistPct === undefined ? {} : { lapDistPct }),
      ...(entry.captureSessionId ? { captureSessionId: anonymizedSessionId } : {}),
      windowBeforeSec: entry.windowBeforeSec,
      windowAfterSec: entry.windowAfterSec,
      createdAt: relativeTime(entry.createdAt),
      createdBy: actorAlias(entry.createdBy)
    }
  }

  const anonymizedEvidence = evidenceContents.map((entry) => {
    const locked = sourceCase.evidence.find((item) => item.evidenceId === entry.evidenceId) as StewardEvidenceLock
    const content = anonymizedEvidenceContent(locked, entry.content, anonymizedSessionId, relativeTime)
    return {
      evidenceId: evidenceIdMap.get(entry.evidenceId) as string,
      contentHash: sha256Canonical(content),
      content
    }
  })
  const evidenceHashes = new Map(anonymizedEvidence.map((entry) => [entry.evidenceId, entry.contentHash]))
  const bookmarks = sourceCase.bookmarks.map(bookmarkAlias)
  const caseId = `case-anon-${sha256Text(aliasSeed).slice(0, 12)}`
  const identityValue: StewardRaceSessionIdentity = {
    leagueId: 'league-redacted',
    leagueName: 'League redacted',
    eventId: 'event-redacted',
    eventName: 'Event redacted',
    sessionId: anonymizedSessionId,
    sim: 'Sim redacted',
    sessionType: 'Session redacted',
    trackName: 'Track redacted'
  }
  const evidence = sourceCase.evidence.map((entry) => {
    const anonymizedId = evidenceIdMap.get(entry.evidenceId) as string
    const content = anonymizedEvidence.find((item) => item.evidenceId === anonymizedId)?.content
    const incidentContent = isPlainObject(content) && content.kind === 'incident-telemetry'
    return {
      ...entry,
      evidenceId: anonymizedId,
      summary: `Evidence item ${sourceCase.evidence.indexOf(entry) + 1}`,
      mediaType: incidentContent
        ? 'application/vnd.ultimate-sim.incident.anonymized+json'
        : 'application/vnd.ultimate-sim.redacted+json',
      contentHash: evidenceHashes.get(anonymizedId) as string,
      byteLength: Buffer.byteLength(canonicalStringify(content), 'utf8'),
      provenance: {
        sourceKind: entry.provenance.sourceKind,
        sourceRef: '[redacted]',
        producer: 'producer-redacted',
        producerVersion: 'redacted',
        capturedAt: relativeTime(entry.provenance.capturedAt),
        trust: entry.provenance.trust ?? 'manual-unverified',
        ...(entry.provenance.sourceKind === 'incident-recorder'
          ? { sessionRef: anonymizedSessionId }
          : {}),
        ...(entry.provenance.captureRange
          ? { captureRange: '[normalized]' }
          : {}),
        ...(entry.provenance.transform ? { transform: 'redacted' } : {})
      },
      lockedAt: relativeTime(entry.lockedAt),
      lockedBy: actorAlias(entry.lockedBy),
      state: 'available' as const
    }
  })
  const rules = sourceCase.rules.map((entry) => {
    const content = {
      rulesetId: `ruleset-${sourceCase.rules.indexOf(entry) + 1}`,
      version: 'redacted',
      section: 'redacted',
      title: `Rule citation ${sourceCase.rules.indexOf(entry) + 1}`,
      text: 'Free-form rule text removed from anonymized export.',
      source: '[redacted]'
    }
    return {
      ...entry,
      citationId: ruleIdMap.get(entry.citationId) as string,
      ...content,
      contentHash: sha256Canonical(content),
      citedAt: relativeTime(entry.citedAt),
      citedBy: actorAlias(entry.citedBy)
    }
  })
  const verdicts = sourceCase.verdicts.map((entry) => ({
    ...entry,
    verdictId: verdictIdMap.get(entry.verdictId) as string,
    decisionText: 'Free-form human decision text removed from anonymized export.',
    ...(entry.actionText ? { actionText: 'Free-form action text removed from anonymized export.' } : {}),
    ruleCitationIds: entry.ruleCitationIds.map((id) => ruleIdMap.get(id) as string),
    evidenceIds: entry.evidenceIds.map((id) => evidenceIdMap.get(id) as string),
    ...(entry.supersedesVerdictId
      ? { supersedesVerdictId: verdictIdMap.get(entry.supersedesVerdictId) as string }
      : {}),
    decidedAt: relativeTime(entry.decidedAt),
    decidedBy: actorAlias(entry.decidedBy)
  }))
  const dissents = sourceCase.dissents.map((entry) => ({
    ...entry,
    dissentId: dissentIdMap.get(entry.dissentId) as string,
    verdictId: verdictIdMap.get(entry.verdictId) as string,
    statement: 'Free-form dissent statement removed from anonymized export.',
    grounds: 'Free-form dissent grounds removed from anonymized export.',
    submittedAt: relativeTime(entry.submittedAt),
    submittedBy: actorAlias(entry.submittedBy)
  }))
  const appeals = sourceCase.appeals.map((entry) => ({
    ...entry,
    appealId: appealIdMap.get(entry.appealId) as string,
    verdictId: verdictIdMap.get(entry.verdictId) as string,
    grounds: 'Free-form appeal grounds removed from anonymized export.',
    requestedRemedy: 'Free-form requested remedy removed from anonymized export.',
    filedAt: relativeTime(entry.filedAt),
    filedBy: actorAlias(entry.filedBy),
    resolutions: entry.resolutions.map((resolution, resolutionIndex) => ({
      ...resolution,
      resolutionId: `resolution-${sourceCase.appeals.indexOf(entry) + 1}-${resolutionIndex + 1}`,
      reasoning: 'Free-form appeal resolution reasoning removed from anonymized export.',
      resolvedAt: relativeTime(resolution.resolvedAt),
      resolvedBy: actorAlias(resolution.resolvedBy)
    }))
  }))
  const manualReviewMigration = deriveManualReviewMigration(verdicts)
  return {
    caseValue: {
      schemaVersion: STEWARD_CASE_SCHEMA_VERSION,
      caseId,
      title: 'Anonymized steward case',
      createdAt: 0,
      createdBy: actorAlias(sourceCase.createdBy),
      identity: identityValue,
      primaryIncidentFingerprint: eventFingerprint(identityValue, bookmarks[0]),
      status: sourceCase.status,
      ...(sourceCase.assignedTo ? { assignedTo: actorAlias(sourceCase.assignedTo) } : {}),
      bookmarks,
      evidence,
      rules,
      verdicts,
      dissents,
      appeals,
      ...(manualReviewMigration ? { manualReviewMigration } : {})
    },
    evidence: anonymizedEvidence,
    redactions: [
      'actor identities replaced with role-preserving aliases',
      'producer and steward provenance identities removed',
      'league, event, session, track, and source locators removed',
      'exact timestamps in case data, provenance, and evidence converted to relative minute offsets',
      'free-form case text removed instead of heuristically scrubbed',
      'evidence content reduced to schema-allowlisted telemetry or an explicit redaction marker'
    ]
  }
}

function assertAnonymizedActor(value: StewardActor): void {
  const match = /^anon-(steward|chief-steward|league-admin|participant|observer|source-claim-(?:steward|chief-steward|league-admin|participant|observer))-([1-9]\d*)$/.exec(value.id)
  if (!match) throw new Error('Anonymized case actor id is not schema-allowlisted.')
  const expectedGroup = value.role === 'source-claim'
    ? `source-claim-${value.claimedRole ?? 'observer'}`
    : value.role
  const expectedName = `${expectedGroup.split('-').map((part) =>
    `${part[0].toUpperCase()}${part.slice(1)}`).join(' ')} ${match[2]}`
  if (match[1] !== expectedGroup || value.displayName !== expectedName) {
    throw new Error('Anonymized case actor identity is not schema-allowlisted.')
  }
}

function assertAnonymizedCaseSchema(value: StewardPortableCase): void {
  if (!/^case-anon-[a-f0-9]{12}$/.test(value.caseId) ||
      value.title !== 'Anonymized steward case' ||
      value.createdAt !== 0 ||
      value.identity.leagueId !== 'league-redacted' ||
      value.identity.leagueName !== 'League redacted' ||
      value.identity.eventId !== 'event-redacted' ||
      value.identity.eventName !== 'Event redacted' ||
      !/^session-[a-f0-9]{8}$/.test(value.identity.sessionId) ||
      value.identity.sim !== 'Sim redacted' ||
      value.identity.sessionType !== 'Session redacted' ||
      value.identity.trackName !== 'Track redacted' ||
      value.identity.startedAt !== undefined ||
      value.importProvenance !== undefined ||
      value.importCompleted !== undefined) {
    throw new Error('Anonymized case identity contains non-allowlisted data.')
  }
  const actors = [
    value.createdBy,
    ...(value.assignedTo ? [value.assignedTo] : []),
    ...value.bookmarks.map((entry) => entry.createdBy),
    ...value.evidence.map((entry) => entry.lockedBy),
    ...value.rules.map((entry) => entry.citedBy),
    ...value.verdicts.map((entry) => entry.decidedBy),
    ...value.dissents.map((entry) => entry.submittedBy),
    ...value.appeals.flatMap((entry) => [entry.filedBy, ...entry.resolutions.map((item) => item.resolvedBy)])
  ]
  actors.forEach(assertAnonymizedActor)
  value.bookmarks.forEach((entry, index) => {
    if (
      entry.bookmarkId !== `bookmark-${index + 1}` ||
      entry.source !== 'import' ||
      !/^incident-[a-f0-9]{10}$/.test(entry.sourceId) ||
      entry.label !== `Incident bookmark ${index + 1}` ||
      entry.notes !== undefined ||
      (entry.captureSessionId !== undefined && entry.captureSessionId !== value.identity.sessionId)
    ) {
      throw new Error('Anonymized bookmark contains non-allowlisted free-form data.')
    }
  })
  value.evidence.forEach((entry, index) => {
    if (
      entry.evidenceId !== `evidence-${index + 1}` ||
      entry.summary !== `Evidence item ${index + 1}` ||
      (entry.mediaType !== 'application/vnd.ultimate-sim.incident.anonymized+json' &&
        entry.mediaType !== 'application/vnd.ultimate-sim.redacted+json') ||
      entry.provenance.sourceRef !== '[redacted]' ||
      entry.provenance.producer !== 'producer-redacted' ||
      entry.provenance.producerVersion !== 'redacted' ||
      (entry.provenance.sessionRef !== undefined &&
        entry.provenance.sessionRef !== value.identity.sessionId) ||
      (entry.provenance.captureRange !== undefined &&
        entry.provenance.captureRange !== '[normalized]') ||
      (entry.provenance.transform !== undefined && entry.provenance.transform !== 'redacted') ||
      entry.provenance.notes !== undefined ||
      !EVIDENCE_TRUST.has(entry.provenance.trust ?? 'manual-unverified')
    ) {
      throw new Error('Anonymized evidence metadata contains non-allowlisted free-form data.')
    }
  })
  value.rules.forEach((entry, index) => {
    if (
      entry.citationId !== `rule-${index + 1}` ||
      entry.rulesetId !== `ruleset-${index + 1}` ||
      entry.version !== 'redacted' ||
      entry.section !== 'redacted' ||
      entry.title !== `Rule citation ${index + 1}` ||
      entry.text !== 'Free-form rule text removed from anonymized export.' ||
      entry.source !== '[redacted]'
    ) {
      throw new Error('Anonymized rule contains non-allowlisted free-form data.')
    }
  })
  value.verdicts.forEach((entry, index) => {
    if (
      entry.verdictId !== `verdict-${index + 1}` ||
      entry.decisionText !== 'Free-form human decision text removed from anonymized export.' ||
      (entry.actionText !== undefined &&
        entry.actionText !== 'Free-form action text removed from anonymized export.')
    ) {
      throw new Error('Anonymized verdict contains non-allowlisted free-form data.')
    }
  })
  value.dissents.forEach((entry, index) => {
    if (
      entry.dissentId !== `dissent-${index + 1}` ||
      entry.statement !== 'Free-form dissent statement removed from anonymized export.' ||
      entry.grounds !== 'Free-form dissent grounds removed from anonymized export.'
    ) {
      throw new Error('Anonymized dissent contains non-allowlisted free-form data.')
    }
  })
  value.appeals.forEach((entry, index) => {
    if (
      entry.appealId !== `appeal-${index + 1}` ||
      entry.grounds !== 'Free-form appeal grounds removed from anonymized export.' ||
      entry.requestedRemedy !== 'Free-form requested remedy removed from anonymized export.' ||
      entry.resolutions.some((resolution, resolutionIndex) =>
        resolution.resolutionId !== `resolution-${index + 1}-${resolutionIndex + 1}` ||
        resolution.reasoning !== 'Free-form appeal resolution reasoning removed from anonymized export.')
    ) {
      throw new Error('Anonymized appeal contains non-allowlisted free-form data.')
    }
  })
}

export function serializeStewardExportBundle(bundle: StewardExportBundle): string {
  return canonicalStringify(bundle, PACKAGE_MAX_CANONICAL_BYTES)
}

export function parseStewardExportBundle(raw: string): StewardExportBundle {
  if (Buffer.byteLength(raw, 'utf8') > STEWARD_PACKAGE_MAX_BYTES + 4 * 1024 * 1024) {
    throw new Error('Steward package framing exceeds 20 MiB.')
  }
  const parsed = plain(JSON.parse(raw) as unknown, 'package')
  canonicalStringify(parsed, PACKAGE_MAX_CANONICAL_BYTES)
  if (parsed.magic !== STEWARD_EXPORT_MAGIC || parsed.version !== STEWARD_EXPORT_VERSION) {
    throw new Error('Unsupported steward package.')
  }
  const packageHash = hash(parsed.packageHash, 'package.packageHash')
  const { packageHash: _packageHash, ...unsigned } = parsed
  if (sha256Canonical(unsigned, PACKAGE_MAX_CANONICAL_BYTES) !== packageHash) {
    throw new Error('Steward package hash mismatch.')
  }
  return parsed as unknown as StewardExportBundle
}

function rebaseAnonymizedCase(value: StewardPortableCase, baseTime: number): StewardPortableCase {
  const at = (relative: number): number => baseTime + relative
  return {
    ...value,
    createdAt: baseTime,
    bookmarks: value.bookmarks.map((entry) => ({
      ...entry,
      ...(entry.occurredAt === undefined ? {} : { occurredAt: at(entry.occurredAt) }),
      createdAt: at(entry.createdAt)
    })),
    evidence: value.evidence.map((entry) => ({
      ...entry,
      provenance: {
        ...entry.provenance,
        capturedAt: at(entry.provenance.capturedAt)
      },
      lockedAt: at(entry.lockedAt)
    })),
    rules: value.rules.map((entry) => ({ ...entry, citedAt: at(entry.citedAt) })),
    verdicts: value.verdicts.map((entry) => ({ ...entry, decidedAt: at(entry.decidedAt) })),
    dissents: value.dissents.map((entry) => ({ ...entry, submittedAt: at(entry.submittedAt) })),
    appeals: value.appeals.map((entry) => ({
      ...entry,
      filedAt: at(entry.filedAt),
      resolutions: entry.resolutions.map((resolution) => ({
        ...resolution,
        resolvedAt: at(resolution.resolvedAt)
      }))
    }))
  }
}

function normalizeImportedSourceClaims(
  value: StewardPortableCase,
  sourcePackageHash: string
): StewardPortableCase {
  const aliases = new Map<string, StewardActor>()
  const counters = new Map<StewardClaimedActorRole, number>()
  const normalizeActor = (entry: StewardActor): StewardActor => {
    const claimedRole = entry.role === 'source-claim'
      ? entry.claimedRole ?? 'observer'
      : entry.role
    const key = canonicalStringify({
      id: entry.id,
      displayName: entry.displayName,
      role: entry.role,
      claimedRole
    })
    const existing = aliases.get(key)
    if (existing) return cloneJson(existing)
    const next = (counters.get(claimedRole) ?? 0) + 1
    counters.set(claimedRole, next)
    const alias: StewardActor = {
      id: `source-claim-${sha256Canonical({ sourcePackageHash, key }).slice(0, 16)}`,
      displayName: `Imported ${claimedRole} claim ${next}`,
      role: 'source-claim',
      claimedRole
    }
    aliases.set(key, alias)
    return cloneJson(alias)
  }
  const {
    manualReviewMigration: _sourceManualReviewMigration,
    ...sourceWithoutMigration
  } = cloneJson(value, PACKAGE_MAX_CANONICAL_BYTES)
  return {
    ...sourceWithoutMigration,
    createdBy: normalizeActor(value.createdBy),
    ...(value.assignedTo ? { assignedTo: normalizeActor(value.assignedTo) } : {}),
    bookmarks: value.bookmarks.map((entry) => ({
      ...entry,
      createdBy: normalizeActor(entry.createdBy)
    })),
    evidence: value.evidence.map((entry) => ({
      ...entry,
      provenance: {
        ...entry.provenance,
        sourceKind: 'import',
        sourceRef: `source-claim-${sha256Canonical({
          sourcePackageHash,
          evidenceId: entry.evidenceId,
          sourceRef: entry.provenance.sourceRef
        }).slice(0, 16)}`,
        producer: 'Imported source claim',
        producerVersion: 'untrusted',
        trust: 'imported-source-claim',
        ...(entry.provenance.sessionRef ? { sessionRef: value.identity.sessionId } : {})
      },
      lockedBy: normalizeActor(entry.lockedBy)
    })),
    rules: value.rules.map((entry) => ({
      ...entry,
      citedBy: normalizeActor(entry.citedBy)
    })),
    verdicts: value.verdicts.map((entry) => ({
      ...entry,
      authority: 'imported-source-claim',
      manualReviewConfirmed: false,
      decidedBy: normalizeActor(entry.decidedBy)
    })),
    dissents: value.dissents.map((entry) => ({
      ...entry,
      submittedBy: normalizeActor(entry.submittedBy)
    })),
    appeals: value.appeals.map((entry) => ({
      ...entry,
      authority: 'imported-source-claim',
      filedBy: normalizeActor(entry.filedBy),
      resolutions: entry.resolutions.map((resolution) => ({
        ...resolution,
        authority: 'imported-source-claim',
        resolvedBy: normalizeActor(resolution.resolvedBy)
      }))
    }))
  }
}

interface StewardEventSpec {
  type: StewardCaseEventType
  actor: StewardActor
  payload: unknown
  occurredAt?: number
}

function portableCaseEventSpecs(value: StewardPortableCase): StewardEventSpec[] {
  const primary = value.bookmarks[0]
  const events: StewardEventSpec[] = [
    {
      type: 'case-created',
      actor: value.createdBy,
      occurredAt: value.createdAt,
      payload: {
        title: value.title,
        identity: value.identity,
        incident: primary,
        primaryIncidentFingerprint: eventFingerprint(value.identity, primary),
        ...(value.assignedTo ? { assignedTo: value.assignedTo } : {})
      } satisfies CaseCreatedPayload
    },
    ...value.bookmarks.slice(1).map((bookmark) => ({
      type: 'bookmark-added' as const,
      actor: bookmark.createdBy,
      occurredAt: bookmark.createdAt,
      payload: { bookmark }
    })),
    ...value.evidence.map((evidence) => ({
      type: 'evidence-locked' as const,
      actor: evidence.lockedBy,
      occurredAt: evidence.lockedAt,
      payload: { evidence: { ...evidence, state: 'available' as const } }
    })),
    ...value.rules.map((citation) => ({
      type: 'rule-version-cited' as const,
      actor: citation.citedBy,
      occurredAt: citation.citedAt,
      payload: { citation }
    })),
    ...value.verdicts.map((verdict) => ({
      type: 'human-verdict-recorded' as const,
      actor: verdict.decidedBy,
      occurredAt: verdict.decidedAt,
      payload: { verdict }
    })),
    ...value.dissents.map((dissent) => ({
      type: 'dissent-recorded' as const,
      actor: dissent.submittedBy,
      occurredAt: dissent.submittedAt,
      payload: { dissent }
    }))
  ]
  for (const appeal of value.appeals) {
    events.push({
      type: 'appeal-filed',
      actor: appeal.filedBy,
      occurredAt: appeal.filedAt,
      payload: { appeal: { ...appeal, status: 'open', resolutions: [] } }
    })
    for (const resolution of appeal.resolutions) {
      events.push({
        type: 'appeal-resolved',
        actor: resolution.resolvedBy,
        occurredAt: resolution.resolvedAt,
        payload: { appealId: appeal.appealId, resolution }
      })
    }
  }
  events.push({
    type: 'case-status-set',
    actor: value.assignedTo ?? value.createdBy,
    payload: { status: value.status }
  })
  return events
}

function canonicalEventRecords(
  caseId: string,
  events: readonly StewardEventSpec[],
  eventId: (index: number) => string
): StewardEventRecord[] {
  let previousHash = ZERO_HASH
  let occurredAt = Math.trunc(events[0]?.occurredAt ?? 0)
  return events.map((event, index) => {
    occurredAt = index === 0
      ? Math.trunc(event.occurredAt ?? occurredAt)
      : Math.max(Math.trunc(event.occurredAt ?? occurredAt + 1), occurredAt + 1)
    const unsigned = eventUnsigned({
      schemaVersion: STEWARD_CASE_SCHEMA_VERSION,
      caseId,
      eventId: eventId(index),
      sequence: index + 1,
      type: event.type,
      occurredAt,
      actor: cloneJson(event.actor),
      payload: cloneJson(event.payload),
      previousHash
    })
    const record: StewardEventRecord = {
      ...unsigned,
      eventHash: sha256Canonical(unsigned)
    }
    previousHash = record.eventHash
    return record
  })
}

export class StewardCaseStore {
  private readonly rootDir: string
  private readonly casesDir: string
  private readonly evidenceDir: string
  private readonly stagingDir: string
  private readonly quarantineDir: string
  private readonly now: () => number
  private readonly idFactory: () => string
  private readonly importFault?: StewardCaseStoreOptions['importFault']

  constructor(options: StewardCaseStoreOptions) {
    this.rootDir = options.rootDir
    this.casesDir = join(this.rootDir, 'cases')
    this.evidenceDir = join(this.rootDir, 'evidence')
    this.stagingDir = join(this.rootDir, 'import-staging')
    this.quarantineDir = join(this.rootDir, 'quarantine')
    this.now = options.now ?? Date.now
    this.idFactory = options.idFactory ?? randomUUID
    this.importFault = options.importFault
    mkdirSync(this.casesDir, { recursive: true })
    mkdirSync(this.evidenceDir, { recursive: true })
    mkdirSync(this.stagingDir, { recursive: true })
    mkdirSync(this.quarantineDir, { recursive: true })
  }

  listCases(): StewardCase[] {
    const names = readdirSync(this.casesDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && CASE_FILE.test(entry.name))
      .map((entry) => entry.name)
    return names
      .map((name) => this.loadCase(name.slice(0, -'.jsonl'.length)).value)
      .sort((left, right) => right.createdAt - left.createdAt || left.caseId.localeCompare(right.caseId))
  }

  getCase(caseId: string): StewardCase | null {
    const normalized = identifier(caseId, 'caseId')
    const path = this.casePath(normalized)
    return existsSync(path) ? this.loadCase(normalized).value : null
  }

  getEvidenceDetails(caseId: string, evidenceId: string): StewardEvidenceDetails {
    const current = this.mutableCase(caseId).value
    const normalizedEvidenceId = identifier(evidenceId, 'evidenceId')
    const evidence = current.evidence.find((entry) => entry.evidenceId === normalizedEvidenceId)
    if (!evidence || evidence.state !== 'available') {
      throw new Error(`Evidence ${normalizedEvidenceId} is not available.`)
    }
    return {
      caseId: current.caseId,
      evidence,
      content: this.readEvidence(evidence.contentHash),
      contentHashVerified: true,
      chainState: 'unanchored',
      verifiedAt: Math.trunc(this.now())
    }
  }

  createCase(input: StewardCaseCreateInput): StewardCase {
    const normalizedIncident = bookmarkInput(input.incident)
    if (normalizedIncident.source === 'incident-recorder') {
      throw new Error('Incident-recorder cases must be derived from a verified persisted clip.')
    }
    return this.createCaseWithIncident(input, identity(input.identity), normalizedIncident)
  }

  createCaseFromIncidentClip(
    input: StewardCaseCreateInput,
    verifiedClip: VerifiedIncidentClip
  ): StewardCase {
    const clip = assertVerifiedIncidentClip(verifiedClip)
    const capture = incidentClipIdentity(clip)
    const normalizedIdentity = identity({
      ...input.identity,
      sessionId: capture.captureSession.captureSessionId,
      sim: capture.captureSession.sim,
      sessionType: capture.captureSession.sessionType ?? input.identity.sessionType,
      trackName: capture.captureSession.trackName ?? input.identity.trackName,
      startedAt: capture.captureSession.startedAt
    })
    const normalizedIncident = bookmarkInput({
      source: 'incident-recorder',
      sourceId: capture.id,
      label: input.incident.label,
      occurredAt: clip.at,
      ...(clip.lap === undefined ? {} : { lap: clip.lap }),
      ...(clip.lapDistPct === undefined ? {} : { lapDistPct: clip.lapDistPct }),
      captureSessionId: capture.captureSession.captureSessionId,
      windowBeforeSec: 4,
      windowAfterSec: 3
    })
    assertIncidentCaptureSession(normalizedIdentity, capture.captureSession)
    return this.createCaseWithIncident(input, normalizedIdentity, normalizedIncident)
  }

  private createCaseWithIncident(
    input: StewardCaseCreateInput,
    normalizedIdentity: StewardRaceSessionIdentity,
    normalizedIncident: StewardIncidentBookmarkInput
  ): StewardCase {
    const owner = decisionActor(input.actor)
    const fingerprint = eventFingerprint(normalizedIdentity, normalizedIncident)
    const duplicate = this.listCases().find(
      (entry) => entry.integrity.state === 'unanchored' && entry.primaryIncidentFingerprint === fingerprint
    )
    if (duplicate) throw new Error(`Duplicate incident is already tracked by ${duplicate.caseId}.`)

    const caseId = this.newId('case')
    const occurredAt = Math.trunc(this.now())
    const incident: StewardIncidentBookmark = {
      ...normalizedIncident,
      bookmarkId: normalizedIncident.bookmarkId ?? this.newId('bookmark'),
      createdAt: occurredAt,
      createdBy: owner
    }
    const assignedTo = input.assignedTo ? decisionActor(input.assignedTo, 'assignedTo') : undefined
    this.appendEvent(caseId, 'case-created', owner, {
      title: text(input.title, 'title', 300),
      identity: normalizedIdentity,
      incident,
      primaryIncidentFingerprint: fingerprint,
      ...(assignedTo ? { assignedTo } : {})
    } satisfies CaseCreatedPayload)
    return this.requireCase(caseId).value
  }

  assignCase(input: StewardCaseAssignmentInput): StewardCase {
    const owner = decisionActor(input.actor)
    const assignedTo = decisionActor(input.assignedTo, 'assignedTo')
    const current = this.mutableCase(input.caseId)
    if (current.value.assignedTo && actorsMatch(current.value.assignedTo, assignedTo)) return current.value
    this.appendEvent(current.value.caseId, 'case-assigned', owner, { assignedTo })
    return this.requireCase(current.value.caseId).value
  }

  setStatus(input: StewardCaseStatusInput): StewardCase {
    const owner = decisionActor(input.actor)
    const current = this.mutableCase(input.caseId)
    if (!CASE_STATUSES.has(input.status)) throw new Error('Unsupported steward case status.')
    if (
      current.value.manualReviewMigration?.pendingVerdictIds.length &&
      (input.status === 'decided' || input.status === 'appealed' || input.status === 'closed')
    ) {
      throw new Error('Legacy verdicts require trusted local re-adjudication before authoritative status.')
    }
    if (
      current.value.appeals.some((entry) => isTrustedLocalAppeal(entry) && entry.status === 'open') &&
      input.status !== 'appealed'
    ) {
      throw new Error('Case status is derived as appealed while any appeal is open.')
    }
    if (current.value.status === input.status) return current.value
    this.appendEvent(current.value.caseId, 'case-status-set', owner, { status: input.status })
    return this.requireCase(current.value.caseId).value
  }

  addBookmark(input: StewardBookmarkAddInput): StewardCase {
    const owner = decisionActor(input.actor)
    const current = this.mutableCase(input.caseId)
    const normalized = bookmarkInput(input.bookmark)
    if (normalized.source === 'incident-recorder') {
      throw new Error('Incident-recorder bookmarks must be derived from a verified persisted clip.')
    }
    const fingerprint = eventFingerprint(current.value.identity, normalized)
    const duplicate = current.value.bookmarks.some(
      (entry) => eventFingerprint(current.value.identity, entry) === fingerprint
    )
    if (duplicate) return current.value
    const bookmark: StewardIncidentBookmark = {
      ...normalized,
      bookmarkId: normalized.bookmarkId ?? this.newId('bookmark'),
      createdAt: Math.trunc(this.now()),
      createdBy: owner
    }
    this.appendEvent(current.value.caseId, 'bookmark-added', owner, { bookmark })
    return this.requireCase(current.value.caseId).value
  }

  lockEvidence(input: StewardEvidenceLockInput): StewardCase {
    const provenance = evidenceProvenance(input.provenance)
    if (provenance.sourceKind === 'incident-recorder') {
      throw new Error('Incident-recorder evidence must be derived from a verified persisted clip.')
    }
    return this.lockEvidenceRecord(input, { ...provenance, trust: 'manual-unverified' })
  }

  private lockEvidenceRecord(
    input: StewardEvidenceLockInput,
    provenance: StewardEvidenceProvenance
  ): StewardCase {
    const owner = decisionActor(input.actor)
    const current = this.mutableCase(input.caseId)
    const evidenceId = input.evidenceId ? identifier(input.evidenceId, 'evidenceId') : this.newId('evidence')
    const canonical = canonicalStringify(input.content)
    const contentHash = sha256Text(canonical)
    const existing = current.value.evidence.find((entry) => entry.evidenceId === evidenceId)
    if (existing) {
      if (existing.contentHash === contentHash) return current.value
      throw new Error(`Evidence id ${evidenceId} already exists with different content.`)
    }
    this.writeEvidence(contentHash, canonical)
    const evidence: StewardEvidenceLock = {
      evidenceId,
      summary: text(input.summary, 'evidence.summary', 1_000),
      mediaType: text(input.mediaType, 'evidence.mediaType', 120),
      contentHash,
      byteLength: Buffer.byteLength(canonical, 'utf8'),
      provenance,
      lockedAt: Math.trunc(this.now()),
      lockedBy: owner,
      state: 'available'
    }
    this.appendEvent(current.value.caseId, 'evidence-locked', owner, { evidence })
    return this.requireCase(current.value.caseId).value
  }

  lockIncidentClip(
    caseId: string,
    eventActor: StewardActor,
    verifiedClip: VerifiedIncidentClip
  ): StewardCase {
    const clip = assertVerifiedIncidentClip(verifiedClip)
    const capture = incidentClipIdentity(clip)
    const current = this.mutableCase(caseId)
    assertIncidentCaptureSession(current.value.identity, capture.captureSession)
    const provenance = evidenceProvenance({
      sourceKind: 'incident-recorder',
      sourceRef: capture.id,
      producer: 'Ultimate Sim App incident recorder',
      producerVersion: '1',
      capturedAt: numberValue(clip.createdAt, 'incident clip.createdAt'),
      sessionRef: capture.captureSession.captureSessionId,
      captureRange: `${clip.window[0]?.t ?? clip.at}-${clip.window.at(-1)?.t ?? clip.at}`,
      transform: 'incident-recorder.v1',
      trust: 'local-user-sealed'
    })
    return this.lockEvidenceRecord({
      caseId,
      actor: eventActor,
      evidenceId: `incident-${sha256Text(capture.id).slice(0, 24)}`,
      summary: `${text(clip.type, 'incident clip.type', 40)} · ${capture.id}`,
      mediaType: 'application/vnd.ultimate-sim.incident+json',
      content: clip,
      provenance
    }, provenance)
  }

  citeRule(input: StewardRuleCitationInput): StewardCase {
    const owner = decisionActor(input.actor)
    const current = this.mutableCase(input.caseId)
    const citationId = input.citationId ? identifier(input.citationId, 'citationId') : this.newId('rule')
    const content = {
      rulesetId: text(input.rulesetId, 'rule.rulesetId', 160),
      version: text(input.version, 'rule.version', 100),
      section: text(input.section, 'rule.section', 160),
      title: text(input.title, 'rule.title', 300),
      text: text(input.text, 'rule.text', 20_000),
      source: text(input.source, 'rule.source', 500)
    }
    const contentHash = sha256Canonical(content)
    const existing = current.value.rules.find((entry) => entry.citationId === citationId)
    if (existing) {
      if (existing.contentHash === contentHash) return current.value
      throw new Error(`Rule citation id ${citationId} already exists with different content.`)
    }
    const citation: StewardRuleCitation = {
      citationId,
      ...content,
      contentHash,
      citedAt: Math.trunc(this.now()),
      citedBy: owner
    }
    this.appendEvent(current.value.caseId, 'rule-version-cited', owner, { citation })
    return this.requireCase(current.value.caseId).value
  }

  recordVerdict(input: StewardVerdictInput): StewardCase {
    const owner = decisionActor(input.actor)
    const current = this.mutableCase(input.caseId)
    if (!FINDINGS.has(input.finding)) throw new Error('Unsupported verdict finding.')
    if (input.manualReviewConfirmed !== true) {
      throw new Error('A trusted local verdict requires explicit manual review of evidence provenance.')
    }
    const ruleCitationIds = stringIds(input.ruleCitationIds, 'ruleCitationIds')
    const evidenceIds = stringIds(input.evidenceIds, 'evidenceIds')
    const verdictId = input.verdictId ? identifier(input.verdictId, 'verdictId') : this.newId('verdict')
    if (current.value.verdicts.some((entry) => entry.verdictId === verdictId)) {
      throw new Error(`Verdict id ${verdictId} already exists.`)
    }
    const supersedesVerdictId = input.supersedesVerdictId
      ? identifier(input.supersedesVerdictId, 'supersedesVerdictId')
      : undefined
    const actionText = optionalText(input.actionText, 'actionText', 4_000)
    const verdict: StewardHumanVerdict = {
      verdictId,
      finding: input.finding,
      decisionText: text(input.decisionText, 'decisionText', 8_000),
      ...(actionText ? { actionText } : {}),
      ruleCitationIds,
      evidenceIds,
      ...(supersedesVerdictId ? { supersedesVerdictId } : {}),
      authority: 'local-trusted',
      manualReviewConfirmed: true,
      decidedAt: Math.trunc(this.now()),
      decidedBy: owner
    }
    assertVerdictInvariants(verdict, current.value.rules, current.value.evidence, current.value.verdicts)
    this.appendEvent(current.value.caseId, 'human-verdict-recorded', owner, { verdict })
    return this.requireCase(current.value.caseId).value
  }

  recordDissent(input: StewardDissentInput): StewardCase {
    const submittedBy = actor(input.actor)
    if (submittedBy.role === 'observer') throw new Error('Observers cannot submit dissent.')
    const current = this.mutableCase(input.caseId)
    const verdictId = identifier(input.verdictId, 'verdictId')
    const verdict = current.value.verdicts.find((entry) => entry.verdictId === verdictId)
    if (!verdict) {
      throw new Error(`Verdict ${verdictId} does not exist.`)
    }
    if (!isTrustedLocalVerdict(verdict)) {
      throw new Error('Unconfirmed verdicts require local trusted re-adjudication before dissent.')
    }
    const dissentId = input.dissentId ? identifier(input.dissentId, 'dissentId') : this.newId('dissent')
    if (current.value.dissents.some((entry) => entry.dissentId === dissentId)) {
      throw new Error(`Dissent id ${dissentId} already exists.`)
    }
    const dissent: StewardDissent = {
      dissentId,
      verdictId,
      statement: text(input.statement, 'statement', 8_000),
      grounds: text(input.grounds, 'grounds', 4_000),
      submittedAt: Math.trunc(this.now()),
      submittedBy
    }
    this.appendEvent(current.value.caseId, 'dissent-recorded', submittedBy, { dissent })
    return this.requireCase(current.value.caseId).value
  }

  fileAppeal(input: StewardAppealInput): StewardCase {
    const filedBy = actor(input.actor)
    if (filedBy.role === 'observer') throw new Error('Observers cannot file an appeal.')
    const current = this.mutableCase(input.caseId)
    const verdictId = identifier(input.verdictId, 'verdictId')
    const verdict = current.value.verdicts.find((entry) => entry.verdictId === verdictId)
    if (!verdict) {
      throw new Error(`Verdict ${verdictId} does not exist.`)
    }
    if (!isTrustedLocalVerdict(verdict)) {
      throw new Error('Unconfirmed verdicts require local trusted re-adjudication before appeal.')
    }
    const appealId = input.appealId ? identifier(input.appealId, 'appealId') : this.newId('appeal')
    if (current.value.appeals.some((entry) => entry.appealId === appealId)) {
      throw new Error(`Appeal id ${appealId} already exists.`)
    }
    const appeal: StewardAppeal = {
      appealId,
      verdictId,
      grounds: text(input.grounds, 'grounds', 8_000),
      requestedRemedy: text(input.requestedRemedy, 'requestedRemedy', 4_000),
      authority: 'local-trusted',
      filedAt: Math.trunc(this.now()),
      filedBy,
      status: 'open',
      resolutions: []
    }
    this.appendEvent(current.value.caseId, 'appeal-filed', filedBy, { appeal })
    return this.requireCase(current.value.caseId).value
  }

  resolveAppeal(input: StewardAppealResolutionInput): StewardCase {
    const resolvedBy = decisionActor(input.actor)
    const current = this.mutableCase(input.caseId)
    const appealId = identifier(input.appealId, 'appealId')
    const appeal = current.value.appeals.find((entry) => entry.appealId === appealId)
    if (!appeal) throw new Error(`Appeal ${appealId} does not exist.`)
    if (!isTrustedLocalAppeal(appeal)) {
      throw new Error('Unconfirmed appeal claims require local trusted re-adjudication.')
    }
    if (appeal.status !== 'open') throw new Error(`Appeal ${appealId} is already resolved.`)
    if (!RESOLUTIONS.has(input.resolution)) throw new Error('Unsupported appeal resolution.')
    const resolution: StewardAppealResolution = {
      resolutionId: input.resolutionId
        ? identifier(input.resolutionId, 'resolutionId')
        : this.newId('resolution'),
      resolution: input.resolution,
      reasoning: text(input.reasoning, 'reasoning', 8_000),
      authority: 'local-trusted',
      resolvedAt: Math.trunc(this.now()),
      resolvedBy
    }
    this.appendEvent(current.value.caseId, 'appeal-resolved', resolvedBy, { appealId, resolution })
    return this.requireCase(current.value.caseId).value
  }

  exportCase(caseId: string, profile: StewardExportProfile): StewardExportBundle {
    if (profile !== 'full-local' && profile !== 'anonymized') throw new Error('Unsupported steward export profile.')
    const loaded = this.mutableCase(caseId)
    const current = loaded.value
    if (!current.integrity.headHash) throw new Error('Case has no chain head.')
    if (current.bookmarks.some((entry) =>
      entry.source === 'incident-recorder' && entry.captureSessionId !== current.identity.sessionId)) {
      throw new Error('Case cannot be exported because an incident bookmark lacks verified capture-session identity.')
    }
    const sourcePortable = portableCase(current)
    const sourceEvidence: StewardExportEvidence[] = current.evidence.map((entry) => ({
      evidenceId: entry.evidenceId,
      contentHash: entry.contentHash,
      content: this.readEvidence(entry.contentHash)
    }))
    for (const entry of sourceEvidence) {
      const restriction = evidenceRightsRestriction(entry.content)
      if (restriction) {
        throw new Error(`Evidence ${entry.evidenceId} cannot be exported because re-export rights are denied: ${restriction}`)
      }
    }
    const projected = profile === 'anonymized'
      ? anonymizeCase(sourcePortable, sourceEvidence, randomUUID())
      : { caseValue: sourcePortable, evidence: sourceEvidence, redactions: [] }
    const events = profile === 'anonymized'
      ? canonicalEventRecords(
          projected.caseValue.caseId,
          portableCaseEventSpecs(projected.caseValue),
          (index) => `event-export-${index + 1}`
        )
      : cloneJson(loaded.records, PACKAGE_MAX_CANONICAL_BYTES)
    const exportedHeadHash = events.at(-1)?.eventHash
    if (!exportedHeadHash) throw new Error('Case export has no canonical event-chain head.')
    const unsigned = {
      magic: STEWARD_EXPORT_MAGIC,
      version: STEWARD_EXPORT_VERSION,
      profile,
      exportedAt: profile === 'anonymized' ? 0 : Math.trunc(this.now()),
      source: {
        caseRef: profile === 'anonymized' ? projected.caseValue.caseId : current.caseId,
        headHash: exportedHeadHash,
        integrityState: 'unanchored' as const,
        eventCount: events.length
      },
      trustModel: STEWARD_EXPORT_TRUST_MODEL,
      case: projected.caseValue,
      events,
      evidence: projected.evidence,
      redactions: projected.redactions
    }
    const bundle = {
      ...unsigned,
      packageHash: sha256Canonical(unsigned, PACKAGE_MAX_CANONICAL_BYTES)
    }
    canonicalStringify(bundle, PACKAGE_MAX_CANONICAL_BYTES)
    return bundle
  }

  importCase(raw: string): StewardCase {
    return this.importCaseWithResult(raw).caseValue
  }

  importCaseWithResult(raw: string): StewardCaseImportOutcome {
    const bundle = this.validateBundle(parseStewardExportBundle(raw))
    const priorImports = this.listCases().filter(
      (entry) => entry.importProvenance?.sourcePackageHash === bundle.packageHash
    )
    const completed = priorImports.find(
      (entry) => entry.importCompleted === true && entry.integrity.state === 'unanchored'
    )
    if (completed) {
      const staleStage = this.importStagingPath(bundle.packageHash)
      if (existsSync(staleStage)) unlinkSync(staleStage)
      return { caseValue: completed, deduplicated: true, retried: false }
    }
    let retried = existsSync(this.importStagingPath(bundle.packageHash))
    for (const incomplete of priorImports) {
      retried = true
      this.quarantineIncompleteImport(incomplete.caseId, bundle.packageHash)
    }

    const packageCase = bundle.profile === 'anonymized'
      ? rebaseAnonymizedCase(bundle.case, Math.trunc(this.now()))
      : bundle.case
    const sourceClaimCase = normalizeImportedSourceClaims(packageCase, bundle.packageHash)
    const primary = sourceClaimCase.bookmarks[0]
    const duplicate = this.listCases().find(
      (entry) =>
        entry.integrity.state === 'unanchored' &&
        entry.primaryIncidentFingerprint === eventFingerprint(sourceClaimCase.identity, primary)
    )
    if (duplicate) throw new Error(`Duplicate incident is already tracked by ${duplicate.caseId}.`)

    const importActor = trustedImportActor()
    const { assignedTo: _sourceAssignment, ...unassignedSourceClaimCase } = sourceClaimCase
    const importedCase: StewardPortableCase = {
      ...unassignedSourceClaimCase,
      createdBy: importActor,
      status: 'under-review'
    }
    const caseId = this.newId('case')
    const provenance: StewardImportProvenance = {
      sourcePackageHash: bundle.packageHash,
      sourceHeadHash: bundle.source.headHash,
      sourceCaseRef: bundle.source.caseRef,
      profile: bundle.profile,
      importedAt: Math.trunc(this.now()),
      ...(packageCase.manualReviewMigration
        ? { sourceManualReviewMigration: packageCase.manualReviewMigration }
        : {})
    }
    const stateEvents = portableCaseEventSpecs(importedCase)
    const baseEvents: StewardEventSpec[] = [
      stateEvents[0],
      { type: 'case-imported', actor: importActor, payload: { provenance } }
    ]
    const stagingPath = this.importStagingPath(bundle.packageHash)
    this.writeStagedChain(stagingPath, this.buildEventRecords(caseId, baseEvents))

    const contents = new Map(bundle.evidence.map((entry) => [entry.evidenceId, entry]))
    for (const evidence of importedCase.evidence) {
      const content = contents.get(evidence.evidenceId) as StewardExportEvidence
      this.writeEvidence(evidence.contentHash, canonicalStringify(content.content))
    }
    this.importFault?.('after-evidence')

    const events: StewardEventSpec[] = [
      stateEvents[0],
      {
        type: 'case-imported',
        actor: importActor,
        occurredAt: provenance.importedAt,
        payload: { provenance }
      },
      ...stateEvents.slice(1),
      {
        type: 'import-completed',
        actor: importActor,
        occurredAt: provenance.importedAt + 1,
        payload: { packageHash: bundle.packageHash }
      }
    ]

    const records = this.buildEventRecords(caseId, events)
    this.writeStagedChain(stagingPath, records)
    this.importFault?.('after-stage-write')
    const staged = this.loadCase(caseId, stagingPath)
    if (
      staged.value.integrity.state !== 'unanchored' ||
      staged.value.importCompleted !== true ||
      staged.value.importProvenance?.sourcePackageHash !== bundle.packageHash ||
      canonicalStringify(comparableImportedCase(portableCase(staged.value)), PACKAGE_MAX_CANONICAL_BYTES) !==
        canonicalStringify(comparableImportedCase(importedCase), PACKAGE_MAX_CANONICAL_BYTES)
    ) {
      throw new Error('Staged steward import failed verification.')
    }
    this.importFault?.('before-publish')
    const finalPath = this.casePath(caseId)
    if (existsSync(finalPath)) throw new Error(`Steward case ${caseId} already exists.`)
    renameSync(stagingPath, finalPath)
    return {
      caseValue: this.requireCase(caseId).value,
      deduplicated: false,
      retried
    }
  }

  evidencePath(contentHash: string): string {
    return join(this.evidenceDir, `${hash(contentHash, 'contentHash')}.json`)
  }

  importStagingPath(packageHash: string): string {
    return join(this.stagingDir, `${hash(packageHash, 'packageHash')}.jsonl`)
  }

  private validateBundle(bundle: StewardExportBundle): StewardExportBundle {
    const packageRecord = plain(bundle, 'package')
    onlyKeys(packageRecord, 'package', [
      'magic',
      'version',
      'profile',
      'exportedAt',
      'source',
      'trustModel',
      'case',
      'events',
      'evidence',
      'redactions',
      'packageHash'
    ])
    if (bundle.profile !== 'full-local' && bundle.profile !== 'anonymized') {
      throw new Error('Unsupported steward package profile.')
    }
    const exportedAt = numberValue(bundle.exportedAt, 'package.exportedAt')
    if (bundle.profile === 'anonymized' && exportedAt !== 0) {
      throw new Error('Anonymized steward packages must normalize exportedAt.')
    }
    const source = plain(bundle.source, 'package.source')
    onlyKeys(source, 'package.source', ['caseRef', 'headHash', 'integrityState', 'eventCount'])
    const sourceHeadHash = hash(source.headHash, 'package.source.headHash')
    const sourceCaseRef = text(source.caseRef, 'package.source.caseRef', 160)
    if (source.integrityState !== 'unanchored') throw new Error('Steward package integrity state must be unanchored.')
    const sourceEventCount = numberValue(source.eventCount, 'package.source.eventCount')
    const trustModel = bundle.trustModel === undefined
      ? STEWARD_EXPORT_TRUST_MODEL
      : plain(bundle.trustModel, 'package.trustModel')
    onlyKeys(trustModel, 'package.trustModel', [
      'clipSeal',
      'corruptionAndRendererTamperProtected',
      'appOriginAuthenticated',
      'sameUserProcessAuthenticity',
      'authoritativeVerdictsRequireManualReview'
    ])
    if (
      trustModel.clipSeal !== 'local-user-sealed' ||
      trustModel.corruptionAndRendererTamperProtected !== true ||
      trustModel.appOriginAuthenticated !== false ||
      trustModel.sameUserProcessAuthenticity !== false ||
      trustModel.authoritativeVerdictsRequireManualReview !== true
    ) {
      throw new Error('Steward package trust model overstates local clip authenticity.')
    }
    const caseValue = this.validatePortableCase(bundle.case)
    if (bundle.profile === 'anonymized') assertAnonymizedCaseSchema(caseValue)
    if (sourceCaseRef !== caseValue.caseId) throw new Error('Steward package source case reference mismatch.')
    const events = this.validateExportEvents(bundle.events, caseValue.caseId)
    if (events.length !== sourceEventCount || events.at(-1)?.eventHash !== sourceHeadHash) {
      throw new Error('Steward package source event count or chain head mismatch.')
    }
    const reduced = portableCase(this.reduce(caseValue.caseId, events, [], false))
    if (canonicalStringify(reduced, PACKAGE_MAX_CANONICAL_BYTES) !==
        canonicalStringify(caseValue, PACKAGE_MAX_CANONICAL_BYTES)) {
      throw new Error('Steward package case does not match its verified canonical event chain.')
    }
    const evidenceValues = array(bundle.evidence, 'package.evidence', 5_000).map((entry) => {
      const sourceEvidence = plain(entry, 'package.evidence item')
      onlyKeys(sourceEvidence, 'package.evidence item', ['evidenceId', 'contentHash', 'content'])
      const evidenceId = identifier(sourceEvidence.evidenceId, 'package.evidence.evidenceId')
      const contentHash = hash(sourceEvidence.contentHash, 'package.evidence.contentHash')
      const content = bundle.profile === 'anonymized'
        ? validateAnonymizedEvidenceContent(sourceEvidence.content)
        : cloneJson(sourceEvidence.content)
      if (sha256Canonical(content) !== contentHash) {
        throw new Error(`Evidence ${evidenceId} hash mismatch in steward package.`)
      }
      return { evidenceId, contentHash, content }
    })
    assertUnique(evidenceValues, (entry) => entry.evidenceId, 'package.evidence')
    const byId = new Map(evidenceValues.map((entry) => [entry.evidenceId, entry]))
    if (caseValue.evidence.length !== evidenceValues.length) {
      throw new Error('Steward package evidence manifest is incomplete.')
    }
    for (const entry of caseValue.evidence) {
      const content = byId.get(entry.evidenceId)
      if (!content || content.contentHash !== entry.contentHash) {
        throw new Error(`Evidence ${entry.evidenceId} manifest mismatch.`)
      }
      if (Buffer.byteLength(canonicalStringify(content.content), 'utf8') !== entry.byteLength) {
        throw new Error(`Evidence ${entry.evidenceId} byte length mismatch.`)
      }
    }
    const redactions = array(bundle.redactions, 'package.redactions', 100).map((entry, index) =>
      text(entry, `package.redactions[${index}]`, 500))
    if (bundle.profile === 'anonymized' && redactions.length === 0) {
      throw new Error('Anonymized steward packages must declare their redactions.')
    }
    return {
      ...bundle,
      trustModel: STEWARD_EXPORT_TRUST_MODEL,
      case: caseValue,
      events,
      evidence: evidenceValues,
      redactions
    }
  }

  private validateExportEvents(value: unknown, caseId: string): StewardEventRecord[] {
    const records: StewardEventRecord[] = []
    let previousHash = ZERO_HASH
    let previousOccurredAt = -1
    const eventIds = new Set<string>()
    for (const [index, entry] of array(value, 'package.events', 20_000).entries()) {
      const source = plain(entry, `package.events[${index}]`)
      onlyKeys(source, `package.events[${index}]`, [
        'schemaVersion',
        'caseId',
        'eventId',
        'sequence',
        'type',
        'occurredAt',
        'actor',
        'payload',
        'previousHash',
        'eventHash'
      ])
      const type = text(source.type, `package.events[${index}].type`, 80) as StewardCaseEventType
      if (!SUPPORTED_EVENT_TYPES.has(type)) throw new Error(`package.events[${index}] type is unsupported.`)
      const record: StewardEventRecord = {
        schemaVersion: source.schemaVersion === STEWARD_CASE_SCHEMA_VERSION
          ? STEWARD_CASE_SCHEMA_VERSION
          : (() => { throw new Error(`package.events[${index}] schemaVersion is unsupported.`) })(),
        caseId: identifier(source.caseId, `package.events[${index}].caseId`),
        eventId: identifier(source.eventId, `package.events[${index}].eventId`),
        sequence: numberValue(source.sequence, `package.events[${index}].sequence`, 1),
        type,
        occurredAt: numberValue(source.occurredAt, `package.events[${index}].occurredAt`),
        actor: actor(source.actor, `package.events[${index}].actor`),
        payload: cloneJson(source.payload),
        previousHash: hash(source.previousHash, `package.events[${index}].previousHash`),
        eventHash: hash(source.eventHash, `package.events[${index}].eventHash`)
      }
      if (record.caseId !== caseId) throw new Error('Steward package event case id mismatch.')
      if (record.sequence !== index + 1) throw new Error('Steward package event sequence gap.')
      if (record.previousHash !== previousHash) throw new Error('Steward package event previous hash mismatch.')
      if (record.occurredAt <= previousOccurredAt) throw new Error('Steward package event times are not monotonic.')
      if (eventIds.has(record.eventId)) throw new Error('Steward package contains duplicate event ids.')
      const { eventHash: _eventHash, ...unsigned } = record
      if (sha256Canonical(unsigned) !== record.eventHash) throw new Error('Steward package event hash mismatch.')
      records.push(record)
      eventIds.add(record.eventId)
      previousHash = record.eventHash
      previousOccurredAt = record.occurredAt
    }
    if (records.length === 0) throw new Error('Steward package event chain is empty.')
    return records
  }

  private validatePortableCase(value: unknown): StewardPortableCase {
    const source = plain(value, 'package.case')
    onlyKeys(source, 'package.case', [
      'schemaVersion',
      'caseId',
      'title',
      'createdAt',
      'createdBy',
      'identity',
      'primaryIncidentFingerprint',
      'status',
      'assignedTo',
      'bookmarks',
      'evidence',
      'rules',
      'verdicts',
      'dissents',
      'appeals',
      'manualReviewMigration',
      'importProvenance',
      'importCompleted'
    ])
    if (source.schemaVersion !== STEWARD_CASE_SCHEMA_VERSION) throw new Error('Unsupported steward case schema.')
    const status = text(source.status, 'package.case.status', 30) as StewardCaseStatus
    if (!CASE_STATUSES.has(status)) throw new Error('Unsupported steward case status.')
    const bookmarks = array(source.bookmarks, 'package.case.bookmarks', 5_000).map(bookmarkRecord)
    if (bookmarks.length === 0) throw new Error('Steward case must contain a primary incident bookmark.')
    const evidence = array(source.evidence, 'package.case.evidence', 5_000).map(evidenceRecord)
    const rules = array(source.rules, 'package.case.rules', 5_000).map(ruleRecord)
    const verdicts = array(source.verdicts, 'package.case.verdicts', 5_000).map(verdictRecord)
    const dissents = array(source.dissents, 'package.case.dissents', 5_000).map(dissentRecord)
    const appeals = array(source.appeals, 'package.case.appeals', 5_000).map(appealRecord)
    assertUnique(bookmarks, (entry) => entry.bookmarkId, 'package.case.bookmarks')
    assertUnique(evidence, (entry) => entry.evidenceId, 'package.case.evidence')
    assertUnique(rules, (entry) => entry.citationId, 'package.case.rules')
    assertUnique(verdicts, (entry) => entry.verdictId, 'package.case.verdicts')
    assertUnique(dissents, (entry) => entry.dissentId, 'package.case.dissents')
    assertUnique(appeals, (entry) => entry.appealId, 'package.case.appeals')
    if (evidence.some((entry) => entry.state !== 'available')) {
      throw new Error('Steward packages may contain only available evidence.')
    }
    const verdictIds = new Set(verdicts.map((entry) => entry.verdictId))
    for (const [index, verdict] of verdicts.entries()) {
      assertVerdictInvariants(verdict, rules, evidence, verdicts.slice(0, index))
    }
    for (const dissent of dissents) {
      if (!verdictIds.has(dissent.verdictId)) throw new Error('Dissent references an unknown verdict.')
    }
    for (const appeal of appeals) {
      if (!verdictIds.has(appeal.verdictId)) throw new Error('Appeal references an unknown verdict.')
    }
    const manualReviewMigration = deriveManualReviewMigration(verdicts)
    if (source.manualReviewMigration !== undefined) {
      const packagedMigration = manualReviewMigrationRecord(source.manualReviewMigration)
      if (
        canonicalStringify(packagedMigration) !==
        canonicalStringify(manualReviewMigration)
      ) {
        throw new Error('Manual review migration provenance does not match legacy verdict state.')
      }
    }
    if (appeals.some((entry) => isTrustedLocalAppeal(entry) && entry.status === 'open') && status !== 'appealed') {
      throw new Error('A packaged steward case must remain appealed while any appeal is open.')
    }
    const normalizedIdentity = identity(source.identity)
    for (const bookmark of bookmarks) {
      if (
        bookmark.source === 'incident-recorder' &&
        bookmark.captureSessionId !== normalizedIdentity.sessionId
      ) {
        throw new Error('Packaged incident bookmark does not match the immutable case capture session.')
      }
    }
    const packagedPrimaryIncidentFingerprint = hash(
      source.primaryIncidentFingerprint,
      'package.case.primaryIncidentFingerprint'
    )
    const primaryIncidentFingerprint = eventFingerprint(normalizedIdentity, bookmarks[0])
    if (
      packagedPrimaryIncidentFingerprint !== primaryIncidentFingerprint &&
      packagedPrimaryIncidentFingerprint !== legacyEventFingerprint(normalizedIdentity, bookmarks[0])
    ) {
      throw new Error('Primary incident fingerprint mismatch.')
    }
    const importProvenance = source.importProvenance
      ? importProvenanceRecord(source.importProvenance)
      : undefined
    const importCompleted = source.importCompleted === undefined
      ? undefined
      : source.importCompleted === true
        ? true
        : (() => { throw new Error('package.case.importCompleted must be true when present.') })()
    return {
      schemaVersion: STEWARD_CASE_SCHEMA_VERSION,
      caseId: identifier(source.caseId, 'package.case.caseId'),
      title: text(source.title, 'package.case.title', 300),
      createdAt: numberValue(source.createdAt, 'package.case.createdAt'),
      createdBy: decisionActor(source.createdBy, 'package.case.createdBy'),
      identity: normalizedIdentity,
      primaryIncidentFingerprint,
      status,
      ...(source.assignedTo ? { assignedTo: decisionActor(source.assignedTo, 'package.case.assignedTo') } : {}),
      bookmarks,
      evidence,
      rules,
      verdicts,
      dissents,
      appeals,
      ...(manualReviewMigration ? { manualReviewMigration } : {}),
      ...(importProvenance ? { importProvenance } : {}),
      ...(importCompleted ? { importCompleted } : {})
    }
  }

  private mutableCase(caseId: string): LoadedCase {
    const current = this.requireCase(identifier(caseId, 'caseId'))
    if (current.value.integrity.state !== 'unanchored') {
      throw new Error('Steward case is quarantined because its chain or locked evidence is corrupt.')
    }
    return current
  }

  private requireCase(caseId: string): LoadedCase {
    const path = this.casePath(caseId)
    if (!existsSync(path)) throw new Error(`Steward case ${caseId} was not found.`)
    return this.loadCase(caseId)
  }

  private loadCase(caseId: string, path = this.casePath(caseId)): LoadedCase {
    const failures: string[] = []
    const records: StewardEventRecord[] = []
    const raw = readFileSync(path, 'utf8')
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0)
    let previousHash = ZERO_HASH
    let previousOccurredAt = -1
    const eventIds = new Set<string>()
    for (let index = 0; index < lines.length; index += 1) {
      try {
        const parsed = plain(JSON.parse(lines[index]) as unknown, `event ${index + 1}`)
        onlyKeys(parsed, `event ${index + 1}`, [
          'schemaVersion',
          'caseId',
          'eventId',
          'sequence',
          'type',
          'occurredAt',
          'actor',
          'payload',
          'previousHash',
          'eventHash'
        ])
        const eventHash = hash(parsed.eventHash, `event ${index + 1}.eventHash`)
        const record: StewardEventRecord = {
          schemaVersion: parsed.schemaVersion === STEWARD_CASE_SCHEMA_VERSION
            ? STEWARD_CASE_SCHEMA_VERSION
            : (() => { throw new Error('unsupported schema version') })(),
          caseId: identifier(parsed.caseId, `event ${index + 1}.caseId`),
          eventId: identifier(parsed.eventId, `event ${index + 1}.eventId`),
          sequence: numberValue(parsed.sequence, `event ${index + 1}.sequence`, 1),
          type: text(parsed.type, `event ${index + 1}.type`, 80) as StewardCaseEventType,
          occurredAt: numberValue(parsed.occurredAt, `event ${index + 1}.occurredAt`),
          actor: actor(parsed.actor, `event ${index + 1}.actor`),
          payload: parsed.payload,
          previousHash: hash(parsed.previousHash, `event ${index + 1}.previousHash`),
          eventHash
        }
        if (record.caseId !== caseId) throw new Error('case id mismatch')
        if (record.sequence !== records.length + 1) throw new Error('sequence gap')
        if (record.previousHash !== previousHash) throw new Error('previous hash mismatch')
        if (record.occurredAt <= previousOccurredAt) throw new Error('event times are not monotonic')
        if (eventIds.has(record.eventId)) throw new Error('duplicate event id')
        if (!SUPPORTED_EVENT_TYPES.has(record.type)) throw new Error('unsupported event type')
        const { eventHash: _eventHash, ...unsigned } = record
        if (sha256Canonical(unsigned) !== eventHash) throw new Error('event hash mismatch')
        records.push(record)
        eventIds.add(record.eventId)
        previousHash = eventHash
        previousOccurredAt = record.occurredAt
      } catch (error) {
        failures.push(`event ${index + 1}: ${error instanceof Error ? error.message : String(error)}`)
        break
      }
    }

    if (records.length === 0) return { value: placeholderCase(caseId, failures.length ? failures : ['empty case chain']), records }
    let value: StewardCase
    try {
      value = this.reduce(caseId, records, failures)
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
      value = placeholderCase(caseId, failures)
    }
    return { value, records }
  }

  private reduce(
    caseId: string,
    records: StewardEventRecord[],
    failures: string[],
    verifyEvidence = true
  ): StewardCase {
    const first = records[0]
    if (first.type !== 'case-created') throw new Error('case chain does not begin with case-created')
    const source = plain(first.payload, 'case-created payload')
    onlyKeys(source, 'case-created payload', [
      'title',
      'identity',
      'incident',
      'primaryIncidentFingerprint',
      'assignedTo'
    ])
    const created: CaseCreatedPayload = {
      title: text(source.title, 'case title', 300),
      identity: identity(source.identity),
      incident: bookmarkRecord(source.incident),
      primaryIncidentFingerprint: hash(source.primaryIncidentFingerprint, 'primaryIncidentFingerprint'),
      ...(source.assignedTo ? { assignedTo: decisionActor(source.assignedTo, 'assignedTo') } : {})
    }
    const createdBy = decisionActor(first.actor, 'case-created actor')
    const legacyImportedActor = createdBy.id === 'steward-import' &&
      records.some((record) => record.type === 'case-imported')
    if (!legacyImportedActor) requireMatchingActor(createdBy, created.incident.createdBy, 'case-created')
    if (
      created.incident.captureSessionId &&
      created.incident.captureSessionId !== created.identity.sessionId
    ) {
      throw new Error('case-created incident capture session mismatch')
    }
    const stablePrimaryIncidentFingerprint = eventFingerprint(created.identity, created.incident)
    if (
      stablePrimaryIncidentFingerprint !== created.primaryIncidentFingerprint &&
      legacyEventFingerprint(created.identity, created.incident) !== created.primaryIncidentFingerprint
    ) {
      throw new Error('primary incident fingerprint mismatch')
    }
    const value: StewardCase = {
      schemaVersion: STEWARD_CASE_SCHEMA_VERSION,
      caseId,
      title: created.title,
      createdAt: first.occurredAt,
      createdBy,
      identity: created.identity,
      primaryIncidentFingerprint: stablePrimaryIncidentFingerprint,
      status: 'triage',
      ...(created.assignedTo ? { assignedTo: created.assignedTo } : {}),
      bookmarks: [created.incident],
      evidence: [],
      rules: [],
      verdicts: [],
      dissents: [],
      appeals: [],
      history: [],
      integrity: emptyIntegrity([], records.length, records.at(-1)?.eventHash)
    }

    for (const record of records) {
      const payload = plain(record.payload, `${record.type} payload`)
      switch (record.type) {
        case 'case-created':
          if (record !== first) throw new Error('case chain contains more than one case-created event')
          break
        case 'case-assigned':
          onlyKeys(payload, 'case-assigned payload', ['assignedTo'])
          decisionActor(record.actor, 'case-assigned actor')
          value.assignedTo = decisionActor(payload.assignedTo, 'assignedTo')
          break
        case 'case-status-set': {
          onlyKeys(payload, 'case-status-set payload', ['status'])
          decisionActor(record.actor, 'case-status-set actor')
          const status = text(payload.status, 'status', 30) as StewardCaseStatus
          if (!CASE_STATUSES.has(status)) throw new Error('unsupported case status')
          if (
            value.appeals.some((entry) => isTrustedLocalAppeal(entry) && entry.status === 'open') &&
            status !== 'appealed'
          ) {
            throw new Error('case status must remain appealed while an appeal is open')
          }
          value.status = status
          break
        }
        case 'bookmark-added': {
          onlyKeys(payload, 'bookmark-added payload', ['bookmark'])
          requireDecisionOrImportedClaimEventActor(record.actor, value.importProvenance, 'bookmark-added actor')
          const bookmark = bookmarkRecord(payload.bookmark)
          requireMatchingActor(record.actor, bookmark.createdBy, 'bookmark-added')
          if (bookmark.captureSessionId && bookmark.captureSessionId !== value.identity.sessionId) {
            throw new Error('bookmark capture session mismatch')
          }
          value.bookmarks.push(bookmark)
          break
        }
        case 'evidence-locked': {
          onlyKeys(payload, 'evidence-locked payload', ['evidence'])
          requireDecisionOrImportedClaimEventActor(record.actor, value.importProvenance, 'evidence-locked actor')
          const evidence = evidenceRecord(payload.evidence)
          requireMatchingActor(record.actor, evidence.lockedBy, 'evidence-locked')
          if (
            evidence.provenance.sourceKind === 'incident-recorder' &&
            evidence.provenance.sessionRef !== value.identity.sessionId
          ) {
            throw new Error('incident evidence session reference mismatch')
          }
          value.evidence.push(evidence)
          break
        }
        case 'rule-version-cited': {
          onlyKeys(payload, 'rule-version-cited payload', ['citation'])
          requireDecisionOrImportedClaimEventActor(record.actor, value.importProvenance, 'rule-version-cited actor')
          const citation = ruleRecord(payload.citation)
          requireMatchingActor(record.actor, citation.citedBy, 'rule-version-cited')
          value.rules.push(citation)
          break
        }
        case 'human-verdict-recorded': {
          onlyKeys(payload, 'human-verdict-recorded payload', ['verdict'])
          const verdict = verdictRecord(payload.verdict)
          if (verdict.authority === 'imported-source-claim') {
            requireDecisionOrImportedClaimEventActor(
              record.actor,
              value.importProvenance,
              'human-verdict-recorded actor'
            )
          } else {
            decisionActor(record.actor, 'human-verdict-recorded actor')
          }
          requireMatchingActor(record.actor, verdict.decidedBy, 'human-verdict-recorded')
          assertVerdictInvariants(verdict, value.rules, value.evidence, value.verdicts)
          value.verdicts.push(verdict)
          if (isTrustedLocalVerdict(verdict)) {
            value.status = value.appeals.some((entry) =>
              isTrustedLocalAppeal(entry) && entry.status === 'open') ? 'appealed' : 'decided'
          }
          break
        }
        case 'dissent-recorded': {
          onlyKeys(payload, 'dissent-recorded payload', ['dissent'])
          const dissent = dissentRecord(payload.dissent)
          if (record.actor.role === 'source-claim' && !value.importProvenance) {
            throw new Error('dissent-recorded source claim lacks verified source-package context')
          }
          requireMatchingActor(record.actor, dissent.submittedBy, 'dissent-recorded')
          if (!value.verdicts.some((entry) => entry.verdictId === dissent.verdictId)) {
            throw new Error(`dissent references unknown verdict ${dissent.verdictId}`)
          }
          value.dissents.push(dissent)
          break
        }
        case 'appeal-filed': {
          onlyKeys(payload, 'appeal-filed payload', ['appeal'])
          let appeal = appealRecord(payload.appeal)
          if (appeal.authority === 'imported-source-claim') {
            requireDecisionOrImportedClaimEventActor(record.actor, value.importProvenance, 'appeal-filed actor')
          } else if (record.actor.role === 'source-claim') {
            throw new Error('Trusted local appeal cannot be filed by a source claim.')
          }
          requireMatchingActor(record.actor, appeal.filedBy, 'appeal-filed')
          const targetVerdict = value.verdicts.find((entry) => entry.verdictId === appeal.verdictId)
          if (!targetVerdict) {
            throw new Error(`appeal references unknown verdict ${appeal.verdictId}`)
          }
          if (
            targetVerdict.authority === 'legacy-unconfirmed' &&
            appeal.authority === 'local-trusted'
          ) {
            appeal = {
              ...appeal,
              authority: 'legacy-unconfirmed',
              resolutions: appeal.resolutions.map((entry) => ({
                ...entry,
                authority: 'legacy-unconfirmed'
              }))
            }
          }
          value.appeals.push(appeal)
          if (isTrustedLocalAppeal(appeal)) value.status = 'appealed'
          break
        }
        case 'appeal-resolved': {
          onlyKeys(payload, 'appeal-resolved payload', ['appealId', 'resolution'])
          const appealId = identifier(payload.appealId, 'appealId')
          const target = value.appeals.find((entry) => entry.appealId === appealId)
          if (!target) throw new Error(`appeal resolution references unknown appeal ${appealId}`)
          if (target.status !== 'open') throw new Error(`appeal ${appealId} is already resolved`)
          let resolution = resolutionRecord(payload.resolution)
          if (
            target.authority === 'legacy-unconfirmed' &&
            resolution.authority === 'local-trusted'
          ) {
            resolution = { ...resolution, authority: 'legacy-unconfirmed' }
          }
          if (resolution.authority === 'imported-source-claim') {
            requireDecisionOrImportedClaimEventActor(record.actor, value.importProvenance, 'appeal-resolved actor')
          } else {
            decisionActor(record.actor, 'appeal-resolved actor')
          }
          requireMatchingActor(record.actor, resolution.resolvedBy, 'appeal-resolved')
          target.resolutions.push(resolution)
          target.status = 'resolved'
          if (
            isTrustedLocalAppeal(target) &&
            value.appeals.filter(isTrustedLocalAppeal).every((entry) => entry.status === 'resolved')
          ) {
            value.status = 'decided'
          }
          break
        }
        case 'case-imported':
          onlyKeys(payload, 'case-imported payload', ['provenance'])
          decisionActor(record.actor, 'case-imported actor')
          value.importProvenance = importProvenanceRecord(payload.provenance)
          value.importCompleted = false
          break
        case 'import-completed': {
          onlyKeys(payload, 'import-completed payload', ['packageHash'])
          decisionActor(record.actor, 'import-completed actor')
          const packageHash = hash(payload.packageHash, 'import-completed.packageHash')
          if (!value.importProvenance || value.importProvenance.sourcePackageHash !== packageHash) {
            throw new Error('import-completed marker does not match import provenance')
          }
          value.importCompleted = true
          break
        }
      }
    }
    assertUnique(value.bookmarks, (entry) => entry.bookmarkId, 'bookmarks')
    assertUnique(value.evidence, (entry) => entry.evidenceId, 'evidence')
    assertUnique(value.rules, (entry) => entry.citationId, 'rules')
    assertUnique(value.verdicts, (entry) => entry.verdictId, 'verdicts')
    assertUnique(value.dissents, (entry) => entry.dissentId, 'dissents')
    assertUnique(value.appeals, (entry) => entry.appealId, 'appeals')
    const manualReviewMigration = deriveManualReviewMigration(value.verdicts)
    if (manualReviewMigration) {
      value.manualReviewMigration = manualReviewMigration
      if (manualReviewMigration.pendingVerdictIds.length > 0) value.status = 'under-review'
    }
    if (value.appeals.some((entry) => isTrustedLocalAppeal(entry) && entry.status === 'open')) {
      value.status = 'appealed'
    }

    const evidenceFailures: string[] = []
    value.evidence = verifyEvidence ? value.evidence.map((entry) => {
      const path = this.evidencePath(entry.contentHash)
      if (!existsSync(path)) {
        evidenceFailures.push(`${entry.evidenceId}: locked evidence is missing`)
        return { ...entry, state: 'missing' }
      }
      try {
        const rawEvidence = readFileSync(path, 'utf8')
        if (sha256Text(rawEvidence) !== entry.contentHash) throw new Error('content hash mismatch')
        JSON.parse(rawEvidence)
        return { ...entry, state: 'available' }
      } catch (error) {
        evidenceFailures.push(`${entry.evidenceId}: ${error instanceof Error ? error.message : String(error)}`)
        return { ...entry, state: 'corrupt' }
      }
    }) : value.evidence.map((entry) => ({ ...entry, state: 'available' }))
    const chainFailures = [...failures]
    const integrity = emptyIntegrity(chainFailures, records.length, records.at(-1)?.eventHash)
    if (
      chainFailures.length === 0 &&
      value.importProvenance &&
      value.importCompleted !== true
    ) {
      value.integrity = {
        ...integrity,
        state: 'import-incomplete',
        message: 'Imported case has no matching import-completed marker and is quarantined.',
        failures: ['import-completed marker missing']
      }
    } else if (chainFailures.length === 0 && evidenceFailures.length > 0) {
      const missing = value.evidence.some((entry) => entry.state === 'missing')
      value.integrity = {
        ...integrity,
        state: missing ? 'evidence-missing' : 'evidence-corrupt',
        evidenceValid: false,
        message: missing
          ? 'One or more locked evidence files are missing. The case is quarantined.'
          : 'One or more locked evidence files failed their content hash. The case is quarantined.',
        failures: evidenceFailures
      }
    } else {
      value.integrity = integrity
    }
    value.history = records.map((record): StewardCaseEventSummary => ({
      eventId: record.eventId,
      sequence: record.sequence,
      type: record.type,
      occurredAt: record.occurredAt,
      actor: record.actor,
      eventHash: record.eventHash
    }))
    return value
  }

  private buildEventRecords(
    caseId: string,
    events: readonly StewardEventSpec[]
  ): StewardEventRecord[] {
    return canonicalEventRecords(caseId, events, () => this.newId('event'))
  }

  private writeStagedChain(path: string, records: readonly StewardEventRecord[]): void {
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
    let descriptor: number | undefined
    try {
      descriptor = openSync(temporaryPath, 'wx')
      writeSync(
        descriptor,
        records.map((record) => JSON.stringify(record)).join('\n') + '\n',
        undefined,
        'utf8'
      )
      fsyncSync(descriptor)
      closeSync(descriptor)
      descriptor = undefined
      if (existsSync(path)) unlinkSync(path)
      renameSync(temporaryPath, path)
    } finally {
      if (descriptor !== undefined) closeSync(descriptor)
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
    }
  }

  private quarantineIncompleteImport(caseId: string, packageHash: string): void {
    const source = this.casePath(caseId)
    if (!existsSync(source)) return
    const target = join(
      this.quarantineDir,
      `${caseId}-${packageHash.slice(0, 12)}-${randomUUID()}.jsonl`
    )
    renameSync(source, target)
  }

  private appendEvent(caseId: string, type: StewardCaseEventType, eventActor: StewardActor, payload: unknown): void {
    const path = this.casePath(caseId)
    const records = existsSync(path) ? this.loadCase(caseId).records : []
    const last = records.at(-1)
    const occurredAt = Math.max(Math.trunc(this.now()), (last?.occurredAt ?? -1) + 1)
    const unsigned = eventUnsigned({
      schemaVersion: STEWARD_CASE_SCHEMA_VERSION,
      caseId,
      eventId: this.newId('event'),
      sequence: records.length + 1,
      type,
      occurredAt,
      actor: eventActor,
      payload: cloneJson(payload),
      previousHash: last?.eventHash ?? ZERO_HASH
    })
    const record: StewardEventRecord = { ...unsigned, eventHash: sha256Canonical(unsigned) }
    mkdirSync(this.casesDir, { recursive: true })
    const descriptor = openSync(path, 'a')
    try {
      writeSync(descriptor, `${JSON.stringify(record)}\n`, undefined, 'utf8')
      fsyncSync(descriptor)
    } finally {
      closeSync(descriptor)
    }
  }

  private writeEvidence(contentHash: string, canonical: string): void {
    if (sha256Text(canonical) !== contentHash) throw new Error('Locked evidence content hash mismatch.')
    const path = this.evidencePath(contentHash)
    if (existsSync(path)) {
      if (readFileSync(path, 'utf8') !== canonical) throw new Error('Existing evidence content is corrupt.')
      return
    }
    const temporaryPath = join(
      this.evidenceDir,
      `.${contentHash}.${process.pid}.${randomUUID()}.tmp`
    )
    let descriptor: number | undefined
    try {
      descriptor = openSync(temporaryPath, 'wx')
      writeSync(descriptor, canonical, undefined, 'utf8')
      fsyncSync(descriptor)
      closeSync(descriptor)
      descriptor = undefined
      try {
        renameSync(temporaryPath, path)
      } catch (error) {
        if (existsSync(path) && readFileSync(path, 'utf8') === canonical) return
        throw error
      }
    } catch (error) {
      throw error
    } finally {
      if (descriptor !== undefined) closeSync(descriptor)
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
    }
  }

  private readEvidence(contentHash: string): unknown {
    const raw = readFileSync(this.evidencePath(contentHash), 'utf8')
    if (sha256Text(raw) !== contentHash) throw new Error(`Locked evidence ${contentHash} is corrupt.`)
    return JSON.parse(raw) as unknown
  }

  private casePath(caseId: string): string {
    const normalized = identifier(caseId, 'caseId')
    return join(this.casesDir, `${normalized}.jsonl`)
  }

  private newId(prefix: string): string {
    const raw = `${prefix}-${this.idFactory()}`.replace(/[^A-Za-z0-9._:@-]/g, '-').slice(0, 128)
    return identifier(raw, `${prefix} id`)
  }

  caseFileName(caseId: string): string {
    return basename(this.casePath(caseId))
  }
}
