import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { App } from 'electron'
import {
  CUSTOM_CATALOG_STORE_FILE,
  CUSTOM_CATALOG_VERSION,
  emptyCustomCatalog,
  mergeCatalog,
  normalizeCustomBoard,
  normalizeCustomCatalog,
  normalizeCustomComponent,
  type CustomCatalog,
  type MergedCatalog
} from '../../shared/board-catalog'
import { PINOUT_CUSTOM_CHANNELS } from '../../shared/pinout'
import type { ModuleContext } from '../module-context'

function customCatalogPath(app: App): string {
  return join(app.getPath('userData'), CUSTOM_CATALOG_STORE_FILE)
}

/**
 * Read + normalize the persisted custom catalog from disk. Always resolves to a
 * well-formed catalog (empty when missing/corrupt) so callers never have to guard.
 */
export async function readCustomCatalog(app: App): Promise<CustomCatalog> {
  try {
    const raw = JSON.parse(await readFile(customCatalogPath(app), 'utf8'))
    return normalizeCustomCatalog(raw)
  } catch {
    return emptyCustomCatalog()
  }
}

/**
 * Read the custom catalog and merge it with the built-in catalog. This is the
 * single entry point the firmware generator uses so custom boards/components are
 * resolvable exactly like built-in ones.
 */
export async function loadMergedCatalog(app: App): Promise<MergedCatalog> {
  return mergeCatalog(await readCustomCatalog(app))
}

class CustomCatalogStore {
  private catalog: CustomCatalog = emptyCustomCatalog()
  private loaded = false
  private readonly path: string

  constructor(app: App) {
    this.path = customCatalogPath(app)
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    try {
      this.catalog = normalizeCustomCatalog(JSON.parse(await readFile(this.path, 'utf8')))
    } catch {
      this.catalog = emptyCustomCatalog()
    }
    this.loaded = true
  }

  list(): CustomCatalog {
    return this.catalog
  }

  async saveComponent(input: unknown): Promise<CustomCatalog> {
    await this.ensureLoaded()
    const normalized = normalizeCustomComponent(input)
    if (!normalized) throw new Error('A custom component needs at least a name.')
    const components = [...this.catalog.components]
    const index = components.findIndex((entry) => entry.id === normalized.id)
    if (index >= 0) components[index] = normalized
    else components.push(normalized)
    this.catalog = { ...this.catalog, components }
    await this.persist()
    return this.catalog
  }

  async saveBoard(input: unknown): Promise<CustomCatalog> {
    await this.ensureLoaded()
    const normalized = normalizeCustomBoard(input)
    if (!normalized) throw new Error('A custom board needs at least a name.')
    const boards = [...this.catalog.boards]
    const index = boards.findIndex((entry) => entry.id === normalized.id)
    if (index >= 0) boards[index] = normalized
    else boards.push(normalized)
    this.catalog = { ...this.catalog, boards }
    await this.persist()
    return this.catalog
  }

  async remove(id: string): Promise<CustomCatalog> {
    await this.ensureLoaded()
    const target = String(id ?? '')
    this.catalog = {
      ...this.catalog,
      components: this.catalog.components.filter((entry) => entry.id !== target),
      boards: this.catalog.boards.filter((entry) => entry.id !== target)
    }
    await this.persist()
    return this.catalog
  }

  private async persist(): Promise<void> {
    this.catalog = { ...this.catalog, version: CUSTOM_CATALOG_VERSION, updatedAt: new Date().toISOString() }
    await mkdir(dirname(this.path), { recursive: true })
    await writeFile(this.path, JSON.stringify(this.catalog, null, 2), 'utf8')
  }
}

export function register(ctx: ModuleContext): void {
  const store = new CustomCatalogStore(ctx.app)
  void store.ensureLoaded()

  ctx.ipcMain.handle(PINOUT_CUSTOM_CHANNELS.list, async () => {
    await store.ensureLoaded()
    return store.list()
  })

  ctx.ipcMain.handle(PINOUT_CUSTOM_CHANNELS.saveComponent, async (_event, input: unknown) => {
    const catalog = await store.saveComponent(input)
    ctx.broadcast(PINOUT_CUSTOM_CHANNELS.changed, catalog)
    return catalog
  })

  ctx.ipcMain.handle(PINOUT_CUSTOM_CHANNELS.saveBoard, async (_event, input: unknown) => {
    const catalog = await store.saveBoard(input)
    ctx.broadcast(PINOUT_CUSTOM_CHANNELS.changed, catalog)
    return catalog
  })

  ctx.ipcMain.handle(PINOUT_CUSTOM_CHANNELS.remove, async (_event, id: string) => {
    const catalog = await store.remove(id)
    ctx.broadcast(PINOUT_CUSTOM_CHANNELS.changed, catalog)
    return catalog
  })
}
