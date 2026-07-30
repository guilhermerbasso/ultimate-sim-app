import { describe, expect, it } from 'vitest'
import type { Page } from 'playwright'
import { runInPage, withA11yPage } from './harness'

/**
 * WCAG 2.2 AA — 2.1.2 No Keyboard Trap, 2.4.3 Focus Order.
 *
 * These assertions need REAL sequential focus navigation. jsdom does not
 * implement Tab at all: focus never moves unless code moves it, so a jsdom test
 * would pass whether or not the dialog traps focus. Only a real browser can
 * demonstrate that Tab cannot escape the dialog, which is the whole claim.
 */

const browserEntry = String.raw`
Object.defineProperty(window, 'ipc', {
  configurable: true,
  value: { invoke() { return Promise.resolve(null) }, subscribe() { return () => {} } }
})

async function run(subject) {
  const [React, ReactDom, trap] = await Promise.all([
    import('react'),
    import('react-dom/client'),
    import('/src/renderer/src/lib/useFocusTrap.ts')
  ])
  const { createElement: h, useState, Fragment } = React
  const { createRoot } = ReactDom
  const { useFocusTrap } = trap

  function Dialog({ onClose, withTrap }) {
    const { containerRef, onKeyDown } = useFocusTrap({ onEscape: onClose, active: withTrap })
    return h('div', {
      ref: containerRef,
      onKeyDown,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Probe dialog',
      id: 'dialog'
    },
      h('button', { id: 'first', type: 'button' }, 'First'),
      h('input', { id: 'middle', type: 'text', 'aria-label': 'Middle' }),
      h('button', { id: 'last', type: 'button' }, 'Last')
    )
  }

  function Fixture({ withTrap }) {
    const [open, setOpen] = useState(false)
    return h(Fragment, null,
      h('button', { id: 'before', type: 'button' }, 'Before'),
      h('button', { id: 'opener', type: 'button', onClick: () => setOpen(true) }, 'Open'),
      h('button', { id: 'after', type: 'button' }, 'After'),
      open ? h(Dialog, { withTrap, onClose: () => setOpen(false) }) : null
    )
  }

  const mount = document.getElementById('root')
  mount.innerHTML = ''
  const root = createRoot(mount)
  root.render(h(Fixture, { withTrap: subject.withTrap }))
  await new Promise((resolve) => setTimeout(resolve, 40))
  return { ready: true }
}
window.__a11yApi = { run }
`

const activeId = (page: Page): Promise<string> =>
  page.evaluate(() => document.activeElement?.id ?? '<none>')

describe('dialog focus management (Electron Chromium, real Tab keys)', () => {
  it('traps Tab, honours Escape, and restores focus to the opener', async () => {
    await withA11yPage({ browserEntry }, async (page) => {
      await runInPage(page, { withTrap: true })

      // Open from a known element, so restoration has a target to prove.
      await page.click('#opener')
      await page.waitForSelector('#dialog')
      await page.waitForFunction(() => document.activeElement?.id === 'first')

      // 1. Focus ENTERS the dialog.
      expect(await activeId(page)).toBe('first')

      // 2. Tab CYCLES inside and never reaches #after or #before.
      const order: string[] = []
      for (let step = 0; step < 6; step += 1) {
        await page.keyboard.press('Tab')
        order.push(await activeId(page))
      }
      expect(order).toEqual(['middle', 'last', 'first', 'middle', 'last', 'first'])

      // 3. Shift+Tab wraps backwards, still inside.
      await page.keyboard.press('Shift+Tab')
      expect(await activeId(page)).toBe('last')

      // 4. Escape closes.
      await page.keyboard.press('Escape')
      await page.waitForSelector('#dialog', { state: 'detached' })

      // 5. Focus RETURNS to the element that opened the dialog.
      await page.waitForFunction(() => document.activeElement?.id === 'opener')
      expect(await activeId(page)).toBe('opener')
    })
  }, 240_000)

  it('shows the untrapped behaviour it replaces', async () => {
    await withA11yPage({ browserEntry }, async (page) => {
      await runInPage(page, { withTrap: false })
      await page.click('#opener')
      await page.waitForSelector('#dialog')

      // Untrapped, Tab from the last control walks straight out of the dialog
      // into the page behind it instead of cycling back to the first.
      await page.focus('#last')
      await page.keyboard.press('Tab')
      expect(await activeId(page)).not.toBe('first')
    })
  }, 240_000)
})
