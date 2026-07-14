import { LapTimingCalculator } from '../strategy/timing'
import type { ModuleContext } from '../module-context'
import { LiveTelemetryGate } from '../../shared/replay'

export function register(ctx: ModuleContext): void {
  const calculator = new LapTimingCalculator()
  const liveGate = new LiveTelemetryGate()
  const reset = () => {
    calculator.update(null)
    return calculator.reset()
  }

  ctx.telemetryHub.on('snapshot', (snapshot) => {
    const live = liveGate.observe(snapshot)
    if (!live.live) {
      if (live.boundary) ctx.broadcast('lap:update', reset())
      return
    }
    if (live.boundary) reset()
    const state = calculator.update(snapshot)
    ctx.broadcast('lap:update', state)
  })

  ctx.ipcMain.handle('lap:get', () => calculator.get())
  ctx.ipcMain.handle('lap:reset', () => calculator.reset())
}
