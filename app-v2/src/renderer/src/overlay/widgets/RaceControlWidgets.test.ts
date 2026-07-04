import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import {
  BopBadgeWidget,
  ColdPressureCardWidget,
  ColdPressureGridWidget,
  PitStatusHudWidget,
  PitTicketWidget,
  SessionClockWidget,
  SurfaceScopeWidget,
  SurfaceTagWidget,
  TrackClockWidget,
  WetRadarWidget,
  WetTagWidget
} from './RaceControlWidgets'

const widgets = createDefaultOverlaysConfig().widgets

function render(component: ComponentType<{ snapshot: TelemetrySnapshot | null; config: OverlayWidgetConfig }>, key: keyof typeof widgets, snapshot: TelemetrySnapshot | null, stylePreset = 'minimal'): string {
  const config = { ...widgets[key], stylePreset } as OverlayWidgetConfig
  return renderToStaticMarkup(createElement(component, { snapshot, config }))
}

function assertClean(markup: string, ctx: string): void {
  expect(markup.length, `empty render: ${ctx}`).toBeGreaterThan(40)
  expect(markup, `NaN in ${ctx}`).not.toContain('NaN')
  expect(markup, `undefined in ${ctx}`).not.toContain('undefined')
  expect(markup, `Infinity in ${ctx}`).not.toContain('Infinity')
}

const snapshot = {
  sim: 'iracing',
  connected: true,
  timestamp: 1,
  pit: {
    pitsOpen: true,
    repairNeeded: true,
    optRepairNeeded: true,
    inPitStall: true,
    svStatus: 2
  },
  trackWetnessPct: 0.42,
  weatherDeclaredWet: true,
  trackSurfaceMaterial: 'asphalt',
  sessionTimeOfDay: 13 * 3600,
  weightPenaltyKg: 15,
  powerAdjustPct: -2.5,
  tireColdPressuresKpa: { lf: 164, rf: 165, lr: 162, rr: 166 }
} as unknown as TelemetrySnapshot

describe('RaceControlWidgets instrument routing', () => {
  it('routes pit marshal lamps through AlarmStrip/Telltale SVGs', () => {
    const out = render(PitStatusHudWidget, 'pitStatusHud', snapshot, 'minimal')
    assertClean(out, 'pitStatusHud')
    expect(out).toContain('aria-label="alarms"')
    expect(out).toContain('<svg')
    expect(out).toContain('PITS')
    expect(out).toContain('FIX')
  })

  it('frames wetness percent and BoP values with DSEG/material instrument readouts', () => {
    const wet = render(WetRadarWidget, 'wetRadar', snapshot, 'bauhaus')
    const bop = render(BopBadgeWidget, 'bopBadge', snapshot, 'minimal')
    assertClean(wet, 'wetRadar')
    assertClean(bop, 'bopBadge')
    expect(wet).toContain('DSEG7Classic')
    expect(bop).toContain('aria-label="LASTRO +15"')
    expect(bop).toContain('aria-label="POT -2.5"')
  })

  it('renders null snapshots with dashes and without unsafe values', () => {
    const cases = [
      render(PitStatusHudWidget, 'pitStatusHud', null),
      render(WetRadarWidget, 'wetRadar', null),
      render(BopBadgeWidget, 'bopBadge', null),
      render(ColdPressureCardWidget, 'coldPressureCard', null)
    ]
    for (const [i, out] of cases.entries()) {
      assertClean(out, `null-${i}`)
    }
    expect(cases.join('')).toContain('—')
  })

  it('keeps every exported race-control widget renderable', () => {
    const cases: Array<[ComponentType<{ snapshot: TelemetrySnapshot | null; config: OverlayWidgetConfig }>, keyof typeof widgets]> = [
      [PitStatusHudWidget, 'pitStatusHud'],
      [PitTicketWidget, 'pitTicket'],
      [WetRadarWidget, 'wetRadar'],
      [WetTagWidget, 'wetTag'],
      [SurfaceScopeWidget, 'surfaceScope'],
      [SurfaceTagWidget, 'surfaceTag'],
      [TrackClockWidget, 'trackClock'],
      [SessionClockWidget, 'sessionClock'],
      [BopBadgeWidget, 'bopBadge'],
      [ColdPressureGridWidget, 'coldPressureGrid'],
      [ColdPressureCardWidget, 'coldPressureCard']
    ]
    for (const [component, key] of cases) {
      assertClean(render(component, key, snapshot), String(key))
    }
  })
})
