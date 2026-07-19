import { createHash } from 'node:crypto'

const FORBIDDEN_NORMALIZED_KEY_FRAGMENT =
  /(?:authorization|authheader|authentication|oauth|password|passwd|passphrase|webhookurl|streamkey|privatekey|credential|apikey|sessionid|sessionidentifier|sessioncookie|sessionkey)/
const FORBIDDEN_VALUE =
  /(?:\bbearer\s+[a-z0-9._~+/=-]{8,}|\b(?:authorization|cookie|set-cookie)\s*:|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i

export type SocialJsonValue =
  | null
  | boolean
  | string
  | number
  | readonly SocialJsonValue[]
  | Readonly<{ [key: string]: SocialJsonValue }>

interface SocialJsonCloneSuccess {
  readonly ok: true
  readonly value: SocialJsonValue
}

interface SocialJsonCloneFailure {
  readonly ok: false
}

type SocialJsonCloneResult = SocialJsonCloneSuccess | SocialJsonCloneFailure

function isForbiddenCredentialKey(key: string): boolean {
  const normalized = key
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  return (
    FORBIDDEN_NORMALIZED_KEY_FRAGMENT.test(normalized) ||
    normalized.includes('cookie') ||
    normalized.includes('session') ||
    normalized.includes('token') ||
    normalized.includes('secret')
  )
}

export function readSocialDataRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === null || typeof value !== 'object') return null
  try {
    if (Array.isArray(value)) return null
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return null
    const keys = Reflect.ownKeys(value)
    if (keys.some((key) => typeof key !== 'string')) return null
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const record: Record<string, unknown> = Object.create(null)
    for (const key of keys as string[]) {
      const descriptor = descriptors[key]
      if (!descriptor?.enumerable || !('value' in descriptor)) return null
      record[key] = descriptor.value
    }
    return record
  } catch {
    return null
  }
}

function cloneSafeSocialJsonValue(
  value: unknown,
  seen: Set<object>,
  depth = 0
): SocialJsonCloneResult {
  if (depth > 64) return { ok: false }
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return { ok: true, value }
  }
  if (typeof value !== 'object' || seen.has(value)) return { ok: false }

  let prototype: object | null
  let keys: readonly PropertyKey[]
  let descriptors: PropertyDescriptorMap
  try {
    prototype = Object.getPrototypeOf(value)
    keys = Reflect.ownKeys(value)
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    return { ok: false }
  }

  seen.add(value)
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype || keys.some((key) => typeof key !== 'string')) {
      seen.delete(value)
      return { ok: false }
    }
    const lengthDescriptor = descriptors.length
    const length =
      lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : undefined
    if (!Number.isSafeInteger(length) || length < 0) {
      seen.delete(value)
      return { ok: false }
    }
    if (
      keys.length !== length + 1 ||
      keys.some((key) => {
        if (key === 'length') return false
        const index = Number(key)
        return (
          !Number.isSafeInteger(index) ||
          index < 0 ||
          index >= length ||
          String(index) !== key
        )
      })
    ) {
      seen.delete(value)
      return { ok: false }
    }
    const entries: SocialJsonValue[] = []
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)]
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        seen.delete(value)
        return { ok: false }
      }
      const cloned = cloneSafeSocialJsonValue(descriptor.value, seen, depth + 1)
      if (!cloned.ok) {
        seen.delete(value)
        return cloned
      }
      entries.push(cloned.value)
    }
    seen.delete(value)
    return { ok: true, value: entries }
  }

  if (
    (prototype !== Object.prototype && prototype !== null) ||
    keys.some((key) => typeof key !== 'string')
  ) {
    seen.delete(value)
    return { ok: false }
  }
  const record: Record<string, SocialJsonValue> = Object.create(null)
  for (const key of keys as string[]) {
    const descriptor = descriptors[key]
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      seen.delete(value)
      return { ok: false }
    }
    const cloned = cloneSafeSocialJsonValue(descriptor.value, seen, depth + 1)
    if (!cloned.ok) {
      seen.delete(value)
      return cloned
    }
    record[key] = cloned.value
  }
  seen.delete(value)
  return { ok: true, value: record }
}

export function sanitizeSocialJsonRecord(
  value: unknown
): Readonly<Record<string, SocialJsonValue>> | null {
  const cloned = cloneSafeSocialJsonValue(value, new Set())
  if (!cloned.ok || cloned.value === null || Array.isArray(cloned.value)) return null
  if (typeof cloned.value !== 'object') return null
  return cloned.value as Readonly<Record<string, SocialJsonValue>>
}

function normalizeForStableJson(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'bigint') return value.toString(10)
  if (typeof value === 'undefined') return null
  if (Array.isArray(value)) return value.map((entry) => normalizeForStableJson(entry, seen))
  if (typeof value !== 'object') return String(value)
  if (seen.has(value)) throw new Error('Circular social connector values cannot be serialized')

  seen.add(value)
  const normalized = Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, normalizeForStableJson(entry, seen)])
  )
  seen.delete(value)
  return normalized
}

export function stableSocialJson(value: unknown): string {
  return JSON.stringify(normalizeForStableJson(value, new Set()))
}

export function socialHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableSocialJson(value)).digest('hex')}`
}

export function findCredentialMaterial(
  value: unknown,
  path = '$',
  seen = new Set<object>()
): string | null {
  if (typeof value === 'string') return FORBIDDEN_VALUE.test(value) ? path : null
  if (value === null || typeof value !== 'object') return null
  if (seen.has(value)) return path
  seen.add(value)

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const match = findCredentialMaterial(value[index], `${path}[${index}]`, seen)
      if (match) return match
    }
    seen.delete(value)
    return null
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isForbiddenCredentialKey(key)) return `${path}.${key}`
    const match = findCredentialMaterial(entry, `${path}.${key}`, seen)
    if (match) return match
  }
  seen.delete(value)
  return null
}

export function assertNoCredentialMaterial(value: unknown): void {
  const path = findCredentialMaterial(value)
  if (path) throw new Error(`Credential material is forbidden in social connector records at ${path}`)
}

export function serializePublicSocialRecord(value: unknown): string {
  assertNoCredentialMaterial(value)
  return stableSocialJson(value)
}

export function cloneSocialValue<T>(value: T): T {
  return JSON.parse(stableSocialJson(value)) as T
}
