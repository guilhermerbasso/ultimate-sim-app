import { describe, expect, it } from 'vitest'
import type { TelemetrySnapshot } from './telemetry'
import type { PredictionsSnapshot } from './predictions'
import type { DashboardElement } from './dashboards'
import {
  resolveRaceMoment,
  initialRaceMomentState,
  raceMomentPreset,
  RACE_MOMENTS_BY_PRECEDENCE,
  DEFAULT_RACE_MOMENT_TUNABLES,
  type RaceMoment,
  type RaceMomentState
} from './race-moment'
import { momentLayerFor, withRaceMoment, applyAdaptivePlan, planAdaptiveDashboard } from './dashboard-adaptive'

function snap(overrides: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 1_000,
    speedKmh: 180,
    rpm: 7000,
    gear: 4,
    throttle: 1,
    brake: 0,
    clutch: 0,
    sessionType: 'Race',
    currentLap: 5,
    ...overrides
  }
}

function preds(overrides: Partial<PredictionsSnapshot> = {}): PredictionsSnapshot {
  return {
    fuel: { lapsLeftAtPace: 20, finishMarginLaps: 10, finishMarginL: 30 },
    tire: { degSecPerLap: 0.1, pressureState: 'ok', tempState: 'cold' },
    pace: { projectedLapSec: 90, confidence: 0.8 },
    ...overrides
  }
}

/** Drive the reducer until it commits `expected`, returning the final state. */
function commit(
  snapshot: TelemetrySnapshot,
  predictions: PredictionsSnapshot | null,
  prev: RaceMomentState | null,
  startNow: number
): RaceMomentState {
  let st = resolveRaceMoment(snapshot, predictions, prev, { now: startNow })
  let t = startNow
  for (let i = 0; i < 40 && st.candidate !== null; i++) {
    t += 100
    st = resolveRaceMoment(snapshot, predictions, st, { now: t })
  }
  return st
}

describe('resolveRaceMoment — basic detection', () => {
  it('defaults to clear-running with no signals', () => {
    const st = resolveRaceMoment(snap(), preds(), null, { now: 1000 })
    expect(st.moment).toBe('clear-running')
    expect(st.color).toBe('normal')
  })

  it('returns clear-running when disconnected', () => {
    const prev = resolveRaceMoment(snap({ flags: { green: false, yellow: true, blue: false, white: false, checkered: false, red: false, black: false, meatball: false, repair: false, disqualify: false, greenWhiteCheckered: false } }), preds(), null, { now: 1000 })
    expect(prev.moment).toBe('safety-car')
    const off = resolveRaceMoment(snap({ connected: false }), preds(), prev, { now: 1100 })
    expect(off.moment).toBe('clear-running')
  })

  it('commits the first observation immediately (no dwell on init)', () => {
    const st = resolveRaceMoment(
      snap({ position: 1 }),
      preds(),
      null,
      { now: 5000 }
    )
    expect(st.moment).toBe('leading-p1')
    expect(st.color).toBe('good')
  })

  it('detects fuel-critical from predictions finishMarginLaps', () => {
    const st = resolveRaceMoment(snap(), preds({ fuel: { lapsLeftAtPace: 1, finishMarginLaps: 0.5, finishMarginL: 1 } }), null, { now: 1000 })
    expect(st.moment).toBe('fuel-critical')
    expect(st.color).toBe('critical')
  })

  it('detects fuel-critical from raw telemetry when predictions absent', () => {
    const st = resolveRaceMoment(snap({ fuelLiters: 2, fuelPerLap: 1, lapsRemaining: 2 }), null, null, { now: 1000 })
    // margin = 2/1 - 2 = 0 < 1.0 enter
    expect(st.moment).toBe('fuel-critical')
  })

  it('does NOT fire fuel-critical on the iRacing timed-session sentinel (lapsRemaining 32767)', () => {
    // Timed RACE: SessionLapsRemainEx = 32767. Without the sentinel guard the raw
    // margin would be ~ -32765 → false fuel-critical until the time-based prediction arrives.
    const st = resolveRaceMoment(snap({ fuelLiters: 2, fuelPerLap: 1, lapsRemaining: 32767 }), null, null, { now: 1000 })
    expect(st.moment).not.toBe('fuel-critical')
  })

  it('detects tire-pressure-low and tire-optimal-temp from predictions', () => {
    const low = resolveRaceMoment(snap(), preds({ tire: { degSecPerLap: 0, pressureState: 'low', tempState: 'cold' } }), null, { now: 1000 })
    expect(low.moment).toBe('tire-pressure-low')
    const opt = resolveRaceMoment(snap(), preds({ tire: { degSecPerLap: 0, pressureState: 'ok', tempState: 'optimal' } }), null, { now: 1000 })
    expect(opt.moment).toBe('tire-optimal-temp')
  })

  it('detects under-pressure (caught behind) and attacking (catch ahead)', () => {
    const up = resolveRaceMoment(snap(), preds({ caughtBehind: { carIdx: 3, gapSec: 1.2, closingSecPerLap: 0.6, etaSec: 2, etaLaps: 1.5 } }), null, { now: 1000 })
    expect(up.moment).toBe('under-pressure')
    const atk = resolveRaceMoment(snap(), preds({ catchAhead: { carIdx: 2, gapSec: 1.2, closingSecPerLap: 0.6, etaSec: 2, etaLaps: 1.5 } }), null, { now: 1000 })
    expect(atk.moment).toBe('attacking')
  })

  it('detects last-lap from lapsRemaining', () => {
    const st = resolveRaceMoment(snap({ lapsRemaining: 1 }), preds(), null, { now: 1000 })
    expect(st.moment).toBe('last-lap')
  })

  it('detects qualifying flying lap', () => {
    const st = resolveRaceMoment(snap({ sessionType: 'Open Qualify', lapDistPct: 0.4, speedKmh: 200 }), preds(), null, { now: 1000 })
    expect(st.moment).toBe('qualifying-lap')
  })

  it('treats ACC hotlap as a qualifying-lap hero without making it a race', () => {
    const st = resolveRaceMoment(
      snap({
        sim: 'acc',
        sessionType: '3',
        sessionKind: 'hotlap',
        lapDistPct: 0.4,
        speedKmh: 200
      }),
      preds(),
      null,
      { now: 1000 }
    )
    expect(st.moment).toBe('qualifying-lap')
  })
})

describe('resolveRaceMoment — precedence', () => {
  it('the precedence array is the canonical ranking with clear-running last', () => {
    expect(RACE_MOMENTS_BY_PRECEDENCE[0]).toBe('incident-recovery')
    expect(RACE_MOMENTS_BY_PRECEDENCE[RACE_MOMENTS_BY_PRECEDENCE.length - 1]).toBe('clear-running')
  })

  it('fuel-critical outranks leading-p1 and tire moments simultaneously active', () => {
    const st = resolveRaceMoment(
      snap({ position: 1 }),
      preds({
        fuel: { lapsLeftAtPace: 0.5, finishMarginLaps: 0.2, finishMarginL: 0.5 },
        tire: { degSecPerLap: 0, pressureState: 'low', tempState: 'optimal' }
      }),
      null,
      { now: 1000 }
    )
    expect(st.moment).toBe('fuel-critical')
  })

  it('safety-car (yellow) outranks fuel-critical', () => {
    const st = resolveRaceMoment(
      snap({ flags: { green: false, yellow: true, blue: false, white: false, checkered: false, red: false, black: false, meatball: false, repair: false, disqualify: false, greenWhiteCheckered: false } }),
      preds({ fuel: { lapsLeftAtPace: 0.5, finishMarginLaps: 0.2, finishMarginL: 0.5 } }),
      null,
      { now: 1000 }
    )
    expect(st.moment).toBe('safety-car')
  })

  it('incident-recovery (top precedence) wins when a fresh incident + recovery occurs', () => {
    const base = initialRaceMomentState(0)
    base.lastIncidentCount = 3
    const st = commit(
      snap({ incidentCount: 5, speedKmh: 20, position: 1 }),
      preds({ fuel: { lapsLeftAtPace: 0.5, finishMarginLaps: 0.2, finishMarginL: 0.5 } }),
      base,
      1000
    )
    expect(st.moment).toBe('incident-recovery')
    expect(st.color).toBe('critical')
  })
})

describe('resolveRaceMoment — Schmitt hysteresis (asymmetric enter/exit)', () => {
  it('stays under-pressure between enter and exit thresholds, exits past exit band', () => {
    // Enter at etaLaps 1.5 (<= 2 enter)
    const entered = resolveRaceMoment(snap(), preds({ caughtBehind: { carIdx: 3, gapSec: 1, closingSecPerLap: 0.5, etaSec: 2, etaLaps: 1.5 } }), null, { now: 1000 })
    expect(entered.moment).toBe('under-pressure')

    // etaLaps 3.0: above enter (2) but within exit band (3.5) → STAY
    const held = resolveRaceMoment(snap(), preds({ caughtBehind: { carIdx: 3, gapSec: 2, closingSecPerLap: 0.2, etaSec: 4, etaLaps: 3.0 } }), entered, { now: 1100 })
    expect(held.moment).toBe('under-pressure')

    // etaLaps 4.0: past exit band → leaves (after dwell/cooldown)
    const left = commit(snap(), preds({ caughtBehind: { carIdx: 3, gapSec: 3, closingSecPerLap: 0.05, etaSec: 8, etaLaps: 4.0 } }), held, 5000)
    expect(left.moment).toBe('clear-running')
  })
})

describe('resolveRaceMoment — dwell + cooldown anti-flicker', () => {
  const tun = DEFAULT_RACE_MOMENT_TUNABLES

  it('holds the current hero until a candidate satisfies min dwell', () => {
    const s0 = resolveRaceMoment(snap(), preds(), null, { now: 10000 }) // clear-running
    const up = preds({ caughtBehind: { carIdx: 3, gapSec: 1, closingSecPerLap: 0.5, etaSec: 2, etaLaps: 1.5 } })

    const s1 = resolveRaceMoment(snap(), up, s0, { now: 10000 })
    expect(s1.moment).toBe('clear-running') // candidate pending, dwell not met
    expect(s1.candidate).toBe('under-pressure')

    const s2 = resolveRaceMoment(snap(), up, s1, { now: 10000 + tun.dwellMs - 50 })
    expect(s2.moment).toBe('clear-running') // still within dwell

    const s3 = resolveRaceMoment(snap(), up, s2, { now: 10000 + tun.dwellMs })
    expect(s3.moment).toBe('under-pressure') // dwell satisfied → commit
    expect(s3.candidate).toBeNull()
  })

  it('blocks a second switch during the cooldown window', () => {
    // Commit under-pressure at t=1000 (immediate, prev=null).
    const committed = resolveRaceMoment(snap(), preds({ caughtBehind: { carIdx: 3, gapSec: 1, closingSecPerLap: 0.5, etaSec: 2, etaLaps: 1.5 } }), null, { now: 1000 })
    expect(committed.moment).toBe('under-pressure')
    expect(committed.lastSwitchAt).toBe(1000)

    const fuel = preds({ fuel: { lapsLeftAtPace: 0.5, finishMarginLaps: 0.2, finishMarginL: 0.5 } })

    // Dwell satisfied but cooldown NOT (1000 + dwell < 1000 + cooldown).
    const duringCooldown = resolveRaceMoment(snap(), fuel, committed, { now: 1000 + tun.dwellMs })
    expect(duringCooldown.moment).toBe('under-pressure')

    // Past cooldown + dwell → switch is allowed.
    const afterCooldown = commit(snap(), fuel, committed, 1000 + tun.cooldownMs + tun.dwellMs)
    expect(afterCooldown.moment).toBe('fuel-critical')
  })

  const ALL_FLAGS_FALSE = {
    green: false,
    yellow: false,
    blue: false,
    white: false,
    checkered: false,
    red: false,
    black: false,
    meatball: false,
    repair: false,
    disqualify: false,
    greenWhiteCheckered: false
  }

  it('lets a CRITICAL moment (safety-car) BYPASS the post-switch cooldown', () => {
    // Commit under-pressure at t=1000 (lastSwitchAt=1000).
    const committed = resolveRaceMoment(
      snap(),
      preds({ caughtBehind: { carIdx: 3, gapSec: 1, closingSecPerLap: 0.5, etaSec: 2, etaLaps: 1.5 } }),
      null,
      { now: 1000 }
    )
    expect(committed.moment).toBe('under-pressure')
    expect(committed.lastSwitchAt).toBe(1000)

    const yellow = snap({ flags: { ...ALL_FLAGS_FALSE, yellow: true } })

    // Well inside the cooldown window — a non-critical switch would be blocked.
    const s1 = resolveRaceMoment(yellow, preds(), committed, { now: 1100 })
    expect(s1.candidate).toBe('safety-car')
    expect(s1.moment).toBe('under-pressure') // tiny critical dwell not yet met

    // After only the tiny criticalDwellMs (cooldown still NOT elapsed) it commits.
    const s2 = resolveRaceMoment(yellow, preds(), s1, { now: 1100 + tun.criticalDwellMs })
    expect(s2.moment).toBe('safety-car')
    expect(s2.since - committed.lastSwitchAt).toBeLessThan(tun.cooldownMs) // bypassed cooldown
  })
})

describe('resolveRaceMoment — fuel-critical gating (M2)', () => {
  it('does NOT trigger fuel-critical outside a race (practice/quali)', () => {
    const practice = snap({ sessionType: 'Practice' })
    const st = resolveRaceMoment(
      practice,
      preds({ fuel: { lapsLeftAtPace: 0.5, finishMarginLaps: 0.2, finishMarginL: 0.5 } }),
      null,
      { now: 1000 }
    )
    expect(st.moment).not.toBe('fuel-critical')
  })

  it('does NOT trigger fuel-critical when the fuel margin is unknown (undefined)', () => {
    // Unknown race distance → finishMarginLaps undefined, and no raw telemetry to
    // derive a margin → must never read as a phantom 0-lap critical.
    const st = resolveRaceMoment(snap(), preds({ fuel: { lapsLeftAtPace: 0.5 } }), null, { now: 1000 })
    expect(st.moment).not.toBe('fuel-critical')
  })
})

describe('momentLayerFor / withRaceMoment / applyAdaptivePlan', () => {
  it('builds a layer with promote/demote/color from a state', () => {
    const state = resolveRaceMoment(snap(), preds({ fuel: { lapsLeftAtPace: 0.5, finishMarginLaps: 0.2, finishMarginL: 0.5 } }), null, { now: 1000 })
    const layer = momentLayerFor(state)
    expect(layer).not.toBeNull()
    expect(layer!.moment).toBe('fuel-critical')
    expect(layer!.color).toBe('critical')
    expect(layer!.byConcept.fuel).toBe('promote')
    expect(layer!.byConcept.radar).toBe('demote')
  })

  it('caps promotions to 3 widgets and never removes demoted ones', () => {
    const lowPressure = resolveRaceMoment(snap(), preds({ tire: { degSecPerLap: 0, pressureState: 'low', tempState: 'cold' } }), null, { now: 1000 })
    const plan = withRaceMoment(planAdaptiveDashboard(snap(), { dynamic: false }), lowPressure)

    const els: DashboardElement[] = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`,
      type: 'tyregrid',
      x: i * 10,
      y: 0,
      w: 50,
      h: 50,
      style: {}
    }))
    const out = applyAdaptivePlan(els, plan)
    const promoted = out.filter((r) => r.moment?.action === 'promote')
    expect(promoted.length).toBeLessThanOrEqual(3)
    // Positions are never changed by the moment layer.
    out.forEach((r, i) => {
      expect(r.element.x).toBe(els[i].x)
      expect(r.element.w).toBe(els[i].w)
    })
    // Demoted widgets dim but stay visible.
    const demoted = out.find((r) => r.moment?.action === 'demote')
    if (demoted) expect(demoted.element.visible).not.toBe(false)
  })

  it('withRaceMoment with null state leaves the plan untouched', () => {
    const plan = planAdaptiveDashboard(snap(), { dynamic: false })
    expect(withRaceMoment(plan, null).momentLayer).toBeUndefined()
  })

  it('every moment has a preset with a label and a valid colour', () => {
    for (const m of RACE_MOMENTS_BY_PRECEDENCE) {
      const p = raceMomentPreset(m as RaceMoment)
      expect(p.label.length).toBeGreaterThan(0)
      expect(['normal', 'caution', 'critical', 'good']).toContain(p.color)
      expect(p.promote.length).toBeLessThanOrEqual(3)
    }
  })
})
