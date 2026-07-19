import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ModuleContext } from '../module-context'
import { logger } from './logger'
import { settingsEvents } from '../settings/events'
import { CONFIG_SECTION_RELOAD_SIGNAL } from '../../shared/config-io'
import {
  speechLanguageFromAppLanguage,
  type SpeechLanguage
} from '../../shared/tts-voice'
import {
  DEFAULT_SPOTTER_CONFIG,
  SPOTTER_CHANNELS,
  mergeSpotterConfig,
  type SpotterConfig,
  type SpotterConfigPatch
} from '../../shared/spotter'

// Voice Spotter persistence. Mirrors the soundshift module's storage pattern:
// a single JSON file in userData plus get/set IPC and a broadcast on change.
//
// Unlike soundshift this module does NOT process telemetry — all trigger logic
// and speech happen in the renderer (src/renderer/src/lib/spotter-runtime.ts)
// via the Web Speech API. Here we only own the config lifecycle so the runtime
// and the SpotterView stay in sync across reloads/windows.

const CONFIG_FILE = 'spotter.json'

let config: SpotterConfig = DEFAULT_SPOTTER_CONFIG

export function register(ctx: ModuleContext): void {
  const configPath = join(ctx.app.getPath('userData'), CONFIG_FILE)
  let configReady = false
  let activeSpeechLanguage: SpeechLanguage | null = null

  const applyActiveLanguage = (language: SpeechLanguage): void => {
    activeSpeechLanguage = language
    if (!configReady || config.language === language) return
    config = { ...config, language, updatedAt: Date.now() }
    logger.info('spotter', 'language synced from app', spotterLogSummary(config))
    ctx.broadcast(SPOTTER_CHANNELS.configEvent, config)
  }

  const offSettings = settingsEvents.onChanged((settings) => {
    applyActiveLanguage(speechLanguageFromAppLanguage(settings.language, ctx.app.getLocale()))
  })

  const initialConfigReady = loadConfig(configPath).then((loaded) => {
    const language = activeSpeechLanguage
    config =
      language && loaded.language !== language
        ? { ...loaded, language, updatedAt: Date.now() }
        : loaded
    configReady = true
    logger.info('spotter', 'config loaded', spotterLogSummary(config))
    ctx.broadcast(SPOTTER_CHANNELS.configEvent, config)
  })

  ctx.ipcMain.handle(SPOTTER_CHANNELS.getConfig, async () => {
    await initialConfigReady
    return config
  })

  ctx.ipcMain.handle(SPOTTER_CHANNELS.setConfig, async (_event, patch: SpotterConfigPatch) => {
    await initialConfigReady
    config = mergeSpotterConfig(config, {
      ...(patch ?? {}),
      ...(activeSpeechLanguage ? { language: activeSpeechLanguage } : {})
    })
    logger.info('spotter', 'config changed', spotterLogSummary(config))
    await saveConfig(configPath, config)
    ctx.broadcast(SPOTTER_CHANNELS.configEvent, config)
    return config
  })

  // The user imported the `spotter` section: re-read the just-overwritten file
  // and re-broadcast so the SpotterView + renderer runtime pick up the new voices/
  // callouts live, with no restart. Replacing our cached `config` also means a
  // later setConfig merges onto the imported state, not the stale boot copy.
  const onSectionReload = (_event: unknown, sectionId: string): void => {
    if (sectionId !== 'spotter') return
    void loadConfig(configPath).then((loaded) => {
      config =
        activeSpeechLanguage && loaded.language !== activeSpeechLanguage
          ? { ...loaded, language: activeSpeechLanguage, updatedAt: Date.now() }
          : loaded
      logger.info('spotter', 'config reloaded after import (hot-apply)', spotterLogSummary(config))
      ctx.broadcast(SPOTTER_CHANNELS.configEvent, config)
    })
  }
  ctx.ipcMain.on(CONFIG_SECTION_RELOAD_SIGNAL, onSectionReload)
  ctx.app.once('before-quit', () => {
    offSettings()
    ctx.ipcMain.off(CONFIG_SECTION_RELOAD_SIGNAL, onSectionReload)
  })
}

// Compact, secret-free snapshot of the spotter config for the diagnostic log: the
// master switches plus the proximity ("carro à esquerda/direita") callout's own
// voice, so a capture can explain a "voice didn't change" report. The actual
// per-callout calls (side / source field / resolved voice) are logged at fire time
// by the renderer runtime (src/renderer/src/lib/spotter-runtime.ts).
function spotterLogSummary(cfg: SpotterConfig): Record<string, unknown> {
  const proximity = cfg.callouts['proximity.spotter']
  return {
    enabled: cfg.enabled,
    muted: cfg.muted,
    language: cfg.language,
    defaultVoiceURI: cfg.defaultVoiceURI || '(language default)',
    proximityEnabled: proximity?.enabled,
    proximityVoiceURI: proximity?.voiceURI || '(default)'
  }
}

async function loadConfig(configPath: string): Promise<SpotterConfig> {
  try {
    const raw = await readFile(configPath, 'utf8')
    const parsed = JSON.parse(raw) as SpotterConfigPatch
    return mergeSpotterConfig(DEFAULT_SPOTTER_CONFIG, parsed)
  } catch {
    return { ...DEFAULT_SPOTTER_CONFIG, updatedAt: Date.now() }
  }
}

async function saveConfig(configPath: string, nextConfig: SpotterConfig): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8')
}
