import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DashboardElement, DashboardElementType } from '../../../../shared/dashboards'
import type { PredictionsSnapshot } from '../../../../shared/predictions'
import { applyPredictionsSnapshot } from '../../lib/predictions'
import { PREDICTION_WIDGET_TYPES, renderPredictionWidget } from './new-widgets-predictions'

// GT3 theme tokens used by the kit (warm = chrome/bad, cool-green = good).
const GREEN = '#1AFF6E'
const RED = '#FF2200'

const FULL: PredictionsSnapshot = {
  catchAhead: { carIdx: 3, gapSec: 4.2, closingSecPerLap: 0.35, etaSec: 12.6, etaLaps: 3.1 },
  caughtBehind: { carIdx: 9, gapSec: 1.1, closingSecPerLap: 0.6, etaSec: 1.8, etaLaps: 1.4 },
  fuel: { lapsLeftAtPace: 9.4, finishMarginLaps: -0.8, finishMarginL: -2.3 },
  tire: { degSecPerLap: 0.42, lapsToCliff: 2, pressureState: 'high', tempState: 'hot' },
  pace: { projectedLapSec: 92.481, confidence: 0.82 }
}

function el(type: string, w = 240, h = 150): DashboardElement {
  return { id: `e-${type}`, type: type as DashboardElementType, x: 0, y: 0, w, h, style: {} }
}

function markup(type: string): string {
  applyPredictionsSnapshot(FULL)
  const node = renderPredictionWidget({ element: el(type), snapshot: null })
  const out = node ? renderToStaticMarkup(node) : ''
  return out
}

function markupNoData(type: string): string {
  applyPredictionsSnapshot(null)
  const node = renderPredictionWidget({ element: el(type), snapshot: null })
  return node ? renderToStaticMarkup(node) : ''
}

describe('prediction dashboard widgets — registration', () => {
  it('declares 10 kinds (5 predictions × futuristic/minimal)', () => {
    expect(PREDICTION_WIDGET_TYPES.length).toBe(10)
    expect(PREDICTION_WIDGET_TYPES.filter((t) => t.endsWith('-minimal')).length).toBe(5)
    expect(PREDICTION_WIDGET_TYPES.filter((t) => t.endsWith('-futuristic')).length).toBe(5)
    expect(new Set(PREDICTION_WIDGET_TYPES).size).toBe(PREDICTION_WIDGET_TYPES.length)
  })

  it('dispatches every kind to a component (non-null)', () => {
    applyPredictionsSnapshot(FULL)
    for (const type of PREDICTION_WIDGET_TYPES) {
      const node = renderPredictionWidget({ element: el(type), snapshot: null })
      expect(node, `kind ${type} did not dispatch`).not.toBeNull()
    }
  })

  it('returns null for an unknown type', () => {
    expect(renderPredictionWidget({ element: el('not-a-pred' as DashboardElementType), snapshot: null })).toBeNull()
  })
})

describe('prediction dashboard widgets — safe rendering', () => {
  it('renders non-empty markup with + without data, no NaN/undefined', () => {
    for (const type of PREDICTION_WIDGET_TYPES) {
      for (const out of [markup(type), markupNoData(type)]) {
        expect(out.length, `empty render ${type}`).toBeGreaterThan(10)
        expect(out, `NaN in ${type}`).not.toContain('NaN')
        expect(out, `Infinity in ${type}`).not.toContain('Infinity')
        expect(out, `undefined leaked in ${type}`).not.toContain('undefined')
      }
    }
  })

  it('survives non-finite predictions inputs', () => {
    applyPredictionsSnapshot({
      catchAhead: { carIdx: 1, gapSec: Number.NaN, closingSecPerLap: Number.NaN, etaSec: Number.NaN, etaLaps: Number.POSITIVE_INFINITY },
      fuel: { lapsLeftAtPace: Number.NaN, finishMarginLaps: Number.NaN, finishMarginL: Number.POSITIVE_INFINITY },
      tire: { degSecPerLap: Number.NaN, pressureState: 'ok', tempState: 'optimal' },
      pace: { projectedLapSec: Number.NaN, confidence: Number.NaN }
    })
    for (const type of PREDICTION_WIDGET_TYPES) {
      const node = renderPredictionWidget({ element: el(type), snapshot: null })
      const out = node ? renderToStaticMarkup(node) : ''
      expect(out, `NaN in ${type}`).not.toContain('NaN')
      expect(out, `Infinity in ${type}`).not.toContain('Infinity')
    }
  })
})

describe('prediction dashboard widgets — colour rule + values', () => {
  it('catch-ahead is green (closing in) and shows the ETA', () => {
    const out = markup('pred-catch-ahead-futuristic')
    expect(out).toContain(GREEN)
    expect(out).toContain('12.6')
  })

  it('fuel margin is red when negative', () => {
    expect(markup('pred-fuel-margin-futuristic')).toContain(RED)
  })

  it('fuel margin is green with a comfortable surplus', () => {
    applyPredictionsSnapshot({ ...FULL, fuel: { lapsLeftAtPace: 14, finishMarginLaps: 2.4, finishMarginL: 6.1 } })
    const node = renderPredictionWidget({ element: el('pred-fuel-margin-futuristic'), snapshot: null })
    expect(node ? renderToStaticMarkup(node) : '').toContain(GREEN)
  })

  it('tyre is red near the cliff / high deg', () => {
    expect(markup('pred-tire-wear-futuristic')).toContain(RED)
  })

  it('pace shows the projected lap time and keys green at high confidence', () => {
    const out = markup('pred-pace-futuristic')
    expect(out).toContain('1:32.481')
    expect(out).toContain(GREEN)
  })
})

describe('prediction dashboard widgets — style.instrument opt-in routes to DataTile', () => {
  function elInst(type: string): DashboardElement {
    return { id: `i-${type}`, type: type as DashboardElementType, x: 0, y: 0, w: 240, h: 150, style: { instrument: {} } }
  }

  it('every kind renders a DataTile svg surface (no NaN) when instrument is set', () => {
    applyPredictionsSnapshot(FULL)
    for (const type of PREDICTION_WIDGET_TYPES) {
      const node = renderPredictionWidget({ element: elInst(type), snapshot: null })
      const out = node ? renderToStaticMarkup(node) : ''
      expect(out, `${type} not a tile`).toContain('<svg')
      expect(out, `NaN in ${type}`).not.toContain('NaN')
    }
  })

  it('missing predictions render the em-dash placeholder, never NaN', () => {
    applyPredictionsSnapshot(null)
    for (const type of PREDICTION_WIDGET_TYPES) {
      const node = renderPredictionWidget({ element: elInst(type), snapshot: null })
      const out = node ? renderToStaticMarkup(node) : ''
      expect(out, `${type} missing not handled`).toContain('—')
      expect(out, `NaN in ${type}`).not.toContain('NaN')
    }
  })
})
