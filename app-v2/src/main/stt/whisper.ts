// whisper.cpp subprocess manager for OFFLINE STT — main process ONLY.
//
// Locates the BUNDLED whisper-cli binary (resources/whisper/, mirroring tts/piper.ts),
// writes a captured PCM16 16 kHz mono chunk to a temp WAV, runs the binary CPU-only and
// parses the transcript. Gates on binary + model presence: when either is absent it
// throws a typed `SttUnavailableError` so callers can degrade to "inactive" cleanly.
//
// RESOURCE-MINIMAL GUARANTEES:
//   • ON-DEMAND      — the binary only runs when transcribe() is called (the renderer's
//     VAD ensures that is only when the user is actually speaking — never a hot loop).
//   • SINGLE-FLIGHT  — every transcription is serialized through a promise queue so two
//     whisper processes never run at once (would spike CPU).
//   • CPU-ONLY       — no GPU flags; the sim owns the GPU.
//   • CLEANUP        — the temp WAV + txt are always removed.

import { existsSync } from 'node:fs'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { encodeWavPcm16 } from './wav'
import type { WhisperModelManager } from './whisper-model'
import type { SttModelId } from '../../shared/stt-ipc'

const TEMP_DIR_NAME = 'whisper-stt'
const WHISPER_RES_DIR = 'whisper'
// 16 kHz mono PCM16 is the canonical whisper.cpp input.
const SAMPLE_RATE = 16000
// A whisper process should never run longer than this for a short utterance.
const TRANSCRIBE_TIMEOUT_MS = 30_000

/** Candidate binary names — whisper.cpp ≥ v1.7 ships `whisper-cli`; older builds `main`. */
function binaryCandidates(): string[] {
  return process.platform === 'win32' ? ['whisper-cli.exe', 'main.exe'] : ['whisper-cli', 'main']
}

export class SttUnavailableError extends Error {
  constructor(
    readonly reason: 'binary-missing' | 'model-missing',
    message: string
  ) {
    super(message)
    this.name = 'SttUnavailableError'
  }
}

function getEngineDir(): string {
  // In dev `process.resourcesPath` points at electron's resources; the bundled folder
  // is only present in a packaged build (populated by scripts/fetch-win-whisper.sh).
  return join(process.resourcesPath, WHISPER_RES_DIR)
}

/** Absolute path of the first bundled whisper binary that exists, or null. */
export function resolveWhisperBinary(): string | null {
  const dir = getEngineDir()
  for (const name of binaryCandidates()) {
    const candidate = join(dir, name)
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      // ignore and try the next candidate
    }
  }
  return null
}

export function isWhisperBinaryPresent(): boolean {
  return resolveWhisperBinary() !== null
}

export interface TranscribeOptions {
  language?: string
}

export interface WhisperEngineDeps {
  models: WhisperModelManager
  /** Override the binary resolver (tests). */
  resolveBinary?: () => string | null
  /** Override the temp dir (defaults to userData/whisper-stt). */
  tempDir: string
  /** Override the subprocess runner (tests inject a fake). */
  runProcess?: (bin: string, args: string[]) => Promise<{ code: number; stderr: string }>
}

const defaultRunProcess = (bin: string, args: string[]): Promise<{ code: number; stderr: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderrBuf = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('whisper transcription timed out'))
    }, TRANSCRIBE_TIMEOUT_MS)
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString()
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stderr: stderrBuf })
    })
  })

export class WhisperEngine {
  private readonly models: WhisperModelManager
  private readonly resolveBinary: () => string | null
  private readonly tempDir: string
  private readonly runProcess: (bin: string, args: string[]) => Promise<{ code: number; stderr: string }>
  // Single-flight: chain transcriptions so only one whisper process runs at a time.
  private queue: Promise<unknown> = Promise.resolve()

  constructor(deps: WhisperEngineDeps) {
    this.models = deps.models
    this.resolveBinary = deps.resolveBinary ?? resolveWhisperBinary
    this.tempDir = deps.tempDir
    this.runProcess = deps.runProcess ?? defaultRunProcess
  }

  /** True only when the bundled binary AND the given model are both present on disk. */
  isAvailable(model: SttModelId): boolean {
    return this.resolveBinary() !== null && this.models.isModelPresent(model)
  }

  /**
   * Transcribe a captured PCM16 16 kHz mono buffer to text. Single-flight: serialized
   * through an internal queue. Throws SttUnavailableError when binary/model are absent.
   */
  transcribe(pcm: Uint8Array, model: SttModelId, options?: TranscribeOptions): Promise<string> {
    const run = this.queue.then(
      () => this.transcribeNow(pcm, model, options),
      () => this.transcribeNow(pcm, model, options)
    )
    // Keep the queue alive even if this transcription rejects.
    this.queue = run.catch(() => undefined)
    return run
  }

  private async transcribeNow(pcm: Uint8Array, model: SttModelId, options?: TranscribeOptions): Promise<string> {
    const bin = this.resolveBinary()
    if (!bin) throw new SttUnavailableError('binary-missing', 'whisper binary not bundled on this host')
    const modelPath = this.models.modelPath(model)
    if (!this.models.isModelPresent(model)) {
      throw new SttUnavailableError('model-missing', `whisper ggml model not present: ${model}`)
    }

    const id = randomUUID()
    const wavPath = join(this.tempDir, `cap-${id}.wav`)
    // whisper writes `<outBase>.txt`; pass the base WITHOUT extension via `-of`.
    const outBase = join(this.tempDir, `cap-${id}`)
    const txtPath = `${outBase}.txt`
    const lang = options?.language && options.language.trim().length > 0 ? options.language.trim() : 'auto'

    try {
      await mkdir(this.tempDir, { recursive: true })
      await writeFile(wavPath, encodeWavPcm16(pcm, SAMPLE_RATE))

      const args = [
        '-m',
        modelPath,
        '-f',
        wavPath,
        '-l',
        lang,
        '-otxt', // emit a plain .txt transcript
        '-of',
        outBase,
        '-nt', // no timestamps in the output
        '-np' // no progress prints to stdout/stderr
      ]
      const { code, stderr } = await this.runProcess(bin, args)
      if (code !== 0) throw new Error(`whisper exited ${code}: ${stderr.trim()}`)

      const raw = await readFile(txtPath, 'utf8').catch(() => '')
      return cleanTranscript(raw)
    } finally {
      void unlink(wavPath).catch(() => undefined)
      void unlink(txtPath).catch(() => undefined)
    }
  }
}

/**
 * Normalize a raw whisper `.txt` transcript: collapse whitespace/newlines and strip the
 * bracketed non-speech markers whisper emits on silence (e.g. "[BLANK_AUDIO]", "(música)").
 * Pure — exported for unit testing.
 */
export function cleanTranscript(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]/g, ' ') // [BLANK_AUDIO], [Music], …
    .replace(/\((?:music|música|aplausos|applause|silence|silêncio)\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
