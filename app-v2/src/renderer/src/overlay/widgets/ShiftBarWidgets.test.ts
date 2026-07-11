import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  OVERLAY_STYLE_PRESETS,
  createDefaultOverlaysConfig,
  overlayDesignFamily
} from '../../../../shared/overlays'
import type {
  OverlayDesignFamily,
  OverlayStylePresetId,
  OverlayWidgetConfig,
  OverlayWidgetId
} from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { SHIFT_STROBE_BLUE } from '../../lib/rev-lights'
import { WIDGET_COMPONENTS } from './index'

// v2.39: GT3ClusterWidget + RevLightsWidget render the shared, skin-driven RevLedBar
// instrument (a nested `<svg aria-label="rev lights">`) for their on-screen shift
// ladders instead of the old bespoke `.led-shift-bar` DOM. The redline "blink" is now
// surfaced by the ladder flashing the skin's blue redline colour across its lit LEDs,
// so we assert on that structure-appropriate signal instead of the old `is-blink` class.

const defaults = createDefaultOverlaysConfig()

// The shared LED ladder instrument (RevLedBar) renders a nested <svg aria-label="rev lights">.
const LADDER = 'aria-label="rev lights"'
const REDLINE = SHIFT_STROBE_BLUE
const count = (s: string, sub: string): number => s.split(sub).length - 1
// How many times the ladder paints the redline colour: a small baseline below the
// limiter, but many (every lit LED) once the redline flash engages.
const flashHits = (markup: string): number => count(markup, REDLINE)
const FLASH_MIN = 6

function presetForFamily(fam: OverlayDesignFamily): OverlayStylePresetId {
  const match = OVERLAY_STYLE_PRESETS.find((p) => overlayDesignFamily(p.id) === fam)
  return (match?.id ?? 'minimal') as OverlayStylePresetId
}

function render(id: OverlayWidgetId, fam: OverlayDesignFamily, snapshot: TelemetrySnapshot | null): string {
  const Component = WIDGET_COMPONENTS[id]
  const config: OverlayWidgetConfig = { ...defaults.widgets[id], stylePreset: presetForFamily(fam) }
  return renderToStaticMarkup(createElement(Component, { snapshot, config }))
}

// Families whose layout includes the shared LED ladder (analog is a needle gauge).
const CLUSTER_LADDER_FAMS: OverlayDesignFamily[] = ['minimal', 'neon', 'glass', 'broadcast', 'bauhaus']
const REV_LADDER_FAMS: OverlayDesignFamily[] = [
  'minimal', 'neon', 'glass', 'broadcast', 'terminal', 'bauhaus', 'heatmap'
]

const mid = { sim: 'iracing', connected: true, timestamp: 1, shiftIndicatorPct: 0.4 } as unknown as TelemetrySnapshot
const redline = {
  sim: 'iracing', connected: true, timestamp: 1,
  shiftIndicatorPct: 1, revLights: { pct: 1, blink: true }
} as unknown as TelemetrySnapshot
const empty = { sim: 'iracing', connected: false, timestamp: 0 } as unknown as TelemetrySnapshot

describe('GT3ClusterWidget + RevLightsWidget adopt the shared RevLedBar ladder', () => {
  it('renders the shared LED ladder in every GT3 cluster ladder family', () => {
    for (const fam of CLUSTER_LADDER_FAMS) {
      expect(render('gt3Cluster', fam, mid), `cluster ${fam}`).toContain(LADDER)
    }
  })

  it('renders the shared LED ladder in every RevLights ladder family', () => {
    for (const fam of REV_LADDER_FAMS) {
      expect(render('revlights', fam, mid), `revlights ${fam}`).toContain(LADDER)
    }
  })

  it('flashes the redline across the ladder on both widgets at the limiter', () => {
    const clusterRedline = render('gt3Cluster', 'bauhaus', redline)
    const clusterBelow = render('gt3Cluster', 'bauhaus', mid)
    expect(clusterRedline).toContain(LADDER)
    expect(flashHits(clusterRedline), 'cluster flash lights the ladder').toBeGreaterThanOrEqual(FLASH_MIN)
    expect(flashHits(clusterRedline)).toBeGreaterThan(flashHits(clusterBelow))

    const revRedline = render('revlights', 'neon', redline)
    const revBelow = render('revlights', 'neon', mid)
    expect(revRedline).toContain(LADDER)
    expect(flashHits(revRedline), 'revlights flash lights the ladder').toBeGreaterThanOrEqual(FLASH_MIN)
    expect(flashHits(revRedline)).toBeGreaterThan(flashHits(revBelow))
    expect(revRedline).toContain('repeatCount="indefinite"')
  })

  it('does not flash below the redline', () => {
    expect(flashHits(render('gt3Cluster', 'bauhaus', mid)), 'cluster').toBeLessThan(FLASH_MIN)
    const rev = render('revlights', 'neon', mid)
    expect(flashHits(rev), 'revlights').toBeLessThan(FLASH_MIN)
    expect(rev).not.toContain('repeatCount="indefinite"')
  })

  it('renders the ladder (no NaN/undefined/Infinity) when telemetry is missing', () => {
    for (const id of ['gt3Cluster', 'revlights'] as OverlayWidgetId[]) {
      for (const snap of [null, empty]) {
        let out = ''
        expect(() => { out = render(id, 'minimal', snap) }, `${id} render`).not.toThrow()
        expect(out, `${id} ladder`).toContain(LADDER)
        expect(flashHits(out), `${id} not flashing`).toBeLessThan(FLASH_MIN)
        expect(out, `${id} NaN`).not.toContain('NaN')
        expect(out, `${id} undefined`).not.toContain('undefined')
        expect(out, `${id} Infinity`).not.toContain('Infinity')
      }
    }
  })

  it('keeps the rev overlay transparent, title-less, and independently sized', () => {
    const config: OverlayWidgetConfig = {
      ...defaults.widgets.revlights,
      position: { x: 0, y: 0, width: 1000, height: 36 }
    }
    const out = renderToStaticMarkup(createElement(WIDGET_COMPONENTS.revlights, { snapshot: mid, config }))
    expect(out).toContain('viewBox="0 0 1000 36"')
    expect(out).toContain('preserveAspectRatio="none"')
    expect(out).not.toContain('<text')
    expect(out).not.toContain('>REV<')
    expect(out).not.toContain('RPM')
  })
})
