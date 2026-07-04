import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import type { Logger } from '../../shared/logger'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import { TrackMapLearner } from './learner'

// ─── Test fixtures ───────────────────────────────────────────────────────────

interface LogCall {
  level: 'debug' | 'info' | 'warn' | 'error'
  area: string
  message: string
  detail?: unknown
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

  it('cancelCapture aborts an in-flight recording', async () => {
    await feed(learner, velocityYawLap(lapPcts(0, 0.004, 0.4)))
    expect(learner.getRecordingSnapshot().active).toBe(true)
    learner.cancelCapture()
    expect(learner.getRecordingSnapshot().active).toBe(false)
    expect(learner.getLearnState().phase).toBe('idle')
  })
})

// ─── Corner map (Curva 1..N) persistence + getters ────────────────────────────

import { mkdirSync, writeFileSync } from 'node:fs'
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
