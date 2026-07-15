import { describe, expect, it } from 'vitest'
import { buttonControlActions, KEY_MATERIALS, type ButtonAction, type KeyMaterial } from './touch-panel'
import { TOUCH_PANEL_PRESETS } from './touch-panel-presets'
import { TOUCH_PRESETS_THEMED } from './touch-panel-presets-themed'

const VALID_ACTION_KINDS: ButtonAction['kind'][] = ['none', 'iracing', 'keyboard', 'app']

describe('themed touch panel presets', () => {
  it('ships the style showcase and six car-themed button boxes', () => {
    expect(TOUCH_PRESETS_THEMED).toHaveLength(7)
    expect(TOUCH_PRESETS_THEMED.map((panel) => panel.name)).toEqual([
      'Touch Styles Reference',
      'Ferrari GT Touch Box',
      'Porsche GT Touch Box',
      'Mercedes-AMG GT Touch Box',
      'McLaren GT Touch Box',
      'Corvette GT Touch Box',
      'Lamborghini GT Touch Box'
    ])
  })

  it('registers every themed preset in the global touch preset list', () => {
    const registeredIds = new Set(TOUCH_PANEL_PRESETS.map((panel) => panel.id))
    for (const panel of TOUCH_PRESETS_THEMED) expect(registeredIds.has(panel.id)).toBe(true)
  })

  it('covers all reference styles with valid materials and actions', () => {
    const materials = new Set(TOUCH_PRESETS_THEMED.flatMap((panel) => panel.buttons.map((button) => button.material)))
    const expectedMaterials: KeyMaterial[] = ['rgb', 'backlit', 'toggle', 'rocker', 'rotary', 'led_ring', 'guarded', 'selector']
    for (const material of expectedMaterials) {
      expect(materials.has(material), material).toBe(true)
    }
    for (const panel of TOUCH_PRESETS_THEMED) {
      expect(panel.tags).toContain('touch')
      expect(panel.buttons.length, panel.id).toBe(panel.columns * panel.rows)
      for (const button of panel.buttons) {
        expect(KEY_MATERIALS).toContain(button.material)
        for (const action of buttonControlActions(button.control)) expect(VALID_ACTION_KINDS).toContain(action.kind)
      }
    }
  })
})
