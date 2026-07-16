import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Dashboard, DashboardElement, DashboardPlaylistItem } from '../../shared/dashboards'
import { BUILTIN_PRESETS, DASHBOARD_ELEMENT_TYPES } from '../../shared/dashboards'
import { buttonPanelPlaylistItem } from '../../shared/touch-panel'
import type { ModuleContext } from '../module-context'
import {
  DashboardManager,
  openablePlaylistItems,
  resolveCycleStep,
  sameCockpitTarget,
  touchPanelIdOf
} from './manager'

vi.mock('electron', () => ({
  BrowserWindow: class {},
  dialog: {},
  screen: {
    on: vi.fn(),
    off: vi.fn(),
    getAllDisplays: vi.fn(() => []),
    getPrimaryDisplay: vi.fn(() => ({
      id: 1,
      label: 'Primary',
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      scaleFactor: 1
    }))
  },
  shell: { openExternal: vi.fn() }
}))

vi.mock('../modules/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn() }
}))

// Regression coverage for the "touch panels dead in the playlist" blocker. The
// pure routing helpers below are what the DashboardManager uses to keep + route
// touch-panel items instead of filtering them out against the dashboard store.

const dash = (id: string): DashboardPlaylistItem => ({ dashboardId: id })
const panel = (id: string): DashboardPlaylistItem => buttonPanelPlaylistItem(id)

describe('touchPanelIdOf', () => {
  it('prefers touchPanelId, falling back to dashboardId', () => {
    expect(touchPanelIdOf({ dashboardId: 'p1', touchPanelId: 'p1', kind: 'touch-panel' })).toBe('p1')
    expect(touchPanelIdOf({ dashboardId: 'p2', kind: 'touch-panel' })).toBe('p2')
  })
})

describe('openablePlaylistItems', () => {
  const items = [dash('d1'), panel('p1'), dash('missing'), panel('gone')]
  const hasDashboard = (id: string): boolean => id === 'd1'
  const hasTouchPanel = (id: string): boolean => id === 'p1'

  it('keeps dashboards that exist AND touch panels that exist', () => {
    const kept = openablePlaylistItems(items, hasDashboard, hasTouchPanel)
    expect(kept.map((i) => i.dashboardId)).toEqual(['d1', 'p1'])
  })

  it('does NOT drop a touch panel just because it is not a known dashboard', () => {
    // The bug: filtering every item against the dashboard store removed panels.
    const kept = openablePlaylistItems([panel('p1')], () => false, hasTouchPanel)
    expect(kept).toHaveLength(1)
    expect(kept[0].kind).toBe('touch-panel')
  })

  it('drops touch panels whose panel id no longer exists', () => {
    const kept = openablePlaylistItems([panel('gone')], hasDashboard, () => false)
    expect(kept).toHaveLength(0)
  })
})

describe('sameCockpitTarget', () => {
  it('treats any two touch panels as the same (single reused window)', () => {
    expect(sameCockpitTarget(panel('a'), panel('b'))).toBe(true)
  })
  it('treats same dashboard id as same, different ids as different', () => {
    expect(sameCockpitTarget(dash('d1'), dash('d1'))).toBe(true)
    expect(sameCockpitTarget(dash('d1'), dash('d2'))).toBe(false)
  })
  it('treats a dashboard and a touch panel as different', () => {
    expect(sameCockpitTarget(dash('d1'), panel('p1'))).toBe(false)
  })
})

describe('resolveCycleStep', () => {
  const items = [dash('d1'), panel('p1'), dash('d2')]

  it('opens the first item when nothing is open', () => {
    const step = resolveCycleStep(items, -1, () => false, 'next')
    expect(step).not.toBeNull()
    expect(step!.current).toBeNull()
    expect(step!.nextIndex).toBe(0)
    expect(step!.next).toEqual(items[0])
  })

  it('advances to the next item — including a touch panel — and reports the one to close', () => {
    const step = resolveCycleStep(items, 0, (i) => i.dashboardId === 'd1', 'next')
    expect(step!.currentIndex).toBe(0)
    expect(step!.current).toEqual(dash('d1'))
    expect(step!.nextIndex).toBe(1)
    expect(step!.next.kind).toBe('touch-panel')
    expect(touchPanelIdOf(step!.next)).toBe('p1')
  })

  it('routes forward FROM an open touch panel to the following dashboard', () => {
    const step = resolveCycleStep(items, 1, (i) => i.kind === 'touch-panel', 'next')
    expect(step!.current!.kind).toBe('touch-panel')
    expect(step!.nextIndex).toBe(2)
    expect(step!.next).toEqual(dash('d2'))
  })

  it('wraps around with prev', () => {
    const step = resolveCycleStep(items, 0, (i) => i.dashboardId === 'd1', 'prev')
    expect(step!.nextIndex).toBe(2)
    expect(step!.next).toEqual(dash('d2'))
  })

  it('recovers the index when the tracked item is no longer open', () => {
    // currentIndex points at d1 but the actually-open item is the touch panel.
    const step = resolveCycleStep(items, 0, (i) => i.kind === 'touch-panel', 'next')
    expect(step!.currentIndex).toBe(1)
    expect(step!.nextIndex).toBe(2)
  })

  it('returns null for an empty playlist', () => {
    expect(resolveCycleStep([], -1, () => false, 'next')).toBeNull()
  })
})

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

interface DashboardManagerInternals {
  dashboards: Map<string, Dashboard>
  registerScreenListeners(): void
}

function managerInternals(manager: DashboardManager): DashboardManagerInternals {
  return manager as unknown as DashboardManagerInternals
}

function makeHeadlessManager(userData: string, handlers = new Map<string, IpcHandler>()): DashboardManager {
  const manager = new DashboardManager({
    app: { getPath: () => userData },
    ipcMain: {
      handle: (channel: string, handler: IpcHandler) => {
        handlers.set(channel, handler)
      }
    },
    broadcast: () => {},
    telemetryHub: { getLatest: () => null },
    getMainWindow: () => null
  } as unknown as ModuleContext)
  managerInternals(manager).registerScreenListeners = () => {}
  return manager
}

function raceTrafficAttack(): Dashboard {
  const preset = BUILTIN_PRESETS.find((candidate) => candidate.id === 'gt3_dense50_race_traffic_attack')
  if (!preset) throw new Error('Race Traffic Attack preset is missing')
  return preset.build()
}

function persistDashboard(userData: string, dashboard: Dashboard): { path: string; raw: string } {
  const store = join(userData, 'dashboards')
  mkdirSync(store, { recursive: true })
  const path = join(store, `${dashboard.id}.json`)
  const raw = JSON.stringify(dashboard, null, 2)
  writeFileSync(path, raw, 'utf8')
  return { path, raw }
}

describe('DashboardManager restart restoration', () => {
  let userData: string

  beforeEach(() => {
    userData = mkdtempSync(join(process.cwd(), 'dashboard-restart-test-'))
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  it('restores Race Traffic Attack overlay widgets without rewriting persisted data', async () => {
    const dashboard = raceTrafficAttack()
    const stored = persistDashboard(userData, dashboard)
    const manager = makeHeadlessManager(userData)

    const firstLoad = manager.load()
    expect(manager.load()).toBe(firstLoad)
    await firstLoad

    const restored = manager.getDashboard(dashboard.id)
    expect(restored?.elements).toHaveLength(18)
    expect(restored?.elements.map((element) => ({
      type: element.type,
      widgetId: element.widgetId,
      hifiModuleId: element.hifiModuleId
    }))).toEqual(dashboard.elements.map((element) => ({
      type: element.type,
      widgetId: element.widgetId,
      hifiModuleId: element.hifiModuleId
    })))
    expect(readFileSync(stored.path, 'utf8')).toBe(stored.raw)

    const restarted = makeHeadlessManager(userData)
    await restarted.load()
    expect(restarted.getDashboard(dashboard.id)?.elements).toHaveLength(18)
  })

  it('accepts every element type from the shared dashboard schema after a JSON restart', async () => {
    const dashboard: Dashboard = {
      id: 'all-shared-element-types',
      name: 'All shared element types',
      width: 1024,
      height: 600,
      bg: '#000',
      elements: DASHBOARD_ELEMENT_TYPES.map((type, index): DashboardElement => ({
        id: `element-${index}`,
        type,
        x: index,
        y: 0,
        w: 1,
        h: 1,
        style: {},
        ...(type === 'overlaywidget'
          ? { widgetId: 'hifi:speedGear', hifiModuleId: 'speedGear' }
          : {})
      }))
    }
    persistDashboard(userData, dashboard)

    const manager = makeHeadlessManager(userData)
    await manager.load()

    expect(manager.getDashboard(dashboard.id)?.elements.map((element) => element.type))
      .toEqual([...DASHBOARD_ELEMENT_TYPES])
  })

  it('waits for persisted dashboards to load before answering renderer bootstrap IPC', async () => {
    const handlers = new Map<string, IpcHandler>()
    const manager = makeHeadlessManager(userData, handlers)
    const dashboard = raceTrafficAttack()
    let releaseLoad!: () => void
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve
    })
    manager.load = async () => {
      await loadGate
      managerInternals(manager).dashboards.set(dashboard.id, dashboard)
    }
    manager.registerIpc()

    const getDashboard = handlers.get('app:dash:get')
    if (!getDashboard) throw new Error('app:dash:get handler was not registered')
    let settled = false
    const pending = Promise.resolve(getDashboard({}, dashboard.id)).then((value) => {
      settled = true
      return value
    })

    await Promise.resolve()
    expect(settled).toBe(false)
    releaseLoad()
    expect(await pending).toEqual(dashboard)
  })
})
