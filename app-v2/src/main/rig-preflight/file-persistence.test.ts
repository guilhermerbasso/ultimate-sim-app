import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultRigPreflightState } from '../../shared/rig-preflight'
import { FileRigPreflightPersistence } from './file-persistence'
import { RigPreflightService } from './service'

function persistedState(name: string, now: number): string {
  const state = defaultRigPreflightState(now)
  state.profile.name = name
  state.profile.updatedAt = now
  state.updatedAt = now
  return `${JSON.stringify(state, null, 2)}\n`
}

describe('FileRigPreflightPersistence interrupted replacement recovery', () => {
  let root: string
  let path: string

  beforeEach(async () => {
    root = await mkdtemp(join(process.cwd(), 'rig-preflight-persistence-'))
    path = join(root, 'rig-preflight.json')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('promotes a valid .next state and quarantines the interrupted .previous backup', async () => {
    await writeFile(path, persistedState('Current profile', 9_000))
    await writeFile(`${path}.previous`, persistedState('Previous profile', 10_000))
    await writeFile(`${path}.next`, persistedState('Next profile', 11_000))
    const service = new RigPreflightService({
      persistence: new FileRigPreflightPersistence(path, () => 12_000),
      now: () => 12_000,
      collectObservation: async () => ({ collectedAt: 12_000 })
    })

    const state = await service.getState()
    const files = await readdir(root)
    expect(state.profile.name).toBe('Next profile')
    expect(state.storage.state).toBe('ok')
    expect(await readFile(path, 'utf8')).toContain('Next profile')
    expect(files).not.toContain('rig-preflight.json.next')
    expect(files).not.toContain('rig-preflight.json.previous')
    expect(files.some((file) => file.includes('interrupted') && file.endsWith('current.json'))).toBe(true)
    expect(files.some((file) => file.includes('interrupted') && file.endsWith('previous.json'))).toBe(true)
  })

  it('restores .previous when replacement stopped after moving the primary aside', async () => {
    await writeFile(`${path}.previous`, persistedState('Recover me', 20_000))
    const service = new RigPreflightService({
      persistence: new FileRigPreflightPersistence(path, () => 21_000),
      now: () => 21_000,
      collectObservation: async () => ({ collectedAt: 21_000 })
    })

    const state = await service.getState()
    expect(state.profile.name).toBe('Recover me')
    expect(state.storage.blocked).toBe(false)
    expect(await readFile(path, 'utf8')).toContain('Recover me')
  })

  it('quarantines unrecoverable artifacts and fails closed instead of loading a default profile', async () => {
    await writeFile(`${path}.next`, '{not-json')
    await writeFile(`${path}.previous`, '[]')
    const service = new RigPreflightService({
      persistence: new FileRigPreflightPersistence(path, () => 30_000),
      now: () => 30_000,
      collectObservation: async () => ({ collectedAt: 30_000 })
    })

    const state = await service.getState()
    const files = await readdir(root)
    expect(state.storage.state).toBe('error')
    expect(state.storage.blocked).toBe(true)
    expect(state.storage.message).toContain('no recoverable JSON state')
    expect(state.profile.mode).toBe('full-rig')
    expect(files.filter((file) => file.includes('interrupted'))).toHaveLength(2)
    expect(files).not.toContain('rig-preflight.json.next')
    expect(files).not.toContain('rig-preflight.json.previous')
  })
})
