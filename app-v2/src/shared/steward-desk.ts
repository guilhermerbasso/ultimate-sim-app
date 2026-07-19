export const STEWARD_CASE_SCHEMA_VERSION = 1 as const
export const STEWARD_EXPORT_VERSION = 2 as const
export const STEWARD_EXPORT_MAGIC = 'ultimate-sim-steward-case' as const
export const STEWARD_EXPORT_EXTENSION = 'stewardcase' as const
export const STEWARD_EVIDENCE_MAX_BYTES = 4 * 1024 * 1024
export const STEWARD_PACKAGE_MAX_BYTES = 16 * 1024 * 1024

export type StewardActorRole =
  | 'steward'
  | 'chief-steward'
  | 'league-admin'
  | 'participant'
  | 'observer'

export interface StewardActor {
  id: string
  displayName: string
  role: StewardActorRole
}

export type StewardCaseStatus = 'triage' | 'under-review' | 'decided' | 'appealed' | 'closed'

export interface StewardRaceSessionIdentity {
  leagueId: string
  leagueName: string
  eventId: string
  eventName: string
  sessionId: string
  sim: string
  sessionType: string
  trackName: string
  startedAt?: number
}

export type StewardBookmarkSource = 'incident-recorder' | 'replay' | 'manual' | 'import'

export interface StewardIncidentBookmark {
  bookmarkId: string
  source: StewardBookmarkSource
  sourceId: string
  label: string
  occurredAt?: number
  sessionTimeSec?: number
  lap?: number
  lapDistPct?: number
  replayFrame?: number
  captureSessionId?: string
  windowBeforeSec: number
  windowAfterSec: number
  notes?: string
  createdAt: number
  createdBy: StewardActor
}

export type StewardIncidentBookmarkInput = Omit<
  StewardIncidentBookmark,
  'bookmarkId' | 'createdAt' | 'createdBy'
> & {
  bookmarkId?: string
}

export interface StewardEvidenceProvenance {
  sourceKind: StewardBookmarkSource | 'document' | 'telemetry' | 'media' | 'other'
  sourceRef: string
  producer: string
  producerVersion: string
  capturedAt: number
  sessionRef?: string
  captureRange?: string
  transform?: string
  notes?: string
}

export type StewardEvidenceState = 'available' | 'missing' | 'corrupt' | 'redacted'

export interface StewardEvidenceLock {
  evidenceId: string
  summary: string
  mediaType: string
  contentHash: string
  byteLength: number
  provenance: StewardEvidenceProvenance
  lockedAt: number
  lockedBy: StewardActor
  state: StewardEvidenceState
}

export interface StewardRuleCitation {
  citationId: string
  rulesetId: string
  version: string
  section: string
  title: string
  text: string
  source: string
  contentHash: string
  citedAt: number
  citedBy: StewardActor
}

export type StewardVerdictFinding =
  | 'no-breach'
  | 'breach'
  | 'insufficient-evidence'
  | 'procedural'

export interface StewardHumanVerdict {
  verdictId: string
  finding: StewardVerdictFinding
  decisionText: string
  actionText?: string
  ruleCitationIds: string[]
  evidenceIds: string[]
  supersedesVerdictId?: string
  decidedAt: number
  decidedBy: StewardActor
}

export interface StewardDissent {
  dissentId: string
  verdictId: string
  statement: string
  grounds: string
  submittedAt: number
  submittedBy: StewardActor
}

export type StewardAppealResolutionKind = 'upheld' | 'modified' | 'remanded' | 'dismissed'

export interface StewardAppealResolution {
  resolutionId: string
  resolution: StewardAppealResolutionKind
  reasoning: string
  resolvedAt: number
  resolvedBy: StewardActor
}

export interface StewardAppeal {
  appealId: string
  verdictId: string
  grounds: string
  requestedRemedy: string
  filedAt: number
  filedBy: StewardActor
  status: 'open' | 'resolved'
  resolutions: StewardAppealResolution[]
}

export type StewardCaseEventType =
  | 'case-created'
  | 'case-assigned'
  | 'case-status-set'
  | 'bookmark-added'
  | 'evidence-locked'
  | 'rule-version-cited'
  | 'human-verdict-recorded'
  | 'dissent-recorded'
  | 'appeal-filed'
  | 'appeal-resolved'
  | 'case-imported'
  | 'import-completed'

export interface StewardCaseEventSummary {
  eventId: string
  sequence: number
  type: StewardCaseEventType
  occurredAt: number
  actor: StewardActor
  eventHash: string
}

export interface StewardCaseIntegrity {
  state: 'unanchored' | 'corrupt' | 'evidence-missing' | 'evidence-corrupt' | 'import-incomplete'
  verified: false
  chainValid: boolean
  evidenceValid: boolean
  checkedEvents: number
  headHash?: string
  checkedAt: number
  message: string
  failures: string[]
}

export interface StewardImportProvenance {
  sourcePackageHash: string
  sourceHeadHash: string
  sourceCaseRef: string
  profile: StewardExportProfile
  importedAt: number
}

export interface StewardCase {
  schemaVersion: typeof STEWARD_CASE_SCHEMA_VERSION
  caseId: string
  title: string
  createdAt: number
  createdBy: StewardActor
  identity: StewardRaceSessionIdentity
  primaryIncidentFingerprint: string
  status: StewardCaseStatus
  assignedTo?: StewardActor
  bookmarks: StewardIncidentBookmark[]
  evidence: StewardEvidenceLock[]
  rules: StewardRuleCitation[]
  verdicts: StewardHumanVerdict[]
  dissents: StewardDissent[]
  appeals: StewardAppeal[]
  importProvenance?: StewardImportProvenance
  importCompleted?: boolean
  history: StewardCaseEventSummary[]
  integrity: StewardCaseIntegrity
}

export interface StewardCaseCreateInput {
  title: string
  actor: StewardActor
  identity: StewardRaceSessionIdentity
  incident: StewardIncidentBookmarkInput
  assignedTo?: StewardActor
}

export interface StewardCaseAssignmentInput {
  caseId: string
  actor: StewardActor
  assignedTo: StewardActor
}

export interface StewardCaseStatusInput {
  caseId: string
  actor: StewardActor
  status: StewardCaseStatus
}

export interface StewardBookmarkAddInput {
  caseId: string
  actor: StewardActor
  bookmark: StewardIncidentBookmarkInput
}

export interface StewardEvidenceLockInput {
  caseId: string
  actor: StewardActor
  evidenceId?: string
  summary: string
  mediaType: string
  content: unknown
  provenance: StewardEvidenceProvenance
}

export interface StewardRuleCitationInput {
  caseId: string
  actor: StewardActor
  citationId?: string
  rulesetId: string
  version: string
  section: string
  title: string
  text: string
  source: string
}

export interface StewardVerdictInput {
  caseId: string
  actor: StewardActor
  verdictId?: string
  finding: StewardVerdictFinding
  decisionText: string
  actionText?: string
  ruleCitationIds: string[]
  evidenceIds: string[]
  supersedesVerdictId?: string
}

export interface StewardDissentInput {
  caseId: string
  actor: StewardActor
  dissentId?: string
  verdictId: string
  statement: string
  grounds: string
}

export interface StewardAppealInput {
  caseId: string
  actor: StewardActor
  appealId?: string
  verdictId: string
  grounds: string
  requestedRemedy: string
}

export interface StewardAppealResolutionInput {
  caseId: string
  actor: StewardActor
  appealId: string
  resolutionId?: string
  resolution: StewardAppealResolutionKind
  reasoning: string
}

export type StewardExportProfile = 'full-local' | 'anonymized'

export type StewardPortableCase = Omit<StewardCase, 'history' | 'integrity'>

export interface StewardExportEvidence {
  evidenceId: string
  contentHash: string
  content: unknown
}

export interface StewardExportEvent {
  schemaVersion: typeof STEWARD_CASE_SCHEMA_VERSION
  caseId: string
  eventId: string
  sequence: number
  type: StewardCaseEventType
  occurredAt: number
  actor: StewardActor
  payload: unknown
  previousHash: string
  eventHash: string
}

export interface StewardExportBundle {
  magic: typeof STEWARD_EXPORT_MAGIC
  version: typeof STEWARD_EXPORT_VERSION
  profile: StewardExportProfile
  exportedAt: number
  source: {
    caseRef: string
    headHash: string
    integrityState: 'unanchored'
    eventCount: number
  }
  case: StewardPortableCase
  events: StewardExportEvent[]
  evidence: StewardExportEvidence[]
  redactions: string[]
  packageHash: string
}

export interface StewardExportRequest {
  caseId: string
  profile: StewardExportProfile
}

export interface StewardExportResult {
  ok: boolean
  canceled: boolean
  fileName?: string
  packageHash?: string
  profile?: StewardExportProfile
}

export interface StewardImportResult {
  ok: boolean
  canceled: boolean
  importedCase?: StewardCase
  deduplicated?: boolean
  retried?: boolean
}

export interface StewardEvidenceDetailsRequest {
  caseId: string
  evidenceId: string
}

export interface StewardIncidentEvidenceLockRequest {
  caseId: string
  incidentId: string
  actorDisplayName?: string
}

export interface StewardEvidenceDetails {
  caseId: string
  evidence: StewardEvidenceLock
  content: unknown
  contentHashVerified: true
  chainState: 'unanchored'
  verifiedAt: number
}

export const STEWARD_CHANNELS = {
  listCases: 'steward:listCases',
  getCase: 'steward:getCase',
  getEvidenceDetails: 'steward:getEvidenceDetails',
  createCase: 'steward:createCase',
  assignCase: 'steward:assignCase',
  setStatus: 'steward:setStatus',
  addBookmark: 'steward:addBookmark',
  lockEvidence: 'steward:lockEvidence',
  lockIncidentEvidence: 'steward:lockIncidentEvidence',
  citeRule: 'steward:citeRule',
  recordVerdict: 'steward:recordVerdict',
  recordDissent: 'steward:recordDissent',
  fileAppeal: 'steward:fileAppeal',
  resolveAppeal: 'steward:resolveAppeal',
  exportCase: 'steward:exportCase',
  importCase: 'steward:importCase',
  changed: 'steward:changed'
} as const
