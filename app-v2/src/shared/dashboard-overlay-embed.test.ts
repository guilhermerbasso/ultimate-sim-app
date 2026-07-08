import { describe, expect, it } from 'vitest'
import { BUILTIN_PRESETS, OVERLAY_DASHBOARD_PRESETS } from './dashboards'
import { OVERLAY_WIDGETS } from './overlays'
import type { OverlayWidgetId } from './overlays'

// The six full-frame dashboards that were moved OUT of the floating-overlay
// picker (OVERLAY_WIDGETS) and INTO the DASHBOARDS system (BUILTIN_PRESETS) as
// single-`overlaywidget`-element presets. This table is the contract: preset id →
// embedded widget id, the PT display name, the family/tag set.
const EMBEDDED: Array<{
  id: string
  widgetId: OverlayWidgetId
  name: string
  family: 'gt3' | 'lmu' | 'endurance' | 'engineer'
}> = [
  { id: 'grid_stack_dash', widgetId: 'gridStackDash', name: 'GT3 — Grid (SimHub)', family: 'gt3' },
  { id: 'grid_pro_dash', widgetId: 'gridProDash', name: 'GT3 — Pro (neon)', family: 'gt3' },
  { id: 'bosch_296_dash', widgetId: 'bosch296Dash', name: 'GT3 — Bosch 296', family: 'gt3' },
  { id: 'ring_dash', widgetId: 'ringDash', name: 'GT3 — Anel circular', family: 'gt3' },
  { id: 'lmu_endurance_dash', widgetId: 'lmuEnduranceDash', name: 'LMU — Endurance', family: 'lmu' },
  { id: 'lmu_stint_dash', widgetId: 'lmuStintDash', name: 'LMU — Stint/Fuel', family: 'lmu' },
  { id: 'hifi_ddu_cockpit', widgetId: 'hifiDdu', name: 'GT3 — DDU Cockpit (hi-fi)', family: 'gt3' },
  { id: 'hifi_endurance', widgetId: 'hifiEndurance', name: 'Endurance — Stint (hi-fi)', family: 'endurance' },
  { id: 'hifi_engineer', widgetId: 'hifiEngineer', name: 'Engineer — MoTeC Analysis (hi-fi)', family: 'engineer' }
]

const EMBEDDED_WIDGET_IDS: OverlayWidgetId[] = EMBEDDED.map((e) => e.widgetId)

describe('full-frame dashboards embedded from the overlay-widget library', () => {
  it('exposes exactly the six canonical embedded presets', () => {
    expect(OVERLAY_DASHBOARD_PRESETS.map((p) => p.id)).toEqual(EMBEDDED.map((e) => e.id))
    expect(OVERLAY_DASHBOARD_PRESETS.map((p) => p.widgetId)).toEqual(EMBEDDED_WIDGET_IDS)
  })

  it('registers all six in BUILTIN_PRESETS with no duplicate ids in the catalogue', () => {
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
  it('removes all six from the OVERLAY_WIDGETS picker registry', () => {
    const overlayIds = new Set(OVERLAY_WIDGETS.map((w) => w.id))
    for (const widgetId of EMBEDDED_WIDGET_IDS) {
      expect(overlayIds.has(widgetId), `${widgetId} must NOT be a pickable overlay`).toBe(false)
    }
  })
})
