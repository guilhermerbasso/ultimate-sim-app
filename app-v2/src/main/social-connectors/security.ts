import { createHash } from 'node:crypto'

const FORBIDDEN_NORMALIZED_KEY_FRAGMENT =
  /(?:authorization|accesstoken|refreshtoken|authtoken|bearertoken|sessiontoken|idtoken|oauth|clientsecret|sharedsecret|signingsecret|webhooksecret|apisecret|password|passphrase|webhookurl|streamkey|privatekey|credential|apikey|apitoken)/
const FORBIDDEN_COMMON_NORMALIZED_KEYS = new Set(['token', 'tokens', 'secret', 'secrets'])
const FORBIDDEN_VALUE = /(?:\bbearer\s+[a-z0-9._~+/=-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i

function isForbiddenCredentialKey(key: string): boolean {
  const normalized = key
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  return (
    FORBIDDEN_COMMON_NORMALIZED_KEYS.has(normalized) ||
    FORBIDDEN_NORMALIZED_KEY_FRAGMENT.test(normalized)
  )
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
