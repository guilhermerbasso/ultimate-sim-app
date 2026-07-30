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
  RC14_CANVAS_RGBA,
  RC14_CAPTURE_MATRIX,
  RC14_CAUTION_HEX,
  RC14_CORNER_COUNT,
  RC14_DANGER_HEX,
  RC14_FAULT_ROW_COUNT,
  RC14_MONITORED_SOURCE_COUNT,
  RC14_MONITORED_SYSTEM_COUNT,
  RC14_MONITORED_ZONE_COUNT,
  RC14_NORMAL_HEX,
  RC14_SIGNATURE_HEX,
  RC14_SPEC,
  RC14_UNMONITORED_GREEN_CEILING,
  RC14_UNMONITORED_SYSTEM_LABELS,
  RC14_UNMONITORED_ZONE_COUNT,
  RC14_VITAL_COUNT,
  RC14_ZONE_COUNT,
  validateCaptureMetrics,
  validateCapturePixels
} from "./racecon-rc14-capture-lib.mjs"

function temporaryDirectory() {
  return mkdtempSync(join(tmpdir(), "racecon-rc14-capture-test-"))
}

// RC-14 canvas: #0D0F12 = rgb(13, 15, 18)
const CANVAS_RGB = [13, 15, 18]
// Normal green: #46C86E = rgb(70, 200, 110) → green family
const GREEN_RGB  = [70, 200, 110]
// Danger red: #FF3E30 = rgb(255, 62, 48) → red family
const RED_RGB    = [255, 62, 48]
// Caution amber: #FFA82E = rgb(255, 168, 46) → amber family
const AMBER_RGB  = [255, 168, 46]
// Neutral gray for non-canvas, non-alerting content
const GRAY_RGB   = [128, 128, 128]

function rect(left, top, width, height) {
  return { left, top, width, height }
}

function measured(box) {
  return { ...box, layoutWidth: box.width, layoutHeight: box.height, scrollWidth: box.width, scrollHeight: box.height }
}

function zone(name, box, display = "block") {
  return { name, selector: `[data-testid="rc14-panel-${name}"]`, present: true, display, ...measured(box) }
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
    color: "rgb(230, 241, 248)",
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
 * Zone states for the eight silhouette zones.
 *
 * Monitored: engine, electrical
 * Unmonitored: aero, gearbox, cornerLf, cornerRf, cornerLr, cornerRr
 */
function makeZoneStates(overrides = {}) {
  const unmonitoredIds = ["aero", "gearbox", "cornerLf", "cornerRf", "cornerLr", "cornerRr"]
  const monitoredIds   = ["engine", "electrical"]
  const states = [
    ...monitoredIds.map((id) => ({
      id,
      monitored: true,
      severity: "ok",
      token: "normal",
      pattern: "solid"
    })),
    ...unmonitoredIds.map((id) => ({
      id,
      monitored: false,
      severity: "unmonitored",
      token: "secondary",
      pattern: "outline"
    }))
  ]
  for (const [id, patch] of Object.entries(overrides)) {
    const z = states.find((s) => s.id === id)
    if (z) Object.assign(z, patch)
  }
  return states
}

/**
 * Rects for the six unmonitored zones, used for the pixel density audit.
 */
function unmonitoredZoneRects() {
  return [
    rect(120, 60,  80, 60),   // aero
    rect(210, 60,  80, 60),   // gearbox
    rect(120, 130, 40, 60),   // cornerLf
    rect(250, 130, 40, 60),   // cornerRf
    rect(120, 200, 40, 60),   // cornerLr
    rect(250, 200, 40, 60)    // cornerRr
  ]
}

/**
 * Rects for the "critical fault" red surfaces (critical-fault state only).
 * ENGINE zone, critical fault row in the fault list, and PIT decision element.
 */
function redScopeRects() {
  return [
    rect(120, 60, 80, 60),    // engine zone on silhouette
    rect(300, 50, 300, 50),   // fault row for ENGINE
    rect(350, 150, 200, 60)   // PIT decision element
  ]
}

/**
 * Native 800×480 zone layout for RC-14.
 *
 * Three main zones (always present): faultList, carSilhouette, vitalsColumn.
 */
function nativeZones() {
  const faultListBox    = rect(0,   0, 300, 480)
  const silhouetteBox   = rect(300, 0, 200, 480)
  const vitalsColBox    = rect(500, 0, 300, 480)
  return { faultListBox, silhouetteBox, vitalsColBox }
}

/**
 * Synthetic RC-14 metrics for the native 800×480 viewport.
 *
 * Type-scale (native 800x480):
 *   decision word 40 px > fault chip 19 px > corner head 12 px
 *   vital value 40 px == decision word 40 px ✓ (equality holds at native)
 */
function nativeMetrics(state = "silent") {
  const size = CAPTURE_SIZES[0]   // 800×480
  const cf = state === "critical-fault"
  const { faultListBox, silhouetteBox, vitalsColBox } = nativeZones()

  const decisionWordBox    = rect(vitalsColBox.left + 4, vitalsColBox.top + 4, 200, 40)
  const vitalValueBox      = rect(vitalsColBox.left + 4, vitalsColBox.top + 50, 140, 40)
  const faultChipBox       = rect(faultListBox.left + 200, faultListBox.top + 10, 80, 19)
  const cornerHeadBox      = rect(vitalsColBox.left + 4, vitalsColBox.top + 200, 80, 12)
  const cornerBrakeBox     = rect(vitalsColBox.left + 4, vitalsColBox.top + 220, 80, 12)
  const cornerPressureBox  = rect(vitalsColBox.left + 4, vitalsColBox.top + 250, 80, 12)

  const unmonitRects = unmonitoredZoneRects()

  // For critical-fault: provide red scope rects
  const redRects = cf ? redScopeRects() : []

  // Fault system names (only monitored systems)
  const faultSystemNames = ["ENGINE", "ELECTRICAL", "CHASSIS"]

  // Chip words
  const faultChipWords = cf ? ["CRITICAL", "OK", "OK"] : ["OK", "OK", "OK"]

  const leafTexts = [
    cf ? "PIT" : "CONTINUE",       // decision word
    "480 kPa",                      // oil pressure vital
    "89°C",                         // water temp vital
    "13.8 V",                       // battery vital
    "108°C",                        // oil temp vital
    ...(cf ? ["CRITICAL", "OK", "OK"] : ["OK", "OK", "OK"]),  // fault chips
    "LF", "RF", "LR", "RR",         // corner heads
    "486", "471", "362", "358",     // corner brakes
    "2.1", "2.1", "2.0", "2.0",    // corner pressures
    "FAULT MAP",                     // silhouette panel title
    "FAULTS",                        // fault list panel title
    "VITALS",                        // vitals column title
    "6 ZONES NO SOURCE",             // unmonitored notice
    "NO ZONE",                       // CHASSIS nozone
    "ENGINE", "ELECTRICAL", "CHASSIS" // fault system names
  ]
  const rootText = leafTexts.join("")

  return {
    viewport: { width: size.width, height: size.height, dpr: 1 },
    page: { scrollWidth: size.width, clientWidth: size.width },
    root: rect(0, 0, size.width, size.height),
    shell: measured(rect(0, 0, size.width, size.height)),
    canvas: { ...measured(rect(0, 0, size.width, size.height)), transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
    dashboardElement: measured(rect(0, 0, size.width, size.height)),
    widget: measured(rect(0, 0, size.width, size.height)),
    dashboard: measured(rect(0, 0, size.width, size.height)),
    presetId: RC14_SPEC.presetId,
    expectedWidgetId: RC14_SPEC.widgetId,
    renderedWidgetId: RC14_SPEC.widgetId,
    dashboardWidth: "1024",
    dashboardHeight: "600",
    sourceKind: "live-telemetry",
    sourceIdentity: RC14_SPEC.sourceIdentity,
    captureState: state,
    captureSequence: "200",
    layout: "native",
    compactMode: null,
    bufferState: "accepted",
    contentWidth: String(size.width),
    contentHeight: String(size.height),
    stateAttributes: {
      alerts:              cf ? "active" : "silent",
      decision:            cf ? "PIT" : "CONTINUE",
      "monitored-systems": String(RC14_MONITORED_SYSTEM_COUNT),
      "monitored-sources": String(RC14_MONITORED_SOURCE_COUNT)
    },
    zones: [
      zone("faultList",    faultListBox),
      zone("carSilhouette",silhouetteBox),
      zone("vitalsColumn", vitalsColBox)
    ],
    values: [
      value("decision word", '[data-testid="rc14-decision-word"]',  cf ? "PIT" : "CONTINUE", decisionWordBox, 40),
      value("vital value",   '[data-testid="rc14-vital-value"]',    "480 kPa",                vitalValueBox,  40),
      value("fault chip",    '[data-testid="rc14-fault-chip"]',     cf ? "CRITICAL" : "OK",  faultChipBox,   19),
      value("corner head",   '[data-testid="rc14-corner-head"]',    "LF",                     cornerHeadBox,  12),
      value("corner brake",  '[data-testid="rc14-corner-brake"]',   "486",                    cornerBrakeBox, 12),
      value("corner pressure",'[data-testid="rc14-corner-pressure"]',"2.1",                  cornerPressureBox, 12)
    ],
    containment: [],
    forbidden: RC14_SPEC.forbidden.map(([label, selector]) => ({ label, selector, count: 0 })),
    counted: [
      counted("zone",                  '[data-testid="rc14-zone"]',                  RC14_ZONE_COUNT),
      counted("vital",                 '[data-testid="rc14-vital"]',                 RC14_VITAL_COUNT),
      counted("fault-row",             '[data-testid="rc14-fault-row"]',             RC14_FAULT_ROW_COUNT),
      counted("fault-chip",            '[data-testid="rc14-fault-chip"]',            RC14_FAULT_ROW_COUNT),
      counted("fault-ack",             '[data-testid="rc14-fault-ack"]',             cf ? 1 : 0),
      counted("fault-nozone",          '[data-testid="rc14-fault-nozone"]',          1),
      counted("fault-empty",           '[data-testid="rc14-fault-empty"]',           0),
      counted("corner-head",           '[data-testid="rc14-corner-head"]',           RC14_CORNER_COUNT),
      counted("corner-brake",          '[data-testid="rc14-corner-brake"]',          RC14_CORNER_COUNT),
      counted("corner-pressure",       '[data-testid="rc14-corner-pressure"]',       RC14_CORNER_COUNT),
      counted("decision",              '[data-testid="rc14-decision"]',              1),
      counted("unmonitored-notice",    '[data-testid="rc14-unmonitored-notice"]',    1),
      counted("panel-faultTimeline",   '[data-testid="rc14-panel-faultTimeline"]',   0),   // native: not app
      counted("panel-decisionCorners", '[data-testid="rc14-panel-decisionCorners"]', 0),   // native: not app
      counted("panel-decisionBanner",  '[data-testid="rc14-panel-decisionBanner"]',  1),   // native: non-app
      counted("panel-cornerStatus",    '[data-testid="rc14-panel-cornerStatus"]',    1),   // native: non-app
      counted("timeline-empty",        '[data-testid="rc14-timeline-empty"]',        0),   // native: not app
      counted("timeline-mark",         '[data-testid="rc14-timeline-mark"]',         0)    // native: not app
    ],
    textOutputs: [
      cf ? "PIT" : "CONTINUE",
      "480 kPa", "89°C", "13.8 V", "108°C",
      ...(cf ? ["CRITICAL", "OK", "OK"] : ["OK", "OK", "OK"]),
      "486", "471", "362", "358",
      "2.1", "2.1", "2.0", "2.0"
    ],
    leafTexts,
    overflowLeaves: [],
    rootText,
    errorBoundaryCount: 0,
    unknownWidgetCount: 0,
    failures:      [],
    pageErrors:    [],
    consoleErrors: [],
    // RC-14 specific fields
    zoneStates: makeZoneStates(),
    silhouetteZonesAttr:      String(RC14_ZONE_COUNT),
    silhouetteUnmonitoredAttr: String(RC14_UNMONITORED_ZONE_COUNT),
    unmonitoredNoticeText:    "6 ZONES NO SOURCE",
    faultSystemNames,
    faultChipWords,
    oilTempVitalAlerting:     "false",
    unmonitoredZoneRects:     unmonitRects,
    redScopeRects:            redRects
  }
}

function nativeEntry(state = "silent") {
  return RC14_CAPTURE_MATRIX.find((e) => e.state === state && e.size.width === 800)
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

// ── Matrix ──────────────────────────────────────────────────────────────────────────────────

test("the governed RC-14 matrix covers every viewport in every governed state", () => {
  assert.equal(CAPTURE_SIZES.length, 6)
  assert.deepEqual([...CAPTURE_STATES], ["silent", "critical-fault"])
  assert.equal(RC14_CAPTURE_MATRIX.length, CAPTURE_SIZES.length * CAPTURE_STATES.length)
  for (const entry of RC14_CAPTURE_MATRIX) {
    assert.equal(entry.size.layout, expectedLayoutForBox(entry.size.width, entry.size.height))
    assert.equal(entry.size.compactMode, expectedCompactModeForBox(entry.size.width, entry.size.height))
  }
  const cf = RC14_CAPTURE_MATRIX.filter((e) => e.state === "critical-fault")
  assert.equal(cf.length, 6)
  for (const entry of cf) {
    assert.deepEqual(entry.required[0], ["alerts", "active"])
    assert.deepEqual(entry.required[1], ["decision", "PIT"])
  }
  const silent = RC14_CAPTURE_MATRIX.filter((e) => e.state === "silent")
  for (const entry of silent) assert.deepEqual(entry.required[0], ["alerts", "silent"])
})

// ── Hue families ────────────────────────────────────────────────────────────────────────────

test("RC-14 colour tokens classify to the expected hue families", () => {
  assert.equal(hueFamilyOfHex(RC14_DANGER_HEX),    "red")    // #FF3E30
  assert.equal(hueFamilyOfHex(RC14_CAUTION_HEX),   "amber")  // #FFA82E
  assert.equal(hueFamilyOfHex(RC14_NORMAL_HEX),    "green")  // #46C86E
  assert.equal(hueFamilyOfHex(RC14_SIGNATURE_HEX), "cyan")   // #6EE7FF
})

// ── Happy-path validations ───────────────────────────────────────────────────────────────────

test("a faithful native silent fixture validates and reports its type scale", () => {
  const audit = validateCaptureMetrics(nativeMetrics("silent"), nativeEntry("silent"))
  assert.deepEqual(audit.knownDefects, [])
  assert.deepEqual(audit.typeRankDefects, [])
  assert.ok(audit.typeScale.length >= 3)
  assert.equal(audit.typeScale[0].label, "decision word")
  assert.equal(audit.typeScale[0].fontSize, 40)
})

test("a faithful native critical-fault fixture validates with the alert and decision present", () => {
  const audit = validateCaptureMetrics(nativeMetrics("critical-fault"), nativeEntry("critical-fault"))
  // The ENGINE system overflow is recorded at 800x480 in critical-fault
  // (knownDefects is empty unless overflowLeaves has entries matching the ledger)
  assert.deepEqual(audit.typeRankDefects, [])
  // alerts=silent in critical-fault state fails
  assertRejects(
    (m) => { m.stateAttributes.alerts = "silent" },
    /critical-fault must publish data-rc14-alerts="active"/,
    "critical-fault"
  )
  // wrong decision fails
  assertRejects(
    (m) => { m.stateAttributes.decision = "CONTINUE" },
    /critical-fault must publish data-rc14-decision="PIT"/,
    "critical-fault"
  )
})

// ── THE HEADLINE ASSERTION — unmonitored zones must not be ok-green ──────────────────────────

test("an unmonitored zone with token='normal' is rejected (omission: unmonitoredVersusOk)", () => {
  assertRejects(
    (m) => { m.zoneStates[2].token = "normal" },   // aero zone (index 2) set to normal
    /unmonitored zone "aero" must publish token="secondary".*normal.*must never appear/
  )
})

test("an unmonitored zone with severity='ok' is rejected (omission: unmonitoredVersusOk)", () => {
  assertRejects(
    (m) => { m.zoneStates[3].severity = "ok" },   // gearbox zone
    /unmonitored zone "gearbox" must publish severity="unmonitored"|unmonitored must never be confused with ok/
  )
})

test("an unmonitored zone with pattern='solid' is rejected (omission: unmonitoredVersusOk)", () => {
  assertRejects(
    (m) => { m.zoneStates[4].pattern = "solid" },   // cornerLf
    /unmonitored zone "cornerLf" must publish pattern="outline"/
  )
})

test("a monitored zone with unmonitored markers is rejected", () => {
  assertRejects(
    (m) => { m.zoneStates[0].severity = "unmonitored" },  // engine zone
    /monitored zone "engine" must not carry unmonitored markers/
  )
})

// ── Silhouette panel counts ──────────────────────────────────────────────────────────────────

test("wrong total zone count fails closed", () => {
  assertRejects((m) => { m.counted[0].count = 7 }, /exactly 8 silhouette zones must be rendered/)
})

test("wrong unmonitored zone count fails closed", () => {
  assertRejects(
    (m) => {
      // Change one unmonitored zone to monitored
      m.zoneStates[2].monitored = true
      m.zoneStates[2].severity = "ok"
      m.zoneStates[2].token = "normal"
    },
    /exactly 6 zones must publish monitored="false"/
  )
})

test("wrong silhouetteZonesAttr fails closed", () => {
  assertRejects(
    (m) => { m.silhouetteZonesAttr = "7" },
    /rc14-panel-carSilhouette must publish data-rc14-zones="8"/
  )
})

test("wrong unmonitored notice text fails closed", () => {
  assertRejects(
    (m) => { m.unmonitoredNoticeText = "5 ZONES NO SOURCE" },
    /unmonitored notice must read "6 ZONES NO SOURCE"/
  )
})

// ── Fault list assertions ────────────────────────────────────────────────────────────────────

test("wrong fault row count fails closed (unmonitored systems must never produce a row)", () => {
  assertRejects(
    (m) => { m.counted[2].count = 4 },   // 4 rows instead of 3
    /fault row count must be 3/
  )
})

test("an unmonitored system label in the fault list fails closed (omission: perZoneDamageChannel)", () => {
  assertRejects(
    (m) => { m.faultSystemNames.push("GEARBOX") },
    /fault list must not contain system "GEARBOX"/
  )
  assertRejects(
    (m) => { m.faultSystemNames.push("FRONT AERO") },
    /fault list must not contain system "FRONT AERO"/
  )
})

test("a fault row for CORNER LF fails closed", () => {
  assertRejects(
    (m) => { m.faultSystemNames.push("CORNER LF") },
    /fault list must not contain system "CORNER LF"/
  )
})

test("the oil-temp vital must never be alerting (omission: vitalRangeThresholds)", () => {
  assertRejects(
    (m) => { m.oilTempVitalAlerting = "true" },
    /oilTemp vital must always publish data-rc14-vital-alerting="false"/
  )
})

test("fewer or more than 6 unmonitored zones fails closed", () => {
  // 5 unmonitored zones
  assertRejects(
    (m) => { m.zoneStates[2].monitored = true ; m.zoneStates[2].severity = "ok" ; m.zoneStates[2].token = "normal" },
    /exactly 6 zones must publish monitored="false"/
  )
})

// ── Type-scale — declared equality at four viewports ─────────────────────────────────────────

test("vital-value == decision-word equality is enforced at native 800x480 (NOT in defect waiver)", () => {
  assertRejects(
    (m) => { m.values[1].fontSize = 36 },   // vital != decision (40 px) at native
    /type-scale: vital value .* must equal decision word/
  )
})

test("vital-value == decision-word equality is enforced at 1024x600 (NOT in defect waiver)", () => {
  const appEntry = RC14_CAPTURE_MATRIX.find((e) => e.state === "silent" && e.size.width === 1024)
  const m = nativeMetrics("silent")
  m.viewport  = { width: 1024, height: 600, dpr: 1 }
  m.page      = { scrollWidth: 1024, clientWidth: 1024 }
  m.root      = rect(0, 0, 1024, 600)
  m.shell     = measured(rect(0, 0, 1024, 600))
  m.canvas    = { ...measured(rect(0, 0, 1024, 600)), transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } }
  m.dashboardElement = measured(rect(0, 0, 1024, 600))
  m.widget    = measured(rect(0, 0, 1024, 600))
  m.dashboard = measured(rect(0, 0, 1024, 600))
  m.contentWidth  = "1024"
  m.contentHeight = "600"
  m.layout    = "app"
  m.compactMode = null
  // Adjust layout-conditional zone counts for app
  m.counted[12].count = 1  // panel-faultTimeline
  m.counted[13].count = 1  // panel-decisionCorners
  m.counted[14].count = 0  // panel-decisionBanner (absent at app)
  m.counted[15].count = 0  // panel-cornerStatus (absent at app)
  m.counted[16].count = 1  // timeline-empty (silent + app)
  m.counted[17].count = 0  // timeline-mark (silent)
  // Adjust value sizes for app (51.2 cqw)
  m.values[0].fontSize = 51.2   // decision word
  m.values[1].fontSize = 48.0   // vital value ≠ decision word at app (beyond 0.5 px tolerance)
  m.values[2].fontSize = 24.32  // fault chip
  m.values[3].fontSize = 15.36  // corner head
  m.values[4].fontSize = 15.36  // corner brake
  m.values[5].fontSize = 15.36  // corner pressure
  // Rebuild zones for app size
  const appFL  = rect(0,   0, 380, 600)
  const appSil = rect(380, 0, 250, 600)
  const appVC  = rect(630, 0, 394, 600)
  m.zones = [
    { name: "faultList",    selector: '[data-testid="rc14-panel-faultList"]',    present: true, display: "block", ...measured(appFL) },
    { name: "carSilhouette",selector: '[data-testid="rc14-panel-carSilhouette"]',present: true, display: "block", ...measured(appSil) },
    { name: "vitalsColumn", selector: '[data-testid="rc14-panel-vitalsColumn"]', present: true, display: "block", ...measured(appVC) }
  ]
  assert.throws(
    () => validateCaptureMetrics(m, appEntry),
    (error) => {
      assert.ok(error instanceof CaptureSafetyError)
      assert.match(error.message, /type-scale: vital value .* must equal decision word/)
      return true
    }
  )
})

test("vital-value != decision-word divergence at compact-landscape is accepted (DEFECT RC-14/2)", () => {
  const entry759 = RC14_CAPTURE_MATRIX.find((e) => e.state === "silent" && e.size.width === 759)
  const m = nativeMetrics("silent")
  m.viewport  = { width: 759, height: 393, dpr: 1 }
  m.page      = { scrollWidth: 759, clientWidth: 759 }
  m.root      = rect(0, 0, 759, 393)
  m.shell     = measured(rect(0, 0, 759, 393))
  m.canvas    = { ...measured(rect(0, 0, 759, 393)), transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } }
  m.dashboardElement = measured(rect(0, 0, 759, 393))
  m.widget    = measured(rect(0, 0, 759, 393))
  m.dashboard = measured(rect(0, 0, 759, 393))
  m.contentWidth  = "759"
  m.contentHeight = "393"
  m.layout    = "compact"
  m.compactMode = "landscape"
  m.counted[12].count = 0  // panel-faultTimeline (not app)
  m.counted[13].count = 0  // panel-decisionCorners (not app)
  m.counted[14].count = 1  // panel-decisionBanner (non-app)
  m.counted[15].count = 1  // panel-cornerStatus (non-app)
  m.counted[16].count = 0  // timeline-empty (not app)
  m.counted[17].count = 0  // timeline-mark (not app)
  // DEFECT RC-14/2: vital 23.53 vs decision 27.32 at 759x393
  m.values[0].fontSize = 27.32  // decision word
  m.values[1].fontSize = 23.53  // vital value — smaller than decision → waived at 759x393
  m.values[2].fontSize = 18.03  // fault chip
  m.values[3].fontSize = 11.38  // corner head
  m.values[4].fontSize = 11.38
  m.values[5].fontSize = 11.38
  const clFL  = rect(0, 0, 240, 393)
  const clSil = rect(240, 0, 160, 393)
  const clVC  = rect(400, 0, 359, 393)
  m.zones = [
    { name: "faultList",    selector: '[data-testid="rc14-panel-faultList"]',    present: true, display: "block", ...measured(clFL) },
    { name: "carSilhouette",selector: '[data-testid="rc14-panel-carSilhouette"]',present: true, display: "block", ...measured(clSil) },
    { name: "vitalsColumn", selector: '[data-testid="rc14-panel-vitalsColumn"]', present: true, display: "block", ...measured(clVC) }
  ]
  const audit = validateCaptureMetrics(m, entry759)
  assert.equal(audit.typeRankDefects.length, 1)
  assert.equal(audit.typeRankDefects[0].label, "vital value equal decision word")
})

test("vital-value EXCEEDING decision-word at compact-landscape is rejected (inversion past recorded defect)", () => {
  const entry759 = RC14_CAPTURE_MATRIX.find((e) => e.state === "silent" && e.size.width === 759)
  const m = nativeMetrics("silent")
  m.viewport  = { width: 759, height: 393, dpr: 1 }
  m.page      = { scrollWidth: 759, clientWidth: 759 }
  m.root      = rect(0, 0, 759, 393)
  m.shell     = measured(rect(0, 0, 759, 393))
  m.canvas    = { ...measured(rect(0, 0, 759, 393)), transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } }
  m.dashboardElement = measured(rect(0, 0, 759, 393))
  m.widget    = measured(rect(0, 0, 759, 393))
  m.dashboard = measured(rect(0, 0, 759, 393))
  m.contentWidth  = "759"
  m.contentHeight = "393"
  m.layout    = "compact"
  m.compactMode = "landscape"
  m.counted[12].count = 0 ; m.counted[13].count = 0 ; m.counted[14].count = 1 ; m.counted[15].count = 1
  m.counted[16].count = 0 ; m.counted[17].count = 0
  // INVERSION: vital > decision
  m.values[0].fontSize = 23.53  // decision word (smaller)
  m.values[1].fontSize = 27.32  // vital value > decision word → REJECTED
  m.values[2].fontSize = 18.03
  m.values[3].fontSize = 11.38
  m.values[4].fontSize = 11.38
  m.values[5].fontSize = 11.38
  const clFL  = rect(0, 0, 240, 393)
  const clSil = rect(240, 0, 160, 393)
  const clVC  = rect(400, 0, 359, 393)
  m.zones = [
    { name: "faultList",    selector: '[data-testid="rc14-panel-faultList"]',    present: true, display: "block", ...measured(clFL) },
    { name: "carSilhouette",selector: '[data-testid="rc14-panel-carSilhouette"]',present: true, display: "block", ...measured(clSil) },
    { name: "vitalsColumn", selector: '[data-testid="rc14-panel-vitalsColumn"]', present: true, display: "block", ...measured(clVC) }
  ]
  assert.throws(
    () => validateCaptureMetrics(m, entry759),
    (error) => {
      assert.ok(error instanceof CaptureSafetyError)
      assert.match(error.message, /vital value .* exceeds decision word|inverts the rank/)
      return true
    }
  )
})

// ── Omissions ────────────────────────────────────────────────────────────────────────────────

test("a Speed or Delta surface present fails closed (omission: speedAndDeltaZones)", () => {
  assertRejects((m) => { m.forbidden[0].count = 1 }, /speed or delta surface.*must not be rendered/)
})

test("a systems-detail panel present fails closed (omission: systemsDetailPanel)", () => {
  assertRejects((m) => { m.forbidden[1].count = 1 }, /systems-detail panel.*must not be rendered/)
})

// ── Modifier / state mismatches ──────────────────────────────────────────────────────────────

test("a wrong viewport / content-box modifier fails closed", () => {
  assertRejects((m) => { m.layout = "app" },       /layout modifier app does not match/)
  assertRejects((m) => { m.contentWidth = "801" },  /did not report its measured content box/)
})

test("a wrong preset or widget id fails closed", () => {
  assertRejects((m) => { m.presetId = "wrong_preset" }, /did not resolve the unmodified racecon_rc14_dash preset/)
})

test("a wrong capture state fails closed", () => {
  assertRejects((m) => { m.captureState = "critical-fault" }, /rendered the critical-fault scenario while capturing silent/)
})

test("a non-accepted buffer state fails closed", () => {
  assertRejects((m) => { m.bufferState = "stale" }, /accepted live frame/)
})

// ── Overflow ledger ──────────────────────────────────────────────────────────────────────────

test("unrecorded overflow fails and recorded ENGINE overflow within budget is accepted", () => {
  // Unrecorded overflow → rejected
  assertRejects(
    (m) => {
      m.overflowLeaves = [
        { key: "rc14-vital-label", text: "OIL PRESSURE", fontSize: 12, whiteSpace: "nowrap",
          clientWidth: 60, scrollWidth: 90, overflowX: 30, textLeft: 10, textRight: 100 }
      ]
    },
    /paints 30px wider than its 60px box/
  )
})

test("DEFECT RC-14/1: ENGINE fault-system overflow within budget is accepted at 800x480 critical-fault", () => {
  const cfEntry = nativeEntry("critical-fault")
  const m = nativeMetrics("critical-fault")
  // +73 px overflow within budget (90 px)
  m.overflowLeaves = [
    { key: "rc14-fault-system", text: "ENGINE", fontSize: 16, whiteSpace: "nowrap",
      clientWidth: 0, scrollWidth: 73, overflowX: 73, textLeft: 300, textRight: 373 }
  ]
  assert.doesNotThrow(() => validateCaptureMetrics(m, cfEntry))
  // Overflow past budget → rejected
  m.overflowLeaves[0].overflowX = 91
  m.overflowLeaves[0].scrollWidth = 91
  assert.throws(
    () => validateCaptureMetrics(m, cfEntry),
    (error) => {
      assert.ok(error instanceof CaptureSafetyError)
      assert.match(error.message, /overflows by 91px, past the 90px/)
      return true
    }
  )
})

// ── Pixel audit ──────────────────────────────────────────────────────────────────────────────

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
  const x0 = Math.round(box.left)
  const y0 = Math.round(box.top)
  const x1 = Math.round(box.left + box.width)
  const y1 = Math.round(box.top + box.height)
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

/**
 * Synthetic RC-14 capture PNG.
 *
 * Both states: canvas + gray content + green (ELECTRICAL ok zone + OK chips).
 * critical-fault: additionally paint red inside the permitted scope rects.
 * strayRed: inject a red pixel outside any scope (tests scoped/absent checks).
 * strayAmber: inject an amber pixel (must always be absent).
 * greenInUnmonitored: fill the unmonitored zone rects with green (should exceed density ceiling).
 */
function capturePng(state, { strayRed = false, strayAmber = false, blank = false, greenInUnmonitored = false } = {}) {
  const size = CAPTURE_SIZES[0]
  const image = paintPng(size, CANVAS_RGB)

  if (!blank) {
    // Gray base content
    fillRect(image, rect(10, 10, 200, 200), GRAY_RGB)
    // Green: ELECTRICAL ok zone + OK chips (always present on every frame)
    fillRect(image, rect(380, 80, 80, 80), GREEN_RGB)   // ELECTRICAL zone area
    fillRect(image, rect(500, 10, 40, 19), GREEN_RGB)   // OK fault chips
  }

  const cf = state === "critical-fault"
  if (cf && !blank) {
    // Red inside the permitted scope (engine zone + fault row + decision)
    for (const r of redScopeRects()) {
      fillRect(image, r, RED_RGB)
    }
  }

  if (strayRed) {
    // Red pixel outside any permitted scope
    fillRect(image, rect(2, 2, 8, 8), RED_RGB)
  }

  if (strayAmber) {
    fillRect(image, rect(50, 50, 8, 8), AMBER_RGB)
  }

  if (greenInUnmonitored) {
    // Fill all 6 unmonitored zone rects with green — density far above ceiling
    for (const r of unmonitoredZoneRects()) {
      fillRect(image, r, GREEN_RGB)
    }
  }

  return PNG.sync.write(image)
}

function metricsForPixel(state) {
  const m = nativeMetrics(state)
  m.unmonitoredZoneRects = unmonitoredZoneRects()
  if (state === "critical-fault") {
    m.redScopeRects = redScopeRects()
  }
  return m
}

test("pixel audit accepts silent (no red, no amber, green present) and critical-fault (red scoped) frames", () => {
  // Silent: no red, no amber, green present
  const silentAudit = validateCapturePixels(capturePng("silent"), nativeEntry("silent"), metricsForPixel("silent"))
  assert.equal(silentAudit.hueFamilies.red, 0)
  assert.equal(silentAudit.hueFamilies.amber, 0)
  assert.ok(silentAudit.hueFamilies.green > 0, "green must be present on every frame")
  // Critical-fault: red present and scoped
  const cfAudit = validateCapturePixels(capturePng("critical-fault"), nativeEntry("critical-fault"), metricsForPixel("critical-fault"))
  assert.ok(cfAudit.hueFamilies.red > 0, "red must be present on the critical-fault frame")
  assert.equal(cfAudit.hueFamilies.amber, 0)
  assert.ok(cfAudit.hueFamilies.green > 0, "green must be present on the critical-fault frame")
})

test("a blank frame fails closed", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { blank: true }), nativeEntry("silent"), metricsForPixel("silent")),
    /capture is blank/
  )
})

test("red present on a SILENT frame is rejected", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { strayRed: true }), nativeEntry("silent"), metricsForPixel("silent")),
    /must be absent/
  )
})

test("red absent on a CRITICAL-FAULT frame is rejected", () => {
  const size = CAPTURE_SIZES[0]
  const image = paintPng(size, CANVAS_RGB)
  // No red — only green and gray
  fillRect(image, rect(10, 10, 200, 200), GRAY_RGB)
  fillRect(image, rect(380, 80, 80, 80), GREEN_RGB)
  const buffer = PNG.sync.write(image)
  assert.throws(
    () => validateCapturePixels(buffer, nativeEntry("critical-fault"), metricsForPixel("critical-fault")),
    /must be painted/
  )
})

test("red outside the critical fault scope is rejected on a CRITICAL-FAULT frame", () => {
  // strayRed places a red pixel at (2,2) — outside any permitted scope rect
  assert.throws(
    () => validateCapturePixels(capturePng("critical-fault", { strayRed: true }), nativeEntry("critical-fault"), metricsForPixel("critical-fault")),
    /fall outside/
  )
})

test("any AMBER pixel is rejected on every RC-14 frame (no minor fault triggered)", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { strayAmber: true }), nativeEntry("silent"), metricsForPixel("silent")),
    /must be absent/
  )
  assert.throws(
    () => validateCapturePixels(capturePng("critical-fault", { strayAmber: true }), nativeEntry("critical-fault"), metricsForPixel("critical-fault")),
    /must be absent/
  )
})

test("one of the six unmonitored zones painted ok-green is rejected (headline assertion)", () => {
  // The pixel density inside the unmonitored zone union must stay below the 0.5% ceiling.
  // greenInUnmonitored fills all 6 rects with green — well above ceiling.
  assert.throws(
    () => validateCapturePixels(
      capturePng("silent", { greenInUnmonitored: true }),
      nativeEntry("silent"),
      metricsForPixel("silent")
    ),
    (error) => {
      assert.ok(error instanceof CaptureSafetyError)
      assert.match(error.message, /resting ceiling|outline-only zones must never carry the normal|ceiling 0.5%/)
      return true
    }
  )
})

test("headline assertion: green pixel-density ceiling inside unmonitored zone union rejects a frame where those zones are filled green", () => {
  // Same assertion exercised via the raw audit helpers to prove the mechanism
  const size = CAPTURE_SIZES[0]
  const image = paintPng(size, CANVAS_RGB)
  // Fill all unmonitored rects with green
  for (const r of unmonitoredZoneRects()) fillRect(image, r, GREEN_RGB)
  // Also add some green elsewhere to keep the frame non-blank
  fillRect(image, rect(380, 80, 80, 80), GREEN_RGB)

  const greenFamily = hueFamilyOfHex(RC14_NORMAL_HEX)
  const decoded = decodeCapturePng(PNG.sync.write(image), size)
  const density = hueFamilyDensityInRects(decoded, greenFamily, unmonitoredZoneRects())

  assert.ok(density.density > RC14_UNMONITORED_GREEN_CEILING,
    `green density inside unmonitored zones (${(density.density * 100).toFixed(4)}%) must exceed ceiling ` +
    `${(RC14_UNMONITORED_GREEN_CEILING * 100).toFixed(4)}% to confirm the test is effective`)
})

// ── Shared safety primitives ─────────────────────────────────────────────────────────────────

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
