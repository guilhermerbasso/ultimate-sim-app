import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  clonePayload,
  emptyExpressionStudioPayload,
  migrateExpressionStudioPayload,
  normalizeExpressionStudioMutation,
  type ExpressionStudioMutation,
  type ExpressionStudioPayload
} from '../../shared/expression-studio'

export interface ExpressionStudioStoreOptions {
  now?: () => string
  writeAtomic?: (path: string, payload: ExpressionStudioPayload) => Promise<void>
}

export class ExpressionStudioStore {
  private loaded = false
  private loadPromise: Promise<void> | null = null
  private payload: ExpressionStudioPayload
  private readonly now: () => string
  private readonly writeAtomic: (path: string, payload: ExpressionStudioPayload) => Promise<void>

  constructor(
    private readonly storePath: string,
    options: ExpressionStudioStoreOptions = {}
  ) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.writeAtomic = options.writeAtomic ?? writeExpressionStudioAtomic
    this.payload = emptyExpressionStudioPayload(this.now())
  }

  async load(): Promise<ExpressionStudioPayload> {
    await this.ensureLoaded()
    return this.snapshot()
  }

  snapshot(): ExpressionStudioPayload {
    return clonePayload(this.payload)
  }

  peek(): Readonly<ExpressionStudioPayload> {
    return this.payload
  }

  async mutate(
    input: ExpressionStudioMutation,
    validate?: (payload: ExpressionStudioPayload) => void
  ): Promise<ExpressionStudioPayload> {
    await this.ensureLoaded()
    const next = normalizeExpressionStudioMutation(input, this.payload.revision, this.now())
    validate?.(next)
    await this.writeAtomic(this.storePath, next)
    this.payload = next
    return this.snapshot()
  }

  async reloadImported(): Promise<ExpressionStudioPayload> {
    await this.ensureLoaded()
    const raw = JSON.parse(await readFile(this.storePath, 'utf8')) as unknown
    const migrated = migrateExpressionStudioPayload(raw, { imported: true, now: this.now() }).payload
    const next: ExpressionStudioPayload = {
      ...migrated,
      revision: this.payload.revision + 1,
      updatedAt: this.now()
    }
    await this.writeAtomic(this.storePath, next)
    this.payload = next
    return this.snapshot()
  }

  dropInMemoryForReset(): ExpressionStudioPayload {
    this.payload = {
      ...emptyExpressionStudioPayload(this.now()),
      revision: this.payload.revision + 1
    }
    this.loaded = true
    this.loadPromise = null
    return this.snapshot()
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    if (!this.loadPromise) this.loadPromise = this.loadFromDisk()
    await this.loadPromise
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.storePath, 'utf8')) as unknown
      const result = migrateExpressionStudioPayload(raw, { now: this.now() })
      if (result.migrated) await this.writeAtomic(this.storePath, result.payload)
      this.payload = result.payload
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw error
      const initial = emptyExpressionStudioPayload(this.now())
      await this.writeAtomic(this.storePath, initial)
      this.payload = initial
    }
    this.loaded = true
  }
}

export async function writeExpressionStudioAtomic(
  path: string,
  payload: ExpressionStudioPayload
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, path)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}
