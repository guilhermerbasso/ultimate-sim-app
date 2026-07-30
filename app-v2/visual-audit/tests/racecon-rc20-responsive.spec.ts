import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { expect, test, type Browser, type Page } from 'playwright/test'
import { createServer, type ViteDevServer } from 'vite'

const here = fileURLToPath(new URL('..', import.meta.url))
let server: ViteDevServer
let baseUrl: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  server = await createServer({
    configFile: resolve(here, 'vite.config.ts'),
    logLevel: 'warn',
    server: { host: '127.0.0.1', port: 0, strictPort: false }
  })
  await server.listen()
  baseUrl = server.resolvedUrls?.local?.[0] ?? ''
  if (!baseUrl) throw new Error('RC-20 visual-audit server did not report a local URL')
})

test.afterAll(async () => {
  await server.close()
})

interface Rect {
  left: number
  top: number
  width: number
  height: number
  right: number
  bottom: number
}

function expectContained(outer: Rect, inner: Rect, label: string, tolerance = 0.5): void {
  expect(inner.left,   `${label} left`).toBeGreaterThanOrEqual(outer.left   - tolerance)
  expect(inner.top,    `${label} top`).toBeGreaterThanOrEqual(outer.top    - tolerance)
  expect(inner.right,  `${label} right`).toBeLessThanOrEqual(outer.right  + tolerance)
  expect(inner.bottom, `${label} bottom`).toBeLessThanOrEqual(outer.bottom + tolerance)
}

async function openCapture(
  browser: Browser,
  size: { width: number; height: number },
  expected: {
    layout: 'native' | 'app' | 'compact'
    compactMode?: 'phone' | 'landscape'
    state: 'grid' | 'jump-start' | 'no-feed'
  }
): Promise<{ context: Awaited<ReturnType<Browser['newContext']>>; page: Page }> {
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'dark'
  })
  const page = await context.newPage()
  const target = new URL('racecon-rc20-capture.html', baseUrl)
  target.searchParams.set('width', String(size.width))
  target.searchParams.set('height', String(size.height))
  target.searchParams.set('state', expected.state)
  await page.goto(target.href, { waitUntil: 'networkidle' })

  // Wait for the widget to reach the governed ready state.
  await page.waitForFunction(
    ({ layout, compactMode, state: captureState }) => {
      const root   = document.querySelector('#racecon-rc20-capture-root')
      const widget = root?.querySelector<HTMLElement>('[data-widget="raceconRc20Dash"]')
      if (!root || !widget) return false
      if (root.getAttribute('data-capture-ready') !== 'true') return false
      if (widget.getAttribute('data-rc20-buffer-state') !== 'accepted') return false
      if (widget.getAttribute('data-rc20-layout') !== layout) return false
      if (compactMode !== undefined && widget.getAttribute('data-rc20-compact-mode') !== compactMode) return false
      // grid: wait for stage=S5 and alerts=silent
      if (captureState === 'grid') {
        if (widget.getAttribute('data-rc20-stage') !== 'S5') return false
        if (widget.getAttribute('data-rc20-alerts') !== 'silent') return false
      }
      // jump-start: wait for alerts=active (jump-start debounce fired)
      if (captureState === 'jump-start' && widget.getAttribute('data-rc20-alerts') !== 'active') return false
      // no-feed: wait for start-feed=unavailable and lit-bars=0
      if (captureState === 'no-feed') {
        if (widget.getAttribute('data-rc20-start-feed') !== 'unavailable') return false
        if (widget.getAttribute('data-rc20-lit-bars') !== '0') return false
      }
      return true
    },
    expected,
    { timeout: 120_000 }
  )
  return { context, page }
}

const viewports = [
  { width: 800,  height: 480,  layout: 'native',  compactMode: null  },
  { width: 1024, height: 600,  layout: 'app',     compactMode: null  },
  { width: 393,  height: 759,  layout: 'compact', compactMode: 'phone' },
  { width: 412,  height: 867,  layout: 'compact', compactMode: 'phone' },
  { width: 759,  height: 393,  layout: 'compact', compactMode: 'landscape' },
  { width: 867,  height: 412,  layout: 'compact', compactMode: 'landscape' }
] as const

type Viewport = (typeof viewports)[number]

async function readGeometry(page: Page) {
  return page.locator('#racecon-rc20-capture-root').evaluate((root) => {
    const rootRect = root.getBoundingClientRect()
    const relative = (element: Element | null): Rect | null => {
      if (!element) return null
      const r = element.getBoundingClientRect()
      return {
        left:   r.left   - rootRect.left,
        top:    r.top    - rootRect.top,
        width:  r.width,
        height: r.height,
        right:  r.right  - rootRect.left,
        bottom: r.bottom - rootRect.top
      }
    }

    const widget    = root.querySelector<HTMLElement>('[data-widget="raceconRc20Dash"]')!
    const dashboard = root.querySelector<HTMLElement>('.rc20-dashboard')!
    const attr = (name: string) => widget.getAttribute('data-rc20-' + name)

    const measure = (label: string, selector: string) => {
      const el = root.querySelector<HTMLElement>(selector)
      if (!el) return null
      const style = getComputedStyle(el)
      return {
        label,
        text: el.textContent?.trim() ?? '',
        fontSize: Number.parseFloat(style.fontSize),
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        rect: relative(el)
      }
    }

    const zoneNames: [string, string][] = [
      ['header', '[data-testid="rc20-header"]'],
      ['ladder', '[data-testid="rc20-ladder"]'],
      ['launch', '[data-testid="rc20-launch"]'],
      ['clutch', '[data-testid="rc20-clutch"]']
    ]
    const zones = zoneNames.map(([name, selector]) => {
      const el = root.querySelector<HTMLElement>(selector)
      const r = el ? relative(el)! : { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }
      return { name, rect: r, display: el ? getComputedStyle(el).display : 'none' }
    })

    // Ladder bar details
    const ladderBarsEl = root.querySelector<HTMLElement>('[data-testid="rc20-ladder-bars"]')
    const ladderBarEls = Array.from(root.querySelectorAll<HTMLElement>('[data-testid="rc20-ladder-bar"]'))
    const ladderBarCount = ladderBarsEl?.getAttribute('data-rc20-bar-count') ?? null
    const ladderBars = ladderBarEls.map(el => ({
      index: Number(el.getAttribute('data-rc20-bar')),
      lit:   el.getAttribute('data-rc20-lit') === 'true',
      rect:  relative(el)
    }))

    return {
      viewport:    { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
      page:        { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
      root:        relative(root)!,
      layout:      attr('layout'),
      compactMode: attr('compact-mode'),
      mode:        attr('mode'),
      stage:       attr('stage'),
      litBars:     attr('lit-bars'),
      startFeed:   attr('start-feed'),
      bandSource:  attr('band-source'),
      alerts:      attr('alerts'),
      alertKeys:   attr('alert-keys'),
      bufferState: attr('buffer-state'),
      contentWidth:  attr('content-width'),
      contentHeight: attr('content-height'),
      nativeSize:  dashboard?.getAttribute('data-rc20-native-size') ?? null,
      dashboardOverflow: {
        clientWidth:  dashboard?.clientWidth  ?? 0,
        scrollWidth:  dashboard?.scrollWidth  ?? 0,
        clientHeight: dashboard?.clientHeight ?? 0,
        scrollHeight: dashboard?.scrollHeight ?? 0
      },
      // Counts
      ladderBarCount,
      ladderBars,
      ladderBarTotal:   root.querySelectorAll('[data-testid="rc20-ladder-bar"]').length,
      litBarCount:      root.querySelectorAll('[data-testid="rc20-ladder-bar"][data-rc20-lit="true"]').length,
      modeWordCount:    root.querySelectorAll('[data-testid="rc20-mode-word"]').length,
      cardCount:        root.querySelectorAll('.rc20-card').length,
      // Count only cells inside the strip ZONE — ribbon (2) and review (3) at app also use
      // StripCell and share the same testid, so a global query would return 5 at app layout.
      stripCellCount:   root.querySelectorAll('[data-rc20-zone="strip"] [data-testid="rc20-strip-cell"]').length,
      warmupTileCount:  root.querySelectorAll('[data-testid="rc20-warmup-tile"]').length,
      jumpStartCount:   root.querySelectorAll('[data-testid="rc20-jump-start"]').length,
      ribbonCount:      root.querySelectorAll('[data-testid="rc20-ribbon-status"]').length,
      warmupProvCount:  root.querySelectorAll('[data-testid="rc20-warmup-provenance"]').length,
      reviewCount:      root.querySelectorAll('[data-testid="rc20-review"]').length,
      launchBandCount:  root.querySelectorAll('[data-testid="rc20-launch-band"]').length,
      // Packet omission probes
      shiftArcCount:    root.querySelectorAll('.rc20-led, .rc20-shift, .rc20-rev, [data-rc20-zone="shift"]').length,
      armControlCount:  root.querySelectorAll('button[data-rc20], .rc20-button, [data-rc20-zone="control"]').length,
      wheelspinCount:   root.querySelectorAll('[data-testid*="wheelspin"], [data-testid*="slip"]').length,
      // Grid slot text
      stripSlotText:    root.querySelector('[data-testid="rc20-strip-slot"]')?.textContent?.trim() ?? null,
      // Type-scale values
      values: [
        measure('rpm',          '[data-testid="rc20-rpm"]'),
        measure('clutch-value', '[data-testid="rc20-clutch-value"]'),
        measure('scale-label',  '[data-testid="rc20-scale-label"]'),
        measure('band-label',   '[data-testid="rc20-band-label"]')
      ].filter((e): e is NonNullable<typeof e> => e !== null),
      // Zone rects for overlap / containment
      zones,
      // Containment rects
      ladderRect:     relative(root.querySelector('[data-testid="rc20-ladder"]')),
      startFeedRect:  relative(root.querySelector('[data-testid="rc20-start-feed"]')),
      launchRect:     relative(root.querySelector('[data-testid="rc20-launch"]')),
      scaleLabelRect: relative(root.querySelector('[data-testid="rc20-scale-label"]'))
    }
  })
}

// ── Tests ────────────────────────────────────────────────────────────────────────────────

for (const size of viewports) {
  const label    = size.compactMode ? `${size.layout}/${size.compactMode}` : size.layout
  const sizeKey  = `${size.width}x${size.height}`
  const isApp    = size.layout === 'app'
  const isNative = size.layout === 'native'

  test(`${sizeKey} RC-20 grid composition (${label}) — ladder=5 bars lit, strip/warmup, type scale`, async ({ browser }) => {
    const { context, page } = await openCapture(browser, size, {
      layout: size.layout,
      compactMode: size.compactMode ?? undefined,
      state: 'grid'
    })
    try {
      // Confirm buffer-state='accepted' before reading geometry. The DOM-snapshot read in
      // readGeometry is racy: the widget's display clock can re-ingest the same snapshot and
      // the buffer correctly reports 'duplicate' for that re-render (same pattern as RC-08).
      await expect
        .poll(async () => page.locator('[data-widget="raceconRc20Dash"]').getAttribute('data-rc20-buffer-state'))
        .toBe('accepted')
      const geometry = await readGeometry(page)

      // Viewport and layout
      expect(geometry.viewport).toEqual({ width: size.width, height: size.height, dpr: 1 })
      expect(geometry.layout).toBe(size.layout)
      expect(geometry.compactMode).toBe(size.compactMode)
      expect(geometry.contentWidth).toBe(String(size.width))
      expect(geometry.contentHeight).toBe(String(size.height))
      // bufferState already confirmed above; asserting geometry.bufferState is racy (see above)

      // State attributes
      expect(geometry.mode).toBe('GRID')
      expect(geometry.stage).toBe('S5')
      expect(geometry.alerts).toBe('silent')
      expect(geometry.alertKeys).toBe('')
      expect(geometry.startFeed).toBe('live')
      expect(geometry.bandSource).toBe('none')
      expect(geometry.litBars).toBe('5')

      // native-size modifier
      expect(geometry.nativeSize).toBe(isNative ? '800x480' : null)

      // No horizontal scrollbar
      expect(geometry.page.scrollWidth).toBe(geometry.page.clientWidth)
      expect(geometry.dashboardOverflow.scrollWidth).toBeLessThanOrEqual(geometry.dashboardOverflow.clientWidth)

      // ── Counting structure: exactly 5 ladder bars, all lit ──
      expect(geometry.ladderBarTotal,    'ladder bar count').toBe(5)
      expect(geometry.ladderBarCount,    'data-rc20-bar-count').toBe('5')
      expect(geometry.litBarCount,       'lit bar count in grid state').toBe(5)
      expect(geometry.ladderBars.length, 'bar index records').toBe(5)
      const indices = geometry.ladderBars.map(b => b.index).sort((a, b) => a - b)
      expect(indices, 'bar indices must be 0..4').toEqual([0, 1, 2, 3, 4])
      for (const b of geometry.ladderBars) expect(b.lit, `bar ${b.index} must be lit in grid state`).toBe(true)

      // Bars are vertically contained within the ladder zone
      const ladderZone = geometry.zones.find(z => z.name === 'ladder')!
      for (const b of geometry.ladderBars) {
        if (b.rect) expectContained(ladderZone.rect, b.rect, `ladder bar ${b.index}`)
      }

      // ── Mode words (3) and cards (2) ──
      expect(geometry.modeWordCount, 'mode word count').toBe(3)
      expect(geometry.cardCount,     'card count').toBe(2)

      // ── Layout-specific: strip cells / warmup tiles ──
      if (isApp) {
        expect(geometry.stripCellCount,  'no strip at app').toBe(0)
        expect(geometry.warmupTileCount, 'warmup tiles at app').toBe(8)
        expect(geometry.ribbonCount,     'ribbon at app').toBe(1)
        expect(geometry.reviewCount,     'review at app').toBe(1)
        expect(geometry.warmupProvCount, 'warmup provenance at app').toBe(1)
      } else {
        expect(geometry.stripCellCount,  'strip cells at non-app').toBe(8)
        expect(geometry.warmupTileCount, 'no warmup at non-app').toBe(0)
        expect(geometry.ribbonCount,     'no ribbon at non-app').toBe(0)
        expect(geometry.reviewCount,     'no review at non-app').toBe(0)
      }

      // ── Grid slot always "--" (gridSlot omission) ──
      if (!isApp) {
        expect(geometry.stripSlotText, 'grid slot').toBe('--')
      }

      // ── No launch band (launchRpmTarget omission) ──
      expect(geometry.launchBandCount, 'no launch band').toBe(0)
      const bandLabel = geometry.values.find(v => v.label === 'band-label')
      if (bandLabel) expect(bandLabel.text, 'band label').toBe('BAND --')

      // ── Type-scale hierarchy: rpm > clutch > strip > label (strict, no ties) ──
      const rpm    = geometry.values.find(v => v.label === 'rpm')
      const clutch = geometry.values.find(v => v.label === 'clutch-value')
      const scale  = geometry.values.find(v => v.label === 'scale-label')
      if (rpm && clutch)  expect(rpm.fontSize,   'rpm > clutch').toBeGreaterThan(clutch.fontSize)
      if (clutch && scale) expect(clutch.fontSize,'clutch > strip').toBeGreaterThan(scale.fontSize)

      // ── Packet omissions: no shift/LED/rev, no arm control, no wheelspin ──
      expect(geometry.shiftArcCount,   'shift/LED/rev absent').toBe(0)
      expect(geometry.armControlCount, 'arm control absent').toBe(0)
      expect(geometry.wheelspinCount,  'wheelspin absent').toBe(0)

      // ── Zone geometry: no peer overlaps, all zones inside frame ──
      const frameRect: Rect = { left: 0, top: 0, width: size.width, height: size.height, right: size.width, bottom: size.height }
      for (const zone of geometry.zones) {
        expectContained(frameRect, zone.rect, `zone ${zone.name}`)
      }
      const visible = geometry.zones.filter(z => z.display !== 'none' && z.rect.width > 0 && z.rect.height > 0)
      for (let a = 0; a < visible.length; a += 1) {
        for (let b = a + 1; b < visible.length; b += 1) {
          const first  = visible[a]
          const second = visible[b]
          const overlapX = Math.min(first.rect.right, second.rect.right) - Math.max(first.rect.left, second.rect.left)
          const overlapY = Math.min(first.rect.bottom, second.rect.bottom) - Math.max(first.rect.top, second.rect.top)
          expect(
            Math.min(overlapX, overlapY),
            `zone ${first.name} must not overlap ${second.name}`
          ).toBeLessThanOrEqual(0.5)
        }
      }

      // ── Nowrap-overflow containment (BoundingClientRect, not scrollWidth) ──
      if (geometry.ladderRect && geometry.startFeedRect) {
        expectContained(geometry.ladderRect, geometry.startFeedRect, 'start-feed in ladder zone')
      }
      if (geometry.launchRect && geometry.scaleLabelRect) {
        expectContained(geometry.launchRect, geometry.scaleLabelRect, 'scale-label in launch zone')
      }

      const capture = await page.locator('#racecon-rc20-capture-root').screenshot({ animations: 'disabled' })
      expect(capture.byteLength).toBeGreaterThan(5_000)
    } finally {
      await context.close()
    }
  })
}

test('RC-20 jump-start state: alert fires, JUMP START key, rc20-jump-start element renders', async ({ browser }) => {
  const size = viewports[0]  // native 800×480
  const { context, page } = await openCapture(browser, size, { layout: 'native', state: 'jump-start' })
  try {
    await expect
      .poll(async () => page.locator('[data-widget="raceconRc20Dash"]').getAttribute('data-rc20-alerts'))
      .toBe('active')

    const data = await page.locator('#racecon-rc20-capture-root').evaluate((root) => {
      const widget = root.querySelector<HTMLElement>('[data-widget="raceconRc20Dash"]')!
      const rootRect = root.getBoundingClientRect()
      const relative = (el: Element | null) => {
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { left: r.left - rootRect.left, top: r.top - rootRect.top,
                 width: r.width, height: r.height, right: r.right - rootRect.left, bottom: r.bottom - rootRect.top }
      }
      const ladderEl = root.querySelector<HTMLElement>('[data-testid="rc20-ladder"]')
      const jumpEl   = root.querySelector<HTMLElement>('[data-testid="rc20-jump-start"]')
      return {
        alerts:          widget.getAttribute('data-rc20-alerts'),
        alertKeys:       widget.getAttribute('data-rc20-alert-keys'),
        stage:           widget.getAttribute('data-rc20-stage'),
        litBars:         widget.getAttribute('data-rc20-lit-bars'),
        mode:            widget.getAttribute('data-rc20-mode'),
        jumpStartCount:  root.querySelectorAll('[data-testid="rc20-jump-start"]').length,
        ladderBarCount:  root.querySelectorAll('[data-testid="rc20-ladder-bar"]').length,
        litBarCount:     root.querySelectorAll('[data-testid="rc20-ladder-bar"][data-rc20-lit="true"]').length,
        jumpRect:        relative(jumpEl),
        ladderRect:      relative(ladderEl)
      }
    })

    expect(data.alerts).toBe('active')
    expect(data.alertKeys).toContain('JUMP START')
    expect(data.stage).toBe('S5')
    expect(data.litBars).toBe('5')
    expect(data.mode).toBe('GRID')
    expect(data.ladderBarCount).toBe(5)
    expect(data.litBarCount).toBe(5)
    expect(data.jumpStartCount).toBe(1)

    // rc20-jump-start must be inside the ladder zone
    if (data.ladderRect && data.jumpRect) {
      expect(data.jumpRect.left,   'jump-start left in ladder').toBeGreaterThanOrEqual(data.ladderRect.left   - 0.5)
      expect(data.jumpRect.right,  'jump-start right in ladder').toBeLessThanOrEqual(data.ladderRect.right  + 0.5)
      expect(data.jumpRect.top,    'jump-start top in ladder').toBeGreaterThanOrEqual(data.ladderRect.top    - 0.5)
      expect(data.jumpRect.bottom, 'jump-start bottom in ladder').toBeLessThanOrEqual(data.ladderRect.bottom + 0.5)
    }
  } finally {
    await context.close()
  }
})

test('RC-20 no-feed state: lit-bars=0, all bars dark, never simulate start lights (800x480)', async ({ browser }) => {
  const size = viewports[0]
  const { context, page } = await openCapture(browser, size, { layout: 'native', state: 'no-feed' })
  try {
    const data = await page.locator('#racecon-rc20-capture-root').evaluate((root) => {
      const widget = root.querySelector<HTMLElement>('[data-widget="raceconRc20Dash"]')!
      return {
        startFeed:     widget.getAttribute('data-rc20-start-feed'),
        stage:         widget.getAttribute('data-rc20-stage'),
        litBars:       widget.getAttribute('data-rc20-lit-bars'),
        mode:          widget.getAttribute('data-rc20-mode'),
        litBarCount:   root.querySelectorAll('[data-testid="rc20-ladder-bar"][data-rc20-lit="true"]').length,
        totalBarCount: root.querySelectorAll('[data-testid="rc20-ladder-bar"]').length,
        barCountAttr:  root.querySelector('[data-testid="rc20-ladder-bars"]')?.getAttribute('data-rc20-bar-count') ?? null
      }
    })

    expect(data.startFeed).toBe('unavailable')
    expect(data.stage).toBe('unavailable')
    expect(data.litBars).toBe('0')
    expect(data.mode).toBe('unavailable')
    // Five bars always rendered (counting structure), all dark
    expect(data.totalBarCount).toBe(5)
    expect(data.litBarCount).toBe(0)
    expect(data.barCountAttr).toBe('5')
  } finally {
    await context.close()
  }
})
