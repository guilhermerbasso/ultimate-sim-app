import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reportCaptureFailure, runRaceconCapture } from "./racecon-capture-shared.mjs"
import {
  RC13_CAPTURE_MATRIX,
  RC13_SPEC,
  validateCaptureMetrics,
  validateCapturePixels
} from "./racecon-rc13-capture-lib.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, "..")

/**
 * Only the RC-13 DOM contract lives here. The viewport matrix, the readiness gate, the shared
 * metric contract, the geometry helpers and the entire capture lifecycle come from
 * `racecon-capture-shared.mjs`.
 *
 * RC-13 "Hold Order" specific measurements collected inside the browser context:
 *
 *  - `barRect` / `windowZoneMeasured` — the window bar and the three zone spans measured with
 *    getBoundingClientRect, relative to the capture root. Used in assertWindowBarGeometry to
 *    verify the 0/34/66/100 fraction arithmetic and the word-centre declarations.
 *  - `statusHeaderRect` — the status header panel rect, for the amber density proof in the
 *    silent state (chip absent; only the 2px signature border-bottom is amber there).
 *  - `alertChipRects` — the rect of `[data-testid="rc13-alert-restartImminent"]`, empty in the
 *    silent state. Used as the amber density scope in the restart-imminent pixel audit.
 *  - `restartStatusRect` — the `rc13-restart-status` <output> rect, for reporting whether the
 *    "RESTART IMMINENT" text escapes the status header in the compact-phone known-defect viewports.
 *  - Several attribute and text values needed by the omission assertions: `windowMarkerAttr`,
 *    `windowZoneActiveAttrs`, `windowNoticeText`, `restartZoneText`, `restartZoneNoticeText`,
 *    `restartZoneAvailable`, `trainRowsAttr`, `trainAvailable`, `trainNoticeText`.
 *  - `nativeSize` from `data-rc13-native-size` on `.rc13-dashboard`.
 */
async function collectMetrics(page, spec, entry) {
  return page.locator(spec.rootSelector).evaluate(
    (root, input) => {
      const helpers = window.__rcMeasure(root)
      const common = window.__rcCommon(root, input.spec, helpers)
      const { relativeRect } = helpers

      // ── Native size modifier ──────────────────────────────────────────────────────────────
      const nativeSize = root.querySelector(".rc13-dashboard")?.getAttribute("data-rc13-native-size") ?? null

      // ── Window bar geometry (normative override N3 arithmetic proof) ──────────────────────
      //
      // The bar itself is measured for its left and width. The three zone spans are measured
      // individually and their getBoundingClientRect fractions are checked against the declared
      // from/to values with a tolerance derived from the 1px CSS border.
      //
      // Each zone entry carries: id, from, to, activeAttr, word text, centre attribute, rect.
      const barEl = root.querySelector('[data-testid="rc13-window-bar"]')
      const barRect = relativeRect(barEl)

      const windowMarkerAttr = barEl ? barEl.getAttribute("data-rc13-window-marker") : null

      const windowZoneNodes = Array.from(root.querySelectorAll('[data-testid="rc13-window-zone"]'))
      const windowZoneActiveAttrs = windowZoneNodes.map((n) => n.getAttribute("data-rc13-window-zone-active"))

      const windowZoneMeasured = windowZoneNodes.map((node) => {
        // The word span is a direct child of the zone span.
        const wordEl = node.querySelector('[data-testid="rc13-window-zone-word"]')
        return {
          id: node.getAttribute("data-rc13-window-zone-id") ?? null,
          from: Number(node.getAttribute("data-rc13-window-zone-from") ?? "NaN"),
          to: Number(node.getAttribute("data-rc13-window-zone-to") ?? "NaN"),
          activeAttr: node.getAttribute("data-rc13-window-zone-active") ?? null,
          word: wordEl ? (wordEl.textContent ?? "").trim() : null,
          centre: wordEl ? Number(wordEl.getAttribute("data-rc13-window-zone-centre") ?? "NaN") : NaN,
          rect: relativeRect(node)
        }
      })

      const windowNoticeEl = root.querySelector('[data-testid="rc13-window-notice"]')
      const windowNoticeText = windowNoticeEl ? (windowNoticeEl.textContent ?? "").trim() : null

      // ── Restart-zone omission proof ───────────────────────────────────────────────────────
      const restartZoneEl = root.querySelector('[data-testid="rc13-restart-zone"]')
      const restartZoneText = restartZoneEl ? (restartZoneEl.textContent ?? "").trim() : null

      const restartZoneNoticeEl = root.querySelector('[data-testid="rc13-restart-zone-notice"]')
      const restartZoneNoticeText = restartZoneNoticeEl ? (restartZoneNoticeEl.textContent ?? "").trim() : null

      const restartZoneRowEl = root.querySelector('[data-testid="rc13-restart-zone-row"]')
      const restartZoneAvailable = restartZoneRowEl
        ? restartZoneRowEl.getAttribute("data-rc13-restart-zone-available")
        : null

      // ── Queue-train omission proof (app-only) ─────────────────────────────────────────────
      const trainEl = root.querySelector('[data-testid="rc13-train"]')
      const trainRowsAttr = trainEl ? trainEl.getAttribute("data-rc13-train-rows") : null
      const trainAvailable = trainEl ? trainEl.getAttribute("data-rc13-train-available") : null

      const trainNoticeEl = root.querySelector('[data-testid="rc13-train-notice"]')
      const trainNoticeText = trainNoticeEl ? (trainNoticeEl.textContent ?? "").trim() : null

      // ── Alert scope rectangles for the pixel amber density proof ─────────────────────────
      //
      // In the restart-imminent state the chip [data-testid="rc13-alert-restartImminent"] is
      // present and carries the caution (#FFC400) colour (text + border, no background fill).
      // In the silent state the chip is absent, and the amber density is measured inside the
      // status header instead (only the 2px signature border-bottom is amber there).
      const alertChipEl = root.querySelector('[data-testid="rc13-alert-restartImminent"]')
      const alertChipRects = alertChipEl ? [relativeRect(alertChipEl)].filter(Boolean) : []

      const statusHeaderEl = root.querySelector('[data-testid="rc13-panel-status"]')
      const statusHeaderRect = relativeRect(statusHeaderEl)

      // ── Restart-status text-escape geometry (DEFECT RC-13/1 measurement) ─────────────────
      //
      // "RESTART IMMINENT" overflows the <output> box at compact-phone viewports by +3 px
      // (scrollWidth − clientWidth). The getBoundingClientRect comparison below measures whether
      // the PAINTED text also escapes the status header rect, which is reported in the audit.
      //
      // Also collects text, font-size and text-range top (for DEFECT RC-13/2 glyph ascent check).
      const restartStatusEl = root.querySelector('[data-testid="rc13-restart-status"]')
      const restartStatusRect = relativeRect(restartStatusEl)
      const restartStatusText = restartStatusEl ? (restartStatusEl.textContent ?? "").trim() : null
      const restartStatusFontSize = restartStatusEl
        ? Number.parseFloat(getComputedStyle(restartStatusEl).fontSize) || null
        : null
      // DEFECT RC-13/2: glyph ascenders extend above root top at 1024x600.
      // selectNodeContents reports glyph bounds; at app layout (status zone y=0) these go negative.
      const restartStatusTextRngTop = (() => {
        if (!restartStatusEl) return null
        const range = document.createRange()
        range.selectNodeContents(restartStatusEl)
        const r = range.getBoundingClientRect()
        const rootR = root.getBoundingClientRect()
        return +(r.top - rootR.top).toFixed(3)
      })()

      return {
        ...common,
        nativeSize,
        barRect,
        windowZoneMeasured,
        windowMarkerAttr,
        windowZoneActiveAttrs,
        windowNoticeText,
        restartZoneText,
        restartZoneNoticeText,
        restartZoneAvailable,
        trainRowsAttr,
        trainAvailable,
        trainNoticeText,
        alertChipRects,
        statusHeaderRect,
        restartStatusRect,
        restartStatusText,
        restartStatusFontSize,
        restartStatusTextRngTop
      }
    },
    { spec: serializableSpec(spec), entry }
  )
}

function serializableSpec(spec) {
  return {
    widgetId: spec.widgetId,
    attrPrefix: spec.attrPrefix,
    dashboardSelector: spec.dashboardSelector,
    readoutSelector: spec.readoutSelector,
    stateAttributes: spec.stateAttributes,
    zones: spec.zones,
    values: spec.values,
    containment: spec.containment,
    counted: spec.counted,
    forbidden: spec.forbidden
  }
}

runRaceconCapture({
  spec: RC13_SPEC,
  appRoot,
  here,
  argv: process.argv.slice(2),
  captureMatrix: RC13_CAPTURE_MATRIX,
  collectMetrics,
  validateCaptureMetrics,
  validateCapturePixels
}).catch(reportCaptureFailure)
