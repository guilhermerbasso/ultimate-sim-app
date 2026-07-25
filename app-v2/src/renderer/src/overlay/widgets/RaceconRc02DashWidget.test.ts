// @vitest-environment jsdom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlayStyle, type OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { OVERLAY_DASHBOARD_PRESETS } from '../../../../shared/dashboards'
import { WIDGET_COMPONENTS } from './index'
import { RaceconRc02DashWidget } from './RaceconRc02DashWidget'
import { Rc01LiveTelemetryBuffer, createRc01ChannelReceipts } from './raceconRc01Core'
import {
  RC02_LAP_HISTORY_LIMIT,
  RC02_LED_COUNT,
  RC02_PB_PACE_DEBOUNCE_MS,
  RC02_SECTOR_FEED_STALE_MS,
  RC02_SECTOR_LOSS_HOLD_MS,
  RC02_SECTOR_LOSS_THRESHOLD_SEC,
  RC02_SPINE_FULL_SCALE_SEC,
  Rc02SectorTracker,
  advanceRc02PbPace,
  buildRc02LedStates,
  clearInvalidRc02PbPace,
  createRc02DashboardModel,
  createRc02PbPaceState,
  rc02CompactModeForContentBox,
  rc02FormatLapTime,
  rc02FormatSignedSeconds,
  rc02LayoutForContentBox,
  rc02PhoneGeometryForContentBox,
  rc02SectorDescription,
  rc02SpineGeometry
} from './raceconRc02Core'

const config: OverlayWidgetConfig = {
  id: 'raceconRc02Dash',
  enabled: true,
  locked: true,
  favorite: false,
  position: { x: 0, y: 0, width: 1024, height: 600 },
  opacity: 100,
  stylePreset: 'minimal',
  style: createDefaultOverlayStyle(),
  display: null
}

/** The RC-02 approved reference state: qualifying flying lap, ahead of the stored best. */
function snapshot(overrides: Partial<TelemetrySnapshot> = {}, timestamp = 74_372): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp,
    sessionUniqueId: 41,
    speedKmh: 214,
    rpm: 8_140,
    maxRpm: 8_600,
    gear: 5,
    throttle: 1,
    brake: 0,
    clutch: 0,
    sessionType: 'Qualifying',
    currentLapTimeSec: 74.372,
    bestLapTimeSec: 99.548,
    deltaToBestSec: -0.284,
    lapDistPct: 0.7473,
    pitLimiter: false,
    tyres: { lf: { tempC: 78 }, rf: { tempC: 81 }, lr: { tempC: 74 }, rr: { tempC: 76 } },
    ...overrides
  } as TelemetrySnapshot
}

function markup(value: TelemetrySnapshot | null, cfg = config): string {
  return renderToStaticMarkup(createElement(RaceconRc02DashWidget, { snapshot: value, config: cfg }))
}

function assertClean(value: string): void {
  expect(value).not.toContain('\uFFFD')
  expect(value).not.toContain('NaN')
  expect(value).not.toContain('undefined')
  expect(value).not.toContain('[object Object]')
}

function modelFor(value: TelemetrySnapshot | null, nowMs = 0, pbPace = false, overRev = false, receiptsAtMs = nowMs) {
  const receipts = value ? createRc01ChannelReceipts(value, receiptsAtMs) : new Map()
  return createRc02DashboardModel(value, receipts, nowMs, [], pbPace, overRev)
}

describe('RC-02 registration and preset wiring', () => {
  it('registers the widget component under its canonical id', () => {
    expect(WIDGET_COMPONENTS.raceconRc02Dash).toBe(RaceconRc02DashWidget)
  })

  it('declares exactly one RC-02 full-frame preset directly after RC-01', () => {
    const ids = OVERLAY_DASHBOARD_PRESETS.map((preset) => preset.id)
    expect(ids.filter((id) => id === 'racecon_rc02_dash')).toHaveLength(1)
    expect(ids.indexOf('racecon_rc02_dash')).toBe(ids.indexOf('racecon_rc01_dash') + 1)
    const preset = OVERLAY_DASHBOARD_PRESETS.find((entry) => entry.id === 'racecon_rc02_dash')
    expect(preset?.widgetId).toBe('raceconRc02Dash')
    expect(preset?.scaleMode).toBe('stretch')
    expect(preset?.tags).toContain('qualifying')
  })
})

describe('RC-02 shift row', () => {
  it('always emits exactly nine bars', () => {
    for (const ratio of [null, 0, 0.4, 0.7, 0.9, 0.95, 1.05]) {
      expect(buildRc02LedStates(ratio, true, false, 5)).toHaveLength(RC02_LED_COUNT)
    }
    expect(RC02_LED_COUNT).toBe(9)
  })

  it('keeps every bar dark when RPM is stale or missing', () => {
    expect(buildRc02LedStates(0.99, false, false, 5).every((led) => !led.active && led.tone === 'dark')).toBe(true)
    expect(buildRc02LedStates(null, true, false, 5).every((led) => !led.active && led.tone === 'dark')).toBe(true)
  })

  it('ramps blue then green then amber as RPM builds', () => {
    const leds = buildRc02LedStates(0.94, true, false, 5)
    expect(leds.slice(0, 3).map((led) => led.tone)).toEqual(['info', 'info', 'info'])
    expect(leds.slice(3, 6).map((led) => led.tone)).toEqual(['good', 'good', 'good'])
    expect(leds.slice(6, 8).map((led) => led.tone)).toEqual(['caution', 'caution'])
  })

  it('turns the cap red only while over-rev is latched', () => {
    expect(buildRc02LedStates(0.995, true, false, 5)[8].tone).toBe('danger')
    expect(buildRc02LedStates(0.995, true, true, 5)[8].tone).toBe('danger')
    expect(buildRc02LedStates(0.6, true, true, 5)[8].tone).toBe('dark')
  })

  it('tints the cap violet only on personal-best pace at the shift point', () => {
    expect(buildRc02LedStates(0.95, true, false, 5, true)[8].tone).toBe('signature')
    // Below the gear-aware shift point the PB accent must not appear on the row.
    expect(buildRc02LedStates(0.8, true, false, 5, true).some((led) => led.tone === 'signature')).toBe(false)
    // Over-rev outranks the personal-best accent.
    expect(buildRc02LedStates(0.995, true, true, 5, true)[8].tone).toBe('danger')
  })
})

describe('RC-02 bidirectional spine geometry', () => {
  const delta = (raw: number | null, stale = false, unavailable = false) => ({
    value: raw === null ? '--' : raw.toFixed(3),
    raw,
    stale,
    unavailable,
    tone: 'primary' as const
  })

  it('fills upward when ahead and downward when behind', () => {
    expect(rc02SpineGeometry(delta(-0.5)).direction).toBe('up')
    expect(rc02SpineGeometry(delta(0.5)).direction).toBe('down')
    expect(rc02SpineGeometry(delta(0)).direction).toBe('flat')
  })

  it('is symmetric: equal time gained and lost produce equal fill', () => {
    expect(rc02SpineGeometry(delta(-0.4)).fill).toBeCloseTo(rc02SpineGeometry(delta(0.4)).fill, 12)
  })

  it('clamps at full scale and never exceeds one', () => {
    expect(rc02SpineGeometry(delta(-RC02_SPINE_FULL_SCALE_SEC * 4)).fill).toBe(1)
    expect(rc02SpineGeometry(delta(RC02_SPINE_FULL_SCALE_SEC / 2)).fill).toBeCloseTo(0.5, 12)
  })

  it('reports unavailable and zero fill for stale or missing delta', () => {
    expect(rc02SpineGeometry(delta(-0.3, true))).toMatchObject({ unavailable: true, fill: 0, direction: 'flat' })
    expect(rc02SpineGeometry(delta(null, false, true))).toMatchObject({ unavailable: true, fill: 0 })
  })
})

describe('RC-02 measured sector splits', () => {
  const feed = (tracker: Rc02SectorTracker, pct: number, lapTime: number, receivedAt = 0) =>
    tracker.ingest({ lapDistPct: pct, currentLapTimeSec: lapTime, receivedAt })

  /**
   * Real `lapDistPct` is [0, 1): a lap ends by wrapping from a high fraction back to a low one,
   * never by reaching exactly 1. The lap clock resets on the same frame.
   */
  const wrap = (tracker: Rc02SectorTracker, receivedAt = 0) => feed(tracker, 0.004, 0, receivedAt)

  /** Joins mid-track then crosses start-finish, leaving the tracker at a measurable lap start. */
  function joinThenCross(tracker: Rc02SectorTracker, receivedAt = 0): void {
    feed(tracker, 0.9, 40, receivedAt)
    wrap(tracker, receivedAt)
  }

  /** Feeds one complete lap from an already-observed start-finish start. */
  function runLap(tracker: Rc02SectorTracker, sectorTimes: [number, number, number], receivedAt = 0): void {
    const [s1, s2, s3] = sectorTimes
    feed(tracker, 1 / 3, s1, receivedAt)
    feed(tracker, 2 / 3, s1 + s2, receivedAt)
    feed(tracker, 0.99, s1 + s2 + s3, receivedAt)
  }

  /** Leaves the tracker with a full set of references and positioned at a fresh lap start. */
  function primeReferences(tracker: Rc02SectorTracker, sectorTimes: [number, number, number] = [30, 33, 36], receivedAt = 0): void {
    joinThenCross(tracker, receivedAt)
    runLap(tracker, sectorTimes, receivedAt)
    wrap(tracker, receivedAt)
  }

  it('renders dashes until a sector has been crossed and a reference exists', () => {
    const tracker = new Rc02SectorTracker()
    expect(tracker.sectors(0).map((sector) => sector.value)).toEqual(['--', '--', '--'])
    joinThenCross(tracker)
    runLap(tracker, [30, 33, 36])
    wrap(tracker)
    // The first measured lap has no prior best to compare against, so it still dashes.
    expect(tracker.sectors(0).every((sector) => sector.unavailable)).toBe(true)
  })

  it('closes sector three on the start-finish crossing, never on lapDistPct reaching one', () => {
    const tracker = new Rc02SectorTracker()
    primeReferences(tracker)
    runLap(tracker, [30.2, 33, 36])
    wrap(tracker)
    const laps = tracker.laps()
    expect(laps.length).toBeGreaterThan(0)
    expect(laps[0].sectors.every((value) => value !== null)).toBe(true)
    expect(laps[0].totalSec).toBeCloseTo(99.2, 6)
  })

  it('never lets a mid-lap join write a truncated sector into the reference bests', () => {
    const tracker = new Rc02SectorTracker()
    // Join 30 % into a lap with the clock already at 40 s, then immediately cross S1.
    feed(tracker, 0.3, 40)
    feed(tracker, 0.334, 40.016)
    // That 16 ms fragment must never become the S1 reference.
    feed(tracker, 0.99, 76)
    wrap(tracker)
    runLap(tracker, [30, 33, 36])
    wrap(tracker)
    runLap(tracker, [30, 33, 36])
    // If the fragment had poisoned bests[0], S1 would read roughly +30 s and latch a loss.
    const [s1] = tracker.sectors(0)
    expect(s1.deltaSec).toBeCloseTo(0, 6)
    expect(s1.lossActive).toBe(false)
  })

  it('never fabricates a split when the timing feed is missing', () => {
    const tracker = new Rc02SectorTracker()
    primeReferences(tracker)
    tracker.ingest({ lapDistPct: null, currentLapTimeSec: null, receivedAt: 0 })
    expect(tracker.hasTimingFeed()).toBe(false)
    expect(tracker.sectors(0).map((sector) => sector.value)).toEqual(['--', '--', '--'])
  })

  it('dashes every sector once the timing feed goes quiet', () => {
    const tracker = new Rc02SectorTracker()
    primeReferences(tracker, [30, 33, 36], 1_000)
    feed(tracker, 1 / 3, 30.5, 5_000)
    expect(tracker.sectors(5_000)[0].unavailable).toBe(false)
    // A frozen feed must degrade visibly rather than keep showing the last delta.
    expect(tracker.sectors(5_000 + RC02_SECTOR_FEED_STALE_MS + 1)[0].unavailable).toBe(true)
    expect(tracker.sectors(5_000 + RC02_SECTOR_FEED_STALE_MS + 1)[0].value).toBe('--')
  })

  it('compares each sector only against the driver own best for that sector', () => {
    const tracker = new Rc02SectorTracker()
    primeReferences(tracker, [30, 33, 36])
    feed(tracker, 1 / 3, 29.8)
    feed(tracker, 2 / 3, 29.8 + 33.5)
    const sectors = tracker.sectors(0)
    expect(sectors[0].deltaSec).toBeCloseTo(-0.2, 6)
    expect(sectors[1].deltaSec).toBeCloseTo(0.5, 6)
    expect(sectors[0].value).toBe('-0.200')
    expect(sectors[1].value).toBe('+0.500')
  })

  it('latches a sector-loss alert only above the packet threshold and holds it for three seconds', () => {
    const tracker = new Rc02SectorTracker()
    primeReferences(tracker, [30, 33, 36], 5_000)
    const s1 = 30 + RC02_SECTOR_LOSS_THRESHOLD_SEC + 0.05
    feed(tracker, 1 / 3, s1, 5_000)
    feed(tracker, 2 / 3, s1 + 33.05, 5_000)
    const atCrossing = tracker.sectors(5_000)
    expect(atCrossing[0].lossActive).toBe(true)
    // +0.05 s is a real loss but under the trigger, so it must stay silent.
    expect(atCrossing[1].lossActive).toBe(false)
    // Freshness is re-checked on every read, so the hold is only observable while the feed is live.
    expect(tracker.sectors(5_000 + RC02_SECTOR_FEED_STALE_MS)[0].lossActive).toBe(true)
    expect(tracker.sectors(5_000 + RC02_SECTOR_LOSS_HOLD_MS)[0].lossActive).toBe(false)
  })

  it('consumes both intermediate crossings when a sparse frame skips past them', () => {
    const tracker = new Rc02SectorTracker()
    primeReferences(tracker, [30, 33, 36])
    // One frame jumps from just after start-finish to beyond the second boundary.
    feed(tracker, 0.7, 63)
    const sectors = tracker.sectors(0)
    expect(sectors[0].completed).toBe(true)
    expect(sectors[0].timeSec).toBeCloseTo(63, 6)
    // No measurable time elapsed between the two crossings in that single frame, so S2 must
    // stay a dash rather than be recorded as a zero-second sector.
    expect(sectors[1].completed).toBe(false)
    expect(sectors[1].value).toBe('--')
    // Both boundaries were still consumed, so the lap closes normally at start-finish; it is
    // not archived because S2 was never measurable, leaving only the primed lap in history.
    feed(tracker, 0.99, 99)
    wrap(tracker)
    expect(tracker.laps()).toHaveLength(1)
  })

  it('clears the previous lap chips when a new lap starts', () => {
    const tracker = new Rc02SectorTracker()
    primeReferences(tracker, [30, 33, 36])
    feed(tracker, 1 / 3, 31)
    expect(tracker.sectors(0)[0].completed).toBe(true)
    feed(tracker, 0.99, 100)
    wrap(tracker)
    expect(tracker.sectors(0).every((sector) => !sector.completed)).toBe(true)
    expect(tracker.sectors(0).map((sector) => sector.value)).toEqual(['--', '--', '--'])
  })

  it('tolerates small backward lap-clock jitter without restarting the lap', () => {
    const tracker = new Rc02SectorTracker()
    primeReferences(tracker, [30, 33, 36])
    feed(tracker, 1 / 3, 30.2)
    expect(tracker.sectors(0)[0].completed).toBe(true)
    // A 1 ms non-monotonic sample must not be read as a pit reset.
    feed(tracker, 0.4, 30.199)
    expect(tracker.sectors(0)[0].completed).toBe(true)
  })

  it('treats a real lap-clock rewind as a restart and stops measuring until the next crossing', () => {
    const tracker = new Rc02SectorTracker()
    primeReferences(tracker, [30, 33, 36])
    feed(tracker, 1 / 3, 30.2)
    feed(tracker, 0.4, 2)
    expect(tracker.sectors(0).every((sector) => !sector.completed)).toBe(true)
  })

  it('drops every measured sector and every reference on reset', () => {
    const tracker = new Rc02SectorTracker()
    primeReferences(tracker, [30, 33, 36])
    tracker.reset()
    expect(tracker.laps()).toHaveLength(0)
    expect(tracker.hasTimingFeed()).toBe(false)
    joinThenCross(tracker)
    runLap(tracker, [30, 33, 36])
    wrap(tracker)
    expect(tracker.sectors(0).every((sector) => sector.unavailable)).toBe(true)
  })

  it('keeps a bounded newest-first lap history of fully measured laps only', () => {
    const tracker = new Rc02SectorTracker()
    primeReferences(tracker, [30, 33, 36])
    for (let lap = 0; lap < RC02_LAP_HISTORY_LIMIT + 3; lap += 1) {
      runLap(tracker, [30 + lap * 0.1, 33, 36])
      wrap(tracker)
    }
    const laps = tracker.laps()
    expect(laps.length).toBe(RC02_LAP_HISTORY_LIMIT)
    expect(laps[0].lapOrdinal).toBeGreaterThan(laps[laps.length - 1].lapOrdinal)
    expect(laps.every((lap) => lap.totalSec !== null)).toBe(true)
  })

  it('clones without sharing mutable state', () => {
    const tracker = new Rc02SectorTracker()
    primeReferences(tracker, [30, 33, 36])
    const copy = tracker.clone()
    feed(copy, 1 / 3, 29)
    expect(copy.sectors(0)[0].completed).toBe(true)
    expect(tracker.sectors(0)[0].completed).toBe(false)
  })

  it('describes sectors accessibly without relying on colour', () => {
    const tracker = new Rc02SectorTracker()
    primeReferences(tracker, [30, 33, 36], 2_000)
    feed(tracker, 1 / 3, 30.5, 2_000)
    const [s1] = tracker.sectors(2_000)
    expect(rc02SectorDescription(s1)).toContain('lost')
    expect(rc02SectorDescription(s1)).toContain('sector loss alert active')
    expect(rc02SectorDescription({ ...s1, unavailable: true })).toBe('S1 split unavailable')
  })
})

describe('RC-02 personal-best pace alert', () => {
  it('stays silent until the debounce elapses', () => {
    let state = createRc02PbPaceState()
    state = advanceRc02PbPace(state, { nowMs: 0, delta: -0.3 })
    expect(state.active).toBe(false)
    state = advanceRc02PbPace(state, { nowMs: RC02_PB_PACE_DEBOUNCE_MS - 1, delta: -0.3 })
    expect(state.active).toBe(false)
    state = advanceRc02PbPace(state, { nowMs: RC02_PB_PACE_DEBOUNCE_MS, delta: -0.3 })
    expect(state.active).toBe(true)
  })

  it('never engages on a gain smaller than the packet threshold', () => {
    let state = createRc02PbPaceState()
    for (const nowMs of [0, 500, 5_000]) state = advanceRc02PbPace(state, { nowMs, delta: -0.02 })
    expect(state.active).toBe(false)
  })

  it('holds through small fluctuations and clears once the lap falls behind', () => {
    let state = advanceRc02PbPace(advanceRc02PbPace(createRc02PbPaceState(), { nowMs: 0, delta: -0.3 }), {
      nowMs: RC02_PB_PACE_DEBOUNCE_MS,
      delta: -0.3
    })
    expect(state.active).toBe(true)
    state = advanceRc02PbPace(state, { nowMs: 2_000, delta: -0.01 })
    expect(state.active).toBe(true)
    state = advanceRc02PbPace(state, { nowMs: 3_000, delta: 0.02 })
    expect(state.active).toBe(false)
  })

  it('clears immediately when the delta becomes unavailable', () => {
    let state = advanceRc02PbPace(advanceRc02PbPace(createRc02PbPaceState(), { nowMs: 0, delta: -0.3 }), {
      nowMs: RC02_PB_PACE_DEBOUNCE_MS,
      delta: -0.3
    })
    expect(advanceRc02PbPace(state, { nowMs: 4_000, delta: null }).active).toBe(false)
  })

  it('is unlatched by a stale or missing best lap', () => {
    const active = { active: true, pendingSinceMs: null }
    const model = modelFor(snapshot({ bestLapTimeSec: undefined, deltaToBestSec: undefined }))
    expect(clearInvalidRc02PbPace(active, model).active).toBe(false)
    expect(clearInvalidRc02PbPace(active, modelFor(snapshot())).active).toBe(true)
  })
})

describe('RC-02 telemetry truth', () => {
  it('derives the predicted lap only from a real best plus a real delta', () => {
    const model = modelFor(snapshot())
    expect(model.predicted.unavailable).toBe(false)
    expect(model.predicted.raw).toBeCloseTo(99.264, 6)
    expect(model.predicted.value).toBe('1:39.264')
  })

  it('refuses to show a predicted lap without a stored best', () => {
    expect(modelFor(snapshot({ bestLapTimeSec: undefined })).predicted).toMatchObject({ unavailable: true, value: '--:--.---' })
    expect(modelFor(snapshot({ deltaToBestSec: undefined })).predicted).toMatchObject({ unavailable: true, value: '--:--.---' })
  })

  it('dashes lap clocks that have no measured value instead of inventing one', () => {
    // Current and last lap time are deliberately not surfaced by RC-02, so the model must not
    // expose them at all rather than deriving their freshness from another channel.
    const model = modelFor(snapshot())
    expect('currentLap' in model).toBe(false)
    expect('lastLap' in model).toBe(false)
  })

  it('dashes a stale delta so it can never contradict the spine', () => {
    // Receipts taken at t=0, read 60 s later: every lap-timing channel is long stale.
    const stale = modelFor(snapshot(), 60_000, false, false, 0)
    expect(stale.delta.stale || stale.delta.unavailable).toBe(true)
    expect(stale.delta.value).toBe('--')
    expect(stale.spine.unavailable).toBe(true)
  })

  it('never mirrors one tyre corner onto another', () => {
    const model = modelFor(snapshot({ tyres: { lf: { tempC: 78 }, rf: {}, lr: { tempC: 74 }, rr: {} } } as Partial<TelemetrySnapshot>))
    expect(model.tyres.find((tyre) => tyre.corner === 'LF')?.unavailable).toBe(false)
    expect(model.tyres.find((tyre) => tyre.corner === 'RF')?.unavailable).toBe(true)
    expect(model.tyres.find((tyre) => tyre.corner === 'RR')?.unavailable).toBe(true)
  })

  it('formats lap times and signed deltas deterministically', () => {
    expect(rc02FormatLapTime(99.548)).toBe('1:39.548')
    expect(rc02FormatLapTime(9.5)).toBe('0:09.500')
    expect(rc02FormatLapTime(null)).toBe('--:--.---')
    expect(rc02FormatLapTime(Number.NaN)).toBe('--:--.---')
    expect(rc02FormatSignedSeconds(-0.121)).toBe('-0.121')
    expect(rc02FormatSignedSeconds(0.5)).toBe('+0.500')
    expect(rc02FormatSignedSeconds(0)).toBe('0.000')
    expect(rc02FormatSignedSeconds(null)).toBe('--')
  })

  it('presents PRED and BEST in one lap format and the delta without an embedded unit', () => {
    const model = modelFor(snapshot())
    expect(model.best.value).toBe('1:39.548')
    expect(model.predicted.value).toBe('1:39.264')
    // The spine renders "S" as its own label, so the value must not repeat it.
    expect(model.delta.value).toBe('-0.284')
    expect(model.delta.value).not.toContain('S')
  })
})

describe('RC-02 responsive contract', () => {
  it('resolves the native, app and compact layouts from the content box', () => {
    expect(rc02LayoutForContentBox(800, 480)).toBe('native')
    expect(rc02LayoutForContentBox(801, 481)).toBe('native')
    expect(rc02LayoutForContentBox(1024, 600)).toBe('app')
    expect(rc02LayoutForContentBox(1440, 900)).toBe('app')
    expect(rc02LayoutForContentBox(393, 759)).toBe('compact')
    expect(rc02LayoutForContentBox(0, 0)).toBe('app')
  })

  it('classifies phone and landscape compact modes', () => {
    expect(rc02CompactModeForContentBox(393, 759)).toBe('phone')
    expect(rc02CompactModeForContentBox(412, 867)).toBe('phone')
    expect(rc02CompactModeForContentBox(759, 393)).toBe('landscape')
    expect(rc02CompactModeForContentBox(867, 412)).toBe('landscape')
    expect(rc02CompactModeForContentBox(640, 520)).toBe('standard')
    expect(rc02CompactModeForContentBox(1024, 600)).toBe('standard')
  })

  it('emits contained portrait geometry only at the phone breakpoint', () => {
    expect(rc02PhoneGeometryForContentBox(1024, 600)).toBeNull()
    for (const [width, height] of [
      [393, 759],
      [412, 867]
    ] as const) {
      const geometry = rc02PhoneGeometryForContentBox(width, height)
      expect(geometry).not.toBeNull()
      expect(geometry!.spineTop).toBeGreaterThan(geometry!.headTop + geometry!.headHeight)
      expect(geometry!.spineTop + geometry!.spineHeight).toBeLessThanOrEqual(geometry!.bottomTop)
      expect(geometry!.bottomTop + geometry!.bottomHeight).toBeLessThanOrEqual(height)
    }
  })
})

describe('RC-02 rendering', () => {
  it('renders the canonical DOM contract with nine LEDs and three sector chips', () => {
    const html = markup(snapshot())
    assertClean(html)
    expect(html).toContain('data-widget="raceconRc02Dash"')
    expect(html).toContain('data-testid="rc02-spine-track"')
    expect(html).toContain('data-testid="rc02-spine-datum"')
    expect(html.match(/data-testid="rc02-led"/g) ?? []).toHaveLength(RC02_LED_COUNT)
    expect(html.match(/data-testid="rc02-sector"/g) ?? []).toHaveLength(3)
    expect(html).toContain('data-sector="S1"')
    expect(html).toContain('data-sector="S3"')
  })

  it('renders a clean, dash-only frame with no telemetry at all', () => {
    const html = markup(null)
    assertClean(html)
    expect(html).toContain('data-rc02-pb-pace="false"')
    expect(html).toContain('--:--.---')
    expect(html.match(/data-testid="rc02-led"/g) ?? []).toHaveLength(RC02_LED_COUNT)
  })

  it('refuses mock and replay telemetry and shows no personal-best accent', () => {
    for (const value of [
      snapshot({ sim: 'mock' } as Partial<TelemetrySnapshot>),
      snapshot({ replayContext: { state: 'replay' } } as unknown as Partial<TelemetrySnapshot>)
    ]) {
      const html = markup(value)
      assertClean(html)
      expect(html).not.toContain('data-rc02-buffer-state="accepted"')
      expect(html).toContain('data-rc02-pb-pace="false"')
      expect(html).not.toContain('data-testid="rc02-spine-cap"')
    }
  })

  it('marks the native 800x480 contract only at that exact size', () => {
    const native = { ...config, position: { x: 0, y: 0, width: 800, height: 480 } }
    expect(markup(snapshot(), native)).toContain('data-rc02-native-size="800x480"')
    expect(markup(snapshot())).not.toContain('data-rc02-native-size')
  })

  it('exposes the compact mode attribute only in the compact layout', () => {
    const phone = { ...config, position: { x: 0, y: 0, width: 393, height: 759 } }
    expect(markup(snapshot(), phone)).toContain('data-rc02-compact-mode="phone"')
    expect(markup(snapshot())).not.toContain('data-rc02-compact-mode')
  })

  it('shows the ladder empty state until a lap has actually been measured', () => {
    const html = markup(snapshot())
    expect(html).toContain('data-testid="rc02-ladder-empty"')
    expect(html).not.toContain('data-testid="rc02-ladder-row"')
  })

  it('keeps a sector-loss surface in the ladder for the app layout', () => {
    const html = markup(snapshot())
    expect(html).toContain('data-testid="rc02-ladder-now"')
    expect(html.match(/data-testid="rc02-ladder-now-sector"/g) ?? []).toHaveLength(3)
  })
})

describe('RC-02 shares the RC-01 fail-closed ingest buffer', () => {
  it('accepts a live identified snapshot and rejects an unidentified one', () => {
    const buffer = new Rc01LiveTelemetryBuffer()
    expect(buffer.ingest(snapshot(), 1_000).accepted).toBe(true)
    const orphan = new Rc01LiveTelemetryBuffer()
    expect(orphan.ingest(snapshot({ sessionUniqueId: undefined, connectionEpoch: undefined }), 1_000).accepted).toBe(false)
  })
})
