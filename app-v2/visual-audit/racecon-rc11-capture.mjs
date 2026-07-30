import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reportCaptureFailure, runRaceconCapture } from "./racecon-capture-shared.mjs"
import {
  RC11_CAPTURE_MATRIX,
  RC11_SPEC,
  validateCaptureMetrics,
  validateCapturePixels
} from "./racecon-rc11-capture-lib.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, "..")

/**
 * Only the RC-11 DOM contract lives here. The viewport matrix, the readiness gate, the shared
 * metric contract, the geometry helpers and the entire capture lifecycle come from
 * `racecon-capture-shared.mjs`.
 *
 * RC-11 "Trace Room" specific measurements collected inside the browser context:
 *  - Four `rc11-plot` element rects (getBoundingClientRect, relative to capture root): the
 *    headline shared-axis proof requires measured equality, not attribute trust.
 *  - Four `rc11-cursor` element left values: proves one scrub cursor ties all four panels.
 *  - `data-rc11-plot-x0` / `data-rc11-plot-x1` attribute strings for all four plots.
 *  - All `rc11-distance-tick` texts: proves every tick reads "--" (lapDistanceChannel omission).
 *  - The distance-axis element text (for bonus digit guard).
 *  - `data-rc11-native-size` from `.rc11-dashboard` (native size modifier).
 *  - Whether the sectors panel is present (app-only reveal).
 *  - All `rc11-gap` element rects (geometry proof of the DATA GAP state).
 */
async function collectMetrics(page, spec, entry) {
  return page.locator(spec.rootSelector).evaluate(
    (root, input) => {
      const helpers = window.__rcMeasure(root)
      const common = window.__rcCommon(root, input.spec, helpers)
      const { relativeRect } = helpers

      // ── HEADLINE: all four rc11-plot elements measured with getBoundingClientRect ──────────
      //
      // The four distance-domain plot containers are one per trace panel. Their `left` and
      // `width` must be equal across all four panels — that is the shared-axis contract — and
      // their `data-rc11-plot-x0` / `data-rc11-plot-x1` attributes must be identical strings.
      // Using relativeRect (which calls getBoundingClientRect) rather than clientWidth/offsetLeft
      // is essential: only the measured rectangle disagrees when an element escapes its box.
      const plotNodes = Array.from(root.querySelectorAll('[data-testid="rc11-plot"]'))
      const plotRects = plotNodes.map((node) => {
        const rect = relativeRect(node)
        return {
          plotId: node.getAttribute("data-rc11-plot") ?? "unknown",
          left:   rect ? rect.left  : 0,
          top:    rect ? rect.top   : 0,
          width:  rect ? rect.width : 0,
          height: rect ? rect.height: 0,
          attrX0: node.getAttribute("data-rc11-plot-x0") ?? null,
          attrX1: node.getAttribute("data-rc11-plot-x1") ?? null
        }
      })

      // ── Four rc11-cursor elements — proves one cursor ties four panels ────────────────────
      //
      // The cursor `left` is measured from getBoundingClientRect, NOT from `data-rc11-cursor-x`.
      // A cursor that visually appears aligned can still differ fractionally between panels if
      // the inset arithmetic drifted; only the rect catches it.
      const cursorNodes = Array.from(root.querySelectorAll('[data-testid="rc11-cursor"]'))
      const cursorRects = cursorNodes.map((node) => {
        const rect = relativeRect(node)
        return {
          panelId: node.getAttribute("data-rc11-cursor-panel") ?? "unknown",
          left:    rect ? rect.left  : 0,
          top:     rect ? rect.top   : 0,
          width:   rect ? rect.width : 0,
          height:  rect ? rect.height: 0
        }
      })

      // ── Distance tick texts — lapDistanceChannel omission ────────────────────────────────
      //
      // Every tick must read exactly "--". Collecting all texts lets the validator check each one
      // independently and report which tick carries a digit, if any.
      const tickTexts = Array.from(root.querySelectorAll('[data-testid="rc11-distance-tick"]')).map(
        (node) => (node.textContent ?? "").trim()
      )

      // ── Distance axis element text (bonus digit guard) ────────────────────────────────────
      const distanceAxisNode = root.querySelector('[data-testid="rc11-distance-axis"]')
      const distanceAxisText = distanceAxisNode ? (distanceAxisNode.textContent ?? "").trim() : ""

      // ── Native size modifier ──────────────────────────────────────────────────────────────
      const nativeSize = root.querySelector(".rc11-dashboard")?.getAttribute("data-rc11-native-size") ?? null

      // ── App-only reveals ──────────────────────────────────────────────────────────────────
      const sectorPanelPresent = root.querySelector('[data-testid="rc11-panel-sectors"]') !== null

      // ── Gap-band geometry (data-gap state proof) ──────────────────────────────────────────
      //
      // The DATA GAP band is proved from DOM presence and from geometry (non-zero measured width).
      // Its neutral colour (#8a97a633) carries no hue-family pixels, so pixel audit cannot prove it.
      const gapNodes = Array.from(root.querySelectorAll('[data-testid="rc11-gap"]'))
      const gapRects = gapNodes.map((node) => {
        const rect = relativeRect(node)
        return {
          channel: node.getAttribute("data-rc11-gap-channel") ?? "unknown",
          left:    rect ? rect.left  : 0,
          top:     rect ? rect.top   : 0,
          width:   rect ? rect.width : 0,
          height:  rect ? rect.height: 0
        }
      })

      return {
        ...common,
        nativeSize,
        plotRects,
        cursorRects,
        distanceTickTexts: tickTexts,
        distanceAxisText,
        sectorPanelPresent,
        gapRects
      }
    },
    { spec: serializableSpec(spec), entry }
  )
}

function serializableSpec(spec) {
  return {
    widgetId:         spec.widgetId,
    attrPrefix:       spec.attrPrefix,
    dashboardSelector:spec.dashboardSelector,
    readoutSelector:  spec.readoutSelector,
    stateAttributes:  spec.stateAttributes,
    zones:            spec.zones,
    values:           spec.values,
    containment:      spec.containment,
    counted:          spec.counted,
    forbidden:        spec.forbidden
  }
}

runRaceconCapture({
  spec: RC11_SPEC,
  appRoot,
  here,
  argv: process.argv.slice(2),
  captureMatrix: RC11_CAPTURE_MATRIX,
  collectMetrics,
  validateCaptureMetrics,
  validateCapturePixels
}).catch(reportCaptureFailure)
