import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')
const CASES = [
  { width: 390, height: 844, preset: 'iphone-15-pro', orientation: 'portrait', stage: '393x852' },
  { width: 844, height: 390, preset: 'iphone-15-pro', orientation: 'landscape', stage: '852x393' },
  { width: 393, height: 852, preset: 'iphone-15-pro', orientation: 'portrait', stage: '393x852' },
  { width: 412, height: 915, preset: 'android-phone', orientation: 'portrait', stage: '412x915' },
  { width: 915, height: 412, preset: 'android-phone', orientation: 'landscape', stage: '915x412' },
  { width: 834, height: 1194, preset: 'ipad-11', orientation: 'portrait', stage: '834x1194' },
  { width: 1194, height: 834, preset: 'ipad-11', orientation: 'landscape', stage: '1194x834' },
  { width: 1024, height: 600, preset: 'android-phone', orientation: 'landscape', stage: '915x412' }
]
const TOLERANCE = 1.5

function fixtureUrl(base, parameters) {
  const url = new URL('stream-presentation-responsive.html', base)
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value))
  return url.toString()
}

async function waitForFrame(page) {
  await page.waitForFunction(() =>
    document.querySelector('[data-presentation-frame="true"]')?.getAttribute('data-frame-measured') === 'true'
  )
}

async function geometry(page) {
  return page.evaluate(() => {
    const frame = document.querySelector('[data-presentation-frame="true"]')
    const stage = document.querySelector('.stream-presentation-frame-stage')
    const renderer = document.querySelector('[data-presentation-profile]')
    const scrollViewport = document.querySelector('[data-presentation-frame-scroll="true"]')
    if (!(frame instanceof HTMLElement) || !(stage instanceof HTMLElement) || !(renderer instanceof HTMLElement) || !(scrollViewport instanceof HTMLElement)) {
      throw new Error('Responsive frame fixture did not render.')
    }
    const frameRect = frame.getBoundingClientRect()
    const stageRect = stage.getBoundingClientRect()
    return {
      frame: { left: frameRect.left, top: frameRect.top, right: frameRect.right, bottom: frameRect.bottom, width: frameRect.width, height: frameRect.height },
      stage: { left: stageRect.left, top: stageRect.top, right: stageRect.right, bottom: stageRect.bottom, width: stageRect.width, height: stageRect.height },
      viewport: { width: window.visualViewport?.width ?? window.innerWidth, height: window.visualViewport?.height ?? window.innerHeight },
      canonical: renderer.dataset.viewport,
      scale: Number(frame.dataset.frameScale),
      touchCompatibility: frame.dataset.touchCompatibility,
      effectiveSafeArea: frame.dataset.effectiveSafeArea,
      cssSafeArea: frame.dataset.cssSafeArea,
      scrollWidth: scrollViewport.scrollWidth,
      scrollHeight: scrollViewport.scrollHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollHeight: document.documentElement.scrollHeight,
      documentClientHeight: document.documentElement.clientHeight
    }
  })
}

function assertContainedAndCentered(result, expectedStage, label) {
  assert.equal(result.canonical, expectedStage, `${label}: configured orientation changed`)
  assert.ok(Number.isFinite(result.scale) && result.scale > 0, `${label}: invalid scale`)
  assert.ok(result.stage.left >= -TOLERANCE, `${label}: stage clipped on left`)
  assert.ok(result.stage.top >= -TOLERANCE, `${label}: stage clipped on top`)
  assert.ok(result.stage.right <= result.viewport.width + TOLERANCE, `${label}: stage clipped on right`)
  assert.ok(result.stage.bottom <= result.viewport.height + TOLERANCE, `${label}: stage clipped on bottom`)
  assert.ok(Math.abs((result.stage.left + result.stage.right) / 2 - result.viewport.width / 2) <= TOLERANCE, `${label}: stage not horizontally centered`)
  assert.ok(Math.abs((result.stage.top + result.stage.bottom) / 2 - result.viewport.height / 2) <= TOLERANCE, `${label}: stage not vertically centered`)
  const [canonicalWidth, canonicalHeight] = expectedStage.split('x').map(Number)
  assert.ok(Math.abs(result.stage.width / result.stage.height - canonicalWidth / canonicalHeight) < 0.002, `${label}: aspect ratio changed`)
  assert.ok(result.documentScrollWidth <= result.documentClientWidth + 1, `${label}: document overflowed horizontally`)
  assert.ok(result.documentScrollHeight <= result.documentClientHeight + 1, `${label}: document overflowed vertically`)
}

let server
let browser
try {
  server = await createServer({
    configFile: resolve(here, 'vite.config.ts'),
    logLevel: 'warn',
    server: { port: 5196, strictPort: false }
  })
  await server.listen()
  const base = server.resolvedUrls?.local?.[0]
  if (!base) throw new Error('Vite did not expose a local visual-audit URL.')
  try {
    browser = await chromium.launch({ headless: true })
  } catch (error) {
    throw new Error(`Installed Playwright Chromium is required; this verifier never downloads it. ${error instanceof Error ? error.message : String(error)}`)
  }
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce'
  })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  let checks = 0
  for (const testCase of CASES) {
    for (const kind of ['dashboard', 'touch']) {
      await page.setViewportSize({ width: testCase.width, height: testCase.height })
      await page.goto(fixtureUrl(base, {
        kind,
        preset: testCase.preset,
        orientation: testCase.orientation
      }), { waitUntil: 'networkidle' })
      await waitForFrame(page)
      const result = await geometry(page)
      assertContainedAndCentered(result, testCase.stage, `${kind} ${testCase.width}x${testCase.height}`)
      checks += 1
    }
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(fixtureUrl(base, {
    kind: 'dashboard',
    preset: 'iphone-15-pro',
    orientation: 'portrait'
  }), { waitUntil: 'networkidle' })
  await waitForFrame(page)
  await page.evaluate(() => {
    window.__responsiveCanonicalNode = document.querySelector('[data-presentation-profile]')
  })
  await page.setViewportSize({ width: 844, height: 390 })
  await page.waitForFunction(() =>
    document.querySelector('[data-presentation-frame="true"]')?.getAttribute('data-frame-viewport') === '844x390'
  )
  const stayedMounted = await page.evaluate(() =>
    window.__responsiveCanonicalNode === document.querySelector('[data-presentation-profile]')
  )
  assert.equal(stayedMounted, true, 'Viewport rotation remounted the canonical renderer.')
  assertContainedAndCentered(await geometry(page), '393x852', 'configured portrait after device rotation')
  checks += 1

  await page.setViewportSize({ width: 393, height: 852 })
  await page.goto(fixtureUrl(base, {
    kind: 'dashboard',
    preset: 'iphone-15-pro',
    orientation: 'portrait',
    safeTop: 80,
    safeBottom: 40
  }), { waitUntil: 'networkidle' })
  await waitForFrame(page)
  const safeResult = await geometry(page)
  assert.equal(safeResult.cssSafeArea, '80/0/40/0')
  assert.equal(safeResult.effectiveSafeArea, '80/0/40/0', 'Profile and CSS safe areas were added instead of max-mapped.')
  checks += 1

  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto(fixtureUrl(base, {
    kind: 'dashboard',
    preset: 'iphone-15-pro',
    orientation: 'portrait',
    safeLeft: 80
  }), { waitUntil: 'networkidle' })
  await waitForFrame(page)
  const letterboxedSafeResult = await geometry(page)
  assertContainedAndCentered(letterboxedSafeResult, '393x852', 'letterboxed safe-area overlap')
  assert.equal(letterboxedSafeResult.effectiveSafeArea, '59/0/34/0', 'Inset outside the stage changed canonical safe content.')
  checks += 1

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(fixtureUrl(base, {
    kind: 'touch',
    preset: 'android-phone',
    orientation: 'portrait',
    interactive: 1,
    columns: 2
  }), { waitUntil: 'networkidle' })
  await waitForFrame(page)
  const scrollResult = await geometry(page)
  assert.equal(scrollResult.touchCompatibility, 'scroll')
  assert.equal(scrollResult.scale, 1)
  assert.ok(scrollResult.scrollWidth >= 412, 'Controlled touch frame did not expose the full canonical width.')
  assert.ok(scrollResult.scrollHeight >= 915, 'Controlled touch frame did not expose the full canonical height.')
  const warningPosition = await page.evaluate(async () => {
    const frame = document.querySelector('[data-presentation-frame="true"]')
    const scrollViewport = document.querySelector('[data-presentation-frame-scroll="true"]')
    const warning = document.querySelector('.stream-presentation-frame-warning')
    if (!(frame instanceof HTMLElement) || !(scrollViewport instanceof HTMLElement) || !(warning instanceof HTMLElement)) {
      throw new Error('Controlled touch warning was not rendered.')
    }
    const before = warning.getBoundingClientRect()
    scrollViewport.scrollTo({ left: scrollViewport.scrollWidth, top: scrollViewport.scrollHeight })
    await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame))
    const after = warning.getBoundingClientRect()
    const stage = document.querySelector('.stream-presentation-frame-stage')
    if (!(stage instanceof HTMLElement)) throw new Error('Controlled touch stage was not rendered.')
    return {
      beforeTop: before.top,
      afterTop: after.top,
      afterBottom: after.bottom,
      afterStageBottom: stage.getBoundingClientRect().bottom
    }
  })
  assert.ok(Math.abs(warningPosition.beforeTop - warningPosition.afterTop) <= 1, 'Touch scroll warning moved out with stage content.')
  assert.ok(warningPosition.afterTop >= 0 && warningPosition.afterBottom <= 844, 'Touch scroll warning left the visual viewport.')
  assert.ok(warningPosition.afterStageBottom <= warningPosition.afterTop + 1, 'The warning obscured the last reachable touch-control row.')
  checks += 1

  await page.setViewportSize({ width: 412, height: 915 })
  await page.goto(fixtureUrl(base, {
    kind: 'touch',
    preset: 'android-phone',
    orientation: 'portrait',
    interactive: 1,
    columns: 12
  }), { waitUntil: 'networkidle' })
  await waitForFrame(page)
  const incompatible = await geometry(page)
  assert.equal(incompatible.touchCompatibility, 'incompatible')
  const allDisabled = await page.evaluate(() => {
    const hits = [...document.querySelectorAll('.bb-hit')]
    return hits.length > 0 && hits.every((hit) => hit instanceof HTMLButtonElement && hit.disabled)
  })
  assert.equal(allDisabled, true, 'Incompatible touch controls remained interactive.')
  checks += 1

  assert.deepEqual(pageErrors, [], `Browser page errors: ${pageErrors.join(' | ')}`)
  await context.close()
  console.log(`Responsive stream visual verification passed: ${checks} geometry/interaction checks.`)
} finally {
  await browser?.close()
  await server?.close()
}
