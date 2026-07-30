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
  RC16_CANVAS_RGBA,
  RC16_CAPTURE_MATRIX,
  RC16_CAUTION_HEX,
  RC16_DANGER_HEX,
  RC16_EXPECTED_VALUES,
  RC16_INFO_HEX,
  RC16_LABEL_PX,
  RC16_NATIVE_CANVAS_WIDTH,
  RC16_PANEL_COUNT_APP,
  RC16_PANEL_COUNT_NATIVE_COMPACT,
  RC16_RING_DISPERSION_FULL_SCALE_S,
  RC16_RING_GUIDE_PCT,
  RC16_RING_MAX_MID_PCT,
  RC16_RING_MIN_MID_PCT,
  RC16_RING_NATIVE_ZONE_WIDTH,
  RC16_RING_NOMINAL_MID_PCT,
  RC16_RING_SEP_CEIL_PX,
  RC16_RING_SEP_FLOOR_PX,
  RC16_RING_STROKE_PCT,
  RC16_SIGNATURE_HEX,
  RC16_SPEC,
  RC16_SVG_VIEWBOX_WIDTH,
  RC16_TYPE_SCALE_PX,
  RC16_ZONE_COUNT_APP,
  RC16_ZONE_COUNT_NATIVE_COMPACT,
  validateCaptureMetrics,
  validateCapturePixels
} from "./racecon-rc16-capture-lib.mjs"

/* ── Synthetic metric fixtures ────────────────────────────────────────────────────────── */

// Colour channel values for synthetic PNG painting
const CANVAS_RGB = [RC16_CANVAS_RGBA[0], RC16_CANVAS_RGBA[1], RC16_CANVAS_RGBA[2]]  // #0A0E0D
const SIGNATURE_RGB = [122, 224, 176]   // #7AE0B0 → green (ring band)
const INFO_RGB = [72, 192, 200]         // #48C0C8 → cyan (smoothness fill)
const CAUTION_RGB = [240, 194, 60]      // #F0C23C → amber (over-rev cue)
const DANGER_RGB = [240, 96, 62]        // #F0603E → red (NEVER rendered)

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

function zone(name, box, display = "block") {
  return { name, selector: `[data-testid="rc16-${name}"]`, present: true, display, ...measured(box) }
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
    color: "rgb(234, 243, 240)",
    display: "block"
  }
}

function owned(label, ownerBox, valueBox) {
  return { label, owner: ownerBox, ownerDisplay: "block", value: valueBox, valueDisplay: "block" }
}

function counted(label, selector, count) {
  return { label, selector, count }
}

// Ring viewBox radius for a canvas-width percent: r_vb = pct * 800/260
function ringViewBoxRadius(pct) {
  return Math.round((pct * RC16_NATIVE_CANVAS_WIDTH / RC16_RING_NATIVE_ZONE_WIDTH) * 1000) / 1000
}

// Native-equivalent gap from viewBox attributes
function ringNativeEquivGapPx(midPct) {
  const guideRVb = ringViewBoxRadius(RC16_RING_GUIDE_PCT)
  const bandRVb = ringViewBoxRadius(midPct)
  const bandSwVb = ringViewBoxRadius(RC16_RING_STROKE_PCT)
  const gapVb = guideRVb - (bandRVb + bandSwVb / 2)
  return gapVb * RC16_RING_NATIVE_ZONE_WIDTH / RC16_SVG_VIEWBOX_WIDTH
}

// Ring mid radius from dispersion
function rc16RingMidRadiusPct(dispersionSec) {
  if (dispersionSec === null || dispersionSec < 0) return null
  const span = RC16_RING_MAX_MID_PCT - RC16_RING_MIN_MID_PCT
  const fraction = Math.min(1, Math.max(0, dispersionSec / RC16_RING_DISPERSION_FULL_SCALE_S))
  return RC16_RING_MIN_MID_PCT + fraction * span
}

// Reference zone rects for native 800x480
const NATIVE_RING = rect(270, 50, 260, 260)
const NATIVE_SMOOTHNESS = rect(40, 80, 200, 200)
const NATIVE_CUE = rect(560, 80, 200, 200)
const NATIVE_DELTA = rect(300, 320, 200, 60)
const NATIVE_SUMMARY = rect(40, 320, 240, 120)

// Ring measurement at reference (mid≈12, dispersion=0.42s)
const REFERENCE_MID_PCT = rc16RingMidRadiusPct(0.42)  // ≈11.99 ≈12
const REFERENCE_GUIDE_R_VB = ringViewBoxRadius(RC16_RING_GUIDE_PCT)
const REFERENCE_BAND_R_VB = ringViewBoxRadius(REFERENCE_MID_PCT)
const REFERENCE_BAND_SW_VB = ringViewBoxRadius(RC16_RING_STROKE_PCT)

const ALERT_SCOPE = [NATIVE_CUE]  // amber scoped to cue panel

function nativeMetrics(state = "silent", overrides = {}) {
  const size = CAPTURE_SIZES[0]  // 800x480 native

  const consistencyBox = rect(330, 190, 130, 70)
  const smoothnessBox = rect(60, 200, 160, 50)
  const deltaBox = rect(320, 326, 160, 48)  // bottom=374; NATIVE_DELTA.bottom=380 → no escape
  const lastLapBox = rect(60, 360, 200, 36)
  const bandSummaryBox = rect(60, 400, 200, 36)
  const cueIconBox = rect(580, 130, 30, 30)
  const cueLinesBox = rect(570, 170, 170, 60)

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
    presetId: RC16_SPEC.presetId,
    expectedWidgetId: RC16_SPEC.widgetId,
    renderedWidgetId: RC16_SPEC.widgetId,
    dashboardWidth: "1024",
    dashboardHeight: "600",
    sourceKind: "live-telemetry",
    sourceIdentity: RC16_SPEC.sourceIdentity,
    captureState: state,
    captureSequence: "78",
    layout: "native",
    compactMode: null,
    bufferState: "accepted",
    contentWidth: String(size.width),
    contentHeight: String(size.height),
    nativeSize: "800x480",
    stateAttributes: {
      alerts: state === "over-rev" ? "active" : "silent",
      focus: "braking",
      laps: "3"
    },
    zones: [
      zone("ring",       NATIVE_RING),
      zone("smoothness", NATIVE_SMOOTHNESS),
      zone("cue",        NATIVE_CUE),
      zone("delta",      NATIVE_DELTA),
      zone("summary",    NATIVE_SUMMARY)
    ],
    values: [
      value("consistency", '[data-testid="rc16-consistency"]', RC16_EXPECTED_VALUES.consistency, consistencyBox, RC16_TYPE_SCALE_PX.ringValue),
      value("smoothness",  '[data-testid="rc16-smoothness"]',  RC16_EXPECTED_VALUES.smoothness,  smoothnessBox, RC16_TYPE_SCALE_PX.smoothness),
      value("delta",       '[data-testid="rc16-delta"]',       RC16_EXPECTED_VALUES.delta,       deltaBox, RC16_TYPE_SCALE_PX.delta),
      value("lastLap",     '[data-testid="rc16-summary-lastLap"]', RC16_EXPECTED_VALUES.lastLap, lastLapBox, RC16_TYPE_SCALE_PX.summary),
      value("bandSummary", '[data-testid="rc16-summary-consistency"]', RC16_EXPECTED_VALUES.consistency, bandSummaryBox, RC16_TYPE_SCALE_PX.summary),
      // The cue RUNG is measured from the individual cue-line element, not the container.
      // Selector matches spec.values["cue"]: [data-testid="rc16-cue-lines"] .rc16-cue-line
      value("cue", '[data-testid="rc16-cue-lines"] .rc16-cue-line', RC16_EXPECTED_VALUES.cueLine0, rect(570, 170, 170, 30), RC16_TYPE_SCALE_PX.cue)
    ],
    containment: [
      owned("consistency value", NATIVE_RING,      consistencyBox),
      owned("smoothness value",  NATIVE_SMOOTHNESS, smoothnessBox),
      owned("cue lines",         NATIVE_CUE,       cueLinesBox),
      owned("delta value",       NATIVE_DELTA,     deltaBox),
      owned("lastLap value",     NATIVE_SUMMARY,   lastLapBox),
      owned("bandSummary value", NATIVE_SUMMARY,   bandSummaryBox)
    ],
    counted: [
      counted("summary row",       '[data-testid="rc16-summary-row"]', 2),
      counted("cue line",          '.rc16-cue-line', 2),
      counted("panel",             '.rc16-panel', RC16_PANEL_COUNT_NATIVE_COMPACT),
      counted("zone",              '[data-rc16-zone]', RC16_ZONE_COUNT_NATIVE_COMPACT),
      counted("history panel",     '[data-testid="rc16-history-panel"]', 0),
      counted("history point",     '[data-testid="rc16-history-point"]', 0),
      counted("history notice",    '[data-testid="rc16-history-notice"]', 0),
      counted("smoothness notice", '[data-testid="rc16-smoothness-notice"]', 0),
      counted("cue notice",        '[data-testid="rc16-cue-notice"]', 0),
      counted("source notice",     '[data-testid="rc16-source-notice"]', 0),
      counted("focus selector",    '[data-testid="rc16-focus-selector"]', 1)
    ],
    forbidden: RC16_SPEC.forbidden.map(([label, selector]) => ({ label, selector, count: 0 })),
    textOutputs: [RC16_EXPECTED_VALUES.consistency, RC16_EXPECTED_VALUES.smoothness, RC16_EXPECTED_VALUES.delta, RC16_EXPECTED_VALUES.lastLap],
    leafTexts: [
      "BAND", RC16_EXPECTED_VALUES.consistency, "S",
      "SMOOTHNESS", RC16_EXPECTED_VALUES.smoothness,
      "NEXT STEP",
      state === "over-rev" ? "EASE OFF" : RC16_EXPECTED_VALUES.cueLine0,
      state === "over-rev" ? "UPSHIFT"  : RC16_EXPECTED_VALUES.cueLine1,
      "DELTA", RC16_EXPECTED_VALUES.delta,
      "LAST LAP", RC16_EXPECTED_VALUES.lastLap,
      "CONSISTENCY", RC16_EXPECTED_VALUES.consistency
    ],
    overflowLeaves: [],
    rootText:
      `BAND ${RC16_EXPECTED_VALUES.consistency} S ` +
      `SMOOTHNESS ${RC16_EXPECTED_VALUES.smoothness} ` +
      `NEXT STEP ` +
      (state === "over-rev" ? "EASE OFF UPSHIFT " : `${RC16_EXPECTED_VALUES.cueLine0} ${RC16_EXPECTED_VALUES.cueLine1} `) +
      `DELTA ${RC16_EXPECTED_VALUES.delta} S ` +
      `LAST LAP ${RC16_EXPECTED_VALUES.lastLap} ` +
      `CONSISTENCY ${RC16_EXPECTED_VALUES.consistency}`,
    errorBoundaryCount: 0,
    unknownWidgetCount: 0,
    failures: [],
    ringMeasurement: {
      guideRVb: REFERENCE_GUIDE_R_VB,
      bandRVb: REFERENCE_BAND_R_VB,
      bandSwVb: REFERENCE_BAND_SW_VB,
      svgRenderedWidth: 260,
      svgViewBoxWidth: RC16_SVG_VIEWBOX_WIDTH,
      ringMid: String(REFERENCE_MID_PCT),
      ringGap: "2.25"
    },
    alertScope: state === "over-rev" ? ALERT_SCOPE : [],
    cuePanelAlert: state === "over-rev" ? "true" : "false",
    cuePanelIsAlert: state === "over-rev",
    // smoothnessFillRatio agrees with the "82" numeral so the bar-vs-numeral check passes.
    smoothnessFillRatio: 0.82,
    historyGapWithData: false
  }
  return { ...base, ...overrides }
}

function appMetrics(state = "silent", overrides = {}) {
  const size = CAPTURE_SIZES[1]  // 1024x600 app
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
    zones: [
      zone("ring",       rect(372, 60, 300, 300)),
      zone("smoothness", rect(48, 80, 260, 300)),
      zone("cue",        rect(716, 80, 260, 300)),
      zone("delta",      rect(716, 400, 260, 160)),
      zone("summary",    rect(48, 400, 260, 160))
    ],
    counted: native.counted.map((entry) => {
      if (entry.label === "panel")         return { ...entry, count: RC16_PANEL_COUNT_APP }
      if (entry.label === "zone")          return { ...entry, count: RC16_ZONE_COUNT_APP }
      if (entry.label === "history panel") return { ...entry, count: 1 }
      if (entry.label === "history point") return { ...entry, count: 3 }
      return entry
    }),
    ...overrides
  }
}

function entryFor(state = "silent", index = 0) {
  return { size: CAPTURE_SIZES[index], state, required: [] }
}

function assertRejects(mutate, expected, state = "silent") {
  const metrics = mutate(nativeMetrics(state))
  assert.throws(
    () => validateCaptureMetrics(metrics, entryFor(state), RC16_SPEC),
    (error) => error instanceof CaptureSafetyError && expected.test(error.message),
    `expected a CaptureSafetyError matching ${expected}`
  )
}

/* ── Matrix and contract ──────────────────────────────────────────────────────────────── */

test("the governed matrix covers every viewport in every governed state", () => {
  assert.equal(RC16_CAPTURE_MATRIX.length, CAPTURE_SIZES.length * CAPTURE_STATES.length)
  for (const state of CAPTURE_STATES) {
    for (const size of CAPTURE_SIZES) {
      const entry = RC16_CAPTURE_MATRIX.find(
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

test("the over-rev state waits for the published alert token rather than a frame count", () => {
  for (const entry of RC16_CAPTURE_MATRIX) {
    const required = Object.fromEntries(entry.required)
    assert.equal(required.alerts, entry.state === "over-rev" ? "active" : "silent")
  }
})

/* ── Colour family classification ────────────────────────────────────────────────────── */

test("the RC-16 palette classifies into four distinct hue families", () => {
  assert.equal(hueFamilyOfHex(RC16_SIGNATURE_HEX), "green")    // ring band — always painted
  assert.equal(hueFamilyOfHex(RC16_INFO_HEX), "cyan")          // smoothness fill
  assert.equal(hueFamilyOfHex(RC16_CAUTION_HEX), "amber")      // over-rev alert only
  assert.equal(hueFamilyOfHex(RC16_DANGER_HEX), "red")         // NEVER rendered (omission: dangerToken)
  // All four are distinct — a pixel count in one family cannot mask another
  assert.notEqual(hueFamilyOfHex(RC16_SIGNATURE_HEX), hueFamilyOfHex(RC16_INFO_HEX))
  assert.notEqual(hueFamilyOfHex(RC16_SIGNATURE_HEX), hueFamilyOfHex(RC16_CAUTION_HEX))
  assert.notEqual(hueFamilyOfHex(RC16_SIGNATURE_HEX), hueFamilyOfHex(RC16_DANGER_HEX))
  assert.notEqual(hueFamilyOfHex(RC16_INFO_HEX), hueFamilyOfHex(RC16_CAUTION_HEX))
})

/* ── Type scale ordering ──────────────────────────────────────────────────────────────── */

test("the type ladder is strictly ordered so no re-spacing can introduce a tie undetected", () => {
  const steps = [
    RC16_TYPE_SCALE_PX.ringValue,
    RC16_TYPE_SCALE_PX.delta,
    RC16_TYPE_SCALE_PX.smoothness,
    RC16_TYPE_SCALE_PX.cue,
    RC16_TYPE_SCALE_PX.summary
  ]
  for (let index = 1; index < steps.length; index += 1) {
    assert.ok(
      steps[index - 1] > steps[index],
      `type scale step ${index - 1} (${steps[index - 1]}) must be strictly larger than step ${index} (${steps[index]})`
    )
  }
  // Label is always smaller than summary
  assert.ok(RC16_LABEL_PX < RC16_TYPE_SCALE_PX.summary)
})

/* ── Ring monotonicity ────────────────────────────────────────────────────────────────── */

test("rc16RingMidRadiusPct is non-decreasing in dispersion (monotonicity proof)", () => {
  const samples = 30
  let prevMid = null
  for (let index = 0; index <= samples; index += 1) {
    const d = (index / samples) * RC16_RING_DISPERSION_FULL_SCALE_S
    const mid = rc16RingMidRadiusPct(d)
    assert.ok(mid !== null, `mid is null at dispersion ${d}`)
    assert.ok(mid >= RC16_RING_MIN_MID_PCT, `mid ${mid} falls below RC16_RING_MIN_MID_PCT=${RC16_RING_MIN_MID_PCT} at d=${d}`)
    assert.ok(mid <= RC16_RING_MAX_MID_PCT, `mid ${mid} exceeds RC16_RING_MAX_MID_PCT=${RC16_RING_MAX_MID_PCT} at d=${d}`)
    if (prevMid !== null) {
      assert.ok(mid >= prevMid - 0.001, `midRadiusPct is not monotonic: ${prevMid} → ${mid} at d=${d}`)
    }
    prevMid = mid
  }
})

test("the ring gap is non-increasing in dispersion (larger dispersion → smaller gap)", () => {
  const samples = 30
  let prevGap = null
  for (let index = 0; index <= samples; index += 1) {
    const d = (index / samples) * RC16_RING_DISPERSION_FULL_SCALE_S
    const mid = rc16RingMidRadiusPct(d)
    assert.ok(mid !== null)
    const gapPx = ringNativeEquivGapPx(mid)
    assert.ok(gapPx >= RC16_RING_SEP_FLOOR_PX - 0.01,
      `gap ${gapPx.toFixed(3)} px falls below floor ${RC16_RING_SEP_FLOOR_PX} px at d=${d}, mid=${mid}`)
    if (prevGap !== null) {
      assert.ok(gapPx <= prevGap + 0.01, `gap is not monotonically decreasing: ${prevGap.toFixed(3)} → ${gapPx.toFixed(3)} at d=${d}`)
    }
    prevGap = gapPx
  }
})

/* ── Ring separation floor and ceiling ───────────────────────────────────────────────── */

test("at full-scale dispersion the gap reaches exactly the 8.00 px floor", () => {
  const mid = rc16RingMidRadiusPct(RC16_RING_DISPERSION_FULL_SCALE_S)
  assert.ok(Math.abs(mid - RC16_RING_MAX_MID_PCT) < 0.01, `mid at full scale must be RC16_RING_MAX_MID_PCT=${RC16_RING_MAX_MID_PCT}, got ${mid}`)
  const gapPx = ringNativeEquivGapPx(mid)
  assert.ok(Math.abs(gapPx - 8.0) < 0.05, `gap at full scale must be 8.0 px, got ${gapPx.toFixed(3)}`)
  assert.ok(gapPx >= RC16_RING_SEP_FLOOR_PX, `gap ${gapPx.toFixed(3)} falls below the ${RC16_RING_SEP_FLOOR_PX} px floor`)
})

test("at the approved reference dispersion (0.42 s) the gap is approximately 18 px", () => {
  const mid = rc16RingMidRadiusPct(0.42)
  assert.ok(Math.abs(mid - RC16_RING_NOMINAL_MID_PCT) < 0.05, `mid at 0.42 s must be ≈ 12, got ${mid}`)
  const gapPx = ringNativeEquivGapPx(mid)
  assert.ok(Math.abs(gapPx - 18.0) < 0.5, `gap at reference dispersion must be ≈ 18 px, got ${gapPx.toFixed(3)}`)
  assert.ok(gapPx <= RC16_RING_SEP_CEIL_PX, `gap ${gapPx.toFixed(3)} exceeds the ${RC16_RING_SEP_CEIL_PX} px ceiling`)
})

/* ── Faithful fixtures validate ──────────────────────────────────────────────────────── */

test("a faithful native silent fixture validates and reports its type scale and ring separation", () => {
  const audit = validateCaptureMetrics(nativeMetrics("silent"), entryFor("silent"), RC16_SPEC)
  assert.deepEqual(
    audit.typeScale.map((step) => step.label),
    ["ringValue", "delta", "smoothness", "cue", "summary"]
  )
  assert.ok(audit.ringSeparation.nativeEquivGapPx >= RC16_RING_SEP_FLOOR_PX)
  assert.ok(audit.ringSeparation.nativeEquivGapPx <= RC16_RING_SEP_CEIL_PX)
  assert.deepEqual(audit.knownDefects, [])
  assert.deepEqual(audit.zoneDefects, [])
  assert.deepEqual(audit.containmentDefects, [])
})

test("a faithful native over-rev fixture validates with caution active and ring still present", () => {
  const audit = validateCaptureMetrics(nativeMetrics("over-rev"), entryFor("over-rev"), RC16_SPEC)
  assert.ok(audit.ringSeparation.nativeEquivGapPx >= RC16_RING_SEP_FLOOR_PX)
})

test("a faithful app silent fixture validates with history panel revealed", () => {
  const audit = validateCaptureMetrics(appMetrics("silent"), entryFor("silent", 1), RC16_SPEC)
  assert.ok(audit.ringSeparation.nativeEquivGapPx >= RC16_RING_SEP_FLOOR_PX)
})

/* ── Fail-closed: type-scale ties ────────────────────────────────────────────────────── */

test("a tie anywhere in the type scale is a failure, not a pass", () => {
  assertRejects((metrics) => {
    const values = metrics.values.map((entry) =>
      entry.label === "smoothness" ? { ...entry, fontSize: RC16_TYPE_SCALE_PX.delta } : entry
    )
    return { ...metrics, values }
  }, /type-scale hierarchy does not hold/u)
})

/* ── Fail-closed: zone checks ────────────────────────────────────────────────────────── */

test("overlapping zones fail closed", () => {
  assertRejects((metrics) => {
    const zones = metrics.zones.map((entry) =>
      entry.name === "delta" ? { ...entry, ...measured(rect(270, 50, 260, 260)) } : entry
    )
    return { ...metrics, zones }
  }, /overlaps/u)
})

test("an element that escapes its zone fails closed with the measured escape", () => {
  assertRejects((metrics) => {
    const containment = metrics.containment.map((entry) =>
      entry.label === "delta value" ? { ...entry, value: rect(300, 332, 500, 52) } : entry
    )
    return { ...metrics, containment }
  }, /delta value escapes its zone on the right by \d+\.\d+px/u)
})

test("an element out of frame fails closed", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      zones: metrics.zones.map((entry) =>
        entry.name === "summary" ? { ...entry, ...measured(rect(780, 320, 240, 120)) } : entry
      )
    }),
    /is out of frame/u
  )
})

test("an unrecorded nowrap overflow fails closed", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      overflowLeaves: [
        {
          key: "rc16-consistency",
          text: "0.42",
          fontSize: 56,
          whiteSpace: "nowrap",
          clientWidth: 80,
          scrollWidth: 95,
          overflowX: 15,
          textLeft: 330,
          textRight: 425
        }
      ]
    }),
    /rc16-consistency "0\.42" paints 15px wider than its 80px box/u
  )
})

test("a zone whose own content overflows its layout box fails closed", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      zones: metrics.zones.map((entry) =>
        entry.name === "smoothness" ? { ...entry, scrollHeight: entry.layoutHeight + 30 } : entry
      )
    }),
    /zone smoothness overflows its layout box by 30\.00px/u
  )
})

/* ── Packet omissions: absence is the contract ────────────────────────────────────────── */

test("reintroducing a shift-LED or RPM surface fails closed (omission: shiftLightZone)", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      forbidden: metrics.forbidden.map((entry) =>
        entry.label.includes("shiftLightZone") ? { ...entry, count: 1 } : entry
      )
    }),
    /omission: shiftLightZone.*must not be rendered/su
  )
})

test("reintroducing a gear or speed readout fails closed (omission: cornerSpeedAndGearZone)", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      forbidden: metrics.forbidden.map((entry) =>
        entry.label.includes("cornerSpeedAndGearZone") ? { ...entry, count: 2 } : entry
      )
    }),
    /omission: cornerSpeedAndGearZone.*must not be rendered/su
  )
})

test("reintroducing an RPM or best-lap surface fails closed (omission: speedRpmBestLapZone)", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      forbidden: metrics.forbidden.map((entry) =>
        entry.label.includes("speedRpmBestLapZone") ? { ...entry, count: 1 } : entry
      )
    }),
    /omission: speedRpmBestLapZone.*must not be rendered/su
  )
})

test("a cue naming a corner turn fails closed (omission: cueCornerId)", () => {
  assertRejects(
    (metrics) => ({ ...metrics, leafTexts: [...metrics.leafTexts, "T3"] }),
    /cue line names a corner turn "T3"/u
  )
})

test("the history panel is app-only; showing it outside app fails closed", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      counted: metrics.counted.map((entry) =>
        entry.label === "history panel" ? { ...entry, count: 1 } : entry
      )
    }),
    /history panel is app-only/u
  )
})

test("the app layout missing its history panel fails closed", () => {
  const base = appMetrics("silent")
  const metrics = {
    ...base,
    counted: base.counted.map((entry) =>
      entry.label === "history panel" ? { ...entry, count: 0 } : entry
    )
  }
  assert.throws(
    () => validateCaptureMetrics(metrics, entryFor("silent", 1), RC16_SPEC),
    (error) => error instanceof CaptureSafetyError && /app layout must render exactly one/u.test(error.message)
  )
})

test("wrong panel count fails closed per layout", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      counted: metrics.counted.map((entry) =>
        entry.label === "panel" ? { ...entry, count: 3 } : entry
      )
    }),
    /native layout must render exactly 4 \.rc16-panel/u
  )
})

test("wrong zone count fails closed", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      counted: metrics.counted.map((entry) =>
        entry.label === "zone" ? { ...entry, count: 4 } : entry
      )
    }),
    /native layout must carry exactly 5 \[data-rc16-zone\]/u
  )
})

/* ── Alert state assertions ───────────────────────────────────────────────────────────── */

test("data-rc16-alerts must be 'silent' in the silent state", () => {
  assertRejects(
    (metrics) => ({ ...metrics, stateAttributes: { ...metrics.stateAttributes, alerts: "active" } }),
    /must publish data-rc16-alerts="silent"/u
  )
})

test("the over-rev state must publish data-rc16-alerts='active'", () => {
  assertRejects(
    (metrics) => ({ ...metrics, stateAttributes: { ...metrics.stateAttributes, alerts: "silent" } }),
    /must publish data-rc16-alerts="active"/u,
    "over-rev"
  )
})

test("the laps count must be 3 at the reference capture point", () => {
  assertRejects(
    (metrics) => ({ ...metrics, stateAttributes: { ...metrics.stateAttributes, laps: "2" } }),
    /data-rc16-laps must be "3"/u
  )
})

test("over-rev cue missing data-rc16-cue-alert='true' fails closed", () => {
  assertRejects(
    (metrics) => ({ ...metrics, cuePanelAlert: "false" }),
    /data-rc16-cue-alert.*"true"/u,
    "over-rev"
  )
})

/* ── Ring separation assertions ──────────────────────────────────────────────────────── */

test("a ring gap below the 7.5 px floor fails closed", () => {
  // Simulate full-scale dispersion (mid=13.25) and reduce the guide to force gap below 7.5
  const tinyGuideR = ringViewBoxRadius(RC16_RING_MAX_MID_PCT + 0.5 + RC16_RING_STROKE_PCT / 2)
  assertRejects(
    (metrics) => ({
      ...metrics,
      ringMeasurement: {
        ...metrics.ringMeasurement,
        guideRVb: tinyGuideR,
        bandRVb: ringViewBoxRadius(RC16_RING_MAX_MID_PCT),
        bandSwVb: ringViewBoxRadius(RC16_RING_STROKE_PCT),
        svgRenderedWidth: 260,
        svgViewBoxWidth: 100
      }
    }),
    /ring guide-to-band separation.*below the.*floor/u
  )
})

test("a missing ring band (null bandRVb) fails closed", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      ringMeasurement: {
        ...metrics.ringMeasurement,
        bandRVb: null,
        bandSwVb: null
      }
    }),
    /circle attributes are not finite/u
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

function capturePng(state, {
  strayAmber = false,
  blank = false,
  noSignature = false,
  noCyan = false,
  redPixel = false
} = {}) {
  const size = CAPTURE_SIZES[0]  // 800x480
  const image = paintPng(size, CANVAS_RGB)
  if (blank) return PNG.sync.write(image)

  // Signature green: ring band area
  if (!noSignature) {
    fillRect(image, rect(340, 160, 120, 4), SIGNATURE_RGB)
  } else {
    fillRect(image, rect(340, 160, 120, 4), [80, 80, 80])
  }

  // Info cyan: smoothness fill
  if (!noCyan) {
    fillRect(image, rect(80, 150, 160, 100), INFO_RGB)
  }

  // Over-rev amber: scoped to cue panel
  if (state === "over-rev") {
    fillRect(image, rect(570, 120, 180, 140), CAUTION_RGB)
  }

  // Stray amber outside cue panel
  if (strayAmber) {
    fillRect(image, rect(200, 300, 20, 20), CAUTION_RGB)
  }

  // Red pixel: forbidden (omission: dangerToken)
  if (redPixel) {
    fillRect(image, rect(300, 300, 5, 5), DANGER_RGB)
  }

  return PNG.sync.write(image)
}

test("the pixel audit accepts the silent frame: green + cyan present, no amber, no red", () => {
  const audit = validateCapturePixels(capturePng("silent"), entryFor("silent"), nativeMetrics("silent"))
  assert.equal(audit.width, 800)
  assert.equal(audit.height, 480)
  assert.equal(audit.signatureHueFamily, "green")
  assert.equal(audit.infoHueFamily, "cyan")
  assert.equal(audit.cautionHueFamily, "amber")
  assert.equal(audit.dangerHueFamily, "red")
  assert.ok(audit.hueFamilies.green > 0)
  assert.ok(audit.hueFamilies.cyan > 0)
  assert.equal(audit.hueFamilies.amber, 0)
  assert.equal(audit.hueFamilies.red, 0)
})

test("the pixel audit accepts an over-rev frame whose amber stays inside the cue panel", () => {
  const audit = validateCapturePixels(capturePng("over-rev"), entryFor("over-rev"), nativeMetrics("over-rev"))
  assert.ok(audit.hueFamilies.amber > 0)
  assert.equal(audit.cautionOutsideScope, 0)
})

test("a blank frame fails closed", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { blank: true }), entryFor("silent"), nativeMetrics("silent")),
    (error) => error instanceof CaptureSafetyError && /blank against the RC-16 canvas colour/u.test(error.message)
  )
})

test("a silent frame carrying amber pixels fails closed (absent check)", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { strayAmber: true }), entryFor("silent"), nativeMetrics("silent")),
    (error) => error instanceof CaptureSafetyError && /amber hue family must be absent/u.test(error.message)
  )
})

test("an over-rev frame whose amber leaks outside the cue panel fails closed (scoped check)", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("over-rev", { strayAmber: true }), entryFor("over-rev"), nativeMetrics("over-rev")),
    (error) => error instanceof CaptureSafetyError && /amber pixels fall outside/u.test(error.message)
  )
})

test("a frame that has lost its ring-band green fails closed (present check)", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { noSignature: true }), entryFor("silent"), nativeMetrics("silent")),
    (error) => error instanceof CaptureSafetyError && /green hue family must be painted/u.test(error.message)
  )
})

test("any red pixel fails closed on every frame — omission: dangerToken", () => {
  for (const state of CAPTURE_STATES) {
    assert.throws(
      () => validateCapturePixels(capturePng(state, { redPixel: true }), entryFor(state), nativeMetrics(state)),
      (error) => error instanceof CaptureSafetyError && /red hue family must be absent/u.test(error.message)
    )
  }
})

/* ── Reference values ─────────────────────────────────────────────────────────────────── */

test("the reference values are the approved attempt-002 channel values", () => {
  assert.equal(RC16_EXPECTED_VALUES.consistency, "0.42")
  assert.equal(RC16_EXPECTED_VALUES.smoothness, "82")
  assert.equal(RC16_EXPECTED_VALUES.delta, "-0.28")
  assert.equal(RC16_EXPECTED_VALUES.lastLap, "1:42.318")
  // 102.318 s = 1 min 42.318 s → "1:42.318" ✓
  assert.equal(RC16_EXPECTED_VALUES.cueLabel, "NEXT STEP")
  // focusBraking with no active alert: lines = ["STEADY","BRAKING"]
  assert.equal(RC16_EXPECTED_VALUES.cueLine0, "STEADY")
  assert.equal(RC16_EXPECTED_VALUES.cueLine1, "BRAKING")
})

test("wrong consistency value in silent state fails closed", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      values: metrics.values.map((entry) =>
        entry.label === "consistency" ? { ...entry, text: "0.55" } : entry
      )
    }),
    /consistency reads "0\.55" instead of approved "0\.42"/u
  )
})

/* ── Smoothness fill-ratio agreement ─────────────────────────────────────────────────── */

test("a smoothness meter whose fill disagrees with its numeral fails closed", () => {
  // The bar claims 55% filled while the numeral reads 82 — they contradict the same channel.
  // |0.55 * 100 - 82| = 27 > 1.5, so the check fires regardless of the absolute value.
  assertRejects(
    (metrics) => ({ ...metrics, smoothnessFillRatio: 0.55 }),
    /bar and the numeral contradict one channel/u
  )
})

/* ── Fail-closed: known defect budget ────────────────────────────────────────────────── */

test("the known lastLap defect is scoped: an overflow at a viewport not in the list still fails closed", () => {
  // Native 800x480 is NOT in [1024x600, 759x393, 867x412]; any overflow at native is unrecorded
  assertRejects(
    (metrics) => ({
      ...metrics,
      overflowLeaves: [{
        key: "rc16-summary-lastLap",
        text: "1:42.318",
        fontSize: 28,
        whiteSpace: "nowrap",
        clientWidth: 200,
        scrollWidth: 217,
        overflowX: 17,
        textLeft: 60,
        textRight: 277
      }]
    }),
    /rc16-summary-lastLap "1:42\.318" paints 17px wider/u
  )
})

test("the known lastLap defect has a hard budget: overflowing past 25 px fails closed", () => {
  // 1024x600 IS in the defect list — but only up to budgetPx=25; 26 px still fails
  const metrics = appMetrics("silent", {
    overflowLeaves: [{
      key: "rc16-summary-lastLap",
      text: "1:42.318",
      fontSize: 28,
      whiteSpace: "nowrap",
      clientWidth: 124,
      scrollWidth: 150,
      overflowX: 26,
      textLeft: 60,
      textRight: 210
    }]
  })
  assert.throws(
    () => validateCaptureMetrics(metrics, entryFor("silent", 1), RC16_SPEC),
    (error) => error instanceof CaptureSafetyError && /past the 25px recorded/u.test(error.message)
  )
})

/* ── Disk safety comes from RC-01, unforked ───────────────────────────────────────────── */

test("the shared disk-safety primitives are the RC-01 originals, unforked", () => {
  assert.equal(typeof parseCaptureArgs, "function")
  assert.equal(typeof prepareCaptureOutput, "function")
  assert.equal(typeof createPrivateStaging, "function")
  assert.equal(typeof discardPrivateStaging, "function")
  assert.throws(() => parseCaptureArgs(["--mode", "final"]), CaptureSafetyError)
})
