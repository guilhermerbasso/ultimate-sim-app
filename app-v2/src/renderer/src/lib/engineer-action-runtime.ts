import { useEffect, useRef } from 'react'
import {
  DEFAULT_ENGINEER_CONFIG,
  ENGINEER_CHANNELS,
  type EngineerActionDirective,
  type EngineerButtonBinding,
  type EngineerConfig,
  type EngineerStatus,
  listEngineerActions
} from '../../../shared/engineer-ipc'
import { readButtonPressed } from './gamepad'
import { isActionRuntimeSuppressed, type ActionRuntimeToast } from './action-runtime'

// ─── App-level AI Engineer action runtime ─────────────────────────────────────
//
// Mounted ONCE in App.tsx (next to useGlobalActionRuntime) so engineer hardware
// triggers — push-to-talk + preset questions bound to button-box buttons — fire on
// EVERY screen, even when the Engineer view is unmounted (the actual racing case).
//
// Flow: gamepad poll (here) → `engineer:invokeAction` (main resolves against the
// persisted config) → `engineer:action` broadcast → executed here (push-to-talk
// speech / askPreset). This is PURELY ADDITIVE: it only ever calls `engineer:ask`
// and the browser Web Speech API — it never touches serial / iFlag / revlights.

// ─── Push-to-talk speech recognition (browser Web Speech API) ──────────────────
//
// Minimal structural typing so we don't depend on the optional lib.dom
// SpeechRecognition definitions. Push-to-talk LISTENS once and feeds the transcript
// straight to `engineer:ask` (main broadcasts the answer → TTS + the in-view log).

interface SpeechRecognitionAlternativeLike {
  transcript: string
}
interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>
}
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

// ─── Listening indicator store ────────────────────────────────────────────────
// The hook owns the SOLE SpeechRecognition session; the Engineer view subscribes to
// this so its 🎙 button can still show "● ouvindo" without duplicating the mic.
let listeningState = false
const listeningSubs = new Set<(listening: boolean) => void>()

function setListeningState(value: boolean): void {
  if (listeningState === value) return
  listeningState = value
  for (const fn of listeningSubs) fn(value)
}

/** Subscribe to push-to-talk listening state. Fires immediately with the current value. */
export function subscribeEngineerListening(fn: (listening: boolean) => void): () => void {
  listeningSubs.add(fn)
  fn(listeningState)
  return () => {
    listeningSubs.delete(fn)
  }
}

// ─── Capture handoff (avoid an immediate re-fire of a just-bound, still-held button) ─
// Keys flagged here are seeded as "pressed" on their next observation so the bound
// button must be physically RELEASED before it can fire — closing the race where a
// binding lands while its button is still held during capture.
const seedPressedKeys = new Set<string>()

function actionStateKey(actionId: string, binding: EngineerButtonBinding): string {
  return `${actionId}:${binding.gamepadIndex ?? 'any'}:${binding.buttonIndex}`
}

/** Mark a freshly-captured binding so it requires a release before its first fire. */
export function seedEngineerBindingPressed(actionId: string, binding: EngineerButtonBinding): void {
  seedPressedKeys.add(actionStateKey(actionId, binding))
}

/**
 * Always-on engineer action runtime. Mount once at the app root. Polls bound HID
 * buttons and routes triggers through the engineer only — never serial/iFlag/revlights.
 */
export function useEngineerActionRuntime(showToast?: ActionRuntimeToast): void {
  const showToastRef = useRef<ActionRuntimeToast | undefined>(showToast)
  showToastRef.current = showToast
  const configRef = useRef<EngineerConfig>(DEFAULT_ENGINEER_CONFIG)

  useEffect(() => {
    let frame = 0
    let recognition: SpeechRecognitionLike | null = null
    const pressedState = new Map<string, boolean>()

    // Read the engineer config (bindings + presets) and keep it fresh. The poll only
    // needs to know WHICH buttons map to engineer actions; the authoritative resolve
    // happens in main (engineer:invokeAction → engineer:action).
    const loadConfig = async (): Promise<void> => {
      try {
        const status = await window.ipc.invoke<EngineerStatus>(ENGINEER_CHANNELS.getStatus)
        if (status?.config) configRef.current = status.config
      } catch {
        // keep the last known config
      }
    }
    void loadConfig()
    const unsubStatus = window.ipc.subscribe<EngineerStatus>(ENGINEER_CHANNELS.statusEvent, (s) => {
      if (s?.config) configRef.current = s.config
    })

    // Push-to-talk: LISTEN once (Web Speech) and feed the transcript to engineer:ask.
    // A second trigger while listening stops it (toggle). Never throws.
    const startPushToTalk = (): void => {
      if (recognition) {
        try {
          recognition.stop()
        } catch {
          /* ignore */
        }
        return
      }
      const Ctor = getSpeechRecognitionCtor()
      if (!Ctor) {
        showToastRef.current?.('Push-to-talk: ditado por voz indisponível neste sistema — digite a pergunta no AI Engineer.', 'info')
        return
      }
      let rec: SpeechRecognitionLike
      try {
        rec = new Ctor()
      } catch {
        return
      }
      rec.lang = configRef.current.language
      rec.continuous = false
      rec.interimResults = false
      rec.maxAlternatives = 1
      rec.onresult = (event) => {
        const transcript = event.results?.[0]?.[0]?.transcript?.trim() ?? ''
        if (transcript) void window.ipc.invoke(ENGINEER_CHANNELS.ask, transcript).catch(() => undefined)
      }
      const finish = (): void => {
        // Only tear down if THIS recognition is still the active one — guards a
        // same-tick onerror→onend race from nulling a newer session.
        if (recognition !== rec) return
        recognition = null
        setListeningState(false)
      }
      rec.onerror = finish
      rec.onend = finish
      recognition = rec
      setListeningState(true)
      try {
        rec.start()
      } catch {
        finish()
      }
    }

    // Execute an engineer action directive (resolved in main from a hardware button).
    const execute = (directive: EngineerActionDirective): void => {
      if (!directive) return
      if (directive.kind === 'pushToTalk') {
        startPushToTalk()
        return
      }
      if (directive.kind === 'askPreset' && directive.text) {
        void window.ipc.invoke(ENGINEER_CHANNELS.ask, directive.text).catch(() => undefined)
      }
    }
    const unsubAction = window.ipc.subscribe<EngineerActionDirective>(ENGINEER_CHANNELS.action, execute)

    const fire = (actionId: string): void => {
      void window.ipc.invoke(ENGINEER_CHANNELS.invokeAction, { actionId }).catch(() => undefined)
    }

    // Read-only gamepad poll. Honors the GLOBAL suppression flag so binding-capture in
    // the Engineer view never double-fires a mapping mid-capture.
    const tick = (): void => {
      const suppressed = isActionRuntimeSuppressed()
      for (const action of listEngineerActions(configRef.current)) {
        const binding = action.binding
        if (!binding) continue
        const key = actionStateKey(action.id, binding)
        if (seedPressedKeys.has(key)) {
          // Just bound: require a physical release before the first fire.
          seedPressedKeys.delete(key)
          pressedState.set(key, true)
        }
        const pressed = readButtonPressed(binding.gamepadIndex, binding.buttonIndex, binding.gamepadId)
        const wasPressed = pressedState.get(key) ?? false
        pressedState.set(key, pressed)
        if (pressed && !wasPressed && !suppressed) fire(action.id)
      }
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)

    return () => {
      window.cancelAnimationFrame(frame)
      unsubAction()
      unsubStatus()
      try {
        recognition?.abort()
      } catch {
        /* ignore */
      }
      recognition = null
    }
  }, [])
}
