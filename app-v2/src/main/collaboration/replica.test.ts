import { createPrivateKey, sign, type KeyObject } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

import {
  COLLABORATION_DOCUMENT_KINDS,
  collaborationCapability,
  type CollaborationActor,
  type CollaborationCapability,
  type CollaborationChange,
  type CollaborationChangeBody,
  type CollaborationExportBody,
  type CollaborationExportBundle
} from '../../shared/local-collaboration'
import { InMemoryCollaborationTransport } from './in-memory-transport'
import {
  assertCollaborationCausalGraphAcyclic,
  canonicalStringify,
  createCollaborationSigningIdentity,
  hashCanonical,
  LocalCollaborationReplica,
  CollaborationValidationError
} from './replica'

const IDENTITY_A = createCollaborationSigningIdentity({
  id: 'actor-a',
  displayName: 'Alice',
  deviceId: 'device-a'
})
const IDENTITY_B = createCollaborationSigningIdentity({
  id: 'actor-b',
  displayName: 'Bob',
  deviceId: 'device-b'
})
const IDENTITY_C = createCollaborationSigningIdentity({
  id: 'actor-c',
  displayName: 'Casey',
  deviceId: 'device-c'
})
const IDENTITY_D = createCollaborationSigningIdentity({
  id: 'actor-d',
  displayName: 'Devon',
  deviceId: 'device-d'
})
const ACTOR_A: CollaborationActor = IDENTITY_A.actor
const ACTOR_B: CollaborationActor = IDENTITY_B.actor
const ACTOR_C: CollaborationActor = IDENTITY_C.actor
const ACTOR_D: CollaborationActor = IDENTITY_D.actor
const PRIVATE_KEYS = new Map([
  [ACTOR_A.id, IDENTITY_A.privateKey],
  [ACTOR_B.id, IDENTITY_B.privateKey],
  [ACTOR_C.id, IDENTITY_C.privateKey],
  [ACTOR_D.id, IDENTITY_D.privateKey]
])
const PRIVATE_KEY_OBJECTS = new Map(
  [...PRIVATE_KEYS].map(([id, privateKey]) => [
    id,
    createPrivateKey({ key: Buffer.from(privateKey, 'base64'), format: 'der', type: 'pkcs8' })
  ])
)

function allCapabilities(): CollaborationCapability[] {
  return [
    ...COLLABORATION_DOCUMENT_KINDS.flatMap((kind) => [
      collaborationCapability(kind, 'read'),
      collaborationCapability(kind, 'write')
    ]),
    'document:export',
    'document:import',
    'peer:manage'
  ]
}

function replica(actor: CollaborationActor, documentId: string): LocalCollaborationReplica {
  let now = actor.id.charCodeAt(actor.id.length - 1) * 1_000
  return new LocalCollaborationReplica(actor, {
    privateKey: PRIVATE_KEYS.get(actor.id)!,
    now: () => ++now,
    documentId: () => documentId
  })
}

function pair(): {
  a: LocalCollaborationReplica
  b: LocalCollaborationReplica
  transport: InMemoryCollaborationTransport
} {
  const a = replica(ACTOR_A, 'race-plan')
  const b = replica(ACTOR_B, 'unused-b')
  a.registerPeer({ id: 'b', actor: ACTOR_B, capabilities: allCapabilities(), connected: true })
  b.registerPeer({ id: 'a', actor: ACTOR_A, capabilities: allCapabilities(), connected: true })
  const transport = new InMemoryCollaborationTransport()
  transport.attach('a', a)
  transport.attach('b', b)
  return { a, b, transport }
}

function note(id: string, text: string): Record<string, string> {
  return { id, text }
}

function rewriteBundle(
  serialized: string,
  mutate: (bundle: CollaborationExportBundle) => void
): string {
  const bundle = JSON.parse(serialized) as CollaborationExportBundle
  mutate(bundle)
  const body: CollaborationExportBody = {
    format: bundle.format,
    version: bundle.version,
    actors: bundle.actors,
    documents: bundle.documents
  }
  bundle.checksum.value = hashCanonical(body)
  return canonicalStringify(bundle)
}

function changeBody(change: CollaborationChange): CollaborationChangeBody {
  const { id: _id, hash: _hash, signature: _signature, ...body } = change
  return body
}

function signedChange(body: CollaborationChangeBody, privateKey: KeyObject): CollaborationChange {
  const hash = hashCanonical(body)
  return {
    ...body,
    id: `${body.author.id}:${body.sequence}:${hash.slice(0, 16)}`,
    hash,
    signature: sign(null, Buffer.from(hash, 'hex'), privateKey).toString('base64')
  }
}

describe('LocalCollaborationReplica', () => {
  it('converges deterministic concurrent edits and exposes the conflict', () => {
    const { a, b, transport } = pair()
    const document = a.createDocument({ kind: 'race-notes', title: 'Sebring plan', createdAt: 1 })
    transport.synchronizeAll()
    transport.setOnline('a', false)

    a.setValue(document.id, '/entries/turn-1', note('turn-1', 'Brake at 125 m'), 'Alice offline edit', 2)
    b.setValue(document.id, '/entries/turn-1', note('turn-1', 'Brake at 120 m'), 'Bob offline edit', 3)

    expect(transport.pendingChangeCount('a')).toBeGreaterThan(0)
    transport.setOnline('a', true)
    transport.synchronizeAll()

    const viewA = a.getDocument(document.id)
    const viewB = b.getDocument(document.id)
    expect(viewA.data).toEqual(viewB.data)
    expect(viewA.revision).toBe(viewB.revision)
    expect(viewA.data.entries).toEqual({ 'turn-1': note('turn-1', 'Brake at 120 m') })
    expect(viewA.conflicts).toHaveLength(1)
    expect(viewA.conflicts[0].candidates.map((candidate) => candidate.author.id)).toEqual([
      'actor-a',
      'actor-b'
    ])

    a.setValue(document.id, '/entries/turn-1', note('turn-1', 'Team-agreed 122 m'), 'Resolve conflict', 4)
    transport.synchronizeAll()
    expect(a.getDocument(document.id).conflicts).toHaveLength(0)
    expect(b.getDocument(document.id).data).toEqual(a.getDocument(document.id).data)
  })

  it('keeps deletions as tombstones through export and import', () => {
    const { a, b, transport } = pair()
    const document = a.createDocument({ kind: 'race-notes', title: 'Endurance notes', createdAt: 10 })
    a.setValue(document.id, '/entries/pit', note('pit', 'Double stint tires'), undefined, 11)
    transport.synchronizeAll()

    b.deleteValue(document.id, '/entries/pit', 'Obsolete after rules update', 12)
    transport.synchronizeAll()

    const deleted = a.getDocument(document.id)
    expect((deleted.data.entries as Record<string, unknown> | undefined)?.pit).toBeUndefined()
    expect(deleted.tombstoneCount).toBe(1)
    expect(deleted.history.some((entry) => entry.operation.type === 'delete')).toBe(true)

    const restored = replica(ACTOR_C, 'unused-c')
    restored.importBundle(a.exportBundle())
    expect((restored.getDocument(document.id).data.entries as Record<string, unknown> | undefined)?.pit).toBeUndefined()
    expect(restored.getDocument(document.id).tombstoneCount).toBe(1)
  })

  it('preserves author identity and rejects a peer introducing another author', () => {
    const { a, b, transport } = pair()
    expect(() =>
      a.registerPeer({ id: 'local-impostor', actor: ACTOR_A, capabilities: allCapabilities() })
    ).toThrow(/cannot reuse the local actor identity/)
    const document = a.createDocument({ kind: 'race-notes', title: 'Driver notes', createdAt: 20 })
    transport.synchronizeAll()
    b.setValue(document.id, '/entries/line', note('line', 'Open the exit'), 'Crew note', 21)
    transport.synchronizeAll()

    const authored = a.getDocument(document.id).history.find((entry) => entry.operation.path === '/entries/line')
    expect(authored?.author).toEqual(ACTOR_B)

    const impostor = replica(ACTOR_C, 'unused-c')
    impostor.importBundle(a.exportBundle())
    impostor.setValue(document.id, '/entries/spoof', note('spoof', 'Forged author'), undefined, 22)
    expect(() => a.mergeBundleFromPeer('b', impostor.exportBundle())).toThrow(/cannot introduce author actor-c/)
    expect(a.getQuarantine().at(0)?.sourcePeerId).toBe('b')
    expect(a.getDocument(document.id).data.entries).not.toHaveProperty('spoof')
  })

  it('rejects unauthorized fields and read-only peer writes', () => {
    const a = replica(ACTOR_A, 'safe-doc')
    const document = a.createDocument({ kind: 'race-notes', title: 'Safe notes', createdAt: 30 })

    expect(() =>
      a.setValue(document.id, '/telemetry/frames', { value: 1 })
    ).toThrow(/not allowed/)
    expect(() =>
      a.setValue(document.id, '/entries/leak', {
        id: 'leak',
        text: 'Do not sync this',
        credentials: { token: 'secret' }
      } as never)
    ).toThrow(/credentials/)

    const dashboard = a.createDocument({ kind: 'dashboard', title: 'GT3 DDU', id: 'dashboard-safe', createdAt: 31 })
    expect(() =>
      a.setValue(dashboard.id, '/elements/snapshot', {
        id: 'snapshot',
        type: 'text',
        x: 0,
        y: 0,
        w: 100,
        h: 40,
        style: {
          speedKmh: 240,
          rpm: 7600,
          throttle: 0.9
        }
      })
    ).toThrow(/Telemetry-shaped/)

    const viewer = replica(ACTOR_B, 'viewer-doc')
    const readOnly = COLLABORATION_DOCUMENT_KINDS.map((kind) => collaborationCapability(kind, 'read'))
    a.registerPeer({ id: 'viewer', actor: ACTOR_B, capabilities: readOnly, connected: true })
    viewer.registerPeer({ id: 'a', actor: ACTOR_A, capabilities: allCapabilities(), connected: true })
    viewer.importBundle(a.exportBundle())
    viewer.setValue(document.id, '/entries/viewer', note('viewer', 'Unauthorized write'), undefined, 32)
    expect(() => a.mergeBundleFromPeer('viewer', viewer.exportBundle())).toThrow(/lacks race-notes:write/)
  })

  it('deduplicates replayed changes without duplicating history', () => {
    const { a, b } = pair()
    const document = a.createDocument({ kind: 'cue-profile', title: 'Night cues', createdAt: 40 })
    a.setValue(document.id, '/cues/yellow', {
      id: 'yellow',
      label: 'Yellow flag',
      channels: ['visual', 'audio'],
      enabled: true
    }, undefined, 41)
    const bundle = a.exportBundle()

    const first = b.mergeBundleFromPeer('a', bundle)
    const historyLength = b.getDocument(document.id).history.length
    const replay = b.mergeBundleFromPeer('a', bundle)

    expect(first.accepted).toBe(2)
    expect(replay).toEqual({ accepted: 0, replayed: 2 })
    expect(b.getDocument(document.id).history).toHaveLength(historyLength)
  })

  it('quarantines checksum and change corruption without mutating local state', () => {
    const source = replica(ACTOR_A, 'corruption-doc')
    const document = source.createDocument({ kind: 'race-notes', title: 'Trusted', createdAt: 50 })
    const target = replica(ACTOR_C, 'unused-c')
    target.importBundle(source.exportBundle())
    const revision = target.getDocument(document.id).revision

    const checksumCorrupt = JSON.parse(source.exportBundle()) as CollaborationExportBundle
    checksumCorrupt.documents[0].changes[0].operation = {
      type: 'set',
      path: '/title',
      value: 'Tampered'
    }
    expect(() => target.importBundle(JSON.stringify(checksumCorrupt))).toThrow(/checksum mismatch/)
    expect(target.getDocument(document.id).revision).toBe(revision)

    source.setValue(document.id, '/title', 'Trusted revision 2', undefined, 51)
    const changeCorrupt = rewriteBundle(source.exportBundle(), (bundle) => {
      bundle.documents[0].changes.at(-1)!.operation = {
        type: 'set',
        path: '/title',
        value: 'Tampered with valid outer checksum'
      }
    })
    expect(() => target.importBundle(changeCorrupt)).toThrow(/Change hash or id mismatch/)
    expect(target.getDocument(document.id).revision).toBe(revision)

    const metadataCorrupt = rewriteBundle(source.exportBundle(), (bundle) => {
      bundle.documents[0].createdAt += 1
    })
    expect(() => target.importBundle(metadataCorrupt)).toThrow(/changed its creation metadata/)
    expect(target.getDocument(document.id).revision).toBe(revision)
    expect(target.getQuarantine()).toHaveLength(3)
  })

  it('converges identically regardless of incoming change order', () => {
    const { a, b, transport } = pair()
    const document = a.createDocument({ kind: 'accessibility-profile', title: 'Low vision', createdAt: 60 })
    transport.synchronizeAll()
    transport.setOnline('a', false)
    a.setValue(document.id, '/preferences/scale', 1.4, undefined, 61)
    b.setValue(document.id, '/preferences/contrast', 'high', undefined, 62)
    transport.setOnline('a', true)
    transport.synchronizeAll()

    const canonical = a.exportBundle()
    const reversed = rewriteBundle(canonical, (bundle) => {
      for (const item of bundle.documents) item.changes.reverse()
    })
    const first = replica(ACTOR_C, 'unused-c')
    const second = replica(ACTOR_D, 'unused-d')
    first.importBundle(canonical)
    second.importBundle(reversed)

    expect(second.getDocument(document.id)).toEqual(first.getDocument(document.id))
    expect(second.exportBundle()).toBe(first.exportBundle())
    expect(first.exportBundle()).toBe(canonical)
  })

  it('rejects forged authorship even when the outer checksum and known actor metadata are valid', () => {
    const { a, b, transport } = pair()
    const document = a.createDocument({ kind: 'race-notes', title: 'Signed plan', createdAt: 70 })
    transport.synchronizeAll()
    transport.setOnline('a', false)
    a.setValue(document.id, '/entries/alice', note('alice', 'Alice-authored'), undefined, 71)
    b.setValue(document.id, '/entries/bob', note('bob', 'Bob-authored'), undefined, 72)
    transport.setOnline('a', true)
    transport.synchronizeAll()

    const forged = rewriteBundle(a.exportBundle(), (bundle) => {
      const alice = bundle.documents[0].changes.find((change) => change.operation.path === '/entries/alice')!
      alice.signature = sign(
        null,
        Buffer.from(alice.hash, 'hex'),
        PRIVATE_KEY_OBJECTS.get(ACTOR_B.id)!
      ).toString('base64')
    })
    const target = replica(ACTOR_C, 'unused-c')

    expect(() => target.importBundle(forged)).toThrow(/signature does not authenticate author actor-a/)
    expect(target.listDocuments()).toEqual([])
    expect(target.getQuarantine()).toHaveLength(1)
  })

  it('uses locale-independent canonical ordering', () => {
    const localeCompare = vi.spyOn(String.prototype, 'localeCompare').mockImplementation(() => {
      throw new Error('locale-dependent ordering was used')
    })
    let serialized = ''
    try {
      const { a, b, transport } = pair()
      const document = a.createDocument({ kind: 'race-notes', title: 'Canonical order', createdAt: 80 })
      transport.synchronizeAll()
      b.setValue(document.id, '/entries/z', note('z', 'Zulu'), undefined, 81)
      a.setValue(document.id, '/entries/a', note('a', 'Alpha'), undefined, 82)
      transport.synchronizeAll()
      serialized = a.exportBundle()
      a.getDocument(document.id)
    } finally {
      localeCompare.mockRestore()
    }
    expect(serialized).toContain('"documents"')
  })

  it('rejects signed Lamport gaps and extreme clocks instead of accepting causal jumps', () => {
    const source = replica(ACTOR_A, 'lamport-doc')
    const document = source.createDocument({ kind: 'race-notes', title: 'Clock plan', createdAt: 90 })
    source.setValue(document.id, '/summary', 'Second change', undefined, 91)
    const target = replica(ACTOR_C, 'unused-c')

    for (const maliciousLamport of [4, Number.MAX_SAFE_INTEGER]) {
      const tampered = rewriteBundle(source.exportBundle(), (bundle) => {
        const child = bundle.documents[0].changes.find((change) => change.sequence === 2)!
        Object.assign(child, signedChange(
          { ...changeBody(child), lamport: maliciousLamport },
          PRIVATE_KEY_OBJECTS.get(ACTOR_A.id)!
        ))
      })
      expect(() => target.importBundle(tampered)).toThrow(/Lamport clock must be exactly 2/)
    }
    expect(target.listDocuments()).toEqual([])
  })

  it('rejects a 10,000-level JSON value without recursive stack exhaustion', () => {
    const target = replica(ACTOR_A, 'deep-json')
    const document = target.createDocument({ kind: 'accessibility-profile', title: 'Deep value', createdAt: 100 })
    let value: unknown = 'leaf'
    for (let depth = 0; depth < 10_000; depth += 1) value = { child: value }

    let thrown: unknown
    try {
      target.setValue(document.id, '/preferences/deep', value as never)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(CollaborationValidationError)
    expect(thrown).not.toBeInstanceOf(RangeError)
    expect((thrown as Error).message).toMatch(/nesting is too deep/)
  })

  it('validates a maximum-depth 10,000-change causal chain iteratively', () => {
    const changes = new Map<string, Pick<CollaborationChange, 'parents'>>()
    for (let index = 0; index < 10_000; index += 1) {
      changes.set(`change-${index}`, {
        parents: index === 0 ? [] : [`change-${index - 1}`]
      })
    }
    expect(() => assertCollaborationCausalGraphAcyclic(changes, 'max-chain')).not.toThrow()
    changes.get('change-0')!.parents = ['change-9999']
    expect(() => assertCollaborationCausalGraphAcyclic(changes, 'max-chain')).toThrow(/causal cycle/)
  })
})
