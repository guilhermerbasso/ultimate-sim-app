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
  RC03_CAPTURE_MATRIX,
  RC03_EXPECTED_FUEL_FILL,
  RC03_EXPECTED_RIBBON_FILL,
  RC03_RAIL_ROW_COUNT,
  RC03_SPEC,
  RC03_VITAL_COUNT,
  validateCaptureMetrics,
  validateCapturePixels
} from "./racecon-rc03-capture-lib.mjs"

function temporaryDirectory() {
  return mkdtempSync(join(tmpdir(), "racecon-rc03-capture-test-"))
}

const CANVAS_RGB = [7, 9, 11]
const AMBER_RGB = [179, 131, 40]
const DANGER_RGB = [176, 53, 44]
const TEAL_RGB = [41, 125, 153]

function rect(left, top, width, height) {
  return { left, top, width, height }
}

function measured(box) {
  return { ...box, layoutWidth: box.width, layoutHeight: box.height, scrollWidth: box.width, scrollHeight: box.height }
}

function zone(name, box, display = "block") {
  return { name, selector: `.${name}`, present: true, display, ...measured(box) }
}

/** Mirrors the packet 11.1 native grammar so the fixture is a real, non-overlapping layout. */
function nativeZones(size) {
  const px = (fraction, extent) => fraction * extent
  return [
    zone("ribbon", rect(px(0.02, size.width), px(0.01667, size.height), px(0.96, size.width), px(0.04167, size.height))),
    zone("pace", rect(px(0.02, size.width), px(0.08333, size.height), px(0.96, size.width), px(0.3125, size.height))),
    zone("stint-clock", rect(px(0.8, size.width), px(0.08333, size.height), px(0.18, size.width), px(0.125, size.height))),
    zone("vitals", rect(px(0.02, size.width), px(0.41667, size.height), px(0.96, size.width), px(0.29167, size.height))),
    zone("fuel", rect(px(0.02, size.width), px(0.72917, size.height), px(0.96, size.width), px(0.25, size.height))),
    zone("rail", rect(0, 0, 0, 0), "none")
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
    color: "rgb(232, 236, 239)",
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
 * A complete, self-consistent RC-03 metric fixture at the native canvas. Every geometric value
 * mirrors the packet grammar the stylesheet encodes, so a mutation of one field is the only
 * reason a validation can fail.
 */
function nativeMetrics(state = "silent") {
  const size = CAPTURE_SIZES[0]
  const zones = nativeZones(size)
  const paceZone = zones[1]
  const clockZone = zones[2]
  const vitalsZone = zones[3]
  const fuelZone = zones[4]
  const gearBox = rect(20, 60, 60, 96)
  const deltaBox = rect(200, 60, 200, 72)
  const speedBox = rect(500, 70, 90, 44)
  const clockBox = rect(646, 46, 120, 30)
  const fuelLapsBox = rect(20, 360, 180, 90)
  const fuelLevelBox = rect(300, 380, 120, 40)
  const stintLapBox = rect(620, 380, 100, 44)
  const alarming = state === "oil-alarm"
  const vitals = [
    { channel: "waterTemp", label: "WATER", text: "92" },
    { channel: "oilPressure", label: "OIL P", text: alarming ? "1.0" : "4.6" },
    { channel: "oilTemp", label: "OIL T", text: "108" },
    { channel: "battery", label: "BATT", text: "13.4" }
  ].map((vital, index) => ({
    ...vital,
    alert: alarming && vital.channel === "oilPressure" ? "true" : "false",
    rect: measured(rect(20 + index * 190, 210, 180, 120)),
    valueRect: measured(rect(24 + index * 190, 250, 120, 44))
  }))
  return {
    viewport: { width: size.width, height: size.height, dpr: 1 },
    page: { scrollWidth: size.width, clientWidth: size.width },
    root: rect(0, 0, size.width, size.height),
    shell: measured(rect(0, 0, size.width, size.height)),
    canvas: { ...measured(rect(0, 0, size.width, size.height)), transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
    dashboardElement: measured(rect(0, 0, size.width, size.height)),
    widget: measured(rect(0, 0, size.width, size.height)),
    dashboard: measured(rect(0, 0, size.width, size.height)),
    presetId: RC03_SPEC.presetId,
    expectedWidgetId: RC03_SPEC.widgetId,
    renderedWidgetId: RC03_SPEC.widgetId,
    dashboardWidth: "1024",
    dashboardHeight: "600",
    sourceKind: "live-telemetry",
    sourceIdentity: RC03_SPEC.sourceIdentity,
    captureState: state,
    captureSequence: "120",
    layout: "native",
    compactMode: null,
    bufferState: "accepted",
    contentWidth: String(size.width),
    contentHeight: String(size.height),
    stateAttributes: {
      brightness: "night",
      "vitals-page": "temps",
      "fuel-window": "false",
      "oil-alarm": alarming ? "true" : "false",
      overheat: "false"
    },
    zones,
    values: [
      value("gear", ".rc03-gear", "4", gearBox, 96),
      value("delta", ".rc03-delta", "-0.112", deltaBox, 72),
      value("speed", ".rc03-speed", "218", speedBox, 44),
      value("stint clock", ".rc03-clock", "41:52", clockBox, 30),
      value("fuel laps", ".rc03-fuel-laps", "12.4", fuelLapsBox, 90),
      value("fuel level", ".rc03-fuel-level", "41.8", fuelLevelBox, 40),
      value("stint lap", ".rc03-stint-lap", "18", stintLapBox, 44)
    ],
    containment: [
      owned("gear", paceZone, gearBox),
      owned("delta", paceZone, deltaBox),
      owned("speed", paceZone, speedBox),
      owned("stint clock", clockZone, clockBox),
      owned("fuel laps", fuelZone, fuelLapsBox),
      owned("fuel level", fuelZone, fuelLevelBox),
      owned("stint lap", fuelZone, stintLapBox)
    ],
    forbidden: RC03_SPEC.forbidden.map(([label, selector]) => ({ label, selector, count: 0 })),
    counted: [
      counted("vital", '[data-testid="rc03-vital"]', RC03_VITAL_COUNT),
      counted("rail row", '[data-testid="rc03-rail-row"]', RC03_RAIL_ROW_COUNT),
      counted("ribbon fill", '[data-testid="rc03-ribbon-fill"]', 1),
      counted("fuel bar fill", '[data-testid="rc03-fuel-bar-fill"]', 1),
      counted("alarm line", '[data-testid="rc03-alarm-line"]', alarming ? 1 : 0),
      counted("pit window", '[data-testid="rc03-pit-window"]', 0),
      counted("trend bar", '[data-testid="rc03-trend-bar"]', 3)
    ],
    textOutputs: ["4", "-0.112", "218", "41:52", "92", "4.6", "108", "13.4", "12.4", "41.8", "18"],
    leafTexts: ["GEAR", "4", "DELTA", "-0.112", "S", "SPEED", "218", "KM/H", "STINT", "41:52"],
    overflowLeaves: [],
    rootText:
      "GEAR4DELTA-0.112SSPEED218KM/HSTINT41:52WATER92COIL P4.6BAROIL T108CBATT13.4VFUEL LAPS12.441.8LSTINT LAP18",
    errorBoundaryCount: 0,
    unknownWidgetCount: 0,
    failures: [],
    pageErrors: [],
    consoleErrors: [],
    nativeSize: "800x480",
    ribbon: {
      tone: "caution",
      unavailable: "false",
      rect: rect(16, 8, 768, 20),
      fill: rect(16, 8, 768 * RC03_EXPECTED_RIBBON_FILL, 20),
      textLength: 0
    },
    fuelBar: {
      unavailable: "false",
      rect: rect(300, 420, 200, 18),
      fill: rect(300, 420, 200 * RC03_EXPECTED_FUEL_FILL, 18)
    },
    vitals,
    vitalsAlarm: alarming ? "oil-pressure" : "none",
    alarmLineText: alarming ? "LOW OIL PRESS" : null,
    alarmLineRect: alarming ? rect(30, 300, 200, 20) : null,
    railRows: [
      { label: "FUEL WINDOW", text: "3", rect: measured(rect(0, 0, 0, 0)) },
      { label: "PIT LAP", text: "30", rect: measured(rect(0, 0, 0, 0)) },
      { label: "AVG PACE", text: "1:58.400", rect: measured(rect(0, 0, 0, 0)) }
    ],
    fuelTrend: { display: "none", rect: rect(0, 0, 0, 0) },
    fuelPerLapText: "3.37",
    alertScope: vitalsZone
  }
}

function nativeEntry(state = "silent") {
  return RC03_CAPTURE_MATRIX.find((entry) => entry.state === state && entry.size.width === 800)
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

test("the governed matrix covers every viewport in every governed state", () => {
  assert.equal(CAPTURE_SIZES.length, 6)
  assert.deepEqual([...CAPTURE_STATES], ["silent", "oil-alarm"])
  assert.equal(RC03_CAPTURE_MATRIX.length, CAPTURE_SIZES.length * CAPTURE_STATES.length)
  for (const entry of RC03_CAPTURE_MATRIX) {
    assert.equal(entry.size.layout, expectedLayoutForBox(entry.size.width, entry.size.height))
    assert.equal(entry.size.compactMode, expectedCompactModeForBox(entry.size.width, entry.size.height))
  }
  // The alarm scenario may only be captured once the widget has published the latch.
  const alarm = RC03_CAPTURE_MATRIX.filter((entry) => entry.state === "oil-alarm")
  assert.equal(alarm.length, 6)
  for (const entry of alarm) assert.deepEqual(entry.required[0], ["oil-alarm", "true"])
})

test("hue families separate the amber resting palette from the danger token", () => {
  // The RC-03 defect this guards against: a channel-ratio red test counts amber as red, because
  // both its green and blue channels sit far below its red channel.
  assert.equal(hueFamilyOfHex("#e6a833"), "amber")
  assert.equal(hueFamilyOfHex("#e24438"), "red")
  // A ratio test at any plausible threshold misclassifies this amber as red; hue does not.
  assert.ok(AMBER_RGB[1] < 0.75 * AMBER_RGB[0] && AMBER_RGB[2] < 0.75 * AMBER_RGB[0])
  assert.equal(hueFamily(...AMBER_RGB), "amber")
  // Hue survives the night profile's brightness filter, which is why it is the property tested.
  assert.equal(hueFamily(...DANGER_RGB), "red")
  assert.equal(hueFamily(226, 68, 56), "red")
  assert.equal(hueFamily(...TEAL_RGB), "cyan")
  assert.equal(hueFamily(7, 9, 11), "neutral")
})

test("a faithful native fixture validates and reports its type scale", () => {
  const audit = validateCaptureMetrics(nativeMetrics(), nativeEntry())
  assert.deepEqual(audit.knownDefects, [])
  assert.deepEqual(audit.typeScale, [
    { label: "gear", fontSize: 96 },
    { label: "fuel laps", fontSize: 90 },
    { label: "delta", fontSize: 72 },
    { label: "speed", fontSize: 44 }
  ])
})

test("the alarm fixture validates only with its alarm surfaces present", () => {
  validateCaptureMetrics(nativeMetrics("oil-alarm"), nativeEntry("oil-alarm"))
  assertRejects((metrics) => { metrics.counted[4].count = 0 }, /alarm line must be present/u, "oil-alarm")
  assertRejects((metrics) => { metrics.vitals[1].alert = "false" }, /OIL P vital reports alert=false/u, "oil-alarm")
  assertRejects((metrics) => { metrics.vitalsAlarm = "none" }, /vitals band reports alarm none/u, "oil-alarm")
  assertRejects((metrics) => { metrics.alarmLineText = "OVERHEAT" }, /instead of the low oil pressure alarm/u, "oil-alarm")
})

test("a tie anywhere in the type scale is a failure, not a pass", () => {
  assertRejects((metrics) => { metrics.values[1].fontSize = 90 }, /type-scale hierarchy does not hold/u)
  assertRejects((metrics) => { metrics.values[2].fontSize = 72 }, /type-scale hierarchy does not hold/u)
  assertRejects((metrics) => { metrics.values[0].fontSize = 90 }, /type-scale hierarchy does not hold/u)
})

test("overlapping zones fail closed while the packet's declared overlap does not", () => {
  assertRejects((metrics) => { metrics.zones[3].top = metrics.zones[1].top }, /zone pace overlaps vitals/u)
  // The stint clock deliberately sits over the pace band's reserved right corner.
  const metrics = nativeMetrics()
  assert.ok(metrics.zones[2].left < metrics.zones[1].left + metrics.zones[1].width)
  validateCaptureMetrics(metrics, nativeEntry())
})

test("an element that escapes its zone or the frame fails closed", () => {
  assertRejects((metrics) => { metrics.containment[1].value = rect(200, 60, 900, 72) }, /delta escapes its zone/u)
  assertRejects((metrics) => { metrics.zones[4].top = 470 }, /fuel is out of frame/u)
  assertRejects((metrics) => { metrics.values[0].rect = measured(rect(760, 60, 90, 96)) }, /gear value is not contained/u)
})

test("every measured overflow now fails closed, because the defect ledger is empty", () => {
  // The compact-phone overruns this ledger used to record are fixed, so there is no waiver left
  // for the sweep to consult: an overflow at any viewport, in any state, on any leaf, fails.
  assert.deepEqual(RC03_SPEC.knownDefects, [])
  assertRejects(
    (metrics) => {
      metrics.overflowLeaves = [
        { key: "rc03-value rc03-gear", text: "4", fontSize: 96, whiteSpace: "nowrap", clientWidth: 60, scrollWidth: 90, overflowX: 30, textLeft: 20, textRight: 110 }
      ]
    },
    /paints 30px wider than its 60px box/u
  )
  // The exact leaf the shipped build overran at compact phone, at the exact measured size.
  const phone = RC03_CAPTURE_MATRIX.find((entry) => entry.state === "silent" && entry.size.width === 393)
  const metrics = nativeMetrics()
  metrics.overflowLeaves = [
    { key: "rc03-value rc03-delta", text: "-0.112", fontSize: 43.23, whiteSpace: "nowrap", clientWidth: 100, scrollWidth: 115, overflowX: 15, textLeft: 61.86, textRight: 176.81 }
  ]
  assert.throws(
    () => validateCaptureMetrics(withSize(metrics, phone), phone),
    /rc03-value rc03-delta "-0\.112" paints 15px wider than its 100px box/u
  )
  // A single pixel is enough: there is no budget to grow into.
  metrics.overflowLeaves[0] = { ...metrics.overflowLeaves[0], overflowX: 1, scrollWidth: 101 }
  assert.throws(() => validateCaptureMetrics(withSize(metrics, phone), phone), /paints 1px wider/u)
})

test("a numeral that paints into the next pace cell fails even when scrollWidth says it fits", () => {
  // The defect `scrollWidth` cannot see. `white-space: nowrap` sizes the delta box to its own
  // glyphs, so the leaf sweep reports nothing while the glyphs still cross into the speed cell.
  const phone = RC03_CAPTURE_MATRIX.find((entry) => entry.state === "silent" && entry.size.width === 393)
  const overpainted = withSize(nativeMetrics(), phone)
  const delta = overpainted.values[1]
  delta.textRect = { ...delta.rect, width: delta.rect.width + 6 }
  assert.equal(overpainted.overflowLeaves.length, 0)
  assert.ok(delta.textRect.left + delta.textRect.width > delta.rect.left + delta.rect.width)
  assert.ok(delta.textRect.left + delta.textRect.width < overpainted.values[2].rect.left)
  assert.throws(() => validateCaptureMetrics(overpainted, phone), /paints 6\.00px past its own cell/u)

  // And the pure collision: a numeral that fits its own cell but still reaches the next one.
  const touching = withSize(nativeMetrics(), phone)
  const shifted = rect(
    touching.values[2].rect.left - touching.values[1].rect.width + 4.5,
    touching.values[1].rect.top,
    touching.values[1].rect.width,
    touching.values[1].rect.height
  )
  touching.values[1].rect = measured(shifted)
  touching.values[1].textRect = shifted
  assert.equal(touching.overflowLeaves.length, 0)
  assert.throws(
    () => validateCaptureMetrics(touching, phone),
    /while the speed cell begins at x=.*the pace band's cells collide/u
  )
})

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
  scaled.zones = nativeZones(entry.size)
  scaled.alertScope = scaled.zones[3]
  scaled.containment = []
  const vitalsZone = scaled.zones[3]
  scaled.vitals = metrics.vitals.map((vital, index) => ({
    ...vital,
    rect: measured(rect(vitalsZone.left + index, vitalsZone.top, 4, 4)),
    valueRect: measured(rect(vitalsZone.left + index, vitalsZone.top, 4, 4))
  }))
  scaled.ribbon = { ...metrics.ribbon, rect: rect(0, 0, 100, 10), fill: rect(0, 0, 100 * RC03_EXPECTED_RIBBON_FILL, 10) }
  scaled.fuelBar = { ...metrics.fuelBar, rect: rect(0, 0, 100, 10), fill: rect(0, 0, 100 * RC03_EXPECTED_FUEL_FILL, 10) }
  scaled.alarmLineRect = metrics.alarmLineRect ? rect(vitalsZone.left, vitalsZone.top, 4, 4) : null
  scaled.values = metrics.values.map((candidate, index) => {
    // Lay the readouts out side by side rather than stacking them all at the origin: the
    // pace-band collision guard compares one cell's painted glyphs against the NEXT cell's box,
    // so a degenerate fixture would make every capture look like a collision.
    const box = rect(index * 50, 0, 40, 40)
    return { ...candidate, rect: measured(box), textRect: box }
  })
  return scaled
}

test("a reintroduced packet omission fails closed", () => {
  assertRejects((metrics) => { metrics.forbidden[0].count = 4 }, /tyre-temperature surface must not be rendered/u)
  assertRejects((metrics) => { metrics.forbidden[1].count = 1 }, /engine-speed numeral must not be rendered/u)
  assertRejects((metrics) => { metrics.leafTexts.push("6048") }, /renders "6048" as a readout/u)
  assertRejects((metrics) => { metrics.leafTexts.push("LF") }, /renders "LF" as a readout/u)
})

test("the ribbon and the fuel bar must agree with their telemetry rather than the reference image", () => {
  // image-qa-v2 note 1: the reference draws 43.48% and the build must draw 41.8 / 110 = 38.0%.
  assertRejects((metrics) => { metrics.fuelBar.fill = rect(300, 420, 200 * 0.4348, 18) }, /instead of the 0\.3800/u)
  assertRejects((metrics) => { metrics.ribbon.fill = rect(16, 8, 768 * 0.5, 20) }, /engine-speed ratio/u)
  assertRejects((metrics) => { metrics.ribbon.tone = "danger" }, /must not latch its over-rev tone/u)
  assertRejects((metrics) => { metrics.ribbon.textLength = 3 }, /forbids text, ticks and index marks/u)
})

test("a modifier that disagrees with the measured content box fails closed", () => {
  assertRejects((metrics) => { metrics.layout = "app" }, /layout modifier app does not match/u)
  assertRejects((metrics) => { metrics.contentWidth = "801" }, /did not report its measured content box/u)
  assertRejects((metrics) => { metrics.nativeSize = null }, /native content-box modifier/u)
  assertRejects((metrics) => { metrics.bufferState = "duplicate" }, /accepted live frame/u)
  assertRejects((metrics) => { metrics.sourceIdentity = "acc:session:1:connection:1" }, /live telemetry source identity/u)
  assertRejects((metrics) => { metrics.captureState = "oil-alarm" }, /rendered the oil-alarm scenario/u)
})

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

function capturePng(state, { strayDanger = false, blank = false } = {}) {
  const size = CAPTURE_SIZES[0]
  const image = paint(size, CANVAS_RGB)
  if (!blank) {
    fill(image, rect(16, 8, 768 * RC03_EXPECTED_RIBBON_FILL, 20), AMBER_RGB)
    fill(image, rect(20, 360, 180, 90), AMBER_RGB)
    fill(image, rect(640, 40, 140, 60), TEAL_RGB)
  }
  if (state === "oil-alarm") {
    const scope = nativeMetrics("oil-alarm").alertScope
    fill(image, rect(scope.left + 4, scope.top + 4, 120, 40), DANGER_RGB)
    if (strayDanger) fill(image, rect(30, 60, 40, 20), DANGER_RGB)
  }
  return PNG.sync.write(image)
}

test("the silent frame carries twenty thousand amber pixels and zero red ones", () => {
  const audit = validateCapturePixels(capturePng("silent"), nativeEntry(), nativeMetrics())
  assert.equal(audit.hueFamilies.red, 0)
  assert.ok(audit.hueFamilies.amber > 20_000)
  assert.equal(audit.gutter, "rgba(7,9,11,255)")
})

test("the alarm frame must paint the danger hue only inside the vitals band", () => {
  const metrics = nativeMetrics("oil-alarm")
  const entry = nativeEntry("oil-alarm")
  const audit = validateCapturePixels(capturePng("oil-alarm"), entry, metrics)
  assert.ok(audit.hueFamilies.red >= 4_000)
  assert.equal(audit.alertHueOutsideScope, 0)
  assert.throws(
    () => validateCapturePixels(capturePng("oil-alarm", { strayDanger: true }), entry, metrics),
    /fall outside the elements that own that alert/u
  )
})

test("a danger pixel on the silent frame and a blank frame both fail closed", () => {
  const silent = paint(CAPTURE_SIZES[0], CANVAS_RGB)
  fill(silent, rect(20, 360, 180, 90), AMBER_RGB)
  fill(silent, rect(400, 300, 6, 6), DANGER_RGB)
  assert.throws(
    () => validateCapturePixels(PNG.sync.write(silent), nativeEntry(), nativeMetrics()),
    /the red hue family must be absent, 36 pixels measured/u
  )
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { blank: true }), nativeEntry(), nativeMetrics()),
    /capture is blank/u
  )
})

test("the alarm frame fails closed when the danger hue is missing entirely", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent"), nativeEntry("oil-alarm"), nativeMetrics("oil-alarm")),
    /the red hue family must be painted/u
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
