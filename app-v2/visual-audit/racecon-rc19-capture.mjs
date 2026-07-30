import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reportCaptureFailure, runRaceconCapture } from "./racecon-capture-shared.mjs"
import {
  RC19_CAPTURE_MATRIX,
  RC19_SPEC,
  validateCaptureMetrics,
  validateCapturePixels
} from "./racecon-rc19-capture-lib.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, "..")

/**
 * Only the RC-19 DOM contract lives here. The viewport matrix, the readiness gate, the shared
 * metric contract, the geometry helpers and the entire capture lifecycle — private staging,
 * exclusive writes, atomic no-replace publication, quarantine cleanup and the Git-state gate —
 * come from `racecon-capture-shared.mjs`.
 *
 * RC-19 specifics collected beyond the common contract:
 *
 *   alertsClearance  — rects of the alerts strip, the FAULTS row and the CONFIRM READY label and
 *                      confirm element, collected only when the alerts strip is in the DOM, used
 *                      by the alert-floor band assertion (headline promise #1).
 *
 *   alertScope       — relative rects of every element that is expected to carry danger pixels in
 *                      the alert states (the strip itself plus every blocking checklist row). Used
 *                      by `assertHueFamilyScoped` in the pixel audit.
 *
 *   nativeSize       — the data-rc19-native-size attribute from the dashboard root, used to verify
 *                      the native-canvas 800x480 badge.
 *
 *   nextStintValues  — every next-stint row's VALUE cell with its layout box and its painted range
 *                      rect, so the FUEL PER LAP overrun is measured against the box it is laid
 *                      out in rather than only against integer-rounded `scrollWidth`. Values only:
 *                      the `.rc19-label` beside each carries its unit as an element child, so it
 *                      is not a leaf and is outside what this harness undertakes to observe.
 *
 *   timelineSegments — data-rc19-timeline-segments from the timeline element, used to assert that
 *                      the app timeline renders zero segments (packet omission: stintPlanTimeline).
 */
async function collectMetrics(page, spec, entry) {
  return page.locator(spec.rootSelector).evaluate(
    (root, input) => {
      const helpers = window.__rcMeasure(root)
      const common = window.__rcCommon(root, input.spec, helpers)
      const { relativeRect } = helpers

      // Alert strip — position:absolute inside the dashboard root, renders only when alerts=active.
      const alertsEl   = root.querySelector('[data-testid="rc19-alerts"]')
      const faultsEl   = root.querySelector('[data-testid="rc19-faults"]')
      const confirmEl  = root.querySelector('[data-testid="rc19-confirm"]')
      const confirmLabelEl = root.querySelector('[data-testid="rc19-confirm-label"]')

      const alertsClearance = {
        alertsRect:      relativeRect(alertsEl),
        faultsRect:      relativeRect(faultsEl),
        confirmRect:     relativeRect(confirmEl),
        confirmLabelRect: relativeRect(confirmLabelEl)
      }

      // The alert scope is the union of the alerts strip and every blocking checklist row.
      // Danger pixels outside this scope constitute a regression.
      const alertScope = []
      if (alertsEl) {
        const ar = relativeRect(alertsEl)
        if (ar) alertScope.push(ar)
      }
      for (const blockingRow of Array.from(root.querySelectorAll('[data-rc19-blocking="true"]'))) {
        const br = relativeRect(blockingRow)
        if (br) alertScope.push(br)
      }

      // Timeline segment count (app-only): must be "0" because no stint plan channel exists.
      const timelineEl = root.querySelector('[data-testid="rc19-timeline"]')
      const timelineSegments = timelineEl?.getAttribute("data-rc19-timeline-segments") ?? null

      // Dashboard native-size badge (native canvas only).
      const nativeSize = root.querySelector(".rc19-dashboard")?.getAttribute("data-rc19-native-size") ?? null

      // Every next-stint row's VALUE cell, with its layout box and its painted range rect. Only
      // the values: the `.rc19-label` beside each carries its unit as an element child, so it is
      // not a leaf and is outside what this harness undertakes to observe.
      const nextStintValues = Array.from(
        root.querySelectorAll('[data-testid="rc19-next-stint"] .rc19-row > .rc19-value')
      ).map((cell) => ({
        row: cell.closest(".rc19-row")?.getAttribute("data-rc19-row") ?? "",
        text: (cell.textContent ?? "").trim(),
        rect: relativeRect(cell),
        textRect: helpers.textRect(cell)
      }))

      return {
        ...common,
        // The readiness word is measured bespoke, outside the shared value sweep, so its line-box
        // overhang against the app header band can be recorded with its measurement rather than
        // aborting the sweep. See `assertReadinessBand`.
        readiness: (() => {
          const el = root.querySelector('[data-testid="rc19-readiness"]')
          if (!el) return null
          return {
            text: el.textContent?.trim() ?? "",
            fontSize: Number.parseFloat(getComputedStyle(el).fontSize),
            rect: helpers.relativeRect(el),
            textRect: helpers.textRect(el)
          }
        })(),
        alertsClearance,
        alertScope,
        nextStintValues,
        timelineSegments,
        nativeSize
      }
    },
    { spec: serializableSpec(spec), entry }
  )
}

function serializableSpec(spec) {
  return {
    widgetId:          spec.widgetId,
    attrPrefix:        spec.attrPrefix,
    dashboardSelector: spec.dashboardSelector,
    stateAttributes:   spec.stateAttributes,
    zones:             spec.zones,
    values:            spec.values,
    containment:       spec.containment,
    counted:           spec.counted,
    forbidden:         spec.forbidden
  }
}

runRaceconCapture({
  spec:                   RC19_SPEC,
  appRoot,
  here,
  argv:                   process.argv.slice(2),
  captureMatrix:          RC19_CAPTURE_MATRIX,
  collectMetrics,
  validateCaptureMetrics,
  validateCapturePixels
}).catch(reportCaptureFailure)
