import { describe, expect, it } from 'vitest'
import { BUILTIN_PRESETS, OVERLAY_DASHBOARD_PRESETS } from './dashboards'
import { OVERLAY_WIDGETS } from './overlays'
import type { OverlayWidgetId } from './overlays'

// The full-frame dashboards that were moved OUT of the floating-overlay
// picker (OVERLAY_WIDGETS) and INTO the DASHBOARDS system (BUILTIN_PRESETS) as
// single-`overlaywidget`-element presets. This table is the contract: preset id →
// embedded widget id, the PT display name, the family/tag set.
const EMBEDDED: Array<{
  id: string
  widgetId: OverlayWidgetId
  name: string
  family: 'gt3' | 'lmu' | 'endurance' | 'engineer' | 'broadcast' | 'minimal' | 'racecon'
}> = [
  { id: 'grid_stack_dash', widgetId: 'gridStackDash', name: 'GT3 — Grid (SimHub)', family: 'gt3' },
  { id: 'grid_pro_dash', widgetId: 'gridProDash', name: 'GT3 — Pro (neon)', family: 'gt3' },
  { id: 'bosch_296_dash', widgetId: 'bosch296Dash', name: 'GT3 — Bosch 296', family: 'gt3' },
  { id: 'ring_dash', widgetId: 'ringDash', name: 'GT3 — Anel circular', family: 'gt3' },
  { id: 'lmu_endurance_dash', widgetId: 'lmuEnduranceDash', name: 'LMU — Endurance', family: 'lmu' },
  { id: 'lmu_stint_dash', widgetId: 'lmuStintDash', name: 'LMU — Stint/Fuel', family: 'lmu' },
  { id: 'racecon_rc01_dash', widgetId: 'raceconRc01Dash', name: 'RaceCon RC-01 Apex Strike', family: 'racecon' },
  { id: 'racecon_rc02_dash', widgetId: 'raceconRc02Dash', name: 'RaceCon RC-02 Purple Lap', family: 'racecon' },
  { id: 'racecon_rc03_dash', widgetId: 'raceconRc03Dash', name: 'RaceCon RC-03 Long Night', family: 'racecon' },
  { id: 'racecon_rc04_dash', widgetId: 'raceconRc04Dash', name: 'RaceCon RC-04 Box Now', family: 'racecon' },
  { id: 'racecon_rc05_dash', widgetId: 'raceconRc05Dash', name: 'RaceCon RC-05 Thermal Window', family: 'racecon' },
  { id: 'racecon_rc06_dash', widgetId: 'raceconRc06Dash', name: 'RaceCon RC-06 Save Mode', family: 'racecon' },
  { id: 'racecon_rc07_dash', widgetId: 'raceconRc07Dash', name: 'RaceCon RC-07 Blue Flags', family: 'racecon' },
  { id: 'racecon_rc08_dash', widgetId: 'raceconRc08Dash', name: 'RaceCon RC-08 Rain Line', family: 'racecon' },
  { id: 'racecon_rc09_dash', widgetId: 'raceconRc09Dash', name: 'RaceCon RC-09 Stage Time', family: 'racecon' },
  { id: 'racecon_rc10_dash', widgetId: 'raceconRc10Dash', name: 'RaceCon RC-10 Clear Sight', family: 'racecon' },
  { id: 'racecon_rc11_dash', widgetId: 'raceconRc11Dash', name: 'RaceCon RC-11 Trace Room', family: 'racecon' },
  { id: 'racecon_rc12_dash', widgetId: 'raceconRc12Dash', name: 'RaceCon RC-12 On Air', family: 'racecon' },
  { id: 'racecon_rc13_dash', widgetId: 'raceconRc13Dash', name: 'RaceCon RC-13 Hold Order', family: 'racecon' },
  { id: 'racecon_rc14_dash', widgetId: 'raceconRc14Dash', name: 'RaceCon RC-14 Triage', family: 'racecon' },
  { id: 'racecon_rc15_dash', widgetId: 'raceconRc15Dash', name: 'RaceCon RC-15 On The Nose', family: 'racecon' },
  { id: 'racecon_rc16_dash', widgetId: 'raceconRc16Dash', name: 'RaceCon RC-16 Learn Lines - Novice Coaching & Consistency', family: 'racecon' },
  { id: 'racecon_rc17_dash', widgetId: 'raceconRc17Dash', name: 'RaceCon RC-17 High Line', family: 'racecon' },
  { id: 'racecon_rc18_dash', widgetId: 'raceconRc18Dash', name: 'RaceCon RC-18 Split Test', family: 'racecon' },
  { id: 'racecon_rc19_dash', widgetId: 'raceconRc19Dash', name: 'RaceCon RC-19 Hand Over', family: 'racecon' },
  { id: 'racecon-rc20-lights-out', widgetId: 'raceconRc20Dash', name: 'RaceCon RC-20 Lights Out', family: 'racecon' },
  { id: 'hifi_ddu_cockpit', widgetId: 'hifiDdu', name: 'GT3 — DDU Cockpit (hi-fi)', family: 'gt3' },
  { id: 'hifi_endurance', widgetId: 'hifiEndurance', name: 'Endurance — Stint (hi-fi)', family: 'endurance' },
  { id: 'hifi_engineer', widgetId: 'hifiEngineer', name: 'Engineer — MoTeC Analysis (hi-fi)', family: 'engineer' },
  { id: 'hifi_minimal', widgetId: 'hifiMinimal', name: 'GT3 — Minimal (hi-fi)', family: 'gt3' },
  { id: 'hifi_broadcast', widgetId: 'hifiBroadcast', name: 'Broadcast — Standings (hi-fi)', family: 'broadcast' }
]

const EMBEDDED_WIDGET_IDS: OverlayWidgetId[] = EMBEDDED.map((e) => e.widgetId)

describe('full-frame dashboards embedded from the overlay-widget library', () => {
  it('exposes every canonical embedded preset', () => {
    expect(OVERLAY_DASHBOARD_PRESETS.map((p) => p.id)).toEqual(EMBEDDED.map((e) => e.id))
    expect(OVERLAY_DASHBOARD_PRESETS.map((p) => p.widgetId)).toEqual(EMBEDDED_WIDGET_IDS)
  })

  it('registers every embedded preset in BUILTIN_PRESETS with no duplicate ids in the catalogue', () => {
    const ids = BUILTIN_PRESETS.map((p) => p.id)
    expect(new Set(ids).size, 'BUILTIN_PRESETS ids must be unique').toBe(ids.length)
    const idSet = new Set(ids)
    for (const e of EMBEDDED) {
      expect(idSet.has(e.id), `BUILTIN_PRESETS must contain ${e.id}`).toBe(true)
    }
  })

  for (const e of EMBEDDED) {
    describe(`${e.id} (${e.widgetId})`, () => {
      const entry = BUILTIN_PRESETS.find((p) => p.id === e.id)

      it('is a BUILTIN_PRESETS entry carrying the PT name + family/dashboard/fullscreen tags', () => {
        expect(entry, `missing BUILTIN_PRESETS entry ${e.id}`).toBeDefined()
        expect(entry?.name).toContain(e.name)
        expect(entry?.tags).toEqual(expect.arrayContaining([e.family, 'dashboard', 'fullscreen']))
      })

      it('builds a Dashboard with ONE overlaywidget element bound to the right widgetId', () => {
        const dash = entry!.build()
        expect(dash.id.length, 'dashboard id').toBeGreaterThan(0)
        expect(dash.name).toContain(e.name)
        expect(dash.width).toBeGreaterThan(0)
        expect(dash.height).toBeGreaterThan(0)

        // Exactly one element, of the new embedded type, naming the widget.
        expect(dash.elements).toHaveLength(1)
        const [el] = dash.elements
        expect(el.type).toBe('overlaywidget')
        expect(el.widgetId).toBe(e.widgetId)
        expect(el.style, 'renderer contract: style always present').toBeTruthy()

        // The single element fills the whole canvas (full-screen embed).
        expect(el.x).toBe(0)
        expect(el.y).toBe(0)
        expect(el.w).toBe(dash.width)
        expect(el.h).toBe(dash.height)
      })

      it('builds fresh, unique element + dashboard ids on each call', () => {
        const a = entry!.build()
        const b = entry!.build()
        expect(a.id).not.toBe(b.id)
        expect(a.elements[0].id).not.toBe(b.elements[0].id)
      })
    })
  }
})

describe('embedded dashboards are no longer floating overlays', () => {
  it('removes all full-frame widgets from the OVERLAY_WIDGETS picker registry', () => {
    const overlayIds = new Set(OVERLAY_WIDGETS.map((w) => w.id))
    for (const widgetId of EMBEDDED_WIDGET_IDS) {
      expect(overlayIds.has(widgetId), `${widgetId} must NOT be a pickable overlay`).toBe(false)
    }
  })
})
