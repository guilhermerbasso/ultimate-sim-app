import type { OledDashboardConfig } from '../../shared/oled'
import type { ModuleContext } from '../module-context'
import { OledDashboardEngine } from '../oled/engine'

export function register(ctx: ModuleContext): void {
  const engine = new OledDashboardEngine(ctx)
  void engine.initialize().catch((error) => {
    console.error('[oled-dashboard] Failed to initialize:', error)
  })

  ctx.ipcMain.handle('oled:getPresets', () => engine.getPresets())
  ctx.ipcMain.handle('oled:getConfig', () => engine.getConfig())
  ctx.ipcMain.handle('oled:getStatus', () => engine.getStatus())
  ctx.ipcMain.handle('oled:setConfig', (_event, patch: Partial<OledDashboardConfig>) => engine.setConfig(patch))
  ctx.ipcMain.handle('oled:setActivePage', (_event, activeIndex: number) => engine.setActivePage(activeIndex))
  ctx.ipcMain.handle('oled:setStreaming', (_event, enabled: boolean) => engine.setStreaming(enabled))

  ctx.app.once('before-quit', () => {
    void engine.dispose()
  })
}
