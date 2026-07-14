import type { TireStrategySettings } from '../../shared/tire-strategy'
import { TIRE_CHANNELS } from '../../shared/tire-strategy'
import type { ModuleContext } from '../module-context'
import { TireStrategyCalculator } from '../strategy/tire'
import { LiveTelemetryGate } from '../../shared/replay'

export function register(ctx: ModuleContext): void {
  const calculator = new TireStrategyCalculator()
  const liveGate = new LiveTelemetryGate()
  const reset = () => {
    calculator.update(null)
    return calculator.reset()
  }

  ctx.telemetryHub.on('snapshot', (snapshot) => {
    const live = liveGate.observe(snapshot)
    if (!live.live) {
      if (live.boundary) ctx.broadcast(TIRE_CHANNELS.update, reset())
      return
    }
    if (live.boundary) reset()
    const state = calculator.update(snapshot)
    ctx.broadcast(TIRE_CHANNELS.update, state)
  })

  ctx.ipcMain.handle(TIRE_CHANNELS.get, (_event, settings?: Partial<TireStrategySettings>) => calculator.get(settings))
  ctx.ipcMain.handle(TIRE_CHANNELS.reset, () => calculator.reset())
}
