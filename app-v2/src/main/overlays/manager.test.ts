import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { OverlayManager } from './manager'
import { OVERLAY_WIDGETS } from '../../shared/overlays'
import type { ModuleContext } from '../module-context'

// The manager's save/scheduleSave/dispose are private; the resurrection bug is
// entirely about whether dispose() flushes a pending in-memory config back to
// disk. We poke the private save scheduler + read the timer to drive it without
// Electron windows (load()/createWindow touch BrowserWindow/screen, which we
// deliberately never call here).
interface ManagerInternals {
  saveTimer: ReturnType<typeof setTimeout> | null
  resetPending: boolean
  isDisposing: boolean
  scheduleSave(): void
  broadcastState(): void
  broadcastList(): void
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
