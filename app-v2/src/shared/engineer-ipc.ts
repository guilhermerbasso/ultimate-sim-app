// Shared IPC contract for the "AI Race Engineer" feature (text-first path).
//
// This file is dependency-free (no node:*, electron, node-llama-cpp or React) so
// it can be imported by main, preload, renderer AND unit tests without dragging in
// the native runtime — the same rule shared/ai.ts and shared/ai-engineer.ts follow.
// It carries only the IPC channel names, the persisted config shape + merge, the
// command-directive resolver, and the answer/status payload contracts.
//
// IMPORTANT: shared/ai.ts and shared/ai-engineer.ts are owned by other agents.
// We only import TYPES (and the model-id constants, which are plain data) from them.

import { DEFAULT_MODEL_ID, type LlmRuntimeStatus, type ModelDownloadProgress, type ModelId, type ModelStatus } from './ai'
import type { IntentCommandKind } from './ai-engineer'
import type { CoachFindingKind, CoachSeverity } from './coach'

// ─── Channels ────────────────────────────────────────────────────────────────
//
// Single `engineer:` prefix so the preload allowlist needs exactly one entry
// (mirrors `spotter:` / `soundshift:` / `tts:`). Request/response channels are
// renderer → main (`ipc.invoke`); the *Event channels are main → renderer
// broadcasts (`ipc.subscribe`).

export const ENGINEER_CHANNELS = {
  /** Renderer → Main: ask a question (text). Resolves to an EngineerAnswer. */
  ask: 'engineer:ask',
  /** Renderer → Main: runtime + model status snapshot (EngineerStatus). */
  getStatus: 'engineer:getStatus',
  /** Renderer → Main: download/resolve the active model (streams modelProgress). */
  ensureModel: 'engineer:ensureModel',
  /** Renderer → Main: read the persisted config. */
  getConfig: 'engineer:getConfig',
  /** Renderer → Main: patch + persist the config. Resolves to the merged config. */
  setConfig: 'engineer:setConfig',
  /** Renderer → Main: abort the in-flight generation (best-effort). */
  cancel: 'engineer:cancel',
  /**
   * Renderer → Main: trigger an engineer ACTION by id (push-to-talk / ask preset).
   * Resolves the id against the persisted config and broadcasts `engineer:action`.
   * This is the seam a hardware button uses to fire the engineer.
   */
  invokeAction: 'engineer:invokeAction',
  /** Main → Renderer: execute an engineer action directive (EngineerActionDirective). */
  action: 'engineer:action',
  /** Main → Renderer: an answer is ready (EngineerAnswer). Drives the log + TTS. */
  answer: 'engineer:answer',
  /** Main → Renderer: execute a deterministic command via the existing IPC. */
  command: 'engineer:command',
  /** Main → Renderer: model download progress (ModelDownloadProgress). */
  modelProgress: 'engineer:modelProgress',
  /** Main → Renderer: status changed (EngineerStatus) — e.g. after setConfig. */
  statusEvent: 'engineer:status',
  /**
   * Main → Renderer: a PROACTIVE, self-initiated radio call after a sector
   * boundary (EngineerProactiveEvent). Driven by deterministic coach findings —
   * works with the LLM absent. The renderer shows it in a feed and speaks it.
   */
  proactive: 'engineer:proactive'
} as const

export type EngineerChannel = (typeof ENGINEER_CHANNELS)[keyof typeof ENGINEER_CHANNELS]

// ─── Persisted config (engineer.json in userData) ──────────────────────────────

export type EngineerLanguage = 'pt-BR' | 'en-US'
export type EngineerMessageLanguage = EngineerLanguage | 'es' | 'fr' | 'de' | 'zh' | 'ja'

/**
 * How blunt the engineer's persona is. `brutal` is the most assertive/demanding
 * radio voice (default): it calls out mistakes directly with zero praise-padding.
 * This is a PROMPT/persona/few-shot/params knob — never weight fine-tuning.
 */
export type EngineerAssertiveness = 'balanced' | 'assertive' | 'brutal'

export const ENGINEER_ASSERTIVENESS_VALUES: readonly EngineerAssertiveness[] = ['balanced', 'assertive', 'brutal']

// ─── Preset questions + hardware button bindings (Q&A trigger) ─────────────────
//
// The engineer can be fired from a hardware button two ways: a PUSH-TO-TALK button
// (listen-and-ask) and one button per editable PRESET QUESTION. Both live in the
// engineer config so they persist with everything else and stay dependency-free.

/** A minimal HID button reference (mirrors the gamepad fields of HidButtonControl). */
export interface EngineerButtonBinding {
  /** Web Gamepad API button index on the pad. */
  buttonIndex: number
  /** Preferred gamepad index (may shift between sessions; gamepadId is the anchor). */
  gamepadIndex?: number
  /** Stable gamepad id string used to re-find the pad if its index changes. */
  gamepadId?: string
}

/** An editable canned question the user can fire (and bind to a button). */
export interface EngineerPresetQuestion {
  /** Stable id (used for the per-preset button binding + action id). */
  id: string
  /** Short label shown on the chip/button. */
  label: string
  /** The actual question text sent over `engineer:ask`. */
  text: string
}

/** Hardware button bindings for the engineer Q&A triggers. */
export interface EngineerButtonBindings {
  /** Hold/press to listen-and-ask. Null = unbound. */
  pushToTalk: EngineerButtonBinding | null
  /** presetId → button binding. Only ids that still exist as presets are kept. */
  presets: Record<string, EngineerButtonBinding>
}

export interface EngineerConfig {
  /** Master on/off for the AI engineer. When off, `ask` returns a friendly note. */
  enabled: boolean
  /** Default answer language (also the LLM persona language). */
  language: EngineerLanguage
  /** Persona bluntness. Drives the system prompt + few-shot + generation params. */
  assertiveness: EngineerAssertiveness
  /** Proactive per-sector voice coaching: the engineer speaks on its own after each sector. */
  proactiveCoaching: boolean
  /** Coach intent sensitivity: higher values lower the silence threshold and speak more. */
  intentSensitivity: number
  /** Active model id (catalog default = 1.5B, light = 0.5B). */
  modelId: ModelId
  /** CPU threads for inference. 0 = auto (runtime picks min(4, cores-2)). */
  threads: number
  /** Idle time (ms) before the model is unloaded to free RAM. */
  idleUnloadMs: number
  /** Speak answers aloud (renderer TTS) when true. */
  speakAnswers: boolean
  /** Hard cap on generated tokens per answer. */
  maxTokens: number
  /** Editable canned questions the user can fire (and bind to buttons). */
  presetQuestions: EngineerPresetQuestion[]
  /** Hardware button bindings for push-to-talk + preset questions. */
  buttonBindings: EngineerButtonBindings
  /** Epoch ms of the last write (stamped on save). */
  updatedAt?: number
}

export type EngineerConfigPatch = Partial<EngineerConfig>

export const ENGINEER_LIMITS = {
  threadsMin: 0,
  threadsMax: 8,
  idleUnloadMsMin: 15_000,
  idleUnloadMsMax: 30 * 60 * 1000,
  maxTokensMin: 32,
  maxTokensMax: 512,
  presetQuestionsMax: 12,
  presetIdMax: 64,
  presetLabelMax: 40,
  presetTextMax: 200
} as const

/** Seed presets (mirror the example chips) so the feature is useful out of the box. */
export const DEFAULT_PRESET_QUESTIONS: readonly EngineerPresetQuestion[] = [
  { id: 'fuel', label: 'Fuel', text: 'can we finish on this fuel?' },
  { id: 'box', label: 'Box now?', text: 'box now?' },
  { id: 'pace', label: 'My pace', text: 'how is my pace?' },
  { id: 'tires', label: 'Tyres', text: 'how are the tyres?' },
  { id: 'gap', label: 'Gap ahead', text: 'what is the gap ahead?' }
]

export const DEFAULT_ENGINEER_CONFIG: EngineerConfig = {
  enabled: true,
  language: 'en-US',
  assertiveness: 'brutal',
  // Proactive coaching ON by default, but it SPEAKS only in a RACE (corner-numbered
  // + directional call-outs). In practice/qualy the Live Coach owns the audio (per
  // sector) and the proactive engine stays silent — exactly one speaker per session.
  // The engineer also stays ENABLED for on-demand Q&A.
  proactiveCoaching: true,
  intentSensitivity: 0.6,
  modelId: DEFAULT_MODEL_ID,
  threads: 0,
  idleUnloadMs: 3 * 60 * 1000,
  speakAnswers: true,
  maxTokens: 150,
  presetQuestions: DEFAULT_PRESET_QUESTIONS.map((q) => ({ ...q })),
  buttonBindings: { pushToTalk: null, presets: {} }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function isLanguage(value: unknown): value is EngineerLanguage {
  return value === 'pt-BR' || value === 'en-US'
}

function isAssertiveness(value: unknown): value is EngineerAssertiveness {
  return value === 'balanced' || value === 'assertive' || value === 'brutal'
}

function clampText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

/** Validate + clamp a single button binding. Returns null when unusable. */
export function sanitizeButtonBinding(value: unknown): EngineerButtonBinding | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Partial<EngineerButtonBinding>
  const buttonIndex = typeof v.buttonIndex === 'number' ? v.buttonIndex : Number(v.buttonIndex)
  if (!Number.isFinite(buttonIndex) || buttonIndex < 0) return null
  const binding: EngineerButtonBinding = { buttonIndex: Math.floor(buttonIndex) }
  if (typeof v.gamepadIndex === 'number' && Number.isFinite(v.gamepadIndex) && v.gamepadIndex >= 0) {
    binding.gamepadIndex = Math.floor(v.gamepadIndex)
  }
  if (typeof v.gamepadId === 'string' && v.gamepadId.length > 0) binding.gamepadId = v.gamepadId.slice(0, 200)
  return binding
}

/** Validate + clamp the preset list: drop invalid/blank entries, dedupe ids, cap count. */
export function sanitizePresetQuestions(value: unknown): EngineerPresetQuestion[] {
  if (!Array.isArray(value)) return []
  const out: EngineerPresetQuestion[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Partial<EngineerPresetQuestion>
    const id = clampText(r.id, ENGINEER_LIMITS.presetIdMax).trim()
    const text = clampText(r.text, ENGINEER_LIMITS.presetTextMax).trim()
    if (!id || !text || seen.has(id)) continue
    const label = clampText(r.label, ENGINEER_LIMITS.presetLabelMax).trim() || text.slice(0, ENGINEER_LIMITS.presetLabelMax)
    seen.add(id)
    out.push({ id, label, text })
    if (out.length >= ENGINEER_LIMITS.presetQuestionsMax) break
  }
  return out
}

/** Validate button bindings, dropping preset bindings whose preset no longer exists. */
export function sanitizeButtonBindings(value: unknown, presets: EngineerPresetQuestion[]): EngineerButtonBindings {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<EngineerButtonBindings>
  const presetIds = new Set(presets.map((p) => p.id))
  const presetBindings: Record<string, EngineerButtonBinding> = {}
  const rawPresets = v.presets && typeof v.presets === 'object' ? (v.presets as Record<string, unknown>) : {}
  for (const [id, binding] of Object.entries(rawPresets)) {
    if (!presetIds.has(id)) continue
    const clean = sanitizeButtonBinding(binding)
    if (clean) presetBindings[id] = clean
  }
  return { pushToTalk: sanitizeButtonBinding(v.pushToTalk), presets: presetBindings }
}

/** Validate + clamp a (partial) config onto a base. Pure — safe in any process. */
export function mergeEngineerConfig(base: EngineerConfig, patch: EngineerConfigPatch | null | undefined): EngineerConfig {
  const p = patch ?? {}
  const presetQuestions = p.presetQuestions !== undefined ? sanitizePresetQuestions(p.presetQuestions) : base.presetQuestions
  const buttonBindings =
    p.buttonBindings !== undefined
      ? sanitizeButtonBindings(p.buttonBindings, presetQuestions)
      : // Re-validate the base bindings against the (possibly new) preset list so a
        // removed preset never keeps a dangling button binding.
        sanitizeButtonBindings(base.buttonBindings, presetQuestions)
  return {
    enabled: typeof p.enabled === 'boolean' ? p.enabled : base.enabled,
    language: isLanguage(p.language) ? p.language : base.language,
    assertiveness: isAssertiveness(p.assertiveness) ? p.assertiveness : base.assertiveness,
    proactiveCoaching: typeof p.proactiveCoaching === 'boolean' ? p.proactiveCoaching : base.proactiveCoaching,
    intentSensitivity:
      typeof p.intentSensitivity === 'number' && Number.isFinite(p.intentSensitivity)
        ? Math.min(1, Math.max(0, p.intentSensitivity))
        : base.intentSensitivity,
    modelId: typeof p.modelId === 'string' && p.modelId.length > 0 ? p.modelId : base.modelId,
    threads: clampInt(p.threads ?? base.threads, ENGINEER_LIMITS.threadsMin, ENGINEER_LIMITS.threadsMax, base.threads),
    idleUnloadMs: clampInt(
      p.idleUnloadMs ?? base.idleUnloadMs,
      ENGINEER_LIMITS.idleUnloadMsMin,
      ENGINEER_LIMITS.idleUnloadMsMax,
      base.idleUnloadMs
    ),
    speakAnswers: typeof p.speakAnswers === 'boolean' ? p.speakAnswers : base.speakAnswers,
    maxTokens: clampInt(p.maxTokens ?? base.maxTokens, ENGINEER_LIMITS.maxTokensMin, ENGINEER_LIMITS.maxTokensMax, base.maxTokens),
    presetQuestions,
    buttonBindings,
    updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : base.updatedAt
  }
}

// ─── Command directive ─────────────────────────────────────────────────────────
//
// The deterministic intent-router emits a structured command (dashboard.next,
// fuel.reset, revlights.*, …). Main can't reach the other modules' live engines
// without editing them, so it resolves each command to the EXISTING renderer IPC
// channel (exactly how the renderer triggers it today) and broadcasts a directive
// for the EngineerView to invoke. `executable: false` marks commands with no
// existing channel (setup.save / lap.mark) — those get an honest spoken reply.

export interface EngineerCommandDirective {
  kind: IntentCommandKind
  /** Existing `window.ipc` channel to invoke, or null when none exists. */
  channel: string | null
  /** Positional args for the channel invoke. */
  args: unknown[]
  /** Read-modify-write toggle (revlights): read current state, then setEnabled(!state). */
  toggle: boolean
  /** Whether a concrete existing IPC channel backs this command. */
  executable: boolean
}

export function resolveCommandDirective(kind: IntentCommandKind, args?: Record<string, unknown>): EngineerCommandDirective {
  switch (kind) {
    case 'dashboard.next':
      return { kind, channel: 'app:dash:cycle', args: ['next'], toggle: false, executable: true }
    case 'dashboard.prev':
      return { kind, channel: 'app:dash:cycle', args: ['prev'], toggle: false, executable: true }
    case 'fuel.reset':
      return { kind, channel: 'fuel:reset', args: [], toggle: false, executable: true }
    case 'revlights.enable':
      return { kind, channel: 'revlights:setEnabled', args: [true], toggle: false, executable: true }
    case 'revlights.disable':
      return { kind, channel: 'revlights:setEnabled', args: [false], toggle: false, executable: true }
    case 'revlights.toggle':
      return { kind, channel: 'revlights:setEnabled', args: [], toggle: true, executable: true }
    case 'setup.save':
    case 'lap.mark':
    default:
      // No existing single IPC channel — honest "can't do that here yet" reply.
      return { kind, channel: null, args: typeof args === 'object' ? [] : [], toggle: false, executable: false }
  }
}

// ─── Engineer actions (hardware Q&A triggers) ──────────────────────────────────
//
// Two ADDITIVE engineer action kinds, fired from a hardware button: a push-to-talk
// (listen-and-ask) and one per preset question. They are resolved against the live
// config and executed by the renderer (EngineerView) — they never touch serial,
// iFlag, revlights, or the global action bindings store.

export const ENGINEER_PUSH_TO_TALK_ACTION_ID = 'engineer.pushToTalk'
export const ENGINEER_PRESET_ACTION_PREFIX = 'engineer.askPreset:'

/** Stable action id for a preset question button. */
export function presetActionId(presetId: string): string {
  return `${ENGINEER_PRESET_ACTION_PREFIX}${presetId}`
}

export type EngineerActionKind = 'pushToTalk' | 'askPreset'

/** What the renderer executes when an engineer action fires. */
export interface EngineerActionDirective {
  kind: EngineerActionKind
  /** Present for askPreset — the preset id that fired. */
  presetId?: string
  /** Present for askPreset — the question text to send over `engineer:ask`. */
  text?: string
}

/** A bindable engineer action (push-to-talk + one per preset) for the binding UI. */
export interface EngineerActionDescriptor {
  id: string
  kind: EngineerActionKind
  label: string
  presetId?: string
  binding: EngineerButtonBinding | null
}

/** All engineer actions for the current config (push-to-talk first, then presets). */
export function listEngineerActions(config: EngineerConfig): EngineerActionDescriptor[] {
  const actions: EngineerActionDescriptor[] = [
    {
      id: ENGINEER_PUSH_TO_TALK_ACTION_ID,
      kind: 'pushToTalk',
      label: 'Push-to-talk',
      binding: config.buttonBindings.pushToTalk
    }
  ]
  for (const preset of config.presetQuestions) {
    actions.push({
      id: presetActionId(preset.id),
      kind: 'askPreset',
      label: preset.label,
      presetId: preset.id,
      binding: config.buttonBindings.presets[preset.id] ?? null
    })
  }
  return actions
}

/** Resolve an action id against the config into an executable directive, or null. */
export function resolveEngineerAction(config: EngineerConfig, actionId: string): EngineerActionDirective | null {
  if (actionId === ENGINEER_PUSH_TO_TALK_ACTION_ID) return { kind: 'pushToTalk' }
  if (actionId.startsWith(ENGINEER_PRESET_ACTION_PREFIX)) {
    const presetId = actionId.slice(ENGINEER_PRESET_ACTION_PREFIX.length)
    const preset = config.presetQuestions.find((p) => p.id === presetId)
    if (preset) return { kind: 'askPreset', presetId, text: preset.text }
  }
  return null
}

// ─── Answer / status payloads ──────────────────────────────────────────────────

export type EngineerAnswerKind = 'answer' | 'command' | 'disabled' | 'error'
export type EngineerAnswerSource = 'intent' | 'command' | 'llm' | 'system'

/** Payload of `engineer:answer` and the resolved value of `engineer:ask`. */
export interface EngineerAnswer {
  /** Stable id for renderer de-duplication (broadcast + invoke-return arrive twice). */
  id: string
  /** Epoch ms. */
  at: number
  /** The original question (so the renderer can render Q+A pairs). */
  question: string
  /** The spoken/displayed answer text. */
  text: string
  /** Optional shorter radio payload; UI keeps `text`, TTS prefers this value. */
  speechText?: string
  /** Whether the renderer should speak this answer (already gated by speakAnswers). */
  speak: boolean
  /** Language the answer text is in — drives the renderer's TTS voice (Piper/Web Speech). */
  lang?: EngineerMessageLanguage
  kind: EngineerAnswerKind
  source: EngineerAnswerSource
  /** Present for command intents — the renderer executes this directive. */
  command?: EngineerCommandDirective
}

/** Resolved value of `engineer:getStatus` and payload of `engineer:status`. */
export interface EngineerStatus {
  enabled: boolean
  activeModelId: ModelId
  runtime: LlmRuntimeStatus
  models: ModelStatus[]
  config: EngineerConfig
}

/**
 * Payload of `engineer:proactive` — a self-initiated finding, race-status, or
 * qualifying briefing.
 *
 * Finding events are composed from deterministic coach evidence. Informational
 * events carry no fabricated sector/finding fields. The renderer shows the event
 * in a feed and routes spoken events through the same TTS seam answers use.
 */
export interface EngineerProactiveEvent {
  /** Stable id for renderer de-duplication. */
  id: string
  /** Epoch ms. */
  at: number
  /** The brutal one-liner to display/speak. */
  text: string
  /** Explicit shape so informational/no-data events never masquerade as findings. */
  eventType?: 'finding' | 'race-status' | 'quali-briefing' | 'insufficient-history'
  /** 1-based sector this call-out is about, only when evidence is sector-scoped. */
  sector?: number
  /** The coach finding kind that drove the call-out, absent for informational events. */
  kind?: CoachFindingKind
  severity?: CoachSeverity
  /** Estimated time lost to the called-out issue, absent when no finding exists. */
  estTimeLossSec?: number
  /** Whether the renderer should speak this (gated by proactiveCoaching + enabled). */
  speak: boolean
  /** Language the text was composed in (drives TTS voice). */
  lang: EngineerMessageLanguage
  /** Which subsystem produced this call-out (for the TTS/observability log). */
  source?: 'engineer'
  /** Telemetry epoch/revision that authorized this emission. */
  telemetryContext?: {
    state: 'live' | 'replay' | 'unknown'
    connectionEpoch: number
    revision: number
    token: string
    sessionIdentity?: string
  }
  /** 1-based corner number this call-out is about, when corner-scoped (Turn N). */
  corner?: number
}

// Re-export the progress type so renderer code can import everything engineer-shaped
// from one module without also reaching into shared/ai.ts.
export type { ModelDownloadProgress }
