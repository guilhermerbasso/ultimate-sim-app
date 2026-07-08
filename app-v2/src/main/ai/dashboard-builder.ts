// Dashboard AI builder — main-process orchestrator (LLM OPTIONAL).
//
// DESIGN PRINCIPLE: deterministic-first, LLM-optional. A beautiful dashboard
// comes from a good LAYOUT + a good VARIANT choice + a coherent THEME — all of
// which are produced DETERMINISTICALLY by the curated blueprints + layout engine.
// The local LLM (CPU-only, on-demand, never required) only CLASSIFIES the request
// into a constrained enum; it NEVER designs layout. Everything works with the LLM
// absent.
//
// `buildFromPhrase(phrase)` turns a free-text request into a brand-new Dashboard:
//   1. CLASSIFY (always deterministic): keyword → { archetype, family, emphasis }.
//   2. If the LLM is available, ask it ONLY to classify into the SAME constrained
//      JSON schema; its answer is parsed + validated strictly against the enums
//      and used to refine the deterministic classification (invalid → ignored).
//   3. The layout engine instantiates the chosen blueprint for the chosen design
//      family, applies emphasis, and returns a finished, valid Dashboard.
//
// node-llama-cpp is never imported here — we only touch the lazy `LlmRuntime`
// facade, which loads the native model on the first generation and not before.

import { ALL_VARIANTS } from '../../renderer/src/views/dashboard/widget-catalog-data'
import type { Dashboard } from '../../shared/dashboards'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import {
  detectDetail,
  matchConcepts,
  normalizePhrase,
  type DashboardConcept,
  type DetailLevel
} from '../../shared/dashboard-nl'
import {
  DASHBOARD_ARCHETYPES,
  getBlueprint,
  isArchetype,
  type DashboardArchetype
} from '../../shared/dashboard-blueprints'
import {
  buildDashboardFromBlueprint,
  EMPHASIS_TAGS,
  isDesignFamily,
  isEmphasisTag,
  type EmphasisTag,
  type LayoutCatalogWidget
} from '../../shared/dashboard-layout'
import { OVERLAY_DESIGN_FAMILIES, type OverlayDesignFamily } from '../../shared/overlays'
import {
  planAdaptiveDashboard,
  type AdaptivePlan,
  type PlanOptions
} from '../../shared/dashboard-adaptive'
import type { Logger } from '../../shared/logger'
import { getLlmRuntime } from './llm-runtime'

export type BuildSource = 'llm' | 'deterministic'

export interface BuildResult {
  dashboard: Dashboard
  widgetIds: string[]
  matched: DashboardConcept[]
  source: BuildSource
  usedDefault: boolean
  /** The classification that produced the dashboard (extends the result additively). */
  archetype: DashboardArchetype
  family: OverlayDesignFamily
  emphasis: EmphasisTag[]
  /** Populated when the LLM was tried but its output was unusable. */
  llmNote?: string
}

// Minimal generate facade (so this file is unit-testable with a fake runtime and
// never imports the native module type surface directly).
export interface GenerateLike {
  generateWithTools(request: {
    system?: string
    prompt: string
    maxTokens?: number
    temperature?: number
    signal?: AbortSignal
  }): Promise<{ ok: boolean; text?: string; code?: string; error?: string }>
}

export interface BuildFromPhraseOptions {
  catalog?: readonly LayoutCatalogWidget[]
  /** Inject a runtime (defaults to the shared lazy LLM runtime). */
  runtime?: GenerateLike | null
  /** Disable the LLM entirely and force the deterministic classification. */
  useLlm?: boolean
  /** Detail bias (clean/elaborate). Defaults to the phrase-detected level. */
  detail?: DetailLevel
  name?: string
  description?: string
  /** Explicit overrides (e.g. the builder UI manual pickers) — skip the LLM. */
  archetype?: DashboardArchetype
  family?: OverlayDesignFamily
  emphasis?: EmphasisTag[]
  signal?: AbortSignal
  logger?: Logger
}

const LOG_AREA = 'ai'
const LLM_MAX_TOKENS = 120

// ─── Deterministic classification ────────────────────────────────────────────

export interface Classification {
  archetype: DashboardArchetype
  family: OverlayDesignFamily
  emphasis: EmphasisTag[]
}

// Archetype keywords (normalized, PT-BR + EN). Scanned in this priority order;
// the first hit wins, so put the most specific archetypes first.
const ARCHETYPE_KEYWORDS: Array<{ id: DashboardArchetype; words: string[] }> = [
  { id: 'endurance', words: ['endurance', 'enduro', 'stint', '24h', '12h', '6h', 'resistencia', 'le mans', 'lemans', 'longa duracao', 'longa'] },
  { id: 'qualifying', words: ['quali', 'qualy', 'qualify', 'classificatoria', 'hotlap', 'hot lap', 'fast lap', 'flying lap', 'tomada de tempo', 'time attack', 'flying lap'] },
  { id: 'practice', words: ['practice', 'practice', 'pratica', 'setup', 'engenharia de setup', 'shakedown', 'testes', 'teste de pista'] },
  { id: 'oval', words: ['oval', 'nascar', 'superspeedway', 'speedway', 'indy 500', 'indycar oval'] },
  { id: 'dirt', words: ['dirt', 'rally', 'rallycross', 'rallye', 'terra', 'offroad', 'off-road', 'cascalho', 'lama'] },
  { id: 'formula', words: ['formula', 'f1', 'f2', 'f3', 'f4', 'open wheel', 'open-wheel', 'monoposto'] },
  { id: 'gt3', words: ['gt3', 'gt4', 'gte', 'sportscar', 'sports car', 'imsa', 'wec', 'gt '] },
  { id: 'streaming', words: ['stream', 'streaming', 'live', 'transmissao', 'broadcast', 'espectador', 'spectator', 'lower third'] },
  { id: 'dataheavy', words: ['dados', 'data', 'telemetria', 'telemetry', 'engineer', 'engineer', 'denso', 'completo', 'overview', 'tudo'] },
  { id: 'futuristic', words: ['futurista', 'futuristic', 'sci-fi', 'scifi', 'cyber', 'cyberpunk', 'holografico', 'espacial'] },
  { id: 'minimal', words: ['minimal', 'minimalista', 'limpo', 'clean', 'simples', 'enxuto'] },
  { id: 'sprint', words: ['sprint', 'race', 'race', 'rapida', 'curta'] }
]

// Family keywords (normalized). Scanned in priority order; first hit wins.
const FAMILY_KEYWORDS: Array<{ id: OverlayDesignFamily; words: string[] }> = [
  { id: 'neon', words: ['neon', 'cyber', 'cyberpunk', 'futurista', 'futuristic', 'sci-fi', 'scifi', 'glow', 'brilho', 'led', 'holografico'] },
  { id: 'glass', words: ['glass', 'vidro', 'glassmorphism', 'frost', 'frosted', 'fosco', 'translucido', 'translucida'] },
  { id: 'terminal', words: ['terminal', 'crt', 'retro', 'monospace', 'mono', 'console', 'ascii', 'phosphor'] },
  { id: 'bauhaus', words: ['bauhaus', 'geometric', 'geometrico', 'poster', 'brutalist', 'brutalista', 'blocos'] },
  { id: 'analog', words: ['analog', 'analogico', 'dial', 'dials', 'ponteiro', 'relogio', 'mostrador', 'classico', 'heritage', 'vintage'] },
  { id: 'heatmap', words: ['heatmap', 'heat map', 'calor', 'thermal', 'termico', 'celulas', 'grade densa'] },
  { id: 'broadcast', words: ['broadcast', 'tv', 'transmissao', 'lower third', 'placar'] },
  { id: 'minimal', words: ['minimal', 'minimalista', 'limpo', 'clean', 'simples', 'enxuto', 'restraint'] }
]

const DENSE_HINTS = ['denso', 'densa', 'completo', 'completa', 'tudo', 'detalhado', 'detalhada', 'dense', 'full', 'overview', 'cheio']

function findKeyword<T extends string>(normalized: string, table: Array<{ id: T; words: string[] }>): T | undefined {
  for (const entry of table) {
    if (entry.words.some((w) => normalized.includes(w))) return entry.id
  }
  return undefined
}

/**
 * Deterministically classify a phrase into an archetype + design family +
 * emphasis tags. ALWAYS returns a usable classification (the guaranteed result).
 */
export function classifyRequest(phrase: string, detail: DetailLevel = 'auto'): Classification & { matchedNothing: boolean } {
  const n = normalizePhrase(phrase)
  const archetypeKw = findKeyword(n, ARCHETYPE_KEYWORDS)
  const familyKw = findKeyword(n, FAMILY_KEYWORDS)
  const concepts = matchConcepts(phrase)

  const archetype: DashboardArchetype = archetypeKw ?? 'sprint'
  const blueprint = getBlueprint(archetype)
  let family: OverlayDesignFamily = familyKw ?? blueprint.defaultFamily
  if (!familyKw && detail === 'clean') family = 'minimal'

  const emphasis: EmphasisTag[] = []
  const pushTag = (t: EmphasisTag): void => {
    if (!emphasis.includes(t)) emphasis.push(t)
  }
  for (const c of concepts) pushTag(c)
  const denseHinted = DENSE_HINTS.some((h) => n.includes(h))
  if (detail === 'clean' || (familyKw === 'minimal' && !denseHinted)) pushTag('minimal')
  if (detail === 'elaborate' || denseHinted || archetypeKw === 'dataheavy') pushTag('dense')

  const matchedNothing = !archetypeKw && !familyKw && concepts.length === 0
  return { archetype, family, emphasis, matchedNothing }
}

// ─── LLM classification (constrained enum JSON) ──────────────────────────────

export function buildClassifyPrompt(phrase: string): { system: string; prompt: string } {
  const archetypes = DASHBOARD_ARCHETYPES.join(', ')
  const families = OVERLAY_DESIGN_FAMILIES.join(', ')
  const emphasis = EMPHASIS_TAGS.join(', ')
  const system =
    'You classify a sim-racing dashboard request into a FIXED schema. ' +
    'Reply with ONLY compact JSON, no prose: {"archetype": <one of the archetypes>, "family": <one of the families>, "emphasis": [<zero or more tags>]}. ' +
    `archetypes: ${archetypes}. families: ${families}. emphasis tags: ${emphasis}. ` +
    'Use ONLY values from these lists. You do NOT design layout — only classify.'
  const prompt =
    'EXAMPLES:\n' +
    'Request: "race de gt3 with tires e fuel, visual de vidro" -> {"archetype":"gt3","family":"glass","emphasis":["tyres","fuel"]}\n' +
    'Request: "quali minimalista, foco no delta" -> {"archetype":"qualifying","family":"minimal","emphasis":["delta","minimal"]}\n\n' +
    `Request: "${phrase.trim().replace(/"/g, "'")}" -> `
  return { system, prompt }
}

/**
 * Parse the constrained classification JSON from a possibly-noisy model response.
 * Returns only the fields that validate strictly against the enums; everything
 * invalid is dropped. Returns null when nothing usable could be parsed.
 */
export function parseClassificationFromLlm(text: string | undefined): Partial<Classification> | null {
  if (!text) return null
  const match = text.match(/\{[\s\S]*?\}/)
  if (!match) return null
  let obj: unknown
  try {
    obj = JSON.parse(match[0])
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const rec = obj as Record<string, unknown>
  const out: Partial<Classification> = {}
  if (isArchetype(rec.archetype)) out.archetype = rec.archetype
  if (isDesignFamily(rec.family)) out.family = rec.family
  if (Array.isArray(rec.emphasis)) {
    const tags = rec.emphasis.filter((t): t is EmphasisTag => isEmphasisTag(t))
    if (tags.length > 0) out.emphasis = Array.from(new Set(tags))
  }
  return out.archetype || out.family || out.emphasis ? out : null
}

// ─── Build ───────────────────────────────────────────────────────────────────

/**
 * Build a Dashboard from a phrase. Deterministic classification always runs; the
 * LLM (when available) only refines the classification. Never throws.
 */
export async function buildFromPhrase(phrase: string, opts: BuildFromPhraseOptions = {}): Promise<BuildResult> {
  const catalog = opts.catalog ?? (ALL_VARIANTS as readonly LayoutCatalogWidget[])
  const matched = matchConcepts(phrase)
  const detail = opts.detail ?? detectDetail(phrase)

  // Deterministic classification — the guaranteed baseline.
  const det = classifyRequest(phrase, detail)
  let archetype = det.archetype
  let family = det.family
  let emphasis: EmphasisTag[] = det.emphasis
  let source: BuildSource = 'deterministic'
  let usedDefault = det.matchedNothing
  let llmNote: string | undefined

  // Explicit overrides from the caller (manual UI pickers) take precedence and
  // bypass the LLM entirely — the deterministic engine still does the work.
  const explicit = isArchetype(opts.archetype) || isDesignFamily(opts.family) || Array.isArray(opts.emphasis)
  if (isArchetype(opts.archetype)) {
    archetype = opts.archetype
    usedDefault = false
  }
  if (isDesignFamily(opts.family)) family = opts.family
  if (Array.isArray(opts.emphasis)) emphasis = opts.emphasis.filter(isEmphasisTag)

  const useLlm = (opts.useLlm ?? true) && !explicit
  if (useLlm && phrase.trim().length > 0) {
    const runtime = opts.runtime === undefined ? getLlmRuntime() : opts.runtime
    if (runtime) {
      try {
        const { system, prompt } = buildClassifyPrompt(phrase)
        const result = await runtime.generateWithTools({ system, prompt, maxTokens: LLM_MAX_TOKENS, temperature: 0, signal: opts.signal })
        if (result.ok) {
          const parsed = parseClassificationFromLlm(result.text)
          if (parsed && parsed.archetype) {
            archetype = parsed.archetype
            if (parsed.family) family = parsed.family
            if (parsed.emphasis && parsed.emphasis.length > 0) emphasis = parsed.emphasis
            source = 'llm'
            usedDefault = false
          } else {
            llmNote = 'LLM returned no usable classification; used keyword matching.'
          }
        } else {
          llmNote = `LLM unavailable (${result.code ?? 'error'}); used keyword matching.`
        }
      } catch (error) {
        llmNote = `LLM error (${error instanceof Error ? error.message : String(error)}); used keyword matching.`
        opts.logger?.warn(LOG_AREA, 'dashboard-builder llm path failed', { message: llmNote })
      }
    }
  }

  const blueprint = getBlueprint(archetype)
  const { dashboard, widgetIds } = buildDashboardFromBlueprint(blueprint, {
    family,
    emphasis,
    detail,
    catalog,
    name: opts.name ?? defaultName(phrase, blueprint.label),
    description: opts.description ?? `Dashboard AI · ${blueprint.label} · ${family}${phrase.trim() ? ` · "${phrase.trim()}"` : ''}`
  })

  return { dashboard, widgetIds, matched, source, usedDefault, archetype, family, emphasis, llmNote }
}

function defaultName(phrase: string, fallbackLabel: string): string {
  const trimmed = phrase.trim().replace(/\s+/g, ' ')
  if (!trimmed) return `AI · ${fallbackLabel}`
  const short = trimmed.length > 42 ? `${trimmed.slice(0, 42).trim()}…` : trimmed
  return `AI · ${short}`
}

/** Adaptive emphasis plan for a live snapshot (deterministic, no LLM). */
export function adaptiveSuggest(snapshot: TelemetrySnapshot | null | undefined, opts?: PlanOptions): AdaptivePlan {
  return planAdaptiveDashboard(snapshot, opts)
}
