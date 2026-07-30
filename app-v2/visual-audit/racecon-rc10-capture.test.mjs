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
  assertHueFamilyScoped,
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
  RC10_CAPTURE_MATRIX,
  RC10_CAUTION_HEX,
  RC10_DANGER_HEX,
  RC10_FUEL_LIT_LOW,
  RC10_FUEL_LIT_SILENT,
  RC10_FUEL_SEGMENT_COUNT,
  RC10_FUEL_TILE_AMBER_ENGAGED_CEILING,
  RC10_FUEL_TILE_AMBER_RESTING_FLOOR,
  RC10_INFO_HEX,
  RC10_NORMAL_HEX,
  RC10_SHIFT_SEGMENT_COUNT,
  RC10_SIGNATURE_HEX,
  RC10_SPEC,
  RC10_STATUS_CELL_COUNT,
  validateCaptureMetrics,
  validateCapturePixels
} from "./racecon-rc10-capture-lib.mjs"

function temporaryDirectory() {
  return mkdtempSync(join(tmpdir(), "racecon-rc10-capture-test-"))
}

// RC-10 canvas: #000000 = rgb(0, 0, 0)
const CANVAS_RGB   = [0, 0, 0]
// Info blue: #56B4E9 = rgb(86, 180, 233) → blue family
const BLUE_RGB     = [86, 180, 233]
// Normal green: #009E73 = rgb(0, 158, 115) → green family
const GREEN_RGB    = [0, 158, 115]
// Signature amber: #F0E442 = rgb(240, 228, 66) → amber family (Okabe-Ito)
const AMBER_RGB    = [240, 228, 66]
// Red — must never appear on any RC-10 frame
const RED_RGB      = [255, 60, 60]
// Neutral gray — for missing-blue/missing-green tests
const GRAY_RGB     = [128, 128, 128]

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
    color: "rgb(221, 221, 221)",
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
 * Four tile zones at native 800×480, stacked vertically in four rows.
 * A fifth element (status row) lives outside the governed zone list.
 */
function nativeZones() {
  return {
    gearZone:  rect(0,   0, 800, 116),
    speedZone: rect(0, 116, 800, 116),
    deltaZone: rect(0, 232, 800, 116),
    fuelZone:  rect(0, 348, 800, 116)
  }
}

function nativeMetrics(state = "silent") {
  const size   = CAPTURE_SIZES[0]  // 800×480
  const isLow  = state === "fuel-low"
  const { gearZone, speedZone, deltaZone, fuelZone } = nativeZones()

  const gearValueBox   = rect(10,  10, 120, 100)
  const shiftBarBox    = rect(140, 10, 600,  60)
  const speedValueBox  = rect(10, 126, 200,  80)
  const deltaValueBox  = rect(10, 242, 240,  80)
  const deltaPatternBox= rect(260, 242, 300,  80)
  const fuelValueBox   = rect(10, 358, 120,  60)
  const fuelBarBox     = rect(140, 358, 500,  60)

  const posBox   = rect(10, 420, 80, 36)   // status row, inside 464–480 leftover space
  const waterBox = rect(100, 420, 80, 36)
  const tcBox    = rect(190, 420, 80, 36)

  return {
    viewport: { width: 800, height: 480, dpr: 1 },
    page: { scrollWidth: 800, clientWidth: 800 },
    root: rect(0, 0, 800, 480),
    shell: measured(rect(0, 0, 800, 480)),
    canvas: { ...measured(rect(0, 0, 800, 480)), transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
    dashboardElement: measured(rect(0, 0, 800, 480)),
    widget: measured(rect(0, 0, 800, 480)),
    dashboard: measured(rect(0, 0, 800, 480)),
    presetId:         RC10_SPEC.presetId,
    expectedWidgetId: RC10_SPEC.widgetId,
    renderedWidgetId: RC10_SPEC.widgetId,
    dashboardWidth:   "1024",
    dashboardHeight:  "600",
    sourceKind:       "live-telemetry",
    sourceIdentity:   RC10_SPEC.sourceIdentity,
    captureState:     state,
    captureSequence:  "200",
    layout:           "native",
    compactMode:      null,
    bufferState:      "accepted",
    contentWidth:     "800",
    contentHeight:    "480",
    stateAttributes: {
      alerts:           isLow ? "active" : "silent",
      "alert-keys":     isLow ? "FUEL LOW" : "",
      emphasis:         isLow ? "fuel" : "none",
      "delta-direction": "negative"
    },
    zones: [
      zone("gear",  gearZone,  "rc10-gear"),
      zone("speed", speedZone, "rc10-speed"),
      zone("delta", deltaZone, "rc10-delta"),
      zone("fuel",  fuelZone,  "rc10-fuel")
    ],
    values: [
      value("gear",     '[data-testid="rc10-gear-value"]',  "4",                 gearValueBox,  210),
      value("speed",    '[data-testid="rc10-speed-value"]', "187",               speedValueBox, 150),
      value("delta",    '[data-testid="rc10-delta-value"]', "-0.284",            deltaValueBox,  86),
      value("fuel",     '[data-testid="rc10-fuel-value"]',  isLow ? "2.1" : "8.4", fuelValueBox, 72),
      value("position", '[data-testid="rc10-position"]',    "7",                 posBox,         44),
      value("water",    '[data-testid="rc10-water"]',       "92",                waterBox,       44),
      value("tc",       '[data-testid="rc10-tc"]',          "3",                 tcBox,          44)
    ],
    containment: [
      owned("gear value",   gearZone,  gearValueBox),
      owned("shift bar",    gearZone,  shiftBarBox),
      owned("speed value",  speedZone, speedValueBox),
      owned("delta value",  deltaZone, deltaValueBox),
      owned("delta pattern",deltaZone, deltaPatternBox),
      owned("fuel value",   fuelZone,  fuelValueBox),
      owned("fuel bar",     fuelZone,  fuelBarBox)
    ],
    forbidden: RC10_SPEC.forbidden.map(([label, selector]) => ({ label, selector, count: 0 })),
    counted: [
      counted("shift segment",   '[data-testid="rc10-shift-seg"]',                          RC10_SHIFT_SEGMENT_COUNT),
      counted("fuel segment",    '[data-testid="rc10-fuel-seg"]',                           RC10_FUEL_SEGMENT_COUNT),
      counted("status cell",     '[data-testid="rc10-status-cell"]',                        RC10_STATUS_CELL_COUNT),
      counted("status icon",     '[data-testid="rc10-status-icon"]',                        RC10_STATUS_CELL_COUNT),
      counted("status row",      '[data-testid="rc10-status"]',                             1),  // present at native
      counted("plain line",      '[data-testid="rc10-plain"]',                              0),
      counted("plain headline",  '[data-testid="rc10-plain-headline"]',                     0),
      counted("fuel low word",   '[data-testid="rc10-fuel-low"]',                           isLow ? 1 : 0),
      counted("over rev word",   '[data-testid="rc10-over-rev"]',                           0),
      counted("overheat word",   '[data-testid="rc10-overheat"]',                           0),
      counted("triangle glyph",  '[data-testid="rc10-status-icon"][data-rc10-shape="triangle"]', isLow ? 1 : 0),
      counted("octagon glyph",   '[data-testid="rc10-status-icon"][data-rc10-shape="octagon"]',  0),
      counted("circle glyph",    '[data-testid="rc10-status-icon"][data-rc10-shape="circle"]',   RC10_STATUS_CELL_COUNT)
    ],
    textOutputs: ["4", "187", "-0.284", isLow ? "2.1" : "8.4", "7", "92", "3"],
    leafTexts: [
      "4", "187", "-0.284", isLow ? "2.1" : "8.4", "7", "92", "3",
      "GEAR", "SPEED", "KM/H", "DELTA", "FUEL", "LAPS", "POS", "WATER", "TC",
      ...(isLow ? ["FUEL LOW"] : [])
    ],
    overflowLeaves: [],
    rootText: `GEARSPEEDKM/HDELTAFUELLAPSPOSWATERTC4187-0.284${isLow ? "2.1" : "8.4"}79234${isLow ? "FUEL LOW" : ""}`,
    errorBoundaryCount: 0,
    unknownWidgetCount: 0,
    failures:      [],
    pageErrors:    [],
    consoleErrors: [],
    nativeSize:       "800x480",
    shiftSegments:    String(RC10_SHIFT_SEGMENT_COUNT),
    shiftLit:         "6",
    fuelSegments:     String(RC10_FUEL_SEGMENT_COUNT),
    fuelLit:          isLow ? RC10_FUEL_LIT_LOW : RC10_FUEL_LIT_SILENT,
    fuelEmphasised:   isLow ? "true" : "false",
    fuelLowText:      isLow ? "FUEL LOW" : null,
    plainCarried:     null,
    plainHeadline:    null,
    statusShapes:     ["circle", "circle", "circle"],
    statusRanks:      ["normal", "normal", "normal"],
    fuelScope:        [{ left: 0, top: 348, width: 800, height: 116 }]
  }
}

function nativeEntry(state = "silent") {
  return RC10_CAPTURE_MATRIX.find((entry) => entry.state === state && entry.size.width === 800)
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
  assert.deepEqual([...CAPTURE_STATES], ["silent", "fuel-low"])
  assert.equal(RC10_CAPTURE_MATRIX.length, CAPTURE_SIZES.length * CAPTURE_STATES.length)
  for (const entry of RC10_CAPTURE_MATRIX) {
    assert.equal(entry.size.layout, expectedLayoutForBox(entry.size.width, entry.size.height))
    assert.equal(entry.size.compactMode, expectedCompactModeForBox(entry.size.width, entry.size.height))
  }
  const low = RC10_CAPTURE_MATRIX.filter((entry) => entry.state === "fuel-low")
  assert.equal(low.length, 6)
  for (const entry of low) assert.deepEqual(entry.required[0], ["alerts", "active"])
  for (const entry of low) assert.deepEqual(entry.required[1], ["alert-keys", "FUEL LOW"])
  const silent = RC10_CAPTURE_MATRIX.filter((entry) => entry.state === "silent")
  for (const entry of silent) assert.deepEqual(entry.required[0], ["alerts", "silent"])
  for (const entry of silent) assert.deepEqual(entry.required[1], ["alert-keys", ""])
})

// ── Hue families ───────────────────────────────────────────────────────────────────────────

test("RC-10 Okabe-Ito tokens: caution/danger/signature all collapse into amber, info=blue, normal=green", () => {
  assert.equal(hueFamilyOfHex(RC10_CAUTION_HEX),    "amber")  // #E69F00
  assert.equal(hueFamilyOfHex(RC10_DANGER_HEX),     "amber")  // #D55E00 vermilion
  assert.equal(hueFamilyOfHex(RC10_SIGNATURE_HEX),  "amber")  // #F0E442
  assert.equal(hueFamilyOfHex(RC10_INFO_HEX),       "blue")   // #56B4E9
  assert.equal(hueFamilyOfHex(RC10_NORMAL_HEX),     "green")  // #009E73
})

// ── Happy-path validations ─────────────────────────────────────────────────────────────────

test("a faithful native silent fixture validates and reports its type scale", () => {
  const audit = validateCaptureMetrics(nativeMetrics("silent"), nativeEntry("silent"))
  assert.deepEqual(audit.knownDefects, [])
  assert.deepEqual(audit.typeScale, [
    { label: "gear",   fontSize: 210 },
    { label: "speed",  fontSize: 150 },
    { label: "delta",  fontSize:  86 },
    { label: "fuel",   fontSize:  72 },
    { label: "status", fontSize:  44 }
  ])
})

test("a faithful native fuel-low fixture validates with the alert surfaces present", () => {
  validateCaptureMetrics(nativeMetrics("fuel-low"), nativeEntry("fuel-low"))
  // Missing alert-keys fails
  assertRejects((m) => { m.stateAttributes["alert-keys"] = "" }, /must be exactly "FUEL LOW"/, "fuel-low")
  // alerts=silent in fuel-low state fails
  assertRejects((m) => { m.stateAttributes.alerts = "silent" }, /fuel-low state must publish data-rc10-alerts/, "fuel-low")
  // Wrong emphasis fails
  assertRejects((m) => { m.stateAttributes.emphasis = "none" }, /fuel-low state must emphasise the fuel tile/, "fuel-low")
  // fuelEmphasised=false fails
  assertRejects((m) => { m.fuelEmphasised = "false" }, /fuel tile must publish data-rc10-emphasised="true"/, "fuel-low")
  // Wrong fuel lit count fails
  assertRejects((m) => { m.fuelLit = "4" }, /fuel bar must light 1 of 6 segments at 2.1 laps/, "fuel-low")
})

// ── Type scale ─────────────────────────────────────────────────────────────────────────────

test("a tie anywhere in the governed type scale is a failure", () => {
  assertRejects((m) => { m.values[0].fontSize = 150 }, /type-scale hierarchy does not hold/)  // gear=speed
  assertRejects((m) => { m.values[1].fontSize = 86 },  /type-scale hierarchy does not hold/)  // speed=delta
  assertRejects((m) => { m.values[2].fontSize = 72 },  /type-scale hierarchy does not hold/)  // delta=fuel
  assertRejects((m) => { m.values[3].fontSize = 44 },  /type-scale hierarchy does not hold/)  // fuel=status
})

// ── Zone geometry ──────────────────────────────────────────────────────────────────────────

test("overlapping zones fail closed while non-overlapping zones pass", () => {
  // Push delta zone up so it overlaps speed
  assertRejects((m) => { m.zones[2].top -= 50 }, /zone speed overlaps delta/)
  // Extend gear zone so it covers the frame
  assertRejects((m) => { m.zones[0].height = 500 }, /zone gear overlaps/)
  validateCaptureMetrics(nativeMetrics(), nativeEntry())
})

test("a zone out of frame fails closed", () => {
  assertRejects((m) => { m.zones[3].top = 450 }, /fuel is out of frame/)
})

// -- Overflow ledger (RC-14-style zone/containment discipline) ------------------------------

test("RC-10 defect ledgers are empty after the delta/fuel fixes", () => {
  assert.deepEqual(RC10_SPEC.knownDefects, [])
  assert.deepEqual(RC10_SPEC.zoneOverflowDefects, [])
  assert.deepEqual(RC10_SPEC.containmentDefects, [])
})

test("delta tile regression guard accepts a clean metric", () => {
  validateCaptureMetrics(nativeMetrics("silent"), nativeEntry("silent"))
})

test("delta tile content overflow fails closed", () => {
  assertRejects(
    (m) => { m.zones[2].scrollHeight = m.zones[2].layoutHeight + 1 },
    /zone delta overflows its layout box by/
  )
})

test("delta value containment escape fails closed", () => {
  assertRejects(
    (m) => { m.containment[3].value = { ...m.containment[3].value, top: m.containment[3].owner.top - 1 } },
    /delta value escapes its zone/
  )
})

test("fuel tile regression guard accepts a clean metric", () => {
  validateCaptureMetrics(nativeMetrics("fuel-low"), nativeEntry("fuel-low"))
})

test("fuel tile content overflow fails closed", () => {
  assertRejects(
    (m) => { m.zones[3].scrollHeight = m.zones[3].layoutHeight + 1 },
    /zone fuel overflows its layout box by/
  )
})

test("fuel value containment escape fails closed", () => {
  assertRejects(
    (m) => { m.containment[5].value = { ...m.containment[5].value, top: m.containment[5].owner.top - 1 } },
    /fuel value escapes its zone/
  )
})

// ── Packet omissions ───────────────────────────────────────────────────────────────────────

test("a triangle glyph on a silent frame fails closed (omission: alertGlyphsWhileNormal)", () => {
  assertRejects(
    (m) => { m.counted[10].count = 1 },
    /triangle glyph.*reintroduces omission alertGlyphsWhileNormal/
  )
})

test("a tyre-temperature element fails closed (omission: tyreTemperature)", () => {
  assertRejects((m) => { m.forbidden[0].count = 1 }, /must not be rendered/)
})

test("an RPM numeral element fails closed (omission: rpmNumeral)", () => {
  assertRejects((m) => { m.forbidden[1].count = 1 }, /must not be rendered/)
})

test("a gear-aware shift rescaling marker fails closed (omission: gearAwareShiftScaling)", () => {
  assertRejects((m) => { m.forbidden[2].count = 1 }, /must not be rendered/)
})

test("a status row at app size fails closed (omission: appStatusRowZone)", () => {
  // Simulate app layout but with status row still present
  const entry = RC10_CAPTURE_MATRIX.find((e) => e.state === "silent" && e.size.width === 1024)
  assert.ok(entry)
  // Build minimal valid app metrics then inject the defect
  const m = nativeMetrics("silent")
  m.viewport.width = 1024; m.viewport.height = 600
  m.root = rect(0,0,1024,600)
  m.shell = measured(rect(0,0,1024,600))
  m.canvas = { ...measured(rect(0,0,1024,600)), transform: { a:1,b:0,c:0,d:1,e:0,f:0 } }
  m.dashboardElement = measured(rect(0,0,1024,600))
  m.widget = measured(rect(0,0,1024,600))
  m.dashboard = measured(rect(0,0,1024,600))
  m.layout = "app"; m.compactMode = null
  m.contentWidth = "1024"; m.contentHeight = "600"
  m.nativeSize = null
  const gZ=rect(0,0,1024,150), sZ=rect(0,150,1024,150), dZ=rect(0,300,1024,150), fZ=rect(0,450,1024,150)
  m.zones=[
    {name:"gear", selector:'[data-testid="rc10-gear"]', present:true, display:"block",...measured(gZ)},
    {name:"speed",selector:'[data-testid="rc10-speed"]',present:true, display:"block",...measured(sZ)},
    {name:"delta",selector:'[data-testid="rc10-delta"]',present:true, display:"block",...measured(dZ)},
    {name:"fuel", selector:'[data-testid="rc10-fuel"]', present:true, display:"block",...measured(fZ)}
  ]
  m.values=[
    value("gear",    '[data-testid="rc10-gear-value"]', "4",    rect(10,10,120,130), 240),
    value("speed",   '[data-testid="rc10-speed-value"]',"187",  rect(10,160,200,120),180),
    value("delta",   '[data-testid="rc10-delta-value"]',"-0.284",rect(10,310,240,130),102.19),
    value("fuel",    '[data-testid="rc10-fuel-value"]', "8.4",  rect(10,460,120,80), 88),
    value("position",'[data-testid="rc10-position"]',  "7",    rect(10,540,80,36),  44),
    value("water",   '[data-testid="rc10-water"]',      "92",   rect(100,540,80,36), 44),
    value("tc",      '[data-testid="rc10-tc"]',         "3",    rect(190,540,80,36), 44)
  ]
  m.containment=[
    owned("gear value",   gZ,rect(10,10,120,130)),
    owned("shift bar",    gZ,rect(140,10,600,80)),
    owned("speed value",  sZ,rect(10,160,200,120)),
    owned("delta value",  dZ,rect(10,310,240,130)),
    owned("delta pattern",dZ,rect(260,310,300,100)),
    owned("fuel value",   fZ,rect(10,460,120,80)),
    owned("fuel bar",     fZ,rect(140,460,500,80))
  ]
  m.fuelScope=[{left:0,top:450,width:1024,height:150}]
  // Inject the defect: status row present at app size
  m.counted[4].count = 1  // status row = 1 (must be 0 at app)
  m.counted[5].count = 1  // plain line
  m.counted[6].count = 1  // plain headline
  m.plainCarried = "position,water,tc"
  m.plainHeadline = "FUEL OK - PUSH"

  assert.throws(
    () => validateCaptureMetrics(m, entry),
    (error) => {
      assert.ok(error instanceof CaptureSafetyError)
      assert.match(error.message, /appStatusRowZone/)
      return true
    }
  )
})

// ── Modifier / state mismatches ────────────────────────────────────────────────────────────

test("a modifier that disagrees with the measured content box fails closed", () => {
  assertRejects((m) => { m.layout = "app" }, /layout modifier app does not match/)
  assertRejects((m) => { m.contentHeight = "481" }, /did not report its measured content box/)
  assertRejects((m) => { m.nativeSize = null }, /native content-box modifier/)
})

test("a wrong preset or widget id fails closed", () => {
  assertRejects((m) => { m.presetId = "racecon_rc09_dash" }, /did not resolve the unmodified/)
  assertRejects((m) => { m.renderedWidgetId = "raceconRc09Dash" }, /did not resolve the unmodified/)
})

test("a non-accepted buffer state fails closed", () => {
  assertRejects((m) => { m.bufferState = "duplicate" }, /accepted live frame/)
})

test("a wrong capture state fails closed", () => {
  assertRejects((m) => { m.captureState = "fuel-low" }, /rendered the fuel-low scenario/)
})

test("silent state with active alerts fails closed", () => {
  assertRejects((m) => { m.stateAttributes.alerts = "active" }, /silent state must publish data-rc10-alerts/)
  assertRejects((m) => { m.stateAttributes["alert-keys"] = "FUEL LOW" }, /silent state must publish empty alert-keys/)
  assertRejects((m) => { m.counted[10].count = 1 }, /triangle glyph.*reintroduces omission alertGlyphsWhileNormal/)
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
  const x0 = Math.round(box.left), y0 = Math.round(box.top)
  const x1 = Math.round(box.left + box.width), y1 = Math.round(box.top + box.height)
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

// The fuel tile rect that owns the amber scope
const FUEL_RECT = { left: 0, top: 348, width: 800, height: 116 }

function capturePng(state, {
  blank          = false,
  missingBlue    = false,
  missingGreen   = false,
  strayRed       = false,
  amberOutside   = false,
  amberDensity   = null   // null → use state default; number → percentage override
} = {}) {
  const size  = CAPTURE_SIZES[0]
  const image = paintPng(size, CANVAS_RGB)
  if (!blank) {
    if (!missingBlue)  fillRect(image, { left: 100, top: 116, width: 500, height: 80 }, BLUE_RGB)
    if (!missingGreen) fillRect(image, { left: 100, top: 10, width: 400, height: 80 }, GREEN_RGB)
    // Amber in the fuel tile at appropriate density
    const area    = FUEL_RECT.width * FUEL_RECT.height
    const density = amberDensity !== null ? amberDensity
      : (state === "fuel-low" ? RC10_FUEL_TILE_AMBER_ENGAGED_CEILING * 0.5   // ~1.8% — under ceiling
                               : RC10_FUEL_TILE_AMBER_RESTING_FLOOR   * 1.5)  // ~6% — over floor
    const pixels  = Math.ceil(area * density)
    const fillW   = Math.min(FUEL_RECT.width, Math.ceil(Math.sqrt(pixels * (FUEL_RECT.width / FUEL_RECT.height))))
    const fillH   = Math.ceil(pixels / fillW)
    fillRect(image, { left: FUEL_RECT.left + 2, top: FUEL_RECT.top + 2, width: fillW, height: fillH }, AMBER_RGB)
  }
  if (strayRed)     fillRect(image, { left: 2, top: 2, width: 8, height: 8 }, RED_RGB)
  if (amberOutside) fillRect(image, { left: 2, top: 2, width: 30, height: 30 }, AMBER_RGB)
  return PNG.sync.write(image)
}

test("the pixel audit accepts silent and fuel-low frames (blue + green present, no red, amber scoped)", () => {
  for (const state of ["silent", "fuel-low"]) {
    const entry   = nativeEntry(state)
    const metrics = nativeMetrics(state)
    const audit   = validateCapturePixels(capturePng(state), entry, metrics)
    assert.ok(audit.hueFamilies.blue   > 0, `blue expected on ${state} frame`)
    assert.ok(audit.hueFamilies.green  > 0, `green expected on ${state} frame`)
    assert.equal(audit.hueFamilies.red, 0,  `no red on ${state} frame`)
    assert.equal(audit.amberOutsideFuelTile, 0, `amber must not leave the fuel tile on ${state}`)
  }
})

test("a blank frame fails closed", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { blank: true }), nativeEntry("silent"), nativeMetrics("silent")),
    /capture is blank/
  )
})

test("a red pixel fails closed (no Okabe-Ito token is in the red family)", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { strayRed: true }), nativeEntry("silent"), nativeMetrics("silent")),
    /must be absent/
  )
})

test("a frame without info blue fails closed", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { missingBlue: true }), nativeEntry("silent"), nativeMetrics("silent")),
    /must be painted/
  )
})

test("a frame without normal green fails closed", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { missingGreen: true }), nativeEntry("silent"), nativeMetrics("silent")),
    /must be painted/
  )
})

test("amber OUTSIDE the fuel tile fails closed (scope check)", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { amberOutside: true }), nativeEntry("silent"), nativeMetrics("silent")),
    /fall outside/
  )
})

test("a silent frame with fuel-bar density BELOW the resting floor fails closed", () => {
  // Force density = 0 (no amber in tile) while state = silent → below 4% floor
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { amberDensity: 0 }), nativeEntry("silent"), nativeMetrics("silent")),
    /engaged floor|resting floor/
  )
})

test("a fuel-low frame with fuel-bar density ABOVE the engaged ceiling fails closed", () => {
  // Force density = 10% while state = fuel-low → above 3.6% ceiling
  assert.throws(
    () => validateCapturePixels(capturePng("fuel-low", { amberDensity: 0.1 }), nativeEntry("fuel-low"), nativeMetrics("fuel-low")),
    /resting ceiling/
  )
})

test("missing fuelScope fails closed", () => {
  const buf     = capturePng("silent")
  const metrics = nativeMetrics("silent")
  metrics.fuelScope = []
  assert.throws(
    () => validateCapturePixels(buf, nativeEntry("silent"), metrics),
    /fuel tile rectangle/
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
