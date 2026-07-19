import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultRigPreflightState } from '../../shared/rig-preflight'
import {
  FileRigPreflightPersistence,
  type RigPreflightFileStep
} from './file-persistence'
import {
  RigPreflightService,
  RigPreflightStorageBlockedError
} from './service'

function persistedState(name: string, now: number): string {
  const state = defaultRigPreflightState(now)
  state.profile.name = name
  state.profile.updatedAt = now
  state.updatedAt = now
  return `${JSON.stringify(state, null, 2)}\n`
}

describe('FileRigPreflightPersistence commit and recovery semantics', () => {
  let root: string
  let path: string

  beforeEach(async () => {
    root = await mkdtemp(join(process.cwd(), 'rig-preflight-persistence-'))
    path = join(root, 'rig-preflight.json')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('keeps the committed primary and quarantines uncommitted .next/.previous leftovers', async () => {
    await writeFile(path, persistedState('Current profile', 9_000))
    await writeFile(`${path}.previous`, persistedState('Previous profile', 8_000))
    await writeFile(`${path}.next`, persistedState('Uncommitted next', 11_000))
    const service = new RigPreflightService({
      persistence: new FileRigPreflightPersistence(path, () => 12_000),
      now: () => 12_000,
      collectObservation: async () => ({ collectedAt: 12_000 })
    })

    const state = await service.getState()
    const files = await readdir(root)
    expect(state.profile.name).toBe('Current profile')
    expect(await readFile(path, 'utf8')).toContain('Current profile')
    expect(files).not.toContain('rig-preflight.json.next')
    expect(files).not.toContain('rig-preflight.json.previous')
    expect(files.filter((file) => file.includes('interrupted'))).toHaveLength(2)
  })

  it('restores .previous when replacement stopped after moving the primary aside', async () => {
    await writeFile(`${path}.previous`, persistedState('Recover me', 20_000))
    await writeFile(`${path}.next`, persistedState('Never committed', 21_000))
    const service = new RigPreflightService({
      persistence: new FileRigPreflightPersistence(path, () => 22_000),
      now: () => 22_000,
      collectObservation: async () => ({ collectedAt: 22_000 })
    })

    const state = await service.getState()
    expect(state.profile.name).toBe('Recover me')
    expect(state.storage.blocked).toBe(false)
    expect(await readFile(path, 'utf8')).toContain('Recover me')
    expect((await readdir(root)).some((file) => file.endsWith('next.json'))).toBe(true)
  })

  it('quarantines .next-only state and fails closed instead of treating it as committed', async () => {
    await writeFile(`${path}.next`, persistedState('Never committed', 30_000))
    const service = new RigPreflightService({
      persistence: new FileRigPreflightPersistence(path, () => 31_000),
      now: () => 31_000,
      collectObservation: async () => ({ collectedAt: 31_000 })
    })

    const state = await service.getState()
    expect(state.storage.state).toBe('error')
    expect(state.storage.blocked).toBe(true)
    expect(state.storage.message).toContain('no previously committed primary state')
    expect(state.profile.mode).toBe('full-rig')
    expect((await readdir(root)).some((file) => file.includes('interrupted'))).toBe(true)
  })

  const preCommitSteps: RigPreflightFileStep[] = [
    'mkdir',
    'write-next',
    'fsync-next',
    'remove-stale-previous',
    'rename-primary-previous',
    'rename-next-primary'
  ]

  for (const step of preCommitSteps) {
    it(`rolls back memory and restart state when ${step} fails before commit`, async () => {
      await writeFile(path, persistedState('Old committed profile', 40_000))
      if (step === 'remove-stale-previous') {
        await writeFile(`${path}.previous`, persistedState('Stale backup', 39_000))
      }
      let armed = true
      const persistence = new FileRigPreflightPersistence(
        path,
        () => 41_000,
        (current) => {
          if (armed && current === step) {
            armed = false
            throw new Error(`fault:${step}`)
          }
        }
      )
      const service = new RigPreflightService({
        persistence,
        now: () => 41_000,
        collectObservation: async () => ({ collectedAt: 41_000 })
      })
      const before = await service.getState()
      await expect(service.setProfile({
        ...before.profile,
        name: 'Must not commit'
      })).rejects.toBeInstanceOf(RigPreflightStorageBlockedError)
      const blocked = await service.getState()
      expect(blocked.profile.name).toBe('Old committed profile')
      expect(blocked.storage.blocked).toBe(true)

      const restarted = new RigPreflightService({
        persistence: new FileRigPreflightPersistence(path, () => 42_000),
        now: () => 42_000,
        collectObservation: async () => ({ collectedAt: 42_000 })
      })
      expect((await restarted.getState()).profile.name).toBe('Old committed profile')
      expect(await readFile(path, 'utf8')).toContain('Old committed profile')
    })
  }

  for (const step of ['fsync-directory', 'remove-previous'] as const) {
    it(`keeps the new state committed when ${step} fails after primary install`, async () => {
      await writeFile(path, persistedState('Old committed profile', 50_000))
      let armed = true
      const service = new RigPreflightService({
        persistence: new FileRigPreflightPersistence(
          path,
          () => 51_000,
          (current) => {
            if (armed && current === step) {
              armed = false
              throw new Error(`fault:${step}`)
            }
          }
        ),
        now: () => 51_000,
        collectObservation: async () => ({ collectedAt: 51_000 })
      })
      const before = await service.getState()
      const committed = await service.setProfile({
        ...before.profile,
        name: 'New committed profile'
      })
      expect(committed.profile.name).toBe('New committed profile')
      expect(committed.storage.blocked).toBe(false)
      expect(committed.storage.message).toContain('failed after commit')
      expect(await readFile(path, 'utf8')).toContain('New committed profile')

      const restarted = new RigPreflightService({
        persistence: new FileRigPreflightPersistence(path, () => 52_000),
        now: () => 52_000,
        collectObservation: async () => ({ collectedAt: 52_000 })
      })
      expect((await restarted.getState()).profile.name).toBe('New committed profile')
    })
  }

  it('does not resurrect failed waiver or certificate mutations after restart', async () => {
    let now = 60_000
    let fault: RigPreflightFileStep | null = null
    const persistence = new FileRigPreflightPersistence(
      path,
      () => now,
      (step) => {
        if (step === fault) {
          fault = null
          throw new Error(`fault:${step}`)
        }
      }
    )
    const service = new RigPreflightService({
      persistence,
      now: () => now,
      createId: () => `persist-${now}`,
      collectObservation: async () => ({ collectedAt: now })
    })
    const profile = (await service.getState()).profile
    await service.run({ profile })
    const certified = await service.getState()

    fault = 'rename-next-primary'
    await expect(service.createWaiver({
      checkId: 'simx',
      reason: 'Must fail',
      owner: 'Crew chief',
      expiresAt: now + 10_000
    })).rejects.toBeInstanceOf(RigPreflightStorageBlockedError)
    expect((await service.getState()).waivers).toEqual([])

    const recovered = await service.setProfile({
      ...(await service.getState()).profile,
      name: 'Storage recovered'
    })
    expect(recovered.storage.blocked).toBe(false)
    await service.run({ profile: recovered.profile })
    const active = await service.getState()
    fault = 'rename-next-primary'
    await expect(service.invalidateActiveCertificate(
      'Must not persist',
      [{ kind: 'runtime', source: 'test' }]
    )).rejects.toBeInstanceOf(RigPreflightStorageBlockedError)
    expect((await service.getState()).activeCertificate?.invalidatedAt).toBeNull()

    now += 1
    const restarted = new RigPreflightService({
      persistence: new FileRigPreflightPersistence(path, () => now),
      now: () => now,
      collectObservation: async () => ({ collectedAt: now })
    })
    const restored = await restarted.getState()
    expect(restored.waivers).toEqual([])
    expect(restored.activeCertificate?.runId).toBe(active.activeCertificate?.runId)
    expect(restored.activeCertificate?.invalidatedAt).toBeNull()
    expect(restored.profile.name).toBe('Storage recovered')
    expect(certified.activeCertificate).not.toBeNull()
  })
})
