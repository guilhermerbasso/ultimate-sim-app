import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayStylePresetId } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { RelativesStripWidget, RELATIVES_STRIP_STREAM_SAFE } from './RelativesStripWidget'
import { WIDGET_COMPONENTS } from './index'

const baseConfig = createDefaultOverlaysConfig().widgets.relativesStrip
const FAMILIES: OverlayStylePresetId[] = ['minimal', 'neon', 'glass', 'broadcast', 'terminal', 'bauhaus', 'analog', 'heatmap']

function render(snapshot: TelemetrySnapshot | null, stylePreset: OverlayStylePresetId = 'minimal'): string {
  return renderToStaticMarkup(createElement(RelativesStripWidget, { snapshot, config: { ...baseConfig, stylePreset } }))
}

function clean(markup: string): void {
  expect(markup).not.toContain('NaN')
  expect(markup).not.toContain('undefined')
  expect(markup).not.toContain('Infinity')
}

const stripSnapshot = {
  playerCarIdx: 7,
  drivers: [
    { carIdx: 6, name: 'Max Verstappen', carNumber: '33', position: 1, classPosition: 1, classId: 1, classColor: '#ff6a00', lapDistPct: 0.4, isPlayer: false },
    { carIdx: 7, name: 'Guilherme Basso', carNumber: '77', position: 2, classPosition: 2, classId: 1, classColor: '#49C5B1', lapDistPct: 0.5, isPlayer: true }
  ]
} as unknown as TelemetrySnapshot

const badSnapshot = {
  drivers: [
    { carIdx: 1, name: 'Bad', carNumber: '9', position: 1, classPosition: 1, classId: 1, lapDistPct: Number.NaN, isPlayer: false }
  ]
} as unknown as TelemetrySnapshot

describe('RelativesStripWidget registration', () => {
  it('is wired into the overlay widget component map and remains non stream-safe', () => {
    expect(WIDGET_COMPONENTS.relativesStrip).toBe(RelativesStripWidget)
    expect(RELATIVES_STRIP_STREAM_SAFE).toBe(false)
  })
})

describe('RelativesStripWidget instruments', () => {
  it('routes car-number bubbles through SVG DSEG SegmentReadout', () => {
    const markup = render(stripSnapshot, 'minimal')
    expect(markup).toContain('<svg')
    expect(markup).toContain('DSEG7')
    expect(markup).toContain('>33<')
    expect(markup).toContain('>77<')
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
