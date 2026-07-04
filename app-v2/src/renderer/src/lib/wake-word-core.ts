// Pure helper math for the "Oi, Engenheiro" wake-word engine. NO DOM, NO React, NO
// window — everything here is deterministic and unit-tested (wake-word-core.test.ts).
// The stateful engine + audio plumbing live in wake-word.ts and import from here.

// ─── Text normalization + fuzzy wake-word matching ─────────────────────────────

/**
 * Normalize text for accent- and case-insensitive matching: lowercase, strip diacritics
 * (NFD + remove combining marks), drop punctuation, collapse whitespace. So
 * "Oi, Engenheiro!" → "oi engenheiro" and "ô engenheiro" → "o engenheiro".
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // drop punctuation/symbols
    .replace(/\s+/g, ' ')
    .trim()
}

/** Classic Levenshtein edit distance between two strings. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let prev = new Array<number>(b.length + 1)
  let curr = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[b.length]
}

export interface WakeWordMatch {
  matched: boolean
  /** The wake phrase that matched (original form from the list), when matched. */
  matchedWord?: string
  /** Edit distance of the best match (lower = better). */
  distance?: number
  /** Any text that followed the wake word in the SAME utterance (a same-breath question). */
  trailing?: string
}

export interface WakeWordMatchOptions {
  /** Max total edit distance allowed across the phrase (tiny-whisper isn't perfect). */
  maxDistance?: number
}

const NO_MATCH: WakeWordMatch = { matched: false }

/**
 * Fuzzy-match any of `wakeWords` inside a transcript, accent/case-insensitively and
 * tolerant of a small edit distance. Scans every window of N tokens (N = the wake
 * phrase's word count) so the wake word can appear anywhere in the utterance. Returns
 * the best (lowest-distance) match plus any trailing text after it (a same-breath
 * question like "oi engenheiro, quanto combustível tenho?").
 */
export function fuzzyWakeWordMatch(transcript: string, wakeWords: string[], options?: WakeWordMatchOptions): WakeWordMatch {
  const norm = normalizeForMatch(transcript)
  if (norm.length === 0) return NO_MATCH
  const tokens = norm.split(' ')

  let best: WakeWordMatch = NO_MATCH

  for (const phrase of wakeWords) {
    const target = normalizeForMatch(phrase)
    if (target.length === 0) continue
    const targetWords = target.split(' ')
    const span = targetWords.length
    // Allow distance to scale with phrase length, but cap small so noise never matches.
    const budget = options?.maxDistance ?? Math.max(1, Math.floor(target.length * 0.25))

    for (let i = 0; i + span <= tokens.length; i++) {
      const windowTokens = tokens.slice(i, i + span)
      const window = windowTokens.join(' ')
      const dist = levenshtein(window, target)
      if (dist <= budget && (!best.matched || dist < (best.distance ?? Infinity))) {
        const trailing = tokens.slice(i + span).join(' ').trim()
        best = { matched: true, matchedWord: phrase, distance: dist, trailing: trailing.length > 0 ? trailing : undefined }
        if (dist === 0) break
      }
    }
  }

  return best
}

// ─── Energy-based VAD (voice activity detection) ───────────────────────────────

/** Root-mean-square energy of a frame of normalized float samples (−1..1). */
export function rmsOf(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

/** A frame counts as speech when its RMS energy crosses the threshold. */
export function isSpeechFrame(rms: number, threshold: number): boolean {
  return rms >= threshold
}

export interface VadConfig {
  /** RMS energy above which a frame is "speech". */
  threshold: number
  /** Consecutive speech frames required to OPEN a segment (debounces clicks). */
  openFrames: number
  /** Consecutive silence frames required to CLOSE a segment (hangover). */
  hangoverFrames: number
}

export const DEFAULT_VAD_CONFIG: VadConfig = {
  threshold: 0.012,
  openFrames: 2,
  hangoverFrames: 12
}

export interface VadState {
  /** Whether a speech segment is currently open. */
  active: boolean
  /** Run-length of consecutive speech frames while closed (toward openFrames). */
  speechRun: number
  /** Run-length of consecutive silence frames while open (toward hangoverFrames). */
  silenceRun: number
}

export const INITIAL_VAD_STATE: VadState = { active: false, speechRun: 0, silenceRun: 0 }

export type VadEvent = 'none' | 'segment-start' | 'segment-end'

export interface VadStep {
  state: VadState
  event: VadEvent
}

/**
 * Advance the VAD one frame. Pure: returns the next state + an edge event
 * ('segment-start' when a segment opens, 'segment-end' when it closes). The caller
 * accumulates samples between start and end and ships that segment to whisper — so
 * whisper NEVER runs in a hot loop, only on a completed speech segment.
 */
export function stepVad(prev: VadState, rms: number, config: VadConfig): VadStep {
  const speech = isSpeechFrame(rms, config.threshold)
  if (!prev.active) {
    const speechRun = speech ? prev.speechRun + 1 : 0
    if (speechRun >= config.openFrames) {
      return { state: { active: true, speechRun: 0, silenceRun: 0 }, event: 'segment-start' }
    }
    return { state: { active: false, speechRun, silenceRun: 0 }, event: 'none' }
  }
  // Segment open: count silence toward the hangover that closes it.
  const silenceRun = speech ? 0 : prev.silenceRun + 1
  if (silenceRun >= config.hangoverFrames) {
    return { state: { active: false, speechRun: 0, silenceRun: 0 }, event: 'segment-end' }
  }
  return { state: { active: true, speechRun: 0, silenceRun }, event: 'none' }
}

// ─── ONNX VAD speech gate (decision logic) ─────────────────────────────────────
//
// The energy VAD above is a CHEAP pre-filter that decides WHEN to capture a segment. The
// main process then runs a tiny Silero VAD ONNX net on that segment and returns a speech
// PROBABILITY (or null when the model/addon is absent). These helpers decide whether to
// spend whisper on the segment — pure so the gating is unit-tested without any audio.

export interface VadGateConfig {
  /** Speech probability (0..1) at or above which the segment is sent to whisper. */
  threshold: number
}

// 0.5 is Silero's canonical speech/non-speech operating point. The energy VAD already
// rejects silence, so this mainly suppresses non-speech noise that tripped the RMS gate.
export const DEFAULT_VAD_GATE_CONFIG: VadGateConfig = {
  threshold: 0.5
}

/**
 * Decide whether a captured segment should be transcribed by whisper.
 *
 * `probability === null` means the ONNX gate is UNAVAILABLE (model or onnxruntime-node
 * absent, or an inference error). In that case we FALL BACK to today's whisper-always-on
 * behaviour and return `true` — a missing gate must never silence the wake word. When a
 * probability is present, the segment passes only when it meets the threshold.
 */
export function passesVadGate(probability: number | null | undefined, config: VadGateConfig = DEFAULT_VAD_GATE_CONFIG): boolean {
  if (probability === null || probability === undefined || !Number.isFinite(probability)) return true
  return probability >= config.threshold
}

// ─── Downsampling + PCM16 conversion ───────────────────────────────────────────

/** Expected sample count after resampling `inputLen` frames from `inputRate` to `targetRate`. */
export function downsampledLength(inputLen: number, inputRate: number, targetRate = 16000): number {
  if (inputLen <= 0 || inputRate <= 0 || targetRate <= 0) return 0
  if (inputRate === targetRate) return inputLen
  return Math.max(0, Math.floor(inputLen * (targetRate / inputRate)))
}

/**
 * Linear-interpolation downsample of mono float samples (−1..1) to `targetRate`.
 * whisper.cpp wants 16 kHz; browser AudioContext is typically 44.1/48 kHz.
 */
export function downsampleTo16k(input: Float32Array, inputRate: number, targetRate = 16000): Float32Array {
  if (inputRate === targetRate || input.length === 0) return input
  const outLen = downsampledLength(input.length, inputRate, targetRate)
  const out = new Float32Array(outLen)
  const ratio = inputRate / targetRate
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const idx = Math.floor(pos)
    const frac = pos - idx
    const a = input[idx] ?? 0
    const b = input[idx + 1] ?? a
    out[i] = a + (b - a) * frac
  }
  return out
}

/** Convert normalized float samples (−1..1) to little-endian PCM16 bytes. */
export function floatToPcm16(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2)
  const view = new DataView(out.buffer)
  for (let i = 0; i < samples.length; i++) {
    let s = samples[i]
    s = s < -1 ? -1 : s > 1 ? 1 : s
    view.setInt16(i * 2, Math.round(s * 0x7fff), true)
  }
  return out
}

/** One-shot: downsample mono float audio to 16 kHz and pack it as PCM16 bytes for whisper. */
export function toWhisperPcm16(input: Float32Array, inputRate: number): Uint8Array {
  return floatToPcm16(downsampleTo16k(input, inputRate, 16000))
}
