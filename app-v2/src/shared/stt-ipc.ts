// Shared IPC contract for OFFLINE speech-to-text (whisper.cpp) + the "Oi, Engenheiro"
// wake-word feature.
//
// This file is dependency-free (no node:*, electron, whisper.cpp or React) so it can
// be imported by main, preload, renderer AND unit tests without dragging in any
// runtime — the same rule shared/engineer-ipc.ts and shared/ai.ts follow. It carries
// only the IPC channel names, the persisted config shape + merge, the model catalog
// ids and the status/progress payload contracts.
//
// ARCHITECTURE: STT is OFFLINE, on-demand and CPU-only. The whisper binary is bundled;
// the ggml model downloads on demand and every consumer GATES on its presence — if the
// model or the mic is absent the feature is simply INACTIVE and nothing else breaks.

// ─── Channels ────────────────────────────────────────────────────────────────
//
// Single `stt:` prefix so the preload allowlist needs exactly one entry (mirrors
// `engineer:` / `spotter:` / `tts:`). Request/response channels are renderer → main
// (`ipc.invoke`); the *Event channels are main → renderer broadcasts (`ipc.subscribe`).

export const STT_CHANNELS = {
  /** Renderer → Main: transcribe a captured PCM16 16k mono chunk. Resolves to text (''=none). */
  transcribe: 'stt:transcribe',
  /** Renderer → Main: read the persisted config. */
  getConfig: 'stt:getConfig',
  /** Renderer → Main: patch + persist the config. Resolves to the merged config. */
  setConfig: 'stt:setConfig',
  /** Renderer → Main: download/resolve the active ggml model (streams modelProgress). */
  ensureModel: 'stt:ensureModel',
  /** Renderer → Main: runtime availability snapshot (SttStatus). */
  status: 'stt:status',
  /** Main → Renderer: ggml model download progress (SttModelProgress). */
  modelProgress: 'stt:modelProgress',
  /** Main → Renderer: status changed (SttStatus) — e.g. after setConfig / model ready. */
  statusEvent: 'stt:statusEvent',
  /**
   * Renderer → Main: run the Silero VAD speech gate over a captured PCM16 16k mono chunk
   * BEFORE whisper. Resolves to SttVadResult — the renderer transcribes only when speech is
   * confirmed (or when the gate is unavailable, falling back to whisper-always-on).
   */
  vadDetect: 'stt:vadDetect',
  /** Renderer → Main: download/resolve the Silero VAD ONNX model on demand. */
  vadEnsureModel: 'stt:vadEnsureModel'
} as const

export type SttChannel = (typeof STT_CHANNELS)[keyof typeof STT_CHANNELS]

// ─── Model catalog ids ─────────────────────────────────────────────────────────

export type SttModelId = 'tiny' | 'base'

export const STT_MODEL_IDS: readonly SttModelId[] = ['tiny', 'base'] as const

export const DEFAULT_STT_MODEL_ID: SttModelId = 'tiny'

export function isSttModelId(value: unknown): value is SttModelId {
  return value === 'tiny' || value === 'base'
}

// ─── Persisted config (stt.json in userData) ───────────────────────────────────

export interface SttConfig {
  /** Master on/off for the wake-word listener. Default ON (mic still needs OS permission). */
  enabled: boolean
  /** Wake phrases matched case- AND accent-insensitively with a small edit-distance budget. */
  wakeWords: string[]
  /** Active ggml model id (tiny = fast/~75MB default, base = ~142MB more accurate). */
  model: SttModelId
  /** Transcription language hint passed to whisper ('pt' suits the PT-BR wake word; 'auto' detects). */
  language: string
  /**
   * Gate whisper behind the tiny Silero VAD ONNX net: only transcribe a captured segment
   * when speech is confirmed. Default ON. When the VAD model/addon is absent the gate is a
   * no-op and behaviour falls back to whisper-always-on (so this never causes a regression).
   */
  vadGate: boolean
  /** Epoch ms of the last write (stamped on save). */
  updatedAt?: number
}

export type SttConfigPatch = Partial<SttConfig>

export const DEFAULT_STT_WAKE_WORDS: readonly string[] = ['hey engineer', 'ok engineer', 'hello engineer'] as const

export const DEFAULT_STT_CONFIG: SttConfig = {
  enabled: true,
  wakeWords: [...DEFAULT_STT_WAKE_WORDS],
  model: DEFAULT_STT_MODEL_ID,
  language: 'pt',
  vadGate: true
}

function sanitizeWakeWords(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback]
  const cleaned = value
    .filter((w): w is string => typeof w === 'string')
    .map((w) => w.trim())
    .filter((w) => w.length > 0)
  // De-dupe (case-insensitively) while preserving order; never persist an empty list.
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of cleaned) {
    const key = w.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      out.push(w)
    }
  }
  return out.length > 0 ? out : [...fallback]
}

/** Validate + clamp a (partial) config onto a base. Pure — safe in any process. */
export function mergeSttConfig(base: SttConfig, patch: SttConfigPatch | null | undefined): SttConfig {
  const p = patch ?? {}
  return {
    enabled: typeof p.enabled === 'boolean' ? p.enabled : base.enabled,
    wakeWords: p.wakeWords !== undefined ? sanitizeWakeWords(p.wakeWords, base.wakeWords) : base.wakeWords,
    model: isSttModelId(p.model) ? p.model : base.model,
    language: typeof p.language === 'string' && p.language.trim().length > 0 ? p.language.trim() : base.language,
    vadGate: typeof p.vadGate === 'boolean' ? p.vadGate : base.vadGate,
    updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : base.updatedAt
  }
}

// ─── Model download progress ─────────────────────────────────────────────────────
//
// Mirrors shared/ai.ts ModelDownloadProgress phases, but keyed by the STT model id so
// the renderer can show a dedicated whisper-model progress bar without importing the
// LLM model ids.

export type SttModelPhase = 'resolving' | 'downloading' | 'verifying' | 'done' | 'error'

export interface SttModelProgress {
  model: SttModelId
  phase: SttModelPhase
  totalBytes: number
  downloadedBytes: number
  /** 0..1 fraction; 1 when done. */
  ratio: number
  /** Present when phase === 'error'. */
  error?: string
}

export type SttModelProgressListener = (progress: SttModelProgress) => void

// ─── Status payload ──────────────────────────────────────────────────────────────

/** Resolved value of `stt:status` and payload of `stt:statusEvent`. */
export interface SttStatus {
  /** Config master switch. */
  enabled: boolean
  /** Whether the bundled whisper binary is present (false on a dev/mac host). */
  binaryPresent: boolean
  /** Whether the active ggml model file is present on disk. */
  modelPresent: boolean
  /** True only when BOTH binary + model are present (i.e. transcription can run). */
  available: boolean
  /** Whether the Silero VAD ONNX model is present on disk (the speech gate before whisper). */
  vadModelPresent: boolean
  /** Active model id. */
  model: SttModelId
  config: SttConfig
}

// ─── Transcribe request ──────────────────────────────────────────────────────────

export interface SttTranscribeOptions {
  /** Language hint ('pt', 'en', 'auto', …). Defaults to the persisted config language. */
  language?: string
}

// ─── VAD gate result ─────────────────────────────────────────────────────────────

/** Resolved value of `stt:vadDetect`: the Silero VAD speech gate over a captured segment. */
export interface SttVadResult {
  /**
   * False when the gate is UNAVAILABLE (onnxruntime-node and/or the model absent, gate
   * disabled in config, or an inference error). The renderer treats `available: false` as
   * "gate off" and falls back to whisper-always-on — never silencing the wake word.
   */
  available: boolean
  /** Speech probability 0..1 (only meaningful when `available`). */
  probability: number
}
