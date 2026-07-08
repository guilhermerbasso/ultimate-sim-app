import { describe, expect, it } from 'vitest'
import { HIFI_WIDGETS_BY_ID } from '../renderer/src/hifi/widgets/registry'
import { HIFI_RACE_PRESETS } from './dashboards-hifi-race'

interface Box {
  x: number
  y: number
  w: number
  h: number
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

describe('HIFI_RACE_PRESETS', () => {
  it('declares thirteen unique race composition presets', () => {
    expect(HIFI_RACE_PRESETS).toHaveLength(13)
    expect(new Set(HIFI_RACE_PRESETS.map((preset) => preset.id)).size).toBe(HIFI_RACE_PRESETS.length)
  })

  it('builds valid in-bounds dashboards from registered hi-fi widgets', () => {
    const ids = new Set<string>()

    for (const preset of HIFI_RACE_PRESETS) {
      expect(preset.id.startsWith('hifi_race_')).toBe(true)
      expect(ids.has(preset.id)).toBe(false)
      expect(preset.tags.length).toBeGreaterThan(0)
      ids.add(preset.id)

      const built = preset.build()
      expect(built.width).toBe(1024)
      expect(built.height).toBe(600)
      expect(built.elements.length).toBeGreaterThan(1)

      const overlayWidgets = built.elements.filter((element) => element.type === 'overlaywidget')

      for (const element of built.elements) {
        expect(element.x).toBeGreaterThanOrEqual(0)
        expect(element.y).toBeGreaterThanOrEqual(0)
        expect(element.x + element.w).toBeLessThanOrEqual(1024)
        expect(element.y + element.h).toBeLessThanOrEqual(600)
      }

      for (const element of overlayWidgets) {
        expect(element.hifiModuleId).toBeTruthy()
        const widget = HIFI_WIDGETS_BY_ID[element.hifiModuleId ?? '']
        expect(widget).toBeTruthy()
        expect(element.w, `${preset.id}: ${element.name ?? element.hifiModuleId} width is below 75% of default`).toBeGreaterThanOrEqual(widget.defaultSize.w * 0.75)
        expect(element.h, `${preset.id}: ${element.name ?? element.hifiModuleId} height is below 75% of default`).toBeGreaterThanOrEqual(widget.defaultSize.h * 0.75)
      }

      for (let i = 0; i < overlayWidgets.length; i += 1) {
        for (let j = i + 1; j < overlayWidgets.length; j += 1) {
          expect(overlaps(overlayWidgets[i], overlayWidgets[j]), `${preset.id}: ${overlayWidgets[i].name ?? i} overlaps ${overlayWidgets[j].name ?? j}`).toBe(false)
        }
      }
    }
  })
})
