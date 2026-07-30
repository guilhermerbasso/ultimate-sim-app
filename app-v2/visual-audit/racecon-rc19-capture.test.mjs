import assert from "node:assert/strict"
import test from "node:test"
import { PNG } from "pngjs"
import {
  CAPTURE_SIZES,
  CaptureSafetyError,
  createPrivateStaging,
  discardPrivateStaging,
  expectedCompactModeForBox,
  expectedLayoutForBox,
  hueFamily,
  hueFamilyOfHex,
  parseCaptureArgs,
  prepareCaptureOutput
} from "./racecon-capture-shared.mjs"
import {
  CAPTURE_STATES,
  RC19_CANVAS_RGBA,
  RC19_CAPTURE_MATRIX,
  RC19_CAUTION_HEX,
  RC19_COLD_MOUNT_DASH_COUNT,
  RC19_DANGER_HEX,
  RC19_DASH,
  RC19_EXPECTED_VALUES,
  RC19_INFO_HEX,
  RC19_NORMAL_HEX,
  RC19_READY_DASH_COUNT,
  RC19_SIGNATURE_HEX,
  RC19_SOURCE_IDENTITY,
  RC19_SPEC,
  RC19_TYPE_SCALE_PX,
  validateCaptureMetrics,
  validateCapturePixels
} from "./racecon-rc19-capture-lib.mjs"

/* ── Synthetic metric fixtures ────────────────────────────────────────────────────────── */

function rect(left, top, width, height) {
  return { left, top, width, height }
}

function measured(box) {
  return {
    ...box,
    layoutWidth: box.width,
    layoutHeight: box.height,
    scrollWidth: box.width,
    scrollHeight: box.height
  }
}

function zone(name, selector, box) {
  return { name, selector, present: true, display: "block", ...measured(box) }
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
    color: "rgb(234, 239, 243)",
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
 * Native 800×480 zone geometry, calibrated against the alert-floor fix.
 * The confirm zone and checklist zone bottom = 450 px, leaving 30 px of breathing room for
 * the alert strip whose top = 450 px (bottom:0, height ≈ 30 px on the native canvas).
 */
const NATIVE_HEADER_BOX     = rect(16,  12, 768,  44)   // y 12 → 56
const NATIVE_CAR_STATE_BOX  = rect(16,  66, 250, 384)   // y 66 → 450
const NATIVE_CHECKLIST_BOX  = rect(282, 66, 236, 384)   // y 66 → 450
const NATIVE_CONFIRM_BOX    = rect(282, 406, 236, 40)   // y 406 → 446 (inside checklist ✓)
const NATIVE_NEXT_STINT_BOX = rect(534, 66, 250, 384)   // y 66 → 450

const NATIVE_READINESS_BOX    = rect(32,  14, 200, 40)   // inside header
const NATIVE_OUTSTANDING_BOX  = rect(400, 18, 200, 24)   // inside header
const NATIVE_FUEL_LAPS_BOX    = rect(30, 100, 100, 30)   // inside carState
const NATIVE_STINT_LAPS_BOX   = rect(30, 140, 100, 30)   // inside carState
const NATIVE_TC_BOX           = rect(30, 200,  80, 30)   // inside carState
const NATIVE_ABS_BOX          = rect(120, 200, 80, 30)   // inside carState
const NATIVE_FAULT_VALUE_BOX  = rect(30, 260, 180, 24)   // inside carState
const NATIVE_FUEL_PER_LAP_BOX = rect(540, 100, 100, 30) // inside nextStint
const NATIVE_CONFIRM_LBL_BOX  = rect(310, 420, 180, 15) // inside confirm
const NATIVE_ROW_LABEL_BOX    = rect(30,  98,  80, 15)   // fuel-laps label inside carState

/**
 * Alert-clearance geometry for the handover state (native 800×480).
 *
 *   Alert strip (position:absolute, bottom:0) top = 450 px.
 *   FAULTS row bottom   = 384 px  → clearance 66 px ✓
 *   Confirm bottom      = 446 px  → clearance  4 px ✓ (within CLEARANCE_TOLERANCE_PX = 2)
 *   Confirm-label bottom= 435 px  → clearance 15 px ✓
 */
const NATIVE_ALERTS_RECT      = rect(8,  450, 784, 30)
const NATIVE_FAULTS_RECT      = rect(30, 360, 180, 24)  // bottom = 384
const NATIVE_CONFIRM_RECT     = NATIVE_CONFIRM_BOX       // bottom = 446
const NATIVE_CONFIRM_LBL_RECT = NATIVE_CONFIRM_LBL_BOX  // bottom = 435

/** Blocking checklist rows that carry danger pixels in alert states. */
const NATIVE_BLOCKING_ROW_1 = rect(282, 70, 236, 44)
const NATIVE_BLOCKING_ROW_2 = rect(282, 118, 236, 44)

/**
 * Approved leaf texts for the cold-mount / handover states.
 *
 * Dash count: 9 — the 8 structural dashes (RR tyre + ABS + MAP + BIAS + TARGET LAPS + FUEL PLAN
 * + TIRE PLAN + WEATHER) plus STINT LAPS which dashes because the tracker never observed a pit
 * exit on a cold mount.
 */
const COLD_MOUNT_LEAF_TEXTS = [
  "NOT READY", "6 OUTSTANDING",
  "CAR STATE",
  "FUEL LAPS", "12.6",
  "STINT LAPS", "--",      // 9th dash: no pit exit observed (cold mount)
  "TC", "4",
  "ABS", "--",             // GAP-3
  "MAP", "--",             // GAP-3
  "BIAS", "--",            // GAP-3
  "FAULTS", "NONE ACTIVE",
  "SWAP CHECKLIST",
  "SEAT", "PENDING",
  "BELTS", "PENDING",
  "WHEEL", "PENDING",
  "RADIO", "PENDING",
  "DRINKS", "PENDING",
  "MIRRORS", "PENDING",
  "CONFIRM READY",
  "NEXT STINT",
  "TARGET LAPS", "--",    // GAP-4
  "FUEL PER LAP", "2.94",
  "FUEL PLAN", "--",      // GAP-4
  "TIRE PLAN", "--",      // GAP-4
  "WEATHER", "--",        // GAP-4
  "LF", "1.94",
  "RF", "1.97",
  "LR", "1.91",
  "RR", "--",             // RR tyre: no pressureKpa in reference snapshot
  "SAFETY ITEM UNCONFIRMED"
]

/**
 * Approved leaf texts for the ready state.
 *
 * Dash count: 8 — STINT LAPS now reads "28" after the observed pit exit, so only the 8 structural
 * dashes remain.
 *
 * SEAT, BELTS, WHEEL and RADIO are CONFIRMED via crew macro events; DRINKS and MIRRORS stay
 * PENDING (outstanding = 2).
 */
const READY_LEAF_TEXTS = [
  "NOT READY", "2 OUTSTANDING",
  "CAR STATE",
  "FUEL LAPS", "12.6",
  "STINT LAPS", "28",     // pit exit was observed → stintLaps = 28 - 0 = 28
  "TC", "4",
  "ABS", "--",
  "MAP", "--",
  "BIAS", "--",
  "FAULTS", "NONE ACTIVE",
  "SWAP CHECKLIST",
  "SEAT", "CONFIRMED",
  "BELTS", "CONFIRMED",
  "WHEEL", "CONFIRMED",
  "RADIO", "CONFIRMED",
  "DRINKS", "PENDING",
  "MIRRORS", "PENDING",
  "CONFIRM READY",
  "NEXT STINT",
  "TARGET LAPS", "--",
  "FUEL PER LAP", "2.94",
  "FUEL PLAN", "--",
  "TIRE PLAN", "--",
  "WEATHER", "--",
  "LF", "1.94",
  "RF", "1.97",
  "LR", "1.91",
  "RR", "--"
]

function nativeMetrics(state = "ready", overrides = {}) {
  const size = CAPTURE_SIZES[0]
  const isAlert = state !== "ready"
  const leafTexts = isAlert ? COLD_MOUNT_LEAF_TEXTS : READY_LEAF_TEXTS
  const alertScope = isAlert
    ? [NATIVE_ALERTS_RECT, NATIVE_BLOCKING_ROW_1, NATIVE_BLOCKING_ROW_2]
    : []

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
    presetId: RC19_SPEC.presetId,
    expectedWidgetId: RC19_SPEC.widgetId,
    renderedWidgetId: RC19_SPEC.widgetId,
    dashboardWidth: "1024",
    dashboardHeight: "600",
    sourceKind: "live-telemetry",
    sourceIdentity: RC19_SOURCE_IDENTITY,
    captureState: state,
    captureSequence: "25",
    layout: "native",
    compactMode: null,
    bufferState: "accepted",
    contentWidth: String(size.width),
    contentHeight: String(size.height),
    nativeSize: "800x480",
    stateAttributes: {
      ready: "false",
      outstanding: isAlert ? "6" : "2",
      handover: "in-box",
      alerts: isAlert ? "active" : "silent",
      "alert-keys": isAlert ? "SAFETY ITEM UNCONFIRMED" : ""
    },
    zones: [
      zone("header",    '[data-testid="rc19-header"]',    NATIVE_HEADER_BOX),
      zone("carState",  '[data-testid="rc19-car-state"]', NATIVE_CAR_STATE_BOX),
      zone("checklist", '[data-testid="rc19-checklist"]', NATIVE_CHECKLIST_BOX),
      zone("confirm",   '[data-testid="rc19-confirm"]',   NATIVE_CONFIRM_BOX),
      zone("nextStint", '[data-testid="rc19-next-stint"]',NATIVE_NEXT_STINT_BOX)
    ],
    values: [
      value("outstanding",  '[data-testid="rc19-outstanding"]',          isAlert ? "6 OUTSTANDING" : "2 OUTSTANDING", NATIVE_OUTSTANDING_BOX, RC19_TYPE_SCALE_PX.item),
      value("fuel-laps",    '[data-testid="rc19-fuel-laps"]',            "12.6",                NATIVE_FUEL_LAPS_BOX,   RC19_TYPE_SCALE_PX.value),
      value("stint-laps",   '[data-testid="rc19-stint-laps"]',           isAlert ? "--" : "28", NATIVE_STINT_LAPS_BOX,  RC19_TYPE_SCALE_PX.value),
      value("tc",           '[data-testid="rc19-tc"]',                   "4",                   NATIVE_TC_BOX,          RC19_TYPE_SCALE_PX.value),
      value("abs",          '[data-testid="rc19-abs"]',                  "--",                  NATIVE_ABS_BOX,         RC19_TYPE_SCALE_PX.value),
      value("fault-value",  '[data-testid="rc19-fault-value"]',          "NONE ACTIVE",         NATIVE_FAULT_VALUE_BOX, RC19_TYPE_SCALE_PX.item),
      value("fuel-per-lap", '[data-testid="rc19-fuel-per-lap"]',         "2.94",                NATIVE_FUEL_PER_LAP_BOX,RC19_TYPE_SCALE_PX.value),
      value("confirm-label",'[data-testid="rc19-confirm-label"]',        "CONFIRM READY",       NATIVE_CONFIRM_LBL_BOX, RC19_TYPE_SCALE_PX.item),
      value("row-label",    '[data-rc19-row="fuel-laps"] .rc19-label',   "FUEL LAPS",           NATIVE_ROW_LABEL_BOX,   RC19_TYPE_SCALE_PX.label)
    ],
    // readiness is now measured bespoke (removed from spec.values); assertTypeScale reads
    // metrics.readiness.fontSize directly instead of looking it up via valueOf(metrics, "readiness").
    readiness: {
      text: "NOT READY",
      fontSize: RC19_TYPE_SCALE_PX.readiness,
      rect: NATIVE_READINESS_BOX,
      textRect: NATIVE_READINESS_BOX   // native: the 40 px word fits within the 44 px header band
    },
    containment: [
      owned("readiness in header",      NATIVE_HEADER_BOX,      NATIVE_READINESS_BOX),
      owned("outstanding in header",    NATIVE_HEADER_BOX,      NATIVE_OUTSTANDING_BOX),
      owned("fuel-laps in carState",    NATIVE_CAR_STATE_BOX,   NATIVE_FUEL_LAPS_BOX),
      owned("tc in carState",           NATIVE_CAR_STATE_BOX,   NATIVE_TC_BOX),
      owned("fault-value in carState",  NATIVE_CAR_STATE_BOX,   NATIVE_FAULT_VALUE_BOX),
      owned("confirm in checklist",     NATIVE_CHECKLIST_BOX,   NATIVE_CONFIRM_BOX),
      owned("confirm-label in confirm", NATIVE_CONFIRM_BOX,     NATIVE_CONFIRM_LBL_BOX),
      owned("fuel-per-lap in nextStint",NATIVE_NEXT_STINT_BOX,  NATIVE_FUEL_PER_LAP_BOX)
    ],
    counted: [
      counted("check-row",      '[data-testid="rc19-check-row"]',        6),
      counted("glyph",          '[data-testid^="rc19-glyph-"]',          6),
      counted("state-output",   '[data-testid^="rc19-state-"]',          6),
      counted("cell",           '[data-testid="rc19-cell"]',             8),
      counted("row",            '[data-testid="rc19-row"]',              7),   // native: 7 rows
      counted("alerts-strip",   '[data-testid="rc19-alerts"]',           isAlert ? 1 : 0),
      counted("fuel-plan-note", '[data-testid="rc19-fuel-plan-note"]',   0),
      counted("water-temp",     '[data-testid="rc19-water-temp"]',       0),   // native: absent
      counted("voltage",        '[data-testid="rc19-voltage"]',          0),   // native: absent
      counted("timeline",       '[data-testid="rc19-timeline"]',         0),   // native: absent
      counted("timeline-empty", '[data-testid="rc19-timeline-empty"]',   0)
    ],
    forbidden: RC19_SPEC.forbidden.map(([label, selector]) => ({ label, selector, count: 0 })),
    textOutputs: ["NOT READY", "12.6", "2.94"],
    leafTexts,
    overflowLeaves: [],
    rootText: leafTexts.join(" "),
    errorBoundaryCount: 0,
    unknownWidgetCount: 0,
    failures: [],
    alertsClearance: {
      alertsRect:       NATIVE_ALERTS_RECT,
      faultsRect:       NATIVE_FAULTS_RECT,
      confirmRect:      NATIVE_CONFIRM_RECT,
      confirmLabelRect: NATIVE_CONFIRM_LBL_RECT
    },
    alertScope,
    timelineSegments: null,
    // nativeSize is the data-rc19-native-size attr (top-level, not in stateAttributes)
    // already set above
  }
  return { ...base, ...overrides }
}

/** App 1024×600 fixture, derived from the native ready metrics with app-specific overrides. */
function appMetrics(state = "ready", overrides = {}) {
  const size = CAPTURE_SIZES[1]
  const native = nativeMetrics(state)
  const appLeafTexts = [
    ...native.leafTexts,
    "88", "WATER", "13.4", "VOLTAGE",   // rc19-water-temp and rc19-voltage (app-only)
    "NO STINT PLAN SOURCE"               // rc19-timeline-empty
  ]
  return {
    ...native,
    viewport: { width: size.width, height: size.height, dpr: 1 },
    page: { scrollWidth: size.width, clientWidth: size.width },
    root: rect(0, 0, size.width, size.height),
    shell: measured(rect(0, 0, size.width, size.height)),
    canvas: { ...measured(rect(0, 0, size.width, size.height)), transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
    dashboardElement: measured(rect(0, 0, size.width, size.height)),
    widget: measured(rect(0, 0, size.width, size.height)),
    dashboard: measured(rect(0, 0, size.width, size.height)),
    layout: "app",
    nativeSize: null,
    contentWidth: String(size.width),
    contentHeight: String(size.height),
    captureState: state,
    zones: [
      zone("header",    '[data-testid="rc19-header"]',    rect(20,  15, 984,  55)),
      zone("carState",  '[data-testid="rc19-car-state"]', rect(20,  80, 320, 490)),
      zone("checklist", '[data-testid="rc19-checklist"]', rect(360, 80, 300, 490)),
      zone("confirm",   '[data-testid="rc19-confirm"]',   rect(360, 510, 300, 55)),
      zone("nextStint", '[data-testid="rc19-next-stint"]',rect(680, 80, 324, 490))
    ],
    counted: [
      counted("check-row",      '[data-testid="rc19-check-row"]',        6),
      counted("glyph",          '[data-testid^="rc19-glyph-"]',          6),
      counted("state-output",   '[data-testid^="rc19-state-"]',          6),
      counted("cell",           '[data-testid="rc19-cell"]',             8),
      counted("row",            '[data-testid="rc19-row"]',              9),    // app: 9 rows
      counted("alerts-strip",   '[data-testid="rc19-alerts"]',           state !== "ready" ? 1 : 0),
      counted("fuel-plan-note", '[data-testid="rc19-fuel-plan-note"]',   0),
      counted("water-temp",     '[data-testid="rc19-water-temp"]',       1),    // app-only
      counted("voltage",        '[data-testid="rc19-voltage"]',          1),    // app-only
      counted("timeline",       '[data-testid="rc19-timeline"]',         1),    // app-only
      counted("timeline-empty", '[data-testid="rc19-timeline-empty"]',   1)
    ],
    timelineSegments: "0",
    leafTexts: appLeafTexts,
    rootText: appLeafTexts.join(" "),
    textOutputs: ["NOT READY", "12.6", "2.94", "88", "13.4"],
    // App brief: "40 px word needs a 54 px line box; the app header band is 52 px — pokes 1 px above frame".
    // The element box stays inside the frame; only the line box overhangs by 1 px (within the 2 px budget).
    readiness: { ...native.readiness, textRect: rect(32, -1, 200, 54) },
    ...overrides
  }
}

function entryFor(state = "ready", index = 0) {
  return { size: CAPTURE_SIZES[index], state, required: [] }
}

/**
 * Mutates a native-ready metrics object and asserts `validateCaptureMetrics` throws a
 * CaptureSafetyError whose message matches `expected`.
 */
function assertRejects(mutate, expected, state = "ready") {
  const metrics = mutate(nativeMetrics(state))
  assert.throws(
    () => validateCaptureMetrics(metrics, entryFor(state)),
    (error) => error instanceof CaptureSafetyError && expected.test(error.message),
    `expected a CaptureSafetyError matching ${expected}`
  )
}

/* ── PNG paint helpers ────────────────────────────────────────────────────────────────── */

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
  for (let y = box.top; y < box.top + box.height; y += 1) {
    for (let x = box.left; x < box.left + box.width; x += 1) {
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue
      const offset = (y * image.width + x) * 4
      image.data[offset]     = rgb[0]
      image.data[offset + 1] = rgb[1]
      image.data[offset + 2] = rgb[2]
      image.data[offset + 3] = 255
    }
  }
}

// Concrete RGB values for each token (computed from the hex strings).
const SIGNATURE_RGB = [0x34, 0xe0, 0xc0]  // #34E0C0 → cyan
const INFO_RGB      = [0x40, 0xbe, 0xdc]  // #40BEDC → cyan (same family as signature)
const NORMAL_RGB    = [0x46, 0xc8, 0x6e]  // #46C86E → green
const CAUTION_RGB   = [0xff, 0xb5, 0x2e]  // #FFB52E → amber
const DANGER_RGB    = [0xff, 0x3f, 0x30]  // #FF3F30 → red

/**
 * Paints a synthetic 800×480 capture for pixel-audit testing.
 *
 *   All states: canvas background + cyan (signature, always present on section titles).
 *   ready:      add green (normal — confirmed checklist items).
 *   alert:      add red inside the alert scope rects; no green.
 *   strayDanger: add a red rect outside the alert scope.
 *   blank:      skip all foreground painting.
 *   noCyan:     replace signature paint with neutral grey.
 *   amber:      add an amber rect (should always be absent).
 */
function capturePng(state, { strayDanger = false, blank = false, noCyan = false, amber = false } = {}) {
  const size = CAPTURE_SIZES[0]
  const image = paintPng(size, RC19_CANVAS_RGBA.slice(0, 3))
  if (blank) return PNG.sync.write(image)

  // Section titles always carry signature/cyan colour.
  if (!noCyan) {
    fillRect(image, rect(30, 15, 140, 15), SIGNATURE_RGB)  // header title area
    fillRect(image, rect(30, 70, 90, 15), SIGNATURE_RGB)   // "CAR STATE" label
    fillRect(image, rect(282, 70, 100, 15), SIGNATURE_RGB) // "SWAP CHECKLIST" label
    fillRect(image, rect(534, 70, 90, 15), SIGNATURE_RGB)  // "NEXT STINT" label
  } else {
    // Replace signature with neutral grey to trigger the absent check.
    fillRect(image, rect(30, 15, 140, 15), [100, 100, 100])
  }

  if (state === "ready") {
    // Confirmed checklist glyphs carry normal (green) colour.
    fillRect(image, rect(290, 90, 20, 20), NORMAL_RGB)    // SEAT glyph confirmed
    fillRect(image, rect(290, 120, 20, 20), NORMAL_RGB)   // BELTS glyph confirmed
    fillRect(image, rect(290, 150, 20, 20), NORMAL_RGB)   // WHEEL glyph confirmed
    fillRect(image, rect(290, 180, 20, 20), NORMAL_RGB)   // RADIO glyph confirmed
  } else {
    // Alert strip and blocking rows carry danger (red) colour.
    fillRect(image, NATIVE_ALERTS_RECT, DANGER_RGB)
    fillRect(image, NATIVE_BLOCKING_ROW_1, DANGER_RGB)
    fillRect(image, NATIVE_BLOCKING_ROW_2, DANGER_RGB)
  }

  if (strayDanger) {
    // A single red rect outside any alert scope — must trigger the scoped check.
    fillRect(image, rect(600, 300, 30, 20), DANGER_RGB)
  }
  if (amber) {
    fillRect(image, rect(400, 200, 20, 20), CAUTION_RGB)
  }
  return PNG.sync.write(image)
}

/* ══════════════════════════════════════════════════════════════════════════════════════ */
/* ── Matrix and contract ──────────────────────────────────────────────────────────────── */

test("the governed matrix covers every viewport in every governed state", () => {
  assert.equal(RC19_CAPTURE_MATRIX.length, CAPTURE_SIZES.length * CAPTURE_STATES.length)
  for (const state of CAPTURE_STATES) {
    for (const size of CAPTURE_SIZES) {
      const found = RC19_CAPTURE_MATRIX.find(
        (e) => e.state === state && e.size.width === size.width && e.size.height === size.height
      )
      assert.ok(found, `${state} ${size.width}x${size.height} is missing from the capture matrix`)
      assert.equal(expectedLayoutForBox(size.width, size.height), size.layout)
      assert.equal(expectedCompactModeForBox(size.width, size.height), size.compactMode)
    }
  }
})

test("each state waits for the correct published attribute set, never a frame count", () => {
  for (const entry of RC19_CAPTURE_MATRIX) {
    const required = Object.fromEntries(entry.required)
    if (entry.state === "ready") {
      assert.equal(required.alerts, "silent", `ready must gate on alerts=silent`)
      assert.equal(required.outstanding, "2",    `ready must gate on outstanding=2`)
    } else if (entry.state === "handover") {
      assert.equal(required.alerts, "active",  `handover must gate on alerts=active`)
      assert.equal(required.handover, "in-box",`handover must gate on handover=in-box`)
    } else {
      // cold-mount: only the pit-context gate
      assert.equal(required.handover, "in-box", `cold-mount must gate on handover=in-box`)
      assert.equal(required.alerts, undefined,  `cold-mount must NOT gate on alerts`)
    }
  }
})

test("the reference values are the approved attempt-003 channel values", () => {
  assert.equal(RC19_EXPECTED_VALUES.fuelLaps,     "12.6")
  assert.equal(RC19_EXPECTED_VALUES.fuelPerLap,   "2.94")
  assert.equal(RC19_EXPECTED_VALUES.stintLaps,    "28")
  assert.equal(RC19_EXPECTED_VALUES.tc,           "4")
  assert.equal(RC19_EXPECTED_VALUES.faultsNone,   "NONE ACTIVE")
  assert.equal(RC19_EXPECTED_VALUES.confirmLabel, "CONFIRM READY")
  assert.equal(RC19_EXPECTED_VALUES.tyreLf,       "1.94")
  assert.equal(RC19_EXPECTED_VALUES.tyreRf,       "1.97")
  assert.equal(RC19_EXPECTED_VALUES.tyreLr,       "1.91")
  assert.equal(RC19_EXPECTED_VALUES.tyreRr,       RC19_DASH)
})

/* ── Colour tokens ────────────────────────────────────────────────────────────────────── */

test("signature (#34E0C0) and info (#40BEDC) both classify as cyan — a documented collision", () => {
  // Both tokens share the same hue band (165°–200°) so hueFamilyOfHex cannot separate them.
  // Role — not hue — is the separator: signature paints section titles, info paints the
  // outstanding count and the armed confirm button.
  assert.equal(hueFamilyOfHex(RC19_SIGNATURE_HEX), "cyan", "signature must be cyan")
  assert.equal(hueFamilyOfHex(RC19_INFO_HEX),      "cyan", "info must be cyan (same family as signature)")
})

test("normal is green; danger is red; caution is amber", () => {
  assert.equal(hueFamilyOfHex(RC19_NORMAL_HEX),  "green", "normal #46C86E must be green")
  assert.equal(hueFamilyOfHex(RC19_DANGER_HEX),  "red",   "danger #FF3F30 must be red")
  assert.equal(hueFamilyOfHex(RC19_CAUTION_HEX), "amber", "caution #FFB52E must be amber")
})

test("info and normal have a near-zero luminance gap; hue is the only reliable separator", () => {
  // sRGB relative luminance: L = 0.2126 R + 0.7152 G + 0.0722 B (linearised channels).
  function linearise(c8bit) {
    const c = c8bit / 255
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  function luminance(r, g, b) {
    return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b)
  }

  const lInfo   = luminance(0x40, 0xbe, 0xdc)  // #40BEDC — info
  const lNormal = luminance(0x46, 0xc8, 0x6e)  // #46C86E — normal
  const gap = Math.abs(lInfo - lNormal)

  // The brief calls this "EXACTLY ZERO" — in practice the sRGB gap is < 1.5 %, far too small
  // for a luminance threshold to separate them reliably across rendering contexts.
  assert.ok(gap < 0.015, `luminance gap ${gap.toFixed(4)} must be < 0.015 (near-zero)`)

  // Hue cleanly separates them: info is cyan, normal is green.
  assert.equal(hueFamily(...INFO_RGB),   "cyan",  "info must be cyan by hue")
  assert.equal(hueFamily(...NORMAL_RGB), "green", "normal must be green by hue")
  assert.notEqual(hueFamily(...INFO_RGB), hueFamily(...NORMAL_RGB), "hue separates info from normal")
})

test("the type scale ladder is strictly ordered (40 > 30 > 24 > 15) — ties are failures", () => {
  const steps = [
    RC19_TYPE_SCALE_PX.readiness,
    RC19_TYPE_SCALE_PX.value,
    RC19_TYPE_SCALE_PX.item,
    RC19_TYPE_SCALE_PX.label
  ]
  assert.deepEqual(steps, [40, 30, 24, 15])
  for (let i = 1; i < steps.length; i += 1) {
    assert.ok(steps[i - 1] > steps[i], `${steps[i - 1]} must be strictly larger than ${steps[i]}`)
  }
})

/* ── Faithful fixtures ────────────────────────────────────────────────────────────────── */

test("a faithful native cold-mount fixture validates: 9 dashes, 6 PENDING, 0 CONFIRMED", () => {
  const audit = validateCaptureMetrics(nativeMetrics("cold-mount"), entryFor("cold-mount"))
  assert.equal(audit.dashCount, RC19_COLD_MOUNT_DASH_COUNT)
  assert.deepEqual(audit.knownDefects, [])
  assert.deepEqual(audit.zoneDefects, [])
  assert.deepEqual(audit.containmentDefects, [])
})

test("a faithful native handover fixture validates and reports alert-strip clearance", () => {
  const audit = validateCaptureMetrics(nativeMetrics("handover"), entryFor("handover"))
  assert.ok(typeof audit.alertClearance === "object")
  assert.ok(audit.alertClearance.faults.clearancePx >= 0,  `faults clearance must be ≥ 0`)
  assert.ok(audit.alertClearance.confirm.clearancePx >= 0, `confirm clearance must be ≥ 0`)
  assert.ok(audit.alertClearance.confirmLabel.clearancePx >= 0, `confirmLabel clearance must be ≥ 0`)
})

test("a faithful native ready fixture validates with reference literals and 8 dashes", () => {
  const audit = validateCaptureMetrics(nativeMetrics("ready"), entryFor("ready"))
  assert.equal(audit.dashCount, RC19_READY_DASH_COUNT)
  assert.deepEqual(audit.knownDefects, [])
  assert.deepEqual(audit.zoneDefects, [])
  assert.deepEqual(audit.containmentDefects, [])
})

test("a faithful app ready fixture validates with water-temp, voltage and timeline present", () => {
  const audit = validateCaptureMetrics(appMetrics("ready"), entryFor("ready", 1))
  assert.equal(audit.dashCount, RC19_READY_DASH_COUNT)
})

/* ── Fail-closed behaviour ────────────────────────────────────────────────────────────── */

test("a tie anywhere in the type scale is a failure, not a pass", () => {
  assertRejects(
    (m) => ({
      ...m,
      values: m.values.map((v) =>
        v.label === "outstanding" ? { ...v, fontSize: RC19_TYPE_SCALE_PX.value } : v
      )
    }),
    /type-scale hierarchy does not hold/u
  )
})

test("overlapping zones fail closed (non-exempt pair)", () => {
  assertRejects(
    (m) => ({
      ...m,
      zones: m.zones.map((z) =>
        z.name === "carState" ? { ...z, ...measured(rect(282, 66, 250, 384)) } : z
      )
    }),
    /overlaps/u
  )
})

test("an element that escapes its zone fails closed with the measured escape", () => {
  assertRejects(
    (m) => ({
      ...m,
      containment: m.containment.map((c) =>
        c.label === "fuel-laps in carState"
          ? { ...c, value: rect(30, 100, 400, 30) }  // escapes right side of carState
          : c
      )
    }),
    /fuel-laps in carState escapes its zone/u
  )
})

test("an element out of frame fails closed", () => {
  assertRejects(
    (m) => ({
      ...m,
      zones: m.zones.map((z) =>
        z.name === "nextStint" ? { ...z, ...measured(rect(750, 66, 250, 384)) } : z  // right edge off-screen
      )
    }),
    /is out of frame/u
  )
})

test("an unrecorded nowrap overflow fails closed even though scrollWidth agrees with clientWidth", () => {
  assertRejects(
    (m) => ({
      ...m,
      overflowLeaves: [
        {
          key: "rc19-fuel-laps",
          text: "12.6",
          fontSize: 30,
          whiteSpace: "nowrap",
          clientWidth: 100,
          scrollWidth: 100,
          overflowX: 22,
          textLeft: 30,
          textRight: 152
        }
      ]
    }),
    /rc19-fuel-laps "12\.6" paints 22px wider than its 100px box/u
  )
})

test("a zone whose content overflows its layout box fails closed", () => {
  assertRejects(
    (m) => ({
      ...m,
      zones: m.zones.map((z) =>
        z.name === "carState" ? { ...z, scrollHeight: z.layoutHeight + 30 } : z
      )
    }),
    /zone carState overflows its layout box by 30\.00px/u
  )
})

test("alert strip that occludes the FAULTS row fails closed (handover)", () => {
  assert.throws(
    () =>
      validateCaptureMetrics(
        nativeMetrics("handover", {
          alertsClearance: {
            alertsRect:       rect(8, 350, 784, 30),  // strip top = 350
            faultsRect:       rect(30, 300, 180, 60), // bottom = 360 > 350 → occluded!
            confirmRect:      NATIVE_CONFIRM_RECT,
            confirmLabelRect: NATIVE_CONFIRM_LBL_RECT
          }
        }),
        entryFor("handover")
      ),
    (error) => error instanceof CaptureSafetyError && /alert-floor band broken.*faults/su.test(error.message)
  )
})

test("alert strip that occludes the CONFIRM READY label fails closed (handover)", () => {
  assert.throws(
    () =>
      validateCaptureMetrics(
        nativeMetrics("handover", {
          alertsClearance: {
            alertsRect:       rect(8, 415, 784, 30),   // strip top = 415
            faultsRect:       NATIVE_FAULTS_RECT,       // bottom = 384 < 415 → passes
            confirmRect:      rect(282, 370, 236, 30),  // bottom = 400 < 415 → passes
            confirmLabelRect: rect(310, 406, 180, 15)   // bottom = 421 > 415 → occluded!
          }
        }),
        entryFor("handover")
      ),
    (error) => error instanceof CaptureSafetyError && /alert-floor band broken.*confirmLabel/su.test(error.message)
  )
})

/* ── Dash count ───────────────────────────────────────────────────────────────────────── */

test("cold-mount has exactly 9 leaf readouts equal to '--' (STINT LAPS is the 9th)", () => {
  const count = COLD_MOUNT_LEAF_TEXTS.filter((t) => t === RC19_DASH).length
  assert.equal(count, RC19_COLD_MOUNT_DASH_COUNT,
    "9 = RR + ABS + MAP + BIAS + TARGET LAPS + FUEL PLAN + TIRE PLAN + WEATHER + STINT LAPS")
})

test("ready state has exactly 8 leaf readouts equal to '--' (STINT LAPS reads 28)", () => {
  const count = READY_LEAF_TEXTS.filter((t) => t === RC19_DASH).length
  assert.equal(count, RC19_READY_DASH_COUNT,
    "8 = RR + ABS + MAP + BIAS + TARGET LAPS + FUEL PLAN + TIRE PLAN + WEATHER")
})

test("wrong cold-mount dash count (8 instead of 9) fails closed", () => {
  assertRejects(
    (m) => {
      // Remove STINT LAPS dash and replace with "28" to simulate a wrong cold-mount state.
      const leafTexts = [...m.leafTexts]
      const idx = leafTexts.findIndex((t, i) => t === "--" && leafTexts[i - 1] === "STINT LAPS")
      leafTexts.splice(idx, 1, "28")
      return { ...m, leafTexts, rootText: leafTexts.join(" ") }
    },
    /expected exactly 9 leaf readouts/u,
    "cold-mount"
  )
})

test("wrong ready dash count (9 instead of 8) fails closed", () => {
  assertRejects(
    (m) => {
      // Inject an extra "--" to simulate a dash-count regression (9 instead of 8).
      // We do NOT remove "28" from leafTexts; the reference-literals check for "28"
      // would fire first and mask the dash-count assertion.
      return { ...m, leafTexts: [...m.leafTexts, "--"] }
    },
    /expected exactly 8 leaf readouts/u,
    "ready"
  )
})

test("stint-laps reads '--' in cold-mount — the tracker has not marked a pit exit", () => {
  const stintLapsValue = nativeMetrics("cold-mount").values.find((v) => v.label === "stint-laps")
  assert.ok(stintLapsValue, "stint-laps value must be present")
  assert.equal(stintLapsValue.text, RC19_DASH,
    "STINT LAPS must dash on a cold mount (no observed pit exit)")
})

/* ── Packet omissions: absence is the contract ────────────────────────────────────────── */

test("ABS non-dash fails closed (GAP-3: no section 16 channel)", () => {
  assertRejects(
    (m) => ({
      ...m,
      values: m.values.map((v) => (v.label === "abs" ? { ...v, text: "0" } : v)),
      // Also replace the dash in leafTexts so dashCount doesn't error first.
      leafTexts: m.leafTexts.map((t, i) =>
        t === "--" && m.leafTexts[i - 1] === "ABS" ? "0" : t
      )
    }),
    /ABS must read "--"/u
  )
})

test("auto-confirmed checklist item in cold-mount fails closed (GAP-1: checklistChannel)", () => {
  assertRejects(
    (m) => ({
      ...m,
      // Inject a stray CONFIRMED leaf WITHOUT removing any PENDING.
      // PENDING count (6) still equals outstanding (6), so assertOutstandingAgreement passes;
      // assertPacketOmissions then catches the violation (confirmedRows > 0 → GAP-1).
      leafTexts: [...m.leafTexts, "CONFIRMED"]
    }),
    /GAP-1: checklist items are never auto-confirmed/u,
    "cold-mount"
  )
})

test("outstanding attribute disagreeing with PENDING count fails closed", () => {
  assertRejects(
    (m) => {
      // Remove one PENDING item from leafTexts so pendingRows (1) ≠ outstanding (2).
      // outstanding attr stays "2" so assertStateAttrs passes; assertOutstandingAgreement fires.
      const leafTexts = [...m.leafTexts]
      const idx = leafTexts.indexOf("PENDING")
      if (idx !== -1) leafTexts.splice(idx, 1)
      return { ...m, leafTexts }
    },
    /the DOM state and the published attribute disagree/u
  )
})

test("reintroducing a delta-to-best readout fails closed (omission: deltaToBest)", () => {
  assertRejects(
    (m) => ({
      ...m,
      forbidden: m.forbidden.map((f) =>
        f.label.includes("delta-to-best") ? { ...f, count: 1 } : f
      )
    }),
    /must not be rendered/u
  )
})

test("reintroducing a driver name or countdown fails closed (omission: driverIdentity)", () => {
  assertRejects(
    (m) => ({
      ...m,
      forbidden: m.forbidden.map((f) =>
        f.label.includes("driver name") ? { ...f, count: 1 } : f
      )
    }),
    /must not be rendered/u
  )
})

test("reintroducing a rev/LED/RPM surface fails closed (omission: revCue)", () => {
  assertRejects(
    (m) => ({
      ...m,
      forbidden: m.forbidden.map((f) =>
        f.label.includes("shift-LED") ? { ...f, count: 2 } : f
      )
    }),
    /must not be rendered/u
  )
})

test("reintroducing a gear or speed readout fails closed (omission: gearSpeedZones)", () => {
  assertRejects(
    (m) => ({
      ...m,
      forbidden: m.forbidden.map((f) =>
        f.label.includes("gear") ? { ...f, count: 1 } : f
      )
    }),
    /must not be rendered/u
  )
})

test("water-temp present on native fails closed (omission: tertiaryOnNative)", () => {
  assertRejects(
    (m) => ({
      ...m,
      counted: m.counted.map((c) =>
        c.label === "water-temp" ? { ...c, count: 1 } : c
      )
    }),
    /rc19-water-temp is app-only/u
  )
})

test("timeline segment count ≠ '0' fails closed (omission: stintPlanTimeline)", () => {
  assert.throws(
    () =>
      validateCaptureMetrics(
        appMetrics("ready", { timelineSegments: "3" }),
        entryFor("ready", 1)
      ),
    (error) => error instanceof CaptureSafetyError && /data-rc19-timeline-segments must be "0"/u.test(error.message)
  )
})

/* ── Readiness band and alert-strip clearance defect ledger ──────────────────────────── */

test("readiness element box leaving the frame fails closed (no allowance)", () => {
  // The element box must be fully inside the root frame with zero tolerance at any viewport.
  assertRejects(
    (m) => ({
      ...m,
      readiness: { ...m.readiness, rect: { ...m.readiness.rect, top: -5 } }
    }),
    /readiness element box.*leaves the.*frame/u
  )
})

test("readiness line-box overhang past 2 px fails closed (budget is 2 px)", () => {
  // The budget was measured at 1 px (app brief) plus 1 px font-metric allowance = 2 px.
  // Any overhang that exceeds 2 px must fail, even if only by 1 px.
  assertRejects(
    (m) => ({
      ...m,
      readiness: {
        ...m.readiness,
        textRect: { ...m.readiness.textRect, top: -3 }
      }
    }),
    /readiness line box escapes the frame by.*past the 2px/u
  )
})

test("FAULTS occlusion at 800x480 handover has no defect waiver — fails closed immediately", () => {
  // RC19_ALERT_FLOOR_DEFECTS records a waiver for 'confirm' only. Any FAULTS occlusion past
  // CLEARANCE_TOLERANCE_PX (2 px) must still fail with no budget allowance.
  assert.throws(
    () =>
      validateCaptureMetrics(
        nativeMetrics("handover", {
          alertsClearance: {
            alertsRect:       rect(8, 380, 784, 30),   // strip top = 380
            faultsRect:       rect(30, 360, 180, 24),  // bottom = 384 → occlusion = 4 px > 2 px budget
            confirmRect:      NATIVE_CONFIRM_RECT,
            confirmLabelRect: NATIVE_CONFIRM_LBL_RECT
          }
        }),
        entryFor("handover")
      ),
    (error) =>
      error instanceof CaptureSafetyError &&
      /alert-floor band broken.*faults/su.test(error.message)
  )
})

test("confirm occlusion past the 5 px budget at 800x480 handover fails closed", () => {
  // The waiver grants a 5 px budget; a 6 px overlap must still fail.
  assert.throws(
    () =>
      validateCaptureMetrics(
        nativeMetrics("handover", {
          alertsClearance: {
            alertsRect:       rect(8, 440, 784, 30),   // strip top = 440
            faultsRect:       NATIVE_FAULTS_RECT,       // bottom = 384 → clear ✓
            confirmRect:      NATIVE_CONFIRM_RECT,      // bottom = 446 → overlap = 6 px > 5 px budget
            confirmLabelRect: NATIVE_CONFIRM_LBL_RECT   // bottom = 435 → clear ✓
          }
        }),
        entryFor("handover")
      ),
    (error) =>
      error instanceof CaptureSafetyError &&
      /alert-floor band broken.*confirm.*past the 5px/su.test(error.message)
  )
})

/* ── Pixel audit ──────────────────────────────────────────────────────────────────────── */

test("the pixel audit accepts the ready frame: cyan present, green present, no red, no amber", () => {
  const png = capturePng("ready")
  const metrics = nativeMetrics("ready")
  const audit = validateCapturePixels(png, entryFor("ready"), metrics)
  assert.equal(audit.dangerHueFamily, "red")
  assert.equal(audit.signatureHueFamily, "cyan")
  assert.equal(audit.normalHueFamily, "green")
  assert.equal(audit.cautionHueFamily, "amber")
  assert.equal(audit.hueFamilies.red, 0)
  assert.equal(audit.hueFamilies.amber, 0)
  assert.ok(audit.hueFamilies.cyan > 0)
  assert.ok(audit.hueFamilies.green > 0)
})

test("the pixel audit accepts the handover frame: red scoped to alert strip and blocking rows", () => {
  const png = capturePng("handover")
  const metrics = nativeMetrics("handover")
  const audit = validateCapturePixels(png, entryFor("handover"), metrics)
  assert.ok(audit.hueFamilies.red > 0)
  assert.equal(audit.dangerOutsideScope, 0)
  assert.equal(audit.hueFamilies.green, 0)
  assert.equal(audit.hueFamilies.amber, 0)
})

test("a blank frame fails closed", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("ready", { blank: true }), entryFor("ready"), nativeMetrics("ready")),
    (error) => error instanceof CaptureSafetyError && /blank against the RC-19 canvas colour/u.test(error.message)
  )
})

test("a ready frame carrying one stray red pixel fails closed (mechanism: absent check)", () => {
  assert.throws(
    () =>
      validateCapturePixels(
        capturePng("ready", { strayDanger: true }),
        entryFor("ready"),
        nativeMetrics("ready")
      ),
    (error) => error instanceof CaptureSafetyError && /red hue family must be absent/u.test(error.message)
  )
})

test("a frame that has lost its signature colour fails closed (mechanism: present check)", () => {
  assert.throws(
    () =>
      validateCapturePixels(
        capturePng("ready", { noCyan: true }),
        entryFor("ready"),
        nativeMetrics("ready")
      ),
    (error) => error instanceof CaptureSafetyError && /cyan hue family must be painted/u.test(error.message)
  )
})

test("any amber fails closed on all states — carried-fault alert never fires in this fixture", () => {
  for (const state of CAPTURE_STATES) {
    assert.throws(
      () =>
        validateCapturePixels(
          capturePng(state, { amber: true }),
          entryFor(state),
          nativeMetrics(state)
        ),
      (error) => error instanceof CaptureSafetyError && /amber hue family must be absent/u.test(error.message),
      `amber must fail closed in state="${state}"`
    )
  }
})

/**
 * A channel-ratio test cannot separate the RC-19 palette:
 *
 *   info   #40BEDC — hue 191.5° (cyan) — green channel dominant? Not quite (blue ≈ 220 > green ≈ 190)
 *   normal #46C86E — hue 138.5° (green) — green clearly dominant
 *
 * A naive `g > r * 1.8` ratio accepts BOTH info and normal (both have high G relative to R), so
 * the ratio test cannot separate a "confirmed state" green from the info-class cyan. Hue can,
 * because 191.5° is cyan while 138.5° is green.
 *
 * Additionally, the luminance gap between info and normal is < 0.015 (~1.5 %), which is also too
 * small for a luminance threshold to separate them across rendering contexts.
 */
test("a channel-ratio test cannot separate info from normal but hue can", () => {
  const naiveGreenByRatio = ([r, g, _b]) => g > r * 1.8

  // Both info and normal pass the naive ratio test, so the ratio cannot distinguish them.
  assert.equal(naiveGreenByRatio(INFO_RGB),   true, "info confuses the ratio test")
  assert.equal(naiveGreenByRatio(NORMAL_RGB), true, "normal confuses the ratio test too")

  // Hue cleanly separates them.
  assert.equal(hueFamily(...INFO_RGB),   "cyan",  "info is cyan by hue")
  assert.equal(hueFamily(...NORMAL_RGB), "green", "normal is green by hue")

  // And hue correctly rejects the caution token that both ratio and brightness might confuse.
  assert.equal(hueFamily(...CAUTION_RGB), "amber", "caution is amber — distinct from both")
})

/* ── Disk safety comes from the shared harness, unforked ─────────────────────────────── */

test("the shared disk-safety primitives are available and fail closed on unsafe input", () => {
  assert.equal(typeof parseCaptureArgs, "function")
  assert.equal(typeof prepareCaptureOutput, "function")
  assert.equal(typeof createPrivateStaging, "function")
  assert.equal(typeof discardPrivateStaging, "function")
  // Requesting final mode without a committed HEAD must throw a CaptureSafetyError.
  assert.throws(() => parseCaptureArgs(["--mode", "final"]), CaptureSafetyError)
})
