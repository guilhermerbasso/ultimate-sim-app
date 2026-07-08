import { describe, expect, it } from 'vitest'

import { HIFI_WIDGETS_BY_ID } from '../renderer/src/hifi/widgets/registry'
import { HIFI_COACH_PRESETS } from './dashboards-hifi-coach'
import type { DashboardElement } from './dashboards'

const TARGET_W = 1024
const TARGET_H = 600
const MIN_GUTTER = 12
const MIN_SCALE = 0.75

function overlayElements(elements: DashboardElement[]): DashboardElement[] {
  return elements.filter((element) => element.type === 'overlaywidget')
}

function hasGutter(a: DashboardElement, b: DashboardElement): boolean {
  return (
    a.x + a.w + MIN_GUTTER <= b.x ||
    b.x + b.w + MIN_GUTTER <= a.x ||
    a.y + a.h + MIN_GUTTER <= b.y ||
    b.y + b.h + MIN_GUTTER <= a.y
  )
}

describe('HIFI_COACH_PRESETS', () => {
  it('declares 12 unique coach composition presets with rich tags', () => {
    expect(HIFI_COACH_PRESETS).toHaveLength(12)

    const ids = new Set<string>()
    for (const preset of HIFI_COACH_PRESETS) {
      expect(preset.id.startsWith('hifi_coach_')).toBe(true)
      expect(ids.has(preset.id)).toBe(false)
      ids.add(preset.id)
      expect(preset.tags.length).toBeGreaterThan(0)
    }
  })

  it('keeps every widget valid, readable, in bounds and separated by gutters', () => {
    for (const preset of HIFI_COACH_PRESETS) {
      const built = preset.build()
      expect(built.width, preset.id).toBe(TARGET_W)
      expect(built.height, preset.id).toBe(TARGET_H)
      expect(built.elements.length, preset.id).toBeGreaterThan(1)

      for (const element of built.elements) {
        expect(element.x, `${preset.id}:${element.name ?? element.id}:x`).toBeGreaterThanOrEqual(0)
        expect(element.y, `${preset.id}:${element.name ?? element.id}:y`).toBeGreaterThanOrEqual(0)
        expect(element.x + element.w, `${preset.id}:${element.name ?? element.id}:right`).toBeLessThanOrEqual(TARGET_W)
        expect(element.y + element.h, `${preset.id}:${element.name ?? element.id}:bottom`).toBeLessThanOrEqual(TARGET_H)
      }

      const overlays = overlayElements(built.elements)
      for (const overlay of overlays) {
        expect(overlay.hifiModuleId, `${preset.id}:${overlay.name ?? overlay.id}:module`).toBeTruthy()
        const module = HIFI_WIDGETS_BY_ID[overlay.hifiModuleId ?? '']
        expect(module, `${preset.id}:${overlay.hifiModuleId}:registered`).toBeTruthy()
        expect(overlay.w, `${preset.id}:${overlay.hifiModuleId}:width`).toBeGreaterThanOrEqual(module.defaultSize.w * MIN_SCALE)
        expect(overlay.h, `${preset.id}:${overlay.hifiModuleId}:height`).toBeGreaterThanOrEqual(module.defaultSize.h * MIN_SCALE)
      }

      for (let i = 0; i < overlays.length; i += 1) {
        for (let j = i + 1; j < overlays.length; j += 1) {
          expect(hasGutter(overlays[i], overlays[j]), `${preset.id}:${overlays[i].hifiModuleId}/${overlays[j].hifiModuleId}`).toBe(true)
        }
      }
    }
  })
})
