import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reportCaptureFailure, runRaceconCapture } from "./racecon-capture-shared.mjs"
import { RC05_CAPTURE_MATRIX, RC05_SPEC, validateCaptureMetrics, validateCapturePixels } from "./racecon-rc05-capture-lib.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, "..")

/**
 * Only the RC-05 DOM contract lives here. The viewport matrix, the readiness gate, the shared
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

      const dashboard = root.querySelector(".rc05-dashboard")
      const alertLine = root.querySelector('[data-testid="rc05-alert-line"]')
      const wearEl = root.querySelector('[data-testid="rc05-wear"]')
      const wearValue = wearEl ? wearEl.querySelector("output.rc05-wear-value") : null
      const trendEl = root.querySelector('[data-testid="rc05-trend"]')
      const pressuresEl = root.querySelector('[data-testid="rc05-pressures"]')
      const deltaOutput = root.querySelector(".rc05-delta-value")
      const softKey = root.querySelector('[data-testid="rc05-soft-key"]')
      const lfCorner = root.querySelector('article[data-rc05-corner="LF"]')

      const corners = ["LF", "RF", "LR", "RR"].map((id) => {
        const article = root.querySelector(`article[data-rc05-corner="${id}"]`)
        return {
          id,
          band: article ? article.getAttribute("data-rc05-band") : null,
          pressureBand: article ? article.getAttribute("data-rc05-pressure-band") : null,
          overheat: article ? article.getAttribute("data-rc05-overheat") : null,
          cold: article ? article.getAttribute("data-rc05-cold") : null,
          pressureAlert: article ? article.getAttribute("data-rc05-pressure-alert") : null,
          zoom: article ? article.getAttribute("data-rc05-zoom") : null,
          rect: measuredRect(article)
        }
      })

      return {
        ...common,
        nativeSize: dashboard ? dashboard.getAttribute("data-rc05-native-size") : null,
        corners,
        deltaTone: deltaOutput ? deltaOutput.getAttribute("data-tone") : null,
        alertLinePresent: alertLine !== null,
        alertLineText: alertLine ? alertLine.textContent.trim() : null,
        alertLineRect: relativeRect(alertLine),
        wearPresent: wearEl !== null,
        wearText: wearValue ? wearValue.textContent.trim() : null,
        trendDisplay: trendEl ? getComputedStyle(trendEl).display : "none",
        pressuresDisplay: pressuresEl ? getComputedStyle(pressuresEl).display : "none",
        softKeyText: softKey ? softKey.textContent.trim() : null,
        // The LF corner article is the alert scope for the overheat pixel audit.
        alertScope: relativeRect(lfCorner),
        // The thermal legend carries the HOT swatch, which is the same coral the corner ramp
        // uses, so it is part of the red-family scope on every frame.
        legendRect: relativeRect(root.querySelector('[data-testid="rc05-legend"]'))
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
  spec: RC05_SPEC,
  appRoot,
  here,
  argv: process.argv.slice(2),
  captureMatrix: RC05_CAPTURE_MATRIX,
  collectMetrics,
  validateCaptureMetrics,
  validateCapturePixels
}).catch(reportCaptureFailure)
