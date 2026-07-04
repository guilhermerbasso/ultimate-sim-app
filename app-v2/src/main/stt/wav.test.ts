import { describe, expect, it } from 'vitest'
import { WAV_HEADER_BYTES, encodeWavPcm16 } from './wav'

describe('encodeWavPcm16', () => {
  it('prepends a 44-byte canonical PCM WAV header', () => {
    const pcm = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const wav = encodeWavPcm16(pcm, 16000)
    expect(wav.length).toBe(WAV_HEADER_BYTES + pcm.length)
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE')
    expect(wav.subarray(12, 16).toString('ascii')).toBe('fmt ')
    expect(wav.subarray(36, 40).toString('ascii')).toBe('data')
  })

  it('writes the correct PCM/mono/16k fmt fields', () => {
    const pcm = new Uint8Array(320) // 160 samples
    const wav = encodeWavPcm16(pcm, 16000)
    expect(wav.readUInt32LE(4)).toBe(36 + pcm.length) // RIFF chunk size
    expect(wav.readUInt32LE(16)).toBe(16) // fmt chunk size
    expect(wav.readUInt16LE(20)).toBe(1) // PCM
    expect(wav.readUInt16LE(22)).toBe(1) // mono
    expect(wav.readUInt32LE(24)).toBe(16000) // sample rate
    expect(wav.readUInt32LE(28)).toBe(32000) // byte rate = 16000 * 1 * 2
    expect(wav.readUInt16LE(32)).toBe(2) // block align
    expect(wav.readUInt16LE(34)).toBe(16) // bits per sample
    expect(wav.readUInt32LE(40)).toBe(pcm.length) // data size
  })

  it('copies the PCM payload verbatim after the header', () => {
    const pcm = new Uint8Array([10, 20, 30, 40])
    const wav = encodeWavPcm16(pcm, 16000)
    expect(Array.from(wav.subarray(WAV_HEADER_BYTES))).toEqual([10, 20, 30, 40])
  })

  it('honors a custom sample rate', () => {
    const wav = encodeWavPcm16(new Uint8Array(4), 8000)
    expect(wav.readUInt32LE(24)).toBe(8000)
    expect(wav.readUInt32LE(28)).toBe(16000) // 8000 * 2
  })
})
