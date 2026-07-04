// Zonal Haptics — main-process module.
//
// Additive (no central file edited), mirroring modules/haptics.ts:
//   1. PERSISTENCE + IPC for the zonal-haptics config: load/save
//      `haptics-zonal.json` in userData, expose hapticsZonal:getConfig/setConfig
//      and broadcast hapticsZonal:config so the config view stays in sync.
//   2. OUTPUT: run the PURE zonal mapper (shared/haptics-zonal.ts) on telemetry
//      (throttled) and drive the OPTIONAL secondary serial buzzer with the
//      strongest live zone intensity, REUSING the exact device primitives the
//      haptics module already uses (serialHub.getDevice + companion `Z` frame
//      via formatBuzzer + device.sendRaw). It never targets the SIM-X primary
//      and swallows serial errors so a disconnected motor can't crash the loop.
//
// The PRIMARY per-zone tactile feel needs bass-shaker / tactile TRANSDUCERS on
// per-zone amplifier channels — this module produces the per-zone intensity
// signal; the renderer view renders a VISUAL simulator so the mapping is usable
// WITHOUT any transducer, and this buzzer path is only a coarse single-motor cue.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ModuleContext } from '../module-context'
import type { SerialDevice } from '../serial/device'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import { formatBuzzer } from '../../shared/companion'
import { logger } from './logger'
import {
  DEFAULT_HAPTICS_ZONAL_CONFIG,
  HAPTICS_ZONAL_CHANNELS,
  HAPTIC_EVENT_IDS,
  HAPTIC_ZONE_IDS,
  computeZonalHaptics,
  mapEventsToZones,
  mergeHapticsZonalConfig,
  rawEventsForTest,
  type HapticEventId,
  type HapticsZonalConfig,
  type HapticsZonalConfigPatch,
  type ZonalFrame
} from '../../shared/haptics-zonal'

const CONFIG_FILE = 'haptics-zonal.json'

let config: HapticsZonalConfig = DEFAULT_HAPTICS_ZONAL_CONFIG
let previousSnapshot: TelemetrySnapshot | null = null
let lastBuzzAt = 0

export function register(ctx: ModuleContext): void {
  const configPath = join(ctx.app.getPath('userData'), CONFIG_FILE)

  void loadConfig(configPath).then((loaded) => {
    config = loaded
    logger.info('haptics-zonal', 'config loaded', zonalLogSummary(config))
    ctx.broadcast(HAPTICS_ZONAL_CHANNELS.configEvent, config)
  })

  ctx.telemetryHub.on('snapshot', (snapshot: TelemetrySnapshot | null) => {
    processSnapshot(ctx, snapshot)
  })

  ctx.ipcMain.handle(HAPTICS_ZONAL_CHANNELS.getConfig, () => config)

  ctx.ipcMain.handle(HAPTICS_ZONAL_CHANNELS.setConfig, async (_event, patch: HapticsZonalConfigPatch) => {
    config = mergeHapticsZonalConfig(config, patch ?? {})
    logger.info('haptics-zonal', 'config changed', zonalLogSummary(config))
    await saveConfig(configPath, config)
    ctx.broadcast(HAPTICS_ZONAL_CHANNELS.configEvent, config)
    return config
  })

  // Fire a one-shot test for a single event: compute its per-zone intensities
  // (forcing the engine ON so the test works even while globally disabled) and
  // buzz the configured device with the strongest zone. Returns the ZonalFrame
  // so the renderer can flash its visual simulator in lock-step.
  ctx.ipcMain.handle(HAPTICS_ZONAL_CHANNELS.test, async (_event, eventIdArg: HapticEventId, intensityArg?: number) => {
    const eventId = HAPTIC_EVENT_IDS.includes(eventIdArg) ? eventIdArg : 'contact'
    const intensity = clampUnit(typeof intensityArg === 'number' ? intensityArg : 1)
    const forced: HapticsZonalConfig = { ...config, enabled: true, muted: false }
    const frame = mapEventsToZones(rawEventsForTest(eventId, intensity), forced)
    const device = resolveBuzzerDevice(ctx)
    if (device) sendBuzz(device, peakZone(frame), config.arduino.frequencyHz)
    return frame
  })
}

// ─── Telemetry → optional serial buzzer ───────────────────────────────────────

function processSnapshot(ctx: ModuleContext, snapshot: TelemetrySnapshot | null): void {
  if (!snapshot) {
    previousSnapshot = null
    return
  }
  if (config.enabled && !config.muted && config.arduino.enabled) {
    const frame = computeZonalHaptics(snapshot, previousSnapshot, config)
    driveBuzzer(ctx, frame)
  }
  previousSnapshot = snapshot
}

function driveBuzzer(ctx: ModuleContext, frame: ZonalFrame): void {
  const peak = peakZone(frame)
  if (peak <= 0) return
  const device = resolveBuzzerDevice(ctx)
  if (!device) return
  const now = Date.now()
  if (now - lastBuzzAt < Math.max(30, config.minIntervalMs)) return
  lastBuzzAt = now
  sendBuzz(device, peak, config.arduino.frequencyHz)
}

function peakZone(frame: ZonalFrame): number {
  let peak = 0
  for (const id of HAPTIC_ZONE_IDS) peak = Math.max(peak, frame.zones[id])
  return peak
}

function sendBuzz(device: SerialDevice, level: number, frequencyHz: number): void {
  // A single motor takes an intensity, but the companion `Z` frame is freq:ms,
  // so map intensity → pulse duration (stronger zone = longer buzz).
  const durationMs = Math.round(60 + 160 * clampUnit(level))
  void device.sendRaw(formatBuzzer(frequencyHz, durationMs)).catch(() => undefined)
}

// Resolve the configured secondary device, mirroring haptics.ts safety: must
// exist, be open, not be a SIM-X device, and not be the primary.
function resolveBuzzerDevice(ctx: ModuleContext): SerialDevice | null {
  const deviceId = config.arduino.deviceId
  if (!deviceId) return null
  const device = ctx.serialHub.getDevice(deviceId)
  if (!device) return null
  if (device.kind === 'sim-x') return null
  const primaryId = ctx.serialHub.getPrimaryId()
  if (primaryId && device.id === primaryId) return null
  if (!device.isOpen()) return null
  return device
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  return value < 0 ? 0 : value > 1 ? 1 : value
}

// ─── Persistence ──────────────────────────────────────────────────────────────

async function loadConfig(configPath: string): Promise<HapticsZonalConfig> {
  try {
    const raw = await readFile(configPath, 'utf8')
    const parsed = JSON.parse(raw) as HapticsZonalConfigPatch
    return mergeHapticsZonalConfig(DEFAULT_HAPTICS_ZONAL_CONFIG, parsed)
  } catch {
    return { ...DEFAULT_HAPTICS_ZONAL_CONFIG, updatedAt: Date.now() }
  }
}

async function saveConfig(configPath: string, nextConfig: HapticsZonalConfig): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8')
}

function zonalLogSummary(cfg: HapticsZonalConfig): Record<string, unknown> {
  return {
    enabled: cfg.enabled,
    muted: cfg.muted,
    masterGain: cfg.masterGain,
    arduinoEnabled: cfg.arduino.enabled,
    arduinoDevice: cfg.arduino.deviceId || '(none)',
    enabledEvents: HAPTIC_EVENT_IDS.filter((id) => cfg.events[id].enabled),
    enabledZones: HAPTIC_ZONE_IDS.filter((id) => cfg.zones[id].enabled)
  }
}
