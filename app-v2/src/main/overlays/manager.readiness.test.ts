// Regression coverage for audit P1-05: the overlays store loads asynchronously and the
// read-only IPC handlers did not wait for it. `overlays:list` / `overlays:getConfig` /
// `overlays:listCustom` were answered synchronously from `createDefaultOverlaysConfig()`,
// so a renderer that asked early got factory defaults presented as the user's settings —
// enabled widgets it had disabled, and none of its custom overlays.
//
// The startup call was also fire-and-forget (`void manager.load()`), so a failing read
// produced an unhandled rejection instead of a logged error.

import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModuleContext } from '../module-context'
import type { OverlayListItem } from '../../shared/overlays'

vi.mock('electron', () => ({
  BrowserWindow: class {},
  screen: {
    on: vi.fn(),
    off: vi.fn(),
    getAllDisplays: vi.fn(() => []),
    getPrimaryDisplay: vi.fn(() => ({ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }))
  },
  shell: { openExternal: vi.fn() }
}))

vi.mock('../modules/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

const { OverlayManager } = await import('./manager')

type Handler = (...args: unknown[]) => unknown

let root: string

function makeManager(): { manager: InstanceType<typeof OverlayManager>; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>()
  const owner = new EventEmitter() as EventEmitter & Record<string, unknown>
  owner.isDestroyed = (): boolean => false
  owner.isLoadingMainFrame = (): boolean => false
  const mainWindow = new EventEmitter() as EventEmitter & Record<string, unknown>
  mainWindow.webContents = owner
  mainWindow.isDestroyed = (): boolean => false
  mainWindow.isVisible = (): boolean => true

  const manager = new OverlayManager({
    app: { getPath: () => root },
    broadcast: () => {},
    getMainWindow: () => mainWindow,
    ipcMain: {
      handle: (channel: string, handler: Handler) => {
        handlers.set(channel, handler)
      }
    }
  } as unknown as ModuleContext)
  // Overlay windows are irrelevant here; keep the manager headless.
  ;(manager as unknown as { createWindow: (id: string) => void }).createWindow = () => {}
  manager.registerIpc()
  return { manager, handlers }
}

function persistOverlays(value: unknown): void {
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'overlays.json'), JSON.stringify(value, null, 2), 'utf8')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'overlays-readiness-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('OverlayManager readiness', () => {
  it('answers overlays:list from the persisted store even when asked before load resolves', async () => {
    persistOverlays({
      widgets: { gearSpeed: { id: 'gearSpeed', enabled: false, hidden: true } },
      customOverlays: []
    })
    const { manager, handlers } = makeManager()

    // The renderer asks as soon as its window exists, which is before the module's
    // startup `load()` has resolved.
    const listed = (await handlers.get('overlays:list')!({})) as OverlayListItem[]
    const gearSpeed = listed.find((item) => item.id === 'gearSpeed')
    expect(gearSpeed?.enabled, 'overlays:list served factory defaults instead of the persisted store').toBe(false)

    await manager.load()
    expect(manager.list().find((item) => item.id === 'gearSpeed')?.enabled).toBe(false)
  })

  it('answers overlays:listCustom from the persisted store before load resolves', async () => {
    persistOverlays({
      widgets: {},
      customOverlays: [
        { id: 'custom:early', title: 'Early', enabled: false, widgets: [{ id: 'w', type: 'gauge' }] }
      ]
    })
    const { handlers } = makeManager()

    const custom = (await handlers.get('overlays:listCustom')!({})) as Array<{ id: string }>
    expect(custom.map((item) => item.id), 'overlays:listCustom served an empty list').toEqual(['custom:early'])
  })

  it('is idempotent: concurrent load() calls share one pass', async () => {
    persistOverlays({ widgets: {}, customOverlays: [] })
    const { manager } = makeManager()
    const first = manager.load()
    expect(manager.load()).toBe(first)
    await first
    await manager.load()
  })
})
