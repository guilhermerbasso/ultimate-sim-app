// Global TTS runtime — renderer helper (the SINGLE seam any view/feature calls to speak).
//
// `speakViaTts(text, { lang?, voiceId? })` is the one function the rest of the renderer
// (EngineerView, the proactive engineer, settings previews…) uses to speak:
//   1. asks the main process to synthesize the text with the neural Piper engine
//      (TTS_CHANNELS.synth → WAV bytes), then plays the WAV through an HTMLAudioElement
//      at the configured rate (audio.playbackRate, exactly like the spotter); and
//   2. transparently FALLS BACK to OS Web Speech (`speechSynthesis`) whenever the
//      Piper engine/voice is unavailable (synth → null), TTS is set to web-speech, or
//      anything fails — preserving the behaviour EngineerView uses today.
//
// IMPORTANT (architecture): this is an ON-DEMAND, CPU-only path that NEVER auto-
// downloads a voice. If the chosen voice isn't installed, synth returns null and we
// fall back to Web Speech. Voices are downloaded ONLY by an explicit user action in
// VoiceSettingsView (ensurePiperVoice). Config (engine/voiceId/rate) lives in the
// renderer (localStorage) so this seam needs no extra main-process module.
//
// `useTtsRuntime()` is mounted ONCE globally (e.g. in App.tsx): it warms the config
// cache and tears down audio on unmount. Renders nothing. Because `speakViaTts` is a
// free function, code running WITHOUT a view open can still speak.

import { useEffect } from 'react'
import {
  TTS_CHANNELS,
  isValidPiperVoiceId,
  pickDistinctOsVoice,
  fallbackVoiceProsody,
  piperVoiceLang,
  type EnsureVoiceResult,
  type PiperVoiceInfo,
  type PiperVoiceProgress
} from '../../../shared/spotter'
import {
  defaultPiperVoiceIdForLanguage,
  resolvePiperVoice
} from '../../../shared/tts-voice'
import { logClient } from './log-client'
import { REPLAY_SPEECH_CANCEL_CHANNELS, type ReplaySpeechCancelEvent } from '../../../shared/replay'
import {
  cancelOwnedWebSpeech,
  cancelSpeechOwner,
  claimOwnedWebSpeech,
  createSpeechOwnerCancellationSignal,
  isSpeechOwnerTokenCurrent,
  registerSpeechOwnerCanceller,
  speechOwnerToken,
  type SpeechOwnerCancellationSignal,
  type SpeechOwner
} from './speech-owner-runtime'

// ─── Renderer-local config (PURE helpers — unit-tested in node) ──────────────────

export type TtsEngine = 'piper' | 'webspeech'

export interface TtsPref {
  engine: TtsEngine
  /** Default Piper voice the engineer speaks with. */
  voiceId: string
  /** Playback rate 0.5..2.0 (applied via audio.playbackRate / utterance.rate). */
  rate: number
}

export const DEFAULT_TTS_VOICE_ID = defaultPiperVoiceIdForLanguage('en-US')

export const DEFAULT_TTS_PREF: TtsPref = {
  engine: 'piper',
  voiceId: DEFAULT_TTS_VOICE_ID,
  rate: 1
}

const RATE_MIN = 0.5
const RATE_MAX = 2.0

export function clampTtsRate(rate: unknown): number {
  const n = typeof rate === 'number' && Number.isFinite(rate) ? rate : DEFAULT_TTS_PREF.rate
  return Math.min(RATE_MAX, Math.max(RATE_MIN, n))
}

/** Coerce arbitrary/partial input into a valid TtsPref (validates voice id + clamps rate). */
export function mergeTtsPref(partial: Partial<TtsPref> | null | undefined): TtsPref {
  const p = partial ?? {}
  const engine: TtsEngine = p.engine === 'webspeech' ? 'webspeech' : 'piper'
  const voiceId =
    typeof p.voiceId === 'string' && isValidPiperVoiceId(p.voiceId) ? p.voiceId : DEFAULT_TTS_PREF.voiceId
  return { engine, voiceId, rate: clampTtsRate(p.rate) }
}

const PREF_STORAGE_KEY = 'tts.pref.v1'
// One-time migration marker: pre-fix builds defaulted the engine to OS Web Speech,
// so existing users carry `engine:'webspeech'` even though neural Piper works. We
// coerce that legacy value to 'piper' ONCE so they get the neural primary path; a
// user can still manually re-select OS afterwards (that choice persists).
const PREF_MIGRATED_KEY = 'tts.pref.migrated.v2'

let cachedPref: TtsPref | null = null
const prefListeners = new Set<(pref: TtsPref) => void>()

function readPrefFromStorage(): TtsPref {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return { ...DEFAULT_TTS_PREF }
  try {
    const raw = window.localStorage.getItem(PREF_STORAGE_KEY)
    const pref = mergeTtsPref(raw ? (JSON.parse(raw) as Partial<TtsPref>) : null)
    // Legacy 'webspeech' default → neural Piper (one-time, before first read returns).
    const migrated = window.localStorage.getItem(PREF_MIGRATED_KEY) === '1'
    if (!migrated) {
      try {
        window.localStorage.setItem(PREF_MIGRATED_KEY, '1')
      } catch {
        // marker write failed — at worst we re-run the harmless coercion next launch
      }
      if (pref.engine === 'webspeech') {
        const next: TtsPref = { ...pref, engine: 'piper' }
        try {
          window.localStorage.setItem(PREF_STORAGE_KEY, JSON.stringify(next))
        } catch {
          // storage unavailable — keep the in-memory neural value anyway
        }
        logClient.info('tts', 'migrated legacy webspeech pref to piper', { from: 'webspeech', to: 'piper' })
        return next
      }
    }
    return pref
  } catch {
    return { ...DEFAULT_TTS_PREF }
  }
}

/** Current TTS preference (cached; reads localStorage on first use). */
export function getTtsPref(): TtsPref {
  if (!cachedPref) cachedPref = readPrefFromStorage()
  return cachedPref
}

/** Merge + persist a preference change; notifies subscribers. Returns the new pref. */
export function setTtsPref(partial: Partial<TtsPref>): TtsPref {
  const next = mergeTtsPref({ ...getTtsPref(), ...partial })
  cachedPref = next
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      window.localStorage.setItem(PREF_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // storage full / unavailable — keep the in-memory value
    }
  }
  prefListeners.forEach((cb) => {
    try {
      cb(next)
    } catch {
      // a bad listener must never break a setter
    }
  })
  return next
}

/** Subscribe to preference changes (settings view live-update). Returns an unsubscribe. */
export function subscribeTtsPref(cb: (pref: TtsPref) => void): () => void {
  prefListeners.add(cb)
  return () => {
    prefListeners.delete(cb)
  }
}

// ─── Text chunking (PURE — long answers start speaking sooner) ───────────────────

export const TTS_CHUNK_MAX_CHARS = 240

/** Split text into <=max-char chunks on sentence/clause boundaries (hard-split only as a last resort). */
export function chunkText(text: string, max = TTS_CHUNK_MAX_CHARS): string[] {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) return []
  if (clean.length <= max) return [clean]

  const pieces = clean.match(/[^.!?…]+[.!?…]+|\s*[^.!?…]+$/g) ?? [clean]
  const chunks: string[] = []
  let buf = ''
  const push = (): void => {
    const t = buf.trim()
    if (t) chunks.push(t)
    buf = ''
  }
  for (const sentenceRaw of pieces) {
    const sentence = sentenceRaw.trim()
    if (!sentence) continue
    if (sentence.length > max) {
      push()
      for (let i = 0; i < sentence.length; i += max) chunks.push(sentence.slice(i, i + max))
      continue
    }
    if ((buf ? buf.length + 1 : 0) + sentence.length > max) push()
    buf = buf ? `${buf} ${sentence}` : sentence
  }
  push()
  return chunks
}

// ─── Module state (one shared audio channel — latest callout wins) ───────────────

let currentAudio: HTMLAudioElement | null = null
let currentObjectUrl: string | null = null
// Shared Web Audio graph: HTMLAudioElement rejects the sherpa WAV blob in the Electron
// renderer (onerror) → engineer went silent. AudioContext.decodeAudioData plays it
// reliably (same API already used by soundshift/spotter3d). One source plays at a time.
let audioCtx: AudioContext | null = null
let currentSource: AudioBufferSourceNode | null = null
// Bumped on every new speak/stop; an in-flight call whose seq is stale aborts so a
// newer callout immediately supersedes an older one (barge-in, like a real spotter).
let speakSeq = 0
let speakingCount = 0
let currentOwner: SpeechOwner | null = null
interface ActiveTtsCallCancellation {
  owner: SpeechOwner
  ownerToken: number
  signal: SpeechOwnerCancellationSignal
}
let activeCallCancellation: ActiveTtsCallCancellation | null = null
// Other speech channels (the Voice Spotter — spotter-runtime) register here so the
// wake-word self-listen guard suppresses mic capture while THEY speak too. Without
// this, `isTtsSpeaking()` only reflected THIS module's `speakingCount`, so the mic
// stayed open while the spotter spoke and transcribed its own callouts (M4).
let externalSpeakingCount = 0

/**
 * Register/unregister an EXTERNAL speech channel (e.g. the Voice Spotter) as a
 * contributor to the shared "is something speaking" signal. Balanced +1/-1: pass
 * `true` when a line STARTS playing and `false` when it ENDS/errors/cancels. Calls
 * are floored at 0 so an unbalanced extra `false` can never make the count negative.
 */
export function notifyExternalSpeaking(active: boolean): void {
  if (active) externalSpeakingCount += 1
  else externalSpeakingCount = Math.max(0, externalSpeakingCount - 1)
}

/** Current external speaking depth (spotter etc.). Exposed for diagnostics/tests. */
export function externalSpeakingDepth(): number {
  return externalSpeakingCount
}

/** True while a line is being synthesized/played by THIS module OR any external
 *  channel (the Voice Spotter). Used by the wake-word engine to skip mic capture so
 *  neither the engineer's own TTS nor the spotter's callouts are transcribed. */
export function isTtsSpeaking(): boolean {
  return speakingCount > 0 || externalSpeakingCount > 0
}

type OwnerStageResult<T> = { cancelled: true } | { cancelled: false; value: T }

function raceOwnerStage<T>(
  stage: Promise<T>,
  signal: SpeechOwnerCancellationSignal
): Promise<OwnerStageResult<T>> {
  if (signal.isCancelled()) return Promise.resolve({ cancelled: true })
  return Promise.race([
    stage.then((value): OwnerStageResult<T> => ({ cancelled: false, value })),
    signal.promise.then((): OwnerStageResult<T> => ({ cancelled: true }))
  ])
}

// ─── Web Speech (fallback) ───────────────────────────────────────────────────────

export function isWebSpeechAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.speechSynthesis !== 'undefined' &&
    typeof SpeechSynthesisUtterance !== 'undefined'
  )
}

// Resolves once the async OS voice list is populated (or after a short grace
// period), so the first fallback utterance can honor a DISTINCT voice instead of
// collapsing to the engine default.
function ensureWebVoices(timeoutMs = 400): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!isWebSpeechAvailable() || window.speechSynthesis.getVoices().length > 0) {
      resolve()
      return
    }
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      try {
        window.speechSynthesis.removeEventListener('voiceschanged', finish)
      } catch {
        // ignore
      }
      resolve()
    }
    try {
      window.speechSynthesis.addEventListener('voiceschanged', finish)
    } catch {
      // ignore
    }
    setTimeout(finish, timeoutMs)
  })
}

async function webSpeechSpeak(
  text: string,
  lang: string | undefined,
  rate: number,
  seq: number,
  owner: SpeechOwner,
  ownerToken: number,
  signal: SpeechOwnerCancellationSignal,
  seedVoiceId?: string
): Promise<void> {
  if (!isWebSpeechAvailable() || !text || seq !== speakSeq || !isSpeechOwnerTokenCurrent(owner, ownerToken)) return
  // Warm the async OS voice list before picking so the FIRST utterance honors a
  // distinct voice rather than collapsing to the engine default.
  if (seedVoiceId && window.speechSynthesis.getVoices().length === 0) {
    const voicesReady = await raceOwnerStage(ensureWebVoices(), signal)
    if (voicesReady.cancelled) return
  }
  if (seq !== speakSeq || !isSpeechOwnerTokenCurrent(owner, ownerToken)) return
  let finish = (): void => undefined
  const playback = new Promise<void>((resolve) => {
    let release: () => void = () => undefined
    try {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = rate
      if (lang) {
        utterance.lang = lang
        const voices = window.speechSynthesis.getVoices()
        // A neural seed → DISTINCT same-language OS voice (deterministic per id) so
        // different requested voices don't all collapse to the one language default.
        const seedLang = seedVoiceId ? piperVoiceLang(seedVoiceId) : null
        const distinct = seedLang ? pickDistinctOsVoice(seedVoiceId as string, voices, seedLang) : null
        const prefix = lang.slice(0, 2).toLowerCase()
        const voice = distinct ?? voices.find((v) => (v.lang ?? '').toLowerCase().startsWith(prefix))
        if (voice) utterance.voice = voice
      }
      // Single-OS-voice languages collapse distinct voices to one; nudge pitch/rate
      // per voice id so different voices stay audibly distinct on the fallback.
      if (seedVoiceId) {
        const prosody = fallbackVoiceProsody(seedVoiceId)
        utterance.pitch = prosody.pitch
        utterance.rate = rate * prosody.rate
      }
      let settled = false
      const done = (): void => {
        if (settled) return
        settled = true
        release()
        resolve()
      }
      finish = done
      utterance.onend = done
      utterance.onerror = done
      release = claimOwnedWebSpeech(owner, () => window.speechSynthesis.cancel())
      window.speechSynthesis.speak(utterance)
    } catch {
      release()
      resolve()
    }
  })
  const result = await raceOwnerStage(playback, signal)
  if (result.cancelled) finish()
}

// ─── WAV playback ─────────────────────────────────────────────────────────────────

function disposeCurrentAudio(): void {
  if (currentSource) {
    try {
      // Keep onended so stop() resolves the in-flight playWav promise → the speak
      // loop sees the stale seq and its finally decrements speakingCount (no leak).
      currentSource.stop()
    } catch {
      // already stopped
    }
    try {
      currentSource.disconnect()
    } catch {
      // ignore
    }
    currentSource = null
  }
  if (currentAudio) {
    currentAudio.onended = null
    currentAudio.onerror = null
    try {
      currentAudio.pause()
    } catch {
      // already stopped
    }
    currentAudio = null
  }
  if (currentObjectUrl) {
    try {
      URL.revokeObjectURL(currentObjectUrl)
    } catch {
      // ignore
    }
    currentObjectUrl = null
  }
}

// Copy bytes into a fresh ArrayBuffer so decode owns contiguous memory.
function toAudioBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

function ensureAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!audioCtx) audioCtx = new Ctor()
  return audioCtx
}

function disposeAudioCtx(): void {
  const ctx = audioCtx
  audioCtx = null
  if (ctx) void ctx.close().catch(() => undefined)
}

// Play a neural WAV via Web Audio. Resolves TRUE on successful end, FALSE on
// decode/play failure so the caller can fall back to web-speech (never go silent).
async function playWav(
  bytes: Uint8Array,
  rate: number,
  seq: number,
  owner: SpeechOwner,
  ownerToken: number,
  signal: SpeechOwnerCancellationSignal
): Promise<boolean> {
  const isCurrent = (): boolean => seq === speakSeq && isSpeechOwnerTokenCurrent(owner, ownerToken)
  if (!isCurrent() || bytes.byteLength === 0) return true
  const ctx = ensureAudioCtx()
  if (!ctx) return false
  let audioBuffer: AudioBuffer
  try {
    if (ctx.state === 'suspended') {
      const resumed = await raceOwnerStage(ctx.resume(), signal)
      if (resumed.cancelled) return true
    }
    if (!isCurrent()) return true
    const decoded = await raceOwnerStage(ctx.decodeAudioData(toAudioBuffer(bytes)), signal)
    if (decoded.cancelled) return true
    audioBuffer = decoded.value
  } catch {
    if (!isCurrent()) return true
    logClient.warn('tts', 'playWav decode failed', { bytes: bytes.byteLength, rate })
    return false
  }
  if (!isCurrent()) return true
  const playback = new Promise<boolean>((resolve) => {
    try {
      const source = ctx.createBufferSource()
      source.buffer = audioBuffer
      source.playbackRate.value = Math.max(0.25, Math.min(4, rate))
      source.connect(ctx.destination)
      currentSource = source
      source.onended = () => {
        if (currentSource === source) currentSource = null
        resolve(true)
      }
      source.start()
    } catch {
      logClient.warn('tts', 'playWav start failed', { bytes: bytes.byteLength, rate })
      resolve(false)
    }
  })
  const result = await raceOwnerStage(playback, signal)
  return result.cancelled ? true : result.value
}

// ─── Synthesis IPC ───────────────────────────────────────────────────────────────

async function synthesize(text: string, voiceId: string, rate: number): Promise<Uint8Array | null> {
  try {
    return await window.ipc.invoke<Uint8Array | null>(TTS_CHANNELS.synth, text, voiceId, rate)
  } catch {
    return null
  }
}

function stopTtsPlaybackOwner(owner: SpeechOwner): void {
  cancelOwnedWebSpeech(owner)
  if (currentOwner !== owner) return
  speakSeq += 1
  disposeCurrentAudio()
  currentOwner = null
}

export function stopTtsOwner(owner: Extract<SpeechOwner, 'coach' | 'engineer'>): void {
  cancelSpeechOwner(owner)
  stopTtsPlaybackOwner(owner)
}

/** Stop coach and engineer speech during renderer teardown. */
export function stopTts(): void {
  stopTtsOwner('coach')
  stopTtsOwner('engineer')
}

export interface SpeakOptions {
  /** Language for the OS Web Speech FALLBACK voice. Defaults to the voice's own language. */
  lang?: string
  /** Override the Piper voice for THIS call (e.g. a settings "Testar voz" preview). */
  voiceId?: string
  /** Which subsystem requested the speech (coach / engineer / spotter) — for observability. */
  source?: string
  /** Originating tip/event id — so a spoken line can be traced back to its finding. */
  tipId?: string
  /** 1-based corner number the line is about, when corner-scoped. */
  corner?: number
}

/**
 * THE seam: speak `text` via the neural Piper engine, falling back to OS Web Speech.
 * Resolves once playback finishes (or is superseded by a newer call). Never throws.
 *
 * Agent D / EngineerView swap their current `speak()` for:  `speakViaTts(text, { lang: 'pt-BR' })`.
 */
export async function speakViaTts(text: string, options: SpeakOptions = {}): Promise<void> {
  const content = (text ?? '').trim()
  if (!content) return

  const pref = getTtsPref()
  const resolvedVoice = resolvePiperVoice(options.lang, options.voiceId ?? pref.voiceId)
  const voiceId = resolvedVoice.voiceId
  const rate = pref.rate
  // NEURAL is the primary path: a preview (explicit voiceId) ALWAYS tries Piper, and
  // every other call uses Piper unless the user has explicitly forced OS Web Speech.
  // OS Web Speech remains only as a manual override or as the synth-null fallback.
  const usePiper = options.voiceId ? true : pref.engine !== 'webspeech'
  const fallbackLang = resolvedVoice.language
  const owner: SpeechOwner = options.source === 'coach' ? 'coach' : 'engineer'
  activeCallCancellation?.signal.cancel()
  const ownerToken = speechOwnerToken(owner)
  const cancellation = createSpeechOwnerCancellationSignal(owner, ownerToken)
  const activeCall = { owner, ownerToken, signal: cancellation }
  activeCallCancellation = activeCall
  // Observability: tag every utterance with its SOURCE (coach / engineer / …) + the
  // originating tip so a spoken line is never an anonymous "via piper" in the log.
  const diag = {
    source: options.source ?? 'unknown',
    tipId: options.tipId ?? null,
    corner: options.corner ?? null
  }

  const seq = ++speakSeq
  if (currentOwner) cancelOwnedWebSpeech(currentOwner)
  // Supersede any current/queued speech (latest callout wins) WITHOUT bumping seq again.
  disposeCurrentAudio()
  currentOwner = owner

  // Mark "speaking" for the whole synth/play lifetime so the wake-word mic can skip
  // capture (never transcribe the engineer's own voice). Always cleared in finally.
  speakingCount += 1
  try {
    if (!usePiper) {
      logClient.info('tts', 'speakViaTts via web-speech (engine pref)', {
        engine: 'web-speech',
        reason: 'pref-webspeech',
        lang: fallbackLang ?? null,
        ...diag
      })
      await webSpeechSpeak(content, fallbackLang, rate, seq, owner, ownerToken, cancellation, voiceId)
      return
    }

    // Synthesize + play chunk by chunk so a long answer starts speaking sooner and a
    // newer call can interrupt mid-stream.
    const chunks = chunkText(content)
    let engineUnavailable = false
    let loggedPath = false
    for (const chunk of chunks) {
      if (seq !== speakSeq || !isSpeechOwnerTokenCurrent(owner, ownerToken)) return
      if (engineUnavailable) {
        await webSpeechSpeak(chunk, fallbackLang, rate, seq, owner, ownerToken, cancellation, voiceId)
        continue
      }
      const synthesized = await raceOwnerStage(synthesize(chunk, voiceId, rate), cancellation)
      if (synthesized.cancelled) return
      const wav = synthesized.value
      if (seq !== speakSeq || !isSpeechOwnerTokenCurrent(owner, ownerToken)) return
      if (wav && wav.byteLength > 0) {
        if (!loggedPath) {
          // Diagnostic: confirm WHICH path actually produced audio. A distinct
          // voiceId here that yields bytes proves Piper (not the single OS voice)
          // is speaking — the core "all voices sound the same" check.
          logClient.info('tts', 'speakViaTts via piper', { engine: 'piper', voiceId, lang: fallbackLang ?? null, ...diag })
          loggedPath = true
        }
        const played = await playWav(wav, rate, seq, owner, ownerToken, cancellation)
        if (seq !== speakSeq || !isSpeechOwnerTokenCurrent(owner, ownerToken)) return
        if (played) continue
        // Neural bytes wouldn't decode/play → fall back so we never go silent.
        engineUnavailable = true
        logClient.info('tts', 'speakViaTts fallback to web-speech', {
          engine: 'web-speech',
          requestedVoiceId: voiceId,
          reason: 'playback-failed',
          lang: fallbackLang ?? null,
          ...diag
        })
        await webSpeechSpeak(chunk, fallbackLang, rate, seq, owner, ownerToken, cancellation, voiceId)
        continue
      }
      // Engine/voice missing → fall back for THIS and the remaining chunks (same language).
      engineUnavailable = true
      logClient.info('tts', 'speakViaTts fallback to web-speech', {
        engine: 'web-speech',
        requestedVoiceId: voiceId,
        reason: 'synth-null',
        lang: fallbackLang ?? null,
        ...diag
      })
      await webSpeechSpeak(chunk, fallbackLang, rate, seq, owner, ownerToken, cancellation, voiceId)
    }
  } finally {
    cancellation.dispose()
    if (activeCallCancellation === activeCall) activeCallCancellation = null
    speakingCount -= 1
    if (seq === speakSeq && currentOwner === owner) currentOwner = null
  }
}

// ─── Voice management (used by VoiceSettingsView) ────────────────────────────────

/** Ask the main process for the catalog with runtime `installed` flags. */
export async function listPiperVoices(): Promise<PiperVoiceInfo[]> {
  try {
    return (await window.ipc.invoke<PiperVoiceInfo[]>(TTS_CHANNELS.listVoices)) ?? []
  } catch {
    return []
  }
}

/** Trigger a download of `voiceId` (idempotent; single-flight in main). Never throws. */
export async function ensurePiperVoice(voiceId: string): Promise<EnsureVoiceResult> {
  try {
    return await window.ipc.invoke<EnsureVoiceResult>(TTS_CHANNELS.ensureVoice, voiceId)
  } catch (error) {
    return { ok: false, voiceId, installed: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Subscribe to voice-download progress events (for the settings progress bar). */
export function subscribeVoiceProgress(cb: (progress: PiperVoiceProgress) => void): () => void {
  try {
    return window.ipc.subscribe<PiperVoiceProgress>(TTS_CHANNELS.voiceProgress, cb)
  } catch {
    return () => undefined
  }
}

// ─── Global mount hook ───────────────────────────────────────────────────────────

let mountCount = 0
let runtimeCleanup: (() => void) | null = null

/** Mount ONCE (App.tsx). Warms the config cache + cleans up audio on teardown. Renders nothing. */
export function useTtsRuntime(): void {
  useEffect(() => {
    mountCount += 1
    if (mountCount === 1) {
      getTtsPref()
      const offCoach = registerSpeechOwnerCanceller('coach', () => stopTtsPlaybackOwner('coach'))
      const offEngineer = registerSpeechOwnerCanceller('engineer', () => stopTtsPlaybackOwner('engineer'))
      const unsubCoach = window.ipc.subscribe<ReplaySpeechCancelEvent>(
        REPLAY_SPEECH_CANCEL_CHANNELS.coach,
        (event) => cancelSpeechOwner('coach', event)
      )
      const unsubEngineer = window.ipc.subscribe<ReplaySpeechCancelEvent>(
        REPLAY_SPEECH_CANCEL_CHANNELS.engineer,
        (event) => cancelSpeechOwner('engineer', event)
      )
      const unsubSpotter = window.ipc.subscribe<ReplaySpeechCancelEvent>(
        REPLAY_SPEECH_CANCEL_CHANNELS.spotter,
        (event) => cancelSpeechOwner('spotter', event)
      )
      runtimeCleanup = () => {
        unsubCoach()
        unsubEngineer()
        unsubSpotter()
        offCoach()
        offEngineer()
      }
    }
    return () => {
      mountCount -= 1
      if (mountCount === 0) {
        stopTts()
        disposeAudioCtx()
        runtimeCleanup?.()
        runtimeCleanup = null
      }
    }
  }, [])
}
