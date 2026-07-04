// Shared, dependency-free contracts for the local "AI Race Engineer".
//
// IMPORTANT: this file must stay import-free (no `node:*`, no electron, no
// node-llama-cpp) so it can be imported by main, preload, renderer AND the unit
// tests without dragging in the native runtime. It carries ONLY types + plain
// data (the model catalog). The actual inference lives in src/main/ai/* (main
// process only). Mirrors the contract style of shared/logger.ts and shared/config-io.ts.

// ─── Models ─────────────────────────────────────────────────────────────────────

// Stable identifiers for the GGUF models the app knows how to run. The string
// union keeps autocomplete while `(string & {})` still allows a future/custom id
// without a type error.
export type ModelId =
  | 'qwen2.5-1.5b-instruct-q4'
  | 'qwen2.5-0.5b-instruct-q4'
  | 'llama-3.2-3b-instruct-q4'
  | (string & {})

// The three user-facing quality tiers. The UI groups the catalog by these so the
// user picks an intent ("balanced", "quality") instead of a raw filename:
//   • light    — smallest, fastest, weakest PCs (Qwen2.5 0.5B)
//   • balanced — the default; good PT-BR + tool calling, CPU-friendly (Qwen2.5 1.5B)
//   • quality  — strongest reasoning/PT-BR, download-on-demand, needs a stronger PC
//                (Llama 3.2 3B). Heavier RAM/CPU + ~2 GB download.
export type ModelTier = 'light' | 'balanced' | 'quality'

// Static metadata describing one downloadable/runnable model. Pure data — safe to
// read from any process.
export interface ModelInfo {
  id: ModelId
  /** Human-facing label for the settings UI. */
  label: string
  /**
   * Source URI understood by node-llama-cpp's resolver/downloader. Hugging Face
   * URIs (`hf:<user>/<model>:<quant>`) are preferred; a plain `https://…gguf`
   * URL also works.
   */
  uri: string
  /** Local filename inside the models directory. */
  fileName: string
  /** Approximate on-disk size in bytes (for progress + free-space estimates). */
  approxBytes: number
  /** Quantization label, e.g. `Q4_K_M`. */
  quant: string
  /** SPDX-ish license string, e.g. `Apache-2.0`. */
  license: string
  /** Recommended context window for this model (tokens). */
  contextSize: number
  /** Quality tier this model belongs to (drives the 3-tier picker in the UI). */
  tier: ModelTier
  /** The app default (exactly one entry should set this). */
  isDefault?: boolean
  /** The lighter fallback for very weak PCs (exactly one entry should set this). */
  isLight?: boolean
  notes?: string
}

export const DEFAULT_MODEL_ID: ModelId = 'qwen2.5-1.5b-instruct-q4'
export const LIGHT_MODEL_ID: ModelId = 'qwen2.5-0.5b-instruct-q4'
export const QUALITY_MODEL_ID: ModelId = 'llama-3.2-3b-instruct-q4'

// The built-in catalog. Kept as plain data so the renderer can render a model
// picker and the model-manager can resolve/download without any extra source.
export const AI_MODELS: Readonly<Record<ModelId, ModelInfo>> = {
  'qwen2.5-1.5b-instruct-q4': {
    id: 'qwen2.5-1.5b-instruct-q4',
    label: 'Qwen2.5 1.5B Instruct (Q4_K_M)',
    uri: 'hf:Qwen/Qwen2.5-1.5B-Instruct-GGUF:qwen2.5-1.5b-instruct-q4_k_m.gguf',
    fileName: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    approxBytes: 1_120_000_000,
    quant: 'Q4_K_M',
    license: 'Apache-2.0',
    contextSize: 2048,
    tier: 'balanced',
    isDefault: true,
    notes: 'Default race engineer. Good PT-BR + tool calling, ~1GB, CPU-friendly.'
  },
  'qwen2.5-0.5b-instruct-q4': {
    id: 'qwen2.5-0.5b-instruct-q4',
    label: 'Qwen2.5 0.5B Instruct (Q4_K_M)',
    uri: 'hf:Qwen/Qwen2.5-0.5B-Instruct-GGUF:qwen2.5-0.5b-instruct-q4_k_m.gguf',
    fileName: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
    approxBytes: 400_000_000,
    quant: 'Q4_K_M',
    license: 'Apache-2.0',
    contextSize: 2048,
    tier: 'light',
    isLight: true,
    notes: 'Lightweight fallback for very weak PCs (~400MB).'
  },
  'llama-3.2-3b-instruct-q4': {
    id: 'llama-3.2-3b-instruct-q4',
    label: 'Qualidade — Llama 3.2 3B (melhor raciocínio)',
    uri: 'hf:bartowski/Llama-3.2-3B-Instruct-GGUF:Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    fileName: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    approxBytes: 2_020_000_000,
    quant: 'Q4_K_M',
    license: 'Llama-3.2-Community',
    contextSize: 2048,
    tier: 'quality',
    notes: 'Tier qualidade: melhor raciocínio e PT-BR. ~2GB, download sob demanda, pede um PC mais forte (mais RAM/CPU).'
  }
} as const

/** Canonical low→high tier ordering for the picker. */
export const MODEL_TIER_ORDER: readonly ModelTier[] = ['light', 'balanced', 'quality'] as const

/** Maps each tier to its representative catalog model id. */
export const MODEL_TIERS: Readonly<Record<ModelTier, ModelId>> = {
  light: LIGHT_MODEL_ID,
  balanced: DEFAULT_MODEL_ID,
  quality: QUALITY_MODEL_ID
} as const

/** PT-BR labels for the tier picker (short, intuitive). */
export const MODEL_TIER_LABELS: Readonly<Record<ModelTier, string>> = {
  light: 'Leve',
  balanced: 'Equilibrado',
  quality: 'Qualidade'
} as const

/** Stable ordered list of built-in models (default first). */
export const AI_MODEL_LIST: readonly ModelInfo[] = [
  AI_MODELS[DEFAULT_MODEL_ID],
  AI_MODELS[LIGHT_MODEL_ID],
  AI_MODELS[QUALITY_MODEL_ID]
]

export function getModelInfo(id: ModelId): ModelInfo | undefined {
  return AI_MODELS[id]
}

// ─── Tool / function calling ─────────────────────────────────────────────────────
//
// Other agents (the "tools" agent) build tool definitions and hand them to the
// runtime. To keep THIS file dependency-free we describe them structurally; the
// shape is intentionally identical to what node-llama-cpp's
// `defineChatSessionFunction(...)` returns, so a record of either works. The
// runtime casts the record to node-llama-cpp's `ChatSessionModelFunctions`.

/** A minimal JSON-schema-ish parameter descriptor (subset of GBNF JSON schema). */
export interface AiToolParamsSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'
  [key: string]: unknown
}

/** One tool the model may call. Structurally compatible with node-llama-cpp. */
export interface AiToolDefinition<Result = unknown> {
  readonly description?: string
  readonly params?: AiToolParamsSchema
  readonly handler: (params: any) => Result | Promise<Result>
}

export type AiToolset = Readonly<Record<string, AiToolDefinition>>

// Identity helper so tool authors get a typed object without importing
// node-llama-cpp. `defineTool({ description, params, handler })` simply returns
// its argument — node-llama-cpp consumes the exact same shape.
export function defineTool<R>(def: AiToolDefinition<R>): AiToolDefinition<R> {
  return def
}

// ─── Generation request / result ─────────────────────────────────────────────────

export interface GenerateRequest {
  /** System prompt establishing the race-engineer persona/context. */
  system?: string
  /** The user/turn prompt to answer. */
  prompt: string
  /** Hard cap on generated tokens (the runtime also enforces its own default cap). */
  maxTokens?: number
  /** Sampling temperature (0 = deterministic). Defaults to the runtime's setting. */
  temperature?: number
  /** Optional tool definitions the model may call during generation. */
  functions?: AiToolset
  /** Caller-supplied cancellation. */
  signal?: AbortSignal
}

/** Why a generation stopped (mirrors node-llama-cpp stop reasons we care about). */
export type GenerateStopReason =
  | 'eogToken'
  | 'maxTokens'
  | 'stopGenerationTrigger'
  | 'customStopTrigger'
  | 'functionCalls'
  | 'abort'
  | 'unknown'

/** Machine-readable failure cause so callers/UI can react without parsing strings. */
export type GenerateErrorCode =
  | 'no_model' // no model path configured / model file missing
  | 'backend_missing' // native llama backend binary absent (NoBinaryFoundError) — reinstall/rebuild
  | 'load_failed' // model/context failed to load
  | 'generate_failed' // inference threw
  | 'timeout' // generation exceeded the runtime time budget
  | 'aborted' // caller aborted via signal
  | 'disposed' // runtime was disposed
  | 'busy' // queue rejected (should not normally happen — calls are serialized)

export interface GenerateOk {
  ok: true
  text: string
  /** Generated token count when known. */
  tokens?: number
  /** Wall-clock generation time in ms. */
  ms?: number
  /** Number of tool/function calls the model made. */
  functionCalls?: number
  stopReason?: GenerateStopReason
  modelId?: ModelId
}

export interface GenerateErr {
  ok: false
  error: string
  code: GenerateErrorCode
}

export type GenerateResult = GenerateOk | GenerateErr

// ─── Runtime status / options ─────────────────────────────────────────────────────

export type LlmStatus =
  | 'unloaded' // never loaded, or unloaded after idle/explicit unload
  | 'loading' // model/context loading
  | 'ready' // loaded and waiting
  | 'generating' // an inference is in flight
  | 'error' // last load/generate failed
  | 'disposed' // permanently torn down

export interface LlmRuntimeStatus {
  status: LlmStatus
  ready: boolean
  loading: boolean
  busy: boolean
  /** Active model file path, or null when none configured. */
  modelPath: string | null
  /** Epoch ms the model finished loading, or null. */
  loadedAt: number | null
  /** Epoch ms of the last successful generation, or null. */
  lastUsedAt: number | null
  /** Total successful generations since process start. */
  totalGenerations: number
  /** Pending (queued, not yet running) generation count. */
  queueLength: number
}

// Tunables injected by the orchestrator. All optional; the runtime fills sensible,
// resource-minimal defaults. Changing a model-affecting field (modelPath,
// contextSize, threads) while loaded triggers a transparent reload on next use.
export interface LlmRuntimeOptions {
  /** Absolute path to the GGUF file to load. */
  modelPath?: string
  /** Logical model id (for logging/telemetry only). */
  modelId?: ModelId
  /** CPU threads for evaluation. Default: min(4, max(1, cpuCount-2)). */
  threads?: number
  /** Context window (tokens). Default 2048. */
  contextSize?: number
  /** Default token cap for answers. Default 150. */
  maxTokens?: number
  /** Default sampling temperature. Default 0.3 (focused spoken answers). */
  temperature?: number
  /** Idle time (ms) before the model+context are disposed to free RAM. Default 180000. */
  idleUnloadMs?: number
  /** Per-generation time budget (ms) before aborting. Default 20000. */
  maxGenerateMs?: number
}

export const LLM_DEFAULTS = {
  contextSize: 2048,
  maxTokens: 150,
  temperature: 0.3,
  idleUnloadMs: 3 * 60 * 1000,
  maxGenerateMs: 20_000
} as const

// ─── Download progress ─────────────────────────────────────────────────────────────

export type ModelDownloadPhase =
  | 'resolving'
  | 'downloading'
  | 'verifying'
  | 'done'
  | 'error'

export interface ModelDownloadProgress {
  modelId: ModelId
  phase: ModelDownloadPhase
  totalBytes: number
  downloadedBytes: number
  /** 0..1 fraction; 1 when done. */
  ratio: number
  /** Present when phase === 'error'. */
  error?: string
}

export type ModelProgressListener = (progress: ModelDownloadProgress) => void

export interface EnsureModelOk {
  ok: true
  id: ModelId
  path: string
  /** True when the file was already present (no network used). */
  cached: boolean
}

export interface EnsureModelErr {
  ok: false
  id: ModelId
  error: string
}

export type EnsureModelResult = EnsureModelOk | EnsureModelErr

/** Runtime presence view of a catalog model (for settings UI). */
export interface ModelStatus extends ModelInfo {
  present: boolean
  active: boolean
  path: string
}
