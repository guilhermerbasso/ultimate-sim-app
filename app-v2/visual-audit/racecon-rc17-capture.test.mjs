import assert from "node:assert/strict"
import test from "node:test"
import { PNG } from "pngjs"
import {
  CaptureSafetyError,
  createPrivateStaging,
  discardPrivateStaging,
  parseCaptureArgs,
  prepareCaptureOutput
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
  RC17_ALONGSIDE_RELEASE_MS,
  RC17_CANVAS_RGBA,
  RC17_CAPTURE_MATRIX,
  RC17_CAUTION_HEX,
  RC17_DANGER_HEX,
  RC17_EXPECTED_VALUES,
  RC17_FAST_CLOSING_ENGAGE_MS,
  RC17_INFO_HEX,
  RC17_REV_FILL_TOLERANCE,
  RC17_SIGNATURE_HEX,
  RC17_SPEC,
  RC17_THREE_WIDE_ENGAGE_MS,
  RC17_TYPE_SCALE_PX,
  validateCaptureMetrics,
  validateCapturePixels
} from "./racecon-rc17-capture-lib.mjs"

/* ── Synthetic metric fixtures ───────────────────────────────────────────────────────────── */

/* Colour channel values used to paint synthetic PNGs.
   All four are distinct by hue so a hue audit can tell them apart; a channel-ratio test cannot. */
const CANVAS_RGB     = [11,  12,  16]    // #0B0C10 bg
const SIGNATURE_RGB  = [255, 90, 160]    // #FF5AA0 → magenta
const DANGER_RGB     = [255, 68,  54]    // #FF4436 → red
const CAUTION_RGB    = [255, 184, 46]    // #FFB82E → amber
const INFO_RGB       = [74,  156, 224]   // #4A9CE0 → blue

function rect(left, top, width, height) {
  return { left, top, width, height }
}

function measured(box) {
  return { ...box, layoutWidth: box.width, layoutHeight: box.height, scrollWidth: box.width, scrollHeight: box.height }
}

function zone(name, box, display = "block") {
  return { name, selector: `[data-testid="rc17-${name}"]`, present: true, display, ...measured(box) }
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
    color: "rgb(238, 240, 245)",
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
 * Native 800×480 zone geometry from RC17_NATIVE_ZONES (packet 11.3):
 *   flags  (40, 50, 200, 30) — the 200×30 band that side flags must fit inside.
 *   line   (40, 90, 200, 180)
 *   clock  (270, 50, 260, 260)
 *   closing(560, 90, 200, 180)
 *   pace   (40, 320, 720, 80)
 *   tertiary(40, 410, 720, 50)
 * No two zones overlap at this layout, verified by inspection.
 */
const NATIVE_FLAGS    = rect(40,  50,  200, 30)
const NATIVE_LINE_Z   = rect(40,  90,  200, 180)
const NATIVE_CLOCK    = rect(270, 50,  260, 260)
const NATIVE_CLOSING  = rect(560, 90,  200, 180)
const NATIVE_PACE     = rect(40,  320, 720, 80)
const NATIVE_TERTIARY = rect(40,  410, 720, 50)

/* Value sub-positions (within their zones, reasonable but not measured): */
const SPEED_BOX    = rect(55,  325, 80,  44)
const GAP_BOX      = rect(210, 325, 90,  44)
const POS_BOX      = rect(380, 325, 60,  44)
const RATE_BOX     = rect(570, 100, 90,  60)
const SIDE_BOX     = rect(570, 178, 60,  20)
const GEAR_BOX     = rect(55,  415, 35,  30)
const RPM_BOX      = rect(220, 415, 70,  30)
const WATER_BOX    = rect(400, 415, 50,  30)
const LINE_REC_BOX = rect(50,  100, 40,  50)
const FLAG_BOX     = rect(50,  52,  130, 22)

const RING_BOX = rect(275, 55, 250, 250)
const RING_CENTRE_X = 275 + 250 / 2   // = 400 → but clock zone centre = 270 + 260/2 = 400 ✓
const RING_CENTRE_Y = 55  + 250 / 2   // = 180 → clock zone centre = 50 + 260/2 = 180 ✓

const SILENT_LEAF_TEXTS = [
  "HIGH", "LOW",
  "--", "--", "--", "--.-", "--.-",
  "291", "4", "6400", "92",
  "SPEED KM/H", "GAP AHEAD", "POSITION",
  "CLOSING", "SIDE", "GEAR", "RPM", "WATER", "DEG C",
  "LINE", "LEFT", "RIGHT", "BEHIND", "HEADING"
]

const ALONGSIDE_LEAF_TEXTS = [
  ...SILENT_LEAF_TEXTS,
  "CAR LEFT"
]

const COMMON_TEXT_OUTPUTS = ["291", "4", "6400", "92"]

function makeContainment(state) {
  const items = [
    owned("DEG C unit",      NATIVE_TERTIARY, rect(440, 415, 48, 28)),
    owned("SPEED label cell", NATIVE_PACE,     rect(45, 322, 90, 50)),
    owned("speed value",      NATIVE_PACE,     SPEED_BOX),
    owned("gap value",        NATIVE_PACE,     GAP_BOX),
    owned("position value",   NATIVE_PACE,     POS_BOX),
    owned("closing rate",     NATIVE_CLOSING,  RATE_BOX),
    owned("closing side",     NATIVE_CLOSING,  SIDE_BOX),
    owned("gear value",       NATIVE_TERTIARY, GEAR_BOX),
    owned("water value",      NATIVE_TERTIARY, WATER_BOX),
    owned("clock ring",       NATIVE_CLOCK,    RING_BOX)
  ]
  // Side flag is absent in the silent state. The real browser's ownedMetric() returns null
  // when the value selector matches nothing, and the shared __rcCommon filter removes that
  // null entry before it reaches assertZoneContainment. We match that behaviour here.
  if (state === "car-alongside") {
    items.push(owned("side flag text", NATIVE_FLAGS, FLAG_BOX))
  }
  return items
}

function makeCounted(state) {
  const alongside = state === "car-alongside"
  return [
    counted("sector",           '[data-testid="rc17-sector"]',           3),
    counted("heading quadrant", '[data-testid="rc17-heading-quadrant"]', 1),
    counted("own car",          '[data-testid="rc17-own-car"]',          1),
    counted("line option",      '[data-testid="rc17-line-option"]',      2),
    counted("cell",             '[data-testid="rc17-cell"]',             9),
    counted("rev track",        '[data-testid="rc17-rev-track"]',        1),
    counted("rev fill",         '[data-testid="rc17-rev-fill"]',         1),
    counted("flag",             '[data-testid="rc17-flag"]',             alongside ? 1 : 0),
    counted("contact",          '[data-testid="rc17-contact"]',          alongside ? 1 : 0),
    counted("closing arrow",    '[data-testid="rc17-closing-arrow"]',    0),
    counted("three wide",       '[data-testid="rc17-three-wide"]',       0),
    counted("pack map",         '[data-testid="rc17-pack-map"]',         0),
    counted("pack field",       '[data-testid="rc17-pack-field"]',       0),
    counted("pack own",         '[data-testid="rc17-pack-own"]',         0),
    counted("lane",             '[data-testid="rc17-lane"]',             0),
    counted("lane empty",       '[data-testid="rc17-lane-empty"]',       0)
  ]
}

function makeValues(state) {
  const alongside = state === "car-alongside"
  const items = [
    value("speed",       '[data-testid="rc17-speed"]',        "291",   SPEED_BOX,    RC17_TYPE_SCALE_PX.pace),
    value("gap",         '[data-testid="rc17-gap"]',          "--.-",  GAP_BOX,      RC17_TYPE_SCALE_PX.pace),
    value("position",    '[data-testid="rc17-position"]',     "--",    POS_BOX,      RC17_TYPE_SCALE_PX.pace),
    value("closingRate", '[data-testid="rc17-closing-rate"]', "--.-",  RATE_BOX,     RC17_TYPE_SCALE_PX.closing),
    value("closingSide", '[data-testid="rc17-closing-side"]', "--",    SIDE_BOX,     RC17_TYPE_SCALE_PX.tertiary),
    value("gear",        '[data-testid="rc17-gear"]',         "4",     GEAR_BOX,     RC17_TYPE_SCALE_PX.tertiary),
    value("rpm",         '[data-testid="rc17-rpm"]',          "6400",  RPM_BOX,      RC17_TYPE_SCALE_PX.tertiary),
    value("water",       '[data-testid="rc17-water"]',        "92",    WATER_BOX,    RC17_TYPE_SCALE_PX.tertiary),
    value("lineRec",     'output[data-testid="rc17-line"]',   "--",    LINE_REC_BOX, RC17_TYPE_SCALE_PX.line)
  ]
  if (alongside) {
    items.push(value("flagText", '[data-testid="rc17-flag"]', "CAR LEFT", FLAG_BOX, RC17_TYPE_SCALE_PX.flag))
  }
  return items
}

function nativeMetrics(state = "silent", overrides = {}) {
  const size = CAPTURE_SIZES[0]  // 800×480
  const alongside = state === "car-alongside"

  const base = {
    viewport: { width: size.width, height: size.height, dpr: 1 },
    page: { scrollWidth: size.width, clientWidth: size.width },
    root: rect(0, 0, size.width, size.height),
    shell: measured(rect(0, 0, size.width, size.height)),
    canvas: {
      ...measured(rect(0, 0, size.width, size.height)),
      transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
    },
    dashboardElement: measured(rect(0, 0, size.width, size.height)),
    widget: measured(rect(0, 0, size.width, size.height)),
    dashboard: measured(rect(0, 0, size.width, size.height)),
    presetId:          RC17_SPEC.presetId,
    expectedWidgetId:  RC17_SPEC.widgetId,
    renderedWidgetId:  RC17_SPEC.widgetId,
    dashboardWidth:    "1024",
    dashboardHeight:   "600",
    sourceKind:        "live-telemetry",
    sourceIdentity:    RC17_SPEC.sourceIdentity,
    captureState:      state,
    captureSequence:   "23",
    layout:            "native",
    compactMode:       null,
    bufferState:       "accepted",
    contentWidth:      String(size.width),
    contentHeight:     String(size.height),
    nativeSize:        "800x480",
    stateAttributes: {
      alerts:         alongside ? "active"     : "silent",
      "alert-keys":   alongside ? "CAR ALONGSIDE" : "",
      "flag-kind":    alongside ? "occupied"   : "none",
      spotter:        alongside ? "left"        : "clear",
      "spotter-stale": "false",
      radar:          "live"
    },
    zones: [
      zone("flags",   NATIVE_FLAGS),
      zone("line",    NATIVE_LINE_Z),
      zone("clock",   NATIVE_CLOCK),
      zone("closing", NATIVE_CLOSING),
      zone("pace",    NATIVE_PACE),
      zone("tertiary",NATIVE_TERTIARY)
    ],
    values:      makeValues(state),
    containment: makeContainment(state),
    counted:     makeCounted(state),
    forbidden: RC17_SPEC.forbidden.map(([label, selector]) => ({ label, selector, count: 0 })),
    textOutputs: COMMON_TEXT_OUTPUTS,
    leafTexts:   alongside ? ALONGSIDE_LEAF_TEXTS : SILENT_LEAF_TEXTS,
    overflowLeaves: [],
    rootText: alongside
      ? "HIGH LOW 291 --.- -- --.- -- 4 6400 92 DEG C -- CAR LEFT LEFT RIGHT BEHIND"
      : "HIGH LOW 291 --.- -- --.- -- 4 6400 92 DEG C -- LEFT RIGHT BEHIND",
    errorBoundaryCount: 0,
    unknownWidgetCount: 0,
    failures: [],
    revFillAttr:  "0.80",
    revTrackContentPx: 285,  // content-box width; border-box revTrackPx is 287 (1 px border each side)
    revTrackPx:   287,
    revFillPx:    231,
    ringCentreX:  RING_CENTRE_X,
    ringCentreY:  RING_CENTRE_Y,
    laneRows:     null,
    lineOptions:  [
      { key: "HIGH", selected: "false" },
      { key: "LOW",  selected: "false" }
    ],
    alertScope: alongside
      ? [
          rect(310, 100, 110, 110),  // LEFT sector in clock
          rect(40,  50,  200, 30)    // flags zone
        ]
      : []
  }
  return { ...base, ...overrides }
}

function appMetrics(state = "silent", overrides = {}) {
  const size = CAPTURE_SIZES[1]  // 1024×600
  const native = nativeMetrics(state)
  return {
    ...native,
    viewport: { width: size.width, height: size.height, dpr: 1 },
    page: { scrollWidth: size.width, clientWidth: size.width },
    root: rect(0, 0, size.width, size.height),
    shell: measured(rect(0, 0, size.width, size.height)),
    canvas: {
      ...measured(rect(0, 0, size.width, size.height)),
      transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
    },
    dashboardElement: measured(rect(0, 0, size.width, size.height)),
    widget: measured(rect(0, 0, size.width, size.height)),
    layout:        "app",
    contentWidth:  String(size.width),
    contentHeight: String(size.height),
    nativeSize:    null,
    zones: [
      zone("flags",   rect(0,   0,   300, 36)),
      zone("line",    rect(716, 60,  260, 145)),
      zone("clock",   rect(372, 60,  300, 300)),
      zone("closing", rect(716, 205, 260, 145)),
      zone("pace",    rect(48,  400, 300, 160)),
      zone("tertiary",rect(716, 380, 260, 180))
    ],
    counted: native.counted.map((entry) => {
      if (entry.label === "pack map")   return { ...entry, count: 1 }
      if (entry.label === "pack field") return { ...entry, count: 1 }
      if (entry.label === "pack own")   return { ...entry, count: 1 }
      if (entry.label === "lane")       return { ...entry, count: 1 }
      if (entry.label === "lane empty") return { ...entry, count: 1 }
      return entry
    }),
    // App clock zone is (372, 60, 300, 300) → centre (522, 210).
    // Override the native ring centre (400, 180) so assertClockContainment passes.
    ringCentreX: 522,
    ringCentreY: 210,
    laneRows: "0",
    rootText: native.rootText + " NO LANE SOURCE",
    leafTexts: [...(state === "car-alongside" ? ALONGSIDE_LEAF_TEXTS : SILENT_LEAF_TEXTS), "NO LANE SOURCE"],
    ...overrides
  }
}

/**
 * Compact 759×393 landscape fixture — zone geometry derived from packet spacing:
 *   flags (0,0,759,25)   — narrow top bar
 *   line  (0,30,180,145) — left column
 *   clock (184,30,200,200) — centre ring; centre (284,130)
 *   closing (388,30,180,145) — right column
 *   pace (0,240,759,75)  — lower full-width strip
 *   tertiary (0,320,759,60) — bottom strip; scrollHeight may be +1 px by design (governed defect)
 * rev fill: 231/285 = 0.8105, within the ±0.02 tolerance.
 */
function compactLandscape759Metrics(state = "silent", overrides = {}) {
  const size    = CAPTURE_SIZES[4]   // 759×393, layout:"compact", compactMode:"landscape"
  const native  = nativeMetrics(state)
  const C_FLAGS    = rect(0,   0,   759, 25)
  const C_LINE     = rect(0,   30,  180, 145)
  const C_CLOCK    = rect(184, 30,  200, 200)
  const C_CLOSING  = rect(388, 30,  180, 145)
  const C_PACE     = rect(0,   240, 759, 75)
  const C_TERTIARY = rect(0,   320, 759, 60)
  const C_SPEED    = rect(5,   244, 70,  40)
  const C_GAP      = rect(90,  244, 80,  40)
  const C_POS      = rect(180, 244, 55,  40)
  const C_RATE     = rect(393, 35,  80,  50)
  const C_SIDE     = rect(393, 90,  55,  20)
  const C_GEAR     = rect(5,   324, 30,  25)
  const C_RPM      = rect(50,  324, 60,  25)
  const C_WATER    = rect(120, 324, 45,  25)
  const C_LINEREC  = rect(5,   35,  35,  45)
  const C_RING     = rect(190, 35,  190, 190)
  return {
    ...native,
    viewport:         { width: size.width, height: size.height, dpr: 1 },
    page:             { scrollWidth: size.width, clientWidth: size.width },
    root:             rect(0, 0, size.width, size.height),
    shell:            measured(rect(0, 0, size.width, size.height)),
    canvas: {
      ...measured(rect(0, 0, size.width, size.height)),
      transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
    },
    dashboardElement: measured(rect(0, 0, size.width, size.height)),
    widget:           measured(rect(0, 0, size.width, size.height)),
    layout:           "compact",
    compactMode:      "landscape",
    contentWidth:     String(size.width),
    contentHeight:    String(size.height),
    nativeSize:       null,
    zones: [
      zone("flags",    C_FLAGS),
      zone("line",     C_LINE),
      zone("clock",    C_CLOCK),
      zone("closing",  C_CLOSING),
      zone("pace",     C_PACE),
      zone("tertiary", C_TERTIARY)
    ],
    values: [
      value("speed",       '[data-testid="rc17-speed"]',        "291",   C_SPEED,   RC17_TYPE_SCALE_PX.pace),
      value("gap",         '[data-testid="rc17-gap"]',          "--.-",  C_GAP,     RC17_TYPE_SCALE_PX.pace),
      value("position",    '[data-testid="rc17-position"]',     "--",    C_POS,     RC17_TYPE_SCALE_PX.pace),
      value("closingRate", '[data-testid="rc17-closing-rate"]', "--.-",  C_RATE,    RC17_TYPE_SCALE_PX.closing),
      value("closingSide", '[data-testid="rc17-closing-side"]', "--",    C_SIDE,    RC17_TYPE_SCALE_PX.tertiary),
      value("gear",        '[data-testid="rc17-gear"]',         "4",     C_GEAR,    RC17_TYPE_SCALE_PX.tertiary),
      value("rpm",         '[data-testid="rc17-rpm"]',          "6400",  C_RPM,     RC17_TYPE_SCALE_PX.tertiary),
      value("water",       '[data-testid="rc17-water"]',        "92",    C_WATER,   RC17_TYPE_SCALE_PX.tertiary),
      value("lineRec",     'output[data-testid="rc17-line"]',   "--",    C_LINEREC, RC17_TYPE_SCALE_PX.line)
    ],
    containment: [
      owned("DEG C unit",       C_TERTIARY, rect(170, 324, 48, 28)),
      owned("SPEED label cell", C_PACE,     rect(5,   242, 90, 50)),
      owned("speed value",      C_PACE,     C_SPEED),
      owned("gap value",        C_PACE,     C_GAP),
      owned("position value",   C_PACE,     C_POS),
      owned("closing rate",     C_CLOSING,  C_RATE),
      owned("closing side",     C_CLOSING,  C_SIDE),
      owned("gear value",       C_TERTIARY, C_GEAR),
      owned("water value",      C_TERTIARY, C_WATER),
      owned("clock ring",       C_CLOCK,    C_RING)
    ],
    // Clock zone is (184,30,200,200) → centre (284,130). Must be within 3 px of ring centre.
    ringCentreX: 284,
    ringCentreY: 130,
    alertScope: [],
    ...overrides
  }
}

function entryFor(state = "silent", sizeIndex = 0) {
  return { size: CAPTURE_SIZES[sizeIndex], state, required: [] }
}

function assertRejects(mutate, expected, state = "silent") {
  const metrics = mutate(nativeMetrics(state))
  assert.throws(
    () => validateCaptureMetrics(metrics, entryFor(state), RC17_SPEC),
    (error) => error instanceof CaptureSafetyError && expected.test(error.message),
    `expected a CaptureSafetyError matching ${expected}`
  )
}

/* ── Matrix and contract ─────────────────────────────────────────────────────────────────── */

test("the governed matrix covers every viewport in every governed state", () => {
  assert.equal(RC17_CAPTURE_MATRIX.length, CAPTURE_SIZES.length * CAPTURE_STATES.length)
  for (const state of CAPTURE_STATES) {
    for (const size of CAPTURE_SIZES) {
      const entry = RC17_CAPTURE_MATRIX.find(
        (candidate) =>
          candidate.state === state &&
          candidate.size.width === size.width &&
          candidate.size.height === size.height
      )
      assert.ok(entry, `${state} ${size.width}x${size.height} is not covered`)
      assert.equal(expectedLayoutForBox(size.width, size.height), size.layout)
      assert.equal(expectedCompactModeForBox(size.width, size.height), size.compactMode)
    }
  }
})

test("the car-alongside state waits for both published alert tokens rather than a frame count", () => {
  for (const entry of RC17_CAPTURE_MATRIX) {
    const required = Object.fromEntries(entry.required)
    if (entry.state === "car-alongside") {
      assert.equal(required.alerts, "active")
      assert.equal(required["alert-keys"], "CAR ALONGSIDE")
    } else {
      assert.equal(required.alerts, "silent")
    }
  }
})

test("the silent state waits for data-rc17-alerts='silent'", () => {
  const silentEntries = RC17_CAPTURE_MATRIX.filter((entry) => entry.state === "silent")
  assert.ok(silentEntries.length > 0)
  for (const entry of silentEntries) {
    assert.ok(entry.required.some(([k, v]) => k === "alerts" && v === "silent"))
  }
})

/* ── Colour hue families — the RC-17 palette ───────────────────────────────────────────── */

test("hueFamilyOfHex classifies the four RC-17 colour tokens correctly", () => {
  assert.equal(hueFamilyOfHex(RC17_SIGNATURE_HEX), "magenta",  "signature #FF5AA0 must be magenta")
  assert.equal(hueFamilyOfHex(RC17_DANGER_HEX),    "red",     "danger #FF4436 must be red")
  assert.equal(hueFamilyOfHex(RC17_CAUTION_HEX),   "amber",   "caution #FFB82E must be amber")
  assert.equal(hueFamilyOfHex(RC17_INFO_HEX),      "blue",    "info #4A9CE0 must be blue")
})

test("the hue families of the four tokens are all distinct", () => {
  const families = [RC17_SIGNATURE_HEX, RC17_DANGER_HEX, RC17_CAUTION_HEX, RC17_INFO_HEX].map(hueFamilyOfHex)
  assert.equal(new Set(families).size, 4, "all four colour tokens must be in distinct hue families")
})

/**
 * A channel-ratio test (`r > 1.7*g && r > 1.5*b`) accepts BOTH #FF5AA0 (the signature,
 * hue ≈ 334°, magenta) and #FF4436 (danger, hue ≈ 4°, red). It cannot distinguish them.
 * The image-QA measured 8,578 "red" pixels on the approved alongside frame where the
 * hue-confirmed danger count was ZERO. This test demonstrates why the ratio test is wrong
 * and why the audit uses hue instead.
 */
test("a channel-ratio test falsely reports the signature colour as red — hue is required", () => {
  const [sigR, sigG, sigB]     = SIGNATURE_RGB   // [255, 90, 160]
  const [dangerR, dangerG, dangerB] = DANGER_RGB // [255, 68,  54]

  const ratioSaysRed = (r, g, b) => r > 1.7 * g && r > 1.5 * b

  // The ratio test reports signature (#FF5AA0) as "red".
  assert.ok(ratioSaysRed(sigR, sigG, sigB),   "ratio test must report #FF5AA0 as 'red' (the false positive)")
  // The ratio test also reports danger (#FF4436) as "red".
  assert.ok(ratioSaysRed(dangerR, dangerG, dangerB), "ratio test must also report #FF4436 as 'red'")
  // Because the ratio test cannot distinguish them, a frame with only signature pixels
  // would report 'red' even though danger is absent. The image-QA measured 8,578 such pixels.

  // Hue correctly separates them:
  assert.equal(hueFamily(sigR,    sigG,    sigB),    "magenta")
  assert.equal(hueFamily(dangerR, dangerG, dangerB), "red")
  // Neither is the other:
  assert.notEqual(hueFamily(sigR, sigG, sigB), "red")
  assert.notEqual(hueFamily(dangerR, dangerG, dangerB), "magenta")
})

/* ── Type scale ───────────────────────────────────────────────────────────────────────────── */

test("the packet type-scale ladder is strictly ordered — a tie is impossible by construction", () => {
  const steps = [
    RC17_TYPE_SCALE_PX.closing,
    RC17_TYPE_SCALE_PX.line,
    RC17_TYPE_SCALE_PX.pace,
    RC17_TYPE_SCALE_PX.sector,
    RC17_TYPE_SCALE_PX.flag,
    RC17_TYPE_SCALE_PX.tertiary,
    RC17_TYPE_SCALE_PX.label
  ]
  for (let index = 1; index < steps.length; index += 1) {
    assert.ok(
      steps[index - 1] > steps[index],
      `ladder step ${steps[index - 1]} must be strictly larger than ${steps[index]}`
    )
  }
})

test("the asserted type-scale chain (closing > pace > flag > tertiary) is valid", () => {
  assert.ok(RC17_TYPE_SCALE_PX.closing > RC17_TYPE_SCALE_PX.pace,     "closing > pace")
  assert.ok(RC17_TYPE_SCALE_PX.pace    > RC17_TYPE_SCALE_PX.flag,     "pace > flag")
  assert.ok(RC17_TYPE_SCALE_PX.flag    > RC17_TYPE_SCALE_PX.tertiary, "flag > tertiary")
  assert.ok(RC17_TYPE_SCALE_PX.pace    > RC17_TYPE_SCALE_PX.tertiary, "pace > tertiary (silent chain)")
})

/* ── Faithful fixtures ───────────────────────────────────────────────────────────────────── */

test("a faithful native silent fixture validates and its defect ledgers are empty", () => {
  const audit = validateCaptureMetrics(nativeMetrics("silent"), entryFor("silent"), RC17_SPEC)
  assert.deepEqual(audit.knownDefects, [])
  assert.deepEqual(audit.zoneDefects, [])
  assert.deepEqual(audit.containmentDefects, [])
})

test("a faithful native car-alongside fixture validates with the correct alert state", () => {
  const metrics = nativeMetrics("car-alongside")
  const audit = validateCaptureMetrics(metrics, entryFor("car-alongside"), RC17_SPEC)
  assert.deepEqual(audit.knownDefects, [])
})

test("a faithful app silent fixture validates with pack-map/lane present", () => {
  const audit = validateCaptureMetrics(appMetrics("silent"), entryFor("silent", 1), RC17_SPEC)
  assert.deepEqual(audit.containmentDefects, [])
})

/* ── Reference values ────────────────────────────────────────────────────────────────────── */

test("the reference channel values are the approved attempt-005 fixture values", () => {
  assert.equal(RC17_EXPECTED_VALUES.speed,       "291")
  assert.equal(RC17_EXPECTED_VALUES.gear,        "4")
  assert.equal(RC17_EXPECTED_VALUES.rpm,         "6400")
  assert.equal(RC17_EXPECTED_VALUES.water,       "92")
  assert.equal(RC17_EXPECTED_VALUES.gapAhead,    "--.-")
  assert.equal(RC17_EXPECTED_VALUES.position,    "--")
  assert.equal(RC17_EXPECTED_VALUES.closingRate, "--.-")
  assert.equal(RC17_EXPECTED_VALUES.closingSide, "--")
  assert.equal(RC17_EXPECTED_VALUES.lineRec,     "--")
  assert.equal(RC17_EXPECTED_VALUES.revFill,     0.80)
})

test("the approved frame had 5 verified dash placeholders of two distinct forms", () => {
  const longDash  = [RC17_EXPECTED_VALUES.gapAhead, RC17_EXPECTED_VALUES.closingRate]
  const shortDash = [RC17_EXPECTED_VALUES.position, RC17_EXPECTED_VALUES.closingSide, RC17_EXPECTED_VALUES.lineRec]
  assert.equal(longDash.every((text) => text === "--.-"), true, "long-dash form is --.- (3 strokes + dot)")
  assert.equal(shortDash.every((text) => text === "--"),   true, "short-dash form is -- (2 strokes)")
  assert.equal(longDash.length + shortDash.length, 5)
})

test("the rev fill attribute must equal 0.80 exactly (6400 / 8000)", () => {
  assert.equal(6400 / 8000, RC17_EXPECTED_VALUES.revFill)
})

test("the rev fill tolerance accepts the image-QA measured ratio (231/287 = 0.8055)", () => {
  const measured = 231 / 287
  assert.ok(
    Math.abs(measured - RC17_EXPECTED_VALUES.revFill) <= RC17_REV_FILL_TOLERANCE,
    `0.8055 must be within ${RC17_REV_FILL_TOLERANCE} of 0.80`
  )
})

/* ── Alert debounce constants ───────────────────────────────────────────────────────────── */

test("the carAlongside alert has no engage debounce — only the 300 ms release hysteresis", () => {
  assert.equal(RC17_ALONGSIDE_RELEASE_MS, 300)
  // fast-closing and three-wide have engage debounces but are silent on this fixture.
  assert.equal(RC17_FAST_CLOSING_ENGAGE_MS, 200)
  assert.equal(RC17_THREE_WIDE_ENGAGE_MS,   150)
})

/* ── Fail-closed: alert contract ────────────────────────────────────────────────────────── */

test("silent state with alerts='active' fails closed", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      stateAttributes: { ...metrics.stateAttributes, alerts: "active" }
    }),
    /data-rc17-alerts="silent"/u
  )
})

test("car-alongside state missing alert-keys fails closed", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      stateAttributes: { ...metrics.stateAttributes, "alert-keys": "" }
    }),
    /data-rc17-alert-keys="CAR ALONGSIDE"/u,
    "car-alongside"
  )
})

test("car-alongside state with FAST CLOSING in alert-keys fails closed", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      stateAttributes: { ...metrics.stateAttributes, "alert-keys": "CAR ALONGSIDE,FAST CLOSING" }
    }),
    /fast-closing alert must not fire/u,
    "car-alongside"
  )
})

test("silent state with a contact fails closed (alongside contact must be zero)", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      counted: metrics.counted.map((entry) =>
        entry.label === "contact" ? { ...entry, count: 1 } : entry
      )
    }),
    /silent state must show 0 radar contact\(s\)/u
  )
})

test("silent state with a flag element fails closed", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      counted: metrics.counted.map((entry) =>
        entry.label === "flag" ? { ...entry, count: 1 } : entry
      )
    }),
    /silent state must render no rc17-flag/u
  )
})

/* ── Fail-closed: value and dash contract ───────────────────────────────────────────────── */

test("wrong speed value fails closed", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      values: metrics.values.map((entry) =>
        entry.label === "speed" ? { ...entry, text: "290" } : entry
      )
    }),
    /speed reads "290" instead of "291"/u
  )
})

test("gap with wrong dash form '--' fails closed (must be '--.-')", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      values: metrics.values.map((entry) =>
        entry.label === "gap" ? { ...entry, text: "--" } : entry
      )
    }),
    /gap reads "--" instead of "--\.-"/u
  )
})

test("position with wrong dash form '--.-' fails closed (must be '--')", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      values: metrics.values.map((entry) =>
        entry.label === "position" ? { ...entry, text: "--.-" } : entry
      )
    }),
    /position reads "--\.-" instead of "--"/u
  )
})

/* ── Fail-closed: closing rate and side ─────────────────────────────────────────────────── */

test("a malformed closing-rate placeholder fails closed (must be '--.-', not '-.-')", () => {
  // "-.-" is neither the approved "--.-" placeholder nor a valid measured rate (e.g. "-12.3").
  // The lib rejects any string that contains a dash but does not match either form.
  assertRejects(
    (metrics) => ({
      ...metrics,
      values: metrics.values.map((entry) =>
        entry.label === "closingRate" ? { ...entry, text: "-.-" } : entry
      )
    }),
    /closing rate reads "-\.-"/u
  )
})

test("a named closing side while the rate is still dashed fails closed (pair must agree)", () => {
  // The rate is "--.-" (dashed), but the side already names a direction.
  // The pair must dash together; a split state is never valid.
  assertRejects(
    (metrics) => ({
      ...metrics,
      values: metrics.values.map((entry) =>
        entry.label === "closingSide" ? { ...entry, text: "LEFT" } : entry
      )
    }),
    /closing side reads "LEFT" while the closing rate is dashed/u
  )
})

/* ── Fail-closed: geometry sweeps ───────────────────────────────────────────────────────── */

test("overlapping zones fail closed with the measured overlap", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      zones: metrics.zones.map((entry) =>
        entry.name === "pace" ? { ...entry, ...measured(rect(40, 80, 720, 80)) } : entry
      )
    }),
    /overlaps/u
  )
})

test("an element that escapes its zone fails closed with the measured escape in px", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      containment: metrics.containment.map((entry) =>
        entry.label === "speed value" ? { ...entry, value: rect(55, 325, 900, 44) } : entry
      )
    }),
    /speed value escapes its zone on the right by \d+\.\d+px/u
  )
})

/**
 * The DEG C unit escape (the canonical nowrap trap): the unit MUST NOT escape the tertiary zone.
 * This was fixed in the RC-17 implementation. Any recurrence is a new regression.
 */
test("DEG C unit escaping the tertiary zone fails closed (the nowrap trap)", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      containment: metrics.containment.map((entry) =>
        entry.label === "DEG C unit" ? { ...entry, value: rect(40, 415, 760, 28) } : entry
      )
    }),
    /DEG C unit escapes its zone on the right by \d+\.\d+px/u
  )
})

test("a zone out of frame fails closed", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      zones: metrics.zones.map((entry) =>
        entry.name === "closing" ? { ...entry, ...measured(rect(700, 90, 200, 180)) } : entry
      )
    }),
    /is out of frame/u
  )
})

test("an unrecorded nowrap overflow fails closed even when scrollWidth agrees with clientWidth", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      overflowLeaves: [
        {
          key: "rc17-water",
          text: "92",
          fontSize: 15,
          whiteSpace: "nowrap",
          clientWidth: 50,
          scrollWidth: 50,
          overflowX: 30,
          textLeft: 400,
          textRight: 480
        }
      ]
    }),
    /rc17-water "92" paints 30px wider than its 50px box/u
  )
})

test("a zone whose own content overflows its layout box fails closed", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      zones: metrics.zones.map((entry) =>
        entry.name === "tertiary" ? { ...entry, scrollHeight: entry.layoutHeight + 30 } : entry
      )
    }),
    /zone tertiary overflows its layout box by 30\.00px/u
  )
})

/* ── Fail-closed: known zone-overflow defect budget ─────────────────────────────────────── */

test("the tertiary zone-overflow defect is scoped: 1 px at native 800×480 still fails closed", () => {
  // The waiver covers only 759×393; 800×480 has no entry → unrecorded overflow always fails.
  assertRejects(
    (metrics) => ({
      ...metrics,
      zones: metrics.zones.map((z) =>
        z.name === "tertiary" ? { ...z, scrollHeight: z.layoutHeight + 1 } : z
      )
    }),
    /zone tertiary overflows its layout box by 1\.00px/u
  )
})

test("the tertiary zone-overflow defect has a hard budget: 3 px at 759×393 fails closed", () => {
  // 759×393 is in the defect list with budgetPx=2. An overflow of 3 px (> 2) fails "past budget".
  const metrics = compactLandscape759Metrics()
  const mutated = {
    ...metrics,
    zones: metrics.zones.map((z) =>
      z.name === "tertiary" ? { ...z, scrollHeight: z.layoutHeight + 3 } : z
    )
  }
  assert.throws(
    () => validateCaptureMetrics(mutated, entryFor("silent", 4), RC17_SPEC),
    (error) =>
      error instanceof CaptureSafetyError &&
      /zone tertiary overflows by 3\.00px.*past the 2px recorded/u.test(error.message)
  )
})

test("a tie anywhere in the type-scale chain is a failure, not a pass", () => {
  assertRejects(
    (metrics) => {
      const values = metrics.values.map((entry) =>
        entry.label === "speed" ? { ...entry, fontSize: RC17_TYPE_SCALE_PX.closing } : entry
      )
      return { ...metrics, values }
    },
    /type-scale hierarchy does not hold/u
  )
})

/* ── Fail-closed: packet omissions — absence is the contract ────────────────────────────── */

test("reintroducing a soft-key toggle for line choice fails closed (omission: softKeyToggle)", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      forbidden: metrics.forbidden.map((entry) =>
        entry.label.includes("softKeyToggle") ? { ...entry, count: 1 } : entry
      )
    }),
    /omission: softKeyToggle.*must not be rendered/su
  )
})

test("reintroducing a redline scale tick fails closed (omission: revScaleEnd)", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      forbidden: metrics.forbidden.map((entry) =>
        entry.label.includes("revScaleEnd") ? { ...entry, count: 1 } : entry
      )
    }),
    /omission: revScaleEnd.*must not be rendered/su
  )
})

test("reintroducing the three-wide enum attribute fails closed (omission: threeWideEnum)", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      forbidden: metrics.forbidden.map((entry) =>
        entry.label.includes("threeWideEnum") ? { ...entry, count: 1 } : entry
      )
    }),
    /omission: threeWideEnum.*must not be rendered/su
  )
})

/**
 * insideOutsideWording (GAP-4): the channel reports left/right, never the oval's turn direction.
 * CAR INSIDE must NEVER appear in the output. Its absence is NOT a defect.
 */
test("CAR INSIDE appearing as a leaf text fails closed (insideOutsideWording omission)", () => {
  assertRejects(
    (metrics) => ({ ...metrics, leafTexts: [...metrics.leafTexts, "CAR INSIDE"] }),
    /renders "CAR INSIDE" as a readout/u,
    "car-alongside"
  )
})

test("CAR OUTSIDE appearing as a leaf text fails closed (insideOutsideWording omission)", () => {
  assertRejects(
    (metrics) => ({ ...metrics, leafTexts: [...metrics.leafTexts, "CAR OUTSIDE"] }),
    /renders "CAR OUTSIDE" as a readout/u
  )
})

test("a selected line option fails closed — lineChoice channel is permanently absent (omission: lineChoice)", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      lineOptions: [
        { key: "HIGH", selected: "true" },
        { key: "LOW",  selected: "false" }
      ]
    }),
    /option HIGH is marked selected but no channel exists/u
  )
})

test("laneRows !== '0' on the app layout fails closed (omission: laneUsageHistory)", () => {
  const metrics = appMetrics("silent", { laneRows: "3" })
  assert.throws(
    () => validateCaptureMetrics(metrics, entryFor("silent", 1), RC17_SPEC),
    (error) => error instanceof CaptureSafetyError && /data-rc17-lane-rows must be "0"/u.test(error.message)
  )
})

test("THREE WIDE appearing as a leaf text fails closed (omission: threeWideEnum)", () => {
  assertRejects(
    (metrics) => ({ ...metrics, leafTexts: [...metrics.leafTexts, "THREE WIDE"] }),
    /renders "THREE WIDE" as a readout/u
  )
})

test("the fast-closing threshold literal '2.5' appearing as leaf text fails closed (omission: closingThreshold)", () => {
  assertRejects(
    (metrics) => ({ ...metrics, leafTexts: [...metrics.leafTexts, "2.5"] }),
    /renders "2\.5" as a readout/u
  )
})

test("NO DATA appearing as leaf text fails closed", () => {
  assertRejects(
    (metrics) => ({ ...metrics, leafTexts: [...metrics.leafTexts, "NO DATA"] }),
    /renders "NO DATA" as a readout/u
  )
})

/* ── Rev fill ────────────────────────────────────────────────────────────────────────────── */

test("a rev fill attribute that is not 0.80 fails closed", () => {
  assertRejects(
    (metrics) => ({ ...metrics, revFillAttr: "0.75" }),
    /data-rc17-rev-fill attribute must be 0\.8/u
  )
})

test("a rendered rev fill ratio outside ±0.02 of 0.80 fails closed", () => {
  assertRejects(
    (metrics) => ({ ...metrics, revFillPx: 100, revTrackPx: 287 }),
    /rc17-rev-fill rendered ratio must be 0\.8/u
  )
})

/* ── Fail-closed: rev fill uses content-box width ───────────────────────────────────────── */

test("assertRevFill uses content-box width: 40/50 = 0.80 passes; 40/52 border-box fails", () => {
  // With the content-box denominator (50), 40/50 = 0.80 exactly — within ±0.02.
  const passing = nativeMetrics("silent", {
    revTrackContentPx: 50,
    revTrackPx:        52,
    revFillPx:         40
  })
  assert.doesNotThrow(() => validateCaptureMetrics(passing, entryFor("silent"), RC17_SPEC))

  // Without a content-box width the lib falls back to the border-box (52):
  // 40/52 = 0.769, which is 3.1 pp below 0.80 — outside the ±0.02 tolerance.
  const failing = nativeMetrics("silent", {
    revTrackContentPx: null,   // not finite → fallback to revTrackPx
    revTrackPx:        52,
    revFillPx:         40
  })
  assert.throws(
    () => validateCaptureMetrics(failing, entryFor("silent"), RC17_SPEC),
    (error) =>
      error instanceof CaptureSafetyError &&
      /rc17-rev-fill rendered ratio must be 0\.8/u.test(error.message)
  )
})

/* ── Pixel audit ─────────────────────────────────────────────────────────────────────────── */

function paintPng(size, background) {
  const image = new PNG({ width: size.width, height: size.height })
  for (let y = 0; y < size.height; y += 1) {
    for (let x = 0; x < size.width; x += 1) {
      const offset = (y * size.width + x) * 4
      image.data[offset    ] = background[0]
      image.data[offset + 1] = background[1]
      image.data[offset + 2] = background[2]
      image.data[offset + 3] = 255
    }
  }
  return image
}

function fillRect(image, box, rgb) {
  for (let y = box.top; y < box.top + box.height; y += 1) {
    for (let x = box.left; x < box.left + box.width; x += 1) {
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue
      const offset = (y * image.width + x) * 4
      image.data[offset    ] = rgb[0]
      image.data[offset + 1] = rgb[1]
      image.data[offset + 2] = rgb[2]
      image.data[offset + 3] = 255
    }
  }
  return image
}

/**
 * A synthetic PNG for the pixel audit:
 *   - Canvas background everywhere
 *   - Some blue (info) for general widget chrome
 *   - For car-alongside: magenta in the LEFT sector (inside clock) and the flags zone
 *   - No red (danger) and no amber (caution) in either state — those alerts never fire here
 */
function capturePng(state, options = {}) {
  const {
    strayDanger  = false,
    blank        = false,
    noSignature  = false,
    amber        = false,
    signatureOut = false   // magenta outside the declared scope
  } = options
  const size  = CAPTURE_SIZES[0]  // 800×480
  const image = paintPng(size, CANVAS_RGB)
  if (blank) return PNG.sync.write(image)

  // General chrome (blue/info) — 720×10 = 7,200 non-canvas pixels so the blank-frame
  // threshold (5,000) is met without any state-specific signature pixels.
  fillRect(image, rect(40, 40, 720, 10), INFO_RGB)

  if (state === "car-alongside") {
    if (!noSignature) {
      // Signature in the LEFT sector (inside clock zone 270-530, 50-310).
      fillRect(image, rect(310, 100, 110, 110), SIGNATURE_RGB)
      // Signature in the flags zone (40-240, 50-80).
      fillRect(image, rect(50, 52, 130, 22), SIGNATURE_RGB)
    } else {
      // Replace with neutral grey so the signature family is truly absent.
      fillRect(image, rect(310, 100, 110, 110), [90, 90, 90])
      fillRect(image, rect(50, 52, 130, 22), [90, 90, 90])
    }
    if (signatureOut) {
      // Magenta leaking outside the declared scope (e.g., into the pace zone).
      fillRect(image, rect(100, 340, 30, 20), SIGNATURE_RGB)
    }
  }
  if (strayDanger) fillRect(image, rect(400, 340, 40, 20), DANGER_RGB)
  if (amber)       fillRect(image, rect(300, 340, 20, 20), CAUTION_RGB)
  return PNG.sync.write(image)
}

const SILENT_METRICS    = nativeMetrics("silent")
const ALONGSIDE_METRICS = nativeMetrics("car-alongside")

test("the pixel audit accepts the silent frame: no signature, no danger, no amber", () => {
  const audit = validateCapturePixels(capturePng("silent"), entryFor("silent"), SILENT_METRICS)
  assert.equal(audit.width,  800)
  assert.equal(audit.height, 480)
  assert.equal(audit.signatureHueFamily, "magenta")
  assert.equal(audit.dangerHueFamily,    "red")
  assert.equal(audit.hueFamilies.magenta, 0)
  assert.equal(audit.hueFamilies.red,     0)
  assert.equal(audit.hueFamilies.amber,   0)
  assert.ok(audit.nonCanvasPixels > 5_000, "frame must not be blank")
})

test("the pixel audit accepts the car-alongside frame: signature present and scoped, no danger, no amber", () => {
  const audit = validateCapturePixels(capturePng("car-alongside"), entryFor("car-alongside"), ALONGSIDE_METRICS)
  assert.ok(audit.hueFamilies.magenta > 0, "signature must be present in the alongside frame")
  assert.equal(audit.hueFamilies.red,    0, "danger must be absent in both governed frames")
  assert.equal(audit.hueFamilies.amber,  0, "caution must be absent in both governed frames")
  assert.equal(audit.signatureOutsideScope, 0, "all magenta pixels must be scoped to the alert surface")
})

test("a blank frame fails closed", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { blank: true }), entryFor("silent"), SILENT_METRICS),
    (error) => error instanceof CaptureSafetyError && /blank against the RC-17 canvas colour/u.test(error.message)
  )
})

test("a silent frame carrying any danger pixel fails closed (mechanism: absent check)", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { strayDanger: true }), entryFor("silent"), SILENT_METRICS),
    (error) => error instanceof CaptureSafetyError && /red hue family must be absent/u.test(error.message)
  )
})

test("a car-alongside frame carrying danger outside the scope fails closed (mechanism: absent check)", () => {
  assert.throws(
    () =>
      validateCapturePixels(
        capturePng("car-alongside", { strayDanger: true }),
        entryFor("car-alongside"),
        ALONGSIDE_METRICS
      ),
    (error) => error instanceof CaptureSafetyError && /red hue family must be absent/u.test(error.message)
  )
})

test("a car-alongside frame that has lost its signature fails closed (mechanism: present check)", () => {
  assert.throws(
    () =>
      validateCapturePixels(
        capturePng("car-alongside", { noSignature: true }),
        entryFor("car-alongside"),
        ALONGSIDE_METRICS
      ),
    (error) => error instanceof CaptureSafetyError && /magenta hue family must be painted/u.test(error.message)
  )
})

test("magenta leaking outside its declared scope fails closed (mechanism: scoped check)", () => {
  assert.throws(
    () =>
      validateCapturePixels(
        capturePng("car-alongside", { signatureOut: true }),
        entryFor("car-alongside"),
        ALONGSIDE_METRICS
      ),
    (error) =>
      error instanceof CaptureSafetyError &&
      /magenta pixels fall outside the elements that own that alert/u.test(error.message)
  )
})

test("any amber fails closed on both frames — caution belongs to fast-closing, which is silent here", () => {
  for (const state of CAPTURE_STATES) {
    assert.throws(
      () =>
        validateCapturePixels(
          capturePng(state, { amber: true }),
          entryFor(state),
          nativeMetrics(state)
        ),
      (error) => error instanceof CaptureSafetyError && /amber hue family must be absent/u.test(error.message),
      `amber must fail for state=${state}`
    )
  }
})

/* ── Disk safety comes from RC-01, unforked ──────────────────────────────────────────────── */

test("the shared disk-safety primitives are the RC-01 originals, unforked", () => {
  assert.equal(typeof parseCaptureArgs, "function")
  assert.equal(typeof prepareCaptureOutput, "function")
  assert.equal(typeof createPrivateStaging, "function")
  assert.equal(typeof discardPrivateStaging, "function")
  assert.throws(() => parseCaptureArgs(["--mode", "final"]), CaptureSafetyError)
})
