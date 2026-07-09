import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlayStyle, DEFAULT_OVERLAY_STYLE_PRESET, type OverlayWidgetConfig, type OverlayWidgetId } from '../../../shared/overlays'
import { HIFI_WIDGETS, hifiWidgetTags } from '../hifi/widgets/registry'
import { HifiWidgetHost, resolveWidgetComponent } from './widgets'
import { createDefaultOverlaysConfigWithHifi, HIFI_OVERLAY_DEFS } from './hifi-overlays'

describe('hi-fi overlay bridge', () => {
  it('creates one unique hifi: definition per hi-fi module', () => {
    expect(HIFI_OVERLAY_DEFS).toHaveLength(HIFI_WIDGETS.length)
    const ids = HIFI_OVERLAY_DEFS.map((def) => def.id)
    expect(ids.every((id) => id.startsWith('hifi:'))).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('copies registry tags including auto yes tags', () => {
    for (const module of HIFI_WIDGETS) {
      const def = HIFI_OVERLAY_DEFS.find((item) => item.id === `hifi:${module.id}`)
      expect(def?.tags).toEqual(expect.arrayContaining(hifiWidgetTags(module)))
    }
  })

  it('resolves hifi ids to HifiWidgetHost', () => {
    const id = `hifi:${HIFI_WIDGETS[0].id}` as OverlayWidgetId
    expect(resolveWidgetComponent(id)).toBe(HifiWidgetHost)
  })

  it('smoke-renders several host modules without invalid text', () => {
    const defaults = createDefaultOverlaysConfigWithHifi()
    const samples = [
      HIFI_WIDGETS[0],
      HIFI_WIDGETS[Math.floor(HIFI_WIDGETS.length / 3)],
      HIFI_WIDGETS[Math.floor((HIFI_WIDGETS.length * 2) / 3)],
      HIFI_WIDGETS[HIFI_WIDGETS.length - 1]
    ]
    for (const module of samples) {
      const id = `hifi:${module.id}` as OverlayWidgetId
      const config = defaults.widgets[id] as OverlayWidgetConfig
      const html = renderToStaticMarkup(createElement(HifiWidgetHost, { snapshot: null, config }))
      expect(html.length, module.id).toBeGreaterThan(20)
      expect(html, module.id).not.toContain('NaN')
      expect(html, module.id).not.toContain('undefined')
    }
  })

  it('renders rev/RPM strip modules in the placed box instead of letterboxing defaults', () => {
    const config: OverlayWidgetConfig = {
      id: 'hifi:revlightsMustang' as OverlayWidgetId,
      enabled: true,
      locked: false,
      favorite: false,
      position: { x: 0, y: 0, width: 1000, height: 40 },
      opacity: 100,
      stylePreset: DEFAULT_OVERLAY_STYLE_PRESET,
      style: createDefaultOverlayStyle(),
      display: null,
      hifiModuleId: 'revlightsMustang'
    }

    const html = renderToStaticMarkup(createElement(HifiWidgetHost, { snapshot: null, config }))
    expect(html).toContain('viewBox="0 0 1000 40"')
  })
})
