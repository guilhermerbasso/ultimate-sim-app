// 3D Spotter — main-process module (config persistence + IPC).
//
// Mirrors modules/spotter.ts: this module owns ONLY the config lifecycle. All
// spatial-audio work happens in the renderer (lib/spotter-3d.ts) via Web Audio;
// here we load/save `spotter3d.json` in userData and expose
// spotter3d:getConfig/setConfig plus a spotter3d:config broadcast so the
// Spotter3DView and the audio engine stay in sync across reloads/windows.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ModuleContext } from '../module-context'
import { logger } from './logger'
import {
  DEFAULT_SPOTTER_3D_CONFIG,
  SPOTTER_3D_CHANNELS,
  mergeSpotter3DConfig,
  type Spotter3DConfig,
  type Spotter3DConfigPatch
} from '../../shared/spotter3d'

const CONFIG_FILE = 'spotter3d.json'

let config: Spotter3DConfig = DEFAULT_SPOTTER_3D_CONFIG

export function register(ctx: ModuleContext): void {
  const configPath = join(ctx.app.getPath('userData'), CONFIG_FILE)

  void loadConfig(configPath).then(async (loaded) => {
    config = loaded
    logger.info('spotter3d', 'config loaded', { enabled: config.enabled, maxVoices: config.maxVoices })
    // Persist the merged config on first run so the default-enabled state is
    // written to disk (and survives even if the renderer never opens the view).
    await saveConfig(configPath, config).catch(() => undefined)
    ctx.broadcast(SPOTTER_3D_CHANNELS.configEvent, config)
  })

  ctx.ipcMain.handle(SPOTTER_3D_CHANNELS.getConfig, () => config)

  ctx.ipcMain.handle(SPOTTER_3D_CHANNELS.setConfig, async (_event, patch: Spotter3DConfigPatch) => {
    config = mergeSpotter3DConfig(config, patch ?? {})
    logger.info('spotter3d', 'config changed', { enabled: config.enabled })
    await saveConfig(configPath, config)
    ctx.broadcast(SPOTTER_3D_CHANNELS.configEvent, config)
    return config
  })
}

async function loadConfig(configPath: string): Promise<Spotter3DConfig> {
  try {
    const raw = await readFile(configPath, 'utf8')
    const parsed = JSON.parse(raw) as Spotter3DConfigPatch
    return mergeSpotter3DConfig(DEFAULT_SPOTTER_3D_CONFIG, parsed)
  } catch {
    return { ...DEFAULT_SPOTTER_3D_CONFIG, updatedAt: Date.now() }
  }
}

async function saveConfig(configPath: string, nextConfig: Spotter3DConfig): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8')
}
