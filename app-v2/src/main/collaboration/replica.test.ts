import { describe, expect, it } from 'vitest'

import {
  COLLABORATION_DOCUMENT_KINDS,
  collaborationCapability,
  type CollaborationActor,
  type CollaborationCapability,
  type CollaborationExportBody,
  type CollaborationExportBundle
} from '../../shared/local-collaboration'
import { InMemoryCollaborationTransport } from './in-memory-transport'
import {
  canonicalStringify,
  hashCanonical,
  LocalCollaborationReplica
} from './replica'

const ACTOR_A: CollaborationActor = {
  id: 'actor-a',
  displayName: 'Alice',
  deviceId: 'device-a'
}
const ACTOR_B: CollaborationActor = {
  id: 'actor-b',
  displayName: 'Bob',
  deviceId: 'device-b'
}
const ACTOR_C: CollaborationActor = {
  id: 'actor-c',
  displayName: 'Casey',
  deviceId: 'device-c'
}

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
    const second = replica(
      { id: 'actor-d', displayName: 'Devon', deviceId: 'device-d' },
      'unused-d'
    )
    first.importBundle(canonical)
    second.importBundle(reversed)

    expect(second.getDocument(document.id)).toEqual(first.getDocument(document.id))
    expect(second.exportBundle()).toBe(first.exportBundle())
    expect(first.exportBundle()).toBe(canonical)
  })
})
