import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reportCaptureFailure, runRaceconCapture } from "./racecon-capture-shared.mjs"
import {
  RC12_CAPTURE_MATRIX,
  RC12_SPEC,
  validateCaptureMetrics,
  validateCapturePixels
} from "./racecon-rc12-capture-lib.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, "..")

/**
 * Only the RC-12 DOM contract lives here. The viewport matrix, the readiness gate, the shared
 * metric contract, the geometry helpers and the entire capture lifecycle come from
 * `racecon-capture-shared.mjs`.
 */
async function collectMetrics(page, spec, entry) {
  return page.locator(spec.rootSelector).evaluate(
    (root, input) => {
      const helpers = window.__rcMeasure(root)
      const common = window.__rcCommon(root, input.spec, helpers)
      const { relativeRect } = helpers

      // ── Broadcast container (native-size attribute) ────────────────────────────
      const broadcastEl = root.querySelector(".rc12-broadcast")
      const nativeSize = broadcastEl?.getAttribute("data-rc12-native-size") ?? null

      // ── Fastest-lap tag ────────────────────────────────────────────────────────
      // The tag is a trigger-only element: it exists in the DOM only while the FASTEST LAP alert
      // is latched. The tag rect is needed for the pixel-audit cyan scope assertion.
      const tagEl = root.querySelector('[data-testid="rc12-tag"]')
      const tagRect = relativeRect(tagEl)
      const tagFontSize = tagEl ? Number.parseFloat(getComputedStyle(tagEl).fontSize) : null

      // ── Fastest-lap row ────────────────────────────────────────────────────────
      // The highlighted row is the other cyan surface; both rects are passed to the pixel audit.
      const fastestRowEl = root.querySelector('[data-rc12-row-fastest="true"]')
      const fastestRowRect = relativeRect(fastestRowEl)

      // Cyan scopes for `auditHueFamilies` in the pixel audit: only populated for the
      // fastest-lap state (both rects will be non-null when the alert is active). The silent
      // state collector will return an empty array, and `assertHueFamilyAbsent` proves no cyan
      // pixels exist, so the empty-scope argument is never consulted.
      const cyanScopes = [tagRect, fastestRowRect].filter(Boolean)

      // ── Gap-cell leaf texts ────────────────────────────────────────────────────
      // Collected here so that validateCaptureMetrics can assert the exact distribution of
      // numeral vs "--.-" values without repeating a querySelectorAll in node-land.
      const gapLeafTexts = Array.from(root.querySelectorAll('[data-testid="rc12-cell-gap"]')).map(
        (cell) => (cell.textContent ?? "").trim()
      )
      // A gap cell carries a numeral when fieldWideIntervalChannel supplies a measured value;
      // all other cells must read exactly "--.-". Count the numeral-bearing cells.
      const numeralGapCount = gapLeafTexts.filter((text) => /[0-9]/u.test(text)).length

      // ── Tag-escape geometry ────────────────────────────────────────────────────
      // Independently measure whether the tag's painted label text escapes the tag rect and/or
      // the board rect via getBoundingClientRect. The approved normative override
      // `fastestLapTagOverlap` documents an 8,000 px area overlap between the tag packet box
      // and the leaderboard band; the row columns stop at x=548, so no row text sits under
      // the tag. The measurement here confirms what the SHIPPED BUILD actually does.
      const boardEl = root.querySelector('[data-testid="rc12-board"]')
      const tagEscapeGeometry = (() => {
        if (!tagEl || !boardEl) return null
        const rootRect = root.getBoundingClientRect()
        const tag = tagEl.getBoundingClientRect()
        const board = boardEl.getBoundingClientRect()
        // Tag span rects (leaf children of the tag div).
        const tagChildren = Array.from(tagEl.querySelectorAll("span")).map((span) => {
          const r = span.getBoundingClientRect()
          return {
            text: (span.textContent ?? "").trim().slice(0, 32),
            left: r.left - rootRect.left,
            right: r.right - rootRect.left,
            width: r.width,
            clientWidth: span.clientWidth,
            scrollWidth: span.scrollWidth,
            overflowPx: span.scrollWidth - span.clientWidth
          }
        })
        return {
          tagLeft:      tag.left  - rootRect.left,
          tagRight:     tag.right - rootRect.left,
          tagTop:       tag.top   - rootRect.top,
          tagBottom:    tag.bottom - rootRect.top,
          tagWidth:     tag.width,
          tagHeight:    tag.height,
          boardLeft:    board.left  - rootRect.left,
          boardRight:   board.right - rootRect.left,
          boardTop:     board.top   - rootRect.top,
          boardBottom:  board.bottom - rootRect.top,
          tagEscapesBoard:      tag.right > board.right || tag.bottom > board.bottom,
          tagRightOvershoot:    Math.max(0, (tag.right - rootRect.left) - (board.right - rootRect.left)),
          tagBottomOvershoot:   Math.max(0, (tag.bottom - rootRect.top) - (board.bottom - rootRect.top)),
          children: tagChildren
        }
      })()

      return {
        ...common,
        nativeSize,
        tagFontSize,
        cyanScopes,
        gapLeafTexts,
        numeralGapCount,
        tagEscapeGeometry
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
  spec: RC12_SPEC,
  appRoot,
  here,
  argv: process.argv.slice(2),
  captureMatrix: RC12_CAPTURE_MATRIX,
  collectMetrics,
  validateCaptureMetrics,
  validateCapturePixels
}).catch(reportCaptureFailure)
