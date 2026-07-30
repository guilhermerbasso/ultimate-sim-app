import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reportCaptureFailure, runRaceconCapture } from "./racecon-capture-shared.mjs"
import {
  RC16_CAPTURE_MATRIX,
  RC16_RING_NATIVE_ZONE_WIDTH,
  RC16_SVG_VIEWBOX_WIDTH,
  RC16_SPEC,
  validateCaptureMetrics,
  validateCapturePixels
} from "./racecon-rc16-capture-lib.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, "..")

/**
 * Only the RC-16 DOM contract lives here. The viewport matrix, the readiness gate, the shared
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

      // ── Ring geometry: use both SVG attributes and getBoundingClientRect ──────────────
      // The ring SVG has viewBox="0 0 100 100". rc16RingViewBoxRadius(pct) maps canvas-width
      // percent to viewBox units via: r_vb = pct * RC16_NATIVE_WIDTH_PX / zone.width = pct * 800/260.
      // nativeEquivGapPx = gap_vb * ringNativeZoneWidth / svgViewBoxWidth = gap_vb * 260/100.
      const ringSvgEl = root.querySelector('[data-testid="rc16-ring"] svg')
      const guideCircleEl = root.querySelector('[data-testid="rc16-ring-guide"]')
      const bandCircleEl = root.querySelector('[data-testid="rc16-ring-band"]')

      const svgRenderedWidth = ringSvgEl ? ringSvgEl.getBoundingClientRect().width : null
      const svgViewBoxAttr = ringSvgEl ? ringSvgEl.getAttribute("viewBox") : null
      // viewBox format: "minx miny width height"
      const svgViewBoxParts = svgViewBoxAttr ? svgViewBoxAttr.split(/\s+/) : []
      const svgViewBoxWidth = svgViewBoxParts.length >= 4
        ? Number.parseFloat(svgViewBoxParts[2])
        : input.svgViewBoxWidth  // fallback to published constant

      const guideRVb = guideCircleEl
        ? Number.parseFloat(guideCircleEl.getAttribute("r") ?? "NaN")
        : null
      const bandRVb = bandCircleEl
        ? Number.parseFloat(bandCircleEl.getAttribute("r") ?? "NaN")
        : null
      // stroke-width is the full stroke width in viewBox units
      const bandSwVb = bandCircleEl
        ? Number.parseFloat(
            bandCircleEl.getAttribute("stroke-width") ??
            getComputedStyle(bandCircleEl).strokeWidth ??
            "NaN"
          )
        : null

      const ringMeasurement = {
        guideRVb,
        bandRVb,
        bandSwVb,
        svgRenderedWidth,
        svgViewBoxWidth: Number.isFinite(svgViewBoxWidth) ? svgViewBoxWidth : input.svgViewBoxWidth,
        // Published ring attributes for cross-check
        ringMid: root.querySelector('[data-testid="rc16-ring"]')?.getAttribute("data-rc16-ring-mid") ?? null,
        ringGap: root.querySelector('[data-testid="rc16-ring"]')?.getAttribute("data-rc16-ring-gap") ?? null
      }

      // ── Smoothness meter: the fill fraction, so the bar can be checked against its numeral ──
      // The fill is a percentage of the track's CONTENT box while the track paints a border, so
      // dividing by the track's border box would double-count that border and report a constant
      // shortfall that is the border, not the widget.
      const smoothnessTrackEl = root.querySelector('[data-testid="rc16-smoothness-track"]')
      const smoothnessFillEl = root.querySelector('[data-testid="rc16-smoothness-fill"]')
      const smoothnessFillRatio = (() => {
        if (!smoothnessTrackEl || !smoothnessFillEl) return null
        const style = getComputedStyle(smoothnessTrackEl)
        const content =
          smoothnessTrackEl.clientHeight -
          Number.parseFloat(style.paddingTop || "0") -
          Number.parseFloat(style.paddingBottom || "0")
        const contentWidth =
          smoothnessTrackEl.clientWidth -
          Number.parseFloat(style.paddingLeft || "0") -
          Number.parseFloat(style.paddingRight || "0")
        const fill = smoothnessFillEl.getBoundingClientRect()
        // The meter is vertical at every governed viewport, but fall back to the width ratio if a
        // future reflow lays it out horizontally.
        if (content > 1 && fill.height > 0) return fill.height / content
        if (contentWidth > 1 && fill.width > 0) return fill.width / contentWidth
        return null
      })()

      // ── Alert scope: cue panel rect for amber hue scoping ────────────────────────────
      // In the over-rev state, amber (caution) must stay inside the cue panel. We collect the
      // rect here; validateCapturePixels uses it as the amber scope regardless of state, and
      // auditHueFamilies only applies the scope when scopes[cautionFamily] is non-empty.
      const cuePanelEl = root.querySelector('[data-testid="rc16-cue-panel"]')
      const alertScope = cuePanelEl ? [relativeRect(cuePanelEl)].filter(Boolean) : []

      // ── Cue alert attributes for assertAlertState ────────────────────────────────────
      const cuePanelAlert = cuePanelEl ? cuePanelEl.getAttribute("data-rc16-cue-alert") : null
      const cuePanelIsAlert = cuePanelEl ? cuePanelEl.classList.contains("is-alert") : false

      // ── History gap-with-data check for omission: consistencyHistoryDepth ────────────
      // A point must never be both available (has bar height) and a gap simultaneously.
      const historyGapWithData = Array.from(
        root.querySelectorAll('[data-testid="rc16-history-point"]')
      ).some(
        (el) =>
          el.getAttribute("data-rc16-history-gap") === "true" &&
          el.style.getPropertyValue("--rc16-history-band") !== ""
      )

      return {
        ...common,
        nativeSize:
          root.querySelector(".rc16-dashboard")?.getAttribute("data-rc16-native-size") ?? null,
        ringMeasurement,
        smoothnessFillRatio,
        alertScope,
        cuePanelAlert,
        cuePanelIsAlert,
        historyGapWithData
      }
    },
    {
      spec: serializableSpec(spec),
      entry,
      svgViewBoxWidth: RC16_SVG_VIEWBOX_WIDTH,
      ringNativeZoneWidth: RC16_RING_NATIVE_ZONE_WIDTH
    }
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
  spec: RC16_SPEC,
  appRoot,
  here,
  argv: process.argv.slice(2),
  captureMatrix: RC16_CAPTURE_MATRIX,
  collectMetrics,
  validateCaptureMetrics,
  validateCapturePixels
}).catch(reportCaptureFailure)
