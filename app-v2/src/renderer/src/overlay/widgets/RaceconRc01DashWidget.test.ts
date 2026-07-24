// @vitest-environment jsdom
import { createElement, StrictMode, Suspense } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOverlayStyle, type OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { RaceconRc01DashWidget } from './RaceconRc01DashWidget'
import {
  RC01_CHANNEL_STALE_MS,
  RC01_HISTORY_LIMIT,
  RC01_LED_COUNT,
  RC01_SHIFT_THRESHOLD_BY_GEAR,
  RC01_SHIFT_THRESHOLD_FALLBACK,
  Rc01LiveTelemetryBuffer,
  advanceRc01Alerts,
  buildRc01LedStates,
  clearInvalidRc01CurrentAlerts,
  createRc01AlertState,
  createRc01ChannelReceipts,
  createRc01DashboardModel,
  rc01FieldDescription,
  rc01LayoutForContentBox,
  rc01ShiftThresholdForGear,
  replayRc01Alerts,
  rc01SourceIdentity
} from './raceconRc01Core'

const config: OverlayWidgetConfig = {
  id: 'raceconRc01Dash', enabled: true, locked: true, favorite: false,
  position: { x: 0, y: 0, width: 1024, height: 600 }, opacity: 100,
  stylePreset: 'minimal', style: createDefaultOverlayStyle(), display: null
}

function snapshot(timestamp = 1_000): TelemetrySnapshot {
  return {
    sim: 'iracing', connected: true, timestamp, sessionUniqueId: 33,
    speedKmh: 273, rpm: 7_829, maxRpm: 8_200, gear: 6,
    throttle: 0.8, brake: 0, clutch: 0, tcLevel: 4, position: 2,
    fuelLiters: 74, bestLapTimeSec: 90.2, deltaToBestSec: -0.316,
    pitLimiter: false, relatives: { ahead: { carIdx: 1, name: 'Ahead', carNumber: '1', gapSec: 0.789 } },
    tyres: { lf: { tempC: 84 }, rf: { tempC: 87 }, lr: { tempC: 96 }, rr: { tempC: 98 } }
  }
}

function markup(value: TelemetrySnapshot | null, cfg = config): string {
  return renderToStaticMarkup(createElement(RaceconRc01DashWidget, { snapshot: value, config: cfg }))
}

function assertClean(value: string): void {
  expect(value).not.toContain('\uFFFD')
  expect(value).not.toContain('NaN')
  expect(value).not.toContain('undefined')
  expect(value).not.toContain('Infinity')
}

/** The pre-refactor snapshot replay is retained only as a regression oracle for compact ingest. */
function replayAlertsFromSnapshots(history: readonly TelemetrySnapshot[]) {
  let state = createRc01AlertState()
  for (let index = 0; index < history.length; index += 1) {
    const current = history[index]
    let deltaTwoSecondsAgo: number | null = null
    for (let previous = index - 1; previous >= 0; previous -= 1) {
      const prior = history[previous]
      if (prior.timestamp <= current.timestamp - 2_000) {
        const priorModel = createRc01DashboardModel(prior, createRc01ChannelReceipts(prior, prior.timestamp), prior.timestamp)
        deltaTwoSecondsAgo = typeof priorModel.delta.raw === 'number' && !priorModel.delta.stale && !priorModel.delta.unavailable
          ? priorModel.delta.raw
          : null
        break
      }
    }
    const model = createRc01DashboardModel(current, createRc01ChannelReceipts(current, current.timestamp), current.timestamp)
    state = advanceRc01Alerts(state, {
      nowMs: current.timestamp,
      rpmRatio: model.rpmRatio,
      rpmFresh: model.rpmFresh,
      delta: typeof model.delta.raw === 'number' && !model.delta.stale && !model.delta.unavailable ? model.delta.raw : null,
      deltaTwoSecondsAgo,
      pitLimiter: model.pitLimiter.unavailable || model.pitLimiter.stale ? null : model.pitLimiter.value
    })
  }
  return state
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('RaceconRc01DashWidget', () => {
  it('renders accepted live telemetry, null telemetry, and unavailable fields without inferred values', () => {
    const live = markup(snapshot())
    assertClean(live)
    expect(live).toContain('data-widget="raceconRc01Dash"')
    expect(live).toContain('273')
    expect(live).toContain('7,829')
    expect(live).toContain('P02')
    expect(live).toContain('74.0 L')
    expect(live.match(/data-testid="rc01-led"/g)).toHaveLength(RC01_LED_COUNT)

    const missing = markup(null)
    assertClean(missing)
    expect(missing).toContain('Speed unavailable')
    expect(missing).toContain('\u2014')
    expect(missing).not.toContain('\uFFFD')

    const unavailable = markup({ ...snapshot(), gear: Number.NaN, tyres: { ...snapshot().tyres!, lf: {} } })
    expect(unavailable).toContain('Gear unavailable')
    expect(unavailable).toContain('LF tyre temperature unavailable')
    expect(unavailable).toContain('RF tyre temperature 87\u00B0')
    expect(live).toContain('\u25C0')
  })

  it('tracks independent channel receipts and fails closed when critical current values are stale', () => {
    const now = 20_000
    const live = snapshot(19_000)
    const receipts = createRc01ChannelReceipts(live, now - 2_001)
    const stale = createRc01DashboardModel(live, receipts, now)
    expect(stale.rpm.stale).toBe(true)
    expect(stale.speed.stale).toBe(true)
    expect(stale.gear.stale).toBe(true)
    expect(stale.tc.stale).toBe(true)
    expect(stale.position.stale).toBe(true)
    expect(stale.fuel.stale).toBe(true)
    expect(stale.delta.stale).toBe(true)
    expect(stale.best.stale).toBe(true)
    expect(stale.gapAhead.stale).toBe(true)
    expect(stale.pitLimiter.stale).toBe(true)
    expect(stale.tyres.every((tyre) => tyre.stale)).toBe(true)
    const alerts = clearInvalidRc01CurrentAlerts({
      ...createRc01AlertState(),
      overRev: { active: true, pendingSinceMs: null, recoverySinceMs: null },
      deltaCliff: { active: true, pendingSinceMs: null, baselineDelta: 0 },
      deltaZeroCross: { active: true, pendingSinceMs: null, pendingSign: null, lastNonZeroSign: 1, minimumVisibleUntilMs: now + 700 },
      pitLimiter: { active: true, minimumVisibleUntilMs: now + 300 }
    }, stale)
    expect(alerts.overRev.active).toBe(false)
    expect(alerts.deltaCliff.active).toBe(false)
    expect(alerts.deltaZeroCross.active).toBe(false)
    expect(alerts.pitLimiter.active).toBe(false)

    const tyreReceipts = new Map(createRc01ChannelReceipts(live, now))
    const lfReceipt = tyreReceipts.get('tyreLf')!
    tyreReceipts.set('tyreLf', { ...lfReceipt, receivedAt: now - RC01_CHANNEL_STALE_MS.tyreLf - 1 })
    const tyreModel = createRc01DashboardModel(live, tyreReceipts, now)
    expect(tyreModel.tyres.map((tyre) => ({ corner: tyre.corner, value: tyre.value, stale: tyre.stale }))).toEqual([
      { corner: 'LF', value: '84\u00B0', stale: true },
      { corner: 'RF', value: '87\u00B0', stale: false },
      { corner: 'LR', value: '96\u00B0', stale: false },
      { corner: 'RR', value: '98\u00B0', stale: false }
    ])
  })

  it('commits stale freshness clearing in the candidate before a fresh frame can reuse alert continuity', () => {
    const commitFreshnessClear = (buffer: Rc01LiveTelemetryBuffer, nowMs: number): Rc01LiveTelemetryBuffer => {
      const candidate = buffer.clone()
      const model = createRc01DashboardModel(candidate.latestSnapshot(), candidate.receipts(), nowMs)
      candidate.clearInvalidCurrentAlerts(model)
      return candidate
    }

    let overRev = new Rc01LiveTelemetryBuffer()
    expect(overRev.ingest({ ...snapshot(1_000), rpm: 8_200 }, 0)).toMatchObject({ accepted: true })
    expect(overRev.ingest({ ...snapshot(1_060), rpm: 8_200 }, 60)).toMatchObject({ accepted: true })
    expect(overRev.alertState().overRev.active).toBe(true)
    overRev = commitFreshnessClear(overRev, 261)
    expect(overRev.alertState().overRev).toEqual({ active: false, pendingSinceMs: null, recoverySinceMs: null })
    expect(overRev.ingest({ ...snapshot(1_061), rpm: 7_000 }, 262)).toMatchObject({ accepted: true })
    expect(overRev.alertState().overRev.active).toBe(false)

    let cliff = new Rc01LiveTelemetryBuffer()
    expect(cliff.ingest({ ...snapshot(1_000), deltaToBestSec: -0.1 }, 0)).toMatchObject({ accepted: true })
    expect(cliff.ingest({ ...snapshot(3_000), deltaToBestSec: 0.4 }, 1)).toMatchObject({ accepted: true })
    expect(cliff.ingest({ ...snapshot(3_500), deltaToBestSec: 0.5 }, 2)).toMatchObject({ accepted: true })
    expect(cliff.alertState().deltaCliff.active).toBe(true)
    cliff = commitFreshnessClear(cliff, 253)
    expect(cliff.alertState().deltaCliff).toEqual({ active: false, pendingSinceMs: null, baselineDelta: null })
    expect(cliff.ingest({ ...snapshot(3_501), deltaToBestSec: 0.1 }, 254)).toMatchObject({ accepted: true })
    expect(cliff.alertState().deltaCliff.active).toBe(false)

    let zeroCross = new Rc01LiveTelemetryBuffer()
    expect(zeroCross.ingest({ ...snapshot(1_000), deltaToBestSec: -0.1 }, 0)).toMatchObject({ accepted: true })
    expect(zeroCross.ingest({ ...snapshot(1_060), deltaToBestSec: 0.1 }, 1)).toMatchObject({ accepted: true })
    expect(zeroCross.ingest({ ...snapshot(1_210), deltaToBestSec: 0.1 }, 2)).toMatchObject({ accepted: true })
    expect(zeroCross.alertState().deltaZeroCross.active).toBe(true)
    zeroCross = commitFreshnessClear(zeroCross, 253)
    expect(zeroCross.alertState().deltaZeroCross).toEqual({ active: false, pendingSinceMs: null, pendingSign: null, lastNonZeroSign: null, minimumVisibleUntilMs: 0 })
    expect(zeroCross.ingest({ ...snapshot(1_211), deltaToBestSec: 0.1 }, 254)).toMatchObject({ accepted: true })
    expect(zeroCross.alertState().deltaZeroCross.active).toBe(false)

    let pitLimiter = new Rc01LiveTelemetryBuffer()
    expect(pitLimiter.ingest({ ...snapshot(1_000), pitLimiter: true }, 0)).toMatchObject({ accepted: true })
    expect(pitLimiter.alertState().pitLimiter.active).toBe(true)
    pitLimiter = commitFreshnessClear(pitLimiter, 301)
    expect(pitLimiter.alertState().pitLimiter).toEqual({ active: false, minimumVisibleUntilMs: 0 })
    expect(pitLimiter.ingest({ ...snapshot(1_001), pitLimiter: false }, 302)).toMatchObject({ accepted: true })
    expect(pitLimiter.alertState().pitLimiter.active).toBe(false)
  })

  it('requires an explicit live identity and rejects replay/mock telemetry', () => {
    const buffer = new Rc01LiveTelemetryBuffer()
    const first = snapshot(1_000)
    const replay = {
      ...first,
      replayContext: { state: 'replay' } as NonNullable<TelemetrySnapshot['replayContext']>
    }
    expect(buffer.ingest(replay, 1_000)).toEqual({ accepted: false, renderable: false, reason: 'replay-telemetry' })
    expect(buffer.ingest({ ...first, sim: 'mock' }, 1_001)).toEqual({ accepted: false, renderable: false, reason: 'mock-telemetry' })
    expect(buffer.history()).toHaveLength(0)

    const acc = {
      ...first,
      sim: 'acc' as const,
      sessionUniqueId: undefined,
      replayContext: {
        state: 'live', reason: 'confirmed-live', inputs: {}, active: false,
        revision: 7, token: 'acc-live-token', connectionEpoch: 8, sessionIdentity: 'acc-live-session'
      } as NonNullable<TelemetrySnapshot['replayContext']>
    }
    expect(rc01SourceIdentity(acc)).toBe('acc:session:acc-live-session:connection:8:token:acc-live-token:revision:7')
    expect(new Rc01LiveTelemetryBuffer().ingest(acc, 1_002)).toMatchObject({ accepted: true, renderable: true, reason: 'accepted' })

    const ams2 = { ...acc, sim: 'ams2' as const, replayContext: { ...acc.replayContext!, token: 'ams2-live-token' } }
    expect(new Rc01LiveTelemetryBuffer().ingest(ams2, 1_003)).toMatchObject({ accepted: true, renderable: true, reason: 'accepted' })

    const contextlessAc = {
      ...first, sim: 'ac' as const, sessionUniqueId: undefined, connectionEpoch: undefined,
      sessionKind: 'race' as const, trackName: 'Spa', trackConfigName: 'GP', carPath: 'gt3r'
    }
    expect(rc01SourceIdentity(contextlessAc)).toBeNull()
    expect(new Rc01LiveTelemetryBuffer().ingest(contextlessAc, 1_004)).toEqual({ accepted: false, renderable: false, reason: 'missing-source-identity' })

    const epochOnlyAc = { ...contextlessAc, connectionEpoch: 5 }
    expect(rc01SourceIdentity(epochOnlyAc)).toBe('ac:session:none:connection:5')
    expect(new Rc01LiveTelemetryBuffer().ingest(epochOnlyAc, 1_005)).toMatchObject({ accepted: true, renderable: true, reason: 'accepted' })
    expect(rc01SourceIdentity({ ...contextlessAc, sessionUniqueId: Number.NaN })).toBeNull()

    const core = readFileSync('src/renderer/src/overlay/widgets/raceconRc01Core.ts', 'utf8')
    expect(core).not.toContain('fallbackLiveSessionIdentity')
  })

  it('resets and quarantines source discontinuities and timestamp collisions', () => {
    const buffer = new Rc01LiveTelemetryBuffer()
    const first = snapshot(1_000)
    expect(buffer.ingest(first, 1_000)).toMatchObject({ accepted: true, renderable: true, reason: 'accepted' })

    const changedSession = { ...first, timestamp: 1_001, sessionUniqueId: 34 }
    expect(buffer.ingest(changedSession, 1_001)).toEqual({ accepted: false, renderable: false, reason: 'source-discontinuity' })
    expect(buffer.history()).toHaveLength(0)
    expect(buffer.receipts()).toHaveLength(0)
    expect(buffer.ingest(changedSession, 1_002)).toEqual({ accepted: false, renderable: false, reason: 'out-of-order' })
    expect(buffer.ingest({ ...changedSession, timestamp: 1_002 }, 1_003)).toMatchObject({ accepted: true, renderable: true, reason: 'accepted' })

    const collision = { ...changedSession, timestamp: 1_002, rpm: 7_000 }
    expect(buffer.ingest(collision, 1_004)).toEqual({ accepted: false, renderable: false, reason: 'same-timestamp-collision' })
    expect(buffer.history()).toHaveLength(0)
    expect(buffer.receipts()).toHaveLength(0)
    expect(buffer.ingest({ ...collision, timestamp: 1_003 }, 1_005)).toMatchObject({ accepted: true, renderable: true, reason: 'accepted' })
    expect(buffer.ingest({ ...collision, timestamp: Number.NaN }, 1_006)).toEqual({ accepted: false, renderable: false, reason: 'invalid-timestamp' })
    expect(buffer.history()).toHaveLength(0)
  })

  it('commits only accepted render candidates and preserves the latest accepted sample in StrictMode', () => {
    const first = snapshot(1_000)
    const second = { ...snapshot(1_001), speedKmh: 274, deltaToBestSec: 0.2 }
    const view = render(createElement(StrictMode, null, createElement(RaceconRc01DashWidget, { snapshot: first, config })))
    expect(view.getByLabelText('Speed 273')).toBeTruthy()

    view.rerender(createElement(StrictMode, null, createElement(RaceconRc01DashWidget, { snapshot: second, config })))
    expect(view.getByLabelText('Speed 274')).toBeTruthy()
    const points = view.container.querySelector('polyline')?.getAttribute('points')
    expect(points?.split(' ')).toHaveLength(2)
  })

  it('does not commit a candidate from an aborted Suspense render', () => {
    const pending = new Promise<void>(() => {})
    function BlockRender(): null {
      throw pending
    }
    function Harness({ value, suspend }: { value: TelemetrySnapshot; suspend: boolean }) {
      return createElement(
        Suspense,
        { fallback: createElement('p', null, 'Loading') },
        createElement(RaceconRc01DashWidget, { snapshot: value, config }),
        suspend ? createElement(BlockRender) : null
      )
    }

    const view = render(createElement(Harness, { value: snapshot(1_000), suspend: false }))
    view.rerender(createElement(Harness, { value: { ...snapshot(1_001), speedKmh: 274, deltaToBestSec: 0.1 }, suspend: true }))
    view.rerender(createElement(Harness, { value: { ...snapshot(1_002), speedKmh: 275, deltaToBestSec: 0.2 }, suspend: false }))

    expect(view.getByLabelText('Speed 275')).toBeTruthy()
    const points = view.container.querySelector('polyline')?.getAttribute('points')
    expect(points?.split(' ')).toHaveLength(2)
  })

  it('does not resurrect stale widget alerts when fresh RPM, delta, or pit frames arrive', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)

    const advancePastStaleness = (ms: number): void => {
      act(() => { vi.advanceTimersByTime(ms) })
    }

    let view = render(createElement(RaceconRc01DashWidget, { snapshot: { ...snapshot(1_000), rpm: 8_200 }, config }))
    view.rerender(createElement(RaceconRc01DashWidget, { snapshot: { ...snapshot(1_060), rpm: 8_200 }, config }))
    expect(view.container.querySelector('.rc01-over-rev')).toBeTruthy()
    advancePastStaleness(300)
    view.rerender(createElement(RaceconRc01DashWidget, { snapshot: { ...snapshot(1_061), rpm: 7_000 }, config }))
    expect(view.container.querySelector('.rc01-over-rev')).toBeNull()
    view.unmount()

    vi.setSystemTime(0)
    view = render(createElement(RaceconRc01DashWidget, { snapshot: { ...snapshot(1_000), deltaToBestSec: -0.1 }, config }))
    view.rerender(createElement(RaceconRc01DashWidget, { snapshot: { ...snapshot(3_000), deltaToBestSec: 0.4 }, config }))
    view.rerender(createElement(RaceconRc01DashWidget, { snapshot: { ...snapshot(3_500), deltaToBestSec: 0.5 }, config }))
    expect(view.container.querySelector('.rc01-delta.is-cliff')).toBeTruthy()
    advancePastStaleness(300)
    view.rerender(createElement(RaceconRc01DashWidget, { snapshot: { ...snapshot(3_501), deltaToBestSec: 0.1 }, config }))
    expect(view.container.querySelector('.rc01-delta.is-cliff')).toBeNull()
    view.unmount()

    vi.setSystemTime(0)
    view = render(createElement(RaceconRc01DashWidget, { snapshot: { ...snapshot(1_000), deltaToBestSec: -0.1 }, config }))
    view.rerender(createElement(RaceconRc01DashWidget, { snapshot: { ...snapshot(1_060), deltaToBestSec: 0.1 }, config }))
    view.rerender(createElement(RaceconRc01DashWidget, { snapshot: { ...snapshot(1_210), deltaToBestSec: 0.1 }, config }))
    expect(view.container.querySelector('.rc01-delta-zero-cross')).toBeTruthy()
    advancePastStaleness(300)
    view.rerender(createElement(RaceconRc01DashWidget, { snapshot: { ...snapshot(1_211), deltaToBestSec: 0.1 }, config }))
    expect(view.container.querySelector('.rc01-delta-zero-cross')).toBeNull()
    view.unmount()

    vi.setSystemTime(0)
    view = render(createElement(RaceconRc01DashWidget, { snapshot: { ...snapshot(1_000), pitLimiter: true }, config }))
    expect(view.getByText('PIT LIMITER')).toBeTruthy()
    advancePastStaleness(400)
    view.rerender(createElement(RaceconRc01DashWidget, { snapshot: { ...snapshot(1_001), pitLimiter: false }, config }))
    expect(view.queryByText('PIT LIMITER')).toBeNull()
  })

  it('keeps 30Hz gear receipts fresh across interleaved 100ms freshness ticks', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)

    const view = render(createElement(RaceconRc01DashWidget, { snapshot: snapshot(0), config }))
    const expectFreshGear = (): void => {
      expect(view.getByLabelText('Gear 6')).toBeTruthy()
      expect(rc01ShiftThresholdForGear(6)).toBe(RC01_SHIFT_THRESHOLD_BY_GEAR[6])
      expect(rc01ShiftThresholdForGear(1)).toBe(RC01_SHIFT_THRESHOLD_BY_GEAR[1])
    }

    let elapsedMs = 0
    let nextArrivalMs = 33
    let nextFreshnessTickMs = 100
    while (nextFreshnessTickMs <= 1_000) {
      if (nextArrivalMs < nextFreshnessTickMs) {
        act(() => { vi.advanceTimersByTime(nextArrivalMs - elapsedMs) })
        elapsedMs = nextArrivalMs
        view.rerender(createElement(RaceconRc01DashWidget, { snapshot: snapshot(elapsedMs), config }))
        nextArrivalMs += 33
      } else {
        act(() => { vi.advanceTimersByTime(nextFreshnessTickMs - elapsedMs) })
        elapsedMs = nextFreshnessTickMs
        nextFreshnessTickMs += 100
      }
      // A tick can only evaluate age. It must not backdate a 30Hz receipt past 50ms.
      expectFreshGear()
    }
  })

  it('uses the documented gear table, debounce/hysteresis, zero-cross, and real over-rev state', () => {
    expect(rc01ShiftThresholdForGear(1)).toBe(RC01_SHIFT_THRESHOLD_BY_GEAR[1])
    expect(rc01ShiftThresholdForGear(6)).toBe(RC01_SHIFT_THRESHOLD_BY_GEAR[6])
    expect(rc01ShiftThresholdForGear(null)).toBe(RC01_SHIFT_THRESHOLD_FALLBACK)
    expect(buildRc01LedStates(0.88, true, false, 1).filter((led) => led.active).length)
      .toBeGreaterThan(buildRc01LedStates(0.88, true, false, 6).filter((led) => led.active).length)
    expect(buildRc01LedStates(0.99, false).every((led) => !led.active)).toBe(true)

    let alerts = createRc01AlertState()
    alerts = advanceRc01Alerts(alerts, { nowMs: 0, rpmRatio: 1, rpmFresh: true, delta: -0.01, deltaTwoSecondsAgo: null, pitLimiter: false })
    alerts = advanceRc01Alerts(alerts, { nowMs: 60, rpmRatio: 1, rpmFresh: true, delta: 0.01, deltaTwoSecondsAgo: null, pitLimiter: false })
    expect(alerts.overRev.active).toBe(true)
    alerts = advanceRc01Alerts(alerts, { nowMs: 210, rpmRatio: 1, rpmFresh: true, delta: 0.01, deltaTwoSecondsAgo: null, pitLimiter: false })
    expect(alerts.deltaZeroCross.active).toBe(true)
    expect(buildRc01LedStates(1, true, alerts.overRev.active, 6).some((led) => led.tone === 'magenta')).toBe(true)
  })

  it('stores only compact immutable history while retaining the exact latest display snapshot', () => {
    const buffer = new Rc01LiveTelemetryBuffer()
    const initial = snapshot(0)
    expect(buffer.ingest(initial, 0)).toMatchObject({ accepted: true, reason: 'accepted' })

    const [stored] = buffer.history()
    expect(buffer.latestSnapshot()).toBe(initial)
    expect(Object.keys(stored).sort()).toEqual([
      'bestLap', 'bestLapFresh', 'delta', 'deltaFresh', 'fingerprint', 'gear',
      'pitLimiter', 'pitLimiterFresh', 'receivedAt', 'rpmFresh', 'rpmRatio',
      'sourceIdentity', 'timestamp'
    ].sort())
    expect(Object.values(stored).every((value) => value === null || ['boolean', 'number', 'string'].includes(typeof value))).toBe(true)
    expect(Object.isFrozen(stored)).toBe(true)
    expect(stored).not.toHaveProperty('snapshot')

    let latest = initial
    for (let index = 1; index <= RC01_HISTORY_LIMIT; index += 1) {
      latest = { ...snapshot(index), deltaToBestSec: index / 1_000 }
      expect(buffer.ingest(latest, index)).toMatchObject({ accepted: true, reason: 'accepted' })
    }
    const history = buffer.history()
    expect(history).toHaveLength(RC01_HISTORY_LIMIT)
    expect(history[0]?.timestamp).toBe(1)
    expect(buffer.latestSnapshot()).toBe(latest)
    expect(buffer.traceValues().length).toBeLessThanOrEqual(12)
  })

  it('keeps duplicate candidate clones shallow and preserves incremental alert equivalence', () => {
    const buffer = new Rc01LiveTelemetryBuffer()
    const frames = [
      { timestamp: 0, deltaToBestSec: -0.2, pitLimiter: false },
      { timestamp: 60, deltaToBestSec: 0.1, pitLimiter: false },
      { timestamp: 210, deltaToBestSec: 0.1, pitLimiter: false },
      { timestamp: 2_010, deltaToBestSec: 0.4, pitLimiter: false },
      { timestamp: 2_520, deltaToBestSec: 0.5, pitLimiter: true }
    ] as const
    let latest: TelemetrySnapshot | null = null
    const accepted: TelemetrySnapshot[] = []
    for (const frame of frames) {
      latest = { ...snapshot(frame.timestamp), ...frame, rpm: 8_200 }
      accepted.push(latest)
      expect(buffer.ingest(latest, frame.timestamp)).toMatchObject({ accepted: true, reason: 'accepted' })
    }

    const history = buffer.history()
    const alerts = buffer.alertState()
    const trace = buffer.traceValues()
    expect(alerts).toEqual(replayAlertsFromSnapshots(accepted))
    expect(alerts).toEqual(replayRc01Alerts(history))
    expect(alerts).toMatchObject({
      overRev: { active: true }, deltaCliff: { active: true }, pitLimiter: { active: true }
    })

    const candidate = buffer.clone()
    const candidateHistory = candidate.history()
    expect(candidateHistory).not.toBe(history)
    expect(candidateHistory[0]).toBe(history[0])
    expect(candidate.latestSnapshot()).toBe(latest)
    expect(candidate.ingest({ ...latest! }, 2_521)).toEqual({ accepted: false, renderable: true, reason: 'duplicate' })
    expect(candidate.history()[0]).toBe(history[0])
    expect(candidate.alertState()).toEqual(alerts)
    expect(candidate.traceValues()).toEqual(trace)

    const core = readFileSync('src/renderer/src/overlay/widgets/raceconRc01Core.ts', 'utf8')
    const widget = readFileSync('src/renderer/src/overlay/widgets/RaceconRc01DashWidget.tsx', 'utf8')
    expect(core).not.toContain('structuredClone')
    expect(widget).not.toContain('replayRc01Alerts')
  })

  it('uses the config size only as a deterministic fallback before a rendered box exists', () => {
    const configuredSize: OverlayWidgetConfig = {
      ...config,
      position: { ...config.position, width: 900, height: 600 }
    }
    const configuredOutput = markup(snapshot(), configuredSize)
    expect(configuredOutput).toContain('data-rc01-layout="compact"')
    expect(configuredOutput).toContain('data-rc01-content-width="900"')
    expect(configuredOutput).toContain('data-rc01-content-height="600"')

    const missingSize: OverlayWidgetConfig = {
      ...config,
      position: { ...config.position, width: Number.NaN, height: 0 }
    }
    const output = markup(snapshot(), missingSize)
    expect(output).toContain('data-rc01-layout="app"')
    expect(output).toContain('data-rc01-content-width="1024"')
    expect(output).toContain('data-rc01-content-height="600"')
  })

  it('selects native/app from the transformed root box and remeasures when its shell changes', () => {
    let displayedBox = { width: 800, height: 480 }
    const rect = (width: number, height: number): DOMRect => ({
      x: 0, y: 0, top: 0, right: width, bottom: height, left: 0,
      width, height, toJSON: () => ({})
    } as DOMRect)
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('rc01-widget')
        ? rect(displayedBox.width, displayedBox.height)
        : rect(0, 0)
    })

    class ResizeObserverStub {
      static instances: ResizeObserverStub[] = []
      readonly observed: Element[] = []

      constructor(private readonly callback: ResizeObserverCallback) {
        ResizeObserverStub.instances.push(this)
      }

      observe(target: Element): void { this.observed.push(target) }
      unobserve(): void {}
      disconnect(): void {}
      trigger(): void { this.callback([], this as unknown as ResizeObserver) }
    }

    const originalResizeObserver = globalThis.ResizeObserver
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
    try {
      const view = render(
        createElement('div', { className: 'dashboard-shell' },
          createElement(RaceconRc01DashWidget, { snapshot: snapshot(), config }))
      )
      const root = view.container.querySelector<HTMLDivElement>('.rc01-widget')!
      const shell = view.container.querySelector<HTMLDivElement>('.dashboard-shell')!
      const observer = ResizeObserverStub.instances[0]

      // The authored config is 1024x600, but DashboardCanvas has transformed the
      // element to the physical 800x480 RC-01 display.
      expect(root.dataset.rc01Layout).toBe('native')
      expect(root.dataset.rc01ContentWidth).toBe('800')
      expect(root.dataset.rc01ContentHeight).toBe('480')
      expect(observer.observed).toEqual([root, shell])

      displayedBox = { width: 1024, height: 600 }
      act(() => observer.trigger())
      expect(root.dataset.rc01Layout).toBe('app')
      expect(root.dataset.rc01ContentWidth).toBe('1024')
      expect(root.dataset.rc01ContentHeight).toBe('600')
      view.unmount()
    } finally {
      rectSpy.mockRestore()
      if (originalResizeObserver) globalThis.ResizeObserver = originalResizeObserver
      else delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
    }
  })

  it('uses scaled native percentage contracts without a fixed 800px child canvas', () => {
    expect(rc01LayoutForContentBox(800, 480)).toBe('native')
    expect(rc01LayoutForContentBox(1024, 600)).toBe('app')

    expect(rc01LayoutForContentBox(1023.9977, 599.9853)).toBe('app')
    expect(rc01LayoutForContentBox(900, 600)).toBe('compact')
    const source = readFileSync('src/renderer/src/overlay/widgets/RaceconRc01DashWidget.tsx', 'utf8')
    const core = readFileSync('src/renderer/src/overlay/widgets/raceconRc01Core.ts', 'utf8')
    const css = readFileSync('src/renderer/src/overlay/widgets/raceconRc01.css', 'utf8')
    expect(source).toContain('getBoundingClientRect()')
    expect(source).toContain("closest<HTMLElement>('.dashboard-shell')")
    expect(source).toContain('observer.observe(element)')
    expect(source).toContain('observer.observe(shell)')
    expect(source).not.toMatch(/window\.inner|matchMedia|racecon-mock|telemetry-scenarios/iu)
    expect(`${source}\n${core}\n${css}`).not.toContain('\uFFFD')
    expect(`${source}\n${core}\n${css}`).not.toMatch(/\.(?:png|jpe?g|gif|webp|avif)(?:['")\s])/iu)
    expect(rc01FieldDescription('Gear', { value: '\u2014', raw: null, stale: true, unavailable: false, tone: 'muted' })).toBe('Gear stale')
    expect(css).not.toMatch(/url\(/iu)
    expect(css).toMatch(/\.rc01-widget\s*\{[\s\S]*?width: 100%;[\s\S]*?height: 100%;/u)
    expect(css).toMatch(/\[data-rc01-layout="native"\] \.rc01-dashboard\s*\{[\s\S]*?width: 100%;[\s\S]*?height: 100%;/u)
    expect(css).not.toMatch(/\[data-rc01-layout="native"\][^{]*\{[^}]*?(?:min-|max-)?width: 800px/iu)
    expect(css).toContain('top: 3.333333%; width: 7%; height: 4.166667%;')
    expect(css).toContain('nth-child(1) { left: 6.5%; }')
    expect(css).toContain('nth-child(11) { left: 86.5%; }')
    expect(css).toContain('.rc01-widget[data-rc01-layout="native"] .rc01-speed { left: 5%; top: 14.583333%; width: 23.5%; height: 42.083333%; }')
    expect(css).toContain('top: 67.916667%;')
    expect(css).toContain('font-size: 12.5cqw;')
    expect(css).toContain('font-size: 22.5cqw;')
    expect(css).toContain('font-size: 9.25cqw;')
    // App mode continues to use the authored 1024x600 composition directly.
    expect(css).toContain('.rc01-widget[data-rc01-layout="app"] .rc01-speed .rc01-value { font-size: 100px; }')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('.rc01-soft-key::before')
  })

})
