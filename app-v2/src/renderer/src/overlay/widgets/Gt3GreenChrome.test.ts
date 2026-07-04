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
import { resolveSkin } from '../../skins'
import { DASH } from './dashboard-tiles'
import { WIDGET_COMPONENTS } from './index'

// p1-green — GT3 colour rule. Warm tones (amber/orange/red) drive every chrome
// heat ramp; cool/green is reserved for a genuinely "good" STATE only. These
// overlays must therefore never emit the old decorative-green chrome hexes for
// speed / shift / G-load, and must stay NaN-free for any snapshot.

const defaults = createDefaultOverlaysConfig()

function presetForFamily(fam: string): OverlayStylePresetId {
  const match = OVERLAY_STYLE_PRESETS.find((p) => overlayDesignFamily(p.id) === fam)
  return (match?.id ?? 'minimal') as OverlayStylePresetId
}

function render(id: OverlayWidgetId, preset: OverlayStylePresetId, snapshot: TelemetrySnapshot | null): string {
  const Component = WIDGET_COMPONENTS[id] as (props: {
    snapshot: TelemetrySnapshot | null
    config: OverlayWidgetConfig
  }) => ReactElement
  const config: OverlayWidgetConfig = { ...defaults.widgets[id], stylePreset: preset }
  return renderToStaticMarkup(createElement(Component, { snapshot, config }))
}

function renderAllFamilies(id: OverlayWidgetId, snapshot: TelemetrySnapshot | null): string {
  return OVERLAY_DESIGN_FAMILIES.map((fam) => render(id, presetForFamily(fam), snapshot)).join('\n')
}

const GREEN_TARGETS: OverlayWidgetId[] = [
  'gearSpeed', 'compactHud', 'gforce', 'fuel', 'neonGearBar', 'apexRadar', 'deltaBar', 'lapReadout'
]

// `hot` lights every segment of the speed/shift/G/fuel ramps so the formerly-green
// LOW stop is actually emitted into the rendered markup; `mid` exercises the
// mid-band shift colour; `empty`/null exercise the missing-data path.
const hot = {
  sim: 'iracing', connected: true, timestamp: 1,
  speedKmh: 348, rpm: 8950, maxRpm: 9000, gear: 5, shiftIndicatorPct: 0.99,
  latAccelG: 0.2, longAccelG: 0.15,
  fuelLiters: 62, fuelCapacityLiters: 100, fuelPerLap: 2.6,
  position: 3, deltaToBestSec: -0.2, lastLapTimeSec: 91.234, bestLapTimeSec: 90.984,
  radarCars: [
    { carIdx: 2, relativeX: -2.0, relativeY: 1.2, classColor: '#49C5B1' },
    { carIdx: 3, relativeX: 8, relativeY: -12 }
  ]
} as unknown as TelemetrySnapshot

const mid = {
  ...hot, speedKmh: 150, shiftIndicatorPct: 0.88, latAccelG: 1.0, longAccelG: 0.8, fuelLiters: 30
} as unknown as TelemetrySnapshot

const empty = { sim: 'iracing', connected: false, timestamp: 0 } as unknown as TelemetrySnapshot

const SNAPSHOTS: Array<[string, TelemetrySnapshot | null]> = [
  ['hot', hot], ['mid', mid], ['empty', empty], ['null', null]
]

describe('p1-green — GT3 colour rule on overlay widgets', () => {
  it('targets render NaN/undefined/Infinity-free across all 8 families', () => {
    for (const id of GREEN_TARGETS) {
      for (const [label, snap] of SNAPSHOTS) {
        const markup = renderAllFamilies(id, snap)
        expect(markup.length, `${id}/${label} empty render`).toBeGreaterThan(10)
        expect(markup, `${id}/${label} NaN`).not.toContain('NaN')
        expect(markup, `${id}/${label} undefined`).not.toContain('undefined')
        expect(markup, `${id}/${label} Infinity`).not.toContain('Infinity')
      }
    }
  })

  it('GearSpeed speed-heat chrome never emits the decorative green #18d27b', () => {
    for (const [label, snap] of SNAPSHOTS) {
      expect(renderAllFamilies('gearSpeed', snap), `gearSpeed/${label}`).not.toContain('#18d27b')
    }
  })

  it('CompactHud speed/shift chrome never emits the decorative green #2ee06a', () => {
    for (const [label, snap] of SNAPSHOTS) {
      expect(renderAllFamilies('compactHud', snap), `compactHud/${label}`).not.toContain('#2ee06a')
    }
  })

  it('GForce magnitude heat never emits the decorative green #18d27b', () => {
    for (const [label, snap] of SNAPSHOTS) {
      expect(renderAllFamilies('gforce', snap), `gforce/${label}`).not.toContain('#18d27b')
    }
  })

  it('Fuel matrix drops the lime decorative #9ad11a (healthy-state green stays allowed)', () => {
    for (const [label, snap] of SNAPSHOTS) {
      expect(renderAllFamilies('fuel', snap), `fuel/${label}`).not.toContain('#9ad11a')
    }
  })

  it('ApexRadar paints a non-threat other car neutral blue, not decorative green', () => {
    const otherCar = {
      ...empty,
      radarCars: [{ carIdx: 9, relativeX: 9, relativeY: -18 }]
    } as unknown as TelemetrySnapshot
    // v2.39 ApexRadar uses the shared DASH token palette; a non-threat car is the
    // neutral cyan/blue token, never a decorative "good-state" green.
    expect(renderAllFamilies('apexRadar', otherCar)).toContain(DASH.cyan)
  })

  it('GearSpeed and CompactHud big readouts adopt their skin instrument digit face', () => {
    // Big readouts route through their skin's segmented digit face instead of the old
    // --rc-num CSS var. GearSpeed uses the SegmentReadout instrument (embedded DSEG
    // 7-seg face); CompactHud renders the HUD skin's own numeric face.
    expect(renderAllFamilies('gearSpeed', hot)).toContain('DSEG7Classic-Regular')
    expect(renderAllFamilies('compactHud', hot)).toContain(resolveSkin('hud', 'generic').segment.numeric)
  })
})
