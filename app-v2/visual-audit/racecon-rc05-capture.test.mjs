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
import { expectedCompactModeForBox, expectedLayoutForBox, hueFamily, hueFamilyOfHex,
  assertHueFamilyAbsent, assertHueFamilyPresent, assertHueFamilyScoped, assertZoneContainment,
  auditHueFamilies, auditOverflowLeaves, decodeCapturePng } from "./racecon-capture-shared.mjs"
import {
  CAPTURE_SIZES,
  CAPTURE_STATES,
  RC05_CAPTURE_MATRIX,
  RC05_CORNER_COUNT,
  RC05_DANGER_HEX,
  RC05_LF_CORNER_ZOOM_ESCAPE_BUDGET_PX,
  RC05_MIN_ALERT_PIXELS,
  RC05_PRESSURE_BAND_COUNT,
  RC05_PRESSURE_MARK_COUNT,
  RC05_PRESSURE_RING_COUNT,
  RC05_SPEC,
  RC05_TREND_ROW_COUNT,
  RC05_WINDOW_TICK_COUNT,
  validateCaptureMetrics,
  validateCapturePixels
} from "./racecon-rc05-capture-lib.mjs"

function temporaryDirectory() {
  return mkdtempSync(join(tmpdir(), "racecon-rc05-capture-test-"))
}

// Palette used in synthetic PNG fixtures
const CANVAS_RGB = [13, 11, 10]    // #0D0B0A — RC-05 background
// Coral (#FF6A3D) has hue ≈13.9° — below the 15° red/amber boundary in the shared classifier.
// It is red-family, not amber. Do NOT include it in synthetic test PNGs: it would invalidate
// the "no red on silent" primitive tests. Real captures do paint it on every frame.
const CORAL_RGB = [255, 106, 61]   // #FF6A3D — red-family (hue ≈13.9°); excluded from synthetics
const CYAN_RGB = [56, 176, 214]    // #38B0D6 — cold arc (cyan family, always present)
const GREEN_RGB = [76, 201, 138]   // #4CC98A — window band (green family, always present)
const DANGER_RGB = [240, 74, 50]   // #F04A32 — danger red (alert only)

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
 * Mirrors the packet §11.1 native grammar, keeping every zone non-overlapping except the
 * mandala/delta pair (which is a packet-declared overlap and is exempted in the spec).
 * Zones deliberately use the percentage positions from the contract report scaled to 800×480.
 */
function nativeZones(size) {
  const px = (fraction, extent) => Math.round(fraction * extent)
  return [
    // mandala bbox: spans the corner columns (18.8–81.3% × 12.5–87.4%)
    zone("mandala",  rect(px(0.188, size.width), px(0.125, size.height), px(0.625, size.width), px(0.749, size.height))),
    // delta sits in the gap between left and right corner pairs (42.5–57.5% × 41.7–58.4%)
    zone("delta",    rect(px(0.425, size.width), px(0.417, size.height), px(0.150, size.width), px(0.167, size.height))),
    zone("aids",     rect(px(0.02,  size.width), px(0.125, size.height), px(0.150, size.width), px(0.750, size.height))),
    zone("legend",   rect(px(0.83,  size.width), px(0.410, size.height), px(0.150, size.width), px(0.465, size.height))),
    // trend and pressures are in the DOM but CSS-hidden in native layout (Omission 2)
    zone("trend",    rect(0, 0, 0, 0), "none"),
    zone("pressures",rect(0, 0, 0, 0), "none"),
    zone("peripheral",rect(px(0.02, size.width), px(0.89, size.height), px(0.96, size.width), px(0.09, size.height)))
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
    color: "rgb(251, 239, 233)",
    display: "block"
  }
}

function owned(label, owner, valueBox) {
  return { label, owner, ownerDisplay: "block", value: valueBox, valueDisplay: "block" }
}

function counted(label, selector, count) {
  return { label, selector, count }
}

function corner(id, band, overheat, zoom, box = rect(0, 0, 40, 40)) {
  return {
    id,
    band,
    pressureBand: id === "RR" ? "unknown" : "window",
    overheat,
    cold: "false",
    pressureAlert: "none",
    zoom,
    rect: measured(box)
  }
}

/**
 * A complete, self-consistent RC-05 metric fixture at the native canvas. Every geometric value
 * mirrors the packet grammar encoded in the stylesheet, so a mutation of one field is the
 * only reason a validation can fail.
 */
function nativeMetrics(state = "silent") {
  const size = CAPTURE_SIZES[0]
  const zones = nativeZones(size)
  const mandalaZone = zones[0]
  const deltaZone = zones[1]
  const aidsZone = zones[2]
  const peripheralZone = zones[6]
  const alarming = state === "corner-overheat"

  // Corner gauge articles live inside the mandala zone
  const lfBox   = rect(mandalaZone.left + 10,  mandalaZone.top + 10,  140, 130)
  const rfBox   = rect(mandalaZone.left + 330, mandalaZone.top + 10,  140, 130)
  // Bottom pair: offset chosen so lrBox.bottom = mandalaZone.top + 210 + 140 = 410 < mandala.bottom(420)
  const lrBox   = rect(mandalaZone.left + 10,  mandalaZone.top + 210, 140, 140)
  const rrBox   = rect(mandalaZone.left + 330, mandalaZone.top + 210, 140, 140)

  // Small boxes inside each corner for the type-scale samples
  const tempFontSize     = 48
  const deltaFontSize    = 36
  const pressureFontSize = 22
  const labelFontSize    = 13

  const deltaBox     = rect(deltaZone.left + 4, deltaZone.top + 10, deltaZone.width - 8, 36)
  const gearBox      = rect(peripheralZone.left + 10, peripheralZone.top + 4, 60, 36)
  const speedBox     = rect(peripheralZone.left + 90, peripheralZone.top + 4, 90, 36)
  const fuelLapsBox  = rect(peripheralZone.left + 200, peripheralZone.top + 4, 100, 36)
  const tcBox        = rect(aidsZone.left + 4, aidsZone.top + 20, aidsZone.width - 8, 30)
  const brakeFBox    = rect(aidsZone.left + 4, aidsZone.top + 80, aidsZone.width - 8, 30)
  const brakeRBox    = rect(aidsZone.left + 4, aidsZone.top + 140, aidsZone.width - 8, 30)

  return {
    viewport: { width: size.width, height: size.height, dpr: 1 },
    page: { scrollWidth: size.width, clientWidth: size.width },
    root: rect(0, 0, size.width, size.height),
    shell: measured(rect(0, 0, size.width, size.height)),
    canvas: { ...measured(rect(0, 0, size.width, size.height)), transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
    dashboardElement: measured(rect(0, 0, size.width, size.height)),
    widget: measured(rect(0, 0, size.width, size.height)),
    dashboard: measured(rect(0, 0, size.width, size.height)),
    presetId: RC05_SPEC.presetId,
    expectedWidgetId: RC05_SPEC.widgetId,
    renderedWidgetId: RC05_SPEC.widgetId,
    dashboardWidth: "1024",
    dashboardHeight: "600",
    sourceKind: "live-telemetry",
    sourceIdentity: RC05_SPEC.sourceIdentity,
    captureState: state,
    captureSequence: "120",
    layout: "native",
    compactMode: null,
    bufferState: "accepted",
    contentWidth: String(size.width),
    contentHeight: String(size.height),
    stateAttributes: {
      emphasis: "temperature",
      alerts: alarming ? "active" : "silent",
      "alert-corners": alarming ? "LF" : "",
      trend: "measured"
    },
    zones,
    values: [
      value("lf-temp",      'article[data-rc05-corner="LF"] output.rc05-temp',      alarming ? "107" : "88",  rect(lfBox.left + 10, lfBox.top + 10,  60, 50), tempFontSize),
      value("rf-temp",      'article[data-rc05-corner="RF"] output.rc05-temp',      "94",  rect(rfBox.left + 10, rfBox.top + 10,  60, 50), tempFontSize),
      value("lr-temp",      'article[data-rc05-corner="LR"] output.rc05-temp',      "85",  rect(lrBox.left + 10, lrBox.top + 10,  60, 50), tempFontSize),
      value("rr-temp",      'article[data-rc05-corner="RR"] output.rc05-temp',      "86",  rect(rrBox.left + 10, rrBox.top + 10,  60, 50), tempFontSize),
      value("lf-pressure",  'article[data-rc05-corner="LF"] output.rc05-pressure',  "1.93",rect(lfBox.left + 10, lfBox.top + 70,  50, 22), pressureFontSize),
      value("rf-pressure",  'article[data-rc05-corner="RF"] output.rc05-pressure',  "1.97",rect(rfBox.left + 10, rfBox.top + 70,  50, 22), pressureFontSize),
      value("lr-pressure",  'article[data-rc05-corner="LR"] output.rc05-pressure',  "1.90",rect(lrBox.left + 10, lrBox.top + 70,  50, 22), pressureFontSize),
      value("rr-pressure",  'article[data-rc05-corner="RR"] output.rc05-pressure',  "--",  rect(rrBox.left + 10, rrBox.top + 70,  50, 22), pressureFontSize),
      value("delta",        ".rc05-delta-value",                                    "+0.137", deltaBox,  deltaFontSize),
      value("tc",           'div[data-rc05-zone="tc"] output.rc05-value',           "5",   tcBox,     labelFontSize + 4),
      value("brake-f",      'div[data-rc05-zone="brake-f"] output.rc05-value',      "412", brakeFBox, labelFontSize + 4),
      value("brake-r",      'div[data-rc05-zone="brake-r"] output.rc05-value',      "388", brakeRBox, labelFontSize + 4),
      value("gear",         'div[data-rc05-zone="gear"] output.rc05-value',         "4",   gearBox,   labelFontSize + 4),
      value("speed",        'div[data-rc05-zone="speed"] output.rc05-value',        "178", speedBox,  labelFontSize + 4),
      value("fuel-laps",    'div[data-rc05-zone="fuel-laps"] output.rc05-value',    "14.8",fuelLapsBox, labelFontSize + 4),
      value("corner-label", '[data-testid="rc05-corner-label"]',                    "LF",  rect(lfBox.left + 4, lfBox.top + 2, 20, 14), labelFontSize)
    ],
    containment: [
      owned("LF corner",      mandalaZone, lfBox),
      owned("RF corner",      mandalaZone, rfBox),
      owned("LR corner",      mandalaZone, lrBox),
      owned("RR corner",      mandalaZone, rrBox),
      owned("TC readout",     aidsZone,    tcBox),
      owned("brake-F readout",aidsZone,    brakeFBox),
      owned("brake-R readout",aidsZone,    brakeRBox),
      owned("gear readout",   peripheralZone, gearBox),
      owned("speed readout",  peripheralZone, speedBox),
      owned("fuel-laps readout", peripheralZone, fuelLapsBox)
    ],
    forbidden: RC05_SPEC.forbidden.map(([label, selector]) => ({ label, selector, count: 0 })),
    counted: [
      counted("corner",       '[data-testid="rc05-corner"]',        RC05_CORNER_COUNT),
      counted("corner-label", '[data-testid="rc05-corner-label"]',  RC05_CORNER_COUNT),
      counted("gauge",        '[data-testid="rc05-gauge"]',          RC05_CORNER_COUNT),
      counted("window-band",  '[data-testid="rc05-window-band"]',    RC05_CORNER_COUNT),
      counted("window-tick",  '[data-testid="rc05-window-tick"]',    RC05_WINDOW_TICK_COUNT),
      counted("pressure-ring",'[data-testid="rc05-pressure-ring"]', RC05_PRESSURE_RING_COUNT),
      counted("pointer",      '[data-testid="rc05-pointer"]',        RC05_CORNER_COUNT),
      counted("pressure-band",'[data-testid="rc05-pressure-band"]', RC05_PRESSURE_BAND_COUNT),
      counted("pressure-mark",'[data-testid="rc05-pressure-mark"]', RC05_PRESSURE_MARK_COUNT),
      counted("trend-row",    '[data-testid="rc05-trend-row"]',      RC05_TREND_ROW_COUNT),
      counted("alert-line",   '[data-testid="rc05-alert-line"]',     alarming ? 1 : 0)
    ],
    textOutputs: ["88", "94", "85", "86", "1.93", "1.97", "1.90", "--", "+0.137", "5", "412", "388", "4", "178", "14.8", "18"],
    leafTexts: ["LF", "RF", "LR", "RR", "+0.137", "5", "178", "4", "14.8", "18", "TEMP"],
    overflowLeaves: [],
    rootText: "LF88RF94LR85RR86+0.1371.931.971.905412412388388417814.818TEMP",
    errorBoundaryCount: 0,
    unknownWidgetCount: 0,
    failures: [],
    pageErrors: [],
    consoleErrors: [],
    nativeSize: "800x480",
    // Corner attributes
    corners: [
      corner("LF", alarming ? "hot" : "window", alarming ? "true" : "false", alarming ? "true" : "false", rect(150, 60, 180, 150)),
      corner("RF", "window", "false", "false", rect(470, 60, 180, 150)),
      corner("LR", "window", "false", "false", rect(150, 270, 180, 150)),
      corner("RR", "window", "false", "false", rect(470, 270, 180, 150))
    ],
    deltaTone: "bad",
    alertLinePresent: alarming,
    alertLineText: alarming ? "LF OVERHEAT" : null,
    // Alert line rect must be inside the mandala zone for scope containment check
    alertLineRect: alarming ? rect(mandalaZone.left + 20, mandalaZone.top + 20, 120, 22) : null,
    wearPresent: true,
    wearText: "18",
    trendDisplay: "none",
    pressuresDisplay: "none",
    softKeyText: "TEMP",
    alertScope: rect(150, 60, 180, 150),  // LF corner bounding box
    legendRect: rect(664, 197, 120, 223)
  }
}

function nativeEntry(state = "silent") {
  return RC05_CAPTURE_MATRIX.find((entry) => entry.state === state && entry.size.width === 800)
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

/* ── Tests ───────────────────────────────────────────────────────────────────────────── */

test("the governed matrix covers every viewport in every governed state", () => {
  assert.equal(CAPTURE_SIZES.length, 6)
  assert.deepEqual([...CAPTURE_STATES], ["silent", "corner-overheat"])
  assert.equal(RC05_CAPTURE_MATRIX.length, CAPTURE_SIZES.length * CAPTURE_STATES.length)
  for (const entry of RC05_CAPTURE_MATRIX) {
    assert.equal(entry.size.layout, expectedLayoutForBox(entry.size.width, entry.size.height))
    assert.equal(entry.size.compactMode, expectedCompactModeForBox(entry.size.width, entry.size.height))
  }
  // The overheat scenario may only be captured once the widget has published the latch.
  const alarming = RC05_CAPTURE_MATRIX.filter((entry) => entry.state === "corner-overheat")
  assert.equal(alarming.length, 6)
  for (const entry of alarming) {
    assert.deepEqual(entry.required[0], ["alerts", "active"])
    assert.deepEqual(entry.required[1], ["alert-corners", "LF"])
  }
})

test("hue families correctly separate the RC-05 palette", () => {
  // Coral (#FF6A3D): RGB gives hue = 60×(106-61)/(255-61) ≈ 13.9°, which is BELOW the 15°
  // red/amber boundary. Coral is therefore red-family, not amber as the contract report claims.
  // This is why validateCapturePixels does not assert "red absent from silent" on real captures.
  assert.equal(hueFamilyOfHex("#FF6A3D"), "red")
  // Danger red (#F04A32): red family — alert-only surfaces.
  assert.equal(hueFamilyOfHex("#F04A32"), "red")
  // Caution amber (#F2A03D): amber family — delta bad-tone text.
  assert.equal(hueFamilyOfHex("#F2A03D"), "amber")
  // Window-band green (#4CC98A): green family.
  assert.equal(hueFamilyOfHex("#4CC98A"), "green")
  // Cold-arc cyan (#38B0D6): cyan family.
  assert.equal(hueFamilyOfHex("#38B0D6"), "cyan")

  // Verify with RGB components:
  assert.equal(hueFamily(...CORAL_RGB),  "red")     // coral arc: red-family (hue ≈13.9°)
  assert.equal(hueFamily(...DANGER_RGB), "red")      // danger surface: red-family
  assert.equal(hueFamily(...CYAN_RGB),   "cyan")
  assert.equal(hueFamily(...GREEN_RGB),  "green")
  assert.equal(hueFamily(...CANVAS_RGB), "neutral")  // near-black canvas
})

test("a faithful native fixture validates and reports its type scale", () => {
  const audit = validateCaptureMetrics(nativeMetrics(), nativeEntry())
  assert.deepEqual(audit.knownDefects, [])
  // Type-scale order: temp > delta > pressure > corner-label
  assert.deepEqual(audit.typeScale, [
    { label: "lf-temp",     fontSize: 48 },
    { label: "delta",       fontSize: 36 },
    { label: "lf-pressure", fontSize: 22 },
    { label: "corner-label",fontSize: 13 }
  ])
})

test("the overheat fixture validates only with its alert surfaces present", () => {
  validateCaptureMetrics(nativeMetrics("corner-overheat"), nativeEntry("corner-overheat"))
  // Alert line must be present in the overheat scenario
  assertRejects((metrics) => { metrics.counted[10].count = 0 }, /alert line must be present exactly once/u, "corner-overheat")
  // Alert-corners must name LF
  assertRejects((metrics) => { metrics.stateAttributes["alert-corners"] = "" }, /alert-corners must be "LF"/u, "corner-overheat")
  // The LF corner must report overheat
  assertRejects((metrics) => { metrics.corners[0].overheat = "false" }, /LF corner reports overheat=false/u, "corner-overheat")
  // The alert line text must match
  assertRejects((metrics) => { metrics.alertLineText = "RF OVERHEAT" }, /instead of the LF overheat alert/u, "corner-overheat")
})

test("a tie anywhere in the type scale is a failure, not a pass", () => {
  // delta tied with lf-temp
  assertRejects((metrics) => { metrics.values[0].fontSize = 36 }, /type-scale hierarchy does not hold/u)
  // pressure tied with delta
  assertRejects((metrics) => { metrics.values[4].fontSize = 36 }, /type-scale hierarchy does not hold/u)
  // label tied with pressure
  assertRejects((metrics) => { metrics.values[15].fontSize = 22 }, /type-scale hierarchy does not hold/u)
})

test("overlapping zones fail closed while the packet-declared mandala/* overlaps do not", () => {
  // A genuine overlap between two non-exempted zones must fail
  assertRejects((metrics) => { metrics.zones[2].top = metrics.zones[6].top }, /zone aids overlaps peripheral/u)
  // In the native 800×480 layout the mandala section is the full-viewport wrapper, so it
  // overlaps every other visible zone. The fixture uses a synthetic (non-full-width) mandala
  // rect that overlaps only delta (to exercise the exemption mechanism cheaply). Real captures
  // rely on the full exemption list in RC05_SPEC.
  const metrics = nativeMetrics()
  assert.ok(metrics.zones[0].left < metrics.zones[1].left + metrics.zones[1].width,
    "mandala and delta must geometrically overlap in the test fixture to validate the exemption")
  validateCaptureMetrics(metrics, nativeEntry())
})

test("an element that escapes its zone or the frame fails closed", () => {
  // A corner escaping the mandala zone
  assertRejects(
    (metrics) => { metrics.containment[0].value = rect(0, 0, 900, 130) },
    /LF corner escapes its zone/u
  )
  // A zone painted out of frame
  assertRejects((metrics) => { metrics.zones[6].top = 475 }, /peripheral is out of frame/u)
  // A value painted outside the root
  assertRejects(
    (metrics) => { metrics.values[0].rect = measured(rect(760, 10, 90, 50)) },
    /lf-temp value is not contained/u
  )
})

test("LF corner overheat zoom escape within budget passes; past budget fails closed", () => {
  // The escape is recorded in RC05_SPEC.containmentDefects for every viewport EXCEPT the native
  // canvas, where the mandala fills the frame and no escape is geometrically possible.
  const metrics = nativeMetrics("corner-overheat")
  const entry = nativeEntry("corner-overheat")
  validateCaptureMetrics(metrics, entry)
  metrics.containment = metrics.containment.map((c) =>
    c.label === "LF corner" ? { ...c, value: { ...c.value, left: c.owner.left - 3 } } : c
  )
  assert.throws(() => validateCaptureMetrics(metrics, entry), /LF corner escapes its zone on the left/u)

  // At the recorded viewports the escape is audited against its measured budget rather than
  // exempted: within budget it is reported, past budget it still fails.
  const recorded = { size: { width: 1024, height: 600, layout: "app", compactMode: null }, state: "corner-overheat" }
  const owner = { left: 100, top: 100, width: 200, height: 200 }
  const escaped = (by) => [
    {
      label: "LF corner",
      owner,
      ownerDisplay: "block",
      value: { left: owner.left - by, top: owner.top, width: owner.width, height: owner.height }
    }
  ]
  const within = assertZoneContainment(escaped(5), 0.5, RC05_SPEC.containmentDefects, recorded)
  assert.equal(within.length, 1)
  assert.equal(within[0].escapePx, 5)
  assert.throws(
    () => assertZoneContainment(escaped(RC05_LF_CORNER_ZOOM_ESCAPE_BUDGET_PX + 3), 0.5, RC05_SPEC.containmentDefects, recorded),
    /past the 9px recorded/u
  )
})

test("an unrecorded overflow fails; a recorded one is reported and its budget enforced", () => {
  // An unrecorded overflow on any leaf fails closed
  assertRejects(
    (metrics) => {
      metrics.overflowLeaves = [
        { key: "rc05-value rc05-temp", text: "88", fontSize: 48, whiteSpace: "nowrap", clientWidth: 60, scrollWidth: 90, overflowX: 30, textLeft: 10, textRight: 100 }
      ]
    },
    /paints 30px wider than its 60px box/u
  )
  // A recorded overflow within budget: auditOverflowLeaves returns the ledger entry
  const appEntry = RC05_CAPTURE_MATRIX.find((e) => e.size.width === 1024 && e.state === "silent")
  const inBudgetLeaf = { key: "rc05-label", text: "SPEED", fontSize: 15, whiteSpace: "nowrap",
    clientWidth: 23, scrollWidth: 42, overflowX: 19, textLeft: 427.45, textRight: 470.69 }
  const ledger = auditOverflowLeaves({ overflowLeaves: [inBudgetLeaf] }, appEntry, RC05_SPEC.knownDefects)
  assert.equal(ledger.length, 1)
  assert.equal(ledger[0].key, "rc05-label")
  assert.equal(ledger[0].overflowX, 19)
  // A recorded overflow that grew past its budget fails closed
  const overBudgetLeaf = { key: "rc05-label", text: "SPEED", fontSize: 15, whiteSpace: "nowrap",
    clientWidth: 23, scrollWidth: 44, overflowX: 21, textLeft: 427.45, textRight: 471.69 }
  assert.throws(
    () => auditOverflowLeaves({ overflowLeaves: [overBudgetLeaf] }, appEntry, RC05_SPEC.knownDefects),
    /overflows by 21px, past the 20px recorded/u
  )
})

test("a reintroduced packet omission fails closed (Omission 1: shift/RPM)", () => {
  // Forbidden selector: shift LED or rev indicator
  assertRejects((metrics) => { metrics.forbidden[0].count = 1 }, /shift LED or rev indicator must not be rendered/u)
  // Forbidden leaf text: SHIFT
  assertRejects((metrics) => { metrics.leafTexts.push("SHIFT") }, /renders "SHIFT" as a readout/u)
  // Forbidden leaf text: RPM
  assertRejects((metrics) => { metrics.leafTexts.push("RPM") }, /renders "RPM" as a readout/u)
})

test("documented omission 6 (RR no TPMS) must not be flagged as a missing element failure", () => {
  // RR pressure shows '--'; the count of pressure-band and pressure-mark must be 3 (not 4)
  const metrics = nativeMetrics()
  assert.equal(metrics.counted.find((c) => c.label === "pressure-band").count, RC05_PRESSURE_BAND_COUNT)
  assert.equal(metrics.counted.find((c) => c.label === "pressure-mark").count, RC05_PRESSURE_MARK_COUNT)
  assert.equal(metrics.values.find((v) => v.label === "rr-pressure").text, "--")
  // The valid fixture passes despite the RR gaps
  validateCaptureMetrics(metrics, nativeEntry())
  // But if RR pressure-band count rises to 4, that is a reintroduction of the omission
  assertRejects((metrics) => { metrics.counted[7].count = 4 }, /pressure-band arcs \(RR is absent/u)
})

test("wrong modifier and wrong buffer state fail closed", () => {
  assertRejects((metrics) => { metrics.layout = "app" }, /layout modifier app does not match/u)
  assertRejects((metrics) => { metrics.contentWidth = "801" }, /did not report its measured content box/u)
  assertRejects((metrics) => { metrics.nativeSize = null }, /native content-box modifier/u)
  assertRejects((metrics) => { metrics.bufferState = "duplicate" }, /accepted live frame/u)
  assertRejects((metrics) => { metrics.sourceIdentity = "acc:session:1:connection:1" }, /deterministic connected live telemetry/u)
})

test("wrong emphasis or wrong alerts modifier fails closed", () => {
  assertRejects((metrics) => { metrics.stateAttributes.emphasis = "pressure" }, /RC-05 must rest on temperature emphasis/u)
  assertRejects((metrics) => { metrics.stateAttributes.alerts = "active" }, /alerts must be silent/u)
  assertRejects((metrics) => { metrics.stateAttributes.trend = "pending" }, /trend must be 'measured'/u)
})

/* ── PNG pixel audit tests ───────────────────────────────────────────────────────────── */

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

function fill(image, box, rgb) {
  for (let y = Math.round(box.top); y < Math.round(box.top + box.height); y += 1) {
    for (let x = Math.round(box.left); x < Math.round(box.left + box.width); x += 1) {
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
    // Synthetic PNGs intentionally exclude coral (#FF6A3D) because coral is red-family
    // (hue ≈13.9° < 15° threshold) and would corrupt the absent-red primitive tests.
    // Real renders do paint coral on every frame, which is why validateCapturePixels
    // does not assert "red absent from silent" on live captures.
    fill(image, rect(160, 160, 80, 40), CYAN_RGB)
    fill(image, rect(240, 160, 80, 40), GREEN_RGB)
  }
  if (state === "corner-overheat") {
    // Danger red confined to the LF corner scope
    const scope = nativeMetrics("corner-overheat").corners[0].rect
    fill(image, rect(scope.left + 4, scope.top + 4, 80, 40), DANGER_RGB)
    if (strayDanger) {
      // A stray patch outside every element that owns the red hue family.
      fill(image, rect(40, 440, 8, 8), DANGER_RGB)
    }
  }
  return PNG.sync.write(image)
}

test("the silent synthetic PNG confirms the green+cyan colour invariant", () => {
  // capturePng("silent") has cyan + green, no coral (coral is red-family — see comment above)
  const audit = validateCapturePixels(capturePng("silent"), nativeEntry(), nativeMetrics())
  assert.ok(audit.hueFamilies.green > 1_000, "window-band green pixels must be counted")
  assert.ok(audit.hueFamilies.cyan  > 1_000, "cold-arc cyan pixels must be counted")
  assert.equal(audit.gutter, `rgba(${CANVAS_RGB.join(",")},255)`)
})

test("the overheat synthetic PNG must carry danger-red above the minimum threshold", () => {
  const metrics = nativeMetrics("corner-overheat")
  const entry   = nativeEntry("corner-overheat")
  const audit   = validateCapturePixels(capturePng("corner-overheat"), entry, metrics)
  assert.ok(audit.hueFamilies.red >= RC05_MIN_ALERT_PIXELS)
  // The thermal ramp shares the danger hue family, so absence is not assertable on a real
  // capture; containment inside the corner articles, the legend key and the alert banner is.
  assert.equal(audit.alertHueOutsideScope, 0)
  assert.throws(
    () => validateCapturePixels(capturePng("corner-overheat", { strayDanger: true }), entry, metrics),
    /fall outside the elements that own that alert/u
  )
})

test("a blank frame fails closed", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { blank: true }), nativeEntry(), nativeMetrics()),
    /capture is blank/u
  )
})

test("the overheat frame fails closed when the danger hue is entirely missing", () => {
  // Using the no-coral silent PNG for an overheat entry: no danger pixels → fails the present check
  assert.throws(
    () => validateCapturePixels(capturePng("silent"), nativeEntry("corner-overheat"), nativeMetrics("corner-overheat")),
    /the red hue family must be painted/u
  )
})

test("assertHueFamilyAbsent/Present/Scoped primitives work correctly with synthetic PNGs", () => {
  const size = CAPTURE_SIZES[0]
  // A scope rect that simulates the LF corner article area
  const scopeRect = rect(150, 70, 120, 110)

  // Build a clean frame (canvas + cyan + green, no danger, no coral)
  const cleanImage = paint(size, CANVAS_RGB)
  fill(cleanImage, rect(160, 160, 80, 40), CYAN_RGB)
  fill(cleanImage, rect(240, 160, 80, 40), GREEN_RGB)
  const cleanAudit = auditHueFamilies(decodeCapturePng(PNG.sync.write(cleanImage), size), {})

  // ACCEPT: no alert-hue pixels → assertHueFamilyAbsent passes
  assertHueFamilyAbsent(cleanAudit, "red", "clean synthetic frame")

  // REJECT: stray danger pixel on an otherwise-clean frame → assertHueFamilyAbsent fails
  const strayImage = paint(size, CANVAS_RGB)
  fill(strayImage, rect(160, 160, 80, 40), CYAN_RGB)
  fill(strayImage, rect(240, 160, 80, 40), GREEN_RGB)
  fill(strayImage, rect(400, 300, 10, 10), DANGER_RGB)
  const strayAudit = auditHueFamilies(decodeCapturePng(PNG.sync.write(strayImage), size), {})
  assert.throws(
    () => assertHueFamilyAbsent(strayAudit, "red", "frame with stray danger pixel"),
    /the red hue family must be absent/u
  )

  // REJECT: alert frame missing the danger hue → assertHueFamilyPresent fails
  assert.throws(
    () => assertHueFamilyPresent(cleanAudit, "red", "alert frame missing danger", RC05_MIN_ALERT_PIXELS),
    /the red hue family must be painted/u
  )

  // Build a scoped frame: danger confined to scopeRect
  const scopedImage = paint(size, CANVAS_RGB)
  fill(scopedImage, rect(scopeRect.left + 4, scopeRect.top + 4, 60, 40), DANGER_RGB)
  const scopedAudit = auditHueFamilies(decodeCapturePng(PNG.sync.write(scopedImage), size), { red: [scopeRect] })

  // ACCEPT: all danger pixels inside scope → assertHueFamilyScoped passes
  assertHueFamilyScoped(scopedAudit, "red", "scoped alert frame")

  // REJECT: stray danger pixel outside scope → assertHueFamilyScoped fails
  const strayOutsideImage = paint(size, CANVAS_RGB)
  fill(strayOutsideImage, rect(scopeRect.left + 4, scopeRect.top + 4, 60, 40), DANGER_RGB)
  fill(strayOutsideImage, rect(500, 400, 8, 8), DANGER_RGB)  // outside scopeRect
  const strayOutsideAudit = auditHueFamilies(decodeCapturePng(PNG.sync.write(strayOutsideImage), size), { red: [scopeRect] })
  assert.throws(
    () => assertHueFamilyScoped(strayOutsideAudit, "red", "frame with danger outside scope"),
    /fall outside the elements that own that alert/u
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
