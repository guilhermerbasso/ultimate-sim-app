import { chromium } from 'playwright'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const names = process.argv.slice(2)
const list = names.length ? names : ['ddu', 'endurance', 'engineer']
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1024, height: 600 }, deviceScaleFactor: 2 })
for (const name of list) {
  const html = resolve(process.cwd(), `visual-audit/hifi/${name}.html`)
  await page.goto(pathToFileURL(html).href, { waitUntil: 'networkidle' })
  await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()))
  await page.waitForTimeout(300)
  await page.screenshot({ path: resolve(process.cwd(), `visual-audit/hifi/${name}.png`) })
  console.log('shot ->', name)
}
await browser.close()
