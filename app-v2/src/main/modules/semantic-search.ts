// WS-K — Semantic search module. Wires the embedding engine + cosine index to
// the renderer over `search:*` IPC, and feeds the index from the app's EXISTING
// local stores (read straight off their userData files so this module stays
// decoupled from the modules that own them).
//
// Guarantees:
//  • Never blocks the UI: queries run against whatever is indexed; the model is
//    only downloaded when the user asks (`ensureModel`), and even then off-thread.
//  • Deterministic fallback: with the model absent, `query` returns keyword/fuzzy
//    results from the same index, so search works 100% offline with no download.
//  • Incremental + gated: documents are re-collected on demand; embeddings are
//    cached by content hash and only (re)computed when the model is ready.
//
// NOTE: This module is intentionally NOT auto-registered — see the INTEGRATION
// CONTRACT. Central wiring (preload allowlist, modules/index, view registry) is
// done by the integrator.

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ModuleContext } from '../module-context'
import { EmbeddingsEngine } from '../search/embeddings'
import { FlatCosineIndex } from '../search/semantic-index'
import {
  DEFAULT_SEMANTIC_SOURCES,
  SEMANTIC_MODEL_DIM,
  SEMANTIC_MODEL_ID,
  SEMANTIC_MODEL_SIZE_LABEL,
  SEMANTIC_SEARCH_CHANNELS,
  type SemanticDocument,
  type SemanticIndexStatus,
  type SemanticQueryArgs,
  type SemanticQueryResult,
  type SemanticSourceKind
} from '../../shared/semantic-search-ipc'

const CACHE_DIR = 'semantic-cache'
const VECTORS_FILE = 'semantic-index.json'
const COLLECT_TTL_MS = 15_000
const EMBED_BATCH = 16
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

export function register(ctx: ModuleContext): void {
  const userData = ctx.app.getPath('userData')
  const engine = new EmbeddingsEngine(join(userData, CACHE_DIR))
  const index = new FlatCosineIndex()
  const vectorsPath = join(userData, VECTORS_FILE)

  let lastCollectAt = 0
  let collecting: Promise<void> | null = null
  let embedding: Promise<void> | null = null

  void index.restore(vectorsPath)

  // Stream model download/load progress straight to the renderer.
  engine.onProgress((progress) => {
    ctx.broadcast(SEMANTIC_SEARCH_CHANNELS.modelProgress, progress)
  })

  // ─── Collection (documents) ───────────────────────────────────────────────

  const collect = async (): Promise<void> => {
    const docs: SemanticDocument[] = []
    for (const collector of COLLECTORS) {
      try {
        docs.push(...(await collector(userData)))
      } catch {
        // A failing/absent source must never break the whole index.
      }
    }
    for (const doc of docs) index.upsert(doc)
    index.prune(docs.map((d) => d.id))
    index.markIndexed(Date.now())
    lastCollectAt = Date.now()
  }

  const ensureFresh = async (force = false): Promise<void> => {
    if (!force && Date.now() - lastCollectAt < COLLECT_TTL_MS) return
    if (collecting) return collecting
    collecting = collect().finally(() => {
      collecting = null
    })
    return collecting
  }

  // ─── Embedding (gated on model readiness) ─────────────────────────────────

  const embedPending = async (): Promise<void> => {
    if (!engine.isReady()) return
    if (embedding) return embedding
    embedding = (async () => {
      const pending = index.pendingEmbedding()
      for (let i = 0; i < pending.length; i += EMBED_BATCH) {
        const batch = pending.slice(i, i + EMBED_BATCH)
        const vectors = await engine.embed(batch.map((d) => d.text))
        if (!vectors) break // model became unavailable mid-flight
        batch.forEach((doc, j) => index.setVector(doc.id, vectors[j]))
      }
      await index.persist(vectorsPath, SEMANTIC_MODEL_DIM).catch(() => undefined)
    })().finally(() => {
      embedding = null
    })
    return embedding
  }

  // ─── Status ───────────────────────────────────────────────────────────────

  const buildStatus = async (): Promise<SemanticIndexStatus> => {
    const modelAvailable = await engine.isAvailable()
    const modelReady = engine.isReady()
    return {
      modelReady,
      modelDownloading: engine.isLoading(),
      modelAvailable,
      mode: modelReady ? 'semantic' : 'keyword',
      documentCount: index.size(),
      sources: { ...DEFAULT_SEMANTIC_SOURCES, ...index.countsBySource() },
      lastIndexedAt: index.getLastIndexedAt(),
      modelId: SEMANTIC_MODEL_ID,
      modelSizeLabel: SEMANTIC_MODEL_SIZE_LABEL
    }
  }

  const broadcastStatus = async (): Promise<void> => {
    ctx.broadcast(SEMANTIC_SEARCH_CHANNELS.changed, await buildStatus())
  }

  // Warm the document index in the background (no model download involved).
  void ensureFresh(true).then(broadcastStatus).catch(() => undefined)

  // ─── IPC ────────────────────────────────────────────────────────────────

  ctx.ipcMain.handle(SEMANTIC_SEARCH_CHANNELS.status, async (): Promise<SemanticIndexStatus> => {
    await ensureFresh()
    return buildStatus()
  })

  ctx.ipcMain.handle(
    SEMANTIC_SEARCH_CHANNELS.query,
    async (_event, args: SemanticQueryArgs): Promise<SemanticQueryResult> => {
      const started = Date.now()
      const query = String(args?.query ?? '').trim()
      const limit = clampLimit(args?.limit)
      const sources = sanitizeSources(args?.sources)
      if (!query) {
        return { mode: engine.isReady() ? 'semantic' : 'keyword', results: [], modelReady: engine.isReady(), tookMs: 0 }
      }

      await ensureFresh()

      // Semantic path — only when the model is already loaded (never downloads
      // here). Embedding stragglers are filled in opportunistically.
      if (engine.isReady()) {
        await embedPending()
        const qvec = await engine.embedOne(query)
        if (qvec) {
          const results = index.queryByVector(qvec, limit, sources)
          if (results.length > 0) {
            return { mode: 'semantic', results, modelReady: true, tookMs: Date.now() - started }
          }
        }
      }

      // Deterministic fallback (model absent, still loading, or no semantic hits).
      const results = index.queryByKeyword(query, limit, sources)
      return { mode: 'keyword', results, modelReady: engine.isReady(), tookMs: Date.now() - started }
    }
  )

  ctx.ipcMain.handle(SEMANTIC_SEARCH_CHANNELS.ensureModel, async (): Promise<SemanticIndexStatus> => {
    await ensureFresh()
    const extractor = await engine.ensureModel()
    if (extractor) await embedPending()
    const status = await buildStatus()
    ctx.broadcast(SEMANTIC_SEARCH_CHANNELS.changed, status)
    return status
  })

  ctx.ipcMain.handle(SEMANTIC_SEARCH_CHANNELS.reindex, async (): Promise<SemanticIndexStatus> => {
    await ensureFresh(true)
    if (engine.isReady()) await embedPending()
    const status = await buildStatus()
    ctx.broadcast(SEMANTIC_SEARCH_CHANNELS.changed, status)
    return status
  })
}

// ─── Collectors ──────────────────────────────────────────────────────────────
//
// Each collector reads ONE existing store's userData file(s) and yields indexed
// documents. They are defensive: a missing or malformed file yields `[]`. Adding
// a new source = adding a collector here (incremental, no central edits).

type Collector = (userData: string) => Promise<SemanticDocument[]>

const COLLECTORS: Collector[] = [
  collectSetups,
  collectCommunity,
  collectDriverNotes,
  collectCoachFindings,
  collectEngineerNotes
]

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function joinText(parts: Array<string | undefined>): string {
  return parts.filter((p) => p && p.trim()).join(' · ').trim()
}

/** Setups: setup-manager.json → { items: Record<id, { car, track, notes, tags }> }. */
async function collectSetups(userData: string): Promise<SemanticDocument[]> {
  const data = (await readJson(join(userData, 'setup-manager.json')).catch(() => null)) as {
    items?: Record<string, { car?: string; track?: string; notes?: string; tags?: unknown; updatedAt?: number }>
  } | null
  if (!data?.items) return []
  const out: SemanticDocument[] = []
  for (const [id, meta] of Object.entries(data.items)) {
    const car = asString(meta?.car)
    const track = asString(meta?.track)
    const notes = asString(meta?.notes)
    const tags = Array.isArray(meta?.tags) ? meta!.tags.filter((t): t is string => typeof t === 'string') : []
    const text = joinText([car, track, tags.join(' '), notes])
    if (!text) continue
    out.push({
      id: `setup:${id}`,
      source: 'setup',
      title: joinText([car, track]) || id,
      snippet: notes || joinText([car, track, tags.join(', ')]),
      text,
      updatedAt: typeof meta?.updatedAt === 'number' ? meta.updatedAt : 0,
      ref: id
    })
  }
  return out
}

/** Community: userData/community/*.simshare → ghost / telemetry / setup packs. */
async function collectCommunity(userData: string): Promise<SemanticDocument[]> {
  const dir = join(userData, 'community')
  const entries = await readdir(dir).catch(() => [] as string[])
  const out: SemanticDocument[] = []
  for (const name of entries) {
    if (!name.endsWith('.simshare')) continue
    const pack = (await readJson(join(dir, name)).catch(() => null)) as {
      id?: string
      kind?: string
      meta?: { car?: string; track?: string; trackConfig?: string; note?: string; author?: string; createdAt?: number }
    } | null
    if (!pack?.id) continue
    const kind = pack.kind === 'ghost' || pack.kind === 'telemetry' || pack.kind === 'setup' ? pack.kind : 'ghost'
    const meta = pack.meta ?? {}
    const car = asString(meta.car)
    const track = joinText([asString(meta.track), asString(meta.trackConfig)])
    const note = asString(meta.note)
    const author = asString(meta.author)
    const text = joinText([car, track, note, author])
    if (!text) continue
    out.push({
      id: `community:${pack.id}`,
      source: kind as SemanticSourceKind,
      title: joinText([car, track]) || pack.id,
      snippet: note || joinText([car, track, author ? `por ${author}` : '']),
      text,
      updatedAt: typeof meta.createdAt === 'number' ? meta.createdAt : 0,
      ref: pack.id
    })
  }
  return out
}

/** Driver notes: driver-notes.json → { notes: [{ custId, tag, note }] }. */
async function collectDriverNotes(userData: string): Promise<SemanticDocument[]> {
  const data = (await readJson(join(userData, 'driver-notes.json')).catch(() => null)) as {
    notes?: Array<{ custId?: number; tag?: string; note?: string; updatedAt?: number }>
  } | null
  const notes = Array.isArray(data?.notes) ? data!.notes : []
  const out: SemanticDocument[] = []
  for (const n of notes) {
    const custId = typeof n?.custId === 'number' ? n.custId : null
    if (custId === null) continue
    const note = asString(n?.note)
    const tag = asString(n?.tag)
    const text = joinText([note, tag])
    if (!text) continue
    out.push({
      id: `driver:${custId}`,
      source: 'driver-note',
      title: `Piloto #${custId}`,
      snippet: joinText([note, tag ? `(${tag})` : '']),
      text,
      updatedAt: typeof n?.updatedAt === 'number' ? n.updatedAt : 0,
      ref: String(custId)
    })
  }
  return out
}

/**
 * Coach findings (optional). If another module persists ranked findings to
 * `coach-findings.json` (shape: `{ findings: [{ id?, title?, summary?/message?,
 * car?, track?, updatedAt? }] }`), index them; otherwise yield nothing.
 */
async function collectCoachFindings(userData: string): Promise<SemanticDocument[]> {
  const data = (await readJson(join(userData, 'coach-findings.json')).catch(() => null)) as {
    findings?: Array<Record<string, unknown>>
  } | null
  const findings = Array.isArray(data?.findings) ? data!.findings : []
  const out: SemanticDocument[] = []
  findings.forEach((f, i) => {
    const id = asString(f.id) || String(i)
    const title = asString(f.title) || asString(f.kind) || 'Achado'
    const body = asString(f.summary) || asString(f.message) || asString(f.explanation)
    const ctx = joinText([asString(f.car), asString(f.track)])
    const text = joinText([title, body, ctx])
    if (!text) return
    out.push({
      id: `coach:${id}`,
      source: 'coach-finding',
      title,
      snippet: body || ctx || title,
      text,
      updatedAt: typeof f.updatedAt === 'number' ? f.updatedAt : 0
    })
  })
  return out
}

/**
 * Engineer notes / transcripts (optional). If a transcript log exists at
 * `engineer-transcript.json` (shape: `{ entries: [{ id?, role?, text?, at? }] }`),
 * index the meaningful lines; otherwise yield nothing.
 */
async function collectEngineerNotes(userData: string): Promise<SemanticDocument[]> {
  const data = (await readJson(join(userData, 'engineer-transcript.json')).catch(() => null)) as {
    entries?: Array<{ id?: unknown; role?: unknown; text?: unknown; at?: unknown }>
  } | null
  const entries = Array.isArray(data?.entries) ? data!.entries : []
  const out: SemanticDocument[] = []
  entries.forEach((e, i) => {
    const text = asString(e?.text)
    if (!text) return
    const id = asString(e?.id) || String(i)
    const role = asString(e?.role)
    out.push({
      id: `engineer:${id}`,
      source: 'engineer-note',
      title: role ? `Engenheiro · ${role}` : 'Engenheiro IA',
      snippet: text,
      text,
      updatedAt: typeof e?.at === 'number' ? e.at : 0
    })
  })
  return out
}

function clampLimit(limit: unknown): number {
  const n = typeof limit === 'number' && Number.isFinite(limit) ? Math.floor(limit) : DEFAULT_LIMIT
  return Math.max(1, Math.min(MAX_LIMIT, n))
}

function sanitizeSources(sources: unknown): SemanticSourceKind[] | undefined {
  if (!Array.isArray(sources)) return undefined
  const valid: SemanticSourceKind[] = ['setup', 'ghost', 'telemetry', 'driver-note', 'coach-finding', 'engineer-note']
  const set = new Set(valid)
  const filtered = sources.filter((s): s is SemanticSourceKind => typeof s === 'string' && set.has(s as SemanticSourceKind))
  return filtered.length ? filtered : undefined
}
