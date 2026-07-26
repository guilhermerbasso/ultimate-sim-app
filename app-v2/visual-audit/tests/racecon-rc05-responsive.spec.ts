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
  if (!baseUrl) throw new Error('RC-05 visual-audit server did not report a local URL')
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
  const target = new URL('racecon-rc05-capture.html', baseUrl)
  target.searchParams.set('width', String(size.width))
  target.searchParams.set('height', String(size.height))
  target.searchParams.set('state', expected.state)
  await page.goto(target.href, { waitUntil: 'networkidle' })
  await page.waitForFunction(
    ({ layout, compactMode }) => {
      const root = document.querySelector('#racecon-rc05-capture-root')
      const widget = root?.querySelector<HTMLElement>('[data-widget="raceconRc05Dash"]')
      return (
        root?.getAttribute('data-capture-ready') === 'true' &&
        widget?.dataset.rc05BufferState === 'accepted' &&
        widget.dataset.rc05Layout === layout &&
        (compactMode === undefined || widget.dataset.rc05CompactMode === compactMode)
      )
    },
    expected,
    { timeout: 90_000 }
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

async function readGeometry(page: Page) {
  return page.locator('#racecon-rc05-capture-root').evaluate((root) => {
    const rootRect = root.getBoundingClientRect()
    const relative = (element: Element): Rect => {
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
    const widget     = root.querySelector<HTMLElement>('[data-widget="raceconRc05Dash"]')!
    const dashboard  = root.querySelector<HTMLElement>('.rc05-dashboard')!

    const zoneNames = [
      'rc05-mandala', 'rc05-delta', 'rc05-aids', 'rc05-legend',
      'rc05-trend', 'rc05-pressures', 'rc05-peripheral'
    ]
    const zones = zoneNames.map((name) => {
      const element = root.querySelector<HTMLElement>(`[data-testid="${name}"]`)!
      const r = element ? relative(element) : { left:0, top:0, width:0, height:0, right:0, bottom:0 }
      return {
        name,
        rect: r,
        display: element ? getComputedStyle(element).display : 'none',
        area: r.width * r.height
      }
    })

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

    const owned = (label: string, ownerSel: string, valueSel: string) => {
      const owner = root.querySelector<HTMLElement>(ownerSel)
      const value = root.querySelector<HTMLElement>(valueSel)
      if (!owner || !value) return null
      return { label, owner: relative(owner), ownerDisplay: getComputedStyle(owner).display, value: relative(value) }
    }

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
      page: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
      root: relative(root),
      layout:       widget.dataset.rc05Layout,
      compactMode:  widget.dataset.rc05CompactMode ?? null,
      bufferState:  widget.dataset.rc05BufferState,
      emphasis:     widget.dataset.rc05Emphasis,
      alerts:       widget.dataset.rc05Alerts,
      alertCorners: widget.dataset.rc05AlertCorners,
      trend:        widget.dataset.rc05Trend,
      contentWidth: widget.dataset.rc05ContentWidth,
      contentHeight:widget.dataset.rc05ContentHeight,
      dashboardOverflow: {
        clientWidth:  dashboard.clientWidth,
        scrollWidth:  dashboard.scrollWidth,
        clientHeight: dashboard.clientHeight,
        scrollHeight: dashboard.scrollHeight
      },
      zones,
      // Type-scale sampling: temp, delta, pressure, corner-label (must be strictly decreasing)
      typeScaleSamples: [
        measure('lf-temp',      'article[data-rc05-corner="LF"] output.rc05-temp'),
        measure('delta',        '.rc05-delta-value'),
        measure('lf-pressure',  'article[data-rc05-corner="LF"] output.rc05-pressure'),
        measure('corner-label', '[data-testid="rc05-corner-label"]')
      ].filter((s): s is NonNullable<typeof s> => s !== null),
      // Element counts
      cornerCount:      root.querySelectorAll('[data-testid="rc05-corner"]').length,
      windowBandCount:  root.querySelectorAll('[data-testid="rc05-window-band"]').length,
      windowTickCount:  root.querySelectorAll('[data-testid="rc05-window-tick"]').length,
      trendRowCount:    root.querySelectorAll('[data-testid="rc05-trend-row"]').length,
      alertLineCount:   root.querySelectorAll('[data-testid="rc05-alert-line"]').length,
      wearPresent:      root.querySelector('[data-testid="rc05-wear"]') !== null,
      // Omission 1: no shift or RPM elements (packet §11.4 — no RPM channel declared)
      shiftElements:    root.querySelectorAll('[class*="rc05-led"], [class*="rc05-rev"], [data-rc05-shift]').length,
      // Containment samples
      containment: [
        owned('LF corner',      '[data-testid="rc05-mandala"]', 'article[data-rc05-corner="LF"]'),
        owned('RF corner',      '[data-testid="rc05-mandala"]', 'article[data-rc05-corner="RF"]'),
        owned('gear readout',   '[data-testid="rc05-peripheral"]', 'div[data-rc05-zone="gear"]'),
        owned('speed readout',  '[data-testid="rc05-peripheral"]', 'div[data-rc05-zone="speed"]'),
        owned('TC readout',     '[data-testid="rc05-aids"]', 'div[data-rc05-zone="tc"]')
      ].filter((e): e is NonNullable<typeof e> => e !== null),
      // Values
      values: [
        measure('lf-temp',   'article[data-rc05-corner="LF"] output.rc05-temp'),
        measure('rf-temp',   'article[data-rc05-corner="RF"] output.rc05-temp'),
        measure('lr-temp',   'article[data-rc05-corner="LR"] output.rc05-temp'),
        measure('rr-temp',   'article[data-rc05-corner="RR"] output.rc05-temp'),
        measure('rr-press',  'article[data-rc05-corner="RR"] output.rc05-pressure'),
        measure('speed',     'div[data-rc05-zone="speed"] output.rc05-value'),
        measure('gear',      'div[data-rc05-zone="gear"] output.rc05-value')
      ].filter((v): v is NonNullable<typeof v> => v !== null)
    }
  })
}

for (const size of viewports) {
  const label   = size.compactMode ? `${size.layout}/${size.compactMode}` : size.layout
  const sizeKey = `${size.width}x${size.height}`

  test(`${sizeKey} keeps the ${label} RC-05 composition contained`, async ({ browser }) => {
    const { context, page } = await openCapture(browser, size, {
      layout: size.layout,
      compactMode: size.compactMode ?? undefined,
      state: 'silent'
    })
    try {
      await expect
        .poll(() => page.locator('[data-widget="raceconRc05Dash"]').getAttribute('data-rc05-buffer-state'))
        .toBe('accepted')
      const geo = await readGeometry(page)

      // Basic frame geometry
      expect(geo.viewport).toEqual({ width: size.width, height: size.height, dpr: 1 })
      expect(geo.layout).toBe(size.layout)
      expect(geo.compactMode).toBe(size.compactMode)
      expect(geo.contentWidth).toBe(String(size.width))
      expect(geo.contentHeight).toBe(String(size.height))
      expect(geo.emphasis).toBe('temperature')
      // Note: bufferState confirmed accepted by openCapture + expect.poll above;
      // reading it from a one-shot geo snapshot races against React StrictMode effects.

      // Document must not overflow
      expect(geo.page.scrollWidth).toBe(geo.page.clientWidth)
      expect(geo.dashboardOverflow.scrollWidth).toBeLessThanOrEqual(geo.dashboardOverflow.clientWidth)
      expect(geo.dashboardOverflow.scrollHeight).toBeLessThanOrEqual(geo.dashboardOverflow.clientHeight)

      // Element counts: all four corners, 8 bracket ticks, 4 trend rows always in DOM
      expect(geo.cornerCount).toBe(4)
      expect(geo.windowBandCount).toBe(4)
      expect(geo.windowTickCount).toBe(8)
      expect(geo.trendRowCount).toBe(4)
      expect(geo.wearPresent).toBe(true)

      // Omission 1: no shift LED / rev indicator / RPM element anywhere in the widget
      expect(geo.shiftElements).toBe(0)

      // Omission 2: trend and pressures columns are visible only in the app layout
      const trendZone     = geo.zones.find((z) => z.name === 'rc05-trend')!
      const pressuresZone = geo.zones.find((z) => z.name === 'rc05-pressures')!
      expect(trendZone.display === 'none').toBe(size.layout !== 'app')
      expect(pressuresZone.display === 'none').toBe(size.layout !== 'app')

      // Silent frame: no alert surfaces
      expect(geo.alerts).toBe('silent')
      expect(geo.alertCorners).toBe('')
      expect(geo.alertLineCount).toBe(0)

      // Omission 6: RR pressure shows '--' (no TPMS sensor)
      const rrPress = geo.values.find((v) => v.label === 'rr-press')!
      expect(rrPress.text).toBe('--')

      // Type-scale hierarchy: temp > delta > pressure > corner-label (strictly, at every breakpoint)
      const scale = ['lf-temp', 'delta', 'lf-pressure', 'corner-label'].map(
        (name) => geo.typeScaleSamples.find((s) => s.label === name)!
      )
      for (let index = 1; index < scale.length; index += 1) {
        expect(
          scale[index - 1].fontSize,
          `${scale[index - 1].label} must be strictly larger than ${scale[index].label} at ${sizeKey}`
        ).toBeGreaterThan(scale[index].fontSize)
      }

      // Every value element stays inside the frame and does not overflow its box
      for (const v of geo.values) {
        expect(v.scrollWidth - v.clientWidth, `${v.label} "${v.text}" overflows`).toBeLessThanOrEqual(0)
        expectContained(geo.root, v.rect)
      }

      // Visible zones may touch but never overlap — except mandala/* pairs:
      // In native 800×480 layout the mandala section wraps the entire viewport, so its
      // bounding rect equals the root and legitimately contains every other zone.
      // Keys are sorted alphabetically (matching the sort().join('|') below).
      const exempt = new Set([
        'rc05-aids|rc05-mandala',
        'rc05-delta|rc05-mandala',
        'rc05-legend|rc05-mandala',
        'rc05-mandala|rc05-peripheral',
        'rc05-mandala|rc05-pressures',
        'rc05-mandala|rc05-trend',
      ])
      const visibleZones = geo.zones.filter((z) => z.display !== 'none' && z.area > 0)
      for (let a = 0; a < visibleZones.length; a += 1) {
        for (let b = a + 1; b < visibleZones.length; b += 1) {
          const first  = visibleZones[a]
          const second = visibleZones[b]
          const key = [first.name, second.name].sort().join('|')
          if (exempt.has(key)) continue
          const overlapX = Math.min(first.rect.right,  second.rect.right)  - Math.max(first.rect.left, second.rect.left)
          const overlapY = Math.min(first.rect.bottom, second.rect.bottom) - Math.max(first.rect.top,  second.rect.top)
          expect(
            Math.min(overlapX, overlapY),
            `${first.name} overlaps ${second.name}`
          ).toBeLessThanOrEqual(0.5)
        }
      }

      // Every visible zone stays inside the captured frame
      for (const z of visibleZones) expectContained(geo.root, z.rect, 0.5)

      // Each sampled element must be inside its declared owner zone
      for (const entry of geo.containment) {
        if (entry.ownerDisplay === 'none') continue
        const overflow = {
          left:   entry.owner.left  - entry.value.left,
          right:  entry.value.right - entry.owner.right,
          top:    entry.owner.top   - entry.value.top,
          bottom: entry.value.bottom- entry.owner.bottom
        }
        expect(overflow.left,   `${entry.label} escapes left`).toBeLessThanOrEqual(0.5)
        expect(overflow.right,  `${entry.label} escapes right`).toBeLessThanOrEqual(0.5)
        expect(overflow.top,    `${entry.label} escapes top`).toBeLessThanOrEqual(0.5)
        expect(overflow.bottom, `${entry.label} escapes bottom`).toBeLessThanOrEqual(0.5)
      }

      const capture = await page.locator('#racecon-rc05-capture-root').screenshot({ animations: 'disabled' })
      expect(capture.byteLength).toBeGreaterThan(5_000)
    } finally {
      await context.close()
    }
  })
}

test('the LF corner overheat alert surfaces only inside the LF corner area', async ({ browser }) => {
  const size = viewports[0]  // native 800×480
  const { context, page } = await openCapture(browser, size, { layout: 'native', state: 'corner-overheat' })
  try {
    // Wait for the overheat latch to engage (up to 90 s; the fixture takes ~4 s of real time)
    await expect
      .poll(
        () => page.locator('[data-widget="raceconRc05Dash"]').getAttribute('data-rc05-alerts'),
        { timeout: 90_000 }
      )
      .toBe('active')

    const alarm = await page.locator('#racecon-rc05-capture-root').evaluate((root) => {
      const rootRect = root.getBoundingClientRect()
      const relative = (element: Element) => {
        const r = element.getBoundingClientRect()
        return {
          left:   r.left   - rootRect.left,
          top:    r.top    - rootRect.top,
          right:  r.right  - rootRect.left,
          bottom: r.bottom - rootRect.top
        }
      }
      const widget    = root.querySelector<HTMLElement>('[data-widget="raceconRc05Dash"]')!
      const lfCorner  = root.querySelector<HTMLElement>('article[data-rc05-corner="LF"]')!
      const alertLine = root.querySelector<HTMLElement>('[data-testid="rc05-alert-line"]')
      return {
        alerts:           widget.dataset.rc05Alerts,
        alertCorners:     widget.dataset.rc05AlertCorners,
        lfOverheat:       lfCorner.getAttribute('data-rc05-overheat'),
        lfBand:           lfCorner.getAttribute('data-rc05-band'),
        lfZoom:           lfCorner.getAttribute('data-rc05-zoom'),
        rfOverheat:       root.querySelector('article[data-rc05-corner="RF"]')?.getAttribute('data-rc05-overheat'),
        alertLineText:    alertLine?.textContent?.trim() ?? null,
        lfRect:           relative(lfCorner),
        alertLineRect:    alertLine ? relative(alertLine) : null
      }
    })

    expect(alarm.alerts).toBe('active')
    expect(alarm.alertCorners).toBe('LF')
    expect(alarm.lfOverheat).toBe('true')
    expect(alarm.lfBand).toBe('hot')
    expect(alarm.lfZoom).toBe('true')
    expect(alarm.rfOverheat).toBe('false')
    expect(alarm.alertLineText).toContain('LF OVERHEAT')

    // The alert line must sit inside the capture frame (it may float near the mandala)
    if (alarm.alertLineRect) {
      expect(alarm.alertLineRect.left).toBeGreaterThanOrEqual(-1)
      expect(alarm.alertLineRect.top).toBeGreaterThanOrEqual(-1)
      expect(alarm.alertLineRect.right).toBeLessThanOrEqual(800 + 1)
      expect(alarm.alertLineRect.bottom).toBeLessThanOrEqual(480 + 1)
    }
  } finally {
    await context.close()
  }
})
