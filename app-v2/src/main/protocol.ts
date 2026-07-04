// SIM-X / SimHub protocol helpers — wire format reference comes from the real
// firmware sketch (see ../../firmware/sim-x-reference/button_box.ino):
//
//   App → box (TX):
//     R<lvl>\n            rev lights level, lvl ∈ [0, REV_LEVEL_MAX]
//     B<0|1>\n            shift indicator (blue) blink
//     O<l1>|<l2>|<l3>\n   3-line OLED text (≤21 ASCII chars per line)
//     D<num>\n            OLED BIGNUM (≤9 chars, font logisoso38 — 0-9 + - .)
//     S<0|1>\n            START LED (TXLED on Pro Micro)
//
//   Box → app (RX):
//     E<idx>:+1\n         encoder click forward
//     E<idx>:-1\n         encoder click backward
//
// Buttons and the joystick POV hat are HID — read on the renderer with the
// Web Gamepad API, never over serial. The firmware exposes NO handshake
// (no >ID?/MAP/CFG/SAVE), so port identification falls back to USB friendlyName.

import { budgetOledLines, sanitizeOledBigNum, OLED_LINE_COUNT } from '../shared/oled'
import { REVLIGHTS_DEVICE_LED_COUNT } from '../shared/revlights'

export const REV_LEVEL_MAX = REVLIGHTS_DEVICE_LED_COUNT

export function formatRevLevel(level: number): string {
  const safe = Math.max(0, Math.min(REV_LEVEL_MAX, Math.trunc(Number.isFinite(level) ? level : 0)))
  return `R${safe}\n`
}

export function formatShiftBlink(active: boolean): string {
  return `B${active ? 1 : 0}\n`
}

export function formatOled(line1: string, line2: string, line3: string): string {
  const [a, b, c] = budgetOledLines(line1, line2, line3)
  return `O${a}|${b}|${c}\n`
}

export function formatOledLines(lines: readonly string[]): string {
  const padded = Array.from({ length: OLED_LINE_COUNT }, (_, index) => lines[index] ?? '')
  return formatOled(padded[0], padded[1], padded[2])
}

export function formatBigNum(value: string): string {
  return `D${sanitizeOledBigNum(value ?? '')}\n`
}

export function formatStartLed(on: boolean): string {
  return `S${on ? 1 : 0}\n`
}

export interface ParsedEncoderLine {
  index: number
  direction: 1 | -1
}

// "E3:+1", "E0:-1" (with or without trailing CR/LF). Anything else returns
// null so the serial reader can ignore garbage / firmware debug lines.
export function parseEncoderLine(line: string): ParsedEncoderLine | null {
  if (typeof line !== 'string') return null
  const match = /^E(\d+):([+-]?\d+)$/.exec(line.replace(/\r$/, '').trim())
  if (!match) return null
  const index = Number(match[1])
  const delta = Number(match[2])
  if (!Number.isInteger(index) || index < 0 || index > 63) return null
  if (delta > 0) return { index, direction: 1 }
  if (delta < 0) return { index, direction: -1 }
  return null
}

// SerialPort.list() returns friendlyName/manufacturer when the OS knows them
// (always on Windows for USB CDC devices, sometimes on macOS). When the user
// re-flashes the SIM-X firmware that customises the USB descriptor we should
// match it here; until then the Pro Micro still enumerates as Arduino Leonardo
// and the user picks the COM manually.
export function isSimXFriendlyName(value: string | undefined | null): boolean {
  if (!value) return false
  return /sim-?x/i.test(value)
}

// USB vendor IDs used by the boards the SIM-X Button Box runs on: Arduino
// (Leonardo/Micro genuine), SparkFun (Pro Micro), and the generic ATmega32U4
// vendor seen on some clones. SerialPort reports vendorId as a hex string
// without the 0x prefix and with inconsistent casing.
const SIMX_VENDOR_IDS = new Set(['2341', '1b4f', '2a03', '239a'])

export function isLikelyLeonardoFriendlyName(value: string | undefined | null): boolean {
  if (!value) return false
  return /leonardo|pro\s*micro|sparkfun|atmega32u4|arduino\s*micro/i.test(value)
}

// Best-effort "this is probably the button box" hint for the device picker.
// Matches the explicit SIM-X descriptor (after the user re-flashes a custom
// USB string), known Pro Micro / Leonardo vendor IDs, or the typical
// friendly-name strings. Used only as a UI badge — never to filter the port
// list, so the user can always connect manually.
export function isLikelySimXPort(port: {
  friendlyName?: string | null
  manufacturer?: string | null
  vendorId?: string | null
}): boolean {
  if (isSimXFriendlyName(port.friendlyName) || isSimXFriendlyName(port.manufacturer)) return true
  if (isLikelyLeonardoFriendlyName(port.friendlyName) || isLikelyLeonardoFriendlyName(port.manufacturer)) {
    return true
  }
  const vid = port.vendorId?.toLowerCase().replace(/^0x/, '')
  return vid ? SIMX_VENDOR_IDS.has(vid) : false
}
