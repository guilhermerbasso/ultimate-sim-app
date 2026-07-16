import { describe, expect, it } from 'vitest'
import type { CoachCornerMetrics, CoachFinding, CoachFindingKind } from './coach'
import {
  analyzeGapTrend,
  areCoachLapsComparable,
  buildQualiStartSummary,
  buildRacecraftAdvice,
  buildRacecraftHistoryEvidence,
  classifyCoachTrackCondition,
  comparableCoachLaps,
  detectRacecraftQuestion,
  detectRacecraftQuestionWithLanguage,
  MAX_QUALI_BRIEFING_LENGTH,
  MAX_RACECRAFT_ADVICE_LENGTH,
  racecraftSafetyFromSnapshot,
  type CoachComparableIdentity,
  type CoachLapHistoryEntry,
  type CoachAdviceLanguage
} from './coach-racecraft'
import type { Flags, TelemetrySnapshot } from './telemetry'

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
    confidence: overrides.confidence ?? 0.9,
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
  it('recognizes overtake and pull-away questions in every app language', () => {
    const cases: Array<[string, 'overtake' | 'pull-away', CoachAdviceLanguage]> = [
      ['What should I do to pass the car ahead?', 'overtake', 'en-US'],
      ['How do I pull away from the car behind?', 'pull-away', 'en-US'],
      ['Como ultrapassar o carro da frente?', 'overtake', 'pt-BR'],
      ['Como abrir o gap para o carro de trás?', 'pull-away', 'pt-BR'],
      ['¿Cómo adelantar al coche de delante?', 'overtake', 'es'],
      ['¿Cómo alejarme del coche de detrás?', 'pull-away', 'es'],
      ['Comment dépasser la voiture devant ?', 'overtake', 'fr'],
      ['Comment distancer la voiture derrière ?', 'pull-away', 'fr'],
      ['Wie kann ich das Auto vor mir überholen?', 'overtake', 'de'],
      ['Wie kann ich mich vom Auto hinter mir absetzen?', 'pull-away', 'de'],
      ['怎么超过前车？', 'overtake', 'zh'],
      ['怎么甩开后车？', 'pull-away', 'zh'],
      ['前の車をどう追い越す？', 'overtake', 'ja'],
      ['後ろの車をどう引き離す？', 'pull-away', 'ja']
    ]
    for (const [question, intent, language] of cases) {
      expect(detectRacecraftQuestion(question), question).toBe(intent)
      expect(detectRacecraftQuestionWithLanguage(question), question).toEqual({ intent, language })
    }
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
        { at: 3000, aheadSec: 1.0 },
        { at: 5000, aheadSec: 0.8 }
      ],
      currentGapAheadSec: 0.8
    })

    expect(advice.mode).toBe('overtake')
    expect(advice.gapTrend).toBe('closing')
    expect(advice.opponentData).toBe('timing-only')
    expect(advice.items[0]).toMatchObject({ corner: 7, phase: 'exit' })
    expect(advice.items[0].text).toContain('exit 141 km/h')
    expect(advice.items[0].text).toContain('throttle return 57.2% lap')
    expect(advice.evidenceSource).toBe('current-lap')
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
        { at: 3000, behindSec: 0.9 },
        { at: 5000, behindSec: 0.7 }
      ]
    })

    expect(advice.mode).toBe('defend')
    expect(advice.gapTrend).toBe('closing')
    expect(advice.items[0].phase).toBe('entry')
    expect(advice.items[0].expectedBenefit).toContain('prevent a stronger run')
    expect(advice.text).toContain('DEFEND')
  })

  it('falls back to condition-matched player history for both ahead and behind advice', () => {
    const recurring = finding('throttle-late', {
      corner: 7,
      sector: 2,
      phase: 'exit',
      estTimeLossSec: 0.24
    })
    const history = [
      historyLap('1', DRY_IDENTITY, [recurring], {
        lapTimeSec: 90,
        cornerMetrics: [{ corner: 7, entrySpeedKmh: 198, minSpeedKmh: 91, exitSpeedKmh: 138, throttleStartPct: 0.58 }]
      }),
      historyLap('2', DRY_IDENTITY, [recurring], {
        lapTimeSec: 89,
        cornerMetrics: [{ corner: 7, entrySpeedKmh: 199, minSpeedKmh: 92, exitSpeedKmh: 140, throttleStartPct: 0.57 }]
      }),
      historyLap('3', DRY_IDENTITY, [recurring], {
        lapTimeSec: 88,
        cornerMetrics: [{ corner: 7, entrySpeedKmh: 201, minSpeedKmh: 94, exitSpeedKmh: 145, throttleStartPct: 0.55 }]
      })
    ]
    const historyEvidence = buildRacecraftHistoryEvidence(DRY_IDENTITY, history)

    const overtake = buildRacecraftAdvice('overtake', {
      condition: 'dry',
      historyEvidence,
      currentGapAheadSec: 0.9
    })
    const defend = buildRacecraftAdvice('pull-away', {
      condition: 'dry',
      historyEvidence,
      currentGapBehindSec: 0.7
    })

    expect(overtake).toMatchObject({
      mode: 'overtake',
      evidenceSource: 'history',
      comparableHistoryLaps: 3
    })
    expect(overtake.items[0]).toMatchObject({
      corner: 7,
      source: 'history',
      evidence: {
        source: 'history',
        referenceSource: 'history-best',
        lapsSeen: 3,
        lapsCompared: 3
      }
    })
    expect(overtake.text).toContain('exit 138 km/h vs 145 km/h')
    expect(overtake.text.match(/Player history:/g)).toHaveLength(1)
    expect(defend.mode).toBe('defend')
    expect(defend.items[0].source).toBe('history')
    for (const text of [overtake.text, defend.text]) {
      expect(text).toContain('opponent controls are unavailable')
      expect(text).not.toMatch(/opponent (?:brak|throttle|turn|entry|exit)/i)
    }
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
    expect(advice.text).toContain('no reliable gap to the car ahead')
    expect(advice.text).toContain('opponent controls are unavailable')
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
        { at: 2000, aheadSec: 0.5, aheadCarIdx: 20 },
        { at: 4000, aheadSec: 0.7, aheadCarIdx: 20 },
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
          finding('brake-early', { corner: 1, sector: 1, zonePctStart: 0.1, zonePctEnd: 0.14, estTimeLossSec: 0.1 }),
          finding('brake-late', { corner: 1, sector: 1, zonePctStart: 0.1, zonePctEnd: 0.14, estTimeLossSec: 0.35 }),
          finding('throttle-late', { corner: 2, sector: 1, zonePctStart: 0.25, zonePctEnd: 0.29, estTimeLossSec: 0.25 }),
          finding('steering-late', { corner: 3, sector: 2, zonePctStart: 0.5, zonePctEnd: 0.54, estTimeLossSec: 0.2 }),
          finding('coast', { corner: 4, sector: 3, zonePctStart: 0.75, zonePctEnd: 0.79, estTimeLossSec: 0.15 })
        ]
      },
      { maxItems: 3 }
    )

    expect(advice.items.length).toBeGreaterThan(0)
    expect(advice.items.length).toBeLessThanOrEqual(3)
    expect(advice.text.length).toBeLessThanOrEqual(MAX_RACECRAFT_ADVICE_LENGTH)
    expect(advice.text).toContain('brake a touch earlier')
    expect(advice.text).not.toContain('brake later toward')
  })

  it.each([
    ['yellow-flag', { flagYellow: true }],
    ['blue-flag', { flagBlue: true }],
    ['red-flag', { flagRed: true }],
    ['black-flag', { flagBlack: true }],
    ['meatball', { flagMeatball: true }],
    ['repair', { flagRepair: true }],
    ['disqualify', { flagDisqualify: true }],
    ['non-racing', { flagCheckered: true }],
    ['caution', { caution: true }],
    ['pacing', { paceMode: 'doubleFileRestart' as const }],
    ['pit', { onPitRoad: true }],
    ['replay', { replayState: 'replay' as const }],
    ['non-racing', { sessionState: 'warmup' as const }],
    ['not-on-track', { onTrack: false }]
  ])('suppresses tactical advice for %s', (reason, safety) => {
    for (const intent of ['overtake', 'pull-away'] as const) {
      const advice = buildRacecraftAdvice(intent, {
        safety,
        findings: [finding('throttle-late', { corner: 7, phase: 'exit' })],
        currentGapAheadSec: 0.7,
        currentGapBehindSec: 0.7
      })

      expect(advice).toMatchObject({
        mode: 'suppressed',
        suppressedReason: reason,
        items: [],
        gapTrend: 'unknown'
      })
      expect(advice.text).not.toContain('Turn 7')
    }
  })

  it.each([
    'yellow',
    'blue',
    'red',
    'black',
    'meatball',
    'repair',
    'disqualify',
    'checkered'
  ] as const)('maps telemetry flag %s into suppression for both tactical intents', (flag) => {
    const flags: Flags = {
      green: false,
      yellow: false,
      blue: false,
      white: false,
      checkered: false,
      red: false,
      black: false,
      meatball: false,
      repair: false,
      disqualify: false,
      greenWhiteCheckered: false,
      [flag]: true
    }
    const safety = racecraftSafetyFromSnapshot({
      connected: true,
      flags
    } as TelemetrySnapshot)

    for (const intent of ['overtake', 'pull-away'] as const) {
      expect(
        buildRacecraftAdvice(intent, {
          safety,
          findings: [finding('brake-late', { corner: 2 })],
          currentGapAheadSec: 0.8,
          currentGapBehindSec: 0.8
        })
      ).toMatchObject({ mode: 'suppressed', items: [] })
    }
  })

  it('ignores huge irrelevant gaps and requires confidence before calling a trend closing', () => {
    const huge = analyzeGapTrend(
      [
        { at: 1000, aheadSec: 20 },
        { at: 3000, aheadSec: 19.9 },
        { at: 5000, aheadSec: 19.8 }
      ],
      'ahead',
      19.8
    )
    const lowConfidence = analyzeGapTrend(
      [
        { at: 1000, aheadSec: 2.0 },
        { at: 4000, aheadSec: 1.7 }
      ],
      'ahead',
      1.7
    )
    const advice = buildRacecraftAdvice('overtake', {
      findings: [finding('throttle-late', { corner: 7, phase: 'exit' })],
      gaps: [
        { at: 1000, aheadSec: 20 },
        { at: 3000, aheadSec: 19.9 },
        { at: 5000, aheadSec: 19.8 }
      ],
      currentGapAheadSec: 19.8
    })

    expect(huge).toMatchObject({ relevant: false, trend: 'unknown', confidence: 0 })
    expect(lowConfidence.trend).toBe('unknown')
    expect(advice.mode).toBe('lap-improvement')
    expect(advice.gapTrend).toBe('unknown')
  })

  it('lets current evidence win over contradictory history in the same normalized zone', () => {
    const historical = finding('brake-early', {
      corner: 2,
      sector: 1,
      zonePctStart: 0.205,
      zonePctEnd: 0.255,
      confidence: 0.95
    })
    const historyEvidence = buildRacecraftHistoryEvidence(DRY_IDENTITY, [
      historyLap('1', DRY_IDENTITY, [historical]),
      historyLap('2', DRY_IDENTITY, [historical]),
      historyLap('3', DRY_IDENTITY, [historical])
    ])
    const advice = buildRacecraftAdvice('overtake', {
      condition: 'dry',
      historyEvidence,
      findings: [
        finding('brake-late', {
          corner: 2,
          sector: 1,
          zonePctStart: 0.21,
          zonePctEnd: 0.25,
          confidence: 0.8
        })
      ],
      currentGapAheadSec: 0.8
    })

    expect(advice.items).toHaveLength(1)
    expect(advice.items[0]).toMatchObject({ kind: 'brake-late', source: 'current-lap' })
    expect(advice.text).toContain('brake a touch earlier')
    expect(advice.text).not.toContain('brake later')
  })

  it('does not claim an identical reference value is an improvement target', () => {
    const advice = buildRacecraftAdvice('overtake', {
      findings: [
        finding('brake-early', {
          corner: 2,
          phase: 'entry',
          metrics: { brakeStartPct: 0.42 }
        })
      ],
      cornerMetrics: [{ corner: 2, entrySpeedKmh: 180, minSpeedKmh: 90, brakeStartPct: 0.42 }],
      reference: {
        corners: [{ corner: 2, entrySpeedKmh: 180, minSpeedKmh: 90, brakeStartPct: 0.42 }]
      },
      currentGapAheadSec: 0.8
    })

    expect(advice.items[0].evidence.referenceBrakePointPct).toBeUndefined()
    expect(advice.items[0].evidence.referenceSource).toBeUndefined()
    expect(advice.items[0].text).not.toContain(' vs ')
    expect(advice.items[0].action).not.toContain('reference')
  })

  it('keeps deterministic advice and caveats localized and capped in every app language', () => {
    const copy: Record<CoachAdviceLanguage, { overtake: string; defend: string; caveat: string }> = {
      'en-US': { overtake: 'OVERTAKE', defend: 'DEFEND', caveat: 'opponent controls are unavailable' },
      'pt-BR': { overtake: 'ULTRAPASSAGEM', defend: 'DEFESA', caveat: 'controles do rival não estão disponíveis' },
      es: { overtake: 'ADELANTAMIENTO', defend: 'DEFENSA', caveat: 'controles del rival no están disponibles' },
      fr: { overtake: 'DÉPASSEMENT', defend: 'DÉFENSE', caveat: 'commandes du rival ne sont pas disponibles' },
      de: { overtake: 'ÜBERHOLEN', defend: 'VERTEIDIGEN', caveat: 'Eingaben des Gegners sind nicht verfügbar' },
      zh: { overtake: '超车', defend: '防守', caveat: '无法获取对手的刹车' },
      ja: { overtake: 'オーバーテイク', defend: 'ディフェンス', caveat: '相手のブレーキ' }
    }
    for (const language of Object.keys(copy) as CoachAdviceLanguage[]) {
      const advice = buildRacecraftAdvice(
        'overtake',
        {
          currentGapAheadSec: 0.8,
          findings: [
            finding('brake-late', { corner: 1, zonePctStart: 0.1, zonePctEnd: 0.14 }),
            finding('throttle-late', { corner: 2, zonePctStart: 0.3, zonePctEnd: 0.34 }),
            finding('steering-late', { corner: 3, zonePctStart: 0.5, zonePctEnd: 0.54 }),
            finding('coast', { corner: 4, zonePctStart: 0.7, zonePctEnd: 0.74 })
          ]
        },
        { language }
      )
      const defend = buildRacecraftAdvice(
        'pull-away',
        {
          currentGapBehindSec: 0.8,
          findings: [finding('throttle-late', { corner: 2, phase: 'exit' })]
        },
        { language }
      )
      expect(advice.text).toContain(copy[language].overtake)
      expect(defend.text).toContain(copy[language].defend)
      expect(advice.text).toContain(copy[language].caveat)
      expect(defend.text).toContain(copy[language].caveat)
      expect(advice.text.length).toBeLessThanOrEqual(MAX_RACECRAFT_ADVICE_LENGTH)
      expect(defend.text.length).toBeLessThanOrEqual(MAX_RACECRAFT_ADVICE_LENGTH)
      expect(advice.honestyNote.length).toBeGreaterThan(10)
      expect(advice.items.length).toBeGreaterThan(0)
    }
  })
})

describe('qualifying comparable history', () => {
  it('separates dry, wet, intermediate, and drying conditions deterministically', () => {
    expect(classifyCoachTrackCondition({})).toBe('unknown')
    expect(classifyCoachTrackCondition({ isRaining: false })).toBe('unknown')
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

  it('builds history evidence without leaking wet laps into a dry plan', () => {
    const wet = { ...DRY_IDENTITY, condition: 'wet' as const }
    const dryFinding = finding('brake-early', { corner: 2, phase: 'entry' })
    const wetFinding = finding('throttle-late', { corner: 9, phase: 'exit' })
    const evidence = buildRacecraftHistoryEvidence(DRY_IDENTITY, [
      historyLap('dry-1', DRY_IDENTITY, [dryFinding]),
      historyLap('dry-2', DRY_IDENTITY, [dryFinding]),
      historyLap('dry-3', DRY_IDENTITY, [dryFinding]),
      historyLap('wet-1', wet, [wetFinding]),
      historyLap('wet-2', wet, [wetFinding]),
      historyLap('wet-3', wet, [wetFinding])
    ])

    expect(evidence.comparableLapCount).toBe(3)
    expect(evidence.sufficientHistory).toBe(true)
    expect(evidence.patterns.map((pattern) => pattern.finding.corner)).toEqual([2])
  })

  it('does not promote a one-off historical mistake as a recurring racecraft pattern', () => {
    const evidence = buildRacecraftHistoryEvidence(DRY_IDENTITY, [
      historyLap('1', DRY_IDENTITY, [finding('brake-early', { corner: 2 })]),
      historyLap('2', DRY_IDENTITY, []),
      historyLap('3', DRY_IDENTITY, [])
    ])
    const advice = buildRacecraftAdvice('overtake', {
      condition: 'dry',
      historyEvidence: evidence,
      currentGapAheadSec: 0.8
    })

    expect(evidence.comparableLapCount).toBe(3)
    expect(evidence.patterns).toEqual([])
    expect(advice.evidenceSource).toBe('none')
    expect(advice.text).toContain('No recurring high-confidence player loss')
  })

  it('allows providers without config while separating known layouts and identities', () => {
    const exact = historyLap('exact', DRY_IDENTITY, [])
    const accIdentity = {
      ...DRY_IDENTITY,
      trackId: 'monza',
      trackName: 'monza',
      trackConfigName: undefined
    }
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
    expect(areCoachLapsComparable(accIdentity, { ...accIdentity })).toBe(true)
    expect(
      areCoachLapsComparable(
        { ...accIdentity, trackName: 'Monza', trackId: 77 },
        { ...accIdentity, trackName: 'Autodromo Nazionale Monza', trackId: 77 }
      )
    ).toBe(true)
    expect(
      areCoachLapsComparable(
        { ...accIdentity, trackConfigName: 'Grand Prix' },
        { ...accIdentity, trackConfigName: 'Sprint' }
      )
    ).toBe(false)
    expect(
      areCoachLapsComparable(
        { ...accIdentity, trackConfigName: 'Grand Prix' },
        accIdentity
      )
    ).toBe(false)
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
    expect(summary.text).toContain('player dry history, 3 comparable completed laps')
    expect(summary.text).toContain('3/3 laps')
    expect(summary.text.length).toBeLessThanOrEqual(MAX_QUALI_BRIEFING_LENGTH)
  })

  it('plainly reports sparse history without promoting current-session evidence', () => {
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
    expect(summary.source).toBe('none')
    expect(summary.items).toEqual([])
    expect(summary.insufficientReason).toBe('laps')
    expect(summary.text).toContain('insufficient dry history (1/3 completed laps)')
    expect(summary.text).toContain('no personalized briefing')
  })

  it('does not classify unknown conditions or incomplete identity as personalized history', () => {
    const unknownCondition = buildQualiStartSummary({
      current: { ...DRY_IDENTITY, condition: 'unknown' },
      history: [
        historyLap('1', DRY_IDENTITY, [finding('brake-early', { corner: 2 })]),
        historyLap('2', DRY_IDENTITY, [finding('brake-early', { corner: 2 })]),
        historyLap('3', DRY_IDENTITY, [finding('brake-early', { corner: 2 })])
      ]
    })
    const unknownTrack = buildQualiStartSummary({
      current: { ...DRY_IDENTITY, trackName: undefined, trackId: undefined },
      history: []
    })

    expect(unknownCondition).toMatchObject({
      sufficientHistory: false,
      comparableLapCount: 0,
      source: 'none',
      items: []
    })
    expect(unknownCondition.text).toContain('track condition unknown')
    expect(unknownCondition.text).toContain('dry and wet history remain separate')
    expect(unknownCondition.text).not.toContain('Turn 2')
    expect(unknownTrack.text).toContain('track or car identity is unavailable')
  })

  it('rejects 1/1 and 2/120 as recurring history evidence', () => {
    const recurring = finding('brake-early', { corner: 2, confidence: 0.95 })
    const oneLap = buildRacecraftHistoryEvidence(DRY_IDENTITY, [
      historyLap('1', DRY_IDENTITY, [recurring])
    ])
    const sparseOccurrence = buildRacecraftHistoryEvidence(
      DRY_IDENTITY,
      Array.from({ length: 120 }, (_, index) =>
        historyLap(
          String(index + 1),
          DRY_IDENTITY,
          index < 2 ? [recurring] : []
        )
      )
    )

    expect(oneLap).toMatchObject({
      comparableLapCount: 1,
      sufficientHistory: false,
      patterns: []
    })
    expect(sparseOccurrence).toMatchObject({
      comparableLapCount: 120,
      sufficientHistory: true,
      patterns: []
    })
    const oneLapAdvice = buildRacecraftAdvice('overtake', {
      condition: 'dry',
      historyEvidence: oneLap,
      currentGapAheadSec: 0.8
    })
    expect(oneLapAdvice.text).toContain('Insufficient evidence: 1/3 comparable completed laps')
    const summary = buildQualiStartSummary({
      current: DRY_IDENTITY,
      history: Array.from({ length: 120 }, (_, index) =>
        historyLap(String(index + 1), DRY_IDENTITY, index < 2 ? [recurring] : [])
      )
    })
    expect(summary.items).toEqual([])
    expect(summary.insufficientReason).toBe('confidence')
    expect(summary.text).toContain('No recurring high-confidence loss')
  })

  it('rejects frequent but low-confidence history patterns', () => {
    const lowConfidence = finding('throttle-late', {
      corner: 7,
      phase: 'exit',
      confidence: 0.4
    })
    const history = [
      historyLap('1', DRY_IDENTITY, [lowConfidence]),
      historyLap('2', DRY_IDENTITY, [lowConfidence]),
      historyLap('3', DRY_IDENTITY, [lowConfidence])
    ]

    expect(buildRacecraftHistoryEvidence(DRY_IDENTITY, history).patterns).toEqual([])
    const summary = buildQualiStartSummary({ current: DRY_IDENTITY, history })
    expect(summary.items).toEqual([])
    expect(summary.insufficientReason).toBe('confidence')
  })

  it('attributes history once, limits useful points, and caps qualifying speech', () => {
    const findings = [
      finding('brake-late', { corner: 1, zonePctStart: 0.1, zonePctEnd: 0.14 }),
      finding('throttle-late', { corner: 2, zonePctStart: 0.3, zonePctEnd: 0.34 }),
      finding('steering-late', { corner: 3, zonePctStart: 0.5, zonePctEnd: 0.54 })
    ]
    const summary = buildQualiStartSummary({
      current: DRY_IDENTITY,
      history: [
        historyLap('1', DRY_IDENTITY, findings),
        historyLap('2', DRY_IDENTITY, findings),
        historyLap('3', DRY_IDENTITY, findings)
      ]
    })

    expect(summary.items.length).toBeLessThanOrEqual(2)
    expect(summary.text.length).toBeLessThanOrEqual(MAX_QUALI_BRIEFING_LENGTH)
    expect(summary.text.match(/history/gi)).toHaveLength(1)
  })

  it('localizes sparse qualifying briefings in every app language', () => {
    const labels: Record<CoachAdviceLanguage, string> = {
      'en-US': 'QUALIFY',
      'pt-BR': 'QUALI',
      es: 'CLASIFICACIÓN',
      fr: 'QUALIFICATIONS',
      de: 'QUALIFYING',
      zh: '排位赛',
      ja: '予選'
    }
    for (const language of Object.keys(labels) as CoachAdviceLanguage[]) {
      const summary = buildQualiStartSummary({
        current: DRY_IDENTITY,
        history: [historyLap('1', DRY_IDENTITY, [finding('brake-early')])],
        language
      })
      expect(summary.text).toContain(labels[language])
      expect(summary.items).toEqual([])
      expect(summary.text.length).toBeLessThanOrEqual(MAX_QUALI_BRIEFING_LENGTH)
    }
  })
})
