import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reportCaptureFailure, runRaceconCapture } from "./racecon-capture-shared.mjs"
import { RC14_CAPTURE_MATRIX, RC14_SPEC, validateCaptureMetrics, validateCapturePixels } from "./racecon-rc14-capture-lib.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, "..")

/**
 * Only the RC-14 DOM contract lives here. The viewport matrix, the readiness gate, the shared
 * metric contract, the geometry helpers and the entire capture lifecycle come from
 * `racecon-capture-shared.mjs`.
 *
 * collectMetrics gathers everything that requires a live browser context:
 *   — the shared common metrics (viewport, geometry, zones, values, counted, forbidden, overflows)
 *   — per-silhouette-zone DOM attribute state (monitored/severity/token/pattern + relativeRect)
 *   — unmonitored zone rects for the green-density pixel proof
 *   — red scope rects for the critical-fault hue-scoping assertion
 *   — fault list system names and chip words for the unmonitored-never-listed assertion
 *   — oilTemp vital alerting for the vitalRangeThresholds omission assertion
 *   — engine text escape measurements for the RC-14/1 known defect documentation
 */
async function collectMetrics(page, spec, entry) {
  return page.locator(spec.rootSelector).evaluate(
    (root, input) => {
      const helpers = window.__rcMeasure(root)
      const common = window.__rcCommon(root, input.spec, helpers)
      const { relativeRect, textRect } = helpers

      // ── silhouette zone DOM state ───────────────────────────────────────────────────────────
      const silhouettePanel = root.querySelector('[data-testid="rc14-panel-carSilhouette"]')

      const zoneStates = Array.from(root.querySelectorAll('[data-testid="rc14-zone"]')).map(
        (g) => ({
          id: g.getAttribute('data-rc14-zone-id'),
          monitored: g.getAttribute('data-rc14-zone-monitored') === 'true',
          severity: g.getAttribute('data-rc14-zone-severity'),
          token: g.getAttribute('data-rc14-zone-token'),
          pattern: g.getAttribute('data-rc14-zone-pattern'),
          rect: relativeRect(g)
        })
      )
      const silhouetteZonesAttr = silhouettePanel
        ? silhouettePanel.getAttribute('data-rc14-zones')
        : null
      const silhouetteUnmonitoredAttr = silhouettePanel
        ? silhouettePanel.getAttribute('data-rc14-unmonitored-zones')
        : null
      const unmonitoredNoticeText =
        root.querySelector('[data-testid="rc14-unmonitored-notice"]')?.textContent?.trim() ?? null

      // Rects of the six unmonitored zones for the green-density pixel proof.
      // SVG <g> getBoundingClientRect() gives the element's visual bounds in the viewport;
      // relativeRect() subtracts rootRect so coordinates match the screenshot pixel grid.
      const unmonitoredZoneRects = zoneStates
        .filter((z) => !z.monitored && z.rect && z.rect.width > 0 && z.rect.height > 0)
        .map((z) => z.rect)

      // ── fault list ─────────────────────────────────────────────────────────────────────────
      const faultSystemNames = Array.from(root.querySelectorAll('.rc14-fault-system'))
        .map((el) => el.textContent?.trim() ?? '')

      const faultChipWords = Array.from(root.querySelectorAll('[data-testid="rc14-fault-chip"]'))
        .map((el) => el.textContent?.trim() ?? '')

      // ── vital omissions ────────────────────────────────────────────────────────────────────
      // omission vitalRangeThresholds: oilTemp has no RC14_VITAL_RANGE entry and must never alert.
      const oilTempVitalAlerting =
        root
          .querySelector('[data-testid="rc14-vital"][data-rc14-vital="oilTemp"]')
          ?.getAttribute('data-rc14-vital-alerting') ?? null

      // ── red scope rects for hue-scoping assertion ──────────────────────────────────────────
      // In critical-fault state the red pixels must fall within:
      //   • the decision panel section (non-app: decisionBanner; app: decisionCorners). The
      //     inner rc14-decision div is used for containment; the full PANEL is used for scope
      //     because `border-left-color: danger` on the fault row can render at the panel edge.
      //   • every fault row with severity="critical"
      //   • every silhouette zone with severity="critical"
      //   • every critical timeline mark (app-only; 2px solid danger left border)
      //   • any alerting vital (vitalRange not engaged on this fixture, so this list is empty)
      // In silent state these rects are unused (red is asserted absent, not scoped).
      const criticalFaultRowRects = Array.from(
        root.querySelectorAll('[data-testid="rc14-fault-row"][data-rc14-severity="critical"]')
      )
        .map((el) => relativeRect(el))
        .filter(Boolean)

      // Fault list panel — the border-left of the critical row is always within the panel, but
      // collect the panel rect too so the 1px border-left on the panel itself is covered.
      const faultListPanelRect = relativeRect(root.querySelector('[data-testid="rc14-panel-faultList"]'))

      const criticalZoneRects = Array.from(
        root.querySelectorAll('[data-testid="rc14-zone"][data-rc14-zone-severity="critical"]')
      ).map((g) => {
        // Use the fill <rect> child for the bounding box — the <g> container includes the <text>
        // element whose ink bounds can extend outside the fill area in some Chromium versions.
        const fillRect = g.querySelector('.rc14-zone-rect')
        return relativeRect(fillRect ?? g)
      }).filter(Boolean)

      // Silhouette panel rect: the critical ENG zone fill (crosshatch over danger red) renders
      // across the full zone rect in screen coordinates, but the SVG <g> getBoundingClientRect
      // in Playwright headless Chromium returns bounds that may differ from the actual painted
      // pixel area due to how the crosshatch SVG pattern tiles at subpixel positions. The panel
      // rect covers the entire silhouette panel (320×300 at 800x480, 320×340 at 1024x600) and
      // is the correct "owner" of all zone fill pixels — no zone can paint outside its panel.
      const silhouettePanelRect = relativeRect(root.querySelector('[data-testid="rc14-panel-carSilhouette"]'))

      const decisionEl = root.querySelector('[data-testid="rc14-decision"]')
      const decisionRect = relativeRect(decisionEl)

      // Collect the decision PANEL (not just the inner element) because the panel section itself
      // may carry the decision token styling from the outer container.
      const decisionBannerRect = relativeRect(root.querySelector('[data-testid="rc14-panel-decisionBanner"]'))
      const decisionCornersRect = relativeRect(root.querySelector('[data-testid="rc14-panel-decisionCorners"]'))

      // Timeline marks with severity="critical" (app layout only: 1024x600).
      // The mark has `border-left: 2px solid var(--rc14-danger)`.
      const criticalTimelineMarkRects = Array.from(
        root.querySelectorAll('[data-testid="rc14-timeline-mark"][data-rc14-timeline-severity="critical"]')
      )
        .map((el) => relativeRect(el))
        .filter(Boolean)

      // vitalRange needs 3000ms; fixture gives only 2600ms → no vital is alerting
      const alertingVitalRects = Array.from(
        root.querySelectorAll('[data-testid="rc14-vital"][data-rc14-vital-alerting="true"]')
      )
        .map((el) => relativeRect(el))
        .filter(Boolean)

      const redScopeRects = [
        decisionRect,
        decisionBannerRect,
        decisionCornersRect,
        faultListPanelRect,
        silhouettePanelRect,
        ...criticalFaultRowRects,
        ...criticalZoneRects,
        ...criticalTimelineMarkRects,
        ...alertingVitalRects
      ].filter((r) => r && r.width > 0 && r.height > 0)

      // ── DEFECT RC-14/1 measurements ────────────────────────────────────────────────────────
      // The ENGINE fault-system span overflows its flex column at 800x480 and 1024x600 in
      // critical-fault state (ACK button joins the row, collapsing the system-name column to 0).
      // Measured with getBoundingClientRect: how far does the painted text escape the fault-row
      // rect and the fault-list panel rect? (scrollWidth is a liar here — see notes.)
      const criticalFaultRow = root.querySelector(
        '[data-testid="rc14-fault-row"][data-rc14-severity="critical"]'
      )
      const criticalFaultRowRect = relativeRect(criticalFaultRow)
      const criticalFaultSystem = criticalFaultRow
        ? criticalFaultRow.querySelector('.rc14-fault-system')
        : null
      let engineTextEscapeFromRow = null
      let engineTextEscapeFromPanel = null
      if (criticalFaultSystem && criticalFaultRowRect) {
        const sysTextBounds = textRect(criticalFaultSystem)
        const faultListPanel = root.querySelector('[data-testid="rc14-panel-faultList"]')
        const faultListPanelRect = relativeRect(faultListPanel)
        if (sysTextBounds) {
          const textRight = sysTextBounds.left + sysTextBounds.width
          const rowRight = criticalFaultRowRect.left + criticalFaultRowRect.width
          engineTextEscapeFromRow = Number((textRight - rowRight).toFixed(2))
          if (faultListPanelRect) {
            const panelRight = faultListPanelRect.left + faultListPanelRect.width
            engineTextEscapeFromPanel = Number((textRight - panelRight).toFixed(2))
          }
        }
      }

      return {
        ...common,
        // Zone state
        zoneStates,
        silhouetteZonesAttr,
        silhouetteUnmonitoredAttr,
        unmonitoredNoticeText,
        unmonitoredZoneRects,
        // Fault list
        faultSystemNames,
        faultChipWords,
        // Vital omissions
        oilTempVitalAlerting,
        // Pixel audit inputs
        decisionRect,
        criticalFaultRowRects,
        criticalZoneRects,
        alertingVitalRects,
        redScopeRects,
        // Known defect measurements
        engineTextEscapeFromRow,
        engineTextEscapeFromPanel
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
  spec: RC14_SPEC,
  appRoot,
  here,
  argv: process.argv.slice(2),
  captureMatrix: RC14_CAPTURE_MATRIX,
  collectMetrics,
  validateCaptureMetrics,
  validateCapturePixels
}).catch(reportCaptureFailure)
