import { describe, it, expect } from 'vitest'
import { resolveSkin, zoneColor, gt3Base, hudBase, SKIN_IDS, BRAND_IDS } from './tokens'
import { makeGrid, WHEEL_GRID } from './SafeGrid'
import { computeFit } from './FitText'

describe('resolveSkin', () => {
  it('returns the gt3 base unchanged for gt3/generic', () => {
    const s = resolveSkin('gt3', 'generic')
    expect(s.id).toBe('gt3')
    expect(s.brand).toBe('generic')
    expect(s.palette.accent).toBe(gt3Base.palette.accent)
    expect(s.led.count).toBe(15)
  })

  it('returns the hud base for hud/generic', () => {
    const s = resolveSkin('hud', 'generic')
    expect(s.id).toBe('hud')
    expect(s.material.kind).toBe('glass')
    expect(s.typography.gear).toBe(hudBase.typography.gear)
  })

  it('merges brand overlays (palette + led) onto the base', () => {
    const s = resolveSkin('gt3', 'stuttgart')
    expect(s.brand).toBe('stuttgart')
    expect(s.palette.accent).toBe('#D5001C')
    expect(s.led.count).toBe(10)
    expect(s.led.mirrored).toBe(true)
    // untouched palette fields fall through from the base
    expect(s.palette.bg).toBe(gt3Base.palette.bg)
  })

  it('maranello uses round mirrored LEDs and red accent', () => {
    const s = resolveSkin('gt3', 'maranello')
    expect(s.led.shape).toBe('round')
    expect(s.led.mirrored).toBe(true)
    expect(s.palette.accent).toBe('#DC0000')
  })

  it('defaults to gt3/generic with no args', () => {
    const s = resolveSkin()
    expect(s.id).toBe('gt3')
    expect(s.brand).toBe('generic')
  })

  it('exposes every id/brand and each resolves without throwing', () => {
    for (const id of SKIN_IDS) {
      for (const brand of BRAND_IDS) {
        const s = resolveSkin(id, brand)
        expect(s.led.count).toBeGreaterThan(0)
        expect(s.typography.minFontPx).toBeGreaterThanOrEqual(11)
      }
    }
  })
})

describe('zoneColor', () => {
  it('picks the zone by fraction and redline above the last zone', () => {
    const led = gt3Base.led
    expect(zoneColor(led, 0.1)).toBe('#16A34A') // green
    expect(zoneColor(led, 0.7)).toBe('#F59E0B') // amber
    expect(zoneColor(led, 0.9)).toBe('#DC2626') // red
    expect(zoneColor(led, 1.0)).toBe(led.redline.color) // blue redline
  })
  it('clamps out-of-range / NaN input', () => {
    expect(zoneColor(gt3Base.led, -5)).toBe('#16A34A')
    expect(zoneColor(gt3Base.led, Number.NaN)).toBe('#16A34A')
  })
})

describe('makeGrid', () => {
  it('produces non-overlapping cells within bounds', () => {
    const g = makeGrid(12, 6, 800, 480, 8)
    const a = g.cell(0, 0)
    const b = g.cell(1, 0)
    expect(a.x).toBeGreaterThanOrEqual(0)
    expect(b.x).toBeGreaterThan(a.x + a.w - 0.001) // b starts after a (+gutter)
    const last = g.cell(11, 5)
    expect(last.x + last.w).toBeLessThanOrEqual(800 + 0.001)
    expect(last.y + last.h).toBeLessThanOrEqual(480 + 0.001)
  })
  it('spans multiple cells and clamps overspill', () => {
    const r = WHEEL_GRID.cell(5, 1, 4, 4)
    expect(r.w).toBeGreaterThan(WHEEL_GRID.cellW)
    const clamped = WHEEL_GRID.cell(11, 5, 5, 5) // would overflow → clamp to 1×1
    expect(clamped.x + clamped.w).toBeLessThanOrEqual(800 + 0.001)
  })
  it('inset shrinks symmetrically and never goes negative', () => {
    const r = WHEEL_GRID.cell(0, 0)
    const i = WHEEL_GRID.inset(r, 4)
    expect(i.w).toBe(Math.max(0, r.w - 8))
    const tiny = WHEEL_GRID.inset({ x: 0, y: 0, w: 4, h: 4 }, 100)
    expect(tiny.w).toBeGreaterThanOrEqual(0)
    expect(tiny.h).toBeGreaterThanOrEqual(0)
  })
})

describe('computeFit (pure, estimate path)', () => {
  it('fits a short string near the height cap', () => {
    const r = computeFit(null, '4', 200, 200, 11, 400, 'squeeze')
    expect(r.didFit).toBe(true)
    expect(r.fontPx).toBeLessThanOrEqual(200)
    expect(r.fontPx).toBeGreaterThan(11)
  })
  it('shrinks a long string to fit the width', () => {
    const wide = computeFit(null, '1:42.348', 120, 60, 11, 200, 'squeeze')
    // width ~ 8 chars * fontPx * 0.58 must be ≤ 120 → fontPx ≲ 25
    expect(wide.fontPx).toBeLessThan(30)
  })
  it('reports didFit=false and drops when it cannot reach minFontPx', () => {
    const r = computeFit(null, 'VERYLONGSTRINGXX', 20, 12, 11, 200, 'drop')
    expect(r.didFit).toBe(false)
    expect(r.shown).toBe('')
  })
  it('ellipsis truncates when it cannot fit', () => {
    const r = computeFit(null, 'VERYLONGSTRINGXX', 40, 12, 11, 200, 'ellipsis')
    expect(r.didFit).toBe(false)
    expect(r.shown.endsWith('…')).toBe(true)
  })
  it('never returns NaN', () => {
    const r = computeFit(null, '', 0, 0, 11, 400, 'squeeze')
    expect(Number.isNaN(r.fontPx)).toBe(false)
  })
})
