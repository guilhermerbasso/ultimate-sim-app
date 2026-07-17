import type { ActionBinding, EmulationStatus } from '../../../shared/actions'
import type { SerialDeviceSummary } from '../../../shared/arduino'
import type { HapticsConfig } from '../../../shared/haptics'
import {
  type RigPreflightClientEvidence
} from '../../../shared/rig-preflight'
import type { PiperVoiceInfo, TtsEngineStatus } from '../../../shared/spotter'
import type { SttStatus } from '../../../shared/stt-ipc'
import type { StreamingStatus } from '../../../shared/streaming'

const IPC_TIMEOUT_MS = 8_000

interface AudioProbe {
  evidence: NonNullable<RigPreflightClientEvidence['audio']>
  outputIds: string[]
}

interface Esp32Status {
  id?: string
  host?: string
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

async function collectAudioProbe(): Promise<AudioProbe> {
  const enumerationAvailable = Boolean(navigator.mediaDevices?.enumerateDevices)
  const devices = enumerationAvailable
    ? await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[])
    : []
  const outputs = devices.filter((device) => device.kind === 'audiooutput' && device.deviceId)
  const inputs = devices.filter((device) => device.kind === 'audioinput' && device.deviceId)

  let audioEngineOk = false
  let audioEngineError: string | undefined
  let context: AudioContext | null = null
  try {
    context = new AudioContext()
    await context.resume().catch(() => undefined)
    audioEngineOk = context.destination.channelCount > 0
  } catch (error) {
    audioEngineError = error instanceof Error ? error.message : String(error)
  } finally {
    await context?.close().catch(() => undefined)
  }

  const outputLabels = outputs.map((device) => mediaLabel(device, 'output'))
  const outputIds = outputs.map((device) => device.deviceId)
  if (audioEngineOk && outputLabels.length === 0) {
    outputLabels.push('System default (AudioContext)')
    outputIds.push('default')
  }
  return {
    evidence: {
      enumerationAvailable,
      audioEngineOk,
      audioEngineError,
      outputCount: outputLabels.length,
      outputLabels,
      inputCount: inputs.length,
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
    : audio.evidence.audioEngineOk && audio.evidence.outputCount > 0
  const esp32Connected = (esp32Statuses ?? []).filter((status) => status.connected)

  return {
    observedAt: Date.now(),
    audio: audio.evidence,
    tts: ttsStatus
      ? {
          enginePresent: ttsStatus.engine !== 'none',
          engineOk: ttsStatus.ok,
          engineReason: ttsStatus.reason,
          installedVoiceCount: (voices ?? []).filter((voice) => voice.installed).length
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
      gamepadCount: gamepads.length,
      gamepadLabels: gamepads.map((gamepad) => gamepad.id || `Gamepad ${gamepad.index}`),
      bindingCount: bindings?.length ?? 0,
      enabledBindingCount: (bindings ?? []).filter((binding) => binding.enabled).length,
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
    esp32ConnectedCount: esp32Connected.length,
    esp32Labels: esp32Connected.map((status) => status.id || status.host || 'ESP32')
  }
}
