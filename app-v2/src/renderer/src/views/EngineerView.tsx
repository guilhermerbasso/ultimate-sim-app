import { type CSSProperties, type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppViewProps } from '../App'
import { VoiceSpotterSection } from './VoiceSpotterSection'
import type { ModelDownloadProgress, ModelId, ModelStatus, ModelTier } from '../../../shared/ai'
import { MODEL_TIER_LABELS, MODEL_TIER_ORDER } from '../../../shared/ai'
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
import { seedEngineerBindingPressed, subscribeEngineerListening } from '../lib/engineer-action-runtime'

// AI Race Engineer (text-first). Wraps the local-LLM orchestrator exposed over
// `engineer:` IPC: a status/settings panel + an ask box with a scrollable Q&A log.
// Deterministic intent answers come back instantly (no model); open-ended questions
// lazily load the local model. Answers are spoken via the browser Web Speech API
// (the same engine the Voice Spotter uses) when "falar respostas" is on.
//
// SEAM: push-to-talk + preset-question hardware triggers live in the APP-LEVEL
// `useEngineerActionRuntime` hook (mounted in App.tsx) so they fire on every screen.
// This view owns the Q&A log, the model picker, and the preset/binding EDITOR UI; it
// routes its 🎙 button + bound-button capture through that hook.

const EXAMPLE_CHIPS = [
  'dá pra terminar com esse combustível?',
  'boxes agora?',
  'como tá meu tempo?',
  'como estão os pneus?',
  'qual o gap pra frente?'
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

// Human label for a captured button binding (e.g. "Botão 5").
function formatBinding(binding: EngineerButtonBinding | null): string {
  if (!binding) return 'Sem botão'
  return `Botão ${binding.buttonIndex + 1}`
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

function deriveModelView(status: EngineerStatus | null, progress: ModelDownloadProgress | null): ModelView {
  const active = status?.models.find((m) => m.active) ?? null
  if (progress && progress.phase !== 'done' && progress.phase !== 'error') {
    return { text: `Baixando ${Math.round(progress.ratio * 100)}%`, tone: 'active', ratio: progress.ratio }
  }
  if (progress?.phase === 'error') return { text: 'Falha no download', tone: 'idle', ratio: null }
  const runtime = status?.runtime.status
  if (runtime === 'generating') return { text: 'Gerando resposta…', tone: 'active', ratio: null }
  if (!active?.present) return { text: 'Não baixado', tone: 'idle', ratio: null }
  if (runtime === 'ready') return { text: 'Modelo carregado', tone: 'good', ratio: null }
  if (runtime === 'loading') return { text: 'Carregando…', tone: 'active', ratio: null }
  return { text: 'Modelo pronto', tone: 'good', ratio: null }
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

export default function EngineerView({ showToast }: AppViewProps): ReactElement {
  const [config, setConfig] = useState<EngineerConfig>(DEFAULT_ENGINEER_CONFIG)
  const [status, setStatus] = useState<EngineerStatus | null>(null)
  const [progress, setProgress] = useState<ModelDownloadProgress | null>(null)
  const [log, setLog] = useState<EngineerAnswer[]>([])
  const [proactive, setProactive] = useState<EngineerProactiveEvent[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [downloading, setDownloading] = useState(false)
  // Session-only pick: highlights a model in the picker without persisting it. The
  // PERSISTED default is config.modelId; the "Definir como padrão" button promotes
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

  const modelView = useMemo(() => deriveModelView(status, progress), [status, progress])
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
        showToast(`Falha ao perguntar: ${getErrorMessage(error)}`, 'error')
      } finally {
        setBusy(false)
        void refreshStatus()
      }
    },
    [busy, addAnswer, refreshStatus, showToast]
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
        showToast(`Falha ao salvar: ${getErrorMessage(error)}`, 'error')
      }
    },
    [refreshStatus, showToast]
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
    showToast('Modelo padrão definido', 'success')
  }, [patchConfig, selectedModelId, selectionIsDefault, showToast])

  // ── Preset questions CRUD ───────────────────────────────────────────────────
  const addPreset = useCallback(() => {
    const text = draftText.trim()
    if (!text) return
    const current = configRef.current.presetQuestions
    if (current.length >= ENGINEER_LIMITS.presetQuestionsMax) {
      showToast(`Limite de ${ENGINEER_LIMITS.presetQuestionsMax} perguntas atingido.`, 'info')
      return
    }
    const label = draftLabel.trim() || text.slice(0, ENGINEER_LIMITS.presetLabelMax)
    const next: EngineerPresetQuestion[] = [...current, { id: makePresetId(), label, text }]
    setDraftLabel('')
    setDraftText('')
    void patchConfig({ presetQuestions: next })
  }, [draftLabel, draftText, patchConfig, showToast])

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
      if (!result?.ok) showToast(`Download falhou: ${result?.error ?? 'erro desconhecido'}`, 'error')
      else showToast('Modelo pronto.', 'success')
    } catch (error) {
      showToast(`Download falhou: ${getErrorMessage(error)}`, 'error')
    } finally {
      setDownloading(false)
      void refreshStatus()
    }
  }, [refreshStatus, showToast])

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
          <div style={eyebrow}>Engenheiro IA · local</div>
          <h2 style={title}>Pergunte ao engenheiro</h2>
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
            O engenheiro está desligado. Ative em “Habilitar engenheiro” no painel ao lado.
          </div>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <input
            ref={inputRef}
            style={inputStyle}
            placeholder="Ex.: dá pra terminar com esse combustível?"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void ask(input)
            }}
            aria-label="Pergunta para o engenheiro"
          />
          <button
            type="button"
            style={{ ...primaryButton, opacity: busy || !input.trim() ? 0.6 : 1 }}
            disabled={busy || !input.trim()}
            onClick={() => void ask(input)}
          >
            {busy ? 'Pensando…' : 'Perguntar'}
          </button>
          {busy && (
            <button type="button" style={ghostButton} onClick={cancel}>
              Parar
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
            title={pushToTalkBinding ? `Push-to-talk · ${formatBinding(pushToTalkBinding)}` : 'Push-to-talk (clique ou ligue um botão)'}
            aria-label="Push-to-talk"
          >
            {listening ? '● ouvindo' : '🎙'}
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {EXAMPLE_CHIPS.map((chip) => (
            <button key={chip} type="button" style={chipButton} disabled={busy} onClick={() => void ask(chip)}>
              {chip}
            </button>
          ))}
        </div>

        {/* ── Proactive per-sector call-outs feed (newest first) ───────────── */}
        {proactive.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={eyebrow}>Rádio · coaching proativo</div>
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
              Faça uma pergunta ou toque num exemplo acima.
              <br />
              Respostas diretas (combustível, pneus, gaps) vêm na hora, sem carregar o modelo.
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
                    ação · {entry.command.kind}
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
          <h2 style={title}>Modelo & runtime</h2>
        </div>

        <div style={settingRow}>
          <span style={label}>Estado do modelo</span>
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
          <span style={{ ...label, display: 'block', marginBottom: 'var(--space-3)' }}>Nível do modelo</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {tierModels.map(({ tier, model }) => {
              // Highlight the SESSION pick (falls back to the persisted default). The
              // "Padrão" badge marks config.modelId — the default that survives restart.
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
                      {MODEL_TIER_LABELS[tier]}
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
                          Padrão
                        </span>
                      )}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11.5, lineHeight: 1.35 }}>
                      {formatModelSize(model.approxBytes)}
                      {tier === 'quality' ? ' · para PCs mais fortes' : ''}
                      {model.present ? ' · instalado' : ' · baixar sob demanda'}
                    </span>
                  </span>
                  <span
                    style={{
                      ...label,
                      flexShrink: 0,
                      color: model.present ? 'var(--accent-success)' : 'var(--text-muted)'
                    }}
                  >
                    {model.present ? '● pronto' : '○ baixar'}
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
          {selectionIsDefault ? 'Modelo selecionado já é o padrão' : 'Definir modelo selecionado como padrão'}
        </button>

        {needsDownload && (
          <button
            type="button"
            style={{ ...primaryButton, opacity: downloading ? 0.6 : 1 }}
            disabled={downloading}
            onClick={() => void downloadModel()}
          >
            {downloading
              ? 'Baixando…'
              : `Baixar ${activeModel ? formatModelSize(activeModel.approxBytes) : 'modelo'}`}
          </button>
        )}

        <div style={{ height: 1, background: 'var(--border-default)', margin: '4px 0' }} />
        <div style={eyebrow}>Recursos & idioma</div>

        <div style={settingRow}>
          <span style={label}>Habilitar engenheiro</span>
          <input type="checkbox" checked={config.enabled} onChange={(event) => void patchConfig({ enabled: event.target.checked })} />
        </div>

        <div style={settingRow}>
          <span style={label}>Falar respostas (TTS)</span>
          <input
            type="checkbox"
            checked={config.speakAnswers}
            onChange={(event) => void patchConfig({ speakAnswers: event.target.checked })}
          />
        </div>

        <div style={settingRow}>
          <span style={label}>Coaching proativo por voz</span>
          <input
            type="checkbox"
            checked={config.proactiveCoaching}
            onChange={(event) => void patchConfig({ proactiveCoaching: event.target.checked })}
          />
        </div>

        <div style={settingRow}>
          <span style={label}>Postura do engenheiro</span>
          <select
            style={{ ...selectStyle, width: 'auto' }}
            value={config.assertiveness}
            onChange={(event) => void patchConfig({ assertiveness: event.target.value as EngineerAssertiveness })}
          >
            <option value="balanced">Equilibrado</option>
            <option value="assertive">Assertivo</option>
            <option value="brutal">Brutal</option>
          </select>
        </div>

        <div style={settingRow}>
          <span style={label}>Idioma</span>
          <select
            style={{ ...selectStyle, width: 'auto' }}
            value={config.language}
            onChange={(event) => void patchConfig({ language: event.target.value as EngineerLanguage })}
          >
            <option value="pt-BR">Português (BR)</option>
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
          <span style={label}>Máx. tokens</span>
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
          IA 100% local (CPU). O modelo só carrega quando você faz uma pergunta aberta; perguntas diretas são respondidas na hora.
        </p>
      </section>
      </div>

      {/* ── Perguntas rápidas & botões (push-to-talk + presets) ─────────────────
          Editable canned questions, each firable by click and bindable to a HID
          button. Plus a push-to-talk button. Triggers route through the engineer
          only — they never touch serial / iFlag / revlights. */}
      <section style={{ ...panel, gap: 'var(--space-4)' }}>
        <div>
          <div style={eyebrow}>Q&amp;A · gatilhos</div>
          <h2 style={title}>Perguntas rápidas &amp; botões</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '4px 0 0' }}>
            Chame o engenheiro por botão da button box: push-to-talk (ouvir e perguntar) ou perguntas prontas,
            cada uma ligável a um botão. Edite, adicione ou remova abaixo.
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
              {pushToTalkBinding ? formatBinding(pushToTalkBinding) : 'sem botão · clique no 🎙 para ditar'}
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
              {captureTarget?.kind === 'pushToTalk' ? 'Pressione… (Esc)' : pushToTalkBinding ? 'Trocar botão' : 'Ligar botão'}
            </button>
            {pushToTalkBinding && (
              <button type="button" style={ghostButton} onClick={() => clearBinding({ kind: 'pushToTalk' })}>
                Limpar
              </button>
            )}
          </div>
        </div>

        {/* Preset list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {config.presetQuestions.length === 0 && (
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Nenhuma pergunta pronta. Adicione uma abaixo.</span>
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
                  title="Perguntar agora"
                  onClick={() => void ask(preset.text)}
                >
                  ▶
                </button>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
                  <input
                    style={{ ...inputStyle, height: 28, fontSize: 12 }}
                    value={presetValue(preset, 'label')}
                    aria-label="Rótulo da pergunta"
                    onChange={(event) => editPresetDraft(preset.id, 'label', event.target.value.slice(0, ENGINEER_LIMITS.presetLabelMax))}
                    onBlur={() => commitPresetDraft(preset.id, 'label')}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                    }}
                  />
                  <input
                    style={{ ...inputStyle, height: 28, fontSize: 12 }}
                    value={presetValue(preset, 'text')}
                    aria-label="Texto da pergunta"
                    onChange={(event) => editPresetDraft(preset.id, 'text', event.target.value.slice(0, ENGINEER_LIMITS.presetTextMax))}
                    onBlur={() => commitPresetDraft(preset.id, 'text')}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                    }}
                  />
                </div>
                <span style={{ ...label, color: binding ? 'var(--accent-success)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {binding ? formatBinding(binding) : 'sem botão'}
                </span>
                <button
                  type="button"
                  style={{
                    ...ghostButton,
                    borderColor: capturingThis ? 'var(--accent-primary)' : 'var(--border-strong)'
                  }}
                  onClick={() => setCaptureTarget(capturingThis ? null : { kind: 'preset', id: preset.id })}
                >
                  {capturingThis ? 'Pressione…' : binding ? 'Trocar' : 'Ligar botão'}
                </button>
                {binding && (
                  <button type="button" style={ghostButton} onClick={() => clearBinding({ kind: 'preset', id: preset.id })}>
                    Limpar
                  </button>
                )}
                <button
                  type="button"
                  style={{ ...ghostButton, color: 'var(--accent-danger)', borderColor: 'var(--accent-danger)' }}
                  title="Remover pergunta"
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
            placeholder="Rótulo (ex.: Pneus)"
            value={draftLabel}
            aria-label="Rótulo da nova pergunta"
            onChange={(event) => setDraftLabel(event.target.value.slice(0, ENGINEER_LIMITS.presetLabelMax))}
          />
          <input
            style={{ ...inputStyle, height: 32, fontSize: 12, flex: 1, minWidth: 180 }}
            placeholder="Pergunta (ex.: como estão os pneus?)"
            value={draftText}
            aria-label="Texto da nova pergunta"
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
            Adicionar
          </button>
        </div>
        {captureTarget && (
          <span style={{ color: 'var(--accent-primary)', fontSize: 12 }}>
            Pressione um botão da button box para ligar… (Esc para cancelar)
          </span>
        )}
      </section>

      {/* ── Voice Spotter / Avisos falados (absorvido do antigo Voice Spotter) ──
          O Engenheiro IA é o hub único de VOZ. A engine fala bandeiras, combustível,
          pit, proximidade, incidentes e voltas a partir da telemetria ao vivo.
          As configurações de postura/proativo/falar respostas estão no painel acima. */}
      <section style={{ ...panel, gap: 'var(--space-5)' }}>
        <div>
          <div style={eyebrow}>Voz · spotter</div>
          <h2 style={title}>Voice Spotter / Avisos falados</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '4px 0 0' }}>
            Avisos falados de engenheiro/spotter por telemetria. Diferente de Sounds (que só bipa),
            aqui o app fala. Escolha vozes, ative/ajuste cada aviso e teste a saída de áudio.
          </p>
        </div>
        <VoiceSpotterSection showToast={showToast} />
      </section>
    </div>
  )
}
