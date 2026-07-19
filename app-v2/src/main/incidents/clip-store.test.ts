import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createHash, timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { IncidentClip } from '../../shared/incidents'
import {
  IncidentClipIntegrityError,
  IncidentClipStore,
  assertVerifiedIncidentClip,
  incidentClipFileName,
  type IncidentClipIntegrityCodec
} from './clip-store'
import { canonicalStringify } from '../steward-desk/canonical'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

class SameUserSafeStorageSemanticsCodec implements IncidentClipIntegrityCodec {
  available(): boolean {
    return true
  }

  seal(plainText: string): Buffer {
    return Buffer.from(JSON.stringify({
      plainText,
      digest: createHash('sha256').update(plainText).digest('hex')
    }), 'utf8')
  }

  open(sealed: Buffer): string {
    const parsed = JSON.parse(sealed.toString('utf8')) as { plainText: string; digest: string }
    const actual = Buffer.from(createHash('sha256').update(parsed.plainText).digest('hex'), 'hex')
    const expected = Buffer.from(parsed.digest, 'hex')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new Error('test integrity mismatch')
    }
    return parsed.plainText
  }
}

function harness(name: string): { root: string; store: IncidentClipStore } {
  const root = join(process.cwd(), `.incident-clip-store-${name}-${process.pid}-${roots.length}`)
  mkdirSync(root, { recursive: true })
  roots.push(root)
  return { root, store: new IncidentClipStore(root, new SameUserSafeStorageSemanticsCodec()) }
}

function clip(id = 'inc-100-contact'): IncidentClip {
  return {
    id,
    type: 'contact',
    severity: 'moderate',
    at: 100,
    lap: 1,
    lapDistPct: 0.25,
    metrics: { speedKmh: 120, speedDropKmh: 30 },
    summary: 'Contact detected.',
    window: [{ t: 99, speedKmh: 150 }, { t: 100, speedKmh: 120 }],
    triggerIndex: 1,
    createdAt: 101,
    captureSession: {
      schemaVersion: 1,
      captureSessionId: 'capture-acc:fallback:race:spa:generation:1:1',
      sim: 'acc',
      startedAt: 1,
      lifecycleGeneration: 1,
      sessionType: 'Race',
      trackName: 'Spa'
    }
  }
}

function sealedPath(root: string, id = 'inc-100-contact'): string {
  return join(root, incidentClipFileName(id))
}

function rewritePlainKeepingSeal(path: string, mutate: (value: Record<string, unknown>) => void): void {
  const envelope = JSON.parse(readFileSync(path, 'utf8')) as { plainText: string; digest: string }
  const value = JSON.parse(envelope.plainText) as Record<string, unknown>
  mutate(value)
  envelope.plainText = JSON.stringify(value)
  writeFileSync(path, JSON.stringify(envelope), 'utf8')
}

describe('IncidentClipStore', () => {
  it('atomically persists and re-verifies existing timestamp/type-only clip ids', () => {
    const test = harness('atomic')
    const verified = test.store.save(clip())

    expect(assertVerifiedIncidentClip(verified)).toMatchObject({
      id: 'inc-100-contact',
      captureSession: { lifecycleGeneration: 1 }
    })
    expect(verified.trust).toEqual({
      boundary: 'local-windows-user',
      protection: 'electron-safe-storage',
      corruptionDetected: true,
      rendererTamperProtected: true,
      appOriginAuthenticated: false,
      sameUserProcessAuthenticity: false
    })
    expect(existsSync(sealedPath(test.root))).toBe(true)
    expect(readdirSync(test.root).some((name) => name.endsWith('.tmp'))).toBe(false)
    expect(test.store.getVerified('inc-100-contact')?.contentHash).toBe(verified.contentHash)
  })

  it('fails closed and quarantines file, payload, and capture-session tampering', () => {
    for (const [name, mutate] of [
      ['payload', (value: Record<string, unknown>) => { value.summary = 'tampered payload' }],
      ['session', (value: Record<string, unknown>) => {
        ;(value.captureSession as Record<string, unknown>).captureSessionId = 'capture-relabeled'
      }]
    ] as const) {
      const test = harness(name)
      test.store.save(clip(`inc-${name}`))
      const path = sealedPath(test.root, `inc-${name}`)
      rewritePlainKeepingSeal(path, mutate)

      expect(() => test.store.getVerified(`inc-${name}`)).toThrowError(IncidentClipIntegrityError)
      expect(existsSync(path)).toBe(false)
      expect(readdirSync(join(test.root, 'quarantine'))).toHaveLength(1)
    }

    const test = harness('bytes')
    test.store.save(clip('inc-bytes'))
    const path = sealedPath(test.root, 'inc-bytes')
    const bytes = readFileSync(path)
    bytes[bytes.length - 1] ^= 0xff
    writeFileSync(path, bytes)
    expect(() => test.store.getVerified('inc-bytes')).toThrow(/integrity verification failed/i)
  })

  it('does not claim app origin when another same-user process can reseal changed content', () => {
    const test = harness('same-user')
    test.store.save(clip('inc-same-user'))
    const path = sealedPath(test.root, 'inc-same-user')
    const envelope = JSON.parse(readFileSync(path, 'utf8')) as { plainText: string; digest: string }
    const changed = JSON.parse(envelope.plainText) as Record<string, unknown>
    changed.summary = 'Content resealed by another process under the same Windows user.'
    writeFileSync(
      path,
      new SameUserSafeStorageSemanticsCodec().seal(canonicalStringify(changed))
    )

    const verified = test.store.getVerified('inc-same-user')
    expect(verified?.clip.summary).toContain('another process')
    expect(verified?.trust.appOriginAuthenticated).toBe(false)
    expect(verified?.trust.sameUserProcessAuthenticity).toBe(false)
  })

  it('quarantines legacy unverified clips and interrupted atomic writes', () => {
    const test = harness('recovery')
    writeFileSync(join(test.root, 'legacy.json'), JSON.stringify(clip('legacy')), 'utf8')
    writeFileSync(join(test.root, '.incident.crash.tmp'), 'partial', 'utf8')

    expect(() => test.store.getVerified('legacy')).toThrow(/legacy incident clip/i)
    expect(() => test.store.load()).toThrow(/quarantined/i)

    expect(test.store.list()).toEqual([])
    expect(readdirSync(join(test.root, 'quarantine')).length).toBeGreaterThanOrEqual(2)
  })
})
