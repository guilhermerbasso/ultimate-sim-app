import {
  IRSDK_BROADCAST,
  IRSDK_PIT_COMMAND,
  IRacingBroadcast,
  makeLong,
  type BroadcastResult
} from './irsdk-mmf'
import {
  cameraFocusVar1,
  chatMacroCommand,
  pitFuelCommand,
  pitToggleCommand,
  pitTyreCommands,
  replayTransportCommand,
  tireCompoundCommand,
  type BroadcastTuple,
  type CameraFocus,
  type ReplayTransport,
  type TyreRequest
} from './command-map'

type IRacingCommand = {
  type: string
  payload?: Record<string, unknown>
}

type CommandResult = BroadcastResult

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '')
}

export class IRacingControl {
  private broadcast = new IRacingBroadcast()

  status(): { available: boolean; connected: boolean } {
    return this.broadcast.status()
  }

  execute(command: IRacingCommand): CommandResult {
    try {
      return this.dispatch(command)
    } catch (error) {
      return { ok: false, supported: true, message: error instanceof Error ? error.message : String(error) }
    }
  }

  private dispatch(command: IRacingCommand): CommandResult {
    switch (command.type) {
      case 'reloadTextures':
        return this.broadcast.send(IRSDK_BROADCAST.reloadTextures)
      case 'camera:set':
      case 'camera:switch':
        return this.camera(command.payload)
      // ─── Replay transport (ReplaySetPlaySpeed / ReplaySearch) ────────────────
      case 'replay:play':
        return this.replay('play', command.payload)
      case 'replay:pause':
        return this.replay('pause', command.payload)
      case 'replay:rewind':
        return this.replay('rewind', command.payload)
      case 'replay:ff':
        return this.replay('ff', command.payload)
      case 'replay:slow':
        return this.replay('slow', command.payload)
      case 'replay:prevLap':
        return this.replay('prevLap', command.payload)
      case 'replay:nextLap':
        return this.replay('nextLap', command.payload)
      case 'replay:prevIncident':
        return this.replay('prevIncident', command.payload)
      case 'replay:nextIncident':
        return this.replay('nextIncident', command.payload)
      case 'replay:toStart':
        return this.replay('toStart', command.payload)
      case 'replay:toEnd':
        return this.replay('toEnd', command.payload)
      case 'replay:speed':
        return this.broadcast.send(
          IRSDK_BROADCAST.replaySetPlaySpeed,
          Math.trunc(asNumber(command.payload?.speed, 1)),
          asNumber(command.payload?.slowMotion) ? 1 : 0
        )
      case 'blackbox:next':
        return this.chatMacro(asNumber(command.payload?.macro, 0))
      case 'blackbox:previous':
        return this.chatMacro(asNumber(command.payload?.macro, 1))
      case 'chat:macro':
        return this.chatMacro(asNumber(command.payload?.macro, 0))
      case 'chat:send':
        return { ok: false, supported: false, message: 'IRSDK broadcast supports chat macros only, not arbitrary free-text chat messages.' }
      // ─── Pit commands (irsdk_PitCommandMode) ─────────────────────────────────
      case 'pit:clear':
        return this.send(pitToggleCommand(IRSDK_PIT_COMMAND.clear))
      case 'pit:clearTires':
        return this.send(pitToggleCommand(IRSDK_PIT_COMMAND.clearTires))
      case 'pit:windshield':
        return this.send(pitToggleCommand(IRSDK_PIT_COMMAND.windshield))
      case 'pit:clearWS':
        return this.send(pitToggleCommand(IRSDK_PIT_COMMAND.clearWS))
      case 'pit:clearFR':
        return this.send(pitToggleCommand(IRSDK_PIT_COMMAND.clearFR))
      case 'pit:clearFuel':
        return this.send(pitToggleCommand(IRSDK_PIT_COMMAND.clearFuel))
      // Pit command broadcast layout (irsdk_PitCommandMode):
      //   wParam = MAKELONG(pitCommand, mode), lParam = numeric arg
      //   fuel -> var2 = liters; LF/RF/LR/RR -> var2 = pressure (KPa); TC -> var2 = compound
      case 'pit:fuel':
        return this.send(pitFuelCommand(command.payload?.liters))
      case 'pit:tyres':
        return this.pitTyres(command.payload)
      case 'pit:tireCompound':
        return this.send(tireCompoundCommand(command.payload?.compound ?? command.payload?.index))
      case 'pit:fastRepair':
        return this.send(pitToggleCommand(IRSDK_PIT_COMMAND.fastRepair))
      default:
        return { ok: false, supported: false, message: `Unsupported iRacing command: ${command.type}` }
    }
  }

  private send(tuple: BroadcastTuple): CommandResult {
    return this.broadcast.send(tuple.command, tuple.var1, tuple.var2)
  }

  // Camera switch broadcast layout (irsdk_BroadcastMsg):
  //   camSwitchNum -> var1 = car number / focus-at pseudo-target,
  //                   var2 = MAKELONG(camGroup, camera)
  //   camSwitchPos -> var1 = race position / focus-at, var2 = MAKELONG(group, camera)
  // `focus` (leader/incident/exiting/driver) maps to the negative pseudo-targets.
  private camera(payload: Record<string, unknown> | undefined): CommandResult {
    const focus = typeof payload?.focus === 'string' ? (payload.focus as CameraFocus) : undefined
    const carIdx = Math.trunc(asNumber(payload?.carIdx ?? payload?.position))
    const var1 = cameraFocusVar1(focus, carIdx)
    const cameraGroup = Math.trunc(asNumber(payload?.cameraGroup ?? payload?.group))
    const cameraNumber = Math.trunc(asNumber(payload?.cameraNumber ?? payload?.camera))
    const command = cameraNumber > 0 ? IRSDK_BROADCAST.camSwitchNum : IRSDK_BROADCAST.camSwitchPos
    return this.broadcast.send(command, var1, makeLong(cameraGroup, cameraNumber))
  }

  private replay(action: ReplayTransport, payload: Record<string, unknown> | undefined): CommandResult {
    const tuple = replayTransportCommand(action, asNumber(payload?.speed, 2))
    if (!tuple) return { ok: false, supported: false, message: `Unsupported replay transport: ${action}` }
    return this.send(tuple)
  }

  // Per-corner tire requests. Accepts either a bare list of corners (toggle only)
  // or `{tyres:[...], pressures:{lf,rf,lr,rr}}` to send per-corner pressure (KPa)
  // packed as var2 of each LF/RF/LR/RR broadcast.
  private pitTyres(payload: Record<string, unknown> | undefined): CommandResult {
    const corners = Array.isArray(payload?.tyres) ? payload.tyres.map(asString) : ['lf', 'rf', 'lr', 'rr']
    const pressures = (payload?.pressures ?? {}) as Record<string, unknown>
    const requests: TyreRequest[] = corners.map((corner) => {
      const key = corner.toLowerCase()
      const pressure = pressures[key]
      return {
        corner: key,
        pressureKpa: typeof pressure === 'number' && Number.isFinite(pressure) ? pressure : undefined
      }
    })
    const tuples = pitTyreCommands(requests)
    for (const tuple of tuples) {
      const result = this.send(tuple)
      if (!result.ok) return result
    }
    return { ok: true, supported: true }
  }

  private chatMacro(index: number): CommandResult {
    return this.send(chatMacroCommand(index))
  }
}

export type { IRacingCommand, CommandResult }
