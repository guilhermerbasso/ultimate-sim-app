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
  ['raceconRc11Dash', RaceconRc11DashWidget]
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
    fuelLapsRemaining: 14.49
  } as TelemetrySnapshot
}

/**
 * Mounts a widget on a controllable monotonic clock and steps wall time and that clock together,
 * exactly as a real render observes them: the display interval fires several times per step and
 * re-reads the clock, so the widget sees elapsed time rather than a single unexplained jump.
 */
function mount(Widget: RaceconDashWidget, id: OverlayWidgetId, preview: WidgetProps['preview']): {
  text: () => string
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
  return { text: () => view.container.textContent ?? '', advance }
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
      const { text, advance } = mount(Widget, id, 'inert')
      const mounted = text()
      advance(PAST_EVERY_THRESHOLD_MS)
      expect(text(), `${id} inert preview text must be byte-identical after 30s`).toBe(mounted)
      cleanup()
    }
  }, 30_000)

  it('keeps the live display clock ticking so a real dashboard still ages its frame', () => {
    for (const [id, Widget] of RACECON_WIDGETS) {
      const { text, advance } = mount(Widget, id, undefined)
      const mounted = text()
      advance(PAST_EVERY_THRESHOLD_MS)
      expect(text(), `${id} live render must still age its frame`).not.toBe(mounted)
      cleanup()
    }
  }, 30_000)
})
