import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reportCaptureFailure, runRaceconCapture } from "./racecon-capture-shared.mjs"
import { RC15_CAPTURE_MATRIX, RC15_SPEC, validateCaptureMetrics, validateCapturePixels } from "./racecon-rc15-capture-lib.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, "..")

/**
 * Only the RC-15 DOM contract lives here. The viewport matrix, the readiness gate, the shared
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

      const beamEl = root.querySelector('[data-testid="rc15-panel-beam"]')
      const frontPanEl = root.querySelector('[data-testid="rc15-panel-front-pan"]')
      const rearPanEl = root.querySelector('[data-testid="rc15-panel-rear-pan"]')
      const biasEl = root.querySelector('[data-testid="rc15-panel-bias"]')
      const trendEl = root.querySelector('[data-testid="rc15-panel-brake-trend"]')

      // The brake-overheat alert paints danger inside the pan section that owns it — the border,
      // the lit cells and the BRAKE HOT badge are all descendants of that one section. Scoping the
      // hue audit to the hot pan is what turns "danger is present" into "danger is present ONLY
      // where the alert lives".
      const hotPanEls = Array.from(root.querySelectorAll('[data-rc15-pan-hot="true"]'))
      const alertScope = hotPanEls.map((element) => relativeRect(element)).filter(Boolean)

      return {
        ...common,
        nativeSize: root.querySelector(".rc15-dashboard")?.getAttribute("data-rc15-native-size") ?? null,
        trendPoints: trendEl?.getAttribute("data-rc15-trend-points") ?? null,
        panLit: {
          front: frontPanEl?.getAttribute("data-rc15-pan-lit") ?? null,
          rear: rearPanEl?.getAttribute("data-rc15-pan-lit") ?? null
        },
        panHot: {
          front: frontPanEl?.getAttribute("data-rc15-pan-hot") ?? null,
          rear: rearPanEl?.getAttribute("data-rc15-pan-hot") ?? null
        },
        panAvailable: {
          front: frontPanEl?.getAttribute("data-rc15-pan-available") ?? null,
          rear: rearPanEl?.getAttribute("data-rc15-pan-available") ?? null
        },
        biasDashed: biasEl?.getAttribute("data-rc15-bias-dashed") ?? null,
        alertScope,
        beam: { rect: relativeRect(beamEl) }
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
  spec: RC15_SPEC,
  appRoot,
  here,
  argv: process.argv.slice(2),
  captureMatrix: RC15_CAPTURE_MATRIX,
  collectMetrics,
  validateCaptureMetrics,
  validateCapturePixels
}).catch(reportCaptureFailure)
