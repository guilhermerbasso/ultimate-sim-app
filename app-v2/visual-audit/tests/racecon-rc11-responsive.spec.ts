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
  if (!baseUrl) throw new Error('RC-11 visual-audit server did not report a local URL')
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
  expected: {
    layout: 'native' | 'app' | 'compact'
    compactMode?: 'phone' | 'landscape'
    state: string
  }
): Promise<{ context: Awaited<ReturnType<Browser['newContext']>>; page: Page }> {
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'dark'
  })
  const page = await context.newPage()
  const target = new URL('racecon-rc11-capture.html', baseUrl)
  target.searchParams.set('width',  String(size.width))
  target.searchParams.set('height', String(size.height))
  target.searchParams.set('state',  expected.state)
  await page.goto(target.href, { waitUntil: 'networkidle' })

  // Wait for the widget to reach the governed ready state.
  // RC-11 scripts 150–300 frames before publishing; use a generous timeout.
  await page.waitForFunction(
    ({ layout, compactMode, state: captureState }) => {
      const root   = document.querySelector('#racecon-rc11-capture-root')
      const widget = root?.querySelector<HTMLElement>('[data-widget="raceconRc11Dash"]')
      if (!root || !widget) return false
      if (root.getAttribute('data-capture-ready') !== 'true') return false
      if (widget.dataset.rc11BufferState !== 'accepted') return false
      if (widget.dataset.rc11Layout !== layout) return false
      if (compactMode !== undefined && widget.dataset.rc11CompactMode !== compactMode) return false
      if (captureState === 'data-gap' && widget.dataset.rc11Alerts !== 'active') return false
      return true
    },
    expected,
    { timeout: 150_000 }
  )
  return { context, page }
}

const viewports = [
  { width: 800,  height: 480, layout: 'native',  compactMode: null },
  { width: 1024, height: 600, layout: 'app',     compactMode: null },
  { width: 393,  height: 759, layout: 'compact', compactMode: 'phone' },
  { width: 412,  height: 867, layout: 'compact', compactMode: 'phone' },
  { width: 759,  height: 393, layout: 'compact', compactMode: 'landscape' },
  { width: 867,  height: 412, layout: 'compact', compactMode: 'landscape' }
] as const

/**
 * DEFECT RC-11/1 — DATA GAP label overflow at every viewport in the data-gap state.
 * Budget = 36 px (max measured +30 px + 6 px font-metric allowance).
 */
const GAP_LABEL_OVERFLOW_BUDGET_PX = 36

async function readGeometry(page: Page) {
  return page.locator('#racecon-rc11-capture-root').evaluate((root) => {
    const rootRect = root.getBoundingClientRect()
    const relative = (element: Element | null): Rect | null => {
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return {
        left:   rect.left   - rootRect.left,
        top:    rect.top    - rootRect.top,
        width:  rect.width,
        height: rect.height,
        right:  rect.right  - rootRect.left,
        bottom: rect.bottom - rootRect.top
      }
    }
    const widget    = root.querySelector<HTMLElement>('[data-widget="raceconRc11Dash"]')!
    const dashboard = root.querySelector<HTMLElement>('.rc11-dashboard')!

    const attr = (name: string) => widget?.dataset[name.replace(/-./g, m => m[1].toUpperCase())] ?? null

    const measure = (label: string, selector: string) => {
      const element = root.querySelector<HTMLElement>(selector)
      if (!element) return null
      const style = getComputedStyle(element)
      return {
        label,
        text:       element.textContent?.trim() ?? '',
        fontSize:   Number.parseFloat(style.fontSize),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        rect: relative(element)
      }
    }

    const zoneNames: [string, string][] = [
      ['speed',  '[data-testid="rc11-panel-speed"]'],
      ['inputs', '[data-testid="rc11-panel-inputs"]'],
      ['gear',   '[data-testid="rc11-panel-gear"]'],
      ['delta',  '[data-testid="rc11-panel-delta"]'],
      ['gg',     '[data-testid="rc11-panel-gg"]'],
      ['tiles',  '[data-testid="rc11-panel-tiles"]']
    ]
    const zones = zoneNames.map(([name, selector]) => {
      const element = root.querySelector<HTMLElement>(selector)
      const rect = element ? relative(element)! : { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }
      return { name, rect, display: getComputedStyle(element!).display }
    })

    // HEADLINE: shared plot axis — measure all four rc11-plot elements
    const plotElements = Array.from(root.querySelectorAll<HTMLElement>('[data-testid="rc11-plot"]'))
    const plotRects = plotElements.map(el => ({
      ...relative(el)!,
      plotId: el.getAttribute('data-rc11-plot-id') ?? '',
      attrX0: el.getAttribute('data-rc11-plot-x0') ?? '',
      attrX1: el.getAttribute('data-rc11-plot-x1') ?? ''
    }))

    // Scrub cursors
    const cursorElements = Array.from(root.querySelectorAll<HTMLElement>('[data-testid="rc11-cursor"]'))
    const cursorRects = cursorElements.map(el => ({
      ...relative(el)!,
      panelId: el.getAttribute('data-rc11-cursor-panel') ?? ''
    }))

    // Distance tick texts
    const distanceTicks = Array.from(root.querySelectorAll<HTMLElement>('[data-testid="rc11-distance-tick"]'))
    const distanceTickTexts = distanceTicks.map(el => el.textContent?.trim() ?? '')

    // Gap label overflow (DEFECT RC-11/1)
    const gapLabelElements = Array.from(root.querySelectorAll<HTMLElement>('.rc11-gap-label'))
    const gapLabelOverflows = gapLabelElements.map(el => ({
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      overflowX: el.scrollWidth - el.clientWidth
    }))

    return {
      viewport:     { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
      page:         { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
      root:         relative(root)!,
      layout:       attr('rc11Layout'),
      compactMode:  attr('rc11CompactMode'),
      contentWidth:  attr('rc11ContentWidth'),
      contentHeight: attr('rc11ContentHeight'),
      bufferState:   attr('rc11BufferState'),
      alerts:        attr('rc11Alerts'),
      nativeSize:    dashboard?.getAttribute('data-rc11-native-size') ?? null,
      // Fixed element counts
      plotCount:          root.querySelectorAll('[data-testid="rc11-plot"]').length,
      cursorCount:        root.querySelectorAll('[data-testid="rc11-cursor"]').length,
      distanceTickCount:  root.querySelectorAll('[data-testid="rc11-distance-tick"]').length,
      steeringCount:      root.querySelectorAll('[data-testid="rc11-panel-inputs"] [data-rc11-series="steering"]').length,
      inputsLegendCount:  root.querySelectorAll('[data-testid="rc11-legend-inputs"] [data-testid="rc11-legend-entry"]').length,
      speedLegendCount:   root.querySelectorAll('[data-testid="rc11-legend-speed"] [data-testid="rc11-legend-entry"]').length,
      gapBandCount:       root.querySelectorAll('[data-testid="rc11-gap"]').length,
      lockupCount:        root.querySelectorAll('[data-testid="rc11-marker"][data-rc11-marker="lockUp"]').length,
      sectorRowCount:     root.querySelectorAll('[data-testid="rc11-sector-row"]').length,
      sectorNoticeCount:  root.querySelectorAll('[data-testid="rc11-sector-notice"]').length,
      sectorPanelPresent: root.querySelector('[data-testid="rc11-panel-sectors"]') !== null,
      // Packet omissions: forbidden elements
      rpmForbiddenCount:    root.querySelectorAll('[data-rc11-series="rpm"], [data-testid="rc11-panel-rpm"], .rc11-led, .rc11-rev').length,
      legendDividerCount:   root.querySelectorAll('.rc11-legend-divider').length,
      troughCount:          root.querySelectorAll('[data-testid="rc11-trough"]').length,
      // Distance tick texts for omission check
      distanceTickTexts,
      // Shared plot axis rects
      plotRects,
      cursorRects,
      // Gap label overflow (DEFECT RC-11/1)
      gapLabelOverflows,
      // Zone rects
      zones,
      // Type-scale values
      values: [
        measure('tile value',     '[data-testid="rc11-tyreFl"]'),
        measure('cursor readout', '[data-testid="rc11-cursor-speed"]'),
        measure('axis label',     '[data-testid="rc11-distance-tick"]')
      ].filter((e): e is NonNullable<typeof e> => e !== null)
    }
  })
}

for (const size of viewports) {
  const label    = size.compactMode ? `${size.layout}/${size.compactMode}` : size.layout
  const sizeKey  = `${size.width}x${size.height}`
  const isNative = size.layout === 'native'
  const isApp    = size.layout === 'app'

  test(`${sizeKey} keeps the ${label} RC-11 composition contained (silent)`, async ({ browser }) => {
    const { context, page } = await openCapture(browser, size, {
      layout: size.layout,
      compactMode: size.compactMode ?? undefined,
      state: 'silent'
    })
    try {
      await expect
        .poll(async () => page.locator('[data-widget="raceconRc11Dash"]').getAttribute('data-rc11-buffer-state'))
        .toBe('accepted')
      const geometry = await readGeometry(page)

      // Viewport and layout
      expect(geometry.viewport).toEqual({ width: size.width, height: size.height, dpr: 1 })
      expect(geometry.layout).toBe(size.layout)
      expect(geometry.compactMode).toBe(size.compactMode)
      expect(geometry.contentWidth).toBe(String(size.width))
      expect(geometry.contentHeight).toBe(String(size.height))

      // State attributes
      expect(geometry.alerts).toBe('silent')

      // Native-size modifier
      expect(geometry.nativeSize).toBe(isNative ? '800x480' : null)

      // No horizontal scroll
      expect(geometry.page.scrollWidth).toBe(geometry.page.clientWidth)

      // Fixed element counts
      expect(geometry.plotCount).toBe(4)
      expect(geometry.cursorCount).toBe(4)
      expect(geometry.distanceTickCount).toBe(5)
      expect(geometry.lockupCount).toBe(0)
      expect(geometry.gapBandCount).toBe(0)

      // omission steeringAt800: steering series count by layout
      expect(geometry.steeringCount).toBe(isApp ? 1 : 0)
      expect(geometry.inputsLegendCount).toBe(isApp ? 3 : 2)
      expect(geometry.speedLegendCount).toBe(2)

      // omission lapDistanceChannel: every distance tick must show "--"
      expect(geometry.distanceTickTexts.length).toBe(5)
      for (const text of geometry.distanceTickTexts) {
        expect(text).toBe('--')
        expect(/[0-9]/.test(text)).toBe(false)
      }

      // App-only reveals: mini-sector table
      expect(geometry.sectorPanelPresent).toBe(isApp)
      expect(geometry.sectorRowCount).toBe(0)
      if (isApp) {
        expect(geometry.sectorNoticeCount).toBe(1)
      } else {
        expect(geometry.sectorNoticeCount).toBe(0)
      }

      // Packet omissions (forbidden elements)
      expect(geometry.rpmForbiddenCount).toBe(0)
      expect(geometry.legendDividerCount).toBe(0)
      expect(geometry.troughCount).toBe(0)

      // Zone geometry: all zones inside frame
      const frameRect: Rect = { left: 0, top: 0, width: size.width, height: size.height, right: size.width, bottom: size.height }
      for (const zone of geometry.zones) {
        if (zone.display === 'none') continue
        expectContained(frameRect, zone.rect)
      }
      // Peer zones must not overlap
      const visibleZones = geometry.zones.filter(z => z.display !== 'none' && z.rect.width > 0 && z.rect.height > 0)
      for (let a = 0; a < visibleZones.length; a += 1) {
        for (let b = a + 1; b < visibleZones.length; b += 1) {
          const first  = visibleZones[a]
          const second = visibleZones[b]
          const overlapX = Math.min(first.rect.right, second.rect.right) - Math.max(first.rect.left, second.rect.left)
          const overlapY = Math.min(first.rect.bottom, second.rect.bottom) - Math.max(first.rect.top, second.rect.top)
          expect(
            Math.min(overlapX, overlapY),
            `${first.name} overlaps ${second.name}`
          ).toBeLessThanOrEqual(0.5)
        }
      }

      // HEADLINE: shared plot axis — all four rc11-plot rects must share the same left and width
      expect(geometry.plotRects.length).toBe(4)
      if (geometry.plotRects.length === 4) {
        const refLeft  = geometry.plotRects[0].left
        const refWidth = geometry.plotRects[0].width
        const refX0    = geometry.plotRects[0].attrX0
        const refX1    = geometry.plotRects[0].attrX1
        for (let i = 1; i < 4; i += 1) {
          expect(Math.abs(geometry.plotRects[i].left  - refLeft),  `plot[${i}] left must match plot[0]`).toBeLessThanOrEqual(0.02)
          expect(Math.abs(geometry.plotRects[i].width - refWidth), `plot[${i}] width must match plot[0]`).toBeLessThanOrEqual(0.02)
          expect(geometry.plotRects[i].attrX0, `plot[${i}] data-rc11-plot-x0 must match plot[0]`).toBe(refX0)
          expect(geometry.plotRects[i].attrX1, `plot[${i}] data-rc11-plot-x1 must match plot[0]`).toBe(refX1)
        }
        // At native the declared axis pair must be "70"/"520"; at app "88"/"718"
        if (isNative) {
          expect(refX0).toBe('70')
          expect(refX1).toBe('520')
        } else if (isApp) {
          expect(refX0).toBe('88')
          expect(refX1).toBe('718')
        }
      }

      // Shared scrub cursor: all four cursors must share the same measured left
      expect(geometry.cursorRects.length).toBe(4)
      if (geometry.cursorRects.length === 4) {
        const cursorLeft = geometry.cursorRects[0].left
        for (let i = 1; i < 4; i += 1) {
          expect(
            Math.abs(geometry.cursorRects[i].left - cursorLeft),
            `cursor[${i}] left must match cursor[0]`
          ).toBeLessThanOrEqual(0.02)
        }
      }

      // Type-scale hierarchy: tile value > cursor readout > axis label (strict, no ties)
      const scale = ['tile value', 'cursor readout', 'axis label'].map(
        (name) => geometry.values.find((v) => v.label === name)!
      ).filter(Boolean)
      for (let index = 1; index < scale.length; index += 1) {
        expect(
          scale[index - 1].fontSize,
          `${scale[index - 1].label} must be strictly larger than ${scale[index].label}`
        ).toBeGreaterThan(scale[index].fontSize)
      }

      const capture = await page.locator('#racecon-rc11-capture-root').screenshot({ animations: 'disabled' })
      expect(capture.byteLength).toBeGreaterThan(5_000)
    } finally {
      await context.close()
    }
  })
}

test('the data-gap band is present and its label overflows within budget', async ({ browser }) => {
  // Use the native viewport for the engaged-state test
  const size = viewports[0]  // 800x480 native
  const { context, page } = await openCapture(browser, size, { layout: 'native', state: 'data-gap' })
  try {
    await expect
      .poll(
        async () => page.locator('[data-widget="raceconRc11Dash"]').getAttribute('data-rc11-alerts'),
        { timeout: 150_000 }
      )
      .toBe('active')

    const alarm = await page.locator('#racecon-rc11-capture-root').evaluate((root) => {
      const widget = root.querySelector<HTMLElement>('[data-widget="raceconRc11Dash"]')!
      const gapLabelElements = Array.from(root.querySelectorAll<HTMLElement>('.rc11-gap-label'))
      return {
        alerts:      widget?.dataset.rc11Alerts,
        gapBandCount: root.querySelectorAll('[data-testid="rc11-gap"]').length,
        gapLabelOverflows: gapLabelElements.map(el => ({
          clientWidth: el.clientWidth,
          scrollWidth: el.scrollWidth,
          overflowX: el.scrollWidth - el.clientWidth
        })),
        // Packet omissions still hold in data-gap state
        distanceTickTexts: Array.from(root.querySelectorAll('[data-testid="rc11-distance-tick"]')).map(el => el.textContent?.trim() ?? ''),
        lockupCount:   root.querySelectorAll('[data-testid="rc11-marker"][data-rc11-marker="lockUp"]').length,
        rpmCount:      root.querySelectorAll('[data-rc11-series="rpm"], [data-testid="rc11-panel-rpm"]').length,
        sectorRowCount: root.querySelectorAll('[data-testid="rc11-sector-row"]').length
      }
    })

    // Alert must be active
    expect(alarm.alerts).toBe('active')

    // Gap bands must be present
    expect(alarm.gapBandCount).toBeGreaterThanOrEqual(1)

    // DEFECT RC-11/1: the gap-label must overflow, but within the 36 px budget.
    // Every gap label we find must overflow > 0 and ≤ 36 px.
    expect(alarm.gapLabelOverflows.length, 'at least one gap label must exist in data-gap state').toBeGreaterThanOrEqual(1)
    for (const { overflowX } of alarm.gapLabelOverflows) {
      expect(overflowX, 'gap label overflow must be > 0 (DEFECT RC-11/1)').toBeGreaterThan(0)
      expect(overflowX, `gap label overflow must stay within ${GAP_LABEL_OVERFLOW_BUDGET_PX} px budget`).toBeLessThanOrEqual(GAP_LABEL_OVERFLOW_BUDGET_PX)
    }

    // Packet omissions still hold under data-gap
    for (const text of alarm.distanceTickTexts) {
      expect(text).toBe('--')
    }
    expect(alarm.lockupCount).toBe(0)
    expect(alarm.rpmCount).toBe(0)
    expect(alarm.sectorRowCount).toBe(0)

    const capture = await page.locator('#racecon-rc11-capture-root').screenshot({ animations: 'disabled' })
    expect(capture.byteLength).toBeGreaterThan(5_000)
  } finally {
    await context.close()
  }
})
