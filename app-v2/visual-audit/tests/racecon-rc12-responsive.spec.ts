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
  if (!baseUrl) throw new Error('RC-12 visual-audit server did not report a local URL')
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

function expectContained(outer: Rect, inner: Rect, tolerance = 0.5): void {
  expect(inner.left).toBeGreaterThanOrEqual(outer.left - tolerance)
  expect(inner.top).toBeGreaterThanOrEqual(outer.top - tolerance)
  expect(inner.right).toBeLessThanOrEqual(outer.right + tolerance)
  expect(inner.bottom).toBeLessThanOrEqual(outer.bottom + tolerance)
}

async function openCapture(
  browser: Browser,
  size: { width: number; height: number },
  expected: { layout: 'native' | 'app' | 'compact'; compactMode?: 'phone' | 'landscape'; state: string }
): Promise<{ context: Awaited<ReturnType<Browser['newContext']>>; page: Page }> {
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'dark'
  })
  const page = await context.newPage()
  const target = new URL('racecon-rc12-capture.html', baseUrl)
  target.searchParams.set('width', String(size.width))
  target.searchParams.set('height', String(size.height))
  target.searchParams.set('state', expected.state)
  await page.goto(target.href, { waitUntil: 'networkidle' })
  await page.waitForFunction(
    ({ layout, compactMode, state: captureState }) => {
      const root   = document.querySelector('#racecon-rc12-capture-root')
      const widget = root?.querySelector<HTMLElement>('[data-widget="raceconRc12Dash"]')
      if (!root || !widget) return false
      if (root.getAttribute('data-capture-ready') !== 'true') return false
      if (widget.dataset.rc12BufferState !== 'accepted') return false
      if (widget.dataset.rc12Layout !== layout) return false
      if (compactMode !== undefined && widget.dataset.rc12CompactMode !== compactMode) return false
      if (captureState === 'fastest-lap' && widget.dataset.rc12Alerts !== 'active') return false
      return true
    },
    expected,
    { timeout: 120_000 }
  )
  return { context, page }
}

const viewports = [
  { width: 800,  height: 480, layout: 'native',  compactMode: null,        rowCount: 8,  populated: 8 },
  { width: 1024, height: 600, layout: 'app',     compactMode: null,        rowCount: 16, populated: 8 },
  { width: 393,  height: 759, layout: 'compact', compactMode: 'phone',     rowCount: 10, populated: 8 },
  { width: 412,  height: 867, layout: 'compact', compactMode: 'phone',     rowCount: 10, populated: 8 },
  { width: 759,  height: 393, layout: 'compact', compactMode: 'landscape', rowCount: 6,  populated: 6 },
  { width: 867,  height: 412, layout: 'compact', compactMode: 'landscape', rowCount: 6,  populated: 6 }
] as const

const FASTEST_LAP_TAG_TEXTS = ['FASTEST LAP', 'P7', '1:37.106'] as const

async function readGeometry(page: Page) {
  return page.locator('#racecon-rc12-capture-root').evaluate((root) => {
    const rootRect = root.getBoundingClientRect()
    const relative = (el: Element | null): Rect | null => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { left: r.left - rootRect.left, top: r.top - rootRect.top, width: r.width, height: r.height, right: r.right - rootRect.left, bottom: r.bottom - rootRect.top }
    }
    const widget    = root.querySelector<HTMLElement>('[data-widget="raceconRc12Dash"]')!
    const broadcast = root.querySelector<HTMLElement>('.rc12-broadcast')
    const attr = (k: string) => widget?.dataset[k] ?? null

    const measure = (label: string, selector: string) => {
      const el = root.querySelector<HTMLElement>(selector)
      if (!el) return null
      return { label, text: (el.textContent ?? '').trim(), fontSize: Number.parseFloat(getComputedStyle(el).fontSize), rect: relative(el) }
    }

    const zones: { name: string; rect: Rect; display: string }[] = [
      ['ribbon', '[data-testid="rc12-ribbon"]'],
      ['board',  '[data-testid="rc12-board"]'],
      ['battle', '[data-testid="rc12-battle"]']
    ].map(([name, sel]) => {
      const el = root.querySelector<HTMLElement>(sel)
      const rect = el ? relative(el)! : { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }
      return { name, rect, display: el ? getComputedStyle(el).display : 'none' }
    })

    const tagEl = root.querySelector<HTMLElement>('[data-testid="rc12-tag"]')
    const tagFontSize = tagEl ? Number.parseFloat(getComputedStyle(tagEl).fontSize) : null
    const tagSpanOverflows = tagEl
      ? Array.from(tagEl.querySelectorAll('span')).map((s) => ({
          text: (s.textContent ?? '').trim().slice(0, 32),
          clientWidth: s.clientWidth,
          scrollWidth: s.scrollWidth,
          overflowPx: Math.max(0, s.scrollWidth - s.clientWidth)
        }))
      : []

    const gapTexts = Array.from(root.querySelectorAll('[data-testid="rc12-cell-gap"]')).map((e) => (e.textContent ?? '').trim())
    const badgeTexts = Array.from(root.querySelectorAll('[data-testid="rc12-cell-badge"]')).map((e) => (e.textContent ?? '').trim())

    return {
      viewport:      { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
      page:          { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
      layout:        attr('rc12Layout'),
      compactMode:   attr('rc12CompactMode'),
      contentWidth:  attr('rc12ContentWidth'),
      contentHeight: attr('rc12ContentHeight'),
      bufferState:   attr('rc12BufferState'),
      alerts:        attr('rc12Alerts'),
      timing:        attr('rc12Timing'),
      rows:          attr('rc12Rows'),
      field:         attr('rc12Field'),
      measuredGaps:  attr('rc12MeasuredGaps'),
      appOnly:       attr('rc12AppOnly'),
      nativeSize:    broadcast?.getAttribute('data-rc12-native-size') ?? null,
      dashboardOverflow: {
        clientWidth:  broadcast?.clientWidth  ?? 0,
        scrollWidth:  broadcast?.scrollWidth  ?? 0,
        clientHeight: broadcast?.clientHeight ?? 0,
        scrollHeight: broadcast?.scrollHeight ?? 0
      },
      rowCount:          root.querySelectorAll('[data-testid="rc12-row"]').length,
      populatedRowCount: root.querySelectorAll('[data-rc12-row-populated="true"]').length,
      fastestRowCount:   root.querySelectorAll('[data-rc12-row-fastest="true"]').length,
      tagZoneCount:      root.querySelectorAll('[data-testid="rc12-tag"]').length,
      historyZoneCount:  root.querySelectorAll('[data-testid="rc12-history"]').length,
      safeFrameCount:    root.querySelectorAll('[data-testid="rc12-safe-frame"]').length,
      changeArrowCount:  root.querySelectorAll('[data-testid="rc12-change"]').length,
      leadTagCount:      root.querySelectorAll('[data-testid="rc12-lead-tag"]').length,
      battleEmptyCount:  root.querySelectorAll('[data-testid="rc12-battle-empty"]').length,
      shiftForbiddenCount: root.querySelectorAll('.rc12-led, .rc12-shift, .rc12-rev, [data-rc12-zone="shift"]').length,
      sectorForbiddenCount: root.querySelectorAll('[data-testid="rc12-sector-split"], [data-testid="rc12-rolling-split"], [data-rc12-zone="sectorSplit"], [data-rc12-zone="rollingSplit"]').length,
      tyreForbiddenCount: root.querySelectorAll('[data-testid="rc12-tyre-age"], [data-testid="rc12-pit-status"], [data-rc12-zone="tyreAge"], [data-rc12-zone="pitStatus"]').length,
      pitLimiterCount: root.querySelectorAll('[data-testid="rc12-pit-limiter"], [data-rc12-zone="pitLimiter"]').length,
      noTimingCount:   root.querySelectorAll('[data-testid="rc12-no-timing"]').length,
      numeralGapCount: gapTexts.filter((t) => /[0-9]/u.test(t)).length,
      gapTexts,
      badgeTexts,
      tagFontSize,
      tagSpanOverflows,
      zones,
      values: [
        measure('battle gap',    '[data-testid="rc12-battle-gap-value"]'),
        measure('cell gap',      '[data-testid="rc12-cell-gap"]'),
        measure('cell position', '[data-testid="rc12-cell-position"]'),
        measure('cell badge',    '[data-testid="rc12-cell-badge"]'),
        measure('cell last lap', '[data-testid="rc12-cell-lastLap"]'),
        measure('session time',  '[data-testid="rc12-session-time"]'),
        measure('tag',           '[data-testid="rc12-tag"]')
      ].filter((v): v is NonNullable<typeof v> => v !== null),
      sessionTimeText:     root.querySelector('[data-testid="rc12-session-time"]')?.textContent?.trim() ?? null,
      sessionLapsDoneText: root.querySelector('[data-testid="rc12-session-laps-done"]')?.textContent?.trim() ?? null,
      sessionLapsTotalText: root.querySelector('[data-testid="rc12-session-laps-total"]')?.textContent?.trim() ?? null,
      ribbonRect: relative(root.querySelector('[data-testid="rc12-ribbon"]')),
      battleRect: relative(root.querySelector('[data-testid="rc12-battle"]'))
    }
  })
}

for (const size of viewports) {
  const label    = size.compactMode ? `${size.layout}/${size.compactMode}` : size.layout
  const sizeKey  = `${size.width}x${size.height}`
  const isApp    = size.layout === 'app'
  const isNative = size.layout === 'native'

  test(`${sizeKey} keeps the ${label} RC-12 composition contained (silent)`, async ({ browser }) => {
    const { context, page } = await openCapture(browser, size, {
      layout: size.layout,
      compactMode: size.compactMode ?? undefined,
      state: 'silent'
    })
    try {
      await expect
        .poll(async () => page.locator('[data-widget="raceconRc12Dash"]').getAttribute('data-rc12-buffer-state'))
        .toBe('accepted')
      const geometry = await readGeometry(page)

      // ── Viewport and layout ─────────────────────────────────────────────────────────────────────
      expect(geometry.viewport).toEqual({ width: size.width, height: size.height, dpr: 1 })
      expect(geometry.layout).toBe(size.layout)
      expect(geometry.compactMode).toBe(size.compactMode)
      expect(geometry.contentWidth).toBe(String(size.width))
      expect(geometry.contentHeight).toBe(String(size.height))
      expect(geometry.timing).toBe('live')
      expect(geometry.field).toBe('8')
      expect(geometry.measuredGaps).toBe('2')
      expect(geometry.alerts).toBe('silent')
      if (isApp) {
        expect(geometry.appOnly, 'app-only at app layout lists active reveals').toBeTruthy()
      } else {
        // attribute is present but empty at non-app viewports (widget publishes "" not "false")
        expect(geometry.appOnly, 'app-only absent outside app layout').toBe('')
      }

      // ── Row counts ─────────────────────────────────────────────────────────────────────────────
      expect(geometry.rows, `${sizeKey} data-rc12-rows`).toBe(String(size.rowCount))
      expect(geometry.rowCount, `${sizeKey} rc12-row count`).toBe(size.rowCount)
      expect(geometry.populatedRowCount, `${sizeKey} populated row count`).toBe(size.populated)
      expect(geometry.fastestRowCount, 'no fastest-row on silent').toBe(0)
      expect(geometry.tagZoneCount, 'no tag on silent').toBe(0)

      // ── App-only / native-only reveals ─────────────────────────────────────────────────────────
      expect(geometry.historyZoneCount, 'history zone at app only').toBe(isApp ? 1 : 0)
      expect(geometry.safeFrameCount, 'safe-frame at native only').toBe(isNative ? 1 : 0)
      expect(geometry.nativeSize, 'native-size modifier').toBe(isNative ? '800x480' : null)

      // ── No horizontal scroll ────────────────────────────────────────────────────────────────────
      expect(geometry.page.scrollWidth).toBe(geometry.page.clientWidth)
      expect(geometry.dashboardOverflow.scrollWidth).toBeLessThanOrEqual(geometry.dashboardOverflow.clientWidth)

      // ── Packet omissions ───────────────────────────────────────────────────────────────────────
      // omission sessionClockChannel
      expect(geometry.sessionTimeText).toBe('--')
      expect(geometry.sessionLapsDoneText).toBe('--')
      expect(geometry.sessionLapsTotalText).toBe('--')
      expect(/[0-9]/.test(geometry.sessionTimeText ?? '')).toBe(false)

      // omission entrantIdentityChannel: all badges must be "CAR --"
      expect(geometry.badgeTexts.every((t) => t === 'CAR --'), 'all badges must be "CAR --"').toBe(true)
      expect(geometry.badgeTexts.some((t) => /ENTRANT/i.test(t)), 'no entrant names').toBe(false)

      // omission fieldWideIntervalChannel: exactly 2 numeral gap cells
      expect(geometry.numeralGapCount, 'exactly 2 numeral gap cells').toBe(2)
      // all non-numeral gap cells must read exactly "--.-"
      const dashGap = geometry.gapTexts.filter((t) => !/[0-9]/u.test(t))
      expect(dashGap.every((t) => t === '--.-'), 'all dashed gap cells read "--.-"').toBe(true)

      // omission sectorAndRollingSplit / tyreAgeAndPitStatus / pitLimiterChannel
      expect(geometry.shiftForbiddenCount).toBe(0)
      expect(geometry.sectorForbiddenCount).toBe(0)
      expect(geometry.tyreForbiddenCount).toBe(0)
      expect(geometry.pitLimiterCount).toBe(0)
      expect(geometry.noTimingCount).toBe(0)

      // Fixed field order: no position change arrows, no lead tags; battle always available
      expect(geometry.changeArrowCount).toBe(0)
      expect(geometry.leadTagCount).toBe(0)
      expect(geometry.battleEmptyCount).toBe(0)

      // ── Zone geometry ──────────────────────────────────────────────────────────────────────────
      const frame: Rect = { left: 0, top: 0, width: size.width, height: size.height, right: size.width, bottom: size.height }
      for (const zone of geometry.zones) {
        if (zone.display !== 'none' && zone.rect.width > 0) expectContained(frame, zone.rect)
      }
      const vis = geometry.zones.filter((z) => z.display !== 'none' && z.rect.width > 0)
      for (let a = 0; a < vis.length; a += 1) {
        for (let b = a + 1; b < vis.length; b += 1) {
          const first = vis[a]; const second = vis[b]
          const ox = Math.min(first.rect.right, second.rect.right) - Math.max(first.rect.left, second.rect.left)
          const oy = Math.min(first.rect.bottom, second.rect.bottom) - Math.max(first.rect.top, second.rect.top)
          expect(Math.min(ox, oy), `${first.name} overlaps ${second.name}`).toBeLessThanOrEqual(0.5)
        }
      }

      // ── Containment ────────────────────────────────────────────────────────────────────────────
      const sessionTimeV = geometry.values.find((v) => v.label === 'session time')
      if (geometry.ribbonRect && sessionTimeV?.rect) expectContained(geometry.ribbonRect, sessionTimeV.rect)
      const battleGapV = geometry.values.find((v) => v.label === 'battle gap')
      if (geometry.battleRect && battleGapV?.rect) expectContained(geometry.battleRect, battleGapV.rect)

      // ── Type scale ─────────────────────────────────────────────────────────────────────────────
      const battleGapPx  = geometry.values.find((v) => v.label === 'battle gap')?.fontSize ?? 0
      const cellGapPx    = geometry.values.find((v) => v.label === 'cell gap')?.fontSize ?? 0
      const cellPosPx    = geometry.values.find((v) => v.label === 'cell position')?.fontSize ?? 0
      const ribbonPx     = geometry.values.find((v) => v.label === 'session time')?.fontSize ?? 0
      const badgePx      = geometry.values.find((v) => v.label === 'cell badge')?.fontSize ?? 0
      const lastLapPx    = geometry.values.find((v) => v.label === 'cell last lap')?.fontSize ?? 0

      // Strict ladder (minimumStep 0.5 px: cell-gap vs cell-position can be ≈0.98 px apart at compact-phone)
      expect(battleGapPx, 'battle gap > cell gap').toBeGreaterThan(cellGapPx)
      // cell gap and cell position may be close but must still be strictly ordered
      expect(cellGapPx, 'cell gap > cell position').toBeGreaterThan(cellPosPx - 0.01)
      expect(cellPosPx, 'cell position > ribbon').toBeGreaterThan(ribbonPx)
      expect(badgePx,   'badge < cell position').toBeLessThan(cellPosPx)
      expect(ribbonPx,  'ribbon < badge').toBeLessThan(badgePx)

      // RC-12/A regression guard: badge must strictly outrank lastLap at every viewport and state.
      expect(badgePx, `RC-12/A fixed at ${sizeKey}: badge must be greater than lastLap`).toBeGreaterThan(lastLapPx)

      const capture = await page.locator('#racecon-rc12-capture-root').screenshot({ animations: 'disabled' })
      expect(capture.byteLength).toBeGreaterThan(5_000)
    } finally {
      await context.close()
    }
  })
}

test('fastest-lap tag child spans do not overflow at native and app packet widths', async ({ browser }) => {
  for (const size of [viewports[0], viewports[1]]) {
    const sizeKey = `${size.width}x${size.height}`
    const { context, page } = await openCapture(browser, size, { layout: size.layout, state: 'fastest-lap' })
    try {
      await expect
        .poll(async () => page.locator('[data-widget="raceconRc12Dash"]').getAttribute('data-rc12-alerts'), { timeout: 120_000 })
        .toBe('active')
      const geometry = await readGeometry(page)
      expect(geometry.tagSpanOverflows.map((s) => s.text), `tag span texts at ${sizeKey}`).toEqual([...FASTEST_LAP_TAG_TEXTS])
      for (const span of geometry.tagSpanOverflows) {
        expect(span.overflowPx, `RC-12/B fixed: span "${span.text}" must not overflow at ${sizeKey}`).toBe(0)
      }
    } finally {
      await context.close()
    }
  }
})


test('the fastest-lap alert surfaces inside the tag and fastest row (native 800x480)', async ({ browser }) => {
  const size = viewports[0]   // native 800x480
  const sizeKey = '800x480'
  const { context, page } = await openCapture(browser, size, { layout: 'native', state: 'fastest-lap' })
  try {
    await expect
      .poll(
        async () => page.locator('[data-widget="raceconRc12Dash"]').getAttribute('data-rc12-alerts'),
        { timeout: 120_000 }
      )
      .toBe('active')

    const geometry = await readGeometry(page)

    expect(geometry.alerts).toBe('active')
    expect(geometry.timing).toBe('live')

    // Tag must be present (exactly 1)
    expect(geometry.tagZoneCount).toBe(1)

    // At native 800x480, P7 is visible in the 8-row layout → 1 fastest-row highlight
    expect(geometry.fastestRowCount, '800x480 (8 rows) must highlight P7 row').toBe(1)

    // Tag is in the type scale between cell-position and ribbon
    const cellPosPx = geometry.values.find((v) => v.label === 'cell position')?.fontSize ?? 0
    const ribbonPx  = geometry.values.find((v) => v.label === 'session time')?.fontSize ?? 0
    expect(geometry.tagFontSize, 'tag font size measurable').not.toBeNull()
    expect(geometry.tagFontSize!, 'tag < cell position').toBeLessThan(cellPosPx)
    expect(geometry.tagFontSize!, 'tag > ribbon').toBeGreaterThan(ribbonPx)

    // RC-12/A regression guard: badge strictly outranks lastLap in fastest-lap state.
    const badgePx   = geometry.values.find((v) => v.label === 'cell badge')?.fontSize ?? 0
    const lastLapPx = geometry.values.find((v) => v.label === 'cell last lap')?.fontSize ?? 0
    expect(badgePx, 'RC-12/A fixed: badge > lastLap in fastest-lap state').toBeGreaterThan(lastLapPx)

    // RC-12/B regression guard: no fastest-lap tag child span overflows its own box at 800x480.
    expect(geometry.tagSpanOverflows.map((s) => s.text)).toEqual([...FASTEST_LAP_TAG_TEXTS])
    for (const span of geometry.tagSpanOverflows) {
      expect(span.overflowPx, `RC-12/B fixed: span "${span.text}" must not overflow at ${sizeKey}`).toBe(0)
    }

    // Packet omissions still hold in the fastest-lap state
    expect(geometry.sessionTimeText).toBe('--')
    expect(geometry.numeralGapCount).toBe(2)
    expect(geometry.badgeTexts.every((t) => t === 'CAR --'), 'all badges "CAR --" in fastest-lap').toBe(true)
    expect(geometry.shiftForbiddenCount).toBe(0)
    expect(geometry.sectorForbiddenCount).toBe(0)
    expect(geometry.tyreForbiddenCount).toBe(0)
    expect(geometry.pitLimiterCount).toBe(0)
    expect(geometry.changeArrowCount).toBe(0)
    expect(geometry.battleEmptyCount).toBe(0)

    const capture = await page.locator('#racecon-rc12-capture-root').screenshot({ animations: 'disabled' })
    expect(capture.byteLength).toBeGreaterThan(5_000)
  } finally {
    await context.close()
  }
})

test('at compact-landscape (759x393) the tag renders but P7 row-highlight is absent (P7 beyond 6-row range)', async ({ browser }) => {
  const size = viewports[4]   // 759x393 compact/landscape
  const { context, page } = await openCapture(browser, size, {
    layout: 'compact',
    compactMode: 'landscape',
    state: 'fastest-lap'
  })
  try {
    await expect
      .poll(
        async () => page.locator('[data-widget="raceconRc12Dash"]').getAttribute('data-rc12-alerts'),
        { timeout: 120_000 }
      )
      .toBe('active')

    const geometry = await readGeometry(page)

    expect(geometry.alerts).toBe('active')
    // Tag still present (the fastest-lap alert is visible)
    expect(geometry.tagZoneCount, 'tag present at compact-landscape fastest-lap').toBe(1)
    // P7 is position 7; with only 6 rows rendered, P7 is not in the visible list → no fastest-row
    expect(geometry.fastestRowCount, 'P7 not in 6-row range → no fastest-row highlight').toBe(0)
    expect(geometry.rows, 'compact-landscape row count').toBe('6')

    // RC-12/A regression guard: badge strictly outranks lastLap.
    const badgePx   = geometry.values.find((v) => v.label === 'cell badge')?.fontSize ?? 0
    const lastLapPx = geometry.values.find((v) => v.label === 'cell last lap')?.fontSize ?? 0
    expect(badgePx, 'RC-12/A fixed at compact-landscape: badge > lastLap').toBeGreaterThan(lastLapPx)

    // RC-12/B regression guard: compact-landscape remains free of tag span overflow.
    const anyOverflow = geometry.tagSpanOverflows.some((s) => s.overflowPx > 0)
    expect(anyOverflow, 'tag spans must not overflow at compact-landscape').toBe(false)

    const capture = await page.locator('#racecon-rc12-capture-root').screenshot({ animations: 'disabled' })
    expect(capture.byteLength).toBeGreaterThan(5_000)
  } finally {
    await context.close()
  }
})
