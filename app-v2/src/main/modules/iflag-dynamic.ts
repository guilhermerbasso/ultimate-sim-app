// iFlag Dynamic Info Panel — main-process module.
//
// Additive (no central file edited), mirroring modules/spotter.ts persistence:
//   1. PERSISTENCE + IPC for the dynamic-panel config: load/save
//      `iflag-dynamic.json` in userData, expose iflagDynamic:getConfig/setConfig
//      and broadcast iflagDynamic:config.
//   2. ON-DEMAND RENDER: cache the latest telemetry snapshot and, via
//      iflagDynamic:render, return the freshly generated 8×8 frame (hex grid +
//      RgbFrame) and the structured race-state readout. The frame generator
//      itself is the PURE, standalone shared/iflag-dynamic.ts.
//
// This module does NOT stream to the matrix on its own — it is a STANDALONE
// generator. To route it onto the physical iFlag as a new matrix MODE, the
// rgb-matrix orchestrator only needs to call the returned handle's getHexGrid()
// when its mode === 'dynamic' (see REGISTRATION NEEDED in the task report); the
// frame format (HexGrid / RgbFrame) already matches shared/rgb-matrix.ts, so no
// change to the matrix frame pipeline is required.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ModuleContext } from '../module-context'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import type { HexGrid, RgbFrame } from '../../shared/rgb-matrix'
import { logger } from './logger'
import {
  DEFAULT_IFLAG_DYNAMIC_CONFIG,
  IFLAG_DYNAMIC_CHANNELS,
  computeIflagReadout,
  mergeIflagDynamicConfig,
  renderIflagDynamicFrame,
  renderIflagDynamicHexGrid,
  type IflagDynamicConfig,
  type IflagDynamicConfigPatch,
  type IflagDynamicReadout
} from '../../shared/iflag-dynamic'

const CONFIG_FILE = 'iflag-dynamic.json'

// Handle returned to index.ts so the rgb-matrix orchestrator can pull the live
// frame when routing a NEW 'dynamic' matrix mode. Optional to wire — the module
// is fully functional (config + render IPC) without it.
export interface IflagDynamicModule {
  isEnabled(): boolean
  getConfig(): IflagDynamicConfig
  getHexGrid(): HexGrid | null
  getFrame(): RgbFrame | null
  getReadout(): IflagDynamicReadout | null
}

interface IflagDynamicRenderResult {
  connected: boolean
  hexGrid: HexGrid
  frame: RgbFrame
  readout: IflagDynamicReadout | null
}

export function register(ctx: ModuleContext): IflagDynamicModule {
  const configPath = join(ctx.app.getPath('userData'), CONFIG_FILE)
  let config: IflagDynamicConfig = DEFAULT_IFLAG_DYNAMIC_CONFIG
  let latest: TelemetrySnapshot | null = null

  void loadConfig(configPath).then((loaded) => {
    config = loaded
    logger.info('iflag-dynamic', 'config loaded', { enabled: config.enabled })
    ctx.broadcast(IFLAG_DYNAMIC_CHANNELS.configEvent, config)
  })

  ctx.telemetryHub.on('snapshot', (snapshot: TelemetrySnapshot | null) => {
    latest = snapshot
  })

  ctx.ipcMain.handle(IFLAG_DYNAMIC_CHANNELS.getConfig, () => config)

  ctx.ipcMain.handle(IFLAG_DYNAMIC_CHANNELS.setConfig, async (_event, patch: IflagDynamicConfigPatch) => {
    config = mergeIflagDynamicConfig(config, patch ?? {})
    logger.info('iflag-dynamic', 'config changed', { enabled: config.enabled })
    await saveConfig(configPath, config)
    ctx.broadcast(IFLAG_DYNAMIC_CHANNELS.configEvent, config)
    return config
  })

  // Render the current frame on demand from the latest snapshot. Accepts an
  // optional snapshot override (handy for previews/tests) — otherwise uses the
  // cached live telemetry.
  ctx.ipcMain.handle(IFLAG_DYNAMIC_CHANNELS.render, (_event, override?: TelemetrySnapshot | null) => {
    const snap = override ?? latest
    return renderResult(snap, config)
  })

  return {
    isEnabled: () => config.enabled,
    getConfig: () => config,
    getHexGrid: () => (latest && latest.connected ? renderIflagDynamicHexGrid(latest, config) : null),
    getFrame: () => (latest && latest.connected ? renderIflagDynamicFrame(latest, config) : null),
    getReadout: () => (latest && latest.connected ? computeIflagReadout(latest, config) : null)
  }
}

function renderResult(snap: TelemetrySnapshot | null, config: IflagDynamicConfig): IflagDynamicRenderResult {
  const connected = Boolean(snap && snap.connected)
  return {
    connected,
    hexGrid: renderIflagDynamicHexGrid(snap, config),
    frame: renderIflagDynamicFrame(snap, config),
    readout: connected && snap ? computeIflagReadout(snap, config) : null
  }
}

// ─── Persistence ──────────────────────────────────────────────────────────────

async function loadConfig(configPath: string): Promise<IflagDynamicConfig> {
  try {
    const raw = await readFile(configPath, 'utf8')
    const parsed = JSON.parse(raw) as IflagDynamicConfigPatch
    return mergeIflagDynamicConfig(DEFAULT_IFLAG_DYNAMIC_CONFIG, parsed)
  } catch {
    return { ...DEFAULT_IFLAG_DYNAMIC_CONFIG, updatedAt: Date.now() }
  }
}

async function saveConfig(configPath: string, nextConfig: IflagDynamicConfig): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8')
}
