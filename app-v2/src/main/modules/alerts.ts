import type { ModuleContext } from '../module-context'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  DEFAULT_ALERTS_CONFIG,
  type AlertEvent,
  type AlertOutput,
  type AlertOutputButtonbox,
  type AlertOutputSecondScreen,
  type AlertOutputSerial,
  type AlertOutputSound,
  type AlertSoundPayload,
  type AlertRuleConfig,
  type AlertSeverity,
  type AlertsConfig,
  type AlertsConfigPatch,
  type AlertType
} from '../../shared/alerts'
import {
  OUTPUTS_CHANNELS,
  type OutputSecondScreenUpdate,
  interpolateTemplate
} from '../../shared/outputs'
import { AlertsDetector } from '../alerts/detector'

const CONFIG_FILE = 'alerts-config.json'

// Minimum spacing between two serial sends caused by the SAME output (per
// rule × output index). Acts as a debounce guard so a flapping condition
// never spams the wire even if a user sets a tiny rule cooldown.
const SERIAL_OUTPUT_DEBOUNCE_MS = 250

// Default transient durations for buttonbox presets (ms). Users can override
// per output via `durationMs`.
const BUTTONBOX_DEFAULTS = {
  startLedFlash: 800,
  revLightsPulse: 600,
  shiftBlink: 600,
  oledMessage: 2500,
  bigNum: 2500
} as const

let config: AlertsConfig = DEFAULT_ALERTS_CONFIG
let detector: AlertsDetector | null = null

// Pending transient SIM-X effects keyed by alertKey (rule+outputIdx). Allows
// us to cancel a previous timer when a new event re-arms the same effect.
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>()
// Last serial send timestamp keyed by (ruleType:outputIdx:deviceId).
const lastSerialSendAt = new Map<string, number>()

export function register(ctx: ModuleContext): void {
  const configPath = join(ctx.app.getPath('userData'), CONFIG_FILE)
  detector = new AlertsDetector(config)

  void loadConfig(configPath).then((loaded) => {
    config = loaded
    detector?.setConfig(config)
  })

  ctx.telemetryHub.on('snapshot', (snapshot) => {
    if (!detector) return
    for (const event of detector.process(snapshot)) {
      const eventWithSound = attachSoundPayload(event)
      ctx.broadcast('alerts:event', eventWithSound)
      dispatchOutputs(ctx, eventWithSound)
    }
  })

  ctx.ipcMain.handle('alerts:getConfig', () => config)
  ctx.ipcMain.handle('alerts:setConfig', async (_event, patch: AlertsConfigPatch) => {
    config = mergeConfig(config, patch)
    detector?.setConfig(config)
    await saveConfig(configPath, config)
    return config
  })
}

// ─── Output dispatch ───────────────────────────────────────────────────────

function dispatchOutputs(ctx: ModuleContext, event: AlertEvent): void {
  const rule = ruleForType(config, event.type)
  if (!rule?.outputs?.length) return

  rule.outputs.forEach((output, index) => {
    if (output.enabled === false) return
    try {
      switch (output.kind) {
        case 'buttonbox':
          dispatchButtonbox(ctx, output, event, index)
          break
        case 'serial':
          dispatchSerial(ctx, output, event, index)
          break
        case 'secondScreen':
          dispatchSecondScreen(ctx, output, event, index)
          break
        case 'sound':
          break
      }
    } catch (error) {
      console.warn(`[alerts] output #${index} (${output.kind}) for ${event.type} failed:`, error)
    }
  })
}

function attachSoundPayload(event: AlertEvent): AlertEvent {
  const sound = ruleForType(config, event.type)?.outputs?.find(
    (output): output is AlertOutputSound => output.kind === 'sound' && output.enabled !== false
  )
  if (!sound) return event

  const payload: AlertSoundPayload = {
    toneHz: sound.toneHz,
    durationMs: sound.durationMs,
    volume: sound.volume
  }
  return { ...event, sound: payload }
}

function dispatchButtonbox(
  ctx: ModuleContext,
  output: AlertOutputButtonbox,
  event: AlertEvent,
  index: number
): void {
  const device = ctx.serialHub.getPrimary()
  if (!device) return

  const key = `bb:${event.type}:${index}`
  const existing = pendingTimers.get(key)
  if (existing) clearTimeout(existing)

  const extras = templateExtras(event)
  switch (output.preset) {
    case 'startLedFlash': {
      void device.sendRaw('S1').catch(() => undefined)
      const duration = clampMs(output.durationMs, BUTTONBOX_DEFAULTS.startLedFlash)
      pendingTimers.set(
        key,
        setTimeout(() => {
          pendingTimers.delete(key)
          void device.sendRaw('S0').catch(() => undefined)
        }, duration)
      )
      break
    }
    case 'revLightsPulse': {
      const level = clampLevel(output.revLevel)
      void device.sendRaw(`R${level}`).catch(() => undefined)
      const duration = clampMs(output.durationMs, BUTTONBOX_DEFAULTS.revLightsPulse)
      pendingTimers.set(
        key,
        setTimeout(() => {
          pendingTimers.delete(key)
          void device.sendRaw('R0').catch(() => undefined)
        }, duration)
      )
      break
    }
    case 'shiftBlink': {
      void device.sendRaw('B1').catch(() => undefined)
      const duration = clampMs(output.durationMs, BUTTONBOX_DEFAULTS.shiftBlink)
      pendingTimers.set(
        key,
        setTimeout(() => {
          pendingTimers.delete(key)
          void device.sendRaw('B0').catch(() => undefined)
        }, duration)
      )
      break
    }
    case 'oledMessage': {
      const line1 = renderLine(output.oledLine1 ?? '${message}', event, extras)
      const line2 = renderLine(output.oledLine2 ?? '', event, extras)
      const line3 = renderLine(output.oledLine3 ?? '', event, extras)
      void device.sendOled(line1.slice(0, 16), line2.slice(0, 16), line3.slice(0, 16)).catch(() => undefined)
      // OLED is sticky — schedule a clear unless durationMs <= 0.
      const duration = clampMs(output.durationMs, BUTTONBOX_DEFAULTS.oledMessage)
      if (duration > 0) {
        pendingTimers.set(
          key,
          setTimeout(() => {
            pendingTimers.delete(key)
            void device.sendOled('', '', '').catch(() => undefined)
          }, duration)
        )
      }
      break
    }
    case 'bigNum': {
      const value = renderLine(output.bigNumValue ?? '${value}', event, extras)
      void device.sendBigNum(value.slice(0, 8)).catch(() => undefined)
      break
    }
  }
}

function dispatchSerial(
  ctx: ModuleContext,
  output: AlertOutputSerial,
  event: AlertEvent,
  index: number
): void {
  const deviceId = output.deviceId && output.deviceId !== 'primary' ? output.deviceId : ctx.serialHub.getPrimaryId()
  if (!deviceId) return
  const device = ctx.serialHub.getDevice(deviceId)
  if (!device || !device.isOpen()) return

  const debounceKey = `serial:${event.type}:${index}:${deviceId}`
  const now = Date.now()
  const lastAt = lastSerialSendAt.get(debounceKey)
  if (lastAt !== undefined && now - lastAt < SERIAL_OUTPUT_DEBOUNCE_MS) return
  lastSerialSendAt.set(debounceKey, now)

  const rendered = renderLine(output.template, event, templateExtras(event))
  if (!rendered) return
  void device.sendRaw(rendered).catch((error: unknown) => {
    console.warn(`[alerts] serial send to "${deviceId}" failed:`, error)
  })
}

function dispatchSecondScreen(
  ctx: ModuleContext,
  output: AlertOutputSecondScreen,
  event: AlertEvent,
  _index: number
): void {
  const value = renderLine(output.template ?? '${message}', event, templateExtras(event))
  const payload: OutputSecondScreenUpdate = {
    routeId: `alert:${event.type}`,
    slot: output.slot,
    value,
    raw: event.severity,
    timestamp: event.timestamp
  }
  ctx.broadcast(OUTPUTS_CHANNELS.secondScreen, payload)
}

function templateExtras(event: AlertEvent): Record<string, string | number | undefined> {
  return {
    message: event.message,
    severity: event.severity,
    type: event.type,
    timestamp: event.timestamp,
    alertId: event.id,
    corner: event.context?.corner,
    threshold: event.context?.threshold,
    unit: event.context?.unit
  }
}

function renderLine(
  template: string,
  event: AlertEvent,
  extras: Record<string, string | number | undefined>
): string {
  const rawValue = event.context?.value
  const valueString =
    rawValue === undefined ? event.message : typeof rawValue === 'number' ? String(rawValue) : String(rawValue)
  return interpolateTemplate(template, { value: valueString, field: event.type, extras })
}

function ruleForType(cfg: AlertsConfig, type: AlertType): AlertRuleConfig | undefined {
  switch (type) {
    case 'pitLimiter':
      return cfg.pitLimiter
    case 'flag':
      return cfg.flags
    case 'lowFuel':
      return cfg.lowFuel
    case 'shiftPoint':
      return cfg.shiftPoint
    case 'incidentLimit':
      return cfg.incidentLimit
    case 'tyrePressure':
      return cfg.tyrePressure
    case 'tyreTemp':
      return cfg.tyreTemp
    case 'brakeTemp':
      return cfg.brakeTemp
    case 'drsAvailable':
      return cfg.drsAvailable
    case 'blueFlag':
      return cfg.blueFlag
  }
}

function clampMs(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value as number)) return fallback
  return Math.max(0, Math.min(60000, Math.floor(value as number)))
}

function clampLevel(value: number | undefined): number {
  if (!Number.isFinite(value as number)) return 4
  return Math.max(0, Math.min(4, Math.floor(value as number)))
}

// ─── Config persistence + sanitization ─────────────────────────────────────

async function loadConfig(configPath: string): Promise<AlertsConfig> {
  try {
    const raw = await readFile(configPath, 'utf8')
    return mergeConfig(DEFAULT_ALERTS_CONFIG, JSON.parse(raw) as AlertsConfigPatch)
  } catch {
    return DEFAULT_ALERTS_CONFIG
  }
}

async function saveConfig(configPath: string, nextConfig: AlertsConfig): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8')
}

function mergeConfig(base: AlertsConfig, patch: AlertsConfigPatch): AlertsConfig {
  return {
    audioEnabled: typeof patch.audioEnabled === 'boolean' ? patch.audioEnabled : base.audioEnabled,
    pitLimiter: sanitizeRule({ ...base.pitLimiter, ...patch.pitLimiter }),
    flags: sanitizeRule({ ...base.flags, ...patch.flags }),
    lowFuel: sanitizeLowFuel({ ...base.lowFuel, ...patch.lowFuel }),
    shiftPoint: sanitizeShiftPoint({ ...base.shiftPoint, ...patch.shiftPoint }),
    incidentLimit: sanitizeIncidentLimit({ ...base.incidentLimit, ...patch.incidentLimit }),
    tyrePressure: sanitizeTyrePressure(
      mergeOptional(base.tyrePressure ?? DEFAULT_ALERTS_CONFIG.tyrePressure, patch.tyrePressure)
    ),
    tyreTemp: sanitizeTyreTemp(
      mergeOptional(base.tyreTemp ?? DEFAULT_ALERTS_CONFIG.tyreTemp, patch.tyreTemp)
    ),
    brakeTemp: sanitizeBrakeTemp(
      mergeOptional(base.brakeTemp ?? DEFAULT_ALERTS_CONFIG.brakeTemp, patch.brakeTemp)
    ),
    drsAvailable: sanitizeRule(mergeOptional(base.drsAvailable ?? DEFAULT_ALERTS_CONFIG.drsAvailable, patch.drsAvailable)),
    blueFlag: sanitizeRule(mergeOptional(base.blueFlag ?? DEFAULT_ALERTS_CONFIG.blueFlag, patch.blueFlag))
  }
}

function mergeOptional<T extends object>(base: T | undefined, patch: Partial<T> | undefined): T {
  return { ...(base as T), ...(patch ?? {}) }
}

function sanitizeRule<T extends AlertRuleConfig>(value: T): T {
  const cleaned: AlertRuleConfig = {
    enabled: value.enabled === true,
    severity: sanitizeSeverity(value.severity),
    cooldownMs: sanitizeCooldown(value.cooldownMs),
    repeatMs: sanitizeRepeat(value.repeatMs),
    outputs: sanitizeOutputs(value.outputs)
  }
  return { ...value, ...cleaned } as T
}

function sanitizeLowFuel(value: AlertsConfig['lowFuel']): AlertsConfig['lowFuel'] {
  return {
    ...sanitizeRule(value),
    lapsThreshold: clamp(value.lapsThreshold, 0.5, 20, DEFAULT_ALERTS_CONFIG.lowFuel.lapsThreshold)
  }
}

function sanitizeShiftPoint(value: AlertsConfig['shiftPoint']): AlertsConfig['shiftPoint'] {
  return {
    ...sanitizeRule(value),
    shiftIndicatorPct: clamp(value.shiftIndicatorPct, 0.5, 1, DEFAULT_ALERTS_CONFIG.shiftPoint.shiftIndicatorPct),
    rpmPct: clamp(value.rpmPct, 0.5, 1, DEFAULT_ALERTS_CONFIG.shiftPoint.rpmPct)
  }
}

function sanitizeIncidentLimit(value: AlertsConfig['incidentLimit']): AlertsConfig['incidentLimit'] {
  return {
    ...sanitizeRule(value),
    remainingThreshold: Math.round(
      clamp(value.remainingThreshold, 0, 20, DEFAULT_ALERTS_CONFIG.incidentLimit.remainingThreshold)
    )
  }
}

function sanitizeTyrePressure(
  value: NonNullable<AlertsConfig['tyrePressure']>
): NonNullable<AlertsConfig['tyrePressure']> {
  return {
    ...sanitizeRule(value),
    minKpa: clamp(value.minKpa ?? 0, 0, 500, DEFAULT_ALERTS_CONFIG.tyrePressure!.minKpa as number),
    maxKpa: clamp(value.maxKpa ?? 500, 0, 500, DEFAULT_ALERTS_CONFIG.tyrePressure!.maxKpa as number)
  }
}

function sanitizeTyreTemp(value: NonNullable<AlertsConfig['tyreTemp']>): NonNullable<AlertsConfig['tyreTemp']> {
  return {
    ...sanitizeRule(value),
    maxC: clamp(value.maxC ?? 0, 0, 250, DEFAULT_ALERTS_CONFIG.tyreTemp!.maxC as number)
  }
}

function sanitizeBrakeTemp(value: NonNullable<AlertsConfig['brakeTemp']>): NonNullable<AlertsConfig['brakeTemp']> {
  return {
    ...sanitizeRule(value),
    maxC: clamp(value.maxC ?? 0, 0, 1200, DEFAULT_ALERTS_CONFIG.brakeTemp!.maxC as number)
  }
}

function sanitizeSeverity(value: AlertSeverity | undefined): AlertSeverity | undefined {
  if (value === 'info' || value === 'warning' || value === 'critical') return value
  return undefined
}

function sanitizeCooldown(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value)) return undefined
  return Math.max(0, Math.min(60000, Math.floor(value)))
}

function sanitizeRepeat(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value)) return undefined
  const cleaned = Math.max(0, Math.min(600000, Math.floor(value)))
  return cleaned === 0 ? undefined : cleaned
}

function sanitizeOutputs(value: AlertOutput[] | undefined): AlertOutput[] | undefined {
  if (!Array.isArray(value)) return undefined
  const cleaned = value
    .map((entry) => sanitizeOutput(entry))
    .filter((entry): entry is AlertOutput => entry !== null)
  return cleaned.length > 0 ? cleaned : undefined
}

function sanitizeOutput(value: unknown): AlertOutput | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<AlertOutput> & { kind?: string }
  switch (candidate.kind) {
    case 'buttonbox': {
      const preset = (candidate as AlertOutputButtonbox).preset
      if (
        preset !== 'startLedFlash' &&
        preset !== 'revLightsPulse' &&
        preset !== 'shiftBlink' &&
        preset !== 'oledMessage' &&
        preset !== 'bigNum'
      ) {
        return null
      }
      const output: AlertOutputButtonbox = {
        kind: 'buttonbox',
        enabled: sanitizeBool((candidate as AlertOutputButtonbox).enabled, true),
        preset,
        durationMs: optionalNumber((candidate as AlertOutputButtonbox).durationMs, 0, 60000),
        revLevel: optionalNumber((candidate as AlertOutputButtonbox).revLevel, 0, 4),
        oledLine1: optionalString((candidate as AlertOutputButtonbox).oledLine1),
        oledLine2: optionalString((candidate as AlertOutputButtonbox).oledLine2),
        oledLine3: optionalString((candidate as AlertOutputButtonbox).oledLine3),
        bigNumValue: optionalString((candidate as AlertOutputButtonbox).bigNumValue)
      }
      return output
    }
    case 'serial': {
      const template = (candidate as AlertOutputSerial).template
      if (typeof template !== 'string' || template.length === 0) return null
      return {
        kind: 'serial',
        enabled: sanitizeBool((candidate as AlertOutputSerial).enabled, true),
        deviceId: optionalString((candidate as AlertOutputSerial).deviceId),
        template
      }
    }
    case 'secondScreen': {
      const slot = (candidate as AlertOutputSecondScreen).slot
      if (typeof slot !== 'string' || slot.length === 0) return null
      return {
        kind: 'secondScreen',
        enabled: sanitizeBool((candidate as AlertOutputSecondScreen).enabled, true),
        slot,
        template: optionalString((candidate as AlertOutputSecondScreen).template)
      }
    }
    case 'sound': {
      return {
        kind: 'sound',
        enabled: sanitizeBool((candidate as AlertOutputSound).enabled, true),
        toneHz: optionalNumber((candidate as AlertOutputSound).toneHz, 50, 8000),
        durationMs: optionalNumber((candidate as AlertOutputSound).durationMs, 0, 5000),
        volume: optionalNumber((candidate as AlertOutputSound).volume, 0, 1)
      }
    }
    default:
      return null
  }
}

function sanitizeBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  return fallback
}

function optionalNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.max(min, Math.min(max, value))
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (value.length === 0) return undefined
  return value
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}
