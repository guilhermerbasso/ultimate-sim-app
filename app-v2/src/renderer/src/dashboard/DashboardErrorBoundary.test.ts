// @vitest-environment jsdom

import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { DashboardElement } from '../../../shared/dashboards'
import { UnitSystemProvider } from '../lib/units'
import { DashboardErrorBoundary } from './DashboardErrorBoundary'
import { renderDashboardElement } from './DashboardRoot'

function renderMalformed(element: DashboardElement): void {
  render(createElement(
    DashboardErrorBoundary,
    null,
    createElement(
      UnitSystemProvider,
      { initialUnitSystem: 'metric' },
      renderDashboardElement({ element, snapshot: null })
    )
  ))
}

describe('DashboardErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows a visible fallback when a malformed overlay identity throws', () => {
    renderMalformed({
      id: 'bad-overlay',
      type: 'overlaywidget',
      x: 0,
      y: 0,
      w: 320,
      h: 180,
      style: {},
      widgetId: 42
    } as unknown as DashboardElement)

    expect(screen.getByRole('alert').textContent).toContain('Dashboard renderer failed')
  })

  it('shows a visible fallback when malformed table columns throw', () => {
    renderMalformed({
      id: 'bad-table',
      type: 'table',
      x: 0,
      y: 0,
      w: 320,
      h: 180,
      style: { tableColumns: 'pos' }
    } as unknown as DashboardElement)

    expect(screen.getByRole('alert').textContent).toContain('Dashboard renderer failed')
  })
})
