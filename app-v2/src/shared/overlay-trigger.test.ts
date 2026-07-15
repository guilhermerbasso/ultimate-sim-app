import { describe, expect, it } from 'vitest'
import {
  evaluateOverlayTrigger,
  hifiModuleRole,
  MonotonicTemporalTriggerEngine,
  OverlayTriggerController,
  semanticOverlayTrigger,
  semanticTriggerForHifiModule
} from './overlay-trigger'
import type { TelemetrySnapshot } from './telemetry'

function signal(value: boolean, known = true): { value: boolean; known: boolean } {
  return { value, known }
}

function snapshot(partial: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 1,
    sessionUniqueId: 10,
    sessionNumber: 1,
    speedKmh: 0,
    rpm: 0,
    gear: 0,
    throttle: 0,
    brake: 0,
    clutch: 0,
    ...partial
  }
}

describe('MonotonicTemporalTriggerEngine', () => {
  it('evaluates level state without a TTL', () => {
    const engine = new MonotonicTemporalTriggerEngine()
    expect(engine.evaluate('level', 'level', signal(false), 0)).toMatchObject({ visible: false })
    expect(engine.evaluate('level', 'level', signal(true), 1)).toMatchObject({ visible: true, active: true })
    expect(engine.evaluate('level', 'level', signal(false), 2)).toMatchObject({ visible: false })
  })

  it('does not emit a cold-start rising pulse and rearms only after false', () => {
    const engine = new MonotonicTemporalTriggerEngine()
    expect(engine.evaluate('rise', 'rising', signal(true), 0, 5000).visible).toBe(false)
    expect(engine.evaluate('rise', 'rising', signal(false), 1, 5000).visible).toBe(false)
    expect(engine.evaluate('rise', 'rising', signal(true), 100, 5000).visible).toBe(true)
    expect(engine.evaluate('rise', 'rising', signal(true), 5099, 5000).visible).toBe(true)
    expect(engine.evaluate('rise', 'rising', signal(true), 5100, 5000).visible).toBe(false)
    expect(engine.evaluate('rise', 'rising', signal(false), 5200, 5000).visible).toBe(false)
    expect(engine.evaluate('rise', 'rising', signal(true), 5300, 5000).visible).toBe(true)
  })

  it('emits a falling pulse for exactly the configured TTL', () => {
    const engine = new MonotonicTemporalTriggerEngine()
    expect(engine.evaluate('fall', 'falling', signal(true), 0, 4000).visible).toBe(false)
    expect(engine.evaluate('fall', 'falling', signal(false), 50, 4000).visible).toBe(true)
    expect(engine.evaluate('fall', 'falling', signal(false), 4049, 4000).visible).toBe(true)
    expect(engine.evaluate('fall', 'falling', signal(false), 4050, 4000).visible).toBe(false)
  })

  it('supports pulse and after-false hold semantics', () => {
    const engine = new MonotonicTemporalTriggerEngine()
    expect(engine.evaluate('pulse', 'pulse', signal(true), 0, 1000).visible).toBe(true)
    expect(engine.evaluate('pulse', 'pulse', signal(false), 999, 1000)).toMatchObject({ visible: true, held: true })
    expect(engine.evaluate('pulse', 'pulse', signal(false), 1000, 1000).visible).toBe(false)

    expect(engine.evaluate('hold', 'after-false', signal(true), 2000, 1000).visible).toBe(true)
    expect(engine.evaluate('hold', 'after-false', signal(false), 2100, 1000)).toMatchObject({ visible: true, held: true })
    expect(engine.evaluate('hold', 'after-false', signal(false), 3099, 1000).visible).toBe(true)
    expect(engine.evaluate('hold', 'after-false', signal(false), 3100, 1000).visible).toBe(false)
  })

  it('expires orphaned deadlines even when a layer is removed before the next evaluation', () => {
    const engine = new MonotonicTemporalTriggerEngine()
    engine.evaluate('pulse', 'pulse', signal(true), 0, 1000)
    expect(engine.nextDeadline(999)).toBe(1000)
    expect(engine.nextDeadline(1000)).toBeUndefined()
  })

  it('fails closed and resets edge history when time moves backwards or a signal becomes unknown', () => {
    const engine = new MonotonicTemporalTriggerEngine()
    engine.evaluate('rise', 'rising', signal(false), 100, 5000)
    expect(engine.evaluate('rise', 'rising', signal(true), 200, 5000).visible).toBe(true)
    expect(engine.evaluate('rise', 'rising', signal(false), 50, 5000).visible).toBe(false)
    expect(engine.evaluate('rise', 'rising', signal(true, false), 60, 5000).visible).toBe(false)
    expect(engine.evaluate('rise', 'rising', signal(true), 70, 5000).visible).toBe(false)
  })
})

describe('OverlayTriggerController semantic policies', () => {
  it('applies the audited trigger-only level rules without threshold drift', () => {
    const active = (semantic: Parameters<typeof semanticOverlayTrigger>[0], partial: Partial<TelemetrySnapshot>) =>
      evaluateOverlayTrigger(semanticOverlayTrigger(semantic), snapshot(partial))

    expect(active('pitFuelToAdd', { onPitRoad: true, pitFuelToAddL: 0 })).toBe(true)
    expect(active('pitFuelToAdd', { onPitRoad: false, pitFuelToAddL: 50 })).toBe(false)
    expect(active('precipitation', { isRaining: true, precipitationPct: 0 })).toBe(true)
    expect(active('precipitation', { isRaining: false, precipitationPct: 0.01 })).toBe(true)
    expect(active('precipitation', { isRaining: false, precipitationPct: 0 })).toBe(false)
    expect(active('repairTime', { onPitRoad: true, repairTimeSec: 0 })).toBe(true)
    expect(active('repairTime', { onPitRoad: false, repairTimeSec: 1 })).toBe(true)
    expect(active('optionalRepairTime', { onPitRoad: false, optionalRepairTimeSec: 0 })).toBe(false)
    expect(active('incidentCounts', { incidentCount: 1 })).toBe(true)
    expect(active('incidentCounts', { incidentCount: 0 })).toBe(false)
    expect(active('repairRequirement', { pit: { repairNeeded: false, optRepairNeeded: true, pitsOpen: false, inPitStall: false } })).toBe(true)
    expect(active('repairRequirement', { pit: { repairNeeded: false, optRepairNeeded: false, pitsOpen: false, inPitStall: false } })).toBe(false)
    expect(active('pitServiceStatus', { onPitRoad: true, pit: { repairNeeded: false, optRepairNeeded: false, pitsOpen: false, inPitStall: false, svStatus: 0 } })).toBe(true)
    expect(active('pitServicesSelected', { onPitRoad: true, pitServiceFlags: [] })).toBe(true)
    expect(active('trackWetness', { trackWetnessPct: 0.01 })).toBe(true)
    expect(active('trackWetness', { trackWetnessPct: 0 })).toBe(false)
    expect(active('fogLevel', { fogPct: 0.01 })).toBe(true)
    expect(active('fogLevel', { fogPct: 0 })).toBe(false)
    expect(active('sideProximity', { carLeftRight: 'clear', carLeftRightCount: 2 })).toBe(false)
    expect(active('sideProximity', { carLeftRight: 'both' })).toBe(true)
    expect(active('raceControlFlags', { flags: {
      green: true, yellow: false, blue: false, white: false, checkered: false,
      red: false, black: false, meatball: false, repair: false, disqualify: false,
      greenWhiteCheckered: false
    } })).toBe(false)
    expect(active('raceControlFlags', { flags: {
      green: true, yellow: true, blue: false, white: false, checkered: false,
      red: false, black: false, meatball: false, repair: false, disqualify: false,
      greenWhiteCheckered: false
    } })).toBe(true)
    expect(active('engineWarnings', { engineWarnings: {
      waterTemp: false, fuelPressure: false, oilPressure: true, oilTemp: false,
      stalled: false, pitLimiter: false, revLimiter: false, mandRepair: false,
      optRepair: false
    } })).toBe(true)
    expect(active('pushToPassState', { pushToPass: true })).toBe(true)
    expect(active('absActive', { absActive: true })).toBe(true)
    expect(active('absCut', { absCutPct: 0.1 })).toBe(true)
    expect(active('tcActive', { tcActive: true })).toBe(true)
    expect(active('declaredWet', { weatherDeclaredWet: true })).toBe(true)
    expect(active('paceMode', { paceMode: 'notPacing' })).toBe(false)
    expect(active('paceMode', { paceMode: 'doubleFileRestart' })).toBe(true)
    expect(active('paceFormation', { paceMode: 'singleFileStart' })).toBe(true)
    expect(active('onPitRoad', { onPitRoad: true })).toBe(true)
    expect(active('pitLimiter', { pitLimiter: true })).toBe(true)
    expect(active('inPitStall', { pit: { repairNeeded: false, optRepairNeeded: false, pitsOpen: false, inPitStall: true } })).toBe(true)
    expect(active('pitStopActive', { pitStopActive: true })).toBe(true)
    expect(active('pitTyreTargets', { onPitRoad: true })).toBe(true)
    expect(active('replayState', { replayPlaying: true })).toBe(true)
    expect(active('replayTimeline', { replayPlaying: true, replayFrameNum: 1 })).toBe(true)
  })

  it('keeps the existing alerts2 thresholds unchanged', () => {
    const active = (semantic: Parameters<typeof semanticOverlayTrigger>[0], partial: Partial<TelemetrySnapshot>) =>
      evaluateOverlayTrigger(semanticOverlayTrigger(semantic), snapshot(partial))

    expect(active('alert2WaterTempCritical', { waterTempC: 104.9 })).toBe(false)
    expect(active('alert2WaterTempCritical', { waterTempC: 105 })).toBe(true)
    expect(active('alert2OilTempCritical', { oilTempC: 124.9 })).toBe(false)
    expect(active('alert2OilTempCritical', { oilTempC: 125 })).toBe(true)
    expect(active('alert2OilPressureLow', { oilPressureKpa: 140.1 })).toBe(false)
    expect(active('alert2OilPressureLow', { oilPressureKpa: 140 })).toBe(true)
    expect(active('alert2BadSurface', { trackSurfaceMaterial: 1 })).toBe(false)
    expect(active('alert2BadSurface', { trackSurfaceMaterial: 15 })).toBe(true)
    expect(active('alert2BlueFlag', { flags: {
      green: false, yellow: false, blue: true, white: false, checkered: false,
      red: false, black: false, meatball: false, repair: false, disqualify: false,
      greenWhiteCheckered: false
    } })).toBe(true)
    expect(active('alert2TyreTempCritical', {
      tyres: { lf: { tempC: 114.9 }, rf: {}, lr: {}, rr: {} }
    })).toBe(false)
    expect(active('alert2TyreTempCritical', {
      tyres: { lf: { tempC: 115 }, rf: {}, lr: {}, rr: {} }
    })).toBe(true)
    expect(active('alert2BrakePressureLow', {
      brake: 0.349,
      brakeLinePressBar: { lf: 18, rf: 17, lr: 14, rr: 13 }
    })).toBe(false)
    expect(active('alert2BrakePressureLow', {
      brake: 0.35,
      brakeLinePressBar: { lf: 24.9, rf: 20, lr: 18, rr: 16 }
    })).toBe(true)
  })

  it('holds PACE CLEAR for exactly 5 seconds after the real pace car enters pits', () => {
    const controller = new OverlayTriggerController()
    const trigger = semanticOverlayTrigger('paceFlags')
    const active = snapshot({ drivers: [{ carIdx: 0, name: 'Pace Car', carNumber: 'PC', position: 0, classPosition: 0, classId: 0, isPlayer: false, isPaceCar: true, inPits: false }] })
    expect(controller.evaluate('pace', trigger, active, 0)).toMatchObject({ visible: true, phase: 'pace-active' })

    const clear = snapshot({ drivers: [{ ...active.drivers![0], inPits: true }] })
    expect(controller.evaluate('pace', trigger, clear, 100)).toMatchObject({ visible: true, held: true, phase: 'pace-clear' })
    expect(controller.evaluate('pace', trigger, clear, 5099).visible).toBe(true)
    expect(controller.evaluate('pace', trigger, clear, 5100).visible).toBe(false)
  })

  it('hides immediately when pace-car identity is missing instead of holding stale data', () => {
    const controller = new OverlayTriggerController()
    const trigger = semanticOverlayTrigger('paceFlags')
    controller.evaluate('pace', trigger, snapshot({ drivers: [{ carIdx: 0, name: 'PC', carNumber: 'PC', position: 0, classPosition: 0, classId: 0, isPlayer: false, isPaceCar: true, inPits: false }] }), 0)
    expect(controller.evaluate('pace', trigger, snapshot({ drivers: [] }), 100).visible).toBe(false)
  })

  it('shows SERVICE DONE for 4 seconds on repair-pending clear or service 1→2', () => {
    const trigger = semanticOverlayTrigger('pitServiceStatus')
    const repairController = new OverlayTriggerController()
    repairController.evaluate('repair', trigger, snapshot({
      onPitRoad: false,
      pit: { repairNeeded: true, optRepairNeeded: false, pitsOpen: false, inPitStall: false, svStatus: 0 }
    }), 0)
    const repairDone = snapshot({
      onPitRoad: false,
      pit: { repairNeeded: false, optRepairNeeded: false, pitsOpen: false, inPitStall: false, svStatus: 0 }
    })
    expect(repairController.evaluate('repair', trigger, repairDone, 100)).toMatchObject({ visible: true, held: true, phase: 'service-done' })

    const serviceController = new OverlayTriggerController()
    serviceController.evaluate('service', trigger, snapshot({
      onPitRoad: false,
      pit: { repairNeeded: false, optRepairNeeded: false, pitsOpen: false, inPitStall: false, svStatus: 1 }
    }), 0)
    const serviceDone = snapshot({
      onPitRoad: false,
      pit: { repairNeeded: false, optRepairNeeded: false, pitsOpen: false, inPitStall: false, svStatus: 2 }
    })
    expect(serviceController.evaluate('service', trigger, serviceDone, 100)).toMatchObject({ visible: true, held: true, phase: 'service-done' })
    expect(serviceController.evaluate('service', trigger, serviceDone, 4099).visible).toBe(true)
    expect(serviceController.evaluate('service', trigger, serviceDone, 4100).visible).toBe(false)
  })

  it('shows DRS states and a five-second deactivated hold while unknown values hide', () => {
    const controller = new OverlayTriggerController()
    const trigger = semanticOverlayTrigger('drs')
    expect(controller.evaluate('drs', trigger, snapshot({ drsState: 0 }), 0).visible).toBe(false)
    expect(controller.evaluate('drs', trigger, snapshot({ drsState: 3 }), 100)).toMatchObject({ visible: true, phase: 'drs-state' })
    expect(controller.evaluate('drs', trigger, snapshot({ drsState: 2 }), 200)).toMatchObject({ visible: true, phase: 'drs-deactivated' })
    expect(controller.evaluate('drs', trigger, snapshot({ drsState: 2 }), 5199).visible).toBe(true)
    expect(controller.evaluate('drs', trigger, snapshot({ drsState: 2 }), 5200)).toMatchObject({ visible: true, phase: 'drs-state' })
    expect(controller.evaluate('drs', trigger, snapshot({ drsState: undefined }), 5300).visible).toBe(false)
  })

  it('pulses PITS OPEN once per false→true transition and never on a cold true sample', () => {
    const controller = new OverlayTriggerController()
    const trigger = semanticOverlayTrigger('pitsOpen')
    const open = snapshot({ pit: { repairNeeded: false, optRepairNeeded: false, pitsOpen: true, inPitStall: false } })
    const closed = snapshot({ pit: { repairNeeded: false, optRepairNeeded: false, pitsOpen: false, inPitStall: false } })
    expect(controller.evaluate('pits', trigger, open, 0).visible).toBe(false)
    controller.evaluate('pits', trigger, closed, 10)
    expect(controller.evaluate('pits', trigger, open, 20).visible).toBe(true)
    expect(controller.evaluate('pits', trigger, open, 5020).visible).toBe(false)
    controller.evaluate('pits', trigger, closed, 5100)
    expect(controller.evaluate('pits', trigger, open, 5200).visible).toBe(true)
  })

  it('resets temporal history on disconnect, session identity changes, and replay rewind', () => {
    const trigger = semanticOverlayTrigger('pitsOpen')
    const closed = snapshot({ pit: { repairNeeded: false, optRepairNeeded: false, pitsOpen: false, inPitStall: false }, replayPlaying: true, replayFrameNum: 20 })
    const open = snapshot({ ...closed, pit: { ...closed.pit!, pitsOpen: true }, replayFrameNum: 21 })

    const disconnected = new OverlayTriggerController()
    disconnected.evaluate('pits', trigger, closed, 0)
    expect(disconnected.evaluate('pits', trigger, open, 10).visible).toBe(true)
    disconnected.evaluate('pits', trigger, snapshot({ connected: false }), 20)
    expect(disconnected.evaluate('pits', trigger, open, 30).visible).toBe(false)

    const session = new OverlayTriggerController()
    session.evaluate('pits', trigger, closed, 0)
    expect(session.evaluate('pits', trigger, snapshot({ ...open, sessionUniqueId: 11 }), 10).visible).toBe(false)

    const rewind = new OverlayTriggerController()
    rewind.evaluate('pits', trigger, closed, 0)
    expect(rewind.evaluate('pits', trigger, open, 10).visible).toBe(true)
    expect(rewind.evaluate('pits', trigger, snapshot({ ...open, replayFrameNum: 5 }), 20).visible).toBe(false)
  })

  it('resets temporal history across replay token, state, and connection-epoch boundaries', () => {
    const trigger = semanticOverlayTrigger('pitsOpen')
    const replayContext = {
      active: true,
      state: 'replay' as const,
      reason: 'replay-playing' as const,
      inputs: {},
      sessionIdentity: 'session-10',
      connectionEpoch: 1,
      revision: 1,
      token: 'replay:1'
    }
    const closed = snapshot({
      pit: { repairNeeded: false, optRepairNeeded: false, pitsOpen: false, inPitStall: false },
      replayPlaying: true,
      replayContext
    })
    const open = snapshot({
      ...closed,
      pit: { ...closed.pit!, pitsOpen: true },
      replayContext: { ...replayContext, revision: 2, token: 'replay:2' }
    })
    const controller = new OverlayTriggerController()

    controller.evaluate('pits', trigger, closed, 0)
    expect(controller.evaluate('pits', trigger, open, 10).visible).toBe(false)

    controller.evaluate('pits', trigger, closed, 20)
    expect(
      controller.evaluate(
        'pits',
        trigger,
        snapshot({
          ...open,
          replayPlaying: false,
          replayContext: {
            ...replayContext,
            active: false,
            state: 'live',
            reason: 'confirmed-live',
            connectionEpoch: 2,
            revision: 3,
            token: 'live:2'
          }
        }),
        30
      ).visible
    ).toBe(false)
  })

  it('migrates generated raceFlags modules to the race-control alert role', () => {
    for (const style of ['competition', 'futuristic', 'ddu']) {
      const moduleId = `telemetry-raceFlags-${style}`
      expect(semanticTriggerForHifiModule(moduleId)).toEqual(semanticOverlayTrigger('raceControlFlags'))
      expect(hifiModuleRole(moduleId)).toBe('alert')
    }
  })

  it('keeps preview state isolated from live state and survives config reconstruction', () => {
    const trigger = semanticOverlayTrigger('pitsOpen')
    const closed = snapshot({ pit: { repairNeeded: false, optRepairNeeded: false, pitsOpen: false, inPitStall: false } })
    const open = snapshot({ pit: { ...closed.pit!, pitsOpen: true } })
    const live = new OverlayTriggerController()
    const preview = new OverlayTriggerController()

    preview.evaluate('preview:pits', trigger, closed, 0)
    expect(preview.evaluate('preview:pits', trigger, open, 10).visible).toBe(true)
    expect(live.evaluate('pits', { ...trigger }, open, 10).visible).toBe(false)

    live.evaluate('pits', { ...trigger }, closed, 20)
    expect(live.evaluate('pits', { ...trigger }, open, 30).visible).toBe(true)
  })
})
