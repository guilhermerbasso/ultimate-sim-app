// @vitest-environment jsdom

import { Fragment, createElement } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ALERTS_CONFIG } from '../../../shared/alerts'
import {
  ALL_OVERLAY_WIDGETS,
  createDefaultOverlaysConfigWithHifi,
  mergeHifiOverlayItems
} from '../overlay/hifi-overlays'
import { OverlayRuntimePreview } from './OverlaysView'

describe('OverlaysView mounted hi-fi card previews', () => {
  afterEach(() => cleanup())

  it('mounts Coach, Engineer, and Alerts cards through the inert host with zero live IPC', () => {
    const invoke = vi.fn(async () => null)
    const subscribe = vi.fn(() => () => {})
    Object.defineProperty(window, 'ipc', {
      configurable: true,
      value: { invoke, subscribe }
    })

    const representativeIds = new Set([
      'hifi:coachTip',
      'hifi:engineerRadio',
      'hifi:alert2WaterTempCritical'
    ])
    const items = mergeHifiOverlayItems(
      [],
      createDefaultOverlaysConfigWithHifi()
    ).filter((item) => representativeIds.has(item.id))
    const definitions = new Map(
      ALL_OVERLAY_WIDGETS.map((definition) => [definition.id, definition])
    )

    const view = render(
      createElement(
        Fragment,
        null,
        ...items.map((item) =>
          createElement(OverlayRuntimePreview, {
            key: item.id,
            item,
            definition: definitions.get(item.id),
            fallback: 'Preview unavailable',
            alertsConfig: DEFAULT_ALERTS_CONFIG,
            showTriggerOnlyActive: true
          })
        )
      )
    )

    expect(items).toHaveLength(representativeIds.size)
    expect(
      view.container.querySelectorAll(
        '[data-overlay-card-hifi-preview="inert"]'
      )
    ).toHaveLength(items.length)
    expect(invoke).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
  })
})
