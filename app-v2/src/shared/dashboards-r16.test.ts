import { describe, expect, it } from 'vitest'
import { BUILTIN_PRESETS, type DashboardElement, type DashboardElementType } from './dashboards'
import { R16_FUTURISTIC_IDS, R16_MINIMALIST_IDS, R16_PRESETS } from './dashboards-r16'

const W = 1024
const H = 600

// The 30 wave-16 widget ids. Typed as DashboardElementType[] so `tsc` rejects any
// typo here — this is the authoritative compile-time guarantee that these names
// are real union members. The runtime checks below then prove every element in
// the new dashboards uses a type drawn from this ∪ EXISTING_USED allow-list.
const NEW_30: DashboardElementType[] = [
  'ers-bar-futuristic', 'ers-bar-minimal',
  'ers-radial-futuristic', 'ers-radial-minimal',
  'p2p-futuristic', 'p2p-minimal',
  'weather-status-futuristic', 'weather-status-minimal',
  'track-surface-futuristic', 'track-surface-minimal',
  'bop-futuristic', 'bop-minimal',
  'cold-pressures-futuristic', 'cold-pressures-minimal',
  'clock-futuristic', 'clock-minimal',
  'pit-status-futuristic', 'pit-status-minimal',
  'neon-ring-futuristic', 'segmented-gauge-futuristic', 'sci-fi-delta-futuristic',
  'hud-tile-futuristic', 'neon-bar-futuristic', 'grid-gauge-futuristic',
  'mono-tile-minimal', 'typo-readout-minimal', 'hairline-bar-minimal',
  'dot-gauge-minimal', 'stacked-readout-minimal', 'arc-minimal'
]

// Existing widget types the new dashboards compose alongside the wave-16 kit.
const EXISTING_USED: DashboardElementType[] = [
  'rect', 'text', 'shiftbar', 'gearcluster', 'value', 'deltatile', 'deltabar',
  'laptiming', 'fuelstint', 'positiongaps', 'tyregrid', 'setupstrip', 'inputbars',
  'inputtrace', 'gforcemeter', 'relatives-clean', 'relatives-elaborate',
  'radar-clean', 'radar-elaborate', 'trackmap-elaborate', 'standings'
]

const ALLOWED = new Set<string>([...NEW_30, ...EXISTING_USED])
const NEW_SET = new Set<string>(NEW_30)

function rectsOverlap(a: DashboardElement, b: DashboardElement): boolean {
  const ix = Math.max(a.x, b.x)
  const iy = Math.max(a.y, b.y)
  const ax2 = Math.min(a.x + a.w, b.x + b.w)
  const ay2 = Math.min(a.y + a.h, b.y + b.h)
  return ix < ax2 && iy < ay2
}

// A backplate is a near-full-canvas rect that legitimately sits behind everything.
function isBackplate(el: DashboardElement): boolean {
  return el.type === 'rect' && el.w >= W * 0.98 && el.h >= H * 0.98
}

describe('wave-16 dashboards — catalogue shape', () => {
  it('ships at least 20 new dashboards, roughly half futuristic / half minimalist', () => {
    expect(R16_PRESETS.length).toBeGreaterThanOrEqual(20)
    expect(R16_FUTURISTIC_IDS.length).toBeGreaterThanOrEqual(9)
    expect(R16_MINIMALIST_IDS.length).toBeGreaterThanOrEqual(9)
    expect(R16_FUTURISTIC_IDS.length + R16_MINIMALIST_IDS.length).toBe(R16_PRESETS.length)
  })

  it('gives every dashboard a stable, unique, kebab-case id', () => {
    const kebab = /^[a-z0-9]+(-[a-z0-9]+)*$/
    const ids = R16_PRESETS.map((p) => p.id)
    for (const id of ids) expect(id, `id "${id}" must be kebab-case`).toMatch(kebab)
    expect(new Set(ids).size, 'ids must be unique').toBe(ids.length)
  })

  it('tags futuristic ids with -futuristic and minimalist ids with -minimal', () => {
    for (const id of R16_FUTURISTIC_IDS) expect(id.endsWith('-futuristic')).toBe(true)
    for (const id of R16_MINIMALIST_IDS) expect(id.endsWith('-minimal')).toBe(true)
  })

  it('gives every dashboard a non-empty display name and description', () => {
    for (const p of R16_PRESETS) {
      expect(p.name.length).toBeGreaterThan(0)
      const built = p.build()
      expect(built.description && built.description.length).toBeTruthy()
    }
  })
})

describe('wave-16 dashboards — registration in BUILTIN_PRESETS (back-compatible)', () => {
  it('appends every new dashboard to the catalogue without dropping existing ones', () => {
    const builtinIds = BUILTIN_PRESETS.map((p) => p.id)
    const builtinSet = new Set(builtinIds)
    for (const p of R16_PRESETS) {
      expect(builtinSet.has(p.id), `BUILTIN_PRESETS must contain ${p.id}`).toBe(true)
    }
    // No duplicate ids across the whole catalogue.
    expect(new Set(builtinIds).size).toBe(builtinIds.length)
    // The catalogue grew by exactly the wave-16 set (existing library preserved).
    const preexisting = builtinIds.filter((id) => !R16_PRESETS.some((p) => p.id === id))
    expect(preexisting.length).toBeGreaterThanOrEqual(40)
    expect(builtinIds.length).toBe(preexisting.length + R16_PRESETS.length)
  })

  it('has matching id + name on each registered entry', () => {
    for (const p of R16_PRESETS) {
      const entry = BUILTIN_PRESETS.find((e) => e.id === p.id)
      expect(entry).toBeDefined()
      expect(entry?.name).toBe(p.name)
    }
  })
})

describe('wave-16 dashboards — every element is valid and laid out within the canvas', () => {
  for (const preset of R16_PRESETS) {
    it(`${preset.id} builds a well-formed 1024×600 dashboard`, () => {
      const dash = preset.build()
      expect(dash.width).toBe(W)
      expect(dash.height).toBe(H)
      expect(dash.bg.length).toBeGreaterThan(0)
      expect(dash.elements.length).toBeGreaterThan(0)

      const ids = new Set<string>()
      for (const el of dash.elements) {
        // Valid, recognised widget type.
        expect(ALLOWED.has(el.type), `${preset.id}: unexpected type "${el.type}"`).toBe(true)
        // Unique element id within the dashboard.
        expect(ids.has(el.id), `${preset.id}: duplicate element id "${el.id}"`).toBe(false)
        ids.add(el.id)
        // Positive, on-canvas geometry.
        expect(el.w, `${preset.id}: ${el.type} width`).toBeGreaterThan(0)
        expect(el.h, `${preset.id}: ${el.type} height`).toBeGreaterThan(0)
        expect(el.x).toBeGreaterThanOrEqual(0)
        expect(el.y).toBeGreaterThanOrEqual(0)
        expect(el.x + el.w, `${preset.id}: ${el.type} overflows width`).toBeLessThanOrEqual(W)
        expect(el.y + el.h, `${preset.id}: ${el.type} overflows height`).toBeLessThanOrEqual(H)
        // Style object is always present (renderer contract).
        expect(el.style).toBeTruthy()
      }
    })

    it(`${preset.id} has no overlapping widgets (ignoring the backplate)`, () => {
      const dash = preset.build()
      const foreground = dash.elements.filter((el) => !isBackplate(el))
      for (let i = 0; i < foreground.length; i++) {
        for (let j = i + 1; j < foreground.length; j++) {
          const a = foreground[i]
          const b = foreground[j]
          expect(
            rectsOverlap(a, b),
            `${preset.id}: "${a.type}" and "${b.type}" overlap`
          ).toBe(false)
        }
      }
    })
  }
})

describe('wave-16 dashboards — actually compose the new widgets', () => {
  it('uses a wide variety of the 30 new wave-16 widget types', () => {
    const usedNew = new Set<string>()
    let newInstances = 0
    for (const preset of R16_PRESETS) {
      for (const el of preset.build().elements) {
        if (NEW_SET.has(el.type)) {
          usedNew.add(el.type)
          newInstances++
        }
      }
    }
    // The catalogue leans on the new kit, not just existing widgets.
    expect(usedNew.size).toBeGreaterThanOrEqual(20)
    expect(newInstances).toBeGreaterThanOrEqual(30)
  })

  it('puts at least one new wave-16 widget in most dashboards', () => {
    const withNew = R16_PRESETS.filter((p) => p.build().elements.some((el) => NEW_SET.has(el.type)))
    expect(withNew.length).toBeGreaterThanOrEqual(R16_PRESETS.length - 2)
  })
})
