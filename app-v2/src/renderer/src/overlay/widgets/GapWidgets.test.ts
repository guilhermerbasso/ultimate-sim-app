import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayStylePresetId } from '../../../../shared/overlays'
import type { RelativeCars, TelemetrySnapshot } from '../../../../shared/telemetry'
import { GapAheadWidget, GapBehindWidget } from './GapWidgets'
import { WIDGET_COMPONENTS } from './index'

function snapshotWith(relatives: RelativeCars | undefined): TelemetrySnapshot {
  return { relatives } as unknown as TelemetrySnapshot
}

const aheadConfig = createDefaultOverlaysConfig().widgets.gapAhead
const behindConfig = createDefaultOverlaysConfig().widgets.gapBehind
const FAMILIES: OverlayStylePresetId[] = ['minimal', 'neon', 'glass', 'broadcast', 'terminal', 'bauhaus', 'analog', 'heatmap']

function renderAhead(snapshot: TelemetrySnapshot | null, stylePreset: OverlayStylePresetId = 'minimal'): string {
  return renderToStaticMarkup(createElement(GapAheadWidget, { snapshot, config: { ...aheadConfig, stylePreset } }))
}

function renderBehind(snapshot: TelemetrySnapshot | null, stylePreset: OverlayStylePresetId = 'minimal'): string {
  return renderToStaticMarkup(createElement(GapBehindWidget, { snapshot, config: { ...behindConfig, stylePreset } }))
}

function assertClean(markup: string, ctx: string): void {
  expect(markup.length, `empty render: ${ctx}`).toBeGreaterThan(10)
  expect(markup, `NaN in ${ctx}`).not.toContain('NaN')
  expect(markup, `Infinity in ${ctx}`).not.toContain('Infinity')
  expect(markup, `undefined in ${ctx}`).not.toContain('undefined')
}

describe('gap overlays registration', () => {
  it('registers gapAhead and gapBehind in the widget component map', () => {
    expect(typeof WIDGET_COMPONENTS.gapAhead).toBe('function')
    expect(typeof WIDGET_COMPONENTS.gapBehind).toBe('function')
  })

  it('default overlays config carries both gap overlays disabled by default', () => {
    const config = createDefaultOverlaysConfig()
    expect(config.widgets.gapAhead?.id).toBe('gapAhead')
    expect(config.widgets.gapBehind?.id).toBe('gapBehind')
    expect(config.widgets.gapAhead?.enabled).toBe(false)
    expect(config.widgets.gapBehind?.enabled).toBe(false)
  })
})

describe('GapAheadWidget rendering', () => {
  it('shows the absolute gap + rival when a car is ahead', () => {
    const snap = snapshotWith({
      ahead: { carIdx: 4, name: 'Max Verstappen', carNumber: '34', gapSec: 1.234, classColor: '#49C5B1' }
    })
    const out = renderAhead(snap)
    assertClean(out, 'ahead with rival')
    expect(out).toContain('AHEAD')
    expect(out).toContain('1.23')
    expect(out).toContain('#34')
    expect(out).toContain('VERSTAPPEN')
    expect(out).toContain('<svg')
    expect(out).toContain('DSEG7')
  })

  it('renders gracefully with no car ahead (no rival)', () => {
    assertClean(renderAhead(snapshotWith({})), 'ahead no rival')
    assertClean(renderAhead(snapshotWith(undefined)), 'ahead undefined relatives')
    assertClean(renderAhead(null), 'ahead null snapshot')
    expect(renderAhead(snapshotWith({}))).toContain('—')
  })

  it('renders the empty state when the rival has no gap value', () => {
    const snap = snapshotWith({ ahead: { carIdx: 4, name: 'A. Senna', carNumber: '12' } })
    const out = renderAhead(snap)
    assertClean(out, 'ahead missing gap')
    expect(out).toContain('—')
  })
})

describe('GapBehindWidget rendering', () => {
  it('shows the absolute gap for a negative (behind) gapSec', () => {
    const snap = snapshotWith({
      behind: { carIdx: 7, name: 'Lewis Hamilton', carNumber: '44', gapSec: -0.85, classColor: '#ff6a00' }
    })
    const out = renderBehind(snap)
    assertClean(out, 'behind with rival')
    expect(out).toContain('BEHIND')
    expect(out).toContain('0.85')
    expect(out).toContain('#44')
    expect(out).toContain('HAMILTON')
  })

  it('renders gracefully with no car behind and with non-finite gap data', () => {
    assertClean(renderBehind(snapshotWith({})), 'behind no rival')
    assertClean(renderBehind(null), 'behind null snapshot')
    const nan = snapshotWith({ behind: { carIdx: 7, name: 'X', carNumber: '7', gapSec: Number.NaN } })
    assertClean(renderBehind(nan), 'behind NaN gap')
    expect(renderBehind(nan)).toContain('—')
  })

  it('keeps instrument markup and clean placeholders across all design families', () => {
    const snap = snapshotWith({ behind: { carIdx: 7, name: 'Lewis Hamilton', carNumber: '44', gapSec: -0.85, classColor: '#ff6a00' } })
    for (const family of FAMILIES) {
      const markup = renderBehind(snap, family)
      assertClean(markup, `behind ${family}`)
      expect(markup).toContain('<svg')
      expect(markup).toContain('DSEG7')
    }
  })

  it('clamps very large gaps to a compact label', () => {
    const snap = snapshotWith({ behind: { carIdx: 9, name: 'Lapped Car', carNumber: '99', gapSec: -250 } })
    const out = renderBehind(snap)
    assertClean(out, 'behind large gap')
    expect(out).toContain('99+')
  })
})
