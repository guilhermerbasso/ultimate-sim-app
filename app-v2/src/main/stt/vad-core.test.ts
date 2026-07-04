import { describe, expect, it } from 'vitest'
import { VAD_FRAME_SIZE_16K, aggregateSpeechProbability, frameAudioForVad, pcm16ToFloat32 } from './vad-core'

describe('pcm16ToFloat32', () => {
  it('decodes little-endian PCM16 to normalized floats', () => {
    // 0, +max, -max
    const bytes = new Uint8Array(6)
    const view = new DataView(bytes.buffer)
    view.setInt16(0, 0, true)
    view.setInt16(2, 0x7fff, true)
    view.setInt16(4, -0x8000, true)
    const out = pcm16ToFloat32(bytes)
    expect(out.length).toBe(3)
    expect(out[0]).toBe(0)
    expect(out[1]).toBeCloseTo(0.99997, 4)
    expect(out[2]).toBe(-1)
  })

  it('ignores a trailing odd byte (misaligned buffer)', () => {
    const out = pcm16ToFloat32(new Uint8Array([0x00, 0x10, 0x55]))
    expect(out.length).toBe(1)
  })

  it('returns an empty array for empty input', () => {
    expect(pcm16ToFloat32(new Uint8Array(0)).length).toBe(0)
  })
})

describe('frameAudioForVad', () => {
  it('splits into fixed-size frames', () => {
    const samples = new Float32Array(VAD_FRAME_SIZE_16K * 3).fill(0.1)
    const frames = frameAudioForVad(samples)
    expect(frames.length).toBe(3)
    for (const f of frames) expect(f.length).toBe(VAD_FRAME_SIZE_16K)
  })

  it('zero-pads the final partial frame to a full window', () => {
    const samples = new Float32Array(VAD_FRAME_SIZE_16K + 10).fill(0.5)
    const frames = frameAudioForVad(samples)
    expect(frames.length).toBe(2)
    expect(frames[1].length).toBe(VAD_FRAME_SIZE_16K)
    // first 10 carried over, the rest padded with 0
    expect(frames[1][0]).toBe(0.5)
    expect(frames[1][9]).toBe(0.5)
    expect(frames[1][10]).toBe(0)
    expect(frames[1][VAD_FRAME_SIZE_16K - 1]).toBe(0)
  })

  it('returns no frames for empty input or non-positive frame size', () => {
    expect(frameAudioForVad(new Float32Array(0)).length).toBe(0)
    expect(frameAudioForVad(new Float32Array(100), 0).length).toBe(0)
  })
})

describe('aggregateSpeechProbability', () => {
  it('returns the max probability across windows', () => {
    expect(aggregateSpeechProbability([0.1, 0.92, 0.3])).toBeCloseTo(0.92, 6)
  })

  it('clamps out-of-range values into 0..1', () => {
    expect(aggregateSpeechProbability([-0.5, 1.4])).toBe(1)
    expect(aggregateSpeechProbability([-0.2, -0.9])).toBe(0)
  })

  it('returns 0 for an empty window list', () => {
    expect(aggregateSpeechProbability([])).toBe(0)
  })
})
