import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reportCaptureFailure, runRaceconCapture } from "./racecon-capture-shared.mjs"
import {
  RC07_CAPTURE_MATRIX,
  RC07_SPEC,
  validateCaptureMetrics,
  validateCapturePixels
} from "./racecon-rc07-capture-lib.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, "..")

/**
 * Only the RC-07 DOM contract lives here. The viewport matrix, the readiness gate, the shared
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

      const radarPlot = root.querySelector('[data-testid="rc07-radar-plot"]')
      const radarZone = root.querySelector(".rc07-radar")
      const radarEdge = root.querySelector('[data-testid="rc07-radar-edge"]')
      const behindDir = root.querySelector('[data-testid="rc07-behind-direction"]')
      const aheadDir = root.querySelector('[data-testid="rc07-ahead-direction"]')
      const towerZone = root.querySelector(".rc07-tower")

      const blipElements = Array.from(root.querySelectorAll('[data-testid="rc07-blip"]'))

      // App-only self-strip cells (SPEED, FUEL, FLAG): present only at 1024x600.
      const appCellOf = (name) => {
        const el = root.querySelector(`.rc07-cell[data-rc07-cell="${name}"] output`)
        if (!el) return { present: false, text: null }
        return { present: true, text: el.textContent?.trim() ?? null }
      }

      // Type-scale: find the label font size by locating any leaf node whose text content is
      // exactly a zone header string. These elements use clamp(9px, 1.9cqw, 16px) per the spec.
      const LABEL_TEXTS = new Set(["FLAG", "BEHIND", "AHEAD", "RADAR", "GEAR", "POS", "DELTA", "NEAREST"])
      const labelEl = Array.from(root.querySelectorAll("*")).find(
        (el) => el.childElementCount === 0 && LABEL_TEXTS.has((el.textContent ?? "").trim())
      )

      // Class badges: .rc07-class-badge elements appear in both gap panels (from relatives) and
      // in tower rows (app only). Use the first one found.
      const classBadgeEl = root.querySelector(".rc07-class-badge")

      return {
        ...common,
        // Radar geometry
        radarPlotRect: relativeRect(radarPlot),
        radarZoneRect: relativeRect(radarZone),
        radarEdgeSide: radarEdge?.getAttribute("data-rc07-side") ?? null,
        // Direction glyphs (closingRateNumeral omission check)
        behindDirectionText: behindDir?.textContent?.trim() ?? null,
        aheadDirectionText: aheadDir?.textContent?.trim() ?? null,
        // Tower
        towerPresent: !!towerZone,
        towerDisplay: towerZone ? getComputedStyle(towerZone).display : "none",
        // Blips
        blips: blipElements.map((blip) => ({
          rank: Number.parseInt(blip.getAttribute("data-rc07-rank") ?? "-1", 10),
          radius: Number.parseFloat(blip.getAttribute("data-rc07-radius") ?? "NaN"),
          side: blip.getAttribute("data-rc07-side"),
          longitudinal: blip.getAttribute("data-rc07-longitudinal"),
          critical: blip.getAttribute("data-rc07-critical") === "true",
          rect: relativeRect(blip)
        })),
        // App-only cells
        appCells: {
          speed: appCellOf("speed"),
          fuel: appCellOf("fuel"),
          flag: appCellOf("flag")
        },
        // Type scale font sizes
        gapValueFontSize: (() => {
          const el = root.querySelector('[data-testid="rc07-behind-value"]')
          return el ? Number.parseFloat(getComputedStyle(el).fontSize) : 0
        })(),
        selfValueFontSize: (() => {
          // Use the gear cell output as the representative self-strip value (always present).
          const el = root.querySelector('.rc07-cell[data-rc07-cell="gear"] output')
          return el ? Number.parseFloat(getComputedStyle(el).fontSize) : 0
        })(),
        classBadgeFontSize: classBadgeEl
          ? Number.parseFloat(getComputedStyle(classBadgeEl).fontSize)
          : 0,
        labelFontSize: labelEl ? Number.parseFloat(getComputedStyle(labelEl).fontSize) : 0,
        // Proximity alert scope: the radar zone owns the radar-edge and critical blip outlines.
        alertScope: relativeRect(radarZone)
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
  spec: RC07_SPEC,
  appRoot,
  here,
  argv: process.argv.slice(2),
  captureMatrix: RC07_CAPTURE_MATRIX,
  collectMetrics,
  validateCaptureMetrics,
  validateCapturePixels
}).catch(reportCaptureFailure)
