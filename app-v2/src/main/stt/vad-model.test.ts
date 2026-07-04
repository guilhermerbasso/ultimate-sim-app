import { describe, expect, it, vi } from 'vitest'
import { VadModelManager, type VadModelFs, type VadStreamDownloader } from './vad-model'

// In-memory fs seam: tracks a single model file's size so presence-gating + atomic
// download can be unit-tested without touching disk or the network.
function memoryFs(initialSize?: number | null): { fs: VadModelFs; setSize: (n: number | null) => void } {
  let size: number | null = initialSize ?? null
  const fs: VadModelFs = {
    exists: () => size !== null,
    size: () => size,
    mkdir: async () => undefined,
    remove: async () => {
      size = null
    }
  }
  return { fs, setSize: (n) => (size = n) }
}

const MODELS_DIR = '/models'

describe('VadModelManager.isModelPresent', () => {
  it('is false when the file is missing', () => {
    const { fs } = memoryFs(null)
    const mgr = new VadModelManager({ modelsDir: MODELS_DIR }, { fs })
    expect(mgr.isModelPresent()).toBe(false)
  })

  it('is false when the file is truncated (a half-written .part)', () => {
    const { fs } = memoryFs(1000) // far below the ~1.8MB model
    const mgr = new VadModelManager({ modelsDir: MODELS_DIR }, { fs })
    expect(mgr.isModelPresent()).toBe(false)
  })

  it('is true when a full-size file is present', () => {
    const { fs } = memoryFs(2_300_000)
    const mgr = new VadModelManager({ modelsDir: MODELS_DIR }, { fs })
    expect(mgr.isModelPresent()).toBe(true)
  })
})

describe('VadModelManager.ensureModel', () => {
  it('returns immediately (cached, NO download) when already present', async () => {
    const { fs } = memoryFs(2_300_000)
    const download = vi.fn<VadStreamDownloader>(async () => undefined)
    const mgr = new VadModelManager({ modelsDir: MODELS_DIR }, { fs, download })
    const result = await mgr.ensureModel()
    expect(result.ok).toBe(true)
    expect(result.cached).toBe(true)
    expect(download).not.toHaveBeenCalled()
  })

  it('downloads on demand and reports done', async () => {
    const mem = memoryFs(null)
    const download = vi.fn<VadStreamDownloader>(async ({ onProgress }) => {
      onProgress?.({ totalBytes: 2_300_000, downloadedBytes: 2_300_000 })
      mem.setSize(2_327_524) // simulate the atomic rename landing a full file
    })
    const mgr = new VadModelManager({ modelsDir: MODELS_DIR }, { fs: mem.fs, download })
    const phases: string[] = []
    const result = await mgr.ensureModel((p) => phases.push(p.phase))
    expect(result.ok).toBe(true)
    expect(result.cached).toBe(false)
    expect(download).toHaveBeenCalledTimes(1)
    expect(phases).toContain('downloading')
    expect(phases.at(-1)).toBe('done')
  })

  it('treats a truncated download as a failure and removes it', async () => {
    const mem = memoryFs(null)
    const download = vi.fn<VadStreamDownloader>(async () => {
      mem.setSize(1000) // landed file is far too small → verification fails
    })
    const mgr = new VadModelManager({ modelsDir: MODELS_DIR }, { fs: mem.fs, download })
    const result = await mgr.ensureModel()
    expect(result.ok).toBe(false)
    expect(mgr.isModelPresent()).toBe(false) // poisoned cache cleaned up
  })

  it('shares a single in-flight download across concurrent callers', async () => {
    const mem = memoryFs(null)
    const holder: { resolve?: () => void } = {}
    const download = vi.fn<VadStreamDownloader>(
      () =>
        new Promise<void>((resolve) => {
          holder.resolve = () => {
            mem.setSize(2_327_524)
            resolve()
          }
        })
    )
    const mgr = new VadModelManager({ modelsDir: MODELS_DIR }, { fs: mem.fs, download })
    const a = mgr.ensureModel()
    const b = mgr.ensureModel()
    // Wait for the (async) download executor to actually run before releasing it.
    while (!holder.resolve) await new Promise((r) => setTimeout(r, 0))
    holder.resolve?.()
    const [ra, rb] = await Promise.all([a, b])
    expect(ra.ok).toBe(true)
    expect(rb.ok).toBe(true)
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('never throws when the downloader rejects — surfaces a Result', async () => {
    const mem = memoryFs(null)
    const download = vi.fn<VadStreamDownloader>(async () => {
      throw new Error('network down')
    })
    const mgr = new VadModelManager({ modelsDir: MODELS_DIR }, { fs: mem.fs, download })
    const result = await mgr.ensureModel()
    expect(result.ok).toBe(false)
    expect(result.error).toContain('network down')
  })
})
