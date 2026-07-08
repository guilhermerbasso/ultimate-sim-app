import { type CSSProperties, type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppViewProps } from '../App'
import { VoiceSpotterSection } from './VoiceSpotterSection'
import type { ModelDownloadProgress, ModelId, ModelStatus, ModelTier } from '../../../shared/ai'
import { MODEL_TIER_ORDER } from '../../../shared/ai'
import {
  DEFAULT_ENGINEER_CONFIG,
  ENGINEER_CHANNELS,
  ENGINEER_LIMITS,
  ENGINEER_PUSH_TO_TALK_ACTION_ID,
  type EngineerAnswer,
  type EngineerAssertiveness,
  type EngineerButtonBinding,
  type EngineerCommandDirective,
  type EngineerConfig,
  type EngineerLanguage,
  type EngineerPresetQuestion,
  type EngineerProactiveEvent,
  type EngineerStatus,
  mergeEngineerConfig,
  presetActionId
} from '../../../shared/engineer-ipc'
import { logClient } from '../lib/log-client'
import { findFirstPressedButton } from '../lib/gamepad'
import { setActionRuntimeSuppressed } from '../lib/action-runtime'
import { tt } from '../i18n'
import { seedEngineerBindingPressed, subscribeEngineerListening } from '../lib/engineer-action-runtime'

// AI Race Engineer (text-first). Wraps the local-LLM orchestrator exposed over
// `engineer:` IPC: a status/settings panel + an ask box with a scrollable Q&A log.
// Deterministic intent answers come back instantly (no model); open-ended questions
// lazily load the local model. Answers are spoken via the browser Web Speech API
// (the same engine the Voice Spotter uses) when answer speech is enabled.
//
// SEAM: push-to-talk + preset-question hardware triggers live in the APP-LEVEL
// `useEngineerActionRuntime` hook (mounted in App.tsx) so they fire on every screen.
// This view owns the Q&A log, the model picker, and the preset/binding EDITOR UI; it
// routes its 🎙 button + bound-button capture through that hook.

const EXAMPLE_CHIPS = [
  'can we finish on this fuel?',
  'box now?',
  'how is my pace?',
  'how are the tyres?',
  'what is the gap ahead?'
]

const shell: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(360px, 1.15fr) minmax(320px, 0.85fr)',
  gap: 18,
  alignItems: 'start'
}

const panel: CSSProperties = {
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-6)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-4)'
}

const eyebrow: CSSProperties = {
  color: 'var(--text-muted)',
  fontFamily: '"Barlow Condensed", sans-serif',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase'
}

const title: CSSProperties = {
  color: 'var(--text-primary)',
  fontFamily: '"Rajdhani", sans-serif',
  fontSize: 18,
  fontWeight: 700,
  margin: 0
}

const label: CSSProperties = {
  color: 'var(--text-muted)',
  fontFamily: '"Barlow Condensed", sans-serif',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.10em',
  textTransform: 'uppercase'
}

const inputStyle: CSSProperties = {
  width: '100%',
  background: 'var(--surface-sunken)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)',
  fontFamily: '"Instrument Sans", sans-serif',
  padding: '0 var(--space-4)',
  height: 38
}

const selectStyle: CSSProperties = { ...inputStyle, height: 32, padding: '0 var(--space-3)' }

const primaryButton: CSSProperties = {
  background: 'var(--accent-primary)',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-on-accent)',
  cursor: 'pointer',
  fontFamily: '"Rajdhani", sans-serif',
  fontWeight: 600,
  textTransform: 'uppercase',
  padding: '0 var(--space-6)',
  height: 38,
  letterSpacing: '0.08em'
}

const ghostButton: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  fontFamily: '"Rajdhani", sans-serif',
  fontWeight: 600,
  textTransform: 'uppercase',
  padding: '0 var(--space-5)',
  height: 30,
  letterSpacing: '0.06em'
}

const chipButton: CSSProperties = {
  background: 'var(--surface-sunken)',
  border: '1px solid var(--border-default)',
  borderRadius: 999,
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontFamily: '"Instrument Sans", sans-serif',
  fontSize: 12,
  padding: '6px 12px'
}

const settingRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-4)'
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// synthAvailable: warms the OS Web-Speech voice list on mount. Actual speech is owned
// by the global consumer in App.tsx (Piper TTS via speakViaTts), so the Engineer view
// itself never speaks — it only renders the chat log + proactive feed.
function synthAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined'
}

// Human label for a captured button binding.
function formatBinding(binding: EngineerButtonBinding | null): string {
  if (!binding) return 'No button'
  return `Button ${binding.buttonIndex + 1}`
}

// Stable-ish id for a freshly added preset question.
function makePresetId(): string {
  return `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

// ─── Command execution — reuse the EXISTING renderer IPC the app uses today ─────

async function executeDirective(directive: EngineerCommandDirective): Promise<void> {
  if (!directive.executable || !directive.channel) return
  try {
    if (directive.toggle && directive.channel === 'revlights:setEnabled') {
      const cfg = await window.ipc.invoke<{ enabled?: boolean }>('revlights:getConfig')
      await window.ipc.invoke('revlights:setEnabled', !cfg?.enabled)
      return
    }
    await window.ipc.invoke(directive.channel, ...directive.args)
  } catch {
    // Best-effort: a missing/failed action must not break the engineer chat.
  }
}

// ─── Model state derivation ──────────────────────────────────────────────────

interface ModelView {
  text: string
  tone: 'good' | 'active' | 'idle'
  ratio: number | null
}

function deriveModelView(language: AppViewProps['language'], status: EngineerStatus | null, progress: ModelDownloadProgress | null): ModelView {
  const active = status?.models.find((m) => m.active) ?? null
  if (progress && progress.phase !== 'done' && progress.phase !== 'error') {
    return { text: tt(language, 'engineer.model.downloading', { pct: Math.round(progress.ratio * 100) }), tone: 'active', ratio: progress.ratio }
  }
  if (progress?.phase === 'error') return { text: tt(language, 'engineer.model.downloadFailed'), tone: 'idle', ratio: null }
  const runtime = status?.runtime.status
  if (runtime === 'generating') return { text: tt(language, 'engineer.model.generating'), tone: 'active', ratio: null }
  if (!active?.present) return { text: tt(language, 'engineer.model.notDownloaded'), tone: 'idle', ratio: null }
  if (runtime === 'ready') return { text: tt(language, 'engineer.model.loaded'), tone: 'good', ratio: null }
  if (runtime === 'loading') return { text: tt(language, 'engineer.model.loading'), tone: 'active', ratio: null }
  return { text: tt(language, 'engineer.model.ready'), tone: 'good', ratio: null }
}

function toneColor(tone: ModelView['tone']): string {
  if (tone === 'good') return 'var(--accent-success)'
  if (tone === 'active') return 'var(--accent-primary)'
  return 'var(--text-muted)'
}

// Compact human size for the model tier cards (GB with one decimal, or MB below 1 GB).
function formatModelSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  return `${Math.round(bytes / 1_000_000)} MB`
}

// Proactive call-outs are MISTAKES — always warm tones, never green (green is
// reserved for positive states): danger → warning → primary by severity.
function proactiveColor(severity: EngineerProactiveEvent['severity']): string {
  if (severity === 'high') return 'var(--accent-danger)'
  if (severity === 'med') return 'var(--accent-warning)'
  return 'var(--accent-primary)'
}

// ─── View ────────────────────────────────────────────────────────────────────

export default function EngineerView({ showToast, language }: AppViewProps): ReactElement {
  const [config, setConfig] = useState<EngineerConfig>(DEFAULT_ENGINEER_CONFIG)
  const [status, setStatus] = useState<EngineerStatus | null>(null)
  const [progress, setProgress] = useState<ModelDownloadProgress | null>(null)
  const [log, setLog] = useState<EngineerAnswer[]>([])
  const [proactive, setProactive] = useState<EngineerProactiveEvent[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [downloading, setDownloading] = useState(false)
  // Session-only pick: highlights a model in the picker without persisting it. The
  // PERSISTED default is config.modelId; the set-default button promotes
  // this session pick to default so the choice survives nav/restart.
  const [sessionModelId, setSessionModelId] = useState<ModelId | null>(null)

  // Push-to-talk + preset-question binding state.
  type CaptureTarget = { kind: 'pushToTalk' } | { kind: 'preset'; id: string } | null
  const [captureTarget, setCaptureTarget] = useState<CaptureTarget>(null)
  const [listening, setListening] = useState(false)
  const [draftLabel, setDraftLabel] = useState('')
  const [draftText, setDraftText] = useState('')
  // Local, uncommitted edits for the preset label/text inputs. Persisted on blur/Enter
  // (debounced by interaction) so a keystroke no longer triggers a synchronous disk write.
  const [presetDrafts, setPresetDrafts] = useState<Record<string, { label?: string; text?: string }>>({})

  const seenIds = useRef<Set<string>>(new Set())
  const logEndRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const configRef = useRef<EngineerConfig>(config)
  configRef.current = config

  // Apply a server config snapshot ONLY when it is at least as fresh as the local one.
  // The 1.5s status poll + status broadcasts can resolve out of order: a getStatus
  // dispatched BEFORE a setConfig save returns the OLD modelId and would otherwise
  // revert a just-made pick (the "selection won't stick" bug). updatedAt gates that.
  const applyServerConfig = useCallback((incoming: EngineerConfig | null | undefined) => {
    if (!incoming) return
    const localAt = configRef.current.updatedAt ?? 0
    const incomingAt = incoming.updatedAt ?? 0
    if (incomingAt >= localAt) setConfig(incoming)
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      const next = await window.ipc.invoke<EngineerStatus>(ENGINEER_CHANNELS.getStatus)
      setStatus(next)
      applyServerConfig(next?.config)
    } catch {
      // ignore — the panel simply shows the last known state
    }
  }, [applyServerConfig])

  const addAnswer = useCallback((answer: EngineerAnswer) => {
    if (!answer || seenIds.current.has(answer.id)) return
    seenIds.current.add(answer.id)
    setLog((prev) => [...prev, answer].slice(-50))
  }, [])

  // Proactive per-sector call-outs: render in the feed. Speech is owned by the global
  // consumer in App.tsx so it's heard on every screen (no double-speak).
  const addProactive = useCallback((event: EngineerProactiveEvent) => {
    if (!event || seenIds.current.has(event.id)) return
    seenIds.current.add(event.id)
    setProactive((prev) => [...prev, event].slice(-20))
  }, [])

  // Initial load + subscriptions.
  useEffect(() => {
    void (async () => {
      try {
        const cfg = await window.ipc.invoke<EngineerConfig>(ENGINEER_CHANNELS.getConfig)
        if (cfg) applyServerConfig(cfg)
      } catch {
        // keep defaults
      }
      await refreshStatus()
    })()

    // Warm up the speech voice list (some browsers populate it asynchronously).
    if (synthAvailable()) window.speechSynthesis.getVoices()

    const unsubAnswer = window.ipc.subscribe<EngineerAnswer>(ENGINEER_CHANNELS.answer, (answer) => addAnswer(answer))
    const unsubProactive = window.ipc.subscribe<EngineerProactiveEvent>(ENGINEER_CHANNELS.proactive, (event) => addProactive(event))
    const unsubCommand = window.ipc.subscribe<EngineerCommandDirective>(ENGINEER_CHANNELS.command, (directive) => {
      void executeDirective(directive)
    })
    const unsubProgress = window.ipc.subscribe<ModelDownloadProgress>(ENGINEER_CHANNELS.modelProgress, (p) => {
      setProgress(p)
      if (p.phase === 'done' || p.phase === 'error') void refreshStatus()
    })
    const unsubStatus = window.ipc.subscribe<EngineerStatus>(ENGINEER_CHANNELS.statusEvent, (s) => {
      setStatus(s)
      applyServerConfig(s?.config)
    })

    const poll = window.setInterval(() => void refreshStatus(), 1500)
    return () => {
      unsubAnswer()
      unsubProactive()
      unsubCommand()
      unsubProgress()
      unsubStatus()
      window.clearInterval(poll)
    }
  }, [addAnswer, addProactive, refreshStatus, applyServerConfig])

  // Reflect the app-level push-to-talk listening state in this view's 🎙 button.
  useEffect(() => subscribeEngineerListening(setListening), [])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [log])

  const modelView = useMemo(() => deriveModelView(language, status, progress), [language, status, progress])
  const exampleChips = EXAMPLE_CHIPS
  const models: ModelStatus[] = status?.models ?? []
  const activeModel = models.find((m) => m.active) ?? null

  // Group the catalog into the 3 user-facing tiers (light / balanced / quality),
  // preserving the canonical low→high order for the picker.
  const tierModels = useMemo<{ tier: ModelTier; model: ModelStatus }[]>(() => {
    const out: { tier: ModelTier; model: ModelStatus }[] = []
    for (const tier of MODEL_TIER_ORDER) {
      const model = models.find((m) => m.tier === tier)
      if (model) out.push({ tier, model })
    }
    return out
  }, [models])

  const ask = useCallback(
    async (text: string) => {
      const question = text.trim()
      if (!question || busy) return
      setBusy(true)
      setInput('')
      try {
        const answer = await window.ipc.invoke<EngineerAnswer>(ENGINEER_CHANNELS.ask, question)
        if (answer) addAnswer(answer)
      } catch (error) {
        showToast(tt(language, 'engineer.toast.askFailed', { error: getErrorMessage(error) }), 'error')
      } finally {
        setBusy(false)
        void refreshStatus()
      }
    },
    [busy, addAnswer, refreshStatus, showToast, language]
  )

  // Fire push-to-talk through the app-level runtime (works even when this view is the
  // one mounted). Routing via main keeps a single speech owner — no double-listen.
  const triggerPushToTalk = useCallback(() => {
    void window.ipc.invoke(ENGINEER_CHANNELS.invokeAction, { actionId: ENGINEER_PUSH_TO_TALK_ACTION_ID }).catch(() => undefined)
  }, [])

  const patchConfig = useCallback(
    async (patch: Partial<EngineerConfig>) => {
      // Optimistically apply the change with a fresh updatedAt so the picker reflects it
      // instantly and an in-flight status poll (older updatedAt) can't revert it mid-save.
      setConfig((prev) => mergeEngineerConfig(prev, { ...patch, updatedAt: Date.now() }))
      try {
        const next = await window.ipc.invoke<EngineerConfig>(ENGINEER_CHANNELS.setConfig, patch)
        if (next) setConfig(next)
        void refreshStatus()
      } catch (error) {
        showToast(tt(language, 'engineer.toast.saveFailed', { error: getErrorMessage(error) }), 'error')
      }
    },
    [refreshStatus, showToast, language]
  )

  // The model highlighted in the picker: the session pick if any, else the persisted
  // default. The persisted default (config.modelId) is the source of truth that survives
  // navigation/restart and drives the runtime; sessionModelId is just the UI selection.
  const selectedModelId = sessionModelId ?? config.modelId
  const selectionIsDefault = selectedModelId === config.modelId

  // Promote the picker selection to the PERSISTED default via setConfig(modelId). This is
  // why the choice sticks: patchConfig writes config.modelId, which is reloaded on restart.
  const setSelectedAsDefault = useCallback(() => {
    if (selectionIsDefault) return
    logClient.info('engineer', 'set default model', { modelId: selectedModelId })
    void patchConfig({ modelId: selectedModelId })
    showToast(tt(language, 'engineer.toast.defaultModelSet'), 'success')
  }, [patchConfig, selectedModelId, selectionIsDefault, showToast, language])

  // ── Preset questions CRUD ───────────────────────────────────────────────────
  const addPreset = useCallback(() => {
    const text = draftText.trim()
    if (!text) return
    const current = configRef.current.presetQuestions
    if (current.length >= ENGINEER_LIMITS.presetQuestionsMax) {
      showToast(tt(language, 'engineer.toast.presetLimit', { count: ENGINEER_LIMITS.presetQuestionsMax }), 'info')
      return
    }
    const label = draftLabel.trim() || text.slice(0, ENGINEER_LIMITS.presetLabelMax)
    const next: EngineerPresetQuestion[] = [...current, { id: makePresetId(), label, text }]
    setDraftLabel('')
    setDraftText('')
    void patchConfig({ presetQuestions: next })
  },   [draftLabel, draftText, patchConfig, showToast, language])

  const removePreset = useCallback(
    (id: string) => {
      const next = configRef.current.presetQuestions.filter((p) => p.id !== id)
      void patchConfig({ presetQuestions: next })
    },
    [patchConfig]
  )

  const updatePreset = useCallback(
    (id: string, patch: Partial<Omit<EngineerPresetQuestion, 'id'>>) => {
      const next = configRef.current.presetQuestions.map((p) => (p.id === id ? { ...p, ...patch } : p))
      void patchConfig({ presetQuestions: next })
    },
    [patchConfig]
  )

  // Preset edit drafts (m1): keep keystrokes local; persist only on blur/Enter so we
  // don't writeFileSync per character. The displayed value prefers the live draft.
  const presetValue = useCallback(
    (preset: EngineerPresetQuestion, field: 'label' | 'text'): string => presetDrafts[preset.id]?.[field] ?? preset[field],
    [presetDrafts]
  )

  const editPresetDraft = useCallback((id: string, field: 'label' | 'text', value: string) => {
    setPresetDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
  }, [])

  const commitPresetDraft = useCallback(
    (id: string, field: 'label' | 'text') => {
      const draft = presetDrafts[id]
      const value = draft?.[field]
      if (value === undefined) return
      setPresetDrafts((prev) => {
        const nextForId = { ...prev[id] }
        delete nextForId[field]
        const next = { ...prev }
        if (Object.keys(nextForId).length === 0) delete next[id]
        else next[id] = nextForId
        return next
      })
      const preset = configRef.current.presetQuestions.find((p) => p.id === id)
      if (preset && preset[field] !== value) updatePreset(id, { [field]: value })
    },
    [presetDrafts, updatePreset]
  )

  // ── Button binding helpers (write into config.buttonBindings) ────────────────
  const clearBinding = useCallback(
    (target: { kind: 'pushToTalk' } | { kind: 'preset'; id: string }) => {
      const bindings = configRef.current.buttonBindings
      if (target.kind === 'pushToTalk') {
        void patchConfig({ buttonBindings: { ...bindings, pushToTalk: null } })
        return
      }
      const presets = { ...bindings.presets }
      delete presets[target.id]
      void patchConfig({ buttonBindings: { ...bindings, presets } })
    },
    [patchConfig]
  )

  const saveBinding = useCallback(
    (target: { kind: 'pushToTalk' } | { kind: 'preset'; id: string }, binding: EngineerButtonBinding) => {
      const bindings = configRef.current.buttonBindings
      if (target.kind === 'pushToTalk') {
        void patchConfig({ buttonBindings: { ...bindings, pushToTalk: binding } })
        return
      }
      void patchConfig({ buttonBindings: { ...bindings, presets: { ...bindings.presets, [target.id]: binding } } })
    },
    [patchConfig]
  )

  const downloadModel = useCallback(async () => {
    setDownloading(true)
    try {
      const result = await window.ipc.invoke<{ ok: boolean; error?: string }>(ENGINEER_CHANNELS.ensureModel)
      if (!result?.ok) showToast(tt(language, 'engineer.toast.downloadFailed', { error: result?.error ?? tt(language, 'common.errorUnknown') }), 'error')
      else showToast(tt(language, 'engineer.toast.modelReady'), 'success')
    } catch (error) {
      showToast(tt(language, 'engineer.toast.downloadFailed', { error: getErrorMessage(error) }), 'error')
    } finally {
      setDownloading(false)
      void refreshStatus()
    }
  }, [refreshStatus, showToast, language])

  const cancel = useCallback(() => {
    void window.ipc.invoke(ENGINEER_CHANNELS.cancel).catch(() => undefined)
  }, [])

  // ── Capture mode: arm a rAF loop that grabs the first pressed HID button ──────
  // Suppresses the GLOBAL action runtime while armed (reused helper) so binding a
  // button never fires unrelated mappings mid-capture. Execution of engineer actions
  // (poll + push-to-talk speech) lives in the app-level useEngineerActionRuntime hook.
  useEffect(() => {
    if (!captureTarget) return undefined
    setActionRuntimeSuppressed(true)
    const pressedState = new Map<string, boolean>()
    let frame = 0
    const tick = (): void => {
      const pressed = findFirstPressedButton(pressedState)
      if (pressed) {
        const binding: EngineerButtonBinding = {
          buttonIndex: pressed.buttonIndex,
          gamepadIndex: pressed.gamepadIndex,
          gamepadId: pressed.gamepadId
        }
        // m2: seed the new binding as "pressed" so the app-level runtime requires a
        // physical RELEASE before firing — the button is still held at this instant.
        const actionId = captureTarget.kind === 'pushToTalk' ? ENGINEER_PUSH_TO_TALK_ACTION_ID : presetActionId(captureTarget.id)
        seedEngineerBindingPressed(actionId, binding)
        saveBinding(captureTarget, binding)
        setCaptureTarget(null)
        return
      }
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setCaptureTarget(null)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKey)
      setActionRuntimeSuppressed(false)
    }
  }, [captureTarget, saveBinding])

  const needsDownload = Boolean(activeModel && !activeModel.present)
  const pushToTalkBinding = config.buttonBindings.pushToTalk

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={shell}>
      {/* ── Left: ask + log ─────────────────────────────────────────────── */}
      <section style={panel}>
        <div>
          <div style={eyebrow}>{tt(language, 'engineer.ask.eyebrow')}</div>
          <h2 style={title}>{tt(language, 'engineer.ask.title')}</h2>
        </div>

        {!config.enabled && (
          <div
            style={{
              background: 'var(--surface-sunken)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-muted)',
              fontSize: 13,
              padding: 'var(--space-3) var(--space-4)'
            }}
          >
            {tt(language, 'engineer.disabled')}
          </div>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <input
            ref={inputRef}
            style={inputStyle}
            placeholder={tt(language, 'engineer.ask.placeholder')}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void ask(input)
            }}
            aria-label={tt(language, 'engineer.ask.aria')}
          />
          <button
            type="button"
            style={{ ...primaryButton, opacity: busy || !input.trim() ? 0.6 : 1 }}
            disabled={busy || !input.trim()}
            onClick={() => void ask(input)}
          >
            {busy ? tt(language, 'engineer.ask.thinking') : tt(language, 'engineer.ask.button')}
          </button>
          {busy && (
            <button type="button" style={ghostButton} onClick={cancel}>
              {tt(language, 'common.stop')}
            </button>
          )}
          {/* Push-to-talk: routes through the app-level runtime so it behaves the same
              whether triggered here or by a bound button on any screen. */}
          <button
            type="button"
            style={{
              ...ghostButton,
              borderColor: listening ? 'var(--accent-primary)' : 'var(--border-strong)',
              color: listening ? 'var(--accent-primary)' : 'var(--text-primary)'
            }}
            onClick={triggerPushToTalk}
            title={pushToTalkBinding ? tt(language, 'engineer.ptt.boundTitle', { binding: formatBinding(pushToTalkBinding) }) : tt(language, 'engineer.ptt.title')}
            aria-label={tt(language, 'engineer.ptt.aria')}
          >
            {listening ? tt(language, 'engineer.ptt.listening') : '🎙'}
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {exampleChips.map((chip) => (
            <button key={chip} type="button" style={chipButton} disabled={busy} onClick={() => void ask(chip)}>
              {chip}
            </button>
          ))}
        </div>

        {/* ── Proactive per-sector call-outs feed (newest first) ───────────── */}
        {proactive.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={eyebrow}>{tt(language, 'engineer.proactive.eyebrow')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
              {[...proactive].reverse().map((event) => (
                <div
                  key={event.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    background: 'var(--surface-sunken)',
                    border: '1px solid var(--border-default)',
                    borderLeft: `3px solid ${proactiveColor(event.severity)}`,
                    borderRadius: 'var(--radius-sm)',
                    padding: '6px 10px'
                  }}
                >
                  <span style={{ ...label, color: proactiveColor(event.severity), whiteSpace: 'nowrap' }}>S{event.sector}</span>
                  <span style={{ color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.35 }}>{event.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div
          style={{
            background: 'var(--surface-sunken)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-4)',
            minHeight: 240,
            maxHeight: 420,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-4)'
          }}
        >
          {log.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, margin: 'auto', textAlign: 'center' }}>
              {tt(language, 'engineer.empty.ask')}
              <br />
              {tt(language, 'engineer.empty.direct')}
            </div>
          )}
          {log.map((entry) => (
            <div key={entry.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {entry.question && (
                <div
                  style={{
                    alignSelf: 'flex-end',
                    background: 'var(--accent-primary)',
                    color: 'var(--text-on-accent)',
                    borderRadius: '10px 10px 2px 10px',
                    padding: '6px 10px',
                    maxWidth: '85%',
                    fontSize: 13
                  }}
                >
                  {entry.question}
                </div>
              )}
              <div
                style={{
                  alignSelf: 'flex-start',
                  background: 'var(--surface-raised)',
                  border: `1px solid ${entry.kind === 'error' ? 'var(--accent-primary)' : 'var(--border-default)'}`,
                  color: 'var(--text-primary)',
                  borderRadius: '10px 10px 10px 2px',
                  padding: '6px 10px',
                  maxWidth: '85%',
                  fontSize: 13
                }}
              >
                {entry.text}
                {entry.command && (
                  <span style={{ ...label, display: 'block', marginTop: 4, color: 'var(--accent-success)' }}>
                    action · {entry.command.kind}
                  </span>
                )}
              </div>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </section>

      {/* ── Right: status + settings ───────────────────────────────────── */}
      <section style={panel}>
        <div>
          <div style={eyebrow}>Status</div>
          <h2 style={title}>{tt(language, 'engineer.modelRuntime')}</h2>
        </div>

        <div style={settingRow}>
          <span style={label}>{tt(language, 'engineer.modelStatus')}</span>
          <strong style={{ color: toneColor(modelView.tone), fontFamily: '"Rajdhani", sans-serif' }}>{modelView.text}</strong>
        </div>
        {modelView.ratio != null && (
          <div style={{ height: 6, background: 'var(--surface-sunken)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${Math.round(modelView.ratio * 100)}%`, height: '100%', background: 'var(--accent-primary)' }} />
          </div>
        )}

        <div style={settingRow}>
          <span style={label}>Runtime</span>
          <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{status?.runtime.status ?? '—'}</span>
        </div>

        <div>
          <span style={{ ...label, display: 'block', marginBottom: 'var(--space-3)' }}>{tt(language, 'engineer.modelLevel')}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {tierModels.map(({ tier, model }) => {
              // Highlight the SESSION pick (falls back to the persisted default). The
              // Default badge marks config.modelId — the default that survives restart.
              const selected = selectedModelId === model.id
              const isDefault = config.modelId === model.id
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => setSessionModelId(model.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 'var(--space-3)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    background: selected ? 'var(--surface-sunken)' : 'transparent',
                    border: `1px solid ${selected ? 'var(--accent-primary)' : 'var(--border-default)'}`,
                    borderRadius: 'var(--radius-sm)',
                    padding: 'var(--space-3) var(--space-4)'
                  }}
                >
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        color: 'var(--text-primary)',
                        fontFamily: '"Rajdhani", sans-serif',
                        fontWeight: 700,
                        fontSize: 14
                      }}
                    >
                      {tt(language, `engineer.tier.${tier}`)}
                      {isDefault && (
                        <span
                          style={{
                            ...label,
                            color: 'var(--accent-primary)',
                            border: '1px solid var(--accent-primary)',
                            borderRadius: 999,
                            padding: '1px 8px',
                            fontSize: 9
                          }}
                        >
                          {tt(language, 'engineer.default')}
                        </span>
                      )}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11.5, lineHeight: 1.35 }}>
                      {formatModelSize(model.approxBytes)}
                      {tier === 'quality' ? tt(language, 'engineer.tier.qualityHelp') : ''}
                      {model.present ? tt(language, 'engineer.model.installed') : tt(language, 'engineer.model.downloadOnDemand')}
                    </span>
                  </span>
                  <span
                    style={{
                      ...label,
                      flexShrink: 0,
                      color: model.present ? 'var(--accent-success)' : 'var(--text-muted)'
                    }}
                  >
                    {model.present ? tt(language, 'engineer.model.readyBadge') : tt(language, 'engineer.model.downloadBadge')}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <button
          type="button"
          style={{ ...primaryButton, opacity: selectionIsDefault ? 0.6 : 1 }}
          disabled={selectionIsDefault}
          onClick={setSelectedAsDefault}
        >
          {selectionIsDefault ? tt(language, 'engineer.defaultAlready') : tt(language, 'engineer.setDefault')}
        </button>

        {needsDownload && (
          <button
            type="button"
            style={{ ...primaryButton, opacity: downloading ? 0.6 : 1 }}
            disabled={downloading}
            onClick={() => void downloadModel()}
          >
            {downloading
              ? tt(language, 'engineer.model.downloadingShort')
              : tt(language, 'engineer.model.downloadSize', { size: activeModel ? formatModelSize(activeModel.approxBytes) : tt(language, 'engineer.model.generic') })}
          </button>
        )}

        <div style={{ height: 1, background: 'var(--border-default)', margin: '4px 0' }} />
        <div style={eyebrow}>{tt(language, 'engineer.featuresLanguage')}</div>

        <div style={settingRow}>
          <span style={label}>{tt(language, 'engineer.enable')}</span>
          <input type="checkbox" checked={config.enabled} onChange={(event) => void patchConfig({ enabled: event.target.checked })} />
        </div>

        <div style={settingRow}>
          <span style={label}>{tt(language, 'engineer.speakAnswers')}</span>
          <input
            type="checkbox"
            checked={config.speakAnswers}
            onChange={(event) => void patchConfig({ speakAnswers: event.target.checked })}
          />
        </div>

        <div style={settingRow}>
          <span style={label}>{tt(language, 'engineer.proactiveVoice')}</span>
          <input
            type="checkbox"
            checked={config.proactiveCoaching}
            onChange={(event) => void patchConfig({ proactiveCoaching: event.target.checked })}
          />
        </div>

        <div style={settingRow}>
          <span style={label}>{tt(language, 'engineer.assertiveness')}</span>
          <select
            style={{ ...selectStyle, width: 'auto' }}
            value={config.assertiveness}
            onChange={(event) => void patchConfig({ assertiveness: event.target.value as EngineerAssertiveness })}
          >
            <option value="balanced">{tt(language, 'engineer.assertiveness.balanced')}</option>
            <option value="assertive">{tt(language, 'engineer.assertiveness.assertive')}</option>
            <option value="brutal">Brutal</option>
          </select>
        </div>

        <div style={settingRow}>
          <span style={label}>{tt(language, 'engineer.language')}</span>
          <select
            style={{ ...selectStyle, width: 'auto' }}
            value={config.language}
            onChange={(event) => void patchConfig({ language: event.target.value as EngineerLanguage })}
          >
            <option value="pt-BR">Portuguese (BR)</option>
            <option value="en-US">English (US)</option>
          </select>
        </div>

        <div style={settingRow}>
          <span style={label}>Threads (0 = auto)</span>
          <input
            type="number"
            min={0}
            max={8}
            style={{ ...inputStyle, height: 30, width: 76 }}
            value={config.threads}
            onChange={(event) => void patchConfig({ threads: Number(event.target.value) })}
          />
        </div>

        <div style={settingRow}>
          <span style={label}>Idle unload (s)</span>
          <input
            type="number"
            min={15}
            max={1800}
            step={15}
            style={{ ...inputStyle, height: 30, width: 76 }}
            value={Math.round(config.idleUnloadMs / 1000)}
            onChange={(event) => void patchConfig({ idleUnloadMs: Number(event.target.value) * 1000 })}
          />
        </div>

        <div style={settingRow}>
          <span style={label}>Max tokens</span>
          <input
            type="number"
            min={32}
            max={512}
            step={16}
            style={{ ...inputStyle, height: 30, width: 76 }}
            value={config.maxTokens}
            onChange={(event) => void patchConfig({ maxTokens: Number(event.target.value) })}
          />
        </div>

        <p style={{ color: 'var(--text-muted)', fontSize: 11, margin: 0 }}>
          100% local AI (CPU). The model only loads for open-ended questions; direct questions answer immediately.
        </p>
      </section>
      </div>

      {/* ── Quick questions & buttons (push-to-talk + presets) ─────────────────
          Editable canned questions, each firable by click and bindable to a HID
          button. Plus a push-to-talk button. Triggers route through the engineer
          only — they never touch serial / iFlag / revlights. */}
      <section style={{ ...panel, gap: 'var(--space-4)' }}>
        <div>
          <div style={eyebrow}>{tt(language, 'engineer.triggers.eyebrow')}</div>
          <h2 style={title}>Quick questions &amp; buttons</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '4px 0 0' }}>
            Call the engineer from the button box: push-to-talk or preset questions, each bindable to a button.
            Edit, add, or remove them below.
          </p>
        </div>

        {/* Push-to-talk binding */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-3)',
            background: 'var(--surface-sunken)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-3) var(--space-4)'
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <strong style={{ color: 'var(--text-primary)', fontFamily: '"Rajdhani", sans-serif', fontSize: 14 }}>Push-to-talk</strong>
            <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>
              {pushToTalkBinding ? formatBinding(pushToTalkBinding) : 'no button · click 🎙 to dictate'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              style={{
                ...ghostButton,
                borderColor: captureTarget?.kind === 'pushToTalk' ? 'var(--accent-primary)' : 'var(--border-strong)'
              }}
              onClick={() => setCaptureTarget(captureTarget?.kind === 'pushToTalk' ? null : { kind: 'pushToTalk' })}
            >
              {captureTarget?.kind === 'pushToTalk' ? 'Press… (Esc)' : pushToTalkBinding ? 'Change button' : 'Bind button'}
            </button>
            {pushToTalkBinding && (
              <button type="button" style={ghostButton} onClick={() => clearBinding({ kind: 'pushToTalk' })}>
                {tt(language, 'common.clear')}
              </button>
            )}
          </div>
        </div>

        {/* Preset list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {config.presetQuestions.length === 0 && (
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>No preset questions. Add one below.</span>
          )}
          {config.presetQuestions.map((preset) => {
            const binding = config.buttonBindings.presets[preset.id] ?? null
            const capturingThis = captureTarget?.kind === 'preset' && captureTarget.id === preset.id
            return (
              <div
                key={preset.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  background: 'var(--surface-sunken)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 'var(--space-3) var(--space-4)'
                }}
              >
                <button
                  type="button"
                  style={{ ...ghostButton, padding: '0 var(--space-3)', height: 30 }}
                  disabled={busy || !config.enabled}
                  title={tt(language, 'engineer.askNow')}
                  onClick={() => void ask(preset.text)}
                >
                  ▶
                </button>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
                  <input
                    style={{ ...inputStyle, height: 28, fontSize: 12 }}
                    value={presetValue(preset, 'label')}
                    aria-label="Question label"
                    onChange={(event) => editPresetDraft(preset.id, 'label', event.target.value.slice(0, ENGINEER_LIMITS.presetLabelMax))}
                    onBlur={() => commitPresetDraft(preset.id, 'label')}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                    }}
                  />
                  <input
                    style={{ ...inputStyle, height: 28, fontSize: 12 }}
                    value={presetValue(preset, 'text')}
                    aria-label={tt(language, 'engineer.questionText')}
                    onChange={(event) => editPresetDraft(preset.id, 'text', event.target.value.slice(0, ENGINEER_LIMITS.presetTextMax))}
                    onBlur={() => commitPresetDraft(preset.id, 'text')}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                    }}
                  />
                </div>
                <span style={{ ...label, color: binding ? 'var(--accent-success)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {binding ? formatBinding(binding) : 'no button'}
                </span>
                <button
                  type="button"
                  style={{
                    ...ghostButton,
                    borderColor: capturingThis ? 'var(--accent-primary)' : 'var(--border-strong)'
                  }}
                  onClick={() => setCaptureTarget(capturingThis ? null : { kind: 'preset', id: preset.id })}
                >
                  {capturingThis ? 'Press…' : binding ? 'Change' : 'Bind button'}
                </button>
                {binding && (
                  <button type="button" style={ghostButton} onClick={() => clearBinding({ kind: 'preset', id: preset.id })}>
                    {tt(language, 'common.clear')}
                  </button>
                )}
                <button
                  type="button"
                  style={{ ...ghostButton, color: 'var(--accent-danger)', borderColor: 'var(--accent-danger)' }}
                  title={tt(language, 'engineer.removeQuestion')}
                  onClick={() => removePreset(preset.id)}
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>

        {/* Add new preset */}
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            style={{ ...inputStyle, height: 32, fontSize: 12, width: 150 }}
            placeholder="Label (e.g. Tyres)"
            value={draftLabel}
            aria-label="New question label"
            onChange={(event) => setDraftLabel(event.target.value.slice(0, ENGINEER_LIMITS.presetLabelMax))}
          />
          <input
            style={{ ...inputStyle, height: 32, fontSize: 12, flex: 1, minWidth: 180 }}
            placeholder="Question (e.g. how are the tyres?)"
            value={draftText}
            aria-label={tt(language, 'engineer.newQuestionText')}
            onChange={(event) => setDraftText(event.target.value.slice(0, ENGINEER_LIMITS.presetTextMax))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addPreset()
            }}
          />
          <button
            type="button"
            style={{ ...primaryButton, height: 32, opacity: draftText.trim() ? 1 : 0.6 }}
            disabled={!draftText.trim()}
            onClick={addPreset}
          >
            {tt(language, 'common.add')}
          </button>
        </div>
        {captureTarget && (
          <span style={{ color: 'var(--accent-primary)', fontSize: 12 }}>
            Press a button-box button to bind… (Esc to cancel)
          </span>
        )}
      </section>

      {/* ── Voice Spotter / spoken alerts (absorbed from the old Voice Spotter) ── */}
      <section style={{ ...panel, gap: 'var(--space-5)' }}>
        <div>
          <div style={eyebrow}>{tt(language, 'engineer.voice.eyebrow')}</div>
          <h2 style={title}>{tt(language, 'engineer.voice.title')}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '4px 0 0' }}>
            Spoken engineer/spotter telemetry alerts. Unlike Sounds, this screen speaks. Choose voices, tune each alert, and test audio output.
          </p>
        </div>
        <VoiceSpotterSection showToast={showToast} language={language} />
      </section>
    </div>
  )
}
