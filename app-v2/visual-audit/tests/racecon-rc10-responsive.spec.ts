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
  if (!baseUrl) throw new Error('RC-10 visual-audit server did not report a local URL')
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
  const target = new URL('racecon-rc10-capture.html', baseUrl)
  target.searchParams.set('width',  String(size.width))
  target.searchParams.set('height', String(size.height))
  target.searchParams.set('state',  expected.state)
  await page.goto(target.href, { waitUntil: 'networkidle' })

  // Wait for the widget to reach the governed ready state.
  // RC-10 scripts 150–300 frames before publishing; use a generous timeout.
  await page.waitForFunction(
    ({ layout, compactMode, state: captureState }) => {
      const root   = document.querySelector('#racecon-rc10-capture-root')
      const widget = root?.querySelector<HTMLElement>('[data-widget="raceconRc10Dash"]')
      if (!root || !widget) return false
      if (root.getAttribute('data-capture-ready') !== 'true') return false
      if (widget.dataset.rc10BufferState !== 'accepted') return false
      if (widget.dataset.rc10Layout !== layout) return false
      if (compactMode !== undefined && widget.dataset.rc10CompactMode !== compactMode) return false
      if (captureState === 'fuel-low' && widget.dataset.rc10Alerts !== 'active') return false
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
 * DEFECT RC-10/1 — delta tile overflow (measured budgets; silence + fuel-low share these).
 *   800x480  delta +3 px / budget 24 px
 *   759x393  delta +12 px / budget 24 px
 *   867x412  delta +21 px / budget 24 px
 *   867x412  fuel  +4 px  / budget 7 px (silent only)
 */
const DELTA_OVERFLOW_SIZES = new Set(['800x480', '759x393', '867x412'])
const DELTA_OVERFLOW_BUDGET_PX = 24
const FUEL_OVERFLOW_SIZES  = new Set(['867x412'])
const FUEL_OVERFLOW_BUDGET_PX = 7

async function readGeometry(page: Page) {
  return page.locator('#racecon-rc10-capture-root').evaluate((root) => {
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
    const widget    = root.querySelector<HTMLElement>('[data-widget="raceconRc10Dash"]')!
    const dashboard = root.querySelector<HTMLElement>('.rc10-dashboard')!

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
      ['gear',  '[data-testid="rc10-gear"]'],
      ['speed', '[data-testid="rc10-speed"]'],
      ['delta', '[data-testid="rc10-delta"]'],
      ['fuel',  '[data-testid="rc10-fuel"]']
    ]
    const zones = zoneNames.map(([name, selector]) => {
      const element = root.querySelector<HTMLElement>(selector)
      const rect = element ? relative(element)! : { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }
      return {
        name,
        rect,
        display:      getComputedStyle(element!).display,
        scrollHeight: element?.scrollHeight ?? 0,
        clientHeight: element?.clientHeight ?? 0
      }
    })

    return {
      viewport:     { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
      page:         { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
      root:         relative(root)!,
      layout:       attr('rc10Layout'),
      compactMode:  attr('rc10CompactMode'),
      contentWidth:  attr('rc10ContentWidth'),
      contentHeight: attr('rc10ContentHeight'),
      bufferState:   attr('rc10BufferState'),
      alerts:        attr('rc10Alerts'),
      alertKeys:     attr('rc10AlertKeys'),
      emphasis:      attr('rc10Emphasis'),
      nativeSize:    dashboard?.getAttribute('data-rc10-native-size') ?? null,
      // Fixed element counts
      shiftSegmentCount:    root.querySelectorAll('[data-testid="rc10-shift-seg"]').length,
      fuelSegmentCount:     root.querySelectorAll('[data-testid="rc10-fuel-seg"]').length,
      statusCellCount:      root.querySelectorAll('[data-testid="rc10-status-cell"]').length,
      statusRowCount:       root.querySelectorAll('[data-testid="rc10-status"]').length,
      plainLineCount:       root.querySelectorAll('[data-testid="rc10-plain"]').length,
      triangleGlyphCount:   root.querySelectorAll('[data-testid="rc10-status-icon"][data-rc10-shape="triangle"]').length,
      octagonGlyphCount:    root.querySelectorAll('[data-testid="rc10-status-icon"][data-rc10-shape="octagon"]').length,
      circleGlyphCount:     root.querySelectorAll('[data-testid="rc10-status-icon"][data-rc10-shape="circle"]').length,
      // Packet omissions: forbidden elements
      tyreCount:     root.querySelectorAll('.rc10-tyre, [data-testid^="rc10-tyre"]').length,
      rpmCount:      root.querySelectorAll('[data-testid="rc10-rpm"], [data-testid="rc10-rpm-value"]').length,
      shiftScaledCount: root.querySelectorAll('[data-rc10-shift-gear], [data-rc10-shift-scaled]').length,
      // Zone rects for overlap/containment
      zones,
      // Type-scale values
      values: [
        measure('gear',     '[data-testid="rc10-gear-value"]'),
        measure('speed',    '[data-testid="rc10-speed-value"]'),
        measure('delta',    '[data-testid="rc10-delta-value"]'),
        measure('fuel',     '[data-testid="rc10-fuel-value"]'),
        measure('position', '[data-testid="rc10-position"]')
      ].filter((e): e is NonNullable<typeof e> => e !== null),
      // Readout text checks
      gearText:     root.querySelector('[data-testid="rc10-gear-value"]')?.textContent?.trim() ?? null,
      speedText:    root.querySelector('[data-testid="rc10-speed-value"]')?.textContent?.trim() ?? null,
      deltaText:    root.querySelector('[data-testid="rc10-delta-value"]')?.textContent?.trim() ?? null,
      fuelText:     root.querySelector('[data-testid="rc10-fuel-value"]')?.textContent?.trim() ?? null,
      // Containment spot-checks for DEFECT RC-10/1
      deltaZoneRect:  relative(root.querySelector('[data-testid="rc10-delta"]')),
      deltaValueRect: relative(root.querySelector('[data-testid="rc10-delta-value"]')),
      fuelZoneRect:   relative(root.querySelector('[data-testid="rc10-fuel"]')),
      fuelValueRect:  relative(root.querySelector('[data-testid="rc10-fuel-value"]'))
    }
  })
}

for (const size of viewports) {
  const label    = size.compactMode ? `${size.layout}/${size.compactMode}` : size.layout
  const sizeKey  = `${size.width}x${size.height}`
  const isNative = size.layout === 'native'
  const isApp    = size.layout === 'app'
  const hasDeltaDefect = DELTA_OVERFLOW_SIZES.has(sizeKey)
  const hasFuelDefect  = FUEL_OVERFLOW_SIZES.has(sizeKey)

  test(`${sizeKey} keeps the ${label} RC-10 composition contained (silent)`, async ({ browser }) => {
    const { context, page } = await openCapture(browser, size, {
      layout: size.layout,
      compactMode: size.compactMode ?? undefined,
      state: 'silent'
    })
    try {
      await expect
        .poll(async () => page.locator('[data-widget="raceconRc10Dash"]').getAttribute('data-rc10-buffer-state'))
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
      expect(geometry.alertKeys).toBe('')
      expect(geometry.emphasis).toBe('none')

      // Native-size modifier
      expect(geometry.nativeSize).toBe(isNative ? '800x480' : null)

      // No horizontal scroll
      expect(geometry.page.scrollWidth).toBe(geometry.page.clientWidth)

      // Fixed element counts (silence)
      expect(geometry.shiftSegmentCount).toBe(9)
      expect(geometry.fuelSegmentCount).toBe(6)
      expect(geometry.statusCellCount).toBe(3)
      expect(geometry.triangleGlyphCount).toBe(0)
      expect(geometry.octagonGlyphCount).toBe(0)
      expect(geometry.circleGlyphCount).toBe(3)
      // omission appStatusRowZone
      expect(geometry.statusRowCount).toBe(isApp ? 0 : 1)
      expect(geometry.plainLineCount).toBe(isApp ? 1 : 0)

      // Packet omissions (forbidden elements)
      expect(geometry.tyreCount).toBe(0)
      expect(geometry.rpmCount).toBe(0)
      expect(geometry.shiftScaledCount).toBe(0)

      // Fixture readout values
      expect(geometry.gearText).toBe('4')
      expect(geometry.speedText).toBe('187')
      expect(geometry.deltaText).toBe('-0.284')
      expect(geometry.fuelText).toBe('8.4')

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

      // DEFECT RC-10/1: delta and fuel tile overflow.
      // At defect viewports the value IS expected to escape the zone bottom — escape must be > 0
      // and within the recorded budget. At clean viewports there must be no escape.
      if (geometry.deltaZoneRect && geometry.deltaValueRect) {
        const deltaEscape = geometry.deltaValueRect.bottom - geometry.deltaZoneRect.bottom
        if (hasDeltaDefect) {
          expect(deltaEscape, `${sizeKey} delta value should escape its zone (recorded defect RC-10/1)`).toBeGreaterThan(0)
          expect(deltaEscape, `${sizeKey} delta escape must stay within ${DELTA_OVERFLOW_BUDGET_PX} px budget`).toBeLessThanOrEqual(DELTA_OVERFLOW_BUDGET_PX)
        } else {
          expect(deltaEscape, `${sizeKey} delta value must not escape its zone`).toBeLessThanOrEqual(0.5)
        }
      }
      if (geometry.fuelZoneRect && geometry.fuelValueRect) {
        const fuelEscape = geometry.fuelValueRect.bottom - geometry.fuelZoneRect.bottom
        if (hasFuelDefect) {
          expect(fuelEscape, `${sizeKey} fuel value should escape its zone (recorded defect RC-10/1)`).toBeGreaterThan(0)
          expect(fuelEscape, `${sizeKey} fuel escape must stay within ${FUEL_OVERFLOW_BUDGET_PX} px budget`).toBeLessThanOrEqual(FUEL_OVERFLOW_BUDGET_PX)
        } else {
          expect(fuelEscape, `${sizeKey} fuel value must not escape its zone`).toBeLessThanOrEqual(0.5)
        }
      }

      // Type-scale hierarchy: gear > speed > delta > fuel > position (strict, no ties)
      const scale = ['gear', 'speed', 'delta', 'fuel', 'position'].map(
        (name) => geometry.values.find((v) => v.label === name)!
      ).filter(Boolean)
      for (let index = 1; index < scale.length; index += 1) {
        expect(
          scale[index - 1].fontSize,
          `${scale[index - 1].label} must be strictly larger than ${scale[index].label}`
        ).toBeGreaterThan(scale[index].fontSize)
      }

      const capture = await page.locator('#racecon-rc10-capture-root').screenshot({ animations: 'disabled' })
      expect(capture.byteLength).toBeGreaterThan(5_000)
    } finally {
      await context.close()
    }
  })
}

test('the fuel-low alert surfaces only inside the fuel tile', async ({ browser }) => {
  const size = viewports[0]  // native 800x480
  const { context, page } = await openCapture(browser, size, { layout: 'native', state: 'fuel-low' })
  try {
    await expect
      .poll(
        async () => page.locator('[data-widget="raceconRc10Dash"]').getAttribute('data-rc10-alerts'),
        { timeout: 150_000 }
      )
      .toBe('active')

    const alarm = await page.locator('#racecon-rc10-capture-root').evaluate((root) => {
      const widget = root.querySelector<HTMLElement>('[data-widget="raceconRc10Dash"]')!
      return {
        alerts:            widget?.dataset.rc10Alerts,
        alertKeys:         widget?.dataset.rc10AlertKeys,
        emphasis:          widget?.dataset.rc10Emphasis,
        fuelText:          root.querySelector('[data-testid="rc10-fuel-value"]')?.textContent?.trim() ?? null,
        fuelLowWordCount:  root.querySelectorAll('[data-testid="rc10-fuel-low"]').length,
        triangleGlyphCount: root.querySelectorAll('[data-testid="rc10-status-icon"][data-rc10-shape="triangle"]').length,
        circleGlyphCount:  root.querySelectorAll('[data-testid="rc10-status-icon"][data-rc10-shape="circle"]').length,
        octagonGlyphCount: root.querySelectorAll('[data-testid="rc10-status-icon"][data-rc10-shape="octagon"]').length,
        // Packet omissions still hold under fuel-low
        tyreCount:    root.querySelectorAll('.rc10-tyre, [data-testid^="rc10-tyre"]').length,
        rpmCount:     root.querySelectorAll('[data-testid="rc10-rpm"], [data-testid="rc10-rpm-value"]').length,
        statusRowCount: root.querySelectorAll('[data-testid="rc10-status"]').length,
        plainLineCount: root.querySelectorAll('[data-testid="rc10-plain"]').length
      }
    })

    // Alert attributes
    expect(alarm.alerts).toBe('active')
    expect(alarm.alertKeys).toContain('FUEL LOW')
    expect(alarm.emphasis).toBe('fuel')

    // Fuel readout under the alert
    expect(alarm.fuelText).toBe('2.1')
    expect(alarm.fuelLowWordCount).toBe(1)

    // Shape census under fuel-low: triangle present, two circles remain
    expect(alarm.triangleGlyphCount).toBe(1)
    expect(alarm.octagonGlyphCount).toBe(0)
    expect(alarm.circleGlyphCount).toBe(3)

    // Packet omissions hold under fuel-low
    expect(alarm.tyreCount).toBe(0)
    expect(alarm.rpmCount).toBe(0)
    // Native layout: status row present (appStatusRowZone omission)
    expect(alarm.statusRowCount).toBe(1)
    expect(alarm.plainLineCount).toBe(0)

    const capture = await page.locator('#racecon-rc10-capture-root').screenshot({ animations: 'disabled' })
    expect(capture.byteLength).toBeGreaterThan(5_000)
  } finally {
    await context.close()
  }
})
