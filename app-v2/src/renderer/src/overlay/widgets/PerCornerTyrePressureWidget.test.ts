import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { resolveSkin } from '../../skins'
import { PerCornerTyrePressureWidget } from './PerCornerTyrePressureWidget'

const skin = resolveSkin('gt3', 'generic')

// PerCornerTyrePressureWidget — a focused GT3 2×2 tyre-pressure readout. Rendered to
// static markup (no JSX, per the suite convention) across null, a populated in-band
// snapshot, an over-inflated extreme and an iRacing cold-pressure fallback. Asserts the
// kit guards hold (every corner degrades to "—", the face never leaks NaN / undefined /
// Infinity) and that the target-band colour rule + source tag behave.

const config: OverlayWidgetConfig = createDefaultOverlaysConfig().widgets.gt3Cluster

function render(snapshot: TelemetrySnapshot | null): string {
  return renderToStaticMarkup(createElement(PerCornerTyrePressureWidget, { snapshot, config }))
}

function assertClean(markup: string, ctx: string): void {
  expect(markup.length, `empty render: ${ctx}`).toBeGreaterThan(100)
  expect(markup, `NaN in ${ctx}`).not.toContain('NaN')
  expect(markup, `undefined in ${ctx}`).not.toContain('undefined')
  expect(markup, `Infinity in ${ctx}`).not.toContain('Infinity')
}

const populated = {
  sim: 'iracing',
  connected: true,
  timestamp: 1,
  tyres: {
    lf: { pressureKpa: 170 },
    rf: { pressureKpa: 172 },
    lr: { pressureKpa: 168 },
    rr: { pressureKpa: 171 }
  }
} as unknown as TelemetrySnapshot

const overInflated = {
  sim: 'iracing',
  connected: true,
  timestamp: 2,
  tyres: {
    lf: { pressureKpa: 210 },
    rf: { pressureKpa: 214 },
    lr: { pressureKpa: 208 },
    rr: { pressureKpa: 212 }
  }
} as unknown as TelemetrySnapshot

const coldFallback = {
  sim: 'iracing',
  connected: true,
  timestamp: 3,
  tireColdPressuresKpa: { lf: 165, rf: 166, lr: 162, rr: 163 }
} as unknown as TelemetrySnapshot

const CASES: Array<[string, TelemetrySnapshot | null]> = [
  ['null', null],
  ['populated', populated],
  ['over-inflated', overInflated],
  ['cold-fallback', coldFallback]
]

describe('PerCornerTyrePressureWidget', () => {
  it('renders every snapshot NaN / undefined / Infinity-free', () => {
    for (const [label, snap] of CASES) {
      let out = ''
      expect(() => { out = render(snap) }, `${label} render`).not.toThrow()
      assertClean(out, label)
    }
  })

  it('degrades a null snapshot to em-dashes with the tyre glyph', () => {
    const out = render(null)
    expect(out).toContain('TYRE PRESSURE')
    expect(out).toContain('PRESS')
    expect(out).toContain('kPa')
    expect(out).toContain('Target 160')
    expect(out).toContain('—')
    expect(out).toContain('<svg')
  })

  it('shows live in-band pressures with a green good-state hue and a LIVE tag', () => {
    const out = render(populated)
    expect(out).toContain('170')
    expect(out).toContain('168')
    expect(out).toContain('LIVE')
    expect(out, 'in-band → green').toContain(skin.palette.ok)
  })

  it('routes per-corner cells through a DSEG numeric face', () => {
    const out = render(populated)
    expect(out, 'DSEG7 numerals').toContain(skin.segment.numeric)
    expect(out, 'corner label LF').toContain('LF')
    expect(out, 'PRESS header').toContain('PRESS')
    expect(out, 'kPa unit').toContain('kPa')
  })

  it('paints over-inflated corners red', () => {
    const out = render(overInflated)
    expect(out).toContain('210')
    expect(out, 'out-of-band → red').toContain(skin.palette.crit)
  })

  it('falls back to iRacing cold pressures and tags the source COLD (amber)', () => {
    const out = render(coldFallback)
    expect(out).toContain('165')
    expect(out).toContain('COLD')
    expect(out, 'cold tag amber').toContain(skin.palette.warn)
  })

  it('stays brand-neutral (no MoTeC / Cosworth / AiM / Bosch wordmarks)', () => {
    for (const [, snap] of CASES) {
      const out = render(snap)
      for (const mark of ['MoTeC', 'MOTEC', 'Cosworth', 'AiM', 'Bosch']) {
        expect(out, `brand mark ${mark}`).not.toContain(mark)
      }
    }
  })
})
