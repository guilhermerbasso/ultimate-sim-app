import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Logger } from '../../shared/logger'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import { MockProvider } from '../telemetry/mock-provider'
import { TrackMapLearner } from './learner'
import { captureTrackLayout } from './types'

// ─── Test fixtures ───────────────────────────────────────────────────────────

interface LogCall {
  level: 'debug' | 'info' | 'warn' | 'error'
  area: string
  message: string
  detail?: unknown
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function makeSpyLogger(): { logger: Logger; calls: LogCall[]; messages: () => string[] } {
  const calls: LogCall[] = []
  const rec = (level: LogCall['level']) => (area: string, message: string, detail?: unknown) =>
    calls.push({ level, area, message, detail })
  return {
    logger: { debug: rec('debug'), info: rec('info'), warn: rec('warn'), error: rec('error') },
    calls,
    messages: () => calls.map((c) => c.message)
  }
}

const DT = 1 / 30 // 30 Hz
const DT_MS = (DT * 1000)

function baseSnapshot(overrides: Partial<TelemetrySnapshot>): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 0,
    speedKmh: 120,
    rpm: 6000,
    gear: 3,
    throttle: 1,
    brake: 0,
    clutch: 0,
    onTrack: true,
    onPitRoad: false,
    trackName: 'Test Circuit',
    ...overrides
  }
}

// A circle in metres. `pct` 0..1 maps to one revolution. Centre arbitrary; the
// learner re-scales everything, so only the shape (non-degenerate, closed) matters.
function circle(pct: number, radius = 120): { east: number; north: number } {
  const theta = 2 * Math.PI * pct
  return { east: radius * Math.sin(theta), north: radius * Math.cos(theta) }
}

// Build a sequence of `pct` values for one lap: from `startPct`, increasing by
// `step`, wrapping past 1.0 back through 0 and continuing until `laps` of total
// coverage have been driven (so a mid-lap start can complete a full loop).
function lapPcts(startPct: number, step = 0.004, coverage = 1.04): number[] {
  const out: number[] = []
  let driven = 0
  let pct = startPct
  out.push(round6(pct))
  while (driven < coverage) {
    pct += step
    driven += step
    let wrapped = pct
    if (wrapped >= 1) wrapped -= 1
    out.push(round6(wrapped))
  }
  return out
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6
}

function hundredthPcts(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => (start + index) / 100)
}

// Velocity-yaw snapshots tracing the circle. Trick: with yawNorth=0 the learner's
// rotation is the identity mapped so that intX accumulates velocityY*dt and intY
// accumulates velocityX*dt. So set velocityY = ΔEast/dt and velocityX = ΔNorth/dt
// to make the integrator reproduce the circle exactly.
function velocityYawLap(pcts: number[], startTs = 1000): TelemetrySnapshot[] {
  const snaps: TelemetrySnapshot[] = []
  for (let i = 0; i < pcts.length; i += 1) {
    const cur = circle(pcts[i])
    const prev = circle(pcts[Math.max(i - 1, 0)])
    const nextRef = circle(pcts[Math.min(i + 1, pcts.length - 1)])
    // velocity for the segment ENDING at i; for i=0 use the segment 0→1.
    const seg = i === 0 ? { dE: nextRef.east - cur.east, dN: nextRef.north - cur.north } : { dE: cur.east - prev.east, dN: cur.north - prev.north }
    snaps.push(
      baseSnapshot({
        timestamp: startTs + i * DT_MS,
        lapDistPct: pcts[i],
        velocityX: seg.dN / DT,
        velocityY: seg.dE / DT,
        yawNorth: 0
      })
    )
  }
  return snaps
}

// Lat-lon snapshots tracing the circle (no velocity fields, so the learner locks
// the lat-lon acquisition mode). Uses a real non-zero origin.
function latLonLap(pcts: number[], startTs = 1000): TelemetrySnapshot[] {
  const lat0 = 45
  const lon0 = 9
  const degR = 0.0012 // ~133 m
  return pcts.map((pct, i) => {
    const c = circle(pct, 1)
    return baseSnapshot({
      timestamp: startTs + i * DT_MS,
      lapDistPct: pct,
      lat: lat0 + degR * c.north,
      lon: lon0 + degR * c.east
    })
  })
}

function latLonSnapshot(pct: number, timestamp: number, overrides: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  const c = circle(pct, 1)
  return baseSnapshot({
    timestamp, lapDistPct: pct, lat: 45 + 0.0012 * c.north, lon: 9 + 0.0012 * c.east, ...overrides
  })
}

function replayContext(state: 'live' | 'replay'): NonNullable<TelemetrySnapshot['replayContext']> {
  return {
    state, reason: state === 'live' ? 'confirmed-live' : 'replay-playing', inputs: {},
    active: state === 'replay', revision: state === 'live' ? 0 : 1, token: `1:${state}`, connectionEpoch: 1
  }
}

function samplePolylineAt(points: Array<{ x: number; y: number }>, fraction: number): { x: number; y: number } {
  const lengths = points.slice(1).map((point, i) => Math.hypot(point.x - points[i].x, point.y - points[i].y))
  const total = lengths.reduce((sum, length) => sum + length, 0)
  let cursor = ((fraction % 1) + 1) % 1 * total
  for (let i = 0; i < lengths.length; i += 1) {
    if (cursor <= lengths[i]) {
      const t = lengths[i] > 0 ? cursor / lengths[i] : 0
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t
      }
    }
    cursor -= lengths[i]
  }
  return points[0]
}

async function feed(
  learner: TrackMapLearner,
  snaps: Array<TelemetrySnapshot | null>
): Promise<ReturnType<TrackMapLearner['ingest']> extends Promise<infer R> ? R[] : never> {
  const records: unknown[] = []
  for (const s of snaps) {
    const r = await learner.ingest(s)
    if (r) records.push(r)
  }
  return records as never
}

type ContinuityPath = 'normal' | 'too-slow' | 'time-gap' | 'replay-resume'

async function ingestContinuityTransition(
  learner: TrackMapLearner,
  last: TelemetrySnapshot,
  lapDistPct: number,
  path: ContinuityPath
): ReturnType<TrackMapLearner['ingest']> {
  if (path === 'replay-resume') {
    await learner.ingest({
      ...last,
      timestamp: last.timestamp + DT_MS,
      replayContext: replayContext('replay')
    })
    return learner.ingest({
      ...last,
      timestamp: last.timestamp + DT_MS * 2,
      lapDistPct,
      replayContext: replayContext('live')
    })
  }
  return learner.ingest({
    ...last,
    timestamp: last.timestamp + (path === 'time-gap' ? 1000 : DT_MS),
    lapDistPct,
    speedKmh: path === 'too-slow' ? 4 : last.speedKmh
  })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('TrackMapLearner — robust capture', () => {
  let root: string
  let spy: ReturnType<typeof makeSpyLogger>
  let learner: TrackMapLearner

  beforeEach(() => {
    root = mkdtempSync(join(process.cwd(), 'learner-test-'))
    spy = makeSpyLogger()
    learner = new TrackMapLearner('unused', { rootDir: root, logger: spy.logger })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('learns a map from a clean velocity-yaw lap starting at the S/F line', async () => {
    const records = (await feed(learner, velocityYawLap(lapPcts(0)))) as Array<{
      source: string
      polyline: unknown[]
      trackName: string
    }>
    expect(records.length).toBe(1)
    expect(records[0].source).toBe('velocity-yaw')
    expect(records[0].polyline.length).toBeGreaterThan(60)
    // Cached + persisted to disk.
    expect(learner.has('Test Circuit')).toBe(true)
    expect(readdirSync(root).some((f) => f.endsWith('.json'))).toBe(true)
    // The success path logs an info line (export-visible diagnostics).
    expect(spy.calls.some((c) => c.level === 'info' && c.message.includes('map learned'))).toBe(true)
  })

  it('learns a map from a clean lat-lon lap (and locks the lat-lon mode)', async () => {
    const records = (await feed(learner, latLonLap(lapPcts(0)))) as Array<{ source: string }>
    expect(records.length).toBe(1)
    expect(records[0].source).toBe('lat-lon')
    expect(learner.has('Test Circuit')).toBe(true)
  })

  it('mid-lap start (auto warm-up) anchors at S/F and finalizes on the next lap', async () => {
    // Start at 40% — the OLD code would never start a capture here. We expect a
    // warm-up phase first, then a learned map after the next full lap.
    const snaps = velocityYawLap(lapPcts(0.4, 0.004, 1.6))
    let sawWarming = false
    let record: unknown = null
    for (const s of snaps) {
      const r = await learner.ingest(s)
      if (!record && learner.getLearnState().phase === 'warming') sawWarming = true
      if (r) record = r
    }
    expect(sawWarming).toBe(true)
    expect(record).not.toBeNull()
    expect(learner.has('Test Circuit')).toBe(true)
  })

  it('manual capture anchors immediately mid-lap and finalizes after one lap', async () => {
    learner.armManualCapture()
    const snaps = velocityYawLap(lapPcts(0.4, 0.004, 1.05))
    const records = (await feed(learner, snaps)) as Array<{ source: string }>
    expect(records.length).toBe(1)
    // It recorded as a manual capture (anchored immediately, not warmed up).
    expect(spy.calls.some((c) => c.message.includes('manual capture armed'))).toBe(true)
  })

  it('persists the true start/finish offset for a .37 manual capture and reloads an aligned live marker', async () => {
    const reference = new TrackMapLearner('unused', { rootDir: join(root, 'reference') })
    const [referenceRecord] = await feed(reference, latLonLap(lapPcts(0), 1000))
    learner.armManualCapture()
    const [manualRecord] = await feed(learner, latLonLap(lapPcts(0.37, 0.004, 1.05), 20_000))
    expect(manualRecord?.startFinishPct).not.toBe(0)

    const reloaded = new TrackMapLearner('unused', { rootDir: root })
    await reloaded.hydrate()
    const persisted = reloaded.get('Test Circuit')
    expect(persisted?.startFinishPct).toBeCloseTo(manualRecord?.startFinishPct ?? -1, 8)
    const referenceMarker = samplePolylineAt(referenceRecord!.polyline, referenceRecord!.startFinishPct)
    const reloadedMarker = samplePolylineAt(persisted!.polyline, persisted!.startFinishPct)
    expect(Math.hypot(referenceMarker.x - reloadedMarker.x, referenceMarker.y - reloadedMarker.y)).toBeLessThan(0.025)
  })

  it('a brief slow patch PAUSES (does not destroy) an in-flight anchored lap', async () => {
    // Drive the first ~half lap.
    const first = velocityYawLap(lapPcts(0, 0.004, 0.5))
    await feed(learner, first)
    const before = learner.getRecordingSnapshot()
    expect(before.active).toBe(true)
    expect(before.phase).toBe('recording')
    const progressBefore = before.progress
    expect(progressBefore).toBeGreaterThan(0.3)

    // A few crawling samples (< 8 km/h). The OLD code nulled the acquisition here.
    const lastTs = first[first.length - 1].timestamp
    const lastPct = first[first.length - 1].lapDistPct ?? 0.5
    for (let i = 0; i < 5; i += 1) {
      await learner.ingest(baseSnapshot({ timestamp: lastTs + (i + 1) * DT_MS, lapDistPct: lastPct, speedKmh: 2, velocityX: 0, velocityY: 0, yawNorth: 0 }))
    }
    const during = learner.getRecordingSnapshot()
    expect(during.active).toBe(true) // survived the slow patch
    expect(during.progress).toBeCloseTo(progressBefore, 5)
    expect(learner.getLearnState().reason).toBe('too-slow')

    // Resume and finish the lap → a map is learned.
    const rest = velocityYawLap(lapPcts(lastPct, 0.004, 0.6), lastTs + 1000)
    const records = await feed(learner, rest)
    expect(records.length).toBe(1)
  })

  it('ignores the lat=0,lon=0 sentinel and learns no bogus map', async () => {
    // Moving car but the sim reports (0,0) the whole time and no velocity/yaw.
    const snaps = lapPcts(0).map((pct, i) =>
      baseSnapshot({ timestamp: 1000 + i * DT_MS, lapDistPct: pct, lat: 0, lon: 0 })
    )
    const records = await feed(learner, snaps)
    expect(records.length).toBe(0)
    expect(learner.has('Test Circuit')).toBe(false)
    expect(learner.getLearnState().reason).toBe('no-acquisition-mode')
  })

  it('emits a distinct diagnostic for every stall reason', async () => {
    let ts = 1000
    const next = (over: Partial<TelemetrySnapshot> | null) =>
      over === null ? null : baseSnapshot({ timestamp: (ts += 100), ...over })

    await learner.ingest(null) // not-connected (null)
    await learner.ingest(next({ connected: false })) // not-connected
    expect(learner.getLearnState().reason).toBe('not-connected')

    await learner.ingest(baseSnapshot({ timestamp: (ts += 100), trackName: '   ' })) // no-track-name
    expect(learner.getLearnState().reason).toBe('no-track-name')

    await learner.ingest(next({ lapDistPct: Number.NaN })) // no-lap-dist-pct
    expect(learner.getLearnState().reason).toBe('no-lap-dist-pct')

    await learner.ingest(next({ lapDistPct: 0.5, speedKmh: 1 })) // too-slow
    expect(learner.getLearnState().reason).toBe('too-slow')

    await learner.ingest(next({ lapDistPct: 0.5, speedKmh: 120 })) // no-acquisition-mode (no position fields)
    expect(learner.getLearnState().reason).toBe('no-acquisition-mode')

    const messages = spy.messages()
    for (const reason of ['not-connected', 'no-track-name', 'no-lap-dist-pct', 'too-slow', 'no-acquisition-mode']) {
      expect(messages, `expected a diagnostic for ${reason}`).toContain(`learner: ${reason}`)
    }

    // The no-acquisition-mode diagnostic reports WHICH fields were missing.
    const noMode = spy.calls.find((c) => c.message === 'learner: no-acquisition-mode')
    expect(noMode?.detail).toMatchObject({ velocityX: null, velocityY: null, yawNorth: null, lat: null, lon: null })
  })

  it('throttles repeated identical reasons but always logs on change', async () => {
    const slow = (i: number) => baseSnapshot({ timestamp: 1000 + i * DT_MS, lapDistPct: 0.5, speedKmh: 1 })
    for (let i = 0; i < 30; i += 1) await learner.ingest(slow(i))
    const tooSlowLines = spy.messages().filter((m) => m === 'learner: too-slow')
    // 30 ticks at 33ms span ~1s → far fewer than 30 log lines (throttled).
    expect(tooSlowLines.length).toBeLessThan(5)
    expect(tooSlowLines.length).toBeGreaterThan(0)
  })

  it('drops the in-flight lap on a TOW (slow + large pct advance) instead of baking a translated loop', async () => {
    // Anchor a clean half lap.
    const first = velocityYawLap(lapPcts(0, 0.004, 0.5))
    await feed(learner, first)
    expect(learner.getRecordingSnapshot().active).toBe(true)
    const lastTs = first[first.length - 1].timestamp
    const lastPct = first[first.length - 1].lapDistPct ?? 0.5

    // A tow: the car is slow (<8 km/h) but lapDistPct jumps far down the track in a
    // single tick (a slow corner/spin would barely move pct). The frozen integrator
    // can't represent this, so the lap must be DROPPED (not resumed translated).
    await learner.ingest(
      baseSnapshot({ timestamp: lastTs + DT_MS, lapDistPct: lastPct + 0.4, speedKmh: 4, velocityX: 0, velocityY: 0, yawNorth: 0 })
    )
    expect(learner.getRecordingSnapshot().active).toBe(false)
    expect(learner.getLearnState().reason).toBe('teleport-reset')
  })

  it('keeps pausing through a slow corner (small pct delta) but drops on a tow (large pct delta)', async () => {
    const first = velocityYawLap(lapPcts(0, 0.004, 0.4))
    await feed(learner, first)
    const lastTs = first[first.length - 1].timestamp
    const lastPct = first[first.length - 1].lapDistPct ?? 0.4

    // Crawling through a hairpin: <8 km/h with a tiny pct advance each tick — PAUSE,
    // don't destroy.
    let ts = lastTs
    let pct = lastPct
    for (let i = 0; i < 4; i += 1) {
      ts += DT_MS
      pct += 0.003 // well under MAX_PCT_STEP
      await learner.ingest(baseSnapshot({ timestamp: ts, lapDistPct: pct, speedKmh: 5, velocityX: 0, velocityY: 0, yawNorth: 0 }))
    }
    expect(learner.getRecordingSnapshot().active).toBe(true)
    expect(learner.getLearnState().reason).toBe('too-slow')
  })

  it('uses speed hysteresis so the too-slow reason does not flap around 8 km/h', async () => {
    // Anchor a recording at racing speed (starts at S/F → anchors immediately).
    const warm = velocityYawLap(lapPcts(0, 0.004, 0.3))
    await feed(learner, warm)
    expect(learner.getLearnState().phase).toBe('recording')
    let ts = warm[warm.length - 1].timestamp
    let pct = warm[warm.length - 1].lapDistPct ?? 0.3
    const tick = (speedKmh: number, dPct: number): TelemetrySnapshot => {
      ts += DT_MS
      pct += dPct
      return baseSnapshot({ timestamp: ts, lapDistPct: pct, speedKmh, velocityX: 10, velocityY: 0, yawNorth: 0 })
    }

    await learner.ingest(tick(7, 0)) // below the 8 enter-threshold → pause
    expect(learner.getLearnState().reason).toBe('too-slow')
    // 9..11 km/h are ABOVE the 8 enter-threshold but BELOW the 12 exit-threshold:
    // hysteresis keeps us paused so the reason (and its log/broadcast) stays stable
    // instead of flapping too-slow ↔ recording every tick.
    for (const v of [9, 10, 11, 10, 9]) {
      await learner.ingest(tick(v, 0))
      expect(learner.getLearnState().reason).toBe('too-slow')
    }
    // Clearing the exit threshold resumes recording.
    await learner.ingest(tick(40, 0.004))
    expect(learner.getLearnState().reason).toBe('recording')
  })

  it('self-heals after a MODERATE skip by advancing lastPct (no multi-tick stall)', async () => {
    const first = velocityYawLap(lapPcts(0, 0.004, 0.3))
    await feed(learner, first)
    const samplesBefore = learner.getRecordingSnapshot().sampleCount
    let ts = first[first.length - 1].timestamp
    let pct = first[first.length - 1].lapDistPct ?? 0.3

    // A moderate forward skip (~2×MAX_PCT_STEP, e.g. a dropped frame): NOT a full
    // teleport, so the lap survives — but this tick is skipped.
    ts += DT_MS
    pct += 0.1
    await learner.ingest(baseSnapshot({ timestamp: ts, lapDistPct: pct, speedKmh: 120, velocityX: 30, velocityY: 0, yawNorth: 0 }))
    expect(learner.getRecordingSnapshot().active).toBe(true)

    // The VERY NEXT normal tick records again (self-healed in one tick — the old
    // code stalled here because lastPct stayed frozen at the pre-skip value).
    ts += DT_MS
    pct += 0.004
    await learner.ingest(baseSnapshot({ timestamp: ts, lapDistPct: pct, speedKmh: 120, velocityX: 30, velocityY: 0, yawNorth: 0 }))
    expect(learner.getRecordingSnapshot().sampleCount).toBeGreaterThan(samplesBefore)
  })

  it('accepts a bounded .99 -> .01 no-GPS seam wrap and finalizes the capture', async () => {
    learner.armManualCapture()
    const first = velocityYawLap(hundredthPcts(10, 99))
    await feed(learner, first)
    expect(learner.getRecordingSnapshot().active).toBe(true)

    const last = first[first.length - 1]
    const record = await learner.ingest({ ...last, timestamp: last.timestamp + DT_MS, lapDistPct: 0.01 })

    expect(record).not.toBeNull()
    expect(learner.getRecordingSnapshot().active).toBe(false)
    expect(learner.has('Test Circuit')).toBe(true)
  })

  it.each(['too-slow', 'time-gap', 'replay-resume'] as const)(
    'keeps a bounded .99 -> .01 no-GPS seam continuous through the %s path',
    async (path) => {
      learner.armManualCapture()
      const first = velocityYawLap(hundredthPcts(80, 99))
      await feed(learner, first)
      const last = first[first.length - 1]

      await ingestContinuityTransition(learner, last, 0.01, path)

      expect(learner.getRecordingSnapshot().active).toBe(true)
      expect(learner.has('Test Circuit')).toBe(false)
    }
  )

  it.each(['normal', 'too-slow', 'time-gap', 'replay-resume'] as const)(
    'rejects a .91 -> .09 no-GPS teleport without finalizing through the %s path',
    async (path) => {
      const first = velocityYawLap(hundredthPcts(0, 91))
      await feed(learner, first)
      const last = first[first.length - 1]
      const result = await ingestContinuityTransition(learner, last, 0.09, path)

      expect(result).toBeNull()
      expect(learner.getRecordingSnapshot().active).toBe(false)
      expect(learner.getLearnState().reason).toBe('teleport-reset')
      expect(learner.has('Test Circuit')).toBe(false)
    }
  )

  it.each(['normal', 'too-slow', 'time-gap', 'replay-resume'] as const)(
    'accepts the exact .95 -> 0 seam-step bound through the %s path',
    async (path) => {
      learner.armManualCapture()
      const first = velocityYawLap(hundredthPcts(path === 'normal' ? 5 : 80, 95))
      await feed(learner, first)
      const result = await ingestContinuityTransition(learner, first[first.length - 1], 0, path)

      if (path === 'normal') {
        expect(result).not.toBeNull()
        expect(learner.has('Test Circuit')).toBe(true)
      } else {
        expect(result).toBeNull()
        expect(learner.getRecordingSnapshot().active).toBe(true)
        expect(learner.has('Test Circuit')).toBe(false)
      }
    }
  )

  it.each(['normal', 'too-slow', 'time-gap', 'replay-resume'] as const)(
    'rejects the just-over .949999 -> 0 seam step through the %s path',
    async (path) => {
      const first = velocityYawLap([...hundredthPcts(0, 94), 0.949999])
      await feed(learner, first)
      const result = await ingestContinuityTransition(learner, first[first.length - 1], 0, path)

      expect(result).toBeNull()
      expect(learner.getRecordingSnapshot().active).toBe(false)
      expect(learner.getLearnState().reason).toBe('teleport-reset')
      expect(learner.has('Test Circuit')).toBe(false)
    }
  )

  it.each(['normal', 'too-slow', 'time-gap', 'replay-resume'] as const)(
    'accepts the exact non-seam .15 -> .20 step through the %s path',
    async (path) => {
      const pcts = hundredthPcts(0, 15)
      const first = path === 'replay-resume' ? latLonLap(pcts) : velocityYawLap(pcts)
      await feed(learner, first)
      const before = learner.getRecordingSnapshot().sampleCount
      const result = await ingestContinuityTransition(learner, first[first.length - 1], 0.2, path)

      expect(result).toBeNull()
      expect(learner.getRecordingSnapshot().active).toBe(true)
      expect(learner.getLearnState().reason).toBe(
        path === 'too-slow' ? 'too-slow' : path === 'time-gap' ? 'time-gap' : 'recording'
      )
      if (path === 'normal' || path === 'replay-resume') {
        expect(learner.getRecordingSnapshot().sampleCount).toBeGreaterThan(before)
      }
    }
  )

  it.each(['normal', 'too-slow', 'time-gap', 'replay-resume'] as const)(
    'rejects the just-over non-seam .15 -> .200001 step through the %s path',
    async (path) => {
      const pcts = hundredthPcts(0, 15)
      const first = path === 'replay-resume' ? latLonLap(pcts) : velocityYawLap(pcts)
      await feed(learner, first)
      const before = learner.getRecordingSnapshot().sampleCount
      const result = await ingestContinuityTransition(learner, first[first.length - 1], 0.200001, path)

      expect(result).toBeNull()
      expect(learner.getLearnState().reason).toBe('teleport-reset')
      if (path === 'normal') {
        expect(learner.getRecordingSnapshot().active).toBe(true)
        expect(learner.getRecordingSnapshot().sampleCount).toBe(before)
      } else {
        expect(learner.getRecordingSnapshot().active).toBe(false)
      }
    }
  )

  it.each(['normal', 'too-slow', 'time-gap', 'replay-resume'] as const)(
    'clamps epsilon-sized negative percentage jitter through the %s path',
    async (path) => {
      const first = velocityYawLap(hundredthPcts(0, 50))
      await feed(learner, first)
      const result = await ingestContinuityTransition(
        learner,
        first[first.length - 1],
        0.5 - Number.EPSILON,
        path
      )

      expect(result).toBeNull()
      expect(learner.getRecordingSnapshot().active).toBe(true)
      expect(learner.getLearnState().reason).toBe(
        path === 'too-slow' ? 'too-slow' : path === 'time-gap' ? 'time-gap' : 'recording'
      )
    }
  )

  it('resets a replay-resumed meaningful reverse step', async () => {
    const first = velocityYawLap(hundredthPcts(0, 50))
    await feed(learner, first)
    await ingestContinuityTransition(learner, first[first.length - 1], 0.499, 'replay-resume')

    expect(learner.getRecordingSnapshot().active).toBe(false)
    expect(learner.getLearnState().reason).toBe('teleport-reset')
  })

  it.each([
    ['ordinary forward step', 0, 0.35, undefined],
    ['start/finish seam', 0.8, 0.18, 0.002]
  ] as const)('suspends during replay and safely resumes across %s', async (_case, start, coverage, resumePct) => {
    if (resumePct !== undefined) learner.armManualCapture()
    const first = latLonLap(lapPcts(start, 0.004, coverage))
    await feed(learner, first)
    const before = learner.getRecordingSnapshot()
    const last = first[first.length - 1]
    const pct = last.lapDistPct ?? start + coverage
    await learner.ingest(latLonSnapshot(0.8, last.timestamp + DT_MS, { replayContext: replayContext('replay') }))
    expect(learner.getRecordingSnapshot().sampleCount).toBe(before.sampleCount)
    await learner.ingest(latLonSnapshot(resumePct ?? pct + 0.004, last.timestamp + DT_MS * 2, {
      replayContext: replayContext('live')
    }))
    expect(learner.getRecordingSnapshot().active).toBe(true)
    expect(learner.getRecordingSnapshot().sampleCount).toBeGreaterThan(before.sampleCount)
  })

  it('drops a replay-suspended capture when the live coordinate jumps', async () => {
    const first = latLonLap(lapPcts(0, 0.004, 0.3))
    await feed(learner, first)
    const last = first[first.length - 1]
    const pct = last.lapDistPct ?? 0.3
    await learner.ingest(latLonSnapshot(pct, last.timestamp + DT_MS, { replayContext: replayContext('replay') }))
    await learner.ingest(latLonSnapshot(pct + 0.004, last.timestamp + DT_MS * 2, {
      lat: 46,
      lon: 10,
      replayContext: replayContext('live')
    }))
    expect(learner.getRecordingSnapshot().active).toBe(false)
    expect(learner.getLearnState().reason).toBe('teleport-reset')
  })

  it.each([
    ['identical progress', 0, true],
    ['forward movement', 0.004, false]
  ] as const)('handles no-GPS replay resume with %s', async (_case, step, survives) => {
    const first = velocityYawLap(lapPcts(0, 0.004, 0.3))
    await feed(learner, first)
    const last = first[first.length - 1]
    const pct = last.lapDistPct ?? 0.3
    const before = learner.getRecordingSnapshot().sampleCount
    await learner.ingest({ ...last, timestamp: last.timestamp + DT_MS, replayContext: replayContext('replay') })
    await learner.ingest({
      ...last,
      timestamp: last.timestamp + DT_MS * 2,
      lapDistPct: pct + step,
      replayContext: replayContext('live')
    })
    expect(learner.getRecordingSnapshot().active).toBe(survives)
    if (survives) expect(learner.getRecordingSnapshot().sampleCount).toBe(before)
    else expect(learner.getLearnState().reason).toBe('teleport-reset')
  })

  it.each([
    ['pit-road', { onPitRoad: true, onTrack: true }],
    ['off-track', { onPitRoad: false, onTrack: false }]
  ] as const)('resets and rewarms after %s', async (reason, state) => {
    const first = latLonLap(lapPcts(0, 0.004, 0.3))
    await feed(learner, first)
    const last = first[first.length - 1]
    const pct = last.lapDistPct ?? 0.3
    await learner.ingest(latLonSnapshot(pct, last.timestamp + DT_MS, state))
    expect(learner.getRecordingSnapshot().active).toBe(false)
    expect(learner.getLearnState().reason).toBe(reason)
    await learner.ingest(latLonSnapshot(pct + 0.004, last.timestamp + DT_MS * 2))
    expect(learner.getRecordingSnapshot().phase).toBe('warming')
  })

  it('does not create or append a capture while spatial state is unknown', async () => {
    await learner.ingest(latLonSnapshot(0.2, 1000))
    const samples = learner.getRecordingSnapshot().sampleCount
    await learner.ingest(latLonSnapshot(0.204, 1000 + DT_MS, { onTrack: undefined }))
    expect(learner.getRecordingSnapshot().sampleCount).toBe(samples)
    expect(learner.getLearnState().reason).toBe('unknown-spatial')
  })

  it('accepts an actual MockProvider snapshot when onTrack capability is absent', async () => {
    const mock = new MockProvider()
    mock.start()
    const snapshot = mock.poll()
    mock.stop()
    expect(snapshot?.onTrack).toBeUndefined()
    expect(snapshot?.onPitRoad).toBe(false)
    await learner.ingest(snapshot)
    expect(learner.getRecordingSnapshot().active).toBe(true)
    expect(learner.getLearnState().reason).not.toBe('unknown-spatial')
  })

  it('cancelCapture aborts an in-flight recording', async () => {
    await feed(learner, velocityYawLap(lapPcts(0, 0.004, 0.4)))
    expect(learner.getRecordingSnapshot().active).toBe(true)
    learner.cancelCapture()
    expect(learner.getRecordingSnapshot().active).toBe(false)
    expect(learner.getLearnState().phase).toBe('idle')
  })
})

describe('TrackMapLearner — layout persistence and legacy migration', () => {
  let root: string
  let spy: ReturnType<typeof makeSpyLogger>

  beforeEach(() => { root = mkdtempSync(join(process.cwd(), 'learner-layout-test-')); spy = makeSpyLogger() })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  const outline = (marker: number) => [{ x: marker, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]

  function writeLegacy(capturedAt = 1, marker = 0, trackName = 'Shared Venue'): void {
    writeFileSync(join(root, 'legacy.json'), JSON.stringify({
      version: 1, trackName, capturedAt, source: 'lat-lon', startFinishPct: 0, polyline: outline(marker)
    }))
  }

  function writeV2(
    config: string | undefined,
    capturedAt: number,
    marker: number,
    trackId?: number,
    file = 'v2.json',
    trackName = 'Shared Venue'
  ): void {
    const layout = captureTrackLayout({ trackId, trackName, trackConfigName: config })!
    writeFileSync(join(root, file), JSON.stringify({
      version: 2, layoutKey: layout.key, trackId, trackName: layout.trackName, trackConfigName: config,
      capturedAt, source: 'lat-lon', startFinishPct: 0, polyline: outline(marker)
    }))
  }

  it('keeps learned files and cache entries independent for same-venue layouts', async () => {
    const learner = new TrackMapLearner('unused', { rootDir: root, logger: spy.logger })
    const layoutLap = (config: string, trackId: number, timestamp: number) =>
      velocityYawLap(lapPcts(0), timestamp).map((snapshot) => ({
        ...snapshot, trackName: 'Shared Venue', trackConfigName: config, trackId
      }))
    const gp = layoutLap('Grand Prix', 101, 1000)
    const club = layoutLap('Club', 102, 20_000)
    await feed(learner, gp)
    await feed(learner, club)

    expect(learner.get({ trackId: 101, trackName: 'Shared Venue', trackConfigName: 'Grand Prix' })).not.toBeNull()
    expect(learner.get({ trackId: 102, trackName: 'Shared Venue', trackConfigName: 'Club' })).not.toBeNull()
    expect(readdirSync(root)).toEqual(expect.arrayContaining(['track-101.json', 'track-102.json']))
  })

  it('keeps configless legacy readable offline without quarantining an empty catalog', async () => {
    writeLegacy()
    const learner = new TrackMapLearner('unused', { rootDir: root, logger: spy.logger })
    await learner.hydrate()
    expect(learner.get('Shared Venue')).not.toBeNull()
    expect(learner.get({ trackName: 'Shared Venue', trackConfigName: 'Grand Prix' })).not.toBeNull()
    expect(readdirSync(root)).toContain('legacy.json')
    expect(spy.calls.some((call) => call.message.includes('quarantined'))).toBe(false)
  })

  it('keeps an exact unambiguous direct record readable offline', async () => {
    writeV2('Grand Prix', 10, 4, undefined, 'direct.json')
    const learner = new TrackMapLearner('unused', { rootDir: root })
    await learner.hydrate()

    const record = learner.get({ trackName: 'Shared Venue', trackConfigName: 'Grand Prix' })
    expect(record).toMatchObject({ capturedAt: 10, trackId: undefined, trackConfigName: 'Grand Prix' })
    expect(record?.polyline[0].x).toBe(4)
  })

  it('recovers an identical direct plus sole ID record offline and prefers the ID alias', async () => {
    writeV2(undefined, 10, 4, undefined, 'direct.json', 'Shared Venue - Grand Prix')
    writeV2('Grand Prix', 10, 4, 101, 'track-101.json')
    const restarted = new TrackMapLearner('unused', { rootDir: root })
    await restarted.hydrate()

    expect(restarted.get({ trackName: 'Shared Venue', trackConfigName: 'Grand Prix' }))
      .toMatchObject({ trackId: 101, capturedAt: 10 })
    expect(restarted.get({ trackName: 'Shared Venue - Grand Prix' })?.trackId).toBe(101)
  })

  it('fails closed offline when direct and sole ID aliases have distinct content', async () => {
    writeV2('Grand Prix', 10, 4, undefined, 'direct.json')
    writeV2('Grand Prix', 10, 5, 101, 'track-101.json')
    const restarted = new TrackMapLearner('unused', { rootDir: root })
    await restarted.hydrate()

    expect(restarted.get({ trackName: 'Shared Venue', trackConfigName: 'Grand Prix' })).toBeNull()
    expect(restarted.get({ trackId: 101, trackName: 'Shared Venue', trackConfigName: 'Grand Prix' }))
      .not.toBeNull()
  })

  it('keeps equal-content aliases from two different IDs ambiguous offline', async () => {
    writeV2('Grand Prix', 10, 4, 101, 'track-101.json')
    writeV2('Grand Prix', 10, 4, 102, 'track-102.json')
    const restarted = new TrackMapLearner('unused', { rootDir: root })
    await restarted.hydrate()

    expect(restarted.get({ trackName: 'Shared Venue', trackConfigName: 'Grand Prix' })).toBeNull()
  })

  it.each([
    ['stale unique', [{ trackId: 101, trackName: 'Shared Venue', trackConfigName: 'Grand Prix' }], false],
    ['fresh ambiguous', [
      { trackId: 101, trackName: 'Shared Venue', trackConfigName: 'Grand Prix' },
      { trackId: 102, trackName: 'Shared Venue', trackConfigName: 'Club' }
    ], true]
  ] as const)('%s catalog does not promote configless legacy', async (_case, catalog, fresh) => {
    writeLegacy()
    const learner = new TrackMapLearner('unused', { rootDir: root, logger: spy.logger })
    await learner.setCatalog(catalog, fresh)
    await learner.hydrate()
    expect(learner.get('Shared Venue')).not.toBeNull()
    expect(learner.get({ trackId: 101, trackName: 'Shared Venue', trackConfigName: 'Grand Prix' })).toBeNull()
    expect(learner.get({ trackId: 102, trackName: 'Shared Venue', trackConfigName: 'Club' })).toBeNull()
    expect(readdirSync(root)).not.toContain('track-101.json')
    expect(readdirSync(root)).toContain('legacy.json')
  })

  it('publishes catalog and promoted memory before asynchronous promotion persistence completes', async () => {
    writeLegacy()
    const learner = new TrackMapLearner('unused', { rootDir: root, logger: spy.logger })
    await learner.hydrate()
    const gate = deferred<void>()
    const originalPersist = (learner as any).persist.bind(learner)
    const persist = vi.spyOn(learner as any, 'persist').mockImplementation(async (record: unknown) => {
      await gate.promise
      return originalPersist(record)
    })

    const publication = learner.publishCatalog([
      { trackId: 101, trackName: 'Shared Venue', trackConfigName: 'Grand Prix' }
    ], true)

    expect(persist).toHaveBeenCalledTimes(1)
    expect((learner as any).catalog).toEqual([
      { trackId: 101, trackName: 'Shared Venue', trackConfigName: 'Grand Prix' }
    ])
    expect(learner.get({
      trackId: 101,
      trackName: 'Shared Venue',
      trackConfigName: 'Grand Prix'
    })).toMatchObject({ trackId: 101, trackConfigName: 'Grand Prix' })
    expect(readdirSync(root)).not.toContain('track-101.json')

    gate.resolve(undefined)
    await publication

    expect(readdirSync(root)).toContain('track-101.json')
  })

  it('keeps promoted memory recoverable when promotion persistence fails', async () => {
    writeLegacy()
    const learner = new TrackMapLearner('unused', { rootDir: root, logger: spy.logger })
    await learner.hydrate()
    vi.spyOn(learner as any, 'persist').mockRejectedValue(new Error('disk unavailable'))

    await learner.setCatalog([
      { trackId: 101, trackName: 'Shared Venue', trackConfigName: 'Grand Prix' }
    ], true)

    expect((learner as any).catalog).toEqual([
      { trackId: 101, trackName: 'Shared Venue', trackConfigName: 'Grand Prix' }
    ])
    expect(learner.get({
      trackId: 101,
      trackName: 'Shared Venue',
      trackConfigName: 'Grand Prix'
    })).toMatchObject({ trackId: 101 })
    expect(readdirSync(root)).toContain('legacy.json')
    expect(readdirSync(root)).not.toContain('track-101.json')
    expect(spy.calls).toContainEqual(expect.objectContaining({
      level: 'warn',
      message: 'learner: outline promotion failed'
    }))

    const restarted = new TrackMapLearner('unused', { rootDir: root })
    await restarted.setCatalog([
      { trackId: 101, trackName: 'Shared Venue', trackConfigName: 'Grand Prix' }
    ], true)
    await restarted.hydrate()
    expect(restarted.get({
      trackId: 101,
      trackName: 'Shared Venue',
      trackConfigName: 'Grand Prix'
    })).toMatchObject({ trackId: 101 })
    expect(readdirSync(root)).toContain('track-101.json')
  })

  it('promotes a fresh unique legacy match and archives its source', async () => {
    writeLegacy()
    const learner = new TrackMapLearner('unused', { rootDir: root, logger: spy.logger })
    await learner.setCatalog([{ trackId: 101, trackName: 'Shared Venue', trackConfigName: 'Grand Prix' }], true)
    await learner.hydrate()
    expect(learner.get({ trackId: 101, trackName: 'Shared Venue', trackConfigName: 'Grand Prix' }))
      .toMatchObject({ version: 2, trackId: 101, trackConfigName: 'Grand Prix' })
    expect(learner.get('Shared Venue')?.trackId).toBe(101)
    expect(readdirSync(root)).toContain('track-101.json')
    expect(readdirSync(join(root, 'quarantine')).length).toBeGreaterThan(0)
  })

  it('keeps an older layout-specific V2 ahead of a newer configless V1', async () => {
    writeLegacy(30, 1)
    writeV2('Grand Prix', 20, 2)
    const learner = new TrackMapLearner('unused', { rootDir: root, logger: spy.logger })
    await learner.setCatalog([{ trackId: 101, trackName: 'Shared Venue', trackConfigName: 'Grand Prix' }], true)
    await learner.hydrate()
    const promoted = learner.get({ trackId: 101, trackName: 'Shared Venue', trackConfigName: 'Grand Prix' })
    expect(promoted?.capturedAt).toBe(20)
    expect(promoted?.polyline[0].x).toBe(2)
    const quarantined = readdirSync(join(root, 'quarantine'))
      .map((file) => JSON.parse(readFileSync(join(root, 'quarantine', file), 'utf8')) as { capturedAt?: number })
    expect(quarantined.some((record) => record.capturedAt === 30)).toBe(true)

    const exact = { trackName: 'Shared Venue', trackConfigName: 'Grand Prix' }
    const offline = new TrackMapLearner('unused', { rootDir: root })
    await offline.hydrate()
    expect(offline.get(exact)?.capturedAt).toBe(20)
    expect(offline.get({ trackName: 'Shared Venue - Grand Prix' })?.capturedAt).toBe(20)
    const stale = new TrackMapLearner('unused', { rootDir: root })
    await stale.setCatalog([{ trackId: 101, trackName: 'Shared Venue', trackConfigName: 'Grand Prix' }], false)
    await stale.hydrate()
    expect(stale.get(exact)?.capturedAt).toBe(20)
  })

  it('keeps a newer configless V1 ahead of an older configless V2', async () => {
    writeLegacy(30, 1)
    writeV2(undefined, 20, 2, undefined, 'configless-v2.json')
    const learner = new TrackMapLearner('unused', { rootDir: root, logger: spy.logger })
    await learner.setCatalog([{ trackId: 101, trackName: 'Shared Venue', trackConfigName: 'Grand Prix' }], true)
    await learner.hydrate()

    const promoted = learner.get({ trackId: 101, trackName: 'Shared Venue', trackConfigName: 'Grand Prix' })
    expect(promoted?.capturedAt).toBe(30)
    expect(promoted?.polyline[0].x).toBe(1)
    const quarantined = readdirSync(join(root, 'quarantine'))
      .map((file) => JSON.parse(readFileSync(join(root, 'quarantine', file), 'utf8')) as { capturedAt?: number })
    expect(quarantined.some((record) => record.capturedAt === 20)).toBe(true)
  })

  it('prioritizes an exact TrackID V2 over newer configless V2 and V1 candidates', async () => {
    writeV2(undefined, 10, 1, 101, 'layout-v2.json')
    writeV2(undefined, 20, 2, undefined, 'configless-v2.json')
    writeLegacy(30, 3)
    const learner = new TrackMapLearner('unused', { rootDir: root, logger: spy.logger })
    await learner.setCatalog([{ trackId: 101, trackName: 'Shared Venue', trackConfigName: 'Grand Prix' }], true)
    await learner.hydrate()

    const promoted = learner.get({ trackId: 101, trackName: 'Shared Venue', trackConfigName: 'Grand Prix' })
    expect(promoted?.capturedAt).toBe(10)
    expect(promoted?.polyline[0].x).toBe(1)
    const quarantined = readdirSync(join(root, 'quarantine'))
      .map((file) => JSON.parse(readFileSync(join(root, 'quarantine', file), 'utf8')) as { capturedAt?: number })
    expect(quarantined).toEqual(expect.arrayContaining([
      expect.objectContaining({ capturedAt: 20 }),
      expect.objectContaining({ capturedAt: 30 })
    ]))
  })

  it('treats a canonical combined-name V2 as exact identity without matching another config', async () => {
    writeV2(undefined, 10, 1, undefined, 'combined-v2.json', 'Shared Venue - Grand Prix')
    writeV2(undefined, 20, 2, undefined, 'configless-v2.json')
    writeLegacy(30, 3)
    writeV2('Club', 40, 4, undefined, 'club-v2.json')
    const learner = new TrackMapLearner('unused', { rootDir: root, logger: spy.logger })
    await learner.setCatalog([{ trackId: 101, trackName: 'Shared Venue', trackConfigName: 'Grand Prix' }], true)
    await learner.hydrate()

    const promoted = learner.get({ trackId: 101, trackName: 'Shared Venue', trackConfigName: 'Grand Prix' })
    expect(promoted?.capturedAt).toBe(10)
    expect(promoted?.polyline[0].x).toBe(1)
    expect(learner.get({ trackName: 'Shared Venue', trackConfigName: 'Club' })?.polyline[0].x).toBe(4)
    expect(readdirSync(root)).toContain('club-v2.json')
  })

  it('promotes the newer V2 when equal-version candidates target the same catalog layout', async () => {
    writeV2('Grand Prix', 10, 1, 101, 'old-v2.json')
    writeV2('Grand Prix', 20, 2, undefined, 'new-v2.json')
    const learner = new TrackMapLearner('unused', { rootDir: root, logger: spy.logger })
    await learner.setCatalog([{ trackId: 101, trackName: 'Shared Venue', trackConfigName: 'Grand Prix' }], true)
    await learner.hydrate()

    const promoted = learner.get({ trackId: 101, trackName: 'Shared Venue', trackConfigName: 'Grand Prix' })
    expect(promoted?.capturedAt).toBe(20)
    expect(promoted?.polyline[0].x).toBe(2)
    const quarantined = readdirSync(join(root, 'quarantine'))
      .map((file) => JSON.parse(readFileSync(join(root, 'quarantine', file), 'utf8')) as { capturedAt?: number })
    expect(quarantined.some((record) => record.capturedAt === 10)).toBe(true)
  })

  it('prefers a fresh unique catalog ID over a later direct name-key record', async () => {
    writeV2('Grand Prix', 10, 7, 101, 'track-101.json')
    const learner = new TrackMapLearner('unused', { rootDir: root })
    await learner.hydrate()
    await learner.setCatalog([{ trackId: 101, trackName: 'Shared Venue', trackConfigName: 'Grand Prix' }], true)

    const directLap = velocityYawLap(lapPcts(0), 1000).map((snapshot) => ({
      ...snapshot,
      trackName: 'Shared Venue',
      trackConfigName: 'Grand Prix'
    }))
    const [direct] = await feed(learner, directLap)
    expect(direct?.trackId).toBeUndefined()

    const resolved = learner.get({ trackName: 'Shared Venue', trackConfigName: 'Grand Prix' })
    expect(resolved).toMatchObject({ trackId: 101, capturedAt: 10 })
    expect(resolved?.polyline[0].x).toBe(7)
  })

  it('fails closed when a direct record and conflicting ID records claim the same exact alias', async () => {
    writeV2('Grand Prix', 30, 3, undefined, 'direct.json')
    writeV2('Grand Prix', 10, 1, 101, 'track-101.json')
    writeV2('Grand Prix', 20, 2, 102, 'track-102.json')
    const learner = new TrackMapLearner('unused', { rootDir: root })
    await learner.hydrate()
    expect(learner.get({ trackName: 'Shared Venue', trackConfigName: 'Grand Prix' })).toBeNull()
    expect(learner.get({ trackId: 101, trackName: 'Shared Venue', trackConfigName: 'Grand Prix' })).not.toBeNull()
    expect(learner.get({ trackId: 102, trackName: 'Shared Venue', trackConfigName: 'Grand Prix' })).not.toBeNull()
  })
})

// ─── Corner map (Turn 1..N) persistence + getters ────────────────────────────

import { DEFAULT_CORNER_MAP_CONFIG, cornerConfigKey, type CornerMapData } from './corner-map'

describe('TrackMapLearner — corner maps', () => {
  let root: string
  let spy: ReturnType<typeof makeSpyLogger>
  let learner: TrackMapLearner

  beforeEach(() => {
    root = mkdtempSync(join(process.cwd(), 'learner-corner-test-'))
    spy = makeSpyLogger()
    learner = new TrackMapLearner('unused', { rootDir: root, logger: spy.logger })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function writePersistedMap(map: CornerMapData): void {
    const dir = join(root, 'corners')
    mkdirSync(dir, { recursive: true })
    const safe = (s: string): string => s.replace(/[^a-z0-9-_]+/gi, '_')
    // Mirror the learner's per-layout file naming so two layouts of one track don't
    // overwrite each other (configless maps keep the original name).
    const layoutSegment = map.trackConfigName ? `__cfg-${safe(map.trackConfigName)}` : ''
    writeFileSync(
      join(dir, `${safe(map.trackName)}${layoutSegment}__${safe(map.configKey)}.json`),
      JSON.stringify(map, null, 2)
    )
  }

  const sampleMap: CornerMapData = {
    version: 1,
    trackName: 'Test Circuit',
    configKey: cornerConfigKey(DEFAULT_CORNER_MAP_CONFIG),
    corners: [
      { index: 1, startPct: 0.2, apexPct: 0.25, endPct: 0.3, minSpeedKmh: 80, entrySpeedKmh: 200, exitSpeedKmh: 180 },
      { index: 2, startPct: 0.6, apexPct: 0.65, endPct: 0.7, minSpeedKmh: 90, entrySpeedKmh: 210, exitSpeedKmh: 190 }
    ],
    generatedAt: 1,
    sampleCount: 500
  }

  it('returns null before any corner map is learned', () => {
    expect(learner.getCornerMap('Test Circuit')).toBeNull()
    expect(learner.hasCornerMap('Test Circuit')).toBe(false)
    expect(learner.cornerIndexAt('Test Circuit', 0.25)).toBeNull()
  })

  it('hydrates a persisted corner map and serves lapDistPct → corner', async () => {
    writePersistedMap(sampleMap)
    await learner.hydrate()
    expect(learner.hasCornerMap('Test Circuit')).toBe(true)
    expect(learner.getCornerMap('Test Circuit')?.corners.length).toBe(2)
    // lapDistPct → corner index.
    expect(learner.cornerIndexAt('Test Circuit', 0.25)).toBe(1)
    expect(learner.cornerIndexAt('Test Circuit', 0.65)).toBe(2)
    // Straights map to null.
    expect(learner.cornerIndexAt('Test Circuit', 0.45)).toBeNull()
    expect(learner.cornerAt('Test Circuit', 0.25)?.index).toBe(1)
    expect(learner.listCornerMaps().map((m) => m.trackName)).toContain('Test Circuit')
  })

  it('keeps two LAYOUTS of one track as independent corner maps (N1)', async () => {
    // Same display name, same detection config — only the iRacing TrackConfigName
    // differs. Before the layout-key fix these collided (latest config won).
    const gp: CornerMapData = {
      ...sampleMap,
      trackConfigName: 'Grand Prix',
      corners: [{ index: 1, startPct: 0.2, apexPct: 0.25, endPct: 0.3, minSpeedKmh: 80, entrySpeedKmh: 200, exitSpeedKmh: 180 }]
    }
    const intl: CornerMapData = {
      ...sampleMap,
      trackConfigName: 'International',
      corners: [
        { index: 1, startPct: 0.5, apexPct: 0.55, endPct: 0.6, minSpeedKmh: 70, entrySpeedKmh: 190, exitSpeedKmh: 170 },
        { index: 2, startPct: 0.8, apexPct: 0.85, endPct: 0.9, minSpeedKmh: 60, entrySpeedKmh: 180, exitSpeedKmh: 160 }
      ]
    }
    writePersistedMap(gp)
    writePersistedMap(intl)
    await learner.hydrate()

    // Each layout resolves to its OWN map.
    expect(learner.getCornerMap('Test Circuit', 'Grand Prix')?.corners.length).toBe(1)
    expect(learner.getCornerMap('Test Circuit', 'International')?.corners.length).toBe(2)
    expect(learner.cornerIndexAt('Test Circuit', 0.25, 'Grand Prix')).toBe(1)
    // 0.25 is a straight on the International layout — must NOT bleed from GP.
    expect(learner.cornerIndexAt('Test Circuit', 0.25, 'International')).toBeNull()
    expect(learner.cornerIndexAt('Test Circuit', 0.85, 'International')).toBe(2)

    // A lookup WITHOUT a layout doesn't accidentally pick up a layout-scoped map.
    expect(learner.getCornerMap('Test Circuit')).toBeNull()
    expect(learner.hasCornerMap('Test Circuit', 'Grand Prix')).toBe(true)
    expect(learner.listCornerMaps()).toHaveLength(2)
  })
})
