import { describe, expect, it } from 'vitest'
import {
  FlatCosineIndex,
  cosineSimilarity,
  dot,
  hashText,
  keywordScore,
  l2normalize,
  tokenize,
  topK
} from './semantic-index'
import type { SemanticDocument } from '../../shared/semantic-search-ipc'

function doc(over: Partial<SemanticDocument> & Pick<SemanticDocument, 'id' | 'source'>): SemanticDocument {
  return {
    title: over.title ?? over.id,
    snippet: over.snippet ?? over.text ?? '',
    text: over.text ?? '',
    updatedAt: over.updatedAt ?? 0,
    ...over
  }
}

describe('pure vector math', () => {
  it('l2normalize yields a unit vector and is zero-safe', () => {
    const n = l2normalize([3, 4])
    expect(Math.hypot(n[0], n[1])).toBeCloseTo(1, 6)
    expect(l2normalize([0, 0])).toEqual([0, 0])
  })

  it('cosineSimilarity: identical=1, opposite=-1, orthogonal=0', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6)
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 6)
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6)
  })

  it('cosineSimilarity is magnitude-invariant', () => {
    expect(cosineSimilarity([1, 1], [10, 10])).toBeCloseTo(1, 6)
  })

  it('cosineSimilarity handles a zero vector', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
  })

  it('dot product on normalized vectors equals cosine', () => {
    const a = l2normalize([2, 1, 0])
    const b = l2normalize([1, 3, 1])
    expect(dot(a, b)).toBeCloseTo(cosineSimilarity([2, 1, 0], [1, 3, 1]), 6)
  })

  it('topK returns the k highest, stable on ties', () => {
    const items = [{ s: 1 }, { s: 5 }, { s: 5 }, { s: 2 }]
    const out = topK(items, (i) => i.s, 2)
    expect(out).toEqual([{ s: 5 }, { s: 5 }])
  })

  it('hashText is stable and differs on change', () => {
    expect(hashText('abc')).toBe(hashText('abc'))
    expect(hashText('abc')).not.toBe(hashText('abd'))
  })
})

describe('keyword fallback scoring', () => {
  it('tokenize strips accents, punctuation and stopwords', () => {
    expect(tokenize('Setup de Chuva, Interlagos!')).toEqual(['setup', 'chuva', 'interlagos'])
  })

  it('scores exact term overlap high and unrelated text zero', () => {
    expect(keywordScore('chuva interlagos', 'setup de chuva para Interlagos')).toBeCloseTo(1, 6)
    expect(keywordScore('chuva', 'setup seco para Monza')).toBe(0)
  })

  it('fuzzy-matches prefixes (pt-BR inflections / typos)', () => {
    expect(keywordScore('freada', 'freadas tardias na curva 1')).toBeGreaterThan(0)
  })

  it('returns 0 for an empty query', () => {
    expect(keywordScore('', 'qualquer texto')).toBe(0)
  })
})

describe('FlatCosineIndex', () => {
  const setup = doc({ id: 'setup:1', source: 'setup', title: 'GT3 Spa', text: 'setup macio para chuva em spa', updatedAt: 1 })
  const ghost = doc({ id: 'ghost:1', source: 'ghost', title: 'Volta Monza', text: 'ghost rapido em monza seco', updatedAt: 2 })

  it('keyword query works with no vectors (deterministic fallback)', () => {
    const idx = new FlatCosineIndex()
    idx.upsert(setup)
    idx.upsert(ghost)
    const res = idx.queryByKeyword('chuva spa', 5)
    expect(res[0].id).toBe('setup:1')
    expect(res[0].mode).toBe('keyword')
  })

  it('semantic query ranks by cosine of assigned vectors', () => {
    const idx = new FlatCosineIndex()
    idx.upsert(setup)
    idx.upsert(ghost)
    idx.setVector('setup:1', [1, 0, 0])
    idx.setVector('ghost:1', [0, 1, 0])
    const res = idx.queryByVector([0.9, 0.1, 0], 5)
    expect(res[0].id).toBe('setup:1')
    expect(res[0].mode).toBe('semantic')
    expect(res[0].score).toBeGreaterThan(res[1].score)
  })

  it('respects the source filter', () => {
    const idx = new FlatCosineIndex()
    idx.upsert(setup)
    idx.upsert(ghost)
    const res = idx.queryByKeyword('monza spa', 5, ['ghost'])
    expect(res.every((r) => r.source === 'ghost')).toBe(true)
  })

  it('tracks pending embeddings and clears them on setVector', () => {
    const idx = new FlatCosineIndex()
    idx.upsert(setup)
    expect(idx.pendingEmbedding().map((d) => d.id)).toEqual(['setup:1'])
    idx.setVector('setup:1', [1, 0, 0])
    expect(idx.pendingEmbedding()).toEqual([])
    expect(idx.fullyEmbedded()).toBe(true)
  })

  it('reuses cached vectors for unchanged text and re-queues on change', () => {
    const idx = new FlatCosineIndex()
    idx.upsert(setup)
    idx.setVector('setup:1', [1, 0, 0])
    // Re-upsert with identical text → vector reused, nothing pending.
    idx.upsert(setup)
    expect(idx.pendingEmbedding()).toEqual([])
    // Changed text → needs a fresh embedding.
    idx.upsert(doc({ id: 'setup:1', source: 'setup', text: 'setup duro para seco' }))
    expect(idx.pendingEmbedding().map((d) => d.id)).toEqual(['setup:1'])
  })

  it('prune drops documents no longer present', () => {
    const idx = new FlatCosineIndex()
    idx.upsert(setup)
    idx.upsert(ghost)
    idx.prune(['ghost:1'])
    expect(idx.size()).toBe(1)
    expect(idx.queryByKeyword('spa', 5)).toEqual([])
  })

  it('persists and restores the vector cache (incremental across restarts)', () => {
    const a = new FlatCosineIndex()
    a.upsert(setup)
    a.setVector('setup:1', [1, 0, 0])
    const snapshot = a.toPersist(3)

    const b = new FlatCosineIndex()
    b.loadPersist(snapshot)
    b.upsert(setup) // same text → should pick up the cached vector
    expect(b.pendingEmbedding()).toEqual([])
  })

  it('counts documents by source', () => {
    const idx = new FlatCosineIndex()
    idx.upsert(setup)
    idx.upsert(ghost)
    const counts = idx.countsBySource()
    expect(counts.setup).toBe(1)
    expect(counts.ghost).toBe(1)
    expect(counts.telemetry).toBe(0)
  })
})
