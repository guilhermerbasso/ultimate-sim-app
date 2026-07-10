// Device / component data model for the SimHub-style Arduino hub.
//
// A DeviceProfile describes ONE Arduino (board + serial link) and the list of
// COMPONENTS wired to it (RGB strips, an 8x8 matrix/iFlag, screens, 7-seg
// displays, gauges, input controls, a buzzer, a status LED). Each component has
// a pin assignment and a type-specific config. The renderer's Arduino hub edits
// these; per-component engines in main turn telemetry into companion-protocol
// frames (see `./companion.ts`).
//
// Keep this file dependency-light (only `./revlights` for the embedded rev-light
// config) so renderer, preload and main can all import it. It MUST NOT import
// from `src/main/` or React.

import type { RevlightsConfig } from './revlights'
import { DEFAULT_REVLIGHTS_CONFIG, normalizeRevlightsConfig } from './revlights'

export const DEVICES_STORE_FILE = 'arduino-devices.json'
export const DEVICES_STORE_VERSION = 1

// ─── Boards ──────────────────────────────────────────────────────────────────

export type BoardId =
  | 'pro-micro'
  | 'leonardo'
  | 'uno'
  | 'nano'
  | 'mega2560'
  | 'esp32'
  | 'esp32s3'
  | 'esp8266'
  | 'generic'

export interface BoardInfo {
  id: BoardId
  name: string
  mcu: string
  // Count of usable digital pins and analog-in pins (rough, for the pinout UI).
  digitalPins: number
  analogPins: number
  // PWM-capable pin labels (servo/gauge/analog-out roles want these).
  pwmPins: string[]
  // I2C pins (SDA, SCL) — for screens/segment drivers that talk I2C.
  i2cPins?: { sda: string; scl: string }
  // ATmega32U4 boards expose a native USB HID joystick (inputs can be HID).
  nativeUsbHid: boolean
  // Native USB CDC serial (ESP32-S3, Leonardo-style boards) can enumerate without
  // an external USB-UART bridge.
  nativeUsbCdc?: boolean
  wifiCapable?: boolean
  transport?: 'serial' | 'wifi' | 'both'
  defaultBaud: number
  // arduino-cli FQBN used by the (future) flashing tool.
  fqbn?: string
  notes?: string
}

export const BOARDS: BoardInfo[] = [
  {
    id: 'pro-micro',
    name: 'Arduino Pro Micro',
    mcu: 'ATmega32U4',
    digitalPins: 18,
    analogPins: 9,
    pwmPins: ['D3', 'D5', 'D6', 'D9', 'D10'],
    i2cPins: { sda: 'D2', scl: 'D3' },
    nativeUsbHid: true,
    defaultBaud: 115200,
    fqbn: 'arduino:avr:micro',
    notes: 'Placa da SIM-X Button Box (firmware rev38).'
  },
  {
    id: 'leonardo',
    name: 'Arduino Leonardo',
    mcu: 'ATmega32U4',
    digitalPins: 20,
    analogPins: 12,
    pwmPins: ['D3', 'D5', 'D6', 'D9', 'D10', 'D11', 'D13'],
    i2cPins: { sda: 'D2', scl: 'D3' },
    nativeUsbHid: true,
    defaultBaud: 115200,
    fqbn: 'arduino:avr:leonardo'
  },
  {
    id: 'uno',
    name: 'Arduino Uno',
    mcu: 'ATmega328P',
    digitalPins: 14,
    analogPins: 6,
    pwmPins: ['D3', 'D5', 'D6', 'D9', 'D10', 'D11'],
    i2cPins: { sda: 'A4', scl: 'A5' },
    nativeUsbHid: false,
    defaultBaud: 115200,
    fqbn: 'arduino:avr:uno'
  },
  {
    id: 'nano',
    name: 'Arduino Nano',
    mcu: 'ATmega328P',
    digitalPins: 14,
    analogPins: 8,
    pwmPins: ['D3', 'D5', 'D6', 'D9', 'D10', 'D11'],
    i2cPins: { sda: 'A4', scl: 'A5' },
    nativeUsbHid: false,
    defaultBaud: 115200,
    fqbn: 'arduino:avr:nano',
    notes: 'Good budget option for iFlag (8x8 matrix) on a secondary device.'
  },
  {
    id: 'mega2560',
    name: 'Arduino Mega 2560',
    mcu: 'ATmega2560',
    digitalPins: 54,
    analogPins: 16,
    pwmPins: ['D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13'],
    i2cPins: { sda: 'D20', scl: 'D21' },
    nativeUsbHid: false,
    defaultBaud: 115200,
    fqbn: 'arduino:avr:mega'
  },
  {
    id: 'esp32',
    name: 'ESP32 DevKit',
    mcu: 'ESP32',
    digitalPins: 34,
    analogPins: 16,
    pwmPins: ['GPIO2', 'GPIO4', 'GPIO5', 'GPIO12', 'GPIO13', 'GPIO14', 'GPIO15', 'GPIO16', 'GPIO17', 'GPIO18', 'GPIO19', 'GPIO21', 'GPIO22', 'GPIO23', 'GPIO25', 'GPIO26', 'GPIO27', 'GPIO32', 'GPIO33'],
    i2cPins: { sda: 'GPIO21', scl: 'GPIO22' },
    nativeUsbHid: false,
    nativeUsbCdc: false,
    wifiCapable: true,
    transport: 'both',
    defaultBaud: 115200,
    fqbn: 'esp32:esp32:esp32',
    notes: 'Wi‑Fi/BT integrado; use USB para provisionar e Wi‑Fi para operar no cockpit.'
  },
  {
    id: 'esp32s3',
    name: 'ESP32-S3 DevKit (WROOM-1)',
    mcu: 'ESP32-S3',
    digitalPins: 44,
    analogPins: 20,
    pwmPins: [
      'GPIO1', 'GPIO2', 'GPIO4', 'GPIO5', 'GPIO6', 'GPIO7', 'GPIO8', 'GPIO9', 'GPIO10', 'GPIO11', 'GPIO12',
      'GPIO13', 'GPIO14', 'GPIO15', 'GPIO16', 'GPIO17', 'GPIO18', 'GPIO21', 'GPIO35', 'GPIO36', 'GPIO37',
      'GPIO38', 'GPIO39', 'GPIO40', 'GPIO41', 'GPIO42'
    ],
    i2cPins: { sda: 'GPIO8', scl: 'GPIO9' },
    nativeUsbHid: false,
    nativeUsbCdc: true,
    wifiCapable: true,
    transport: 'both',
    defaultBaud: 115200,
    fqbn: 'esp32:esp32:esp32s3',
    notes: 'Placa 44 pinos Type‑C com USB CDC nativo, Wi‑Fi/BT e muitos GPIOs para button boxes grandes.'
  },
  {
    id: 'esp8266',
    name: 'ESP8266 (NodeMCU)',
    mcu: 'ESP8266',
    digitalPins: 11,
    analogPins: 1,
    pwmPins: ['D1', 'D2', 'D5', 'D6', 'D7', 'D8'],
    i2cPins: { sda: 'D2', scl: 'D1' },
    nativeUsbHid: false,
    defaultBaud: 115200,
    fqbn: 'esp8266:esp8266:nodemcuv2'
  },
  {
    id: 'generic',
    name: 'Other / generic',
    mcu: 'unknown',
    digitalPins: 14,
    analogPins: 6,
    pwmPins: [],
    nativeUsbHid: false,
    defaultBaud: 115200
  }
]

export function findBoard(id: BoardId): BoardInfo {
  return BOARDS.find((board) => board.id === id) ?? BOARDS[BOARDS.length - 1]
}

// ─── Component catalog ─────────────────────────────────────────────────────────

export type ComponentType =
  | 'rgbStrip' // WS2812/SK6812 strip — rev lights / flags / custom
  | 'rgbMatrix' // WS2812 matrix (8x8 iFlag) / MAX7219
  | 'screen' // OLED SSD1306 / character LCD HD44780
  | 'segDisplay' // 7-seg via TM1637 / TM1638 / MAX7219 / HT16K33
  | 'gauge' // servo / X27 stepper analog gauge
  | 'control' // buttons / encoders / analog inputs → HID/actions
  | 'buzzer' // piezo audio alert
  | 'startLed' // single status LED
  | 'customSerial' // arbitrary SimHub-style serial output template

export interface PinRole {
  role: string
  label: string
  kind: 'digital' | 'analog' | 'pwm' | 'i2c' | 'any'
  optional?: boolean
}

export interface ComponentTypeInfo {
  type: ComponentType
  name: string
  description: string
  simhubEquivalent: string
  // Pin roles the firmware needs wired for this component.
  requiredPins: PinRole[]
  // Capability key reported by the companion firmware handshake (see companion.ts).
  capabilityKey: string
}

export const COMPONENT_TYPES: ComponentTypeInfo[] = [
  {
    type: 'rgbStrip',
    name: 'RGB LEDs (fita)',
    description: 'WS2812/SK6812 addressable strip for rev lights, flags, or effects.',
    simhubEquivalent: 'RGB Leds',
    requiredPins: [{ role: 'data', label: 'Data (DIN)', kind: 'digital' }],
    capabilityKey: 'rgbStrip'
  },
  {
    type: 'rgbMatrix',
    name: 'RGB Matrix (iFlag)',
    description: 'Matriz RGB (ex.: 8x8 WS2812) para flags, icons, gear e scrolling text.',
    simhubEquivalent: 'RGB Matrix',
    requiredPins: [{ role: 'data', label: 'Data (DIN)', kind: 'digital' }],
    capabilityKey: 'rgbMatrix'
  },
  {
    type: 'screen',
    name: 'Tela (OLED / LCD)',
    description: 'SSD1306 OLED or HD44780 character LCD with telemetry pages.',
    simhubEquivalent: 'Screens',
    requiredPins: [
      { role: 'sda', label: 'SDA', kind: 'i2c' },
      { role: 'scl', label: 'SCL', kind: 'i2c' }
    ],
    capabilityKey: 'screen'
  },
  {
    type: 'segDisplay',
    name: 'Display 7-seg (TM1638/MAX7219)',
    description: 'Display de 7 segmentos para gear, speed, RPM ou lap.',
    simhubEquivalent: 'TM1638 / Gauges',
    requiredPins: [
      { role: 'clk', label: 'CLK', kind: 'digital' },
      { role: 'dio', label: 'DIO/DATA', kind: 'digital' },
      { role: 'stb', label: 'STB', kind: 'digital', optional: true }
    ],
    capabilityKey: 'segDisplay'
  },
  {
    type: 'gauge',
    name: 'Ponteiro (servo/stepper)',
    description: 'Mostrador analog com servo SG90 ou stepper X27.168.',
    simhubEquivalent: 'Gauges',
    requiredPins: [{ role: 'signal', label: 'Sinal/PWM', kind: 'pwm' }],
    capabilityKey: 'gauge'
  },
  {
    type: 'control',
    name: 'Controls (buttons/encoders)',
    description: 'Buttons, encoders, and analog axes mapped to HID/actions.',
    simhubEquivalent: 'Controls',
    requiredPins: [{ role: 'first', label: 'Primeiro pino', kind: 'any', optional: true }],
    capabilityKey: 'control'
  },
  {
    type: 'buzzer',
    name: 'Buzzer (piezo)',
    description: 'Sound alert por piezo, integrated with Alerts.',
    simhubEquivalent: 'Display & Alerts',
    requiredPins: [{ role: 'signal', label: 'Sinal', kind: 'digital' }],
    capabilityKey: 'buzzer'
  },
  {
    type: 'startLed',
    name: 'LED de status',
    description: 'Single LED driven by telemetry (pit limiter, DRS, etc.).',
    simhubEquivalent: 'Display & Alerts',
    requiredPins: [{ role: 'signal', label: 'Sinal', kind: 'digital' }],
    capabilityKey: 'startLed'
  },
  {
    type: 'customSerial',
    name: 'Custom serial device',
    description: 'Arbitrary serial output template driven by telemetry fields.',
    simhubEquivalent: 'Custom Serial Device',
    requiredPins: [],
    capabilityKey: 'customSerial'
  }
]

export function findComponentType(type: ComponentType): ComponentTypeInfo {
  return COMPONENT_TYPES.find((info) => info.type === type) ?? COMPONENT_TYPES[0]
}

// ─── Component configs ─────────────────────────────────────────────────────────

// role → physical pin label (e.g. { data: 'D10' }). Empty until the user maps it.
export type PinMap = Record<string, string>

export interface ComponentBase {
  id: string
  label: string
  enabled: boolean
  pins: PinMap
}

export type StripChip = 'ws2812' | 'sk6812' | 'apa102'
export type StripMode = 'revlights' | 'flags' | 'custom'
export type StripColorOrder = 'grb' | 'rgb' | 'brg' | 'rbg'
export type StripEffect = 'rev-gradient' | 'flag-bar' | 'ambient' | 'pit-limiter' | 'spotter' | 'custom'
export type StripTestPattern = 'rainbow' | 'chase' | 'solid' | 'alternating' | 'off'

export interface RgbStripSegment {
  id: string
  label: string
  start: number
  length: number
  effect: StripEffect
  color: string
}

export interface RgbStripComponent extends ComponentBase {
  type: 'rgbStrip'
  chip: StripChip
  ledCount: number
  brightness: number // 0..255
  mode: StripMode
  // Embedded rev-lights behaviour (RPM thresholds, segments, flag colours).
  revlights: RevlightsConfig
  presetId: string
  colorOrder: StripColorOrder
  gammaCorrection: boolean
  refreshHz: number
  startupEffect: StripEffect
  testPattern: StripTestPattern
  idleColor: string
  segments: RgbStripSegment[]
}

export type MatrixChip = 'ws2812' | 'max7219'
export type MatrixMode = 'iflag' | 'gear' | 'custom'

export interface RgbMatrixComponent extends ComponentBase {
  type: 'rgbMatrix'
  chip: MatrixChip
  width: number
  height: number
  brightness: number // 0..255
  orientation: 0 | 90 | 180 | 270
  serpentine: boolean
  mode: MatrixMode
}

export type ScreenKind = 'oled-ssd1306' | 'lcd-hd44780' | 'tft' | 'nextion'
export type ScreenRotation = 0 | 90 | 180 | 270
export type ScreenFontSize = 'small' | 'medium' | 'large'
export type ScreenField =
  | 'gear'
  | 'speed'
  | 'rpm'
  | 'lap'
  | 'delta'
  | 'fuel'
  | 'position'
  | 'flags'
  | 'tyres'
  | 'brakes'
  | 'custom'

export interface ScreenPage {
  id: string
  label: string
  fields: ScreenField[]
  layout: 'stacked' | 'grid' | 'hero'
  durationMs: number
}

export interface ScreenComponent extends ComponentBase {
  type: 'screen'
  kind: ScreenKind
  cols: number
  rows: number
  // Reuse the existing OLED page engine; pages live in oled-dashboard.json.
  useOledDashboard: boolean
  presetId: string
  i2cAddress: string
  rotation: ScreenRotation
  contrast: number
  invert: boolean
  fontSize: ScreenFontSize
  pageCycleMs: number
  showUnits: boolean
  pages: ScreenPage[]
}

export type SegChip = 'tm1637' | 'tm1638' | 'max7219' | 'ht16k33'
export type SegMetric = 'gear' | 'speed' | 'rpm' | 'lap' | 'position' | 'custom'
export type SegLedMode = 'telemetry' | 'flags' | 'rev' | 'spotter' | 'manual'

export interface SegLedMapping {
  index: number
  label: string
  metric: SegMetric | 'pitLimiter' | 'drs' | 'flag'
  color: string
  blink: boolean
}

export interface SegDisplayComponent extends ComponentBase {
  type: 'segDisplay'
  chip: SegChip
  digits: number
  metric: SegMetric
  presetId: string
  brightness: number
  leadingZeros: boolean
  decimalPlaces: number
  alternateMetric: SegMetric
  alternateEveryMs: number
  ledMode: SegLedMode
  ledMappings: SegLedMapping[]
}

export type GaugeKind = 'servo' | 'stepper-x27'
export type GaugeMetric = 'speed' | 'rpm' | 'fuel' | 'waterTemp' | 'oilTemp' | 'custom'
export type GaugeCurve = 'linear' | 'ease-in' | 'ease-out' | 's-curve'
export type GaugeSweepDirection = 'clockwise' | 'counterclockwise'

export interface GaugeComponent extends ComponentBase {
  type: 'gauge'
  kind: GaugeKind
  metric: GaugeMetric
  minValue: number
  maxValue: number
  minAngle: number
  maxAngle: number
  presetId: string
  sweepDirection: GaugeSweepDirection
  curve: GaugeCurve
  smoothingMs: number
  calibrationOffset: number
  homeOnStartup: boolean
  warningValue: number
  testSweep: boolean
}

export type ControlButtonAction =
  | 'keyboard'
  | 'joystickButton'
  | 'toggle'
  | 'pitLimiter'
  | 'tractionControl'
  | 'brakeBias'
  | 'blackBox'
  | 'custom'
export type EncoderMode = 'incremental' | 'absolute' | 'dual-button'

// Physical switch behaviour for a wired input — mirrors HidSwitchType in
// shared/actions.ts so the device model and the Controls bindings agree on
// vocabulary (momentary push, maintained toggle, both-edge pulse, flip cover).
export type SwitchType = 'momentary' | 'toggle' | 'pulse-both-edges' | 'flip-cover'

// Construction descriptor for an input contact.
export type ButtonType = 'push' | 'maintained'

export interface ButtonMapping {
  index: number
  label: string
  action: ControlButtonAction
  value: string
  momentary: boolean
  // How the contact is interpreted when read. Absent → derive from `momentary`.
  switchType?: SwitchType
  // Physical construction (push vs maintained), informational.
  buttonType?: ButtonType
}

export interface EncoderMapping {
  index: number
  label: string
  mode: EncoderMode
  clockwise: string
  counterClockwise: string
  pushAction: string
  // Detent option: number of raw pulses the encoder emits per physical detent.
  // Absent/1 → fire every pulse.
  stepsPerDetent?: number
  // When true the encoder is read as a CW/CCW dual-button pair (detent mode).
  dualButton?: boolean
}

export interface AnalogMapping {
  index: number
  label: string
  axis: 'x' | 'y' | 'z' | 'rx' | 'ry' | 'rz' | 'slider' | 'dial'
  min: number
  max: number
  invert: boolean
}

export interface ControlComponent extends ComponentBase {
  type: 'control'
  buttons: number
  encoders: number
  analogs: number
  presetId: string
  debounceMs: number
  usePullups: boolean
  encoderMode: EncoderMode
  buttonMappings: ButtonMapping[]
  encoderMappings: EncoderMapping[]
  analogMappings: AnalogMapping[]
}

export type AlertSeverity = 'info' | 'warning' | 'critical'

export interface AlertRule {
  id: string
  label: string
  condition: 'pitLimiter' | 'drs' | 'shift' | 'yellowFlag' | 'lowFuel' | 'custom'
  severity: AlertSeverity
  message: string
  blink: boolean
}

export interface BuzzerComponent extends ComponentBase {
  type: 'buzzer'
  activeHigh: boolean
  presetId: string
  volume: number
  toneHz: number
  durationMs: number
  repeat: number
  rules: AlertRule[]
}

export type StartLedTrigger = 'pitLimiter' | 'drs' | 'shift' | 'custom'
export type LedBlinkMode = 'steady' | 'slow' | 'fast' | 'pulse'

export interface StartLedComponent extends ComponentBase {
  type: 'startLed'
  trigger: StartLedTrigger
  color: string
  presetId: string
  offColor: string
  brightness: number
  blinkMode: LedBlinkMode
  rules: AlertRule[]
}

export interface CustomSerialComponent extends ComponentBase {
  type: 'customSerial'
  template: string
  telemetryFields: string[]
  sampleValue: string
  sendRateHz: number
  appendNewline: boolean
}

export type DeviceComponent =
  | RgbStripComponent
  | RgbMatrixComponent
  | ScreenComponent
  | SegDisplayComponent
  | GaugeComponent
  | ControlComponent
  | BuzzerComponent
  | StartLedComponent
  | CustomSerialComponent

// ─── Device profile ────────────────────────────────────────────────────────────

export interface DeviceProfile {
  id: string
  label: string
  // Links to the open SerialHub device. 'simx' is the primary SIM-X box.
  deviceId?: string
  port?: string
  board: BoardId
  baud: number
  components: DeviceComponent[]
  createdAt: string
  updatedAt: string
}

export interface DevicesPayload {
  version: number
  devices: DeviceProfile[]
  updatedAt: string
}

export function defaultDevicesPayload(): DevicesPayload {
  return { version: DEVICES_STORE_VERSION, devices: [], updatedAt: new Date(0).toISOString() }
}

// ─── Component factory (sensible defaults per type) ────────────────────────────

let componentSeq = 0
function nextComponentId(type: ComponentType): string {
  componentSeq += 1
  return `${type}-${Date.now().toString(36)}-${componentSeq}`
}

export function createComponent(type: ComponentType): DeviceComponent {
  const base = { id: nextComponentId(type), enabled: true, pins: {} as PinMap }
  switch (type) {
    case 'rgbStrip':
      return {
        ...base,
        type,
        label: 'Rev Lights',
        chip: 'ws2812',
        ledCount: 4,
        brightness: 200,
        mode: 'revlights',
        revlights: { ...DEFAULT_REVLIGHTS_CONFIG, enabled: true },
        presetId: 'rev-lights-4',
        colorOrder: 'grb',
        gammaCorrection: true,
        refreshHz: 25,
        startupEffect: 'rev-gradient',
        testPattern: 'rainbow',
        idleColor: '#000000',
        segments: [
          { id: 'left', label: 'Left rev bank', start: 0, length: 2, effect: 'rev-gradient', color: '#00ff55' },
          { id: 'right', label: 'Right rev bank', start: 2, length: 2, effect: 'rev-gradient', color: '#ff2200' }
        ]
      }
    case 'rgbMatrix':
      return {
        ...base,
        type,
        label: 'iFlag 8x8',
        chip: 'ws2812',
        width: 8,
        height: 8,
        brightness: 120,
        orientation: 0,
        serpentine: true,
        mode: 'iflag'
      }
    case 'screen':
      return {
        ...base,
        type,
        label: 'OLED',
        kind: 'oled-ssd1306',
        cols: 21,
        rows: 4,
        // Default OFF so the Hub's device-output engine drives a secondary screen.
        // (useOledDashboard=true defers to the legacy OLED engine, which only
        // targets the SIM-X primary.)
        useOledDashboard: false,
        presetId: 'oled-race-dashboard',
        i2cAddress: '0x3C',
        rotation: 0,
        contrast: 180,
        invert: false,
        fontSize: 'medium',
        pageCycleMs: 3500,
        showUnits: true,
        pages: [
          { id: 'race', label: 'Race page', fields: ['gear', 'speed', 'rpm', 'delta'], layout: 'hero', durationMs: 3500 },
          { id: 'laps', label: 'Lap timing', fields: ['lap', 'delta', 'position'], layout: 'stacked', durationMs: 3500 }
        ]
      }
    case 'segDisplay':
      return {
        ...base,
        type,
        label: '7-seg',
        chip: 'tm1637',
        digits: 4,
        metric: 'gear',
        presetId: 'tm1638-gear-flags',
        brightness: 6,
        leadingZeros: false,
        decimalPlaces: 0,
        alternateMetric: 'speed',
        alternateEveryMs: 0,
        ledMode: 'flags',
        ledMappings: [
          { index: 0, label: 'Yellow flag', metric: 'flag', color: '#ffcc00', blink: true },
          { index: 1, label: 'Blue flag', metric: 'flag', color: '#1f8dff', blink: true },
          { index: 2, label: 'Pit limiter', metric: 'pitLimiter', color: '#ff2d2d', blink: false },
          { index: 3, label: 'DRS', metric: 'drs', color: '#36d17c', blink: false }
        ]
      }
    case 'gauge':
      return {
        ...base,
        type,
        label: 'Ponteiro',
        kind: 'servo',
        metric: 'speed',
        minValue: 0,
        maxValue: 300,
        minAngle: 0,
        maxAngle: 180,
        presetId: 'gt-speedometer',
        sweepDirection: 'clockwise',
        curve: 'linear',
        smoothingMs: 120,
        calibrationOffset: 0,
        homeOnStartup: true,
        warningValue: 0,
        testSweep: true
      }
    case 'control':
      return {
        ...base,
        type,
        label: 'Controls',
        buttons: 0,
        encoders: 0,
        analogs: 0,
        presetId: 'buttonbox-12-encoders',
        debounceMs: 20,
        usePullups: true,
        encoderMode: 'incremental',
        buttonMappings: [
          { index: 0, label: 'Pit limiter', action: 'pitLimiter', value: 'P', momentary: true },
          { index: 1, label: 'Radio', action: 'keyboard', value: 'R', momentary: true }
        ],
        encoderMappings: [
          { index: 0, label: 'Brake bias', mode: 'incremental', clockwise: 'bias+', counterClockwise: 'bias-', pushAction: 'bias-reset' }
        ],
        analogMappings: []
      }
    case 'buzzer':
      return {
        ...base,
        type,
        label: 'Buzzer',
        activeHigh: true,
        presetId: 'shift-warning-beeps',
        volume: 70,
        toneHz: 2000,
        durationMs: 150,
        repeat: 1,
        rules: [
          { id: 'shift', label: 'Shift point', condition: 'shift', severity: 'warning', message: 'SHIFT', blink: true },
          { id: 'low-fuel', label: 'Low fuel', condition: 'lowFuel', severity: 'critical', message: 'LOW FUEL', blink: true }
        ]
      }
    case 'startLed':
      return {
        ...base,
        type,
        label: 'LED status',
        trigger: 'pitLimiter',
        color: '#1F8DFF',
        presetId: 'pit-drs-status',
        offColor: '#000000',
        brightness: 180,
        blinkMode: 'steady',
        rules: [
          { id: 'pit', label: 'Pit limiter', condition: 'pitLimiter', severity: 'warning', message: 'PIT', blink: false },
          { id: 'drs', label: 'DRS available', condition: 'drs', severity: 'info', message: 'DRS', blink: false }
        ]
      }
    case 'customSerial':
      return {
        ...base,
        type,
        label: 'Custom serial output',
        template: 'T:${value}',
        telemetryFields: ['speedKmh'],
        sampleValue: '123',
        sendRateHz: 20,
        appendNewline: true
      }
    default:
      return {
        ...base,
        type: 'startLed',
        label: 'LED status',
        trigger: 'custom',
        color: '#1F8DFF',
        presetId: 'custom-alert-led',
        offColor: '#000000',
        brightness: 180,
        blinkMode: 'steady',
        rules: []
      }
  }
}

// ─── Validation / normalization ────────────────────────────────────────────────

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback
  return Math.max(min, Math.min(max, n))
}

// Deep-normalize one component: start from the type's defaults and overlay the
// stored fields, so an old/partial/hand-edited entry (e.g. `{type:'rgbStrip'}`
// with no `revlights`/`pins`) can never reach an engine or the UI missing a
// field. Returns null when the type is unknown.
export function normalizeComponent(input: unknown): DeviceComponent | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Partial<DeviceComponent> & { type?: unknown; pins?: unknown }
  if (!isComponentType(raw.type)) return null
  const defaults = createComponent(raw.type)
  const pins: PinMap =
    raw.pins && typeof raw.pins === 'object' && !Array.isArray(raw.pins)
      ? Object.fromEntries(
          Object.entries(raw.pins as Record<string, unknown>).filter(
            ([, value]) => typeof value === 'string'
          ) as Array<[string, string]>
        )
      : {}
  const merged = {
    ...defaults,
    ...(raw as object),
    type: raw.type,
    id: typeof raw.id === 'string' && raw.id ? raw.id : defaults.id,
    label: typeof raw.label === 'string' ? raw.label : defaults.label,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : defaults.enabled,
    pins
  } as DeviceComponent
  if (merged.type === 'rgbStrip') {
    merged.revlights = normalizeRevlightsConfig(merged.revlights)
    merged.ledCount = clampInt(merged.ledCount, 1, 256, 4)
    merged.brightness = clampInt(merged.brightness, 0, 255, 200)
    merged.refreshHz = clampInt(merged.refreshHz, 1, 60, 25)
    merged.segments = Array.isArray(merged.segments) ? merged.segments : []
  } else if (merged.type === 'rgbMatrix') {
    merged.width = clampInt(merged.width, 1, 32, 8)
    merged.height = clampInt(merged.height, 1, 32, 8)
    merged.brightness = clampInt(merged.brightness, 0, 255, 120)
    merged.orientation = ([0, 90, 180, 270] as number[]).includes(merged.orientation) ? merged.orientation : 0
  } else if (merged.type === 'screen') {
    merged.cols = clampInt(merged.cols, 1, 64, 21)
    merged.rows = clampInt(merged.rows, 1, 16, 4)
    merged.contrast = clampInt(merged.contrast, 0, 255, 180)
    merged.pageCycleMs = clampInt(merged.pageCycleMs, 500, 30000, 3500)
    merged.pages = Array.isArray(merged.pages) ? merged.pages : []
  } else if (merged.type === 'segDisplay') {
    merged.digits = clampInt(merged.digits, 1, 8, 4)
    merged.brightness = clampInt(merged.brightness, 0, 7, 6)
    merged.decimalPlaces = clampInt(merged.decimalPlaces, 0, 3, 0)
    merged.alternateEveryMs = clampInt(merged.alternateEveryMs, 0, 60000, 0)
    merged.ledMappings = Array.isArray(merged.ledMappings) ? merged.ledMappings : []
  } else if (merged.type === 'gauge') {
    merged.smoothingMs = clampInt(merged.smoothingMs, 0, 2000, 120)
    merged.calibrationOffset = clampInt(merged.calibrationOffset, -180, 180, 0)
  } else if (merged.type === 'control') {
    merged.buttons = clampInt(merged.buttons, 0, 128, 0)
    merged.encoders = clampInt(merged.encoders, 0, 32, 0)
    merged.analogs = clampInt(merged.analogs, 0, 16, 0)
    merged.debounceMs = clampInt(merged.debounceMs, 0, 250, 20)
    merged.buttonMappings = Array.isArray(merged.buttonMappings) ? merged.buttonMappings : []
    merged.encoderMappings = Array.isArray(merged.encoderMappings) ? merged.encoderMappings : []
    merged.analogMappings = Array.isArray(merged.analogMappings) ? merged.analogMappings : []
  } else if (merged.type === 'buzzer') {
    merged.volume = clampInt(merged.volume, 0, 100, 70)
    merged.toneHz = clampInt(merged.toneHz, 20, 12000, 2000)
    merged.durationMs = clampInt(merged.durationMs, 20, 5000, 150)
    merged.repeat = clampInt(merged.repeat, 1, 10, 1)
    merged.rules = Array.isArray(merged.rules) ? merged.rules : []
  } else if (merged.type === 'startLed') {
    merged.brightness = clampInt(merged.brightness, 0, 255, 180)
    merged.rules = Array.isArray(merged.rules) ? merged.rules : []
  } else if (merged.type === 'customSerial') {
    merged.template = typeof merged.template === 'string' && merged.template ? merged.template : 'T:${value}'
    merged.telemetryFields = Array.isArray(merged.telemetryFields)
      ? merged.telemetryFields.filter((field): field is string => typeof field === 'string' && field.trim().length > 0)
      : ['speedKmh']
    merged.sampleValue = typeof merged.sampleValue === 'string' ? merged.sampleValue : '123'
    merged.sendRateHz = clampInt(merged.sendRateHz, 1, 60, 20)
    merged.appendNewline = typeof merged.appendNewline === 'boolean' ? merged.appendNewline : true
  }
  return merged
}

export function isComponentType(value: unknown): value is ComponentType {
  return typeof value === 'string' && COMPONENT_TYPES.some((info) => info.type === value)
}

export function isBoardId(value: unknown): value is BoardId {
  return typeof value === 'string' && BOARDS.some((board) => board.id === value)
}

export function isDeviceProfile(value: unknown): value is DeviceProfile {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<DeviceProfile>
  if (typeof candidate.id !== 'string' || !candidate.id) return false
  if (typeof candidate.label !== 'string') return false
  if (!isBoardId(candidate.board)) return false
  if (!Array.isArray(candidate.components)) return false
  return true
}

export function normalizeDeviceProfile(input: Partial<DeviceProfile> | null | undefined): DeviceProfile {
  const now = new Date().toISOString()
  const board: BoardId = isBoardId(input?.board) ? input.board : 'generic'
  const components = Array.isArray(input?.components)
    ? input.components
        .map((component) => normalizeComponent(component))
        .filter((component): component is DeviceComponent => component !== null)
    : []
  return {
    id: typeof input?.id === 'string' && input.id ? input.id : `dev-${Date.now().toString(36)}`,
    label: typeof input?.label === 'string' && input.label ? input.label : 'Arduino',
    deviceId: typeof input?.deviceId === 'string' ? input.deviceId : undefined,
    port: typeof input?.port === 'string' ? input.port : undefined,
    board,
    baud: typeof input?.baud === 'number' && input.baud > 0 ? Math.trunc(input.baud) : findBoard(board).defaultBaud,
    components,
    createdAt: typeof input?.createdAt === 'string' ? input.createdAt : now,
    updatedAt: typeof input?.updatedAt === 'string' ? input.updatedAt : now
  }
}

// ─── IPC channels ──────────────────────────────────────────────────────────────

export const DEVICES_CHANNELS = {
  list: 'devices:list',
  get: 'devices:get',
  save: 'devices:save',
  remove: 'devices:remove',
  // Fire-and-forget "blink/test this component now" so the user can verify wiring.
  test: 'devices:test',
  getBoards: 'devices:getBoards',
  getComponentTypes: 'devices:getComponentTypes',
  // Broadcast: the device-profile list changed.
  changed: 'devices:changed'
} as const

export type DevicesChannel = (typeof DEVICES_CHANNELS)[keyof typeof DEVICES_CHANNELS]
