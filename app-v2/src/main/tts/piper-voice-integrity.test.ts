import { describe, expect, it, vi } from 'vitest'
import {
  installTrustedVoiceFiles,
  sha256,
  trustedPiperVoiceDigest,
  voicePayloadMatchesTrustedDigest,
  type TrustedPiperVoiceDigest
} from './piper-voice-integrity'

const archive = new TextEncoder().encode('trusted archive fixture')
const onnx = new TextEncoder().encode('trusted model fixture')
const tokens = new TextEncoder().encode('trusted tokens fixture')
const trusted: TrustedPiperVoiceDigest = {
  archiveSha256: sha256(archive),
  onnxSha256: sha256(onnx),
  tokensSha256: sha256(tokens)
}

describe('pinned Piper voice integrity', () => {
  it('fails closed when a supported voice has no checked-in trusted digest', () => {
    expect(trustedPiperVoiceDigest('en_US-lessac-medium')).toBeNull()
  })

  it('rejects a structurally valid but tampered payload and wrong catalog hash', () => {
    expect(
      voicePayloadMatchesTrustedDigest(trusted, {
        archive,
        onnx: new TextEncoder().encode('tampered model fixture'),
        tokens
      })
    ).toBe(false)
    expect(
      voicePayloadMatchesTrustedDigest(
        { ...trusted, archiveSha256: '0'.repeat(64) },
        { archive, onnx, tokens }
      )
    ).toBe(false)
  })

  it('accepts a payload only when every pinned digest matches', () => {
    expect(
      voicePayloadMatchesTrustedDigest(trusted, {
        archive,
        onnx,
        tokens
      })
    ).toBe(true)
  })

  it('rolls back targets and partial files when installed bytes fail verification', async () => {
    const files = new Map<string, Uint8Array>()
    const remove = vi.fn(async (path: string) => {
      files.delete(path)
    })

    await expect(
      installTrustedVoiceFiles(
        { onnx: 'voice/model.onnx', tokens: 'voice/tokens.txt' },
        { onnx, tokens },
        trusted,
        {
          writeFile: async (path, bytes) => {
            files.set(path, bytes)
          },
          rename: async (from, to) => {
            const bytes = files.get(from)
            if (!bytes) throw new Error('missing partial')
            files.delete(from)
            files.set(to, bytes)
          },
          readFile: async (path) =>
            path.endsWith('model.onnx')
              ? new TextEncoder().encode('tampered after rename')
              : files.get(path) ?? new Uint8Array(),
          remove
        }
      )
    ).rejects.toThrow(/pinned SHA-256/)

    expect(remove).toHaveBeenCalledTimes(4)
    expect(files.size).toBe(0)
  })
})
