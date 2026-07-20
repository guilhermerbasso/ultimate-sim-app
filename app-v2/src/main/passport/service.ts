import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  DEFAULT_PASSPORT_TAP_BUDGETS,
  type Phase02TapDelivery,
  type Phase02TapSubscription
} from '../../shared/phase02-tap'
import {
  DEFAULT_PASSPORT_CONFIG,
  DEFAULT_PASSPORT_PRIVACY,
  PASSPORT_ITEM_DEFINITIONS,
  STINT_PASSPORT_CONTRACT_VERSION,
  calculatePassportCoverage,
  isPassportRole,
  passportItemDefinition,
  type PassportChallengeInput,
  type PassportChallenge,
  type PassportChallengeOwnerInput,
  type PassportConfig,
  type PassportDataClass,
  type PassportDeleteResult,
  type PassportExportProfile,
  type PassportExperimentUpdate,
  type PassportExperimentMetrics,
  type PassportFullAuditResult,
  type PassportImportResult,
  type PassportIntegrityState,
  type PassportItem,
  type PassportItemResolutionInput,
  type PassportPrivacySettings,
  type PassportRosterMember,
  type PassportSnapshot,
  type StintPassport
} from '../../shared/stint-passport'
import {
  canonicalFactValue,
  canonicalFactsByName,
  emptyConfidence,
  emptyObservedInterval,
  type CanonicalFact,
  type CanonicalRaceOpsEvent
} from '../../shared/phase02-contracts'
import { PHASE02_DESCRIPTOR_SHA256 } from '../phase02/generated/contract-descriptor'
import type { ModuleContext } from '../module-context'
import {
  evaluatePassportItems,
  expirePassportItems,
  validateChallengeReadiness,
  withCoverage
} from './evaluator'
import { inspectPassportReadiness } from './readiness'
import { PassportPersistenceClient } from './persistence-client'
import type {
  PassportAuthoritativeState,
  PassportExportPackage,
  PassportMutationKind,
  PassportPersistenceMigrationPlan,
  PassportPersistenceMigrationState,
  PassportRetentionReceiptResult,
  PassportStoreEvent
} from './persistence-engine'
import { PASSPORT_SERVICE_DRAIN_DEADLINE_MS } from './persistence-deadlines'

const SUBSCRIPTION_ID = 'stint-passport'
const OVERFLOW_RECOVERY_FRAMES = 3
const HISTORY_LIMIT = 50
const BROADCAST_THROTTLE_MS = 250
const RETENTION_INTERVAL_MS = 15 * 60_000

function clean(value: unknown, max = 160): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, max)
    : ''
}

async function withinDeadline<T>(
  task: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      task,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function factText(event: CanonicalRaceOpsEvent, name: string): string {
  const value = canonicalFactValue(canonicalFactsByName(event.facts).get(name))
  return typeof value === 'string' ? value : ''
}

function factBoolean(event: CanonicalRaceOpsEvent, name: string): boolean | undefined {
  const value = canonicalFactValue(canonicalFactsByName(event.facts).get(name))
  return typeof value === 'boolean' ? value : undefined
}

function evidenceHash(value: unknown): string {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex')
}

function lowerClassAttestationDetail(status: PassportItem['status']): string {
  return status === 'manual-confirmed'
    ? 'Manually confirmed by the assigned roster owner.'
    : status === 'not-applicable'
      ? 'Marked not applicable with a private retained reason.'
      : 'Waived with a private retained reason.'
}

function lowerClassAttestationSummary(status: PassportItem['status']): string {
  return status === 'manual-confirmed'
    ? 'Manual attestation recorded.'
    : status === 'not-applicable'
      ? 'Not-applicable attestation recorded.'
      : 'Waiver attestation recorded.'
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${stableJson(record[key])}`
  ).join(',')}}`
}

function passportStateKey(passport: StintPassport): string {
  return JSON.stringify({
    lifecycle: passport.lifecycle,
    telemetryContext: passport.telemetryContext,
    coverage: passport.coverage,
    items: passport.items.map((item) => ({
      id: item.id,
      status: item.status,
      owner: item.owner,
      overrideReason: item.overrideReason
    })).sort((left, right) => left.id.localeCompare(right.id))
  })
}

function privacyIntentKey(privacy: PassportPrivacySettings): string {
  return stableJson({
    identityPersistenceOptIn: privacy.identityPersistenceOptIn,
    retentionDays: privacy.retentionDays
  })
}

function rosterStateKey(roster: readonly PassportRosterMember[]): string {
  return stableJson(roster.map((member) => ({
    memberId: member.memberId,
    displayName: member.displayName,
    roles: [...member.roles].sort(),
    active: member.active
  })).sort((left, right) => left.memberId.localeCompare(right.memberId)))
}

function identityFromEvent(event: CanonicalRaceOpsEvent, now: number): StintPassport['identity'] | null {
  const sessionRef = event.sessionRef
  const trackRef = factText(event, 'session.track_ref')
  const trackName = factText(event, 'session.track_name')
  const trackConfig = factText(event, 'session.track_config')
  const carRef = factText(event, 'car.ref')
  const carLabel = factText(event, 'car.name')
  const driverRef = factText(event, 'driver.ref')
  const driverLabel = factText(event, 'driver.name')
  if (!sessionRef || !trackRef || !trackName || !carRef || !carLabel || !driverRef || !driverLabel) {
    return null
  }
  return {
    stintId: randomUUID(),
    sessionRef,
    trackRef,
    trackLabel: trackConfig ? `${trackName} — ${trackConfig}` : trackName,
    carRef,
    carLabel,
    driverRef,
    driverLabel,
    teamRef: factText(event, 'team.ref') || undefined,
    teamLabel: factText(event, 'team.name') || undefined,
    startedAt: now
  }
}

function emptyItems(): PassportItem[] {
  return PASSPORT_ITEM_DEFINITIONS.map((definition) => ({
    id: definition.id,
    status: 'unknown',
    detail: 'Awaiting evaluation.',
    revision: 0
  }))
}

function closeReason(
  current: StintPassport,
  next: StintPassport['identity']
): NonNullable<StintPassport['closeReason']> {
  if (current.identity.sessionRef !== next.sessionRef) return 'session-boundary'
  if (current.identity.carRef !== next.carRef || current.identity.trackRef !== next.trackRef) {
    return 'car-track-boundary'
  }
  return 'driver-swap'
}

function ownerIsValid(
  owner: PassportItemResolutionInput['owner'],
  roster: readonly PassportRosterMember[],
  itemId: PassportItemResolutionInput['itemId']
): boolean {
  if (!owner || !isPassportRole(owner.role)) return false
  const member = roster.find((candidate) => candidate.memberId === owner.memberId && candidate.active)
  return Boolean(
    member &&
    member.roles.includes(owner.role) &&
    passportItemDefinition(itemId).allowedRoles.includes(owner.role)
  )
}

interface ChallengeMutationFence {
  challengeId: string
  generation: number
  lifecycleGeneration: number
  stintId: string
  passportRevision: number
}

interface ReadinessRefreshFence {
  generation: number
  lifecycleGeneration: number
  stintId: string
  lifecycle: StintPassport['lifecycle']
  passportRevision: number
  eventSequence: string
}

interface ServiceMutationIntent {
  operationId: string
  kind: PassportMutationKind | 'persistence-migration' | 'persistence-repair'
  deletingClasses: readonly PassportDataClass[]
}

interface PendingMutationRecovery {
  operationId: string
  kind: ServiceMutationIntent['kind']
  classes: readonly PassportDataClass[]
  desiredStateKey: string
  desiredIdentityPersistenceOptIn?: boolean
  recover: () => Promise<void>
}

export class StintPassportService {
  private readonly subscription: Phase02TapSubscription
  private current: StintPassport | null = null
  private readonly ephemeralHistory: StintPassport[] = []
  private roster: PassportRosterMember[]
  private config: PassportConfig
  private privacy: PassportPrivacySettings
  private lastEvent: CanonicalRaceOpsEvent | null = null
  private overflowBlocked = false
  private cleanFramesSinceOverflow = 0
  private lastError: string | undefined
  private lastBroadcastAt = 0
  private broadcastScheduled = false
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null
  private refreshQueue: Promise<void> = Promise.resolve()
  private readonly ready: Promise<void>
  private retentionTimer: ReturnType<typeof setInterval> | null = null
  private challenge: PassportChallenge | undefined
  private challengeNonceHash: Buffer | undefined
  private challengeGeneration = 0
  private lifecycleGeneration = 0
  private privacyMutationGeneration = 0
  private rosterMutationGeneration = 0
  private readinessGeneration = 0
  private mutationIntentQueue: Promise<void> = Promise.resolve()
  private rosterIntentQueue: Promise<void> = Promise.resolve()
  private readonly deletingPrivacyClasses = new Map<PassportDataClass, number>()
  private readonly privacyClassDeletionGeneration: Record<PassportDataClass, number> = {
    D1: 0,
    D2: 0,
    D3: 0
  }
  private pendingMutationRecovery: PendingMutationRecovery | undefined
  private pendingRecoveryPromise: Promise<void> | null = null
  private challengeClaim: { challengeId: string; generation: number } | undefined
  private readonly pendingStoreOperations = new Set<Promise<unknown>>()
  private readonly ambiguousMutations = new Map<string, {
    passport: StintPassport
    event: PassportStoreEvent
  }>()
  private disposePromise: Promise<void> | null = null
  private readonly mutationCapability = randomBytes(24).toString('base64url')
  private experiment = {
    handoffAttempts: 0,
    handoffDefects: 0,
    falseBlocks: 0,
    bypasses: 0,
    completedChallenges: 0,
    totalOverheadMs: 0,
    manualBaselineDefects: 0,
    manualBaselineSwaps: 0
  }
  private readonly redactedBefore: Record<PassportDataClass, number> = {
    D1: 0,
    D2: 0,
    D3: 0
  }
  private readonly redactedThroughSourceTick: Partial<Record<PassportDataClass, string>> = {}

  constructor(
    private readonly ctx: ModuleContext,
    private readonly store: PassportPersistenceClient,
    private readonly now: () => number = Date.now
  ) {
    this.config = { ...DEFAULT_PASSPORT_CONFIG }
    this.privacy = {
      ...DEFAULT_PASSPORT_PRIVACY,
      retentionDays: { ...DEFAULT_PASSPORT_PRIVACY.retentionDays }
    }
    this.roster = []
    this.subscription = ctx.phase02Tap.subscribe(
      SUBSCRIPTION_ID,
      DEFAULT_PASSPORT_TAP_BUDGETS,
      (delivery) => this.consume(delivery)
    )
    this.ready = this.initialize()
  }

  async dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise
    this.disposePromise = (async () => {
      this.subscription.dispose()
      if (this.broadcastTimer) clearTimeout(this.broadcastTimer)
      this.broadcastTimer = null
      if (this.retentionTimer) clearInterval(this.retentionTimer)
      this.retentionTimer = null
      let drainError: unknown
      try {
        await withinDeadline(
          (async () => {
            await this.ready.catch(() => undefined)
            await Promise.all([this.mutationIntentQueue, this.rosterIntentQueue])
            await this.recoverPendingMutation()
            this.assertNoUnresolvedMutation('Passport shutdown')
            await this.drainStoreOperations()
            if (this.current) await this.closeCurrentInternal('disconnect', true)
            await this.drainStoreOperations()
          })(),
          PASSPORT_SERVICE_DRAIN_DEADLINE_MS,
          'Passport service persistence drain timed out.'
        )
      } catch (error) {
        drainError = error
      }
      let closeError: unknown
      try {
        await this.store.close()
      } catch (error) {
        closeError = error
      }
      if (drainError && closeError) {
        throw new AggregateError(
          [drainError, closeError],
          'Passport service drain and persistence client close both failed.'
        )
      }
      if (closeError) throw closeError
      if (drainError) throw drainError
    })()
    return this.disposePromise
  }

  async snapshot(): Promise<PassportSnapshot> {
    await this.ready
    await this.awaitMutationBarrier('snapshot', true)
    const queue = this.subscription.status()
    let persistence = this.store.status()
    const runtimeUnsafe = queue.killSwitch ||
      queue.consumerErrors > 0 ||
      this.overflowBlocked ||
      this.lastEvent?.telemetryContext !== 'live'
    if (this.current) {
      this.current = this.reconcileReadiness(
        this.current,
        runtimeUnsafe ||
          (this.current.persisted && (
            persistence.state !== 'ready' ||
            this.current.durability !== 'durable'
          ))
      )
    }
    if (
      this.current &&
      this.lastEvent &&
      this.current.telemetryContext === 'live' &&
      persistence.state === 'ready' &&
      !runtimeUnsafe &&
      this.current.durability !== 'failed' &&
      this.current.durability !== 'quarantined'
    ) {
      await this.refreshExternal('snapshot')
    }

    let integrity: PassportIntegrityState = {
      state: persistence.state === 'quarantined' ? 'corrupt' : 'unavailable',
      verified: false,
      scope: 'bounded',
      checkedEvents: 0,
      lastCheckedAt: this.now(),
      message: 'Passport integrity is unavailable while persistence is not ready.'
    }
    let persisted: StintPassport[] = []
    if (persistence.state === 'ready') {
      try {
        integrity = await this.store.getIntegrity()
        if (this.privacy.identityPersistenceOptIn) {
          persisted = await this.store.listPassports(HISTORY_LIMIT)
        }
      } catch {
        persistence = this.store.status()
        integrity = {
          state: persistence.state === 'quarantined' ? 'corrupt' : 'unavailable',
          verified: false,
          scope: 'bounded',
          checkedEvents: 0,
          lastCheckedAt: this.now(),
          message: 'Passport integrity status could not be read from persistence.'
        }
        this.lastError = 'Passport persistence status could not be read safely.'
      }
    }
    if (this.current?.persisted && (
      persistence.state !== 'ready' ||
      !integrity.verified ||
      integrity.state !== 'anchored' ||
      this.current.durability !== 'durable'
    )) {
      this.current = this.reconcileReadiness(this.current, true)
    }
    const byId = new Map<string, StintPassport>()
    for (const passport of [...persisted, ...this.ephemeralHistory]) {
      if (passport.identity.stintId !== this.current?.identity.stintId) {
        byId.set(passport.identity.stintId, passport)
      }
    }
    return {
      contractVersion: STINT_PASSPORT_CONTRACT_VERSION,
      current: this.current,
      history: [...byId.values()]
        .sort((left, right) => right.identity.startedAt - left.identity.startedAt)
        .slice(0, HISTORY_LIMIT),
      roster: [...this.roster],
      config: this.config,
      privacy: this.privacy,
      runtime: {
        telemetryContext: this.lastEvent?.telemetryContext ?? 'disconnected',
        queue,
        overflowBlocked: this.overflowBlocked,
        cleanFramesSinceOverflow: this.cleanFramesSinceOverflow,
        lastError: this.lastError
      },
      integrity,
      persistence,
      mutationCapability: this.mutationCapability,
      challenge: this.challenge,
      experiment: { ...this.experiment }
    }
  }

  assertCapability(value: unknown): void {
    if (typeof value !== 'string' || value.length !== this.mutationCapability.length) {
      throw new Error('Passport mutation capability is invalid.')
    }
    const left = Buffer.from(value)
    const right = Buffer.from(this.mutationCapability)
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      throw new Error('Passport mutation capability is invalid.')
    }
  }

  private async initialize(): Promise<void> {
    this.config = await this.store.getConfig()
    const authoritative = await this.readAuthoritativeState()
    this.applyInitialAuthoritativeState(authoritative)
    if (authoritative.persistenceMigration) {
      const operationId = authoritative.persistenceMigration.operationId
      const migrationIntent = this.createMutationIntent(
        'persistence-migration',
        [],
        operationId
      )
      const resume = async (): Promise<void> => {
        let state = await this.readAuthoritativeState(operationId)
        const migration = state.persistenceMigration
        if (migration) {
          if (migration.operationId !== operationId) {
            throw new Error('Persistence migration was superseded by authoritative durable state.')
          }
          await this.resumePersistenceMigration(migration)
          state = await this.readAuthoritativeState(operationId)
        }
        if (state.persistenceMigration?.operationId === operationId) {
          throw new Error('Persistence migration remains incomplete.')
        }
        this.applyInitialAuthoritativeState(state)
      }
      try {
        await this.enqueueMutationIntent(migrationIntent, resume)
      } catch (error) {
        this.recordPersistenceError(error)
        this.installPendingRecovery(
          migrationIntent,
          `persistence-migration:${operationId}`,
          resume,
          true
        )
        if (this.current) {
          this.current = {
            ...this.current,
            durability: 'failed',
            lifecycle: this.current.lifecycle === 'ready'
              ? 'awaiting-checklist'
              : this.current.lifecycle,
            challengeCompletedAt: undefined,
            challengeOwner: undefined
          }
        }
      }
    }
    const killSwitch = await this.store.getKillSwitch()
    this.subscription.setKillSwitch(killSwitch)
    this.store.setKillSwitch(killSwitch)
    if (this.current && !this.pendingMutationRecovery) {
      await this.closeCurrentInternal('restart-recovery', true)
    }
    if (!this.pendingMutationRecovery) {
      const retainedAt = this.now()
      const retentionIntent = this.createMutationIntent(
        'privacy-retention',
        ['D1', 'D2', 'D3']
      )
      try {
        await this.enqueueMutationIntent(
          retentionIntent,
          () => this.executeRetentionIntent(retentionIntent, retainedAt, 'startup')
        )
      } catch (error) {
        this.recordPersistenceError(error)
      }
    }
    this.retentionTimer = setInterval(() => {
      void this.runRetention('scheduled').catch((error) => {
        this.lastError = error instanceof Error ? error.message : String(error)
        this.notify()
      })
    }, RETENTION_INTERVAL_MS)
  }

  async runRetention(reason: 'scheduled' | 'explicit' | 'startup'): Promise<PassportDeleteResult[]> {
    await this.ready
    const retainedAt = this.now()
    const intent = this.createMutationIntent('privacy-retention', ['D1', 'D2', 'D3'])
    return this.enqueueMutationIntent(
      intent,
      () => this.executeRetentionIntent(intent, retainedAt, reason)
    )
  }

  async setRoster(roster: readonly PassportRosterMember[]): Promise<PassportRosterMember[]> {
    const candidate = this.buildRosterCandidate(roster)
    const deletionWasActive = this.deletingPrivacyClasses.has('D3')
    const deletionGeneration = this.privacyClassDeletionGeneration.D3
    await this.ready
    const intent = this.createMutationIntent(
      'roster-save',
      [],
      `roster-explicit:${randomUUID()}`
    )
    return this.enqueueMutationIntent(intent, async () => {
      if (
        deletionWasActive ||
        deletionGeneration !== this.privacyClassDeletionGeneration.D3
      ) {
        throw new Error('Roster update crossed a privacy deletion; retry from sanitized state.')
      }
      const persisted = await this.commitRosterIntent(intent, candidate)
      if (
        this.deletingPrivacyClasses.has('D3') ||
        deletionGeneration !== this.privacyClassDeletionGeneration.D3
      ) {
        throw new Error('Roster update was superseded by privacy deletion.')
      }
      this.publishRoster(persisted, true)
      if (this.current && this.lastEvent) {
        await this.revalidateCurrent(undefined, 'roster-updated', true)
      }
      this.notify()
      return this.cloneRoster(this.roster)
    })
  }

  async setConfig(config: PassportConfig): Promise<PassportConfig> {
    await this.ready
    await this.awaitMutationBarrier('configuration update')
    this.config = await this.store.setConfig(config)
    this.invalidateAttestations('configuration-changed')
    if (this.current && this.lastEvent) await this.refreshExternal('config-updated')
    this.notify()
    return this.config
  }

  async setPrivacy(privacy: PassportPrivacySettings): Promise<PassportPrivacySettings> {
    const desired = this.buildPrivacyCandidate(privacy)
    await this.ready
    const d3DeletionWasActive = this.deletingPrivacyClasses.has('D3')
    const d3DeletionGeneration = this.privacyClassDeletionGeneration.D3
    const deleting = !desired.identityPersistenceOptIn
      ? (['D1', 'D2', 'D3'] as const)
      : []
    const intent = this.createMutationIntent(
      'privacy-settings',
      deleting,
      `privacy:${randomUUID()}`
    )
    return this.enqueueMutationIntent(
      intent,
      () => this.executePrivacyIntent(
        intent,
        desired,
        () => d3DeletionWasActive ||
          d3DeletionGeneration !== this.privacyClassDeletionGeneration.D3
      )
    )
  }

  async resolveItem(input: PassportItemResolutionInput): Promise<StintPassport> {
    const dataClass = passportItemDefinition(input.itemId).dataClass
    const deletionWasActive = this.deletingPrivacyClasses.has(dataClass)
    const deletionGeneration = this.privacyClassDeletionGeneration[dataClass]
    await this.ready
    await this.awaitMutationBarrier('Passport item resolution')
    if (
      deletionWasActive ||
      deletionGeneration !== this.privacyClassDeletionGeneration[dataClass]
    ) {
      throw new Error('Passport item resolution crossed a privacy deletion; retry from sanitized state.')
    }
    let current = this.requireCurrent(input.stintId)
    const previous = current
    if (
      input.status !== 'manual-confirmed' &&
      input.status !== 'waived-with-reason' &&
      input.status !== 'not-applicable'
    ) {
      throw new Error('Unsupported manual Passport item status.')
    }
    if (!ownerIsValid(input.owner, this.roster, input.itemId)) {
      throw new Error('Passport item owner must be an active roster member with an allowed role.')
    }
    const definition = passportItemDefinition(input.itemId)
    if (input.status === 'not-applicable' && !definition.notApplicableEligible) {
      throw new Error(`${input.itemId} cannot be marked not applicable.`)
    }
    const reasonCode = clean(input.reasonCode, 80)
    const freeText = clean(input.freeText, 500)
    if ((input.status === 'waived-with-reason' || input.status === 'not-applicable') && !reasonCode) {
      throw new Error('A structured reason code is required for waived or not-applicable items.')
    }
    if (input.status === 'waived-with-reason') this.experiment.bypasses += 1
    const retainedText = definition.dataClass === 'D3' && this.privacy.identityPersistenceOptIn
      ? freeText
      : ''
    const now = this.now()
    const items = current.items.map((item): PassportItem =>
      item.id === input.itemId
        ? {
            ...item,
            status: input.status,
            owner: input.owner,
            detail: definition.dataClass === 'D3'
              ? input.status === 'manual-confirmed'
                ? 'Manually confirmed by the assigned roster owner.'
                : reasonCode
              : lowerClassAttestationDetail(input.status),
            overrideReason: reasonCode || undefined,
            reasonCode: reasonCode || undefined,
            verifiedAt: now,
            expiresAt: now + definition.ttlMs,
            evidence: {
              source: 'human-attestation',
              summary: definition.dataClass === 'D3'
                ? retainedText || reasonCode || `Confirmed for ${input.owner.role}.`
                : lowerClassAttestationSummary(input.status),
              contentHash: evidenceHash(definition.dataClass === 'D3'
                ? {
                    itemId: input.itemId,
                    status: input.status,
                    owner: input.owner,
                    reasonCode,
                    freeText: retainedText,
                    now
                  }
                : {
                    itemId: input.itemId,
                    status: input.status,
                    now
                  }),
              capturedAt: now,
              state: 'available'
            },
            revision: item.revision + 1
          }
        : item
    )
    this.current = withCoverage(current, items)
    this.current = { ...this.current, revision: current.revision + 1 }
    this.clearChallenge()
    await this.persistCurrent(this.event(
      'ultimate.sim.raceops.passport.item-resolved.v1',
      {
        itemId: input.itemId,
        status: input.status,
        ...(definition.dataClass === 'D3'
          ? {
              role: input.owner.role,
              reasonCode,
              freeText: retainedText
            }
          : {})
      },
      definition.dataClass,
      input.itemId
    ), previous)
    this.notify()
    return this.current
  }

  async prepareChallenge(input: PassportChallengeOwnerInput): Promise<PassportChallenge> {
    await this.ready
    await this.awaitMutationBarrier('challenge preparation')
    let current = this.requireCurrent(input.stintId)
    if (!ownerIsValid(input.owner, this.roster, 'final-acknowledgement')) {
      throw new Error('Challenge owner must be an active driver or team manager.')
    }
    await this.refreshExternal('challenge-prepare')
    current = this.requireCurrent(input.stintId)
    if (this.overflowBlocked) throw new Error('Passport source overflow must recover before challenge preparation.')
    const nonce = randomBytes(6).toString('hex').toUpperCase()
    this.challengeNonceHash = createHash('sha256').update(nonce, 'utf8').digest()
    this.challengeGeneration += 1
    this.challengeClaim = undefined
    this.challenge = {
      challengeId: randomUUID(),
      nonce,
      owner: input.owner,
      passportRevision: current.revision,
      expiresAt: this.now() + 60_000
    }
    this.experiment.handoffAttempts += 1
    this.notify()
    return this.challenge
  }

  async completeChallenge(input: PassportChallengeInput): Promise<StintPassport> {
    await this.ready
    await this.awaitMutationBarrier('challenge completion')
    let current = this.requireCurrent(input.stintId)
    if (this.subscription.status().killSwitch) throw new Error('Passport tap kill switch is active.')
    if (this.overflowBlocked) throw new Error('Passport source overflow must recover before challenge completion.')
    const challenge = this.challenge
    if (!challenge || challenge.challengeId !== input.challengeId) {
      throw new Error('Passport challenge is missing or superseded.')
    }
    if (challenge.expiresAt <= this.now()) {
      this.clearChallenge()
      throw new Error('Passport challenge expired.')
    }
    if (challenge.passportRevision !== current.revision) {
      this.clearChallenge()
      throw new Error('Passport changed after challenge preparation.')
    }
    if (
      challenge.owner.memberId !== input.owner.memberId ||
      challenge.owner.role !== input.owner.role ||
      !ownerIsValid(input.owner, this.roster, 'final-acknowledgement')
    ) {
      throw new Error('Challenge owner must be an active driver or team manager.')
    }
    const responseHash = createHash('sha256').update(clean(input.response, 64), 'utf8').digest()
    if (!this.challengeNonceHash || !timingSafeEqual(responseHash, this.challengeNonceHash)) {
      throw new Error('Passport challenge response is invalid.')
    }
    const generation = this.challengeGeneration
    if (this.challengeClaim?.challengeId === challenge.challengeId) {
      throw new Error('Passport challenge completion is already in progress.')
    }
    this.challengeClaim = { challengeId: challenge.challengeId, generation }
    const fence: ChallengeMutationFence = {
      challengeId: challenge.challengeId,
      generation,
      lifecycleGeneration: this.lifecycleGeneration,
      stintId: input.stintId,
      passportRevision: challenge.passportRevision
    }
    const previous = current
    try {
      await this.refreshExternal('challenge-revalidation')
      current = this.assertChallengeFence(fence, 'revalidation')
      const now = this.now()
      const finalDefinition = passportItemDefinition('final-acknowledgement')
      const items = expirePassportItems(current.items, now).map((item): PassportItem =>
        item.id === 'final-acknowledgement'
          ? {
              ...item,
              status: 'manual-confirmed',
              owner: input.owner,
              detail: 'Final challenge-response acknowledgement completed.',
              verifiedAt: now,
              expiresAt: now + finalDefinition.ttlMs,
              evidence: {
                source: 'challenge-response',
                summary: `Acknowledged by ${input.owner.memberId}/${input.owner.role}.`,
                contentHash: evidenceHash({ stintId: input.stintId, owner: input.owner, now }),
                capturedAt: now,
                state: 'available'
              },
              revision: item.revision + 1
            }
          : item
      )
      current = withCoverage(current, items)
      const errors = validateChallengeReadiness(current, this.roster, now)
      if (errors.length > 0) throw new Error(errors.join(' '))
      if (current.persisted) {
        const integrity = await this.store.verifyActiveStint(current.identity.stintId)
        this.assertChallengeFence(fence, 'integrity verification')
        if (!integrity.verified) {
          throw new Error(integrity.message ?? 'A trusted integrity signature is required before Ready.')
        }
      }
      const candidate: StintPassport = {
        ...current,
        lifecycle: 'ready',
        challengeCompletedAt: now,
        challengeOwner: input.owner,
        revision: current.revision + 1
      }
      const persisted = await this.persistChallengeCandidate(candidate, this.event(
        'ultimate.sim.raceops.passport.challenge-completed.v1',
        {
          coverage: candidate.coverage,
          owner: input.owner,
          itemHashes: candidate.items.map((item) => item.evidence?.contentHash ?? '')
        },
        'D3',
        undefined,
        candidate
      ), previous, fence)
      this.assertChallengeFence(fence, 'durable commit')
      this.current = persisted
      this.experiment.completedChallenges += 1
      this.experiment.totalOverheadMs += Math.max(0, now - (challenge.expiresAt - 60_000))
      this.clearChallenge(false)
      this.notify()
      return this.current
    } finally {
      if (this.challengeClaim?.challengeId === challenge.challengeId &&
        this.challengeClaim.generation === generation) {
        this.challengeClaim = undefined
      }
    }
  }

  async closeCurrent(reason: NonNullable<StintPassport['closeReason']> = 'manual'): Promise<StintPassport | null> {
    await this.ready
    await this.awaitMutationBarrier('stint close')
    return this.closeCurrentInternal(reason, reason === 'disconnect' || reason === 'replay-boundary')
  }

  async setKillSwitch(enabled: boolean): Promise<boolean> {
    await this.ready
    await this.awaitMutationBarrier('kill switch update')
    if (enabled && this.current) await this.closeCurrentInternal('manual', true)
    await this.store.setWorkerKillSwitch(enabled)
    this.store.setKillSwitch(enabled)
    this.subscription.setKillSwitch(enabled)
    if (enabled) {
      this.lastError = 'Passport tap kill switch is active.'
      await this.store.logRuntime('kill-switch', { enabled: true })
    }
    this.notify()
    return enabled
  }

  async exportPackage(profile: PassportExportProfile): Promise<PassportExportPackage> {
    await this.ready
    await this.awaitMutationBarrier('Passport export')
    return this.store.exportPackage(profile, this.current, this.ephemeralHistory, this.roster)
  }

  async importPackage(value: unknown): Promise<PassportImportResult> {
    const deletionWasActive = this.deletingPrivacyClasses.size > 0
    const deletionGeneration = { ...this.privacyClassDeletionGeneration }
    await this.ready
    await this.awaitMutationBarrier('Passport package import request')
    if (
      deletionWasActive ||
      (['D1', 'D2', 'D3'] as const).some((dataClass) =>
        deletionGeneration[dataClass] !== this.privacyClassDeletionGeneration[dataClass]
      )
    ) {
      throw new Error('Passport import crossed a privacy deletion; retry from sanitized state.')
    }
    const privacyMutationGeneration = this.privacyMutationGeneration
    const bundle = await this.trackStoreOperation(this.store.verifyImportPackage(value))
    this.assertPrivacyMutationGeneration(privacyMutationGeneration, 'package replay')
    if ((['D1', 'D2', 'D3'] as const).some((dataClass) =>
      deletionGeneration[dataClass] !== this.privacyClassDeletionGeneration[dataClass]
    )) {
      throw new Error('Passport import was superseded by privacy deletion.')
    }
    const prefix = bundle.packageHash.slice(0, 12)
    for (const sourcePassport of bundle.passports.slice().reverse()) {
      const replay: StintPassport = {
        ...sourcePassport,
        identity: {
          ...sourcePassport.identity,
          stintId: `import:${prefix}:${sourcePassport.identity.stintId}`,
          sessionRef: `replay:${prefix}:${sourcePassport.identity.sessionRef}`
        },
        lifecycle: sourcePassport.lifecycle === 'closed' ? 'closed' : 'interrupted',
        telemetryContext: 'replay',
        challengeCompletedAt: undefined,
        challengeOwner: undefined,
        closeReason: sourcePassport.lifecycle === 'closed'
          ? sourcePassport.closeReason
          : 'replay-boundary',
        interrupted: sourcePassport.lifecycle !== 'closed',
        persisted: false,
        durability: 'ephemeral',
        revision: sourcePassport.revision + 1
      }
      const existing = this.ephemeralHistory.findIndex((entry) =>
        entry.identity.stintId === replay.identity.stintId
      )
      if (existing >= 0) this.ephemeralHistory.splice(existing, 1)
      this.ephemeralHistory.unshift(replay)
    }
    this.ephemeralHistory.splice(HISTORY_LIMIT)
    this.notify()
    return {
      ok: true,
      canceled: false,
      importedPassports: Math.min(bundle.passports.length, HISTORY_LIMIT),
      packageHash: bundle.packageHash
    }
  }

  async deleteByClass(dataClass: PassportDataClass): Promise<PassportDeleteResult> {
    await this.ready
    const intent = this.createMutationIntent(`privacy-delete:${dataClass}`, [dataClass])
    return this.enqueueMutationIntent(
      intent,
      () => this.executeDeleteIntent(intent, dataClass)
    )
  }

  private applyLocalClassDeletion(dataClass: PassportDataClass): void {
    if (dataClass === 'D3') {
      this.applyDurableD3Deletion()
      return
    }
    this.redactedBefore[dataClass] = Math.max(this.redactedBefore[dataClass], this.now())
    this.redactedThroughSourceTick[dataClass] = this.lastEvent?.sourceTick
    const redact = (passport: StintPassport): StintPassport => {
      let changed = false
      const items = passport.items.map((item): PassportItem => {
        if (passportItemDefinition(item.id).dataClass !== dataClass) return item
        if (
          item.evidence === undefined &&
          item.detail === 'Evidence removed by data-class deletion.'
        ) {
          return item
        }
        changed = true
        return {
          ...item,
          status: 'unknown',
          evidence: undefined,
          detail: 'Evidence removed by data-class deletion.',
          verifiedAt: undefined,
          expiresAt: undefined,
          revision: item.revision + 1
        }
      })
      const redacted = changed
        ? withCoverage({ ...passport, revision: passport.revision + 1 }, items)
        : withCoverage(passport, items)
      return this.coherentAfterPrivacyRedaction(redacted)
    }
    if (this.current) {
      const previousLifecycle = this.current.lifecycle
      this.current = redact(this.current)
      if (previousLifecycle === 'ready' && this.current.lifecycle !== 'ready') {
        this.clearChallenge(false)
      }
    }
    for (let index = 0; index < this.ephemeralHistory.length; index += 1) {
      this.ephemeralHistory[index] = redact(this.ephemeralHistory[index])
    }
  }

  private applyDurableD3Deletion(): void {
    this.redactedBefore.D3 = Math.max(this.redactedBefore.D3, this.now())
    if (this.lastEvent?.sourceTick) {
      this.redactedThroughSourceTick.D3 = this.lastEvent.sourceTick
    }
    this.lifecycleGeneration += 1
    this.current = null
    this.clearChallenge(false)
    this.roster = []
    this.ephemeralHistory.length = 0
    this.ambiguousMutations.clear()
    this.lastEvent = null
    this.privacy = {
      ...this.privacy,
      identityPersistenceOptIn: false,
      updatedAt: this.now()
    }
  }

  async runFullAudit(): Promise<PassportFullAuditResult> {
    await this.ready
    await this.awaitMutationBarrier('full audit')
    const result = await this.trackStoreOperation(this.store.runFullAudit())
    if (result.integrity.state === 'corrupt' && this.current) {
      this.current = this.reconcileReadiness({
        ...this.current,
        durability: 'quarantined'
      }, true)
      this.clearChallenge()
    }
    this.notify()
    return result
  }

  async repairPersistence(token: string): Promise<{ quarantinedPath: string }> {
    const repairToken = clean(token, 128)
    if (!repairToken) throw new Error('Persistence repair token is required.')
    await this.ready
    const intent = this.createMutationIntent(
      'persistence-repair',
      ['D1', 'D2', 'D3']
    )
    return this.enqueueMutationIntent(
      intent,
      () => this.executeRepairIntent(intent, repairToken)
    )
  }

  async recordExperiment(update: PassportExperimentUpdate): Promise<PassportExperimentMetrics> {
    await this.ready
    await this.awaitMutationBarrier('experiment update')
    const count = Math.max(1, Math.min(1000, Math.round(update.count ?? 1)))
    if (update.kind === 'handoff-defect') this.experiment.handoffDefects += count
    else if (update.kind === 'false-block') this.experiment.falseBlocks += count
    else if (update.kind === 'bypass') this.experiment.bypasses += count
    else if (update.kind === 'manual-baseline-defect') this.experiment.manualBaselineDefects += count
    else if (update.kind === 'manual-baseline-swap') this.experiment.manualBaselineSwaps += count
    else throw new Error('Unknown Passport experiment metric.')
    await this.store.logRuntime('experiment-metric', {
      kind: update.kind,
      count,
      metrics: this.experiment
    })
    this.notify()
    return { ...this.experiment }
  }

  private async consume(delivery: Phase02TapDelivery): Promise<void> {
    await this.awaitMutationBarrier('telemetry update')
    const event = delivery.event
    const d3RedactedThrough = this.redactedThroughSourceTick.D3
    if (
      d3RedactedThrough &&
      !this.sourceTickIsNewer(event.sourceTick, d3RedactedThrough)
    ) {
      return
    }
    this.releaseRedactionBarriersFor(event.sourceTick)
    this.lastEvent = event
    if (event.integrityFlags.includes('gap')) {
      this.overflowBlocked = true
      this.cleanFramesSinceOverflow = 0
      this.lastError = 'Phase 02 tap overflow detected; Passport challenge is blocked until clean frames recover.'
      if (this.current) this.current = this.reconcileReadiness(this.current, true)
      this.clearChallenge()
      await this.store.logRuntime('tap-overflow', {
        sequence: event.sequence,
        queue: this.subscription.status()
      })
    } else if (this.overflowBlocked) {
      this.cleanFramesSinceOverflow += 1
      if (this.cleanFramesSinceOverflow >= OVERFLOW_RECOVERY_FRAMES) {
        this.overflowBlocked = false
        this.lastError = undefined
      }
    }
    const connected = factBoolean(event, 'telemetry.connected') === true
    if (!connected || event.telemetryContext !== 'live') {
      if (this.current) {
        await this.closeCurrentInternal(
          connected ? 'replay-boundary' : 'disconnect',
          true
        )
      }
      this.notify()
      return
    }
    const identity = identityFromEvent(event, this.now())
    if (!identity) {
      this.lastError = 'Live Passport identity is incomplete.'
      this.notify()
      return
    }
    if (!this.current) {
      const privacyMutationGeneration = this.privacyMutationGeneration
      const candidate: StintPassport = {
        contractVersion: STINT_PASSPORT_CONTRACT_VERSION,
        identity,
        lifecycle: 'awaiting-checklist',
        telemetryContext: 'live',
        items: emptyItems(),
        coverage: 0,
        applicableItems: PASSPORT_ITEM_DEFINITIONS.length,
        coveredItems: 0,
        interrupted: false,
        persisted: false,
        revision: 1,
        durability: this.privacy.identityPersistenceOptIn ? 'pending' : 'ephemeral'
      }
      await this.seedDriverRoster(identity.driverRef, identity.driverLabel)
      this.assertPrivacyMutationGeneration(
        privacyMutationGeneration,
        'automatic roster update'
      )
      this.current = candidate
      this.current = withCoverage(this.current, evaluatePassportItems({
        passport: this.current,
        event,
        roster: this.roster,
        config: this.config,
        now: this.now()
      }))
      this.current = this.reconcileReadiness(this.current)
      const started = this.current
      await this.persistCurrent(this.event(
        'ultimate.sim.raceops.passport.stint-started.v1',
        { sessionRef: identity.sessionRef, trackRef: identity.trackRef, carRef: identity.carRef },
        'D3'
      ), started)
      await this.refreshExternal('stint-started')
      this.notify()
      return
    }
    if (
      this.current.identity.sessionRef !== identity.sessionRef ||
      this.current.identity.trackRef !== identity.trackRef ||
      this.current.identity.carRef !== identity.carRef ||
      this.current.identity.driverRef !== identity.driverRef
    ) {
      const reason = closeReason(this.current, identity)
      await this.closeCurrentInternal(reason, false)
      await this.consume(delivery)
      return
    }
    const previous = this.current
    const before = passportStateKey(previous)
    this.current = this.restoreIndependentPrivacyMetadata(previous, withCoverage(
      this.current,
      evaluatePassportItems({
        passport: this.current,
        event,
        roster: this.roster,
        config: this.config,
        now: this.now()
      })
    ))
    this.current = this.reconcileReadiness(this.current)
    if (passportStateKey(this.current) !== before) {
      this.current = { ...this.current, revision: this.current.revision + 1 }
      this.clearChallenge()
      await this.persistCurrent(this.event(
        'ultimate.sim.raceops.passport.telemetry-revalidated.v1',
        {
          sequence: event.sequence,
          statuses: this.current.items.map((item) => [item.id, item.status])
        },
        'D2'
      ), previous)
      this.notify()
    }
  }

  private async refreshExternal(
    reason: string,
    insideMutationIntent = false
  ): Promise<void> {
    const run = this.refreshQueue.catch(() => undefined).then(() =>
      this.refreshExternalNow(reason, insideMutationIntent)
    )
    this.refreshQueue = run.catch(() => undefined)
    await run
  }

  private async refreshExternalNow(
    reason: string,
    insideMutationIntent = false
  ): Promise<void> {
    if (!insideMutationIntent) await this.awaitMutationBarrier('readiness refresh')
    if (!this.current || !this.lastEvent) return
    const previous = this.current
    const sourceEvent = this.lastEvent
    const sourceRoster = this.roster.map((member) => ({
      ...member,
      roles: [...member.roles]
    }))
    const sourceConfig = {
      ...this.config,
      requiredDeviceIds: [...this.config.requiredDeviceIds],
      requiredControlIds: [...this.config.requiredControlIds],
      requiredAudioCallouts: [...this.config.requiredAudioCallouts]
    }
    const fence = this.captureReadinessRefreshFence(previous, sourceEvent)
    const before = passportStateKey(previous)
    const external = await inspectPassportReadiness(this.ctx, sourceEvent, sourceConfig, this.now())
    if (!this.readinessRefreshFenceMatches(fence)) return
    let candidate = this.restoreIndependentPrivacyMetadata(previous, withCoverage(
      previous,
      evaluatePassportItems({
        passport: previous,
        event: sourceEvent,
        roster: sourceRoster,
        config: sourceConfig,
        external,
        now: this.now()
      })
    ))
    candidate = this.reconcileReadiness(candidate)
    if (passportStateKey(candidate) !== before) {
      candidate = { ...candidate, revision: candidate.revision + 1 }
      if (!this.readinessRefreshFenceMatches(fence)) return
      this.current = candidate
      this.clearChallenge()
      const published = this.current
      try {
        await this.persistCurrent(this.event(
          'ultimate.sim.raceops.passport.external-revalidated.v1',
          {
            reason,
            statuses: published.items.map((item) => [item.id, item.status])
          },
          'D2'
        ), previous, () => !this.readinessPublicationMatches(fence, published.revision))
      } catch (error) {
        if (!this.readinessPublicationMatches(fence, published.revision)) return
        throw error
      }
    }
  }

  private async revalidateCurrent(
    _external: undefined,
    reason: string,
    insideMutationIntent = false
  ): Promise<void> {
    if (!this.current || !this.lastEvent) return
    const previous = this.current
    const lifecycleGeneration = this.lifecycleGeneration
    const stintId = previous.identity.stintId
    this.current = this.restoreIndependentPrivacyMetadata(previous, withCoverage(
      this.current,
      evaluatePassportItems({
        passport: this.current,
        event: this.lastEvent,
        roster: this.roster,
        config: this.config,
        now: this.now()
      })
    ))
    await this.refreshExternal(reason, insideMutationIntent)
    if (
      !this.current ||
      this.current.identity.stintId !== stintId ||
      this.lifecycleGeneration !== lifecycleGeneration
    ) {
      return
    }
    await this.persistCurrent(this.event(
      'ultimate.sim.raceops.passport.roster-revalidated.v1',
      { reason, coverage: this.current.coverage },
      'D3'
    ), previous)
  }

  private async closeCurrentInternal(
    reason: NonNullable<StintPassport['closeReason']>,
    interrupted: boolean
  ): Promise<StintPassport | null> {
    if (!this.current) return null
    this.readinessGeneration += 1
    this.lifecycleGeneration += 1
    this.clearChallenge(false)
    const previous = this.current
    const closed: StintPassport = {
      ...this.current,
      lifecycle: interrupted ? 'interrupted' : 'closed',
      closedAt: this.now(),
      closeReason: reason,
      interrupted,
      revision: this.current.revision + 1
    }
    this.current = closed
    await this.persistCurrent(this.event(
      'ultimate.sim.raceops.passport.stint-closed.v1',
      { reason, interrupted, coverage: closed.coverage },
      'D3'
    ), previous)
    const finalized = this.current ?? closed
    this.ephemeralHistory.unshift(finalized)
    this.ephemeralHistory.splice(HISTORY_LIMIT)
    this.current = null
    return finalized
  }

  private async persistCurrent(
    event: PassportStoreEvent,
    rollbackState: StintPassport | null = this.current,
    superseded: () => boolean = () => false
  ): Promise<void> {
    if (this.deletingPrivacyClasses.size > 0) {
      throw new Error('Passport persistence is blocked by an active privacy deletion.')
    }
    if (!this.current || !this.privacy.identityPersistenceOptIn) {
      if (this.current) this.current = { ...this.current, persisted: false }
      return
    }

    const operationKey = event.canonicalEvent.dedupeKey
    const privacyMutationGeneration = this.privacyMutationGeneration
    const cached = this.ambiguousMutations.get(operationKey)
    const attempted = cached ?? {
      passport: { ...this.current, persisted: true, durability: 'pending' as const },
      event
    }
    try {
      this.assertPrivacyMutationGeneration(privacyMutationGeneration, 'Passport persistence')
      if (superseded()) throw new Error('Passport persistence was superseded by a newer mutation.')
      this.current = attempted.passport
      const persisted = await this.trackStoreOperation(
        this.store.persistPassport(
          attempted.passport,
          attempted.event,
          privacyMutationGeneration
        )
      )
      if (
        privacyMutationGeneration !== this.privacyMutationGeneration ||
        superseded()
      ) {
        throw new Error('Passport persistence completion was superseded by privacy deletion.')
      }
      this.current = { ...persisted, durability: 'durable' }
      this.ambiguousMutations.delete(operationKey)
      this.lastError = undefined
    } catch (error) {
      if (
        privacyMutationGeneration !== this.privacyMutationGeneration ||
        superseded()
      ) {
        this.recordPersistenceError(error)
        throw error
      }
      this.ambiguousMutations.set(operationKey, attempted)
      this.recordPersistenceError(error)
      const fallback = rollbackState ?? attempted.passport
      this.current = {
        ...fallback,
        durability: this.store.status().state === 'quarantined' ? 'quarantined' : 'failed',
        lifecycle: fallback.lifecycle === 'ready' ? 'awaiting-checklist' : fallback.lifecycle,
        challengeCompletedAt: undefined,
        challengeOwner: undefined
      }
      this.notify()
      throw error
    }
  }

  private async persistChallengeCandidate(
    candidate: StintPassport,
    event: PassportStoreEvent,
    rollbackState: StintPassport,
    fence: ChallengeMutationFence
  ): Promise<StintPassport> {
    if (this.deletingPrivacyClasses.size > 0) {
      throw new Error('Passport challenge persistence is blocked by an active privacy deletion.')
    }
    if (!this.privacy.identityPersistenceOptIn) {
      this.assertChallengeFence(fence, 'ephemeral commit')
      return { ...candidate, persisted: false, durability: 'ephemeral' }
    }
    const operationKey = event.canonicalEvent.dedupeKey
    const privacyMutationGeneration = this.privacyMutationGeneration
    const attempted = this.ambiguousMutations.get(operationKey) ?? {
      passport: { ...candidate, persisted: true, durability: 'pending' as const },
      event
    }
    let persisted: StintPassport
    try {
      this.assertPrivacyMutationGeneration(
        privacyMutationGeneration,
        'challenge persistence'
      )
      this.assertChallengeFence(fence, 'persistence dispatch')
      persisted = await this.trackStoreOperation(
        this.store.persistPassport(
          attempted.passport,
          attempted.event,
          privacyMutationGeneration
        )
      )
    } catch (error) {
      if (privacyMutationGeneration !== this.privacyMutationGeneration) {
        this.recordPersistenceError(error)
        throw error
      }
      this.ambiguousMutations.set(operationKey, attempted)
      this.recordPersistenceError(error)
      if (this.challengeFenceMatches(fence)) {
        this.current = {
          ...rollbackState,
          durability: this.store.status().state === 'quarantined' ? 'quarantined' : 'failed',
          lifecycle: rollbackState.lifecycle === 'ready' ? 'awaiting-checklist' : rollbackState.lifecycle,
          challengeCompletedAt: undefined,
          challengeOwner: undefined
        }
        this.notify()
      }
      throw error
    }
    if (privacyMutationGeneration !== this.privacyMutationGeneration) {
      throw new Error('Passport persistence completion was superseded by privacy deletion.')
    }
    this.ambiguousMutations.delete(operationKey)
    this.assertChallengeFence(fence, 'persistence response')
    this.lastError = undefined
    return { ...persisted, durability: 'durable' }
  }

  private event(
    eventType: string,
    payload: Record<string, unknown>,
    dataClass: PassportDataClass,
    itemId?: PassportItem['id'],
    passport: StintPassport | null = this.current
  ): PassportStoreEvent {
    const capturedAt = this.now()
    const operationHash = evidenceHash({
      stintId: passport?.identity.stintId ?? 'none',
      eventType,
      itemId: itemId ?? '',
      dataClass,
      revision: passport?.revision ?? 0,
      payload
    })
    const dedupeKey = `passport:${operationHash}`
    const provenance = (unit: string, privacyClass: 'D1' | 'D2' | 'D3') => ({
      sourceId: 'stint-passport-main',
      transformId: 'passport.canonical-event.v2',
      schemaFingerprint: PHASE02_DESCRIPTOR_SHA256,
      canonicalUnit: unit,
      validity: 'valid' as const,
      nullReason: 'unspecified' as const,
      sourceTick: String(capturedAt),
      observedMonotonicNs: '0',
      ageMs: '0',
      privacyClass
    })
    const facts: CanonicalFact[] = Object.entries(payload)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]): CanonicalFact => {
        const privacyClass = dataClass
        if (typeof value === 'boolean') {
          return { name: `passport.${name}`, canonicalUnit: 'bool', value: { kind: 'bool', value }, provenance: provenance('bool', privacyClass) }
        }
        if (typeof value === 'number') {
          return { name: `passport.${name}`, canonicalUnit: 'count', value: { kind: 'double', value }, provenance: provenance('count', privacyClass) }
        }
        const structured = typeof value === 'string' ? value : JSON.stringify(value)
        return { name: `passport.${name}`, canonicalUnit: 'text', value: { kind: 'string', value: structured }, provenance: provenance('text', privacyClass) }
      })
    const interval = emptyObservedInterval()
    interval.sourceTickStart = String(capturedAt)
    interval.sourceTickEnd = String(capturedAt)
    const canonicalEvent: CanonicalRaceOpsEvent = {
      eventId: `${operationHash.slice(0, 8)}-${operationHash.slice(8, 12)}-5${operationHash.slice(13, 16)}-a${operationHash.slice(17, 20)}-${operationHash.slice(20, 32)}`,
      eventClass: 'fact',
      eventType,
      sessionRef: passport?.identity.sessionRef ?? '',
      actorRef: 'system:stint-passport',
      subjectRef: passport ? `stint:${passport.identity.stintId}` : '',
      observedInterval: interval,
      facts,
      confidence: emptyConfidence(),
      severity: eventType.includes('failed') ? 'warning' : 'info',
      priority: eventType.includes('closed') ? 'high' : 'normal',
      evidenceRefs: passport?.items.flatMap((item) =>
        passportItemDefinition(item.id).dataClass === dataClass && item.evidence?.contentHash
          ? [item.evidence.contentHash]
          : []
      ) ?? [],
      policyRef: 'local-only.passport.v2',
      capabilityRef: 'passport.main.mutation.v2',
      consentEpoch: this.privacy.identityPersistenceOptIn ? String(this.privacy.updatedAt) : '0',
      approvalRef: this.challenge?.challengeId ?? '',
      correlationId: passport?.identity.stintId ?? '',
      dedupeKey,
      privacyClass: dataClass,
      integrityFlags: this.overflowBlocked ? ['gap', 'derived'] : ['derived'],
      supersedesEventId: '',
      sequence: '0',
      partitionKey: passport ? `stint:${passport.identity.stintId}` : 'passport:none',
      partitionSeq: '0',
      telemetryContext: this.current?.telemetryContext ?? 'unknown',
      sourceTick: String(capturedAt),
      observedMonotonicNs: '0',
      ttlMs: '0'
    }
    return {
      canonicalEvent,
      itemId,
      dataClass,
      capturedAt
    }
  }

  private requireCurrent(stintId: string): StintPassport {
    if (!this.current || this.current.identity.stintId !== stintId) {
      throw new Error('The requested stint is no longer current.')
    }
    return this.current
  }

  private captureReadinessRefreshFence(
    passport: StintPassport,
    event: CanonicalRaceOpsEvent
  ): ReadinessRefreshFence {
    return {
      generation: this.readinessGeneration,
      lifecycleGeneration: this.lifecycleGeneration,
      stintId: passport.identity.stintId,
      lifecycle: passport.lifecycle,
      passportRevision: passport.revision,
      eventSequence: event.sequence
    }
  }

  private readinessRefreshFenceMatches(fence: ReadinessRefreshFence): boolean {
    return (
      this.readinessGeneration === fence.generation &&
      this.lifecycleGeneration === fence.lifecycleGeneration &&
      this.current?.identity.stintId === fence.stintId &&
      this.current.lifecycle === fence.lifecycle &&
      this.current.revision === fence.passportRevision &&
      this.lastEvent?.sequence === fence.eventSequence
    )
  }

  private readinessPublicationMatches(
    fence: ReadinessRefreshFence,
    publishedRevision: number
  ): boolean {
    return (
      this.readinessGeneration === fence.generation &&
      this.lifecycleGeneration === fence.lifecycleGeneration &&
      this.current?.identity.stintId === fence.stintId &&
      this.current.revision === publishedRevision &&
      this.lastEvent?.sequence === fence.eventSequence
    )
  }

  private challengeFenceMatches(fence: ChallengeMutationFence): boolean {
    return (
      this.challengeGeneration === fence.generation &&
      this.lifecycleGeneration === fence.lifecycleGeneration &&
      this.challenge?.challengeId === fence.challengeId &&
      this.challengeClaim?.challengeId === fence.challengeId &&
      this.challengeClaim.generation === fence.generation &&
      this.current?.identity.stintId === fence.stintId &&
      this.current.revision === fence.passportRevision
    )
  }

  private assertChallengeFence(
    fence: ChallengeMutationFence,
    stage: string
  ): StintPassport {
    if (!this.challengeFenceMatches(fence)) {
      throw new Error(`Passport challenge was superseded during ${stage}.`)
    }
    return this.current as StintPassport
  }

  private clearChallenge(demoteReady = true): void {
    this.challengeGeneration += 1
    this.challenge = undefined
    this.challengeNonceHash = undefined
    this.challengeClaim = undefined
    if (demoteReady && this.current?.lifecycle === 'ready') {
      this.current = {
        ...this.current,
        lifecycle: 'awaiting-checklist',
        challengeCompletedAt: undefined,
        challengeOwner: undefined,
        revision: this.current.revision + 1
      }
    }
  }

  private releaseRedactionBarriersFor(sourceTick: string): void {
    for (const dataClass of ['D1', 'D2', 'D3'] as const) {
      const redactedThrough = this.redactedThroughSourceTick[dataClass]
      if (!redactedThrough) continue
      if (!this.sourceTickIsNewer(sourceTick, redactedThrough)) continue
      this.redactedBefore[dataClass] = 0
      delete this.redactedThroughSourceTick[dataClass]
    }
  }

  private sourceTickIsNewer(sourceTick: string, baseline: string): boolean {
    try {
      return BigInt(sourceTick) > BigInt(baseline)
    } catch {
      return sourceTick !== baseline
    }
  }

  private restoreIndependentPrivacyMetadata(
    previous: StintPassport,
    candidate: StintPassport
  ): StintPassport {
    const previousById = new Map(previous.items.map((item) => [item.id, item]))
    const items = candidate.items.map((item): PassportItem => {
      const dataClass = passportItemDefinition(item.id).dataClass
      if (this.redactedThroughSourceTick[dataClass] === undefined) return item
      const prior = previousById.get(item.id)
      if (!prior) return item
      return {
        ...item,
        owner: prior.owner,
        overrideReason: prior.overrideReason,
        reasonCode: prior.reasonCode
      }
    })
    return withCoverage(candidate, items)
  }

  private reconcileReadiness(
    passport: StintPassport,
    forceAwaiting = false
  ): StintPassport {
    const items = expirePassportItems(passport.items.map((item): PassportItem => {
      const dataClass = passportItemDefinition(item.id).dataClass
      const barrier = this.redactedBefore[dataClass]
      const sourceRedactionActive =
        this.redactedThroughSourceTick[dataClass] !== undefined &&
        item.evidence?.source !== 'human-attestation' &&
        item.evidence?.source !== 'challenge-response'
      if (item.evidence && (sourceRedactionActive || item.evidence.capturedAt <= barrier)) {
        return {
          ...item,
          status: 'unknown',
          detail: 'Evidence was deleted and requires a newer observation.',
          evidence: undefined,
          verifiedAt: undefined,
          expiresAt: undefined,
          revision: item.revision + 1
        }
      }
      return item
    }), this.now())
    const covered = withCoverage(passport, items)
    const blocking = items.some((item) => {
      const definition = passportItemDefinition(item.id)
      return definition.critical &&
        (item.status === 'unknown' || item.status === 'mismatch' || item.status === 'expired')
    })
    const durabilityFailed = this.privacy.identityPersistenceOptIn &&
      (covered.durability === 'failed' || covered.durability === 'quarantined')
    if (covered.lifecycle === 'ready' && (forceAwaiting || blocking || durabilityFailed)) {
      this.challengeGeneration += 1
      this.challenge = undefined
      this.challengeNonceHash = undefined
      this.challengeClaim = undefined
      return {
        ...covered,
        lifecycle: 'awaiting-checklist',
        challengeCompletedAt: undefined,
        challengeOwner: undefined,
        revision: covered.revision + 1
      }
    }
    return covered
  }

  private coherentAfterPrivacyRedaction(passport: StintPassport): StintPassport {
    const blocking = passport.items.some((item) => {
      const definition = passportItemDefinition(item.id)
      return definition.critical &&
        (item.status === 'unknown' || item.status === 'mismatch' || item.status === 'expired')
    })
    if (!blocking) return passport
    if (
      passport.lifecycle !== 'ready' &&
      passport.challengeCompletedAt === undefined &&
      passport.challengeOwner === undefined
    ) {
      return passport
    }
    return {
      ...passport,
      lifecycle: passport.lifecycle === 'ready'
        ? 'awaiting-checklist'
        : passport.lifecycle,
      challengeCompletedAt: undefined,
      challengeOwner: undefined,
      revision: passport.revision + 1
    }
  }

  private applyRetentionToMemory(now: number): void {
    const redact = (passport: StintPassport): StintPassport => {
      let changed = false
      const d3Expired = passport.closedAt !== undefined &&
        passport.closedAt < now - this.privacy.retentionDays.D3 * 86_400_000
      const items = passport.items.map((item): PassportItem => {
        const dataClass = passportItemDefinition(item.id).dataClass
        const cutoff = now - this.privacy.retentionDays[dataClass] * 86_400_000
        const evidenceExpired = item.evidence !== undefined &&
          (dataClass === 'D3' ? d3Expired : item.evidence.capturedAt < cutoff)
        const isolatedContentHash = item.evidence
          ? evidenceHash({
              itemId: item.id,
              status: item.status,
              now: item.evidence.capturedAt
            })
          : undefined
        const reasonValues = [item.overrideReason, item.reasonCode]
          .filter((value): value is string => value !== undefined)
        const lowerClassAttestationLeak = d3Expired &&
          dataClass !== 'D3' &&
          item.evidence?.source === 'human-attestation' &&
          (
            item.evidence.contentHash !== isolatedContentHash ||
            reasonValues.includes(item.detail) ||
            reasonValues.includes(item.evidence.summary)
          )
        const d3MetadataPresent = d3Expired && (
          item.owner !== undefined ||
          item.overrideReason !== undefined ||
          item.reasonCode !== undefined ||
          lowerClassAttestationLeak ||
          (dataClass === 'D3' && (
            item.evidence !== undefined ||
            item.verifiedAt !== undefined ||
            item.expiresAt !== undefined ||
            item.detail !== 'Evidence removed by retention policy.'
          ))
        )
        if (!evidenceExpired && !d3MetadataPresent) return item
        changed = true
        return {
          ...item,
          ...(lowerClassAttestationLeak && item.evidence
            ? {
                detail: lowerClassAttestationDetail(item.status),
                evidence: {
                  ...item.evidence,
                  summary: lowerClassAttestationSummary(item.status),
                  contentHash: isolatedContentHash!
                }
              }
            : {}),
          ...(evidenceExpired
            ? {
                status: 'unknown',
                detail: 'Evidence removed by retention policy.',
                evidence: undefined,
                verifiedAt: undefined,
                expiresAt: undefined
              }
            : {}),
          ...(d3Expired
            ? {
                owner: undefined,
                overrideReason: undefined,
                reasonCode: undefined,
                ...(dataClass === 'D3'
                  ? {
                      status: 'unknown',
                      detail: 'Evidence removed by retention policy.',
                      evidence: undefined,
                      verifiedAt: undefined,
                      expiresAt: undefined
                    }
                  : {})
              }
            : {}),
          revision: item.revision + 1
        }
      })
      const d3IdentityPresent = d3Expired && (
        passport.identity.driverLabel !== '[retention-redacted]' ||
        passport.identity.driverRef !== '[retention-redacted]' ||
        passport.identity.teamRef !== undefined ||
        passport.identity.teamLabel !== undefined ||
        passport.challengeOwner !== undefined
      )
      if (!changed && !d3IdentityPresent) return passport
      return this.coherentAfterPrivacyRedaction({
        ...withCoverage(passport, items),
        ...(d3IdentityPresent
          ? {
              identity: {
                ...passport.identity,
                driverRef: '[retention-redacted]',
                driverLabel: '[retention-redacted]',
                teamRef: undefined,
                teamLabel: undefined
              },
              challengeOwner: undefined
            }
          : {}),
        revision: passport.revision + 1
      })
    }
    if (this.current) {
      const previousLifecycle = this.current.lifecycle
      this.current = redact(this.current)
      if (previousLifecycle === 'ready' && this.current.lifecycle !== 'ready') {
        this.clearChallenge(false)
      }
    }
    for (let index = 0; index < this.ephemeralHistory.length; index += 1) {
      this.ephemeralHistory[index] = redact(this.ephemeralHistory[index])
    }
  }

  private invalidateAttestations(reason: string): void {
    if (!this.current) {
      this.clearChallenge()
      return
    }
    const items = this.current.items.map((item): PassportItem =>
      item.status === 'manual-confirmed' ||
      item.status === 'waived-with-reason' ||
      item.status === 'not-applicable'
        ? {
            ...item,
            status: 'unknown',
            owner: undefined,
            detail: `Attestation invalidated: ${reason}.`,
            overrideReason: undefined,
            reasonCode: undefined,
            verifiedAt: undefined,
            expiresAt: undefined,
            evidence: undefined,
            revision: item.revision + 1
          }
        : item
    )
    this.current = {
      ...withCoverage(this.current, items),
      lifecycle: 'awaiting-checklist',
      challengeCompletedAt: undefined,
      challengeOwner: undefined,
      revision: this.current.revision + 1
    }
    this.clearChallenge()
  }

  private async seedDriverRoster(driverRef: string, driverLabel: string): Promise<void> {
    if (this.roster.some((member) => member.memberId === driverRef)) return
    const seed = this.buildRosterCandidate([
      { memberId: driverRef, displayName: driverLabel, roles: ['driver'], active: true }
    ])[0]
    const deletionWasActive = this.deletingPrivacyClasses.has('D3')
    const deletionGeneration = this.privacyClassDeletionGeneration.D3
    const intent = this.createMutationIntent(
      'roster-save',
      [],
      `roster-seed:${randomUUID()}`
    )
    await this.enqueueMutationIntent(intent, async () => {
      if (
        deletionWasActive ||
        deletionGeneration !== this.privacyClassDeletionGeneration.D3
      ) {
        throw new Error('Automatic roster update crossed a privacy deletion.')
      }
      if (this.roster.some((member) => member.memberId === driverRef)) return
      const candidate = this.buildRosterCandidate([
        ...this.roster,
        seed
      ])
      const persisted = await this.commitRosterIntent(intent, candidate, false)
      if (
        this.deletingPrivacyClasses.has('D3') ||
        deletionGeneration !== this.privacyClassDeletionGeneration.D3
      ) {
        throw new Error('Automatic roster update was superseded by privacy deletion.')
      }
      this.publishRoster(persisted, false)
    })
  }

  private assertPrivacyMutationGeneration(generation: number, operation: string): void {
    if (generation !== this.privacyMutationGeneration) {
      throw new Error(`${operation} was superseded by privacy deletion.`)
    }
  }

  private applyInitialAuthoritativeState(state: PassportAuthoritativeState): void {
    this.privacy = {
      ...state.privacy,
      retentionDays: { ...state.privacy.retentionDays }
    }
    this.privacyMutationGeneration = state.privacyMutationGeneration
    this.rosterMutationGeneration = state.rosterMutationGeneration
    this.roster = state.privacy.identityPersistenceOptIn
      ? this.cloneRoster(state.roster)
      : []
    this.current = state.privacy.identityPersistenceOptIn
      ? state.passports.find((passport) =>
          passport.lifecycle !== 'closed' && passport.lifecycle !== 'interrupted'
        ) ?? null
      : null
  }

  private buildPrivacyCandidate(
    privacy: PassportPrivacySettings
  ): PassportPrivacySettings {
    const days = (value: unknown, fallback: number): number =>
      typeof value === 'number' && Number.isFinite(value)
        ? Math.max(1, Math.min(3650, Math.round(value)))
        : fallback
    const candidate: PassportPrivacySettings = {
      identityPersistenceOptIn: privacy?.identityPersistenceOptIn === true,
      retentionDays: {
        D1: days(privacy?.retentionDays?.D1, DEFAULT_PASSPORT_PRIVACY.retentionDays.D1),
        D2: days(privacy?.retentionDays?.D2, DEFAULT_PASSPORT_PRIVACY.retentionDays.D2),
        D3: days(privacy?.retentionDays?.D3, DEFAULT_PASSPORT_PRIVACY.retentionDays.D3)
      },
      updatedAt: this.now()
    }
    Object.freeze(candidate.retentionDays)
    return Object.freeze(candidate)
  }

  private buildRosterCandidate(
    roster: readonly PassportRosterMember[]
  ): readonly PassportRosterMember[] {
    const candidate = roster.map((member) => ({
      memberId: clean(member.memberId, 120),
      displayName: clean(member.displayName, 120),
      roles: [...new Set(member.roles)].filter(isPassportRole),
      active: member.active === true
    }))
    if (
      candidate.some((member) =>
        !member.memberId || !member.displayName || member.roles.length === 0
      )
    ) {
      throw new Error('Every roster member requires an ID, display name, and at least one role.')
    }
    if (new Set(candidate.map((member) => member.memberId)).size !== candidate.length) {
      throw new Error('Roster member IDs must be unique.')
    }
    for (const member of candidate) {
      Object.freeze(member.roles)
      Object.freeze(member)
    }
    return Object.freeze(candidate)
  }

  private cloneRoster(
    roster: readonly PassportRosterMember[]
  ): PassportRosterMember[] {
    return roster.map((member) => ({ ...member, roles: [...member.roles] }))
  }

  private publishRoster(
    roster: readonly PassportRosterMember[],
    invalidateAttestations: boolean
  ): void {
    const changed = rosterStateKey(this.roster) !== rosterStateKey(roster)
    this.roster = this.cloneRoster(roster)
    if (changed && invalidateAttestations) this.invalidateAttestations('roster changed')
  }

  private createMutationIntent(
    kind: ServiceMutationIntent['kind'],
    deletingClasses: readonly PassportDataClass[],
    operationId = `${kind}:${randomUUID()}`
  ): ServiceMutationIntent {
    const intent: ServiceMutationIntent = {
      operationId,
      kind,
      deletingClasses: [...new Set(deletingClasses)]
    }
    for (const dataClass of intent.deletingClasses) {
      this.privacyClassDeletionGeneration[dataClass] += 1
      this.deletingPrivacyClasses.set(
        dataClass,
        (this.deletingPrivacyClasses.get(dataClass) ?? 0) + 1
      )
    }
    return intent
  }

  private enqueueMutationIntent<T>(
    intent: ServiceMutationIntent,
    operation: () => Promise<T>
  ): Promise<T> {
    const rosterIntent =
      intent.kind === 'roster-save' ||
      intent.kind === 'persistence-migration' ||
      (intent.kind === 'privacy-settings' && intent.deletingClasses.length === 0)
    const previous = rosterIntent ? this.rosterIntentQueue : this.mutationIntentQueue
    const run = previous.then(async () => {
      if (!this.supersedePendingMutationWith(intent)) {
        await this.recoverPendingMutation()
      }
      return operation()
    })
    const completed = run.finally(() => {
      for (const dataClass of intent.deletingClasses) {
        const remaining = (this.deletingPrivacyClasses.get(dataClass) ?? 1) - 1
        if (remaining <= 0) this.deletingPrivacyClasses.delete(dataClass)
        else this.deletingPrivacyClasses.set(dataClass, remaining)
      }
    })
    const settled = completed.then(() => undefined, () => undefined)
    if (rosterIntent) this.rosterIntentQueue = settled
    else this.mutationIntentQueue = settled
    return completed
  }

  private supersedePendingMutationWith(intent: ServiceMutationIntent): boolean {
    const pending = this.pendingMutationRecovery
    if (!pending) return false
    const erased = new Set(intent.deletingClasses)
    const repairsEverything = intent.kind === 'persistence-repair'
    const supersedesDeletion =
      intent.kind.startsWith('privacy-delete:') &&
      pending.kind.startsWith('privacy-delete:') &&
      pending.classes.every((dataClass) => erased.has(dataClass))
    const supersedesOptIn =
      pending.kind === 'privacy-settings' &&
      pending.desiredIdentityPersistenceOptIn === true &&
      erased.has('D3') &&
      (intent.kind === 'privacy-settings' || intent.kind === 'privacy-delete:D3')
    if (!repairsEverything && !supersedesDeletion && !supersedesOptIn) {
      return false
    }
    this.pendingMutationRecovery = undefined
    return true
  }

  private async awaitMutationBarrier(
    operation: string,
    allowIncompleteOptIn = false
  ): Promise<void> {
    let observedMutation: Promise<void>
    let observedRoster: Promise<void>
    do {
      observedMutation = this.mutationIntentQueue
      observedRoster = this.rosterIntentQueue
      await Promise.all([observedMutation, observedRoster])
    } while (
      observedMutation !== this.mutationIntentQueue ||
      observedRoster !== this.rosterIntentQueue
    )
    try {
      await this.recoverPendingMutation()
    } catch (error) {
      if (!allowIncompleteOptIn || !this.isIncompleteOptInRecovery()) throw error
    }
    if (allowIncompleteOptIn && this.isIncompleteOptInRecovery()) return
    this.assertNoUnresolvedMutation(operation)
  }

  private isIncompleteOptInRecovery(): boolean {
    return (
      this.pendingMutationRecovery?.kind === 'privacy-settings' ||
      this.pendingMutationRecovery?.kind === 'persistence-migration'
    ) &&
      this.pendingMutationRecovery.classes.length === 0 &&
      this.privacy.identityPersistenceOptIn
  }

  private assertNoUnresolvedMutation(operation = 'Passport operation'): void {
    if (!this.pendingMutationRecovery) return
    throw new Error(
      `${operation} is blocked until Passport mutation ${this.pendingMutationRecovery.operationId} is authoritatively reconciled.`
    )
  }

  private installPendingRecovery(
    intent: ServiceMutationIntent,
    desiredStateKey: string,
    recover: () => Promise<void>,
    desiredIdentityPersistenceOptIn?: boolean
  ): void {
    const existing = this.pendingMutationRecovery
    if (existing && existing.operationId !== intent.operationId) {
      throw new Error(
        `Passport mutation ${existing.operationId} must be reconciled before ${intent.operationId}.`
      )
    }
    this.pendingMutationRecovery = {
      operationId: intent.operationId,
      kind: intent.kind,
      classes: [...intent.deletingClasses],
      desiredStateKey,
      desiredIdentityPersistenceOptIn,
      recover
    }
  }

  private async recoverPendingMutation(): Promise<void> {
    if (this.pendingRecoveryPromise) return this.pendingRecoveryPromise
    const recovery = this.performPendingMutationRecovery()
    this.pendingRecoveryPromise = recovery
    try {
      await recovery
    } finally {
      if (this.pendingRecoveryPromise === recovery) this.pendingRecoveryPromise = null
    }
  }

  private async performPendingMutationRecovery(): Promise<void> {
    const pending = this.pendingMutationRecovery
    if (!pending) return
    try {
      await pending.recover()
      if (this.pendingMutationRecovery === pending) {
        this.pendingMutationRecovery = undefined
      }
    } catch (error) {
      this.recordPersistenceError(error)
      throw new Error(
        `Passport mutation ${pending.operationId} remains unresolved after bounded authoritative recovery: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  private async commitRosterIntent(
    intent: ServiceMutationIntent,
    candidate: readonly PassportRosterMember[],
    invalidateOnRecovery = true
  ): Promise<readonly PassportRosterMember[]> {
    if (!this.privacy.identityPersistenceOptIn) return candidate
    const expectedGeneration = this.rosterMutationGeneration
    const recover = async (): Promise<readonly PassportRosterMember[]> => {
      let state = await this.readAuthoritativeState(intent.operationId)
      this.reconcileAuthoritativeState(state)
      if (
        state.mutation?.kind === 'roster-save' &&
        rosterStateKey(state.roster) === rosterStateKey(candidate)
      ) {
        return state.roster
      }
      if (state.rosterMutationGeneration !== expectedGeneration) {
        this.publishRoster(state.roster, true)
        throw new Error('Roster mutation was superseded by authoritative durable state.')
      }
      try {
        await this.trackStoreOperation(
          this.store.saveRoster(
            candidate as PassportRosterMember[],
            expectedGeneration,
            intent.operationId
          )
        )
      } catch (error) {
        state = await this.readAuthoritativeState(intent.operationId)
        this.reconcileAuthoritativeState(state)
        if (
          state.mutation?.kind !== 'roster-save' ||
          rosterStateKey(state.roster) !== rosterStateKey(candidate)
        ) {
          throw error
        }
      }
      state = await this.readAuthoritativeState(intent.operationId)
      this.reconcileAuthoritativeState(state)
      if (
        state.mutation?.kind !== 'roster-save' ||
        rosterStateKey(state.roster) !== rosterStateKey(candidate)
      ) {
        throw new Error('Roster mutation could not be proven durable.')
      }
      return state.roster
    }

    try {
      const persisted = await this.trackStoreOperation(
        this.store.saveRoster(
          candidate as PassportRosterMember[],
          expectedGeneration,
          intent.operationId
        )
      )
      this.rosterMutationGeneration = expectedGeneration + 1
      return persisted
    } catch (error) {
      if (
        !this.isAmbiguousPersistenceFailure(error) &&
        !/roster mutation generation conflict/i.test(
          error instanceof Error ? error.message : String(error)
        )
      ) {
        throw error
      }
      try {
        return await recover()
      } catch (recoveryError) {
        if (
          recoveryError instanceof Error &&
          /superseded by authoritative durable state/i.test(recoveryError.message)
        ) {
          throw recoveryError
        }
        this.installPendingRecovery(
          intent,
          rosterStateKey(candidate),
          async () => {
            const persisted = await recover()
            this.publishRoster(persisted, invalidateOnRecovery)
          }
        )
        throw recoveryError
      }
    }
  }

  private isAmbiguousPersistenceFailure(error: unknown): boolean {
    if (!(error instanceof Error)) return true
    const code = (error as Error & { code?: string }).code
    if (code === 'PERSISTENCE_DOMAIN_ERROR') return false
    return /worker|process|exited|circuit|deadline|timed out|ipc|transport|storage|disk|unavailable/i
      .test(error.message)
  }

  private async readAuthoritativeState(
    operationId?: string
  ): Promise<PassportAuthoritativeState> {
    return this.trackStoreOperation(this.store.getAuthoritativeState(operationId))
  }

  private reconcileAuthoritativeState(
    state: PassportAuthoritativeState,
    options: {
      reconcileRoster?: boolean
      reconcilePassports?: boolean
      deletedClasses?: readonly PassportDataClass[]
      retainedAt?: number
    } = {}
  ): void {
    const localWasOptedIn = this.privacy.identityPersistenceOptIn
    this.privacy = {
      ...state.privacy,
      retentionDays: { ...state.privacy.retentionDays }
    }
    this.privacyMutationGeneration = state.privacyMutationGeneration
    this.rosterMutationGeneration = state.rosterMutationGeneration
    if (!state.privacy.identityPersistenceOptIn) {
      if (localWasOptedIn || options.deletedClasses?.includes('D3')) {
        this.applyDurableD3Deletion()
      } else if (options.retainedAt !== undefined) {
        this.applyRetentionToMemory(options.retainedAt)
      }
      return
    }
    if (options.reconcileRoster) this.publishRoster(state.roster, true)
    if (options.reconcilePassports) {
      const byId = new Map(
        state.passports.map((passport) => [passport.identity.stintId, passport])
      )
      if (this.current?.persisted) {
        const durable = byId.get(this.current.identity.stintId)
        if (durable) this.current = durable
      }
      for (let index = 0; index < this.ephemeralHistory.length; index += 1) {
        const durable = byId.get(this.ephemeralHistory[index].identity.stintId)
        if (durable) this.ephemeralHistory[index] = durable
      }
    }
    for (const dataClass of options.deletedClasses ?? []) {
      this.applyLocalClassDeletion(dataClass)
    }
    if (options.retainedAt !== undefined) this.applyRetentionToMemory(options.retainedAt)
  }

  private buildPersistenceMigration(
    intent: ServiceMutationIntent
  ): PassportPersistenceMigrationPlan {
    const passport = this.current
      ? JSON.parse(JSON.stringify(this.current)) as StintPassport
      : undefined
    return {
      operationId: intent.operationId,
      roster: this.cloneRoster(this.roster),
      passport,
      event: passport
        ? this.event(
            'ultimate.sim.raceops.passport.persistence-migrated.v1',
            { operationId: intent.operationId },
            'D3',
            undefined,
            passport
          )
        : undefined
    }
  }

  private async executePrivacyIntent(
    intent: ServiceMutationIntent,
    desired: PassportPrivacySettings,
    supersededByDeletion: () => boolean
  ): Promise<PassportPrivacySettings> {
    const initial = await this.readAuthoritativeState(intent.operationId)
    this.reconcileAuthoritativeState(initial)
    const previous = {
      ...this.privacy,
      retentionDays: { ...this.privacy.retentionDays }
    }
    const desiredKey = privacyIntentKey(desired)
    if (privacyIntentKey(previous) === desiredKey) {
      return previous
    }
    const baseGeneration = this.privacyMutationGeneration
    const disabling =
      previous.identityPersistenceOptIn && !desired.identityPersistenceOptIn
    const enabling =
      !previous.identityPersistenceOptIn && desired.identityPersistenceOptIn
    const attemptedGeneration = baseGeneration + (disabling ? 1 : 0)
    const migration = enabling ? this.buildPersistenceMigration(intent) : undefined

    const applyCommitted = async (
      persisted: PassportPrivacySettings,
      state?: PassportAuthoritativeState
    ): Promise<void> => {
      this.privacy = {
        ...persisted,
        retentionDays: { ...persisted.retentionDays }
      }
      this.privacyMutationGeneration = state?.privacyMutationGeneration ??
        attemptedGeneration
      if (!persisted.identityPersistenceOptIn) {
        this.rosterMutationGeneration = state?.rosterMutationGeneration ??
          this.rosterMutationGeneration + 1
        this.applyDurableD3Deletion()
        return
      }
      if (state) this.reconcileAuthoritativeState(state)
      if (migration) {
        await this.resumePersistenceMigration(
          state?.persistenceMigration ?? {
            ...migration,
            rosterComplete: false,
            passportComplete: false
          }
        )
      }
    }

    const recover = async (): Promise<void> => {
      let state = await this.readAuthoritativeState(intent.operationId)
      const committed = state.mutation?.kind === 'privacy-settings' &&
        state.mutation.generation === attemptedGeneration &&
        privacyIntentKey(state.privacy) === desiredKey
      if (committed) {
        await applyCommitted(state.privacy, state)
        return
      }
      if (
        state.privacyMutationGeneration !== baseGeneration ||
        privacyIntentKey(state.privacy) !== privacyIntentKey(previous)
      ) {
        this.reconcileAuthoritativeState(state, {
          reconcileRoster: true,
          reconcilePassports: true
        })
        throw new Error('Privacy intent was superseded by unknown authoritative state.')
      }
      await this.trackStoreOperation(
        this.store.setPrivacy(
          desired,
          attemptedGeneration,
          intent.operationId,
          migration
        )
      )
      if (!desired.identityPersistenceOptIn) await applyCommitted(desired)
      state = await this.readAuthoritativeState(intent.operationId)
      if (
        state.mutation?.kind !== 'privacy-settings' ||
        state.mutation.generation !== attemptedGeneration ||
        privacyIntentKey(state.privacy) !== desiredKey
      ) {
        throw new Error('Privacy intent could not be proven durable.')
      }
      await applyCommitted(state.privacy, state)
    }

    try {
      const persisted = await this.trackStoreOperation(
        this.store.setPrivacy(
          desired,
          attemptedGeneration,
          intent.operationId,
          migration
        )
      )
      await applyCommitted(persisted)
      if (enabling && supersededByDeletion()) {
        throw new Error('Privacy opt-in was superseded by privacy deletion.')
      }
      this.notify()
      return { ...this.privacy, retentionDays: { ...this.privacy.retentionDays } }
    } catch (error) {
      if (!this.isAmbiguousPersistenceFailure(error)) {
        this.recordPersistenceError(error)
        throw error
      }
      if (this.privacy.identityPersistenceOptIn && this.current) {
        this.current = {
          ...this.current,
          persisted: true,
          durability: 'failed',
          lifecycle: this.current.lifecycle === 'ready'
            ? 'awaiting-checklist'
            : this.current.lifecycle,
          challengeCompletedAt: undefined,
          challengeOwner: undefined
        }
        this.clearChallenge(false)
      }
      this.installPendingRecovery(
        intent,
        desiredKey,
        recover,
        desired.identityPersistenceOptIn
      )
      await this.recoverPendingMutation()
      if (enabling && supersededByDeletion()) {
        throw new Error('Privacy opt-in was superseded by privacy deletion.')
      }
      this.notify()
      return { ...this.privacy, retentionDays: { ...this.privacy.retentionDays } }
    }
  }

  private async resumePersistenceMigration(
    initial: PassportPersistenceMigrationState
  ): Promise<void> {
    let migration: PassportPersistenceMigrationState | undefined = initial
    if (!this.privacy.identityPersistenceOptIn) {
      throw new Error('Persistence migration cannot continue while identity persistence is disabled.')
    }

    if (!migration.rosterComplete) {
      let state = await this.readAuthoritativeState(`${migration.operationId}:roster`)
      if (rosterStateKey(state.roster) !== rosterStateKey(migration.roster)) {
        try {
          await this.trackStoreOperation(
            this.store.saveRoster(
              this.cloneRoster(migration.roster),
              state.rosterMutationGeneration,
              `${migration.operationId}:roster`
            )
          )
        } catch (error) {
          state = await this.readAuthoritativeState(`${migration.operationId}:roster`)
          if (rosterStateKey(state.roster) !== rosterStateKey(migration.roster)) {
            throw error
          }
        }
      }
      migration = await this.trackStoreOperation(
        this.store.advancePersistenceMigration(migration.operationId, 'roster')
      )
      this.publishRoster(initial.roster, false)
    }

    if (migration && !migration.passportComplete) {
      if (migration.passport && migration.event) {
        let state = await this.readAuthoritativeState()
        let durable = state.passports.find((passport) =>
          passport.identity.stintId === migration!.passport!.identity.stintId
        )
        const expectedKey = stableJson({
          ...migration.passport,
          persisted: true,
          durability: 'durable'
        })
        if (!durable || stableJson(durable) !== expectedKey) {
          try {
            durable = await this.trackStoreOperation(
              this.store.persistPassport(
                migration.passport,
                migration.event,
                state.privacyMutationGeneration
              )
            )
          } catch (error) {
            state = await this.readAuthoritativeState()
            durable = state.passports.find((passport) =>
              passport.identity.stintId === migration!.passport!.identity.stintId
            )
            if (!durable || stableJson(durable) !== expectedKey) throw error
          }
        }
        if (this.current?.identity.stintId === durable.identity.stintId) {
          this.current = durable
        }
        const historyIndex = this.ephemeralHistory.findIndex((passport) =>
          passport.identity.stintId === durable!.identity.stintId
        )
        if (historyIndex >= 0) this.ephemeralHistory[historyIndex] = durable
      }
      migration = await this.trackStoreOperation(
        this.store.advancePersistenceMigration(migration.operationId, 'passport')
      )
    }

    if (migration) throw new Error('Persistence migration remains incomplete.')
    const state = await this.readAuthoritativeState()
    this.reconcileAuthoritativeState(state, {
      reconcileRoster: true,
      reconcilePassports: true
    })
  }

  private async executeDeleteIntent(
    intent: ServiceMutationIntent,
    dataClass: PassportDataClass
  ): Promise<PassportDeleteResult> {
    const initial = await this.readAuthoritativeState(intent.operationId)
    this.reconcileAuthoritativeState(initial)
    const baseGeneration = initial.privacyMutationGeneration
    const attemptedGeneration = baseGeneration + 1
    const applyCommitted = (
      result: PassportDeleteResult,
      state?: PassportAuthoritativeState
    ): PassportDeleteResult => {
      this.privacyMutationGeneration = state?.privacyMutationGeneration ??
        attemptedGeneration
      if (dataClass === 'D3') {
        if (state) {
          this.privacy = {
            ...state.privacy,
            retentionDays: { ...state.privacy.retentionDays }
          }
          this.rosterMutationGeneration = state.rosterMutationGeneration
        } else {
          this.privacy = {
            ...this.privacy,
            identityPersistenceOptIn: false,
            updatedAt: this.now()
          }
          this.rosterMutationGeneration += 1
        }
        this.applyDurableD3Deletion()
      } else {
        this.applyLocalClassDeletion(dataClass)
        if (state) this.reconcileAuthoritativeState(state, {
          reconcilePassports: true,
          deletedClasses: [dataClass]
        })
      }
      this.lastError = undefined
      this.notify()
      return result
    }
    const recover = async (): Promise<PassportDeleteResult> => {
      let state = await this.readAuthoritativeState(intent.operationId)
      const receipt = state.mutation
      if (
        receipt?.kind === `privacy-delete:${dataClass}` &&
        receipt.generation === attemptedGeneration &&
        receipt.result
      ) {
        return applyCommitted(receipt.result as PassportDeleteResult, state)
      }
      if (state.privacyMutationGeneration !== baseGeneration) {
        this.reconcileAuthoritativeState(state, {
          reconcileRoster: true,
          reconcilePassports: true
        })
        throw new Error('Privacy deletion observed an unknown authoritative generation.')
      }
      const result = await this.trackStoreOperation(
        this.store.deleteByClass(dataClass, attemptedGeneration, intent.operationId)
      )
      applyCommitted(result)
      state = await this.readAuthoritativeState(intent.operationId)
      if (
        state.mutation?.kind !== `privacy-delete:${dataClass}` ||
        state.mutation.generation !== attemptedGeneration ||
        !state.mutation.result
      ) {
        throw new Error('Privacy deletion could not be proven durable.')
      }
      return applyCommitted(state.mutation.result as PassportDeleteResult, state)
    }

    let commitConfirmed = false
    try {
      const result = await this.trackStoreOperation(
        this.store.deleteByClass(dataClass, attemptedGeneration, intent.operationId)
      )
      commitConfirmed = true
      applyCommitted(result)
      const state = await this.readAuthoritativeState(intent.operationId)
      if (
        state.mutation?.kind !== `privacy-delete:${dataClass}` ||
        state.mutation.generation !== attemptedGeneration ||
        !state.mutation.result
      ) {
        throw new Error('Privacy deletion could not be proven durable.')
      }
      return applyCommitted(state.mutation.result as PassportDeleteResult, state)
    } catch (error) {
      if (commitConfirmed) {
        this.recordPersistenceError(error)
        throw error
      }
      if (!this.isAmbiguousPersistenceFailure(error)) {
        this.recordPersistenceError(error)
        throw error
      }
      this.installPendingRecovery(
        intent,
        `${dataClass}:${attemptedGeneration}`,
        async () => { await recover() }
      )
      await this.recoverPendingMutation()
      const state = await this.readAuthoritativeState(intent.operationId)
      if (!state.mutation?.result) {
        throw new Error('Privacy deletion receipt is unavailable after recovery.')
      }
      return state.mutation.result as PassportDeleteResult
    }
  }

  private async executeRetentionIntent(
    intent: ServiceMutationIntent,
    retainedAt: number,
    _reason: string
  ): Promise<PassportDeleteResult[]> {
    const initial = await this.readAuthoritativeState(intent.operationId)
    this.reconcileAuthoritativeState(initial)
    const baseGeneration = initial.privacyMutationGeneration
    const attemptedGeneration = baseGeneration + 1
    const applyCommitted = (
      results: PassportDeleteResult[],
      state?: PassportAuthoritativeState
    ): PassportDeleteResult[] => {
      this.privacyMutationGeneration = state?.privacyMutationGeneration ??
        attemptedGeneration
      for (const result of results) {
        const cutoff = retainedAt -
          this.privacy.retentionDays[result.dataClass] * 86_400_000
        this.redactedBefore[result.dataClass] = Math.max(
          this.redactedBefore[result.dataClass],
          cutoff
        )
      }
      if (state) {
        this.reconcileAuthoritativeState(state, {
          reconcileRoster: true,
          reconcilePassports: true,
          retainedAt
        })
      } else {
        this.applyRetentionToMemory(retainedAt)
      }
      this.lastError = undefined
      this.notify()
      return results
    }
    const recover = async (): Promise<PassportDeleteResult[]> => {
      let state = await this.readAuthoritativeState(intent.operationId)
      const receipt = state.mutation
      const receiptResult = receipt?.result as PassportRetentionReceiptResult | undefined
      if (
        receipt?.kind === 'privacy-retention' &&
        receipt.generation === attemptedGeneration &&
        receiptResult?.retainedAt === retainedAt
      ) {
        return applyCommitted(receiptResult.results, state)
      }
      if (state.privacyMutationGeneration !== baseGeneration) {
        this.reconcileAuthoritativeState(state, {
          reconcileRoster: true,
          reconcilePassports: true
        })
        throw new Error('Retention mutation observed an unknown authoritative generation.')
      }
      const results = await this.trackStoreOperation(
        this.store.purgeRetention(
          retainedAt,
          intent.operationId,
          attemptedGeneration
        )
      )
      applyCommitted(results)
      state = await this.readAuthoritativeState(intent.operationId)
      const committed = state.mutation?.result as PassportRetentionReceiptResult | undefined
      if (
        state.mutation?.kind !== 'privacy-retention' ||
        state.mutation.generation !== attemptedGeneration ||
        committed?.retainedAt !== retainedAt
      ) {
        throw new Error('Retention mutation could not be proven durable.')
      }
      return applyCommitted(committed.results, state)
    }

    try {
      const results = await this.trackStoreOperation(
        this.store.purgeRetention(
          retainedAt,
          intent.operationId,
          attemptedGeneration
        )
      )
      applyCommitted(results)
      const state = await this.readAuthoritativeState(intent.operationId)
      const committed = state.mutation?.result as PassportRetentionReceiptResult | undefined
      if (
        state.mutation?.kind !== 'privacy-retention' ||
        state.mutation.generation !== attemptedGeneration ||
        committed?.retainedAt !== retainedAt
      ) {
        throw new Error('Retention mutation could not be proven durable.')
      }
      return applyCommitted(committed.results, state)
    } catch (error) {
      if (!this.isAmbiguousPersistenceFailure(error)) {
        this.recordPersistenceError(error)
        throw error
      }
      this.installPendingRecovery(
        intent,
        `retention:${retainedAt}:${attemptedGeneration}`,
        async () => { await recover() }
      )
      await this.recoverPendingMutation()
      const state = await this.readAuthoritativeState(intent.operationId)
      const result = state.mutation?.result as PassportRetentionReceiptResult | undefined
      return result?.results ?? []
    }
  }

  private async executeRepairIntent(
    intent: ServiceMutationIntent,
    token: string
  ): Promise<{ quarantinedPath: string }> {
    const applyCommitted = (): void => {
      this.config = { ...DEFAULT_PASSPORT_CONFIG }
      this.privacy = {
        ...DEFAULT_PASSPORT_PRIVACY,
        retentionDays: { ...DEFAULT_PASSPORT_PRIVACY.retentionDays }
      }
      this.privacyMutationGeneration = 0
      this.rosterMutationGeneration = 0
      this.roster = []
      this.current = null
      this.ephemeralHistory.length = 0
      this.lastEvent = null
      this.ambiguousMutations.clear()
      this.lifecycleGeneration += 1
      this.readinessGeneration += 1
      this.clearChallenge(false)
      for (const dataClass of ['D1', 'D2', 'D3'] as const) {
        this.redactedBefore[dataClass] = this.now()
        delete this.redactedThroughSourceTick[dataClass]
      }
      this.lastError = undefined
      this.notify()
    }
    const recover = async (): Promise<{ quarantinedPath: string }> => {
      const result = await this.trackStoreOperation(
        this.store.repairPersistence(token, intent.operationId)
      )
      applyCommitted()
      const state = await this.readAuthoritativeState()
      if (
        state.privacy.identityPersistenceOptIn ||
        state.roster.length > 0 ||
        state.passports.length > 0 ||
        state.persistenceMigration
      ) {
        throw new Error('Persistence repair did not produce an authoritative empty database.')
      }
      return result
    }
    try {
      const result = await this.trackStoreOperation(
        this.store.repairPersistence(token, intent.operationId)
      )
      applyCommitted()
      return result
    } catch (error) {
      if (!this.isAmbiguousPersistenceFailure(error)) {
        this.recordPersistenceError(error)
        throw error
      }
      let recovered: { quarantinedPath: string } | undefined
      this.installPendingRecovery(
        intent,
        `repair:${intent.operationId}`,
        async () => { recovered = await recover() }
      )
      await this.recoverPendingMutation()
      if (!recovered) throw new Error('Persistence repair recovery did not return a receipt.')
      return recovered
    }
  }

  private trackStoreOperation<T>(operation: Promise<T>): Promise<T> {
    let tracked: Promise<T>
    tracked = operation.finally(() => {
      this.pendingStoreOperations.delete(tracked)
    })
    this.pendingStoreOperations.add(tracked)
    return tracked
  }

  private async drainStoreOperations(): Promise<void> {
    while (this.pendingStoreOperations.size > 0) {
      await Promise.allSettled([...this.pendingStoreOperations])
    }
  }

  private recordPersistenceError(error: unknown): void {
    this.lastError = clean(error instanceof Error ? error.message : String(error), 500) ||
      'Passport persistence operation failed.'
  }

  private notify(): void {
    const now = this.now()
    if (now - this.lastBroadcastAt >= BROADCAST_THROTTLE_MS) {
      this.lastBroadcastAt = now
      this.ctx.broadcast('stintPassport:updated', { at: now })
      return
    }
    if (this.broadcastScheduled) return
    this.broadcastScheduled = true
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null
      this.broadcastScheduled = false
      this.lastBroadcastAt = this.now()
      this.ctx.broadcast('stintPassport:updated', { at: this.lastBroadcastAt })
    }, BROADCAST_THROTTLE_MS)
  }
}
