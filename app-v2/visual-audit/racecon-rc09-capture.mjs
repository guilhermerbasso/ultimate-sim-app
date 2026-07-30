import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reportCaptureFailure, runRaceconCapture } from "./racecon-capture-shared.mjs"
import { RC09_CAPTURE_MATRIX, RC09_SPEC, validateCaptureMetrics, validateCapturePixels } from "./racecon-rc09-capture-lib.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, "..")

/**
 * Only the RC-09 DOM contract lives here. The viewport matrix, the readiness gate, the shared
 * metric contract, the geometry helpers and the entire capture lifecycle come from
 * `racecon-capture-shared.mjs`.
 */
async function collectMetrics(page, spec, entry) {
  return page.locator(spec.rootSelector).evaluate(
    (root, input) => {
      const helpers = window.__rcMeasure(root)
      const common = window.__rcCommon(root, input.spec, helpers)
      const { relativeRect } = helpers

      const noteEl = root.querySelector('[data-testid="rc09-note"]')
      const splitEl = root.querySelector('[data-testid="rc09-split"]')
      const supportEl = root.querySelector('[data-testid="rc09-support"]')
      const arcEl = root.querySelector('[data-testid="rc09-arc"]')

      // The rectangle that OWNS the SPLIT LOSS alert.
      //
      // RC-09's palette is warm end to end, so amber cannot be proved absent from a silent
      // frame — labels, units, rules and the resting shift arc all paint it. What the alert
      // changes is the amber DENSITY inside this one chip, measured at 0.005–0.153 % silent
      // against 3.190–12.714 % engaged, with the amber outside it identical in both states.
      const splitScope = [relativeRect(splitEl)].filter(Boolean)

      return {
        ...common,
        nativeSize: root.querySelector(".rc09-dashboard")?.getAttribute("data-rc09-native-size") ?? null,
        stageEmptyText: root.querySelector('[data-testid="rc09-timeline-empty"]')?.textContent?.trim() ?? null,
        noteState: noteEl?.getAttribute("data-rc09-note") ?? null,
        noteGlyph: noteEl?.getAttribute("data-rc09-note-glyph") ?? null,
        cautionState: noteEl?.getAttribute("data-rc09-caution") ?? null,
        splitLoss: splitEl?.getAttribute("data-rc09-split-loss") ?? null,
        mechanicalState: supportEl?.getAttribute("data-rc09-mechanical") ?? null,
        arcLit: arcEl?.getAttribute("data-rc09-lit") ?? null,
        ledTones: Array.from(root.querySelectorAll('[data-testid="rc09-led"]')).map((led) =>
          led.getAttribute("data-rc09-led-tone")
        ),
        profileBars: root.querySelector('[data-testid="rc09-profile"]')?.getAttribute("data-rc09-bars") ?? null,
        splitScope
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
  spec: RC09_SPEC,
  appRoot,
  here,
  argv: process.argv.slice(2),
  captureMatrix: RC09_CAPTURE_MATRIX,
  collectMetrics,
  validateCaptureMetrics,
  validateCapturePixels
}).catch(reportCaptureFailure)
