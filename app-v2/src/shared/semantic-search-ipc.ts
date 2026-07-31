// Shared IPC contract for WS-K "Busca semântica" (local semantic search over
// setups, ghosts/telemetry, driver notes, engineer/coach findings).
//
// Dependency-free (no node:*, electron, @huggingface/transformers or React) so it
// can be imported by main, preload, renderer AND unit tests without dragging in the
// native ONNX runtime — same rule shared/ai.ts / shared/engineer-ipc.ts follow.
// It carries only the channel names, the model constants and the payload shapes.

// ─── Model ─────────────────────────────────────────────────────────────────
//
// A small MULTILINGUAL sentence-embedding model (the user writes pt-BR). Pulled
// on demand by Transformers.js from the Hugging Face hub and cached on disk; the
// app NEVER ships it. Absent → the module falls back to deterministic keyword
// search, so everything works 100% offline with zero downloads too.

/** Hugging Face repo id loaded through `@huggingface/transformers` (ONNX, CPU). */
export const SEMANTIC_MODEL_ID = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'

/**
 * ONNX weight precision requested from the hub — selects `onnx/model_quantized.onnx`
 * (~113 MB int8) instead of the fp32 export (~470 MB).
 *
 * This MUST be passed explicitly. Transformers.js v2 took `{ quantized: true }` and
 * defaulted to the quantized weights; v3 replaced that flag with `dtype` and defaults
 * to fp32, and it IGNORES the old flag rather than erroring. Omitting it therefore
 * silently quadruples the download and the resident memory while still "working".
 */
export const SEMANTIC_MODEL_DTYPE = 'q8'

/** Embedding dimensionality of the model above (MiniLM-L12 → 384). */
export const SEMANTIC_MODEL_DIM = 384

/** Human-friendly download size shown in the UI ("baixar modelo (~470 MB)"). */
export const SEMANTIC_MODEL_SIZE_LABEL = '~470 MB'

// ─── Channels ─────────────────────────────────────────────────────────────
//
// Single `search:` prefix so the preload allowlist needs exactly one entry.
// Request/response channels are renderer → main (`ipc.invoke`); the *Event
// channels are main → renderer broadcasts (`ipc.subscribe`).
export const SEMANTIC_SEARCH_CHANNELS = {
  /** Renderer → Main: index + model status snapshot (SemanticIndexStatus). */
  status: 'search:status',
  /** Renderer → Main: run a query (SemanticQueryArgs → SemanticQueryResult). */
  query: 'search:query',
  /** Renderer → Main: download/resolve the model (streams modelProgress). */
  ensureModel: 'search:ensureModel',
  /** Renderer → Main: rebuild the document index from the live stores. */
  reindex: 'search:reindex',
  /** Main → Renderer: model download/load progress (SemanticModelProgress). */
  modelProgress: 'search:modelProgress',
  /** Main → Renderer: index/model status changed (SemanticIndexStatus). */
  changed: 'search:changed'
} as const

export type SemanticSearchChannel =
  (typeof SEMANTIC_SEARCH_CHANNELS)[keyof typeof SEMANTIC_SEARCH_CHANNELS]

// ─── Sources ─────────────────────────────────────────────────────────────

/** Where an indexed document came from. */
export type SemanticSourceKind =
  | 'setup'
  | 'ghost'
  | 'telemetry'
  | 'driver-note'
  | 'coach-finding'
  | 'engineer-note'

export const SEMANTIC_SOURCE_LABELS: Record<SemanticSourceKind, string> = {
  setup: 'Setup',
  ghost: 'Ghost lap',
  telemetry: 'Telemetria',
  'driver-note': 'Nota de piloto',
  'coach-finding': 'Achado do Coach',
  'engineer-note': 'Nota do Engenheiro'
}

// ─── Documents & results ────────────────────────────────────────────────────

/** One indexed unit. `text` is what gets embedded; `snippet` is shown to the user. */
export interface SemanticDocument {
  id: string
  source: SemanticSourceKind
  title: string
  snippet: string
  text: string
  updatedAt: number
  /** Optional opaque reference (e.g. setup path / share id) for the UI to act on. */
  ref?: string
}

/** Whether a result came from cosine similarity or the deterministic fallback. */
export type SemanticSearchMode = 'semantic' | 'keyword'

export interface SemanticSearchResult {
  id: string
  source: SemanticSourceKind
  title: string
  snippet: string
  /** 0..1 relevance (cosine for semantic, normalized term overlap for keyword). */
  score: number
  mode: SemanticSearchMode
  ref?: string
}

// ─── Query ──────────────────────────────────────────────────────────────────

export interface SemanticQueryArgs {
  query: string
  /** Max results (clamped server-side). */
  limit?: number
  /** Optional filter to a subset of sources. */
  sources?: SemanticSourceKind[]
}

export interface SemanticQueryResult {
  mode: SemanticSearchMode
  results: SemanticSearchResult[]
  /** Echoes whether the model was available for this query. */
  modelReady: boolean
  /** Wall-clock time spent, ms (best effort). */
  tookMs: number
}

// ─── Status & progress ──────────────────────────────────────────────────────

export type SemanticModelPhase =
  | 'idle'
  | 'downloading'
  | 'loading'
  | 'ready'
  | 'unavailable'
  | 'error'

export interface SemanticModelProgress {
  phase: SemanticModelPhase
  /** Current file being fetched, when known. */
  file?: string
  loadedBytes: number
  totalBytes: number
  /** 0..1 fraction; 1 when done. */
  ratio: number
  /** Present when phase === 'error'. */
  error?: string
}

export interface SemanticIndexStatus {
  /** True once the embedding model is loaded and queries run in semantic mode. */
  modelReady: boolean
  /** True while a download/load is in flight. */
  modelDownloading: boolean
  /** True when `@huggingface/transformers` is installed (model CAN be downloaded). */
  modelAvailable: boolean
  /** Active query mode if a search ran right now. */
  mode: SemanticSearchMode
  /** Total indexed documents. */
  documentCount: number
  /** Per-source document counts. */
  sources: Record<SemanticSourceKind, number>
  /** Epoch ms of the last successful (re)index, or 0. */
  lastIndexedAt: number
  modelId: string
  modelSizeLabel: string
}

export const DEFAULT_SEMANTIC_SOURCES: Record<SemanticSourceKind, number> = {
  setup: 0,
  ghost: 0,
  telemetry: 0,
  'driver-note': 0,
  'coach-finding': 0,
  'engineer-note': 0
}
