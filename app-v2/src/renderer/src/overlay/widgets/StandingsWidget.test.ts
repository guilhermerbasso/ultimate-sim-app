import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayStylePresetId } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { StandingsWidget } from './StandingsWidget'
import { WIDGET_COMPONENTS } from './index'

const baseConfig = createDefaultOverlaysConfig().widgets.standings
const FAMILIES: OverlayStylePresetId[] = ['minimal', 'neon', 'glass', 'broadcast', 'terminal', 'bauhaus', 'analog', 'heatmap']

function render(snapshot: TelemetrySnapshot | null, stylePreset: OverlayStylePresetId = 'minimal'): string {
  return renderToStaticMarkup(createElement(StandingsWidget, { snapshot, config: { ...baseConfig, stylePreset } }))
}

function clean(markup: string): void {
  expect(markup).not.toContain('NaN')
  expect(markup).not.toContain('undefined')
  expect(markup).not.toContain('Infinity')
}

const standingsSnapshot = {
  sessionType: 'Race',
  totalCars: 2,
  strengthOfField: 2500,
  drivers: [
    { carIdx: 1, name: 'Guilherme Basso', carNumber: '77', position: 1, classPosition: 1, classId: 1, classColor: '#49C5B1', gapToPlayerSec: 0, isPlayer: true },
    { carIdx: 2, name: 'Max Verstappen', carNumber: '33', position: 2, classPosition: 2, classId: 1, classColor: '#ff6a00', gapToPlayerSec: 1.234, isPlayer: false }
  ]
} as unknown as TelemetrySnapshot

const badSnapshot = {
  drivers: [
    { carIdx: 3, name: 'Bad Data', carNumber: '9', position: 1, classPosition: 1, classId: 1, gapToPlayerSec: Number.NaN, isPlayer: false }
  ]
} as unknown as TelemetrySnapshot

describe('StandingsWidget registration', () => {
  it('is wired into the overlay widget component map', () => {
    expect(WIDGET_COMPONENTS.standings).toBe(StandingsWidget)
  })
})

describe('StandingsWidget instruments', () => {
  it('routes positions and gaps through fitted SVG text with DSEG numerals', () => {
    const markup = render(standingsSnapshot, 'minimal')
    expect(markup).toContain('<svg')
    expect(markup).toContain('DSEG7')
    expect(markup).toContain('Guilherme Basso')
    expect(markup).toContain('Max Verstappen')
    expect(markup).toContain('+1.234')
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
