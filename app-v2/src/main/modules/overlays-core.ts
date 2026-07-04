import type { ModuleContext } from '../module-context'
import { CONFIG_SECTION_RELOAD_SIGNAL, CONFIG_SECTION_RESET_SIGNAL } from '../../shared/config-io'
import { OverlayCompositorManager } from '../overlays/compositor'
import { OverlayManager } from '../overlays/manager'

let manager: OverlayManager | null = null
let compositor: OverlayCompositorManager | null = null

function syncCompositorAfter(methodName: keyof OverlayManager): void {
  if (!manager) return
  const target = manager as unknown as Record<string, (...args: unknown[]) => unknown>
  const original = target[methodName]
  if (typeof original !== 'function') return
  target[methodName] = (...args: unknown[]) => {
    const result = original.apply(manager, args)
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      return (result as Promise<unknown>).finally(() => compositor?.sync())
    }
    compositor?.sync()
    return result
  }
}

export function register(ctx: ModuleContext): void {
  manager = new OverlayManager(ctx)
  compositor = new OverlayCompositorManager(ctx)
  compositor.setStateProvider(manager)
  manager.registerIpc()
  compositor.registerIpc()
  ;[
    'setConfig',
    'toggle',
    'setPosition',
    'setDisplayTarget',
    'finishGesture',
    'setLocked',
    'setOpacity',
    'setStyle',
    'addCustom',
    'updateCustom',
    'removeCustom'
  ].forEach((method) => syncCompositorAfter(method as keyof OverlayManager))
  // Telemetry snapshots reach overlay windows via the global broadcast registered
  // in modules/telemetry.ts; no per-manager re-emit is needed (and the previous
  // double-emit caused duplicate React renders for every tick).

  void manager.load().then(() => compositor?.load())

  // When the user deletes/resets the persisted `overlays` store, drop the live
  // manager's in-memory copy so its before-quit flush can't resurrect the file.
  const onSectionReset = (_event: unknown, sectionId: string): void => {
    if (sectionId === 'overlays') manager?.dropInMemoryForReset()
  }
  ctx.ipcMain.on(CONFIG_SECTION_RESET_SIGNAL, onSectionReset)

  // Overlays cannot hot-swap their live windows mid-session, so an imported
  // `overlays` store applies on the next launch (the UI marks it "Reinicie para
  // aplicar"). But the import already overwrote the file on disk, so neutralize
  // the live manager's persistence: otherwise its before-quit flush would write
  // our STALE in-memory config back and clobber the freshly-imported file. This
  // mirrors the reset protection without blanking the current overlays.
  const onSectionReload = (_event: unknown, sectionId: string): void => {
    if (sectionId === 'overlays') manager?.suspendPersistenceForImport()
  }
  ctx.ipcMain.on(CONFIG_SECTION_RELOAD_SIGNAL, onSectionReload)

  ctx.app.once('before-quit', () => {
    ctx.ipcMain.off(CONFIG_SECTION_RESET_SIGNAL, onSectionReset)
    ctx.ipcMain.off(CONFIG_SECTION_RELOAD_SIGNAL, onSectionReload)
    compositor?.dispose()
    compositor = null
    void manager?.dispose()
    manager = null
  })
}
