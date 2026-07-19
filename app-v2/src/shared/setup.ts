// Arduino Setup Tool — shared catalog + IPC contract.
//
// This is the SimHub-style "pick a module → flash prebuilt firmware → it just
// works" flow. Keep this file dependency-light (only `./devices` types) so the
// renderer (wizard cards), the preload bridge and the main flasher all consume
// the SAME module/board catalog and channel names.
//
// The MAIN process owns the actual flashing (see src/main/devices/flasher.ts)
// and resolves the firmware `.hex` + bundled `avrdude` from the resources dir.
// This module only describes WHICH firmware/board/wiring each catalog entry
// uses; it never touches the filesystem or `process`.

import type { BoardId, ComponentType } from './devices'

// ─── IPC channels ───────────────────────────────────────────────────────────
// The preload allowlist exposes the `setup:` prefix (see src/preload/index.ts).

export const SETUP_CHANNELS = {
  // invoke → { modules, boards }
  listModules: 'setup:listModules',
  // invoke → PortInfo[] (reuses the serial hub port listing)
  listPorts: 'setup:listFlashablePorts',
  // invoke(FlashRequest) → FlashResult (resolves even on failure; never throws main)
  flash: 'setup:flash',
  // broadcast → FlashProgress (live log + progress bar during a flash)
  progress: 'setup:progress'
} as const

export type SetupChannel = (typeof SETUP_CHANNELS)[keyof typeof SETUP_CHANNELS]

// ─── Boards we can flash from the wizard ──────────────────────────────────────
// Kept intentionally small (the SimHub-parity beginner set). Flash parameters
// are board-intrinsic; the module catalog only points at the right `.hex`.

export type FlashBoardId = 'nano' | 'uno' | 'pro-micro' | 'esp32' | 'esp32s3'

// Bootloader/programmer family. This is the single most important property for
// the "stk500 not in sync (resp=0x03/0xef)" failure: the `arduino` (stk500)
// programmer ONLY syncs with an Optiboot/ATmega328P bootloader. An ATmega32U4
// (Pro Micro/Leonardo) speaks the Caterina/avr109 protocol and must be flashed
// with `avr109` after a 1200bps-touch reset — never stk500. ESP parts use
// arduino-cli/esptool, not avrdude.
export type FlashMcuFamily = 'avr328' | 'avr32u4' | 'esp'

export interface FlashBaudOption {
  id: string
  label: string
  baud: number
}

export interface FlashBoardSpec {
  id: FlashBoardId
  name: string
  // avrdude `-p` value for AVR or friendly MCU label for arduino-cli boards.
  mcu: 'atmega328p' | 'atmega32u4' | 'esp32' | 'esp32s3'
  // Bootloader family — drives programmer/baud selection and auto-detection.
  mcuFamily: FlashMcuFamily
  // avrdude `-c` programmer for AVR; arduino-cli boards use the FQBN below.
  programmer: 'arduino' | 'avr109' | 'arduino-cli'
  flashTool?: 'avrdude' | 'arduino-cli'
  fqbn?: string
  wifiCapable?: boolean
  transport?: 'serial' | 'wifi' | 'both'
  // 32U4 (Pro Micro / Leonardo) need the 1200bps-touch reset into the bootloader.
  needs1200Touch: boolean
  baudOptions: FlashBaudOption[]
  defaultBaudId: string
  // DeviceProfile.board this maps to when the Hub profile is auto-created.
  profileBoard: BoardId
  hint?: string
}

export const FLASH_BOARDS: FlashBoardSpec[] = [
  {
    id: 'nano',
    name: 'Arduino Nano',
    mcu: 'atmega328p',
    mcuFamily: 'avr328',
    programmer: 'arduino',
    needs1200Touch: false,
    baudOptions: [
      { id: 'new', label: 'Bootloader novo (115200)', baud: 115200 },
      { id: 'old', label: 'Clone / bootloader antigo (57600)', baud: 57600 }
    ],
    defaultBaudId: 'new',
    profileBoard: 'nano',
    hint: 'If flashing fails right at the start, switch to the old bootloader (57600) ? common on CH340 clones.'
  },
  {
    id: 'uno',
    name: 'Arduino Uno',
    mcu: 'atmega328p',
    mcuFamily: 'avr328',
    programmer: 'arduino',
    needs1200Touch: false,
    baudOptions: [
      { id: 'uno', label: 'Uno R3 (115200)', baud: 115200 },
      { id: 'old', label: 'Clone / bootloader antigo (57600)', baud: 57600 }
    ],
    defaultBaudId: 'uno',
    profileBoard: 'uno',
    hint: 'Genuine Uno R3 uses 115200. CH340 clones with the old bootloader may need 57600.'
  },
  {
    id: 'pro-micro',
    name: 'Arduino Pro Micro / Leonardo (32U4)',
    mcu: 'atmega32u4',
    mcuFamily: 'avr32u4',
    programmer: 'avr109',
    needs1200Touch: true,
    baudOptions: [{ id: 'caterina', label: 'Caterina avr109 (57600)', baud: 57600 }],
    defaultBaudId: 'caterina',
    profileBoard: 'pro-micro',
    hint: 'The board restarts into bootloader mode and the COM port changes for ~2s during flashing ? this is normal. If it fails, tap RESET twice quickly and flash right away.'
  },
  {
    id: 'esp32',
    name: 'ESP32 DevKit (Wi‑Fi)',
    mcu: 'esp32',
    mcuFamily: 'esp',
    programmer: 'arduino-cli',
    flashTool: 'arduino-cli',
    fqbn: 'esp32:esp32:esp32',
    wifiCapable: true,
    transport: 'both',
    needs1200Touch: false,
    baudOptions: [{ id: 'usb', label: 'USB serial (arduino-cli)', baud: 921600 }],
    defaultBaudId: 'usb',
    profileBoard: 'esp32',
    hint: 'Usa arduino-cli + core esp32. Install with: arduino-cli core install esp32:esp32.'
  },
  {
    id: 'esp32s3',
    name: 'ESP32-S3 DevKit Type‑C (Wi‑Fi)',
    mcu: 'esp32s3',
    mcuFamily: 'esp',
    programmer: 'arduino-cli',
    flashTool: 'arduino-cli',
    fqbn: 'esp32:esp32:esp32s3',
    wifiCapable: true,
    transport: 'both',
    needs1200Touch: false,
    baudOptions: [{ id: 'usb-cdc', label: 'USB CDC nativo (arduino-cli)', baud: 921600 }],
    defaultBaudId: 'usb-cdc',
    profileBoard: 'esp32s3',
    hint: 'Ideal for ESP32-S3-WROOM-1 44-pin Type?C. Can run over USB serial or Wi?Fi after provisioning.'
  }
]

export function findFlashBoard(id: string): FlashBoardSpec | null {
  return FLASH_BOARDS.find((board) => board.id === id) ?? null
}

export function findFlashBaud(board: FlashBoardSpec, baudId: string | undefined): FlashBaudOption {
  return (
    board.baudOptions.find((option) => option.id === baudId) ??
    board.baudOptions.find((option) => option.id === board.defaultBaudId) ??
    board.baudOptions[0]
  )
}

// Distinct baud rates to try, chosen baud first. Used by the flasher to
// auto-retry the *other* Optiboot speed (115200 ↔ 57600) when the first attempt
// fails with stk500 "not in sync". 32U4 (avr109) and ESP boards have a single
// fixed speed, so this collapses to just the chosen one.
export function flashBaudCandidates(board: FlashBoardSpec, baudId: string | undefined): number[] {
  const chosen = findFlashBaud(board, baudId).baud
  if (board.mcuFamily !== 'avr328') return [chosen]
  const ordered = [chosen, ...board.baudOptions.map((option) => option.baud)]
  return [...new Set(ordered)]
}

// ─── USB board auto-detection ─────────────────────────────────────────────────
// A compiled AVR board cannot be fully introspected, but its USB descriptor
// (VID/PID + friendly name) reliably narrows the bootloader family. This is what
// lets the wizard preselect the RIGHT flash board so users don't pick a 328P
// profile for a 32U4 device (the classic stk500 not-in-sync cause).

export type FlashGuessConfidence = 'high' | 'medium' | 'low'

export interface UsbDescriptorLike {
  vendorId?: string
  productId?: string
  friendlyName?: string
  manufacturer?: string
}

export interface FlashBoardGuess {
  // Best-matching catalog board to preselect for flashing.
  boardId: FlashBoardId
  family: FlashMcuFamily
  // User-facing board-family label (pt-BR, shown in the identify chip).
  label: string
  confidence: FlashGuessConfidence
  // Why we guessed this — surfaced so the choice is transparent/honest.
  reason: string
  // True for ATmega32U4: the app MUST use avr109 + 1200bps, NOT stk500.
  needsAvr109: boolean
}

interface UsbSignature {
  vendorId: string
  // Lowercased product ids this rule applies to; omit to match any PID for the VID.
  productIds?: string[]
  boardId: FlashBoardId
  family: FlashMcuFamily
  confidence: FlashGuessConfidence
  label: string
  reason: string
}

function normalizeUsbId(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/^0x/, '').trim()
}

// Ordered most-specific (VID+PID) → least-specific (VID only). The 32U4 rules
// are deliberately high-confidence because getting that family wrong is the
// dominant not-in-sync failure mode.
export const BOARD_USB_SIGNATURES: UsbSignature[] = [
  // Genuine Arduino Leonardo / Micro (ATmega32U4, Caterina/avr109).
  {
    vendorId: '2341',
    productIds: ['0036', '8036', '0037', '8037', '0237', '8237'],
    boardId: 'pro-micro',
    family: 'avr32u4',
    confidence: 'high',
    label: 'Arduino Leonardo/Micro (ATmega32U4)',
    reason: 'Arduino 32U4 PID ? Caterina bootloader: flash with avr109 + 1200bps reset (stk500 does not sync).'
  },
  {
    vendorId: '2a03',
    productIds: ['0036', '8036', '0037', '8037'],
    boardId: 'pro-micro',
    family: 'avr32u4',
    confidence: 'high',
    label: 'Arduino.org Leonardo/Micro (ATmega32U4)',
    reason: 'PID 32U4 da Arduino.org — bootloader Caterina (avr109 + 1200bps).'
  },
  // Genuine Arduino Uno / Nano / Mega (ATmega328P/2560, Optiboot/stk500).
  {
    vendorId: '2341',
    boardId: 'uno',
    family: 'avr328',
    confidence: 'high',
    label: 'Genuine Arduino (ATmega328P/Optiboot)',
    reason: 'VID 2341 (Arduino) — bootloader Optiboot: programmer arduino (stk500) a 115200.'
  },
  {
    vendorId: '2a03',
    boardId: 'uno',
    family: 'avr328',
    confidence: 'high',
    label: 'Genuine Arduino.org (ATmega328P)',
    reason: 'VID 2a03 (Arduino.org) — bootloader Optiboot: programmer arduino (stk500).'
  },
  // SparkFun Pro Micro / Qwiic family (ATmega32U4, Caterina/avr109).
  {
    vendorId: '1b4f',
    boardId: 'pro-micro',
    family: 'avr32u4',
    confidence: 'high',
    label: 'SparkFun Pro Micro (ATmega32U4)',
    reason: 'VID 1b4f (SparkFun) — 32U4 Caterina: grave com avr109 + reset 1200bps, nunca stk500.'
  },
  // Adafruit native-USB boards — often 32U4, but also SAMD/nRF/ESP. Low confidence.
  {
    vendorId: '239a',
    boardId: 'pro-micro',
    family: 'avr32u4',
    confidence: 'low',
    label: 'Adafruit USB nativo (talvez 32U4)',
    reason: 'VID 239a (Adafruit). If it is 32U4 use avr109 + 1200bps; it may also be SAMD/ESP ? confirm the model.'
  },
  // Espressif native USB (ESP32-S3 / C3) — flashed via arduino-cli/esptool.
  {
    vendorId: '303a',
    boardId: 'esp32s3',
    family: 'esp',
    confidence: 'high',
    label: 'Espressif USB nativo (ESP32-S3/C3)',
    reason: 'VID 303a (Espressif) ? flash with arduino-cli/esptool, not avrdude.'
  },
  // CH340/CH341 (WCH) — overwhelmingly Nano clones (328P), but also many ESP32
  // dev boards. Default to the 328P Nano path and let baud auto-retry handle the
  // old/new Optiboot speed; note the ESP possibility.
  {
    vendorId: '1a86',
    boardId: 'nano',
    family: 'avr328',
    confidence: 'medium',
    label: 'CH340 clone (likely Nano 328P)',
    reason: 'VID 1a86 (CH340) ? typical Nano clone (328P, stk500). It may also be an ESP32 with CH340.'
  },
  // FTDI FT232 — older Nano/Uno (328P) and Pro Micro breakouts.
  {
    vendorId: '0403',
    boardId: 'nano',
    family: 'avr328',
    confidence: 'medium',
    label: 'FTDI adapter (likely Nano/Uno 328P)',
    reason: 'VID 0403 (FTDI) — comum em Nano/Uno antigos (328P, stk500).'
  },
  // Silicon Labs CP210x — common on ESP32 dev boards (and some 328 clones).
  {
    vendorId: '10c4',
    boardId: 'esp32',
    family: 'esp',
    confidence: 'low',
    label: 'Silicon Labs CP210x (likely ESP32)',
    reason: 'VID 10c4 (CP210x) ? common on ESP32 DevKit. Some 328P clones also use it; confirm the model.'
  }
]

const NAME_BOARD_PATTERNS: Array<{ pattern: RegExp; boardId: FlashBoardId; family: FlashMcuFamily; label: string; reason: string }> = [
  {
    pattern: /pro\s*micro|leonardo|micro|atmega32u4|32u4|caterina/i,
    boardId: 'pro-micro',
    family: 'avr32u4',
    label: 'Placa 32U4 (Pro Micro/Leonardo)',
    reason: 'Nome USB sugere 32U4 — grave com avr109 + reset 1200bps.'
  },
  {
    pattern: /esp32-?s3|esp32s3/i,
    boardId: 'esp32s3',
    family: 'esp',
    label: 'ESP32-S3',
    reason: 'Nome USB sugere ESP32-S3 — grave por arduino-cli.'
  },
  {
    pattern: /esp32|esp-?wroom|espressif/i,
    boardId: 'esp32',
    family: 'esp',
    label: 'ESP32',
    reason: 'Nome USB sugere ESP32 — grave por arduino-cli.'
  },
  {
    pattern: /\buno\b/i,
    boardId: 'uno',
    family: 'avr328',
    label: 'Arduino Uno (328P)',
    reason: 'Nome USB sugere Uno — programmer arduino (stk500).'
  },
  {
    pattern: /\bnano\b|ch340|ch341/i,
    boardId: 'nano',
    family: 'avr328',
    label: 'Arduino Nano (328P)',
    reason: 'Nome USB sugere Nano/CH340 — programmer arduino (stk500), tente 115200 e 57600.'
  }
]

// Best-effort board-family guess from a USB descriptor. Returns null when the
// descriptor carries no usable hint (then the user picks the board manually).
export function guessFlashBoardFromUsb(desc: UsbDescriptorLike | undefined): FlashBoardGuess | null {
  if (!desc) return null
  const vid = normalizeUsbId(desc.vendorId)
  const pid = normalizeUsbId(desc.productId)

  if (vid) {
    // VID+PID exact match first (disambiguates Arduino 32U4 vs 328P).
    const exact = BOARD_USB_SIGNATURES.find(
      (sig) => sig.vendorId === vid && sig.productIds?.includes(pid)
    )
    const match = exact ?? BOARD_USB_SIGNATURES.find((sig) => sig.vendorId === vid && !sig.productIds)
    if (match) {
      return {
        boardId: match.boardId,
        family: match.family,
        label: match.label,
        confidence: match.confidence,
        reason: match.reason,
        needsAvr109: match.family === 'avr32u4'
      }
    }
  }

  const text = [desc.friendlyName, desc.manufacturer].filter(Boolean).join(' ')
  if (text) {
    const named = NAME_BOARD_PATTERNS.find((entry) => entry.pattern.test(text))
    if (named) {
      return {
        boardId: named.boardId,
        family: named.family,
        label: named.label,
        confidence: 'low',
        reason: named.reason,
        needsAvr109: named.family === 'avr32u4'
      }
    }
  }

  return null
}

// ─── Module catalog ───────────────────────────────────────────────────────────
// Start with the iFlag 8x8 RGB Matrix (the requested happy path). The structure
// is generic so RGB strip / screen / 7-seg modules are pure catalog additions:
// add a `SetupModule` with its `componentType`, expected `capabilityKey`, the
// per-board `.hex`, and the default pin map. `status:'soon'` entries render as
// roadmap cards (not flashable yet) so the wizard already shows the full menu.

export interface WiringStep {
  // Signal silk-screen label on the module, e.g. "DIN".
  signal: string
  // Arduino pin it connects to, e.g. "D6".
  pin: string
  detail?: string
}

export interface SetupModuleFirmware {
  board: FlashBoardId
  // Filename under resources/firmware (resolved to an absolute path in main).
  hex: string
  // ESP32 source sketch folder, used by arduino-cli flows outside the AVR wizard.
  sketch?: string
  recommended?: boolean
}

export type SetupDifficulty = 'easy' | 'medium' | 'advanced'

export interface SetupModule {
  id: string
  name: string
  tagline: string
  description: string
  // The Hardware Hub component this module creates after a verified flash.
  componentType: ComponentType
  // Capability key the companion firmware reports to the `?` handshake.
  capabilityKey: string
  // Optional detail substring to match (e.g. "8x8"); empty = key match is enough.
  capabilityDetail?: string
  difficulty: SetupDifficulty
  parts: string[]
  wiring: WiringStep[]
  powerNote?: string
  firmwares: SetupModuleFirmware[]
  recommendedBoard: FlashBoardId
  // Optional baud-option id (within recommendedBoard.baudOptions) to preselect
  // for this module, overriding the board's generic defaultBaudId. Used when a
  // module is known to ship on a specific bootloader — e.g. the iFlag Nano uses
  // the old/57600 Optiboot. Ignored if the selected board lacks that option.
  recommendedBaudId?: string
  // Default role→pin map applied to the auto-created component.
  defaultPins: Record<string, string>
  // 'available' = flashable now; 'soon' = roadmap card (no firmware yet).
  status: 'available' | 'soon'
  wifiCapable?: boolean
  transport?: 'serial' | 'wifi' | 'both'
}

export const SETUP_MODULES: SetupModule[] = [
  {
    id: 'iflag-matrix-8x8',
    name: 'iFlag · Matriz RGB 8x8',
    tagline: 'Flags, gear, spotter, and icons on a 64-LED WS2812B matrix',
    description:
      'WS2812B 8x8 addressable LED matrix mounted on the front of the steering wheel. Shows race flags, current gear, spotter alerts, and start animations. It is the easiest module to begin with.',
    componentType: 'rgbMatrix',
    capabilityKey: 'rgbMatrix',
    capabilityDetail: '8x8',
    difficulty: 'easy',
    parts: [
      'Matriz WS2812B 8x8 (64 LEDs)',
      'Arduino Nano, Uno ou Pro Micro',
      'Cabo USB de dados',
      '(brilho alto) fonte 5V externa + GND comum'
    ],
    wiring: [
      { signal: 'DIN', pin: 'D6', detail: 'Matrix data input' },
      { signal: '5V', pin: '5V', detail: '5V power (use VIN/5V)' },
      { signal: 'GND', pin: 'GND', detail: 'Terra comum entre Arduino e matrix' }
    ],
    powerNote:
      '64 LEDs at maximum brightness can draw ~3.8 A. On USB keep brightness ? ~120; for high brightness use an external 5V supply and tie GND to the Arduino.',
    firmwares: [
      { board: 'nano', hex: 'iflag-nano.hex', recommended: true },
      { board: 'uno', hex: 'iflag-uno.hex' },
      { board: 'pro-micro', hex: 'iflag-micro.hex' }
    ],
    recommendedBoard: 'nano',
    // The iFlag panels ship on Nano clones with the OLD Optiboot (57600). The
    // flasher still auto-retries 115200, but preselecting 'old' makes the first
    // attempt succeed without the user touching the bootloader dropdown.
    recommendedBaudId: 'old',
    defaultPins: { data: 'D6' },
    status: 'available'
  },
  // ─── Roadmap (structure-ready; firmware to be added) ────────────────────────
  {
    id: 'ws2812-revlights',
    name: 'Rev Lights (fita WS2812)',
    tagline: 'RPM bar + gear shift flash on an addressable strip',
    description:
      'WS2812/SK6812 strip for F1-style rev lights: green→yellow→red gradient by RPM and blue flash at the shift point. Uses the same P/Y companion protocol.',
    componentType: 'rgbStrip',
    capabilityKey: 'rgbStrip',
    difficulty: 'easy',
    parts: ['WS2812B strip (8–16 LEDs)', 'Arduino Nano/Uno/Pro Micro', '470 Ω resistor on the data line (optional)'],
    wiring: [
      { signal: 'DIN', pin: 'D6', detail: 'Strip data in' },
      { signal: '5V', pin: '5V' },
      { signal: 'GND', pin: 'GND' }
    ],
    powerNote: 'Adicione um resistor de ~470 Ω na linha de dados e um capacitor de 1000µF se a fita piscar.',
    firmwares: [
      { board: 'nano', hex: 'rgbstrip-nano.hex', recommended: true },
      { board: 'uno', hex: 'rgbstrip-uno.hex' },
      { board: 'pro-micro', hex: 'rgbstrip-micro.hex' }
    ],
    recommendedBoard: 'nano',
    defaultPins: { data: 'D6' },
    status: 'available'
  },
  {
    id: 'ssd1306-oled',
    name: 'SSD1306 OLED Display',
    tagline: 'Telemetry pages (gear, delta, fuel) on a 0.96" OLED',
    description:
      "SSD1306 128x64 I2C OLED with telemetry pages. Reuses the app's existing OLED page engine.",
    componentType: 'screen',
    capabilityKey: 'screen',
    capabilityDetail: 'oled',
    difficulty: 'medium',
    parts: ['OLED SSD1306 I2C 128x64', 'Arduino Uno/Nano/Mega'],
    wiring: [
      { signal: 'SDA', pin: 'A4', detail: 'Uno/Nano: A4' },
      { signal: 'SCL', pin: 'A5', detail: 'Uno/Nano: A5' },
      { signal: 'VCC', pin: '5V' },
      { signal: 'GND', pin: 'GND' }
    ],
    firmwares: [
      { board: 'nano', hex: 'oled-nano.hex', recommended: true },
      { board: 'uno', hex: 'oled-uno.hex' }
    ],
    recommendedBoard: 'uno',
    defaultPins: { sda: 'A4', scl: 'A5' },
    status: 'available'
  },
  {
    id: 'controls-hid',
    name: 'Buttons + Encoders (HID)',
    tagline: 'Button box reconhecido como joystick pelo jogo (Pro Micro/Leonardo)',
    description:
      'HID firmware for buttons and encoders: the game sees the board as a joystick. Available only on 32U4 boards (Pro Micro/Leonardo).',
    componentType: 'control',
    capabilityKey: 'control',
    difficulty: 'advanced',
    parts: ['Momentary buttons / EC11 encoders', 'Arduino Pro Micro or Leonardo (32U4)'],
    wiring: [{ signal: 'BTN', pin: 'D2…', detail: 'Button entre o pino e GND (pull-up interno)' }],
    firmwares: [{ board: 'pro-micro', hex: 'controls-micro.hex', recommended: true }],
    recommendedBoard: 'pro-micro',
    defaultPins: {},
    status: 'available'
  },
  {
    id: 'hd44780-lcd',
    name: 'LCD de caracteres (HD44780 I2C)',
    tagline: '16x2 / 20x4 text displays with telemetry pages',
    description:
      'Character LCD with I2C backpack (PCF8574). Shows text telemetry pages. Default I2C address 0x27 (some modules use 0x3F).',
    componentType: 'screen',
    capabilityKey: 'screen',
    capabilityDetail: 'lcd',
    difficulty: 'easy',
    parts: ['LCD 16x2 ou 20x4 com backpack I2C', 'Arduino Nano/Uno'],
    wiring: [
      { signal: 'SDA', pin: 'A4', detail: 'Uno/Nano: A4' },
      { signal: 'SCL', pin: 'A5', detail: 'Uno/Nano: A5' },
      { signal: 'VCC', pin: '5V' },
      { signal: 'GND', pin: 'GND' }
    ],
    firmwares: [
      { board: 'nano', hex: 'lcd-nano.hex', recommended: true },
      { board: 'uno', hex: 'lcd-uno.hex' }
    ],
    recommendedBoard: 'nano',
    defaultPins: { sda: 'A4', scl: 'A5' },
    status: 'available'
  },
  {
    id: 'tm1638-7seg',
    name: 'Display 7-seg (TM1638)',
    tagline: 'Gear, speed, RPM, or lap on a TM1638 module (8 digits)',
    description:
      'TM1638 module with 8 seven-segment digits (+ 8 buttons and 8 LEDs). Shows gear/speed/RPM/lap based on the selected component metric.',
    componentType: 'segDisplay',
    capabilityKey: 'segDisplay',
    capabilityDetail: 'tm1638',
    difficulty: 'easy',
    parts: ['TM1638 module (LED&KEY)', 'Arduino Nano/Uno/Pro Micro'],
    wiring: [
      { signal: 'STB', pin: 'D7' },
      { signal: 'CLK', pin: 'D9' },
      { signal: 'DIO', pin: 'D8' },
      { signal: 'VCC', pin: '5V' },
      { signal: 'GND', pin: 'GND' }
    ],
    firmwares: [
      { board: 'nano', hex: 'seg-nano.hex', recommended: true },
      { board: 'uno', hex: 'seg-uno.hex' },
      { board: 'pro-micro', hex: 'seg-micro.hex' }
    ],
    recommendedBoard: 'nano',
    defaultPins: { stb: 'D7', clk: 'D9', dio: 'D8' },
    status: 'available'
  },
  {
    id: 'servo-gauge',
    name: 'Ponteiro analog (servo)',
    tagline: 'Physical speed/RPM/fuel gauge with SG90 servo',
    description:
      'Up to 4 servos as analog needles. The app maps the selected metric (speed, RPM, fuel?) to the servo angle.',
    componentType: 'gauge',
    capabilityKey: 'gauge',
    difficulty: 'medium',
    parts: ['SG90 servo(s) (up to 4)', 'Arduino Nano/Uno/Pro Micro', '5V supply for the servos'],
    wiring: [
      { signal: 'SIG0', pin: 'D3', detail: 'Servo 0 signal' },
      { signal: 'SIG1', pin: 'D5', detail: 'Servo 1 (optional)' },
      { signal: 'V+', pin: '5V', detail: 'Use an external 5V supply for multiple servos' },
      { signal: 'GND', pin: 'GND' }
    ],
    powerNote: 'Servos puxam corrente; com mais de 1, alimente por fonte 5V externa com GND comum.',
    firmwares: [
      { board: 'nano', hex: 'gauge-nano.hex', recommended: true },
      { board: 'uno', hex: 'gauge-uno.hex' },
      { board: 'pro-micro', hex: 'gauge-micro.hex' }
    ],
    recommendedBoard: 'nano',
    defaultPins: { signal: 'D3' },
    status: 'available'
  },
  {
    id: 'piezo-buzzer',
    name: 'Buzzer (alertas sonoros)',
    tagline: 'Bipes de alerta (pit, flag, shift) por um piezo',
    description:
      'Buzzer piezo para alertas sonoros disparados pelo motor de Alertas (pit limiter, flag, shift, low fuel…).',
    componentType: 'buzzer',
    capabilityKey: 'buzzer',
    difficulty: 'easy',
    parts: ['Buzzer piezo', 'Arduino Nano/Uno/Pro Micro'],
    wiring: [
      { signal: '+', pin: 'D8', detail: 'Sinal (tone)' },
      { signal: '-', pin: 'GND' }
    ],
    firmwares: [
      { board: 'nano', hex: 'buzzer-nano.hex', recommended: true },
      { board: 'uno', hex: 'buzzer-uno.hex' },
      { board: 'pro-micro', hex: 'buzzer-micro.hex' }
    ],
    recommendedBoard: 'nano',
    defaultPins: { signal: 'D8' },
    status: 'available'
  },
  {
    id: 'esp32-companion-wifi',
    name: 'ESP32 Companion Wi‑Fi',
    tagline: 'ButtonBox via USB ou Wi‑Fi com ESP32/ESP32‑S3',
    description:
      'Firmware companion para ESP32 que fala o mesmo protocolo serial por USB e por TCP na rede local. Use USB para gravar/provisionar SSID e depois conecte via Wi‑Fi.',
    componentType: 'control',
    capabilityKey: 'wifi',
    capabilityDetail: 'esp32',
    difficulty: 'medium',
    parts: [
      'ESP32 DevKit ou ESP32‑S3 WROOM‑1 Type‑C',
      'Cabo USB de dados para provisionamento',
      'Rede Wi‑Fi 2.4 GHz no mesmo LAN do PC'
    ],
    wiring: [
      { signal: 'USB', pin: 'Type?C/Micro?USB', detail: 'Flashing, serial, and Wi?Fi provisioning' },
      { signal: 'GPIO', pin: 'Configurable GPIO', detail: 'Buttons/LEDs based on the companion sketch' },
      { signal: 'GND', pin: 'GND', detail: 'Common ground with external modules' }
    ],
    powerNote:
      'Wi‑Fi aumenta o consumo. Para fitas/matrixes de LED, use fonte externa adequada e GND comum.',
    firmwares: [
      { board: 'esp32s3', hex: 'companion-esp32', sketch: 'firmware/companion-esp32', recommended: true },
      { board: 'esp32', hex: 'companion-esp32', sketch: 'firmware/companion-esp32' }
    ],
    recommendedBoard: 'esp32s3',
    defaultPins: {},
    status: 'soon',
    wifiCapable: true,
    transport: 'both'
  }
]

export function findSetupModule(id: string): SetupModule | null {
  return SETUP_MODULES.find((module) => module.id === id) ?? null
}

export function findModuleFirmware(module: SetupModule, board: FlashBoardId): SetupModuleFirmware | null {
  return module.firmwares.find((firmware) => firmware.board === board) ?? null
}

export function moduleSupportsBoard(module: SetupModule, board: FlashBoardId): boolean {
  return module.firmwares.some((firmware) => firmware.board === board)
}

// ─── Flash request / progress / result ────────────────────────────────────────

export interface FlashRequest {
  moduleId: string
  board: FlashBoardId
  port: string
  // Optional baud variant id (e.g. Nano "old" bootloader). Defaults per board.
  baudId?: string
  replaceSerialIdentity?: boolean
  replacementReason?: string
}

export type FlashPhase =
  | 'prepare'
  | 'reset'
  | 'upload'
  | 'verify'
  | 'capabilities'
  | 'profile'
  | 'done'
  | 'error'

export interface FlashProgress {
  phase: FlashPhase
  message: string
  // Best-effort 0..100 for the progress bar.
  percent?: number
  // Raw avrdude / handshake line for the live log.
  line?: string
  tone?: 'info' | 'success' | 'error'
}

export interface DetectedCapability {
  key: string
  detail: string
}

export interface FlashResult {
  // True when avrdude reported success (the bytes were written).
  ok: boolean
  // True only when the post-flash `?` handshake confirmed the expected capability.
  verified: boolean
  message: string
  port: string
  board: FlashBoardId
  capabilities: DetectedCapability[]
  // Set when a Hardware Hub profile was auto-created.
  profileId?: string
  // Live serial-hub device id the profile is linked to (when kept connected).
  deviceId?: string
}

// ─── Command preview (transparency — "show the exact command") ────────────────
// Pure helper the wizard renders in an expandable panel so power users can see
// exactly what runs. The bootloader port is unknown until reset for 32U4, hence
// the placeholder.

export function buildAvrdudeCommandPreview(
  board: FlashBoardSpec,
  port: string,
  baud: number,
  hexFile: string
): string[] {
  if (board.flashTool === 'arduino-cli' || board.programmer === 'arduino-cli') {
    const fqbn = board.fqbn ?? '<fqbn>'
    return [
      `arduino-cli core install esp32:esp32`,
      `arduino-cli compile --fqbn ${fqbn} ${hexFile}`,
      `arduino-cli upload -p ${port || '<porta-serial>'} --fqbn ${fqbn} ${hexFile}`
    ]
  }
  const lines: string[] = []
  const targetPort = board.needs1200Touch ? '<porta-bootloader>' : port || '<COMx>'
  if (board.needs1200Touch) {
    lines.push(`# 1) toque de reset 1200bps em ${port || '<COMx>'} (entra no bootloader Caterina)`)
  }
  const args = ['-C', 'avrdude.conf', '-c', board.programmer, '-p', board.mcu, '-P', targetPort, '-b', String(baud)]
  if (board.programmer === 'arduino') args.push('-D')
  args.push('-U', `flash:w:${hexFile}:i`)
  lines.push(`avrdude ${args.join(' ')}`)
  return lines
}
