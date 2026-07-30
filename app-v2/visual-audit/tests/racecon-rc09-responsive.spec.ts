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
  if (!baseUrl) throw new Error('RC-09 visual-audit server did not report a local URL')
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
  const target = new URL('racecon-rc09-capture.html', baseUrl)
  target.searchParams.set('width',  String(size.width))
  target.searchParams.set('height', String(size.height))
  target.searchParams.set('state',  expected.state)
  await page.goto(target.href, { waitUntil: 'networkidle' })

  // Wait for the widget to reach the governed ready state.
  // RC-09 scripts 150–300 frames before publishing; use a generous timeout.
  await page.waitForFunction(
    ({ layout, compactMode, state: captureState }) => {
      const root   = document.querySelector('#racecon-rc09-capture-root')
      const widget = root?.querySelector<HTMLElement>('[data-widget="raceconRc09Dash"]')
      if (!root || !widget) return false
      if (root.getAttribute('data-capture-ready') !== 'true') return false
      if (widget.dataset.rc09BufferState !== 'accepted') return false
      if (widget.dataset.rc09Layout !== layout) return false
      if (compactMode !== undefined && widget.dataset.rc09CompactMode !== compactMode) return false
      if (widget.dataset.rc09Roadbook !== 'loaded') return false
      if (captureState === 'split-loss' && widget.dataset.rc09Alerts !== 'active') return false
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

async function readGeometry(page: Page) {
  return page.locator('#racecon-rc09-capture-root').evaluate((root) => {
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
    const widget    = root.querySelector<HTMLElement>('[data-widget="raceconRc09Dash"]')!
    const dashboard = root.querySelector<HTMLElement>('.rc09-dashboard')!

    const attr = (name: string) => widget?.dataset[name.replace(/-./g, m => m[1].toUpperCase())] ?? null

    const measure = (label: string, selector: string) => {
      const element = root.querySelector<HTMLElement>(selector)
      if (!element) return null
      const style = getComputedStyle(element)
      return {
        label,
        text: element.textContent?.trim() ?? '',
        fontSize: Number.parseFloat(style.fontSize),
        clientWidth:  element.clientWidth,
        scrollWidth:  element.scrollWidth,
        rect: relative(element)
      }
    }

    const zoneNames: [string, string][] = [
      ['timeline', '[data-testid="rc09-timeline"]'],
      ['clock',    '[data-testid="rc09-clock"]'],
      ['split',    '[data-testid="rc09-split"]'],
      ['note',     '[data-testid="rc09-note"]'],
      ['support',  '[data-testid="rc09-support"]']
    ]
    const zones = zoneNames.map(([name, selector]) => {
      const element = root.querySelector<HTMLElement>(selector)
      const rect = element ? relative(element)! : { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }
      return {
        name,
        rect,
        display:      getComputedStyle(element!).display,
        layoutHeight: rect.height,
        scrollHeight: element?.scrollHeight ?? 0,
        clientHeight: element?.clientHeight ?? 0
      }
    })

    return {
      viewport:     { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
      page:         { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
      root:         relative(root)!,
      layout:       attr('rc09Layout'),
      compactMode:  attr('rc09CompactMode'),
      contentWidth:  attr('rc09ContentWidth'),
      contentHeight: attr('rc09ContentHeight'),
      bufferState:   attr('rc09BufferState'),
      alerts:        attr('rc09Alerts'),
      alertKeys:     attr('rc09AlertKeys'),
      roadbook:      attr('rc09Roadbook'),
      stageSource:   attr('rc09StageSource'),
      splitState:    attr('rc09SplitState'),
      nativeSize:    dashboard?.getAttribute('data-rc09-native-size') ?? null,
      // Fixed element counts
      ledCount:              root.querySelectorAll('[data-testid="rc09-led"]').length,
      miniCount:             root.querySelectorAll('[data-testid="rc09-mini"]').length,
      timelineFillCount:     root.querySelectorAll('[data-testid="rc09-timeline-fill"]').length,
      timelineMarkerCount:   root.querySelectorAll('[data-testid="rc09-timeline-marker"]').length,
      timelineEmptyCount:    root.querySelectorAll('[data-testid="rc09-timeline-empty"]').length,
      noteGlyphCount:        root.querySelectorAll('[data-testid="rc09-note-glyph"]').length,
      splitLossCount:        root.querySelectorAll('[data-testid="rc09-split-loss"]').length,
      cautionWaypointCount:  root.querySelectorAll('[data-testid="rc09-caution-waypoint"]').length,
      mechanicalCount:       root.querySelectorAll('[data-testid="rc09-mechanical"]').length,
      miniFaultLineCount:    root.querySelectorAll('[data-testid^="rc09-mini-line"]').length,
      profileCount:          root.querySelectorAll('[data-testid="rc09-profile"]').length,
      profileBarCount:       root.querySelectorAll('[data-testid="rc09-profile-bar"]').length,
      fuelForbiddenCount:    root.querySelectorAll('.rc09-fuel, [data-rc09-zone="fuel"], [data-testid="rc09-fuel"]').length,
      // Packet omission text probes
      distanceToFinishText: root.querySelector('[data-testid="rc09-distance-to-finish"]')?.textContent?.trim() ?? null,
      noteDistanceText:     root.querySelector('[data-testid="rc09-note-distance"]')?.textContent?.trim() ?? null,
      stageEmptyText:       root.querySelector('[data-testid="rc09-timeline-empty"]')?.textContent?.trim() ?? null,
      noteText:             root.querySelector('[data-testid="rc09-note-value"]')?.textContent?.trim() ?? null,
      splitValueText:       root.querySelector('[data-testid="rc09-split-value"]')?.textContent?.trim() ?? null,
      // Zone and value geometry
      zones,
      values: [
        measure('stage timer',        '[data-testid="rc09-stage-timer"]'),
        measure('split value',        '[data-testid="rc09-split-value"]'),
        measure('note value',         '[data-testid="rc09-note-value"]'),
        measure('note distance',      '[data-testid="rc09-note-distance"]'),
        measure('distance to finish', '[data-testid="rc09-distance-to-finish"]')
      ].filter((e): e is NonNullable<typeof e> => e !== null),
      // Split containment guard: getBoundingClientRect-only geometry.
      splitZoneRect: relative(root.querySelector('[data-testid="rc09-split"]')),
      splitValueRect: relative(root.querySelector('[data-testid="rc09-split-value"]'))
    }
  })
}

for (const size of viewports) {
  const label    = size.compactMode ? `${size.layout}/${size.compactMode}` : size.layout
  const sizeKey  = `${size.width}x${size.height}`
  const isNative = size.layout === 'native'
  const isApp    = size.layout === 'app'
  const isCompact = size.layout === 'compact'

  test(`${sizeKey} keeps the ${label} RC-09 composition contained (silent)`, async ({ browser }) => {
    const { context, page } = await openCapture(browser, size, {
      layout: size.layout,
      compactMode: size.compactMode ?? undefined,
      state: 'silent'
    })
    try {
      await expect
        .poll(async () => page.locator('[data-widget="raceconRc09Dash"]').getAttribute('data-rc09-buffer-state'))
        .toBe('accepted')
      const geometry = await readGeometry(page)

      // Viewport and layout
      expect(geometry.viewport).toEqual({ width: size.width, height: size.height, dpr: 1 })
      expect(geometry.layout).toBe(size.layout)
      expect(geometry.compactMode).toBe(size.compactMode)
      expect(geometry.contentWidth).toBe(String(size.width))
      expect(geometry.contentHeight).toBe(String(size.height))

      // State attributes — the +0.4 split is behind target so split-state publishes "losing"
      // even though the SPLIT LOSS alert has not latched (alert stays "silent")
      expect(geometry.alerts).toBe('silent')
      expect(geometry.alertKeys).toBe('')
      expect(geometry.roadbook).toBe('loaded')
      expect(geometry.stageSource).toBe('unavailable')
      expect(geometry.splitState).toBe('losing')

      // Native-size modifier
      expect(geometry.nativeSize).toBe(isNative ? '800x480' : null)

      // No horizontal scroll
      expect(geometry.page.scrollWidth).toBe(geometry.page.clientWidth)

      // Fixed element counts (silence)
      expect(geometry.ledCount).toBe(9)
      expect(geometry.miniCount).toBe(3)
      expect(geometry.timelineFillCount).toBe(0)
      expect(geometry.timelineMarkerCount).toBe(0)
      expect(geometry.timelineEmptyCount).toBe(1)
      expect(geometry.noteGlyphCount).toBe(1)
      expect(geometry.splitLossCount).toBe(0)
      expect(geometry.cautionWaypointCount).toBe(0)
      expect(geometry.mechanicalCount).toBe(0)
      expect(geometry.miniFaultLineCount).toBe(0)
      expect(geometry.fuelForbiddenCount).toBe(0)

      // Packet omissions
      expect(geometry.distanceToFinishText).toBe('TO FIN --.- KM')
      expect(geometry.noteDistanceText).toBe('--- M')
      expect(geometry.stageEmptyText).toBe('NO STAGE DISTANCE SOURCE')
      expect(geometry.noteText).toBe('LEFT 4 LONG')
      expect(/[0-9]/.test(geometry.distanceToFinishText ?? '')).toBe(false)
      expect(/[0-9]/.test(geometry.noteDistanceText ?? '')).toBe(false)

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

      // ── REGRESSION GUARD 1: split value and split zone must fit ───────────────────────────
      // DEFECT RC-09/1 escaped at 1024x600, 759x393 and 867x412. The fixed two-line chip
      // grammar plus --rc09-split-box cap must contain the split value and avoid split-zone
      // scroll overflow at every viewport and state.
      if (geometry.splitZoneRect && geometry.splitValueRect) {
        expectContained(geometry.splitZoneRect, geometry.splitValueRect)
      }
      const splitZone = geometry.zones.find((zone) => zone.name === 'split')
      if (splitZone) {
        expect(
          splitZone.scrollHeight,
          `split scrollHeight (${splitZone.scrollHeight}px) must not exceed layoutHeight ` +
          `(${splitZone.layoutHeight}px) at ${sizeKey}`
        ).toBeLessThanOrEqual(splitZone.layoutHeight + 0.5)
      }

      // Type-scale hierarchy: stage timer > split value > note distance > distance to finish.
      // Note value is checked separately by REGRESSION GUARD 2: note value < split value.
      const scale = ['stage timer', 'split value', 'note distance', 'distance to finish'].map(
        (name) => geometry.values.find((v) => v.label === name)!
      ).filter(Boolean)
      for (let index = 1; index < scale.length; index += 1) {
        expect(
          scale[index - 1].fontSize,
          `${scale[index - 1].label} must be strictly larger than ${scale[index].label}`
        ).toBeGreaterThan(scale[index].fontSize)
      }
      // ── REGRESSION GUARD 2: split font must outrank note font ─────────────────────────────
      // DEFECT RC-09/2 tied split and note at compact-phone (393x759 and 412x867). The phone
      // note rung is now the split rung's 0.625 packet ratio, so the inequality is unconditional.
      const noteValue  = geometry.values.find((v) => v.label === 'note value')
      const splitValue = geometry.values.find((v) => v.label === 'split value')
      if (noteValue && splitValue) {
        expect(splitValue.fontSize, `split must be strictly larger than note at ${sizeKey}`).toBeGreaterThan(noteValue.fontSize)
      }

      const capture = await page.locator('#racecon-rc09-capture-root').screenshot({ animations: 'disabled' })
      expect(capture.byteLength).toBeGreaterThan(5_000)
    } finally {
      await context.close()
    }
  })
}

test('the split-loss alert surfaces only inside the split chip', async ({ browser }) => {
  // Use the native viewport for the engaged-state test
  const size = viewports[0]
  const { context, page } = await openCapture(browser, size, { layout: 'native', state: 'split-loss' })
  try {
    await expect
      .poll(
        async () => page.locator('[data-widget="raceconRc09Dash"]').getAttribute('data-rc09-alerts'),
        { timeout: 150_000 }
      )
      .toBe('active')

    const alarm = await page.locator('#racecon-rc09-capture-root').evaluate((root) => {
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
      const widget = root.querySelector<HTMLElement>('[data-widget="raceconRc09Dash"]')!
      const splitEl = root.querySelector<HTMLElement>('[data-testid="rc09-split"]')
      const splitValueEl = root.querySelector<HTMLElement>('[data-testid="rc09-split-value"]')
      return {
        alerts:        widget?.dataset.rc09Alerts,
        alertKeys:     widget?.dataset.rc09AlertKeys,
        splitState:    widget?.dataset.rc09SplitState,
        roadbook:      widget?.dataset.rc09Roadbook,
        splitLossCount: root.querySelectorAll('[data-testid="rc09-split-loss"]').length,
        splitValueText: splitValueEl?.textContent?.trim() ?? null,
        splitRect:     relative(splitEl),
        splitValueRect: relative(splitValueEl),
        // Packet omissions still hold under split-loss
        distanceToFinishText: root.querySelector('[data-testid="rc09-distance-to-finish"]')?.textContent?.trim() ?? null,
        noteDistanceText:     root.querySelector('[data-testid="rc09-note-distance"]')?.textContent?.trim() ?? null,
        timelineFillCount:    root.querySelectorAll('[data-testid="rc09-timeline-fill"]').length,
        timelineMarkerCount:  root.querySelectorAll('[data-testid="rc09-timeline-marker"]').length,
        fuelForbiddenCount:   root.querySelectorAll('.rc09-fuel, [data-rc09-zone="fuel"]').length
      }
    })

    // Alert must be active
    expect(alarm.alerts).toBe('active')
    expect(alarm.alertKeys).toContain('SPLIT LOSS')
    expect(alarm.splitState).toBe('losing')
    expect(alarm.roadbook).toBe('loaded')

    // The split loss label must be present
    expect(alarm.splitLossCount).toBeGreaterThanOrEqual(1)

    // The split value must show the loss reading
    expect(alarm.splitValueText).toBe('+3.3')

    // Packet omissions hold in the engaged state
    expect(alarm.distanceToFinishText).toBe('TO FIN --.- KM')
    expect(alarm.noteDistanceText).toBe('--- M')
    expect(alarm.timelineFillCount).toBe(0)
    expect(alarm.timelineMarkerCount).toBe(0)
    expect(alarm.fuelForbiddenCount).toBe(0)

    // At native 800x480 the split chip is clean (no overflow)
    if (alarm.splitRect && alarm.splitValueRect) {
      const escape = alarm.splitValueRect.bottom - alarm.splitRect.bottom
      expect(escape, '800x480 split value must not escape its zone in split-loss').toBeLessThanOrEqual(0.5)
    }

    const capture = await page.locator('#racecon-rc09-capture-root').screenshot({ animations: 'disabled' })
    expect(capture.byteLength).toBeGreaterThan(5_000)
  } finally {
    await context.close()
  }
})
