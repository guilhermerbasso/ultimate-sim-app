import { OVERLAY_WIDGETS } from '../../shared/overlays'
import type { ModuleContext } from '../module-context'

export function register(ctx: ModuleContext): void {
  ctx.ipcMain.handle('overlays:widgetCatalog', () => OVERLAY_WIDGETS)
}
