// Device-layer IPC types. The app talks to the SIM-X Button Box (Pro Micro)
// using the same one-letter SimHub protocol as SimHub's Custom Serial Devices
// (R / B / O / D / S out, E<idx>:±1 in). HID buttons + POV hat are read from
// the renderer with the Web Gamepad API, NOT via serial.
//
// Legacy mapping/config/profile types are kept as inert shims so the few
// renderer screens we do not own (App.tsx, ProfilesView.tsx) still compile;
// the new device protocol never carries them.

export interface PortInfo {
  path: string
  manufacturer?: string
  friendlyName?: string
  serialNumber?: string
  vendorId?: string
  productId?: string
  // True when friendlyName/manufacturer looks like the SIM-X Button Box.
  // The firmware doesn't customise USB descriptors yet, so this can also be
  // false on a perfectly working device — fall back to manual selection.
  isSimX?: boolean
}

export interface DeviceInfo {
  path: string
  name: string
  friendlyName?: string
  manufacturer?: string
  // Optional pieces kept for sidebar widgets that read them.
  firmwareVersion?: string
  protocolVersion?: number
  encoders?: number
  switches?: number
  hidButtons?: number
  connectedAt: string
}

// One delta from a rotary encoder click (4 dedicated encoders on the box,
// firmware emits "E<idx>:+1\n" / "E<idx>:-1\n").
export interface EncoderEvent {
  index: number
  direction: 1 | -1
}

// ─── Legacy types (kept for compile-time compatibility) ──────────────────────
// The SIM-X firmware has no remap / device-side config / device profile concept.
// These shapes are still imported by App.tsx, ProfilesView.tsx and persisted
// JSON files on disk, so we keep the surface here but the device IPC no longer
// uses them.

export const EVENT_ORDER = [
  'e1cw',
  'e1ccw',
  'e2cw',
  'e2ccw',
  'e3cw',
  'e3ccw',
  'e4cw',
  'e4ccw',
  'e5cw',
  'e5ccw',
  'e6cw',
  'e6ccw',
  'sw1',
  'sw2',
  'sw3',
  'sw4',
  'sw5',
  'sw6'
] as const

export type EventId = (typeof EVENT_ORDER)[number]

export interface MappingEntry {
  controlId: EventId
  controlType: 'button' | 'encoder'
  label: string
  hidButton: number
}

export type MappingValues = Record<EventId, number>
export type MappingPatch = Partial<Record<EventId, number>>

export interface Mapping {
  profileName: string
  values: MappingValues
  entries: MappingEntry[]
  updatedAt: string
}

export type EncoderMode = 'pulse' | 'hold'

export interface Config {
  pulse: number
  debounce: number
  encmode: EncoderMode
  updatedAt: string
}

export type ConfigPatch = Partial<Pick<Config, 'pulse' | 'debounce' | 'encmode'>>

export interface ProfilePayload {
  mapping: Mapping
  config: Config
}

export interface ProfileRecord extends ProfilePayload {
  name: string
  savedAt: string
}

export interface ProfileSummary {
  name: string
  savedAt: string
}

// ─── ButtonBoxApi exposed on window.api ──────────────────────────────────────
// New methods speak the SIM-X / SimHub protocol directly. Legacy methods are
// kept (they throw or return stubs) so the unowned screens keep compiling.

export interface ButtonBoxApi {
  // Device protocol (new)
  listPorts(): Promise<PortInfo[]>
  connect(path: string): Promise<DeviceInfo>
  disconnect(): Promise<void>
  sendOled(line1: string, line2: string, line3: string): Promise<void>
  sendBigNum(value: string): Promise<void>
  sendRevLevel(level: number): Promise<void>
  sendShiftBlink(active: boolean): Promise<void>
  sendStartLed(on: boolean): Promise<void>
  // Drives a visible rev-lights sweep + OLED "connected" message on the box so
  // the user can confirm the serial OUTPUT path works without iRacing running.
  runSelfTest(): Promise<void>
  onEncoder(callback: (event: EncoderEvent) => void): () => void
  // Live primary status. Auto-connect happens in the main process before the
  // renderer mounts, so the UI must pull current state to avoid showing a stale
  // "desconectado" while the box is actually connected.
  getStatus(): Promise<DeviceInfo | null>
  // Push every primary connect/disconnect (auto AND manual) so the shared
  // device registry stays in sync without a manual reconnect.
  onConnectionChange(callback: (device: DeviceInfo | null) => void): () => void

  // Legacy (kept inert for App.tsx + ProfilesView.tsx + on-disk profiles)
  ping(): Promise<void>
  getMapping(): Promise<Mapping>
  setMapping(mapping: MappingPatch | Partial<Mapping>): Promise<void>
  getConfig(): Promise<Config>
  setConfig(config: ConfigPatch): Promise<void>
  saveToDevice(): Promise<void>
  loadFromDevice(): Promise<void>
  resetToDefaults(): Promise<void>
  sendOledPreview(line: string): Promise<void>
  listProfiles(): Promise<ProfileSummary[]>
  saveProfile(name: string, data: ProfilePayload): Promise<ProfileRecord>
  loadProfile(name: string): Promise<ProfileRecord>
  deleteProfile(name: string): Promise<void>
  applyProfileToDevice(data: ProfilePayload): Promise<void>
}
