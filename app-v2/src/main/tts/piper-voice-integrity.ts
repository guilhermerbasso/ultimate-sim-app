import { createHash } from 'node:crypto'
import { join } from 'node:path'

export const PIPER_VOICE_METADATA_VERSION = 1
export const PIPER_VOICE_CATALOG_VERSION = 1
export const PIPER_VOICE_METADATA_FILE = 'voice-integrity.json'
export const PIPER_VOICE_MODEL_FILE = 'model.onnx'
export const PIPER_VOICE_CONFIG_FILE = 'config.json'
export const PIPER_VOICE_TOKENS_FILE = 'tokens.txt'

export interface TrustedPiperVoiceDigest {
  catalogVersion: number
  archiveSha256: string
  onnxSha256: string
  configSha256: string
  tokensSha256: string
}

export interface PiperVoiceVerificationMetadata {
  metadataVersion: number
  catalogVersion: number
  voiceId: string
  archiveSha256: string
  onnxSha256: string
  configSha256: string
  tokensSha256: string
}

// No authoritative upstream digests are checked into this repository yet.
// Downloads, repairs, userData voices, and bundled voices therefore fail closed
// until release engineering adds reviewed catalog entries.
export const TRUSTED_PIPER_VOICE_DIGESTS: Readonly<
  Record<string, TrustedPiperVoiceDigest>
> = Object.freeze({})

export function trustedPiperVoiceDigest(
  voiceId: string
): TrustedPiperVoiceDigest | null {
  return TRUSTED_PIPER_VOICE_DIGESTS[voiceId] ?? null
}

export function piperVoiceTrustSupport(voiceId: string): {
  downloadSupported: boolean
  repairSupported: boolean
  unavailableReason: string | null
} {
  const supported = trustedPiperVoiceDigest(voiceId) !== null
  return {
    downloadSupported: supported,
    repairSupported: supported,
    unavailableReason: supported
      ? null
      : `Trusted manifest unavailable for ${voiceId}.`
  }
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function createVoiceVerificationMetadata(
  voiceId: string,
  trusted: TrustedPiperVoiceDigest
): PiperVoiceVerificationMetadata {
  return {
    metadataVersion: PIPER_VOICE_METADATA_VERSION,
    catalogVersion: trusted.catalogVersion,
    voiceId,
    archiveSha256: trusted.archiveSha256,
    onnxSha256: trusted.onnxSha256,
    configSha256: trusted.configSha256,
    tokensSha256: trusted.tokensSha256
  }
}

export function voicePayloadMatchesTrustedDigest(
  trusted: TrustedPiperVoiceDigest,
  payload: {
    archive?: Uint8Array
    onnx?: Uint8Array
    config?: Uint8Array
    tokens?: Uint8Array
  }
): boolean {
  return (
    (payload.archive === undefined ||
      sha256(payload.archive) === trusted.archiveSha256) &&
    (payload.onnx === undefined ||
      sha256(payload.onnx) === trusted.onnxSha256) &&
    (payload.config === undefined ||
      sha256(payload.config) === trusted.configSha256) &&
    (payload.tokens === undefined ||
      sha256(payload.tokens) === trusted.tokensSha256)
  )
}

function isMetadata(
  value: unknown
): value is PiperVoiceVerificationMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const allowed = new Set([
    'metadataVersion',
    'catalogVersion',
    'voiceId',
    'archiveSha256',
    'onnxSha256',
    'configSha256',
    'tokensSha256'
  ])
  if (Object.keys(record).some((key) => !allowed.has(key))) return false
  return (
    record.metadataVersion === PIPER_VOICE_METADATA_VERSION &&
    Number.isInteger(record.catalogVersion) &&
    typeof record.voiceId === 'string' &&
    typeof record.archiveSha256 === 'string' &&
    typeof record.onnxSha256 === 'string' &&
    typeof record.configSha256 === 'string' &&
    typeof record.tokensSha256 === 'string'
  )
}

export interface VoiceDirectoryDependencies {
  exists(path: string): Promise<boolean>
  mkdir(path: string): Promise<void>
  writeFile(path: string, bytes: Uint8Array): Promise<void>
  readFile(path: string): Promise<Uint8Array>
  rename(from: string, to: string): Promise<void>
  remove(path: string): Promise<void>
}

export interface VoiceDirectoryVerification {
  verified: boolean
  reason: string | null
}

export interface VoiceDirectoryPayload {
  onnx: Uint8Array
  config: Uint8Array
  tokens: Uint8Array
}

const voiceDirectoryLocks = new Map<string, Promise<void>>()

async function withVoiceDirectoryLock<T>(
  key: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = voiceDirectoryLocks.get(key) ?? Promise.resolve()
  const ready = previous.catch(() => undefined)
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = ready.then(() => current)
  voiceDirectoryLocks.set(key, tail)
  await ready
  try {
    return await operation()
  } finally {
    release()
    if (voiceDirectoryLocks.get(key) === tail) {
      voiceDirectoryLocks.delete(key)
    }
  }
}

export async function verifyTrustedVoiceDirectory(
  directory: string,
  voiceId: string,
  trusted: TrustedPiperVoiceDigest | null,
  dependencies: Pick<VoiceDirectoryDependencies, 'readFile'>
): Promise<VoiceDirectoryVerification> {
  if (!trusted) {
    return {
      verified: false,
      reason: `Trusted manifest unavailable for ${voiceId}.`
    }
  }
  try {
    const rawMetadata = await dependencies.readFile(
      join(directory, PIPER_VOICE_METADATA_FILE)
    )
    const metadataValue = JSON.parse(
      new TextDecoder().decode(rawMetadata)
    ) as unknown
    if (!isMetadata(metadataValue)) {
      return {
        verified: false,
        reason: `Voice ${voiceId} has missing or invalid verification metadata.`
      }
    }
    const expectedMetadata = createVoiceVerificationMetadata(
      voiceId,
      trusted
    )
    if (
      metadataValue.metadataVersion !== expectedMetadata.metadataVersion ||
      metadataValue.catalogVersion !== expectedMetadata.catalogVersion ||
      metadataValue.voiceId !== expectedMetadata.voiceId ||
      metadataValue.archiveSha256 !== expectedMetadata.archiveSha256 ||
      metadataValue.onnxSha256 !== expectedMetadata.onnxSha256 ||
      metadataValue.configSha256 !== expectedMetadata.configSha256 ||
      metadataValue.tokensSha256 !== expectedMetadata.tokensSha256
    ) {
      return {
        verified: false,
        reason: `Voice ${voiceId} metadata does not match the pinned catalog.`
      }
    }
    const payload = {
      onnx: await dependencies.readFile(
        join(directory, PIPER_VOICE_MODEL_FILE)
      ),
      config: await dependencies.readFile(
        join(directory, PIPER_VOICE_CONFIG_FILE)
      ),
      tokens: await dependencies.readFile(
        join(directory, PIPER_VOICE_TOKENS_FILE)
      )
    }
    if (!voicePayloadMatchesTrustedDigest(trusted, payload)) {
      return {
        verified: false,
        reason: `Voice ${voiceId} files do not match pinned SHA-256 digests.`
      }
    }
    return { verified: true, reason: null }
  } catch (error) {
    return {
      verified: false,
      reason:
        error instanceof Error
          ? `Voice ${voiceId} verification failed: ${error.message}`
          : `Voice ${voiceId} verification failed.`
    }
  }
}

export async function recoverAtomicVoiceDirectory(
  root: string,
  voiceId: string,
  trusted: TrustedPiperVoiceDigest | null,
  dependencies: VoiceDirectoryDependencies
): Promise<VoiceDirectoryVerification> {
  const live = join(root, voiceId)
  return withVoiceDirectoryLock(live, () =>
    recoverAtomicVoiceDirectoryUnlocked(
      live,
      voiceId,
      trusted,
      dependencies
    )
  )
}

async function recoverAtomicVoiceDirectoryUnlocked(
  live: string,
  voiceId: string,
  trusted: TrustedPiperVoiceDigest | null,
  dependencies: VoiceDirectoryDependencies
): Promise<VoiceDirectoryVerification> {
  const staging = `${live}.staging`
  const previous = `${live}.previous`
  if (await dependencies.exists(live)) {
    const verified = await verifyTrustedVoiceDirectory(
      live,
      voiceId,
      trusted,
      dependencies
    )
    if (verified.verified) {
      await dependencies.remove(previous).catch(() => undefined)
      try {
        if (await dependencies.exists(staging)) {
          await dependencies.remove(staging)
        }
        return verified
      } catch (error) {
        return {
          verified: true,
          reason: `Voice ${voiceId} is verified, but stale staging cleanup failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        }
      }
    }
  }
  try {
    if (await dependencies.exists(staging)) {
      await dependencies.remove(staging)
    }
  } catch (error) {
    return {
      verified: false,
      reason: `Voice ${voiceId} staging recovery failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    }
  }
  if (await dependencies.exists(previous)) {
    const previousVerified = await verifyTrustedVoiceDirectory(
      previous,
      voiceId,
      trusted,
      dependencies
    )
    if (previousVerified.verified) {
      try {
        if (await dependencies.exists(live)) {
          await dependencies.remove(live)
        }
      } catch (error) {
        return {
          verified: false,
          reason: `Voice ${voiceId} previous installation is verified but the invalid live directory could not be removed: ${
            error instanceof Error ? error.message : String(error)
          }. The previous directory was preserved for retry.`
        }
      }
      if (await dependencies.exists(live)) {
        return {
          verified: false,
          reason: `Voice ${voiceId} previous installation is verified but the invalid live directory still exists. The previous directory was preserved for retry.`
        }
      }
      try {
        await dependencies.rename(previous, live)
      } catch (error) {
        return {
          verified: false,
          reason: `Voice ${voiceId} previous installation could not be restored: ${
            error instanceof Error ? error.message : String(error)
          }. The previous directory was preserved for retry.`
        }
      }
      return {
        verified: true,
        reason: `Recovered previous verified voice ${voiceId}.`
      }
    }
  }
  return {
    verified: false,
    reason: `No verified voice directory is available for ${voiceId}.`
  }
}

export async function installTrustedVoiceDirectory(
  root: string,
  voiceId: string,
  payload: VoiceDirectoryPayload,
  trusted: TrustedPiperVoiceDigest,
  dependencies: VoiceDirectoryDependencies
): Promise<void> {
  const live = join(root, voiceId)
  return withVoiceDirectoryLock(live, () =>
    installTrustedVoiceDirectoryUnlocked(
      live,
      voiceId,
      payload,
      trusted,
      dependencies
    )
  )
}

async function installTrustedVoiceDirectoryUnlocked(
  live: string,
  voiceId: string,
  payload: VoiceDirectoryPayload,
  trusted: TrustedPiperVoiceDigest,
  dependencies: VoiceDirectoryDependencies
): Promise<void> {
  const staging = `${live}.staging`
  const previous = `${live}.previous`
  let previousMoved = false
  let published = false
  try {
    if (!voicePayloadMatchesTrustedDigest(trusted, payload)) {
      throw new Error('extracted voice does not match pinned SHA-256 digests')
    }
    await dependencies.remove(staging)
    await dependencies.mkdir(staging)
    await dependencies.writeFile(
      join(staging, PIPER_VOICE_MODEL_FILE),
      payload.onnx
    )
    await dependencies.writeFile(
      join(staging, PIPER_VOICE_CONFIG_FILE),
      payload.config
    )
    await dependencies.writeFile(
      join(staging, PIPER_VOICE_TOKENS_FILE),
      payload.tokens
    )
    await dependencies.writeFile(
      join(staging, PIPER_VOICE_METADATA_FILE),
      new TextEncoder().encode(
        JSON.stringify(
          createVoiceVerificationMetadata(voiceId, trusted),
          null,
          2
        )
      )
    )
    const staged = await verifyTrustedVoiceDirectory(
      staging,
      voiceId,
      trusted,
      dependencies
    )
    if (!staged.verified) throw new Error(staged.reason ?? 'stage verification failed')

    if (await dependencies.exists(live)) {
      await dependencies.remove(previous)
      await dependencies.rename(live, previous)
      previousMoved = true
    }
    await dependencies.rename(staging, live)
    published = true
    const installed = await verifyTrustedVoiceDirectory(
      live,
      voiceId,
      trusted,
      dependencies
    )
    if (!installed.verified) {
      throw new Error(installed.reason ?? 'published verification failed')
    }
    if (previousMoved) await dependencies.remove(previous)
  } catch (error) {
    await dependencies.remove(staging).catch(() => undefined)
    if (published) await dependencies.remove(live).catch(() => undefined)
    if (
      previousMoved &&
      (await dependencies.exists(previous)) &&
      !(await dependencies.exists(live))
    ) {
      await dependencies.rename(previous, live).catch(() => undefined)
    }
    throw error
  }
}
