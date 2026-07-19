import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { rename as renameAsync } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { LocalCollaborationService } from './service'

const cleanup: string[] = []

afterEach(() => {
  for (const directory of cleanup.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

async function serviceFixture(): Promise<{ service: LocalCollaborationService; file: string }> {
  const directory = mkdtempSync(join(process.cwd(), 'collaboration-service-test-'))
  cleanup.push(directory)
  const file = join(directory, 'workspace.json')
  return { service: await LocalCollaborationService.open(file), file }
}

describe('LocalCollaborationService', () => {
  it('persists the authoritative local copy and stable author identity', async () => {
    const { service, file } = await serviceFixture()
    const initial = await service.getWorkspaceState()
    const document = await service.create({ kind: 'race-notes', title: 'Local authority' })
    await service.set({
      documentId: document.id,
      path: '/entries/start',
      value: { id: 'start', text: 'Start from pit lane' },
      message: 'Local note'
    })
    await service.setOnline(false)
    await service.flush()

    const reopened = await LocalCollaborationService.open(file)
    const state = await reopened.getWorkspaceState()
    const restored = await reopened.getDocument(document.id)

    expect(state.status.authority).toBe('local-primary')
    expect(state.status.transport).toBe('in-memory-mock-only')
    expect(state.status.networkEnabled).toBe(false)
    expect(state.status.online).toBe(false)
    expect(state.status.localActor).toEqual(initial.status.localActor)
    expect(restored.data.entries).toEqual({ start: { id: 'start', text: 'Start from pit lane' } })
    expect(restored.history.some((entry) => entry.author.id === initial.status.localActor.id)).toBe(true)

    await reopened.set({
      documentId: document.id,
      path: '/summary',
      value: 'Signed after restart'
    })
    const reopenedAgain = await LocalCollaborationService.open(file)
    expect((await reopenedAgain.getWorkspaceState()).status.localActor).toEqual(initial.status.localActor)
    expect((await reopenedAgain.getDocument(document.id)).data.summary).toBe('Signed after restart')
  })

  it('queues offline edits and visualizes the conflict after in-memory reconnection', async () => {
    const { service } = await serviceFixture()
    const document = await service.create({ kind: 'race-notes', title: 'Offline merge' })
    const initial = await service.getWorkspaceState()
    const editor = initial.peers.find((peer) =>
      peer.capabilities.includes('race-notes:write')
    )!

    await service.setOnline(false)
    await service.set({
      documentId: document.id,
      path: '/entries/turn-7',
      value: { id: 'turn-7', text: 'Local braking note' }
    })
    await service.mockEdit({
      peerId: editor.id,
      documentId: document.id,
      operation: {
        type: 'set',
        path: '/entries/turn-7',
        value: { id: 'turn-7', text: 'Crew braking note' }
      }
    })
    expect((await service.getWorkspaceState()).status.pendingChangeCount).toBeGreaterThan(0)
    expect((await service.getDocument(document.id)).conflicts).toHaveLength(0)

    await service.setOnline(true)
    const merged = await service.getDocument(document.id)
    expect(merged.conflicts).toHaveLength(1)
    expect(merged.conflicts[0].candidates.map((candidate) => candidate.author.id).sort()).toEqual(
      [initial.status.localActor.id, editor.actor.id].sort()
    )
    expect((await service.getWorkspaceState()).status.pendingChangeCount).toBe(0)
  })

  it('relays known authors deterministically across multiple capability peers', async () => {
    const { service, file } = await serviceFixture()
    const document = await service.create({ kind: 'race-notes', title: 'Three-way crew' })
    const before = await service.getWorkspaceState()
    await service.addMockPeer({ displayName: 'Second editor', access: 'editor' })
    const editors = (await service.getWorkspaceState()).peers.filter((peer) =>
      peer.capabilities.includes('race-notes:write')
    )
    expect(editors).toHaveLength(before.peers.filter((peer) => peer.capabilities.includes('race-notes:write')).length + 1)

    await service.setOnline(false)
    await service.mockEdit({
      peerId: editors[0].id,
      documentId: document.id,
      operation: { type: 'set', path: '/entries/one', value: { id: 'one', text: 'First peer' } }
    })
    await service.mockEdit({
      peerId: editors[1].id,
      documentId: document.id,
      operation: { type: 'set', path: '/entries/two', value: { id: 'two', text: 'Second peer' } }
    })

    await service.setOnline(true)
    expect((await service.getDocument(document.id)).data.entries).toEqual({
      one: { id: 'one', text: 'First peer' },
      two: { id: 'two', text: 'Second peer' }
    })

    await service.flush()
    const reopened = await LocalCollaborationService.open(file)
    expect((await reopened.getDocument(document.id)).data.entries).toEqual({
      one: { id: 'one', text: 'First peer' },
      two: { id: 'two', text: 'Second peer' }
    })
  })

  it('recovers a corrupt workspace without hiding the status', async () => {
    const { file } = await serviceFixture()
    writeFileSync(file, '{"broken":', 'utf8')

    const recovered = await LocalCollaborationService.open(file)
    const state = await recovered.getWorkspaceState()
    expect(state.documents).toHaveLength(0)
    expect(state.status.lastError).toMatch(/Recovered corrupt local collaboration workspace/)

    await recovered.flush()
    const reopened = await LocalCollaborationService.open(file)
    expect((await reopened.getWorkspaceState()).status.lastError).toBeUndefined()
  })

  it('rolls back every replica and preserves the durable file when a save fails', async () => {
    const directory = mkdtempSync(join(process.cwd(), 'collaboration-service-test-'))
    cleanup.push(directory)
    const file = join(directory, 'workspace.json')
    let failNextReplace = false
    const service = await LocalCollaborationService.open(file, {
      persistence: {
        replace: async (from, to) => {
          if (failNextReplace) {
            failNextReplace = false
            throw new Error('simulated durable replace failure')
          }
          await renameAsync(from, to)
        }
      }
    })
    const document = await service.create({ kind: 'race-notes', title: 'Durable plan' })

    failNextReplace = true
    await expect(service.set({
      documentId: document.id,
      path: '/entries/rollback',
      value: { id: 'rollback', text: 'Must not survive' }
    })).rejects.toThrow(/simulated durable replace failure/)
    expect((await service.getWorkspaceState()).status.lastError).toMatch(/save failed/i)
    expect((await service.getDocument(document.id)).data.entries).toBeUndefined()

    await service.sync()
    expect((await service.getDocument(document.id)).data.entries).toBeUndefined()
    const reopened = await LocalCollaborationService.open(file)
    expect((await reopened.getDocument(document.id)).data.entries).toBeUndefined()
  })

  it('enforces the final serialized workspace size and rolls back oversized mutations', async () => {
    const directory = mkdtempSync(join(process.cwd(), 'collaboration-service-test-'))
    cleanup.push(directory)
    const file = join(directory, 'workspace.json')
    const maximum = 8 * 1024
    const service = await LocalCollaborationService.open(file, { maxPersistedBytes: maximum })
    const document = await service.create({ kind: 'race-notes', title: 'Bounded plan' })

    await expect(service.set({
      documentId: document.id,
      path: '/entries/oversized',
      value: { id: 'oversized', text: 'x'.repeat(20_000) }
    })).rejects.toThrow(`exceeds ${maximum} bytes after serialization`)
    expect((await service.getDocument(document.id)).data.entries).toBeUndefined()

    const reopened = await LocalCollaborationService.open(file, { maxPersistedBytes: maximum })
    expect((await reopened.getDocument(document.id)).data.entries).toBeUndefined()
  })
})
