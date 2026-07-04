import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { DEFAULT_MODEL_ID, LIGHT_MODEL_ID, QUALITY_MODEL_ID, type ModelDownloadProgress } from '../../shared/ai'
import {
  ModelManager,
  type CreateDownloaderOptions,
  type CreateModelDownloader,
  type ModelDownloaderLike,
  type ModelManagerFs
} from './model-manager'

const MODELS_DIR = join('data', 'models')
// Above the 90%-of-catalog-size validity threshold for both built-in models (~1.0 GB
// default, ~0.36 GB light), so a "present" fake reads as a COMPLETE model.
const VALID_SIZE = 2_000_000_000
// A partial/truncated download — well under the 90% threshold → treated as ABSENT.
const TRUNCATED_SIZE = 50_000_000

// ─── In-memory fs ─────────────────────────────────────────────────────────────────

function makeFs(initial: Record<string, number> = {}): { fs: ModelManagerFs; sizes: Map<string, number> } {
  const sizes = new Map<string, number>(Object.entries(initial))
  const fs: ModelManagerFs = {
    exists: (path) => sizes.has(path),
    size: (path) => (sizes.has(path) ? (sizes.get(path) as number) : null),
    mkdir: async () => {},
    remove: async (path) => {
      sizes.delete(path)
    }
  }
  return { fs, sizes }
}

// ─── Fake downloader ───────────────────────────────────────────────────────────────

function makeDownloader(
  sizes: Map<string, number>,
  opts?: { fail?: boolean; finalSize?: number; progress?: number[]; partialSize?: number }
): { create: CreateModelDownloader; created: CreateDownloaderOptions[] } {
  const created: CreateDownloaderOptions[] = []
  const finalSize = opts?.finalSize ?? VALID_SIZE
  const create: CreateModelDownloader = async (o) => {
    created.push(o)
    const target = join(o.dirPath, o.fileName)
    const downloader: ModelDownloaderLike = {
      entrypointFilePath: target,
      totalSize: finalSize,
      downloadedSize: finalSize,
      async download() {
        if (opts?.fail) {
          // Simulate an interrupted transfer that left a partial file on disk.
          if (opts.partialSize != null) sizes.set(target, opts.partialSize)
          throw new Error('network unreachable')
        }
        const steps = opts?.progress ?? [finalSize / 2, finalSize]
        for (const downloadedSize of steps) {
          o.onProgress?.({ totalSize: finalSize, downloadedSize })
        }
        sizes.set(target, finalSize)
      }
    }
    return downloader
  }
  return { create, created }
}

function path(fileName: string): string {
  return join(MODELS_DIR, fileName)
}

const DEFAULT_FILE = 'qwen2.5-1.5b-instruct-q4_k_m.gguf'

// ─── Catalog / paths ───────────────────────────────────────────────────────────────

describe('catalog + paths', () => {
  it('lists all built-in tier models with the default active and correct presence', () => {
    const { fs } = makeFs({ [path(DEFAULT_FILE)]: VALID_SIZE })
    const mgr = new ModelManager({ modelsDir: MODELS_DIR }, { fs })
    const models = mgr.listModels()
    expect(models).toHaveLength(3)
    expect(models[0].id).toBe(DEFAULT_MODEL_ID)
    expect(models[0].active).toBe(true)
    expect(models[0].present).toBe(true)
    const light = models.find((m) => m.id === LIGHT_MODEL_ID)
    expect(light?.present).toBe(false)
    expect(light?.active).toBe(false)
    const quality = models.find((m) => m.id === QUALITY_MODEL_ID)
    expect(quality?.present).toBe(false)
    expect(quality?.active).toBe(false)
  })

  it('computes the model path inside the models dir', () => {
    const { fs } = makeFs()
    const mgr = new ModelManager({ modelsDir: MODELS_DIR }, { fs })
    expect(mgr.modelPath(DEFAULT_MODEL_ID)).toBe(path(DEFAULT_FILE))
  })

  it('defaults to the catalog default when given an unknown active id', () => {
    const { fs } = makeFs()
    const mgr = new ModelManager({ modelsDir: MODELS_DIR, activeModelId: 'nope' }, { fs })
    expect(mgr.getActiveModelId()).toBe(DEFAULT_MODEL_ID)
  })
})

// ─── Presence ──────────────────────────────────────────────────────────────────────

describe('isModelPresent', () => {
  it('is false when missing and true when a full-size file exists', () => {
    const { fs, sizes } = makeFs()
    const mgr = new ModelManager({ modelsDir: MODELS_DIR }, { fs })
    expect(mgr.isModelPresent(DEFAULT_MODEL_ID)).toBe(false)
    sizes.set(path(DEFAULT_FILE), VALID_SIZE)
    expect(mgr.isModelPresent(DEFAULT_MODEL_ID)).toBe(true)
  })

  it('treats a truncated partial download as absent (the cache-poison fix)', () => {
    // 50 MB would have PASSED the old flat 1 MB floor → "present" → never re-downloaded
    // → load_failed forever. It must now read as absent so ensureModel re-downloads it.
    const { fs } = makeFs({ [path(DEFAULT_FILE)]: TRUNCATED_SIZE })
    const mgr = new ModelManager({ modelsDir: MODELS_DIR }, { fs })
    expect(mgr.isModelPresent(DEFAULT_MODEL_ID)).toBe(false)
  })

  it('getActiveModelPath returns null when absent and the path when present', () => {
    const { fs, sizes } = makeFs()
    const mgr = new ModelManager({ modelsDir: MODELS_DIR }, { fs })
    expect(mgr.getActiveModelPath()).toBeNull()
    sizes.set(path(DEFAULT_FILE), VALID_SIZE)
    expect(mgr.getActiveModelPath()).toBe(path(DEFAULT_FILE))
  })
})

// ─── setActiveModel ─────────────────────────────────────────────────────────────────

describe('setActiveModel', () => {
  it('switches to a known model and rejects an unknown one', () => {
    const { fs } = makeFs()
    const mgr = new ModelManager({ modelsDir: MODELS_DIR }, { fs })
    expect(mgr.setActiveModel(LIGHT_MODEL_ID)).toBe(true)
    expect(mgr.getActiveModelId()).toBe(LIGHT_MODEL_ID)
    expect(mgr.setActiveModel('bogus')).toBe(false)
    expect(mgr.getActiveModelId()).toBe(LIGHT_MODEL_ID)
  })
})

// ─── ensureModel: cached (offline) ──────────────────────────────────────────────────

describe('ensureModel — already present', () => {
  it('skips download entirely and reports cached with a done progress event', async () => {
    const { fs, sizes } = makeFs({ [path(DEFAULT_FILE)]: VALID_SIZE })
    const { create, created } = makeDownloader(sizes)
    const mgr = new ModelManager({ modelsDir: MODELS_DIR }, { fs, createDownloader: create })

    const events: ModelDownloadProgress[] = []
    const result = await mgr.ensureModel(DEFAULT_MODEL_ID, (p) => events.push(p))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.cached).toBe(true)
      expect(result.path).toBe(path(DEFAULT_FILE))
    }
    expect(created).toHaveLength(0) // NO network
    expect(events.at(-1)?.phase).toBe('done')
    expect(events.at(-1)?.ratio).toBe(1)
  })
})

// ─── ensureModel: download-on-first-run ──────────────────────────────────────────────

describe('ensureModel — missing', () => {
  it('downloads, reports progress, verifies and resolves the path', async () => {
    const { fs, sizes } = makeFs()
    const { create, created } = makeDownloader(sizes, { progress: [VALID_SIZE / 2, VALID_SIZE] })
    const mgr = new ModelManager({ modelsDir: MODELS_DIR }, { fs, createDownloader: create })

    const events: ModelDownloadProgress[] = []
    const result = await mgr.ensureModel(DEFAULT_MODEL_ID, (p) => events.push(p))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.cached).toBe(false)
      expect(result.path).toBe(path(DEFAULT_FILE))
    }
    expect(created).toHaveLength(1)
    // skipExisting:false → ipull writes an atomic .ipull temp + rename on completion
    // (resumable, and the final file never appears half-written even on a hard kill).
    expect(created[0].skipExisting).toBe(false)
    expect(created[0].dirPath).toBe(MODELS_DIR)

    const phases = events.map((e) => e.phase)
    expect(phases).toContain('resolving')
    expect(phases).toContain('downloading')
    expect(phases).toContain('verifying')
    expect(phases.at(-1)).toBe('done')

    // Mid-download ratio reflects bytes.
    const mid = events.find((e) => e.phase === 'downloading' && e.downloadedBytes === VALID_SIZE / 2)
    expect(mid?.ratio).toBeCloseTo(0.5)

    // File now present → a second ensure is cached (offline).
    expect(mgr.isModelPresent(DEFAULT_MODEL_ID)).toBe(true)
    const again = await mgr.ensureModel(DEFAULT_MODEL_ID)
    expect(again.ok && again.cached).toBe(true)
  })

  it('never throws on download failure — returns a failure result + error progress', async () => {
    const { fs, sizes } = makeFs()
    const { create } = makeDownloader(sizes, { fail: true })
    const mgr = new ModelManager({ modelsDir: MODELS_DIR }, { fs, createDownloader: create })

    const events: ModelDownloadProgress[] = []
    const result = await mgr.ensureModel(DEFAULT_MODEL_ID, (p) => events.push(p))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/network/i)
    expect(events.at(-1)?.phase).toBe('error')
    expect(mgr.isModelPresent(DEFAULT_MODEL_ID)).toBe(false)
  })

  it('deletes a partial file left by an interrupted download (no cache poison)', async () => {
    const { fs, sizes } = makeFs()
    // A 50 MB partial that would have passed the old 1 MB floor and poisoned the cache.
    const { create } = makeDownloader(sizes, { fail: true, partialSize: TRUNCATED_SIZE })
    const mgr = new ModelManager({ modelsDir: MODELS_DIR }, { fs, createDownloader: create })

    const result = await mgr.ensureModel(DEFAULT_MODEL_ID)
    expect(result.ok).toBe(false)
    // The partial must be removed so the next attempt re-downloads instead of load_failing.
    expect(sizes.has(path(DEFAULT_FILE))).toBe(false)
    expect(mgr.isModelPresent(DEFAULT_MODEL_ID)).toBe(false)
  })

  it('fails verification when the downloaded file is too small AND removes it', async () => {
    const { fs, sizes } = makeFs()
    const { create } = makeDownloader(sizes, { finalSize: 100 })
    const mgr = new ModelManager({ modelsDir: MODELS_DIR }, { fs, createDownloader: create })
    const result = await mgr.ensureModel(DEFAULT_MODEL_ID)
    expect(result.ok).toBe(false)
    expect(sizes.has(path(DEFAULT_FILE))).toBe(false)
  })

  it('de-dupes concurrent ensureModel calls into a single download', async () => {
    const { fs, sizes } = makeFs()
    const { create, created } = makeDownloader(sizes)
    const mgr = new ModelManager({ modelsDir: MODELS_DIR }, { fs, createDownloader: create })

    const [a, b] = await Promise.all([
      mgr.ensureModel(DEFAULT_MODEL_ID),
      mgr.ensureModel(DEFAULT_MODEL_ID)
    ])
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(created).toHaveLength(1)
  })

  it('reports an unknown model id as a failure', async () => {
    const { fs } = makeFs()
    const mgr = new ModelManager({ modelsDir: MODELS_DIR }, { fs })
    const result = await mgr.ensureModel('does-not-exist')
    expect(result.ok).toBe(false)
  })

  it('a throwing progress listener does not break the download', async () => {
    const { fs, sizes } = makeFs()
    const { create } = makeDownloader(sizes)
    const mgr = new ModelManager({ modelsDir: MODELS_DIR }, { fs, createDownloader: create })
    const result = await mgr.ensureModel(DEFAULT_MODEL_ID, () => {
      throw new Error('bad UI listener')
    })
    expect(result.ok).toBe(true)
  })
})

// ─── removeModel ───────────────────────────────────────────────────────────────────────

describe('removeModel', () => {
  it('deletes the file and reflects absence', async () => {
    const { fs, sizes } = makeFs({ [path(DEFAULT_FILE)]: VALID_SIZE })
    const mgr = new ModelManager({ modelsDir: MODELS_DIR }, { fs })
    expect(mgr.isModelPresent(DEFAULT_MODEL_ID)).toBe(true)
    const result = await mgr.removeModel(DEFAULT_MODEL_ID)
    expect(result.ok).toBe(true)
    expect(sizes.has(path(DEFAULT_FILE))).toBe(false)
    expect(mgr.isModelPresent(DEFAULT_MODEL_ID)).toBe(false)
  })

  it('never throws when removal fails', async () => {
    const { fs } = makeFs()
    const failingFs: ModelManagerFs = {
      ...fs,
      remove: async () => {
        throw new Error('EPERM')
      }
    }
    const mgr = new ModelManager({ modelsDir: MODELS_DIR }, { fs: failingFs })
    const result = await mgr.removeModel(DEFAULT_MODEL_ID)
    expect(result.ok).toBe(false)
  })
})

// ─── offline-friendly default ──────────────────────────────────────────────────────────

describe('offline-friendly', () => {
  it('does not call the downloader when the active model is already present', async () => {
    const { fs, sizes } = makeFs({ [path(DEFAULT_FILE)]: VALID_SIZE })
    let createCalls = 0
    const create: CreateModelDownloader = async (o) => {
      createCalls++
      return { entrypointFilePath: join(o.dirPath, o.fileName), async download() {} }
    }
    const mgr = new ModelManager({ modelsDir: MODELS_DIR }, { fs, createDownloader: create })
    await mgr.ensureModel()
    expect(createCalls).toBe(0)
    void sizes
  })
})
