// Dashboard visual-audit shooter: boots the visual-audit Vite server, renders EVERY
// BUILTIN_PRESETS dashboard via the REAL renderer, screenshots each preset to
// visual-audit/dash/<id>.png, reports any that failed to build/render, and tiles
// them into contact sheets grouped by category (quali / race-wet / race-sun /
// race-first / race-chase / existing) via sharp.
//
//   node visual-audit/shoot-dashboards.mjs            # all presets
//   node visual-audit/shoot-dashboards.mjs quali      # ?filter=quali
import { mkdirSync, writeFileSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { dirname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, 'dash')
const CONTACT = resolve(__dirname, 'dash-contact')
const REPORT = resolve(__dirname, 'dashboard-report.json')
const filter = process.argv[2] ?? ''

const KILL_ANIMATIONS = `*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important}`

function log(...a) {
  console.log('[dash]', ...a)
}

function categoryOf(id) {
  for (const c of ['quali', 'race-wet', 'race-sun', 'race-first', 'race-chase']) {
    if (id.startsWith(c)) return c
  }
  return 'existing'
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
    server: { port: 5193, strictPort: false }
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

  const shot = new Set()
  let buildErrors = []
  let widgetFailures = {}

  try {
    const url = new URL(`dashboard-grid.html${filter ? `?filter=${encodeURIComponent(filter)}` : ''}`, base).href
    log(`→ ${url}`)
    await page.goto(url, { waitUntil: 'networkidle', timeout: 90_000 })
    try {
      await page.waitForSelector('body[data-va-ready="true"]', { timeout: 45_000 })
    } catch {
      log('  (warn) readiness sentinel not seen; capturing anyway')
    }
    await page.addStyleTag({ content: KILL_ANIMATIONS })
    await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()))
    await page.waitForTimeout(600)

    // Build errors (preset.build() threw) + widget render failures (error boundary).
    buildErrors = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-dash-error="1"]')).map((el) => el.getAttribute('data-dash-id'))
    )
    widgetFailures = await page.evaluate(() => window.__vaFailures || [])

    const cells = await page.$$('[data-dash-id]')
    log(`${cells.length} preset cells`)
    for (const cell of cells) {
      const id = (await cell.getAttribute('data-dash-id')) || 'unknown'
      const shell = await cell.$('[data-dash-shell]')
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

  // ── Contact sheets grouped by category ──────────────────────────────────────
  const files = readdirSync(OUT).filter((f) => f.endsWith('.png'))
  const groups = {}
  for (const f of files) {
    const id = basename(f, '.png')
    ;(groups[categoryOf(id)] ||= []).push(resolve(OUT, f))
  }
  const TILE_W = 360
  const TILE_H = 211
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
    presetsShot: shot.size,
    buildErrors,
    widgetFailures: [...new Set((widgetFailures || []).map((f) => f.id))],
    categories: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length]))
  }
  writeFileSync(REPORT, JSON.stringify(report, null, 2))

  console.log('\n──────── dashboard visual-audit ────────')
  console.log(`  presets shot: ${shot.size}`)
  console.log(`  by category: ${Object.entries(report.categories).map(([k, v]) => `${k}=${v}`).join(', ')}`)
  console.log(`  build errors: ${buildErrors.length ? buildErrors.join(', ') : 'none ✓'}`)
  console.log(`  widget render failures: ${report.widgetFailures.length ? report.widgetFailures.join(', ') : 'none ✓'}`)
  console.log(`  contact sheets → ${CONTACT}/`)
  console.log(`  report → ${REPORT}`)
  console.log('────────────────────────────────────────\n')
  if (buildErrors.length) process.exit(1)
}

main().catch((err) => {
  console.error('[dash] fatal:', err)
  process.exit(1)
})
