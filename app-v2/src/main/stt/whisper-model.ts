// ggml model manager for OFFLINE whisper.cpp STT — main process ONLY.
//
// Mirrors src/main/ai/model-manager.ts: resolves, downloads-on-demand, verifies and
// caches the ggml model files under `userData/models/` (NEVER a temp dir) and gates
// every consumer on presence. The download is a plain streaming HTTPS GET (the ggml
// models are hosted as flat files on Hugging Face — no node-llama-cpp involved), reached
// through an injectable seam so this module unit-tests without network or fs.
//
// RESOURCE-MINIMAL GUARANTEES:
//   • DOWNLOAD-ON-DEMAND — nothing fetches at startup; ensureModel() is called when the
//     user first enables the wake word (or from the settings UI).
//   • IDEMPOTENT         — already-present models return immediately with NO network.
//   • SINGLE IN-FLIGHT   — concurrent ensureModel() for the same id share one download.
//   • ATOMIC             — writes to a `.part` temp and renames on success, so a killed
//     download never leaves a half-written file that looks "present".
//   • NEVER THROWS       — failures surface as a Result; a missing model never crashes.

import { createWriteStream, existsSync, statSync } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { get as httpsGet } from 'node:https'
import {
  DEFAULT_STT_MODEL_ID,
  type SttModelId,
  type SttModelPhase,
  type SttModelProgress,
  type SttModelProgressListener
} from '../../shared/stt-ipc'

// A file smaller than this is treated as absent/truncated (a real ggml model is tens
// of MB), so a half-written file is never mistaken for a ready model.
const MIN_VALID_BYTES = 1_000_000

// A COMPLETE model must be at least this fraction of its catalog size (an interrupted
// download is treated as ABSENT and re-fetched instead of poisoning the cache).
const MIN_VALID_RATIO = 0.9

export interface SttModelInfo {
  id: SttModelId
  label: string
  /** Flat HTTPS URL of the ggml file (Hugging Face mirror). */
  url: string
  /** On-disk file name under the models dir. */
  fileName: string
  /** Approximate download size in bytes (for presence gating + progress totals). */
  approxBytes: number
}

// Multilingual ggml models from the canonical whisper.cpp Hugging Face repo (MIT).
// tiny ≈ 75 MB (default, fast), base ≈ 142 MB (more accurate).
export const STT_MODELS: Readonly<Record<SttModelId, SttModelInfo>> = {
  tiny: {
    id: 'tiny',
    label: 'Whisper tiny (multilingual, ~75 MB)',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
    fileName: 'ggml-tiny.bin',
    approxBytes: 77_691_713
  },
  base: {
    id: 'base',
    label: 'Whisper base (multilingual, ~142 MB)',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    fileName: 'ggml-base.bin',
    approxBytes: 147_951_465
  }
} as const

// ─── Seams (so tests run without network / fs) ─────────────────────────────────────

export interface StreamDownloadOptions {
  url: string
  destPath: string
  signal?: AbortSignal
  onProgress?: (status: { totalBytes: number; downloadedBytes: number }) => void
}

/** Downloads `url` to `destPath` (atomically). Default = streaming HTTPS GET. */
export type StreamDownloader = (options: StreamDownloadOptions) => Promise<void>

export interface WhisperModelFs {
  exists(path: string): boolean
  size(path: string): number | null
  mkdir(path: string): Promise<void>
  remove(path: string): Promise<void>
}

const defaultFs: WhisperModelFs = {
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

// Default streaming downloader: HTTPS GET with redirect following, written to a `.part`
// temp then renamed on completion (atomic). No external deps.
const defaultDownloader: StreamDownloader = ({ url, destPath, signal, onProgress }) =>
  new Promise<void>((resolve, reject) => {
    const tempPath = `${destPath}.part`
    const MAX_REDIRECTS = 5

    const fail = (err: Error): void => {
      rm(tempPath, { force: true })
        .catch(() => undefined)
        .finally(() => reject(err))
    }

    const request = (currentUrl: string, redirectsLeft: number): void => {
      if (signal?.aborted) {
        fail(new Error('aborted'))
        return
      }
      const req = httpsGet(currentUrl, { signal }, (res) => {
        const status = res.statusCode ?? 0
        // Follow redirects (Hugging Face 302s to a CDN).
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume()
          if (redirectsLeft <= 0) {
            fail(new Error('too many redirects'))
            return
          }
          const next = new URL(res.headers.location, currentUrl).toString()
          request(next, redirectsLeft - 1)
          return
        }
        if (status !== 200) {
          res.resume()
          fail(new Error(`download failed: HTTP ${status}`))
          return
        }
        const totalBytes = Number(res.headers['content-length'] ?? 0)
        let downloadedBytes = 0
        const out = createWriteStream(tempPath)
        res.on('data', (chunk: Buffer) => {
          downloadedBytes += chunk.length
          onProgress?.({ totalBytes, downloadedBytes })
        })
        res.on('error', fail)
        out.on('error', fail)
        out.on('finish', () => {
          rename(tempPath, destPath)
            .then(resolve)
            .catch(fail)
        })
        res.pipe(out)
      })
      req.on('error', fail)
    }

    request(url, MAX_REDIRECTS)
  })

export interface WhisperModelManagerOptions {
  /** Directory that holds the ggml files. Typically `userData/models`. */
  modelsDir: string
  /** Catalog override (defaults to STT_MODELS). */
  catalog?: Readonly<Record<string, SttModelInfo>>
}

export interface WhisperModelManagerDeps {
  fs?: WhisperModelFs
  download?: StreamDownloader
}

export interface EnsureSttModelResult {
  ok: boolean
  id: SttModelId
  path?: string
  cached?: boolean
  error?: string
}

export class WhisperModelManager {
  private readonly modelsDir: string
  private readonly catalog: Readonly<Record<string, SttModelInfo>>
  private readonly fs: WhisperModelFs
  private readonly download: StreamDownloader
  private readonly inflight = new Map<SttModelId, Promise<EnsureSttModelResult>>()

  constructor(options: WhisperModelManagerOptions, deps?: WhisperModelManagerDeps) {
    this.modelsDir = options.modelsDir
    this.catalog = options.catalog ?? STT_MODELS
    this.fs = deps?.fs ?? defaultFs
    this.download = deps?.download ?? defaultDownloader
  }

  getModelInfo(id: SttModelId): SttModelInfo | undefined {
    return this.catalog[id]
  }

  /** Absolute path the model file would live at (whether or not it exists yet). */
  modelPath(id: SttModelId): string {
    const info = this.catalog[id]
    const fileName = info?.fileName ?? `ggml-${id}.bin`
    return join(this.modelsDir, fileName)
  }

  private minValidBytes(id: SttModelId): number {
    const approx = this.catalog[id]?.approxBytes
    return approx && approx > 0 ? Math.max(MIN_VALID_BYTES, Math.floor(approx * MIN_VALID_RATIO)) : MIN_VALID_BYTES
  }

  isModelPresent(id: SttModelId): boolean {
    const path = this.modelPath(id)
    try {
      if (!this.fs.exists(path)) return false
      const size = this.fs.size(path)
      return size !== null && size >= this.minValidBytes(id)
    } catch {
      return false
    }
  }

  // Resolve the model to a local path, downloading it first if missing. Idempotent:
  // if already present, returns immediately with NO network. Concurrent calls for the
  // same id share one download. Emits progress for the UI and never throws.
  async ensureModel(
    id: SttModelId = DEFAULT_STT_MODEL_ID,
    onProgress?: SttModelProgressListener,
    signal?: AbortSignal
  ): Promise<EnsureSttModelResult> {
    const info = this.catalog[id]
    if (!info) return { ok: false, id, error: `unknown stt model id: ${id}` }

    if (this.isModelPresent(id)) {
      const path = this.modelPath(id)
      this.emit(onProgress, {
        model: id,
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
    id: SttModelId,
    info: SttModelInfo,
    onProgress?: SttModelProgressListener,
    signal?: AbortSignal
  ): Promise<EnsureSttModelResult> {
    const path = this.modelPath(id)
    try {
      await this.fs.mkdir(this.modelsDir)
      this.emit(onProgress, { model: id, phase: 'resolving', totalBytes: info.approxBytes, downloadedBytes: 0, ratio: 0 })

      await this.download({
        url: info.url,
        destPath: path,
        signal,
        onProgress: (status) => {
          const total = status.totalBytes > 0 ? status.totalBytes : info.approxBytes
          this.emit(onProgress, {
            model: id,
            phase: 'downloading',
            totalBytes: total,
            downloadedBytes: status.downloadedBytes,
            ratio: total > 0 ? Math.min(1, status.downloadedBytes / total) : 0
          })
        }
      })

      this.emit(onProgress, { model: id, phase: 'verifying', totalBytes: info.approxBytes, downloadedBytes: info.approxBytes, ratio: 1 })
      if (!(await this.verify(path, id))) {
        throw new Error('downloaded file failed verification (missing or truncated)')
      }

      this.emit(onProgress, { model: id, phase: 'done', totalBytes: info.approxBytes, downloadedBytes: info.approxBytes, ratio: 1 })
      return { ok: true, id, path, cached: false }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.fs.remove(path).catch(() => undefined)
      this.emit(onProgress, { model: id, phase: 'error', totalBytes: info.approxBytes, downloadedBytes: 0, ratio: 0, error: message })
      return { ok: false, id, error: message }
    }
  }

  private async verify(path: string, id: SttModelId): Promise<boolean> {
    const min = this.minValidBytes(id)
    try {
      const info = await stat(path)
      return info.isFile() && info.size >= min
    } catch {
      const size = this.fs.size(path)
      return size !== null && size >= min
    }
  }

  private emit(listener: SttModelProgressListener | undefined, progress: SttModelProgress): void {
    if (!listener) return
    try {
      listener(progress)
    } catch {
      // A bad UI listener must never break a download.
    }
  }
}

// Silence the "phase typed but unused" lint when consumers only import the class.
export type { SttModelPhase }
