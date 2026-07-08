// Single shared DEVICE REGISTRY for the whole renderer.
//
// Problem this solves: every menu used to enumerate / connect its own devices
// independently (the SIM-X primary via window.api, the secondary serial fleet
// via arduino:*, audio outputs via navigator.mediaDevices, displays via
// overlays:getDisplays). Connecting a device in "Devices" therefore did
// not reflect anywhere else without reconnecting.
//
// This provider subscribes ONCE to every source and exposes a single
// normalized, typed view through the useDevices() hook. Every menu reads from
// here, so a device connected/selected in DevicesView is instantly visible in
// all other menus — covering both serial/USB devices AND non-serial Windows
// devices (audio outputs + HDMI/monitors). All actions reuse the EXISTING IPC
// channels under the hood; no main-process changes are required.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import {
  ARDUINO_CHANNELS,
  type ArduinoDevicesChangedPayload,
  type GenericSerialDeviceConfig,
  type SerialDeviceSummary
} from '../../../../shared/arduino'
import type { DeviceInfo, PortInfo } from '../../../../shared/ipc'
import type { OverlayDisplayInfo } from '../../../../shared/overlays'

// ─── Normalized device shapes (discriminated by `transport`) ─────────────────

export type DeviceTransport = 'serial-primary' | 'serial-secondary' | 'audio-output' | 'display'

export interface AudioOutputDeviceInfo {
  deviceId: string
  label: string
}

interface UnifiedDeviceBase {
  // Stable, transport-prefixed id so the unified list keys never collide.
  id: string
  transport: DeviceTransport
  label: string
  detail: string
  // For serial devices: the live link is open. For Windows-managed audio
  // outputs and displays: the device is currently available.
  connected: boolean
}

export interface UnifiedSerialPrimaryDevice extends UnifiedDeviceBase {
  transport: 'serial-primary'
  path: string | null
  info: DeviceInfo | null
}

export interface UnifiedSerialDryndaryDevice extends UnifiedDeviceBase {
  transport: 'serial-secondary'
  path: string
  baud: number
  summary: SerialDeviceSummary
}

export interface UnifiedAudioOutputDevice extends UnifiedDeviceBase {
  transport: 'audio-output'
  deviceId: string
}

export interface UnifiedDisplayDevice extends UnifiedDeviceBase {
  transport: 'display'
  displayId: number
  primary: boolean
  info: OverlayDisplayInfo
}

export type UnifiedDevice =
  | UnifiedSerialPrimaryDevice
  | UnifiedSerialDryndaryDevice
  | UnifiedAudioOutputDevice
  | UnifiedDisplayDevice

export interface AddDryndaryDeviceInput {
  path: string
  label: string
  baud: number
  autoConnect?: boolean
}

// ─── Hook surface ────────────────────────────────────────────────────────────

export interface DeviceRegistryValue {
  // Normalized source slices (the raw shapes each menu already understands).
  ports: PortInfo[]
  serialDevices: SerialDeviceSummary[]
  deviceConfigs: GenericSerialDeviceConfig[]
  audioOutputs: AudioOutputDeviceInfo[]
  audioOutputsStatus: string
  displays: OverlayDisplayInfo[]

  // The SIM-X primary ButtonBox (the legacy `connectedDevice`).
  primaryDevice: DeviceInfo | null
  setPrimaryDevice(device: DeviceInfo | null): void

  // One unified, discriminated list aggregating EVERY transport.
  devices: UnifiedDevice[]

  // Busy flags so consumers can disable controls during shared operations.
  busy: boolean
  audioBusy: boolean

  // Read actions (all reuse existing channels). They return their result so
  // callers can drive their own toasts/UX without re-querying.
  refreshPorts(): Promise<PortInfo[]>
  refreshFleet(): Promise<void>
  refreshAudioOutputs(requestLabels?: boolean): Promise<void>
  refreshDisplays(): Promise<OverlayDisplayInfo[]>
  refreshAll(): Promise<void>

  // Primary SIM-X link (window.api / buttonbox:* under the hood).
  connectPrimary(path: string): Promise<DeviceInfo>
  disconnectPrimary(): Promise<void>
  // Runs the device output self-test (rev-lights sweep + OLED message) so the
  // serial OUTPUT path can be verified on the hardware without iRacing running.
  testPrimaryOutput(): Promise<void>

  // Dryndary/generic serial fleet (arduino:* under the hood).
  addDryndaryDevice(input: AddDryndaryDeviceInput): Promise<SerialDeviceSummary>
  removeDryndaryDevice(id: string): Promise<void>
  reconnectDryndaryDevice(id: string): Promise<SerialDeviceSummary>
  disconnectDryndaryDevice(id: string): Promise<void>
}

const DeviceRegistryContext = createContext<DeviceRegistryValue | undefined>(undefined)

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Map raw MediaDeviceInfo entries to the audio outputs we expose. We KEEP the
// synthetic 'default' sink (relabeled "Padrão do sistema") instead of dropping it
// — on Chromium it is frequently the only entry with a stable, usable id, so
// filtering it left the picker empty/unusable. We still drop empty ids (those
// only appear before the media-permission grant unlocks labels) and de-dupe by
// deviceId. The system-default entry is surfaced first when present.
function mapAudioOutputs(list: MediaDeviceInfo[]): AudioOutputDeviceInfo[] {
  const seen = new Set<string>()
  const outputs: AudioOutputDeviceInfo[] = []
  let index = 0
  for (const device of list) {
    if (device.kind !== 'audiooutput') continue
    const deviceId = device.deviceId?.trim() ?? ''
    if (deviceId.length === 0) continue
    if (seen.has(deviceId)) continue
    seen.add(deviceId)
    index += 1
    outputs.push({
      deviceId,
      label: deviceId === 'default' ? 'Padrão do sistema' : device.label || `Output ${index}`
    })
  }
  outputs.sort((a, b) => (a.deviceId === 'default' ? -1 : b.deviceId === 'default' ? 1 : 0))
  return outputs
}

// On-demand getUserMedia({audio}) bootstrap. Chromium only exposes audiooutput
// labels/ids AFTER a media-permission grant; requesting an audio stream once (then
// immediately stopping its tracks) unlocks them for enumerateDevices. We only do
// this for explicit label requests, never on provider mount/app launch.
let audioLabelsUnlocked = false

async function unlockAudioLabels(): Promise<void> {
  if (audioLabelsUnlocked) return
  if (!navigator.mediaDevices?.getUserMedia) return
  let stream: MediaStream | null = null
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    audioLabelsUnlocked = true
  } finally {
    stream?.getTracks().forEach((track) => track.stop())
  }
}

export function DeviceRegistryProvider({ children }: { children: ReactNode }): ReactElement {
  const [ports, setPorts] = useState<PortInfo[]>([])
  const [serialDevices, setSerialDevices] = useState<SerialDeviceSummary[]>([])
  const [deviceConfigs, setDeviceConfigs] = useState<GenericSerialDeviceConfig[]>([])
  const [audioOutputs, setAudioOutputs] = useState<AudioOutputDeviceInfo[]>([])
  const [audioOutputsStatus, setAudioOutputsStatus] = useState('Audio outputs not scanned yet.')
  const [displays, setDisplays] = useState<OverlayDisplayInfo[]>([])
  const [primaryDevice, setPrimaryDevice] = useState<DeviceInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [audioBusy, setAudioBusy] = useState(false)

  const refreshPorts = useCallback(async (): Promise<PortInfo[]> => {
    setBusy(true)
    try {
      const next = await window.api.listPorts()
      setPorts(next)
      return next
    } finally {
      setBusy(false)
    }
  }, [])

  const refreshFleet = useCallback(async (): Promise<void> => {
    const [list, configs] = await Promise.all([
      window.ipc.invoke<SerialDeviceSummary[]>(ARDUINO_CHANNELS.listDevices),
      window.ipc.invoke<GenericSerialDeviceConfig[]>(ARDUINO_CHANNELS.getDeviceConfigs)
    ])
    setSerialDevices(Array.isArray(list) ? list : [])
    setDeviceConfigs(Array.isArray(configs) ? configs : [])
  }, [])

  const refreshDisplays = useCallback(async (): Promise<OverlayDisplayInfo[]> => {
    const next = await window.ipc.invoke<OverlayDisplayInfo[]>('overlays:getDisplays')
    const value = Array.isArray(next) ? next : []
    setDisplays(value)
    return value
  }, [])

  const refreshAudioOutputs = useCallback(async (requestLabels = false): Promise<void> => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setAudioOutputs([])
      setAudioOutputsStatus('Audio output enumeration is not available in this renderer.')
      return
    }

    setAudioBusy(true)
    try {
      // Passive scans keep enumeration working without prompting for microphone
      // access. Explicit Sounds/Haptics refreshes can request labels on demand.
      if (requestLabels) {
        await unlockAudioLabels().catch(() => undefined)
      }
      const list = await navigator.mediaDevices.enumerateDevices()
      const outputs = mapAudioOutputs(list)
      setAudioOutputs(outputs)
      setAudioOutputsStatus(
        outputs.length > 0
          ? `Found ${outputs.length} audio output device${outputs.length === 1 ? '' : 's'}.`
          : 'No dedicated audio outputs found; using system default.'
      )
    } catch (error) {
      setAudioOutputsStatus(
        `Could not refresh labels: ${getErrorMessage(error)}. Showing available outputs if labels are already unlocked.`
      )
      const fallback = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[])
      setAudioOutputs(mapAudioOutputs(fallback))
    } finally {
      setAudioBusy(false)
    }
  }, [])

  const refreshAll = useCallback(async (): Promise<void> => {
    await Promise.allSettled([refreshPorts(), refreshFleet(), refreshDisplays(), refreshAudioOutputs(false)])
  }, [refreshPorts, refreshFleet, refreshDisplays, refreshAudioOutputs])

  const connectPrimary = useCallback(async (path: string): Promise<DeviceInfo> => {
    setBusy(true)
    try {
      const device = await window.api.connect(path)
      setPrimaryDevice(device)
      return device
    } finally {
      setBusy(false)
    }
  }, [])

  const disconnectPrimary = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.disconnect()
      setPrimaryDevice(null)
    } finally {
      setBusy(false)
    }
  }, [])

  const testPrimaryOutput = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.runSelfTest()
    } finally {
      setBusy(false)
    }
  }, [])

  const addDryndaryDevice = useCallback(
    async (input: AddDryndaryDeviceInput): Promise<SerialDeviceSummary> => {
      setBusy(true)
      try {
        const summary = await window.ipc.invoke<SerialDeviceSummary>(ARDUINO_CHANNELS.addDevice, {
          path: input.path,
          label: input.label,
          baud: input.baud,
          autoConnect: input.autoConnect ?? true
        })
        await refreshFleet()
        return summary
      } finally {
        setBusy(false)
      }
    },
    [refreshFleet]
  )

  const removeDryndaryDevice = useCallback(
    async (id: string): Promise<void> => {
      setBusy(true)
      try {
        await window.ipc.invoke(ARDUINO_CHANNELS.removeDevice, id)
        await refreshFleet()
      } finally {
        setBusy(false)
      }
    },
    [refreshFleet]
  )

  const reconnectDryndaryDevice = useCallback(
    async (id: string): Promise<SerialDeviceSummary> => {
      setBusy(true)
      try {
        const summary = await window.ipc.invoke<SerialDeviceSummary>(ARDUINO_CHANNELS.reconnectDevice, id)
        await refreshFleet()
        return summary
      } finally {
        setBusy(false)
      }
    },
    [refreshFleet]
  )

  const disconnectDryndaryDevice = useCallback(
    async (id: string): Promise<void> => {
      setBusy(true)
      try {
        await window.ipc.invoke(ARDUINO_CHANNELS.disconnectDevice, id)
        await refreshFleet()
      } finally {
        setBusy(false)
      }
    },
    [refreshFleet]
  )

  // Subscribe ONCE to every device source. Broadcasts keep the shared state in
  // sync no matter which menu triggered the change.
  useEffect(() => {
    void refreshPorts().catch(() => undefined)
    void refreshFleet().catch(() => undefined)
    void refreshDisplays().catch(() => undefined)
    void refreshAudioOutputs(false).catch(() => undefined)

    // Auto-connect runs in the main process before the renderer mounts, so the
    // primary state never arrives through connectPrimary(). Pull the live status
    // once, then track every connect/disconnect (auto + manual) so the sidebar
    // and DevicesView pill stay in sync.
    void window.api
      .getStatus()
      .then((device) => setPrimaryDevice(device))
      .catch(() => undefined)
    const offConnection = window.api.onConnectionChange((device) => setPrimaryDevice(device))

    const offFleet = window.ipc.subscribe<ArduinoDevicesChangedPayload>(
      ARDUINO_CHANNELS.devicesChanged,
      (payload) => {
        setSerialDevices(payload.devices)
        // Reconcile the primary: when the SIM-X cable is yanked the hub drops it
        // from the fleet broadcast, so clear the stale "connected" primary state
        // (otherwise the sidebar/banner keep showing SIM-X connected).
        const yesxConnected = payload.devices.some((d) => d.kind === 'sim-x' && d.connected)
        if (!yesxConnected) setPrimaryDevice((current) => (current ? null : current))
      }
    )
    // Overlay state changes can accompany a monitor being added/removed; refresh
    // the shared display list so every menu sees the same monitors.
    const offOverlay = window.ipc.subscribe<unknown>('overlays:state', () => {
      void refreshDisplays().catch(() => undefined)
    })

    const mediaDevices = navigator.mediaDevices
    const handleDeviceChange = (): void => {
      void refreshAudioOutputs(false).catch(() => undefined)
    }
    mediaDevices?.addEventListener?.('devicechange', handleDeviceChange)

    return () => {
      offConnection()
      offFleet()
      offOverlay()
      mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange)
    }
    // Actions are stable (useCallback); run subscriptions once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const devices = useMemo<UnifiedDevice[]>(() => {
    const result: UnifiedDevice[] = []

    result.push({
      id: 'serial-primary:sim-x',
      transport: 'serial-primary',
      label: primaryDevice?.name ?? 'SIM-X ButtonBox',
      detail: primaryDevice
        ? `${primaryDevice.path} · FW ${primaryDevice.firmwareVersion ?? 'SIM-X'}`
        : 'Não conectado',
      connected: primaryDevice !== null,
      path: primaryDevice?.path ?? null,
      info: primaryDevice
    })

    for (const summary of serialDevices) {
      if (summary.kind === 'sim-x') continue
      result.push({
        id: `serial-secondary:${summary.id}`,
        transport: 'serial-secondary',
        label: summary.label,
        detail: `${summary.path} · ${summary.baud} 8N1`,
        connected: summary.connected,
        path: summary.path,
        baud: summary.baud,
        summary
      })
    }

    for (const output of audioOutputs) {
      result.push({
        id: `audio-output:${output.deviceId}`,
        transport: 'audio-output',
        label: output.label,
        detail: 'Saída de áudio · Windows',
        connected: true,
        deviceId: output.deviceId
      })
    }

    for (const display of displays) {
      result.push({
        id: `display:${display.id}`,
        transport: 'display',
        label: display.label,
        detail: `${display.bounds.width}×${display.bounds.height}${display.primary ? ' · principal' : ''}`,
        connected: true,
        displayId: display.id,
        primary: display.primary,
        info: display
      })
    }

    return result
  }, [primaryDevice, serialDevices, audioOutputs, displays])

  const value = useMemo<DeviceRegistryValue>(
    () => ({
      ports,
      serialDevices,
      deviceConfigs,
      audioOutputs,
      audioOutputsStatus,
      displays,
      primaryDevice,
      setPrimaryDevice,
      devices,
      busy,
      audioBusy,
      refreshPorts,
      refreshFleet,
      refreshAudioOutputs,
      refreshDisplays,
      refreshAll,
      connectPrimary,
      disconnectPrimary,
      testPrimaryOutput,
      addDryndaryDevice,
      removeDryndaryDevice,
      reconnectDryndaryDevice,
      disconnectDryndaryDevice
    }),
    [
      ports,
      serialDevices,
      deviceConfigs,
      audioOutputs,
      audioOutputsStatus,
      displays,
      primaryDevice,
      devices,
      busy,
      audioBusy,
      refreshPorts,
      refreshFleet,
      refreshAudioOutputs,
      refreshDisplays,
      refreshAll,
      connectPrimary,
      disconnectPrimary,
      testPrimaryOutput,
      addDryndaryDevice,
      removeDryndaryDevice,
      reconnectDryndaryDevice,
      disconnectDryndaryDevice
    ]
  )

  return <DeviceRegistryContext.Provider value={value}>{children}</DeviceRegistryContext.Provider>
}

// The single source of truth every view reads.
export function useDevices(): DeviceRegistryValue {
  const context = useContext(DeviceRegistryContext)
  if (!context) {
    throw new Error('useDevices must be used within a <DeviceRegistryProvider>.')
  }
  return context
}
