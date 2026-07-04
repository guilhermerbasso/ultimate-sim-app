// Contact-sheet montage: tiles the per-widget PNGs from visual-audit/widgets/<state>/
// into labelled grid sheets so the whole widget library can be eyeballed / shared.
//   node visual-audit/contact-sheet.mjs [state]     (default: drive)
import { readdirSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const state = process.argv[2] ?? 'drive'
const SRC = resolve(__dirname, 'widgets', state)
const OUTDIR = resolve(__dirname, 'contact')

const TILE_W = 300
const TILE_H = 210
const LABEL_H = 22
const COLS = 6
const PAD = 10
const PER_PAGE = COLS * 10 // 60 per sheet

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function tile(file) {
  const id = basename(file, '.png')
  const img = await sharp(file)
    .resize(TILE_W, TILE_H, { fit: 'contain', background: { r: 5, g: 7, b: 13 } })
    .toBuffer()
  const label = Buffer.from(
    `<svg width="${TILE_W}" height="${LABEL_H}" xmlns="http://www.w3.org/2000/svg">
       <rect width="100%" height="100%" fill="#0b0e12"/>
       <text x="6" y="15" font-family="monospace" font-size="12" fill="#9aa6b2">${esc(id).slice(0, 42)}</text>
     </svg>`
  )
  const cell = await sharp({
    create: { width: TILE_W, height: TILE_H + LABEL_H, channels: 3, background: { r: 5, g: 7, b: 13 } }
  })
    .composite([
      { input: img, top: 0, left: 0 },
      { input: label, top: TILE_H, left: 0 }
    ])
    .png()
    .toBuffer()
  return cell
}

async function main() {
  if (!existsSync(SRC)) {
    console.error(`no shots at ${SRC} — run: node visual-audit/lint-overflow.mjs ${state}`)
    process.exit(1)
  }
  mkdirSync(OUTDIR, { recursive: true })
  const files = readdirSync(SRC)
    .filter((f) => f.endsWith('.png'))
    .sort()
    .map((f) => resolve(SRC, f))

  const cellW = TILE_W + PAD
  const cellH = TILE_H + LABEL_H + PAD
  const pages = Math.ceil(files.length / PER_PAGE)
  console.log(`[contact] ${files.length} widgets · ${pages} sheet(s) · state=${state}`)

  for (let p = 0; p < pages; p++) {
    const slice = files.slice(p * PER_PAGE, (p + 1) * PER_PAGE)
    const rows = Math.ceil(slice.length / COLS)
    const W = COLS * cellW + PAD
    const H = rows * cellH + PAD
    const cells = await Promise.all(slice.map(tile))
    const composites = cells.map((buf, i) => ({
      input: buf,
      top: PAD + Math.floor(i / COLS) * cellH,
      left: PAD + (i % COLS) * cellW
    }))
    const out = resolve(OUTDIR, pages > 1 ? `${state}-${p + 1}.png` : `${state}-ALL.png`)
    await sharp({ create: { width: W, height: H, channels: 3, background: { r: 2, g: 3, b: 6 } } })
      .composite(composites)
      .png()
      .toFile(out)
    console.log(`  → ${out}`)
  }
}

main().catch((e) => {
  console.error('[contact] fatal:', e)
  process.exit(1)
})
