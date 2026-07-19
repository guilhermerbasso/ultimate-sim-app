import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { types as utilTypes } from 'node:util'
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

const INTRINSIC_ARRAY_IS_ARRAY = Array.isArray
const INTRINSIC_ARRAY_JOIN = Array.prototype.join
const INTRINSIC_ARRAY_SORT = Array.prototype.sort
const INTRINSIC_ARRAY_PROTOTYPE = Array.prototype
const INTRINSIC_APPLY = Reflect.apply
const INTRINSIC_BUFFER_BYTE_LENGTH = Buffer.byteLength
const INTRINSIC_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor
const INTRINSIC_GET_PROTOTYPE_OF = Object.getPrototypeOf
const INTRINSIC_IS_FROZEN = Object.isFrozen
const INTRINSIC_FREEZE = Object.freeze
const INTRINSIC_OBJECT_CREATE = Object.create
const INTRINSIC_OBJECT_PROTOTYPE = Object.prototype
const INTRINSIC_SET_PROTOTYPE_OF = Object.setPrototypeOf
const INTRINSIC_JSON_PARSE = JSON.parse
const INTRINSIC_JSON_STRINGIFY = JSON.stringify
const INTRINSIC_NUMBER_IS_FINITE = Number.isFinite
const INTRINSIC_NUMBER_IS_SAFE_INTEGER = Number.isSafeInteger
const INTRINSIC_OWN_KEYS = Reflect.ownKeys
const INTRINSIC_SET = Set
const INTRINSIC_IS_PROXY = utilTypes.isProxy
const CANONICAL_ARRAY_INDEX = /^(0|[1-9]\d*)$/
const INTRINSIC_REGEXP_TEST = Function.prototype.call.bind(
  RegExp.prototype.test
) as (expression: RegExp, value: string) => boolean
const INTRINSIC_SET_ADD = Function.prototype.call.bind(
  Set.prototype.add
) as (target: Set<string>, value: string) => Set<string>
const INTRINSIC_SET_HAS = Function.prototype.call.bind(
  Set.prototype.has
) as (target: Set<string>, value: string) => boolean
const INTRINSIC_STRING_CHAR_CODE_AT = Function.prototype.call.bind(
  String.prototype.charCodeAt
) as (value: string, index: number) => number

function arrayDataValue<T>(
  values: readonly T[],
  index: number,
  _label: string
): T {
  return values[index]
}

function appendArrayData<T>(values: T[], value: T): void {
  values[values.length] = value
}

function createInternalArray<T>(): T[] {
  const values: T[] = []
  INTRINSIC_SET_PROTOTYPE_OF(values, null)
  return values
}

function addStringsToSet(
  target: Set<string>,
  values: readonly string[]
): void {
  for (let index = 0; index < values.length; index += 1) {
    INTRINSIC_SET_ADD(
      target,
      arrayDataValue(values, index, 'Trusted key list entry')
    )
  }
}

function safeOwnKeys(value: object, label: string): readonly PropertyKey[] {
  if (INTRINSIC_IS_PROXY(value)) fail('SCHEMA', `${label} cannot be a Proxy.`)
  try {
    return INTRINSIC_OWN_KEYS(value)
  } catch {
    fail('SCHEMA', `${label} own fields cannot be inspected safely.`)
  }
}

function ownDataDescriptor(
  value: object,
  key: PropertyKey,
  label: string,
  requireEnumerable = true
): PropertyDescriptor {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = INTRINSIC_GET_OWN_PROPERTY_DESCRIPTOR(value, key)
  } catch {
    fail('SCHEMA', `${label} cannot be inspected safely.`)
  }
  if (
    !descriptor ||
    !('value' in descriptor) ||
    (requireEnumerable && !descriptor.enumerable)
  ) {
    fail('SCHEMA', `${label} must be an own enumerable data field.`)
  }
  return descriptor
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    INTRINSIC_IS_PROXY(value) ||
    INTRINSIC_ARRAY_IS_ARRAY(value)
  ) {
    return false
  }
  try {
    const prototype = INTRINSIC_GET_PROTOTYPE_OF(value)
    if (prototype !== INTRINSIC_OBJECT_PROTOTYPE && prototype !== null) return false
    const keys = INTRINSIC_OWN_KEYS(value)
    for (let index = 0; index < keys.length; index += 1) {
      const key = arrayDataValue(keys, index, 'Plain object key')
      if (typeof key !== 'string') return false
      const descriptor = INTRINSIC_GET_OWN_PROPERTY_DESCRIPTOR(value, key)
      if (!descriptor?.enumerable || !('value' in descriptor)) return false
    }
    return true
  } catch {
    return false
  }
}

export function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) fail('SCHEMA', `${label} must be a plain object.`)
}

export function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void {
  const expectedSet = new INTRINSIC_SET<string>()
  addStringsToSet(expectedSet, expected)
  const actual = safeOwnKeys(value, label)
  for (let index = 0; index < actual.length; index += 1) {
    const key = arrayDataValue(actual, index, `${label} key`)
    if (typeof key !== 'string') fail('SCHEMA', `${label} contains a symbol field.`)
    if (!INTRINSIC_SET_HAS(expectedSet, key)) {
      fail('SCHEMA', `${label} contains unknown field "${key}".`)
    }
  }
  for (let index = 0; index < expected.length; index += 1) {
    const key = arrayDataValue(expected, index, `${label} expected key`)
    if (!INTRINSIC_GET_OWN_PROPERTY_DESCRIPTOR(value, key)) {
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
  const allowed = new INTRINSIC_SET<string>()
  addStringsToSet(allowed, required)
  addStringsToSet(allowed, optional)
  const actual = safeOwnKeys(value, label)
  for (let index = 0; index < actual.length; index += 1) {
    const key = arrayDataValue(actual, index, `${label} key`)
    if (typeof key !== 'string') fail('SCHEMA', `${label} contains a symbol field.`)
    if (!INTRINSIC_SET_HAS(allowed, key)) {
      fail('SCHEMA', `${label} contains unknown field "${key}".`)
    }
  }
  for (let index = 0; index < required.length; index += 1) {
    const key = arrayDataValue(required, index, `${label} required key`)
    if (!INTRINSIC_GET_OWN_PROPERTY_DESCRIPTOR(value, key)) {
      fail('SCHEMA', `${label} is missing required field "${key}".`)
    }
  }
}

export function ownDataValue(
  value: Record<string, unknown>,
  key: string,
  label: string
): unknown {
  if (INTRINSIC_IS_PROXY(value)) fail('SCHEMA', `${label} cannot be a Proxy.`)
  return ownDataDescriptor(value, key, label).value
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
    const code = INTRINSIC_STRING_CHAR_CODE_AT(value, index)
    if (
      code === 0x22 ||
      code === 0x5c ||
      code === 0x08 ||
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0c ||
      code === 0x0d
    ) {
      characters += 2
      bytes += 2
    } else if (code <= 0x1f || code === 0x2028 || code === 0x2029) {
      characters += 6
      bytes += 6
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = INTRINSIC_STRING_CHAR_CODE_AT(value, index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        fail(
          'SCHEMA',
          'Canonical strings cannot contain unpaired UTF-16 surrogates.'
        )
      }
      characters += 2
      bytes += 4
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail(
        'SCHEMA',
        'Canonical strings cannot contain unpaired UTF-16 surrogates.'
      )
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
    if (!INTRINSIC_NUMBER_IS_FINITE(value)) fail('SCHEMA', 'Canonical values cannot contain non-finite numbers.')
    addCanonicalBudget(budget, INTRINSIC_JSON_STRINGIFY(value).length)
    return value
  }
  if (typeof value === 'object' && value !== null && INTRINSIC_IS_PROXY(value)) {
    fail('SCHEMA', 'Canonical values cannot contain Proxies.')
  }
  if (INTRINSIC_ARRAY_IS_ARRAY(value)) {
    if (INTRINSIC_GET_PROTOTYPE_OF(value) !== INTRINSIC_ARRAY_PROTOTYPE) {
      fail('SCHEMA', 'Canonical arrays must use the standard Array prototype.')
    }
    const lengthDescriptor = ownDataDescriptor(value, 'length', 'Canonical array length', false)
    const length = lengthDescriptor.value
    if (!INTRINSIC_NUMBER_IS_SAFE_INTEGER(length) || length < 0) {
      fail('SCHEMA', 'Canonical array length is invalid.')
    }
    const keys = INTRINSIC_OWN_KEYS(value)
    for (let index = 0; index < keys.length; index += 1) {
      const key = arrayDataValue(keys, index, 'Canonical array key')
      if (typeof key !== 'string') fail('SCHEMA', 'Canonical arrays cannot contain symbol fields.')
      if (key === 'length') continue
      if (
        !INTRINSIC_REGEXP_TEST(CANONICAL_ARRAY_INDEX, key) ||
        Number(key) >= length
      ) {
        fail('SCHEMA', 'Canonical arrays cannot contain custom fields.')
      }
    }
    const normalized = createInternalArray<JsonValue>()
    addCanonicalBudget(budget, 2)
    for (let index = 0; index < length; index += 1) {
      const descriptor = INTRINSIC_GET_OWN_PROPERTY_DESCRIPTOR(value, String(index))
      if (!descriptor) fail('SCHEMA', 'Canonical arrays cannot be sparse.')
      if (!descriptor.enumerable || !('value' in descriptor)) {
        fail('SCHEMA', 'Canonical array entries must be own enumerable data fields.')
      }
      if (index > 0) addCanonicalBudget(budget, 1)
      appendArrayData(
        normalized,
        normalizeCanonical(descriptor.value, budget, depth + 1)
      )
    }
    return normalized
  }
  if (typeof value !== 'object' || value === null) {
    fail(
      'SCHEMA',
      'Canonical values must contain only JSON-compatible plain objects.'
    )
  }
  const prototype = INTRINSIC_GET_PROTOTYPE_OF(value)
  if (prototype !== INTRINSIC_OBJECT_PROTOTYPE && prototype !== null) {
    fail(
      'SCHEMA',
      'Canonical values must contain only JSON-compatible plain objects.'
    )
  }

  const normalized = INTRINSIC_OBJECT_CREATE(null) as Record<string, JsonValue>
  addCanonicalBudget(budget, 2)
  const keys = INTRINSIC_OWN_KEYS(value)
  const sortedKeys = createInternalArray<string>()
  for (let index = 0; index < keys.length; index += 1) {
    const key = arrayDataValue(keys, index, 'Canonical object key')
    if (typeof key !== 'string') {
      fail('SCHEMA', 'Canonical objects cannot contain symbol fields.')
    }
    appendArrayData(
      sortedKeys,
      key
    )
  }
  INTRINSIC_APPLY(INTRINSIC_ARRAY_SORT, sortedKeys, [])
  for (let index = 0; index < sortedKeys.length; index += 1) {
    const key = arrayDataValue(sortedKeys, index, 'Sorted canonical object key')
    if (index > 0) addCanonicalBudget(budget, 1)
    addCanonicalStringBudget(key, budget)
    addCanonicalBudget(budget, 1)
    const entry = ownDataDescriptor(value, key, `Canonical field "${key}"`).value
    if (entry === undefined) fail('SCHEMA', `Canonical field "${key}" cannot be undefined.`)
    normalized[key] = normalizeCanonical(entry, budget, depth + 1)
  }
  return normalized
}

function encodeCanonical(value: JsonValue): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string' || typeof value === 'number') {
    return INTRINSIC_JSON_STRINGIFY(value)
  }
  if (INTRINSIC_ARRAY_IS_ARRAY(value)) {
    const entries = createInternalArray<string>()
    for (let index = 0; index < value.length; index += 1) {
      appendArrayData(
        entries,
        encodeCanonical(value[index])
      )
    }
    return `[${INTRINSIC_APPLY(INTRINSIC_ARRAY_JOIN, entries, [','])}]`
  }
  const keys = INTRINSIC_OWN_KEYS(value) as readonly string[]
  const objectValue = value as { readonly [key: string]: JsonValue }
  const fields = createInternalArray<string>()
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]
    const entry = objectValue[key]
    appendArrayData(
      fields,
      `${INTRINSIC_JSON_STRINGIFY(key)}:${encodeCanonical(entry)}`
    )
  }
  return `{${INTRINSIC_APPLY(INTRINSIC_ARRAY_JOIN, fields, [','])}}`
}

export function canonicalStringify(value: unknown): string {
  const normalized = normalizeCanonical(
    value,
    { nodes: 0, characters: 0, bytes: 0 },
    0
  )
  const serialized = encodeCanonical(normalized)
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
  return INTRINSIC_BUFFER_BYTE_LENGTH(value, 'utf8')
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
  if (typeof value !== 'object' || value === null) return value
  if (INTRINSIC_IS_PROXY(value)) fail('SCHEMA', 'Cannot freeze a Proxy-backed value.')
  if (INTRINSIC_IS_FROZEN(value)) return value
  INTRINSIC_FREEZE(value)
  const keys = INTRINSIC_OWN_KEYS(value)
  for (let index = 0; index < keys.length; index += 1) {
    const key = arrayDataValue(keys, index, 'Frozen value key')
    const descriptor = INTRINSIC_GET_OWN_PROPERTY_DESCRIPTOR(value, key)
    if (descriptor && 'value' in descriptor) deepFreeze(descriptor.value)
  }
  return value
}

export function cloneCanonical<T>(value: T): T {
  return INTRINSIC_JSON_PARSE(canonicalStringify(value)) as T
}

export function parseJson(value: string): unknown {
  return INTRINSIC_JSON_PARSE(value) as unknown
}

export function compareIso(left: string, right: string): number {
  return Date.parse(left) - Date.parse(right)
}
