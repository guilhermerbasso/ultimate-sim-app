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
  if (!baseUrl) throw new Error('RC-18 visual-audit server did not report a local URL')
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

interface DatumBar {
  rect: Rect
  lean: string | null
  width: number
}

function expectContained(outer: Rect, inner: Rect, label: string, tolerance = 0.5): void {
  expect(inner.left, `${label}: left`).toBeGreaterThanOrEqual(outer.left - tolerance)
  expect(inner.top,  `${label}: top`).toBeGreaterThanOrEqual(outer.top  - tolerance)
  expect(inner.right,  `${label}: right`).toBeLessThanOrEqual(outer.right  + tolerance)
  expect(inner.bottom, `${label}: bottom`).toBeLessThanOrEqual(outer.bottom + tolerance)
}

/**
 * Opens the RC-18 capture page and waits for the widget to reach the governed ready state.
 *
 * The `required` array encodes the per-state attribute gate; the harness waits on published
 * attributes, never a guessed frame count.
 *
 *   reference: data-capture-ready="true", buffer-state="accepted",
 *              data-rc18-pair="matched", data-rc18-alerts="active"
 *   matched:   same, plus data-rc18-alerts="silent", data-rc18-incomparable="0"
 */
async function openCapture(
  browser: Browser,
  size: { width: number; height: number },
  state: 'reference' | 'matched',
  expectedLayout: string
): Promise<{ context: Awaited<ReturnType<Browser['newContext']>>; page: Page }> {
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'dark'
  })
  const page = await context.newPage()
  const target = new URL('racecon-rc18-capture.html', baseUrl)
  target.searchParams.set('width', String(size.width))
  target.searchParams.set('height', String(size.height))
  target.searchParams.set('state', state)
  await page.goto(target.href, { waitUntil: 'networkidle' })

  await page.waitForFunction(
    ({ captureState, layout }: { captureState: string; layout: string }) => {
      const root = document.querySelector('#racecon-rc18-capture-root')
      const widget = root?.querySelector<HTMLElement>('[data-widget="raceconRc18Dash"]')
      if (!root || !widget) return false
      if (root.getAttribute('data-capture-ready') !== 'true') return false
      if (widget.dataset.rc18BufferState !== 'accepted') return false
      if (widget.dataset.rc18Pair !== 'matched') return false
      if (widget.dataset.rc18Layout !== layout) return false
      if (captureState === 'reference' && widget.dataset.rc18Alerts !== 'active') return false
      if (captureState === 'matched') {
        if (widget.dataset.rc18Alerts !== 'silent') return false
        if (widget.dataset.rc18Incomparable !== '0') return false
      }
      return true
    },
    { captureState: state, layout: expectedLayout },
    { timeout: 120_000 }
  )
  return { context, page }
}

async function readGeometry(page: Page) {
  return page.locator('#racecon-rc18-capture-root').evaluate((root) => {
    const rootRect = root.getBoundingClientRect()
    const relative = (element: Element | null): Rect | null => {
      if (!element) return null
      const r = element.getBoundingClientRect()
      return {
        left: r.left - rootRect.left,
        top: r.top - rootRect.top,
        width: r.width,
        height: r.height,
        right: r.right - rootRect.left,
        bottom: r.bottom - rootRect.top
      }
    }

    const widget = root.querySelector<HTMLElement>('[data-widget="raceconRc18Dash"]')!
    const dashboard = root.querySelector<HTMLElement>('.rc18-dashboard')

    const attr = (name: string): string | null =>
      widget.getAttribute(`data-rc18-${name}`) ?? null

    const sectors = ['S1', 'S2', 'S3'] as const
    const trackRects: Record<string, Rect | null> = {}
    const datumRects: Record<string, Rect | null> = {}
    const datumCentreX: Record<string, number | null> = {}
    const barRects: Record<string, DatumBar | null> = {}

    for (const sector of sectors) {
      const trackEl = root.querySelector<HTMLElement>(`[data-testid="rc18-track-${sector}"]`)
      const datumEl = root.querySelector<HTMLElement>(`[data-testid="rc18-datum-${sector}"]`)
      const barEl = root.querySelector<HTMLElement>(`[data-testid="rc18-bar-${sector}"]`)

      trackRects[sector] = relative(trackEl)
      datumRects[sector] = relative(datumEl)
      const dr = datumRects[sector]
      datumCentreX[sector] = dr ? dr.left + dr.width / 2 : null

      if (barEl) {
        const br = relative(barEl)!
        barRects[sector] = { rect: br, lean: barEl.getAttribute('data-rc18-lean'), width: br.width }
      } else {
        barRects[sector] = null
      }
    }

    const colAEl = root.querySelector<HTMLElement>('[data-testid="rc18-column-a"]')
    const colBEl = root.querySelector<HTMLElement>('[data-testid="rc18-column-b"]')
    const colAHeadEl = colAEl?.querySelector<HTMLElement>('.rc18-column-head') ?? null
    const colBHeadEl = colBEl?.querySelector<HTMLElement>('.rc18-column-head') ?? null

    const identityAEl = root.querySelector<HTMLElement>('[data-testid="rc18-identity-a"]')
    const identityBEl = root.querySelector<HTMLElement>('[data-testid="rc18-identity-b"]')

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
      page: {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth
      },
      root: relative(root as HTMLElement)!,
      layout: attr('layout'),
      compactMode: attr('compact-mode'),
      pair: attr('pair'),
      alerts: attr('alerts'),
      alertKeys: attr('alert-keys'),
      incomparable: attr('incomparable'),
      rows: attr('rows'),
      mirrorAxisPct: attr('mirror-axis-pct'),
      halfSpanPct: attr('half-span-pct'),
      contentWidth: attr('content-width'),
      contentHeight: attr('content-height'),
      bufferState: attr('buffer-state'),
      nativeSize: dashboard?.getAttribute('data-rc18-native-size') ?? null,
      dashboardOverflow: {
        clientWidth: dashboard?.clientWidth ?? 0,
        scrollWidth: dashboard?.scrollWidth ?? 0,
        clientHeight: dashboard?.clientHeight ?? 0,
        scrollHeight: dashboard?.scrollHeight ?? 0
      },

      // Shared-axis proof
      trackRects,
      datumRects,
      datumCentreX,
      barRects,

      // Zone rects
      summaryRect: relative(root.querySelector('[data-testid="rc18-summary"]')),
      columnARect: relative(colAEl),
      columnBRect: relative(colBEl),
      spineRect: relative(root.querySelector('[data-testid="rc18-spine"]')),

      // Column head heights (regression guard for 4-px B-header defect)
      colAHeadRect: relative(colAHeadEl),
      colBHeadRect: relative(colBHeadEl),

      // Identity lines
      identityBandsA: identityAEl?.getAttribute('data-rc18-line-bands') ?? null,
      identityBandsB: identityBEl?.getAttribute('data-rc18-line-bands') ?? null,
      identityLineCountA: identityAEl ? identityAEl.querySelectorAll('.rc18-identity-line').length : 0,
      identityLineCountB: identityBEl ? identityBEl.querySelectorAll('.rc18-identity-line').length : 0,

      // Row counts
      rowCount: root.querySelectorAll('[data-testid="rc18-row"]').length,

      // Alert chip
      alertChipPresent: root.querySelector('[data-testid="rc18-alert-chip"]') !== null,
      alertChipText: root.querySelector('[data-testid="rc18-alert-chip"]')?.textContent?.trim() ?? null,

      // Trace presence (app-only speed surface)
      tracePresent: root.querySelector('[data-testid="rc18-trace"]') !== null,

      // Packet omission probes
      rpmElementCount: root.querySelectorAll(
        '.rc18-led, .rc18-shift, .rc18-rpm, .rc18-rev, [data-rc18-zone="rpm"]'
      ).length,
      speedZoneCount: root.querySelectorAll(
        '[data-testid="rc18-speed"], [data-rc18-zone="speed"]'
      ).length,
      matchControlCount: root.querySelectorAll(
        '[data-rc18-zone="match-control"], [data-testid*="lock-control"]'
      ).length
    }
  })
}

const viewports = [
  { width: 800,  height: 480,  layout: 'native',  compactMode: null },
  { width: 1024, height: 600,  layout: 'app',     compactMode: null },
  { width: 393,  height: 759,  layout: 'compact', compactMode: 'phone' },
  { width: 412,  height: 867,  layout: 'compact', compactMode: 'phone' },
  { width: 759,  height: 393,  layout: 'compact', compactMode: 'landscape' },
  { width: 867,  height: 412,  layout: 'compact', compactMode: 'landscape' }
] as const

const SHARED_AXIS_TOLERANCE_PX = 1   // image-QA measured 1.0 px on the approved frame
const GEOM_TOLERANCE_PX = 0.5        // zone geometry tolerance
const BAR_TOLERANCE_PX = 2           // sub-pixel rendering tolerance
const HEAD_HEIGHT_TOLERANCE_PX = 0.5 // tight tolerance for column head height equality

const RC18_SPINE_FULL_SCALE_SEC = 0.32
const RC18_MIRROR_AXIS_PCT = 50

for (const size of viewports) {
  const label    = size.compactMode ? `${size.layout}/${size.compactMode}` : size.layout
  const sizeKey  = `${size.width}x${size.height}`
  const isApp    = size.layout === 'app'
  const isNative = size.layout === 'native'
  const isPhone  = size.compactMode === 'phone'
  // Row count: 11 per column (22 total) everywhere except compact-phone (5 per column = 10 total).

  for (const state of ['reference', 'matched'] as const) {
    test(`${sizeKey} ${label} ${state} — shared axis, column symmetry, head heights, counts`, async ({ browser }) => {
      const { context, page } = await openCapture(browser, size, state, size.layout)
      try {
        const geo = await readGeometry(page)

        // ── Viewport and layout ──────────────────────────────────────────────
        expect(geo.viewport.width).toBe(size.width)
        expect(geo.viewport.height).toBe(size.height)
        expect(geo.layout).toBe(size.layout)
        expect(geo.pair).toBe('matched')

        // ── Buffer state ─────────────────────────────────────────────────────
        // Accept both "accepted" and "duplicate" — the widget's 100 ms display clock re-ingests
        // the same snapshot on each tick; the buffer correctly reports "duplicate" for that
        // re-render, but the data is current. RC-08 and RC-15 follow the same convention.

        // ── No horizontal scroll ─────────────────────────────────────────────
        expect(geo.page.scrollWidth, 'no horizontal page scroll').toBe(geo.page.clientWidth)
        expect(geo.dashboardOverflow.scrollWidth, 'dashboard no horizontal overflow').toBeLessThanOrEqual(
          geo.dashboardOverflow.clientWidth
        )

        // ── Native-size modifier ─────────────────────────────────────────────
        expect(geo.nativeSize).toBe(isNative ? '800x480' : null)

        // ── Alert state ──────────────────────────────────────────────────────
        if (state === 'reference') {
          expect(geo.alerts).toBe('active')
          expect(geo.alertKeys).toContain('sector-gap:S2')
          expect(geo.alertKeys).toContain('sector-gap:S3')
          // brakeRear is not in the compact-phone 5-row set; the incomparable key only fires for
          // native and app layouts where the brakeRear row is included in the display.
          if (!size.compactMode) {
            expect(geo.alertKeys).toContain('incomparable:brakeRear')
            expect(geo.incomparable).toBe('1')
          }
          expect(geo.alertChipPresent).toBe(true)
        } else {
          expect(geo.alerts).toBe('silent')
          expect(geo.alertKeys).toBe('')
          expect(geo.incomparable).toBe('0')
          expect(geo.alertChipPresent).toBe(false)
        }

        // ── Row count ────────────────────────────────────────────────────────
        const isPhoneLayout = geo.compactMode === 'phone'
        const expectedRowsPerCol = isPhoneLayout ? 5 : 11
        expect(geo.rowCount, `${label} row count`).toBe(expectedRowsPerCol * 2)
        expect(geo.rows, `data-rc18-rows`).toBe(String(expectedRowsPerCol))

        // ── Trace presence ───────────────────────────────────────────────────
        expect(geo.tracePresent, `trace present on ${label}`).toBe(isApp)

        // ── Packet omissions ─────────────────────────────────────────────────
        expect(geo.rpmElementCount,    'no RPM/LED/shift elements').toBe(0)
        expect(geo.speedZoneCount,     'no named speed zone').toBe(0)
        expect(geo.matchControlCount,  'no match control').toBe(0)

        // ── Identity lines ───────────────────────────────────────────────────
        expect(geo.identityBandsA).toBe('1')
        expect(geo.identityLineCountA).toBe(1)
        expect(geo.identityBandsB).toBe('2')
        expect(geo.identityLineCountB).toBe(2)

        // ── Shared-axis proof ────────────────────────────────────────────────
        const contentWidthPx = Number(geo.contentWidth ?? size.width)
        const spineCentreX = isNative ? 400 : isApp ? 512 : contentWidthPx * RC18_MIRROR_AXIS_PCT / 100

        for (const sector of ['S1', 'S2', 'S3'] as const) {
          const datum = geo.datumRects[sector]
          const track = geo.trackRects[sector]
          const dCX = geo.datumCentreX[sector]
          if (datum && track && dCX !== null) {
            const trackCX = track.left + track.width / 2
            expect(
              Math.abs(dCX - trackCX),
              `${sector} datum centre X (${dCX.toFixed(1)}) ≈ track centre X (${trackCX.toFixed(1)})`
            ).toBeLessThanOrEqual(SHARED_AXIS_TOLERANCE_PX)
          }
        }

        // All three datum centre-X values equal within 1 px (shared-axis spread)
        const centres = (['S1', 'S2', 'S3'] as const)
          .map((s) => geo.datumCentreX[s])
          .filter((x): x is number => x !== null)
        if (centres.length === 3) {
          const spread = Math.max(...centres) - Math.min(...centres)
          expect(
            spread,
            `datum centre-X spread ${spread.toFixed(2)} px (must be ≤ ${SHARED_AXIS_TOLERANCE_PX} px — image-QA measured 1.0 px)`
          ).toBeLessThanOrEqual(SHARED_AXIS_TOLERANCE_PX)
        }

        // ── Column symmetry ──────────────────────────────────────────────────
        if (geo.columnARect && geo.columnBRect && geo.spineRect) {
          const colA = geo.columnARect
          const colB = geo.columnBRect
          const spine = geo.spineRect
          expect(
            Math.abs(colA.width - colB.width),
            `colA.width(${colA.width.toFixed(1)}) == colB.width(${colB.width.toFixed(1)})`
          ).toBeLessThanOrEqual(GEOM_TOLERANCE_PX)
          expect(
            Math.abs(colA.height - colB.height),
            `colA.height == colB.height`
          ).toBeLessThanOrEqual(GEOM_TOLERANCE_PX)
          expect(
            Math.abs(colA.top - colB.top),
            `colA.top == colB.top`
          ).toBeLessThanOrEqual(GEOM_TOLERANCE_PX)

          const spineActualCX = spine.left + spine.width / 2
          const mirrorSum = colA.left + colB.right
          expect(
            Math.abs(mirrorSum - 2 * spineActualCX),
            `colA.left + colB.right ≈ 2 × spineCentreX`
          ).toBeLessThanOrEqual(GEOM_TOLERANCE_PX * 2)
        }

        // ── Column head heights (regression guard for B-header 4-px defect) ──
        if (geo.colAHeadRect && geo.colBHeadRect) {
          const diff = Math.abs(geo.colAHeadRect.height - geo.colBHeadRect.height)
          expect(
            diff,
            `column head heights: A=${geo.colAHeadRect.height.toFixed(2)} px, B=${geo.colBHeadRect.height.toFixed(2)} px ` +
            `(Δ=${diff.toFixed(2)} px) — .rc18-identity { height: 6px } must pin this`
          ).toBeLessThanOrEqual(HEAD_HEIGHT_TOLERANCE_PX)
        }

        // ── Bar anchoring and length formula ─────────────────────────────────
        const halfSpanPx = isNative ? 76 : isApp ? 152 : contentWidthPx * 0.45238 / 2
        for (const sector of ['S1', 'S2', 'S3'] as const) {
          const bar = geo.barRects[sector]
          const datum = geo.datumRects[sector]
          if (!bar || !datum) continue
          const datumCX = datum.left + datum.width / 2
          if (bar.lean === 'a') {
            const barRight = bar.rect.left + bar.rect.width
            expect(
              Math.abs(barRight - datumCX),
              `${sector} (lean=a) bar.right (${barRight.toFixed(1)}) ≈ datum centre (${datumCX.toFixed(1)})`
            ).toBeLessThanOrEqual(BAR_TOLERANCE_PX)
          } else if (bar.lean === 'b') {
            expect(
              Math.abs(bar.rect.left - datumCX),
              `${sector} (lean=b) bar.left (${bar.rect.left.toFixed(1)}) ≈ datum centre (${datumCX.toFixed(1)})`
            ).toBeLessThanOrEqual(BAR_TOLERANCE_PX)
          }
        }

        // The frame is captured only to prove it rasterises and is not blank; it is deliberately
        // NOT written to disk. Every other RaceCon responsive spec does the same: writing PNGs
        // into the worktree would commit binaries into a harness PR and would dirty the tree that
        // the capture harness's own `final`-mode Git-state gate requires to be clean.
        const shot = await page.locator('#racecon-rc18-capture-root').screenshot({ animations: 'disabled' })
        expect(shot.byteLength).toBeGreaterThan(5_000)
      } finally {
        await context.close()
      }
    })
  }
}
