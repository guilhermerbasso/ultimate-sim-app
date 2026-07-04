// WS-K — Flat in-memory cosine index over the app's local documents, with a
// deterministic keyword/fuzzy fallback that works WITHOUT the embedding model.
//
// The math (normalize / cosine / top-k / keyword scoring / hashing) is PURE and
// exported for unit tests. The `FlatCosineIndex` class wires those into an
// incremental document store: vectors are cached by content hash so the model
// only ever embeds NEW or CHANGED text, and the cache persists to userData so a
// restart doesn't re-embed everything.
//
// Persistence is the ONLY side effect here (node:fs). Embedding itself is done by
// the caller (see embeddings.ts) and handed back via `setVector` — this file has
// no dependency on `@xenova/transformers`, so importing it (e.g. from a test) is
// always safe and offline.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  type SemanticDocument,
  type SemanticSearchMode,
  type SemanticSearchResult,
  type SemanticSourceKind
} from '../../shared/semantic-search-ipc'

// ─── Pure math ──────────────────────────────────────────────────────────────

/** L2-normalize a vector in place-safe fashion (returns a new array). Zero-safe. */
export function l2normalize(vec: readonly number[]): number[] {
  let sum = 0
  for (const v of vec) sum += v * v
  const norm = Math.sqrt(sum)
  if (norm <= 1e-12) return vec.map(() => 0)
  return vec.map((v) => v / norm)
}

/**
 * Cosine similarity in [-1, 1]. Assumes nothing about magnitude; computes the
 * full normalized dot product so callers can pass raw or pre-normalized vectors.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length)
  let dotProduct = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i++) {
    dotProduct += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  if (denom <= 1e-12) return 0
  return dotProduct / denom
}

/** Dot product of two equal-or-min-length vectors (use when both are normalized). */
export function dot(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length)
  let s = 0
  for (let i = 0; i < n; i++) s += a[i] * b[i]
  return s
}

/** Top-k by score, descending; stable for equal scores (keeps input order). */
export function topK<T>(items: readonly T[], score: (item: T) => number, k: number): T[] {
  const scored = items.map((item, i) => ({ item, s: score(item), i }))
  scored.sort((x, y) => y.s - x.s || x.i - y.i)
  return scored.slice(0, Math.max(0, k)).map((e) => e.item)
}

const STOPWORDS = new Set([
  'a', 'o', 'os', 'as', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na',
  'um', 'uma', 'para', 'por', 'com', 'que', 'the', 'of', 'and', 'to', 'in', 'for'
])

/** Lowercase, strip accents/punctuation, split into meaningful tokens. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
}

/**
 * Deterministic keyword/fuzzy relevance in [0, 1] between a query and a document
 * text. Combines exact-term overlap with a light fuzzy (prefix / substring)
 * match so typos and pt-BR inflections still surface results when the embedding
 * model is absent. This is the offline fallback path.
 */
export function keywordScore(query: string, text: string): number {
  const q = tokenize(query)
  if (q.length === 0) return 0
  const docTokens = tokenize(text)
  if (docTokens.length === 0) return 0
  const docSet = new Set(docTokens)

  let matched = 0
  for (const term of q) {
    if (docSet.has(term)) {
      matched += 1
      continue
    }
    // Light fuzzy: prefix or substring match against any doc token.
    let best = 0
    for (const dt of docSet) {
      if (dt.startsWith(term) || term.startsWith(dt)) {
        best = Math.max(best, 0.7)
      } else if (dt.includes(term) || term.includes(dt)) {
        best = Math.max(best, 0.5)
      }
    }
    matched += best
  }
  return Math.min(1, matched / q.length)
}

/** Fast, stable, dependency-free 32-bit FNV-1a hash → hex string. */
export function hashText(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

// ─── Index ──────────────────────────────────────────────────────────────────

interface IndexEntry {
  doc: SemanticDocument
  hash: string
  vector: number[] | null
}

interface PersistShape {
  version: 1
  dim: number
  /** hash → normalized vector. Cached so changed-text-only re-embeds on reindex. */
  vectors: Record<string, number[]>
}

const SNIPPET_MAX = 220

function clampSnippet(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > SNIPPET_MAX ? `${t.slice(0, SNIPPET_MAX - 1)}…` : t
}

/**
 * Flat (brute-force) cosine index. Document counts here are small (hundreds to a
 * few thousand setups/ghosts/notes), so an exact scan is both simplest and
 * fastest; no ANN structure is warranted.
 */
export class FlatCosineIndex {
  private readonly entries = new Map<string, IndexEntry>()
  /** hash → normalized vector, survives reindex + persists to disk. */
  private readonly vectorCache = new Map<string, number[]>()
  private lastIndexedAt = 0

  /** Insert/update a document. Reuses a cached vector when its text is unchanged. */
  upsert(doc: SemanticDocument): void {
    const hash = hashText(doc.text)
    const cached = this.vectorCache.get(hash) ?? null
    const snippet = clampSnippet(doc.snippet || doc.text)
    this.entries.set(doc.id, { doc: { ...doc, snippet }, hash, vector: cached })
  }

  /** Drop any document whose id is NOT in `presentIds` (incremental prune). */
  prune(presentIds: Iterable<string>): void {
    const keep = new Set(presentIds)
    for (const id of [...this.entries.keys()]) {
      if (!keep.has(id)) this.entries.delete(id)
    }
  }

  /** Documents still needing an embedding (no cached/assigned vector). */
  pendingEmbedding(): SemanticDocument[] {
    const out: SemanticDocument[] = []
    for (const entry of this.entries.values()) {
      if (entry.vector === null) out.push(entry.doc)
    }
    return out
  }

  /** Assign an embedding to a document; normalizes and caches it by content hash. */
  setVector(id: string, vector: readonly number[]): void {
    const entry = this.entries.get(id)
    if (!entry) return
    const normalized = l2normalize(vector)
    entry.vector = normalized
    this.vectorCache.set(entry.hash, normalized)
  }

  markIndexed(at: number): void {
    this.lastIndexedAt = at
  }

  getLastIndexedAt(): number {
    return this.lastIndexedAt
  }

  size(): number {
    return this.entries.size
  }

  /** True once every document has a vector (semantic search fully ready). */
  fullyEmbedded(): boolean {
    for (const entry of this.entries.values()) {
      if (entry.vector === null) return false
    }
    return this.entries.size > 0
  }

  countsBySource(): Record<SemanticSourceKind, number> {
    const counts = {
      setup: 0,
      ghost: 0,
      telemetry: 0,
      'driver-note': 0,
      'coach-finding': 0,
      'engineer-note': 0
    } as Record<SemanticSourceKind, number>
    for (const entry of this.entries.values()) counts[entry.doc.source] += 1
    return counts
  }

  /** Semantic search: cosine of the query vector against every embedded doc. */
  queryByVector(
    queryVector: readonly number[],
    limit: number,
    sources?: SemanticSourceKind[]
  ): SemanticSearchResult[] {
    const q = l2normalize(queryVector)
    const filter = sources && sources.length ? new Set(sources) : null
    const candidates: Array<{ entry: IndexEntry; score: number }> = []
    for (const entry of this.entries.values()) {
      if (!entry.vector) continue
      if (filter && !filter.has(entry.doc.source)) continue
      candidates.push({ entry, score: dot(q, entry.vector) })
    }
    return topK(candidates, (c) => c.score, limit)
      .filter((c) => c.score > 0)
      .map((c) => toResult(c.entry.doc, normalizeCosine(c.score), 'semantic'))
  }

  /** Deterministic fallback: keyword/fuzzy scan over the raw text. */
  queryByKeyword(
    query: string,
    limit: number,
    sources?: SemanticSourceKind[]
  ): SemanticSearchResult[] {
    const filter = sources && sources.length ? new Set(sources) : null
    const scored: Array<{ doc: SemanticDocument; score: number }> = []
    for (const entry of this.entries.values()) {
      if (filter && !filter.has(entry.doc.source)) continue
      const score = keywordScore(query, `${entry.doc.title} ${entry.doc.text}`)
      if (score > 0) scored.push({ doc: entry.doc, score })
    }
    return topK(scored, (s) => s.score, limit).map((s) => toResult(s.doc, s.score, 'keyword'))
  }

  // ─── Persistence (vector cache only) ──────────────────────────────────────

  toPersist(dim: number): PersistShape {
    const vectors: Record<string, number[]> = {}
    for (const [hash, vec] of this.vectorCache) vectors[hash] = vec
    return { version: 1, dim, vectors }
  }

  loadPersist(data: PersistShape | null): void {
    if (!data || data.version !== 1 || typeof data.vectors !== 'object') return
    for (const [hash, vec] of Object.entries(data.vectors)) {
      if (Array.isArray(vec) && vec.every((n) => typeof n === 'number')) {
        this.vectorCache.set(hash, vec)
      }
    }
  }

  async persist(filePath: string, dim: number): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify(this.toPersist(dim)), 'utf8')
  }

  async restore(filePath: string): Promise<void> {
    try {
      const raw = await readFile(filePath, 'utf8')
      this.loadPersist(JSON.parse(raw) as PersistShape)
    } catch {
      // No cache yet (or corrupt) — start cold; vectors re-embed on demand.
    }
  }
}

/** Map cosine [-1,1] → [0,1] for a stable UI relevance bar. */
function normalizeCosine(score: number): number {
  return Math.max(0, Math.min(1, (score + 1) / 2))
}

function toResult(
  doc: SemanticDocument,
  score: number,
  mode: SemanticSearchMode
): SemanticSearchResult {
  return {
    id: doc.id,
    source: doc.source,
    title: doc.title,
    snippet: doc.snippet,
    score,
    mode,
    ...(doc.ref ? { ref: doc.ref } : {})
  }
}
