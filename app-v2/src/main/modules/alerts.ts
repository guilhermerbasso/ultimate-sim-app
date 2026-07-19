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
  ACCESSIBILITY_CUE_CHANNELS,
  CueRouteAdmissionController,
  cueSeverityPriority,
  hardwareOutputsForCueRoute,
  routeSemanticCue,
  semanticCueEventFromAlert,
  type CueHapticPattern,
  type CueProfile,
  type CueRoute
} from '../../shared/accessibility-cues'
import {
  OUTPUTS_CHANNELS,
  type OutputSecondScreenUpdate,
  interpolateTemplate
} from '../../shared/outputs'
import { AlertsDetector } from '../alerts/detector'
import { settingsEvents } from '../settings/events'
import {
  LiveTelemetryGate,
  sameLiveTelemetryContext,
  type LiveTelemetryContext
} from '../../shared/replay'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import {
  getActiveAccessibilityCueProfile,
  getAccessibilityCueProfileRevision,
  isAccessibilityCueAudioAvailable,
  whenAccessibilityCueProfileReady
} from './accessibility-cues'
import {
  dispatchAccessibilityCueHaptic,
  isAccessibilityHapticsAvailable
} from './haptics'
import { PendingAccessibilityCueQueue } from './accessibility-cue-startup-queue'

const CONFIG_FILE = 'alerts-config.json'
const ACCESSIBILITY_STARTUP_QUEUE_MAX = 32

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

const HARDWARE_RETRY_MS = 100
const HARDWARE_TEARDOWN_ATTEMPTS = 3
const HARDWARE_WRITE_TIMEOUT_MS = 300
const HARDWARE_NEUTRAL_SIGNATURE = 'neutral'

type HardwareActuator = 'start' | 'rev' | 'shift' | 'display'
type HardwareValue =
  | { kind: 'raw'; command: string }
  | { kind: 'oled'; lines: readonly [string, string, string] }
  | { kind: 'bigNum'; value: string }

interface HardwareLease {
  sequence: number
  value: HardwareValue
  timer?: ReturnType<typeof setTimeout>
}

interface HardwareActuatorState {
  key: string
  deviceId: string
  actuator: HardwareActuator
  ctx: ModuleContext
  leases: Map<string, HardwareLease>
  appliedSignature: string | undefined
  desiredRevision: number
  appliedRevision: number
  forceNeutral: boolean
  activeAttempt?: HardwareWriteAttempt
  retryTimer?: ReturnType<typeof setTimeout>
  lastError?: unknown
}

interface HardwareTarget {
  signature: string
  revision: number
  value?: HardwareValue
}

interface HardwareWriteAttempt {
  token: symbol
  target: HardwareTarget
  promise: Promise<void>
  cancel: () => void
}

interface BoundedHardwareWrite {
  promise: Promise<void>
  cancel: () => void
}

type GracefulTeardownContext = ModuleContext & {
  registerGracefulTeardown?: (task: () => Promise<void> | void) => () => void
}

const hardwareActuators = new Map<string, HardwareActuatorState>()
let hardwareLeaseSequence = 0
let hardwareEffectsEnabled = true
let hardwareTeardownStarted = false

// Last serial send timestamp keyed by (ruleType:outputIdx:deviceId).
const lastSerialSendAt = new Map<string, number>()

export function register(ctx: ModuleContext): void {
  const configPath = join(ctx.app.getPath('userData'), CONFIG_FILE)
  const detector = new AlertsDetector(config)
  const cueAdmission = new CueRouteAdmissionController()
  const liveGate = new LiveTelemetryGate()
  let lastLiveContext: LiveTelemetryContext | null = null
  let observedLive = false
  let configReady = false
  let pendingLive: { snapshot: TelemetrySnapshot; context: LiveTelemetryContext } | null = null
  const pendingAccessibilityEvents = new PendingAccessibilityCueQueue(
    ACCESSIBILITY_STARTUP_QUEUE_MAX
  )
  let accessibilityProfileReady = false
  let stopped = false
  hardwareEffectsEnabled = true
  hardwareTeardownStarted = false
  settingsEvents.onChanged((settings) => detector.setUnitSystem(settings.unitSystem))

  const configLoadPromise = loadConfig(configPath).then((loaded) => {
    if (stopped) return
    config = loaded
    detector.setConfig(config)
    const pending = pendingLive
    pendingLive = null
    if (pending && sameLiveTelemetryContext(pending.context, lastLiveContext)) {
      seedDetector(detector, pending.snapshot, config)
    }
    configReady = true
    ctx.broadcast('alerts:config', config)
  })
  let configCommitQueue: Promise<void> = configLoadPromise.then(() => undefined)

  void whenAccessibilityCueProfileReady().then(() => {
    if (stopped) return
    accessibilityProfileReady = true
    const profile = getActiveAccessibilityCueProfile()
    if (!profile) return
    for (const event of pendingAccessibilityEvents.drain()) {
      dispatchAccessibilityCue(ctx, event, profile, cueAdmission)
    }
  })

  ctx.telemetryHub.on('snapshot', (snapshot) => {
    if (stopped || hardwareTeardownStarted) return
    const live = liveGate.observe(snapshot)
    const liveContextChanged = Boolean(
      live.live &&
      live.context &&
      lastLiveContext &&
      !sameLiveTelemetryContext(live.context, lastLiveContext)
    )
    const boundary = live.boundary || liveContextChanged
    const firstLive = live.live && !observedLive
    if (live.live) observedLive = true
    if (live.live && live.context) lastLiveContext = live.context

    if (boundary) {
      releaseAllHardwareLeases(ctx)
      detector.reset()
      cueAdmission.reset()
      lastSerialSendAt.clear()
      pendingAccessibilityEvents.clear()
    }
    if (!live.live || !snapshot || !live.context) {
      pendingLive = null
      return
    }
    if (!configReady) {
      pendingLive = { snapshot, context: live.context }
      return
    }
    if (boundary || firstLive) {
      seedDetector(detector, snapshot, config)
      return
    }

    for (const event of detector.process(snapshot)) {
      const eventWithSound = attachSoundPayload(event)
      ctx.broadcast('alerts:event', eventWithSound)
      dispatchOutputs(ctx, eventWithSound)
      if (!accessibilityProfileReady) {
        pendingAccessibilityEvents.enqueue(eventWithSound)
      } else {
        const profile = getActiveAccessibilityCueProfile()
        if (profile) {
          dispatchAccessibilityCue(ctx, eventWithSound, profile, cueAdmission)
        }
      }
    }
  })

  ctx.ipcMain.handle('alerts:getConfig', () => config)
  ctx.ipcMain.handle('alerts:setConfig', (_event, patch: AlertsConfigPatch) => {
    const commit = configCommitQueue.then(async () => {
      const nextConfig = mergeConfig(config, patch)
      await saveConfig(configPath, nextConfig)
      config = nextConfig
      detector.setConfig(nextConfig)
      ctx.broadcast('alerts:config', nextConfig)
      return nextConfig
    })
    configCommitQueue = commit.then(
      () => undefined,
      () => undefined
    )
    return commit
  })

  const retryOnReconnect = (summary: unknown): void => {
    const deviceId =
      summary && typeof summary === 'object' && 'id' in summary && typeof summary.id === 'string'
        ? summary.id
        : undefined
    if (deviceId) retryHardwareActuators(ctx, deviceId)
  }
  ctx.serialHub?.on?.('device-added', retryOnReconnect)
  ctx.serialHub?.on?.('device-updated', retryOnReconnect)

  registerAlertHardwareTeardown(ctx, async () => {
    hardwareEffectsEnabled = false
    stopped = true
    pendingLive = null
    pendingAccessibilityEvents.clear()
    ctx.serialHub?.off?.('device-added', retryOnReconnect)
    ctx.serialHub?.off?.('device-updated', retryOnReconnect)
    await drainHardwareNeutralization(ctx)
  })
}

function registerAlertHardwareTeardown(
  ctx: ModuleContext,
  task: () => Promise<void> | void
): void {
  const registerGracefulTeardown = (ctx as GracefulTeardownContext).registerGracefulTeardown
  if (typeof registerGracefulTeardown === 'function') {
    registerGracefulTeardown.call(ctx, task)
    return
  }

  ctx.app.prependOnceListener('before-quit', () => {
    try {
      void Promise.resolve(task()).catch(() => undefined)
    } catch {
      // The bounded central quit path must continue even if cleanup fails synchronously.
    }
  })
}

function seedDetector(
  detector: AlertsDetector,
  snapshot: TelemetrySnapshot,
  activeConfig: AlertsConfig
): void {
  detector.setConfig(silentAlertsConfig(activeConfig))
  detector.reset()
  try {
    detector.process(snapshot)
  } finally {
    detector.setConfig(activeConfig)
  }
}

function silentAlertsConfig(activeConfig: AlertsConfig): AlertsConfig {
  return {
    ...activeConfig,
    audioEnabled: false,
    pitLimiter: { ...activeConfig.pitLimiter, enabled: false },
    flags: { ...activeConfig.flags, enabled: false },
    lowFuel: { ...activeConfig.lowFuel, enabled: false },
    shiftPoint: { ...activeConfig.shiftPoint, enabled: false },
    incidentLimit: { ...activeConfig.incidentLimit, enabled: false },
    tyrePressure: activeConfig.tyrePressure
      ? { ...activeConfig.tyrePressure, enabled: false }
      : undefined,
    tyreTemp: activeConfig.tyreTemp ? { ...activeConfig.tyreTemp, enabled: false } : undefined,
    brakeTemp: activeConfig.brakeTemp
      ? { ...activeConfig.brakeTemp, enabled: false }
      : undefined,
    drsAvailable: activeConfig.drsAvailable
      ? { ...activeConfig.drsAvailable, enabled: false }
      : undefined,
    blueFlag: activeConfig.blueFlag ? { ...activeConfig.blueFlag, enabled: false } : undefined
  }
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

function dispatchAccessibilityCue(
  ctx: ModuleContext,
  event: AlertEvent,
  profile: CueProfile,
  admission: CueRouteAdmissionController
): void {
  const route = routeSemanticCue(
    semanticCueEventFromAlert(event, 'live'),
    profile,
    {
      caption: true,
      audio: isAccessibilityCueAudioAvailable(),
      symbol: true,
      led: Boolean(ctx.serialHub.getPrimary()?.isOpen()),
      haptic: isAccessibilityHapticsAvailable(ctx, profile.hapticIntensity)
    },
    getAccessibilityCueProfileRevision()
  )
  if (!admission.admit(route)) return
  ctx.broadcast(ACCESSIBILITY_CUE_CHANNELS.routedEvent, route)
  dispatchAccessibilityCueHardware(ctx, event, route)
}

function dispatchAccessibilityCueHardware(
  ctx: ModuleContext,
  event: AlertEvent,
  route: CueRoute
): void {
  for (const output of hardwareOutputsForCueRoute(route)) {
    if (output.modality === 'led') {
      dispatchButtonbox(
        ctx,
        {
          kind: 'buttonbox',
          preset: 'startLedFlash',
          durationMs: output.durationMs
        },
        event,
        100
      )
      dispatchButtonbox(
        ctx,
        {
          kind: 'buttonbox',
          preset: 'oledMessage',
          durationMs: output.durationMs,
          oledLine1: output.hardwareTextToken ?? 'CUE',
          oledLine2: route.severity.toUpperCase(),
          oledLine3: 'ACCESS CUE'
        },
        event,
        101
      )
      continue
    }
    if (output.modality === 'haptic' && isCueHapticPattern(output.pattern)) {
      dispatchAccessibilityCueHaptic(
        ctx,
        output.pattern,
        output.intensity ?? 0.7,
        cueSeverityPriority(route.severity)
      )
    }
  }
}

function isCueHapticPattern(value: unknown): value is CueHapticPattern {
  return value === 'single' || value === 'double' || value === 'triple' || value === 'long'
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
  if (!hardwareEffectsEnabled) return
  if (!ctx.serialHub.getPrimary()) return

  const deviceId = ctx.serialHub.getPrimaryId() ?? 'primary'
  const owner = `${event.type}:${index}`
  const extras = templateExtras(event)
  switch (output.preset) {
    case 'startLedFlash': {
      const duration = clampMs(output.durationMs, BUTTONBOX_DEFAULTS.startLedFlash)
      acquireHardwareLease(ctx, deviceId, 'start', owner, { kind: 'raw', command: 'S1' }, duration)
      break
    }
    case 'revLightsPulse': {
      const level = clampLevel(output.revLevel)
      const duration = clampMs(output.durationMs, BUTTONBOX_DEFAULTS.revLightsPulse)
      acquireHardwareLease(ctx, deviceId, 'rev', owner, { kind: 'raw', command: `R${level}` }, duration)
      break
    }
    case 'shiftBlink': {
      const duration = clampMs(output.durationMs, BUTTONBOX_DEFAULTS.shiftBlink)
      acquireHardwareLease(ctx, deviceId, 'shift', owner, { kind: 'raw', command: 'B1' }, duration)
      break
    }
    case 'oledMessage': {
      const line1 = renderLine(output.oledLine1 ?? '${message}', event, extras)
      const line2 = renderLine(output.oledLine2 ?? '', event, extras)
      const line3 = renderLine(output.oledLine3 ?? '', event, extras)
      // OLED is sticky — schedule a clear unless durationMs <= 0.
      const duration = clampMs(output.durationMs, BUTTONBOX_DEFAULTS.oledMessage)
      acquireHardwareLease(
        ctx,
        deviceId,
        'display',
        owner,
        {
          kind: 'oled',
          lines: [line1.slice(0, 16), line2.slice(0, 16), line3.slice(0, 16)]
        },
        duration > 0 ? duration : undefined
      )
      break
    }
    case 'bigNum': {
      const value = renderLine(output.bigNumValue ?? '${value}', event, extras)
      acquireHardwareLease(ctx, deviceId, 'display', owner, { kind: 'bigNum', value: value.slice(0, 8) })
      break
    }
  }
}

function acquireHardwareLease(
  ctx: ModuleContext,
  deviceId: string,
  actuator: HardwareActuator,
  owner: string,
  value: HardwareValue,
  durationMs?: number
): void {
  if (!hardwareEffectsEnabled) return
  const key = `${deviceId}:${actuator}`
  let state = hardwareActuators.get(key)
  if (!state) {
    state = {
      key,
      deviceId,
      actuator,
      ctx,
      leases: new Map(),
      appliedSignature: HARDWARE_NEUTRAL_SIGNATURE,
      desiredRevision: 0,
      appliedRevision: 0,
      forceNeutral: false
    }
    hardwareActuators.set(key, state)
  } else {
    state.ctx = ctx
  }

  const previousSignature = desiredHardwareTarget(state).signature
  state.forceNeutral = false
  const previous = state.leases.get(owner)
  if (previous?.timer) clearTimeout(previous.timer)

  const lease: HardwareLease = {
    sequence: ++hardwareLeaseSequence,
    value
  }
  if (durationMs !== undefined) {
    lease.timer = setTimeout(() => {
      if (state?.leases.get(owner) !== lease) return
      const previousSignature = desiredHardwareTarget(state).signature
      state.leases.delete(owner)
      if (desiredHardwareTarget(state).signature !== previousSignature) state.desiredRevision += 1
      queueHardwareReconcile(state)
    }, durationMs)
  }
  state.leases.set(owner, lease)
  if (desiredHardwareTarget(state).signature !== previousSignature) state.desiredRevision += 1
  queueHardwareReconcile(state)
}

function desiredHardwareTarget(state: HardwareActuatorState): HardwareTarget {
  if (state.forceNeutral) {
    return { signature: HARDWARE_NEUTRAL_SIGNATURE, revision: state.desiredRevision }
  }
  let latest: HardwareLease | undefined
  for (const lease of state.leases.values()) {
    if (!latest || lease.sequence > latest.sequence) latest = lease
  }
  if (!latest) return { signature: HARDWARE_NEUTRAL_SIGNATURE, revision: state.desiredRevision }
  return {
    signature: hardwareValueSignature(latest.value),
    revision: state.desiredRevision,
    value: latest.value
  }
}

function hardwareValueSignature(value: HardwareValue): string {
  switch (value.kind) {
    case 'raw':
      return `raw:${value.command}`
    case 'oled':
      return `oled:${value.lines.join('\u0000')}`
    case 'bigNum':
      return `bigNum:${value.value}`
  }
}

async function sendHardwareTarget(state: HardwareActuatorState, target: HardwareTarget): Promise<void> {
  const device =
    state.ctx.serialHub.getDevice(state.deviceId) ??
    (state.ctx.serialHub.getPrimaryId() === state.deviceId ? state.ctx.serialHub.getPrimary() : null)
  if (!device) throw new Error(`device "${state.deviceId}" is unavailable`)

  if (target.value) {
    switch (target.value.kind) {
      case 'raw':
        await device.sendRaw(target.value.command)
        return
      case 'oled':
        await device.sendOled(...target.value.lines)
        return
      case 'bigNum':
        await device.sendBigNum(target.value.value)
        return
    }
  }

  switch (state.actuator) {
    case 'start':
      await device.sendRaw('S0')
      return
    case 'rev':
      await device.sendRaw('R0')
      return
    case 'shift':
      await device.sendRaw('B0')
      return
    case 'display':
      await device.sendOled('', '', '')
      return
  }
}

function clearHardwareRetry(state: HardwareActuatorState): void {
  if (!state.retryTimer) return
  clearTimeout(state.retryTimer)
  state.retryTimer = undefined
}

function scheduleHardwareRetry(state: HardwareActuatorState): void {
  if (hardwareTeardownStarted || state.retryTimer || hardwareActuators.get(state.key) !== state) return
  state.retryTimer = setTimeout(() => {
    state.retryTimer = undefined
    queueHardwareReconcile(state)
  }, HARDWARE_RETRY_MS)
}

function boundedHardwareWrite(write: Promise<void>, stateKey: string): BoundedHardwareWrite {
  let settled = false
  let rejectBounded: ((error: unknown) => void) | undefined
  const watchdog = setTimeout(() => {
    if (settled) return
    settled = true
    rejectBounded?.(new Error(`Hardware actuator "${stateKey}" write timed out`))
  }, HARDWARE_WRITE_TIMEOUT_MS)

  const promise = new Promise<void>((resolve, reject) => {
    rejectBounded = reject
    write.then(
      () => {
        if (settled) return
        settled = true
        clearTimeout(watchdog)
        resolve()
      },
      (error) => {
        if (settled) return
        settled = true
        clearTimeout(watchdog)
        reject(error)
      }
    )
  })

  return {
    promise,
    cancel: () => {
      if (settled) return
      settled = true
      clearTimeout(watchdog)
      rejectBounded?.(new Error(`Hardware actuator "${stateKey}" write was superseded`))
    }
  }
}

function detachHardwareAttempt(state: HardwareActuatorState): HardwareWriteAttempt | undefined {
  const attempt = state.activeAttempt
  if (!attempt) return undefined
  state.activeAttempt = undefined
  return attempt
}

function reconcileHardwareActuator(state: HardwareActuatorState): Promise<void> {
  if (state.activeAttempt) return state.activeAttempt.promise
  const target = desiredHardwareTarget(state)
  if (state.appliedSignature === target.signature && state.appliedRevision === target.revision) {
    if (target.signature === HARDWARE_NEUTRAL_SIGNATURE && state.leases.size === 0) {
      clearHardwareRetry(state)
      hardwareActuators.delete(state.key)
    }
    return Promise.resolve()
  }

  const retryTimer = state.retryTimer
  state.retryTimer = undefined
  const token = Symbol(state.key)
  const bounded = boundedHardwareWrite(sendHardwareTarget(state, target), state.key)
  const write = (async () => {
    let writeSucceeded = false
    try {
      await bounded.promise
      writeSucceeded = true
      if (state.activeAttempt?.token !== token || hardwareActuators.get(state.key) !== state) return
      const desired = desiredHardwareTarget(state)
      if (desired.signature !== target.signature || desired.revision !== target.revision) {
        state.appliedSignature = undefined
        return
      }
      state.appliedSignature = target.signature
      state.appliedRevision = target.revision
      state.lastError = undefined
      if (
        target.signature === HARDWARE_NEUTRAL_SIGNATURE &&
        desired.signature === target.signature &&
        desired.revision === target.revision &&
        state.activeAttempt?.token === token
      ) {
        hardwareActuators.delete(state.key)
      }
    } catch (error) {
      if (state.activeAttempt?.token !== token || hardwareActuators.get(state.key) !== state) return
      state.appliedSignature = undefined
      if (state.lastError === undefined) {
        console.warn(`[alerts] hardware actuator "${state.key}" write failed; retaining it for retry:`, error)
      }
      state.lastError = error
      scheduleHardwareRetry(state)
      throw error
    } finally {
      if (state.activeAttempt?.token !== token) return
      state.activeAttempt = undefined
      if (hardwareActuators.get(state.key) === state && writeSucceeded) {
        const nextTarget = desiredHardwareTarget(state)
        if (
          nextTarget.signature !== state.appliedSignature ||
          nextTarget.revision !== state.appliedRevision
        ) {
          queueHardwareReconcile(state)
        }
      }
    }
  })()
  const attempt: HardwareWriteAttempt = { token, target, promise: write, cancel: bounded.cancel }
  state.activeAttempt = attempt
  if (retryTimer) clearTimeout(retryTimer)
  return write
}

function queueHardwareReconcile(state: HardwareActuatorState): void {
  // Failures are recorded on the actuator and schedule an idempotent retry.
  void reconcileHardwareActuator(state).catch(() => undefined)
}

function releaseAllHardwareLeases(ctx: ModuleContext): void {
  const timers: Array<ReturnType<typeof setTimeout>> = []
  const states = [...hardwareActuators.values()]
  for (const state of states) {
    state.ctx = ctx
    state.forceNeutral = true
    state.desiredRevision += 1
    for (const lease of state.leases.values()) {
      if (lease.timer) timers.push(lease.timer)
    }
    const staleAttempt = detachHardwareAttempt(state)
    queueHardwareReconcile(state)
    staleAttempt?.cancel()
    state.leases.clear()
  }
  for (const timer of timers) clearTimeout(timer)
}

function retryHardwareActuators(ctx: ModuleContext, deviceId: string): void {
  for (const state of hardwareActuators.values()) {
    if (state.deviceId !== deviceId) continue
    state.ctx = ctx
    state.appliedSignature = undefined
    state.desiredRevision += 1
    const staleAttempt = detachHardwareAttempt(state)
    queueHardwareReconcile(state)
    staleAttempt?.cancel()
  }
}

async function settleHardwareActuatorForDrain(state: HardwareActuatorState): Promise<void> {
  while (hardwareActuators.get(state.key) === state) {
    await reconcileHardwareActuator(state)
  }
}

async function drainHardwareNeutralization(ctx: ModuleContext): Promise<void> {
  hardwareEffectsEnabled = false
  hardwareTeardownStarted = true
  releaseAllHardwareLeases(ctx)

  for (let attempt = 1; attempt <= HARDWARE_TEARDOWN_ATTEMPTS; attempt += 1) {
    const pending = [...hardwareActuators.values()]
    if (pending.length === 0) return
    for (const state of pending) clearHardwareRetry(state)
    await Promise.allSettled(pending.map((state) => settleHardwareActuatorForDrain(state)))
    if (hardwareActuators.size === 0) return
  }

  const pendingKeys = [...hardwareActuators.keys()].join(', ')
  const error = new Error(`Failed to neutralize alert hardware actuators: ${pendingKeys}`)
  console.error('[alerts] graceful hardware drain failed:', error)
  throw error
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
    brakePressureLow: sanitizeBrakePressureLow(
      mergeOptional(base.brakePressureLow ?? DEFAULT_ALERTS_CONFIG.brakePressureLow, patch.brakePressureLow)
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

function sanitizeBrakePressureLow(
  value: NonNullable<AlertsConfig['brakePressureLow']>
): NonNullable<AlertsConfig['brakePressureLow']> {
  return {
    brakeInputMin: clamp(
      value.brakeInputMin,
      0,
      1,
      DEFAULT_ALERTS_CONFIG.brakePressureLow!.brakeInputMin
    ),
    maxLinePressureBar: clamp(
      value.maxLinePressureBar,
      0,
      500,
      DEFAULT_ALERTS_CONFIG.brakePressureLow!.maxLinePressureBar
    )
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
