import { describe, expect, it } from 'vitest'
import { LiveCoachEngine, type LiveCoachDeps } from './coach'
import type { CornerMapData } from '../track-map/corner-map'
import type { TelemetrySnapshot } from '../../shared/telemetry'

// ─── Live Coach engine — corner-aware spoken coaching ─────────────────────────
//
// These tests drive the LIVE engine through ≥2 synthetic laps and capture the
// `coach:speak` broadcasts. The corner map is INJECTED (so corner numbering is
// deterministic) and the clock is injected (so the speak cooldown never blocks).
// Telemetry is crafted so the PURE shared analyzer produces the findings we want
// (brake-late + steering-late + throttle-early in Turn 2), proving they reach the
// spoken line. A second scenario injects an EMPTY corner map to exercise the
// 3-sector fallback ("Sector N: …").

const STEP = 0.0025 // lap-distance per sample → 400 samples/lap (well over the 30 min).
const SAMPLE_MS = 50

interface SpeakPayload {
  text: string
  priority: number
  tipId: string
  lang: string
  source?: string
  corner?: number
}

/** A profile: given a lap-distance fraction, the driver inputs at that point. */
type Profile = (pct: number) => {
  speedKmh: number
  throttle: number
  brake: number
  steerDeg: number
  latG: number
  abs: boolean
}

function snap(over: Partial<TelemetrySnapshot>): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 0,
    speedKmh: 200,
    rpm: 8000,
    gear: 4,
    throttle: 1,
    brake: 0,
    clutch: 0,
    steerAngleDeg: 0,
    latAccelG: 0,
    longAccelG: 0,
    onPitRoad: false,
    sessionType: 'Practice',
    trackName: 'Test Circuit',
    currentLap: 1,
    lapDistPct: 0,
    ...over
  }
}

/** Build one lap of snapshots (lapDistPct 0 → ~0.9975) from an input profile. */
function buildLap(profile: Profile, lapNumber: number, startTs: number, lapTimeSec?: number): TelemetrySnapshot[] {
  const out: TelemetrySnapshot[] = []
  let i = 0
  for (let pct = 0; pct < 1; pct += STEP) {
    const p = profile(pct)
    out.push(
      snap({
        timestamp: startTs + i * SAMPLE_MS,
        currentLap: lapNumber,
        lapDistPct: Math.min(0.999999, pct),
        speedKmh: p.speedKmh,
        throttle: p.throttle,
        brake: p.brake,
        steerAngleDeg: p.steerDeg,
        latAccelG: p.latG,
        absActive: p.abs,
        lastLapTimeSec: lapTimeSec,
        bestLapTimeSec: lapTimeSec
      })
    )
    i += 1
  }
  return out
}

// Corner 2 carries three independent mistakes; corner 1 is driven clean.
const CORNER2_START = 0.45
const CORNER2_APEX = 0.55
const CORNER2_END = 0.62

const loadedProfile: Profile = (pct) => {
  // Turn 1 [0.18,0.28] — a CLEAN fast corner: full throttle, turn-in exactly at the
  // entry (no timing error), a speed dip at the apex. Produces NO findings.
  if (pct >= 0.18 && pct < 0.28) {
    return { speedKmh: pct < 0.22 ? 220 : 210, throttle: 0.95, brake: 0, steerDeg: 12, latG: 0.5, abs: false }
  }
  // Turn 2 braking [0.46,0.49) — heavy + long ABS, NO steering (so it reads as a
  // straight-line late brake, not a trail-brake lock).
  if (pct >= 0.46 && pct < 0.49) {
    return { speedKmh: 160, throttle: 0, brake: 1, steerDeg: 0, latG: 0, abs: true }
  }
  // Turn 2 turn-in + early throttle [0.49,0.62) — wheel cranks AFTER entry (late)
  // and the gas comes back BEFORE the apex (early).
  if (pct >= 0.49 && pct < CORNER2_END) {
    return { speedKmh: 150, throttle: 0.85, brake: 0, steerDeg: 30, latG: 1.2, abs: false }
  }
  // Everything else — flat-out straight.
  return { speedKmh: 235, throttle: 0.95, brake: 0, steerDeg: 0, latG: 0, abs: false }
}

// A CLEAN lap where both corners are driven without brake/steer/throttle errors —
// only the corner-1 apex min-speed is parametrised, so a SLOWER lap vs a faster
// reference yields a pure corner-scoped `time-loss` finding (carry more min-speed)
// with NO competing dimension. Used to prove the time-loss fallback cue speaks.
function cleanProfile(corner1MinSpeed: number): Profile {
  return (pct) => {
    // Corner 1 [0.18,0.28] — gradient so the apex (min speed) sits mid-corner like the
    // clean reference corner; only the apex min-speed is parametrised.
    if (pct >= 0.18 && pct < 0.28) {
      return { speedKmh: pct < 0.22 ? corner1MinSpeed + 12 : corner1MinSpeed, throttle: 0.95, brake: 0, steerDeg: 12, latG: 0.5, abs: false }
    }
    // Corner 2 [0.45,0.62] — driven clean and IDENTICALLY on every lap (no time-loss).
    if (pct >= 0.45 && pct < 0.62) {
      return { speedKmh: pct < 0.55 ? 190 : 178, throttle: 0.95, brake: 0, steerDeg: 12, latG: 0.5, abs: false }
    }
    return { speedKmh: 235, throttle: 0.95, brake: 0, steerDeg: 0, latG: 0, abs: false }
  }
}

function twoCornerMap(): CornerMapData {
  return {
    version: 1,
    trackName: 'Test Circuit',
    configKey: 'test',
    corners: [
      { index: 1, startPct: 0.18, apexPct: 0.22, endPct: 0.28, minSpeedKmh: 150, entrySpeedKmh: 200, exitSpeedKmh: 200 },
      {
        index: 2,
        startPct: CORNER2_START,
        apexPct: CORNER2_APEX,
        endPct: CORNER2_END,
        minSpeedKmh: 130,
        entrySpeedKmh: 235,
        exitSpeedKmh: 180
      }
    ],
    generatedAt: 0,
    sampleCount: 400
  }
}

function emptyCornerMap(): CornerMapData {
  return {
    version: 1,
    trackName: 'Test Circuit',
    configKey: 'test',
    corners: [],
    generatedAt: 0,
    sampleCount: 400
  }
}

// SPARSE map: only Turn 1 (the clean corner) is numbered. Turn 2's mistakes fall
// in an UNMAPPED region → they must be coached by SECTOR, not mislabeled.
function oneCornerMap(): CornerMapData {
  return {
    version: 1,
    trackName: 'Test Circuit',
    configKey: 'test',
    corners: [
      { index: 1, startPct: 0.18, apexPct: 0.22, endPct: 0.28, minSpeedKmh: 150, entrySpeedKmh: 200, exitSpeedKmh: 200 }
    ],
    generatedAt: 0,
    sampleCount: 400
  }
}

interface Harness {
  engine: LiveCoachEngine
  speaks: SpeakPayload[]
  feed(snaps: TelemetrySnapshot[]): void
}

function makeHarness(buildCornerMap: () => CornerMapData): Harness {
  const speaks: SpeakPayload[] = []
  let clock = 1_000_000
  const deps: LiveCoachDeps = {
    broadcast: (channel, payload) => {
      if (channel === 'coach:speak') speaks.push(payload as SpeakPayload)
    },
    // Ignore the captured samples — return a FIXED map so numbering is deterministic.
    buildCornerMap: () => buildCornerMap(),
    now: () => clock
  }
  const engine = new LiveCoachEngine(deps)
  return {
    engine,
    speaks,
    feed(snaps) {
      for (const s of snaps) {
        engine.onSnapshot(s)
        clock += 6000 // advance past SPEAK_COOLDOWN_MS so distinct corners can all speak
      }
    }
  }
}

describe('LiveCoachEngine — corner-aware spoken coaching', () => {
  it('names the corner ("Turn N") and surfaces brake + steering + throttle in ONE composite line', () => {
    const h = makeHarness(twoCornerMap)
    h.engine.start()
    // Lap 1 learns the corner map + findings; lap 2 the car EXITS the corners and speaks.
    h.feed(buildLap(loadedProfile, 1, 0, undefined))
    h.feed(buildLap(loadedProfile, 2, 1_000_000, 95.0))

    expect(h.speaks.length).toBeGreaterThan(0)
    const curva2 = h.speaks.find((s) => s.text.startsWith('Turn 2 (Sector'))
    expect(curva2, `expected a "Turn 2 (Sector M):" call-out, got ${JSON.stringify(h.speaks.map((s) => s.text))}`).toBeTruthy()
    // All three driving dimensions reached the spoken line.
    expect(curva2!.text).toContain('brake earlier') // brake point (brake-late)
    expect(curva2!.text).toContain('turn in earlier') // turn-in TIMING (steering-late)
    expect(curva2!.text).toContain('throttle later') // throttle application (throttle-early)
    expect(curva2!.tipId).toBe('live:corner:2')
    expect(curva2!.lang).toBe('pt-BR')
  })

  it('surfaces the turn-in TIMING dimension (steering-late → "turn in earlier") in the spoken line', () => {
    const h = makeHarness(twoCornerMap)
    h.engine.start()
    h.feed(buildLap(loadedProfile, 1, 0, undefined))
    h.feed(buildLap(loadedProfile, 2, 1_000_000, 95.0))

    const text = h.speaks.map((s) => s.text).join(' | ')
    expect(text).toMatch(/Turn 2 \(Sector \d+\):.*turn in earlier/)
  })

  it('only calls out the corner that actually lost time — the clean Turn 1 stays silent', () => {
    const h = makeHarness(twoCornerMap)
    h.engine.start()
    h.feed(buildLap(loadedProfile, 1, 0, undefined))
    h.feed(buildLap(loadedProfile, 2, 1_000_000, 95.0))

    expect(h.speaks.some((s) => s.text.startsWith('Turn 1 (Sector'))).toBe(false)
    expect(h.speaks.some((s) => s.text.startsWith('Turn 2 (Sector'))).toBe(true)
  })

  it('falls back to the 3-sector model ("Sector N: …") when no corner map can be learned', () => {
    const h = makeHarness(emptyCornerMap)
    h.engine.start()
    h.feed(buildLap(loadedProfile, 1, 0, undefined))
    h.feed(buildLap(loadedProfile, 2, 1_000_000, 95.0))

    expect(h.speaks.length).toBeGreaterThan(0)
    // No corner map → every CORNER/SECTOR call-out is sector-scoped, never corner-scoped.
    // (The one-shot warm-up cue is not a segment call-out, so exclude it.)
    const calls = h.speaks.filter((s) => s.tipId !== 'live:warmup')
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((s) => s.text.startsWith('Sector '))).toBe(true)
    expect(calls.some((s) => s.text.startsWith('Turn '))).toBe(false)
    // The braking mistake lives in sector 2 (lapDistPct ≈ 0.47).
    const sector2 = calls.find((s) => s.text.startsWith('Sector 2:'))
    expect(sector2).toBeTruthy()
    expect(sector2!.text).toContain('brake earlier')
  })

  it('stays SILENT in a race (the proactive engineer owns the audio there)', () => {
    const h = makeHarness(twoCornerMap)
    h.engine.start()
    const race = (s: TelemetrySnapshot): TelemetrySnapshot => ({ ...s, sessionType: 'Race' })
    h.feed(buildLap(loadedProfile, 1, 0, undefined).map(race))
    h.feed(buildLap(loadedProfile, 2, 1_000_000, 95.0).map(race))

    expect(h.speaks.length).toBe(0)
  })

  it('emits only the warm-up cue (no segment call-outs) before a full lap is analyzed', () => {
    const h = makeHarness(twoCornerMap)
    h.engine.start()
    // Feed PART of lap 1 only — no lap completion, so NO findings, so no segment advice.
    const partial = buildLap(loadedProfile, 1, 0, undefined).filter((s) => (s.lapDistPct ?? 0) < 0.7)
    h.feed(partial)
    // The coach must NOT sit silent for minutes: it speaks a single warm-up cue…
    expect(h.speaks.every((s) => s.tipId === 'live:warmup')).toBe(true)
    expect(h.speaks.filter((s) => s.tipId === 'live:warmup').length).toBe(1)
    // …but no corner/sector call-out fires without an analyzed lap.
    expect(h.speaks.some((s) => s.tipId !== 'live:warmup')).toBe(false)
  })

  it('tags every spoken corner call-out with { source: "coach", corner } for observability', () => {
    const h = makeHarness(twoCornerMap)
    h.engine.start()
    h.feed(buildLap(loadedProfile, 1, 0, undefined))
    h.feed(buildLap(loadedProfile, 2, 1_000_000, 95.0))

    // Every utterance is attributed to the coach (so it never looks "dead" in logs).
    expect(h.speaks.length).toBeGreaterThan(0)
    expect(h.speaks.every((s) => s.source === 'coach')).toBe(true)
    const curva2 = h.speaks.find((s) => s.text.startsWith('Turn 2 (Sector'))
    expect(curva2!.corner).toBe(2)
    // The warm-up cue is corner-less.
    const warmup = h.speaks.find((s) => s.tipId === 'live:warmup')
    expect(warmup?.corner).toBeUndefined()
  })

  it('degrades to SECTOR naming for mistakes outside a sparse corner map (item 4)', () => {
    const h = makeHarness(oneCornerMap)
    h.engine.start()
    h.feed(buildLap(loadedProfile, 1, 0, undefined))
    h.feed(buildLap(loadedProfile, 2, 1_000_000, 95.0))

    const calls = h.speaks.filter((s) => s.tipId !== 'live:warmup')
    expect(calls.length).toBeGreaterThan(0)
    // Turn 2 is NOT in the map → it must NEVER be mislabeled as a corner…
    expect(calls.some((s) => s.text.startsWith('Turn 2'))).toBe(false)
    // …its mistakes are coached by sector instead.
    const sector2 = calls.find((s) => s.tipId === 'live:sector:2')
    expect(sector2, `expected a Sector 2 fallback, got ${JSON.stringify(calls.map((s) => s.text))}`).toBeTruthy()
    expect(sector2!.text.startsWith('Sector 2:')).toBe(true)
    expect(sector2!.text).toContain('brake earlier')
    expect(sector2!.source).toBe('coach')
  })

  it('speaks the generic time-loss cue ("Turn N: find more time here") for a min-speed-only corner', () => {
    // Regression guard (v2.36.0): a corner whose ONLY loss is carrying less apex speed
    // than the reference (a dimension-less `time-loss`) must still be coached.
    const h = makeHarness(twoCornerMap)
    h.engine.start()
    // Lap 1 (FAST, 95.0): clean, high corner-1 min-speed → becomes the reference lap.
    h.feed(buildLap(cleanProfile(210), 1, 0, 95.0))
    // Lap 2 (SLOWER, 96.0): same clean inputs but LOWER corner-1 min-speed → vs the
    // reference this yields a pure corner-1 time-loss finding (computed at lap end).
    h.feed(buildLap(cleanProfile(185), 2, 1_000_000, 96.0))
    // Lap 3: the car exits corner 1 again → it now speaks lap-2's time-loss finding.
    h.feed(buildLap(cleanProfile(185), 3, 2_000_000, 96.0))

    const curva1 = h.speaks.find((s) => s.text.startsWith('Turn 1 (Sector'))
    expect(curva1, `expected a Turn 1 time-loss cue, got ${JSON.stringify(h.speaks.map((s) => s.text))}`).toBeTruthy()
    expect(curva1!.text).toContain('find more time here')
    expect(curva1!.corner).toBe(1)
    expect(curva1!.source).toBe('coach')
  })
})
