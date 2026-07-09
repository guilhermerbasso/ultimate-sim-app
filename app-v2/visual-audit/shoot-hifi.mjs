import { chromium } from 'playwright'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const html = resolve(process.cwd(), 'visual-audit/hifi/ddu.html')
const out = resolve(process.cwd(), 'visual-audit/hifi/ddu.png')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1024, height: 600 }, deviceScaleFactor: 2 })
await page.goto(pathToFileURL(html).href, { waitUntil: 'networkidle' })
await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()))
await page.waitForTimeout(400)
await page.screenshot({ path: out })
await browser.close()
console.log('shot ->', out)
