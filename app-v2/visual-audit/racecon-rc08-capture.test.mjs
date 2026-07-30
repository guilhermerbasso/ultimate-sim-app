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
  assertHueFamilyAbsent,
  assertHueFamilyPresent,
  assertHueFamilyScoped,
  auditHueFamilies,
  decodeCapturePng,
  expectedCompactModeForBox,
  expectedLayoutForBox,
  hueFamily,
  hueFamilyOfHex
} from "./racecon-capture-shared.mjs"
import {
  CAPTURE_SIZES,
  CAPTURE_STATES,
  RC08_ALERT_HEX,
  RC08_CAPTURE_MATRIX,
  RC08_CAUTION_HEX,
  RC08_CELL_COUNT,
  RC08_COLUMN_WIDTHS_APP,
  RC08_COLUMN_WIDTHS_NATIVE,
  RC08_CORNER_COUNT,
  RC08_CROSSOVER_CELL_COUNT,
  RC08_DANGER_HEX,
  RC08_ROW_COUNT,
  RC08_SPEC,
  RC08_TYPE_SCALE_PX,
  validateCaptureMetrics,
  validateCapturePixels
} from "./racecon-rc08-capture-lib.mjs"

function temporaryDirectory() {
  return mkdtempSync(join(tmpdir(), "racecon-rc08-capture-test-"))
}

// RC-08 canvas: #06090C = rgb(6, 9, 12)
const CANVAS_RGB    = [6, 9, 12]
// WET grip chip / delta bad tone: #2E86FF = rgb(46, 134, 255) → blue family
const BLUE_RGB      = [46, 134, 255]
// Cold-tyre alert: #5AB0E6 = rgb(90, 176, 230) → blue family (hue ≈203°, NOT cyan; same family as BLUE)
const CYAN_RGB      = [90, 176, 230]
// Danger red (aids-fault): #F0523E = rgb(240, 82, 62) → red family
const DANGER_RGB    = [240, 82, 62]
// Neutral gray — used for missingBlue synthetic PNGs (non-canvas, not blue, not danger, not amber)
const GRAY_RGB      = [128, 128, 128]

function rect(left, top, width, height) {
  return { left, top, width, height }
}

function measured(box) {
  return { ...box, layoutWidth: box.width, layoutHeight: box.height, scrollWidth: box.width, scrollHeight: box.height }
}

function zone(name, box, display = "block") {
  return { name, selector: `[data-testid="rc08-${name}"]`, present: true, display, ...measured(box) }
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
    color: "rgb(233, 241, 246)",
    display: "block"
  }
}

function owned(label, ownerBox, valueBox) {
  return { label, owner: ownerBox, ownerDisplay: "block", value: valueBox, valueDisplay: "block" }
}

function counted(label, selector, count) {
  return { label, selector, count }
}

/**
 * Four peer zones at the native 800×480 canvas. The banner sits at the top (full width);
 * the three columns are positioned side-by-side below it and must not overlap each other.
 * These proportions mirror the WET-regime packet 11.1 grammar (aids 37.5%, pace 23.8%,
 * tire 30.8%).
 */
function nativeZones(size) {
  const w = size.width
  const h = size.height
  const bannerH = Math.round(h * 0.08)
  const colTop  = bannerH
  const colH    = h - bannerH
  const aidsW   = Math.round(w * 0.375)
  const paceW   = Math.round(w * 0.238)
  const tireW   = Math.round(w * 0.308)
  return [
    zone("banner", rect(0, 0, w, bannerH)),
    zone("aids",   rect(0, colTop, aidsW, colH)),
    zone("pace",   rect(aidsW, colTop, paceW, colH)),
    zone("tire",   rect(aidsW + paceW, colTop, tireW, colH))
  ]
}

function nativeMetrics(state = "silent") {
  const size = CAPTURE_SIZES[0]   // 800×480 native
  const zones = nativeZones(size)
  const bannerZone = zones[0]
  const aidsZone   = zones[1]
  const paceZone   = zones[2]
  const tireZone   = zones[3]

  // Value element boxes inside their zones (approximate but geometrically contained)
  // Ribbon sits inside aids, at the top — must be declared before gripBox (which depends on it)
  const ribbonBox = rect(aidsZone.left, aidsZone.top, aidsZone.width, Math.round(aidsZone.height * 0.125))
  // gripBox must be INSIDE ribbonBox: top ≥ ribbon.top (38), bottom ≤ ribbon.bottom (93)
  const gripBox   = rect(aidsZone.left + 10, ribbonBox.top + 5, 80, 44)
  const tcBox     = rect(aidsZone.left + 4, aidsZone.top + ribbonBox.height + 4, 80, 48)
  const biasBox   = rect(aidsZone.left + 4, aidsZone.top + ribbonBox.height + 60, 80, 32)
  const gearBox   = rect(paceZone.left + 4, paceZone.top + 4, 60, 52)
  const deltaBox  = rect(paceZone.left + 4, paceZone.top + 80, 120, 52)
  const speedBox  = rect(paceZone.left + 4, paceZone.top + 160, 90, 32)
  const flBox     = rect(tireZone.left + 4, tireZone.top + 4, 80, 36)
  const frBox     = rect(tireZone.left + tireZone.width / 2, tireZone.top + 4, 80, 36)
  const rlBox     = rect(tireZone.left + 4, tireZone.top + tireZone.height / 2, 80, 36)
  const rrBox     = rect(tireZone.left + tireZone.width / 2, tireZone.top + tireZone.height / 2, 80, 36)

  const coldActive = state === "cold-tyre"
  // In the cold-tyre state, FL corner container rect and possibly a crossover cell rect
  const flContainerBox = rect(tireZone.left, tireZone.top, tireZone.width / 2, tireZone.height / 2)
  const alertScope = coldActive ? [flContainerBox] : []

  return {
    viewport: { width: size.width, height: size.height, dpr: 1 },
    page: { scrollWidth: size.width, clientWidth: size.width },
    root: rect(0, 0, size.width, size.height),
    shell: measured(rect(0, 0, size.width, size.height)),
    canvas: { ...measured(rect(0, 0, size.width, size.height)), transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
    dashboardElement: measured(rect(0, 0, size.width, size.height)),
    widget: measured(rect(0, 0, size.width, size.height)),
    dashboard: measured(rect(0, 0, size.width, size.height)),
    presetId: RC08_SPEC.presetId,
    expectedWidgetId: RC08_SPEC.widgetId,
    renderedWidgetId: RC08_SPEC.widgetId,
    dashboardWidth: "1024",
    dashboardHeight: "600",
    sourceKind: "live-telemetry",
    sourceIdentity: RC08_SPEC.sourceIdentity,
    captureState: state,
    captureSequence: "200",
    layout: "native",
    compactMode: null,
    bufferState: "accepted",
    contentWidth: String(size.width),
    contentHeight: String(size.height),
    stateAttributes: {
      alerts:          coldActive ? "active" : "silent",
      "alert-keys":    coldActive ? "COLD TYRES" : "",
      grip:            "WET",
      "grip-source":   "sensor",
      "grip-stale":    "false",
      regime:          "WET",
      weather:         "live",
      "column-widths": RC08_COLUMN_WIDTHS_NATIVE
    },
    zones,
    values: [
      value("grip",   '[data-testid="rc08-grip"]',       "WET",    gripBox,  RC08_TYPE_SCALE_PX.grip),
      value("delta",  '[data-testid="rc08-delta"]',      "+2.418", deltaBox, RC08_TYPE_SCALE_PX.delta),
      value("aid",    '[data-testid="rc08-tc"]',          "6",     tcBox,    RC08_TYPE_SCALE_PX.aid),
      value("corner", '[data-testid="rc08-corner-FL"]',  coldActive ? "41" : "63", flBox, RC08_TYPE_SCALE_PX.corner),
      value("speed",  '[data-testid="rc08-speed"]',      "128",    speedBox, RC08_TYPE_SCALE_PX.secondary),
      value("gear",   '[data-testid="rc08-gear"]',       "3",      gearBox,  RC08_TYPE_SCALE_PX.secondary),
      value("bias",   '[data-testid="rc08-bias"]',       "54.5",   biasBox,  RC08_TYPE_SCALE_PX.secondary)
    ],
    containment: [
      owned("gear",      paceZone, gearBox),
      owned("delta",     paceZone, deltaBox),
      owned("speed",     paceZone, speedBox),
      owned("FL corner", tireZone, flBox),
      owned("FR corner", tireZone, frBox),
      owned("grip chip", ribbonBox, gripBox),
      owned("TC",        aidsZone, tcBox),
      owned("ABS",       aidsZone, tcBox)
    ],
    forbidden: RC08_SPEC.forbidden.map(([label, selector]) => ({ label, selector, count: 0 })),
    counted: [
      counted("corner",          '[data-testid="rc08-corner"]',          RC08_CORNER_COUNT),
      counted("row",             '[data-testid="rc08-row"]',             RC08_ROW_COUNT),
      counted("cell",            '[data-testid="rc08-cell"]',            RC08_CELL_COUNT),
      counted("crossover cell",  '[data-testid="rc08-crossover-cell"]',  0),
      counted("timeline segment",'[data-testid="rc08-timeline-segment"]',0),
      counted("cold corner",     '[data-testid="rc08-corner-cold"]',     coldActive ? 1 : 0),
      counted("aids fault",      '[data-testid="rc08-aids-fault"]',      0)
    ],
    textOutputs: coldActive
      ? ["WET", "+2.418", "6", "4", "54.5", "UNAVAILABLE", "3", "128", "41", "61", "58", "62"]
      : ["WET", "+2.418", "6", "4", "54.5", "UNAVAILABLE", "3", "128", "63", "61", "58", "62"],
    leafTexts: coldActive
      ? ["WET", "SENSOR", "WEATHER FEED LIVE", "UNAVAILABLE", "+2.418", "128", "54.5", "41", "61", "58", "62", "6", "4", "3"]
      : ["WET", "SENSOR", "WEATHER FEED LIVE", "UNAVAILABLE", "+2.418", "128", "54.5", "63", "61", "58", "62", "6", "4", "3"],
    overflowLeaves: [],
    rootText: coldActive
      ? "WETSENSORWEATHER FEED LIVEUNAVAILABLE+2.418128UNAVAILABLE354.5641416158623"
      : "WETSENSORWEATHER FEED LIVEUNAVAILABLE+2.41812854.5641636158623",
    errorBoundaryCount: 0,
    unknownWidgetCount: 0,
    failures: [],
    pageErrors: [],
    consoleErrors: [],
    nativeSize: "800x480",
    gripSource:  "SENSOR",
    weatherFeed: "WEATHER FEED LIVE",
    rainText:    "UNAVAILABLE",
    absText:     "4",
    flCold:      coldActive ? "true" : null,
    timelinePresent: false,   // native layout: no timeline
    corners: [
      { position: "FL", text: coldActive ? "41" : "63", rect: measured(flBox) },
      { position: "FR", text: "61", rect: measured(frBox) },
      { position: "RL", text: "58", rect: measured(rlBox) },
      { position: "RR", text: "62", rect: measured(rrBox) }
    ],
    alertScope,
    ribbon: { rect: ribbonBox },
    aids:   { rect: aidsZone },
    banner: { rect: bannerZone }
  }
}

function nativeEntry(state = "silent") {
  return RC08_CAPTURE_MATRIX.find((entry) => entry.state === state && entry.size.width === 800)
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

// ── Matrix ─────────────────────────────────────────────────────────────────────────────────

test("the governed matrix covers every viewport in every governed state", () => {
  assert.equal(CAPTURE_SIZES.length, 6)
  assert.deepEqual([...CAPTURE_STATES], ["silent", "cold-tyre"])
  assert.equal(RC08_CAPTURE_MATRIX.length, CAPTURE_SIZES.length * CAPTURE_STATES.length)
  for (const entry of RC08_CAPTURE_MATRIX) {
    assert.equal(entry.size.layout, expectedLayoutForBox(entry.size.width, entry.size.height))
    assert.equal(entry.size.compactMode, expectedCompactModeForBox(entry.size.width, entry.size.height))
  }
  const cold = RC08_CAPTURE_MATRIX.filter((entry) => entry.state === "cold-tyre")
  assert.equal(cold.length, 6)
  for (const entry of cold) assert.deepEqual(entry.required[0], ["alerts", "active"])
  const silent = RC08_CAPTURE_MATRIX.filter((entry) => entry.state === "silent")
  for (const entry of silent) assert.deepEqual(entry.required[0], ["alerts", "silent"])
})

// ── Hue families ───────────────────────────────────────────────────────────────────────────

test("the cold-tyre alert and WET resting colours share the blue hue family", () => {
  // Both the WET grip chip (#2E86FF, hue ≈215°) and the cold-tyre alert (#5AB0E6, hue ≈203°)
  // classify as "blue" (200–255°). The pixel audit uses DANGER (red) and AMBER absence as the
  // hue-family-distinct guarantees, because blue cannot serve as an alert-only signal here.
  assert.equal(hueFamilyOfHex("#2e86ff"), "blue")
  assert.equal(hueFamilyOfHex(RC08_ALERT_HEX), "blue")   // #5AB0E6 at hue ≈203° → blue family
  assert.equal(hueFamilyOfHex(RC08_DANGER_HEX), "red")   // #F0523E → red family
  assert.equal(hueFamilyOfHex(RC08_CAUTION_HEX), "amber") // #F0B93A → amber family
  // Verify the raw channel values agree with the classification
  assert.equal(hueFamily(...BLUE_RGB), "blue")
  assert.equal(hueFamily(...CYAN_RGB), "blue")            // rgb(90,176,230) at hue ≈203° → blue family
  assert.equal(hueFamily(...DANGER_RGB), "red")
  assert.equal(hueFamily(...CANVAS_RGB), "neutral")
})

test("the normative type-scale delta override is 52 px, not the 28 px in the reference image", () => {
  assert.equal(RC08_TYPE_SCALE_PX.delta, 52)
  assert.notEqual(RC08_TYPE_SCALE_PX.delta, 28)
})

// ── Happy-path validations ─────────────────────────────────────────────────────────────────

test("a faithful native silent fixture validates and reports its type scale", () => {
  const audit = validateCaptureMetrics(nativeMetrics("silent"), nativeEntry("silent"))
  assert.deepEqual(audit.knownDefects, [])
  assert.deepEqual(audit.typeScale, [
    { label: "grip",   fontSize: RC08_TYPE_SCALE_PX.grip },
    { label: "delta",  fontSize: RC08_TYPE_SCALE_PX.delta },
    { label: "aid",    fontSize: RC08_TYPE_SCALE_PX.aid },
    { label: "corner", fontSize: RC08_TYPE_SCALE_PX.corner },
    { label: "speed",  fontSize: RC08_TYPE_SCALE_PX.secondary }
  ])
})

test("a faithful native cold-tyre fixture validates with the alert surfaces present", () => {
  validateCaptureMetrics(nativeMetrics("cold-tyre"), nativeEntry("cold-tyre"))
  // Missing cold marker fails
  assertRejects((m) => { m.flCold = null }, /FL corner must have data-rc08-cold="true"/, "cold-tyre")
  // Missing cold dot fails
  assertRejects((m) => { m.counted[5].count = 0 }, /must render at least one rc08-corner-cold/, "cold-tyre")
  // Missing alert-keys fails
  assertRejects((m) => { m.stateAttributes["alert-keys"] = "" }, /must contain 'COLD TYRES'/, "cold-tyre")
  // alerts=silent in cold-tyre state fails
  assertRejects((m) => { m.stateAttributes.alerts = "silent" }, /must latch data-rc08-alerts='active'/, "cold-tyre")
})

test("a tie anywhere in the type scale is a failure, not a pass", () => {
  // Tie: aid = corner (both 36 px)
  assertRejects((m) => { m.values[2].fontSize = RC08_TYPE_SCALE_PX.corner }, /type-scale hierarchy does not hold/)
  // Tie: grip = delta (both 52 px)
  assertRejects((m) => { m.values[0].fontSize = RC08_TYPE_SCALE_PX.delta }, /type-scale hierarchy does not hold/)
  // Tie: delta = aid (both 48 px)
  assertRejects((m) => { m.values[1].fontSize = RC08_TYPE_SCALE_PX.aid }, /type-scale hierarchy does not hold/)
})

// ── Zone geometry ──────────────────────────────────────────────────────────────────────────

test("overlapping zones fail closed while non-overlapping zones pass", () => {
  // Slide pace 50 px leftwards into aids territory (aids right=300, so pace.left=250 overlaps)
  // — aids and pace are side-by-side in X; a .top change alone creates no X intersection
  assertRejects((m) => { m.zones[2].left -= 50 }, /zone aids overlaps pace/)
  // Overlapping banner and aids also fails
  assertRejects((m) => { m.zones[0].height = 500 }, /zone banner overlaps/)
  // A clean non-overlapping layout validates
  const metrics = nativeMetrics()
  validateCaptureMetrics(metrics, nativeEntry())
})

test("an element that escapes its zone or the frame fails closed", () => {
  // Delta escaping pace zone (wide value)
  assertRejects((m) => { m.containment[1].value = rect(0, 0, 900, 52) }, /delta escapes its zone/)
  // Tire zone out of frame
  assertRejects((m) => { m.zones[3].top = 500 }, /tire is out of frame/)
  // Grip chip value not contained in root
  assertRejects((m) => { m.values[0].rect = measured(rect(900, 0, 80, 56)) }, /grip value is not contained/)
})

// ── Overflow ledger ────────────────────────────────────────────────────────────────────────

test("any unrecorded overflow fails closed (RC-08 has no waived overflow entries)", () => {
  // RC-08's knownDefects ledger is intentionally empty after fixing all three measured defects.
  // Any new overflow leaf is an unconditional hard failure — no waiver, no budget, no escape.
  assertRejects(
    (m) => {
      m.overflowLeaves = [
        { key: "rc08-gear", text: "3", fontSize: 32, whiteSpace: "nowrap",
          clientWidth: 50, scrollWidth: 80, overflowX: 30, textLeft: 10, textRight: 90 }
      ]
    },
    /paints 30px wider than its 50px box/
  )
})

test("rain row overflow fails closed (regression guard: UNAVAILABLE text must fit its column)", () => {
  // Injects an rc08-rain leaf as would happen if the label-rung font fix were reverted.
  // auditOverflowLeaves (shared) fires first; assertRainRowContained provides a named second guard.
  assertRejects(
    (m) => {
      m.overflowLeaves = [
        { key: "rc08-rain", text: "UNAVAILABLE", fontSize: 32, whiteSpace: "nowrap",
          clientWidth: 142, scrollWidth: 156, overflowX: 14, textLeft: 0, textRight: 156 }
      ]
    },
    /paints 14px wider than its 142px box/
  )
})

test("aids zone vertical overflow fails closed (regression guard: rows must flex-fill)", () => {
  // Inflates aids scrollHeight as would happen if fixed phone row heights were reintroduced.
  // auditZoneOverflow (shared) fires first; assertAidsZoneFit provides a named second guard.
  assertRejects(
    (m) => { m.zones[1].scrollHeight = m.zones[1].layoutHeight + 20 },
    /aids overflows its layout box/
  )
})

test("grip chip escape fails closed (regression guard: grip word must fit the ribbon)", () => {
  // Moves grip chip value above the ribbon boundary as would happen if the height factor
  // in rc08CompactZones were reduced back to 0.15.
  // assertZoneContainment (shared) fires first; assertGripChipFitsRibbon provides a named second guard.
  assertRejects(
    (m) => {
      const grip = m.containment[5]  // "grip chip" entry — ribbon owns grip
      grip.value = rect(grip.value.left, grip.owner.top - 4, grip.value.width, grip.value.height)
    },
    /grip chip escapes its zone/
  )
})

// ── Packet omissions ───────────────────────────────────────────────────────────────────────

test("reintroducing a shift-LED or RPM surface fails closed (omission: shiftArc)", () => {
  // The actual error includes "(omission: shiftArc)" in the label, so match with .*
  assertRejects((m) => { m.forbidden[0].count = 1 }, /shift-LED or rev-arc surface.*must not be rendered/)
})

test("a digit in the rain rate row fails closed (omission: rainRateNumeral)", () => {
  assertRejects((m) => { m.rainText = "12.4" }, /rain rate row reads.*instead of.*UNAVAILABLE/)
})

test("printing the wet-window bounds fails closed (omission: wetWindowReadout)", () => {
  assertRejects((m) => { m.leafTexts.push("50") }, /would reintroduce the omitted wet-window lower bound/)
  assertRejects((m) => { m.leafTexts.push("80") }, /would reintroduce the omitted wet-window upper bound/)
})

test("a digit in the grip chip fails closed (omission: gripPercentNumeral)", () => {
  assertRejects((m) => { m.values[0].text = "52" }, /grip chip contains a digit/)
})

// ── Modifier / state mismatches ────────────────────────────────────────────────────────────

test("a modifier that disagrees with the measured content box fails closed", () => {
  assertRejects((m) => { m.layout = "app" }, /layout modifier app does not match/)
  assertRejects((m) => { m.contentWidth = "801" }, /did not report its measured content box/)
  assertRejects((m) => { m.nativeSize = null }, /native content-box modifier/)
  assertRejects((m) => { m.bufferState = "duplicate" }, /accepted live frame/)
  assertRejects((m) => { m.sourceIdentity = "iracing:session:1:connection:0" }, /live telemetry source identity/)
  assertRejects((m) => { m.captureState = "cold-tyre" }, /rendered the cold-tyre scenario/)
})

test("incorrect column-widths attribute fails closed", () => {
  assertRejects((m) => { m.stateAttributes["column-widths"] = "30/30/30" }, /column-widths must be/)
})

test("silent state with active alerts or cold corners fails closed", () => {
  assertRejects((m) => { m.stateAttributes.alerts = "active" }, /silent state must have.*alerts.*silent/)
  assertRejects((m) => { m.stateAttributes["alert-keys"] = "COLD TYRES" }, /silent state must have empty alert-keys/)
  assertRejects((m) => { m.counted[5].count = 1 }, /silent state must have no rc08-corner-cold/)
})

// ── Pixel audit ────────────────────────────────────────────────────────────────────────────

function paintPng(size, background) {
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

function fillRect(image, box, rgb) {
  const x0 = Math.round(box.left)
  const y0 = Math.round(box.top)
  const x1 = Math.round(box.left + box.width)
  const y1 = Math.round(box.top + box.height)
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * image.width + x) * 4
      image.data[offset]     = rgb[0]
      image.data[offset + 1] = rgb[1]
      image.data[offset + 2] = rgb[2]
      image.data[offset + 3] = 255
    }
  }
}

/**
 * Synthetic capture PNG for RC-08 pixel audit tests.
 *
 * The cold-tyre alert surface is #5AB0E6 (hue ≈203°) — classified as "blue" by the shared
 * module, the SAME family as the WET resting palette (#2E86FF, hue ≈215°). Because blue
 * legitimately appears on the SILENT WET frame (grip chip, delta bad-tone), the pixel audit
 * cannot use the absent-on-silent / scoped-on-alert pattern for the cold-tyre alert.
 *
 * Instead, validateCapturePixels makes hue-family-distinct guarantees using DANGER (red,
 * #F0523E) and AMBER (#F0B93A) — families that are genuinely absent from all RC-08 frames in
 * this fixture — and verifies BLUE IS present (WET grip chip).
 *
 * The four mechanism-proof tests below use DANGER as the synthetic "alert colour" and call the
 * shared module hue-audit API directly to prove: zero alert pixels accepted, stray alert
 * pixel rejected, missing alert pixel rejected, and out-of-scope alert pixel rejected.
 */

// Synthetic scope rect for the mechanism-proof scoped-check test
const DANGER_SCOPE_RECT = rect(400, 200, 100, 50)

function capturePng(state, { strayDanger = false, blank = false, missingBlue = false } = {}) {
  const size = CAPTURE_SIZES[0]
  const image = paintPng(size, CANVAS_RGB)
  if (!blank) {
    if (missingBlue) {
      // Non-canvas pixels but no blue — proves the blue-present check catches the absence
      fillRect(image, rect(300, 40, 200, 200), GRAY_RGB)
    } else {
      // WET grip chip and delta bad-tone surfaces (blue family, always present)
      fillRect(image, rect(300, 40, 200, 200), BLUE_RGB)
    }
  }
  if (strayDanger) {
    // Simulates an unexpected aids-fault (danger/red) pixel outside any permitted zone
    fillRect(image, rect(2, 2, 8, 8), DANGER_RGB)
  }
  return PNG.sync.write(image)
}

function decodedPng(state, options = {}) {
  return decodeCapturePng(capturePng(state, options), CAPTURE_SIZES[0])
}

test("the pixel audit accepts silent and cold-tyre frames (blue present, no danger/amber)", () => {
  for (const state of ["silent", "cold-tyre"]) {
    const audit = validateCapturePixels(capturePng(state), nativeEntry(state), nativeMetrics(state))
    assert.ok(audit.hueFamilies.blue > 0, `blue pixels expected on the ${state} WET frame`)
    assert.equal(audit.hueFamilies.red, 0)
    assert.equal(audit.hueFamilies.amber, 0)
    assert.equal(audit.alertHueOutsideScope, 0)
    assert.equal(audit.alertHueFamily, "blue")   // confirmed: alert colour is in the blue family
  }
})

test("a blank frame fails closed", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { blank: true }), nativeEntry("silent"), nativeMetrics("silent")),
    /capture is blank/
  )
})

test("a frame without WET blue fails closed (WET grip chip must be visible)", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { missingBlue: true }), nativeEntry("silent"), nativeMetrics("silent")),
    /must be painted/
  )
})

// ── Hue-audit mechanism proof (using DANGER/red as the synthetic alert colour) ────────────────
// DANGER is genuinely absent from all RC-08 frames in this fixture, so we can demonstrate the
// full absent / present / scoped API by using it as the synthetic "alert" colour:
//   1. zero alert-hue pixels → accepted (absent check passes)
//   2. stray alert pixel → rejected (absent check throws)
//   3. alert expected but not found → rejected (present check throws)
//   4. alert pixel outside permitted scope → rejected (scoped check throws)

test("hue audit accepts a frame with zero danger pixels (mechanism: absent check)", () => {
  const audit = auditHueFamilies(decodedPng("silent"), {})
  assertHueFamilyAbsent(audit, "red", "RC-08 silent frame — no aids-fault in this fixture")
  // validateCapturePixels passes too (it also checks danger absent internally)
  validateCapturePixels(capturePng("silent"), nativeEntry("silent"), nativeMetrics("silent"))
})

test("hue audit rejects a stray danger pixel on any frame (mechanism: absent check)", () => {
  const auditWithDanger = auditHueFamilies(decodedPng("silent", { strayDanger: true }), {})
  assert.throws(
    () => assertHueFamilyAbsent(auditWithDanger, "red", "frame with unexpected aids-fault signal"),
    /must be absent/
  )
  // validateCapturePixels also catches the stray danger pixel
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { strayDanger: true }), nativeEntry("silent"), nativeMetrics("silent")),
    /must be absent/
  )
})

test("hue audit rejects when the alert hue is expected but absent (mechanism: present check)", () => {
  const audit = auditHueFamilies(decodedPng("silent"), {})
  // The frame has zero danger pixels — assertHueFamilyPresent must throw
  assert.throws(
    () => assertHueFamilyPresent(audit, "red", "frame that should have a danger alert but does not", 1),
    /must be painted/
  )
  // A frame with danger pixels satisfies the present check
  const auditWithDanger = auditHueFamilies(decodedPng("silent", { strayDanger: true }), {})
  assertHueFamilyPresent(auditWithDanger, "red", "frame with danger pixels", 1)  // no throw
})

test("hue audit rejects a danger pixel that falls outside its permitted scope (mechanism: scoped check)", () => {
  const size = CAPTURE_SIZES[0]

  // Frame: danger pixel at rect(2,2,8,8) — outside DANGER_SCOPE_RECT(400,200,100,50)
  const imageOutside = paintPng(size, CANVAS_RGB)
  fillRect(imageOutside, rect(300, 40, 200, 200), BLUE_RGB)
  fillRect(imageOutside, rect(2, 2, 8, 8), DANGER_RGB)
  const auditOutside = auditHueFamilies(
    decodeCapturePng(PNG.sync.write(imageOutside), size),
    { red: [DANGER_SCOPE_RECT] }
  )
  assert.throws(
    () => assertHueFamilyScoped(auditOutside, "red", "frame with out-of-scope danger pixel"),
    /fall outside/
  )

  // Frame: danger pixel INSIDE the scope — scoped check passes
  const imageInside = paintPng(size, CANVAS_RGB)
  fillRect(imageInside, rect(300, 40, 200, 200), BLUE_RGB)
  fillRect(imageInside, rect(DANGER_SCOPE_RECT.left + 2, DANGER_SCOPE_RECT.top + 2, 10, 10), DANGER_RGB)
  const auditInside = auditHueFamilies(
    decodeCapturePng(PNG.sync.write(imageInside), size),
    { red: [DANGER_SCOPE_RECT] }
  )
  assertHueFamilyScoped(auditInside, "red", "frame with in-scope danger pixel")  // no throw
})

// ── Disk-safety primitives ─────────────────────────────────────────────────────────────────

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
