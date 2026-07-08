import { describe, expect, it } from 'vitest'
import { HIFI_WIDGETS_BY_ID } from '../renderer/src/hifi/widgets/registry'
import { HIFI_FAMILY_PRESETS } from './dashboards-hifi-family'

const TARGET_W = 1024
const TARGET_H = 600
const MIN_SCALE = 0.75

interface Box {
  x: number
  y: number
  w: number
  h: number
}

interface OverlayBox extends Box {
  hifiModuleId?: string
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

describe('HIFI_FAMILY_PRESETS', () => {
  it('contains twelve unique hi-fi family presets with rich tags', () => {
    expect(HIFI_FAMILY_PRESETS).toHaveLength(12)

    const ids = new Set<string>()
    for (const preset of HIFI_FAMILY_PRESETS) {
      expect(preset.id.startsWith('hifi_family_')).toBe(true)
      expect(ids.has(preset.id)).toBe(false)
      ids.add(preset.id)
      expect(preset.tags.length).toBeGreaterThan(0)
    }
  })

  it('builds valid 1024x600 dashboards with registered, readable, non-overlapping overlay widgets', () => {
    for (const preset of HIFI_FAMILY_PRESETS) {
      const dashboard = preset.build()

      expect(dashboard.width, preset.id).toBe(TARGET_W)
      expect(dashboard.height, preset.id).toBe(TARGET_H)
      expect(dashboard.elements.length, preset.id).toBeGreaterThan(1)

      for (const element of dashboard.elements) {
        expect(element.x, `${preset.id}:${element.id} x`).toBeGreaterThanOrEqual(0)
        expect(element.y, `${preset.id}:${element.id} y`).toBeGreaterThanOrEqual(0)
        expect(element.w, `${preset.id}:${element.id} w`).toBeGreaterThan(0)
        expect(element.h, `${preset.id}:${element.id} h`).toBeGreaterThan(0)
        expect(element.x + element.w, `${preset.id}:${element.id} right`).toBeLessThanOrEqual(TARGET_W)
        expect(element.y + element.h, `${preset.id}:${element.id} bottom`).toBeLessThanOrEqual(TARGET_H)
      }

      const overlays = dashboard.elements.filter((element): element is typeof element & OverlayBox => element.type === 'overlaywidget')
      expect(overlays.length, preset.id).toBeGreaterThan(0)

      for (const overlay of overlays) {
        expect(overlay.hifiModuleId, `${preset.id}:${overlay.id} module id`).toBeTruthy()
        const module = HIFI_WIDGETS_BY_ID[overlay.hifiModuleId ?? '']
        expect(module, `${preset.id}:${overlay.hifiModuleId} registered`).toBeTruthy()
        expect(overlay.w, `${preset.id}:${overlay.hifiModuleId} width`).toBeGreaterThanOrEqual(module.defaultSize.w * MIN_SCALE)
        expect(overlay.h, `${preset.id}:${overlay.hifiModuleId} height`).toBeGreaterThanOrEqual(module.defaultSize.h * MIN_SCALE)
      }

      for (let i = 0; i < overlays.length; i += 1) {
        for (let j = i + 1; j < overlays.length; j += 1) {
          expect(
            overlaps(overlays[i], overlays[j]),
            `${preset.id}: ${overlays[i].hifiModuleId} overlaps ${overlays[j].hifiModuleId}`
          ).toBe(false)
        }
      }
    }
  })
})
