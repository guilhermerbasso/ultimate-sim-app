import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import type { IncidentClip } from '../../shared/incidents'
import { liveTelemetryState } from '../../shared/replay'
import {
  STORY_APPROVAL_TTL_MS,
  STORY_ENGINE_CHANNELS,
  STORY_EXPORT_SCHEMA,
  emptyStoryEngineState,
  generateStoryCards,
  storyApprovalBlockReason,
  storyPreview,
  type StoryCard,
  type StoryDecisionRequest,
  type StoryEngineState,
  type StoryEvidence,
  type StoryEvidenceSource,
  type StoryExportJournalEntry,
  type StoryExportRequest,
  type StoryExportResult,
  type StoryFactMap,
  type StoryRaceTimeline,
  type StoryTimelineEvent
} from '../../shared/story-engine'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import type { ModuleContext } from '../module-context'
import { logger } from './logger'

const LOG_AREA = 'story-engine'
const STORY_DIR = 'story-engine'
const STORY_STATE_FILE = 'state.json'
const STORY_EXPORTS_DIR = 'exports'
const INCIDENT_CLIPS_DIR = 'incident-clips'
const MAX_STORED_CARDS = 250
const STORY_DESTINATIONS = new Set(['local', 'lan', 'internet'])
const STORY_EXPORT_FORMATS = new Set(['json', 'markdown'])

interface StoryEngineStoreOptions {
  now?: () => number
  approvalId?: () => string
  exportId?: () => string
}

interface CompletedCapture {
  timeline: StoryRaceTimeline
  sourceStartMs: number
  sourceEndMs: number
}

interface ActiveCapture {
  identityKey: string
  timeline: StoryRaceTimeline
  sourceStartMs: number
  sourceEndMs: number
  lastSnapshot: TelemetrySnapshot
  lastPosition?: number
  lastIncidentCount?: number
  lastPitRoad: boolean
  lastCheckered: boolean
  lastLapKey?: string
  bestLapTimeSec?: number
  sawRace: boolean
  terminalObserved: boolean
  eventSequence: number
  evidenceSequence: number
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function safeText(value: unknown, maxLength = 500): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : undefined
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'cards'
}

function storySessionIdentity(snapshot: TelemetrySnapshot): { key: string; native: boolean } {
  if (finite(snapshot.sessionUniqueId)) {
    const sessionNumber = finite(snapshot.sessionNumber) ? Math.trunc(snapshot.sessionNumber) : 'session'
    return {
      key: `${snapshot.sim}:${Math.trunc(snapshot.sessionUniqueId)}:${sessionNumber}`,
      native: true
    }
  }
  const track = safeText(snapshot.trackName, 80) ?? 'track'
  const session = finite(snapshot.sessionNumber) ? Math.trunc(snapshot.sessionNumber) : 'session'
  const car = safeText(snapshot.carName, 80) ?? 'car'
  const sessionType = safeText(snapshot.sessionType, 40)?.toLowerCase() ?? 'unknown'
  const connectionEpoch = snapshot.replayContext?.connectionEpoch ?? 'connection'
  return {
    key: `${snapshot.sim}:${track}:${car}:${sessionType}:${session}:${connectionEpoch}`,
    native: false
  }
}

function raceClock(snapshot: TelemetrySnapshot, sourceStartMs: number): {
  eventTimeMs: number
  offsetMs: number
  clock: StoryEvidence['clock']['clock']
} {
  if (finite(snapshot.sessionTimeSec)) {
    const eventTimeMs = Math.max(0, snapshot.sessionTimeSec * 1_000)
    return {
      eventTimeMs,
      offsetMs: eventTimeMs - snapshot.timestamp,
      clock: 'sim'
    }
  }
  return {
    eventTimeMs: Math.max(0, snapshot.timestamp - sourceStartMs),
    offsetMs: -sourceStartMs,
    clock: 'monotonic'
  }
}

function isRaceSnapshot(snapshot: TelemetrySnapshot): boolean {
  const sessionType = snapshot.sessionType?.trim().toLowerCase()
  if (sessionType === 'race' || sessionType?.includes('race session') === true) return true
  if ((snapshot.sim === 'ac' || snapshot.sim === 'acc') && sessionType === '2') return true
  return snapshot.sim === 'ams2' && sessionType === '5'
}

function isExplicitRaceTerminal(snapshot: TelemetrySnapshot): boolean {
  if (!isRaceSnapshot(snapshot)) return false
  if (snapshot.flags?.checkered === true || snapshot.sessionState === 'checkered' || snapshot.sessionState === 'coolDown') {
    return true
  }
  if (finite(snapshot.lapsRemaining) && snapshot.lapsRemaining <= 0) return true
  return Boolean(
    finite(snapshot.sessionTimeRemainingSec) &&
    snapshot.sessionTimeRemainingSec >= 0 &&
    snapshot.sessionTimeRemainingSec <= 0.05 &&
    finite(snapshot.completedLaps) &&
    snapshot.completedLaps > 0
  )
}

function markdownEscape(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+.!|>-]/g, '\\$&')
}

function exportMarkdown(
  cards: readonly StoryCard[],
  destination: StoryExportRequest['destination'],
  exportedAt: number
): string {
  const lines = [
    '# Ultimate Sim App — Approved Story Cards',
    '',
    `- Exported: ${new Date(exportedAt).toISOString()}`,
    `- Destination preview: ${destination}`,
    '- Offline only: yes',
    '- Social publication performed: no',
    ''
  ]
  for (const card of cards) {
    const preview = storyPreview(card, destination)
    if (!preview) continue
    lines.push(
      `## ${markdownEscape(preview.title)}`,
      '',
      markdownEscape(preview.body),
      '',
      `- Confidence: ${(card.confidence.score * 100).toFixed(0)}% (${card.confidence.level})`,
      `- Status: ${card.status}`,
      `- Rights: ${card.policy.rightsState}/${card.policy.rightsScope}`,
      `- Consent: ${card.policy.consentState}`,
      `- Evidence: ${card.provenance.map((item) => `${item.id} (${item.contentHash})`).join(', ')}`,
      `- Approval: ${card.approval?.id ?? 'missing'}`,
      ''
    )
  }
  return `${lines.join('\n')}\n`
}

function compactExportJournal(entries: readonly StoryExportJournalEntry[]): StoryExportJournalEntry[] {
  const seen = new Set<string>()
  const unique = entries.filter((entry) => {
    if (!entry?.id || seen.has(entry.id)) return false
    seen.add(entry.id)
    return true
  })
  const committed = unique.filter((entry) => entry.status === 'committed')
  const finalized = unique.filter((entry) => entry.status === 'finalized').slice(0, 100)
  return [...committed, ...finalized]
}

export class StoryEngineStore {
  private state: StoryEngineState
  private readonly now: () => number
  private readonly approvalId: () => string
  private readonly exportId: () => string

  constructor(
    private readonly dir: string,
    options: StoryEngineStoreOptions = {}
  ) {
    this.now = options.now ?? Date.now
    this.approvalId = options.approvalId ?? randomUUID
    this.exportId = options.exportId ?? randomUUID
    this.state = this.read()
    this.recoverPendingExports()
  }

  getState(): StoryEngineState {
    return clone(this.state)
  }

  generate(timeline: StoryRaceTimeline): StoryEngineState {
    const generated = generateStoryCards(timeline, this.now())
    const existing = new Map(this.state.cards.map((card) => [card.dedupeKey, card]))
    const nextCards = generated.candidates.map((card) => {
      const previous = existing.get(card.dedupeKey)
      if (!previous || previous.revision !== card.revision) return card
      return {
        ...card,
        id: previous.id,
        createdAt: previous.createdAt,
        status: previous.status,
        decision: previous.decision,
        approval: previous.approval,
        exportedAt: previous.exportedAt
      }
    })
    const otherSessions = this.state.cards.filter((card) => card.sessionRef !== generated.sessionRef)
    this.state = {
      ...this.state,
      updatedAt: generated.generatedAt,
      cards: [...nextCards, ...otherSessions]
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, MAX_STORED_CARDS),
      issues: generated.issues,
      lastGeneration: {
        timelineId: generated.timelineId,
        sessionRef: generated.sessionRef,
        generatedAt: generated.generatedAt,
        candidateCount: generated.candidates.length,
        issueCount: generated.issues.length
      }
    }
    this.persist()
    return this.getState()
  }

  decide(request: StoryDecisionRequest): StoryEngineState {
    if (!request || (request.decision !== 'approved' && request.decision !== 'rejected')) {
      throw new Error('Decision must be approved or rejected.')
    }
    if (request?.humanConfirmed !== true) throw new Error('Human evidence review confirmation is required.')
    const reviewer = safeText(request.reviewer, 120)
    if (!reviewer) throw new Error('Reviewer name is required.')
    const index = this.state.cards.findIndex((card) => card.id === request.cardId)
    if (index < 0) throw new Error('Story card not found.')
    const card = this.state.cards[index]
    if (card.revision !== request.revision) throw new Error('Story card changed; review the latest evidence before deciding.')
    const decidedAt = this.now()
    const note = safeText(request.note, 500)

    if (request.decision === 'rejected') {
      this.state.cards[index] = {
        ...card,
        status: 'rejected',
        decision: {
          decision: 'rejected',
          reviewer,
          decidedAt,
          note
        },
        approval: undefined,
        exportedAt: undefined
      }
    } else {
      const destination = request.destination
      if (!destination || !STORY_DESTINATIONS.has(destination)) {
        throw new Error('A valid destination preview is required for approval.')
      }
      const blocked = storyApprovalBlockReason(card, destination, decidedAt)
      if (blocked) throw new Error(`Story card cannot be approved: ${blocked}.`)
      this.state.cards[index] = {
        ...card,
        status: 'approved',
        decision: {
          decision: 'approved',
          reviewer,
          decidedAt,
          note
        },
        approval: {
          id: this.approvalId(),
          reviewer,
          destination,
          approvedAt: decidedAt,
          expiresAt: decidedAt + STORY_APPROVAL_TTL_MS,
          scope: `story-card:${card.id}:${card.revision}:${destination}`,
          oneShot: true
        },
        exportedAt: undefined
      }
    }

    this.state.updatedAt = decidedAt
    this.persist()
    return this.getState()
  }

  exportApproved(request: StoryExportRequest): StoryExportResult {
    if (
      !request ||
      !STORY_DESTINATIONS.has(request.destination) ||
      !STORY_EXPORT_FORMATS.has(request.format) ||
      (request.cardIds !== undefined && (
        !Array.isArray(request.cardIds) ||
        request.cardIds.some((id) => typeof id !== 'string' || !id.trim())
      ))
    ) {
      throw new Error('Invalid offline export request.')
    }
    const exportedAt = this.now()
    const requestedIds = new Set(request.cardIds ?? [])
    const cards = this.state.cards.filter((card) =>
      card.status === 'approved' &&
      (requestedIds.size === 0 || requestedIds.has(card.id))
    )
    if (cards.length === 0) throw new Error('No approved story cards are ready for offline export.')
    if (requestedIds.size > 0 && cards.length !== requestedIds.size) {
      throw new Error('Every requested story card must still be approved.')
    }
    for (const card of cards) {
      const approval = card.approval
      if (!approval || approval.destination !== request.destination) {
        throw new Error(`Card ${card.id} is not approved for this destination preview.`)
      }
      if (approval.consumedAt !== undefined) throw new Error(`Approval for card ${card.id} was already consumed.`)
      if (approval.expiresAt <= exportedAt) throw new Error(`Approval for card ${card.id} expired.`)
      const blocked = storyApprovalBlockReason(card, request.destination, exportedAt)
      if (blocked) throw new Error(`Card ${card.id} is no longer exportable: ${blocked}.`)
    }

    const exportDir = join(this.dir, STORY_EXPORTS_DIR)
    mkdirSync(exportDir, { recursive: true })
    const extension = request.format === 'markdown' ? 'md' : 'json'
    const transactionId = this.exportId()
    const fileName = `story-cards-${safeFilePart(request.destination)}-${exportedAt}-${safeFilePart(transactionId)}.${extension}`
    const path = join(exportDir, fileName)
    const selected = cards.map((card) => {
      const preview = storyPreview(card, request.destination)
      if (!preview) throw new Error(`Destination preview missing for card ${card.id}.`)
      const approval = card.approval
      if (!approval) throw new Error(`Approval missing for card ${card.id}.`)
      return {
        id: card.id,
        revision: card.revision,
        sessionRef: card.sessionRef,
        eventType: card.eventType,
        observedInterval: card.observedInterval,
        lap: card.lap,
        title: preview.title,
        body: preview.body,
        confidence: card.confidence,
        provenance: card.provenance.map((item) => ({
          evidenceRef: item.id,
          source: item.source,
          contentHash: item.contentHash,
          contentLocatorRef: item.contentLocator,
          schemaFingerprintRef: `schema-${sha256(item.schemaFingerprint).slice(0, 16)}`,
          captureRange: item.captureRange,
          origin: item.origin,
          transformLineage: item.transformLineage,
          confidenceMethod: item.confidenceMethod,
          normalizedSessionTimeMs: item.normalizedSessionTimeMs,
          clockOffsetMs: item.clockOffsetMs,
          clockUncertaintyMs: item.clockUncertaintyMs,
          integrityFlags: item.integrityFlags,
          replayState: item.replayState
        })),
        redactions: card.redactions,
        policy: card.policy,
        destinationPreview: preview,
        approval: {
          id: approval.id,
          reviewerRef: `reviewer-${sha256(approval.reviewer).slice(0, 16)}`,
          destination: approval.destination,
          approvedAt: approval.approvedAt,
          expiresAt: approval.expiresAt,
          scope: approval.scope,
          oneShot: approval.oneShot
        }
      }
    })
    const payload = {
      schema: STORY_EXPORT_SCHEMA,
      offlineOnly: true,
      publication: 'not-performed',
      destinationPreview: request.destination,
      exportedAt,
      cards: selected
    }
    const content = request.format === 'markdown'
      ? exportMarkdown(cards, request.destination, exportedAt)
      : `${JSON.stringify(payload, null, 2)}\n`
    const pendingPath = `${path}.pending`
    writeFileSync(pendingPath, content, 'utf8')

    const exportedIds = new Set(cards.map((card) => card.id))
    const previousState = clone(this.state)
    this.state.cards = this.state.cards.map((card) => {
      if (!exportedIds.has(card.id) || !card.approval) return card
      return {
        ...card,
        status: 'exported',
        exportedAt,
        approval: {
          ...card.approval,
          consumedAt: exportedAt
        }
      }
    })
    this.state.updatedAt = exportedAt
    this.state.exportJournal = compactExportJournal([
      {
        id: transactionId,
        fileName,
        destination: request.destination,
        format: request.format,
        cardIds: cards.map((card) => card.id),
        exportedAt,
        contentHash: sha256Text(content),
        status: 'committed' as const
      },
      ...this.state.exportJournal.filter((entry) => entry.id !== transactionId)
    ])
    try {
      this.persist()
    } catch (error) {
      this.state = previousState
      rmSync(pendingPath, { force: true })
      throw error
    }
    try {
      renameSync(pendingPath, path)
    } catch (error) {
      throw new Error(`Offline export is pending crash recovery: ${error instanceof Error ? error.message : String(error)}`)
    }
    this.state.exportJournal = compactExportJournal(this.state.exportJournal.map((entry) =>
      entry.id === transactionId ? { ...entry, status: 'finalized' as const } : entry
    ))
    this.persist()
    return {
      path,
      format: request.format,
      destination: request.destination,
      cardIds: cards.map((card) => card.id),
      exportedAt,
      offlineOnly: true
    }
  }

  reset(): StoryEngineState {
    this.state = {
      ...emptyStoryEngineState(this.now()),
      exportJournal: this.state.exportJournal
    }
    this.persist()
    return this.getState()
  }

  private read(): StoryEngineState {
    const path = join(this.dir, STORY_STATE_FILE)
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as StoryEngineState
      if (
        parsed?.schema === emptyStoryEngineState(0).schema &&
        Array.isArray(parsed.cards) &&
        Array.isArray(parsed.issues)
      ) {
        return {
          ...parsed,
          exportJournal: compactExportJournal(Array.isArray(parsed.exportJournal) ? parsed.exportJournal : [])
        }
      }
    } catch {
      // First launch or corrupt local state: fail closed to an empty approval queue.
    }
    return emptyStoryEngineState(this.now())
  }

  private persist(): void {
    mkdirSync(this.dir, { recursive: true })
    const path = join(this.dir, STORY_STATE_FILE)
    const nextPath = `${path}.next`
    const content = `${JSON.stringify(this.state, null, 2)}\n`
    writeFileSync(nextPath, content, 'utf8')
    try {
      renameSync(nextPath, path)
    } catch {
      writeFileSync(path, content, 'utf8')
      rmSync(nextPath, { force: true })
    }
  }

  private recoverPendingExports(): void {
    const exportDir = join(this.dir, STORY_EXPORTS_DIR)
    if (!existsSync(exportDir)) return
    let files: string[]
    try {
      files = readdirSync(exportDir).filter((name) => name.endsWith('.pending'))
    } catch {
      return
    }
    const journalFiles = new Set(this.state.exportJournal.map((entry) => `${entry.fileName}.pending`))
    for (const file of files) {
      if (journalFiles.has(file)) continue
      try {
        rmSync(join(exportDir, file), { force: true })
      } catch {
        // Best-effort cleanup of an uncommitted orphan package.
      }
    }
    let changed = false
    this.state.exportJournal = compactExportJournal(this.state.exportJournal.map((entry) => {
      const pendingPath = join(exportDir, `${entry.fileName}.pending`)
      const finalPath = join(exportDir, entry.fileName)
      if (entry.status === 'finalized') {
        if (existsSync(pendingPath)) {
          try {
            rmSync(pendingPath, { force: true })
          } catch {
            // Best effort; the finalized file remains authoritative.
          }
        }
        return entry
      }
      try {
        if (existsSync(finalPath)) {
          const content = readFileSync(finalPath, 'utf8')
          if (sha256Text(content) === entry.contentHash) {
            changed = true
            return { ...entry, status: 'finalized' as const }
          }
          return entry
        }
        if (existsSync(pendingPath)) {
          const content = readFileSync(pendingPath, 'utf8')
          if (sha256Text(content) !== entry.contentHash) {
            rmSync(pendingPath, { force: true })
            return entry
          }
          renameSync(pendingPath, finalPath)
          changed = true
          return { ...entry, status: 'finalized' as const }
        }
      } catch {
        // Leave the committed journal entry for the next recovery attempt.
      }
      return entry
    }))
    if (changed) {
      this.state.updatedAt = this.now()
      try {
        this.persist()
      } catch {
        // The exact journal remains committed on disk and will be retried.
      }
    }
  }
}

export class StoryTimelineCollector {
  private active: ActiveCapture | null = null

  constructor(
    private readonly appVersion: string,
    private readonly now: () => number = Date.now,
    private readonly captureId: () => string = randomUUID
  ) {}

  observe(snapshot: TelemetrySnapshot | null): CompletedCapture[] {
    if (!snapshot || !snapshot.connected) {
      const completed = this.finish()
      return completed ? [completed] : []
    }
    if (liveTelemetryState(snapshot) !== 'live') return []

    const identity = storySessionIdentity(snapshot)
    const completed: CompletedCapture[] = []
    if (this.active && this.active.identityKey !== identity.key) {
      const previous = this.finish()
      if (previous) completed.push(previous)
    }
    if (!this.active) this.active = this.start(snapshot, identity)
    this.capture(snapshot)
    return completed
  }

  finish(): CompletedCapture | null {
    const active = this.active
    this.active = null
    if (!active || !active.sawRace || !active.terminalObserved) return null
    this.addFinish(active)
    active.timeline.completed = true
    active.timeline.endedAt = this.now()
    return {
      timeline: active.timeline,
      sourceStartMs: active.sourceStartMs,
      sourceEndMs: active.sourceEndMs
    }
  }

  private start(
    snapshot: TelemetrySnapshot,
    identity: { key: string; native: boolean }
  ): ActiveCapture {
    const sessionRef = identity.native
      ? identity.key
      : `${identity.key}:capture-${this.captureId()}`
    return {
      identityKey: identity.key,
      timeline: {
        id: `timeline-${sha256({ sessionRef, started: snapshot.timestamp }).slice(0, 16)}`,
        sessionRef,
        completed: false,
        trackName: safeText(snapshot.trackName, 120),
        carName: safeText(snapshot.carName, 120),
        startedAt: this.now(),
        events: [],
        evidence: []
      },
      sourceStartMs: snapshot.timestamp,
      sourceEndMs: snapshot.timestamp,
      lastSnapshot: snapshot,
      lastPosition: finite(snapshot.position) && snapshot.position > 0 ? Math.trunc(snapshot.position) : undefined,
      lastIncidentCount: finite(snapshot.incidentCountMy) ? Math.max(0, Math.trunc(snapshot.incidentCountMy)) : undefined,
      lastPitRoad: snapshot.onPitRoad === true,
      lastCheckered: snapshot.flags?.checkered === true || snapshot.sessionState === 'checkered',
      sawRace: isRaceSnapshot(snapshot),
      terminalObserved: isExplicitRaceTerminal(snapshot),
      eventSequence: 0,
      evidenceSequence: 0
    }
  }

  private capture(snapshot: TelemetrySnapshot): void {
    const active = this.active
    if (!active) return
    active.sourceEndMs = snapshot.timestamp
    active.sawRace ||= isRaceSnapshot(snapshot)

    const position = finite(snapshot.position) && snapshot.position > 0 ? Math.trunc(snapshot.position) : undefined
    if (position !== undefined && active.lastPosition !== undefined && position !== active.lastPosition) {
      this.addTelemetryEvent(active, snapshot, 'position-change', {
        assertionId: `position:${Math.round(snapshot.timestamp)}:${position}`,
        predicate: 'position-at-observed-time',
        claimValue: position,
        facts: {
          subjectLabel: 'The player car',
          fromPosition: active.lastPosition,
          toPosition: position
        },
        priority: position < active.lastPosition ? 0.8 : 0.55
      })
    }
    active.lastPosition = position ?? active.lastPosition

    const completedLap = finite(snapshot.completedLaps)
      ? Math.max(0, Math.trunc(snapshot.completedLaps))
      : finite(snapshot.currentLap)
        ? Math.max(0, Math.trunc(snapshot.currentLap) - 1)
        : undefined
    const lapTimeSec = finite(snapshot.lastLapTimeSec) && snapshot.lastLapTimeSec > 0
      ? snapshot.lastLapTimeSec
      : undefined
    const lapKey = completedLap !== undefined && lapTimeSec !== undefined
      ? `${completedLap}:${lapTimeSec.toFixed(4)}`
      : undefined
    if (
      lapKey &&
      lapTimeSec !== undefined &&
      completedLap !== undefined &&
      lapKey !== active.lastLapKey &&
      (active.bestLapTimeSec === undefined || lapTimeSec < active.bestLapTimeSec)
    ) {
      active.bestLapTimeSec = lapTimeSec
      this.addTelemetryEvent(active, snapshot, 'fastest-lap', {
        assertionId: `fastest-lap:${completedLap}`,
        predicate: 'recorded-fastest-lap-time',
        claimValue: lapTimeSec,
        facts: {
          subjectLabel: 'The player car',
          lapTimeSec
        },
        lap: completedLap,
        priority: 0.75
      })
    }
    active.lastLapKey = lapKey ?? active.lastLapKey

    const incidents = finite(snapshot.incidentCountMy) ? Math.max(0, Math.trunc(snapshot.incidentCountMy)) : undefined
    if (incidents !== undefined && active.lastIncidentCount !== undefined && incidents > active.lastIncidentCount) {
      this.addTelemetryEvent(active, snapshot, 'incident-count', {
        assertionId: `incident-count:${Math.round(snapshot.timestamp)}`,
        predicate: 'incident-count-at-observed-time',
        claimValue: incidents,
        facts: {
          fromCount: active.lastIncidentCount,
          toCount: incidents
        },
        lap: finite(snapshot.currentLap) ? Math.max(0, Math.trunc(snapshot.currentLap)) : undefined,
        priority: 0.58
      })
    }
    active.lastIncidentCount = incidents ?? active.lastIncidentCount

    if (snapshot.onPitRoad === true && !active.lastPitRoad) {
      this.addTelemetryEvent(active, snapshot, 'pit-stop', {
        assertionId: `pit-road:${Math.round(snapshot.timestamp)}`,
        predicate: 'pit-road-state',
        claimValue: true,
        facts: { subjectLabel: 'The player car' },
        lap: finite(snapshot.currentLap) ? Math.max(0, Math.trunc(snapshot.currentLap)) : undefined,
        priority: 0.45
      })
    }
    active.lastPitRoad = snapshot.onPitRoad === true

    const checkered = snapshot.flags?.checkered === true || snapshot.sessionState === 'checkered'
    if (checkered && !active.lastCheckered) {
      this.addTelemetryEvent(active, snapshot, 'flag', {
        assertionId: 'checkered-flag',
        predicate: 'flag-state',
        claimValue: 'checkered',
        facts: { flag: 'checkered' },
        priority: 0.8
      })
    }
    active.lastCheckered = checkered
    active.terminalObserved ||= isExplicitRaceTerminal(snapshot)
    active.lastSnapshot = snapshot
  }

  private addFinish(active: ActiveCapture): void {
    const snapshot = active.lastSnapshot
    const position = finite(snapshot.position) && snapshot.position > 0 ? Math.trunc(snapshot.position) : undefined
    if (position === undefined || active.timeline.events.some((event) => event.type === 'finish')) return
    this.addTelemetryEvent(active, snapshot, 'finish', {
      assertionId: 'finish-position',
      predicate: 'terminal-classification-position',
      claimValue: position,
      facts: {
        subjectLabel: 'The player car',
        position,
        totalCars: finite(snapshot.totalCars) ? Math.max(0, Math.trunc(snapshot.totalCars)) : null,
        resultKind: 'terminal-classification'
      },
      lap: finite(snapshot.completedLaps) ? Math.max(0, Math.trunc(snapshot.completedLaps)) : undefined,
      priority: 1
    })
  }

  private addTelemetryEvent(
    active: ActiveCapture,
    snapshot: TelemetrySnapshot,
    type: StoryTimelineEvent['type'],
    input: {
      assertionId: string
      predicate: string
      claimValue: StoryTimelineEvent['claim']['value']
      facts: StoryFactMap
      lap?: number
      priority: number
    }
  ): void {
    const clock = raceClock(snapshot, active.sourceStartMs)
    const eventId = `${active.timeline.id}-event-${++active.eventSequence}`
    const evidenceId = `${active.timeline.id}-evidence-${++active.evidenceSequence}`
    const facts: StoryFactMap = {
      ...input.facts,
      ...(input.lap !== undefined ? { lap: input.lap } : {})
    }
    const claim: StoryTimelineEvent['claim'] = {
      subjectRef: 'player-car',
      predicate: input.predicate,
      value: input.claimValue
    }
    const evidence: StoryEvidence = {
      id: evidenceId,
      source: 'telemetry',
      eventType: type,
      statement: `Normalized telemetry fact ${type} at session ${clock.eventTimeMs} ms.`,
      contentHash: sha256({
        type,
        sessionRef: active.timeline.sessionRef,
        timestamp: snapshot.timestamp,
        sessionTimeSec: snapshot.sessionTimeSec,
        facts,
        claimValue: input.claimValue
      }),
      contentLocator: `telemetry:${active.timeline.sessionRef}:${Math.round(snapshot.timestamp)}`,
      contentCommitted: true,
      schemaFingerprint: 'telemetry-snapshot.story-v1',
      captureRange: {
        start: snapshot.timestamp,
        end: snapshot.timestamp,
        unit: 'ms'
      },
      origin: {
        producer: `telemetry:${snapshot.sim}`,
        version: this.appVersion
      },
      transformLineage: ['telemetry-normalization-v1', 'post-race-story-capture-v1'],
      confidence: {
        score: 0.98,
        method: 'direct-normalized-telemetry-field-v1'
      },
      clock: {
        clock: clock.clock,
        sourceTimeMs: snapshot.timestamp,
        toSessionOffsetMs: clock.offsetMs,
        uncertaintyMs: 50
      },
      rights: {
        state: 'cleared',
        scope: 'local',
        ownerRef: 'local-user',
        checkedAt: this.now()
      },
      consent: {
        state: 'not-required',
        epoch: 0,
        checkedAt: this.now()
      },
      privacyClass: 'D1',
      claim,
      facts,
      replayState: snapshot.replayContext?.state ?? 'live'
    }
    const event: StoryTimelineEvent = {
      id: eventId,
      type,
      eventClass: 'fact',
      sessionTimeMs: clock.eventTimeMs,
      lap: input.lap,
      evidenceRefs: [evidenceId],
      assertionId: input.assertionId,
      claim,
      facts,
      priority: input.priority
    }
    active.timeline.evidence.push(evidence)
    active.timeline.events.push(event)
  }
}

function nearestClockEvidence(timeline: StoryRaceTimeline, sourceTimeMs: number): StoryEvidence | undefined {
  return timeline.evidence
    .filter((item) => item.source === 'telemetry')
    .sort((left, right) =>
      Math.abs(left.clock.sourceTimeMs - sourceTimeMs) - Math.abs(right.clock.sourceTimeMs - sourceTimeMs)
    )[0]
}

function incidentClipFiles(userData: string): string[] {
  const dir = join(userData, INCIDENT_CLIPS_DIR)
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter((name) => name.toLowerCase().endsWith('.json'))
      .map((name) => join(dir, name))
  } catch {
    return []
  }
}

function appendIncidentClips(
  capture: CompletedCapture,
  userData: string,
  appVersion: string,
  now: number
): StoryRaceTimeline {
  const timeline = clone(capture.timeline)
  const existingClipIds = new Set(
    timeline.evidence
      .filter((item) => item.source === 'incident-clip')
      .map((item) => item.contentLocator)
  )
  for (const file of incidentClipFiles(userData)) {
    let clip: IncidentClip
    let raw: string
    try {
      raw = readFileSync(file, 'utf8')
      clip = JSON.parse(raw) as IncidentClip
    } catch {
      continue
    }
    if (!clip || !finite(clip.at) || clip.at < capture.sourceStartMs || clip.at > capture.sourceEndMs) continue
    if (existingClipIds.has(file)) continue
    const clockEvidence = nearestClockEvidence(timeline, clip.at)
    const offsetMs = clockEvidence?.clock.toSessionOffsetMs ?? -capture.sourceStartMs
    const sessionTimeMs = Math.max(0, clip.at + offsetMs)
    const evidenceId = `${timeline.id}-incident-evidence-${sha256(clip.id).slice(0, 10)}`
    const eventId = `${timeline.id}-incident-event-${sha256(clip.id).slice(0, 10)}`
    const windowTimes = Array.isArray(clip.window)
      ? clip.window.map((sample) => sample.t).filter(finite)
      : []
    const lap = finite(clip.lap) ? Math.max(0, Math.trunc(clip.lap)) : undefined
    const facts: StoryFactMap = {
      incidentType: clip.type,
      severity: clip.severity,
      ...(lap !== undefined ? { lap } : {})
    }
    const claim: StoryTimelineEvent['claim'] = {
      subjectRef: 'player-car',
      predicate: 'incident-classification',
      value: `${clip.type}:${clip.severity}`
    }
    const source: StoryEvidenceSource = 'incident-clip'
    timeline.evidence.push({
      id: evidenceId,
      source,
      eventType: 'incident',
      statement: `Local incident clip ${clip.id} records ${clip.severity} ${clip.type}.`,
      contentHash: createHash('sha256').update(raw).digest('hex'),
      contentLocator: `incident:${clip.id}`,
      contentCommitted: true,
      schemaFingerprint: 'incident-clip.story-v1',
      captureRange: {
        start: windowTimes.length > 0 ? Math.min(...windowTimes) : clip.at,
        end: windowTimes.length > 0 ? Math.max(...windowTimes) : clip.at,
        unit: 'ms'
      },
      origin: {
        producer: 'incident-recorder',
        version: appVersion
      },
      transformLineage: ['incident-classifier-v1', 'post-race-story-capture-v1'],
      confidence: {
        score: 0.84,
        method: 'deterministic-incident-classifier-v1'
      },
      clock: {
        clock: clockEvidence?.clock.clock ?? 'monotonic',
        sourceTimeMs: clip.at,
        toSessionOffsetMs: offsetMs,
        uncertaintyMs: 100
      },
      rights: {
        state: 'cleared',
        scope: 'local',
        ownerRef: 'local-user',
        checkedAt: now
      },
      consent: {
        state: 'not-required',
        epoch: 0,
        checkedAt: now
      },
      privacyClass: 'D1',
      integrityFlags: ['derived'],
      claim,
      facts
    })
    timeline.events.push({
      id: eventId,
      type: 'incident',
      eventClass: 'fact',
      sessionTimeMs,
      lap,
      evidenceRefs: [evidenceId],
      assertionId: `incident-clip:${clip.id}`,
      claim,
      facts,
      priority: clip.severity === 'major' ? 0.9 : clip.severity === 'moderate' ? 0.7 : 0.55
    })
  }
  return timeline
}

export function register(ctx: ModuleContext): void {
  const appVersion = ctx.app.getVersion()
  const userData = ctx.app.getPath('userData')
  const store = new StoryEngineStore(join(userData, STORY_DIR))
  const collector = new StoryTimelineCollector(appVersion)

  const publishState = (state: StoryEngineState): StoryEngineState => {
    ctx.broadcast(STORY_ENGINE_CHANNELS.changed, state)
    return state
  }

  const finishCapture = (capture: CompletedCapture): void => {
    try {
      const timeline = appendIncidentClips(capture, userData, appVersion, Date.now())
      publishState(store.generate(timeline))
    } catch (error) {
      logger.warn(LOG_AREA, 'failed to generate post-race story cards', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const onSnapshot = (snapshot: TelemetrySnapshot | null): void => {
    for (const capture of collector.observe(snapshot)) finishCapture(capture)
  }
  ctx.telemetryHub.on('snapshot', onSnapshot)

  ctx.ipcMain.handle(STORY_ENGINE_CHANNELS.state, () => store.getState())
  ctx.ipcMain.handle(STORY_ENGINE_CHANNELS.generate, (_event, timeline: StoryRaceTimeline) =>
    publishState(store.generate(timeline))
  )
  ctx.ipcMain.handle(STORY_ENGINE_CHANNELS.decide, (_event, request: StoryDecisionRequest) =>
    publishState(store.decide(request))
  )
  ctx.ipcMain.handle(STORY_ENGINE_CHANNELS.exportApproved, (_event, request: StoryExportRequest) => {
    const result = store.exportApproved(request)
    publishState(store.getState())
    return result
  })
  ctx.ipcMain.handle(STORY_ENGINE_CHANNELS.reset, () => publishState(store.reset()))

  ctx.registerGracefulTeardown(() => {
    ctx.telemetryHub.off('snapshot', onSnapshot)
    const capture = collector.finish()
    if (capture) finishCapture(capture)
  }, 'quiesce')
}
