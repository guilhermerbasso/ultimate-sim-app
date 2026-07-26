import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reportCaptureFailure, runRaceconCapture } from "./racecon-capture-shared.mjs"
import { RC08_CAPTURE_MATRIX, RC08_SPEC, validateCaptureMetrics, validateCapturePixels } from "./racecon-rc08-capture-lib.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, "..")

/**
 * Only the RC-08 DOM contract lives here. The viewport matrix, the readiness gate, the shared
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

      // Zone elements
      const bannerEl   = root.querySelector('[data-testid="rc08-banner"]')
      const aidsEl     = root.querySelector('[data-testid="rc08-aids"]')
      const ribbonEl   = root.querySelector('[data-testid="rc08-ribbon"]')
      const paceEl     = root.querySelector('[data-testid="rc08-pace"]')
      const tireEl     = root.querySelector('[data-testid="rc08-tire"]')

      // Banner outputs
      const gripSourceEl  = root.querySelector('[data-testid="rc08-grip-source"]')
      const weatherFeedEl = root.querySelector('[data-testid="rc08-weather-feed"]')

      // Pace outputs
      const gearEl  = root.querySelector('[data-testid="rc08-gear"]')
      const deltaEl = root.querySelector('[data-testid="rc08-delta"]')
      const speedEl = root.querySelector('[data-testid="rc08-speed"]')

      // Aids outputs
      const tcEl    = root.querySelector('[data-testid="rc08-tc"]')
      const absEl   = root.querySelector('[data-testid="rc08-abs"]')
      const biasEl  = root.querySelector('[data-testid="rc08-bias"]')
      const rainEl  = root.querySelector('[data-testid="rc08-rain"]')

      // Grip chip
      const gripEl  = root.querySelector('[data-testid="rc08-grip"]')

      // Corner outputs (the <output> elements with temperature values)
      const cornerPositions = ["FL", "FR", "RL", "RR"]
      const corners = cornerPositions.map((pos) => {
        const output = root.querySelector(`[data-testid="rc08-corner-${pos}"]`)
        return {
          position: pos,
          text: output?.textContent?.trim() ?? "",
          rect: measuredRect(output)
        }
      })

      // FL corner container (for cold alert detection)
      const flContainerEl = root.querySelector('[data-rc08-corner="FL"]')

      // App-only: crossover and timeline
      const timelineEl = root.querySelector('[data-testid="rc08-timeline"]')

      // Cold-tyre alert scope: the FL corner container rect and (in app layout) the FL
      // crossover cell rect. These are the only legitimate cyan surfaces in the cold-tyre state.
      const coldCrossoverEl = root.querySelector('[data-testid="rc08-crossover-cell"][data-rc08-crossover="COLD"]')
      const alertScope = [
        relativeRect(flContainerEl),
        relativeRect(coldCrossoverEl)
      ].filter(Boolean)

      return {
        ...common,
        nativeSize: root.querySelector(".rc08-dashboard")?.getAttribute("data-rc08-native-size") ?? null,
        gripSource:  gripSourceEl?.textContent?.trim()  ?? null,
        weatherFeed: weatherFeedEl?.textContent?.trim() ?? null,
        rainText:    rainEl?.textContent?.trim()         ?? null,
        absText:     absEl?.textContent?.trim()          ?? null,
        flCold:      flContainerEl?.getAttribute("data-rc08-cold") ?? null,
        timelinePresent: timelineEl !== null,
        corners,
        alertScope,
        ribbon: {
          rect: relativeRect(ribbonEl)
        },
        aids: {
          rect: relativeRect(aidsEl)
        },
        banner: {
          rect: relativeRect(bannerEl)
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
  spec: RC08_SPEC,
  appRoot,
  here,
  argv: process.argv.slice(2),
  captureMatrix: RC08_CAPTURE_MATRIX,
  collectMetrics,
  validateCaptureMetrics,
  validateCapturePixels
}).catch(reportCaptureFailure)
