import type { FuelStrategySettings } from '../../shared/fuel'
import { FuelStrategyCalculator } from '../strategy/fuel'
import type { ModuleContext } from '../module-context'
import { LiveTelemetryGate } from '../../shared/replay'

export function register(ctx: ModuleContext): void {
  const calculator = new FuelStrategyCalculator()
  const liveGate = new LiveTelemetryGate()
  const reset = () => {
    calculator.update(null)
    return calculator.reset()
  }

  ctx.telemetryHub.on('snapshot', (snapshot) => {
    const live = liveGate.observe(snapshot)
    if (!live.live) {
      if (live.boundary) ctx.broadcast('fuel:update', reset())
      return
    }
    if (live.boundary) reset()
    const state = calculator.update(snapshot)
    ctx.broadcast('fuel:update', state)
  })

  ctx.ipcMain.handle('fuel:get', (_event, settings?: Partial<FuelStrategySettings>) => calculator.get(settings))
  ctx.ipcMain.handle('fuel:reset', () => calculator.reset())
}
