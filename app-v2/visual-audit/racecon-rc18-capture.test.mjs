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
  RC18_CANVAS_RGBA,
  RC18_CAPTURE_MATRIX,
  RC18_CAUTION_HEX,
  RC18_DANGER_HEX,
  RC18_INFO_HEX,
  RC18_MIRROR_AXIS_PCT,
  RC18_NORMAL_HEX,
  RC18_SIG_HEX,
  RC18_SPEC,
  RC18_SPINE_FULL_SCALE_SEC,
  RC18_SPINE_HALF_SPAN_APP_PX,
  RC18_SPINE_HALF_SPAN_NATIVE_PX,
  RC18_SPINE_HALF_SPAN_PCT,
  RC18_TYPE_SCALE_PX,
  assertTypeScaleOrder,
  containsRect,
  validateCaptureMetrics,
  validateCapturePixels
} from "./racecon-rc18-capture-lib.mjs"

/* ── Synthetic metric fixtures ────────────────────────────────────────────────────────── */

const CANVAS_RGB = [12, 14, 17]          // #0C0E11
const PANEL_RGB  = [22, 26, 32]          // #161A20 — widget panel bg (neutral family, non-canvas)
const INFO_RGB = [79, 176, 224]          // #4FB0E0 Setup A identity → cyan
const SIG_RGB = [176, 160, 255]          // #B0A0FF Setup B identity → blue
const CAUTION_RGB = [240, 184, 58]       // #F0B83A INCOMPARABLE tag → amber
const DANGER_RGB = [240, 83, 62]         // #F0533E UNUSED → red
const NORMAL_RGB = [82, 192, 122]        // #52C07A UNUSED → green

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
    color: "rgb(232, 236, 239)",
    display: "block"
  }
}

function owned(label, ownerBox, valueBox) {
  return { label, owner: ownerBox, ownerDisplay: "block", value: valueBox, valueDisplay: "block" }
}

function counted(label, selector, count) {
  return { label, selector, count }
}

/* ── Native 800×480 zone geometry ────────────────────────────────────────────────────── */
// Contiguity: 16+300=316 (spine.left), 316+168=484 (columnB.left), 484+300=784 ≤ 800 ✓
// spineCentreX = 316+84 = 400 = 800×50% ✓

const NATIVE_SUMMARY   = rect(16,  12, 768,  30)
const NATIVE_COLUMN_A  = rect(16,  50, 300, 380)
const NATIVE_COLUMN_B  = rect(484, 50, 300, 380)
const NATIVE_SPINE     = rect(316, 50, 168, 380)
const NATIVE_DELTA_STACK = rect(316, 50, 168, 306)
const NATIVE_STABILITY   = rect(316, 360, 168, 70)

// Spine items for shared-axis proof (datum centred at x=400, 2 px wide)
const NATIVE_TRACK_S1 = rect(316, 110, 168, 18)
const NATIVE_TRACK_S2 = rect(316, 170, 168, 18)
const NATIVE_TRACK_S3 = rect(316, 230, 168, 18)
const NATIVE_DATUM_S1 = rect(399, 110, 2, 18)   // centre X = 400
const NATIVE_DATUM_S2 = rect(399, 170, 2, 18)
const NATIVE_DATUM_S3 = rect(399, 230, 2, 18)

// Reference bars: S1 lean=a (right≈400), S2/S3 lean=b (left≈400)
const NATIVE_BAR_S1 = { rect: rect(390.26, 115, 9.74, 10), lean: "a" }   // |0.041|/0.32×76≈9.74
const NATIVE_BAR_S2 = { rect: rect(400,    175, 63.65, 10), lean: "b" }  // |0.268|/0.32×76≈63.65
const NATIVE_BAR_S3 = { rect: rect(400,    235, 37.76, 10), lean: "b" }  // |0.159|/0.32×76≈37.76

const NATIVE_HEAD_A = rect(16, 50, 300, 30)   // equal heights (identity pin applied)
const NATIVE_HEAD_B = rect(484, 50, 300, 30)

const NATIVE_INCOMPARABLE_ROW = rect(16, 330, 768, 24)   // brakeRear row area (amber scope)

/* ── App 1024×600 zone geometry ──────────────────────────────────────────────────────── */
// Contiguity: 24+320=344 (spine.left), 344+336=680 (columnB.left) ✓
// spineCentreX = 344+168 = 512 = 1024×50% ✓

const APP_SUMMARY      = rect(24,  12, 976,  36)
const APP_COLUMN_A     = rect(24,  60, 320, 440)
const APP_COLUMN_B     = rect(680, 60, 320, 440)
const APP_SPINE        = rect(344, 60, 336, 440)
const APP_DELTA_STACK  = rect(344, 60, 336, 366)
const APP_STABILITY    = rect(344, 430, 336, 70)

const APP_TRACK_S1  = rect(344, 120, 336, 18)
const APP_DATUM_S1  = rect(511,  120, 2, 18)   // centre X = 512
const APP_DATUM_S2  = rect(511,  185, 2, 18)
const APP_DATUM_S3  = rect(511,  250, 2, 18)
const APP_TRACK_S2  = rect(344, 185, 336, 18)
const APP_TRACK_S3  = rect(344, 250, 336, 18)

// App bars: halfSpan=152; S1: 0.128×152≈19.5, S2: 0.8375×152≈127.3, S3: 0.497×152≈75.5
const APP_BAR_S1 = { rect: rect(492.5, 126, 19.5, 10), lean: "a" }
const APP_BAR_S2 = { rect: rect(512,   191, 127.3, 10), lean: "b" }
const APP_BAR_S3 = { rect: rect(512,   256, 75.5, 10), lean: "b" }

const APP_HEAD_A = rect(24,  60, 320, 30)
const APP_HEAD_B = rect(680, 60, 320, 30)

/**
 * Faithful native 800×480 metric fixture for the REFERENCE state (attempt-004 governed frame):
 *   alerts="active": sector-gap S2 and S3 fired, incomparable:brakeRear fired; S1 and stability SILENT.
 *   pair="matched": two archived laps (Setup A older, Setup B newer).
 *   brakeRear B renders "--" (honest empty: no rear-right brake sensor → rc18AxlePeakC returns null).
 */
function nativeReferenceMetrics(overrides = {}) {
  const size = CAPTURE_SIZES[0]

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
    presetId: RC18_SPEC.presetId,
    expectedWidgetId: RC18_SPEC.widgetId,
    renderedWidgetId: RC18_SPEC.widgetId,
    dashboardWidth: "1024",
    dashboardHeight: "600",
    sourceKind: "live-telemetry",
    sourceIdentity: RC18_SPEC.sourceIdentity,
    captureState: "reference",
    captureSequence: "113",
    layout: "native",
    compactMode: null,
    bufferState: "accepted",
    contentWidth: String(size.width),
    contentHeight: String(size.height),
    nativeSize: "800x480",
    stateAttributes: {
      pair: "matched",
      alerts: "active",
      "alert-keys": "sector-gap:S2,sector-gap:S3,incomparable:brakeRear",
      incomparable: "1",
      faster: "b",
      rows: "11",
      "mirror-axis-pct": String(RC18_MIRROR_AXIS_PCT),
      "half-span-pct": RC18_SPINE_HALF_SPAN_PCT.toFixed(4),
      baseline: "auto"
    },
    zones: [
      zone("summary",    '[data-testid="rc18-summary"]',    NATIVE_SUMMARY),
      zone("columnA",    '[data-testid="rc18-column-a"]',   NATIVE_COLUMN_A),
      zone("columnB",    '[data-testid="rc18-column-b"]',   NATIVE_COLUMN_B),
      zone("spine",      '[data-testid="rc18-spine"]',      NATIVE_SPINE),
      zone("deltaStack", '[data-testid="rc18-delta-stack"]', NATIVE_DELTA_STACK),
      zone("stability",  '[data-testid="rc18-stability"]',  NATIVE_STABILITY)
    ],
    values: [
      value("verdict",   '[data-testid="rc18-delta-value-S1"]', "+0.041", rect(324, 112, 140, 46), RC18_TYPE_SCALE_PX.verdict),
      value("sector",    '[data-testid="rc18-a-deltaToBest"]',  "+0.121", rect(200,  72, 100, 36), RC18_TYPE_SCALE_PX.sector),
      value("summary",   '[data-testid="rc18-verdict"]',        "SETUP B FASTER BY 0.386 S", rect(20, 15, 550, 24), RC18_TYPE_SCALE_PX.summary),
      value("secondary", '[data-testid="rc18-a-tyreLf"]',       "84",     rect(220, 280, 80, 24),  RC18_TYPE_SCALE_PX.secondary),
      value("label",     '[data-testid="rc18-baseline"]',       "BASELINE AUTO", rect(600, 15, 160, 14), RC18_TYPE_SCALE_PX.label)
    ],
    containment: [
      owned("spine title",    NATIVE_DELTA_STACK, rect(325, 55, 120, 14)),
      owned("balance label",  NATIVE_STABILITY,   rect(320, 364, 80, 14)),
      owned("balance source", NATIVE_STABILITY,   rect(320, 380, 120, 14))
    ],
    counted: [
      counted("rc18-row", '[data-testid="rc18-row"]', 22)
    ],
    forbidden: RC18_SPEC.forbidden.map(([label, selector]) => ({ label, selector, count: 0 })),
    // RC-18 specific DOM measurements
    trackRects:    { S1: NATIVE_TRACK_S1, S2: { ...NATIVE_TRACK_S1, top: 170 }, S3: { ...NATIVE_TRACK_S1, top: 230 } },
    datumRects:    { S1: NATIVE_DATUM_S1, S2: NATIVE_DATUM_S2, S3: NATIVE_DATUM_S3 },
    barRects:      { S1: NATIVE_BAR_S1, S2: NATIVE_BAR_S2, S3: NATIVE_BAR_S3 },
    deltaValues:   { S1: "+0.041", S2: "-0.268", S3: "-0.159" },
    colAHeadRect:  NATIVE_HEAD_A,
    colBHeadRect:  NATIVE_HEAD_B,
    identityBandsA: "1",
    identityBandsB: "2",
    identityLineCountA: 1,
    identityLineCountB: 2,
    alertChipPresent: true,
    alertChipText: "INCOMPARABLE 1",
    incomparableRowRects: [NATIVE_INCOMPARABLE_ROW],
    brakeRearBText: "--",
    spineTitleRect: rect(325, 55, 120, 14),
    balanceLabelRect: rect(320, 364, 80, 14),
    balanceSourceRect: rect(320, 380, 120, 14),
    tracePresent: false,
    traceEmptyPresent: false,
    tracePlotPresent: false,
    leafTexts: [
      "SETUP B FASTER BY 0.386 S",
      "BASELINE AUTO",
      "INCOMPARABLE 1",
      "SETUP A", "SETUP B",
      "VERDICT",
      "+0.041", "-0.268", "-0.159",
      "BALANCE", "STEER + YAW",
      "0.42", "0.31",
      "84", "86", "79", "81",
      "88", "90", "83", "85",
      "412", "408", "388",
      "405", "401",
      "--",
      "97", "103",
      "+0.121", "-0.265"
    ],
    overflowLeaves: [],
    rootText: "SETUP B FASTER BY 0.386 S BASELINE AUTO INCOMPARABLE 1 SETUP A SETUP B VERDICT +0.041 -0.268 -0.159 BALANCE",
    textOutputs: ["+0.041", "-0.268", "-0.159", "SETUP B FASTER BY 0.386 S"],
    errorBoundaryCount: 0,
    unknownWidgetCount: 0,
    failures: []
  }
  return { ...base, ...overrides }
}

/** Faithful native 800×480 metric fixture for the MATCHED state (all alerts silent). */
function nativeMatchedMetrics(overrides = {}) {
  return {
    ...nativeReferenceMetrics(),
    captureState: "matched",
    stateAttributes: {
      pair: "matched",
      alerts: "silent",
      "alert-keys": "",
      incomparable: "0",
      faster: "a",
      rows: "11",
      "mirror-axis-pct": String(RC18_MIRROR_AXIS_PCT),
      "half-span-pct": RC18_SPINE_HALF_SPAN_PCT.toFixed(4),
      baseline: "auto"
    },
    deltaValues:  { S1: "+0.010", S2: "+0.010", S3: "+0.010" },
    // In matched state: no bar rendered because all deltas < noise floor and fasterSide is determined
    // but no bar-gap alert fires. Bars ARE rendered (fasterSide="a"); recalculate widths.
    barRects: {
      S1: { rect: rect(397, 115, 2.375, 10), lean: "a" },  // 0.010/0.32×76≈2.375
      S2: { rect: rect(397, 175, 2.375, 10), lean: "a" },
      S3: { rect: rect(397, 235, 2.375, 10), lean: "a" }
    },
    alertChipPresent: false,
    alertChipText: null,
    incomparableRowRects: [],
    brakeRearBText: "388",   // matched state has all brake corners; B rear is a numeric value
    textOutputs: ["+0.010", "+0.010", "+0.010", "SETUP A FASTER BY 0.030 S"],
    ...overrides
  }
}

/** Faithful app 1024×600 metric fixture. */
function appMetrics(state = "reference", overrides = {}) {
  const size = CAPTURE_SIZES[1]
  const native = state === "reference" ? nativeReferenceMetrics() : nativeMatchedMetrics()
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
    captureState: state,
    layout: "app",
    contentWidth: String(size.width),
    contentHeight: String(size.height),
    nativeSize: null,
    zones: [
      zone("summary",    '[data-testid="rc18-summary"]',    APP_SUMMARY),
      zone("columnA",    '[data-testid="rc18-column-a"]',   APP_COLUMN_A),
      zone("columnB",    '[data-testid="rc18-column-b"]',   APP_COLUMN_B),
      zone("spine",      '[data-testid="rc18-spine"]',      APP_SPINE),
      zone("deltaStack", '[data-testid="rc18-delta-stack"]', APP_DELTA_STACK),
      zone("stability",  '[data-testid="rc18-stability"]',  APP_STABILITY)
    ],
    trackRects: { S1: APP_TRACK_S1, S2: APP_TRACK_S2, S3: APP_TRACK_S3 },
    datumRects: { S1: APP_DATUM_S1, S2: APP_DATUM_S2, S3: APP_DATUM_S3 },
    barRects: state === "reference"
      ? { S1: APP_BAR_S1, S2: APP_BAR_S2, S3: APP_BAR_S3 }
      : {
          S1: { rect: rect(507.5, 126, 4.75, 10), lean: "a" },  // 0.010/0.32×152≈4.75
          S2: { rect: rect(507.5, 191, 4.75, 10), lean: "a" },
          S3: { rect: rect(507.5, 256, 4.75, 10), lean: "a" }
        },
    colAHeadRect: APP_HEAD_A,
    colBHeadRect: APP_HEAD_B,
    tracePresent: true,
    traceEmptyPresent: false,
    tracePlotPresent: true,
    ...overrides
  }
}

/**
 * Faithful compact/phone 393×759 metric fixture.
 *
 * Spine is centred at x = 393 × 50% = 196.5 px; columns are symmetric about that axis.
 * Bars are set to null so the bar-length formula check is skipped for this layout (the
 * half-span constant is not defined for compact and the bar geometry is layout-specific).
 */
function phoneReferenceMetrics(overrides = {}) {
  const size = CAPTURE_SIZES[2]   // 393×759, layout:"compact", compactMode:"phone"
  // Zone geometry: spine centred at 196.5 = 393×50%
  const PH_SUMMARY  = rect(8, 8, 377, 24)       // right=385 < 393 ✓
  const PH_COL_A    = rect(8, 40, 120, 200)      // right=128, bottom=240 ✓
  const PH_COL_B    = rect(265, 40, 120, 200)    // right=385, bottom=240 ✓
  const PH_SPINE    = rect(128, 40, 137, 200)    // centreX=196.5, right=265 ✓
  const PH_D_STACK  = rect(128, 40, 137, 160)    // nested in spine ✓
  const PH_STAB     = rect(128, 204, 137, 36)    // nested in spine, below deltaStack ✓
  // Track/datum: centreX = 196.5 for all three sectors
  const PH_TRACK_S1 = rect(128, 60, 137, 14)    // centreX = 128+68.5 = 196.5
  const PH_TRACK_S2 = rect(128, 90, 137, 14)
  const PH_TRACK_S3 = rect(128, 120, 137, 14)
  const PH_DATUM_S1 = rect(195.5, 60, 2, 14)    // centreX = 196.5
  const PH_DATUM_S2 = rect(195.5, 90, 2, 14)
  const PH_DATUM_S3 = rect(195.5, 120, 2, 14)

  return {
    ...nativeReferenceMetrics(),
    viewport: { width: size.width, height: size.height, dpr: 1 },
    page: { scrollWidth: size.width, clientWidth: size.width },
    root: rect(0, 0, size.width, size.height),
    shell: measured(rect(0, 0, size.width, size.height)),
    canvas: { ...measured(rect(0, 0, size.width, size.height)), transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
    dashboardElement: measured(rect(0, 0, size.width, size.height)),
    widget: measured(rect(0, 0, size.width, size.height)),
    dashboard: measured(rect(0, 0, size.width, size.height)),
    layout: "compact",
    compactMode: "phone",
    contentWidth: String(size.width),
    contentHeight: String(size.height),
    nativeSize: null,
    zones: [
      zone("summary",    '[data-testid="rc18-summary"]',     PH_SUMMARY),
      zone("columnA",    '[data-testid="rc18-column-a"]',    PH_COL_A),
      zone("columnB",    '[data-testid="rc18-column-b"]',    PH_COL_B),
      zone("spine",      '[data-testid="rc18-spine"]',       PH_SPINE),
      zone("deltaStack", '[data-testid="rc18-delta-stack"]', PH_D_STACK),
      zone("stability",  '[data-testid="rc18-stability"]',   PH_STAB)
    ],
    trackRects: { S1: PH_TRACK_S1, S2: PH_TRACK_S2, S3: PH_TRACK_S3 },
    datumRects: { S1: PH_DATUM_S1, S2: PH_DATUM_S2, S3: PH_DATUM_S3 },
    // Bars skipped: half-span is undefined for compact; the bar checks only run when barRects present
    barRects: { S1: null, S2: null, S3: null },
    values: [
      value("verdict",   '[data-testid="rc18-delta-value-S1"]', "+0.041", rect(130, 65, 100, 36), RC18_TYPE_SCALE_PX.verdict),
      value("sector",    '[data-testid="rc18-a-deltaToBest"]',  "+0.121", rect(10,  42, 100, 26),  RC18_TYPE_SCALE_PX.sector),
      value("summary",   '[data-testid="rc18-verdict"]',        "SETUP B FASTER BY 0.386 S", rect(8, 10, 300, 20), RC18_TYPE_SCALE_PX.summary),
      value("secondary", '[data-testid="rc18-a-minSpeed"]',     "412",    rect(10,  95, 80, 18),   RC18_TYPE_SCALE_PX.secondary),
      value("label",     '[data-testid="rc18-baseline"]',       "BASELINE AUTO", rect(200, 10, 180, 12), RC18_TYPE_SCALE_PX.label)
    ],
    containment: [
      owned("spine title",    PH_D_STACK, rect(132, 44, 100, 12)),
      owned("balance label",  PH_STAB,   rect(130, 210, 60, 12)),
      owned("balance source", PH_STAB,   rect(130, 224, 100, 12))
    ],
    colAHeadRect: rect(8, 40, 120, 22),
    colBHeadRect: rect(265, 40, 120, 22),
    stateAttributes: {
      ...nativeReferenceMetrics().stateAttributes,
      rows: "5",
      "alert-keys": "sector-gap:S2,sector-gap:S3",
      incomparable: "0"
    },
    brakeRearBText: null,      // compact-phone renders 5 rows — no brake row rendered ✓
    counted: [counted("rc18-row", '[data-testid="rc18-row"]', 10)],
    tracePresent: false,
    traceEmptyPresent: false,
    tracePlotPresent: false,
    ...overrides
  }
}



function entryFor(state = "reference", index = 0) {
  return { size: CAPTURE_SIZES[index], state, required: [] }
}

function assertRejects(mutate, expected, state = "reference") {
  const base = state === "reference" ? nativeReferenceMetrics() : nativeMatchedMetrics()
  const metrics = mutate(base)
  assert.throws(
    () => validateCaptureMetrics(metrics, entryFor(state), RC18_SPEC),
    (error) => error instanceof CaptureSafetyError && expected.test(error.message),
    `expected CaptureSafetyError matching ${expected}`
  )
}

/* ── PNG helpers for pixel audit ──────────────────────────────────────────────────────── */

function makePng(width, height, fillFn) {
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (width * y + x) * 4
      const [r, g, b, a = 255] = fillFn(x, y)
      png.data[idx] = r
      png.data[idx + 1] = g
      png.data[idx + 2] = b
      png.data[idx + 3] = a
    }
  }
  return PNG.sync.write(png)
}

const [W, H] = [800, 480]   // smallest governed size, to keep tests fast

function makeBlankPng() {
  return makePng(W, H, () => CANVAS_RGB)
}

function makeReferencePng() {
  return makePng(W, H, (x, y) => {
    if (x < 10 && y < 10) return INFO_RGB       // Setup A identity (cyan)
    if (x < 30 && y < 10) return SIG_RGB        // Setup B identity (blue)
    if (x >= 400 && x < 420 && y >= 330 && y < 354) return CAUTION_RGB  // incomparable row (scoped)
    return PANEL_RGB   // widget panel fill — provides >>5 000 non-canvas pixels
  })
}

function makeMatchedPng() {
  return makePng(W, H, (x, y) => {
    if (x < 10 && y < 10) return INFO_RGB
    if (x < 30 && y < 10) return SIG_RGB
    return PANEL_RGB
  })
}

function makeDangerPng() {
  return makePng(W, H, (x, y) => {
    if (x < 10 && y < 10) return INFO_RGB
    if (x < 30 && y < 10) return SIG_RGB
    if (x === 100 && y === 100) return DANGER_RGB  // one danger pixel
    return PANEL_RGB
  })
}

function makeNormalPng() {
  return makePng(W, H, (x, y) => {
    if (x < 10 && y < 10) return INFO_RGB
    if (x < 30 && y < 10) return SIG_RGB
    if (x === 100 && y === 100) return NORMAL_RGB  // one normal pixel
    return PANEL_RGB
  })
}

// Unscoped caution: amber pixel NOT in the incomparable row rect
function makeUnscopedCautionPng() {
  return makePng(W, H, (x, y) => {
    if (x < 10 && y < 10) return INFO_RGB
    if (x < 30 && y < 10) return SIG_RGB
    if (x === 50 && y === 50) return CAUTION_RGB  // outside NATIVE_INCOMPARABLE_ROW scope
    return PANEL_RGB
  })
}

const PIXEL_ENTRY_REF  = { size: CAPTURE_SIZES[0], state: "reference" }
const PIXEL_ENTRY_MATCH = { size: CAPTURE_SIZES[0], state: "matched" }
const PIXEL_METRICS_REF  = nativeReferenceMetrics()
const PIXEL_METRICS_MATCH = nativeMatchedMetrics()

/* ── Matrix and contract ──────────────────────────────────────────────────────────────── */

test("the governed matrix covers every viewport in every governed state", () => {
  assert.equal(RC18_CAPTURE_MATRIX.length, CAPTURE_SIZES.length * CAPTURE_STATES.length)
  for (const state of CAPTURE_STATES) {
    for (const size of CAPTURE_SIZES) {
      const entry = RC18_CAPTURE_MATRIX.find(
        (candidate) =>
          candidate.state === state &&
          candidate.size.width === size.width &&
          candidate.size.height === size.height
      )
      assert.ok(entry, `${state} ${size.width}x${size.height} is missing from the matrix`)
      assert.equal(expectedLayoutForBox(size.width, size.height), size.layout)
      assert.equal(expectedCompactModeForBox(size.width, size.height), size.compactMode)
    }
  }
})

test("the reference state waits for alerts=active+pair=matched; matched waits for silent+pair+incomparable=0", () => {
  for (const entry of RC18_CAPTURE_MATRIX) {
    const required = Object.fromEntries(entry.required)
    if (entry.state === "reference") {
      assert.equal(required.alerts, "active")
      assert.equal(required.pair, "matched")
    } else {
      assert.equal(required.alerts, "silent")
      assert.equal(required.pair, "matched")
      assert.equal(required.incomparable, "0")
    }
  }
})

/* ── Colour token hue families ───────────────────────────────────────────────────────── */

test("the five RC-18 colour tokens land in distinct hue families", () => {
  assert.equal(hueFamilyOfHex(RC18_INFO_HEX),    "cyan",   "info #4FB0E0 must be cyan")
  assert.equal(hueFamilyOfHex(RC18_SIG_HEX),     "blue",   "signature #B0A0FF must be blue")
  assert.equal(hueFamilyOfHex(RC18_CAUTION_HEX), "amber",  "caution #F0B83A must be amber")
  assert.equal(hueFamilyOfHex(RC18_DANGER_HEX),  "red",    "danger #F0533E must be red")
  assert.equal(hueFamilyOfHex(RC18_NORMAL_HEX),  "green",  "normal #52C07A must be green")
  // All five are distinct — no collision that would make a zero-pixel assertion unreliable
  const families = [
    hueFamilyOfHex(RC18_INFO_HEX), hueFamilyOfHex(RC18_SIG_HEX),
    hueFamilyOfHex(RC18_CAUTION_HEX), hueFamilyOfHex(RC18_DANGER_HEX),
    hueFamilyOfHex(RC18_NORMAL_HEX)
  ]
  assert.equal(new Set(families).size, 5, "all five tokens must be in distinct hue families")
})

/**
 * A naive channel-ratio test cannot separate danger from caution at composited opacity; hue can.
 *
 * RC-18 danger #F0533E and caution #F0B83A both have R=0xF0=240 (maximum channel). When either
 * is composited at 50 % opacity over the bg #0C0E11 (12,14,17), the resulting pixel has R=126
 * in both cases. A naive "r > 120 && b < 50" threshold flags both — a false positive for
 * caution that would make a "zero danger pixels" assertion untrustworthy. Hue (computed from the
 * full H/S/V formula) resolves the ambiguity: danger composited lands at ≈7° (red), caution
 * composited at ≈42° (amber).
 */
test("a naive channel-ratio test cannot separate danger from caution at 50% opacity; hue can", () => {
  const [rD, gD, bD] = [Math.round((240 + 12) / 2), Math.round((83 + 14) / 2), Math.round((62 + 17) / 2)]   // 126,49,40
  const [rC, gC, bC] = [Math.round((240 + 12) / 2), Math.round((184 + 14) / 2), Math.round((58 + 17) / 2)]  // 126,99,38

  function naiveTest(r, g, b) { return r > 120 && b < 50 }

  assert.ok(naiveTest(rD, gD, bD), "naive test must flag danger composited pixel")
  assert.ok(naiveTest(rC, gC, bC), "naive test also flags caution composited pixel — false positive")

  const dangerHueFam = hueFamily(rD, gD, bD)
  const cautionHueFam = hueFamily(rC, gC, bC)
  assert.equal(dangerHueFam, "red",   "danger composited pixel is red family")
  assert.equal(cautionHueFam, "amber", "caution composited pixel is amber family")
  assert.notEqual(dangerHueFam, cautionHueFam, "hue correctly separates what the naive test confuses")
})

/* ── Arithmetic contracts ─────────────────────────────────────────────────────────────── */

test("the type scale is strictly ordered (verdict > sector > summary > secondary > label)", () => {
  const steps = [
    RC18_TYPE_SCALE_PX.verdict,
    RC18_TYPE_SCALE_PX.sector,
    RC18_TYPE_SCALE_PX.summary,
    RC18_TYPE_SCALE_PX.secondary,
    RC18_TYPE_SCALE_PX.label
  ]
  for (let i = 1; i < steps.length; i += 1) {
    assert.ok(steps[i - 1] > steps[i], `step ${steps[i - 1]} must be strictly larger than ${steps[i]}`)
  }
})

test("the bar length formula: clamp(|delta|/0.32, 0, 1) × halfSpan is correct for reference values", () => {
  function barPx(delta, halfSpan) {
    return Math.min(Math.abs(delta) / RC18_SPINE_FULL_SCALE_SEC, 1) * halfSpan
  }
  // Native (halfSpan = 76 px)
  assert.ok(Math.abs(barPx(0.041, 76) - 9.7375) < 0.01, "S1 native bar width ≈ 9.74 px")
  assert.ok(Math.abs(barPx(0.268, 76) - 63.65) < 0.01, "S2 native bar width ≈ 63.65 px")
  assert.ok(Math.abs(barPx(0.159, 76) - 37.7625) < 0.01, "S3 native bar width ≈ 37.76 px")
  // App (halfSpan = 152 px)
  assert.ok(Math.abs(barPx(0.041, 152) - 19.475) < 0.01, "S1 app bar width ≈ 19.48 px")
  assert.ok(Math.abs(barPx(0.268, 152) - 127.3) < 0.01, "S2 app bar width ≈ 127.30 px")
  // Clamping: delta ≥ 0.32 → barWidth === halfSpan
  assert.equal(barPx(0.32, 76), 76)
  assert.equal(barPx(0.64, 76), 76)  // clamped at halfSpan
})

test("the spine half-span pct equals halfSpanNativePx / spineWidthNative (168 px)", () => {
  const computed = (RC18_SPINE_HALF_SPAN_NATIVE_PX / 168) * 100
  assert.ok(Math.abs(computed - RC18_SPINE_HALF_SPAN_PCT) < 0.001)
  assert.ok(Math.abs((RC18_SPINE_HALF_SPAN_APP_PX / 336) * 100 - RC18_SPINE_HALF_SPAN_PCT) < 0.001)
})

/* ── Faithful fixtures ────────────────────────────────────────────────────────────────── */

test("a faithful native reference fixture validates and reports its type scale", () => {
  const audit = validateCaptureMetrics(nativeReferenceMetrics(), entryFor("reference"), RC18_SPEC)
  assert.deepEqual(
    audit.typeScale.map((step) => step.label),
    ["verdict", "sector", "summary", "secondary", "label"]
  )
  assert.deepEqual(audit.knownDefects, [])
  assert.deepEqual(audit.zoneDefects, [])
  assert.deepEqual(audit.containmentDefects, [])
})

test("a faithful native matched fixture validates with no alert chip", () => {
  const audit = validateCaptureMetrics(nativeMatchedMetrics(), entryFor("matched"), RC18_SPEC)
  assert.deepEqual(audit.typeScale.map((step) => step.label), ["verdict", "sector", "summary", "secondary", "label"])
})

test("a faithful app reference fixture validates with trace present and no nativeSize", () => {
  const audit = validateCaptureMetrics(appMetrics("reference"), entryFor("reference", 1), RC18_SPEC)
  assert.deepEqual(audit.typeScale.map((step) => step.label), ["verdict", "sector", "summary", "secondary", "label"])
})

test("a faithful app matched fixture validates", () => {
  assert.doesNotThrow(() =>
    validateCaptureMetrics(appMetrics("matched"), entryFor("matched", 1), RC18_SPEC)
  )
})

/* ── Fail-closed behaviour ────────────────────────────────────────────────────────────── */

test("a tie anywhere in the type scale is a failure, not a pass", () => {
  assertRejects(
    (m) => ({
      ...m,
      values: m.values.map((v) =>
        v.label === "sector" ? { ...v, fontSize: RC18_TYPE_SCALE_PX.verdict } : v
      )
    }),
    /type-scale hierarchy does not hold/u
  )
})

test("overlapping zones fail closed", () => {
  assertRejects(
    (m) => ({
      ...m,
      zones: m.zones.map((z) =>
        z.name === "columnB" ? { ...z, ...measured(rect(300, 50, 300, 380)) } : z
      )
    }),
    /overlaps/u
  )
})

test("an element that escapes its containment zone fails closed with the measured escape", () => {
  assertRejects(
    (m) => ({
      ...m,
      containment: m.containment.map((c) =>
        c.label === "spine title"
          ? { ...c, value: rect(316, 55, 300, 14) }   // right edge 616 > deltaStack.right 484 → escapes by 132 px
          : c
      )
    }),
    /spine title escapes/u
  )
})

test("a zone that is out of frame fails closed", () => {
  assertRejects(
    (m) => ({
      ...m,
      zones: m.zones.map((z) =>
        z.name === "columnB" ? { ...z, ...measured(rect(520, 50, 300, 380)) } : z
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
          key: "rc18-spine-title",
          text: "VERDICT",
          fontSize: 16,
          whiteSpace: "nowrap",
          clientWidth: 120,
          scrollWidth: 162,
          overflowX: 42,
          textLeft: 316,
          textRight: 478
        }
      ]
    }),
    /rc18-spine-title "VERDICT" paints 42px wider/u
  )
})

test("a zone whose own content overflows its layout box fails closed", () => {
  assertRejects(
    (m) => ({
      ...m,
      zones: m.zones.map((z) =>
        z.name === "stability" ? { ...z, scrollHeight: z.layoutHeight + 42 } : z
      )
    }),
    /zone stability overflows its layout box by 42\.00px/u
  )
})

test("datum centre-X spread > 1 px fails closed (shared-axis drift)", () => {
  assertRejects(
    (m) => ({
      ...m,
      // Shift S3 datum AND its track right by 3 px so the per-datum track-centre check still
      // passes (datum sits on its track's midpoint), but the spread S1/S2(400)..S3(403) = 3 px
      // exceeds SHARED_AXIS_TOLERANCE_PX (1 px) and the spread assertion fires.
      datumRects: { ...m.datumRects, S3: rect(402, 230, 2, 18) },  // centreX = 403
      trackRects: { ...m.trackRects, S3: rect(319, 230, 168, 18) }  // centreX = 403
    }),
    /datum centre-X spread/u
  )
})

test("columnA.width ≠ columnB.width fails closed (mirror asymmetry)", () => {
  assertRejects(
    (m) => ({
      ...m,
      zones: m.zones.map((z) =>
        z.name === "columnB" ? { ...z, ...measured(rect(484, 50, 310, 380)) } : z
      )
    }),
    /columns are asymmetric in width/u
  )
})

test("unequal column head heights fail closed (B header 4 px taller defect guard)", () => {
  assertRejects(
    (m) => ({ ...m, colBHeadRect: rect(484, 50, 300, 34) }),  // B = 34, A = 30, Δ = 4
    /column head heights are unequal.*Δ=4\.00 px/u
  )
})

test("a lean=a bar whose right edge misses the datum centre fails closed", () => {
  assertRejects(
    (m) => ({
      ...m,
      barRects: {
        ...m.barRects,
        S1: { rect: rect(378, 115, 9.74, 10), lean: "a" }  // right=387.74, datum centre=400, gap=12.26 > 2 px
      }
    }),
    /rc18-bar-S1 \(lean=a\) right edge/u
  )
})

test("a lean=b bar whose left edge misses the datum centre fails closed", () => {
  assertRejects(
    (m) => ({
      ...m,
      barRects: {
        ...m.barRects,
        S2: { rect: rect(390, 175, 63.65, 10), lean: "b" }  // left=390, datum centre=400, gap=10 > 2 px
      }
    }),
    /rc18-bar-S2 \(lean=b\) left edge/u
  )
})

test("a bar that does not satisfy the length formula fails closed", () => {
  assertRejects(
    (m) => ({
      ...m,
      barRects: {
        ...m.barRects,
        S2: { rect: rect(400, 175, 50, 10), lean: "b" }  // 50 vs expected 63.65, Δ=13.65 > 2 px
      }
    }),
    /rc18-bar-S2 width/u
  )
})

/* ── Packet omissions: absence is the contract ────────────────────────────────────────── */

test("reintroducing an RPM, LED or shift element fails closed (omission: rpmComparisonRow)", () => {
  assertRejects(
    (m) => ({
      ...m,
      forbidden: m.forbidden.map((f) => (f.label.includes("rpmComparisonRow") ? { ...f, count: 1 } : f))
    }),
    /omission: rpmComparisonRow.*must not be rendered/su
  )
})

test("reintroducing a speed readout zone fails closed (omission: speedNativeZone)", () => {
  assertRejects(
    (m) => ({
      ...m,
      forbidden: m.forbidden.map((f) => (f.label.includes("speedNativeZone") ? { ...f, count: 1 } : f))
    }),
    /omission: speedNativeZone/su
  )
})

test("reintroducing a best-lap or fuel readout fails closed (omission: bestLapAndFuelZone)", () => {
  assertRejects(
    (m) => ({
      ...m,
      forbidden: m.forbidden.map((f) => (f.label.includes("bestLapAndFuelZone") ? { ...f, count: 1 } : f))
    }),
    /omission: bestLapAndFuelZone/su
  )
})

test("reintroducing a match control fails closed (omission: matchLapControlZone)", () => {
  assertRejects(
    (m) => ({
      ...m,
      forbidden: m.forbidden.map((f) => (f.label.includes("matchLapControlZone") ? { ...f, count: 2 } : f))
    }),
    /omission: matchLapControlZone/su
  )
})

test("reintroducing a per-corner difference table fails closed (omission: perCornerDifferenceTable)", () => {
  assertRejects(
    (m) => ({
      ...m,
      forbidden: m.forbidden.map((f) => (f.label.includes("perCornerDifferenceTable") ? { ...f, count: 1 } : f))
    }),
    /omission: perCornerDifferenceTable/su
  )
})

test("printing the sector noise threshold fails closed (omission: alertNumerics — 0.050 s)", () => {
  assertRejects(
    (m) => ({ ...m, leafTexts: [...m.leafTexts, "0.050"] }),
    /renders "0\.050" as a readout/u
  )
})

test("printing the balance band threshold fails closed (omission: alertNumerics — 0.15)", () => {
  assertRejects(
    (m) => ({ ...m, leafTexts: [...m.leafTexts, "0.15"] }),
    /renders "0\.15" as a readout/u
  )
})

test("a trace element on the native canvas fails closed (omission: speedNativeZone / gap G9)", () => {
  assertRejects(
    (m) => ({ ...m, tracePresent: true }),
    /rc18-trace must not appear on the native/u
  )
})

test("no trace element on the app canvas fails closed (ab-trace-reveal)", () => {
  assert.throws(
    () => validateCaptureMetrics(
      appMetrics("reference", { tracePresent: false }),
      entryFor("reference", 1),
      RC18_SPEC
    ),
    (err) => err instanceof CaptureSafetyError && /rc18-trace must be present/u.test(err.message)
  )
})

/* ── Artifact promises ────────────────────────────────────────────────────────────────── */

test("brakeRear B renders '--' when the rear-right sensor is absent (honest empty: brakeAxleAggregation)", () => {
  // The faithful fixture should already have brakeRearBText="--" and pass.
  assert.doesNotThrow(() =>
    validateCaptureMetrics(nativeReferenceMetrics(), entryFor("reference"), RC18_SPEC)
  )
})

test("a non-'--' brakeRear B value in the reference state fails closed", () => {
  assertRejects(
    (m) => ({ ...m, brakeRearBText: "388" }),
    /rc18-b-brakeRear must render "--"/u,
    "reference"
  )
})

test("Setup A carries 1 identity line, Setup B carries 2 (normative override NO-6)", () => {
  // Faithful fixture passes.
  assert.doesNotThrow(() =>
    validateCaptureMetrics(nativeReferenceMetrics(), entryFor("reference"), RC18_SPEC)
  )
  // Wrong attribute fails.
  assertRejects(
    (m) => ({ ...m, identityBandsA: "2" }),
    /rc18-identity-a must have data-rc18-line-bands="1"/u
  )
  // Wrong child count fails.
  assertRejects(
    (m) => ({ ...m, identityLineCountB: 1 }),
    /rc18-identity-b must contain exactly 2/u
  )
})

test("native and app layouts have 22 rc18-row elements (11 per column)", () => {
  assert.doesNotThrow(() =>
    validateCaptureMetrics(nativeReferenceMetrics(), entryFor("reference"), RC18_SPEC)
  )
  assert.doesNotThrow(() =>
    validateCaptureMetrics(appMetrics("reference"), entryFor("reference", 1), RC18_SPEC)
  )
})

test("the wrong row count for the layout fails closed", () => {
  assertRejects(
    (m) => ({ ...m, counted: m.counted.map((c) => (c.label === "rc18-row" ? { ...c, count: 20 } : c)) }),
    /must render 22 rc18-row elements/u
  )
})

test("compact-phone layout expects 10 rc18-row elements (5 per column)", () => {
  assert.doesNotThrow(() =>
    validateCaptureMetrics(phoneReferenceMetrics(), { size: CAPTURE_SIZES[2], state: "reference" }, RC18_SPEC)
  )
})

test("a U+2212 minus in a delta text parses correctly (bar-length normaliser)", () => {
  // U+2212 MINUS SIGN is the typographic character RC-18 renders for negative deltas.
  // The bar-length formula normalises it to ASCII '-' before parseFloat — a raw parseFloat
  // would return NaN and falsely reject an otherwise-correct bar width.
  assert.doesNotThrow(() =>
    validateCaptureMetrics(
      nativeReferenceMetrics({
        deltaValues: { S1: "\u22120.041", S2: "\u22120.268", S3: "\u22120.159" }
      }),
      entryFor("reference"),
      RC18_SPEC
    )
  )
})

test("an incomparable:* alert key leaking into a compact-phone frame fails closed", () => {
  // The compact-phone reflow drops all brake and tyre rows; no incomparable alert may fire at all.
  assert.throws(
    () =>
      validateCaptureMetrics(
        phoneReferenceMetrics({
          stateAttributes: {
            ...phoneReferenceMetrics().stateAttributes,
            "alert-keys": "sector-gap:S2,sector-gap:S3,incomparable:brakeRear"
          }
        }),
        { size: CAPTURE_SIZES[2], state: "reference" },
        RC18_SPEC
      ),
    (error) =>
      error instanceof CaptureSafetyError &&
      /no incomparable alert may fire/u.test(error.message)
  )
})

test("a brake-rear row appearing at compact-phone fails closed (5-row reflow omits brakeRear)", () => {
  // compact-phone renders 5 rows; assertBrakeRearHonestEmpty requires brakeRearBText to be absent.
  assert.throws(
    () =>
      validateCaptureMetrics(
        phoneReferenceMetrics({ brakeRearBText: "--" }),
        { size: CAPTURE_SIZES[2], state: "reference" },
        RC18_SPEC
      ),
    (error) =>
      error instanceof CaptureSafetyError &&
      /renders 5 rows and must not render rc18-b-brakeRear/u.test(error.message)
  )
})

test("a genuinely resized native spine still fails (half-span cross-check)", () => {
  // Widening all three track rects to 200 px (left=300 so centre stays at 400) takes the
  // measuredHalfSpan from 76 px to ≈90.5 px — outside the ±4 px tolerance — and triggers
  // the spine-resize guard before the bar-width check can mask it.
  assertRejects(
    (m) => ({
      ...m,
      trackRects: {
        S1: { left: 300, top: m.trackRects.S1.top, width: 200, height: m.trackRects.S1.height },
        S2: { left: 300, top: m.trackRects.S2.top, width: 200, height: m.trackRects.S2.height },
        S3: { left: 300, top: m.trackRects.S3.top, width: 200, height: m.trackRects.S3.height }
      }
    }),
    /spine has been resized/u
  )
})

test("the reference state publishes alerts=active with the correct alert-keys", () => {
  assert.doesNotThrow(() =>
    validateCaptureMetrics(nativeReferenceMetrics(), entryFor("reference"), RC18_SPEC)
  )
  assertRejects(
    (m) => ({
      ...m,
      stateAttributes: { ...m.stateAttributes, alerts: "silent" }
    }),
    /reference frame must have data-rc18-alerts="active"/u
  )
})

test("the matched state publishes alerts=silent with empty alert-keys and incomparable=0", () => {
  assert.doesNotThrow(() =>
    validateCaptureMetrics(nativeMatchedMetrics(), entryFor("matched"), RC18_SPEC)
  )
  assertRejects(
    (m) => ({
      ...m,
      stateAttributes: { ...m.stateAttributes, alerts: "active" },
      alertChipPresent: true
    }),
    /matched frame must have data-rc18-alerts="silent"/u,
    "matched"
  )
})

test("rc18-alert-chip must be absent on the matched frame", () => {
  assertRejects(
    (m) => ({ ...m, alertChipPresent: true }),
    /matched frame must NOT render rc18-alert-chip/u,
    "matched"
  )
})

test("the data-rc18-native-size modifier must be '800x480' on native and absent elsewhere", () => {
  // Native: nativeSize="800x480" → passes
  assert.doesNotThrow(() =>
    validateCaptureMetrics(nativeReferenceMetrics(), entryFor("reference"), RC18_SPEC)
  )
  // App: nativeSize=null → passes
  assert.doesNotThrow(() =>
    validateCaptureMetrics(appMetrics("reference"), entryFor("reference", 1), RC18_SPEC)
  )
  // Native with null → fails
  assertRejects(
    (m) => ({ ...m, nativeSize: null }),
    /data-rc18-native-size must be 800x480/u
  )
})

/* ── Pixel audit ──────────────────────────────────────────────────────────────────────── */

test("a faithful reference PNG passes the pixel audit (info+sig+amber present, danger+normal absent)", () => {
  const result = validateCapturePixels(makeReferencePng(), PIXEL_ENTRY_REF, PIXEL_METRICS_REF)
  assert.ok(result.nonCanvasPixels > 0)
  assert.equal(result.infoHueFamily, "cyan")
  assert.equal(result.sigHueFamily, "blue")
})

test("a faithful matched PNG passes the pixel audit (info+sig present, amber absent)", () => {
  const result = validateCapturePixels(makeMatchedPng(), PIXEL_ENTRY_MATCH, PIXEL_METRICS_MATCH)
  assert.ok(result.nonCanvasPixels > 0)
})

test("a blank PNG fails the pixel audit", () => {
  assert.throws(
    () => validateCapturePixels(makeBlankPng(), PIXEL_ENTRY_REF, PIXEL_METRICS_REF),
    (err) => err instanceof CaptureSafetyError && /blank/u.test(err.message)
  )
})

test("a PNG with danger pixels fails the pixel audit on every frame", () => {
  assert.throws(
    () => validateCapturePixels(makeDangerPng(), PIXEL_ENTRY_REF, PIXEL_METRICS_REF),
    (err) => err instanceof CaptureSafetyError && /danger/u.test(err.message)
  )
  assert.throws(
    () => validateCapturePixels(makeDangerPng(), PIXEL_ENTRY_MATCH, PIXEL_METRICS_MATCH),
    (err) => err instanceof CaptureSafetyError && /danger/u.test(err.message)
  )
})

test("a PNG with normal (green) pixels fails the pixel audit on every frame", () => {
  assert.throws(
    () => validateCapturePixels(makeNormalPng(), PIXEL_ENTRY_REF, PIXEL_METRICS_REF),
    (err) => err instanceof CaptureSafetyError && /normal/u.test(err.message)
  )
  assert.throws(
    () => validateCapturePixels(makeNormalPng(), PIXEL_ENTRY_MATCH, PIXEL_METRICS_MATCH),
    (err) => err instanceof CaptureSafetyError && /normal/u.test(err.message)
  )
})

test("an unscoped caution pixel on the reference frame fails the pixel audit", () => {
  // makeUnscopedCautionPng puts caution at (50,50) which is outside NATIVE_INCOMPARABLE_ROW
  assert.throws(
    () => validateCapturePixels(makeUnscopedCautionPng(), PIXEL_ENTRY_REF, PIXEL_METRICS_REF),
    (err) => err instanceof CaptureSafetyError && /scoped/u.test(err.message)
  )
})

test("any caution pixel on the matched frame fails the pixel audit", () => {
  // makeUnscopedCautionPng has caution pixels; matched frame must have zero caution
  assert.throws(
    () => validateCapturePixels(makeUnscopedCautionPng(), PIXEL_ENTRY_MATCH, PIXEL_METRICS_MATCH),
    (err) => err instanceof CaptureSafetyError && /caution|amber/u.test(err.message)
  )
})

/* ── Disk-safety primitives (unforked from RC-01) ────────────────────────────────────── */

test("parseCaptureArgs, createPrivateStaging, prepareCaptureOutput and discardPrivateStaging are present and callable", () => {
  assert.equal(typeof parseCaptureArgs, "function")
  assert.equal(typeof createPrivateStaging, "function")
  assert.equal(typeof prepareCaptureOutput, "function")
  assert.equal(typeof discardPrivateStaging, "function")
})

test("assertTypeScaleOrder and containsRect are re-exported for downstream use", () => {
  assert.equal(typeof assertTypeScaleOrder, "function")
  assert.equal(typeof containsRect, "function")
})
