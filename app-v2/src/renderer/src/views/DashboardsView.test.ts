import { describe, expect, it } from 'vitest'
import type { DashboardElementStyle } from '../../../shared/dashboards'
import { buttonPanelPlaylistItem } from '../../../shared/touch-panel'
import {
  applyInstrumentPart,
  applyInstrumentPatch,
  resolvePlaylistRowLabel
} from './DashboardsView'

// ── Blocker A (playlist UI) — touch-panel rows resolve a real name ────────────
describe('resolvePlaylistRowLabel', () => {
  const dashboards = [{ id: 'd1', name: 'GT3 Race', width: 1024, height: 600 }]
  const panels = [{ id: 'p1', name: 'Pit Buttons', columns: 4, rows: 2 }]

  it('resolves a dashboard row against dashboard summaries', () => {
    const label = resolvePlaylistRowLabel({ dashboardId: 'd1' }, dashboards, panels)
    expect(label).toEqual({ kind: 'dashboard', name: 'GT3 Race', subtitle: '1024×600', found: true })
  })

  it('resolves a touch-panel row against the touch-panel summaries (not "Dashboard não encontrado")', () => {
    const item = buttonPanelPlaylistItem('p1')
    const label = resolvePlaylistRowLabel(item, dashboards, panels)
    expect(label.kind).toBe('touch-panel')
    expect(label.name).toBe('Pit Buttons')
    expect(label.subtitle).toBe('Touch panel · 4×2')
    expect(label.found).toBe(true)
  })

  it('flags a missing touch panel without falling back to the dashboard message', () => {
    const label = resolvePlaylistRowLabel(buttonPanelPlaylistItem('ghost'), dashboards, panels)
    expect(label.kind).toBe('touch-panel')
    expect(label.name).toBe('ghost')
    expect(label.subtitle).toBe('Touch panel não encontrado')
    expect(label.found).toBe(false)
  })

  it('flags a missing dashboard', () => {
    const label = resolvePlaylistRowLabel({ dashboardId: 'nope' }, dashboards, panels)
    expect(label.subtitle).toBe('Dashboard não encontrado')
    expect(label.found).toBe(false)
  })
})

// ── Blocker B (inspector) — writes go to style.instrument.* ───────────────────
describe('applyInstrumentPatch', () => {
  it('creates the instrument spec from an empty style', () => {
    const next = applyInstrumentPatch(undefined, { template: 'dial' })
    expect(next).toEqual({ template: 'dial' })
  })

  it('merges into an existing instrument spec', () => {
    const style: DashboardElementStyle = { instrument: { template: 'dial' } }
    expect(applyInstrumentPatch(style, { material: 'carbon' })).toEqual({ template: 'dial', material: 'carbon' })
  })

  it('deletes a key when set to undefined and drops the spec when it becomes empty', () => {
    const style: DashboardElementStyle = { instrument: { template: 'dial' } }
    expect(applyInstrumentPatch(style, { template: undefined })).toBeUndefined()
  })

  it('does not mutate the original style', () => {
    const style: DashboardElementStyle = { instrument: { template: 'dial' } }
    applyInstrumentPatch(style, { glow: true })
    expect(style.instrument).toEqual({ template: 'dial' })
  })
})

describe('applyInstrumentPart', () => {
  it('writes a nested parts field', () => {
    const next = applyInstrumentPart({ instrument: { template: 'revled' } }, 'led', 'segments', 18)
    expect(next).toEqual({ template: 'revled', parts: { led: { segments: 18 } } })
  })

  it('writes the needle damp knob under dial', () => {
    const next = applyInstrumentPart({ instrument: { template: 'dial' } }, 'dial', 'damp', 0.4)
    expect(next?.parts?.dial?.damp).toBe(0.4)
  })

  it('removes a part field when undefined and prunes the empty part + parts', () => {
    const style: DashboardElementStyle = { instrument: { parts: { led: { segments: 15 } } } }
    const next = applyInstrumentPart(style, 'led', 'segments', undefined)
    // Only knob removed → led empty → parts empty → instrument empty → undefined.
    expect(next).toBeUndefined()
  })

  it('keeps sibling parts when pruning one part', () => {
    const style: DashboardElementStyle = {
      instrument: { template: 'dial', parts: { dial: { damp: 0.3 }, needle: { width: 2 } } }
    }
    const next = applyInstrumentPart(style, 'needle', 'width', undefined)
    expect(next).toEqual({ template: 'dial', parts: { dial: { damp: 0.3 } } })
  })
})
