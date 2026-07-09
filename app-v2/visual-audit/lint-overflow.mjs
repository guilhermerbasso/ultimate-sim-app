// Overflow / legibility linter + per-widget screenshotter for the v2.39 rebuild.
//
// Boots the visual-audit Vite server, renders the native-size widget grid across
// telemetry states, then for every [data-wbox]:
//   • measures overflow (descendant escaping the box), tiny text (<10px), FitText
//     no-fit (data-didfit="0"), clipped text, broken <img>,
//   • element-screenshots it to visual-audit/widgets/<state>/<id>.png.
// Writes visual-audit/overflow-report.json and prints a summary + worst offenders.
// Exit code is nonzero if any OVERFLOW or BROKEN_IMG violations exist.
//
//   node visual-audit/lint-overflow.mjs                 # all states
//   node visual-audit/lint-overflow.mjs drive redline   # subset
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, 'widgets')
const REPORT = resolve(__dirname, 'overflow-report.json')
const ALL_STATES = ['drive', 'redline', 'brake', 'yellow', 'pit', 'extreme']

const KILL_ANIMATIONS = `*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important}`

function log(...a) {
  console.log('[lint]', ...a)
}

// Runs in the browser: measure every widget box for overflow/legibility issues.
function collectViolations() {
  const TOL = 2
  const MIN_PX = 10
  const out = []
  const boxes = Array.from(document.querySelectorAll('[data-wbox]'))
  for (const box of boxes) {
    const fig = box.closest('[data-wid]')
    const wid = fig?.getAttribute('data-wid') || '?'
    const wtype = fig?.getAttribute('data-wtype') || '?'
    const wlabel = fig?.getAttribute('data-wlabel') || ''
    const br = box.getBoundingClientRect()
    const push = (kind, detail, text) =>
      out.push({ wid, wtype, wlabel, kind, detail, text: (text || '').slice(0, 40) })

    const nodes = Array.from(box.querySelectorAll('*'))
    const textRects = []
    for (const el of nodes) {
      const tag = el.tagName.toLowerCase()
      const txt = (el.textContent || '').trim()
      const isText = txt.length > 0 && el.children.length === 0
      const isGfx = tag === 'svg' || tag === 'img' || tag === 'image'
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue

      // (a) overflow past the widget box
      if (isText || isGfx) {
        if (r.right > br.right + TOL || r.bottom > br.bottom + TOL || r.left < br.left - TOL || r.top < br.top - TOL) {
          push('overflow', `${tag} escapes box`, txt || tag)
        }
      }
      // (b) tiny text
      if (isText) {
        const fs = parseFloat(getComputedStyle(el).fontSize) || 0
        if (fs > 0 && fs < MIN_PX) push('tiny_text', `${fs.toFixed(1)}px`, txt)
        // (d) clipped text
        if ((el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) && getComputedStyle(el).overflow !== 'visible') {
          push('clipped', `${el.scrollWidth}>${el.clientWidth}`, txt)
        }
        textRects.push({ r, txt })
      }
      // (c) FitText reported no-fit
      if (el.getAttribute && el.getAttribute('data-didfit') === '0') {
        push('didnt_fit', 'FitText didFit=false', txt)
      }
      // (e) broken image
      if (tag === 'img' && el.naturalWidth === 0) push('broken_img', el.getAttribute('src') || '', '')
    }

    // (f) two TEXT values overlapping each other (e.g. "°C" drawn over a number).
    // Skips identical-text near-coincident duplicates (legibility stroke/shadow copies).
    for (let i = 0; i < textRects.length; i++) {
      for (let j = i + 1; j < textRects.length; j++) {
        const a = textRects[i]
        const b = textRects[j]
        const ix = Math.max(0, Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left))
        const iy = Math.max(0, Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top))
        const inter = ix * iy
        if (inter <= 0) continue
        const minArea = Math.min(a.r.width * a.r.height, b.r.width * b.r.height)
        if (minArea <= 0) continue
        const frac = inter / minArea
        // identical text + near-coincident position => intentional shadow/outline copy
        const coincident =
          a.txt === b.txt &&
          Math.abs(a.r.left - b.r.left) < 2 &&
          Math.abs(a.r.top - b.r.top) < 2 &&
          Math.abs(a.r.right - b.r.right) < 2 &&
          Math.abs(a.r.bottom - b.r.bottom) < 2
        if (frac > 0.35 && !coincident) {
          push('overlap', `${frac.toFixed(2)} "${a.txt.slice(0, 12)}"×"${b.txt.slice(0, 12)}"`, a.txt)
        }
      }
    }
  }
  return out
}

async function loadChromium() {
  const { chromium } = await import('playwright')
  try {
    return { chromium, browser: await chromium.launch({ headless: true }) }
  } catch (err) {
    log('installing chromium…', err?.message ?? err)
    execSync('npx playwright install chromium', { stdio: 'inherit' })
    return { chromium, browser: await chromium.launch({ headless: true }) }
  }
}

async function main() {
  const states = process.argv.slice(2).length ? process.argv.slice(2) : ALL_STATES
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })

  log('starting Vite dev server…')
  const { createServer } = await import('vite')
  const server = await createServer({
    configFile: resolve(__dirname, 'vite.config.ts'),
    logLevel: 'warn',
    server: { port: 5192, strictPort: false }
  })
  await server.listen()
  const base = server.resolvedUrls?.local?.[0]
  if (!base) {
    await server.close()
    throw new Error('Vite did not report a local URL')
  }
  log(`server ready at ${base}`)

  const { browser } = await loadChromium()
  const context = await browser.newContext({ viewport: { width: 1680, height: 2200 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
  const page = await context.newPage()

  const byWidget = {}
  const totals = { overflow: 0, overlap: 0, tiny_text: 0, clipped: 0, didnt_fit: 0, broken_img: 0 }
  let widgetCount = 0

  try {
    for (const state of states) {
      const url = new URL(`widget-grid.html?state=${encodeURIComponent(state)}`, base).href
      log(`→ state ${state}`)
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 })
      try {
        await page.waitForSelector('body[data-va-ready="true"]', { timeout: 30_000 })
      } catch {
        log(`  (warn) readiness sentinel not seen for ${state}`)
      }
      await page.addStyleTag({ content: KILL_ANIMATIONS })
      await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()))
      await page.waitForTimeout(450)

      const violations = await page.evaluate(collectViolations)
      for (const v of violations) {
        totals[v.kind] = (totals[v.kind] || 0) + 1
        ;(byWidget[v.wid] ||= []).push({ ...v, state })
      }

      // Element screenshots.
      const dir = resolve(OUT, state)
      mkdirSync(dir, { recursive: true })
      const figs = await page.$$('[data-wid]')
      if (state === states[0]) widgetCount = figs.length
      for (const fig of figs) {
        const wid = (await fig.getAttribute('data-wid')) || 'unknown'
        const box = await fig.$('[data-wbox]')
        if (!box) continue
        const safe = wid.replace(/[^a-z0-9_-]/gi, '_')
        try {
          await box.screenshot({ path: resolve(dir, `${safe}.png`) })
        } catch {
          /* offscreen/too-large — skip */
        }
      }
      log(`  ${violations.length} violation(s)`) 
    }
  } finally {
    await context.close()
    await browser.close()
    await server.close()
  }

  // Worst offenders.
  const worst = Object.entries(byWidget)
    .map(([wid, vs]) => ({ wid, count: vs.length, kinds: [...new Set(vs.map((v) => v.kind))] }))
    .sort((a, b) => b.count - a.count)

  const report = {
    generatedAt: new Date().toISOString(),
    states,
    widgetCount,
    totals,
    worst: worst.slice(0, 40),
    byWidget
  }
  writeFileSync(REPORT, JSON.stringify(report, null, 2))

  console.log('\n──────── overflow-lint summary ────────')
  console.log(`  widgets: ${widgetCount} · states: ${states.join(', ')}`)
  for (const k of Object.keys(totals)) console.log(`  ${k.padEnd(11)}: ${totals[k]}`)
  console.log('\n  worst 15 widgets:')
  for (const w of worst.slice(0, 15)) console.log(`    ${w.wid.padEnd(28)} ${String(w.count).padStart(3)}  [${w.kinds.join(',')}]`)
  console.log(`\n  report → ${REPORT}`)
  console.log('────────────────────────────────────────\n')

  const hardFails = totals.overflow + totals.overlap + totals.broken_img
  if (hardFails > 0) {
    console.log(`  ❌ ${hardFails} hard failure(s) (overflow/overlap/broken_img).`)
    process.exit(1)
  }
  console.log('  ✅ no hard overflow/overlap/broken-image failures.')
}

main().catch((err) => {
  console.error('[lint] fatal:', err)
  process.exit(1)
})
