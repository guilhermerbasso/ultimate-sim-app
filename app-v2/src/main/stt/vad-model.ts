// Silero VAD ONNX model manager — main process ONLY.
//
// Mirrors src/main/stt/whisper-model.ts (download-on-demand, atomic, gated, never-throws)
// but for the much smaller (~1.8 MB) Silero VAD ONNX model. This model is the cheap
// SPEECH GATE that runs BEFORE whisper: whisper.cpp (75 MB, a spawned subprocess) is far
// too heavy to run on every energy-VAD segment, so we first confirm the segment actually
// contains human speech with this tiny ONNX net. If the model (or onnxruntime-node) is
// absent the gate is simply skipped and behaviour falls back to whisper-always-on.
//
// RESOURCE-MINIMAL GUARANTEES (identical contract to WhisperModelManager):
//   • DOWNLOAD-ON-DEMAND — nothing fetches at startup; ensureModel() is called the first
//     time the wake-word feature needs the gate (or from the settings UI).
//   • IDEMPOTENT         — an already-present model returns immediately with NO network.
//   • SINGLE IN-FLIGHT   — concurrent ensureModel() calls share one download.
//   • ATOMIC             — writes to a `.part` temp and renames on success.
//   • NEVER THROWS       — failures surface as a Result; a missing model never crashes.

import { createWriteStream, existsSync, statSync } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { get as httpsGet } from 'node:https'

// The Silero VAD ONNX is ~1.8 MB. A file smaller than this is treated as absent/truncated
// so a half-written `.part` is never mistaken for a ready model.
const MIN_VALID_BYTES = 500_000

// A COMPLETE model must be at least this fraction of its catalog size (an interrupted
// download is treated as ABSENT and re-fetched instead of poisoning the cache).
const MIN_VALID_RATIO = 0.9

export interface VadModelInfo {
  /** Flat HTTPS URL of the ONNX file. */
  url: string
  /** On-disk file name under the models dir. */
  fileName: string
  /** Approximate download size in bytes (for presence gating + progress totals). */
  approxBytes: number
}

// Canonical Silero VAD v5 single-file ONNX (MIT, snakers4/silero-vad). The Hugging Face
// mirror is a stable flat file that follows redirects to a CDN like the ggml models do.
export const SILERO_VAD_MODEL: VadModelInfo = {
  url: 'https://huggingface.co/onnx-community/silero-vad/resolve/main/onnx/model.onnx',
  fileName: 'silero-vad.onnx',
  approxBytes: 2_327_524
} as const

// ─── Seams (so tests run without network / fs) ─────────────────────────────────────

export interface VadStreamDownloadOptions {
  url: string
  destPath: string
  signal?: AbortSignal
  onProgress?: (status: { totalBytes: number; downloadedBytes: number }) => void
}

export type VadStreamDownloader = (options: VadStreamDownloadOptions) => Promise<void>

export interface VadModelFs {
  exists(path: string): boolean
  size(path: string): number | null
  mkdir(path: string): Promise<void>
  remove(path: string): Promise<void>
}

const defaultFs: VadModelFs = {
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
// temp then renamed on completion (atomic). No external deps (mirrors whisper-model.ts).
const defaultDownloader: VadStreamDownloader = ({ url, destPath, signal, onProgress }) =>
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
          rename(tempPath, destPath).then(resolve).catch(fail)
        })
        res.pipe(out)
      })
      req.on('error', fail)
    }

    request(url, MAX_REDIRECTS)
  })

export interface VadModelManagerOptions {
  /** Directory that holds the ONNX file. Typically `userData/models`. */
  modelsDir: string
  /** Catalog override (defaults to SILERO_VAD_MODEL). */
  info?: VadModelInfo
}

export interface VadModelManagerDeps {
  fs?: VadModelFs
  download?: VadStreamDownloader
}

export type VadModelPhase = 'resolving' | 'downloading' | 'verifying' | 'done' | 'error'

export interface VadModelProgress {
  phase: VadModelPhase
  totalBytes: number
  downloadedBytes: number
  /** 0..1 fraction; 1 when done. */
  ratio: number
  /** Present when phase === 'error'. */
  error?: string
}

export type VadModelProgressListener = (progress: VadModelProgress) => void

export interface EnsureVadModelResult {
  ok: boolean
  path?: string
  cached?: boolean
  error?: string
}

export class VadModelManager {
  private readonly modelsDir: string
  private readonly info: VadModelInfo
  private readonly fs: VadModelFs
  private readonly download: VadStreamDownloader
  private inflight: Promise<EnsureVadModelResult> | null = null

  constructor(options: VadModelManagerOptions, deps?: VadModelManagerDeps) {
    this.modelsDir = options.modelsDir
    this.info = options.info ?? SILERO_VAD_MODEL
    this.fs = deps?.fs ?? defaultFs
    this.download = deps?.download ?? defaultDownloader
  }

  /** Absolute path the model file would live at (whether or not it exists yet). */
  modelPath(): string {
    return join(this.modelsDir, this.info.fileName)
  }

  private minValidBytes(): number {
    const approx = this.info.approxBytes
    return approx && approx > 0 ? Math.max(MIN_VALID_BYTES, Math.floor(approx * MIN_VALID_RATIO)) : MIN_VALID_BYTES
  }

  isModelPresent(): boolean {
    const path = this.modelPath()
    try {
      if (!this.fs.exists(path)) return false
      const size = this.fs.size(path)
      return size !== null && size >= this.minValidBytes()
    } catch {
      return false
    }
  }

  // Resolve the model to a local path, downloading it first if missing. Idempotent:
  // if already present, returns immediately with NO network. Concurrent calls share one
  // download. Emits progress for the UI and never throws.
  async ensureModel(onProgress?: VadModelProgressListener, signal?: AbortSignal): Promise<EnsureVadModelResult> {
    if (this.isModelPresent()) {
      const path = this.modelPath()
      const size = this.fs.size(path) ?? this.info.approxBytes
      this.emit(onProgress, { phase: 'done', totalBytes: size, downloadedBytes: size, ratio: 1 })
      return { ok: true, path, cached: true }
    }

    if (this.inflight) return this.inflight

    const task = this.downloadModel(onProgress, signal).finally(() => {
      this.inflight = null
    })
    this.inflight = task
    return task
  }

  private async downloadModel(onProgress?: VadModelProgressListener, signal?: AbortSignal): Promise<EnsureVadModelResult> {
    const path = this.modelPath()
    try {
      await this.fs.mkdir(this.modelsDir)
      this.emit(onProgress, { phase: 'resolving', totalBytes: this.info.approxBytes, downloadedBytes: 0, ratio: 0 })

      await this.download({
        url: this.info.url,
        destPath: path,
        signal,
        onProgress: (status) => {
          const total = status.totalBytes > 0 ? status.totalBytes : this.info.approxBytes
          this.emit(onProgress, {
            phase: 'downloading',
            totalBytes: total,
            downloadedBytes: status.downloadedBytes,
            ratio: total > 0 ? Math.min(1, status.downloadedBytes / total) : 0
          })
        }
      })

      this.emit(onProgress, {
        phase: 'verifying',
        totalBytes: this.info.approxBytes,
        downloadedBytes: this.info.approxBytes,
        ratio: 1
      })
      if (!(await this.verify(path))) {
        throw new Error('downloaded file failed verification (missing or truncated)')
      }

      this.emit(onProgress, {
        phase: 'done',
        totalBytes: this.info.approxBytes,
        downloadedBytes: this.info.approxBytes,
        ratio: 1
      })
      return { ok: true, path, cached: false }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.fs.remove(path).catch(() => undefined)
      this.emit(onProgress, { phase: 'error', totalBytes: this.info.approxBytes, downloadedBytes: 0, ratio: 0, error: message })
      return { ok: false, error: message }
    }
  }

  private async verify(path: string): Promise<boolean> {
    const min = this.minValidBytes()
    try {
      const info = await stat(path)
      return info.isFile() && info.size >= min
    } catch {
      const size = this.fs.size(path)
      return size !== null && size >= min
    }
  }

  private emit(listener: VadModelProgressListener | undefined, progress: VadModelProgress): void {
    if (!listener) return
    try {
      listener(progress)
    } catch {
      // A bad UI listener must never break a download.
    }
  }
}
