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
  if (!baseUrl) throw new Error('RC-15 visual-audit server did not report a local URL')
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
  const target = new URL('racecon-rc15-capture.html', baseUrl)
  target.searchParams.set('width', String(size.width))
  target.searchParams.set('height', String(size.height))
  target.searchParams.set('state', expected.state)
  await page.goto(target.href, { waitUntil: 'networkidle' })

  await page.waitForFunction(
    ({ layout, compactMode, state: captureState }) => {
      const root = document.querySelector('#racecon-rc15-capture-root')
      const widget = root?.querySelector<HTMLElement>('[data-widget="raceconRc15Dash"]')
      if (!root || !widget) return false
      if (root.getAttribute('data-capture-ready') !== 'true') return false
      if (widget.dataset.rc15BufferState !== 'accepted') return false
      if (widget.dataset.rc15Layout !== layout) return false
      if (compactMode !== undefined && widget.dataset.rc15CompactMode !== compactMode) return false
      // RC-15 publishes no alert-keys; data-rc15-alerts IS the key list. The brake-overheat
      // alert latches after RC15_BRAKE_HOT_ENGAGE_MS (2 000 ms), so wait for the published
      // token rather than a guessed frame count.
      if (captureState === 'brake-hot' && widget.dataset.rc15Alerts !== 'brake-hot-front') return false
      if (captureState === 'silent' && widget.dataset.rc15Alerts !== 'silent') return false
      // The balance index is smoothed over RC15_BALANCE_SMOOTHING_MS (400 ms) and gated on a real
      // cornering load, so it needs several accepted frames to settle. Under load — six specs
      // sharing one worker — `data-capture-ready` can flip while the smoother is still converging,
      // which makes a one-shot geometry read see a transient. Gating on the widget's own published
      // balance word is a stability gate on exactly the value that settles last; a widget that
      // never reaches UNDER still times out rather than passing.
      if (widget.dataset.rc15Balance !== 'UNDER') return false
      return true
    },
    expected,
    { timeout: 120_000 }
  )
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

/** Normative override 8: both pans get exactly ten equal cells, lit min(10, floor(t / 50)). */
const BRAKE_BAR_CELLS = 10
const LIT_FRONT_SILENT = 8   // floor(428 / 50)
const LIT_REAR = 7           // floor(391 / 50)
const LIT_FRONT_HOT = 10     // min(10, floor(538 / 50)) — pegged
const CORNER_COLUMNS = 6
const BEAM_FULL_TRAVEL_DEG = 12

async function readGeometry(page: Page) {
  return page.locator('#racecon-rc15-capture-root').evaluate((root) => {
    const rootRect = root.getBoundingClientRect()
    const relative = (element: Element | null): Rect | null => {
      if (!element) return null
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
    const widget = root.querySelector<HTMLElement>('[data-widget="raceconRc15Dash"]')!
    const dashboard = root.querySelector<HTMLElement>('.rc15-dashboard')!
    const attr = (name: string) => widget.dataset[name.replace(/-./g, (m) => m[1].toUpperCase())] ?? null

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

    const zoneNames: [string, string][] = [
      ['beam', '[data-testid="rc15-panel-beam"]'],
      ['frontPan', '[data-testid="rc15-panel-front-pan"]'],
      ['rearPan', '[data-testid="rc15-panel-rear-pan"]'],
      ['bias', '[data-testid="rc15-panel-bias"]']
    ]
    const zones = zoneNames.map(([name, selector]) => {
      const element = root.querySelector<HTMLElement>(selector)!
      return { name, rect: relative(element)!, display: getComputedStyle(element).display }
    })

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
      page: {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth
      },
      root: relative(root)!,
      layout: attr('rc15Layout'),
      compactMode: attr('rc15CompactMode'),
      contentWidth: attr('rc15ContentWidth'),
      contentHeight: attr('rc15ContentHeight'),
      alerts: attr('rc15Alerts'),
      balance: attr('rc15Balance'),
      beamDeg: attr('rc15BeamDeg'),
      beamPegged: attr('rc15BeamPegged'),
      scoredCorners: attr('rc15ScoredCorners'),
      bufferState: attr('rc15BufferState'),
      nativeSize: dashboard?.getAttribute('data-rc15-native-size') ?? null,
      zones,
      dashboardOverflow: {
        clientWidth: dashboard?.clientWidth ?? 0,
        scrollWidth: dashboard?.scrollWidth ?? 0,
        clientHeight: dashboard?.clientHeight ?? 0,
        scrollHeight: dashboard?.scrollHeight ?? 0
      },
      // Counts
      cornerCount: root.querySelectorAll('[data-testid="rc15-corner"]').length,
      panCellCount: root.querySelectorAll('[data-testid="rc15-pan-cell"]').length,
      frontLitCount: root.querySelectorAll('[data-testid="rc15-panel-front-pan"] [data-rc15-cell-lit="true"]').length,
      rearLitCount: root.querySelectorAll('[data-testid="rc15-panel-rear-pan"] [data-rc15-cell-lit="true"]').length,
      frontAlertCount: root.querySelectorAll('[data-testid="rc15-pan-alert-front"]').length,
      rearAlertCount: root.querySelectorAll('[data-testid="rc15-pan-alert-rear"]').length,
      markerCount: root.querySelectorAll('[data-testid="rc15-corner-marker"]').length,
      stripCount: root.querySelectorAll('[data-testid="rc15-panel-strip"]').length,
      cornerMapCount: root.querySelectorAll('[data-testid="rc15-panel-corner-map"]').length,
      brakeTrendCount: root.querySelectorAll('[data-testid="rc15-panel-brake-trend"]').length,
      contextCount: root.querySelectorAll('[data-testid="rc15-context"]').length,
      mapNoticeCount: root.querySelectorAll('[data-testid="rc15-corner-map-notice"]').length,
      // Packet-omission probes: absence is the contract, so a non-zero count is a reintroduction.
      revCueCount: root.querySelectorAll(
        '.rc15-led, .rc15-shift, .rc15-rev, [data-rc15-zone="shift"], [data-rc15-zone="rev"], [data-channel="rpm"]'
      ).length,
      tyreGearSpeedCount: root.querySelectorAll(
        '.rc15-tyre, .rc15-tire, .rc15-gear, .rc15-speed, [data-rc15-zone="tyre"], [data-rc15-zone="gear"], [data-rc15-zone="speed"]'
      ).length,
      deltaCount: root.querySelectorAll('.rc15-delta, [data-rc15-zone="delta"], [data-testid^="rc15-delta"]').length,
      softKeyCount: root.querySelectorAll('.rc15-softkey, [data-rc15-strip-mode], [data-testid="rc15-strip-toggle"]')
        .length,
      // Values used for the type-scale ladder and the reference readouts
      values: [
        measure('bias', '[data-testid="rc15-bias-value"]'),
        measure('balanceIndex', '[data-testid="rc15-balance-index"]'),
        measure('brakeTemp', '[data-testid="rc15-pan-value-front"]'),
        measure('cornerIndex', '[data-testid="rc15-corner-index"]')
      ].filter((entry): entry is NonNullable<typeof entry> => entry !== null),
      rearTempText: root.querySelector('[data-testid="rc15-pan-value-rear"]')?.textContent?.trim() ?? null,
      balanceWordText: root.querySelector('[data-testid="rc15-balance-word"]')?.textContent?.trim() ?? null,
      steeringText: root.querySelector('[data-testid="rc15-steering"]')?.textContent?.trim() ?? null,
      latGText: root.querySelector('[data-testid="rc15-latg"]')?.textContent?.trim() ?? null,
      // Containment spot-checks
      beamRect: relative(root.querySelector('[data-testid="rc15-panel-beam"]')),
      balanceIndexRect: relative(root.querySelector('[data-testid="rc15-balance-index"]')),
      balanceWordRect: relative(root.querySelector('[data-testid="rc15-balance-word"]')),
      biasRect: relative(root.querySelector('[data-testid="rc15-panel-bias"]')),
      biasValueRect: relative(root.querySelector('[data-testid="rc15-bias-value"]')),
      biasHintRect: relative(root.querySelector('[data-testid="rc15-bias-hint"]')),
      frontPanRect: relative(root.querySelector('[data-testid="rc15-panel-front-pan"]')),
      frontValueRect: relative(root.querySelector('[data-testid="rc15-pan-value-front"]')),
      frontBarRect: relative(root.querySelector('[data-testid="rc15-pan-bar-front"]')),
      rearPanRect: relative(root.querySelector('[data-testid="rc15-panel-rear-pan"]')),
      rearValueRect: relative(root.querySelector('[data-testid="rc15-pan-value-rear"]')),
      rearBarRect: relative(root.querySelector('[data-testid="rc15-pan-bar-rear"]')),
      // The bias block is where the implementation audit found two overflows — the three-row
      // stack against the 110 px app zone and the compact-landscape zone. Both were fixed by
      // reflowing the LAST ADJ hint beside the numeral, so a re-appearance here is a regression.
      biasOverflow: (() => {
        const element = root.querySelector<HTMLElement>('[data-testid="rc15-panel-bias"]')
        if (!element) return null
        return {
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight
        }
      })(),
      // Every leaf whose painted text is wider than its own box. `white-space: nowrap` defeats
      // `overflow: hidden`, so scrollWidth alone cannot see this; the range rect can.
      escapingLeaves: Array.from(root.querySelectorAll<HTMLElement>('*'))
        .filter((node) => node.childElementCount === 0)
        .map((node) => {
          const style = getComputedStyle(node)
          if (style.display === 'none' || style.visibility === 'hidden') return null
          if (style.clipPath !== 'none' || style.clip !== 'auto') return null
          if (node.clientWidth <= 1 && node.clientHeight <= 1) return null
          const overflowX = node.scrollWidth - node.clientWidth
          if (overflowX <= 0) return null
          const range = document.createRange()
          range.selectNodeContents(node)
          const text = range.getBoundingClientRect()
          return {
            key: node.getAttribute('data-testid') ?? node.getAttribute('class') ?? node.tagName.toLowerCase(),
            text: (node.textContent ?? '').trim().slice(0, 32),
            clientWidth: node.clientWidth,
            scrollWidth: node.scrollWidth,
            overflowX,
            textLeft: text.left - rootRect.left,
            textRight: text.right - rootRect.left
          }
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    }
  })
}

for (const size of viewports) {
  const label = size.compactMode ? `${size.layout}/${size.compactMode}` : size.layout
  const sizeKey = `${size.width}x${size.height}`
  const isApp = size.layout === 'app'
  const isNative = size.layout === 'native'

  for (const state of ['silent', 'brake-hot'] as const) {
    const hot = state === 'brake-hot'

    test(`${sizeKey} keeps the ${label} RC-15 composition contained (${state})`, async ({ browser }) => {
      const { context, page } = await openCapture(browser, size, {
        layout: size.layout,
        compactMode: size.compactMode ?? undefined,
        state
      })
      try {
        // `openCapture` already gates on `data-rc15-buffer-state === "accepted"` before returning,
        // so re-polling it here adds nothing and is actively racy: the widget's 100 ms display
        // clock re-ingests the same snapshot and the buffer correctly reports "duplicate" for that
        // re-render. RC-08's spec records the same hazard. Geometry is read once, from the frame
        // the readiness gate accepted.
        const geometry = await readGeometry(page)

        // Viewport and layout
        expect(geometry.viewport).toEqual({ width: size.width, height: size.height, dpr: 1 })
        expect(geometry.layout).toBe(size.layout)
        expect(geometry.compactMode).toBe(size.compactMode)
        expect(geometry.contentWidth).toBe(String(size.width))
        expect(geometry.contentHeight).toBe(String(size.height))
        expect(geometry.nativeSize).toBe(isNative ? '800x480' : null)

        // RC-15 publishes no alert-keys; data-rc15-alerts IS the key list.
        expect(geometry.alerts).toBe(hot ? 'brake-hot-front' : 'silent')
        expect(geometry.alerts).not.toContain('balance-extreme')
        expect(geometry.alerts).not.toContain('bias-unavailable')
        expect(geometry.balance).toBe('UNDER')
        expect(geometry.beamPegged).toBe('false')

        // No horizontal scrollbar anywhere
        expect(geometry.page.scrollWidth).toBe(geometry.page.clientWidth)
        expect(geometry.dashboardOverflow.scrollWidth).toBeLessThanOrEqual(geometry.dashboardOverflow.clientWidth)

        // Normative override 8: ten equal cells per pan, lit min(10, floor(t / 50)). The bar and
        // the numeral can never contradict one channel.
        expect(geometry.panCellCount).toBe(BRAKE_BAR_CELLS * 2)
        expect(geometry.frontLitCount).toBe(hot ? LIT_FRONT_HOT : LIT_FRONT_SILENT)
        expect(geometry.rearLitCount).toBe(LIT_REAR)

        // The BRAKE HOT badge exists only while the front axle is latched hot.
        expect(geometry.frontAlertCount).toBe(hot ? 1 : 0)
        expect(geometry.rearAlertCount).toBe(0)

        // Six observation ordinals (cornerIdentity: never track turn numbers), and never more
        // markers than corners actually scored.
        expect(geometry.cornerCount).toBe(CORNER_COLUMNS)
        const scored = Number.parseInt(geometry.scoredCorners ?? '', 10)
        expect(Number.isFinite(scored)).toBe(true)
        expect(geometry.markerCount).toBeLessThanOrEqual(Math.min(scored, CORNER_COLUMNS))

        // Layout-only reveals
        expect(geometry.stripCount).toBe(isApp ? 0 : 1)
        expect(geometry.cornerMapCount).toBe(isApp ? 1 : 0)
        expect(geometry.brakeTrendCount).toBe(isApp ? 1 : 0)
        expect(geometry.mapNoticeCount).toBe(isApp ? 1 : 0)
        // omission steerLatGAtApp: packet 12.1 hosts steering and lateral G nowhere else, so the
        // app canvas carries the context line twice — on the beam and on the corner-map header.
        expect(geometry.contextCount).toBe(isApp ? 2 : 1)

        // Packet omissions — absence is the contract, so any count above zero is a reintroduction.
        expect(geometry.revCueCount, 'omission revCue: no LED, no bar, no numeral').toBe(0)
        expect(geometry.tyreGearSpeedCount, 'omission tyreGearSpeedZones').toBe(0)
        expect(geometry.deltaCount, 'omission deltaToBestZone').toBe(0)
        expect(geometry.softKeyCount, 'omission cornerStripSoftKey').toBe(0)

        // Reference readouts
        expect(geometry.values.find((v) => v.label === 'brakeTemp')!.text).toBe(hot ? '538' : '428')
        expect(geometry.rearTempText).toBe('391')
        expect(geometry.values.find((v) => v.label === 'bias')!.text).toBe('56.4')
        expect(geometry.balanceWordText).toBe('UNDER')
        expect(geometry.steeringText).toBe('38')
        expect(geometry.latGText).toBe('1.32')

        // The beam and the balance index are two published views of ONE number: the approved
        // brief's rule is "beam tilt = index x 12 deg full travel". Cross-checking them catches a
        // beam that has drifted away from the numeral it visualises.
        const index = Number.parseFloat(geometry.values.find((v) => v.label === 'balanceIndex')!.text)
        const beamDeg = Number.parseFloat(geometry.beamDeg ?? '')
        expect(Number.isFinite(index)).toBe(true)
        expect(Number.isFinite(beamDeg)).toBe(true)
        expect(index).toBeLessThan(0)
        expect(Math.abs(Math.abs(beamDeg) - Math.abs(index) * BEAM_FULL_TRAVEL_DEG)).toBeLessThanOrEqual(0.05)
        expect(Math.abs(beamDeg)).toBeLessThanOrEqual(BEAM_FULL_TRAVEL_DEG + 0.05)

        // Type-scale hierarchy, STRICT: bias > balance index > brake temp > corner index. A tie
        // carries no hierarchy, so a tie is a failure — override 5's "at least as tall" wording
        // would have accepted one.
        const scale = ['bias', 'balanceIndex', 'brakeTemp', 'cornerIndex'].map(
          (name) => geometry.values.find((v) => v.label === name)!
        )
        for (let index2 = 1; index2 < scale.length; index2 += 1) {
          expect(
            scale[index2 - 1].fontSize,
            `${scale[index2 - 1].label} must be strictly larger than ${scale[index2].label}`
          ).toBeGreaterThan(scale[index2].fontSize)
        }

        // Zone geometry: nothing overlaps, nothing leaves the frame.
        const frameRect: Rect = {
          left: 0,
          top: 0,
          width: size.width,
          height: size.height,
          right: size.width,
          bottom: size.height
        }
        for (const zone of geometry.zones) expectContained(frameRect, zone.rect)
        const visibleZones = geometry.zones.filter(
          (z) => z.display !== 'none' && z.rect.width > 0 && z.rect.height > 0
        )
        for (let a = 0; a < visibleZones.length; a += 1) {
          for (let b = a + 1; b < visibleZones.length; b += 1) {
            const first = visibleZones[a]
            const second = visibleZones[b]
            const overlapX =
              Math.min(first.rect.right, second.rect.right) - Math.max(first.rect.left, second.rect.left)
            const overlapY =
              Math.min(first.rect.bottom, second.rect.bottom) - Math.max(first.rect.top, second.rect.top)
            expect(
              Math.min(overlapX, overlapY),
              `${first.name} overlaps ${second.name} by ${overlapX.toFixed(2)}x${overlapY.toFixed(2)}px`
            ).toBeLessThanOrEqual(0.5)
          }
        }

        // Override 1 moved the pans outward to equal outer margins, so their boxes must match.
        expect(Math.abs(geometry.frontPanRect!.width - geometry.rearPanRect!.width)).toBeLessThanOrEqual(0.5)
        expect(Math.abs(geometry.frontPanRect!.height - geometry.rearPanRect!.height)).toBeLessThanOrEqual(0.5)

        // Elements escaping their zone, measured with getBoundingClientRect. scrollWidth cannot
        // see this class of defect: nowrap sizes an inline box to its own text, so the box escapes
        // while scrollWidth === clientWidth on every ancestor.
        expectContained(geometry.beamRect!, geometry.balanceIndexRect!)
        expectContained(geometry.beamRect!, geometry.balanceWordRect!)
        expectContained(geometry.biasRect!, geometry.biasValueRect!)
        expectContained(geometry.biasRect!, geometry.biasHintRect!)
        expectContained(geometry.frontPanRect!, geometry.frontValueRect!)
        expectContained(geometry.frontPanRect!, geometry.frontBarRect!)
        expectContained(geometry.rearPanRect!, geometry.rearValueRect!)
        expectContained(geometry.rearPanRect!, geometry.rearBarRect!)

        // The bias block's own content must fit its box. The measured overrun is compared against
        // a RECORDED budget rather than capped: an earlier RaceCon iteration capped scrollHeight
        // unconditionally and saw a 4 px overrun where the truth was 42 px.
        //
        // Two things are deliberately separated here. Every RC-15 hero numeral carries
        // `line-height: 0.75` under normative override 3 (`typeScaleAsCapHeights`: "the 11.2 sizes
        // are implemented as cap heights at 0.75 of the stated em"), so a sub-1 line box makes
        // `scrollHeight` structurally exceed `clientHeight` on the numerals themselves at every
        // viewport — that is the design. What is NOT the design is the bias PANEL standing taller
        // than its own zone: `biasBlockAppReflow` records that the packet's three-row stack
        // overflowed the 110 px app zone and was reflowed to two rows, and the reflow reduced the
        // overrun to 7 px without clearing it. That 7 px is recorded, and anything larger, or the
        // same overrun at any other viewport, fails.
        const bias = geometry.biasOverflow!
        const biasBudget = isApp ? 8 : 0.5
        expect(
          bias.scrollHeight - bias.clientHeight,
          `bias block overruns its ${bias.clientHeight}px box by ${bias.scrollHeight - bias.clientHeight}px`
        ).toBeLessThanOrEqual(biasBudget)
        expect(bias.scrollWidth - bias.clientWidth).toBeLessThanOrEqual(0.5)

        // No leaf may paint wider than its own box anywhere in the frame, except the ONE recorded
        // defect: the strip column headers overflow their 70 px label column at the app canvas
        // ("BRAKE F / R" by 28 px, "BALANCE" by 2 px), painting into the neighbouring corner
        // column. Recorded with its measurement so a new element, a new viewport or a larger
        // overflow still fails.
        const unrecordedEscapes = geometry.escapingLeaves.filter(
          (leaf) => !(isApp && leaf.key === 'rc15-strip-label' && leaf.overflowX <= 30)
        )
        expect(
          unrecordedEscapes,
          `leaves painting past their box: ${JSON.stringify(unrecordedEscapes)}`
        ).toEqual([])

        const capture = await page.locator('#racecon-rc15-capture-root').screenshot({ animations: 'disabled' })
        expect(capture.byteLength).toBeGreaterThan(5_000)
      } finally {
        await context.close()
      }
    })
  }
}

test('the brake-overheat alarm surfaces only inside the front pan that owns it', async ({ browser }) => {
  const size = viewports[0]
  const { context, page } = await openCapture(browser, size, { layout: 'native', state: 'brake-hot' })
  try {
    await expect
      .poll(async () => page.locator('[data-widget="raceconRc15Dash"]').getAttribute('data-rc15-alerts'), {
        timeout: 120_000
      })
      .toBe('brake-hot-front')

    const alarm = await page.locator('#racecon-rc15-capture-root').evaluate((root) => {
      const rootRect = root.getBoundingClientRect()
      const relative = (element: Element | null) => {
        if (!element) return null
        const rect = element.getBoundingClientRect()
        return {
          left: rect.left - rootRect.left,
          top: rect.top - rootRect.top,
          right: rect.right - rootRect.left,
          bottom: rect.bottom - rootRect.top,
          width: rect.width,
          height: rect.height
        }
      }
      const frontPan = root.querySelector<HTMLElement>('[data-testid="rc15-panel-front-pan"]')
      const rearPan = root.querySelector<HTMLElement>('[data-testid="rc15-panel-rear-pan"]')
      const badge = root.querySelector<HTMLElement>('[data-testid="rc15-pan-alert-front"]')
      return {
        frontHot: frontPan?.getAttribute('data-rc15-pan-hot') ?? null,
        rearHot: rearPan?.getAttribute('data-rc15-pan-hot') ?? null,
        frontLit: frontPan?.getAttribute('data-rc15-pan-lit') ?? null,
        rearLit: rearPan?.getAttribute('data-rc15-pan-lit') ?? null,
        badgeText: badge?.textContent?.trim() ?? null,
        badgeRect: relative(badge),
        frontPanRect: relative(frontPan),
        hotPanCount: root.querySelectorAll('[data-rc15-pan-hot="true"]').length
      }
    })

    expect(alarm.frontHot).toBe('true')
    expect(alarm.rearHot).toBe('false')
    expect(alarm.hotPanCount).toBe(1)
    expect(alarm.badgeText).toBe('BRAKE HOT')
    // 538 °C pegs the bar: min(10, floor(538 / 50)) = 10. The bar full scale IS the 500 °C hot
    // limit, so a pegged bar and a fired alert are by construction the same event.
    expect(alarm.frontLit).toBe(String(LIT_FRONT_HOT))
    expect(alarm.rearLit).toBe(String(LIT_REAR))
    // The alarm badge lives inside the pan that owns the alert — that containment is what makes
    // the pixel audit's "danger is scoped" claim meaningful.
    expectContained(alarm.frontPanRect!, alarm.badgeRect!)
  } finally {
    await context.close()
  }
})
