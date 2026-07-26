import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reportCaptureFailure, runRaceconCapture } from "./racecon-capture-shared.mjs"
import { RC06_CAPTURE_MATRIX, RC06_SPEC, validateCaptureMetrics, validateCapturePixels } from "./racecon-rc06-capture-lib.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, "..")

/**
 * Only the RC-06 DOM contract lives here. The viewport matrix, the readiness gate, the shared
 * metric contract, the geometry helpers and the entire capture lifecycle come from
 * `racecon-capture-shared.mjs`.
 */
async function collectMetrics(page, spec, entry) {
  return page.locator(spec.rootSelector).evaluate(
    (root, input) => {
      const helpers = window.__rcMeasure(root)
      const common = window.__rcCommon(root, input.spec, helpers)
      const { relativeRect } = helpers

      const balanceSection = root.querySelector('[data-testid="rc06-balance"]')
      const trendSection = root.querySelector('[data-testid="rc06-trend"]')
      const dashboard = root.querySelector(".rc06-dashboard")

      return {
        ...common,
        // Present only when layout === 'native'; absent otherwise (gotcha 10).
        nativeSize: dashboard?.getAttribute("data-rc06-native-size") ?? null,
        // Attributes from the balance section element (not on the root widget).
        balanceSign: balanceSection?.getAttribute("data-rc06-sign") ?? null,
        balanceArrow: balanceSection?.getAttribute("data-rc06-arrow") ?? null,
        balanceToneAttr: balanceSection?.getAttribute("data-rc06-tone") ?? null,
        /**
         * The alert scope is the entire balance section rect. All SAVE MORE red pixels
         * (balance numeral, arrow SVG, SAVE MORE text) live inside .rc06-balance.
         * Any red pixel outside this rect is a leak and fails the hue-scope assertion.
         */
        alertScope: relativeRect(balanceSection),
        /**
         * Trend zone is conditionally rendered — absent from DOM at non-app layouts
         * (omission 3). Cannot be included in spec.zones for the common absent-zone check.
         */
        trendZone: trendSection
          ? { present: true, display: getComputedStyle(trendSection).display, rect: relativeRect(trendSection) }
          : { present: false, display: "none", rect: null }
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
  spec: RC06_SPEC,
  appRoot,
  here,
  argv: process.argv.slice(2),
  captureMatrix: RC06_CAPTURE_MATRIX,
  collectMetrics,
  validateCaptureMetrics,
  validateCapturePixels
}).catch(reportCaptureFailure)
