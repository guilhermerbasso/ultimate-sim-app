import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PIPER_VOICE_CONFIG_FILE,
  PIPER_VOICE_METADATA_FILE,
  PIPER_VOICE_MODEL_FILE,
  PIPER_VOICE_TOKENS_FILE,
  createVoiceVerificationMetadata,
  installTrustedVoiceDirectory,
  piperVoiceTrustSupport,
  recoverAtomicVoiceDirectory,
  sha256,
  trustedPiperVoiceDigest,
  verifyTrustedVoiceDirectory,
  voicePayloadMatchesTrustedDigest,
  type TrustedPiperVoiceDigest,
  type VoiceDirectoryDependencies,
  type VoiceDirectoryPayload
} from './piper-voice-integrity'

const voiceId = 'fixture-voice'
const archive = new TextEncoder().encode('trusted archive fixture')
const payload: VoiceDirectoryPayload = {
  onnx: new TextEncoder().encode('trusted model fixture'),
  config: new TextEncoder().encode('trusted config fixture'),
  tokens: new TextEncoder().encode('trusted tokens fixture')
}
const trusted: TrustedPiperVoiceDigest = {
  catalogVersion: 7,
  archiveSha256: sha256(archive),
  onnxSha256: sha256(payload.onnx),
  configSha256: sha256(payload.config),
  tokensSha256: sha256(payload.tokens)
}

class MemoryVoiceFs implements VoiceDirectoryDependencies {
  readonly directories = new Set<string>()
  readonly files = new Map<string, Uint8Array>()

  constructor(
    private readonly fail?: (
      operation: string,
      first: string,
      second?: string
    ) => boolean
  ) {}

  async exists(path: string): Promise<boolean> {
    return (
      this.directories.has(path) ||
      [...this.files].some(([file]) => file.startsWith(`${path}\\`))
    )
  }

  async mkdir(path: string): Promise<void> {
    this.maybeFail('mkdir', path)
    this.directories.add(path)
  }

  async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    this.maybeFail(`write:${basename(path)}`, path)
    this.files.set(path, new Uint8Array(bytes))
  }

  async readFile(path: string): Promise<Uint8Array> {
    this.maybeFail(`read:${basename(path)}`, path)
    const bytes = this.files.get(path)
    if (!bytes) throw new Error(`missing ${path}`)
    return new Uint8Array(bytes)
  }

  async rename(from: string, to: string): Promise<void> {
    this.maybeFail('rename', from, to)
    if (!this.directories.has(from)) throw new Error(`missing ${from}`)
    this.directories.delete(from)
    this.directories.add(to)
    const moved = [...this.files].filter(([file]) =>
      file.startsWith(`${from}\\`)
    )
    for (const [file, bytes] of moved) {
      this.files.delete(file)
      this.files.set(`${to}${file.slice(from.length)}`, bytes)
    }
  }

  async remove(path: string): Promise<void> {
    this.maybeFail('remove', path)
    this.directories.delete(path)
    for (const file of [...this.files.keys()]) {
      if (file === path || file.startsWith(`${path}\\`)) {
        this.files.delete(file)
      }
    }
  }

  seedVerified(directory: string): void {
    this.directories.add(directory)
    this.files.set(join(directory, PIPER_VOICE_MODEL_FILE), payload.onnx)
    this.files.set(join(directory, PIPER_VOICE_CONFIG_FILE), payload.config)
    this.files.set(join(directory, PIPER_VOICE_TOKENS_FILE), payload.tokens)
    this.files.set(
      join(directory, PIPER_VOICE_METADATA_FILE),
      new TextEncoder().encode(
        JSON.stringify(createVoiceVerificationMetadata(voiceId, trusted))
      )
    )
  }

  private maybeFail(
    operation: string,
    first: string,
    second?: string
  ): void {
    if (this.fail?.(operation, first, second)) {
      throw new Error(`injected ${operation} failure`)
    }
  }
}

describe('trusted existing Piper voices', () => {
  it('fails closed when a supported voice has no checked-in trusted digest', () => {
    expect(trustedPiperVoiceDigest('en_US-lessac-medium')).toBeNull()
    expect(piperVoiceTrustSupport('en_US-lessac-medium')).toEqual({
      downloadSupported: false,
      repairSupported: false,
      unavailableReason:
        'Trusted manifest unavailable for en_US-lessac-medium.'
    })
  })

  it('rejects full-size legacy files without verified metadata', async () => {
    const fs = new MemoryVoiceFs()
    const directory = join('voices', voiceId)
    fs.directories.add(directory)
    fs.files.set(join(directory, PIPER_VOICE_MODEL_FILE), payload.onnx)
    fs.files.set(join(directory, PIPER_VOICE_CONFIG_FILE), payload.config)
    fs.files.set(join(directory, PIPER_VOICE_TOKENS_FILE), payload.tokens)

    await expect(
      verifyTrustedVoiceDirectory(directory, voiceId, trusted, fs)
    ).resolves.toMatchObject({
      verified: false,
      reason: expect.stringMatching(/metadata|voice-integrity/)
    })
  })

  it('accepts verified metadata only when catalog and every file digest match', async () => {
    const fs = new MemoryVoiceFs()
    const directory = join('voices', voiceId)
    fs.seedVerified(directory)

    await expect(
      verifyTrustedVoiceDirectory(directory, voiceId, trusted, fs)
    ).resolves.toEqual({ verified: true, reason: null })
    fs.files.set(
      join(directory, PIPER_VOICE_MODEL_FILE),
      new TextEncoder().encode('tampered but structurally valid model')
    )
    await expect(
      verifyTrustedVoiceDirectory(directory, voiceId, trusted, fs)
    ).resolves.toMatchObject({
      verified: false,
      reason: expect.stringMatching(/pinned SHA-256/)
    })
  })

  it('rejects wrong catalog hashes and accepts a valid pinned fixture', () => {
    expect(
      voicePayloadMatchesTrustedDigest(trusted, {
        archive,
        ...payload
      })
    ).toBe(true)
    expect(
      voicePayloadMatchesTrustedDigest(
        { ...trusted, onnxSha256: '0'.repeat(64) },
        payload
      )
    ).toBe(false)
  })
})

describe('atomic complete Piper voice publication', () => {
  it('serializes recovery behind an active install without deleting its staging directory', async () => {
    const root = 'voices'
    const live = join(root, voiceId)
    const staging = `${live}.staging`
    const fs = new MemoryVoiceFs()
    fs.seedVerified(live)
    const originalWrite = fs.writeFile.bind(fs)
    let releaseWrite!: () => void
    let markWriteStarted!: () => void
    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve
    })
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    fs.writeFile = async (path, bytes) => {
      if (path === join(staging, PIPER_VOICE_MODEL_FILE)) {
        markWriteStarted()
        await writeGate
      }
      await originalWrite(path, bytes)
    }

    const install = installTrustedVoiceDirectory(
      root,
      voiceId,
      payload,
      trusted,
      fs
    )
    await writeStarted
    let recoverySettled = false
    const recovery = recoverAtomicVoiceDirectory(
      root,
      voiceId,
      trusted,
      fs
    ).finally(() => {
      recoverySettled = true
    })
    await Promise.resolve()

    expect(recoverySettled).toBe(false)
    expect(await fs.exists(staging)).toBe(true)

    releaseWrite()
    await install
    await expect(recovery).resolves.toMatchObject({ verified: true })
    expect(await fs.exists(staging)).toBe(false)
  })

  it.each([
    'remove-staging',
    'mkdir-staging',
    'write-model',
    'write-config',
    'write-tokens',
    'write-metadata',
    'remove-previous',
    'rename-live-to-previous',
    'rename-staging-to-live',
    'cleanup-previous'
  ])('restores the prior verified voice after %s failure', async (step) => {
    const root = 'voices'
    const live = join(root, voiceId)
    let previousRemovedOnce = false
    const fs = new MemoryVoiceFs((operation, first, second) => {
      if (step === 'remove-staging') {
        return operation === 'remove' && first.endsWith('.staging')
      }
      if (step === 'mkdir-staging') {
        return operation === 'mkdir' && first.endsWith('.staging')
      }
      if (step === 'write-model') return operation === `write:${PIPER_VOICE_MODEL_FILE}`
      if (step === 'write-config') return operation === `write:${PIPER_VOICE_CONFIG_FILE}`
      if (step === 'write-tokens') return operation === `write:${PIPER_VOICE_TOKENS_FILE}`
      if (step === 'write-metadata') return operation === `write:${PIPER_VOICE_METADATA_FILE}`
      if (step === 'remove-previous') {
        return operation === 'remove' && first.endsWith('.previous')
      }
      if (step === 'rename-live-to-previous') {
        return operation === 'rename' && first === live && second?.endsWith('.previous') === true
      }
      if (step === 'rename-staging-to-live') {
        return operation === 'rename' && first.endsWith('.staging') && second === live
      }
      if (step === 'cleanup-previous') {
        if (operation === 'remove' && first.endsWith('.previous')) {
          if (!previousRemovedOnce) {
            previousRemovedOnce = true
            return false
          }
          return true
        }
      }
      return false
    })
    fs.seedVerified(live)

    await expect(
      installTrustedVoiceDirectory(root, voiceId, payload, trusted, fs)
    ).rejects.toThrow(/injected/)
    await expect(
      verifyTrustedVoiceDirectory(live, voiceId, trusted, fs)
    ).resolves.toMatchObject({ verified: true })
  })

  it('recovers a verified .previous directory after restart and removes staging', async () => {
    const root = 'voices'
    const live = join(root, voiceId)
    const previous = `${live}.previous`
    const staging = `${live}.staging`
    const fs = new MemoryVoiceFs()
    fs.seedVerified(previous)
    fs.directories.add(staging)
    fs.files.set(join(staging, 'partial'), new Uint8Array([1]))

    await expect(
      recoverAtomicVoiceDirectory(root, voiceId, trusted, fs)
    ).resolves.toMatchObject({
      verified: true,
      reason: expect.stringMatching(/Recovered/)
    })
    expect(await fs.exists(live)).toBe(true)
    expect(await fs.exists(previous)).toBe(false)
    expect(await fs.exists(staging)).toBe(false)
  })

  it('rolls back when post-publication verification reads tampered bytes', async () => {
    const root = 'voices'
    const live = join(root, voiceId)
    const fs = new MemoryVoiceFs()
    fs.seedVerified(live)
    const originalRead = fs.readFile.bind(fs)
    let published = false
    const originalRename = fs.rename.bind(fs)
    fs.rename = async (from, to) => {
      await originalRename(from, to)
      if (from.endsWith('.staging') && to === live) published = true
    }
    fs.readFile = async (path) => {
      if (published && path === join(live, PIPER_VOICE_MODEL_FILE)) {
        return new TextEncoder().encode('tampered published model')
      }
      return originalRead(path)
    }

    await expect(
      installTrustedVoiceDirectory(root, voiceId, payload, trusted, fs)
    ).rejects.toThrow(/pinned SHA-256/)
    fs.readFile = originalRead
    await expect(
      verifyTrustedVoiceDirectory(live, voiceId, trusted, fs)
    ).resolves.toMatchObject({ verified: true })
  })

  it('restores .previous over an invalid live directory during restart recovery', async () => {
    const root = 'voices'
    const live = join(root, voiceId)
    const previous = `${live}.previous`
    const fs = new MemoryVoiceFs()
    fs.seedVerified(previous)
    fs.directories.add(live)
    fs.files.set(
      join(live, PIPER_VOICE_MODEL_FILE),
      new TextEncoder().encode('legacy full-size placeholder')
    )

    await expect(
      recoverAtomicVoiceDirectory(root, voiceId, trusted, fs)
    ).resolves.toMatchObject({ verified: true })
    expect(await fs.exists(previous)).toBe(false)
    await expect(
      verifyTrustedVoiceDirectory(live, voiceId, trusted, fs)
    ).resolves.toMatchObject({ verified: true })
  })

  it('preserves a verified previous directory when the invalid live directory cannot be removed', async () => {
    const root = 'voices'
    const live = join(root, voiceId)
    const previous = `${live}.previous`
    const fs = new MemoryVoiceFs(
      (operation, first) => operation === 'remove' && first === live
    )
    fs.seedVerified(previous)
    fs.directories.add(live)
    fs.files.set(
      join(live, PIPER_VOICE_MODEL_FILE),
      new TextEncoder().encode('invalid live model')
    )

    await expect(
      recoverAtomicVoiceDirectory(root, voiceId, trusted, fs)
    ).resolves.toMatchObject({
      verified: false,
      reason: expect.stringMatching(/preserved for retry/)
    })
    expect(await fs.exists(previous)).toBe(true)
  })
})
