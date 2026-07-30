// Regression coverage for audit P1-19: `scaleMode` had no canonical default. The runtime
// renderer fell back to `stretch`, the structural fingerprint fell back to `fit`, and the
// editor kept a third, private copy of the constant. A dashboard saved before `scaleMode`
// existed therefore rendered stretched but was fingerprinted as if it were letterboxed,
// so identity comparisons disagreed with what the driver actually saw.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DASHBOARD_SCALE_MODE,
  resolveDashboardScaleMode,
  type Dashboard
} from '../../../shared/dashboards'
import { createDashboardFingerprint } from '../../../shared/visual-pipeline/structural'
import { resolveDashboardCanvasRenderModel } from './DashboardRoot'

function legacyDashboard(): Dashboard {
  // A dashboard persisted before `scaleMode` was introduced.
  return {
    id: 'legacy-no-scale-mode',
    name: 'Legacy',
    width: 1024,
    height: 600,
    bg: '#000',
    elements: [{ id: 'gauge-1', type: 'gauge', x: 10, y: 10, w: 200, h: 200, style: {} }]
  }
}

function canonicalScaleMode(dashboard: Dashboard): string {
  const canonical = JSON.parse(createDashboardFingerprint(dashboard).canonical) as {
    canvas: { scaleMode: string }
  }
  return canonical.canvas.scaleMode
}

describe('dashboard scale mode default', () => {
  it('exports one canonical default', () => {
    expect(DEFAULT_DASHBOARD_SCALE_MODE).toBe('stretch')
    expect(resolveDashboardScaleMode(legacyDashboard())).toBe(DEFAULT_DASHBOARD_SCALE_MODE)
  })

  it('keeps an explicit scale mode untouched', () => {
    expect(resolveDashboardScaleMode({ ...legacyDashboard(), scaleMode: 'fit' })).toBe('fit')
    expect(resolveDashboardScaleMode({ ...legacyDashboard(), scaleMode: 'fill' })).toBe('fill')
  })

  it('tolerates a missing or malformed dashboard', () => {
    expect(resolveDashboardScaleMode(null)).toBe(DEFAULT_DASHBOARD_SCALE_MODE)
    expect(resolveDashboardScaleMode({ scaleMode: 'nonsense' as never })).toBe(DEFAULT_DASHBOARD_SCALE_MODE)
  })

  // The defect: the renderer and the fingerprint disagreed for a dashboard with no
  // explicit scale mode, so identity was computed against a layout nobody ever saw.
  it('renders and fingerprints a legacy dashboard with the same scale mode', () => {
    const dashboard = legacyDashboard()
    const rendered = resolveDashboardCanvasRenderModel(dashboard).scaleMode
    expect(canonicalScaleMode(dashboard), 'fingerprint disagrees with the renderer').toBe(rendered)
    expect(rendered).toBe(DEFAULT_DASHBOARD_SCALE_MODE)
  })

  it('agrees for every explicit scale mode too', () => {
    for (const scaleMode of ['fit', 'fill', 'stretch'] as const) {
      const dashboard = { ...legacyDashboard(), scaleMode }
      expect(canonicalScaleMode(dashboard), scaleMode).toBe(
        resolveDashboardCanvasRenderModel(dashboard).scaleMode
      )
    }
  })
})
