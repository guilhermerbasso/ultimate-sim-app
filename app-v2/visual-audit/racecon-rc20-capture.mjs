import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reportCaptureFailure, runRaceconCapture } from "./racecon-capture-shared.mjs"
import {
  RC20_CAPTURE_MATRIX,
  RC20_SPEC,
  validateCaptureMetrics,
  validateCapturePixels
} from "./racecon-rc20-capture-lib.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, "..")

/**
 * Only the RC-20 DOM contract lives here. The viewport matrix, the readiness gate, the shared
 * metric contract, the geometry helpers and the entire capture lifecycle — private staging,
 * exclusive writes, atomic no-replace publication, quarantine cleanup and the Git-state gate —
 * come from `racecon-capture-shared.mjs`.
 */
async function collectMetrics(page, spec, entry) {
  return page.locator(spec.rootSelector).evaluate(
    (root, input) => {
      const helpers = window.__rcMeasure(root)
      const common = window.__rcCommon(root, input.spec, helpers)
      const { relativeRect } = helpers

      // Ladder bar details for the counting-structure assertions
      const ladderBarsEl = root.querySelector('[data-testid="rc20-ladder-bars"]')
      const ladderBarEls = Array.from(root.querySelectorAll('[data-testid="rc20-ladder-bar"]'))
      const ladderBarCount = ladderBarsEl ? ladderBarsEl.getAttribute("data-rc20-bar-count") : null
      const ladderBars = ladderBarEls.map((el) => ({
        index: Number(el.getAttribute("data-rc20-bar")),
        lit: el.getAttribute("data-rc20-lit") === "true",
        rect: relativeRect(el)
      }))

      // Grid slot text (non-app; always "--" per gridSlot omission)
      const slotEl = root.querySelector('[data-testid="rc20-strip-slot"]')
      const stripSlotText = slotEl ? slotEl.textContent?.trim() ?? null : null

      // Alert element rects for the hue-scope proof (jump-start and over-rev alerts)
      const alertEls = Array.from(
        root.querySelectorAll(
          '[data-testid="rc20-jump-start"],[data-testid="rc20-over-rev"],[data-testid="rc20-over-rev-cap"]'
        )
      )
      const alertScope = alertEls.map((el) => relativeRect(el)).filter(Boolean)

      // Strip-cell VALUE font size for the 4-level type-scale assertion (native/compact only).
      //
      // The rung is the strip VALUE, not the `rc20-strip-cell` wrapper: the wrapper inherits the
      // strip's label size (17 px at native), so measuring it reports the label rung and
      // manufactures an inversion against the real 30 px value. `RC20_TYPE_SCALE_PX.strip` is 30,
      // which is what `rc20-strip-tyre-LF` and its siblings actually render.
      const firstStripValue =
        root.querySelector('[data-rc20-zone="strip"] output[data-testid^="rc20-strip-"]') ??
        root.querySelector('[data-testid="rc20-strip-tyre-LF"]')
      const stripCellFontSize = firstStripValue
        ? Number.parseFloat(getComputedStyle(firstStripValue).fontSize)
        : null

      return {
        ...common,
        ladderBarCount,
        ladderBars,
        stripSlotText,
        alertScope,
        stripCellFontSize
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
    stateAttributes: spec.stateAttributes,
    zones: spec.zones,
    values: spec.values,
    containment: spec.containment,
    counted: spec.counted,
    forbidden: spec.forbidden
  }
}

runRaceconCapture({
  spec: RC20_SPEC,
  appRoot,
  here,
  argv: process.argv.slice(2),
  captureMatrix: RC20_CAPTURE_MATRIX,
  collectMetrics,
  validateCaptureMetrics,
  validateCapturePixels
}).catch(reportCaptureFailure)
