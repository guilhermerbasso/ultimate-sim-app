import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reportCaptureFailure, runRaceconCapture } from "./racecon-capture-shared.mjs"
import {
  RC18_CAPTURE_MATRIX,
  RC18_SPEC,
  validateCaptureMetrics,
  validateCapturePixels
} from "./racecon-rc18-capture-lib.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, "..")

/**
 * Only the RC-18 DOM contract lives here. The viewport matrix, the readiness gate, the shared
 * metric contract, the geometry helpers, and the entire capture lifecycle come from
 * `racecon-capture-shared.mjs`.
 */
async function collectMetrics(page, spec, entry) {
  return page.locator(spec.rootSelector).evaluate(
    (root, input) => {
      const helpers = window.__rcMeasure(root)
      const common = window.__rcCommon(root, input.spec, helpers)
      const { relativeRect } = helpers

      const sectors = ["S1", "S2", "S3"]
      const trackRects = {}
      const datumRects = {}
      const barRects = {}
      const deltaValues = {}

      for (const sector of sectors) {
        const trackEl = root.querySelector(`[data-testid="rc18-track-${sector}"]`)
        const datumEl = root.querySelector(`[data-testid="rc18-datum-${sector}"]`)
        const barEl = root.querySelector(`[data-testid="rc18-bar-${sector}"]`)
        const deltaValueEl = root.querySelector(`[data-testid="rc18-delta-value-${sector}"]`)

        trackRects[sector] = relativeRect(trackEl)
        datumRects[sector] = relativeRect(datumEl)

        if (barEl) {
          barRects[sector] = {
            rect: relativeRect(barEl),
            lean: barEl.getAttribute("data-rc18-lean") ?? null
          }
        } else {
          barRects[sector] = null
        }

        deltaValues[sector] = deltaValueEl?.textContent?.trim() ?? null
      }

      // Column heads (header.rc18-column-head inside each column)
      const colAEl = root.querySelector('[data-testid="rc18-column-a"]')
      const colBEl = root.querySelector('[data-testid="rc18-column-b"]')
      const colAHeadEl = colAEl?.querySelector(".rc18-column-head") ?? null
      const colBHeadEl = colBEl?.querySelector(".rc18-column-head") ?? null

      // Identity lines
      const identityAEl = root.querySelector('[data-testid="rc18-identity-a"]')
      const identityBEl = root.querySelector('[data-testid="rc18-identity-b"]')

      // Trace zone presence
      const traceEl = root.querySelector('[data-testid="rc18-trace"]')
      const traceEmptyEl = root.querySelector('[data-testid="rc18-trace-empty"]')
      const tracePlotEl = root.querySelector('[data-testid="rc18-trace-plot"]')

      // Alert chip
      const alertChipEl = root.querySelector('[data-testid="rc18-alert-chip"]')

      // B-column brake rear value (brakeAxleAggregation omission — honest "--" state)
      const brakeRearBEl = root.querySelector('[data-testid="rc18-b-brakeRear"]')

      // Spine title and stability labels (containment / nowrap-escape check)
      const deltaStackEl = root.querySelector('[data-testid="rc18-delta-stack"]')
      const stabilityEl = root.querySelector('[data-testid="rc18-stability"]')
      const spineTitleEl = deltaStackEl?.querySelector("span.rc18-label.rc18-spine-title") ?? null
      const stabilityHeadEl = stabilityEl?.querySelector(".rc18-stability-head") ?? null
      const balanceLabelEl = stabilityHeadEl?.querySelector("span.rc18-label") ?? null
      const balanceSourceEl = root.querySelector('[data-testid="rc18-balance-source"]')

      // Incomparable rows: rows tagged data-rc18-incomparable="true" carry the amber scope.
      // The alert-keys attribute on the widget root names the incomparable keys (e.g.
      // "incomparable:brakeRear"); for each key, the matching B-column row element is the
      // primary amber surface, plus the shared Row element (which the A column also renders
      // with the INCOMPARABLE label in caution color).
      const widgetRoot = root.querySelector(".rc18-widget")
      const alertKeys = (widgetRoot?.getAttribute("data-rc18-alert-keys") ?? "")
        .split(",")
        .filter((k) => k.startsWith("incomparable:"))
        .map((k) => k.slice("incomparable:".length))

      const incomparableRowRects = []
      for (const key of alertKeys) {
        // Both A and B sides of an incomparable row are tagged — capture the pair.
        const rowEls = Array.from(root.querySelectorAll(`[data-rc18-row="${key}"]`))
        for (const rowEl of rowEls) {
          const r = relativeRect(rowEl)
          if (r) incomparableRowRects.push(r)
        }
        // Also capture the tag element itself (the amber "INCOMPARABLE" inline chip).
        const tagEls = Array.from(root.querySelectorAll(`[data-rc18-row="${key}"] .rc18-incomparable-tag`))
        for (const tagEl of tagEls) {
          const r = relativeRect(tagEl)
          if (r) incomparableRowRects.push(r)
        }
      }
      // The alert chip in the summary header is the FOURTH caution surface: `.rc18-alert-chip`
      // paints both a caution border and caution text (raceconRc18.css:173-175) and reads
      // "INCOMPARABLE <n>". Scoping amber to the incomparable rows alone leaves the chip's own
      // pixels outside every permitted rect, which is a harness omission rather than a stray alert
      // colour. The highlighted stability row (`raceconRc18.css:564`) is the fifth owner and is
      // included whenever it is highlighted, so the scope tracks the alert rather than the state.
      const chipEl = root.querySelector('[data-testid="rc18-alert-chip"]')
      if (chipEl) {
        const r = relativeRect(chipEl)
        if (r) incomparableRowRects.push(r)
      }
      const highlightedStability = root.querySelector('[data-testid="rc18-stability"][data-rc18-highlight="true"]')
      if (highlightedStability) {
        const r = relativeRect(highlightedStability)
        if (r) incomparableRowRects.push(r)
      }

      return {
        ...common,
        nativeSize: root.querySelector(".rc18-dashboard")?.getAttribute("data-rc18-native-size") ?? null,
        trackRects,
        datumRects,
        barRects,
        deltaValues,
        colAHeadRect: relativeRect(colAHeadEl),
        colBHeadRect: relativeRect(colBHeadEl),
        identityBandsA: identityAEl?.getAttribute("data-rc18-line-bands") ?? null,
        identityBandsB: identityBEl?.getAttribute("data-rc18-line-bands") ?? null,
        identityLineCountA: identityAEl
          ? identityAEl.querySelectorAll(".rc18-identity-line").length
          : 0,
        identityLineCountB: identityBEl
          ? identityBEl.querySelectorAll(".rc18-identity-line").length
          : 0,
        alertChipPresent: alertChipEl !== null,
        alertChipText: alertChipEl?.textContent?.trim() ?? null,
        incomparableRowRects,
        brakeRearBText: brakeRearBEl?.textContent?.trim() ?? null,
        spineTitleRect: relativeRect(spineTitleEl),
        balanceLabelRect: relativeRect(balanceLabelEl),
        balanceSourceRect: relativeRect(balanceSourceEl),
        tracePresent: traceEl !== null,
        traceEmptyPresent: traceEmptyEl !== null,
        tracePlotPresent: tracePlotEl !== null
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
  spec: RC18_SPEC,
  appRoot,
  here,
  argv: process.argv.slice(2),
  captureMatrix: RC18_CAPTURE_MATRIX,
  collectMetrics,
  validateCaptureMetrics,
  validateCapturePixels
}).catch(reportCaptureFailure)
