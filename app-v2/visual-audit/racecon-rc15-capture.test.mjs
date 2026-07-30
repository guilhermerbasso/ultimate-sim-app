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
  RC15_BEAM_FULL_TRAVEL_DEG,
  RC15_BRAKE_BAR_CELLS,
  RC15_CAPTURE_MATRIX,
  RC15_CAUTION_HEX,
  RC15_CORNER_COLUMNS,
  RC15_DANGER_HEX,
  RC15_EXPECTED_VALUES,
  RC15_INFO_HEX,
  RC15_LIT_CELLS_HOT_FRONT,
  RC15_LIT_CELLS_SILENT_FRONT,
  RC15_LIT_CELLS_SILENT_REAR,
  RC15_PACKET_DANGER_HEX,
  RC15_SIGNATURE_HEX,
  RC15_SPEC,
  RC15_TOTAL_PAN_CELLS,
  RC15_TYPE_SCALE_PX,
  validateCaptureMetrics,
  validateCapturePixels
} from "./racecon-rc15-capture-lib.mjs"

/* ── Synthetic metric fixtures ────────────────────────────────────────────────────────── */

const CANVAS_RGB = [15, 12, 12]        // #0F0C0C
const SIGNATURE_RGB = [255, 94, 58]    // #FF5E3A brake heat  → red
const DANGER_RGB = [255, 31, 91]       // #FF1F5B shipped alarm → magenta
const PACKET_DANGER_RGB = [255, 59, 46] // #FF3B2E packet alarm → red (the reason for override 4)
const CAUTION_RGB = [255, 158, 44]     // #FF9E2C → amber
const INFO_RGB = [63, 176, 210]        // #3FB0D2 → cyan

function rect(left, top, width, height) {
  return { left, top, width, height }
}

function measured(box) {
  return { ...box, layoutWidth: box.width, layoutHeight: box.height, scrollWidth: box.width, scrollHeight: box.height }
}

function zone(name, box, display = "block") {
  return { name, selector: `[data-testid="rc15-panel-${name}"]`, present: true, display, ...measured(box) }
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
    color: "rgb(243, 236, 236)",
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
 * The native 800×480 grammar after normative override 1 moved the pans outward to x=60 and x=620
 * with symmetric 60 px outer margins, and override 2 grew the bias zone to (220, 212, 360, 104).
 */
const NATIVE_FRONT_PAN = rect(60, 80, 120, 120)
const NATIVE_BEAM = rect(180, 60, 440, 150)
const NATIVE_REAR_PAN = rect(620, 80, 120, 120)
const NATIVE_BIAS = rect(220, 212, 360, 104)

const REFERENCE_INDEX = -0.34
const HOT_ALERT_SCOPE = [NATIVE_FRONT_PAN]

function nativeMetrics(state = "silent", overrides = {}) {
  const size = CAPTURE_SIZES[0]
  const hot = state === "brake-hot"
  const frontText = hot ? "538" : "428"
  const frontLit = hot ? RC15_LIT_CELLS_HOT_FRONT : RC15_LIT_CELLS_SILENT_FRONT

  const biasValueBox = rect(240, 224, 140, 76)
  const biasHintBox = rect(400, 236, 150, 40)
  const balanceIndexBox = rect(360, 90, 110, 52)
  const balanceWordBox = rect(360, 150, 90, 24)
  const computedChipBox = rect(196, 68, 110, 20)
  const beamStageBox = rect(200, 100, 400, 60)
  const beamBarBox = rect(210, 120, 380, 12)
  const frontValueBox = rect(70, 90, 100, 46)
  const frontBarBox = rect(70, 150, 100, 30)
  const rearValueBox = rect(630, 90, 100, 46)
  const rearBarBox = rect(630, 150, 100, 30)
  const cornerBox = rect(24, 330, 120, 120)
  const cornerIndexBox = rect(30, 380, 100, 32)
  const cornerPairBox = rect(30, 416, 100, 20)
  const cornerTrackBox = rect(30, 350, 100, 14)
  const cornerDatumBox = rect(78, 350, 2, 14)

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
    presetId: RC15_SPEC.presetId,
    expectedWidgetId: RC15_SPEC.widgetId,
    renderedWidgetId: RC15_SPEC.widgetId,
    dashboardWidth: "1024",
    dashboardHeight: "600",
    sourceKind: "live-telemetry",
    sourceIdentity: RC15_SPEC.sourceIdentity,
    captureState: state,
    captureSequence: "143",
    layout: "native",
    compactMode: null,
    bufferState: "accepted",
    contentWidth: String(size.width),
    contentHeight: String(size.height),
    nativeSize: "800x480",
    trendPoints: null,
    stateAttributes: {
      alerts: hot ? "brake-hot-front" : "silent",
      balance: "UNDER",
      "beam-deg": String(REFERENCE_INDEX * RC15_BEAM_FULL_TRAVEL_DEG),
      "beam-pegged": "false",
      "scored-corners": "6"
    },
    zones: [
      zone("beam", NATIVE_BEAM),
      zone("frontPan", NATIVE_FRONT_PAN),
      zone("rearPan", NATIVE_REAR_PAN),
      zone("bias", NATIVE_BIAS)
    ],
    values: [
      value("bias", '[data-testid="rc15-bias-value"]', "56.4", biasValueBox, RC15_TYPE_SCALE_PX.bias),
      value("balanceIndex", '[data-testid="rc15-balance-index"]', String(REFERENCE_INDEX), balanceIndexBox, RC15_TYPE_SCALE_PX.balanceIndex),
      value("brakeTemp", '[data-testid="rc15-pan-value-front"]', frontText, frontValueBox, RC15_TYPE_SCALE_PX.brakeTemp),
      value("rearTemp", '[data-testid="rc15-pan-value-rear"]', "391", rearValueBox, RC15_TYPE_SCALE_PX.brakeTemp),
      value("cornerIndex", '[data-testid="rc15-corner-index"]', "-0.13", cornerIndexBox, RC15_TYPE_SCALE_PX.cornerStrip),
      value("balanceWord", '[data-testid="rc15-balance-word"]', "UNDER", balanceWordBox, 24),
      value("steering", '[data-testid="rc15-steering"]', "38", rect(200, 176, 60, 18), 18),
      value("latG", '[data-testid="rc15-latg"]', "1.32", rect(280, 176, 60, 18), 18)
    ],
    containment: [
      owned("balance index", NATIVE_BEAM, balanceIndexBox),
      owned("balance word", NATIVE_BEAM, balanceWordBox),
      owned("computed chip", NATIVE_BEAM, computedChipBox),
      owned("beam bar", beamStageBox, beamBarBox),
      owned("bias value", NATIVE_BIAS, biasValueBox),
      owned("bias hint", NATIVE_BIAS, biasHintBox),
      owned("front numeral", NATIVE_FRONT_PAN, frontValueBox),
      owned("front bar", NATIVE_FRONT_PAN, frontBarBox),
      owned("rear numeral", NATIVE_REAR_PAN, rearValueBox),
      owned("rear bar", NATIVE_REAR_PAN, rearBarBox),
      owned("corner index", cornerBox, cornerIndexBox),
      owned("corner pair", cornerBox, cornerPairBox),
      owned("corner marker", cornerTrackBox, cornerDatumBox)
    ],
    counted: [
      counted("corner", '[data-testid="rc15-corner"]', RC15_CORNER_COLUMNS),
      counted("pan cell", '[data-testid="rc15-pan-cell"]', RC15_TOTAL_PAN_CELLS),
      counted("lit cell", '[data-rc15-cell-lit="true"]', frontLit + RC15_LIT_CELLS_SILENT_REAR),
      counted("front lit", '[data-testid="rc15-panel-front-pan"] [data-rc15-cell-lit="true"]', frontLit),
      counted("rear lit", '[data-testid="rc15-panel-rear-pan"] [data-rc15-cell-lit="true"]', RC15_LIT_CELLS_SILENT_REAR),
      counted("front alert", '[data-testid="rc15-pan-alert-front"]', hot ? 1 : 0),
      counted("rear alert", '[data-testid="rc15-pan-alert-rear"]', 0),
      counted("corner marker", '[data-testid="rc15-corner-marker"]', 5),
      counted("strip", '[data-testid="rc15-panel-strip"]', 1),
      counted("corner map", '[data-testid="rc15-panel-corner-map"]', 0),
      counted("brake trend", '[data-testid="rc15-panel-brake-trend"]', 0),
      counted("context line", '[data-testid="rc15-context"]', 1),
      counted("map notice", '[data-testid="rc15-corner-map-notice"]', 0),
      counted("trend notice", '[data-testid="rc15-trend-notice"]', 0),
      counted("strip notice", '[data-testid="rc15-strip-notice"]', 0)
    ],
    forbidden: RC15_SPEC.forbidden.map(([label, selector]) => ({ label, selector, count: 0 })),
    textOutputs: ["56.4", frontText, "391", String(REFERENCE_INDEX)],
    leafTexts: [
      "CHASSIS BALANCE", "COMPUTED", String(REFERENCE_INDEX), "UNDER",
      "FRONT", "REAR", "FRONT", frontText, "DEG C", "REAR", "391",
      "BRAKE BIAS", "56.4", "% FRONT", "LAST ADJ", "--",
      "OBSERVED", "STEER", "38", "DEG", "LAT", "1.32", "G",
      "CORNER", "BALANCE", "INDEX", "BRAKE F / R",
      "C1", "-0.13"
    ],
    overflowLeaves: [],
    rootText:
      "CHASSIS BALANCE COMPUTED " + REFERENCE_INDEX + " UNDER FRONT REAR FRONT " + frontText +
      " DEG C REAR 391 BRAKE BIAS 56.4 % FRONT LAST ADJ -- CORNER OBSERVED STEER 38 DEG " +
      "LAT 1.32 G CORNER BALANCE INDEX BRAKE F / R C1 -0.13" + (hot ? " BRAKE HOT" : ""),
    errorBoundaryCount: 0,
    unknownWidgetCount: 0,
    failures: [],
    alertScope: hot ? HOT_ALERT_SCOPE : []
  }
  return { ...base, ...overrides }
}

function appMetrics(state = "silent", overrides = {}) {
  const size = CAPTURE_SIZES[1]
  const native = nativeMetrics(state)
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
    contentWidth: String(size.width),
    contentHeight: String(size.height),
    nativeSize: null,
    trendPoints: "42",
    zones: [
      zone("beam", rect(280, 60, 464, 180)),
      zone("frontPan", rect(40, 70, 240, 88)),
      zone("rearPan", rect(40, 162, 240, 88)),
      zone("bias", rect(280, 252, 464, 110))
    ],
    counted: native.counted.map((entry) => {
      if (entry.label === "strip") return { ...entry, count: 0 }
      if (entry.label === "corner map") return { ...entry, count: 1 }
      if (entry.label === "brake trend") return { ...entry, count: 1 }
      if (entry.label === "context line") return { ...entry, count: 2 }
      if (entry.label === "map notice") return { ...entry, count: 1 }
      return entry
    }),
    rootText: native.rootText + " NO TRACK MAP SOURCE",
    ...overrides
  }
}

function entryFor(state = "silent", index = 0) {
  return { size: CAPTURE_SIZES[index], state, required: [] }
}

function assertRejects(mutate, expected, state = "silent") {
  const metrics = mutate(nativeMetrics(state))
  assert.throws(
    () => validateCaptureMetrics(metrics, entryFor(state), RC15_SPEC),
    (error) => error instanceof CaptureSafetyError && expected.test(error.message),
    `expected a CaptureSafetyError matching ${expected}`
  )
}

/* ── Matrix and contract ──────────────────────────────────────────────────────────────── */

test("the governed matrix covers every viewport in every governed state", () => {
  assert.equal(RC15_CAPTURE_MATRIX.length, CAPTURE_SIZES.length * CAPTURE_STATES.length)
  for (const state of CAPTURE_STATES) {
    for (const size of CAPTURE_SIZES) {
      const entry = RC15_CAPTURE_MATRIX.find(
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

test("the brake-hot state waits for the published alert token rather than a frame count", () => {
  for (const entry of RC15_CAPTURE_MATRIX) {
    const required = Object.fromEntries(entry.required)
    assert.equal(required.alerts, entry.state === "brake-hot" ? "brake-hot-front" : "silent")
  }
})

/**
 * Normative override 4 is the reason this artifact can be audited by hue at all. The packet's
 * danger token lands in the SAME hue family as routine brake heat; the shipped retune does not.
 */
test("the shipped danger retune separates the alarm from brake heat by hue family", () => {
  assert.equal(hueFamilyOfHex(RC15_SIGNATURE_HEX), "red")
  assert.equal(hueFamilyOfHex(RC15_DANGER_HEX), "magenta")
  assert.equal(hueFamilyOfHex(RC15_CAUTION_HEX), "amber")
  assert.equal(hueFamilyOfHex(RC15_INFO_HEX), "cyan")
  // The packet token would have been indistinguishable from brake heat.
  assert.equal(hueFamilyOfHex(RC15_PACKET_DANGER_HEX), hueFamilyOfHex(RC15_SIGNATURE_HEX))
  assert.notEqual(hueFamilyOfHex(RC15_DANGER_HEX), hueFamilyOfHex(RC15_SIGNATURE_HEX))
})

test("the heat-bar rule is min(10, floor(t / 50)) for both pans", () => {
  assert.equal(Math.min(RC15_BRAKE_BAR_CELLS, Math.floor(428 / 50)), RC15_LIT_CELLS_SILENT_FRONT)
  assert.equal(Math.min(RC15_BRAKE_BAR_CELLS, Math.floor(391 / 50)), RC15_LIT_CELLS_SILENT_REAR)
  assert.equal(Math.min(RC15_BRAKE_BAR_CELLS, Math.floor(538 / 50)), RC15_LIT_CELLS_HOT_FRONT)
})

test("the packet type ladder is strictly ordered, so override 5's 'at least as tall' cannot tie", () => {
  const steps = [
    RC15_TYPE_SCALE_PX.bias,
    RC15_TYPE_SCALE_PX.balanceIndex,
    RC15_TYPE_SCALE_PX.brakeTemp,
    RC15_TYPE_SCALE_PX.cornerStrip
  ]
  for (let index = 1; index < steps.length; index += 1) {
    assert.ok(steps[index - 1] > steps[index], `${steps[index - 1]} must be strictly larger than ${steps[index]}`)
  }
})

/* ── Faithful fixtures ────────────────────────────────────────────────────────────────── */

test("a faithful native silent fixture validates and reports its type scale and beam", () => {
  const audit = validateCaptureMetrics(nativeMetrics("silent"), entryFor("silent"), RC15_SPEC)
  assert.deepEqual(
    audit.typeScale.map((step) => step.label),
    ["bias", "balanceIndex", "brakeTemp", "cornerIndex"]
  )
  assert.equal(audit.balance.index, REFERENCE_INDEX)
  assert.equal(audit.pans.frontLit, RC15_LIT_CELLS_SILENT_FRONT)
  assert.equal(audit.pans.rearLit, RC15_LIT_CELLS_SILENT_REAR)
  assert.equal(audit.reveals.corners, RC15_CORNER_COLUMNS)
  assert.deepEqual(audit.knownDefects, [])
  assert.deepEqual(audit.zoneDefects, [])
  assert.deepEqual(audit.containmentDefects, [])
})

test("a faithful native brake-hot fixture validates with the front pan pegged and badged", () => {
  const audit = validateCaptureMetrics(nativeMetrics("brake-hot"), entryFor("brake-hot"), RC15_SPEC)
  assert.equal(audit.pans.frontLit, RC15_LIT_CELLS_HOT_FRONT)
  assert.equal(audit.pans.rearLit, RC15_LIT_CELLS_SILENT_REAR)
})

test("a faithful app fixture validates with the corner map and brake trend revealed", () => {
  const audit = validateCaptureMetrics(appMetrics("silent"), entryFor("silent", 1), RC15_SPEC)
  assert.equal(audit.reveals.corners, RC15_CORNER_COLUMNS)
})

/* ── Fail-closed behaviour ────────────────────────────────────────────────────────────── */

test("a tie anywhere in the type scale is a failure, not a pass", () => {
  assertRejects((metrics) => {
    const values = metrics.values.map((entry) =>
      entry.label === "balanceIndex" ? { ...entry, fontSize: RC15_TYPE_SCALE_PX.bias } : entry
    )
    return { ...metrics, values }
  }, /type-scale hierarchy does not hold/u)
})

test("overlapping zones fail closed", () => {
  assertRejects((metrics) => {
    const zones = metrics.zones.map((entry) =>
      entry.name === "bias" ? { ...entry, ...measured(rect(180, 60, 440, 150)) } : entry
    )
    return { ...metrics, zones }
  }, /overlaps/u)
})

test("an element that escapes its zone fails closed with the measured escape", () => {
  assertRejects((metrics) => {
    const containment = metrics.containment.map((entry) =>
      entry.label === "bias value" ? { ...entry, value: rect(240, 224, 400, 76) } : entry
    )
    return { ...metrics, containment }
  }, /bias value escapes its zone on the right by \d+\.\d+px/u)
})

test("an element out of frame fails closed", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      zones: metrics.zones.map((entry) =>
        entry.name === "rearPan" ? { ...entry, ...measured(rect(760, 80, 120, 120)) } : entry
      )
    }),
    /is out of frame/u
  )
})

/**
 * The defect ledger is EMPTY for RC-15 by design: the implementation audit already found and fixed
 * the bias-stack overflow against the 110 px app zone and the compact-landscape bias overflow, so
 * an unrecorded overflow now is a NEW regression. This proves the sweep still fails closed.
 */
test("an unrecorded nowrap overflow fails closed even though scrollWidth agrees with clientWidth", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      overflowLeaves: [
        {
          key: "rc15-bias-value",
          text: "56.4",
          fontSize: 72,
          whiteSpace: "nowrap",
          clientWidth: 140,
          scrollWidth: 155,
          overflowX: 15,
          textLeft: 240,
          textRight: 395
        }
      ]
    }),
    /rc15-bias-value "56\.4" paints 15px wider than its 140px box/u
  )
})

test("a zone whose own content overflows its layout box fails closed", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      zones: metrics.zones.map((entry) =>
        entry.name === "bias" ? { ...entry, scrollHeight: entry.layoutHeight + 42 } : entry
      )
    }),
    /zone bias overflows its layout box by 42\.00px/u
  )
})

/**
 * The two RC-15 defects are FIXED, so both ledgers are empty and there is no waiver left for the
 * sweeps to consult. These two tests replay the exact measurements the shipped build produced and
 * prove each one now fails closed at the viewport it was observed at.
 */
test("the strip-label overflow now fails closed at the app canvas it was measured at", () => {
  assert.deepEqual(RC15_SPEC.knownDefects, [])
  const leaf = (overflowX) => ({
    key: "rc15-strip-label",
    text: "BRAKE F / R",
    fontSize: 18,
    whiteSpace: "nowrap",
    clientWidth: 70,
    scrollWidth: 70 + overflowX,
    overflowX,
    textLeft: 24,
    textRight: 24 + 70 + overflowX
  })
  // The exact leaf, at the exact measured size, at the exact canvas it was recorded at.
  for (const state of ["silent", "brake-hot"]) {
    assert.throws(
      () =>
        validateCaptureMetrics(
          appMetrics(state, { overflowLeaves: [leaf(28)] }),
          entryFor(state, 1),
          RC15_SPEC
        ),
      (error) =>
        error instanceof CaptureSafetyError &&
        /rc15-strip-label "BRAKE F \/ R" paints 28px wider than its 70px box/u.test(error.message)
    )
  }
  // "BALANCE" overflowed by only 2 px; there is no budget left to grow into, so 1 px fails too.
  assert.throws(
    () =>
      validateCaptureMetrics(
        appMetrics("silent", { overflowLeaves: [{ ...leaf(1), text: "BALANCE" }] }),
        entryFor("silent", 1),
        RC15_SPEC
      ),
    (error) => error instanceof CaptureSafetyError && /paints 1px wider/u.test(error.message)
  )
  // And the same overflow at the native canvas still fails, exactly as before.
  assertRejects(
    (metrics) => ({ ...metrics, overflowLeaves: [leaf(28)] }),
    /rc15-strip-label "BRAKE F \/ R" paints 28px wider than its 70px box/u
  )
})

test("the bias zone overrun now fails closed at the app canvas it was measured at", () => {
  assert.deepEqual(RC15_SPEC.zoneOverflowDefects, [])
  const withBiasOverrun = (base, extra) => ({
    ...base,
    zones: base.zones.map((entry) =>
      entry.name === "bias" ? { ...entry, scrollHeight: entry.layoutHeight + extra } : entry
    )
  })
  // The measured 7 px overrun, in both governed states, at the 1024x600 canvas.
  for (const state of ["silent", "brake-hot"]) {
    assert.throws(
      () => validateCaptureMetrics(withBiasOverrun(appMetrics(state), 7), entryFor(state, 1), RC15_SPEC),
      (error) =>
        error instanceof CaptureSafetyError && /zone bias overflows its layout box by 7\.00px/u.test(error.message)
    )
  }
  // A single pixel is enough: the ledger is empty, so there is nothing to grow into.
  assert.throws(
    () => validateCaptureMetrics(withBiasOverrun(appMetrics("silent"), 1), entryFor("silent", 1), RC15_SPEC),
    (error) =>
      error instanceof CaptureSafetyError && /zone bias overflows its layout box by 1\.00px/u.test(error.message)
  )
  // The same overrun at the native canvas still fails, exactly as before.
  assertRejects(
    (metrics) => withBiasOverrun(metrics, 7),
    /zone bias overflows its layout box by 7\.00px/u
  )
})

/* ── Packet omissions: absence is the contract ────────────────────────────────────────── */

test("reintroducing a rev cue, LED or RPM surface fails closed (omission: revCue)", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      forbidden: metrics.forbidden.map((entry) => (entry.label.includes("revCue") ? { ...entry, count: 1 } : entry))
    }),
    /omission: revCue.*must not be rendered/su
  )
})

test("reintroducing a tyre, gear or speed readout fails closed (omission: tyreGearSpeedZones)", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      forbidden: metrics.forbidden.map((entry) =>
        entry.label.includes("tyreGearSpeedZones") ? { ...entry, count: 2 } : entry
      )
    }),
    /omission: tyreGearSpeedZones.*must not be rendered/su
  )
})

test("reintroducing a delta-to-best readout fails closed (omission: deltaToBestZone)", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      forbidden: metrics.forbidden.map((entry) =>
        entry.label.includes("deltaToBestZone") ? { ...entry, count: 1 } : entry
      )
    }),
    /omission: deltaToBestZone.*must not be rendered/su
  )
})

test("printing the unratified brake hot limit fails closed (omission: alertThresholdValues)", () => {
  assertRejects(
    (metrics) => ({ ...metrics, leafTexts: [...metrics.leafTexts, "500"] }),
    /renders "500" as a readout/u
  )
})

test("the app corner map must state NO TRACK MAP SOURCE (omission: cornerMapGeometry)", () => {
  const metrics = appMetrics("silent", {
    counted: appMetrics("silent").counted.map((entry) =>
      entry.label === "map notice" ? { ...entry, count: 0 } : entry
    )
  })
  assert.throws(
    () => validateCaptureMetrics(metrics, entryFor("silent", 1), RC15_SPEC),
    (error) => error instanceof CaptureSafetyError && /NO TRACK MAP SOURCE/u.test(error.message)
  )
})

test("a brake trend with zero points must state NO BRAKE TREND SOURCE (omission: brakeTrendLapAxis)", () => {
  const base = appMetrics("silent")
  const metrics = { ...base, trendPoints: "0" }
  assert.throws(
    () => validateCaptureMetrics(metrics, entryFor("silent", 1), RC15_SPEC),
    (error) => error instanceof CaptureSafetyError && /NO BRAKE TREND SOURCE/u.test(error.message)
  )
})

/* ── Artifact promises ────────────────────────────────────────────────────────────────── */

test("a heat bar that contradicts its own numeral fails closed (override 8)", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      counted: metrics.counted.map((entry) => (entry.label === "front lit" ? { ...entry, count: 9 } : entry))
    }),
    /the front pan lights 9 cells, but min\(10, floor\(428 \/ 50\)\) = 8/u
  )
})

test("eleven or nine cells in a pan fails closed — both pans get exactly ten", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      counted: metrics.counted.map((entry) => (entry.label === "pan cell" ? { ...entry, count: 20 - 1 } : entry))
    }),
    /must render 20 heat cells \(10 per pan\), found 19/u
  )
})

test("a beam that drifts away from its own balance index fails closed", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      stateAttributes: { ...metrics.stateAttributes, "beam-deg": "-1.5" }
    }),
    /the beam is laid out at -1\.5deg but the balance index -0\.34 demands 4\.08deg of travel/u
  )
})

test("a pegged beam while balance-extreme is silent fails closed", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      stateAttributes: { ...metrics.stateAttributes, "beam-pegged": "true" }
    }),
    /must not be pegged/u
  )
})

test("asymmetric pans fail closed (override 1 moved them outward to equal margins)", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      zones: metrics.zones.map((entry) =>
        entry.name === "rearPan" ? { ...entry, ...measured(rect(620, 80, 96, 120)) } : entry
      )
    }),
    /the pans are not symmetric/u
  )
})

test("a wrong corner-column count fails closed (six observation ordinals, never turn numbers)", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      counted: metrics.counted.map((entry) => (entry.label === "corner" ? { ...entry, count: 5 } : entry))
    }),
    /must render exactly 6 corner columns, found 5/u
  )
})

test("more markers than scored corners fails closed", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      stateAttributes: { ...metrics.stateAttributes, "scored-corners": "3" },
      counted: metrics.counted.map((entry) => (entry.label === "corner marker" ? { ...entry, count: 5 } : entry))
    }),
    /5 corner markers are drawn but only 3 corners have been scored/u
  )
})

test("an alert in the silent state fails closed", () => {
  assertRejects(
    (metrics) => ({ ...metrics, stateAttributes: { ...metrics.stateAttributes, alerts: "brake-hot-front" } }),
    /must publish data-rc15-alerts="silent"/u
  )
})

test("a latched balance-extreme or bias-unavailable alert fails closed on this fixture", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      stateAttributes: { ...metrics.stateAttributes, alerts: "brake-hot-front balance-extreme" }
    }),
    /must not latch the balance-extreme alert/u,
    "brake-hot"
  )
  assertRejects(
    (metrics) => ({
      ...metrics,
      stateAttributes: { ...metrics.stateAttributes, alerts: "brake-hot-front bias-unavailable" }
    }),
    /must not latch the bias-unavailable alert/u,
    "brake-hot"
  )
})

test("a dashed bias readout fails closed while bias-unavailable is silent", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      values: metrics.values.map((entry) => (entry.label === "bias" ? { ...entry, text: "--" } : entry))
    }),
    /brake bias reads "--"/u
  )
})

test("the app layout must render the context line twice (omission: steerLatGAtApp)", () => {
  const base = appMetrics("silent")
  const metrics = {
    ...base,
    counted: base.counted.map((entry) => (entry.label === "context line" ? { ...entry, count: 1 } : entry))
  }
  assert.throws(
    () => validateCaptureMetrics(metrics, entryFor("silent", 1), RC15_SPEC),
    (error) => error instanceof CaptureSafetyError && /must render 2 context line\(s\), found 1/u.test(error.message)
  )
})

/* ── Pixel audit ──────────────────────────────────────────────────────────────────────── */

function paintPng(size, background) {
  const image = new PNG({ width: size.width, height: size.height })
  for (let y = 0; y < size.height; y += 1) {
    for (let x = 0; x < size.width; x += 1) {
      const offset = (y * size.width + x) * 4
      image.data[offset] = background[0]
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
      image.data[offset] = rgb[0]
      image.data[offset + 1] = rgb[1]
      image.data[offset + 2] = rgb[2]
      image.data[offset + 3] = 255
    }
  }
  return image
}

function capturePng(state, { strayDanger = false, blank = false, noSignature = false, amber = false } = {}) {
  const size = CAPTURE_SIZES[0]
  const image = paintPng(size, CANVAS_RGB)
  if (blank) return PNG.sync.write(image)
  fillRect(image, rect(200, 60, 400, 40), INFO_RGB)
  if (!noSignature) {
    fillRect(image, rect(70, 150, 100, 30), SIGNATURE_RGB)
    fillRect(image, rect(630, 150, 100, 30), SIGNATURE_RGB)
  } else {
    fillRect(image, rect(70, 150, 100, 30), [128, 128, 128])
  }
  if (state === "brake-hot") {
    // Danger inside the front pan, which is the element that owns the alert.
    fillRect(image, rect(64, 84, 100, 24), DANGER_RGB)
  }
  if (strayDanger) fillRect(image, rect(400, 400, 40, 20), DANGER_RGB)
  if (amber) fillRect(image, rect(300, 300, 20, 20), CAUTION_RGB)
  return PNG.sync.write(image)
}

test("the pixel audit accepts the silent frame: brake-heat red present, no magenta, no amber", () => {
  const audit = validateCapturePixels(capturePng("silent"), entryFor("silent"), nativeMetrics("silent"))
  assert.equal(audit.width, 800)
  assert.equal(audit.height, 480)
  assert.equal(audit.dangerHueFamily, "magenta")
  assert.equal(audit.signatureHueFamily, "red")
  assert.equal(audit.hueFamilies.magenta, 0)
  assert.equal(audit.hueFamilies.amber, 0)
  assert.ok(audit.hueFamilies.red > 0)
})

test("the pixel audit accepts a brake-hot frame whose danger stays inside the hot pan", () => {
  const audit = validateCapturePixels(capturePng("brake-hot"), entryFor("brake-hot"), nativeMetrics("brake-hot"))
  assert.ok(audit.hueFamilies.magenta > 0)
  assert.equal(audit.dangerOutsideScope, 0)
})

test("a blank frame fails closed", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { blank: true }), entryFor("silent"), nativeMetrics("silent")),
    (error) => error instanceof CaptureSafetyError && /blank against the RC-15 canvas colour/u.test(error.message)
  )
})

test("a silent frame carrying one danger pixel fails closed (mechanism: absent check)", () => {
  assert.throws(
    () =>
      validateCapturePixels(
        capturePng("silent", { strayDanger: true }),
        entryFor("silent"),
        nativeMetrics("silent")
      ),
    (error) => error instanceof CaptureSafetyError && /magenta hue family must be absent/u.test(error.message)
  )
})

test("a brake-hot frame whose danger leaks outside the hot pan fails closed (mechanism: scoped check)", () => {
  assert.throws(
    () =>
      validateCapturePixels(
        capturePng("brake-hot", { strayDanger: true }),
        entryFor("brake-hot"),
        nativeMetrics("brake-hot")
      ),
    (error) =>
      error instanceof CaptureSafetyError &&
      /magenta pixels fall outside the elements that own that alert/u.test(error.message)
  )
})

test("a frame that has lost its brake-heat surface fails closed (mechanism: present check)", () => {
  assert.throws(
    () =>
      validateCapturePixels(
        capturePng("silent", { noSignature: true }),
        entryFor("silent"),
        nativeMetrics("silent")
      ),
    (error) => error instanceof CaptureSafetyError && /red hue family must be painted/u.test(error.message)
  )
})

test("any amber fails closed on both frames — caution belongs to two alerts that never fire here", () => {
  for (const state of CAPTURE_STATES) {
    assert.throws(
      () =>
        validateCapturePixels(capturePng(state, { amber: true }), entryFor(state), nativeMetrics(state)),
      (error) => error instanceof CaptureSafetyError && /amber hue family must be absent/u.test(error.message)
    )
  }
})

/**
 * A channel-ratio test is not a colour test. `g < 0.62r && b < 0.62r` accepts the shipped danger,
 * the packet danger, brake heat and caution alike; only the hue angle separates them.
 */
test("a channel-ratio test cannot separate the RC-15 palette but hue can", () => {
  const ratioSaysRed = ([r, g, b]) => g < 0.62 * r && b < 0.62 * r
  assert.equal(ratioSaysRed(SIGNATURE_RGB), true)
  assert.equal(ratioSaysRed(DANGER_RGB), true)
  assert.equal(ratioSaysRed(PACKET_DANGER_RGB), true)
  assert.equal(ratioSaysRed(CAUTION_RGB), true)
  // Hue tells all four apart into three families, which is what the audit actually uses.
  assert.equal(hueFamily(...SIGNATURE_RGB), "red")
  assert.equal(hueFamily(...DANGER_RGB), "magenta")
  assert.equal(hueFamily(...PACKET_DANGER_RGB), "red")
  assert.equal(hueFamily(...CAUTION_RGB), "amber")
})

/* ── Disk safety comes from RC-01, unforked ───────────────────────────────────────────── */

test("the shared disk-safety primitives are the RC-01 originals, unforked", () => {
  assert.equal(typeof parseCaptureArgs, "function")
  assert.equal(typeof prepareCaptureOutput, "function")
  assert.equal(typeof createPrivateStaging, "function")
  assert.equal(typeof discardPrivateStaging, "function")
  assert.throws(() => parseCaptureArgs(["--mode", "final"]), CaptureSafetyError)
})

test("the reference values are the approved attempt-001 channel values", () => {
  assert.equal(RC15_EXPECTED_VALUES.frontPan, "428")
  assert.equal(RC15_EXPECTED_VALUES.rearPan, "391")
  assert.equal(RC15_EXPECTED_VALUES.bias, "56.4")
  assert.equal(RC15_EXPECTED_VALUES.balanceWord, "UNDER")
})
