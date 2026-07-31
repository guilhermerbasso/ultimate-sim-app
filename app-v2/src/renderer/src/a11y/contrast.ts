/**
 * WCAG 2.2 contrast maths and design-token resolution.
 *
 * Kept out of the test file because two sources define the app's colours and
 * both have to be checked against the same arithmetic: the static `:root` block
 * in `styles/theme.css`, and the runtime custom properties `applyAppTheme`
 * writes onto `document.documentElement` from `APP_THEME_PRESETS`. The runtime
 * set wins in the browser, so a token fixed only in the stylesheet is not fixed.
 */

export type Rgb = readonly [number, number, number]

/** The `--name: value;` declarations of the first `:root` block. */
export function readRootTokens(css: string): Map<string, string> {
  const start = css.indexOf(':root')
  const end = css.indexOf('\n}', start)
  if (start < 0 || end < 0) throw new Error('theme.css no longer exposes a :root block')
  const tokens = new Map<string, string>()
  for (const match of css.slice(start, end).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(match[1], match[2].split('/*')[0].trim())
  }
  return tokens
}

function parseHex(value: string): Rgb {
  const raw = value.replace('#', '')
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16)
  ]
}

function composite(source: Rgb, alpha: number, backdrop: Rgb): Rgb {
  return [
    Math.round(source[0] * alpha + backdrop[0] * (1 - alpha)),
    Math.round(source[1] * alpha + backdrop[1] * (1 - alpha)),
    Math.round(source[2] * alpha + backdrop[2] * (1 - alpha))
  ]
}

/**
 * Resolves a token name or raw CSS colour to sRGB against `tokens`, following
 * `var()` chains and compositing alpha over `backdrop` — a translucent tint is
 * only as legible as whatever shows through it.
 */
export function resolveColor(
  tokens: ReadonlyMap<string, string>,
  input: string,
  backdrop: Rgb = [0, 0, 0]
): Rgb {
  let value = tokens.get(input) ?? input
  for (let hop = 0; hop < 10 && /^var\(\s*--/.test(value); hop += 1) {
    const name = value.match(/^var\(\s*(--[\w-]+)/)?.[1]
    const next = name ? tokens.get(name) : undefined
    if (!next) break
    value = next
  }
  value = value.split('/*')[0].trim()
  if (value.startsWith('#')) return parseHex(value)

  const functional = value.match(/^rgba?\((.*)\)\s*$/)
  if (!functional) throw new Error(`Cannot resolve colour: ${input} -> ${value}`)
  const parts = functional[1].split(',').map((part) => part.trim())

  if (/^var\(/.test(parts[0])) {
    // `rgba(var(--accent-rgb), 0.15)` — the channels live in a shared tint base.
    const name = parts[0].match(/var\(\s*(--[\w-]+)/)?.[1]
    const channels = name ? tokens.get(name) : undefined
    if (!channels) throw new Error(`Cannot resolve tint base: ${parts[0]}`)
    const rgb = channels.split(',').map((n) => Number(n.trim())) as unknown as Rgb
    return composite(rgb, parts.length > 1 ? Number(parts[1]) : 1, backdrop)
  }
  const rgb = parts.slice(0, 3).map(Number) as unknown as Rgb
  return composite(rgb, parts.length > 3 ? Number(parts[3]) : 1, backdrop)
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
