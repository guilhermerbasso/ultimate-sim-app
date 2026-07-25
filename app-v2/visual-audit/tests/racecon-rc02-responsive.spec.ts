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
  if (!baseUrl) throw new Error('RC-02 visual-audit server did not report a local URL')
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

interface TextBox extends Rect {
  label: string
  text: string
  clientWidth: number
  scrollWidth: number
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
  const target = new URL('racecon-rc02-capture.html', baseUrl)
  target.searchParams.set('width', String(size.width))
  target.searchParams.set('height', String(size.height))
  await page.goto(target.href, { waitUntil: 'networkidle' })
  await page.waitForFunction(({ layout, compactMode }) => {
    const root = document.querySelector('#racecon-rc02-capture-root')
    const widget = root?.querySelector<HTMLElement>('[data-widget="raceconRc02Dash"]')
    return root?.getAttribute('data-capture-ready') === 'true' &&
      widget?.dataset.rc02BufferState === 'accepted' &&
      widget.dataset.rc02Layout === layout &&
      (compactMode === undefined || widget.dataset.rc02CompactMode === compactMode)
  }, expected)
  return { context, page }
}

const viewports = [
  { width: 800, height: 480, layout: 'native', compactMode: null },
  { width: 1024, height: 600, layout: 'app', compactMode: null },
  { width: 393, height: 759, layout: 'compact', compactMode: 'phone' },
  { width: 412, height: 867, layout: 'compact', compactMode: 'phone' },
  { width: 759, height: 393, layout: 'compact', compactMode: 'landscape' },
  { width: 867, height: 412, layout: 'compact', compactMode: 'landscape' }
] as const

for (const size of viewports) {
  const label = size.compactMode ? `${size.layout}/${size.compactMode}` : size.layout

  test(`${size.width}x${size.height} keeps the ${label} RC-02 composition contained`, async ({ browser }) => {
    const { context, page } = await openCapture(browser, size, {
      layout: size.layout,
      compactMode: size.compactMode ?? undefined
    })
    try {
      // The widget re-renders on its own freshness tick, which reports the repeated frame as a
      // duplicate, so the accepted-frame gate is polled rather than sampled once.
      await expect
        .poll(async () => page.locator('[data-widget="raceconRc02Dash"]').getAttribute('data-rc02-buffer-state'))
        .toBe('accepted')
      const geometry = await page.locator('#racecon-rc02-capture-root').evaluate((root) => {
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
        const textBox = (label: string, element: HTMLElement | null): TextBox | null =>
          element
            ? {
                ...relative(element),
                label,
                text: element.textContent?.trim() ?? '',
                clientWidth: element.clientWidth,
                scrollWidth: element.scrollWidth
              }
            : null

        const widget = root.querySelector<HTMLElement>('[data-widget="raceconRc02Dash"]')!
        const dashboard = root.querySelector<HTMLElement>('.rc02-dashboard')!
        const sectorsZone = root.querySelector<HTMLElement>('.rc02-sectors')!
        const ladder = root.querySelector<HTMLElement>('[data-testid="rc02-ladder"]')!
        const ladderNow = root.querySelector<HTMLElement>('[data-testid="rc02-ladder-now"]')!
        const spineZone = root.querySelector<HTMLElement>('.rc02-spine')!
        const star = root.querySelector<HTMLElement>('[data-testid="rc02-spine-star"]')
        const zoneNames = ['rc02-head', 'rc02-spine', 'rc02-sectors', 'rc02-speed', 'rc02-tyres', 'rc02-targets', 'rc02-ladder']
        const zones = zoneNames.map((name) => {
          const element = root.querySelector<HTMLElement>(`.${name}`)!
          const rect = relative(element)
          return { name, rect, display: getComputedStyle(element).display, area: rect.width * rect.height }
        })
        const owned = (label: string, ownerSelector: string, element: Element | null) => {
          const owner = root.querySelector<HTMLElement>(ownerSelector)!
          return element
            ? { label, owner: relative(owner), ownerDisplay: getComputedStyle(owner).display, value: relative(element) }
            : null
        }
        const containment = [
          owned('delta', '.rc02-spine', root.querySelector('.rc02-spine-value')),
          owned('gear', '.rc02-head', root.querySelector('.rc02-gear')),
          owned('speed', '.rc02-speed', root.querySelector('.rc02-speed .rc02-value')),
          owned('PRED', '.rc02-targets', root.querySelector('[data-testid="rc02-pred"] .rc02-value')),
          owned('BEST', '.rc02-targets', root.querySelector('[data-testid="rc02-best"] .rc02-value')),
          ...Array.from(root.querySelectorAll<HTMLElement>('[data-testid="rc02-sector"]')).map((sector) =>
            owned(`sector ${sector.getAttribute('data-sector')}`, '.rc02-sectors', sector.querySelector('.rc02-value'))
          )
        ].filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        const track = root.querySelector<HTMLElement>('[data-testid="rc02-spine-track"]')!
        const datum = root.querySelector<HTMLElement>('[data-testid="rc02-spine-datum"]')!
        const sectors = Array.from(root.querySelectorAll<HTMLElement>('[data-testid="rc02-sector"]'))
        const values: Array<TextBox | null> = [
          textBox('delta', root.querySelector<HTMLElement>('.rc02-spine-value')),
          textBox('gear', root.querySelector<HTMLElement>('.rc02-gear')),
          textBox('speed', root.querySelector<HTMLElement>('.rc02-speed .rc02-value')),
          textBox('PRED', root.querySelector<HTMLElement>('[data-testid="rc02-pred"] .rc02-value')),
          textBox('BEST', root.querySelector<HTMLElement>('[data-testid="rc02-best"] .rc02-value')),
          ...sectors.map((sector) =>
            textBox(sector.getAttribute('data-sector') ?? 'sector', sector.querySelector<HTMLElement>('.rc02-value'))
          )
        ]

        return {
          viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
          page: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
          root: relative(root),
          layout: widget.dataset.rc02Layout,
          compactMode: widget.dataset.rc02CompactMode ?? null,
          contentWidth: widget.dataset.rc02ContentWidth,
          contentHeight: widget.dataset.rc02ContentHeight,
          ledCount: root.querySelectorAll('[data-testid="rc02-led"]').length,
          sectorCount: sectors.length,
          sectorLabels: sectors.map((sector) => sector.getAttribute('data-sector')),
          dashboardOverflow: {
            clientWidth: dashboard.clientWidth,
            scrollWidth: dashboard.scrollWidth,
            clientHeight: dashboard.clientHeight,
            scrollHeight: dashboard.scrollHeight
          },
          sectorsDisplay: getComputedStyle(sectorsZone).display,
          ladderDisplay: getComputedStyle(ladder).display,
          ladder: relative(ladder),
          ladderNow: relative(ladderNow),
          ladderNowSectorCount: root.querySelectorAll('[data-testid="rc02-ladder-now-sector"]').length,
          ladderRows: Array.from(root.querySelectorAll<HTMLElement>('.rc02-ladder-row')).map((row) =>
            Array.from(row.children).map((cell) => ({
              text: cell.textContent?.trim() ?? '',
              clientWidth: cell.clientWidth,
              scrollWidth: cell.scrollWidth
            }))
          ),
          track: relative(track),
          spineZone: relative(spineZone),
          star: star ? relative(star) : null,
          zones,
          containment,
          datum: relative(datum),
          values: values.filter((value): value is TextBox => value !== null)
        }
      })

      expect(geometry.viewport).toEqual({ width: size.width, height: size.height, dpr: 1 })
      expect(geometry.layout).toBe(size.layout)
      expect(geometry.compactMode).toBe(size.compactMode)
      expect(geometry.contentWidth).toBe(String(size.width))
      expect(geometry.contentHeight).toBe(String(size.height))

      expect(geometry.ledCount).toBe(9)
      expect(geometry.sectorCount).toBe(3)
      expect(geometry.sectorLabels).toEqual(['S1', 'S2', 'S3'])

      // The bidirectional spine only reads truthfully when its datum is the exact middle.
      const trackCentre = geometry.track.top + geometry.track.height / 2
      const datumCentre = geometry.datum.top + geometry.datum.height / 2
      expect(Math.abs(datumCentre - trackCentre)).toBeLessThanOrEqual(1)
      expectContained(geometry.track, geometry.datum)

      expect(geometry.page.scrollWidth).toBe(geometry.page.clientWidth)
      expect(geometry.dashboardOverflow.scrollWidth).toBeLessThanOrEqual(geometry.dashboardOverflow.clientWidth)
      expect(geometry.dashboardOverflow.scrollHeight).toBeLessThanOrEqual(geometry.dashboardOverflow.clientHeight)

      expect(geometry.values).toHaveLength(8)
      for (const value of geometry.values) {
        expect(value.scrollWidth, `${value.label} "${value.text}" must fit its box`).toBeLessThanOrEqual(value.clientWidth)
        expectContained(geometry.root, value)
      }

      // A measured box may never leave the zone that owns it: `scrollWidth` cannot see this
      // class of overflow because `white-space: nowrap` sizes the box to its own text.
      for (const entry of geometry.containment) {
        if (entry.ownerDisplay === 'none') continue
        const overflow = {
          left: +(entry.owner.left - entry.value.left).toFixed(2),
          right: +(entry.value.right - entry.owner.right).toFixed(2),
          top: +(entry.owner.top - entry.value.top).toFixed(2),
          bottom: +(entry.value.bottom - entry.owner.bottom).toFixed(2)
        }
        expect(overflow.left, `${entry.label} escapes its zone on the left`).toBeLessThanOrEqual(0.5)
        expect(overflow.right, `${entry.label} escapes its zone on the right`).toBeLessThanOrEqual(0.5)
        expect(overflow.top, `${entry.label} escapes its zone at the top`).toBeLessThanOrEqual(0.5)
        expect(overflow.bottom, `${entry.label} escapes its zone at the bottom`).toBeLessThanOrEqual(0.5)
      }

      // Visible zones may touch but never overlap.
      const visibleZones = geometry.zones.filter((zone) => zone.display !== 'none' && zone.area > 0)
      for (let a = 0; a < visibleZones.length; a += 1) {
        for (let b = a + 1; b < visibleZones.length; b += 1) {
          const first = visibleZones[a]
          const second = visibleZones[b]
          const overlapX = Math.min(first.rect.right, second.rect.right) - Math.max(first.rect.left, second.rect.left)
          const overlapY = Math.min(first.rect.bottom, second.rect.bottom) - Math.max(first.rect.top, second.rect.top)
          const overlap = Math.min(overlapX, overlapY)
          expect(overlap, `${first.name} overlaps ${second.name} by ${overlapX.toFixed(2)}x${overlapY.toFixed(2)}px`)
            .toBeLessThanOrEqual(0.5)
        }
      }

      // The personal-best star is a track ornament and may not overhang a neighbouring zone.
      expect(geometry.star).not.toBeNull()
      expectContained(geometry.track, geometry.star!, 0.5)

      // The bar keeps the packet's 120px spine zone even though the section hosts the numeral.
      const trackMidX = geometry.track.left + geometry.track.width / 2
      const spineMidX = geometry.spineZone.left + geometry.spineZone.width / 2
      expect(Math.abs(trackMidX - spineMidX)).toBeLessThanOrEqual(1)
      if (size.layout === 'native' || size.layout === 'app') {
        expect(geometry.track.width).toBeGreaterThanOrEqual(115)
        expect(geometry.track.width).toBeLessThanOrEqual(125)
      }

      // The sector column and the sector-history ladder are mutually exclusive: the app
      // reflow spends the extra width on the ladder, every other layout on the chips. The
      // live ladder row is what keeps the sector-loss surface readable where the chips are hidden.
      if (size.layout === 'app') {
        expect(geometry.ladderDisplay).toBe('flex')
        expect(geometry.sectorsDisplay).toBe('none')
        expectContained(geometry.root, geometry.ladder)
        expect(geometry.ladderNow.width).toBeGreaterThan(0)
        expect(geometry.ladderNow.height).toBeGreaterThan(0)
        expectContained(geometry.ladder, geometry.ladderNow)
      } else {
        expect(geometry.ladderDisplay).toBe('none')
        expect(geometry.sectorsDisplay).not.toBe('none')
        expect(geometry.ladderNow.width).toBe(0)
      }
      expect(geometry.ladderNowSectorCount).toBe(3)

      // LAP | S1 | S2 | S3 | TOTAL: five cells per row, none of them clipping its text.
      expect(geometry.ladderRows.length).toBeGreaterThanOrEqual(3)
      for (const [index, cells] of geometry.ladderRows.entries()) {
        expect(cells, `ladder row ${index + 1} must have five cells`).toHaveLength(5)
        for (const cell of cells) {
          expect(cell.scrollWidth, `ladder row ${index + 1} cell "${cell.text}" must fit`).toBeLessThanOrEqual(cell.clientWidth)
        }
      }

      const capture = await page.locator('#racecon-rc02-capture-root').screenshot({ animations: 'disabled' })
      expect(capture.byteLength).toBeGreaterThan(5_000)
    } finally {
      await context.close()
    }
  })
}
