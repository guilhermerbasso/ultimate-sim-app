import type { DashboardElement, DashboardElementStyle } from './dashboards'
import type { ExpressionDef } from './expr'
import { IRACING_VARIABLES } from './iracing-vars'
import {
  isOutputFormat,
  isOutputSource,
  isOutputTarget,
  type OutputRoute,
  type OutputTarget
} from './outputs'

export const EXPRESSION_STUDIO_VERSION = 3 as const

export type ExpressionDestinationSurface = 'dashboard' | 'overlay' | 'oled' | 'touch'
export type ExpressionPresentation = 'value' | 'bar' | 'gauge' | 'status'

export interface ExpressionDestinationGeometry {
  x: number
  y: number
  width: number
  height: number
}

export interface ExpressionDestinationFormat {
  label?: string
  prefix?: string
  suffix?: string
  decimals?: number
  min?: number
  max?: number
  trueText?: string
  falseText?: string
  color?: string
}

export type ExpressionVisualizationSource =
  | { expressionId: string }
  | { variableId: string }

export interface ExpressionDestination {
  id: string
  source: ExpressionVisualizationSource
  surface: ExpressionDestinationSurface
  targetId: string
  presentation: ExpressionPresentation
  geometry: ExpressionDestinationGeometry
  format: ExpressionDestinationFormat
  enabled: boolean
}

export interface ExpressionStudioPayload {
  version: typeof EXPRESSION_STUDIO_VERSION
  revision: number
  expressions: ExpressionDef[]
  enabledVars: string[]
  outputs: OutputRoute[]
  destinations: ExpressionDestination[]
  updatedAt: string
}

export interface ExpressionDestinationTarget {
  id: string
  label: string
  width: number
  height: number
  kind: 'dashboard' | 'custom-overlay' | 'oled-slot' | 'touch-control'
}

export interface ExpressionDestinationCapability {
  surface: ExpressionDestinationSurface
  available: boolean
  reason?: string
  presentations: ExpressionPresentation[]
  targets: ExpressionDestinationTarget[]
}

export type ExpressionDestinationStatusKind = 'ready' | 'disabled' | 'unavailable' | 'unresolved'

export interface ExpressionDestinationStatus {
  destinationId: string
  status: ExpressionDestinationStatusKind
  reason?: string
}

export interface ExpressionStudioSnapshot extends ExpressionStudioPayload {
  capabilities: ExpressionDestinationCapability[]
  destinationStatuses: ExpressionDestinationStatus[]
}

export interface ExpressionStudioMutation {
  revision: number
  expressions: unknown
  enabledVars: unknown
  outputs: unknown
  destinations: unknown
}

export interface ExpressionPlacementRequest {
  surface: 'dashboard' | 'overlay'
  targetId: string
}

export interface ExpressionDestinationPlacement {
  destinationId: string
  element: DashboardElement
}

export interface MigrationResult {
  payload: ExpressionStudioPayload
  migrated: boolean
}

export class ExpressionRevisionConflictError extends Error {
  readonly code = 'EXPRESSION_REVISION_CONFLICT'

  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number
  ) {
    super(`EXPRESSION_REVISION_CONFLICT: expected revision ${expectedRevision}, current revision is ${actualRevision}.`)
    this.name = 'ExpressionRevisionConflictError'
  }
}

const PRESENTATIONS: readonly ExpressionPresentation[] = ['value', 'bar', 'gauge', 'status']
const SURFACES: readonly ExpressionDestinationSurface[] = ['dashboard', 'overlay', 'oled', 'touch']
const MAX_COORD = 16_000
const MIN_SIZE = 8
const MAX_TEXT = 64
const MAX_AFFIX = 24
const HEX_COLOR = /^#[0-9a-f]{6}$/i
const MAPPED_VARIABLE_IDS = new Set(IRACING_VARIABLES.filter((item) => item.telemetryField).map((item) => item.id))
const VARIABLE_BY_ID = new Map(IRACING_VARIABLES.map((item) => [item.id, item]))

export function isMappedIracingVariable(variableId: string): boolean {
  return MAPPED_VARIABLE_IDS.has(variableId)
}

export function unmappedIracingVariableReason(variableId: string): string | undefined {
  const variable = VARIABLE_BY_ID.get(variableId)
  if (!variable) return 'Unknown iRacing Field Catalog variable.'
  if (!variable.telemetryField) {
    return 'Unavailable as a source: this catalog field has no TelemetrySnapshot mapping.'
  }
  return undefined
}

export function emptyExpressionStudioPayload(updatedAt = new Date().toISOString()): ExpressionStudioPayload {
  return {
    version: EXPRESSION_STUDIO_VERSION,
    revision: 0,
    expressions: [],
    enabledVars: [],
    outputs: [],
    destinations: [],
    updatedAt
  }
}

export function migrateExpressionStudioPayload(
  input: unknown,
  options: { imported?: boolean; now?: string } = {}
): MigrationResult {
  const now = options.now ?? new Date().toISOString()
  if (!isRecord(input)) {
    return { payload: emptyExpressionStudioPayload(now), migrated: true }
  }

  const version = finiteInteger(input.version, 1)
  if (version > EXPRESSION_STUDIO_VERSION) {
    throw new Error(`Unsupported Expression Studio store version ${version}.`)
  }
  const expressions = normalizeExpressions(input.expressions)
  const expressionIds = new Set(expressions.map((item) => item.id))
  const enabledVars = normalizeEnabledVars(input.enabledVars, false)
  let outputs: OutputRoute[] = []
  let destinations: ExpressionDestination[] = []
  let migrated = version !== EXPRESSION_STUDIO_VERSION

  if (version >= EXPRESSION_STUDIO_VERSION) {
    outputs = normalizeOutputs(input.outputs, expressionIds)
    destinations = normalizeDestinations(input.destinations, expressions, enabledVars, false)
    const rawEnabled = Array.isArray(input.enabledVars)
      ? input.enabledVars.filter((item): item is string => typeof item === 'string')
      : []
    if (
      !Number.isSafeInteger(input.revision) ||
      !Array.isArray(input.expressions) ||
      !Array.isArray(input.enabledVars) ||
      !Array.isArray(input.outputs) ||
      !Array.isArray(input.destinations) ||
      rawEnabled.length !== enabledVars.length
    ) {
      migrated = true
    }
  } else {
    outputs = migrateLegacyTargets(input.expressions, expressions)
  }

  if (options.imported) {
    outputs = outputs.map((output) => ({ ...output, enabled: false }))
    destinations = destinations.map((destination) => ({ ...destination, enabled: false }))
    migrated = true
  }

  const revision = version >= EXPRESSION_STUDIO_VERSION
    ? Math.max(0, finiteInteger(input.revision, 0))
    : 0
  const updatedAt = typeof input.updatedAt === 'string' && input.updatedAt ? input.updatedAt : now
  return {
    payload: {
      version: EXPRESSION_STUDIO_VERSION,
      revision,
      expressions,
      enabledVars,
      outputs,
      destinations,
      updatedAt
    },
    migrated
  }
}

export function normalizeExpressionStudioMutation(
  input: unknown,
  currentRevision: number,
  now = new Date().toISOString()
): ExpressionStudioPayload {
  if (!isRecord(input)) throw new Error('Invalid Expression Studio mutation.')
  const revision = finiteInteger(input.revision, -1)
  if (revision !== currentRevision) throw new ExpressionRevisionConflictError(revision, currentRevision)
  const expressions = normalizeExpressions(input.expressions)
  const enabledVars = normalizeEnabledVars(input.enabledVars, true)
  const expressionIds = new Set(expressions.map((item) => item.id))
  const outputs = normalizeOutputs(input.outputs, expressionIds)
  const destinations = normalizeDestinations(input.destinations, expressions, enabledVars, true)
  return {
    version: EXPRESSION_STUDIO_VERSION,
    revision: currentRevision + 1,
    expressions,
    enabledVars,
    outputs,
    destinations,
    updatedAt: now
  }
}

export function withExpressionDestinationStatus(
  payload: ExpressionStudioPayload,
  capabilities: ExpressionDestinationCapability[]
): ExpressionStudioSnapshot {
  return {
    ...clonePayload(payload),
    capabilities: capabilities.map(cloneCapability),
    destinationStatuses: payload.destinations.map((destination) => destinationStatus(destination, capabilities))
  }
}

export function destinationStatus(
  destination: ExpressionDestination,
  capabilities: readonly ExpressionDestinationCapability[]
): ExpressionDestinationStatus {
  const capability = capabilities.find((item) => item.surface === destination.surface)
  if (!capability?.available) {
    return {
      destinationId: destination.id,
      status: 'unavailable',
      reason: capability?.reason ?? `The ${destination.surface} destination is unavailable.`
    }
  }
  const target = capability.targets.find((item) => item.id === destination.targetId)
  if (!target) {
    return {
      destinationId: destination.id,
      status: 'unresolved',
      reason: `Exact ${destination.surface} target "${destination.targetId}" is missing.`
    }
  }
  if (!capability.presentations.includes(destination.presentation)) {
    return {
      destinationId: destination.id,
      status: 'unavailable',
      reason: `${destination.presentation} is not supported on ${destination.surface}.`
    }
  }
  if (
    destination.geometry.x + destination.geometry.width > target.width ||
    destination.geometry.y + destination.geometry.height > target.height
  ) {
    return {
      destinationId: destination.id,
      status: 'unresolved',
      reason: `Placement exceeds exact target bounds (${target.width}×${target.height}).`
    }
  }
  if (!destination.enabled) {
    return { destinationId: destination.id, status: 'disabled', reason: 'Destination is disabled.' }
  }
  return { destinationId: destination.id, status: 'ready' }
}

export function validateExpressionDestinationsForCapabilities(
  payload: ExpressionStudioPayload,
  capabilities: readonly ExpressionDestinationCapability[]
): void {
  for (const destination of payload.destinations) {
    const capability = capabilities.find((item) => item.surface === destination.surface)
    if (destination.enabled && !capability?.available) {
      throw new Error(capability?.reason ?? `The ${destination.surface} destination is unavailable.`)
    }
    const target = capability?.targets.find((item) => item.id === destination.targetId)
    // Missing targets are preserved as unresolved so imports never guess a
    // replacement by name or position.
    if (!target) continue
    if (!capability?.presentations.includes(destination.presentation)) {
      throw new Error(`${destination.presentation} is not supported on ${destination.surface}.`)
    }
    if (
      destination.geometry.x + destination.geometry.width > target.width ||
      destination.geometry.y + destination.geometry.height > target.height
    ) {
      throw new Error(
        `Destination "${destination.id}" exceeds target "${target.id}" bounds (${target.width}×${target.height}).`
      )
    }
  }
}

export function sourceBinding(source: ExpressionVisualizationSource): string {
  if ('expressionId' in source) return `expr:#${source.expressionId}`
  return `ir:${source.variableId}`
}

export function sourceDisplayName(
  source: ExpressionVisualizationSource,
  expressions: readonly ExpressionDef[]
): string {
  if ('expressionId' in source) {
    return expressions.find((item) => item.id === source.expressionId)?.name ?? source.expressionId
  }
  return VARIABLE_BY_ID.get(source.variableId)?.label ?? source.variableId
}

export function destinationToDashboardElement(
  destination: ExpressionDestination,
  expressions: readonly ExpressionDef[]
): DashboardElement {
  const type = destination.presentation === 'value'
    ? 'value'
    : destination.presentation === 'bar'
      ? 'valuebar'
      : destination.presentation === 'gauge'
        ? 'valuegauge'
        : 'statuslamp'
  const format = destination.format
  const style: DashboardElementStyle = {
    label: format.label ?? sourceDisplayName(destination.source, expressions),
    prefix: format.prefix,
    suffix: format.suffix,
    decimals: format.decimals,
    gaugeMin: format.min,
    gaugeMax: format.max,
    accentColor: format.color,
    fillColor: format.color,
    statusOnText: format.trueText,
    statusOffText: format.falseText,
    background: 'transparent',
    borderWidth: 0,
    radius: 0
  }
  return {
    id: `expr-dest:${destination.id}`,
    type,
    x: destination.geometry.x,
    y: destination.geometry.y,
    w: destination.geometry.width,
    h: destination.geometry.height,
    binding: sourceBinding(destination.source),
    name: style.label,
    style
  }
}

export function resolveExpressionDestinationPlacements(
  payload: ExpressionStudioPayload,
  capabilities: readonly ExpressionDestinationCapability[],
  request: ExpressionPlacementRequest
): ExpressionDestinationPlacement[] {
  return payload.destinations
    .filter((destination) =>
      destination.surface === request.surface &&
      destination.targetId === request.targetId &&
      destinationStatus(destination, capabilities).status === 'ready'
    )
    .map((destination) => ({
      destinationId: destination.id,
      element: destinationToDashboardElement(destination, payload.expressions)
    }))
}

export function clonePayload(payload: ExpressionStudioPayload): ExpressionStudioPayload {
  return {
    ...payload,
    expressions: payload.expressions.map((item) => ({ ...item })),
    enabledVars: [...payload.enabledVars],
    outputs: payload.outputs.map(cloneOutput),
    destinations: payload.destinations.map((destination) => ({
      ...destination,
      source: { ...destination.source },
      geometry: { ...destination.geometry },
      format: { ...destination.format }
    }))
  }
}

function normalizeExpressions(input: unknown): ExpressionDef[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  return input.map((value, index) => {
    if (!isRecord(value)) throw new Error(`Expression #${index + 1} invalid: payload is not an object.`)
    const id = requiredString(value.id, `Expression #${index + 1}: missing id.`)
    if (seen.has(id)) throw new Error(`Expression #${index + 1}: duplicate id "${id}".`)
    seen.add(id)
    const name = requiredString(value.name, `Expression #${index + 1}: missing name.`)
    if (typeof value.expr !== 'string' || !value.expr.trim()) {
      throw new Error(`Expression #${index + 1}: missing formula.`)
    }
    return { id, name, expr: value.expr }
  })
}

function normalizeEnabledVars(input: unknown, strict: boolean): string[] {
  if (!Array.isArray(input)) {
    if (strict) throw new Error('Invalid enabled iRacing variable list.')
    return []
  }
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of input) {
    if (typeof value !== 'string' || !value.trim()) {
      if (strict) throw new Error('Invalid enabled iRacing variable.')
      continue
    }
    const id = value.trim()
    if (!isMappedIracingVariable(id)) {
      if (strict) throw new Error(unmappedIracingVariableReason(id) ?? `Variable "${id}" is not mapped.`)
      continue
    }
    if (!seen.has(id)) {
      seen.add(id)
      result.push(id)
    }
  }
  return result
}

function normalizeOutputs(input: unknown, expressionIds: ReadonlySet<string>): OutputRoute[] {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) throw new Error('Invalid expression output list.')
  const seen = new Set<string>()
  return input.map((value, index) => {
    if (!isRecord(value)) throw new Error(`Output #${index + 1} invalid: payload is not an object.`)
    const id = requiredString(value.id, `Output #${index + 1}: missing id.`)
    if (seen.has(id)) throw new Error(`Output #${index + 1}: duplicate id "${id}".`)
    seen.add(id)
    if (!isOutputSource(value.source) || value.source.kind !== 'expression' || !expressionIds.has(value.source.exprId)) {
      throw new Error(`Output #${index + 1} (${id}): source must reference an existing expression id.`)
    }
    if (!isOutputTarget(value.target)) throw new Error(`Output #${index + 1} (${id}): invalid target.`)
    if (value.format !== undefined && !isOutputFormat(value.format)) {
      throw new Error(`Output #${index + 1} (${id}): invalid format.`)
    }
    return {
      id,
      name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : id,
      enabled: value.enabled === undefined ? true : value.enabled === true,
      source: { ...value.source },
      target: cloneTarget(value.target),
      format: value.format ? { ...value.format } : undefined,
      updatedAt: typeof value.updatedAt === 'string' && value.updatedAt ? value.updatedAt : new Date().toISOString()
    }
  })
}

function normalizeDestinations(
  input: unknown,
  expressions: readonly ExpressionDef[],
  enabledVars: readonly string[],
  strict: boolean
): ExpressionDestination[] {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) {
    if (strict) throw new Error('Invalid expression destination list.')
    return []
  }
  const expressionIds = new Set(expressions.map((item) => item.id))
  const enabled = new Set(enabledVars)
  const seen = new Set<string>()
  return input.map((value, index) => {
    if (!isRecord(value)) throw new Error(`Destination #${index + 1} invalid: payload is not an object.`)
    const id = requiredString(value.id, `Destination #${index + 1}: missing id.`)
    if (seen.has(id)) throw new Error(`Destination #${index + 1}: duplicate id "${id}".`)
    seen.add(id)
    const source = normalizeSource(value.source, expressionIds, enabled, index, strict)
    const surface = requiredEnum(value.surface, SURFACES, `Destination #${index + 1}: unsupported surface.`)
    const targetId = requiredString(value.targetId, `Destination #${index + 1}: missing exact target id.`)
    const presentation = requiredEnum(
      value.presentation,
      PRESENTATIONS,
      `Destination #${index + 1}: unsupported presentation.`
    )
    const geometry = normalizeGeometry(value.geometry, index)
    const format = normalizeFormat(value.format, presentation, index)
    return {
      id,
      source,
      surface,
      targetId,
      presentation,
      geometry,
      format,
      enabled: value.enabled === undefined ? true : value.enabled === true
    }
  })
}

function normalizeSource(
  value: unknown,
  expressionIds: ReadonlySet<string>,
  enabledVars: ReadonlySet<string>,
  index: number,
  requireEnabledVariable: boolean
): ExpressionVisualizationSource {
  if (!isRecord(value)) throw new Error(`Destination #${index + 1}: invalid source.`)
  const keys = Object.keys(value)
  if (keys.length !== 1) {
    throw new Error(`Destination #${index + 1}: source must be exactly {expressionId} or {variableId}.`)
  }
  if (keys[0] === 'expressionId') {
    const expressionId = requiredString(value.expressionId, `Destination #${index + 1}: missing expressionId.`)
    if (!expressionIds.has(expressionId)) {
      throw new Error(`Destination #${index + 1}: unknown expressionId "${expressionId}".`)
    }
    return { expressionId }
  }
  if (keys[0] === 'variableId') {
    const variableId = requiredString(value.variableId, `Destination #${index + 1}: missing variableId.`)
    const reason = unmappedIracingVariableReason(variableId)
    if (reason) throw new Error(`Destination #${index + 1}: ${reason}`)
    if (requireEnabledVariable && !enabledVars.has(variableId)) {
      throw new Error(`Destination #${index + 1}: variable "${variableId}" is not enabled as a source.`)
    }
    return { variableId }
  }
  throw new Error(`Destination #${index + 1}: source must be exactly {expressionId} or {variableId}.`)
}

function normalizeGeometry(value: unknown, index: number): ExpressionDestinationGeometry {
  if (!isRecord(value)) throw new Error(`Destination #${index + 1}: invalid geometry.`)
  const x = boundedNumber(value.x, 0, MAX_COORD, `Destination #${index + 1}: invalid x.`)
  const y = boundedNumber(value.y, 0, MAX_COORD, `Destination #${index + 1}: invalid y.`)
  const width = boundedNumber(value.width, MIN_SIZE, MAX_COORD, `Destination #${index + 1}: invalid width.`)
  const height = boundedNumber(value.height, MIN_SIZE, MAX_COORD, `Destination #${index + 1}: invalid height.`)
  if (x + width > MAX_COORD || y + height > MAX_COORD) {
    throw new Error(`Destination #${index + 1}: geometry exceeds the supported canvas limit.`)
  }
  return { x, y, width, height }
}

function normalizeFormat(
  value: unknown,
  presentation: ExpressionPresentation,
  index: number
): ExpressionDestinationFormat {
  if (value === undefined || value === null) value = {}
  if (!isRecord(value)) throw new Error(`Destination #${index + 1}: invalid format.`)
  const format: ExpressionDestinationFormat = {}
  copyOptionalText(value, 'label', format, MAX_TEXT, index)
  copyOptionalText(value, 'prefix', format, MAX_AFFIX, index)
  copyOptionalText(value, 'suffix', format, MAX_AFFIX, index)
  copyOptionalText(value, 'trueText', format, MAX_AFFIX, index)
  copyOptionalText(value, 'falseText', format, MAX_AFFIX, index)
  if (value.color !== undefined) {
    if (typeof value.color !== 'string' || !HEX_COLOR.test(value.color)) {
      throw new Error(`Destination #${index + 1}: color must be a six-digit hex color.`)
    }
    format.color = value.color
  }
  if (value.decimals !== undefined) {
    const decimals = finiteInteger(value.decimals, -1)
    if (decimals < 0 || decimals > 6) {
      throw new Error(`Destination #${index + 1}: decimals must be an integer from 0 to 6.`)
    }
    format.decimals = decimals
  }
  if (value.min !== undefined) format.min = finiteNumber(value.min, `Destination #${index + 1}: invalid minimum.`)
  if (value.max !== undefined) format.max = finiteNumber(value.max, `Destination #${index + 1}: invalid maximum.`)

  if (presentation === 'bar' || presentation === 'gauge') {
    if (format.min === undefined || format.max === undefined || format.min >= format.max) {
      throw new Error(`Destination #${index + 1}: ${presentation} requires finite min < max.`)
    }
    if (format.trueText !== undefined || format.falseText !== undefined) {
      throw new Error(`Destination #${index + 1}: ${presentation} does not support status text.`)
    }
  } else if (presentation === 'status') {
    if (
      format.min !== undefined ||
      format.max !== undefined ||
      format.decimals !== undefined ||
      format.prefix !== undefined ||
      format.suffix !== undefined
    ) {
      throw new Error(`Destination #${index + 1}: status only supports label, true/false text, and color.`)
    }
  } else if (
    format.min !== undefined ||
    format.max !== undefined ||
    format.trueText !== undefined ||
    format.falseText !== undefined
  ) {
    throw new Error(`Destination #${index + 1}: value presentation has incompatible format fields.`)
  }
  return format
}

function migrateLegacyTargets(rawExpressions: unknown, expressions: readonly ExpressionDef[]): OutputRoute[] {
  if (!Array.isArray(rawExpressions)) return []
  const normalizedById = new Map(expressions.map((item) => [item.id, item]))
  const outputs: OutputRoute[] = []
  const usedIds = new Set<string>()
  rawExpressions.forEach((raw) => {
    if (!isRecord(raw) || typeof raw.id !== 'string') return
    const expression = normalizedById.get(raw.id.trim())
    if (!expression || !Array.isArray(raw.targets)) return
    raw.targets.forEach((target, index) => {
      if (!isOutputTarget(target)) return
      const baseId = `expr:${expression.id}:${target.kind}`
      let id = baseId
      let duplicate = 2
      while (usedIds.has(id)) {
        id = `${baseId}:${duplicate}`
        duplicate += 1
      }
      usedIds.add(id)
      outputs.push({
        id,
        name: expression.name,
        enabled: true,
        source: { kind: 'expression', exprId: expression.id },
        target: cloneTarget(target),
        updatedAt: new Date().toISOString()
      })
    })
  })
  return outputs
}

function cloneCapability(capability: ExpressionDestinationCapability): ExpressionDestinationCapability {
  return {
    ...capability,
    presentations: [...capability.presentations],
    targets: capability.targets.map((target) => ({ ...target }))
  }
}

function cloneOutput(output: OutputRoute): OutputRoute {
  return {
    ...output,
    source: { ...output.source },
    target: cloneTarget(output.target),
    format: output.format ? { ...output.format } : undefined
  }
}

function cloneTarget(target: OutputTarget): OutputTarget {
  return { ...target } as OutputTarget
}

function copyOptionalText(
  source: Record<string, unknown>,
  key: keyof Pick<ExpressionDestinationFormat, 'label' | 'prefix' | 'suffix' | 'trueText' | 'falseText'>,
  destination: ExpressionDestinationFormat,
  maxLength: number,
  index: number
): void {
  const value = source[key]
  if (value === undefined) return
  if (typeof value !== 'string' || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Destination #${index + 1}: ${key} must be at most ${maxLength} characters.`)
  }
  if (value) destination[key] = value
}

function requiredEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  message: string
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(message)
  return value as T
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message)
  return value.trim()
}

function finiteNumber(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(message)
  return value
}

function boundedNumber(value: unknown, min: number, max: number, message: string): number {
  const number = finiteNumber(value, message)
  if (number < min || number > max) throw new Error(message)
  return number
}

function finiteInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
