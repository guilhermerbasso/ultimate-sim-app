import { describe, expect, it } from 'vitest'
import { HIFI_WIDGETS_BY_ID } from '../renderer/src/hifi/widgets/registry'
import { HIFI_THEMED_CAR_PRESETS } from './dashboards-hifi-themed-cars2'

interface Box {
  x: number
  y: number
  w: number
  h: number
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

describe('HIFI_THEMED_CAR_PRESETS', () => {
  it('declares six unique per-car themed presets', () => {
    expect(HIFI_THEMED_CAR_PRESETS).toHaveLength(6)
    expect(new Set(HIFI_THEMED_CAR_PRESETS.map((p) => p.id)).size).toBe(6)
  })

  it('builds valid dashboards from registered themed widgets', () => {
    for (const preset of HIFI_THEMED_CAR_PRESETS) {
      expect(preset.id.startsWith('hifi_themed_')).toBe(true)
      const built = preset.build()
      expect(built.width).toBe(1024)
      expect(built.height).toBe(600)

      const overlayWidgets = built.elements.filter((e) => e.type === 'overlaywidget')
      const rects = built.elements.filter((e) => e.type === 'rect')
      expect(rects).toHaveLength(1)
      expect(built.elements.some((e) => e.type === 'text')).toBe(false)

      const rev = overlayWidgets[0]
      expect(rev.x).toBe(0)
      expect(rev.y).toBe(0)
      expect(rev.w).toBe(1024)
      expect(rev.h).toBe(96)
      expect(rev.hifiModuleId?.startsWith('revThemed')).toBe(true)

      for (const el of built.elements) {
        expect(el.x).toBeGreaterThanOrEqual(0)
        expect(el.y).toBeGreaterThanOrEqual(0)
        expect(el.x + el.w).toBeLessThanOrEqual(1024)
        expect(el.y + el.h).toBeLessThanOrEqual(600)
      }

      for (const el of overlayWidgets) {
        const widget = HIFI_WIDGETS_BY_ID[el.hifiModuleId ?? '']
        expect(widget, `${preset.id}: unknown widget ${el.hifiModuleId}`).toBeTruthy()
        expect(el.w).toBeGreaterThanOrEqual(widget.defaultSize.w * 0.75)
        expect(el.h).toBeGreaterThanOrEqual(widget.defaultSize.h * 0.75)
      }

      for (let i = 0; i < overlayWidgets.length; i += 1) {
        for (let j = i + 1; j < overlayWidgets.length; j += 1) {
          expect(overlaps(overlayWidgets[i], overlayWidgets[j]), `${preset.id}: overlap ${i}/${j}`).toBe(false)
        }
      }
    }
  })
})
