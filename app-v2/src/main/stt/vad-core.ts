// Pure helpers for the Silero VAD speech gate (main process). NO onnxruntime, NO fs, NO
// electron — everything here is deterministic and unit-tested (vad-core.test.ts). The
// stateful ONNX engine lives in vad.ts and imports from here.

/**
 * Silero VAD v5 consumes fixed 512-sample windows at 16 kHz (~32 ms). This is the canonical
 * frame size; feeding a different length de-syncs the model's recurrent state.
 */
export const VAD_FRAME_SIZE_16K = 512

/** Decode little-endian PCM16 bytes to normalized float32 samples (−1..1). */
export function pcm16ToFloat32(pcm: Uint8Array): Float32Array {
  // Two bytes per sample; ignore a trailing odd byte if the buffer is misaligned.
  const sampleCount = Math.floor(pcm.length / 2)
  const out = new Float32Array(sampleCount)
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  for (let i = 0; i < sampleCount; i++) {
    out[i] = view.getInt16(i * 2, true) / 0x8000
  }
  return out
}

/**
 * Split mono float samples into fixed-size frames for the VAD. The final partial frame is
 * zero-padded so the model always receives a full window. An empty/too-short input yields
 * no frames (the caller treats "no frames" as silence).
 */
export function frameAudioForVad(samples: Float32Array, frameSize = VAD_FRAME_SIZE_16K): Float32Array[] {
  if (frameSize <= 0 || samples.length === 0) return []
  const frames: Float32Array[] = []
  for (let offset = 0; offset < samples.length; offset += frameSize) {
    const end = Math.min(offset + frameSize, samples.length)
    if (end - offset === frameSize) {
      frames.push(samples.subarray(offset, end))
    } else {
      const padded = new Float32Array(frameSize)
      padded.set(samples.subarray(offset, end))
      frames.push(padded)
    }
  }
  return frames
}

/**
 * Reduce per-window speech probabilities to a single segment-level probability. We use the
 * MAX: a segment counts as speech if ANY window is confidently speech, which is exactly the
 * "should whisper run on this segment?" question (engine drone has uniformly low windows;
 * a spoken phrase has at least one high window). Empty input → 0 (silence).
 */
export function aggregateSpeechProbability(probs: number[]): number {
  if (probs.length === 0) return 0
  let max = 0
  for (const p of probs) {
    const clamped = p < 0 ? 0 : p > 1 ? 1 : p
    if (clamped > max) max = clamped
  }
  return max
}
