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
  if (!baseUrl) throw new Error('RC-14 visual-audit server did not report a local URL')
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
  const target = new URL('racecon-rc14-capture.html', baseUrl)
  target.searchParams.set('width', String(size.width))
  target.searchParams.set('height', String(size.height))
  target.searchParams.set('state', expected.state)
  await page.goto(target.href, { waitUntil: 'networkidle' })
  await page.waitForFunction(
    ({ layout, compactMode, state: captureState }) => {
      const root   = document.querySelector('#racecon-rc14-capture-root')
      const widget = root?.querySelector<HTMLElement>('[data-widget="raceconRc14Dash"]')
      if (!root || !widget) return false
      if (root.getAttribute('data-capture-ready') !== 'true') return false
      if (widget.dataset.rc14BufferState !== 'accepted') return false
      if (widget.dataset.rc14Layout !== layout) return false
      if (compactMode !== undefined && widget.dataset.rc14CompactMode !== compactMode) return false
      if (captureState === 'critical-fault') {
        if (widget.dataset.rc14Alerts !== 'active') return false
        if (widget.dataset.rc14Decision !== 'PIT') return false
      }
      return true
    },
    expected,
    { timeout: 120_000 }
  )
  return { context, page }
}

const viewports = [
  { width: 800,  height: 480, layout: 'native',  compactMode: null        },
  { width: 1024, height: 600, layout: 'app',     compactMode: null        },
  { width: 393,  height: 759, layout: 'compact', compactMode: 'phone'     },
  { width: 412,  height: 867, layout: 'compact', compactMode: 'phone'     },
  { width: 759,  height: 393, layout: 'compact', compactMode: 'landscape' },
  { width: 867,  height: 412, layout: 'compact', compactMode: 'landscape' }
] as const

/** Unmonitored system labels that must NEVER appear as fault-row system names. */
const UNMONITORED_SYSTEM_LABELS = ['GEARBOX', 'FRONT AERO', 'CORNER LF', 'CORNER RF', 'CORNER LR', 'CORNER RR']

/**
 * DEFECT RC-14/2 — compact-landscape breaks vital-value == decision-word equality.
 * At 759x393 and 867x412 the decision word is LARGER than vital value (vital < decision).
 * At the other four viewports equality holds within 0.5 px tolerance.
 */
const VITAL_DECISION_DEFECT_SIZES = new Set(['759x393', '867x412'])

/**
 * DEFECT RC-14/1 — ENGINE fault-system overflows in critical-fault at 800x480/1024x600. Budget 90 px.
 */
const FAULT_SYSTEM_OVERFLOW_SIZES = new Set(['800x480', '1024x600'])
const FAULT_SYSTEM_OVERFLOW_BUDGET_PX = 90

async function readGeometry(page: Page) {
  return page.locator('#racecon-rc14-capture-root').evaluate((root) => {
    const rootRect = root.getBoundingClientRect()
    const relative = (el: Element | null): Rect | null => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { left: r.left - rootRect.left, top: r.top - rootRect.top, width: r.width, height: r.height, right: r.right - rootRect.left, bottom: r.bottom - rootRect.top }
    }
    const widget    = root.querySelector<HTMLElement>('[data-widget="raceconRc14Dash"]')!
    const attr = (k: string) => widget?.dataset[k] ?? null

    const measure = (label: string, selector: string) => {
      const el = root.querySelector<HTMLElement>(selector)
      if (!el) return null
      return { label, text: (el.textContent ?? '').trim(), fontSize: Number.parseFloat(getComputedStyle(el).fontSize), rect: relative(el) }
    }

    const zones: { name: string; rect: Rect; display: string }[] = [
      ['faultList',    '[data-testid="rc14-panel-faultList"]'],
      ['carSilhouette','[data-testid="rc14-panel-carSilhouette"]'],
      ['vitalsColumn', '[data-testid="rc14-panel-vitalsColumn"]']
    ].map(([name, sel]) => {
      const el = root.querySelector<HTMLElement>(sel)
      const rect = el ? relative(el)! : { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }
      return { name, rect, display: el ? getComputedStyle(el).display : 'none' }
    })

    const silPanel = root.querySelector('[data-testid="rc14-panel-carSilhouette"]')
    const zoneStates = Array.from(root.querySelectorAll('[data-testid="rc14-zone"]')).map((g) => ({
      id:        g.getAttribute('data-rc14-zone-id'),
      monitored: g.getAttribute('data-rc14-zone-monitored') === 'true',
      severity:  g.getAttribute('data-rc14-zone-severity'),
      token:     g.getAttribute('data-rc14-zone-token'),
      pattern:   g.getAttribute('data-rc14-zone-pattern'),
      rect:      relative(g)
    }))

    const faultSystemNames = Array.from(root.querySelectorAll('.rc14-fault-system'))
      .map((el) => (el.textContent ?? '').trim())
    const faultChipWords = Array.from(root.querySelectorAll('[data-testid="rc14-fault-chip"]'))
      .map((el) => (el.textContent ?? '').trim())

    const oilTempVitalAlerting = root
      .querySelector('[data-testid="rc14-vital"][data-rc14-vital="oilTemp"]')
      ?.getAttribute('data-rc14-vital-alerting') ?? null

    // DEFECT RC-14/1 measurement
    const critRow = root.querySelector('[data-testid="rc14-fault-row"][data-rc14-severity="critical"]')
    const critRowRect = relative(critRow)
    const critSys = critRow?.querySelector('.rc14-fault-system') ?? null
    let engineEscapeFromRow: number | null = null
    let engineEscapeFromPanel: number | null = null
    if (critSys && critRowRect) {
      const sysRect = critSys.getBoundingClientRect()
      const textRight = sysRect.right - rootRect.left
      const rowRight  = critRowRect.left + critRowRect.width
      engineEscapeFromRow = +(textRight - rowRight).toFixed(2)
      const faultListPanelEl = root.querySelector('[data-testid="rc14-panel-faultList"]')
      const flRect = relative(faultListPanelEl)
      if (flRect) {
        const panelRight = flRect.left + flRect.width
        engineEscapeFromPanel = +(textRight - panelRight).toFixed(2)
      }
    }

    // Also collect scrollWidth overflow for fault-system spans
    const faultSystemScrollOverflow = Array.from(root.querySelectorAll('.rc14-fault-system'))
      .map((el) => ({
        text: (el.textContent ?? '').trim(),
        clientWidth: (el as HTMLElement).clientWidth,
        scrollWidth: (el as HTMLElement).scrollWidth,
        overflowPx: Math.max(0, (el as HTMLElement).scrollWidth - (el as HTMLElement).clientWidth)
      }))

    return {
      viewport:        { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
      page:            { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
      layout:          attr('rc14Layout'),
      compactMode:     attr('rc14CompactMode'),
      contentWidth:    attr('rc14ContentWidth'),
      contentHeight:   attr('rc14ContentHeight'),
      bufferState:     attr('rc14BufferState'),
      alerts:          attr('rc14Alerts'),
      decision:        attr('rc14Decision'),
      monitoredSystems: attr('rc14MonitoredSystems'),
      monitoredSources: attr('rc14MonitoredSources'),
      zones,
      zoneStates,
      silhouetteZonesAttr:       silPanel?.getAttribute('data-rc14-zones') ?? null,
      silhouetteUnmonitoredAttr: silPanel?.getAttribute('data-rc14-unmonitored-zones') ?? null,
      unmonitoredNoticeText:     root.querySelector('[data-testid="rc14-unmonitored-notice"]')?.textContent?.trim() ?? null,
      faultSystemNames,
      faultChipWords,
      oilTempVitalAlerting,
      zoneCount:              root.querySelectorAll('[data-testid="rc14-zone"]').length,
      vitalCount:             root.querySelectorAll('[data-testid="rc14-vital"]').length,
      faultRowCount:          root.querySelectorAll('[data-testid="rc14-fault-row"]').length,
      faultChipCount:         root.querySelectorAll('[data-testid="rc14-fault-chip"]').length,
      faultAckCount:          root.querySelectorAll('[data-testid="rc14-fault-ack"]').length,
      faultNozoneCount:       root.querySelectorAll('[data-testid="rc14-fault-nozone"]').length,
      faultEmptyCount:        root.querySelectorAll('[data-testid="rc14-fault-empty"]').length,
      cornerHeadCount:        root.querySelectorAll('[data-testid="rc14-corner-head"]').length,
      cornerBrakeCount:       root.querySelectorAll('[data-testid="rc14-corner-brake"]').length,
      cornerPressureCount:    root.querySelectorAll('[data-testid="rc14-corner-pressure"]').length,
      decisionCount:          root.querySelectorAll('[data-testid="rc14-decision"]').length,
      unmonitoredNoticeCount: root.querySelectorAll('[data-testid="rc14-unmonitored-notice"]').length,
      faultTimelineCount:     root.querySelectorAll('[data-testid="rc14-panel-faultTimeline"]').length,
      decisionCornersCount:   root.querySelectorAll('[data-testid="rc14-panel-decisionCorners"]').length,
      decisionBannerCount:    root.querySelectorAll('[data-testid="rc14-panel-decisionBanner"]').length,
      cornerStatusCount:      root.querySelectorAll('[data-testid="rc14-panel-cornerStatus"]').length,
      speedDeltaForbiddenCount: root.querySelectorAll(
        '.rc14-speed, .rc14-delta, [data-rc14-zone="speed"], [data-rc14-zone="delta"], [data-testid="rc14-speed"], [data-testid="rc14-delta"]'
      ).length,
      systemsDetailForbiddenCount: root.querySelectorAll(
        '[data-testid="rc14-systems-detail"], .rc14-systems-detail, [data-rc14-zone="systemsDetail"]'
      ).length,
      rootText: root.textContent ?? '',
      values: [
        measure('decision word',   '[data-testid="rc14-decision-word"]'),
        measure('vital value',     '[data-testid="rc14-vital-value"]'),
        measure('fault chip',      '[data-testid="rc14-fault-chip"]'),
        measure('corner head',     '[data-testid="rc14-corner-head"]'),
        measure('corner brake',    '[data-testid="rc14-corner-brake"]'),
        measure('corner pressure', '[data-testid="rc14-corner-pressure"]')
      ].filter((v): v is NonNullable<typeof v> => v !== null),
      engineEscapeFromRow,
      engineEscapeFromPanel,
      faultSystemScrollOverflow
    }
  })
}

for (const size of viewports) {
  const label    = size.compactMode ? `${size.layout}/${size.compactMode}` : size.layout
  const sizeKey  = `${size.width}x${size.height}`
  const isApp    = size.layout === 'app'
  const isCompactLandscape = size.compactMode === 'landscape'

  test(`${sizeKey} keeps the ${label} RC-14 composition contained (silent)`, async ({ browser }) => {
    const { context, page } = await openCapture(browser, size, {
      layout: size.layout,
      compactMode: size.compactMode ?? undefined,
      state: 'silent'
    })
    try {
      await expect
        .poll(async () => page.locator('[data-widget="raceconRc14Dash"]').getAttribute('data-rc14-buffer-state'))
        .toBe('accepted')
      const geometry = await readGeometry(page)

      // ── Viewport and layout ─────────────────────────────────────────────────────────────────────
      expect(geometry.viewport).toEqual({ width: size.width, height: size.height, dpr: 1 })
      expect(geometry.layout).toBe(size.layout)
      expect(geometry.compactMode).toBe(size.compactMode)
      expect(geometry.contentWidth).toBe(String(size.width))
      expect(geometry.contentHeight).toBe(String(size.height))

      // ── State attributes ────────────────────────────────────────────────────────────────────────
      expect(geometry.alerts).toBe('silent')
      expect(geometry.decision).toBe('CONTINUE')
      expect(geometry.monitoredSystems).toBe('3')
      expect(geometry.monitoredSources).toBe('10')

      // ── No horizontal scroll ────────────────────────────────────────────────────────────────────
      expect(geometry.page.scrollWidth).toBe(geometry.page.clientWidth)

      // ── Fixed element counts ────────────────────────────────────────────────────────────────────
      expect(geometry.zoneCount, '8 silhouette zones').toBe(8)
      expect(geometry.vitalCount, '4 vitals').toBe(4)
      expect(geometry.faultRowCount, '3 fault rows').toBe(3)
      expect(geometry.faultChipCount, '3 fault chips').toBe(3)
      expect(geometry.faultAckCount, '0 ACK buttons in silent').toBe(0)
      expect(geometry.faultNozoneCount, '1 fault-nozone (CHASSIS)').toBe(1)
      expect(geometry.faultEmptyCount, '0 fault-empty rows').toBe(0)
      expect(geometry.cornerHeadCount, '4 corner heads').toBe(4)
      expect(geometry.cornerBrakeCount, '4 corner brakes').toBe(4)
      expect(geometry.cornerPressureCount, '4 corner pressures').toBe(4)
      expect(geometry.decisionCount, '1 decision element').toBe(1)
      expect(geometry.unmonitoredNoticeCount, '1 unmonitored notice').toBe(1)

      // ── Layout-conditional panels ───────────────────────────────────────────────────────────────
      expect(geometry.faultTimelineCount, 'faultTimeline at app only').toBe(isApp ? 1 : 0)
      expect(geometry.decisionCornersCount, 'decisionCorners at app only').toBe(isApp ? 1 : 0)
      expect(geometry.decisionBannerCount, 'decisionBanner at non-app').toBe(isApp ? 0 : 1)
      expect(geometry.cornerStatusCount, 'cornerStatus at non-app').toBe(isApp ? 0 : 1)

      // ── Silhouette zone integrity ───────────────────────────────────────────────────────────────
      expect(geometry.silhouetteZonesAttr, 'data-rc14-zones="8"').toBe('8')
      expect(geometry.silhouetteUnmonitoredAttr, 'data-rc14-unmonitored-zones="6"').toBe('6')
      expect(geometry.unmonitoredNoticeText, '"6 ZONES NO SOURCE" notice').toBe('6 ZONES NO SOURCE')

      const unmonitoredZones = geometry.zoneStates.filter((z) => !z.monitored)
      expect(unmonitoredZones.length, 'exactly 6 unmonitored zones').toBe(6)

      // THE HEADLINE: unmonitored zones must NEVER carry token="normal"/severity="ok"/pattern="solid"
      for (const zone of unmonitoredZones) {
        expect(zone.severity, `unmonitored zone ${zone.id} must not carry severity="ok"`).not.toBe('ok')
        expect(zone.severity, `unmonitored zone ${zone.id} must carry severity="unmonitored"`).toBe('unmonitored')
        expect(zone.token,    `unmonitored zone ${zone.id} must not carry token="normal"`).not.toBe('normal')
        expect(zone.token,    `unmonitored zone ${zone.id} must carry token="secondary"`).toBe('secondary')
        expect(zone.pattern,  `unmonitored zone ${zone.id} must not carry pattern="solid"`).not.toBe('solid')
        expect(zone.pattern,  `unmonitored zone ${zone.id} must carry pattern="outline"`).toBe('outline')
      }

      // Monitored zones must not carry unmonitored markers
      const monitoredZones = geometry.zoneStates.filter((z) => z.monitored)
      expect(monitoredZones.length, '2 monitored zones').toBe(2)
      for (const zone of monitoredZones) {
        expect(zone.severity, `monitored zone ${zone.id} must not be unmonitored`).not.toBe('unmonitored')
        expect(zone.token,    `monitored zone ${zone.id} must not be secondary`).not.toBe('secondary')
      }

      // ── Fault list ─────────────────────────────────────────────────────────────────────────────
      // No unmonitored system label may appear in the fault list
      for (const forbidden of UNMONITORED_SYSTEM_LABELS) {
        expect(
          geometry.faultSystemNames.includes(forbidden),
          `fault list must not contain "${forbidden}" (omission: perZoneDamageChannel)`
        ).toBe(false)
      }

      // ── Oil-temp vital must never alert ────────────────────────────────────────────────────────
      expect(geometry.oilTempVitalAlerting, 'oilTemp vital must never alert').toBe('false')

      // ── Forbidden elements ─────────────────────────────────────────────────────────────────────
      expect(geometry.speedDeltaForbiddenCount, 'no speed/delta surface').toBe(0)
      expect(geometry.systemsDetailForbiddenCount, 'no systems-detail panel').toBe(0)
      expect(/KM\/H|DELTA/i.test(geometry.rootText), 'no speed/delta text').toBe(false)

      // ── Required texts ─────────────────────────────────────────────────────────────────────────
      expect(geometry.rootText).toContain('FAULT MAP')
      expect(geometry.rootText).toContain('FAULTS')
      expect(geometry.rootText).toContain('VITALS')
      expect(geometry.rootText).toContain('6 ZONES NO SOURCE')
      expect(geometry.rootText).toContain('NO ZONE')   // CHASSIS nozone
      expect(geometry.rootText).toContain('CONTINUE')  // silent decision

      // ── Zone geometry ──────────────────────────────────────────────────────────────────────────
      const frame: Rect = { left: 0, top: 0, width: size.width, height: size.height, right: size.width, bottom: size.height }
      for (const zone of geometry.zones) {
        if (zone.display !== 'none' && zone.rect.width > 0) expectContained(frame, zone.rect)
      }
      const vis = geometry.zones.filter((z) => z.display !== 'none' && z.rect.width > 0)
      for (let a = 0; a < vis.length; a += 1) {
        for (let b = a + 1; b < vis.length; b += 1) {
          const first = vis[a]; const second = vis[b]
          const ox = Math.min(first.rect.right, second.rect.right) - Math.max(first.rect.left, second.rect.left)
          const oy = Math.min(first.rect.bottom, second.rect.bottom) - Math.max(first.rect.top, second.rect.top)
          expect(Math.min(ox, oy), `${first.name} overlaps ${second.name}`).toBeLessThanOrEqual(0.5)
        }
      }

      // ── Type scale ─────────────────────────────────────────────────────────────────────────────
      // Strict ladder: decision word > fault chip > corner head
      const decisionPx  = geometry.values.find((v) => v.label === 'decision word')?.fontSize ?? 0
      const faultChipPx = geometry.values.find((v) => v.label === 'fault chip')?.fontSize ?? 0
      const cornerHeadPx = geometry.values.find((v) => v.label === 'corner head')?.fontSize ?? 0
      const vitalValuePx = geometry.values.find((v) => v.label === 'vital value')?.fontSize ?? 0

      expect(decisionPx,  'decision word > fault chip').toBeGreaterThan(faultChipPx)
      expect(faultChipPx, 'fault chip > corner head').toBeGreaterThan(cornerHeadPx)

      // DEFECT RC-14/2: vital-value == decision-word at four viewports, SMALLER at compact-landscape
      if (isCompactLandscape) {
        // DEFECT RC-14/2: decision word is LARGER than vital value at 759x393 and 867x412
        expect(
          vitalValuePx,
          `DEFECT RC-14/2 at ${sizeKey}: vital (${vitalValuePx}px) must be SMALLER than decision (${decisionPx}px)`
        ).toBeLessThan(decisionPx)
        expect(
          vitalValuePx,
          `DEFECT RC-14/2 at ${sizeKey}: vital must still be > 0`
        ).toBeGreaterThan(0)
      } else {
        // At the four non-landscape viewports the declared equality must hold (within 0.5 px tolerance)
        expect(
          Math.abs(vitalValuePx - decisionPx),
          `vital value (${vitalValuePx}px) must equal decision word (${decisionPx}px) within 0.5 px at ${sizeKey}`
        ).toBeLessThanOrEqual(0.5)
      }

      const capture = await page.locator('#racecon-rc14-capture-root').screenshot({ animations: 'disabled' })
      expect(capture.byteLength).toBeGreaterThan(5_000)
    } finally {
      await context.close()
    }
  })
}

test('the critical-fault alert surfaces ENGINE fault and PIT decision (native 800x480)', async ({ browser }) => {
  const size = viewports[0]   // native 800x480
  const sizeKey = '800x480'
  const { context, page } = await openCapture(browser, size, {
    layout: 'native',
    state: 'critical-fault'
  })
  try {
    await expect
      .poll(
        async () => page.locator('[data-widget="raceconRc14Dash"]').getAttribute('data-rc14-alerts'),
        { timeout: 120_000 }
      )
      .toBe('active')

    const geometry = await readGeometry(page)

    expect(geometry.alerts).toBe('active')
    expect(geometry.decision).toBe('PIT')
    expect(geometry.monitoredSystems).toBe('3')
    expect(geometry.monitoredSources).toBe('10')

    // ACK button: 1 critical fault row (ENGINE) in critical-fault state
    expect(geometry.faultAckCount, '1 ACK button for ENGINE critical fault').toBe(1)

    // Required texts in critical-fault state
    expect(geometry.rootText).toContain('PIT')
    expect(geometry.rootText).toContain('CRITICAL')
    expect(geometry.rootText).not.toContain('MINOR')
    expect(geometry.rootText).not.toContain('MAJOR')
    expect(geometry.rootText).not.toContain('PIT LIMITER')
    expect(geometry.rootText).not.toContain('REV LIMITER')

    // THE HEADLINE: unmonitored zones still NEVER carry ok-green markers in critical-fault
    const unmonitoredZones = geometry.zoneStates.filter((z) => !z.monitored)
    expect(unmonitoredZones.length, '6 unmonitored zones in critical-fault').toBe(6)
    for (const zone of unmonitoredZones) {
      expect(zone.severity, `critical-fault: unmonitored zone ${zone.id} severity`).toBe('unmonitored')
      expect(zone.token,    `critical-fault: unmonitored zone ${zone.id} token`).toBe('secondary')
      expect(zone.pattern,  `critical-fault: unmonitored zone ${zone.id} pattern`).toBe('outline')
    }

    // Type scale still holds
    const decisionPx  = geometry.values.find((v) => v.label === 'decision word')?.fontSize ?? 0
    const faultChipPx = geometry.values.find((v) => v.label === 'fault chip')?.fontSize ?? 0
    const cornerHeadPx = geometry.values.find((v) => v.label === 'corner head')?.fontSize ?? 0
    const vitalValuePx = geometry.values.find((v) => v.label === 'vital value')?.fontSize ?? 0
    expect(decisionPx,  'decision > fault chip in critical-fault').toBeGreaterThan(faultChipPx)
    expect(faultChipPx, 'fault chip > corner head in critical-fault').toBeGreaterThan(cornerHeadPx)
    // At native 800x480 vital == decision (equality holds here, DEFECT only at compact-landscape)
    expect(Math.abs(vitalValuePx - decisionPx), 'vital == decision at native in critical-fault').toBeLessThanOrEqual(0.5)

    // DEFECT RC-14/1 — ENGINE fault-system overflow at 800x480 in critical-fault state
    // scrollWidth-based measure
    const engineSysEntry = geometry.faultSystemScrollOverflow.find((e) => e.text === 'ENGINE')
    if (engineSysEntry) {
      expect(
        engineSysEntry.overflowPx,
        `DEFECT RC-14/1 at ${sizeKey}: ENGINE system-name must overflow (ACK button collapses column to 0)`
      ).toBeGreaterThan(0)
      expect(
        engineSysEntry.overflowPx,
        `DEFECT RC-14/1 at ${sizeKey}: ENGINE overflow must be within ${FAULT_SYSTEM_OVERFLOW_BUDGET_PX}px budget`
      ).toBeLessThanOrEqual(FAULT_SYSTEM_OVERFLOW_BUDGET_PX)
    }

    // No unmonitored system label in fault list in critical-fault state
    for (const forbidden of UNMONITORED_SYSTEM_LABELS) {
      expect(
        geometry.faultSystemNames.includes(forbidden),
        `fault list must not contain "${forbidden}" in critical-fault`
      ).toBe(false)
    }

    // Oil-temp vital must never alert
    expect(geometry.oilTempVitalAlerting, 'oilTemp vital must never alert in critical-fault').toBe('false')

    // Forbidden elements still absent
    expect(geometry.speedDeltaForbiddenCount).toBe(0)
    expect(geometry.systemsDetailForbiddenCount).toBe(0)

    const capture = await page.locator('#racecon-rc14-capture-root').screenshot({ animations: 'disabled' })
    expect(capture.byteLength).toBeGreaterThan(5_000)
  } finally {
    await context.close()
  }
})

test('DEFECT RC-14/2: compact-landscape critical-fault also shows vital smaller than decision', async ({ browser }) => {
  // 759x393 critical-fault: vital 23.53 px vs decision 27.32 px (vital < decision)
  const size = viewports[4]   // 759x393
  const sizeKey = '759x393'
  const { context, page } = await openCapture(browser, size, {
    layout: 'compact',
    compactMode: 'landscape',
    state: 'critical-fault'
  })
  try {
    await expect
      .poll(
        async () => page.locator('[data-widget="raceconRc14Dash"]').getAttribute('data-rc14-alerts'),
        { timeout: 120_000 }
      )
      .toBe('active')

    const geometry = await readGeometry(page)
    expect(geometry.decision).toBe('PIT')

    const decisionPx  = geometry.values.find((v) => v.label === 'decision word')?.fontSize ?? 0
    const vitalValuePx = geometry.values.find((v) => v.label === 'vital value')?.fontSize ?? 0

    expect(vitalValuePx, `DEFECT RC-14/2 at ${sizeKey} critical-fault: vital must be < decision`).toBeLessThan(decisionPx)
    expect(vitalValuePx, 'vital value must be > 0').toBeGreaterThan(0)

    // Fault chips must not say MINOR/MAJOR on this fixture
    expect(geometry.rootText).not.toContain('MINOR')
    expect(geometry.rootText).not.toContain('MAJOR')

    const capture = await page.locator('#racecon-rc14-capture-root').screenshot({ animations: 'disabled' })
    expect(capture.byteLength).toBeGreaterThan(5_000)
  } finally {
    await context.close()
  }
})
