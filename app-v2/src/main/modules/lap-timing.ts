import { LapTimingCalculator } from '../strategy/timing'
import type { ModuleContext } from '../module-context'

export function register(ctx: ModuleContext): void {
  const calculator = new LapTimingCalculator()

  ctx.telemetryHub.on('snapshot', (snapshot) => {
    const state = calculator.update(snapshot)
    ctx.broadcast('lap:update', state)
  })

  ctx.ipcMain.handle('lap:get', () => calculator.get())
  ctx.ipcMain.handle('lap:reset', () => calculator.reset())
}
