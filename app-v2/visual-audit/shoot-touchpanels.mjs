// Touch-panel visual-audit shooter: boots the visual-audit Vite server, renders the
// materials showcase + full button catalog + every ready-made panel preset via the REAL
// ButtonBoxRenderer, screenshots each [data-tp-id] to visual-audit/touch/<id>.png, tiles
// contact sheets grouped by category (materials / catalog / panels-a / panels-b), and
// reports any label that FitText could not fit (data-didfit="0").
//
//   node visual-audit/shoot-touchpanels.mjs            # everything
//   node visual-audit/shoot-touchpanels.mjs panels-a   # ?filter=panels-a
import { mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { dirname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, 'touch')
const CONTACT = resolve(__dirname, 'touch-contact')
const REPORT = resolve(__dirname, 'touchpanel-report.json')
const filter = process.argv[2] ?? ''

const KILL_ANIMATIONS = `*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important}`

function log(...a) {
  console.log('[touch]', ...a)
}

function categoryOf(id) {
  if (id.startsWith('mat-')) return 'materials'
  if (id.startsWith('cat-')) return 'catalog'
  if (id.startsWith('tp-a')) return 'panels-a'
  if (id.startsWith('tp-b')) return 'panels-b'
  return 'panels'
}

async function loadChromium() {
  const { chromium } = await import('playwright')
  try {
    return await chromium.launch({ headless: true })
  } catch (err) {
    log('installing chromium…', err?.message ?? err)
    execSync('npx playwright install chromium', { stdio: 'inherit' })
    return await chromium.launch({ headless: true })
  }
}

async function main() {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  mkdirSync(CONTACT, { recursive: true })

  log('starting Vite dev server…')
  const { createServer } = await import('vite')
  const server = await createServer({
    configFile: resolve(__dirname, 'vite.config.ts'),
    logLevel: 'warn',
    server: { port: 5194, strictPort: false }
  })
  await server.listen()
  const base = server.resolvedUrls?.local?.[0]
  if (!base) {
    await server.close()
    throw new Error('Vite did not report a local URL')
  }
  log(`server ready at ${base}`)

  const browser = await loadChromium()
  const context = await browser.newContext({ viewport: { width: 1700, height: 2400 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e?.message ?? e)))

  const shot = new Set()
  let fitFailures = []

  try {
    const url = new URL(`touchpanel-grid.html${filter ? `?filter=${encodeURIComponent(filter)}` : ''}`, base).href
    log(`→ ${url}`)
    await page.goto(url, { waitUntil: 'networkidle', timeout: 90_000 })
    try {
      await page.waitForSelector('body[data-va-ready="true"]', { timeout: 45_000 })
    } catch {
      log('  (warn) readiness sentinel not seen; capturing anyway')
    }
    await page.addStyleTag({ content: KILL_ANIMATIONS })
    await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()))
    await page.waitForTimeout(700)

    fitFailures = await page.evaluate(() => window.__tpFit || [])

    const cells = await page.$$('[data-tp-id]')
    log(`${cells.length} panel cells`)
    for (const cell of cells) {
      const id = (await cell.getAttribute('data-tp-id')) || 'unknown'
      const shell = await cell.$('[data-tp-shell]')
      const target = shell ?? cell
      const safe = id.replace(/[^a-z0-9_-]/gi, '_')
      try {
        await target.screenshot({ path: resolve(OUT, `${safe}.png`) })
        shot.add(id)
      } catch {
        /* offscreen/too-large — skip */
      }
    }
  } finally {
    await context.close()
    await browser.close()
    await server.close()
  }

  // ── Contact sheets grouped by category ────────────────────────────────────────
  const files = readdirSync(OUT).filter((f) => f.endsWith('.png'))
  const groups = {}
  for (const f of files) {
    const id = basename(f, '.png')
    ;(groups[categoryOf(id)] ||= []).push(resolve(OUT, f))
  }
  const TILE_W = 360
  const TILE_H = 300
  const LABEL_H = 20
  const COLS = 4
  const PAD = 10
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  async function tile(file) {
    const id = basename(file, '.png')
    const img = await sharp(file).resize(TILE_W, TILE_H, { fit: 'contain', background: { r: 5, g: 7, b: 13 } }).toBuffer()
    const label = Buffer.from(
      `<svg width="${TILE_W}" height="${LABEL_H}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#0b0e12"/><text x="6" y="14" font-family="monospace" font-size="12" fill="#cdd6e0">${esc(id).slice(0, 46)}</text></svg>`
    )
    return sharp({ create: { width: TILE_W, height: TILE_H + LABEL_H, channels: 3, background: { r: 5, g: 7, b: 13 } } })
      .composite([{ input: img, top: 0, left: 0 }, { input: label, top: TILE_H, left: 0 }])
      .png()
      .toBuffer()
  }

  for (const [cat, list] of Object.entries(groups)) {
    list.sort()
    const cellW = TILE_W + PAD
    const cellH = TILE_H + LABEL_H + PAD
    const rows = Math.ceil(list.length / COLS)
    const W = COLS * cellW + PAD
    const H = rows * cellH + PAD
    const tiles = await Promise.all(list.map(tile))
    const composites = tiles.map((buf, i) => ({ input: buf, top: PAD + Math.floor(i / COLS) * cellH, left: PAD + (i % COLS) * cellW }))
    const out = resolve(CONTACT, `${cat}.png`)
    await sharp({ create: { width: W, height: H, channels: 3, background: { r: 2, g: 3, b: 6 } } }).composite(composites).png().toFile(out)
    log(`  contact → ${out} (${list.length})`)
  }

  const report = {
    generatedAt: new Date().toISOString(),
    cellsShot: shot.size,
    fitFailures,
    pageErrors,
    categories: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length]))
  }
  writeFileSync(REPORT, JSON.stringify(report, null, 2))

  console.log('\n──────── touch-panel visual-audit ────────')
  console.log(`  cells shot: ${shot.size}`)
  console.log(`  by category: ${Object.entries(report.categories).map(([k, v]) => `${k}=${v}`).join(', ')}`)
  console.log(`  label fit failures: ${fitFailures.length ? fitFailures.join(', ') : 'none ✓'}`)
  console.log(`  page errors: ${pageErrors.length ? pageErrors.length : 'none ✓'}`)
  console.log(`  contact sheets → ${CONTACT}/`)
  console.log(`  report → ${REPORT}`)
  console.log('──────────────────────────────────────────\n')
  if (pageErrors.length) process.exit(1)
}

main().catch((err) => {
  console.error('[touch] fatal:', err)
  process.exit(1)
})
