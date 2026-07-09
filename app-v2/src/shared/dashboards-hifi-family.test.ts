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

function intersects(a: Box, b: Box): boolean {
  return overlaps(a, b)
}

describe('HIFI_FAMILY_PRESETS', () => {
  it('contains sixteen unique clean-v4 hi-fi family presets with rich tags', () => {
    expect(HIFI_FAMILY_PRESETS).toHaveLength(16)

    const ids = new Set<string>()
    for (const preset of HIFI_FAMILY_PRESETS) {
      expect(preset.id.startsWith('hifi_family_')).toBe(true)
      expect(ids.has(preset.id)).toBe(false)
      ids.add(preset.id)
      expect(preset.tags).toContain('clean-v4')
      expect(preset.tags.length).toBeGreaterThan(0)
    }
  })

  it('includes four tagged per-car themed heroes', () => {
    const themed = HIFI_FAMILY_PRESETS.filter((preset) => preset.tags.includes('themed') && preset.tags.includes('car'))
    expect(themed.map((preset) => preset.id)).toEqual([
      'hifi_family_ferrari_hero',
      'hifi_family_porsche_hero',
      'hifi_family_amg_hero',
      'hifi_family_mclaren_hero'
    ])

    for (const preset of themed) {
      const modules = preset.build().elements
        .filter((element): element is typeof element & OverlayBox => element.type === 'overlaywidget')
        .map((element) => element.hifiModuleId)
      expect(modules.some((id) => id?.startsWith('revThemed')), preset.id).toBe(true)
      expect(modules.some((id) => id?.startsWith('cluster')), preset.id).toBe(true)
    }
  })

  it('builds valid 1024x600 dashboards with registered, readable, non-overlapping overlay widgets', () => {
    for (const preset of HIFI_FAMILY_PRESETS) {
      const dashboard = preset.build()

      expect(dashboard.width, preset.id).toBe(TARGET_W)
      expect(dashboard.height, preset.id).toBe(TARGET_H)
      expect(dashboard.scaleMode, preset.id).toBe('fit')
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

      const revHeader = overlays[0]
      expect(revHeader.x, `${preset.id}:rev top x`).toBe(0)
      expect(revHeader.y, `${preset.id}:rev top y`).toBe(0)
      expect(revHeader.w, `${preset.id}:rev top w`).toBe(TARGET_W)
      expect(revHeader.h, `${preset.id}:rev top h`).toBe(96)
      expect(revHeader.hifiModuleId, `${preset.id}:rev module`).toMatch(/^rev/)

      for (const overlay of overlays.slice(1)) {
        expect(overlay.y, `${preset.id}:${overlay.hifiModuleId} body starts below rev top`).toBeGreaterThanOrEqual(104)
      }

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

  it('keeps the broadcast hero center meaningful instead of empty', () => {
    const preset = HIFI_FAMILY_PRESETS.find((item) => item.id === 'hifi_family_broadcast')
    expect(preset).toBeTruthy()
    const overlays = preset!.build().elements.filter((element): element is typeof element & OverlayBox => element.type === 'overlaywidget')
    const middle = { x: 344, y: 132, w: 336, h: 252 }
    const centerModules = overlays.filter((overlay) => intersects(overlay, middle)).map((overlay) => overlay.hifiModuleId)

    expect(centerModules).toContain('speedGear')
    expect(centerModules.length).toBeGreaterThanOrEqual(1)
  })
})
