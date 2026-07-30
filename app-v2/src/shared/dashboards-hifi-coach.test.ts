import { describe, expect, it } from 'vitest'

import { HIFI_WIDGETS_BY_ID } from '../renderer/src/hifi/widgets/registry'
import { HIFI_COACH_PRESETS } from './dashboards-hifi-coach'
import type { DashboardElement } from './dashboards'

const TARGET_W = 1024
const TARGET_H = 600
const MIN_GUTTER = 12
const MIN_SCALE = 0.75
const REV_H = 96
const BODY_MIN_Y = 108
const THEMED_IDS = ['hifi_coach_ferrari_delta', 'hifi_coach_porsche_stint', 'hifi_coach_amg_brake_trace']

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

function isRevTop(element: DashboardElement): boolean {
  return element.type === 'overlaywidget' && element.x === 0 && element.y === 0 && element.w === TARGET_W && element.h === REV_H && (element.hifiModuleId ?? '').startsWith('rev')
}

describe('HIFI_COACH_PRESETS', () => {
  it('declares 12 unique clean-v4 coach composition presets with rich tags', () => {
    expect(HIFI_COACH_PRESETS).toHaveLength(12)

    const ids = new Set<string>()
    for (const preset of HIFI_COACH_PRESETS) {
      expect(preset.id.startsWith('hifi_coach_')).toBe(true)
      expect(ids.has(preset.id)).toBe(false)
      ids.add(preset.id)
      expect(preset.tags).toContain('clean-v4')
      expect(preset.tags).toContain('rev-top')
      expect(preset.tags.length).toBeGreaterThan(8)
    }
  })

  it('keeps every widget valid, readable, in bounds and separated by gutters', () => {
    for (const preset of HIFI_COACH_PRESETS) {
      const built = preset.build()
      expect(built.width, preset.id).toBe(TARGET_W)
      expect(built.height, preset.id).toBe(TARGET_H)
      expect(built.elements.length, preset.id).toBeGreaterThan(2)

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

  it('uses the clean v4 premise: bg only, no title/panel chrome, and rev-top body layout', () => {
    for (const preset of HIFI_COACH_PRESETS) {
      const built = preset.build()
      const [backplate, ...rest] = built.elements

      expect(backplate.type, `${preset.id}:backplate-type`).toBe('rect')
      expect(backplate.x, `${preset.id}:backplate-x`).toBe(0)
      expect(backplate.y, `${preset.id}:backplate-y`).toBe(0)
      expect(backplate.w, `${preset.id}:backplate-w`).toBe(TARGET_W)
      expect(backplate.h, `${preset.id}:backplate-h`).toBe(TARGET_H)
      expect(rest.some((element) => element.type === 'text'), `${preset.id}:no-title-text`).toBe(false)
      expect(rest.some((element) => element.type === 'rect'), `${preset.id}:no-panel-rects`).toBe(false)

      const overlays = overlayElements(built.elements)
      const rev = overlays.find(isRevTop)
      expect(rev, `${preset.id}:revTop`).toBeTruthy()
      for (const overlay of overlays.filter((element) => element !== rev)) {
        expect(overlay.y, `${preset.id}:${overlay.hifiModuleId}:body-y`).toBeGreaterThanOrEqual(BODY_MIN_Y)
      }
    }
  })

  it('adds three per-car themed coach dashboards with matching car tags and themed widgets', () => {
    for (const id of THEMED_IDS) {
      const preset = HIFI_COACH_PRESETS.find((item) => item.id === id)
      expect(preset, id).toBeTruthy()
      expect(preset?.tags).toContain('themed')
      expect(preset?.tags).toContain('car')

      const built = preset?.build()
      const moduleIds = new Set(overlayElements(built?.elements ?? []).map((element) => element.hifiModuleId))
      const car = id.includes('ferrari') ? 'Ferrari' : id.includes('porsche') ? 'Porsche' : 'Amg'
      expect(moduleIds.has(`revThemed${car}`), `${id}:themed-rev`).toBe(true)
      expect(moduleIds.has(`cluster${car}`), `${id}:themed-cluster`).toBe(true)
    }
  })
})
