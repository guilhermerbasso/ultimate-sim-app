import { describe, expect, it } from 'vitest'
import type { CoachFinding } from './coach'
import type { PredictionsSnapshot } from './predictions'
import {
  composeDebrief,
  debriefLlmFacts,
  findingLocation,
  formatLapTime,
  gainMagnitudeSec,
  isGainFinding,
  isLossFinding,
  lossMagnitudeSec,
  strategyNote,
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
    title: partial.title ?? 'Braked tarde',
    detail: partial.detail ?? '',
    evidence: partial.evidence ?? '',
    metrics: partial.metrics ?? {},
    ...partial
  }
}

function good(partial: Partial<CoachFinding>): CoachFinding {
  return loss({ kind: 'good', severity: 'good', estTimeLossSec: 0, title: 'No padrão', ...partial })
}

const fullPredictions: PredictionsSnapshot = {
  fuel: { lapsLeftAtPace: 12, finishMarginLaps: 2.4, finishMarginL: 3.1 },
  tire: { degSecPerLap: 0.08, lapsToCliff: 6, pressureState: 'low', tempState: 'hot' },
  pace: { projectedLapSec: 83.456, confidence: 0.7 }
}

describe('formatLapTime', () => {
  it('formats seconds as m:ss,mmm', () => {
    expect(formatLapTime(83.456)).toBe('1:23,456')
    expect(formatLapTime(5.2)).toBe('0:05,200')
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
    expect(findingLocation(loss({ sector: 2, corner: 5 } as Partial<CoachFinding>))).toBe('Turn 5')
    expect(findingLocation(loss({ sector: 3 }))).toBe('Sector 3')
  })
})

describe('strategyNote', () => {
  it('summarizes fuel/tyre/pace', () => {
    const note = strategyNote(fullPredictions)
    expect(note).toContain('fuel')
    expect(note).toContain('margem de 2,4 laps')
    expect(note).toContain('tire')
    expect(note).toContain('até cair')
    expect(note).toContain('pace projetado 1:23,456')
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
  it('summarizes BOTH losses (onde perdeu) and gains (onde foi bem)', () => {
    const findings: CoachFinding[] = [
      loss({ id: 'a', sector: 1, estTimeLossSec: 0.4, title: 'Braked tarde' }),
      loss({ id: 'b', sector: 2, estTimeLossSec: 0.1, title: 'Acelerou cedo', kind: 'throttle-hesitation' }),
      good({ id: 'c', sector: 3, title: 'Mais speed de entrada', sign: 'gain', estTimeGainSec: 0.2 } as Partial<CoachFinding>)
    ]
    const out = composeDebrief(findings, fullPredictions, { trackName: 'Interlagos', lapsCompleted: 14 })

    expect(out.text).toContain('Onde perdeu')
    expect(out.text).toContain('Onde foi bem')
    expect(out.text).toContain('Interlagos')
    // Biggest loss ranked first.
    expect(out.text.indexOf('Braked tarde')).toBeLessThan(out.text.indexOf('Acelerou cedo'))

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
    expect(out.text).toContain('Sem dados suficientes')
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
    expect(strat).toContain('fuel')
    expect(strat).toContain('tire')
    expect(strat).toContain('pressão baixa')
    expect(strat).toContain('temp quente')
  })

  it('tolerates null/garbage findings input', () => {
    const out = composeDebrief(null, null)
    expect(out.text).toContain('Sem dados suficientes')
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
})
