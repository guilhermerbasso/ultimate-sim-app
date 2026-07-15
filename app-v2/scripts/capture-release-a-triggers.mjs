import { build } from 'esbuild'
import { chromium } from 'playwright'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const visualDir = join(root, 'tests', 'visual')
const outDir = join(visualDir, 'current')
const bundle = join(visualDir, '.release-a-render.cjs')
mkdirSync(outDir, { recursive: true })

await build({
  entryPoints: [join(visualDir, 'release-a-render-entry.tsx')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: bundle,
  loader: { '.css': 'empty', '.ttf': 'empty', '.woff': 'empty', '.woff2': 'empty', '.png': 'empty', '.svg': 'text' },
  jsx: 'automatic',
  logLevel: 'silent'
})

const { render } = await import(pathToFileURL(bundle).href)
const captures = render()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 760, height: 520 }, deviceScaleFactor: 1 })

for (const capture of captures) {
  const width = Math.max(360, capture.width + 80)
  const height = Math.max(240, capture.height + 110)
  await page.setViewportSize({ width, height })
  await page.setContent(`<!doctype html><html><head><style>
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;font-family:Bahnschrift,Segoe UI,sans-serif}
    body{color:#f5f7fa;background-color:#0a0d12;background-image:linear-gradient(45deg,#111722 25%,transparent 25%),linear-gradient(-45deg,#111722 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#111722 75%),linear-gradient(-45deg,transparent 75%,#111722 75%);background-size:24px 24px;background-position:0 0,0 12px,12px -12px,-12px 0}
    #label{height:48px;padding:14px 18px;color:#9aa3ad;font-weight:800;letter-spacing:1px;text-transform:uppercase}
    #stage{height:calc(100% - 48px);display:grid;place-items:center;--overlay-accent:#ffb020;--overlay-font:Bahnschrift,Segoe UI,sans-serif;--widget-good:#22e06a;--widget-info:#2f7bff;--widget-warn:#ffb020;--widget-danger:#ff3b30}
    #empty{color:#627080;font-size:15px;font-weight:800;letter-spacing:2px}
  </style></head><body><div id="label">${capture.label}</div><div id="stage">${capture.html || '<div id="empty">INACTIVE · DOM REMOVED</div>'}</div></body></html>`)
  await page.screenshot({ path: join(outDir, `${capture.name}.png`) })
}

await browser.close()
rmSync(bundle, { force: true })
console.log(`Captured ${captures.length} Release A trigger screenshots → tests/visual/current`)
