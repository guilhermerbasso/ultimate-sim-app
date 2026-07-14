import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ExpressionStudioSnapshot } from '../../../../shared/expression-studio'
import { ExpressionDestinationPreview, ExpressionVisualizationPanel } from './ExpressionVisualizationPanel'

const studio: ExpressionStudioSnapshot = {
  version: 3,
  revision: 1,
  expressions: [{ id: 'expr-1', name: 'Speed warning', expr: 'speedKmh > 200' }],
  enabledVars: [],
  outputs: [],
  destinations: [],
  updatedAt: '2026-07-14T00:00:00.000Z',
  capabilities: [],
  destinationStatuses: []
}

describe('ExpressionsView visualization UI', () => {
  it('renders the real dashboard value/bar/gauge/status components as inert previews', () => {
    for (const presentation of ['value', 'bar', 'gauge', 'status'] as const) {
      const format = presentation === 'bar' || presentation === 'gauge'
        ? { label: presentation, min: 0, max: 300 }
        : presentation === 'status'
          ? { label: presentation, trueText: 'WARN', falseText: 'OK' }
          : { label: presentation, decimals: 1 }
      const html = renderToStaticMarkup(createElement(ExpressionDestinationPreview, {
        studio,
        destination: {
          id: `dest-${presentation}`,
          source: { expressionId: 'expr-1' },
          surface: 'dashboard',
          targetId: 'dash',
          presentation,
          geometry: { x: 0, y: 0, width: 280, height: 130 },
          format,
          enabled: true
        }
      }))
      expect(html).toContain('data-testid="expression-destination-preview"')
      expect(html).toContain('dash-element')
      expect(html).not.toContain('button')
      expect(html).not.toContain('input')
    }
  })

  it('shows exact target selection, honest unavailable surfaces, saved status, and Open in editor', () => {
    const destination = {
      id: 'dest-value',
      source: { expressionId: 'expr-1' } as const,
      surface: 'dashboard' as const,
      targetId: 'dash-exact',
      presentation: 'value' as const,
      geometry: { x: 0, y: 0, width: 280, height: 130 },
      format: { label: 'Speed warning', decimals: 1 },
      enabled: true
    }
    const snapshot: ExpressionStudioSnapshot = {
      ...studio,
      destinations: [destination],
      capabilities: [
        {
          surface: 'dashboard',
          available: true,
          presentations: ['value', 'bar', 'gauge', 'status'],
          targets: [{ id: 'dash-exact', label: 'Race', width: 1024, height: 600, kind: 'dashboard' }]
        },
        {
          surface: 'overlay',
          available: true,
          presentations: ['value', 'bar', 'gauge', 'status'],
          targets: [{ id: 'custom:exact', label: 'HUD', width: 960, height: 320, kind: 'custom-overlay' }]
        },
        { surface: 'oled', available: false, reason: 'OLED safely deferred.', presentations: [], targets: [] },
        { surface: 'touch', available: false, reason: 'Touch safely deferred.', presentations: [], targets: [] }
      ],
      destinationStatuses: [{ destinationId: destination.id, status: 'ready' }]
    }
    const html = renderToStaticMarkup(createElement(ExpressionVisualizationPanel, {
      studio: snapshot,
      source: { expressionId: 'expr-1' },
      onCommit: async () => undefined,
      onClose: () => undefined
    }))

    expect(html).toContain('Exact target')
    expect(html).toContain('dash-exact')
    expect(html).toContain('OLED safely deferred.')
    expect(html).toContain('Touch safely deferred.')
    expect(html).toContain('Open in editor')
    expect(html).toContain('ready')
  })
})
