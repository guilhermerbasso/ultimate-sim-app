import {
  IRSDK_BROADCAST,
  IRSDK_CAM_FOCUS,
  IRSDK_CHAT_COMMAND,
  IRSDK_PIT_COMMAND,
  IRSDK_REPLAY_SEARCH
} from './irsdk-mmf'

// Pure mapping layer between the high-level command vocabulary and the raw
// iRacing broadcast triples. Every builder returns `{ command, var1, var2 }`
// which the IRacingBroadcast.send() helper packs as
//   wParam = MAKELONG(command, var1), lParam = var2
// Keeping this side-effect-free makes the wire format unit-testable without
// koffi / a live sim.

export interface BroadcastTuple {
  command: number
  var1: number
  var2: number
}

const TYRE_PIT_COMMAND: Record<string, number> = {
  lf: IRSDK_PIT_COMMAND.lf,
  rf: IRSDK_PIT_COMMAND.rf,
  lr: IRSDK_PIT_COMMAND.lr,
  rr: IRSDK_PIT_COMMAND.rr
}

function clampInt(value: unknown, min: number, max: number, fallback = 0): number {
  const num = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback
  return Math.min(max, Math.max(min, num))
}

// Add fuel: var1 = Fuel mode, var2 = liters to add (0 keeps the planned amount).
export function pitFuelCommand(liters: unknown): BroadcastTuple {
  return {
    command: IRSDK_BROADCAST.pitCommand,
    var1: IRSDK_PIT_COMMAND.fuel,
    var2: clampInt(liters, 0, 0xffff, 0)
  }
}

// Change one tire: var1 = corner mode (LF/RF/LR/RR), var2 = pressure in KPa.
// A pressure of 0 tells iRacing to keep the current/planned pressure (toggle).
export function pitTyreCommand(corner: string, pressureKpa?: unknown): BroadcastTuple | null {
  const mode = TYRE_PIT_COMMAND[corner.toLowerCase()]
  if (mode === undefined) return null
  return {
    command: IRSDK_BROADCAST.pitCommand,
    var1: mode,
    var2: clampInt(pressureKpa, 0, 0xffff, 0)
  }
}

export interface TyreRequest {
  corner: string
  pressureKpa?: number
}

// Expand a list of corner requests into ordered broadcast triples, dropping
// unknown corners. Accepts either bare corner strings or `{corner,pressureKpa}`.
export function pitTyreCommands(requests: Array<string | TyreRequest>): BroadcastTuple[] {
  const out: BroadcastTuple[] = []
  for (const req of requests) {
    if (typeof req === 'string') {
      const tuple = pitTyreCommand(req)
      if (tuple) out.push(tuple)
    } else if (req && typeof req === 'object') {
      const tuple = pitTyreCommand(req.corner, req.pressureKpa)
      if (tuple) out.push(tuple)
    }
  }
  return out
}

// Change tire compound: PitCommand mode = TC (12), var2 = compound index.
export function tireCompoundCommand(index: unknown): BroadcastTuple {
  return {
    command: IRSDK_BROADCAST.pitCommand,
    var1: IRSDK_PIT_COMMAND.tc,
    var2: clampInt(index, 0, 0xffff, 0)
  }
}

// Simple pit toggles that carry no numeric argument.
export function pitToggleCommand(mode: number): BroadcastTuple {
  return { command: IRSDK_BROADCAST.pitCommand, var1: Math.trunc(mode), var2: 0 }
}

export type ReplayTransport =
  | 'play'
  | 'pause'
  | 'ff'
  | 'rewind'
  | 'slow'
  | 'prevLap'
  | 'nextLap'
  | 'prevIncident'
  | 'nextIncident'
  | 'toStart'
  | 'toEnd'

const DEFAULT_FF_SPEED = 2

// Replay transport correctly routed through ReplaySetPlaySpeed (var1 = speed:
// 0=pause, 1=play, >1=fast-forward, <0=rewind; var2 = slow-motion flag) and
// ReplaySearch (var1 = irsdk_RpySrchMode) for lap/incident/edge jumps. The old
// path used ReplaySetState, whose only valid value is EraseTape — a no-op for
// play/pause/ff/rewind.
export function replayTransportCommand(action: ReplayTransport, speedMagnitude = DEFAULT_FF_SPEED): BroadcastTuple | null {
  const mag = Math.max(1, Math.trunc(Math.abs(speedMagnitude)) || DEFAULT_FF_SPEED)
  switch (action) {
    case 'pause':
      return { command: IRSDK_BROADCAST.replaySetPlaySpeed, var1: 0, var2: 0 }
    case 'play':
      return { command: IRSDK_BROADCAST.replaySetPlaySpeed, var1: 1, var2: 0 }
    case 'slow':
      // Slow motion: speed 1 with the slow-motion flag set in var2.
      return { command: IRSDK_BROADCAST.replaySetPlaySpeed, var1: 1, var2: 1 }
    case 'ff':
      return { command: IRSDK_BROADCAST.replaySetPlaySpeed, var1: mag, var2: 0 }
    case 'rewind':
      return { command: IRSDK_BROADCAST.replaySetPlaySpeed, var1: -mag, var2: 0 }
    case 'prevLap':
      return { command: IRSDK_BROADCAST.replaySearch, var1: IRSDK_REPLAY_SEARCH.prevLap, var2: 0 }
    case 'nextLap':
      return { command: IRSDK_BROADCAST.replaySearch, var1: IRSDK_REPLAY_SEARCH.nextLap, var2: 0 }
    case 'prevIncident':
      return { command: IRSDK_BROADCAST.replaySearch, var1: IRSDK_REPLAY_SEARCH.prevIncident, var2: 0 }
    case 'nextIncident':
      return { command: IRSDK_BROADCAST.replaySearch, var1: IRSDK_REPLAY_SEARCH.nextIncident, var2: 0 }
    case 'toStart':
      return { command: IRSDK_BROADCAST.replaySearch, var1: IRSDK_REPLAY_SEARCH.toStart, var2: 0 }
    case 'toEnd':
      return { command: IRSDK_BROADCAST.replaySearch, var1: IRSDK_REPLAY_SEARCH.toEnd, var2: 0 }
    default:
      return null
  }
}

export type CameraFocus = 'leader' | 'incident' | 'exiting' | 'driver'

// Camera focus-at: var1 = focus pseudo-target (negative) or a car position,
// var2 = MAKELONG(group, camera) handled by the caller. Returns the var1 slot.
export function cameraFocusVar1(focus: CameraFocus | undefined, carPosition = 0): number {
  switch (focus) {
    case 'leader':
      return IRSDK_CAM_FOCUS.leader
    case 'incident':
      return IRSDK_CAM_FOCUS.incident
    case 'exiting':
      return IRSDK_CAM_FOCUS.exiting
    case 'driver':
      return IRSDK_CAM_FOCUS.driver
    default:
      return Math.trunc(carPosition)
  }
}

// Chat macro: var1 = Macro mode, var2 = macro number (1..15).
export function chatMacroCommand(index: unknown): BroadcastTuple {
  return {
    command: IRSDK_BROADCAST.chatCommand,
    var1: IRSDK_CHAT_COMMAND.macro,
    var2: clampInt(index, 0, 15, 0)
  }
}

export { IRSDK_BROADCAST }
