import type { ActionBinding, EmulationStatus } from '../../../shared/actions'
import type { SerialDeviceSummary } from '../../../shared/arduino'
import type { HapticsConfig } from '../../../shared/haptics'
import {
  RIG_PREFLIGHT_CHANNELS,
  canonicalRigEsp32Identity,
  stableSortedIdentities,
  type RigPreflightClientEvidence,
  type RigPreflightStateSnapshot
} from '../../../shared/rig-preflight'
import type { PiperVoiceInfo, TtsEngineStatus } from '../../../shared/spotter'
import type { SttStatus } from '../../../shared/stt-ipc'
import type { StreamingStatus } from '../../../shared/streaming'

const IPC_TIMEOUT_MS = 8_000

interface AudioProbe {
  evidence: NonNullable<RigPreflightClientEvidence['audio']>
  outputIds: string[]
}

interface AudioContextProbe {
  state: string
  resume(): Promise<void>
  close(): Promise<void>
}

export interface AudioProbeDependencies {
  enumerateDevices?: () => Promise<MediaDeviceInfo[]>
  createAudioContext?: () => AudioContextProbe
}

interface Esp32Status {
  id?: string
  host?: string
  port?: number
  connected?: boolean
}

async function bounded<T>(promise: Promise<T>, timeoutMs = IPC_TIMEOUT_MS): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs)
      })
    ])
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function mediaLabel(device: MediaDeviceInfo, fallback: string): string {
  if (device.label.trim()) return device.label.trim()
  if (device.deviceId === 'default') return `System default ${fallback}`
  return `${fallback} ${device.deviceId.slice(0, 8) || 'unlabelled'}`
}

export async function collectAudioProbe(
  dependencies: AudioProbeDependencies = {}
): Promise<AudioProbe> {
  let enumerationSucceeded = false
  let devices: MediaDeviceInfo[] = []
  let audioEngineError: string | undefined
  const enumerateDevices =
    dependencies.enumerateDevices ??
    (navigator.mediaDevices?.enumerateDevices
      ? () => navigator.mediaDevices.enumerateDevices()
      : undefined)
  if (enumerateDevices) {
    try {
      devices = await enumerateDevices()
      enumerationSucceeded = true
    } catch (error) {
      audioEngineError = `Device enumeration failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  const outputs = devices.filter((device) => device.kind === 'audiooutput' && device.deviceId)
  const inputs = devices.filter((device) => device.kind === 'audioinput' && device.deviceId)

  let audioEngineOk = false
  let audioContextState = 'unavailable'
  let context: AudioContextProbe | null = null
  try {
    context = dependencies.createAudioContext?.() ?? new AudioContext()
    await context.resume().catch(() => undefined)
    audioContextState = context.state
    audioEngineOk = context.state === 'running'
  } catch (error) {
    audioEngineError = [
      audioEngineError,
      `AudioContext failed: ${error instanceof Error ? error.message : String(error)}`
    ].filter(Boolean).join('; ')
  } finally {
    await context?.close().catch(() => undefined)
  }

  const outputLabels = outputs.map((device) => mediaLabel(device, 'output'))
  const outputIds = outputs.map((device) => device.deviceId)
  return {
    evidence: {
      enumerationSucceeded,
      audioEngineOk,
      audioContextState,
      audioEngineError,
      outputIdentities: stableSortedIdentities(outputIds.map((id) => `audio-output:${id}`)),
      outputLabels,
      inputIdentities: stableSortedIdentities(inputs.map((device) => `audio-input:${device.deviceId}`)),
      inputLabels: inputs.map((device) => mediaLabel(device, 'input'))
    },
    outputIds
  }
}

function currentGamepads(): Gamepad[] {
  if (!navigator.getGamepads) return []
  return Array.from(navigator.getGamepads()).filter((gamepad): gamepad is Gamepad => Boolean(gamepad?.connected))
}

export async function collectRigPreflightClientEvidence(): Promise<RigPreflightClientEvidence> {
  const observedAt = Date.now()
  const audioPromise = collectAudioProbe()
  const [
    ttsStatus,
    voices,
    sttStatus,
    haptics,
    bindings,
    emulation,
    streaming,
    serialDevices,
    esp32Statuses,
    audio
  ] = await Promise.all([
    bounded(window.ipc.invoke<TtsEngineStatus>('tts:engineStatus')),
    bounded(window.ipc.invoke<PiperVoiceInfo[]>('tts:listVoices')),
    bounded(window.ipc.invoke<SttStatus>('stt:status')),
    bounded(window.ipc.invoke<HapticsConfig>('haptics:getConfig')),
    bounded(window.ipc.invoke<ActionBinding[]>('actions:getBindings')),
    bounded(window.ipc.invoke<EmulationStatus>('actions:emulationStatus')),
    bounded(window.ipc.invoke<StreamingStatus>('streaming:status')),
    bounded(window.ipc.invoke<SerialDeviceSummary[]>('arduino:listDevices')),
    bounded(window.ipc.invoke<Esp32Status[]>('esp32:status')),
    audioPromise
  ])
  const gamepads = currentGamepads()
  const connectedSerialIds = new Set(
    (serialDevices ?? []).filter((device) => device.connected).map((device) => device.id)
  )
  const outputDeviceId = haptics?.outputDeviceId ?? ''
  const audioRouteAvailable = outputDeviceId
    ? audio.outputIds.includes(outputDeviceId)
    : (
        audio.evidence.enumerationSucceeded &&
        audio.evidence.audioContextState === 'running' &&
        audio.evidence.outputIdentities.length > 0
      )
  const esp32Connected = (esp32Statuses ?? []).filter((status) => status.connected)

  return {
    observedAt,
    audio: audio.evidence,
    tts: ttsStatus
      ? {
          enginePresent: ttsStatus.engine !== 'none',
          engineOk: ttsStatus.ok,
          engineReason: ttsStatus.reason,
          installedVoiceIds: stableSortedIdentities(
            (voices ?? []).filter((voice) => voice.installed).map((voice) => `voice:${voice.id}`)
          )
        }
      : undefined,
    stt: sttStatus
      ? {
          enabled: sttStatus.enabled,
          binaryPresent: sttStatus.binaryPresent,
          modelPresent: sttStatus.modelPresent,
          vadModelPresent: sttStatus.vadModelPresent
        }
      : undefined,
    haptics: haptics
      ? {
          enabled: haptics.enabled,
          muted: haptics.muted,
          enabledEffects: Object.values(haptics.effects).filter((effect) => effect.enabled).length,
          outputDeviceId,
          audioRouteAvailable,
          arduinoEnabled: haptics.arduino.enabled,
          arduinoDeviceId: haptics.arduino.deviceId,
          arduinoConnected: connectedSerialIds.has(haptics.arduino.deviceId)
        }
      : undefined,
    controls: {
      gamepadIdentities: stableSortedIdentities(
        gamepads.map((gamepad) => `gamepad:${gamepad.id || gamepad.index}`)
      ),
      bindingIdentities: stableSortedIdentities(
        (bindings ?? []).map((binding) => `binding:${binding.id}`)
      ),
      enabledBindingIdentities: stableSortedIdentities(
        (bindings ?? []).filter((binding) => binding.enabled).map((binding) => `binding:${binding.id}`)
      ),
      keyboardEmulationAvailable: emulation?.keyboard.available ?? false,
      gamepadEmulationAvailable: emulation?.gamepad.available ?? false
    },
    streaming: streaming
      ? {
          running: streaming.running,
          port: streaming.port,
          accessMode: streaming.accessMode,
          autoTunnelAvailable: streaming.autoTunnelAvailable
        }
      : undefined,
    esp32ConnectedIdentities: stableSortedIdentities(
      esp32Connected.map(
        (status) => canonicalRigEsp32Identity(
          `wifi:${status.id || `${status.host || 'unknown'}:${status.port || 47650}`}`
        )
      ).filter((identity): identity is string => identity !== null)
    )
  }
}

let monitorStarted = false

export function startRigPreflightEvidenceMonitor(intervalMs = 5_000): void {
  if (monitorStarted) return
  monitorStarted = true
  let busy = false
  const tick = async (): Promise<void> => {
    if (busy) return
    busy = true
    try {
      const state = await window.ipc.invoke<RigPreflightStateSnapshot>(
        RIG_PREFLIGHT_CHANNELS.getState
      )
      const active = state.activeCertificate
      if (
        !active ||
        active.invalidatedAt !== null ||
        state.activeCertificateExpired ||
        state.storage.blocked ||
        active.certificate.decision === 'blocked'
      ) return
      const clientEvidence = await collectRigPreflightClientEvidence()
      await window.ipc.invoke(
        RIG_PREFLIGHT_CHANNELS.revalidate,
        { profile: state.profile, clientEvidence }
      )
    } catch {
      // Main owns fail-closed state and surfaces storage/evidence failures.
    } finally {
      busy = false
    }
  }
  const initial = setTimeout(() => void tick(), 1_000)
  const interval = setInterval(() => void tick(), Math.max(2_000, intervalMs))
  window.addEventListener('beforeunload', () => {
    clearTimeout(initial)
    clearInterval(interval)
  }, { once: true })
}
