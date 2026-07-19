import { createHash } from 'node:crypto'
import type { SocialProvider } from '../../shared/social-connectors'

const FORBIDDEN_NORMALIZED_KEY_FRAGMENT =
  /(?:authorization|authheader|authentication|oauth|password|passwd|passphrase|webhookurl|streamkey|privatekey|credential|apikey|sessionid|sessionidentifier|sessioncookie|sessionkey)/
const FORBIDDEN_VALUE = /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/
const GENERIC_JWT =
  /^eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}$/
const GENERIC_AUTH_HEADER =
  /^(?:authorization|proxy-authorization)\s*:\s*(?:basic|bearer|bot|oauth|token)\s+[A-Za-z0-9._~+/=-]{16,}$/i
const GENERIC_SECRET_HEADER =
  /^(?:api-key|x-api-key|x-auth-token)\s*:\s*[A-Za-z0-9._~+/=-]{16,}$/i
const GENERIC_BEARER = /^(?:bearer|token)\s+[A-Za-z0-9._~+/=-]{20,}$/i
const GENERIC_SESSION =
  /^(?:(?:connect\.sid|session(?:id|_id)?|sid)[=:][A-Za-z0-9._~+/=-]{16,}|sess_[A-Za-z0-9_-]{24,}|s%3A[A-Za-z0-9._~-]{16,}\.[A-Za-z0-9._~-]{16,})$/i
const TWITCH_OAUTH = /^oauth:[A-Za-z0-9]{20,64}$/i
const GOOGLE_API_KEY = /^AIza[A-Za-z0-9_-]{35}$/
const GOOGLE_OAUTH = /^(?:ya29\.[A-Za-z0-9._-]{20,}|1\/\/[A-Za-z0-9._-]{20,})$/
const DISCORD_BOT_TOKEN =
  /^[A-Za-z0-9_-]{23,30}\.[A-Za-z0-9_-]{6,8}\.[A-Za-z0-9_-]{25,40}$/
const DISCORD_MFA_TOKEN = /^mfa\.[A-Za-z0-9_-]{40,100}$/
const DISCORD_BOT_HEADER =
  /^bot\s+[A-Za-z0-9_-]{23,30}\.[A-Za-z0-9_-]{6,8}\.[A-Za-z0-9_-]{25,40}$/i
const MAX_SAFE_SOCIAL_JSON_NODES = 8_192
const MAX_SAFE_SOCIAL_JSON_CONTAINER_ENTRIES = 4_096
const MAX_SAFE_SOCIAL_JSON_STRING_LENGTH = 64 * 1024

const PROVIDER_VALUE_PATTERNS: Readonly<Record<SocialProvider, readonly RegExp[]>> = {
  twitch: [TWITCH_OAUTH],
  youtube: [GOOGLE_API_KEY, GOOGLE_OAUTH],
  discord: [DISCORD_BOT_TOKEN, DISCORD_MFA_TOKEN, DISCORD_BOT_HEADER]
}

export interface CredentialScanOptions {
  readonly provider?: SocialProvider
  readonly maxNodes?: number
  readonly maxDepth?: number
  readonly maxStringLength?: number
}

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

interface SocialJsonCloneBudget {
  nodes: number
}

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

function isCredentialCookieHeader(value: string): boolean {
  const separator = value.indexOf(':')
  if (separator < 0 || !/^(?:cookie|set-cookie)$/i.test(value.slice(0, separator).trim())) {
    return false
  }
  return value
    .slice(separator + 1)
    .split(';')
    .some((part) => {
      const equals = part.indexOf('=')
      if (equals <= 0) return false
      const name = part.slice(0, equals).trim()
      const cookieValue = part.slice(equals + 1).trim()
      return (
        /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/.test(name) &&
        cookieValue.length >= 16 &&
        !/\s/.test(cookieValue)
      )
    })
}

function isCredentialShapedValue(value: string, provider?: SocialProvider): boolean {
  const candidate = value.trim()
  if (
    candidate.length === 0 ||
    candidate.length > 64 * 1024 ||
    (!candidate.includes('.') &&
      !candidate.includes(':') &&
      !candidate.includes('=') &&
      !candidate.includes('/') &&
      !/^(?:1\/\/|AIza|mfa\.|oauth:|sess_|ya29\.|-----BEGIN |Bearer\s|Bot\s|Cookie\s*:|Set-Cookie\s*:|Token\s)/i.test(
        candidate
      ))
  ) {
    return false
  }
  if (
    GENERIC_JWT.test(candidate) ||
    GENERIC_AUTH_HEADER.test(candidate) ||
    GENERIC_SECRET_HEADER.test(candidate) ||
    GENERIC_BEARER.test(candidate) ||
    isCredentialCookieHeader(candidate) ||
    GENERIC_SESSION.test(candidate) ||
    /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/.test(candidate)
  ) {
    return true
  }

  const providers: readonly SocialProvider[] = provider
    ? [provider, ...(['twitch', 'youtube', 'discord'] as const).filter((entry) => entry !== provider)]
    : ['twitch', 'youtube', 'discord']
  return providers.some((entry) =>
    PROVIDER_VALUE_PATTERNS[entry].some((pattern) => pattern.test(candidate))
  )
}

export function readSocialDataRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === null || typeof value !== 'object') return null
  try {
    if (Array.isArray(value)) return null
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return null
    const keys = Reflect.ownKeys(value)
    if (
      keys.length > MAX_SAFE_SOCIAL_JSON_CONTAINER_ENTRIES ||
      keys.some((key) => typeof key !== 'string')
    ) {
      return null
    }
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
  depth: number,
  budget: SocialJsonCloneBudget
): SocialJsonCloneResult {
  budget.nodes += 1
  if (depth > 64 || budget.nodes > MAX_SAFE_SOCIAL_JSON_NODES) return { ok: false }
  if (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return { ok: true, value }
  }
  if (typeof value === 'string') {
    return value.length <= MAX_SAFE_SOCIAL_JSON_STRING_LENGTH
      ? { ok: true, value }
      : { ok: false }
  }
  if (typeof value !== 'object' || seen.has(value)) return { ok: false }

  let prototype: object | null
  let keys: readonly PropertyKey[]
  let descriptors: PropertyDescriptorMap
  let isArray: boolean
  try {
    isArray = Array.isArray(value)
    prototype = Object.getPrototypeOf(value)
    if (isArray) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
      const length =
        lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : undefined
      if (
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > MAX_SAFE_SOCIAL_JSON_CONTAINER_ENTRIES
      ) {
        return { ok: false }
      }
    }
    keys = Reflect.ownKeys(value)
    if (keys.length > MAX_SAFE_SOCIAL_JSON_CONTAINER_ENTRIES + (isArray ? 1 : 0)) {
      return { ok: false }
    }
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    return { ok: false }
  }

  seen.add(value)
  if (isArray) {
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
      const cloned = cloneSafeSocialJsonValue(descriptor.value, seen, depth + 1, budget)
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
    const cloned = cloneSafeSocialJsonValue(descriptor.value, seen, depth + 1, budget)
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
  const cloned = cloneSafeSocialJsonValue(value, new Set(), 0, { nodes: 0 })
  if (!cloned.ok || cloned.value === null || Array.isArray(cloned.value)) return null
  if (typeof cloned.value !== 'object') return null
  return cloned.value as Readonly<Record<string, SocialJsonValue>>
}

function normalizeForStableJson(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'bigint') return value.toString(10)
  if (typeof value === 'undefined') return null
  if (typeof value !== 'object') return String(value)
  if (seen.has(value)) throw new Error('Circular social connector values cannot be serialized')

  seen.add(value)
  if (Array.isArray(value)) {
    const normalized = value.map((entry) => normalizeForStableJson(entry, seen))
    seen.delete(value)
    return normalized
  }
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
  options: CredentialScanOptions = {}
): string | null {
  const maxNodes = options.maxNodes ?? 8_192
  const maxDepth = options.maxDepth ?? 64
  const maxStringLength = options.maxStringLength ?? 64 * 1024
  const seen = new Set<object>()
  const pending: Array<{ readonly value: unknown; readonly path: string; readonly depth: number }> = [
    { value, path: '$', depth: 0 }
  ]
  let visited = 0

  while (pending.length > 0) {
    const current = pending.pop()!
    visited += 1
    if (visited > maxNodes || current.depth > maxDepth) return current.path

    if (typeof current.value === 'string') {
      if (
        current.value.length > maxStringLength ||
        FORBIDDEN_VALUE.test(current.value) ||
        isCredentialShapedValue(current.value, options.provider)
      ) {
        return current.path
      }
      continue
    }
    if (current.value === null || typeof current.value !== 'object') continue
    if (seen.has(current.value)) return current.path
    seen.add(current.value)

    let isArray: boolean
    try {
      isArray = Array.isArray(current.value)
    } catch {
      return current.path
    }
    if (isArray) {
      let descriptors: PropertyDescriptorMap
      let keys: readonly PropertyKey[]
      try {
        descriptors = Object.getOwnPropertyDescriptors(current.value)
        keys = Reflect.ownKeys(current.value)
      } catch {
        return current.path
      }
      const lengthDescriptor = descriptors.length
      const length =
        lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : undefined
      if (
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > maxNodes ||
        keys.length !== length + 1
      ) {
        return current.path
      }
      for (let index = length - 1; index >= 0; index -= 1) {
        const descriptor = descriptors[String(index)]
        if (!descriptor?.enumerable || !('value' in descriptor)) return current.path
        pending.push({
          value: descriptor.value,
          path: `${current.path}[${index}]`,
          depth: current.depth + 1
        })
      }
      continue
    }

    const record = readSocialDataRecord(current.value)
    if (!record) return current.path
    const entries = Object.entries(record)
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, entry] = entries[index]
      if (key.length > 256 || isForbiddenCredentialKey(key)) return `${current.path}.${key}`
      pending.push({
        value: entry,
        path: `${current.path}.${key}`,
        depth: current.depth + 1
      })
    }
  }
  return null
}

export function assertNoCredentialMaterial(value: unknown): void {
  if (findCredentialMaterial(value)) {
    throw new Error('Credential material is forbidden in social connector records')
  }
}

export function serializePublicSocialRecord(value: unknown): string {
  assertNoCredentialMaterial(value)
  return stableSocialJson(value)
}

export function cloneSocialValue<T>(value: T): T {
  return JSON.parse(stableSocialJson(value)) as T
}
