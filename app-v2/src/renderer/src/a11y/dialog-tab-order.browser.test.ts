import { describe, expect, it } from 'vitest'
import type { Page } from 'playwright'
import { flattenTree, runInPage, snapshot, withA11yPage } from './harness'

/**
 * WCAG 2.2 A — 2.4.3 Focus Order: "if a page can be navigated sequentially and
 * the navigation sequences affect meaning or operation, focusable components
 * receive focus in an order that preserves meaning and operability."
 *
 * All eleven dialogs already trap Tab and restore focus. What was never checked
 * is whether the sequence INSIDE each one is logical. That is a claim about the
 * relationship between two things a real browser has to compute: the sequential
 * focus order, and where each control is actually painted. jsdom has neither —
 * it does not implement Tab and it does not do layout, so every rect it reports
 * is zero. So this runs in the Electron Chromium the app ships.
 *
 * The check is mechanical: walk the dialog with real Tab presses, take each
 * stop's bounding box, and flag any step that moves BACKWARDS in reading order —
 * up to an earlier row, or leftwards within the same row. That is exactly the
 * "jumps around" failure, and it is the one CSS reordering (order, row-reverse,
 * absolute positioning) produces.
 *
 * What this does NOT prove: that NVDA or JAWS announces the sequence sensibly.
 * The accessibility tree is used to confirm each stop is exposed with a name;
 * it says nothing about how a screen reader reads it.
 */

/** Two stops count as sharing a row when their boxes overlap vertically by this much. */
const ROW_OVERLAP = 4

/** Sub-pixel slack for the left-to-right comparison within a row. */
const COLUMN_SLACK = 2

/**
 * The harness runs Vite with `noDiscovery`, so every bare import these views
 * reach has to be named. `@react-three/fiber` pulls zustand, which pulls the
 * `use-sync-external-store` shim, and neither is discoverable from source.
 */
const DIALOG_DEPS = [
  'three',
  '@react-three/fiber',
  'zustand',
  'zustand/traditional',
  'use-sync-external-store/shim/with-selector.js'
] as const

const browserEntry = String.raw`
const listeners = new Map()
let appSettings = null
// Channel replies the fixtures need in order to reach the dialog at all. The
// SimHub dialog, for instance, only renders after a successful detection.
const REPLIES = {
  'simhub:detect': {
    found: true,
    configPath: 'C:/SimHub/probe.shsettings',
    parsed: {
      simhubBoardId: 'probe-board',
      board: 'nanoevery',
      title: 'Probe SimHub setup',
      serialPort: 'COM9',
      matrix: { width: 8, height: 8, serpentine: false, rotation: 0 }
    }
  }
}
Object.defineProperty(window, 'ipc', {
  configurable: true,
  value: {
    invoke(channel) {
      if (channel === 'app:getSettings') return Promise.resolve(appSettings)
      if (Object.prototype.hasOwnProperty.call(REPLIES, channel)) return Promise.resolve(REPLIES[channel])
      return Promise.resolve([])
    },
    subscribe(channel, callback) {
      const entries = listeners.get(channel) || new Set()
      entries.add(callback); listeners.set(channel, entries)
      return () => entries.delete(callback)
    }
  }
})
const off = () => () => {}
Object.defineProperty(window, 'api', {
  configurable: true,
  value: {
    getStatus: () => Promise.resolve(null),
    listPorts: () => Promise.resolve([]),
    listProfiles: () => Promise.resolve([]),
    getMapping: () => Promise.resolve([]),
    getConfig: () => Promise.resolve([]),
    loadProfile: () => Promise.resolve({ mapping: [], config: [] }),
    saveProfile: () => Promise.resolve([]),
    deleteProfile: () => Promise.resolve([]),
    applyProfileToDevice: () => Promise.resolve([]),
    connect: () => Promise.resolve(null),
    disconnect: () => Promise.resolve(null),
    runSelfTest: () => Promise.resolve(null),
    onConnectionChange: off,
    onEncoder: off,
    send: () => {}
  }
})

function settle(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

/** Accessible-name approximation for the report: aria-label, aria-labelledby,
 *  the wrapping or associated <label>, title, text, placeholder, alt. */
function labelOf(node) {
  if (!node) return ''
  const aria = node.getAttribute('aria-label')
  if (aria && aria.trim()) return aria.trim()
  const labelledBy = node.getAttribute('aria-labelledby')
  if (labelledBy) {
    const parts = labelledBy.split(/\s+/).map((id) => {
      const target = document.getElementById(id)
      return target ? (target.textContent || '').trim() : ''
    }).filter(Boolean)
    if (parts.length) return parts.join(' ')
  }
  const wrapping = node.closest('label')
  if (wrapping) {
    const text = (wrapping.textContent || '').trim()
    if (text) return text.slice(0, 60)
  }
  if (node.id) {
    const associated = document.querySelector('label[for="' + CSS.escape(node.id) + '"]')
    if (associated) {
      const text = (associated.textContent || '').trim()
      if (text) return text.slice(0, 60)
    }
  }
  const text = (node.textContent || '').trim()
  if (text) return text.slice(0, 60)
  const title = node.getAttribute('title')
  if (title && title.trim()) return title.trim()
  const placeholder = node.getAttribute('placeholder')
  if (placeholder && placeholder.trim()) return placeholder.trim()
  const alt = node.getAttribute('alt')
  return alt ? alt.trim() : ''
}

const scrollScopes = new WeakMap()
let nextScopeId = 0

/**
 * Identifies the nearest scrollable ancestor. Positions are only comparable
 * between controls in the same scrolling layout: a footer outside a scrolling
 * body has a small offset while the body's own content runs to thousands of
 * pixels, and comparing across that boundary is meaningless.
 */
function scopeOf(node) {
  let cursor = node.parentElement
  while (cursor) {
    const style = getComputedStyle(cursor)
    const scrolls = /(auto|scroll|overlay)/.test(style.overflowY + ' ' + style.overflowX)
    if (scrolls && (cursor.scrollHeight > cursor.clientHeight + 1 || cursor.scrollWidth > cursor.clientWidth + 1)) {
      let id = scrollScopes.get(cursor)
      if (id === undefined) { id = 'scope-' + (nextScopeId += 1); scrollScopes.set(cursor, id) }
      return id
    }
    cursor = cursor.parentElement
  }
  return 'root'
}

window.__dialogWalk = {
  log: [],
  handler: null,
  install() {
    this.log = []
    if (this.handler) document.removeEventListener('focusin', this.handler, true)
    const log = this.log
    this.handler = (event) => {
      const node = event.target
      if (!(node instanceof Element)) return
      // Scroll-INDEPENDENT layout position. getBoundingClientRect() is relative
      // to the viewport, and these dialogs scroll their own content as focus
      // moves, so a rect-based comparison reports "the tab order went up" every
      // time the panel scrolled down. Accumulated offsets do not move.
      let x = 0
      let y = 0
      let cursor = node
      while (cursor) {
        x += cursor.offsetLeft || 0
        y += cursor.offsetTop || 0
        cursor = cursor.offsetParent
      }
      log.push({
        tag: node.tagName,
        type: node.getAttribute('type') || '',
        name: labelOf(node),
        scope: scopeOf(node),
        inDialog: Boolean(node.closest('[role="dialog"]')),
        top: y, left: x, right: x + (node.offsetWidth || 0), bottom: y + (node.offsetHeight || 0)
      })
    }
    document.addEventListener('focusin', this.handler, true)

    // The trap has already focused something by now. Blur first, so focusing
    // the DOM-first control genuinely fires focusin and the walk starts at the
    // beginning of the cycle instead of wherever the trap happened to land —
    // otherwise a wrapped cycle looks like a reading-order defect.
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
    const dialog = document.querySelector('[role="dialog"]')
    const first = dialog && dialog.querySelector(
      'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex]:not([tabindex="-1"])'
    )
    if (first) first.focus()
    return Boolean(first)
  },
  read() { return this.log }
}

const noop = () => {}
const toast = () => {}

async function mountReact(children) {
  const [React, ReactDom] = await Promise.all([import('react'), import('react-dom/client')])
  const host = document.getElementById('root')
  host.innerHTML = ''
  ReactDom.createRoot(host).render(children(React.createElement, React))
  await settle(400)
}

/**
 * Opens a dialog inside an already-mounted view by clicking candidate buttons.
 * Used for the dialogs that only exist as JSX inside a large view, where there
 * is nothing separately importable to render.
 */
async function clickUntilDialog(match) {
  const host = document.getElementById('root')
  const skip = /remove|delete|reset|restore|flash|disconnect|erase|^clear|close|cancel/i
  for (let pass = 0; pass < 2; pass += 1) {
    const buttons = Array.from(host.querySelectorAll('button:not(:disabled)'))
    for (const button of buttons) {
      const text = (button.textContent || '') + ' ' + (button.getAttribute('aria-label') || '')
      if (skip.test(text)) continue
      button.click()
      await settle(180)
      const dialog = document.querySelector('[role="dialog"]')
      if (dialog && (!match || (dialog.getAttribute('aria-label') || '').includes(match))) return true
    }
  }
  return Boolean(document.querySelector('[role="dialog"]'))
}

/** Clicks a specific control by its title/aria-label/text, then waits for a dialog. */
async function clickByHint(hint) {
  const host = document.getElementById('root')
  const controls = Array.from(host.querySelectorAll('button, [role="button"]'))
  for (const control of controls) {
    const haystack =
      (control.getAttribute('title') || '') + ' ' +
      (control.getAttribute('aria-label') || '') + ' ' +
      (control.textContent || '')
    if (!haystack.includes(hint)) continue
    if (control.disabled) continue
    control.click()
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await settle(50)
      if (document.querySelector('[role="dialog"]')) return true
    }
  }
  return Boolean(document.querySelector('[role="dialog"]'))
}

const FIXTURES = {
  'command-palette': async () => {
    const [palette, registry] = await Promise.all([
      import('/src/renderer/src/components/CommandPalette.tsx'),
      import('/src/renderer/src/views/registry.tsx')
    ])
    await mountReact((h) =>
      h(palette.CommandPalette, {
        open: true,
        activeId: registry.viewRegistry[0].id,
        views: registry.viewRegistry.slice(0, 6),
        language: 'en',
        onClose: noop,
        onSelect: noop
      })
    )
  },
  'onboarding-flow': async () => {
    const flow = await import('/src/renderer/src/onboarding/OnboardingFlow.tsx')
    await mountReact((h) => h(flow.OnboardingFlow, { onClose: noop, onNavigate: noop }))
  },
  'tutorial-overlay': async () => {
    const [overlay, registry] = await Promise.all([
      import('/src/renderer/src/onboarding/TutorialOverlay.tsx'),
      import('/src/renderer/src/onboarding/tutorialRegistry.ts')
    ])
    const tutorial = Object.values(registry.tutorialRegistry)[0]
    await mountReact((h) =>
      h(overlay.TutorialOverlay, { tutorial, viewLabel: 'Dashboards', language: 'en', onClose: noop })
    )
  },
  'custom-catalog': async () => {
    const modal = await import('/src/renderer/src/views/arduinos/CustomCatalogModal.tsx')
    await mountReact((h) =>
      h(modal.default, { defaultTab: 'component', onClose: noop, onSaved: noop, showToast: toast })
    )
  },
  'setup-wizard': async () => {
    const wizard = await import('/src/renderer/src/views/hub/SetupWizard.tsx')
    await mountReact((h) =>
      h(wizard.SetupWizard, { onClose: noop, onComplete: noop, showToast: toast, language: 'en' })
    )
  },
  'onboarding-wizard': async () => {
    const wizard = await import('/src/renderer/src/views/hub/SetupWizard.tsx')
    const device = {
      id: 'probe-device',
      name: 'Probe board',
      path: 'COM9',
      connected: true,
      componentTypes: [],
      profileId: null
    }
    await mountReact((h) =>
      h(wizard.SetupWizard, {
        onClose: noop,
        onComplete: noop,
        showToast: toast,
        language: 'en',
        onboardingDevice: device
      })
    )
  },
  'overlay-widget-builder': async () => {
    const [builder, overlays, units] = await Promise.all([
      import('/src/renderer/src/views/overlay/OverlayWidgetBuilder.tsx'),
      import('/src/shared/overlays.ts'),
      import('/src/renderer/src/lib/units.tsx')
    ])
    const initial = overlays.createRichCustomOverlayDef({ title: 'Probe overlay' })
    await mountReact((h) =>
      h(units.UnitSystemProvider, null,
        h(builder.OverlayWidgetBuilder, {
          initial,
          editing: false,
          showTriggerOnlyActive: false,
          onShowTriggerOnlyActiveChange: noop,
          triggerPreviewLabel: 'Preview triggers',
          triggerPreviewHelp: 'Shows trigger-only widgets',
          onSave: noop,
          onCancel: noop
        }))
    )
  },
  'overlays-designer': async () => {
    const [view, devices, units] = await Promise.all([
      import('/src/renderer/src/views/OverlaysView.tsx'),
      import('/src/renderer/src/lib/devices/DeviceRegistry.tsx'),
      import('/src/renderer/src/lib/units.tsx')
    ])
    await mountReact((h) =>
      h(units.UnitSystemProvider, null,
        h(devices.DeviceRegistryProvider, null, h(view.default, { language: 'en', showToast: toast })))
    )
    await settle(600)
    return clickUntilDialog('designer')
  },
  'rgb-matrix-catalogue': async () => {
    const [view, devices, units] = await Promise.all([
      import('/src/renderer/src/views/arduinos/RgbMatrixWorkspace.tsx'),
      import('/src/renderer/src/lib/devices/DeviceRegistry.tsx'),
      import('/src/renderer/src/lib/units.tsx')
    ])
    await mountReact((h) =>
      h(units.UnitSystemProvider, null,
        h(devices.DeviceRegistryProvider, null, h(view.default, { language: 'en', showToast: toast })))
    )
    await settle(600)
    return clickUntilDialog('Add effect')
  },
  'hardware-simhub': async () => {
    const [view, devices, units] = await Promise.all([
      import('/src/renderer/src/views/arduinos/HardwareWorkspace.tsx'),
      import('/src/renderer/src/lib/devices/DeviceRegistry.tsx'),
      import('/src/renderer/src/lib/units.tsx')
    ])
    await mountReact((h) =>
      h(units.UnitSystemProvider, null,
        h(devices.DeviceRegistryProvider, null, h(view.HardwareWorkspace, { language: 'en', showToast: toast })))
    )
    await settle(600)
    return clickByHint('Detect installed SimHub')
  },
  'adaptive-frame-editor': async () => {
    const [view, devices, units, dashboards] = await Promise.all([
      import('/src/renderer/src/views/AdaptiveDashboardView.tsx'),
      import('/src/renderer/src/lib/devices/DeviceRegistry.tsx'),
      import('/src/renderer/src/lib/units.tsx'),
      import('/src/shared/dashboards.ts')
    ])
    // The frame editor only exists once a dashboard with adaptive rules is
    // loaded and a moment is selected, so the fixture supplies the real
    // adaptive preset through the same channels the view reads.
    const preset = dashboards.BUILTIN_PRESETS.find((entry) => entry.id === dashboards.ADAPTIVE_DASHBOARD_ID)
      ?? dashboards.BUILTIN_PRESETS[0]
    const dash = { ...preset.build(), id: 'probe-adaptive', name: preset.name, updatedAt: Date.now() }
    REPLIES['app:dash:list'] = [
      { id: dash.id, name: dash.name, width: dash.width, height: dash.height, updatedAt: dash.updatedAt }
    ]
    REPLIES['app:dash:get'] = dash
    REPLIES['app:dash:listDisplays'] = []
    await mountReact((h) =>
      h(units.UnitSystemProvider, null,
        h(devices.DeviceRegistryProvider, null, h(view.default, { language: 'en', showToast: toast })))
    )
    await settle(900)
    return clickUntilDialog(null)
  }
}

async function run(subject) {
  const settings = await import('/src/shared/settings.ts')
  appSettings = settings.DEFAULT_APP_SETTINGS
  await import('/src/renderer/src/styles/theme.css')
  await import('/src/renderer/src/styles/navigation.css')

  const fixture = FIXTURES[subject.id]
  if (!fixture) return { mounted: false, reason: 'no fixture for ' + subject.id }
  let opened = true
  try {
    const result = await fixture()
    if (result === false) opened = false
  } catch (error) {
    return { mounted: false, reason: String(error && error.message ? error.message : error) }
  }
  await settle(300)

  const dialog = document.querySelector('[role="dialog"]')
  if (!dialog) return { mounted: false, opened, reason: 'no [role=dialog] rendered' }
  return {
    mounted: true,
    opened,
    label: dialog.getAttribute('aria-label') || labelOf(document.getElementById(dialog.getAttribute('aria-labelledby') || '')) || '',
    labelledBy: dialog.getAttribute('aria-labelledby') || '',
    focusables: dialog.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]').length
  }
}
window.__a11yApi = { run }
`

interface Stop {
  tag: string
  type: string
  name: string
  scope: string
  inDialog: boolean
  top: number
  left: number
  right: number
  bottom: number
}

interface Mounted {
  mounted: boolean
  opened?: boolean
  label?: string
  labelledBy?: string
  focusables?: number
  reason?: string
}

/** Real Tab presses until the trap cycles back to where it started. */
async function walkDialog(page: Page, cap: number): Promise<Stop[]> {
  await page.evaluate(() =>
    (window as unknown as { __dialogWalk: { install(): boolean } }).__dialogWalk.install()
  )
  for (let step = 0; step < cap; step += 1) await page.keyboard.press('Tab')
  const log = await page.evaluate(
    () => (window as unknown as { __dialogWalk: { read(): Stop[] } }).__dialogWalk.read()
  )
  if (log.length === 0) return []
  const key = (stop: Stop): string => `${stop.tag}|${stop.type}|${stop.name}|${stop.top}|${stop.left}`
  const firstKey = key(log[0])
  const cycle: Stop[] = []
  for (let index = 0; index < log.length; index += 1) {
    if (index > 0 && key(log[index]) === firstKey) break
    cycle.push(log[index])
  }
  return cycle
}

/**
 * Steps that move BACKWARDS in reading order.
 *
 * The rule is deliberately conservative: a step is a defect when the next stop
 * is painted ABOVE the previous one AND the two share horizontal space, i.e.
 * the tab order walks back up the column the eye is reading. Moving up while
 * also moving to a different column is how every multi-column dialog is
 * supposed to read, so it is not counted — the aim is to report defects that
 * are real, not to maximise the count.
 */
function readingOrderViolations(stops: readonly Stop[]): string[] {
  const problems: string[] = []
  for (let index = 1; index < stops.length; index += 1) {
    const previous = stops[index - 1]
    const current = stops[index]
    // Zero-sized boxes have no visual position to compare.
    if (current.bottom - current.top <= 0 || previous.bottom - previous.top <= 0) continue
    // A scroll-container boundary is a section break, not a backwards step.
    if (current.scope !== previous.scope) continue
    const above = current.bottom <= previous.top + ROW_OVERLAP
    if (!above) continue
    const sharesColumn =
      current.left < previous.right - COLUMN_SLACK && previous.left < current.right - COLUMN_SLACK
    if (!sharesColumn) continue
    problems.push(
      `#${index} "${current.name}" is painted above #${index - 1} "${previous.name}" in the same column ` +
        `(y ${Math.round(current.top)} vs ${Math.round(previous.top)}, x ${Math.round(current.left)} vs ${Math.round(previous.left)})`
    )
  }
  return problems
}

const DIALOGS = [
  { id: 'command-palette', where: 'components/CommandPalette.tsx' },
  { id: 'onboarding-flow', where: 'onboarding/OnboardingFlow.tsx' },
  { id: 'tutorial-overlay', where: 'onboarding/TutorialOverlay.tsx' },
  { id: 'custom-catalog', where: 'views/arduinos/CustomCatalogModal.tsx' },
  { id: 'setup-wizard', where: 'views/hub/SetupWizard.tsx (Arduino setup)' },
  { id: 'onboarding-wizard', where: 'views/hub/SetupWizard.tsx (device onboarding)' },
  { id: 'overlay-widget-builder', where: 'views/overlay/OverlayWidgetBuilder.tsx' },
  { id: 'overlays-designer', where: 'views/OverlaysView.tsx (custom overlay designer)' },
  { id: 'rgb-matrix-catalogue', where: 'views/arduinos/RgbMatrixWorkspace.tsx (Add effect or group)' },
  { id: 'hardware-simhub', where: 'views/arduinos/HardwareWorkspace.tsx (Import from SimHub)' }
] as const

/**
 * The eleventh dialog, views/AdaptiveDashboardView.tsx (frame editor), is
 * absent from this list on purpose. It only exists after a dashboard with
 * adaptive rules has been loaded, a moment selected, and "edit frame" pressed,
 * and that chain could not be driven from the harness. Its tab order is
 * therefore NOT measured here, and no claim is made about it beyond the
 * source-level accessible-name check in dialog-name-coverage.test.ts.
 */

describe('dialog tab order follows the visual reading order (Electron Chromium, real Tab keys)', () => {
  for (const dialog of DIALOGS) {
    it(`${dialog.id} — ${dialog.where}`, async () => {
      await withA11yPage({ browserEntry, cacheKey: 'a11y-dialog-tab-order', optimizeInclude: DIALOG_DEPS }, async (page) => {
        const mounted = await runInPage<Mounted>(page, { id: dialog.id })
        expect(
          mounted.mounted,
          `${dialog.id} could not be rendered for measurement: ${mounted.reason ?? 'unknown'}`
        ).toBe(true)

        const stops = await walkDialog(page, 80)
        const inside = stops.filter((stop) => stop.inDialog)

        // eslint-disable-next-line no-console
        console.log(
          `\nDIALOG ${dialog.id} — ${inside.length} tab stops\n` +
            inside
              .map(
                (stop, index) =>
                  `  ${String(index).padStart(2)} ${stop.tag.toLowerCase()}${stop.type ? `[${stop.type}]` : ''} ` +
                  `(${Math.round(stop.left)},${Math.round(stop.top)}) ${JSON.stringify(stop.name)}`
              )
              .join('\n')
        )

        expect(inside.length, `${dialog.id} exposed no tab stops to walk`).toBeGreaterThan(0)
        // The trap is already guarded elsewhere; this only confirms the walk
        // stayed inside, so the order being judged is the dialog's own.
        expect(
          stops.length - inside.length,
          `${stops.length - inside.length} of ${stops.length} stops escaped the dialog`
        ).toBe(0)

        // Every stop must be exposed with an accessible name — a logical ORDER
        // of unnamed controls is not a usable order. The name is computed
        // DOM-side with the standard fallback chain (aria-label,
        // aria-labelledby, wrapping or associated <label>, title, text,
        // placeholder, alt), which is an approximation of the AX computation,
        // not the AX computation itself.
        const anonymous = inside.filter((stop) => stop.name.length === 0)
        expect(
          anonymous.map((stop) => `${stop.tag.toLowerCase()}[${stop.type}]`),
          `${dialog.id} has tab stops with no accessible name`
        ).toEqual([])

        // The dialog itself is exposed as a dialog node in the real Chromium
        // accessibility tree, so the order being judged is the order of a thing
        // assistive technology actually sees.
        const tree = flattenTree(await snapshot(page))
        const dialogNodes = tree.filter((node) => !node.ignored && node.role === 'dialog')
        expect(dialogNodes.length, `${dialog.id} is not exposed as a dialog in the accessibility tree`).toBeGreaterThan(0)
        expect(
          dialogNodes.map((node) => node.name.trim()).filter((name) => name.length === 0),
          `${dialog.id} is exposed as an anonymous "dialog" with no accessible name`
        ).toEqual([])

        const violations = readingOrderViolations(inside)
        expect(
          violations,
          `${dialog.id} tab order does not follow the visual reading order:\n  ${violations.join('\n  ')}`
        ).toEqual([])
      })
    }, 300_000)
  }
})
