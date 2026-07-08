// Shared types + static descriptors for the Arduino management module
// ("Arduinos" view, SimHub-style). The SIM-X Button Box runs an Arduino Pro
// Micro with the rev38 firmware; the app NEVER reflashes it, so this module is
// about managing the live serial link: device info, a serial monitor, the
// firmware's RUNTIME tunables (no reflash needed), a read-only hardware map
// derived from pinout.h, and a firmware/re-flash reference.
//
// Multi-device extensions (added with the Custom Serial Device feature) live
// at the bottom of this file: persisted generic-device descriptors and
// input-snapshot types consumed by the Arduinos view's Inputs panel. They are
// additive — every pre-existing export is preserved verbatim.

import type { DeviceInfo } from './ipc'

// ─── Multi-device hub (Phase 0 foundation) ───────────────────────────────────
// SerialHub manages a fleet of SerialDevice instances. 'sim-x' is the SIM-X
// Button Box (reserved id 'simx', primary device wrapped by SerialManager).
// 'generic' covers user-defined custom serial devices (alerts/expressions, an
// extra Arduino on a separate port, etc.).
export type SerialDeviceKind = 'sim-x' | 'generic'

export interface SerialDeviceSummary {
  id: string
  path: string
  label: string
  kind: SerialDeviceKind
  baud: number
  connected: boolean
  // Populated when the device is open. Generic devices have a minimal shape
  // (encoders/hidButtons/firmware fields are SIM-X specific and stay null).
  device?: DeviceInfo
}

// ─── Serial monitor ──────────────────────────────────────────────────────────
export type SerialDirection = 'rx' | 'tx'
export type SerialTxOrigin = 'engine' | 'manual'

export interface SerialLogEntry {
  seq: number
  dir: SerialDirection
  text: string
  // For tx entries: 'manual' = sent from the monitor/runtime panel, 'engine' =
  // sent by the rev-lights / OLED engines. Lets the UI mute the high-rate stream.
  origin?: SerialTxOrigin
  ts: number
}

export const SERIAL_LOG_LIMIT = 1000

// ─── Runtime configuration (no reflash) ──────────────────────────────────────
// The rev38 firmware accepts a handful of runtime commands over serial that
// tune behaviour without recompiling, and echoes its new state back:
//   ET<n>\n  set encoder detent threshold (1|2|4|8); echoes "ET=<n>"
//   EM\n     toggle MUX raw debug;                    echoes "EM=<0|1>"
//   FI\n     toggle flip-cover invert;                echoes "F v=.. inv=<0|1> .."
//   FC\n     recalibrate the flip-cover analog baseline (no distinct echo)
export const ENCODER_DETENT_THRESHOLDS = [1, 2, 4, 8] as const
export type EncoderDetentThreshold = (typeof ENCODER_DETENT_THRESHOLDS)[number]
export const DEFAULT_ENCODER_DETENT_THRESHOLD: EncoderDetentThreshold = 2

export interface ArduinoRuntimeState {
  // Persisted + re-applied on every connect so the encoder feel survives a
  // reflash/reconnect.
  encoderDetentThreshold: EncoderDetentThreshold
  // Confirmed live from the device echo; null = unknown until the device replies.
  muxDebug: boolean | null
  flipCoverInverted: boolean | null
  updatedAt: string
}

export function defaultRuntimeState(): ArduinoRuntimeState {
  return {
    encoderDetentThreshold: DEFAULT_ENCODER_DETENT_THRESHOLD,
    muxDebug: null,
    flipCoverInverted: null,
    updatedAt: new Date().toISOString()
  }
}

export function isEncoderDetentThreshold(value: unknown): value is EncoderDetentThreshold {
  return typeof value === 'number' && (ENCODER_DETENT_THRESHOLDS as readonly number[]).includes(value)
}

// Command builders (no trailing newline; SerialManager.sendRaw appends it).
export function encoderThresholdCommand(value: EncoderDetentThreshold): string {
  return `ET${value}`
}
export const MUX_DEBUG_TOGGLE_COMMAND = 'EM'
export const FLIP_INVERT_TOGGLE_COMMAND = 'FI'
export const FLIP_RECALIBRATE_COMMAND = 'FC'

// Parse a firmware echo line into the runtime fields it confirms. Returns null
// when the line isn't a recognised runtime echo.
export function parseRuntimeEcho(line: string): Partial<ArduinoRuntimeState> | null {
  const et = /^ET=(\d+)/.exec(line)
  if (et) {
    const n = Number(et[1])
    return isEncoderDetentThreshold(n) ? { encoderDetentThreshold: n } : null
  }
  const em = /^EM=(\d+)/.exec(line)
  if (em) return { muxDebug: em[1] !== '0' }
  // "F v=<state> raw=<analog> inv=<0|1> s=<btn>"
  const fi = /^F\b.*\binv=(\d+)/.exec(line)
  if (fi) return { flipCoverInverted: fi[1] !== '0' }
  return null
}

// ─── Serial monitor quick commands ───────────────────────────────────────────
export interface QuickSerialCommand {
  label: string
  command: string
  hint: string
}

// Ready-made one-letter SimHub-protocol commands for the monitor's quick bar.
export const QUICK_SERIAL_COMMANDS: QuickSerialCommand[] = [
  { label: 'Rev 0', command: 'R0', hint: 'Apaga as rev lights' },
  { label: 'Rev 2', command: 'R2', hint: 'Acende 2 LEDs (verde/amarelo)' },
  { label: 'Rev 4', command: 'R4', hint: 'Acende todos os 4 LEDs (redline)' },
  { label: 'Shift ON', command: 'B1', hint: 'Pisca azul de shift' },
  { label: 'Shift OFF', command: 'B0', hint: 'Desliga o pisca de shift' },
  { label: 'Start ON', command: 'S1', hint: 'Acende o LED START (TXLED)' },
  { label: 'Start OFF', command: 'S0', hint: 'Apaga o LED START' },
  { label: 'OLED teste', command: 'OSIM-X|Ultimate|ButtonBox', hint: 'Texto de teste nas 3 linhas' },
  { label: 'BigNum 0.0', command: 'D0.0', hint: 'Mostra um delta gigante' }
]

// ─── Hardware map (read-only, derived from pinout.h) ─────────────────────────
export interface ArduinoComponent {
  id: string
  name: string
  kind: 'display' | 'leds' | 'encoder' | 'mux' | 'buttons' | 'analog' | 'status' | 'output'
  connection: string
  detail: string
}

export interface ArduinoHardwareProfile {
  board: string
  mcu: string
  usb: string
  baud: number
  hidButtons: number
  encoders: number
  povHat: boolean
  components: ArduinoComponent[]
}

export const SIMX_HARDWARE_PROFILE: ArduinoHardwareProfile = {
  board: 'Arduino Pro Micro',
  mcu: 'ATmega32U4',
  usb: 'USB HID (Joystick) + Serial CDC 115200 8N1',
  baud: 115200,
  hidButtons: 32,
  encoders: 4,
  povHat: true,
  components: [
    {
      id: 'oled',
      name: 'OLED 0.96" SSD1306',
      kind: 'display',
      connection: 'I2C — D2 (SDA) / D3 (SCL)',
      detail: 'Modo texto (3 linhas ≤21 ch) via "O", BIGNUM via "D". Rotacionado 180° (U8G2_R2).'
    },
    {
      id: 'revled',
      name: 'Rev Lights WS2812B (4 LEDs)',
      kind: 'leds',
      connection: 'D10 (REV_LED_PIN)',
      detail: 'Level 0..4 via "R". Fixed firmware colors: 1 green, 2 yellow, 1 red. Blue shift flash via "B".'
    },
    {
      id: 'mux1',
      name: 'MUX1 CD74HC4067',
      kind: 'mux',
      connection: 'Sinal D8 · seletores D4-D7',
      detail: 'Engine Start, Flip Cover, toggles 3-pos UP/DOWN, push dos encoders, ENC4 (C14/C15).'
    },
    {
      id: 'mux2',
      name: 'MUX2 CD74HC4067',
      kind: 'mux',
      connection: 'Sinal D9/A9 · seletores D4-D7',
      detail: '3 buttons laranja, 3 green, 3 blue, e o joystick analog KY-023 (VRX/VRY via analogRead(A9), SW digital).'
    },
    {
      id: 'mux3',
      name: 'MUX3 CD74HC4067',
      kind: 'mux',
      connection: 'Sinal A0 · seletores D4-D7',
      detail: '8 buttons Cherry MX (RAD, DRS, WIP, INFO, TEMP, LAP, PIT, OK). C8-C15 livres (hot-swap futuro).'
    },
    {
      id: 'encoders',
      name: '4× Encoder KY-040 (EC11)',
      kind: 'encoder',
      connection: 'ENC1 D14/D15 · ENC2 D16/A3 · ENC3 A2/A1 · ENC4 via MUX1 C14/C15',
      detail: 'TC, ABS, BIAS, MAP. CW/CCW sent to the app/SimHub through serial "E<idx>:±1"; encoder pushes are HID.'
    },
    {
      id: 'joystick',
      name: 'Joystick analog KY-023',
      kind: 'analog',
      connection: 'MUX2 — VRX C14, VRY C15, SW C13',
      detail: 'Axes X/Y → POV hat HID. Button de click → HID 31.'
    },
    {
      id: 'startled',
      name: 'LED START',
      kind: 'status',
      connection: 'TXLED interno do Pro Micro',
      detail: 'On/off via "S1"/"S0". TXLED also blinks with serial traffic (not a 100% stable status).'
    },
    {
      id: 'hid',
      name: 'USB HID Joystick',
      kind: 'output',
      connection: 'USB nativo (ATmega32U4)',
      detail: '32 buttons + POV hat. Remapping is done in iRacing itself (HID fixo no firmware).'
    }
  ]
}

// ─── Firmware reference ──────────────────────────────────────────────────────
export interface ArduinoFirmwareInfo {
  reference: string
  reportsVersion: boolean
  libraries: string[]
  reflashSteps: string[]
  notes: string[]
}

export const SIMX_FIRMWARE_INFO: ArduinoFirmwareInfo = {
  reference: 'SIM-X Button Box — rev38 (button_box.ino)',
  reportsVersion: false,
  libraries: [
    'Joystick (Matthew Heironimus)',
    'Encoder (PJRC)',
    'FastLED (Daniel Garcia)',
    'U8g2 (olikraus)'
  ],
  reflashSteps: [
    'Open button_box.ino in Arduino IDE (the app keeps an unchanged reference copy in firmware/sim-x-reference/).',
    'Board: "Arduino Leonardo" (or SparkFun Pro Micro 5V/16MHz). Select the correct COM port.',
    'Instale as 4 bibliotecas listadas pelo Library Manager.',
    'Close this app and SimHub (the serial port is exclusive) before flashing.',
    'Compile and flash. Do NOT change the firmware — it works in the app AND SimHub without changes.'
  ],
  notes: [
    'The firmware does NOT report its version over serial, so automatic detection is unavailable — use this reference (rev38).',
    'Everything in the "Configuration" panel is a runtime setting: it applies immediately, without reflashing.',
    'The 115200 serial port is exclusive: the app and SimHub cannot open the same port at the same time.'
  ]
}

// ─── Multi-device fleet (persisted) ──────────────────────────────────────────
// User-configured generic serial devices that the app should auto-open on
// boot (e.g. a secondary Arduino driving an external OLED/matrix). Persisted
// at `userData/serial-devices.json`.
export const SERIAL_DEVICES_STORE_FILE = 'serial-devices.json'
export const SERIAL_DEVICES_STORE_VERSION = 1
export const GENERIC_DEVICE_DEFAULT_BAUD = 115200

export interface GenericSerialDeviceConfig {
  // Stable hub id assigned at creation time (e.g. 'gen-1'). When omitted on
  // input, the hub allocates one and the store records it on first save.
  id?: string
  path: string
  label: string
  baud: number
  // Stable USB identity captured when the device was added/connected. Used to
  // re-match the SAME physical device after Windows reassigns it to a different
  // COM port: `path` is only the (updatable) connect target — identity is the
  // real key. Absent for adapters that expose no USB ids.
  vendorId?: string
  productId?: string
  serialNumber?: string
  // ISO-8601, last time the user added/edited this device entry. Surfaces in
  // the UI as "added <when>".
  createdAt: string
  updatedAt: string
  // When false the entry is kept but not auto-opened (e.g. user temporarily
  // wants to use the port from another app).
  autoConnect: boolean
}

export interface SerialDevicesStorePayload {
  version: typeof SERIAL_DEVICES_STORE_VERSION
  devices: GenericSerialDeviceConfig[]
  updatedAt: string
}

export function defaultSerialDevicesStore(): SerialDevicesStorePayload {
  return {
    version: SERIAL_DEVICES_STORE_VERSION,
    devices: [],
    updatedAt: new Date().toISOString()
  }
}

export function isGenericSerialDeviceConfig(value: unknown): value is GenericSerialDeviceConfig {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<GenericSerialDeviceConfig>
  if (typeof candidate.path !== 'string' || !candidate.path) return false
  if (typeof candidate.label !== 'string' || !candidate.label) return false
  if (typeof candidate.baud !== 'number' || !Number.isFinite(candidate.baud) || candidate.baud <= 0) return false
  if (typeof candidate.createdAt !== 'string' || typeof candidate.updatedAt !== 'string') return false
  if (typeof candidate.autoConnect !== 'boolean') return false
  if (candidate.id !== undefined && typeof candidate.id !== 'string') return false
  if (candidate.vendorId !== undefined && typeof candidate.vendorId !== 'string') return false
  if (candidate.productId !== undefined && typeof candidate.productId !== 'string') return false
  if (candidate.serialNumber !== undefined && typeof candidate.serialNumber !== 'string') return false
  return true
}

// ─── Companion-protocol input snapshots ──────────────────────────────────────
// Aggregated state of the inputs a generic device has reported so far. The
// Inputs panel renders one block per device with these maps; updates are
// pushed at ~10Hz via `arduino:inputs` IPC.
export interface CompanionInputSnapshot {
  deviceId: string
  // Tombstone broadcast when a device disconnects; renderers must delete state.
  removed?: boolean
  // index → last known pressed state (true/false). Indexes are sparse.
  buttons: Record<number, boolean>
  // index → cumulative delta since boot (positive = CW). Resets on disconnect.
  encoders: Record<number, number>
  // index → last raw analog value (0..1023).
  analogs: Record<number, number>
  // ms-since-epoch of the last RX line for the device. 0 when nothing parsed yet.
  updatedAt: number
}

export function emptyInputSnapshot(deviceId: string): CompanionInputSnapshot {
  return { deviceId, buttons: {}, encoders: {}, analogs: {}, updatedAt: 0 }
}

// ─── Available IPC channel names ─────────────────────────────────────────────
// Kept here so renderer + main agree on a single source of truth. Existing
// `arduino:*` handlers are reused; these are the new multi-device extensions.
export const ARDUINO_CHANNELS = {
  // Multi-device fleet
  listDevices: 'arduino:listDevices',
  getDeviceConfigs: 'arduino:getDeviceConfigs',
  addDevice: 'arduino:addDevice',
  removeDevice: 'arduino:removeDevice',
  reconnectDevice: 'arduino:reconnectDevice',
  disconnectDevice: 'arduino:disconnectDevice',
  // Broadcast: fleet membership/status changed.
  devicesChanged: 'arduino:devicesChanged',

  // Per-device serial monitor (parallel to the legacy single-device handlers).
  getDeviceLog: 'arduino:getDeviceLog',
  clearDeviceLog: 'arduino:clearDeviceLog',
  sendDeviceRaw: 'arduino:sendDeviceRaw',
  // Broadcast: { deviceId, entries } when a device's monitor is active.
  deviceSerial: 'arduino:deviceSerial',

  // Companion-protocol inputs
  getInputs: 'arduino:getInputs',
  // Broadcast: CompanionInputSnapshot[] (~10Hz when active, including optional tombstones).
  inputs: 'arduino:inputs'
} as const

export type ArduinoChannel = (typeof ARDUINO_CHANNELS)[keyof typeof ARDUINO_CHANNELS]

// Payload broadcast on `arduino:devicesChanged` — the renderer mirrors the
// fleet from this single batched update.
export interface ArduinoDevicesChangedPayload {
  devices: SerialDeviceSummary[]
}

// Per-device serial-monitor broadcast (mirrors `arduino:serial` shape but
// scoped to a single non-primary device).
export interface ArduinoDeviceSerialBatch {
  deviceId: string
  entries: SerialLogEntry[]
}
