import { describe, expect, it } from 'vitest'
import { buttonControlActions, KEY_MATERIALS, TOUCH_CONTROL_KINDS, type ButtonAction } from './touch-panel'
import { ALL_TOUCH_BUTTONS, TOUCH_BUTTON_CATALOG } from './touch-panel-catalog'
import { TOUCH_PANEL_PRESETS } from './touch-panel-presets'

const VALID_ACTION_KINDS: ButtonAction['kind'][] = ['none', 'iracing', 'keyboard', 'app']
const VALID_IRACING = new Set([
  'pit:addFuel', 'pit:clearFuel', 'pit:toggleTyreLf', 'pit:toggleTyreRf', 'pit:toggleTyreLr',
  'pit:toggleTyreRr', 'pit:fastRepair', 'pit:clearAll', 'camera:next', 'camera:previous',
  'blackBox:next', 'blackBox:previous'
])

describe('touch button catalog', () => {
  it('exposes a sizeable curated library', () => {
    expect(ALL_TOUCH_BUTTONS.length).toBeGreaterThanOrEqual(50)
    expect(TOUCH_BUTTON_CATALOG.length).toBeGreaterThanOrEqual(6)
    expect(ALL_TOUCH_BUTTONS.length).toBe(TOUCH_BUTTON_CATALOG.flatMap((g) => g.buttons).length)
  })

  it('every catalog button has a valid material + action', () => {
    for (const b of ALL_TOUCH_BUTTONS) {
      expect(KEY_MATERIALS).toContain(b.material)
      expect(TOUCH_CONTROL_KINDS).toContain(b.control.kind)
      for (const action of buttonControlActions(b.control)) {
        expect(VALID_ACTION_KINDS).toContain(action.kind)
        if (action.kind === 'iracing') expect(VALID_IRACING.has(action.command.name)).toBe(true)
      }
    }
  })

  it('catalog button ids are unique', () => {
    const ids = ALL_TOUCH_BUTTONS.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('touch panel presets', () => {
  it('ships ~20 ready-made panels', () => {
    expect(TOUCH_PANEL_PRESETS.length).toBeGreaterThanOrEqual(18)
  })

  it('every preset fills its grid exactly (no overlap / no gaps)', () => {
    for (const p of TOUCH_PANEL_PRESETS) {
      expect(p.buttons.length, `${p.id} must fill columns*rows`).toBe(p.columns * p.rows)
    }
  })

  it('ships real examples of every semantic control kind', () => {
    const kinds = new Set([
      ...ALL_TOUCH_BUTTONS.map((button) => button.control.kind),
      ...TOUCH_PANEL_PRESETS.flatMap((panel) => panel.buttons.map((button) => button.control.kind))
    ])
    expect([...kinds].sort()).toEqual([...TOUCH_CONTROL_KINDS].sort())
  })
  it('every preset has a unique id and unique button ids', () => {
    const ids = TOUCH_PANEL_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of TOUCH_PANEL_PRESETS) {
      const bids = p.buttons.map((b) => b.id)
      expect(new Set(bids).size, `${p.id} button ids`).toBe(bids.length)
    }
  })

  it('every preset button has a valid material + bound action', () => {
    for (const p of TOUCH_PANEL_PRESETS) {
      for (const b of p.buttons) {
        expect(KEY_MATERIALS).toContain(b.material)
        expect(TOUCH_CONTROL_KINDS).toContain(b.control.kind)
        for (const action of buttonControlActions(b.control)) {
          expect(VALID_ACTION_KINDS).toContain(action.kind)
          if (action.kind === 'iracing') {
            expect(VALID_IRACING.has(action.command.name), `${p.id}/${b.id}`).toBe(true)
            expect(action.command.group).toBe(action.command.name.split(':')[0])
          }
        }
      }
    }
  })
})
