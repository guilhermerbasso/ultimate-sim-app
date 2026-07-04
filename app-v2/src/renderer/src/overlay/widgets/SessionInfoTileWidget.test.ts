import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { resolveSkin } from '../../skins'
import { SessionInfoTileWidget } from './SessionInfoTileWidget'

const skin = resolveSkin('gt3', 'generic')
const GREEN = skin.palette.ok
const RED = skin.palette.crit
const base = createDefaultOverlaysConfig().widgets.gt3Cluster
const FAMILIES = ['minimal', 'glass', 'broadcast', 'terminal', 'bauhaus', 'analog', 'heatmap', 'neon']

function cfg(stylePreset: string): OverlayWidgetConfig {
  return { ...base, stylePreset } as OverlayWidgetConfig
}

function render(snapshot: TelemetrySnapshot | null, stylePreset = 'minimal'): string {
  return renderToStaticMarkup(createElement(SessionInfoTileWidget, { snapshot, config: cfg(stylePreset) }))
}

function assertClean(markup: string, ctx: string): void {
  expect(markup.length, `empty render: ${ctx}`).toBeGreaterThan(100)
  expect(markup, `NaN in ${ctx}`).not.toContain('NaN')
  expect(markup, `undefined in ${ctx}`).not.toContain('undefined')
  expect(markup, `Infinity in ${ctx}`).not.toContain('Infinity')
}

const KEY_LABELS = ['TIME LEFT', 'POS', 'INC']

const race = {
  sim: 'iracing',
  connected: true,
  timestamp: 1,
  sessionType: 'Race',
  sessionState: 4,
  sessionTimeRemainingSec: 5400,
  lapsRemaining: 18,
  position: 3,
  totalCars: 24,
  incidentCount: 4,
  incidentLimit: 17,
  strengthOfField: 2875
} as unknown as TelemetrySnapshot

const incidentsAtLimit = {
  ...race,
  incidentCount: 16,
  incidentLimit: 17
} as unknown as TelemetrySnapshot

const lapFallback = {
  sim: 'iracing',
  connected: true,
  timestamp: 3,
  sessionType: 'Qualify',
  sessionTimeRemainingSec: 600,
  currentLap: 5,
  position: 1,
  totalCars: 20,
  incidentCount: 0,
  incidentLimit: 17
} as unknown as TelemetrySnapshot

const extreme = {
  sim: 'iracing',
  connected: true,
  timestamp: 4,
  sessionType: '',
  sessionTimeRemainingSec: Number.POSITIVE_INFINITY,
  currentLap: Number.NaN,
  position: Number.NEGATIVE_INFINITY,
  totalCars: Number.NaN,
  incidentCount: Number.POSITIVE_INFINITY,
  incidentLimit: Number.NaN,
  strengthOfField: Number.POSITIVE_INFINITY
} as unknown as TelemetrySnapshot

const CASES: Array<[string, TelemetrySnapshot | null]> = [
  ['null', null],
  ['race', race],
  ['incidents-at-limit', incidentsAtLimit],
  ['lap-fallback', lapFallback],
  ['extreme', extreme]
]

describe('SessionInfoTileWidget', () => {
  it('renders every snapshot NaN / undefined / Infinity-free', () => {
    for (const [label, snap] of CASES) {
      let out = ''
      expect(() => { out = render(snap) }, `${label} render`).not.toThrow()
      assertClean(out, label)
    }
  })

  it('degrades a null snapshot to em-dashes with every key label and instrument SVG', () => {
    const out = render(null)
    for (const label of KEY_LABELS) {
      expect(out, `missing ${label}`).toContain(label)
    }
    expect(out).toContain('—')
    expect(out).toContain('<svg')
  })

  it('shows the race session, clock, laps-left, order, SoF and a clean incident sheet (green)', () => {
    const out = render(race)
    expect(out).toContain('RACE')
    expect(out).toContain('1:30:00')
    expect(out).toContain('LAPS LEFT')
    expect(out).toContain('18')
    expect(out).toContain('POS')
    expect(out).toContain('/ 24')
    expect(out).toContain('INC')
    expect(out).toContain('SOF')
    expect(out, 'low incidents → green').toContain(GREEN)
  })

  it('paints incidents red as they approach the session limit', () => {
    const out = render(incidentsAtLimit)
    expect(out).toContain('16')
    expect(out, 'near the limit → red').toContain(RED)
  })

  it('falls back to the current-lap counter when laps-remaining is absent', () => {
    const out = render(lapFallback)
    expect(out).toContain('QUALIFY')
    expect(out).toContain('10:00')
    expect(out).toContain('LAP')
    expect(out).toContain('POS')
  })

  it('uses instrument DSEG readouts and renders across style families', () => {
    for (const family of FAMILIES) {
      const out = render(race, family)
      assertClean(out, family)
      expect(out).toContain('DSEG7')
      expect(out).toContain('<svg')
    }
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
