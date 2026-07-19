// @vitest-environment jsdom

import { createElement } from 'react'
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ALERTS_CONFIG } from '../../../shared/alerts'
import {
  OVERLAY_EDITOR_PREVIEW_CHANNELS,
  type OverlayEditorPreviewState
} from '../../../shared/overlay-editor-preview'
import type { OverlayGestureState, OverlayWidgetConfig } from '../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import { PREVIEW_SNAPSHOT } from '../dashboard/widgets/gt3-theme'
import { createDefaultOverlaysConfigWithHifi } from './hifi-overlays'
import { OverlayRoot } from './OverlayRoot'

type Listener = (payload: unknown) => void

describe('OverlayRoot positioning ghost integration', () => {
  afterEach(() => {
    cleanup()
    window.history.replaceState({}, '', '/')
  })

  it('shows an inactive trigger as a draggable/resizable ghost without changing runtime visibility', async () => {
    const widgetId = 'hifi:alertLowFuel'
    window.history.replaceState(
      {},
      '',
      `/overlay.html?widget=${encodeURIComponent(widgetId)}`
    )
    const config = createDefaultOverlaysConfigWithHifi()
    config.configMode = true
    const widget = {
      ...config.widgets[widgetId],
      locked: false
    } as OverlayWidgetConfig
    config.widgets[widgetId] = widget
    const triggerBefore = structuredClone(widget.trigger)
    const disabledAlerts = {
      ...DEFAULT_ALERTS_CONFIG,
      lowFuel: {
        ...DEFAULT_ALERTS_CONFIG.lowFuel,
        enabled: false,
        lapsThreshold: 8
      }
    }
    const inactiveSnapshot: TelemetrySnapshot = {
      ...PREVIEW_SNAPSHOT,
      fuelLiters: 80,
      fuelPerLap: 2,
      fuelPerLapLiters: 2,
      fuelLapsRemaining: 40
    }
    const listeners = new Map<string, Set<Listener>>()
    const emit = (channel: string, payload: unknown): void => {
      for (const listener of listeners.get(channel) ?? []) listener(payload)
    }
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'telemetry:getLatest') return inactiveSnapshot
      if (channel === 'overlays:getConfig') return config
      if (channel === 'alerts:getConfig') return disabledAlerts
      if (channel === 'overlays:beginGesture') {
        return {
          mode: args[1] as OverlayGestureState['mode'],
          dir: String(args[2] ?? ''),
          startPointer: { x: 0, y: 0 },
          basePosition: widget.position
        } satisfies OverlayGestureState
      }
      if (channel === 'overlays:setBoundsLiveFromGesture') return widget.position
      return null
    })
    const subscribe = vi.fn((channel: string, callback: Listener) => {
      const entries = listeners.get(channel) ?? new Set<Listener>()
      entries.add(callback)
      listeners.set(channel, entries)
      return () => {
        entries.delete(callback)
        if (entries.size === 0) listeners.delete(channel)
      }
    })
    Object.defineProperty(window, 'ipc', {
      configurable: true,
      value: { invoke, subscribe }
    })

    const { container } = render(createElement(OverlayRoot))
    await waitFor(() => {
      expect(
        invoke.mock.calls.some(
          ([channel, id, visible]) =>
            channel === 'overlays:setRuntimeVisibility' &&
            id === widgetId &&
            visible === false
        )
      ).toBe(true)
    })

    act(() => {
      emit('alerts:config', disabledAlerts)
      emit('overlays:configMode', { ...widget, configMode: true })
      emit(OVERLAY_EDITOR_PREVIEW_CHANNELS.state, {
        active: true
      } satisfies OverlayEditorPreviewState)
    })

    const ghost = await waitFor(() => {
      const node = container.querySelector<HTMLElement>(
        '[data-overlay-editor-ghost="true"]'
      )
      expect(node).not.toBeNull()
      return node!
    })
    expect(ghost.textContent).toContain('LAPS')
    expect(ghost.querySelector('.overlay-drag-handle')).not.toBeNull()
    expect(ghost.querySelectorAll('.overlay-resize')).toHaveLength(8)

    fireEvent.mouseDown(ghost, { button: 0 })
    await waitFor(() => {
      expect(
        invoke.mock.calls.some(
          ([channel, id, mode]) =>
            channel === 'overlays:beginGesture' &&
            id === widgetId &&
            mode === 'move'
        )
      ).toBe(true)
    })
    fireEvent.mouseUp(document)

    const resize = ghost.querySelector<HTMLElement>('.overlay-resize.se')!
    fireEvent.mouseDown(resize, { button: 0 })
    await waitFor(() => {
      expect(
        invoke.mock.calls.some(
          ([channel, id, mode, dir]) =>
            channel === 'overlays:beginGesture' &&
            id === widgetId &&
            mode === 'resize' &&
            dir === 'se'
        )
      ).toBe(true)
    })
    fireEvent.mouseUp(document)

    const runtimeVisibilityCalls = invoke.mock.calls.filter(
      ([channel]) => channel === 'overlays:setRuntimeVisibility'
    )
    expect(runtimeVisibilityCalls.length).toBeGreaterThan(0)
    expect(runtimeVisibilityCalls.every(([, , visible]) => visible === false)).toBe(true)
    expect(
      invoke.mock.calls.some(
        ([channel]) =>
          channel === 'overlays:setConfig' ||
          channel.includes('compositor') ||
          channel === 'overlays:toggle'
      )
    ).toBe(false)
    expect(widget.trigger).toEqual(triggerBefore)

    act(() => {
      emit(OVERLAY_EDITOR_PREVIEW_CHANNELS.state, {
        active: false
      } satisfies OverlayEditorPreviewState)
    })
    await waitFor(() => {
      expect(
        container.querySelector('[data-overlay-editor-ghost="true"]')
      ).toBeNull()
    })
  })
})
