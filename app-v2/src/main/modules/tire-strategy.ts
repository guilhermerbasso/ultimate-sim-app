import type { TireStrategySettings } from '../../shared/tire-strategy'
import { TIRE_CHANNELS } from '../../shared/tire-strategy'
import type { ModuleContext } from '../module-context'
import { TireStrategyCalculator } from '../strategy/tire'

export function register(ctx: ModuleContext): void {
  const calculator = new TireStrategyCalculator()

  ctx.telemetryHub.on('snapshot', (snapshot) => {
    const state = calculator.update(snapshot)
    ctx.broadcast(TIRE_CHANNELS.update, state)
  })

  ctx.ipcMain.handle(TIRE_CHANNELS.get, (_event, settings?: Partial<TireStrategySettings>) => calculator.get(settings))
  ctx.ipcMain.handle(TIRE_CHANNELS.reset, () => calculator.reset())
}
