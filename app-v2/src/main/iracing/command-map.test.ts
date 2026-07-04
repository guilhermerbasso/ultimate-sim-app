import { describe, expect, it } from 'vitest'
import {
  IRSDK_BROADCAST,
  IRSDK_PIT_COMMAND,
  IRSDK_REPLAY_SEARCH,
  makeLong
} from './irsdk-mmf'
import {
  cameraFocusVar1,
  chatMacroCommand,
  pitFuelCommand,
  pitToggleCommand,
  pitTyreCommand,
  pitTyreCommands,
  replayTransportCommand,
  tireCompoundCommand
} from './command-map'

describe('irsdk_PitCommandMode enum values', () => {
  it('matches the full irsdk_defines.h vocabulary', () => {
    expect(IRSDK_PIT_COMMAND).toMatchObject({
      clear: 0,
      windshield: 1,
      fuel: 2,
      lf: 3,
      rf: 4,
      lr: 5,
      rr: 6,
      clearTires: 7,
      fastRepair: 8,
      clearWS: 9,
      clearFR: 10,
      clearFuel: 11,
      tc: 12
    })
  })
})

describe('pit command packing (MAKELONG wParam / var2 lParam)', () => {
  it('packs fuel liters into var2 and the fuel mode into var1', () => {
    const tuple = pitFuelCommand(42)
    expect(tuple).toEqual({ command: IRSDK_BROADCAST.pitCommand, var1: IRSDK_PIT_COMMAND.fuel, var2: 42 })
    // wParam = MAKELONG(broadcastMsg, var1); lParam = var2.
    expect(makeLong(tuple.command, tuple.var1)).toBe((IRSDK_BROADCAST.pitCommand & 0xffff) | (IRSDK_PIT_COMMAND.fuel << 16))
  })

  it('clamps negative fuel to zero', () => {
    expect(pitFuelCommand(-5).var2).toBe(0)
    expect(pitFuelCommand('nan' as unknown).var2).toBe(0)
  })

  it('packs per-corner tire pressure (KPa) into var2', () => {
    const lf = pitTyreCommand('lf', 165)
    expect(lf).toEqual({ command: IRSDK_BROADCAST.pitCommand, var1: IRSDK_PIT_COMMAND.lf, var2: 165 })
    const rr = pitTyreCommand('RR', 172)
    expect(rr).toEqual({ command: IRSDK_BROADCAST.pitCommand, var1: IRSDK_PIT_COMMAND.rr, var2: 172 })
    // The full lParam carried on the wire equals the pressure for an LF change.
    expect(lf?.var2).toBe(165)
  })

  it('treats pressure 0 as keep-current and rejects unknown corners', () => {
    expect(pitTyreCommand('lf')?.var2).toBe(0)
    expect(pitTyreCommand('xx', 100)).toBeNull()
  })

  it('expands a mixed corner+pressure request list in order', () => {
    const tuples = pitTyreCommands([
      { corner: 'lf', pressureKpa: 160 },
      'rf',
      { corner: 'bogus', pressureKpa: 200 },
      { corner: 'rr', pressureKpa: 175 }
    ])
    expect(tuples).toEqual([
      { command: IRSDK_BROADCAST.pitCommand, var1: IRSDK_PIT_COMMAND.lf, var2: 160 },
      { command: IRSDK_BROADCAST.pitCommand, var1: IRSDK_PIT_COMMAND.rf, var2: 0 },
      { command: IRSDK_BROADCAST.pitCommand, var1: IRSDK_PIT_COMMAND.rr, var2: 175 }
    ])
  })

  it('maps tire compound to TC mode with the compound index in var2', () => {
    const tuple = tireCompoundCommand(2)
    expect(tuple).toEqual({ command: IRSDK_BROADCAST.pitCommand, var1: IRSDK_PIT_COMMAND.tc, var2: 2 })
    expect(tuple.var1).toBe(12)
  })

  it('emits no-arg toggles for the clear/fast-repair family', () => {
    expect(pitToggleCommand(IRSDK_PIT_COMMAND.clearWS)).toEqual({ command: IRSDK_BROADCAST.pitCommand, var1: 9, var2: 0 })
    expect(pitToggleCommand(IRSDK_PIT_COMMAND.clearFR)).toEqual({ command: IRSDK_BROADCAST.pitCommand, var1: 10, var2: 0 })
    expect(pitToggleCommand(IRSDK_PIT_COMMAND.clearFuel)).toEqual({ command: IRSDK_BROADCAST.pitCommand, var1: 11, var2: 0 })
  })
})

describe('replay transport mapping', () => {
  it('routes play/pause/ff/rewind through ReplaySetPlaySpeed (var1 = speed)', () => {
    expect(replayTransportCommand('pause')).toEqual({ command: IRSDK_BROADCAST.replaySetPlaySpeed, var1: 0, var2: 0 })
    expect(replayTransportCommand('play')).toEqual({ command: IRSDK_BROADCAST.replaySetPlaySpeed, var1: 1, var2: 0 })
    expect(replayTransportCommand('ff')).toEqual({ command: IRSDK_BROADCAST.replaySetPlaySpeed, var1: 2, var2: 0 })
    expect(replayTransportCommand('ff', 8)).toEqual({ command: IRSDK_BROADCAST.replaySetPlaySpeed, var1: 8, var2: 0 })
    expect(replayTransportCommand('rewind')).toEqual({ command: IRSDK_BROADCAST.replaySetPlaySpeed, var1: -2, var2: 0 })
    expect(replayTransportCommand('rewind', 4)).toEqual({ command: IRSDK_BROADCAST.replaySetPlaySpeed, var1: -4, var2: 0 })
  })

  it('sets the slow-motion flag in var2 for slow', () => {
    expect(replayTransportCommand('slow')).toEqual({ command: IRSDK_BROADCAST.replaySetPlaySpeed, var1: 1, var2: 1 })
  })

  it('routes lap/incident/edge jumps through ReplaySearch (var1 = RpySrchMode)', () => {
    expect(replayTransportCommand('prevLap')).toEqual({ command: IRSDK_BROADCAST.replaySearch, var1: IRSDK_REPLAY_SEARCH.prevLap, var2: 0 })
    expect(replayTransportCommand('nextLap')).toEqual({ command: IRSDK_BROADCAST.replaySearch, var1: IRSDK_REPLAY_SEARCH.nextLap, var2: 0 })
    expect(replayTransportCommand('prevIncident')).toEqual({ command: IRSDK_BROADCAST.replaySearch, var1: IRSDK_REPLAY_SEARCH.prevIncident, var2: 0 })
    expect(replayTransportCommand('nextIncident')).toEqual({ command: IRSDK_BROADCAST.replaySearch, var1: IRSDK_REPLAY_SEARCH.nextIncident, var2: 0 })
    expect(replayTransportCommand('toStart')).toEqual({ command: IRSDK_BROADCAST.replaySearch, var1: IRSDK_REPLAY_SEARCH.toStart, var2: 0 })
    expect(replayTransportCommand('toEnd')).toEqual({ command: IRSDK_BROADCAST.replaySearch, var1: IRSDK_REPLAY_SEARCH.toEnd, var2: 0 })
  })

  it('never uses the (wrong) ReplaySetState broadcast for transport', () => {
    for (const action of ['play', 'pause', 'ff', 'rewind', 'prevLap', 'nextIncident'] as const) {
      expect(replayTransportCommand(action)?.command).not.toBe(IRSDK_BROADCAST.replaySetState)
    }
  })
})

describe('camera focus-at targets', () => {
  it('maps leader/incident/exiting/driver to the negative pseudo-targets', () => {
    expect(cameraFocusVar1('leader')).toBe(-2)
    expect(cameraFocusVar1('incident')).toBe(-3)
    expect(cameraFocusVar1('exiting')).toBe(-1)
    expect(cameraFocusVar1('driver')).toBe(0)
  })

  it('falls back to a car position when no focus pseudo-target is given', () => {
    expect(cameraFocusVar1(undefined, 7)).toBe(7)
  })
})

describe('chat macro', () => {
  it('packs the macro number into var2 and clamps to 1..15 range', () => {
    expect(chatMacroCommand(3)).toEqual({ command: IRSDK_BROADCAST.chatCommand, var1: 0, var2: 3 })
    expect(chatMacroCommand(99).var2).toBe(15)
    expect(chatMacroCommand(-4).var2).toBe(0)
  })
})
