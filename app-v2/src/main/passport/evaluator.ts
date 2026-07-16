import { createHash } from 'node:crypto'
import {
  PASSPORT_ITEM_DEFINITIONS,
  calculatePassportCoverage,
  passportItemDefinition,
  type PassportConfig,
  type PassportItem,
  type PassportItemEvidence,
  type PassportItemId,
  type PassportItemStatus,
  type PassportOwner,
  type PassportRosterMember,
  type StintPassport
} from '../../shared/stint-passport'
import {
  canonicalFactValue,
  canonicalFactsByName,
  type CanonicalFact,
  type CanonicalRaceOpsEvent
} from '../../shared/phase02-contracts'

export interface PassportExternalReadiness {
  raceProfile: {
    profileId: string
    exists: boolean
    matchesCar: boolean
    matchesTrack: boolean
    buttonboxProfile?: string
  }
  buttonboxProfile: {
    profileName: string
    exists: boolean
    controlIds: string[]
  }
  devices: Array<{ id: string; connected: boolean; label: string }>
  audio: {
    configFound: boolean
    enabled: boolean
    muted: boolean
    outputDeviceId: string
    enabledCallouts: string[]
  }
}

export interface EvaluatePassportInput {
  passport: StintPassport
  event: CanonicalRaceOpsEvent
  roster: PassportRosterMember[]
  config: PassportConfig
  external?: PassportExternalReadiness
  now: number
}

interface ItemEvaluation {
  status: PassportItemStatus
  detail: string
  evidence?: Record<string, unknown>
  source: string
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
    .join(',')}}`
}

function hash(value: unknown): string {
  return createHash('sha256').update(stable(value), 'utf8').digest('hex')
}

function factText(fact: CanonicalFact | undefined): string | undefined {
  const value = canonicalFactValue(fact)
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function factNumber(fact: CanonicalFact | undefined): number | undefined {
  const value = canonicalFactValue(fact)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value && Number.isFinite(Number(value))) return Number(value)
  return undefined
}

function factBoolean(fact: CanonicalFact | undefined): boolean | undefined {
  const value = canonicalFactValue(fact)
  return typeof value === 'boolean' ? value : undefined
}

function evidence(
  source: string,
  summary: string,
  content: Record<string, unknown>,
  now: number
): PassportItemEvidence {
  return {
    source,
    summary,
    contentHash: hash(content),
    capturedAt: now,
    state: 'available'
  }
}

function validManual(item: PassportItem, now: number): boolean {
  return (
    item.status === 'manual-confirmed' ||
    item.status === 'waived-with-reason' ||
    item.status === 'not-applicable'
  ) && (item.expiresAt === undefined || item.expiresAt > now)
}

function ownerFor(
  itemId: PassportItemId,
  current: PassportOwner | undefined,
  roster: PassportRosterMember[]
): PassportOwner | undefined {
  const definition = passportItemDefinition(itemId)
  if (current) {
    const member = roster.find((candidate) => candidate.memberId === current.memberId && candidate.active)
    if (member?.roles.includes(current.role) && definition.allowedRoles.includes(current.role)) return current
  }
  for (const member of roster) {
    if (!member.active) continue
    const role = member.roles.find((candidate) => definition.allowedRoles.includes(candidate))
    if (role) return { memberId: member.memberId, role }
  }
  return undefined
}

function evaluateTelemetryItem(
  id: PassportItemId,
  facts: ReadonlyMap<string, CanonicalFact>,
  roster: PassportRosterMember[],
  config: PassportConfig
): ItemEvaluation {
  const sessionRef = factText(facts.get('session.identity'))
  const connected = factBoolean(facts.get('telemetry.connected'))
  const driverRef = factText(facts.get('driver.ref'))
  const driverName = factText(facts.get('driver.name'))
  const carRef = factText(facts.get('car.ref'))
  const trackRef = factText(facts.get('session.track_ref'))
  const fuelLiters = factNumber(facts.get('fuel.liters'))
  const fuelPerLap = factNumber(facts.get('fuel.per_lap'))
  const raining = factBoolean(facts.get('weather.raining'))
  const wetness = factNumber(facts.get('weather.wetness'))

  switch (id) {
    case 'session-identity': {
      const ok = connected === true && Boolean(sessionRef)
      return {
        status: ok ? 'verified' : 'unknown',
        detail: ok ? 'Live session identity is current.' : 'Live session identity is unavailable.',
        source: 'phase02.tap',
        evidence: { connected, sessionRef }
      }
    }
    case 'incoming-driver': {
      const member = roster.find((candidate) =>
        candidate.active &&
        candidate.roles.includes('driver') &&
        (
          candidate.memberId === driverRef ||
          candidate.displayName.toLocaleLowerCase() === driverName?.toLocaleLowerCase()
        )
      )
      return {
        status: driverRef && driverName && member ? 'verified' : driverRef && driverName ? 'mismatch' : 'unknown',
        detail: member
          ? `Telemetry driver matches roster member ${member.displayName}.`
          : driverRef && driverName
            ? 'Telemetry driver is not bound to an active roster driver.'
            : 'Driver identity is unavailable.',
        source: 'phase02.tap+roster',
        evidence: { driverRef, driverName, rosterMemberId: member?.memberId }
      }
    }
    case 'car-track': {
      const ok = Boolean(carRef && trackRef)
      return {
        status: ok ? 'verified' : 'unknown',
        detail: ok ? 'Car and track references are current.' : 'Car or track identity is unavailable.',
        source: 'phase02.tap',
        evidence: { carRef, trackRef }
      }
    }
    case 'fuel-load': {
      if (fuelLiters === undefined) {
        return { status: 'unknown', detail: 'Fuel level is unavailable.', source: 'phase02.tap' }
      }
      if (config.minimumFuelLiters <= 0) {
        return {
          status: 'unknown',
          detail: 'A specific minimum fuel load has not been configured.',
          source: 'passport.config',
          evidence: { fuelLiters }
        }
      }
      const ok = fuelLiters >= config.minimumFuelLiters
      return {
        status: ok ? 'verified' : 'mismatch',
        detail: ok
          ? `${fuelLiters.toFixed(1)} L meets the ${config.minimumFuelLiters.toFixed(1)} L minimum.`
          : `${fuelLiters.toFixed(1)} L is below the ${config.minimumFuelLiters.toFixed(1)} L minimum.`,
        source: 'phase02.tap+passport.config',
        evidence: { fuelLiters, minimumFuelLiters: config.minimumFuelLiters }
      }
    }
    case 'stint-target': {
      if (fuelLiters === undefined || fuelPerLap === undefined || fuelPerLap <= 0) {
        return { status: 'unknown', detail: 'Fuel-per-lap evidence is unavailable.', source: 'phase02.tap' }
      }
      if (config.targetStintLaps <= 0) {
        return {
          status: 'unknown',
          detail: 'A specific target stint length has not been configured.',
          source: 'passport.config'
        }
      }
      const availableLaps = fuelLiters / fuelPerLap
      const ok = availableLaps >= config.targetStintLaps
      return {
        status: ok ? 'verified' : 'mismatch',
        detail: ok
          ? `${availableLaps.toFixed(1)} fuel laps cover the ${config.targetStintLaps} lap target.`
          : `${availableLaps.toFixed(1)} fuel laps do not cover the ${config.targetStintLaps} lap target.`,
        source: 'phase02.tap+passport.config',
        evidence: { fuelLiters, fuelPerLap, availableLaps, targetStintLaps: config.targetStintLaps }
      }
    }
    case 'weather-assumption': {
      if (config.weatherAssumption === 'any') {
        return {
          status: 'verified',
          detail: 'Weather assumption accepts dry or wet conditions.',
          source: 'passport.config',
          evidence: { assumption: 'any', raining, wetness }
        }
      }
      if (raining === undefined && wetness === undefined) {
        return { status: 'unknown', detail: 'Weather evidence is unavailable.', source: 'phase02.tap' }
      }
      const wet = raining === true || (wetness ?? 0) > 0.05
      const ok = config.weatherAssumption === 'wet' ? wet : !wet
      return {
        status: ok ? 'verified' : 'mismatch',
        detail: ok
          ? `Observed conditions match the ${config.weatherAssumption} assumption.`
          : `Observed conditions contradict the ${config.weatherAssumption} assumption.`,
        source: 'phase02.tap+passport.config',
        evidence: { assumption: config.weatherAssumption, raining, wetness }
      }
    }
    case 'final-acknowledgement':
      return {
        status: 'unknown',
        detail: 'Final driver/team-manager acknowledgement is required.',
        source: 'manual'
      }
    default:
      return {
        status: 'unknown',
        detail: 'External readiness has not been evaluated.',
        source: 'passport.external'
      }
  }
}

function evaluateExternalItem(
  id: PassportItemId,
  external: PassportExternalReadiness | undefined,
  config: PassportConfig
): ItemEvaluation {
  if (!external) {
    return { status: 'unknown', detail: 'External readiness has not been refreshed.', source: 'passport.external' }
  }
  switch (id) {
    case 'race-profile': {
      const expected = config.expectedRaceProfileId
      if (!expected) return { status: 'unknown', detail: 'No specific race profile is selected.', source: 'passport.config' }
      const profile = external.raceProfile
      const ok = profile.profileId === expected && profile.exists && profile.matchesCar && profile.matchesTrack
      return {
        status: ok ? 'verified' : 'mismatch',
        detail: ok
          ? `Race profile ${expected} exists and matches the live car and track.`
          : `Race profile ${expected} is missing or does not match the live car and track.`,
        source: 'race-profile-store',
        evidence: profile
      }
    }
    case 'buttonbox-profile': {
      const expected = config.expectedButtonboxProfile
      if (!expected) return { status: 'unknown', detail: 'No specific ButtonBox profile is selected.', source: 'passport.config' }
      const profile = external.buttonboxProfile
      const linked = external.raceProfile.buttonboxProfile
      const ok = profile.exists && profile.profileName === expected && (!linked || linked === expected)
      return {
        status: ok ? 'verified' : 'mismatch',
        detail: ok
          ? `ButtonBox profile ${expected} exists and matches the selected race profile.`
          : `ButtonBox profile ${expected} is missing or conflicts with the selected race profile.`,
        source: 'buttonbox-profile-store',
        evidence: { ...profile, linkedProfile: linked }
      }
    }
    case 'required-devices': {
      if (config.requiredDeviceIds.length === 0) {
        return { status: 'unknown', detail: 'No specific required device IDs are configured.', source: 'passport.config' }
      }
      const missing = config.requiredDeviceIds.filter((idValue) =>
        !external.devices.some((device) => device.id === idValue && device.connected)
      )
      return {
        status: missing.length === 0 ? 'verified' : 'mismatch',
        detail: missing.length === 0
          ? `Required devices connected: ${config.requiredDeviceIds.join(', ')}.`
          : `Required devices not connected: ${missing.join(', ')}.`,
        source: 'serial-hub',
        evidence: { requiredDeviceIds: config.requiredDeviceIds, devices: external.devices }
      }
    }
    case 'critical-controls': {
      if (config.requiredControlIds.length === 0) {
        return { status: 'unknown', detail: 'No specific critical controls are configured.', source: 'passport.config' }
      }
      if (!external.buttonboxProfile.exists) {
        return { status: 'mismatch', detail: 'The selected ButtonBox profile is unavailable.', source: 'buttonbox-profile-store' }
      }
      const missing = config.requiredControlIds.filter((controlId) =>
        !external.buttonboxProfile.controlIds.includes(controlId)
      )
      return {
        status: missing.length === 0 ? 'verified' : 'mismatch',
        detail: missing.length === 0
          ? `Critical controls mapped: ${config.requiredControlIds.join(', ')}.`
          : `Critical controls missing from ${external.buttonboxProfile.profileName}: ${missing.join(', ')}.`,
        source: 'buttonbox-profile-store',
        evidence: {
          profileName: external.buttonboxProfile.profileName,
          requiredControlIds: config.requiredControlIds,
          mappedControlIds: external.buttonboxProfile.controlIds
        }
      }
    }
    case 'audio-comms': {
      const requiredCallouts = config.requiredAudioCallouts
      const missingCallouts = requiredCallouts.filter((callout) =>
        !external.audio.enabledCallouts.includes(callout)
      )
      const outputMatches = !config.requiredAudioOutputDeviceId ||
        external.audio.outputDeviceId === config.requiredAudioOutputDeviceId
      const audioReady = external.audio.configFound &&
        external.audio.enabled &&
        !external.audio.muted &&
        outputMatches &&
        missingCallouts.length === 0
      if (!audioReady) {
        return {
          status: 'mismatch',
          detail: 'Spotter audio output, mute state, device, or required callouts do not match Passport configuration.',
          source: 'spotter-config',
          evidence: {
            ...external.audio,
            requiredOutputDeviceId: config.requiredAudioOutputDeviceId,
            requiredCallouts,
            missingCallouts
          }
        }
      }
      return {
        status: 'unknown',
        detail: config.communicationChannel
          ? `Audio is verified; manually confirm team communications on ${config.communicationChannel}.`
          : 'Audio is verified, but a specific team communication channel is not configured.',
        source: 'spotter-config+manual-comms',
        evidence: {
          ...external.audio,
          communicationChannel: config.communicationChannel,
          requiredCallouts
        }
      }
    }
    default:
      return {
        status: 'unknown',
        detail: 'This item is evaluated from live telemetry.',
        source: 'phase02.tap'
      }
  }
}

export function evaluatePassportItems(input: EvaluatePassportInput): PassportItem[] {
  const facts = canonicalFactsByName(input.event.facts)
  const currentById = new Map(input.passport.items.map((item) => [item.id, item]))
  return PASSPORT_ITEM_DEFINITIONS.map((definition) => {
    const current = currentById.get(definition.id)
    if (current && validManual(current, input.now)) {
      return {
        ...current,
        owner: ownerFor(definition.id, current.owner, input.roster)
      }
    }
    const externalItem = definition.id === 'race-profile' ||
      definition.id === 'buttonbox-profile' ||
      definition.id === 'required-devices' ||
      definition.id === 'critical-controls' ||
      definition.id === 'audio-comms'
    if (externalItem && input.external === undefined && current) {
      return {
        ...current,
        owner: ownerFor(definition.id, current.owner, input.roster)
      }
    }
    const result = externalItem
      ? evaluateExternalItem(definition.id, input.external, input.config)
      : evaluateTelemetryItem(definition.id, facts, input.roster, input.config)
    const nextEvidence = result.evidence
      ? evidence(result.source, result.detail, result.evidence, input.now)
      : undefined
    const expiresAt = result.status === 'verified'
      ? input.now + definition.ttlMs
      : undefined
    return {
      id: definition.id,
      status: result.status,
      owner: ownerFor(definition.id, current?.owner, input.roster),
      detail: result.detail,
      verifiedAt: result.status === 'verified' ? input.now : undefined,
      expiresAt,
      evidence: nextEvidence,
      revision: (current?.revision ?? 0) + 1
    }
  })
}

export function expirePassportItems(items: readonly PassportItem[], now: number): PassportItem[] {
  return items.map((item) => {
    if (item.expiresAt === undefined || item.expiresAt > now) return { ...item }
    if (
      item.status !== 'verified' &&
      item.status !== 'manual-confirmed' &&
      item.status !== 'waived-with-reason'
    ) return { ...item }
    return {
      ...item,
      status: 'expired',
      detail: `${item.detail} Revalidation expired.`,
      revision: item.revision + 1
    }
  })
}

export function withCoverage(passport: StintPassport, items: PassportItem[]): StintPassport {
  return { ...passport, items, ...calculatePassportCoverage(items) }
}

export function validateChallengeReadiness(
  passport: StintPassport,
  roster: readonly PassportRosterMember[],
  now: number
): string[] {
  const errors: string[] = []
  const items = expirePassportItems(passport.items, now)
  const coverage = calculatePassportCoverage(items)
  if (coverage.coverage < 0.95) {
    errors.push(`Coverage ${(coverage.coverage * 100).toFixed(1)}% is below 95%.`)
  }
  for (const item of items) {
    const definition = passportItemDefinition(item.id)
    if (definition.critical && (item.status === 'unknown' || item.status === 'mismatch' || item.status === 'expired')) {
      errors.push(`${item.id} is ${item.status}.`)
    }
    if (item.status !== 'not-applicable') {
      if (!item.owner) {
        errors.push(`${item.id} has no role-bound owner.`)
        continue
      }
      const member = roster.find((candidate) => candidate.memberId === item.owner?.memberId && candidate.active)
      if (!member || !member.roles.includes(item.owner.role) || !definition.allowedRoles.includes(item.owner.role)) {
        errors.push(`${item.id} owner is not valid for ${item.owner.role}.`)
      }
    }
    if (item.status === 'waived-with-reason' && !item.overrideReason?.trim()) {
      errors.push(`${item.id} waiver requires a reason.`)
    }
  }
  return errors
}
