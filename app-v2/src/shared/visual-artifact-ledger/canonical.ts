import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import {
  MAX_CANONICAL_DEPTH,
  MAX_CANONICAL_NODES,
  MAX_IDENTIFIER_LENGTH,
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
  const slug = assertString(value, label, 64)
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

function normalizeCanonical(
  value: unknown,
  budget: { nodes: number },
  depth: number
): JsonValue {
  budget.nodes += 1
  if (budget.nodes > MAX_CANONICAL_NODES) fail('CARDINALITY', 'Canonical value exceeds the node limit.')
  if (depth > MAX_CANONICAL_DEPTH) fail('CARDINALITY', 'Canonical value exceeds the depth limit.')

  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('SCHEMA', 'Canonical values cannot contain non-finite numbers.')
    return value
  }
  if (Array.isArray(value)) {
    const normalized: JsonValue[] = []
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        fail('SCHEMA', 'Canonical arrays cannot be sparse.')
      }
      normalized.push(normalizeCanonical(value[index], budget, depth + 1))
    }
    return normalized
  }
  if (!isPlainObject(value)) fail('SCHEMA', 'Canonical values must contain only JSON-compatible plain objects.')

  const normalized = Object.create(null) as Record<string, JsonValue>
  for (const key of Object.keys(value).sort()) {
    const entry = value[key]
    if (entry === undefined) fail('SCHEMA', `Canonical field "${key}" cannot be undefined.`)
    normalized[key] = normalizeCanonical(entry, budget, depth + 1)
  }
  return normalized
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(normalizeCanonical(value, { nodes: 0 }, 0))
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
