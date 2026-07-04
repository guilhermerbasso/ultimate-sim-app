import { describe, expect, it } from 'vitest'
import {
  WIDGET_SLOTS,
  applySlotField,
  resolveSlotStyle,
  type Dashboard,
  type DashboardElement,
  type DashboardElementStyle,
  type TextSlotStyle
} from './dashboards'

// Helper mirroring how the editor (DashboardsView SlotStyleEditor) chains writes:
// each field edit produces a fresh `slots` map that replaces `style.slots`.
function edit(
  style: DashboardElementStyle,
  slot: string,
  field: keyof TextSlotStyle,
  value: unknown
): DashboardElementStyle {
  return { ...style, slots: applySlotField(style, slot, field, value) }
}

describe('applySlotField (editor write side)', () => {
  it('creates the slot map and field on a style that had no slots (back-compat in)', () => {
    expect(applySlotField({}, 'value', 'fontSize', 42)).toEqual({ value: { fontSize: 42 } })
  })

  it('merges into an existing slot without disturbing sibling fields', () => {
    const style: DashboardElementStyle = { slots: { value: { fontColor: '#0f0' } } }
    expect(applySlotField(style, 'value', 'fontFamily', 'Arial')).toEqual({
      value: { fontColor: '#0f0', fontFamily: 'Arial' }
    })
  })

  it('keeps other slots untouched when editing one slot', () => {
    const style: DashboardElementStyle = { slots: { label: { fontSize: 9 }, value: { fontSize: 30 } } }
    expect(applySlotField(style, 'value', 'fontColor', '#abc')).toEqual({
      label: { fontSize: 9 },
      value: { fontSize: 30, fontColor: '#abc' }
    })
  })

  it('removes a field on undefined/empty and prunes the slot when it becomes empty', () => {
    const style: DashboardElementStyle = { slots: { value: { fontFamily: 'Arial' } } }
    expect(applySlotField(style, 'value', 'fontFamily', undefined)).toEqual({})
    expect(applySlotField(style, 'value', 'fontFamily', '')).toEqual({})
  })

  it('prunes only the emptied field, keeping the rest of the slot', () => {
    const style: DashboardElementStyle = { slots: { value: { fontFamily: 'Arial', fontSize: 20 } } }
    expect(applySlotField(style, 'value', 'fontFamily', undefined)).toEqual({ value: { fontSize: 20 } })
  })

  it('does not mutate the input style.slots (immutability)', () => {
    const slots = { value: { fontSize: 10 } }
    const style: DashboardElementStyle = { slots }
    applySlotField(style, 'value', 'fontColor', '#fff')
    expect(slots).toEqual({ value: { fontSize: 10 } })
  })
})

describe('editor → renderer slot chain (font edits reach the rendered text style)', () => {
  // Representative widget: an `analoggauge` whose `value` text is drawn by the
  // renderer through resolveSlotStyle(style, 'value', <widget defaults>). A user
  // editing family/size/color/weight/align in the inspector must win over those
  // defaults — otherwise the edit is a visual no-op (the round-8 bug).
  it('overrides the widget defaults for every edited field of a slot', () => {
    let style: DashboardElementStyle = {}
    style = edit(style, 'value', 'fontFamily', '"Rajdhani", sans-serif')
    style = edit(style, 'value', 'fontSize', 48)
    style = edit(style, 'value', 'fontColor', '#112233')
    style = edit(style, 'value', 'fontWeight', 800)
    style = edit(style, 'value', 'align', 'right')

    // Widget defaults the renderer passes in (e.g. AnalogGauge value text):
    const resolved = resolveSlotStyle(style, 'value', {
      fontFamily: 'DSEG7',
      fontSize: 17,
      color: '#D4A000'
    })
    expect(resolved).toEqual({
      fontFamily: '"Rajdhani", sans-serif',
      fontSize: 48,
      color: '#112233',
      fontWeight: 800,
      align: 'right'
    })
  })

  it('leaves untouched slots on the widget defaults (no cross-talk between slots)', () => {
    const style = edit({}, 'value', 'fontSize', 50)
    // The `label` slot was never edited: it must resolve to the renderer defaults.
    expect(resolveSlotStyle(style, 'label', { color: '#888', fontSize: 8 })).toEqual({
      color: '#888',
      fontSize: 8
    })
    // The edited `value` slot wins over its own default size.
    expect(resolveSlotStyle(style, 'value', { color: '#fff', fontSize: 17 })).toEqual({
      color: '#fff',
      fontSize: 50
    })
  })

  it('every slot name the editor exposes is read back by resolveSlotStyle', () => {
    // Guards against editor/renderer slot-NAME mismatches (a mismatch silently
    // turns every edit into a no-op). For each declared slot we write a marker
    // colour and assert resolveSlotStyle surfaces it.
    for (const [type, defs] of Object.entries(WIDGET_SLOTS)) {
      for (const def of defs) {
        const style = edit({}, def.slot, 'fontColor', '#abcdef')
        const out = resolveSlotStyle(style, def.slot, { color: '#000' })
        expect(out.color, `${type} → slot "${def.slot}"`).toBe('#abcdef')
      }
    }
  })
})

describe('save round-trip preserves style.slots', () => {
  function dashboardWithSlots(): Dashboard {
    const el: DashboardElement = {
      id: 'el-1',
      type: 'analoggauge',
      x: 0,
      y: 0,
      w: 120,
      h: 120,
      binding: 'speedKmh',
      style: {
        accentColor: '#D4A000',
        slots: {
          value: { fontFamily: '"Chakra Petch", monospace', fontSize: 36, fontColor: '#00BFFF', fontWeight: 700 },
          label: { fontSize: 10, align: 'center' },
          unit: { fontColor: '#888' }
        }
      }
    }
    return { id: 'dash-1', name: 'Round-trip', width: 800, height: 480, bg: '#05070a', elements: [el] }
  }

  it('keeps slots intact through the JSON persistence the save handler performs', () => {
    const dash = dashboardWithSlots()
    // `app:dash:save` writes JSON.stringify(dash) and reloads via JSON.parse — the
    // file round-trip must not drop the granular per-text overrides.
    const reloaded: Dashboard = JSON.parse(JSON.stringify(dash))
    expect(reloaded.elements[0].style.slots).toEqual(dash.elements[0].style.slots)
  })

  it('still resolves the persisted slot fonts after the round-trip', () => {
    const reloaded: Dashboard = JSON.parse(JSON.stringify(dashboardWithSlots()))
    const style = reloaded.elements[0].style
    expect(resolveSlotStyle(style, 'value', { fontFamily: 'DSEG7', fontSize: 17, color: '#fff' })).toEqual({
      fontFamily: '"Chakra Petch", monospace',
      fontSize: 36,
      color: '#00BFFF',
      fontWeight: 700
    })
    expect(resolveSlotStyle(style, 'label', { color: '#ccc', fontSize: 8 })).toEqual({
      color: '#ccc',
      fontSize: 10,
      align: 'center'
    })
  })
})
