// @vitest-environment jsdom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOverlayStyle, type OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { RC02_SECTOR_BOUNDARIES } from './raceconRc02Core'
import { RACECON_DISPLAY_CLOCK_INTERVAL_MS, raceconDisplayClockFrozen } from './raceconDisplayClock'
import { RaceconRc18DashWidget } from './RaceconRc18DashWidget'
import {
  RC18_ALERT_MIN_VISIBLE_MS,
  RC18_BALANCE_BAND,
  RC18_BALANCE_BAND_HYSTERESIS,
  RC18_BALANCE_MIN_SAMPLES,
  RC18_BALANCE_MIN_SPEED_SPREAD_KMH,
  RC18_BASELINE_LOCK_EVENT,
  RC18_CORNERS,
  RC18_MATCH_FEED_STALE_MS,
  RC18_MIRROR_AXIS_PCT,
  RC18_PACKET_OMISSIONS,
  RC18_SECTOR_BOUNDARIES,
  RC18_SECTOR_LABELS,
  RC18_SECTOR_NOISE_HYSTERESIS_SEC,
  RC18_SECTOR_NOISE_SEC,
  RC18_SIDE_LINE_BANDS,
  RC18_SIDE_TOKENS,
  RC18_SPINE_APP_WIDTH_PX,
  RC18_SPINE_FULL_SCALE_SEC,
  RC18_SPINE_HALF_SPAN_APP_PX,
  RC18_SPINE_HALF_SPAN_NATIVE_PX,
  RC18_SPINE_HALF_SPAN_PCT,
  RC18_SPINE_NATIVE_WIDTH_PX,
  RC18_TOKENS,
  RC18_TYPE_RANKS,
  RC18_TYPE_SCALE_PX,
  type Rc18AlertInput,
  type Rc18Layout,
  type Rc18Rect,
  type Rc18Run,
  type Rc18RunSample,
  Rc18RunRecorder,
  advanceRc18Alerts,
  clearInvalidRc18Alerts,
  createRc18AlertState,
  createRc18DashboardModel,
  rc18AlertInputForModel,
  rc18AlertLines,
  rc18AlertFlags,
  rc18AxlePeakC,
  rc18BalanceIndexFromSamples,
  rc18BarLengthPct,
  rc18BaselineCommandFromEvent,
  rc18CompactModeForContentBox,
  rc18FasterSide,
  rc18LayoutForContentBox,
  rc18MirrorError,
  rc18RowsForLayout,
  rc18SectorDeltas,
  rc18SelectPair,
  rc18SignedSeconds,
  rc18TypeScaleCqw,
  rc18ZonesForLayout
} from './raceconRc18Core'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/*
 * Registration is deliberately NOT asserted here. RC-18 ships as core-only (part 1 of 2): the
 * `OverlayWidgetId` union member, the `WIDGET_COMPONENTS` entry, the `OVERLAY_DASHBOARD_PRESETS`
 * preset, the `RESPONSIVE_FULL_FRAME_WIDGET_IDS` and `IDENTITY_SCOPED_WIDGET_IDS` memberships and
 * the regenerated identity catalog all land in the separate catalog wiring PR, which owns every
 * shared registration file. This suite covers everything the four new files can own alone.
 */

// ------------------------------------------------------------------------------- fixtures

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

const nativeConfig: OverlayWidgetConfig = {
  ...config,
  position: { x: 0, y: 0, width: 800, height: 480 }
}

function snapshot(overrides: Partial<TelemetrySnapshot> = {}, timestamp = 5_000_000): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp,
    sessionUniqueId: 18,
    speedKmh: 182,
    gear: 4,
    throttle: 0.82,
    brake: 0,
    clutch: 0,
    sessionType: 'Practice',
    sessionState: 'racing',
    currentLap: 7,
    position: 1,
    playerCarIdx: 2,
    lapDistPct: 0,
    currentLapTimeSec: 0,
    deltaToBestSec: 0.121,
    bestLapTimeSec: 104.842,
    steerAngleDeg: 10,
    yawRateRadSec: 0.3,
    tyres: { lf: { tempC: 84 }, rf: { tempC: 86 }, lr: { tempC: 79 }, rr: { tempC: 81 } },
    brakeTempC: { lf: 412, rf: 405, lr: 388, rr: 380 },
    ...overrides
  } as TelemetrySnapshot
}

function runSample(overrides: Partial<Rc18RunSample> = {}): Rc18RunSample {
  return {
    lapDistPct: 0,
    currentLapTimeSec: 0,
    speedKmh: 182,
    deltaToBestSec: 0.121,
    bestLapTimeSec: 104.842,
    steerAngleDeg: 0,
    yawRateRadSec: 0,
    tyreC: { lf: 84, rf: 86, lr: 79, rr: 81 },
    brakeC: { lf: 412, rf: 405, lr: 388, rr: 380 },
    receivedAt: 0,
    ...overrides
  }
}

interface LapPlan {
  sectors: readonly [number, number, number]
  base?: Partial<Rc18RunSample>
  /** Injected between the start-finish crossing and the first sector boundary. */
  extras?: readonly Partial<Rc18RunSample>[]
}

/**
 * Drives complete laps through the recorder. RC-02's tracker only archives a lap whose three
 * sectors were BOTH-crossing observed, so the first plan is always an unarchivable out-lap and
 * `n` plans archive `n - 2` matched laps.
 */
function driveLaps(recorder: Rc18RunRecorder, plans: readonly LapPlan[], startAt = 0): number {
  let receivedAt = startAt
  const emit = (lapDistPct: number, currentLapTimeSec: number, values: Partial<Rc18RunSample>): void => {
    receivedAt += 50
    recorder.ingest(runSample({ lapDistPct, currentLapTimeSec, receivedAt, ...values }))
  }
  for (const plan of plans) {
    const [s1, s2, s3] = plan.sectors
    const base = plan.base ?? {}
    emit(0, 0, base)
    const extras = plan.extras ?? []
    extras.forEach((extra, index) => {
      const fraction = (index + 1) / (extras.length + 1)
      emit(0.005 + fraction * 0.3, 0.01 + fraction * s1 * 0.9, { ...base, ...extra })
    })
    emit(RC02_SECTOR_BOUNDARIES[0], s1, base)
    emit(RC02_SECTOR_BOUNDARIES[1], s1 + s2, base)
    emit(0.99, s1 + s2 + s3, base)
  }
  return receivedAt
}

/** Cornering samples whose yaw gain falls from `slowGain` to `fastGain`, i.e. understeer. */
function balanceExtras(slowGain: number, fastGain: number, count = RC18_BALANCE_MIN_SAMPLES + 8): Partial<Rc18RunSample>[] {
  const steerAngleDeg = 10
  const steerRad = (steerAngleDeg * Math.PI) / 180
  return Array.from({ length: count }, (_, index) => {
    const slow = index < count / 2
    const speedKmh = slow ? 60 + (index % 8) : 60 + RC18_BALANCE_MIN_SPEED_SPREAD_KMH + 40 + (index % 8)
    const gain = slow ? slowGain : fastGain
    return {
      speedKmh,
      steerAngleDeg,
      yawRateRadSec: gain * steerRad * (speedKmh / 3.6)
    }
  })
}

function lapPlan(sectors: readonly [number, number, number], overrides: Partial<LapPlan> = {}): LapPlan {
  return { sectors, ...overrides }
}

/** Two archived matched laps whose sectors are exactly the approved reference frame's. */
function referenceRecorder(): Rc18RunRecorder {
  const recorder = new Rc18RunRecorder()
  driveLaps(recorder, [
    lapPlan([30, 44, 28]),
    lapPlan([31.441, 44.907, 28.615], {
      base: { tyreC: { lf: 84, rf: 86, lr: 79, rr: 81 }, brakeC: { lf: 412, rf: 408, lr: 388, rr: 384 }, deltaToBestSec: 0.121, speedKmh: 182 },
      extras: [...balanceExtras(1, 0.58), { speedKmh: 97 }]
    }),
    lapPlan([31.482, 44.639, 28.456], {
      base: { tyreC: { lf: 88, rf: 90, lr: 83, rr: 85 }, brakeC: { lf: 405, rf: 401, lr: 388, rr: null }, deltaToBestSec: -0.265, speedKmh: 186 },
      extras: [...balanceExtras(1, 0.69), { speedKmh: 103 }]
    }),
    lapPlan([31, 44, 28])
  ])
  return recorder
}

function markup(value: TelemetrySnapshot | null, cfg = config): string {
  return renderToStaticMarkup(createElement(RaceconRc18DashWidget, { snapshot: value, config: cfg }))
}

function assertClean(value: string): void {
  expect(value).not.toContain('\uFFFD')
  expect(value).not.toContain('NaN')
  expect(value).not.toContain('undefined')
  expect(value).not.toContain('[object Object]')
}

function alertInput(overrides: Partial<Rc18AlertInput> = {}): Rc18AlertInput {
  return {
    nowMs: 0,
    pairAvailable: true,
    sectorDeltas: [0, 0, 0],
    balanceDelta: 0,
    incomparableKeys: [],
    ...overrides
  }
}

const LAYOUTS: readonly { layout: Rc18Layout; mode: Parameters<typeof rc18ZonesForLayout>[1] }[] = [
  { layout: 'native', mode: 'standard' },
  { layout: 'app', mode: 'standard' },
  { layout: 'compact', mode: 'standard' },
  { layout: 'compact', mode: 'landscape' },
  { layout: 'compact', mode: 'phone' }
]

function right(rect: Rc18Rect): number {
  return rect.left + rect.width
}

function bottom(rect: Rc18Rect): number {
  return rect.top + rect.height
}

function overlaps(a: Rc18Rect, b: Rc18Rect): boolean {
  return a.left < right(b) && right(a) > b.left && a.top < bottom(b) && bottom(a) > b.top
}

// ------------------------------------------------------------------------------ the suite

describe('RC-18 reuses the RaceCon family machinery instead of forking it', () => {
  it('measures sectors on RC-02 boundaries rather than declaring its own', () => {
    expect(RC18_SECTOR_BOUNDARIES).toBe(RC02_SECTOR_BOUNDARIES)
    expect([...RC18_SECTOR_BOUNDARIES]).toEqual([1 / 3, 2 / 3])
  })

  it('inherits the RC-01 breakpoints for every layout decision', () => {
    expect(rc18LayoutForContentBox(800, 480)).toBe('native')
    expect(rc18LayoutForContentBox(801, 479)).toBe('native')
    expect(rc18LayoutForContentBox(1024, 600)).toBe('app')
    expect(rc18LayoutForContentBox(1023, 599)).toBe('app')
    expect(rc18LayoutForContentBox(1920, 1080)).toBe('app')
    expect(rc18LayoutForContentBox(640, 520)).toBe('compact')
    expect(rc18LayoutForContentBox(0, 0)).toBe('app')
    expect(rc18LayoutForContentBox(Number.NaN, 480)).toBe('app')
  })

  it('resolves the compact sub-modes from the RC-01 aspect rules', () => {
    expect(rc18CompactModeForContentBox(800, 480)).toBe('standard')
    expect(rc18CompactModeForContentBox(400, 700)).toBe('phone')
    expect(rc18CompactModeForContentBox(720, 400)).toBe('landscape')
    expect(rc18CompactModeForContentBox(640, 520)).toBe('standard')
  })

  it('uses the shared display clock policy, so a preview never ticks', () => {
    expect(raceconDisplayClockFrozen(undefined)).toBe(false)
    expect(raceconDisplayClockFrozen('inert')).toBe(true)
  })
})

describe('RC-18 packet 11.1 / 12.1 zone geometry', () => {
  it('places every 800x480 zone on the packet pixel rect, never on the traced render', () => {
    const zones = rc18ZonesForLayout('native', 'standard')
    const px = (rect: Rc18Rect | undefined): number[] =>
      rect ? [rect.left * 8, rect.top * 4.8, rect.width * 8, rect.height * 4.8].map((n) => Number(n.toFixed(4))) : []
    expect(px(zones.summary)).toEqual([16, 12, 768, 30])
    expect(px(zones.columnA)).toEqual([16, 50, 300, 380])
    // Normative override NO-3: the render put these rules at 293.5 / 505.5. The packet wins.
    expect(px(zones.spine)).toEqual([316, 50, 168, 380])
    expect(px(zones.columnB)).toEqual([484, 50, 300, 380])
    expect(px(zones.stability)).toEqual([316, 360, 168, 70])
    expect(zones.trace).toBeUndefined()
  })

  it('places every 1024x600 zone on the packet pixel rect and adds the app-only trace', () => {
    const zones = rc18ZonesForLayout('app', 'standard')
    const px = (rect: Rc18Rect | undefined): number[] =>
      rect ? [rect.left * 10.24, rect.top * 6, rect.width * 10.24, rect.height * 6].map((n) => Number(n.toFixed(4))) : []
    expect(px(zones.summary)).toEqual([24, 12, 976, 36])
    expect(px(zones.columnA)).toEqual([24, 60, 320, 440])
    expect(px(zones.spine)).toEqual([344, 60, 336, 440])
    expect(px(zones.columnB)).toEqual([680, 60, 320, 440])
    expect(px(zones.trace)).toEqual([24, 510, 976, 70])
    // Gap G2: packet 12.1 has no stability zone at all; it is nested in the widened spine base.
    expect(px(zones.stability)).toEqual([344, 430, 336, 70])
  })

  it('resolves the packet gap G3 overlap by capping the delta stack short of the stability row', () => {
    for (const { layout, mode } of LAYOUTS) {
      const zones = rc18ZonesForLayout(layout, mode)
      const spine = zones.spine
      const stack = zones.deltaStack
      const stability = zones.stability
      expect(spine && stack && stability).toBeTruthy()
      // Both are declared nested sub-zones of the spine, and they never collide with each other.
      expect(overlaps(stack as Rc18Rect, stability as Rc18Rect)).toBe(false)
      expect(bottom(stack as Rc18Rect)).toBeLessThan((stability as Rc18Rect).top)
      expect(bottom(stability as Rc18Rect)).toBeLessThanOrEqual(bottom(spine as Rc18Rect) + 1e-9)
    }
  })

  it('keeps every zone inside the frame and the three top-level bands mutually exclusive', () => {
    for (const { layout, mode } of LAYOUTS) {
      const zones = rc18ZonesForLayout(layout, mode)
      for (const rect of Object.values(zones)) {
        expect(rect.left).toBeGreaterThanOrEqual(0)
        expect(rect.top).toBeGreaterThanOrEqual(0)
        expect(right(rect)).toBeLessThanOrEqual(100 + 1e-9)
        expect(bottom(rect)).toBeLessThanOrEqual(100 + 1e-9)
      }
      const bands = [zones.summary, zones.columnA, zones.spine, zones.columnB].filter(Boolean) as Rc18Rect[]
      for (let i = 0; i < bands.length; i += 1) {
        for (let j = i + 1; j < bands.length; j += 1) {
          expect(overlaps(bands[i], bands[j])).toBe(false)
        }
      }
    }
  })

  it('keeps the columns and the spine exactly contiguous with symmetric outer margins', () => {
    for (const { layout, mode } of LAYOUTS) {
      const zones = rc18ZonesForLayout(layout, mode)
      const a = zones.columnA as Rc18Rect
      const spine = zones.spine as Rc18Rect
      const b = zones.columnB as Rc18Rect
      expect(right(a)).toBeCloseTo(spine.left, 9)
      expect(right(spine)).toBeCloseTo(b.left, 9)
      expect(a.left).toBeCloseTo(100 - right(b), 9)
    }
  })
})

describe('RC-18 mirror symmetry is structural, not eyeballed', () => {
  it('reflects setup A onto setup B exactly, at every breakpoint', () => {
    for (const { layout, mode } of LAYOUTS) {
      expect(rc18MirrorError(rc18ZonesForLayout(layout, mode))).toBeCloseTo(0, 9)
    }
  })

  it('centres the verdict spine on the mirror axis, at every breakpoint', () => {
    for (const { layout, mode } of LAYOUTS) {
      const zones = rc18ZonesForLayout(layout, mode)
      const spine = zones.spine as Rc18Rect
      expect(spine.left + spine.width / 2).toBeCloseTo(RC18_MIRROR_AXIS_PCT, 9)
      const stability = zones.stability as Rc18Rect
      expect(stability.left + stability.width / 2).toBeCloseTo(RC18_MIRROR_AXIS_PCT, 9)
    }
  })

  it('gives the two halves of the shared axis the same span on both canvases', () => {
    // 76/168 and 152/336 are the SAME fraction: the claim of a shared axis is arithmetic.
    expect(RC18_SPINE_HALF_SPAN_NATIVE_PX / RC18_SPINE_NATIVE_WIDTH_PX).toBeCloseTo(
      RC18_SPINE_HALF_SPAN_APP_PX / RC18_SPINE_APP_WIDTH_PX,
      12
    )
    expect(RC18_SPINE_HALF_SPAN_PCT).toBeCloseTo(45.238095, 5)
    // Neither half may reach the spine edge, or a full-scale bar would collide with a column.
    expect(RC18_SPINE_HALF_SPAN_PCT).toBeLessThan(50)
  })

  it('drives both columns from ONE pair list, so the rows cannot drift out of step', () => {
    const model = createRc18DashboardModel(referenceRecorder().laps())
    expect(model.pairs.length).toBeGreaterThan(0)
    for (const pair of model.pairs) {
      expect(pair.a).toBeDefined()
      expect(pair.b).toBeDefined()
      // Same key, same label, same unit, same rung on both sides by construction.
      expect(typeof pair.label).toBe('string')
    }
    const html = markup(snapshot(), nativeConfig)
    const rowsA = [...html.matchAll(/data-rc18-row="([a-zA-Z0-9]+)" data-rc18-rung="[a-z]+" data-rc18-side="a"/g)]
    const rowsB = [...html.matchAll(/data-rc18-row="([a-zA-Z0-9]+)" data-rc18-rung="[a-z]+" data-rc18-side="b"/g)]
    expect(rowsA.map((match) => match[1])).toEqual(rowsB.map((match) => match[1]))
    expect(rowsA).toHaveLength(rc18RowsForLayout('native', 'standard').length)
  })

  it('separates A from B without colour, by identity line count', () => {
    expect(RC18_SIDE_LINE_BANDS.a).toBe(1)
    expect(RC18_SIDE_LINE_BANDS.b).toBe(2)
    expect(RC18_SIDE_TOKENS.a).toBe(RC18_TOKENS.info)
    expect(RC18_SIDE_TOKENS.b).toBe(RC18_TOKENS.signature)
    expect(RC18_SIDE_TOKENS.a).not.toBe(RC18_SIDE_TOKENS.b)
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('data-rc18-line-bands="1"')
    expect(html).toContain('data-rc18-line-bands="2"')
  })
})

describe('RC-18 typographic ladder is computed from packet 11.2, not from the render', () => {
  it('keeps five strictly ranked steps with at least 8 % between neighbours', () => {
    const sizes = RC18_TYPE_RANKS.map((rank) => RC18_TYPE_SCALE_PX[rank])
    expect(sizes).toEqual([44, 34, 28, 22, 16])
    for (let index = 1; index < sizes.length; index += 1) {
      // Normative override NO-1: the render compressed ranks 2-4 to within 1 px of each other.
      expect(sizes[index - 1] / sizes[index]).toBeGreaterThanOrEqual(1.08)
    }
  })

  it('expresses the ladder in cqw of the 800 px native canvas', () => {
    expect(rc18TypeScaleCqw(RC18_TYPE_SCALE_PX.verdict)).toBeCloseTo(5.5, 9)
    expect(rc18TypeScaleCqw(RC18_TYPE_SCALE_PX.sector)).toBeCloseTo(4.25, 9)
    expect(rc18TypeScaleCqw(RC18_TYPE_SCALE_PX.summary)).toBeCloseTo(3.5, 9)
    expect(rc18TypeScaleCqw(RC18_TYPE_SCALE_PX.secondary)).toBeCloseTo(2.75, 9)
    expect(rc18TypeScaleCqw(RC18_TYPE_SCALE_PX.label)).toBeCloseTo(2, 9)
  })

  it('caps every signed numeral at six characters so it cannot outgrow the spine', () => {
    for (const value of [0.041, -0.268, 9.9994, 0, 123.4, -1234.5]) {
      expect(rc18SignedSeconds(value).length).toBeLessThanOrEqual(6)
    }
    expect(rc18SignedSeconds(0.041)).toBe('+0.041')
    expect(rc18SignedSeconds(-0.268)).toBe('\u22120.268')
    expect(rc18SignedSeconds(null)).toBe('--.---')
    // A magnitude past the ceiling is FLAGGED, never rounded into a plausible lie.
    expect(rc18SignedSeconds(42.5)).toBe('+9.99+')
  })
})

describe('RC-18 measures matched laps and never fabricates one', () => {
  it('refuses to record a lap that was joined mid-track', () => {
    const recorder = new Rc18RunRecorder()
    driveLaps(recorder, [lapPlan([31, 44, 28])])
    expect(recorder.laps()).toHaveLength(0)
  })

  it('records exactly one matched lap per fully observed lap, newest first', () => {
    const recorder = referenceRecorder()
    const runs = recorder.laps()
    expect(runs).toHaveLength(2)
    expect(runs[0].lapOrdinal).toBeGreaterThan(runs[1].lapOrdinal)
    expect(runs[1].sectorsSec.map((value) => Number((value as number).toFixed(3)))).toEqual([31.441, 44.907, 28.615])
    expect(runs[0].sectorsSec.map((value) => Number((value as number).toFixed(3)))).toEqual([31.482, 44.639, 28.456])
    expect(runs[1].totalSec).toBeCloseTo(104.963, 3)
    expect(runs[0].totalSec).toBeCloseTo(104.577, 3)
  })

  it('keeps each tyre corner independent and never mirrors one on to another', () => {
    const recorder = new Rc18RunRecorder()
    driveLaps(recorder, [
      lapPlan([30, 44, 28]),
      lapPlan([31, 44, 28], { base: { tyreC: { lf: 84, rf: 86, lr: 79, rr: null } } }),
      lapPlan([31, 44, 28])
    ])
    const run = recorder.laps()[0]
    expect(run.tyrePeakC.lf).toBe(84)
    expect(run.tyrePeakC.rf).toBe(86)
    expect(run.tyrePeakC.lr).toBe(79)
    // No sensor on that corner: it dashes, it does not inherit its neighbour or its axle mate.
    expect(run.tyrePeakC.rr).toBeNull()
  })

  it('requires BOTH corners of an axle before it prints a brake temperature', () => {
    expect(rc18AxlePeakC({ lf: 412, rf: 405, lr: 388, rr: 380 }, 'frt')).toBe(412)
    expect(rc18AxlePeakC({ lf: 412, rf: 405, lr: 388, rr: 380 }, 'rear')).toBe(388)
    expect(rc18AxlePeakC({ lf: 412, rf: 405, lr: 388, rr: null }, 'rear')).toBeNull()
    expect(rc18AxlePeakC({ lf: null, rf: null, lr: null, rr: null }, 'frt')).toBeNull()
  })

  it('holds the measured minimum speed of the lap, never an estimated apex', () => {
    const recorder = new Rc18RunRecorder()
    driveLaps(recorder, [
      lapPlan([30, 44, 28]),
      lapPlan([31, 44, 28], { base: { speedKmh: 182 }, extras: [{ speedKmh: 97 }, { speedKmh: 140 }] }),
      lapPlan([31, 44, 28])
    ])
    expect(recorder.laps()[0].minSpeedKmh).toBe(97)
  })

  it('refuses a delta to best without a real stored best lap', () => {
    const recorder = new Rc18RunRecorder()
    driveLaps(recorder, [
      lapPlan([30, 44, 28]),
      lapPlan([31, 44, 28], { base: { deltaToBestSec: 0.4, bestLapTimeSec: null } }),
      lapPlan([31, 44, 28])
    ])
    expect(recorder.laps()[0].deltaToBestSec).toBeNull()
  })

  it('closes the accumulator on every lap boundary, so an out-lap cannot bleed into a match', () => {
    const recorder = new Rc18RunRecorder()
    driveLaps(recorder, [
      // The out-lap is slow and cold and is never archived; its aggregates must not survive.
      lapPlan([30, 44, 28], { base: { speedKmh: 40, tyreC: { lf: 30, rf: 30, lr: 30, rr: 30 } } }),
      lapPlan([31, 44, 28], { base: { speedKmh: 182, tyreC: { lf: 84, rf: 86, lr: 79, rr: 81 } } }),
      lapPlan([31, 44, 28])
    ])
    const run = recorder.laps()[0]
    expect(run.minSpeedKmh).toBe(182)
    expect(run.tyrePeakC.lf).toBe(84)
  })

  it('discards every matched lap when the recorder is reset by a refused frame', () => {
    const recorder = referenceRecorder()
    expect(recorder.laps()).toHaveLength(2)
    recorder.reset()
    expect(recorder.laps()).toHaveLength(0)
    expect(recorder.hasTimingFeed()).toBe(false)
  })

  it('clones without sharing state, so a StrictMode double render cannot advance history', () => {
    const recorder = referenceRecorder()
    const clone = recorder.clone()
    driveLaps(clone, [lapPlan([32, 45, 29]), lapPlan([32, 45, 29])], 100_000)
    expect(recorder.laps()).toHaveLength(2)
    expect(clone.laps().length).toBeGreaterThan(2)
  })

  it('reports the timing feed stale once it stops arriving', () => {
    const recorder = referenceRecorder()
    const last = recorder.laps()[0].recordedAtMs
    expect(recorder.feedFresh(last)).toBe(true)
    expect(recorder.feedFresh(last + RC18_MATCH_FEED_STALE_MS + 400)).toBe(false)
  })
})

describe('RC-18 balance index is measured from steer, yaw and speed', () => {
  it('dashes below the minimum sample count', () => {
    const samples = Array.from({ length: RC18_BALANCE_MIN_SAMPLES - 1 }, (_, index) => ({
      gain: 1,
      speedKmh: 60 + index * 4
    }))
    expect(rc18BalanceIndexFromSamples(samples)).toBeNull()
  })

  it('dashes when the lap never spanned two speed regimes', () => {
    const samples = Array.from({ length: RC18_BALANCE_MIN_SAMPLES + 4 }, () => ({ gain: 1, speedKmh: 100 }))
    expect(rc18BalanceIndexFromSamples(samples)).toBeNull()
  })

  it('reads positive for understeer and negative for oversteer', () => {
    const build = (slow: number, fast: number): { gain: number; speedKmh: number }[] =>
      Array.from({ length: RC18_BALANCE_MIN_SAMPLES + 8 }, (_, index) => {
        const isSlow = index < (RC18_BALANCE_MIN_SAMPLES + 8) / 2
        return { gain: isSlow ? slow : fast, speedKmh: isSlow ? 60 : 140 }
      })
    expect(rc18BalanceIndexFromSamples(build(1, 0.58))).toBeCloseTo(0.42, 6)
    expect(rc18BalanceIndexFromSamples(build(1, 1.31))).toBeCloseTo(-0.31, 6)
    expect(rc18BalanceIndexFromSamples(build(1, 1))).toBeCloseTo(0, 9)
  })

  it('clamps the published range to [-1, 1]', () => {
    const samples = Array.from({ length: RC18_BALANCE_MIN_SAMPLES + 8 }, (_, index) => {
      const isSlow = index < (RC18_BALANCE_MIN_SAMPLES + 8) / 2
      return { gain: isSlow ? 1 : 40, speedKmh: isSlow ? 60 : 140 }
    })
    expect(rc18BalanceIndexFromSamples(samples)).toBe(-1)
  })

  it('measures the index end to end from the real steer, yaw and speed channels', () => {
    const recorder = referenceRecorder()
    const runs = recorder.laps()
    expect(runs[1].balanceIndex).toBeCloseTo(0.42, 2)
    expect(runs[0].balanceIndex).toBeCloseTo(0.31, 2)
    expect(runs[0].balanceSamples).toBeGreaterThanOrEqual(RC18_BALANCE_MIN_SAMPLES)
  })

  it('dashes the balance when the lap supplied no steer or yaw at all', () => {
    const recorder = new Rc18RunRecorder()
    driveLaps(recorder, [
      lapPlan([30, 44, 28]),
      lapPlan([31, 44, 28], { base: { steerAngleDeg: null, yawRateRadSec: null } }),
      lapPlan([31, 44, 28])
    ])
    expect(recorder.laps()[0].balanceIndex).toBeNull()
    const model = createRc18DashboardModel(recorder.laps())
    expect(model.stability.sourceLabel).toBe('NO SOURCE')
    expect(model.stability.a.value).toBe('--')
  })
})

describe('RC-18 verdict arithmetic (normative override NO-2)', () => {
  it('signs every sector delta as B minus A and points the arrow at the faster side', () => {
    const runs = referenceRecorder().laps()
    const deltas = rc18SectorDeltas(runs[1], runs[0])
    expect(deltas[0]).toBeCloseTo(0.041, 3)
    expect(deltas[1]).toBeCloseTo(-0.268, 3)
    expect(deltas[2]).toBeCloseTo(-0.159, 3)
    expect(rc18FasterSide(deltas[0] as number)).toBe('a')
    expect(rc18FasterSide(deltas[1] as number)).toBe('b')
    expect(rc18FasterSide(null)).toBeNull()
    expect(rc18FasterSide(0)).toBeNull()
  })

  it('agrees on all three routes, exactly as the approved reference frame does', () => {
    const runs = referenceRecorder().laps()
    const a = runs[1]
    const b = runs[0]
    const sum = rc18SectorDeltas(a, b).reduce((total, value) => (total as number) + (value as number), 0) as number
    expect((b.totalSec as number) - (a.totalSec as number)).toBeCloseTo(-0.386, 3)
    expect(sum).toBeCloseTo(-0.386, 3)
    expect((b.deltaToBestSec as number) - (a.deltaToBestSec as number)).toBeCloseTo(-0.386, 3)
  })

  it('computes the bar length arithmetically and clamps it at full scale', () => {
    expect(rc18BarLengthPct(0)).toBe(0)
    expect(rc18BarLengthPct(null)).toBe(0)
    expect(rc18BarLengthPct(RC18_SPINE_FULL_SCALE_SEC)).toBeCloseTo(RC18_SPINE_HALF_SPAN_PCT, 9)
    expect(rc18BarLengthPct(-RC18_SPINE_FULL_SCALE_SEC * 10)).toBeCloseTo(RC18_SPINE_HALF_SPAN_PCT, 9)
    expect(rc18BarLengthPct(0.16)).toBeCloseTo(RC18_SPINE_HALF_SPAN_PCT / 2, 9)
    // The reference drew the below-threshold S1 mark 2.2x too long. 0.041 s is 12.8 % of scale.
    expect(rc18BarLengthPct(0.041) / RC18_SPINE_HALF_SPAN_PCT).toBeCloseTo(0.128125, 6)
  })

  it('gives each verdict row a bar that agrees with its own numeral', () => {
    const model = createRc18DashboardModel(referenceRecorder().laps())
    for (const verdict of model.verdicts) {
      expect(verdict.lengthPct).toBeCloseTo(rc18BarLengthPct(verdict.deltaSec), 9)
      expect(verdict.lengthPct).toBeLessThanOrEqual(RC18_SPINE_HALF_SPAN_PCT + 1e-9)
    }
    expect(model.verdicts.map((verdict) => verdict.label)).toEqual([...RC18_SECTOR_LABELS])
  })

  it('states the overall verdict as a sentence and names the faster setup', () => {
    const model = createRc18DashboardModel(referenceRecorder().laps())
    expect(model.summary.fasterSide).toBe('b')
    expect(model.summary.text).toBe('SETUP B FASTER BY 0.386 S')
    expect(model.summary.unavailable).toBe(false)
  })
})

describe('RC-18 trigger-only alerts', () => {
  it('starts silent and stays silent on a below-threshold gap', () => {
    const state = createRc18AlertState()
    expect(rc18AlertLines(rc18AlertFlags(state))).toEqual([])
    const next = advanceRc18Alerts(state, alertInput({ sectorDeltas: [0.041, 0.02, -0.049] }))
    expect(rc18AlertFlags(next).sectorGap).toEqual([false, false, false])
    expect(rc18AlertLines(rc18AlertFlags(next))).toEqual([])
  })

  it('engages a sector gap only above the published 0.050 s noise threshold', () => {
    let state = createRc18AlertState()
    state = advanceRc18Alerts(state, alertInput({ sectorDeltas: [0.041, RC18_SECTOR_NOISE_SEC, -0.268] }))
    expect(rc18AlertFlags(state).sectorGap).toEqual([false, false, true])
    expect(rc18AlertLines(rc18AlertFlags(state))).toEqual(['sector-gap:S3'])
  })

  it('holds a fired gap for the minimum visible window before it can be released', () => {
    let state = advanceRc18Alerts(createRc18AlertState(), alertInput({ nowMs: 0, sectorDeltas: [0.268, 0, 0] }))
    expect(state.sectorGap[0].active).toBe(true)
    // Inside the hold, a collapse to zero cannot blank the highlight mid-read.
    state = advanceRc18Alerts(state, alertInput({ nowMs: RC18_ALERT_MIN_VISIBLE_MS - 1, sectorDeltas: [0, 0, 0] }))
    expect(state.sectorGap[0].active).toBe(true)
    state = advanceRc18Alerts(state, alertInput({ nowMs: RC18_ALERT_MIN_VISIBLE_MS, sectorDeltas: [0, 0, 0] }))
    expect(state.sectorGap[0].active).toBe(false)
  })

  it('releases only below the hysteresis floor, so a gap on the threshold cannot chatter', () => {
    let state = advanceRc18Alerts(createRc18AlertState(), alertInput({ nowMs: 0, sectorDeltas: [0.268, 0, 0] }))
    const later = RC18_ALERT_MIN_VISIBLE_MS + 10
    // Still inside the band: held.
    state = advanceRc18Alerts(state, alertInput({ nowMs: later, sectorDeltas: [RC18_SECTOR_NOISE_SEC, 0, 0] }))
    expect(state.sectorGap[0].active).toBe(true)
    state = advanceRc18Alerts(
      state,
      alertInput({ nowMs: later, sectorDeltas: [RC18_SECTOR_NOISE_SEC - RC18_SECTOR_NOISE_HYSTERESIS_SEC, 0, 0] })
    )
    expect(state.sectorGap[0].active).toBe(false)
  })

  it('unlatches immediately when a compared sector stops being comparable', () => {
    let state = advanceRc18Alerts(createRc18AlertState(), alertInput({ nowMs: 0, sectorDeltas: [0.268, 0, 0] }))
    expect(state.sectorGap[0].active).toBe(true)
    state = advanceRc18Alerts(state, alertInput({ nowMs: 10, sectorDeltas: [null, 0, 0] }))
    expect(state.sectorGap[0].active).toBe(false)
    expect(state.sectorGap[0].minimumVisibleUntilMs).toBe(0)
  })

  it('goes fully silent the moment the matched pair disappears', () => {
    let state = advanceRc18Alerts(
      createRc18AlertState(),
      alertInput({ sectorDeltas: [0.268, -0.4, 0.5], balanceDelta: 0.9, incomparableKeys: ['brakeRear'] })
    )
    expect(rc18AlertLines(rc18AlertFlags(state)).length).toBeGreaterThan(0)
    state = advanceRc18Alerts(state, alertInput({ pairAvailable: false }))
    expect(rc18AlertLines(rc18AlertFlags(state))).toEqual([])
    expect(rc18AlertLines(rc18AlertFlags(clearInvalidRc18Alerts(state, false)))).toEqual([])
  })

  it('binds the stability alert to the balance index band, matching the approved frame', () => {
    // 0.42 vs 0.31 is 0.11, inside the 0.15 band: the approved frame is SILENT here.
    let state = advanceRc18Alerts(createRc18AlertState(), alertInput({ balanceDelta: -0.11 }))
    expect(state.stability.active).toBe(false)
    state = advanceRc18Alerts(state, alertInput({ balanceDelta: RC18_BALANCE_BAND + 0.01 }))
    expect(state.stability.active).toBe(true)
    state = advanceRc18Alerts(
      state,
      alertInput({ nowMs: RC18_ALERT_MIN_VISIBLE_MS + 1, balanceDelta: RC18_BALANCE_BAND - RC18_BALANCE_BAND_HYSTERESIS })
    )
    expect(state.stability.active).toBe(false)
  })

  it('marks a real channel gap INCOMPARABLE without any debounce and clears it on valid data', () => {
    let state = advanceRc18Alerts(createRc18AlertState(), alertInput({ incomparableKeys: ['brakeRear'] }))
    expect(rc18AlertFlags(state).incomparable).toBe(true)
    expect(rc18AlertLines(rc18AlertFlags(state))).toContain('incomparable:brakeRear')
    state = advanceRc18Alerts(state, alertInput({ incomparableKeys: [] }))
    expect(rc18AlertFlags(state).incomparable).toBe(false)
  })

  it('fires exactly the alert set the approved reference frame fired', () => {
    const runs = referenceRecorder().laps()
    const provisional = createRc18DashboardModel(runs)
    const state = advanceRc18Alerts(createRc18AlertState(), rc18AlertInputForModel(provisional, 0))
    const model = createRc18DashboardModel(runs, 0, { alerts: state })
    // S1 0.041 s is BELOW the threshold and must render muted, not highlighted.
    expect(model.verdicts[0].highlighted).toBe(false)
    expect(model.verdicts[0].muted).toBe(true)
    expect(model.verdicts[1].highlighted).toBe(true)
    expect(model.verdicts[2].highlighted).toBe(true)
    expect(model.alerts.stability).toBe(false)
    expect(model.alerts.incomparable).toBe(true)
    expect(model.incomparableKeys).toEqual(['brakeRear'])
  })
})

describe('RC-18 telemetry truth table', () => {
  it('renders the whole structure and no numbers at all without a matched pair', () => {
    const model = createRc18DashboardModel([])
    expect(model.pairAvailable).toBe(false)
    expect(model.summary.text).toBe('NO MATCHED PAIR')
    expect(model.summary.unavailable).toBe(true)
    expect(model.feed).toBe('none')
    for (const pair of model.pairs) {
      expect(pair.a.unavailable).toBe(true)
      expect(pair.b.unavailable).toBe(true)
      expect(pair.incomparable).toBe(true)
      expect(['--', '--.---']).toContain(pair.a.value)
    }
    for (const verdict of model.verdicts) {
      expect(verdict.value).toBe('--.---')
      expect(verdict.lengthPct).toBe(0)
      expect(verdict.highlighted).toBe(false)
      expect(verdict.fasterSide).toBeNull()
    }
    expect(model.trace.available).toBe(false)
  })

  it('tags the PAIR incomparable, so the healthy side never reads as an answer', () => {
    const model = createRc18DashboardModel(referenceRecorder().laps())
    const brakeRear = model.pairs.find((pair) => pair.key === 'brakeRear')
    expect(brakeRear?.incomparable).toBe(true)
    // Setup A genuinely measured its rear axle, so its real value stands; setup B has no rear
    // sensor and dashes. B never borrows A's 388 and never copies its own front axle's 405.
    expect(brakeRear?.a.value).toBe('388')
    expect(brakeRear?.b.value).toBe('--')
    expect(brakeRear?.b.unavailable).toBe(true)
    const brakeFront = model.pairs.find((pair) => pair.key === 'brakeFrt')
    expect(brakeFront?.incomparable).toBe(false)
    expect(brakeFront?.a.value).toBe('412')
    expect(brakeFront?.b.value).toBe('405')
  })

  it('carries the INCOMPARABLE tag on BOTH sides of the mirror, never on one', () => {
    const html = markup(null, nativeConfig)
    for (const side of ['a', 'b'] as const) {
      const pattern = new RegExp(
        `data-rc18-row="sector1" data-rc18-rung="timing" data-rc18-side="${side}" data-rc18-incomparable="true"`
      )
      expect(html).toMatch(pattern)
    }
    expect([...html.matchAll(/INCOMPARABLE/g)].length).toBeGreaterThanOrEqual(2)
  })

  it('degrades a stale comparison visibly instead of freezing it', () => {
    const runs = referenceRecorder().laps()
    const fresh = createRc18DashboardModel(runs, 0, { feedFresh: true, hasTimingFeed: true })
    const stale = createRc18DashboardModel(runs, 0, { feedFresh: false, hasTimingFeed: true })
    expect(fresh.feed).toBe('live')
    expect(stale.feed).toBe('stale')
    const staleSector = stale.pairs.find((pair) => pair.key === 'sector1')
    expect(staleSector?.a.stale).toBe(true)
    expect(staleSector?.a.tone).toBe('muted')
    expect(fresh.pairs.find((pair) => pair.key === 'sector1')?.a.stale).toBe(false)
  })

  it('never renders an RPM, LED, shift or gear element anywhere', () => {
    const html = `${markup(snapshot(), nativeConfig)}${markup(snapshot(), config)}`
    for (const forbidden of ['rpm', 'RPM', 'led', 'LED', 'shift', 'SHIFT', 'GEAR']) {
      expect(html).not.toContain(forbidden)
    }
  })

  it('renders no speed readout at all on the 800x480 canvas', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html).not.toContain('rc18-trace')
    expect(html).not.toContain('A / B SPEED')
    // Min corner speed is a MEASURED per-lap minimum, not the live speed channel.
    expect(html).toContain('MIN SPD')
  })

  it('documents every contradiction it deliberately does not render', () => {
    expect(Object.keys(RC18_PACKET_OMISSIONS).sort()).toEqual([
      'alertNumerics',
      'appStabilityZone',
      'balanceRangeConvention',
      'bestLapAndFuelZone',
      'brakeAxleAggregation',
      'configurationIdentityChannel',
      'deltaToBestLapTrigger',
      'deltaToBestZone',
      'matchLapControlZone',
      'perCornerDifferenceTable',
      'rpmComparisonRow',
      'sectorSplitChannel',
      'speedNativeZone',
      'stabilityMinSpeedBinding',
      'stabilityZoneOverlap',
      'tyreWindowSampling'
    ])
    for (const reason of Object.values(RC18_PACKET_OMISSIONS)) {
      expect(typeof reason).toBe('string')
      expect(reason.length).toBeGreaterThan(40)
    }
    expect(RC18_PACKET_OMISSIONS.rpmComparisonRow).toContain('11.4')
    expect(RC18_PACKET_OMISSIONS.configurationIdentityChannel).toContain('LOCKED')
    expect(RC18_PACKET_OMISSIONS.speedNativeZone).toContain('G9')
  })

  it('never publishes best lap or fuel per lap, which have no zone on either canvas', () => {
    const html = `${markup(snapshot(), nativeConfig)}${markup(snapshot(), config)}`
    expect(html).not.toContain('BEST')
    expect(html).not.toContain('FUEL')
    const model = createRc18DashboardModel(referenceRecorder().laps())
    expect(model.pairs.map((pair) => pair.key)).not.toContain('bestLap')
    expect(model.pairs.map((pair) => pair.key)).not.toContain('fuelPerLap')
  })
})

describe('RC-18 baseline selection', () => {
  it('compares the oldest held lap against the newest until a baseline is locked', () => {
    const runs = referenceRecorder().laps()
    const auto = rc18SelectPair(runs, null)
    expect(auto.a?.lapOrdinal).toBe(runs[runs.length - 1].lapOrdinal)
    expect(auto.b?.lapOrdinal).toBe(runs[0].lapOrdinal)
    expect(auto.locked).toBe(false)
  })

  it('pins setup A to a locked lap and drops the lock if that lap ages out', () => {
    const runs = referenceRecorder().laps()
    const locked = rc18SelectPair(runs, runs[0].lapOrdinal)
    expect(locked.locked).toBe(true)
    expect(locked.a?.lapOrdinal).toBe(runs[0].lapOrdinal)
    expect(locked.b?.lapOrdinal).not.toBe(runs[0].lapOrdinal)
    const stale = rc18SelectPair(runs, 9_999)
    expect(stale.locked).toBe(false)
  })

  it('has no pair at all with a single matched lap', () => {
    const runs = referenceRecorder().laps().slice(0, 1) as readonly Rc18Run[]
    const pair = rc18SelectPair(runs, null)
    expect(pair.a).not.toBeNull()
    expect(pair.b).toBeNull()
    expect(createRc18DashboardModel(runs).pairAvailable).toBe(false)
  })

  it('accepts only the three published baseline commands', () => {
    expect(rc18BaselineCommandFromEvent('lock')).toBe('lock')
    expect(rc18BaselineCommandFromEvent('release')).toBe('release')
    expect(rc18BaselineCommandFromEvent({ command: 'match' })).toBe('match')
    expect(rc18BaselineCommandFromEvent('wipe')).toBeNull()
    expect(rc18BaselineCommandFromEvent(undefined)).toBeNull()
    expect(rc18BaselineCommandFromEvent({ command: 42 })).toBeNull()
  })
})

describe('RC-18 responsive contract', () => {
  it('reflows by dropping modules on a phone, never by scaling the 800x480 frame down', () => {
    const full = rc18RowsForLayout('native', 'standard')
    const app = rc18RowsForLayout('app', 'standard')
    const landscape = rc18RowsForLayout('compact', 'landscape')
    const phone = rc18RowsForLayout('compact', 'phone')
    expect(full).toEqual(app)
    expect(landscape).toEqual(full)
    expect(phone.length).toBeLessThan(full.length)
    expect(phone).not.toContain('tyreLf')
    expect(phone).not.toContain('brakeFrt')
    // The primary comparison survives every breakpoint.
    for (const key of ['deltaToBest', 'sector1', 'sector2', 'sector3', 'minSpeed'] as const) {
      expect(phone).toContain(key)
    }
  })

  it('carries every alert on a surface that survives the phone reflow', () => {
    const runs = referenceRecorder().laps()
    const provisional = createRc18DashboardModel(runs, 0, { rows: rc18RowsForLayout('compact', 'phone') })
    const state = advanceRc18Alerts(createRc18AlertState(), rc18AlertInputForModel(provisional, 0))
    const model = createRc18DashboardModel(runs, 0, { rows: rc18RowsForLayout('compact', 'phone'), alerts: state })
    // The brake row is gone at this breakpoint, so its alert must be carried by the header chip.
    expect(model.pairs.map((pair) => pair.key)).not.toContain('brakeRear')
    expect(rc18AlertLines(model.alerts).some((line) => line.startsWith('sector-gap'))).toBe(true)
  })

  it('reveals the A/B speed trace on the app canvas only', () => {
    const runs = referenceRecorder().laps()
    expect(createRc18DashboardModel(runs, 0, { includeTrace: false }).trace.available).toBe(false)
    const app = createRc18DashboardModel(runs, 0, { includeTrace: true })
    expect(app.trace.available).toBe(true)
    expect(app.trace.points.a.length).toBeGreaterThan(0)
    expect(app.trace.points.b.length).toBeGreaterThan(0)
    for (const [x, y] of [...app.trace.points.a, ...app.trace.points.b]) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(1)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(1)
    }
  })

  it('leaves gaps in the trace instead of interpolating across unsampled lap distance', () => {
    const runs = referenceRecorder().laps()
    const app = createRc18DashboardModel(runs, 0, { includeTrace: true })
    // The laps were driven with a handful of samples, so most distance bins have no data at all.
    expect(app.trace.points.a.length).toBeLessThan(96)
  })
})

describe('RC-18 rendering', () => {
  it('publishes the full DOM contract on the root element', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('data-widget="raceconRc18Dash"')
    expect(html).toContain('data-rc18-layout="native"')
    expect(html).toContain('data-rc18-pair="unavailable"')
    expect(html).toContain('data-rc18-alerts="silent"')
    expect(html).toContain('data-rc18-mirror-axis-pct="50"')
    expect(html).toContain('data-rc18-half-span-pct="45.2381"')
    expect(html).toContain('data-rc18-native-size="800x480"')
    assertClean(html)
  })

  it('renders a dash-only frame with no telemetry at all', () => {
    const html = markup(null, nativeConfig)
    expect(html).toContain('NO MATCHED PAIR')
    expect(html).toContain('--.---')
    expect(html).toContain('data-rc18-feed="none"')
    expect(html).not.toContain('rc18-alert-chip')
    assertClean(html)
  })

  it('never renders the alert chip while the alert layer is silent', () => {
    expect(markup(snapshot(), nativeConfig)).not.toContain('rc18-summary-alert')
    expect(markup(null, config)).not.toContain('rc18-summary-alert')
  })

  it('renders three delta rows on one shared datum with the packet arithmetic attached', () => {
    const html = markup(snapshot(), nativeConfig)
    for (const label of RC18_SECTOR_LABELS) {
      expect(html).toContain(`data-rc18-sector="${label}"`)
      expect(html).toContain(`data-testid="rc18-datum-${label}"`)
      expect(html).toContain('data-rc18-length-pct="0.0000"')
    }
    expect([...html.matchAll(/class="rc18-delta-datum"/g)]).toHaveLength(3)
  })

  it('renders the app canvas with the trace section and the native canvas without it', () => {
    expect(markup(snapshot(), config)).toContain('data-rc18-zone="trace"')
    expect(markup(snapshot(), nativeConfig)).not.toContain('data-rc18-zone="trace"')
  })

  it('names every value for a screen reader on both sides of the mirror', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('aria-label="SETUP A S1 unavailable"')
    expect(html).toContain('aria-label="SETUP B S1 unavailable"')
    expect(html).toContain('RaceCon RC-18 split test, setup A versus setup B practice comparison')
  })
})

describe('RC-18 shares the RC-01 fail-closed ingest buffer', () => {
  it('refuses mock and replay telemetry and raises no alert from it', () => {
    const mock = markup(snapshot({ sim: 'mock' } as Partial<TelemetrySnapshot>), nativeConfig)
    expect(mock).toContain('data-rc18-buffer-state="mock-telemetry"')
    expect(mock).toContain('data-rc18-pair="unavailable"')
    expect(mock).toContain('data-rc18-alerts="silent"')

    const replay = markup(
      snapshot({ replayContext: { state: 'replay' } } as Partial<TelemetrySnapshot>),
      nativeConfig
    )
    expect(replay).toContain('data-rc18-buffer-state="replay-telemetry"')
    expect(replay).toContain('data-rc18-pair="unavailable"')
    expect(replay).toContain('data-rc18-alerts="silent"')
  })

  it('refuses a disconnected source and a source with no identity', () => {
    expect(markup(snapshot({ connected: false }), nativeConfig)).toContain('data-rc18-buffer-state="disconnected"')
    expect(markup(snapshot({ sessionUniqueId: undefined }), nativeConfig)).toContain(
      'data-rc18-buffer-state="missing-source-identity"'
    )
  })

  it('discards every matched lap when the live source changes underneath it', () => {
    let clockMs = 0
    const clock = (): number => clockMs
    const view = render(
      createElement(RaceconRc18DashWidget, {
        snapshot: snapshot({ lapDistPct: 0, currentLapTimeSec: 0 }, 1_000),
        config: nativeConfig,
        monotonicClock: clock
      })
    )
    const drive = (lapDistPct: number, currentLapTimeSec: number, timestamp: number, extra: Partial<TelemetrySnapshot> = {}): void => {
      clockMs += 50
      view.rerender(
        createElement(RaceconRc18DashWidget, {
          snapshot: snapshot({ lapDistPct, currentLapTimeSec, ...extra }, timestamp),
          config: nativeConfig,
          monotonicClock: clock
        })
      )
    }
    let timestamp = 1_000
    for (let lap = 0; lap < 4; lap += 1) {
      for (const [pct, time] of [
        [0, 0],
        [1 / 3, 31],
        [2 / 3, 76],
        [0.99, 104]
      ] as const) {
        timestamp += 100
        drive(pct, time, timestamp)
      }
    }
    expect(view.container.querySelector('[data-rc18-pair]')?.getAttribute('data-rc18-pair')).toBe('matched')

    timestamp += 100
    drive(0, 0, timestamp, { sessionUniqueId: 99 })
    const root = view.container.querySelector('[data-rc18-pair]')
    expect(root?.getAttribute('data-rc18-buffer-state')).toBe('source-discontinuity')
    expect(root?.getAttribute('data-rc18-pair')).toBe('unavailable')
  })
})

describe('RC-18 display clock', () => {
  function mountWithClock(preview: 'inert' | undefined): {
    root: () => Element | null
    advance: (toMs: number) => void
  } {
    let clockMs = 0
    const clock = (): number => clockMs
    const view = render(
      createElement(RaceconRc18DashWidget, {
        snapshot: snapshot({ lapDistPct: 0.2, currentLapTimeSec: 12 }),
        config: nativeConfig,
        preview,
        monotonicClock: clock
      })
    )
    return {
      root: () => view.container.querySelector('[data-rc18-feed]'),
      advance: (toMs: number) => {
        act(() => {
          clockMs = toMs
          vi.advanceTimersByTime(RACECON_DISPLAY_CLOCK_INTERVAL_MS * 4)
        })
      }
    }
  }

  it('ages the feed on a live render', () => {
    vi.useFakeTimers()
    const live = mountWithClock(undefined)
    expect(live.root()?.getAttribute('data-rc18-feed')).toBe('live')
    live.advance(RC18_MATCH_FEED_STALE_MS * 4)
    expect(live.root()?.getAttribute('data-rc18-feed')).toBe('stale')
  })

  it('freezes an inert preview, so a static frame cannot walk past its own thresholds', () => {
    vi.useFakeTimers()
    const preview = mountWithClock('inert')
    expect(preview.root()?.getAttribute('data-rc18-feed')).toBe('live')
    preview.advance(RC18_MATCH_FEED_STALE_MS * 4)
    // No interval was ever installed, so the frame is byte-identical after four intervals.
    expect(preview.root()?.getAttribute('data-rc18-feed')).toBe('live')
  })

  it('leaves the rendered text of an inert preview unchanged', () => {
    vi.useFakeTimers()
    let clockMs = 0
    const clock = (): number => clockMs
    const view = render(
      createElement(RaceconRc18DashWidget, {
        snapshot: snapshot(),
        config: nativeConfig,
        preview: 'inert',
        monotonicClock: clock
      })
    )
    const before = view.container.innerHTML
    act(() => {
      clockMs = 60_000
      vi.advanceTimersByTime(10_000)
    })
    expect(view.container.innerHTML).toBe(before)
  })
})

describe('RC-18 corner channel coverage', () => {
  it('knows exactly four independent corners and never derives one from another', () => {
    expect([...RC18_CORNERS]).toEqual(['lf', 'rf', 'lr', 'rr'])
    const recorder = new Rc18RunRecorder()
    driveLaps(recorder, [
      lapPlan([30, 44, 28]),
      lapPlan([31, 44, 28], { base: { tyreC: { lf: 84, rf: null, lr: null, rr: null } } }),
      lapPlan([31, 44, 28])
    ])
    const peaks = recorder.laps()[0].tyrePeakC
    expect(peaks.lf).toBe(84)
    expect([peaks.rf, peaks.lr, peaks.rr]).toEqual([null, null, null])
    const model = createRc18DashboardModel(recorder.laps())
    expect(model.pairs.find((pair) => pair.key === 'tyreRf')?.incomparable).toBe(true)
  })
})
