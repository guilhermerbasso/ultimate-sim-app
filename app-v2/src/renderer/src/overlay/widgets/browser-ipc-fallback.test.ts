// @vitest-environment jsdom
// Browser-source regression guard for P1-04.
//
// Streamed dashboards are rendered by the same canonical renderer in a plain browser
// (OBS browser source), where `window.ipc` does not exist. Overlay widgets that reached
// for `window.ipc` unconditionally threw `Cannot read properties of undefined (reading
// 'subscribe')` and took the whole stream overlay down with them. These tests render the
// IPC-sourced widgets with no `window.ipc` at all and assert they still produce a frame.

import { afterEach, describe, expect, it } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { createElement } from 'react'
import { TeamFuelWidget } from './TeamFuelWidget'
import { TireWearWidget } from './TireWearWidget'
import { CustomValueWidget } from './CustomValueWidget'
import type { OverlayWidgetConfig } from '../../../../shared/overlays'
import { IPC_SOURCED_OVERLAY_WIDGET_IDS } from '../../../../shared/dashboard-render-capability'

const config = {
  id: 'teamFuel',
  enabled: true,
  locked: false,
  position: { x: 0, y: 0, width: 420, height: 190 }
} as unknown as OverlayWidgetConfig

let root: Root | null = null
let host: HTMLDivElement | null = null

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function renderWithoutIpc(node: ReturnType<typeof createElement>): string {
  delete (window as unknown as { ipc?: unknown }).ipc
  host = document.createElement('div')
  document.body.appendChild(host)
  const created = createRoot(host)
  root = created
  act(() => {
    created.render(node)
  })
  return host.innerHTML
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  if (host) host.remove()
  host = null
})

describe('IPC-sourced overlay widgets in a plain browser', () => {
  it('renders Team Fuel without window.ipc', () => {
    const html = renderWithoutIpc(createElement(TeamFuelWidget, { snapshot: null, config }))
    expect(html).toContain('<svg')
  })

  it('renders Tyre Wear without window.ipc', () => {
    const html = renderWithoutIpc(createElement(TireWearWidget, { snapshot: null, config }))
    expect(html).toContain('<svg')
  })

  it('renders Custom Value without window.ipc', () => {
    const html = renderWithoutIpc(createElement(CustomValueWidget, { snapshot: null, config }))
    expect(html.length).toBeGreaterThan(0)
  })

  it('keeps the browser-degraded widgets listed in the shared manifest', () => {
    expect(IPC_SOURCED_OVERLAY_WIDGET_IDS).toContain('teamFuel')
    expect(IPC_SOURCED_OVERLAY_WIDGET_IDS).toContain('tireWear')
    expect(IPC_SOURCED_OVERLAY_WIDGET_IDS).toContain('customValue')
  })
})
