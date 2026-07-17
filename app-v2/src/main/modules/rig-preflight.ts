import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { screen } from 'electron'
import type { ModuleContext } from '../module-context'
import { getDeviceConfigStore } from '../devices/store'
import { getSerialDevicesStore } from '../serial-devices/store'
import { getDashboardManager } from './dashboards'
import { logger } from './logger'
import {
  RIG_PREFLIGHT_CHANNELS,
  type RigAudioObservation,
  type RigControlsObservation,
  type RigEvidenceMeta,
  type RigEvidenceProvenance,
  type RigHapticsObservation,
  type RigPreflightClientEvidence,
  type RigPreflightObservation,
  type RigPreflightProfile,
  type RigPreflightProfilePatch,
  type RigPreflightRunRequest,
  type RigPreflightWaiverRequest,
  type RigSerialObservation,
  type RigStreamingObservation,
  type RigSttObservation,
  type RigTtsObservation
} from '../../shared/rig-preflight'
import {
  RigPreflightService,
  type RigPreflightPersistence
} from '../rig-preflight/service'
import { probePortOwnership } from '../rig-preflight/port-owner'

const STORE_FILE = 'rig-preflight.json'
const DRIFT_POLL_MS = 5_000

class FileRigPreflightPersistence implements RigPreflightPersistence {
  constructor(private readonly path: string) {}

  async read(): Promise<string | null> {
    try {
      return await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async write(content: string): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const nextPath = `${this.path}.next`
    await writeFile(nextPath, content, 'utf8')
    try {
      await rename(nextPath, this.path)
    } catch {
      await rm(this.path, { force: true })
      await rename(nextPath, this.path)
    }
  }
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function bool(value: unknown): boolean {
  return value === true
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.slice(0, 160))
    : []
}

function clientObservedAt(client: RigPreflightClientEvidence | undefined, now: number): number {
  const observedAt = number(client?.observedAt, now)
  return Math.min(now, Math.max(now - 5 * 60_000, observedAt))
}

function meta(
  observedAt: number,
  kind: RigEvidenceProvenance['kind'],
  source: string,
  detail?: string
): RigEvidenceMeta {
  return {
    observedAt,
    provenance: [{ kind, source, detail }]
  }
}

function normalizeAudio(
  client: RigPreflightClientEvidence | undefined,
  now: number
): RigAudioObservation | undefined {
  const value = client?.audio
  if (!value) return undefined
  return {
    meta: meta(clientObservedAt(client, now), 'renderer', 'MediaDevices + silent AudioContext probe'),
    enumerationAvailable: bool(value.enumerationAvailable),
    audioEngineOk: bool(value.audioEngineOk),
    audioEngineError: typeof value.audioEngineError === 'string' ? value.audioEngineError.slice(0, 300) : undefined,
    outputCount: Math.max(0, number(value.outputCount)),
    outputLabels: strings(value.outputLabels),
    inputCount: Math.max(0, number(value.inputCount)),
    inputLabels: strings(value.inputLabels)
  }
}

function normalizeTts(
  client: RigPreflightClientEvidence | undefined,
  now: number
): RigTtsObservation | undefined {
  const value = client?.tts
  if (!value) return undefined
  return {
    meta: meta(clientObservedAt(client, now), 'runtime', 'tts:engineStatus + tts:listVoices'),
    enginePresent: bool(value.enginePresent),
    engineOk: bool(value.engineOk),
    engineReason: typeof value.engineReason === 'string' ? value.engineReason.slice(0, 300) : undefined,
    installedVoiceCount: Math.max(0, number(value.installedVoiceCount))
  }
}

function normalizeStt(
  client: RigPreflightClientEvidence | undefined,
  now: number
): RigSttObservation | undefined {
  const value = client?.stt
  if (!value) return undefined
  return {
    meta: meta(clientObservedAt(client, now), 'runtime', 'stt:status'),
    enabled: bool(value.enabled),
    binaryPresent: bool(value.binaryPresent),
    modelPresent: bool(value.modelPresent),
    vadModelPresent: bool(value.vadModelPresent)
  }
}

function normalizeHaptics(
  client: RigPreflightClientEvidence | undefined,
  now: number
): RigHapticsObservation | undefined {
  const value = client?.haptics
  if (!value) return undefined
  return {
    meta: meta(clientObservedAt(client, now), 'config', 'haptics:getConfig + local route inventory'),
    enabled: bool(value.enabled),
    muted: bool(value.muted),
    enabledEffects: Math.max(0, number(value.enabledEffects)),
    outputDeviceId: typeof value.outputDeviceId === 'string' ? value.outputDeviceId.slice(0, 200) : '',
    audioRouteAvailable: bool(value.audioRouteAvailable),
    arduinoEnabled: bool(value.arduinoEnabled),
    arduinoDeviceId: typeof value.arduinoDeviceId === 'string' ? value.arduinoDeviceId.slice(0, 160) : '',
    arduinoConnected: bool(value.arduinoConnected)
  }
}

function normalizeControls(
  client: RigPreflightClientEvidence | undefined,
  now: number
): RigControlsObservation | undefined {
  const value = client?.controls
  if (!value) return undefined
  return {
    meta: meta(clientObservedAt(client, now), 'renderer', 'Web Gamepad API + actions status'),
    gamepadCount: Math.max(0, number(value.gamepadCount)),
    gamepadLabels: strings(value.gamepadLabels),
    bindingCount: Math.max(0, number(value.bindingCount)),
    enabledBindingCount: Math.max(0, number(value.enabledBindingCount)),
    keyboardEmulationAvailable: bool(value.keyboardEmulationAvailable),
    gamepadEmulationAvailable: bool(value.gamepadEmulationAvailable)
  }
}

function genericConnected(
  config: { id?: string; path: string },
  live: Array<{ id: string; path: string; connected: boolean }>
): boolean {
  return live.some((device) =>
    device.connected &&
    ((config.id && device.id === config.id) || device.path === config.path)
  )
}

async function collectSerial(ctx: ModuleContext, client: RigPreflightClientEvidence | undefined, now: number): Promise<RigSerialObservation> {
  const serialStore = getSerialDevicesStore(ctx.app)
  const deviceStore = getDeviceConfigStore(ctx.app)
  await Promise.all([serialStore.ensureLoaded(), deviceStore.ensureLoaded()])
  const live = ctx.serialHub.listDevices()
  const ports = await ctx.serialHub.listPorts().catch(() => [])
  const configured = serialStore.list()
  const profiles = deviceStore.list()
  const expected = configured.length > 0
    ? configured.map((entry) => ({
        id: entry.id,
        path: entry.path,
        label: entry.label
      }))
    : profiles
        .filter((profile) => profile.deviceId !== 'simx' && (profile.deviceId || profile.port))
        .map((profile) => ({
          id: profile.deviceId,
          path: profile.port ?? '',
          label: profile.label
        }))
  const disconnectedLabels = expected
    .filter((entry) => !genericConnected(entry, live))
    .map((entry) => entry.label)
  const esp32Profiles = profiles.filter((profile) => profile.board === 'esp32' || profile.board === 'esp32s3')
  const esp32SerialConnected = esp32Profiles.filter((profile) =>
    live.some((device) =>
      device.connected &&
      ((profile.deviceId && profile.deviceId === device.id) || (profile.port && profile.port === device.path))
    )
  ).length
  const esp32WifiConnected = Math.max(0, number(client?.esp32ConnectedCount))
  const esp32ConfiguredCount = Math.max(esp32Profiles.length, esp32WifiConnected)
  const simx = ctx.serialManager.getDevice()
  const simxPort = ports.find((port) => port.path === simx?.path)
  const simxIdentity = simxPort?.serialNumber
    ? `serial:${simxPort.serialNumber}`
    : simxPort?.vendorId || simxPort?.productId
      ? `usb:${simxPort.vendorId || '?'}:${simxPort.productId || '?'}`
      : simx?.path
  return {
    meta: meta(now, 'runtime', 'SerialHub + persisted serial/device stores + esp32:status'),
    availablePorts: ports.map((port) => port.path),
    simxConnected: ctx.serialManager.isConnected(),
    simxIdentity,
    configuredCount: expected.length,
    connectedConfiguredCount: Math.max(0, expected.length - disconnectedLabels.length),
    configuredLabels: expected.map((entry) => entry.label),
    disconnectedLabels,
    esp32ConfiguredCount,
    esp32ConnectedCount: Math.min(
      esp32ConfiguredCount,
      Math.max(esp32SerialConnected, esp32WifiConnected)
    ),
    esp32Labels: [
      ...esp32Profiles.map((profile) => profile.label),
      ...strings(client?.esp32Labels)
    ].filter((label, index, all) => all.indexOf(label) === index)
  }
}

async function normalizeStreaming(
  profile: RigPreflightProfile,
  client: RigPreflightClientEvidence | undefined,
  now: number
): Promise<RigStreamingObservation | undefined> {
  const value = client?.streaming
  if (!value) return undefined
  const runningPort = value.port === null ? null : Math.max(0, number(value.port))
  const probePort = runningPort || profile.requirements.streamingPort
  const ownership = probePort > 0
    ? await probePortOwnership(probePort)
    : {
        port: probePort,
        state: 'unknown' as const,
        ownerPid: undefined,
        ownerName: undefined,
        detail: 'Streaming has no selected/listening port.'
      }
  return {
    meta: meta(clientObservedAt(client, now), 'os', 'streaming:status + Windows TCP owner query'),
    running: bool(value.running),
    port: runningPort && runningPort > 0 ? runningPort : null,
    accessMode: typeof value.accessMode === 'string' ? value.accessMode.slice(0, 40) : 'unknown',
    autoTunnelAvailable: bool(value.autoTunnelAvailable),
    ownerState: ownership.state,
    ownerPid: ownership.ownerPid,
    ownerName: ownership.ownerName,
    ownerDetail: ownership.detail
  }
}

async function collectObservation(
  ctx: ModuleContext,
  profile: RigPreflightProfile,
  client: RigPreflightClientEvidence | undefined
): Promise<RigPreflightObservation> {
  const now = Date.now()
  const telemetry = ctx.telemetryHub.status()
  const latest = ctx.telemetryHub.getLatest()
  const dashboardManager = getDashboardManager()
  await dashboardManager?.load()
  const [serial, streaming] = await Promise.all([
    collectSerial(ctx, client, now),
    normalizeStreaming(profile, client, now)
  ])
  return {
    collectedAt: now,
    simulator: {
      meta: meta(now, 'runtime', 'TelemetryHub status/latest snapshot'),
      source: telemetry.source,
      active: telemetry.active,
      connected: telemetry.connected,
      snapshotAt: latest?.timestamp
    },
    displays: {
      meta: meta(now, 'runtime', 'Electron screen + DashboardManager'),
      displayIds: screen.getAllDisplays().map((display) => display.id),
      openDashboardWindows: dashboardManager?.listOpen().length ?? 0
    },
    serial,
    audio: normalizeAudio(client, now),
    tts: normalizeTts(client, now),
    stt: normalizeStt(client, now),
    haptics: normalizeHaptics(client, now),
    controls: normalizeControls(client, now),
    streaming
  }
}

async function broadcastState(ctx: ModuleContext, service: RigPreflightService): Promise<void> {
  ctx.broadcast(RIG_PREFLIGHT_CHANNELS.changed, await service.getState())
}

export function register(ctx: ModuleContext): void {
  const persistence = new FileRigPreflightPersistence(
    join(ctx.app.getPath('userData'), STORE_FILE)
  )
  const service = new RigPreflightService({
    persistence,
    collectObservation: (profile, client) => collectObservation(ctx, profile, client)
  })

  ctx.ipcMain.handle(RIG_PREFLIGHT_CHANNELS.getState, () => service.getState())
  ctx.ipcMain.handle(RIG_PREFLIGHT_CHANNELS.setProfile, async (_event, profile: RigPreflightProfilePatch) => {
    const state = await service.setProfile(profile ?? {})
    ctx.broadcast(RIG_PREFLIGHT_CHANNELS.changed, state)
    return state
  })
  ctx.ipcMain.handle(RIG_PREFLIGHT_CHANNELS.run, async (_event, request?: RigPreflightRunRequest) => {
    const run = await service.run(request ?? {})
    await broadcastState(ctx, service)
    return run
  })
  ctx.ipcMain.handle(RIG_PREFLIGHT_CHANNELS.waive, async (_event, request: RigPreflightWaiverRequest) => {
    const state = await service.createWaiver(request)
    ctx.broadcast(RIG_PREFLIGHT_CHANNELS.changed, state)
    return state
  })
  ctx.ipcMain.handle(RIG_PREFLIGHT_CHANNELS.removeWaiver, async (_event, id: string) => {
    const state = await service.removeWaiver(id)
    ctx.broadcast(RIG_PREFLIGHT_CHANNELS.changed, state)
    return state
  })
  ctx.ipcMain.handle(RIG_PREFLIGHT_CHANNELS.acceptKnownGood, async (_event, runId: string, owner?: string) => {
    const state = await service.acceptKnownGood(runId, owner)
    ctx.broadcast(RIG_PREFLIGHT_CHANNELS.changed, state)
    return state
  })
  ctx.ipcMain.handle(RIG_PREFLIGHT_CHANNELS.faultMatrix, async (_event, client?: RigPreflightClientEvidence) => {
    const result = await service.runFaultMatrix(client)
    await broadcastState(ctx, service)
    return result
  })

  let driftPollBusy = false
  const driftPoll = setInterval(() => {
    if (driftPollBusy) return
    driftPollBusy = true
    void service.getState()
      .then(async (state) => {
        const active = state.activeCertificate
        if (!active || active.invalidatedAt !== null || state.activeCertificateExpired) return
        const req = state.profile.requirements
        let reason: string | null = null
        let provenance: RigEvidenceProvenance[] = []
        if (req.requireSimulator && !ctx.telemetryHub.status().connected) {
          reason = 'Simulator telemetry disconnected after certificate issue.'
          provenance = [{ kind: 'runtime', source: 'TelemetryHub drift monitor' }]
        } else if (req.requireSimX && !ctx.serialManager.isConnected()) {
          reason = 'SIM-X disconnected after certificate issue.'
          provenance = [{ kind: 'runtime', source: 'SerialHub drift monitor' }]
        } else if (req.minDisplays > screen.getAllDisplays().length) {
          reason = 'Display topology no longer meets the certified profile.'
          provenance = [{ kind: 'runtime', source: 'Electron display drift monitor' }]
        }
        if (reason && await service.invalidateActiveCertificate(reason, provenance)) {
          await broadcastState(ctx, service)
        }
      })
      .catch((error) => {
        logger.debug('rig-preflight', 'drift poll skipped', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
      .finally(() => {
        driftPollBusy = false
      })
  }, DRIFT_POLL_MS)

  const onSerialRemoved = (summary: { kind?: string; label?: string; path?: string }): void => {
    void service.getState().then(async (state) => {
      const required = summary.kind === 'sim-x'
        ? state.profile.requirements.requireSimX
        : state.profile.requirements.requireConfiguredSerial
      if (!required) return
      const changed = await service.invalidateActiveCertificate(
        `${summary.label || summary.path || 'Serial device'} disconnected after certificate issue.`,
        [{ kind: 'runtime', source: 'SerialHub device-removed' }]
      )
      if (changed) await broadcastState(ctx, service)
    }).catch(() => undefined)
  }
  ctx.serialHub.on('device-removed', onSerialRemoved)

  const onDisplayRemoved = (): void => {
    void service.getState().then(async (state) => {
      if (screen.getAllDisplays().length >= state.profile.requirements.minDisplays) return
      const changed = await service.invalidateActiveCertificate(
        'A required display was removed after certificate issue.',
        [{ kind: 'runtime', source: 'Electron display-removed' }]
      )
      if (changed) await broadcastState(ctx, service)
    }).catch(() => undefined)
  }
  screen.on('display-removed', onDisplayRemoved)

  ctx.app.once('before-quit', () => {
    clearInterval(driftPoll)
    ctx.serialHub.off('device-removed', onSerialRemoved)
    screen.off('display-removed', onDisplayRemoved)
  })
}
