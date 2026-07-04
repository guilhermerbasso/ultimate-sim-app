import { describe, expect, it } from 'vitest'
import type { TelemetrySnapshot } from './telemetry'
import type { PredictionsSnapshot } from './predictions'
import {
  MOMENT_CATALOG,
  MOMENT_CATALOG_IDS,
  MOMENT_GROUP_LABELS,
  RACE_MOMENTS_BY_PRECEDENCE,
  detectActiveMoments,
  initialRaceMomentState,
  momentCatalogEntry,
  momentLabel,
  resolveRaceMoment,
  type MomentGroup
} from './race-moment'

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

describe('MOMENT_CATALOG', () => {
  it('has unique, non-empty ids and PT-BR labels/descriptions', () => {
    const ids = MOMENT_CATALOG.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const e of MOMENT_CATALOG) {
      expect(e.id.length).toBeGreaterThan(0)
      expect(e.label.length).toBeGreaterThan(0)
      expect(e.description.length).toBeGreaterThan(0)
    }
  })

  it('includes every existing RaceMoment id (back-compat)', () => {
    for (const m of RACE_MOMENTS_BY_PRECEDENCE) {
      expect(MOMENT_CATALOG_IDS.has(m)).toBe(true)
    }
  })

  it('covers the requested taxonomy groups', () => {
    const expected = ['session', 'lap', 'situational', 'micro'] as MomentGroup[]
    for (const g of expected) {
      expect(MOMENT_CATALOG.some((e) => e.group === g)).toBe(true)
      expect(MOMENT_GROUP_LABELS[g].length).toBeGreaterThan(0)
    }
  })

  it('lists key new moments the editor must offer', () => {
    const ids = new Set(MOMENT_CATALOG.map((e) => e.id))
    for (const id of [
      'qualifying',
      'race-start',
      'final-laps',
      'crossing-start-finish',
      'sector-1-entry',
      'braking-zone',
      'on-straight',
      'traffic-ahead',
      'defending',
      'overtake-window',
      'fuel-save',
      'tyre-cliff'
    ]) {
      expect(ids.has(id)).toBe(true)
    }
  })

  it('momentCatalogEntry / momentLabel resolve known + unknown ids', () => {
    expect(momentCatalogEntry('last-lap')?.group).toBe('session')
    expect(momentLabel('last-lap')).toBe('Última volta')
    expect(momentCatalogEntry('nope')).toBeUndefined()
    expect(momentLabel('nope')).toBe('nope')
  })
})

describe('detectActiveMoments', () => {
  it('returns garage when disconnected/null', () => {
    expect([...detectActiveMoments(null, null, null)]).toEqual(['garage'])
    expect([...detectActiveMoments(snap({ connected: false }), null, null)]).toEqual(['garage'])
  })

  it('includes the committed hero moment', () => {
    const hero = initialRaceMomentState(0)
    hero.moment = 'attacking'
    const active = detectActiveMoments(snap({ sessionType: 'Race', currentLap: 5 }), preds(), hero)
    expect(active.has('attacking')).toBe(true)
  })

  it('detects race lifecycle: race-start + green + mid-race', () => {
    const flags = baseFlags({ green: true })
    const active = detectActiveMoments(snap({ sessionType: 'Race', currentLap: 1, lapsRemaining: 20, flags }), preds(), null)
    expect(active.has('race-start')).toBe(true)
    expect(active.has('green')).toBe(true)
    expect(active.has('mid-race')).toBe(true)
    expect(active.has('final-laps')).toBe(false)
  })

  it('detects final-laps + last-lap near the end', () => {
    const active = detectActiveMoments(snap({ sessionType: 'Race', currentLap: 30, lapsRemaining: 1 }), preds(), null)
    expect(active.has('final-laps')).toBe(true)
    expect(active.has('last-lap')).toBe(true)
  })

  it('detects qualifying session phase', () => {
    const active = detectActiveMoments(snap({ sessionType: 'Open Qualify', currentLap: 2 }), preds(), null)
    expect(active.has('qualifying')).toBe(true)
  })

  it('detects lap moments from lapDistPct + inputs', () => {
    const onStraight = detectActiveMoments(
      snap({ sessionType: 'Race', currentLap: 5, lapDistPct: 0.5, steerAngleDeg: 2, throttle: 1, speedKmh: 200 }),
      preds(),
      null
    )
    expect(onStraight.has('on-straight')).toBe(true)

    const braking = detectActiveMoments(
      snap({ sessionType: 'Race', currentLap: 5, lapDistPct: 0.5, brake: 0.8, throttle: 0, speedKmh: 120 }),
      preds(),
      null
    )
    expect(braking.has('braking-zone')).toBe(true)

    const crossing = detectActiveMoments(snap({ sessionType: 'Race', currentLap: 5, lapDistPct: 0.005 }), preds(), null)
    expect(crossing.has('crossing-start-finish')).toBe(true)
    expect(crossing.has('sector-1-entry')).toBe(true)
  })

  it('detects situational: blue-flag/being-lapped, traffic, defending, overtake-window, tyre-cliff', () => {
    const blue = detectActiveMoments(snap({ sessionType: 'Race', currentLap: 5, flags: baseFlags({ blue: true }) }), preds(), null)
    expect(blue.has('blue-flag')).toBe(true)
    expect(blue.has('being-lapped')).toBe(true)

    const traffic = detectActiveMoments(
      snap({ sessionType: 'Race', currentLap: 5, relatives: { ahead: { carIdx: 2, name: 'X', carNumber: '9', gapSec: 0.6 } } }),
      preds(),
      null
    )
    expect(traffic.has('traffic-ahead')).toBe(true)

    const overtake = detectActiveMoments(
      snap({ sessionType: 'Race', currentLap: 5 }),
      preds({ catchAhead: { carIdx: 3, etaSec: 50, etaLaps: 0.8, gapSec: 0.7, closingSecPerLap: 0.5, lowConfidence: false } }),
      null
    )
    expect(overtake.has('overtake-window')).toBe(true)

    const cliff = detectActiveMoments(
      snap({ sessionType: 'Race', currentLap: 5 }),
      preds({ tire: { degSecPerLap: 0.4, pressureState: 'ok', tempState: 'optimal' } }),
      null
    )
    expect(cliff.has('tyre-cliff')).toBe(true)
  })

  it('detects in-pit when on pit road', () => {
    const active = detectActiveMoments(snap({ sessionType: 'Race', currentLap: 5, onPitRoad: true }), preds(), null)
    expect(active.has('in-pit')).toBe(true)
  })

  it('every active id is a known catalog id', () => {
    const active = detectActiveMoments(
      snap({ sessionType: 'Race', currentLap: 1, lapsRemaining: 2, lapDistPct: 0.0, flags: baseFlags({ green: true, blue: true }), drs: true }),
      preds({ tire: { degSecPerLap: 0.5, pressureState: 'low', tempState: 'optimal' } }),
      resolveRaceMoment(snap({ sessionType: 'Race', currentLap: 1 }), preds(), null)
    )
    for (const id of active) expect(MOMENT_CATALOG_IDS.has(id)).toBe(true)
  })
})

function baseFlags(overrides: Partial<NonNullable<TelemetrySnapshot['flags']>> = {}): NonNullable<TelemetrySnapshot['flags']> {
  return {
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
    greenWhiteCheckered: false,
    ...overrides
  }
}
