// WS-K — Embedding engine backed by Transformers.js (`@huggingface/transformers`).
//
// Pure-JS ONNX inference in Node, CPU-only. The multilingual MiniLM model is
// pulled FROM HUGGING FACE ON DEMAND the first time `ensureModel` runs and cached
// on disk (cacheDir under userData); the app never ships it. If the package is
// not installed (or the download never happened), every method degrades safely:
// `isAvailable()` / `ensureModel()` report `unavailable` and callers fall back to
// the deterministic keyword index. Nothing here is ever on the telemetry hot path.
//
// Design notes:
//  • Dynamic import via a NON-LITERAL specifier so this file type-checks and
//    builds even when `@huggingface/transformers` is absent from node_modules.
//  • Single-flight: concurrent `ensureModel`/`embed` callers share one load.
//  • Idle-unload: the pipeline is disposed after a quiet period to free RAM.

import {
  SEMANTIC_MODEL_ID,
  SEMANTIC_MODEL_DTYPE,
  type SemanticModelPhase,
  type SemanticModelProgress
} from '../../shared/semantic-search-ipc'

type ProgressListener = (progress: SemanticModelProgress) => void

// Transformers.js is untyped here (optional dep) — keep a minimal local shape.
type FeatureExtractor = (
  input: string | string[],
  opts: { pooling: 'mean' | 'cls' | 'none'; normalize: boolean }
) => Promise<{ tolist(): number[][] }>

interface TransformersModule {
  pipeline: (
    task: string,
    model: string,
    opts?: { progress_callback?: (p: RawProgress) => void; dtype?: string }
  ) => Promise<FeatureExtractor>
  env: {
    cacheDir?: string
    allowRemoteModels?: boolean
    allowLocalModels?: boolean
    localModelPath?: string
  }
}

interface RawProgress {
  status?: string
  name?: string
  file?: string
  loaded?: number
  total?: number
  progress?: number
}

const IDLE_UNLOAD_MS = 5 * 60 * 1000 // dispose the pipeline after 5 min idle

export class EmbeddingsEngine {
  private readonly cacheDir: string
  private extractor: FeatureExtractor | null = null
  private loadPromise: Promise<FeatureExtractor | null> | null = null
  private moduleAvailable: boolean | null = null
  private phase: SemanticModelPhase = 'idle'
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private readonly listeners = new Set<ProgressListener>()

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir
  }

  onProgress(listener: ProgressListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getPhase(): SemanticModelPhase {
    return this.phase
  }

  isReady(): boolean {
    return this.extractor !== null
  }

  isLoading(): boolean {
    return this.loadPromise !== null && this.extractor === null
  }

  /** Whether `@huggingface/transformers` is installed (the model CAN be loaded). */
  async isAvailable(): Promise<boolean> {
    if (this.moduleAvailable !== null) return this.moduleAvailable
    try {
      await loadTransformers()
      this.moduleAvailable = true
    } catch {
      this.moduleAvailable = false
      this.setPhase('unavailable')
    }
    return this.moduleAvailable
  }

  /**
   * Ensure the embedding pipeline is loaded (downloading the model on first use).
   * Single-flight: concurrent callers await the same promise. Returns the
   * extractor, or `null` if the package/model is unavailable.
   */
  ensureModel(): Promise<FeatureExtractor | null> {
    if (this.extractor) {
      this.touchIdle()
      return Promise.resolve(this.extractor)
    }
    if (this.loadPromise) return this.loadPromise
    this.loadPromise = this.load()
    return this.loadPromise
  }

  private async load(): Promise<FeatureExtractor | null> {
    let mod: TransformersModule
    try {
      mod = await loadTransformers()
      this.moduleAvailable = true
    } catch {
      this.moduleAvailable = false
      this.setPhase('unavailable')
      this.loadPromise = null
      return null
    }

    try {
      mod.env.cacheDir = this.cacheDir
      mod.env.allowRemoteModels = true
      this.setPhase('downloading')
      const extractor = await mod.pipeline('feature-extraction', SEMANTIC_MODEL_ID, {
        dtype: SEMANTIC_MODEL_DTYPE,
        progress_callback: (p) => this.emitRaw(p)
      })
      this.extractor = extractor
      this.setPhase('ready')
      this.emit({ phase: 'ready', loadedBytes: 0, totalBytes: 0, ratio: 1 })
      this.touchIdle()
      return extractor
    } catch (error) {
      this.setPhase('error')
      this.emit({
        phase: 'error',
        loadedBytes: 0,
        totalBytes: 0,
        ratio: 0,
        error: error instanceof Error ? error.message : String(error)
      })
      return null
    } finally {
      this.loadPromise = null
    }
  }

  /**
   * Embed a batch of texts → mean-pooled, L2-normalized vectors. Returns `null`
   * when the model is unavailable so the caller uses the keyword fallback.
   */
  async embed(texts: string[]): Promise<number[][] | null> {
    if (texts.length === 0) return []
    const extractor = await this.ensureModel()
    if (!extractor) return null
    this.touchIdle()
    const output = await extractor(texts, { pooling: 'mean', normalize: true })
    return output.tolist()
  }

  /** Convenience: embed a single query string. */
  async embedOne(text: string): Promise<number[] | null> {
    const out = await this.embed([text])
    return out && out.length ? out[0] : null
  }

  /** Dispose the pipeline to release memory. Safe to call repeatedly. */
  unload(): void {
    this.extractor = null
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    if (this.phase === 'ready') this.setPhase('idle')
  }

  private touchIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.unload(), IDLE_UNLOAD_MS)
    // Don't keep the event loop alive just for the idle timer.
    if (typeof this.idleTimer === 'object' && 'unref' in this.idleTimer) {
      ;(this.idleTimer as { unref(): void }).unref()
    }
  }

  private setPhase(phase: SemanticModelPhase): void {
    this.phase = phase
  }

  private emitRaw(p: RawProgress): void {
    const phase: SemanticModelPhase =
      p.status === 'ready' || p.status === 'done'
        ? 'loading'
        : p.status === 'progress' || p.status === 'download' || p.status === 'initiate'
          ? 'downloading'
          : this.phase
    const loaded = typeof p.loaded === 'number' ? p.loaded : 0
    const total = typeof p.total === 'number' ? p.total : 0
    const ratio =
      typeof p.progress === 'number'
        ? p.progress / 100
        : total > 0
          ? loaded / total
          : 0
    this.setPhase(phase)
    this.emit({
      phase,
      file: p.file ?? p.name,
      loadedBytes: loaded,
      totalBytes: total,
      ratio: Math.max(0, Math.min(1, ratio))
    })
  }

  private emit(progress: SemanticModelProgress): void {
    for (const listener of this.listeners) {
      try {
        listener(progress)
      } catch {
        // A bad listener must not break the load.
      }
    }
  }
}

// ─── Optional-dependency loader ───────────────────────────────────────────────
//
// The specifier is held in a variable so TypeScript treats the dynamic import as
// `Promise<any>` (no compile-time module resolution) — the package can be absent
// and this file still type-checks. `@vite-ignore` keeps the bundler from trying
// to resolve it at build time as well.
let cachedModule: TransformersModule | null = null

async function loadTransformers(): Promise<TransformersModule> {
  if (cachedModule) return cachedModule
  const specifier = '@huggingface/transformers'
  const mod = (await import(/* @vite-ignore */ specifier)) as TransformersModule
  cachedModule = mod
  return mod
}
