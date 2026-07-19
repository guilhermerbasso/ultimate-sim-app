import { createHash } from 'node:crypto'

export interface TrustedPiperVoiceDigest {
  archiveSha256: string
  onnxSha256: string
  tokensSha256: string
}

// No authoritative upstream digests are checked into this repository yet.
// Repairs therefore fail closed until release engineering pins reviewed values.
export const TRUSTED_PIPER_VOICE_DIGESTS: Readonly<
  Record<string, TrustedPiperVoiceDigest>
> = Object.freeze({})

export function trustedPiperVoiceDigest(
  voiceId: string
): TrustedPiperVoiceDigest | null {
  return TRUSTED_PIPER_VOICE_DIGESTS[voiceId] ?? null
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function voicePayloadMatchesTrustedDigest(
  trusted: TrustedPiperVoiceDigest,
  payload: {
    archive?: Uint8Array
    onnx?: Uint8Array
    tokens?: Uint8Array
  }
): boolean {
  return (
    (payload.archive === undefined ||
      sha256(payload.archive) === trusted.archiveSha256) &&
    (payload.onnx === undefined ||
      sha256(payload.onnx) === trusted.onnxSha256) &&
    (payload.tokens === undefined ||
      sha256(payload.tokens) === trusted.tokensSha256)
  )
}

export interface VoiceInstallPaths {
  onnx: string
  tokens: string
}

export interface VoiceInstallDependencies {
  writeFile(path: string, bytes: Uint8Array): Promise<void>
  rename(from: string, to: string): Promise<void>
  readFile(path: string): Promise<Uint8Array>
  remove(path: string): Promise<void>
}

export async function installTrustedVoiceFiles(
  paths: VoiceInstallPaths,
  payload: { onnx: Uint8Array; tokens: Uint8Array },
  trusted: TrustedPiperVoiceDigest,
  dependencies: VoiceInstallDependencies
): Promise<void> {
  const partialOnnx = `${paths.onnx}.part`
  const partialTokens = `${paths.tokens}.part`
  try {
    if (!voicePayloadMatchesTrustedDigest(trusted, payload)) {
      throw new Error('extracted voice does not match pinned SHA-256 digests')
    }
    await dependencies.writeFile(partialOnnx, payload.onnx)
    await dependencies.writeFile(partialTokens, payload.tokens)
    await dependencies.rename(partialOnnx, paths.onnx)
    await dependencies.rename(partialTokens, paths.tokens)
    const installed = {
      onnx: await dependencies.readFile(paths.onnx),
      tokens: await dependencies.readFile(paths.tokens)
    }
    if (!voicePayloadMatchesTrustedDigest(trusted, installed)) {
      throw new Error('installed voice does not match pinned SHA-256 digests')
    }
  } catch (error) {
    await Promise.all([
      dependencies.remove(paths.onnx),
      dependencies.remove(paths.tokens),
      dependencies.remove(partialOnnx),
      dependencies.remove(partialTokens)
    ])
    throw error
  }
}
