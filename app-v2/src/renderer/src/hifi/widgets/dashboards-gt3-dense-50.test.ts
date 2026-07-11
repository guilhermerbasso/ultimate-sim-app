import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GT3_DENSE_50_PRESETS } from '../../../../shared/dashboards-gt3-dense-50'
import { PREVIEW_SNAPSHOT } from '../../dashboard/widgets/gt3-theme'
import { HIFI_WIDGETS_BY_ID } from './registry'

describe('GT3 dense 50 widget resolution', () => {
  it('resolves and renders every referenced hi-fi widget with preview telemetry', () => {
    const moduleIds = new Set(
      GT3_DENSE_50_PRESETS.flatMap((preset) =>
        preset.build().elements.map((element) => element.hifiModuleId as string)
      )
    )
    for (const moduleId of moduleIds) {
      const module = HIFI_WIDGETS_BY_ID[moduleId]
      expect(module, `hifi:${moduleId}`).toBeDefined()
      const markup = renderToStaticMarkup(
        module.render({
          snapshot: PREVIEW_SNAPSHOT,
          width: module.defaultSize.w,
          height: module.defaultSize.h
        })
      )
      expect(markup.length, moduleId).toBeGreaterThan(20)
      expect(markup, moduleId).not.toContain('NaN')
    }
  })
})
