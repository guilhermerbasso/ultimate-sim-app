import { describe, expect, it } from 'vitest'
import {
  ALL_FIELDS,
  PLAYABLE_SIMS,
  SIM_FIELD_COVERAGE,
  simLabel,
  simSupportPrefix,
  widgetSupportedSims
} from './sim-coverage'

describe('SIM_FIELD_COVERAGE — per-provider field sets', () => {
  it('iRacing covers standings (drivers) and deltaToBestSec', () => {
    const ir = SIM_FIELD_COVERAGE.iracing
    expect(ir.has('drivers')).toBe(true)
    expect(ir.has('relatives')).toBe(true)
    expect(ir.has('deltaToBestSec')).toBe(true)
    expect(ir.has('deltaToSessionBestSec')).toBe(true)
  })

  it('iRacing has NO live tyre pressure — its tyre pressure is COLD only', () => {
    const ir = SIM_FIELD_COVERAGE.iracing
    // iRacing fills `tyres` (carcass/surface temps + wear) and `tireColdPressuresKpa`,
    // but the only pressure it publishes is the GARAGE COLD pressure — there is no live
    // (hot) tyre-pressure telemetry. We model that distinction via `tireColdPressuresKpa`.
    expect(ir.has('tyres')).toBe(true)
    expect(ir.has('tireColdPressuresKpa')).toBe(true)
    // ACC, by contrast, publishes LIVE hot pressure inside `tyres` and has no cold-pressure field.
    expect(SIM_FIELD_COVERAGE.acc.has('tireColdPressuresKpa')).toBe(false)
  })

  it('ACC covers live tyres + weather but not standings/deltas', () => {
    const acc = SIM_FIELD_COVERAGE.acc
    expect(acc.has('tyres')).toBe(true)
    expect(acc.has('airTempC')).toBe(true)
    expect(acc.has('trackTempC')).toBe(true)
    expect(acc.has('drivers')).toBe(false)
    expect(acc.has('deltaToBestSec')).toBe(false)
  })

  it('AC and AMS2 are limited: no tyres mapped in their poll()', () => {
    expect(SIM_FIELD_COVERAGE.ac.has('tyres')).toBe(false)
    expect(SIM_FIELD_COVERAGE.ams2.has('tyres')).toBe(false)
    // AC maps totalCars (numCars); AMS2 does not.
    expect(SIM_FIELD_COVERAGE.ac.has('totalCars')).toBe(true)
    expect(SIM_FIELD_COVERAGE.ams2.has('totalCars')).toBe(false)
  })

  it('LMU covers its rF2 core: live tyres, water/oil, flags, weather', () => {
    const lmu = SIM_FIELD_COVERAGE.lmu
    for (const f of ['tyres', 'waterTempC', 'oilTempC', 'flags', 'sessionFlagsRaw', 'airTempC', 'trackTempC', 'trackWetnessPct'] as const) {
      expect(lmu.has(f)).toBe(true)
    }
    // LMU has no live standings array yet.
    expect(lmu.has('drivers')).toBe(false)
  })

  it('mock is FULL coverage, none is empty', () => {
    expect(SIM_FIELD_COVERAGE.mock.size).toBe(ALL_FIELDS.length)
    for (const f of ALL_FIELDS) expect(SIM_FIELD_COVERAGE.mock.has(f)).toBe(true)
    expect(SIM_FIELD_COVERAGE.none.size).toBe(0)
  })

  it('every sim set is a subset of ALL_FIELDS (no stray keys)', () => {
    const all = new Set(ALL_FIELDS)
    expect(new Set(ALL_FIELDS).size).toBe(ALL_FIELDS.length) // no dupes
    for (const set of Object.values(SIM_FIELD_COVERAGE)) {
      for (const f of set) expect(all.has(f)).toBe(true)
    }
  })

  it('iRacing is the broadest provider: superset of every other playable sim, and mock ⊇ iRacing', () => {
    const ir = SIM_FIELD_COVERAGE.iracing
    for (const sim of ['acc', 'ac', 'ams2', 'lmu'] as const) {
      for (const f of SIM_FIELD_COVERAGE[sim]) expect(ir.has(f)).toBe(true)
    }
    // mock adds the one field iRacing lacks (engineRunning — no reliable ignition var).
    expect(ir.has('engineRunning')).toBe(false)
    for (const f of ir) expect(SIM_FIELD_COVERAGE.mock.has(f)).toBe(true)
  })
})

describe('PLAYABLE_SIMS & simLabel', () => {
  it('lists the five real sims in display order', () => {
    expect(PLAYABLE_SIMS).toEqual(['iracing', 'acc', 'ac', 'ams2', 'lmu'])
  })

  it('renders short badge labels, with — for replay/none', () => {
    expect(simLabel('iracing')).toBe('IR')
    expect(simLabel('acc')).toBe('ACC')
    expect(simLabel('ac')).toBe('AC')
    expect(simLabel('ams2')).toBe('AMS2')
    expect(simLabel('lmu')).toBe('LMU')
    expect(simLabel('mock')).toBe('MOCK')
    expect(simLabel('replay')).toBe('—')
    expect(simLabel('none')).toBe('—')
  })
})

describe('widgetSupportedSims', () => {
  it('a widget with no requirements is supported by all playable sims', () => {
    expect(widgetSupportedSims([])).toEqual([...PLAYABLE_SIMS])
    expect(widgetSupportedSims(undefined)).toEqual([...PLAYABLE_SIMS])
  })

  it("requiring 'drivers' excludes every sim that lacks it (only iRacing)", () => {
    expect(widgetSupportedSims(['drivers'])).toEqual(['iracing'])
  })

  it("requiring 'tyres' returns the live-tyre sims only (IR/ACC/LMU)", () => {
    expect(widgetSupportedSims(['tyres'])).toEqual(['iracing', 'acc', 'lmu'])
  })

  it("requiring 'position' is satisfied by all playable sims", () => {
    expect(widgetSupportedSims(['position'])).toEqual([...PLAYABLE_SIMS])
  })

  it('requiring a field no playable sim publishes returns []', () => {
    // engineRunning is not populated by any live provider (only the FULL mock).
    expect(widgetSupportedSims(['engineRunning'])).toEqual([])
  })

  it('requires the INTERSECTION of all listed fields', () => {
    // tyres → IR/ACC/LMU; waterTempC → IR/LMU; together → IR/LMU.
    expect(widgetSupportedSims(['tyres', 'waterTempC'])).toEqual(['iracing', 'lmu'])
  })
})

describe('simSupportPrefix', () => {
  it('is empty when supported by ALL playable sims (universal widget → no badge)', () => {
    expect(simSupportPrefix(undefined)).toBe('')
    expect(simSupportPrefix([])).toBe('')
    expect(simSupportPrefix(['position'])).toBe('')
  })

  it('formats a subset as "(LBL/LBL/…) " in PLAYABLE_SIMS order', () => {
    expect(simSupportPrefix(['tyres'])).toBe('(IR/ACC/LMU) ')
    expect(simSupportPrefix(['drivers'])).toBe('(IR) ')
    expect(simSupportPrefix(['tyres', 'waterTempC'])).toBe('(IR/LMU) ')
  })

  it('flags "(—) " when no live sim provides the required field', () => {
    expect(simSupportPrefix(['engineRunning'])).toBe('(—) ')
  })
})
