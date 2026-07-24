import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { basename, dirname, resolve } from "node:path"
import { createServer } from "vite"
import {
  CAPTURE_SIZES, CaptureSafetyError, assertCleanGitState, createPrivateStaging,
  discardPrivateStaging, exclusiveWriteFile, listGitWorktrees, parseCaptureArgs,
  prepareCaptureOutput, publishPrivateStaging, readGitState, removePublishedOutput,
  revalidatePublishedOutput, validateCaptureMetrics, validateCapturePixels
} from "./racecon-rc01-capture-lib.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, "..")
const ROOT_SELECTOR = "#racecon-rc01-capture-root"
const STOP_MOTION_CSS = "*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important;scroll-behavior:auto!important}"

function usage() {
  return [
    "Usage: node visual-audit/racecon-rc01-capture.mjs --mode <validate|final> --out <absolute-non-existing-directory>", "",
    "validate permits dirty source; final requires a clean, unchanged Git HEAD.",
    "The target must not exist, must be outside every Git worktree, and is atomically published only after private staging succeeds."
  ].join("\n")
}

function sha256(buffer) { return createHash("sha256").update(buffer).digest("hex") }

async function installCaptureStyle(page) {
  await page.addStyleTag({ content: STOP_MOTION_CSS })
  await page.evaluate(async () => { if (document.fonts) await document.fonts.ready })
}

async function collectMetrics(page, pageErrors, consoleErrors) {
  const metrics = await page.locator(ROOT_SELECTOR).evaluate((root) => {
    const rootRect = root.getBoundingClientRect()
    const relativeRect = (node) => {
      if (!node) return null
      const rect = node.getBoundingClientRect()
      return { left: rect.left - rootRect.left, top: rect.top - rootRect.top, width: rect.width, height: rect.height }
    }
    const measuredRect = (node) => {
      const rect = relativeRect(node)
      return node && rect ? { ...rect, layoutWidth: node.clientWidth, layoutHeight: node.clientHeight } : null
    }
    const transform = (node) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform)
      return { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f }
    }
    const shell = root.querySelector(".dashboard-shell")
    const canvas = root.querySelector(".dashboard-canvas")
    const dashboardElement = root.querySelector(".dash-element.dash-overlaywidget")
    const widget = root.querySelector("[data-widget=\"raceconRc01Dash\"]")
    const dashboard = root.querySelector(".rc01-dashboard")
    const rail = root.querySelector(".rc01-attack-rail")
    const status = root.querySelector(".rc01-status")
    const statusToggle = root.querySelector(".rc01-status-toggle")
    const appRail = rail ? { ...relativeRect(rail), display: getComputedStyle(rail).display } : null
    const leds = Array.from(root.querySelectorAll("[data-testid=\"rc01-led\"]")).map((led) => {
      const rect = relativeRect(led)
      return { ...rect, tone: led.getAttribute("data-tone"), active: led.classList.contains("is-active"), color: getComputedStyle(led).backgroundColor }
    })
    const dataset = root.dataset
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
      root: relativeRect(root), shell: measuredRect(shell),
      canvas: { ...measuredRect(canvas), transform: transform(canvas) },
      dashboardElement: measuredRect(dashboardElement), widget: measuredRect(widget),
      presetId: dataset.capturePresetId, expectedWidgetId: dataset.captureWidgetId,
      renderedWidgetId: widget?.getAttribute("data-widget") ?? null,
      dashboardWidth: dataset.captureDashboardWidth, dashboardHeight: dataset.captureDashboardHeight,
      sourceKind: dataset.captureSourceKind, sourceIdentity: dataset.captureSourceIdentity,
      bufferState: widget?.getAttribute("data-rc01-buffer-state") ?? null,
      layout: widget?.getAttribute("data-rc01-layout") ?? null,
      compactMode: widget?.getAttribute("data-rc01-compact-mode") ?? null,
      contentWidth: widget?.getAttribute("data-rc01-content-width") ?? null,
      contentHeight: widget?.getAttribute("data-rc01-content-height") ?? null,
      nativeSize: dashboard?.getAttribute("data-rc01-native-size") ?? null,
      appRail,
      status: relativeRect(status),
      statusToggle: statusToggle ? {
        ...relativeRect(statusToggle),
        display: getComputedStyle(statusToggle).display,
        ariaLabel: statusToggle.getAttribute("aria-label"),
        beforeContent: getComputedStyle(statusToggle, "::before").content,
        afterContent: getComputedStyle(statusToggle, "::after").content
      } : null,
      statusMetrics: Array.from(root.querySelectorAll(".rc01-status-grid .rc01-metric")).map((metric) => {
        const value = metric.querySelector(".rc01-value")
        return {
          label: metric.querySelector("dt")?.textContent?.trim() ?? "",
          text: value?.textContent?.trim() ?? "",
          rect: relativeRect(metric),
          valueRect: relativeRect(value)
        }
      }),
      leds,
      textOutputs: Array.from(root.querySelectorAll("output")).map((output) => output.textContent?.trim() ?? ""),
      rootText: root.textContent ?? "",
      errorBoundaryCount: root.querySelectorAll("[data-va-failed]").length,
      unknownWidgetCount: root.querySelectorAll("[data-dashboard-unknown-widget]").length,
      failures: window.__vaFailures ?? []
    }
  })
  return { ...metrics, pageErrors, consoleErrors }
}

async function captureSize(browser, baseUrl, size, mode, finalHead) {
  if (mode === "final") assertCleanGitState(readGitState(appRoot), finalHead)
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, reducedMotion: "reduce", colorScheme: "dark" })
  const page = await context.newPage()
  const pageErrors = []
  const consoleErrors = []
  page.on("pageerror", (error) => pageErrors.push(error.message))
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()) })
  try {
    await page.addInitScript((style) => {
      const addStyle = () => {
        const element = document.createElement("style")
        element.setAttribute("data-racecon-capture-motion", "true")
        element.textContent = style
        document.head.appendChild(element)
      }
      if (document.head) addStyle()
      else document.addEventListener("DOMContentLoaded", addStyle, { once: true })
    }, STOP_MOTION_CSS)
    const target = new URL("racecon-rc01-capture.html", baseUrl)
    target.searchParams.set("width", String(size.width))
    target.searchParams.set("height", String(size.height))
    await page.goto(target.href, { waitUntil: "networkidle", timeout: 90_000 })
    await page.locator(ROOT_SELECTOR).waitFor({ state: "visible", timeout: 45_000 })
    await page.waitForFunction(({ selector, expectedLayout }) => {
      const root = document.querySelector(selector)
      const widget = root?.querySelector("[data-widget=\"raceconRc01Dash\"]")
      return root?.getAttribute("data-capture-ready") === "true" &&
        widget?.getAttribute("data-rc01-buffer-state") === "accepted" &&
        widget?.getAttribute("data-rc01-layout") === expectedLayout
    }, {
      selector: ROOT_SELECTOR,
      expectedLayout: size.width === 800 ? "native" : size.width === 1024 ? "app" : "compact"
    }, { timeout: 45_000 })
    await installCaptureStyle(page)
    const metrics = await collectMetrics(page, pageErrors, consoleErrors)
    validateCaptureMetrics(metrics, size)
    const png = await page.locator(ROOT_SELECTOR).screenshot({ type: "png", animations: "disabled", caret: "hide" })
    const pixelAudit = validateCapturePixels(png, size)
    if (mode === "final") assertCleanGitState(readGitState(appRoot), finalHead)
    return { metrics, pixelAudit, png }
  } finally { await context.close() }
}

async function main() {
  const options = parseCaptureArgs(process.argv.slice(2))
  if (options.help) { console.log(usage()); return }
  const output = prepareCaptureOutput(options.outputDirectory, listGitWorktrees(appRoot))
  const initialGit = readGitState(appRoot)
  const finalHead = options.mode === "final" ? assertCleanGitState(initialGit) : initialGit.head
  const staging = createPrivateStaging(output)
  const server = await createServer({ configFile: resolve(here, "vite.config.ts"), logLevel: "warn", server: { host: "127.0.0.1", port: 0, strictPort: false } })
  let browser
  let publication
  let succeeded = false
  const report = { presetId: "racecon_rc01_dash", mode: options.mode, generatedAt: new Date().toISOString(), git: { before: initialGit, requiredHead: finalHead }, captures: [] }
  try {
    await server.listen()
    const baseUrl = server.resolvedUrls?.local?.[0]
    if (!baseUrl) throw new Error("visual-audit Vite server did not report a local URL")
    const { chromium } = await import("playwright")
    try { browser = await chromium.launch({ headless: true }) } catch (error) {
      throw new Error(`Chromium launch failed without installing a browser: ${error instanceof Error ? error.message : String(error)}`)
    }
    for (const size of CAPTURE_SIZES) {
      const { metrics, pixelAudit, png } = await captureSize(browser, baseUrl, size, options.mode, finalHead)
      const filePath = exclusiveWriteFile(staging, `racecon_rc01_dash-${size.width}x${size.height}.png`, png)
      report.captures.push({ size, file: basename(filePath), sha256: sha256(png), bytes: png.length, pixelAudit, metrics })
      if (options.mode === "final") assertCleanGitState(readGitState(appRoot), finalHead)
    }
    report.git.beforePublication = readGitState(appRoot)
    if (options.mode === "final") assertCleanGitState(report.git.beforePublication, finalHead)
    exclusiveWriteFile(staging, "racecon_rc01_dash-capture.json", Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8"))
    // This check is intentionally after every file and the manifest are written.
    if (options.mode === "final") assertCleanGitState(readGitState(appRoot), finalHead)
    publication = publishPrivateStaging(staging)
    try {
      if (options.mode === "final") assertCleanGitState(readGitState(appRoot), finalHead)
      revalidatePublishedOutput(publication)
    } catch (error) {
      try { removePublishedOutput(publication) } catch {}
      publication = undefined
      throw error
    }
    succeeded = true
    console.log(`RaceCon RC-01 ${options.mode} capture complete`)
    for (const capture of report.captures) console.log(`  ${capture.file}  sha256=${capture.sha256}`)
    console.log(`  ${publication.canonical}`)
  } finally {
    if (browser) await browser.close()
    await server.close()
    if (!succeeded) {
      try { if (publication) removePublishedOutput(publication); else discardPrivateStaging(staging) } catch {}
    }
  }
}

main().catch((error) => {
  const prefix = error instanceof CaptureSafetyError ? "[racecon-capture safety]" : "[racecon-capture]"
  console.error(prefix, error instanceof Error ? error.message : error)
  process.exitCode = 1
})
