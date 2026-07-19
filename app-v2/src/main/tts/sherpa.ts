// sherpa-onnx TTS engine — the neural synth backend.
//
// Replaces the old piper.exe, which hard-crashed (0xC0000005 ACCESS_VIOLATION) on
// many Windows CPUs (CPU / onnxruntime / DLL mismatch), making tts:synth return
// null for EVERY voice. sherpa-onnx statically links onnxruntime and is far more
// robust across CPUs. This module owns the engine specifics; the IPC wiring +
// download orchestration live in piper.ts (which keeps the `register` export and
// the tts:* channel names for back-compat).
//
// This file has NO Electron dependency so it can be unit-tested under plain Node.

import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, sep as pathSep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { logger } from '../modules/logger'

const nativeRequire = createRequire(import.meta.url)

// ─────────────────────────────────────────────────────────────────────────────
// WAV encoding (PURE) — Float32 [-1,1] mono → 16-bit PCM WAV Buffer.
//
// sherpa's OfflineTts.generate() returns { samples: Float32Array, sampleRate }.
// We build the 44-byte canonical WAV header + PCM data directly (no temp file, no
// disk round-trip), which is both faster and more robust than sherpa's writeWave.
// ─────────────────────────────────────────────────────────────────────────────

export function encodeWavFromFloat32(samples: Float32Array, sampleRate: number): Buffer {
  const numFrames = samples.length
  const bytesPerSample = 2
  const blockAlign = bytesPerSample // 1 channel (mono)
  const byteRate = sampleRate * blockAlign
  const dataSize = numFrames * bytesPerSample
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16) // PCM fmt chunk size
  buffer.writeUInt16LE(1, 20) // audio format = PCM
  buffer.writeUInt16LE(1, 22) // channels = mono
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(16, 34) // bits per sample
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataSize, 40)

  let offset = 44
  for (let i = 0; i < numFrames; i++) {
    let s = samples[i]
    if (s > 1) s = 1
    else if (s < -1) s = -1
    // Asymmetric scale: negative → 0x8000, positive → 0x7FFF (full-scale 16-bit).
    const v = s < 0 ? s * 0x8000 : s * 0x7fff
    buffer.writeInt16LE(v | 0, offset)
    offset += 2
  }
  return buffer
}

// ─────────────────────────────────────────────────────────────────────────────
// .tar / .tar.bz2 extraction (PURE-ish) — pulls model.onnx + tokens.txt out of a
// sherpa-onnx voice bundle WITHOUT shelling out, so it works at runtime on any OS.
//
// Node has no built-in bzip2, so we use `seek-bzip` (pure JS, MIT) to inflate the
// bzip2 stream, then a minimal POSIX/ustar tar reader to pick the two files we
// need. The bundle also ships an espeak-ng-data/ dir, which we IGNORE here — it is
// bundled ONCE (shared) in resources, so we don't pay it per voice.
// ─────────────────────────────────────────────────────────────────────────────

/** Parse a (decompressed) tar archive into a map of entry-name → file bytes. */
export function parseTarEntries(tar: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>()
  let offset = 0
  while (offset + 512 <= tar.length) {
    // A header block of all-zero bytes marks the end of the archive.
    const name = readTarString(tar, offset, 100)
    if (name === '') break

    const prefix = readTarString(tar, offset + 345, 155)
    const fullName = prefix ? `${prefix}/${name}` : name
    const size = parseInt(readTarString(tar, offset + 124, 12).trim() || '0', 8) || 0
    const typeFlag = String.fromCharCode(tar[offset + 156])
    offset += 512

    // typeFlag '0' or '\0' (NUL) → a regular file. Skip directories / others.
    if (typeFlag === '0' || typeFlag === '\u0000') {
      entries.set(fullName, tar.subarray(offset, offset + size))
    }
    // Each entry's data is padded up to a 512-byte boundary.
    offset += Math.ceil(size / 512) * 512
  }
  return entries
}

function readTarString(buf: Buffer, start: number, length: number): string {
  let end = start
  const limit = start + length
  while (end < limit && buf[end] !== 0) end++
  return buf.toString('utf8', start, end)
}

export interface ExtractedVoiceFiles {
  onnx: Buffer
  config: Buffer
  tokens: Buffer
}

/**
 * Extract `<id>.onnx`, its JSON config, and `tokens.txt` from a sherpa voice
 * `.tar.bz2` buffer. Returns null when any file is missing (corrupt/partial
 * download), so the caller can discard and retry. NEVER throws for a bad archive.
 */
export function extractSherpaVoiceBundle(bz2: Buffer, voiceId: string): ExtractedVoiceFiles | null {
  try {
    const bzip = nativeRequire('seek-bzip') as { decode(d: Uint8Array, multistream?: boolean): Buffer }
    const tar = bzip.decode(bz2)
    const entries = parseTarEntries(tar)
    let onnx: Buffer | undefined
    let config: Buffer | undefined
    let tokens: Buffer | undefined
    for (const [name, data] of entries) {
      if (name.endsWith(`${voiceId}.onnx`)) onnx = data
      else if (
        name.endsWith(`${voiceId}.onnx.json`) ||
        name.endsWith('/config.json') ||
        name === 'config.json'
      ) {
        config = data
      }
      else if (name.endsWith('/tokens.txt') || name === 'tokens.txt') tokens = data
    }
    if (
      !onnx ||
      onnx.length === 0 ||
      !config ||
      config.length === 0 ||
      !tokens ||
      tokens.length === 0
    ) {
      return null
    }
    return { onnx, config, tokens }
  } catch (error) {
    logger.warn('tts', 'sherpa bundle extraction failed', {
      voiceId,
      reason: 'extract-error',
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine resolution + OUT-OF-PROCESS synthesis.
//
// CRITICAL ISOLATION: sherpa-onnx statically links onnxruntime, whose native
// kernels can hard-crash (0xC0000005 ACCESS_VIOLATION — e.g. unsupported SIMD) on
// low-end CPUs. That is the exact failure that killed piper.exe for the user's
// brother. Running OfflineTts.generate() IN this (Electron main) process would let
// such a native crash take down the WHOLE app — strictly worse than the old
// separate-process piper, where only the child died and we fell back. worker_threads
// share the same process and do NOT isolate native segfaults, so synthesis runs in
// a SEPARATE PROCESS: process.execPath with ELECTRON_RUN_AS_NODE=1 (the Electron
// binary acting as plain Node) executing sherpa-worker.cjs. A native crash there is
// observed as a non-zero exit / signal → we throw → piper.ts's catch increments the
// per-voice crash count → after ENGINE_MAX_CRASHES the voice goes straight to the
// OS-voice fallback. NOTHING native is loaded in-process anymore (not even the
// readiness probe), so the main process can no longer be crashed by the engine.
// ─────────────────────────────────────────────────────────────────────────────

// Hard cap on a single synth so a hung/looping worker can't wedge the queue.
const SYNTH_TIMEOUT_MS = 30_000

interface SherpaPaths {
  /** Absolute path to the sherpa-onnx-node JS entry (asar → unpacked). */
  entry: string
  /** Absolute path to the platform native package dir, or null if absent. */
  nativeDir: string | null
}

// Map an asar path to its asar.unpacked sibling when that sibling exists. The
// worker runs as PLAIN Node (no asar support assumed), and sherpa-onnx-node + its
// platform native package are asarUnpacked, so every path handed to the worker must
// point at the real on-disk unpacked copy. In dev (no asar) this is a no-op.
function toUnpacked(p: string): string {
  const marker = `app.asar${pathSep}`
  if (p.includes(marker)) {
    const unpacked = p.replace(marker, `app.asar.unpacked${pathSep}`)
    if (existsSync(unpacked)) return unpacked
  }
  return p
}

// Resolve the sherpa-onnx-node JS entry + its platform native package dir WITHOUT
// loading any native code. Returns null when the engine package isn't installed.
function resolveSherpaPaths(): SherpaPaths | null {
  try {
    const entry = toUnpacked(nativeRequire.resolve('sherpa-onnx-node'))
    const pkgJson = toUnpacked(nativeRequire.resolve('sherpa-onnx-node/package.json'))
    const nodeModulesDir = pkgJson.slice(0, pkgJson.lastIndexOf('sherpa-onnx-node'))
    const platform = process.platform === 'win32' ? 'win' : process.platform
    const nativeDir = `${nodeModulesDir}sherpa-onnx-${platform}-${process.arch}`
    return { entry, nativeDir: existsSync(nativeDir) ? nativeDir : null }
  } catch {
    return null
  }
}

/**
 * True when the sherpa native engine is PRESENT on disk for this platform. This is
 * a pure filesystem check — it deliberately does NOT load the native addon, because
 * loading onnxruntime in-process is the very thing we isolate out-of-process. If the
 * files are present but the engine still can't run on this CPU, the first synth's
 * worker will crash and the per-voice crash-guard takes over (→ OS fallback).
 */
export function isSherpaEngineReady(): boolean {
  const paths = resolveSherpaPaths()
  if (!paths || !paths.nativeDir) return false
  return existsSync(join(paths.nativeDir, 'sherpa-onnx.node'))
}

export interface SherpaSynthParams {
  modelPath: string
  tokensPath: string
  dataDir: string
  text: string
  /** Playback speed (1.0 = normal). Rate is applied client-side, so this stays 1. */
  speed?: number
  /** VITS speaker id (multi-speaker models); single-speaker voices use 0. */
  speakerId?: number
  /**
   * Absolute path to sherpa-worker.cjs. The caller (piper.ts) resolves it for dev
   * vs packaged since this module stays Electron-free.
   */
  workerPath: string
  /** Writable dir for the transient output WAV (cleaned up after read). */
  outDir: string
}

// Spawn the synth worker, feed it the job over stdin, and resolve when it exits 0.
// Rejects (→ caller throws → crash-guard counts it) on spawn error, non-zero exit,
// a fatal signal (native crash), or timeout. Captures stderr for diagnostics.
function runSynthWorker(workerPath: string, job: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'ignore', 'pipe']
    })

    let stderr = ''
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    const timer = setTimeout(() => {
      finish(() => {
        child.kill('SIGKILL')
        reject(new Error(`sherpa worker timed out after ${SYNTH_TIMEOUT_MS}ms`))
      })
    }, SYNTH_TIMEOUT_MS)

    child.stderr?.on('data', (d: Buffer) => {
      stderr += String(d)
    })
    child.on('error', (err) => {
      finish(() => reject(new Error(`sherpa worker spawn failed: ${err.message}`)))
    })
    child.on('exit', (code, signal) => {
      if (code === 0) {
        finish(resolve)
      } else {
        finish(() =>
          reject(
            new Error(
              `sherpa worker failed (code=${code ?? 'null'}, signal=${signal ?? 'null'})${
                stderr.trim() ? `: ${stderr.trim()}` : ''
              }`
            )
          )
        )
      }
    })

    // The child may die before draining stdin; swallow the resulting EPIPE so it
    // doesn't surface as an unhandled error (the exit handler reports the failure).
    child.stdin?.on('error', () => undefined)
    child.stdin?.end(job)
  })
}

/**
 * Synthesize `text` to a 16-bit PCM WAV Buffer using sherpa-onnx VITS, running the
 * actual native synth in a SEPARATE PROCESS so a native crash cannot kill the app.
 *
 * Returns null only when the engine package is absent. When the worker fails
 * (crash / non-zero exit / timeout) this THROWS, so piper.ts's catch increments the
 * per-voice crash count and ultimately falls back to a distinct OS voice.
 */
export async function synthWavWithSherpa(params: SherpaSynthParams): Promise<Buffer | null> {
  const paths = resolveSherpaPaths()
  if (!paths) return null

  // The worker writes the WAV here; ensure the dir exists even for BUNDLED voices
  // (no prior download mkdir'd it) or if userData/sherpa-tts was cleared.
  await mkdir(params.outDir, { recursive: true }).catch(() => undefined)
  const outWavPath = join(params.outDir, `synth-${randomUUID()}.wav`)
  const job = JSON.stringify({
    sherpaEntry: paths.entry,
    nativeDir: paths.nativeDir,
    modelPath: params.modelPath,
    tokensPath: params.tokensPath,
    dataDir: params.dataDir,
    text: params.text,
    outWavPath,
    speakerId: params.speakerId ?? 0,
    speed: params.speed ?? 1.0
  })

  try {
    await runSynthWorker(params.workerPath, job)
    const wav = await readFile(outWavPath)
    if (wav.length === 0) throw new Error('sherpa worker produced an empty WAV')
    return wav
  } finally {
    await rm(outWavPath, { force: true }).catch(() => undefined)
    // The worker writes `${outWavPath}.part` then renames; clean a leftover if it
    // was SIGKILL'd (timeout) or crashed natively between write and rename.
    await rm(`${outWavPath}.part`, { force: true }).catch(() => undefined)
  }
}

/**
 * No-op retained for back-compat. Synthesis now runs in a fresh child process per
 * call, so there is no in-process engine instance to evict after a voice's model
 * files are re-downloaded.
 */
export function evictTtsCache(_modelPath: string): void {
  // intentionally empty — see synthWavWithSherpa (out-of-process, no cache)
}
