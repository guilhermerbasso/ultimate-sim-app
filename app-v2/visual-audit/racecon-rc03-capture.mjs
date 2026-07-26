import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reportCaptureFailure, runRaceconCapture } from "./racecon-capture-shared.mjs"
import { RC03_CAPTURE_MATRIX, RC03_SPEC, validateCaptureMetrics, validateCapturePixels } from "./racecon-rc03-capture-lib.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, "..")

/**
 * Only the RC-03 DOM contract lives here. The viewport matrix, the readiness gate, the shared
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

      const ribbon = root.querySelector('[data-testid="rc03-ribbon"]')
      const ribbonFill = root.querySelector('[data-testid="rc03-ribbon-fill"]')
      const fuelBar = root.querySelector('[data-testid="rc03-fuel-bar"]')
      const fuelBarFill = root.querySelector('[data-testid="rc03-fuel-bar-fill"]')
      const vitalsZone = root.querySelector(".rc03-vitals")
      const alarmLine = root.querySelector('[data-testid="rc03-alarm-line"]')
      const fuelTrend = root.querySelector('[data-testid="rc03-fuel-trend"]')
      const fuelPerLap = root.querySelector('[data-rc03-zone="fuel-trend"] .rc03-value')

      return {
        ...common,
        nativeSize: root.querySelector(".rc03-dashboard")?.getAttribute("data-rc03-native-size") ?? null,
        ribbon: {
          tone: ribbon?.getAttribute("data-tone") ?? null,
          unavailable: ribbon?.getAttribute("data-unavailable") ?? null,
          rect: relativeRect(ribbon),
          fill: relativeRect(ribbonFill),
          textLength: (ribbon?.textContent ?? "").trim().length
        },
        fuelBar: {
          unavailable: fuelBar?.getAttribute("data-unavailable") ?? null,
          rect: relativeRect(fuelBar),
          fill: relativeRect(fuelBarFill)
        },
        vitals: Array.from(root.querySelectorAll('[data-testid="rc03-vital"]')).map((vital) => ({
          channel: vital.getAttribute("data-channel"),
          alert: vital.getAttribute("data-alert"),
          label: vital.querySelector("dt")?.textContent?.trim() ?? "",
          text: vital.querySelector("output")?.textContent?.trim() ?? "",
          rect: measuredRect(vital),
          valueRect: measuredRect(vital.querySelector("output"))
        })),
        vitalsAlarm: vitalsZone?.getAttribute("data-rc03-alarm") ?? null,
        alarmLineText: alarmLine?.textContent?.trim() ?? null,
        alarmLineRect: relativeRect(alarmLine),
        railRows: Array.from(root.querySelectorAll('[data-testid="rc03-rail-row"]')).map((row) => ({
          label: row.querySelector(".rc03-label")?.textContent?.trim() ?? "",
          text: row.querySelector("output")?.textContent?.trim() ?? "",
          rect: measuredRect(row)
        })),
        fuelTrend: { display: fuelTrend ? getComputedStyle(fuelTrend).display : "none", rect: relativeRect(fuelTrend) },
        fuelPerLapText: fuelPerLap?.textContent?.trim() ?? null,
        // The alarm paints a red border on the vitals band, a red gauge value and a red alarm
        // line, and every one of them lives inside the band. The band rectangle is therefore the
        // whole alert scope, and any danger pixel outside it is a leak.
        alertScope: relativeRect(vitalsZone)
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
  spec: RC03_SPEC,
  appRoot,
  here,
  argv: process.argv.slice(2),
  captureMatrix: RC03_CAPTURE_MATRIX,
  collectMetrics,
  validateCaptureMetrics,
  validateCapturePixels
}).catch(reportCaptureFailure)
