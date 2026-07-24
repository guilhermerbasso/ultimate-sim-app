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
  if (!baseUrl) throw new Error('RC-01 visual-audit server did not report a local URL')
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

function expectContained(outer: Rect, inner: Rect, tolerance = 0.05): void {
  expect(inner.left).toBeGreaterThanOrEqual(outer.left - tolerance)
  expect(inner.top).toBeGreaterThanOrEqual(outer.top - tolerance)
  expect(inner.right).toBeLessThanOrEqual(outer.right + tolerance)
  expect(inner.bottom).toBeLessThanOrEqual(outer.bottom + tolerance)
}

async function openCapture(
  browser: Browser,
  size: { width: number; height: number },
  expected: { layout: 'native' | 'app' | 'compact'; compactMode?: 'phone' | 'landscape' }
): Promise<{ context: Awaited<ReturnType<Browser['newContext']>>; page: Page }> {
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'dark'
  })
  const page = await context.newPage()
  const target = new URL('racecon-rc01-capture.html', baseUrl)
  target.searchParams.set('width', String(size.width))
  target.searchParams.set('height', String(size.height))
  await page.goto(target.href, { waitUntil: 'networkidle' })
  await page.waitForFunction(({ layout, compactMode }) => {
    const root = document.querySelector('#racecon-rc01-capture-root')
    const widget = root?.querySelector<HTMLElement>('[data-widget="raceconRc01Dash"]')
    return root?.getAttribute('data-capture-ready') === 'true' &&
      widget?.dataset.rc01BufferState === 'accepted' &&
      widget.dataset.rc01Layout === layout &&
      (compactMode === undefined || widget.dataset.rc01CompactMode === compactMode)
  }, expected)
  return { context, page }
}

const establishedSizes = [
  { width: 800, height: 480, layout: 'native', compactMode: null, railDisplay: 'none' },
  { width: 1024, height: 600, layout: 'app', compactMode: null, railDisplay: 'flex' }
] as const

for (const size of establishedSizes) {
  test(`${size.width}x${size.height} preserves its established composition`, async ({ browser }) => {
    const { context, page } = await openCapture(browser, size, { layout: size.layout })
    try {
      const geometry = await page.locator('#racecon-rc01-capture-root').evaluate((root) => {
        const rootRect = root.getBoundingClientRect()
        const relative = (element: Element): Rect => {
          const rect = element.getBoundingClientRect()
          return {
            left: rect.left - rootRect.left,
            top: rect.top - rootRect.top,
            width: rect.width,
            height: rect.height,
            right: rect.right - rootRect.left,
            bottom: rect.bottom - rootRect.top
          }
        }
        const widget = root.querySelector<HTMLElement>('[data-widget="raceconRc01Dash"]')!
        const dashboard = root.querySelector<HTMLElement>('.rc01-dashboard')!
        const status = root.querySelector<HTMLElement>('.rc01-status')!
        const toggle = root.querySelector<HTMLButtonElement>('.rc01-status-toggle')!
        const rail = root.querySelector<HTMLElement>('.rc01-attack-rail')!
        const heroes = Array.from(root.querySelectorAll<HTMLElement>('[data-rc01-hero-zone]')).map((zone) => relative(zone))
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
          root: relative(root),
          layout: widget.dataset.rc01Layout,
          compactMode: widget.dataset.rc01CompactMode ?? null,
          dashboardOverflow: { clientWidth: dashboard.clientWidth, scrollWidth: dashboard.scrollWidth, clientHeight: dashboard.clientHeight, scrollHeight: dashboard.scrollHeight },
          status: relative(status),
          toggle: { ...relative(toggle), display: getComputedStyle(toggle).display },
          railDisplay: getComputedStyle(rail).display,
          heroes
        }
      })

      expect(geometry.viewport).toEqual({ width: size.width, height: size.height, dpr: 1 })
      expect(geometry.layout).toBe(size.layout)
      expect(geometry.compactMode).toBe(size.compactMode)
      expect(geometry.railDisplay).toBe(size.railDisplay)
      expect(geometry.dashboardOverflow.scrollWidth).toBeLessThanOrEqual(geometry.dashboardOverflow.clientWidth)
      expect(geometry.dashboardOverflow.scrollHeight).toBeLessThanOrEqual(geometry.dashboardOverflow.clientHeight)
      for (const hero of geometry.heroes) expectContained(geometry.root, hero)
      expectContained(geometry.root, geometry.status)
      if (size.layout === 'native') {
        expect(geometry.toggle.display).not.toBe('none')
        expect(geometry.toggle.width).toBeCloseTo(44, 2)
        expect(geometry.toggle.height).toBeCloseTo(44, 2)
        expectContained(geometry.status, geometry.toggle)
      } else {
        expect(geometry.toggle.display).toBe('none')
      }
    } finally {
      await context.close()
    }
  })
}

const phoneSizes = [
  { width: 393, height: 759 },
  { width: 412, height: 867 }
] as const

for (const size of phoneSizes) {
  test(`${size.width}x${size.height} tyre summary uses contained two-column status geometry`, async ({ browser }) => {
    const { context, page } = await openCapture(browser, size, { layout: 'compact', compactMode: 'phone' })
    try {
      const toggleLocator = page.locator('.rc01-status-toggle')
      await expect(toggleLocator).toHaveAttribute('aria-label', 'Show tyre summary')
      await toggleLocator.click()
      await expect(toggleLocator).toHaveAttribute('aria-label', 'Show fuel status')
      await expect.poll(async () => page.locator('.rc01-status-grid').evaluate((grid) => grid.getBoundingClientRect().width))
        .toBeCloseTo((size.width - 24) * 0.44, 1)
      await toggleLocator.blur()
      await page.keyboard.press('Tab')
      await toggleLocator.focus()
      await expect(toggleLocator).toBeFocused()

      const geometry = await page.locator('#racecon-rc01-capture-root').evaluate((root) => {
        const rootRect = root.getBoundingClientRect()
        const relative = (element: Element): Rect => {
          const rect = element.getBoundingClientRect()
          return {
            left: rect.left - rootRect.left,
            top: rect.top - rootRect.top,
            width: rect.width,
            height: rect.height,
            right: rect.right - rootRect.left,
            bottom: rect.bottom - rootRect.top
          }
        }
        const measured = (element: HTMLElement) => ({
          ...relative(element),
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight
        })
        const textRect = (element: HTMLElement): Rect => {
          const range = document.createRange()
          range.selectNodeContents(element)
          const rect = range.getBoundingClientRect()
          return {
            left: rect.left - rootRect.left,
            top: rect.top - rootRect.top,
            width: rect.width,
            height: rect.height,
            right: rect.right - rootRect.left,
            bottom: rect.bottom - rootRect.top
          }
        }
        const widget = root.querySelector<HTMLElement>('[data-widget="raceconRc01Dash"]')!
        const dashboard = root.querySelector<HTMLElement>('.rc01-dashboard')!
        const status = root.querySelector<HTMLElement>('.rc01-status')!
        const statusGrid = root.querySelector<HTMLElement>('.rc01-status-grid')!
        const tyreGrid = root.querySelector<HTMLElement>('.rc01-tyre-grid')!
        const toggle = root.querySelector<HTMLButtonElement>('.rc01-status-toggle')!
        const metrics = Array.from(statusGrid.querySelectorAll<HTMLElement>('.rc01-metric'))
        const metric = (label: string) => metrics.find((item) => item.querySelector('dt')?.textContent?.trim() === label)!
        const position = metric('POS')
        const positionValue = position.querySelector<HTMLElement>('.rc01-value')!
        const tc = metric('TC')
        const fuel = metric('FUEL')
        const focus = getComputedStyle(toggle)
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
          layout: widget.dataset.rc01Layout,
          compactMode: widget.dataset.rc01CompactMode ?? null,
          detailTyres: dashboard.classList.contains('rc01-detail-tyres'),
          detailModifier: dashboard.dataset.rc01Detail,
          root: relative(root),
          status: relative(status),
          statusGrid: {
            ...measured(statusGrid),
            columns: getComputedStyle(statusGrid).gridTemplateColumns.trim().split(/\s+/u).filter(Boolean)
          },
          tyreGrid: { ...measured(tyreGrid), display: getComputedStyle(tyreGrid).display },
          toggle: {
            ...relative(toggle),
            ariaLabel: toggle.getAttribute('aria-label'),
            beforeContent: getComputedStyle(toggle, '::before').content,
            afterContent: getComputedStyle(toggle, '::after').content,
            outlineStyle: focus.outlineStyle,
            outlineWidth: Number.parseFloat(focus.outlineWidth)
          },
          tc: measured(tc),
          position: {
            ...measured(position),
            text: positionValue.textContent?.trim(),
            value: measured(positionValue),
            textRect: textRect(positionValue)
          },
          fuelDisplay: getComputedStyle(fuel).display,
          tyreValues: Array.from(tyreGrid.querySelectorAll<HTMLElement>('.rc01-value')).map((value) => measured(value))
        }
      })

      expect(geometry.viewport).toEqual({ width: size.width, height: size.height, dpr: 1 })
      expect(geometry.layout).toBe('compact')
      expect(geometry.compactMode).toBe('phone')
      expect(geometry.detailTyres).toBe(true)
      expect(geometry.detailModifier).toBe('tyres')
      expect(geometry.status.left).toBeCloseTo(12, 1)
      expect(geometry.status.top).toBeCloseTo(Math.floor(size.height * 0.53), 1)
      expect(geometry.status.width).toBeCloseTo(size.width - 24, 1)
      expect(geometry.status.height).toBeCloseTo(size.height - Math.floor(size.height * 0.53) - 18, 1)
      expect(geometry.statusGrid.columns).toHaveLength(2)
      expect(geometry.statusGrid.width).toBeCloseTo(geometry.status.width * 0.44, 1)
      expect(geometry.statusGrid.scrollWidth).toBeLessThanOrEqual(geometry.statusGrid.clientWidth)
      expect(geometry.statusGrid.scrollHeight).toBeLessThanOrEqual(geometry.statusGrid.clientHeight)
      expect(geometry.fuelDisplay).toBe('none')
      expect(geometry.position.text).toBe('P02')
      expect(geometry.position.scrollWidth).toBeLessThanOrEqual(geometry.position.clientWidth)
      expect(geometry.position.value.scrollWidth).toBeLessThanOrEqual(geometry.position.value.clientWidth)
      expectContained(geometry.statusGrid, geometry.tc)
      expectContained(geometry.statusGrid, geometry.position)
      expectContained(geometry.position, geometry.position.textRect)
      expectContained(geometry.status, geometry.position.textRect)
      expect(geometry.tyreGrid.display).toBe('grid')
      expectContained(geometry.status, geometry.tyreGrid)
      for (const tyreValue of geometry.tyreValues) {
        expect(tyreValue.scrollWidth).toBeLessThanOrEqual(tyreValue.clientWidth)
        expectContained(geometry.status, tyreValue)
      }
      expect(geometry.toggle.width).toBeCloseTo(44, 2)
      expect(geometry.toggle.height).toBeCloseTo(44, 2)
      expect(geometry.toggle.ariaLabel).toBe('Show fuel status')
      expect(geometry.toggle.beforeContent).not.toBe('none')
      expect(geometry.toggle.afterContent).not.toBe('none')
      expect(geometry.toggle.outlineStyle).toBe('solid')
      expect(geometry.toggle.outlineWidth).toBeGreaterThan(0)
      expectContained(geometry.status, geometry.toggle)

      const capture = await page.locator('#racecon-rc01-capture-root').screenshot({ animations: 'disabled' })
      expect(capture.byteLength).toBeGreaterThan(5_000)
    } finally {
      await context.close()
    }
  })
}

const landscapeSizes = [
  { width: 759, height: 393 },
  { width: 867, height: 412 }
] as const

for (const size of landscapeSizes) {
  test(`${size.width}x${size.height} contains RPM and keeps landscape hierarchy and controls visible`, async ({ browser }) => {
    const { context, page } = await openCapture(browser, size, { layout: 'compact', compactMode: 'landscape' })
    try {
      const geometry = await page.locator('#racecon-rc01-capture-root').evaluate((root) => {
        const rootRect = root.getBoundingClientRect()
        const relative = (element: Element): Rect => {
          const rect = element.getBoundingClientRect()
          return {
            left: rect.left - rootRect.left,
            top: rect.top - rootRect.top,
            width: rect.width,
            height: rect.height,
            right: rect.right - rootRect.left,
            bottom: rect.bottom - rootRect.top
          }
        }
        const textRect = (element: HTMLElement): Rect => {
          const range = document.createRange()
          range.selectNodeContents(element)
          const rect = range.getBoundingClientRect()
          return {
            left: rect.left - rootRect.left,
            top: rect.top - rootRect.top,
            width: rect.width,
            height: rect.height,
            right: rect.right - rootRect.left,
            bottom: rect.bottom - rootRect.top
          }
        }
        const hero = (name: 'speed' | 'gear' | 'rpm') => {
          const zone = root.querySelector<HTMLElement>(`.rc01-${name}`)!
          const value = zone.querySelector<HTMLElement>('.rc01-value')!
          return {
            zone: relative(zone),
            value: relative(value),
            textRect: textRect(value),
            text: value.textContent?.trim(),
            fontSize: Number.parseFloat(getComputedStyle(value).fontSize),
            clientWidth: value.clientWidth,
            scrollWidth: value.scrollWidth,
            clientHeight: value.clientHeight,
            scrollHeight: value.scrollHeight
          }
        }
        const widget = root.querySelector<HTMLElement>('[data-widget="raceconRc01Dash"]')!
        const dashboard = root.querySelector<HTMLElement>('.rc01-dashboard')!
        const status = root.querySelector<HTMLElement>('.rc01-status')!
        const delta = root.querySelector<HTMLElement>('.rc01-delta')!
        const toggle = root.querySelector<HTMLButtonElement>('.rc01-status-toggle')!
        const ledArc = root.querySelector<HTMLElement>('.rc01-led-arc')!
        const metricValues = Array.from(status.querySelectorAll<HTMLElement>('.rc01-status-grid .rc01-value')).map((value) => ({
          ...relative(value),
          clientWidth: value.clientWidth,
          scrollWidth: value.scrollWidth
        }))
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
          root: relative(root),
          layout: widget.dataset.rc01Layout,
          compactMode: widget.dataset.rc01CompactMode ?? null,
          contentWidth: widget.dataset.rc01ContentWidth,
          contentHeight: widget.dataset.rc01ContentHeight,
          overflow: {
            clientWidth: dashboard.clientWidth,
            scrollWidth: dashboard.scrollWidth,
            clientHeight: dashboard.clientHeight,
            scrollHeight: dashboard.scrollHeight
          },
          speed: hero('speed'),
          gear: hero('gear'),
          rpm: hero('rpm'),
          delta: relative(delta),
          status: relative(status),
          ledArc: relative(ledArc),
          toggle: {
            ...relative(toggle),
            display: getComputedStyle(toggle).display,
            ariaLabel: toggle.getAttribute('aria-label')
          },
          metricValues
        }
      })

      expect(geometry.viewport).toEqual({ width: size.width, height: size.height, dpr: 1 })
      expect(geometry.layout).toBe('compact')
      expect(geometry.compactMode).toBe('landscape')
      expect(geometry.contentWidth).toBe(String(size.width))
      expect(geometry.contentHeight).toBe(String(size.height))
      expect(geometry.overflow.scrollWidth).toBeLessThanOrEqual(geometry.overflow.clientWidth)
      expect(geometry.overflow.scrollHeight).toBeLessThanOrEqual(geometry.overflow.clientHeight)
      expect(geometry.rpm.text).toBe('9,600')
      expect(geometry.rpm.scrollWidth).toBeLessThanOrEqual(geometry.rpm.clientWidth)
      expect(geometry.rpm.scrollHeight).toBeLessThanOrEqual(geometry.rpm.clientHeight)
      expectContained(geometry.rpm.zone, geometry.rpm.value)
      expectContained(geometry.rpm.zone, geometry.rpm.textRect)
      expectContained(geometry.speed.zone, geometry.speed.textRect)
      expectContained(geometry.gear.zone, geometry.gear.textRect)
      expect(geometry.gear.fontSize).toBeGreaterThanOrEqual(geometry.speed.fontSize * 1.5)
      expect(geometry.gear.fontSize).toBeGreaterThanOrEqual(geometry.rpm.fontSize * 1.5)
      expectContained(geometry.root, geometry.speed.zone)
      expectContained(geometry.root, geometry.gear.zone)
      expectContained(geometry.root, geometry.rpm.zone)
      expectContained(geometry.root, geometry.delta)
      expectContained(geometry.root, geometry.status)
      expectContained(geometry.root, geometry.ledArc)
      expect(geometry.toggle.display).not.toBe('none')
      expect(geometry.toggle.width).toBeCloseTo(44, 2)
      expect(geometry.toggle.height).toBeCloseTo(44, 2)
      expect(geometry.toggle.ariaLabel).toBe('Show tyre summary')
      expectContained(geometry.status, geometry.toggle)
      for (const value of geometry.metricValues) {
        expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth)
        expectContained(geometry.status, value)
      }

      const capture = await page.locator('#racecon-rc01-capture-root').screenshot({ animations: 'disabled' })
      expect(capture.byteLength).toBeGreaterThan(5_000)
    } finally {
      await context.close()
    }
  })
}
