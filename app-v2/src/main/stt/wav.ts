// Pure PCM16 → WAV (RIFF) encoder for the whisper STT subprocess. Kept in its own
// dependency-free module (no node:* beyond Buffer, no spawn) so it can be unit-tested
// directly. whisper.cpp expects a 16-bit PCM, mono, 16 kHz WAV file on disk.

/** Bytes in the canonical 44-byte PCM WAV header. */
export const WAV_HEADER_BYTES = 44

/**
 * Wrap raw little-endian 16-bit PCM mono samples in a 44-byte canonical WAV header.
 * @param pcm 16-bit little-endian PCM samples (mono).
 * @param sampleRate Sample rate in Hz (whisper wants 16000).
 */
export function encodeWavPcm16(pcm: Uint8Array, sampleRate = 16000): Buffer {
  const channels = 1
  const bitsPerSample = 16
  const blockAlign = (channels * bitsPerSample) / 8
  const byteRate = sampleRate * blockAlign
  const dataSize = pcm.length
  const buffer = Buffer.alloc(WAV_HEADER_BYTES + dataSize)

  // RIFF chunk descriptor
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8, 'ascii')

  // fmt sub-chunk
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16) // PCM fmt chunk size
  buffer.writeUInt16LE(1, 20) // audio format = PCM
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(bitsPerSample, 34)

  // data sub-chunk
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataSize, 40)
  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(buffer, WAV_HEADER_BYTES)

  return buffer
}
