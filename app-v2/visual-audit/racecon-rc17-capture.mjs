import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reportCaptureFailure, runRaceconCapture } from "./racecon-capture-shared.mjs"
import { RC17_CAPTURE_MATRIX, RC17_SPEC, validateCaptureMetrics, validateCapturePixels } from "./racecon-rc17-capture-lib.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, "..")

/**
 * Only the RC-17 DOM contract lives here. The viewport matrix, the readiness gate, the shared
 * metric contract, the geometry helpers and the entire capture lifecycle — private staging,
 * exclusive writes, atomic no-replace publication, quarantine cleanup and the Git-state gate —
 * come from `racecon-capture-shared.mjs`.
 */
async function collectMetrics(page, spec, entry) {
  return page.locator(spec.rootSelector).evaluate(
    (root, input) => {
      const helpers = window.__rcMeasure(root)
      const common  = window.__rcCommon(root, input.spec, helpers)
      const { relativeRect } = helpers

      const dashRoot    = root.querySelector(".rc17-dashboard")
      const tertEl      = root.querySelector('[data-testid="rc17-tertiary"]')
      const revTrackEl  = root.querySelector('[data-testid="rc17-rev-track"]')
      const revFillEl   = root.querySelector('[data-testid="rc17-rev-fill"]')
      const ringEl      = root.querySelector('[data-testid="rc17-ring"]')
      const laneEl      = root.querySelector('[data-testid="rc17-lane"]')

      // Data attributes that live on the WIDGET root (first descendant with data-rc17-alerts).
      const widgetRoot  = root.querySelector('[data-rc17-alerts]')

      // rev fill is published on the tertiary SECTION, not the widget root (packet 15).
      const revFillAttr = tertEl?.getAttribute("data-rc17-rev-fill") ?? null

      // Rendered rev fill geometry (used to verify 0.80 ± 0.02).
      const revTrackRect = relativeRect(revTrackEl)
      const revFillRect  = relativeRect(revFillEl)

      // Ring centre in capture-root-relative coordinates — used to verify that it aligns with
      // the clock zone centre within 3 px.
      let ringCentreX, ringCentreY
      if (ringEl) {
        const rr = relativeRect(ringEl)
        if (rr) {
          ringCentreX = rr.left + rr.width  / 2
          ringCentreY = rr.top  + rr.height / 2
        }
      }

      // laneUsageHistory omission (GAP-1): data-rc17-lane-rows on the lane SECTION.
      const laneRows = laneEl?.getAttribute("data-rc17-lane-rows") ?? null

      // native-size attribute on the dashboard root.
      const nativeSize = dashRoot?.getAttribute("data-rc17-native-size") ?? null

      // lineOptions: read data-rc17-selected from each rc17-line-option for the omission check.
      const lineOptions = Array.from(
        root.querySelectorAll('[data-testid="rc17-line-option"]')
      ).map((el) => ({
        key:      el.getAttribute("data-rc17-key") ?? el.textContent?.trim() ?? "",
        selected: el.getAttribute("data-rc17-selected") ?? null
      }))

      // Alert scope for the signature (magenta) hue audit.
      //
      // `--rc17-signature` #ff5aa0 is bound to exactly three surfaces in the shipped stylesheet:
      //   .rc17-flag                                        (the persistent side flag)
      //   .rc17-sector[data-rc17-tone='signature'] .rc17-sector-arc  (the occupied sector fill)
      //   .rc17-contact[data-rc17-lit='true']               (the lit radar dot on the ring)
      // Scoping to the flags band and the left sector alone leaves the lit contact dot outside
      // every permitted rect, which is a harness error rather than a stray alert colour — so all
      // three owners are collected. Any signature pixel outside them really is a leak.
      const flagsEl        = root.querySelector('[data-testid="rc17-flags"]')
      const occupiedArcEls = Array.from(root.querySelectorAll('[data-testid="rc17-sector"][data-rc17-tone="signature"]'))
      const litContactEls  = Array.from(root.querySelectorAll('[data-testid="rc17-contact"][data-rc17-lit="true"]'))
      const alertScope     = [flagsEl, ...occupiedArcEls, ...litContactEls].map(relativeRect).filter(Boolean)

      return {
        ...common,
        nativeSize,
        revFillAttr,
        revTrackPx:  revTrackRect ? revTrackRect.width : null,
        // The fill is sized as a PERCENTAGE of the track's content box, but the track paints a
        // border. Measuring fill-border-box / track-border-box therefore double-counts the border
        // and reports ~0.79 for a model fraction of exactly 0.80 — a 1.6 px constant shortfall at
        // every viewport, which is the border, not the widget. The content width is the honest
        // denominator.
        revTrackContentPx: (() => {
          const track = root.querySelector('[data-testid="rc17-rev-track"]')
          if (!track) return null
          const style = getComputedStyle(track)
          return (
            track.clientWidth -
            Number.parseFloat(style.paddingLeft || "0") -
            Number.parseFloat(style.paddingRight || "0")
          )
        })(),
        revFillPx:   revFillRect  ? revFillRect.width  : null,
        ringCentreX,
        ringCentreY,
        laneRows,
        lineOptions,
        alertScope
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
  spec:                    RC17_SPEC,
  appRoot,
  here,
  argv:                    process.argv.slice(2),
  captureMatrix:           RC17_CAPTURE_MATRIX,
  collectMetrics,
  validateCaptureMetrics,
  validateCapturePixels
}).catch(reportCaptureFailure)
