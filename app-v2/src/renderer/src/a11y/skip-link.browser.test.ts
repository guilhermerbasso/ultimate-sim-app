import { describe, expect, it } from 'vitest'
import { flattenTree, runInPage, snapshot, withA11yPage } from './harness'

/**
 * WCAG 2.2 A — 2.4.1 Bypass Blocks, and 2.4.3 Focus Order.
 *
 * The audit measured navigation at 94+ tab stops repeated across 47 views with
 * no way past it. A skip link is only a skip link if a keyboard user can reach
 * it and it actually moves focus, and both of those are browser behaviours:
 * jsdom does not implement Tab, so a jsdom test would pass whether or not any
 * of this works. This presses real Tab and Enter keys inside the Electron
 * Chromium the app ships and asserts WHERE FOCUS ENDS UP.
 *
 * What this does NOT prove: that NVDA or JAWS announces the link sensibly. The
 * accessibility tree proves the link is exposed and named; it does not prove
 * how a screen reader reads it.
 */

const browserEntry = String.raw`
const listeners = new Map()
// Replies default to an empty array: iterable, spreadable, and safe to read a
// missing field off, so the shell reaches first paint instead of dying in a
// bootstrap effect. Settings are the one reply the shell cannot survive being
// empty, so they are filled in with the real defaults before it renders.
let appSettings = null
Object.defineProperty(window, 'ipc', {
  configurable: true,
  value: {
    invoke(channel) {
      return Promise.resolve(channel === 'app:getSettings' ? appSettings : [])
    },
    subscribe(channel, callback) {
      const entries = listeners.get(channel) || new Set()
      entries.add(callback); listeners.set(channel, entries)
      return () => entries.delete(callback)
    }
  }
})

// The shell also talks to the SIM-X bridge on mount. Only the shape matters
// here: the assertions are about focus order, not about device data.
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

async function run() {
  // First run opens the onboarding modal and then the per-view tutorial, both of
  // which correctly trap focus. The audit is about the steady state a returning
  // user meets, so both flags are set the way finishing them would set them.
  window.localStorage.setItem('usa.onboardingCompleted', '1')
  window.localStorage.setItem('usa.tutorial.autoDisabled.v1', 'true')
  const [React, ReactDom, app, devices, units, settings] = await Promise.all([
    import('react'),
    import('react-dom/client'),
    import('/src/renderer/src/App.tsx'),
    import('/src/renderer/src/lib/devices/DeviceRegistry.tsx'),
    import('/src/renderer/src/lib/units.tsx'),
    import('/src/shared/settings.ts'),
    import('/src/renderer/src/styles/theme.css'),
    import('/src/renderer/src/styles/navigation.css'),
    import('/src/renderer/src/styles/glass.css')
  ])
  const { createElement: h } = React
  const { createRoot } = ReactDom
  appSettings = settings.DEFAULT_APP_SETTINGS

  const mount = document.getElementById('root')
  mount.innerHTML = ''
  createRoot(mount).render(
    h(units.UnitSystemProvider, null,
      h(devices.DeviceRegistryProvider, null, h(app.default, null)))
  )
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (document.querySelector('.app-shell')) break
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  await new Promise((resolve) => setTimeout(resolve, 300))

  const main = document.getElementById('main-content')
  const link = document.querySelector('.skip-link')
  return {
    shellMounted: Boolean(document.querySelector('.app-shell')),
    hasMainLandmark: Boolean(main) && main.tagName === 'MAIN',
    // A <main> that also wraps the navigation is not a landmark you can skip TO.
    mainWrapsSidebar: Boolean(main && main.querySelector('.sidebar')),
    navTabStops: document.querySelectorAll('.sidebar a[href], .sidebar button, .sidebar input, .sidebar select').length,
    // Before focus the link must be out of the way; display:none would make it
    // unfocusable and therefore not a skip link at all, so it has to be present
    // and merely parked.
    restingTop: link ? link.getBoundingClientRect().top : null,
    linkIsRendered: Boolean(link)
  }
}
window.__a11yApi = { run }
`

interface Shell {
  shellMounted: boolean
  hasMainLandmark: boolean
  mainWrapsSidebar: boolean
  navTabStops: number
  restingTop: number | null
  linkIsRendered: boolean
}

describe('skip link (Electron Chromium, real Tab and Enter keys)', () => {
  it('is the first tab stop and lands focus inside the main landmark', async () => {
    await withA11yPage({ browserEntry, cacheKey: 'a11y-skip-link' }, async (page) => {
      const shell = await runInPage<Shell>(page)

      expect(shell.shellMounted, 'the real App shell must mount for this to measure anything').toBe(true)

      // 1. There is a <main> landmark, and it covers the content only.
      expect(shell.hasMainLandmark, 'no <main> landmark exists for a skip link to target').toBe(true)
      expect(
        shell.mainWrapsSidebar,
        'the <main> landmark still wraps the sidebar, so "skip to main content" skips nothing'
      ).toBe(false)

      // 2. The block being bypassed is the one the audit measured.
      expect(shell.navTabStops, 'the navigation block should be the large one the audit found').toBeGreaterThan(80)

      // 3. The link exists and is parked off-screen while unfocused.
      expect(shell.linkIsRendered).toBe(true)
      expect(
        shell.restingTop,
        'the skip link must be visually hidden until focused, not merely present'
      ).toBeLessThan(0)

      // 4. The FIRST Tab from a freshly loaded window lands on it.
      await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null
        active?.blur()
        window.scrollTo(0, 0)
      })
      await page.keyboard.press('Tab')
      const first = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null
        const path: string[] = []
        let node: Element | null = active
        while (node && node !== document.documentElement) {
          path.push(node.tagName.toLowerCase() + (node.className ? '.' + String(node.className).split(' ')[0] : ''))
          node = node.parentElement
        }
        return {
          className: String(active?.className ?? ''),
          tag: active?.tagName ?? '',
          text: active?.textContent?.trim() ?? '',
          outer: active?.outerHTML?.slice(0, 140) ?? '',
          path: path.reverse().join(' > '),
          top: active ? active.getBoundingClientRect().top : -1
        }
      })
      expect(
        first.className,
        `the first Tab landed on ${first.path} (${first.outer}) instead of the skip link`
      ).toContain('skip-link')
      expect(first.text.length).toBeGreaterThan(0)
      // 5. And it becomes visible once focused. The reveal is a CSS transition,
      //    so this waits for it rather than racing it.
      await page
        .waitForFunction(
          () => {
            const link = document.querySelector('.skip-link')
            return Boolean(link) && link!.getBoundingClientRect().top >= 0
          },
          undefined,
          { timeout: 5_000 }
        )
        .catch(() => {
          throw new Error('a skip link that stays off-screen while focused is not visible')
        })
      const revealed = await page.evaluate(() => {
        const link = document.querySelector('.skip-link')!
        const rect = link.getBoundingClientRect()
        return { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
      })
      expect(revealed.top).toBeGreaterThanOrEqual(0)
      expect(revealed.height, 'the revealed skip link must have a real hit area').toBeGreaterThan(0)

      // 6. It is exposed and named in the real Chromium accessibility tree. The
      //    comparison is case-insensitive because the link is uppercased in CSS
      //    and Chromium folds text-transform into the computed name.
      const links = flattenTree(await snapshot(page)).filter(
        (node) => !node.ignored && node.role === 'link'
      )
      const named = links.filter(
        (node) => node.name.trim().toLowerCase() === first.text.trim().toLowerCase()
      )
      expect(
        named.length,
        `no link named "${first.text}" in the accessibility tree; links found: ` +
          links.map((node) => JSON.stringify(node.name)).join(', ')
      ).toBeGreaterThan(0)

      // 7. Activating it moves focus INTO the main landmark. This is the whole
      //    claim: not that the link exists, but where focus is afterwards.
      await page.keyboard.press('Enter')
      const landed = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null
        const main = document.getElementById('main-content')
        return {
          isMain: active === main,
          inMain: Boolean(main && active && (active === main || main.contains(active))),
          tag: active?.tagName ?? '',
          id: active?.id ?? '',
          className: active?.className ?? ''
        }
      })
      expect(
        landed.inMain,
        `focus went to <${landed.tag} id="${landed.id}" class="${landed.className}"> instead of the main landmark`
      ).toBe(true)
      expect(landed.isMain, 'focus should rest on the landmark itself so it is announced').toBe(true)

      // 8. From there the next Tab is already inside the content, so the whole
      //    navigation block has genuinely been bypassed.
      await page.keyboard.press('Tab')
      const afterMain = await page.evaluate(() => {
        const main = document.getElementById('main-content')
        const active = document.activeElement
        return {
          inMain: Boolean(main && active && main.contains(active)),
          inSidebar: Boolean(active && active.closest('.sidebar'))
        }
      })
      expect(afterMain.inSidebar, 'the next Tab fell back into the navigation the link just skipped').toBe(false)
      expect(afterMain.inMain).toBe(true)
    })
  }, 300_000)
})
