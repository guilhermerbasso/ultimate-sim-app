// Companion Serial Protocol — shared formatters and parsers used by the
// generic-device side of the Arduinos area (custom serial outputs, inputs
// monitor) and the matching companion firmware sketch.
//
// Wire format (115200 8N1, newline-terminated):
//
//   App → device (TX):
//     T<row>:<text>\n        OLED text row, row ∈ [0,3], text ≤21 chars
//     N<text>\n              OLED BIGNUM, text ≤9 chars (0-9 . - : space)
//     R<0-100>\n             rev lights %, drives a WS2812 strip
//     B<0|1>\n               blue shift blink
//     M<16 hex chars>\n      8x8 matrix (MAX7219) — 8 rows × 8 bits = 16 hex
//     L<idx>:<rrggbb>\n      addressable LED idx → 6-hex RGB colour
//     C\n                    clear all (OLED + LEDs)
//
//   device → App (RX):
//     B<idx>:<0|1>\n         button idx state (0 = released, 1 = pressed)
//     E<idx>:+1\n            encoder tick forward
//     E<idx>:-1\n            encoder tick backward
//     A<idx>:<0-1023>\n      analog/axis idx raw value
//
// Keep this file dependency-free so main, preload and renderer can all consume
// it. It MUST NOT import anything from `src/main/` or React.

// ─── Constants ──────────────────────────────────────────────────────────────

export const COMPANION_BAUD = 115200
export const COMPANION_OLED_ROWS = 4
export const COMPANION_OLED_LINE_WIDTH = 21
export const COMPANION_BIGNUM_MAX = 9
export const COMPANION_REV_MAX = 100
export const COMPANION_MATRIX_HEX_LEN = 16
export const COMPANION_MAX_COMMAND_LEN = 63

// ─── Helpers ────────────────────────────────────────────────────────────────

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  const n = Math.trunc(value)
  if (n < min) return min
  if (n > max) return max
  return n
}

// Strip newlines (the protocol is line-terminated; embedded \n would split the
// payload mid-command) and keep only printable ASCII so the device parser
// never sees a CR/LF/control byte in the middle of a text field.
function sanitizePrintable(value: string, maxLen: number): string {
  if (typeof value !== 'string' || !value) return ''
  let cleaned = ''
  for (let i = 0; i < value.length && cleaned.length < maxLen; i++) {
    const code = value.charCodeAt(i)
    if (code >= 0x20 && code < 0x7f) cleaned += value[i]
    else cleaned += ' '
  }
  return cleaned
}

// Big-num only renders digits, sign, decimal point, colon and spaces. Strip
// anything else so the device font doesn't show ?-glyphs.
function sanitizeBigNum(value: string): string {
  if (typeof value !== 'string') return ''
  let out = ''
  for (let i = 0; i < value.length && out.length < COMPANION_BIGNUM_MAX; i++) {
    const ch = value[i]
    if (/[0-9.\-:\s]/.test(ch)) out += ch
  }
  return out
}

function isHex(value: string): boolean {
  return /^[0-9a-fA-F]+$/.test(value)
}

// ─── Formatters (App → device) ──────────────────────────────────────────────
// Each formatter returns the wire string WITHOUT trailing newline so callers
// (router, monitor) can append \n at the same place — matches the existing
// SerialDevice.sendRaw() contract.

export function formatOledRow(row: number, text: string): string {
  const r = clampInt(row, 0, COMPANION_OLED_ROWS - 1)
  return `T${r}:${sanitizePrintable(text, COMPANION_OLED_LINE_WIDTH)}`
}

export function formatBigNum(value: string): string {
  return `N${sanitizeBigNum(value)}`
}

export function formatRevPercent(pct: number): string {
  return `R${clampInt(pct, 0, COMPANION_REV_MAX)}`
}

export function formatShiftBlink(active: boolean): string {
  return `B${active ? 1 : 0}`
}

// Accepts a 16-char hex string (8 rows × 2 hex chars). Anything else is
// rejected — better to return null and let the caller log/skip than to send a
// malformed frame to the firmware.
export function formatMatrix(hex16: string): string | null {
  if (typeof hex16 !== 'string') return null
  const trimmed = hex16.trim().toLowerCase()
  if (trimmed.length !== COMPANION_MATRIX_HEX_LEN || !isHex(trimmed)) return null
  return `M${trimmed}`
}

// Accepts a 6-char hex colour ("rrggbb"), with or without '#'.
export function formatAddressableLed(index: number, rgbHex: string): string | null {
  const idx = clampInt(index, 0, 9999)
  if (typeof rgbHex !== 'string') return null
  const hex = rgbHex.trim().replace(/^#/, '').toLowerCase()
  if (hex.length !== 6 || !isHex(hex)) return null
  return `L${idx}:${hex}`
}

export const COMPANION_CLEAR_COMMAND = 'C'

// ─── Parsers (device → App) ─────────────────────────────────────────────────

export type CompanionInputKind = 'button' | 'encoder' | 'analog'

export interface CompanionButtonEvent {
  kind: 'button'
  index: number
  pressed: boolean
}

export interface CompanionEncoderEvent {
  kind: 'encoder'
  index: number
  direction: 1 | -1
}

export interface CompanionAnalogEvent {
  kind: 'analog'
  index: number
  value: number
}

export type CompanionInputEvent =
  | CompanionButtonEvent
  | CompanionEncoderEvent
  | CompanionAnalogEvent

// Parse a single RX line. Returns null when the line is not a recognised
// companion input message (debug echoes, partial frames, garbage). The caller
// is responsible for the device's full rx buffer.
export function parseCompanionInput(line: string): CompanionInputEvent | null {
  if (typeof line !== 'string') return null
  const trimmed = line.replace(/\r$/, '').trim()
  if (!trimmed) return null

  // Button: "B<idx>:<0|1>" — idx is non-negative.
  const button = /^B(\d+):([01])$/.exec(trimmed)
  if (button) {
    const index = Number(button[1])
    if (!Number.isInteger(index) || index < 0 || index > 255) return null
    return { kind: 'button', index, pressed: button[2] === '1' }
  }

  // Encoder: "E<idx>:+1" or "E<idx>:-1" (also accept signed integers in case
  // the firmware coalesces ticks).
  const encoder = /^E(\d+):([+-]?\d+)$/.exec(trimmed)
  if (encoder) {
    const index = Number(encoder[1])
    const delta = Number(encoder[2])
    if (!Number.isInteger(index) || index < 0 || index > 63) return null
    if (delta > 0) return { kind: 'encoder', index, direction: 1 }
    if (delta < 0) return { kind: 'encoder', index, direction: -1 }
    return null
  }

  // Analog/axis: "A<idx>:<0-1023>"
  const analog = /^A(\d+):(\d+)$/.exec(trimmed)
  if (analog) {
    const index = Number(analog[1])
    const value = Number(analog[2])
    if (!Number.isInteger(index) || index < 0 || index > 63) return null
    if (!Number.isInteger(value) || value < 0 || value > 1023) return null
    return { kind: 'analog', index, value }
  }

  return null
}

// ─── Custom Serial output presets ───────────────────────────────────────────
// Each preset describes a ready-to-use template for the Custom Serial Device
// output builder. The Arduinos view exposes these so the user can pick a
// preset, point it at a telemetry field / expression / device, and persist it
// as an OutputRoute (`{kind:'serial',deviceId,template}`).
//
// The template uses the `${value}` / `${field}` placeholders already supported
// by `interpolateTemplate` in `src/shared/outputs.ts`. The router substitutes
// them, appends '\n', and ships to the chosen device.

export type CompanionPresetKind = 'oled-row' | 'bignum' | 'rev' | 'matrix' | 'led-rgb'

export interface CompanionPreset {
  id: string
  kind: CompanionPresetKind
  label: string
  description: string
  // Template used by `OutputRoute.target.template` with `${value}` placeholder.
  template: string
  // Recommended numeric formatting for the source value (decimals/scale).
  defaultFormat?: { decimals?: number; scale?: number; prefix?: string; suffix?: string }
  // Optional helper text shown in the composer.
  hint?: string
}

export const COMPANION_PRESETS: CompanionPreset[] = [
  {
    id: 'oled-row-top',
    kind: 'oled-row',
    label: 'OLED — linha 0 (topo)',
    description: 'Texto na primeira linha do display OLED (≤21 chars).',
    template: 'T0:${value}',
    defaultFormat: { decimals: 0 },
    hint: 'Use para mostrar gear, lap atual, position, etc.'
  },
  {
    id: 'oled-row-mid',
    kind: 'oled-row',
    label: 'OLED — linha 1 (meio)',
    description: 'Texto na linha 1 do display OLED.',
    template: 'T1:${value}',
    defaultFormat: { decimals: 0 }
  },
  {
    id: 'oled-row-bottom',
    kind: 'oled-row',
    label: 'OLED — linha 3 (base)',
    description: 'Texto na last linha (3) do display OLED.',
    template: 'T3:${value}',
    defaultFormat: { decimals: 0 }
  },
  {
    id: 'bignum-delta',
    kind: 'bignum',
    label: 'OLED BIGNUM (delta/gear)',
    description: 'Large number (≤9 chars). Great for delta de lap ou current gear.',
    template: 'N${value}',
    defaultFormat: { decimals: 2 },
    hint: 'Value is truncated para 9 chars no firmware.'
  },
  {
    id: 'rev-lights-ws2812',
    kind: 'rev',
    label: 'Rev Lights (WS2812 0–100%)',
    description: 'Rev percentage (0–100) para uma addressable strip.',
    template: 'R${value}',
    defaultFormat: { decimals: 0, scale: 100 },
    hint: 'Use an expression that returns 0..1 com scale=100, or already in %.'
  },
  {
    id: 'matrix-8x8',
    kind: 'matrix',
    label: '8x8 LED Matrix (MAX7219)',
    description: 'Bitmap 8x8 — value deve ser 16 hex chars (linhas top→bottom).',
    template: 'M${value}',
    hint: 'Use com uma expression que devolva 16 hex chars (ex.: pictogramas).'
  },
  {
    id: 'led-status',
    kind: 'led-rgb',
    label: 'Addressable LED #0 (status)',
    description: 'Color of the first Addressable LED (hex rrggbb).',
    template: 'L0:${value}',
    hint: 'Valor expectsdo: 6 hex chars sem # (ex.: ff0000 para vermelho).'
  },
  {
    id: 'led-flag',
    kind: 'led-rgb',
    label: 'Addressable LED #1 (flag)',
    description: 'Cor do LED #1 — good for flag indication.',
    template: 'L1:${value}'
  }
]

export function findCompanionPreset(id: string): CompanionPreset | null {
  return COMPANION_PRESETS.find((preset) => preset.id === id) ?? null
}

// ─── Protocol v2 — richer per-component frames (additive) ────────────────────
// All v1 commands above stay byte-for-byte compatible. v2 adds frames the
// generic companion firmware understands for true RGB strips/matrices, analog
// gauges, 7-seg displays and a buzzer, plus a capabilities handshake so the app
// can discover what a freshly-flashed device actually has wired.
//
//   App → device (TX):
//     P<rrggbb...>\n          RGB strip pixels, packed 6-hex per LED (from #0)
//     Q<row>:<48hex>\n        RGB matrix row (row 0-based, 8 px × rrggbb)
//     G<idx>:<angle>\n        gauge/servo idx → angle in degrees (0-359)
//     7<text>\n               7-seg text (digits, '.', '-', ' '; ≤ digit count)
//     Z<freq>:<ms>\n          buzzer tone (freq Hz, ms duration; freq 0 = off)
//     ?\n                     query capabilities (device replies K: lines)
//
//   iFlag 8x8 matrix only (companion_iflag.ino), reusing M/T which the iFlag
//   firmware never used for monochrome bitmaps/OLED text:
//     M<2 hex>\n              set+persist the matrix layout byte (EEPROM) and
//                             re-render. Bitfield: bit0 serpentine, bits1-2
//                             rotation (0/90/180/270), bit3 flipX, bit4 flipY.
//     T<n>\n                  calibration pattern: 0 origin corner, 1 logical
//                             row 0, 2 logical column 0, 3 asymmetric "F" glyph
//                             (n ∈ 0..3).
//
//   device → App (RX), in addition to the v1 B/E/A input lines:
//     K:<key>=<detail>\n      capability, e.g. "K:rgbStrip=4" / "K:rgbMatrix=8x8"
//                             the iFlag also reports "K:layout=<2hex>"
//     KEND\n                  end of capability report

export const COMPANION_PROTOCOL_VERSION = 2
export const COMPANION_QUERY_COMMAND = '?'
export const COMPANION_CAP_END = 'KEND'
// A generic companion firmware uses a bigger line buffer than the SIM-X box, so
// matrix/strip frames may exceed the 63-char SIM-X ceiling. Keep a sane upper
// bound anyway to protect the smallest boards.
export const COMPANION_V2_MAX_COMMAND_LEN = 200

// A `P` pixel-stream frame is NOT a line: generic matrix firmware reads it
// character-by-character into a pixel accumulator (it never lands in the
// line buffer), so it is not bounded by COMPANION_V2_MAX_COMMAND_LEN. A full
// 64-LED panel is `P` + 64×6 hex = 385 chars; keep a generous upper bound to
// protect against pathological input while letting one atomic frame through.
export const COMPANION_V2_MAX_STREAM_LEN = 512

function clamp01Hex(value: string): string {
  let hex = value.trim().replace(/^#/, '').toLowerCase()
  // Expand 3-digit shorthand (#f00 → ff0000) so hand-edited short colours render
  // the intended colour instead of falling through to off.
  if (hex.length === 3 && isHex(hex)) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
  }
  return hex.length === 6 && isHex(hex) ? hex : '000000'
}

// Pack an array of "#rrggbb"/"rrggbb" colours into a strip frame `P...`. Returns
// null when empty. The `P` frame is streamed char-by-char by generic matrix
// firmware (bypassing the line buffer), so a full panel may be sent as ONE frame
// up to COMPANION_V2_MAX_STREAM_LEN; only the tiny SIM-X line buffer needs chunking.
export function formatStripRgb(colors: string[]): string | null {
  if (!Array.isArray(colors) || colors.length === 0) return null
  const packed = colors.map(clamp01Hex).join('')
  return `P${packed}`
}

// One RGB matrix row: `Q<row>:<8×rrggbb>`. `row` is 0-based; `colors` is the 8
// pixels left→right for that row. Shorter/longer arrays are padded/truncated.
export function formatMatrixRowRgb(row: number, colors: string[], width = 8): string {
  const r = clampInt(row, 0, 63)
  const padded: string[] = []
  for (let i = 0; i < width; i++) padded.push(clamp01Hex(colors[i] ?? '000000'))
  return `Q${r}:${padded.join('')}`
}

// Servo/stepper gauge angle. `angle` is degrees; clamped to 0-359.
export function formatGaugeAngle(index: number, angle: number): string {
  return `G${clampInt(index, 0, 63)}:${clampInt(angle, 0, 359)}`
}

// 7-seg text. Only digits, '.', '-', ':' and space survive; trimmed to maxDigits.
export function formatSegText(value: string, maxDigits = 8): string {
  if (typeof value !== 'string') return '7'
  let out = ''
  for (let i = 0; i < value.length && out.length < maxDigits; i++) {
    const ch = value[i]
    if (/[0-9.\-: ]/.test(ch)) out += ch
  }
  return `7${out}`
}

// Buzzer tone. `freqHz = 0` (or `active = false`) silences it.
export function formatBuzzer(freqHz: number, durationMs = 120): string {
  const freq = clampInt(freqHz, 0, 20000)
  const ms = clampInt(durationMs, 0, 60000)
  return `Z${freq}:${ms}`
}

// Global LED brightness for strips/matrices (0-255). `Y0` = off.
export function formatBrightness(value: number): string {
  return `Y${clampInt(value, 0, 255)}`
}

// iFlag 8x8 matrix layout byte → `M<2 hex>`. The byte is the serpentine /
// rotation / flip bitfield the iFlag firmware persists in EEPROM and applies in
// xyToIndex (see encodeMatrixLayout in `./rgb-matrix.ts`). Distinct on the wire
// from the legacy `M<16 hex>` MAX7219 bitmap because it is exactly 2 hex chars,
// so a panel only ever reacts to the one it understands.
export function formatMatrixLayout(layoutByte: number): string {
  const value = clampInt(layoutByte, 0, 255)
  return `M${value.toString(16).padStart(2, '0')}`
}

// iFlag calibration test pattern → `T<n>`: 0 = origin corner LED, 1 = logical
// row 0, 2 = logical column 0, 3 = bold asymmetric "F" glyph. Lit through the
// device's current layout so the physical wiring can be identified and corrected
// from the app — the "F" is asymmetric in both axes, so any mirror, rotation or
// serpentine scramble is immediately obvious.
export function formatMatrixCalibration(mode: number): string {
  return `T${clampInt(mode, 0, 3)}`
}

// iFlag manual-remap probe → `I<idx>`: light EXACTLY one PHYSICAL LED (0-based,
// raw — bypasses the layout/xyToIndex) white at a guaranteed-visible brightness.
// Self-contained (one frame, one show) so it works on slow/old boards where a
// burst of multi-row `Q` frames may not render. The app's per-pixel manual remap
// uses this to identify the wiring of panels that match no serpentine/rotation/
// flip preset; the user taps the cell where the lit LED appears.
export function formatMatrixPixelProbe(physicalIndex: number): string {
  return `I${clampInt(physicalIndex, 0, 4095)}`
}

// ─── Capabilities handshake (device → App) ──────────────────────────────────

export interface CompanionCapability {
  // Matches `ComponentTypeInfo.capabilityKey` in `./devices.ts`
  key: string
  // Free-form detail the firmware reports (e.g. "4", "8x8", "tm1638").
  detail: string
}

// Parse a single capability line "K:<key>=<detail>". Returns null otherwise.
export function parseCapabilityLine(line: string): CompanionCapability | null {
  if (typeof line !== 'string') return null
  // The `=<detail>` part is optional: a firmware may report a bare `K:buzzer`.
  const match = /^K:([a-zA-Z][a-zA-Z0-9]*)(?:=(.*))?$/.exec(line.replace(/\r$/, '').trim())
  if (!match) return null
  return { key: match[1], detail: (match[2] ?? '').trim() }
}

export function isCapabilityEnd(line: string): boolean {
  return typeof line === 'string' && line.replace(/\r$/, '').trim() === COMPANION_CAP_END
}

// ─── Render helper ──────────────────────────────────────────────────────────
// Build the wire payload (without trailing newline) for a known preset given
// the already-formatted output value (i.e. what the output-router produces
// after applying OutputFormat).
export function renderCompanionPreset(preset: CompanionPreset, formattedValue: string): string | null {
  const value = formattedValue ?? ''
  switch (preset.kind) {
    case 'oled-row': {
      const match = /^T(\d+):/.exec(preset.template)
      const row = match ? Number(match[1]) : 0
      return formatOledRow(row, value)
    }
    case 'bignum':
      return formatBigNum(value)
    case 'rev': {
      const pct = Number(value)
      if (!Number.isFinite(pct)) return null
      return formatRevPercent(pct)
    }
    case 'matrix':
      return formatMatrix(value)
    case 'led-rgb': {
      const match = /^L(\d+):/.exec(preset.template)
      const idx = match ? Number(match[1]) : 0
      return formatAddressableLed(idx, value)
    }
    default:
      return null
  }
}
