import { describe, expect, it } from 'vitest'
import type { Page } from 'playwright'
import { imageNodes, runInPage, snapshot, withA11yPage, flattenTree } from './harness'

/**
 * WCAG 2.2 AA — 2.1.1 Keyboard, 2.4.7 Focus Visible.
 *
 * The dashboard canvas was pointer-only: element boxes and resize handles were
 * plain `<div>`s with only pointer handlers, so a keyboard user could neither
 * reach a widget nor move or resize one. These assertions drive real key events
 * and read the resulting geometry, so a token keyboard path that exists but
 * does nothing would fail.
 */

const browserEntry = String.raw`
Object.defineProperty(window, 'ipc', {
  configurable: true,
  value: { invoke() { return Promise.resolve(null) }, subscribe() { return () => {} } }
})

async function run() {
  const [React, ReactDom, editor, units] = await Promise.all([
    import('react'),
    import('react-dom/client'),
    import('/src/renderer/src/views/dashboard/DashboardCanvasEditor.tsx'),
    import('/src/renderer/src/lib/units.tsx')
  ])
  const { createElement: h, useState } = React
  const { createRoot } = ReactDom
  const { DashboardCanvasEditor } = editor

  const seed = {
    width: 800,
    height: 480,
    bg: '#000',
    elements: [
      { id: 'alpha', type: 'text', name: 'Alpha', x: 100, y: 100, w: 120, h: 60, style: {}, text: 'A' },
      { id: 'beta', type: 'text', name: 'Beta', x: 400, y: 200, w: 120, h: 60, style: {}, text: 'B' }
    ]
  }

  function Harness() {
    const [board, setBoard] = useState(seed)
    window.__board = board
    return h('div', null,
      h('button', { id: 'before-canvas', type: 'button' }, 'Before'),
      h(DashboardCanvasEditor, { board, onChange: setBoard })
    )
  }

  const mount = document.getElementById('root')
  mount.innerHTML = ''
  createRoot(mount).render(h(units.UnitSystemProvider, null, h(Harness)))
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 16))
  return { ready: true }
}
window.__a11yApi = { run }
`

const geometryOf = (page: Page, id: string): Promise<{ x: number; y: number; w: number; h: number }> =>
  page.evaluate((elementId) => {
    const board = (window as unknown as {
      __board: { elements: { id: string; x: number; y: number; w: number; h: number }[] }
    }).__board
    const found = board.elements.find((element) => element.id === elementId)
    if (!found) throw new Error(`No element ${elementId} on the board`)
    return { x: found.x, y: found.y, w: found.w, h: found.h }
  }, id)

describe('dashboard canvas keyboard editing (Electron Chromium, real keys)', () => {
  it('reaches, moves, resizes and deletes a widget with the keyboard alone', async () => {
    await withA11yPage({ browserEntry, discoverDeps: true, optimizeInclude: ['d3-shape', 'use-sync-external-store/shim/with-selector'] }, async (page) => {
      await runInPage(page)

      // 1. The canvas element is REACHABLE by keyboard — it had no tab stop at
      //    all before, so no amount of tabbing could ever land on it. Count the
      //    tab stops ahead of it rather than pressing Tab hundreds of times.
      const reach = await page.evaluate(() => {
        const stops = Array.from(
          document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex="0"]')
        ).filter((element) => element.tabIndex >= 0)
        const index = stops.findIndex((element) => (element.getAttribute('aria-label') ?? '').startsWith('Alpha'))
        return { index, total: stops.length }
      })
      expect(reach.index).toBeGreaterThanOrEqual(0)

      // 2. It is exposed with a name that includes its position and size.
      await page.focus('[aria-label^="Alpha"]')
      const name = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')
      expect(name).toBe('Alpha, x 100, y 100, 120 by 60')

      // Tab from it reaches the sibling widget, so the canvas is a normal part
      // of the focus order rather than a dead end.
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')).toContain('Beta')
      await page.focus('[aria-label^="Alpha"]')

      // 3. Arrow keys MOVE by the grid step (8px default).
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowDown')
      expect(await geometryOf(page, 'alpha')).toMatchObject({ x: 108, y: 108 })

      // 4. Shift+Arrow moves by a single pixel for fine placement.
      await page.keyboard.press('Shift+ArrowLeft')
      expect(await geometryOf(page, 'alpha')).toMatchObject({ x: 107 })

      // 5. Alt+Arrow RESIZES instead of moving.
      const before = await geometryOf(page, 'alpha')
      await page.keyboard.press('Alt+ArrowRight')
      const after = await geometryOf(page, 'alpha')
      expect(after.w).toBe(before.w + 8)
      expect(after.x).toBe(before.x)

      await page.keyboard.press('Alt+ArrowDown')
      expect((await geometryOf(page, 'alpha')).h).toBe(before.h + 8)

      // 6. The focus indicator is actually visible, not `outline: none`.
      const outline = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement
        const style = getComputedStyle(active)
        return { width: style.outlineWidth, style: style.outlineStyle }
      })
      expect(outline.style).not.toBe('none')
      expect(parseFloat(outline.width)).toBeGreaterThan(0)

      // 7. Delete removes the focused widget.
      await page.keyboard.press('Delete')
      const remaining = await page.evaluate(
        () => (window as unknown as { __board: { elements: { id: string }[] } }).__board.elements.map((e) => e.id)
      )
      expect(remaining).toEqual(['beta'])
    })
  }, 240_000)

  it('names every canvas widget in the accessibility tree and hides the pointer-only handles', async () => {
    await withA11yPage({ browserEntry, discoverDeps: true, optimizeInclude: ['d3-shape', 'use-sync-external-store/shim/with-selector'] }, async (page) => {
      await runInPage(page)
      await page.focus('#before-canvas')
      await page.keyboard.press('Tab')

      const tree = await snapshot(page)
      const buttons = flattenTree(tree).filter((node) => !node.ignored && node.role === 'button')
      const names = buttons.map((node) => node.name)
      expect(names).toEqual(expect.arrayContaining([expect.stringContaining('Alpha'), expect.stringContaining('Beta')]))

      // Resize handles are pointer-only affordances duplicated by Alt+Arrow, so
      // they are marked decorative rather than exposed as unnamed controls.
      expect(names.filter((name) => !name.trim())).toEqual([])
      expect(imageNodes(tree).filter((node) => !node.name.trim())).toEqual([])
    })
  }, 240_000)
})
