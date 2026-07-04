import { describe, expect, it, vi } from 'vitest'
import { VadEngine, type OrtBackend, type OrtSessionLike, type OrtTensorLike } from './vad'
import type { VadModelManager } from './vad-model'

// A models manager stub: present/absent toggle + a fixed path.
function fakeModels(present: boolean): VadModelManager {
  return {
    modelPath: () => '/models/silero-vad.onnx',
    isModelPresent: () => present
  } as unknown as VadModelManager
}

// A fake Silero session: emits a constant probability per frame and echoes a [2,1,128]
// state so the engine's state-carry path is exercised.
function fakeBackend(probability: number, opts?: { onRun?: () => void }): OrtBackend {
  const STATE = 2 * 1 * 128
  const session: OrtSessionLike = {
    inputNames: ['input', 'state', 'sr'],
    outputNames: ['output', 'stateN'],
    run: async () => {
      opts?.onRun?.()
      return {
        output: { data: new Float32Array([probability]), dims: [1, 1] },
        stateN: { data: new Float32Array(STATE), dims: [2, 1, 128] }
      } as Record<string, OrtTensorLike>
    }
  }
  return {
    createSession: async () => session,
    float32: (data, dims) => ({ data, dims }),
    int64: (data, dims) => ({ data, dims })
  }
}

// One second of 16k PCM16 silence (enough for several 512-sample windows).
function pcm(lengthSamples: number): Uint8Array {
  return new Uint8Array(lengthSamples * 2)
}

describe('VadEngine.detect', () => {
  it('returns the aggregated speech probability when the backend is available', async () => {
    const engine = new VadEngine({ models: fakeModels(true), backendLoader: async () => fakeBackend(0.87) })
    const prob = await engine.detect(pcm(16000))
    expect(prob).toBeCloseTo(0.87, 5)
    expect(engine.isReady()).toBe(true)
  })

  it('returns null (gate unavailable) when the model is absent — never loads the backend', async () => {
    const loader = vi.fn(async () => fakeBackend(0.9))
    const engine = new VadEngine({ models: fakeModels(false), backendLoader: loader })
    expect(await engine.detect(pcm(16000))).toBeNull()
    expect(loader).not.toHaveBeenCalled()
    expect(engine.isReady()).toBe(false)
  })

  it('falls back to null when onnxruntime-node is missing (loader throws) and caches the failure', async () => {
    const loader = vi.fn(async () => {
      throw new Error('Cannot find module onnxruntime-node')
    })
    const engine = new VadEngine({ models: fakeModels(true), backendLoader: loader })
    expect(await engine.detect(pcm(16000))).toBeNull()
    expect(await engine.detect(pcm(16000))).toBeNull()
    // The import is attempted once then the failure is cached (no per-frame retries).
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('returns 0 for an empty/too-short buffer when available', async () => {
    const engine = new VadEngine({ models: fakeModels(true), backendLoader: async () => fakeBackend(0.99) })
    expect(await engine.detect(new Uint8Array(0))).toBe(0)
  })

  it('serializes detections (single-flight) and reuses one session', async () => {
    let createdSessions = 0
    const backend: OrtBackend = {
      createSession: async () => {
        createdSessions += 1
        return {
          inputNames: ['input', 'state', 'sr'],
          outputNames: ['output', 'stateN'],
          run: async () => ({
            output: { data: new Float32Array([0.6]), dims: [1, 1] },
            stateN: { data: new Float32Array(256), dims: [2, 1, 128] }
          })
        }
      },
      float32: (data, dims) => ({ data, dims }),
      int64: (data, dims) => ({ data, dims })
    }
    const engine = new VadEngine({ models: fakeModels(true), backendLoader: async () => backend })
    const [a, b] = await Promise.all([engine.detect(pcm(2048)), engine.detect(pcm(2048))])
    expect(a).toBeCloseTo(0.6, 5)
    expect(b).toBeCloseTo(0.6, 5)
    expect(createdSessions).toBe(1)
  })
})
