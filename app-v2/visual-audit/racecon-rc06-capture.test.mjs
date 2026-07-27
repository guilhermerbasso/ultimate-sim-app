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
  hueFamilyOfHex,
  validateCommonMetrics
} from "./racecon-capture-shared.mjs"
import {
  CAPTURE_SIZES,
  CAPTURE_STATES,
  RC06_CAPTURE_MATRIX,
  RC06_DANGER_HEX,
  RC06_SPEC,
  validateCaptureMetrics,
  validateCapturePixels
} from "./racecon-rc06-capture-lib.mjs"

/** Minimum danger-red pixels required on the save-more frame to pass the hue-present assertion. */
const RC06_MIN_ALERT_PIXELS = 30

function temporaryDirectory() {
  return mkdtempSync(join(tmpdir(), "racecon-rc06-capture-test-"))
}

/** RC-06 canvas background colour from the widget CSS. */
const CANVAS_RGB = [11, 13, 10]
/** Normal green token (#7BC24B). Hue ≈ 96° → "green". Not red. */
const GREEN_RGB = [123, 194, 75]
/** Caution amber token (#E8C233). Hue ≈ 47° → "amber". NOT red, even though g < r. */
const AMBER_RGB = [232, 194, 51]
/** Danger red token (#E5533A). Hue ≈ 9° → "red". */
const DANGER_RGB = [229, 83, 58]
/** Info cyan token (#57B8C6). Hue ≈ 188° → "cyan". */
const CYAN_RGB = [87, 184, 198]

function rect(left, top, width, height) {
  return { left, top, width, height }
}

function measured(box) {
  return { ...box, layoutWidth: box.width, layoutHeight: box.height, scrollWidth: box.width, scrollHeight: box.height }
}

function zone(name, box, display = "block") {
  return { name, selector: `[data-testid="rc06-${name}"]`, present: true, display, ...measured(box) }
}

/**
 * Packet 11.1 zone percentages scaled to 800×480 (native canvas).
 * peripheral: 2%,0.8%,96%,6.5% | target: 2%,8.3%,30%,62.5%
 * balance: 33.5%,12.5%,33%,37.5% | delta: 33.5%,52.1%,33%,18.8%
 * actual: 68%,8.3%,30%,62.5% | lift: 2%,73.3%,96%,12.5%
 */
function nativeZones() {
  const w = 800, h = 480
  return [
    zone("peripheral", rect(16,   3.84,   768, 31.2)),
    zone("target",     rect(16,  39.84,   240, 300)),
    zone("balance",    rect(268, 60,      264, 180)),
    zone("delta",      rect(268, 250.08,  264, 90.24)),
    zone("actual",     rect(544, 39.84,   240, 300)),
    zone("lift",       rect(16,  351.84,  768, 60))
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
    color: "rgb(241, 245, 234)",
    display: "block"
  }
}

function owned(label, owner, valueBox) {
  return {
    label,
    owner: measured(owner),
    ownerDisplay: "block",
    value: measured(valueBox),
    valueDisplay: "block"
  }
}

function counted(label, selector, count) {
  return { label, selector, count }
}

/**
 * A complete, self-consistent RC-06 metric fixture at the native canvas (800×480). Every
 * geometric value mirrors the packet 11.1 grammar the stylesheet encodes, so a single-field
 * mutation is the only reason a validation can fail.
 */
function nativeMetrics(state = "silent") {
  const size = CAPTURE_SIZES[0] // 800×480
  const zones = nativeZones()
  const peripheralZone = zones[0]
  const targetZone     = zones[1]
  const balanceZone    = zones[2]
  const actualZone     = zones[4]
  const liftZone       = zones[5]

  // Value boxes — sized to produce the correct type-scale ordering:
  // balance(75) > laps-remaining(38) > actual-burn(29) > lift-cue(23) > column-title(15)
  const balanceBox       = rect(280, 80, 200, 90)
  const lapsRemBox       = rect(560, 80, 160, 50)
  const actualBurnBox    = rect(560, 150, 160, 38)
  const liftCueBox       = rect(20, 362, 200, 30)
  const liftPointBox     = rect(600, 362, 150, 30)
  const targetBurnBox    = rect(20, 80, 200, 38)
  const planLapsBox      = rect(20, 130, 200, 38)
  const pitLapBox        = rect(20, 180, 200, 38)
  const gearBox          = rect(20, 360, 60, 40)
  const speedBox         = rect(400, 6, 120, 30)
  const waterTempBox     = rect(560, 6, 100, 30)
  const positionBox      = rect(20, 6, 80, 30)
  const deltaBox         = rect(280, 258, 200, 30)
  const bestLapBox       = rect(280, 298, 200, 30)
  const fuelLevelBox     = rect(560, 220, 160, 38)
  const colTitleBox      = rect(20, 42, 150, 20)

  const saving = state === "save-more"

  return {
    viewport: { width: size.width, height: size.height, dpr: 1 },
    page: { scrollWidth: size.width, clientWidth: size.width },
    root: rect(0, 0, size.width, size.height),
    shell: measured(rect(0, 0, size.width, size.height)),
    canvas: { ...measured(rect(0, 0, size.width, size.height)), transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
    dashboardElement: measured(rect(0, 0, size.width, size.height)),
    widget: measured(rect(0, 0, size.width, size.height)),
    dashboard: measured(rect(0, 0, size.width, size.height)),
    presetId: RC06_SPEC.presetId,
    expectedWidgetId: RC06_SPEC.widgetId,
    renderedWidgetId: RC06_SPEC.widgetId,
    dashboardWidth: "1024",
    dashboardHeight: "600",
    sourceKind: "live-telemetry",
    sourceIdentity: RC06_SPEC.sourceIdentity,
    captureState: state,
    captureSequence: "80",
    layout: "native",
    compactMode: null,
    bufferState: "accepted",
    contentWidth: String(size.width),
    contentHeight: String(size.height),
    stateAttributes: {
      "lift-mode":     "liters",
      "plan":          "loaded",
      "fuel-model":    "valid",
      "balance-tone":  saving ? "danger" : "normal",
      "alerts":        saving ? "active" : "silent",
      "alert-keys":    saving ? "SAVE MORE" : "",
      "ledger":        "measured"
    },
    zones,
    values: [
      value("balance",       '[data-testid="rc06-balance-value"]',        saving ? "-1.9" : "+0.5", balanceBox, 75),
      value("laps remaining",'[data-rc06-row="laps-remaining"] output',   saving ? "12.1" : "14.5", lapsRemBox, 38),
      value("actual burn",   '[data-rc06-row="actual-burn"] output',       saving ? "3.10" : "2.65", actualBurnBox, 29),
      value("lift cue",      '[data-testid="rc06-lift-value"]',            saving ? "-0.35" : "+0.10", liftCueBox, 23),
      value("lift point",    '[data-rc06-row="lift-point"] output',        "--", liftPointBox, 15),
      value("target burn",   '[data-rc06-row="target-burn"] output',       "2.75", targetBurnBox, 15),
      value("plan laps",     '[data-rc06-row="plan-laps"] output',         "14", planLapsBox, 15),
      value("pit lap",       '[data-rc06-row="pit-lap"] output',           "41", pitLapBox, 15),
      value("gear",          '[data-rc06-row="gear"] output',              "4",  gearBox, 29),
      value("speed",         '[data-rc06-row="speed"] output',             "214", speedBox, 15),
      value("water temp",    '[data-rc06-row="water"] output',             "88",  waterTempBox, 15),
      value("position",      '[data-rc06-row="position"] output',          "4",   positionBox, 15),
      value("delta time",    '[data-rc06-row="delta"] output',             "+0.42", deltaBox, 15),
      value("best lap",      '[data-rc06-row="best"] output',              "01:52.418", bestLapBox, 15),
      value("fuel level",    '[data-rc06-row="fuel-level"] output',        saving ? "37.5" : "38.4", fuelLevelBox, 15),
      value("column title",  '[data-testid="rc06-column-title"]',          "TARGET", colTitleBox, 15)
    ],
    containment: [
      owned("balance value",  balanceZone, balanceBox),
      owned("lift value",     liftZone,    liftCueBox),
      owned("target burn",    targetZone,  targetBurnBox),
      owned("actual burn",    actualZone,  actualBurnBox),
      owned("laps remaining", actualZone,  lapsRemBox),
      owned("fuel level",     actualZone,  fuelLevelBox)
    ],
    forbidden: RC06_SPEC.forbidden.map(([label, selector]) => ({ label, selector, count: 0 })),
    counted: [
      counted("column title",    '[data-testid="rc06-column-title"]',    2),
      counted("column rule",     '[data-testid="rc06-column-rule"]',     2),
      counted("ledger row",      '[data-testid="rc06-row"]',             14),
      counted("trend section",   '[data-testid="rc06-trend"]',           0), // native layout
      counted("trend point",     '[data-testid="rc06-trend-point"]',     0), // native layout
      counted("save more",       '[data-testid="rc06-save-more"]',       saving ? 1 : 0),
      counted("push ok",         '[data-testid="rc06-push-ok"]',         0),
      counted("fuel model note", '[data-testid="rc06-fuel-model-note"]', 0)
    ],
    textOutputs: saving
      ? ["-1.9", "12.1", "3.10", "-0.35", "--", "2.75", "14", "41", "4", "214", "88", "4", "+0.42", "01:52.418", "37.5"]
      : ["+0.5", "14.5", "2.65", "+0.10", "--", "2.75", "14", "41", "4", "214", "88", "4", "+0.42", "01:52.418", "38.4"],
    leafTexts: ["TARGET", "ACTUAL", "BALANCE", "LIFT", "2.75", "41", "214", "88", "+0.42", "01:52.418"],
    overflowLeaves: [],
    rootText:
      "TARGET" + (saving ? "" : "ACTUAL") + "2.7514412.65" + (saving ? "37.5" : "38.4") + "ACTUAL" +
      "BALANCE" + (saving ? "-1.9" : "+0.5") +
      "DELTA+0.42BEST01:52.418LIFTGEAR4SPEED214WATER88POSITION4",
    errorBoundaryCount: 0,
    unknownWidgetCount: 0,
    failures: [],
    pageErrors: [],
    consoleErrors: [],
    nativeSize: "800x480",
    balanceSign:     saving ? "deficit" : "surplus",
    balanceArrow:    saving ? "down" : "up",
    balanceToneAttr: saving ? "danger" : "normal",
    alertScope: measured(rect(268, 60, 264, 180)), // balanceZone rect
    trendZone: { present: false, display: "none", rect: null } // absent at native layout
  }
}

function nativeEntry(state = "silent") {
  return RC06_CAPTURE_MATRIX.find((entry) => entry.state === state && entry.size.width === 800)
}

function assertRejects(mutate, expected, state = "silent") {
  const metrics = nativeMetrics(state)
  mutate(metrics)
  assert.throws(
    () => validateCaptureMetrics(metrics, nativeEntry(state)),
    (error) => {
      assert.ok(error instanceof CaptureSafetyError, `expected a CaptureSafetyError, received ${error}`)
      assert.match(error.message, expected)
      return true
    }
  )
}

function withSize(metrics, entry) {
  const scaled = { ...metrics }
  scaled.viewport = { width: entry.size.width, height: entry.size.height, dpr: 1 }
  scaled.page = { scrollWidth: entry.size.width, clientWidth: entry.size.width }
  scaled.root = rect(0, 0, entry.size.width, entry.size.height)
  scaled.shell = measured(scaled.root)
  scaled.canvas = { ...measured(scaled.root), transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } }
  scaled.dashboardElement = measured(scaled.root)
  scaled.widget = measured(scaled.root)
  scaled.dashboard = measured(scaled.root)
  scaled.layout = entry.size.layout
  scaled.compactMode = entry.size.compactMode
  scaled.contentWidth = String(entry.size.width)
  scaled.contentHeight = String(entry.size.height)
  scaled.nativeSize = entry.size.layout === "native" ? "800x480" : null
  // Rescale zones proportionally (simplified for test)
  const sx = entry.size.width / 800, sy = entry.size.height / 480
  scaled.zones = nativeZones().map((z) => ({
    ...z,
    left: z.left * sx, top: z.top * sy, width: z.width * sx, height: z.height * sy,
    layoutWidth: z.layoutWidth * sx, layoutHeight: z.layoutHeight * sy,
    scrollWidth: z.scrollWidth * sx, scrollHeight: z.scrollHeight * sy
  }))
  scaled.containment = []
  scaled.alertScope = measured(rect(scaled.zones[2].left, scaled.zones[2].top, scaled.zones[2].width, scaled.zones[2].height))
  // Rescale values proportionally
  scaled.values = metrics.values.map((v) => ({
    ...v,
    rect: measured(rect(0, 0, 40, 40)),
    textRect: rect(0, 0, 40, 40)
  }))
  // Trend section for app layout
  if (entry.size.layout === "app") {
    scaled.trendZone = { present: true, display: "block", rect: rect(0, 340, 200, 100) }
    scaled.counted = metrics.counted.map((c) => {
      if (c.label === "trend section") return { ...c, count: 1 }
      if (c.label === "trend point") return { ...c, count: 2 }
      return c
    })
  } else {
    scaled.trendZone = { present: false, display: "none", rect: null }
  }
  return scaled
}

// ── Tests ──────────────────────────────────────────────────────────────────────────────────

test("the governed matrix covers every viewport in every governed state", () => {
  assert.equal(CAPTURE_SIZES.length, 6)
  assert.deepEqual([...CAPTURE_STATES], ["silent", "save-more"])
  assert.equal(RC06_CAPTURE_MATRIX.length, CAPTURE_SIZES.length * CAPTURE_STATES.length)
  for (const entry of RC06_CAPTURE_MATRIX) {
    assert.equal(entry.size.layout, expectedLayoutForBox(entry.size.width, entry.size.height))
    assert.equal(entry.size.compactMode, expectedCompactModeForBox(entry.size.width, entry.size.height))
  }
  const savingEntries = RC06_CAPTURE_MATRIX.filter((entry) => entry.state === "save-more")
  assert.equal(savingEntries.length, 6)
  for (const entry of savingEntries) {
    assert.deepEqual(entry.required[0], ["balance-tone", "danger"])
    assert.deepEqual(entry.required[1], ["alerts", "active"])
  }
  const silentEntries = RC06_CAPTURE_MATRIX.filter((entry) => entry.state === "silent")
  assert.equal(silentEntries.length, 6)
  for (const entry of silentEntries) {
    assert.deepEqual(entry.required[0], ["alerts", "silent"])
  }
})

test("hue families separate the amber resting palette from the danger token", () => {
  // The key defect this guards against: a naive "warm colour" test (e.g. b < 0.3r) would
  // classify caution amber (#E8C233, rgb 232,194,51) as red because its blue channel is
  // far below its red channel. Hue-angle classification does not.
  assert.equal(hueFamilyOfHex("#E8C233"), "amber")
  assert.equal(hueFamilyOfHex(RC06_DANGER_HEX), "red")
  // Verify a naive blue-to-red ratio test misclassifies amber (b/r ≈ 0.22 < 0.3):
  assert.ok(AMBER_RGB[2] / AMBER_RGB[0] < 0.3, "amber b/r is below 0.30 — a ratio test would call it red")
  assert.equal(hueFamily(...AMBER_RGB), "amber")
  // Danger red is correctly classified:
  assert.equal(hueFamily(...DANGER_RGB), "red")
  // Normal green and cyan are not confused with red:
  assert.equal(hueFamily(...GREEN_RGB), "green")
  assert.equal(hueFamily(...CYAN_RGB), "cyan")
  assert.equal(hueFamily(11, 13, 10), "neutral")
})

test("a faithful native silent fixture validates and reports its type scale", () => {
  const audit = validateCaptureMetrics(nativeMetrics("silent"), nativeEntry("silent"))
  assert.deepEqual(audit.knownDefects, [])
  assert.deepEqual(audit.typeScale, [
    { label: "balance", fontSize: 75 },
    { label: "laps remaining", fontSize: 38 },
    { label: "actual burn", fontSize: 29 },
    { label: "lift cue", fontSize: 23 },
    { label: "column title", fontSize: 15 }
  ])
})

test("a faithful native save-more fixture validates with its alert surfaces present", () => {
  const audit = validateCaptureMetrics(nativeMetrics("save-more"), nativeEntry("save-more"))
  assert.deepEqual(audit.knownDefects, [])
  assert.ok(Array.isArray(audit.typeScale))
})

test("a tie anywhere in the type scale is a failure, not a pass", () => {
  // laps-remaining matches balance
  assertRejects((m) => { m.values[1].fontSize = 75 }, /type-scale hierarchy does not hold/)
  // actual-burn matches laps-remaining
  assertRejects((m) => { m.values[2].fontSize = 38 }, /type-scale hierarchy does not hold/)
  // lift-cue matches actual-burn
  assertRejects((m) => { m.values[3].fontSize = 29 }, /type-scale hierarchy does not hold/)
  // balance matches laps-remaining
  assertRejects((m) => { m.values[0].fontSize = 38 }, /type-scale hierarchy does not hold/)
})

test("overlapping zones fail closed while the balance/delta app exemption does not", () => {
  // Two non-exempt zones overlapping must fail.
  assertRejects((m) => { m.zones[1].top = m.zones[0].top }, /zone peripheral overlaps target/)
  // balance/delta overlap is exempt (app layout fold). To test we simulate the app layout
  // where delta rect is inside the balance rect.
  const appEntry = RC06_CAPTURE_MATRIX.find((e) => e.state === "silent" && e.size.width === 1024)
  const appMetrics = withSize(nativeMetrics("silent"), appEntry)
  // Force delta inside balance (app fold) — balance.top must stay below peripheral.bottom
  // (at 1024×600 scale, peripheral.bottom ≈ 4.8 + 39 = 43.8). Using 55 keeps the zones
  // clear of peripheral while still putting delta inside balance.
  appMetrics.zones[2].top = 55    // balance top (above peripheral.bottom ≈ 43.8)
  appMetrics.zones[3].top = 70    // delta top inside balance
  appMetrics.zones[3].height = 80 // delta height stays inside balance.bottom (55+225=280)
  validateCaptureMetrics(appMetrics, appEntry)
})

test("an element that escapes its zone or the frame fails closed", () => {
  // Value escaping its zone on the right edge.
  assertRejects(
    (m) => { m.containment[0].value = measured(rect(268, 80, 900, 40)) },
    /balance value escapes its zone/
  )
  // Zone partially out of frame (lift zone pushed below frame bottom).
  assertRejects(
    (m) => { m.zones[5].top = 480 },
    /lift is out of frame/
  )
  // A value rect not contained in the capture root.
  assertRejects(
    (m) => { m.values[0].rect = measured(rect(780, 80, 200, 90)) },
    /balance value is not contained/
  )
})

test("an unrecorded overflow fails and the ledger mechanism works with a synthetic defect", async () => {
  // An overflow with no matching known defect fails immediately.
  assertRejects(
    (m) => {
      m.overflowLeaves = [
        {
          key: "rc06-balance-value",
          text: "+0.5",
          fontSize: 75,
          whiteSpace: "nowrap",
          clientWidth: 120,
          scrollWidth: 145,
          overflowX: 25,
          textLeft: 280,
          textRight: 425
        }
      ]
    },
    /paints 25px wider than its 120px box/
  )

  // A known-defect overflow under budget is reported but does not fail.
  // We inject a synthetic defect directly into the spec to test the ledger path.
  const specWithDefect = {
    ...RC06_SPEC,
    knownDefects: [
      Object.freeze({
        key: "rc06-balance-value",
        states: Object.freeze(["silent"]),
        sizes: Object.freeze(["800x480"]),
        budgetPx: 30,
        note: "synthetic test defect"
      })
    ]
  }
  const metricsWithOverflow = nativeMetrics("silent")
  metricsWithOverflow.overflowLeaves = [
    {
      key: "rc06-balance-value",
      text: "+0.5",
      fontSize: 75,
      whiteSpace: "nowrap",
      clientWidth: 120,
      scrollWidth: 145,
      overflowX: 25,
      textLeft: 280,
      textRight: 425
    }
  ]
  const audit = validateCommonMetrics(metricsWithOverflow, nativeEntry("silent"), specWithDefect)
  assert.equal(audit.knownDefects.length, 1)
  assert.equal(audit.knownDefects[0].overflowX, 25)

  // A defect that grows past the recorded budget fails.
  metricsWithOverflow.overflowLeaves[0].overflowX = 40
  assert.throws(
    () => validateCommonMetrics(metricsWithOverflow, nativeEntry("silent"), specWithDefect),
    /past the 30px recorded/
  )
})

test("a reintroduced packet omission fails closed", () => {
  // Omission 1: rev-LED or shift-light element reappears.
  assertRejects(
    (m) => { m.forbidden[0].count = 1 },
    /rev-LED or shift-light element must not be rendered/
  )
  // Omission 1: shift-marker element reappears.
  assertRejects(
    (m) => { m.forbidden[1].count = 1 },
    /shift-marker or rev-cue element must not be rendered/
  )
  // Omission 1: SHIFT text appears as a readout leaf.
  assertRejects(
    (m) => { m.leafTexts.push("SHIFT") },
    /renders "SHIFT" as a readout/
  )
  // Omission 1: RPM text appears as a readout leaf.
  assertRejects(
    (m) => { m.leafTexts.push("RPM") },
    /renders "RPM" as a readout/
  )
  // Omission 2: LIFT PT loses its always-"--" placeholder.
  assertRejects(
    (m) => { m.values[4].text = "3.14" },
    /LIFT PT must always read "--"/
  )
})

test("wrong modifier and wrong buffer state fail closed", () => {
  assertRejects((m) => { m.layout = "app" }, /layout modifier app does not match/)
  assertRejects((m) => { m.contentWidth = "801" }, /did not report its measured content box/)
  assertRejects((m) => { m.nativeSize = null }, /native content-box modifier/)
  assertRejects((m) => { m.bufferState = "duplicate" }, /accepted live frame/)
  assertRejects(
    (m) => { m.sourceIdentity = "acc:session:1:connection:1" },
    /live telemetry source identity/
  )
  assertRejects((m) => { m.captureState = "save-more" }, /rendered the save-more scenario/)
})

test("wrong alert attributes fail closed in both scenarios", () => {
  // Silent scenario: alerts must be silent.
  assertRejects((m) => { m.stateAttributes["alerts"] = "active" }, /must be silent/)
  // Silent scenario: plan must be loaded.
  assertRejects((m) => { m.stateAttributes["plan"] = "none" }, /engineer plan must be loaded/)
  // Silent scenario: ledger must be measured.
  assertRejects((m) => { m.stateAttributes["ledger"] = "pending" }, /ledger must be measured/)
  // Silent scenario: fuel model must be valid.
  assertRejects((m) => { m.stateAttributes["fuel-model"] = "invalid" }, /fuel model reports invalid/)
  // Silent scenario: SAVE MORE must not be rendered.
  assertRejects((m) => { m.counted[5].count = 1 }, /SAVE MORE element must not be rendered/)
  // Save-more scenario: alerts must be active.
  assertRejects((m) => { m.stateAttributes["alerts"] = "silent" }, /must be active/, "save-more")
  // Save-more scenario: balance-tone must be danger.
  assertRejects((m) => { m.stateAttributes["balance-tone"] = "caution" }, /must be danger/, "save-more")
  // Save-more scenario: SAVE MORE must be rendered.
  assertRejects((m) => { m.counted[5].count = 0 }, /SAVE MORE element must be rendered exactly once/, "save-more")
})

// ── PNG / pixel-audit tests ────────────────────────────────────────────────────────────────

function paint(size, background) {
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

function fill(image, box, rgb) {
  for (let y = Math.round(box.top); y < Math.round(box.top + box.height); y += 1) {
    for (let x = Math.round(box.left); x < Math.round(box.left + box.width); x += 1) {
      const offset = (y * image.width + x) * 4
      image.data[offset] = rgb[0]
      image.data[offset + 1] = rgb[1]
      image.data[offset + 2] = rgb[2]
      image.data[offset + 3] = 255
    }
  }
}

/**
 * Synthesises a PNG for the pixel audit. The silent frame has green and neutral pixels only.
 * The save-more frame adds danger red inside the balance zone.
 */
function capturePng(state, { strayDanger = false, blank = false } = {}) {
  const size = CAPTURE_SIZES[0]
  const image = paint(size, CANVAS_RGB)
  if (!blank) {
    // Balance zone (green for surplus balance, or primary text for save-more)
    fill(image, rect(268, 60, 264, 180), GREEN_RGB)
    // Some neutral value text
    fill(image, rect(20, 80, 200, 38), [241, 245, 234])
  }
  if (state === "save-more") {
    // Danger red inside balance zone (balance numeral + arrow + SAVE MORE text)
    const scope = nativeMetrics("save-more").alertScope
    fill(image, rect(scope.left + 4, scope.top + 4, 120, 50), DANGER_RGB)
    if (strayDanger) {
      // A stray red pixel outside the scope — this must fail the hue-scope assertion.
      fill(image, rect(20, 6, 10, 10), DANGER_RGB)
    }
  }
  return PNG.sync.write(image)
}

test("the silent frame carries green pixels and zero red ones", () => {
  const audit = validateCapturePixels(capturePng("silent"), nativeEntry("silent"), nativeMetrics("silent"))
  assert.equal(audit.hueFamilies.red, 0)
  assert.ok(audit.hueFamilies.green > 1_000)
  assert.equal(audit.alertHueOutsideScope, 0)
})

test("the save-more frame must paint the danger hue only inside the balance zone", () => {
  const metrics = nativeMetrics("save-more")
  const entry = nativeEntry("save-more")
  const audit = validateCapturePixels(capturePng("save-more"), entry, metrics)
  assert.ok(audit.hueFamilies.red >= RC06_MIN_ALERT_PIXELS)
  assert.equal(audit.alertHueOutsideScope, 0)
  // A stray danger pixel outside the scope must fail.
  assert.throws(
    () => validateCapturePixels(capturePng("save-more", { strayDanger: true }), entry, metrics),
    /fall outside the elements that own that alert/
  )
})

test("a danger pixel on the silent frame fails closed", () => {
  const image = paint(CAPTURE_SIZES[0], CANVAS_RGB)
  fill(image, rect(268, 60, 264, 180), GREEN_RGB)
  fill(image, rect(400, 300, 8, 8), DANGER_RGB)
  assert.throws(
    () => validateCapturePixels(PNG.sync.write(image), nativeEntry("silent"), nativeMetrics("silent")),
    /red hue family must be absent/
  )
})

test("the save-more frame fails when the danger hue is missing entirely", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent"), nativeEntry("save-more"), nativeMetrics("save-more")),
    /red hue family must be painted/
  )
})

test("a blank frame fails closed", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { blank: true }), nativeEntry("silent"), nativeMetrics("silent")),
    /capture is blank/
  )
})

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
