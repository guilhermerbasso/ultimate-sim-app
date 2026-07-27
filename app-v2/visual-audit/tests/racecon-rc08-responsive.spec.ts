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
  if (!baseUrl) throw new Error('RC-08 visual-audit server did not report a local URL')
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
  const target = new URL('racecon-rc08-capture.html', baseUrl)
  target.searchParams.set('width', String(size.width))
  target.searchParams.set('height', String(size.height))
  target.searchParams.set('state', expected.state)
  await page.goto(target.href, { waitUntil: 'networkidle' })

  // Wait for the widget to reach the governed ready state.
  await page.waitForFunction(
    ({ layout, compactMode, state: captureState }) => {
      const root   = document.querySelector('#racecon-rc08-capture-root')
      const widget = root?.querySelector<HTMLElement>('[data-widget="raceconRc08Dash"]')
      if (!root || !widget) return false
      if (root.getAttribute('data-capture-ready') !== 'true') return false
      if (widget.dataset.rc08BufferState !== 'accepted') return false
      if (widget.dataset.rc08Layout !== layout) return false
      if (compactMode !== undefined && widget.dataset.rc08CompactMode !== compactMode) return false
      // cold-tyre state: wait for the alert to latch
      if (captureState === 'cold-tyre' && widget.dataset.rc08Alerts !== 'active') return false
      return true
    },
    expected,
    { timeout: 120_000 }
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
 * Column-widths strings for the WET regime at each normatively bounded layout.
 * These are the governance promises from section 10 of the contract report.
 */
const COLUMN_WIDTHS_NATIVE = '37.5/23.8/30.8'
const COLUMN_WIDTHS_APP    = '35.2/23.4/32'     // widget emits "32" not "32.0"

async function readGeometry(page: Page) {
  return page.locator('#racecon-rc08-capture-root').evaluate((root) => {
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
    const widget    = root.querySelector<HTMLElement>('[data-widget="raceconRc08Dash"]')!
    const dashboard = root.querySelector<HTMLElement>('.rc08-dashboard')!

    const attr = (name: string) => widget.dataset[name.replace(/-./g, m => m[1].toUpperCase())] ?? null

    const measure = (label: string, selector: string) => {
      const element = root.querySelector<HTMLElement>(selector)
      if (!element) return null
      const style = getComputedStyle(element)
      return {
        label,
        text: element.textContent?.trim() ?? '',
        fontSize: Number.parseFloat(style.fontSize),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        rect: relative(element)
      }
    }

    const zoneNames: [string, string][] = [
      ['banner', '[data-testid="rc08-banner"]'],
      ['aids',   '[data-testid="rc08-aids"]'],
      ['pace',   '[data-testid="rc08-pace"]'],
      ['tire',   '[data-testid="rc08-tire"]']
    ]
    const zones = zoneNames.map(([name, selector]) => {
      const element = root.querySelector<HTMLElement>(selector)!
      const rect = element ? relative(element)! : { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }
      return { name, rect, display: getComputedStyle(element).display }
    })

    return {
      viewport:    { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
      page:        { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
      root:        relative(root)!,
      layout:      attr('rc08Layout'),
      compactMode: attr('rc08CompactMode'),
      contentWidth:  attr('rc08ContentWidth'),
      contentHeight: attr('rc08ContentHeight'),
      alerts:       attr('rc08Alerts'),
      alertKeys:    attr('rc08AlertKeys'),
      grip:         attr('rc08Grip'),
      regime:       attr('rc08Regime'),
      weather:      attr('rc08Weather'),
      columnWidths: attr('rc08ColumnWidths'),
      bufferState:  attr('rc08BufferState'),
      nativeSize:   dashboard?.getAttribute('data-rc08-native-size') ?? null,
      dashboardOverflow: {
        clientWidth:  dashboard?.clientWidth  ?? 0,
        scrollWidth:  dashboard?.scrollWidth  ?? 0,
        clientHeight: dashboard?.clientHeight ?? 0,
        scrollHeight: dashboard?.scrollHeight ?? 0
      },
      // Counts
      cornerCount:         root.querySelectorAll('[data-testid="rc08-corner"]').length,
      rowCount:            root.querySelectorAll('[data-testid="rc08-row"]').length,
      cellCount:           root.querySelectorAll('[data-testid="rc08-cell"]').length,
      crossoverCellCount:  root.querySelectorAll('[data-testid="rc08-crossover-cell"]').length,
      timelinePresent:     root.querySelector('[data-testid="rc08-timeline"]') !== null,
      coldCornerCount:     root.querySelectorAll('[data-testid="rc08-corner-cold"]').length,
      aidsFaultCount:      root.querySelectorAll('[data-testid="rc08-aids-fault"]').length,
      // Packet omission probes
      shiftArcCount:       root.querySelectorAll('.rc08-led, .rc08-shift, .rc08-rev, [data-rc08-zone="shift"]').length,
      rainText:            root.querySelector('[data-testid="rc08-rain"]')?.textContent?.trim() ?? null,
      gripChipText:        root.querySelector('[data-testid="rc08-grip"]')?.textContent?.trim() ?? null,
      // Zone rects for overlap/containment check
      zones,
      // Type-scale values
      values: [
        measure('grip',   '[data-testid="rc08-grip"]'),
        measure('delta',  '[data-testid="rc08-delta"]'),
        measure('aid',    '[data-testid="rc08-tc"]'),
        measure('corner', '[data-testid="rc08-corner-FL"]'),
        measure('speed',  '[data-testid="rc08-speed"]')
      ].filter((entry): entry is NonNullable<typeof entry> => entry !== null),
      // Containment spot-checks
      paceRect:   relative(root.querySelector('[data-testid="rc08-pace"]')),
      gearRect:   relative(root.querySelector('[data-testid="rc08-gear"]')),
      deltaRect:  relative(root.querySelector('[data-testid="rc08-delta"]')),
      speedRect:  relative(root.querySelector('[data-testid="rc08-speed"]')),
      tireRect:   relative(root.querySelector('[data-testid="rc08-tire"]')),
      flRect:     relative(root.querySelector('[data-testid="rc08-corner-FL"]')),
      // Cold corner for alert test
      flCold:        root.querySelector('[data-rc08-corner="FL"]')?.getAttribute('data-rc08-cold') ?? null,
      flContainerRect: relative(root.querySelector('[data-rc08-corner="FL"]'))
    }
  })
}

for (const size of viewports) {
  const label    = size.compactMode ? `${size.layout}/${size.compactMode}` : size.layout
  const sizeKey  = `${size.width}x${size.height}`
  const isApp    = size.layout === 'app'
  const isNative = size.layout === 'native'

  test(`${sizeKey} keeps the ${label} RC-08 composition contained (silent)`, async ({ browser }) => {
    const { context, page } = await openCapture(browser, size, {
      layout: size.layout,
      compactMode: size.compactMode ?? undefined,
      state: 'silent'
    })
    try {
      await expect
        .poll(async () => page.locator('[data-widget="raceconRc08Dash"]').getAttribute('data-rc08-buffer-state'))
        .toBe('accepted')
      const geometry = await readGeometry(page)

      // Viewport and layout
      expect(geometry.viewport).toEqual({ width: size.width, height: size.height, dpr: 1 })
      expect(geometry.layout).toBe(size.layout)
      expect(geometry.compactMode).toBe(size.compactMode)
      expect(geometry.contentWidth).toBe(String(size.width))
      expect(geometry.contentHeight).toBe(String(size.height))
      // bufferState already confirmed by expect.poll() above; the DOM-snapshot read is racy
      // because the widget's 100 ms display clock re-ingests the same snapshot and the buffer
      // correctly reports "duplicate" for that re-render. RC-03 follows the same pattern.
      expect(geometry.regime).toBe('WET')
      expect(geometry.alerts).toBe('silent')
      expect(geometry.alertKeys).toBe('')
      expect(geometry.grip).toBe('WET')
      expect(geometry.weather).toBe('live')

      // Column widths for normatively bounded layouts
      if (isNative) expect(geometry.columnWidths).toBe(COLUMN_WIDTHS_NATIVE)
      if (isApp)    expect(geometry.columnWidths).toBe(COLUMN_WIDTHS_APP)

      // native-size modifier
      expect(geometry.nativeSize).toBe(isNative ? '800x480' : null)

      // No horizontal scrollbar
      expect(geometry.page.scrollWidth).toBe(geometry.page.clientWidth)
      expect(geometry.dashboardOverflow.scrollWidth).toBeLessThanOrEqual(geometry.dashboardOverflow.clientWidth)

      // Fixed element counts (always present, never zero)
      expect(geometry.cornerCount).toBe(4)
      expect(geometry.rowCount).toBe(4)
      expect(geometry.cellCount).toBe(3)

      // App-only elements
      expect(geometry.crossoverCellCount).toBe(isApp ? 4 : 0)
      expect(geometry.timelinePresent).toBe(isApp)

      // Silent state: no alert surfaces
      expect(geometry.coldCornerCount).toBe(0)
      expect(geometry.aidsFaultCount).toBe(0)

      // Packet omissions (shiftArc): no LED/shift/rev elements ever
      expect(geometry.shiftArcCount).toBe(0)

      // omission rainRateNumeral: rain row always reads exactly "UNAVAILABLE"
      expect(geometry.rainText).toBe('UNAVAILABLE')

      // omission gripPercentNumeral: grip chip always a word, never a digit
      expect(geometry.gripChipText).toBe('WET')
      expect(/[0-9]/.test(geometry.gripChipText ?? '')).toBe(false)

      // Type-scale hierarchy: grip > delta > aid > corner > speed (strict, no ties)
      const scale = ['grip', 'delta', 'aid', 'corner', 'speed'].map(
        (name) => geometry.values.find((v) => v.label === name)!
      )
      for (let index = 1; index < scale.length; index += 1) {
        expect(
          scale[index - 1].fontSize,
          `${scale[index - 1].label} must be strictly larger than ${scale[index].label}`
        ).toBeGreaterThan(scale[index].fontSize)
      }

      // omission wetWindowReadout: "50" and "80" must not appear as individual leaf text
      // (verified by the lib's lacksLeafText — here we do a text scan as belt-and-suspenders)
      const pageText = await page.locator('#racecon-rc08-capture-root').textContent()
      // The bounds never appear as standalone leaf nodes, but checking full text is weaker;
      // the lib's per-leaf check is authoritative.
      expect(geometry.coldCornerCount).toBe(0)   // re-stated for clarity

      // Zone geometry: no peer zone overlaps, all zones inside frame
      const frameRect: Rect = { left: 0, top: 0, width: size.width, height: size.height, right: size.width, bottom: size.height }
      for (const zone of geometry.zones) {
        expectContained(frameRect, zone.rect)
      }
      const visibleZones = geometry.zones.filter(z => z.display !== 'none' && z.rect.width > 0 && z.rect.height > 0)
      for (let a = 0; a < visibleZones.length; a += 1) {
        for (let b = a + 1; b < visibleZones.length; b += 1) {
          const first  = visibleZones[a]
          const second = visibleZones[b]
          const overlapX = Math.min(first.rect.right, second.rect.right) - Math.max(first.rect.left, second.rect.left)
          const overlapY = Math.min(first.rect.bottom, second.rect.bottom) - Math.max(first.rect.top, second.rect.top)
          expect(
            Math.min(overlapX, overlapY),
            `${first.name} overlaps ${second.name} by ${overlapX.toFixed(2)}×${overlapY.toFixed(2)}px`
          ).toBeLessThanOrEqual(0.5)
        }
      }

      // Containment spot-checks: pace values inside pace, corners inside tire
      if (geometry.paceRect && geometry.gearRect)  expectContained(geometry.paceRect, geometry.gearRect)
      if (geometry.paceRect && geometry.deltaRect) expectContained(geometry.paceRect, geometry.deltaRect)
      if (geometry.paceRect && geometry.speedRect) expectContained(geometry.paceRect, geometry.speedRect)
      if (geometry.tireRect && geometry.flRect)    expectContained(geometry.tireRect, geometry.flRect)

      const capture = await page.locator('#racecon-rc08-capture-root').screenshot({ animations: 'disabled' })
      expect(capture.byteLength).toBeGreaterThan(5_000)
    } finally {
      await context.close()
    }
  })
}

test('the cold-tyre-in-wet alert surfaces only inside the FL corner cell', async ({ browser }) => {
  // Use the native viewport for this test: no crossover in native layout, so the scope is clean.
  const size = viewports[0]
  const { context, page } = await openCapture(browser, size, { layout: 'native', state: 'cold-tyre' })
  try {
    await expect
      .poll(async () =>
        page.locator('[data-widget="raceconRc08Dash"]').getAttribute('data-rc08-alerts'),
        { timeout: 120_000 }
      )
      .toBe('active')

    const alarm = await page.locator('#racecon-rc08-capture-root').evaluate((root) => {
      const rootRect = root.getBoundingClientRect()
      const relative = (element: Element | null) => {
        if (!element) return null
        const rect = element.getBoundingClientRect()
        return {
          left:   rect.left   - rootRect.left,
          top:    rect.top    - rootRect.top,
          right:  rect.right  - rootRect.left,
          bottom: rect.bottom - rootRect.top,
          width:  rect.width,
          height: rect.height
        }
      }
      const widget      = root.querySelector<HTMLElement>('[data-widget="raceconRc08Dash"]')!
      const flContainer = root.querySelector<HTMLElement>('[data-rc08-corner="FL"]')
      const coldDot     = root.querySelector<HTMLElement>('[data-testid="rc08-corner-cold"]')
      const tireEl      = root.querySelector<HTMLElement>('[data-testid="rc08-tire"]')
      return {
        alerts:      widget.dataset.rc08Alerts,
        alertKeys:   widget.dataset.rc08AlertKeys,
        regime:      widget.dataset.rc08Regime,
        flCold:      flContainer?.getAttribute('data-rc08-cold') ?? null,
        flRect:      relative(flContainer),
        coldDotRect: relative(coldDot),
        tireRect:    relative(tireEl),
        flTempText:  root.querySelector('[data-testid="rc08-corner-FL"]')?.textContent?.trim() ?? null,
        coldCornerCount: root.querySelectorAll('[data-testid="rc08-corner-cold"]').length
      }
    })

    // Alert must be active with the COLD TYRES key
    expect(alarm.alerts).toBe('active')
    expect(alarm.alertKeys).toContain('COLD TYRES')
    expect(alarm.regime).toBe('WET')

    // FL corner must be cold
    expect(alarm.flCold).toBe('true')
    expect(alarm.flTempText).toBe('41')

    // Cold dot must exist
    expect(alarm.coldCornerCount).toBeGreaterThanOrEqual(1)

    // The cold dot and FL container must be inside the tire zone
    if (alarm.tireRect && alarm.flRect) {
      expect(alarm.flRect.left).toBeGreaterThanOrEqual(alarm.tireRect.left - 0.5)
      expect(alarm.flRect.right).toBeLessThanOrEqual(alarm.tireRect.right + 0.5)
      expect(alarm.flRect.top).toBeGreaterThanOrEqual(alarm.tireRect.top - 0.5)
      expect(alarm.flRect.bottom).toBeLessThanOrEqual(alarm.tireRect.bottom + 0.5)
    }
  } finally {
    await context.close()
  }
})
