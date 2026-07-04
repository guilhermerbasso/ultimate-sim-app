// "Oi, Engenheiro" wake-word engine (renderer) + the global useWakeWord() hook.
//
// Mounts like useSpotterRuntime() (App.tsx): a single shared engine refcounted across
// mounts. It is OFFLINE and on-demand by design:
//   1. Request the mic via getUserMedia (permission denial → INACTIVE, never a crash).
//   2. Run a lightweight ENERGY-BASED VAD over the mic frames (ScriptProcessor) so we
//      only act on actual speech SEGMENTS — whisper NEVER runs in a hot loop.
//   3. On a completed segment: downsample → PCM16 16k → stt:transcribe (offline whisper).
//   4. Fuzzy-match the wake word in the transcript (accent/case-insensitive). Once heard,
//      capture the NEXT segment as the question (or a same-breath trailing question) and
//      invoke engineer:ask — the existing AI engineer answers + speaks. We never
//      reimplement answering.
//   5. Cooldown/debounce avoids repeat triggers.
//
// All pure math (VAD, downsample, fuzzy match) lives in wake-word-core.ts (unit-tested).

import { useEffect } from 'react'
import { ENGINEER_CHANNELS } from '../../../shared/engineer-ipc'
import { isTtsSpeaking } from './tts-runtime'
import {
  DEFAULT_STT_CONFIG,
  STT_CHANNELS,
  type SttConfig,
  type SttModelId,
  type SttModelProgress,
  type SttStatus,
  type SttVadResult
} from '../../../shared/stt-ipc'
import {
  DEFAULT_VAD_CONFIG,
  INITIAL_VAD_STATE,
  fuzzyWakeWordMatch,
  passesVadGate,
  rmsOf,
  stepVad,
  toWhisperPcm16,
  type VadState
} from './wake-word-core'

// ─── Status store (drives WakeWordIndicator) ───────────────────────────────────

export type WakeWordStatus =
  | 'inactive' // disabled in config, or whisper not available
  | 'denied' // mic permission denied / unavailable
  | 'listening' // mic open, waiting for the wake word
  | 'heard' // wake word recognized, capturing the question
  | 'processing' // transcribing / asking the engineer

export interface WakeWordState {
  status: WakeWordStatus
  /** Whether the bundled whisper binary + active model are present (transcription possible). */
  available: boolean
  /** Last recognized wake phrase (for a subtle UI hint). */
  lastWake?: string
}

let state: WakeWordState = { status: 'inactive', available: false }
const listeners = new Set<(s: WakeWordState) => void>()

function setState(patch: Partial<WakeWordState>): void {
  state = { ...state, ...patch }
  for (const fn of listeners) {
    try {
      fn(state)
    } catch {
      // a bad UI listener must never break the engine
    }
  }
}

export function getWakeWordState(): WakeWordState {
  return state
}

export function subscribeWakeWordState(callback: (s: WakeWordState) => void): () => void {
  listeners.add(callback)
  callback(state)
  return () => {
    listeners.delete(callback)
  }
}

/** Ask main to download the active ggml model on demand (UI-initiated). */
export function ensureSttModel(model?: SttModelId): Promise<unknown> {
  return window.ipc.invoke(STT_CHANNELS.ensureModel, model)
}

export function subscribeSttModelProgress(callback: (p: SttModelProgress) => void): () => void {
  return window.ipc.subscribe<SttModelProgress>(STT_CHANNELS.modelProgress, callback)
}

/**
 * Ask main to download the Silero VAD ONNX speech gate (~1.8 MB) on demand (UI-initiated).
 * The gate is OPTIONAL: while it (or onnxruntime-node) is absent the wake word keeps working
 * via whisper-always-on; once present, whisper is gated behind confirmed speech (CPU win).
 */
export function ensureVadModel(): Promise<unknown> {
  return window.ipc.invoke(STT_CHANNELS.vadEnsureModel)
}

// ─── Engine ─────────────────────────────────────────────────────────────────────

// Hard cap on a single speech segment (s). Prevents an open-mic room tone from
// accumulating an unbounded buffer before whisper ever runs.
const MAX_SEGMENT_SECONDS = 12
// After an engineer:ask, ignore audio briefly so the spoken answer / echo doesn't retrigger.
const COOLDOWN_MS = 2000
// How long we stay "armed" waiting for the question segment after hearing the wake word.
const ARM_TIMEOUT_MS = 8000
// A captured segment shorter than this (s) is ignored as a click/noise.
const MIN_SEGMENT_SECONDS = 0.2

interface AudioContextWindow extends Window {
  webkitAudioContext?: typeof AudioContext
}

let subscriberCount = 0
let started = false

let config: SttConfig = DEFAULT_STT_CONFIG
let available = false

let mediaStream: MediaStream | null = null
let audioContext: AudioContext | null = null
let sourceNode: MediaStreamAudioSourceNode | null = null
let processorNode: ScriptProcessorNode | null = null
let offStatus: (() => void) | null = null

let vad: VadState = INITIAL_VAD_STATE
let segment: Float32Array[] = []
let segmentSamples = 0
let sampleRate = 48000

let armed = false
let armTimer: ReturnType<typeof setTimeout> | null = null
let cooldownUntil = 0
let busy = false
// In-flight guard for openMic: `audioContext` is only assigned AFTER the getUserMedia
// await, so without this a second reconcile() (e.g. the boot statusEvent) would pass
// the `!audioContext` guard and open the mic twice — leaking the first stream/context.
let opening = false

function clearArm(): void {
  if (armTimer) {
    clearTimeout(armTimer)
    armTimer = null
  }
  armed = false
}

function resetSegment(): void {
  segment = []
  segmentSamples = 0
  vad = INITIAL_VAD_STATE
}

function concatSegment(): Float32Array {
  const out = new Float32Array(segmentSamples)
  let offset = 0
  for (const chunk of segment) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

async function startEngine(): Promise<void> {
  if (started) return
  started = true
  resetSegment()

  // Pull config + availability first (so a disabled/unavailable feature never opens the mic).
  try {
    config = await window.ipc.invoke<SttConfig>(STT_CHANNELS.getConfig)
  } catch {
    config = DEFAULT_STT_CONFIG
  }
  try {
    const status = await window.ipc.invoke<SttStatus>(STT_CHANNELS.status)
    available = status.available
  } catch {
    available = false
  }

  offStatus = window.ipc.subscribe<SttStatus>(STT_CHANNELS.statusEvent, (status) => {
    config = status.config
    available = status.available
    setState({ available })
    void reconcile()
  })

  await reconcile()
}

// Open or close the mic to match the current enabled flag. Availability is NOT required
// to open the mic — but with no model every transcript is '' so nothing triggers; we
// still gate to avoid pointless capture.
async function reconcile(): Promise<void> {
  if (!started) return
  const shouldRun = config.enabled && available
  if (shouldRun && !audioContext && !opening) {
    await openMic()
  } else if (!shouldRun && audioContext) {
    closeMic()
    setState({ status: 'inactive' })
  }
}

async function openMic(): Promise<void> {
  // In-flight + already-open guard (see `opening` above): prevents a duplicate mic
  // open (leaked stream/context + corrupted VAD) when reconcile() runs twice.
  if (opening || audioContext) return
  opening = true
  try {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined
    if (!nav?.mediaDevices?.getUserMedia) {
      setState({ status: 'denied' })
      return
    }
    let stream: MediaStream
    try {
      stream = await nav.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      })
    } catch {
      // Permission denied or no device → INACTIVE, no crash.
      setState({ status: 'denied' })
      return
    }

    // The feature may have been disabled/torn down DURING the getUserMedia await —
    // don't leave the mic open.
    if (!started || !config.enabled || !available) {
      for (const track of stream.getTracks()) track.stop()
      setState({ status: 'inactive' })
      return
    }

    const AudioCtor = window.AudioContext ?? (window as AudioContextWindow).webkitAudioContext
    if (!AudioCtor) {
      for (const track of stream.getTracks()) track.stop()
      setState({ status: 'denied' })
      return
    }

    mediaStream = stream
    audioContext = new AudioCtor()
    sampleRate = audioContext.sampleRate
    sourceNode = audioContext.createMediaStreamSource(mediaStream)
    // ScriptProcessor is deprecated but ubiquitous and dependency-free; 4096-sample frames
    // (~85 ms @48k) are a good VAD granularity.
    processorNode = audioContext.createScriptProcessor(4096, 1, 1)
    processorNode.onaudioprocess = (event) => {
      void onAudioFrame(event.inputBuffer.getChannelData(0))
    }
    sourceNode.connect(processorNode)
    // ScriptProcessor only fires while connected to a destination; route through a muted
    // gain so we never play the mic back.
    const sink = audioContext.createGain()
    sink.gain.value = 0
    processorNode.connect(sink)
    sink.connect(audioContext.destination)

    resetSegment()
    clearArm()
    setState({ status: 'listening' })
  } finally {
    opening = false
  }
}

function closeMic(): void {
  try {
    processorNode?.disconnect()
    sourceNode?.disconnect()
  } catch {
    // ignore teardown races
  }
  if (processorNode) processorNode.onaudioprocess = null
  void audioContext?.close().catch(() => undefined)
  for (const track of mediaStream?.getTracks() ?? []) track.stop()
  processorNode = null
  sourceNode = null
  audioContext = null
  mediaStream = null
  clearArm()
  resetSegment()
}

async function onAudioFrame(frame: Float32Array): Promise<void> {
  if (Date.now() < cooldownUntil) return
  // Never transcribe the engineer's OWN voice: proactive call-outs + spoken answers
  // are default-ON, so while TTS is playing we drop mic frames (relying on AEC alone
  // is unreliable). Reset any partial segment so we don't capture the tail.
  if (isTtsSpeaking()) {
    if (segment.length > 0) resetSegment()
    return
  }

  const rms = rmsOf(frame)
  const { state: nextVad, event } = stepVad(vad, rms, DEFAULT_VAD_CONFIG)
  vad = nextVad

  if (event === 'segment-start') {
    segment = []
    segmentSamples = 0
  }

  if (nextVad.active) {
    // Copy: the underlying AudioBuffer is reused across callbacks.
    segment.push(Float32Array.from(frame))
    segmentSamples += frame.length
    // Force-close an over-long segment so whisper still runs on a bounded buffer.
    if (segmentSamples >= sampleRate * MAX_SEGMENT_SECONDS) {
      vad = INITIAL_VAD_STATE
      await handleSegment()
    }
    return
  }

  if (event === 'segment-end') {
    await handleSegment()
  }
}

async function handleSegment(): Promise<void> {
  const samples = segmentSamples
  if (samples < sampleRate * MIN_SEGMENT_SECONDS || busy) {
    resetSegment()
    return
  }
  const audio = concatSegment()
  resetSegment()
  busy = true
  setState({ status: 'processing' })
  try {
    const pcm = toWhisperPcm16(audio, sampleRate)
    // CHEAP ONNX speech gate BEFORE whisper: only spend the heavy whisper subprocess when
    // the tiny Silero VAD confirms human speech. When the gate is unavailable (no model /
    // onnxruntime-node, or disabled) vadAllowsWhisper() returns true → fall back to today's
    // whisper-always-on behaviour (no regression).
    if (!(await vadAllowsWhisper(pcm))) return
    const text = await window.ipc.invoke<string>(STT_CHANNELS.transcribe, pcm.buffer, { language: config.language })
    await routeTranscript(typeof text === 'string' ? text : '')
  } catch {
    // transcription failed → just go back to listening
  } finally {
    busy = false
    if (audioContext) setState({ status: armed ? 'heard' : 'listening' })
  }
}

// Run the main-process Silero VAD gate over the captured PCM16. Returns whether whisper
// should run. NEVER throws and NEVER blocks the wake word when the gate is unavailable:
// any error or an `available: false` result falls back to whisper-always-on.
async function vadAllowsWhisper(pcm: Uint8Array): Promise<boolean> {
  try {
    const result = await window.ipc.invoke<SttVadResult>(STT_CHANNELS.vadDetect, pcm.buffer)
    const probability = result && result.available ? result.probability : null
    return passesVadGate(probability)
  } catch {
    return true
  }
}

async function routeTranscript(text: string): Promise<void> {
  const clean = text.trim()
  if (clean.length === 0) return

  if (armed) {
    // We already heard the wake word; THIS segment is the question.
    clearArm()
    await askEngineer(clean)
    return
  }

  const match = fuzzyWakeWordMatch(clean, config.wakeWords)
  if (!match.matched) return

  setState({ lastWake: match.matchedWord })
  if (match.trailing && match.trailing.length >= 3) {
    // Same-breath question ("oi engenheiro, quanto combustível tenho?") → ask immediately.
    await askEngineer(match.trailing)
    return
  }
  // Wake word alone → arm and wait for the next spoken segment as the question.
  armed = true
  setState({ status: 'heard' })
  if (armTimer) clearTimeout(armTimer)
  armTimer = setTimeout(() => {
    clearArm()
    if (audioContext) setState({ status: 'listening' })
  }, ARM_TIMEOUT_MS)
}

async function askEngineer(question: string): Promise<void> {
  cooldownUntil = Date.now() + COOLDOWN_MS
  try {
    // The existing AI engineer handles answering + speaking; payload is the question text.
    await window.ipc.invoke(ENGINEER_CHANNELS.ask, question)
  } catch {
    // engineer disabled / busy — nothing to do; we just resume listening
  } finally {
    if (audioContext) setState({ status: 'listening' })
  }
}

function stopEngine(): void {
  started = false
  offStatus?.()
  offStatus = null
  closeMic()
  cooldownUntil = 0
  busy = false
  setState({ status: 'inactive' })
}

/**
 * Mount the global wake-word engine. Call ONCE near the app root (like
 * useSpotterRuntime()). Refcounted: the engine starts on the first mount and tears down
 * on the last unmount.
 */
export function useWakeWord(): void {
  useEffect(() => {
    subscriberCount += 1
    if (subscriberCount === 1) void startEngine()
    return () => {
      subscriberCount -= 1
      if (subscriberCount === 0) stopEngine()
    }
  }, [])
}
