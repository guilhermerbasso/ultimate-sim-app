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
  hueFamilyOfHex
} from "./racecon-capture-shared.mjs"
import {
  CAPTURE_SIZES,
  CAPTURE_STATES,
  RC11_APP_PLOT_X0,
  RC11_APP_PLOT_X1,
  RC11_CAPTURE_MATRIX,
  RC11_CANVAS_RGBA,
  RC11_CAUTION_HEX,
  RC11_CURSOR_COUNT,
  RC11_DANGER_HEX,
  RC11_DISTANCE_TICK_COUNT,
  RC11_GG_RING_COUNT,
  RC11_GG_RING_LABEL_COUNT,
  RC11_INFO_HEX,
  RC11_LEGEND_ENTRIES_APP,
  RC11_LEGEND_ENTRIES_NATIVE_COMPACT,
  RC11_MIN_NON_CANVAS_PIXELS,
  RC11_NATIVE_PLOT_X0,
  RC11_NATIVE_PLOT_X1,
  RC11_NORMAL_HEX,
  RC11_PLOT_COUNT,
  RC11_SPEC,
  RC11_TILE_COUNT,
  validateCaptureMetrics,
  validateCapturePixels
} from "./racecon-rc11-capture-lib.mjs"

function temporaryDirectory() {
  return mkdtempSync(join(tmpdir(), "racecon-rc11-capture-test-"))
}

const CANVAS_RGB = [RC11_CANVAS_RGBA[0], RC11_CANVAS_RGBA[1], RC11_CANVAS_RGBA[2]]
const CYAN_RGB   = [79, 195, 247]   // #4FC3F7 — cyan family → always present (speed trace)
const AMBER_RGB  = [255, 179, 0]    // #FFB300 — amber family → must be absent
const RED_RGB    = [239, 83, 80]    // #EF5350 — red family → must be absent
const GREEN_RGB  = [102, 187, 106]  // #66BB6A — green family → must be absent
const BLUE_RGB   = [50, 100, 200]   // blue family; non-canvas but not cyan (for no-cyan test)

function rect(left, top, width, height) {
  return { left, top, width, height }
}

function measured(box) {
  return { ...box, layoutWidth: box.width, layoutHeight: box.height, scrollWidth: box.width, scrollHeight: box.height }
}

function zone(name, box, testId) {
  return { name, selector: `[data-testid="${testId}"]`, present: true, display: "block", ...measured(box) }
}

function value(label, selector, text, box, fontSize) {
  return {
    label, selector, present: true,
    rect: measured(box),
    textRect: box,
    text, fontSize,
    color: "rgb(230, 235, 240)",
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
 * All four plot panels share one x-axis.  At native 800×480 the axis runs from x=70 to x=520 but
 * the measured rect has a 1 px border inset so the measured left/width are 71/448.
 */
function makePlotRects(left = 71, width = 448, x0 = "70", x1 = "520") {
  const panels = ["speed", "inputs", "gear", "delta"]
  return panels.map((panelId, i) => ({
    plotId: panelId,
    left,
    top: i * 60 + 10,
    width,
    height: 40,
    attrX0: x0,
    attrX1: x1
  }))
}

function makeCursorRects(left = 280) {
  const panels = ["speed", "inputs", "gear", "delta"]
  return panels.map((panelId, i) => ({
    panelId,
    left,
    top: i * 60 + 15,
    width: 1,
    height: 30
  }))
}

function nativeMetrics(state = "silent") {
  const size = CAPTURE_SIZES[0]  // 800×480
  const isGap = state === "data-gap"

  const speedZone   = rect(0,    0, 800, 60)
  const inputsZone  = rect(0,   60, 800, 60)
  const gearZone    = rect(0,  120, 800, 60)
  const deltaZone   = rect(0,  180, 800, 60)
  const ggZone      = rect(0,  240, 400, 240)
  const tilesZone   = rect(400, 240, 400, 240)

  const tyreFl    = rect(410, 250, 60, 30)
  const tyreFr    = rect(510, 250, 60, 30)
  const brakeTmp  = rect(620, 250, 60, 30)
  const curSpBox  = rect(200, 15, 60, 24)
  const curDtBox  = rect(200, 195, 60, 24)
  const axisBox   = rect(71, 50, 60, 14)

  return {
    viewport: { width: 800, height: 480, dpr: 1 },
    page: { scrollWidth: 800, clientWidth: 800 },
    root: rect(0, 0, 800, 480),
    shell: measured(rect(0, 0, 800, 480)),
    canvas: { ...measured(rect(0, 0, 800, 480)), transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
    dashboardElement: measured(rect(0, 0, 800, 480)),
    widget: measured(rect(0, 0, 800, 480)),
    dashboard: measured(rect(0, 0, 800, 480)),
    presetId:         RC11_SPEC.presetId,
    expectedWidgetId: RC11_SPEC.widgetId,
    renderedWidgetId: RC11_SPEC.widgetId,
    dashboardWidth:   "1024",
    dashboardHeight:  "600",
    sourceKind:       "live-telemetry",
    sourceIdentity:   RC11_SPEC.sourceIdentity,
    captureState:     state,
    captureSequence:  "200",
    layout:           "native",
    compactMode:      null,
    bufferState:      "accepted",
    contentWidth:     "800",
    contentHeight:    "480",
    stateAttributes: {
      alerts:    isGap ? "active" : "silent",
      reference: "none"
    },
    zones: [
      zone("speed",  speedZone,  "rc11-panel-speed"),
      zone("inputs", inputsZone, "rc11-panel-inputs"),
      zone("gear",   gearZone,   "rc11-panel-gear"),
      zone("delta",  deltaZone,  "rc11-panel-delta"),
      zone("gg",     ggZone,     "rc11-panel-gg"),
      zone("tiles",  tilesZone,  "rc11-panel-tiles")
    ],
    values: [
      value("tile tyreFl",    '[data-testid="rc11-tyreFl"]',       "84",   tyreFl,   28),
      value("cursor speed",   '[data-testid="rc11-cursor-speed"]', "135",  curSpBox, 22),
      value("cursor delta",   '[data-testid="rc11-cursor-delta"]', "-0.4", curDtBox, 22),
      value("tile tyreFr",    '[data-testid="rc11-tyreFr"]',       "87",   tyreFr,   28),
      value("tile brakeTempF",'[data-testid="rc11-brakeTempF"]',   "412",  brakeTmp, 28),
      value("axis label",     '[data-testid="rc11-distance-tick"]',"--",   axisBox,  14)
    ],
    containment: [
      owned("tile tyreFl",    tilesZone, tyreFl),
      owned("tile tyreFr",    tilesZone, tyreFr),
      owned("tile brakeTempF",tilesZone, brakeTmp),
      owned("cursor speed",   speedZone, curSpBox),
      owned("cursor delta",   deltaZone, curDtBox)
    ],
    forbidden: RC11_SPEC.forbidden.map(([label, selector]) => ({ label, selector, count: 0 })),
    counted: [
      counted("plot",               '[data-testid="rc11-plot"]',                                            RC11_PLOT_COUNT),
      counted("cursor",             '[data-testid="rc11-cursor"]',                                          RC11_CURSOR_COUNT),
      counted("distance tick",      '[data-testid="rc11-distance-tick"]',                                   RC11_DISTANCE_TICK_COUNT),
      counted("gg ring",            '[data-testid="rc11-gg-ring"]',                                         RC11_GG_RING_COUNT),
      counted("gg ring label",      '[data-testid="rc11-gg-ring-label"]',                                   RC11_GG_RING_LABEL_COUNT),
      counted("tile",               '[data-testid="rc11-tile"]',                                            RC11_TILE_COUNT),
      counted("sector row",         '[data-testid="rc11-sector-row"]',                                      0),
      counted("sector notice",      '[data-testid="rc11-sector-notice"]',                                   0),
      counted("gap band",           '[data-testid="rc11-gap"]',                                             isGap ? 1 : 0),
      counted("lockup marker",      '[data-testid="rc11-marker"][data-rc11-marker="lockUp"]',               0),
      counted("steering series",    '[data-testid="rc11-panel-inputs"] [data-rc11-series="steering"]',      0),
      counted("speed legend entry", '[data-testid="rc11-legend-speed"] [data-testid="rc11-legend-entry"]',  RC11_LEGEND_ENTRIES_NATIVE_COMPACT),
      counted("inputs legend entry",'[data-testid="rc11-legend-inputs"] [data-testid="rc11-legend-entry"]', RC11_LEGEND_ENTRIES_NATIVE_COMPACT)
    ],
    textOutputs:    ["84", "87", "412"],
    leafTexts:      ["84", "87", "412", "135", "-0.4", "--", "--", "--", "--", "--"],
    overflowLeaves: [],
    rootText:       "8487412135-0.4-----",
    errorBoundaryCount: 0,
    unknownWidgetCount: 0,
    failures:      [],
    pageErrors:    [],
    consoleErrors: [],
    nativeSize:        "800x480",
    plotRects:         makePlotRects(),
    cursorRects:       makeCursorRects(),
    distanceTickTexts: ["--", "--", "--", "--", "--"],
    distanceAxisText:  "DISTANCE",
    sectorPanelPresent: false,
    gapRects: isGap ? [{ channel: "speed", left: 200, top: 10, width: 50, height: 40 }] : []
  }
}

function nativeEntry(state = "silent") {
  return RC11_CAPTURE_MATRIX.find((entry) => entry.state === state && entry.size.width === 800)
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
  assert.deepEqual([...CAPTURE_STATES], ["silent", "data-gap"])
  assert.equal(RC11_CAPTURE_MATRIX.length, CAPTURE_SIZES.length * CAPTURE_STATES.length)
  for (const entry of RC11_CAPTURE_MATRIX) {
    assert.equal(entry.size.layout, expectedLayoutForBox(entry.size.width, entry.size.height))
    assert.equal(entry.size.compactMode, expectedCompactModeForBox(entry.size.width, entry.size.height))
  }
  const gap = RC11_CAPTURE_MATRIX.filter((entry) => entry.state === "data-gap")
  assert.equal(gap.length, 6)
  for (const entry of gap) assert.deepEqual(entry.required[0], ["alerts", "active"])
  const silent = RC11_CAPTURE_MATRIX.filter((entry) => entry.state === "silent")
  for (const entry of silent) assert.deepEqual(entry.required[0], ["alerts", "silent"])
})

// ── Hue families ───────────────────────────────────────────────────────────────────────────

test("RC-11 colour tokens: caution=amber, danger=red, normal=green, info=cyan (all absent except info)", () => {
  assert.equal(hueFamilyOfHex(RC11_CAUTION_HEX), "amber")  // #FFB300
  assert.equal(hueFamilyOfHex(RC11_DANGER_HEX),  "red")    // #EF5350
  assert.equal(hueFamilyOfHex(RC11_NORMAL_HEX),  "green")  // #66BB6A
  assert.equal(hueFamilyOfHex(RC11_INFO_HEX),    "cyan")   // #4FC3F7
})

// ── Happy-path validations ─────────────────────────────────────────────────────────────────

test("a faithful native silent fixture validates and reports type scale", () => {
  const audit = validateCaptureMetrics(nativeMetrics("silent"), nativeEntry("silent"))
  assert.deepEqual(audit.knownDefects, [])
  assert.deepEqual(audit.typeScale, [
    { label: "tile value",    fontSize: 28 },
    { label: "cursor readout",fontSize: 22 },
    { label: "axis label",    fontSize: 14 }
  ])
  assert.ok(audit.sharedAxis)
  assert.equal(audit.sharedAxis.plotLeft, 71)
  assert.equal(audit.sharedAxis.plotWidth, 448)
  assert.equal(audit.sharedAxis.attrX0, "70")
  assert.equal(audit.sharedAxis.attrX1, "520")
  assert.equal(audit.sharedAxis.cursorLeft, 280)
})

test("a faithful native data-gap fixture validates with gap-band geometry", () => {
  const audit = validateCaptureMetrics(nativeMetrics("data-gap"), nativeEntry("data-gap"))
  assert.deepEqual(audit.knownDefects, [])
})

// ── Type scale ─────────────────────────────────────────────────────────────────────────────

test("a tie at any type-scale step is a failure", () => {
  assertRejects((m) => { m.values[0].fontSize = 22 }, /type-scale hierarchy does not hold/)  // tile=cursor
  assertRejects((m) => { m.values[1].fontSize = 14 }, /type-scale hierarchy does not hold/)  // cursor=axis
  assertRejects((m) => { m.values[5].fontSize = 22 }, /type-scale hierarchy does not hold/)  // axis=cursor
})

test("a type-scale inversion is a failure", () => {
  assertRejects((m) => { m.values[0].fontSize = 10 }, /type-scale hierarchy does not hold/)  // tile < cursor
  assertRejects((m) => { m.values[1].fontSize = 8  }, /type-scale hierarchy does not hold/)  // cursor < axis
})

// ── Zone geometry ──────────────────────────────────────────────────────────────────────────

test("overlapping zones fail closed", () => {
  assertRejects((m) => { m.zones[1].top -= 40 }, /zone speed overlaps inputs/)
  assertRejects((m) => { m.zones[2].height = 200 }, /zone gear overlaps/)
})

test("a zone out of frame fails closed", () => {
  assertRejects((m) => { m.zones[5].top = 460 }, /tiles is out of frame/)
})

// ── HEADLINE: shared-plot-axis corruptions ─────────────────────────────────────────────────

test("a different measured left on plot[1] fails closed (shared-axis violation)", () => {
  assertRejects(
    (m) => { m.plotRects[1].left = m.plotRects[0].left + 2 },
    /shared-axis violation: plot\[1\].*left=.*differs from plot\[0\]/
  )
})

test("a different measured width on plot[2] fails closed (shared-axis violation)", () => {
  assertRejects(
    (m) => { m.plotRects[2].width = m.plotRects[0].width + 3 },
    /shared-axis violation: plot\[2\].*width=.*differs from plot\[0\]/
  )
})

test("mismatched data-rc11-plot-x0 on plot[3] fails closed (shared-axis violation)", () => {
  assertRejects(
    (m) => { m.plotRects[3].attrX0 = "75" },
    /shared-axis violation: plot\[3\].*data-rc11-plot-x0.*differs from plot\[0\]/
  )
})

test("wrong native declared axis pair fails closed", () => {
  // All four have matching but wrong values for native
  assertRejects(
    (m) => { for (const p of m.plotRects) { p.attrX0 = "75"; p.attrX1 = "525" } },
    /native shared-axis declaration must be "70"\/"520"/
  )
})

test("wrong app declared axis pair fails at app size", () => {
  const entry = RC11_CAPTURE_MATRIX.find((e) => e.state === "silent" && e.size.width === 1024)
  assert.ok(entry)
  const m = nativeMetrics("silent")
  // Adjust to app size
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
  m.sectorPanelPresent = true
  m.counted[7].count = 1  // sector notice present at app
  m.counted[10].count = 1  // steering series at app
  m.counted[12].count = RC11_LEGEND_ENTRIES_APP  // inputs legend entries at app
  // Use correct app sizes for zones and values (minimal adjustment)
  const sZ=rect(0,0,1024,80), iZ=rect(0,80,1024,80), gZ=rect(0,160,1024,80), dZ=rect(0,240,1024,80), ggZ=rect(0,320,512,280), tZ=rect(512,320,512,280)
  m.zones=[
    zone("speed","sZ","rc11-panel-speed"),
    zone("inputs","iZ","rc11-panel-inputs"),
    zone("gear","gZ","rc11-panel-gear"),
    zone("delta","dZ","rc11-panel-delta"),
    zone("gg","ggZ","rc11-panel-gg"),
    zone("tiles","tZ","rc11-panel-tiles")
  ]
  // Minimal zone fix: override individually to avoid helper-string bug
  m.zones=[
    {name:"speed", selector:'[data-testid="rc11-panel-speed"]',  present:true,display:"block",...measured(sZ)},
    {name:"inputs",selector:'[data-testid="rc11-panel-inputs"]', present:true,display:"block",...measured(iZ)},
    {name:"gear",  selector:'[data-testid="rc11-panel-gear"]',   present:true,display:"block",...measured(gZ)},
    {name:"delta", selector:'[data-testid="rc11-panel-delta"]',  present:true,display:"block",...measured(dZ)},
    {name:"gg",    selector:'[data-testid="rc11-panel-gg"]',     present:true,display:"block",...measured(ggZ)},
    {name:"tiles", selector:'[data-testid="rc11-panel-tiles"]',  present:true,display:"block",...measured(tZ)}
  ]
  const tFl=rect(522,330,60,36), tFr=rect(622,330,60,36), tBt=rect(722,330,60,36)
  const cSp=rect(200,30,70,28),  cDt=rect(200,260,70,28), axB=rect(88,65,70,18)
  m.values=[
    value("tile tyreFl",    '[data-testid="rc11-tyreFl"]',       "84",  tFl, 35.84),
    value("cursor speed",   '[data-testid="rc11-cursor-speed"]', "135", cSp, 28.16),
    value("cursor delta",   '[data-testid="rc11-cursor-delta"]', "-0.4",cDt, 28.16),
    value("tile tyreFr",    '[data-testid="rc11-tyreFr"]',       "87",  tFr, 35.84),
    value("tile brakeTempF",'[data-testid="rc11-brakeTempF"]',   "412", tBt, 35.84),
    value("axis label",     '[data-testid="rc11-distance-tick"]',"--",  axB, 17.92)
  ]
  m.containment=[
    owned("tile tyreFl",    tZ, tFl),
    owned("tile tyreFr",    tZ, tFr),
    owned("tile brakeTempF",tZ, tBt),
    owned("cursor speed",   sZ, cSp),
    owned("cursor delta",   dZ, cDt)
  ]
  m.fuelScope = undefined
  // Inject a wrong app axis pair (all four match but wrong)
  m.plotRects = makePlotRects(89, 628, "90", "720")  // wrong: should be "88"/"718"
  m.cursorRects = makeCursorRects(300)
  assert.throws(
    () => validateCaptureMetrics(m, entry),
    (error) => {
      assert.ok(error instanceof CaptureSafetyError)
      assert.match(error.message, /app shared-axis declaration must be "88"\/"718"/)
      return true
    }
  )
})

test("misaligned scrub cursor fails closed", () => {
  assertRejects(
    (m) => { m.cursorRects[2].left = m.cursorRects[0].left + 2 },
    /scrub-cursor alignment violation: cursor\[2\]/
  )
})

test("wrong number of plot rects fails closed", () => {
  assertRejects((m) => { m.plotRects.splice(2, 1) }, /expected 4 plot regions, found 3/)
})

test("wrong number of cursor rects fails closed", () => {
  assertRejects((m) => { m.cursorRects.splice(1, 1) }, /expected 4 cursor elements, found 3/)
})

// ── Packet omissions ───────────────────────────────────────────────────────────────────────

test("a digit in any distance tick fails closed (omission: lapDistanceChannel)", () => {
  assertRejects((m) => { m.distanceTickTexts[0] = "100" }, /lapDistanceChannel/)
  assertRejects((m) => { m.distanceTickTexts[3] = "42" },  /lapDistanceChannel/)
})

test("the wrong number of distance ticks fails closed", () => {
  assertRejects((m) => { m.counted[2].count = 4 }, /expected 5 rc11-distance-tick elements/)
})

test("a lock-up marker fails closed (omission: perWheelSpeedChannel)", () => {
  assertRejects((m) => { m.counted[9].count = 1 }, /perWheelSpeedChannel/)
})

test("a steering series at native fails closed (omission: steeringAt800)", () => {
  assertRejects((m) => { m.counted[10].count = 1 }, /steeringAt800/)
})

test("wrong inputs-legend entry count at native fails closed (omission: steeringAt800)", () => {
  // At native = 2; injecting 3 reintroduces steeringAt800
  assertRejects((m) => { m.counted[12].count = 3 }, /steeringAt800/)
})

test("wrong speed-legend entry count fails closed", () => {
  assertRejects((m) => { m.counted[11].count = 3 }, /speed legend must always have 2 entries/)
})

test("a mini-sector table at native size fails closed (app-only reveal)", () => {
  assertRejects((m) => { m.sectorPanelPresent = true }, /mini-sector table must be absent outside the app layout/)
})

test("sector rows at any size fail closed", () => {
  assertRejects((m) => { m.counted[6].count = 1 }, /no sector rows may render outside the app layout/)
})

test("an RPM element fails closed (omission: rpmZone)", () => {
  assertRejects((m) => { m.forbidden[0].count = 1 }, /must not be rendered/)
})

test("a legend divider fails closed (omission: legendDivider)", () => {
  assertRejects((m) => { m.forbidden[1].count = 1 }, /must not be rendered/)
})

test("a trough element fails closed (omission: fixedTroughCount)", () => {
  assertRejects((m) => { m.forbidden[2].count = 1 }, /must not be rendered/)
})

// ── Alert state ────────────────────────────────────────────────────────────────────────────

test("silent state with active alerts attribute fails closed", () => {
  assertRejects((m) => { m.stateAttributes.alerts = "active" }, /silent state must publish data-rc11-alerts="silent"/)
})

test("silent state with gap-band elements fails closed", () => {
  assertRejects(
    (m) => { m.counted[8].count = 1; m.gapRects = [{ channel: "speed", left: 200, top: 10, width: 50, height: 40 }] },
    /silent state must not render gap-band elements/
  )
})

test("data-gap state with silent alerts attribute fails closed", () => {
  assertRejects((m) => { m.stateAttributes.alerts = "silent" }, /data-gap state must publish data-rc11-alerts="active"/, "data-gap")
})

test("data-gap state with zero gap-band elements fails closed", () => {
  assertRejects(
    (m) => { m.counted[8].count = 0; m.gapRects = [] },
    /must have at least one rc11-gap element/,
    "data-gap"
  )
})

test("data-gap state with gap-band elements but zero measured width fails closed", () => {
  assertRejects(
    (m) => { m.gapRects = [{ channel: "speed", left: 200, top: 10, width: 0, height: 40 }] },
    /no rc11-gap element has measurable width/,
    "data-gap"
  )
})

// ── Gap-label overflow (DEFECT RC-11/1) ───────────────────────────────────────────────────

const GAP_LABEL_LEAF = Object.freeze({
  key: "rc11-gap-label",
  text: "DATA GAP",
  fontSize: 12,
  whiteSpace: "nowrap",
  clientWidth: 50,
  scrollWidth: 77,
  overflowX: 27,
  textLeft: 200.0,
  textRight: 277.0
})

test("gap-label overflow within budget in data-gap state is accepted and returned in audit", () => {
  const entry   = nativeEntry("data-gap")
  const metrics = nativeMetrics("data-gap")
  metrics.overflowLeaves = [{ ...GAP_LABEL_LEAF }]
  const audit = validateCaptureMetrics(metrics, entry)
  assert.ok(
    audit.knownDefects.some((d) => d.key === "rc11-gap-label"),
    "the gap-label overflow must appear in the audit's knownDefects"
  )
  const reported = audit.knownDefects.find((d) => d.key === "rc11-gap-label")
  assert.equal(reported.state, "data-gap")
  assert.ok(reported.overflowX <= 36, `overflowX ${reported.overflowX} should be ≤ 36 (budget)`)
})

test("gap-label overflow EXCEEDING the budget in data-gap state fails closed", () => {
  const entry   = nativeEntry("data-gap")
  const metrics = nativeMetrics("data-gap")
  metrics.overflowLeaves = [{ ...GAP_LABEL_LEAF, overflowX: 37, scrollWidth: 87, textRight: 287.0 }]
  assert.throws(
    () => validateCaptureMetrics(metrics, entry),
    (error) => {
      assert.ok(error instanceof CaptureSafetyError)
      assert.match(error.message, /overflows by 37px, past the 36px recorded for the known defect/)
      return true
    }
  )
})

test("gap-label overflow in silent state fails closed (states=[data-gap])", () => {
  assertRejects(
    (m) => { m.overflowLeaves = [{ ...GAP_LABEL_LEAF }] },
    /rc11-gap-label.*paints.*wider than its.*box/
  )
})

// ── Modifier / state mismatches ────────────────────────────────────────────────────────────

test("a modifier that disagrees with the measured content box fails closed", () => {
  assertRejects((m) => { m.layout = "app" }, /layout modifier app does not match/)
  assertRejects((m) => { m.contentHeight = "481" }, /did not report its measured content box/)
  assertRejects((m) => { m.nativeSize = null }, /native content-box modifier must be 800x480/)
})

test("a wrong preset or widget id fails closed", () => {
  assertRejects((m) => { m.presetId = "racecon_rc09_dash" }, /did not resolve the unmodified/)
  assertRejects((m) => { m.renderedWidgetId = "raceconRc09Dash" }, /did not resolve the unmodified/)
})

test("a non-accepted buffer state fails closed", () => {
  assertRejects((m) => { m.bufferState = "duplicate" }, /accepted live frame/)
})

test("a wrong capture state fails closed", () => {
  assertRejects((m) => { m.captureState = "data-gap" }, /rendered the data-gap scenario/)
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

const CYAN_BAND = { left: 71, top: 10, width: 448, height: 30 }  // speed trace band

function capturePng(size, {
  blank       = false,
  strayAmber  = false,
  strayRed    = false,
  strayGreen  = false,
  noCyan      = false
} = {}) {
  const image = paintPng(size, CANVAS_RGB)
  if (!blank) {
    if (!noCyan) {
      // Paint a cyan trace line across the full plot span — at least 5000 non-canvas pixels
      fillRect(image, CYAN_BAND, CYAN_RGB)
      // Also fill lower panels to ensure > RC11_MIN_NON_CANVAS_PIXELS
      for (let panel = 1; panel < 4; panel += 1) {
        fillRect(image, { left: 71, top: 10 + panel * 60, width: 448, height: 30 }, CYAN_RGB)
      }
    } else {
      // Non-canvas but not cyan — use blue pixels; enough for blank check
      for (let panel = 0; panel < 4; panel += 1) {
        fillRect(image, { left: 71, top: 10 + panel * 60, width: 448, height: 30 }, BLUE_RGB)
      }
    }
  }
  if (strayAmber) fillRect(image, { left: 2, top: 2, width: 10, height: 10 }, AMBER_RGB)
  if (strayRed)   fillRect(image, { left: 2, top: 2, width: 10, height: 10 }, RED_RGB)
  if (strayGreen) fillRect(image, { left: 2, top: 2, width: 10, height: 10 }, GREEN_RGB)
  return PNG.sync.write(image)
}

test("the pixel audit accepts valid silent and data-gap frames (cyan present, amber/red/green absent)", () => {
  for (const state of ["silent", "data-gap"]) {
    const entry   = nativeEntry(state)
    const metrics = nativeMetrics(state)
    const audit   = validateCapturePixels(capturePng(CAPTURE_SIZES[0]), entry, metrics)
    assert.ok(audit.nonCanvasPixels >= RC11_MIN_NON_CANVAS_PIXELS)
    assert.ok(audit.hueFamilies.cyan > 100, `expected cyan pixels on ${state} frame`)
    assert.equal(audit.hueFamilies.amber, 0, `expected 0 amber on ${state} frame`)
    assert.equal(audit.hueFamilies.red,   0, `expected 0 red on ${state} frame`)
    assert.equal(audit.hueFamilies.green, 0, `expected 0 green on ${state} frame`)
  }
})

test("a blank frame fails closed", () => {
  assert.throws(
    () => validateCapturePixels(capturePng(CAPTURE_SIZES[0], { blank: true }), nativeEntry("silent"), null),
    /capture is blank.*#0E1116/
  )
})

test("an amber pixel on any RC-11 frame fails closed (no caution alert fires)", () => {
  assert.throws(
    () => validateCapturePixels(capturePng(CAPTURE_SIZES[0], { strayAmber: true }), nativeEntry("silent"), null),
    /must be absent/
  )
})

test("a red pixel on any RC-11 frame fails closed (no danger alert fires)", () => {
  assert.throws(
    () => validateCapturePixels(capturePng(CAPTURE_SIZES[0], { strayRed: true }), nativeEntry("silent"), null),
    /must be absent/
  )
})

test("a green pixel on any RC-11 frame fails closed (no normal alert fires)", () => {
  assert.throws(
    () => validateCapturePixels(capturePng(CAPTURE_SIZES[0], { strayGreen: true }), nativeEntry("silent"), null),
    /must be absent/
  )
})

test("a frame with no cyan fails closed (current-speed trace must always be painted)", () => {
  assert.throws(
    () => validateCapturePixels(capturePng(CAPTURE_SIZES[0], { noCyan: true }), nativeEntry("silent"), null),
    /must be painted|must always be painted/
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
