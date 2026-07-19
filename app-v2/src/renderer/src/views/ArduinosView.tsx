import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PortInfo } from '../../../shared/ipc'
import type { ComponentType } from '../../../shared/devices'
import {
  ARDUINO_CHANNELS,
  ENCODER_DETENT_THRESHOLDS,
  GENERIC_DEVICE_DEFAULT_BAUD,
  QUICK_SERIAL_COMMANDS,
  type ArduinoDeviceSerialBatch,
  type ArduinoDevicesChangedPayload,
  type ArduinoFirmwareInfo,
  type ArduinoHardwareProfile,
  type ArduinoRuntimeState,
  type CompanionInputSnapshot,
  type EncoderDetentThreshold,
  type GenericSerialDeviceConfig,
  type SerialDeviceSummary,
  type SerialLogEntry
} from '../../../shared/arduino'
import { COMPANION_PRESETS, type CompanionPreset } from '../../../shared/companion'
import {
  OUTPUTS_CHANNELS,
  type OutputFormat,
  type OutputRoute,
  type OutputSource
} from '../../../shared/outputs'
import type { ExpressionDef } from '../../../shared/expr'
import type { AppViewProps } from '../App'
import { tt } from '../i18n'
import { HardwareWorkspace } from './arduinos/HardwareWorkspace'
import Esp32WifiView from './Esp32WifiView'
import RgbMatrixWorkspace from './arduinos/RgbMatrixWorkspace'
import { CustomSerialEditor } from './arduinos/CustomSerialEditor'
import { SectionExportImport } from '../components/SectionExportImport'

type TabId = 'myHardware' | 'esp32' | 'rgbLeds' | 'rgbMatrix' | 'screens' | 'tm1638' | 'displayAlerts' | 'customSerial' | 'gauges' | 'controls'
type ArduinoMode = 'disabled' | 'single' | 'multiple'
type HwSection = 'devices' | 'monitor' | 'info'

// The Arduino mode is a renderer-only UI preference (how the hub is presented
// and which devices stay connected). There is no backend settings channel for
// it, so it persists in localStorage — surviving reloads without inventing a new
// IPC channel.
const ARDUINO_MODE_STORAGE_KEY = 'ultimate-buttonbox.arduinoMode'
const DEFAULT_ARDUINO_MODE: ArduinoMode = 'multiple'

function isArduinoMode(value: unknown): value is ArduinoMode {
  return value === 'disabled' || value === 'single' || value === 'multiple'
}

function loadArduinoMode(): ArduinoMode {
  try {
    const stored = window.localStorage.getItem(ARDUINO_MODE_STORAGE_KEY)
    return isArduinoMode(stored) ? stored : DEFAULT_ARDUINO_MODE
  } catch {
    return DEFAULT_ARDUINO_MODE
  }
}

function persistArduinoMode(mode: ArduinoMode): void {
  try {
    window.localStorage.setItem(ARDUINO_MODE_STORAGE_KEY, mode)
  } catch {
    // localStorage can be unavailable (private mode / sandbox); ignore.
  }
}

const TABS: Array<{ id: TabId; label: string; eyebrow: string; description: string; emptyText: string }> = [
  {
    id: 'myHardware',
    label: 'Hardware',
    eyebrow: 'Devices',
    description: 'Manage hardware profiles, components (LEDs, screens, encoders), firmware, and serial monitor.',
    emptyText: 'No components yet. Add any SimHub-style module to this Arduino.'
  },
  {
    id: 'esp32',
    label: 'ESP32 Wi-Fi',
    eyebrow: 'Wireless',
    description: 'Provision, discover and connect ESP32 companion devices over USB or the local Wi-Fi network.',
    emptyText: 'No ESP32 Wi-Fi companion configured yet.'
  },
  {
    id: 'rgbLeds',
    label: 'RGB LEDs',
    eyebrow: 'Rev / flags',
    description: 'Configure WS2812/SK6812 strips for rev lights, flags or custom effects.',
    emptyText: 'No RGB LED strips in this profile yet.'
  },
  {
    id: 'rgbMatrix',
    label: 'iFlag Matrix',
    eyebrow: 'iFlag',
    description: 'iFlag 8×8 matrix editor — layout, pixel map, and effect stack. Configuration is separate from hardware profiles.',
    emptyText: 'No RGB matrix configured yet.'
  },
  {
    id: 'screens',
    label: 'Screens',
    eyebrow: 'OLED / LCD',
    description: 'Configure OLED, LCD, TFT or Nextion screens attached to companion Arduinos.',
    emptyText: 'No screens configured yet.'
  },
  {
    id: 'tm1638',
    label: 'TM1638 Leds',
    eyebrow: '7-seg',
    description: 'Configure TM1638/TM1637/MAX7219 segment displays for gear, speed, RPM or lap data.',
    emptyText: 'No segment display configured yet.'
  },
  {
    id: 'displayAlerts',
    label: 'Display & Alerts',
    eyebrow: 'Outputs',
    description: 'Configure alert outputs, buzzers, status LEDs and custom serial routes from telemetry or expressions.',
    emptyText: 'No alert components configured yet.'
  },
  {
    id: 'customSerial',
    label: 'Custom serial devices',
    eyebrow: 'Custom serial',
    description: 'Define arbitrary SimHub-style serial output templates driven by telemetry or expressions.',
    emptyText: 'No custom serial component configured yet.'
  },
  {
    id: 'gauges',
    label: 'Gauges',
    eyebrow: 'Servo / X27',
    description: 'Configure analog gauges driven by servo or X27 stepper motors.',
    emptyText: 'No gauges configured yet.'
  },
  {
    id: 'controls',
    label: 'Controls',
    eyebrow: 'Inputs',
    description: 'Configure buttons, encoders and analog axes reported by companion Arduinos.',
    emptyText: 'No controls configured yet.'
  }
]

const TAB_COMPONENTS: Partial<Record<TabId, ComponentType[]>> = {
  rgbLeds: ['rgbStrip'],
  rgbMatrix: ['rgbMatrix'],
  screens: ['screen'],
  tm1638: ['segDisplay'],
  displayAlerts: ['buzzer', 'startLed', 'customSerial'],
  customSerial: ['customSerial'],
  gauges: ['gauge'],
  controls: ['control']
}

const TAB_GROUPS: Array<{ title: string; description: string; ids: TabId[] }> = [
  {
    title: 'Hardware',
    description: 'Profiles, firmware, connections, serial console, and Wi-Fi.',
    ids: ['myHardware', 'esp32']
  },
  {
    title: 'Visual outputs',
    description: 'LEDs, iFlag matrix, screens, and alerts.',
    ids: ['rgbLeds', 'rgbMatrix', 'screens', 'tm1638', 'displayAlerts', 'customSerial']
  },
  {
    title: 'Physical I/O',
    description: 'Pointers, buttons, encoders, and analog axes.',
    ids: ['gauges', 'controls']
  }
]

const RENDER_LOG_LIMIT = 600
const CUSTOM_ROUTE_PREFIX = 'arduino:custom:'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isEngineNoise(entry: SerialLogEntry): boolean {
  return entry.dir === 'tx' && entry.origin === 'engine' && /^[RBOD]/.test(entry.text)
}

// Merge incoming serial entries into the current list, de-duplicating by the
// monotonic `seq` (the backfill snapshot and the live batches can overlap on
// open) and keeping the newest RENDER_LOG_LIMIT in seq order.
function mergeLog(current: SerialLogEntry[], incoming: SerialLogEntry[]): SerialLogEntry[] {
  if (incoming.length === 0) return current
  const bySeq = new Map<number, SerialLogEntry>()
  for (const entry of current) bySeq.set(entry.seq, entry)
  for (const entry of incoming) bySeq.set(entry.seq, entry)
  const merged = Array.from(bySeq.values()).sort((a, b) => a.seq - b.seq)
  return merged.length > RENDER_LOG_LIMIT ? merged.slice(merged.length - RENDER_LOG_LIMIT) : merged
}

function findActiveDevice(devices: SerialDeviceSummary[], id: string | null): SerialDeviceSummary | null {
  if (!id) return null
  return devices.find((device) => device.id === id) ?? null
}

function defaultActiveDeviceId(devices: SerialDeviceSummary[]): string | null {
  if (devices.length === 0) return null
  const yesx = devices.find((device) => device.kind === 'sim-x')
  return (yesx ?? devices[0]).id
}

export default function ArduinosView({
  connectedDevice,
  mapping,
  config,
  setConnectedDevice,
  refreshDeviceState,
  showToast,
  language
}: AppViewProps): ReactElement {
  const [tab, setTab] = useState<TabId>('myHardware')
  // Hydrate the persisted Arduino mode so it survives reloads.
  const [mode, setMode] = useState<ArduinoMode>(loadArduinoMode)
  const [hwSection, setHwSection] = useState<HwSection>('devices')
  const [ports, setPorts] = useState<PortInfo[]>([])
  const [selectedPath, setSelectedPath] = useState('')
  const [busy, setBusy] = useState(false)

  const [runtime, setRuntime] = useState<ArduinoRuntimeState | null>(null)
  const [profile, setProfile] = useState<ArduinoHardwareProfile | null>(null)
  const [firmware, setFirmware] = useState<ArduinoFirmwareInfo | null>(null)

  const [primaryLog, setPrimaryLog] = useState<SerialLogEntry[]>([])
  const [paused, setPaused] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [hideEngine, setHideEngine] = useState(true)
  const [command, setCommand] = useState('')
  const logRef = useRef<HTMLDivElement | null>(null)
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  // ─── Multi-device fleet state ───────────────────────────────────────────────
  const [devices, setDevices] = useState<SerialDeviceSummary[]>([])
  const [deviceConfigs, setDeviceConfigs] = useState<GenericSerialDeviceConfig[]>([])
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null)
  const [deviceLog, setDeviceLog] = useState<SerialLogEntry[]>([])
  const [inputs, setInputs] = useState<Record<string, CompanionInputSnapshot>>({})

  // ─── Custom serial outputs state ────────────────────────────────────────────
  const [routes, setRoutes] = useState<OutputRoute[]>([])
  const [expressions, setExpressions] = useState<ExpressionDef[]>([])

  const connected = Boolean(connectedDevice)
  const activeDevice = useMemo(() => findActiveDevice(devices, activeDeviceId), [devices, activeDeviceId])
  const activeIsPrimary = activeDevice?.kind === 'sim-x'

  // ─── Static data + runtime subscription ─────────────────────────────────────
  useEffect(() => {
    void (async () => {
      try {
        const [hw, fw, rt] = await Promise.all([
          window.ipc.invoke<ArduinoHardwareProfile>('arduino:getHardwareProfile'),
          window.ipc.invoke<ArduinoFirmwareInfo>('arduino:getFirmwareInfo'),
          window.ipc.invoke<ArduinoRuntimeState>('arduino:getRuntimeState')
        ])
        setProfile(hw)
        setFirmware(fw)
        setRuntime(rt)
      } catch (error) {
        showToast(getErrorMessage(error), 'error')
      }
    })()
    const off = window.ipc.subscribe<ArduinoRuntimeState>('arduino:runtimeState', (next) => setRuntime(next))
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Fleet bootstrap + live subscription ────────────────────────────────────
  useEffect(() => {
    void (async () => {
      try {
        const [list, configs, snapshot] = await Promise.all([
          window.ipc.invoke<SerialDeviceSummary[]>(ARDUINO_CHANNELS.listDevices),
          window.ipc.invoke<GenericSerialDeviceConfig[]>(ARDUINO_CHANNELS.getDeviceConfigs),
          window.ipc.invoke<CompanionInputSnapshot[]>(ARDUINO_CHANNELS.getInputs)
        ])
        setDevices(list)
        setDeviceConfigs(configs)
        setActiveDeviceId((current) => current ?? defaultActiveDeviceId(list))
        setInputs(Object.fromEntries(snapshot.map((s) => [s.deviceId, s])))
      } catch (error) {
        showToast(getErrorMessage(error), 'error')
      }
    })()

    const offDevices = window.ipc.subscribe<ArduinoDevicesChangedPayload>(
      ARDUINO_CHANNELS.devicesChanged,
      (payload) => {
        setDevices(payload.devices)
        setActiveDeviceId((current) => {
          if (current && payload.devices.some((d) => d.id === current)) return current
          return defaultActiveDeviceId(payload.devices)
        })
      }
    )
    const offInputs = window.ipc.subscribe<CompanionInputSnapshot[]>(
      ARDUINO_CHANNELS.inputs,
      (batch) => {
        setInputs((current) => {
          const next = { ...current }
          for (const snapshot of batch) {
            if (snapshot.removed) delete next[snapshot.deviceId]
            else next[snapshot.deviceId] = snapshot
          }
          return next
        })
      }
    )

    return () => {
      offDevices()
      offInputs()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Custom-serial: load routes + expression catalogue ──────────────────────
  useEffect(() => {
    if (tab !== 'displayAlerts' && tab !== 'customSerial') return
    let active = true
    void (async () => {
      try {
        const [loadedRoutes, loadedExpressions] = await Promise.all([
          window.ipc.invoke<OutputRoute[]>(OUTPUTS_CHANNELS.getRoutes),
          window.ipc.invoke<ExpressionDef[]>('expr:getExpressions').catch(() => [] as ExpressionDef[])
        ])
        if (!active) return
        setRoutes(loadedRoutes)
        setExpressions(loadedExpressions)
      } catch (error) {
        showToast(getErrorMessage(error), 'error')
      }
    })()
    const off = window.ipc.subscribe<{ routes: OutputRoute[] }>(
      OUTPUTS_CHANNELS.routesChanged,
      (payload) => setRoutes(payload.routes)
    )
    return () => {
      active = false
      off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  // ─── Reload helpers used after a section import ──────────────────────────────
  const reloadFleet = useCallback(async (): Promise<void> => {
    try {
      const [list, configs] = await Promise.all([
        window.ipc.invoke<SerialDeviceSummary[]>(ARDUINO_CHANNELS.listDevices),
        window.ipc.invoke<GenericSerialDeviceConfig[]>(ARDUINO_CHANNELS.getDeviceConfigs)
      ])
      setDevices(list)
      setDeviceConfigs(configs)
      await refreshDeviceState()
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }, [refreshDeviceState, showToast])

  const reloadRoutes = useCallback(async (): Promise<void> => {
    try {
      const loadedRoutes = await window.ipc.invoke<OutputRoute[]>(OUTPUTS_CHANNELS.getRoutes)
      setRoutes(loadedRoutes)
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }, [showToast])

  useEffect(() => {
    if (tab !== 'myHardware' || !activeIsPrimary) return
    let active = true
    void window.ipc.invoke('arduino:monitorStart').catch(() => undefined)
    void window.ipc
      .invoke<SerialLogEntry[]>('arduino:getLog')
      .then((entries) => {
        if (active) setPrimaryLog((current) => mergeLog(current, entries.slice(-RENDER_LOG_LIMIT)))
      })
      .catch(() => undefined)

    const offSerial = window.ipc.subscribe<SerialLogEntry[]>('arduino:serial', (batch) => {
      if (pausedRef.current) return
      setPrimaryLog((current) => mergeLog(current, batch))
    })
    const offCleared = window.ipc.subscribe('arduino:cleared', () => setPrimaryLog([]))

    return () => {
      active = false
      offSerial()
      offCleared()
      void window.ipc.invoke('arduino:monitorStop').catch(() => undefined)
    }
  }, [tab, activeIsPrimary])

  // ─── Serial monitor stream (non-primary device on the My Hardware tab) ──────
  useEffect(() => {
    if (tab !== 'myHardware' || activeIsPrimary || !activeDeviceId) {
      setDeviceLog([])
      return
    }
    let active = true
    void window.ipc
      .invoke<SerialLogEntry[]>(ARDUINO_CHANNELS.getDeviceLog, activeDeviceId)
      .then((entries) => {
        if (active) setDeviceLog((current) => mergeLog(current, entries.slice(-RENDER_LOG_LIMIT)))
      })
      .catch(() => undefined)

    const offDevice = window.ipc.subscribe<ArduinoDeviceSerialBatch>(
      ARDUINO_CHANNELS.deviceSerial,
      (batch) => {
        if (pausedRef.current) return
        if (batch.deviceId !== activeDeviceId) return
        setDeviceLog((current) => mergeLog(current, batch.entries))
      }
    )

    return () => {
      active = false
      offDevice()
    }
  }, [tab, activeIsPrimary, activeDeviceId])

  // Reset the device log when the user switches the active device so the
  // backfill matches the picker selection (no cross-device entries leak).
  useEffect(() => {
    setDeviceLog([])
  }, [activeDeviceId])

  const log = activeIsPrimary ? primaryLog : deviceLog
  const visibleLog = useMemo(
    () => (hideEngine && activeIsPrimary ? log.filter((entry) => !isEngineNoise(entry)) : log),
    [log, hideEngine, activeIsPrimary]
  )

  useEffect(() => {
    if (autoScroll && !paused && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [visibleLog, autoScroll, paused])

  // ─── Actions ────────────────────────────────────────────────────────────────
  const run = useCallback(
    async (action: () => Promise<void>, successMsg?: string): Promise<void> => {
      setBusy(true)
      try {
        await action()
        if (successMsg) showToast(successMsg, 'success')
      } catch (error) {
        showToast(getErrorMessage(error), 'error')
      } finally {
        setBusy(false)
      }
    },
    [showToast]
  )

  async function searchPorts(): Promise<void> {
    await run(async () => {
      const next = await window.api.listPorts()
      setPorts(next)
      const candidate = next.find((port) => port.isSimX) ?? next[0]
      if (!selectedPath && candidate) setSelectedPath(candidate.path)
    })
  }

  async function connect(): Promise<void> {
    if (!selectedPath) return
    await run(async () => {
      const device = await window.api.connect(selectedPath)
      setConnectedDevice(device)
      await refreshDeviceState()
    }, tt(language, 'arduinos.toast.simXConnected', { path: selectedPath }))
  }

  async function disconnect(): Promise<void> {
    await run(async () => {
      await window.api.disconnect()
      setConnectedDevice(null)
    }, tt(language, 'arduinos.toast.serialReleased'))
  }

  async function reloadConfigs(): Promise<void> {
    try {
      const configs = await window.ipc.invoke<GenericSerialDeviceConfig[]>(ARDUINO_CHANNELS.getDeviceConfigs)
      setDeviceConfigs(configs)
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  async function addGenericDevice(input: { path: string; label: string; baud: number }): Promise<void> {
    await run(async () => {
      const summary = await window.ipc.invoke<SerialDeviceSummary>(ARDUINO_CHANNELS.addDevice, {
        path: input.path,
        label: input.label,
        baud: input.baud,
        autoConnect: true
      })
      await reloadConfigs()
      setActiveDeviceId(summary.id)
    }, tt(language, 'arduinos.toast.deviceAdded', { name: input.label || input.path }))
  }

  async function removeGenericDevice(id: string): Promise<void> {
    await run(async () => {
      await window.ipc.invoke(ARDUINO_CHANNELS.removeDevice, id)
      await reloadConfigs()
    }, tt(language, 'arduinos.toast.deviceRemoved'))
  }

  async function reconnectGenericDevice(id: string): Promise<void> {
    await run(async () => {
      await window.ipc.invoke(ARDUINO_CHANNELS.reconnectDevice, id)
    })
  }

  async function disconnectGenericDevice(id: string): Promise<void> {
    await run(async () => {
      await window.ipc.invoke(ARDUINO_CHANNELS.disconnectDevice, id)
    })
  }

  // ─── Arduino mode (disabled / single / multiple) ────────────────────────────
  // Disconnect ONE device through the path that keeps shared state consistent:
  // the SIM-X primary goes through the legacy App-level connection, generics
  // through the fleet channel this view already uses.
  const disconnectOne = useCallback(
    async (device: SerialDeviceSummary): Promise<void> => {
      if (device.kind === 'sim-x') {
        await window.api.disconnect()
        setConnectedDevice(null)
      } else {
        await window.ipc.invoke(ARDUINO_CHANNELS.disconnectDevice, device.id)
      }
    },
    [setConnectedDevice]
  )

  // Apply a mode to the live fleet. 'multiple' keeps every device, 'disabled'
  // drops them all, 'single' keeps exactly one (the active/primary device).
  // No-ops safely when nothing is connected.
  const enforceMode = useCallback(
    async (next: ArduinoMode): Promise<void> => {
      const connectedDevices = devices.filter((device) => device.connected)
      if (next === 'disabled') {
        for (const device of connectedDevices) {
          await disconnectOne(device)
        }
        // Safety net: drop the primary even if it is not in the fleet list yet.
        if (connected && !connectedDevices.some((device) => device.kind === 'sim-x')) {
          await window.api.disconnect()
          setConnectedDevice(null)
        }
        return
      }
      if (next === 'single') {
        const keepId =
          (activeDeviceId && connectedDevices.some((device) => device.id === activeDeviceId)
            ? activeDeviceId
            : undefined) ??
          connectedDevices.find((device) => device.kind === 'sim-x')?.id ??
          connectedDevices[0]?.id
        for (const device of connectedDevices) {
          if (device.id === keepId) continue
          await disconnectOne(device)
        }
        if (keepId) setActiveDeviceId(keepId)
      }
    },
    [devices, connected, activeDeviceId, disconnectOne, setConnectedDevice]
  )

  // Switch mode: apply the effect first, then persist only on success so a
  // failed disconnect leaves the previous (working) mode in place. `run`
  // swallows errors into a toast, so this never throws at the call site.
  const changeMode = useCallback(
    (next: ArduinoMode): void => {
      if (next === mode) return
      void run(async () => {
        await enforceMode(next)
        setMode(next)
        persistArduinoMode(next)
      })
    },
    [mode, run, enforceMode]
  )

  function sendCommand(raw: string): void {
    const value = raw.trim()
    if (!value) return
    void run(async () => {
      if (activeIsPrimary || !activeDeviceId) {
        await window.ipc.invoke('arduino:sendRaw', value)
      } else {
        await window.ipc.invoke(ARDUINO_CHANNELS.sendDeviceRaw, activeDeviceId, value)
      }
    })
  }

  function clearMonitor(): void {
    void run(async () => {
      if (activeIsPrimary || !activeDeviceId) {
        await window.ipc.invoke('arduino:clearLog')
      } else {
        await window.ipc.invoke(ARDUINO_CHANNELS.clearDeviceLog, activeDeviceId)
        setDeviceLog([])
      }
    })
  }

  function setThreshold(value: EncoderDetentThreshold): void {
    void run(async () => {
      await window.ipc.invoke('arduino:setEncoderThreshold', value)
    }, tt(language, 'arduinos.toast.encoderThreshold', { value }))
  }

  async function saveRoute(route: OutputRoute): Promise<void> {
    await run(async () => {
      const others = routes.filter((r) => r.id !== route.id)
      const next = [...others, route]
      const persisted = await window.ipc.invoke<OutputRoute[]>(OUTPUTS_CHANNELS.setRoutes, next)
      setRoutes(persisted)
    }, tt(language, 'arduinos.toast.outputSaved'))
  }

  async function deleteRoute(routeId: string): Promise<void> {
    await run(async () => {
      const next = routes.filter((r) => r.id !== routeId)
      const persisted = await window.ipc.invoke<OutputRoute[]>(OUTPUTS_CHANNELS.setRoutes, next)
      setRoutes(persisted)
    }, tt(language, 'arduinos.toast.outputRemoved'))
  }

  async function toggleRoute(routeId: string, enabled: boolean): Promise<void> {
    const target = routes.find((r) => r.id === routeId)
    if (!target) return
    await saveRoute({ ...target, enabled, updatedAt: new Date().toISOString() })
  }

  useEffect(() => {
    if (tab === 'myHardware' && ports.length === 0) void searchPorts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const tabInfoBase = TABS.find((entry) => entry.id === tab) ?? TABS[0]
  const tabInfo = {
    ...tabInfoBase,
    label: tt(language, `arduinos.tabs.${tabInfoBase.id}.label`),
    eyebrow: tt(language, `arduinos.tabs.${tabInfoBase.id}.eyebrow`),
    description: tt(language, `arduinos.tabs.${tabInfoBase.id}.description`),
    emptyText: tt(language, `arduinos.tabs.${tabInfoBase.id}.emptyText`)
  }
  const tabGroups = TAB_GROUPS.map((group, index) => ({
    ...group,
    title: tt(language, `arduinos.groups.${index}.title`),
    description: tt(language, `arduinos.groups.${index}.description`)
  }))
  const focusTypes = TAB_COMPONENTS[tab]
  function openComponentTab(type: ComponentType): void {
    if (type === 'rgbMatrix') setTab('rgbMatrix')
    else if (type === 'rgbStrip') setTab('rgbLeds')
    else if (type === 'screen') setTab('screens')
    else if (type === 'segDisplay') setTab('tm1638')
    else if (type === 'gauge') setTab('gauges')
    else if (type === 'control') setTab('controls')
    else if (type === 'customSerial') setTab('customSerial')
    else setTab('displayAlerts')
  }

  return (
    <section className="view-grid">
      <article className="panel-card">
        <span className="panel-label">{tt(language, 'arduinos.mode.label')}</span>
        <h3>{tt(language, 'arduinos.mode.title')}</h3>
        <p className="helper-text">
          {tt(language, 'arduinos.mode.description')}
        </p>
        <div className="segmented" style={{ flexWrap: 'wrap' }}>
          {([
            ['disabled', tt(language, 'arduinos.mode.disabled')],
            ['single', tt(language, 'arduinos.mode.single')],
            ['multiple', tt(language, 'arduinos.mode.multiple')]
          ] as Array<[ArduinoMode, string]>).map(([value, labelText]) => (
            <button
              key={value}
              type="button"
              className={mode === value ? 'chip-toggle active' : 'chip-toggle'}
              disabled={busy}
              onClick={() => changeMode(value)}
            >
              {labelText}
            </button>
          ))}
        </div>
      </article>

      <nav className="tab-bar" role="tablist" aria-label={tt(language, 'arduinos.nav.aria')} style={{ alignItems: 'stretch', gap: 12 }}>
        {tabGroups.map((group) => (
          <div
            key={group.title}
            style={{
              display: 'grid',
              gap: 8,
              minWidth: group.ids.length === 1 ? 170 : 260,
              flex: group.ids.length === 1 ? '0 0 auto' : '1 1 260px'
            }}
          >
            <div>
              <small style={{ color: 'var(--muted)', fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                {group.title}
              </small>
              <p className="helper-text" style={{ margin: '2px 0 0', fontSize: 11.5 }}>
                {group.description}
              </p>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {group.ids.map((id) => {
                const entryBase = TABS.find((item) => item.id === id) ?? TABS[0]
                const entry = {
                  ...entryBase,
                  label: tt(language, `arduinos.tabs.${entryBase.id}.label`),
                  eyebrow: tt(language, `arduinos.tabs.${entryBase.id}.eyebrow`)
                }
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === entry.id}
                    className={tab === entry.id ? 'tab-button active' : 'tab-button'}
                    onClick={() => setTab(entry.id)}
                  >
                    <small>{entry.eyebrow}</small>
                    <span>{entry.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
        <span className={connected ? 'conn-pill online' : 'conn-pill offline'}>
          {connected ? `● ${connectedDevice?.path}` : '○ Disconnected'}
        </span>
      </nav>

      {tab === 'myHardware' && (
        <>
          {/* ── {tt(language, 'arduinos.hardwareHub.title')} sub-navigation ────────────────────────────────────── */}
          <article className="panel-card" style={{ padding: '10px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)' }}>
                {tt(language, 'arduinos.hardwareHub.title')}
              </span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(
                  [
                    ['devices', tt(language, 'arduinos.hardwareHub.devices'), tt(language, 'arduinos.hardwareHub.devicesHint')],
                    ['monitor', tt(language, 'arduinos.hardwareHub.monitor'), tt(language, 'arduinos.hardwareHub.monitorHint')],
                    ['info', tt(language, 'arduinos.hardwareHub.info'), tt(language, 'arduinos.hardwareHub.infoHint')]
                  ] as [HwSection, string, string][]
                ).map(([id, lbl, hint]) => (
                  <button
                    key={id}
                    type="button"
                    className={hwSection === id ? 'chip-toggle active' : 'chip-toggle'}
                    onClick={() => setHwSection(id)}
                    title={hint}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <SectionExportImport sectionId="serial-devices" label={tt(language, 'arduinos.hardwareHub.serialDevices')} onImported={() => void reloadFleet()} />
            </div>
          </article>

          {/* ── Devices & Profiles ─────────────────────────────────────────── */}
          {hwSection === 'devices' && (
            <HardwareWorkspace
              showToast={showToast}
              mode={mode}
              layout="guided"
              title={tabInfo.label}
              eyebrow={tabInfo.eyebrow}
              description={tabInfo.description}
              emptyText={tabInfo.emptyText}
              onOpenRgbMatrix={() => setTab('rgbMatrix')}
              onOpenComponentType={openComponentTab}
              language={language}
            />
          )}

          {/* ── Serial Console ────────────────────────────────────────────────── */}
          {hwSection === 'monitor' && (
            <MonitorPanel
              language={language}
              entries={visibleLog}
              connected={Boolean(activeDevice?.connected)}
              busy={busy || mode === 'disabled'}
              paused={paused}
              autoScroll={autoScroll}
              hideEngine={hideEngine}
              showHideEngine={activeIsPrimary}
              command={command}
              logRef={logRef}
              activeDevice={activeDevice}
              devices={devices}
              setActiveDeviceId={setActiveDeviceId}
              setPaused={setPaused}
              setAutoScroll={setAutoScroll}
              setHideEngine={setHideEngine}
              setCommand={setCommand}
              onSend={() => {
                sendCommand(command)
                setCommand('')
              }}
              onQuick={sendCommand}
              onClear={clearMonitor}
            />
          )}

          {/* ── Connections & Firmware ───────────────────────────────────────────── */}
          {hwSection === 'info' && (
            <>
              <DevicesPanel
                language={language}
                ports={ports}
                selectedPath={selectedPath}
                setSelectedPath={setSelectedPath}
                busy={busy || mode === 'disabled'}
                connected={connected}
                connectedPath={connectedDevice?.path}
                devices={devices}
                deviceConfigs={deviceConfigs}
                activeDeviceId={activeDeviceId}
                canAddDevices={mode === 'multiple'}
                onSearch={() => void searchPorts()}
                onConnect={() => void connect()}
                onDisconnect={() => void disconnect()}
                onAddDevice={(input) => void addGenericDevice(input)}
                onRemoveDevice={(id) => void removeGenericDevice(id)}
                onReconnectDevice={(id) => void reconnectGenericDevice(id)}
                onDisconnectDevice={(id) => void disconnectGenericDevice(id)}
                onSelectActive={(id) => setActiveDeviceId(id)}
              />
              <HardwarePanel profile={profile} language={language} />
              <FirmwarePanel firmware={firmware} language={language} />
            </>
          )}
        </>
      )}

      {tab === 'rgbMatrix' && (
        <>
          <article className="panel-card" style={{ padding: '10px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <p style={{ margin: 0, fontSize: 12.5, color: 'rgba(255,255,255,0.65)' }}>
                <strong style={{ color: 'var(--accent-primary)' }}>{tt(language, 'arduinos.rgbMatrix.title')}</strong>
                {' '}{tt(language, 'arduinos.rgbMatrix.description')} {' '}
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: 'inherit', padding: 0, textDecoration: 'underline' }}
                  onClick={() => setTab('myHardware')}
                >
                  Hardware
                </button>
                {' '}→ Componentes.
              </p>
            </div>
          </article>
          <RgbMatrixWorkspace showToast={showToast} mode={mode} />
        </>
      )}

      {tab === 'esp32' && (
        <Esp32WifiView
          connectedDevice={connectedDevice}
          mapping={mapping}
          config={config}
          setConnectedDevice={setConnectedDevice}
          refreshDeviceState={refreshDeviceState}
          showToast={showToast}
        />
      )}


      {tab === 'customSerial' && (
        <>
          <HardwareWorkspace
            showToast={showToast}
            mode={mode}
            focusTypes={focusTypes}
            layout="guided"
            title={tabInfo.label}
            eyebrow={tabInfo.eyebrow}
            description={tabInfo.description}
            emptyText={tabInfo.emptyText}
            onOpenComponentType={openComponentTab}
            language={language}
          />
          <CustomSerialEditor
            language={language}
            routes={routes}
            devices={devices}
            expressions={expressions}
            busy={busy || mode === 'disabled'}
            onSave={(route) => void saveRoute(route)}
            onDelete={(routeId) => void deleteRoute(routeId)}
            onToggle={(routeId, enabled) => void toggleRoute(routeId, enabled)}
          />
        </>
      )}

      {tab !== 'myHardware' && tab !== 'esp32' && tab !== 'rgbMatrix' && tab !== 'customSerial' && (
        <>
          <HardwareWorkspace
            showToast={showToast}
            mode={mode}
            focusTypes={focusTypes}
            layout="guided"
            title={tabInfo.label}
            eyebrow={tabInfo.eyebrow}
            description={tabInfo.description}
            emptyText={tabInfo.emptyText}
            onOpenComponentType={openComponentTab}
            language={language}
          />
          {tab === 'displayAlerts' && (
            <>
              <article className="panel-card" style={{ padding: '10px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)' }}>
                    {tt(language, 'arduinos.outputRouting.title')}
                  </span>
                  <SectionExportImport sectionId="output-routes" label={tt(language, 'arduinos.outputRouting.title')} onImported={() => void reloadRoutes()} />
                </div>
              </article>
              <OutputsPanel
                  language={language}
                routes={routes}
                devices={devices}
                expressions={expressions}
                busy={busy || mode === 'disabled'}
                onSave={(route) => void saveRoute(route)}
                onDelete={(routeId) => void deleteRoute(routeId)}
                onToggle={(routeId, enabled) => void toggleRoute(routeId, enabled)}
              />
            </>
          )}
          {tab === 'controls' && (
            <>
              <InputsPanel devices={devices} inputs={inputs} language={language} />
              <ConfigPanel
                  language={language}
                runtime={runtime}
                connected={connected}
                busy={busy || mode === 'disabled'}
                onThreshold={setThreshold}
                onToggleMux={() => void run(() => window.ipc.invoke('arduino:toggleMuxDebug') as Promise<void>)}
                onToggleFlip={() => void run(() => window.ipc.invoke('arduino:toggleFlipInvert') as Promise<void>)}
                onRecalibrate={() =>
                  void run(
                    () => window.ipc.invoke('arduino:flipRecalibrate') as Promise<void>,
                    'Flip cover recalibration sent (FC).'
                  )
                }
              />
            </>
          )}
        </>
      )}
    </section>
  )
}

// ─── Devices ──────────────────────────────────────────────────────────────
interface DevicesPanelProps {
  language?: AppViewProps['language']
  ports: PortInfo[]
  selectedPath: string
  setSelectedPath(path: string): void
  busy: boolean
  connected: boolean
  connectedPath?: string
  devices: SerialDeviceSummary[]
  deviceConfigs: GenericSerialDeviceConfig[]
  activeDeviceId: string | null
  // False in 'single'/'disabled' modes: the "add another device" form is hidden.
  canAddDevices: boolean
  onSearch(): void
  onConnect(): void
  onDisconnect(): void
  onAddDevice(input: { path: string; label: string; baud: number }): void
  onRemoveDevice(id: string): void
  onReconnectDevice(id: string): void
  onDisconnectDevice(id: string): void
  onSelectActive(id: string): void
}

function DevicesPanel(props: DevicesPanelProps): ReactElement {
  const {
    ports,
    selectedPath,
    setSelectedPath,
    busy,
    connected,
    devices,
    deviceConfigs,
    activeDeviceId,
    canAddDevices,
    onSearch,
    onConnect,
    onDisconnect,
    onAddDevice,
    onRemoveDevice,
    onReconnectDevice,
    onDisconnectDevice,
    onSelectActive,
    language
  } = props

  const [addPath, setAddPath] = useState('')
  const [addLabel, setAddLabel] = useState('')
  const [addBaud, setAddBaud] = useState(GENERIC_DEVICE_DEFAULT_BAUD)
  const addPort = useMemo(
    () => ports.find((port) => port.path === addPath),
    [addPath, ports]
  )
  const addPortHasStableIdentity = Boolean(
    addPort?.vendorId &&
    addPort.productId &&
    addPort.serialNumber
  )

  // Persisted devices not currently open on the hub (so the user can
  // reconnect them manually).
  const offlinePersisted = useMemo(
    () => deviceConfigs.filter((config) => !devices.some((device) => device.path === config.path)),
    [deviceConfigs, devices]
  )

  return (
    <>
      <article className="panel-card">
        <div className="panel-heading-row">
          <div>
            <span className="panel-label">Primary SIM-X · 115200 8N1</span>
            <h3>{tt(language, 'arduinos.devices.primaryTitle')}</h3>
          </div>
          <button className="ghost-action compact" disabled={busy} onClick={onSearch} type="button">
            {tt(language, 'arduinos.devices.scan')}
          </button>
        </div>
        <p className="helper-text">
          The serial port is exclusive: close SimHub before connecting through the app. The Pro Micro enumerates as “Arduino
          Leonardo”; the SIM-X tag is only a suggestion — choose the correct COM port if none is preselected.
        </p>
        <div className="port-list">
          {ports.length === 0 && <p className="empty-state">Click “Scan” to list serial ports.</p>}
          {ports.map((port) => (
            <label className={`port-item ${selectedPath === port.path ? 'is-selected' : ''}`} key={port.path}>
              <input
                checked={selectedPath === port.path}
                name="arduino-port"
                onChange={() => setSelectedPath(port.path)}
                type="radio"
              />
              <span>
                <strong>
                  {port.path}
                  {port.isSimX && (
                    <em className="muted-pill" style={{ marginLeft: 8 }}>
                      SIM-X
                    </em>
                  )}
                </strong>
                <small>{port.friendlyName || port.manufacturer || tt(language, 'arduinos.devices.unknownManufacturer')}</small>
                {(port.vendorId || port.productId) && (
                  <small>
                    VID:{port.vendorId || '?'} · PID:{port.productId || '?'}
                    {port.serialNumber ? ` · Serial:${port.serialNumber}` : ''}
                  </small>
                )}
              </span>
            </label>
          ))}
        </div>
        <div className="action-row">
          <button
            className="primary-action"
            disabled={busy || !selectedPath || connected}
            onClick={onConnect}
            type="button"
          >
            {tt(language, 'arduinos.devices.connectSimX')}
          </button>
          <button className="ghost-action" disabled={busy || !connected} onClick={onDisconnect} type="button">
            {tt(language, 'arduinos.common.disconnect')}
          </button>
        </div>
      </article>

      <article className="panel-card">
        <div className="panel-heading-row">
          <div>
            <span className="panel-label">{tt(language, 'arduinos.devices.fleetLabel')}</span>
            <h3>{tt(language, 'arduinos.devices.activeTitle')}</h3>
          </div>
        </div>
        <p className="helper-text">
          {tt(language, 'arduinos.devices.fleetHelpBefore')} <strong>{tt(language, 'arduinos.devices.customSerial')}</strong> {tt(language, 'arduinos.devices.fleetHelpMiddle')}{' '}
          <strong>{tt(language, 'arduinos.devices.inputs')}</strong> {tt(language, 'arduinos.devices.fleetHelpAfter')}
        </p>
        <div className="port-list">
          {devices.length === 0 && (
            <p className="empty-state">{tt(language, 'arduinos.devices.noDeviceOpen')}</p>
          )}
          {devices.map((device) => {
            const isActive = device.id === activeDeviceId
            return (
              <div
                key={device.id}
                className={`port-item ${isActive ? 'is-selected' : ''}`}
                style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 8 }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <input
                    type="radio"
                    name="active-device"
                    checked={isActive}
                    onChange={() => onSelectActive(device.id)}
                  />
                  <span>
                    <strong>
                      {device.label}
                      <em className="muted-pill" style={{ marginLeft: 8 }}>
                        {device.kind === 'sim-x' ? 'SIM-X' : 'GENERIC'}
                      </em>
                      <em
                        className="muted-pill"
                        style={{
                          marginLeft: 6,
                          color: device.connected ? 'var(--accent)' : 'var(--muted)'
                        }}
                      >
                        {device.connected ? '● online' : '○ offline'}
                      </em>
                    </strong>
                    <small>
                      {device.path} · {device.baud} 8N1 · id <code>{device.id}</code>
                    </small>
                  </span>
                </label>
                <div className="action-row compact-row" style={{ marginTop: 0 }}>
                  {device.kind !== 'sim-x' && (
                    <>
                      {device.connected ? (
                        <button
                          className="ghost-action compact"
                          disabled={busy}
                          onClick={() => onDisconnectDevice(device.id)}
                          type="button"
                        >
                          {tt(language, 'arduinos.common.disconnect')}
                        </button>
                      ) : (
                        <button
                          className="ghost-action compact"
                          disabled={busy}
                          onClick={() => onReconnectDevice(device.id)}
                          type="button"
                        >
                          {tt(language, 'arduinos.common.reconnect')}
                        </button>
                      )}
                      <button
                        className="ghost-action compact danger"
                        disabled={busy}
                        onClick={() => onRemoveDevice(device.id)}
                        type="button"
                      >
                        {tt(language, 'arduinos.common.remove')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {offlinePersisted.length > 0 && (
          <>
            <div className="config-block">
              <strong>{tt(language, 'arduinos.devices.persisted')}</strong>
              <ul className="plain-list">
                {offlinePersisted.map((config) => (
                  <li key={`${config.path}-${config.id ?? ''}`}>
                    <code>{config.path}</code> · {config.label} · {config.baud} baud
                    <small style={{ display: 'block', color: config.vendorId && config.productId && config.serialNumber ? 'var(--accent)' : 'var(--warning)' }}>
                      {config.vendorId && config.productId && config.serialNumber
                        ? `Preflight identity bound: VID ${config.vendorId}, PID ${config.productId}, serial ${config.serialNumber}.`
                        : 'Preflight identity incomplete: reconnect or re-add this device. COM path or hub ID alone cannot certify hardware.'}
                    </small>
                    {config.id && (
                      <button
                        className="ghost-action compact"
                        disabled={busy}
                        style={{ marginLeft: 8 }}
                        onClick={() => onReconnectDevice(config.id!)}
                        type="button"
                      >
                        {tt(language, 'arduinos.common.reconnect')}
                      </button>
                    )}
                    {config.id && (
                      <button
                        className="ghost-action compact danger"
                        disabled={busy}
                        style={{ marginLeft: 6 }}
                        onClick={() => onRemoveDevice(config.id!)}
                        type="button"
                      >
                        {tt(language, 'arduinos.common.forget')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}

        {canAddDevices && (
        <div className="config-block">
          <strong>{tt(language, 'arduinos.devices.addGeneric')}</strong>
          <small>Use the companion protocol (T/N/R/B/M/L/C → device; B/E/A → app).</small>
          {addPath && (
            <small style={{ display: 'block', marginTop: 6, color: addPortHasStableIdentity ? 'var(--accent)' : 'var(--warning)' }}>
              {addPortHasStableIdentity
                ? `Preflight will bind VID ${addPort!.vendorId}, PID ${addPort!.productId}, and serial ${addPort!.serialNumber}.`
                : 'This port does not expose complete VID/PID/serial identity. It will remain unverified in Rig Preflight unless an existing governed, time-bounded waiver is approved.'}
            </small>
          )}
          <form
            className="command-row"
            style={{ flexWrap: 'wrap', gap: 8, position: 'relative', zIndex: 1 }}
            onSubmit={(event) => {
              event.preventDefault()
              if (!addPath.trim()) return
              onAddDevice({
                path: addPath.trim(),
                label: addLabel.trim() || addPath.trim(),
                baud: addBaud
              })
              setAddPath('')
              setAddLabel('')
              setAddBaud(GENERIC_DEVICE_DEFAULT_BAUD)
            }}
          >
            <select
              className="command-input"
              value={addPath}
              disabled={busy}
              onChange={(event) => {
                const value = event.target.value
                setAddPath(value)
                const match = ports.find((port) => port.path === value)
                if (match && !addLabel) {
                  setAddLabel(match.friendlyName ?? match.manufacturer ?? value)
                }
              }}
              style={{ minWidth: 200, position: 'relative', zIndex: 1 }}
            >
              <option value="">Select a port…</option>
              {ports.map((port) => (
                <option key={port.path} value={port.path}>
                  {port.path} {port.friendlyName ? `· ${port.friendlyName}` : ''}
                </option>
              ))}
            </select>
            <input
              className="command-input"
              type="text"
              placeholder={tt(language, 'arduinos.devices.labelPlaceholder')}
              value={addLabel}
              onChange={(event) => setAddLabel(event.target.value)}
              style={{ minWidth: 180 }}
            />
            <input
              className="command-input"
              type="number"
              placeholder={tt(language, 'arduinos.devices.baudPlaceholder')}
              min={300}
              max={2000000}
              value={addBaud}
              onChange={(event) => setAddBaud(Number(event.target.value) || GENERIC_DEVICE_DEFAULT_BAUD)}
              style={{ width: 120 }}
            />
            <button className="primary-action" type="submit" disabled={busy || !addPath.trim()}>
              Add
            </button>
          </form>
        </div>
        )}
      </article>
    </>
  )
}

// ─── Serial Console ─────────────────────────────────────────────────────────────
interface MonitorPanelProps {
  language?: AppViewProps['language']
  entries: SerialLogEntry[]
  connected: boolean
  busy: boolean
  paused: boolean
  autoScroll: boolean
  hideEngine: boolean
  showHideEngine: boolean
  command: string
  logRef: React.MutableRefObject<HTMLDivElement | null>
  activeDevice: SerialDeviceSummary | null
  devices: SerialDeviceSummary[]
  setActiveDeviceId(id: string): void
  setPaused(value: boolean): void
  setAutoScroll(value: boolean): void
  setHideEngine(value: boolean): void
  setCommand(value: string): void
  onSend(): void
  onQuick(command: string): void
  onClear(): void
}

function MonitorPanel(props: MonitorPanelProps): ReactElement {
  const {
    entries,
    connected,
    busy,
    paused,
    autoScroll,
    hideEngine,
    showHideEngine,
    command,
    logRef,
    activeDevice,
    devices,
    setActiveDeviceId,
    setPaused,
    setAutoScroll,
    setHideEngine,
    setCommand,
    onSend,
    onQuick,
    onClear,
    language
  } = props
  const isPrimary = activeDevice?.kind === 'sim-x'
  return (
    <article className="panel-card">
      <div className="panel-heading-row">
        <div>
          <span className="panel-label">Serial traffic · RX/TX</span>
          {devices.length === 0 && <option value="">— no connected devices —</option>}
        </div>
        <div className="action-row compact-row" style={{ position: 'relative', zIndex: 1 }}>
          <select
            className="command-input"
            value={activeDevice?.id ?? ''}
            onChange={(event) => setActiveDeviceId(event.target.value)}
            style={{ minWidth: 180, position: 'relative', zIndex: 1 }}
          >
            {devices.length === 0 && <option value="">— no connected devices —</option>}
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.label} ({device.kind})
              </option>
            ))}
          </select>
          <button
            className={paused ? 'chip-toggle active' : 'chip-toggle'}
            onClick={() => setPaused(!paused)}
            type="button"
          >
            {paused ? tt(language, 'arduinos.monitor.resume') : tt(language, 'arduinos.monitor.pause')}
          </button>
          <button className="ghost-action compact" onClick={onClear} type="button">
            {tt(language, 'arduinos.monitor.clear')}
          </button>
        </div>
      </div>

      <div className="monitor-filters">
        <label className="inline-check">
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} /> {tt(language, 'arduinos.monitor.autoScroll')}
        </label>
        {showHideEngine && (
          <label className="inline-check">
            <input type="checkbox" checked={hideEngine} onChange={(e) => setHideEngine(e.target.checked)} /> {tt(language, 'arduinos.monitor.hideEngine')}
          </label>
        )}
      </div>

      <div className="serial-log" ref={logRef}>
        {entries.length === 0 && (
          <p className="empty-state">
            {connected
              ? tt(language, 'arduinos.monitor.noTraffic')
              : tt(language, 'arduinos.monitor.connectTraffic')}
          </p>
        )}
        {entries.map((entry) => (
          <div className={`serial-line ${entry.dir}`} key={entry.seq}>
            <span className="serial-ts">{new Date(entry.ts).toLocaleTimeString()}</span>
            <span className={`serial-dir ${entry.dir}`}>{entry.dir === 'rx' ? '◀ RX' : '▶ TX'}</span>
            <span className="serial-text">{entry.text}</span>
          </div>
        ))}
      </div>

      {isPrimary && (
        <div className="quick-bar">
          {QUICK_SERIAL_COMMANDS.map((quick) => (
            <button
              key={quick.command}
              className="chip-toggle"
              disabled={!connected || busy}
              title={quick.hint}
              onClick={() => onQuick(quick.command)}
              type="button"
            >
              {quick.label}
            </button>
          ))}
        </div>
      )}

      <form
        className="command-row"
        onSubmit={(event) => {
          event.preventDefault()
          onSend()
        }}
      >
        <input
          className="command-input"
          type="text"
          placeholder={
            connected
              ? isPrimary
                ? tt(language, 'arduinos.monitor.primaryPlaceholder')
                : tt(language, 'arduinos.monitor.genericPlaceholder')
              : tt(language, 'arduinos.monitor.connectPlaceholder')
          }
          value={command}
          disabled={!connected || busy}
          onChange={(event) => setCommand(event.target.value)}
        />
        <button className="primary-action" type="submit" disabled={!connected || busy || !command.trim()}>
          {tt(language, 'arduinos.monitor.send')}
        </button>
      </form>
      <p className="helper-text">
        {isPrimary ? (
          <>
            {tt(language, 'arduinos.monitor.primaryHelpBefore')} (
            <code>E&lt;idx&gt;:?1</code>) {tt(language, 'arduinos.monitor.primaryHelpAfter')}
          </>
        ) : (
          <>
            {tt(language, 'arduinos.monitor.genericHelpBefore')} <code>T/N/R/B/M/L/C</code>. {tt(language, 'arduinos.monitor.genericHelpRx')}: {' '}
            <code>B&lt;idx&gt;:&lt;0|1&gt;</code>, <code>E&lt;idx&gt;:±1</code>, <code>A&lt;idx&gt;:&lt;0-1023&gt;</code>.
          </>
        )}
      </p>
    </article>
  )
}

// ─── Configuração (runtime) ──────────────────────────────────────────────────────
interface ConfigPanelProps {
  language?: AppViewProps['language']
  runtime: ArduinoRuntimeState | null
  connected: boolean
  busy: boolean
  onThreshold(value: EncoderDetentThreshold): void
  onToggleMux(): void
  onToggleFlip(): void
  onRecalibrate(): void
}

function triState(value: boolean | null, language?: AppViewProps['language']): string {
  if (value === null) return tt(language, 'arduinos.common.unknownState')
  return value ? tt(language, 'arduinos.common.on') : tt(language, 'arduinos.common.off')
}

function ConfigPanel(props: ConfigPanelProps): ReactElement {
  const { language, runtime, connected, busy, onThreshold, onToggleMux, onToggleFlip, onRecalibrate } = props
  return (
    <article className="panel-card">
      <span className="panel-label">{tt(language, 'arduinos.config.label')}</span>
      <h3>{tt(language, 'arduinos.config.title')}</h3>
      {!connected && (
        <div className="notice-card warning">
          <strong>{tt(language, 'arduinos.common.disconnected')}</strong>
          <p>{tt(language, 'arduinos.config.disconnectedHelp')}</p>
        </div>
      )}

      <div className="config-block">
        <div className="config-head">
          <strong>{tt(language, 'arduinos.config.encoderDetent')}</strong>
          <small>KY-040 (20 PPR) = 2 · EC11 (24 detentes) = 4. Se duplicar passos, suba o valor.</small>
        </div>
        <div className="segmented">
          {ENCODER_DETENT_THRESHOLDS.map((value) => (
            <button
              key={value}
              type="button"
              className={runtime?.encoderDetentThreshold === value ? 'segment active' : 'segment'}
              disabled={!connected || busy}
              onClick={() => onThreshold(value)}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="config-block">
        <div className="config-head">
          <strong>{tt(language, 'arduinos.config.flipCover')}</strong>
          <small>{tt(language, 'arduinos.config.flipState', { state: triState(runtime?.flipCoverInverted ?? null, language) })}</small>
        </div>
        <div className="action-row">
          <button className="ghost-action" disabled={!connected || busy} onClick={onToggleFlip} type="button">
            {tt(language, 'arduinos.config.invert')}
          </button>
          <button className="ghost-action" disabled={!connected || busy} onClick={onRecalibrate} type="button">
            {tt(language, 'arduinos.config.recalibrate')}
          </button>
        </div>
      </div>

      <div className="config-block">
        <div className="config-head">
          <strong>{tt(language, 'arduinos.config.muxDebug')}</strong>
          <small>
            {tt(language, 'arduinos.config.muxHelp', { state: triState(runtime?.muxDebug ?? null, language) })}
          </small>
        </div>
        <button
          className={runtime?.muxDebug ? 'chip-toggle active' : 'chip-toggle'}
          disabled={!connected || busy}
          onClick={onToggleMux}
          type="button"
        >
          {tt(language, 'arduinos.config.toggleMux')}
        </button>
      </div>
    </article>
  )
}

// ─── Custom Serial Outputs ──────────────────────────────────────────────────────
interface OutputsPanelProps {
  language?: AppViewProps['language']
  routes: OutputRoute[]
  devices: SerialDeviceSummary[]
  expressions: ExpressionDef[]
  busy: boolean
  onSave(route: OutputRoute): void
  onDelete(routeId: string): void
  onToggle(routeId: string, enabled: boolean): void
}

interface ComposerState {
  presetId: string
  deviceId: string
  sourceKind: OutputSource['kind']
  telemetryField: string
  exprId: string
  literalValue: string
  decimals: string
  scale: string
  prefix: string
  suffix: string
  name: string
}

function defaultComposerState(devices: SerialDeviceSummary[], expressions: ExpressionDef[]): ComposerState {
  return {
    presetId: COMPANION_PRESETS[0]?.id ?? '',
    deviceId: devices[0]?.id ?? '',
    sourceKind: 'telemetry',
    telemetryField: 'speedKmh',
    exprId: expressions[0]?.id ?? '',
    literalValue: '',
    decimals: '0',
    scale: '',
    prefix: '',
    suffix: '',
    name: ''
  }
}

function buildSource(state: ComposerState): OutputSource | null {
  switch (state.sourceKind) {
    case 'telemetry':
      if (!state.telemetryField.trim()) return null
      return { kind: 'telemetry', field: state.telemetryField.trim() }
    case 'expression':
      if (!state.exprId.trim()) return null
      return { kind: 'expression', exprId: state.exprId.trim() }
    case 'literal': {
      const raw = state.literalValue.trim()
      if (!raw) return null
      const asNumber = Number(raw)
      if (raw !== '' && Number.isFinite(asNumber) && /^-?\d+(\.\d+)?$/.test(raw)) {
        return { kind: 'literal', value: asNumber }
      }
      return { kind: 'literal', value: raw }
    }
    default:
      return null
  }
}

function buildFormat(state: ComposerState, preset: CompanionPreset | null): OutputFormat | undefined {
  const fmt: OutputFormat = {}
  const decimals = Number(state.decimals)
  if (Number.isFinite(decimals) && state.decimals.trim() !== '') fmt.decimals = decimals
  else if (preset?.defaultFormat?.decimals !== undefined) fmt.decimals = preset.defaultFormat.decimals

  const scale = Number(state.scale)
  if (Number.isFinite(scale) && state.scale.trim() !== '') fmt.scale = scale
  else if (preset?.defaultFormat?.scale !== undefined) fmt.scale = preset.defaultFormat.scale

  if (state.prefix.trim()) fmt.prefix = state.prefix
  else if (preset?.defaultFormat?.prefix) fmt.prefix = preset.defaultFormat.prefix

  if (state.suffix.trim()) fmt.suffix = state.suffix
  else if (preset?.defaultFormat?.suffix) fmt.suffix = preset.defaultFormat.suffix

  if (Object.keys(fmt).length === 0) return undefined
  return fmt
}

function isOurRoute(route: OutputRoute): boolean {
  return route.id.startsWith(CUSTOM_ROUTE_PREFIX) && route.target.kind === 'serial'
}

function nextCustomRouteId(routes: OutputRoute[]): string {
  let n = routes.filter(isOurRoute).length + 1
  while (routes.some((route) => route.id === `${CUSTOM_ROUTE_PREFIX}${n}`)) n += 1
  return `${CUSTOM_ROUTE_PREFIX}${n}`
}

function sourceSummary(source: OutputSource, language?: AppViewProps['language']): string {
  switch (source.kind) {
    case 'telemetry':
      return `telemetria · ${source.field}`
    case 'expression':
      return `expression · ${source.exprId}`
    case 'literal':
      return `literal · ${source.value}`
    default:
      return '?'
  }
}

function OutputsPanel(props: OutputsPanelProps): ReactElement {
  const { language, routes, devices, expressions, busy, onSave, onDelete, onToggle } = props
  const [state, setState] = useState<ComposerState>(() => defaultComposerState(devices, expressions))
  const customRoutes = useMemo(() => routes.filter(isOurRoute), [routes])

  useEffect(() => {
    setState((current) => {
      const next = { ...current }
      if (!devices.some((device) => device.id === current.deviceId)) {
        next.deviceId = devices[0]?.id ?? ''
      }
      if (!expressions.some((expr) => expr.id === current.exprId)) {
        next.exprId = expressions[0]?.id ?? ''
      }
      return next
    })
  }, [devices, expressions])

  const activePreset = COMPANION_PRESETS.find((preset) => preset.id === state.presetId) ?? null

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const preset = activePreset
    if (!preset) return
    const source = buildSource(state)
    if (!source) return
    if (!state.deviceId) return
    const id = nextCustomRouteId(routes)
    const name =
      state.name.trim() ||
      `${preset.label} → ${devices.find((d) => d.id === state.deviceId)?.label ?? state.deviceId}`
    const route: OutputRoute = {
      id,
      name,
      enabled: true,
      source,
      target: {
        kind: 'serial',
        deviceId: state.deviceId,
        template: preset.template
      },
      format: buildFormat(state, preset),
      updatedAt: new Date().toISOString()
    }
    onSave(route)
    setState((current) => ({ ...current, name: '' }))
  }

  return (
    <>
      <article className="panel-card">
        <span className="panel-label">Custom Serial Device · presets + roteamento</span>
        <h3>{tt(language, 'arduinos.outputs.newOutput')}</h3>
        <p className="helper-text">
          {tt(language, 'arduinos.outputs.helpBefore')} <code>OutputRoute</code>: {tt(language, 'arduinos.outputs.helpAfter')}
          {tt(language, 'arduinos.outputs.helpTemplate')} <code>${'${value}'}</code> {tt(language, 'arduinos.outputs.helpFrequency')}
        </p>

        <form onSubmit={handleSubmit} className="config-block" style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gap: 8 }}>
            <label>
              <strong>{tt(language, 'arduinos.outputs.preset')}</strong>
              <select
                className="command-input"
                value={state.presetId}
                onChange={(event) => setState({ ...state, presetId: event.target.value })}
              >
                {COMPANION_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            {activePreset && (
              <small className="helper-text" style={{ marginTop: 0 }}>
                {activePreset.description}
                {activePreset.hint ? ` — ${activePreset.hint}` : ''} <br />
                {tt(language, 'arduinos.outputs.template')}: <code>{activePreset.template}</code>
              </small>
            )}
          </div>

          <label>
            <strong>{tt(language, 'arduinos.outputs.targetDevice')}</strong>
            <select
              className="command-input"
              value={state.deviceId}
              onChange={(event) => setState({ ...state, deviceId: event.target.value })}
            >
              {devices.length === 0 && <option value="">— no connected devices —</option>}
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.label} ({device.id}) {device.connected ? '· ●' : '· ○'}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: 'grid', gap: 8 }}>
            <strong>{tt(language, 'arduinos.outputs.source')}</strong>
            <div className="segmented">
              {(['telemetry', 'expression', 'literal'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={state.sourceKind === kind ? 'segment active' : 'segment'}
                  onClick={() => setState({ ...state, sourceKind: kind })}
                >
                  {kind === 'telemetry' ? tt(language, 'arduinos.outputs.telemetry') : kind === 'expression' ? tt(language, 'arduinos.outputs.expression') : tt(language, 'arduinos.outputs.literal')}
                </button>
              ))}
            </div>
            {state.sourceKind === 'telemetry' && (
              <input
                className="command-input"
                type="text"
                placeholder={tt(language, 'arduinos.outputs.telemetryPlaceholder')}
                value={state.telemetryField}
                onChange={(event) => setState({ ...state, telemetryField: event.target.value })}
              />
            )}
            {state.sourceKind === 'expression' && (
              <select
                className="command-input"
                value={state.exprId}
                onChange={(event) => setState({ ...state, exprId: event.target.value })}
              >
                {expressions.length === 0 && <option value="">— no expression defined —</option>}
                {expressions.map((expr) => (
                  <option key={expr.id} value={expr.id}>
                    {expr.name} ({expr.id})
                  </option>
                ))}
              </select>
            )}
            {state.sourceKind === 'literal' && (
              <input
                className="command-input"
                type="text"
                placeholder={tt(language, 'arduinos.outputs.literalPlaceholder')}
                value={state.literalValue}
                onChange={(event) => setState({ ...state, literalValue: event.target.value })}
              />
            )}
          </div>

          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <label>
              <strong>{tt(language, 'arduinos.outputs.decimals')}</strong>
              <input
                className="command-input"
                type="number"
                placeholder="0"
                value={state.decimals}
                onChange={(event) => setState({ ...state, decimals: event.target.value })}
              />
            </label>
            <label>
              <strong>{tt(language, 'arduinos.outputs.scale')}</strong>
              <input
                className="command-input"
                type="number"
                placeholder="1"
                value={state.scale}
                onChange={(event) => setState({ ...state, scale: event.target.value })}
              />
            </label>
            <label>
              <strong>{tt(language, 'arduinos.outputs.prefix')}</strong>
              <input
                className="command-input"
                type="text"
                value={state.prefix}
                onChange={(event) => setState({ ...state, prefix: event.target.value })}
              />
            </label>
            <label>
              <strong>{tt(language, 'arduinos.outputs.suffix')}</strong>
              <input
                className="command-input"
                type="text"
                value={state.suffix}
                onChange={(event) => setState({ ...state, suffix: event.target.value })}
              />
            </label>
          </div>

          <label>
            <strong>{tt(language, 'arduinos.outputs.nameOptional')}</strong>
            <input
              className="command-input"
              type="text"
              placeholder="Auto: <preset> → <device>"
              value={state.name}
              onChange={(event) => setState({ ...state, name: event.target.value })}
            />
          </label>

          <div className="action-row">
            <button
              type="submit"
              className="primary-action"
              disabled={busy || !state.deviceId || !activePreset || !buildSource(state)}
            >
              {tt(language, 'arduinos.outputs.save')}
            </button>
          </div>
        </form>
      </article>

      <article className="panel-card">
        <span className="panel-label">{tt(language, 'arduinos.outputs.activeLabel')}</span>
        <h3>{tt(language, 'arduinos.outputs.routerTitle')}</h3>
        {customRoutes.length === 0 && (
          <p className="empty-state">{tt(language, 'arduinos.outputs.empty')}</p>
        )}
        <ul className="plain-list">
          {customRoutes.map((route) => {
            const target = route.target as Extract<typeof route.target, { kind: 'serial' }>
            const deviceLabel = devices.find((d) => d.id === target.deviceId)?.label ?? target.deviceId ?? 'primary'
            return (
              <li
                key={route.id}
                className="port-item"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 8
                }}
              >
                <span>
                  <strong>
                    {route.name}
                    <em className="muted-pill" style={{ marginLeft: 8 }}>
                      {deviceLabel}
                    </em>
                    {!route.enabled && (
                      <em className="muted-pill" style={{ marginLeft: 6, color: 'var(--muted)' }}>
                        {tt(language, 'arduinos.common.disabled')}
                      </em>
                    )}
                  </strong>
                  <small>
                    {tt(language, 'arduinos.outputs.source')}: {sourceSummary(route.source, language)} ? {tt(language, 'arduinos.outputs.template')} <code>{target.template}</code>
                  </small>
                </span>
                <div className="action-row compact-row" style={{ marginTop: 0 }}>
                  <button
                    className={route.enabled ? 'chip-toggle active' : 'chip-toggle'}
                    type="button"
                    disabled={busy}
                    onClick={() => onToggle(route.id, !route.enabled)}
                  >
                    {route.enabled ? tt(language, 'arduinos.common.disable') : tt(language, 'arduinos.common.enable')}
                  </button>
                  <button
                    className="ghost-action compact danger"
                    type="button"
                    disabled={busy}
                    onClick={() => onDelete(route.id)}
                  >
                    {tt(language, 'arduinos.common.delete')}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      </article>
    </>
  )
}

// ─── Inputs (companion protocol) ────────────────────────────────────────────────
interface InputsPanelProps {
  language?: AppViewProps['language']
  devices: SerialDeviceSummary[]
  inputs: Record<string, CompanionInputSnapshot>
}

function InputsPanel(props: InputsPanelProps): ReactElement {
  const { language, devices, inputs } = props
  const trackable = devices.filter((device) => device.kind !== 'sim-x')

  return (
    <article className="panel-card">
      <span className="panel-label">Companion protocol · buttons/encoders/analog inputs</span>
      <h3>{tt(language, 'arduinos.inputs.title')}</h3>
      <p className="helper-text">
        {tt(language, 'arduinos.inputs.helpBefore')} <code>B&lt;idx&gt;:&lt;0|1&gt;</code>,{' '}
        <code>E&lt;idx&gt;:?1</code> {tt(language, 'arduinos.inputs.helpAnd')} <code>A&lt;idx&gt;:&lt;0-1023&gt;</code>. {tt(language, 'arduinos.inputs.helpAfter')}
      </p>
      {trackable.length === 0 && (
        <p className="empty-state">{tt(language, 'arduinos.inputs.empty')}</p>
      )}
      {trackable.map((device) => {
        const snapshot = inputs[device.id]
        const buttons = snapshot ? Object.entries(snapshot.buttons) : []
        const encoders = snapshot ? Object.entries(snapshot.encoders) : []
        const analogs = snapshot ? Object.entries(snapshot.analogs) : []
        return (
          <div className="config-block" key={device.id}>
            <div className="config-head">
              <strong>{device.label}</strong>
              <small>
                {device.path} · id <code>{device.id}</code> ·{' '}
                {snapshot?.updatedAt ? tt(language, 'arduinos.inputs.lastInput', { time: new Date(snapshot.updatedAt).toLocaleTimeString() }) : tt(language, 'arduinos.inputs.noActivity')}
              </small>
            </div>
            <div className="hw-grid">
              <div className="hw-card">
                <div className="hw-card-top">
                  <strong>{tt(language, 'arduinos.inputs.buttons')}</strong>
                  <em className="muted-pill">{buttons.length}</em>
                </div>
                {buttons.length === 0 && <small>{tt(language, 'arduinos.inputs.noButtons')}</small>}
                {buttons.map(([index, pressed]) => (
                  <code className="hw-conn" key={`btn-${index}`}>
                    B{index}: {pressed ? '● PRESS' : '○ release'}
                  </code>
                ))}
              </div>
              <div className="hw-card">
                <div className="hw-card-top">
                  <strong>{tt(language, 'arduinos.inputs.encoders')}</strong>
                  <em className="muted-pill">{encoders.length}</em>
                </div>
                {encoders.length === 0 && <small>{tt(language, 'arduinos.inputs.noEncoders')}</small>}
                {encoders.map(([index, delta]) => (
                  <code className="hw-conn" key={`enc-${index}`}>
                    E{index}: {(delta as number) > 0 ? `+${delta}` : delta}
                  </code>
                ))}
              </div>
              <div className="hw-card">
                <div className="hw-card-top">
                  <strong>{tt(language, 'arduinos.inputs.analog')}</strong>
                  <em className="muted-pill">{analogs.length}</em>
                </div>
                {analogs.length === 0 && <small>{tt(language, 'arduinos.inputs.noAxes')}</small>}
                {analogs.map(([index, value]) => (
                  <code className="hw-conn" key={`a-${index}`}>
                    A{index}: {value as number} ({Math.round(((value as number) / 1023) * 100)}%)
                  </code>
                ))}
              </div>
            </div>
          </div>
        )
      })}
    </article>
  )
}

// ─── Hardware ──────────────────────────────────────────────────────────────────
function HardwarePanel({ profile, language }: { profile: ArduinoHardwareProfile | null; language?: AppViewProps['language'] }): ReactElement {
  if (!profile)
    return (
      <article className="panel-card">
        <p className="empty-state">Loading hardware map…</p>
      </article>
    )
  return (
    <article className="panel-card">
      <span className="panel-label">
        {profile.board} · {profile.mcu}
      </span>
      <h3>{tt(language, 'arduinos.hardware.title')}</h3>
      <p className="helper-text">
        {tt(language, 'arduinos.hardware.summary', { usb: profile.usb, buttons: profile.hidButtons, encoders: profile.encoders, pov: profile.povHat ? tt(language, 'arduinos.hardware.povHat') : '' })}
        {tt(language, 'arduinos.hardware.readOnly')}
      </p>
      <div className="hw-grid">
        {profile.components.map((component) => (
          <div className="hw-card" key={component.id}>
            <div className="hw-card-top">
              <strong>{component.name}</strong>
              <em className="muted-pill">{component.kind}</em>
            </div>
            <code className="hw-conn">{component.connection}</code>
            <p>{component.detail}</p>
          </div>
        ))}
      </div>
    </article>
  )
}

// ─── Firmware ──────────────────────────────────────────────────────────────────
function FirmwarePanel({ firmware, language }: { firmware: ArduinoFirmwareInfo | null; language?: AppViewProps['language'] }): ReactElement {
  if (!firmware)
    return (
      <article className="panel-card">
        <p className="empty-state">Loading reference…</p>
      </article>
    )
  return (
    <article className="panel-card">
      <span className="panel-label">Reference · app flashing disabled</span>
      <h3>{firmware.reference}</h3>
      <div className="notice-card warning">
        <strong>{tt(language, 'arduinos.firmware.versionUnavailable')}</strong>
        <p>{firmware.notes[0]}</p>
      </div>

      <div className="config-block">
        <strong>{tt(language, 'arduinos.firmware.requiredLibraries')}</strong>
        <ul className="plain-list">
          {firmware.libraries.map((lib) => (
            <li key={lib}>{lib}</li>
          ))}
        </ul>
      </div>

      <div className="config-block">
        <strong>{tt(language, 'arduinos.firmware.reflash')}</strong>
        <ol className="step-list">
          {firmware.reflashSteps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      </div>

      <div className="config-block">
        <strong>{tt(language, 'arduinos.firmware.notes')}</strong>
        <ul className="plain-list">
          {firmware.notes.slice(1).map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>
    </article>
  )
}
