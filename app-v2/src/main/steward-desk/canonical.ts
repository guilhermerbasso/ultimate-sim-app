import { createHash } from 'node:crypto'
import {
  STEWARD_EVIDENCE_MAX_BYTES,
  STEWARD_PACKAGE_MAX_BYTES
} from '../../shared/steward-desk'

export const EVIDENCE_MAX_CANONICAL_BYTES = STEWARD_EVIDENCE_MAX_BYTES
export const PACKAGE_MAX_CANONICAL_BYTES = STEWARD_PACKAGE_MAX_BYTES
const MAX_CANONICAL_DEPTH = 32
const MAX_CANONICAL_NODES = 100_000

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function normalizeCanonical(value: unknown, depth: number, budget: { nodes: number }): unknown {
  budget.nodes += 1
  if (budget.nodes > MAX_CANONICAL_NODES) throw new Error('Canonical value exceeds the node limit.')
  if (depth > MAX_CANONICAL_DEPTH) throw new Error('Canonical value exceeds the depth limit.')

  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical values cannot contain non-finite numbers.')
    return value
  }
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (entry === undefined) throw new Error('Canonical arrays cannot contain undefined values.')
      return normalizeCanonical(entry, depth + 1, budget)
    })
  }
  if (!isPlainObject(value)) throw new Error('Canonical values must contain only JSON-compatible plain objects.')

  const normalized: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    const entry = value[key]
    if (entry === undefined) throw new Error(`Canonical field "${key}" cannot be undefined.`)
    normalized[key] = normalizeCanonical(entry, depth + 1, budget)
  }
  return normalized
}

export function canonicalStringify(
  value: unknown,
  maxBytes = EVIDENCE_MAX_CANONICAL_BYTES
): string {
  const serialized = JSON.stringify(normalizeCanonical(value, 0, { nodes: 0 }))
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw new Error(`Canonical value exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MiB limit.`)
  }
  return serialized
}

export function sha256Canonical(value: unknown, maxBytes = EVIDENCE_MAX_CANONICAL_BYTES): string {
  return createHash('sha256').update(canonicalStringify(value, maxBytes), 'utf8').digest('hex')
}

export function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function cloneJson<T>(value: T, maxBytes = EVIDENCE_MAX_CANONICAL_BYTES): T {
  return JSON.parse(canonicalStringify(value, maxBytes)) as T
}
