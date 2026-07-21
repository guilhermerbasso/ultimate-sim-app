import { describe, expect, it } from 'vitest'
import type { PredictionsSnapshot } from './predictions'
import type { ReplayContext, ReplayContextState } from './replay'
import { resolveRaceMoment, type RaceMomentState } from './race-moment'
import type { TelemetrySnapshot } from './telemetry'

function replayContext(
  state: ReplayContextState,
  revision: number,
  sessionIdentity: string,
  connectionEpoch: number
): ReplayContext {
  const reason = state === 'live' ? 'confirmed-live' : state === 'replay' ? 'replay-playing' : 'missing-metadata'
  return {
    state,
    reason,
    inputs: {},
    active: state !== 'live',
    revision,
    token: `${connectionEpoch}:${revision}`,
    sessionIdentity,
    connectionEpoch
  }
}

function snapshot(
  state: ReplayContextState,
  revision: number,
  sessionIdentity: string,
  connectionEpoch: number,
  overrides: Partial<TelemetrySnapshot> = {}
): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 1_000 + revision * 100,
    speedKmh: 180,
    rpm: 7_000,
    gear: 4,
    throttle: 0.8,
    brake: 0,
    clutch: 0,
    sessionType: 'Race',
    currentLap: 5,
    replayContext: replayContext(state, revision, sessionIdentity, connectionEpoch),
    ...overrides
  }
}

function dirtyLiveState(sessionIdentity = 'live-a', connectionEpoch = 1): RaceMomentState {
  const inPit = resolveRaceMoment(
    snapshot('live', 0, sessionIdentity, connectionEpoch, {
      incidentCountMy: 4,
      onPitRoad: true
    }),
    null,
    null,
    { now: 1_000 }
  )
  const leavingPit = resolveRaceMoment(
    snapshot('live', 0, sessionIdentity, connectionEpoch, {
      incidentCountMy: 4,
      onPitRoad: false
    }),
    null,
    inPit,
    { now: 1_100 }
  )
  expect(leavingPit.candidate).toBe('out-lap')
  return leavingPit
}

function caughtBehind(etaLaps: number): PredictionsSnapshot {
  return {
    fuel: { lapsLeftAtPace: 20, finishMarginLaps: 10, finishMarginL: 30 },
    tire: { degSecPerLap: 0.1, pressureState: 'ok', tempState: 'cold' },
    pace: { projectedLapSec: 90, confidence: 0.8 },
    caughtBehind: {
      carIdx: 3,
      gapSec: 2,
      closingSecPerLap: 0.5,
      etaSec: 4,
      etaLaps
    }
  }
}

function fuelCritical(): PredictionsSnapshot {
  return {
    ...caughtBehind(1.5),
    fuel: { lapsLeftAtPace: 0.5, finishMarginLaps: 0.2, finishMarginL: 0.5 }
  }
}

function expectSilentSeed(state: RaceMomentState, incidentCount: number, now: number): void {
  expect(state).toMatchObject({
    moment: 'clear-running',
    color: 'normal',
    since: now,
    lastSwitchAt: 0,
    candidate: null,
    candidateSince: now,
    lastIncidentCount: incidentCount,
    incidentAt: 0,
    leftPitAt: 0,
    lastOnPitRoad: false,
    updatedAt: now,
    suspendedHysteresis: null
  })
}

describe('race moment canonical live boundaries', () => {
  it('silently seeds the first live-B frame instead of carrying live-A edges or cooldowns', () => {
    const liveA = dirtyLiveState()

    const liveB = resolveRaceMoment(
      snapshot('live', 1, 'live-b', 1, {
        incidentCountMy: 12,
        onPitRoad: false,
        speedKmh: 20,
        throttle: 0,
        brake: 0.9
      }),
      null,
      liveA,
      { now: 1_200 }
    )

    expectSilentSeed(liveB, 12, 1_200)
  })

  it('treats a connection epoch change as a new live context', () => {
    const epochOne = dirtyLiveState('same-session', 1)

    const epochTwo = resolveRaceMoment(
      snapshot('live', 1, 'same-session', 2, {
        incidentCountMy: 9,
        onPitRoad: false,
        speedKmh: 15,
        steerAngleDeg: 120
      }),
      null,
      epochOne,
      { now: 2_000 }
    )

    expectSilentSeed(epochTwo, 9, 2_000)
  })

  it('preserves under-pressure stay hysteresis across same-session replay while reseeding edges', () => {
    const live = resolveRaceMoment(
      snapshot('live', 0, 'same-session', 1, {
        incidentCountMy: 4,
        onPitRoad: false
      }),
      caughtBehind(1.5),
      null,
      { now: 1_000 }
    )
    expect(live.moment).toBe('under-pressure')

    const replay = resolveRaceMoment(
      snapshot('replay', 1, 'same-session', 1),
      null,
      live,
      { now: 1_100 }
    )
    expect(replay.moment).toBe('clear-running')
    expect(replay.suspendedHysteresis).toMatchObject({
      moment: 'under-pressure',
      lastSwitchAt: 1_000
    })
    expect(replay.lastSwitchAt).toBe(1_000)

    const resumed = resolveRaceMoment(
      snapshot('live', 2, 'same-session', 1, {
        incidentCountMy: 10,
        onPitRoad: false,
        speedKmh: 10,
        brake: 1,
        throttle: 0
      }),
      caughtBehind(3),
      replay,
      { now: 1_200 }
    )

    expect(resumed).toMatchObject({
      moment: 'under-pressure',
      lastSwitchAt: 1_000,
      candidate: null,
      lastIncidentCount: 10,
      incidentAt: 0,
      leftPitAt: 0,
      lastOnPitRoad: false,
      suspendedHysteresis: null
    })
  })

  it('hard resets when replay resumes into a different live session', () => {
    const liveA = dirtyLiveState('live-a', 1)
    const replay = resolveRaceMoment(
      snapshot('replay', 1, 'live-a', 1),
      null,
      liveA,
      { now: 2_000 }
    )

    const liveB = resolveRaceMoment(
      snapshot('live', 2, 'live-b', 1, {
        incidentCountMy: 10,
        onPitRoad: false,
        speedKmh: 10,
        brake: 1,
        throttle: 0
      }),
      null,
      replay,
      { now: 2_100 }
    )

    expectSilentSeed(liveB, 10, 2_100)
  })

  it('preserves a pending candidate and cooldown across same-session replay', () => {
    const underPressure = resolveRaceMoment(
      snapshot('live', 0, 'same-session', 1),
      caughtBehind(1.5),
      null,
      { now: 1_000 }
    )
    const pendingFuel = resolveRaceMoment(
      snapshot('live', 0, 'same-session', 1),
      fuelCritical(),
      underPressure,
      { now: 1_100 }
    )
    expect(pendingFuel).toMatchObject({
      moment: 'under-pressure',
      candidate: 'fuel-critical',
      candidateSince: 1_100,
      lastSwitchAt: 1_000
    })

    const replay = resolveRaceMoment(
      snapshot('replay', 1, 'same-session', 1),
      null,
      pendingFuel,
      { now: 1_150 }
    )
    expect(replay).toMatchObject({
      candidate: 'fuel-critical',
      candidateSince: 1_100,
      lastSwitchAt: 1_000
    })
    const resumed = resolveRaceMoment(
      snapshot('live', 2, 'same-session', 1),
      fuelCritical(),
      replay,
      { now: 1_200 }
    )

    expect(resumed).toMatchObject({
      moment: 'under-pressure',
      candidate: 'fuel-critical',
      candidateSince: 1_100,
      lastSwitchAt: 1_000
    })
  })

  it('hard resets fallback state on Race → Hotlap', () => {
    const race = {
      sim: 'acc',
      connected: true,
      timestamp: 101_000,
      sessionTimeSec: 100,
      sessionKind: 'race',
      trackName: 'Spa',
      trackConfigName: 'GP',
      carName: 'GT3 R',
      speedKmh: 100,
      onPitRoad: true,
      currentLap: 3
    } as TelemetrySnapshot
    const inPit = resolveRaceMoment(race, null, null, { now: 1_000 })
    const dirty = resolveRaceMoment(
      { ...race, timestamp: 102_000, sessionTimeSec: 101, onPitRoad: false },
      null,
      inPit,
      { now: 1_100 }
    )
    expect(dirty.candidate).toBe('out-lap')

    const hotlap = resolveRaceMoment(
      {
        ...race,
        timestamp: 200_000,
        sessionTimeSec: 0,
        sessionKind: 'hotlap',
        sessionType: '3',
        onPitRoad: false,
        lapDistPct: 0.4,
        speedKmh: 200
      },
      null,
      dirty,
      { now: 1_200 }
    )
    expect(hotlap.moment).toBe('qualifying-lap')
    expect(hotlap.candidate).toBeNull()
    expect(hotlap.leftPitAt).toBe(0)
  })
})
