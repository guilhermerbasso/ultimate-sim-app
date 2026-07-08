import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayStylePresetId } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { RelativeWidget } from './RelativeWidget'
import { WIDGET_COMPONENTS } from './index'

const baseConfig = createDefaultOverlaysConfig().widgets.relative
const FAMILIES: OverlayStylePresetId[] = ['minimal', 'neon', 'glass', 'broadcast', 'terminal', 'bauhaus', 'analog', 'heatmap']

function render(snapshot: TelemetrySnapshot | null, stylePreset: OverlayStylePresetId = 'minimal'): string {
  return renderToStaticMarkup(createElement(RelativeWidget, { snapshot, config: { ...baseConfig, stylePreset } }))
}

function clean(markup: string): void {
  expect(markup).not.toContain('NaN')
  expect(markup).not.toContain('undefined')
  expect(markup).not.toContain('Infinity')
}

const relativeSnapshot = {
  playerCarIdx: 7,
  drivers: [
    { carIdx: 6, name: 'Max Verstappen', carNumber: '33', position: 1, classPosition: 1, classId: 1, gapToPlayerSec: 1.2, isPlayer: false },
    { carIdx: 7, name: 'Guilherme Basso', carNumber: '77', position: 2, classPosition: 2, classId: 1, gapToPlayerSec: 0, isPlayer: true },
    { carIdx: 8, name: 'Lewis Hamilton', carNumber: '44', position: 3, classPosition: 3, classId: 1, gapToPlayerSec: -0.85, isPlayer: false }
  ]
} as unknown as TelemetrySnapshot

const badSnapshot = {
  drivers: [
    { carIdx: 1, name: '', carNumber: '1', position: 1, classPosition: 1, classId: 1, gapToPlayerSec: Number.POSITIVE_INFINITY, isPlayer: false }
  ]
} as unknown as TelemetrySnapshot

describe('RelativeWidget registration', () => {
  it('is wired into the overlay widget component map', () => {
    expect(WIDGET_COMPONENTS.relative).toBe(RelativeWidget)
  })
})

describe('RelativeWidget instruments', () => {
  it('routes relative positions and gaps through fitted SVG text with DSEG numerals', () => {
    const markup = render(relativeSnapshot, 'minimal')
    expect(markup).toContain('<svg')
    expect(markup).toContain('DSEG7')
    expect(markup).toContain('VERSTAPPEN')
    expect(markup).toContain('+1.200')
    expect(markup).toContain('YOU')
  })

  it('renders empty/null/extreme inputs as clean dash states for every family', () => {
    for (const family of FAMILIES) {
      clean(render(null, family))
      clean(render({ drivers: [] } as unknown as TelemetrySnapshot, family))
      clean(render(badSnapshot, family))
      expect(render(null, family)).toContain('—')
    }
  })
})
