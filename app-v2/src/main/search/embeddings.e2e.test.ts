// Opt-in end-to-end regression for the embedding engine.
//
// SKIPPED BY DEFAULT: it downloads ~113 MB of ONNX weights from the Hugging Face
// hub on first run, so it is not something CI (or a plain `npm test`) should do.
// Run it deliberately when the transformers package, its ONNX runtime or the
// requested dtype changes:
//
//   SEMANTIC_MODEL_E2E=1 npx vitest run src/main/search/embeddings.e2e.test.ts
//
// Why the pinned numbers exist
// ----------------------------
// Every advisory fix that touches the inference stack can silently change what
// the model returns — a different dtype, a different ONNX runtime, or a broken
// tokenizer all still "work" and still produce 384 finite floats. Only the values
// show the regression. PAIRWISE_COSINE_BASELINE was captured from
// @xenova/transformers@2.17.2 + { quantized: true } (the pre-migration engine) on
// the same corpus, and reproduced bit-for-bit by @huggingface/transformers@3.8.1 +
// { dtype: 'q8' }. A drift here means the embedding space moved and every stored
// vector in the on-disk index is now incomparable with freshly embedded queries.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { EmbeddingsEngine } from './embeddings'
import { SEMANTIC_MODEL_DIM } from '../../shared/semantic-search-ipc'

const CORPUS = [
  'brake bias adjustment for endurance racing',
  'ajuste de balanco de freio para corrida de enduro',
  'tyre pressure warning on the front left wheel',
  'telemetry lap delta chart overlay',
  'How do I bind a button on the SIM-X ButtonBox?',
  'pit stop fuel strategy calculator',
  'espectro de vibracao do volante em curva',
  'GT3 Ferrari 488 Challenge shift light configuration'
]

// Upper triangle of the cosine matrix, row-major: (0,1) (0,2) ... (6,7).
const PAIRWISE_COSINE_BASELINE = [
  0.785212, 0.34164, 0.101112, -0.071675, 0.391144, 0.341627, 0.409633, 0.512033, 0.172144,
  0.005611, 0.504811, 0.584032, 0.436727, 0.125275, 0.030018, 0.262056, 0.63541, 0.344443,
  0.097827, 0.170364, 0.280751, 0.158205, -0.057649, 0.014187, 0.062114, 0.159304, 0.273458,
  0.320955
]

// int8 weights are deterministic for a fixed runtime, but ORT is free to reassociate
// float accumulation across builds; 1e-4 is far below the ~0.05 gap that separates
// adjacent neighbours in the corpus, so it catches a real regression without flaking.
const TOLERANCE = 1e-4

const enabled = process.env.SEMANTIC_MODEL_E2E === '1'

// Both the temp cache and the engine are created lazily inside the tests: `npm test`
// still imports this file and still runs the `describe` body to collect the skipped
// cases, so anything at suite scope would execute on every CI run.
let cacheDir: string | null = null
let engine: EmbeddingsEngine | null = null
const sharedEngine = (): EmbeddingsEngine => {
  if (!engine) {
    cacheDir = process.env.SEMANTIC_MODEL_E2E_CACHE ?? mkdtempSync(join(tmpdir(), 'usa-embeddings-e2e-'))
    engine = new EmbeddingsEngine(cacheDir)
  }
  return engine
}

afterAll(() => {
  if (cacheDir && !process.env.SEMANTIC_MODEL_E2E_CACHE) {
    rmSync(cacheDir, { recursive: true, force: true })
  }
})

describe.skipIf(!enabled)('EmbeddingsEngine end-to-end', () => {
  it('loads the real model and reproduces the pinned embedding space', async () => {
    const engine = sharedEngine()
    expect(await engine.isAvailable()).toBe(true)

    const vectors = await engine.embed(CORPUS)
    expect(vectors).not.toBeNull()
    expect(vectors).toHaveLength(CORPUS.length)

    for (const vector of vectors!) {
      expect(vector).toHaveLength(SEMANTIC_MODEL_DIM)
      expect(vector.every(Number.isFinite)).toBe(true)
      const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0))
      expect(norm).toBeCloseTo(1, 5)
    }

    const dot = (a: number[], b: number[]): number => a.reduce((s, x, i) => s + x * b[i], 0)
    const actual: number[] = []
    for (let i = 0; i < vectors!.length; i++) {
      for (let j = i + 1; j < vectors!.length; j++) actual.push(dot(vectors![i], vectors![j]))
    }

    expect(actual).toHaveLength(PAIRWISE_COSINE_BASELINE.length)
    for (let k = 0; k < actual.length; k++) {
      expect(Math.abs(actual[k] - PAIRWISE_COSINE_BASELINE[k])).toBeLessThanOrEqual(TOLERANCE)
    }

    expect(engine.getPhase()).toBe('ready')
    expect(engine.isReady()).toBe(true)
  }, 600_000)

  it('keeps the cross-lingual pair closer than any unrelated pair', async () => {
    // The whole reason the model is multilingual: the pt-BR paraphrase of text 0
    // must be its nearest neighbour, or a pt-BR query stops finding en content.
    const vectors = (await sharedEngine().embed(CORPUS))!
    const dot = (a: number[], b: number[]): number => a.reduce((s, x, i) => s + x * b[i], 0)

    const neighbours = CORPUS.map((_, j) => (j === 0 ? -2 : dot(vectors[0], vectors[j])))
    expect(neighbours.indexOf(Math.max(...neighbours))).toBe(1)
  }, 600_000)

  it('unloads and reloads without changing the vectors', async () => {
    const engine = sharedEngine()
    const before = (await engine.embed([CORPUS[0]]))![0]
    engine.unload()
    expect(engine.isReady()).toBe(false)

    const after = (await engine.embed([CORPUS[0]]))![0]
    expect(after).toEqual(before)
  }, 600_000)
})
