import { createHash, randomUUID } from 'node:crypto'
import {
  DEFAULT_PASSPORT_TAP_BUDGETS,
  type Phase02TapDelivery,
  type Phase02TapSubscription
} from '../../shared/phase02-tap'
import {
  PASSPORT_ITEM_DEFINITIONS,
  STINT_PASSPORT_CONTRACT_VERSION,
  calculatePassportCoverage,
  isPassportRole,
  passportItemDefinition,
  type PassportChallengeInput,
  type PassportConfig,
  type PassportDataClass,
  type PassportDeleteResult,
  type PassportExportProfile,
  type PassportFullAuditResult,
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
  type CanonicalRaceOpsEvent
} from '../../shared/phase02-contracts'
import type { ModuleContext } from '../module-context'
import {
  evaluatePassportItems,
  expirePassportItems,
  validateChallengeReadiness,
  withCoverage
} from './evaluator'
import { inspectPassportReadiness } from './readiness'
import {
  PassportStore,
  type PassportExportPackage,
  type PassportStoreEvent
} from './store'

const SUBSCRIPTION_ID = 'stint-passport'
const OVERFLOW_RECOVERY_FRAMES = 3
const HISTORY_LIMIT = 50
const BROADCAST_THROTTLE_MS = 250

function clean(value: unknown, max = 160): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, max)
    : ''
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
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
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
    }))
  })
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

  constructor(
    private readonly ctx: ModuleContext,
    private readonly store: PassportStore,
    private readonly now: () => number = Date.now
  ) {
    this.config = store.getConfig()
    this.privacy = store.getPrivacy()
    this.roster = this.privacy.identityPersistenceOptIn ? store.listRoster() : []
    this.current = this.privacy.identityPersistenceOptIn
      ? store.listPassports(10).find((passport) =>
          passport.lifecycle === 'awaiting-checklist' || passport.lifecycle === 'ready'
        ) ?? null
      : null
    this.subscription = ctx.phase02Tap.subscribe(
      SUBSCRIPTION_ID,
      DEFAULT_PASSPORT_TAP_BUDGETS,
      (delivery) => this.consume(delivery)
    )
    this.subscription.setKillSwitch(store.getKillSwitch())
    if (this.current) this.closeCurrentInternal('restart-recovery', true)
    store.purgeRetention(this.now())
  }

  dispose(): void {
    if (this.current) this.closeCurrentInternal('disconnect', true)
    this.subscription.dispose()
    if (this.broadcastTimer) clearTimeout(this.broadcastTimer)
    this.broadcastTimer = null
  }

  async snapshot(): Promise<PassportSnapshot> {
    if (this.current && this.lastEvent && this.current.telemetryContext === 'live') {
      await this.refreshExternal('snapshot')
    }
    const persisted = this.privacy.identityPersistenceOptIn
      ? this.store.listPassports(HISTORY_LIMIT)
      : []
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
        queue: this.subscription.status(),
        overflowBlocked: this.overflowBlocked,
        cleanFramesSinceOverflow: this.cleanFramesSinceOverflow,
        lastError: this.lastError
      },
      integrity: this.store.getIntegrity()
    }
  }

  async setRoster(roster: readonly PassportRosterMember[]): Promise<PassportRosterMember[]> {
    this.roster = roster.map((member) => ({
      memberId: clean(member.memberId, 120),
      displayName: clean(member.displayName, 120),
      roles: [...new Set(member.roles)].filter(isPassportRole),
      active: member.active === true
    }))
    if (this.roster.some((member) => !member.memberId || !member.displayName || member.roles.length === 0)) {
      throw new Error('Every roster member requires an ID, display name, and at least one role.')
    }
    if (new Set(this.roster.map((member) => member.memberId)).size !== this.roster.length) {
      throw new Error('Roster member IDs must be unique.')
    }
    if (this.privacy.identityPersistenceOptIn) this.roster = this.store.saveRoster(this.roster)
    if (this.current && this.lastEvent) {
      await this.revalidateCurrent(undefined, 'roster-updated')
    }
    this.notify()
    return [...this.roster]
  }

  async setConfig(config: PassportConfig): Promise<PassportConfig> {
    this.config = this.store.setConfig(config)
    if (this.current && this.lastEvent) await this.refreshExternal('config-updated')
    this.notify()
    return this.config
  }

  async setPrivacy(privacy: PassportPrivacySettings): Promise<PassportPrivacySettings> {
    const wasEnabled = this.privacy.identityPersistenceOptIn
    this.privacy = this.store.setPrivacy(privacy)
    if (!wasEnabled && this.privacy.identityPersistenceOptIn) {
      if (this.roster.length > 0) this.store.saveRoster(this.roster)
      if (this.current) {
        this.current = this.store.persistPassport(
          { ...this.current, persisted: true },
          this.event('ultimate.sim.raceops.passport.persistence-enabled.v1', {
            identityPersistenceOptIn: true
          }, 'D3')
        )
      }
    } else if (wasEnabled && !this.privacy.identityPersistenceOptIn) {
      this.current = this.current ? { ...this.current, persisted: false } : null
      this.ephemeralHistory.length = 0
    }
    this.notify()
    return this.privacy
  }

  async resolveItem(input: PassportItemResolutionInput): Promise<StintPassport> {
    const current = this.requireCurrent(input.stintId)
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
    const reason = clean(input.reason, 500)
    if ((input.status === 'waived-with-reason' || input.status === 'not-applicable') && !reason) {
      throw new Error('A reason is required for waived or not-applicable items.')
    }
    const definition = passportItemDefinition(input.itemId)
    const now = this.now()
    const items = current.items.map((item): PassportItem =>
      item.id === input.itemId
        ? {
            ...item,
            status: input.status,
            owner: input.owner,
            detail: input.status === 'manual-confirmed'
              ? 'Manually confirmed by the assigned roster owner.'
              : reason,
            overrideReason: reason || undefined,
            verifiedAt: now,
            expiresAt: now + definition.ttlMs,
            evidence: {
              source: 'human-attestation',
              summary: reason || `Confirmed by ${input.owner.memberId}/${input.owner.role}.`,
              contentHash: evidenceHash({
                itemId: input.itemId,
                status: input.status,
                owner: input.owner,
                reason,
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
    this.persistCurrent(this.event(
      'ultimate.sim.raceops.passport.item-resolved.v1',
      { itemId: input.itemId, status: input.status, owner: input.owner, reason },
      definition.dataClass,
      input.itemId
    ))
    this.notify()
    return this.current
  }

  async completeChallenge(input: PassportChallengeInput): Promise<StintPassport> {
    let current = this.requireCurrent(input.stintId)
    if (this.subscription.status().killSwitch) throw new Error('Passport tap kill switch is active.')
    if (this.overflowBlocked) throw new Error('Passport source overflow must recover before challenge completion.')
    if (!ownerIsValid(input.owner, this.roster, 'final-acknowledgement')) {
      throw new Error('Challenge owner must be an active driver or team manager.')
    }
    await this.refreshExternal('challenge-revalidation')
    current = this.requireCurrent(input.stintId)
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
      const integrity = this.store.verifyActiveStint(current.identity.stintId)
      if (integrity.state !== 'unanchored') {
        throw new Error(integrity.message ?? 'Active stint integrity verification failed.')
      }
    }
    this.current = {
      ...current,
      lifecycle: 'ready',
      challengeCompletedAt: now,
      challengeOwner: input.owner
    }
    this.persistCurrent(this.event(
      'ultimate.sim.raceops.passport.challenge-completed.v1',
      {
        coverage: this.current.coverage,
        owner: input.owner,
        itemHashes: this.current.items.map((item) => item.evidence?.contentHash ?? '')
      },
      'D3'
    ))
    this.notify()
    return this.current
  }

  closeCurrent(reason: NonNullable<StintPassport['closeReason']> = 'manual'): StintPassport | null {
    return this.closeCurrentInternal(reason, reason === 'disconnect' || reason === 'replay-boundary')
  }

  setKillSwitch(enabled: boolean): boolean {
    this.store.setKillSwitch(enabled)
    this.subscription.setKillSwitch(enabled)
    if (enabled) {
      this.lastError = 'Passport tap kill switch is active.'
      this.store.logRuntime('kill-switch', { enabled: true })
    }
    this.notify()
    return enabled
  }

  exportPackage(profile: PassportExportProfile): PassportExportPackage {
    return this.store.exportPackage(profile, this.current, this.ephemeralHistory, this.roster)
  }

  deleteByClass(dataClass: PassportDataClass): PassportDeleteResult {
    if (dataClass === 'D3') {
      if (this.current) this.closeCurrentInternal('manual', false)
      const result = this.store.deleteByClass('D3')
      this.privacy = this.store.setPrivacy({
        ...this.privacy,
        identityPersistenceOptIn: false,
        updatedAt: this.now()
      })
      this.roster = []
      this.ephemeralHistory.length = 0
      this.notify()
      return result
    }
    const result = this.store.deleteByClass(dataClass)
    this.notify()
    return result
  }

  async runFullAudit(): Promise<PassportFullAuditResult> {
    const started = this.now()
    const integrity = await this.store.runFullAudit()
    const result = { integrity, durationMs: Math.max(0, this.now() - started) }
    this.notify()
    return result
  }

  private async consume(delivery: Phase02TapDelivery): Promise<void> {
    const event = delivery.event
    this.lastEvent = event
    if (event.integrityFlags.includes('gap')) {
      this.overflowBlocked = true
      this.cleanFramesSinceOverflow = 0
      this.lastError = 'Phase 02 tap overflow detected; Passport challenge is blocked until clean frames recover.'
      this.store.logRuntime('tap-overflow', {
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
        this.closeCurrentInternal(
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
      this.current = {
        contractVersion: STINT_PASSPORT_CONTRACT_VERSION,
        identity,
        lifecycle: 'awaiting-checklist',
        telemetryContext: 'live',
        items: emptyItems(),
        coverage: 0,
        applicableItems: PASSPORT_ITEM_DEFINITIONS.length,
        coveredItems: 0,
        interrupted: false,
        persisted: false
      }
      this.seedDriverRoster(identity.driverRef, identity.driverLabel)
      this.current = withCoverage(this.current, evaluatePassportItems({
        passport: this.current,
        event,
        roster: this.roster,
        config: this.config,
        now: this.now()
      }))
      this.persistCurrent(this.event(
        'ultimate.sim.raceops.passport.stint-started.v1',
        { sessionRef: identity.sessionRef, trackRef: identity.trackRef, carRef: identity.carRef },
        'D3'
      ))
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
      this.closeCurrentInternal(reason, false)
      await this.consume(delivery)
      return
    }
    const before = passportStateKey(this.current)
    this.current = withCoverage(this.current, evaluatePassportItems({
      passport: this.current,
      event,
      roster: this.roster,
      config: this.config,
      now: this.now()
    }))
    if (passportStateKey(this.current) !== before) {
      this.persistCurrent(this.event(
        'ultimate.sim.raceops.passport.telemetry-revalidated.v1',
        {
          sequence: event.sequence,
          statuses: this.current.items.map((item) => [item.id, item.status])
        },
        'D2'
      ))
      this.notify()
    }
  }

  private async refreshExternal(reason: string): Promise<void> {
    const run = this.refreshQueue.catch(() => undefined).then(() =>
      this.refreshExternalNow(reason)
    )
    this.refreshQueue = run.catch(() => undefined)
    await run
  }

  private async refreshExternalNow(reason: string): Promise<void> {
    if (!this.current || !this.lastEvent) return
    const before = passportStateKey(this.current)
    const external = await inspectPassportReadiness(this.ctx, this.lastEvent, this.config)
    this.current = withCoverage(this.current, evaluatePassportItems({
      passport: this.current,
      event: this.lastEvent,
      roster: this.roster,
      config: this.config,
      external,
      now: this.now()
    }))
    if (passportStateKey(this.current) !== before) {
      this.persistCurrent(this.event(
        'ultimate.sim.raceops.passport.external-revalidated.v1',
        {
          reason,
          statuses: this.current.items.map((item) => [item.id, item.status])
        },
        'D2'
      ))
    }
  }

  private async revalidateCurrent(
    _external: undefined,
    reason: string
  ): Promise<void> {
    if (!this.current || !this.lastEvent) return
    this.current = withCoverage(this.current, evaluatePassportItems({
      passport: this.current,
      event: this.lastEvent,
      roster: this.roster,
      config: this.config,
      now: this.now()
    }))
    await this.refreshExternal(reason)
    this.persistCurrent(this.event(
      'ultimate.sim.raceops.passport.roster-revalidated.v1',
      { reason, coverage: this.current.coverage },
      'D3'
    ))
  }

  private closeCurrentInternal(
    reason: NonNullable<StintPassport['closeReason']>,
    interrupted: boolean
  ): StintPassport | null {
    if (!this.current) return null
    const closed: StintPassport = {
      ...this.current,
      lifecycle: interrupted ? 'interrupted' : 'closed',
      closedAt: this.now(),
      closeReason: reason,
      interrupted
    }
    this.current = closed
    this.persistCurrent(this.event(
      'ultimate.sim.raceops.passport.stint-closed.v1',
      { reason, interrupted, coverage: closed.coverage },
      'D3'
    ))
    this.ephemeralHistory.unshift(closed)
    this.ephemeralHistory.splice(HISTORY_LIMIT)
    this.current = null
    return closed
  }

  private persistCurrent(event: PassportStoreEvent): void {
    if (!this.current || !this.privacy.identityPersistenceOptIn) {
      if (this.current) this.current = { ...this.current, persisted: false }
      return
    }
    try {
      this.current = this.store.persistPassport({ ...this.current, persisted: true }, event)
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
    }
  }

  private event(
    eventType: string,
    payload: Record<string, unknown>,
    dataClass: PassportDataClass,
    itemId?: PassportItem['id']
  ): PassportStoreEvent {
    return {
      eventType,
      itemId,
      payload,
      dataClass,
      dedupeKey: `${this.current?.identity.stintId ?? 'none'}:${eventType}:${randomUUID()}`
    }
  }

  private requireCurrent(stintId: string): StintPassport {
    if (!this.current || this.current.identity.stintId !== stintId) {
      throw new Error('The requested stint is no longer current.')
    }
    return this.current
  }

  private seedDriverRoster(driverRef: string, driverLabel: string): void {
    if (this.roster.some((member) => member.memberId === driverRef)) return
    this.roster = [
      ...this.roster,
      { memberId: driverRef, displayName: driverLabel, roles: ['driver'], active: true }
    ]
    if (this.privacy.identityPersistenceOptIn) this.store.saveRoster(this.roster)
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
