// Extract a colour palette from a photo of a REAL motorsport cluster (MoTeC C125/
// C127, Cosworth ICD, AiM, a Porsche 911 GT3 Cup wheel, etc.) and print colour
// tokens ready to paste into the GT3 theme. This closes the "colours are guessed"
// gap — calibrate the matte-black surface and the amber/green/red LED hues from the
// real thing instead of eyeballing them.
//
// Usage:
//   node scripts/extract-palette.mjs path/to/cluster-photo.jpg
//   node scripts/extract-palette.mjs path/to/photo.png --json   # machine-readable only
//
// Output: the six Vibrant swatches + a best-guess mapping to gt3-theme tokens
// (bg / textPrimary / amber / red / green / accent). Always sanity-check by eye —
// it is a starting point, not gospel.

import { Vibrant } from 'node-vibrant/node'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'

const args = process.argv.slice(2)
const jsonOnly = args.includes('--json')
const file = args.find((a) => !a.startsWith('--'))

if (!file) {
  console.error('usage: node scripts/extract-palette.mjs <image> [--json]')
  process.exit(2)
}
if (!existsSync(file)) {
  console.error(`file not found: ${file}`)
  process.exit(2)
}

function hslOf(swatch) {
  const [h, s, l] = swatch.hsl // h,s,l in 0..1
  return { h: h * 360, s, l }
}

// Classify swatches into GT3 token slots by hue/lightness/saturation.
function mapTokens(swatches) {
  const list = Object.entries(swatches)
    .filter(([, sw]) => sw)
    .map(([name, sw]) => ({ name, hex: sw.hex, pop: sw.population, ...hslOf(sw) }))

  const darkest = [...list].sort((a, b) => a.l - b.l)[0]
  const lightest = [...list].sort((a, b) => b.l - a.l)[0]
  const warm = list.filter((c) => c.h <= 70 || c.h >= 330)
  const green = list.filter((c) => c.h >= 90 && c.h <= 165)
  const red = warm.filter((c) => c.h <= 25 || c.h >= 345).sort((a, b) => b.s - a.s)[0]
  const amber = warm.filter((c) => c.h > 25 && c.h <= 70).sort((a, b) => b.s - a.s)[0]
  const accent = [...list].sort((a, b) => b.s * b.pop - a.s * a.pop)[0]

  return {
    bg: darkest?.hex,
    textPrimary: lightest?.hex,
    red: red?.hex,
    amber: amber?.hex,
    green: green.sort((a, b) => b.s - a.s)[0]?.hex,
    accent: accent?.hex
  }
}

const palette = await Vibrant.from(file).getPalette()
const swatches = {
  Vibrant: palette.Vibrant,
  Muted: palette.Muted,
  DarkVibrant: palette.DarkVibrant,
  DarkMuted: palette.DarkMuted,
  LightVibrant: palette.LightVibrant,
  LightMuted: palette.LightMuted
}
const tokens = mapTokens(swatches)

if (jsonOnly) {
  console.log(JSON.stringify({ source: basename(file), swatches: Object.fromEntries(Object.entries(swatches).filter(([, s]) => s).map(([n, s]) => [n, s.hex])), tokens }, null, 2))
  process.exit(0)
}

console.log(`\n  Palette from ${basename(file)}\n`)
for (const [name, sw] of Object.entries(swatches)) {
  if (!sw) continue
  const { h, s, l } = hslOf(sw)
  console.log(`  ${name.padEnd(13)} ${sw.hex}   hsl(${h.toFixed(0)}, ${(s * 100).toFixed(0)}%, ${(l * 100).toFixed(0)}%)   pop ${sw.population}`)
}
console.log('\n  Suggested gt3-theme tokens (verify by eye):\n')
console.log(JSON.stringify(tokens, null, 2))
console.log('')
