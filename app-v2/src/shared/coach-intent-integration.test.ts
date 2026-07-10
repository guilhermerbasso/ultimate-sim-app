import { describe, it, expect } from 'vitest'
import { analyzeLap, type CoachContextSample, type CoachLapBuffer, type CoachLapSample } from './coach'
import { createDefaultIntentRegistry } from './driver-intent-catalog'

// ── Build a lap with a clear LOADED coast (mid-corner, no pedal at ~0.7G) so
// analyzeLap emits a 'coast' finding. Optionally stamp the coast samples with a
// context frame so the intent gate can reason about racecraft/flags/conditions.
function mk(t: number, lapDistPct: number, over: Partial<CoachLapSample>): CoachLapSample {
  return {
    t,
    lapDistPct,
    speedKmh: 160,
    throttle: 0,
    brake: 0,
    clutch: 0,
    steerAbsDeg: 8,
    latAbsG: 0.2,
    longAccelG: 0,
    gear: 4,
    rpm: 7000,
    absActive: false,
    tcActive: false,
    ...over
  }
}

function coastLap(coastCtx?: CoachContextSample): CoachLapBuffer {
  const samples: CoachLapSample[] = []
  let t = 0
  for (let i = 0; i < 10; i += 1) {
    samples.push(mk(t, 0.02 + i * 0.03, { throttle: 0.95, speedKmh: 185, latAbsG: 0.1 }))
    t += 100
  }
  // Loaded mid-corner coast: throttle 0, brake 0, ~0.6G, > 350ms, > 80 km/h.
  for (let i = 0; i < 8; i += 1) {
    samples.push(
      mk(t, 0.4 + i * 0.012, { throttle: 0, brake: 0, latAbsG: 0.62, speedKmh: 150, ...(coastCtx ? { ctx: coastCtx } : {}) })
    )
    t += 100
  }
  for (let i = 0; i < 10; i += 1) {
    samples.push(mk(t, 0.52 + i * 0.04, { throttle: 0.95, speedKmh: 168, latAbsG: 0.1 }))
    t += 100
  }
  return { sectorCount: 3, samples }
}

const registry = createDefaultIntentRegistry()

function coastFinding(buffer: CoachLapBuffer, opts: Parameters<typeof analyzeLap>[2] = {}) {
  return analyzeLap(buffer, undefined, opts).find((f) => f.kind === 'coast')
}

describe('intent-gated coaching — integration via analyzeLap + real catalogue', () => {
  it('the SAME coast is a real error with NO context, but demoted to context when a car is alongside', () => {
    // Baseline: a loaded mid-corner coast with an (empty) context frame → still an error.
    const errorFinding = coastFinding(coastLap({}), { registry })
    expect(errorFinding, 'coast should be flagged when nothing explains it').toBeTruthy()
    expect(errorFinding!.context).toBeFalsy()
    expect(errorFinding!.sign).toBe('loss')

    // Same coast, but a car is on the right → give room, NOT an error.
    const sideBySide = coastFinding(coastLap({ carLeftRight: 'right', carsAlongsideCount: 1 }), { registry })
    expect(sideBySide!.context).toBe(true)
    expect(sideBySide!.intentCategory).toBe('racecraft')
    expect(sideBySide!.severity).toBe('good')
    expect(sideBySide!.intentEvidence && sideBySide!.intentEvidence.length).toBeGreaterThan(0)
  })

  it('does NOT flag a coast under a yellow flag (mandatory lift)', () => {
    const f = coastFinding(coastLap({ flagYellow: true }), { registry })
    expect(f!.context).toBe(true)
    expect(f!.intentCategory).toBe('conditions')
  })

  it('does NOT flag a coast under caution / safety car (pace)', () => {
    const f = coastFinding(coastLap({ caution: true, paceMode: 'singleFileRestart' }), { registry })
    expect(f!.context).toBe(true)
    expect(f!.intentCategory).toBe('conditions')
  })

  it('does NOT flag a coast on a wet / low-grip track', () => {
    const f = coastFinding(coastLap({ trackWetnessPct: 0.6, isRaining: true }), { registry })
    expect(f!.context).toBe(true)
    expect(f!.intentCategory).toBe('conditions')
  })

  it('does NOT flag a coast on an out-lap (warm-up session state)', () => {
    const f = coastFinding(coastLap({ sessionState: 'warmup' }), { registry })
    expect(f!.context).toBe(true)
    expect(f!.intentCategory).toBe('management')
  })

  it('does NOT flag a coast avoiding a car right ahead (survival lift)', () => {
    const f = coastFinding(coastLap({ gapAheadSec: 0.3, radarClosestMeters: 4 }), { registry })
    expect(f!.context).toBe(true)
    expect(f!.intentCategory).toBe('racecraft')
  })

  it('ZERO-REGRESSION: without a registry the coast is flagged exactly as before', () => {
    const f = coastFinding(coastLap({ carLeftRight: 'both' })) // no registry passed
    expect(f).toBeTruthy()
    expect(f!.context).toBeUndefined()
    expect(f!.confidence).toBeUndefined()
  })

  it('SILENCE: a strict sensitivity (high minConfidence) drops the low-confidence error', () => {
    // Empty context → genuine error, but demand near-certainty → silenced.
    const f = coastFinding(coastLap({}), { registry, minConfidence: 0.99 })
    expect(f).toBeUndefined()
  })
})
