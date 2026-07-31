import { describe, expect, it } from 'vitest'
import { imageNodes, runInPage, snapshot, withA11yPage, type A11yNode } from './harness'

/**
 * WCAG 2.2 AA, 1.1.1 Non-text Content.
 *
 * `role="img"` makes an element a leaf in the accessibility tree: everything
 * inside it — including the SVG `<text>` that carries a widget's numbers — is
 * pruned. An image role without an accessible name is therefore not "partly
 * readable", it is completely silent to a screen reader.
 *
 * This asserts against the real Chromium accessibility tree, not the DOM, so it
 * measures the computed accessible name exactly as assistive technology would.
 */

const browserEntry = String.raw`
const listeners = new Map()
const ipc = {
  invoke() { return Promise.resolve(null) },
  subscribe(channel, callback) {
    const entries = listeners.get(channel) || new Set()
    entries.add(callback); listeners.set(channel, entries)
    return () => entries.delete(callback)
  }
}
Object.defineProperty(window, 'ipc', { configurable: true, value: ipc })

async function run() {
  const [React, ReactDom, registry, units, overlays, theme, defaults] = await Promise.all([
    import('react'),
    import('react-dom/client'),
    import('/src/renderer/src/hifi/widgets/registry.ts'),
    import('/src/renderer/src/lib/units.tsx'),
    import('/src/renderer/src/overlay/widgets/index.ts'),
    import('/src/renderer/src/dashboard/widgets/gt3-theme.ts'),
    import('/src/shared/overlays.ts')
  ])
  const { createElement: h, Fragment, Component } = React
  const { createRoot } = ReactDom
  const snapshotValue = theme.PREVIEW_SNAPSHOT
  const modules = registry.HIFI_WIDGETS

  const mount = document.getElementById('root')
  const root = createRoot(mount)

  const failures = []
  // One broken widget must not take down the probe, so isolate every subject.
  class Isolate extends Component {
    constructor(props) { super(props); this.state = { failed: false } }
    static getDerivedStateFromError() { return { failed: true } }
    componentDidCatch(error) { failures.push(this.props.subject + ': ' + (error && error.message)) }
    render() { return this.state.failed ? null : this.props.children }
  }

  const safe = (key, factory) => {
    let child = null
    try { child = factory() }
    catch (error) { failures.push(key + ': ' + (error && error.message)); return null }
    return h('div', { key, 'data-a11y-probe': key, style: { width: 320, height: 220 } },
      h(Isolate, { subject: key }, child))
  }

  // Render every hi-fi widget module directly, plus every registered overlay
  // widget, so the snapshot covers the whole image-role surface at once.
  const hifi = modules.map((mod) =>
    safe('hifi-' + mod.id, () => mod.render({
      snapshot: snapshotValue,
      width: mod.defaultSize.w,
      height: mod.defaultSize.h,
      unitSystem: 'metric'
    }))
  ).filter(Boolean)

  const baseConfig = {
    id: 'a11y-probe', widgetId: 'probe', enabled: true,
    position: { x: 0, y: 0, width: 320, height: 220 },
    style: { accent: '#e0b64a', background: 'transparent', fontFamily: 'sans-serif' }
  }
  const overlayNodes = Object.entries(overlays.WIDGET_COMPONENTS).map(([id, Component]) =>
    safe('ov-' + id, () => h(Component, {
      snapshot: snapshotValue,
      config: { ...baseConfig, widgetId: id }
    }))
  ).filter(Boolean)

  root.render(h(units.UnitSystemProvider, null, h(Fragment, null, ...hifi, ...overlayNodes)))
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 16))

  // Report the DOM-side inventory too, so a failure names the offending widgets.
  const domImages = Array.from(document.querySelectorAll('[role="img"]')).map((el) => {
    const owner = el.closest('[data-a11y-probe]')
    return {
      name: el.getAttribute('aria-label') || '',
      hidden: el.closest('[aria-hidden="true"]') !== null,
      widget: (owner && owner.getAttribute('data-a11y-probe')) || el.getAttribute('data-widget') || ''
    }
  })
  return { moduleCount: modules.length, overlayCount: overlayNodes.length, failures, domImages }
}
window.__a11yApi = { run }
`

interface RunResult {
  moduleCount: number
  overlayCount: number
  failures: string[]
  domImages: { name: string; hidden: boolean; widget: string }[]
}

describe('accessible names (Electron Chromium accessibility tree)', () => {
  it('exposes no image-role node without an accessible name', async () => {
    const { result, images } = await withA11yPage(
      { browserEntry, cacheKey: 'a11y-accessible-names', optimizeInclude: ['d3-shape', 'three', '@react-three/fiber'] },
      async (page) => {
        const value = await runInPage<RunResult>(page)
        const tree = await snapshot(page)
        return { result: value, images: imageNodes(tree) }
      }
    )

    expect(result.moduleCount).toBeGreaterThan(100)
    expect(
      images.length,
      `Harness rendered ${result.moduleCount} hi-fi modules and ${result.overlayCount} overlay widgets; ` +
        `DOM reported ${result.domImages.length} role="img" elements. ` +
        `First render failures: ${result.failures.slice(0, 5).join(' | ')}`
    ).toBeGreaterThan(50)
    const unnamed = images.filter((node: A11yNode) => !node.name || node.name.trim() === '')
    const domUnnamed = result.domImages.filter((entry) => !entry.hidden && !entry.name.trim())

    expect(
      unnamed.length,
      `${unnamed.length} image-role node(s) reach the accessibility tree with no name.\n` +
        `DOM-side unnamed role="img" elements: ${domUnnamed.length}\n` +
        `${domUnnamed.slice(0, 40).map((entry) => `  ${entry.widget || '<unidentified>'}`).join('\n')}`
    ).toBe(0)
  }, 240_000)
})
