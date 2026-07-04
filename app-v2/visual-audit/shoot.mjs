// visual-audit screenshot harness.
//
// Boots a Vite dev server that serves the overlay + dashboard galleries (which
// render the REAL widgets with realistic mock telemetry), then drives headless
// Chromium with Playwright to capture deterministic full-page PNGs into
// visual-audit/shots/.
//
//   node visual-audit/shoot.mjs                      # default 8 presets
//   node visual-audit/shoot.mjs neon glass terminal  # custom preset list
//
// Output:
//   shots/overlays-<preset>.png   (one per overlay style preset)
//   shots/dashboards.png          (representative dashboard presets)
import { mkdirSync, existsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SHOTS_DIR = resolve(__dirname, 'shots')
const VIEWPORT = { width: 1600, height: 2400 }

// Spread across the visual range (minimal → neon → glass → carbon → broadcast →
// terminal → bauhaus → heatmap). Override by passing ids as CLI args.
const DEFAULT_PRESETS = ['minimal', 'neon', 'glass', 'carbon', 'broadcast', 'terminal', 'bauhaus', 'heatmap']

const KILL_ANIMATIONS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    caret-color: transparent !important;
  }
`

function log(...args) {
  console.log('[shoot]', ...args)
}

async function loadPlaywrightChromium() {
  const { chromium } = await import('playwright')
  try {
    const browser = await chromium.launch({ headless: true })
    return { chromium, browser }
  } catch (err) {
    log('chromium launch failed, attempting `playwright install chromium`…', err?.message ?? err)
    execSync('npx playwright install chromium', { stdio: 'inherit' })
    const browser = await chromium.launch({ headless: true })
    return { chromium, browser }
  }
}

async function capture(page, url, outPath, label) {
  log(`→ ${label}`)
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 })
  try {
    await page.waitForSelector('body[data-va-ready="true"]', { timeout: 30_000 })
  } catch {
    log(`  (warning) readiness sentinel not seen for ${label}; capturing anyway`)
  }
  await page.addStyleTag({ content: KILL_ANIMATIONS })
  // Let layout/fonts settle for a deterministic frame.
  await page.waitForTimeout(500)
  const failures = await page.evaluate(() => window.__vaFailures || [])
  await page.screenshot({ path: outPath, fullPage: true })
  const size = existsSync(outPath) ? statSync(outPath).size : 0
  log(`  saved ${outPath} (${(size / 1024).toFixed(1)} KB)` + (failures.length ? ` · ${failures.length} widget error(s)` : ''))
  return { outPath, size, failures }
}

async function main() {
  const presets = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_PRESETS
  mkdirSync(SHOTS_DIR, { recursive: true })

  log('starting Vite dev server…')
  const { createServer } = await import('vite')
  const server = await createServer({
    configFile: resolve(__dirname, 'vite.config.ts'),
    logLevel: 'warn',
    server: { port: 5191, strictPort: false }
  })
  await server.listen()
  const base = server.resolvedUrls?.local?.[0]
  if (!base) {
    await server.close()
    throw new Error('Vite did not report a local URL')
  }
  log(`server ready at ${base}`)

  const { browser } = await loadPlaywrightChromium()
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce'
  })
  const page = await context.newPage()

  const results = []
  const allFailures = {}

  try {
    for (const preset of presets) {
      const url = new URL(`overlay-gallery.html?preset=${encodeURIComponent(preset)}`, base).href
      const out = resolve(SHOTS_DIR, `overlays-${preset}.png`)
      const r = await capture(page, url, out, `overlays · ${preset}`)
      results.push(r)
      if (r.failures.length) allFailures[`overlays:${preset}`] = r.failures
    }

    const dashUrl = new URL('dashboard-gallery.html', base).href
    const dashOut = resolve(SHOTS_DIR, 'dashboards.png')
    const dr = await capture(page, dashUrl, dashOut, 'dashboards')
    results.push(dr)
    if (dr.failures.length) allFailures['dashboards'] = dr.failures
  } finally {
    await context.close()
    await browser.close()
    await server.close()
  }

  // Summary
  console.log('\n──────── visual-audit summary ────────')
  for (const r of results) {
    console.log(`  ${r.outPath}  ${(r.size / 1024).toFixed(1)} KB`)
  }
  const failKeys = Object.keys(allFailures)
  if (failKeys.length) {
    console.log('\n  widget render failures (isolated by error boundary):')
    for (const key of failKeys) {
      const ids = [...new Set(allFailures[key].map((f) => f.id))]
      console.log(`    ${key}: ${ids.join(', ')}`)
    }
  } else {
    console.log('\n  no widget render failures 🎉')
  }
  console.log('──────────────────────────────────────\n')
}

main().catch((err) => {
  console.error('[shoot] fatal:', err)
  process.exit(1)
})
