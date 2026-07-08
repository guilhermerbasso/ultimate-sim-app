import { describe, expect, it } from 'vitest'
import { HIFI_WIDGETS_BY_ID } from '../renderer/src/hifi/widgets/registry'
import { HIFI_ENDURANCE_PRESETS } from './dashboards-hifi-endurance'

const DASH_W = 1024
const DASH_H = 600
const MIN_GUTTER = 12

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function expanded(el: { x: number; y: number; w: number; h: number }) {
  return {
    x: el.x - MIN_GUTTER / 2,
    y: el.y - MIN_GUTTER / 2,
    w: el.w + MIN_GUTTER,
    h: el.h + MIN_GUTTER
  }
}

describe('HIFI_ENDURANCE_PRESETS', () => {
  it('defines thirteen unique endurance composition presets', () => {
    const ids = HIFI_ENDURANCE_PRESETS.map((preset) => preset.id)

    expect(HIFI_ENDURANCE_PRESETS).toHaveLength(13)
    expect(new Set(ids).size).toBe(ids.length)
    for (const preset of HIFI_ENDURANCE_PRESETS) {
      expect(preset.id.startsWith('hifi_endur_')).toBe(true)
      expect(preset.tags.length).toBeGreaterThan(0)
    }
  })

  it('builds valid, in-bounds, non-overlapping overlay widget layouts', () => {
    for (const preset of HIFI_ENDURANCE_PRESETS) {
      const dash = preset.build()
      const widgets = dash.elements.filter((el) => el.type === 'overlaywidget')

      expect(dash.width, preset.id).toBe(DASH_W)
      expect(dash.height, preset.id).toBe(DASH_H)
      expect(widgets.length, preset.id).toBeGreaterThan(0)

      for (const widget of widgets) {
        expect(widget.hifiModuleId, `${preset.id}:${widget.name ?? widget.id}`).toBeTruthy()
        const hifiWidget = HIFI_WIDGETS_BY_ID[widget.hifiModuleId ?? '']
        expect(hifiWidget, `${preset.id}:${widget.hifiModuleId}`).toBeTruthy()
        expect(widget.x, `${preset.id}:${widget.hifiModuleId}:x`).toBeGreaterThanOrEqual(0)
        expect(widget.y, `${preset.id}:${widget.hifiModuleId}:y`).toBeGreaterThanOrEqual(0)
        expect(widget.x + widget.w, `${preset.id}:${widget.hifiModuleId}:right`).toBeLessThanOrEqual(DASH_W)
        expect(widget.y + widget.h, `${preset.id}:${widget.hifiModuleId}:bottom`).toBeLessThanOrEqual(DASH_H)
        expect(widget.w, `${preset.id}:${widget.hifiModuleId}:min-width`).toBeGreaterThanOrEqual(hifiWidget.defaultSize.w * 0.75)
        expect(widget.h, `${preset.id}:${widget.hifiModuleId}:min-height`).toBeGreaterThanOrEqual(hifiWidget.defaultSize.h * 0.75)
      }

      for (let i = 0; i < widgets.length; i += 1) {
        for (let j = i + 1; j < widgets.length; j += 1) {
          expect(overlaps(expanded(widgets[i]), expanded(widgets[j])), `${preset.id}:${widgets[i].hifiModuleId}/${widgets[j].hifiModuleId}`).toBe(false)
        }
      }
    }
  })
})
