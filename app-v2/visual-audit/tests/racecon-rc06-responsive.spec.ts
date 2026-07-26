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
  if (!baseUrl) throw new Error('RC-06 visual-audit server did not report a local URL')
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
  expected: { layout: 'native' | 'app' | 'compact'; compactMode?: 'phone' | 'landscape'; state: string }
): Promise<{ context: Awaited<ReturnType<Browser['newContext']>>; page: Page }> {
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'dark'
  })
  const page = await context.newPage()
  const target = new URL('racecon-rc06-capture.html', baseUrl)
  target.searchParams.set('width', String(size.width))
  target.searchParams.set('height', String(size.height))
  target.searchParams.set('state', expected.state)
  await page.goto(target.href, { waitUntil: 'networkidle' })
  await page.waitForFunction(
    ({ layout, compactMode }) => {
      const root = document.querySelector('#racecon-rc06-capture-root')
      const widget = root?.querySelector<HTMLElement>('[data-widget="raceconRc06Dash"]')
      return (
        root?.getAttribute('data-capture-ready') === 'true' &&
        widget?.dataset.rc06BufferState === 'accepted' &&
        widget.dataset.rc06Layout === layout &&
        (compactMode === undefined || widget.dataset.rc06CompactMode === compactMode)
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
  return page.locator('#racecon-rc06-capture-root').evaluate((root) => {
    const rootRect = root.getBoundingClientRect()
    const relative = (element: Element): Rect => {
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
    const widget    = root.querySelector<HTMLElement>('[data-widget="raceconRc06Dash"]')!
    const dashboard = root.querySelector<HTMLElement>('.rc06-dashboard')!

    // Zones always in DOM (trend is conditionally rendered — may be absent).
    const alwaysZoneNames = [
      'rc06-peripheral', 'rc06-target', 'rc06-balance',
      'rc06-delta', 'rc06-actual', 'rc06-lift'
    ]
    const zones = alwaysZoneNames.map((cls) => {
      const element = root.querySelector<HTMLElement>(`.${cls}`)!
      const rect = relative(element)
      return { name: cls, rect, display: getComputedStyle(element).display, area: rect.width * rect.height }
    })

    // Trend zone is conditionally rendered — only exists at the app layout.
    const trendEl = root.querySelector<HTMLElement>('[data-testid="rc06-trend"]')
    const trendZone = trendEl
      ? { present: true, rect: relative(trendEl), display: getComputedStyle(trendEl).display }
      : { present: false, rect: null, display: 'none' }

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

    const owned = (label: string, ownerSelector: string, valueSelector: string) => {
      const owner   = root.querySelector<HTMLElement>(ownerSelector)
      const element = root.querySelector<HTMLElement>(valueSelector)
      if (!owner || !element) return null
      return {
        label,
        owner: relative(owner),
        ownerDisplay: getComputedStyle(owner).display,
        value: relative(element)
      }
    }

    // Documented packet omissions:
    // Omission 1: no RPM channel → rev-LED, shift-marker must NOT appear.
    // Omission 2: no lapDistanceM channel → lift-point output is always "--".
    const revLedSurfaces    = root.querySelectorAll('[data-testid*="rev-led"],[class*="rev-led"],[data-testid*="shift"],[class*="shift-marker"]').length
    const lapDistanceOutput = root.querySelector<HTMLElement>('[data-rc06-row="lift-point"] output')?.textContent?.trim() ?? null

    return {
      viewport:         { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
      page:             { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
      root:             relative(root),
      layout:           widget.dataset.rc06Layout,
      compactMode:      widget.dataset.rc06CompactMode ?? null,
      contentWidth:     widget.dataset.rc06ContentWidth,
      contentHeight:    widget.dataset.rc06ContentHeight,
      bufferState:      widget.dataset.rc06BufferState,
      liftMode:         widget.dataset.rc06LiftMode,
      planState:        widget.dataset.rc06Plan,
      fuelModel:        widget.dataset.rc06FuelModel,
      balanceTone:      widget.dataset.rc06BalanceTone,
      alerts:           widget.dataset.rc06Alerts,
      alertKeys:        widget.dataset.rc06AlertKeys,
      ledger:           widget.dataset.rc06Ledger,
      nativeSize:       dashboard.getAttribute('data-rc06-native-size') ?? null,
      dashboardOverflow: {
        clientWidth:  dashboard.clientWidth,
        scrollWidth:  dashboard.scrollWidth,
        clientHeight: dashboard.clientHeight,
        scrollHeight: dashboard.scrollHeight
      },
      columnTitleCount:    root.querySelectorAll('[data-testid="rc06-column-title"]').length,
      columnRuleCount:     root.querySelectorAll('[data-testid="rc06-column-rule"]').length,
      ledgerRowCount:      root.querySelectorAll('[data-testid="rc06-row"]').length,
      saveMORECount:       root.querySelectorAll('[data-testid="rc06-save-more"]').length,
      fuelModelNoteCount:  root.querySelectorAll('[data-testid="rc06-fuel-model-note"]').length,
      revLedSurfaces,
      lapDistanceOutput,
      zones,
      trendZone,
      values: [
        measure('balance',       '[data-testid="rc06-balance-value"]'),
        measure('laps remaining','[data-rc06-row="laps-remaining"] output'),
        measure('actual burn',   '[data-rc06-row="actual-burn"] output'),
        measure('lift cue',      '[data-testid="rc06-lift-value"]'),
        measure('column title',  '[data-testid="rc06-column-title"]')
      ].filter((e): e is NonNullable<typeof e> => e !== null),
      containment: [
        owned('balance value',  '.rc06-balance', '[data-testid="rc06-balance-value"]'),
        owned('lift value',     '.rc06-lift',    '[data-testid="rc06-lift-value"]'),
        owned('actual burn',    '.rc06-actual',  '[data-rc06-row="actual-burn"] output'),
        owned('laps remaining', '.rc06-actual',  '[data-rc06-row="laps-remaining"] output')
      ].filter((e): e is NonNullable<typeof e> => e !== null),
      balanceRect: relative(root.querySelector<HTMLElement>('.rc06-balance')!)
    }
  })
}

for (const size of viewports) {
  const label   = size.compactMode ? `${size.layout}/${size.compactMode}` : size.layout
  const sizeKey = `${size.width}x${size.height}`

  test(`${sizeKey} keeps the ${label} RC-06 composition contained`, async ({ browser }) => {
    const { context, page } = await openCapture(browser, size, {
      layout: size.layout,
      compactMode: size.compactMode ?? undefined,
      state: 'silent'
    })
    try {
      await expect
        .poll(async () => page.locator('[data-widget="raceconRc06Dash"]').getAttribute('data-rc06-buffer-state'))
        .toBe('accepted')
      const geometry = await readGeometry(page)

      expect(geometry.viewport).toEqual({ width: size.width, height: size.height, dpr: 1 })
      expect(geometry.layout).toBe(size.layout)
      expect(geometry.compactMode).toBe(size.compactMode)
      expect(geometry.contentWidth).toBe(String(size.width))
      expect(geometry.contentHeight).toBe(String(size.height))

      // Native layout: data-rc06-native-size must be set.
      if (size.layout === 'native') {
        expect(geometry.nativeSize).toBe('800x480')
      }

      // Buffer, plan, ledger and fuel-model must all be correct on the silent plateau.
      expect(geometry.bufferState).toBe('accepted')
      expect(geometry.planState).toBe('loaded')
      expect(geometry.ledger).toBe('measured')
      expect(geometry.fuelModel).toBe('valid')
      expect(geometry.alerts).toBe('silent')
      expect(geometry.balanceTone).toBe('normal')

      // Page-level scroll must not exceed the viewport.
      expect(geometry.page.scrollWidth).toBe(geometry.page.clientWidth)
      expect(geometry.dashboardOverflow.scrollWidth).toBeLessThanOrEqual(geometry.dashboardOverflow.clientWidth)
      expect(geometry.dashboardOverflow.scrollHeight).toBeLessThanOrEqual(geometry.dashboardOverflow.clientHeight)

      // Governance: exactly 2 column titles, 2 column rules, 14 ledger rows.
      expect(geometry.columnTitleCount).toBe(2)
      expect(geometry.columnRuleCount).toBe(2)
      expect(geometry.ledgerRowCount).toBe(14)

      // Documented packet omissions:
      // Omission 1 — No RPM channel: rev-LED / shift-marker must NOT appear.
      expect(geometry.revLedSurfaces).toBe(0)
      // Omission 2 — No lapDistanceM channel: lift-point output must always be "--".
      expect(geometry.lapDistanceOutput).toBe('--')
      // Omission 3 — Trend zone absent except at app layout (conditionally rendered, not display:none).
      expect(geometry.trendZone.present).toBe(size.layout === 'app')

      // Silent state: no SAVE MORE and no fuel-model-invalid note.
      expect(geometry.saveMORECount).toBe(0)
      expect(geometry.fuelModelNoteCount).toBe(0)

      // Type scale: balance > laps-remaining > actual-burn > lift-cue > column-title, strictly.
      // A tie at any step is a failure — it carries no hierarchy.
      const scale = ['balance', 'laps remaining', 'actual burn', 'lift cue', 'column title'].map(
        (name) => geometry.values.find((v) => v.label === name)!
      ).filter(Boolean)
      for (let i = 1; i < scale.length; i += 1) {
        expect(
          scale[i - 1].fontSize,
          `${scale[i - 1].label} must be strictly larger than ${scale[i].label}`
        ).toBeGreaterThan(scale[i].fontSize)
      }

      // No visible value must overflow its box.
      for (const v of geometry.values) {
        expect(v.scrollWidth - v.clientWidth, `${v.label} "${v.text}" overflows`).toBeLessThanOrEqual(0)
        expectContained(geometry.root, v.rect)
      }

      // Containment: each value must remain inside its zone.
      for (const entry of geometry.containment) {
        if (entry.ownerDisplay === 'none') continue
        const overflow = {
          left:   +(entry.owner.left   - entry.value.left).toFixed(2),
          right:  +(entry.value.right  - entry.owner.right).toFixed(2),
          top:    +(entry.owner.top    - entry.value.top).toFixed(2),
          bottom: +(entry.value.bottom - entry.owner.bottom).toFixed(2)
        }
        expect(overflow.left,   `${entry.label} escapes zone on the left`).toBeLessThanOrEqual(0.5)
        expect(overflow.right,  `${entry.label} escapes zone on the right`).toBeLessThanOrEqual(0.5)
        expect(overflow.top,    `${entry.label} escapes zone at the top`).toBeLessThanOrEqual(0.5)
        expect(overflow.bottom, `${entry.label} escapes zone at the bottom`).toBeLessThanOrEqual(0.5)
      }

      // Zone non-overlap. At the app layout, delta is folded inside balance (packet 12.1):
      // that pair is exempted. All other pairs must not overlap.
      const exempt = new Set(['rc06-balance|rc06-delta'])
      const visibleZones = geometry.zones.filter((z) => z.display !== 'none' && z.area > 0)
      for (let a = 0; a < visibleZones.length; a += 1) {
        for (let b = a + 1; b < visibleZones.length; b += 1) {
          const first  = visibleZones[a]
          const second = visibleZones[b]
          if (exempt.has([first.name, second.name].sort().join('|'))) continue
          const overlapX = Math.min(first.rect.right, second.rect.right) - Math.max(first.rect.left, second.rect.left)
          const overlapY = Math.min(first.rect.bottom, second.rect.bottom) - Math.max(first.rect.top, second.rect.top)
          expect(
            Math.min(overlapX, overlapY),
            `${first.name} overlaps ${second.name} by ${overlapX.toFixed(2)}x${overlapY.toFixed(2)}px`
          ).toBeLessThanOrEqual(0.5)
        }
      }

      // Every zone must stay inside the capture frame.
      for (const z of visibleZones) expectContained(geometry.root, z.rect, 0.5)

      // The screenshot must not be blank.
      const capture = await page.locator('#racecon-rc06-capture-root').screenshot({ animations: 'disabled' })
      expect(capture.byteLength).toBeGreaterThan(5_000)
    } finally {
      await context.close()
    }
  })
}

test('the SAVE MORE alert surfaces only inside the balance zone', async ({ browser }) => {
  const size = viewports[0] // native 800×480
  const { context, page } = await openCapture(browser, size, { layout: 'native', state: 'save-more' })
  try {
    await expect
      .poll(async () => page.locator('[data-widget="raceconRc06Dash"]').getAttribute('data-rc06-alerts'), {
        timeout: 90_000
      })
      .toBe('active')

    const alert = await page.locator('#racecon-rc06-capture-root').evaluate((root) => {
      const rootRect = root.getBoundingClientRect()
      const relative = (element: Element) => {
        const rect = element.getBoundingClientRect()
        return {
          left:   rect.left   - rootRect.left,
          top:    rect.top    - rootRect.top,
          right:  rect.right  - rootRect.left,
          bottom: rect.bottom - rootRect.top
        }
      }
      const widget      = root.querySelector<HTMLElement>('[data-widget="raceconRc06Dash"]')!
      const balanceEl   = root.querySelector<HTMLElement>('.rc06-balance')!
      const saveMOREEl  = root.querySelector<HTMLElement>('[data-testid="rc06-save-more"]')
      const balanceValEl = root.querySelector<HTMLElement>('[data-testid="rc06-balance-value"]')
      return {
        alerts:      widget.dataset.rc06Alerts,
        alertKeys:   widget.dataset.rc06AlertKeys,
        balanceTone: widget.dataset.rc06BalanceTone,
        balanceToneAttr: balanceEl.getAttribute('data-rc06-tone'),
        balanceSign:     balanceEl.getAttribute('data-rc06-sign'),
        balance: balanceEl    ? relative(balanceEl)    : null,
        saveMORE: saveMOREEl  ? relative(saveMOREEl)   : null,
        balanceVal: balanceValEl ? relative(balanceValEl) : null,
        saveMOREText: saveMOREEl?.textContent?.trim() ?? null
      }
    })

    // Widget must report the danger scenario attributes.
    expect(alert.alerts).toBe('active')
    expect(alert.alertKeys).toContain('SAVE MORE')
    expect(alert.balanceTone).toBe('danger')
    expect(alert.balanceToneAttr).toBe('danger')
    // The sign attribute on the balance section must be deficit.
    expect(alert.balanceSign).toBe('deficit')
    // SAVE MORE element is present exactly once and contains the alert text.
    expect(alert.saveMOREText).toContain('SAVE MORE')

    // Every alert surface (SAVE MORE label, balance value) must be inside the balance zone rect.
    const balance = alert.balance!
    if (alert.saveMORE) {
      expect(alert.saveMORE.left).toBeGreaterThanOrEqual(balance.left - 1)
      expect(alert.saveMORE.right).toBeLessThanOrEqual(balance.right + 1)
      expect(alert.saveMORE.top).toBeGreaterThanOrEqual(balance.top - 1)
      expect(alert.saveMORE.bottom).toBeLessThanOrEqual(balance.bottom + 1)
    }
    if (alert.balanceVal) {
      expect(alert.balanceVal.left).toBeGreaterThanOrEqual(balance.left - 1)
      expect(alert.balanceVal.right).toBeLessThanOrEqual(balance.right + 1)
      expect(alert.balanceVal.top).toBeGreaterThanOrEqual(balance.top - 1)
      expect(alert.balanceVal.bottom).toBeLessThanOrEqual(balance.bottom + 1)
    }
  } finally {
    await context.close()
  }
})
