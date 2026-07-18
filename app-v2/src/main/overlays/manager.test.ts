import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { OverlayManager } from './manager'
import { OVERLAY_WIDGETS, type OverlaysConfig } from '../../shared/overlays'
import {
  OVERLAY_EDITOR_PREVIEW_CHANNELS,
  type OverlayEditorPreviewState
} from '../../shared/overlay-editor-preview'
import { ALL_VARIANTS, variantToElement } from '../../renderer/src/views/dashboard/widget-catalog-data'
import type { ModuleContext } from '../module-context'

// The manager's save/scheduleSave/dispose are private; the resurrection bug is
// entirely about whether dispose() flushes a pending in-memory config back to
// disk. We poke the private save scheduler + read the timer to drive it without
// Electron windows (load()/createWindow touch BrowserWindow/screen); the one
// load persistence test below replaces those hooks with no-ops.
interface ManagerInternals {
  windows: Map<string, {
    isDestroyed(): boolean
    setIgnoreMouseEvents(ignore: boolean, options: { forward: boolean }): void
    webContents: { send(...args: unknown[]): void }
  }>
  config: OverlaysConfig
  runtimeHiddenAlerts: Set<string>
  editorTriggerPreviewActive: boolean
  saveTimer: ReturnType<typeof setTimeout> | null
  resetPending: boolean
  isDisposing: boolean
  scheduleSave(): void
  broadcastState(): void
  broadcastList(): void
  registerScreenListeners(): void
  createWindow(id: string): void
  setRuntimeVisibility(id: string, visible: boolean): void
  setEditorPreviewActive(active: boolean): void
}

function internals(mgr: OverlayManager): ManagerInternals {
  return mgr as unknown as ManagerInternals
}

// Minimal ModuleContext: the constructor + save() only need app.getPath('userData').
function makeCtx(userData: string): ModuleContext {
  return { app: { getPath: () => userData } } as unknown as ModuleContext
}

// setFavorite/toggle broadcast state when NOT disposing, so they need a no-op
// broadcast + a null main window (we never create real BrowserWindows here).
function makeBroadcastCtx(userData: string): ModuleContext {
  return {
    app: { getPath: () => userData },
    broadcast: () => {},
    getMainWindow: () => null
  } as unknown as ModuleContext
}

function makeHeadlessManager(userData: string): OverlayManager {
  const manager = new OverlayManager(makeBroadcastCtx(userData))
  internals(manager).registerScreenListeners = () => {}
  internals(manager).createWindow = () => {}
  return manager
}

interface PreviewOwnerWebContents extends EventEmitter {
  id: number
  destroyed: boolean
  loadingMainFrame: boolean
  isDestroyed(): boolean
  isLoadingMainFrame(): boolean
}

interface PreviewOwnerWindow extends EventEmitter {
  webContents: PreviewOwnerWebContents
  destroyed: boolean
  visible: boolean
  isDestroyed(): boolean
  isVisible(): boolean
}

interface PreviewLifecycleHarness {
  manager: OverlayManager
  state: ManagerInternals
  mainWindow: PreviewOwnerWindow
  owner: PreviewOwnerWebContents
  ignored: boolean[]
  sent: Array<[string, unknown]>
  triggerBefore: unknown
  setActive(active: boolean): boolean
}

function makePreviewLifecycleHarness(userData: string): PreviewLifecycleHarness {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const owner = new EventEmitter() as PreviewOwnerWebContents
  owner.id = 701
  owner.destroyed = false
  owner.loadingMainFrame = false
  owner.isDestroyed = () => owner.destroyed
  owner.isLoadingMainFrame = () => owner.loadingMainFrame

  const mainWindow = new EventEmitter() as PreviewOwnerWindow
  mainWindow.webContents = owner
  mainWindow.destroyed = false
  mainWindow.visible = true
  mainWindow.isDestroyed = () => mainWindow.destroyed
  mainWindow.isVisible = () => mainWindow.visible

  const manager = new OverlayManager({
    app: { getPath: () => userData },
    broadcast: () => {},
    getMainWindow: () => mainWindow,
    ipcMain: {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }
    }
  } as unknown as ModuleContext)
  const state = internals(manager)
  const ignored: boolean[] = []
  const sent: Array<[string, unknown]> = []
  state.windows.set('flags', {
    isDestroyed: () => false,
    setIgnoreMouseEvents: (ignore) => ignored.push(ignore),
    webContents: {
      send: (...args: unknown[]) => sent.push([String(args[0]), args[1]])
    }
  })
  state.config.configMode = true
  const triggerBefore = structuredClone(state.config.widgets.flags.trigger)
  state.setRuntimeVisibility('flags', false)
  manager.registerIpc()
  const handler = handlers.get(OVERLAY_EDITOR_PREVIEW_CHANNELS.setActive)
  if (!handler) throw new Error('Editor preview IPC handler was not registered')

  return {
    manager,
    state,
    mainWindow,
    owner,
    ignored,
    sent,
    triggerBefore,
    setActive: (active) => Boolean(handler({ sender: owner }, active))
  }
}

interface IdentityWidget { widgetId?: string; hifiModuleId?: string }

const identityPairs = (widgets: readonly IdentityWidget[]): Array<[string | null, string | null]> => widgets.map((widget) => [widget.widgetId ?? null, widget.hifiModuleId ?? null])
const overlayIdentityPairs = (overlays: ReadonlyArray<{ widgets?: IdentityWidget[] }>): Array<[string | null, string | null]> => identityPairs(overlays.flatMap((overlay) => overlay.widgets ?? []))

describe('OverlayManager reset (no overlays.json resurrection on quit)', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(process.cwd(), 'overlays-reset-test-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('does NOT re-persist overlays.json on dispose after dropInMemoryForReset (delete stays gone)', async () => {
    const mgr = new OverlayManager(makeCtx(root))
    // A background display event (captureBounds → scheduleSave) queues a pending
    // debounced save of the still-in-memory overlays config.
    internals(mgr).scheduleSave()
    expect(internals(mgr).saveTimer).not.toBeNull()

    // User deletes the `overlays` section → config-export signals the manager,
    // which must cancel the pending flush and latch a no-persist flag.
    mgr.dropInMemoryForReset()
    expect(internals(mgr).saveTimer).toBeNull()

    // "Reiniciar agora" → app.quit() → before-quit dispose() flush. With the
    // reset latched, dispose() must write NOTHING, so the deleted file stays gone.
    await mgr.dispose()
    expect(existsSync(join(root, 'overlays.json'))).toBe(false)
  })

  it('a save scheduled AFTER the reset is also suppressed (no late resurrection)', async () => {
    const mgr = new OverlayManager(makeCtx(root))
    mgr.dropInMemoryForReset()
    // A later display event tries to schedule another save — the latch drops it.
    internals(mgr).scheduleSave()
    expect(internals(mgr).saveTimer).toBeNull()
    await mgr.dispose()
    expect(existsSync(join(root, 'overlays.json'))).toBe(false)
  })

  it('CONTRAST: without the reset, a pending save IS flushed on dispose (proves the flush path is real)', async () => {
    const mgr = new OverlayManager(makeCtx(root))
    internals(mgr).scheduleSave()
    await mgr.dispose()
    // The before-quit flush wrote the in-memory config to disk — exactly the
    // path the reset neutralizes in the tests above.
    expect(existsSync(join(root, 'overlays.json'))).toBe(true)
  })

  it('a genuine user edit after the reset clears the latch so re-created overlays persist (N1)', async () => {
    const mgr = new OverlayManager(makeCtx(root))
    mgr.dropInMemoryForReset()
    expect(internals(mgr).resetPending).toBe(true)
    // addCustom/updateCustom/removeCustom/setConfig/toggle/setStyle/setLocked/
    // setOpacity all clear the latch (resetPending=false) before saving, so a
    // config the user re-creates BEFORE restarting is no longer dropped.
    internals(mgr).resetPending = false
    internals(mgr).scheduleSave()
    expect(internals(mgr).saveTimer).not.toBeNull()
    await mgr.dispose()
    expect(existsSync(join(root, 'overlays.json'))).toBe(true)
  })
})

describe('OverlayManager.broadcastState is crash-proof during teardown', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(process.cwd(), 'overlays-broadcast-test-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('does NOT throw when broadcasting while disposing (covers the late save().then(broadcastState) on quit)', async () => {
    // makeCtx provides no `broadcast`/`getMainWindow`: this mirrors the real crash
    // where a pending debounced save resolves AFTER dispose() destroyed the windows
    // and the old broadcastState reached into a destroyed webContents. The
    // isDisposing guard must short-circuit before touching the context at all.
    const mgr = new OverlayManager(makeCtx(root))
    await mgr.dispose()
    expect(internals(mgr).isDisposing).toBe(true)
    expect(() => internals(mgr).broadcastState()).not.toThrow()
  })

  it('does NOT throw when the main window is destroyed (defense in depth, isDisposing false)', () => {
    // A destroyed BrowserWindow whose webContents.send would throw "Object has been
    // destroyed" if ever reached — the window/webContents isDestroyed() guards must
    // skip the send entirely.
    const destroyedWindow = {
      isDestroyed: () => true,
      webContents: {
        isDestroyed: () => true,
        send: () => {
          throw new Error('Object has been destroyed')
        },
      },
    }
    const ctx = {
      app: { getPath: () => root },
      broadcast: () => {},
      getMainWindow: () => destroyedWindow,
    } as unknown as ModuleContext

    const mgr = new OverlayManager(ctx)
    // isDisposing stays false: this isolates the per-window send guard from the
    // top-level disposing short-circuit.
    expect(internals(mgr).isDisposing).toBe(false)
    expect(() => internals(mgr).broadcastState()).not.toThrow()
  })

  it('broadcastList does NOT throw while disposing (late drag/resize IPC on quit)', async () => {
    // broadcastList is the high-frequency drag/resize path. A late bounds IPC could
    // resolve after dispose() destroyed the windows; the isDisposing short-circuit
    // must prevent it touching a destroyed webContents (→ process.exit(1) bypass).
    const mgr = new OverlayManager(makeCtx(root))
    await mgr.dispose()
    expect(internals(mgr).isDisposing).toBe(true)
    expect(() => internals(mgr).broadcastList()).not.toThrow()
  })

  it('broadcastList does NOT throw when the main window is destroyed (isDisposing false)', () => {
    const destroyedWindow = {
      isDestroyed: () => true,
      webContents: {
        isDestroyed: () => true,
        send: () => {
          throw new Error('Object has been destroyed')
        },
      },
    }
    const ctx = {
      app: { getPath: () => root },
      broadcast: () => {},
      getMainWindow: () => destroyedWindow,
    } as unknown as ModuleContext

    const mgr = new OverlayManager(ctx)
    expect(internals(mgr).isDisposing).toBe(false)
    expect(() => internals(mgr).broadcastList()).not.toThrow()
  })
})

describe('OverlayManager favorite (config-list shortcut, persisted)', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(process.cwd(), 'overlays-fav-test-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('setFavorite flips the flag, returns it in list(), and persists to overlays.json', async () => {
    const id = OVERLAY_WIDGETS[0].id
    const mgr = new OverlayManager(makeBroadcastCtx(root))

    const list = await mgr.setFavorite(id, true)
    expect(list.find((item) => item.id === id)?.favorite).toBe(true)

    const onDisk = JSON.parse(readFileSync(join(root, 'overlays.json'), 'utf8')) as {
      widgets: Record<string, { favorite?: boolean }>
    }
    expect(onDisk.widgets[id].favorite).toBe(true)
  })

  it('setFavorite(false) clears a previously-set favorite', async () => {
    const id = OVERLAY_WIDGETS[0].id
    const mgr = new OverlayManager(makeBroadcastCtx(root))
    await mgr.setFavorite(id, true)
    const list = await mgr.setFavorite(id, false)
    expect(list.find((item) => item.id === id)?.favorite).toBe(false)
  })

  it('rejects an unknown widget id (favorite is built-in-widgets only)', async () => {
    const mgr = new OverlayManager(makeBroadcastCtx(root))
    await expect(mgr.setFavorite('not-a-real-widget' as never, true)).rejects.toThrow()
  })

  it('clears the reset latch so a favorite set after a delete still persists', async () => {
    const id = OVERLAY_WIDGETS[0].id
    const mgr = new OverlayManager(makeBroadcastCtx(root))
    mgr.dropInMemoryForReset()
    expect(internals(mgr).resetPending).toBe(true)
    await mgr.setFavorite(id, true)
    expect(internals(mgr).resetPending).toBe(false)
    expect(existsSync(join(root, 'overlays.json'))).toBe(true)
  })
})

describe('OverlayManager trigger persistence migration', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(process.cwd(), 'overlays-trigger-test-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('rejects alert always overrides while preserving ordinary explicit overrides', async () => {
    const manager = makeHeadlessManager(root)
    const config = await manager.setConfig({
      widgets: {
        flags: { trigger: { kind: 'always' } },
        gearSpeed: { trigger: { kind: 'always' } },
        'hifi:alert2EngineWarning': {
          id: 'hifi:alert2EngineWarning',
          hifiModuleId: 'alert2EngineWarning',
          trigger: { kind: 'always' }
        },
        'hifi:speed': {
          id: 'hifi:speed',
          hifiModuleId: 'speed',
          trigger: { kind: 'always' }
        },
        'hifi:futureWarning': {
          id: 'hifi:futureWarning',
          hifiModuleId: 'futureWarning',
          role: 'alert',
          trigger: { kind: 'always' }
        }
      } as never
    })

    expect(config.widgets.flags.trigger).toEqual({ kind: 'semantic', semantic: 'raceControlFlags' })
    expect(config.widgets.gearSpeed.trigger).toEqual({ kind: 'always' })
    expect(config.widgets['hifi:alert2EngineWarning'].trigger).toEqual({
      kind: 'semantic',
      semantic: 'alert2EngineWarning'
    })
    expect(config.widgets['hifi:speed'].trigger).toEqual({ kind: 'always' })
    expect(config.widgets['hifi:futureWarning']).toMatchObject({ role: 'alert', trigger: { kind: 'never' } })

    const persisted = JSON.parse(readFileSync(join(root, 'overlays.json'), 'utf8')) as {
      widgets: Record<string, { trigger?: unknown }>
    }
    expect(persisted.widgets.flags.trigger).toEqual(config.widgets.flags.trigger)
    expect(persisted.widgets.gearSpeed.trigger).toEqual({ kind: 'always' })
  })
})

describe('OverlayManager inactive alert hit testing', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(process.cwd(), 'overlays-hit-test-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('forces an inactive unlocked alert window click-through and restores interactivity when active', () => {
    const manager = makeHeadlessManager(root)
    const ignored: boolean[] = []
    internals(manager).windows.set('flags', {
      isDestroyed: () => false,
      setIgnoreMouseEvents: (ignore) => ignored.push(ignore),
      webContents: { send: () => {} }
    })

    internals(manager).setRuntimeVisibility('flags', false)
    internals(manager).setRuntimeVisibility('flags', true)
    expect(ignored).toEqual([true, false])
  })

  it('does not let renderer visibility messages change ordinary overlay hit testing', () => {
    const manager = makeHeadlessManager(root)
    const ignored: boolean[] = []
    internals(manager).windows.set('gearSpeed', {
      isDestroyed: () => false,
      setIgnoreMouseEvents: (ignore) => ignored.push(ignore),
      webContents: { send: () => {} }
    })

    internals(manager).setRuntimeVisibility('gearSpeed', false)
    expect(ignored).toEqual([])
  })

  it('uses an isolated editor ghost channel for inactive draggable positioning', () => {
    const manager = makeHeadlessManager(root)
    const state = internals(manager)
    const ignored: boolean[] = []
    const sent: Array<[string, unknown]> = []
    state.windows.set('flags', {
      isDestroyed: () => false,
      setIgnoreMouseEvents: (ignore) => ignored.push(ignore),
      webContents: {
        send: (...args: unknown[]) => sent.push([String(args[0]), args[1]])
      }
    })
    state.config.configMode = true
    const triggerBefore = structuredClone(state.config.widgets.flags.trigger)

    state.setRuntimeVisibility('flags', false)
    expect(state.runtimeHiddenAlerts.has('flags')).toBe(true)
    expect(ignored.at(-1)).toBe(true)

    state.setEditorPreviewActive(true)
    expect(state.runtimeHiddenAlerts.has('flags')).toBe(true)
    expect(state.editorTriggerPreviewActive).toBe(true)
    expect(ignored.at(-1)).toBe(false)
    const previewStates = sent
      .filter(([channel]) => channel === OVERLAY_EDITOR_PREVIEW_CHANNELS.state)
      .map(([, payload]) => payload as OverlayEditorPreviewState)
    expect(previewStates.at(-1)).toEqual({ active: true })
    expect(sent.some(([channel]) => channel.includes('compositor'))).toBe(false)
    expect(state.config.widgets.flags.trigger).toEqual(triggerBefore)

    state.setEditorPreviewActive(false)
    expect(state.runtimeHiddenAlerts.has('flags')).toBe(true)
    expect(ignored.at(-1)).toBe(true)
    expect(
      sent
        .filter(([channel]) => channel === OVERLAY_EDITOR_PREVIEW_CHANNELS.state)
        .at(-1)?.[1]
    ).toEqual({ active: false })
    expect(existsSync(join(root, 'overlays.json'))).toBe(false)
  })
})

describe('OverlayManager editor preview ownership lifecycle', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(process.cwd(), 'overlays-preview-owner-test-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('mounts one owner lifecycle and removes it when the renderer releases preview', () => {
    const harness = makePreviewLifecycleHarness(root)

    expect(harness.setActive(true)).toBe(true)
    expect(harness.setActive(true)).toBe(true)
    expect(harness.state.editorTriggerPreviewActive).toBe(true)
    expect(harness.mainWindow.listenerCount('hide')).toBe(1)
    expect(harness.mainWindow.listenerCount('closed')).toBe(1)
    expect(harness.owner.listenerCount('did-start-navigation')).toBe(1)
    expect(harness.owner.listenerCount('render-process-gone')).toBe(1)
    expect(harness.owner.listenerCount('destroyed')).toBe(1)

    expect(harness.setActive(false)).toBe(true)
    expect(harness.state.editorTriggerPreviewActive).toBe(false)
    expect(harness.mainWindow.listenerCount('hide')).toBe(0)
    expect(harness.mainWindow.listenerCount('closed')).toBe(0)
    expect(harness.owner.listenerCount('did-start-navigation')).toBe(0)
    expect(harness.owner.listenerCount('render-process-gone')).toBe(0)
    expect(harness.owner.listenerCount('destroyed')).toBe(0)
  })

  it('rejects stale activation while the main window is hidden or reloading', () => {
    const harness = makePreviewLifecycleHarness(root)

    expect(harness.setActive(true)).toBe(true)
    harness.mainWindow.visible = false
    expect(harness.setActive(true)).toBe(false)
    expect(harness.state.editorTriggerPreviewActive).toBe(false)

    harness.mainWindow.visible = true
    expect(harness.setActive(true)).toBe(true)
    harness.owner.loadingMainFrame = true
    expect(harness.setActive(true)).toBe(false)
    expect(harness.state.editorTriggerPreviewActive).toBe(false)
    expect(harness.mainWindow.listenerCount('hide')).toBe(0)
    expect(harness.owner.listenerCount('did-start-navigation')).toBe(0)
  })

  it('ignores subframe navigation but clears on main-frame navigation/reload', () => {
    const harness = makePreviewLifecycleHarness(root)
    expect(harness.setActive(true)).toBe(true)

    harness.owner.emit('did-start-navigation', {}, 'file://subframe', false, false)
    expect(harness.state.editorTriggerPreviewActive).toBe(true)

    harness.owner.emit('did-start-navigation', {}, 'file://main', false, true)
    expect(harness.state.editorTriggerPreviewActive).toBe(false)
  })

  const ownerLossCases: Array<{
    name: string
    emit(harness: PreviewLifecycleHarness): void
  }> = [
    {
      name: 'main-window hide',
      emit: ({ mainWindow }) => {
        mainWindow.visible = false
        mainWindow.emit('hide')
      }
    },
    {
      name: 'main-frame navigation/reload',
      emit: ({ owner }) => owner.emit('did-start-navigation', {}, 'file://main', false, true)
    },
    {
      name: 'renderer process loss/crash',
      emit: ({ owner }) => owner.emit('render-process-gone', {}, { reason: 'crashed' })
    },
    {
      name: 'renderer destruction',
      emit: ({ owner }) => owner.emit('destroyed')
    },
    {
      name: 'main-window destruction',
      emit: ({ mainWindow }) => mainWindow.emit('closed')
    }
  ]

  it.each(ownerLossCases)(
    'clears the ghost on $name without touching runtime state, saved rules, or compositor',
    ({ emit }) => {
      const harness = makePreviewLifecycleHarness(root)
      expect(harness.setActive(true)).toBe(true)
      expect(harness.state.editorTriggerPreviewActive).toBe(true)
      expect(harness.ignored.at(-1)).toBe(false)

      emit(harness)

      expect(harness.state.editorTriggerPreviewActive).toBe(false)
      expect(harness.state.runtimeHiddenAlerts.has('flags')).toBe(true)
      expect(harness.ignored.at(-1)).toBe(true)
      expect(harness.state.config.widgets.flags.trigger).toEqual(harness.triggerBefore)
      expect(
        harness.sent
          .filter(([channel]) => channel === OVERLAY_EDITOR_PREVIEW_CHANNELS.state)
          .at(-1)?.[1]
      ).toEqual({ active: false })
      expect(harness.sent.some(([channel]) => channel.includes('compositor'))).toBe(false)
      expect(existsSync(join(root, 'overlays.json'))).toBe(false)
      expect(harness.mainWindow.listenerCount('hide')).toBe(0)
      expect(harness.mainWindow.listenerCount('closed')).toBe(0)
      expect(harness.owner.listenerCount('did-start-navigation')).toBe(0)
      expect(harness.owner.listenerCount('render-process-gone')).toBe(0)
      expect(harness.owner.listenerCount('destroyed')).toBe(0)
    }
  )
})

describe('OverlayManager custom overlay creation metadata', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(process.cwd(), 'overlays-created-at-test-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('assigns createdAt server-side and never reorders it on update', async () => {
    const manager = makeHeadlessManager(root)
    const [created] = await manager.addCustom({
      title: 'Created',
      createdAt: 1,
      updatedAt: 1
    })
    expect(created.createdAt).toBeGreaterThan(1)
    const originalCreatedAt = created.createdAt

    const [updated] = await manager.updateCustom(created.id, {
      title: 'Edited',
      createdAt: 2,
      updatedAt: 2
    })
    expect(updated.createdAt).toBe(originalCreatedAt)
    expect(updated.updatedAt).toBeGreaterThanOrEqual(originalCreatedAt ?? 0)
  })

  it('migrates legacy custom overlays to stable creation order metadata', async () => {
    writeFileSync(join(root, 'overlays.json'), JSON.stringify({
      configMode: false,
      widgets: {},
      customOverlays: [
        { id: 'custom:old', title: 'Old', elements: [] },
        { id: 'custom:new', title: 'New', elements: [] }
      ]
    }))
    const manager = makeHeadlessManager(root)
    await manager.load()
    expect(manager.listCustom().map((overlay) => overlay.createdAt)).toEqual([1, 2])
  })
})

describe('OverlayManager hidden widgets', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(process.cwd(), 'overlays-hidden-test-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('setHidden moves a widget to the hidden list state and persists to overlays.json', async () => {
    const id = OVERLAY_WIDGETS[0].id
    const mgr = new OverlayManager(makeBroadcastCtx(root))

    const hiddenList = await mgr.setHidden(id, true)
    expect(hiddenList.find((item) => item.id === id)?.hidden).toBe(true)

    const onDisk = JSON.parse(readFileSync(join(root, 'overlays.json'), 'utf8')) as {
      widgets: Record<string, { hidden?: boolean }>
    }
    expect(onDisk.widgets[id].hidden).toBe(true)

    const restoredList = await mgr.setHidden(id, false)
    expect(restoredList.find((item) => item.id === id)?.hidden).toBe(false)
  })
})

describe('OverlayManager rich overlay identity persistence', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(process.cwd(), 'overlays-identity-test-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('preserves all catalog identities through add, update, save, load and resave', async () => {
    const widgets = ALL_VARIANTS
      .map((variant) => variantToElement(variant, 0, 0))
      .filter((widget) => widget.widgetId || widget.hifiModuleId)
    const expected = identityPairs(widgets)
    const manager = makeHeadlessManager(root)

    for (let offset = 0; offset < widgets.length; offset += 200) {
      await manager.addCustom({ title: `Identity ${offset}`, enabled: false, widgets: widgets.slice(offset, offset + 200) })
    }
    for (const [index, overlay] of manager.listCustom().entries()) {
      await manager.updateCustom(overlay.id, { title: `Updated ${index}` })
    }
    expect(overlayIdentityPairs(manager.listCustom())).toEqual(expected)

    const loaded = makeHeadlessManager(root)
    await loaded.load()
    expect(overlayIdentityPairs(loaded.listCustom())).toEqual(expected)
    for (const [index, overlay] of loaded.listCustom().entries()) {
      await loaded.updateCustom(overlay.id, { title: `Resaved ${index}` })
    }

    const saved = JSON.parse(readFileSync(join(root, 'overlays.json'), 'utf8')) as {
      customOverlays: Array<{ widgets?: IdentityWidget[] }>
    }
    expect(overlayIdentityPairs(saved.customOverlays)).toEqual(expected)
  })

  it('loads a valid overlay after dropping an over-depth extension without overwriting the file', async () => {
    const path = join(root, 'overlays.json')
    await makeHeadlessManager(root).addCustom({ title: 'Keep me', enabled: false, widgets: [{ id: 'w', type: 'gauge' }] })
    const stored = JSON.parse(readFileSync(path, 'utf8')) as { customOverlays: Array<{ widgets: Array<Record<string, unknown>> }> }
    let future: Record<string, unknown> = { leaf: true }
    for (let i = 0; i < 40; i += 1) future = { next: future }
    stored.customOverlays[0].widgets[0].future = future
    const raw = JSON.stringify(stored)
    writeFileSync(path, raw)
    const loaded = makeHeadlessManager(root); await loaded.load()
    const overlay = loaded.listCustom()[0]
    expect(overlay).toMatchObject({ title: 'Keep me', widgets: [{ id: 'w', type: 'gauge' }] })
    expect(overlay.widgets?.[0]).not.toHaveProperty('future')
    expect(readFileSync(path, 'utf8')).toBe(raw)
  })
})
