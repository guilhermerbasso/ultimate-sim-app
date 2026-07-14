import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
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
import type { OutputRoute } from '../../shared/outputs'

export interface ExpressionStudioStoreOptions {
  now?: () => string
  writeAtomic?: (path: string, payload: ExpressionStudioPayload) => Promise<void>
}

export interface LegacyOutputStateMigration {
  payload: ExpressionStudioPayload
  migratedRouteIds: string[]
}

export class ExpressionStudioStore {
  private loaded = false
  private loadPromise: Promise<void> | null = null
  private payload: ExpressionStudioPayload
  private readonly now: () => string
  private readonly writeAtomic: (path: string, payload: ExpressionStudioPayload) => Promise<void>
  private operationTail: Promise<void> = Promise.resolve()
  private pendingOperations = 0

  constructor(
    private readonly storePath: string,
    options: ExpressionStudioStoreOptions = {}
  ) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.writeAtomic = options.writeAtomic ?? writeExpressionStudioAtomic
    this.payload = emptyExpressionStudioPayload(this.now())
  }

  async load(): Promise<ExpressionStudioPayload> {
    return this.runSerialized(async () => {
      await this.ensureLoaded()
      return this.snapshot()
    })
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
    return this.runSerialized(async () => {
      await this.ensureLoaded()
      const next = normalizeExpressionStudioMutation(input, this.payload.revision, this.now())
      validate?.(next)
      await this.writeAtomic(this.storePath, next)
      this.payload = next
      return this.snapshot()
    })
  }

  async reloadImported(
    validate?: (payload: ExpressionStudioPayload) => void
  ): Promise<ExpressionStudioPayload> {
    return this.runSerialized(async () => {
      await this.ensureLoaded()
      const previous = this.snapshot()
      try {
        const raw = JSON.parse(await readFile(this.storePath, 'utf8')) as unknown
        const next = this.prepareImportedPayload(raw)
        validate?.(next)
        await this.writeAtomic(this.storePath, next)
        this.payload = next
        return this.snapshot()
      } catch (error) {
        return this.rollbackImport(previous, error)
      }
    })
  }

  reloadImportedSynchronously(
    validate?: (payload: ExpressionStudioPayload) => void
  ): ExpressionStudioPayload {
    if (!this.loaded || this.pendingOperations > 0) {
      const busyError = new Error('Expression Studio is busy; the imported file was rolled back. Retry the import.')
      try {
        this.rollbackImportSynchronously()
      } catch (rollbackError) {
        throw importRollbackError(busyError, rollbackError)
      }
      throw busyError
    }
    const previous = this.snapshot()
    try {
      const raw = JSON.parse(readFileSync(this.storePath, 'utf8')) as unknown
      const next = this.prepareImportedPayload(raw)
      validate?.(next)
      writeExpressionStudioAtomicSync(this.storePath, next)
      this.payload = next
      return this.snapshot()
    } catch (error) {
      try {
        writeExpressionStudioAtomicSync(this.storePath, previous)
      } catch (rollbackError) {
        throw importRollbackError(error, rollbackError)
      }
      throw error
    }
  }

  async dropInMemoryForReset(): Promise<ExpressionStudioPayload> {
    return this.runSerialized(async () => {
      await this.ensureLoaded()
      const next = {
        ...emptyExpressionStudioPayload(this.now()),
        revision: this.payload.revision + 1
      }
      await rm(this.storePath, { force: true })
      this.payload = next
      this.loaded = true
      this.loadPromise = null
      return this.snapshot()
    })
  }

  async migrateLegacyOutputState(routes: readonly OutputRoute[]): Promise<LegacyOutputStateMigration> {
    return this.runSerialized(async () => {
      await this.ensureLoaded()
      const legacyById = new Map(
        routes
          .filter((route) => route.id.startsWith('expr:') && route.source.kind === 'expression')
          .map((route) => [route.id, route])
      )
      const migratedRouteIds: string[] = []
      let changed = false
      const outputs = this.payload.outputs.map((output) => {
        const legacy = legacyById.get(output.id)
        if (!legacy) return output
        migratedRouteIds.push(output.id)
        const next = {
          ...output,
          enabled: legacy.enabled,
          format: legacy.format ? { ...legacy.format } : undefined,
          updatedAt: legacy.updatedAt
        }
        if (
          output.enabled !== next.enabled ||
          JSON.stringify(output.format) !== JSON.stringify(next.format) ||
          output.updatedAt !== next.updatedAt
        ) {
          changed = true
        }
        return next
      })
      if (!changed) return { payload: this.snapshot(), migratedRouteIds }
      const next: ExpressionStudioPayload = {
        ...this.payload,
        revision: this.payload.revision + 1,
        outputs,
        updatedAt: this.now()
      }
      await this.writeAtomic(this.storePath, next)
      this.payload = next
      return { payload: this.snapshot(), migratedRouteIds }
    })
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    if (!this.loadPromise) this.loadPromise = this.loadFromDisk()
    await this.loadPromise
  }

  private prepareImportedPayload(raw: unknown): ExpressionStudioPayload {
    const migrated = migrateExpressionStudioPayload(raw, { imported: true, now: this.now() }).payload
    return {
      ...migrated,
      revision: this.payload.revision + 1,
      updatedAt: this.now()
    }
  }

  private async rollbackImport(previous: ExpressionStudioPayload, error: unknown): Promise<never> {
    try {
      await this.writeAtomic(this.storePath, previous)
    } catch (rollbackError) {
      throw importRollbackError(error, rollbackError)
    }
    throw error
  }

  private rollbackImportSynchronously(): void {
    writeExpressionStudioAtomicSync(this.storePath, this.payload)
  }

  private runSerialized<T>(operation: () => Promise<T>): Promise<T> {
    this.pendingOperations += 1
    const run = this.operationTail.then(operation)
    this.operationTail = run.then(() => undefined, () => undefined)
    return run.finally(() => {
      this.pendingOperations -= 1
    })
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

export function writeExpressionStudioAtomicSync(
  path: string,
  payload: ExpressionStudioPayload
): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.sync.tmp`
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    renameSync(temporaryPath, path)
  } catch (error) {
    rmSync(temporaryPath, { force: true })
    throw error
  }
}

function importRollbackError(importError: unknown, rollbackError: unknown): Error {
  const importMessage = importError instanceof Error ? importError.message : String(importError)
  const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
  return new Error(`Expression import failed (${importMessage}) and rollback failed (${rollbackMessage}).`)
}
