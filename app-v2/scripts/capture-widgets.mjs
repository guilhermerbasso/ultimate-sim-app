// GT3 hero-cluster visual capture. Bundles tests/visual/render-entry.tsx (esbuild,
// CSS dropped — injected separately), runs it in Node to get static widget markup,
// then renders each in headless Chromium with the REAL overlay CSS + embedded
// DSEG/Chakra/Michroma fonts (so 7-seg digits + condensed labels actually paint) and
// screenshots into tests/visual/current/*.png. Pair with scripts/visual-regression.mjs.
//
//   node scripts/capture-widgets.mjs            # capture current
//   node scripts/capture-widgets.mjs --update   # capture + accept as baseline
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, copyFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const visualDir = join(root, 'tests', 'visual')
const CURRENT = join(visualDir, 'current')
const BASELINE = join(visualDir, 'baseline')
const fontsDir = join(root, 'src', 'renderer', 'src', 'assets', 'fonts')
const cssDir = join(root, 'src', 'renderer', 'src', 'overlay', 'widgets')
const update = process.argv.slice(2).includes('--update')

mkdirSync(CURRENT, { recursive: true })

// 1) Bundle the render entry for Node (skip CSS imports — we inline real CSS below).
const tmp = join(visualDir, '.render-entry.cjs')
await build({
  entryPoints: [join(visualDir, 'render-entry.tsx')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: tmp,
  loader: { '.css': 'empty', '.ttf': 'empty', '.woff': 'empty', '.woff2': 'empty', '.png': 'empty', '.svg': 'text' },
  jsx: 'automatic',
  logLevel: 'silent'
})
const { render } = await import(pathToFileURL(tmp).href)
const captures = render()

// 2) Inline the real overlay CSS + embed font files as base64 data: URIs (file://
//    @font-face is unreliable in headless Chromium; data: always loads) so the DSEG
//    7-seg + condensed faces actually paint and the baseline gates font regressions.
const cssFiles = ['dashboard-replicas.css', 'redesign-core.css', 'redesign-detail.css', 'redesign-r16.css', 'redesign-radar.css', 'redesign-futuristic.css', 'overlayWidgetsR16.css']
let css = ''
for (const f of cssFiles) {
  const p = join(cssDir, f)
  if (existsSync(p)) css += '\n' + readFileSync(p, 'utf8')
}
// url('…/assets/fonts/X.ttf') → url('data:font/ttf;base64,…')
css = css.replace(/url\(\s*['"]?\.{0,2}\/?[^)'"]*assets\/fonts\/([^)'"]+\.(?:ttf|woff2?|otf))['"]?\s*\)/g, (_m, file) => {
  const p = join(fontsDir, file)
  if (!existsSync(p)) return _m
  const mime = file.endsWith('.woff2') ? 'font/woff2' : file.endsWith('.woff') ? 'font/woff' : file.endsWith('.otf') ? 'font/otf' : 'font/ttf'
  return `url('data:${mime};base64,${readFileSync(p).toString('base64')}')`
})

const page = await (await chromium.launch()).newPage({ viewport: { width: 1320, height: 760 }, deviceScaleFactor: 1 })
let captured = 0
for (const { name, html } of captures) {
  const fullFrame = /Dash__/.test(name)
  const stageStyle = fullFrame
    ? 'width:1280px;height:720px;padding:0'
    : 'display:inline-block;padding:16px'
  const inner = fullFrame
    ? `<div style="width:1280px;height:720px;color:#f4f4f4">${html}</div>`
    : `<div class="rc-card" style="color:#f4f4f4">${html}</div>`
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box} html,body{margin:0;background:#000}
    #stage{background:#000;${stageStyle}}
    ${css}
  </style></head><body><div id="stage">${inner}</div></body></html>`
  try {
    await page.setContent(doc, { waitUntil: 'load' })
    await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()))
    await page.waitForTimeout(120)
    const el = await page.$('#stage')
    await el.screenshot({ path: join(CURRENT, `${name}.png`) })
    captured++
  } catch (err) {
    console.warn(`  ! skipped ${name}: ${err?.message ?? err}`)
  }
}
await page.context().browser().close()
rmSync(tmp, { force: true })
console.log(`Captured ${captured}/${captures.length} hero widget screenshots → tests/visual/current`)

if (update) {
  mkdirSync(BASELINE, { recursive: true })
  for (const f of readdirSync(CURRENT).filter((x) => x.endsWith('.png'))) copyFileSync(join(CURRENT, f), join(BASELINE, f))
  console.log('Accepted current as baseline.')
}
