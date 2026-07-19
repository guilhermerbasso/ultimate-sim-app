// Tátil / Bass Shaker & Haptics — main-process module.
//
// Two jobs, both additive (no central file is edited):
//   1. PERSISTENCE + IPC for the haptics config (mirrors modules/soundshift.ts):
//      load/save `haptics.json` in userData, expose haptics:getConfig/setConfig
//      and broadcast haptics:config so every window (and the renderer Web Audio
//      engine) stays in sync.
//   2. OPTIONAL Arduino vibration-motor path (SECONDARY): when enabled, route a
//      few DISCRETE effects (gear shift, ABS, wheel-lock, kerb, impact) to a
//      buzzer/PWM motor on a companion serial device using the EXISTING
//      device-output primitives — companion `Z<freq>:<ms>` frames over the
//      serial hub. The bass-shaker AUDIO path in the renderer is the primary
//      deliverable; this just adds tactile buzzes on the buttonbox/wheel.
//
// Safety mirrors modules/device-output.ts: never target the SIM-X primary, skip
// closed/missing devices, throttle per effect, and swallow serial errors so a
// disconnected motor never crashes the telemetry loop.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ModuleContext } from '../module-context'
import type { SerialDevice } from '../serial/device'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import { formatBuzzer } from '../../shared/companion'
import {
  isActuatingHapticIntensity,
  type CueHapticPattern
} from '../../shared/accessibility-cues'
import { isAccessibilityCueRendererHapticAvailable } from './accessibility-cues'
import {
  DEFAULT_HAPTICS_CONFIG,
  HAPTICS_CHANNELS,
  HAPTICS_EFFECT_IDS,
  clamp,
  deriveHapticsFrame,
  effectLevel,
  type HapticsArduinoConfig,
  type HapticsConfig,
  type HapticsEffectConfig,
  type HapticsEffectId,
  type HapticsFrame
} from '../../shared/haptics'

const CONFIG_FILE = 'haptics.json'

// Effects suitable for a single buzzer/vibration motor. Engine + road texture are
// continuous wide-band rumble (bass-shaker only), so they are intentionally excluded.
const ARDUINO_SUSTAINED: HapticsEffectId[] = ['abs', 'wheelLock', 'suspension']
const ARDUINO_TRANSIENT: HapticsEffectId[] = ['gearShift', 'kerb', 'impact', 'tcCut', 'gearGrind']

type HapticsEffectPatch = Partial<HapticsEffectConfig>
type HapticsConfigPatch = {
  version?: 1
  enabled?: boolean
  muted?: boolean
  masterGain?: number
  outputDeviceId?: string
  effects?: Partial<Record<HapticsEffectId, HapticsEffectPatch>>
  arduino?: Partial<HapticsArduinoConfig>
  updatedAt?: number
}

let config: HapticsConfig = DEFAULT_HAPTICS_CONFIG
let previousSnapshot: TelemetrySnapshot | null = null
const lastBuzzAt: Partial<Record<HapticsEffectId, number>> = {}
const accessibilityBuzzTimers = new Set<ReturnType<typeof setTimeout>>()
let accessibilityBuzzPriority = -1
let accessibilityBuzzGeneration = 0

export function isAccessibilityHapticsEnabled(): boolean {
  return (
    config.enabled &&
    !config.muted &&
    isActuatingHapticIntensity(config.masterGain)
  )
}

export function canDeliverAccessibilityHaptic(
  hapticsConfig: HapticsConfig,
  profileIntensity: number,
  rendererAvailable: boolean,
  actuatorAvailable: boolean
): boolean {
  return (
    hapticsConfig.enabled &&
    !hapticsConfig.muted &&
    isActuatingHapticIntensity(hapticsConfig.masterGain) &&
    isActuatingHapticIntensity(profileIntensity) &&
    (rendererAvailable || actuatorAvailable)
  )
}

export function isAccessibilityHapticsAvailable(
  ctx: ModuleContext,
  profileIntensity: number
): boolean {
  return canDeliverAccessibilityHaptic(
    config,
    profileIntensity,
    isAccessibilityCueRendererHapticAvailable(),
    Boolean(config.arduino.enabled && resolveArduinoDevice(ctx))
  )
}

export function dispatchAccessibilityCueHaptic(
  ctx: ModuleContext,
  pattern: CueHapticPattern,
  intensity: number,
  priority = 0
): boolean {
  if (!isActuatingHapticIntensity(intensity)) return false
  if (!isAccessibilityHapticsEnabled()) return false
  const rendererAvailable = isAccessibilityCueRendererHapticAvailable()
  if (!config.arduino.enabled) return rendererAvailable
  const device = resolveArduinoDevice(ctx)
  if (!device) return rendererAvailable
  if (priority < accessibilityBuzzPriority) return rendererAvailable
  cancelAccessibilityBuzz()
  accessibilityBuzzPriority = priority
  const generation = ++accessibilityBuzzGeneration

  const effect = config.effects.impact
  const safeIntensity = clamp(intensity, 0, 1, 0.7)
  const pulseCount = pattern === 'triple' ? 3 : pattern === 'double' ? 2 : 1
  const pulseDuration = pattern === 'long'
    ? Math.round(180 + safeIntensity * 100)
    : Math.round(55 + safeIntensity * 75)
  const spacingMs = pulseDuration + 70

  for (let index = 0; index < pulseCount; index += 1) {
    const timer = setTimeout(() => {
      accessibilityBuzzTimers.delete(timer)
      if (
        generation !== accessibilityBuzzGeneration ||
        !device.isOpen()
      ) {
        return
      }
      void device
        .sendRaw(formatBuzzer(effect.frequencyHz, pulseDuration))
        .catch(() => undefined)
    }, index * spacingMs)
    accessibilityBuzzTimers.add(timer)
  }
  const releaseTimer = setTimeout(() => {
    accessibilityBuzzTimers.delete(releaseTimer)
    if (generation === accessibilityBuzzGeneration) {
      accessibilityBuzzPriority = -1
    }
  }, pulseCount * spacingMs)
  accessibilityBuzzTimers.add(releaseTimer)
  return true
}

function cancelAccessibilityBuzz(): void {
  accessibilityBuzzGeneration += 1
  for (const timer of accessibilityBuzzTimers) clearTimeout(timer)
  accessibilityBuzzTimers.clear()
  accessibilityBuzzPriority = -1
}

export function register(ctx: ModuleContext): void {
  const configPath = join(ctx.app.getPath('userData'), CONFIG_FILE)
  cancelAccessibilityBuzz()

  void loadConfig(configPath).then((loaded) => {
    config = loaded
    ctx.broadcast(HAPTICS_CHANNELS.configEvent, config)
  })

  ctx.telemetryHub.on('snapshot', (snapshot: TelemetrySnapshot | null) => {
    processSnapshot(ctx, snapshot)
  })

  ctx.ipcMain.handle(HAPTICS_CHANNELS.getConfig, () => config)

  ctx.ipcMain.handle(HAPTICS_CHANNELS.setConfig, async (_event, patch: HapticsConfigPatch) => {
    config = mergeConfig(config, patch)
    if (!isAccessibilityHapticsEnabled()) cancelAccessibilityBuzz()
    await saveConfig(configPath, config)
    ctx.broadcast(HAPTICS_CHANNELS.configEvent, config)
    return config
  })

  // Fire a single test buzz on the configured Arduino device for one effect.
  ctx.ipcMain.handle(HAPTICS_CHANNELS.testArduino, async (_event, effectIdArg: HapticsEffectId) => {
    const effectId = HAPTICS_EFFECT_IDS.includes(effectIdArg) ? effectIdArg : 'gearShift'
    const device = resolveArduinoDevice(ctx)
    if (!device) throw new Error('No valid Arduino device selected for haptics.')
    const eff = config.effects[effectId]
    await device.sendRaw(formatBuzzer(eff.frequencyHz, 140)).catch((error: unknown) => {
      throw new Error(error instanceof Error ? error.message : String(error))
    })
    return true
  })
  ctx.app.once('before-quit', cancelAccessibilityBuzz)
}

// ─── Telemetry → optional Arduino buzzes ──────────────────────────────────────

function processSnapshot(ctx: ModuleContext, snapshot: TelemetrySnapshot | null): void {
  if (!snapshot) {
    previousSnapshot = null
    return
  }
  if (config.arduino.enabled) {
    const frame = deriveHapticsFrame(snapshot, previousSnapshot)
    driveArduino(ctx, frame)
  }
  previousSnapshot = snapshot
}

function driveArduino(ctx: ModuleContext, frame: HapticsFrame): void {
  const device = resolveArduinoDevice(ctx)
  if (!device) return
  const now = Date.now()
  const minInterval = config.arduino.minIntervalMs

  for (const id of ARDUINO_SUSTAINED) {
    const eff = config.effects[id]
    if (!eff.enabled || !eff.arduino) continue
    let raw: number
    if (id === 'abs') raw = frame.absActive ? 1 : 0
    else if (id === 'suspension') raw = frame.suspension
    else raw = frame.wheelLock
    const level = effectLevel(raw, eff)
    if (level > 0 && canBuzz(id, now, minInterval)) sendBuzz(device, eff, level)
  }

  for (const id of ARDUINO_TRANSIENT) {
    const eff = config.effects[id]
    if (!eff.enabled || !eff.arduino) continue
    let raw: number
    if (id === 'gearShift') raw = frame.gearShift ? 1 : 0
    else if (id === 'kerb') raw = frame.kerb
    else if (id === 'tcCut') raw = frame.tcCut ? 1 : 0
    else if (id === 'gearGrind') raw = frame.gearGrind ? 1 : 0
    else raw = frame.impact
    const level = effectLevel(raw, eff)
    if (level > 0 && canBuzz(id, now, minInterval)) sendBuzz(device, eff, level)
  }
}

function sendBuzz(device: SerialDevice, eff: HapticsEffectConfig, level: number): void {
  // A vibration motor takes an intensity, but the companion `Z` frame is freq:ms,
  // so map intensity → pulse duration (stronger effect = longer buzz).
  const durationMs = Math.round(clamp(60 + 140 * level, 40, 240, 120))
  void device.sendRaw(formatBuzzer(eff.frequencyHz, durationMs)).catch(() => undefined)
}

function resolveArduinoDevice(ctx: ModuleContext): SerialDevice | null {
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

function canBuzz(id: HapticsEffectId, now: number, intervalMs: number): boolean {
  const last = lastBuzzAt[id] ?? 0
  if (now - last < Math.max(40, intervalMs)) return false
  lastBuzzAt[id] = now
  return true
}

// ─── Persistence ──────────────────────────────────────────────────────────────

async function loadConfig(configPath: string): Promise<HapticsConfig> {
  try {
    const raw = await readFile(configPath, 'utf8')
    const parsed = JSON.parse(raw) as HapticsConfigPatch
    return mergeConfig(DEFAULT_HAPTICS_CONFIG, parsed)
  } catch {
    return { ...DEFAULT_HAPTICS_CONFIG, updatedAt: Date.now() }
  }
}

async function saveConfig(configPath: string, nextConfig: HapticsConfig): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8')
}

function mergeConfig(base: HapticsConfig, patch: HapticsConfigPatch): HapticsConfig {
  return {
    version: 1,
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : base.enabled,
    muted: typeof patch.muted === 'boolean' ? patch.muted : base.muted,
    masterGain: clamp(patch.masterGain ?? base.masterGain, 0, 1, base.masterGain),
    outputDeviceId: sanitizeId(patch.outputDeviceId ?? base.outputDeviceId),
    effects: mergeEffects(base.effects, patch.effects ?? {}),
    arduino: mergeArduino(base.arduino, patch.arduino ?? {}),
    updatedAt: Date.now()
  }
}

function mergeEffects(
  base: Record<HapticsEffectId, HapticsEffectConfig>,
  patch: Partial<Record<HapticsEffectId, HapticsEffectPatch>>
): Record<HapticsEffectId, HapticsEffectConfig> {
  const next = {} as Record<HapticsEffectId, HapticsEffectConfig>
  for (const id of HAPTICS_EFFECT_IDS) next[id] = mergeEffect(base[id], patch[id] ?? {})
  return next
}

function mergeEffect(base: HapticsEffectConfig, patch: HapticsEffectPatch): HapticsEffectConfig {
  const merged: HapticsEffectConfig = {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : base.enabled,
    frequencyHz: clamp(patch.frequencyHz ?? base.frequencyHz, 20, 200, base.frequencyHz),
    intensity: clamp(patch.intensity ?? base.intensity, 0, 1, base.intensity),
    minThreshold: clamp(patch.minThreshold ?? base.minThreshold, 0, 1, base.minThreshold),
    maxThreshold: clamp(patch.maxThreshold ?? base.maxThreshold, 0, 1, base.maxThreshold),
    smoothing: clamp(patch.smoothing ?? base.smoothing, 0, 1, base.smoothing),
    arduino: typeof patch.arduino === 'boolean' ? patch.arduino : base.arduino
  }
  const sweep = patch.frequencyToHz ?? base.frequencyToHz
  if (sweep != null) merged.frequencyToHz = clamp(sweep, 20, 200, base.frequencyToHz ?? sweep)
  return merged
}

function mergeArduino(base: HapticsArduinoConfig, patch: Partial<HapticsArduinoConfig>): HapticsArduinoConfig {
  return {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : base.enabled,
    deviceId: sanitizeId(patch.deviceId ?? base.deviceId),
    minIntervalMs: Math.round(clamp(patch.minIntervalMs ?? base.minIntervalMs, 40, 2000, base.minIntervalMs))
  }
}

function sanitizeId(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}
