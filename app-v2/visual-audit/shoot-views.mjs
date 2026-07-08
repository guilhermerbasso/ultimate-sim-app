import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(__dirname, '..')
const OUT = resolve(appRoot, 'docs', 'screenshots')
const INDEX = resolve(OUT, 'index.json')
const KILL_ANIMATIONS = `*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important}`

function log(...args) {
  console.log('[views]', ...args)
}

async function loadChromium() {
  const { chromium } = await import('playwright')
  try {
    return await chromium.launch({ headless: true })
  } catch (err) {
    log('installing chromium…', err?.message ?? err)
    execSync('npx playwright install chromium', { cwd: appRoot, stdio: 'inherit' })
    return await chromium.launch({ headless: true })
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true })

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
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
    locale: 'en-US'
  })
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') log(`console error: ${message.text()}`)
  })

  const report = {}
  const captured = []
  const failed = []
  let views = []

  try {
    await page.goto(new URL('views-gallery.html', base).href, { waitUntil: 'networkidle', timeout: 90_000 })
    await page.waitForSelector('[data-view-stage]', { timeout: 30_000 })
    views = await page.evaluate(() => window.__viewRegistryMeta || [])
    if (!Array.isArray(views) || views.length === 0) throw new Error('Could not read view registry metadata from gallery')

    for (const view of views) {
      const id = view.id
      const safe = id.replace(/[^a-z0-9_-]/gi, '_')
      const url = new URL(`views-gallery.html?view=${encodeURIComponent(id)}`, base).href
      report[id] = { label: view.label, group: view.group, description: view.description, captured: false, note: '' }
      try {
        log(`→ ${id}`)
        await page.goto(url, { waitUntil: 'networkidle', timeout: 90_000 })
        await page.addStyleTag({ content: KILL_ANIMATIONS })
        await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()))
        await page.waitForSelector(`[data-view-stage="${id}"]`, { timeout: 30_000 })
        await page.waitForTimeout(900)
        const failures = await page.evaluate(() => window.__vaFailures || [])
        const bodyText = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '')
        const note = failures.length
          ? `Rendered error boundary: ${failures.map((f) => `${f.id}: ${f.message}`).join('; ')}`
          : (bodyText.includes('render error') ? 'Rendered with error placeholder.' : 'Captured.')
        await page.screenshot({ path: resolve(OUT, `${safe}.png`), fullPage: false })
        report[id].captured = true
        report[id].note = note
        captured.push(id)
      } catch (err) {
        const message = err?.message ?? String(err)
        report[id].note = message
        failed.push(`${id}: ${message}`)
        try {
          await page.screenshot({ path: resolve(OUT, `${safe}.png`), fullPage: false })
          report[id].captured = true
          report[id].note = `Captured fallback after error: ${message}`
          captured.push(id)
        } catch {
          // Keep failure recorded.
        }
      }
    }
  } finally {
    await context.close()
    await browser.close()
    await server.close()
  }

  writeFileSync(INDEX, JSON.stringify(report, null, 2))

  console.log('\n──────── views screenshot audit ────────')
  console.log(`  output: ${OUT}`)
  console.log(`  captured: ${captured.length}/${views.length}`)
  console.log(`  captured ids: ${captured.join(', ')}`)
  console.log(`  failed: ${failed.length ? failed.join(' | ') : 'none ✓'}`)
  console.log(`  index: ${INDEX}`)
  console.log('────────────────────────────────────────\n')
}

main().catch((err) => {
  console.error('[views] fatal:', err)
  process.exit(1)
})
