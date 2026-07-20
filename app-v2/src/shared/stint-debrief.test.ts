import { describe, expect, it } from 'vitest'
import type { CoachFinding } from './coach'
import type { PredictionsSnapshot } from './predictions'
import {
  DEBRIEF_ARCHIVE_MAX_RECORDS,
  DEBRIEF_ARCHIVE_RECORD_SCHEMA,
  DEBRIEF_ARCHIVE_SCHEMA,
  DEBRIEF_ARCHIVE_VERSION,
  composeDebrief,
  createDebriefArchive,
  debriefArchiveSummary,
  debriefLlmFacts,
  findingLocation,
  formatLapTime,
  gainMagnitudeSec,
  isGainFinding,
  isLossFinding,
  lossMagnitudeSec,
  normalizeDebriefArchive,
  normalizeDebriefArchiveGenerateRequest,
  normalizeDebriefArchiveRecord,
  normalizeStintDebrief,
  strategyNote,
  type DebriefArchiveRecord,
  type DebriefSessionInfo
} from './stint-debrief'

function loss(partial: Partial<CoachFinding>): CoachFinding {
  return {
    id: partial.id ?? 'l1',
    kind: partial.kind ?? 'brake-late',
    sector: partial.sector ?? 1,
    zonePctStart: 0,
    zonePctEnd: 0.2,
    severity: partial.severity ?? 'high',
    estTimeLossSec: partial.estTimeLossSec ?? 0.2,
    title: partial.title ?? 'Braked late',
    detail: partial.detail ?? '',
    evidence: partial.evidence ?? '',
    metrics: partial.metrics ?? {},
    ...partial
  }
}

function good(partial: Partial<CoachFinding>): CoachFinding {
  return loss({ kind: 'good', severity: 'good', estTimeLossSec: 0, title: 'On baseline', ...partial })
}

const fullPredictions: PredictionsSnapshot = {
  fuel: { lapsLeftAtPace: 12, finishMarginLaps: 2.4, finishMarginL: 3.1 },
  tire: { degSecPerLap: 0.08, lapsToCliff: 6, pressureState: 'low', tempState: 'hot' },
  pace: { projectedLapSec: 83.456, confidence: 0.7 }
}

function archiveRecord(
  capturedAt: number,
  overrides: Partial<DebriefArchiveRecord> = {}
): DebriefArchiveRecord {
  const id = `debrief_${String(capturedAt).padStart(16, '0')}`
  const sessionInfo: DebriefSessionInfo = {
    trackName: `Track ${capturedAt}`,
    carName: 'GT3 R',
    sessionType: 'Race',
    lapsCompleted: 8,
    reason: 'session-end'
  }
  return {
    schema: DEBRIEF_ARCHIVE_RECORD_SCHEMA,
    version: DEBRIEF_ARCHIVE_VERSION,
    id,
    capturedAt,
    reason: 'session-end',
    sessionInfo,
    findings: [loss({ id: `finding-${capturedAt}` })],
    predictions: fullPredictions,
    setup: {
      generatedAt: capturedAt,
      summary: 'One measured change.',
      suggestions: [{
        id: `setup-${capturedAt}`,
        symptom: 'pressure-high',
        corner: 'all',
        confidence: 'high',
        rationale: 'Middle tread is hotter than both edges.',
        evidence: 'Middle average 108 C; edges 96 C.',
        primary: {
          code: 'tyre-pressure-decrease-cold',
          area: 'tyres',
          direction: 'decrease',
          magnitude: 'small',
          change: 'Reduce cold pressure by one small step.'
        },
        alternatives: [{
          area: 'alignment',
          direction: 'adjust',
          magnitude: 'small',
          change: 'Recheck camber after the pressure run.'
        }],
        metrics: { middleDeltaC: 12 }
      }]
    },
    debrief: {
      generatedAt: capturedAt,
      text: `Debrief ${capturedAt}.`,
      bullets: ['⚠ Turn 1'],
      source: 'deterministic',
      language: 'en-US',
      reason: 'session-end',
      sessionInfo: { ...sessionInfo }
    },
    language: 'en-US',
    unitSystem: 'metric',
    appLanguage: 'en',
    locale: 'en-US',
    captureSource: 'boundary',
    metadataQuality: 'captured',
    ...overrides
  }
}

describe('formatLapTime', () => {
  it('formats seconds as m:ss,mmm', () => {
    expect(formatLapTime(83.456)).toBe('1:23,456')
    expect(formatLapTime(5.2)).toBe('0:05,200')
    expect(formatLapTime(83.456, 'en-US')).toBe('1:23.456')
  })
  it('returns dash for invalid', () => {
    expect(formatLapTime(undefined)).toBe('—')
    expect(formatLapTime(0)).toBe('—')
    expect(formatLapTime(Number.NaN)).toBe('—')
  })
})

describe('finding classification', () => {
  it('splits losses and gains', () => {
    const l = loss({ estTimeLossSec: 0.3 })
    const g = good({})
    expect(isLossFinding(l)).toBe(true)
    expect(isGainFinding(l)).toBe(false)
    expect(isGainFinding(g)).toBe(true)
    expect(isLossFinding(g)).toBe(false)
  })

  it('picks up WS-E bidirectional gains via sign/estTimeGainSec generically', () => {
    const gain = loss({ id: 'g', severity: 'med', estTimeLossSec: 0, sign: 'gain', estTimeGainSec: 0.15 } as Partial<CoachFinding>)
    expect(isGainFinding(gain)).toBe(true)
    expect(isLossFinding(gain)).toBe(false)
    expect(gainMagnitudeSec(gain)).toBeCloseTo(0.15)
  })

  it('ranks magnitudes', () => {
    expect(lossMagnitudeSec(loss({ estTimeLossSec: 0.5 }))).toBe(0.5)
    expect(gainMagnitudeSec(good({}))).toBe(0)
  })

  it('locates by corner (WS-E) then sector', () => {
    expect(findingLocation(loss({ sector: 2, corner: 5 } as Partial<CoachFinding>))).toBe('Curva 5')
    expect(findingLocation(loss({ sector: 3 }))).toBe('Setor 3')
    expect(findingLocation(loss({ sector: 2, corner: 5 } as Partial<CoachFinding>), 'en-US')).toBe('Turn 5')
  })
})

describe('strategyNote', () => {
  it('summarizes fuel/tyre/pace', () => {
    const note = strategyNote(fullPredictions)
    expect(note).toContain('combustível')
    expect(note).toContain('margem de 2,4 voltas')
    expect(note).toContain('pneus')
    expect(note).toContain('até a queda')
    expect(note).toContain('ritmo projetado 1:23,456')
  })

  it('flags a fuel deficit', () => {
    const note = strategyNote({ ...fullPredictions, fuel: { lapsLeftAtPace: 8, finishMarginLaps: -1.5, finishMarginL: -2 } })
    expect(note).toContain('déficit')
    expect(note).toContain('economizar')
  })

  it('returns null with no signal', () => {
    expect(strategyNote(null)).toBeNull()
    expect(
      strategyNote({
        fuel: { lapsLeftAtPace: Number.NaN, finishMarginLaps: Number.NaN, finishMarginL: Number.NaN },
        tire: { degSecPerLap: 0, pressureState: 'ok', tempState: 'optimal' },
        pace: { projectedLapSec: 0, confidence: 0 }
      })
    ).toBeNull()
  })
})

describe('composeDebrief', () => {
  it('summarizes BOTH losses and gains', () => {
    const findings: CoachFinding[] = [
      loss({ id: 'a', sector: 1, estTimeLossSec: 0.4, title: 'Braked late' }),
      loss({ id: 'b', sector: 2, estTimeLossSec: 0.1, title: 'Got on throttle early', kind: 'throttle-hesitation' }),
      good({ id: 'c', sector: 3, title: 'More entry speed', sign: 'gain', estTimeGainSec: 0.2 } as Partial<CoachFinding>)
    ]
    const out = composeDebrief(findings, fullPredictions, { trackName: 'Interlagos', lapsCompleted: 14 })

    expect(out.text).toContain('Onde perdeu tempo')
    expect(out.text).toContain('Onde foi bem')
    expect(out.text).toContain('Interlagos')
    // Biggest loss ranked first.
    expect(out.text.indexOf('freie antes')).toBeLessThan(out.text.indexOf('confie no acelerador'))

    const lossBullets = out.bullets.filter((b) => b.startsWith('⚠'))
    const gainBullets = out.bullets.filter((b) => b.startsWith('✅'))
    const stratBullets = out.bullets.filter((b) => b.startsWith('📊'))
    expect(lossBullets.length).toBe(2)
    expect(gainBullets.length).toBe(1)
    expect(stratBullets.length).toBe(1)
    expect(gainBullets[0]).toContain('+0,20 s')
  })

  it('handles empty findings + no predictions gracefully', () => {
    const out = composeDebrief([], null)
    expect(out.bullets).toEqual([])
    expect(out.text).toContain('Ainda não há dados suficientes')
  })

  it('still composes with only predictions (no findings)', () => {
    const out = composeDebrief([], fullPredictions)
    expect(out.text).toContain('Estratégia')
    expect(out.bullets.some((b) => b.startsWith('📊'))).toBe(true)
    // Clean stint message when there are no losses.
    expect(out.text).toContain('stint limpo')
  })

  it('includes fuel + tyre notes in the strategy line', () => {
    const out = composeDebrief([loss({ estTimeLossSec: 0.3 })], fullPredictions)
    const strat = out.bullets.find((b) => b.startsWith('📊')) ?? ''
    expect(strat).toContain('combustível')
    expect(strat).toContain('pneus')
    expect(strat).toContain('pressão baixa')
    expect(strat).toContain('temperatura quente')
  })

  it('tolerates null/garbage findings input', () => {
    const out = composeDebrief(null, null)
    expect(out.text).toContain('Ainda não há dados suficientes')
    expect(out.bullets).toEqual([])
  })

  it('caps losses at 3 and gains at 2', () => {
    const findings: CoachFinding[] = [
      ...Array.from({ length: 6 }, (_, i) => loss({ id: `l${i}`, sector: 1, estTimeLossSec: 0.5 - i * 0.05, title: `Erro ${i}` })),
      ...Array.from({ length: 4 }, (_, i) => good({ id: `g${i}`, sector: 2, title: `Bom ${i}`, sign: 'gain', estTimeGainSec: 0.3 - i * 0.05 } as Partial<CoachFinding>))
    ]
    const out = composeDebrief(findings, null)
    expect(out.bullets.filter((b) => b.startsWith('⚠')).length).toBe(3)
    expect(out.bullets.filter((b) => b.startsWith('✅')).length).toBe(2)
  })

  it('debriefLlmFacts joins text + bullets for the model to rephrase', () => {
    const info: DebriefSessionInfo = { trackName: 'Spa', reason: 'stint-end' }
    const out = composeDebrief([loss({ estTimeLossSec: 0.3 })], fullPredictions, info)
    const facts = debriefLlmFacts(out)
    expect(facts).toContain(out.text)
    expect(facts.split('\n').length).toBeGreaterThan(1)
  })

  it('composes a matching English debrief when English is active', () => {
    const out = composeDebrief(
      [loss({ estTimeLossSec: 0.3, corner: 4 } as Partial<CoachFinding>)],
      fullPredictions,
      { trackName: 'Spa', lapsCompleted: 8 },
      'metric',
      'en-US'
    )
    expect(out.text).toContain('Where you lost time')
    expect(out.text).toContain('Turn 4')
    expect(out.text).toContain('Strategy')
    expect(out.text).toContain('2.4 laps')
    expect(out.text).toContain('0.08 s/lap')
    expect(out.text).toContain('1:23.456')
    expect(out.bullets.join(' ')).toContain('−0.30 s')
    expect(out.text).not.toContain('Onde perdeu tempo')
  })
})

describe('historical debrief archive contracts', () => {
  it('strictly normalizes a complete immutable analysis record', () => {
    const source = archiveRecord(1_000)
    const normalized = normalizeDebriefArchiveRecord(source)
    expect(normalized).toEqual(source)
    expect(normalized).not.toBe(source)
    expect(normalized?.setup).not.toBe(source.setup)
    expect(debriefArchiveSummary(normalized as DebriefArchiveRecord)).toMatchObject({
      id: source.id,
      setupStatus: 'available',
      analysisStatus: 'available'
    })
  })

  it('fails closed for malformed nested evidence, mismatched context, and oversized text', () => {
    const malformedMetric = archiveRecord(1_001)
    malformedMetric.findings[0].metrics.bad = Number.NaN
    expect(normalizeDebriefArchiveRecord(malformedMetric)).toBeNull()

    const mismatchedReason = archiveRecord(1_002)
    mismatchedReason.debrief.reason = 'stint-end'
    expect(normalizeDebriefArchiveRecord(mismatchedReason)).toBeNull()

    const malformedSetup = archiveRecord(1_003)
    malformedSetup.setup!.suggestions[0].confidence = 'high'
    ;(malformedSetup.setup!.suggestions[0].primary as { area: string }).area = 'magic'
    expect(normalizeDebriefArchiveRecord(malformedSetup)).toBeNull()

    const unknownSetupCode = archiveRecord(1_005)
    ;(unknownSetupCode.setup!.suggestions[0].primary as { code: string }).code = 'invented-change'
    expect(normalizeDebriefArchiveRecord(unknownSetupCode)).toBeNull()

    const mismatchedSetupCode = archiveRecord(1_006)
    mismatchedSetupCode.setup!.suggestions[0].primary.code = 'front-arb-soften'
    expect(normalizeDebriefArchiveRecord(mismatchedSetupCode)).toBeNull()

    const wrongSymptomCode = archiveRecord(1_007)
    wrongSymptomCode.setup!.suggestions[0].primary = {
      code: 'rear-aero-increase',
      area: 'aero',
      direction: 'increase',
      magnitude: 'small',
      change: 'Persisted prose is not authoritative.'
    }
    expect(normalizeDebriefArchiveRecord(wrongSymptomCode)).toBeNull()

    expect(normalizeStintDebrief({
      ...archiveRecord(1_004).debrief,
      text: 'x'.repeat(20_000)
    })).toBeNull()
  })

  it.each([
    ['missing debrief sessionInfo', (record: DebriefArchiveRecord) => {
      delete record.debrief.sessionInfo
    }],
    ['track', (record: DebriefArchiveRecord) => {
      record.debrief.sessionInfo!.trackName = 'Different track'
    }],
    ['car', (record: DebriefArchiveRecord) => {
      record.debrief.sessionInfo!.carName = 'Different car'
    }],
    ['session type', (record: DebriefArchiveRecord) => {
      record.debrief.sessionInfo!.sessionType = 'Practice'
    }],
    ['lap count', (record: DebriefArchiveRecord) => {
      record.debrief.sessionInfo!.lapsCompleted = 9
    }],
    ['best lap', (record: DebriefArchiveRecord) => {
      record.sessionInfo.bestLapTimeSec = 83.2
    }],
    ['reason presence', (record: DebriefArchiveRecord) => {
      delete record.sessionInfo.reason
    }],
    ['language', (record: DebriefArchiveRecord) => {
      record.debrief.language = 'pt-BR'
    }],
    ['debrief timestamp', (record: DebriefArchiveRecord) => {
      record.debrief.generatedAt += 1
    }]
  ] as const)('rejects archive/debrief duplicated metadata mismatch: %s', (_label, mutate) => {
    const record = archiveRecord(1_100)
    mutate(record)
    expect(normalizeDebriefArchiveRecord(record)).toBeNull()
  })

  it('preserves equal absence semantics while rejecting contradictory legacy setup metadata', () => {
    const absentReason = archiveRecord(1_101)
    delete absentReason.sessionInfo.reason
    delete absentReason.debrief.sessionInfo!.reason
    expect(normalizeDebriefArchiveRecord(absentReason)?.sessionInfo).not.toHaveProperty('reason')

    const legacyWithSetup = archiveRecord(1_102, {
      captureSource: 'legacy-last-debrief',
      metadataQuality: 'legacy-defaults'
    })
    expect(normalizeDebriefArchiveRecord(legacyWithSetup)).toBeNull()

    const mismatchedMetadata = archiveRecord(1_103, {
      captureSource: 'legacy-last-debrief',
      metadataQuality: 'captured',
      setup: null
    })
    expect(normalizeDebriefArchiveRecord(mismatchedMetadata)).toBeNull()

    const futureSetup = archiveRecord(1_104)
    futureSetup.setup!.generatedAt = futureSetup.capturedAt + 1
    expect(normalizeDebriefArchiveRecord(futureSetup)).toBeNull()
  })

  it('deduplicates, sorts stably, and keeps only the newest bounded records', () => {
    const records = Array.from(
      { length: DEBRIEF_ARCHIVE_MAX_RECORDS + 5 },
      (_, index) => archiveRecord(index + 1)
    )
    records.push(structuredClone(records[20]))
    const archive = normalizeDebriefArchive({
      schema: DEBRIEF_ARCHIVE_SCHEMA,
      version: DEBRIEF_ARCHIVE_VERSION,
      records: records.reverse()
    })
    expect(archive?.records).toHaveLength(DEBRIEF_ARCHIVE_MAX_RECORDS)
    expect(archive?.records[0].capturedAt).toBe(DEBRIEF_ARCHIVE_MAX_RECORDS + 5)
    expect(archive?.records.at(-1)?.capturedAt).toBe(6)
    expect(new Set(archive?.records.map((record) => record.id)).size).toBe(
      DEBRIEF_ARCHIVE_MAX_RECORDS
    )
  })

  it('uses the opaque ID as a deterministic tie-break and rejects one corrupt member', () => {
    const left = archiveRecord(2_000, { id: 'debrief_aaaaaaaaaaaaaaaa' })
    const right = archiveRecord(2_000, { id: 'debrief_bbbbbbbbbbbbbbbb' })
    expect(createDebriefArchive([right, left])?.records.map((record) => record.id)).toEqual([
      left.id,
      right.id
    ])

    const corrupt = archiveRecord(2_001)
    ;(corrupt.predictions as { tire: { pressureState: string } }).tire.pressureState = 'guessed'
    expect(createDebriefArchive([left, corrupt])).toBeNull()

    const conflictingDuplicate = structuredClone(left)
    conflictingDuplicate.sessionInfo.trackName = 'Conflicting track'
    conflictingDuplicate.debrief.sessionInfo!.trackName = 'Conflicting track'
    expect(createDebriefArchive([left, conflictingDuplicate])).toBeNull()
  })

  it('validates selected-session IPC requests without accepting paths or loose values', () => {
    expect(normalizeDebriefArchiveGenerateRequest({
      sessionId: 'debrief_1234567890abcdef',
      useLlm: true
    })).toEqual({
      sessionId: 'debrief_1234567890abcdef',
      useLlm: true
    })
    expect(normalizeDebriefArchiveGenerateRequest({
      sessionId: '..\\recordings\\session.json'
    })).toBeNull()
    expect(normalizeDebriefArchiveGenerateRequest({
      sessionId: 'debrief_1234567890abcdef',
      useLlm: 'yes'
    })).toBeNull()
  })

  it('labels legacy and no-evidence records without inventing setup guidance', () => {
    const legacy = archiveRecord(3_000, {
      captureSource: 'legacy-last-debrief',
      metadataQuality: 'legacy-defaults',
      setup: null,
      findings: [],
      predictions: null
    })
    expect(debriefArchiveSummary(legacy)).toMatchObject({
      setupStatus: 'legacy',
      analysisStatus: 'legacy'
    })

    const insufficient = archiveRecord(3_001, {
      setup: { generatedAt: 3_001, summary: '', suggestions: [] },
      findings: [],
      predictions: null
    })
    expect(debriefArchiveSummary(insufficient)).toMatchObject({
      setupStatus: 'insufficient',
      analysisStatus: 'insufficient'
    })
  })
})
