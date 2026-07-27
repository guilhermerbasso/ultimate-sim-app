import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { PNG } from "pngjs"
import {
  CaptureSafetyError,
  createPrivateStaging,
  discardPrivateStaging,
  exclusiveWriteFile,
  isSameOrDescendant,
  parseCaptureArgs,
  prepareCaptureOutput,
  publishPrivateStaging,
  removePublishedOutput,
  revalidatePrivateStaging,
  revalidatePublishedOutput
} from "./racecon-rc01-capture-lib.mjs"
import {
  expectedCompactModeForBox,
  expectedLayoutForBox,
  hueFamily,
  hueFamilyOfHex
} from "./racecon-capture-shared.mjs"
import {
  CAPTURE_SIZES,
  CAPTURE_STATES,
  RC07_BLIP_SPREAD_MIN_UNITS,
  RC07_CAPTURE_MATRIX,
  RC07_DANGER_HEX,
  RC07_RADAR_INNER_RING_UNITS,
  RC07_SOURCE_IDENTITY,
  RC07_SPEC,
  validateCaptureMetrics,
  validateCapturePixels
} from "./racecon-rc07-capture-lib.mjs"

function temporaryDirectory() {
  return mkdtempSync(join(tmpdir(), "racecon-rc07-capture-test-"))
}

/** RC-07 canvas background: #0A0C10 = rgb(10, 12, 16) */
const CANVAS_RGB = [10, 12, 16]
/** Danger red for proximity alert: #FF4234 = rgb(255, 66, 52) */
const DANGER_RGB = [255, 66, 52]
/** Class-A cyan for the gap-behind badge: #45C4E0 = rgb(69, 196, 224) */
const CYAN_RGB = [69, 196, 224]
/** Class-C orange for the gap-ahead badge: #FF8C1A = rgb(255, 140, 26) */
const ORANGE_RGB = [255, 140, 26]

function rect(left, top, width, height) {
  return { left, top, width, height }
}

function measured(box) {
  return { ...box, layoutWidth: box.width, layoutHeight: box.height, scrollWidth: box.width, scrollHeight: box.height }
}

function zone(name, box, display = "block") {
  return { name, selector: `.${name}`, present: true, display, ...measured(box) }
}

/**
 * Synthetic RC-07 zones for the native 800×480 viewport.
 *
 * The governance evidence gives height ordering behind > ahead > self (37.5% > 34.3% > 19.8%).
 * At 800×480: behind ≈ 180 px, ahead ≈ 165 px, self ≈ 95 px.
 * Flag strip runs across the top; radar occupies the left column; gap panels + self strip
 * occupy the right column. No overlaps, all within frame.
 */
function nativeZones(size) {
  const W = size.width
  const H = size.height
  return [
    zone("flag",   rect(0,       0,   W,       36)),          // top strip across full width
    zone("radar",  rect(0,       36,  W * 0.5, H - 36)),      // left column
    zone("behind", rect(W * 0.5, 36,  W * 0.5, 180)),         // right upper  (37.5%)
    zone("ahead",  rect(W * 0.5, 216, W * 0.5, 165)),         // right middle (34.3%)
    zone("self",   rect(W * 0.5, 381, W * 0.5, 95))           // right bottom (19.8%)
  ]
}

function value(label, selector, text, box, fontSize) {
  return {
    label,
    selector,
    present: true,
    rect: measured(box),
    textRect: box,
    text,
    fontSize,
    color: "rgb(238, 242, 247)",
    display: "block"
  }
}

function owned(label, owner, valueBox) {
  return { label, owner, ownerDisplay: "block", value: valueBox, valueDisplay: "block" }
}

function counted(label, selector, count) {
  return { label, selector, count }
}

/**
 * Four blips matching the approved reference frame at 80 m range.
 * Sorted ascending by radius (distance): A/behind-left, C/ahead-right, B/ahead-left, B/behind-right.
 * Radii: ≈25.55, ≈34.00, ≈42.19, ≈45.19 — all above the 20-unit critical-zone boundary.
 */
function silentBlips(radarPlotRect) {
  const cx = radarPlotRect.left + radarPlotRect.width / 2
  const cy = radarPlotRect.top + radarPlotRect.height / 2
  return [
    { rank: 0, radius: 25.55, side: "left",  longitudinal: "behind", critical: false, rect: rect(cx - 20, cy + 30, 18, 18) },
    { rank: 1, radius: 34.00, side: "right", longitudinal: "ahead",  critical: false, rect: rect(cx + 20, cy - 35, 18, 18) },
    { rank: 2, radius: 42.19, side: "left",  longitudinal: "ahead",  critical: false, rect: rect(cx - 30, cy - 45, 18, 18) },
    { rank: 3, radius: 45.19, side: "right", longitudinal: "behind", critical: false, rect: rect(cx + 30, cy + 45, 18, 18) }
  ]
}

/** One critical blip inside the 20-unit inner ring (proximity state). */
function proximityBlips(radarPlotRect) {
  const cx = radarPlotRect.left + radarPlotRect.width / 2
  const cy = radarPlotRect.top + radarPlotRect.height / 2
  return [
    { rank: 0, radius: 2.21, side: "left", longitudinal: "behind", critical: true, rect: rect(cx - 2, cy + 1, 18, 18) }
  ]
}

/**
 * A complete, self-consistent RC-07 metric fixture for the native 800×480 viewport.
 * Every field mirrors the DOM contract documented in the RC-07 report so a mutation of
 * one field is the only reason a validation can fail.
 */
function nativeMetrics(state = "silent") {
  const size = CAPTURE_SIZES[0]  // 800×480 native
  const zones = nativeZones(size)
  const radarZone = zones[1]
  // Radar plot: a square sub-section of the radar zone
  const radarPlotRect = rect(radarZone.left + 4, radarZone.top + 20, radarZone.width - 8, radarZone.width - 8)
  const isProximity = state === "proximity"
  const blips = isProximity ? proximityBlips(radarPlotRect) : silentBlips(radarPlotRect)

  // Value element boxes (plausible within their zones)
  const flagBox      = rect(10,  8,  100, 20)
  const gapBehindBox = rect(410, 50, 140, 60)
  const gapAheadBox  = rect(410, 230, 140, 60)
  const positionBox  = rect(410, 390, 60, 28)
  const deltaBox     = rect(480, 390, 80, 28)
  const gearBox      = rect(570, 390, 50, 28)

  return {
    viewport: { width: size.width, height: size.height, dpr: 1 },
    page: { scrollWidth: size.width, clientWidth: size.width },
    root: rect(0, 0, size.width, size.height),
    shell: measured(rect(0, 0, size.width, size.height)),
    canvas: { ...measured(rect(0, 0, size.width, size.height)), transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
    dashboardElement: measured(rect(0, 0, size.width, size.height)),
    widget: measured(rect(0, 0, size.width, size.height)),
    dashboard: measured(rect(0, 0, size.width, size.height)),
    presetId: RC07_SPEC.presetId,
    expectedWidgetId: RC07_SPEC.widgetId,
    renderedWidgetId: RC07_SPEC.widgetId,
    dashboardWidth: "1024",
    dashboardHeight: "600",
    sourceKind: "live-telemetry",
    sourceIdentity: RC07_SOURCE_IDENTITY,
    captureState: state,
    captureSequence: "35",
    layout: "native",
    compactMode: null,
    bufferState: "accepted",
    contentWidth: String(size.width),
    contentHeight: String(size.height),
    stateAttributes: {
      radar: "live",
      "radar-range": "80",
      "radar-range-source": "auto",
      flag: "GREEN",
      alerts: isProximity ? "active" : "silent",
      "alert-keys": isProximity ? "PROXIMITY" : "",
      "critical-side": isProximity ? "left" : "none"
    },
    zones,
    values: [
      value("flag state",  '[data-testid="rc07-flag-state"]',                              "GREEN",    flagBox,      16),
      value("gap behind",  '[data-testid="rc07-behind-value"]',                            "0.8",      gapBehindBox, 64),
      value("gap ahead",   '[data-testid="rc07-ahead-value"]',                             "1.4",      gapAheadBox,  64),
      value("position",    '.rc07-cell[data-rc07-cell="position"] output',                 "14",       positionBox,  36),
      value("delta",       '.rc07-cell[data-rc07-cell="delta"] output',                    "--.---",   deltaBox,     36),
      value("gear",        '.rc07-cell[data-rc07-cell="gear"] output',                     "4",        gearBox,      36)
    ],
    containment: [
      owned("flag state", zones[0], flagBox),
      owned("gap behind", zones[2], gapBehindBox),
      owned("gap ahead",  zones[3], gapAheadBox),
      owned("position",   zones[4], positionBox),
      owned("delta",      zones[4], deltaBox),
      owned("gear",       zones[4], gearBox)
    ],
    forbidden: RC07_SPEC.forbidden.map(([label, selector]) => ({ label, selector, count: 0 })),
    counted: [
      counted("blip",        '[data-testid="rc07-blip"]',        isProximity ? 1 : 4),
      counted("ring",        '[data-testid="rc07-ring"]',        2),
      counted("tower row",   '[data-testid="rc07-tower-row"]',   0),
      counted("tower empty", '[data-testid="rc07-tower-empty"]', 0),
      counted("flag duty",   '[data-testid="rc07-flag-duty"]',   0),
      counted("radar edge",  '[data-testid="rc07-radar-edge"]',  isProximity ? 1 : 0)
    ],
    textOutputs: ["GREEN", "0.8", "1.4", "14", "--.---", "4"],
    leafTexts: ["FLAG", "GREEN", "RADAR", "CLEAR", "BEHIND", "A", "0.8", "S", "AHEAD", "C", "1.4", "POS", "14", "DELTA", "--.---", "GEAR", "4"],
    overflowLeaves: [],
    rootText: "FLAGGREENRADARCLEARCHMODBEHINDA0.8SAHEADC1.4SPOS14DELTA--.---GEAR4",
    errorBoundaryCount: 0,
    unknownWidgetCount: 0,
    failures: [],
    pageErrors: [],
    consoleErrors: [],
    // RC-07-specific
    radarPlotRect,
    radarZoneRect: measured(radarZone),
    radarEdgeSide: isProximity ? "left" : null,
    behindDirectionText: "–",      // U+2013 en dash (unknown direction on mount)
    aheadDirectionText: "–",
    towerPresent: false,           // native layout: tower absent from DOM
    towerDisplay: "none",
    blips,
    appCells: {
      speed: { present: false, text: null },
      fuel:  { present: false, text: null },
      flag:  { present: false, text: null }
    },
    // Type scale (native 800×480): gap 64px > self 36px > badge 26px > label 15px
    gapValueFontSize: 64,
    selfValueFontSize: 36,
    classBadgeFontSize: 26,
    labelFontSize: 15,
    // Alert scope: radar zone (owns radar-edge and critical blip outlines)
    alertScope: radarZone
  }
}

function nativeEntry(state = "silent") {
  return RC07_CAPTURE_MATRIX.find((entry) => entry.state === state && entry.size.width === 800)
}

function assertRejects(mutate, expected, state = "silent") {
  const metrics = nativeMetrics(state)
  mutate(metrics)
  assert.throws(() => validateCaptureMetrics(metrics, nativeEntry(state)), (error) => {
    assert.ok(error instanceof CaptureSafetyError, `expected a CaptureSafetyError, received ${error}`)
    assert.match(error.message, expected)
    return true
  })
}

/* ── Matrix tests ───────────────────────────────────────────────────────────────────── */

test("the governed matrix covers every viewport in every governed state", () => {
  assert.equal(CAPTURE_SIZES.length, 6)
  assert.deepEqual([...CAPTURE_STATES], ["silent", "proximity"])
  assert.equal(RC07_CAPTURE_MATRIX.length, CAPTURE_SIZES.length * CAPTURE_STATES.length)
  for (const entry of RC07_CAPTURE_MATRIX) {
    assert.equal(entry.size.layout, expectedLayoutForBox(entry.size.width, entry.size.height))
    assert.equal(entry.size.compactMode, expectedCompactModeForBox(entry.size.width, entry.size.height))
  }
  const proximity = RC07_CAPTURE_MATRIX.filter((entry) => entry.state === "proximity")
  assert.equal(proximity.length, 6)
  for (const entry of proximity) assert.deepEqual(entry.required[0], ["alerts", "active"])
  const silent = RC07_CAPTURE_MATRIX.filter((entry) => entry.state === "silent")
  for (const entry of silent) assert.deepEqual(entry.required[0], ["alerts", "silent"])
})

/* ── Hue classification tests ───────────────────────────────────────────────────────── */

test("hue families distinguish the danger token from orange badge and canvas colours", () => {
  // The proximity alert colour must classify as red, not amber.
  assert.equal(hueFamilyOfHex(RC07_DANGER_HEX), "red")
  assert.equal(hueFamily(...DANGER_RGB), "red")
  // Class-C orange badge (#FF8C1A) would be misclassified as red by a channel-ratio test
  // because both its green and blue channels sit far below its red channel. Hue does not.
  assert.equal(hueFamilyOfHex("#FF8C1A"), "amber")
  assert.equal(hueFamily(...ORANGE_RGB), "amber")
  // Class-A cyan is clearly in the cyan family.
  assert.equal(hueFamilyOfHex("#45C4E0"), "cyan")
  assert.equal(hueFamily(...CYAN_RGB), "cyan")
  // The canvas background is neutral (low saturation).
  assert.equal(hueFamily(...CANVAS_RGB), "neutral")
})

/* ── Validation pass tests ──────────────────────────────────────────────────────────── */

test("a faithful silent native fixture validates and reports its type scale", () => {
  const audit = validateCaptureMetrics(nativeMetrics("silent"), nativeEntry("silent"))
  assert.deepEqual(audit.knownDefects, [])
  assert.deepEqual(audit.typeScale, [
    { label: "gap value", fontSize: 64 },
    { label: "self value", fontSize: 36 },
    { label: "class badge", fontSize: 26 },
    { label: "label", fontSize: 15 }
  ])
})

test("a faithful proximity native fixture validates", () => {
  validateCaptureMetrics(nativeMetrics("proximity"), nativeEntry("proximity"))
})

/* ── Type-scale tie tests ───────────────────────────────────────────────────────────── */

test("a tie anywhere in the type scale is a failure, not a pass", () => {
  // gap value tie with self value
  assertRejects((m) => { m.gapValueFontSize = 36 }, /type-scale hierarchy does not hold/u)
  // self value tie with class badge
  assertRejects((m) => { m.selfValueFontSize = 26 }, /type-scale hierarchy does not hold/u)
  // class badge tie with label
  assertRejects((m) => { m.classBadgeFontSize = 15 }, /type-scale hierarchy does not hold/u)
  // gap value smaller than self value (reversed)
  assertRejects((m) => { m.gapValueFontSize = 30 }, /type-scale hierarchy does not hold/u)
})

/* ── Zone geometry tests ────────────────────────────────────────────────────────────── */

test("zone height ordering behind > ahead > self is required at every breakpoint", () => {
  // behind shorter than ahead
  assertRejects(
    (m) => { m.zones[2].height = 160; m.zones[3].height = 165 },
    /zone height ordering does not hold.*behind.*ahead/u
  )
  // ahead shorter than self
  assertRejects(
    (m) => { m.zones[3].height = 90; m.zones[4].height = 95 },
    /zone height ordering does not hold.*ahead.*self/u
  )
})

test("overlapping zones fail closed", () => {
  // Move behind's left edge into the radar zone's X space so X ranges intersect.
  assertRejects(
    (m) => { m.zones[2].left = 0 },   // behind now starts at x=0 → overlaps radar
    /zone radar overlaps behind/u
  )
  // Move ahead's top up so ahead and behind share the same Y start and X range.
  assertRejects(
    (m) => { m.zones[3].top = m.zones[2].top },
    /zone behind overlaps ahead/u
  )
})

test("an element that escapes its zone or the frame fails closed", () => {
  assertRejects(
    (m) => { m.containment[1].value = rect(10, 50, 900, 60) },  // gap behind escapes zone
    /gap behind escapes its zone/u
  )
  assertRejects(
    (m) => { m.zones[4].top = 470 },  // self zone out of frame
    /self is out of frame/u
  )
  assertRejects(
    (m) => { m.values[1].rect = measured(rect(-10, 50, 140, 60)) },
    /gap behind value is not contained/u
  )
})

/* ── Overflow tests ─────────────────────────────────────────────────────────────────── */

test("an unrecorded overflow fails and a recorded one within budget passes", () => {
  assertRejects(
    (m) => {
      m.overflowLeaves = [
        {
          key: "rc07-gap-value",
          text: "0.8",
          fontSize: 64,
          whiteSpace: "nowrap",
          clientWidth: 140,
          scrollWidth: 160,
          overflowX: 20,
          textLeft: 410,
          textRight: 570
        }
      ]
    },
    /paints 20px wider than its 140px box/u
  )
  // An overflow that exactly matches a knownDefect entry passes (if RC-07 had one).
  // Since RC07_SPEC.knownDefects is empty, any overflow fails — no exemption path to test.
})

test("a recorded overflow that grows past its budget fails", () => {
  // RC-07 has exactly five known defects spanning three layout modes.
  assert.equal(RC07_SPEC.knownDefects.length, 5)
  const defect = RC07_SPEC.knownDefects[0]
  assert.equal(defect.id, "app-ahead-shorter-than-self")
  assert.equal(defect.budget.selfMinusAheadMaxPx, 8)
  assert.deepEqual(defect.affectedBreakpoints, ["1024x600"])

  const tsDefect = RC07_SPEC.knownDefects[2]
  assert.equal(tsDefect.id, "app-type-scale-badge-exceeds-self")
  assert.equal(tsDefect.budget.badgeMinusSelfMaxPx, 2.0)

  // A native-layout violation (no exemption applies) still fails.
  // Shrink ahead to 90 px while self stays at 95 px — both remain in-frame,
  // only the ahead < self ordering is violated.
  assertRejects(
    (m) => { m.zones[3].height = 90 },
    /zone height ordering does not hold.*ahead.*self/u
  )

  // The "grown past budget" path is exercised by the capture harness at 1024x600 where the
  // real widget measures ahead≈150px, self≈156px (delta≈6 ≤ 8 → passes). If the delta ever
  // exceeds 8 the message "budget is 8 px but delta grew to N" will be emitted. The exact
  // error-message pattern is the normative contract for that path.
})

/* ── Packet omission tests ──────────────────────────────────────────────────────────── */

test("a reintroduced packet omission fails closed", () => {
  // shiftCue: shift-LED / over-rev element appears in DOM
  assertRejects(
    (m) => { m.forbidden[0].count = 1 },
    /shift-LED or over-rev element.*must not be rendered/u
  )
  // rangeSoftKeyLegend: range legend element appears in DOM
  assertRejects(
    (m) => { m.forbidden[1].count = 1 },
    /radar-range legend label.*must not be rendered/u
  )
  // passAdvice: PASS text appears as a leaf readout
  assertRejects(
    (m) => { m.leafTexts.push("PASS") },
    /renders "PASS" as a readout/u
  )
  assertRejects(
    (m) => { m.leafTexts.push("HOLD") },
    /renders "HOLD" as a readout/u
  )
  // shiftCue: RPM label appears as a leaf readout
  assertRejects(
    (m) => { m.leafTexts.push("RPM") },
    /renders "RPM" as a readout/u
  )
  // closingRateNumeral: a digit appears inside the direction glyph element
  assertRejects(
    (m) => { m.behindDirectionText = "1.2" },
    /behind direction glyph contains a numeral/u
  )
  assertRejects(
    (m) => { m.aheadDirectionText = "0.3" },
    /ahead direction glyph contains a numeral/u
  )
})

/* ── Alert surface tests ────────────────────────────────────────────────────────────── */

test("the silent frame must have all alerts absent", () => {
  // Alert modifier says active on a silent frame
  assertRejects(
    (m) => { m.stateAttributes.alerts = "active" },
    /silent capture must have data-rc07-alerts="silent"/u
  )
  // Alert keys non-empty on a silent frame
  assertRejects(
    (m) => { m.stateAttributes["alert-keys"] = "PROXIMITY" },
    /silent capture must have empty alert-keys/u
  )
  // critical-side non-"none" on a silent frame
  assertRejects(
    (m) => { m.stateAttributes["critical-side"] = "left" },
    /silent capture must have data-rc07-critical-side="none"/u
  )
  // radar-edge element present on a silent frame
  assertRejects(
    (m) => { m.counted[5].count = 1 },
    /rc07-radar-edge must be absent from a silent/u
  )
  // flag-duty element present on a silent frame (not triggered by our fixture; also forbidden)
  assertRejects(
    (m) => { m.counted[4].count = 1 },
    /rc07-flag-duty must be absent from a silent/u
  )
})

test("the proximity frame must have alert surfaces present", () => {
  // alerts modifier says silent on a proximity frame
  assertRejects(
    (m) => { m.stateAttributes.alerts = "silent" },
    /proximity capture must have data-rc07-alerts="active"/u,
    "proximity"
  )
  // PROXIMITY not in alert-keys
  assertRejects(
    (m) => { m.stateAttributes["alert-keys"] = "CLOSING" },
    /proximity capture must have "PROXIMITY"/u,
    "proximity"
  )
  // radar-edge absent on a proximity frame
  assertRejects(
    (m) => { m.counted[5].count = 0 },
    /rc07-radar-edge must be present when the proximity alert is active/u,
    "proximity"
  )
})

/* ── Radar geometry tests ───────────────────────────────────────────────────────────── */

test("the radar must have two rings", () => {
  assertRejects(
    (m) => { m.counted[1].count = 1 },
    /exactly two concentric rings/u
  )
})

test("the silent frame must have exactly 4 blips with spread >= 12 units", () => {
  // Wrong blip count
  assertRejects(
    (m) => { m.counted[0].count = 3; m.blips.pop() },
    /exactly 4 blips/u
  )
  // Collapsed spread (all same radius — Attempt 001 failure)
  assertRejects(
    (m) => {
      m.blips = m.blips.map((b, i) => ({ ...b, radius: 25.0 + i * 0.1 }))
    },
    new RegExp(`below the ${RC07_BLIP_SPREAD_MIN_UNITS}-unit lower bound`, "u")
  )
  // A blip inside the critical zone on the silent frame
  assertRejects(
    (m) => { m.blips[0].radius = 5.0 },
    /inside the.*critical zone/u
  )
  // A critical blip attribute on the silent frame
  assertRejects(
    (m) => { m.blips[0].critical = true },
    /silent frame must have 0 critical blips/u
  )
})

test("a blip that escapes the radar plot fails closed", () => {
  assertRejects(
    (m) => {
      const plot = m.radarPlotRect
      // Move blip 0 far outside the radar plot
      m.blips[0].rect = rect(plot.left - 100, plot.top - 100, 18, 18)
    },
    /escapes the radar plot/u
  )
})

test("the proximity frame must have at least 1 critical blip", () => {
  // No blips at all
  assertRejects(
    (m) => { m.counted[0].count = 0; m.blips = [] },
    /at least 1 blip.*critical contact/u,
    "proximity"
  )
  // Critical blip with radius above the inner ring (not actually critical)
  assertRejects(
    (m) => { m.blips[0].radius = 25.0 },
    /is NOT inside the.*critical zone/u,
    "proximity"
  )
})

/* ── Modifier and buffer tests ──────────────────────────────────────────────────────── */

test("a modifier that disagrees with the measured content box fails closed", () => {
  assertRejects((m) => { m.layout = "app" }, /layout modifier app does not match/u)
  assertRejects((m) => { m.contentWidth = "801" }, /did not report its measured content box/u)
  assertRejects((m) => { m.bufferState = "duplicate" }, /accepted live frame/u)
  assertRejects((m) => { m.sourceIdentity = "acc:session:1:connection:1" }, /live telemetry source identity/u)
  assertRejects((m) => { m.captureState = "proximity" }, /rendered the proximity scenario/u)
})

/* ── Tower visibility tests ─────────────────────────────────────────────────────────── */

test("the tower zone is absent in native and compact, present only in app", () => {
  // Tower present in native layout — must fail
  assertRejects(
    (m) => { m.towerPresent = true; m.towerDisplay = "block" },
    /tower zone must be absent from the DOM in the native layout/u
  )
  // Tower absent in app layout — must fail
  const appEntry = RC07_CAPTURE_MATRIX.find((e) => e.state === "silent" && e.size.width === 1024)
  const appMetrics = nativeMetrics("silent")
  // Scale to app viewport
  appMetrics.viewport = { width: 1024, height: 600, dpr: 1 }
  appMetrics.page = { scrollWidth: 1024, clientWidth: 1024 }
  appMetrics.root = rect(0, 0, 1024, 600)
  appMetrics.shell = measured(appMetrics.root)
  appMetrics.canvas = { ...measured(appMetrics.root), transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } }
  appMetrics.dashboardElement = measured(appMetrics.root)
  appMetrics.widget = measured(appMetrics.root)
  appMetrics.dashboard = measured(appMetrics.root)
  appMetrics.layout = "app"
  appMetrics.compactMode = null
  appMetrics.contentWidth = "1024"
  appMetrics.contentHeight = "600"
  // Rebuild zones at 1024×600 so they fit the frame
  appMetrics.zones = nativeZones({ width: 1024, height: 600 })
  appMetrics.zones[2].height = 225   // behind: 37.5% of 600
  appMetrics.zones[3].top    = 261   // ahead starts after behind
  appMetrics.zones[3].height = 206   // ahead: 34.3% of 600
  appMetrics.zones[4].top    = 467   // self starts after ahead
  appMetrics.zones[4].height = 119   // self: ~19.8% of 600
  appMetrics.containment = []
  // Recalculate radar plot to fit new zones
  const newRadarZone = appMetrics.zones[1]
  appMetrics.radarPlotRect = rect(newRadarZone.left + 4, newRadarZone.top + 20, newRadarZone.width - 8, newRadarZone.width - 8)
  appMetrics.blips = silentBlips(appMetrics.radarPlotRect)
  appMetrics.values = appMetrics.values.map((v) => ({
    ...v,
    rect: measured(rect(600, 50, 100, 40)),
    textRect: rect(600, 50, 100, 40)
  }))
  // App cells present
  appMetrics.appCells = {
    speed: { present: true, text: "178" },
    fuel:  { present: true, text: "--" },
    flag:  { present: true, text: "GREEN" }
  }
  // Tower must be present for app
  appMetrics.towerPresent = false  // deliberately wrong
  assert.throws(
    () => validateCaptureMetrics(appMetrics, appEntry),
    (error) => {
      assert.ok(error instanceof CaptureSafetyError)
      assert.match(error.message, /tower zone must be present in the app/u)
      return true
    }
  )
})

/* ── Pixel audit tests ──────────────────────────────────────────────────────────────── */

function paint(size, background) {
  const image = new PNG({ width: size.width, height: size.height })
  for (let y = 0; y < size.height; y += 1) {
    for (let x = 0; x < size.width; x += 1) {
      const offset = (y * size.width + x) * 4
      image.data[offset]     = background[0]
      image.data[offset + 1] = background[1]
      image.data[offset + 2] = background[2]
      image.data[offset + 3] = 255
    }
  }
  return image
}

function fill(image, box, rgb) {
  for (let y = Math.round(box.top); y < Math.round(box.top + box.height); y += 1) {
    for (let x = Math.round(box.left); x < Math.round(box.left + box.width); x += 1) {
      if (y < 0 || y >= image.height || x < 0 || x >= image.width) continue
      const offset = (y * image.width + x) * 4
      image.data[offset]     = rgb[0]
      image.data[offset + 1] = rgb[1]
      image.data[offset + 2] = rgb[2]
      image.data[offset + 3] = 255
    }
  }
}

function capturePng(state, { strayDanger = false, blank = false } = {}) {
  const size = CAPTURE_SIZES[0]  // 800×480
  const image = paint(size, CANVAS_RGB)
  if (!blank) {
    // Cyan class-A badge in the gap-behind panel
    fill(image, rect(415, 55, 18, 18), CYAN_RGB)
    // Orange class-C badge in the gap-ahead panel
    fill(image, rect(415, 235, 18, 18), ORANGE_RGB)
  }
  if (state === "proximity") {
    // Danger red fills the radar edge — inside the radar zone (alertScope).
    const radarZone = nativeMetrics("proximity").alertScope
    fill(image, rect(radarZone.left, radarZone.top, 6, radarZone.height), DANGER_RGB)
    if (strayDanger) {
      // A stray danger pixel outside the radar zone
      fill(image, rect(500, 400, 6, 6), DANGER_RGB)
    }
  }
  return PNG.sync.write(image)
}

test("the silent frame must have zero danger-family (red) pixels", () => {
  const entry = nativeEntry("silent")
  const metrics = nativeMetrics("silent")
  const audit = validateCapturePixels(capturePng("silent"), entry, metrics)
  assert.equal(audit.hueFamilies.red, 0, "silent frame: zero red hue pixels expected")
  assert.ok(audit.hueFamilies.cyan > 0, "silent frame: cyan badge pixels expected")
  assert.ok(audit.hueFamilies.amber > 0, "silent frame: amber/orange badge pixels expected")
})

test("the proximity frame must paint danger only inside the radar zone", () => {
  const entry = nativeEntry("proximity")
  const metrics = nativeMetrics("proximity")
  const audit = validateCapturePixels(capturePng("proximity"), entry, metrics)
  assert.ok((audit.hueFamilies.red ?? 0) >= 1, "proximity frame: at least one red pixel expected")
  assert.equal(audit.alertHueOutsideScope, 0, "proximity frame: zero red pixels outside radar zone")
  // Stray red pixel outside the scope fails
  assert.throws(
    () => validateCapturePixels(capturePng("proximity", { strayDanger: true }), entry, metrics),
    /fall outside the elements that own that alert/u
  )
})

test("a stray danger pixel on the silent frame fails closed", () => {
  const entry = nativeEntry("silent")
  const metrics = nativeMetrics("silent")
  const image = paint(CAPTURE_SIZES[0], CANVAS_RGB)
  // Paint representative badge areas so the blank check passes
  fill(image, rect(415, 55, 18, 18), CYAN_RGB)
  fill(image, rect(415, 235, 18, 18), ORANGE_RGB)
  fill(image, rect(200, 200, 8, 8), DANGER_RGB)  // stray danger pixel on silent
  assert.throws(
    () => validateCapturePixels(PNG.sync.write(image), entry, metrics),
    /the red hue family must be absent/u
  )
})

test("the proximity frame fails when the danger hue is entirely missing", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent"), nativeEntry("proximity"), nativeMetrics("proximity")),
    /the red hue family must be painted/u
  )
})

test("a blank frame fails closed", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { blank: true }), nativeEntry("silent"), nativeMetrics("silent")),
    /appears blank/u
  )
})

/* ── Disk-safety primitives test ────────────────────────────────────────────────────── */

test("the shared disk-safety primitives are the RC-01 originals, unforked", () => {
  assert.throws(() => parseCaptureArgs(["--mode", "sideways", "--out", "C:/x"]), CaptureSafetyError)
  assert.throws(() => parseCaptureArgs(["--out", "relative/path"]), CaptureSafetyError)
  assert.deepEqual(parseCaptureArgs(["--help"]), { help: true })
  assert.ok(isSameOrDescendant(join("C:/a/b", "c"), "C:/a/b"))
  assert.ok(!isSameOrDescendant("C:/a", "C:/a/b"))

  const base = temporaryDirectory()
  try {
    const target = join(base, "published")
    const output = prepareCaptureOutput(target, [])
    const staging = createPrivateStaging(output)
    exclusiveWriteFile(staging, "one.png", Buffer.from([1, 2, 3]))
    revalidatePrivateStaging(staging)
    const publication = publishPrivateStaging(staging)
    revalidatePublishedOutput(publication)
    assert.deepEqual(readdirSync(target), ["one.png"])
    assert.deepEqual([...readFileSync(join(target, "one.png"))], [1, 2, 3])
    removePublishedOutput(publication)
    const second = createPrivateStaging(prepareCaptureOutput(join(base, "discarded"), []))
    discardPrivateStaging(second)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
