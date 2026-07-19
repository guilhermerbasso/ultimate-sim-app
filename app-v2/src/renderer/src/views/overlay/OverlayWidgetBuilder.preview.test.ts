// @vitest-environment jsdom

import { createElement } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ALERTS_CONFIG } from '../../../../shared/alerts'
import type { DashboardElement } from '../../../../shared/dashboards'
import { RuntimeWidgetPreview } from './OverlayWidgetBuilder'

describe('OverlayWidgetBuilder hi-fi fallback preview', () => {
  afterEach(() => cleanup())

  it('resolves hifiModuleId-only alerts as inert forced previews with zero IPC', () => {
    const invoke = vi.fn()
    const subscribe = vi.fn()
    Object.defineProperty(window, 'ipc', {
      configurable: true,
      value: { invoke, subscribe }
    })
    const element: DashboardElement = {
      id: 'hifi-module-only',
      type: 'overlaywidget',
      hifiModuleId: 'alertLowFuel',
      x: 12,
      y: 18,
      w: 360,
      h: 200,
      style: {
        background: 'transparent',
        borderWidth: 0,
        radius: 0
      }
    }
    const disabledLiveConfig = {
      ...DEFAULT_ALERTS_CONFIG,
      lowFuel: {
        ...DEFAULT_ALERTS_CONFIG.lowFuel,
        enabled: false,
        lapsThreshold: 7
      }
    }

    const view = render(
      createElement(RuntimeWidgetPreview, {
        element,
        showTriggerOnlyActive: false,
        alertsConfig: disabledLiveConfig
      })
    )
    expect(view.container.textContent).not.toContain('LAPS')

    view.rerender(
      createElement(RuntimeWidgetPreview, {
        element,
        showTriggerOnlyActive: true,
        alertsConfig: disabledLiveConfig
      })
    )

    expect(view.container.textContent).toContain('LAPS')
    expect(
      view.container.querySelector('[data-trigger-preview-visible="true"]')
    ).not.toBeNull()
    expect(view.container.textContent).not.toContain('Hi-fi widget unavailable')
    expect(element.widgetId).toBeUndefined()
    expect(disabledLiveConfig.lowFuel).toMatchObject({
      enabled: false,
      lapsThreshold: 7
    })
    expect(invoke).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
  })
})
