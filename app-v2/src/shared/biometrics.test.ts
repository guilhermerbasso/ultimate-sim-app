import { describe, expect, it } from 'vitest'
import {
  aggregateLapBiometrics,
  alignSpikesToEvents,
  bpmFromRr,
  calmUnderPressure,
  classifyStress,
  correlatePaceHr,
  detectStressSpikes,
  drivingIntensity,
  parseHeartRateMeasurement,
  pearson,
  rmssd,
  targetHeartRate,
  DEFAULT_HR_MODEL,
  type BioEvent,
  type HrSample,
  type LapBiometrics,
  type LapBoundary
} from './biometrics'

// ─── BLE Heart Rate Measurement (0x2A37) parser ──────────────────────────────

describe('parseHeartRateMeasurement', () => {
  it('parses an 8-bit heart rate with no flags set', () => {
    const m = parseHeartRateMeasurement([0x00, 70])
    expect(m.heartRate).toBe(70)
    expect(m.flags).toBe(0)
    expect(m.contactSupported).toBe(false)
    expect(m.contactDetected).toBeUndefined()
    expect(m.rrIntervalsMs).toEqual([])
    expect(m.energyExpendedKJ).toBeUndefined()
  })

  it('parses a 16-bit heart rate when the format flag is set (little-endian)', () => {
    const m = parseHeartRateMeasurement([0x01, 0xb4, 0x00]) // 180 as UINT16 LE
    expect(m.heartRate).toBe(180)
  })

  it('decodes sensor-contact supported + detected flags', () => {
    const m = parseHeartRateMeasurement([0x06, 65]) // contactSupported | contactDetected
    expect(m.contactSupported).toBe(true)
    expect(m.contactDetected).toBe(true)
    expect(m.heartRate).toBe(65)
  })

  it('reports contact NOT detected when supported but the detect bit is clear', () => {
    const m = parseHeartRateMeasurement([0x04, 65]) // contactSupported only
    expect(m.contactSupported).toBe(true)
    expect(m.contactDetected).toBe(false)
  })

  it('reads energy expended (UINT16 kJ) when present', () => {
    const m = parseHeartRateMeasurement([0x08, 75, 0x2c, 0x01]) // energy 0x012C = 300
    expect(m.heartRate).toBe(75)
    expect(m.energyExpendedKJ).toBe(300)
  })

  it('converts RR-intervals from 1/1024 s units to milliseconds', () => {
    const m = parseHeartRateMeasurement([0x10, 60, 0x00, 0x04, 0x00, 0x02]) // 1024, 512
    expect(m.heartRate).toBe(60)
    expect(m.rrIntervalsMs).toEqual([1000, 500])
  })

  it('rounds non-integer RR conversions to two decimals', () => {
    const m = parseHeartRateMeasurement([0x10, 60, 0x90, 0x01]) // 0x0190 = 400 → 390.625
    expect(m.rrIntervalsMs).toEqual([390.63])
  })

  it('parses energy expended AND RR-intervals together in spec order', () => {
    const m = parseHeartRateMeasurement([0x18, 60, 0x10, 0x00, 0x00, 0x04])
    expect(m.energyExpendedKJ).toBe(16)
    expect(m.rrIntervalsMs).toEqual([1000])
  })

  it('accepts DataView, ArrayBuffer, Uint8Array and number[] inputs', () => {
    const bytes = [0x00, 88]
    const u8 = Uint8Array.from(bytes)
    expect(parseHeartRateMeasurement(u8).heartRate).toBe(88)
    expect(parseHeartRateMeasurement(u8.buffer).heartRate).toBe(88)
    expect(parseHeartRateMeasurement(new DataView(u8.buffer)).heartRate).toBe(88)
    expect(parseHeartRateMeasurement(bytes).heartRate).toBe(88)
  })

  it('throws on an empty or single-byte buffer', () => {
    expect(() => parseHeartRateMeasurement([])).toThrow()
    expect(() => parseHeartRateMeasurement([0x00])).toThrow()
  })

  it('throws when a UINT16 heart rate is truncated', () => {
    expect(() => parseHeartRateMeasurement([0x01, 0xb4])).toThrow()
  })
})

// ─── HRV helpers ─────────────────────────────────────────────────────────────

describe('rmssd / bpmFromRr', () => {
  it('computes RMSSD over successive RR differences', () => {
    // diffs 10, -20, 15 → sqrt((100+400+225)/3) = sqrt(241.67) ≈ 15.55
    expect(rmssd([800, 810, 790, 805])).toBeCloseTo(15.55, 1)
  })

  it('returns undefined with fewer than two intervals', () => {
    expect(rmssd([800])).toBeUndefined()
    expect(rmssd([])).toBeUndefined()
  })

  it('converts an RR interval to instantaneous BPM', () => {
    expect(bpmFromRr(1000)).toBe(60)
    expect(bpmFromRr(500)).toBe(120)
    expect(bpmFromRr(0)).toBeUndefined()
  })
})

// ─── Driving intensity → target HR ───────────────────────────────────────────

describe('drivingIntensity', () => {
  it('stays within 0..1', () => {
    expect(drivingIntensity({})).toBe(0)
    const hot = drivingIntensity({ speedKmh: 320, throttle: 1, brake: 1, rpm: 9000, maxRpm: 9000, latAccelG: 2, longAccelG: 2, nearbyCars: 2, incident: true, yellowFlag: true })
    expect(hot).toBeLessThanOrEqual(1)
    expect(hot).toBeGreaterThan(0.9)
  })

  it('ranks a hot lap above cruising above the pit lane', () => {
    const pit = drivingIntensity({ speedKmh: 60, throttle: 0.2, brake: 0 })
    const cruise = drivingIntensity({ speedKmh: 180, throttle: 0.6, brake: 0.1, latAccelG: 0.5 })
    const hotLap = drivingIntensity({ speedKmh: 260, throttle: 1, brake: 0.8, latAccelG: 1.6, longAccelG: 1.2 })
    expect(hotLap).toBeGreaterThan(cruise)
    expect(cruise).toBeGreaterThan(pit)
  })

  it('adds an arousal bump for a fresh incident', () => {
    const base = { speedKmh: 150, throttle: 0.5, brake: 0.3 }
    expect(drivingIntensity({ ...base, incident: true })).toBeGreaterThan(drivingIntensity(base))
  })
})

describe('targetHeartRate', () => {
  it('is monotonic in intensity and bounded by the model envelope', () => {
    const low = targetHeartRate(0)
    const mid = targetHeartRate(0.5)
    const high = targetHeartRate(1)
    expect(low).toBe(DEFAULT_HR_MODEL.baseDriveBpm)
    expect(high).toBe(DEFAULT_HR_MODEL.maxBpm)
    expect(mid).toBeGreaterThan(low)
    expect(mid).toBeLessThan(high)
  })

  it('decays toward resting when not engaged', () => {
    expect(targetHeartRate(0, DEFAULT_HR_MODEL, false)).toBe(DEFAULT_HR_MODEL.restingBpm)
    expect(targetHeartRate(1, DEFAULT_HR_MODEL, false)).toBeLessThan(DEFAULT_HR_MODEL.baseDriveBpm)
  })
})

// ─── Live stress classification ──────────────────────────────────────────────

describe('classifyStress', () => {
  it('labels calm / elevated / stressed relative to baseline', () => {
    expect(classifyStress(100, 100).state).toBe('calm')
    expect(classifyStress(112, 100).state).toBe('elevated')
    expect(classifyStress(130, 100).state).toBe('stressed')
  })

  it('reports a negative delta when calmer than baseline', () => {
    expect(classifyStress(90, 100).deltaBpm).toBe(-10)
  })
})

// ─── Lap aggregation ─────────────────────────────────────────────────────────

describe('aggregateLapBiometrics', () => {
  const series: HrSample[] = [
    { t: 0, bpm: 100 },
    { t: 1000, bpm: 110 },
    { t: 2000, bpm: 120 }, // lap 1 boundary edge
    { t: 3000, bpm: 150 },
    { t: 4000, bpm: 160 }
  ]
  const boundaries: LapBoundary[] = [
    { lap: 1, startT: 0, endT: 2000, lapTimeSec: 90 },
    { lap: 2, startT: 2001, endT: 4000, lapTimeSec: 88 }
  ]

  it('buckets samples into per-lap avg/max', () => {
    const out = aggregateLapBiometrics(series, boundaries)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ lap: 1, avgBpm: 110, maxBpm: 120 })
    expect(out[1]).toMatchObject({ lap: 2, avgBpm: 155, maxBpm: 160 })
  })

  it('skips laps with no samples in range', () => {
    const out = aggregateLapBiometrics(series, [{ lap: 9, startT: 10_000, endT: 12_000, lapTimeSec: 80 }])
    expect(out).toHaveLength(0)
  })
})

// ─── HR ↔ pace correlation ───────────────────────────────────────────────────

describe('correlatePaceHr', () => {
  it('detects "calmer is faster" (HR high on slow laps)', () => {
    const laps: LapBiometrics[] = [
      { lap: 1, lapTimeSec: 90, avgBpm: 170, maxBpm: 175 },
      { lap: 2, lapTimeSec: 88, avgBpm: 160, maxBpm: 168 },
      { lap: 3, lapTimeSec: 86, avgBpm: 150, maxBpm: 158 },
      { lap: 4, lapTimeSec: 84, avgBpm: 140, maxBpm: 148 }
    ]
    const r = correlatePaceHr(laps)
    expect(r.pearson).toBeGreaterThan(0.3)
    expect(r.interpretation).toBe('calmer-is-faster')
  })

  it('detects "harder is faster" (HR high on fast laps)', () => {
    const laps: LapBiometrics[] = [
      { lap: 1, lapTimeSec: 90, avgBpm: 140, maxBpm: 148 },
      { lap: 2, lapTimeSec: 88, avgBpm: 150, maxBpm: 158 },
      { lap: 3, lapTimeSec: 86, avgBpm: 160, maxBpm: 168 },
      { lap: 4, lapTimeSec: 84, avgBpm: 170, maxBpm: 175 }
    ]
    const r = correlatePaceHr(laps)
    expect(r.pearson).toBeLessThan(-0.3)
    expect(r.interpretation).toBe('harder-is-faster')
  })

  it('is inconclusive with fewer than three laps', () => {
    const r = correlatePaceHr([
      { lap: 1, lapTimeSec: 90, avgBpm: 150, maxBpm: 155 },
      { lap: 2, lapTimeSec: 88, avgBpm: 152, maxBpm: 157 }
    ])
    expect(r.interpretation).toBe('inconclusive')
    expect(r.samples).toBe(2)
  })
})

describe('calmUnderPressure', () => {
  it('scores high when fast laps stay calm and the trace is steady', () => {
    const laps: LapBiometrics[] = [
      { lap: 1, lapTimeSec: 84.0, avgBpm: 138, maxBpm: 145 },
      { lap: 2, lapTimeSec: 84.5, avgBpm: 140, maxBpm: 146 },
      { lap: 3, lapTimeSec: 86.0, avgBpm: 150, maxBpm: 156 },
      { lap: 4, lapTimeSec: 86.5, avgBpm: 151, maxBpm: 157 },
      { lap: 5, lapTimeSec: 89.0, avgBpm: 162, maxBpm: 168 },
      { lap: 6, lapTimeSec: 89.5, avgBpm: 164, maxBpm: 170 }
    ]
    const calm = calmUnderPressure(laps)
    expect(calm).not.toBeNull()
    expect(calm!.score).toBeGreaterThan(60)
    expect(calm!.fastLapBpm).toBeLessThan(calm!.slowLapBpm)
  })

  it('scores low when HR spikes on the fast laps', () => {
    const laps: LapBiometrics[] = [
      { lap: 1, lapTimeSec: 84.0, avgBpm: 175, maxBpm: 182 },
      { lap: 2, lapTimeSec: 84.5, avgBpm: 172, maxBpm: 180 },
      { lap: 3, lapTimeSec: 86.0, avgBpm: 150, maxBpm: 158 },
      { lap: 4, lapTimeSec: 86.5, avgBpm: 120, maxBpm: 132 },
      { lap: 5, lapTimeSec: 89.0, avgBpm: 130, maxBpm: 140 },
      { lap: 6, lapTimeSec: 89.5, avgBpm: 128, maxBpm: 138 }
    ]
    const calm = calmUnderPressure(laps)
    expect(calm).not.toBeNull()
    expect(calm!.score).toBeLessThan(40)
  })

  it('returns null with fewer than three laps', () => {
    expect(calmUnderPressure([{ lap: 1, lapTimeSec: 90, avgBpm: 150, maxBpm: 155 }])).toBeNull()
  })
})

// ─── Stress spikes ───────────────────────────────────────────────────────────

function flat(startT: number, count: number, bpm: number, stepMs = 1000): HrSample[] {
  return Array.from({ length: count }, (_, i) => ({ t: startT + i * stepMs, bpm }))
}

describe('detectStressSpikes', () => {
  it('detects a single spike above the trailing baseline at its peak', () => {
    const series: HrSample[] = [
      ...flat(0, 20, 120),
      { t: 20_000, bpm: 152 },
      { t: 21_000, bpm: 156 },
      { t: 22_000, bpm: 158 }, // peak
      { t: 23_000, bpm: 154 },
      ...flat(24_000, 20, 120)
    ]
    const spikes = detectStressSpikes(series)
    expect(spikes).toHaveLength(1)
    expect(spikes[0].peakBpm).toBe(158)
    expect(spikes[0].baselineBpm).toBe(120)
    expect(spikes[0].deltaBpm).toBeGreaterThanOrEqual(12)
  })

  it('separates two spikes divided by a return to baseline', () => {
    const series: HrSample[] = [
      ...flat(0, 20, 118),
      { t: 20_000, bpm: 150 },
      { t: 21_000, bpm: 152 },
      ...flat(22_000, 12, 118), // > mergeGap of calm between spikes
      { t: 34_000, bpm: 149 },
      { t: 35_000, bpm: 151 },
      ...flat(36_000, 12, 118)
    ]
    const spikes = detectStressSpikes(series)
    expect(spikes).toHaveLength(2)
  })

  it('finds nothing in a flat trace', () => {
    expect(detectStressSpikes(flat(0, 40, 120))).toHaveLength(0)
  })
})

describe('alignSpikesToEvents', () => {
  const spikes = detectStressSpikes([
    ...flat(0, 20, 120),
    { t: 20_000, bpm: 152 },
    { t: 21_000, bpm: 158 },
    { t: 22_000, bpm: 154 },
    ...flat(23_000, 20, 120)
  ])

  it('attaches the nearest event within tolerance', () => {
    const events: BioEvent[] = [
      { t: 19_500, kind: 'incident', label: 'Off-track', lap: 7 },
      { t: 60_000, kind: 'lap', lap: 8 }
    ]
    const aligned = alignSpikesToEvents(spikes, events)
    expect(aligned[0].event?.kind).toBe('incident')
    expect(aligned[0].offsetMs).not.toBeNull()
  })

  it('leaves a spike unattached when no event is within tolerance', () => {
    const aligned = alignSpikesToEvents(spikes, [{ t: 200_000, kind: 'lap', lap: 99 }])
    expect(aligned[0].event).toBeNull()
    expect(aligned[0].offsetMs).toBeNull()
  })
})

// ─── pearson edge case ───────────────────────────────────────────────────────

describe('pearson', () => {
  it('returns 0 when a series has no variance', () => {
    expect(pearson([5, 5, 5], [1, 2, 3])).toBe(0)
  })

  it('returns +1 for a perfectly increasing relationship', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 6)
  })
})
