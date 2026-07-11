import { describe, expect, it } from 'vitest'
import type { CoachCornerMetrics, CoachFinding, CoachFindingKind } from './coach'
import {
  analyzeGapTrend,
  areCoachLapsComparable,
  buildQualiStartSummary,
  buildRacecraftAdvice,
  classifyCoachTrackCondition,
  comparableCoachLaps,
  detectRacecraftQuestion,
  type CoachComparableIdentity,
  type CoachLapHistoryEntry
} from './coach-racecraft'

function finding(
  kind: CoachFindingKind,
  overrides: Partial<CoachFinding> = {}
): CoachFinding {
  return {
    id: `${kind}:${overrides.corner ?? overrides.sector ?? 1}`,
    kind,
    phase: overrides.phase,
    sector: overrides.sector ?? 1,
    corner: overrides.corner,
    zonePctStart: overrides.zonePctStart ?? 0.2,
    zonePctEnd: overrides.zonePctEnd ?? 0.3,
    severity: overrides.severity ?? 'med',
    estTimeLossSec: overrides.estTimeLossSec ?? 0.2,
    estTimeDeltaSec: overrides.estTimeDeltaSec ?? -0.2,
    sign: overrides.sign ?? 'loss',
    title: overrides.title ?? kind,
    detail: overrides.detail ?? kind,
    evidence: overrides.evidence ?? 'player telemetry',
    metrics: overrides.metrics ?? {},
    ...overrides
  }
}

const DRY_IDENTITY: CoachComparableIdentity = {
  trackName: 'Interlagos',
  trackConfigName: 'Grand Prix',
  carName: 'GT3 R',
  carPath: 'gt3r',
  carClassId: 7,
  carClassName: 'GT3',
  condition: 'dry',
  airTempC: 24,
  trackTempC: 35
}

function historyLap(
  id: string,
  identity: CoachComparableIdentity,
  findings: CoachFinding[],
  overrides: Partial<CoachLapHistoryEntry> = {}
): CoachLapHistoryEntry {
  return {
    id,
    at: Number(id.replace(/\D/g, '')) || 1,
    valid: true,
    identity,
    findings,
    cornerMetrics: [],
    ...overrides
  }
}

describe('racecraft question routing', () => {
  it('recognizes pass-ahead and pull-away questions in English and PT-BR', () => {
    expect(detectRacecraftQuestion('How do I pass the car ahead?')).toBe('overtake')
    expect(detectRacecraftQuestion('Como ultrapassar o carro da frente?')).toBe('overtake')
    expect(detectRacecraftQuestion('How do I pull away from the car behind?')).toBe('pull-away')
    expect(detectRacecraftQuestion('Como abrir o gap para o carro de trás?')).toBe('pull-away')
  })
})

describe('buildRacecraftAdvice', () => {
  const cornerMetrics: CoachCornerMetrics[] = [
    {
      corner: 7,
      entrySpeedKmh: 201,
      minSpeedKmh: 92,
      exitSpeedKmh: 141,
      brakeStartPct: 0.421,
      steerStartPct: 0.438,
      throttleStartPct: 0.572,
      tcActivePct: 0.22
    }
  ]

  it('builds an OVERTAKE plan from player exit evidence and a closing car-ahead gap', () => {
    const advice = buildRacecraftAdvice('overtake', {
      findings: [
        finding('brake-early', { corner: 4, sector: 1, phase: 'entry', estTimeLossSec: 0.3 }),
        finding('throttle-hesitation', { corner: 7, sector: 2, phase: 'exit', estTimeLossSec: 0.18 })
      ],
      cornerMetrics,
      gaps: [
        { at: 1000, aheadSec: 1.2 },
        { at: 4000, aheadSec: 0.8 }
      ],
      currentGapAheadSec: 0.8
    })

    expect(advice.mode).toBe('overtake')
    expect(advice.gapTrend).toBe('closing')
    expect(advice.opponentData).toBe('timing-only')
    expect(advice.items[0]).toMatchObject({ corner: 7, phase: 'exit' })
    expect(advice.items[0].text).toContain('exit 141 km/h')
    expect(advice.items[0].text).toContain('throttle return 57.2% lap')
    expect(advice.text).toContain('OVERTAKE')
    expect(advice.text).toContain('opponent controls are unavailable')
  })

  it('builds a DEFEND plan when the car behind is close and closing', () => {
    const advice = buildRacecraftAdvice('pull-away', {
      findings: [finding('brake-early', { corner: 2, sector: 1, phase: 'entry' })],
      cornerMetrics: [
        { corner: 2, entrySpeedKmh: 188, minSpeedKmh: 84, brakeStartPct: 0.22 }
      ],
      gaps: [
        { at: 1000, behindSec: 1.1 },
        { at: 4000, behindSec: 0.7 }
      ]
    })

    expect(advice.mode).toBe('defend')
    expect(advice.gapTrend).toBe('closing')
    expect(advice.items[0].phase).toBe('entry')
    expect(advice.items[0].expectedBenefit).toContain('deny the car behind')
    expect(advice.text).toContain('DEFEND')
  })

  it('normalizes signed relative gaps without inventing opponent controls', () => {
    const advice = buildRacecraftAdvice('pull-away', {
      findings: [finding('throttle-late', { corner: 2, phase: 'exit' })],
      currentGapBehindSec: -0.8
    })

    expect(advice.mode).toBe('defend')
    expect(advice.gapSec).toBe(0.8)
    expect(advice.text).toContain('opponent controls are unavailable')
  })

  it('falls back to general lap improvement when opponent timing is missing', () => {
    const advice = buildRacecraftAdvice('overtake', {
      findings: [finding('steering-late', { corner: 5, sector: 2 })]
    })

    expect(advice.mode).toBe('lap-improvement')
    expect(advice.opponentData).toBe('unavailable')
    expect(advice.gapSec).toBeUndefined()
    expect(advice.text).toContain('no reliable car-ahead gap or opponent controls')
    expect(advice.text).not.toMatch(/\b\d+\.\d+s\b/)
  })

  it('uses general lap improvement when the car ahead is not yet in passing range', () => {
    const advice = buildRacecraftAdvice('overtake', {
      findings: [finding('throttle-late', { corner: 7, sector: 2, phase: 'exit' })],
      currentGapAheadSec: 5.2
    })

    expect(advice.mode).toBe('lap-improvement')
    expect(advice.opponentData).toBe('timing-only')
    expect(advice.text).toContain('LAP IMPROVEMENT')
  })

  it('does not combine gap trends from different opponents', () => {
    const trend = analyzeGapTrend(
      [
        { at: 1000, aheadSec: 1.8, aheadCarIdx: 10 },
        { at: 4000, aheadSec: 0.5, aheadCarIdx: 20 },
        { at: 7000, aheadSec: 0.9, aheadCarIdx: 20 }
      ],
      'ahead'
    )

    expect(trend.trend).toBe('opening')
    expect(trend.deltaSec).toBeCloseTo(0.4)
  })

  it('distinguishes entry improvement from exit/traction improvement', () => {
    const entry = buildRacecraftAdvice('overtake', {
      findings: [finding('brake-early', { corner: 7, sector: 2, phase: 'entry' })],
      cornerMetrics,
      currentGapAheadSec: 0.9
    })
    const exit = buildRacecraftAdvice('overtake', {
      findings: [finding('tc-overuse', { corner: 7, sector: 2, phase: 'exit' })],
      cornerMetrics,
      currentGapAheadSec: 0.9
    })
    const turnIn = buildRacecraftAdvice('overtake', {
      findings: [finding('steering-late', { corner: 7, sector: 2, phase: 'entry' })],
      cornerMetrics,
      currentGapAheadSec: 0.9
    })

    expect(entry.items[0].text).toContain('brake point 42.1% lap')
    expect(entry.items[0].action).toContain('brake later')
    expect(turnIn.items[0].text).toContain('turn-in 43.8% lap')
    expect(turnIn.items[0].text).not.toContain('brake point')
    expect(exit.items[0].evidence.tractionQuality).toBe('tc-limited')
    expect(exit.items[0].text).toContain('exit 141 km/h')
    expect(exit.items[0].expectedBenefit).toContain('passing run')
  })

  it('keeps messages concise, capped, and removes contradictory recommendations', () => {
    const advice = buildRacecraftAdvice(
      'pull-away',
      {
        currentGapBehindSec: 0.8,
        findings: [
          finding('brake-early', { corner: 1, sector: 1, estTimeLossSec: 0.1 }),
          finding('brake-late', { corner: 1, sector: 1, estTimeLossSec: 0.35 }),
          finding('throttle-late', { corner: 2, sector: 1, estTimeLossSec: 0.25 }),
          finding('steering-late', { corner: 3, sector: 2, estTimeLossSec: 0.2 }),
          finding('coast', { corner: 4, sector: 3, estTimeLossSec: 0.15 })
        ]
      },
      { maxItems: 3 }
    )

    expect(advice.items).toHaveLength(3)
    expect(advice.text.length).toBeLessThan(650)
    expect(advice.text).toContain('brake a touch earlier')
    expect(advice.text).not.toContain('brake later toward')
  })
})

describe('qualifying comparable history', () => {
  it('separates dry, wet, intermediate, and drying conditions deterministically', () => {
    expect(classifyCoachTrackCondition({ trackWetnessPct: 0, isRaining: false })).toBe('dry')
    expect(classifyCoachTrackCondition({ trackWetnessPct: 0.2, isRaining: true })).toBe('intermediate')
    expect(classifyCoachTrackCondition({ trackWetnessPct: 0.75, isRaining: true })).toBe('wet')
    expect(
      classifyCoachTrackCondition({
        trackWetnessPct: 0.2,
        previousTrackWetnessPct: 0.35,
        isRaining: false
      })
    ).toBe('drying')
  })

  it('uses only valid laps in the same dry/wet condition', () => {
    const wet = { ...DRY_IDENTITY, condition: 'wet' as const }
    const laps = [
      historyLap('dry-valid', DRY_IDENTITY, [finding('brake-early')]),
      historyLap('dry-invalid', DRY_IDENTITY, [finding('brake-early')], { valid: false }),
      historyLap('wet-valid', wet, [finding('throttle-late')])
    ]

    expect(comparableCoachLaps(DRY_IDENTITY, laps).map((lap) => lap.id)).toEqual(['dry-valid'])
    expect(comparableCoachLaps(wet, laps).map((lap) => lap.id)).toEqual(['wet-valid'])
  })

  it('rejects track, config, car/class, and ambient changes', () => {
    const exact = historyLap('exact', DRY_IDENTITY, [])
    const changed = [
      historyLap('track', { ...DRY_IDENTITY, trackName: 'Spa' }, []),
      historyLap('config', { ...DRY_IDENTITY, trackConfigName: 'Moto' }, []),
      historyLap('config-missing', { ...DRY_IDENTITY, trackConfigName: undefined }, []),
      historyLap('car', { ...DRY_IDENTITY, carPath: 'gt4', carName: 'GT4', carClassId: 8 }, []),
      historyLap('ambient', { ...DRY_IDENTITY, airTempC: 35, trackTempC: 50 }, []),
      historyLap('ambient-missing', { ...DRY_IDENTITY, airTempC: undefined }, [])
    ]

    expect(areCoachLapsComparable(DRY_IDENTITY, exact.identity)).toBe(true)
    expect(comparableCoachLaps(DRY_IDENTITY, [exact, ...changed]).map((lap) => lap.id)).toEqual(['exact'])
  })

  it('summarizes recurring losses only when comparable history is sufficient', () => {
    const recurring = finding('throttle-late', {
      corner: 7,
      sector: 2,
      phase: 'exit',
      estTimeLossSec: 0.24
    })
    const history = [
      historyLap('1', DRY_IDENTITY, [recurring]),
      historyLap('2', DRY_IDENTITY, [recurring]),
      historyLap('3', DRY_IDENTITY, [recurring])
    ]
    const summary = buildQualiStartSummary({ current: DRY_IDENTITY, history })

    expect(summary.sufficientHistory).toBe(true)
    expect(summary.source).toBe('history')
    expect(summary.items[0]).toMatchObject({ corner: 7, lapsSeen: 3, lapsCompared: 3 })
    expect(summary.text).toContain('3 comparable valid dry laps')
    expect(summary.text).toContain('recurring in 3/3 valid laps')
  })

  it('plainly reports insufficient history and labels current-session evidence as such', () => {
    const summary = buildQualiStartSummary({
      current: DRY_IDENTITY,
      history: [historyLap('1', DRY_IDENTITY, [finding('brake-early')])],
      currentSession: [
        historyLap('current', DRY_IDENTITY, [
          finding('steering-late', { corner: 4, sector: 2, estTimeLossSec: 0.18 })
        ])
      ]
    })

    expect(summary.sufficientHistory).toBe(false)
    expect(summary.source).toBe('current-session')
    expect(summary.text).toContain('insufficient comparable history (1/3)')
    expect(summary.text).toContain('current session')
    expect(summary.text).not.toContain('recurring in')
  })
})
