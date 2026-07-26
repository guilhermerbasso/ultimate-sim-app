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
  if (!baseUrl) throw new Error('RC-07 visual-audit server did not report a local URL')
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
  state: string,
  expected: { layout: 'native' | 'app' | 'compact'; compactMode?: 'phone' | 'landscape' }
): Promise<{ context: Awaited<ReturnType<Browser['newContext']>>; page: Page }> {
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'dark'
  })
  const page = await context.newPage()
  const target = new URL('racecon-rc07-capture.html', baseUrl)
  target.searchParams.set('width', String(size.width))
  target.searchParams.set('height', String(size.height))
  target.searchParams.set('state', state)
  await page.goto(target.href, { waitUntil: 'networkidle' })
  await page.waitForFunction(
    ({ layout, compactMode, alertState }) => {
      const root = document.querySelector('#racecon-rc07-capture-root')
      const widget = root?.querySelector<HTMLElement>('[data-widget="raceconRc07Dash"]')
      if (!root || !widget) return false
      if (root.getAttribute('data-capture-ready') !== 'true') return false
      if (widget.dataset.rc07BufferState !== 'accepted') return false
      if (widget.dataset.rc07Layout !== layout) return false
      if (compactMode !== undefined && widget.dataset.rc07CompactMode !== compactMode) return false
      // For proximity, wait for the alert to engage
      if (alertState === 'proximity') return widget.dataset.rc07Alerts === 'active'
      return widget.dataset.rc07Alerts === 'silent'
    },
    { layout: expected.layout, compactMode: expected.compactMode, alertState: state },
    { timeout: 90_000 }
  )
  return { context, page }
}

const viewports = [
  { width: 800,  height: 480,  layout: 'native',  compactMode: null },
  { width: 1024, height: 600,  layout: 'app',     compactMode: null },
  { width: 393,  height: 759,  layout: 'compact', compactMode: 'phone' },
  { width: 412,  height: 867,  layout: 'compact', compactMode: 'phone' },
  { width: 759,  height: 393,  layout: 'compact', compactMode: 'landscape' },
  { width: 867,  height: 412,  layout: 'compact', compactMode: 'landscape' }
] as const

async function readGeometry(page: Page, state: string) {
  return page.locator('#racecon-rc07-capture-root').evaluate((root, captureState) => {
    const rootRect = root.getBoundingClientRect()
    const relative = (element: Element): Rect => {
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
    const widget = root.querySelector<HTMLElement>('[data-widget="raceconRc07Dash"]')!
    const dashboard = root.querySelector<HTMLElement>('.rc07-dashboard')!

    const zoneNames = ['rc07-flag', 'rc07-radar', 'rc07-behind', 'rc07-ahead', 'rc07-self', 'rc07-tower']
    const zones = zoneNames.map((name) => {
      const el = root.querySelector<HTMLElement>(`.${name}`) ??
                 root.querySelector<HTMLElement>(`[data-rc07-zone="${name.replace('rc07-', '')}"]`)
      if (!el) return { name, rect: null, display: 'none', present: false, area: 0 }
      const r = relative(el)
      return { name, rect: r, display: getComputedStyle(el).display, present: true, area: r.width * r.height }
    })

    const measureValue = (label: string, selector: string) => {
      const el = root.querySelector<HTMLElement>(selector)
      if (!el) return null
      const style = getComputedStyle(el)
      return {
        label,
        text: el.textContent?.trim() ?? '',
        fontSize: Number.parseFloat(style.fontSize),
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        rect: relative(el)
      }
    }

    const radarPlot = root.querySelector<HTMLElement>('[data-testid="rc07-radar-plot"]')
    const radarEdge = root.querySelector<HTMLElement>('[data-testid="rc07-radar-edge"]')
    const flagDuty  = root.querySelector<HTMLElement>('[data-testid="rc07-flag-duty"]')
    const behindDir = root.querySelector<HTMLElement>('[data-testid="rc07-behind-direction"]')
    const aheadDir  = root.querySelector<HTMLElement>('[data-testid="rc07-ahead-direction"]')

    const blipEls = Array.from(root.querySelectorAll<HTMLElement>('[data-testid="rc07-blip"]'))
    const radarPlotRect = radarPlot ? relative(radarPlot) : null

    // Type scale: find zone header labels by text content
    const LABEL_TEXTS = new Set(['FLAG', 'BEHIND', 'AHEAD', 'RADAR', 'GEAR', 'POS', 'DELTA', 'NEAREST'])
    const labelEl = Array.from(root.querySelectorAll('*')).find(
      (el) => el.childElementCount === 0 && LABEL_TEXTS.has((el.textContent ?? '').trim())
    )

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
      page: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
      root: { ...rootRect, right: rootRect.right, bottom: rootRect.bottom },
      layout: widget.dataset.rc07Layout,
      compactMode: widget.dataset.rc07CompactMode ?? null,
      contentWidth: widget.dataset.rc07ContentWidth,
      contentHeight: widget.dataset.rc07ContentHeight,
      alerts: widget.dataset.rc07Alerts,
      alertKeys: widget.dataset.rc07AlertKeys,
      criticalSide: widget.dataset.rc07CriticalSide,
      radarState: widget.dataset.rc07Radar,
      radarRange: widget.dataset.rc07RadarRange,
      dashboardOverflow: {
        clientWidth: dashboard.clientWidth,
        scrollWidth: dashboard.scrollWidth,
        clientHeight: dashboard.clientHeight,
        scrollHeight: dashboard.scrollHeight
      },
      zones,
      radarPlotRect,
      radarEdgePresent: !!radarEdge,
      radarEdgeSide: radarEdge?.getAttribute('data-rc07-side') ?? null,
      flagDutyPresent: !!flagDuty,
      behindDirectionText: behindDir?.textContent?.trim() ?? null,
      aheadDirectionText:  aheadDir?.textContent?.trim() ?? null,
      blipCount: blipEls.length,
      blips: blipEls.map((blip) => ({
        rank: Number.parseInt(blip.getAttribute('data-rc07-rank') ?? '-1', 10),
        radius: Number.parseFloat(blip.getAttribute('data-rc07-radius') ?? 'NaN'),
        side: blip.getAttribute('data-rc07-side'),
        longitudinal: blip.getAttribute('data-rc07-longitudinal'),
        critical: blip.getAttribute('data-rc07-critical') === 'true',
        rect: radarPlotRect ? relative(blip) : null
      })),
      ringCount: root.querySelectorAll('[data-testid="rc07-ring"]').length,
      towerRowCount: root.querySelectorAll('[data-testid="rc07-tower-row"]').length,
      towerEmptyCount: root.querySelectorAll('[data-testid="rc07-tower-empty"]').length,
      // Forbidden omission selectors
      shiftLedCount: root.querySelectorAll('[class*="rc07-shift"], [class*="rc07-led"], [class*="rc07-rev-"], [class*="rc07-over-rev"], [data-rc07-zone="rpm"]').length,
      rangeLegendCount: root.querySelectorAll('[data-testid="rc07-radar-range-legend"], [class*="rc07-range-legend"]').length,
      // App-only cells
      speedCell: measureValue('speed', '.rc07-cell[data-rc07-cell="speed"] output'),
      fuelCell:  measureValue('fuel',  '.rc07-cell[data-rc07-cell="fuel"] output'),
      flagCell:  measureValue('flag',  '.rc07-cell[data-rc07-cell="flag"] output'),
      // Type scale
      values: [
        measureValue('gap value', '[data-testid="rc07-behind-value"]'),
        measureValue('self value', '.rc07-cell[data-rc07-cell="gear"] output'),
        measureValue('class badge', '.rc07-class-badge'),
        labelEl ? { label: 'label', text: (labelEl.textContent ?? '').trim(), fontSize: Number.parseFloat(getComputedStyle(labelEl as HTMLElement).fontSize), clientWidth: (labelEl as HTMLElement).clientWidth, scrollWidth: (labelEl as HTMLElement).scrollWidth, rect: relative(labelEl as HTMLElement) } : null
      ].filter((v): v is NonNullable<typeof v> => v !== null)
    }
  }, state)
}

for (const size of viewports) {
  const label = size.compactMode ? `${size.layout}/${size.compactMode}` : size.layout
  const sizeKey = `${size.width}x${size.height}`

  test(`${sizeKey} keeps the ${label} RC-07 silent composition contained`, async ({ browser }) => {
    const { context, page } = await openCapture(browser, size, 'silent', {
      layout: size.layout,
      compactMode: size.compactMode ?? undefined
    })
    try {
      const geometry = await readGeometry(page, 'silent')

      expect(geometry.viewport).toEqual({ width: size.width, height: size.height, dpr: 1 })
      expect(geometry.layout).toBe(size.layout)
      expect(geometry.compactMode).toBe(size.compactMode)
      expect(geometry.contentWidth).toBe(String(size.width))
      expect(geometry.contentHeight).toBe(String(size.height))
      expect(geometry.page.scrollWidth).toBe(geometry.page.clientWidth)
      expect(geometry.dashboardOverflow.scrollWidth).toBeLessThanOrEqual(geometry.dashboardOverflow.clientWidth)
      expect(geometry.dashboardOverflow.scrollHeight).toBeLessThanOrEqual(geometry.dashboardOverflow.clientHeight)

      // Alert state: silent
      expect(geometry.alerts).toBe('silent')
      expect(geometry.alertKeys).toBe('')
      expect(geometry.criticalSide).toBe('none')

      // Radar must be live
      expect(geometry.radarState).toBe('live')

      // RC07_PACKET_OMISSIONS checks
      // shiftCue: no shift-LED or over-rev element exists anywhere
      expect(geometry.shiftLedCount).toBe(0)
      // rangeSoftKeyLegend: no range legend label element exists
      expect(geometry.rangeLegendCount).toBe(0)
      // passAdvice / closingRateNumeral: direction glyphs contain no digits
      if (geometry.behindDirectionText !== null) {
        expect(geometry.behindDirectionText).not.toMatch(/\d/u)
      }
      if (geometry.aheadDirectionText !== null) {
        expect(geometry.aheadDirectionText).not.toMatch(/\d/u)
      }

      // Silent: no alert elements
      expect(geometry.flagDutyPresent).toBe(false)
      expect(geometry.radarEdgePresent).toBe(false)

      // Radar must have exactly 2 rings
      expect(geometry.ringCount).toBe(2)

      // Silent frame: exactly 4 blips
      expect(geometry.blipCount).toBe(4)
      const radii = geometry.blips.map((b) => b.radius).sort((a, b) => a - b)
      const spread = radii.length >= 2 ? radii[radii.length - 1] - radii[0] : 0
      expect(spread).toBeGreaterThanOrEqual(12)
      for (const blip of geometry.blips) {
        expect(blip.critical).toBe(false)
        expect(blip.radius).toBeGreaterThan(20)  // none inside inner ring
      }

      // Blip containment inside radar plot
      if (geometry.radarPlotRect) {
        for (const blip of geometry.blips) {
          if (!blip.rect) continue
          const cx = blip.rect.left + blip.rect.width / 2
          const cy = blip.rect.top  + blip.rect.height / 2
          expect(cx).toBeGreaterThanOrEqual(geometry.radarPlotRect.left - 2)
          expect(cy).toBeGreaterThanOrEqual(geometry.radarPlotRect.top  - 2)
          expect(cx).toBeLessThanOrEqual(geometry.radarPlotRect.right  + 2)
          expect(cy).toBeLessThanOrEqual(geometry.radarPlotRect.bottom + 2)
        }
      }

      // Zone height ordering: behind > ahead > self (governance evidence, normative)
      // Known defects (see RC07_SPEC.knownDefects):
      //  compact/phone: behind and ahead are SIDE-BY-SIDE with equal height (design choice:
      //    single `--rc07-phone-gap-height` token), skip the between-gap check.
      //  app + compact/landscape: ahead may be shorter than self; tolerate within budgets.
      const isCompactPhone = size.compactMode === 'phone'
      const isCompactLandscape = size.compactMode === 'landscape'
      const behind = geometry.zones.find((z) => z.name === 'rc07-behind')
      const ahead  = geometry.zones.find((z) => z.name === 'rc07-ahead')
      const self   = geometry.zones.find((z) => z.name === 'rc07-self')
      if (behind?.rect && ahead?.rect && self?.rect) {
        if (!isCompactPhone) {
          expect(behind.rect.height, 'behind must be taller than ahead').toBeGreaterThan(ahead.rect.height)
        }
        const aheadSelfDelta = self.rect.height - ahead.rect.height
        if (aheadSelfDelta > 0) {
          // ahead < self: only tolerated within the per-layout budget.
          const budget = size.layout === 'app' ? 8 : isCompactLandscape ? 9 : 0
          expect(aheadSelfDelta, `ahead must be taller than self (known defect budget ${budget}px)`).toBeLessThanOrEqual(budget)
        }
      }

      // Tower: absent from DOM in native and compact; present and visible only in app
      const tower = geometry.zones.find((z) => z.name === 'rc07-tower')
      if (size.layout === 'app') {
        expect(tower?.present).toBe(true)
        expect(tower?.display).not.toBe('none')
      } else {
        // Must be absent from DOM (not just display:none)
        expect(tower?.present).toBe(false)
      }

      // Type scale: gap value > self value > class badge > label
      // Known defects: badge may equal or exceed self-value in compact/phone (tie, budget 0.5px),
      // app and compact/landscape (inversion, budgets 2px and 4px respectively).
      const scale = geometry.values
      if (scale.length >= 2) {
        // gap > self-value: always strict
        expect(scale[0].fontSize, `${scale[0].label} must be strictly larger than ${scale[1].label}`).toBeGreaterThan(scale[1].fontSize)
      }
      if (scale.length >= 3) {
        // self-value vs class-badge: budget-aware per layout
        const selfBadgeDelta = scale[2].fontSize - scale[1].fontSize  // positive if badge > self
        const tsBudget = size.layout === 'app' ? 2.0
          : isCompactPhone    ? 0.5
          : isCompactLandscape ? 4.0
          : -0.001  // native: selfBadgeDelta must be negative (strict hierarchy, no tie)
        expect(selfBadgeDelta,
          `${scale[1].label} must be larger than ${scale[2].label} (budget ${tsBudget}px)`
        ).toBeLessThan(tsBudget + 0.001)
      }
      if (scale.length >= 4) {
        // badge > label: always strict
        expect(scale[2].fontSize, `${scale[2].label} must be strictly larger than ${scale[3].label}`).toBeGreaterThan(scale[3].fontSize)
      }

      // App-only cells visible only at 1024×600
      if (size.layout === 'app') {
        expect(geometry.speedCell).not.toBeNull()
        expect(geometry.speedCell?.text).toBe('178')
        expect(geometry.fuelCell).not.toBeNull()
        expect(geometry.fuelCell?.text).toBe('--')
        expect(geometry.flagCell).not.toBeNull()
        expect(geometry.flagCell?.text).toBe('GREEN')
      } else {
        expect(geometry.speedCell).toBeNull()
        expect(geometry.fuelCell).toBeNull()
        expect(geometry.flagCell).toBeNull()
      }

      // All visible zones inside the frame
      const rootRect: Rect = { left: 0, top: 0, width: size.width, height: size.height, right: size.width, bottom: size.height }
      for (const zone of geometry.zones) {
        if (!zone.present || zone.display === 'none' || !zone.rect) continue
        if (zone.area <= 0) continue
        expectContained(rootRect, zone.rect, 0.5)
      }

      // Visible zones do not overlap (RC-07 has no declared zone overlaps)
      const visibleZones = geometry.zones.filter((z) => z.present && z.display !== 'none' && z.rect && z.area > 0)
      for (let a = 0; a < visibleZones.length; a += 1) {
        for (let b = a + 1; b < visibleZones.length; b += 1) {
          const first  = visibleZones[a].rect!
          const second = visibleZones[b].rect!
          const overlapX = Math.min(first.right, second.right)   - Math.max(first.left, second.left)
          const overlapY = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top)
          expect(
            Math.min(overlapX, overlapY),
            `${visibleZones[a].name} overlaps ${visibleZones[b].name}`
          ).toBeLessThanOrEqual(0.5)
        }
      }

      const capture = await page.locator('#racecon-rc07-capture-root').screenshot({ animations: 'disabled' })
      expect(capture.byteLength).toBeGreaterThan(3_000)
    } finally {
      await context.close()
    }
  })
}

test('the proximity alert fires the radar edge and scopes to the radar zone', async ({ browser }) => {
  const size = viewports[0]  // 800×480 native
  const { context, page } = await openCapture(browser, size, 'proximity', { layout: 'native' })
  try {
    await expect
      .poll(
        async () => page.locator('[data-widget="raceconRc07Dash"]').getAttribute('data-rc07-alerts'),
        { timeout: 60_000 }
      )
      .toBe('active')

    const alert = await page.locator('#racecon-rc07-capture-root').evaluate((root) => {
      const rootRect = root.getBoundingClientRect()
      const relative = (el: Element): Rect => {
        const r = el.getBoundingClientRect()
        return { left: r.left - rootRect.left, top: r.top - rootRect.top, width: r.width, height: r.height, right: r.right - rootRect.left, bottom: r.bottom - rootRect.top }
      }
      const widget    = root.querySelector<HTMLElement>('[data-widget="raceconRc07Dash"]')!
      const radarEl   = root.querySelector<HTMLElement>('.rc07-radar')
      const edgeEl    = root.querySelector<HTMLElement>('[data-testid="rc07-radar-edge"]')
      const critBlips = Array.from(root.querySelectorAll<HTMLElement>('[data-testid="rc07-blip"][data-rc07-critical="true"]'))
      return {
        alerts:       widget.dataset.rc07Alerts,
        alertKeys:    widget.dataset.rc07AlertKeys,
        criticalSide: widget.dataset.rc07CriticalSide,
        edgePresent:  !!edgeEl,
        edgeSide:     edgeEl?.getAttribute('data-rc07-side') ?? null,
        edgeRect:     edgeEl  ? relative(edgeEl)  : null,
        radarRect:    radarEl ? relative(radarEl)  : null,
        critBlipCount: critBlips.length,
        critBlipRadii: critBlips.map((b) => Number.parseFloat(b.getAttribute('data-rc07-radius') ?? 'NaN')),
        behindDirection: root.querySelector('[data-testid="rc07-behind-direction"]')?.textContent?.trim() ?? null,
        shiftLeds: root.querySelectorAll('[class*="rc07-shift"], [class*="rc07-led"], [class*="rc07-rev-"], [class*="rc07-over-rev"]').length,
        passText: (root.textContent ?? '').includes('PASS') || (root.textContent ?? '').includes('HOLD')
      }
    })

    expect(alert.alerts).toBe('active')
    expect(alert.alertKeys).toContain('PROXIMITY')
    expect(['left', 'right', 'both']).toContain(alert.criticalSide)
    expect(alert.edgePresent).toBe(true)
    expect(alert.edgeSide).toBe(alert.criticalSide)

    // Radar edge must be contained within the radar zone
    if (alert.edgeRect && alert.radarRect) {
      expect(alert.edgeRect.left).toBeGreaterThanOrEqual(alert.radarRect.left - 0.5)
      expect(alert.edgeRect.right).toBeLessThanOrEqual(alert.radarRect.right + 0.5)
      expect(alert.edgeRect.top).toBeGreaterThanOrEqual(alert.radarRect.top - 0.5)
      expect(alert.edgeRect.bottom).toBeLessThanOrEqual(alert.radarRect.bottom + 0.5)
    }

    // At least one critical blip, all inside the inner ring (20 units)
    expect(alert.critBlipCount).toBeGreaterThanOrEqual(1)
    for (const radius of alert.critBlipRadii) {
      expect(radius).toBeLessThan(20)  // inside critical zone
    }

    // Packet omissions remain in force even during the alert
    expect(alert.shiftLeds).toBe(0)
    expect(alert.passText).toBe(false)
    // Direction glyph still contains no digit
    if (alert.behindDirection !== null) {
      expect(alert.behindDirection).not.toMatch(/\d/u)
    }
  } finally {
    await context.close()
  }
})
