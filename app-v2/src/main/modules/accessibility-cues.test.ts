import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModuleContext } from '../module-context'
import {
  ACCESSIBILITY_CUE_CHANNELS,
  ACCESSIBILITY_CUE_PROTOCOL_VERSION,
  DEAF_HOH_CUE_PROFILE,
  getActiveCueProfile,
  type AccessibilityCueStateEnvelope
} from '../../shared/accessibility-cues'

const memoryFs = vi.hoisted(() => ({
  files: new Map<string, string>(),
  readBlock: null as Promise<void> | null
}))

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(async (path: string) => {
    if (memoryFs.readBlock) await memoryFs.readBlock
    const value = memoryFs.files.get(String(path))
    if (value === undefined) {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    }
    return value
  }),
  writeFile: vi.fn(async (path: string, value: unknown) => {
    memoryFs.files.set(String(path), String(value))
  })
}))

function harness(userData = 'C:\\cue-profile-user') {
  const handlers = new Map<string, (...args: any[]) => any>()
  const broadcast = vi.fn()
  const ctx = {
    app: { getPath: () => userData },
    ipcMain: {
      handle: (channel: string, handler: (...args: any[]) => any) =>
        handlers.set(channel, handler)
    },
    broadcast
  } as unknown as ModuleContext
  return { ctx, handlers, broadcast }
}

function blockRead(): () => void {
  let release = (): void => undefined
  memoryFs.readBlock = new Promise<void>((resolve) => {
    release = resolve
  })
  return () => {
    memoryFs.readBlock = null
    release()
  }
}

beforeEach(() => {
  memoryFs.files.clear()
  memoryFs.readBlock = null
  vi.resetModules()
})

describe('accessibility cue profile readiness and versioning', () => {
  it('broadcasts not-ready first and exposes a ready versioned envelope after load', async () => {
    const release = blockRead()
    const testHarness = harness()
    const module = await import('./accessibility-cues')
    module.register(testHarness.ctx)

    expect(module.isAccessibilityCueProfileReady()).toBe(false)
    expect(testHarness.broadcast).toHaveBeenCalledWith(
      ACCESSIBILITY_CUE_CHANNELS.stateEvent,
      expect.objectContaining({
        protocolVersion: ACCESSIBILITY_CUE_PROTOCOL_VERSION,
        ready: false,
        revision: 0
      })
    )

    release()
    const readyEnvelope = await testHarness.handlers
      .get(ACCESSIBILITY_CUE_CHANNELS.getState)
      ?.() as AccessibilityCueStateEnvelope

    expect(module.isAccessibilityCueProfileReady()).toBe(true)
    expect(module.getActiveAccessibilityCueProfile()).not.toBeNull()
    expect(readyEnvelope).toMatchObject({
      protocolVersion: ACCESSIBILITY_CUE_PROTOCOL_VERSION,
      ready: true,
      revision: 1
    })
  })

  it('persists serialized mutations and rejects stale rapid edits', async () => {
    const testHarness = harness()
    const module = await import('./accessibility-cues')
    module.register(testHarness.ctx)
    const initial = await testHarness.handlers
      .get(ACCESSIBILITY_CUE_CHANNELS.getState)
      ?.() as AccessibilityCueStateEnvelope
    const save = testHarness.handlers.get(ACCESSIBILITY_CUE_CHANNELS.saveProfile)

    const first = await save?.(undefined, {
      protocolVersion: ACCESSIBILITY_CUE_PROTOCOL_VERSION,
      expectedRevision: initial.revision,
      profile: {
        ...DEAF_HOH_CUE_PROFILE,
        textScale: 1.55
      }
    }) as AccessibilityCueStateEnvelope

    await expect(
      save?.(undefined, {
        protocolVersion: ACCESSIBILITY_CUE_PROTOCOL_VERSION,
        expectedRevision: initial.revision,
        profile: {
          ...DEAF_HOH_CUE_PROFILE,
          highContrast: false
        }
      })
    ).rejects.toMatchObject({
      code: 'ACCESSIBILITY_CUE_REVISION_CONFLICT',
      currentRevision: first.revision
    })

    expect(getActiveCueProfile(first.state).id).toBe('standard')
    expect(first.state.profiles.find((profile) => profile.id === 'deaf-hoh')).toMatchObject({
      textScale: 1.55
    })
    expect([...memoryFs.files.values()].some((text) => text.includes('"revision": 2'))).toBe(
      true
    )
  })

  it('fails closed to defaults when persisted JSON is malformed', async () => {
    memoryFs.files.set(
      'C:\\cue-profile-user\\accessibility-cues.json',
      '{not-json'
    )
    const testHarness = harness()
    const module = await import('./accessibility-cues')
    module.register(testHarness.ctx)
    const restored = await testHarness.handlers
      .get(ACCESSIBILITY_CUE_CHANNELS.getState)
      ?.() as AccessibilityCueStateEnvelope

    expect(restored.ready).toBe(true)
    expect(restored.revision).toBe(1)
    expect(restored.state.activeProfileId).toBe('standard')
  })
})
