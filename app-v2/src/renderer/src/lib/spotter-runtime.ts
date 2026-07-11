import { useEffect } from 'react'
import type { CarLeftRightState, Flags, TelemetrySnapshot } from '../../../shared/telemetry'
import {
  DEFAULT_SPOTTER_CONFIG,
  PIPER_VOICE_CATALOG,
  SPOTTER_CHANNELS,
  TTS_CHANNELS,
  buildPhrase,
  decideProximity,
  isValidPiperVoiceId,
  parsePiperVoiceId,
  pickVoice,
  pickDistinctOsVoice,
  fallbackVoiceProsody,
  piperVoiceLang,
  type CalloutId,
  type EnsureVoiceResult,
  type GapTrend,
  type PhraseParams,
  type PiperVoiceInfo,
  type ProximitySide,
  type SpotterConfig,
  type SpotterLang,
  type SpotterThresholds
} from '../../../shared/spotter'
import {
  resolvePiperVoice,
  resolveSpeechVoiceURI
} from '../../../shared/tts-voice'
import { logClient } from './log-client'
import { notifyExternalSpeaking } from './tts-runtime'

// Voice Spotter runtime engine.
//
// Subscribes to the SAME live telemetry stream every other renderer runtime
// uses (`window.ipc.subscribe('telemetry:snapshot', …)` — see lib/telemetry.ts
// and lib/soundshift-runtime.ts), computes spotter callouts with per-callout
// cooldown + a priority/expiry queue, and SPEAKS them through the Web Speech
// API (window.speechSynthesis). A single utterance plays at a time so the
// spotter never talks over itself; stale low-priority lines are dropped, and
// urgent lines (e.g. "car left") preempt a lower-priority line in progress.
//
// NOTE ON OUTPUT ROUTING: Chromium's SpeechSynthesis has no setSinkId, so TTS
// always plays on the system default output device. The chosen outputDeviceId
// is persisted for parity with the Sounds menu but cannot reroute TTS today.

// ─── Speech availability ─────────────────────────────────────────────────────

function synthAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.speechSynthesis !== 'undefined' &&
    typeof SpeechSynthesisUtterance !== 'undefined'
  )
}

// ─── Voices cache (loads async; Chromium fires `voiceschanged`) ───────────────

let voiceCache: SpeechSynthesisVoice[] = []
let voicesInitialized = false
// True once the async voice list has loaded OR we've waited the grace period and
// given up — so a TTS-less environment never blocks every callout indefinitely.
let voicesSettled = false
let voicesReadyPromise: Promise<void> | null = null
const voiceListeners = new Set<(voices: SpeechSynthesisVoice[]) => void>()

function refreshVoices(): void {
  if (!synthAvailable()) return
  const next = window.speechSynthesis.getVoices()
  if (next && next.length) {
    voiceCache = next
    for (const listener of voiceListeners) listener(voiceCache)
    notifyUnifiedVoices()
  }
}

function initVoices(): void {
  if (voicesInitialized || !synthAvailable()) return
  voicesInitialized = true
  refreshVoices()
  try {
    window.speechSynthesis.addEventListener('voiceschanged', refreshVoices)
  } catch {
    // Older engines expose only the onvoiceschanged property.
    window.speechSynthesis.onvoiceschanged = refreshVoices
  }
}

// Resolves once `speechSynthesis.getVoices()` is non-empty (or the grace period
// elapses). Chromium/Windows SAPI populate the list ASYNCHRONOUSLY and signal it
// via `voiceschanged`; before that, getVoices() is empty and an explicit voice
// selection can't be matched. We listen for the event AND poll as a backstop
// (some builds never refire the event once a listener is attached), with a hard
// timeout so a voiceless box still speaks (with the engine default).
function ensureVoicesLoaded(timeoutMs = 2000): Promise<void> {
  if (voicesSettled || voiceCache.length > 0 || !synthAvailable()) {
    voicesSettled = true
    return Promise.resolve()
  }
  if (voicesReadyPromise) return voicesReadyPromise
  initVoices()
  refreshVoices()
  if (voiceCache.length > 0) {
    voicesSettled = true
    return Promise.resolve()
  }
  voicesReadyPromise = new Promise<void>((resolve) => {
    let done = false
    const poll = setInterval(() => {
      refreshVoices()
      if (voiceCache.length > 0) finish()
    }, 120)
    const timer = setTimeout(finish, timeoutMs)
    function onChanged(): void {
      refreshVoices()
      if (voiceCache.length > 0) finish()
    }
    function finish(): void {
      if (done) return
      done = true
      voicesSettled = true
      clearInterval(poll)
      clearTimeout(timer)
      try {
        window.speechSynthesis.removeEventListener('voiceschanged', onChanged)
      } catch {
        // ignore
      }
      voicesReadyPromise = null
      resolve()
    }
    try {
      window.speechSynthesis.addEventListener('voiceschanged', onChanged)
    } catch {
      // ignore — the poll + timeout still settle this
    }
  })
  return voicesReadyPromise
}

export function getSpotterVoices(): SpeechSynthesisVoice[] {
  if (!voiceCache.length) {
    initVoices()
    refreshVoices()
  }
  return voiceCache
}

export function subscribeSpotterVoices(callback: (voices: SpeechSynthesisVoice[]) => void): () => void {
  voiceListeners.add(callback)
  callback(getSpotterVoices())
  return () => {
    voiceListeners.delete(callback)
  }
}

// ─── Unified voice list (OS + Piper) ─────────────────────────────────────────

export interface UnifiedVoice {
  id: string            // voiceURI value stored in config
  name: string          // display name shown in UI
  lang: string          // e.g. 'pt-BR', 'en-US'
  voiceURI: string
  default: boolean
  localService: boolean
  engine: 'os' | 'piper'
  piperInstalled?: boolean
}

let piperVoiceCache: UnifiedVoice[] = PIPER_VOICE_CATALOG.map((v) => ({
  id: `piper:${v.id}`,
  voiceURI: `piper:${v.id}`,
  name: `${v.name} · Piper ${v.quality}`,
  lang: v.lang,
  default: false,
  localService: false,
  engine: 'piper' as const,
  piperInstalled: false
}))

const unifiedVoiceListeners = new Set<(voices: UnifiedVoice[]) => void>()

function toUnifiedOs(voices: SpeechSynthesisVoice[]): UnifiedVoice[] {
  return voices.map((v) => ({
    id: v.voiceURI,
    voiceURI: v.voiceURI,
    name: v.name,
    lang: v.lang,
    default: v.default,
    localService: v.localService,
    engine: 'os' as const
  }))
}

function notifyUnifiedVoices(): void {
  const all = [...piperVoiceCache, ...toUnifiedOs(voiceCache)]
  for (const listener of unifiedVoiceListeners) listener(all)
}

export function getUnifiedVoices(): UnifiedVoice[] {
  return [...piperVoiceCache, ...toUnifiedOs(voiceCache)]
}

export function subscribeUnifiedVoices(callback: (voices: UnifiedVoice[]) => void): () => void {
  unifiedVoiceListeners.add(callback)
  callback(getUnifiedVoices())
  return () => {
    unifiedVoiceListeners.delete(callback)
  }
}

function fetchPiperVoices(): Promise<void> {
  return window.ipc
    .invoke<PiperVoiceInfo[]>(TTS_CHANNELS.listVoices)
    .then((voices) => {
      piperVoiceCache = voices.map((v) => ({
        id: `piper:${v.id}`,
        voiceURI: `piper:${v.id}`,
        name: `${v.name} · Piper ${v.quality}`,
        lang: v.lang,
        default: false,
        localService: false,
        engine: 'piper' as const,
        piperInstalled: v.installed
      }))
      notifyUnifiedVoices()
    })
    .catch(() => undefined)
}

// ─── Auto-download the SELECTED Piper voice(s) ───────────────────────────────
//
// When the user picks a Piper voice for the spotter (defaultVoiceURI or any
// per-callout voiceURI), the model must be on disk for that DISTINCT voice to
// actually play — otherwise tts:synth returns null and the callout silently
// collapses to the single OS voice (the "all voices sound the same" bug). So on
// every config change we ensure every referenced Piper voice is downloaded. The
// requested set is remembered so we only fire ONE download per voice id.
const ensuredPiperVoiceIds = new Set<string>()

function collectPiperVoiceIds(config: SpotterConfig): string[] {
  const ids = new Set<string>()

  const addResolvedPiper = (uri: string): void => {
    const id = parsePiperVoiceId(uri)
    if (!uri || id || isValidPiperVoiceId(uri)) {
      ids.add(resolvePiperVoice(config.language, uri).voiceId)
    }
  }

  addResolvedPiper(config.defaultVoiceURI)
  for (const callout of Object.values(config.callouts)) {
    if (callout.voiceURI) addResolvedPiper(callout.voiceURI)
  }

  return [...ids]
}

function ensureSelectedPiperVoices(config: SpotterConfig): void {
  for (const id of collectPiperVoiceIds(config)) {
    // Already installed (per the latest list) → nothing to do.
    const cached = piperVoiceCache.find((v) => v.voiceURI === `piper:${id}`)
    if (cached?.piperInstalled) continue
    if (ensuredPiperVoiceIds.has(id)) continue
    ensuredPiperVoiceIds.add(id)
    logClient.info('spotter', `auto-downloading selected piper voice ${id}`, { voiceId: id })
    void window.ipc
      .invoke<EnsureVoiceResult>(TTS_CHANNELS.ensureVoice, id)
      .then((result) => {
        if (!result?.ok) {
          // Allow a later retry if the download failed.
          ensuredPiperVoiceIds.delete(id)
          logClient.warn('spotter', `auto-download failed for ${id}`, { voiceId: id, error: result?.error ?? null })
          return
        }
        // Refresh installed flags so speakWithPiper now uses the real model.
        void fetchPiperVoices()
      })
      .catch(() => {
        ensuredPiperVoiceIds.delete(id)
      })
  }
}

// Thin DOM-aware wrapper over the pure `pickVoice` resolver. An explicit voiceURI
// is matched EXACTLY (never degraded to a language default); a language default
// is only used when voiceURI is empty. See pickVoice in shared/spotter.ts.
function resolveVoice(voiceURI: string, lang: SpotterLang): SpeechSynthesisVoice | null {
  return pickVoice(getSpotterVoices(), voiceURI, lang)
}

// ─── Activity log (live UI feedback) ─────────────────────────────────────────

export interface SpotterLogEntry {
  id: CalloutId | 'test'
  text: string
  priority: number
  at: number
}

let logBuffer: SpotterLogEntry[] = []
const logListeners = new Set<(entries: SpotterLogEntry[]) => void>()

function pushLog(entry: SpotterLogEntry): void {
  logBuffer = [entry, ...logBuffer].slice(0, 40)
  for (const listener of logListeners) listener(logBuffer)
}

export function subscribeSpotterLog(callback: (entries: SpotterLogEntry[]) => void): () => void {
  logListeners.add(callback)
  callback(logBuffer)
  return () => {
    logListeners.delete(callback)
  }
}

// ─── Speech queue ────────────────────────────────────────────────────────────

interface QueuedLine {
  id: CalloutId
  text: string
  priority: number
  voiceURI: string
  configuredVoiceURI?: string
  // When set and `voiceURI` is empty, the OS fallback picks a DISTINCT installed
  // voice for this neural voice id so different voices never collapse to one.
  seedVoiceId?: string
  lang: SpotterLang
  rate: number
  pitch: number
  volume: number
  outputDeviceId: string
  enqueuedAt: number
  expiresAt: number
}

const URGENT_PRIORITY = 9

function maxAgeMs(priority: number): number {
  if (priority >= URGENT_PRIORITY) return 1500
  if (priority >= 6) return 3000
  return 5000
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(0, Math.min(1, value))
}

function toAudioBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

// Shared Web Audio graph: HTMLAudioElement rejects sherpa's WAV blob in the Electron
// renderer (onerror) → the neural spotter went silent. AudioContext.decodeAudioData
// plays it reliably (same fix as the engineer path in tts-runtime). One source plays
// at a time; volume rides a GainNode, rate rides source.playbackRate.
let piperCtx: AudioContext | null = null
function ensurePiperCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!piperCtx) piperCtx = new Ctor()
  return piperCtx
}

interface GapSample {
  sec: number
  at: number
}

interface EngineState {
  prevFlags?: Flags
  prevOnPitRoad?: boolean
  prevPosition?: number
  prevBestLap?: number
  prevIncidentCount?: number
  prevLapNumber?: number
  prevConnected?: boolean
  prevGear?: number
  proxLeft: boolean
  proxRight: boolean
  shiftArmed: boolean
  gapAheadSample?: GapSample
  gapBehindSample?: GapSample
  lastSpokenAt: Map<CalloutId, number>
  queue: QueuedLine[]
  speaking: boolean
  currentPriority: number
  activeUtterance: SpeechSynthesisUtterance | null
  watchdog: ReturnType<typeof setTimeout> | null
  activePiperSource: AudioBufferSourceNode | null
  activePiperGain: GainNode | null
  piperGen: number
}

const state: EngineState = {
  proxLeft: false,
  proxRight: false,
  shiftArmed: true,
  lastSpokenAt: new Map(),
  queue: [],
  speaking: false,
  currentPriority: 0,
  activeUtterance: null,
  watchdog: null,
  activePiperSource: null,
  activePiperGain: null,
  piperGen: 0
}

function resetTransientState(): void {
  state.prevFlags = undefined
  state.prevOnPitRoad = undefined
  state.prevPosition = undefined
  state.prevBestLap = undefined
  state.prevIncidentCount = undefined
  state.prevLapNumber = undefined
  state.prevConnected = undefined
  state.prevGear = undefined
  state.proxLeft = false
  state.proxRight = false
  state.shiftArmed = true
  state.gapAheadSample = undefined
  state.gapBehindSample = undefined
  state.lastSpokenAt.clear()
}

// M4 self-listen guard: tell the shared "is something speaking" signal (in
// tts-runtime, which the wake-word engine consults via isTtsSpeaking()) whenever
// the SPOTTER is producing audio, so the mic never transcribes the spotter's own
// callouts. Idempotent + balanced: the spotter plays exactly one line at a time,
// so a single boolean tracks it and guarantees the +1/-1 sent to tts-runtime stays
// balanced across barge-in, cancel, errors and teardown (a redundant true/false is
// a no-op; a leaked `true` is always cleared by the next queue-drain or stop).
let spotterAudible = false
function setSpotterAudible(active: boolean): void {
  if (active === spotterAudible) return
  spotterAudible = active
  try {
    notifyExternalSpeaking(active)
  } catch {
    // A cross-module notify must never break speech.
  }
}

function onUtteranceDone(utterance: SpeechSynthesisUtterance): void {
  // Ignore late end/error events from a preempted (cancelled) utterance.
  if (state.activeUtterance !== utterance) return
  if (state.watchdog) { clearTimeout(state.watchdog); state.watchdog = null }
  state.activeUtterance = null
  state.speaking = false
  state.currentPriority = 0
  setSpotterAudible(false)
  speakNext()
}

function cancelPiperAudio(): void {
  state.piperGen++ // invalidate any in-flight speakWithPiper/speakImmediate-piper
  if (state.activePiperSource) {
    state.activePiperSource.onended = null // teardown must not trigger speakNext
    try { state.activePiperSource.stop() } catch { /* not started yet */ }
    try { state.activePiperSource.disconnect() } catch { /* already gone */ }
    state.activePiperSource = null
  }
  if (state.activePiperGain) {
    try { state.activePiperGain.disconnect() } catch { /* already gone */ }
    state.activePiperGain = null
  }
  setSpotterAudible(false)
}

// Resolves + APPLIES the chosen voice, records which voice/engine actually spoke,
// then hands the utterance to the engine. Split out so the OS path can defer just
// this step until the async voice list populates. The activeUtterance identity
// check drops it if this line was preempted/cancelled while we waited.
function applyVoiceAndSpeak(utterance: SpeechSynthesisUtterance, line: QueuedLine): void {
  if (state.activeUtterance !== utterance) return
  // Empty voiceURI + a neural seed → map to a DISTINCT same-language OS voice
  // (deterministic per voice id) instead of the single language default, so the
  // user's different voices stay audibly different when neural TTS is unavailable.
  const voice =
    !line.voiceURI && line.seedVoiceId
      ? pickDistinctOsVoice(line.seedVoiceId, voiceCache, line.lang) ?? resolveVoice(line.voiceURI, line.lang)
      : resolveVoice(line.voiceURI, line.lang)
  if (voice) {
    utterance.voice = voice
    utterance.lang = voice.lang || line.lang
  }
  if (!line.voiceURI && line.seedVoiceId) {
    // Single-OS-voice languages collapse distinct voices to one; nudge pitch/rate
    // per voice id so the user's different voices stay audibly distinct.
    const prosody = fallbackVoiceProsody(line.seedVoiceId)
    utterance.pitch = prosody.pitch
    utterance.rate = line.rate * prosody.rate
  }
  logClient.info('spotter', `callout ${line.id} spoken`, {
    engine: 'os',
    requestedVoiceURI: line.configuredVoiceURI || '(language default)',
    resolvedVoiceURI: voice?.voiceURI ?? null,
    resolvedVoiceName: voice?.name ?? null,
    lang: utterance.lang
  })
  pushLog({ id: line.id, text: line.text, priority: line.priority, at: Date.now() })
  setSpotterAudible(true)
  try {
    window.speechSynthesis.speak(utterance)
  } catch {
    onUtteranceDone(utterance)
  }
}

function speakWithOS(line: QueuedLine): void {
  if (!synthAvailable()) {
    state.speaking = false
    state.currentPriority = 0
    setSpotterAudible(false)
    return
  }
  const utterance = new SpeechSynthesisUtterance(line.text)
  utterance.lang = line.lang
  utterance.rate = line.rate
  utterance.pitch = line.pitch
  utterance.volume = line.volume
  utterance.onend = () => onUtteranceDone(utterance)
  utterance.onerror = () => onUtteranceDone(utterance)
  state.activeUtterance = utterance
  // Chromium occasionally drops onend/onerror (backgrounded window, long text);
  // watchdog so a stuck utterance can't wedge the queue indefinitely.
  if (state.watchdog) clearTimeout(state.watchdog)
  state.watchdog = setTimeout(() => onUtteranceDone(utterance), Math.max(6000, line.text.length * 140))
  // If the async voice list hasn't loaded yet, wait for it so the FIRST callout
  // honors the chosen voice instead of falling through to the engine default.
  if (voiceCache.length === 0 && !voicesSettled) {
    void ensureVoicesLoaded().then(() => applyVoiceAndSpeak(utterance, line))
  } else {
    applyVoiceAndSpeak(utterance, line)
  }
}

async function speakWithPiper(line: QueuedLine): Promise<void> {
  const voiceId = line.voiceURI.slice('piper:'.length)
  const gen = state.piperGen // capture BEFORE any await; cancelPiperAudio() bumps this
  try {
    const raw = await window.ipc.invoke<Uint8Array | null>(TTS_CHANNELS.synth, line.text, voiceId, line.rate)
    if (gen !== state.piperGen) return // cancelled while synth was in-flight

    if (!raw) {
      // Piper engine/model unavailable — fall back to a SAME-LANGUAGE OS voice so
      // the user's language intent survives, instead of forcing the engine
      // default (which made every callout sound identical). speakWithOS handles
      // its own pushLog/diagnostic logging.
      const fallbackLang = piperVoiceLang(voiceId) ?? line.lang
      logClient.info('spotter', `callout ${line.id} piper-unavailable fallback`, {
        requestedVoiceURI: line.configuredVoiceURI || '(language default)',
        resolvedVoiceURI: line.voiceURI,
        fallbackEngine: 'os',
        fallbackLang
      })
      speakWithOS({ ...line, voiceURI: '', lang: fallbackLang, seedVoiceId: voiceId })
      return
    }
    logClient.info('spotter', `callout ${line.id} spoken`, {
      engine: 'piper',
      requestedVoiceURI: line.configuredVoiceURI || '(language default)',
      resolvedVoiceURI: line.voiceURI,
      lang: line.lang
    })
    pushLog({ id: line.id, text: line.text, priority: line.priority, at: Date.now() })
    const ctx = ensurePiperCtx()
    if (!ctx) {
      // No Web Audio → OS fallback so a callout never goes silent.
      speakWithOS({ ...line, voiceURI: '', lang: line.lang, seedVoiceId: voiceId })
      return
    }
    let audioBuffer: AudioBuffer
    try {
      if (ctx.state === 'suspended') await ctx.resume()
      audioBuffer = await ctx.decodeAudioData(toAudioBuffer(raw))
    } catch {
      // Neural bytes wouldn't decode → fall back so we never go silent.
      logClient.warn('spotter', `callout ${line.id} piper-decode fallback`, { bytes: raw.byteLength })
      speakWithOS({ ...line, voiceURI: '', lang: line.lang, seedVoiceId: voiceId })
      return
    }
    if (gen !== state.piperGen) return
    const sink = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> }
    if (line.outputDeviceId && typeof sink.setSinkId === 'function') {
      try {
        await sink.setSinkId(line.outputDeviceId)
      } catch {
        // setSinkId unsupported (e.g. dev macOS) — continue without routing
      }
    }
    if (gen !== state.piperGen) return
    const source = ctx.createBufferSource()
    source.buffer = audioBuffer
    source.playbackRate.value = Math.max(0.25, Math.min(4, line.rate))
    const gain = ctx.createGain()
    gain.gain.value = line.volume
    source.connect(gain)
    gain.connect(ctx.destination)
    state.activePiperSource = source
    state.activePiperGain = gain
    const done = (): void => {
      if (state.activePiperSource === source) {
        state.activePiperSource = null
        state.activePiperGain = null
      }
      try { source.disconnect() } catch { /* already gone */ }
      try { gain.disconnect() } catch { /* already gone */ }
      state.speaking = false
      state.currentPriority = 0
      setSpotterAudible(false)
      speakNext()
    }
    source.onended = done
    setSpotterAudible(true)
    source.start()
  } catch {
    if (gen === state.piperGen) {
      cancelPiperAudio()
      state.speaking = false
      state.currentPriority = 0
      speakNext()
    }
  }
}

function speakNext(): void {
  const now = Date.now()
  state.queue = state.queue.filter((line) => line.expiresAt > now)
  if (state.queue.length === 0) {
    state.speaking = false
    setSpotterAudible(false)
    return
  }
  // Highest priority first, FIFO within equal priority.
  state.queue.sort((a, b) => b.priority - a.priority || a.enqueuedAt - b.enqueuedAt)
  const line = state.queue.shift()
  if (!line) {
    state.speaking = false
    setSpotterAudible(false)
    return
  }
  state.speaking = true
  state.currentPriority = line.priority
  const spokenLine = {
    ...line,
    voiceURI: resolveSpeechVoiceURI(line.lang, line.voiceURI, getUnifiedVoices())
  }
  if (spokenLine.voiceURI.startsWith('piper:')) {
    void speakWithPiper(spokenLine)
    return
  }
  // OS Web Speech path — bail early if unavailable rather than clearing queue
  if (!synthAvailable()) {
    state.speaking = false
    state.currentPriority = 0
    setSpotterAudible(false)
    return
  }
  speakWithOS(spokenLine)
}

function enqueue(line: QueuedLine): void {
  state.queue.push(line)
  if (!state.speaking) {
    speakNext()
    return
  }
  // Preempt a lower-priority line in progress for urgent safety callouts.
  if (line.priority >= URGENT_PRIORITY && line.priority > state.currentPriority) {
    state.activeUtterance = null
    state.speaking = false
    state.currentPriority = 0
    try {
      window.speechSynthesis.cancel()
    } catch {
      // ignore
    }
    cancelPiperAudio()
    speakNext()
  }
}

// ─── Trigger emission ────────────────────────────────────────────────────────

function emit(config: SpotterConfig, id: CalloutId, params: PhraseParams = {}): boolean {
  const cfg = config.callouts[id]
  if (!cfg || !cfg.enabled) return false
  if (!config.enabled || config.muted) return false
  const now = Date.now()
  const last = state.lastSpokenAt.get(id) ?? 0
  if (now - last < cfg.cooldownMs) return false
  const text = buildPhrase(id, config.language, params)
  if (!text) return false
  state.lastSpokenAt.set(id, now)
  const priority = cfg.priority
  enqueue({
    id,
    text,
    priority,
    voiceURI: cfg.voiceURI || config.defaultVoiceURI,
    configuredVoiceURI: cfg.voiceURI || config.defaultVoiceURI,
    lang: config.language,
    rate: cfg.rate,
    pitch: cfg.pitch,
    volume: clamp01(cfg.volume * config.masterVolume),
    outputDeviceId: config.outputDeviceId,
    enqueuedAt: now,
    expiresAt: now + maxAgeMs(priority)
  })
  return true
}

// ─── Per-category trigger logic ──────────────────────────────────────────────

function processFlags(config: SpotterConfig, flags: Flags | undefined): void {
  if (!flags) return
  const prev = state.prevFlags
  if (prev) {
    if (flags.green && !prev.green) emit(config, 'flag.green')
    if (flags.yellow && !prev.yellow) emit(config, 'flag.yellow')
    if (flags.blue && !prev.blue) emit(config, 'flag.blue')
    if (flags.white && !prev.white) emit(config, 'flag.white')
    if (flags.checkered && !prev.checkered) emit(config, 'flag.checkered')
    if (flags.meatball && !prev.meatball) emit(config, 'flag.meatball')
    if (flags.black && !prev.black) emit(config, 'flag.black')
  }
  state.prevFlags = { ...flags }
}

function lapsOfFuelOf(snapshot: TelemetrySnapshot): number | undefined {
  const fuel = snapshot.fuelLiters
  const per = snapshot.fuelPerLap
  if (fuel == null || !Number.isFinite(fuel)) return undefined
  if (per == null || !Number.isFinite(per) || per <= 0) return undefined
  return fuel / per
}

function processFuel(config: SpotterConfig, snapshot: TelemetrySnapshot, lapsOfFuel: number | undefined, th: SpotterThresholds): void {
  if (lapsOfFuel == null) return
  if (lapsOfFuel <= th.fuelLowLaps) emit(config, 'fuel.low')
  const cannotFinish = snapshot.lapsRemaining == null || lapsOfFuel < snapshot.lapsRemaining
  if (lapsOfFuel <= th.fuelBoxLaps && cannotFinish && snapshot.onPitRoad !== true) emit(config, 'fuel.box')
}

function processPit(config: SpotterConfig, snapshot: TelemetrySnapshot, th: SpotterThresholds): void {
  const onPit = snapshot.onPitRoad === true
  if (onPit && state.prevOnPitRoad === false) emit(config, 'pit.onPitRoad')
  if (
    onPit &&
    snapshot.pitLimiter !== true &&
    Number.isFinite(snapshot.speedKmh) &&
    snapshot.speedKmh > th.pitSpeedLimitKmh + 2
  ) {
    emit(config, 'pit.speeding')
  }
  if (snapshot.lapsRemaining != null && snapshot.lapsRemaining > 0 && snapshot.lapsRemaining <= th.pitWindowOpenLaps) {
    emit(config, 'pit.windowOpen')
  }
  state.prevOnPitRoad = onPit
}

// True when the proximity ahead/behind gate permits announcing. This ONLY
// enables/disables WHETHER to speak — the SIDE always comes from CarLeftRight.
// When radar data exists we require at least one car within the ahead window
// (an alongside car has ~0s gap, so its relativeY is small and passes); when no
// radar is available we trust CarLeftRight, which iRacing only raises when a car
// is genuinely alongside.
function proximityGateOpen(snapshot: TelemetrySnapshot, th: SpotterThresholds): boolean {
  const radar = snapshot.radarCars
  if (!radar || !radar.length) return true
  for (const car of radar) {
    if (Number.isFinite(car.relativeY) && Math.abs(car.relativeY) <= th.proximityAheadMeters) return true
  }
  return false
}

// Fallback for providers that do NOT expose CarLeftRight (mock/ACC/AMS2): derive
// the side from REAL radar relativeX positions. This never runs for iRacing (its
// provider always sets snapshot.carLeftRight), so the fabricated index-parity
// relativeX used for radar dots can never reach the spoken callout.
function carLeftRightFromRadar(snapshot: TelemetrySnapshot, th: SpotterThresholds): CarLeftRightState {
  const radar = snapshot.radarCars
  if (!radar || !radar.length) return 'clear'
  let left = false
  let right = false
  for (const car of radar) {
    if (!Number.isFinite(car.relativeX) || !Number.isFinite(car.relativeY)) continue
    if (Math.abs(car.relativeY) > th.proximityAheadMeters) continue
    if (Math.abs(car.relativeX) > th.proximitySideMeters) continue
    if (Math.abs(car.relativeX) < 0.4) continue // basically overlapping dead ahead/behind
    if (car.relativeX < 0) left = true
    else right = true
  }
  return left && right ? 'both' : left ? 'left' : right ? 'right' : 'clear'
}

// Logs every proximity callout that is actually spoken (transition only, not per
// frame). Detail carries the raw iRacing enum, the decided side, and how many
// cars are on that side (5=2CarsLeft / 6=2CarsRight → 2, single sides → 1).
function logProximityCallout(snapshot: TelemetrySnapshot, announce: ProximitySide): void {
  const raw = Number.isFinite(snapshot.carLeftRightRaw) ? Math.trunc(snapshot.carLeftRightRaw as number) : -1
  const side: 'left' | 'right' | 'both' = announce === 'three-wide' ? 'both' : announce
  const sameSide = raw === 5 || raw === 6 ? 2 : raw === 2 || raw === 3 ? 1 : undefined
  logClient.info('spotter', 'proximity callout', { carLeftRightRaw: raw, side, sameSide })
}

function processProximity(config: SpotterConfig, snapshot: TelemetrySnapshot, th: SpotterThresholds): void {
  // AUTHORITATIVE: the side comes from the iRacing CarLeftRight state, never from
  // summing per-car relativeX signs. The threshold gate only decides WHETHER to
  // announce. Providers without CarLeftRight fall back to real radar positions.
  let lrState: CarLeftRightState | undefined
  let gateOpen: boolean
  if (snapshot.carLeftRight !== undefined) {
    lrState = snapshot.carLeftRight
    gateOpen = proximityGateOpen(snapshot, th)
  } else {
    lrState = carLeftRightFromRadar(snapshot, th)
    gateOpen = lrState !== 'clear'
  }
  const decision = decideProximity(lrState, gateOpen, { left: state.proxLeft, right: state.proxRight })
  if (decision.announce && emit(config, 'proximity.spotter', { side: decision.announce })) {
    logProximityCallout(snapshot, decision.announce)
  }
  state.proxLeft = decision.leftNow
  state.proxRight = decision.rightNow
}

function processGap(
  config: SpotterConfig,
  id: 'gap.ahead' | 'gap.behind',
  rawGap: number | undefined,
  sample: GapSample | undefined,
  setSample: (next: GapSample) => void,
  th: SpotterThresholds
): void {
  if (rawGap == null || !Number.isFinite(rawGap)) return
  const gap = Math.abs(rawGap)
  let trend: GapTrend | undefined
  if (sample) {
    const delta = gap - sample.sec
    if (Math.abs(delta) >= th.gapChangeSec) trend = delta < 0 ? 'closing' : 'pulling-away'
  }
  if (emit(config, id, { gapSec: gap, trend })) setSample({ sec: gap, at: Date.now() })
}

function processPosition(config: SpotterConfig, snapshot: TelemetrySnapshot): void {
  const pos = snapshot.position
  if (pos == null || !Number.isFinite(pos)) return
  if (state.prevPosition != null && pos !== state.prevPosition) emit(config, 'position.change', { positionNumber: pos })
  state.prevPosition = pos
}

function processIncidents(config: SpotterConfig, snapshot: TelemetrySnapshot, th: SpotterThresholds): void {
  const count = snapshot.incidentCount
  if (count == null || !Number.isFinite(count)) return
  if (state.prevIncidentCount != null && count > state.prevIncidentCount) emit(config, 'incident.points', { points: count })
  const limit = snapshot.incidentLimit
  if (limit != null && limit > 0 && count < limit && limit - count <= th.incidentWarnMargin) emit(config, 'incident.limit')
  state.prevIncidentCount = count
}

const SHIFT_PCT = 0.97

function processShift(config: SpotterConfig, snapshot: TelemetrySnapshot): void {
  if (state.prevGear != null && snapshot.gear !== state.prevGear) state.shiftArmed = true
  state.prevGear = snapshot.gear
  const pct = snapshot.shiftIndicatorPct
  if (pct == null || !Number.isFinite(pct)) return
  if (snapshot.gear < 1 || snapshot.throttle < 0.5) return
  if (pct >= SHIFT_PCT && state.shiftArmed) {
    emit(config, 'shift.point')
    state.shiftArmed = false
  } else if (pct < SHIFT_PCT - 0.08) {
    state.shiftArmed = true
  }
}

function processLap(config: SpotterConfig, snapshot: TelemetrySnapshot, lapsOfFuel: number | undefined): void {
  // session start when telemetry comes alive
  if (snapshot.connected && state.prevConnected === false) emit(config, 'session.start')
  state.prevConnected = snapshot.connected

  // personal best
  const best = snapshot.bestLapTimeSec
  if (best != null && best > 0) {
    if (state.prevBestLap != null && best < state.prevBestLap - 0.001) emit(config, 'lap.personalBest')
    state.prevBestLap = state.prevBestLap == null ? best : Math.min(state.prevBestLap, best)
  }

  // lap crossing → last-lap delta + per-lap fuel readout
  const lap = snapshot.currentLap
  if (lap != null && Number.isFinite(lap)) {
    if (state.prevLapNumber != null && lap > state.prevLapNumber) {
      const lastLap = snapshot.lastLapTimeSec
      const bestLap = snapshot.bestLapTimeSec
      let deltaSec: number | undefined
      if (lastLap != null && lastLap > 0 && bestLap != null && bestLap > 0) deltaSec = lastLap - bestLap
      else if (snapshot.deltaToBestSec != null) deltaSec = snapshot.deltaToBestSec
      if (deltaSec != null) emit(config, 'lap.delta', { deltaSec })
      if (lapsOfFuel != null) emit(config, 'fuel.lapsLeft', { laps: Math.floor(lapsOfFuel) })
    }
    state.prevLapNumber = lap
  }
}

function processSnapshot(snapshot: TelemetrySnapshot | null, config: SpotterConfig): void {
  if (!snapshot) {
    resetTransientState()
    return
  }
  const th = config.thresholds
  const lapsOfFuel = lapsOfFuelOf(snapshot)

  processFlags(config, snapshot.flags)
  processFuel(config, snapshot, lapsOfFuel, th)
  processPit(config, snapshot, th)
  processProximity(config, snapshot, th)
  processGap(config, 'gap.ahead', snapshot.relatives?.ahead?.gapSec, state.gapAheadSample, (s) => (state.gapAheadSample = s), th)
  processGap(config, 'gap.behind', snapshot.relatives?.behind?.gapSec, state.gapBehindSample, (s) => (state.gapBehindSample = s), th)
  processPosition(config, snapshot)
  processIncidents(config, snapshot, th)
  processShift(config, snapshot)
  processLap(config, snapshot, lapsOfFuel)
}

// ─── Public test helpers (used by the SpotterView "Testar" buttons) ──────────

const TEST_PARAMS: Partial<Record<CalloutId, PhraseParams>> = {
  'fuel.lapsLeft': { laps: 5 },
  'gap.ahead': { gapSec: 1.2, trend: 'closing' },
  'gap.behind': { gapSec: 0.8, trend: 'pulling-away' },
  'position.change': { positionNumber: 3 },
  'incident.points': { points: 6 },
  'proximity.spotter': { side: 'left' },
  'lap.delta': { deltaSec: -0.3 }
}

// One-shot OS speech for the test buttons (no queue/watchdog). Waits for the
// async voice list when needed so the test is audible with the SELECTED voice
// the very first time it's pressed. `gen` (state.piperGen captured by the caller
// after cancelPiperAudio) guards against a newer test press superseding this one
// while we await the voice list.
function speakOSImmediate(
  text: string,
  voiceURI: string,
  lang: SpotterLang,
  rate: number,
  pitch: number,
  volume: number,
  gen: number,
  seedVoiceId = '',
  configuredVoiceURI = voiceURI
): void {
  if (!synthAvailable()) return
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = lang
  utterance.rate = rate
  utterance.pitch = pitch
  utterance.volume = clamp01(volume)
  const go = (): void => {
    if (gen !== state.piperGen) return // superseded by a newer test/cancel
    const voice =
      !voiceURI && seedVoiceId
        ? pickDistinctOsVoice(seedVoiceId, voiceCache, lang) ?? resolveVoice(voiceURI, lang)
        : resolveVoice(voiceURI, lang)
    if (voice) {
      utterance.voice = voice
      utterance.lang = voice.lang || lang
    }
    if (!voiceURI && seedVoiceId) {
      const prosody = fallbackVoiceProsody(seedVoiceId)
      utterance.pitch = prosody.pitch
      utterance.rate = rate * prosody.rate
    }
    logClient.info('spotter', 'test voice spoken', {
      engine: 'os',
      requestedVoiceURI: configuredVoiceURI || '(language default)',
      resolvedVoiceURI: voice?.voiceURI ?? null,
      resolvedVoiceName: voice?.name ?? null,
      lang: utterance.lang
    })
    try {
      window.speechSynthesis.speak(utterance)
    } catch {
      // ignore
    }
  }
  if (voiceCache.length === 0 && !voicesSettled) void ensureVoicesLoaded().then(go)
  else go()
}

function speakImmediate(
  text: string,
  voiceURI: string,
  lang: SpotterLang,
  rate: number,
  pitch: number,
  volume: number,
  outputDeviceId = ''
): void {
  if (!text) return
  const configuredVoiceURI = voiceURI
  voiceURI = resolveSpeechVoiceURI(lang, configuredVoiceURI, getUnifiedVoices())
  // Cancel any ongoing speech — this is an explicit user test.
  state.queue = []
  state.activeUtterance = null
  state.speaking = false
  state.currentPriority = 0
  cancelPiperAudio()
  try {
    if (synthAvailable()) window.speechSynthesis.cancel()
  } catch {
    // ignore
  }
  pushLog({ id: 'test', text, priority: 0, at: Date.now() })
  // cancelPiperAudio() above bumped piperGen — capture AFTER it so a second
  // speakImmediate (OS or Piper) invalidates this one's deferred work.
  const gen = state.piperGen

  if (voiceURI.startsWith('piper:')) {
    const voiceId = voiceURI.slice('piper:'.length)
    state.speaking = true
    void window.ipc
      .invoke<Uint8Array | null>(TTS_CHANNELS.synth, text, voiceId, rate)
      .then(async (raw) => {
        if (gen !== state.piperGen) return // cancelled during synth
        if (!raw) {
          // Piper not installed — fall back to a SAME-LANGUAGE OS voice (not the
          // engine default) so the test stays audible in the right language.
          state.speaking = false
          const fallbackLang = piperVoiceLang(voiceId) ?? lang
          logClient.info('spotter', 'test piper-unavailable fallback', {
            requestedVoiceURI: configuredVoiceURI || '(language default)',
            resolvedVoiceURI: voiceURI,
            fallbackEngine: 'os',
            fallbackLang
          })
          speakOSImmediate(text, '', fallbackLang, rate, pitch, volume, gen, voiceId, configuredVoiceURI)
          return
        }
        logClient.info('spotter', 'test voice spoken', {
          engine: 'piper',
          requestedVoiceURI: configuredVoiceURI || '(language default)',
          resolvedVoiceURI: voiceURI,
          lang
        })
        const ctx = ensurePiperCtx()
        if (!ctx) {
          // No Web Audio → OS fallback so the test stays audible.
          state.speaking = false
          speakOSImmediate(text, '', lang, rate, pitch, volume, gen, voiceId, configuredVoiceURI)
          return
        }
        let audioBuffer: AudioBuffer
        try {
          if (ctx.state === 'suspended') await ctx.resume()
          audioBuffer = await ctx.decodeAudioData(toAudioBuffer(raw))
        } catch {
          // Neural bytes wouldn't decode → fall back so the test never goes silent.
          state.speaking = false
          speakOSImmediate(text, '', lang, rate, pitch, volume, gen, voiceId, configuredVoiceURI)
          return
        }
        if (gen !== state.piperGen) return
        const sink = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> }
        if (outputDeviceId && typeof sink.setSinkId === 'function') {
          try { await sink.setSinkId(outputDeviceId) } catch { /* ignore */ }
        }
        if (gen !== state.piperGen) return
        const source = ctx.createBufferSource()
        source.buffer = audioBuffer
        source.playbackRate.value = Math.max(0.25, Math.min(4, rate))
        const gain = ctx.createGain()
        gain.gain.value = clamp01(volume)
        source.connect(gain)
        gain.connect(ctx.destination)
        state.activePiperSource = source
        state.activePiperGain = gain
        const done = (): void => {
          if (state.activePiperSource === source) {
            state.activePiperSource = null
            state.activePiperGain = null
          }
          try { source.disconnect() } catch { /* already gone */ }
          try { gain.disconnect() } catch { /* already gone */ }
          state.speaking = false
          setSpotterAudible(false)
        }
        source.onended = done
        setSpotterAudible(true)
        try { source.start() } catch { done() }
      })
      .catch(() => {
        if (gen === state.piperGen) {
          state.speaking = false
          setSpotterAudible(false)
        }
      })
    return
  }

  speakOSImmediate(text, voiceURI, lang, rate, pitch, volume, gen, '', configuredVoiceURI)
}

export function testCallout(id: CalloutId, config: SpotterConfig): void {
  const cfg = config.callouts[id]
  if (!cfg) return
  const text = buildPhrase(id, config.language, TEST_PARAMS[id] ?? {})
  speakImmediate(
    text,
    cfg.voiceURI || config.defaultVoiceURI,
    config.language,
    cfg.rate,
    cfg.pitch,
    clamp01(cfg.volume * config.masterVolume),
    config.outputDeviceId
  )
}

export function testSpotterVoice(config: SpotterConfig): void {
  const text = config.language === 'pt-BR' ? 'Audio engineer online. Have a good race.' : 'Audio engineer online. Have a good race.'
  speakImmediate(text, config.defaultVoiceURI, config.language, 1, 1, clamp01(config.masterVolume), config.outputDeviceId)
}

export function stopSpotterSpeech(): void {
  state.queue = []
  state.activeUtterance = null
  state.speaking = false
  state.currentPriority = 0
  cancelPiperAudio()
  if (synthAvailable()) {
    try {
      window.speechSynthesis.cancel()
    } catch {
      // ignore
    }
  }
}

// ─── Ref-counted runtime hook ────────────────────────────────────────────────
//
// Mount once at the app root so the spotter runs whenever telemetry is live.
// The subscription is ref-counted + the engine is a module singleton, so it is
// safe if this hook is mounted in more than one place (e.g. App root AND the
// SpotterView) — telemetry is still processed by exactly one path and there is
// never a double-speak.

let currentConfig: SpotterConfig = DEFAULT_SPOTTER_CONFIG
let subscriberCount = 0
let offTelemetry: (() => void) | null = null
let offConfig: (() => void) | null = null

function startSubscriptions(): void {
  initVoices()
  // Kick the async voice list so it's populated before the first callout — the
  // Web Speech voiceschanged race is the main reason a chosen voice was ignored.
  void ensureVoicesLoaded()
  // Fetch installed flags, but do not ensure the module-level fallback config:
  // wait for the persisted, app-language-synced config below so a PT app never
  // starts an unnecessary English model download during renderer boot.
  const piperVoicesReady = fetchPiperVoices()
  void window.ipc
    .invoke<SpotterConfig>(SPOTTER_CHANNELS.getConfig)
    .then((config) => {
      currentConfig = config
      void piperVoicesReady.then(() => ensureSelectedPiperVoices(config))
    })
    .catch(() => undefined)
  offConfig = window.ipc.subscribe<SpotterConfig>(SPOTTER_CHANNELS.configEvent, (config) => {
    currentConfig = config
    // A voice change in the Engineer/Spotter UI lands here → download it on demand.
    ensureSelectedPiperVoices(config)
  })
  offTelemetry = window.ipc.subscribe<TelemetrySnapshot | null>('telemetry:snapshot', (snapshot) => {
    processSnapshot(snapshot, currentConfig)
  })
}

function stopSubscriptions(): void {
  offConfig?.()
  offTelemetry?.()
  offConfig = null
  offTelemetry = null
}

export function useSpotterRuntime(): void {
  useEffect(() => {
    subscriberCount += 1
    if (subscriberCount === 1) startSubscriptions()
    return () => {
      subscriberCount -= 1
      if (subscriberCount === 0) {
        stopSubscriptions()
        resetTransientState()
        stopSpotterSpeech()
      }
    }
  }, [])
}
