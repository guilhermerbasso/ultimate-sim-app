import { existsSync, createWriteStream } from 'node:fs'
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
import { PiperEngineHealth } from './piper-engine-health'
import { PiperVoiceRepairCoordinator } from './piper-voice-repair'
import {
  PIPER_VOICE_CONFIG_FILE,
  PIPER_VOICE_MODEL_FILE,
  PIPER_VOICE_TOKENS_FILE,
  installTrustedVoiceDirectory,
  piperVoiceTrustSupport,
  recoverAtomicVoiceDirectory,
  trustedPiperVoiceDigest,
  verifyTrustedVoiceDirectory,
  voicePayloadMatchesTrustedDigest,
  type VoiceDirectoryDependencies,
  type TrustedPiperVoiceDigest
} from './piper-voice-integrity'

// Neural TTS main-process module — engine = sherpa-onnx (VITS), replacing piper.exe
// which hard-crashed (0xC0000005) on many Windows CPUs and made tts:synth return
// null for EVERY voice (the renderer then fell back to a single OS language-default
// voice, so all neural voices sounded identical).
//
// The Windows installer is LEAN: it bundles only the sherpa native engine and a
// SHARED espeak-ng-data (resources/tts/espeak-ng-data). Each voice's weights are
// DOWNLOADED on first use into a writable userData dir
// (userData/tts/voices/<id>/{model.onnx,tokens.txt}) via tts:ensureVoice. A voice
// hand-bundled under resources/tts/voices/<id>/ is honored only when the complete
// directory and metadata match a checked-in trusted digest entry.
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
const ENGINE_MAX_CRASHES = 2
const engineHealth = new PiperEngineHealth(ENGINE_MAX_CRASHES)

const MODEL_FILE = PIPER_VOICE_MODEL_FILE
const CONFIG_FILE = PIPER_VOICE_CONFIG_FILE
const TOKENS_FILE = PIPER_VOICE_TOKENS_FILE
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

const voiceDirectoryDependencies: VoiceDirectoryDependencies = {
  exists: async (path) => {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  },
  mkdir: async (path) => {
    await mkdir(path, { recursive: true })
  },
  writeFile: async (path, bytes) => {
    await writeFile(path, bytes)
  },
  readFile,
  rename,
  remove: async (path) => {
    await rm(path, { recursive: true, force: true })
  }
}

interface VerifiedVoiceLocation {
  directory: string
  modelPath: string
  configPath: string
  tokensPath: string
  source: 'user' | 'bundled'
  reason: string | null
}

interface VoiceInspection {
  location: VerifiedVoiceLocation | null
  reason: string | null
}

async function quarantineUserVoice(
  app: App,
  voiceId: string,
  reason: string
): Promise<string> {
  const root = getUserVoicesDir(app)
  const live = join(root, voiceId)
  const quarantine = join(
    root,
    `${voiceId}.quarantine-${Date.now()}`
  )
  try {
    await rename(live, quarantine)
    return `${reason} Quarantined at ${quarantine}.`
  } catch {
    return `${reason} Quarantine failed; the voice remains unavailable.`
  }
}

async function resolveVerifiedVoice(
  app: App,
  voiceId: string
): Promise<VoiceInspection> {
  const trusted = trustedPiperVoiceDigest(voiceId)
  const userRoot = getUserVoicesDir(app)
  const userDirectory = join(userRoot, voiceId)
  const userExists = await voiceDirectoryDependencies.exists(userDirectory)
  if (!trusted) {
    let reason = `Trusted manifest unavailable for ${voiceId}.`
    if (userExists) {
      reason = await quarantineUserVoice(
        app,
        voiceId,
        reason
      )
    }
    return { location: null, reason }
  }

  const recovered = await recoverAtomicVoiceDirectory(
    userRoot,
    voiceId,
    trusted,
    voiceDirectoryDependencies
  )
  if (recovered.verified) {
    return {
      location: {
        directory: userDirectory,
        modelPath: join(userDirectory, MODEL_FILE),
        configPath: join(userDirectory, CONFIG_FILE),
        tokensPath: join(userDirectory, TOKENS_FILE),
        source: 'user',
        reason: recovered.reason
      },
      reason: recovered.reason
    }
  }
  let reason = recovered.reason
  if (await voiceDirectoryDependencies.exists(userDirectory)) {
    reason = await quarantineUserVoice(
      app,
      voiceId,
      recovered.reason ?? `Voice ${voiceId} is unverified.`
    )
  }

  const bundledDirectory = join(getBundledVoicesDir(), voiceId)
  if (await voiceDirectoryDependencies.exists(bundledDirectory)) {
    const bundled = await verifyTrustedVoiceDirectory(
      bundledDirectory,
      voiceId,
      trusted,
      voiceDirectoryDependencies
    )
    if (bundled.verified) {
      return {
        location: {
          directory: bundledDirectory,
          modelPath: join(bundledDirectory, MODEL_FILE),
          configPath: join(bundledDirectory, CONFIG_FILE),
          tokensPath: join(bundledDirectory, TOKENS_FILE),
          source: 'bundled',
          reason: null
        },
        reason: null
      }
    }
    reason = bundled.reason
  }
  return {
    location: null,
    reason: reason ?? `Voice ${voiceId} is not installed.`
  }
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
// Legacy path resolution helper (PURE + testable). Runtime synthesis never trusts
// this result alone; resolveVerifiedVoice performs metadata + digest verification.
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

export function register(ctx: ModuleContext): void {
  const tempDir = join(ctx.app.getPath('userData'), TEMP_DIR_NAME)
  const repairCoordinator = new PiperVoiceRepairCoordinator(
    engineHealth,
    async (voiceId) =>
      Boolean((await resolveVerifiedVoice(ctx.app, voiceId)).location),
    async (voiceId) => {
      const trusted = trustedPiperVoiceDigest(voiceId)
      if (!trusted) {
        const error = `No pinned trusted digest is available for ${voiceId}; repair is disabled.`
        emitProgress(ctx, {
          voiceId,
          phase: 'error',
          totalBytes: 0,
          downloadedBytes: 0,
          ratio: 0,
          error
        })
        return {
          ok: false,
          voiceId,
          installed: false,
          error
        }
      }
      const result = await ensureVoice(ctx, tempDir, voiceId, trusted)
      if (result.ok && result.installed) {
        engineHealth.resetVoice(voiceId)
        emitProgress(ctx, {
          voiceId,
          phase: 'done',
          totalBytes: 0,
          downloadedBytes: 0,
          ratio: 1
        })
      }
      return result
    }
  )

  ctx.ipcMain.handle(TTS_CHANNELS.listVoices, async (): Promise<PiperVoiceInfo[]> => {
    const engineReady = isSherpaEngineReady()
    return Promise.all(PIPER_VOICE_CATALOG.map(async (voice) => {
      const trusted = trustedPiperVoiceDigest(voice.id)
      const trustSupport = piperVoiceTrustSupport(voice.id)
      const inspection = await resolveVerifiedVoice(ctx.app, voice.id)
      const needsRepair = engineHealth.needsRepair(voice.id)
      const installed =
        engineReady && !needsRepair && inspection.location !== null
      return {
        ...voice,
        installed,
        downloadSupported: trustSupport.downloadSupported,
        repairSupported: trustSupport.repairSupported,
        unavailableReason: installed
          ? null
          : !trusted
            ? inspection.reason ?? trustSupport.unavailableReason
            : !engineReady
              ? 'Native Piper engine is unavailable.'
              : needsRepair
                ? `Voice ${voice.id} requires a verified repair.`
                : inspection.reason
      }
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
        updateEngineStatus(ctx, {
          engine: 'none',
          ok: false,
          reason: 'Native sherpa engine is unavailable.'
        })
        logger.info('tts', 'synth fallback: engine unavailable', {
          voiceId,
          reason: 'engine-missing'
        })
        return null
      }
      const inspection = await resolveVerifiedVoice(ctx.app, voiceId)
      if (!inspection.location) {
        logger.info('tts', 'synth fallback: verified voice unavailable', {
          voiceId,
          reason: inspection.reason ?? 'verified-voice-missing'
        })
        return null
      }
      const model = inspection.location.modelPath
      const dataDir = resolveDataDir()
      if (!dataDir) {
        updateEngineStatus(ctx, {
          engine: 'sherpa',
          ok: false,
          reason: 'espeak-ng-data is unavailable.'
        })
        logger.info('tts', 'synth fallback: espeak-ng-data (dataDir) absent', {
          voiceId,
          reason: 'datadir-missing'
        })
        return null
      }
      if (engineHealth.isDisabled(voiceId)) {
        updateEngineStatus(ctx, {
          engine: 'sherpa',
          ok: false,
          reason: `Piper is disabled for ${voiceId} after repeated runtime failures.`
        })
        logger.info('tts', 'synth fallback: engine disabled for this voice after repeated failures', {
          voiceId,
          reason: 'engine-crash-disabled'
        })
        return null
      }
      const tokens = inspection.location.tokensPath
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
        const previousStatus = engineHealth.cachedStatus
        const status = engineHealth.recordSuccess(voiceId)
        broadcastEngineStatusIfChanged(ctx, previousStatus, status)
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
        const reason = error instanceof Error ? error.message : String(error)
        const previousStatus = engineHealth.cachedStatus
        const failure = engineHealth.recordFailure(voiceId, reason)
        broadcastEngineStatusIfChanged(ctx, previousStatus, failure.status)
        logger.warn('tts', 'synth fallback: sherpa synth failed', {
          voiceId,
          reason: 'synth-error',
          modelPath: model,
          error: reason,
          crashCount: failure.count,
          disabled: failure.disabled
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
      const alreadyHealthy =
        Boolean((await resolveVerifiedVoice(ctx.app, voiceId)).location) &&
        !engineHealth.needsRepair(voiceId)
      const result = await repairCoordinator.ensure(voiceId)
      if (alreadyHealthy && result.ok && result.installed) {
        emitProgress(ctx, { voiceId, phase: 'done', totalBytes: 0, downloadedBytes: 0, ratio: 1 })
      }
      return result
    }
  )

  // Neural-engine self-test. Cheap FS presence check first; when the engine is on
  // disk AND a voice is installed, run a tiny REAL synth through the out-of-process
  // worker so we catch CPUs where onnxruntime hard-crashes (0xC0000005). The result
  // is cached so the probe (and its child process) runs at most once per app run.
  ctx.ipcMain.handle(TTS_CHANNELS.engineStatus, async (): Promise<TtsEngineStatus> => {
    if (engineHealth.cachedStatus) return engineHealth.cachedStatus
    const status = await probeEngineStatus(ctx, tempDir)
    updateEngineStatus(ctx, status)
    return status
  })
}

function updateEngineStatus(
  ctx: ModuleContext,
  status: TtsEngineStatus
): void {
  const previousStatus = engineHealth.cachedStatus
  engineHealth.setProbeStatus(status)
  broadcastEngineStatusIfChanged(ctx, previousStatus, status)
}

function broadcastEngineStatusIfChanged(
  ctx: ModuleContext,
  previous: TtsEngineStatus | null,
  next: TtsEngineStatus
): void {
  if (
    previous?.engine === next.engine &&
    previous.ok === next.ok &&
    previous.reason === next.reason
  ) {
    return
  }
  ctx.broadcast(TTS_CHANNELS.engineStatusEvent, next)
}

async function probeEngineStatus(ctx: ModuleContext, tempDir: string): Promise<TtsEngineStatus> {
  // 1. Cheapest signal: are the native engine files present on disk at all?
  if (!isSherpaEngineReady()) {
    const status: TtsEngineStatus = {
      engine: 'none',
      ok: false,
      reason: 'Motor neural (sherpa-onnx) missing neste host.'
    }
    logger.info('tts', 'engine status: native engine absent', status)
    return status
  }

  const dataDir = resolveDataDir()
  if (!dataDir) {
    const status: TtsEngineStatus = {
      engine: 'sherpa',
      ok: false,
      reason: 'espeak-ng-data (dataDir) missing — neural synthesis unavailable.'
    }
    logger.warn('tts', 'engine status: dataDir absent', status)
    return status
  }

  // 2. Pick the first INSTALLED voice to probe. With none installed we cannot run a
  // real synth, but the engine IS present, so report ok (the first download will
  // surface any CPU-level crash through the per-voice crash guard).
  let probeVoiceId: string | null = null
  let probeLocation: VerifiedVoiceLocation | null = null
  for (const voice of PIPER_VOICE_CATALOG) {
    const inspection = await resolveVerifiedVoice(ctx.app, voice.id)
    if (inspection.location) {
      probeVoiceId = voice.id
      probeLocation = inspection.location
      break
    }
  }
  if (!probeVoiceId || !probeLocation) {
    const status: TtsEngineStatus = {
      engine: 'sherpa',
      ok: true,
      reason: 'Motor presente; nenhuma voz instalada para testar.'
    }
    logger.info('tts', 'engine status: engine present, no installed voice to probe', status)
    return status
  }

  const model = probeLocation.modelPath
  const tokens = probeLocation.tokensPath

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
    engineHealth.recordFailure(probeVoiceId, reason)
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
  voiceId: string,
  trusted: TrustedPiperVoiceDigest
): Promise<EnsureVoiceResult> {
  const url = sherpaVoiceBundleUrl(voiceId)
  if (!url) return { ok: false, voiceId, installed: false, error: `cannot resolve bundle URL for ${voiceId}` }

  const voicesRoot = getUserVoicesDir(ctx.app)
  const voiceDir = join(voicesRoot, voiceId)
  const onnxPath = join(voiceDir, MODEL_FILE)
  const bundlePath = join(tempDir, `${voiceId}-${randomUUID()}.tar.bz2`)
  const totalBytes = sherpaVoiceBundleBytes(voiceId)

  try {
    await mkdir(tempDir, { recursive: true })
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

    // 2. Extract and verify the complete voice directory payload.
    emitProgress(ctx, { voiceId, phase: 'verifying', totalBytes, downloadedBytes: totalBytes, ratio: 1 })
    const bundle = await readFile(bundlePath)
    if (!voicePayloadMatchesTrustedDigest(trusted, { archive: bundle })) {
      throw new Error('downloaded voice archive failed pinned SHA-256 verification')
    }
    const extracted = extractSherpaVoiceBundle(bundle, voiceId)
    if (!extracted) {
      throw new Error(
        'bundle extraction failed (missing model, config, or tokens)'
      )
    }

    await installTrustedVoiceDirectory(
      voicesRoot,
      voiceId,
      extracted,
      trusted,
      voiceDirectoryDependencies
    )
    evictTtsCache(onnxPath) // drop any stale engine instance for this path

    logger.info('tts', 'voice downloaded', { voiceId, engine: 'sherpa', onnxPath, bytes: extracted.onnx.length })
    return { ok: true, voiceId, installed: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
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
