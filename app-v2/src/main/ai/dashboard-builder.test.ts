import { describe, expect, it } from 'vitest'
import { ALL_VARIANTS } from '../../renderer/src/views/dashboard/widget-catalog-data'
import {
  buildFromPhrase,
  classifyRequest,
  parseClassificationFromLlm,
  buildClassifyPrompt,
  type GenerateLike
} from './dashboard-builder'

const catalogIds = new Set(ALL_VARIANTS.map((v) => v.id))

function fakeRuntime(text: string, ok = true, code?: string): GenerateLike {
  return { generateWithTools: async () => (ok ? { ok: true, text } : { ok: false, code, error: 'x' }) }
}

describe('classifyRequest — deterministic', () => {
  it('maps an endurance phrase to the endurance archetype', () => {
    const c = classifyRequest('corrida de endurance 24h com stints')
    expect(c.archetype).toBe('endurance')
    expect(c.matchedNothing).toBe(false)
  })

  it('maps a qualifying + minimal phrase', () => {
    const c = classifyRequest('quali minimalista foco no delta')
    expect(c.archetype).toBe('qualifying')
    expect(c.family).toBe('minimal')
    expect(c.emphasis).toContain('delta')
    expect(c.emphasis).toContain('minimal')
  })

  it('picks the neon family for a futuristic visual request', () => {
    const c = classifyRequest('dashboard futurista cyberpunk com glow')
    expect(c.family).toBe('neon')
  })

  it('detects the glass family and gt3 archetype together', () => {
    const c = classifyRequest('gt3 com pneus e combustivel visual de vidro')
    expect(c.archetype).toBe('gt3')
    expect(c.family).toBe('glass')
    expect(c.emphasis).toEqual(expect.arrayContaining(['tyres', 'fuel']))
  })

  it('falls back to sprint + default family with the matchedNothing flag', () => {
    const c = classifyRequest('zzz qqq nada aqui')
    expect(c.archetype).toBe('sprint')
    expect(c.matchedNothing).toBe(true)
  })

  it('adds the dense tag for a data-heavy request', () => {
    const c = classifyRequest('mostre tudo, telemetria completa de engenheiro')
    expect(c.archetype).toBe('dataheavy')
    expect(c.emphasis).toContain('dense')
  })
})

describe('parseClassificationFromLlm — strict enum validation', () => {
  it('parses a clean classification object', () => {
    const parsed = parseClassificationFromLlm('{"archetype":"gt3","family":"glass","emphasis":["tyres","fuel"]}')
    expect(parsed).toEqual({ archetype: 'gt3', family: 'glass', emphasis: ['tyres', 'fuel'] })
  })

  it('parses JSON embedded in prose', () => {
    const parsed = parseClassificationFromLlm('Sure: {"archetype":"oval","family":"broadcast"} done')
    expect(parsed?.archetype).toBe('oval')
    expect(parsed?.family).toBe('broadcast')
  })

  it('drops invalid enum values', () => {
    const parsed = parseClassificationFromLlm('{"archetype":"spaceship","family":"glass","emphasis":["bogus","fuel"]}')
    expect(parsed?.archetype).toBeUndefined()
    expect(parsed?.family).toBe('glass')
    expect(parsed?.emphasis).toEqual(['fuel'])
  })

  it('returns null for unusable text', () => {
    expect(parseClassificationFromLlm(undefined)).toBeNull()
    expect(parseClassificationFromLlm('no json here')).toBeNull()
    expect(parseClassificationFromLlm('{"archetype":"nope"}')).toBeNull()
  })
})

describe('buildClassifyPrompt', () => {
  it('embeds the constrained enums and the phrase', () => {
    const { system, prompt } = buildClassifyPrompt('quali rapida')
    expect(system).toContain('qualifying')
    expect(system).toContain('glass')
    expect(prompt).toContain('quali rapida')
  })
})

describe('buildFromPhrase — deterministic path', () => {
  it('uses keyword classification when the LLM is disabled', async () => {
    const res = await buildFromPhrase('endurance com combustível e posição', { useLlm: false })
    expect(res.source).toBe('deterministic')
    expect(res.archetype).toBe('endurance')
    expect(res.dashboard.elements.length).toBe(res.widgetIds.length)
    for (const id of res.widgetIds) expect(catalogIds.has(id)).toBe(true)
  })

  it('uses the deterministic path when runtime is null', async () => {
    const res = await buildFromPhrase('quali com delta e pneu', { runtime: null })
    expect(res.source).toBe('deterministic')
    expect(res.archetype).toBe('qualifying')
    expect(res.widgetIds.length).toBeGreaterThan(0)
  })

  it('flags usedDefault when nothing matches', async () => {
    const res = await buildFromPhrase('zzz nothing zzz', { runtime: null })
    expect(res.usedDefault).toBe(true)
    expect(res.dashboard.elements.length).toBeGreaterThan(0)
  })

  it('produces a valid in-canvas, non-overlapping dashboard', async () => {
    const res = await buildFromPhrase('gt3 com pneus', { runtime: null })
    const els = res.dashboard.elements
    for (const e of els) {
      expect(e.x).toBeGreaterThanOrEqual(0)
      expect(e.y).toBeGreaterThanOrEqual(0)
      expect(e.x + e.w).toBeLessThanOrEqual(res.dashboard.width)
      expect(e.y + e.h).toBeLessThanOrEqual(res.dashboard.height)
    }
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        const a = els[i]
        const b = els[j]
        const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
        expect(overlap).toBe(false)
      }
    }
  })
})

describe('buildFromPhrase — explicit overrides bypass the LLM', () => {
  it('honors an explicit archetype + family and never calls the runtime', async () => {
    let called = false
    const runtime: GenerateLike = {
      generateWithTools: async () => {
        called = true
        return { ok: true, text: '{"archetype":"oval","family":"neon"}' }
      }
    }
    const res = await buildFromPhrase('algo qualquer', { runtime, archetype: 'formula', family: 'terminal' })
    expect(called).toBe(false)
    expect(res.archetype).toBe('formula')
    expect(res.family).toBe('terminal')
    expect(res.source).toBe('deterministic')
  })
})

describe('buildFromPhrase — LLM classification path', () => {
  it('uses the LLM classification when valid', async () => {
    const res = await buildFromPhrase('quero algo legal', {
      runtime: fakeRuntime('{"archetype":"oval","family":"broadcast","emphasis":["position"]}')
    })
    expect(res.source).toBe('llm')
    expect(res.archetype).toBe('oval')
    expect(res.family).toBe('broadcast')
    expect(res.emphasis).toContain('position')
  })

  it('falls back to deterministic when the LLM classification is unusable', async () => {
    const res = await buildFromPhrase('gt3', { runtime: fakeRuntime('{"archetype":"spaceship"}') })
    expect(res.source).toBe('deterministic')
    expect(res.archetype).toBe('gt3')
    expect(res.llmNote).toBeTruthy()
  })

  it('falls back to deterministic on LLM failure', async () => {
    const res = await buildFromPhrase('quali', { runtime: fakeRuntime('', false, 'no_model') })
    expect(res.source).toBe('deterministic')
    expect(res.archetype).toBe('qualifying')
    expect(res.llmNote).toContain('no_model')
  })
})
