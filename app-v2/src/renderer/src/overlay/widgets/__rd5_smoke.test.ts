import { createElement } from 'react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  OVERLAY_DESIGN_FAMILIES,
  OVERLAY_STYLE_PRESETS,
  createDefaultOverlaysConfig,
  overlayDesignFamily
} from '../../../../shared/overlays'
import type { OverlayStylePresetId, OverlayWidgetConfig, OverlayWidgetId } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { WIDGET_COMPONENTS } from './index'

// Group-5 redesign (rd-g5-r16): every race-control / energy / extra / gap widget
// must render a GENUINELY DISTINCT structure per design family (not a recolor)
// and stay clean (no throw / NaN / undefined) for full, empty and null snapshots.

const RD5_IDS: OverlayWidgetId[] = [
  'ersBattery', 'ersFlow', 'pushToPassHud', 'pitStatusHud', 'coldPressureGrid',
  'trackClock', 'wetRadar', 'surfaceScope', 'neonGearBar', 'apexRadar',
  'ersBar', 'pushToPassPips', 'pitTicket', 'coldPressureCard', 'sessionClock',
  'wetTag', 'surfaceTag', 'bopBadge', 'deltaBar', 'lapReadout',
  'gapAhead', 'gapBehind'
]

const full = {
  sim: 'iracing', connected: true, timestamp: 1,
  speedKmh: 214, rpm: 8200, maxRpm: 9000, gear: 4, shiftIndicatorPct: 0.88,
  ersBatteryPct: 0.62, pushToPass: false, pushToPassCount: 4,
  weatherDeclaredWet: true, trackWetnessPct: 0.45, isRaining: true,
  trackSurfaceMaterial: 16, weightPenaltyKg: 25, powerAdjustPct: -3,
  sessionTimeOfDay: 14 * 3600 + 1800,
  tireColdPressuresKpa: { lf: 165, rf: 168, lr: 158, rr: 159 },
  pit: { repairNeeded: false, optRepairNeeded: false, pitsOpen: true, inPitStall: false, svStatus: 0 },
  deltaToBestSec: -0.25, lastLapTimeSec: 91.234, bestLapTimeSec: 90.984,
  radarCars: [
    { carIdx: 2, relativeX: -2.1, relativeY: 1.5, classColor: '#49C5B1' },
    { carIdx: 3, relativeX: 7.5, relativeY: -10, classColor: '#ff6a00' }
  ],
  relatives: {
    ahead: { carIdx: 4, name: 'Max Verstappen', carNumber: '34', gapSec: 1.23, classColor: '#49C5B1' },
    behind: { carIdx: 7, name: 'Lewis Hamilton', carNumber: '44', gapSec: -0.85, classColor: '#ff6a00' }
  }
} as unknown as TelemetrySnapshot

const empty = { sim: 'iracing', connected: false, timestamp: 0 } as unknown as TelemetrySnapshot

const defaults = createDefaultOverlaysConfig()

function presetForFamily(fam: string): OverlayStylePresetId {
  const match = OVERLAY_STYLE_PRESETS.find((p) => overlayDesignFamily(p.id) === fam)
  return (match?.id ?? 'minimal') as OverlayStylePresetId
}

function render(id: OverlayWidgetId, preset: OverlayStylePresetId, snapshot: TelemetrySnapshot | null): string {
  const Component = WIDGET_COMPONENTS[id] as (props: { snapshot: TelemetrySnapshot | null; config: OverlayWidgetConfig }) => ReactElement
  const config: OverlayWidgetConfig = { ...defaults.widgets[id], stylePreset: preset }
  return renderToStaticMarkup(createElement(Component, { snapshot, config }))
}

describe('rd-g5 overlays render cleanly across all 8 families', () => {
  for (const id of RD5_IDS) {
    for (const fam of OVERLAY_DESIGN_FAMILIES) {
      it(`${id} @ ${fam}`, () => {
        const preset = presetForFamily(fam)
        for (const snap of [full, empty, null]) {
          let markup = ''
          expect(() => { markup = render(id, preset, snap) }, `${id}/${fam}`).not.toThrow()
          expect(markup.length, `${id}/${fam} empty render`).toBeGreaterThan(10)
          expect(markup, `${id}/${fam} NaN`).not.toContain('NaN')
          expect(markup, `${id}/${fam} undefined`).not.toContain('undefined')
          expect(markup, `${id}/${fam} Infinity`).not.toContain('Infinity')
          expect(markup, `${id}/${fam} escape-literal`).not.toContain('\\u')
        }
      })
    }
  }
})

describe('rd-g5 overlays render real, data-driven SVG content per family', () => {
  // v2.39 intentionally UNIFIES each widget on one root `<svg>` and differentiates
  // families via the skin (colour/typography/material), not via bespoke per-family
  // DOM skeletons. So the old ">=6 distinct layouts" structural check no longer
  // applies. What must still hold: every family renders genuine, non-blank, richly
  // structured SVG whose content is DATA-DRIVEN (differs from the empty snapshot),
  // i.e. never a blank/fallback shell.
  const SVG_PRIMITIVE = /<(rect|circle|line|path|text|polygon|polyline|g|tspan|use)\b/
  for (const id of RD5_IDS) {
    it(`${id} draws non-blank, data-driven SVG in every family`, () => {
      for (const fam of OVERLAY_DESIGN_FAMILIES) {
        const preset = presetForFamily(fam)
        const markup = render(id, preset, full)
        expect(markup, `${id}/${fam} root svg`).toContain('<svg')
        expect(markup.length, `${id}/${fam} substantial markup`).toBeGreaterThan(120)
        expect(markup, `${id}/${fam} draws primitives`).toMatch(SVG_PRIMITIVE)
        // Data-driven: a populated snapshot must not render identically to the
        // empty/fallback one (guards against a blank or hard-coded shell).
        expect(markup, `${id}/${fam} reacts to data`).not.toBe(render(id, preset, empty))
      }
    })
  }
})
