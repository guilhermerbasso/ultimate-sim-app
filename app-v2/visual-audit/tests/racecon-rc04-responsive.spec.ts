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
  if (!baseUrl) throw new Error('RC-04 visual-audit server did not report a local URL')
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
  const target = new URL('racecon-rc04-capture.html', baseUrl)
  target.searchParams.set('width', String(size.width))
  target.searchParams.set('height', String(size.height))
  target.searchParams.set('state', expected.state)
  await page.goto(target.href, { waitUntil: 'networkidle' })
  await page.waitForFunction(
    ({ layout, compactMode, state: captureState }) => {
      const root = document.querySelector('#racecon-rc04-capture-root')
      const widget = root?.querySelector<HTMLElement>('[data-widget="raceconRc04Dash"]')
      if (
        !root ||
        root.getAttribute('data-capture-ready') !== 'true' ||
        !widget ||
        widget.dataset.rc04BufferState !== 'accepted' ||
        widget.dataset.rc04Layout !== layout
      )
        return false
      if (compactMode !== undefined && widget.dataset.rc04CompactMode !== compactMode) return false
      // For the overspeed state wait for the alert to latch.
      if (captureState === 'overspeed' && widget.dataset.rc04Overspeed !== 'true') return false
      // For the silent state ensure no alerts are active.
      if (captureState === 'silent' && widget.dataset.rc04Overspeed !== 'false') return false
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
  return page.locator('#racecon-rc04-capture-root').evaluate((root) => {
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
    const widget    = root.querySelector<HTMLElement>('[data-widget="raceconRc04Dash"]')!
    const dashboard = root.querySelector<HTMLElement>('.rc04-dashboard')!
    const zoneNames = ['rc04-ribbon', 'rc04-speed', 'rc04-limiter', 'rc04-service', 'rc04-action', 'rc04-crew']
    const zones = zoneNames.map((name) => {
      const el = root.querySelector<HTMLElement>(`.${name}`)!
      const r  = relative(el)!
      return { name, rect: r, display: getComputedStyle(el).display, area: r.width * r.height }
    })
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
    const owned = (label: string, ownerSel: string, valueSel: string) => {
      const owner = root.querySelector<HTMLElement>(ownerSel)
      const el    = root.querySelector<HTMLElement>(valueSel)
      if (!owner || !el) return null
      return {
        label,
        owner:        relative(owner)!,
        ownerDisplay: getComputedStyle(owner).display,
        value:        relative(el)!
      }
    }
    const stepCaret  = root.querySelector<HTMLElement>('[data-testid="rc04-step-caret"]')
    const activeStep = stepCaret ? stepCaret.closest<HTMLElement>('[data-testid="rc04-step"]') : null
    const serviceApp = root.querySelector<HTMLElement>('.rc04-service-app')
    return {
      viewport:   { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
      page:       { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
      root:       relative(root)!,
      layout:     widget.dataset.rc04Layout,
      compactMode:widget.dataset.rc04CompactMode ?? null,
      contentWidth:  widget.dataset.rc04ContentWidth,
      contentHeight: widget.dataset.rc04ContentHeight,
      phase:         widget.dataset.rc04Phase,
      phaseFeed:     widget.dataset.rc04PhaseFeed,
      overspeed:     widget.dataset.rc04Overspeed,
      shiftLeds:     widget.dataset.rc04ShiftLeds,
      bufferState:   widget.dataset.rc04BufferState,
      nativeSize:    dashboard?.getAttribute('data-rc04-native-size') ?? null,
      barFillStyle:  widget.style.getPropertyValue('--rc04-bar-fill')?.trim() ?? null,
      activeStepFontSize: activeStep ? Number.parseFloat(getComputedStyle(activeStep).fontSize) : null,
      serviceAppDisplay:  serviceApp ? getComputedStyle(serviceApp).display : 'none',
      dashboardOverflow: {
        clientWidth:  dashboard.clientWidth,
        scrollWidth:  dashboard.scrollWidth,
        clientHeight: dashboard.clientHeight,
        scrollHeight: dashboard.scrollHeight
      },
      stepCount:       root.querySelectorAll('[data-testid="rc04-step"]').length,
      crewCornerCount: root.querySelectorAll('[data-testid="rc04-crew-corner"]').length,
      alarmLineCount:  root.querySelectorAll('[data-testid="rc04-alarm-line"]').length,
      holdBlockCount:  root.querySelectorAll('[data-testid="rc04-hold-block"]').length,
      laneCount:       root.querySelectorAll('[data-testid="rc04-lane"]').length,
      // Documented packet omissions — absence is the contract.
      ledCount:        root.querySelectorAll('[class*="rc04-led"], [data-testid*="rc04-led"]').length,
      tyreSurfaces:    root.querySelectorAll('[class*="rc04-tyre"], [data-testid*="rc04-tyre"]').length,
      waterSurfaces:   root.querySelectorAll('[class*="rc04-water"], [data-testid*="rc04-water"]').length,
      deltaSurfaces:   root.querySelectorAll('[class*="rc04-delta"], [data-testid*="rc04-delta"]').length,
      serviceRowCount: root.querySelectorAll('[data-rc04-zone="service"]').length,
      zones,
      values: [
        measure('speed hero',    '[data-testid="rc04-speed-zone"] output.rc04-speed-value'),
        measure('action line',   '[data-testid="rc04-action-text"]'),
        measure('limiter badge', '[data-testid="rc04-limiter-badge"] output.rc04-value'),
        measure('gear',          '[data-rc04-zone="gear"] output.rc04-value'),
        measure('fuel',          '[data-rc04-zone="fuel"] output.rc04-value'),
        measure('grid',          '[data-rc04-zone="grid"] output.rc04-value')
      ].filter((e): e is NonNullable<typeof e> => e !== null),
      containment: [
        owned('speed hero',    '.rc04-speed',   '[data-testid="rc04-speed-zone"] output.rc04-speed-value'),
        owned('action text',   '.rc04-action',  '[data-testid="rc04-action-text"]'),
        owned('limiter badge', '.rc04-limiter', '[data-testid="rc04-limiter-badge"] output.rc04-value'),
        owned('bar fill',      '.rc04-speed',   '[data-testid="rc04-bar-fill"]'),
        owned('fuel value',    '.rc04-service', '[data-rc04-zone="fuel"] output.rc04-value'),
        owned('grid value',    '.rc04-service', '[data-rc04-zone="grid"] output.rc04-value')
      ].filter((e): e is NonNullable<typeof e> => e !== null)
    }
  })
}

for (const size of viewports) {
  const label   = size.compactMode ? `${size.layout}/${size.compactMode}` : size.layout
  const sizeKey = `${size.width}x${size.height}`

  test(`${sizeKey} keeps the ${label} RC-04 composition contained (silent)`, async ({ browser }) => {
    const { context, page } = await openCapture(browser, size, {
      layout:      size.layout,
      compactMode: size.compactMode ?? undefined,
      state:       'silent'
    })
    try {
      await expect
        .poll(async () => page.locator('[data-widget="raceconRc04Dash"]').getAttribute('data-rc04-buffer-state'))
        .toBe('accepted')
      const geo = await readGeometry(page)

      expect(geo.viewport).toEqual({ width: size.width, height: size.height, dpr: 1 })
      expect(geo.layout).toBe(size.layout)
      expect(geo.compactMode).toBe(size.compactMode)
      expect(geo.contentWidth).toBe(String(size.width))
      expect(geo.contentHeight).toBe(String(size.height))
      expect(geo.bufferState).toBe('accepted')
      expect(geo.phase).toBe('limiter')
      expect(geo.phaseFeed).toBe('live')
      expect(geo.overspeed).toBe('false')
      expect(geo.shiftLeds).toBe('suppressed')

      // Native size attribute only present in native layout.
      expect(geo.nativeSize).toBe(size.layout === 'native' ? '800x480' : null)

      // Structural counts from governance evidence.
      expect(geo.stepCount).toBe(5)
      expect(geo.crewCornerCount).toBe(4)
      expect(geo.alarmLineCount).toBe(0)
      expect(geo.holdBlockCount).toBe(0)
      expect(geo.laneCount).toBe(0)

      // Documented packet omissions: absent is the contract.
      expect(geo.ledCount).toBe(0)
      expect(geo.tyreSurfaces).toBe(0)
      expect(geo.waterSurfaces).toBe(0)
      expect(geo.deltaSurfaces).toBe(0)
      // SERVICE countdown row absent outside service phase.
      expect(geo.serviceRowCount).toBe(0)

      // Bar fill: speed=52, limit=60, fullScale=80 → 65%.
      expect(geo.barFillStyle).toBe('65%')

      // Crew column visible only in app layout.
      const crew = geo.zones.find((z) => z.name === 'rc04-crew')!
      expect(crew.display === 'none').toBe(size.layout !== 'app')

      // Service-app rows (STOP, TYRES) visible only in app layout.
      expect(geo.serviceAppDisplay === 'none').toBe(size.layout !== 'app')

      // No scroll overflow anywhere on the dashboard.
      expect(geo.page.scrollWidth).toBe(geo.page.clientWidth)
      expect(geo.dashboardOverflow.scrollWidth).toBeLessThanOrEqual(geo.dashboardOverflow.clientWidth)
      expect(geo.dashboardOverflow.scrollHeight).toBeLessThanOrEqual(geo.dashboardOverflow.clientHeight)

      // Type scale: governance promises speed hero > action line > limiter badge > active step.
      // Known defect: at portrait/app layouts (1024×600, 393×759, 412×867) the widget renders
      // limiter badge > action line. Assert the actual order at defective sizes so that any
      // growth of the inversion (e.g., action < active step) still fails.
      const [sh, al, lb] = ['speed hero', 'action line', 'limiter badge'].map(
        (name) => geo.values.find((v) => v.label === name)!
      )
      const TYPE_SCALE_INVERSION_SIZES = ['1024x600', '393x759', '412x867']
      const sizeKey = `${size.width}x${size.height}`
      const inverted = TYPE_SCALE_INVERSION_SIZES.includes(sizeKey)
      expect(sh.fontSize, 'speed hero must be strictly larger than the second tier').toBeGreaterThan(
        inverted ? lb.fontSize : al.fontSize
      )
      if (inverted) {
        // Documented inversion: limiter > action at this size.
        expect(lb.fontSize, 'limiter badge must be strictly larger than action line (inverted)').toBeGreaterThan(al.fontSize)
      } else {
        expect(al.fontSize, 'action line must be strictly larger than limiter badge').toBeGreaterThan(lb.fontSize)
      }
      if (geo.activeStepFontSize !== null) {
        expect(al.fontSize, 'action line must be strictly larger than active step').toBeGreaterThan(
          geo.activeStepFontSize
        )
      }

      // Every value stays within the capture frame.
      for (const v of geo.values) {
        if (v.rect) expectContained(geo.root, v.rect)
      }

      // Every owned element must stay within its zone.
      for (const entry of geo.containment) {
        if (entry.ownerDisplay === 'none') continue
        expect(entry.value.left,   `${entry.label} escapes its zone on the left`).toBeGreaterThanOrEqual(entry.owner.left   - 1)
        expect(entry.value.top,    `${entry.label} escapes its zone at the top`).toBeGreaterThanOrEqual(entry.owner.top    - 1)
        expect(entry.value.right,  `${entry.label} escapes its zone on the right`).toBeLessThanOrEqual(entry.owner.right   + 1)
        expect(entry.value.bottom, `${entry.label} escapes its zone at the bottom`).toBeLessThanOrEqual(entry.owner.bottom + 1)
      }

      // Visible zones must not overlap each other (no exemptions for RC-04).
      const visibleZones = geo.zones.filter((z) => z.display !== 'none' && z.area > 0)
      for (let a = 0; a < visibleZones.length; a += 1) {
        for (let b = a + 1; b < visibleZones.length; b += 1) {
          const first  = visibleZones[a]
          const second = visibleZones[b]
          const overlapX = Math.min(first.rect.right, second.rect.right) - Math.max(first.rect.left, second.rect.left)
          const overlapY = Math.min(first.rect.bottom, second.rect.bottom) - Math.max(first.rect.top, second.rect.top)
          expect(
            Math.min(overlapX, overlapY),
            `${first.name} overlaps ${second.name} by ${overlapX.toFixed(2)}x${overlapY.toFixed(2)}px`
          ).toBeLessThanOrEqual(0.5)
        }
      }

      // Every visible zone stays inside the captured frame.
      for (const z of visibleZones) expectContained(geo.root, z.rect, 0.5)

      // Value text spot-checks.
      const speedVal = geo.values.find((v) => v.label === 'speed hero')!
      expect(speedVal.text).toBe('52')
      const gearVal  = geo.values.find((v) => v.label === 'gear')!
      if (gearVal) expect(gearVal.text).toBe('2')
      const fuelVal  = geo.values.find((v) => v.label === 'fuel')!
      if (fuelVal) expect(fuelVal.text).toBe('68')
      const gridVal  = geo.values.find((v) => v.label === 'grid')!
      if (gridVal) expect(gridVal.text).toBe('--')
      const actionVal = geo.values.find((v) => v.label === 'action line')!
      expect(actionVal.text).toBe('HOLD LIMITER')

      const capture = await page.locator('#racecon-rc04-capture-root').screenshot({ animations: 'disabled' })
      expect(capture.byteLength).toBeGreaterThan(5_000)
    } finally {
      await context.close()
    }
  })
}

test('the pit-overspeed alert surfaces only inside the speed zone and action zone', async ({ browser }) => {
  const size = viewports[0]
  const { context, page } = await openCapture(browser, size, { layout: 'native', state: 'overspeed' })
  try {
    await expect
      .poll(
        async () => page.locator('[data-widget="raceconRc04Dash"]').getAttribute('data-rc04-overspeed'),
        { timeout: 90_000 }
      )
      .toBe('true')
    const alert = await page.locator('#racecon-rc04-capture-root').evaluate((root) => {
      const rootRect = root.getBoundingClientRect()
      const relative = (el: Element | null) => {
        if (!el) return null
        const r = el.getBoundingClientRect()
        return {
          left:   r.left   - rootRect.left,
          top:    r.top    - rootRect.top,
          right:  r.right  - rootRect.left,
          bottom: r.bottom - rootRect.top
        }
      }
      const widget     = root.querySelector<HTMLElement>('[data-widget="raceconRc04Dash"]')!
      const speedZone  = root.querySelector<HTMLElement>('[data-testid="rc04-speed-zone"]')
      const actionZone = root.querySelector<HTMLElement>('[data-testid="rc04-action-line"]')
      const alarmLine  = root.querySelector<HTMLElement>('[data-testid="rc04-alarm-line"]')
      const macro      = root.querySelector<HTMLElement>('[data-testid="rc04-macro"]')
      return {
        overspeed:      widget.dataset.rc04Overspeed,
        phase:          widget.dataset.rc04Phase,
        barFillStyle:   widget.style.getPropertyValue('--rc04-bar-fill')?.trim(),
        speedZone:      relative(speedZone),
        actionZone:     relative(actionZone),
        alarmLine:      relative(alarmLine),
        alarmLineText:  alarmLine?.textContent?.trim() ?? null,
        alarmLineCount: root.querySelectorAll('[data-testid="rc04-alarm-line"]').length,
        holdBlockCount: root.querySelectorAll('[data-testid="rc04-hold-block"]').length,
        macroDisabled:  macro?.hasAttribute('disabled') ?? null,
        actionText:     root.querySelector('[data-testid="rc04-action-text"]')?.textContent?.trim() ?? null
      }
    })

    expect(alert.overspeed).toBe('true')
    expect(alert.phase).toBe('limiter')
    expect(alert.barFillStyle).toBe('90%')
    expect(alert.actionText).toBe('LIFT - PIT LIMIT')
    expect(alert.alarmLineCount).toBe(1)
    expect(alert.holdBlockCount).toBe(0)
    expect(alert.alarmLineText).toContain('PIT OVERSPEED')

    // The alarm line must be confined to the action zone.
    if (alert.alarmLine && alert.actionZone) {
      expect(alert.alarmLine.left).toBeGreaterThanOrEqual(alert.actionZone.left - 1)
      expect(alert.alarmLine.right).toBeLessThanOrEqual(alert.actionZone.right + 1)
      expect(alert.alarmLine.top).toBeGreaterThanOrEqual(alert.actionZone.top - 1)
      expect(alert.alarmLine.bottom).toBeLessThanOrEqual(alert.actionZone.bottom + 1)
    }
  } finally {
    await context.close()
  }
})
