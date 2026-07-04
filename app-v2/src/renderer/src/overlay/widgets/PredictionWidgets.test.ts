import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayStylePresetId } from '../../../../shared/overlays'
import type { PredictionsSnapshot } from '../../../../shared/predictions'
import { applyPredictionsSnapshot } from '../../lib/predictions'
import { CatchAheadWidget, CaughtBehindWidget, FuelMarginWidget, PaceProjectedWidget, TireWearPredWidget } from './PredictionWidgets'
import { WIDGET_COMPONENTS } from './index'

const configs = createDefaultOverlaysConfig().widgets
const FAMILIES: OverlayStylePresetId[] = ['minimal', 'neon', 'glass', 'broadcast', 'terminal', 'bauhaus', 'analog', 'heatmap']

function clean(markup: string): void {
  expect(markup).not.toContain('NaN')
  expect(markup).not.toContain('undefined')
  expect(markup).not.toContain('Infinity')
}

const predictionSnapshot: PredictionsSnapshot = {
  catchAhead: { carIdx: 2, gapSec: 4, closingSecPerLap: 1, etaSec: 24.4, etaLaps: 2.2 },
  caughtBehind: { carIdx: 3, gapSec: 3, closingSecPerLap: 0.5, etaSec: 60, etaLaps: 5 },
  fuel: { lapsLeftAtPace: 12.3, finishMarginLaps: 1.2, finishMarginL: 3.4 },
  tire: { degSecPerLap: 0.12, lapsToCliff: 8, pressureState: 'ok', tempState: 'optimal' },
  pace: { projectedLapSec: 92.481, confidence: 0.88 }
}

function renderCatchAhead(stylePreset: OverlayStylePresetId = 'minimal'): string {
  return renderToStaticMarkup(createElement(CatchAheadWidget, { snapshot: null, config: { ...configs.predCatchAhead, stylePreset } }))
}

function renderFuel(stylePreset: OverlayStylePresetId = 'minimal'): string {
  return renderToStaticMarkup(createElement(FuelMarginWidget, { snapshot: null, config: { ...configs.predFuelMargin, stylePreset } }))
}

afterEach(() => applyPredictionsSnapshot(null))

describe('PredictionWidgets registration', () => {
  it('registers all prediction overlays', () => {
    expect(WIDGET_COMPONENTS.predCatchAhead).toBe(CatchAheadWidget)
    expect(WIDGET_COMPONENTS.predCaughtBehind).toBe(CaughtBehindWidget)
    expect(WIDGET_COMPONENTS.predFuelMargin).toBe(FuelMarginWidget)
    expect(WIDGET_COMPONENTS.predTireWear).toBe(TireWearPredWidget)
    expect(WIDGET_COMPONENTS.predPaceProjected).toBe(PaceProjectedWidget)
  })
})

describe('PredictionWidgets instruments', () => {
  it('routes prediction headline values through SVG DSEG SegmentReadout', () => {
    applyPredictionsSnapshot(predictionSnapshot)
    const markup = renderCatchAhead('minimal')
    expect(markup).toContain('<svg')
    expect(markup).toContain('DSEG7Classic')
    expect(markup).toContain('aria-label="Alcançar 24.4"')
  })

  it('uses DataTile status chrome for supplemental prediction text', () => {
    applyPredictionsSnapshot(predictionSnapshot)
    const markup = renderFuel('minimal')
    expect(markup).toContain('<svg')
    expect(markup).toContain('aria-label="Fuel até o fim +1.2"')
    expect(markup).toContain('aria-label="Status +3.4 L · 12.3v no tanque"')
  })

  it('renders null and extreme prediction inputs without unsafe numeric text', () => {
    for (const family of FAMILIES) {
      applyPredictionsSnapshot(null)
      const empty = renderCatchAhead(family)
      clean(empty)
      expect(empty).toContain('—')

      applyPredictionsSnapshot({
        catchAhead: { carIdx: 1, gapSec: Number.NaN, closingSecPerLap: Number.NaN, etaSec: Number.NaN, etaLaps: Number.NaN },
        caughtBehind: { carIdx: 2, gapSec: Number.POSITIVE_INFINITY, closingSecPerLap: Number.NaN, etaSec: Number.POSITIVE_INFINITY, etaLaps: Number.NaN },
        fuel: { lapsLeftAtPace: Number.NaN, finishMarginLaps: Number.POSITIVE_INFINITY, finishMarginL: Number.NaN },
        tire: { degSecPerLap: Number.NaN, lapsToCliff: Number.POSITIVE_INFINITY, pressureState: 'ok', tempState: 'optimal' },
        pace: { projectedLapSec: Number.NaN, confidence: Number.NaN }
      })
      clean(renderCatchAhead(family))
      clean(renderFuel(family))
    }
  })
})
