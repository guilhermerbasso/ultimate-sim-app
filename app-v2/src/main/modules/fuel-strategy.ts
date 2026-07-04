import type { FuelStrategySettings } from '../../shared/fuel'
import { FuelStrategyCalculator } from '../strategy/fuel'
import type { ModuleContext } from '../module-context'

export function register(ctx: ModuleContext): void {
  const calculator = new FuelStrategyCalculator()

  ctx.telemetryHub.on('snapshot', (snapshot) => {
    const state = calculator.update(snapshot)
    ctx.broadcast('fuel:update', state)
  })

  ctx.ipcMain.handle('fuel:get', (_event, settings?: Partial<FuelStrategySettings>) => calculator.get(settings))
  ctx.ipcMain.handle('fuel:reset', () => calculator.reset())
}
