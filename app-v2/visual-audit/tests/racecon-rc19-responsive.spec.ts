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
  if (!baseUrl) throw new Error('RC-19 visual-audit server did not report a local URL')
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

function expectContained(outer: Rect, inner: Rect, label: string, tolerance = 0.5): void {
  expect(inner.left,   `${label}: left must be ≥ outer.left`).toBeGreaterThanOrEqual(outer.left   - tolerance)
  expect(inner.top,    `${label}: top must be ≥ outer.top`).toBeGreaterThanOrEqual(outer.top    - tolerance)
  expect(inner.right,  `${label}: right must be ≤ outer.right`).toBeLessThanOrEqual(outer.right  + tolerance)
  expect(inner.bottom, `${label}: bottom must be ≤ outer.bottom`).toBeLessThanOrEqual(outer.bottom + tolerance)
}

async function openCapture(
  browser: Browser,
  size: { width: number; height: number },
  expected: {
    layout: 'native' | 'app' | 'compact'
    compactMode?: 'phone' | 'landscape' | null
    state: 'cold-mount' | 'handover' | 'ready'
  }
): Promise<{ context: Awaited<ReturnType<Browser['newContext']>>; page: Page }> {
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'dark'
  })
  const page = await context.newPage()
  const target = new URL('racecon-rc19-capture.html', baseUrl)
  target.searchParams.set('width', String(size.width))
  target.searchParams.set('height', String(size.height))
  target.searchParams.set('state', expected.state)
  await page.goto(target.href, { waitUntil: 'networkidle', timeout: 60_000 })

  await page.waitForFunction(
    ({ layout, compactMode, state: captureState }) => {
      const root   = document.querySelector('#racecon-rc19-capture-root')
      const widget = root?.querySelector<HTMLElement>('[data-widget="raceconRc19Dash"]')
      if (!root || !widget) return false
      if (root.getAttribute('data-capture-ready') !== 'true') return false
      if (widget.getAttribute('data-rc19-buffer-state') !== 'accepted') return false
      if (widget.getAttribute('data-rc19-layout') !== layout) return false
      const publishedCompact = widget.getAttribute('data-rc19-compact-mode')
      if (compactMode != null && publishedCompact !== compactMode) return false
      if (captureState === 'ready') {
        if (widget.getAttribute('data-rc19-alerts')      !== 'silent') return false
        if (widget.getAttribute('data-rc19-outstanding') !== '2')      return false
      } else if (captureState === 'handover') {
        if (widget.getAttribute('data-rc19-alerts')  !== 'active')  return false
        if (widget.getAttribute('data-rc19-handover') !== 'in-box') return false
      } else {
        // cold-mount: just the pit context
        if (widget.getAttribute('data-rc19-handover') !== 'in-box') return false
      }
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

async function readGeometry(page: Page) {
  return page.locator('#racecon-rc19-capture-root').evaluate((root) => {
    const rootRect = root.getBoundingClientRect()
    const relative = (element: Element | null): Rect | null => {
      if (!element) return null
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
    const widget    = root.querySelector<HTMLElement>('[data-widget="raceconRc19Dash"]')!
    const dashboard = root.querySelector<HTMLElement>('.rc19-dashboard')

    const attr = (name: string): string | null => widget.getAttribute('data-rc19-' + name)

    const measure = (label: string, selector: string) => {
      const el = root.querySelector<HTMLElement>(selector)
      if (!el) return null
      const style = getComputedStyle(el)
      return {
        label,
        text:        el.textContent?.trim() ?? '',
        fontSize:    Number.parseFloat(style.fontSize),
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        rect:        relative(el)
      }
    }

    const zoneEntries: [string, string][] = [
      ['header',    '[data-testid="rc19-header"]'],
      ['carState',  '[data-testid="rc19-car-state"]'],
      ['checklist', '[data-testid="rc19-checklist"]'],
      ['confirm',   '[data-testid="rc19-confirm"]'],
      ['nextStint', '[data-testid="rc19-next-stint"]']
    ]
    const zones = zoneEntries.map(([name, selector]) => {
      const el = root.querySelector<HTMLElement>(selector)
      const r  = el ? relative(el)! : { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }
      return { name, rect: r, display: el ? getComputedStyle(el).display : 'none' }
    })

    const alertsEl      = root.querySelector('[data-testid="rc19-alerts"]')
    const faultsEl      = root.querySelector('[data-testid="rc19-faults"]')
    const confirmEl     = root.querySelector('[data-testid="rc19-confirm"]')
    const confirmLblEl  = root.querySelector('[data-testid="rc19-confirm-label"]')

    return {
      viewport:     { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
      page:         { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
      root:         relative(root)!,

      // Widget-published state attributes
      layout:         attr('layout'),
      compactMode:    attr('compact-mode'),
      bufferState:    attr('buffer-state'),
      contentWidth:   attr('content-width'),
      contentHeight:  attr('content-height'),
      ready:          attr('ready'),
      outstanding:    attr('outstanding'),
      handover:       attr('handover'),
      alerts:         attr('alerts'),
      alertKeys:      attr('alert-keys'),
      nativeSize:     dashboard?.getAttribute('data-rc19-native-size') ?? null,

      dashboardOverflow: {
        clientWidth:  dashboard?.clientWidth  ?? 0,
        scrollWidth:  dashboard?.scrollWidth  ?? 0,
        clientHeight: dashboard?.clientHeight ?? 0,
        scrollHeight: dashboard?.scrollHeight ?? 0
      },

      // Element counts
      checkRowCount:    root.querySelectorAll('[data-testid="rc19-check-row"]').length,
      glyphCount:       root.querySelectorAll('[data-testid^="rc19-glyph-"]').length,
      stateOutputCount: root.querySelectorAll('[data-testid^="rc19-state-"]').length,
      cellCount:        root.querySelectorAll('[data-testid="rc19-cell"]').length,
      rowCount:         root.querySelectorAll('[data-testid="rc19-row"]').length,
      alertsStripCount: root.querySelectorAll('[data-testid="rc19-alerts"]').length,
      waterTempCount:   root.querySelectorAll('[data-testid="rc19-water-temp"]').length,
      voltageCount:     root.querySelectorAll('[data-testid="rc19-voltage"]').length,
      timelineCount:    root.querySelectorAll('[data-testid="rc19-timeline"]').length,
      fuelPlanNoteCount:root.querySelectorAll('[data-testid="rc19-fuel-plan-note"]').length,

      // Packet omission probes
      deltaCount:        root.querySelectorAll('.rc19-delta, [data-rc19-zone="delta"], [data-testid^="rc19-delta"]').length,
      driverCount:       root.querySelectorAll('[data-testid="rc19-driver"], [data-testid="rc19-countdown"], .rc19-countdown').length,
      gearSpeedCount:    root.querySelectorAll('.rc19-gear, .rc19-speed, [data-rc19-zone="gear"], [data-rc19-zone="speed"]').length,
      stintLapsText:     root.querySelector('[data-testid="rc19-stint-laps"]')?.textContent?.trim() ?? null,
      absText:           root.querySelector('[data-testid="rc19-abs"]')?.textContent?.trim() ?? null,

      // Timeline segment attribute (app-only)
      timelineSegments: root.querySelector('[data-testid="rc19-timeline"]')?.getAttribute('data-rc19-timeline-segments') ?? null,

      // Alert-strip clearance rects
      alertsRect:      relative(alertsEl),
      faultsRect:      relative(faultsEl),
      confirmRect:     relative(confirmEl),
      confirmLabelRect:relative(confirmLblEl),

      // Zone geometry
      zones,

      // Type-scale hierarchy
      values: [
        measure('readiness',  '[data-testid="rc19-readiness"]'),
        measure('fuel-laps',  '[data-testid="rc19-fuel-laps"]'),
        measure('outstanding','[data-testid="rc19-outstanding"]'),
        measure('row-label',  '[data-rc19-row="fuel-laps"] .rc19-label')
      ].filter((e): e is NonNullable<typeof e> => e !== null),

      // Containment spot-checks
      headerRect:   relative(root.querySelector('[data-testid="rc19-header"]')),
      carStateRect: relative(root.querySelector('[data-testid="rc19-car-state"]')),
      checklistRect:relative(root.querySelector('[data-testid="rc19-checklist"]')),
      confirmBodyRect: relative(root.querySelector('[data-testid="rc19-confirm"]')),
      nextStintRect:relative(root.querySelector('[data-testid="rc19-next-stint"]')),
      readinessRect:relative(root.querySelector('[data-testid="rc19-readiness"]')),
      fuelLapsRect: relative(root.querySelector('[data-testid="rc19-fuel-laps"]')),
      confirmLabelRectInner: relative(root.querySelector('[data-testid="rc19-confirm-label"]')),

      // Every cell of every next-stint row with its layout box AND its painted range rect. The
      // `FUEL PER LAP` label carries its `L` unit as an element CHILD, so it is not a leaf and no
      // leaf sweep can see it overflow; only the range rect can.
      nextStintCells: Array.from(
        root.querySelectorAll<HTMLElement>('[data-testid="rc19-next-stint"] .rc19-row > *')
      ).map((cell) => {
        const range = document.createRange()
        range.selectNodeContents(cell)
        const ink = range.getBoundingClientRect()
        const box = cell.getBoundingClientRect()
        return {
          kind: cell.classList.contains('rc19-label') ? 'label' : 'value',
          text: (cell.textContent ?? '').trim(),
          boxWidth: box.width,
          inkWidth: ink.width,
          boxRight: box.right - rootRect.left,
          inkRight: ink.right - rootRect.left
        }
      })
    }
  })
}

// ─────────────────────────────────────────────────────────── per-viewport loop

for (const size of viewports) {
  const label    = size.compactMode ? `${size.layout}/${size.compactMode}` : size.layout
  const sizeKey  = `${size.width}x${size.height}`
  const isApp    = size.layout === 'app'
  const isNative = size.layout === 'native'

  test(`${sizeKey} ready: RC-19 composition is contained and attributes are correct (${label})`, async ({ browser }) => {
    const { context, page } = await openCapture(browser, size, {
      layout: size.layout,
      compactMode: size.compactMode ?? null,
      state: 'ready'
    })
    try {
      const g = await readGeometry(page)

      // Viewport and layout
      expect(g.viewport).toEqual({ width: size.width, height: size.height, dpr: 1 })
      expect(g.layout).toBe(size.layout)
      expect(g.contentWidth).toBe(String(size.width))
      expect(g.contentHeight).toBe(String(size.height))
      if (size.compactMode) expect(g.compactMode).toBe(size.compactMode)

      // State attributes: approved silent frame
      expect(g.handover).toBe('in-box')
      expect(g.alerts).toBe('silent')
      expect(g.alertKeys).toBe('')
      expect(g.outstanding).toBe('2')
      expect(g.bufferState).toMatch(/^(accepted|duplicate)$/)
      expect(g.nativeSize).toBe(isNative ? '800x480' : null)

      // No horizontal scrollbar
      expect(g.page.scrollWidth).toBe(g.page.clientWidth)
      expect(g.dashboardOverflow.scrollWidth).toBeLessThanOrEqual(g.dashboardOverflow.clientWidth)

      // Fixed element counts (always-present)
      expect(g.checkRowCount).toBe(6)
      expect(g.glyphCount).toBe(6)
      expect(g.stateOutputCount).toBe(6)
      expect(g.cellCount).toBe(8)
      expect(g.rowCount).toBe(isApp ? 9 : 7)

      // Alert strip absent in silent state
      expect(g.alertsStripCount).toBe(0)
      expect(g.fuelPlanNoteCount).toBe(0)

      // Tertiary (water-temp, voltage): app-only
      expect(g.waterTempCount).toBe(isApp ? 1 : 0)
      expect(g.voltageCount).toBe(isApp ? 1 : 0)

      // Timeline: app-only, zero segments
      if (isApp) {
        expect(g.timelineCount).toBe(1)
        expect(g.timelineSegments).toBe('0')
      } else {
        expect(g.timelineCount).toBe(0)
      }

      // Packet omissions (forbidden selectors)
      expect(g.deltaCount, 'omission: deltaToBest — no delta element allowed').toBe(0)
      expect(g.driverCount,'omission: driverIdentity — no driver/countdown element').toBe(0)
      expect(g.gearSpeedCount,'omission: gearSpeed — no gear or speed element').toBe(0)

      // GAP-3: ABS must dash
      expect(g.absText).toBe('--')

      // Stint-laps must read "28" after the observed pit exit
      expect(g.stintLapsText).toBe('28')

      // Type-scale hierarchy: readiness > fuel-laps > outstanding > row-label (strict, no ties)
      const scale = ['readiness', 'fuel-laps', 'outstanding', 'row-label'].map(
        (name) => g.values.find((v) => v.label === name)!
      )
      for (let i = 1; i < scale.length; i += 1) {
        expect(
          scale[i - 1].fontSize,
          `${scale[i - 1].label} must be strictly larger than ${scale[i].label}`
        ).toBeGreaterThan(scale[i].fontSize)
      }

      // Zone geometry: all zones inside frame, peer zones don't overlap
      // (confirm-inside-checklist is the one documented overlap; we skip that pair)
      const frameRect: Rect = { left: 0, top: 0, width: size.width, height: size.height, right: size.width, bottom: size.height }
      for (const z of g.zones) {
        if (z.display === 'none' || z.rect.width <= 0) continue
        expectContained(frameRect, z.rect, `${z.name} must be inside the capture frame`)
      }
      const visibleZones = g.zones.filter((z) => z.display !== 'none' && z.rect.width > 0 && z.rect.height > 0)
      for (let a = 0; a < visibleZones.length; a += 1) {
        for (let b = a + 1; b < visibleZones.length; b += 1) {
          const first  = visibleZones[a]
          const second = visibleZones[b]
          // Skip the documented nested pair
          const pair = [first.name, second.name].sort().join('/')
          if (pair === 'checklist/confirm') continue
          const overlapX = Math.min(first.rect.right,  second.rect.right)  - Math.max(first.rect.left, second.rect.left)
          const overlapY = Math.min(first.rect.bottom, second.rect.bottom) - Math.max(first.rect.top,  second.rect.top)
          expect(
            Math.min(overlapX, overlapY),
            `${first.name} overlaps ${second.name}`
          ).toBeLessThanOrEqual(0.5)
        }
      }

      // Containment spot-checks
      if (g.headerRect && g.readinessRect) expectContained(g.headerRect, g.readinessRect, 'readiness in header')
      if (g.carStateRect && g.fuelLapsRect) expectContained(g.carStateRect, g.fuelLapsRect, 'fuel-laps in carState')
      if (g.checklistRect && g.confirmBodyRect) expectContained(g.checklistRect, g.confirmBodyRect, 'confirm in checklist')
      if (g.confirmBodyRect && g.confirmLabelRectInner) expectContained(g.confirmBodyRect, g.confirmLabelRectInner, 'confirm-label in confirm')

      // GUARD (defect 5) — no next-stint row cell may paint past its own box.
      //
      // At 800x480 the packet's 250 px column leaves a 168 px row, and `FUEL PER LAP` plus its `L`
      // unit needed 110.45 px of it at the shared 1.875cqw step against a 30 px `2.94` numeral
      // needing 56.63 px and a 9.6 px gap. The flex algorithm split the deficit, so the label
      // painted 5.45 px past its 105 px box and the numeral 3 px past its 54 px box, in all three
      // governed states, while `scrollWidth === clientWidth` on every ancestor — and the label is
      // not even a leaf, so no leaf sweep could ever have seen it. The column now carries its own
      // 1.6cqw label step. This runs at all six viewports with a 1 px sub-pixel tolerance.
      expect(g.nextStintCells.length).toBeGreaterThan(0)
      for (const cell of g.nextStintCells) {
        expect(
          cell.inkRight - cell.boxRight,
          `next-stint ${cell.kind} "${cell.text}" paints ` +
            `${(cell.inkRight - cell.boxRight).toFixed(2)}px past its ${cell.boxWidth.toFixed(2)}px box`
        ).toBeLessThanOrEqual(1)
        expect(
          cell.inkWidth - cell.boxWidth,
          `next-stint ${cell.kind} "${cell.text}" needs ${cell.inkWidth.toFixed(2)}px ` +
            `in a ${cell.boxWidth.toFixed(2)}px box`
        ).toBeLessThanOrEqual(1)
      }

      // Screenshot sanity check
      const capture = await page.locator('#racecon-rc19-capture-root').screenshot({ animations: 'disabled' })
      expect(capture.byteLength).toBeGreaterThan(4_000)
    } finally {
      await context.close()
    }
  })

  test(`${sizeKey} handover: alert strip renders, SAFETY ITEM UNCONFIRMED active (${label})`, async ({ browser }) => {
    const { context, page } = await openCapture(browser, size, {
      layout: size.layout,
      compactMode: size.compactMode ?? null,
      state: 'handover'
    })
    try {
      const g = await readGeometry(page)

      // State attributes: alert is live
      expect(g.handover).toBe('in-box')
      expect(g.alerts).toBe('active')
      expect(g.alertKeys).toContain('SAFETY ITEM UNCONFIRMED')
      expect(g.outstanding).toBe('6')

      // Alert strip must render once
      expect(g.alertsStripCount).toBe(1)

      // Packet omissions still hold during alert state
      expect(g.deltaCount).toBe(0)
      expect(g.driverCount).toBe(0)

      // ABS must still dash during alert state
      expect(g.absText).toBe('--')

      // Tertiary still absent on non-app canvases
      expect(g.waterTempCount).toBe(isApp ? 1 : 0)
      expect(g.voltageCount).toBe(isApp ? 1 : 0)

      // Zones inside frame (peer overlaps exempted as before)
      const frameRect: Rect = { left: 0, top: 0, width: size.width, height: size.height, right: size.width, bottom: size.height }
      for (const z of g.zones) {
        if (z.display === 'none' || z.rect.width <= 0) continue
        expectContained(frameRect, z.rect, `${z.name} in handover must be inside frame`)
      }
    } finally {
      await context.close()
    }
  })
}

// ─────────────────────────────────────────────────────────── alert-floor band geometry test

test(
  'alert-strip floor band: FAULTS and CONFIRM READY are not occluded on the native canvas (handover)',
  async ({ browser }) => {
    /**
     * Headline promise #1: the RC19_COMPACT_ALERT_FLOOR_PCT=9 reservation ensures the alert strip
     * cannot occlude the FAULTS row or the CONFIRM READY label. This test measures the real-browser
     * layout at 800×480 in the handover state and reports exact pixel clearance. If the strip
     * overlaps any element the test fails with the measured overlap, never a clamped value.
     */
    const CLEARANCE_TOLERANCE_PX = 2
    const size = viewports[0]  // 800×480 native
    const { context, page } = await openCapture(browser, size, { layout: 'native', state: 'handover' })
    try {
      await expect
        .poll(
          async () => page.locator('[data-widget="raceconRc19Dash"]').getAttribute('data-rc19-alerts'),
          { timeout: 60_000 }
        )
        .toBe('active')

      const clearance = await page.locator('#racecon-rc19-capture-root').evaluate((root) => {
        const rootRect = root.getBoundingClientRect()
        const rel = (el: Element | null) => {
          if (!el) return null
          const r = el.getBoundingClientRect()
          return {
            left:   r.left   - rootRect.left,
            top:    r.top    - rootRect.top,
            right:  r.right  - rootRect.left,
            bottom: r.bottom - rootRect.top,
            width:  r.width,
            height: r.height
          }
        }
        const alertsEl      = root.querySelector('[data-testid="rc19-alerts"]')
        const faultsEl      = root.querySelector('[data-testid="rc19-faults"]')
        const confirmEl     = root.querySelector('[data-testid="rc19-confirm"]')
        const confirmLblEl  = root.querySelector('[data-testid="rc19-confirm-label"]')
        const alertsRect    = rel(alertsEl)
        const faultsRect    = rel(faultsEl)
        const confirmRect   = rel(confirmEl)
        const confirmLblRect= rel(confirmLblEl)
        return {
          alertsRect,
          faults: {
            rect: faultsRect,
            clearancePx: alertsRect && faultsRect ? alertsRect.top - faultsRect.bottom : null
          },
          confirm: {
            rect: confirmRect,
            clearancePx: alertsRect && confirmRect ? alertsRect.top - confirmRect.bottom : null
          },
          confirmLabel: {
            rect: confirmLblRect,
            clearancePx: alertsRect && confirmLblRect ? alertsRect.top - confirmLblRect.bottom : null
          }
        }
      })

      expect(clearance.alertsRect, 'rc19-alerts strip must render in handover state').not.toBeNull()
      expect(clearance.faults.rect,   'rc19-faults must be present').not.toBeNull()
      expect(clearance.confirm.rect,  'rc19-confirm must be present').not.toBeNull()
      expect(clearance.confirmLabel.rect, 'rc19-confirm-label must be present').not.toBeNull()

      // Report the measured clearance; a negative value here is the occlusion depth.
      console.log(
        `RC-19 alert-floor clearance at 800×480 handover:` +
        ` faults=${clearance.faults.clearancePx?.toFixed(2)}px` +
        ` confirm=${clearance.confirm.clearancePx?.toFixed(2)}px` +
        ` confirmLabel=${clearance.confirmLabel.clearancePx?.toFixed(2)}px`
      )

      expect(
        clearance.faults.clearancePx,
        `alert strip occludes FAULTS row — reservation failed`
      ).toBeGreaterThanOrEqual(-CLEARANCE_TOLERANCE_PX)
      // GUARD (defect 6) — the reserved alert floor band now covers the native canvas too, so the
      // CONFIRM READY control gets the same 2 px sub-pixel tolerance as FAULTS and the label. No
      // budget remains.
      //
      // The strip used to overlap the control by 3.47 px here. RC19_COMPACT_ALERT_FLOOR_PCT = 9
      // reserved the band by shortening the COMPACT content area and worked at all four compact
      // viewports, and the app canvas is covered by the 36 px packet 12.1 leaves below its columns;
      // only the native canvas was unprotected — its `confirm` zone ran to ~460 px of a 480 px
      // frame while the 24.50 px strip is anchored to `bottom: 0` and started at ~455.50 px.
      // FAULTS cleared by 2.70 px and the CONFIRM READY LABEL by 9.41 px; the control's own box
      // did not. RC19_NATIVE_ALERT_FLOOR_PX = 30 now reserves the band in pixels.
      expect(
        clearance.confirm.clearancePx,
        `alert strip occludes the CONFIRM READY control ` +
          `(measured ${clearance.confirm.clearancePx?.toFixed(2)}px clearance)`
      ).toBeGreaterThanOrEqual(-CLEARANCE_TOLERANCE_PX)
      expect(
        clearance.confirmLabel.clearancePx,
        `alert strip occludes CONFIRM READY label — reservation failed`
      ).toBeGreaterThanOrEqual(-CLEARANCE_TOLERANCE_PX)
    } finally {
      await context.close()
    }
  }
)

// ─────────────────────────────────────────────────────────── cold-mount dash count test

test(
  'cold-mount: exactly 9 dashes in the native canvas (STINT LAPS is the 9th)',
  async ({ browser }) => {
    /**
     * Headline promise #2: a cold mount (no observed pit exit) renders NINE "--" readouts on
     * the native 800×480 canvas. The widget's own test (line ~869) asserts the same. The 9th
     * is STINT LAPS, which honestly dashes because the Rc19StintTracker is unmarked.
     */
    const size = viewports[0]  // 800×480 native
    const { context, page } = await openCapture(browser, size, { layout: 'native', state: 'cold-mount' })
    try {
      const result = await page.locator('#racecon-rc19-capture-root').evaluate((root) => {
        const leaves = Array.from(root.querySelectorAll('*'))
          .filter((node) => node.childElementCount === 0)
          .map((node) => (node.textContent ?? '').trim())
          .filter((text) => text.length > 0)
        const dashCount = leaves.filter((t) => t === '--').length
        const stintLapsText = root.querySelector('[data-testid="rc19-stint-laps"]')?.textContent?.trim() ?? null
        return { dashCount, stintLapsText, leaves }
      })

      expect(result.stintLapsText, 'STINT LAPS must dash on a cold mount').toBe('--')
      expect(result.dashCount, `expected 9 dashes on cold-mount native; got ${result.dashCount}`).toBe(9)
    } finally {
      await context.close()
    }
  }
)
