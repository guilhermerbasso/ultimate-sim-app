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
  RC01_MIN_STREAM_FRESH_MS,
  RC01_SHIFT_THRESHOLD_BY_GEAR,
  RC01_SHIFT_THRESHOLD_FALLBACK,
  RC01_SLOWEST_STREAM_CADENCE_MS,
  RC01_STREAM_JITTER_BUDGET_MS,
  Rc01LiveTelemetryBuffer,
  advanceRc01Alerts,
  buildRc01LedStates,
  clearInvalidRc01CurrentAlerts,
  createRc01AlertState,
  createRc01ChannelReceipts,
  createRc01DashboardModel,
  rc01CompactModeForContentBox,
  rc01FieldDescription,
  rc01LayoutForContentBox,
  rc01PhoneGeometryForContentBox,
  rc01ReceiptAgeMs,
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

  it('uses only local monotonic receipt age across aligned and skewed provider clocks', () => {
    expect(RC01_MIN_STREAM_FRESH_MS).toBe(
      RC01_SLOWEST_STREAM_CADENCE_MS + RC01_STREAM_JITTER_BUDGET_MS
    )
    expect(RC01_CHANNEL_STALE_MS.gear).toBe(RC01_MIN_STREAM_FRESH_MS)
    expect(RC01_CHANNEL_STALE_MS.rpm).toBe(200)
    expect(RC01_CHANNEL_STALE_MS.speed).toBe(500)

    const localReceipt = {
      snapshotTimestamp: 1_700_000_000_000,
      receivedAt: 1_000,
      value: 6
    }
    expect(rc01ReceiptAgeMs(localReceipt, 1_067)).toBe(67)
    expect(rc01ReceiptAgeMs({ ...localReceipt, snapshotTimestamp: 1 }, 1_067)).toBe(67)
    expect(rc01ReceiptAgeMs({ ...localReceipt, snapshotTimestamp: 9_000_000_000_000 }, 1_067)).toBe(67)

    const buffer = new Rc01LiveTelemetryBuffer()
    let providerTimestamp = 1_700_000_000_000
    let receiptTime = 0
    expect(buffer.ingest(snapshot(providerTimestamp), receiptTime)).toMatchObject({ accepted: true })

    const cadence = [
      RC01_SLOWEST_STREAM_CADENCE_MS,
      RC01_MIN_STREAM_FRESH_MS,
      RC01_SLOWEST_STREAM_CADENCE_MS,
      RC01_MIN_STREAM_FRESH_MS
    ]
    for (const gap of cadence) {
      receiptTime += gap
      providerTimestamp += RC01_SLOWEST_STREAM_CADENCE_MS
      const frame = snapshot(providerTimestamp)
      expect(buffer.ingest(frame, receiptTime)).toMatchObject({ accepted: true })
      const atJitterBudget = createRc01DashboardModel(
        frame,
        buffer.receipts(),
        receiptTime + RC01_MIN_STREAM_FRESH_MS
      )
      expect(atJitterBudget.gear.stale).toBe(false)
      expect(atJitterBudget.rpm.stale).toBe(false)
    }

    const latest = buffer.latestSnapshot()!
    const noNewReceipt = createRc01DashboardModel(
      latest,
      buffer.receipts(),
      receiptTime + RC01_MIN_STREAM_FRESH_MS + 1
    )
    expect(noNewReceipt.gear.stale).toBe(true)
    expect(noNewReceipt.rpm.stale).toBe(false)

    const pastClock = new Rc01LiveTelemetryBuffer()
    expect(pastClock.ingest(snapshot(10), 50_000)).toMatchObject({ accepted: true })
    expect(createRc01DashboardModel(
      pastClock.latestSnapshot(),
      pastClock.receipts(),
      50_000 + RC01_MIN_STREAM_FRESH_MS
    ).gear.stale).toBe(false)
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
    expect(cliff.ingest({ ...snapshot(3_000), deltaToBestSec: 0.4 }, 2_000)).toMatchObject({ accepted: true })
    expect(cliff.ingest({ ...snapshot(3_250), deltaToBestSec: 0.5 }, 2_250)).toMatchObject({ accepted: true })
    expect(cliff.ingest({ ...snapshot(3_500), deltaToBestSec: 0.5 }, 2_500)).toMatchObject({ accepted: true })
    expect(cliff.alertState().deltaCliff.active).toBe(true)
    cliff = commitFreshnessClear(cliff, 2_751)
    expect(cliff.alertState().deltaCliff).toEqual({ active: false, pendingSinceMs: null, baselineDelta: null })
    expect(cliff.ingest({ ...snapshot(3_501), deltaToBestSec: 0.1 }, 2_752)).toMatchObject({ accepted: true })
    expect(cliff.alertState().deltaCliff.active).toBe(false)

    let zeroCross = new Rc01LiveTelemetryBuffer()
    expect(zeroCross.ingest({ ...snapshot(1_000), deltaToBestSec: -0.1 }, 0)).toMatchObject({ accepted: true })
    expect(zeroCross.ingest({ ...snapshot(1_060), deltaToBestSec: 0.1 }, 60)).toMatchObject({ accepted: true })
    expect(zeroCross.ingest({ ...snapshot(1_210), deltaToBestSec: 0.1 }, 210)).toMatchObject({ accepted: true })
    expect(zeroCross.alertState().deltaZeroCross.active).toBe(true)
    zeroCross = commitFreshnessClear(zeroCross, 461)
    expect(zeroCross.alertState().deltaZeroCross).toEqual({ active: false, pendingSinceMs: null, pendingSign: null, lastNonZeroSign: null, minimumVisibleUntilMs: 0 })
    expect(zeroCross.ingest({ ...snapshot(1_211), deltaToBestSec: 0.1 }, 462)).toMatchObject({ accepted: true })
    expect(zeroCross.alertState().deltaZeroCross.active).toBe(false)

    let pitLimiter = new Rc01LiveTelemetryBuffer()
    expect(pitLimiter.ingest({ ...snapshot(1_000), pitLimiter: true }, 0)).toMatchObject({ accepted: true })
    expect(pitLimiter.alertState().pitLimiter.active).toBe(true)
    pitLimiter = commitFreshnessClear(pitLimiter, 301)
    expect(pitLimiter.alertState().pitLimiter).toEqual({ active: false, minimumVisibleUntilMs: 0 })
    expect(pitLimiter.ingest({ ...snapshot(1_001), pitLimiter: false }, 302)).toMatchObject({ accepted: true })
    expect(pitLimiter.alertState().pitLimiter.active).toBe(false)

    const receiptGap = new Rc01LiveTelemetryBuffer()
    expect(receiptGap.ingest({ ...snapshot(10_000), rpm: 8_200 }, 0)).toMatchObject({ accepted: true })
    expect(receiptGap.ingest({ ...snapshot(10_067), rpm: 8_200 }, 67)).toMatchObject({ accepted: true })
    expect(receiptGap.alertState().overRev.active).toBe(true)
    expect(receiptGap.ingest({ ...snapshot(10_268), rpm: 8_200 }, 268)).toMatchObject({ accepted: true })
    expect(receiptGap.alertState().overRev).toEqual({
      active: false,
      pendingSinceMs: 268,
      recoverySinceMs: null
    })

    const deltaGap = new Rc01LiveTelemetryBuffer()
    expect(deltaGap.ingest({ ...snapshot(20_000), deltaToBestSec: -0.1 }, 0)).toMatchObject({ accepted: true })
    expect(deltaGap.ingest({ ...snapshot(20_067), deltaToBestSec: 0.1 }, 67)).toMatchObject({ accepted: true })
    expect(deltaGap.ingest({ ...snapshot(20_318), deltaToBestSec: 0.1 }, 318)).toMatchObject({ accepted: true })
    expect(deltaGap.alertState().deltaZeroCross).toEqual({
      active: false,
      pendingSinceMs: null,
      pendingSign: null,
      lastNonZeroSign: 1,
      minimumVisibleUntilMs: 0
    })
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
    let monotonicMs = 0
    const monotonicClock = (): number => monotonicMs
    const advanceTo = (targetMs: number): void => {
      const delta = targetMs - monotonicMs
      monotonicMs = targetMs
      act(() => { vi.advanceTimersByTime(delta) })
    }

    const advancePastStaleness = (ms: number): void => {
      advanceTo(monotonicMs + ms)
    }

    let view = render(createElement(RaceconRc01DashWidget, {
      snapshot: { ...snapshot(1_000), rpm: 8_200 }, config, monotonicClock
    }))
    advanceTo(60)
    view.rerender(createElement(RaceconRc01DashWidget, {
      snapshot: { ...snapshot(1_060), rpm: 8_200 }, config, monotonicClock
    }))
    expect(view.container.querySelector('.rc01-over-rev')).toBeTruthy()
    advancePastStaleness(300)
    view.rerender(createElement(RaceconRc01DashWidget, {
      snapshot: { ...snapshot(1_061), rpm: 7_000 }, config, monotonicClock
    }))
    expect(view.container.querySelector('.rc01-over-rev')).toBeNull()
    view.unmount()

    monotonicMs = 0
    view = render(createElement(RaceconRc01DashWidget, {
      snapshot: { ...snapshot(1_000), deltaToBestSec: -0.1 }, config, monotonicClock
    }))
    for (let time = 100; time < 2_000; time += 100) {
      advanceTo(time)
      view.rerender(createElement(RaceconRc01DashWidget, {
        snapshot: { ...snapshot(1_000 + time), deltaToBestSec: -0.1 }, config, monotonicClock
      }))
    }
    advanceTo(2_000)
    view.rerender(createElement(RaceconRc01DashWidget, {
      snapshot: { ...snapshot(3_000), deltaToBestSec: 0.4 }, config, monotonicClock
    }))
    for (let time = 2_100; time <= 2_500; time += 100) {
      advanceTo(time)
      view.rerender(createElement(RaceconRc01DashWidget, {
        snapshot: { ...snapshot(3_000 + time - 2_000), deltaToBestSec: 0.5 }, config, monotonicClock
      }))
    }
    expect(view.container.querySelector('.rc01-delta.is-cliff')).toBeTruthy()
    advancePastStaleness(300)
    view.rerender(createElement(RaceconRc01DashWidget, {
      snapshot: { ...snapshot(3_501), deltaToBestSec: 0.1 }, config, monotonicClock
    }))
    expect(view.container.querySelector('.rc01-delta.is-cliff')).toBeNull()
    view.unmount()

    monotonicMs = 0
    view = render(createElement(RaceconRc01DashWidget, {
      snapshot: { ...snapshot(1_000), deltaToBestSec: -0.1 }, config, monotonicClock
    }))
    advanceTo(67)
    view.rerender(createElement(RaceconRc01DashWidget, {
      snapshot: { ...snapshot(1_060), deltaToBestSec: 0.1 }, config, monotonicClock
    }))
    advanceTo(217)
    view.rerender(createElement(RaceconRc01DashWidget, {
      snapshot: { ...snapshot(1_210), deltaToBestSec: 0.1 }, config, monotonicClock
    }))
    expect(view.container.querySelector('.rc01-delta-zero-cross')).toBeTruthy()
    advancePastStaleness(300)
    view.rerender(createElement(RaceconRc01DashWidget, {
      snapshot: { ...snapshot(1_211), deltaToBestSec: 0.1 }, config, monotonicClock
    }))
    expect(view.container.querySelector('.rc01-delta-zero-cross')).toBeNull()
    view.unmount()

    monotonicMs = 0
    view = render(createElement(RaceconRc01DashWidget, {
      snapshot: { ...snapshot(1_000), pitLimiter: true }, config, monotonicClock
    }))
    expect(view.getByText('PIT LIMITER')).toBeTruthy()
    advancePastStaleness(400)
    view.rerender(createElement(RaceconRc01DashWidget, {
      snapshot: { ...snapshot(1_001), pitLimiter: false }, config, monotonicClock
    }))
    expect(view.queryByText('PIT LIMITER')).toBeNull()
  })

  it('keeps 67ms cadence plus jitter gear receipts fresh and stales only without a new receipt', () => {
    vi.useFakeTimers()
    let monotonicMs = 0
    let providerTimestamp = 1_900_000_000_000
    const monotonicClock = (): number => monotonicMs

    const view = render(createElement(RaceconRc01DashWidget, {
      snapshot: snapshot(providerTimestamp), config, monotonicClock
    }))
    const expectFreshGear = (): void => {
      expect(view.getByLabelText('Gear 6')).toBeTruthy()
      expect(rc01ShiftThresholdForGear(6)).toBe(RC01_SHIFT_THRESHOLD_BY_GEAR[6])
      expect(rc01ShiftThresholdForGear(1)).toBe(RC01_SHIFT_THRESHOLD_BY_GEAR[1])
    }

    for (let index = 0; index < 12; index += 1) {
      const gap = index % 2 === 0
        ? RC01_SLOWEST_STREAM_CADENCE_MS
        : RC01_MIN_STREAM_FRESH_MS
      monotonicMs += gap
      providerTimestamp += RC01_SLOWEST_STREAM_CADENCE_MS
      act(() => { vi.advanceTimersByTime(gap) })
      view.rerender(createElement(RaceconRc01DashWidget, {
        snapshot: snapshot(providerTimestamp), config, monotonicClock
      }))
      expectFreshGear()
    }

    monotonicMs += RC01_MIN_STREAM_FRESH_MS + 1
    act(() => { vi.advanceTimersByTime(RC01_MIN_STREAM_FRESH_MS + 1) })
    expect(view.getByLabelText('Gear stale; last known value 6')).toBeTruthy()
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
      ...Array.from({ length: 8 }, (_, index) => ({
        timestamp: 410 + index * 200,
        deltaToBestSec: 0.1,
        pitLimiter: false
      })),
      { timestamp: 2_010, deltaToBestSec: 0.4, pitLimiter: false },
      { timestamp: 2_210, deltaToBestSec: 0.5, pitLimiter: false },
      { timestamp: 2_410, deltaToBestSec: 0.5, pitLimiter: false },
      { timestamp: 2_520, deltaToBestSec: 0.5, pitLimiter: true }
    ]
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
    expect(core).not.toContain('Date.now')
    expect(widget).not.toContain('Date.now')
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

  it('uses exact native LED pixels inside the responsive full-frame content box', () => {
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
    expect(css).toContain('top: 16px; width: 56px; height: 20px;')
    expect(css).toContain('nth-child(1) { left: 52px; }')
    expect(css).toContain('nth-child(11) { left: 692px; }')
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

  it('defines deterministic phone geometry with a fixed 44px interaction target', () => {
    expect(rc01LayoutForContentBox(393, 759)).toBe('compact')
    expect(rc01LayoutForContentBox(412, 867)).toBe('compact')
    expect(rc01CompactModeForContentBox(393, 759)).toBe('phone')
    expect(rc01CompactModeForContentBox(412, 867)).toBe('phone')
    expect(rc01CompactModeForContentBox(480, 650)).toBe('standard')
    expect(rc01PhoneGeometryForContentBox(393, 759)).toEqual({
      inset: 12,
      ledTop: 12,
      ledHeight: 16,
      heroTop: 48,
      heroHeight: 189,
      deltaTop: 250,
      deltaHeight: 136,
      statusTop: 402,
      statusHeight: 339,
      bottomInset: 18,
      toggleSize: 44
    })
    expect(rc01PhoneGeometryForContentBox(412, 867)).toEqual({
      inset: 12,
      ledTop: 12,
      ledHeight: 16,
      heroTop: 48,
      heroHeight: 216,
      deltaTop: 286,
      deltaHeight: 156,
      statusTop: 459,
      statusHeight: 390,
      bottomInset: 18,
      toggleSize: 44
    })

    const css = readFileSync('src/renderer/src/overlay/widgets/raceconRc01.css', 'utf8')
    expect(css).toMatch(/\.rc01-status-toggle\s*\{[\s\S]*?width: 44px;[\s\S]*?height: 44px;/u)
    expect(css).toMatch(/\[data-rc01-layout="native"\] \.rc01-status-toggle\s*\{[\s\S]*?width: 44px;[\s\S]*?height: 44px;/u)
    expect(css).toContain('data-rc01-compact-mode="phone"')
    expect(css).toContain('grid-template-columns: minmax(0, 0.8fr) minmax(0, 0.9fr) minmax(112px, 1.45fr);')
  })

})
