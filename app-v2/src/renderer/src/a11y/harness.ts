import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { createServer } from 'vite'

/**
 * Real-browser accessibility harness.
 *
 * jsdom does not compute an accessibility tree, so accessible names and focus
 * order cannot be asserted there. This boots the renderer inside the Electron
 * Chromium that ships with the app and hands the test a `page`, so assertions
 * come from `page.accessibility.snapshot()` — the same tree a screen reader
 * consumes — and from real keyboard events.
 *
 * Uses only `playwright`, `electron` and `vite`, all already dependencies.
 */

const ENTRY = '/__a11y-entry.tsx'
const ROUTE = '/__a11y'

export interface A11yNode {
  role: string
  name: string
  value?: string | number
  /** Chromium excludes ignored nodes from what assistive technology consumes. */
  ignored?: boolean
  focused?: boolean
  children?: A11yNode[]
}

/** Depth-first flatten of an accessibility snapshot. */
export function flattenTree(node: A11yNode | null): A11yNode[] {
  if (!node) return []
  const out: A11yNode[] = [node]
  for (const child of node.children ?? []) out.push(...flattenTree(child))
  return out
}

/**
 * Every image-role node that assistive technology will actually reach. Ignored
 * nodes (`aria-hidden`, `display:none`) are excluded because marking a graphic
 * decorative is a legitimate outcome, not a defect.
 */
export function imageNodes(node: A11yNode | null): A11yNode[] {
  return flattenTree(node).filter(
    (entry) => !entry.ignored && (entry.role === 'img' || entry.role === 'image' || entry.role === 'graphics-symbol')
  )
}

export interface HarnessOptions {
  /** Module source evaluated in the page. Must set `window.__a11yApi = { run }`. */
  browserEntry: string
  /** Extra bare imports Vite should pre-bundle instead of discovering lazily. */
  optimizeInclude?: readonly string[]
}

export async function withA11yPage<T>(
  options: HarnessOptions,
  body: (page: Page) => Promise<T>
): Promise<T> {
  const appRoot = fileURLToPath(new URL('../../../../', import.meta.url))
  const server = await createServer({
    root: appRoot,
    configFile: false,
    logLevel: 'silent',
    plugins: [
      react(),
      {
        name: 'a11y-browser-harness',
        resolveId(id: string) {
          return id === ENTRY ? '\0a11y-entry.tsx' : undefined
        },
        load(id: string) {
          return id === '\0a11y-entry.tsx' ? options.browserEntry : undefined
        },
        configureServer(devServer) {
          devServer.middlewares.use(async (request, response, next) => {
            if (request.url !== ROUTE) return next()
            const raw =
              '<!doctype html><html><body><div id="root"></div>' +
              '<script type="module" src="' + ENTRY + '"></script></body></html>'
            response.setHeader('Content-Type', 'text/html')
            response.end(await devServer.transformIndexHtml(request.url, raw))
          })
        }
      }
    ],
    optimizeDeps: {
      noDiscovery: true,
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-dev-runtime',
        'react/jsx-runtime',
        ...(options.optimizeInclude ?? [])
      ]
    },
    server: { host: '127.0.0.1', hmr: false, port: 0, watch: null }
  })

  let electronApp: ElectronApplication | undefined
  let tempDirectory: string | undefined
  try {
    await server.listen()
    const address = server.httpServer?.address()
    if (!address || typeof address === 'string') throw new Error('Vite did not expose a TCP port')

    tempDirectory = await mkdtemp(join(tmpdir(), 'usa-a11y-'))
    const main = join(tempDirectory, 'main.cjs')
    await writeFile(
      main,
      "const { app, BrowserWindow } = require('electron'); app.disableHardwareAcceleration();" +
        ' app.whenReady().then(() => new BrowserWindow({ show: false, width: 1280, height: 900,' +
        ' webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true,' +
        ' backgroundThrottling: false } }).loadURL(process.env.A11Y_URL));'
    )
    const executablePath = createRequire(import.meta.url)('electron') as string
    electronApp = await _electron.launch({
      executablePath,
      args: ['--no-sandbox', main],
      env: { ...process.env, A11Y_URL: 'http://127.0.0.1:' + address.port + ROUTE }
    })

    const page = await electronApp.firstWindow()
    page.on('pageerror', (error) => console.error(error))
    await page.waitForFunction(() =>
      Boolean((window as typeof window & { __a11yApi?: unknown }).__a11yApi)
    )
    return await body(page)
  } finally {
    await electronApp?.close()
    await server.close()
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true })
  }
}

/** Calls `window.__a11yApi.run(arg)` in the page, retrying one destroyed context. */
export async function runInPage<T>(page: Page, arg?: unknown): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return (await page.evaluate(
        (value) =>
          (
            window as typeof window & { __a11yApi: { run(input?: unknown): Promise<unknown> } }
          ).__a11yApi.run(value),
        arg
      )) as T
    } catch (error) {
      if (attempt === 0 && error instanceof Error && /execution context was destroyed/i.test(error.message)) {
        await page.waitForFunction(() =>
          Boolean((window as typeof window & { __a11yApi?: unknown }).__a11yApi)
        )
        continue
      }
      throw error
    }
  }
  throw new Error('The accessibility harness did not return a result.')
}

/**
 * The real Chromium accessibility tree.
 *
 * Playwright removed `page.accessibility` after 1.5x, so this reads the tree
 * straight from the Chrome DevTools Protocol — `Accessibility.getFullAXTree` is
 * the same source Playwright wrapped, and is what assistive technology sees.
 */
export async function snapshot(page: Page): Promise<A11yNode | null> {
  const context = page.context() as unknown as {
    newCDPSession(page: Page): Promise<{
      send(method: string, params?: unknown): Promise<unknown>
      detach(): Promise<void>
    }>
  }
  const session = await context.newCDPSession(page)
  try {
    await session.send('Accessibility.enable')
    const response = (await session.send('Accessibility.getFullAXTree')) as { nodes: RawAxNode[] }
    return buildTree(response.nodes)
  } finally {
    await session.detach()
  }
}

interface RawAxNode {
  nodeId: string
  ignored?: boolean
  role?: { value?: string }
  name?: { value?: string }
  value?: { value?: string | number }
  childIds?: string[]
  properties?: { name: string; value: { value?: unknown } }[]
}

function buildTree(nodes: readonly RawAxNode[]): A11yNode | null {
  if (nodes.length === 0) return null
  const byId = new Map(nodes.map((node) => [node.nodeId, node]))
  const childIds = new Set(nodes.flatMap((node) => node.childIds ?? []))
  const roots = nodes.filter((node) => !childIds.has(node.nodeId))

  const convert = (node: RawAxNode): A11yNode => ({
    role: node.role?.value ?? '',
    name: node.name?.value ?? '',
    value: node.value?.value,
    ignored: node.ignored === true,
    focused: node.properties?.some((p) => p.name === 'focused' && p.value?.value === true) ?? false,
    children: (node.childIds ?? [])
      .map((id) => byId.get(id))
      .filter((child): child is RawAxNode => Boolean(child))
      .map(convert)
  })

  const converted = roots.map(convert)
  if (converted.length === 1) return converted[0]
  return { role: 'RootWebArea', name: '', ignored: false, focused: false, children: converted }
}
