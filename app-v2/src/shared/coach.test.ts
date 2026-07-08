import { describe, expect, it } from 'vitest'
import {
  analyzeConsistency,
  analyzeLap,
  bidirectionalCornerFindings,
  buildCoachReport,
  coachActionForCoarseKind,
  coachActionForFindingKind,
  coachActionPhrase,
  coachComposeAction,
  coachDimensionForKind,
  coachSampleFromSnapshot,
  coachSpeakText,
  composeCornerAdvice,
  computeCornerMetrics,
  cornerOf,
  detectCornerTimingFindings,
  deterministicPhrasing,
  detectBrakingZones,
  detectCoastZones,
  mergeCoachConfig,
  phaseForSample,
  rankFindings,
  sectorOf,
  severityForLoss,
  summarizeSectors,
  DEFAULT_COACH_CONFIG,
  type CoachCornerMap,
  type CoachCornerMetrics,
  type CoachFinding,
  type CoachFindingKind,
  type CoachLapBuffer,
  type CoachLapSample,
  type CoachReferenceLap,
  type CoachTip
} from './coach'
import type { TelemetrySnapshot } from './telemetry'

// ─── Synthetic telemetry helpers ──────────────────────────────────────────────
// A lap is built from sequential "segments"; each segment is N frames at 50 ms
// (20 Hz) holding a set of input overrides. Lap distance advances linearly across
// the whole lap so a segment lands in a predictable sector (sectorCount = 3).

const SAMPLE_MS = 50

function frame(over: Partial<CoachLapSample>): Partial<CoachLapSample> {
  return over
}

interface Segment {
  n: number
  fields: Partial<CoachLapSample>
}

function buildLap(segments: Segment[], sectorCount = 3): CoachLapBuffer {
  const total = segments.reduce((sum, s) => sum + s.n, 0)
  const samples: CoachLapSample[] = []
  let idx = 0
  for (const seg of segments) {
    for (let k = 0; k < seg.n; k += 1) {
      const pct = total > 1 ? (idx / (total - 1)) * 0.999 : 0
      samples.push({
        t: idx * SAMPLE_MS,
        lapDistPct: pct,
        speedKmh: 150,
        throttle: 1,
        brake: 0,
        clutch: 0,
        steerAbsDeg: 0,
        latAbsG: 0,
        longAccelG: 0,
        gear: 4,
        rpm: 7000,
        absActive: false,
        tcActive: false,
        ...seg.fields
      })
      idx += 1
    }
  }
  return { sectorCount, samples, lapNumber: 12 }
}

function kinds(findings: CoachFinding[]): string[] {
  return findings.map((f) => f.kind)
}

describe('coach config (persisted)', () => {
  it('defaults Live Coach engine + speech ON and "Frasear com IA" OFF', () => {
    expect(DEFAULT_COACH_CONFIG.enabled).toBe(true)
    expect(DEFAULT_COACH_CONFIG.speakTopTip).toBe(true)
    expect(DEFAULT_COACH_CONFIG.phraseWithAi).toBe(false)
  })

  it('mergeCoachConfig layers a patch and ignores garbage fields', () => {
    const merged = mergeCoachConfig(DEFAULT_COACH_CONFIG, {
      phraseWithAi: true,
      // @ts-expect-error unknown field must be dropped by the sanitizer
      bogus: 'x'
    })
    expect(merged.phraseWithAi).toBe(true)
    expect(merged.enabled).toBe(true) // untouched base value
    expect(merged.speakTopTip).toBe(true) // untouched base value
    expect(merged.version).toBe(1)
    expect('bogus' in merged).toBe(false)
  })

  it('mergeCoachConfig persists the user disabling the engine', () => {
    const off = mergeCoachConfig(DEFAULT_COACH_CONFIG, { enabled: false })
    expect(off.enabled).toBe(false)
    // A later no-op patch keeps the disabled state (the "Parar" choice sticks).
    expect(mergeCoachConfig(off, {}).enabled).toBe(false)
  })

  it('mergeCoachConfig keeps base values when patch omits them', () => {
    const base = mergeCoachConfig(DEFAULT_COACH_CONFIG, { speakTopTip: false })
    const merged = mergeCoachConfig(base, {})
    expect(merged.speakTopTip).toBe(false)
    expect(merged.phraseWithAi).toBe(false)
    expect(merged.enabled).toBe(true)
  })
})

describe('sectorOf', () => {
  it('maps lap-distance fraction to a 1-based sector', () => {
    expect(sectorOf(0, 3)).toBe(1)
    expect(sectorOf(0.33, 3)).toBe(1)
    expect(sectorOf(0.34, 3)).toBe(2)
    expect(sectorOf(0.67, 3)).toBe(3)
    expect(sectorOf(0.999, 3)).toBe(3)
    expect(sectorOf(1.5, 3)).toBe(3) // clamped
  })
})

describe('phaseForSample', () => {
  const base: CoachLapSample = {
    t: 0, lapDistPct: 0, speedKmh: 100, throttle: 0, brake: 0, clutch: 0,
    steerAbsDeg: 0, latAbsG: 0, longAccelG: 0, gear: 3, rpm: 6000, absActive: false, tcActive: false
  }
  it('classifies entry/exit/mid by pedals', () => {
    expect(phaseForSample({ ...base, brake: 0.5 })).toBe('entry')
    expect(phaseForSample({ ...base, throttle: 0.8 })).toBe('exit')
    expect(phaseForSample({ ...base, throttle: 0, brake: 0 })).toBe('mid')
  })
})

describe('severityForLoss', () => {
  it('escalates with estimated time loss', () => {
    expect(severityForLoss(0.0, true)).toBe('good')
    expect(severityForLoss(0.02)).toBe('low')
    expect(severityForLoss(0.1)).toBe('med')
    expect(severityForLoss(0.3)).toBe('high')
  })
})

describe('coachSampleFromSnapshot', () => {
  const snap = (over: Partial<TelemetrySnapshot>): TelemetrySnapshot =>
    ({ sim: 'iracing', connected: true, timestamp: 1000, speedKmh: 120, rpm: 7000, gear: 4, throttle: 1, brake: 0, clutch: 0, lapDistPct: 0.5, ...over }) as TelemetrySnapshot

  it('reduces a usable snapshot and normalises absolute values', () => {
    const s = coachSampleFromSnapshot(snap({ steerAngleDeg: -30, latAccelG: -1.2, absActive: true }))
    expect(s).not.toBeNull()
    expect(s?.steerAbsDeg).toBe(30)
    expect(s?.latAbsG).toBeCloseTo(1.2)
    expect(s?.absActive).toBe(true)
  })

  it('returns null when disconnected or lapDistPct/speed missing', () => {
    expect(coachSampleFromSnapshot(null)).toBeNull()
    expect(coachSampleFromSnapshot(snap({ connected: false }))).toBeNull()
    expect(coachSampleFromSnapshot(snap({ lapDistPct: undefined }))).toBeNull()
    expect(coachSampleFromSnapshot(snap({ speedKmh: Number.NaN }))).toBeNull()
  })
})

describe('detectBrakingZones', () => {
  it('finds one contiguous braking zone and measures coast-after', () => {
    const lap = buildLap([
      { n: 6, fields: frame({ throttle: 1, brake: 0 }) },
      { n: 10, fields: frame({ throttle: 0, brake: 0.8, speedKmh: 120, absActive: true }) },
      { n: 8, fields: frame({ throttle: 0, brake: 0, speedKmh: 110 }) }, // coast after release
      { n: 6, fields: frame({ throttle: 1, brake: 0 }) }
    ])
    const zones = detectBrakingZones(lap.samples)
    expect(zones).toHaveLength(1)
    expect(zones[0].maxBrake).toBeCloseTo(0.8)
    expect(zones[0].absMs).toBeGreaterThan(400)
    expect(zones[0].coastAfterMs).toBeGreaterThan(300)
  })
})

describe('detectCoastZones', () => {
  it('finds coasting above the speed floor', () => {
    const lap = buildLap([
      { n: 6, fields: frame({ throttle: 1, brake: 0 }) },
      { n: 16, fields: frame({ throttle: 0, brake: 0, speedKmh: 120, latAbsG: 0.6 }) },
      { n: 6, fields: frame({ throttle: 1, brake: 0 }) }
    ])
    const zones = detectCoastZones(lap.samples)
    expect(zones).toHaveLength(1)
    expect(zones[0].durMs).toBeGreaterThan(600)
    expect(zones[0].maxLatG).toBeCloseTo(0.6)
  })
})

describe('analyzeLap — symptom detection', () => {
  it('flags trail-braking lock-up (hard brake while turning + ABS)', () => {
    const lap = buildLap([
      { n: 20, fields: frame({ throttle: 1 }) },
      { n: 12, fields: frame({ throttle: 0, brake: 0.85, steerAbsDeg: 28, latAbsG: 0.95, absActive: true, speedKmh: 120 }) },
      { n: 20, fields: frame({ throttle: 1 }) }
    ])
    const f = analyzeLap(lap)
    expect(kinds(f)).toContain('trail-brake-lock')
    const tb = f.find((x) => x.kind === 'trail-brake-lock')!
    expect(tb.phase).toBe('entry')
    expect(tb.estTimeLossSec).toBeGreaterThan(0)
  })

  it('flags heavy/late straight-line braking (peak + long ABS, no steering)', () => {
    const lap = buildLap([
      { n: 20, fields: frame({ throttle: 1 }) },
      { n: 16, fields: frame({ throttle: 0, brake: 0.97, steerAbsDeg: 1, latAbsG: 0.1, absActive: true, speedKmh: 90 }) },
      { n: 20, fields: frame({ throttle: 1 }) }
    ])
    const f = analyzeLap(lap)
    expect(kinds(f)).toContain('brake-late')
    expect(kinds(f)).not.toContain('trail-brake-lock')
  })

  it('flags braking too early (moderate brake then a long coast before the corner)', () => {
    const lap = buildLap([
      { n: 20, fields: frame({ throttle: 1 }) },
      { n: 18, fields: frame({ throttle: 0, brake: 0.5, steerAbsDeg: 2, latAbsG: 0.1, speedKmh: 120 }) },
      { n: 16, fields: frame({ throttle: 0, brake: 0, speedKmh: 100, latAbsG: 0.2 }) },
      { n: 20, fields: frame({ throttle: 1 }) }
    ])
    const f = analyzeLap(lap)
    expect(kinds(f)).toContain('brake-early')
  })

  it('flags mid-corner coasting (off both pedals, loaded)', () => {
    const lap = buildLap([
      { n: 20, fields: frame({ throttle: 1 }) },
      { n: 20, fields: frame({ throttle: 0, brake: 0, latAbsG: 0.7, speedKmh: 120 }) },
      { n: 20, fields: frame({ throttle: 1 }) }
    ])
    const f = analyzeLap(lap)
    const coast = f.find((x) => x.kind === 'coast')
    expect(coast).toBeDefined()
    expect(coast?.phase).toBe('mid')
  })

  it('flags throttle hesitation on exit (stuck at part throttle)', () => {
    const lap = buildLap([
      { n: 20, fields: frame({ throttle: 1 }) },
      { n: 16, fields: frame({ throttle: 0.4, brake: 0, latAbsG: 0.3, speedKmh: 100 }) },
      { n: 20, fields: frame({ throttle: 1 }) }
    ])
    const f = analyzeLap(lap)
    expect(kinds(f)).toContain('throttle-hesitation')
  })

  it('flags ABS overuse and TC overuse per sector', () => {
    const absLap = buildLap([
      { n: 20, fields: frame({ throttle: 1 }) },
      { n: 24, fields: frame({ throttle: 0, brake: 0.6, steerAbsDeg: 2, latAbsG: 0.2, absActive: true, speedKmh: 100 }) },
      { n: 20, fields: frame({ throttle: 1 }) }
    ])
    expect(kinds(analyzeLap(absLap))).toContain('abs-overuse')

    const tcLap = buildLap([
      { n: 20, fields: frame({ throttle: 1 }) },
      { n: 24, fields: frame({ throttle: 0.7, brake: 0, tcActive: true, latAbsG: 0.3, speedKmh: 110 }) },
      { n: 20, fields: frame({ throttle: 1 }) }
    ])
    expect(kinds(analyzeLap(tcLap))).toContain('tc-overuse')
  })

  it('flags busy steering (many corrections under load)', () => {
    const segs: Segment[] = [{ n: 10, fields: frame({ throttle: 1 }) }]
    for (let i = 0; i < 24; i += 1) {
      segs.push({ n: 1, fields: frame({ throttle: 0, brake: 0, steerAbsDeg: i % 2 === 0 ? 5 : 35, latAbsG: 0.7, speedKmh: 90 }) })
    }
    segs.push({ n: 10, fields: frame({ throttle: 1 }) })
    const f = analyzeLap(buildLap(segs))
    expect(kinds(f)).toContain('steering-busy')
  })

  it('flags under-rotation (loaded corner, too little lock)', () => {
    // A clearly loaded corner held in ONE sector: high lateral demand (latAbsG ~1.0
    // ⇒ expected ~12° of wheel) but the driver barely turns in (1°). That is
    // "virando pouco" — needs MORE steering, the inverse of busy steering.
    const lap = analyzeLap(buildLap([
      { n: 6, fields: frame({ throttle: 1 }) },
      { n: 40, fields: frame({ throttle: 1, brake: 0, steerAbsDeg: 1, latAbsG: 1.0, speedKmh: 120 }) },
      { n: 6, fields: frame({ throttle: 1 }) }
    ]))
    expect(kinds(lap)).toContain('steering-insufficient')
  })

  it('does NOT flag under-rotation on a straight or at low speed', () => {
    // No lateral load (straight) and a slow hairpin held below the speed gate must
    // never read as under-rotation — keeps the detector conservative.
    const straight = analyzeLap(buildLap([{ n: 60, fields: frame({ throttle: 1, latAbsG: 0, steerAbsDeg: 0 }) }]))
    expect(kinds(straight)).not.toContain('steering-insufficient')
    const slow = analyzeLap(buildLap([
      { n: 6, fields: frame({ throttle: 1 }) },
      { n: 40, fields: frame({ throttle: 0.3, brake: 0, steerAbsDeg: 2, latAbsG: 1.0, speedKmh: 40 }) },
      { n: 6, fields: frame({ throttle: 1 }) }
    ]))
    expect(kinds(slow)).not.toContain('steering-insufficient')
  })

  it('does NOT flag a fast aero corner (high G, little lock) as under-rotation', () => {
    // A flat-out sweeper pulling ~1.6 G with modest wheel angle at high speed is
    // CORRECT driving — the upper-speed guard + 60% ratio must keep it silent
    // (adding lock there would be wrong advice).
    const fast = analyzeLap(buildLap([
      { n: 6, fields: frame({ throttle: 1 }) },
      { n: 40, fields: frame({ throttle: 1, brake: 0, steerAbsDeg: 14, latAbsG: 1.6, speedKmh: 245 }) },
      { n: 6, fields: frame({ throttle: 1 }) }
    ]))
    expect(kinds(fast)).not.toContain('steering-insufficient')
  })

  it('identifies the biggest time-loss zone from the delta channel', () => {
    // Delta to best climbs steeply only in the first sixth of the lap.
    const samples: CoachLapSample[] = []
    const N = 60
    for (let i = 0; i < N; i += 1) {
      const pct = (i / (N - 1)) * 0.999
      const delta = pct < 0.16 ? pct * 2 : 0.32 // rises 0→~0.32 in the first bin, flat after
      samples.push({
        t: i * SAMPLE_MS, lapDistPct: pct, speedKmh: 150, throttle: 1, brake: 0, clutch: 0,
        steerAbsDeg: 0, latAbsG: 0, longAccelG: 0, gear: 5, rpm: 7000, absActive: false, tcActive: false,
        deltaToBestSec: delta
      })
    }
    const f = analyzeLap({ sectorCount: 3, samples })
    const tl = f.find((x) => x.kind === 'time-loss')
    expect(tl).toBeDefined()
    expect(tl!.sector).toBe(1)
    expect(tl!.estTimeLossSec).toBeGreaterThan(0.2)
  })

  it('returns nothing for a too-short buffer', () => {
    expect(analyzeLap({ sectorCount: 3, samples: [] })).toEqual([])
  })
})

describe('rankFindings', () => {
  const mk = (kind: CoachFinding['kind'], sector: number, loss: number, good = false): CoachFinding => ({
    id: `${kind}-${sector}`, kind, sector, zonePctStart: 0, zonePctEnd: 0.1,
    severity: good ? 'good' : 'med', estTimeLossSec: good ? 0 : loss, title: kind, detail: '', evidence: '', metrics: {}
  })

  it('sorts worst-first and sinks good findings to the bottom', () => {
    const ranked = rankFindings([
      mk('good', 1, 0, true),
      mk('coast', 2, 0.1),
      mk('brake-late', 3, 0.4)
    ])
    expect(ranked[0].kind).toBe('brake-late')
    expect(ranked[1].kind).toBe('coast')
    expect(ranked[ranked.length - 1].kind).toBe('good')
  })

  it('keeps only the worst finding per (kind, sector)', () => {
    const ranked = rankFindings([mk('coast', 2, 0.1), mk('coast', 2, 0.3)])
    expect(ranked).toHaveLength(1)
    expect(ranked[0].estTimeLossSec).toBeCloseTo(0.3)
  })
})

describe('analyzeConsistency', () => {
  it('rates a tight string of laps', () => {
    const c = analyzeConsistency([90.0, 90.1, 89.95, 90.05])
    expect(c?.rating).toBe('tight')
    expect(c?.laps).toBe(4)
  })
  it('rates a loose string of laps', () => {
    const c = analyzeConsistency([90.0, 91.5, 89.0, 92.0])
    expect(c?.rating).toBe('loose')
  })
  it('needs at least three valid laps', () => {
    expect(analyzeConsistency([90, 90])).toBeUndefined()
    expect(analyzeConsistency([90, Number.NaN, -1])).toBeUndefined()
  })
})

describe('summarizeSectors', () => {
  it('marks a clean full-throttle sector as a benchmark', () => {
    const lap = buildLap([{ n: 60, fields: frame({ throttle: 1 }) }])
    const s = summarizeSectors(lap)
    expect(s).toHaveLength(3)
    expect(s.every((x) => x.benchmark)).toBe(true)
    expect(s[0].throttlePct).toBeGreaterThan(0.9)
  })
})

describe('buildCoachReport', () => {
  it('assembles findings + sectors + consistency + a headline', () => {
    const lap = buildLap([
      { n: 20, fields: frame({ throttle: 1 }) },
      { n: 22, fields: frame({ throttle: 0, brake: 0, latAbsG: 0.7, speedKmh: 120 }) }, // mid coast
      { n: 20, fields: frame({ throttle: 1 }) }
    ])
    lap.lapTimeSec = 91.2
    lap.bestLapTimeSec = 90.4
    const report = buildCoachReport(lap, { recentLapTimesSec: [90.4, 90.6, 91.2], now: 1234 })
    expect(report.generatedAt).toBe(1234)
    expect(report.deltaToBestSec).toBeCloseTo(0.8)
    expect(report.findings.length).toBeGreaterThan(0)
    expect(report.consistency).toBeDefined()
    expect(report.summary).toMatch(/vs melhor/i)
  })

  it('produces a clean-lap summary when there are no issues', () => {
    const lap = buildLap([{ n: 60, fields: frame({ throttle: 1 }) }])
    const report = buildCoachReport(lap)
    const issues = report.findings.filter((f) => f.severity !== 'good')
    expect(issues).toHaveLength(0)
    expect(report.summary).toMatch(/limpa/i)
  })

  it('surfaces an inconsistency finding when recent laps are loose', () => {
    const lap = buildLap([{ n: 60, fields: frame({ throttle: 1 }) }])
    const report = buildCoachReport(lap, { recentLapTimesSec: [90.0, 91.6, 89.1, 92.0] })
    expect(report.consistency?.rating).toBe('loose')
    expect(report.findings.map((f) => f.kind)).toContain('inconsistency')
  })
})

describe('deterministicPhrasing', () => {
  it('renders a finding into a single LLM-free sentence with the loss', () => {
    const lap = buildLap([
      { n: 20, fields: frame({ throttle: 1 }) },
      { n: 22, fields: frame({ throttle: 0, brake: 0, latAbsG: 0.7, speedKmh: 120 }) },
      { n: 20, fields: frame({ throttle: 1 }) }
    ])
    const coast = analyzeLap(lap).find((f) => f.kind === 'coast')!
    const text = deterministicPhrasing(coast)
    expect(text).toContain(coast.title)
    expect(text).toMatch(/Perda estimada/i)
  })
})

// ─── Per-corner timing + bidirectional findings ───────────────────────────────

const ONE_CORNER: CoachCornerMap = {
  corners: [{ index: 1, startPct: 0.4, apexPct: 0.5, endPct: 0.6 }]
}

interface CornerLapOpts {
  /** lapDistPct where steering crosses the turn-in threshold (>8°). */
  steerStart: number
  /** lapDistPct where throttle is (re)applied past the apex. */
  throttleStart: number
  /** lapDistPct where braking begins. */
  brakeStart?: number
  /** lapDistPct where braking ends (defaults to the apex). */
  brakeEnd?: number
  /** apex (minimum) speed, km/h. */
  minSpeed?: number
  n?: number
}

// One isolated corner over lapDistPct 0..1 with controllable input timing, so each
// timing finding can be provoked deterministically against ONE_CORNER's geometry.
function cornerLap(opts: CornerLapOpts): CoachLapBuffer {
  const n = opts.n ?? 240
  const brakeStart = opts.brakeStart ?? 0.38
  const apex = 0.5
  const brakeEnd = opts.brakeEnd ?? apex
  const minSpeed = opts.minSpeed ?? 80
  const samples: CoachLapSample[] = []
  for (let i = 0; i < n; i += 1) {
    const pct = (i / (n - 1)) * 0.999
    const nearApex = Math.max(0, 1 - Math.abs(pct - apex) / 0.12)
    const speedKmh = 250 - (250 - minSpeed) * nearApex
    const braking = pct >= brakeStart && pct < brakeEnd
    const onThrottle = pct >= opts.throttleStart
    const steering = pct >= opts.steerStart && pct < 0.62
    samples.push({
      t: i * 50,
      lapDistPct: pct,
      throttle: braking ? 0 : onThrottle ? 1 : pct < brakeStart ? 1 : 0,
      speedKmh,
      brake: braking ? 0.9 : 0,
      clutch: 0,
      steerAbsDeg: steering ? 35 : 0,
      latAbsG: steering ? 1.0 : 0,
      longAccelG: 0,
      gear: 4,
      rpm: 7000,
      absActive: false,
      tcActive: false
    })
  }
  return { sectorCount: 3, samples, lapNumber: 7 }
}

describe('cornerOf (lapDistPct → corner)', () => {
  it('maps a point inside a corner extent and null on a straight', () => {
    expect(cornerOf(ONE_CORNER, 0.5)?.index).toBe(1)
    expect(cornerOf(ONE_CORNER, 0.1)).toBeNull()
    expect(cornerOf(null, 0.5)).toBeNull()
  })
})

describe('detectCornerTimingFindings — new kinds', () => {
  it('flags steering-early when the turn-in is well before the entry', () => {
    const lap = cornerLap({ steerStart: 0.33, throttleStart: 0.55 })
    const f = detectCornerTimingFindings(lap.samples, ONE_CORNER)
    const steer = f.find((x) => x.kind === 'steering-early')
    expect(steer).toBeTruthy()
    expect(steer!.corner).toBe(1)
    expect(steer!.sign).toBe('loss')
  })

  it('flags steering-late when the turn-in is after the entry', () => {
    const lap = cornerLap({ steerStart: 0.46, throttleStart: 0.55 })
    const f = detectCornerTimingFindings(lap.samples, ONE_CORNER)
    expect(f.map((x) => x.kind)).toContain('steering-late')
  })

  it('flags throttle-early when on the power before the apex', () => {
    const lap = cornerLap({ steerStart: 0.41, throttleStart: 0.45, brakeStart: 0.38, brakeEnd: 0.43 })
    const f = detectCornerTimingFindings(lap.samples, ONE_CORNER)
    const thr = f.find((x) => x.kind === 'throttle-early')
    expect(thr).toBeTruthy()
    expect(thr!.corner).toBe(1)
  })

  it('flags throttle-late when the power comes well after the exit', () => {
    const lap = cornerLap({ steerStart: 0.41, throttleStart: 0.66 })
    const f = detectCornerTimingFindings(lap.samples, ONE_CORNER)
    expect(f.map((x) => x.kind)).toContain('throttle-late')
  })
})

describe('analyzeLap with a corner map', () => {
  it('attaches a corner number to findings inside a corner', () => {
    const lap = cornerLap({ steerStart: 0.33, throttleStart: 0.55 })
    const findings = analyzeLap(lap, undefined, { cornerMap: ONE_CORNER })
    const cornered = findings.filter((f) => f.corner === 1)
    expect(cornered.length).toBeGreaterThan(0)
  })
})

describe('bidirectionalCornerFindings — gains AND losses', () => {
  const current: CoachCornerMetrics[] = [
    { corner: 1, minSpeedKmh: 95, entrySpeedKmh: 200, brakeStartPct: 0.45, throttleStartPct: 0.52 }
  ]

  it('emits a min-speed GAIN with a positive signed delta + explanation', () => {
    const reference: CoachReferenceLap = {
      corners: [{ corner: 1, minSpeedKmh: 85, entrySpeedKmh: 200, brakeStartPct: 0.42, throttleStartPct: 0.55 }]
    }
    const f = bidirectionalCornerFindings(current, reference, ONE_CORNER)
    const gain = f.find((x) => x.kind === 'min-speed-gain')
    expect(gain).toBeTruthy()
    expect(gain!.sign).toBe('gain')
    expect(gain!.estTimeDeltaSec!).toBeGreaterThan(0)
    expect(gain!.explanation).toBeTruthy()
    expect(gain!.corner).toBe(1)
  })

  it('emits a LOSS with a negative signed delta when slower than reference', () => {
    const slow: CoachCornerMetrics[] = [
      { corner: 1, minSpeedKmh: 70, entrySpeedKmh: 190, brakeStartPct: 0.4, throttleStartPct: 0.58 }
    ]
    const reference: CoachReferenceLap = {
      corners: [{ corner: 1, minSpeedKmh: 90, entrySpeedKmh: 200, brakeStartPct: 0.42, throttleStartPct: 0.55 }]
    }
    const f = bidirectionalCornerFindings(slow, reference, ONE_CORNER)
    const loss = f.find((x) => x.sign === 'loss')
    expect(loss).toBeTruthy()
    expect(loss!.estTimeDeltaSec!).toBeLessThan(0)
  })

  it('emits a brake-gain when braking later AND keeping apex speed', () => {
    const reference: CoachReferenceLap = {
      corners: [{ corner: 1, minSpeedKmh: 93, entrySpeedKmh: 200, brakeStartPct: 0.40, throttleStartPct: 0.55 }]
    }
    const f = bidirectionalCornerFindings(current, reference, ONE_CORNER)
    expect(f.map((x) => x.kind)).toContain('brake-gain')
    const brakeGain = f.find((x) => x.kind === 'brake-gain')!
    expect(brakeGain.sign).toBe('gain')
  })

  it('emits a throttle-gain when on the power earlier than reference', () => {
    const reference: CoachReferenceLap = {
      corners: [{ corner: 1, minSpeedKmh: 95, entrySpeedKmh: 200, brakeStartPct: 0.45, throttleStartPct: 0.58 }]
    }
    const f = bidirectionalCornerFindings(current, reference, ONE_CORNER)
    expect(f.map((x) => x.kind)).toContain('throttle-gain')
  })
})

describe('buildCoachReport with corner map + reference', () => {
  it('populates report.corners and report.cornerMetrics, and gains keep loss-free severity', () => {
    const lap = cornerLap({ steerStart: 0.41, throttleStart: 0.55 })
    const reference: CoachReferenceLap = {
      corners: [{ corner: 1, minSpeedKmh: 60, entrySpeedKmh: 200, brakeStartPct: 0.42, throttleStartPct: 0.7 }]
    }
    const report = buildCoachReport(lap, { cornerMap: ONE_CORNER, reference })
    expect(report.corners.map((c) => c.index)).toEqual([1])
    expect(report.cornerMetrics.length).toBe(1)
    const gain = report.findings.find((f) => f.sign === 'gain')
    expect(gain).toBeTruthy()
    expect(gain!.estTimeLossSec).toBe(0)
  })
})

// ─── Spoken corrective phrases (terse, improvement-only imperatives) ──────────

function tip(over: Partial<CoachTip>): CoachTip {
  return {
    id: 'live:braking:s1',
    kind: 'braking',
    severity: 'high',
    message: 'Late/hard braking: brake a little earlier and release the brake progressively.',
    estTimeLossSec: 0.3,
    createdAt: 0,
    ...over
  }
}

describe('coachActionForFindingKind — directional imperatives', () => {
  const cases: Array<[CoachFindingKind, string]> = [
    ['brake-late', 'brake earlier'],
    ['brake-early', 'freie mais tarde'],
    ['throttle-late', 'acelere antes'],
    ['throttle-early', 'acelere mais tarde'],
    ['steering-late', 'turn in earlier'],
    ['steering-early', 'vire mais tarde'],
    ['trail-brake-lock', 'release the brake as you turn'],
    ['coast', 'do not coast — brake or accelerate'],
    ['throttle-hesitation', 'commit to throttle'],
    ['abs-overuse', 'release the brake'],
    ['tc-overuse', 'smooth the throttle on exit'],
    ['steering-busy', 'smooth the entry, one arc'],
    ['steering-insufficient', 'more steering'],
    ['inconsistency', 'repita os mesmos pontos de freada']
  ]

  it.each(cases)('maps %s → "%s"', (kind, expected) => {
    expect(coachActionForFindingKind(kind)).toBe(expected)
  })

  it('returns a non-empty terse phrase for every finding kind', () => {
    const kinds: CoachFindingKind[] = [
      'brake-early', 'brake-late', 'throttle-early', 'throttle-late',
      'steering-early', 'steering-late', 'trail-brake-lock', 'coast',
      'throttle-hesitation', 'abs-overuse', 'tc-overuse', 'steering-busy',
      'steering-insufficient', 'inconsistency', 'time-loss', 'min-speed-gain',
      'brake-gain', 'throttle-gain', 'good'
    ]
    for (const k of kinds) {
      const phrase = coachActionForFindingKind(k)
      expect(phrase.length).toBeGreaterThan(0)
      expect(phrase).not.toMatch(/perda estimada/i)
    }
  })
})

describe('coachActionForCoarseKind — fallback imperatives', () => {
  it('maps braking → brake earlier', () => {
    expect(coachActionForCoarseKind('braking')).toBe('brake earlier')
  })
  it('maps throttle → acelere antes', () => {
    expect(coachActionForCoarseKind('throttle')).toBe('acelere antes')
  })
  it('maps coast → do not coast — brake or accelerate', () => {
    expect(coachActionForCoarseKind('coast')).toBe('do not coast — brake or accelerate')
  })
  it('maps steering → smooth the entry, one arc', () => {
    expect(coachActionForCoarseKind('steering')).toBe('smooth the entry, one arc')
  })
  it('maps abs → release the brake', () => {
    expect(coachActionForCoarseKind('abs')).toBe('release the brake')
  })
  it('maps tc → smooth the throttle on exit', () => {
    expect(coachActionForCoarseKind('tc')).toBe('smooth the throttle on exit')
  })
})

describe('coachActionPhrase — prefers stored directional action', () => {
  it('returns the tip.action when present', () => {
    expect(coachActionPhrase(tip({ action: 'freie mais tarde' }))).toBe('freie mais tarde')
  })
  it('falls back to coarse kind when action is missing', () => {
    expect(coachActionPhrase(tip({ kind: 'braking', action: undefined }))).toBe('brake earlier')
  })
  it('falls back to coarse kind when action is blank', () => {
    expect(coachActionPhrase(tip({ kind: 'tc', action: '   ' }))).toBe('smooth the throttle on exit')
  })
})

describe('coachSpeakText — terse spoken call-out', () => {
  it('speaks "Sector N, <imperative>." when the tip has a sector', () => {
    expect(coachSpeakText(tip({ sector: 3, action: 'brake earlier' }))).toBe('Sector 3, brake earlier.')
  })

  it('speaks a capitalized standalone imperative when there is no sector', () => {
    expect(coachSpeakText(tip({ sector: undefined, action: 'acelere antes' }))).toBe('Acelere antes.')
  })

  it('NEVER includes "Live coach" or "Perda estimada"', () => {
    for (const k of ['braking', 'throttle', 'coast', 'steering', 'abs', 'tc', 'consistency'] as const) {
      const spoken = coachSpeakText(tip({ kind: k, sector: 2, action: undefined, estTimeLossSec: 0.42 }))
      expect(spoken).not.toMatch(/live coach/i)
      expect(spoken).not.toMatch(/perda estimada/i)
      expect(spoken).not.toMatch(/\bms\b/)
    }
  })

  it('does not describe the mistake or the time loss — only the correction', () => {
    const spoken = coachSpeakText(tip({ sector: 1, action: 'brake earlier', message: 'Late/hard braking', estTimeLossSec: 0.9 }))
    expect(spoken).toBe('Sector 1, brake earlier.')
    expect(spoken).not.toContain('Freada')
    expect(spoken).not.toContain('0.9')
  })
})

// ─── Composite per-corner advice (the spoken "Turn N: a, b, c." line) ────────

function mkFinding(over: Partial<CoachFinding>): CoachFinding {
  return {
    id: 'f',
    kind: 'brake-late',
    sector: 1,
    zonePctStart: 0.4,
    zonePctEnd: 0.5,
    severity: 'high',
    estTimeLossSec: 0.2,
    estTimeDeltaSec: -0.2,
    sign: 'loss',
    title: 't',
    detail: 'd',
    evidence: 'e',
    metrics: {},
    ...over
  }
}

describe('coachDimensionForKind — driving-dimension grouping', () => {
  it('maps brake-point findings to "brake"', () => {
    expect(coachDimensionForKind('brake-late')).toBe('brake')
    expect(coachDimensionForKind('brake-early')).toBe('brake')
  })

  it('separates turn-in TIMING from steering ANGLE', () => {
    expect(coachDimensionForKind('steering-early')).toBe('steering-timing')
    expect(coachDimensionForKind('steering-late')).toBe('steering-timing')
    expect(coachDimensionForKind('steering-insufficient')).toBe('steering-angle')
    expect(coachDimensionForKind('steering-busy')).toBe('steering-angle')
  })

  it('maps throttle findings to "throttle" and ignores gains/good', () => {
    expect(coachDimensionForKind('throttle-early')).toBe('throttle')
    expect(coachDimensionForKind('throttle-late')).toBe('throttle')
    expect(coachDimensionForKind('good')).toBeNull()
    expect(coachDimensionForKind('brake-gain')).toBeNull()
    expect(coachDimensionForKind('time-loss')).toBeNull()
  })
})

describe('coachComposeAction — terse antes/depois corrections', () => {
  it('uses the directional antes/depois wording the driver asked for', () => {
    expect(coachComposeAction('brake-late')).toBe('brake earlier')
    expect(coachComposeAction('brake-early')).toBe('brake later')
    expect(coachComposeAction('steering-late')).toBe('turn in earlier')
    expect(coachComposeAction('steering-early')).toBe('vire depois')
    expect(coachComposeAction('throttle-late')).toBe('acelere antes')
    expect(coachComposeAction('throttle-early')).toBe('throttle later')
  })

  it('phrases the steering ANGLE dimension distinctly from timing', () => {
    expect(coachComposeAction('steering-insufficient')).toBe('more steering')
    expect(coachComposeAction('steering-busy')).toBe('steering mais suave')
  })
})

describe('composeCornerAdvice — multi-dimension per-corner line', () => {
  it('combines brake + turn-in + throttle into ONE "Turn N: …" line, worst-first', () => {
    const advice = composeCornerAdvice(
      [
        mkFinding({ kind: 'steering-late', estTimeLossSec: 0.18 }),
        mkFinding({ kind: 'brake-late', estTimeLossSec: 0.30 }),
        mkFinding({ kind: 'throttle-early', estTimeLossSec: 0.10 })
      ],
      { corner: 3 }
    )
    expect(advice).not.toBeNull()
    expect(advice!.text).toBe('Turn 3: brake earlier, turn in earlier, throttle later.')
    expect(advice!.kinds).toEqual(['brake-late', 'steering-late', 'throttle-early'])
    expect(advice!.worstLossSec).toBeCloseTo(0.30, 5)
    expect(advice!.totalLossSec).toBeCloseTo(0.58, 5)
  })

  it('keeps only the WORST finding per dimension (no repeated imperative)', () => {
    const advice = composeCornerAdvice(
      [
        mkFinding({ kind: 'brake-late', estTimeLossSec: 0.10 }),
        mkFinding({ kind: 'brake-early', estTimeLossSec: 0.25 })
      ],
      { corner: 5 }
    )
    expect(advice!.actions).toEqual(['brake later'])
    expect(advice!.text).toBe('Turn 5: brake later.')
  })

  it('surfaces BOTH steering dimensions — turn-in timing AND angle — together', () => {
    const advice = composeCornerAdvice(
      [
        mkFinding({ kind: 'steering-late', estTimeLossSec: 0.20 }),
        mkFinding({ kind: 'steering-insufficient', estTimeLossSec: 0.12 })
      ],
      { corner: 7 }
    )
    expect(advice!.text).toBe('Turn 7: turn in earlier, more steering.')
  })

  it('falls back to "Sector N:" when no corner is given', () => {
    const advice = composeCornerAdvice([mkFinding({ kind: 'brake-late' })], { sector: 2 })
    expect(advice!.text).toBe('Sector 2: brake earlier.')
  })

  it('caps the line at maxDims dimensions (no firehose)', () => {
    const advice = composeCornerAdvice(
      [
        mkFinding({ kind: 'brake-late', estTimeLossSec: 0.40 }),
        mkFinding({ kind: 'steering-late', estTimeLossSec: 0.30 }),
        mkFinding({ kind: 'throttle-early', estTimeLossSec: 0.20 }),
        mkFinding({ kind: 'coast', estTimeLossSec: 0.10 })
      ],
      { corner: 1 },
      { maxDims: 2 }
    )
    expect(advice!.actions).toEqual(['brake earlier', 'turn in earlier'])
  })

  it('ignores gains / good / zero-loss findings and returns null when nothing actionable', () => {
    expect(
      composeCornerAdvice(
        [
          mkFinding({ kind: 'brake-gain', severity: 'good', sign: 'gain', estTimeLossSec: 0 }),
          mkFinding({ kind: 'good', severity: 'good', sign: undefined, estTimeLossSec: 0 })
        ],
        { corner: 2 }
      )
    ).toBeNull()
  })

  it('FALLS BACK to the generic time-loss cue when a corner has no specific dimension', () => {
    // Regression guard (v2.36.0): a corner whose ONLY loss is dimension-less
    // `time-loss` (e.g. low apex min-speed) must still speak, not go silent.
    const advice = composeCornerAdvice(
      [mkFinding({ kind: 'time-loss', estTimeLossSec: 0.22, title: 'Less speed in the turn' })],
      { corner: 4 }
    )
    expect(advice).not.toBeNull()
    expect(advice!.text).toBe('Turn 4: find more time here.')
    expect(advice!.kinds).toEqual(['time-loss'])
    expect(advice!.worstLossSec).toBeCloseTo(0.22, 5)
  })

  it('does NOT let time-loss crowd out or duplicate a SPECIFIC cue when both exist', () => {
    // brake-late + time-loss in the same corner → speak the actionable brake cue only;
    // the generic time-loss must not appear (no redundancy).
    const advice = composeCornerAdvice(
      [
        mkFinding({ kind: 'brake-late', estTimeLossSec: 0.20 }),
        mkFinding({ kind: 'time-loss', estTimeLossSec: 0.50 })
      ],
      { corner: 6 }
    )
    expect(advice!.text).toBe('Turn 6: brake earlier.')
    expect(advice!.kinds).toEqual(['brake-late'])
    expect(advice!.text).not.toContain('find more time here')
  })

  it('speaks the SECTOR time-loss zone ("Sector N: find more time here") fallback', () => {
    const advice = composeCornerAdvice([mkFinding({ kind: 'time-loss', estTimeLossSec: 0.3 })], { sector: 2 })
    expect(advice!.text).toBe('Sector 2: find more time here.')
  })
})

describe('coachSpeakText — prefers the corner locator over the sector', () => {
  it('says "Turn N, …" when the tip carries a corner number', () => {
    expect(coachSpeakText(tip({ corner: 4, sector: 2, action: 'turn in earlier' }))).toBe('Turn 4, turn in earlier.')
  })

  it('still says "Sector N, …" when only a sector is present', () => {
    expect(coachSpeakText(tip({ corner: undefined, sector: 2, action: 'turn in earlier' }))).toBe('Sector 2, turn in earlier.')
  })
})
