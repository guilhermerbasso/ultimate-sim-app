// @vitest-environment jsdom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOverlayStyle, type OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { OVERLAY_DASHBOARD_PRESETS } from '../../../../shared/dashboards'
import { WIDGET_COMPONENTS } from './index'
import { RaceconRc06DashWidget } from './RaceconRc06DashWidget'
import { Rc01LiveTelemetryBuffer, createRc01ChannelReceipts } from './raceconRc01Core'
import {
  RC06_APP_ZONES,
  RC06_BALANCE_TOLERANCE_LAPS,
  RC06_BEHIND_PLAN_CLEAR_LAPS,
  RC06_CHANNEL_STALE_MS,
  RC06_EMPTY_PLAN,
  RC06_FUEL_MODEL_ENGAGE_MS,
  RC06_LIFT_FULL_DEFLECTION_L,
  RC06_LIFT_MODE_EVENT,
  RC06_LIFT_PLAN_FRACTION,
  RC06_NATIVE_ZONES,
  RC06_OVER_SAVE_LAPS,
  RC06_PLAN_EVENT,
  RC06_REFUEL_RISE_L,
  RC06_SPEED_DASH_MS,
  RC06_TREND_LAP_LIMIT,
  type Rc06AlertInput,
  type Rc06LapSample,
  Rc06LapLedger,
  type Rc06Plan,
  type Rc06Rect,
  type Rc06ZoneMap,
  advanceRc06Alerts,
  clearInvalidRc06Alerts,
  createRc06AlertState,
  createRc06AuxReceipts,
  createRc06DashboardModel,
  rc06AlertInputForModel,
  rc06AlertLines,
  rc06AuxChannelValue,
  rc06Balance,
  rc06BalanceDescription,
  rc06CompactModeForContentBox,
  rc06DisplayGear,
  rc06LayoutForContentBox,
  rc06LiftMarkerFraction,
  rc06LiftModeFromEvent,
  rc06PhoneGeometryForContentBox,
  rc06PlanFromEvent,
  rc06PlanLaps,
  rc06PlanLoaded,
  rc06ProjectedDryLap,
  rc06RectContains,
  rc06RefuelSignal,
  rc06TrackPercent,
  rc06ZoneStyle,
  rc06ZonesForLayout
} from './raceconRc06Core'

const config: OverlayWidgetConfig = {
  id: 'raceconRc06Dash',
  enabled: true,
  locked: true,
  favorite: false,
  position: { x: 0, y: 0, width: 1024, height: 600 },
  opacity: 100,
  stylePreset: 'minimal',
  style: createDefaultOverlayStyle(),
  display: null
}

/**
 * The approved RC-06 reference state (attempt-001 governed 800x480,
 * `input/telemetry-frame-fuelsave-lap27-of-plan41.json`): a green-flag endurance fuel-save
 * phase on lap 27 of a plan that pits on lap 41, deep enough into the stint that six measured
 * consumption laps exist. Its arithmetic is closed:
 *
 *   fuel laps remaining = 38.4 L / 2.65 L/lap = 14.49 -> 14.5
 *   balance             = 14.49 - (41 - 27) = +0.49 -> +0.5
 *   lift saving         = 2.75 - 2.65 = +0.10 L/lap
 *   lift marker         = 0.5 + 0.10 / (2 * 0.20) = 0.75
 *
 * All three packet section 15 alerts are ARMED in this frame and all three are SILENT, which
 * is a strictly stronger demonstration of trigger-only alerting than an out-of-scope instant.
 */
const REFERENCE_PLAN: Rc06Plan = { targetBurnLPerLap: 2.75, pitLap: 41 }

function snapshot(overrides: Partial<TelemetrySnapshot> = {}, timestamp = 4_270_000): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp,
    sessionUniqueId: 76,
    speedKmh: 214,
    rpm: 7_100,
    maxRpm: 8_600,
    gear: 4,
    throttle: 0.64,
    brake: 0,
    clutch: 0,
    sessionType: 'Race',
    sessionState: 'racing',
    currentLap: 27,
    deltaToBestSec: 0.42,
    bestLapTimeSec: 112.418,
    position: 4,
    waterTempC: 88,
    fuelLiters: 38.4,
    fuelPerLapLiters: 2.65,
    fuelLapsRemaining: 14.49,
    ...overrides
  } as TelemetrySnapshot
}

function markup(
  value: TelemetrySnapshot | null,
  cfg = config,
  plan: Rc06Plan | undefined = REFERENCE_PLAN
): string {
  return renderToStaticMarkup(createElement(RaceconRc06DashWidget, { snapshot: value, config: cfg, plan }))
}

function assertClean(value: string): void {
  expect(value).not.toContain('\uFFFD')
  expect(value).not.toContain('NaN')
  expect(value).not.toContain('undefined')
  expect(value).not.toContain('[object Object]')
}

function modelFor(
  value: TelemetrySnapshot | null,
  nowMs = 0,
  options: Parameters<typeof createRc06DashboardModel>[4] = { plan: REFERENCE_PLAN },
  receiptsAtMs = nowMs
): ReturnType<typeof createRc06DashboardModel> {
  const receipts = value ? createRc01ChannelReceipts(value, receiptsAtMs) : new Map()
  const aux = value ? createRc06AuxReceipts(value, receiptsAtMs) : new Map()
  return createRc06DashboardModel(value, receipts, aux, nowMs, options)
}

function alertInput(overrides: Partial<Rc06AlertInput> = {}): Rc06AlertInput {
  return {
    nowMs: 0,
    lapSample: null,
    balanceAvailable: true,
    burnRateMeasured: true,
    fuelModelValid: true,
    ...overrides
  }
}

function lap(lapNumber: number, balance: number | null, burn: number | null = 2.65): Rc06LapSample {
  return { lap: lapNumber, burn, balance }
}

function right(rect: Rc06Rect): number {
  return rect.left + rect.width
}

function bottom(rect: Rc06Rect): number {
  return rect.top + rect.height
}

function overlaps(a: Rc06Rect, b: Rc06Rect): boolean {
  return a.left < right(b) && right(a) > b.left && a.top < bottom(b) && bottom(a) > b.top
}

describe('RC-06 registration and preset wiring', () => {
  it('registers the widget component under its canonical id', () => {
    expect(WIDGET_COMPONENTS.raceconRc06Dash).toBe(RaceconRc06DashWidget)
  })

  it('declares exactly one RC-06 full-frame preset directly after RC-05', () => {
    const ids = OVERLAY_DASHBOARD_PRESETS.map((preset) => preset.id)
    expect(ids.filter((id) => id === 'racecon_rc06_dash')).toHaveLength(1)
    expect(ids.indexOf('racecon_rc06_dash')).toBe(ids.indexOf('racecon_rc05_dash') + 1)
    const preset = OVERLAY_DASHBOARD_PRESETS.find((entry) => entry.id === 'racecon_rc06_dash')
    expect(preset?.widgetId).toBe('raceconRc06Dash')
    expect(preset?.name).toBe('RaceCon RC-06 Save Mode')
    expect(preset?.scaleMode).toBe('stretch')
    expect(preset?.tags).toContain('racecon')
    expect(preset?.tags).toContain('fuel')
  })
})

describe('RC-06 ledger arithmetic is computed, never traced', () => {
  it('derives plan laps from the engineer pit lap and the live lap counter only', () => {
    expect(rc06PlanLaps(41, 27)).toBe(14)
    // A pit lap already behind the car floors at zero rather than counting backwards.
    expect(rc06PlanLaps(41, 44)).toBe(0)
    // Either input missing dashes the row; a stint length is never assumed.
    expect(rc06PlanLaps(null, 27)).toBeNull()
    expect(rc06PlanLaps(41, null)).toBeNull()
  })

  it('computes the signed balance as measured laps minus plan laps', () => {
    expect(rc06Balance(14.49, 14)).toBeCloseTo(0.49, 6)
    expect(rc06Balance(12.4, 14)).toBeCloseTo(-1.6, 6)
    expect(rc06Balance(null, 14)).toBeNull()
    expect(rc06Balance(14.49, null)).toBeNull()
  })

  it('places the lift plan datum at exactly half the track, not at the reference unit 40', () => {
    // image-qa-v1 residual 1 is a normative override: the reference rendered the datum at
    // unit 40, which inflates the proportional reading. The product must not trace it.
    expect(RC06_LIFT_PLAN_FRACTION).toBe(0.5)
    expect(RC06_LIFT_PLAN_FRACTION).not.toBeCloseTo(0.4, 3)
    expect(rc06LiftMarkerFraction(2.75, 2.75)).toBe(0.5)
  })

  it('computes the lift marker as 0.5 + (target - actual) / (2 * fullDeflection)', () => {
    expect(RC06_LIFT_FULL_DEFLECTION_L).toBe(0.2)
    // The approved reference frame: +0.10 L/lap of saving lands on unit 75.
    expect(rc06LiftMarkerFraction(2.75, 2.65)).toBeCloseTo(0.75, 6)
    expect(rc06LiftMarkerFraction(2.75, 2.85)).toBeCloseTo(0.25, 6)
    for (const [target, actual] of [
      [3.1, 3.05],
      [2.4, 2.52],
      [2.0, 2.0]
    ]) {
      expect(rc06LiftMarkerFraction(target, actual)).toBeCloseTo(
        0.5 + (target - actual) / (2 * RC06_LIFT_FULL_DEFLECTION_L),
        6
      )
    }
    // Beyond full deflection the marker clamps onto the track instead of drawing off it.
    expect(rc06LiftMarkerFraction(2.75, 3.6)).toBe(0)
    expect(rc06LiftMarkerFraction(2.75, 1.6)).toBe(1)
    expect(rc06LiftMarkerFraction(null, 2.65)).toBeNull()
    expect(rc06LiftMarkerFraction(2.75, null)).toBeNull()
  })

  it('projects the dry lap only from a live lap counter and a measured projection', () => {
    expect(rc06ProjectedDryLap(27, 14.49)).toBe(41)
    expect(rc06ProjectedDryLap(27, null)).toBeNull()
    expect(rc06ProjectedDryLap(null, 14.49)).toBeNull()
  })
})

describe('RC-06 packet zone geometry', () => {
  const maps: Array<[string, Rc06ZoneMap]> = [
    ['native', rc06ZonesForLayout('native')],
    ['app', rc06ZonesForLayout('app')],
    ['phone', rc06ZonesForLayout('compact', 'phone')],
    ['landscape', rc06ZonesForLayout('compact', 'landscape')],
    ['standard', rc06ZonesForLayout('compact', 'standard')]
  ]

  it('uses the packet 11.1 coordinates for the native canvas, not the rendered pixels', () => {
    // image-qa-v1 residual 2: the reference drifts down up to 7.7 pp. The packet wins.
    expect(RC06_NATIVE_ZONES.target).toEqual({ left: 2.0, top: 8.3, width: 30.0, height: 62.5 })
    expect(RC06_NATIVE_ZONES.balance).toEqual({ left: 33.5, top: 12.5, width: 33.0, height: 37.5 })
    expect(RC06_NATIVE_ZONES.delta).toEqual({ left: 33.5, top: 52.1, width: 33.0, height: 18.8 })
    expect(RC06_NATIVE_ZONES.actual).toEqual({ left: 68.0, top: 8.3, width: 30.0, height: 62.5 })
    expect(RC06_NATIVE_ZONES.lift).toEqual({ left: 2.0, top: 73.3, width: 96.0, height: 12.5 })
    // The reference put the lift bar at 81.0 %; that measurement is explicitly not used.
    expect(RC06_NATIVE_ZONES.lift.top).not.toBeCloseTo(81, 1)
  })

  it('uses the packet 12.1 coordinates for the app canvas and reveals the trend chart', () => {
    expect(RC06_APP_ZONES.target).toEqual({ left: 2.3, top: 6.7, width: 29.3, height: 66.7 })
    expect(RC06_APP_ZONES.balance).toEqual({ left: 34.0, top: 10.0, width: 32.0, height: 43.3 })
    expect(RC06_APP_ZONES.actual).toEqual({ left: 68.4, top: 6.7, width: 29.3, height: 66.7 })
    expect(RC06_APP_ZONES.trend).toEqual({ left: 34.0, top: 56.7, width: 32.0, height: 30.0 })
    expect(RC06_APP_ZONES.lift).toEqual({ left: 2.3, top: 90.0, width: 95.3, height: 8.0 })
  })

  it('folds the delta mini inside the enlarged balance hero at the app breakpoint', () => {
    // Packet 12.1 gives the delta mini no app zone of its own, so it must be nested inside
    // the balance rather than given an invented coordinate of its own.
    expect(rc06RectContains(RC06_APP_ZONES.balance, RC06_APP_ZONES.delta)).toBe(true)
    // At 800x480 the packet does give it a zone, and there it is a separate module.
    expect(rc06RectContains(RC06_NATIVE_ZONES.balance, RC06_NATIVE_ZONES.delta)).toBe(false)
  })

  it('reveals the app-only trend zone at exactly one breakpoint', () => {
    expect(rc06ZonesForLayout('app').trend).toBeDefined()
    expect(rc06ZonesForLayout('native').trend).toBeUndefined()
    expect(rc06ZonesForLayout('compact', 'phone').trend).toBeUndefined()
    expect(rc06ZonesForLayout('compact', 'landscape').trend).toBeUndefined()
    expect(rc06ZonesForLayout('compact', 'standard').trend).toBeUndefined()
  })

  it('contains every zone inside the canvas at every breakpoint', () => {
    for (const [name, zones] of maps) {
      for (const [id, rect] of Object.entries(zones) as Array<[string, Rc06Rect]>) {
        expect(rect.left, `${name}/${id} left`).toBeGreaterThanOrEqual(0)
        expect(rect.top, `${name}/${id} top`).toBeGreaterThanOrEqual(0)
        expect(rect.width, `${name}/${id} width`).toBeGreaterThan(0)
        expect(rect.height, `${name}/${id} height`).toBeGreaterThan(0)
        expect(right(rect), `${name}/${id} right`).toBeLessThanOrEqual(100)
        expect(bottom(rect), `${name}/${id} bottom`).toBeLessThanOrEqual(100)
      }
    }
  })

  it('keeps every zone disjoint except the deliberately folded delta mini', () => {
    for (const [name, zones] of maps) {
      const entries = Object.entries(zones) as Array<[string, Rc06Rect]>
      for (let i = 0; i < entries.length; i += 1) {
        for (let j = i + 1; j < entries.length; j += 1) {
          const pair = [entries[i][0], entries[j][0]].sort().join('+')
          if (name === 'app' && pair === 'balance+delta') continue
          expect(overlaps(entries[i][1], entries[j][1]), `${name}: ${pair} overlap`).toBe(false)
        }
      }
    }
  })

  it('emits the zone rect as inline percentages', () => {
    expect(rc06ZoneStyle(RC06_NATIVE_ZONES.lift)).toEqual({
      left: '2%',
      top: '73.3%',
      width: '96%',
      height: '12.5%'
    })
    expect(rc06ZoneStyle(undefined)).toBeNull()
  })

  it('emits a track fraction as a clean percentage with no float noise', () => {
    expect(rc06TrackPercent(0.5)).toBe('50%')
    expect(rc06TrackPercent(rc06LiftMarkerFraction(2.75, 2.65) as number)).toBe('75%')
    expect(rc06TrackPercent(1.4)).toBe('100%')
    expect(rc06TrackPercent(-2)).toBe('0%')
  })
})

describe('RC-06 strategy plan inputs are not telemetry', () => {
  it('dashes every plan row until a plan is actually loaded', () => {
    const model = modelFor(snapshot(), 0, { plan: RC06_EMPTY_PLAN })
    expect(model.planLoaded).toBe(false)
    expect(model.targetBurn.value).toBe('--')
    expect(model.targetBurn.unavailable).toBe(true)
    expect(model.pitLap.value).toBe('--')
    expect(model.planLaps.value).toBe('--')
    // Without a target the whole balance disappears: it has no plan side to net against.
    expect(model.balance.field.value).toBe('--')
    expect(model.balance.laps).toBeNull()
    // And the lift cue has no target burn to coach against.
    expect(model.lift.value.value).toBe('--')
    expect(model.lift.markerFraction).toBeNull()
  })

  it('never infers a target burn from the measured burn rate', () => {
    const model = modelFor(snapshot({ fuelPerLapLiters: 2.65 }), 0, { plan: RC06_EMPTY_PLAN })
    expect(model.actualBurn.value).toBe('2.65')
    expect(model.targetBurn.value).toBe('--')
    expect(model.targetBurn.raw).toBeNull()
  })

  it('dashes the plan lap count when the plan exists but the lap counter does not', () => {
    const model = modelFor(snapshot({ currentLap: undefined }), 0, { plan: REFERENCE_PLAN })
    expect(model.pitLap.value).toBe('41')
    expect(model.planLaps.value).toBe('--')
    expect(model.balance.laps).toBeNull()
  })

  it('accepts only a structurally valid plan payload and never mutates on nonsense', () => {
    expect(rc06PlanFromEvent({ targetBurnLPerLap: 2.75, pitLap: 41 })).toEqual({
      targetBurnLPerLap: 2.75,
      pitLap: 41
    })
    expect(rc06PlanFromEvent({ targetBurnLPerLap: null, pitLap: null })).toEqual(RC06_EMPTY_PLAN)
    expect(rc06PlanFromEvent({ targetBurnLPerLap: 0, pitLap: 41 })).toBeNull()
    expect(rc06PlanFromEvent({ targetBurnLPerLap: 2.75, pitLap: 41.5 })).toBeNull()
    expect(rc06PlanFromEvent({ nothing: true })).toBeNull()
    expect(rc06PlanFromEvent('2.75')).toBeNull()
    expect(rc06PlanFromEvent(undefined)).toBeNull()
    expect(rc06PlanLoaded(RC06_EMPTY_PLAN)).toBe(false)
    expect(rc06PlanLoaded({ targetBurnLPerLap: null, pitLap: 41 })).toBe(true)
  })
})

describe('RC-06 telemetry truth table', () => {
  it('renders the approved reference frame exactly as measured', () => {
    const model = modelFor(snapshot())
    expect(model.targetBurn.value).toBe('2.75')
    expect(model.planLaps.value).toBe('14')
    expect(model.pitLap.value).toBe('41')
    expect(model.actualBurn.value).toBe('2.65')
    expect(model.lapsRemaining.value).toBe('14.5')
    expect(model.fuelLevel.value).toBe('38.4')
    expect(model.balance.field.value).toBe('+0.5')
    expect(model.balance.sign).toBe('surplus')
    expect(model.balance.arrow).toBe('up')
    expect(model.balance.tone).toBe('normal')
    expect(model.delta.value).toBe('+0.42')
    expect(model.bestLap.value).toBe('01:52.418')
    expect(model.gear.value).toBe('4')
    expect(model.lift.value.value).toBe('+0.10')
    expect(model.lift.markerFraction).toBeCloseTo(0.75, 6)
    expect(model.lift.point.value).toBe('--')
    expect(model.burnRateMeasured).toBe(true)
    expect(model.fuelModelValid).toBe(true)
  })

  it('renders every packet dash state when no channel is available at all', () => {
    const model = modelFor(null)
    expect(model.actualBurn.value).toBe('--')
    expect(model.lapsRemaining.value).toBe('--')
    expect(model.fuelLevel.value).toBe('--')
    expect(model.delta.value).toBe('--.---')
    expect(model.bestLap.value).toBe('--:--.---')
    expect(model.gear.value).toBe('-')
    expect(model.speed.value).toBe('---')
    expect(model.waterTemp.value).toBe('--')
    expect(model.position.value).toBe('--')
    expect(model.balance.field.value).toBe('--')
    expect(model.balance.sign).toBe('unknown')
    expect(model.balance.arrow).toBe('none')
    expect(model.lift.point.value).toBe('--')
    expect(model.fuelModelValid).toBe(false)
    for (const value of [model.actualBurn, model.lapsRemaining, model.fuelLevel, model.delta, model.bestLap]) {
      expect(value.unavailable).toBe(true)
      expect(value.raw).toBeNull()
    }
  })

  it('refuses a fuel-per-lap figure until a full lap has actually been measured', () => {
    const fresh = modelFor(snapshot({ fuelPerLapLiters: undefined, fuelLapsRemaining: undefined }))
    expect(fresh.actualBurn.value).toBe('--')
    expect(fresh.burnRateMeasured).toBe(false)
    // And with no burn rate there is no projection and therefore no balance at all.
    expect(fresh.lapsRemaining.value).toBe('--')
    expect(fresh.balance.field.value).toBe('--')
  })

  it('never projects laps remaining before a measured burn rate exists', () => {
    // A provider that publishes a laps-remaining number with no measured burn is refused.
    const model = modelFor(snapshot({ fuelPerLapLiters: undefined, fuelLapsRemaining: 14.49 }))
    expect(model.lapsRemaining.value).toBe('--')
    expect(model.lapsRemaining.raw).toBeNull()
  })

  it('never states litres without a calibrated tank, and dashes the model with it', () => {
    const model = modelFor(snapshot({ fuelLiters: undefined }))
    expect(model.fuelLevel.value).toBe('--')
    expect(model.lapsRemaining.value).toBe('--')
    expect(model.fuelModelValid).toBe(false)
    // The burn rate itself is still a real measurement and is not collateral damage.
    expect(model.actualBurn.value).toBe('2.65')
  })

  it('derives laps remaining from the tank and the burn when the provider omits it', () => {
    const model = modelFor(snapshot({ fuelLapsRemaining: undefined }))
    // 38.4 / 2.65 = 14.49
    expect(model.lapsRemaining.value).toBe('14.5')
    expect(model.lapsRemaining.raw).toBeCloseTo(38.4 / 2.65, 6)
  })

  it('never accepts an ambiguous or mass-based burn channel as litres per lap', () => {
    const model = modelFor(
      snapshot({ fuelPerLapLiters: undefined, fuelPerLap: 2.65, fuelPerLapKg: 1.9 } as Partial<TelemetrySnapshot>)
    )
    expect(model.actualBurn.value).toBe('--')
    expect(model.burnRateMeasured).toBe(false)
  })

  it('refuses a delta without a stored best lap and never extrapolates one', () => {
    const model = modelFor(snapshot({ bestLapTimeSec: undefined, deltaToBestSec: undefined }))
    expect(model.delta.value).toBe('--.---')
    expect(model.bestLap.value).toBe('--:--.---')
  })

  it('signs the delta and keeps the unit outside the numeral', () => {
    expect(modelFor(snapshot({ deltaToBestSec: -0.318 })).delta.value).toBe('-0.32')
    expect(modelFor(snapshot({ deltaToBestSec: 0 })).delta.value).toBe('+0.00')
    expect(modelFor(snapshot()).delta.value).not.toContain('S')
  })

  it('never derives the gear from RPM or speed and greys a missing channel', () => {
    expect(rc06DisplayGear(0)).toBe('N')
    expect(rc06DisplayGear(-1)).toBe('R')
    expect(rc06DisplayGear(4)).toBe('4')
    expect(rc06DisplayGear(null)).toBe('-')
    const model = modelFor(snapshot({ gear: undefined, rpm: 7_100, speedKmh: 214 }))
    expect(model.gear.value).toBe('-')
    expect(model.gear.unavailable).toBe(true)
  })

  it('greys speed past its cadence and dashes it only past the 500 ms budget', () => {
    const frame = snapshot()
    const stale = modelFor(frame, RC06_CHANNEL_STALE_MS.speed + 50, { plan: REFERENCE_PLAN }, 0)
    expect(stale.speed.value).toBe('214')
    expect(stale.speed.stale).toBe(true)
    const dashed = modelFor(frame, RC06_SPEED_DASH_MS + 50, { plan: REFERENCE_PLAN }, 0)
    expect(dashed.speed.value).toBe('---')
    expect(dashed.speed.unavailable).toBe(true)
  })

  it('never estimates coolant temperature and dashes an invalid sensor', () => {
    expect(modelFor(snapshot({ waterTempC: undefined })).waterTemp.value).toBe('--')
    expect(modelFor(snapshot()).waterTemp.value).toBe('88')
  })

  it('dashes position when there is no timing feed and never infers it from gaps', () => {
    expect(modelFor(snapshot({ position: undefined })).position.value).toBe('--')
    expect(modelFor(snapshot()).position.value).toBe('4')
  })

  it('degrades every channel to its dash state once its own budget has expired', () => {
    const frame = snapshot()
    const expired = modelFor(frame, 10_000, { plan: REFERENCE_PLAN }, 0)
    expect(expired.actualBurn.value).toBe('--')
    expect(expired.lapsRemaining.value).toBe('--')
    expect(expired.fuelLevel.value).toBe('--')
    expect(expired.gear.value).toBe('-')
    expect(expired.waterTemp.value).toBe('--')
    expect(expired.position.value).toBe('--')
    expect(expired.balance.field.value).toBe('--')
    expect(expired.fuelModelValid).toBe(false)
  })

  it('reads every channel from its own declared source and nothing else', () => {
    const frame = snapshot()
    expect(rc06AuxChannelValue(frame, 'burnRate')).toBe(2.65)
    expect(rc06AuxChannelValue(frame, 'fuelLevel')).toBe(38.4)
    expect(rc06AuxChannelValue(frame, 'currentLap')).toBe(27)
    expect(rc06AuxChannelValue(frame, 'gear')).toBe(4)
    expect(rc06AuxChannelValue(frame, 'speed')).toBe(214)
    expect(rc06AuxChannelValue(frame, 'waterTemp')).toBe(88)
    expect(rc06AuxChannelValue(frame, 'position')).toBe(4)
    // A negative or fractional value on an integer channel is refused, not coerced.
    expect(rc06AuxChannelValue(snapshot({ currentLap: 27.4 }), 'currentLap')).toBeNull()
    expect(rc06AuxChannelValue(snapshot({ position: 0 }), 'position')).toBeNull()
    expect(rc06AuxChannelValue(snapshot({ fuelPerLapLiters: 0 }), 'burnRate')).toBeNull()
  })
})

describe('RC-06 balance display states', () => {
  it('marks a surplus green with an up arrow and a plus sign', () => {
    const model = modelFor(snapshot())
    expect(model.balance.field.value.startsWith('+')).toBe(true)
    expect(model.balance.arrow).toBe('up')
    expect(model.balance.tone).toBe('normal')
    expect(rc06BalanceDescription(model.balance)).toBe('Fuel balance +0.5 laps, ahead of plan')
  })

  it('turns a drifting deficit amber with a down arrow and a minus sign', () => {
    const model = modelFor(snapshot({ fuelLapsRemaining: 13.2 }))
    expect(model.balance.field.value).toBe('-0.8')
    expect(model.balance.arrow).toBe('down')
    expect(model.balance.sign).toBe('deficit')
    expect(model.balance.tone).toBe('caution')
    expect(rc06BalanceDescription(model.balance)).toContain('behind plan')
  })

  it('escalates the deficit to red only while the behind-plan alert is latched', () => {
    const alerts = createRc06AlertState()
    alerts.behindPlan = { active: true, clearLaps: 0 }
    const model = modelFor(snapshot({ fuelLapsRemaining: 13.2 }), 0, { plan: REFERENCE_PLAN, alerts })
    expect(model.balance.tone).toBe('danger')
    expect(model.alerts.behindPlan).toBe(true)
    expect(rc06AlertLines(model)).toContain('SAVE MORE')
  })

  it('reads a near-zero balance as on plan rather than as a deficit', () => {
    const model = modelFor(snapshot({ fuelLapsRemaining: 14.1 }))
    expect(model.balance.sign).toBe('flat')
    expect(Math.abs(model.balance.laps as number)).toBeLessThanOrEqual(RC06_BALANCE_TOLERANCE_LAPS)
  })
})

describe('RC-06 trigger-only alerts', () => {
  it('starts silent with nothing latched', () => {
    const state = createRc06AlertState()
    expect(state.behindPlan.active).toBe(false)
    expect(state.overSaving.active).toBe(false)
    expect(state.fuelModelInvalid.active).toBe(false)
    expect(rc06AlertLines(modelFor(snapshot()))).toEqual([])
  })

  it('latches behind-plan on the accounting cadence, one observed lap at a time', () => {
    let state = createRc06AlertState()
    // A mid-lap wobble with no settled lap sample can never latch anything.
    state = advanceRc06Alerts(state, alertInput({ lapSample: null }))
    expect(state.behindPlan.active).toBe(false)
    state = advanceRc06Alerts(state, alertInput({ lapSample: lap(28, -1.4) }))
    expect(state.behindPlan.active).toBe(true)
    // The same lap boundary can never latch twice.
    const repeated = advanceRc06Alerts(state, alertInput({ lapSample: lap(28, 0.6) }))
    expect(repeated.behindPlan.active).toBe(true)
  })

  it('does not fire behind-plan for a deficit inside tolerance', () => {
    const state = advanceRc06Alerts(
      createRc06AlertState(),
      alertInput({ lapSample: lap(28, -RC06_BALANCE_TOLERANCE_LAPS) })
    )
    expect(state.behindPlan.active).toBe(false)
  })

  it('holds behind-plan through the full two-lap hysteresis before clearing', () => {
    let state = advanceRc06Alerts(createRc06AlertState(), alertInput({ lapSample: lap(28, -1.4) }))
    expect(state.behindPlan.active).toBe(true)
    state = advanceRc06Alerts(state, alertInput({ lapSample: lap(29, 0.1) }))
    expect(state.behindPlan.active).toBe(true)
    expect(state.behindPlan.clearLaps).toBe(1)
    state = advanceRc06Alerts(state, alertInput({ lapSample: lap(30, 0.2) }))
    expect(state.behindPlan.active).toBe(false)
    expect(RC06_BEHIND_PLAN_CLEAR_LAPS).toBe(2)
  })

  it('restarts the behind-plan hysteresis when the projection falls short again', () => {
    let state = advanceRc06Alerts(createRc06AlertState(), alertInput({ lapSample: lap(28, -1.4) }))
    state = advanceRc06Alerts(state, alertInput({ lapSample: lap(29, 0.1) }))
    expect(state.behindPlan.clearLaps).toBe(1)
    state = advanceRc06Alerts(state, alertInput({ lapSample: lap(30, -0.9) }))
    expect(state.behindPlan.clearLaps).toBe(0)
    state = advanceRc06Alerts(state, alertInput({ lapSample: lap(31, 0.4) }))
    expect(state.behindPlan.active).toBe(true)
    state = advanceRc06Alerts(state, alertInput({ lapSample: lap(32, 0.4) }))
    expect(state.behindPlan.active).toBe(false)
  })

  it('latches over-saving only beyond a full lap of surplus and clears on return to plan', () => {
    let state = advanceRc06Alerts(createRc06AlertState(), alertInput({ lapSample: lap(28, RC06_OVER_SAVE_LAPS) }))
    expect(state.overSaving.active).toBe(false)
    state = advanceRc06Alerts(state, alertInput({ lapSample: lap(29, 1.4) }))
    expect(state.overSaving.active).toBe(true)
    state = advanceRc06Alerts(state, alertInput({ lapSample: lap(30, 0.6) }))
    expect(state.overSaving.active).toBe(false)
  })

  it('hides both plan alerts entirely without a measured burn rate', () => {
    let state = advanceRc06Alerts(createRc06AlertState(), alertInput({ lapSample: lap(28, -1.4) }))
    expect(state.behindPlan.active).toBe(true)
    state = advanceRc06Alerts(state, alertInput({ lapSample: lap(29, -1.4), burnRateMeasured: false }))
    expect(state.behindPlan.active).toBe(false)
    expect(state.overSaving.active).toBe(false)
  })

  it('unlatches both plan alerts the moment the balance itself becomes unavailable', () => {
    let state = advanceRc06Alerts(createRc06AlertState(), alertInput({ lapSample: lap(28, 1.6) }))
    expect(state.overSaving.active).toBe(true)
    state = advanceRc06Alerts(state, alertInput({ lapSample: lap(29, 1.6), balanceAvailable: false }))
    expect(state.overSaving.active).toBe(false)
    expect(state.behindPlan.active).toBe(false)
  })

  it('never latches a plan alert from a lap whose balance could not be computed', () => {
    const state = advanceRc06Alerts(createRc06AlertState(), alertInput({ lapSample: lap(28, null) }))
    expect(state.behindPlan.active).toBe(false)
    expect(state.overSaving.active).toBe(false)
  })

  it('engages the fuel-model note only after the two-second debounce', () => {
    let state = advanceRc06Alerts(createRc06AlertState(), alertInput({ nowMs: 0, fuelModelValid: false }))
    expect(state.fuelModelInvalid.active).toBe(false)
    state = advanceRc06Alerts(state, alertInput({ nowMs: RC06_FUEL_MODEL_ENGAGE_MS - 1, fuelModelValid: false }))
    expect(state.fuelModelInvalid.active).toBe(false)
    state = advanceRc06Alerts(state, alertInput({ nowMs: RC06_FUEL_MODEL_ENGAGE_MS, fuelModelValid: false }))
    expect(state.fuelModelInvalid.active).toBe(true)
    // A valid calibrated reading clears it immediately, with no hysteresis.
    state = advanceRc06Alerts(state, alertInput({ nowMs: RC06_FUEL_MODEL_ENGAGE_MS + 10, fuelModelValid: true }))
    expect(state.fuelModelInvalid.active).toBe(false)
    expect(state.fuelModelInvalid.pendingSinceMs).toBeNull()
  })

  it('restarts the fuel-model debounce after a valid reading interrupts it', () => {
    let state = advanceRc06Alerts(createRc06AlertState(), alertInput({ nowMs: 0, fuelModelValid: false }))
    state = advanceRc06Alerts(state, alertInput({ nowMs: 1_500, fuelModelValid: true }))
    state = advanceRc06Alerts(state, alertInput({ nowMs: 1_600, fuelModelValid: false }))
    state = advanceRc06Alerts(state, alertInput({ nowMs: 3_000, fuelModelValid: false }))
    expect(state.fuelModelInvalid.active).toBe(false)
    state = advanceRc06Alerts(state, alertInput({ nowMs: 1_600 + RC06_FUEL_MODEL_ENGAGE_MS, fuelModelValid: false }))
    expect(state.fuelModelInvalid.active).toBe(true)
  })

  it('drops every latched plan alert when the model says the input is no longer usable', () => {
    const latched = createRc06AlertState()
    latched.behindPlan = { active: true, clearLaps: 0 }
    latched.overSaving = { active: true }
    const cleared = clearInvalidRc06Alerts(latched, modelFor(null))
    expect(cleared.behindPlan.active).toBe(false)
    expect(cleared.overSaving.active).toBe(false)
  })

  it('builds its alert inputs only from fresh, available channels', () => {
    const live = rc06AlertInputForModel(modelFor(snapshot()), lap(28, 0.49), 500)
    expect(live.balanceAvailable).toBe(true)
    expect(live.burnRateMeasured).toBe(true)
    expect(live.fuelModelValid).toBe(true)
    const dark = rc06AlertInputForModel(modelFor(null), null, 500)
    expect(dark.balanceAvailable).toBe(false)
    expect(dark.burnRateMeasured).toBe(false)
    expect(dark.fuelModelValid).toBe(false)
    expect(dark.lapSample).toBeNull()
  })

  it('projects the latched alerts onto the model and the alert lines', () => {
    const alerts = createRc06AlertState()
    alerts.behindPlan = { active: true, clearLaps: 0 }
    alerts.fuelModelInvalid = { active: true, pendingSinceMs: 0 }
    const model = modelFor(snapshot(), 0, { plan: REFERENCE_PLAN, alerts })
    expect(model.alerts).toEqual({ behindPlan: true, overSaving: false, fuelModelInvalid: true })
    expect(rc06AlertLines(model)).toEqual(['SAVE MORE', 'FUEL MODEL INVALID'])
    expect(model.lift.coach).toBe('SAVE MORE')
  })
})

describe('RC-06 per-lap accounting ledger', () => {
  it('refuses to record anything before a lap boundary is actually observed', () => {
    const ledger = new Rc06LapLedger()
    ledger.observe({ lap: 27, fuelLevelL: 38.4, burn: 2.65, balance: 0.49, refuelSignal: false })
    // A mid-stint mount must not write a truncated fragment into the accounting history.
    expect(ledger.history()).toEqual([])
    expect(ledger.latest()).toBeNull()
  })

  it('records exactly one settled sample per observed lap boundary', () => {
    const ledger = new Rc06LapLedger()
    ledger.observe({ lap: 27, fuelLevelL: 38.4, burn: 2.65, balance: 0.49, refuelSignal: false })
    ledger.observe({ lap: 27, fuelLevelL: 37.2, burn: 2.66, balance: 0.4, refuelSignal: false })
    ledger.observe({ lap: 28, fuelLevelL: 35.8, burn: 2.66, balance: 0.4, refuelSignal: false })
    ledger.observe({ lap: 28, fuelLevelL: 34.9, burn: 2.66, balance: 0.4, refuelSignal: false })
    expect(ledger.history()).toEqual([{ lap: 28, burn: 2.66, balance: 0.4 }])
    expect(ledger.latest()?.lap).toBe(28)
  })

  it('writes a null for a lap whose burn rate was silent at the boundary', () => {
    const ledger = new Rc06LapLedger()
    ledger.observe({ lap: 27, fuelLevelL: 38.4, burn: 2.65, balance: 0.49, refuelSignal: false })
    ledger.observe({ lap: 28, fuelLevelL: 35.8, burn: null, balance: null, refuelSignal: false })
    expect(ledger.history()).toEqual([{ lap: 28, burn: null, balance: null }])
  })

  it('resets the plan accounting on an explicit refuel service', () => {
    const ledger = new Rc06LapLedger()
    ledger.observe({ lap: 27, fuelLevelL: 38.4, burn: 2.65, balance: 0.49, refuelSignal: false })
    ledger.observe({ lap: 28, fuelLevelL: 35.8, burn: 2.65, balance: 0.3, refuelSignal: false })
    expect(ledger.history()).toHaveLength(1)
    ledger.observe({ lap: 28, fuelLevelL: 35.8, burn: 2.65, balance: 0.3, refuelSignal: true })
    expect(ledger.history()).toEqual([])
    expect(ledger.refuels()).toBe(1)
  })

  it('resets the plan accounting on a measured tank rise', () => {
    const ledger = new Rc06LapLedger()
    ledger.observe({ lap: 27, fuelLevelL: 12.0, burn: 2.65, balance: -1.4, refuelSignal: false })
    ledger.observe({ lap: 28, fuelLevelL: 9.4, burn: 2.65, balance: -1.6, refuelSignal: false })
    expect(ledger.history()).toHaveLength(1)
    ledger.observe({
      lap: 28,
      fuelLevelL: 9.4 + RC06_REFUEL_RISE_L + 0.1,
      burn: 2.65,
      balance: -1.6,
      refuelSignal: false
    })
    expect(ledger.history()).toEqual([])
    expect(ledger.refuels()).toBe(1)
  })

  it('never mistakes ordinary consumption for a refuel', () => {
    const ledger = new Rc06LapLedger()
    ledger.observe({ lap: 27, fuelLevelL: 38.4, burn: 2.65, balance: 0.49, refuelSignal: false })
    ledger.observe({ lap: 28, fuelLevelL: 35.8, burn: 2.65, balance: 0.3, refuelSignal: false })
    ledger.observe({ lap: 29, fuelLevelL: 33.1, burn: 2.65, balance: 0.2, refuelSignal: false })
    expect(ledger.refuels()).toBe(0)
    expect(ledger.history()).toHaveLength(2)
  })

  it('drops the ledger rather than stitching two stints together', () => {
    const ledger = new Rc06LapLedger()
    ledger.observe({ lap: 27, fuelLevelL: 38.4, burn: 2.65, balance: 0.49, refuelSignal: false })
    ledger.observe({ lap: 28, fuelLevelL: 35.8, burn: 2.65, balance: 0.3, refuelSignal: false })
    ledger.observe({ lap: 2, fuelLevelL: 60, burn: 2.6, balance: 3, refuelSignal: false })
    expect(ledger.history()).toEqual([])
  })

  it('bounds the ring at the packet lap limit', () => {
    const ledger = new Rc06LapLedger()
    for (let n = 0; n <= RC06_TREND_LAP_LIMIT + 4; n += 1) {
      ledger.observe({ lap: n, fuelLevelL: 60 - n, burn: 2.65, balance: 0.4, refuelSignal: false })
    }
    expect(ledger.history()).toHaveLength(RC06_TREND_LAP_LIMIT)
  })

  it('ignores a lap channel that is missing or nonsensical', () => {
    const ledger = new Rc06LapLedger()
    ledger.observe({ lap: null, fuelLevelL: 38.4, burn: 2.65, balance: 0.49, refuelSignal: false })
    ledger.observe({ lap: -3, fuelLevelL: 38.4, burn: 2.65, balance: 0.49, refuelSignal: false })
    ledger.observe({ lap: 27.5, fuelLevelL: 38.4, burn: 2.65, balance: 0.49, refuelSignal: false })
    expect(ledger.history()).toEqual([])
  })

  it('clones without sharing state', () => {
    const ledger = new Rc06LapLedger()
    ledger.observe({ lap: 27, fuelLevelL: 38.4, burn: 2.65, balance: 0.49, refuelSignal: false })
    const clone = ledger.clone()
    clone.observe({ lap: 28, fuelLevelL: 35.8, burn: 2.65, balance: 0.3, refuelSignal: false })
    expect(ledger.history()).toEqual([])
    expect(clone.history()).toHaveLength(1)
  })

  it('treats only an explicit provider statement as a refuel signal', () => {
    expect(rc06RefuelSignal(snapshot({ refuelServiceActive: true } as Partial<TelemetrySnapshot>))).toBe(true)
    expect(
      rc06RefuelSignal(
        snapshot({ pitStopActive: true, pitServiceFlags: ['fuel', 'lf'] } as Partial<TelemetrySnapshot>)
      )
    ).toBe(true)
    // A pit service list without an active stop is a plan, not a refuel.
    expect(rc06RefuelSignal(snapshot({ pitServiceFlags: ['fuel'] } as Partial<TelemetrySnapshot>))).toBe(false)
    expect(rc06RefuelSignal(snapshot())).toBe(false)
    expect(rc06RefuelSignal(null)).toBe(false)
  })
})

describe('RC-06 responsive contract', () => {
  it('resolves the native, app and compact layouts from the content box', () => {
    expect(rc06LayoutForContentBox(800, 480)).toBe('native')
    expect(rc06LayoutForContentBox(801, 479)).toBe('native')
    expect(rc06LayoutForContentBox(1024, 600)).toBe('app')
    expect(rc06LayoutForContentBox(1600, 900)).toBe('app')
    expect(rc06LayoutForContentBox(640, 360)).toBe('compact')
    expect(rc06LayoutForContentBox(0, 0)).toBe('app')
  })

  it('classifies phone and landscape compact modes', () => {
    expect(rc06CompactModeForContentBox(393, 759)).toBe('phone')
    expect(rc06CompactModeForContentBox(412, 867)).toBe('phone')
    expect(rc06CompactModeForContentBox(759, 393)).toBe('landscape')
    expect(rc06CompactModeForContentBox(867, 412)).toBe('landscape')
    expect(rc06CompactModeForContentBox(700, 600)).toBe('standard')
    expect(rc06CompactModeForContentBox(1024, 600)).toBe('standard')
  })

  it('emits contained portrait geometry only at the phone breakpoint', () => {
    expect(rc06PhoneGeometryForContentBox(1024, 600)).toBeNull()
    expect(rc06PhoneGeometryForContentBox(759, 393)).toBeNull()
    for (const [width, height] of [
      [393, 759],
      [412, 867],
      [360, 780]
    ]) {
      const geometry = rc06PhoneGeometryForContentBox(width, height)!
      expect(geometry).not.toBeNull()
      // The stacked bands must all fit inside the measured box with room for the insets.
      const stacked =
        geometry.balanceHeight + geometry.columnHeight + geometry.deltaHeight + geometry.liftHeight
      expect(stacked).toBeLessThanOrEqual(height - geometry.inset)
      expect(geometry.trackHeight).toBeGreaterThan(0)
      expect(geometry.trackHeight).toBeLessThan(geometry.liftHeight)
      // The soft key stays a real touch target.
      expect(geometry.toggleSize).toBeGreaterThanOrEqual(44)
    }
  })

  it('accepts only the lift-mode payloads it recognises', () => {
    expect(rc06LiftModeFromEvent('distance')).toBe('distance')
    expect(rc06LiftModeFromEvent('liters')).toBe('liters')
    expect(rc06LiftModeFromEvent({ mode: 'distance' })).toBe('distance')
    expect(rc06LiftModeFromEvent('metres')).toBeNull()
    expect(rc06LiftModeFromEvent(undefined)).toBeNull()
  })
})

describe('RC-06 rendering', () => {
  it('renders the canonical DOM contract as a ledger', () => {
    const html = markup(snapshot())
    assertClean(html)
    expect(html).toContain('data-widget="raceconRc06Dash"')
    expect(html).toContain('data-testid="rc06-target"')
    expect(html).toContain('data-testid="rc06-actual"')
    expect(html).toContain('data-testid="rc06-balance"')
    expect(html).toContain('data-testid="rc06-delta"')
    expect(html).toContain('data-testid="rc06-lift"')
    expect(html).toContain('data-testid="rc06-peripheral"')
    // Exactly two ledger columns, each with one signature header and one header rule.
    expect(html.match(/data-testid="rc06-column-title"/g) ?? []).toHaveLength(2)
    expect(html.match(/data-testid="rc06-column-rule"/g) ?? []).toHaveLength(2)
    expect(html).toContain('>TARGET<')
    expect(html).toContain('>ACTUAL<')
    expect(html).toContain('data-rc06-source="plan"')
    expect(html).toContain('data-rc06-source="telemetry"')
  })

  it('renders the approved reference readouts', () => {
    const html = markup(snapshot())
    expect(html).toContain('>2.75<')
    expect(html).toContain('>14<')
    expect(html).toContain('>41<')
    expect(html).toContain('>2.65<')
    expect(html).toContain('>14.5<')
    expect(html).toContain('>38.4<')
    expect(html).toContain('>+0.5<')
    expect(html).toContain('>+0.42<')
    expect(html).toContain('>01:52.418<')
    expect(html).toContain('>4<')
    expect(html).toContain('>+0.10<')
  })

  it('draws no rev cue and no short-shift marker at all', () => {
    const html = markup(snapshot())
    // Packet 11.4 asks for a slim rev cue, but packet section 16 declares NO RPM channel, so
    // it has no source, no unit and no staleness rule and must not exist.
    // (`data-rc06-ledger` is the accounting cadence marker, not an LED strip.)
    expect(html).not.toMatch(/rc06-led(?!ger)/)
    expect(html).not.toContain('rc06-rev')
    expect(html).not.toContain('rc06-shift')
    expect(html).not.toContain('data-rc06-shift')
    expect(html).not.toContain('SHIFT')
    expect(html).not.toContain('RPM')
  })

  it('keeps LIFT PT permanently dashed because no lap-distance channel is declared', () => {
    // Packet section 16 defines no lap-distance channel, so the packet 11.5 distance-to-plan
    // mode is not derivable. The app's own lapDistanceM is deliberately NOT bound.
    for (const frame of [snapshot(), snapshot({ lapDistanceM: 1_842 } as Partial<TelemetrySnapshot>)]) {
      const model = modelFor(frame)
      expect(model.lift.point.value).toBe('--')
      expect(model.lift.point.unavailable).toBe(true)
      expect(model.lift.point.raw).toBeNull()
      const distance = modelFor(frame, 0, { plan: REFERENCE_PLAN, liftMode: 'distance' })
      expect(distance.lift.value.value).toBe('--')
      expect(distance.lift.modeLabel).toBe('DIST')
    }
    const html = markup(snapshot({ lapDistanceM: 1_842 } as Partial<TelemetrySnapshot>))
    expect(html).toContain('LIFT PT')
    expect(html).not.toContain('1842')
    expect(html).not.toContain('1,842')
  })

  it('places the lift plan datum at the centre and the marker arithmetically', () => {
    const html = markup(snapshot())
    expect(html).toContain('data-testid="rc06-lift-datum"')
    expect(html).toContain('left:50%')
    expect(html).toContain('data-testid="rc06-lift-marker"')
    expect(html).toContain('left:75%')
    expect(html).toContain('data-rc06-side="ahead"')
    // The reference's unit-40 datum is never emitted.
    expect(html).not.toContain('left:40%')
  })

  it('renders no lift marker at all when the saving cannot be computed', () => {
    const html = markup(snapshot({ fuelPerLapLiters: undefined }))
    expect(html).toContain('data-testid="rc06-lift-datum"')
    expect(html).not.toContain('data-testid="rc06-lift-marker"')
  })

  it('keeps every alert surface absent in the reference frame', () => {
    const html = markup(snapshot())
    expect(html).toContain('data-rc06-alerts="silent"')
    expect(html).toContain('data-rc06-alert-keys=""')
    expect(html).not.toContain('data-testid="rc06-save-more"')
    expect(html).not.toContain('data-testid="rc06-push-ok"')
    expect(html).not.toContain('data-testid="rc06-fuel-model-note"')
    expect(html).toContain('data-rc06-fuel-model="valid"')
    expect(html).toContain('data-rc06-balance-tone="normal"')
    expect(html).toContain('data-rc06-coach="none"')
  })

  it('renders the balance sign, arrow and colour together', () => {
    const html = markup(snapshot())
    expect(html).toContain('data-testid="rc06-balance-arrow"')
    expect(html).toContain('data-rc06-arrow="up"')
    expect(html).toContain('data-rc06-sign="surplus"')
    expect(html).toContain('aria-label="Fuel balance +0.5 laps, ahead of plan"')
    const deficit = markup(snapshot({ fuelLapsRemaining: 13.2 }))
    expect(deficit).toContain('data-rc06-arrow="down"')
    expect(deficit).toContain('data-rc06-sign="deficit"')
    expect(deficit).toContain('>-0.8<')
  })

  it('reveals the app-only fuel-trend chart at 1024x600 and nowhere else', () => {
    expect(markup(snapshot())).toContain('data-testid="rc06-trend"')
    const native = { ...config, position: { x: 0, y: 0, width: 800, height: 480 } }
    expect(markup(snapshot(), native)).not.toContain('data-testid="rc06-trend"')
    const phone = { ...config, position: { x: 0, y: 0, width: 393, height: 759 } }
    expect(markup(snapshot(), phone)).not.toContain('data-testid="rc06-trend"')
  })

  it('renders a clean, dash-only frame with no telemetry and no plan at all', () => {
    const html = markup(null, config, RC06_EMPTY_PLAN)
    assertClean(html)
    expect(html).not.toContain('data-rc06-buffer-state="accepted"')
    expect(html).toContain('data-rc06-plan="none"')
    expect(html).toContain('--.---')
    expect(html).toContain('--:--.---')
    expect(html).toContain('data-rc06-alerts="silent"')
    expect(html).toContain('data-rc06-sign="unknown"')
    expect(html).not.toContain('data-testid="rc06-balance-arrow"')
    expect(html).not.toContain('data-testid="rc06-lift-marker"')
    expect(html).toContain('aria-label="Fuel balance to plan unavailable"')
  })

  it('refuses mock and replay telemetry and raises no alert from it', () => {
    for (const value of [
      snapshot({ sim: 'mock' } as Partial<TelemetrySnapshot>),
      snapshot({ replayContext: { state: 'replay' } } as unknown as Partial<TelemetrySnapshot>)
    ]) {
      const html = markup(value)
      assertClean(html)
      expect(html).not.toContain('data-rc06-buffer-state="accepted"')
      expect(html).toContain('data-rc06-alerts="silent"')
      // The refused frame must not leak its telemetry into the ledger.
      expect(html).not.toContain('>2.65<')
      expect(html).not.toContain('>38.4<')
      expect(html).not.toContain('>+0.42<')
      expect(html).not.toContain('>+0.5<')
    }
  })

  it('marks the native 800x480 contract only at that exact size', () => {
    const native = { ...config, position: { x: 0, y: 0, width: 800, height: 480 } }
    expect(markup(snapshot(), native)).toContain('data-rc06-native-size="800x480"')
    expect(markup(snapshot())).not.toContain('data-rc06-native-size')
  })

  it('exposes the compact mode attribute only in the compact layout', () => {
    const phone = { ...config, position: { x: 0, y: 0, width: 393, height: 759 } }
    expect(markup(snapshot(), phone)).toContain('data-rc06-compact-mode="phone"')
    expect(markup(snapshot())).not.toContain('data-rc06-compact-mode')
  })
})

describe('RC-06 shares the RC-01 fail-closed ingest buffer', () => {
  it('accepts a live identified snapshot and rejects an unidentified one', () => {
    const buffer = new Rc01LiveTelemetryBuffer()
    expect(buffer.ingest(snapshot(), 1_000).accepted).toBe(true)
    const orphan = new Rc01LiveTelemetryBuffer()
    expect(
      orphan.ingest(snapshot({ sessionUniqueId: undefined, connectionEpoch: undefined }), 1_000).accepted
    ).toBe(false)
  })
})

/**
 * The alert surfaces and the settled ledger cannot be reached by a single static render: both
 * require evidence accumulated across laps, which is exactly the packet's accounting thesis.
 * These drive the real component over a real frame sequence so the alert and ledger markup can
 * never become dead code.
 */
describe('RC-06 live ledger surfaces', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  function mount(
    initial: Partial<TelemetrySnapshot> = {},
    plan: Rc06Plan | null = REFERENCE_PLAN
  ): {
    push: (atMs: number, overrides: Partial<TelemetrySnapshot>) => void
    root: () => HTMLElement
    view: ReturnType<typeof render>
  } {
    vi.useFakeTimers()
    let monotonicMs = 0
    const monotonicClock = (): number => monotonicMs
    const view = render(
      createElement(RaceconRc06DashWidget, {
        snapshot: snapshot(initial, 1_000),
        config,
        monotonicClock,
        plan: plan ?? undefined
      })
    )
    const frame = (overrides: Partial<TelemetrySnapshot>): void => {
      view.rerender(
        createElement(RaceconRc06DashWidget, {
          snapshot: snapshot(overrides, 1_000 + monotonicMs),
          config,
          monotonicClock,
          plan: plan ?? undefined
        })
      )
    }
    // Frames are pushed at a realistic 10 Hz so no channel ages out of its budget between
    // steps: a test that jumped straight to a deadline would correctly find the ledger
    // disarmed rather than latched.
    const push = (atMs: number, overrides: Partial<TelemetrySnapshot>): void => {
      if (atMs <= monotonicMs) {
        frame(overrides)
        return
      }
      while (monotonicMs < atMs) {
        const step = Math.min(100, atMs - monotonicMs)
        monotonicMs += step
        act(() => {
          vi.advanceTimersByTime(step)
        })
        frame(overrides)
      }
    }
    return { push, root: () => view.container.querySelector<HTMLElement>('.rc06-widget')!, view }
  }

  /** A frame whose measured burn overshoots the 2.75 L/lap target, eating the margin. */
  const shortLap = (lapNumber: number, lapsRemaining: number): Partial<TelemetrySnapshot> => ({
    currentLap: lapNumber,
    fuelPerLapLiters: 3.1,
    fuelLapsRemaining: lapsRemaining,
    fuelLiters: 3.1 * lapsRemaining
  })

  const savedLap = (lapNumber: number, lapsRemaining: number): Partial<TelemetrySnapshot> => ({
    currentLap: lapNumber,
    fuelPerLapLiters: 2.55,
    fuelLapsRemaining: lapsRemaining,
    fuelLiters: 2.55 * lapsRemaining
  })

  it('keeps every alert surface absent while nothing has triggered', () => {
    const { root, view } = mount()
    expect(root().dataset.rc06Alerts).toBe('silent')
    expect(view.container.querySelector('[data-testid="rc06-save-more"]')).toBeNull()
    expect(view.container.querySelector('[data-testid="rc06-push-ok"]')).toBeNull()
    expect(view.container.querySelector('[data-testid="rc06-fuel-model-note"]')).toBeNull()
    expect(root().dataset.rc06Ledger).toBe('pending')
  })

  it('settles the ledger only once a real lap boundary has been observed', () => {
    const { push, root, view } = mount()
    expect(root().dataset.rc06Ledger).toBe('pending')
    push(500, { currentLap: 28 })
    expect(root().dataset.rc06Ledger).toBe('measured')
    const points = view.container.querySelectorAll('[data-testid="rc06-trend-point"]')
    expect(points).toHaveLength(1)
    expect(points[0].textContent).toBe('2.65')
  })

  it('latches SAVE MORE on the accounting cadence and turns the balance red', () => {
    const { push, root, view } = mount()
    // Lap 28 is the first observed boundary and the projection is already short of plan.
    push(400, shortLap(28, 11.2))
    expect(root().dataset.rc06Alerts).toBe('active')
    expect(root().dataset.rc06AlertKeys).toBe('SAVE MORE')
    expect(root().dataset.rc06BalanceTone).toBe('danger')
    expect(view.container.querySelector('[data-testid="rc06-save-more"]')?.textContent).toBe('SAVE MORE')
    expect(view.container.querySelector<HTMLElement>('[data-testid="rc06-lift"]')!.dataset.rc06Coach).toBe(
      'SAVE MORE'
    )
    const balance = view.container.querySelector<HTMLElement>('[data-testid="rc06-balance"]')!
    expect(balance.dataset.rc06Arrow).toBe('down')
    expect(balance.dataset.rc06Sign).toBe('deficit')
  })

  it('holds SAVE MORE through the full two-lap hysteresis before clearing', () => {
    const { push, root } = mount()
    push(400, shortLap(28, 11.2))
    expect(root().dataset.rc06Alerts).toBe('active')
    // One recovered lap is not enough: a single lap must not swing the cue. Lap 29 leaves
    // 12 plan laps and lap 30 leaves 11, so both projections sit back inside tolerance.
    push(800, savedLap(29, 12.1))
    expect(root().dataset.rc06Alerts).toBe('active')
    push(1_200, savedLap(30, 11.2))
    expect(root().dataset.rc06Alerts).toBe('silent')
  })

  it('raises the cyan PUSH OK hint only beyond a full lap of surplus', () => {
    const { push, root, view } = mount()
    // Lap 28 leaves 13 plan laps: a 0.8-lap surplus is inside plan and stays silent.
    push(400, savedLap(28, 13.8))
    expect(root().dataset.rc06Alerts).toBe('silent')
    // Lap 29 leaves 12 plan laps: a 1.6-lap surplus is beyond the packet's one-lap trigger.
    push(800, savedLap(29, 13.6))
    expect(root().dataset.rc06AlertKeys).toBe('PUSH OK')
    expect(view.container.querySelector('[data-testid="rc06-push-ok"]')?.textContent).toBe('PUSH OK')
    // Lap 30 leaves 11 plan laps: the surplus is back to half a lap and the hint clears.
    push(1_200, savedLap(30, 11.5))
    expect(root().dataset.rc06Alerts).toBe('silent')
  })

  it('engages the amber fuel-model note after two seconds and dashes the ledger', () => {
    const { push, root, view } = mount()
    expect(root().dataset.rc06FuelModel).toBe('valid')
    push(500, { fuelPerLapLiters: undefined, fuelLapsRemaining: undefined, fuelLiters: undefined })
    expect(root().dataset.rc06FuelModel).toBe('invalid')
    expect(view.container.querySelector('[data-testid="rc06-fuel-model-note"]')).toBeNull()
    push(500 + RC06_FUEL_MODEL_ENGAGE_MS, {
      fuelPerLapLiters: undefined,
      fuelLapsRemaining: undefined,
      fuelLiters: undefined
    })
    expect(view.container.querySelector('[data-testid="rc06-fuel-model-note"]')?.textContent).toBe(
      'FUEL MODEL INVALID'
    )
    // No litres are fabricated while the model is invalid.
    expect(view.container.querySelector('[data-rc06-row="fuel-level"] output')?.textContent).toBe('--')
    expect(view.container.querySelector('[data-rc06-row="actual-burn"] output')?.textContent).toBe('--')
    // A valid calibrated reading clears it immediately.
    push(500 + RC06_FUEL_MODEL_ENGAGE_MS + 200, {})
    expect(view.container.querySelector('[data-testid="rc06-fuel-model-note"]')).toBeNull()
    expect(root().dataset.rc06FuelModel).toBe('valid')
  })

  it('unlatches SAVE MORE and dashes the hero when the fuel model drops out', () => {
    const { push, root } = mount()
    push(400, shortLap(28, 11.2))
    expect(root().dataset.rc06Alerts).toBe('active')
    push(600, { currentLap: 29, fuelPerLapLiters: undefined, fuelLapsRemaining: undefined })
    expect(root().dataset.rc06BalanceTone).toBe('muted')
    expect(root().dataset.rc06AlertKeys).not.toContain('SAVE MORE')
  })

  it('resets the plan accounting on a refuel', () => {
    const { push, root, view } = mount()
    push(400, { currentLap: 28 })
    push(800, { currentLap: 29 })
    expect(view.container.querySelectorAll('[data-testid="rc06-trend-point"]')).toHaveLength(2)
    push(1_000, {
      currentLap: 29,
      refuelServiceActive: true,
      fuelLiters: 82,
      fuelLapsRemaining: 30.9
    } as Partial<TelemetrySnapshot>)
    expect(root().dataset.rc06Ledger).toBe('pending')
    expect(view.container.querySelectorAll('[data-testid="rc06-trend-point"]')).toHaveLength(1)
    expect(view.container.querySelector('[data-testid="rc06-trend-point"]')?.textContent).toBe('--')
  })

  it('toggles the soft-key lift mode and answers the display-switch event', () => {
    const { root, view } = mount()
    expect(root().dataset.rc06LiftMode).toBe('liters')
    expect(view.container.querySelector('[data-testid="rc06-lift-value"]')?.textContent).toBe('+0.10')
    fireEvent.click(view.container.querySelector('[data-testid="rc06-soft-key"]')!)
    expect(root().dataset.rc06LiftMode).toBe('distance')
    // Distance-to-plan has no declared channel, so it dashes rather than inventing metres.
    expect(view.container.querySelector('[data-testid="rc06-lift-mode"]')?.textContent).toBe('DIST')
    expect(view.container.querySelector('[data-testid="rc06-lift-value"]')?.textContent).toBe('--')
    act(() => {
      window.dispatchEvent(new CustomEvent(RC06_LIFT_MODE_EVENT, { detail: 'liters' }))
    })
    expect(root().dataset.rc06LiftMode).toBe('liters')
    act(() => {
      window.dispatchEvent(new CustomEvent(RC06_LIFT_MODE_EVENT, { detail: 'nonsense' }))
    })
    expect(root().dataset.rc06LiftMode).toBe('liters')
  })

  it('loads, revises and clears the engineer plan from its own event', () => {
    const { root, view } = mount({}, null)
    expect(root().dataset.rc06Plan).toBe('none')
    expect(view.container.querySelector('[data-rc06-row="target-burn"] output')?.textContent).toBe('--')
    act(() => {
      window.dispatchEvent(new CustomEvent(RC06_PLAN_EVENT, { detail: REFERENCE_PLAN }))
    })
    expect(root().dataset.rc06Plan).toBe('loaded')
    expect(view.container.querySelector('[data-rc06-row="target-burn"] output')?.textContent).toBe('2.75')
    expect(view.container.querySelector('[data-rc06-row="plan-laps"] output')?.textContent).toBe('14')
    act(() => {
      window.dispatchEvent(new CustomEvent(RC06_PLAN_EVENT, { detail: 'nonsense' }))
    })
    expect(root().dataset.rc06Plan).toBe('loaded')
    act(() => {
      window.dispatchEvent(new CustomEvent(RC06_PLAN_EVENT, { detail: { targetBurnLPerLap: null, pitLap: null } }))
    })
    expect(root().dataset.rc06Plan).toBe('none')
  })

  it('clears the settled ledger and the latched alerts on a source discontinuity', () => {
    const { push, root } = mount()
    push(400, shortLap(28, 11.2))
    expect(root().dataset.rc06Ledger).toBe('measured')
    expect(root().dataset.rc06Alerts).toBe('active')
    push(600, { sessionUniqueId: 999 } as Partial<TelemetrySnapshot>)
    expect(root().dataset.rc06Ledger).toBe('pending')
    expect(root().dataset.rc06Alerts).toBe('silent')
  })
})
