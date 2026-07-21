import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { _electron } from 'playwright'
import { describe, expect, it } from 'vitest'
import { createServer } from 'vite'

const ENTRY = '/__inert-preview-entry.tsx'
const browserEntry = String.raw`
const listeners = new Map()
let activity = []
const ipc = {
  invoke(channel) { activity.push({ kind: 'invoke', channel }); return Promise.resolve(null) },
  subscribe(channel, callback) {
    activity.push({ kind: 'subscribe', channel })
    const entries = listeners.get(channel) || new Set()
    entries.add(callback); listeners.set(channel, entries)
    return () => { entries.delete(callback); if (entries.size === 0) listeners.delete(channel) }
  }
}
Object.defineProperty(window, 'ipc', { configurable: true, value: ipc })
Object.defineProperty(window, 'IntersectionObserver', { configurable: true, value: undefined })

async function settle(frames = 3) {
  for (let index = 0; index < frames; index += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}
async function waitFor(predicate, label) {
  for (let index = 0; index < 120; index += 1) { if (predicate()) return; await settle(1) }
  throw new Error('Timed out waiting for ' + label)
}
function emit(channel, payload) { for (const callback of listeners.get(channel) || []) callback(payload) }
function listenerSnapshot() { return Object.fromEntries(Array.from(listeners, ([channel, set]) => [channel, set.size])) }
function inputValue(input, value) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function run() {
  const [React, ReactDom, catalogUi, presetUi, catalogData, dashboardUi, theme, hifiHost, registry, units, binding] = await Promise.all([
    import('react'), import('react-dom/client'),
    import('/src/renderer/src/views/dashboard/widget-catalog.tsx'),
    import('/src/renderer/src/views/dashboard/preset-gallery.tsx'),
    import('/src/renderer/src/views/dashboard/widget-catalog-data.ts'),
    import('/src/renderer/src/dashboard/DashboardRoot.tsx'),
    import('/src/renderer/src/dashboard/widgets/gt3-theme.ts'),
    import('/src/renderer/src/overlay/widgets/HifiWidgetHost.tsx'),
    import('/src/renderer/src/hifi/widgets/registry.ts'),
    import('/src/renderer/src/lib/units.tsx'),
    import('/src/renderer/src/dashboard/binding.ts')
  ])
  const { createElement: h, Fragment } = React
  const { createRoot } = ReactDom
  const { WidgetGallery } = catalogUi
  const { PresetGallery } = presetUi
  const { ALL_VARIANTS, variantToElement } = catalogData
  const { renderDashboardElement } = dashboardUi
  const { PREVIEW_SNAPSHOT } = theme
  const { PREVIEW_COACH_REPORT } = hifiHost
  const { HIFI_WIDGETS } = registry
  const { UnitSystemProvider } = units
  const { retainBindingIpc } = binding
  const importActivity = activity.slice()
  const host = document.getElementById('root')
  const root = createRoot(host)
  const framework = HIFI_WIDGETS.filter((module) => module.tags.includes('telemetry-framework'))
  const frameworkIds = framework.map((module) => 'hifi-' + module.id)
  const catalogById = new Map(ALL_VARIANTS.map((variant) => [variant.id, variant]))
  function elementFor(id, x = 0) {
    const variant = catalogById.get(id)
    if (!variant) throw new Error('Missing catalog variant ' + id)
    return { ...variantToElement(variant, x, 0), id: 'test-' + id }
  }
  function liveWidgets(snapshot) {
    const elements = [elementFor('hifi-coachTip'), elementFor('hifi-engineerRadio', 320), elementFor('hifi-speed', 640)]
    return h(Fragment, null, ...elements.map((element) => h(Fragment, { key: element.id }, renderDashboardElement({ element, snapshot }))))
  }
  const lastModule = framework.at(-1)
  const lastCatalogId = 'hifi-' + lastModule.id
  const catalogFrameworkIds = ALL_VARIANTS.filter((variant) => variant.tags?.includes('telemetry-framework')).map((variant) => variant.id)
  const oneToOne = catalogFrameworkIds.length === frameworkIds.length && new Set(catalogFrameworkIds).size === catalogFrameworkIds.length && frameworkIds.every((id) => catalogById.has(id))
  activity = []
  const added = []
  root.render(h(WidgetGallery, { onAdd: (variant) => added.push(variant.id) }))
  await waitFor(() => host.querySelectorAll('[data-widget-preview="true"]').length >= 423, 'full widget gallery')
  const semantic = Object.fromEntries(Array.from(host.querySelectorAll('[data-preview-semantic]'), (node) => [node.dataset.previewSemantic, node.textContent]))
  window.scrollTo(0, document.body.scrollHeight); await settle()
  const search = host.querySelector('input[aria-label="Search widget"]')
  inputValue(search, lastCatalogId)
  await waitFor(() => Array.from(host.querySelectorAll('button')).some((button) => button.textContent === 'Add'), 'last generated variant search')
  Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Add').click()
  inputValue(search, '')
  await waitFor(() => host.querySelectorAll('[data-widget-preview="true"]').length >= 423, 'gallery reopen after filter')
  const inertBefore = host.textContent
  emit('coach:report', { report: { ...PREVIEW_COACH_REPORT, summary: 'MUTATED COACH' }, setup: null })
  emit('engineer:answer', { id: 'mutate-answer', at: 1, question: 'Q', text: 'MUTATED ENGINEER' })
  emit('engineer:proactive', { id: 'mutate-proactive', at: 2, sector: 1, severity: 'high', text: 'MUTATED PROACTIVE' })
  emit('telemetry:snapshot', { ...PREVIEW_SNAPSHOT, speedKmh: 9 }); await settle()
  const inertStable = inertBefore === host.textContent
  for (let cycle = 0; cycle < 10; cycle += 1) {
    root.render(null); await settle()
    root.render(h(WidgetGallery, { onAdd: () => {} }))
    await waitFor(() => host.querySelectorAll('[data-widget-preview="true"]').length >= 423, 'gallery reopen cycle ' + cycle)
  }
  root.render(null); await settle()

  activity = []
  root.render(h(WidgetGallery, { onAdd: () => {}, showTriggerOnlyActive: true }))
  await waitFor(() => host.querySelectorAll('[data-widget-preview="true"]').length >= 423, 'forced-active widget gallery')
  const forcedSearch = host.querySelector('input[aria-label="Search widget"]')
  inputValue(forcedSearch, 'hifi-alert2WaterTempCritical')
  await waitFor(() => host.textContent.includes('WATER'), 'forced-active alert widget')
  const forcedGalleryVisible = host.textContent.includes('WATER')
  const forcedGalleryActivity = activity.slice()
  root.render(null); await settle()

  root.render(h(UnitSystemProvider, { initialUnitSystem: 'imperial' }, renderDashboardElement({ element: elementFor('hifi-speed'), snapshot: PREVIEW_SNAPSHOT, preview: 'inert' })))
  await waitFor(() => /147/.test(host.textContent) && /mph/i.test(host.textContent), 'imperial inert hi-fi preview')
  const imperial = host.textContent
  root.render(null); await settle()

  const effectful = ALL_VARIANTS.filter((variant) => variant.type === 'map' || variant.type === 'engineer-feed' ||
    variant.type.startsWith('coach-') || variant.type.startsWith('pred-') || variant.type.startsWith('trackmap-') ||
    ['coachHeatmap', 'coachTips', 'coachFindings', 'coachSectorGraph', 'engineerFeed', 'trackMap', 'trackMapNav3D', 'customValue', 'teamFuel', 'tireWear', 'predCatchAhead'].includes(variant.widgetId || '') ||
    ['hifi-coachTip', 'hifi-engineerRadio', lastCatalogId].includes(variant.id))
  const dashboard = { id: 'preview-test', name: 'Preview test', width: 1200, height: 800, bg: '#05070a', elements: effectful.map((variant, index) => ({ ...variantToElement(variant, (index % 6) * 190, Math.floor(index / 6) * 130), id: 'preset-' + index })) }
  const presets = [{ id: 'preview-a', name: 'Preview A', tags: ['GT3'], build: () => dashboard }, { id: 'preview-b', name: 'Preview B', tags: ['Endurance'], build: () => dashboard }]
  root.render(h(PresetGallery, { presets, onPick: () => {} }))
  await waitFor(() => host.querySelectorAll('[data-dashboard-inert-preview]').length > 0, 'preset thumbnails')
  window.scrollTo(0, document.body.scrollHeight); await settle()
  const gt3 = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.startsWith('GT3 '))
  gt3?.click(); await settle(); gt3?.click(); await settle()
  const presetBefore = host.textContent
  emit('coach:report', { report: PREVIEW_COACH_REPORT, setup: null })
  emit('engineer:answer', { id: 'preset-answer', at: 3, question: 'Q', text: 'MUTATED PRESET' })
  emit('telemetry:snapshot', { ...PREVIEW_SNAPSHOT, speedKmh: 8 }); await settle()
  const presetStable = presetBefore === host.textContent
  for (let cycle = 0; cycle < 10; cycle += 1) {
    root.render(null); await settle()
    root.render(h(PresetGallery, { presets, onPick: () => {} }))
    await waitFor(() => host.querySelectorAll('[data-dashboard-inert-preview]').length > 0, 'preset gallery reopen cycle ' + cycle)
  }
  root.render(null); await settle()
  const inertActivity = activity.slice()
  const inertListeners = listenerSnapshot()

  activity = []
  const forcedPresetDashboard = {
    id: 'forced-alert-preview',
    name: 'Forced alert preview',
    width: 400,
    height: 220,
    bg: '#05070a',
    elements: [{ ...elementFor('hifi-alert2WaterTempCritical'), w: 360, h: 190 }]
  }
  root.render(h(PresetGallery, {
    presets: [{ id: 'forced-alert', name: 'Forced alert', tags: ['GT3'], build: () => forcedPresetDashboard }],
    onPick: () => {},
    showTriggerOnlyActive: true
  }))
  await waitFor(() => host.textContent.includes('WATER'), 'forced-active preset alert')
  const forcedPresetVisible = host.textContent.includes('WATER')
  const forcedPresetActivity = activity.slice()
  root.render(null); await settle()

  activity = []
  const releaseBindingIpc = retainBindingIpc()
  root.render(liveWidgets({ ...PREVIEW_SNAPSHOT, speedKmh: 111 }))
  await waitFor(() => (listeners.get('coach:report')?.size || 0) === 3, 'live subscriptions')
  const liveBindingChannels = activity.filter((entry) => entry.channel.startsWith('outputs:') || entry.channel.startsWith('expr:')).map((entry) => entry.kind + ':' + entry.channel)
  emit('coach:report', { report: { ...PREVIEW_COACH_REPORT, findings: [{ ...PREVIEW_COACH_REPORT.findings[0], title: 'LIVE COACH', detail: 'LIVE COACH' }] }, setup: null })
  emit('engineer:answer', { id: 'live-answer', at: 10, question: 'Status?', text: 'LIVE RADIO' })
  await waitFor(() => host.textContent.includes('LIVE COACH') && host.textContent.includes('LIVE RADIO'), 'live AI updates')
  const speedBefore = host.textContent
  root.render(liveWidgets({ ...PREVIEW_SNAPSHOT, speedKmh: 222 }))
  await waitFor(() => host.textContent.includes('222'), 'live telemetry prop update')
  const telemetryUpdated = speedBefore !== host.textContent
  root.render(null); await settle()
  releaseBindingIpc(); await settle()

  const baseline = JSON.stringify(listenerSnapshot())
  const restored = []
  for (let cycle = 0; cycle < 10; cycle += 1) {
    root.render(renderDashboardElement({ element: elementFor('hifi-coachTip'), snapshot: PREVIEW_SNAPSHOT }))
    await waitFor(() => (listeners.get('coach:report')?.size || 0) === 1, 'cycle subscription')
    root.render(null); await settle(); restored.push(JSON.stringify(listenerSnapshot()) === baseline)
  }
  return { frameworkCount: framework.length, catalogFrameworkCount: catalogFrameworkIds.length, oneToOne, lastCatalogId, added, importActivity, inertStable: inertStable && presetStable, inertActivity, inertListeners, forcedGalleryVisible, forcedGalleryActivity, forcedPresetVisible, forcedPresetActivity, imperial, semantic, liveBindingChannels, telemetryUpdated, restored }
}
window.__inertPreviewApi = { run }
`

describe('inert gallery previews (Electron Chromium)', () => {
  it('stay at zero IPC while live widgets retain updates and cleanup', async () => {
    const appRoot = fileURLToPath(new URL('../../../../../', import.meta.url))
    const server = await createServer({ root: appRoot, configFile: false, logLevel: 'silent', plugins: [react(), {
      name: 'inert-preview-browser-harness',
      resolveId(id) { return id === ENTRY ? '\0inert-preview-entry.tsx' : undefined },
      load(id) { return id === '\0inert-preview-entry.tsx' ? browserEntry : undefined },
      configureServer(devServer) {
        devServer.middlewares.use(async (request, response, next) => {
          if (request.url !== '/__inert-preview') return next()
          const raw = '<!doctype html><html><body><div id="root"></div><script type="module" src="' + ENTRY + '"></script></body></html>'
          response.setHeader('Content-Type', 'text/html'); response.end(await devServer.transformIndexHtml(request.url, raw))
        })
      }
    }],
    optimizeDeps: {
      // Keep dependency discovery and concurrent test churn from reloading Electron during evaluation.
      noDiscovery: true,
      include: [
        '@react-three/fiber',
        'd3-shape',
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-dev-runtime',
        'react/jsx-runtime',
        'three',
        'three/examples/jsm/controls/OrbitControls.js'
      ]
    },
    server: { host: '127.0.0.1', hmr: false, port: 0, watch: null }
  })
    let electronApp
    let tempDirectory
    try {
      await server.listen()
      const address = server.httpServer?.address()
      if (!address || typeof address === 'string') throw new Error('Vite did not expose a TCP port')
      tempDirectory = await mkdtemp(join(tmpdir(), 'usa-inert-preview-'))
      const main = join(tempDirectory, 'main.cjs')
      await writeFile(main, "const { app, BrowserWindow } = require('electron'); app.disableHardwareAcceleration(); app.whenReady().then(() => new BrowserWindow({ show: false, width: 1280, height: 720, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } }).loadURL(process.env.INERT_PREVIEW_URL));")
      const executablePath = createRequire(import.meta.url)('electron') as string
      electronApp = await _electron.launch({ executablePath, args: ['--no-sandbox', main], env: { ...process.env, INERT_PREVIEW_URL: 'http://127.0.0.1:' + address.port + '/__inert-preview' } })
      const page = await electronApp.firstWindow()
      page.on('pageerror', (error) => console.error(error))
      await page.waitForFunction(() => Boolean((window as typeof window & { __inertPreviewApi?: unknown }).__inertPreviewApi))
      const result = await page.evaluate(() => (window as typeof window & { __inertPreviewApi: { run(): Promise<any> } }).__inertPreviewApi.run())
      expect(result.frameworkCount).toBe(423)
      expect(result.catalogFrameworkCount).toBe(423)
      expect(result.oneToOne).toBe(true)
      expect(result.added).toEqual([result.lastCatalogId])
      expect(result.importActivity).toEqual([])
      expect(result.inertActivity).toEqual([])
      expect(result.inertListeners).toEqual({})
      expect(result.inertStable).toBe(true)
      expect(result.forcedGalleryVisible).toBe(true)
      expect(result.forcedGalleryActivity).toEqual([])
      expect(result.forcedPresetVisible).toBe(true)
      expect(result.forcedPresetActivity).toEqual([])
      expect(result.imperial).toMatch(/147.*mph/i)
      expect(result.semantic['fuel-margin']).toContain('-2.1 LAPS')
      expect(result.semantic['tyre-wear']).toContain('78% LIFE')
      expect(result.semantic['catch-ahead']).toContain('NO CATCH')
      expect(result.semantic['caught-behind']).toContain('2.4 LAPS')
      expect(result.semantic.pace).toContain('-0.291 s')
      expect(result.liveBindingChannels).toEqual(expect.arrayContaining(['subscribe:outputs:value', 'subscribe:expr:results', 'invoke:outputs:getValues', 'invoke:expr:getResults']))
      expect(result.telemetryUpdated).toBe(true)
      expect(result.restored).toEqual(Array(10).fill(true))
    } finally {
      await electronApp?.close()
      await server.close()
      if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true })
    }
  }, 180_000)
})
