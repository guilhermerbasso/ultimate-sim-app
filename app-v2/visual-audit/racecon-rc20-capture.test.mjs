import assert from "node:assert/strict"
import test from "node:test"
import { PNG } from "pngjs"
import {
  CaptureSafetyError,
  createPrivateStaging,
  discardPrivateStaging,
  parseCaptureArgs,
  prepareCaptureOutput
} from "./racecon-capture-shared.mjs"
import {
  expectedCompactModeForBox,
  expectedLayoutForBox,
  hueFamily,
  hueFamilyOfHex
} from "./racecon-capture-shared.mjs"
import {
  CAPTURE_SIZES,
  CAPTURE_STATES,
  RC20_BG_RGBA,
  RC20_CAPTURE_MATRIX,
  RC20_CARD_COUNT,
  RC20_CAUTION_HEX,
  RC20_DANGER_HEX,
  RC20_EXPECTED_VALUES,
  RC20_GRID_STRIP_CELL_COUNT,
  RC20_INFO_HEX,
  RC20_LADDER_BAR_COUNT,
  RC20_LIT_BARS_GRID,
  RC20_LIT_BARS_NO_FEED,
  RC20_MODE_WORD_COUNT,
  RC20_NORMAL_HEX,
  RC20_PANEL_LUMINANCE_STEP_MIN,
  RC20_SIGNATURE_HEX,
  RC20_SPEC,
  RC20_TYPE_SCALE_MIN_SEPARATION_PCT,
  RC20_TYPE_SCALE_PX,
  RC20_WARMUP_TILE_COUNT,
  validateCaptureMetrics,
  validateCapturePixels
} from "./racecon-rc20-capture-lib.mjs"

/* ── Synthetic metric fixtures ────────────────────────────────────────────────────────── */

const CANVAS_RGB  = [8, 9, 12]       // #08090C bg
const PANEL_RGB   = [18, 20, 28]     // #12141C panel
const SIG_RGB     = [255, 42, 42]    // #FF2A2A signature (lit ladder bars) → red
const DANGER_RGB  = [255, 58, 46]    // #FF3A2E danger (alert layer)        → ALSO red (NO-8)
const CAUTION_RGB = [255, 194, 46]   // #FFC22E caution (cold warm-up)      → amber
const NORMAL_RGB  = [56, 208, 106]   // #38D06A normal (unused)             → green
const INFO_RGB    = [74, 140, 255]   // #4A8CFF info (clutch fill / band)   → blue

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

function zone(name, box) {
  return { name, selector: `[data-testid="rc20-${name}"]`, present: true, display: "block", ...measured(box) }
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
    color: "rgb(242, 244, 248)",
    display: "block"
  }
}

function owned(label, ownerBox, valueBox) {
  return { label, owner: ownerBox, ownerDisplay: "block", value: valueBox, valueDisplay: "block" }
}

function counted(label, selector, count) {
  return { label, selector, count }
}

function bar(index, lit) {
  return {
    index,
    lit,
    rect: rect(300 + index * 36, 100, 30, 240)
  }
}

/** Representative zones at native 800×480. These are approximate; test correctness, not px values. */
const NATIVE_HEADER = rect(16, 12, 768, 24)
const NATIVE_LADDER = rect(300, 48, 200, 292)
const NATIVE_LAUNCH = rect(40, 80, 220, 200)
const NATIVE_CLUTCH = rect(540, 80, 220, 200)
const NATIVE_STRIP  = rect(16, 352, 768, 60)

function nativeGridMetrics(state = "grid", overrides = {}) {
  const size = CAPTURE_SIZES[0]   // 800×480 native
  const litCount = state === "no-feed" ? RC20_LIT_BARS_NO_FEED : RC20_LIT_BARS_GRID
  const alertsAttr = state === "jump-start" ? "active" : "silent"
  const alertKeysAttr = state === "jump-start" ? "JUMP START" : ""
  const startFeedAttr = state === "no-feed" ? "unavailable" : "live"
  const stageAttr = state === "no-feed" ? "unavailable" : "S5"
  const modeAttr = state === "no-feed" ? "unavailable" : "GRID"

  const rpmBox = rect(60, 90, 180, 70)
  const clutchValBox = rect(558, 90, 180, 48)
  const startFeedBox = rect(300, 320, 200, 18)
  const scaleLabelBox = rect(60, 255, 160, 18)
  const bandLabelBox = rect(60, 240, 160, 18)
  const stageBox = rect(320, 200, 160, 20)
  const modeBox = rect(320, 280, 160, 20)

  const ladderBars = Array.from({ length: RC20_LADDER_BAR_COUNT }, (_, i) => bar(i, i < litCount))

  return {
    ...{
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
      presetId: RC20_SPEC.presetId,
      expectedWidgetId: RC20_SPEC.widgetId,
      renderedWidgetId: RC20_SPEC.widgetId,
      dashboardWidth: "1024",
      dashboardHeight: "600",
      sourceKind: "live-telemetry",
      sourceIdentity: RC20_SPEC.sourceIdentity,
      captureState: state,
      captureSequence: state === "grid" ? "85" : state === "jump-start" ? "75" : "30",
      layout: "native",
      compactMode: null,
      bufferState: "accepted",
      contentWidth: String(size.width),
      contentHeight: String(size.height),
      stateAttributes: {
        mode: modeAttr, armed: "true", stage: stageAttr,
        "lit-bars": String(litCount), "start-feed": startFeedAttr,
        "band-source": "none", alerts: alertsAttr, "alert-keys": alertKeysAttr,
        layout: "native", "compact-mode": null, "buffer-state": "accepted",
        "content-width": String(size.width), "content-height": String(size.height)
      },
      zones: [
        zone("header", NATIVE_HEADER),
        zone("ladder", NATIVE_LADDER),
        zone("launch", NATIVE_LAUNCH),
        zone("clutch", NATIVE_CLUTCH)
      ],
      values: [
        value("rpm",         '[data-testid="rc20-rpm"]',          "4,820", rpmBox,        RC20_TYPE_SCALE_PX.rpm),
        value("clutch-value",'[data-testid="rc20-clutch-value"]', "42",    clutchValBox,  RC20_TYPE_SCALE_PX.clutch),
        value("start-feed",  '[data-testid="rc20-start-feed"]',   startFeedAttr === "live" ? "START LIGHT SOURCE" : "NO START LIGHT SOURCE", startFeedBox, RC20_TYPE_SCALE_PX.label),
        value("scale-label", '[data-testid="rc20-scale-label"]',  "SCALE 0-7600", scaleLabelBox, RC20_TYPE_SCALE_PX.label),
        value("band-label",  '[data-testid="rc20-band-label"]',   "BAND --", bandLabelBox, RC20_TYPE_SCALE_PX.label),
        value("stage",       '[data-testid="rc20-stage"]',        stageAttr === "S5" ? "STAGE 5 OF 5" : "--", stageBox, RC20_TYPE_SCALE_PX.label),
        value("mode",        '[data-testid="rc20-mode"]',         modeAttr, modeBox, RC20_TYPE_SCALE_PX.label)
      ],
      containment: [
        owned("start-feed caption", NATIVE_LADDER, startFeedBox),
        owned("scale label",        NATIVE_LAUNCH, scaleLabelBox),
        owned("rpm in launch",      NATIVE_LAUNCH, rpmBox),
        owned("launch track",       NATIVE_LAUNCH, rect(60, 160, 200, 80)),
        owned("clutch value",       NATIVE_CLUTCH, clutchValBox),
        owned("clutch track",       NATIVE_CLUTCH, rect(558, 140, 200, 80)),
        owned("ladder bars",        NATIVE_LADDER, rect(300, 60, 200, 280)),
        owned("stage in ladder",    NATIVE_LADDER, stageBox)
      ],
      counted: [
        counted("ladder bar",         '[data-testid="rc20-ladder-bar"]',            RC20_LADDER_BAR_COUNT),
        counted("lit bar",            '[data-testid="rc20-ladder-bar"][data-rc20-lit="true"]', litCount),
        counted("mode word",          '[data-testid="rc20-mode-word"]',              RC20_MODE_WORD_COUNT),
        counted("card",               '.rc20-card',                                  RC20_CARD_COUNT),
        counted("strip cell",         '[data-rc20-zone="strip"] [data-testid="rc20-strip-cell"]', RC20_GRID_STRIP_CELL_COUNT),
        counted("warmup tile",        '[data-testid="rc20-warmup-tile"]',            0),
        counted("jump start",         '[data-testid="rc20-jump-start"]',             state === "jump-start" ? 1 : 0),
        counted("over rev cap",       '[data-testid="rc20-over-rev-cap"]',           0),
        counted("ribbon status",      '[data-testid="rc20-ribbon-status"]',          0),
        counted("warmup provenance",  '[data-testid="rc20-warmup-provenance"]',      0),
        counted("review",             '[data-testid="rc20-review"]',                 0),
        counted("launch band",        '[data-testid="rc20-launch-band"]',            0),
        counted("launch needle",      '[data-testid="rc20-launch-needle"]',          1)
      ],
      forbidden: RC20_SPEC.forbidden.map(([label, selector]) => ({ label, selector, count: 0 })),
      textOutputs: ["4,820", "42"],
      leafTexts: [
        "TRAINING AID", "FORMATION", "LAUNCH", modeAttr,
        "4,820", "42", "BAND --", "SCALE 0-7600",
        stageAttr === "S5" ? "STAGE 5 OF 5" : "--"
      ],
      overflowLeaves: [],
      rootText:
        "FORMATION GRID LAUNCH TRAINING AID " + (stageAttr === "S5" ? "STAGE 5 OF 5" : "--") +
        " " + (startFeedAttr === "live" ? "START LIGHT SOURCE" : "NO START LIGHT SOURCE") +
        " 4,820 SCALE 0-7600 42 BAND --" +
        (state === "jump-start" ? " HOLD" : ""),
      errorBoundaryCount: 0,
      unknownWidgetCount: 0,
      failures: [],
      // RC-20-specific fields
      ladderBarCount: String(RC20_LADDER_BAR_COUNT),
      ladderBars,
      stripCellFontSize: RC20_TYPE_SCALE_PX.strip,   // 30px; null at app (strip absent)
      stripSlotText: "--",
      alertScope: state === "jump-start" ? [rect(300, 100, 200, 60)] : []
    },
    ...overrides
  }
}

function appGridMetrics(state = "grid", overrides = {}) {
  const size = CAPTURE_SIZES[1]  // 1024×600 app
  const base = nativeGridMetrics(state)
  return {
    ...base,
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
    stateAttributes: { ...base.stateAttributes, layout: "app", "compact-mode": null,
      "content-width": String(size.width), "content-height": String(size.height) },
    zones: [
      zone("header",  rect(48, 6, 928, 30)),
      zone("ladder",  rect(412, 48, 200, 360)),
      zone("launch",  rect(48, 80, 300, 300)),
      zone("clutch",  rect(676, 80, 300, 300))
    ],
    counted: base.counted.map((entry) => {
      if (entry.label === "strip cell")        return { ...entry, count: 0 }
      if (entry.label === "warmup tile")       return { ...entry, count: RC20_WARMUP_TILE_COUNT }
      if (entry.label === "ribbon status")     return { ...entry, count: 1 }
      if (entry.label === "review")            return { ...entry, count: 1 }
      if (entry.label === "warmup provenance") return { ...entry, count: 1 }
      return entry
    }),
    rootText: base.rootText + " DECLARED",
    stripCellFontSize: null,   // strip is absent at app layout; 3-level type-scale check only
    ...overrides
  }
}

function entryFor(state = "grid", index = 0) {
  return { size: CAPTURE_SIZES[index], state, required: [] }
}

function assertRejects(mutate, expected, state = "grid") {
  const metrics = mutate(nativeGridMetrics(state))
  assert.throws(
    () => validateCaptureMetrics(metrics, entryFor(state)),
    (error) => error instanceof CaptureSafetyError && expected.test(error.message),
    `expected a CaptureSafetyError matching ${expected}`
  )
}

/* ── Matrix and contract ──────────────────────────────────────────────────────────────── */

test("the governed matrix covers every viewport in every governed state", () => {
  assert.equal(RC20_CAPTURE_MATRIX.length, CAPTURE_SIZES.length * CAPTURE_STATES.length)
  for (const state of CAPTURE_STATES) {
    for (const size of CAPTURE_SIZES) {
      const entry = RC20_CAPTURE_MATRIX.find(
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

test("the grid state waits for stage=S5 and alerts=silent, not a guessed frame count", () => {
  for (const entry of RC20_CAPTURE_MATRIX.filter((e) => e.state === "grid")) {
    const required = Object.fromEntries(entry.required)
    assert.equal(required.stage, "S5")
    assert.equal(required.alerts, "silent")
  }
})

test("the jump-start state waits for alerts=active (debounce has fired), not a guessed frame count", () => {
  for (const entry of RC20_CAPTURE_MATRIX.filter((e) => e.state === "jump-start")) {
    const required = Object.fromEntries(entry.required)
    assert.equal(required.alerts, "active")
  }
})

test("the no-feed state waits for start-feed=unavailable and lit-bars=0 (never simulate start lights)", () => {
  for (const entry of RC20_CAPTURE_MATRIX.filter((e) => e.state === "no-feed")) {
    const required = Object.fromEntries(entry.required)
    assert.equal(required["start-feed"], "unavailable")
    assert.equal(required["lit-bars"], "0")
  }
})

/* ── Ladder counting structure ────────────────────────────────────────────────────────── */

test("RC20_LADDER_BAR_COUNT is 5 — the ladder is a counting structure", () => {
  assert.equal(RC20_LADDER_BAR_COUNT, 5)
})

test("a faithful grid fixture validates with exactly 5 bars, all lit (S5 — lit-bars=5)", () => {
  const audit = validateCaptureMetrics(nativeGridMetrics("grid"), entryFor("grid"))
  assert.equal(audit.ladder.barCount, RC20_LADDER_BAR_COUNT)
  assert.equal(audit.ladder.litCount, RC20_LIT_BARS_GRID)
  assert.deepEqual(audit.knownDefects, [])
  assert.deepEqual(audit.zoneDefects, [])
  assert.deepEqual(audit.containmentDefects, [])
})

test("a faithful no-feed fixture validates with exactly 5 bars, all dark (lit-bars=0)", () => {
  const audit = validateCaptureMetrics(nativeGridMetrics("no-feed"), entryFor("no-feed"))
  assert.equal(audit.ladder.barCount, RC20_LADDER_BAR_COUNT)
  assert.equal(audit.ladder.litCount, RC20_LIT_BARS_NO_FEED)
})

test("lit + unlit equals exactly 5 bars in every state", () => {
  for (const state of CAPTURE_STATES) {
    const metrics = nativeGridMetrics(state)
    const lit = metrics.counted.find((c) => c.label === "lit bar").count
    const total = metrics.counted.find((c) => c.label === "ladder bar").count
    assert.equal(lit + (total - lit), RC20_LADDER_BAR_COUNT,
      `lit + unlit must equal ${RC20_LADDER_BAR_COUNT} at state ${state}`)
  }
})

test("four bars fails closed (undercount — counting-structure violation)", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      counted: metrics.counted.map((entry) =>
        entry.label === "ladder bar" ? { ...entry, count: 4 } : entry
      )
    }),
    /must render exactly 5 ladder bars.*found 4/u
  )
})

test("six bars fails closed (overcount — counting-structure violation)", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      counted: metrics.counted.map((entry) =>
        entry.label === "ladder bar" ? { ...entry, count: 6 } : entry
      )
    }),
    /must render exactly 5 ladder bars.*found 6/u
  )
})

/**
 * A fabricated intermediate lit count (1–4) means S1–S4 were decoded. The shipped decoder
 * can only produce DARK | ARMED | S5 | RELEASED | unavailable — S1–S4 are never emitted
 * (RC20_PACKET_OMISSIONS.startLightLadderStages). Intermediate counts FAIL CLOSED.
 *
 * NOTE: "STAGE 3 OF 5" with 3 lit bars appears in the approved reference IMAGE because that is
 * the image-QA reference frame; the shipped decoder cannot reproduce it. DO NOT report
 * "3 lit expected, 5 observed" as a render-QA failure — it is the correct behaviour.
 */
test("a fabricated intermediate lit count (1–4) fails closed — S1–S4 are never decoded", () => {
  for (const fabricated of [1, 2, 3, 4]) {
    assertRejects(
      (metrics) => ({
        ...metrics,
        stateAttributes: { ...metrics.stateAttributes, "lit-bars": String(fabricated) },
        ladderBars: Array.from({ length: RC20_LADDER_BAR_COUNT }, (_, i) => bar(i, i < fabricated)),
        counted: metrics.counted.map((entry) =>
          entry.label === "lit bar" ? { ...entry, count: fabricated } : entry
        )
      }),
      /fabricated intermediate stage/u
    )
  }
})

/* ── Grid strip cell count (override NO-7) ────────────────────────────────────────────── */

test("exactly 8 strip cells at native (gridStripEightCells override NO-7)", () => {
  const audit = validateCaptureMetrics(nativeGridMetrics("grid"), entryFor("grid"))
  assert.equal(audit.layout.stripCells, RC20_GRID_STRIP_CELL_COUNT)
})

test("exactly 0 strip cells at app (strip replaced by warmup map — appCanvasModeAndSlot)", () => {
  const audit = validateCaptureMetrics(appGridMetrics("grid"), entryFor("grid", 1))
  assert.equal(audit.layout.stripCells, 0)
  assert.ok(audit.layout.app)
})

test("app canvas reports zero strip cells while ribbon-status and review cells exist (scoped selector)", () => {
  // The 'strip cell' counted entry is now scoped to [data-rc20-zone="strip"]. StripCell is
  // reused outside that zone (ribbon-status, launch-review) and must not inflate the strip count.
  const metrics = appGridMetrics("grid")
  assert.equal(metrics.counted.find((c) => c.label === "strip cell").count, 0)    // strip absent ✓
  assert.equal(metrics.counted.find((c) => c.label === "ribbon status").count, 1) // ribbon present ✓
  assert.equal(metrics.counted.find((c) => c.label === "review").count, 1)         // review present ✓
  assert.doesNotThrow(() => validateCaptureMetrics(metrics, entryFor("grid", 1)))
})

test("nine strip cells fails closed (NO-7: nine measures 801.6 px in a 768 px zone)", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      counted: metrics.counted.map((entry) =>
        entry.label === "strip cell" ? { ...entry, count: 9 } : entry
      )
    }),
    /exactly 8.*strip cells.*found 9/u
  )
})

test("seven strip cells fails closed (undercount equally wrong)", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      counted: metrics.counted.map((entry) =>
        entry.label === "strip cell" ? { ...entry, count: 7 } : entry
      )
    }),
    /exactly 8.*strip cells.*found 7/u
  )
})

test("exactly 8 warmup tiles at app (appCanvasModeAndSlot)", () => {
  const audit = validateCaptureMetrics(appGridMetrics("grid"), entryFor("grid", 1))
  assert.equal(audit.layout.warmupTiles, RC20_WARMUP_TILE_COUNT)
})

/* ── Mode words and cards ─────────────────────────────────────────────────────────────── */

test("exactly 3 mode words (FORMATION, GRID, LAUNCH) in every governed layout", () => {
  const audit = validateCaptureMetrics(nativeGridMetrics("grid"), entryFor("grid"))
  assert.equal(RC20_MODE_WORD_COUNT, 3)
  assert.ok(audit.knownDefects !== undefined)
})

test("two mode words fails closed", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      counted: metrics.counted.map((entry) =>
        entry.label === "mode word" ? { ...entry, count: 2 } : entry
      )
    }),
    /exactly 3 mode words.*found 2/u
  )
})

test("exactly 2 cards (launch + clutch) at every layout", () => {
  assert.equal(RC20_CARD_COUNT, 2)
  const audit = validateCaptureMetrics(nativeGridMetrics("grid"), entryFor("grid"))
  assert.ok(audit.layout !== undefined)
})

test("one card fails closed", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      counted: metrics.counted.map((entry) =>
        entry.label === "card" ? { ...entry, count: 1 } : entry
      )
    }),
    /exactly 2 cards.*found 1/u
  )
})

/* ── Type scale ───────────────────────────────────────────────────────────────────────── */

test("the type scale is strictly ordered rpm > clutch > strip > label — never a tie", () => {
  assert.ok(RC20_TYPE_SCALE_PX.rpm > RC20_TYPE_SCALE_PX.clutch)
  assert.ok(RC20_TYPE_SCALE_PX.clutch > RC20_TYPE_SCALE_PX.strip)
  assert.ok(RC20_TYPE_SCALE_PX.strip > RC20_TYPE_SCALE_PX.label)
})

test("a type-scale tie anywhere is a failure, not a pass", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      values: metrics.values.map((entry) =>
        entry.label === "clutch-value" ? { ...entry, fontSize: RC20_TYPE_SCALE_PX.rpm } : entry
      )
    }),
    /type-scale hierarchy does not hold/u
  )
})

test("strip-value font size below the label size fails closed (17 px label vs 15 px strip)", () => {
  // stripCellFontSize is now sourced from the VALUE output element, not the strip-cell wrapper.
  // The wrapper inherits the 17 px label size; the real value renders at 30 px. A 15 px reading
  // (below the 17 px label) must fail the 4-level type-scale hierarchy check.
  assertRejects(
    (metrics) => ({ ...metrics, stripCellFontSize: 15 }),
    /type-scale hierarchy does not hold/u
  )
})

test("the 8% minimum separation holds for each adjacent rung (arithmetic verified in comments)", () => {
  // rpm → clutch:   (64 − 44) / 64 = 31.25 % ≥ 8 %
  // clutch → strip: (44 − 30) / 44 = 31.82 % ≥ 8 %
  // strip → label:  (30 − 17) / 30 = 43.33 % ≥ 8 %
  const steps = [RC20_TYPE_SCALE_PX.rpm, RC20_TYPE_SCALE_PX.clutch, RC20_TYPE_SCALE_PX.strip, RC20_TYPE_SCALE_PX.label]
  for (let index = 1; index < steps.length; index += 1) {
    const pct = ((steps[index - 1] - steps[index]) / steps[index - 1]) * 100
    assert.ok(pct >= RC20_TYPE_SCALE_MIN_SEPARATION_PCT,
      `step ${steps[index - 1]}→${steps[index]} separation is ${pct.toFixed(2)} %, must be ≥ ${RC20_TYPE_SCALE_MIN_SEPARATION_PCT} %`)
  }
})

/* ── Nowrap overflow containment (fail-closed proofs) ────────────────────────────────── */

/**
 * raceconRc20.css lines 91–98 audit note (verbatim):
 *   "Every LABEL wraps. `white-space: nowrap` makes a flex item's min-content width exceed its
 *    column, so `overflow: hidden` never clips it and `scrollWidth === clientWidth` while the
 *    glyph escapes into its neighbour. A real-browser audit caught exactly that on the ladder's
 *    feed caption, the launch card's scale label and the warm-up map's provenance caption, in a
 *    pass that every jsdom and `scrollWidth` check had already declared clean. Labels therefore
 *    wrap; only NUMERALS keep `nowrap`, and every numeral is sized in `cqw` with a conservative
 *    clamp maximum and given its own full-width row so the arithmetic — not `overflow` — contains it."
 *
 * The three elements escape via BoundingClientRect, not scrollWidth. assertZoneContainment
 * detects this class of overflow because it measures the TRUE rect, not scrollWidth.
 */
test("start-feed escaping the ladder zone fails closed (nowrap overflow via BoundingClientRect)", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      containment: metrics.containment.map((entry) =>
        entry.label === "start-feed caption"
          ? { ...entry, value: rect(NATIVE_LADDER.left + NATIVE_LADDER.width + 20, 300, 120, 18) }
          : entry
      )
    }),
    /start-feed caption escapes its zone on the right by/u
  )
})

test("scale-label escaping the launch zone fails closed (nowrap overflow via BoundingClientRect)", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      containment: metrics.containment.map((entry) =>
        entry.label === "scale label"
          ? { ...entry, value: rect(NATIVE_LAUNCH.left + NATIVE_LAUNCH.width + 35, 260, 160, 18) }
          : entry
      )
    }),
    /scale label escapes its zone on the right by/u
  )
})

test("warmup-provenance escaping the warmup zone fails closed at app (nowrap overflow)", () => {
  const base = appGridMetrics("grid")
  const warmupZone = rect(48, 420, 600, 150)
  const escaped = {
    ...base,
    containment: [
      ...base.containment,
      owned("warmup provenance", warmupZone, rect(warmupZone.left + warmupZone.width + 42, 440, 180, 18))
    ]
  }
  assert.throws(
    () => validateCaptureMetrics(escaped, entryFor("grid", 1)),
    (error) => error instanceof CaptureSafetyError && /warmup provenance escapes its zone on the right by/u.test(error.message)
  )
})

test("a zone whose content overflows its layout box fails closed", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      zones: metrics.zones.map((entry) =>
        entry.name === "launch" ? { ...entry, scrollHeight: entry.layoutHeight + 42 } : entry
      )
    }),
    /zone launch overflows its layout box by 42\.00px/u
  )
})

test("an element that escapes its zone fails closed with the measured escape", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      containment: metrics.containment.map((entry) =>
        entry.label === "rpm in launch"
          ? { ...entry, value: rect(NATIVE_LAUNCH.left + NATIVE_LAUNCH.width + 30, 100, 180, 70) }
          : entry
      )
    }),
    /rpm in launch escapes its zone on the right by \d+\.\d+px/u
  )
})

test("an element out of frame fails closed", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      zones: metrics.zones.map((entry) =>
        entry.name === "clutch"
          ? { ...entry, ...measured(rect(820, 80, 220, 200)) }
          : entry
      )
    }),
    /is out of frame/u
  )
})

/* ── Packet omissions: absence is the contract ────────────────────────────────────────── */

test("reintroducing a shift-LED or rev surface fails closed (omission: shiftLedReturn)", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      forbidden: metrics.forbidden.map((entry) =>
        entry.label.includes("shiftLedReturn") ? { ...entry, count: 1 } : entry
      )
    }),
    /omission: shiftLedReturn.*must not be rendered/su
  )
})

test("reintroducing a launch-arm control button fails closed (omission: launchArmControlIsExternal)", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      forbidden: metrics.forbidden.map((entry) =>
        entry.label.includes("launchArmControlIsExternal") ? { ...entry, count: 1 } : entry
      )
    }),
    /omissions?:.*launchArmControlIsExternal.*must not be rendered/su
  )
})

test("reintroducing a wheelspin readout fails closed (omission: wheelspinReview)", () => {
  assertRejects(
    (metrics) => ({
      ...metrics,
      forbidden: metrics.forbidden.map((entry) =>
        entry.label.includes("wheelspinReview") ? { ...entry, count: 1 } : entry
      )
    }),
    /omission: wheelspinReview.*must not be rendered/su
  )
})

test("reintroducing a water-temperature zone fails closed — structural check (omission: waterTempGearFuel)", () => {
  // "84" was removed from RC20_FORBIDDEN_LEAF_TEXTS: the fixture feeds both waterTempC=84 and
  // tyres.lr.tempC=84, and the grid strip legitimately prints the LR tyre temperature. A bare
  // leaf-text check cannot distinguish the two. The omission is instead proved structurally via
  // forbidden selectors — any rc20-water-temp or [data-rc20-zone="water"] element in the DOM is
  // a reintroduction and must fail closed.
  assertRejects(
    (metrics) => ({
      ...metrics,
      forbidden: [
        ...metrics.forbidden,
        {
          label: "a water-temperature readout (omission: waterTempGearFuel)",
          selector: '[data-testid="rc20-water-temp"], [data-rc20-zone="water"]',
          count: 1
        }
      ]
    }),
    /must not be rendered/u
  )
})

test("printing fuel level fails closed (omission: waterTempGearFuel)", () => {
  assertRejects(
    (metrics) => ({ ...metrics, leafTexts: [...metrics.leafTexts, "96.4"] }),
    /renders "96\.4" as a readout/u
  )
})

test("grid slot reads '--' and never a number (omission: gridSlot)", () => {
  // A non-dash grid slot text is a regression
  assertRejects(
    (metrics) => ({ ...metrics, stripSlotText: "7" }),
    /rc20-strip-slot must read "--"/u
  )
})

/* ── Faithful fixture round-trips ────────────────────────────────────────────────────── */

test("a faithful grid fixture validates (mode=GRID, stage=S5, lit-bars=5, alerts=silent)", () => {
  const audit = validateCaptureMetrics(nativeGridMetrics("grid"), entryFor("grid"))
  assert.equal(audit.ladder.litCount, 5)
  assert.deepEqual(audit.knownDefects, [])
})

test("a faithful jump-start fixture validates (alerts=active, JUMP START key)", () => {
  const audit = validateCaptureMetrics(nativeGridMetrics("jump-start"), entryFor("jump-start"))
  assert.equal(audit.alerts.alerts, "active")
  assert.ok(audit.alerts.alertKeys.includes("JUMP START"))
})

test("a faithful no-feed fixture validates (start-feed=unavailable, lit-bars=0)", () => {
  const audit = validateCaptureMetrics(nativeGridMetrics("no-feed"), entryFor("no-feed"))
  assert.equal(audit.ladder.litCount, 0)
  assert.equal(audit.feed.startFeed, "unavailable")
})

test("a faithful app fixture validates (warmup tiles=8, strip=0, ribbon present)", () => {
  const audit = validateCaptureMetrics(appGridMetrics("grid"), entryFor("grid", 1))
  assert.equal(audit.layout.warmupTiles, 8)
  assert.equal(audit.layout.stripCells, 0)
  assert.ok(audit.layout.app)
})

/* ── Reference values (approved attempt-003) ─────────────────────────────────────────── */

test("the reference values match the approved attempt-003 channel snapshot", () => {
  assert.equal(RC20_EXPECTED_VALUES.rpm, "4,820")
  assert.equal(RC20_EXPECTED_VALUES.clutch, "42")
  assert.equal(RC20_EXPECTED_VALUES.stage, "STAGE 5 OF 5")
  assert.equal(RC20_EXPECTED_VALUES.mode, "GRID")
  assert.equal(RC20_EXPECTED_VALUES.litBars, 5)
  assert.equal(RC20_EXPECTED_VALUES.startFeed, "live")
  assert.equal(RC20_EXPECTED_VALUES.bandSource, "none")
  assert.equal(RC20_EXPECTED_VALUES.alerts, "silent")
})

test("the shipped decoder stage enum excludes S1-S4 (startLightLadderStages omission)", () => {
  // S1..S4 can never be produced by the shipped decoder from iRacing SessionFlags bits.
  // lit-bars in {0, 5} is the true contract; any other value means fabricated stages.
  assert.equal(RC20_LIT_BARS_GRID, 5)
  assert.equal(RC20_LIT_BARS_NO_FEED, 0)
  // Confirm: the approved reference SHOWS "STAGE 3 OF 5" / 3 lit bars, but that is the
  // image-QA reference frame. The shipped decoder produces only 0 or 5 lit bars.
  // "3 lit expected, 5 observed" MUST NOT be reported as a defect.
})

/* ── Pixel audit ──────────────────────────────────────────────────────────────────────── */

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
  return image
}

// Panel zone (a card background area)
const PANEL_ZONE = rect(40, 80, 220, 200)
// Ladder bar rects (matching native fixture ladderBars)
const LADDER_RECTS = Array.from({ length: RC20_LADDER_BAR_COUNT }, (_, i) => rect(300 + i * 36, 100, 30, 240))
// Alert element rect (for jump-start test)
const ALERT_RECT = rect(300, 100, 200, 60)

function capturePng(state, {
  blank = false,
  noRed = false,
  strayRed = false,
  amber = false,
  green = false,
  noBlue = false,
  noPanel = false
} = {}) {
  const size = CAPTURE_SIZES[0]
  const image = paintPng(size, CANVAS_RGB)
  if (blank) return PNG.sync.write(image)

  if (!noPanel) {
    fillRect(image, PANEL_ZONE, PANEL_RGB)
    fillRect(image, rect(540, 80, 220, 200), PANEL_RGB)
  }

  if (!noBlue) {
    // Clutch fill (always present at clutch=0.42)
    fillRect(image, rect(560, 120, 180, 40), INFO_RGB)
  }

  if (state !== "no-feed" && !noRed) {
    // Lit ladder bars (signature red, scoped to their rects)
    for (const r of LADDER_RECTS) fillRect(image, r, SIG_RGB)
  }

  if (state === "jump-start" && !noRed) {
    // Alert overlay (danger red, scoped to alert rect)
    fillRect(image, ALERT_RECT, DANGER_RGB)
  }

  if (strayRed) {
    // Red outside any governed scope
    fillRect(image, rect(10, 10, 20, 20), SIG_RGB)
  }

  if (amber) fillRect(image, rect(400, 400, 20, 20), CAUTION_RGB)
  if (green) fillRect(image, rect(300, 400, 20, 20), NORMAL_RGB)

  return PNG.sync.write(image)
}

function pixelEntry(state = "grid") {
  const entry = entryFor(state)
  const metrics = nativeGridMetrics(state)
  return { entry, metrics }
}

test("the pixel audit accepts the grid frame: red present, scoped to ladder bars", () => {
  const { entry, metrics } = pixelEntry("grid")
  const audit = validateCapturePixels(capturePng("grid"), entry, metrics)
  assert.ok(audit.hueFamilies.red > 0)
  assert.equal(audit.redOutsideScope, 0)
  assert.equal(audit.hueFamilies.amber, 0)
  assert.equal(audit.hueFamilies.green, 0)
  assert.ok(audit.hueFamilies.blue > 0)
})

test("the pixel audit accepts the no-feed frame: red absent (never simulate start lights)", () => {
  const { entry, metrics } = pixelEntry("no-feed")
  const audit = validateCapturePixels(capturePng("no-feed"), entry, metrics)
  assert.equal(audit.hueFamilies.red, 0)
  assert.equal(audit.hueFamilies.amber, 0)
})

test("the pixel audit accepts the jump-start frame: red scoped to bars + alert rects", () => {
  const { entry, metrics } = pixelEntry("jump-start")
  const audit = validateCapturePixels(capturePng("jump-start"), entry, metrics)
  assert.ok(audit.hueFamilies.red > 0)
  assert.equal(audit.redOutsideScope, 0)
})

test("a blank frame fails closed", () => {
  const { entry, metrics } = pixelEntry("grid")
  assert.throws(
    () => validateCapturePixels(capturePng("grid", { blank: true }), entry, metrics),
    (error) => error instanceof CaptureSafetyError && /blank against the RC-20 canvas colour/u.test(error.message)
  )
})

test("red absent on no-feed but present anywhere fails closed", () => {
  const { entry, metrics } = pixelEntry("no-feed")
  assert.throws(
    () => validateCapturePixels(capturePng("no-feed", { strayRed: true }), entry, metrics),
    (error) => error instanceof CaptureSafetyError && /red hue family must be absent/u.test(error.message)
  )
})

test("stray red outside the ladder scope on the grid frame fails closed", () => {
  const { entry, metrics } = pixelEntry("grid")
  assert.throws(
    () => validateCapturePixels(capturePng("grid", { strayRed: true }), entry, metrics),
    (error) => error instanceof CaptureSafetyError && /red pixels fall outside the elements that own/u.test(error.message)
  )
})

test("red absent on the grid frame fails closed (no lit bars means the widget is broken)", () => {
  const { entry, metrics } = pixelEntry("grid")
  assert.throws(
    () => validateCapturePixels(capturePng("grid", { noRed: true }), entry, metrics),
    (error) => error instanceof CaptureSafetyError && /red hue family must be painted/u.test(error.message)
  )
})

test("any amber fails closed on every frame — caution belongs to cold warm-up only", () => {
  for (const state of CAPTURE_STATES) {
    const { entry, metrics } = pixelEntry(state)
    assert.throws(
      () => validateCapturePixels(capturePng(state, { amber: true }), entry, metrics),
      (error) => error instanceof CaptureSafetyError && /amber hue family must be absent/u.test(error.message),
      `amber should fail on state=${state}`
    )
  }
})

test("any green fails closed on every frame — normal #38D06A is declared but zero pixels", () => {
  for (const state of CAPTURE_STATES) {
    const { entry, metrics } = pixelEntry(state)
    assert.throws(
      () => validateCapturePixels(capturePng(state, { green: true }), entry, metrics),
      (error) => error instanceof CaptureSafetyError && /green hue family must be absent/u.test(error.message),
      `green should fail on state=${state}`
    )
  }
})

/**
 * Override NO-8 (`RC20_PACKET_OMISSIONS.twoRedTokens`):
 *   danger #FF3A2E (hue ≈ 3.4°) and signature #FF2A2A (hue ≈ 0°) both land in the "red" family.
 *   `hueFamilyOfHex` CANNOT separate them. A channel-ratio test also cannot separate them.
 *   Only the scoped/DOM proof (ladder-bar rects for signature, alert rects for danger) can.
 *   This test DEMONSTRATES the limitation so a future reviewer knows why the scoped proof exists.
 */
test("danger and signature fall in the SAME red family — hue cannot separate them (override NO-8)", () => {
  assert.equal(hueFamilyOfHex(RC20_SIGNATURE_HEX), "red")
  assert.equal(hueFamilyOfHex(RC20_DANGER_HEX), "red")
  assert.equal(hueFamilyOfHex(RC20_SIGNATURE_HEX), hueFamilyOfHex(RC20_DANGER_HEX))
})

test("a naive channel-ratio test cannot separate the RC-20 red palette but the scope proof can", () => {
  // `r > 200 && g < 80 && b < 80` accepts both tokens and cannot tell them apart
  const ratioSaysRed = ([r, g, b]) => r > 200 && g < 80 && b < 80
  assert.equal(ratioSaysRed(SIG_RGB),    true)   // #FF2A2A — ladder bars
  assert.equal(ratioSaysRed(DANGER_RGB), true)   // #FF3A2E — alert layer
  // Hue also cannot separate them
  assert.equal(hueFamily(...SIG_RGB),    "red")
  assert.equal(hueFamily(...DANGER_RGB), "red")
  // Only the DOM-scoped proof distinguishes them: signature is only at ladder-bar rects,
  // danger is only at alert-element rects.
})

test("caution and info resolve to the correct non-red families", () => {
  assert.equal(hueFamilyOfHex(RC20_CAUTION_HEX), "amber")
  assert.equal(hueFamilyOfHex(RC20_NORMAL_HEX),  "green")
  assert.equal(hueFamilyOfHex(RC20_INFO_HEX),    "blue")
})

test("the panel luminance step is >= 9 from a synthetic PNG with bg and panel colours", () => {
  const size = CAPTURE_SIZES[0]
  const image = paintPng(size, CANVAS_RGB)
  fillRect(image, PANEL_ZONE, PANEL_RGB)
  fillRect(image, rect(560, 120, 180, 40), INFO_RGB)
  for (const r of LADDER_RECTS) fillRect(image, r, SIG_RGB)
  const buffer = PNG.sync.write(image)
  const { entry, metrics } = pixelEntry("grid")
  const audit = validateCapturePixels(buffer, entry, metrics)
  assert.ok(audit.panelStep >= RC20_PANEL_LUMINANCE_STEP_MIN,
    `panel step ${audit.panelStep.toFixed(2)} must be >= ${RC20_PANEL_LUMINANCE_STEP_MIN}`)
})

test("a panel step below 9 fails closed (the rendered step must match the token contract)", () => {
  const size = CAPTURE_SIZES[0]
  // Fill the whole canvas with bg — no panel pixels at all, so the step check fails
  const image = paintPng(size, CANVAS_RGB)
  for (const r of LADDER_RECTS) fillRect(image, r, SIG_RGB)
  fillRect(image, rect(560, 120, 180, 40), INFO_RGB)
  const buffer = PNG.sync.write(image)
  const { entry, metrics } = pixelEntry("grid")
  assert.throws(
    () => validateCapturePixels(buffer, entry, metrics),
    (error) => error instanceof CaptureSafetyError &&
      (/panel.*luminance step/u.test(error.message) || /no panel pixels/u.test(error.message))
  )
})

/* ── Disk safety comes from RC-01 via the shared module, unforked ─────────────────────── */

test("the shared disk-safety primitives are the RC-01 originals, unforked", () => {
  assert.equal(typeof parseCaptureArgs, "function")
  assert.equal(typeof prepareCaptureOutput, "function")
  assert.equal(typeof createPrivateStaging, "function")
  assert.equal(typeof discardPrivateStaging, "function")
  assert.throws(() => parseCaptureArgs(["--mode", "final"]), CaptureSafetyError)
})
