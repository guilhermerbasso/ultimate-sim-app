import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reportCaptureFailure, runRaceconCapture } from "./racecon-capture-shared.mjs"
import { RC10_CAPTURE_MATRIX, RC10_SPEC, validateCaptureMetrics, validateCapturePixels } from "./racecon-rc10-capture-lib.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, "..")

/**
 * Only the RC-10 DOM contract lives here. The viewport matrix, the readiness gate, the shared
 * metric contract, the geometry helpers and the entire capture lifecycle come from
 * `racecon-capture-shared.mjs`.
 */
async function collectMetrics(page, spec, entry) {
  return page.locator(spec.rootSelector).evaluate(
    (root, input) => {
      const helpers = window.__rcMeasure(root)
      const common = window.__rcCommon(root, input.spec, helpers)
      const { relativeRect } = helpers

      const fuelEl = root.querySelector('[data-testid="rc10-fuel"]')
      const fuelBarEl = root.querySelector('[data-testid="rc10-fuel-bar"]')
      const shiftEl = root.querySelector('[data-testid="rc10-shift"]')
      const plainEl = root.querySelector('[data-testid="rc10-plain"]')

      // The fuel tile owns the FUEL LOW alert. RC-10's Okabe-Ito palette puts caution, danger
      // and signature in a single amber hue family, so the alert cannot be proved by absence or
      // scope; what it does change is the amber DENSITY inside this tile, and it changes it
      // DOWNWARDS (four lit signature segments at rest, one plus a caution triangle engaged).
      const fuelScope = [relativeRect(fuelEl)].filter(Boolean)

      return {
        ...common,
        nativeSize: root.querySelector(".rc10-dashboard")?.getAttribute("data-rc10-native-size") ?? null,
        shiftSegments: shiftEl?.getAttribute("data-rc10-segments") ?? null,
        shiftLit: shiftEl?.getAttribute("data-rc10-lit") ?? null,
        fuelSegments: fuelBarEl?.getAttribute("data-rc10-segments") ?? null,
        fuelLit: fuelBarEl?.getAttribute("data-rc10-lit") ?? null,
        fuelEmphasised: fuelEl?.getAttribute("data-rc10-emphasised") ?? null,
        fuelLowText: root.querySelector('[data-testid="rc10-fuel-low"]')?.textContent?.trim() ?? null,
        plainCarried: plainEl?.getAttribute("data-rc10-carried") ?? null,
        plainHeadline: root.querySelector('[data-testid="rc10-plain-headline"]')?.textContent?.trim() ?? null,
        statusShapes: Array.from(root.querySelectorAll('[data-testid="rc10-status-icon"]')).map((icon) =>
          icon.getAttribute("data-rc10-shape")
        ),
        statusRanks: Array.from(root.querySelectorAll('[data-testid="rc10-status-cell"]')).map((cell) =>
          cell.getAttribute("data-rc10-rank")
        ),
        fuelScope
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
  spec: RC10_SPEC,
  appRoot,
  here,
  argv: process.argv.slice(2),
  captureMatrix: RC10_CAPTURE_MATRIX,
  collectMetrics,
  validateCaptureMetrics,
  validateCapturePixels
}).catch(reportCaptureFailure)
