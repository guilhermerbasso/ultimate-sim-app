import { join } from 'node:path'
import { screen } from 'electron'
import type { ModuleContext } from '../module-context'
import { getDeviceConfigStore } from '../devices/store'
import { getSerialDevicesStore } from '../serial-devices/store'
import { getDashboardManager } from './dashboards'
import { logger } from './logger'
import {
  RIG_PREFLIGHT_CHANNELS,
  canonicalRigEsp32Identity,
  normalizeEvidenceTimestamp,
  stableSortedIdentities,
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
import { RigPreflightService } from '../rig-preflight/service'
import { probePortOwnership } from '../rig-preflight/port-owner'
import { RigPreflightExpiryScheduler } from '../rig-preflight/expiry-scheduler'
import { FileRigPreflightPersistence } from '../rig-preflight/file-persistence'
import {
  desiredSerialIdentity,
  resolveConfiguredSerialEvidence
} from '../rig-preflight/serial-evidence'

const STORE_FILE = 'rig-preflight.json'
const DRIFT_POLL_MS = 5_000

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

export function clientObservedAt(client: RigPreflightClientEvidence | undefined, now: number): number {
  return normalizeEvidenceTimestamp(client?.observedAt, now)
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
    enumerationSucceeded: bool(value.enumerationSucceeded),
    audioEngineOk: bool(value.audioEngineOk),
    audioContextState: typeof value.audioContextState === 'string' ? value.audioContextState.slice(0, 40) : 'unknown',
    audioEngineError: typeof value.audioEngineError === 'string' ? value.audioEngineError.slice(0, 300) : undefined,
    outputIdentities: stableSortedIdentities(strings(value.outputIdentities)),
    outputLabels: strings(value.outputLabels),
    inputIdentities: stableSortedIdentities(strings(value.inputIdentities)),
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
    installedVoiceIds: stableSortedIdentities(strings(value.installedVoiceIds))
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
    outputDeviceId: typeof value.outputDeviceId === 'string' ? value.outputDeviceId.trim().slice(0, 200) : '',
    audioRouteAvailable: bool(value.audioRouteAvailable),
    arduinoEnabled: bool(value.arduinoEnabled),
    arduinoDeviceId: typeof value.arduinoDeviceId === 'string' ? value.arduinoDeviceId.trim().slice(0, 160) : '',
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
    gamepadIdentities: stableSortedIdentities(strings(value.gamepadIdentities)),
    bindingIdentities: stableSortedIdentities(strings(value.bindingIdentities)),
    enabledBindingIdentities: stableSortedIdentities(strings(value.enabledBindingIdentities)),
    keyboardEmulationAvailable: bool(value.keyboardEmulationAvailable),
    gamepadEmulationAvailable: bool(value.gamepadEmulationAvailable)
  }
}

async function collectSerial(ctx: ModuleContext, client: RigPreflightClientEvidence | undefined, now: number): Promise<RigSerialObservation> {
  const serialStore = getSerialDevicesStore(ctx.app)
  const deviceStore = getDeviceConfigStore(ctx.app)
  await Promise.all([serialStore.ensureLoaded(), deviceStore.ensureLoaded()])
  const live = ctx.serialHub.listDevices()
  const ports = await ctx.serialHub.listPorts().catch(() => [])
  const configured = serialStore.list()
  const profiles = deviceStore.list()
  const configuredEvidence = configured.map((entry) => {
    const desired = desiredSerialIdentity(entry)
    const evidence = resolveConfiguredSerialEvidence(entry, live, ports)
    return { desired, ...evidence }
  })
  const profileEvidence = profiles
    .filter((profile) => profile.deviceId !== 'simx' && (profile.deviceId || profile.port))
    .map((profile) => {
      const desired = `profile:${profile.id}`
      const evidence = resolveConfiguredSerialEvidence(
        {
          id: profile.deviceId,
          path: profile.port ?? ''
        },
        live,
        ports
      )
      return { desired, ...evidence }
    })
  const activeConfiguredEvidence = configured.length > 0
    ? configuredEvidence
    : profileEvidence
  const configuredIdentities = configured.length > 0
    ? configuredEvidence.map((entry) => entry.desired)
    : profileEvidence.map((entry) => entry.desired)
  const connectedConfiguredIdentities = activeConfiguredEvidence
    .filter((entry) => entry.connected)
    .map((entry) => entry.desired)
  const observedConfiguredIdentities = activeConfiguredEvidence.map(
    (entry) => `${entry.desired}=>${entry.observedIdentity}`
  )
  const esp32Profiles = profiles.filter((profile) => profile.board === 'esp32' || profile.board === 'esp32s3')
  const esp32RequiredIdentities = esp32Profiles
    .map((profile) => canonicalRigEsp32Identity(`profile:${profile.id}`))
    .filter((identity): identity is string => identity !== null)
  const esp32SerialConnectedIdentities = esp32Profiles
    .filter((profile) =>
      live.some((device) =>
        device.connected &&
        ((profile.deviceId && profile.deviceId === device.id) || (profile.port && profile.port === device.path))
      )
    )
    .map((profile) => canonicalRigEsp32Identity(`profile:${profile.id}`))
    .filter((identity): identity is string => identity !== null)
  const esp32ConnectedIdentities = stableSortedIdentities([
    ...esp32SerialConnectedIdentities,
    ...strings(client?.esp32ConnectedIdentities)
      .map(canonicalRigEsp32Identity)
      .filter((identity): identity is string => identity !== null)
  ])
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
    configuredIdentities: stableSortedIdentities(configuredIdentities),
    connectedConfiguredIdentities: stableSortedIdentities(connectedConfiguredIdentities),
    observedConfiguredIdentities: stableSortedIdentities(observedConfiguredIdentities),
    esp32RequiredIdentities: stableSortedIdentities(esp32RequiredIdentities),
    esp32ConnectedIdentities
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
      displayIds: screen.getAllDisplays().map((display) => display.id).sort((a, b) => a - b),
      openDashboardWindowIdentities: stableSortedIdentities(
        (dashboardManager?.listOpen() ?? []).map(
          (window) => `${window.id}@${window.displayId}:${window.fullscreen ? 'fullscreen' : 'windowed'}`
        )
      )
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

export function register(ctx: ModuleContext): void {
  const persistence = new FileRigPreflightPersistence(
    join(ctx.app.getPath('userData'), STORE_FILE)
  )
  const service = new RigPreflightService({
    persistence,
    collectObservation: (profile, client) => collectObservation(ctx, profile, client)
  })
  let expiryScheduler: RigPreflightExpiryScheduler
  let evidenceWatchdog: RigPreflightExpiryScheduler
  const publishState = async (): Promise<void> => {
    const state = await service.getState()
    const active = state.activeCertificate
    const certificateActive =
      active &&
      active.invalidatedAt === null &&
      !state.activeCertificateExpired &&
      !state.storage.blocked
        ? active
        : null
    expiryScheduler.schedule(certificateActive?.certificate.expiresAt ?? null)
    evidenceWatchdog.schedule(
      certificateActive
        ? certificateActive.lastValidatedAt + state.profile.evidenceMaxAgeMs + 1
        : null
    )
    ctx.broadcast(RIG_PREFLIGHT_CHANNELS.changed, state)
  }
  expiryScheduler = new RigPreflightExpiryScheduler({
    onExpire: async () => {
      try {
        if (await service.expireActiveCertificate()) await publishState()
      } catch (error) {
        logger.warn('rig-preflight', 'certificate expiry failed closed', {
          message: error instanceof Error ? error.message : String(error)
        })
        await publishState()
      }
    }
  })
  evidenceWatchdog = new RigPreflightExpiryScheduler({
    onExpire: async () => {
      try {
        if (await service.expireStaleEvidenceHeartbeat()) await publishState()
      } catch (error) {
        logger.warn('rig-preflight', 'evidence watchdog failed closed', {
          message: error instanceof Error ? error.message : String(error)
        })
        await publishState()
      }
    }
  })
  const startupReady = service.requireStartupRevalidation()
    .then(() => publishState())
    .catch((error) => {
      logger.warn('rig-preflight', 'startup revalidation gate failed closed', {
        message: error instanceof Error ? error.message : String(error)
      })
      return publishState()
    })

  ctx.ipcMain.handle(RIG_PREFLIGHT_CHANNELS.getState, async () => {
    await startupReady
    return service.getState()
  })
  ctx.ipcMain.handle(RIG_PREFLIGHT_CHANNELS.setProfile, async (_event, profile: RigPreflightProfilePatch) => {
    await startupReady
    const state = await service.setProfile(profile ?? {})
    await publishState()
    return state
  })
  ctx.ipcMain.handle(RIG_PREFLIGHT_CHANNELS.run, async (_event, request?: RigPreflightRunRequest) => {
    await startupReady
    const run = await service.run(request as RigPreflightRunRequest)
    await publishState()
    return run
  })
  ctx.ipcMain.handle(RIG_PREFLIGHT_CHANNELS.waive, async (_event, request: RigPreflightWaiverRequest) => {
    await startupReady
    const state = await service.createWaiver(request)
    await publishState()
    return state
  })
  ctx.ipcMain.handle(RIG_PREFLIGHT_CHANNELS.removeWaiver, async (_event, id: string) => {
    await startupReady
    const state = await service.removeWaiver(id)
    await publishState()
    return state
  })
  ctx.ipcMain.handle(RIG_PREFLIGHT_CHANNELS.acceptKnownGood, async (_event, runId: string, owner?: string) => {
    await startupReady
    const state = await service.acceptKnownGood(runId, owner)
    await publishState()
    return state
  })
  ctx.ipcMain.handle(RIG_PREFLIGHT_CHANNELS.faultMatrix, async (_event, request?: RigPreflightRunRequest) => {
    await startupReady
    const result = await service.runFaultMatrix(request as RigPreflightRunRequest)
    await publishState()
    return result
  })
  ctx.ipcMain.handle(RIG_PREFLIGHT_CHANNELS.revalidate, async (_event, request?: RigPreflightRunRequest) => {
    await startupReady
    const result = await service.revalidate(request as RigPreflightRunRequest)
    if (result.changed) await publishState()
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
          await publishState()
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
      if (changed) await publishState()
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
      if (changed) await publishState()
    }).catch(() => undefined)
  }
  screen.on('display-removed', onDisplayRemoved)

  ctx.app.once('before-quit', () => {
    clearInterval(driftPoll)
    expiryScheduler.dispose()
    evidenceWatchdog.dispose()
    ctx.serialHub.off('device-removed', onSerialRemoved)
    screen.off('display-removed', onDisplayRemoved)
  })
}
