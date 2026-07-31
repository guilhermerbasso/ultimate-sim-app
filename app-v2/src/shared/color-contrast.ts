/**
 * WCAG 2.2 contrast arithmetic, shared by the runtime theme engine and the
 * design-token guard test so both measure the same way.
 *
 * Everything here is sRGB and framework-free: no DOM, no colour library. The
 * app already ships nineteen selectable themes plus a user-chosen custom
 * accent, so contrast cannot be a property of one hand-tuned palette — it has
 * to be something the theme engine can enforce on any input.
 */

export type Rgb = readonly [number, number, number]

export const WCAG_TEXT_MIN = 4.5
export const WCAG_NON_TEXT_MIN = 3

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function fromHex(value: string): Rgb | null {
  const match = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!match) return null
  const raw = match[1]
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16)
  ]
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => clampChannel(c).toString(16).padStart(2, '0')).join('')}`
}

export function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return [
    clampChannel(from[0] + (to[0] - from[0]) * amount),
    clampChannel(from[1] + (to[1] - from[1]) * amount),
    clampChannel(from[2] + (to[2] - from[2]) * amount)
  ]
}

/**
 * Parses `#rgb`, `#rrggbb`, `rgb()` and `rgba()`, compositing any alpha over
 * `backdrop`. A 20%-opacity hairline is only as visible as what shows through
 * it, so a theme that declares its borders that way has to be measured that way.
 */
export function parseColor(value: string, backdrop: Rgb = [0, 0, 0]): Rgb | null {
  const hex = fromHex(value)
  if (hex) return hex
  const functional = value.trim().match(/^rgba?\((.*)\)$/i)
  if (!functional) return null
  const parts = functional[1].split(',').map((part) => Number(part.trim()))
  if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null
  const alpha = parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1
  return mix(backdrop, [parts[0], parts[1], parts[2]], alpha)
}

function channelLuminance(channel: number): number {
  const srgb = channel / 255
  return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4)
}

export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
}

export function contrastRatio(foreground: Rgb, background: Rgb): number {
  const a = relativeLuminance(foreground)
  const b = relativeLuminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/**
 * Nudges `color` toward white or black — whichever direction gains contrast —
 * until it clears `min` against `background`, and returns it unchanged when it
 * already does.
 *
 * Mixing toward an achromatic end point keeps the hue and only spends
 * saturation, which is what a palette can afford to lose; the alternative,
 * rejecting the theme, is not something a colour picker can offer a user.
 */
export function ensureContrast(color: Rgb, background: Rgb, min: number): Rgb {
  if (contrastRatio(color, background) >= min) return color
  const target: Rgb = relativeLuminance(color) >= relativeLuminance(background) ? [255, 255, 255] : [0, 0, 0]
  for (let step = 1; step <= 100; step += 1) {
    const candidate = mix(color, target, step / 100)
    if (contrastRatio(candidate, background) >= min) return candidate
  }
  return target
}

/** The lightest of several backgrounds — the hardest case for light-on-dark text. */
export function lightest(colors: readonly Rgb[]): Rgb {
  return colors.reduce((best, current) =>
    relativeLuminance(current) > relativeLuminance(best) ? current : best
  )
}
