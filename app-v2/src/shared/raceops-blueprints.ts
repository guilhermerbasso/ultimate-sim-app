export const RACEOPS_BLUEPRINT_SCHEMA_VERSION = 2 as const
export const RACEOPS_BLUEPRINT_LEGACY_SCHEMA_VERSION = 1 as const
export const RACEOPS_BLUEPRINT_RUNTIME_VERSION = 1 as const
export const RACEOPS_FIXTURE_SCHEMA_VERSION = 1 as const
export const RACEOPS_FEED_SCHEMA_VERSION = 1 as const
export const RACEOPS_REGISTRY_SCHEMA_VERSION = 2 as const
export const RACEOPS_EVIDENCE_SCHEMA_VERSION = 1 as const

export const RACEOPS_BLUEPRINT_CHANNELS = {
  getSnapshot: 'blueprints:getSnapshot',
  refreshFeed: 'blueprints:refreshFeed',
  dryRun: 'blueprints:dryRun',
  stage: 'blueprints:stage',
  rollback: 'blueprints:rollback',
  changed: 'blueprints:changed'
} as const

export const RACEOPS_BLUEPRINT_CAPABILITIES = [
  'telemetry.session.read',
  'telemetry.fuel.read',
  'telemetry.car-state.read',
  'cue.visual.preview',
  'cue.audio.preview',
  'dashboard.state.preview',
  'stream.card.preview'
] as const

export type RaceOpsBlueprintCapability = (typeof RACEOPS_BLUEPRINT_CAPABILITIES)[number]

export const RACEOPS_TELEMETRY_FIELDS = [
  'session.flag',
  'session.phase',
  'fuel.lapsRemaining',
  'fuel.pitWindowOpen',
  'car.onPitRoad'
] as const

export type RaceOpsTelemetryField = (typeof RACEOPS_TELEMETRY_FIELDS)[number]
export type RaceOpsScalar = string | number | boolean
export type RaceOpsPredicateOperator = 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte'
export type RaceOpsWorkflowMode = 'rising-edge' | 'every-match'
export type RaceOpsTraceKind = 'detector' | 'cue' | 'dashboard-state' | 'stream-card'

export type RaceOpsBlueprintErrorCode =
  | 'INVALID_SCHEMA'
  | 'UNSUPPORTED_VERSION'
  | 'UNKNOWN_CAPABILITY'
  | 'UNDECLARED_ACCESS'
  | 'INCOMPATIBLE_APP'
  | 'INVALID_PARAMETER'
  | 'TRACE_MISMATCH'
  | 'TAMPERED'
  | 'UNKNOWN_SIGNATURE'
  | 'OFFLINE'
  | 'ROLLBACK_UNAVAILABLE'

export class RaceOpsBlueprintError extends Error {
  readonly code: RaceOpsBlueprintErrorCode

  constructor(code: RaceOpsBlueprintErrorCode, message: string) {
    super(message)
    this.name = 'RaceOpsBlueprintError'
    this.code = code
  }
}

export interface RaceOpsNumberParameter {
  id: string
  label: string
  description?: string
  type: 'number'
  default: number
  min: number
  max: number
  step: number
  unit?: string
}

export interface RaceOpsBooleanParameter {
  id: string
  label: string
  description?: string
  type: 'boolean'
  default: boolean
}

export interface RaceOpsEnumOption {
  value: string
  label: string
}

export interface RaceOpsEnumParameter {
  id: string
  label: string
  description?: string
  type: 'enum'
  default: string
  options: RaceOpsEnumOption[]
}

export type RaceOpsBlueprintParameter =
  | RaceOpsNumberParameter
  | RaceOpsBooleanParameter
  | RaceOpsEnumParameter

export interface RaceOpsParameterReference {
  parameter: string
}

export type RaceOpsOperand = RaceOpsScalar | RaceOpsParameterReference

export interface RaceOpsPredicate {
  id: string
  field: RaceOpsTelemetryField
  operator: RaceOpsPredicateOperator
  value: RaceOpsOperand
}

export interface RaceOpsCueAction {
  id: string
  kind: 'cue'
  channel: 'visual' | 'audio'
  severity: 'info' | 'warning' | 'critical'
  message: string
}

export interface RaceOpsDashboardStateAction {
  id: string
  kind: 'dashboard-state'
  state: string
}

export interface RaceOpsStreamCardAction {
  id: string
  kind: 'stream-card'
  title: string
  body: string
}

export type RaceOpsBlueprintAction =
  | RaceOpsCueAction
  | RaceOpsDashboardStateAction
  | RaceOpsStreamCardAction

export interface RaceOpsWorkflow {
  mode: RaceOpsWorkflowMode
  trigger: RaceOpsPredicate
  conditions: RaceOpsPredicate[]
  actions: RaceOpsBlueprintAction[]
}

export interface RaceOpsFixtureEvent {
  atMs: number
  values: Partial<Record<RaceOpsTelemetryField, RaceOpsOperand>>
}

export interface RaceOpsFixture {
  schemaVersion: typeof RACEOPS_FIXTURE_SCHEMA_VERSION
  id: string
  version: number
  source: 'synthetic'
  schemaFingerprint: 'raceops.fixture/v1'
  seed: number
  privacy: 'no-personal-data'
  events: RaceOpsFixtureEvent[]
}

export interface RaceOpsTraceEntry {
  sequence: number
  atMs: number
  stepId: string
  kind: RaceOpsTraceKind
  payload: Record<string, RaceOpsScalar>
}

export interface RaceOpsBlueprintCompatibility {
  app: {
    min: string
    max: string
  }
  runtime: typeof RACEOPS_BLUEPRINT_RUNTIME_VERSION
}

export interface RaceOpsBlueprintManifest {
  schemaVersion: typeof RACEOPS_BLUEPRINT_SCHEMA_VERSION
  id: string
  version: string
  title: string
  summary: string
  author: string
  compatibility: RaceOpsBlueprintCompatibility
  capabilities: RaceOpsBlueprintCapability[]
  parameters: RaceOpsBlueprintParameter[]
  workflow: RaceOpsWorkflow
  fixture: RaceOpsFixture
  expectedTrace: RaceOpsTraceEntry[]
}

export interface RaceOpsDryRunResult {
  blueprintId: string
  blueprintVersion: string
  parameters: Record<string, RaceOpsScalar>
  trace: RaceOpsTraceEntry[]
  expectedTrace: RaceOpsTraceEntry[]
  matchesExpected: boolean
}

export type RaceOpsBlueprintFeedSource =
  | {
      kind: 'url'
      url: string
    }
  | {
      kind: 'git'
      repository: string
      revision: string
      path: string
      url: string
    }

export interface RaceOpsBlueprintFeedEntry {
  id: string
  version: string
  manifestSha256: string
  manifest: RaceOpsBlueprintManifest
}

export interface RaceOpsBlueprintFeedPayload {
  schemaVersion: typeof RACEOPS_FEED_SCHEMA_VERSION
  feedId: string
  title: string
  sequence: number
  issuedAt: string
  expiresAt: string
  source: RaceOpsBlueprintFeedSource
  entries: RaceOpsBlueprintFeedEntry[]
}

export interface RaceOpsBlueprintFeedSignature {
  algorithm: 'ed25519'
  keyId: string
  value: string
}

export interface SignedRaceOpsBlueprintFeed {
  payload: RaceOpsBlueprintFeedPayload
  signature: RaceOpsBlueprintFeedSignature
}

export interface CuratedRaceOpsFeedPin {
  feedId: string
  title: string
  endpoint: string
  envelopeSha256: string
  keyId: string
  reviewedAt: string
  source: RaceOpsBlueprintFeedSource
}

export type RaceOpsCompatibilityStatus =
  | 'compatible'
  | 'incompatible-app'
  | 'trace-mismatch'
  | 'unverified'
  | 'stale'

export interface RaceOpsCompatibilityEvidence {
  schemaVersion: typeof RACEOPS_EVIDENCE_SCHEMA_VERSION
  id: string
  blueprintId: string
  blueprintVersion: string
  feedId: string
  feedEnvelopeSha256: string
  signerKeyId: string
  manifestSha256: string
  fixtureSha256: string
  parametersSha256: string
  traceSha256: string
  appVersion: string
  runtimeVersion: typeof RACEOPS_BLUEPRINT_RUNTIME_VERSION
  publisher: 'ultimate-sim-app/local-conformance-v1'
  operation: 'dry-run' | 'stage' | 'rollback'
  status: Exclude<RaceOpsCompatibilityStatus, 'unverified' | 'stale'>
  reasons: string[]
  publishedAt: string
}

export interface RaceOpsInstalledBlueprint {
  blueprintId: string
  blueprintVersion: string
  manifestSha256: string
  feedId: string
  parameters: Record<string, RaceOpsScalar>
  evidenceId: string
  stagedAt: string
  execution: 'disabled-trust-gate'
}

export interface RaceOpsFeedStatus {
  feedId: string
  title: string
  source: RaceOpsBlueprintFeedSource
  envelopeSha256: string
  signerKeyId: string
  reviewedAt: string
  verifiedAt: string
  fromCache: boolean
  offline: boolean
  sequence: number
  expiresAt: string
}

export interface RaceOpsBlueprintCatalogEntry {
  feedId: string
  feedTitle: string
  id: string
  version: string
  title: string
  summary: string
  author: string
  compatibility: RaceOpsBlueprintCompatibility
  capabilities: RaceOpsBlueprintCapability[]
  parameters: RaceOpsBlueprintParameter[]
  manifestSha256: string
  compatibilityStatus: RaceOpsCompatibilityStatus
  evidence?: RaceOpsCompatibilityEvidence
  installed?: RaceOpsInstalledBlueprint
  rollbackAvailable: boolean
}

export interface RaceOpsBlueprintRegistrySnapshot {
  appVersion: string
  executionEnabled: false
  trustGate: 'conformance-required'
  feeds: RaceOpsFeedStatus[]
  blueprints: RaceOpsBlueprintCatalogEntry[]
  installed: RaceOpsInstalledBlueprint[]
  evidence: RaceOpsCompatibilityEvidence[]
}

export interface RaceOpsBlueprintSelectionRequest {
  feedId: string
  blueprintId: string
  parameters: Record<string, unknown>
}

export interface RaceOpsBlueprintDryRunResponse {
  ok: boolean
  result?: RaceOpsDryRunResult
  evidence: RaceOpsCompatibilityEvidence
}

export interface RaceOpsBlueprintStageResponse extends RaceOpsBlueprintDryRunResponse {
  installed: boolean
  staged?: RaceOpsInstalledBlueprint
}

type UnknownRecord = Record<string, unknown>

function invalid(message: string): never {
  throw new RaceOpsBlueprintError('INVALID_SCHEMA', message)
}

function asRecord(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object.`)
  return value as UnknownRecord
}

function exactKeys(record: UnknownRecord, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed)
  const unknown = Object.keys(record).filter((key) => !allowedSet.has(key))
  if (unknown.length > 0) invalid(`${label} contains unsupported fields: ${unknown.join(', ')}.`)
}

function asString(value: unknown, label: string, maxLength = 240): string {
  if (typeof value !== 'string') invalid(`${label} must be a string.`)
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) invalid(`${label} is empty or too long.`)
  return normalized
}

function asSlug(value: unknown, label: string): string {
  const slug = asString(value, label, 96)
  if (!/^[a-z][a-z0-9-]*$/.test(slug)) invalid(`${label} must be a lowercase slug.`)
  if (slug === 'constructor' || slug === 'prototype' || slug === '__proto__') {
    invalid(`${label} uses a reserved identifier.`)
  }
  return slug
}

function asInteger(value: unknown, label: string, min = Number.MIN_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < min) invalid(`${label} must be an integer.`)
  return value as number
}

function asFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(`${label} must be finite.`)
  return value
}

function asScalar(value: unknown, label: string): RaceOpsScalar {
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return invalid(`${label} must be a string, number, or boolean.`)
}

function asIsoDate(value: unknown, label: string): string {
  const date = asString(value, label, 64)
  if (!Number.isFinite(Date.parse(date))) invalid(`${label} must be an ISO date.`)
  return date
}

function parseSemver(value: unknown, label: string): [number, number, number, string | null] {
  const version = asString(value, label, 64)
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version)
  if (!match) invalid(`${label} must be a semantic version.`)
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? null]
}

export function compareRaceOpsSemver(a: string, b: string): number {
  const av = parseSemver(a, 'version')
  const bv = parseSemver(b, 'version')
  for (let index = 0; index < 3; index += 1) {
    if (av[index] !== bv[index]) return (av[index] as number) - (bv[index] as number)
  }
  if (av[3] === bv[3]) return 0
  if (av[3] === null) return 1
  if (bv[3] === null) return -1
  return av[3].localeCompare(bv[3])
}

export function canonicalJson(value: unknown): string {
  const normalize = (candidate: unknown, path: string): unknown => {
    if (
      candidate === null ||
      typeof candidate === 'string' ||
      typeof candidate === 'boolean'
    ) {
      return candidate
    }
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) invalid(`${path} contains a non-finite number.`)
      return candidate
    }
    if (Array.isArray(candidate)) {
      return candidate.map((item, index) => normalize(item, `${path}[${index}]`))
    }
    if (candidate && typeof candidate === 'object') {
      const object = candidate as UnknownRecord
      const normalized: UnknownRecord = {}
      for (const key of Object.keys(object).sort()) {
        if (object[key] === undefined) invalid(`${path}.${key} is undefined.`)
        normalized[key] = normalize(object[key], `${path}.${key}`)
      }
      return normalized
    }
    return invalid(`${path} contains a non-JSON value.`)
  }
  return JSON.stringify(normalize(value, '$'))
}

function parseOperand(value: unknown, label: string): RaceOpsOperand {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = asRecord(value, label)
    exactKeys(record, ['parameter'], label)
    return { parameter: asSlug(record.parameter, `${label}.parameter`) }
  }
  return asScalar(value, label)
}

function parseParameter(value: unknown, index: number): RaceOpsBlueprintParameter {
  const label = `parameters[${index}]`
  const record = asRecord(value, label)
  const type = asString(record.type, `${label}.type`, 16)
  const common = {
    id: asSlug(record.id, `${label}.id`),
    label: asString(record.label, `${label}.label`, 80),
    ...(record.description === undefined
      ? {}
      : { description: asString(record.description, `${label}.description`, 240) })
  }

  if (type === 'number') {
    exactKeys(record, ['id', 'label', 'description', 'type', 'default', 'min', 'max', 'step', 'unit'], label)
    const min = asFiniteNumber(record.min, `${label}.min`)
    const max = asFiniteNumber(record.max, `${label}.max`)
    const step = asFiniteNumber(record.step, `${label}.step`)
    const defaultValue = asFiniteNumber(record.default, `${label}.default`)
    if (max < min || step <= 0 || defaultValue < min || defaultValue > max) {
      invalid(`${label} has invalid numeric constraints.`)
    }
    return {
      ...common,
      type: 'number',
      default: defaultValue,
      min,
      max,
      step,
      ...(record.unit === undefined ? {} : { unit: asString(record.unit, `${label}.unit`, 24) })
    }
  }

  if (type === 'boolean') {
    exactKeys(record, ['id', 'label', 'description', 'type', 'default'], label)
    if (typeof record.default !== 'boolean') invalid(`${label}.default must be boolean.`)
    return { ...common, type: 'boolean', default: record.default }
  }

  if (type === 'enum') {
    exactKeys(record, ['id', 'label', 'description', 'type', 'default', 'options'], label)
    if (!Array.isArray(record.options) || record.options.length === 0 || record.options.length > 32) {
      invalid(`${label}.options must contain 1-32 entries.`)
    }
    const options = record.options.map((option, optionIndex): RaceOpsEnumOption => {
      const optionLabel = `${label}.options[${optionIndex}]`
      const optionRecord = asRecord(option, optionLabel)
      exactKeys(optionRecord, ['value', 'label'], optionLabel)
      return {
        value: asSlug(optionRecord.value, `${optionLabel}.value`),
        label: asString(optionRecord.label, `${optionLabel}.label`, 80)
      }
    })
    const unique = new Set(options.map((option) => option.value))
    if (unique.size !== options.length) invalid(`${label}.options contains duplicate values.`)
    const defaultValue = asSlug(record.default, `${label}.default`)
    if (!unique.has(defaultValue)) invalid(`${label}.default is not an option.`)
    return { ...common, type: 'enum', default: defaultValue, options }
  }

  return invalid(`${label}.type is unsupported.`)
}

function parsePredicate(value: unknown, label: string): RaceOpsPredicate {
  const record = asRecord(value, label)
  exactKeys(record, ['id', 'field', 'operator', 'value'], label)
  const field = asString(record.field, `${label}.field`, 80)
  if (!(RACEOPS_TELEMETRY_FIELDS as readonly string[]).includes(field)) {
    invalid(`${label}.field is unsupported.`)
  }
  const operator = asString(record.operator, `${label}.operator`, 8)
  if (!['eq', 'neq', 'lt', 'lte', 'gt', 'gte'].includes(operator)) {
    invalid(`${label}.operator is unsupported.`)
  }
  return {
    id: asSlug(record.id, `${label}.id`),
    field: field as RaceOpsTelemetryField,
    operator: operator as RaceOpsPredicateOperator,
    value: parseOperand(record.value, `${label}.value`)
  }
}

function parseAction(value: unknown, index: number): RaceOpsBlueprintAction {
  const label = `workflow.actions[${index}]`
  const record = asRecord(value, label)
  const kind = asString(record.kind, `${label}.kind`, 32)
  const id = asSlug(record.id, `${label}.id`)
  if (kind === 'cue') {
    exactKeys(record, ['id', 'kind', 'channel', 'severity', 'message'], label)
    const channel = asString(record.channel, `${label}.channel`, 16)
    const severity = asString(record.severity, `${label}.severity`, 16)
    if (channel !== 'visual' && channel !== 'audio') invalid(`${label}.channel is unsupported.`)
    if (!['info', 'warning', 'critical'].includes(severity)) invalid(`${label}.severity is unsupported.`)
    return {
      id,
      kind,
      channel,
      severity: severity as RaceOpsCueAction['severity'],
      message: asString(record.message, `${label}.message`, 240)
    }
  }
  if (kind === 'dashboard-state') {
    exactKeys(record, ['id', 'kind', 'state'], label)
    return { id, kind, state: asSlug(record.state, `${label}.state`) }
  }
  if (kind === 'stream-card') {
    exactKeys(record, ['id', 'kind', 'title', 'body'], label)
    return {
      id,
      kind,
      title: asString(record.title, `${label}.title`, 120),
      body: asString(record.body, `${label}.body`, 240)
    }
  }
  return invalid(`${label}.kind is unsupported.`)
}

function parseFixture(value: unknown): RaceOpsFixture {
  const record = asRecord(value, 'fixture')
  exactKeys(
    record,
    ['schemaVersion', 'id', 'version', 'source', 'schemaFingerprint', 'seed', 'privacy', 'events'],
    'fixture'
  )
  if (record.schemaVersion !== RACEOPS_FIXTURE_SCHEMA_VERSION) {
    throw new RaceOpsBlueprintError('UNSUPPORTED_VERSION', 'Unsupported fixture schema version.')
  }
  if (record.source !== 'synthetic') invalid('fixture.source must be synthetic.')
  if (record.schemaFingerprint !== 'raceops.fixture/v1') invalid('fixture.schemaFingerprint is unsupported.')
  if (record.privacy !== 'no-personal-data') invalid('fixture.privacy must declare no-personal-data.')
  if (!Array.isArray(record.events) || record.events.length === 0 || record.events.length > 10_000) {
    invalid('fixture.events must contain 1-10000 events.')
  }
  let previousAt = -1
  const events = record.events.map((event, index): RaceOpsFixtureEvent => {
    const label = `fixture.events[${index}]`
    const eventRecord = asRecord(event, label)
    exactKeys(eventRecord, ['atMs', 'values'], label)
    const atMs = asInteger(eventRecord.atMs, `${label}.atMs`, 0)
    if (atMs <= previousAt) invalid('fixture events must use a strictly increasing monotonic clock.')
    previousAt = atMs
    const valuesRecord = asRecord(eventRecord.values, `${label}.values`)
    const values: Partial<Record<RaceOpsTelemetryField, RaceOpsOperand>> = {}
    for (const [field, fieldValue] of Object.entries(valuesRecord)) {
      if (!(RACEOPS_TELEMETRY_FIELDS as readonly string[]).includes(field)) {
        invalid(`${label}.values contains unsupported field ${field}.`)
      }
      values[field as RaceOpsTelemetryField] = parseOperand(fieldValue, `${label}.values.${field}`)
    }
    return { atMs, values }
  })
  return {
    schemaVersion: RACEOPS_FIXTURE_SCHEMA_VERSION,
    id: asSlug(record.id, 'fixture.id'),
    version: asInteger(record.version, 'fixture.version', 1),
    source: 'synthetic',
    schemaFingerprint: 'raceops.fixture/v1',
    seed: asInteger(record.seed, 'fixture.seed', 0),
    privacy: 'no-personal-data',
    events
  }
}

function parseTrace(value: unknown): RaceOpsTraceEntry[] {
  if (!Array.isArray(value) || value.length > 50_000) invalid('expectedTrace must be an array.')
  return value.map((entry, index): RaceOpsTraceEntry => {
    const label = `expectedTrace[${index}]`
    const record = asRecord(entry, label)
    exactKeys(record, ['sequence', 'atMs', 'stepId', 'kind', 'payload'], label)
    const kind = asString(record.kind, `${label}.kind`, 32)
    if (!['detector', 'cue', 'dashboard-state', 'stream-card'].includes(kind)) {
      invalid(`${label}.kind is unsupported.`)
    }
    const payloadRecord = asRecord(record.payload, `${label}.payload`)
    const payload: Record<string, RaceOpsScalar> = {}
    for (const [key, payloadValue] of Object.entries(payloadRecord)) {
      if (!/^[a-z][A-Za-z0-9]*$/.test(key)) invalid(`${label}.payload contains invalid key ${key}.`)
      payload[key] = asScalar(payloadValue, `${label}.payload.${key}`)
    }
    return {
      sequence: asInteger(record.sequence, `${label}.sequence`, 1),
      atMs: asInteger(record.atMs, `${label}.atMs`, 0),
      stepId: asSlug(record.stepId, `${label}.stepId`),
      kind: kind as RaceOpsTraceKind,
      payload
    }
  })
}

function telemetryCapability(field: RaceOpsTelemetryField): RaceOpsBlueprintCapability {
  if (field.startsWith('session.')) return 'telemetry.session.read'
  if (field.startsWith('fuel.')) return 'telemetry.fuel.read'
  return 'telemetry.car-state.read'
}

function actionCapability(action: RaceOpsBlueprintAction): RaceOpsBlueprintCapability {
  if (action.kind === 'cue') {
    return action.channel === 'visual' ? 'cue.visual.preview' : 'cue.audio.preview'
  }
  if (action.kind === 'dashboard-state') return 'dashboard.state.preview'
  return 'stream.card.preview'
}

function inferCapabilities(workflow: RaceOpsWorkflow): RaceOpsBlueprintCapability[] {
  const capabilities = new Set<RaceOpsBlueprintCapability>()
  capabilities.add(telemetryCapability(workflow.trigger.field))
  for (const condition of workflow.conditions) capabilities.add(telemetryCapability(condition.field))
  for (const action of workflow.actions) capabilities.add(actionCapability(action))
  return [...capabilities].sort()
}

function assertTemplateParameters(template: string, parameterIds: ReadonlySet<string>, label: string): void {
  const tokenPattern = /\{\{param\.([a-z][a-z0-9-]*)\}\}/g
  for (const match of template.matchAll(tokenPattern)) {
    if (!parameterIds.has(match[1])) invalid(`${label} references unknown parameter ${match[1]}.`)
  }
  const withoutKnownTokens = template.replace(tokenPattern, '')
  if (withoutKnownTokens.includes('{{') || withoutKnownTokens.includes('}}')) {
    invalid(`${label} contains an unsupported template token.`)
  }
}

function validateManifestRelations(manifest: RaceOpsBlueprintManifest): void {
  const parameterIds = new Set<string>()
  for (const parameter of manifest.parameters) {
    if (parameterIds.has(parameter.id)) invalid(`Duplicate parameter ${parameter.id}.`)
    parameterIds.add(parameter.id)
  }
  const stepIds = new Set<string>()
  const predicates = [manifest.workflow.trigger, ...manifest.workflow.conditions]
  for (const predicate of predicates) {
    if (stepIds.has(predicate.id)) invalid(`Duplicate workflow step ${predicate.id}.`)
    stepIds.add(predicate.id)
    if (typeof predicate.value === 'object' && !parameterIds.has(predicate.value.parameter)) {
      invalid(`Predicate ${predicate.id} references unknown parameter ${predicate.value.parameter}.`)
    }
  }
  for (const action of manifest.workflow.actions) {
    if (stepIds.has(action.id)) invalid(`Duplicate workflow step ${action.id}.`)
    stepIds.add(action.id)
    if (action.kind === 'cue') assertTemplateParameters(action.message, parameterIds, `${action.id}.message`)
    if (action.kind === 'stream-card') {
      assertTemplateParameters(action.title, parameterIds, `${action.id}.title`)
      assertTemplateParameters(action.body, parameterIds, `${action.id}.body`)
    }
    for (const [eventIndex, event] of manifest.fixture.events.entries()) {
      for (const [field, value] of Object.entries(event.values)) {
        if (typeof value === 'object' && !parameterIds.has(value.parameter)) {
          invalid(
            `fixture.events[${eventIndex}].values.${field} references unknown parameter ${value.parameter}.`
          )
        }
      }
    }
    for (const [traceIndex, entry] of manifest.expectedTrace.entries()) {
      for (const [key, value] of Object.entries(entry.payload)) {
        if (typeof value === 'string') {
          assertTemplateParameters(value, parameterIds, `expectedTrace[${traceIndex}].payload.${key}`)
        }
      }
    }
  }

  const declared = new Set(manifest.capabilities)
  const required = inferCapabilities(manifest.workflow)
  const missing = required.filter((capability) => !declared.has(capability))
  if (missing.length > 0) {
    throw new RaceOpsBlueprintError(
      'UNDECLARED_ACCESS',
      `Blueprint uses undeclared capabilities: ${missing.join(', ')}.`
    )
  }
  const unused = manifest.capabilities.filter((capability) => !required.includes(capability))
  if (unused.length > 0) {
    throw new RaceOpsBlueprintError(
      'UNDECLARED_ACCESS',
      `Blueprint declares capabilities it does not use: ${unused.join(', ')}.`
    )
  }

  for (let index = 0; index < manifest.expectedTrace.length; index += 1) {
    if (manifest.expectedTrace[index].sequence !== index + 1) {
      invalid('expectedTrace sequence must be contiguous and 1-based.')
    }
  }
}

export function migrateRaceOpsBlueprintManifest(value: unknown): unknown {
  const record = asRecord(value, 'manifest')
  const schemaVersion = asInteger(record.schemaVersion, 'manifest.schemaVersion', 1)
  if (schemaVersion === RACEOPS_BLUEPRINT_SCHEMA_VERSION) return record
  if (schemaVersion !== RACEOPS_BLUEPRINT_LEGACY_SCHEMA_VERSION) {
    throw new RaceOpsBlueprintError(
      'UNSUPPORTED_VERSION',
      `Unsupported blueprint schema version ${schemaVersion}.`
    )
  }
  exactKeys(
    record,
    [
      'schemaVersion',
      'id',
      'version',
      'title',
      'summary',
      'author',
      'minimumAppVersion',
      'maximumAppVersion',
      'capabilities',
      'parameters',
      'recipe',
      'fixture',
      'expectedTrace'
    ],
    'manifest v1'
  )
  return {
    schemaVersion: RACEOPS_BLUEPRINT_SCHEMA_VERSION,
    id: record.id,
    version: record.version,
    title: record.title,
    summary: record.summary,
    author: record.author,
    compatibility: {
      app: {
        min: record.minimumAppVersion,
        max: record.maximumAppVersion
      },
      runtime: RACEOPS_BLUEPRINT_RUNTIME_VERSION
    },
    capabilities: record.capabilities,
    parameters: record.parameters,
    workflow: record.recipe,
    fixture: record.fixture,
    expectedTrace: record.expectedTrace
  }
}

export function parseRaceOpsBlueprintManifest(value: unknown): RaceOpsBlueprintManifest {
  const migrated = asRecord(migrateRaceOpsBlueprintManifest(value), 'manifest')
  exactKeys(
    migrated,
    [
      'schemaVersion',
      'id',
      'version',
      'title',
      'summary',
      'author',
      'compatibility',
      'capabilities',
      'parameters',
      'workflow',
      'fixture',
      'expectedTrace'
    ],
    'manifest'
  )
  if (migrated.schemaVersion !== RACEOPS_BLUEPRINT_SCHEMA_VERSION) {
    throw new RaceOpsBlueprintError('UNSUPPORTED_VERSION', 'Unsupported blueprint schema version.')
  }

  const compatibilityRecord = asRecord(migrated.compatibility, 'compatibility')
  exactKeys(compatibilityRecord, ['app', 'runtime'], 'compatibility')
  if (compatibilityRecord.runtime !== RACEOPS_BLUEPRINT_RUNTIME_VERSION) {
    throw new RaceOpsBlueprintError('UNSUPPORTED_VERSION', 'Unsupported blueprint runtime version.')
  }
  const appRecord = asRecord(compatibilityRecord.app, 'compatibility.app')
  exactKeys(appRecord, ['min', 'max'], 'compatibility.app')
  const minVersion = asString(appRecord.min, 'compatibility.app.min', 64)
  const maxVersion = asString(appRecord.max, 'compatibility.app.max', 64)
  parseSemver(minVersion, 'compatibility.app.min')
  parseSemver(maxVersion, 'compatibility.app.max')
  if (compareRaceOpsSemver(minVersion, maxVersion) > 0) invalid('compatibility app range is inverted.')

  if (!Array.isArray(migrated.capabilities) || migrated.capabilities.length === 0) {
    invalid('capabilities must be a non-empty array.')
  }
  const capabilities = migrated.capabilities.map((capability, index): RaceOpsBlueprintCapability => {
    const parsed = asString(capability, `capabilities[${index}]`, 80)
    if (!(RACEOPS_BLUEPRINT_CAPABILITIES as readonly string[]).includes(parsed)) {
      throw new RaceOpsBlueprintError('UNKNOWN_CAPABILITY', `Unknown capability ${parsed}.`)
    }
    return parsed as RaceOpsBlueprintCapability
  })
  if (new Set(capabilities).size !== capabilities.length) invalid('capabilities contains duplicates.')

  if (!Array.isArray(migrated.parameters) || migrated.parameters.length > 32) {
    invalid('parameters must be an array with at most 32 entries.')
  }
  const parameters = migrated.parameters.map(parseParameter)

  const workflowRecord = asRecord(migrated.workflow, 'workflow')
  exactKeys(workflowRecord, ['mode', 'trigger', 'conditions', 'actions'], 'workflow')
  const mode = asString(workflowRecord.mode, 'workflow.mode', 24)
  if (mode !== 'rising-edge' && mode !== 'every-match') invalid('workflow.mode is unsupported.')
  if (!Array.isArray(workflowRecord.conditions) || workflowRecord.conditions.length > 32) {
    invalid('workflow.conditions must contain at most 32 predicates.')
  }
  if (!Array.isArray(workflowRecord.actions) || workflowRecord.actions.length === 0 || workflowRecord.actions.length > 32) {
    invalid('workflow.actions must contain 1-32 actions.')
  }
  const workflow: RaceOpsWorkflow = {
    mode,
    trigger: parsePredicate(workflowRecord.trigger, 'workflow.trigger'),
    conditions: workflowRecord.conditions.map((condition, index) =>
      parsePredicate(condition, `workflow.conditions[${index}]`)
    ),
    actions: workflowRecord.actions.map(parseAction)
  }

  const manifest: RaceOpsBlueprintManifest = {
    schemaVersion: RACEOPS_BLUEPRINT_SCHEMA_VERSION,
    id: asSlug(migrated.id, 'manifest.id'),
    version: asString(migrated.version, 'manifest.version', 64),
    title: asString(migrated.title, 'manifest.title', 120),
    summary: asString(migrated.summary, 'manifest.summary', 360),
    author: asString(migrated.author, 'manifest.author', 120),
    compatibility: {
      app: { min: minVersion, max: maxVersion },
      runtime: RACEOPS_BLUEPRINT_RUNTIME_VERSION
    },
    capabilities,
    parameters,
    workflow,
    fixture: parseFixture(migrated.fixture),
    expectedTrace: parseTrace(migrated.expectedTrace)
  }
  parseSemver(manifest.version, 'manifest.version')
  validateManifestRelations(manifest)
  return manifest
}

export function isRaceOpsAppVersionCompatible(
  manifest: RaceOpsBlueprintManifest,
  appVersion: string
): boolean {
  parseSemver(appVersion, 'appVersion')
  return (
    compareRaceOpsSemver(appVersion, manifest.compatibility.app.min) >= 0 &&
    compareRaceOpsSemver(appVersion, manifest.compatibility.app.max) <= 0
  )
}

export function assertRaceOpsAppVersionCompatible(
  manifest: RaceOpsBlueprintManifest,
  appVersion: string
): void {
  if (!isRaceOpsAppVersionCompatible(manifest, appVersion)) {
    throw new RaceOpsBlueprintError(
      'INCOMPATIBLE_APP',
      `Blueprint ${manifest.id}@${manifest.version} requires app ${manifest.compatibility.app.min}-${manifest.compatibility.app.max}; current app is ${appVersion}.`
    )
  }
}

export function resolveRaceOpsBlueprintParameters(
  manifest: RaceOpsBlueprintManifest,
  input: Record<string, unknown> = {}
): Record<string, RaceOpsScalar> {
  const definitions = new Map(manifest.parameters.map((parameter) => [parameter.id, parameter]))
  const unknown = Object.keys(input).filter((id) => !definitions.has(id))
  if (unknown.length > 0) {
    throw new RaceOpsBlueprintError('INVALID_PARAMETER', `Unknown parameters: ${unknown.join(', ')}.`)
  }

  const resolved: Record<string, RaceOpsScalar> = {}
  for (const parameter of manifest.parameters) {
    const value = input[parameter.id] ?? parameter.default
    if (parameter.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < parameter.min || value > parameter.max) {
        throw new RaceOpsBlueprintError(
          'INVALID_PARAMETER',
          `${parameter.id} must be between ${parameter.min} and ${parameter.max}.`
        )
      }
      const steps = (value - parameter.min) / parameter.step
      if (Math.abs(steps - Math.round(steps)) > 1e-9) {
        throw new RaceOpsBlueprintError(
          'INVALID_PARAMETER',
          `${parameter.id} must use step ${parameter.step}.`
        )
      }
      resolved[parameter.id] = value
      continue
    }
    if (parameter.type === 'boolean') {
      if (typeof value !== 'boolean') {
        throw new RaceOpsBlueprintError('INVALID_PARAMETER', `${parameter.id} must be boolean.`)
      }
      resolved[parameter.id] = value
      continue
    }
    if (typeof value !== 'string' || !parameter.options.some((option) => option.value === value)) {
      throw new RaceOpsBlueprintError('INVALID_PARAMETER', `${parameter.id} must be one of its declared options.`)
    }
    resolved[parameter.id] = value
  }
  return resolved
}

function resolveOperand(operand: RaceOpsOperand, parameters: Record<string, RaceOpsScalar>): RaceOpsScalar {
  return typeof operand === 'object' ? parameters[operand.parameter] : operand
}

function evaluatePredicate(
  predicate: RaceOpsPredicate,
  values: RaceOpsFixtureEvent['values'],
  parameters: Record<string, RaceOpsScalar>
): boolean {
  const actualOperand = values[predicate.field]
  if (actualOperand === undefined) return false
  const actual = resolveOperand(actualOperand, parameters)
  const expected = resolveOperand(predicate.value, parameters)
  if (predicate.operator === 'eq') return actual === expected
  if (predicate.operator === 'neq') return actual !== expected
  if (typeof actual !== 'number' || typeof expected !== 'number') return false
  if (predicate.operator === 'lt') return actual < expected
  if (predicate.operator === 'lte') return actual <= expected
  if (predicate.operator === 'gt') return actual > expected
  return actual >= expected
}

function renderTemplate(template: string, parameters: Record<string, RaceOpsScalar>): string {
  return template.replace(/\{\{param\.([a-z][a-z0-9-]*)\}\}/g, (_match, parameter: string) =>
    String(parameters[parameter])
  )
}

function resolveExpectedTrace(
  manifest: RaceOpsBlueprintManifest,
  parameters: Record<string, RaceOpsScalar>
): RaceOpsTraceEntry[] {
  const exactParameter = /^\{\{param\.([a-z][a-z0-9-]*)\}\}$/
  return manifest.expectedTrace.map((entry) => ({
    ...entry,
    payload: Object.fromEntries(
      Object.entries(entry.payload).map(([key, value]) => {
        if (typeof value !== 'string') return [key, value]
        const exact = exactParameter.exec(value)
        return [key, exact ? parameters[exact[1]] : renderTemplate(value, parameters)]
      })
    )
  }))
}

export function dryRunRaceOpsBlueprint(
  manifestInput: RaceOpsBlueprintManifest | unknown,
  parameterInput: Record<string, unknown> = {}
): RaceOpsDryRunResult {
  const manifest = parseRaceOpsBlueprintManifest(manifestInput)
  const parameters = resolveRaceOpsBlueprintParameters(manifest, parameterInput)
  const trace: RaceOpsTraceEntry[] = []
  let previousMatch = false

  const append = (
    atMs: number,
    stepId: string,
    kind: RaceOpsTraceKind,
    payload: Record<string, RaceOpsScalar>
  ): void => {
    trace.push({ sequence: trace.length + 1, atMs, stepId, kind, payload })
  }

  for (const event of manifest.fixture.events) {
    const triggerMatched = evaluatePredicate(manifest.workflow.trigger, event.values, parameters)
    const conditionsMatched = manifest.workflow.conditions.every((condition) =>
      evaluatePredicate(condition, event.values, parameters)
    )
    const matched = triggerMatched && conditionsMatched
    const shouldEmit =
      matched && (manifest.workflow.mode === 'every-match' || !previousMatch)

    if (shouldEmit) {
      const actualOperand = event.values[manifest.workflow.trigger.field]
      const expected = resolveOperand(manifest.workflow.trigger.value, parameters)
      if (actualOperand === undefined) invalid('Matched trigger is missing its telemetry value.')
      const actual = resolveOperand(actualOperand, parameters)
      append(event.atMs, manifest.workflow.trigger.id, 'detector', {
        field: manifest.workflow.trigger.field,
        operator: manifest.workflow.trigger.operator,
        actual,
        expected
      })

      for (const action of manifest.workflow.actions) {
        if (action.kind === 'cue') {
          append(event.atMs, action.id, action.kind, {
            channel: action.channel,
            severity: action.severity,
            message: renderTemplate(action.message, parameters)
          })
        } else if (action.kind === 'dashboard-state') {
          append(event.atMs, action.id, action.kind, { state: action.state })
        } else {
          append(event.atMs, action.id, action.kind, {
            title: renderTemplate(action.title, parameters),
            body: renderTemplate(action.body, parameters)
          })
        }
      }
    }
    previousMatch = matched
  }

  const expectedTrace = resolveExpectedTrace(manifest, parameters)
  return {
    blueprintId: manifest.id,
    blueprintVersion: manifest.version,
    parameters,
    trace,
    expectedTrace,
    matchesExpected: canonicalJson(trace) === canonicalJson(expectedTrace)
  }
}

export function assertRaceOpsExpectedTrace(
  manifest: RaceOpsBlueprintManifest,
  parameters: Record<string, unknown> = {}
): RaceOpsDryRunResult {
  const result = dryRunRaceOpsBlueprint(manifest, parameters)
  if (!result.matchesExpected) {
    throw new RaceOpsBlueprintError(
      'TRACE_MISMATCH',
      `Blueprint ${manifest.id}@${manifest.version} does not match its expected trace.`
    )
  }
  return result
}

function parseFeedSource(value: unknown, label: string): RaceOpsBlueprintFeedSource {
  const record = asRecord(value, label)
  const kind = asString(record.kind, `${label}.kind`, 8)
  if (kind === 'url') {
    exactKeys(record, ['kind', 'url'], label)
    const url = asString(record.url, `${label}.url`, 500)
    if (new URL(url).protocol !== 'https:') invalid(`${label}.url must use HTTPS.`)
    return { kind, url }
  }
  if (kind === 'git') {
    exactKeys(record, ['kind', 'repository', 'revision', 'path', 'url'], label)
    const repository = asString(record.repository, `${label}.repository`, 500)
    const url = asString(record.url, `${label}.url`, 500)
    if (new URL(repository).protocol !== 'https:' || new URL(url).protocol !== 'https:') {
      invalid(`${label} Git URLs must use HTTPS.`)
    }
    const path = asString(record.path, `${label}.path`, 240)
    if (path.startsWith('/') || path.includes('..') || path.includes('\\')) {
      invalid(`${label}.path must remain inside the repository.`)
    }
    return {
      kind,
      repository,
      revision: asString(record.revision, `${label}.revision`, 120),
      path,
      url
    }
  }
  return invalid(`${label}.kind is unsupported.`)
}

export function parseSignedRaceOpsBlueprintFeed(value: unknown): SignedRaceOpsBlueprintFeed {
  const envelope = asRecord(value, 'feed')
  exactKeys(envelope, ['payload', 'signature'], 'feed')
  const payloadRecord = asRecord(envelope.payload, 'feed.payload')
  exactKeys(
    payloadRecord,
    ['schemaVersion', 'feedId', 'title', 'sequence', 'issuedAt', 'expiresAt', 'source', 'entries'],
    'feed.payload'
  )
  if (payloadRecord.schemaVersion !== RACEOPS_FEED_SCHEMA_VERSION) {
    throw new RaceOpsBlueprintError('UNSUPPORTED_VERSION', 'Unsupported feed schema version.')
  }
  if (!Array.isArray(payloadRecord.entries) || payloadRecord.entries.length === 0 || payloadRecord.entries.length > 500) {
    invalid('feed.payload.entries must contain 1-500 entries.')
  }
  const entries = payloadRecord.entries.map((entry, index): RaceOpsBlueprintFeedEntry => {
    const label = `feed.payload.entries[${index}]`
    const entryRecord = asRecord(entry, label)
    exactKeys(entryRecord, ['id', 'version', 'manifestSha256', 'manifest'], label)
    const manifestRecord = asRecord(entryRecord.manifest, `${label}.manifest`)
    if (manifestRecord.schemaVersion !== RACEOPS_BLUEPRINT_SCHEMA_VERSION) {
      throw new RaceOpsBlueprintError(
        'UNSUPPORTED_VERSION',
        `${label}.manifest must use the current blueprint schema.`
      )
    }
    const manifest = parseRaceOpsBlueprintManifest(manifestRecord)
    const id = asSlug(entryRecord.id, `${label}.id`)
    const version = asString(entryRecord.version, `${label}.version`, 64)
    if (id !== manifest.id || version !== manifest.version) invalid(`${label} identity does not match its manifest.`)
    const manifestSha256 = asString(entryRecord.manifestSha256, `${label}.manifestSha256`, 64).toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(manifestSha256)) invalid(`${label}.manifestSha256 is invalid.`)
    return { id, version, manifestSha256, manifest }
  })
  const identityKeys = entries.map((entry) => `${entry.id}@${entry.version}`)
  if (new Set(identityKeys).size !== identityKeys.length) invalid('feed contains duplicate blueprint versions.')

  const signatureRecord = asRecord(envelope.signature, 'feed.signature')
  exactKeys(signatureRecord, ['algorithm', 'keyId', 'value'], 'feed.signature')
  if (signatureRecord.algorithm !== 'ed25519') {
    throw new RaceOpsBlueprintError('UNKNOWN_SIGNATURE', 'Unsupported feed signature algorithm.')
  }
  const signatureValue = asString(signatureRecord.value, 'feed.signature.value', 512)
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signatureValue)) invalid('feed.signature.value is not base64.')

  const issuedAt = asIsoDate(payloadRecord.issuedAt, 'feed.payload.issuedAt')
  const expiresAt = asIsoDate(payloadRecord.expiresAt, 'feed.payload.expiresAt')
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) invalid('feed expiry must be after issue time.')

  return {
    payload: {
      schemaVersion: RACEOPS_FEED_SCHEMA_VERSION,
      feedId: asSlug(payloadRecord.feedId, 'feed.payload.feedId'),
      title: asString(payloadRecord.title, 'feed.payload.title', 120),
      sequence: asInteger(payloadRecord.sequence, 'feed.payload.sequence', 1),
      issuedAt,
      expiresAt,
      source: parseFeedSource(payloadRecord.source, 'feed.payload.source'),
      entries
    },
    signature: {
      algorithm: 'ed25519',
      keyId: asSlug(signatureRecord.keyId, 'feed.signature.keyId'),
      value: signatureValue
    }
  }
}

export function sameRaceOpsFeedSource(
  left: RaceOpsBlueprintFeedSource,
  right: RaceOpsBlueprintFeedSource
): boolean {
  return canonicalJson(left) === canonicalJson(right)
}
