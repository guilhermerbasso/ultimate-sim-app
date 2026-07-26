import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reportCaptureFailure, runRaceconCapture } from "./racecon-capture-shared.mjs"
import { RC04_CAPTURE_MATRIX, RC04_SPEC, validateCaptureMetrics, validateCapturePixels } from "./racecon-rc04-capture-lib.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, "..")

/**
 * Only the RC-04 DOM contract lives here. The viewport matrix, the readiness gate, the shared
 * metric contract, the geometry helpers and the entire capture lifecycle — private staging,
 * exclusive writes, atomic no-replace publication, quarantine cleanup and the Git-state gate —
 * come from `racecon-capture-shared.mjs`.
 */
async function collectMetrics(page, spec, entry) {
  return page.locator(spec.rootSelector).evaluate(
    (root, input) => {
      const helpers = window.__rcMeasure(root)
      const common = window.__rcCommon(root, input.spec, helpers)
      const { relativeRect, measuredRect } = helpers

      const widget = root.querySelector('[data-widget="raceconRc04Dash"]')
      const alarmLine = root.querySelector('[data-testid="rc04-alarm-line"]')
      const serviceApp = root.querySelector(".rc04-service-app")
      const stepCaret = root.querySelector('[data-testid="rc04-step-caret"]')
      const activeStep = stepCaret ? stepCaret.closest('[data-testid="rc04-step"]') : null
      const speedZone = root.querySelector('[data-testid="rc04-speed-zone"]')
      const actionZone = root.querySelector('[data-testid="rc04-action-line"]')

      return {
        ...common,
        // data-rc04-native-size="800x480" only present when layout === 'native'.
        nativeSize: root.querySelector(".rc04-dashboard")?.getAttribute("data-rc04-native-size") ?? null,
        // --rc04-bar-fill from inline style — governance requires asserting from CSS property,
        // not from measured pixel widths (non-blocking residual 1 in the governance chain).
        barFillStyle: widget?.style?.getPropertyValue("--rc04-bar-fill")?.trim() ?? null,
        // Font size of the active phase step — the fourth tier of the type-scale hierarchy.
        activeStepFontSize: activeStep ? Number.parseFloat(getComputedStyle(activeStep).fontSize) : null,
        // .rc04-service-app contains STOP and TYRES rows, visible only in app layout.
        serviceAppDisplay: serviceApp ? getComputedStyle(serviceApp).display : "none",
        // Alarm line present and scoped to the action zone when overspeed is active.
        alarmLineText: alarmLine?.textContent?.trim() ?? null,
        alarmLineRect: relativeRect(alarmLine),
        // Crew corner values (all '--' in this fixture since pitServiceFlags is undefined).
        crewCorners: Array.from(root.querySelectorAll('[data-testid="rc04-crew-corner"]')).map((corner) => ({
          rect: measuredRect(corner),
          text: corner.querySelector("output")?.textContent?.trim() ?? null
        })),
        // Alert scope rectangles for the pixel audit: red pixels from overspeed must stay inside
        // the speed zone (bar fill + border) and the action zone (action text + alarm line).
        alertScope: {
          speed: relativeRect(speedZone),
          action: relativeRect(actionZone)
        }
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
  spec: RC04_SPEC,
  appRoot,
  here,
  argv: process.argv.slice(2),
  captureMatrix: RC04_CAPTURE_MATRIX,
  collectMetrics,
  validateCaptureMetrics,
  validateCapturePixels
}).catch(reportCaptureFailure)
