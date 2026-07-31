import { describe, expect, it } from 'vitest'
import type { Page } from 'playwright'
import { flattenTree, runInPage, snapshot, withA11yPage } from './harness'

/**
 * WCAG 2.2 A — 2.4.3 Focus Order / 2.4.1 Bypass Blocks, measured rather than argued.
 *
 * The audit recorded the dashboard editor at 2,537 focusable controls with the
 * gallery open. That number is about SEQUENTIAL navigation, and sequential
 * navigation is a browser behaviour: jsdom does not implement Tab at all, so a
 * jsdom test would report the same number whatever the tabindex values are.
 *
 * This is the instrument, not a claim. It mounts the real DashboardCanvasEditor
 * in the Electron Chromium the app ships, presses real Tab keys, and counts
 * where focus actually lands until the cycle repeats. The same file produces the
 * BEFORE and the AFTER number, so the two are comparable by construction.
 *
 * What it does NOT prove: that a screen reader announces the region sensibly.
 * It proves how many times a keyboard user has to press Tab.
 */

/** One full sweep of the editor is ~2.5k stops before the fix; leave headroom. */
const WALK_CAP = 4200

/**
 * Budget for the whole dashboard editor with the gallery open.
 *
 * Chosen from what is left once the card grid stops being 1,269 individual tab
 * stops: the editor chrome, the four filter chip rows, the canvas, the
 * inspector, and one stop for the grid itself.
 */
const EDITOR_TAB_STOP_BUDGET = 220

/** Tag-filter chrome, one roving entry point, and whatever follows the region. */
const PRESET_TAB_STOP_BUDGET = 40

/** One full sweep of the preset screen is ~720 stops before the fix. */
const PRESET_WALK_CAP = 1200

/**
 * The harness runs Vite with `noDiscovery`, so every bare import the editor
 * reaches has to be named. `@react-three/fiber` pulls zustand, which pulls the
 * `use-sync-external-store` shim, and neither is discoverable from source.
 */
const CANVAS_EDITOR_DEPS = [
  'three',
  '@react-three/fiber',
  'zustand',
  'zustand/traditional',
  'use-sync-external-store/shim/with-selector.js'
] as const

/**
 * Installed in the page by both fixtures: records every element focus lands on,
 * with one round trip instead of one per key, so a 4,000-press sweep is
 * affordable. Shared verbatim so the before and after numbers come from
 * identical instrumentation.
 */
const CENSUS_WALKER = String.raw`
function describeNode(node) {
  const parts = []
  let current = node
  while (current && current !== document.documentElement) {
    const parent = current.parentElement
    const index = parent ? Array.prototype.indexOf.call(parent.children, current) : 0
    parts.push(current.tagName + '[' + index + ']')
    current = parent
  }
  return parts.reverse().join('/')
}

window.__census = {
  log: [],
  handler: null,
  install() {
    this.log = []
    if (this.handler) document.removeEventListener('focusin', this.handler, true)
    const log = this.log
    this.handler = (event) => {
      if (event.target instanceof Element) log.push(describeNode(event.target))
    }
    document.addEventListener('focusin', this.handler, true)
    const active = document.activeElement
    if (active && active !== document.body) active.blur()
    window.scrollTo(0, 0)
  },
  read() { return this.log }
}
`

const browserEntry = String.raw`
const listeners = new Map()
Object.defineProperty(window, 'ipc', {
  configurable: true,
  value: {
    invoke() { return Promise.resolve(null) },
    subscribe(channel, callback) {
      const entries = listeners.get(channel) || new Set()
      entries.add(callback); listeners.set(channel, entries)
      return () => entries.delete(callback)
    }
  }
})

${CENSUS_WALKER}

function settle(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

async function run(options) {
  const [React, ReactDom, editor, catalogData, units] = await Promise.all([
    import('react'),
    import('react-dom/client'),
    import('/src/renderer/src/views/dashboard/DashboardCanvasEditor.tsx'),
    import('/src/renderer/src/views/dashboard/widget-catalog-data.ts'),
    import('/src/renderer/src/lib/units.tsx'),
    import('/src/renderer/src/styles/theme.css')
  ])
  const { createElement: h, useState } = React
  const { createRoot } = ReactDom
  const { DashboardCanvasEditor } = editor
  const { ALL_VARIANTS, variantToElement } = catalogData
  const { UnitSystemProvider } = units

  const seed = ALL_VARIANTS.slice(0, 3).map((variant, index) => ({
    ...variantToElement(variant, index * 180, 0),
    id: 'seed-' + index
  }))

  function Fixture() {
    const [board, setBoard] = useState({ width: 1280, height: 720, bg: '#05070a', elements: seed })
    return h(DashboardCanvasEditor, { board, onChange: setBoard })
  }

  const host = document.getElementById('root')
  host.innerHTML = ''
  createRoot(host).render(h(UnitSystemProvider, null, h(Fixture, null)))

  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (host.querySelectorAll('[data-widget-preview="true"]').length >= 423) break
    await settle(25)
  }
  // Let the IntersectionObserver callbacks for the first screenful land, so the
  // measurement reflects a settled gallery rather than a mid-mount one.
  await settle(400)

  const focusableSelector = [
    'a[href]', 'button', 'input', 'select', 'textarea', 'summary', 'details',
    'audio[controls]', 'video[controls]', '[contenteditable]', '[tabindex]'
  ].join(',')

  const all = Array.from(host.querySelectorAll(focusableSelector))
  const enabled = all.filter((node) => !node.disabled)
  // What the browser will actually stop on: not disabled, not tabindex="-1",
  // and not inside a hidden subtree.
  const sequential = enabled.filter((node) => {
    if (node.getAttribute('tabindex') === '-1') return false
    if (node.hasAttribute('inert') || node.closest('[inert]')) return false
    if (node.closest('[hidden]')) return false
    const details = node.closest('details')
    if (details && !details.open && node.tagName !== 'SUMMARY' && node !== details) return false
    return true
  })

  // Off-screen gallery cards, and how many of them the browser would still stop
  // on. Lazy MOUNTING and tab-order exclusion are different properties; this
  // measures the second one directly instead of inferring it from the first.
  const cards = Array.from(host.querySelectorAll('[data-widget-preview="true"]'))
    .map((preview) => preview.closest('[data-gallery-card="true"]') || preview.parentElement)
  const viewportHeight = window.innerHeight
  let offScreenCards = 0
  let offScreenSequentialControls = 0
  for (const card of cards) {
    if (!card) continue
    const rect = card.getBoundingClientRect()
    const onScreen = rect.bottom > 0 && rect.top < viewportHeight
    if (onScreen) continue
    offScreenCards += 1
    for (const control of card.querySelectorAll('button,input,select,a[href],[tabindex]')) {
      if (control.disabled) continue
      if (control.getAttribute('tabindex') === '-1') continue
      offScreenSequentialControls += 1
    }
  }

  return {
    cards: cards.length,
    focusableControls: enabled.length,
    sequentialControls: sequential.length,
    offScreenCards,
    offScreenSequentialControls
  }
}
window.__a11yApi = { run }
`

export interface Census {
  cards: number
  focusableControls: number
  sequentialControls: number
  offScreenCards: number
  offScreenSequentialControls: number
}

/**
 * The second repeated region on the dashboard surface: one "Duplicate and edit"
 * button per built-in preset. Smaller than the widget gallery and on a different
 * screen, but the same defect, so it is measured the same way.
 */
const presetEntry = String.raw`
Object.defineProperty(window, 'ipc', {
  configurable: true,
  value: { invoke() { return Promise.resolve(null) }, subscribe() { return () => {} } }
})

${CENSUS_WALKER}

function settle(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

async function run() {
  const [React, ReactDom, gallery, presets, units] = await Promise.all([
    import('react'),
    import('react-dom/client'),
    import('/src/renderer/src/views/dashboard/preset-gallery.tsx'),
    import('/src/shared/dashboards.ts'),
    import('/src/renderer/src/lib/units.tsx'),
    import('/src/renderer/src/styles/theme.css')
  ])
  const { createElement: h } = React
  const { createRoot } = ReactDom

  const host = document.getElementById('root')
  host.innerHTML = ''
  createRoot(host).render(
    h(units.UnitSystemProvider, null,
      h(React.Fragment, null,
        h(gallery.PresetGallery, { presets: presets.BUILTIN_PRESETS, onPick() {} }),
        h('button', { type: 'button', id: 'after-presets' }, 'After the presets')))
  )
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (host.querySelectorAll('[data-preset-gallery-grid="true"] button').length > 20) break
    await settle(25)
  }
  await settle(400)

  const grid = host.querySelector('[data-preset-gallery-grid="true"]')
  const buttons = Array.from(host.querySelectorAll('button')).filter((node) => !node.disabled)
  // Counted by label, not by container, so the number means the same thing
  // before the fix (no container exists) and after it.
  const pickButtons = buttons.filter((node) => (node.textContent || '').trim() === 'Duplicate and edit')
  return {
    presets: presets.BUILTIN_PRESETS.length,
    cardButtons: pickButtons.length,
    regionFound: Boolean(grid),
    sequentialControls: buttons.filter((node) => node.getAttribute('tabindex') !== '-1').length
  }
}
window.__a11yApi = { run }
`

/**
 * Presses real Tab keys and reports how many distinct stops one full cycle has.
 *
 * Focus is recorded by a capturing `focusin` listener inside the page rather
 * than one round trip per key, so a 2,500-stop sweep stays affordable.
 */
export async function walkTabCycle(page: Page, cap = WALK_CAP): Promise<{ stops: number; cycled: boolean; first: string[] }> {
  await page.evaluate(() => (window as unknown as { __census: { install(): void } }).__census.install())
  for (let step = 0; step < cap; step += 1) {
    await page.keyboard.press('Tab')
  }
  const log = await page.evaluate(
    () => (window as unknown as { __census: { read(): string[] } }).__census.read()
  )
  if (log.length === 0) return { stops: 0, cycled: false, first: [] }
  const firstSignature = log[0]
  const repeat = log.indexOf(firstSignature, 1)
  return {
    stops: repeat === -1 ? log.length : repeat,
    cycled: repeat !== -1,
    first: log.slice(0, 6)
  }
}

describe('dashboard editor tab-stop census (Electron Chromium, real Tab keys)', () => {
  it('counts the sequential tab stops of the editor with the gallery open', async () => {
    await withA11yPage({ browserEntry, cacheKey: 'a11y-tab-stop-census', optimizeInclude: CANVAS_EDITOR_DEPS }, async (page) => {
      const census = await runInPage<Census>(page)
      const walk = await walkTabCycle(page)

      // eslint-disable-next-line no-console
      console.log(
        '\nTAB-STOP CENSUS  cards=%d  focusable=%d  sequential(static)=%d  tabStops(real Tab)=%d  cycled=%s\n' +
          '  off-screen cards=%d  of which still sequential controls=%d\n',
        census.cards,
        census.focusableControls,
        census.sequentialControls,
        walk.stops,
        walk.cycled,
        census.offScreenCards,
        census.offScreenSequentialControls
      )

      // The surface really is the one the audit measured.
      expect(census.cards, 'the gallery must be fully mounted for this to measure anything').toBeGreaterThanOrEqual(423)
      expect(walk.cycled, `focus never returned to its start within ${WALK_CAP} Tab presses`).toBe(true)

      // Lazy mounting is not tab-order exclusion. This is the assertion that
      // separates the two: a card nowhere near the viewport must not be a stop
      // a keyboard user is forced to walk past. One is allowed — the roving
      // entry point has to live somewhere, and at rest that is the first card.
      expect(
        census.offScreenSequentialControls,
        `${census.offScreenSequentialControls} controls on ${census.offScreenCards} off-screen cards are still sequential tab stops`
      ).toBeLessThanOrEqual(1)

      expect(
        walk.stops,
        `${walk.stops} tab stops to cross the dashboard editor (budget ${EDITOR_TAB_STOP_BUDGET})`
      ).toBeLessThanOrEqual(EDITOR_TAB_STOP_BUDGET)
    })
  }, 900_000)

  it('still reaches every card with the arrow keys, so nothing became mouse-only', async () => {
    await withA11yPage({ browserEntry, cacheKey: 'a11y-tab-stop-census', optimizeInclude: CANVAS_EDITOR_DEPS }, async (page) => {
      await runInPage<Census>(page)

      // Enter the gallery the way a keyboard user does: Tab until focus is on a
      // roving item. The whole point is that this takes a handful of presses.
      await page.evaluate(() => {
        ;(document.activeElement as HTMLElement | null)?.blur()
        window.scrollTo(0, 0)
      })
      let pressesToEnterGallery = 0
      for (let step = 0; step < 60; step += 1) {
        await page.keyboard.press('Tab')
        pressesToEnterGallery += 1
        const inGrid = await page.evaluate(() =>
          Boolean(document.activeElement?.closest('[data-widget-gallery-grid="true"]'))
        )
        if (inGrid) break
      }
      const entry = await page.evaluate(() => ({
        roving: document.activeElement?.getAttribute('data-roving-item') ?? '',
        label: document.activeElement?.closest('[role="group"]')?.getAttribute('aria-label') ?? ''
      }))
      expect(entry.roving, `Tab never reached the gallery in ${pressesToEnterGallery} presses`).toBe('true')

      // Arrows walk the region. 40 presses is far past the first screenful, so
      // this lands on a card that was off-screen and out of the tab order.
      for (let step = 0; step < 40; step += 1) await page.keyboard.press('ArrowRight')
      const afterArrows = await page.evaluate(() => ({
        roving: document.activeElement?.getAttribute('data-roving-item') ?? '',
        label: document.activeElement?.closest('[role="group"]')?.getAttribute('aria-label') ?? '',
        inGrid: Boolean(document.activeElement?.closest('[data-widget-gallery-grid="true"]'))
      }))
      expect(afterArrows.inGrid, 'ArrowRight walked out of the gallery').toBe(true)
      expect(afterArrows.roving).toBe('true')
      expect(
        afterArrows.label,
        'arrow navigation should have moved onto a different card than the entry point'
      ).not.toBe(entry.label)

      // End reaches the last control in the region, which is the deepest card.
      await page.keyboard.press('End')
      const atEnd = await page.evaluate(() => {
        const grid = document.querySelector('[data-widget-gallery-grid="true"]')
        const items = grid ? Array.from(grid.querySelectorAll('[data-roving-item]')) : []
        return {
          isLast: items.length > 0 && items[items.length - 1] === document.activeElement,
          items: items.length
        }
      })
      expect(atEnd.items, 'the region should still hold every control it did before').toBeGreaterThan(3000)
      expect(atEnd.isLast, 'End must reach the last control in the region').toBe(true)

      // The roving invariant: exactly one entry point, never zero (which would
      // strand the region) and never many (which is the bug being fixed).
      const entryPoints = await page.evaluate(() => {
        const grid = document.querySelector('[data-widget-gallery-grid="true"]')
        return grid ? grid.querySelectorAll('[data-roving-item][tabindex="0"]').length : -1
      })
      expect(entryPoints).toBe(1)

      // The region is exposed as a composite widget, which is what tells
      // assistive technology that arrow keys are the way through it.
      const toolbars = flattenTree(await snapshot(page)).filter(
        (node) => !node.ignored && node.role === 'toolbar'
      )
      expect(
        toolbars.some((node) => node.name.toLowerCase().includes('widget gallery')),
        `no named toolbar in the accessibility tree; toolbars found: ${toolbars.map((n) => JSON.stringify(n.name)).join(', ')}`
      ).toBe(true)

      // And Tab from inside leaves the region in ONE press.
      await page.keyboard.press('Tab')
      const escaped = await page.evaluate(() =>
        Boolean(document.activeElement) &&
        !document.activeElement!.closest('[data-widget-gallery-grid="true"]')
      )
      expect(escaped, 'one Tab from inside the gallery must leave the region').toBe(true)
    })
  }, 900_000)

  it('counts the preset gallery the same way', async () => {
    await withA11yPage({ browserEntry: presetEntry, cacheKey: 'a11y-tab-stop-census', optimizeInclude: CANVAS_EDITOR_DEPS }, async (page) => {
      const census = await runInPage<{ presets: number; cardButtons: number; regionFound: boolean; sequentialControls: number }>(page)

      // eslint-disable-next-line no-console
      console.log(
        '\nPRESET CENSUS  presets=%d  "Duplicate and edit" buttons=%d  sequential controls on the page=%d\n',
        census.presets,
        census.cardButtons,
        census.sequentialControls
      )

      expect(census.cardButtons, 'the preset region must be the repeated one').toBeGreaterThan(20)

      await page.evaluate(() => {
        ;(document.activeElement as HTMLElement | null)?.blur()
        window.scrollTo(0, 0)
      })
      const walk = await walkTabCycle(page, PRESET_WALK_CAP)
      expect(walk.cycled, 'focus never returned to its start').toBe(true)
      // eslint-disable-next-line no-console
      console.log('\nPRESET CENSUS  tabStops(real Tab)=%d\n', walk.stops)

      // Tag filter chrome + one roving entry point + the trailing control, not
      // one stop per preset.
      expect(
        walk.stops,
        `${walk.stops} tab stops to cross a gallery of ${census.cardButtons} presets`
      ).toBeLessThan(census.cardButtons)
      expect(walk.stops).toBeLessThanOrEqual(PRESET_TAB_STOP_BUDGET)

      // Both repeated regions on this screen are exposed as composite widgets,
      // which is what tells assistive technology the arrows are the way through.
      const toolbars = flattenTree(await snapshot(page)).filter(
        (node) => !node.ignored && node.role === 'toolbar'
      )
      expect(
        toolbars.length,
        `expected the preset grid and the tag row to be toolbars; found: ${toolbars.map((n) => JSON.stringify(n.name)).join(', ')}`
      ).toBeGreaterThanOrEqual(2)

      // The tag row must still be traversable, or 2.4.3 was fixed by breaking
      // 2.1.1. Focus its entry point and walk it with the arrow keys.
      const tagWalk = await page.evaluate(() => {
        const row = document.querySelector('[data-tag-filter-chips="true"]')
        const entry = row?.querySelector<HTMLElement>('[data-roving-item][tabindex="0"]')
        entry?.focus()
        return { entry: entry?.textContent?.trim() ?? '', items: row?.querySelectorAll('[data-roving-item]').length ?? 0 }
      })
      expect(tagWalk.items, 'the tag row should still hold every chip').toBeGreaterThan(300)
      for (let step = 0; step < 25; step += 1) await page.keyboard.press('ArrowRight')
      const tagAfter = await page.evaluate(() => ({
        text: document.activeElement?.textContent?.trim() ?? '',
        inRow: Boolean(document.activeElement?.closest('[data-tag-filter-chips="true"]'))
      }))
      expect(tagAfter.inRow, 'ArrowRight walked out of the tag row').toBe(true)
      expect(tagAfter.text, 'arrows did not move within the tag row').not.toBe(tagWalk.entry)
    })
  }, 900_000)
})
