import type { RevlightsConfig, RevlightsPresetId } from '../../shared/revlights'
import type { ModuleContext } from '../module-context'
import { RevlightsEngine } from '../revlights/engine'
import { logger } from './logger'
import { CONFIG_SECTION_RELOAD_SIGNAL } from '../../shared/config-io'

// Returns the live engine so the orchestrator can hand it to the SIM-X auto-start
// coordinator (which flips rev-lights on once the SIM-X connects).
export function register(ctx: ModuleContext): RevlightsEngine {
  const engine = new RevlightsEngine(ctx)
  void engine.initialize().catch((error) => {
    console.error('[revlights] Failed to initialize:', error)
    logger.error('revlights', 'engine initialize failed', {
      error: error instanceof Error ? error.message : String(error)
    })
  })

  ctx.ipcMain.handle('revlights:getConfig', () => engine.getConfig())
  ctx.ipcMain.handle('revlights:getPresets', () => engine.getPresets())
  ctx.ipcMain.handle('revlights:getStatus', () => engine.getStatus())
  ctx.ipcMain.handle('revlights:setConfig', (_event, patch: Partial<RevlightsConfig>) => engine.setConfig(patch))
  ctx.ipcMain.handle('revlights:setEnabled', (_event, enabled: boolean) => engine.setEnabled(enabled))
  ctx.ipcMain.handle('revlights:applyPreset', (_event, presetId: RevlightsPresetId) => engine.applyPreset(presetId))

  // The user imported the `revlights` section: re-read the just-overwritten file
  // and apply it live (no restart). The engine keeps the current enabled state.
  const onSectionReload = (_event: unknown, sectionId: string): void => {
    if (sectionId !== 'revlights') return
    void engine.reloadFromDisk().catch((error) => {
      logger.error('revlights', 'reload after import failed', {
        error: error instanceof Error ? error.message : String(error)
      })
    })
  }
  ctx.ipcMain.on(CONFIG_SECTION_RELOAD_SIGNAL, onSectionReload)

  ctx.app.once('before-quit', () => {
    logger.info('revlights', 'dispose on before-quit')
    ctx.ipcMain.off(CONFIG_SECTION_RELOAD_SIGNAL, onSectionReload)
    void engine.dispose()
  })

  return engine
}
