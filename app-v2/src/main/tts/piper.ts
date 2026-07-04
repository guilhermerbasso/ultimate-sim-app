import { existsSync, statSync, createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile, unlink, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import type { App } from 'electron'
import type { ModuleContext } from '../module-context'
import { logger } from '../modules/logger'
import {
  TTS_CHANNELS,
  PIPER_VOICE_CATALOG,
  isValidPiperVoiceId,
  sherpaVoiceBundleUrl,
  piperVoiceApproxBytes,
  sherpaVoiceBundleBytes,
  type PiperVoiceInfo,
  type PiperVoiceProgress,
  type TtsEngineStatus,
  type EnsureVoiceResult
} from '../../shared/spotter'
import {
  isSherpaEngineReady,
  synthWavWithSherpa,
  extractSherpaVoiceBundle,
  evictTtsCache
} from './sherpa'

// Neural TTS main-process module — engine = sherpa-onnx (VITS), replacing piper.exe
// which hard-crashed (0xC0000005) on many Windows CPUs and made tts:synth return
// null for EVERY voice (the renderer then fell back to a single OS language-default
// voice, so all neural voices sounded identical).
//
// The Windows installer is LEAN: it bundles only the sherpa native engine and a
// SHARED espeak-ng-data (resources/tts/espeak-ng-data). Each voice's weights are
// DOWNLOADED on first use into a writable userData dir
// (userData/tts/voices/<id>/{model.onnx,tokens.txt}) via tts:ensureVoice. A voice
// hand-bundled under resources/tts/voices/<id>/ is still honored (back-compat), so
// `installed` = present in EITHER location.
//
// On macOS / Linux dev the native engine is usually absent, so synth degrades
// gracefully returning null (callers fall back to a DISTINCT OS voice). Run
// scripts/fetch-win-sherpa.sh to seed resources/tts/ for the Windows build.
//
// IPC channels exposed (UNCHANGED contract):
//   tts:listVoices  → PiperVoiceInfo[]   (installed flag populated at runtime)
//   tts:synth       → Buffer | null      (WAV bytes; null when engine/voice absent)
//   tts:ensureVoice → EnsureVoiceResult  (download-on-first-use; never throws)
//   tts:voiceProgress (main → renderer)  download progress events

const TEMP_DIR_NAME = 'sherpa-tts'

// A downloaded model.onnx smaller than this (or this fraction of its catalog size)
// is treated as truncated/absent so a half-written file never poisons the next run.
const MIN_ONNX_BYTES = 1_000_000
const MIN_TOKENS_BYTES = 100
const MIN_VALID_RATIO = 0.9

const MODEL_FILE = 'model.onnx'
const TOKENS_FILE = 'tokens.txt'
const ESPEAK_DIR = 'espeak-ng-data'

// ── Engine + shared-asset paths ─────────────────────────────────────────────

// Shared espeak-ng-data dir (the sherpa VITS `dataDir`). Bundled ONCE for all
// voices. Prefers the engine-neutral resources/tts/ path; falls back to the legacy
// resources/piper/ copy for back-compat with older builds.
function getDataDirCandidates(): string[] {
  return [
    join(process.resourcesPath, 'tts', ESPEAK_DIR),
    join(process.resourcesPath, 'piper', ESPEAK_DIR)
  ]
}

function resolveDataDir(): string | null {
  for (const dir of getDataDirCandidates()) {
    if (existsSync(dir)) return dir
  }
  return null
}

// Writable per-voice dir that holds DOWNLOADED weights (userData/tts/voices/<id>/).
function getUserVoicesDir(app: App): string {
  return join(app.getPath('userData'), 'tts', 'voices')
}

// Bundled per-voice dir (resources/tts/voices/<id>/) — read-only, optional.
function getBundledVoicesDir(): string {
  return join(process.resourcesPath, 'tts', 'voices')
}

// Absolute path to the out-of-process synth worker (sherpa-worker.cjs). In a
// packaged app it is shipped via extraResources to process.resourcesPath; in dev it
// is read straight from source under the app dir. Kept here (not in sherpa.ts) so
// that engine module stays Electron-free.
function resolveSherpaWorkerPath(app: App): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'sherpa-worker.cjs')
    : join(app.getAppPath(), 'src', 'main', 'tts', 'sherpa-worker.cjs')
}

// ─────────────────────────────────────────────────────────────────────────────
// Voice resolution (PURE + testable) — downloaded copy wins over bundled.
//
// Kept side-effect free (an injected `exists` predicate) so unit tests can assert
// the userData-vs-resources precedence without touching the real filesystem. With
// sherpa, each voice lives in its OWN dir: <voicesDir>/<id>/model.onnx.
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolveVoiceModelOptions {
  userVoicesDir: string
  bundledVoicesDir: string
  voiceId: string
  exists: (path: string) => boolean
}

/** The model.onnx path to load, preferring the DOWNLOADED copy over the bundled one. */
export function resolveVoiceModelPath(opts: ResolveVoiceModelOptions): string | null {
  const downloaded = join(opts.userVoicesDir, opts.voiceId, MODEL_FILE)
  if (opts.exists(downloaded)) return downloaded
  const bundled = join(opts.bundledVoicesDir, opts.voiceId, MODEL_FILE)
  if (opts.exists(bundled)) return bundled
  return null
}

function resolveVoiceModel(app: App, voiceId: string): string | null {
  return resolveVoiceModelPath({
    userVoicesDir: getUserVoicesDir(app),
    bundledVoicesDir: getBundledVoicesDir(),
    voiceId,
    exists: existsSync
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Download-on-first-use — mirrors src/main/ai/model-manager.ts.
// ─────────────────────────────────────────────────────────────────────────────

// Streams a URL to `${destPath}.part` with progress, then renames to the final path
// ONLY on success, so a half-written file never passes the presence check.
async function downloadFileWithProgress(
  url: string,
  destPath: string,
  onProgress?: (downloaded: number, total: number) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(url, { signal, redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`download failed: HTTP ${response.status} ${response.statusText}`)
  }
  const total = Number(response.headers.get('content-length') ?? 0)
  const partPath = `${destPath}.part`
  await mkdir(join(destPath, '..'), { recursive: true })
  const out = createWriteStream(partPath)
  let downloaded = 0
  const nodeStream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
  nodeStream.on('data', (chunk: Buffer) => {
    downloaded += chunk.length
    onProgress?.(downloaded, total)
  })
  try {
    await new Promise<void>((resolve, reject) => {
      // pipe() does NOT close the destination when the SOURCE errors, so on any
      // stream error we destroy `out` (closing its fd) before rejecting — otherwise
      // the write-stream fd leaks and the .part file is left mid-write.
      const onError = (err: Error): void => {
        out.destroy()
        reject(err)
      }
      nodeStream.on('error', onError)
      out.on('error', onError)
      out.on('finish', resolve)
      nodeStream.pipe(out)
    })
  } catch (error) {
    // Remove the orphaned partial so a future attempt starts clean.
    await rm(partPath, { force: true }).catch(() => undefined)
    throw error
  }
  await rename(partPath, destPath)
}

async function fileAtLeast(path: string, minBytes: number): Promise<boolean> {
  try {
    const info = await stat(path)
    return info.isFile() && info.size >= minBytes
  } catch {
    return false
  }
}

function minOnnxBytes(voiceId: string): number {
  const approx = piperVoiceApproxBytes(voiceId)
  return approx > 0 ? Math.max(MIN_ONNX_BYTES, Math.floor(approx * MIN_VALID_RATIO)) : MIN_ONNX_BYTES
}

// True when BOTH the downloaded weights + tokens exist at full size.
function isDownloadedComplete(app: App, voiceId: string): boolean {
  const dir = join(getUserVoicesDir(app), voiceId)
  const onnx = join(dir, MODEL_FILE)
  const tokens = join(dir, TOKENS_FILE)
  try {
    if (!existsSync(onnx) || !existsSync(tokens)) return false
    return statSync(onnx).size >= minOnnxBytes(voiceId) && statSync(tokens).size >= MIN_TOKENS_BYTES
  } catch {
    return false
  }
}

// True when the voice is usable from EITHER the downloaded copy or a bundled one.
function isVoiceInstalled(app: App, voiceId: string): boolean {
  if (isDownloadedComplete(app, voiceId)) return true
  const bundled = join(getBundledVoicesDir(), voiceId, MODEL_FILE)
  return existsSync(bundled)
}

export function register(ctx: ModuleContext): void {
  const tempDir = join(ctx.app.getPath('userData'), TEMP_DIR_NAME)
  // Single-flight per voice: concurrent ensureVoice calls share ONE download.
  const inflight = new Map<string, Promise<EnsureVoiceResult>>()

  ctx.ipcMain.handle(TTS_CHANNELS.listVoices, (): PiperVoiceInfo[] => {
    const engineReady = isSherpaEngineReady()
    return PIPER_VOICE_CATALOG.map((voice) => ({
      ...voice,
      // A voice is usable only when the native engine is also present.
      installed: engineReady && resolveVoiceModel(ctx.app, voice.id) !== null
    }))
  })

  ctx.ipcMain.handle(
    TTS_CHANNELS.synth,
    async (_event, text: string, voiceId: string, _rate: number): Promise<Buffer | null> => {
      // The model is selected PER CALL from the requested voiceId — nothing is
      // pinned between synths — so switching <modelA> → <modelB> immediately uses
      // the new model. Rate is applied client-side (audio.playbackRate), so it is
      // intentionally ignored here.
      if (!isValidPiperVoiceId(voiceId)) {
        logger.warn('tts', 'synth fallback: invalid voice id', { voiceId, reason: 'invalid-id' })
        return null
      }
      if (!isSherpaEngineReady()) {
        logger.info('tts', 'synth fallback: engine unavailable', {
          voiceId,
          reason: 'engine-missing'
        })
        return null
      }
      const model = resolveVoiceModel(ctx.app, voiceId)
      if (!model) {
        logger.info('tts', 'synth fallback: voice model not installed', {
          voiceId,
          reason: 'model-missing'
        })
        return null
      }
      const dataDir = resolveDataDir()
      if (!dataDir) {
        logger.info('tts', 'synth fallback: espeak-ng-data (dataDir) absent', {
          voiceId,
          reason: 'datadir-missing'
        })
        return null
      }
      if ((engineCrashCount.get(voiceId) ?? 0) >= ENGINE_MAX_CRASHES) {
        logger.info('tts', 'synth fallback: engine disabled for this voice after repeated failures', {
          voiceId,
          reason: 'engine-crash-disabled'
        })
        return null
      }
      const tokens = join(model, '..', TOKENS_FILE)
      try {
        const wav = await synthWavWithSherpa({
          modelPath: model,
          tokensPath: tokens,
          dataDir,
          text,
          // Synthesis runs in a SEPARATE process (sherpa-worker.cjs) so a native
          // onnxruntime crash kills only that child, not the app. The worker writes
          // its transient WAV under our userData temp dir.
          workerPath: resolveSherpaWorkerPath(ctx.app),
          outDir: tempDir
        })
        if (!wav) throw new Error('engine returned no audio')
        engineCrashCount.delete(voiceId)
        logger.debug('tts', 'synth ok (sherpa)', {
          voiceId,
          engine: 'sherpa',
          // The exact model.onnx that produced the audio — DISTINCT per voice, so
          // this line is how we confirm two voices are not collapsing to one model.
          modelPath: model,
          bytes: wav.byteLength
        })
        return wav
      } catch (error) {
        engineCrashCount.set(voiceId, (engineCrashCount.get(voiceId) ?? 0) + 1)
        logger.warn('tts', 'synth fallback: sherpa synth failed', {
          voiceId,
          reason: 'synth-error',
          modelPath: model,
          error: error instanceof Error ? error.message : String(error)
        })
        return null
      }
    }
  )

  ctx.ipcMain.handle(
    TTS_CHANNELS.ensureVoice,
    async (_event, voiceId: string): Promise<EnsureVoiceResult> => {
      if (!isValidPiperVoiceId(voiceId)) {
        return { ok: false, voiceId, installed: false, error: `unknown voice id: ${voiceId}` }
      }
      // Already present (downloaded or bundled) → no network.
      if (isVoiceInstalled(ctx.app, voiceId)) {
        emitProgress(ctx, { voiceId, phase: 'done', totalBytes: 0, downloadedBytes: 0, ratio: 1 })
        return { ok: true, voiceId, installed: true }
      }
      const existing = inflight.get(voiceId)
      if (existing) return existing

      const task = ensureVoice(ctx, tempDir, voiceId).finally(() => {
        inflight.delete(voiceId)
      })
      inflight.set(voiceId, task)
      return task
    }
  )

  // Neural-engine self-test. Cheap FS presence check first; when the engine is on
  // disk AND a voice is installed, run a tiny REAL synth through the out-of-process
  // worker so we catch CPUs where onnxruntime hard-crashes (0xC0000005). The result
  // is cached so the probe (and its child process) runs at most once per app run.
  ctx.ipcMain.handle(TTS_CHANNELS.engineStatus, async (): Promise<TtsEngineStatus> => {
    if (engineStatusCache) return engineStatusCache
    engineStatusCache = await probeEngineStatus(ctx, tempDir)
    return engineStatusCache
  })
}

// Cached once per app run: the probe may spawn a child synth, so we never repeat it.
let engineStatusCache: TtsEngineStatus | null = null

async function probeEngineStatus(ctx: ModuleContext, tempDir: string): Promise<TtsEngineStatus> {
  // 1. Cheapest signal: are the native engine files present on disk at all?
  if (!isSherpaEngineReady()) {
    const status: TtsEngineStatus = {
      engine: 'none',
      ok: false,
      reason: 'Motor neural (sherpa-onnx) ausente neste host.'
    }
    logger.info('tts', 'engine status: native engine absent', status)
    return status
  }

  const dataDir = resolveDataDir()
  if (!dataDir) {
    const status: TtsEngineStatus = {
      engine: 'sherpa',
      ok: false,
      reason: 'espeak-ng-data (dataDir) ausente — síntese neural indisponível.'
    }
    logger.warn('tts', 'engine status: dataDir absent', status)
    return status
  }

  // 2. Pick the first INSTALLED voice to probe. With none installed we cannot run a
  // real synth, but the engine IS present, so report ok (the first download will
  // surface any CPU-level crash through the per-voice crash guard).
  const probeVoiceId = PIPER_VOICE_CATALOG.map((v) => v.id).find(
    (id) => resolveVoiceModel(ctx.app, id) !== null
  )
  if (!probeVoiceId) {
    const status: TtsEngineStatus = {
      engine: 'sherpa',
      ok: true,
      reason: 'Motor presente; nenhuma voz instalada para testar.'
    }
    logger.info('tts', 'engine status: engine present, no installed voice to probe', status)
    return status
  }

  const model = resolveVoiceModel(ctx.app, probeVoiceId)
  if (!model) {
    const status: TtsEngineStatus = { engine: 'sherpa', ok: true }
    logger.info('tts', 'engine status: voice model vanished before probe', { probeVoiceId })
    return status
  }
  const tokens = join(model, '..', TOKENS_FILE)

  // 3. Tiny REAL synth in the isolated worker. A native crash there throws here.
  try {
    const wav = await synthWavWithSherpa({
      modelPath: model,
      tokensPath: tokens,
      dataDir,
      text: 'ok',
      workerPath: resolveSherpaWorkerPath(ctx.app),
      outDir: tempDir
    })
    if (!wav || wav.length === 0) throw new Error('engine returned no audio')
    const status: TtsEngineStatus = { engine: 'sherpa', ok: true }
    logger.info('tts', 'engine status: neural synth probe ok', {
      probeVoiceId,
      bytes: wav.byteLength
    })
    return status
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const status: TtsEngineStatus = { engine: 'sherpa', ok: false, reason }
    // Named so the next user log pinpoints the exact neural failure on this CPU.
    logger.warn('tts', 'engine status: neural synth probe FAILED (using OS voices)', {
      probeVoiceId,
      reason
    })
    return status
  }
}

function emitProgress(ctx: ModuleContext, progress: PiperVoiceProgress): void {
  ctx.broadcast(TTS_CHANNELS.voiceProgress, progress)
}

// Download the sherpa voice bundle for `voiceId`, extract model.onnx + tokens.txt
// into userData/tts/voices/<id>/, verify, and report. NEVER throws.
async function ensureVoice(
  ctx: ModuleContext,
  tempDir: string,
  voiceId: string
): Promise<EnsureVoiceResult> {
  const url = sherpaVoiceBundleUrl(voiceId)
  if (!url) return { ok: false, voiceId, installed: false, error: `cannot resolve bundle URL for ${voiceId}` }

  const voiceDir = join(getUserVoicesDir(ctx.app), voiceId)
  const onnxPath = join(voiceDir, MODEL_FILE)
  const tokensPath = join(voiceDir, TOKENS_FILE)
  const bundlePath = join(tempDir, `${voiceId}-${randomUUID()}.tar.bz2`)
  const totalBytes = sherpaVoiceBundleBytes(voiceId)

  try {
    await mkdir(tempDir, { recursive: true })
    await mkdir(voiceDir, { recursive: true })
    emitProgress(ctx, { voiceId, phase: 'resolving', totalBytes, downloadedBytes: 0, ratio: 0 })

    // 1. Download the .tar.bz2 bundle (the big file → drives the progress bar).
    await downloadFileWithProgress(url, bundlePath, (downloaded, total) => {
      const t = total > 0 ? total : totalBytes
      emitProgress(ctx, {
        voiceId,
        phase: 'downloading',
        totalBytes: t,
        downloadedBytes: downloaded,
        ratio: t > 0 ? Math.min(1, downloaded / t) : 0
      })
    })

    // 2. Extract model.onnx + tokens.txt (pure-JS bzip2 + tar; no shelling out).
    emitProgress(ctx, { voiceId, phase: 'verifying', totalBytes, downloadedBytes: totalBytes, ratio: 1 })
    const bundle = await readFile(bundlePath)
    const extracted = extractSherpaVoiceBundle(bundle, voiceId)
    if (!extracted) throw new Error('bundle extraction failed (missing model.onnx or tokens.txt)')

    // Write to .part files then atomically rename, so a crash mid-write never
    // leaves a half-file that passes the presence check.
    await writeFile(`${onnxPath}.part`, extracted.onnx)
    await writeFile(`${tokensPath}.part`, extracted.tokens)
    await rename(`${onnxPath}.part`, onnxPath)
    await rename(`${tokensPath}.part`, tokensPath)
    evictTtsCache(onnxPath) // drop any stale engine instance for this path

    // 3. Verify the extracted files are full-size.
    if (!(await fileAtLeast(onnxPath, minOnnxBytes(voiceId))) || !(await fileAtLeast(tokensPath, MIN_TOKENS_BYTES))) {
      throw new Error('extracted voice failed verification (missing or truncated)')
    }

    emitProgress(ctx, { voiceId, phase: 'done', totalBytes, downloadedBytes: totalBytes, ratio: 1 })
    logger.info('tts', 'voice downloaded', { voiceId, engine: 'sherpa', onnxPath, bytes: extracted.onnx.length })
    // A fresh (re)download supersedes a corrupt model that hit the crash cap, so
    // clear the sticky guard and let this voice try the neural engine again.
    engineCrashCount.delete(voiceId)
    return { ok: true, voiceId, installed: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Remove BOTH partial files (+ any leftover .part) so neither poisons retry.
    await rm(onnxPath, { force: true }).catch(() => undefined)
    await rm(tokensPath, { force: true }).catch(() => undefined)
    await rm(`${onnxPath}.part`, { force: true }).catch(() => undefined)
    await rm(`${tokensPath}.part`, { force: true }).catch(() => undefined)
    emitProgress(ctx, { voiceId, phase: 'error', totalBytes, downloadedBytes: 0, ratio: 0, error: message })
    logger.warn('tts', 'voice download failed', { voiceId, reason: 'download-error', error: message })
    return { ok: false, voiceId, installed: false, error: message }
  } finally {
    // Remove the downloaded bundle AND any leftover .part (a mid-download failure
    // with a per-attempt randomUUID name would otherwise orphan a ~67MB .part).
    await unlink(bundlePath).catch(() => undefined)
    await rm(`${bundlePath}.part`, { force: true }).catch(() => undefined)
  }
}

// The engine can still fail for a specific voice on some machines (corrupt model,
// unsupported op, OOM). Each failure logs + wastes CPU, and the proactive engineer +
// spotter retry every few seconds. After a couple of failures for a given voice we
// stop calling the engine for it and go straight to the distinct-OS-voice fallback.
// Reset on a later success. (Engine-neutral rename of the old PIPER_MAX_CRASHES.)
const ENGINE_MAX_CRASHES = 2
const engineCrashCount = new Map<string, number>()
