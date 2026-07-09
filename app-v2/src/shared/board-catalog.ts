import type { BoardId, ComponentType } from './devices'

export type KnownPinoutBoardId =
  | 'uno'
  | 'uno-r4-minima'
  | 'uno-r4-wifi'
  | 'nano'
  | 'nano-every'
  | 'nano-33-iot'
  | 'pro-mini-3v3'
  | 'pro-mini-5v'
  | 'promicro'
  | 'leonardo'
  | 'micro'
  | 'mega'
  | 'due'
  | 'zero'
  | 'mkr-wifi-1010'
  | 'mkr-zero'
  | 'mkr1000'
  | 'mkr-wan-1310'
  | 'mkr-gsm-1400'
  | 'mkr-nb-1500'
  | 'esp32'
  | 'esp32s2'
  | 'esp32s3'
  | 'esp32c3'
  | 'esp8266-nodemcu'
  | 'esp8266-d1-mini'
  | 'teensy40'
  | 'teensy41'
  | 'pico'

// User-defined ("custom") boards live alongside the built-in catalog and use
// free-form ids (e.g. `custom-board-xxxx`). Keeping the literal union for
// autocomplete while widening to `string` lets a PinoutDesign reference either a
// built-in board or a user-created one without losing type safety elsewhere.
export type PinoutBoardId = KnownPinoutBoardId | (string & {})

export type PinCapability = 'digital' | 'analogIn' | 'pwm' | 'i2c' | 'spi' | 'uart' | 'interrupt' | 'power' | 'ground'
export type SpiRole = 'mosi' | 'miso' | 'sck' | 'ss'
export type PinoutComponentCategory = 'Lights' | 'Screens' | 'Sound' | 'Haptics' | 'Inputs' | 'Sensors' | 'Motors' | 'Power' | 'Comms' | 'Expanders / Mux' | 'Custom'
export type PowerRail = '5V' | '3V3' | 'VIN' | 'GND'

export interface BoardPinCapability {
  pin: string
  digital: boolean
  analogIn: boolean
  pwm: boolean
  i2c?: 'sda' | 'scl'
  spi?: SpiRole
  uart?: 'rx' | 'tx'
  interrupt?: boolean
  power?: '5v' | '3v3' | 'vin' | 'gnd' | 'reset'
  notes?: string
}

export interface BoardCatalogEntry {
  id: PinoutBoardId
  deviceBoardId?: BoardId
  name: string
  mcu: string
  fqbn?: string
  lapge: '5V' | '3.3V' | '5V/3.3V'
  usbHid: boolean
  notes: string
  pins: BoardPinCapability[]
}

export type PinoutPinKind = 'digital' | 'analog' | 'pwm' | 'i2c' | 'spi' | 'uart' | 'power' | 'any' | 'channel'

// Electrical direction a board pin must take for a component role. Used by the
// generated firmware to pick the right pinMode() instead of forcing INPUT_PULLUP.
export type PinDirection = 'input' | 'output' | 'i2c' | 'analog'

export interface PinoutComponentRole {
  role: string
  label: string
  kind: Exclude<PinoutPinKind, 'channel'>
  optional?: boolean
  muxCapable?: boolean
  count?: number
  rolePrefix?: string
  // User-declared electrical direction for custom components. Built-in
  // components leave this undefined and rely on getRolePinDirection heuristics;
  // custom components set it so the generated firmware emits the right pinMode().
  direction?: 'input' | 'output' | 'bidir'
}

export interface PinoutComponentDefinition {
  id: string
  type: ComponentType | 'multiplexer' | 'expander' | 'actuator' | 'power' | 'comms' | 'custom'
  name: string
  shortName: string
  description: string
  plainLanguageDescription: string
  category: PinoutComponentCategory
  icon: string
  iconHint: string
  defaultLabel: string
  roles: PinoutComponentRole[]
  defaults?: Record<string, string | number | boolean>
  protocolKey: string
  power: PowerRail[]
  defaultWiringNotes: string[]
  tips?: string[]
  requiresNativeUsbHid?: boolean
  exportOnly?: boolean
}

function p(
  pin: string,
  opts: Partial<Omit<BoardPinCapability, 'pin' | 'digital' | 'analogIn' | 'pwm'>> & {
    digital?: boolean
    analogIn?: boolean
    pwm?: boolean
  } = {}
): BoardPinCapability {
  return {
    pin,
    digital: opts.digital ?? true,
    analogIn: opts.analogIn ?? false,
    pwm: opts.pwm ?? false,
    i2c: opts.i2c,
    spi: opts.spi,
    interrupt: opts.interrupt,
    power: opts.power,
    notes: opts.notes
  }
}

function powerPins(include3v3 = true, include5v = true): BoardPinCapability[] {
  return [
    ...(include5v ? [p('5V', { digital: false, power: '5v', notes: '5V power rail.' })] : []),
    ...(include3v3 ? [p('3V3', { digital: false, power: '3v3', notes: '3.3V power rail; check current limits.' })] : []),
    p('VIN', { digital: false, power: 'vin', notes: 'Raw/VIN input; not a signal pin.' }),
    p('GND', { digital: false, power: 'gnd', notes: 'Ground. All modules must share GND.' }),
    p('RST', { digital: false, power: 'reset', notes: 'Reset pin; not for normal signals.' })
  ]
}

function avrDigital(max: number, pwmPins: string[], interruptPins: string[], spi: Record<string, SpiRole> = {}, notes: Record<string, string> = {}): BoardPinCapability[] {
  const pins: BoardPinCapability[] = []
  for (let i = 0; i <= max; i += 1) {
    const pin = `D${i}`
    pins.push(p(pin, { pwm: pwmPins.includes(pin), interrupt: interruptPins.includes(pin), spi: spi[pin], notes: notes[pin] }))
  }
  return pins
}

function avrAnalog(count: number, i2c: Record<string, 'sda' | 'scl'> = {}, digitalCount = count, notes: Record<string, string> = {}): BoardPinCapability[] {
  const pins: BoardPinCapability[] = []
  for (let i = 0; i < count; i += 1) {
    const pin = `A${i}`
    const digital = i < digitalCount
    pins.push(p(pin, { digital, analogIn: true, i2c: i2c[pin], notes: notes[pin] ?? (digital ? 'Can also be used as a digital pin.' : 'Analog input only.') }))
  }
  return pins
}

function samdDigital(max: number, pwmPins: string[], interruptPins: string[], spi: Record<string, SpiRole> = {}, i2c: Record<string, 'sda' | 'scl'> = {}, notes: Record<string, string> = {}): BoardPinCapability[] {
  return avrDigital(max, pwmPins, interruptPins, spi, notes).map((pin) => ({ ...pin, i2c: i2c[pin.pin] ?? pin.i2c }))
}

function gpioRange(start: number, end: number, opts: (gpio: number) => Partial<BoardPinCapability> = () => ({})): BoardPinCapability[] {
  const pins: BoardPinCapability[] = []
  for (let gpio = start; gpio <= end; gpio += 1) pins.push(p(`GPIO${gpio}`, opts(gpio)))
  return pins
}

function uniquePins(pins: BoardPinCapability[]): BoardPinCapability[] {
  return pins.filter((pin, index, list) => list.findIndex((item) => item.pin === pin.pin) === index)
}

function withUart(pins: BoardPinCapability[], rxPins: string[], txPins: string[]): BoardPinCapability[] {
  return pins.map((pin) => rxPins.includes(pin.pin) ? { ...pin, uart: 'rx' as const } : txPins.includes(pin.pin) ? { ...pin, uart: 'tx' as const } : pin)
}

const unoDigital = withUart(avrDigital(13, ['D3', 'D5', 'D6', 'D9', 'D10', 'D11'], ['D2', 'D3'], { D10: 'ss', D11: 'mosi', D12: 'miso', D13: 'sck' }, { D0: 'USB serial RX; avoid for normal inputs.', D1: 'USB serial TX; avoid for normal inputs.', D13: 'On-board LED and SPI SCK.' }), ['D0'], ['D1'])
const unoAnalog = avrAnalog(6, { A4: 'sda', A5: 'scl' })

const atmega32u4Digital = [
  p('D0', { interrupt: true, uart: 'rx', notes: 'RX Serial1; avoid if using hardware serial.' }),
  p('D1', { interrupt: true, uart: 'tx', notes: 'TX Serial1; avoid if using hardware serial.' }),
  p('D2', { i2c: 'sda', interrupt: true, notes: 'SDA for I2C screens/expanders.' }),
  p('D3', { pwm: true, i2c: 'scl', interrupt: true, notes: 'SCL for I2C; also PWM.' }),
  p('D4'), p('D5', { pwm: true }), p('D6', { pwm: true }), p('D7'), p('D8'), p('D9', { pwm: true }), p('D10', { pwm: true }), p('D11', { pwm: true }), p('D12'), p('D13', { pwm: true, notes: 'On-board LED on many boards.' }),
  p('D14', { spi: 'miso' }), p('D15', { spi: 'sck' }), p('D16', { spi: 'mosi' })
]

const atmega32u4Analog = [
  p('A0', { analogIn: true }), p('A1', { analogIn: true }), p('A2', { analogIn: true }), p('A3', { analogIn: true }),
  p('A4', { analogIn: true }), p('A5', { analogIn: true }), p('A6', { analogIn: true }), p('A7', { analogIn: true }),
  p('A8', { analogIn: true }), p('A9', { analogIn: true }), p('A10', { analogIn: true }), p('A11', { analogIn: true })
]

const samd21Analog = avrAnalog(6, {}, 6)
const zeroDigital = samdDigital(13, ['D3', 'D4', 'D5', 'D6', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13'], Array.from({ length: 14 }, (_, i) => `D${i}`), { D10: 'ss', D11: 'mosi', D12: 'miso', D13: 'sck' }, { D20: 'sda', D21: 'scl' })
const zeroPins = withUart([...zeroDigital, p('D20', { i2c: 'sda', interrupt: true, notes: 'SDA for I2C.' }), p('D21', { i2c: 'scl', interrupt: true, notes: 'SCL for I2C.' }), ...samd21Analog, ...powerPins()], ['D0'], ['D1'])

const mkrPins = withUart([
  ...samdDigital(14, ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D10', 'D11', 'D12', 'D14'], Array.from({ length: 15 }, (_, i) => `D${i}`), { D8: 'mosi', D9: 'sck', D10: 'miso' }, { D11: 'sda', D12: 'scl' }, { D13: 'On-board LED on many MKR boards.' }),
  ...avrAnalog(7),
  ...powerPins(true, false)
], ['D13'], ['D14'])

const nano33IotPins = withUart([
  ...samdDigital(13, ['D2', 'D3', 'D5', 'D6', 'D9', 'D10', 'D11', 'D12', 'D13'], Array.from({ length: 14 }, (_, i) => `D${i}`), { D10: 'ss', D11: 'mosi', D12: 'miso', D13: 'sck' }, {}, { D0: 'RX; avoid when using Serial1.', D1: 'TX; avoid when using Serial1.' }),
  ...avrAnalog(8, { A4: 'sda', A5: 'scl' }, 8),
  ...powerPins(true, false)
], ['D0'], ['D1'])

const esp32Pins = withUart([
  p('GPIO0', { pwm: true, interrupt: true, notes: 'Boot strap; avoid strong external pull-up/down.' }),
  p('GPIO1', { pwm: true, notes: 'USB serial TX0; use with care.' }),
  p('GPIO2', { pwm: true, interrupt: true, notes: 'Boot strap / LED on some boards.' }),
  p('GPIO3', { pwm: true, notes: 'USB serial RX0; use with care.' }),
  p('GPIO4', { analogIn: true, pwm: true, interrupt: true }), p('GPIO5', { pwm: true, interrupt: true, spi: 'ss', notes: 'Boot strap on some devkits.' }),
  p('GPIO12', { analogIn: true, pwm: true, interrupt: true, notes: 'Boot strap; can affect boot if pulled incorrectly.' }), p('GPIO13', { analogIn: true, pwm: true, interrupt: true }),
  p('GPIO14', { analogIn: true, pwm: true, interrupt: true, spi: 'sck' }), p('GPIO15', { analogIn: true, pwm: true, interrupt: true, notes: 'Boot strap.' }),
  p('GPIO16', { pwm: true, interrupt: true }), p('GPIO17', { pwm: true, interrupt: true }), p('GPIO18', { pwm: true, interrupt: true, spi: 'sck' }), p('GPIO19', { pwm: true, interrupt: true, spi: 'miso' }),
  p('GPIO21', { pwm: true, interrupt: true, i2c: 'sda', notes: 'Default SDA on most ESP32 DevKit boards.' }), p('GPIO22', { pwm: true, interrupt: true, i2c: 'scl', notes: 'Default SCL on most ESP32 DevKit boards.' }), p('GPIO23', { pwm: true, interrupt: true, spi: 'mosi' }),
  p('GPIO25', { analogIn: true, pwm: true, interrupt: true }), p('GPIO26', { analogIn: true, pwm: true, interrupt: true }), p('GPIO27', { analogIn: true, pwm: true, interrupt: true }),
  p('GPIO32', { analogIn: true, pwm: true, interrupt: true }), p('GPIO33', { analogIn: true, pwm: true, interrupt: true }),
  p('GPIO34', { digital: false, analogIn: true, notes: 'Input only; good for analog sensors.' }), p('GPIO35', { digital: false, analogIn: true, notes: 'Input only; good for analog sensors.' }), p('GPIO36', { digital: false, analogIn: true, notes: 'Input only (VP).' }), p('GPIO39', { digital: false, analogIn: true, notes: 'Input only (VN).' }),
  p('3V3', { digital: false, power: '3v3' }), p('VIN', { digital: false, power: 'vin' }), p('GND', { digital: false, power: 'gnd' })
], ['GPIO3', 'GPIO16'], ['GPIO1', 'GPIO17'])

const esp32s2Pins = [
  ...gpioRange(0, 21, (gpio) => ({ analogIn: gpio <= 20, pwm: true, interrupt: true, i2c: gpio === 8 ? 'sda' : gpio === 9 ? 'scl' : undefined, spi: gpio === 34 ? 'miso' : gpio === 35 ? 'mosi' : gpio === 36 ? 'sck' : undefined, notes: [0, 45, 46].includes(gpio) ? 'Boot strap / special pin; verify your board silkscreen.' : undefined })),
  ...gpioRange(33, 46, (gpio) => ({ pwm: true, interrupt: true, spi: gpio === 34 ? 'miso' : gpio === 35 ? 'mosi' : gpio === 36 ? 'sck' : gpio === 37 ? 'ss' : undefined, notes: [45, 46].includes(gpio) ? 'Boot strap / special pin; use with care.' : undefined })),
  p('3V3', { digital: false, power: '3v3' }), p('5V', { digital: false, power: '5v' }), p('GND', { digital: false, power: 'gnd' })
]

const esp32s3Pins = withUart(uniquePins([
  ...gpioRange(1, 18, (gpio) => ({ analogIn: true, pwm: true, interrupt: true, i2c: gpio === 8 ? 'sda' : gpio === 9 ? 'scl' : undefined })),
  p('GPIO21', { pwm: true, interrupt: true }),
  ...gpioRange(35, 44, (gpio) => ({ pwm: true, interrupt: true, spi: gpio === 39 ? 'miso' : gpio === 40 ? 'mosi' : gpio === 41 ? 'sck' : gpio === 42 ? 'ss' : undefined, notes: gpio === 43 ? 'UART0 TX on many boards; use with care.' : gpio === 44 ? 'UART0 RX on many boards; use with care.' : undefined })),
  p('3V3', { digital: false, power: '3v3' }), p('5V', { digital: false, power: '5v' }), p('GND', { digital: false, power: 'gnd' })
]), ['GPIO44'], ['GPIO43'])

const esp32c3Pins = withUart([
  ...gpioRange(0, 10, (gpio) => ({ analogIn: gpio <= 4, pwm: true, interrupt: true, i2c: gpio === 8 ? 'sda' : gpio === 9 ? 'scl' : undefined, spi: gpio === 5 ? 'sck' : gpio === 6 ? 'miso' : gpio === 7 ? 'mosi' : gpio === 10 ? 'ss' : undefined, notes: [2, 8, 9].includes(gpio) ? 'Boot strap on many ESP32-C3 boards; use with care.' : undefined })),
  p('GPIO18', { pwm: true, interrupt: true, notes: 'USB D- on native USB boards; avoid if USB is active.' }), p('GPIO19', { pwm: true, interrupt: true, notes: 'USB D+ on native USB boards; avoid if USB is active.' }), p('GPIO20', { pwm: true, interrupt: true, notes: 'UART RX on many boards.' }), p('GPIO21', { pwm: true, interrupt: true, notes: 'UART TX on many boards.' }),
  p('3V3', { digital: false, power: '3v3' }), p('5V', { digital: false, power: '5v' }), p('GND', { digital: false, power: 'gnd' })
], ['GPIO20'], ['GPIO21'])

const esp8266NodeMcuPins = withUart([
  p('D0', { pwm: true, notes: 'GPIO16; no normal external interrupt.' }), p('D1', { pwm: true, interrupt: true, i2c: 'scl', notes: 'GPIO5; common SCL.' }), p('D2', { pwm: true, interrupt: true, i2c: 'sda', notes: 'GPIO4; common SDA.' }),
  p('D3', { pwm: true, interrupt: true, notes: 'GPIO0 boot strap; use with care.' }), p('D4', { pwm: true, interrupt: true, notes: 'GPIO2 boot strap / built-in LED.' }), p('D5', { pwm: true, interrupt: true, spi: 'sck', notes: 'GPIO14 SPI SCK.' }),
  p('D6', { pwm: true, interrupt: true, spi: 'miso', notes: 'GPIO12 SPI MISO.' }), p('D7', { pwm: true, interrupt: true, spi: 'mosi', notes: 'GPIO13 SPI MOSI.' }), p('D8', { pwm: true, interrupt: true, spi: 'ss', notes: 'GPIO15 boot strap / SPI SS; use with care.' }),
  p('RX', { notes: 'GPIO3 UART RX; avoid if serial console is active.' }), p('TX', { notes: 'GPIO1 UART TX; avoid if serial console is active.' }), p('A0', { digital: false, analogIn: true, notes: 'Single analog input; many dev boards scale it to 0-3.3V.' }),
  p('3V3', { digital: false, power: '3v3' }), p('5V', { digital: false, power: '5v' }), p('GND', { digital: false, power: 'gnd' })
], ['RX'], ['TX'])

const teensy40Pins = withUart([
  ...Array.from({ length: 24 }, (_, i) => p(`D${i}`, { pwm: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 15, 18, 19, 22, 23].includes(i), interrupt: true, i2c: i === 18 ? 'sda' : i === 19 ? 'scl' : undefined, spi: i === 10 ? 'ss' : i === 11 ? 'mosi' : i === 12 ? 'miso' : i === 13 ? 'sck' : undefined })),
  ...Array.from({ length: 14 }, (_, i) => p(`A${i}`, { analogIn: true, digital: true, pwm: [0, 1, 2, 3, 6, 7, 8, 9].includes(i), notes: 'Teensy analog input; also maps to a numbered digital pin.' })),
  p('3V3', { digital: false, power: '3v3' }), p('VIN', { digital: false, power: 'vin' }), p('GND', { digital: false, power: 'gnd' })
], ['D0'], ['D1'])

const teensy41Pins = withUart([
  ...Array.from({ length: 42 }, (_, i) => p(`D${i}`, { pwm: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 15, 18, 19, 22, 23, 24, 25, 28, 29, 33, 36, 37].includes(i), interrupt: true, i2c: i === 18 ? 'sda' : i === 19 ? 'scl' : undefined, spi: i === 10 ? 'ss' : i === 11 ? 'mosi' : i === 12 ? 'miso' : i === 13 ? 'sck' : undefined })),
  ...Array.from({ length: 18 }, (_, i) => p(`A${i}`, { analogIn: true, digital: true, notes: 'Teensy 4.1 analog-capable pin; verify the printed pin card.' })),
  p('3V3', { digital: false, power: '3v3' }), p('VIN', { digital: false, power: 'vin' }), p('GND', { digital: false, power: 'gnd' })
], ['D0'], ['D1'])

const picoPins = withUart([
  ...gpioRange(0, 22, (gpio) => ({ pwm: true, interrupt: true, i2c: gpio === 4 ? 'sda' : gpio === 5 ? 'scl' : undefined, spi: gpio === 16 ? 'miso' : gpio === 17 ? 'ss' : gpio === 18 ? 'sck' : gpio === 19 ? 'mosi' : undefined })),
  p('GPIO26', { analogIn: true, pwm: true, interrupt: true, notes: 'ADC0 / A0.' }), p('GPIO27', { analogIn: true, pwm: true, interrupt: true, notes: 'ADC1 / A1.' }), p('GPIO28', { analogIn: true, pwm: true, interrupt: true, notes: 'ADC2 / A2.' }),
  p('3V3', { digital: false, power: '3v3' }), p('VBUS', { digital: false, power: '5v', notes: 'USB 5V rail.' }), p('VSYS', { digital: false, power: 'vin', notes: 'Raw system input.' }), p('GND', { digital: false, power: 'gnd' })
], ['GPIO1'], ['GPIO0'])

export const BOARD_CATALOG: Record<KnownPinoutBoardId, BoardCatalogEntry> = {
  uno: { id: 'uno', deviceBoardId: 'uno', name: 'Arduino Uno R3', mcu: 'ATmega328P', fqbn: 'arduino:avr:uno', lapge: '5V', usbHid: false, notes: 'Beginner-friendly 5V board. D0/D1 are USB serial; prefer avoiding them. A4/A5 are the I2C bus.', pins: [...unoDigital, ...unoAnalog, ...powerPins()] },
  'uno-r4-minima': { id: 'uno-r4-minima', name: 'Arduino Uno R4 Minima', mcu: 'RA4M1', fqbn: 'arduino:renesas_uno:minima', lapge: '5V', usbHid: true, notes: 'Modern Uno-size board with 5V logic and native USB. Pin layout follows Uno R3; DAC/CAN features are not modeled here.', pins: [...unoDigital.map((pin) => ({ ...pin, interrupt: pin.digital || pin.interrupt })), ...unoAnalog, ...powerPins()] },
  'uno-r4-wifi': { id: 'uno-r4-wifi', name: 'Arduino Uno R4 WiFi', mcu: 'RA4M1', fqbn: 'arduino:renesas_uno:unor4wifi', lapge: '5V', usbHid: true, notes: 'Uno R4 with Wi-Fi coprocessor and LED matrix. Uses the same beginner pin labels as Uno R3 for shields and wiring.', pins: [...unoDigital.map((pin) => ({ ...pin, interrupt: pin.digital || pin.interrupt })), ...unoAnalog, ...powerPins()] },
  nano: { id: 'nano', deviceBoardId: 'nano', name: 'Arduino Nano', mcu: 'ATmega328P', fqbn: 'arduino:avr:nano', lapge: '5V', usbHid: false, notes: 'Tiny Uno-style board for compact boxes. A6/A7 are analog input only. A4/A5 are I2C.', pins: [...withUart(avrDigital(13, ['D3', 'D5', 'D6', 'D9', 'D10', 'D11'], ['D2', 'D3'], { D10: 'ss', D11: 'mosi', D12: 'miso', D13: 'sck' }), ['D0'], ['D1']), ...avrAnalog(8, { A4: 'sda', A5: 'scl' }, 6), ...powerPins()] },
  'nano-every': { id: 'nano-every', name: 'Arduino Nano Every', mcu: 'ATmega4809', fqbn: 'arduino:megaavr:nona4809', lapge: '5V', usbHid: false, notes: 'Modern Nano-sized board. D3/D5/D6/D9/D10 PWM, A4/A5 I2C. Good replacement for classic Nano.', pins: [...withUart(avrDigital(13, ['D3', 'D5', 'D6', 'D9', 'D10'], ['D2', 'D3']), ['D0'], ['D1']), ...avrAnalog(8, { A4: 'sda', A5: 'scl' }), ...powerPins()] },
  'nano-33-iot': { id: 'nano-33-iot', name: 'Arduino Nano 33 IoT', mcu: 'SAMD21G18A', fqbn: 'arduino:samd:nano_33_iot', lapge: '3.3V', usbHid: true, notes: 'Nano form factor with native USB, Wi-Fi and 3.3V logic. Do not feed 5V signals into GPIO pins.', pins: nano33IotPins },
  'pro-mini-3v3': { id: 'pro-mini-3v3', name: 'Arduino Pro Mini 3.3V / 8 MHz', mcu: 'ATmega328P', fqbn: 'arduino:avr:pro:cpu=8MHzatmega328', lapge: '3.3V', usbHid: false, notes: 'Small breadboard board without onboard USB. Needs an FTDI/USB-serial adapter for upload.', pins: [...unoDigital, ...unoAnalog, ...powerPins(true, false)] },
  'pro-mini-5v': { id: 'pro-mini-5v', name: 'Arduino Pro Mini 5V / 16 MHz', mcu: 'ATmega328P', fqbn: 'arduino:avr:pro:cpu=16MHzatmega328', lapge: '5V', usbHid: false, notes: 'Small 5V board without onboard USB. Needs an FTDI/USB-serial adapter for upload.', pins: [...unoDigital, ...unoAnalog, ...powerPins()] },
  promicro: { id: 'promicro', deviceBoardId: 'pro-micro', name: 'Arduino Pro Micro', mcu: 'ATmega32U4', fqbn: 'arduino:avr:micro', lapge: '5V/3.3V', usbHid: true, notes: 'Native USB HID board, excellent for button boxes. D2=SDA and D3=SCL; board lapge depends on the model you buy.', pins: [...atmega32u4Digital.filter((pin) => !['D11', 'D12', 'D13'].includes(pin.pin)), ...atmega32u4Analog.filter((pin) => !['A11'].includes(pin.pin)), p('VCC', { digital: false, power: '5v', notes: 'VCC follows the board version: 5V or 3.3V.' }), p('RAW', { digital: false, power: 'vin' }), p('GND', { digital: false, power: 'gnd' }), p('RST', { digital: false, power: 'reset' })] },
  leonardo: { id: 'leonardo', deviceBoardId: 'leonardo', name: 'Arduino Leonardo', mcu: 'ATmega32U4', fqbn: 'arduino:avr:leonardo', lapge: '5V', usbHid: true, notes: 'Uno-sized native USB HID board. Great for joystick/button box firmware because it can appear as a USB device.', pins: [...atmega32u4Digital, ...atmega32u4Analog, ...powerPins()] },
  micro: { id: 'micro', name: 'Arduino Micro', mcu: 'ATmega32U4', fqbn: 'arduino:avr:micro', lapge: '5V', usbHid: true, notes: 'Small native USB HID board with Leonardo-style pin capabilities.', pins: [...atmega32u4Digital, ...atmega32u4Analog, ...powerPins()] },
  mega: { id: 'mega', deviceBoardId: 'mega2560', name: 'Arduino Mega 2560', mcu: 'ATmega2560', fqbn: 'arduino:avr:mega', lapge: '5V', usbHid: false, notes: 'Best 5V choice when you need many direct pins. I2C is D20/D21; SPI is D50-D53.', pins: [...withUart(avrDigital(53, ['D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13', 'D44', 'D45', 'D46'], ['D2', 'D3', 'D18', 'D19', 'D20', 'D21'], { D50: 'miso', D51: 'mosi', D52: 'sck', D53: 'ss' }).map((pin) => pin.pin === 'D20' ? { ...pin, i2c: 'sda' as const, notes: 'SDA for I2C.' } : pin.pin === 'D21' ? { ...pin, i2c: 'scl' as const, notes: 'SCL for I2C.' } : pin), ['D0', 'D19', 'D17', 'D15'], ['D1', 'D18', 'D16', 'D14']), ...avrAnalog(16), ...powerPins()] },
  due: { id: 'due', name: 'Arduino Due', mcu: 'SAM3X8E', fqbn: 'arduino:sam:arduino_due_x', lapge: '3.3V', usbHid: true, notes: 'Large 3.3V ARM board. Most digital pins support interrupts; PWM on D2-D13. Do not connect 5V signals.', pins: [...withUart(avrDigital(53, ['D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13'], Array.from({ length: 54 }, (_, i) => `D${i}`), { D52: 'miso', D51: 'mosi', D53: 'sck', D10: 'ss' }).map((pin) => pin.pin === 'D20' ? { ...pin, i2c: 'sda' as const } : pin.pin === 'D21' ? { ...pin, i2c: 'scl' as const } : pin), ['D0', 'D19', 'D17', 'D15'], ['D1', 'D18', 'D16', 'D14']), ...avrAnalog(12), ...powerPins(true, false)] },
  zero: { id: 'zero', name: 'Arduino Zero', mcu: 'SAMD21G18A', fqbn: 'arduino:samd:arduino_zero_native', lapge: '3.3V', usbHid: true, notes: 'Uno-sized SAMD board with native USB and 3.3V logic. Great for compact HID projects.', pins: zeroPins },
  'mkr-wifi-1010': { id: 'mkr-wifi-1010', name: 'Arduino MKR WiFi 1010', mcu: 'SAMD21G18A', fqbn: 'arduino:samd:mkrwifi1010', lapge: '3.3V', usbHid: true, notes: 'MKR 3.3V board with Wi-Fi; compact for wireless telemetry accessories.', pins: mkrPins },
  'mkr-zero': { id: 'mkr-zero', name: 'Arduino MKR Zero', mcu: 'SAMD21G18A', fqbn: 'arduino:samd:mkrzero', lapge: '3.3V', usbHid: true, notes: 'MKR 3.3V board with native USB and microSD; useful when you do not need wireless.', pins: mkrPins },
  mkr1000: { id: 'mkr1000', name: 'Arduino MKR1000 WiFi', mcu: 'SAMD21G18A', fqbn: 'arduino:samd:mkr1000', lapge: '3.3V', usbHid: true, notes: 'Older MKR Wi-Fi board. Keep GPIO at 3.3V.', pins: mkrPins },
  'mkr-wan-1310': { id: 'mkr-wan-1310', name: 'Arduino MKR WAN 1310', mcu: 'SAMD21G18A', fqbn: 'arduino:samd:mkrwan1310', lapge: '3.3V', usbHid: true, notes: 'LoRa MKR board; pinout is useful for export/documentation even if button-box firmware rarely needs LoRa.', pins: mkrPins },
  'mkr-gsm-1400': { id: 'mkr-gsm-1400', name: 'Arduino MKR GSM 1400', mcu: 'SAMD21G18A', fqbn: 'arduino:samd:mkrgsm1400', lapge: '3.3V', usbHid: true, notes: 'Cellular MKR board; cataloged for wiring/export completeness.', pins: mkrPins },
  'mkr-nb-1500': { id: 'mkr-nb-1500', name: 'Arduino MKR NB 1500', mcu: 'SAMD21G18A', fqbn: 'arduino:samd:mkrnb1500', lapge: '3.3V', usbHid: true, notes: 'NB-IoT/LTE-M MKR board; cataloged for wiring/export completeness.', pins: mkrPins },
  esp32: { id: 'esp32', deviceBoardId: 'esp32', name: 'ESP32 DevKit', mcu: 'ESP32', fqbn: 'esp32:esp32:esp32', lapge: '3.3V', usbHid: false, notes: '3.3V logic, Wi-Fi/Bluetooth. GPIO34-39 are input-only. GPIO6-11 are reserved for flash and intentionally omitted.', pins: esp32Pins },
  esp32s2: { id: 'esp32s2', name: 'ESP32-S2 DevKit', mcu: 'ESP32-S2', fqbn: 'esp32:esp32:esp32s2', lapge: '3.3V', usbHid: true, notes: 'Single-core ESP32 with native USB. Board variants differ; avoid pins marked boot/special unless you know the silkscreen.', pins: uniquePins(esp32s2Pins) },
  esp32s3: { id: 'esp32s3', deviceBoardId: 'esp32s3', name: 'ESP32-S3 DevKit', mcu: 'ESP32-S3', fqbn: 'esp32:esp32:esp32s3', lapge: '3.3V', usbHid: true, notes: 'Native USB and many GPIOs. DevKit pinouts vary by vendor; verify the silkscreen before soldering.', pins: esp32s3Pins },
  esp32c3: { id: 'esp32c3', name: 'ESP32-C3 DevKit', mcu: 'ESP32-C3', fqbn: 'esp32:esp32:esp32c3', lapge: '3.3V', usbHid: true, notes: 'RISC-V ESP32 with native USB on many boards. Fewer pins than ESP32/S3; check boot straps.', pins: esp32c3Pins },
  'esp8266-nodemcu': { id: 'esp8266-nodemcu', deviceBoardId: 'esp8266', name: 'ESP8266 NodeMCU v2', mcu: 'ESP8266', fqbn: 'esp8266:esp8266:nodemcuv2', lapge: '3.3V', usbHid: false, notes: 'Wi-Fi board with one analog input. GPIO6-11 are flash pins and omitted. Not suitable for native USB HID.', pins: esp8266NodeMcuPins },
  'esp8266-d1-mini': { id: 'esp8266-d1-mini', deviceBoardId: 'esp8266', name: 'Wemos D1 mini / ESP8266', mcu: 'ESP8266', fqbn: 'esp8266:esp8266:d1_mini', lapge: '3.3V', usbHid: false, notes: 'Tiny ESP8266 board; great for Wi-Fi accessories, not native USB HID. Uses the common D0-D8 labels.', pins: esp8266NodeMcuPins },
  teensy40: { id: 'teensy40', name: 'Teensy 4.0', mcu: 'IMXRT1062', fqbn: 'teensy:avr:teensy40', lapge: '3.3V', usbHid: true, notes: 'Very fast native USB board. Auto-flash is export-only in this app unless Teensy tools are installed separately.', pins: teensy40Pins },
  teensy41: { id: 'teensy41', name: 'Teensy 4.1', mcu: 'IMXRT1062', fqbn: 'teensy:avr:teensy41', lapge: '3.3V', usbHid: true, notes: 'Large fast native USB board with many pins. Auto-flash is export-only in this app unless Teensy tools are installed separately.', pins: teensy41Pins },
  pico: { id: 'pico', name: 'Raspberry Pi Pico / RP2040', mcu: 'RP2040', fqbn: 'arduino:mbed_rp2040:pico', lapge: '3.3V', usbHid: true, notes: 'Low-cost RP2040 board with native USB. GPIO pins are 3.3V only; analog inputs are GPIO26-GPIO28.', pins: picoPins }
}

const powerCommon = ['Connect GND from the component to board GND.', 'Use the lapge listed in Power needs; do not mix 5V signals into 3.3V-only boards without level shifting.']
const i2cNotes = ['SDA must go to the board SDA pin; SCL must go to SCL.', 'Many I2C modules can share the same SDA/SCL pair if addresses differ.']
const spiNotes = ['Use the board SPI pins when possible: MOSI/DIN, MISO/DOUT, SCK/CLK and CS/SS.', 'Most display modules also need DC and RST on normal digital pins.']
const buttonNotes = ['Wire one side to the signal pin and the other to GND.', 'Firmware uses the board internal pull-up, so no extra resistor is normally needed.']

export const PINOUT_COMPONENT_LIBRARY: PinoutComponentDefinition[] = [
  { id: 'single-led', type: 'startLed', name: 'Single LED', shortName: 'LED', description: 'One indicator light for status, flags or warnings.', plainLanguageDescription: 'A tiny lamp that turns on/off from one digital pin.', category: 'Lights', icon: '●', iconHint: 'small light dot', defaultLabel: 'Status LED', protocolKey: 'light.led', power: ['5V', 'GND'], roles: [{ role: 'signal', label: 'LED signal', kind: 'digital', muxCapable: true }], defaultWiringNotes: ['Put a 220Ω–330Ω resistor in series with the LED.', ...powerCommon] },
  { id: 'rgb-led', type: 'startLed', name: 'RGB LED', shortName: 'RGB LED', description: 'Three-color LED with separate red, green and blue control pins.', plainLanguageDescription: 'One LED that mixes colors using three PWM-capable pins.', category: 'Lights', icon: '◉', iconHint: 'three-color LED', defaultLabel: 'RGB indicator', protocolKey: 'light.rgbLed', power: ['5V', 'GND'], roles: [{ role: 'red', label: 'Red PWM', kind: 'pwm' }, { role: 'green', label: 'Green PWM', kind: 'pwm' }, { role: 'blue', label: 'Blue PWM', kind: 'pwm' }], defaultWiringNotes: ['Each color leg needs its own resistor.', 'Use PWM pins for dimming and color mixing.'] },
  { id: 'ws2812-strip', type: 'rgbStrip', name: 'WS2812 / NeoPixel strip', shortName: 'NeoPixel strip', description: 'Addressable RGB LED strip for rev lights, flags and effects.', plainLanguageDescription: 'Many RGB LEDs controlled by one data wire.', category: 'Lights', icon: '═', iconHint: 'LED strip', defaultLabel: 'Rev lights', protocolKey: 'rgbStrip', power: ['5V', 'GND'], roles: [{ role: 'data', label: 'DIN data', kind: 'digital' }], defaults: { ledCount: 16, chip: 'ws2812' }, defaultWiringNotes: ['DIN goes to a digital pin. Add a 330Ω data resistor if possible.', 'Use an external 5V supply for many LEDs and connect GND to the board GND.'] },
  { id: 'led-matrix-8x8', type: 'rgbMatrix', name: 'WS2812 8x8 matrix / iFlag', shortName: '8x8 iFlag', description: '8x8 RGB matrix used for flags, gear and spotter alerts.', plainLanguageDescription: 'A square panel of RGB LEDs controlled by one data wire.', category: 'Lights', icon: '▦', iconHint: 'LED matrix', defaultLabel: 'iFlag 8x8', protocolKey: 'rgbMatrix', power: ['5V', 'GND'], roles: [{ role: 'data', label: 'DIN data', kind: 'digital' }], defaults: { width: 8, height: 8, chip: 'ws2812' }, defaultWiringNotes: ['DIN goes to a digital pin.', 'Use external 5V power for brightness and keep common GND.'] },
  { id: 'led-matrix-16x16', type: 'rgbMatrix', name: 'WS2812 16x16 matrix', shortName: '16x16 matrix', description: 'Larger 256-pixel RGB matrix for flags, icons and animations.', plainLanguageDescription: 'A bigger square RGB LED panel controlled by one data wire.', category: 'Lights', icon: '▩', iconHint: 'large RGB LED matrix', defaultLabel: 'RGB matrix 16x16', protocolKey: 'rgbMatrix', power: ['5V', 'GND'], roles: [{ role: 'data', label: 'DIN data', kind: 'digital' }], defaults: { width: 16, height: 16, chip: 'ws2812' }, defaultWiringNotes: ['Use a strong external 5V power supply; 256 LEDs can draw a lot of current.', 'Keep board GND and LED power GND connected together.'] },
  { id: 'apa102-strip', type: 'rgbStrip', name: 'APA102 / SK9822 LED strip', shortName: 'APA102 strip', description: 'Clocked addressable RGB strip with separate data and clock wires.', plainLanguageDescription: 'A fast RGB LED strip that uses two signal wires instead of one.', category: 'Lights', icon: '≋', iconHint: 'two-wire LED strip', defaultLabel: 'APA102 lights', protocolKey: 'rgbStrip.apa102', power: ['5V', 'GND'], roles: [{ role: 'data', label: 'DI data / MOSI', kind: 'digital' }, { role: 'clock', label: 'CI clock / SCK', kind: 'digital' }], defaults: { ledCount: 16, chip: 'apa102' }, defaultWiringNotes: ['Connect DI to MOSI/data and CI to SCK/clock when possible.', 'Use external 5V power for longer strips and common GND.'] },

  { id: 'oled-i2c', type: 'screen', name: 'SSD1306 OLED I2C', shortName: 'OLED I2C', description: 'Small 128x64 OLED display using the I2C bus.', plainLanguageDescription: 'A small text/graphics screen that only needs SDA and SCL.', category: 'Screens', icon: '▭', iconHint: 'small OLED screen', defaultLabel: 'OLED 128x64', protocolKey: 'screen.oled', power: ['3V3', '5V', 'GND'], roles: [{ role: 'sda', label: 'SDA', kind: 'i2c' }, { role: 'scl', label: 'SCL', kind: 'i2c' }], defaults: { address: '0x3C' }, defaultWiringNotes: i2cNotes },
  { id: 'oled-spi', type: 'screen', name: 'SSD1306 OLED SPI', shortName: 'OLED SPI', description: 'SSD1306 OLED using SPI pins for faster screen updates.', plainLanguageDescription: 'A small OLED screen with more wires, but faster updates.', category: 'Screens', icon: '▭', iconHint: 'SPI OLED screen', defaultLabel: 'SPI OLED', protocolKey: 'screen.oled.spi', power: ['3V3', '5V', 'GND'], roles: [{ role: 'mosi', label: 'MOSI / DIN', kind: 'digital' }, { role: 'sck', label: 'SCK / CLK', kind: 'digital' }, { role: 'cs', label: 'CS / SS', kind: 'digital' }, { role: 'dc', label: 'D/C', kind: 'digital' }, { role: 'rst', label: 'RST', kind: 'digital', optional: true }], defaultWiringNotes: spiNotes },
  { id: 'sh1106-oled', type: 'screen', name: 'SH1106 OLED I2C', shortName: 'SH1106 OLED', description: 'Common 1.3 inch OLED display using the SH1106 controller.', plainLanguageDescription: 'A slightly larger OLED screen that wires like the SSD1306 I2C OLED.', category: 'Screens', icon: '▭', iconHint: '1.3 inch OLED screen', defaultLabel: 'SH1106 OLED', protocolKey: 'screen.sh1106', power: ['3V3', '5V', 'GND'], roles: [{ role: 'sda', label: 'SDA', kind: 'i2c' }, { role: 'scl', label: 'SCL', kind: 'i2c' }], defaults: { address: '0x3C' }, defaultWiringNotes: i2cNotes },
  { id: 'lcd-i2c', type: 'screen', name: 'HD44780 character LCD I2C', shortName: 'Char LCD I2C', description: '16x2 or 20x4 character LCD with I2C backpack.', plainLanguageDescription: 'A simple text display; the I2C backpack keeps wiring easy.', category: 'Screens', icon: '▤', iconHint: 'character LCD', defaultLabel: '16x2 LCD', protocolKey: 'screen.charLcdI2c', power: ['5V', 'GND'], roles: [{ role: 'sda', label: 'SDA', kind: 'i2c' }, { role: 'scl', label: 'SCL', kind: 'i2c' }], defaults: { address: '0x27', columns: 16, rows: 2 }, defaultWiringNotes: ['Use the board I2C pins.', 'Most backpacks run at 5V; check compatibility with 3.3V boards.'] },
  { id: 'lcd-parallel', type: 'screen', name: 'HD44780 character LCD parallel', shortName: 'Char LCD parallel', description: '16x2 or 20x4 character LCD wired directly without an I2C backpack.', plainLanguageDescription: 'A text LCD that uses many digital wires instead of the easy I2C backpack.', category: 'Screens', icon: '▤', iconHint: 'parallel character LCD', defaultLabel: 'Parallel LCD', protocolKey: 'screen.charLcdParallel', power: ['5V', 'GND'], roles: [{ role: 'rs', label: 'RS', kind: 'digital' }, { role: 'en', label: 'EN', kind: 'digital' }, { role: 'd4', label: 'D4', kind: 'digital' }, { role: 'd5', label: 'D5', kind: 'digital' }, { role: 'd6', label: 'D6', kind: 'digital' }, { role: 'd7', label: 'D7', kind: 'digital' }], defaults: { columns: 16, rows: 2 }, defaultWiringNotes: ['Uses 4-bit mode to save pins: RS, EN and D4-D7.', 'RW is normally tied to GND. Add a potentiometer for contrast.'] },
  { id: 'tm1637-4digit', type: 'segDisplay', name: 'TM1637 4-digit display', shortName: 'TM1637', description: 'Four-digit seven-segment display for speed, gear or values.', plainLanguageDescription: 'A numeric display using two simple digital wires.', category: 'Screens', icon: '8', iconHint: '4 digit seven segment', defaultLabel: '4-digit display', protocolKey: 'seg.tm1637', power: ['5V', 'GND'], roles: [{ role: 'clk', label: 'CLK', kind: 'digital' }, { role: 'dio', label: 'DIO', kind: 'digital' }], defaults: { digits: 4 }, defaultWiringNotes: ['CLK and DIO can use normal digital pins.', ...powerCommon] },
  { id: 'tm1638-module', type: 'segDisplay', name: 'TM1638 LED & key module', shortName: 'TM1638', description: '8-digit seven-segment display module with LEDs and buttons.', plainLanguageDescription: 'A popular board that combines numbers, indicator LEDs and push buttons.', category: 'Screens', icon: '▥', iconHint: 'TM1638 module', defaultLabel: 'TM1638 panel', protocolKey: 'seg.tm1638', power: ['5V', 'GND'], roles: [{ role: 'stb', label: 'STB / CS', kind: 'digital' }, { role: 'clk', label: 'CLK', kind: 'digital' }, { role: 'dio', label: 'DIO data', kind: 'digital' }], defaults: { digits: 8 }, defaultWiringNotes: ['STB, CLK and DIO can use normal digital pins.', 'Most modules are 5V; use level shifting for strict 3.3V boards if needed.'] },
  { id: 'max7219-7seg', type: 'segDisplay', name: 'MAX7219 7-segment display', shortName: 'MAX7219 7-seg', description: 'SPI-like driver for 8-digit seven-segment modules.', plainLanguageDescription: 'A numeric display module that uses three digital wires.', category: 'Screens', icon: '⑧', iconHint: '8 digit MAX7219 display', defaultLabel: 'MAX7219 digits', protocolKey: 'seg.max7219', power: ['5V', 'GND'], roles: [{ role: 'din', label: 'DIN / MOSI', kind: 'digital' }, { role: 'clk', label: 'CLK / SCK', kind: 'digital' }, { role: 'cs', label: 'CS / LOAD', kind: 'digital' }], defaults: { digits: 8 }, defaultWiringNotes: ['DIN, CLK and CS can use normal digital pins; hardware SPI pins are preferred.', ...powerCommon] },
  { id: 'max7219-matrix', type: 'rgbMatrix', name: 'MAX7219 LED matrix', shortName: 'MAX7219 matrix', description: 'Single-color 8x8 dot-matrix display driven by MAX7219.', plainLanguageDescription: 'A simple one-color dot display for icons, flags or a gear number.', category: 'Screens', icon: '▦', iconHint: 'single-color LED matrix', defaultLabel: 'MAX7219 matrix', protocolKey: 'matrix.max7219', power: ['5V', 'GND'], roles: [{ role: 'din', label: 'DIN / MOSI', kind: 'digital' }, { role: 'clk', label: 'CLK / SCK', kind: 'digital' }, { role: 'cs', label: 'CS / LOAD', kind: 'digital' }], defaults: { width: 8, height: 8, chip: 'max7219' }, defaultWiringNotes: ['Use DIN, CLK and CS/LOAD. Modules can be chained.', ...powerCommon] },
  { id: 'st7735-tft', type: 'screen', name: 'ST7735 TFT display', shortName: 'ST7735 TFT', description: 'Small color TFT display, often 1.44 or 1.8 inch, using SPI.', plainLanguageDescription: 'A small color screen for dashboards or status pages.', category: 'Screens', icon: '▣', iconHint: 'small color TFT', defaultLabel: 'ST7735 TFT', protocolKey: 'screen.tft.st7735', power: ['3V3', '5V', 'GND'], roles: [{ role: 'mosi', label: 'MOSI / SDA', kind: 'digital' }, { role: 'sck', label: 'SCK / SCL', kind: 'digital' }, { role: 'cs', label: 'CS', kind: 'digital' }, { role: 'dc', label: 'DC / A0', kind: 'digital' }, { role: 'rst', label: 'RST', kind: 'digital', optional: true }, { role: 'bl', label: 'Backlight', kind: 'pwm', optional: true }], defaultWiringNotes: spiNotes },
  { id: 'ili9341-tft', type: 'screen', name: 'ILI9341 TFT display', shortName: 'ILI9341 TFT', description: 'Common 2.4-3.2 inch color TFT display using SPI.', plainLanguageDescription: 'A larger color screen for rich dashboards.', category: 'Screens', icon: '▣', iconHint: 'larger color TFT', defaultLabel: 'ILI9341 TFT', protocolKey: 'screen.tft.ili9341', power: ['3V3', '5V', 'GND'], roles: [{ role: 'mosi', label: 'MOSI / SDI', kind: 'digital' }, { role: 'miso', label: 'MISO / SDO', kind: 'digital', optional: true }, { role: 'sck', label: 'SCK', kind: 'digital' }, { role: 'cs', label: 'CS', kind: 'digital' }, { role: 'dc', label: 'DC / RS', kind: 'digital' }, { role: 'rst', label: 'RST', kind: 'digital', optional: true }, { role: 'bl', label: 'Backlight', kind: 'pwm', optional: true }], defaultWiringNotes: spiNotes },
  { id: 'seven-seg-raw', type: 'segDisplay', name: 'Raw 7-segment display', shortName: '7-seg raw', description: 'A bare 7-segment digit that needs one pin per segment.', plainLanguageDescription: 'A numeric LED digit; uses many pins unless paired with a driver.', category: 'Screens', icon: '⑧', iconHint: 'raw seven segment digit', defaultLabel: '7-seg digit', protocolKey: 'seg.raw7', power: ['5V', 'GND'], roles: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'].map((role) => ({ role, label: `Segment ${role.toUpperCase()}`, kind: 'digital' as const, muxCapable: true })), defaultWiringNotes: ['Each segment needs a resistor.', 'Prefer TM1637/TM1638/MAX7219 when pins are scarce.'] },

  { id: 'buzzer', type: 'buzzer', name: 'Passive buzzer / piezo', shortName: 'Buzzer', description: 'Simple sound output for alerts.', plainLanguageDescription: 'A small beeper controlled by one signal pin.', category: 'Sound', icon: '♪', iconHint: 'sound wave', defaultLabel: 'Buzzer', protocolKey: 'buzzer', power: ['5V', 'GND'], roles: [{ role: 'signal', label: 'Signal', kind: 'digital' }], defaultWiringNotes: ['Use a PWM-capable pin for tones when possible; digital still works for simple beeps.', ...powerCommon] },
  { id: 'active-buzzer', type: 'buzzer', name: 'Active buzzer', shortName: 'Active buzzer', description: 'Self-oscillating buzzer that beeps when driven high/low.', plainLanguageDescription: 'A buzzer that makes its own tone; the board only turns it on or off.', category: 'Sound', icon: '♫', iconHint: 'beeper', defaultLabel: 'Active buzzer', protocolKey: 'buzzer.active', power: ['5V', '3V3', 'GND'], roles: [{ role: 'signal', label: 'On/off signal', kind: 'digital' }], defaultWiringNotes: ['Use a normal digital output pin.', 'If the buzzer draws more current than a GPIO can provide, drive it through a transistor.'] },

  { id: 'push-button', type: 'control', name: 'Push button', shortName: 'Button', description: 'Momentary button using INPUT_PULLUP.', plainLanguageDescription: 'Press-to-activate button for menus, pit limiter, ignition, etc.', category: 'Inputs', icon: '⏺', iconHint: 'button', defaultLabel: 'Button', protocolKey: 'control.button', power: ['GND'], roles: [{ role: 'signal', label: 'Signal', kind: 'digital', muxCapable: true }], defaultWiringNotes: buttonNotes },
  { id: 'momentary-button', type: 'control', name: 'Momentary push button', shortName: 'Momentary', description: 'Normally-open momentary switch for actions that happen only while pressed.', plainLanguageDescription: 'A press-and-release button; it does not stay on by itself.', category: 'Inputs', icon: '○', iconHint: 'momentary button', defaultLabel: 'Momentary button', protocolKey: 'control.button.momentary', power: ['GND'], roles: [{ role: 'signal', label: 'Signal', kind: 'digital', muxCapable: true }], defaultWiringNotes: buttonNotes },
  { id: 'toggle-switch', type: 'control', name: 'Toggle switch', shortName: 'Toggle', description: 'On/off maintained switch.', plainLanguageDescription: 'A switch that stays in its selected position.', category: 'Inputs', icon: '⎓', iconHint: 'toggle switch', defaultLabel: 'Toggle switch', protocolKey: 'control.toggle', power: ['GND'], roles: [{ role: 'signal', label: 'Signal', kind: 'digital', muxCapable: true }], defaultWiringNotes: ['Wire common to GND and the switched side to a digital input with internal pull-up.'] },
  { id: 'rotary-encoder', type: 'control', name: 'Rotary encoder with button', shortName: 'Encoder', description: 'Incremental encoder with CLK, DT and optional push switch.', plainLanguageDescription: 'A knob you can rotate left/right and press.', category: 'Inputs', icon: '↻', iconHint: 'rotating knob', defaultLabel: 'Encoder', protocolKey: 'control.encoder', power: ['GND'], roles: [{ role: 'clk', label: 'CLK / A', kind: 'digital', muxCapable: true }, { role: 'dt', label: 'DT / B', kind: 'digital', muxCapable: true }, { role: 'sw', label: 'SW button', kind: 'digital', optional: true, muxCapable: true }], defaultWiringNotes: ['CLK and DT go to digital pins. Use interrupt-capable pins when fast rotation matters.', 'Common pin usually goes to GND.'] },
  { id: 'rotary-encoder-no-button', type: 'control', name: 'Rotary encoder without button', shortName: 'Encoder no push', description: 'Incremental encoder with only A/B rotation signals.', plainLanguageDescription: 'A knob you rotate left/right, without a press switch.', category: 'Inputs', icon: '↺', iconHint: 'encoder knob without push', defaultLabel: 'Encoder', protocolKey: 'control.encoder.noButton', power: ['GND'], roles: [{ role: 'clk', label: 'CLK / A', kind: 'digital', muxCapable: true }, { role: 'dt', label: 'DT / B', kind: 'digital', muxCapable: true }], defaultWiringNotes: ['Use interrupt-capable pins for the best response at fast rotation.', 'Common pin usually goes to GND.'] },
  { id: 'pot-axis', type: 'control', name: 'Potentiometer / analog axis', shortName: 'Potentiometer', description: 'Analog input for handbrake, brake bias, volume or trim.', plainLanguageDescription: 'A knob/slider that reports a smooth position.', category: 'Inputs', icon: '◒', iconHint: 'knob', defaultLabel: 'Analog axis', protocolKey: 'control.analog', power: ['5V', '3V3', 'GND'], roles: [{ role: 'signal', label: 'Wiper / signal', kind: 'analog', muxCapable: true }], defaultWiringNotes: ['Outer legs go to power and GND; center/wiper goes to an analog input.', 'Use 3.3V on ESP32 boards, 5V on 5V Arduino boards.'] },
  { id: 'slide-pot', type: 'control', name: 'Slide potentiometer', shortName: 'Slide pot', description: 'Linear analog slider for volume, brake bias or trim.', plainLanguageDescription: 'A slider that reports a smooth position.', category: 'Inputs', icon: '▰', iconHint: 'linear slider', defaultLabel: 'Slider axis', protocolKey: 'control.slidePot', power: ['5V', '3V3', 'GND'], roles: [{ role: 'signal', label: 'Wiper / signal', kind: 'analog', muxCapable: true }], defaultWiringNotes: ['Outer legs go to power and GND; center/wiper goes to an analog input.', 'Use the board logic lapge for the high side.'] },
  { id: 'hall-sensor', type: 'control', name: 'Hall sensor', shortName: 'Hall sensor', description: 'Magnetic sensor for pedals, shifters and position detection.', plainLanguageDescription: 'Detects a magnet without physical contact.', category: 'Inputs', icon: '⌁', iconHint: 'magnet sensor', defaultLabel: 'Hall sensor', protocolKey: 'control.hall', power: ['5V', '3V3', 'GND'], roles: [{ role: 'signal', label: 'Signal', kind: 'analog', muxCapable: true }], defaultWiringNotes: ['Analog Hall sensors go to analog pins; digital Hall modules can use a digital input.', ...powerCommon] },
  { id: 'ir-receiver', type: 'control', name: 'IR receiver module', shortName: 'IR receiver', description: 'Demodulated infrared receiver such as VS1838B/TSOP modules.', plainLanguageDescription: 'Receives commands from a simple infrared remote control.', category: 'Inputs', icon: '◖', iconHint: 'infrared receiver', defaultLabel: 'IR receiver', protocolKey: 'control.irReceiver', power: ['5V', '3V3', 'GND'], roles: [{ role: 'signal', label: 'OUT signal', kind: 'digital' }], defaultWiringNotes: ['OUT goes to a digital input; interrupt-capable pins are preferred.', ...powerCommon] },
  { id: 'joystick-module', type: 'control', name: '2-axis joystick module', shortName: 'Joystick', description: 'Thumb joystick with X/Y potentiometers and optional press switch.', plainLanguageDescription: 'A small gamepad-style stick with two analog axes and a press button.', category: 'Inputs', icon: '✣', iconHint: 'thumb joystick', defaultLabel: 'Joystick', protocolKey: 'control.joystick', power: ['5V', '3V3', 'GND'], roles: [{ role: 'x', label: 'VRx analog', kind: 'analog', muxCapable: true }, { role: 'y', label: 'VRy analog', kind: 'analog', muxCapable: true }, { role: 'sw', label: 'SW button', kind: 'digital', optional: true, muxCapable: true }], defaultWiringNotes: ['VRx and VRy need analog inputs.', 'SW is usually wired to GND and read with internal pull-up.'] },

  { id: 'cd74hc4067', type: 'multiplexer', name: 'CD74HC4067 16-channel analog mux', shortName: 'CD74HC4067', description: '16-channel multiplexer for many buttons or analog signals.', plainLanguageDescription: 'A “pin splitter”: it lets one signal pin read up to 16 channels.', category: 'Expanders / Mux', icon: '⑯', iconHint: '16 channel mux chip', defaultLabel: 'MUX 16 channels', protocolKey: 'mux.cd74hc4067', power: ['5V', '3V3', 'GND'], roles: [{ role: 'sig', label: 'SIG common', kind: 'any' }, { role: 's0', label: 'S0 select', kind: 'digital' }, { role: 's1', label: 'S1 select', kind: 'digital' }, { role: 's2', label: 'S2 select', kind: 'digital' }, { role: 's3', label: 'S3 select', kind: 'digital' }, { role: 'en', label: 'EN enable', kind: 'digital', optional: true }], defaultWiringNotes: ['SIG goes to one board signal pin: analog for potentiometers, digital for buttons.', 'S0-S3 go to four digital pins.', 'EN can be tied to GND if you do not need software enable. Channels C0-C15 go to components.'] },
  { id: '74hc165', type: 'expander', name: '74HC165 shift-in expander', shortName: '74HC165 in', description: 'Parallel-in serial-out expander for many buttons/switches.', plainLanguageDescription: 'Reads many on/off inputs while using only a few board pins.', category: 'Expanders / Mux', icon: '⇥', iconHint: 'shift input chip', defaultLabel: 'Shift-in inputs', protocolKey: 'expander.74hc165', power: ['5V', '3V3', 'GND'], roles: [{ role: 'data', label: 'QH data', kind: 'digital' }, { role: 'clock', label: 'CLK clock', kind: 'digital' }, { role: 'latch', label: 'SH/LD latch', kind: 'digital' }, { role: 'clockEnable', label: 'CE enable', kind: 'digital', optional: true }], defaultWiringNotes: ['Use for many buttons/toggles.', 'Inputs are on chip pins D0-D7; board only needs data/clock/latch.'] },
  { id: '74hc595', type: 'expander', name: '74HC595 shift-out expander', shortName: '74HC595 out', description: 'Serial-in parallel-out expander for LEDs or display segments.', plainLanguageDescription: 'Controls many LED outputs with only a few board pins.', category: 'Expanders / Mux', icon: '⇤', iconHint: 'shift output chip', defaultLabel: 'Shift-out LEDs', protocolKey: 'expander.74hc595', power: ['5V', '3V3', 'GND'], roles: [{ role: 'data', label: 'SER data', kind: 'digital' }, { role: 'clock', label: 'SRCLK clock', kind: 'digital' }, { role: 'latch', label: 'RCLK latch', kind: 'digital' }, { role: 'outputEnable', label: 'OE enable', kind: 'digital', optional: true }], defaultWiringNotes: ['Use for many LEDs or raw 7-segment segments.', 'Each LED output still needs current limiting.'] },
  { id: 'pcf8574', type: 'expander', name: 'PCF8574 I2C GPIO expander', shortName: 'PCF8574', description: '8-bit I2C GPIO expander for buttons, relays or simple LEDs.', plainLanguageDescription: 'Adds eight simple pins using the same SDA/SCL screen bus.', category: 'Expanders / Mux', icon: '▣', iconHint: 'I2C expander board', defaultLabel: 'I2C GPIO expander', protocolKey: 'expander.pcf8574', power: ['5V', '3V3', 'GND'], roles: [{ role: 'sda', label: 'SDA', kind: 'i2c' }, { role: 'scl', label: 'SCL', kind: 'i2c' }], defaults: { address: '0x20' }, defaultWiringNotes: ['Shares the I2C bus with OLED/LCD modules.', 'Set unique addresses when using multiple PCF8574 boards.'] },
  { id: 'mcp23017', type: 'expander', name: 'MCP23017 I2C GPIO expander', shortName: 'MCP23017', description: '16-bit I2C GPIO expander for many buttons, LEDs or switches.', plainLanguageDescription: 'Adds sixteen simple pins using the same two I2C wires as a screen.', category: 'Expanders / Mux', icon: '▣', iconHint: '16 bit I2C expander', defaultLabel: 'MCP23017 expander', protocolKey: 'expander.mcp23017', power: ['5V', '3V3', 'GND'], roles: [{ role: 'sda', label: 'SDA', kind: 'i2c' }, { role: 'scl', label: 'SCL', kind: 'i2c' }, { role: 'intA', label: 'INTA interrupt', kind: 'digital', optional: true }, { role: 'intB', label: 'INTB interrupt', kind: 'digital', optional: true }], defaults: { address: '0x20' }, defaultWiringNotes: ['Shares the I2C bus. Set A0-A2 address jumpers when using more than one.', 'INTA/INTB are optional but useful when firmware needs fast input updates.'] },

  { id: 'sg90-servo', type: 'gauge', name: 'SG90 servo', shortName: 'SG90 servo', description: 'Small hobby servo for moving a pointer or flap.', plainLanguageDescription: 'A small motor that moves to a requested angle.', category: 'Motors', icon: '◔', iconHint: 'servo pointer', defaultLabel: 'Servo gauge', protocolKey: 'gauge.servo', power: ['5V', 'GND'], roles: [{ role: 'signal', label: 'PWM signal', kind: 'pwm' }], defaults: { minAngle: 0, maxAngle: 180 }, defaultWiringNotes: ['Signal must go to a PWM-capable pin.', 'Power servos from a suitable 5V supply; keep common GND.'] },
  { id: 'mg996r-servo', type: 'gauge', name: 'MG996R high-torque servo', shortName: 'MG996R servo', description: 'Larger metal-gear servo for heavy pointers or mechanisms.', plainLanguageDescription: 'A stronger servo motor that needs a separate 5V power supply.', category: 'Motors', icon: '◕', iconHint: 'large servo', defaultLabel: 'High torque servo', protocolKey: 'gauge.servo.mg996r', power: ['5V', 'GND'], roles: [{ role: 'signal', label: 'PWM signal', kind: 'pwm' }], defaults: { minAngle: 0, maxAngle: 180 }, defaultWiringNotes: ['Do not power MG996R from the Arduino 5V pin; use a suitable external supply.', 'Connect servo GND and board GND together.'] },
  { id: 'x27-stepper', type: 'gauge', name: 'X27 stepper gauge motor', shortName: 'X27 stepper', description: 'Automotive gauge stepper motor for needles.', plainLanguageDescription: 'A tiny gauge motor for realistic analog dials.', category: 'Motors', icon: '◷', iconHint: 'gauge motor', defaultLabel: 'Stepper gauge', protocolKey: 'gauge.x27', power: ['5V', 'GND'], roles: [{ role: 'coilA1', label: 'Coil A1', kind: 'digital' }, { role: 'coilA2', label: 'Coil A2', kind: 'digital' }, { role: 'coilB1', label: 'Coil B1', kind: 'digital' }, { role: 'coilB2', label: 'Coil B2', kind: 'digital' }], defaultWiringNotes: ['Use four digital pins or a driver board.', 'Do not power motor coils from weak 3.3V rails.'] },
  { id: 'x27-stepper-driver', type: 'gauge', name: 'X27.168 stepper with driver', shortName: 'X27 driver', description: 'Automotive gauge stepper controlled through a driver board.', plainLanguageDescription: 'A gauge motor paired with a driver so wiring is easier and safer.', category: 'Motors', icon: '◶', iconHint: 'gauge motor driver', defaultLabel: 'X27 driver gauge', protocolKey: 'gauge.x27.driver', power: ['5V', 'GND'], roles: [{ role: 'step', label: 'STEP', kind: 'digital' }, { role: 'dir', label: 'DIR', kind: 'digital' }, { role: 'en', label: 'EN enable', kind: 'digital', optional: true }], defaultWiringNotes: ['Connect STEP and DIR to digital outputs.', 'Use the driver board power recommendations and common GND.'] },
  { id: '28byj48-stepper', type: 'gauge', name: '28BYJ-48 stepper with ULN2003', shortName: '28BYJ-48', description: 'Small geared stepper motor, commonly sold with a ULN2003 driver board.', plainLanguageDescription: 'A cheap small stepper motor for slow indicators or mechanisms.', category: 'Motors', icon: '◴', iconHint: 'geared stepper motor', defaultLabel: '28BYJ-48 stepper', protocolKey: 'gauge.28byj48', power: ['5V', 'GND'], roles: [{ role: 'in1', label: 'IN1', kind: 'digital' }, { role: 'in2', label: 'IN2', kind: 'digital' }, { role: 'in3', label: 'IN3', kind: 'digital' }, { role: 'in4', label: 'IN4', kind: 'digital' }], defaultWiringNotes: ['Use the ULN2003 driver board; do not connect motor coils directly to GPIO.', 'External 5V power is recommended; keep common GND.'] },

  { id: 'dht11', type: 'control', name: 'DHT11 temperature/humidity sensor', shortName: 'DHT11', description: 'Basic digital temperature and humidity sensor.', plainLanguageDescription: 'A simple sensor for room temperature and humidity.', category: 'Sensors', icon: '♨', iconHint: 'temperature humidity sensor', defaultLabel: 'DHT11 sensor', protocolKey: 'sensor.dht11', power: ['5V', '3V3', 'GND'], roles: [{ role: 'data', label: 'DATA', kind: 'digital' }], defaultWiringNotes: ['DATA goes to a digital pin; many bare sensors need a 4.7k-10k pull-up resistor.', ...powerCommon] },
  { id: 'dht22', type: 'control', name: 'DHT22 / AM2302 temperature/humidity sensor', shortName: 'DHT22', description: 'More accurate digital temperature and humidity sensor.', plainLanguageDescription: 'A better temperature/humidity sensor with one data wire.', category: 'Sensors', icon: '♨', iconHint: 'temperature humidity sensor', defaultLabel: 'DHT22 sensor', protocolKey: 'sensor.dht22', power: ['5V', '3V3', 'GND'], roles: [{ role: 'data', label: 'DATA', kind: 'digital' }], defaultWiringNotes: ['DATA goes to a digital pin; many bare sensors need a 4.7k-10k pull-up resistor.', ...powerCommon] },
  { id: 'ntc-thermistor', type: 'control', name: 'NTC thermistor', shortName: 'Thermistor', description: 'Analog temperature sensor using a resistor divider.', plainLanguageDescription: 'A tiny resistor that changes value with temperature.', category: 'Sensors', icon: '⌁', iconHint: 'thermistor bead', defaultLabel: 'Thermistor', protocolKey: 'sensor.ntc', power: ['5V', '3V3', 'GND'], roles: [{ role: 'signal', label: 'Divider signal', kind: 'analog', muxCapable: true }], defaultWiringNotes: ['Use a fixed resistor to make a lapge divider, then read the middle point on an analog input.', 'Use the board logic lapge for the divider high side.'] },
  { id: 'photoresistor', type: 'control', name: 'Photoresistor / LDR', shortName: 'LDR', description: 'Analog light sensor using a resistor divider.', plainLanguageDescription: 'A light-sensitive resistor for ambient brightness.', category: 'Sensors', icon: '☼', iconHint: 'light sensor', defaultLabel: 'Light sensor', protocolKey: 'sensor.ldr', power: ['5V', '3V3', 'GND'], roles: [{ role: 'signal', label: 'Divider signal', kind: 'analog', muxCapable: true }], defaultWiringNotes: ['Use a fixed resistor to make a lapge divider.', 'Read the divider midpoint on an analog input.'] },
  { id: 'mpu6050', type: 'control', name: 'MPU6050 accelerometer/gyro', shortName: 'MPU6050', description: '6-axis motion sensor over I2C.', plainLanguageDescription: 'Senses tilt, movement and vibration using the I2C bus.', category: 'Sensors', icon: '◈', iconHint: 'motion sensor board', defaultLabel: 'MPU6050', protocolKey: 'sensor.mpu6050', power: ['3V3', '5V', 'GND'], roles: [{ role: 'sda', label: 'SDA', kind: 'i2c' }, { role: 'scl', label: 'SCL', kind: 'i2c' }, { role: 'int', label: 'INT interrupt', kind: 'digital', optional: true }], defaults: { address: '0x68' }, defaultWiringNotes: ['SDA/SCL share the I2C bus with screens/expanders.', 'INT is optional and can go to an interrupt-capable digital pin.'] },

  { id: 'ws2812-matrix-8x16', type: 'rgbMatrix', name: 'WS2812 8x16 RGB matrix', shortName: '8x16 RGB matrix', description: '128-pixel addressable RGB matrix for flags, telemetry icons and large rev lights.', plainLanguageDescription: 'A wide RGB LED panel controlled by one data wire.', category: 'Lights', icon: '▦', iconHint: 'wide RGB LED matrix', defaultLabel: 'RGB matrix 8x16', protocolKey: 'rgbMatrix.ws2812.8x16', power: ['5V', 'GND'], roles: [{ role: 'data', label: 'DIN data', kind: 'digital' }], defaults: { width: 16, height: 8, chip: 'ws2812' }, defaultWiringNotes: ['DIN goes to one digital output pin.', 'Use external 5V power; 128 LEDs can draw several amps at high brightness.', 'Connect LED supply GND and board GND together.'] },
  { id: 'ws2812-matrix-8x32', type: 'rgbMatrix', name: 'WS2812 8x32 RGB matrix', shortName: '8x32 RGB matrix', description: '256-pixel addressable RGB matrix for banners, flags and dashboard animations.', plainLanguageDescription: 'A long RGB LED panel controlled by one data wire.', category: 'Lights', icon: '▦', iconHint: 'long RGB LED matrix', defaultLabel: 'RGB matrix 8x32', protocolKey: 'rgbMatrix.ws2812.8x32', power: ['5V', 'GND'], roles: [{ role: 'data', label: 'DIN data', kind: 'digital' }], defaults: { width: 32, height: 8, chip: 'ws2812' }, defaultWiringNotes: ['DIN goes to one digital output pin.', 'Use a fused external 5V supply sized for the LED count.', 'Do not power this matrix from the board 5V pin.'] },
  { id: 'max7219-matrix-8x16', type: 'rgbMatrix', name: 'MAX7219 8x16 LED matrix', shortName: 'MAX7219 8x16', description: 'Two chained 8x8 single-color LED matrices driven by MAX7219.', plainLanguageDescription: 'A two-panel one-color LED display using SPI-style wiring.', category: 'Screens', icon: '▦', iconHint: 'two MAX7219 matrices', defaultLabel: 'MAX7219 8x16', protocolKey: 'matrix.max7219.8x16', power: ['5V', 'GND'], roles: [{ role: 'din', label: 'DIN / MOSI', kind: 'spi' }, { role: 'clk', label: 'CLK / SCK', kind: 'spi' }, { role: 'cs', label: 'CS / LOAD', kind: 'spi' }], defaults: { width: 16, height: 8, chip: 'max7219' }, defaultWiringNotes: ['Use DIN, CLK and CS/LOAD. Hardware SPI pins are preferred.', 'Modules are commonly chained; DOUT from one module feeds DIN on the next.'] },
  { id: 'max7219-matrix-8x32', type: 'rgbMatrix', name: 'MAX7219 8x32 LED matrix', shortName: 'MAX7219 8x32', description: 'Four chained 8x8 MAX7219 modules for wide single-color text/icons.', plainLanguageDescription: 'A wide one-color LED display using three SPI-style wires.', category: 'Screens', icon: '▦', iconHint: 'four MAX7219 matrices', defaultLabel: 'MAX7219 8x32', protocolKey: 'matrix.max7219.8x32', power: ['5V', 'GND'], roles: [{ role: 'din', label: 'DIN / MOSI', kind: 'spi' }, { role: 'clk', label: 'CLK / SCK', kind: 'spi' }, { role: 'cs', label: 'CS / LOAD', kind: 'spi' }], defaults: { width: 32, height: 8, chip: 'max7219' }, defaultWiringNotes: ['Use DIN, CLK and CS/LOAD. Hardware SPI pins are preferred.', 'Power from a solid 5V rail and keep common GND.'] },
  { id: 'sk6812-rgbw-strip', type: 'rgbStrip', name: 'SK6812 RGBW LED strip', shortName: 'SK6812 RGBW', description: 'Addressable RGBW strip with a dedicated white channel.', plainLanguageDescription: 'Many RGB+white LEDs controlled by one data wire.', category: 'Lights', icon: '═', iconHint: 'RGBW LED strip', defaultLabel: 'RGBW strip', protocolKey: 'rgbStrip.sk6812', power: ['5V', 'GND'], roles: [{ role: 'data', label: 'DIN data', kind: 'digital' }], defaults: { ledCount: 16, chip: 'sk6812' }, defaultWiringNotes: ['DIN goes to a digital pin.', 'Use external 5V for more than a few LEDs and common GND.'] },
  { id: 'ws2812-ring', type: 'rgbStrip', name: 'WS2812 LED ring', shortName: 'NeoPixel ring', description: 'Circular addressable RGB LEDs for status, revs or button backlight.', plainLanguageDescription: 'A ring of RGB LEDs controlled by one data wire.', category: 'Lights', icon: '◎', iconHint: 'LED ring', defaultLabel: 'LED ring', protocolKey: 'rgbStrip.ring', power: ['5V', 'GND'], roles: [{ role: 'data', label: 'DIN data', kind: 'digital' }], defaults: { ledCount: 16, chip: 'ws2812' }, defaultWiringNotes: ['DIN goes to a digital pin.', 'Use a 330Ω data resistor and common GND when possible.'] },
  { id: '12v-led-strip-mosfet', type: 'actuator', name: '12V LED strip via MOSFET', shortName: '12V LED MOSFET', description: 'Non-addressable 12V LED strip dimmed by a logic-level MOSFET.', plainLanguageDescription: 'A bright single-color strip; the board only controls the MOSFET gate.', category: 'Lights', icon: '▰', iconHint: 'LED strip and MOSFET', defaultLabel: '12V LED strip', protocolKey: 'actuator.ledStrip.mosfet', power: ['VIN', 'GND'], roles: [{ role: 'gate', label: 'MOSFET gate / PWM', kind: 'pwm' }], defaults: { driver: 'logic-level N-MOSFET', externalLapge: 12 }, defaultWiringNotes: ['Do not drive the LED strip directly from a GPIO pin.', 'Use a logic-level N-MOSFET/transistor driver and an external 12V supply.', 'Connect external supply GND to board GND.'] },
  { id: 'led-bargraph', type: 'startLed', name: '10-segment LED bar graph', shortName: 'LED bar graph', description: 'Linear LED bar for RPM, throttle or status indication.', plainLanguageDescription: 'Ten small LEDs in a row; each segment needs a signal or driver.', category: 'Lights', icon: '▥', iconHint: 'LED bar graph', defaultLabel: 'LED bar', protocolKey: 'light.bargraph', power: ['5V', 'GND'], roles: Array.from({ length: 10 }, (_, index) => ({ role: `seg${index + 1}`, label: `Segment ${index + 1}`, kind: 'digital' as const, muxCapable: true })), defaultWiringNotes: ['Each segment needs current limiting.', 'Use a shift register or LED driver if you are short on pins.'] },

  { id: 'st7789-tft', type: 'screen', name: 'ST7789 IPS TFT display', shortName: 'ST7789 TFT', description: 'Common 1.3-2.0 inch SPI color IPS display.', plainLanguageDescription: 'A sharp small color screen for telemetry pages.', category: 'Screens', icon: '▣', iconHint: 'IPS TFT screen', defaultLabel: 'ST7789 TFT', protocolKey: 'screen.tft.st7789', power: ['3V3', '5V', 'GND'], roles: [{ role: 'mosi', label: 'MOSI / DIN', kind: 'spi' }, { role: 'sck', label: 'SCK / CLK', kind: 'spi' }, { role: 'cs', label: 'CS', kind: 'spi', optional: true }, { role: 'dc', label: 'DC', kind: 'digital' }, { role: 'rst', label: 'RST', kind: 'digital', optional: true }, { role: 'bl', label: 'Backlight', kind: 'pwm', optional: true }], defaultWiringNotes: spiNotes },
  { id: 'gc9a01-round-tft', type: 'screen', name: 'GC9A01 round TFT display', shortName: 'Round TFT', description: 'Round 240x240 SPI display for gauges and decorative telemetry.', plainLanguageDescription: 'A round color screen for a gauge-style display.', category: 'Screens', icon: '◉', iconHint: 'round TFT display', defaultLabel: 'Round TFT', protocolKey: 'screen.tft.gc9a01', power: ['3V3', 'GND'], roles: [{ role: 'mosi', label: 'MOSI / DIN', kind: 'spi' }, { role: 'sck', label: 'SCK / CLK', kind: 'spi' }, { role: 'cs', label: 'CS', kind: 'spi' }, { role: 'dc', label: 'DC', kind: 'digital' }, { role: 'rst', label: 'RST', kind: 'digital', optional: true }, { role: 'bl', label: 'Backlight', kind: 'pwm', optional: true }], defaultWiringNotes: ['Most GC9A01 modules are 3.3V logic; use level shifting with 5V boards.', ...spiNotes] },
  { id: 'nokia-5110-lcd', type: 'screen', name: 'Nokia 5110 PCD8544 LCD', shortName: 'Nokia 5110', description: 'Low-power monochrome LCD using SPI-style wiring.', plainLanguageDescription: 'A small low-power black-and-white screen.', category: 'Screens', icon: '▭', iconHint: 'Nokia LCD', defaultLabel: 'Nokia LCD', protocolKey: 'screen.pcd8544', power: ['3V3', 'GND'], roles: [{ role: 'din', label: 'DIN / MOSI', kind: 'spi' }, { role: 'clk', label: 'CLK / SCK', kind: 'spi' }, { role: 'cs', label: 'CE / CS', kind: 'spi' }, { role: 'dc', label: 'DC', kind: 'digital' }, { role: 'rst', label: 'RST', kind: 'digital' }, { role: 'bl', label: 'Backlight', kind: 'pwm', optional: true }], defaultWiringNotes: ['PCD8544 modules are normally 3.3V logic.', 'Use a level shifter on 5V boards.'] },
  { id: 'epaper-spi', type: 'screen', name: 'SPI e-paper display', shortName: 'E-paper', description: 'Low-power black/white e-paper display for labels and static status.', plainLanguageDescription: 'A screen that keeps the image when power is removed.', category: 'Screens', icon: '▧', iconHint: 'e-paper display', defaultLabel: 'E-paper display', protocolKey: 'screen.epaper.spi', power: ['3V3', 'GND'], roles: [{ role: 'mosi', label: 'DIN / MOSI', kind: 'spi' }, { role: 'sck', label: 'CLK / SCK', kind: 'spi' }, { role: 'cs', label: 'CS', kind: 'spi' }, { role: 'dc', label: 'DC', kind: 'digital' }, { role: 'rst', label: 'RST', kind: 'digital' }, { role: 'busy', label: 'BUSY', kind: 'digital' }], defaultWiringNotes: ['Most e-paper boards are 3.3V logic.', 'BUSY is an input from the display module.'] },
  { id: 'nextion-uart-display', type: 'screen', name: 'Nextion UART touchscreen', shortName: 'Nextion UART', description: 'Smart serial touchscreen module that renders its own UI.', plainLanguageDescription: 'A touchscreen that talks to the board over serial RX/TX.', category: 'Screens', icon: '▣', iconHint: 'touchscreen module', defaultLabel: 'Nextion display', protocolKey: 'screen.nextion.uart', power: ['5V', 'GND'], roles: [{ role: 'rx', label: 'Board RX ← Nextion TX', kind: 'uart' }, { role: 'tx', label: 'Board TX → Nextion RX', kind: 'uart' }], defaultWiringNotes: ['Cross UART: module TX goes to board RX; module RX goes to board TX.', 'Use a dedicated hardware serial port when possible.'] },
  { id: 'ht16k33-7seg', type: 'segDisplay', name: 'HT16K33 I2C 7-segment display', shortName: 'HT16K33 7-seg', description: 'I2C LED driver for 4-digit 7-segment displays.', plainLanguageDescription: 'A numeric LED display that shares the I2C bus.', category: 'Screens', icon: '8', iconHint: 'I2C seven segment display', defaultLabel: 'I2C 7-seg display', protocolKey: 'seg.ht16k33', power: ['5V', '3V3', 'GND'], roles: [{ role: 'sda', label: 'SDA', kind: 'i2c' }, { role: 'scl', label: 'SCL', kind: 'i2c' }], defaults: { address: '0x70' }, defaultWiringNotes: i2cNotes },

  { id: 'pam8403-amplifier', type: 'buzzer', name: 'PAM8403 audio amplifier', shortName: 'PAM8403 amp', description: 'Small stereo amplifier module for speakers or alert tones.', plainLanguageDescription: 'An amplifier board for small speakers; audio comes from a PWM/DAC-style signal.', category: 'Sound', icon: '▰', iconHint: 'amplifier board', defaultLabel: 'Audio amplifier', protocolKey: 'sound.pam8403', power: ['5V', 'GND'], roles: [{ role: 'signal', label: 'Audio/PWM signal', kind: 'pwm' }], defaultWiringNotes: ['Do not drive a speaker directly from a GPIO pin.', 'Feed the amplifier from a PWM/audio output and power it from a suitable 5V rail.'] },
  { id: 'dfplayer-mini', type: 'buzzer', name: 'DFPlayer Mini MP3 module', shortName: 'DFPlayer Mini', description: 'Serial MP3 playback module for voice prompts and sounds.', plainLanguageDescription: 'A tiny MP3 player controlled by UART RX/TX.', category: 'Sound', icon: '♫', iconHint: 'MP3 module', defaultLabel: 'MP3 player', protocolKey: 'sound.dfplayer', power: ['5V', 'GND'], roles: [{ role: 'rx', label: 'Board RX ← DFPlayer TX', kind: 'uart' }, { role: 'tx', label: 'Board TX → DFPlayer RX', kind: 'uart' }, { role: 'busy', label: 'BUSY', kind: 'digital', optional: true }], defaultWiringNotes: ['Cross TX/RX between the board and module.', 'Use the module speaker outputs or an amplifier; do not connect a speaker to GPIO.'] },
  { id: 'analog-microphone', type: 'control', name: 'Analog microphone module', shortName: 'Microphone', description: 'Electret/MAX4466-style analog microphone module.', plainLanguageDescription: 'A small sound level sensor read by an analog input.', category: 'Sound', icon: '◍', iconHint: 'microphone', defaultLabel: 'Microphone', protocolKey: 'sound.microphone.analog', power: ['5V', '3V3', 'GND'], roles: [{ role: 'signal', label: 'Analog out', kind: 'analog', muxCapable: true }], defaultWiringNotes: ['OUT goes to an analog input.', 'Use the board logic lapge for the module when supported.'] },

  { id: 'bass-shaker-mosfet', type: 'actuator', name: 'Bass shaker via MOSFET/amplifier', shortName: 'Bass shaker', description: 'Tactile transducer controlled by a driver, amplifier or MOSFET stage.', plainLanguageDescription: 'A vibration transducer for sim feedback; the board only sends a control/PWM signal.', category: 'Haptics', icon: '≈', iconHint: 'bass shaker vibration', defaultLabel: 'Bass shaker', protocolKey: 'haptics.bassShaker', power: ['VIN', 'GND'], roles: [{ role: 'control', label: 'Driver control / PWM', kind: 'pwm' }], defaults: { driver: 'MOSFET or audio amplifier', externalPower: true }, defaultWiringNotes: ['Never connect a bass shaker directly to a GPIO pin.', 'Use a MOSFET/transistor driver or audio amplifier with external power sized for the shaker.', 'Connect driver GND to board GND.'] },
  { id: 'fan-mosfet', type: 'actuator', name: 'DC fan via MOSFET', shortName: 'Fan MOSFET', description: '5V/12V fan switched or speed-controlled through a MOSFET/transistor.', plainLanguageDescription: 'A cooling or wind-sim fan; the board controls a driver, not the fan directly.', category: 'Haptics', icon: '✺', iconHint: 'fan', defaultLabel: 'Fan', protocolKey: 'haptics.fan.mosfet', power: ['VIN', 'GND'], roles: [{ role: 'control', label: 'MOSFET gate / PWM', kind: 'pwm' }], defaults: { driver: 'logic-level N-MOSFET', flybackDiode: true }, defaultWiringNotes: ['Use an external supply for the fan and a logic-level MOSFET/transistor driver.', 'Add a flyback diode for brushed DC fans/motors when appropriate.', 'Keep common GND.'] },
  { id: 'vibration-motor-mosfet', type: 'actuator', name: 'Vibration motor via transistor/MOSFET', shortName: 'Vibration motor', description: 'Coin or ERM vibration motor driven through a transistor or MOSFET.', plainLanguageDescription: 'A small rumble motor; the board only controls the driver.', category: 'Haptics', icon: '≋', iconHint: 'vibration motor', defaultLabel: 'Vibration motor', protocolKey: 'haptics.vibrationMotor', power: ['5V', '3V3', 'GND'], roles: [{ role: 'control', label: 'Driver control / PWM', kind: 'pwm' }], defaultWiringNotes: ['Do not connect the motor directly to GPIO.', 'Use a transistor/MOSFET driver and flyback diode if it is a brushed motor.', 'Connect motor supply GND to board GND.'] },
  { id: 'linear-solenoid-driver', type: 'actuator', name: 'Linear solenoid via MOSFET/relay', shortName: 'Solenoid driver', description: 'Pull/push solenoid switched by a MOSFET, transistor or relay module.', plainLanguageDescription: 'A strong electromagnetic actuator; the board only switches a driver.', category: 'Haptics', icon: '▣', iconHint: 'solenoid', defaultLabel: 'Solenoid', protocolKey: 'haptics.solenoid', power: ['VIN', 'GND'], roles: [{ role: 'control', label: 'Driver control', kind: 'digital' }], defaultWiringNotes: ['Do not connect a solenoid directly to GPIO.', 'Use a MOSFET/transistor or relay driver and an external supply.', 'A flyback diode is required across the solenoid coil unless the module already has one.'] },
  { id: 'relay-module', type: 'actuator', name: 'Relay module', shortName: 'Relay', description: 'Relay board for switching an external load from one digital control pin.', plainLanguageDescription: 'An electrically isolated switch; the board controls the relay input only.', category: 'Haptics', icon: '▢', iconHint: 'relay module', defaultLabel: 'Relay module', protocolKey: 'actuator.relay', power: ['5V', 'GND'], roles: [{ role: 'control', label: 'IN control', kind: 'digital' }], defaultWiringNotes: ['Relay IN goes to a digital pin; relay coil power comes from the module supply.', 'Keep dangerous/high-current wiring separate and fused.', 'Many relay modules are active-low; note this in firmware settings.'] },

  { id: 'matrix-keypad-4x4', type: 'control', name: '4x4 matrix keypad', shortName: '4x4 keypad', description: 'Sixteen buttons arranged as four rows and four columns.', plainLanguageDescription: 'A keypad that uses eight digital pins for sixteen buttons.', category: 'Inputs', icon: '▦', iconHint: 'keypad', defaultLabel: 'Keypad', protocolKey: 'control.keypad.4x4', power: ['GND'], roles: ['r1', 'r2', 'r3', 'r4', 'c1', 'c2', 'c3', 'c4'].map((role) => ({ role, label: role.toUpperCase(), kind: 'digital' as const })), defaultWiringNotes: ['Rows and columns go to digital pins.', 'Firmware scans rows/columns; do not use a MUX for this entry.'] },
  { id: 'limit-switch', type: 'control', name: 'Limit / microswitch', shortName: 'Microswitch', description: 'Small lever switch for shifters, pedals and end stops.', plainLanguageDescription: 'A clicky switch read like a normal button.', category: 'Inputs', icon: '⎎', iconHint: 'microswitch', defaultLabel: 'Microswitch', protocolKey: 'control.limitSwitch', power: ['GND'], roles: [{ role: 'signal', label: 'Signal', kind: 'digital', muxCapable: true }], defaultWiringNotes: buttonNotes },
  { id: 'dip-switch-8', type: 'control', name: '8-position DIP switch', shortName: 'DIP switch', description: 'Bank of eight tiny configuration switches.', plainLanguageDescription: 'Eight small on/off switches for modes or IDs.', category: 'Inputs', icon: '▥', iconHint: 'DIP switch bank', defaultLabel: 'DIP switch', protocolKey: 'control.dip8', power: ['GND'], roles: Array.from({ length: 8 }, (_, index) => ({ role: `sw${index + 1}`, label: `Switch ${index + 1}`, kind: 'digital' as const, muxCapable: true })), defaultWiringNotes: ['Wire each switch to GND and a digital input with internal pull-up.', 'A MUX or shift register is recommended if pins are scarce.'] },
  { id: 'ttp223-touch', type: 'control', name: 'TTP223 capacitive touch button', shortName: 'Touch button', description: 'Single capacitive touch input module with digital output.', plainLanguageDescription: 'A no-moving-parts touch button.', category: 'Inputs', icon: '◌', iconHint: 'touch button', defaultLabel: 'Touch button', protocolKey: 'control.touch.ttp223', power: ['5V', '3V3', 'GND'], roles: [{ role: 'signal', label: 'OUT signal', kind: 'digital', muxCapable: true }], defaultWiringNotes: ['OUT goes to a digital input.', 'Check module jumpers for active-high/active-low behavior.'] },
  { id: 'mpr121-touch', type: 'control', name: 'MPR121 12-key capacitive touch', shortName: 'MPR121 touch', description: 'I2C capacitive touch controller with up to 12 electrodes.', plainLanguageDescription: 'Adds up to twelve touch buttons using the I2C bus.', category: 'Inputs', icon: '◍', iconHint: 'touch controller', defaultLabel: 'Touch controller', protocolKey: 'control.touch.mpr121', power: ['3V3', 'GND'], roles: [{ role: 'sda', label: 'SDA', kind: 'i2c' }, { role: 'scl', label: 'SCL', kind: 'i2c' }, { role: 'irq', label: 'IRQ', kind: 'digital', optional: true }], defaults: { address: '0x5A' }, defaultWiringNotes: ['MPR121 is normally 3.3V logic.', 'IRQ is optional; SDA/SCL share the I2C bus.'] },
  { id: 'as5600-magnetic-encoder', type: 'control', name: 'AS5600 magnetic absolute encoder', shortName: 'AS5600 encoder', description: 'Contactless 12-bit magnetic angle sensor over I2C.', plainLanguageDescription: 'A magnetic knob/position sensor that reports an absolute angle.', category: 'Inputs', icon: '◉', iconHint: 'magnetic encoder', defaultLabel: 'AS5600 encoder', protocolKey: 'control.encoder.as5600', power: ['5V', '3V3', 'GND'], roles: [{ role: 'sda', label: 'SDA', kind: 'i2c' }, { role: 'scl', label: 'SCL', kind: 'i2c' }], defaults: { address: '0x36' }, defaultWiringNotes: i2cNotes },
  { id: 'hx711-load-cell', type: 'control', name: 'HX711 load cell amplifier', shortName: 'HX711', description: '24-bit load-cell amplifier for pedals, shifters or force sensors.', plainLanguageDescription: 'Reads a strain gauge/load cell using two digital wires.', category: 'Inputs', icon: '◫', iconHint: 'load cell amplifier', defaultLabel: 'Load cell', protocolKey: 'control.loadCell.hx711', power: ['5V', '3V3', 'GND'], roles: [{ role: 'data', label: 'DOUT data', kind: 'digital' }, { role: 'clock', label: 'SCK clock', kind: 'digital' }], defaultWiringNotes: ['DOUT is read by the board; SCK is driven by firmware.', 'Use stable power and strain relief for load-cell wiring.'] },

  { id: 'ds18b20', type: 'control', name: 'DS18B20 temperature sensor', shortName: 'DS18B20', description: '1-Wire digital temperature probe.', plainLanguageDescription: 'A digital temperature probe using one data pin.', category: 'Sensors', icon: '♨', iconHint: 'temperature probe', defaultLabel: 'DS18B20', protocolKey: 'sensor.ds18b20', power: ['5V', '3V3', 'GND'], roles: [{ role: 'data', label: '1-Wire DATA', kind: 'digital' }], defaultWiringNotes: ['DATA needs a 4.7k pull-up to the sensor lapge.', 'Multiple DS18B20 sensors can share one data wire if firmware supports addresses.'] },
  { id: 'lm35-temperature', type: 'control', name: 'LM35 analog temperature sensor', shortName: 'LM35', description: 'Analog temperature sensor with lapge proportional to Celsius.', plainLanguageDescription: 'A temperature sensor read by an analog input.', category: 'Sensors', icon: '♨', iconHint: 'analog temperature sensor', defaultLabel: 'LM35', protocolKey: 'sensor.lm35', power: ['5V', 'GND'], roles: [{ role: 'signal', label: 'Analog out', kind: 'analog', muxCapable: true }], defaultWiringNotes: ['OUT goes to an analog input.', 'Check lapge range before using with 3.3V boards.'] },
  { id: 'bme280-i2c', type: 'control', name: 'BME280 temperature/humidity/pressure', shortName: 'BME280', description: 'Environmental sensor using I2C.', plainLanguageDescription: 'Measures temperature, humidity and air pressure on the I2C bus.', category: 'Sensors', icon: '☁', iconHint: 'environment sensor', defaultLabel: 'BME280', protocolKey: 'sensor.bme280', power: ['3V3', '5V', 'GND'], roles: [{ role: 'sda', label: 'SDA', kind: 'i2c' }, { role: 'scl', label: 'SCL', kind: 'i2c' }], defaults: { address: '0x76' }, defaultWiringNotes: i2cNotes },
  { id: 'bmp280-spi', type: 'control', name: 'BMP280 pressure sensor SPI', shortName: 'BMP280 SPI', description: 'Barometric pressure sensor using SPI.', plainLanguageDescription: 'Measures air pressure/altitude using SPI wires.', category: 'Sensors', icon: '☁', iconHint: 'pressure sensor', defaultLabel: 'BMP280 SPI', protocolKey: 'sensor.bmp280.spi', power: ['3V3', 'GND'], roles: [{ role: 'mosi', label: 'SDI / MOSI', kind: 'spi' }, { role: 'miso', label: 'SDO / MISO', kind: 'spi' }, { role: 'sck', label: 'SCK', kind: 'spi' }, { role: 'cs', label: 'CS', kind: 'spi' }], defaultWiringNotes: ['Most BMP280 boards are 3.3V logic unless they include level shifting.', ...spiNotes] },
  { id: 'hc-sr04-ultrasonic', type: 'control', name: 'HC-SR04 ultrasonic distance sensor', shortName: 'HC-SR04', description: 'Ultrasonic distance module with trigger and echo pins.', plainLanguageDescription: 'Measures distance with sound pulses using two digital pins.', category: 'Sensors', icon: '⌁', iconHint: 'ultrasonic sensor', defaultLabel: 'Ultrasonic sensor', protocolKey: 'sensor.hcsr04', power: ['5V', 'GND'], roles: [{ role: 'trig', label: 'TRIG output', kind: 'digital' }, { role: 'echo', label: 'ECHO input', kind: 'digital' }], defaultWiringNotes: ['TRIG is driven by the board; ECHO is read by the board.', 'ECHO is 5V on classic HC-SR04, so use a divider/level shifter for 3.3V boards.'] },
  { id: 'vl53l0x-tof', type: 'control', name: 'VL53L0X time-of-flight distance sensor', shortName: 'VL53L0X', description: 'Laser time-of-flight distance sensor over I2C.', plainLanguageDescription: 'A small accurate distance sensor using I2C.', category: 'Sensors', icon: '⌖', iconHint: 'laser distance sensor', defaultLabel: 'ToF distance sensor', protocolKey: 'sensor.vl53l0x', power: ['3V3', '5V', 'GND'], roles: [{ role: 'sda', label: 'SDA', kind: 'i2c' }, { role: 'scl', label: 'SCL', kind: 'i2c' }, { role: 'xshut', label: 'XSHUT', kind: 'digital', optional: true }], defaults: { address: '0x29' }, defaultWiringNotes: i2cNotes },
  { id: 'tcrt5000-ir-reflective', type: 'control', name: 'TCRT5000 IR reflective sensor', shortName: 'TCRT5000', description: 'Reflective infrared sensor module for slots, wheels or presence detection.', plainLanguageDescription: 'Detects nearby reflective surfaces with infrared light.', category: 'Sensors', icon: '◖', iconHint: 'IR reflective sensor', defaultLabel: 'IR reflective sensor', protocolKey: 'sensor.tcrt5000', power: ['5V', '3V3', 'GND'], roles: [{ role: 'digitalOut', label: 'Digital OUT', kind: 'digital', muxCapable: true }, { role: 'analogOut', label: 'Analog OUT', kind: 'analog', optional: true, muxCapable: true }], defaultWiringNotes: ['Use digital OUT for threshold detection or analog OUT for raw level.', ...powerCommon] },
  { id: 'mq2-gas-sensor', type: 'control', name: 'MQ-2 gas/smoke sensor', shortName: 'MQ-2', description: 'Analog gas/smoke sensor module.', plainLanguageDescription: 'A gas/smoke sensor read by analog or digital threshold output.', category: 'Sensors', icon: '☁', iconHint: 'gas sensor', defaultLabel: 'MQ-2 sensor', protocolKey: 'sensor.mq2', power: ['5V', 'GND'], roles: [{ role: 'analogOut', label: 'Analog OUT', kind: 'analog', muxCapable: true }, { role: 'digitalOut', label: 'Digital OUT', kind: 'digital', optional: true, muxCapable: true }], defaultWiringNotes: ['MQ sensors draw significant heater current; do not power many from the board regulator.', 'AOUT goes to analog; DOUT is thresholded by the module potentiometer.'] },
  { id: 'pir-motion', type: 'control', name: 'PIR motion sensor', shortName: 'PIR motion', description: 'Passive infrared motion detector module.', plainLanguageDescription: 'Detects movement of warm objects/people.', category: 'Sensors', icon: '◌', iconHint: 'motion sensor', defaultLabel: 'PIR motion sensor', protocolKey: 'sensor.pir', power: ['5V', '3V3', 'GND'], roles: [{ role: 'signal', label: 'OUT signal', kind: 'digital' }], defaultWiringNotes: ['OUT goes to a digital input.', 'Most modules need a warm-up time after power-on.'] },
  { id: 'ina219-current', type: 'control', name: 'INA219 current/lapge sensor', shortName: 'INA219', description: 'I2C high-side current and bus-lapge monitor.', plainLanguageDescription: 'Measures current and lapge using the I2C bus.', category: 'Sensors', icon: 'A', iconHint: 'current sensor', defaultLabel: 'Current sensor', protocolKey: 'sensor.ina219', power: ['3V3', '5V', 'GND'], roles: [{ role: 'sda', label: 'SDA', kind: 'i2c' }, { role: 'scl', label: 'SCL', kind: 'i2c' }], defaults: { address: '0x40' }, defaultWiringNotes: ['SDA/SCL share the I2C bus.', 'Wire the load current path through VIN+/VIN- per the module rating.'] },
  { id: 'acs712-current', type: 'control', name: 'ACS712 analog current sensor', shortName: 'ACS712', description: 'Hall-effect current sensor with analog output.', plainLanguageDescription: 'Measures current and outputs a lapge for an analog input.', category: 'Sensors', icon: 'A', iconHint: 'analog current sensor', defaultLabel: 'Analog current sensor', protocolKey: 'sensor.acs712', power: ['5V', 'GND'], roles: [{ role: 'signal', label: 'Analog OUT', kind: 'analog', muxCapable: true }], defaultWiringNotes: ['OUT goes to an analog input.', 'Use only within the module current and isolation ratings.'] },
  { id: 'soil-moisture', type: 'control', name: 'Soil moisture / generic analog probe', shortName: 'Analog probe', description: 'Generic analog probe module with optional threshold output.', plainLanguageDescription: 'A simple analog sensor module; useful as a generic probe placeholder.', category: 'Sensors', icon: '⌁', iconHint: 'probe sensor', defaultLabel: 'Analog probe', protocolKey: 'sensor.analogProbe', power: ['5V', '3V3', 'GND'], roles: [{ role: 'analogOut', label: 'Analog OUT', kind: 'analog', muxCapable: true }, { role: 'digitalOut', label: 'Digital OUT', kind: 'digital', optional: true, muxCapable: true }], defaultWiringNotes: ['Use analog OUT for raw reading or digital OUT for threshold modules.', ...powerCommon] },

  { id: 'dc-motor-mosfet', type: 'gauge', name: 'DC motor via MOSFET', shortName: 'DC motor MOSFET', description: 'Brushed DC motor driven through a MOSFET/transistor.', plainLanguageDescription: 'A DC motor; the board only controls the driver gate.', category: 'Motors', icon: '◉', iconHint: 'DC motor', defaultLabel: 'DC motor', protocolKey: 'motor.dc.mosfet', power: ['VIN', 'GND'], roles: [{ role: 'control', label: 'MOSFET gate / PWM', kind: 'pwm' }], defaultWiringNotes: ['Do not connect motor terminals to GPIO.', 'Use a MOSFET/transistor driver, external power and flyback diode.', 'Keep common GND.'] },
  { id: 'l298n-driver', type: 'gauge', name: 'L298N dual H-bridge driver', shortName: 'L298N driver', description: 'Dual DC motor/stepper driver module.', plainLanguageDescription: 'A motor driver board controlled by direction pins and optional PWM enables.', category: 'Motors', icon: '▣', iconHint: 'motor driver', defaultLabel: 'L298N driver', protocolKey: 'motor.driver.l298n', power: ['VIN', '5V', 'GND'], roles: [{ role: 'in1', label: 'IN1', kind: 'digital' }, { role: 'in2', label: 'IN2', kind: 'digital' }, { role: 'ena', label: 'ENA PWM', kind: 'pwm', optional: true }, { role: 'in3', label: 'IN3', kind: 'digital', optional: true }, { role: 'in4', label: 'IN4', kind: 'digital', optional: true }, { role: 'enb', label: 'ENB PWM', kind: 'pwm', optional: true }], defaultWiringNotes: ['Motor power goes to the driver module, not the board.', 'Use ENA/ENB jumpers or PWM pins for speed control.', 'Keep common GND.'] },
  { id: 'tb6612fng-driver', type: 'gauge', name: 'TB6612FNG dual motor driver', shortName: 'TB6612FNG', description: 'Efficient dual H-bridge motor driver module.', plainLanguageDescription: 'A compact motor driver controlled by digital direction pins and PWM.', category: 'Motors', icon: '▣', iconHint: 'motor driver', defaultLabel: 'TB6612 driver', protocolKey: 'motor.driver.tb6612', power: ['VIN', '3V3', '5V', 'GND'], roles: [{ role: 'ain1', label: 'AIN1', kind: 'digital' }, { role: 'ain2', label: 'AIN2', kind: 'digital' }, { role: 'pwma', label: 'PWMA', kind: 'pwm' }, { role: 'stby', label: 'STBY', kind: 'digital' }, { role: 'bin1', label: 'BIN1', kind: 'digital', optional: true }, { role: 'bin2', label: 'BIN2', kind: 'digital', optional: true }, { role: 'pwmb', label: 'PWMB', kind: 'pwm', optional: true }], defaultWiringNotes: ['VM motor power is external; VCC logic follows the board.', 'Keep common GND and respect motor current limits.'] },
  { id: 'a4988-stepper-driver', type: 'gauge', name: 'A4988 stepper driver', shortName: 'A4988', description: 'Step/dir driver for NEMA-style bipolar stepper motors.', plainLanguageDescription: 'A stepper driver controlled by STEP and DIR pins.', category: 'Motors', icon: '◷', iconHint: 'stepper driver', defaultLabel: 'A4988 driver', protocolKey: 'motor.stepper.a4988', power: ['VIN', '5V', 'GND'], roles: [{ role: 'step', label: 'STEP', kind: 'digital' }, { role: 'dir', label: 'DIR', kind: 'digital' }, { role: 'en', label: 'EN enable', kind: 'digital', optional: true }], defaultWiringNotes: ['Set current limit before connecting the motor.', 'Motor supply goes to VMOT/GND with the recommended capacitor.', 'Do not hot-plug stepper motors.'] },
  { id: 'drv8825-stepper-driver', type: 'gauge', name: 'DRV8825 stepper driver', shortName: 'DRV8825', description: 'Step/dir driver for bipolar stepper motors with higher lapge support.', plainLanguageDescription: 'A stronger stepper driver controlled by STEP and DIR pins.', category: 'Motors', icon: '◷', iconHint: 'stepper driver', defaultLabel: 'DRV8825 driver', protocolKey: 'motor.stepper.drv8825', power: ['VIN', '5V', 'GND'], roles: [{ role: 'step', label: 'STEP', kind: 'digital' }, { role: 'dir', label: 'DIR', kind: 'digital' }, { role: 'en', label: 'EN enable', kind: 'digital', optional: true }], defaultWiringNotes: ['Set current limit and microstep pins per your motor.', 'Use external motor power and common GND.'] },

  { id: 'esp01-wifi', type: 'comms', name: 'ESP-01 ESP8266 Wi-Fi module', shortName: 'ESP-01 Wi-Fi', description: 'ESP8266 module often used as a UART Wi-Fi coprocessor.', plainLanguageDescription: 'A Wi-Fi module connected over serial RX/TX.', category: 'Comms', icon: '≋', iconHint: 'Wi-Fi module', defaultLabel: 'ESP-01 Wi-Fi', protocolKey: 'comms.wifi.esp01', power: ['3V3', 'GND'], roles: [{ role: 'rx', label: 'Board RX ← ESP TX', kind: 'uart' }, { role: 'tx', label: 'Board TX → ESP RX', kind: 'uart' }, { role: 'en', label: 'CH_PD / EN', kind: 'digital', optional: true }, { role: 'gpio0', label: 'GPIO0 boot', kind: 'digital', optional: true }], defaultWiringNotes: ['ESP-01 is 3.3V only and can draw high current bursts.', 'Use level shifting when the board is 5V.', 'Cross UART TX/RX.'] },
  { id: 'hc05-bluetooth', type: 'comms', name: 'HC-05 Bluetooth serial module', shortName: 'HC-05 BT', description: 'Classic Bluetooth SPP serial module.', plainLanguageDescription: 'A Bluetooth serial module using UART RX/TX.', category: 'Comms', icon: 'ᛒ', iconHint: 'Bluetooth module', defaultLabel: 'Bluetooth serial', protocolKey: 'comms.bluetooth.hc05', power: ['5V', '3V3', 'GND'], roles: [{ role: 'rx', label: 'Board RX ← HC-05 TX', kind: 'uart' }, { role: 'tx', label: 'Board TX → HC-05 RX', kind: 'uart' }, { role: 'state', label: 'STATE', kind: 'digital', optional: true }, { role: 'key', label: 'KEY/EN', kind: 'digital', optional: true }], defaultWiringNotes: ['Cross TX/RX.', 'Many breakout boards accept 5V power but RX logic may still be 3.3V; use a divider/level shifter when needed.'] },
  { id: 'hc06-bluetooth', type: 'comms', name: 'HC-06 Bluetooth serial module', shortName: 'HC-06 BT', description: 'Classic Bluetooth serial slave module.', plainLanguageDescription: 'A simple Bluetooth serial link using UART RX/TX.', category: 'Comms', icon: 'ᛒ', iconHint: 'Bluetooth module', defaultLabel: 'HC-06 Bluetooth', protocolKey: 'comms.bluetooth.hc06', power: ['5V', '3V3', 'GND'], roles: [{ role: 'rx', label: 'Board RX ← HC-06 TX', kind: 'uart' }, { role: 'tx', label: 'Board TX → HC-06 RX', kind: 'uart' }], defaultWiringNotes: ['Cross TX/RX.', 'Use level shifting into module RX on 5V boards unless the breakout explicitly supports it.'] },
  { id: 'hm10-ble', type: 'comms', name: 'HM-10 BLE UART module', shortName: 'HM-10 BLE', description: 'Bluetooth Low Energy UART bridge module.', plainLanguageDescription: 'A BLE serial module connected over UART.', category: 'Comms', icon: 'ᛒ', iconHint: 'BLE module', defaultLabel: 'BLE UART', protocolKey: 'comms.ble.hm10', power: ['3V3', '5V', 'GND'], roles: [{ role: 'rx', label: 'Board RX ← HM-10 TX', kind: 'uart' }, { role: 'tx', label: 'Board TX → HM-10 RX', kind: 'uart' }, { role: 'state', label: 'STATE', kind: 'digital', optional: true }], defaultWiringNotes: ['Cross TX/RX.', 'Most bare HM-10 modules are 3.3V logic; verify the breakout board.'] },
  { id: 'nrf24l01', type: 'comms', name: 'nRF24L01 2.4GHz radio', shortName: 'nRF24L01', description: 'Low-power 2.4GHz SPI radio module.', plainLanguageDescription: 'A small wireless radio module using SPI pins.', category: 'Comms', icon: '≋', iconHint: '2.4GHz radio', defaultLabel: 'nRF24 radio', protocolKey: 'comms.rf.nrf24l01', power: ['3V3', 'GND'], roles: [{ role: 'mosi', label: 'MOSI', kind: 'spi' }, { role: 'miso', label: 'MISO', kind: 'spi' }, { role: 'sck', label: 'SCK', kind: 'spi' }, { role: 'cs', label: 'CSN / CS', kind: 'spi' }, { role: 'ce', label: 'CE', kind: 'digital' }, { role: 'irq', label: 'IRQ', kind: 'digital', optional: true }], defaultWiringNotes: ['nRF24L01 is 3.3V only; do not power it from 5V.', 'Use a capacitor near VCC/GND; radio bursts can brown out weak 3.3V rails.', 'Use level shifting with 5V boards.'] },
  { id: 'esp32-coprocessor-uart', type: 'comms', name: 'ESP32 as UART co-processor', shortName: 'ESP32 co-proc', description: 'Separate ESP32 board/module used for Wi-Fi/BLE tasks while the main MCU handles HID.', plainLanguageDescription: 'A second ESP32 connected over serial for wireless features.', category: 'Comms', icon: '≋', iconHint: 'ESP32 coprocessor', defaultLabel: 'ESP32 co-processor', protocolKey: 'comms.coprocessor.esp32.uart', power: ['3V3', '5V', 'GND'], roles: [{ role: 'rx', label: 'Board RX ← ESP32 TX', kind: 'uart' }, { role: 'tx', label: 'Board TX → ESP32 RX', kind: 'uart' }, { role: 'en', label: 'EN / reset', kind: 'digital', optional: true }, { role: 'boot', label: 'BOOT / IO0', kind: 'digital', optional: true }], defaultWiringNotes: ['Cross TX/RX and share GND.', 'ESP32 GPIO is 3.3V logic; use level shifting from 5V boards.', 'Power the ESP32 from a rail that can handle Wi-Fi current bursts.'] },
  { id: 'rf433-transmitter', type: 'comms', name: '433MHz ASK transmitter', shortName: '433MHz TX', description: 'Simple one-way 433MHz transmitter module.', plainLanguageDescription: 'A low-cost radio transmitter controlled by one digital pin.', category: 'Comms', icon: '≋', iconHint: 'RF transmitter', defaultLabel: '433MHz transmitter', protocolKey: 'comms.rf433.tx', power: ['5V', '3V3', 'GND'], roles: [{ role: 'data', label: 'DATA', kind: 'digital' }], defaultWiringNotes: ['DATA goes to a digital output pin.', 'Use a legal antenna and frequency for your region.'] },
  { id: 'rf433-receiver', type: 'comms', name: '433MHz ASK receiver', shortName: '433MHz RX', description: 'Simple one-way 433MHz receiver module.', plainLanguageDescription: 'A low-cost radio receiver read by one digital pin.', category: 'Comms', icon: '≋', iconHint: 'RF receiver', defaultLabel: '433MHz receiver', protocolKey: 'comms.rf433.rx', power: ['5V', '3V3', 'GND'], roles: [{ role: 'data', label: 'DATA', kind: 'digital' }], defaultWiringNotes: ['DATA goes to a digital input pin.', 'Use interrupt-capable pins when firmware needs precise timing.'] },
  { id: 'sx1278-lora', type: 'comms', name: 'SX1278 / RFM95 LoRa module', shortName: 'LoRa SPI', description: 'Long-range LoRa radio module using SPI.', plainLanguageDescription: 'A long-range radio module using SPI pins.', category: 'Comms', icon: '≋', iconHint: 'LoRa radio', defaultLabel: 'LoRa radio', protocolKey: 'comms.lora.sx1278', power: ['3V3', 'GND'], roles: [{ role: 'mosi', label: 'MOSI', kind: 'spi' }, { role: 'miso', label: 'MISO', kind: 'spi' }, { role: 'sck', label: 'SCK', kind: 'spi' }, { role: 'cs', label: 'NSS / CS', kind: 'spi' }, { role: 'rst', label: 'RST', kind: 'digital' }, { role: 'dio0', label: 'DIO0 interrupt', kind: 'digital' }], defaultWiringNotes: ['Most LoRa modules are 3.3V only.', 'Attach an antenna before transmitting and follow local RF regulations.'] },
  { id: 'mcp2515-can', type: 'comms', name: 'MCP2515 CAN bus module', shortName: 'MCP2515 CAN', description: 'SPI CAN controller module, usually paired with a TJA1050 transceiver.', plainLanguageDescription: 'Adds CAN bus using SPI plus an interrupt pin.', category: 'Comms', icon: '⇄', iconHint: 'CAN module', defaultLabel: 'CAN module', protocolKey: 'comms.can.mcp2515', power: ['5V', '3V3', 'GND'], roles: [{ role: 'mosi', label: 'MOSI', kind: 'spi' }, { role: 'miso', label: 'MISO', kind: 'spi' }, { role: 'sck', label: 'SCK', kind: 'spi' }, { role: 'cs', label: 'CS', kind: 'spi' }, { role: 'int', label: 'INT', kind: 'digital' }], defaultWiringNotes: ['Use proper CAN termination and transceiver lapge.', 'Many cheap modules use 5V transceivers; verify compatibility with 3.3V boards.'] },
  { id: 'w5500-ethernet', type: 'comms', name: 'W5500 Ethernet module', shortName: 'W5500 Ethernet', description: 'SPI Ethernet module for wired networking.', plainLanguageDescription: 'Adds wired Ethernet using SPI pins.', category: 'Comms', icon: '⇆', iconHint: 'Ethernet module', defaultLabel: 'Ethernet module', protocolKey: 'comms.ethernet.w5500', power: ['3V3', '5V', 'GND'], roles: [{ role: 'mosi', label: 'MOSI', kind: 'spi' }, { role: 'miso', label: 'MISO', kind: 'spi' }, { role: 'sck', label: 'SCK', kind: 'spi' }, { role: 'cs', label: 'CS', kind: 'spi' }, { role: 'rst', label: 'RST', kind: 'digital', optional: true }], defaultWiringNotes: ['Use hardware SPI pins.', 'Verify whether your module is 3.3V-only or has onboard regulation/level shifting.'] },

  { id: 'ads1115-adc', type: 'expander', name: 'ADS1115 16-bit ADC', shortName: 'ADS1115 ADC', description: 'High-resolution I2C analog-to-digital converter.', plainLanguageDescription: 'Adds precise analog inputs using the I2C bus.', category: 'Expanders / Mux', icon: '▣', iconHint: 'ADC module', defaultLabel: 'ADS1115 ADC', protocolKey: 'expander.adc.ads1115', power: ['5V', '3V3', 'GND'], roles: [{ role: 'sda', label: 'SDA', kind: 'i2c' }, { role: 'scl', label: 'SCL', kind: 'i2c' }, { role: 'alert', label: 'ALERT/RDY', kind: 'digital', optional: true }], defaults: { address: '0x48' }, defaultWiringNotes: ['Analog sensors connect to the ADS1115 input channels, not directly to MCU ADC pins.', 'SDA/SCL share the I2C bus.'] },
  { id: 'mcp3008-adc', type: 'expander', name: 'MCP3008 8-channel ADC', shortName: 'MCP3008 ADC', description: '8-channel 10-bit ADC using SPI.', plainLanguageDescription: 'Adds eight analog inputs using SPI wires.', category: 'Expanders / Mux', icon: '▣', iconHint: 'SPI ADC', defaultLabel: 'MCP3008 ADC', protocolKey: 'expander.adc.mcp3008', power: ['5V', '3V3', 'GND'], roles: [{ role: 'mosi', label: 'DIN / MOSI', kind: 'spi' }, { role: 'miso', label: 'DOUT / MISO', kind: 'spi' }, { role: 'sck', label: 'CLK / SCK', kind: 'spi' }, { role: 'cs', label: 'CS', kind: 'spi' }], defaultWiringNotes: ['Analog signals connect to CH0-CH7 on the MCP3008.', 'Use VREF/AGND carefully for stable readings.'] },
  { id: 'pca9685-pwm', type: 'expander', name: 'PCA9685 16-channel PWM driver', shortName: 'PCA9685 PWM', description: 'I2C PWM driver for servos, LEDs and dimming channels.', plainLanguageDescription: 'Adds sixteen PWM outputs using the I2C bus.', category: 'Expanders / Mux', icon: '▣', iconHint: 'PWM driver board', defaultLabel: 'PWM driver', protocolKey: 'expander.pwm.pca9685', power: ['5V', '3V3', 'GND'], roles: [{ role: 'sda', label: 'SDA', kind: 'i2c' }, { role: 'scl', label: 'SCL', kind: 'i2c' }, { role: 'oe', label: 'OE enable', kind: 'digital', optional: true }], defaults: { address: '0x40', channels: 16 }, defaultWiringNotes: ['Servos/LEDs connect to PCA9685 channels, not MCU PWM pins.', 'Use separate servo power and common GND.'] },

  { id: 'liion-1s-battery', type: 'power', name: '1S Li-ion/LiPo battery', shortName: '1S battery', description: 'Single-cell 3.7V nominal lithium battery source.', plainLanguageDescription: 'A battery power source; it feeds power rails, not MCU signal pins.', category: 'Power', icon: '▮', iconHint: 'battery cell', defaultLabel: '1S battery', protocolKey: 'power.battery.liion1s', power: ['VIN', 'GND'], roles: [], defaults: { nominalLapge: 3.7, chargedLapge: 4.2 }, exportOnly: true, defaultWiringNotes: ['This is a power source, not a logic signal component.', 'Feed a charger/BMS or regulator input as appropriate; do not assign MCU GPIO pins.', 'Use proper fuse/protection and polarity checks.'] },
  { id: 'battery-pack-2s-3s', type: 'power', name: '2S/3S battery pack', shortName: 'Battery pack', description: 'Higher-lapge battery pack for motors, fans or haptics.', plainLanguageDescription: 'A higher-lapge battery source for external loads and regulators.', category: 'Power', icon: '▮', iconHint: 'battery pack', defaultLabel: 'Battery pack', protocolKey: 'power.battery.pack', power: ['VIN', 'GND'], roles: [], defaults: { externalPower: true }, exportOnly: true, defaultWiringNotes: ['Feeds VIN/regulators or load drivers; it does not connect to MCU signal pins.', 'Use a matching BMS/charger and fuse.', 'Only connect board GND/common reference where the design requires it.'] },
  { id: 'bms-1s-module', type: 'power', name: '1S lithium BMS/protection board', shortName: '1S BMS', description: 'Protection/charge board for one lithium cell.', plainLanguageDescription: 'A battery management/protection board; it routes battery power, not signals.', category: 'Power', icon: '▤', iconHint: 'BMS board', defaultLabel: '1S BMS', protocolKey: 'power.bms.1s', power: ['VIN', 'GND'], roles: [], defaults: { cells: 1 }, exportOnly: true, defaultWiringNotes: ['B+/B- go to the cell; P+/P- feed the load/charger per the module documentation.', 'No MCU GPIO is required unless your specific BMS has telemetry pins.', 'Respect current limits and cell polarity.'] },
  { id: 'bms-2s-3s-module', type: 'power', name: '2S/3S BMS module', shortName: '2S/3S BMS', description: 'Battery management/protection board for multi-cell lithium packs.', plainLanguageDescription: 'A battery management board for higher-lapge packs; no signal pins claimed.', category: 'Power', icon: '▤', iconHint: 'multi-cell BMS', defaultLabel: 'Multi-cell BMS', protocolKey: 'power.bms.multi', power: ['VIN', 'GND'], roles: [], defaults: { cells: 2 }, exportOnly: true, defaultWiringNotes: ['Balance leads go to each cell junction; P+/P- feed the load/charger per the module documentation.', 'This catalog entry is documentation/export-only and does not consume MCU GPIO.', 'Use correct cell count and current rating.'] },
  { id: 'tp4056-charger', type: 'power', name: 'TP4056 Li-ion charger module', shortName: 'TP4056 charger', description: 'USB lithium-cell charger/protection module.', plainLanguageDescription: 'A small charging board for one lithium cell; no MCU signal pins.', category: 'Power', icon: '▤', iconHint: 'charger module', defaultLabel: 'TP4056 charger', protocolKey: 'power.charger.tp4056', power: ['VIN', 'GND'], roles: [], exportOnly: true, defaultWiringNotes: ['B+/B- connect to the cell; OUT+/OUT- feed the load if the module has protection output.', 'No MCU pins are required.', 'Do not charge lithium cells without correct protection and polarity.'] },
  { id: 'buck-converter', type: 'power', name: 'DC-DC buck converter', shortName: 'Buck converter', description: 'Step-down regulator for making 5V/3.3V rails from a higher lapge.', plainLanguageDescription: 'A regulator that turns a higher battery/load lapge into a lower rail.', category: 'Power', icon: '▤', iconHint: 'regulator module', defaultLabel: 'Buck converter', protocolKey: 'power.regulator.buck', power: ['VIN', '5V', '3V3', 'GND'], roles: [], exportOnly: true, defaultWiringNotes: ['Set output lapge before connecting electronics.', 'Feeds 5V/3V3 rails or VIN depending on the board and regulator.', 'This is power wiring only, not a GPIO component.'] },
  { id: 'boost-converter', type: 'power', name: 'DC-DC boost converter', shortName: 'Boost converter', description: 'Step-up regulator for raising battery lapge.', plainLanguageDescription: 'A regulator that turns a low battery lapge into a higher rail.', category: 'Power', icon: '▤', iconHint: 'boost regulator', defaultLabel: 'Boost converter', protocolKey: 'power.regulator.boost', power: ['VIN', '5V', 'GND'], roles: [], exportOnly: true, defaultWiringNotes: ['Set output lapge and verify current capability before connecting the board/load.', 'Use for rails like 5V from a 1S battery when current is adequate.', 'No MCU signal pins are required.'] },
  { id: 'fuse-power-switch', type: 'power', name: 'Fuse + main power switch', shortName: 'Power switch', description: 'Inline fuse and main switch for external power.', plainLanguageDescription: 'A safe main power path item; it does not use MCU pins.', category: 'Power', icon: '⏻', iconHint: 'power switch', defaultLabel: 'Main power switch', protocolKey: 'power.fuseSwitch', power: ['VIN', 'GND'], roles: [], exportOnly: true, defaultWiringNotes: ['Place the fuse close to the battery/supply positive terminal.', 'Switch the appropriate supply rail for your enclosure.', 'No MCU GPIO pins are required.'] },


  { id: 'custom', type: 'custom', name: 'Custom / future component', shortName: 'Custom', description: 'Generic item for documentation or future firmware support.', plainLanguageDescription: 'Use this when your module is not listed yet.', category: 'Custom', icon: '+', iconHint: 'custom block', defaultLabel: 'Custom component', protocolKey: 'custom', power: ['GND'], roles: [{ role: 'signal', label: 'Signal', kind: 'any', muxCapable: true }], defaultWiringNotes: ['Document the real wiring in the notes before exporting.'] }
]

export function getBoardCatalogEntry(id: string): BoardCatalogEntry {
  return (BOARD_CATALOG as Record<string, BoardCatalogEntry>)[id] ?? BOARD_CATALOG.nano
}

export function getComponentDefinition(id: string): PinoutComponentDefinition | null {
  return PINOUT_COMPONENT_LIBRARY.find((component) => component.id === id) ?? null
}

export interface PinoutComponentCompatibility {
  compatible: boolean
  status: 'compatible' | 'warning' | 'incompatible'
  reasons: string[]
  warnings: string[]
}

export function isComponentCompatibleWithBoard(component: PinoutComponentDefinition, board: BoardCatalogEntry): boolean {
  return getComponentBoardCompatibility(component, board).compatible
}

export function getComponentBoardCompatibility(component: PinoutComponentDefinition, board: BoardCatalogEntry): PinoutComponentCompatibility {
  const reasons: string[] = []
  const warnings: string[] = []
  const requiredRoles = component.roles.filter((role) => !role.optional)

  if (component.requiresNativeUsbHid && !board.usbHid) {
    reasons.push(`${board.name} does not support native USB HID.`)
  }

  if (component.type !== 'power') {
    const powerCompatibility = getPowerCompatibility(component, board)
    reasons.push(...powerCompatibility.reasons)
    warnings.push(...powerCompatibility.warnings)
  }

  for (const role of requiredRoles) {
    if (getCompatiblePinsForRole(board.pins, role).length === 0) {
      reasons.push(`No ${role.kind.toUpperCase()} pin can satisfy ${role.label}.`)
    }
  }

  if (!canAllocateRequiredRoles(requiredRoles.filter((role) => !['i2c', 'power'].includes(role.kind)), board.pins)) {
    reasons.push('Not enough distinct signal pins for all required roles.')
  }

  const uniqueReasons = [...new Set(reasons)]
  const uniqueWarnings = [...new Set(warnings)]
  return {
    compatible: uniqueReasons.length === 0,
    status: uniqueReasons.length > 0 ? 'incompatible' : uniqueWarnings.length > 0 ? 'warning' : 'compatible',
    reasons: uniqueReasons,
    warnings: uniqueWarnings
  }
}

export function getCompatiblePinsForRole(pins: BoardPinCapability[], role: PinoutComponentRole): BoardPinCapability[] {
  return pins.filter((pin) => pinSupportsRole(pin, role))
}

export function pinSupportsRole(pin: BoardPinCapability, role: PinoutComponentRole): boolean {
  if (role.kind === 'power') return powerPinMatchesRole(pin, role)
  if (pin.power) return false
  if (role.kind === 'any') return pin.digital || pin.analogIn || pin.pwm || Boolean(pin.i2c || pin.spi || pin.uart)
  if (role.kind === 'digital') return pin.digital
  if (role.kind === 'analog') return pin.analogIn
  if (role.kind === 'pwm') return pin.pwm
  if (role.kind === 'i2c') return role.role === 'sda' ? pin.i2c === 'sda' : role.role === 'scl' ? pin.i2c === 'scl' : Boolean(pin.i2c)
  if (role.kind === 'spi') return spiPinMatchesRole(pin, role)
  if (role.kind === 'uart') return role.role === 'rx' ? pin.uart === 'rx' : role.role === 'tx' ? pin.uart === 'tx' : Boolean(pin.uart)
  return false
}

/**
 * Maps a component role to the electrical direction its board pin must take.
 * The Pinout Designer mixes input controls (buttons, encoders, toggles) with
 * output actuators (single LED, WS2812 DIN, buzzer, servo signal, shift
 * registers, 7-seg/TM1638), so the generated firmware needs this to emit the
 * correct pinMode() — forcing INPUT_PULLUP on an output pin is wrong/misleading.
 */
export function getRolePinDirection(definition: PinoutComponentDefinition | null, role: PinoutComponentRole | undefined): PinDirection {
  if (!role) return 'input'
  if (role.kind === 'i2c') return 'i2c'
  if (role.kind === 'analog') return 'analog'
  if (role.kind === 'pwm' || role.kind === 'power') return 'output'
  // A custom component can declare the electrical direction explicitly. Honor it
  // for the signal kinds (digital/spi/uart/any) where the heuristics below would
  // otherwise guess; i2c/analog/pwm/power are already fixed by kind above. A
  // 'bidir' declaration falls through to the safe heuristics.
  if (role.direction === 'output') return 'output'
  if (role.direction === 'input') return 'input'
  if (role.kind === 'spi') return ['miso', 'dout', 'sdo'].includes(role.role) ? 'input' : 'output'
  if (role.kind === 'uart') return role.role === 'rx' ? 'input' : 'output'
  if (role.kind === 'digital') return digitalRolePinDirection(definition, role)
  // 'any' (custom / generic signal): keep it a safe, pulled-up input so the
  // generated firmware never actively drives an unknown pin.
  return 'input'
}

function digitalRolePinDirection(definition: PinoutComponentDefinition | null, role: PinoutComponentRole): PinDirection {
  if (!definition) return 'input'
  if (['echo', 'busy', 'state', 'irq', 'int', 'inta', 'intb', 'dio0', 'digitalOut', 'out'].includes(role.role)) return 'input'
  if (definition.id === '74hc165') return role.role === 'data' ? 'input' : 'output'
  if (definition.id === 'hx711-load-cell') return role.role === 'clock' ? 'output' : 'input'
  if (definition.id === 'mcp23017' && (role.role === 'intA' || role.role === 'intB')) return 'input'
  if (definition.category === 'Sensors') return ['int', 'data', 'signal', 'echo', 'digitalOut', 'analogOut'].includes(role.role) ? 'input' : 'output'
  if (definition.type === 'screen') return ['miso'].includes(role.role) ? 'input' : 'output'
  switch (definition.type) {
    case 'startLed':
    case 'rgbStrip':
    case 'rgbMatrix':
    case 'segDisplay':
    case 'buzzer':
    case 'gauge':
    case 'multiplexer':
    case 'expander':
    case 'actuator':
      return 'output'
    case 'comms':
      return ['rst', 'en', 'key', 'boot', 'ce', 'cs'].includes(role.role) ? 'output' : 'input'
    default:
      return 'input'
  }
}

function canAllocateRequiredRoles(roles: PinoutComponentRole[], pins: BoardPinCapability[]): boolean {
  const sortedRoles = [...roles].sort((a, b) => getCompatiblePinsForRole(pins, a).length - getCompatiblePinsForRole(pins, b).length)
  const used = new Set<string>()
  for (const role of sortedRoles) {
    const pin = getCompatiblePinsForRole(pins, role).find((candidate) => !used.has(candidate.pin))
    if (!pin) return false
    used.add(pin.pin)
  }
  return true
}

function spiPinMatchesRole(pin: BoardPinCapability, role: PinoutComponentRole): boolean {
  if (['mosi', 'din', 'sdi', 'data'].includes(role.role)) return pin.spi === 'mosi'
  if (['miso', 'dout', 'sdo'].includes(role.role)) return pin.spi === 'miso'
  if (['sck', 'clk', 'clock'].includes(role.role)) return pin.spi === 'sck'
  if (['cs', 'ss', 'nss', 'load', 'stb'].includes(role.role)) return pin.spi === 'ss' || pin.digital
  return Boolean(pin.spi)
}

function powerPinMatchesRole(pin: BoardPinCapability, role: PinoutComponentRole): boolean {
  if (!pin.power) return false
  if (role.role === 'gnd' || role.role === 'ground') return pin.power === 'gnd'
  if (['3v3', '3v', 'vcc3v3'].includes(role.role.toLowerCase())) return pin.power === '3v3'
  if (['5v', 'vcc', 'vcc5v'].includes(role.role.toLowerCase())) return pin.power === '5v'
  if (['vin', 'raw', 'vbat'].includes(role.role.toLowerCase())) return pin.power === 'vin'
  return ['5v', '3v3', 'vin', 'gnd'].includes(pin.power)
}

function boardHasPowerRail(board: BoardCatalogEntry, rail: PowerRail): boolean {
  if (rail === 'GND') return board.pins.some((pin) => pin.power === 'gnd')
  if (rail === '5V') return board.pins.some((pin) => pin.power === '5v')
  if (rail === '3V3') return board.pins.some((pin) => pin.power === '3v3')
  if (rail === 'VIN') return board.pins.some((pin) => pin.power === 'vin')
  return false
}

function getPowerCompatibility(component: PinoutComponentDefinition, board: BoardCatalogEntry): { reasons: string[]; warnings: string[] } {
  const reasons: string[] = []
  const warnings: string[] = []
  const lapgeRails = component.power.filter((rail): rail is '5V' | '3V3' => rail === '5V' || rail === '3V3')
  if (lapgeRails.length > 0 && !lapgeRails.some((rail) => boardHasPowerRail(board, rail))) {
    reasons.push(lapgeRails.length === 1
      ? `${board.name} does not expose the required ${lapgeRails[0]} power rail.`
      : `${board.name} does not expose any supported logic power rail (${lapgeRails.join(' or ')}).`)
  }
  if (lapgeRails.length === 1 && boardHasPowerRail(board, lapgeRails[0]) && boardLogicLapgeDiffers(board, lapgeRails[0]) && component.roles.some((role) => !role.optional && role.kind !== 'power')) {
    warnings.push(`${lapgeRails[0]} part on a ${board.lapge}-logic board — a logic level shifter may be required.`)
  }
  if (component.power.includes('VIN') && !boardHasPowerRail(board, 'VIN')) {
    reasons.push(`${board.name} does not expose the required VIN/raw power rail.`)
  }
  return { reasons, warnings }
}

function boardLogicLapgeDiffers(board: BoardCatalogEntry, rail: '5V' | '3V3'): boolean {
  if (board.lapge === '5V/3.3V') return false
  return (rail === '5V' && board.lapge !== '5V') || (rail === '3V3' && board.lapge !== '3.3V')
}

// ─── User-defined ("custom") catalog ─────────────────────────────────────────
// Custom components and boards are first-class: they share the exact same shapes
// as the built-in catalog (PinoutComponentDefinition / BoardCatalogEntry) so the
// Pinout Designer, compatibility filter and firmware generator treat them like
// any other entry. The merge helper below combines the static catalog with the
// user's entries and is used by both the renderer and the main process.

export const CUSTOM_CATALOG_VERSION = 1
export const CUSTOM_CATALOG_STORE_FILE = 'custom-catalog.json'

export interface CustomCatalog {
  version: number
  components: PinoutComponentDefinition[]
  boards: BoardCatalogEntry[]
  updatedAt: string
}

export interface MergedCatalog {
  boards: BoardCatalogEntry[]
  boardsById: Record<string, BoardCatalogEntry>
  components: PinoutComponentDefinition[]
  componentsById: Record<string, PinoutComponentDefinition>
}

export const CUSTOM_COMPONENT_CATEGORIES: PinoutComponentCategory[] = ['Lights', 'Screens', 'Sound', 'Haptics', 'Inputs', 'Sensors', 'Motors', 'Power', 'Comms', 'Expanders / Mux', 'Custom']
export const CUSTOM_ROLE_KINDS: Array<Exclude<PinoutPinKind, 'channel'>> = ['digital', 'analog', 'pwm', 'i2c', 'spi', 'uart', 'power', 'any']
export const CUSTOM_ROLE_DIRECTIONS: Array<NonNullable<PinoutComponentRole['direction']>> = ['input', 'output', 'bidir']
export const CUSTOM_POWER_RAILS: PowerRail[] = ['5V', '3V3', 'VIN', 'GND']
export const CUSTOM_BOARD_VOLTAGES: Array<BoardCatalogEntry['lapge']> = ['5V', '3.3V', '5V/3.3V']
export const CUSTOM_PIN_POWER_CODES: Array<NonNullable<BoardPinCapability['power']>> = ['5v', '3v3', 'vin', 'gnd', 'reset']

const CUSTOM_CATEGORY_ICONS: Record<PinoutComponentCategory, string> = {
  Lights: '✸',
  Screens: '▭',
  Sound: '♪',
  Haptics: '〜',
  Inputs: '⎄',
  Sensors: '◎',
  Motors: '⚙',
  Power: '⚡',
  Comms: '⇄',
  'Expanders / Mux': '⧉',
  Custom: '✦'
}

export function emptyCustomCatalog(): CustomCatalog {
  return { version: CUSTOM_CATALOG_VERSION, components: [], boards: [], updatedAt: new Date(0).toISOString() }
}

export function createCustomEntryId(prefix: 'custom-cmp' | 'custom-board'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Pure merge of the built-in catalog with user-defined entries. Built-in ids are
 * always authoritative — a custom entry can never clobber a built-in board or
 * component (custom ids are namespaced, but this is enforced defensively).
 */
export function mergeCatalog(custom?: Partial<CustomCatalog> | null): MergedCatalog {
  const componentsById: Record<string, PinoutComponentDefinition> = {}
  for (const component of PINOUT_COMPONENT_LIBRARY) componentsById[component.id] = component
  if (custom && Array.isArray(custom.components)) {
    for (const raw of custom.components) {
      const normalized = normalizeCustomComponent(raw)
      if (normalized && !(normalized.id in componentsById)) componentsById[normalized.id] = normalized
    }
  }

  const boardsById: Record<string, BoardCatalogEntry> = {}
  for (const board of Object.values(BOARD_CATALOG)) boardsById[board.id] = board
  if (custom && Array.isArray(custom.boards)) {
    for (const raw of custom.boards) {
      const normalized = normalizeCustomBoard(raw)
      if (normalized && !(normalized.id in boardsById)) boardsById[normalized.id] = normalized
    }
  }

  return {
    boards: Object.values(boardsById),
    boardsById,
    components: Object.values(componentsById),
    componentsById
  }
}

export function isCustomBoardId(id: string): boolean {
  return id.startsWith('custom-board') && !(id in BOARD_CATALOG)
}

export function isCustomComponentId(id: string): boolean {
  return id.startsWith('custom-cmp') && !PINOUT_COMPONENT_LIBRARY.some((component) => component.id === id)
}

/** Validate + coerce arbitrary (untrusted) input into a well-formed custom catalog. */
export function normalizeCustomCatalog(raw: unknown): CustomCatalog {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const components: PinoutComponentDefinition[] = []
  const componentIds = new Set<string>()
  if (Array.isArray(input.components)) {
    for (const item of input.components) {
      const normalized = normalizeCustomComponent(item)
      if (normalized && !componentIds.has(normalized.id)) {
        componentIds.add(normalized.id)
        components.push(normalized)
      }
    }
  }
  const boards: BoardCatalogEntry[] = []
  const boardIds = new Set<string>()
  if (Array.isArray(input.boards)) {
    for (const item of input.boards) {
      const normalized = normalizeCustomBoard(item)
      if (normalized && !boardIds.has(normalized.id)) {
        boardIds.add(normalized.id)
        boards.push(normalized)
      }
    }
  }
  return {
    version: CUSTOM_CATALOG_VERSION,
    components,
    boards,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : new Date().toISOString()
  }
}

/** Validate + coerce a single custom component. Returns null when unusable (no name). */
export function normalizeCustomComponent(raw: unknown): PinoutComponentDefinition | null {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as Record<string, unknown>
  const name = asString(input.name).trim()
  if (!name) return null
  const category = CUSTOM_COMPONENT_CATEGORIES.includes(input.category as PinoutComponentCategory) ? (input.category as PinoutComponentCategory) : 'Custom'
  const description = asString(input.description).trim()
  const tips = normalizeStringArray(input.tips)
  const wiringNotes = normalizeStringArray(input.defaultWiringNotes)
  const definition: PinoutComponentDefinition = {
    id: sanitizeCustomId(input.id, 'custom-cmp'),
    type: 'custom',
    name,
    shortName: asString(input.shortName).trim() || truncateText(name, 20),
    description: description || name,
    plainLanguageDescription: asString(input.plainLanguageDescription).trim() || description || name,
    category,
    icon: asString(input.icon).trim() || CUSTOM_CATEGORY_ICONS[category],
    iconHint: asString(input.iconHint).trim() || `${name} (custom)`,
    defaultLabel: asString(input.defaultLabel).trim() || name,
    roles: normalizeCustomRoles(input.roles),
    protocolKey: asString(input.protocolKey).trim() || 'custom',
    power: normalizePowerRails(input.power),
    defaultWiringNotes: wiringNotes.length > 0 ? wiringNotes : ['Custom component: confirm wiring, lapge and required libraries against the datasheet.']
  }
  if (tips.length > 0) definition.tips = tips
  if (asBool(input.requiresNativeUsbHid)) definition.requiresNativeUsbHid = true
  return definition
}

/** Validate + coerce a single custom board. Returns null when unusable (no name). */
export function normalizeCustomBoard(raw: unknown): BoardCatalogEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as Record<string, unknown>
  const name = asString(input.name).trim()
  if (!name) return null
  const fqbn = asString(input.fqbn).trim()
  const lapge = CUSTOM_BOARD_VOLTAGES.includes(input.lapge as BoardCatalogEntry['lapge']) ? (input.lapge as BoardCatalogEntry['lapge']) : '5V'
  const board: BoardCatalogEntry = {
    id: sanitizeCustomId(input.id, 'custom-board'),
    name,
    mcu: asString(input.mcu).trim() || 'Custom MCU',
    lapge,
    usbHid: asBool(input.usbHid),
    notes: asString(input.notes).trim() || 'Custom board defined by the user. Verify pin capabilities and lapge against the datasheet.',
    pins: normalizeCustomBoardPins(input.pins)
  }
  if (fqbn) board.fqbn = fqbn
  return board
}

function normalizeCustomRoles(raw: unknown): PinoutComponentRole[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const roles: PinoutComponentRole[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    const label = asString(entry.label).trim()
    const slugSource = sanitizeRoleSlug(entry.role) || sanitizeRoleSlug(label)
    if (!label && !slugSource) continue
    const kind = CUSTOM_ROLE_KINDS.includes(entry.kind as Exclude<PinoutPinKind, 'channel'>) ? (entry.kind as Exclude<PinoutPinKind, 'channel'>) : 'digital'
    const base = slugSource || kind
    let unique = base
    let suffix = 2
    while (seen.has(unique)) unique = `${base}-${suffix++}`
    seen.add(unique)
    const role: PinoutComponentRole = { role: unique, label: label || unique, kind }
    if (asBool(entry.optional)) role.optional = true
    if (asBool(entry.muxCapable)) role.muxCapable = true
    if (CUSTOM_ROLE_DIRECTIONS.includes(entry.direction as NonNullable<PinoutComponentRole['direction']>)) role.direction = entry.direction as PinoutComponentRole['direction']
    roles.push(role)
  }
  return roles
}

function normalizeCustomBoardPins(raw: unknown): BoardPinCapability[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const pins: BoardPinCapability[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    const pinName = asString(entry.pin).trim()
    if (!pinName) continue
    let unique = pinName
    let suffix = 2
    while (seen.has(unique)) unique = `${pinName}-${suffix++}`
    seen.add(unique)
    const notes = asString(entry.notes).trim()
    const power = CUSTOM_PIN_POWER_CODES.includes(entry.power as NonNullable<BoardPinCapability['power']>) ? (entry.power as BoardPinCapability['power']) : undefined
    if (power) {
      // A power/ground rail never advertises signal capabilities.
      const powerPin: BoardPinCapability = { pin: unique, digital: false, analogIn: false, pwm: false, power }
      if (notes) powerPin.notes = notes
      pins.push(powerPin)
      continue
    }
    const pin: BoardPinCapability = {
      pin: unique,
      digital: asBool(entry.digital),
      analogIn: asBool(entry.analogIn),
      pwm: asBool(entry.pwm)
    }
    if (entry.i2c === 'sda' || entry.i2c === 'scl') pin.i2c = entry.i2c
    if ((['mosi', 'miso', 'sck', 'ss'] as SpiRole[]).includes(entry.spi as SpiRole)) pin.spi = entry.spi as SpiRole
    if (entry.uart === 'rx' || entry.uart === 'tx') pin.uart = entry.uart
    if (asBool(entry.interrupt)) pin.interrupt = true
    if (notes) pin.notes = notes
    pins.push(pin)
  }
  return pins
}

function normalizePowerRails(raw: unknown): PowerRail[] {
  if (!Array.isArray(raw)) return []
  const out: PowerRail[] = []
  for (const item of raw) {
    if (CUSTOM_POWER_RAILS.includes(item as PowerRail) && !out.includes(item as PowerRail)) out.push(item as PowerRail)
  }
  return out
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function asBool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1
}

function truncateText(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max)
}

function normalizeStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((item) => asString(item).trim()).filter(Boolean)
  const text = asString(raw).trim()
  if (!text) return []
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function sanitizeRoleSlug(value: unknown): string {
  return asString(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24)
}

function sanitizeCustomId(value: unknown, prefix: 'custom-cmp' | 'custom-board'): string {
  const cleaned = asString(value).trim().replace(/[^a-zA-Z0-9_-]/g, '')
  if (cleaned.startsWith(prefix)) return cleaned.slice(0, 80)
  return createCustomEntryId(prefix)
}

// ─── Reverse build recommender ───────────────────────────────────────────────
// Forward flow = "pick a board, then add parts". Reverse flow = the builder picks
// the PARTS they want and we recommend the simplest board + wiring architecture
// (a clean direct fit, or the fewest shift registers / multiplexers / I2C
// expanders) that can host them. Pure + deterministic so the renderer can call it
// during render and the result stays reproducible.

export interface RecommendSelection {
  componentId: string
  qty: number
}

export interface BuildRequirement {
  digitalIn: number        // expandable on/off inputs (buttons, switches, encoder A/B/SW…)
  digitalOut: number       // expandable on/off outputs (single LEDs, raw 7-seg segments…)
  analogIn: number         // expandable analog inputs (pots, sliders, hall, joystick axes…)
  analogDirect: number     // analog inputs that must stay on a real ADC pin
  pwm: number              // PWM signals (servos, RGB legs, backlights…)
  directDigital: number    // digital lines that must stay on the board (WS2812 DIN, display DC/RST, IR OUT…)
  i2cDevices: number       // distinct devices sharing the SDA/SCL bus
  spiDevices: number       // distinct devices sharing the SPI bus (each needs its own CS)
  uartDevices: number      // devices needing a serial pair
  powerRails: PowerRail[]
  needsUsbHid: boolean
  only3v3: boolean         // a selected module is 3.3V-only
  totalComponents: number
  items: Array<{ definitionId: string; name: string; qty: number }>
  notes: string[]
}

export type RecommendedExpanderKind = '74hc165' | '74hc595' | 'cd74hc4067' | 'mcp23017' | 'pca9685-pwm'

export interface RecommendedExpander {
  definitionId: string
  kind: RecommendedExpanderKind
  name: string
  count: number
  channelsEach: number
  purpose: string
  sigMode?: 'digital' | 'analog' // for cd74hc4067 placement as a PlacedMux
}

export interface RecommendedPinBudget {
  digitalUsed: number
  digitalAvailable: number
  analogUsed: number
  analogAvailable: number
  pwmUsed: number
  pwmAvailable: number
  i2cBus: boolean
  spiBus: boolean
  signalPinsUsed: number
  signalPinsAvailable: number
}

export interface BoardArchitecturePlan {
  boardId: PinoutBoardId
  boardName: string
  fits: boolean
  directFit: boolean
  expanders: RecommendedExpander[]
  extraChips: number
  pinBudget: RecommendedPinBudget
  rationale: string[]
  warnings: string[]
  score: number
}

export interface BuildRecommendation {
  ok: boolean
  requirement: BuildRequirement
  chosen: BoardArchitecturePlan | null
  alternatives: BoardArchitecturePlan[]
  summary: string
  unmetReasons: string[]
}

const RECOMMEND_SHIFT_CHANNELS = 8     // 74HC165 / 74HC595 per chip
const RECOMMEND_MUX_CHANNELS = 16      // CD74HC4067 per chip
const RECOMMEND_I2C_GPIO_CHANNELS = 16 // MCP23017 per chip
const RECOMMEND_PWM_CHANNELS = 16      // PCA9685 per chip
const RECOMMEND_MAX_I2C_GPIO_CHIPS = 8 // distinct A0-A2 hardware addresses

// Common / affordable boards first; nudges score ties toward familiar hardware.
const RECOMMEND_BOARD_PREFERENCE: PinoutBoardId[] = [
  'nano', 'uno', 'pro-mini-5v', 'nano-every', 'promicro', 'leonardo', 'micro',
  'esp32', 'esp32s3', 'pico', 'mega', 'due', 'teensy40', 'teensy41'
]

interface RecommendExpanderPlan {
  shiftIn: number   // 74HC165 chips
  shiftOut: number  // 74HC595 chips
  analogMux: number // CD74HC4067 analog chips
  digitalMux: number // CD74HC4067 digital chips
  i2cIn: number     // MCP23017 chips for inputs
  i2cOut: number    // MCP23017 chips for outputs
  pwmExp: number    // PCA9685 chips
}

type RecommendDemandKind = 'analog' | 'pwm' | 'digital' | 'sda' | 'scl' | 'mosi' | 'miso' | 'sck' | 'uart'
type RecommendStrategy = 'shift' | 'i2c'

/** Sum the electrical resources the selected components demand. Pure. */
export function summarizeBuildRequirement(selected: RecommendSelection[], catalog: MergedCatalog = mergeCatalog()): BuildRequirement {
  const req: BuildRequirement = {
    digitalIn: 0, digitalOut: 0, analogIn: 0, analogDirect: 0, pwm: 0, directDigital: 0,
    i2cDevices: 0, spiDevices: 0, uartDevices: 0, powerRails: [], needsUsbHid: false, only3v3: false,
    totalComponents: 0, items: [], notes: []
  }
  const rails = new Set<PowerRail>()
  for (const selection of selected) {
    const qty = Math.max(0, Math.floor(selection.qty))
    if (qty <= 0) continue
    const definition = catalog.componentsById[selection.componentId]
    if (!definition) { req.notes.push(`Unknown component "${selection.componentId}" was skipped.`); continue }
    req.totalComponents += qty
    req.items.push({ definitionId: definition.id, name: definition.shortName, qty })
    for (const rail of definition.power) if (rail !== 'GND') rails.add(rail)
    if (definition.requiresNativeUsbHid) req.needsUsbHid = true
    if (definition.power.includes('3V3') && definition.power.every((rail) => rail === '3V3' || rail === 'GND') && definition.roles.some((role) => role.kind !== 'power')) req.only3v3 = true
    if (definition.type === 'multiplexer' || definition.type === 'expander') {
      req.notes.push(`${definition.shortName} was added as a part; the recommender keeps its own control pins but does not re-expand it.`)
    }

    const requiredRoles = definition.roles.filter((role) => !role.optional)
    if (requiredRoles.some((role) => role.kind === 'i2c')) req.i2cDevices += qty
    if (requiredRoles.some((role) => role.kind === 'spi')) req.spiDevices += qty
    if (requiredRoles.some((role) => role.kind === 'uart')) req.uartDevices += qty

    for (const role of requiredRoles) {
      switch (role.kind) {
        case 'power':
        case 'i2c':
        case 'uart':
        case 'spi': // shared bus + per-device CS are derived from the device counts above
          break
        case 'analog':
          if (role.muxCapable) req.analogIn += qty
          else req.analogDirect += qty
          break
        case 'pwm':
          req.pwm += qty
          break
        case 'any':
          req.directDigital += qty
          break
        case 'digital': {
          const direction = getRolePinDirection(definition, role)
          if (direction === 'output') {
            if (role.muxCapable) req.digitalOut += qty
            else req.directDigital += qty
          } else if (role.muxCapable) {
            req.digitalIn += qty
          } else {
            req.directDigital += qty
          }
          break
        }
        default:
          break
      }
    }
  }
  req.powerRails = [...rails]
  return req
}

function recommendSignalPins(board: BoardCatalogEntry): BoardPinCapability[] {
  return board.pins.filter((pin) => !pin.power)
}

function recommendBoardHasI2c(board: BoardCatalogEntry): boolean {
  return board.pins.some((pin) => pin.i2c === 'sda') && board.pins.some((pin) => pin.i2c === 'scl')
}

function recommendPinMatches(pin: BoardPinCapability, kind: RecommendDemandKind): boolean {
  if (pin.power) return false
  switch (kind) {
    case 'analog': return pin.analogIn
    case 'pwm': return pin.pwm
    case 'digital': return pin.digital
    case 'sda': return pin.i2c === 'sda'
    case 'scl': return pin.i2c === 'scl'
    case 'mosi': return pin.spi === 'mosi'
    case 'miso': return pin.spi === 'miso'
    case 'sck': return pin.spi === 'sck'
    case 'uart': return Boolean(pin.uart) || pin.digital
    default: return false
  }
}

function recommendPinWeight(pin: BoardPinCapability): number {
  return (pin.digital ? 1 : 0) + (pin.analogIn ? 1 : 0) + (pin.pwm ? 1 : 0) + (pin.i2c ? 1 : 0) + (pin.spi ? 1 : 0) + (pin.uart ? 1 : 0) + (pin.interrupt ? 1 : 0)
}

/**
 * Greedy bipartite match of pin demands onto real board pins. Demands are filled
 * scarcest-first and each is given the lowest-capability pin that fits, so scarce
 * analog/PWM/bus pins are preserved for the demands that truly need them — the
 * same scarcity heuristic the per-component compatibility check uses.
 */
function recommendAllocate(board: BoardCatalogEntry, demands: RecommendDemandKind[]): { ok: boolean; used: number; unmatched: Set<RecommendDemandKind> } {
  const pins = recommendSignalPins(board)
  const used = new Set<string>()
  const candidateCount = new Map<RecommendDemandKind, number>()
  for (const kind of demands) {
    if (!candidateCount.has(kind)) candidateCount.set(kind, pins.filter((pin) => recommendPinMatches(pin, kind)).length)
  }
  const ordered = [...demands].sort((a, b) => (candidateCount.get(a) ?? 0) - (candidateCount.get(b) ?? 0))
  const unmatched = new Set<RecommendDemandKind>()
  for (const kind of ordered) {
    const pick = pins
      .filter((pin) => !used.has(pin.pin) && recommendPinMatches(pin, kind))
      .sort((a, b) => recommendPinWeight(a) - recommendPinWeight(b))[0]
    if (!pick) unmatched.add(kind)
    else used.add(pick.pin)
  }
  return { ok: unmatched.size === 0, used: used.size, unmatched }
}

/** Translate a requirement + chosen expander plan into the flat list of board pin demands. */
function recommendDemands(req: BuildRequirement, plan: RecommendExpanderPlan): RecommendDemandKind[] {
  const demands: RecommendDemandKind[] = []
  const push = (kind: RecommendDemandKind, count: number): void => { for (let i = 0; i < count; i += 1) demands.push(kind) }

  const analogOffloaded = Math.min(req.analogIn, plan.analogMux * RECOMMEND_MUX_CHANNELS)
  push('analog', req.analogDirect + (req.analogIn - analogOffloaded))
  push('analog', plan.analogMux)  // each analog mux SIG needs one ADC pin
  push('digital', plan.digitalMux) // each digital mux SIG needs one digital pin
  if (plan.analogMux + plan.digitalMux > 0) push('digital', 4) // S0-S3 select lines are shared across all muxes

  const digInCapacity = plan.shiftIn * RECOMMEND_SHIFT_CHANNELS + plan.digitalMux * RECOMMEND_MUX_CHANNELS + plan.i2cIn * RECOMMEND_I2C_GPIO_CHANNELS
  const digOutCapacity = plan.shiftOut * RECOMMEND_SHIFT_CHANNELS + plan.i2cOut * RECOMMEND_I2C_GPIO_CHANNELS
  const digInDirect = Math.max(0, req.digitalIn - digInCapacity)
  const digOutDirect = Math.max(0, req.digitalOut - digOutCapacity)
  if (plan.shiftIn > 0) push('digital', 3)  // data / clock / latch shared along the chain
  if (plan.shiftOut > 0) push('digital', 3)
  push('digital', digInDirect + digOutDirect + req.directDigital)

  push('pwm', Math.max(0, req.pwm - plan.pwmExp * RECOMMEND_PWM_CHANNELS))

  const usesI2c = req.i2cDevices > 0 || plan.i2cIn > 0 || plan.i2cOut > 0 || plan.pwmExp > 0
  if (usesI2c) { push('sda', 1); push('scl', 1) }
  if (req.spiDevices > 0) { push('mosi', 1); push('miso', 1); push('sck', 1); push('digital', req.spiDevices) }
  push('uart', req.uartDevices * 2)
  return demands
}

/** Iteratively add expanders (per strategy) until the build fits the board, or give up. */
function recommendPlanStrategy(board: BoardCatalogEntry, req: BuildRequirement, strategy: RecommendStrategy): { plan: RecommendExpanderPlan; fits: boolean } {
  const plan: RecommendExpanderPlan = { shiftIn: 0, shiftOut: 0, analogMux: 0, digitalMux: 0, i2cIn: 0, i2cOut: 0, pwmExp: 0 }
  const hasI2c = recommendBoardHasI2c(board)
  for (let guard = 0; guard < 256; guard += 1) {
    const result = recommendAllocate(board, recommendDemands(req, plan))
    if (result.ok) return { plan, fits: true }
    const unmatched = result.unmatched
    // Bus pins can never be expanded onto more pins — if they are missing, this board is out.
    if (unmatched.has('sda') || unmatched.has('scl') || unmatched.has('mosi') || unmatched.has('miso') || unmatched.has('sck')) return { plan, fits: false }
    if (unmatched.has('analog')) {
      if (Math.min(req.analogIn, plan.analogMux * RECOMMEND_MUX_CHANNELS) < req.analogIn) { plan.analogMux += 1; continue }
      return { plan, fits: false } // overflow is analogDirect, which cannot be offloaded
    }
    if (unmatched.has('pwm')) {
      if (hasI2c && plan.pwmExp * RECOMMEND_PWM_CHANNELS < req.pwm) { plan.pwmExp += 1; continue }
      return { plan, fits: false }
    }
    if (unmatched.has('digital')) {
      const digInCovered = Math.min(req.digitalIn, plan.shiftIn * RECOMMEND_SHIFT_CHANNELS + plan.i2cIn * RECOMMEND_I2C_GPIO_CHANNELS)
      const digOutCovered = Math.min(req.digitalOut, plan.shiftOut * RECOMMEND_SHIFT_CHANNELS + plan.i2cOut * RECOMMEND_I2C_GPIO_CHANNELS)
      if (req.digitalIn - digInCovered > 0) {
        if (strategy === 'i2c' && hasI2c && plan.i2cIn < RECOMMEND_MAX_I2C_GPIO_CHIPS) plan.i2cIn += 1
        else plan.shiftIn += 1
        continue
      }
      if (req.digitalOut - digOutCovered > 0) {
        if (strategy === 'i2c' && hasI2c && plan.i2cOut < RECOMMEND_MAX_I2C_GPIO_CHIPS) plan.i2cOut += 1
        else plan.shiftOut += 1
        continue
      }
      return { plan, fits: false } // overflow is directDigital / control / select lines that cannot shrink
    }
    return { plan, fits: false }
  }
  return { plan, fits: false }
}

function recommendBuildPlan(board: BoardCatalogEntry, req: BuildRequirement, plan: RecommendExpanderPlan): BoardArchitecturePlan {
  const expanders: RecommendedExpander[] = []
  if (plan.analogMux > 0) expanders.push({ definitionId: 'cd74hc4067', kind: 'cd74hc4067', name: 'CD74HC4067 16-ch mux', count: plan.analogMux, channelsEach: RECOMMEND_MUX_CHANNELS, sigMode: 'analog', purpose: `fan ${plan.analogMux * RECOMMEND_MUX_CHANNELS} analog channels into ${plan.analogMux} ADC pin(s) + 4 shared select pins` })
  if (plan.digitalMux > 0) expanders.push({ definitionId: 'cd74hc4067', kind: 'cd74hc4067', name: 'CD74HC4067 16-ch mux', count: plan.digitalMux, channelsEach: RECOMMEND_MUX_CHANNELS, sigMode: 'digital', purpose: `read ${plan.digitalMux * RECOMMEND_MUX_CHANNELS} on/off inputs through ${plan.digitalMux} signal pin(s) + 4 shared select pins` })
  if (plan.shiftIn > 0) expanders.push({ definitionId: '74hc165', kind: '74hc165', name: '74HC165 shift-in', count: plan.shiftIn, channelsEach: RECOMMEND_SHIFT_CHANNELS, purpose: `read up to ${plan.shiftIn * RECOMMEND_SHIFT_CHANNELS} on/off inputs over one 3-wire daisy chain` })
  if (plan.shiftOut > 0) expanders.push({ definitionId: '74hc595', kind: '74hc595', name: '74HC595 shift-out', count: plan.shiftOut, channelsEach: RECOMMEND_SHIFT_CHANNELS, purpose: `drive up to ${plan.shiftOut * RECOMMEND_SHIFT_CHANNELS} LED/segment outputs over one 3-wire daisy chain` })
  if (plan.i2cIn > 0) expanders.push({ definitionId: 'mcp23017', kind: 'mcp23017', name: 'MCP23017 I2C GPIO', count: plan.i2cIn, channelsEach: RECOMMEND_I2C_GPIO_CHANNELS, purpose: `read up to ${plan.i2cIn * RECOMMEND_I2C_GPIO_CHANNELS} inputs over the shared I2C bus` })
  if (plan.i2cOut > 0) expanders.push({ definitionId: 'mcp23017', kind: 'mcp23017', name: 'MCP23017 I2C GPIO', count: plan.i2cOut, channelsEach: RECOMMEND_I2C_GPIO_CHANNELS, purpose: `drive up to ${plan.i2cOut * RECOMMEND_I2C_GPIO_CHANNELS} outputs over the shared I2C bus` })
  if (plan.pwmExp > 0) expanders.push({ definitionId: 'pca9685-pwm', kind: 'pca9685-pwm', name: 'PCA9685 PWM driver', count: plan.pwmExp, channelsEach: RECOMMEND_PWM_CHANNELS, purpose: `add ${plan.pwmExp * RECOMMEND_PWM_CHANNELS} PWM channels over the shared I2C bus` })

  const extraChips = plan.shiftIn + plan.shiftOut + plan.analogMux + plan.digitalMux + plan.i2cIn + plan.i2cOut + plan.pwmExp
  const demands = recommendDemands(req, plan)
  const allocation = recommendAllocate(board, demands)

  const analogAvailable = board.pins.filter((pin) => pin.analogIn).length
  const digitalAvailable = board.pins.filter((pin) => !pin.power && pin.digital).length
  const pwmAvailable = board.pins.filter((pin) => !pin.power && pin.pwm).length
  const signalPinsAvailable = recommendSignalPins(board).filter((pin) => pin.digital || pin.analogIn || pin.pwm || pin.i2c || pin.spi || pin.uart).length
  const pinBudget: RecommendedPinBudget = {
    digitalUsed: demands.filter((kind) => kind === 'digital' || kind === 'uart').length,
    digitalAvailable,
    analogUsed: demands.filter((kind) => kind === 'analog').length,
    analogAvailable,
    pwmUsed: demands.filter((kind) => kind === 'pwm').length,
    pwmAvailable,
    i2cBus: demands.includes('sda'),
    spiBus: demands.includes('mosi'),
    signalPinsUsed: allocation.used,
    signalPinsAvailable
  }

  const preferenceIndex = RECOMMEND_BOARD_PREFERENCE.indexOf(board.id)
  // Fewest extra chips dominates; then fewest board pins consumed; then a common,
  // smaller board over a niche / oversized one.
  const preferencePenalty = preferenceIndex < 0 ? 20 : preferenceIndex
  const score = extraChips * 100 + allocation.used * 2 + preferencePenalty + board.pins.length * 0.05

  return {
    boardId: board.id,
    boardName: board.name,
    fits: allocation.ok,
    directFit: allocation.ok && extraChips === 0,
    expanders,
    extraChips,
    pinBudget,
    rationale: recommendRationale(board, req, expanders, pinBudget, extraChips),
    warnings: recommendWarnings(board, req, plan),
    score
  }
}

function recommendDemandSentence(req: BuildRequirement): string {
  const analog = req.analogIn + req.analogDirect
  const parts: string[] = []
  const add = (count: number, singular: string): void => { if (count > 0) parts.push(`${count} ${singular}${count > 1 ? 's' : ''}`) }
  add(req.digitalIn, 'button-style input')
  add(req.digitalOut, 'simple output')
  add(analog, 'analog input')
  add(req.pwm, 'PWM channel')
  add(req.directDigital, 'dedicated digital line')
  add(req.i2cDevices, 'I2C device')
  add(req.spiDevices, 'SPI device')
  add(req.uartDevices, 'serial device')
  return parts.length > 0 ? parts.join(', ') : 'no signal pins'
}

function recommendRationale(board: BoardCatalogEntry, req: BuildRequirement, expanders: RecommendedExpander[], budget: RecommendedPinBudget, extraChips: number): string[] {
  const lines: string[] = [`This build needs ${recommendDemandSentence(req)}.`]
  if (extraChips === 0) {
    lines.push(`${board.name} hosts everything directly — ${budget.signalPinsUsed} of ${budget.signalPinsAvailable} usable signal pins, no extra chips.`)
  } else {
    for (const expander of expanders) lines.push(`${expander.count}× ${expander.name}: ${expander.purpose}.`)
    lines.push(`${board.name} then uses only ${budget.signalPinsUsed} of ${budget.signalPinsAvailable} signal pins to drive ${extraChips} expander chip(s) plus any direct parts.`)
  }
  if (req.needsUsbHid) lines.push('A native-USB board is required because a selected part acts as a USB HID controller.')
  return lines
}

function recommendWarnings(board: BoardCatalogEntry, req: BuildRequirement, plan: RecommendExpanderPlan): string[] {
  const warnings: string[] = []
  const offloadedDigitalIn = plan.shiftIn + plan.digitalMux + plan.i2cIn > 0
  const hasEncoder = req.items.some((item) => item.definitionId === 'rotary-encoder' || item.definitionId === 'rotary-encoder-no-button')
  if (hasEncoder && offloadedDigitalIn) warnings.push('Rotary encoders respond best on direct interrupt pins; reading them through an expander can miss fast steps.')
  if (plan.i2cIn + plan.i2cOut > RECOMMEND_MAX_I2C_GPIO_CHIPS) warnings.push('More than 8 MCP23017 chips exceed the available I2C addresses; mix in shift registers instead.')
  if (req.uartDevices > 1) warnings.push('Multiple serial devices may need extra hardware UARTs or SoftwareSerial.')
  if (req.only3v3 && board.lapge === '5V') warnings.push('Some selected modules are 3.3V-only; add level shifting on this 5V board.')
  return warnings
}

function recommendInfeasiblePlan(board: BoardCatalogEntry, reasons: string[]): BoardArchitecturePlan {
  return {
    boardId: board.id,
    boardName: board.name,
    fits: false,
    directFit: false,
    expanders: [],
    extraChips: 0,
    pinBudget: { digitalUsed: 0, digitalAvailable: 0, analogUsed: 0, analogAvailable: 0, pwmUsed: 0, pwmAvailable: 0, i2cBus: false, spiBus: false, signalPinsUsed: 0, signalPinsAvailable: 0 },
    rationale: [],
    warnings: reasons,
    score: Number.POSITIVE_INFINITY
  }
}

function recommendPlanBoard(board: BoardCatalogEntry, req: BuildRequirement, catalog: MergedCatalog): BoardArchitecturePlan {
  // Reuse the per-component compatibility helper to reject boards on lapge,
  // USB-HID, missing power rails or missing buses before counting pins.
  const reasons: string[] = []
  const compatibilityWarnings: string[] = []
  for (const item of req.items) {
    const definition = catalog.componentsById[item.definitionId]
    if (!definition) continue
    const compatibility = getComponentBoardCompatibility(definition, board)
    if (!compatibility.compatible) {
      reasons.push(`${definition.shortName}: ${compatibility.reasons[0] ?? 'not compatible with this board'}`)
    }
    for (const warning of compatibility.warnings) compatibilityWarnings.push(`${definition.shortName}: ${warning}`)
  }
  if (reasons.length > 0) return recommendInfeasiblePlan(board, [...new Set(reasons)])

  const strategies: RecommendStrategy[] = recommendBoardHasI2c(board) ? ['shift', 'i2c'] : ['shift']
  const feasible = strategies
    .map((strategy) => recommendPlanStrategy(board, req, strategy))
    .filter((result) => result.fits)
    .map((result) => recommendBuildPlan(board, req, result.plan))
  if (feasible.length === 0) return recommendInfeasiblePlan(board, [`${board.name} cannot fit this build even with expanders.`])
  const chosen = feasible.sort((a, b) => a.score - b.score)[0]
  chosen.warnings = [...new Set([...chosen.warnings, ...compatibilityWarnings])]
  return chosen
}

function recommendSummary(plan: BoardArchitecturePlan): string {
  if (plan.directFit) return `${plan.boardName} fits everything directly — no expanders needed.`
  const chips = plan.expanders.map((expander) => `${expander.count}× ${expander.name}`).join(' + ')
  return `${plan.boardName} + ${chips}.`
}

/**
 * Recommend the simplest board + wiring architecture for a set of desired parts.
 * Returns the chosen board (fewest extra chips, then fewest pins, then simplest
 * board) plus a few ranked alternatives so the builder can trade a bigger board
 * for fewer chips, or a small board + a multiplexer/expander, with the reasons.
 */
export function recommendBuild(selected: RecommendSelection[], catalog: MergedCatalog = mergeCatalog()): BuildRecommendation {
  const requirement = summarizeBuildRequirement(selected, catalog)
  if (requirement.totalComponents === 0) {
    return { ok: false, requirement, chosen: null, alternatives: [], summary: 'Select at least one component to get a recommendation.', unmetReasons: [] }
  }
  const allPlans = catalog.boards.map((board) => recommendPlanBoard(board, requirement, catalog))
  const plans = allPlans.filter((plan) => plan.fits).sort((a, b) => a.score - b.score)
  if (plans.length === 0) {
    const reasons = allPlans.flatMap((plan) => plan.warnings)
    return { ok: false, requirement, chosen: null, alternatives: [], summary: 'No catalog board can host this combination, even with expanders.', unmetReasons: [...new Set(reasons)].slice(0, 6) }
  }
  const chosen = plans[0]
  const rest = plans.slice(1)
  return { ok: true, requirement, chosen, alternatives: recommendAlternatives(chosen, rest), summary: recommendSummary(chosen), unmetReasons: [] }
}

/**
 * Pick up to four ranked alternatives, but guarantee an architectural contrast:
 * if the chosen board is a clean direct fit, make sure the builder also sees the
 * best "smaller board + expander(s)" option (and vice-versa). This is what makes
 * the reverse flow useful — surfacing the mux/expander trade-off, not just five
 * variations of the same big board.
 */
function recommendAlternatives(chosen: BoardArchitecturePlan, rest: BoardArchitecturePlan[]): BoardArchitecturePlan[] {
  const picks: BoardArchitecturePlan[] = []
  for (const plan of rest) {
    if (picks.length >= 3) break
    picks.push(plan)
  }
  const contrast = chosen.directFit ? rest.find((plan) => plan.extraChips > 0) : rest.find((plan) => plan.directFit)
  if (contrast && !picks.includes(contrast)) {
    if (picks.length >= 4) picks.pop()
    picks.push(contrast)
  }
  return picks.slice(0, 4)
}
