import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DashboardElement, DashboardElementType } from '../../../../shared/dashboards'
import type { CoachFinding, CoachReport } from '../../../../shared/coach'
import {
  coachFindings,
  findingScope,
  findingTone,
  sectorDeltaBars,
  topCoachTips
} from '../../lib/coach-insights'
import { feedClock } from '../../lib/engineer-feed'
import { COACH_ENGINEER_WIDGET_TYPES, renderCoachEngineerWidget } from './coach-engineer-widgets'

function finding(partial: Partial<CoachFinding>): CoachFinding {
  return {
    id: partial.id ?? 'f1',
    kind: partial.kind ?? 'brake-late',
    sector: partial.sector ?? 1,
    zonePctStart: 0.1,
    zonePctEnd: 0.2,
    severity: partial.severity ?? 'high',
    estTimeLossSec: partial.estTimeLossSec ?? 0.3,
    title: partial.title ?? 'Freou tarde',
    detail: partial.detail ?? 'Antecipe a frenagem.',
    evidence: partial.evidence ?? '',
    metrics: {},
    corner: partial.corner,
    ...partial
  }
}

const REPORT: CoachReport = {
  generatedAt: Date.now(),
  sampleCount: 100,
  sectors: [
    { sector: 1, timeLossSec: 0.4, minSpeedKmh: 90, brakePct: 0.2, coastPct: 0.1, throttlePct: 0.6, absSec: 0, tcSec: 0, benchmark: false },
    { sector: 2, timeLossSec: 0, minSpeedKmh: 110, brakePct: 0.1, coastPct: 0, throttlePct: 0.8, absSec: 0, tcSec: 0, benchmark: true },
    { sector: 3, timeLossSec: 0.15, minSpeedKmh: 100, brakePct: 0.15, coastPct: 0.05, throttlePct: 0.7, absSec: 0, tcSec: 0, benchmark: false }
  ],
  findings: [
    finding({ id: 'a', severity: 'high', corner: 4, title: 'Freou tarde', estTimeLossSec: 0.3 }),
    finding({ id: 'b', severity: 'med', sector: 2, title: 'Coast no meio', estTimeLossSec: 0.12 }),
    finding({ id: 'c', severity: 'good', kind: 'good', sector: 3, title: 'Sector limpo', estTimeLossSec: 0 })
  ],
  corners: [],
  cornerMetrics: [],
  summary: 'Foco na curva 4.'
}

function el(type: string, w = 300, h = 180): DashboardElement {
  return { id: `e-${type}`, type: type as DashboardElementType, x: 0, y: 0, w, h, style: {} }
}

function markup(type: string): string {
  const node = renderCoachEngineerWidget({ element: el(type), snapshot: null })
  return node ? renderToStaticMarkup(node) : ''
}

describe('coach-insights pure helpers', () => {
  it('topCoachTips surfaces improvement findings first, capped', () => {
    const tips = topCoachTips(REPORT, 3)
    expect(tips.map((t) => t.id)).toEqual(['a', 'b'])
    expect(topCoachTips(null)).toEqual([])
    expect(topCoachTips(REPORT, 1).length).toBe(1)
  })

  it('coachFindings returns the ranked list capped', () => {
    expect(coachFindings(REPORT, 2).length).toBe(2)
    expect(coachFindings(null)).toEqual([])
  })

  it('findingScope prefers Curva over Setor', () => {
    expect(findingScope(finding({ corner: 7, sector: 2 }))).toBe('Curva 7')
    expect(findingScope(finding({ corner: undefined, sector: 2 }))).toBe('Sector 2')
  })

  it('findingTone maps severities (good is the only cool tone)', () => {
    expect(findingTone('good')).toBe('good')
    expect(findingTone('low')).toBe('improve')
    expect(findingTone('med')).toBe('warn')
    expect(findingTone('high')).toBe('critical')
  })

  it('sectorDeltaBars marks benchmark sectors good and others as warm losses', () => {
    const bars = sectorDeltaBars(REPORT)
    expect(bars.map((b) => b.good)).toEqual([false, true, false])
    expect(bars[0]?.deltaSec).toBeCloseTo(-0.4, 5)
    expect(bars[1]?.deltaSec).toBe(0)
    expect(sectorDeltaBars(null)).toEqual([])
  })
})

describe('engineer-feed feedClock', () => {
  it('formats epoch ms as HH:MM and rejects invalid', () => {
    const at = new Date(2024, 0, 1, 9, 5, 0).getTime()
    expect(feedClock(at)).toBe('09:05')
    expect(feedClock(0)).toBe('')
    expect(feedClock(Number.NaN)).toBe('')
  })
})

describe('coach + engineer dashboard widgets', () => {
  it('declares the 4 widget types uniquely', () => {
    expect(COACH_ENGINEER_WIDGET_TYPES.length).toBe(4)
    expect(new Set(COACH_ENGINEER_WIDGET_TYPES).size).toBe(4)
  })

  it('dispatches every type and renders a graceful empty state with no data', () => {
    for (const type of COACH_ENGINEER_WIDGET_TYPES) {
      const out = markup(type)
      expect(out.length, `empty render ${type}`).toBeGreaterThan(10)
      expect(out, `NaN in ${type}`).not.toContain('NaN')
      expect(out, `undefined leaked in ${type}`).not.toContain('undefined')
    }
  })

  it('returns null for an unknown type', () => {
    expect(renderCoachEngineerWidget({ element: el('not-a-coach' as DashboardElementType), snapshot: null })).toBeNull()
  })
})
