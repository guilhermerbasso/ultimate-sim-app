import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { expect, test } from 'playwright/test'
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

const sizes = [
  { width: 800, height: 480, layout: 'native' },
  { width: 393, height: 759, layout: 'compact' },
  { width: 412, height: 867, layout: 'compact' }
] as const

for (const size of sizes) {
  test(`${size.width}x${size.height} keeps the tyre cue accessible and contained`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
      colorScheme: 'dark'
    })
    const page = await context.newPage()
    try {
      const target = new URL('racecon-rc01-capture.html', baseUrl)
      target.searchParams.set('width', String(size.width))
      target.searchParams.set('height', String(size.height))
      await page.goto(target.href, { waitUntil: 'networkidle' })
      await page.waitForFunction(({ layout }) => {
        const root = document.querySelector('#racecon-rc01-capture-root')
        const widget = root?.querySelector<HTMLElement>('[data-widget="raceconRc01Dash"]')
        return root?.getAttribute('data-capture-ready') === 'true' &&
          widget?.dataset.rc01Layout === layout
      }, { layout: size.layout })

      const geometry = await page.locator('#racecon-rc01-capture-root').evaluate((root, expected) => {
        const rootRect = root.getBoundingClientRect()
        const relative = (element: Element) => {
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
        const status = root.querySelector<HTMLElement>('.rc01-status')!
        const toggle = root.querySelector<HTMLButtonElement>('.rc01-status-toggle')!
        const metrics = Array.from(root.querySelectorAll<HTMLElement>('.rc01-status-grid .rc01-metric'))
        const fuelMetric = metrics.find((metric) => metric.querySelector('dt')?.textContent?.trim() === 'FUEL')!
        const positionMetric = metrics.find((metric) => metric.querySelector('dt')?.textContent?.trim() === 'POS')!
        const fuelValue = fuelMetric.querySelector<HTMLElement>('.rc01-value')!
        toggle.focus()
        const focus = getComputedStyle(toggle)
        const result = {
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            dpr: window.devicePixelRatio
          },
          layout: widget.dataset.rc01Layout,
          compactMode: widget.dataset.rc01CompactMode ?? null,
          status: relative(status),
          toggle: {
            ...relative(toggle),
            ariaLabel: toggle.getAttribute('aria-label'),
            beforeContent: getComputedStyle(toggle, '::before').content,
            afterContent: getComputedStyle(toggle, '::after').content,
            outlineStyle: focus.outlineStyle,
            outlineWidth: Number.parseFloat(focus.outlineWidth)
          },
          fuel: {
            text: fuelValue.textContent?.trim(),
            metric: relative(fuelMetric),
            value: relative(fuelValue)
          },
          position: relative(positionMetric),
          expected
        }
        toggle.blur()
        return result
      }, size)

      expect(geometry.viewport).toEqual({ width: size.width, height: size.height, dpr: 1 })
      expect(geometry.layout).toBe(size.layout)
      expect(geometry.toggle.width).toBeCloseTo(44, 2)
      expect(geometry.toggle.height).toBeCloseTo(44, 2)
      expect(geometry.toggle.ariaLabel).toBe('Show tyre summary')
      expect(geometry.toggle.beforeContent).not.toBe('none')
      expect(geometry.toggle.afterContent).not.toBe('none')
      expect(geometry.toggle.outlineStyle).toBe('solid')
      expect(geometry.toggle.outlineWidth).toBeGreaterThan(0)
      expect(geometry.toggle.left).toBeGreaterThanOrEqual(geometry.status.left)
      expect(geometry.toggle.top).toBeGreaterThanOrEqual(geometry.status.top)
      expect(geometry.toggle.right).toBeLessThanOrEqual(geometry.status.right + 0.02)
      expect(geometry.toggle.bottom).toBeLessThanOrEqual(geometry.status.bottom + 0.02)

      if (size.layout === 'compact') {
        const statusTop = Math.floor(size.height * 0.53)
        expect(geometry.compactMode).toBe('phone')
        expect(geometry.status.left).toBeCloseTo(12, 1)
        expect(geometry.status.top).toBeCloseTo(statusTop, 1)
        expect(geometry.status.width).toBeCloseTo(size.width - 24, 1)
        expect(geometry.status.height).toBeCloseTo(size.height - statusTop - 18, 1)
        expect(geometry.fuel.text).toBe('42.5 L')
        expect(geometry.fuel.value.left).toBeGreaterThanOrEqual(geometry.fuel.metric.left)
        expect(geometry.fuel.value.right).toBeLessThanOrEqual(geometry.fuel.metric.right + 0.02)
        expect(geometry.fuel.value.right).toBeLessThanOrEqual(geometry.status.right + 0.02)
        expect(geometry.position.right).toBeLessThanOrEqual(geometry.fuel.metric.left + 0.02)
      }
    } finally {
      await context.close()
    }
  })
}
