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
import { expectedCompactModeForBox, expectedLayoutForBox, hueFamily, hueFamilyOfHex } from "./racecon-capture-shared.mjs"
import {
  CAPTURE_SIZES,
  CAPTURE_STATES,
  RC04_CAPTURE_MATRIX,
  RC04_CREW_CORNER_COUNT,
  RC04_DANGER_HEX,
  RC04_EXPECTED_BAR_FILL_OVERSPEED,
  RC04_EXPECTED_BAR_FILL_SILENT,
  RC04_SPEC,
  RC04_STEP_COUNT,
  validateCaptureMetrics,
  validateCapturePixels
} from "./racecon-rc04-capture-lib.mjs"

function temporaryDirectory() {
  return mkdtempSync(join(tmpdir(), "racecon-rc04-capture-test-"))
}

// Synthetic pixel colours used by the PNG helpers below.
const CANVAS_RGB = [10, 13, 16]    // #0a0d10 background (neutral → always neutral family)
const GREEN_RGB  = [52, 208, 110]  // #34d06e normal bar fill (green family)
const AMBER_RGB  = [255, 122, 24]  // #ff7a18 signature pit-orange ribbon (amber family)
const CYAN_RGB   = [55, 192, 255]  // #37c0ff limiter-ON value (cyan family)
const DANGER_RGB = [255, 59, 48]   // #ff3b30 danger red (red family)

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
 * Mirrors the packet 11.1 native grammar at 800×480. Zone rectangles are derived from the CSS
 * percentage coordinates documented in the governance evidence; adjacent zones share an edge but
 * never overlap (gap ≈ 12–18 px between each pair).
 *
 *  .rc04-ribbon  left:2%,   top:2.5%,   width:96%,  height:18.75%
 *  .rc04-speed   left:2%,   top:25%,    width:65%,  height:45.833%
 *  .rc04-limiter left:69%,  top:25%,    width:29%,  height:20.833%
 *  .rc04-service left:69%,  top:48.333%, width:29%, height:22.5%
 *  .rc04-action  left:2%,   top:74.167%, width:96%, height:22.917%
 *  .rc04-crew    [display:none in native]
 */
function nativeZones(size) {
  const px = (fraction, extent) => Math.round(fraction * extent)
  return [
    zone("ribbon",  rect(px(0.02, size.width), px(0.025, size.height),   px(0.96, size.width), px(0.1875,  size.height))),
    zone("speed",   rect(px(0.02, size.width), px(0.25,  size.height),   px(0.65, size.width), px(0.45833, size.height))),
    zone("limiter", rect(px(0.69, size.width), px(0.25,  size.height),   px(0.29, size.width), px(0.20833, size.height))),
    zone("service", rect(px(0.69, size.width), px(0.4833, size.height),  px(0.29, size.width), px(0.225,   size.height))),
    zone("action",  rect(px(0.02, size.width), px(0.74167, size.height), px(0.96, size.width), px(0.22917, size.height))),
    zone("crew",    rect(0, 0, 0, 0), "none")
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
    color: "rgb(255,255,255)",
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
 * A complete, self-consistent RC-04 metric fixture at the native 800×480 canvas in the silent
 * (no-alert) limiter-phase scenario. Every geometric value mirrors the packet 11.1 grammar, so
 * a mutation of exactly one field is the only reason any assertion can fail.
 */
function nativeMetrics(state = "silent") {
  const size = CAPTURE_SIZES[0]
  const zones = nativeZones(size)
  const ribbonZone  = zones[0]
  const speedZone   = zones[1]
  const limiterZone = zones[2]
  const serviceZone = zones[3]
  const actionZone  = zones[4]

  // Element boxes well within their respective zones.
  const speedHeroBox    = rect(speedZone.left   + 4, speedZone.top   + 10, 120, 80)
  const actionTextBox   = rect(actionZone.left  + 4, actionZone.top  + 10, 200, 40)
  const limiterBadgeBox = rect(limiterZone.left + 4, limiterZone.top + 10, 60,  28)
  const gearBox         = rect(speedZone.left   + 4, speedZone.top   + 100, 50, 20)
  const fuelBox         = rect(serviceZone.left + 4, serviceZone.top + 10, 40,  18)
  const stintBox        = rect(serviceZone.left + 4, serviceZone.top + 35, 50,  18)
  const gridBox         = rect(serviceZone.left + 4, serviceZone.top + 60, 20,  18)
  const limitBox        = rect(speedZone.left   + 4, speedZone.top   + 130, 30, 18)
  const barFillBox      = rect(speedZone.left   + 4, speedZone.top   + 160, 80, 12)

  const overspeed = state === "overspeed"
  return {
    viewport: { width: size.width, height: size.height, dpr: 1 },
    page: { scrollWidth: size.width, clientWidth: size.width },
    root: rect(0, 0, size.width, size.height),
    shell: measured(rect(0, 0, size.width, size.height)),
    canvas: { ...measured(rect(0, 0, size.width, size.height)), transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
    dashboardElement: measured(rect(0, 0, size.width, size.height)),
    widget: measured(rect(0, 0, size.width, size.height)),
    dashboard: measured(rect(0, 0, size.width, size.height)),
    presetId: RC04_SPEC.presetId,
    expectedWidgetId: RC04_SPEC.widgetId,
    renderedWidgetId: RC04_SPEC.widgetId,
    dashboardWidth: "1024",
    dashboardHeight: "600",
    sourceKind: "live-telemetry",
    sourceIdentity: RC04_SPEC.sourceIdentity,
    captureState: state,
    captureSequence: "55",
    layout: "native",
    compactMode: null,
    bufferState: "accepted",
    contentWidth: String(size.width),
    contentHeight: String(size.height),
    stateAttributes: {
      phase: "limiter",
      "phase-feed": "live",
      overspeed: overspeed ? "true" : "false",
      "limiter-mismatch": "false",
      "unsafe-release": "false",
      "shift-leds": "suppressed"
    },
    zones,
    values: [
      value("speed hero",    '[data-testid="rc04-speed-zone"] output.rc04-speed-value', overspeed ? "72" : "52", speedHeroBox, 96),
      value("action line",   '[data-testid="rc04-action-text"]', overspeed ? "LIFT - PIT LIMIT" : "HOLD LIMITER", actionTextBox, 48),
      value("limiter badge", '[data-testid="rc04-limiter-badge"] output.rc04-value', "ON", limiterBadgeBox, 36),
      value("gear",          '[data-rc04-zone="gear"] output.rc04-value', "2", gearBox, 14),
      value("fuel",          '[data-rc04-zone="fuel"] output.rc04-value', "68", fuelBox, 14),
      value("stint",         '[data-rc04-zone="stint"] output.rc04-value', "00:02", stintBox, 14),
      value("grid",          '[data-rc04-zone="grid"] output.rc04-value', "--", gridBox, 14),
      value("limit",         '[data-rc04-zone="limit"] output.rc04-value', "60", limitBox, 14)
    ],
    containment: [
      owned("speed hero",         speedZone,   speedHeroBox),
      owned("action text",        actionZone,  actionTextBox),
      owned("limiter badge value",limiterZone, limiterBadgeBox),
      owned("bar fill",           speedZone,   barFillBox),
      owned("gear value",         speedZone,   gearBox),
      owned("fuel value",         serviceZone, fuelBox),
      owned("stint value",        serviceZone, stintBox),
      owned("grid value",         serviceZone, gridBox)
    ],
    forbidden: RC04_SPEC.forbidden.map(([label, selector]) => ({ label, selector, count: 0 })),
    counted: [
      counted("step",        '[data-testid="rc04-step"]',         RC04_STEP_COUNT),
      counted("crew corner", '[data-testid="rc04-crew-corner"]',  RC04_CREW_CORNER_COUNT),
      counted("alarm line",  '[data-testid="rc04-alarm-line"]',   overspeed ? 1 : 0),
      counted("hold block",  '[data-testid="rc04-hold-block"]',   0),
      counted("lane readout",'[data-testid="rc04-lane"]',         0)
    ],
    textOutputs: overspeed
      ? ["72", "60", "2", "68", "00:02", "--", "ON", "LIFT - PIT LIMIT"]
      : ["52", "60", "2", "68", "00:02", "--", "ON", "HOLD LIMITER"],
    leafTexts: overspeed
      ? ["APPROACH", "LIMITER", "BOX", "SERVICE", "RELEASE", "KM/H", "LIMIT", "60", "GEAR", "2",
         "FUEL", "68", "STINT", "00:02", "GRID", "--", "LIMITER", "ON", "CONFIRM RELEASE",
         "LIFT - PIT LIMIT", "PIT OVERSPEED", "RESET"]
      : ["APPROACH", "LIMITER", "BOX", "SERVICE", "RELEASE", "KM/H", "LIMIT", "60", "GEAR", "2",
         "FUEL", "68", "STINT", "00:02", "GRID", "--", "LIMITER", "ON", "CONFIRM RELEASE",
         "HOLD LIMITER"],
    overflowLeaves: [],
    rootText: overspeed
      ? "APPROACHLIMITERBOXSERVICERELEASE72KM/HLIMIT60GEAR2FUEL68STINT00:02GRID--LIMITERON" +
        "LIFT - PIT LIMITPIT OVERSPEEDRESET CONFIRM RELEASE"
      : "APPROACHLIMITERBOXSERVICERELEASE52KM/HLIMIT60GEAR2FUEL68STINT00:02GRID--LIMITERON" +
        "HOLD LIMITERCONFIRM RELEASE",
    errorBoundaryCount: 0,
    unknownWidgetCount: 0,
    failures: [],
    pageErrors: [],
    consoleErrors: [],
    // RC-04-specific metrics collected by collectMetrics:
    nativeSize: "800x480",
    barFillStyle: overspeed ? RC04_EXPECTED_BAR_FILL_OVERSPEED : RC04_EXPECTED_BAR_FILL_SILENT,
    activeStepFontSize: 28,   // active step is smaller than limiter badge; hierarchy holds
    serviceAppDisplay: "none",
    alarmLineText: overspeed ? "PIT OVERSPEED" : null,
    alarmLineRect: overspeed ? rect(actionZone.left + 4, actionZone.top + 60, 120, 16) : null,
    crewCorners: Array.from({ length: RC04_CREW_CORNER_COUNT }, (_, index) => ({
      rect: measured(rect(4 + index * 10, 4, 8, 8)),
      text: "--"
    })),
    alertScope: {
      speed: speedZone,
      action: actionZone
    }
  }
}

function nativeEntry(state = "silent") {
  return RC04_CAPTURE_MATRIX.find((entry) => entry.state === state && entry.size.width === 800)
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

// ── Matrix and breakpoint contract ────────────────────────────────────────────────────────

test("the governed matrix covers every viewport in every governed state", () => {
  assert.equal(CAPTURE_SIZES.length, 6)
  assert.deepEqual([...CAPTURE_STATES], ["silent", "overspeed"])
  assert.equal(RC04_CAPTURE_MATRIX.length, CAPTURE_SIZES.length * CAPTURE_STATES.length)
  for (const entry of RC04_CAPTURE_MATRIX) {
    assert.equal(entry.size.layout, expectedLayoutForBox(entry.size.width, entry.size.height))
    assert.equal(entry.size.compactMode, expectedCompactModeForBox(entry.size.width, entry.size.height))
  }
  const overspeedEntries = RC04_CAPTURE_MATRIX.filter((entry) => entry.state === "overspeed")
  assert.equal(overspeedEntries.length, 6)
  for (const entry of overspeedEntries) assert.deepEqual(entry.required[0], ["overspeed", "true"])
})

// ── Hue classification ────────────────────────────────────────────────────────────────────

test("hue families separate the RC-04 palette correctly", () => {
  // The danger token is unambiguously red by hue.
  assert.equal(hueFamilyOfHex(RC04_DANGER_HEX), "red")
  // The signature pit-orange is amber — not red — even though its green and blue channels both
  // sit well below its red channel (the classic false-positive from a channel-ratio test).
  assert.equal(hueFamilyOfHex("#ff7a18"), "amber")
  assert.ok(AMBER_RGB[1] < 0.62 * AMBER_RGB[0] && AMBER_RGB[2] < 0.62 * AMBER_RGB[0],
    "amber has low G,B relative to R — the channel-ratio test would misclassify it as red")
  assert.equal(hueFamily(...AMBER_RGB), "amber")
  // The normal bar fill is green, and the limiter-ON value is cyan.
  assert.equal(hueFamily(...GREEN_RGB),  "green")
  assert.equal(hueFamily(...CYAN_RGB),   "cyan")
  assert.equal(hueFamily(...DANGER_RGB), "red")
  assert.equal(hueFamily(...CANVAS_RGB), "neutral")
})

// ── Valid fixture validates ────────────────────────────────────────────────────────────────

test("a faithful native silent fixture validates and reports its type scale", () => {
  const audit = validateCaptureMetrics(nativeMetrics(), nativeEntry())
  assert.deepEqual(audit.knownDefects, [])
  assert.deepEqual(audit.typeScale, [
    { label: "speed hero",    fontSize: 96 },
    { label: "action line",   fontSize: 48 },
    { label: "limiter badge", fontSize: 36 },
    { label: "active step",   fontSize: 28 }
  ])
})

test("the overspeed fixture validates only with its alert surfaces present", () => {
  validateCaptureMetrics(nativeMetrics("overspeed"), nativeEntry("overspeed"))
  assertRejects((m) => { m.counted[2].count = 0 }, /alarm line must be present/, "overspeed")
  assertRejects((m) => { m.alarmLineText = "LIMITER OFF" }, /pit-overspeed alarm text/, "overspeed")
  assertRejects((m) => { m.stateAttributes.overspeed = "false" }, /overspeed modifier does not match/, "overspeed")
})

// ── Type-scale hierarchy ──────────────────────────────────────────────────────────────────

test("a tie anywhere in the type scale is a failure, not a pass", () => {
  // Tie between speed hero and action line.
  assertRejects((m) => { m.values[0].fontSize = m.values[1].fontSize }, /type-scale hierarchy does not hold/)
  // Tie between action line and limiter badge.
  assertRejects((m) => { m.values[1].fontSize = m.values[2].fontSize }, /type-scale hierarchy does not hold/)
  // Tie between limiter badge and active step.
  assertRejects((m) => { m.activeStepFontSize = m.values[2].fontSize }, /type-scale hierarchy does not hold/)
  // Reversed order (active step larger than limiter badge).
  assertRejects((m) => { m.activeStepFontSize = m.values[0].fontSize + 10 }, /type-scale hierarchy does not hold/)
})

// ── Zone overlap and containment ─────────────────────────────────────────────────────────

test("overlapping zones fail closed", () => {
  // Move the service zone down to the action zone's top → service overlaps action.
  assertRejects((m) => { m.zones[3].top = m.zones[4].top }, /zone service overlaps action/)
  // Move the speed zone up to the ribbon zone's top → ribbon overlaps speed.
  assertRejects((m) => { m.zones[1].top = m.zones[0].top }, /zone ribbon overlaps speed/)
})

test("an element that escapes its zone or the frame fails closed", () => {
  // Speed hero escapes the speed zone on the right.
  assertRejects((m) => {
    m.containment[0].value = rect(m.containment[0].owner.left, m.containment[0].owner.top, 800, 80)
  }, /speed hero escapes its zone/)
  // Action zone pushed below the frame.
  assertRejects((m) => { m.zones[4].top = 460 }, /action.*out of frame/)
  // Speed hero value not contained by root.
  assertRejects((m) => { m.values[0].rect = measured(rect(760, 60, 90, 96)) }, /speed hero value is not contained/)
})

// ── Overflow leaf accounting ──────────────────────────────────────────────────────────────

test("an unrecorded overflow fails and a recorded one within budget passes", () => {
  // Unknown key at the native size: no waiver → always fails.
  assertRejects(
    (m) => {
      m.overflowLeaves = [
        { key: "rc04-speed-value", text: "72", fontSize: 96, whiteSpace: "nowrap",
          clientWidth: 80, scrollWidth: 120, overflowX: 40, textLeft: 20, textRight: 140 }
      ]
    },
    /paints 40px wider than its 80px box/
  )
  // rc04-step-label at 800×480 has no waiver (waiver is scoped to 393×759) → fails at 800×480.
  assertRejects(
    (m) => {
      m.overflowLeaves = [
        { key: "rc04-step-label", text: "APPROACH", fontSize: 12, whiteSpace: "nowrap",
          clientWidth: 56, scrollWidth: 58, overflowX: 2, textLeft: 16, textRight: 74 }
      ]
    },
    /paints 2px wider than its 56px box/
  )
  // rc04-action-text at 800×480 in silent state has no waiver (waiver is overspeed only) → fails.
  assertRejects(
    (m) => {
      m.overflowLeaves = [
        { key: "rc04-action-text", text: "LIFT - PIT LIMIT", fontSize: 64, whiteSpace: "nowrap",
          clientWidth: 379, scrollWidth: 390, overflowX: 11, textLeft: 29, textRight: 419 }
      ]
    },
    /paints 11px wider than its 379px box/
  )
  // rc04-action-text at 800×480 in OVERSPEED exceeds budgetPx=11 → fails when over budget.
  assertRejects(
    (m) => {
      m.overflowLeaves = [
        { key: "rc04-action-text", text: "LIFT - PIT LIMIT", fontSize: 64, whiteSpace: "nowrap",
          clientWidth: 379, scrollWidth: 392, overflowX: 13, textLeft: 29, textRight: 421 }
      ]
    },
    /past the 11px recorded for the known defect/,
    "overspeed"
  )
})

// ── Modifier and buffer state ─────────────────────────────────────────────────────────────

test("a modifier that disagrees with the measured content box fails closed", () => {
  assertRejects((m) => { m.layout = "app" }, /layout modifier app does not match/)
  assertRejects((m) => { m.contentWidth = "801" }, /did not report its measured content box/)
  assertRejects((m) => { m.nativeSize = null }, /native content-box modifier/)
  assertRejects((m) => { m.bufferState = "duplicate" }, /accepted live frame/)
  assertRejects((m) => { m.sourceIdentity = "acc:session:1:connection:1" }, /live telemetry source identity/)
  assertRejects((m) => { m.captureState = "overspeed" }, /rendered the overspeed scenario/)
})

test("phase and modifier assertions fail closed", () => {
  assertRejects((m) => { m.stateAttributes.phase = "approach" }, /must rest in the limiter phase/)
  assertRejects((m) => { m.stateAttributes["phase-feed"] = "idle" }, /pit phase feed must be live/)
  assertRejects((m) => { m.stateAttributes["shift-leds"] = "restored" }, /shift LEDs must be suppressed/)
  assertRejects((m) => { m.stateAttributes["unsafe-release"] = "true" }, /unsafe-release alert must be inactive/)
  assertRejects((m) => { m.stateAttributes["limiter-mismatch"] = "true" }, /limiter-mismatch modifier must be false/)
})

test("crew visibility fails closed when the column is visible in non-app layout", () => {
  // In native layout the crew zone must be display:none.
  assertRejects((m) => { m.zones[5].display = "flex" }, /crew column is visible in the native layout/)
})

test("bar fill style fails closed on a wrong value", () => {
  assertRejects((m) => { m.barFillStyle = "62%" }, /bar fill style.*must be 65%.*silent/)
  assertRejects((m) => { m.barFillStyle = "90%" }, /bar fill style.*must be 65%.*silent/)
  assertRejects((m) => { m.barFillStyle = "65%" }, /bar fill style.*must be 90%.*overspeed/, "overspeed")
})

// ── Documented packet omissions ───────────────────────────────────────────────────────────

test("a reintroduced packet omission fails closed", () => {
  // Shift LED strip must never appear (packet 11.4 suppresses the whole layer).
  assertRejects((m) => { m.forbidden[0].count = 1 }, /shift-LED strip must not be rendered/)
  // Tyre-temperature surface forbidden by section 18.
  assertRejects((m) => { m.forbidden[1].count = 2 }, /tyre-temperature surface must not be rendered/)
  // SERVICE countdown appears only in service phase; fixture is in LIMITER.
  assertRejects((m) => { m.forbidden[4].count = 1 }, /SERVICE countdown row.*must not be rendered/)
  // LANE readout appears only in release phase; fixture is in LIMITER.
  assertRejects((m) => { m.forbidden[5].count = 1 }, /LANE proximity readout.*must not be rendered/)
  // Forbidden leaf texts.
  assertRejects((m) => { m.leafTexts.push("DELTA") }, /would introduce the lap-delta hero/)
  assertRejects((m) => { m.leafTexts.push("WATER TEMP") }, /would introduce the water-temperature readout/)
})

// ── Value assertions ──────────────────────────────────────────────────────────────────────

test("value text mismatches fail closed", () => {
  assertRejects((m) => { m.values[0].text = "60" }, /speed hero reads "60" instead of "52"/)
  assertRejects((m) => { m.values[3].text = "3" }, /gear readout reads "3" instead of "2"/)
  assertRejects((m) => { m.values[4].text = "70" }, /fuel readout reads "70" instead of "68"/)
  assertRejects((m) => { m.values[6].text = "1" }, /GRID readout must be "--"/)
  assertRejects((m) => { m.values[2].text = "OFF" }, /limiter badge reads "OFF" instead of "ON"/)
  assertRejects((m) => { m.values[1].text = "HOLD BRAKE" }, /action line reads "HOLD BRAKE" instead of "HOLD LIMITER"/)
})

// ── Pixel audit ───────────────────────────────────────────────────────────────────────────

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

function fillRect(image, box, rgb) {
  for (let y = Math.round(box.top); y < Math.round(box.top + box.height); y += 1) {
    for (let x = Math.round(box.left); x < Math.round(box.left + box.width); x += 1) {
      if (x < 0 || x >= image.width || y < 0 || y >= image.height) continue
      const offset = (y * image.width + x) * 4
      image.data[offset]     = rgb[0]
      image.data[offset + 1] = rgb[1]
      image.data[offset + 2] = rgb[2]
      image.data[offset + 3] = 255
    }
  }
}

function capturePng(state, { strayDanger = false, blank = false } = {}) {
  const size = CAPTURE_SIZES[0]
  const image = paint(size, CANVAS_RGB)
  if (!blank) {
    // Ribbon active step border/caret (signature pit-orange, amber family — present on silent frame).
    // 150×30 = 4500 pixels.
    fillRect(image, rect(100, 15, 150, 30), AMBER_RGB)
    // Normal bar fill at ~65% of 520px bar track × 20px (green family — present on silent frame).
    // 338×20 = 6760 pixels.
    fillRect(image, rect(40, 200, 338, 20), GREEN_RGB)
    // Limiter-ON value (cyan family — present on silent frame). 80×60 = 4800 pixels.
    fillRect(image, rect(620, 130, 80, 60), CYAN_RGB)
  }
  if (state === "overspeed") {
    const metrics = nativeMetrics("overspeed")
    const speedScope  = metrics.alertScope.speed
    const actionScope = metrics.alertScope.action
    // Red pixels inside the speed zone (bar fill and border go red on overspeed).
    fillRect(image, rect(speedScope.left + 4, speedScope.top + 4, 80, 16), DANGER_RGB)
    // Red pixels inside the action zone (action text, alarm line go red on overspeed).
    fillRect(image, rect(actionScope.left + 4, actionScope.top + 4, 60, 16), DANGER_RGB)
    if (strayDanger) {
      // Stray red pixel outside both scopes — must be rejected by assertHueFamilyScoped.
      fillRect(image, rect(20, 80, 6, 6), DANGER_RGB)
    }
  }
  return PNG.sync.write(image)
}

test("the silent frame carries amber and green pixels and zero red ones", () => {
  const audit = validateCapturePixels(capturePng("silent"), nativeEntry(), nativeMetrics())
  assert.equal(audit.hueFamilies.red, 0, "silent frame must have zero red-family pixels")
  assert.ok(audit.hueFamilies.amber > 0, "silent frame must carry signature pit-orange amber pixels")
  assert.ok(audit.hueFamilies.green > 0, "silent frame must carry normal bar fill green pixels")
  assert.equal(audit.gutter, `rgba(${CANVAS_RGB.join(",")},255)`)
})

test("the overspeed frame must paint red only inside the speed and action zones", () => {
  const metrics = nativeMetrics("overspeed")
  const entry   = nativeEntry("overspeed")
  const audit   = validateCapturePixels(capturePng("overspeed"), entry, metrics)
  assert.ok(audit.hueFamilies.red >= 30, "overspeed frame must carry red-family pixels")
  assert.equal(audit.alertHueOutsideScope, 0, "all red pixels must fall inside the alert scope")
  assert.throws(
    () => validateCapturePixels(capturePng("overspeed", { strayDanger: true }), entry, metrics),
    /fall outside the elements that own that alert/
  )
})

test("a red pixel on the silent frame and a blank frame both fail closed", () => {
  // Build a frame that passes the non-blank check but carries a stray red pixel.
  const image = paint(CAPTURE_SIZES[0], CANVAS_RGB)
  // Enough non-canvas pixels to pass the non-blank gate (>5000).
  fillRect(image, rect(40, 200, 338, 20), GREEN_RGB)   // 6760 px green bar fill
  fillRect(image, rect(100, 15, 150, 30), AMBER_RGB)   // 4500 px ribbon
  // Stray red pixel that must be caught by the hue check.
  fillRect(image, rect(300, 100, 5, 5), DANGER_RGB)    // 25 px red
  assert.throws(
    () => validateCapturePixels(PNG.sync.write(image), nativeEntry(), nativeMetrics()),
    /the red hue family must be absent/
  )
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { blank: true }), nativeEntry(), nativeMetrics()),
    /capture is blank/
  )
})

test("the overspeed frame fails closed when the red hue is entirely missing", () => {
  // Feeding the silent PNG to the overspeed entry means red pixels are expected but absent.
  assert.throws(
    () => validateCapturePixels(capturePng("silent"), nativeEntry("overspeed"), nativeMetrics("overspeed")),
    /the red hue family must be painted/
  )
})

// ── Disk-safety primitives ────────────────────────────────────────────────────────────────

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
