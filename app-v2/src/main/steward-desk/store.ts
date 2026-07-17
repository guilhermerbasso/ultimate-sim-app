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
  STEWARD_EXPORT_MAGIC,
  STEWARD_EXPORT_VERSION,
  type StewardActor,
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
  type StewardEvidenceLockInput,
  type StewardEvidenceProvenance,
  type StewardExportBundle,
  type StewardExportEvidence,
  type StewardExportProfile,
  type StewardHumanVerdict,
  type StewardImportProvenance,
  type StewardIncidentBookmark,
  type StewardIncidentBookmarkInput,
  type StewardPortableCase,
  type StewardRaceSessionIdentity,
  type StewardRuleCitation,
  type StewardRuleCitationInput,
  type StewardVerdictFinding,
  type StewardVerdictInput
} from '../../shared/steward-desk'
import { canonicalStringify, cloneJson, isPlainObject, sha256Canonical, sha256Text } from './canonical'

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
  'case-imported'
])
const ACTOR_ROLES = new Set<StewardActorRole>([
  'steward',
  'chief-steward',
  'league-admin',
  'participant',
  'observer'
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

interface StewardEventRecord {
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

function actor(value: unknown, label = 'actor'): StewardActor {
  const source = plain(value, label)
  const role = text(source.role, `${label}.role`, 32) as StewardActorRole
  if (!ACTOR_ROLES.has(role)) throw new Error(`${label}.role is not supported.`)
  return {
    id: identifier(source.id, `${label}.id`),
    displayName: text(source.displayName, `${label}.displayName`, 120),
    role
  }
}

function decisionActor(value: unknown, label = 'actor'): StewardActor {
  const normalized = actor(value, label)
  if (!DECISION_ROLES.has(normalized.role)) {
    throw new Error('A human steward, chief steward, or league admin must own this decision.')
  }
  return normalized
}

function identity(value: unknown): StewardRaceSessionIdentity {
  const source = plain(value, 'identity')
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
    windowBeforeSec: numberValue(source.windowBeforeSec, 'bookmark.windowBeforeSec', 0, 120),
    windowAfterSec: numberValue(source.windowAfterSec, 'bookmark.windowAfterSec', 0, 120),
    ...(notes ? { notes } : {})
  }
}

function bookmarkRecord(value: unknown): StewardIncidentBookmark {
  const source = plain(value, 'bookmark')
  const input = bookmarkInput(source)
  return {
    ...input,
    bookmarkId: identifier(source.bookmarkId, 'bookmark.bookmarkId'),
    createdAt: numberValue(source.createdAt, 'bookmark.createdAt'),
    createdBy: decisionActor(source.createdBy, 'bookmark.createdBy')
  }
}

function evidenceProvenance(value: unknown): StewardEvidenceProvenance {
  const source = plain(value, 'evidence.provenance')
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
  return {
    sourceKind: sourceKind as StewardEvidenceProvenance['sourceKind'],
    sourceRef: text(source.sourceRef, 'evidence.provenance.sourceRef', 500),
    producer: text(source.producer, 'evidence.provenance.producer', 160),
    producerVersion: text(source.producerVersion, 'evidence.provenance.producerVersion', 80),
    capturedAt: numberValue(source.capturedAt, 'evidence.provenance.capturedAt'),
    ...(sessionRef ? { sessionRef } : {}),
    ...(captureRange ? { captureRange } : {}),
    ...(transform ? { transform } : {}),
    ...(notes ? { notes } : {})
  }
}

function evidenceRecord(value: unknown): StewardEvidenceLock {
  const source = plain(value, 'evidence')
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
    lockedBy: decisionActor(source.lockedBy, 'evidence.lockedBy'),
    state
  }
}

function ruleRecord(value: unknown): StewardRuleCitation {
  const source = plain(value, 'rule')
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
    citedBy: decisionActor(source.citedBy, 'rule.citedBy')
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
  const finding = text(source.finding, 'verdict.finding', 40) as StewardVerdictFinding
  if (!FINDINGS.has(finding)) throw new Error('verdict.finding is not supported.')
  const actionText = optionalText(source.actionText, 'verdict.actionText', 4_000)
  const supersedesVerdictId = source.supersedesVerdictId === undefined
    ? undefined
    : identifier(source.supersedesVerdictId, 'verdict.supersedesVerdictId')
  return {
    verdictId: identifier(source.verdictId, 'verdict.verdictId'),
    finding,
    decisionText: text(source.decisionText, 'verdict.decisionText', 8_000),
    ...(actionText ? { actionText } : {}),
    ruleCitationIds: stringIds(source.ruleCitationIds, 'verdict.ruleCitationIds'),
    evidenceIds: stringIds(source.evidenceIds, 'verdict.evidenceIds'),
    ...(supersedesVerdictId ? { supersedesVerdictId } : {}),
    decidedAt: numberValue(source.decidedAt, 'verdict.decidedAt'),
    decidedBy: decisionActor(source.decidedBy, 'verdict.decidedBy')
  }
}

function dissentRecord(value: unknown): StewardDissent {
  const source = plain(value, 'dissent')
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
  const resolution = text(source.resolution, 'appeal.resolution.resolution', 30)
  if (!RESOLUTIONS.has(resolution)) throw new Error('appeal resolution is not supported.')
  return {
    resolutionId: identifier(source.resolutionId, 'appeal.resolution.resolutionId'),
    resolution: resolution as StewardAppealResolution['resolution'],
    reasoning: text(source.reasoning, 'appeal.resolution.reasoning', 8_000),
    resolvedAt: numberValue(source.resolvedAt, 'appeal.resolution.resolvedAt'),
    resolvedBy: decisionActor(source.resolvedBy, 'appeal.resolution.resolvedBy')
  }
}

function appealRecord(value: unknown): StewardAppeal {
  const source = plain(value, 'appeal')
  const status = text(source.status, 'appeal.status', 20)
  if (status !== 'open' && status !== 'resolved') throw new Error('appeal.status is not supported.')
  const resolutions = array(source.resolutions, 'appeal.resolutions', 1_000).map(resolutionRecord)
  if (new Set(resolutions.map((entry) => entry.resolutionId)).size !== resolutions.length) {
    throw new Error('appeal.resolutions contains duplicate ids.')
  }
  if ((status === 'open' && resolutions.length > 0) || (status === 'resolved' && resolutions.length === 0)) {
    throw new Error('appeal.status does not match its resolution history.')
  }
  const filedBy = actor(source.filedBy, 'appeal.filedBy')
  if (filedBy.role === 'observer') throw new Error('Observers cannot file appeals.')
  return {
    appealId: identifier(source.appealId, 'appeal.appealId'),
    verdictId: identifier(source.verdictId, 'appeal.verdictId'),
    grounds: text(source.grounds, 'appeal.grounds', 8_000),
    requestedRemedy: text(source.requestedRemedy, 'appeal.requestedRemedy', 4_000),
    filedAt: numberValue(source.filedAt, 'appeal.filedAt'),
    filedBy,
    status,
    resolutions
  }
}

function importProvenanceRecord(value: unknown): StewardImportProvenance {
  const source = plain(value, 'importProvenance')
  const profile = text(source.profile, 'importProvenance.profile', 20)
  if (profile !== 'full-local' && profile !== 'anonymized') {
    throw new Error('importProvenance.profile is not supported.')
  }
  return {
    sourcePackageHash: hash(source.sourcePackageHash, 'importProvenance.sourcePackageHash'),
    sourceHeadHash: hash(source.sourceHeadHash, 'importProvenance.sourceHeadHash'),
    sourceCaseRef: text(source.sourceCaseRef, 'importProvenance.sourceCaseRef', 160),
    profile,
    importedAt: numberValue(source.importedAt, 'importProvenance.importedAt')
  }
}

function eventUnsigned(record: Omit<StewardEventRecord, 'eventHash'>): Omit<StewardEventRecord, 'eventHash'> {
  return record
}

function eventFingerprint(identityValue: StewardRaceSessionIdentity, bookmark: StewardIncidentBookmarkInput): string {
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

function assertUnique<T>(values: readonly T[], key: (value: T) => string, label: string): void {
  const ids = values.map(key)
  if (new Set(ids).size !== ids.length) throw new Error(`${label} contains duplicate ids.`)
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
  return cloneJson(portable)
}

function sensitiveReplacements(value: StewardPortableCase): Array<[string, string]> {
  const replacements = new Map<string, string>()
  const add = (source: string | undefined, replacement: string): void => {
    if (source && source.length >= 3) replacements.set(source, replacement)
  }
  for (const field of [
    value.identity.leagueId,
    value.identity.leagueName,
    value.identity.eventId,
    value.identity.eventName,
    value.identity.sessionId,
    value.identity.trackName
  ]) add(field, '[redacted]')

  const actors: StewardActor[] = [
    value.createdBy,
    ...(value.assignedTo ? [value.assignedTo] : []),
    ...value.bookmarks.map((entry) => entry.createdBy),
    ...value.evidence.map((entry) => entry.lockedBy),
    ...value.rules.map((entry) => entry.citedBy),
    ...value.verdicts.map((entry) => entry.decidedBy),
    ...value.dissents.map((entry) => entry.submittedBy),
    ...value.appeals.flatMap((entry) => [
      entry.filedBy,
      ...entry.resolutions.map((resolution) => resolution.resolvedBy)
    ])
  ]
  const aliases = new Map<string, StewardActor>()
  const counters = new Map<string, number>()
  for (const entry of actors) {
    if (aliases.has(entry.id)) continue
    const group = DECISION_ROLES.has(entry.role) ? 'steward' : entry.role === 'participant' ? 'participant' : 'observer'
    const next = (counters.get(group) ?? 0) + 1
    counters.set(group, next)
    const title = group[0].toUpperCase() + group.slice(1)
    aliases.set(entry.id, {
      id: `anon-${group}-${next}`,
      displayName: `${title} ${next}`,
      role: entry.role
    })
  }
  for (const entry of actors) {
    const alias = aliases.get(entry.id) as StewardActor
    add(entry.id, alias.id)
    add(entry.displayName, alias.displayName)
  }
  return [...replacements.entries()].sort((left, right) => right[0].length - left[0].length)
}

function replaceAllInsensitive(value: string, source: string, replacement: string): string {
  const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return value.replace(new RegExp(escaped, 'giu'), replacement)
}

function scrubText(value: string, replacements: Array<[string, string]>): string {
  return replacements.reduce(
    (current, [source, replacement]) => replaceAllInsensitive(current, source, replacement),
    value
  )
}

const SENSITIVE_EVIDENCE_KEY =
  /name|driver|team|email|user|account|cust(?:omer)?id|member|participant|steward|league|session(?:id|ref)|event(?:id|ref)|path|url|locator|token/i

function collectSensitiveContentValues(
  value: unknown,
  replacements: Map<string, string>,
  key = ''
): void {
  if (SENSITIVE_EVIDENCE_KEY.test(key) && (typeof value === 'string' || typeof value === 'number')) {
    const sensitive = String(value)
    if (sensitive.length >= 3) replacements.set(sensitive, '[redacted]')
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectSensitiveContentValues(entry, replacements)
    return
  }
  if (isPlainObject(value)) {
    for (const [entryKey, entry] of Object.entries(value)) {
      collectSensitiveContentValues(entry, replacements, entryKey)
    }
  }
}

function scrubContent(value: unknown, replacements: Array<[string, string]>, key = ''): unknown {
  if (SENSITIVE_EVIDENCE_KEY.test(key)) return '[redacted]'
  if (typeof value === 'string') return scrubText(value, replacements)
  if (Array.isArray(value)) return value.map((entry) => scrubContent(entry, replacements))
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entry]) => [
        entryKey,
        scrubContent(entry, replacements, entryKey)
      ])
    )
  }
  return value
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
    if (aliases.has(entry.id)) continue
    const group = DECISION_ROLES.has(entry.role) ? 'steward' : entry.role === 'participant' ? 'participant' : 'observer'
    const next = (counters.get(group) ?? 0) + 1
    counters.set(group, next)
    aliases.set(entry.id, {
      id: `anon-${group}-${next}`,
      displayName: `${group[0].toUpperCase()}${group.slice(1)} ${next}`,
      role: entry.role
    })
  }
  return aliases
}

function anonymizeCase(
  sourceCase: StewardPortableCase,
  evidenceContents: StewardExportEvidence[],
  aliasSeed: string
): { caseValue: StewardPortableCase; evidence: StewardExportEvidence[]; redactions: string[] } {
  const replacementMap = new Map(sensitiveReplacements(sourceCase))
  for (const entry of evidenceContents) collectSensitiveContentValues(entry.content, replacementMap)
  const replacements = [...replacementMap.entries()].sort((left, right) => right[0].length - left[0].length)
  const aliases = aliasActors(sourceCase)
  const actorAlias = (value: StewardActor): StewardActor => cloneJson(aliases.get(value.id) ?? value)
  const baseTime = sourceCase.createdAt
  const relativeTime = (value: number): number => Math.max(0, Math.round((value - baseTime) / 60_000) * 60_000)
  const optionalRelative = (value: number | undefined): number | undefined =>
    value === undefined ? undefined : relativeTime(value)
  const evidenceIdMap = new Map(sourceCase.evidence.map((entry, index) => [entry.evidenceId, `evidence-${index + 1}`]))
  const ruleIdMap = new Map(sourceCase.rules.map((entry, index) => [entry.citationId, `rule-${index + 1}`]))
  const verdictIdMap = new Map(sourceCase.verdicts.map((entry, index) => [entry.verdictId, `verdict-${index + 1}`]))
  const dissentIdMap = new Map(sourceCase.dissents.map((entry, index) => [entry.dissentId, `dissent-${index + 1}`]))
  const appealIdMap = new Map(sourceCase.appeals.map((entry, index) => [entry.appealId, `appeal-${index + 1}`]))
  const bookmarkAlias = (entry: StewardIncidentBookmark, index: number): StewardIncidentBookmark => {
    const occurredAt = optionalRelative(entry.occurredAt)
    const sessionTimeSec = entry.sessionTimeSec === undefined ? undefined : Math.round(entry.sessionTimeSec / 5) * 5
    const lapDistPct = entry.lapDistPct === undefined ? undefined : Math.round(entry.lapDistPct * 100) / 100
    const notes = entry.notes ? scrubText(entry.notes, replacements) : undefined
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
      windowBeforeSec: entry.windowBeforeSec,
      windowAfterSec: entry.windowAfterSec,
      ...(notes ? { notes } : {}),
      createdAt: relativeTime(entry.createdAt),
      createdBy: actorAlias(entry.createdBy)
    }
  }

  const anonymizedEvidence = evidenceContents.map((entry) => {
    const content = scrubContent(entry.content, replacements)
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
    sessionId: `session-${sha256Text(`${aliasSeed}:${sourceCase.identity.sessionId}`).slice(0, 8)}`,
    sim: sourceCase.identity.sim,
    sessionType: sourceCase.identity.sessionType,
    trackName: 'Track redacted'
  }
  const evidence = sourceCase.evidence.map((entry) => ({
    ...entry,
    evidenceId: evidenceIdMap.get(entry.evidenceId) as string,
    summary: scrubText(entry.summary, replacements),
    contentHash: evidenceHashes.get(evidenceIdMap.get(entry.evidenceId) as string) as string,
    byteLength: Buffer.byteLength(canonicalStringify(
      anonymizedEvidence.find((item) => item.evidenceId === evidenceIdMap.get(entry.evidenceId))?.content
    ), 'utf8'),
    provenance: {
      sourceKind: entry.provenance.sourceKind,
      sourceRef: '[redacted]',
      producer: entry.provenance.producer,
      producerVersion: entry.provenance.producerVersion,
      capturedAt: relativeTime(entry.provenance.capturedAt),
      ...(entry.provenance.captureRange
        ? { captureRange: scrubText(entry.provenance.captureRange, replacements) }
        : {}),
      ...(entry.provenance.transform ? { transform: entry.provenance.transform } : {}),
      ...(entry.provenance.notes ? { notes: scrubText(entry.provenance.notes, replacements) } : {})
    },
    lockedAt: relativeTime(entry.lockedAt),
    lockedBy: actorAlias(entry.lockedBy),
    state: 'available' as const
  }))
  const rules = sourceCase.rules.map((entry) => {
    const content = {
      rulesetId: entry.rulesetId,
      version: entry.version,
      section: entry.section,
      title: scrubText(entry.title, replacements),
      text: scrubText(entry.text, replacements),
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
    decisionText: scrubText(entry.decisionText, replacements),
    ...(entry.actionText ? { actionText: scrubText(entry.actionText, replacements) } : {}),
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
    statement: scrubText(entry.statement, replacements),
    grounds: scrubText(entry.grounds, replacements),
    submittedAt: relativeTime(entry.submittedAt),
    submittedBy: actorAlias(entry.submittedBy)
  }))
  const appeals = sourceCase.appeals.map((entry) => ({
    ...entry,
    appealId: appealIdMap.get(entry.appealId) as string,
    verdictId: verdictIdMap.get(entry.verdictId) as string,
    grounds: scrubText(entry.grounds, replacements),
    requestedRemedy: scrubText(entry.requestedRemedy, replacements),
    filedAt: relativeTime(entry.filedAt),
    filedBy: actorAlias(entry.filedBy),
    resolutions: entry.resolutions.map((resolution, resolutionIndex) => ({
      ...resolution,
      resolutionId: `resolution-${sourceCase.appeals.indexOf(entry) + 1}-${resolutionIndex + 1}`,
      reasoning: scrubText(resolution.reasoning, replacements),
      resolvedAt: relativeTime(resolution.resolvedAt),
      resolvedBy: actorAlias(resolution.resolvedBy)
    }))
  }))
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
      appeals
    },
    evidence: anonymizedEvidence,
    redactions: [
      'participant and steward identities replaced with role aliases',
      'league, event, session, track, and source locators removed',
      'exact timestamps converted to relative minute offsets',
      'sensitive evidence fields and known identity strings removed'
    ]
  }
}

export function serializeStewardExportBundle(bundle: StewardExportBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`
}

export function parseStewardExportBundle(raw: string): StewardExportBundle {
  if (Buffer.byteLength(raw, 'utf8') > 16 * 1024 * 1024) throw new Error('Steward package exceeds 16 MiB.')
  const parsed = plain(JSON.parse(raw) as unknown, 'package')
  if (parsed.magic !== STEWARD_EXPORT_MAGIC || parsed.version !== STEWARD_EXPORT_VERSION) {
    throw new Error('Unsupported steward package.')
  }
  const packageHash = hash(parsed.packageHash, 'package.packageHash')
  const { packageHash: _packageHash, ...unsigned } = parsed
  if (sha256Canonical(unsigned) !== packageHash) throw new Error('Steward package hash mismatch.')
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

export class StewardCaseStore {
  private readonly rootDir: string
  private readonly casesDir: string
  private readonly evidenceDir: string
  private readonly now: () => number
  private readonly idFactory: () => string

  constructor(options: StewardCaseStoreOptions) {
    this.rootDir = options.rootDir
    this.casesDir = join(this.rootDir, 'cases')
    this.evidenceDir = join(this.rootDir, 'evidence')
    this.now = options.now ?? Date.now
    this.idFactory = options.idFactory ?? randomUUID
    mkdirSync(this.casesDir, { recursive: true })
    mkdirSync(this.evidenceDir, { recursive: true })
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

  createCase(input: StewardCaseCreateInput): StewardCase {
    const owner = decisionActor(input.actor)
    const normalizedIdentity = identity(input.identity)
    const normalizedIncident = bookmarkInput(input.incident)
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
    if (current.value.assignedTo?.id === assignedTo.id) return current.value
    this.appendEvent(current.value.caseId, 'case-assigned', owner, { assignedTo })
    return this.requireCase(current.value.caseId).value
  }

  setStatus(input: StewardCaseStatusInput): StewardCase {
    const owner = decisionActor(input.actor)
    const current = this.mutableCase(input.caseId)
    if (!CASE_STATUSES.has(input.status)) throw new Error('Unsupported steward case status.')
    if (input.status === 'closed' && current.value.appeals.some((entry) => entry.status === 'open')) {
      throw new Error('A steward case cannot be closed while an appeal is open.')
    }
    if (current.value.status === input.status) return current.value
    this.appendEvent(current.value.caseId, 'case-status-set', owner, { status: input.status })
    return this.requireCase(current.value.caseId).value
  }

  addBookmark(input: StewardBookmarkAddInput): StewardCase {
    const owner = decisionActor(input.actor)
    const current = this.mutableCase(input.caseId)
    const normalized = bookmarkInput(input.bookmark)
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
      provenance: evidenceProvenance(input.provenance),
      lockedAt: Math.trunc(this.now()),
      lockedBy: owner,
      state: 'available'
    }
    this.appendEvent(current.value.caseId, 'evidence-locked', owner, { evidence })
    return this.requireCase(current.value.caseId).value
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
    const ruleCitationIds = stringIds(input.ruleCitationIds, 'ruleCitationIds')
    const evidenceIds = stringIds(input.evidenceIds, 'evidenceIds')
    if (ruleCitationIds.length === 0 || evidenceIds.length === 0) {
      throw new Error('A human verdict requires at least one locked evidence item and one versioned rule citation.')
    }
    for (const id of ruleCitationIds) {
      if (!current.value.rules.some((entry) => entry.citationId === id)) throw new Error(`Unknown rule citation ${id}.`)
    }
    for (const id of evidenceIds) {
      const evidence = current.value.evidence.find((entry) => entry.evidenceId === id)
      if (!evidence || evidence.state !== 'available') throw new Error(`Evidence ${id} is not available.`)
    }
    const verdictId = input.verdictId ? identifier(input.verdictId, 'verdictId') : this.newId('verdict')
    if (current.value.verdicts.some((entry) => entry.verdictId === verdictId)) {
      throw new Error(`Verdict id ${verdictId} already exists.`)
    }
    const supersedesVerdictId = input.supersedesVerdictId
      ? identifier(input.supersedesVerdictId, 'supersedesVerdictId')
      : undefined
    if (supersedesVerdictId && !current.value.verdicts.some((entry) => entry.verdictId === supersedesVerdictId)) {
      throw new Error(`Superseded verdict ${supersedesVerdictId} does not exist.`)
    }
    const actionText = optionalText(input.actionText, 'actionText', 4_000)
    const verdict: StewardHumanVerdict = {
      verdictId,
      finding: input.finding,
      decisionText: text(input.decisionText, 'decisionText', 8_000),
      ...(actionText ? { actionText } : {}),
      ruleCitationIds,
      evidenceIds,
      ...(supersedesVerdictId ? { supersedesVerdictId } : {}),
      decidedAt: Math.trunc(this.now()),
      decidedBy: owner
    }
    this.appendEvent(current.value.caseId, 'human-verdict-recorded', owner, { verdict })
    return this.requireCase(current.value.caseId).value
  }

  recordDissent(input: StewardDissentInput): StewardCase {
    const submittedBy = actor(input.actor)
    if (submittedBy.role === 'observer') throw new Error('Observers cannot submit dissent.')
    const current = this.mutableCase(input.caseId)
    const verdictId = identifier(input.verdictId, 'verdictId')
    if (!current.value.verdicts.some((entry) => entry.verdictId === verdictId)) {
      throw new Error(`Verdict ${verdictId} does not exist.`)
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
    if (!current.value.verdicts.some((entry) => entry.verdictId === verdictId)) {
      throw new Error(`Verdict ${verdictId} does not exist.`)
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
    if (appeal.status !== 'open') throw new Error(`Appeal ${appealId} is already resolved.`)
    if (!RESOLUTIONS.has(input.resolution)) throw new Error('Unsupported appeal resolution.')
    const resolution: StewardAppealResolution = {
      resolutionId: input.resolutionId
        ? identifier(input.resolutionId, 'resolutionId')
        : this.newId('resolution'),
      resolution: input.resolution,
      reasoning: text(input.reasoning, 'reasoning', 8_000),
      resolvedAt: Math.trunc(this.now()),
      resolvedBy
    }
    this.appendEvent(current.value.caseId, 'appeal-resolved', resolvedBy, { appealId, resolution })
    return this.requireCase(current.value.caseId).value
  }

  exportCase(caseId: string, profile: StewardExportProfile): StewardExportBundle {
    if (profile !== 'full-local' && profile !== 'anonymized') throw new Error('Unsupported steward export profile.')
    const current = this.mutableCase(caseId).value
    if (!current.integrity.headHash) throw new Error('Case has no chain head.')
    const sourcePortable = portableCase(current)
    const sourceEvidence: StewardExportEvidence[] = current.evidence.map((entry) => ({
      evidenceId: entry.evidenceId,
      contentHash: entry.contentHash,
      content: this.readEvidence(entry.contentHash)
    }))
    const projected = profile === 'anonymized'
      ? anonymizeCase(sourcePortable, sourceEvidence, randomUUID())
      : { caseValue: sourcePortable, evidence: sourceEvidence, redactions: [] }
    const exportedHeadHash = profile === 'anonymized'
      ? sha256Canonical({ case: projected.caseValue, evidence: projected.evidence })
      : current.integrity.headHash
    const unsigned = {
      magic: STEWARD_EXPORT_MAGIC,
      version: STEWARD_EXPORT_VERSION,
      profile,
      exportedAt: Math.trunc(this.now()),
      source: {
        caseRef: profile === 'anonymized' ? projected.caseValue.caseId : current.caseId,
        headHash: exportedHeadHash,
        integrityState: 'unanchored' as const,
        eventCount: current.history.length
      },
      case: projected.caseValue,
      evidence: projected.evidence,
      redactions: projected.redactions
    }
    return { ...unsigned, packageHash: sha256Canonical(unsigned) }
  }

  importCase(raw: string): StewardCase {
    const bundle = this.validateBundle(parseStewardExportBundle(raw))
    const packageCase = bundle.profile === 'anonymized'
      ? rebaseAnonymizedCase(bundle.case, Math.trunc(this.now()))
      : bundle.case
    const primary = packageCase.bookmarks[0]
    const importActor: StewardActor = {
      id: 'steward-import',
      displayName: 'Imported steward package',
      role: 'league-admin'
    }
    const created = this.createCase({
      title: packageCase.title,
      actor: importActor,
      identity: packageCase.identity,
      incident: primary,
      ...(packageCase.assignedTo ? { assignedTo: packageCase.assignedTo } : {})
    })
    const provenance: StewardImportProvenance = {
      sourcePackageHash: bundle.packageHash,
      sourceHeadHash: bundle.source.headHash,
      sourceCaseRef: bundle.source.caseRef,
      profile: bundle.profile,
      importedAt: Math.trunc(this.now())
    }
    this.appendEvent(created.caseId, 'case-imported', importActor, { provenance })

    for (const bookmark of packageCase.bookmarks.slice(1)) {
      this.appendEvent(created.caseId, 'bookmark-added', bookmark.createdBy, { bookmark })
    }
    const contents = new Map(bundle.evidence.map((entry) => [entry.evidenceId, entry]))
    for (const evidence of packageCase.evidence) {
      const content = contents.get(evidence.evidenceId) as StewardExportEvidence
      this.writeEvidence(evidence.contentHash, canonicalStringify(content.content))
      this.appendEvent(created.caseId, 'evidence-locked', evidence.lockedBy, {
        evidence: { ...evidence, state: 'available' }
      })
    }
    for (const citation of packageCase.rules) {
      this.appendEvent(created.caseId, 'rule-version-cited', citation.citedBy, { citation })
    }
    for (const verdict of packageCase.verdicts) {
      this.appendEvent(created.caseId, 'human-verdict-recorded', verdict.decidedBy, { verdict })
    }
    for (const dissent of packageCase.dissents) {
      this.appendEvent(created.caseId, 'dissent-recorded', dissent.submittedBy, { dissent })
    }
    for (const appeal of packageCase.appeals) {
      this.appendEvent(created.caseId, 'appeal-filed', appeal.filedBy, {
        appeal: { ...appeal, status: 'open', resolutions: [] }
      })
      for (const resolution of appeal.resolutions) {
        this.appendEvent(created.caseId, 'appeal-resolved', resolution.resolvedBy, {
          appealId: appeal.appealId,
          resolution
        })
      }
    }
    this.appendEvent(created.caseId, 'case-status-set', importActor, { status: packageCase.status })
    return this.requireCase(created.caseId).value
  }

  evidencePath(contentHash: string): string {
    return join(this.evidenceDir, `${hash(contentHash, 'contentHash')}.json`)
  }

  private validateBundle(bundle: StewardExportBundle): StewardExportBundle {
    if (bundle.profile !== 'full-local' && bundle.profile !== 'anonymized') {
      throw new Error('Unsupported steward package profile.')
    }
    const source = plain(bundle.source, 'package.source')
    hash(source.headHash, 'package.source.headHash')
    text(source.caseRef, 'package.source.caseRef', 160)
    if (source.integrityState !== 'unanchored') throw new Error('Steward package integrity state must be unanchored.')
    numberValue(source.eventCount, 'package.source.eventCount')
    const caseValue = this.validatePortableCase(bundle.case)
    const evidenceValues = array(bundle.evidence, 'package.evidence', 5_000).map((entry) => {
      const sourceEvidence = plain(entry, 'package.evidence item')
      const evidenceId = identifier(sourceEvidence.evidenceId, 'package.evidence.evidenceId')
      const contentHash = hash(sourceEvidence.contentHash, 'package.evidence.contentHash')
      const content = cloneJson(sourceEvidence.content)
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
    return {
      ...bundle,
      case: caseValue,
      evidence: evidenceValues
    }
  }

  private validatePortableCase(value: unknown): StewardPortableCase {
    const source = plain(value, 'package.case')
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
    const evidenceIds = new Set(evidence.map((entry) => entry.evidenceId))
    const ruleIds = new Set(rules.map((entry) => entry.citationId))
    const verdictIds = new Set(verdicts.map((entry) => entry.verdictId))
    for (const verdict of verdicts) {
      if (verdict.evidenceIds.some((id) => !evidenceIds.has(id))) throw new Error('Verdict references unknown evidence.')
      if (verdict.ruleCitationIds.some((id) => !ruleIds.has(id))) throw new Error('Verdict references an unknown rule.')
      if (verdict.supersedesVerdictId && !verdictIds.has(verdict.supersedesVerdictId)) {
        throw new Error('Verdict supersedes an unknown verdict.')
      }
    }
    for (const dissent of dissents) {
      if (!verdictIds.has(dissent.verdictId)) throw new Error('Dissent references an unknown verdict.')
    }
    for (const appeal of appeals) {
      if (!verdictIds.has(appeal.verdictId)) throw new Error('Appeal references an unknown verdict.')
    }
    if (status === 'closed' && appeals.some((entry) => entry.status === 'open')) {
      throw new Error('A packaged steward case cannot be closed while an appeal is open.')
    }
    const normalizedIdentity = identity(source.identity)
    const primaryIncidentFingerprint = hash(
      source.primaryIncidentFingerprint,
      'package.case.primaryIncidentFingerprint'
    )
    if (eventFingerprint(normalizedIdentity, bookmarks[0]) !== primaryIncidentFingerprint) {
      throw new Error('Primary incident fingerprint mismatch.')
    }
    const importProvenance = source.importProvenance
      ? importProvenanceRecord(source.importProvenance)
      : undefined
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
      ...(importProvenance ? { importProvenance } : {})
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

  private loadCase(caseId: string): LoadedCase {
    const failures: string[] = []
    const records: StewardEventRecord[] = []
    const raw = readFileSync(this.casePath(caseId), 'utf8')
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0)
    let previousHash = ZERO_HASH
    for (let index = 0; index < lines.length; index += 1) {
      try {
        const parsed = plain(JSON.parse(lines[index]) as unknown, `event ${index + 1}`)
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
        if (!SUPPORTED_EVENT_TYPES.has(record.type)) throw new Error('unsupported event type')
        const { eventHash: _eventHash, ...unsigned } = record
        if (sha256Canonical(unsigned) !== eventHash) throw new Error('event hash mismatch')
        records.push(record)
        previousHash = eventHash
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

  private reduce(caseId: string, records: StewardEventRecord[], failures: string[]): StewardCase {
    const first = records[0]
    if (first.type !== 'case-created') throw new Error('case chain does not begin with case-created')
    const source = plain(first.payload, 'case-created payload')
    const created: CaseCreatedPayload = {
      title: text(source.title, 'case title', 300),
      identity: identity(source.identity),
      incident: bookmarkRecord(source.incident),
      primaryIncidentFingerprint: hash(source.primaryIncidentFingerprint, 'primaryIncidentFingerprint'),
      ...(source.assignedTo ? { assignedTo: actor(source.assignedTo, 'assignedTo') } : {})
    }
    if (eventFingerprint(created.identity, created.incident) !== created.primaryIncidentFingerprint) {
      throw new Error('primary incident fingerprint mismatch')
    }
    const value: StewardCase = {
      schemaVersion: STEWARD_CASE_SCHEMA_VERSION,
      caseId,
      title: created.title,
      createdAt: first.occurredAt,
      createdBy: decisionActor(first.actor, 'case-created actor'),
      identity: created.identity,
      primaryIncidentFingerprint: created.primaryIncidentFingerprint,
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
          break
        case 'case-assigned':
          value.assignedTo = actor(payload.assignedTo, 'assignedTo')
          break
        case 'case-status-set': {
          const status = text(payload.status, 'status', 30) as StewardCaseStatus
          if (!CASE_STATUSES.has(status)) throw new Error('unsupported case status')
          value.status = status
          break
        }
        case 'bookmark-added':
          value.bookmarks.push(bookmarkRecord(payload.bookmark))
          break
        case 'evidence-locked':
          value.evidence.push(evidenceRecord(payload.evidence))
          break
        case 'rule-version-cited':
          value.rules.push(ruleRecord(payload.citation))
          break
        case 'human-verdict-recorded':
          value.verdicts.push(verdictRecord(payload.verdict))
          value.status = value.appeals.some((entry) => entry.status === 'open') ? 'appealed' : 'decided'
          break
        case 'dissent-recorded':
          value.dissents.push(dissentRecord(payload.dissent))
          break
        case 'appeal-filed':
          value.appeals.push(appealRecord(payload.appeal))
          value.status = 'appealed'
          break
        case 'appeal-resolved': {
          const appealId = identifier(payload.appealId, 'appealId')
          const target = value.appeals.find((entry) => entry.appealId === appealId)
          if (!target) throw new Error(`appeal resolution references unknown appeal ${appealId}`)
          target.resolutions.push(resolutionRecord(payload.resolution))
          target.status = 'resolved'
          if (value.appeals.every((entry) => entry.status === 'resolved')) value.status = 'decided'
          break
        }
        case 'case-imported':
          value.importProvenance = importProvenanceRecord(payload.provenance)
          break
      }
    }
    assertUnique(value.bookmarks, (entry) => entry.bookmarkId, 'bookmarks')
    assertUnique(value.evidence, (entry) => entry.evidenceId, 'evidence')
    assertUnique(value.rules, (entry) => entry.citationId, 'rules')
    assertUnique(value.verdicts, (entry) => entry.verdictId, 'verdicts')
    assertUnique(value.dissents, (entry) => entry.dissentId, 'dissents')
    assertUnique(value.appeals, (entry) => entry.appealId, 'appeals')

    const evidenceFailures: string[] = []
    value.evidence = value.evidence.map((entry) => {
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
    })
    const chainFailures = [...failures]
    const integrity = emptyIntegrity(chainFailures, records.length, records.at(-1)?.eventHash)
    if (chainFailures.length === 0 && evidenceFailures.length > 0) {
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
