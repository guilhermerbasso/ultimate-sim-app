import { describe, expect, it } from 'vitest'
import { HIFI_WIDGETS_BY_ID } from '../renderer/src/hifi/widgets/registry'
import { HIFI_DIAG_PRESETS } from './dashboards-hifi-diagnostics'

interface Box {
  x: number
  y: number
  w: number
  h: number
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

describe('HIFI_DIAG_PRESETS', () => {
  it('declares five unique diagnostics composition presets', () => {
    expect(HIFI_DIAG_PRESETS).toHaveLength(5)
    expect(new Set(HIFI_DIAG_PRESETS.map((preset) => preset.id)).size).toBe(HIFI_DIAG_PRESETS.length)
    expect(HIFI_DIAG_PRESETS.map((preset) => preset.id)).toEqual([
      'hifi_diag_chassis_dynamics',
      'hifi_diag_engineer',
      'hifi_diag_endurance_strategy',
      'hifi_diag_environment',
      'hifi_diag_navigation'
    ])
  })

  it('builds valid clean v4 dashboards from registered hi-fi widgets', () => {
    for (const preset of HIFI_DIAG_PRESETS) {
      expect(preset.id.startsWith('hifi_diag_')).toBe(true)
      expect(preset.tags.length).toBeGreaterThan(0)

      const built = preset.build()
      expect(built.width).toBe(1024)
      expect(built.height).toBe(600)
      expect(built.scaleMode).toBe('fit')
      expect(built.elements[0].type).toBe('rect')

      const overlayWidgets = built.elements.filter((element) => element.type === 'overlaywidget')
      const rects = built.elements.filter((element) => element.type === 'rect')
      expect(rects).toHaveLength(1)
      expect(built.elements.some((element) => element.type === 'text')).toBe(false)

      const rev = overlayWidgets[0]
      expect(rev.x).toBe(0)
      expect(rev.y).toBe(0)
      expect(rev.w).toBe(1024)
      expect(rev.h).toBe(96)
      expect(rev.hifiModuleId?.startsWith('rev')).toBe(true)

      for (const element of built.elements) {
        expect(element.x).toBeGreaterThanOrEqual(0)
        expect(element.y).toBeGreaterThanOrEqual(0)
        expect(element.x + element.w).toBeLessThanOrEqual(1024)
        expect(element.y + element.h).toBeLessThanOrEqual(600)
      }

      for (const element of overlayWidgets) {
        expect(element.hifiModuleId).toBeTruthy()
        const widget = HIFI_WIDGETS_BY_ID[element.hifiModuleId ?? '']
        expect(widget, `${preset.id}: unknown widget ${element.hifiModuleId}`).toBeTruthy()
        expect(element.w, `${preset.id}: ${element.name ?? element.hifiModuleId} width below 75% of default`).toBeGreaterThanOrEqual(widget.defaultSize.w * 0.75)
        expect(element.h, `${preset.id}: ${element.name ?? element.hifiModuleId} height below 75% of default`).toBeGreaterThanOrEqual(widget.defaultSize.h * 0.75)
      }

      for (let i = 0; i < overlayWidgets.length; i += 1) {
        for (let j = i + 1; j < overlayWidgets.length; j += 1) {
          expect(overlaps(overlayWidgets[i], overlayWidgets[j]), `${preset.id}: ${overlayWidgets[i].name ?? i} overlaps ${overlayWidgets[j].name ?? j}`).toBe(false)
        }
      }
    }
  })
})
