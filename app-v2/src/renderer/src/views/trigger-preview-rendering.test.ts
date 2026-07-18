import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_ALERTS_CONFIG } from '../../../shared/alerts'
import type { DashboardElement } from '../../../shared/dashboards'
import { createDefaultOverlaysConfigWithHifi } from '../overlay/hifi-overlays'
import { PREVIEW_SNAPSHOT } from '../dashboard/widgets/gt3-theme'
import { renderDashboardElement } from '../dashboard/DashboardRoot'
import {
  CanvasElementVisual
} from './dashboard/DashboardCanvasEditor'
import {
  ALL_VARIANTS,
  WidgetMini
} from './dashboard/widget-catalog'
import { OverlayRuntimePreview } from './OverlaysView'
import {
  ALL_OVERLAY_WIDGETS,
  mergeHifiOverlayItems
} from '../overlay/hifi-overlays'

const ALERT_WIDGET_ID = 'hifi:alert2WaterTempCritical'

function alertElement(): DashboardElement {
  return {
    id: 'embedded-alert',
    type: 'overlaywidget',
    widgetId: ALERT_WIDGET_ID,
    hifiModuleId: 'alert2WaterTempCritical',
    x: 0,
    y: 0,
    w: 360,
    h: 190,
    style: { background: 'transparent', borderWidth: 0, radius: 0 }
  }
}

function hifiAlertElement(
  id: string,
  moduleId: string,
  width: number,
  height: number
): DashboardElement {
  return {
    ...alertElement(),
    id: `embedded-${moduleId}`,
    widgetId: id as DashboardElement['widgetId'],
    hifiModuleId: moduleId,
    w: width,
    h: height
  }
}

describe('trigger-only editor rendering', () => {
  it('forces embedded hi-fi dashboard alerts on and preserves off behavior', () => {
    const element = alertElement()
    const runtime = renderToStaticMarkup(
      renderDashboardElement({
        element,
        snapshot: PREVIEW_SNAPSHOT,
        alertsConfig: DEFAULT_ALERTS_CONFIG
      })
    )
    const off = renderToStaticMarkup(
      renderDashboardElement({
        element,
        snapshot: PREVIEW_SNAPSHOT,
        preview: 'inert',
        alertsConfig: DEFAULT_ALERTS_CONFIG,
        forceTriggerActive: false
      })
    )
    const on = renderToStaticMarkup(
      renderDashboardElement({
        element,
        snapshot: PREVIEW_SNAPSHOT,
        preview: 'inert',
        alertsConfig: DEFAULT_ALERTS_CONFIG,
        forceTriggerActive: true
      })
    )
    expect(runtime).not.toContain('WATER')
    expect(runtime).not.toContain('data-trigger-preview-visible')
    expect(off).not.toContain('WATER')
    expect(on).toContain('WATER')
    expect(on).toContain('data-trigger-preview-visible="true"')
  })

  it('covers the shared Dashboard builder/editor visual path', () => {
    const element = alertElement()
    const off = renderToStaticMarkup(
      createElement(CanvasElementVisual, { element, showTriggerOnlyActive: false })
    )
    const on = renderToStaticMarkup(
      createElement(CanvasElementVisual, { element, showTriggerOnlyActive: true })
    )
    expect(off).not.toContain('WATER')
    expect(on).toContain('WATER')
  })

  it('renders low-fuel and shift previews even when their live policies are disabled', () => {
    const disabled = {
      ...DEFAULT_ALERTS_CONFIG,
      lowFuel: {
        ...DEFAULT_ALERTS_CONFIG.lowFuel,
        enabled: false,
        lapsThreshold: 7
      },
      shiftPoint: {
        ...DEFAULT_ALERTS_CONFIG.shiftPoint,
        enabled: false,
        shiftIndicatorPct: 0.8,
        rpmPct: 0.9
      }
    }
    const lowFuel = hifiAlertElement(
      'hifi:alertLowFuel',
      'alertLowFuel',
      360,
      200
    )
    const shift = hifiAlertElement(
      'hifi:alertShiftFlash',
      'alertShiftFlash',
      1200,
      80
    )
    const lowFuelOff = renderToStaticMarkup(
      renderDashboardElement({
        element: lowFuel,
        snapshot: PREVIEW_SNAPSHOT,
        preview: 'inert',
        alertsConfig: disabled,
        forceTriggerActive: false
      })
    )
    const lowFuelOn = renderToStaticMarkup(
      renderDashboardElement({
        element: lowFuel,
        snapshot: PREVIEW_SNAPSHOT,
        preview: 'inert',
        alertsConfig: disabled,
        forceTriggerActive: true
      })
    )
    const shiftOn = renderToStaticMarkup(
      renderDashboardElement({
        element: shift,
        snapshot: PREVIEW_SNAPSHOT,
        preview: 'inert',
        alertsConfig: disabled,
        forceTriggerActive: true
      })
    )
    const shiftOff = renderToStaticMarkup(
      renderDashboardElement({
        element: shift,
        snapshot: PREVIEW_SNAPSHOT,
        preview: 'inert',
        alertsConfig: disabled,
        forceTriggerActive: false
      })
    )

    expect(lowFuelOff).not.toContain('LAPS')
    expect(lowFuelOn).toContain('LAPS')
    expect(lowFuelOn).toContain('data-trigger-preview-visible="true"')
    expect(shiftOff).not.toContain('data-trigger-preview-visible')
    expect(shiftOn).toContain('data-trigger-preview-visible="true"')
  })

  it('keeps inert gallery thumbnails off unless explicitly enabled', () => {
    const variant = ALL_VARIANTS.find(
      (item) => item.id === 'hifi-alert2WaterTempCritical'
    )
    expect(variant).toBeDefined()
    const off = renderToStaticMarkup(
      createElement(WidgetMini, {
        variant: variant!,
        showTriggerOnlyActive: false
      })
    )
    const on = renderToStaticMarkup(
      createElement(WidgetMini, {
        variant: variant!,
        showTriggerOnlyActive: true
      })
    )
    expect(off).not.toContain('WATER')
    expect(on).toContain('WATER')
  })

  it('forces the Overlays editor card without changing its saved item', () => {
    const config = createDefaultOverlaysConfigWithHifi()
    const item = mergeHifiOverlayItems([], config).find(
      (entry) => entry.id === ALERT_WIDGET_ID
    )
    const definition = ALL_OVERLAY_WIDGETS.find(
      (entry) => entry.id === ALERT_WIDGET_ID
    )
    expect(item).toBeDefined()
    expect(definition).toBeDefined()
    const before = structuredClone(item)
    const neverItem = { ...item!, trigger: { kind: 'never' as const } }

    const off = renderToStaticMarkup(
      createElement(OverlayRuntimePreview, {
        item: item!,
        definition,
        fallback: 'Preview unavailable',
        alertsConfig: DEFAULT_ALERTS_CONFIG,
        showTriggerOnlyActive: false
      })
    )
    const on = renderToStaticMarkup(
      createElement(OverlayRuntimePreview, {
        item: item!,
        definition,
        fallback: 'Preview unavailable',
        alertsConfig: DEFAULT_ALERTS_CONFIG,
        showTriggerOnlyActive: true
      })
    )
    const forcedDespiteSavedNever = renderToStaticMarkup(
      createElement(OverlayRuntimePreview, {
        item: neverItem,
        definition,
        fallback: 'Preview unavailable',
        alertsConfig: DEFAULT_ALERTS_CONFIG,
        showTriggerOnlyActive: true
      })
    )

    expect(off).toContain('data-trigger-preview-visible="false"')
    expect(off).not.toContain('WATER')
    expect(on).toContain('data-trigger-preview-visible="true"')
    expect(on).toContain('WATER')
    expect(forcedDespiteSavedNever).toContain('WATER')
    expect(neverItem.trigger).toEqual({ kind: 'never' })
    expect(item).toEqual(before)
  })
})
