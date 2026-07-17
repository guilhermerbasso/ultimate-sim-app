import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import {
  MAX_CANONICAL_DEPTH,
  MAX_CANONICAL_NODES,
  MAX_IDENTIFIER_LENGTH,
  MAX_PLAN_ID_LENGTH,
  MAX_SERIALIZED_BYTES,
  MAX_SERIALIZED_CHARACTERS,
  MAX_STRING_LENGTH
} from './constants'
import { fail } from './errors'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) fail('SCHEMA', `${label} must be a plain object.`)
}

export function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void {
  const expectedSet = new Set(expected)
  const actual = Object.keys(value)
  for (const key of actual) {
    if (!expectedSet.has(key)) fail('SCHEMA', `${label} contains unknown field "${key}".`)
  }
  for (const key of expected) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      fail('SCHEMA', `${label} is missing required field "${key}".`)
    }
  }
}

export function assertOptionalExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string
): void {
  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail('SCHEMA', `${label} contains unknown field "${key}".`)
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      fail('SCHEMA', `${label} is missing required field "${key}".`)
    }
  }
}

export function assertString(
  value: unknown,
  label: string,
  maxLength: number = MAX_STRING_LENGTH
): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength) {
    fail('SCHEMA', `${label} must be a non-empty string of at most ${maxLength} characters.`)
  }
  if (/[\u0000-\u001f\u007f]/u.test(value)) fail('SCHEMA', `${label} contains control characters.`)
  return value
}

const SAFE_IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:@-]*$/
const FORBIDDEN_URI_SCHEME =
  /(?:https?|ftp|ftps|file|data|mailto|ssh|s3|azure|ws|wss):/i
const SECRET_SHAPE =
  /(?:^|[:._@-])(?:sk-|gh[pousr]_|github_pat_|xox[a-z]-|akia[0-9a-z]{8,}|aiza[0-9a-z_-]{8,}|eyj[a-z0-9_-]*\.)/i

export function assertIdentifier(value: unknown, label: string): string {
  const identifier = assertString(value, label, MAX_IDENTIFIER_LENGTH)
  if (!SAFE_IDENTIFIER.test(identifier)) {
    fail('SCHEMA', `${label} must contain only safe identifier characters.`)
  }
  if (
    FORBIDDEN_URI_SCHEME.test(identifier) ||
    SECRET_SHAPE.test(identifier) ||
    /credential|password|secret|token|api[-_]?key|process\.env/i.test(identifier)
  ) {
    fail('SCHEMA', `${label} contains forbidden URL, credential, or environment-secret material.`)
  }
  return identifier
}

export function assertSlug(value: unknown, label: string): string {
  const slug = assertString(value, label, MAX_PLAN_ID_LENGTH)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    fail('SCHEMA', `${label} must be a lowercase slug.`)
  }
  return slug
}

export function assertSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    fail('SCHEMA', `${label} must be a lowercase SHA-256 hex digest.`)
  }
  return value
}

export function assertIsoTimestamp(value: unknown, label: string): string {
  const timestamp = assertString(value, label, 32)
  const milliseconds = Date.parse(timestamp)
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== timestamp) {
    fail('SCHEMA', `${label} must be a canonical UTC ISO-8601 timestamp.`)
  }
  return timestamp
}

export function assertSafeInteger(
  value: unknown,
  label: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail('SCHEMA', `${label} must be a safe integer from ${minimum} through ${maximum}.`)
  }
  return value as number
}

export function assertNullableIdentifier(value: unknown, label: string): string | null {
  return value === null ? null : assertIdentifier(value, label)
}

export function assertNullableSafeInteger(
  value: unknown,
  label: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER
): number | null {
  return value === null ? null : assertSafeInteger(value, label, minimum, maximum)
}

interface CanonicalBudget {
  nodes: number
  characters: number
  bytes: number
}

function addCanonicalBudget(
  budget: CanonicalBudget,
  characters: number,
  bytes = characters
): void {
  budget.characters += characters
  budget.bytes += bytes
  assertSerializedLengthsWithinRuntimeCeiling(
    budget.characters,
    budget.bytes,
    'Canonical JSON'
  )
}

function addCanonicalStringBudget(value: string, budget: CanonicalBudget): void {
  let characters = 2
  let bytes = 2
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x09 ||
        code === 0x0a || code === 0x0c || code === 0x0d) {
      characters += 2
      bytes += 2
    } else if (code <= 0x1f || code === 0x2028 || code === 0x2029) {
      characters += 6
      bytes += 6
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        fail('SCHEMA', 'Canonical strings cannot contain unpaired UTF-16 surrogates.')
      }
      characters += 2
      bytes += 4
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail('SCHEMA', 'Canonical strings cannot contain unpaired UTF-16 surrogates.')
    } else if (code <= 0x7f) {
      characters += 1
      bytes += 1
    } else if (code <= 0x7ff) {
      characters += 1
      bytes += 2
    } else {
      characters += 1
      bytes += 3
    }
  }
  addCanonicalBudget(budget, characters, bytes)
}

function normalizeCanonical(
  value: unknown,
  budget: CanonicalBudget,
  depth: number
): JsonValue {
  budget.nodes += 1
  if (budget.nodes > MAX_CANONICAL_NODES) fail('CARDINALITY', 'Canonical value exceeds the node limit.')
  if (depth > MAX_CANONICAL_DEPTH) fail('CARDINALITY', 'Canonical value exceeds the depth limit.')

  if (value === null) {
    addCanonicalBudget(budget, 4)
    return value
  }
  if (typeof value === 'boolean') {
    addCanonicalBudget(budget, value ? 4 : 5)
    return value
  }
  if (typeof value === 'string') {
    addCanonicalStringBudget(value, budget)
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('SCHEMA', 'Canonical values cannot contain non-finite numbers.')
    addCanonicalBudget(budget, JSON.stringify(value).length)
    return value
  }
  if (Array.isArray(value)) {
    const normalized: JsonValue[] = []
    addCanonicalBudget(budget, 2)
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        fail('SCHEMA', 'Canonical arrays cannot be sparse.')
      }
      if (index > 0) addCanonicalBudget(budget, 1)
      normalized.push(normalizeCanonical(value[index], budget, depth + 1))
    }
    return normalized
  }
  if (!isPlainObject(value)) fail('SCHEMA', 'Canonical values must contain only JSON-compatible plain objects.')

  const normalized = Object.create(null) as Record<string, JsonValue>
  addCanonicalBudget(budget, 2)
  const keys = Object.keys(value).sort()
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]
    if (index > 0) addCanonicalBudget(budget, 1)
    addCanonicalStringBudget(key, budget)
    addCanonicalBudget(budget, 1)
    const entry = value[key]
    if (entry === undefined) fail('SCHEMA', `Canonical field "${key}" cannot be undefined.`)
    normalized[key] = normalizeCanonical(entry, budget, depth + 1)
  }
  return normalized
}

export function canonicalStringify(value: unknown): string {
  const normalized = normalizeCanonical(
    value,
    { nodes: 0, characters: 0, bytes: 0 },
    0
  )
  const serialized = JSON.stringify(normalized)
  assertSerializedTextWithinRuntimeCeiling(serialized, 'Canonical JSON')
  return serialized
}

export function sha256Hex(value: unknown): string {
  return createHash('sha256').update(canonicalStringify(value), 'utf8').digest('hex')
}

export function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

export function assertSerializedLengthsWithinRuntimeCeiling(
  characterLength: number,
  utf8Bytes: number,
  label: string
): void {
  if (
    !Number.isSafeInteger(characterLength) ||
    !Number.isSafeInteger(utf8Bytes) ||
    characterLength < 0 ||
    utf8Bytes < 0 ||
    characterLength > MAX_SERIALIZED_CHARACTERS ||
    utf8Bytes > MAX_SERIALIZED_BYTES
  ) {
    fail(
      'CARDINALITY',
      `${label} exceeds the runtime-safe single-string ceiling of ${MAX_SERIALIZED_CHARACTERS} characters.`
    )
  }
}

export function assertSerializedTextWithinRuntimeCeiling(
  value: unknown,
  label: string
): asserts value is string {
  if (typeof value !== 'string') fail('SCHEMA', `${label} must be a string.`)
  assertSerializedLengthsWithinRuntimeCeiling(value.length, utf8ByteLength(value), label)
}

export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return value
}

export function cloneCanonical<T>(value: T): T {
  return JSON.parse(canonicalStringify(value)) as T
}

export function compareIso(left: string, right: string): number {
  return Date.parse(left) - Date.parse(right)
}
