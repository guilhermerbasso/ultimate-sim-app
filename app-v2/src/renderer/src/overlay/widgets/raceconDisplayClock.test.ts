// @vitest-environment jsdom
import { createElement, type FunctionComponent } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOverlayStyle, type OverlayWidgetConfig, type OverlayWidgetId } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import type { WidgetProps } from './types'
import type { Rc01MonotonicClock } from './raceconRc01Core'
import { RACECON_DISPLAY_CLOCK_INTERVAL_MS, raceconDisplayClockFrozen } from './raceconDisplayClock'
import { RaceconRc01DashWidget } from './RaceconRc01DashWidget'
import { RaceconRc02DashWidget } from './RaceconRc02DashWidget'
import { RaceconRc03DashWidget } from './RaceconRc03DashWidget'
import { RaceconRc04DashWidget } from './RaceconRc04DashWidget'
import { RaceconRc05DashWidget } from './RaceconRc05DashWidget'
import { RaceconRc06DashWidget } from './RaceconRc06DashWidget'
import { RaceconRc07DashWidget } from './RaceconRc07DashWidget'
import { RaceconRc08DashWidget } from './RaceconRc08DashWidget'
import { RaceconRc09DashWidget } from './RaceconRc09DashWidget'
import { RaceconRc10DashWidget } from './RaceconRc10DashWidget'
import { RaceconRc11DashWidget } from './RaceconRc11DashWidget'
import { RaceconRc12DashWidget } from './RaceconRc12DashWidget'
import { RaceconRc13DashWidget } from './RaceconRc13DashWidget'
import { RaceconRc14DashWidget } from './RaceconRc14DashWidget'
import { RaceconRc15DashWidget } from './RaceconRc15DashWidget'
import { RaceconRc16DashWidget } from './RaceconRc16DashWidget'
import { RaceconRc17DashWidget } from './RaceconRc17DashWidget'
import { RaceconRc18DashWidget } from './RaceconRc18DashWidget'
import { RaceconRc19DashWidget } from './RaceconRc19DashWidget'
import { RaceconRc20DashWidget } from './RaceconRc20DashWidget'
import { WIDGET_COMPONENTS } from './index'
import { RC06_FUEL_MODEL_ENGAGE_MS } from './raceconRc06Core'

type RaceconDashWidget = FunctionComponent<WidgetProps & { monotonicClock?: Rc01MonotonicClock }>

const RACECON_WIDGETS: ReadonlyArray<readonly [OverlayWidgetId, RaceconDashWidget]> = [
  ['raceconRc01Dash', RaceconRc01DashWidget],
  ['raceconRc02Dash', RaceconRc02DashWidget],
  ['raceconRc03Dash', RaceconRc03DashWidget],
  ['raceconRc04Dash', RaceconRc04DashWidget],
  ['raceconRc05Dash', RaceconRc05DashWidget],
  ['raceconRc06Dash', RaceconRc06DashWidget],
  ['raceconRc07Dash', RaceconRc07DashWidget],
  ['raceconRc08Dash', RaceconRc08DashWidget],
  ['raceconRc09Dash', RaceconRc09DashWidget],
  ['raceconRc10Dash', RaceconRc10DashWidget],
  ['raceconRc11Dash', RaceconRc11DashWidget],
  ['raceconRc12Dash', RaceconRc12DashWidget],
  ['raceconRc13Dash', RaceconRc13DashWidget],
  ['raceconRc14Dash', RaceconRc14DashWidget],
  ['raceconRc15Dash', RaceconRc15DashWidget],
  ['raceconRc16Dash', RaceconRc16DashWidget],
  ['raceconRc17Dash', RaceconRc17DashWidget],
  ['raceconRc18Dash', RaceconRc18DashWidget],
  ['raceconRc19Dash', RaceconRc19DashWidget],
  ['raceconRc20Dash', RaceconRc20DashWidget]
]

/** Every RaceCon dashboard actually wired into the renderer, straight from the registry. */
const RACECON_ID_PATTERN = /^raceconRc\d+Dash$/

/**
 * Comfortably past every time gate the family owns: RC-06's fuel-model engagement, and the
 * per-channel staleness budgets that flip RC-07's race-control flag and roll RC-08's timeline.
 */
const PAST_EVERY_THRESHOLD_MS = 30_000

function config(id: OverlayWidgetId): OverlayWidgetConfig {
  return {
    id,
    enabled: true,
    locked: true,
    favorite: false,
    position: { x: 0, y: 0, width: 1024, height: 600 },
    opacity: 100,
    stylePreset: 'minimal',
    style: createDefaultOverlayStyle(),
    display: null
  }
}

function snapshot(): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 4_270_000,
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
    lastLapTimeSec: 113.2,
    position: 4,
    waterTempC: 88,
    oilTempC: 104,
    fuelLiters: 38.4,
    fuelPerLapLiters: 2.65,
    fuelLapsRemaining: 14.49,
    // RC-15's chassis-balance index is only published while steering, yaw rate and the lateral-G
    // cornering gate are all present and fresh, and its brake pans need real per-corner brake
    // temperatures. Without them RC-15 renders every field dashed and has no time gate at all,
    // which would make the live half of this suite vacuous for it. Every other RaceCon page that
    // does not read these channels ignores them.
    steerAngleDeg: 38,
    latAccelG: 1.32,
    longAccelG: -0.4,
    yawRateRadSec: 0.18,
    brakeBiasPct: 56.4,
    brakeTempC: { lf: 430, rf: 426, lr: 393, rr: 389 },
    // RC-18 compares archived practice laps: with no lap-distance or lap-clock channel its
    // recorder never takes a sample, the page publishes NO MATCHED PAIR with feed 'none' and it
    // too has no time gate at all. One live sample is enough — the match feed goes stale at
    // RC18_MATCH_FEED_STALE_MS, so the frame genuinely ages.
    lapDistPct: 0.42,
    currentLapTimeSec: 47.35,
    // A timing/scoring feed, so the family's audience-facing pages have a frame to age too.
    // RC-12 is driven entirely by the standings feed and its 1 s freshness budget: without one it
    // publishes NO TIMING SOURCE and has no time gate at all, which would make the live half of
    // this suite vacuous for it. Every other RaceCon page ignores these fields.
    playerCarIdx: 4,
    drivers: Array.from({ length: 8 }, (_unused, index) => ({
      carIdx: index + 1,
      name: `Entrant ${index + 1}`,
      carNumber: String(index + 1),
      position: index + 1,
      classPosition: index + 1,
      classId: 1,
      isPlayer: index + 1 === 4,
      lastLapTimeSec: 113.2 + index * 0.184,
      bestLapTimeSec: 112.418 + index * 0.15
    })),
    relatives: {
      ahead: { carIdx: 3, name: 'Entrant 3', carNumber: '3', position: 3, gapSec: 1.2, lastLapTimeSec: 113.568 },
      behind: { carIdx: 5, name: 'Entrant 5', carNumber: '5', position: 5, gapSec: -0.9, lastLapTimeSec: 113.936 }
    }
  } as TelemetrySnapshot
}

/**
 * Mounts a widget on a controllable monotonic clock and steps wall time and that clock together,
 * exactly as a real render observes them: the display interval fires several times per step and
 * re-reads the clock, so the widget sees elapsed time rather than a single unexplained jump.
 *
 * The observation is the widget's full markup, not just its `textContent`. RC-18 encodes its
 * match-feed freshness as `data-rc18-feed` and an `is-stale` class rather than as printed text, so
 * a text-only observation would report "no change" for a page that visibly went stale. Comparing
 * markup is strictly stronger in both directions: the inert render must still be byte-identical.
 */
function mount(Widget: RaceconDashWidget, id: OverlayWidgetId, preview: WidgetProps['preview']): {
  markup: () => string
  advance: (ms: number) => void
} {
  vi.useFakeTimers()
  let monotonicMs = 0
  const monotonicClock: Rc01MonotonicClock = () => monotonicMs
  const view = render(
    createElement(Widget, { snapshot: snapshot(), config: config(id), preview, monotonicClock })
  )
  const step = RACECON_DISPLAY_CLOCK_INTERVAL_MS * 5
  const advance = (ms: number): void => {
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
      act(() => {
        monotonicMs += step
        vi.advanceTimersByTime(step)
      })
    }
  }
  return { markup: () => view.container.innerHTML, advance }
}

describe('RaceCon display clock freeze policy', () => {
  it('ticks only for a live render and freezes for every preview mode', () => {
    expect(raceconDisplayClockFrozen(undefined)).toBe(false)
    expect(raceconDisplayClockFrozen('inert')).toBe(true)
  })

  /**
   * The freeze guarantee below is only worth as much as this enumeration. A new RaceCon
   * dashboard that ships with the same unconditional interval would otherwise sit outside the
   * loop and reintroduce the exact inert-preview text diff this suite exists to catch, while
   * the suite stayed green. The family is therefore taken from the renderer registry rather
   * than from a hand-maintained list that can silently stop at the last widget someone
   * remembered, and every registered id must be covered here.
   */
  it('covers every RaceCon dashboard registered in the renderer', () => {
    const registered = Object.keys(WIDGET_COMPONENTS).filter((id) => RACECON_ID_PATTERN.test(id)).sort()
    const covered = RACECON_WIDGETS.map(([id]) => id as string).sort()
    expect(registered.length).toBeGreaterThan(0)
    expect(covered).toEqual(registered)
    for (const [id, Widget] of RACECON_WIDGETS) {
      expect(WIDGET_COMPONENTS[id], `${id} must be the component the renderer actually mounts`).toBe(Widget)
    }
  })
})

/**
 * A dashboard preview receives one snapshot at mount and is never fed again. A running display
 * clock would age that single frame past its own thresholds — RC-06 engages its fuel model at
 * RC06_FUEL_MODEL_ENGAGE_MS, RC-07 flips to NO SIGNAL and RC-08 rolls its window on the channel
 * staleness budgets — and mutate the rendered text with no new data behind it. That is the exact
 * non-determinism the inert gallery preview suite observes as a text diff at zero IPC.
 */
describe('RaceCon inert previews hold a static frame', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('never advances an inert preview past a time gate', () => {
    expect(PAST_EVERY_THRESHOLD_MS).toBeGreaterThan(RC06_FUEL_MODEL_ENGAGE_MS)
    for (const [id, Widget] of RACECON_WIDGETS) {
      const { markup, advance } = mount(Widget, id, 'inert')
      const mounted = markup()
      advance(PAST_EVERY_THRESHOLD_MS)
      expect(markup(), `${id} inert preview render must be byte-identical after 30s`).toBe(mounted)
      cleanup()
    }
  }, 30_000)

  it('keeps the live display clock ticking so a real dashboard still ages its frame', () => {
    for (const [id, Widget] of RACECON_WIDGETS) {
      const { markup, advance } = mount(Widget, id, undefined)
      const mounted = markup()
      advance(PAST_EVERY_THRESHOLD_MS)
      expect(markup(), `${id} live render must still age its frame`).not.toBe(mounted)
      cleanup()
    }
  }, 30_000)
})
