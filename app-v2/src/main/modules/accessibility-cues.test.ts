import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModuleContext } from '../module-context'
import {
  ACCESSIBILITY_CUE_CHANNELS,
  ACCESSIBILITY_CUE_PROTOCOL_VERSION,
  DEFAULT_ACCESSIBILITY_CUE_STORE,
  DEAF_HOH_CUE_PROFILE,
  cloneAccessibilityCueStore,
  getActiveCueProfile,
  serializeAccessibilityCueStore,
  type AccessibilityCueStateEnvelope
} from '../../shared/accessibility-cues'
import {
  CONFIG_SECTION_RELOAD_SIGNAL,
  CONFIG_SECTION_RESET_SIGNAL,
  isHotReloadSection
} from '../../shared/config-io'

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
  }),
  rm: vi.fn(async (path: string) => {
    memoryFs.files.delete(String(path))
  })
}))

function harness(userData = 'C:\\cue-profile-user') {
  const handlers = new Map<string, (...args: any[]) => any>()
  const listeners = new Map<string, Set<(...args: any[]) => void>>()
  const broadcast = vi.fn()
  const emit = (
    channel: string,
    event: unknown,
    ...args: unknown[]
  ): boolean => {
    const registered = [...(listeners.get(channel) ?? [])]
    for (const listener of registered) listener(event, ...args)
    return registered.length > 0
  }
  const ctx = {
    app: { getPath: () => userData, once: vi.fn() },
    ipcMain: {
      handle: (channel: string, handler: (...args: any[]) => any) =>
        handlers.set(channel, handler),
      on: (channel: string, listener: (...args: any[]) => void) => {
        const registered = listeners.get(channel) ?? new Set()
        registered.add(listener)
        listeners.set(channel, registered)
      },
      off: (channel: string, listener: (...args: any[]) => void) => {
        listeners.get(channel)?.delete(listener)
      },
      emit
    },
    broadcast
  } as unknown as ModuleContext
  return { ctx, handlers, broadcast, emit }
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

  it('hot-reloads imported profiles with a monotonic revision and broadcast', async () => {
    expect(isHotReloadSection('accessibility-cues')).toBe(true)
    const testHarness = harness()
    const module = await import('./accessibility-cues')
    module.register(testHarness.ctx)
    const initial = await testHarness.handlers
      .get(ACCESSIBILITY_CUE_CHANNELS.getState)
      ?.() as AccessibilityCueStateEnvelope
    const imported = cloneAccessibilityCueStore(DEFAULT_ACCESSIBILITY_CUE_STORE)
    imported.activeProfileId = DEAF_HOH_CUE_PROFILE.id
    imported.revision = 0
    memoryFs.files.set(
      'C:\\cue-profile-user\\accessibility-cues.json',
      serializeAccessibilityCueStore(imported)
    )
    const done = vi.fn()

    testHarness.emit(
      CONFIG_SECTION_RELOAD_SIGNAL,
      { source: 'test' },
      'accessibility-cues',
      done
    )
    const reloaded = await testHarness.handlers
      .get(ACCESSIBILITY_CUE_CHANNELS.getState)
      ?.() as AccessibilityCueStateEnvelope

    expect(reloaded.state.activeProfileId).toBe(DEAF_HOH_CUE_PROFILE.id)
    expect(reloaded.revision).toBeGreaterThan(initial.revision)
    await vi.waitFor(() =>
      expect(done).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          sectionId: 'accessibility-cues',
          hotAppliedCount: imported.profiles.length
        })
      )
    )
    expect(testHarness.broadcast).toHaveBeenLastCalledWith(
      ACCESSIBILITY_CUE_CHANNELS.stateEvent,
      reloaded
    )
  })

  it('drops cached profiles after a config-section reset', async () => {
    const testHarness = harness()
    const module = await import('./accessibility-cues')
    module.register(testHarness.ctx)
    const initial = await testHarness.handlers
      .get(ACCESSIBILITY_CUE_CHANNELS.getState)
      ?.() as AccessibilityCueStateEnvelope
    const selected = await testHarness.handlers
      .get(ACCESSIBILITY_CUE_CHANNELS.setActiveProfile)
      ?.(undefined, {
        protocolVersion: ACCESSIBILITY_CUE_PROTOCOL_VERSION,
        expectedRevision: initial.revision,
        profileId: DEAF_HOH_CUE_PROFILE.id
      }) as AccessibilityCueStateEnvelope

    const done = vi.fn()
    testHarness.emit(
      CONFIG_SECTION_RESET_SIGNAL,
      { source: 'test' },
      'accessibility-cues',
      done
    )
    const reset = await testHarness.handlers
      .get(ACCESSIBILITY_CUE_CHANNELS.getState)
      ?.() as AccessibilityCueStateEnvelope

    expect(selected.state.activeProfileId).toBe(DEAF_HOH_CUE_PROFILE.id)
    expect(reset.state.activeProfileId).toBe('standard')
    expect(reset.revision).toBeGreaterThan(selected.revision)
    expect(
      memoryFs.files.has('C:\\cue-profile-user\\accessibility-cues.json')
    ).toBe(false)
    await vi.waitFor(() =>
      expect(done).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ sectionId: 'accessibility-cues' })
      )
    )
  })

  it('accepts only versioned renderer audio availability reports', async () => {
    const testHarness = harness()
    const module = await import('./accessibility-cues')
    module.register(testHarness.ctx)
    const setAvailability = testHarness.handlers.get(
      ACCESSIBILITY_CUE_CHANNELS.setAudioAvailability
    )

    expect(module.isAccessibilityCueAudioAvailable()).toBe(false)
    await expect(
      setAvailability?.(undefined, {
        protocolVersion: ACCESSIBILITY_CUE_PROTOCOL_VERSION,
        available: true
      })
    ).resolves.toBe(true)
    expect(module.isAccessibilityCueAudioAvailable()).toBe(true)
    await expect(
      setAvailability?.(undefined, {
        protocolVersion: 999,
        available: false
      })
    ).rejects.toMatchObject({
      code: 'ACCESSIBILITY_CUE_INVALID_AUDIO_AVAILABILITY'
    })
    expect(module.isAccessibilityCueAudioAvailable()).toBe(true)
  })
})
