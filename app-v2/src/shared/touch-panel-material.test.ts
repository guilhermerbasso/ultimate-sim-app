import { describe, expect, it } from 'vitest'
import {
  clampMaterial,
  createButtonBoxButton,
  DEFAULT_KEY_MATERIAL,
  KEY_MATERIALS,
  LEGACY_KEY_MATERIAL,
  normalizeButtonBoxButton,
  parseButtonBoxPanel,
  safeIcon,
  serializeButtonBoxPanel,
  createButtonBoxPanel
} from './touch-panel'

describe('key material + icon model', () => {
  it('defaults a brand-new button to the high-fidelity backlit material', () => {
    expect(createButtonBoxButton({}).material).toBe(DEFAULT_KEY_MATERIAL)
    expect(DEFAULT_KEY_MATERIAL).toBe('backlit')
  })

  it('keeps a valid explicit material and clamps an invalid one', () => {
    expect(createButtonBoxButton({ material: 'guarded' }).material).toBe('guarded')
    // @ts-expect-error — invalid material at runtime must fall back
    expect(createButtonBoxButton({ material: 'plasma' }).material).toBe(DEFAULT_KEY_MATERIAL)
  })

  it('clampMaterial validates against KEY_MATERIALS', () => {
    for (const m of KEY_MATERIALS) expect(clampMaterial(m)).toBe(m)
    expect(clampMaterial('nope')).toBe(DEFAULT_KEY_MATERIAL)
    expect(clampMaterial(42)).toBe(DEFAULT_KEY_MATERIAL)
    expect(clampMaterial(undefined, 'solid')).toBe('solid')
  })

  it('safeIcon accepts a short id and rejects junk', () => {
    expect(safeIcon('fuel')).toBe('fuel')
    expect(safeIcon('')).toBeUndefined()
    expect(safeIcon(123)).toBeUndefined()
    expect(safeIcon('x'.repeat(41))).toBeUndefined()
  })

  it('legacy panels (no material field) parse as the original solid look', () => {
    // A saved button that predates the material field.
    const legacy = normalizeButtonBoxButton({ id: 'b1', label: 'PIT', bodyColor: '#123456' })
    expect(legacy.material).toBe(LEGACY_KEY_MATERIAL)
    expect(LEGACY_KEY_MATERIAL).toBe('solid')
    // …but an explicit material on a saved button is preserved.
    expect(normalizeButtonBoxButton({ id: 'b2', label: 'X', material: 'glass' }).material).toBe('glass')
  })

  it('round-trips material + icon through serialize/parse', () => {
    const panel = createButtonBoxPanel({
      columns: 1,
      rows: 1,
      buttons: [{ label: 'FUEL', material: 'carbon', icon: 'fuel', bodyColor: '#ca8a04' }]
    })
    const parsed = parseButtonBoxPanel(serializeButtonBoxPanel(panel))
    expect(parsed).not.toBeNull()
    expect(parsed?.buttons[0].material).toBe('carbon')
    expect(parsed?.buttons[0].icon).toBe('fuel')
  })

  it('drops an over-long icon id on parse', () => {
    const panel = createButtonBoxPanel({ columns: 1, rows: 1, buttons: [{ label: 'X', icon: 'y'.repeat(80) }] })
    const parsed = parseButtonBoxPanel(serializeButtonBoxPanel(panel))
    expect(parsed?.buttons[0].icon).toBeUndefined()
  })
})
