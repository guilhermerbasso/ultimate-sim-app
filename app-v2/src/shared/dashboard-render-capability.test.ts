// Contract snapshot for the dashboard render-capability manifest.
//
// The audit's finding was that runtime / editor / compositor / browser / preview drifted
// apart with nothing pinning them together. These tests are that pin:
//   1. every declared IPC-sourced widget id exists in the overlay widget registry;
//   2. every overlay widget source that touches `window.ipc` guards it AND declares itself
//      in the manifest, so nothing can silently start throwing in a browser source again;
//   3. the inert gallery path and the stream capability check read the same manifest.

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  DASHBOARD_RENDER_ENVIRONMENTS,
  IPC_SOURCED_ELEMENT_TYPES,
  IPC_SOURCED_OVERLAY_WIDGET_IDS,
  dashboardStreamBlockReason,
  dashboardStreamCompatibility,
  environmentHasIpc,
  isIpcSourcedElementType,
  isIpcSourcedOverlayWidgetId
} from './dashboard-render-capability'
import { ALL_OVERLAY_WIDGETS } from '../renderer/src/overlay/hifi-overlays'
import type { Dashboard, DashboardElement } from './dashboards'

const WIDGET_DIR = join(__dirname, '..', 'renderer', 'src', 'overlay', 'widgets')

function element(partial: Partial<DashboardElement> & Pick<DashboardElement, 'id' | 'type'>): DashboardElement {
  return { x: 0, y: 0, w: 10, h: 10, style: {}, ...partial }
}

function dashboardWith(elements: DashboardElement[]): Dashboard {
  return { id: 'capability-fixture', name: 'Capability fixture', width: 1024, height: 600, bg: '#000', elements }
}

describe('dashboard render capability manifest', () => {
  it('covers the five environments and marks only Electron ones as IPC-capable', () => {
    expect([...DASHBOARD_RENDER_ENVIRONMENTS]).toEqual([
      'runtime', 'editor', 'compositor', 'browser', 'preview'
    ])
    expect(DASHBOARD_RENDER_ENVIRONMENTS.filter(environmentHasIpc)).toEqual([
      'runtime', 'editor', 'compositor'
    ])
    expect(environmentHasIpc('browser')).toBe(false)
    expect(environmentHasIpc('preview')).toBe(false)
  })

  it('declares only widget ids that the overlay registry actually resolves', () => {
    const registered = new Set(ALL_OVERLAY_WIDGETS.map((definition) => definition.id as string))
    const unknown = IPC_SOURCED_OVERLAY_WIDGET_IDS.filter((id) => !registered.has(id))
    expect(unknown).toEqual([])
  })

  it('derives IPC-sourced element types from the canonical element manifest', () => {
    expect(IPC_SOURCED_ELEMENT_TYPES.length).toBeGreaterThan(0)
    expect(isIpcSourcedElementType('map')).toBe(true)
    expect(isIpcSourcedElementType('engineer-feed')).toBe(true)
    expect(isIpcSourcedElementType('coach-tips')).toBe(true)
    expect(isIpcSourcedElementType('pred-fuel-margin-minimal')).toBe(true)
    expect(isIpcSourcedElementType('gauge')).toBe(false)
    expect(isIpcSourcedOverlayWidgetId('teamFuel')).toBe(true)
    expect(isIpcSourcedOverlayWidgetId('gearSpeed')).toBe(false)
  })

  // The contract snapshot. Any overlay widget that reaches for `window.ipc` must both
  // guard the access (so a browser source renders instead of throwing) and declare itself
  // in the manifest (so the stream capability check knows it degrades).
  it('keeps every window.ipc overlay widget guarded and declared', () => {
    const declared = new Set<string>(IPC_SOURCED_OVERLAY_WIDGET_IDS)
    const index = readFileSync(join(WIDGET_DIR, 'index.ts'), 'utf8')

    // component name -> source file, from the import statements.
    const fileByComponent = new Map<string, string>()
    for (const match of index.matchAll(/import\s*(?:type\s*)?\{([^}]+)\}\s*from\s*'\.\/([\w-]+)'/g)) {
      for (const name of match[1].split(',').map((part) => part.trim().split(/\s+as\s+/).pop()!.trim())) {
        if (name) fileByComponent.set(name, `${match[2]}.tsx`)
      }
    }

    // widget id -> component name, from WIDGET_COMPONENTS.
    const mapBody = index.slice(index.indexOf('export const WIDGET_COMPONENTS'))
    const componentById = new Map<string, string>()
    for (const match of mapBody.matchAll(/^\s{2}'?([A-Za-z0-9:_-]+)'?:\s*([A-Za-z0-9_]+),?\s*$/gm)) {
      componentById.set(match[1], match[2])
    }
    expect(componentById.size, 'failed to parse WIDGET_COMPONENTS').toBeGreaterThan(20)

    const sourceCache = new Map<string, string>()
    const readWidget = (file: string): string => {
      if (!sourceCache.has(file)) sourceCache.set(file, readFileSync(join(WIDGET_DIR, file), 'utf8'))
      return sourceCache.get(file)!
    }

    // 1. Nothing in the widget folder may dereference window.ipc directly.
    const unguarded = readdirSync(WIDGET_DIR)
      .filter((name) => name.endsWith('.tsx'))
      .filter((name) => /window\.ipc\s*\./.test(readWidget(name)))
    expect(unguarded, 'overlay widgets dereference window.ipc without a guard').toEqual([])

    // 2. Every registered widget that touches IPC must be declared in the manifest.
    const undeclared: string[] = []
    for (const [id, component] of componentById) {
      const file = fileByComponent.get(component)
      if (!file) continue
      if (!readWidget(file).includes('window.ipc')) continue
      if (!declared.has(id)) undeclared.push(`${id} (${file})`)
    }
    expect(undeclared, 'overlay widgets use IPC but are missing from the manifest').toEqual([])
  })
})

describe('dashboardStreamCompatibility', () => {
  it('reports ok for a snapshot-only dashboard', () => {
    const result = dashboardStreamCompatibility(dashboardWith([
      element({ id: 'a', type: 'gauge' }),
      element({ id: 'b', type: 'shiftlights' })
    ]))
    expect(result.status).toBe('ok')
    expect(result.degraded).toEqual([])
    expect(result.unsupported).toEqual([])
  })

  it('reports degraded for IPC-sourced element types and overlay widgets', () => {
    const result = dashboardStreamCompatibility(dashboardWith([
      element({ id: 'a', type: 'gauge' }),
      element({ id: 'map', type: 'map' }),
      element({ id: 'fuel', type: 'overlaywidget', widgetId: 'teamFuel' })
    ]))
    expect(result.status).toBe('degraded')
    expect(result.unsupported).toEqual([])
    expect(result.degraded.map((entry) => entry.elementId).sort()).toEqual(['fuel', 'map'])
    expect(dashboardStreamBlockReason(dashboardWith([element({ id: 'map', type: 'map' })]))).toBeNull()
  })

  it('does not flag hi-fi overlay widgets, which render from the snapshot', () => {
    const result = dashboardStreamCompatibility(dashboardWith([
      element({ id: 'hifi', type: 'overlaywidget', widgetId: 'hifi:speedGear', hifiModuleId: 'speedGear' })
    ]))
    expect(result.status).toBe('ok')
  })

  it('blocks a dashboard that declares an unsupported widget', () => {
    const dashboard = dashboardWith([
      element({ id: 'a', type: 'gauge' }),
      element({ id: 'broken', type: 'overlaywidget', widgetId: 'teamFuel' })
    ])
    const options = { overlayWidgetSupport: { teamFuel: 'unsupported' as const } }
    const result = dashboardStreamCompatibility(dashboard, options)
    expect(result.status).toBe('unsupported')
    expect(result.unsupported.map((entry) => entry.elementId)).toEqual(['broken'])
    expect(dashboardStreamBlockReason(dashboard, options)).toContain('cannot be streamed')
    expect(dashboardStreamBlockReason(dashboard, options)).toContain('teamFuel')
  })

  it('tolerates an empty or missing dashboard', () => {
    expect(dashboardStreamCompatibility(null).status).toBe('ok')
    expect(dashboardStreamCompatibility(dashboardWith([])).status).toBe('ok')
  })
})
