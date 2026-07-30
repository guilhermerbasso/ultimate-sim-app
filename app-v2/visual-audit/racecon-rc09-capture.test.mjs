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
  assertHueFamilyDensityAtLeast,
  assertHueFamilyDensityBelow,
  assertHueFamilyPresent,
  auditHueFamilies,
  decodeCapturePng,
  expectedCompactModeForBox,
  expectedLayoutForBox,
  hueFamilyDensityInRects,
  hueFamilyOfHex
} from "./racecon-capture-shared.mjs"
import {
  CAPTURE_SIZES,
  CAPTURE_STATES,
  RC09_CAPTURE_MATRIX,
  RC09_CAUTION_HEX,
  RC09_DANGER_HEX,
  RC09_DISTANCE_TO_FINISH_TEXT,
  RC09_LED_COUNT,
  RC09_MINI_COUNT,
  RC09_NORMAL_HEX,
  RC09_NOTE_DISTANCE_TEXT,
  RC09_NOTE_GLYPH,
  RC09_NOTE_TEXT,
  RC09_SPEC,
  RC09_SPLIT_AMBER_ENGAGED_FLOOR,
  RC09_SPLIT_AMBER_RESTING_CEILING,
  RC09_STAGE_EMPTY_TEXT,
  RC09_TYPE_SCALE_STEPS,
  validateCaptureMetrics,
  validateCapturePixels
} from "./racecon-rc09-capture-lib.mjs"

function temporaryDirectory() {
  return mkdtempSync(join(tmpdir(), "racecon-rc09-capture-test-"))
}

// RC-09 canvas: #0C0A07 = rgb(12, 10, 7) — warm-end dark
const CANVAS_RGB    = [12, 10, 7]
// Normal green — resting shift arc: #57C06A = rgb(87, 192, 106) → green family
const GREEN_RGB     = [87, 192, 106]
// Caution amber — SPLIT LOSS surface: #EEA82F = rgb(238, 168, 47) → amber family
const AMBER_RGB     = [238, 168, 47]
// Neutral gray — missingGreen synthetic PNGs
const GRAY_RGB      = [128, 128, 128]

function rect(left, top, width, height) {
  return { left, top, width, height }
}

function measured(box) {
  return { ...box, layoutWidth: box.width, layoutHeight: box.height, scrollWidth: box.width, scrollHeight: box.height }
}

function zone(name, box, testId, display = "block") {
  return { name, selector: `[data-testid="${testId}"]`, present: true, display, ...measured(box) }
}

function value(label, selector, text, box, fontSize) {
  return {
    label, selector, present: true,
    rect: measured(box),
    textRect: box,
    text, fontSize,
    color: "rgb(246, 238, 223)",
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
 * Zone layout for the native 800×480 canvas.
 * Five non-overlapping peer zones; all fit inside the frame.
 */
function nativeZones() {
  return {
    timelineZone: rect(0, 0, 800, 80),
    clockZone:    rect(0, 80, 300, 220),
    splitZone:    rect(300, 80, 200, 220),
    noteZone:     rect(500, 80, 200, 220),
    supportZone:  rect(0, 300, 800, 120)
  }
}

function nativeMetrics(state = "silent") {
  const size = CAPTURE_SIZES[0]  // 800×480
  const isLoss = state === "split-loss"
  const { timelineZone, clockZone, splitZone, noteZone, supportZone } = nativeZones()

  const stageTimerBox       = rect(10, 90,  120, 60)
  const splitValueBox       = rect(310, 90, 100, 60)
  const splitArrowBox       = rect(310, 160, 40, 30)
  const noteValueBox        = rect(510, 90, 100, 50)
  const noteDistanceBox     = rect(510, 150, 80, 25)
  const distanceToFinishBox = rect(10, 5,  250, 50)
  const timelineEmptyBox    = rect(10, 35, 300, 30)
  const shiftArcBox         = rect(10, 310, 400, 80)
  const speedBox            = rect(420, 310, 80, 40)
  const gearBox             = rect(510, 310, 60, 40)
  const waterBox            = rect(580, 310, 80, 40)

  return {
    viewport: { width: 800, height: 480, dpr: 1 },
    page: { scrollWidth: 800, clientWidth: 800 },
    root: rect(0, 0, 800, 480),
    shell: measured(rect(0, 0, 800, 480)),
    canvas: { ...measured(rect(0, 0, 800, 480)), transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
    dashboardElement: measured(rect(0, 0, 800, 480)),
    widget: measured(rect(0, 0, 800, 480)),
    dashboard: measured(rect(0, 0, 800, 480)),
    presetId:          RC09_SPEC.presetId,
    expectedWidgetId:  RC09_SPEC.widgetId,
    renderedWidgetId:  RC09_SPEC.widgetId,
    dashboardWidth:    "1024",
    dashboardHeight:   "600",
    sourceKind:        "live-telemetry",
    sourceIdentity:    RC09_SPEC.sourceIdentity,
    captureState:      state,
    captureSequence:   "200",
    layout:            "native",
    compactMode:       null,
    bufferState:       "accepted",
    contentWidth:      "800",
    contentHeight:     "480",
    stateAttributes: {
      alerts:         isLoss ? "active" : "silent",
      "alert-keys":   isLoss ? "SPLIT LOSS" : "",
      roadbook:       "loaded",
      "stage-source": "unavailable",
      "split-state":  isLoss ? "loss" : "normal"
    },
    zones: [
      zone("timeline", timelineZone, "rc09-timeline"),
      zone("clock",    clockZone,    "rc09-clock"),
      zone("split",    splitZone,    "rc09-split"),
      zone("note",     noteZone,     "rc09-note"),
      zone("support",  supportZone,  "rc09-support")
    ],
    values: [
      value("stage timer",         '[data-testid="rc09-stage-timer"]',        "02:34.8",          stageTimerBox,       64),
      value("split value",         '[data-testid="rc09-split-value"]',        isLoss ? "+3.3" : "+0.4", splitValueBox, 48),
      value("note value",          '[data-testid="rc09-note-value"]',         RC09_NOTE_TEXT,     noteValueBox,        38),
      value("note distance",       '[data-testid="rc09-note-distance"]',      RC09_NOTE_DISTANCE_TEXT, noteDistanceBox, 22),
      value("distance to finish",  '[data-testid="rc09-distance-to-finish"]', RC09_DISTANCE_TO_FINISH_TEXT, distanceToFinishBox, 16),
      value("speed",               '[data-testid="rc09-speed"]',             "112",               speedBox,            28),
      value("gear",                '[data-testid="rc09-gear"]',              "4",                 gearBox,             28),
      value("water",               '[data-testid="rc09-water"]',             "88",                waterBox,            28)
    ],
    containment: [
      owned("stage timer",        clockZone,    stageTimerBox),
      owned("split value",        splitZone,    splitValueBox),
      owned("split arrow",        splitZone,    splitArrowBox),
      owned("note value",         noteZone,     noteValueBox),
      owned("note distance",      noteZone,     noteDistanceBox),
      owned("distance to finish", timelineZone, distanceToFinishBox),
      owned("stage empty line",   timelineZone, timelineEmptyBox),
      owned("shift arc",          supportZone,  shiftArcBox),
      owned("speed",              supportZone,  speedBox),
      owned("water",              supportZone,  waterBox)
    ],
    forbidden: RC09_SPEC.forbidden.map(([label, selector]) => ({ label, selector, count: 0 })),
    counted: [
      counted("led",              '[data-testid="rc09-led"]',                     RC09_LED_COUNT),
      counted("mini",             '[data-testid="rc09-mini"]',                    RC09_MINI_COUNT),
      counted("timeline fill",    '[data-testid="rc09-timeline-fill"]',            0),
      counted("timeline marker",  '[data-testid="rc09-timeline-marker"]',          0),
      counted("timeline empty",   '[data-testid="rc09-timeline-empty"]',           1),
      counted("note glyph",       '[data-testid="rc09-note-glyph"]',              1),
      counted("split loss",       '[data-testid="rc09-split-loss"]',              isLoss ? 1 : 0),
      counted("caution waypoint", '[data-testid="rc09-caution-waypoint"]',        0),
      counted("mechanical",       '[data-testid="rc09-mechanical"]',              0),
      counted("mini fault line",  '[data-testid^="rc09-mini-line"]',              0),
      counted("profile",          '[data-testid="rc09-profile"]',                 0),
      counted("profile bar",      '[data-testid="rc09-profile-bar"]',             0),
      counted("profile empty",    '[data-testid="rc09-profile-empty"]',           0)
    ],
    textOutputs: ["02:34.8", isLoss ? "+3.3" : "+0.4", RC09_NOTE_TEXT, RC09_NOTE_DISTANCE_TEXT, RC09_DISTANCE_TO_FINISH_TEXT, "112", "4", "88"],
    leafTexts: [
      "02:34.8", isLoss ? "+3.3" : "+0.4", RC09_NOTE_TEXT, RC09_NOTE_DISTANCE_TEXT,
      RC09_DISTANCE_TO_FINISH_TEXT, "112", "4", "88", RC09_STAGE_EMPTY_TEXT,
      ...(isLoss ? ["SPLIT LOSS"] : [])
    ],
    overflowLeaves: [],
    rootText: `02:34.8${isLoss ? "+3.3" : "+0.4"}${RC09_NOTE_TEXT}${RC09_NOTE_DISTANCE_TEXT}${RC09_DISTANCE_TO_FINISH_TEXT}112488${RC09_STAGE_EMPTY_TEXT}${isLoss ? "SPLIT LOSS" : ""}`,
    errorBoundaryCount: 0,
    unknownWidgetCount: 0,
    failures:      [],
    pageErrors:    [],
    consoleErrors: [],
    nativeSize:     "800x480",
    stageEmptyText: RC09_STAGE_EMPTY_TEXT,
    noteState:      "loaded",
    noteGlyph:      RC09_NOTE_GLYPH,
    cautionState:   "false",
    splitLoss:      isLoss ? "true" : "false",
    mechanicalState: "false",
    arcLit:          "3",
    ledTones:        Array(RC09_LED_COUNT).fill("normal"),
    profileBars:     null,
    splitScope:      [{ left: 300, top: 80, width: 200, height: 220 }]
  }
}

/**
 * Compact-phone metrics at either 393×759 or 412×867.
 * Both viewports use the same zone layout (scaled proportionally by width/height).
 * The fontSize values are chosen so that split.fontSize == note.fontSize (the recorded
 * compact-phone tie), which is what the RC09_TYPE_RANK_DEFECTS waiver covers.
 */
function compactPhoneMetrics(width, height, state = "silent") {
  const isLoss = state === "split-loss"
  const timelineZone = rect(0, 0, width, 50)
  const clockZone    = rect(0, 50,  width, 180)
  const splitZone    = rect(0, 230, width, 100)
  const noteZone     = rect(0, 330, width, 180)
  const supportZone  = rect(0, 510, width, 70)

  const stageTimerBox       = rect(5, 60, 100, 50)
  const splitValueBox       = rect(5, 240, width - 10, 60)
  const splitArrowBox       = rect(5, 300, 30, 20)
  const noteValueBox        = rect(5, 340, width - 10, 50)
  const noteDistanceBox     = rect(5, 400, 100, 25)
  const distanceToFinishBox = rect(5, 5, 250, 35)
  const timelineEmptyBox    = rect(5, 25, 200, 20)
  const shiftArcBox         = rect(5, 518, 200, 50)
  const speedBox            = rect(215, 518, 70, 40)
  const gearBox             = rect(290, 518, 50, 40)
  const waterBox            = rect(345, 518, 40, 40)

  // DEFECT RC-09/2: split and note have identical font size on compact-phone
  const SPLIT_FS = 35
  const NOTE_FS  = 35  // tie — waived at these viewports

  return {
    viewport: { width, height, dpr: 1 },
    page: { scrollWidth: width, clientWidth: width },
    root: rect(0, 0, width, height),
    shell: measured(rect(0, 0, width, height)),
    canvas: { ...measured(rect(0, 0, width, height)), transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
    dashboardElement: measured(rect(0, 0, width, height)),
    widget: measured(rect(0, 0, width, height)),
    dashboard: measured(rect(0, 0, width, height)),
    presetId:         RC09_SPEC.presetId,
    expectedWidgetId: RC09_SPEC.widgetId,
    renderedWidgetId: RC09_SPEC.widgetId,
    dashboardWidth:   "1024",
    dashboardHeight:  "600",
    sourceKind:       "live-telemetry",
    sourceIdentity:   RC09_SPEC.sourceIdentity,
    captureState:     state,
    captureSequence:  "200",
    layout:           "compact",
    compactMode:      "phone",
    bufferState:      "accepted",
    contentWidth:     String(width),
    contentHeight:    String(height),
    stateAttributes: {
      alerts:         isLoss ? "active" : "silent",
      "alert-keys":   isLoss ? "SPLIT LOSS" : "",
      roadbook:       "loaded",
      "stage-source": "unavailable",
      "split-state":  isLoss ? "loss" : "normal"
    },
    zones: [
      zone("timeline", timelineZone, "rc09-timeline"),
      zone("clock",    clockZone,    "rc09-clock"),
      zone("split",    splitZone,    "rc09-split"),
      zone("note",     noteZone,     "rc09-note"),
      zone("support",  supportZone,  "rc09-support")
    ],
    values: [
      value("stage timer",        '[data-testid="rc09-stage-timer"]',        "02:34.8",          stageTimerBox,  40),
      value("split value",        '[data-testid="rc09-split-value"]',        isLoss ? "+3.3" : "+0.4", splitValueBox, SPLIT_FS),
      value("note value",         '[data-testid="rc09-note-value"]',         RC09_NOTE_TEXT,     noteValueBox,   NOTE_FS),
      value("note distance",      '[data-testid="rc09-note-distance"]',      RC09_NOTE_DISTANCE_TEXT, noteDistanceBox, 14),
      value("distance to finish", '[data-testid="rc09-distance-to-finish"]', RC09_DISTANCE_TO_FINISH_TEXT, distanceToFinishBox, 10),
      value("speed",              '[data-testid="rc09-speed"]',             "112",               speedBox,       22),
      value("gear",               '[data-testid="rc09-gear"]',              "4",                 gearBox,        22),
      value("water",              '[data-testid="rc09-water"]',             "88",                waterBox,       22)
    ],
    containment: [
      owned("stage timer",        clockZone,    stageTimerBox),
      owned("split value",        splitZone,    splitValueBox),
      owned("split arrow",        splitZone,    splitArrowBox),
      owned("note value",         noteZone,     noteValueBox),
      owned("note distance",      noteZone,     noteDistanceBox),
      owned("distance to finish", timelineZone, distanceToFinishBox),
      owned("stage empty line",   timelineZone, timelineEmptyBox),
      owned("shift arc",          supportZone,  shiftArcBox),
      owned("speed",              supportZone,  speedBox),
      owned("water",              supportZone,  waterBox)
    ],
    forbidden: RC09_SPEC.forbidden.map(([label, selector]) => ({ label, selector, count: 0 })),
    counted: [
      counted("led",              '[data-testid="rc09-led"]',                     RC09_LED_COUNT),
      counted("mini",             '[data-testid="rc09-mini"]',                    RC09_MINI_COUNT),
      counted("timeline fill",    '[data-testid="rc09-timeline-fill"]',            0),
      counted("timeline marker",  '[data-testid="rc09-timeline-marker"]',          0),
      counted("timeline empty",   '[data-testid="rc09-timeline-empty"]',           1),
      counted("note glyph",       '[data-testid="rc09-note-glyph"]',              1),
      counted("split loss",       '[data-testid="rc09-split-loss"]',              isLoss ? 1 : 0),
      counted("caution waypoint", '[data-testid="rc09-caution-waypoint"]',        0),
      counted("mechanical",       '[data-testid="rc09-mechanical"]',              0),
      counted("mini fault line",  '[data-testid^="rc09-mini-line"]',              0),
      counted("profile",          '[data-testid="rc09-profile"]',                 0),
      counted("profile bar",      '[data-testid="rc09-profile-bar"]',             0),
      counted("profile empty",    '[data-testid="rc09-profile-empty"]',           0)
    ],
    textOutputs: ["02:34.8", isLoss ? "+3.3" : "+0.4", RC09_NOTE_TEXT, RC09_NOTE_DISTANCE_TEXT, RC09_DISTANCE_TO_FINISH_TEXT, "112", "4", "88"],
    leafTexts: [
      "02:34.8", isLoss ? "+3.3" : "+0.4", RC09_NOTE_TEXT, RC09_NOTE_DISTANCE_TEXT,
      RC09_DISTANCE_TO_FINISH_TEXT, "112", "4", "88", RC09_STAGE_EMPTY_TEXT,
      ...(isLoss ? ["SPLIT LOSS"] : [])
    ],
    overflowLeaves: [],
    rootText: `02:34.8${isLoss ? "+3.3" : "+0.4"}${RC09_NOTE_TEXT}${RC09_NOTE_DISTANCE_TEXT}${RC09_DISTANCE_TO_FINISH_TEXT}112488${RC09_STAGE_EMPTY_TEXT}${isLoss ? "SPLIT LOSS" : ""}`,
    errorBoundaryCount: 0,
    unknownWidgetCount: 0,
    failures:      [],
    pageErrors:    [],
    consoleErrors: [],
    nativeSize:     null,
    stageEmptyText: RC09_STAGE_EMPTY_TEXT,
    noteState:      "loaded",
    noteGlyph:      RC09_NOTE_GLYPH,
    cautionState:   "false",
    splitLoss:      isLoss ? "true" : "false",
    mechanicalState: "false",
    arcLit:          "3",
    ledTones:        Array(RC09_LED_COUNT).fill("normal"),
    profileBars:     null,
    splitScope:      [{ left: 0, top: 230, width, height: 100 }]
  }
}

function nativeEntry(state = "silent") {
  return RC09_CAPTURE_MATRIX.find((entry) => entry.state === state && entry.size.width === 800)
}

function compactPhoneEntry(width, state = "silent") {
  return RC09_CAPTURE_MATRIX.find((entry) => entry.state === state && entry.size.width === width)
}

function assertRejects(mutate, expected, state = "silent") {
  const metrics = nativeMetrics(state)
  mutate(metrics)
  assert.throws(
    () => validateCaptureMetrics(metrics, nativeEntry(state)),
    (error) => {
      assert.ok(error instanceof CaptureSafetyError, `expected CaptureSafetyError, received ${error}`)
      assert.match(error.message, expected)
      return true
    }
  )
}

// ── Matrix ─────────────────────────────────────────────────────────────────────────────────

test("the governed matrix covers every viewport in every governed state", () => {
  assert.equal(CAPTURE_SIZES.length, 6)
  assert.deepEqual([...CAPTURE_STATES], ["silent", "split-loss"])
  assert.equal(RC09_CAPTURE_MATRIX.length, CAPTURE_SIZES.length * CAPTURE_STATES.length)
  for (const entry of RC09_CAPTURE_MATRIX) {
    assert.equal(entry.size.layout, expectedLayoutForBox(entry.size.width, entry.size.height))
    assert.equal(entry.size.compactMode, expectedCompactModeForBox(entry.size.width, entry.size.height))
  }
  const loss = RC09_CAPTURE_MATRIX.filter((entry) => entry.state === "split-loss")
  assert.equal(loss.length, 6)
  for (const entry of loss) assert.deepEqual(entry.required[0], ["alerts", "active"])
  for (const entry of loss) assert.deepEqual(entry.required[1], ["roadbook", "loaded"])
  const silent = RC09_CAPTURE_MATRIX.filter((entry) => entry.state === "silent")
  for (const entry of silent) assert.deepEqual(entry.required[0], ["alerts", "silent"])
  for (const entry of silent) assert.deepEqual(entry.required[1], ["roadbook", "loaded"])
})

// ── Hue families ───────────────────────────────────────────────────────────────────────────

test("RC-09 colour tokens classify to the expected hue families", () => {
  assert.equal(hueFamilyOfHex(RC09_DANGER_HEX),  "red")    // #E7452F
  assert.equal(hueFamilyOfHex(RC09_CAUTION_HEX), "amber")  // #EEA82F
  assert.equal(hueFamilyOfHex(RC09_NORMAL_HEX),  "green")  // #57C06A
})

// ── Happy-path validations ─────────────────────────────────────────────────────────────────

test("a faithful native silent fixture validates and reports its type scale", () => {
  const audit = validateCaptureMetrics(nativeMetrics("silent"), nativeEntry("silent"))
  assert.deepEqual(audit.knownDefects, [])
  assert.deepEqual(audit.typeRankDefects, [])
  assert.deepEqual(audit.typeScale, [
    { label: "stage timer",         fontSize: 64 },
    { label: "split value",         fontSize: 48 },
    { label: "support value",       fontSize: 28 },
    { label: "note distance",       fontSize: 22 },
    { label: "distance to finish",  fontSize: 16 },
    { label: "note value",          fontSize: 38 }
  ])
})

test("a faithful native split-loss fixture validates with the alert surfaces present", () => {
  const audit = validateCaptureMetrics(nativeMetrics("split-loss"), nativeEntry("split-loss"))
  assert.deepEqual(audit.typeRankDefects, [])
  // Missing alert-keys fails
  assertRejects((m) => { m.stateAttributes["alert-keys"] = "" }, /must be exactly "SPLIT LOSS"/, "split-loss")
  // alerts=silent in split-loss state fails
  assertRejects((m) => { m.stateAttributes.alerts = "silent" }, /split-loss state must latch data-rc09-alerts/, "split-loss")
  // splitLoss=false fails
  assertRejects((m) => { m.splitLoss = "false" }, /must publish data-rc09-split-loss="true"/, "split-loss")
  // Missing split-loss element fails
  assertRejects((m) => { m.counted[6].count = 0 }, /must render exactly one SPLIT LOSS line/, "split-loss")
})

// ── Compact-phone rank collapse ─────────────────────────────────────────────────────────────

test("compact-phone split/note tie is accepted at 393x759 and 412x867 (recorded defect waiver)", () => {
  // Both fonts equal — covered by RC09_TYPE_RANK_DEFECTS waiver
  for (const [w, h] of [[393, 759], [412, 867]]) {
    const metrics = compactPhoneMetrics(w, h, "silent")
    const entry   = compactPhoneEntry(w, "silent")
    assert.doesNotThrow(
      () => validateCaptureMetrics(metrics, entry),
      `compact-phone tie at ${w}x${h} must be accepted`
    )
    const audit = validateCaptureMetrics(metrics, entry)
    assert.equal(audit.typeRankDefects.length, 1,
      `the rank defect must be recorded at ${w}x${h}`)
    assert.equal(audit.typeRankDefects[0].label, "split value over note value")
  }
})

test("compact-phone split/note tie is REJECTED at 800x480 — must not spread to native", () => {
  // Tie is NOT in the waiver for native; must fail
  assertRejects(
    (m) => {
      m.values[1].fontSize = 38  // split = note = 38 px
    },
    /type-scale hierarchy does not hold/
  )
})

test("a note cue LARGER than the split chip is rejected even at a recorded compact-phone viewport", () => {
  // Inversion (note > split) is never allowed, even where a tie is waived
  for (const [w, h] of [[393, 759], [412, 867]]) {
    const metrics = compactPhoneMetrics(w, h, "silent")
    const entry   = compactPhoneEntry(w, "silent")
    // Make note larger than split
    metrics.values[2].fontSize = 40  // note value
    metrics.values[1].fontSize = 35  // split value  (40 > 35 → inversion)
    assert.throws(
      () => validateCaptureMetrics(metrics, entry),
      (error) => {
        assert.ok(error instanceof CaptureSafetyError)
        assert.match(error.message, /is LARGER than the split chip/)
        return true
      },
      `note larger than split must be rejected at ${w}x${h}`
    )
  }
})

// ── Type scale ─────────────────────────────────────────────────────────────────────────────

test("a tie anywhere in the strict type-scale ladder is a failure", () => {
  // stage timer = split value (tie at top)
  assertRejects((m) => { m.values[0].fontSize = 48 }, /type-scale hierarchy does not hold/)
  // split value = support value (tie at step 2)
  assertRejects((m) => { m.values[1].fontSize = 28 }, /type-scale hierarchy does not hold/)
  // support value = note distance (tie at step 3)
  assertRejects((m) => { m.values[5].fontSize = 22 }, /type-scale hierarchy does not hold/)
})

// ── Zone geometry ──────────────────────────────────────────────────────────────────────────

test("overlapping zones fail closed while non-overlapping zones pass", () => {
  // Slide clock rightward so it enters the split zone (same top row)
  assertRejects((m) => { m.zones[1].left += 50; m.zones[1].width += 50 }, /zone clock overlaps split/)
  // Overlap timeline with clock
  assertRejects((m) => { m.zones[0].height = 300 }, /zone timeline overlaps/)
  // Clean layout validates
  validateCaptureMetrics(nativeMetrics(), nativeEntry())
})

test("an element that escapes its zone or the frame fails closed", () => {
  // split value escapes the root right edge
  assertRejects((m) => { m.values[1].rect = measured(rect(900, 90, 100, 60)) }, /split value value is not contained/)
  // timeline zone out of frame
  assertRejects((m) => { m.zones[0].top = 500 }, /timeline is out of frame/)
})

// ── Overflow ledger ────────────────────────────────────────────────────────────────────────

test("an unrecorded overflow fails; no overflow defects are registered for RC-09", () => {
  assertRejects(
    (m) => {
      m.overflowLeaves = [
        { key: "rc09-stage-timer", text: "02:34.8", fontSize: 64, whiteSpace: "nowrap",
          clientWidth: 80, scrollWidth: 120, overflowX: 40, textLeft: 5, textRight: 125 }
      ]
    },
    /paints 40px wider than its 80px box/
  )
})

// ── Zone-overflow ledger (RC-14-style) ─────────────────────────────────────────────────────

test("zone overflow ledger: an overflow LARGER than the split-chip budget is rejected", () => {
  // The split-chip overflow defect covers 1024x600/759x393/867x412.
  // Injecting a 14 px overflow at native (not a recorded viewport) must fail.
  assertRejects(
    (m) => {
      m.zones[2].scrollHeight = m.zones[2].layoutHeight + 14
    },
    /zone split overflows its layout box by/
  )
})

test("zone overflow ledger: a split overflow within budget at a recorded viewport is accepted", () => {
  // Use 1024x600 — a recorded viewport for this defect (budgetPx = 13)
  const entry = RC09_CAPTURE_MATRIX.find((e) => e.state === "silent" && e.size.width === 1024)
  assert.ok(entry, "1024x600 entry must exist")

  // Build minimal 1024x600 metrics with a 10 px split overflow (inside 13 px budget)
  const w = 1024, h = 600
  const splitZone1024 = { name: "split", selector: '[data-testid="rc09-split"]', present: true, display: "block",
    left: 300, top: 80, width: 200, height: 220, layoutWidth: 200, layoutHeight: 220,
    scrollWidth: 200, scrollHeight: 230  // 10 px overflow — within 13 px budget
  }
  const metrics = {
    viewport: { width: w, height: h, dpr: 1 },
    page: { scrollWidth: w, clientWidth: w },
    root: rect(0, 0, w, h),
    shell: measured(rect(0, 0, w, h)),
    canvas: { ...measured(rect(0, 0, w, h)), transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
    dashboardElement: measured(rect(0, 0, w, h)),
    widget: measured(rect(0, 0, w, h)),
    dashboard: measured(rect(0, 0, w, h)),
    presetId: RC09_SPEC.presetId, expectedWidgetId: RC09_SPEC.widgetId, renderedWidgetId: RC09_SPEC.widgetId,
    dashboardWidth: "1024", dashboardHeight: "600",
    sourceKind: "live-telemetry", sourceIdentity: RC09_SPEC.sourceIdentity,
    captureState: "silent", captureSequence: "200",
    layout: "app", compactMode: null,
    bufferState: "accepted", contentWidth: "1024", contentHeight: "600",
    stateAttributes: { alerts: "silent", "alert-keys": "", roadbook: "loaded", "stage-source": "unavailable", "split-state": "normal" },
    zones: [
      zone("timeline", rect(0, 0, w, 80),    "rc09-timeline"),
      zone("clock",    rect(0, 80, 300, 220), "rc09-clock"),
      splitZone1024,
      zone("note",     rect(600, 80, 200, 220), "rc09-note"),
      zone("support",  rect(0, 300, w, 120),    "rc09-support")
    ],
    values: [
      value("stage timer",        '[data-testid="rc09-stage-timer"]',        "02:34.8", rect(10, 90, 120, 60), 81.92),
      value("split value",        '[data-testid="rc09-split-value"]',        "+0.4",    rect(310, 90, 100, 230), 51.2),
      value("note value",         '[data-testid="rc09-note-value"]',         RC09_NOTE_TEXT, rect(610, 90, 100, 50), 38.4),
      value("note distance",      '[data-testid="rc09-note-distance"]',      RC09_NOTE_DISTANCE_TEXT, rect(610, 150, 80, 25), 30),
      value("distance to finish", '[data-testid="rc09-distance-to-finish"]', RC09_DISTANCE_TO_FINISH_TEXT, rect(10, 5, 250, 50), 18),
      value("speed",              '[data-testid="rc09-speed"]',             "112", rect(420, 310, 80, 40), 32),
      value("gear",               '[data-testid="rc09-gear"]',              "4",   rect(510, 310, 60, 40), 32),
      value("water",              '[data-testid="rc09-water"]',             "88",  rect(580, 310, 80, 40), 32)
    ],
    containment: [
      owned("stage timer",        rect(0, 80, 350, 220),    rect(10, 90, 120, 60)),
      owned("split value",        rect(300, 80, 200, 220),  rect(310, 90, 100, 222)),  // 12px overflow ≤ 13px budget ✓
      owned("split arrow",        rect(300, 80, 200, 220),  rect(310, 160, 40, 30)),
      owned("note value",         rect(600, 80, 200, 220),  rect(610, 90, 100, 50)),
      owned("note distance",      rect(600, 80, 200, 220),  rect(610, 150, 80, 25)),
      owned("distance to finish", rect(0, 0, w, 80),        rect(10, 5, 250, 50)),
      owned("stage empty line",   rect(0, 0, w, 80),        rect(10, 35, 300, 30)),
      owned("shift arc",          rect(0, 300, w, 120),     rect(10, 310, 400, 80)),
      owned("speed",              rect(0, 300, w, 120),     rect(420, 310, 80, 40)),
      owned("water",              rect(0, 300, w, 120),     rect(580, 310, 80, 40))
    ],
    forbidden: RC09_SPEC.forbidden.map(([label, selector]) => ({ label, selector, count: 0 })),
    counted: [
      counted("led", '[data-testid="rc09-led"]', RC09_LED_COUNT),
      counted("mini", '[data-testid="rc09-mini"]', RC09_MINI_COUNT),
      counted("timeline fill", '[data-testid="rc09-timeline-fill"]', 0),
      counted("timeline marker", '[data-testid="rc09-timeline-marker"]', 0),
      counted("timeline empty", '[data-testid="rc09-timeline-empty"]', 1),
      counted("note glyph", '[data-testid="rc09-note-glyph"]', 1),
      counted("split loss", '[data-testid="rc09-split-loss"]', 0),
      counted("caution waypoint", '[data-testid="rc09-caution-waypoint"]', 0),
      counted("mechanical", '[data-testid="rc09-mechanical"]', 0),
      counted("mini fault line", '[data-testid^="rc09-mini-line"]', 0),
      counted("profile", '[data-testid="rc09-profile"]', 1),
      counted("profile bar", '[data-testid="rc09-profile-bar"]', 1),
      counted("profile empty", '[data-testid="rc09-profile-empty"]', 0)
    ],
    textOutputs: ["02:34.8", "+0.4", RC09_NOTE_TEXT, RC09_NOTE_DISTANCE_TEXT, RC09_DISTANCE_TO_FINISH_TEXT, "112", "4", "88"],
    leafTexts: ["02:34.8", "+0.4", RC09_NOTE_TEXT, RC09_NOTE_DISTANCE_TEXT, RC09_DISTANCE_TO_FINISH_TEXT, "112", "4", "88", RC09_STAGE_EMPTY_TEXT],
    overflowLeaves: [],
    rootText: `02:34.8+0.4${RC09_NOTE_TEXT}${RC09_NOTE_DISTANCE_TEXT}${RC09_DISTANCE_TO_FINISH_TEXT}112488${RC09_STAGE_EMPTY_TEXT}`,
    errorBoundaryCount: 0, unknownWidgetCount: 0,
    failures: [], pageErrors: [], consoleErrors: [],
    nativeSize: null, stageEmptyText: RC09_STAGE_EMPTY_TEXT,
    noteState: "loaded", noteGlyph: RC09_NOTE_GLYPH, cautionState: "false",
    splitLoss: "false", mechanicalState: "false",
    arcLit: "3", ledTones: Array(RC09_LED_COUNT).fill("normal"),
    profileBars: "1",
    splitScope: [{ left: 300, top: 80, width: 200, height: 220 }]
  }
  const audit = validateCaptureMetrics(metrics, entry)
  // The recorded defect must appear in the audit report
  assert.ok(audit.zoneDefects.some((d) => d.zone === "split"),
    "the split zone overflow must be reported as a recorded defect")
})

// ── Packet omissions ───────────────────────────────────────────────────────────────────────

test("a digit in the distance-to-finish readout fails closed (omission: stageDistanceReadout)", () => {
  assertRejects((m) => { m.values[4].text = "12.4 KM" }, /distance to finish reads.*instead of.*TO FIN/)
})

test("a digit in the note distance fails closed (omission: noteDistanceReadout)", () => {
  assertRejects((m) => { m.values[3].text = "450 M" }, /note distance reads.*instead of.*--- M/)
})

test("a rendered timeline fill fails closed (omission: stageDistanceReadout)", () => {
  assertRejects((m) => { m.counted[2].count = 1 }, /travelled-fill element.*rendered with no stage-distance channel/)
})

test("a rendered timeline marker fails closed (omission: stageDistanceReadout)", () => {
  assertRejects((m) => { m.counted[3].count = 1 }, /stage marker.*rendered with no stage-distance channel/)
})

test("a fuel element fails closed (omission: fuelReadout)", () => {
  assertRejects((m) => { m.forbidden[0].count = 1 }, /must not be rendered/)
})

// ── Modifier / state mismatches ────────────────────────────────────────────────────────────

test("a modifier that disagrees with the measured content box fails closed", () => {
  assertRejects((m) => { m.layout = "app" }, /layout modifier app does not match/)
  assertRejects((m) => { m.contentWidth = "801" }, /did not report its measured content box/)
  assertRejects((m) => { m.nativeSize = null }, /native content-box modifier/)
})

test("a wrong preset or widget id fails closed", () => {
  assertRejects((m) => { m.presetId = "racecon_rc08_dash" }, /did not resolve the unmodified/)
  assertRejects((m) => { m.renderedWidgetId = "raceconRc08Dash" }, /did not resolve the unmodified/)
})

test("a non-accepted buffer state fails closed", () => {
  assertRejects((m) => { m.bufferState = "duplicate" }, /accepted live frame/)
})

test("a wrong capture state fails closed", () => {
  assertRejects((m) => { m.captureState = "split-loss" }, /rendered the split-loss scenario/)
})

test("silent state with active alerts or wrong split attributes fails closed", () => {
  assertRejects((m) => { m.stateAttributes.alerts = "active" }, /silent state must publish data-rc09-alerts/)
  assertRejects((m) => { m.stateAttributes["alert-keys"] = "SPLIT LOSS" }, /silent state must publish empty alert-keys/)
  assertRejects((m) => { m.splitLoss = "true" }, /silent split chip must publish data-rc09-split-loss="false"/)
  assertRejects((m) => { m.counted[6].count = 1 }, /silent frame must render no SPLIT LOSS line/)
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

const SPLIT_RECT = { left: 300, top: 80, width: 200, height: 220 }

function capturePng(state, {
  blank = false,
  missingGreen = false,
  strayRed = false,
  amberInChip = false,
  amberChipDensity = 0.1  // 10% when amberInChip — above the 2% floor
} = {}) {
  const size = CAPTURE_SIZES[0]
  const image = paintPng(size, CANVAS_RGB)
  if (!blank) {
    if (missingGreen) {
      fillRect(image, { left: 100, top: 50, width: 200, height: 200 }, GRAY_RGB)
    } else {
      // Shift arc — green family, always present
      fillRect(image, { left: 100, top: 300, width: 400, height: 80 }, GREEN_RGB)
    }
  }
  if (strayRed) {
    fillRect(image, { left: 2, top: 2, width: 8, height: 8 }, [240, 82, 62])
  }
  if (amberInChip) {
    // Paint amber pixels inside the split chip rect to simulate the split-loss surface
    const chipArea = SPLIT_RECT.width * SPLIT_RECT.height
    const targetPixels = Math.ceil(chipArea * amberChipDensity)
    // Fill a sub-rect that achieves the required density
    const fillW = Math.min(SPLIT_RECT.width, Math.ceil(Math.sqrt(targetPixels * (SPLIT_RECT.width / SPLIT_RECT.height))))
    const fillH = Math.ceil(targetPixels / fillW)
    fillRect(image, { left: SPLIT_RECT.left + 2, top: SPLIT_RECT.top + 2, width: fillW, height: fillH }, AMBER_RGB)
  }
  return PNG.sync.write(image)
}

function metricsWith(splitScope) {
  const m = nativeMetrics("silent")
  m.splitScope = splitScope
  return m
}

test("the pixel audit accepts silent frames (green present, red absent, amber density below ceiling)", () => {
  const buf = capturePng("silent")
  const audit = validateCapturePixels(buf, nativeEntry("silent"), nativeMetrics("silent"))
  assert.ok(audit.hueFamilies.green > 0, "green pixels expected on the silent frame (shift arc)")
  assert.equal(audit.hueFamilies.red, 0)
  assert.ok(audit.splitChipAmberDensity < RC09_SPLIT_AMBER_RESTING_CEILING * 100 + 0.1,
    "silent chip density must be below the resting ceiling")
})

test("the pixel audit accepts split-loss frames (amber density above engaged floor)", () => {
  // Build a split-loss frame with a filled amber chip (density ≈10%)
  const buf = capturePng("split-loss", { amberInChip: true, amberChipDensity: 0.1 })
  const metrics = nativeMetrics("split-loss")
  const audit = validateCapturePixels(buf, nativeEntry("split-loss"), metrics)
  assert.ok(audit.splitChipAmberDensity / 100 >= RC09_SPLIT_AMBER_ENGAGED_FLOOR - 0.001,
    "split-loss chip density must be above the engaged floor")
})

test("a blank frame fails closed", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { blank: true }), nativeEntry("silent"), nativeMetrics("silent")),
    /capture is blank/
  )
})

test("a frame without the resting shift-arc green fails closed", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { missingGreen: true }), nativeEntry("silent"), nativeMetrics("silent")),
    /must be painted/
  )
})

test("a red pixel on any frame fails closed (danger: caution-waypoint / mechanical fault absent)", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { strayRed: true }), nativeEntry("silent"), nativeMetrics("silent")),
    /must be absent/
  )
})

test("a silent frame with a filled amber chip fails closed (density above resting ceiling)", () => {
  // amberInChip: true but state = "silent" → density ≈10% > 1% ceiling → rejected
  const buf = capturePng("silent", { amberInChip: true, amberChipDensity: 0.1 })
  assert.throws(
    () => validateCapturePixels(buf, nativeEntry("silent"), nativeMetrics("silent")),
    /resting ceiling/
  )
})

test("an engaged frame with a bare chip fails closed (density below engaged floor)", () => {
  // No amber in chip, state = "split-loss" → density = 0% < 2% floor → rejected
  const buf = capturePng("split-loss")
  assert.throws(
    () => validateCapturePixels(buf, nativeEntry("split-loss"), nativeMetrics("split-loss")),
    /engaged floor/
  )
})

test("missing splitScope fails closed", () => {
  const buf = capturePng("silent")
  const metrics = nativeMetrics("silent")
  metrics.splitScope = []
  assert.throws(
    () => validateCapturePixels(buf, nativeEntry("silent"), metrics),
    /split chip rectangle/
  )
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
