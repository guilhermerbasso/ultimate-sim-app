import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModuleContext } from '../module-context'
import {
  ACCESSIBILITY_CUE_CHANNELS,
  DEAF_HOH_CUE_PROFILE,
  getActiveCueProfile,
  type AccessibilityCueStore
} from '../../shared/accessibility-cues'

const memoryFs = vi.hoisted(() => ({
  files: new Map<string, string>()
}))

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(async (path: string) => {
    const value = memoryFs.files.get(String(path))
    if (value === undefined) {
      const error = Object.assign(new Error('missing'), { code: 'ENOENT' })
      throw error
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

beforeEach(() => {
  memoryFs.files.clear()
  vi.resetModules()
})

describe('accessibility cue profile module persistence', () => {
  it('persists per-user overrides and restores the active profile', async () => {
    const first = harness()
    const module = await import('./accessibility-cues')
    module.register(first.ctx)
    const getState = first.handlers.get(ACCESSIBILITY_CUE_CHANNELS.getState)
    const saveProfile = first.handlers.get(ACCESSIBILITY_CUE_CHANNELS.saveProfile)
    const setActiveProfile = first.handlers.get(
      ACCESSIBILITY_CUE_CHANNELS.setActiveProfile
    )
    expect(getState).toBeTypeOf('function')
    expect(saveProfile).toBeTypeOf('function')
    expect(setActiveProfile).toBeTypeOf('function')
    await getState?.()

    await saveProfile?.(undefined, {
      ...DEAF_HOH_CUE_PROFILE,
      textScale: 1.55,
      overrides: {
        'alert.flag': {
          modalities: { haptic: false, audio: true }
        }
      }
    })
    const saved = await setActiveProfile?.(
      undefined,
      'deaf-hoh'
    ) as AccessibilityCueStore

    expect(saved.activeProfileId).toBe('deaf-hoh')
    expect(getActiveCueProfile(saved)).toMatchObject({
      textScale: 1.55,
      overrides: {
        'alert.flag': {
          modalities: { haptic: false, audio: true }
        }
      }
    })
    expect(
      [...memoryFs.files.values()].some((text) =>
        text.includes('"activeProfileId": "deaf-hoh"')
      )
    ).toBe(true)

    vi.resetModules()
    const second = harness()
    const reloadedModule = await import('./accessibility-cues')
    reloadedModule.register(second.ctx)
    const restored = await second.handlers.get(
      ACCESSIBILITY_CUE_CHANNELS.getState
    )?.() as AccessibilityCueStore

    expect(restored.activeProfileId).toBe('deaf-hoh')
    expect(getActiveCueProfile(restored).overrides['alert.flag']?.modalities).toEqual({
      haptic: false,
      audio: true
    })
  })

  it('fails closed to built-in defaults when persisted JSON is malformed', async () => {
    memoryFs.files.set(
      'C:\\cue-profile-user\\accessibility-cues.json',
      '{not-json'
    )
    const testHarness = harness()
    const module = await import('./accessibility-cues')
    module.register(testHarness.ctx)
    const restored = await testHarness.handlers.get(
      ACCESSIBILITY_CUE_CHANNELS.getState
    )?.() as AccessibilityCueStore

    expect(restored.activeProfileId).toBe('standard')
    expect(restored.profiles.map((profile) => profile.id)).toEqual([
      'standard',
      'low-vision-blind',
      'deaf-hoh'
    ])
  })
})
