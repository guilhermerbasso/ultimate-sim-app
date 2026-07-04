import type { ModuleContext } from '../module-context'
import type { IRacingCommand } from '../iracing/control'

export function register(ctx: ModuleContext): void {
  // Reuse the shared instance from the main process. The dispatcher (actions
  // module) also depends on this same control so behavior stays consistent.
  ctx.ipcMain.handle('iracing:status', () => ctx.iracingControl.status())
  ctx.ipcMain.handle('iracing:command', (_event, command: IRacingCommand) => ctx.iracingControl.execute(command))
}
