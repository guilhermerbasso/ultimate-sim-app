// @vitest-environment jsdom
// Regression coverage for audit P1-03: the overlay compositor hid the legacy per-overlay
// windows and then rendered only the built-in widget registry. Custom overlays authored in
// the designer were pushed to it on `overlays:customState` and dropped on the floor, so
// turning the compositor on made every custom overlay disappear from the screen.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CompositorRoot } from './CompositorRoot'
import { createDefaultOverlaysConfigWithHifi } from './hifi-overlays'
import { createDefaultOverlayStyle, DEFAULT_OVERLAY_STYLE_PRESET } from '../../../shared/overlays'
import type { CustomOverlayDef, OverlaysConfig } from '../../../shared/overlays'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Listener = (payload: unknown) => void

const subscribers = new Map<string, Set<Listener>>()
let root: Root | null = null
let host: HTMLDivElement | null = null

function customOverlay(): CustomOverlayDef {
  return {
    id: 'custom:compositor-fixture',
    title: 'Compositor fixture',
    enabled: true,
    locked: false,
    favorite: false,
    hidden: false,
    position: { x: 40, y: 40, width: 320, height: 180 },
    opacity: 100,
    stylePreset: DEFAULT_OVERLAY_STYLE_PRESET,
    style: createDefaultOverlayStyle(),
    elements: []
  }
}

function overlaysConfig(): OverlaysConfig {
  const config = createDefaultOverlaysConfigWithHifi()
  for (const widget of Object.values(config.widgets)) {
    widget.enabled = false
    widget.hidden = false
  }
  const gearSpeed = config.widgets.gearSpeed
  gearSpeed.enabled = true
  gearSpeed.hidden = false
  gearSpeed.locked = false
  gearSpeed.position = { x: 400, y: 40, width: 320, height: 180 }
  return config
}

function installIpc(custom: CustomOverlayDef[]): void {
  const ipc = {
    subscribe: (channel: string, listener: Listener) => {
      const set = subscribers.get(channel) ?? new Set<Listener>()
      set.add(listener)
      subscribers.set(channel, set)
      return () => set.delete(listener)
    },
    invoke: (channel: string): Promise<unknown> => {
      if (channel === 'overlays:getConfig') return Promise.resolve(overlaysConfig())
      if (channel === 'overlays:listCustom') return Promise.resolve(custom)
      if (channel === 'telemetry:getLatest') return Promise.resolve(null)
      if (channel === 'overlays:getCustom') return Promise.resolve(custom[0] ?? null)
      return Promise.resolve(null)
    },
    send: () => undefined,
    on: () => () => undefined
  }
  ;(window as unknown as { ipc: unknown }).ipc = ipc
}

function mountCompositor(): void {
  // `displayFromUrl` reads the compositor window's query string; the main process always
  // supplies it, so the test has to as well.
  window.history.replaceState({}, '', '?displayId=1&displayX=0&displayY=0&displayWidth=1920&displayHeight=1080')
  host = document.createElement('div')
  document.body.appendChild(host)
  const created = createRoot(host)
  root = created
  act(() => {
    created.render(createElement(CompositorRoot))
  })
}

function layers(): Element[] {
  return Array.from(host?.querySelectorAll('main > section') ?? [])
}

async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

beforeEach(() => {
  subscribers.clear()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  if (host) host.remove()
  host = null
  delete (window as unknown as { ipc?: unknown }).ipc
  vi.restoreAllMocks()
})

describe('overlay compositor custom overlays', () => {
  it('renders custom overlays alongside the built-in widgets', async () => {
    installIpc([customOverlay()])
    mountCompositor()
    await flush()

    expect(layers().length, 'compositor dropped the custom overlay layer').toBe(2)
  })

  it('labels each layer so the compositor and the per-overlay windows can be compared', async () => {
    installIpc([customOverlay()])
    mountCompositor()
    await flush()

    const ids = layers().map((layer) => layer.getAttribute('data-compositor-layer'))
    expect(ids).toContain('gearSpeed')
    expect(ids).toContain('custom:compositor-fixture')
    const custom = host!.querySelector('[data-compositor-layer="custom:compositor-fixture"]')
    expect(custom?.getAttribute('data-compositor-layer-kind')).toBe('custom')
  })

  it('picks up custom overlays pushed after mount and skips hidden or disabled ones', async () => {
    installIpc([])
    mountCompositor()
    await flush()
    expect(layers().length).toBe(1)

    act(() => {
      for (const listener of subscribers.get('overlays:customState') ?? []) {
        listener([
          customOverlay(),
          { ...customOverlay(), id: 'custom:hidden', hidden: true },
          { ...customOverlay(), id: 'custom:disabled', enabled: false },
          { ...customOverlay(), id: 'custom:offscreen', position: { x: 9000, y: 9000, width: 10, height: 10 } }
        ])
      }
    })

    const ids = layers().map((layer) => layer.getAttribute('data-compositor-layer'))
    expect(ids).toEqual(['gearSpeed', 'custom:compositor-fixture'])
  })
})
