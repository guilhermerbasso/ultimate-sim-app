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
  it('declares fourteen unique race composition presets including themed car pages', () => {
    expect(HIFI_RACE_PRESETS).toHaveLength(14)
    expect(new Set(HIFI_RACE_PRESETS.map((preset) => preset.id)).size).toBe(HIFI_RACE_PRESETS.length)
    expect(HIFI_RACE_PRESETS.map((preset) => preset.id)).toEqual([
      'hifi_race_sprint_core',
      'hifi_race_qualifying_hotlap',
      'hifi_race_wet_race',
      'hifi_race_fuel_save',
      'hifi_race_tyre_management',
      'hifi_race_attack_delta',
      'hifi_race_defend_gaps',
      'hifi_race_final_laps',
      'hifi_race_restart_sprint',
      'hifi_race_safety_car',
      'hifi_race_ferrari',
      'hifi_race_porsche',
      'hifi_race_amg',
      'hifi_race_mclaren'
    ])
  })

  it('builds valid clean v4 dashboards from registered hi-fi widgets', () => {
    const ids = new Set<string>()
    const themedRevIds = new Set(['revThemedFerrari', 'revThemedPorsche', 'revThemedAmg', 'revThemedMclaren'])
    const themedClusterIds = new Set(['clusterFerrari', 'clusterPorsche', 'clusterAmg', 'clusterMclaren'])

    for (const preset of HIFI_RACE_PRESETS) {
      expect(preset.id.startsWith('hifi_race_')).toBe(true)
      expect(ids.has(preset.id)).toBe(false)
      expect(preset.tags.length).toBeGreaterThan(0)
      ids.add(preset.id)

      const built = preset.build()
      expect(built.width).toBe(1024)
      expect(built.height).toBe(600)
      expect(built.scaleMode).toBe('fit')
      expect(built.elements.length).toBeGreaterThan(1)
      expect(built.elements[0].type).toBe('rect')
      expect(built.elements[0].x).toBe(0)
      expect(built.elements[0].y).toBe(0)
      expect(built.elements[0].w).toBe(1024)
      expect(built.elements[0].h).toBe(600)

      const overlayWidgets = built.elements.filter((element) => element.type === 'overlaywidget')
      const rects = built.elements.filter((element) => element.type === 'rect')
      expect(rects).toHaveLength(1)
      expect(built.elements.some((element) => element.type === 'text')).toBe(false)

      const revTop = overlayWidgets[0]
      expect(revTop.x).toBe(0)
      expect(revTop.y).toBe(0)
      expect(revTop.w).toBe(1024)
      expect(revTop.h).toBe(96)
      expect(revTop.hifiModuleId?.startsWith('rev')).toBe(true)

      if (preset.id === 'hifi_race_ferrari' || preset.id === 'hifi_race_porsche' || preset.id === 'hifi_race_amg' || preset.id === 'hifi_race_mclaren') {
        expect(themedRevIds.has(revTop.hifiModuleId ?? '')).toBe(true)
        expect(overlayWidgets.some((element) => themedClusterIds.has(element.hifiModuleId ?? ''))).toBe(true)
        expect(preset.tags).toContain('themed')
      }

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
