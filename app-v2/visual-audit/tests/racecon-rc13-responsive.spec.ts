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
  if (!baseUrl) throw new Error('RC-13 visual-audit server did not report a local URL')
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
  const target = new URL('racecon-rc13-capture.html', baseUrl)
  target.searchParams.set('width', String(size.width))
  target.searchParams.set('height', String(size.height))
  target.searchParams.set('state', expected.state)
  await page.goto(target.href, { waitUntil: 'networkidle' })
  await page.waitForFunction(
    ({ layout, compactMode, state: captureState }) => {
      const root   = document.querySelector('#racecon-rc13-capture-root')
      const widget = root?.querySelector<HTMLElement>('[data-widget="raceconRc13Dash"]')
      if (!root || !widget) return false
      if (root.getAttribute('data-capture-ready') !== 'true') return false
      if (widget.dataset.rc13BufferState !== 'accepted') return false
      if (widget.dataset.rc13Layout !== layout) return false
      if (compactMode !== undefined && widget.dataset.rc13CompactMode !== compactMode) return false
      if (captureState === 'restart-imminent' && widget.dataset.rc13Alerts !== 'restartImminent') return false
      return true
    },
    expected,
    { timeout: 120_000 }
  )
  return { context, page }
}

const viewports = [
  { width: 800,  height: 480, layout: 'native',  compactMode: null      },
  { width: 1024, height: 600, layout: 'app',     compactMode: null      },
  { width: 393,  height: 759, layout: 'compact', compactMode: 'phone'   },
  { width: 412,  height: 867, layout: 'compact', compactMode: 'phone'   },
  { width: 759,  height: 393, layout: 'compact', compactMode: 'landscape' },
  { width: 867,  height: 412, layout: 'compact', compactMode: 'landscape' }
] as const

/**
 * Window-bar geometry expected fractions.
 * over [0/34], in [34/66], under [66/100]; word centres at 17%, 50%, 83%.
 */
const WINDOW_ZONE_DEFS = [
  { id: 'over',  from: 0,  to: 34,  startFrac: 0.00, widthFrac: 0.34, centre: 17, word: 'LIFT'      },
  { id: 'in',    from: 34, to: 66,  startFrac: 0.34, widthFrac: 0.32, centre: 50, word: 'IN WINDOW' },
  { id: 'under', from: 66, to: 100, startFrac: 0.66, widthFrac: 0.34, centre: 83, word: 'CATCH UP'  }
]

/**
 * Viewports where DEFECT RC-13/1 causes restart-status horizontal overflow in restart-imminent state.
 * scrollWidth − clientWidth = +3 px at 393x759 and 412x867. Budget: 3 px.
 */
const RESTART_STATUS_OVERFLOW_SIZES = new Set(['393x759', '412x867'])
const RESTART_STATUS_OVERFLOW_BUDGET_PX = 3

/** DEFECT RC-13/2 — glyph ascent above root top at 1024x600. Budget: 4 px. */
const GLYPH_OVERFLOW_BUDGET_PX = 4

async function readGeometry(page: Page) {
  return page.locator('#racecon-rc13-capture-root').evaluate((root) => {
    const rootRect = root.getBoundingClientRect()
    const relative = (el: Element | null): Rect | null => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { left: r.left - rootRect.left, top: r.top - rootRect.top, width: r.width, height: r.height, right: r.right - rootRect.left, bottom: r.bottom - rootRect.top }
    }
    const widget    = root.querySelector<HTMLElement>('[data-widget="raceconRc13Dash"]')!
    const dashboard = root.querySelector<HTMLElement>('.rc13-dashboard')
    const attr = (k: string) => widget?.dataset[k] ?? null

    const measure = (label: string, selector: string) => {
      const el = root.querySelector<HTMLElement>(selector)
      if (!el) return null
      return { label, text: (el.textContent ?? '').trim(), fontSize: Number.parseFloat(getComputedStyle(el).fontSize), rect: relative(el) }
    }

    const zones: { name: string; rect: Rect; display: string }[] = [
      ['status', '[data-testid="rc13-panel-status"]'],
      ['window', '[data-testid="rc13-panel-window"]'],
      ['queue',  '[data-testid="rc13-panel-queue"]'],
      ['restart','[data-testid="rc13-panel-restart"]'],
      ['pace',   '[data-testid="rc13-panel-pace"]']
    ].map(([name, sel]) => {
      const el = root.querySelector<HTMLElement>(sel)
      const rect = el ? relative(el)! : { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }
      return { name, rect, display: el ? getComputedStyle(el).display : 'none' }
    })

    // Window-bar geometry
    const barEl = root.querySelector<HTMLElement>('[data-testid="rc13-window-bar"]')
    const barRect = relative(barEl)

    const windowZoneMeasured = Array.from(root.querySelectorAll('[data-testid="rc13-window-zone"]')).map((node) => {
      const wordEl = node.querySelector('[data-testid="rc13-window-zone-word"]')
      return {
        id:         node.getAttribute('data-rc13-window-zone-id') ?? null,
        from:       Number(node.getAttribute('data-rc13-window-zone-from') ?? 'NaN'),
        to:         Number(node.getAttribute('data-rc13-window-zone-to') ?? 'NaN'),
        activeAttr: node.getAttribute('data-rc13-window-zone-active') ?? null,
        word:       wordEl ? (wordEl.textContent ?? '').trim() : null,
        centre:     wordEl ? Number(wordEl.getAttribute('data-rc13-window-zone-centre') ?? 'NaN') : NaN,
        rect:       relative(node)
      }
    })

    const windowMarkerAttr = barEl?.getAttribute('data-rc13-window-marker') ?? null

    // Restart-status (excluded from spec.values per DEFECT RC-13/2)
    const rsEl = root.querySelector<HTMLElement>('[data-testid="rc13-restart-status"]')
    const restartStatusText     = rsEl ? (rsEl.textContent ?? '').trim() : null
    const restartStatusFontSize = rsEl ? Number.parseFloat(getComputedStyle(rsEl).fontSize) : null
    const restartStatusRect     = relative(rsEl)
    const restartStatusScrollW  = rsEl?.scrollWidth  ?? 0
    const restartStatusClientW  = rsEl?.clientWidth  ?? 0
    // DEFECT RC-13/2: glyph ascent measured via createRange
    const restartStatusTextRngTop = (() => {
      if (!rsEl) return null
      const range = document.createRange()
      range.selectNodeContents(rsEl)
      const r = range.getBoundingClientRect()
      return +(r.top - rootRect.top).toFixed(3)
    })()

    const statusHeaderRect = relative(root.querySelector('[data-testid="rc13-panel-status"]'))
    const alertChipEl      = root.querySelector('[data-testid="rc13-alert-restartImminent"]')
    const alertChipRect    = relative(alertChipEl)

    return {
      viewport:      { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
      page:          { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
      layout:        attr('rc13Layout'),
      compactMode:   attr('rc13CompactMode'),
      contentWidth:  attr('rc13ContentWidth'),
      contentHeight: attr('rc13ContentHeight'),
      bufferState:   attr('rc13BufferState'),
      alerts:        attr('rc13Alerts'),
      restart:       attr('rc13Restart'),
      flag:          attr('rc13Flag'),
      windowZone:    attr('rc13WindowZone'),
      windowAvail:   attr('rc13WindowAvailable'),
      muted:         attr('rc13Muted'),
      shiftArmed:    attr('rc13ShiftArmed'),
      nativeSize:    dashboard?.getAttribute('data-rc13-native-size') ?? null,
      dashboardOverflow: {
        clientWidth:  dashboard?.clientWidth  ?? 0,
        scrollWidth:  dashboard?.scrollWidth  ?? 0
      },
      zones,
      barRect,
      windowZoneMeasured,
      windowMarkerAttr,
      windowNoticeText:     root.querySelector('[data-testid="rc13-window-notice"]')?.textContent?.trim() ?? null,
      restartZoneText:      root.querySelector('[data-testid="rc13-restart-zone"]')?.textContent?.trim() ?? null,
      restartZoneNotice:    root.querySelector('[data-testid="rc13-restart-zone-notice"]')?.textContent?.trim() ?? null,
      restartZoneAvailable: root.querySelector('[data-testid="rc13-restart-zone-row"]')?.getAttribute('data-rc13-restart-zone-available') ?? null,
      trainEl:       root.querySelector('[data-testid="rc13-train"]') !== null,
      trainRowsAttr: root.querySelector('[data-testid="rc13-train"]')?.getAttribute('data-rc13-train-rows') ?? null,
      trainAvailable: root.querySelector('[data-testid="rc13-train"]')?.getAttribute('data-rc13-train-available') ?? null,
      trainNoticeText: root.querySelector('[data-testid="rc13-train-notice"]')?.textContent?.trim() ?? null,
      restartStatusText,
      restartStatusFontSize,
      restartStatusRect,
      restartStatusScrollW,
      restartStatusClientW,
      restartStatusTextRngTop,
      statusHeaderRect,
      alertChipRect,
      restartSketchCount: root.querySelectorAll('[data-testid="rc13-restart-sketch"]').length,
      windowZoneCount:    root.querySelectorAll('[data-testid="rc13-window-zone"]').length,
      windowZoneWordCount: root.querySelectorAll('[data-testid="rc13-window-zone-word"]').length,
      windowMarkerCount:  root.querySelectorAll('[data-testid="rc13-window-marker"]').length,
      windowNoticeCount:  root.querySelectorAll('[data-testid="rc13-window-notice"]').length,
      trainCount:         root.querySelectorAll('[data-testid="rc13-train"]').length,
      trainRowCount:      root.querySelectorAll('[data-testid="rc13-train-row"]').length,
      alertChipCount:     root.querySelectorAll('[data-testid="rc13-alert-restartImminent"]').length,
      shiftForbiddenCount: root.querySelectorAll('.rc13-led, .rc13-shift, .rc13-rev, [data-rc13-zone="shift"]').length,
      waterForbiddenCount: root.querySelectorAll('[data-testid="rc13-water"], [data-rc13-zone="water"], .rc13-water').length,
      tyreForbiddenCount:  root.querySelectorAll('[data-testid^="rc13-tyre"], [data-rc13-zone="tyre"], .rc13-tyre, [data-rc13-corner]').length,
      fuelForbiddenCount:  root.querySelectorAll('[data-testid="rc13-fuel"], [data-rc13-zone="fuel"], .rc13-fuel').length,
      values: [
        measure('sc-delta',       '[data-testid="rc13-sc-delta"]'),
        measure('gap-ahead',      '[data-testid="rc13-gap-ahead"]'),
        measure('restart-block',  '[data-testid="rc13-restart-block"]'),
        measure('position',       '[data-testid="rc13-position"]'),
        measure('speed',          '[data-testid="rc13-speed"]'),
        measure('delta-best',     '[data-testid="rc13-delta-best"]')
      ].filter((v): v is NonNullable<typeof v> => v !== null)
    }
  })
}

for (const size of viewports) {
  const label    = size.compactMode ? `${size.layout}/${size.compactMode}` : size.layout
  const sizeKey  = `${size.width}x${size.height}`
  const isApp    = size.layout === 'app'
  const isNative = size.layout === 'native'

  test(`${sizeKey} keeps the ${label} RC-13 composition contained (silent)`, async ({ browser }) => {
    const { context, page } = await openCapture(browser, size, {
      layout: size.layout,
      compactMode: size.compactMode ?? undefined,
      state: 'silent'
    })
    try {
      await expect
        .poll(async () => page.locator('[data-widget="raceconRc13Dash"]').getAttribute('data-rc13-buffer-state'))
        .toBe('accepted')
      const geometry = await readGeometry(page)

      // ── Viewport and layout ─────────────────────────────────────────────────────────────────────
      expect(geometry.viewport).toEqual({ width: size.width, height: size.height, dpr: 1 })
      expect(geometry.layout).toBe(size.layout)
      expect(geometry.compactMode).toBe(size.compactMode)
      expect(geometry.contentWidth).toBe(String(size.width))
      expect(geometry.contentHeight).toBe(String(size.height))

      // ── State attributes ────────────────────────────────────────────────────────────────────────
      expect(geometry.alerts).toBe('silent')
      expect(geometry.restart).toBe('scDeployed')
      expect(geometry.flag).toBe('yellow')
      expect(geometry.muted).toBe('true')
      expect(geometry.shiftArmed).toBe('false')
      expect(geometry.windowZone).toBe('none')
      expect(geometry.windowAvail).toBe('false')

      // ── Native-size modifier ────────────────────────────────────────────────────────────────────
      expect(geometry.nativeSize).toBe(isNative ? '800x480' : null)

      // ── No horizontal scroll ────────────────────────────────────────────────────────────────────
      expect(geometry.page.scrollWidth).toBe(geometry.page.clientWidth)
      expect(geometry.dashboardOverflow.scrollWidth).toBeLessThanOrEqual(geometry.dashboardOverflow.clientWidth)

      // ── Fixed element counts ────────────────────────────────────────────────────────────────────
      expect(geometry.windowZoneCount).toBe(3)
      expect(geometry.windowZoneWordCount).toBe(3)
      expect(geometry.windowMarkerCount).toBe(0)        // omission: scDeltaChannel
      expect(geometry.windowMarkerAttr).toBe('none')
      expect(geometry.windowNoticeCount).toBe(1)
      expect(geometry.alertChipCount).toBe(0)           // silent: no chip

      // ── App-only reveals ────────────────────────────────────────────────────────────────────────
      expect(geometry.trainCount).toBe(isApp ? 1 : 0)
      expect(geometry.restartSketchCount).toBe(isApp ? 1 : 0)
      if (isApp) {
        expect(geometry.trainRowCount).toBe(0)          // omission: queueTrainChannel
        expect(geometry.trainRowsAttr).toBe('0')
        expect(geometry.trainAvailable).toBe('false')
        expect(geometry.trainNoticeText).toBe('NO QUEUE SOURCE')
      }

      // ── Packet omissions ───────────────────────────────────────────────────────────────────────
      // omission scDeltaChannel
      const scDelta = geometry.values.find((v) => v.label === 'sc-delta')
      expect(scDelta?.text, 'sc-delta must be "--.-"').toBe('--.-')
      expect(/[0-9]/.test(scDelta?.text ?? ''), 'sc-delta must have no digit').toBe(false)

      // omission restartZoneChannel
      expect(geometry.restartZoneText, 'restart-zone must be "--"').toBe('--')
      expect(geometry.restartZoneNotice).toBe('NO RESTART ZONE SOURCE')
      expect(geometry.restartZoneAvailable).toBe('false')

      // omission scWindowTargetChannel
      expect(geometry.windowNoticeText).toBe('NO SC WINDOW SOURCE')

      // Forbidden elements
      expect(geometry.shiftForbiddenCount).toBe(0)
      expect(geometry.waterForbiddenCount).toBe(0)
      expect(geometry.tyreForbiddenCount).toBe(0)
      expect(geometry.fuelForbiddenCount).toBe(0)

      // ── Window-bar geometry (normative override N3 arithmetic proof) ────────────────────────────
      const barRect = geometry.barRect
      expect(barRect, 'window bar measured').not.toBeNull()
      if (barRect && barRect.width > 0) {
        const tolerance = 2 / barRect.width
        for (const expected of WINDOW_ZONE_DEFS) {
          const zone = geometry.windowZoneMeasured.find((z) => z.id === expected.id)
          expect(zone, `window zone "${expected.id}" measured`).not.toBeNull()
          if (!zone?.rect) continue

          const startFrac = (zone.rect.left - barRect.left) / barRect.width
          const widthFrac = zone.rect.width / barRect.width

          expect(
            Math.abs(startFrac - expected.startFrac),
            `zone ${expected.id} start fraction deviates by ${Math.abs(startFrac - expected.startFrac).toFixed(5)} (bar ${barRect.width.toFixed(1)}px, tolerance ${tolerance.toFixed(5)})`
          ).toBeLessThanOrEqual(tolerance)
          expect(
            Math.abs(widthFrac - expected.widthFrac),
            `zone ${expected.id} width fraction deviates`
          ).toBeLessThanOrEqual(tolerance)

          // Attribute checks
          expect(zone.from, `zone ${expected.id} from`).toBe(expected.from)
          expect(zone.to, `zone ${expected.id} to`).toBe(expected.to)
          expect(zone.activeAttr, `zone ${expected.id} must be inactive`).toBe('false')
          expect(zone.word, `zone ${expected.id} word`).toBe(expected.word)
          expect(zone.centre, `zone ${expected.id} centre`).toBe(expected.centre)
        }
      }

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

      // ── Type scale (strict 5-step ladder) ─────────────────────────────────────────────────────
      // sc-delta > gap-ahead > restart-status > restart-block > position
      const scDeltaPx     = scDelta?.fontSize ?? 0
      const gapAheadPx    = geometry.values.find((v) => v.label === 'gap-ahead')?.fontSize ?? 0
      const rsFontSize    = geometry.restartStatusFontSize ?? 0
      const restartBlkPx  = geometry.values.find((v) => v.label === 'restart-block')?.fontSize ?? 0
      const positionPx    = geometry.values.find((v) => v.label === 'position')?.fontSize ?? 0

      expect(scDeltaPx,    'sc-delta > gap-ahead').toBeGreaterThan(gapAheadPx)
      expect(gapAheadPx,   'gap-ahead > restart-status').toBeGreaterThan(rsFontSize)
      expect(rsFontSize,   'restart-status > restart-block').toBeGreaterThan(restartBlkPx)
      expect(restartBlkPx, 'restart-block > position').toBeGreaterThan(positionPx)

      // ── DEFECT RC-13/2 — glyph ascent above root top at 1024x600 ──────────────────────────────
      if (isApp) {
        const top = geometry.restartStatusTextRngTop
        expect(top, 'glyph ascent measured at app layout').not.toBeNull()
        if (top !== null) {
          const overflow = -top
          expect(overflow, `DEFECT RC-13/2: glyph overflow at app must be > 0`).toBeGreaterThan(0)
          expect(overflow, `DEFECT RC-13/2: glyph overflow must be within ${GLYPH_OVERFLOW_BUDGET_PX}px`).toBeLessThanOrEqual(GLYPH_OVERFLOW_BUDGET_PX)
        }
      } else {
        const top = geometry.restartStatusTextRngTop
        if (top !== null) {
          expect(top, `glyph ascent must be >= -0.5 at ${sizeKey} (DEFECT RC-13/2 has not spread)`).toBeGreaterThanOrEqual(-0.5)
        }
      }

      // ── Restart-status text and font size ──────────────────────────────────────────────────────
      expect(geometry.restartStatusText, 'restart-status shows "SC DEPLOYED" in silent').toBe('SC DEPLOYED')

      const capture = await page.locator('#racecon-rc13-capture-root').screenshot({ animations: 'disabled' })
      expect(capture.byteLength).toBeGreaterThan(5_000)
    } finally {
      await context.close()
    }
  })
}

test('the restart-imminent alert latches the chip and RESTART IMMINENT text (native 800x480)', async ({ browser }) => {
  const size = viewports[0]   // native 800x480
  const { context, page } = await openCapture(browser, size, { layout: 'native', state: 'restart-imminent' })
  try {
    await expect
      .poll(
        async () => page.locator('[data-widget="raceconRc13Dash"]').getAttribute('data-rc13-alerts'),
        { timeout: 120_000 }
      )
      .toBe('restartImminent')

    const geometry = await readGeometry(page)

    expect(geometry.alerts).toBe('restartImminent')
    expect(geometry.restart).toBe('restartImminent')
    expect(geometry.flag).toBe('yellow')
    expect(geometry.muted).toBe('true')
    expect(geometry.shiftArmed).toBe('false')

    // Alert chip present
    expect(geometry.alertChipCount, 'alert chip must be present in restart-imminent').toBe(1)
    expect(geometry.alertChipRect, 'alert chip must have a rendered rect').not.toBeNull()

    // Restart-status shows "RESTART IMMINENT"
    expect(geometry.restartStatusText).toBe('RESTART IMMINENT')
    const restartBlock = geometry.values.find((v) => v.label === 'restart-block')
    expect(restartBlock?.text, 'restart-block shows "RESTART IMMINENT"').toBe('RESTART IMMINENT')

    // Window-bar: all zones still inactive (window-violation alert unreachable from telemetry)
    for (const zone of geometry.windowZoneMeasured) {
      expect(zone.activeAttr, `zone ${zone.id} must remain inactive in restart-imminent`).toBe('false')
    }
    expect(geometry.windowMarkerAttr).toBe('none')

    // Packet omissions still hold
    const scDelta = geometry.values.find((v) => v.label === 'sc-delta')
    expect(scDelta?.text, 'sc-delta still "--.-" in restart-imminent').toBe('--.-')
    expect(geometry.restartZoneText, 'restart-zone still "--"').toBe('--')

    // Forbidden elements still 0
    expect(geometry.shiftForbiddenCount).toBe(0)
    expect(geometry.waterForbiddenCount).toBe(0)
    expect(geometry.tyreForbiddenCount).toBe(0)
    expect(geometry.fuelForbiddenCount).toBe(0)

    // Type scale still holds in restart-imminent state
    const scDeltaPx     = scDelta?.fontSize ?? 0
    const gapAheadPx    = geometry.values.find((v) => v.label === 'gap-ahead')?.fontSize ?? 0
    const rsFontSize    = geometry.restartStatusFontSize ?? 0
    const restartBlkPx  = geometry.values.find((v) => v.label === 'restart-block')?.fontSize ?? 0
    const positionPx    = geometry.values.find((v) => v.label === 'position')?.fontSize ?? 0
    expect(scDeltaPx,    'sc-delta > gap-ahead in restart-imminent').toBeGreaterThan(gapAheadPx)
    expect(gapAheadPx,   'gap-ahead > restart-status in restart-imminent').toBeGreaterThan(rsFontSize)
    expect(rsFontSize,   'restart-status > restart-block in restart-imminent').toBeGreaterThan(restartBlkPx)
    expect(restartBlkPx, 'restart-block > position in restart-imminent').toBeGreaterThan(positionPx)

    const capture = await page.locator('#racecon-rc13-capture-root').screenshot({ animations: 'disabled' })
    expect(capture.byteLength).toBeGreaterThan(5_000)
  } finally {
    await context.close()
  }
})

test('DEFECT RC-13/1: restart-status overflows its box at compact-phone in restart-imminent state', async ({ browser }) => {
  // Test the two defect viewports explicitly. Budget: scrollWidth − clientWidth ≤ 3 px.
  const defectViewports = [viewports[2], viewports[3]] // 393x759, 412x867

  for (const size of defectViewports) {
    const sizeKey = `${size.width}x${size.height}`
    const { context, page } = await openCapture(browser, size, {
      layout: 'compact',
      compactMode: 'phone',
      state: 'restart-imminent'
    })
    try {
      await expect
        .poll(
          async () => page.locator('[data-widget="raceconRc13Dash"]').getAttribute('data-rc13-alerts'),
          { timeout: 120_000 }
        )
        .toBe('restartImminent')

      const geometry = await readGeometry(page)
      expect(geometry.restartStatusText).toBe('RESTART IMMINENT')

      const overflow = geometry.restartStatusScrollW - geometry.restartStatusClientW
      expect(
        overflow,
        `DEFECT RC-13/1 at ${sizeKey}: restart-status must overflow by > 0 (text clips at compact-phone)`
      ).toBeGreaterThan(0)
      expect(
        overflow,
        `DEFECT RC-13/1 at ${sizeKey}: restart-status overflow must be within ${RESTART_STATUS_OVERFLOW_BUDGET_PX}px`
      ).toBeLessThanOrEqual(RESTART_STATUS_OVERFLOW_BUDGET_PX)
    } finally {
      await context.close()
    }
  }
})
