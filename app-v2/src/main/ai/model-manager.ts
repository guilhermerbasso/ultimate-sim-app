// GGUF model manager for the local "AI Race Engineer" — main process ONLY.
//
// Responsible for resolving, downloading (on first run), verifying and caching the
// model files under `app.getPath('userData')/models/` (NEVER a temp dir). It is the
// piece that turns a catalog `ModelId` into a concrete on-disk path the runtime can
// load.
//
// node-llama-cpp's downloader is the ONLY native-ish dependency, and it is reached
// through an injectable seam (default = a lazy dynamic import) so this module can be
// unit-tested without any network or native module. Every method is wrapped: a
// download failure surfaces as a result/false and never throws into the app, and a
// startup must never block on it.

import { mkdir, rm, stat } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  AI_MODELS,
  AI_MODEL_LIST,
  DEFAULT_MODEL_ID,
  type EnsureModelResult,
  type ModelDownloadProgress,
  type ModelId,
  type ModelInfo,
  type ModelProgressListener,
  type ModelStatus
} from '../../shared/ai'
import type { LogArea, Logger } from '../../shared/logger'

const LOG_AREA: LogArea = 'ai'

// A file smaller than this is treated as absent/truncated (a real Q4 GGUF is tens
// to hundreds of MB), so a half-written file is never mistaken for a ready model.
const MIN_VALID_BYTES = 1_000_000

// A COMPLETE model must be at least this fraction of its catalog size. A download that
// was interrupted (network drop / app quit mid-transfer) leaves a partial multi-hundred-MB
// file that would pass a flat 1 MB floor and then `load_failed` forever with no in-app
// recovery. Validating against the expected size treats a truncated file as ABSENT, so it
// is re-downloaded instead of poisoning the cache.
const MIN_VALID_RATIO = 0.9

// ─── Downloader seam (so tests run without node-llama-cpp / network) ─────────────────

export interface ModelDownloaderLike {
  download(options?: { signal?: AbortSignal }): Promise<unknown>
  readonly entrypointFilePath?: string
  readonly totalSize?: number
  readonly downloadedSize?: number
}

export interface CreateDownloaderOptions {
  modelUri: string
  dirPath: string
  fileName: string
  skipExisting: boolean
  onProgress?: (status: { totalSize: number; downloadedSize: number }) => void
}

export type CreateModelDownloader = (options: CreateDownloaderOptions) => Promise<ModelDownloaderLike>

// Filesystem seam — defaults to node:fs; tests inject an in-memory store.
export interface ModelManagerFs {
  exists(path: string): boolean
  size(path: string): number | null
  mkdir(path: string): Promise<void>
  remove(path: string): Promise<void>
}

const defaultFs: ModelManagerFs = {
  exists: (path) => existsSync(path),
  size: (path) => {
    try {
      return statSync(path).size
    } catch {
      return null
    }
  },
  mkdir: async (path) => {
    await mkdir(path, { recursive: true })
  },
  remove: async (path) => {
    await rm(path, { force: true })
  }
}

// Default downloader: a lazy dynamic import of node-llama-cpp's createModelDownloader.
const defaultCreateDownloader: CreateModelDownloader = async (options) => {
  const nlc = await import('node-llama-cpp')
  return (await nlc.createModelDownloader({
    modelUri: options.modelUri,
    dirPath: options.dirPath,
    fileName: options.fileName,
    skipExisting: options.skipExisting,
    showCliProgress: false,
    onProgress: options.onProgress
  })) as unknown as ModelDownloaderLike
}

export interface ModelManagerOptions {
  /** Directory that holds the GGUF files. Typically `userData/models`. */
  modelsDir: string
  /** Initial active model id. Defaults to the catalog default (Qwen 1.5B). */
  activeModelId?: ModelId
  /** Catalog override (defaults to the built-in AI_MODELS). */
  catalog?: Readonly<Record<string, ModelInfo>>
}

export interface ModelManagerDeps {
  fs?: ModelManagerFs
  createDownloader?: CreateModelDownloader
  logger?: Logger
}

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {}
}

export class ModelManager {
  private readonly modelsDir: string
  private readonly catalog: Readonly<Record<string, ModelInfo>>
  private readonly fs: ModelManagerFs
  private readonly createDownloader: CreateModelDownloader
  private readonly log: Logger
  private activeModelId: ModelId

  // De-dupes concurrent ensureModel() calls for the same id (idempotent + resumes).
  private readonly inflight = new Map<ModelId, Promise<EnsureModelResult>>()

  constructor(options: ModelManagerOptions, deps?: ModelManagerDeps) {
    this.modelsDir = options.modelsDir
    this.catalog = options.catalog ?? AI_MODELS
    this.fs = deps?.fs ?? defaultFs
    this.createDownloader = deps?.createDownloader ?? defaultCreateDownloader
    this.log = deps?.logger ?? silentLogger
    const requested = options.activeModelId
    this.activeModelId = requested && this.catalog[requested] ? requested : DEFAULT_MODEL_ID
  }

  // ── Catalog / paths ───────────────────────────────────────────────────────────────

  /** All catalog models with runtime presence/active flags (for the settings UI). */
  listModels(): ModelStatus[] {
    const ids = Object.keys(this.catalog)
    // Preserve the canonical order (default first) where possible.
    const ordered = AI_MODEL_LIST.map((m) => m.id).filter((id) => ids.includes(id))
    for (const id of ids) if (!ordered.includes(id)) ordered.push(id)
    return ordered.map((id) => {
      const info = this.catalog[id]
      return {
        ...info,
        path: this.modelPath(id),
        present: this.isModelPresent(id),
        active: id === this.activeModelId
      }
    })
  }

  getModelInfo(id: ModelId): ModelInfo | undefined {
    return this.catalog[id]
  }

  /** Absolute path the model file would live at (whether or not it exists yet). */
  modelPath(id: ModelId): string {
    const info = this.catalog[id]
    const fileName = info?.fileName ?? `${id}.gguf`
    return join(this.modelsDir, fileName)
  }

  getActiveModelId(): ModelId {
    return this.activeModelId
  }

  /** Path of the active model IF present on disk, else null. */
  getActiveModelPath(): string | null {
    return this.isModelPresent(this.activeModelId) ? this.modelPath(this.activeModelId) : null
  }

  setActiveModel(id: ModelId): boolean {
    if (!this.catalog[id]) {
      this.log.warn(LOG_AREA, 'setActiveModel: unknown model id', { id })
      return false
    }
    this.activeModelId = id
    this.log.info(LOG_AREA, 'active model set', { id })
    return true
  }

  // ── Presence ────────────────────────────────────────────────────────────────────────

  isModelPresent(id: ModelId): boolean {
    const path = this.modelPath(id)
    try {
      if (!this.fs.exists(path)) return false
      const size = this.fs.size(path)
      return size !== null && size >= this.minValidBytes(id)
    } catch {
      return false
    }
  }

  // Minimum on-disk size for `id` to count as a COMPLETE model: at least 90% of the
  // catalog's approx size (so a truncated download is treated as absent), floored at 1 MB.
  private minValidBytes(id: ModelId): number {
    const approx = this.catalog[id]?.approxBytes
    return approx && approx > 0 ? Math.max(MIN_VALID_BYTES, Math.floor(approx * MIN_VALID_RATIO)) : MIN_VALID_BYTES
  }

  // ── Ensure (download-on-first-run) ────────────────────────────────────────────────────

  // Resolve the model to a local path, downloading it first if missing. Idempotent:
  // if already present, returns immediately with NO network. Concurrent calls for the
  // same id share one download. Emits progress for the UI and never throws.
  async ensureModel(
    id: ModelId = this.activeModelId,
    onProgress?: ModelProgressListener,
    signal?: AbortSignal
  ): Promise<EnsureModelResult> {
    const info = this.catalog[id]
    if (!info) {
      return { ok: false, id, error: `unknown model id: ${id}` }
    }

    // Offline-friendly fast path: already downloaded → no network.
    if (this.isModelPresent(id)) {
      const path = this.modelPath(id)
      this.emit(onProgress, {
        modelId: id,
        phase: 'done',
        totalBytes: this.fs.size(path) ?? info.approxBytes,
        downloadedBytes: this.fs.size(path) ?? info.approxBytes,
        ratio: 1
      })
      return { ok: true, id, path, cached: true }
    }

    const existing = this.inflight.get(id)
    if (existing) return existing

    const task = this.downloadModel(id, info, onProgress, signal).finally(() => {
      this.inflight.delete(id)
    })
    this.inflight.set(id, task)
    return task
  }

  private async downloadModel(
    id: ModelId,
    info: ModelInfo,
    onProgress?: ModelProgressListener,
    signal?: AbortSignal
  ): Promise<EnsureModelResult> {
    const path = this.modelPath(id)
    const start = Date.now()
    try {
      await this.fs.mkdir(this.modelsDir)
      this.emit(onProgress, {
        modelId: id,
        phase: 'resolving',
        totalBytes: info.approxBytes,
        downloadedBytes: 0,
        ratio: 0
      })
      this.log.info(LOG_AREA, 'model download starting', { id, uri: info.uri, dir: this.modelsDir })

      const downloader = await this.createDownloader({
        modelUri: info.uri,
        dirPath: this.modelsDir,
        // skipExisting:false makes ipull write to an atomic `.ipull` temp and rename to the
        // final `*.gguf` ONLY on completion (and resume a partial temp). So the final file
        // never exists half-written — even after a HARD kill (power loss / OS kill) that no
        // catch can clean up — and `isModelPresent` (which checks the final path) stays
        // reliable regardless of size. Our own presence check already gates re-downloads,
        // so skipping the redundant "skip if final exists" is safe.
        fileName: info.fileName,
        skipExisting: false,
        onProgress: (status) => {
          const total = status.totalSize > 0 ? status.totalSize : info.approxBytes
          this.emit(onProgress, {
            modelId: id,
            phase: 'downloading',
            totalBytes: total,
            downloadedBytes: status.downloadedSize,
            ratio: total > 0 ? Math.min(1, status.downloadedSize / total) : 0
          })
        }
      })

      await downloader.download({ signal })

      // Verify the resulting file looks like a COMPLETE model (≥90% of expected).
      this.emit(onProgress, {
        modelId: id,
        phase: 'verifying',
        totalBytes: downloader.totalSize ?? info.approxBytes,
        downloadedBytes: downloader.downloadedSize ?? info.approxBytes,
        ratio: 1
      })
      const resolvedPath = downloader.entrypointFilePath ?? path
      if (!(await this.verify(resolvedPath, id))) {
        throw new Error('downloaded file failed verification (missing or truncated)')
      }

      this.emit(onProgress, {
        modelId: id,
        phase: 'done',
        totalBytes: downloader.totalSize ?? info.approxBytes,
        downloadedBytes: downloader.downloadedSize ?? info.approxBytes,
        ratio: 1
      })
      this.log.info(LOG_AREA, 'model download complete', {
        id,
        ms: Date.now() - start,
        path: resolvedPath
      })
      return { ok: true, id, path: resolvedPath, cached: false }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Delete the partial/corrupt file so it isn't mistaken for a ready model on the next
      // attempt (the flat-floor + skipExisting cache-poison the code-review flagged). Best
      // effort — covers a failed download, a verify failure, AND an aborted/cancelled one.
      await this.fs.remove(path).catch(() => undefined)
      this.emit(onProgress, {
        modelId: id,
        phase: 'error',
        totalBytes: info.approxBytes,
        downloadedBytes: 0,
        ratio: 0,
        error: message
      })
      this.log.error(LOG_AREA, 'model download failed', { id, message })
      return { ok: false, id, error: message }
    }
  }

  private async verify(path: string, id: ModelId): Promise<boolean> {
    const min = this.minValidBytes(id)
    try {
      const info = await stat(path)
      return info.isFile() && info.size >= min
    } catch {
      // Fall back to the injected fs seam (tests / non-default fs).
      const size = this.fs.size(path)
      return size !== null && size >= min
    }
  }

  // ── Removal ───────────────────────────────────────────────────────────────────────────

  async removeModel(id: ModelId): Promise<{ ok: boolean; error?: string }> {
    const path = this.modelPath(id)
    try {
      await this.fs.remove(path)
      this.log.info(LOG_AREA, 'model removed', { id, path })
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.log.error(LOG_AREA, 'model removal failed', { id, message })
      return { ok: false, error: message }
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────────────────

  private emit(listener: ModelProgressListener | undefined, progress: ModelDownloadProgress): void {
    if (!listener) return
    try {
      listener(progress)
    } catch {
      // A bad UI listener must never break a download.
    }
  }
}

// ─── Singleton accessor ───────────────────────────────────────────────────────────────

let instance: ModelManager | null = null

// App-wide singleton. The orchestrator constructs it once with the resolved
// `userData/models` dir + the app logger.
export function getModelManager(options?: ModelManagerOptions, deps?: ModelManagerDeps): ModelManager {
  if (!instance) {
    if (!options) throw new Error('getModelManager requires options on first call')
    instance = new ModelManager(options, deps)
  }
  return instance
}

export function resetModelManager(): void {
  instance = null
}
