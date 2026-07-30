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
  if (!baseUrl) throw new Error('RC-16 visual-audit server did not report a local URL')
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
    compactMode?: 'phone' | 'landscape' | null
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
  const target = new URL('racecon-rc16-capture.html', baseUrl)
  target.searchParams.set('width', String(size.width))
  target.searchParams.set('height', String(size.height))
  target.searchParams.set('state', expected.state)
  await page.goto(target.href, { waitUntil: 'networkidle' })

  // Wait for the widget to reach the governed ready state.
  await page.waitForFunction(
    ({ layout, compactMode, state: captureState }) => {
      const root   = document.querySelector('#racecon-rc16-capture-root')
      const widget = root?.querySelector<HTMLElement>('[data-widget="raceconRc16Dash"]')
      if (!root || !widget) return false
      if (root.getAttribute('data-capture-ready') !== 'true') return false
      if (widget.dataset.rc16BufferState !== 'accepted') return false
      if (widget.dataset.rc16Layout !== layout) return false
      if (compactMode != null && widget.dataset.rc16CompactMode !== compactMode) return false
      // over-rev state: wait for the gentleOverRev alert to latch
      if (captureState === 'over-rev' && widget.dataset.rc16Alerts !== 'active') return false
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
  return page.locator('#racecon-rc16-capture-root').evaluate((root) => {
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
    const widget    = root.querySelector<HTMLElement>('[data-widget="raceconRc16Dash"]')!
    const dashboard = root.querySelector<HTMLElement>('.rc16-dashboard')!

    const attr = (name: string): string | null =>
      widget.dataset[name.replace(/-./g, m => m[1].toUpperCase())] ?? null

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

    // Ring SVG geometry for gap measurement
    const ringSvgEl = root.querySelector('[data-testid="rc16-ring"] svg')
    const guideEl   = root.querySelector<SVGCircleElement>('[data-testid="rc16-ring-guide"]')
    const bandEl    = root.querySelector<SVGCircleElement>('[data-testid="rc16-ring-band"]')

    const svgViewBoxAttr = ringSvgEl?.getAttribute('viewBox') ?? ''
    const svgViewBoxParts = svgViewBoxAttr.split(/\s+/)
    const svgViewBoxWidth = svgViewBoxParts.length >= 4
      ? Number.parseFloat(svgViewBoxParts[2]) : 100

    const guideRVb  = guideEl  ? Number.parseFloat(guideEl.getAttribute('r') ?? 'NaN')  : null
    const bandRVb   = bandEl   ? Number.parseFloat(bandEl.getAttribute('r') ?? 'NaN')   : null
    const bandSwVb  = bandEl
      ? Number.parseFloat(bandEl.getAttribute('stroke-width') ?? getComputedStyle(bandEl).strokeWidth ?? 'NaN')
      : null
    const svgRenderedWidth = ringSvgEl?.getBoundingClientRect().width ?? null

    const ringNativeZoneWidth = 260  // RC16_NATIVE_ZONES_PX.ring.width
    const gapVb = (guideRVb != null && bandRVb != null && bandSwVb != null)
      ? guideRVb - (bandRVb + bandSwVb / 2) : null
    const nativeEquivGapPx = gapVb != null
      ? gapVb * ringNativeZoneWidth / svgViewBoxWidth : null

    const zoneNames: [string, string][] = [
      ['ring',       '[data-testid="rc16-ring"]'],
      ['smoothness', '[data-testid="rc16-smoothness-panel"]'],
      ['cue',        '[data-testid="rc16-cue-panel"]'],
      ['delta',      '[data-testid="rc16-delta-panel"]'],
      ['summary',    '[data-testid="rc16-summary-panel"]']
    ]
    const zones = zoneNames.map(([name, selector]) => {
      const element = root.querySelector<HTMLElement>(selector)
      const rect = element ? relative(element)! : { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }
      return { name, rect, display: element ? getComputedStyle(element).display : 'none' }
    })

    return {
      viewport:      { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
      page:          { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
      root:          relative(root)!,
      layout:        attr('rc16Layout'),
      compactMode:   attr('rc16CompactMode'),
      alerts:        attr('rc16Alerts'),
      focus:         attr('rc16Focus'),
      laps:          attr('rc16Laps'),
      bufferState:   attr('rc16BufferState'),
      contentWidth:  attr('rc16ContentWidth'),
      contentHeight: attr('rc16ContentHeight'),
      nativeSize:    dashboard?.getAttribute('data-rc16-native-size') ?? null,
      dashboardOverflow: {
        clientWidth:  dashboard?.clientWidth  ?? 0,
        scrollWidth:  dashboard?.scrollWidth  ?? 0,
        clientHeight: dashboard?.clientHeight ?? 0,
        scrollHeight: dashboard?.scrollHeight ?? 0
      },
      // Counts
      summaryRowCount:     root.querySelectorAll('[data-testid="rc16-summary-row"]').length,
      cueLineCount:        root.querySelectorAll('.rc16-cue-line').length,
      panelCount:          root.querySelectorAll('.rc16-panel').length,
      zoneCount:           root.querySelectorAll('[data-rc16-zone]').length,
      historyPanelPresent: root.querySelector('[data-testid="rc16-history-panel"]') !== null,
      focusSelectorCount:  root.querySelectorAll('[data-testid="rc16-focus-selector"]').length,
      // Packet omission probes
      shiftLightCount:  root.querySelectorAll('.rc16-led, .rc16-shift, .rc16-rev, [data-rc16-zone="shift"], [data-channel="rpm"]').length,
      gearSpeedCount:   root.querySelectorAll('.rc16-gear, .rc16-speed, [data-rc16-zone="gear"], [data-rc16-zone="speed"]').length,
      rpmBestLapCount:  root.querySelectorAll('[data-rc16-zone="rpm"], [data-rc16-zone="best-lap"]').length,
      focusSelectorHasZone: root.querySelector('[data-testid="rc16-focus-selector"]')?.hasAttribute('data-rc16-zone') ?? false,
      // Ring geometry
      ring: {
        guideRVb, bandRVb, bandSwVb,
        svgRenderedWidth, svgViewBoxWidth,
        gapVb, nativeEquivGapPx,
        midAttr:  root.querySelector('[data-testid="rc16-ring"]')?.getAttribute('data-rc16-ring-mid') ?? null,
        gapAttr:  root.querySelector('[data-testid="rc16-ring"]')?.getAttribute('data-rc16-ring-gap') ?? null,
        available: root.querySelector('[data-testid="rc16-ring"]')?.getAttribute('data-rc16-ring-available') ?? null
      },
      // Cue alert attributes
      cuePanelAlert:   root.querySelector('[data-testid="rc16-cue-panel"]')?.getAttribute('data-rc16-cue-alert') ?? null,
      cuePanelIsAlert: root.querySelector('[data-testid="rc16-cue-panel"]')?.classList.contains('is-alert') ?? false,
      // Zone rects for overlap / containment
      zones,
      // Type-scale values
      values: [
        measure('consistency', '[data-testid="rc16-consistency"]'),
        measure('delta',       '[data-testid="rc16-delta"]'),
        measure('smoothness',  '[data-testid="rc16-smoothness"]'),
        measure('cue',         '.rc16-cue-line'),
        measure('summary',     '[data-testid="rc16-summary-lastLap"]')
      ].filter((entry): entry is NonNullable<typeof entry> => entry !== null),
      // Containment spot-checks
      ringZoneRect:      relative(root.querySelector('[data-testid="rc16-ring"]')),
      consistencyRect:   relative(root.querySelector('[data-testid="rc16-consistency"]')),
      smoothnessPanelRect: relative(root.querySelector('[data-testid="rc16-smoothness-panel"]')),
      smoothnessValRect: relative(root.querySelector('[data-testid="rc16-smoothness"]')),
      cuePanelRect:      relative(root.querySelector('[data-testid="rc16-cue-panel"]')),
      cueLinesRect:      relative(root.querySelector('[data-testid="rc16-cue-lines"]')),
      deltaZoneRect:     relative(root.querySelector('[data-testid="rc16-delta-panel"]')),
      deltaValRect:      relative(root.querySelector('[data-testid="rc16-delta"]')),
      summaryZoneRect:   relative(root.querySelector('[data-testid="rc16-summary-panel"]')),
      lastLapRect:       relative(root.querySelector('[data-testid="rc16-summary-lastLap"]')),
      // Every summary readout with the cell it is laid out in and the row that holds both.
      // `.rc16-summary-value` used to carry `flex-shrink: 1`, so a full m:ss.mmm lap time was
      // squeezed below its own nowrap width and painted past the cell while `scrollWidth ===
      // clientWidth` on every ancestor. Only the range rect can see that.
      summaryReadouts: Array.from(root.querySelectorAll<HTMLElement>('.rc16-summary-value')).map((node) => {
        const range = document.createRange()
        range.selectNodeContents(node)
        const ink = range.getBoundingClientRect()
        const box = node.getBoundingClientRect()
        const row = node.closest<HTMLElement>('.rc16-summary-row')
        const rowRect = row?.getBoundingClientRect() ?? null
        return {
          testid: node.getAttribute('data-testid') ?? '',
          text: (node.textContent ?? '').trim(),
          clientWidth: node.clientWidth,
          scrollWidth: node.scrollWidth,
          inkWidth: ink.width,
          boxRight: box.right - rootRect.left,
          inkRight: ink.right - rootRect.left,
          rowRight: rowRect ? rowRect.right - rootRect.left : null
        }
      })
    }
  })
}

for (const size of viewports) {
  const label    = size.compactMode ? `${size.layout}/${size.compactMode}` : size.layout
  const sizeKey  = `${size.width}x${size.height}`
  const isApp    = size.layout === 'app'
  const isNative = size.layout === 'native'

  test(`${sizeKey} keeps the ${label} RC-16 composition contained (silent)`, async ({ browser }) => {
    const { context, page } = await openCapture(browser, size, {
      layout: size.layout,
      compactMode: size.compactMode,
      state: 'silent'
    })
    try {
      // Buffer state confirmed as accepted
      await expect
        .poll(async () => page.locator('[data-widget="raceconRc16Dash"]').getAttribute('data-rc16-buffer-state'))
        .toBe('accepted')

      const geometry = await readGeometry(page)

      // Viewport and layout
      expect(geometry.viewport).toEqual({ width: size.width, height: size.height, dpr: 1 })
      expect(geometry.layout).toBe(size.layout)
      expect(geometry.compactMode).toBe(size.compactMode)
      expect(geometry.contentWidth).toBe(String(size.width))
      expect(geometry.contentHeight).toBe(String(size.height))
      expect(geometry.alerts).toBe('silent')
      expect(geometry.laps).toBe('3')

      // Native-size modifier
      expect(geometry.nativeSize).toBe(isNative ? '800x480' : null)

      // No horizontal scrollbar
      expect(geometry.page.scrollWidth).toBe(geometry.page.clientWidth)
      expect(geometry.dashboardOverflow.scrollWidth).toBeLessThanOrEqual(geometry.dashboardOverflow.clientWidth)

      // Fixed structural counts
      expect(geometry.summaryRowCount).toBe(2)
      expect(geometry.cueLineCount).toBe(2)
      expect(geometry.panelCount).toBe(isApp ? 5 : 4)
      expect(geometry.zoneCount).toBe(isApp ? 6 : 5)

      // History panel: app-only
      expect(geometry.historyPanelPresent).toBe(isApp)

      // Focus selector always in DOM, never a zone (ZG-6)
      expect(geometry.focusSelectorCount).toBe(1)
      expect(geometry.focusSelectorHasZone).toBe(false)

      // Packet omissions
      expect(geometry.shiftLightCount, 'no shift-light, rev-arc or RPM surface (shiftLightZone)').toBe(0)
      expect(geometry.gearSpeedCount, 'no gear or speed readout (cornerSpeedAndGearZone)').toBe(0)
      expect(geometry.rpmBestLapCount, 'no RPM or best-lap zone (speedRpmBestLapZone)').toBe(0)

      // Ring availability and separation
      expect(geometry.ring.available).toBe('true')
      if (geometry.ring.nativeEquivGapPx != null) {
        expect(geometry.ring.nativeEquivGapPx, `ring gap at ${sizeKey} silent`).toBeGreaterThanOrEqual(7.5)
        expect(geometry.ring.nativeEquivGapPx).toBeLessThanOrEqual(18.5)
      }

      // Cue alert must be silent
      expect(geometry.cuePanelAlert).toBe('false')
      expect(geometry.cuePanelIsAlert).toBe(false)

      // Type-scale hierarchy: ringValue > delta > smoothness > cue > summary (strict)
      const scale = ['consistency', 'delta', 'smoothness', 'cue', 'summary'].map(
        (name) => geometry.values.find((v) => v.label === name)!
      )
      for (let index = 1; index < scale.length; index += 1) {
        if (scale[index - 1] && scale[index]) {
          expect(
            scale[index - 1].fontSize,
            `${scale[index - 1].label} must be strictly larger than ${scale[index].label}`
          ).toBeGreaterThan(scale[index].fontSize)
        }
      }

      // Zone geometry: no peer zone overlaps, all inside frame
      const frameRect: Rect = {
        left: 0, top: 0,
        width: size.width, height: size.height,
        right: size.width, bottom: size.height
      }
      for (const zone of geometry.zones) {
        if (zone.rect.width > 0 && zone.rect.height > 0) {
          expectContained(frameRect, zone.rect, 1)
        }
      }
      const visibleZones = geometry.zones.filter(z => z.display !== 'none' && z.rect.width > 0 && z.rect.height > 0)
      for (let a = 0; a < visibleZones.length; a += 1) {
        for (let b = a + 1; b < visibleZones.length; b += 1) {
          const first  = visibleZones[a]
          const second = visibleZones[b]
          const overlapX = Math.min(first.rect.right, second.rect.right)   - Math.max(first.rect.left, second.rect.left)
          const overlapY = Math.min(first.rect.bottom, second.rect.bottom) - Math.max(first.rect.top,  second.rect.top)
          expect(
            Math.min(overlapX, overlapY),
            `${first.name} overlaps ${second.name} at ${sizeKey}`
          ).toBeLessThanOrEqual(0.5)
        }
      }

      // Containment spot-checks
      if (geometry.ringZoneRect && geometry.consistencyRect) {
        expectContained(geometry.ringZoneRect, geometry.consistencyRect)
      }
      if (geometry.smoothnessPanelRect && geometry.smoothnessValRect) {
        expectContained(geometry.smoothnessPanelRect, geometry.smoothnessValRect)
      }
      if (geometry.cuePanelRect && geometry.cueLinesRect) {
        expectContained(geometry.cuePanelRect, geometry.cueLinesRect)
      }
      if (geometry.deltaZoneRect && geometry.deltaValRect) {
        expectContained(geometry.deltaZoneRect, geometry.deltaValRect)
      }
      if (geometry.summaryZoneRect && geometry.lastLapRect) {
        expectContained(geometry.summaryZoneRect, geometry.lastLapRect)
      }

      // GUARD (defect 3) — no summary readout may be squeezed below its own nowrap text.
      //
      // `LAST LAP` "1:42.318" painted 17px past a 124px cell at 1024x600, 19px past 87px at
      // 759x393 and 22px past 99px at 867x412, in both governed states, while `scrollWidth ===
      // clientWidth` reported that everything fitted. The numeral is the reading and the label is
      // its annotation, so `.rc16-summary-value` is now `flex: 1 0 auto` and the label gives way.
      // This runs at all six viewports, which includes all three the defect was measured at.
      expect(geometry.summaryReadouts.length).toBeGreaterThan(0)
      for (const readout of geometry.summaryReadouts) {
        expect(
          readout.scrollWidth - readout.clientWidth,
          `${readout.testid} "${readout.text}" overflows its ${readout.clientWidth}px cell`
        ).toBeLessThanOrEqual(0)
        expect(
          readout.inkWidth - readout.clientWidth,
          `${readout.testid} "${readout.text}" needs ${readout.inkWidth.toFixed(2)}px in a ` +
            `${readout.clientWidth}px cell`
        ).toBeLessThanOrEqual(1)
        if (readout.rowRight !== null) {
          expect(
            readout.inkRight,
            `${readout.testid} "${readout.text}" paints past the summary row that holds it`
          ).toBeLessThanOrEqual(readout.rowRight + 1)
        }
      }

      const capture = await page.locator('#racecon-rc16-capture-root').screenshot({ animations: 'disabled' })
      expect(capture.byteLength).toBeGreaterThan(5_000)
    } finally {
      await context.close()
    }
  })
}

test('the over-rev alert surfaces only inside the cue card zone', async ({ browser }) => {
  // Use the native viewport for the alert test (cleanest zone layout, no crossover).
  const size = viewports[0]  // 800x480 native
  const { context, page } = await openCapture(browser, size, {
    layout: 'native',
    state: 'over-rev'
  })
  try {
    await expect
      .poll(async () =>
        page.locator('[data-widget="raceconRc16Dash"]').getAttribute('data-rc16-alerts'),
        { timeout: 120_000 }
      )
      .toBe('active')

    const alert = await page.locator('#racecon-rc16-capture-root').evaluate((root) => {
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
      const widget   = root.querySelector<HTMLElement>('[data-widget="raceconRc16Dash"]')!
      const cuePanel = root.querySelector<HTMLElement>('[data-testid="rc16-cue-panel"]')
      const cueLine0 = root.querySelectorAll('.rc16-cue-line')[0]
      const cueLine1 = root.querySelectorAll('.rc16-cue-line')[1]

      return {
        alerts:         widget.dataset.rc16Alerts,
        cueAlert:       cuePanel?.getAttribute('data-rc16-cue-alert') ?? null,
        cueIsAlert:     cuePanel?.classList.contains('is-alert') ?? false,
        cueLine0Text:   cueLine0?.textContent?.trim() ?? null,
        cueLine1Text:   cueLine1?.textContent?.trim() ?? null,
        cueIcon:        root.querySelector('[data-testid="rc16-cue-icon"]')?.getAttribute('data-rc16-icon') ?? null,
        cuePanelRect:   relative(cuePanel),
        ringAvailable:  root.querySelector('[data-testid="rc16-ring"]')?.getAttribute('data-rc16-ring-available') ?? null,
        // Packet omission: no shift zone even under over-rev
        shiftLightCount: root.querySelectorAll('.rc16-led, .rc16-shift, [data-rc16-zone="shift"]').length
      }
    })

    // Alert must be active
    expect(alert.alerts).toBe('active')

    // Cue card must carry alert markers
    expect(alert.cueAlert).toBe('true')
    expect(alert.cueIsAlert).toBe(true)

    // Cue content: EASE OFF / UPSHIFT with upshift icon
    expect(alert.cueLine0Text).toBe('EASE OFF')
    expect(alert.cueLine1Text).toBe('UPSHIFT')
    expect(alert.cueIcon).toBe('upshift')

    // Ring still available (3 laps in buffer, independent of alert)
    expect(alert.ringAvailable).toBe('true')

    // Over-rev surfaces as soft cue only, never a shift zone (omission: shiftLightZone)
    expect(alert.shiftLightCount).toBe(0)
  } finally {
    await context.close()
  }
})
