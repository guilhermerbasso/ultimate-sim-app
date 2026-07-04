// OFFLINE STT (whisper.cpp) main-process module.
//
// Mirrors modules/spotter3d.ts (config lifecycle) + tts/piper.ts (bundled binary). This
// module owns: the persisted `stt.json` config, the whisper ggml model manager, and the
// whisper subprocess engine. It exposes the `stt:*` IPC the renderer wake-word engine
// (renderer/src/lib/wake-word.ts) drives. All transcription is OFFLINE + CPU-only and only
// runs on-demand (the renderer's VAD gates it). Everything degrades gracefully: if the
// binary or model is absent the handlers return inert values and nothing throws into IPC.
//
// IPC channels exposed (all under the single `stt:` preload prefix):
//   stt:transcribe   → string         (PCM16 16k mono → text; '' when unavailable)
//   stt:getConfig    → SttConfig
//   stt:setConfig    → SttConfig       (merged + persisted; broadcasts stt:statusEvent)
//   stt:ensureModel  → EnsureSttModelResult (streams stt:modelProgress; broadcasts status)
//   stt:status       → SttStatus

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ModuleContext } from '../module-context'
import { logger } from './logger'
import {
  DEFAULT_STT_CONFIG,
  STT_CHANNELS,
  mergeSttConfig,
  type SttConfig,
  type SttConfigPatch,
  type SttModelId,
  type SttStatus,
  type SttTranscribeOptions,
  type SttVadResult
} from '../../shared/stt-ipc'
import { WhisperModelManager } from '../stt/whisper-model'
import { WhisperEngine, isWhisperBinaryPresent } from '../stt/whisper'
import { VadModelManager } from '../stt/vad-model'
import { VadEngine } from '../stt/vad'

const LOG_AREA = 'stt'
const CONFIG_FILE = 'stt.json'

let config: SttConfig = DEFAULT_STT_CONFIG

export function register(ctx: ModuleContext): void {
  const userData = ctx.app.getPath('userData')
  const configPath = join(userData, CONFIG_FILE)
  const modelsDir = join(userData, 'models')
  const tempDir = join(userData, 'whisper-stt')

  const models = new WhisperModelManager({ modelsDir })
  const engine = new WhisperEngine({ models, tempDir })
  const vadModels = new VadModelManager({ modelsDir })
  const vad = new VadEngine({
    models: vadModels,
    onDebug: (message, meta) => logger.debug(LOG_AREA, message, meta)
  })

  const buildStatus = (): SttStatus => {
    const binaryPresent = isWhisperBinaryPresent()
    const modelPresent = models.isModelPresent(config.model)
    return {
      enabled: config.enabled,
      binaryPresent,
      modelPresent,
      available: binaryPresent && modelPresent,
      vadModelPresent: vadModels.isModelPresent(),
      model: config.model,
      config
    }
  }

  void loadConfig(configPath).then((loaded) => {
    config = loaded
    logger.info(LOG_AREA, 'config loaded', { enabled: config.enabled, model: config.model })
    ctx.broadcast(STT_CHANNELS.statusEvent, buildStatus())
  })

  ctx.ipcMain.handle(STT_CHANNELS.getConfig, () => config)

  ctx.ipcMain.handle(STT_CHANNELS.setConfig, async (_event, patch: SttConfigPatch) => {
    config = mergeSttConfig(config, { ...(patch ?? {}), updatedAt: Date.now() })
    logger.info(LOG_AREA, 'config changed', { enabled: config.enabled, model: config.model })
    await saveConfig(configPath, config)
    ctx.broadcast(STT_CHANNELS.statusEvent, buildStatus())
    return config
  })

  ctx.ipcMain.handle(STT_CHANNELS.status, () => buildStatus())

  ctx.ipcMain.handle(STT_CHANNELS.ensureModel, async (_event, modelId?: SttModelId) => {
    const target = modelId ?? config.model
    const result = await models.ensureModel(target, (progress) => {
      ctx.broadcast(STT_CHANNELS.modelProgress, progress)
    })
    // Presence may have changed — push a fresh status so the UI flips to "available".
    ctx.broadcast(STT_CHANNELS.statusEvent, buildStatus())
    return result
  })

  // Download the Silero VAD ONNX gate on demand (small ~1.8MB). Reuses the stt:modelProgress
  // channel shape via the model manager's own progress, but reports under a synthetic 'tiny'
  // id is NOT needed — the VAD progress payload differs, so we keep it out of the whisper
  // progress stream and just broadcast a fresh status when it lands.
  ctx.ipcMain.handle(STT_CHANNELS.vadEnsureModel, async () => {
    const result = await vadModels.ensureModel()
    ctx.broadcast(STT_CHANNELS.statusEvent, buildStatus())
    return result
  })

  // Speech gate BEFORE whisper. Returns { available, probability }. `available: false`
  // (gate disabled, model/addon absent, or an inference error) tells the renderer to fall
  // back to whisper-always-on. Never throws into IPC.
  ctx.ipcMain.handle(
    STT_CHANNELS.vadDetect,
    async (_event, pcm: ArrayBuffer | Uint8Array | null): Promise<SttVadResult> => {
      if (!config.enabled || !config.vadGate || !pcm) return { available: false, probability: 0 }
      const bytes = normalizePcm(pcm)
      if (bytes.length === 0) return { available: false, probability: 0 }
      try {
        const probability = await vad.detect(bytes)
        if (probability === null) return { available: false, probability: 0 }
        return { available: true, probability }
      } catch (error) {
        logger.debug(LOG_AREA, 'vad detect unavailable', {
          message: error instanceof Error ? error.message : String(error)
        })
        return { available: false, probability: 0 }
      }
    }
  )

  ctx.ipcMain.handle(
    STT_CHANNELS.transcribe,
    async (_event, pcm: ArrayBuffer | Uint8Array | null, options?: SttTranscribeOptions): Promise<string> => {
      if (!config.enabled || !pcm) return ''
      const bytes = normalizePcm(pcm)
      if (bytes.length === 0) return ''
      try {
        return await engine.transcribe(bytes, config.model, {
          language: options?.language ?? config.language
        })
      } catch (error) {
        // Unavailable (no binary/model) or a process error → inert. The renderer treats
        // '' as "no speech recognized", so the wake word simply stays inactive.
        logger.debug(LOG_AREA, 'transcribe unavailable', {
          message: error instanceof Error ? error.message : String(error)
        })
        return ''
      }
    }
  )
}

// IPC structured-clone may deliver the PCM as an ArrayBuffer or a typed array. Normalize
// to a Uint8Array view without copying when possible.
function normalizePcm(pcm: ArrayBuffer | Uint8Array): Uint8Array {
  if (pcm instanceof Uint8Array) return pcm
  return new Uint8Array(pcm)
}

async function loadConfig(configPath: string): Promise<SttConfig> {
  try {
    const raw = await readFile(configPath, 'utf8')
    const parsed = JSON.parse(raw) as SttConfigPatch
    return mergeSttConfig(DEFAULT_STT_CONFIG, parsed)
  } catch {
    return { ...DEFAULT_STT_CONFIG, wakeWords: [...DEFAULT_STT_CONFIG.wakeWords], updatedAt: Date.now() }
  }
}

async function saveConfig(configPath: string, nextConfig: SttConfig): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8')
}
