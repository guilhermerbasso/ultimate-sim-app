// Silero VAD speech-probability engine (ONNX, onnxruntime-node) — main process ONLY.
//
// This is the CHEAP SPEECH GATE that runs BEFORE whisper. The renderer's energy-based
// VAD (wake-word-core.ts) is a coarse pre-filter: it opens a "segment" whenever frame
// RMS crosses a threshold, which engine noise, wind buffeting and mechanical clicks all
// trip. Running whisper.cpp (a 75 MB model in a spawned subprocess) on every such
// segment is wasteful on a CPU already busy feeding the GPU. This module runs a tiny
// (~1.8 MB) Silero VAD net over the captured segment and returns a speech PROBABILITY so
// the caller only invokes whisper when real human speech is confirmed.
//
// DEPENDENCY POSTURE — onnxruntime-node is an OPTIONAL native addon. It is loaded with a
// runtime dynamic import behind a loader SEAM (mirroring ai/llm-runtime.ts's node-llama-cpp
// backend). If the addon is NOT installed (or the model is absent), isReady() is false,
// detect() returns `null`, and the caller FALLS BACK to whisper-always-on — exactly today's
// behaviour, no regression. Nothing here ever throws into the IPC layer.
//
// CPU-ONLY, SINGLE-FLIGHT, SESSION-CACHED: the ONNX session is created once on first use
// and reused; detections are serialized so two inference runs never overlap.

import type { VadModelManager } from './vad-model'
import { aggregateSpeechProbability, frameAudioForVad, pcm16ToFloat32, VAD_FRAME_SIZE_16K } from './vad-core'

// ─── Minimal structural typing for onnxruntime-node ────────────────────────────────
//
// onnxruntime-node may not be installed, so we DO NOT import its types. These cover only
// the surface we use; the default loader casts the real module to this shape.

export interface OrtTensorLike {
  data: Float32Array | BigInt64Array
  dims: readonly number[]
}

export interface OrtSessionLike {
  readonly inputNames: readonly string[]
  readonly outputNames: readonly string[]
  run(feeds: Record<string, OrtTensorLike>): Promise<Record<string, OrtTensorLike>>
}

export interface OrtBackend {
  createSession(modelPath: string): Promise<OrtSessionLike>
  /** Build a tensor (float32 or int64) of the given shape. */
  float32(data: Float32Array, dims: readonly number[]): OrtTensorLike
  int64(data: BigInt64Array, dims: readonly number[]): OrtTensorLike
}

export type OrtBackendLoader = () => Promise<OrtBackend>

// Real backend: a lazy dynamic import so the native addon is only touched on first use.
// The module specifier is a VARIABLE on purpose — onnxruntime-node is an OPTIONAL dep that
// may be absent, and a literal specifier would make `tsc` fail to resolve it. This is the
// ONLY place onnxruntime-node is referenced.
const defaultBackendLoader: OrtBackendLoader = async () => {
  const specifier = 'onnxruntime-node'
  const ort = (await import(/* @vite-ignore */ specifier)) as unknown as {
    InferenceSession: { create(path: string): Promise<OrtSessionLike> }
    Tensor: new (type: string, data: Float32Array | BigInt64Array, dims: readonly number[]) => OrtTensorLike
  }
  return {
    createSession: (modelPath) => ort.InferenceSession.create(modelPath),
    float32: (data, dims) => new ort.Tensor('float32', data, dims),
    int64: (data, dims) => new ort.Tensor('int64', data, dims)
  }
}

// ─── Engine ────────────────────────────────────────────────────────────────────────

// Silero VAD v5 processes fixed-size windows and carries a recurrent state [2,1,128]
// across calls within one segment. 16 kHz mono is the canonical input.
const SAMPLE_RATE = 16000
const STATE_DIMS = [2, 1, 128] as const
const STATE_SIZE = STATE_DIMS[0] * STATE_DIMS[1] * STATE_DIMS[2]

export interface VadEngineDeps {
  models: VadModelManager
  /** Override the onnxruntime-node backend (tests inject a fake; absent dep → loader throws). */
  backendLoader?: OrtBackendLoader
  /** Optional debug logger; defaults to a silent no-op. */
  onDebug?: (message: string, meta?: Record<string, unknown>) => void
}

export class VadEngine {
  private readonly models: VadModelManager
  private readonly backendLoader: OrtBackendLoader
  private readonly onDebug: (message: string, meta?: Record<string, unknown>) => void

  private backend: OrtBackend | null = null
  private session: OrtSessionLike | null = null
  // Set once we know the addon is missing/broken so we stop retrying the import per call.
  private backendUnavailable = false
  // Single-flight: chain detections so two ONNX runs never overlap (would spike CPU).
  private queue: Promise<unknown> = Promise.resolve()

  constructor(deps: VadEngineDeps) {
    this.models = deps.models
    this.backendLoader = deps.backendLoader ?? defaultBackendLoader
    this.onDebug = deps.onDebug ?? (() => undefined)
  }

  /** True only when onnxruntime-node loaded AND the model is on disk AND a session exists. */
  isReady(): boolean {
    return this.session !== null
  }

  /** True when the model file is present (the addon may still be missing). */
  isModelPresent(): boolean {
    return this.models.isModelPresent()
  }

  // Lazily load the addon + create the ONNX session. Idempotent; caches the failure so a
  // missing addon/model isn't retried on every frame. Never throws.
  private async ensureSession(): Promise<OrtSessionLike | null> {
    if (this.session) return this.session
    if (this.backendUnavailable) return null
    if (!this.models.isModelPresent()) return null
    try {
      if (!this.backend) this.backend = await this.backendLoader()
      this.session = await this.backend.createSession(this.models.modelPath())
      this.onDebug('vad session ready', { path: this.models.modelPath() })
      return this.session
    } catch (error) {
      this.backendUnavailable = true
      this.onDebug('vad backend unavailable — falling back to whisper-always-on', {
        message: error instanceof Error ? error.message : String(error)
      })
      return null
    }
  }

  /**
   * Compute the speech probability (0..1) for a captured PCM16 16 kHz mono buffer, or
   * `null` when the gate is UNAVAILABLE (addon/model absent, or an inference error). A
   * `null` return MUST be treated by the caller as "gate off" → proceed to whisper, so a
   * missing model never silences the wake word. Single-flight + never throws.
   */
  detect(pcm: Uint8Array): Promise<number | null> {
    const run = this.queue.then(
      () => this.detectNow(pcm),
      () => this.detectNow(pcm)
    )
    this.queue = run.catch(() => undefined)
    return run
  }

  private async detectNow(pcm: Uint8Array): Promise<number | null> {
    const session = await this.ensureSession()
    if (!session || !this.backend) return null
    try {
      const samples = pcm16ToFloat32(pcm)
      const frames = frameAudioForVad(samples, VAD_FRAME_SIZE_16K)
      if (frames.length === 0) return 0

      const inName = session.inputNames[0] ?? 'input'
      const srName = pickName(session.inputNames, 'sr') ?? 'sr'
      const stateInName = pickName(session.inputNames, 'state', 'h') ?? 'state'

      let state = this.backend.float32(new Float32Array(STATE_SIZE), STATE_DIMS)
      const sr = this.backend.int64(BigInt64Array.from([BigInt(SAMPLE_RATE)]), [1])
      const probs: number[] = []

      for (const frame of frames) {
        const input = this.backend.float32(frame, [1, frame.length])
        const feeds: Record<string, OrtTensorLike> = { [inName]: input, [srName]: sr, [stateInName]: state }
        const results = await session.run(feeds)
        const { prob, nextState } = readVadOutputs(results, session.outputNames)
        probs.push(prob)
        if (nextState) state = nextState
      }

      return aggregateSpeechProbability(probs)
    } catch (error) {
      this.onDebug('vad detect error — falling back', {
        message: error instanceof Error ? error.message : String(error)
      })
      return null
    }
  }
}

/** First input/output name that contains any of the given substrings (case-insensitive). */
function pickName(names: readonly string[], ...needles: string[]): string | undefined {
  return names.find((n) => needles.some((needle) => n.toLowerCase().includes(needle.toLowerCase())))
}

// Read the speech probability + the recurrent state from a model's run() outputs without
// relying on exact names: the probability output has size 1, the state output has size 256.
function readVadOutputs(
  results: Record<string, OrtTensorLike>,
  outputNames: readonly string[]
): { prob: number; nextState: OrtTensorLike | null } {
  let prob = 0
  let nextState: OrtTensorLike | null = null
  for (const name of outputNames) {
    const tensor = results[name]
    if (!tensor) continue
    if (tensor.data.length === STATE_SIZE) {
      nextState = tensor
    } else if (tensor.data.length >= 1) {
      const value = Number(tensor.data[0])
      if (Number.isFinite(value)) prob = value
    }
  }
  // Clamp into 0..1 (defensive; the model already emits a sigmoid).
  return { prob: prob < 0 ? 0 : prob > 1 ? 1 : prob, nextState }
}
