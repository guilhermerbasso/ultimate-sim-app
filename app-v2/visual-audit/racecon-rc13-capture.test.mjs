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
  RC13_ALERT_AMBER_ENGAGED_FLOOR,
  RC13_CANVAS_RGBA,
  RC13_CAPTURE_MATRIX,
  RC13_CAUTION_HEX,
  RC13_DANGER_HEX,
  RC13_GLYPH_OVERFLOW_BUDGET_PX,
  RC13_MIN_AMBER_PIXELS,
  RC13_SIGNATURE_HEX,
  RC13_SPEC,
  RC13_STATUS_AMBER_RESTING_CEILING,
  RC13_WINDOW_ZONE_DEFS,
  validateCaptureMetrics,
  validateCapturePixels
} from "./racecon-rc13-capture-lib.mjs"

function temporaryDirectory() {
  return mkdtempSync(join(tmpdir(), "racecon-rc13-capture-test-"))
}

// RC-13 canvas: #0B0D0F = rgb(11, 13, 15)
const CANVAS_RGB = [11, 13, 15]
// Signature / caution amber: #FFD100 = rgb(255, 209, 0) → amber family
const AMBER_RGB  = [255, 209, 0]
// Danger red: #FF3B30 = rgb(255, 59, 48) → red family
const DANGER_RGB = [255, 59, 48]
// Neutral gray for non-canvas, non-alerting content
const GRAY_RGB   = [128, 128, 128]

function rect(left, top, width, height) {
  return { left, top, width, height }
}

function measured(box) {
  return { ...box, layoutWidth: box.width, layoutHeight: box.height, scrollWidth: box.width, scrollHeight: box.height }
}

function zone(name, box, display = "block") {
  return { name, selector: `[data-testid="rc13-panel-${name}"]`, present: true, display, ...measured(box) }
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
    color: "rgb(255, 246, 230)",
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
 * Native 800×480 zone layout for RC-13.
 *
 * Five stacked panels: status (header) at top, then window, queue, restart, pace below.
 */
function nativeZones() {
  const statusBox  = rect(0,   0, 800,  80)
  const windowBox  = rect(0,  80, 800,  80)
  const queueBox   = rect(0, 160, 800,  60)
  const restartBox = rect(0, 220, 800,  80)
  const paceBox    = rect(0, 300, 800, 180)
  return { statusBox, windowBox, queueBox, restartBox, paceBox }
}

/**
 * Synthetic window-bar measurement for the native 800×480 viewport.
 *
 * Bar starts at x=29.8, width=472 px (approximately).
 * Tolerance = 2/472 ≈ 0.00424.
 * Zone fractions: over 0/34, in 34/66, under 66/100.
 * Word centres: 17, 50, 83.
 */
function windowBarMeasured(barLeft = 29, barWidth = 472) {
  const barRect = { left: barLeft, top: 100, width: barWidth, height: 40 }
  const zones = RC13_WINDOW_ZONE_DEFS.map((def) => {
    const zoneLeft  = barLeft + (def.from / 100) * barWidth
    const zoneWidth = ((def.to - def.from) / 100) * barWidth
    return {
      id:        def.id,
      from:      def.from,
      to:        def.to,
      word:      def.word,
      centre:    def.centre,
      activeAttr:"false",
      rect:      { left: zoneLeft, top: barRect.top, width: zoneWidth, height: barRect.height }
    }
  })
  return { barRect, zones }
}

/**
 * Synthetic RC-13 metrics for the native 800×480 viewport.
 *
 * Type-scale ladder (native):
 *   sc-delta 80 > gap-ahead 64 > restart-status 40 > restart-block 32 > position 28
 */
function nativeMetrics(state = "silent") {
  const size = CAPTURE_SIZES[0]   // 800×480
  const ri = state === "restart-imminent"
  const { statusBox, windowBox, queueBox, restartBox, paceBox } = nativeZones()
  const { barRect, zones: windowZoneMeasured } = windowBarMeasured()

  const scDeltaBox    = rect(windowBox.left + 4, windowBox.top + 8,  200, 56)
  const gapAheadBox   = rect(queueBox.left  + 4, queueBox.top  + 4,  200, 48)
  const restartBlkBox = rect(restartBox.left + 4, restartBox.top + 8, 200, 32)
  const positionBox   = rect(paceBox.left   + 4, paceBox.top   + 4,  100, 28)
  const speedBox      = rect(paceBox.left   + 120, paceBox.top  + 4, 120, 28)
  const deltaBestBox  = rect(paceBox.left   + 4, paceBox.top   + 40, 180, 28)
  const restartStBox  = rect(statusBox.left + 4, statusBox.top + 20, 400, 40)

  // Alert chip rect (present only in restart-imminent)
  const alertChipRect = ri ? rect(400, 20, 160, 36) : null
  const alertChipRects = ri ? [alertChipRect] : []

  const restartWord = ri ? "RESTART IMMINENT" : "SC DEPLOYED"

  // Leaf texts
  const leafTexts = [
    "--.-",                        // sc-delta (omission: scDeltaChannel)
    "2.4",                         // gap-ahead
    restartWord,                   // restart-status
    restartWord,                   // restart-block
    "6",                           // position
    "96",                          // speed
    "+1.884",                      // delta-best
    "NO SC WINDOW SOURCE",         // window notice (omission: scWindowTargetChannel)
    "--",                          // restart zone (omission: restartZoneChannel)
    "NO RESTART ZONE SOURCE",      // restart zone notice
    "NO QUEUE SOURCE",             // train notice (only at app layout, but harmless to include)
    ...(ri ? ["RESTART IMMINENT"] : ["SC DEPLOYED"])
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
    presetId: RC13_SPEC.presetId,
    expectedWidgetId: RC13_SPEC.widgetId,
    renderedWidgetId: RC13_SPEC.widgetId,
    dashboardWidth: "1024",
    dashboardHeight: "600",
    sourceKind: "live-telemetry",
    sourceIdentity: RC13_SPEC.sourceIdentity,
    captureState: state,
    captureSequence: "200",
    layout: "native",
    compactMode: null,
    bufferState: "accepted",
    contentWidth: String(size.width),
    contentHeight: String(size.height),
    stateAttributes: {
      restart:           ri ? "restartImminent" : "scDeployed",
      flag:              "yellow",
      "window-zone":     "none",
      "window-available":"false",
      muted:             "true",
      "shift-armed":     "false",
      alerts:            ri ? "restartImminent" : "silent"
    },
    zones: [
      zone("status",  statusBox),
      zone("window",  windowBox),
      zone("queue",   queueBox),
      zone("restart", restartBox),
      zone("pace",    paceBox)
    ],
    values: [
      value("sc-delta",     '[data-testid="rc13-sc-delta"]',     "--.-",   scDeltaBox,   80),
      value("gap-ahead",    '[data-testid="rc13-gap-ahead"]',    "2.4",    gapAheadBox,  64),
      value("restart-block",'[data-testid="rc13-restart-block"]',restartWord, restartBlkBox, 32),
      value("position",     '[data-testid="rc13-position"]',     "6",      positionBox,  28),
      value("speed",        '[data-testid="rc13-speed"]',        "96",     speedBox,     28),
      value("delta-best",   '[data-testid="rc13-delta-best"]',   "+1.884", deltaBestBox, 28)
    ],
    containment: [
      owned("restart-status", statusBox,   restartStBox),
      owned("sc-delta",       windowBox,   scDeltaBox),
      owned("gap-ahead",      queueBox,    gapAheadBox),
      owned("restart-block",  restartBox,  restartBlkBox),
      owned("position",       paceBox,     positionBox),
      owned("speed",          paceBox,     speedBox),
      owned("delta-best",     paceBox,     deltaBestBox)
    ],
    forbidden: RC13_SPEC.forbidden.map(([label, selector]) => ({ label, selector, count: 0 })),
    counted: [
      counted("window-zone",           '[data-testid="rc13-window-zone"]',           3),
      counted("window-zone-word",       '[data-testid="rc13-window-zone-word"]',       3),
      counted("window-marker",          '[data-testid="rc13-window-marker"]',          0),
      counted("window-notice",          '[data-testid="rc13-window-notice"]',          1),
      counted("restart-status",         '[data-testid="rc13-restart-status"]',         1),
      counted("train",                  '[data-testid="rc13-train"]',                  0),
      counted("train-row",              '[data-testid="rc13-train-row"]',              0),
      counted("train-notice",           '[data-testid="rc13-train-notice"]',           0),
      counted("restart-zone-row",       '[data-testid="rc13-restart-zone-row"]',       1),
      counted("restart-zone-notice",    '[data-testid="rc13-restart-zone-notice"]',    1),
      counted("restart-sketch",         '[data-testid="rc13-restart-sketch"]',         0),
      counted("alert-restartImminent",  '[data-testid="rc13-alert-restartImminent"]',  ri ? 1 : 0)
    ],
    textOutputs: [
      "--.-", "2.4", restartWord, restartWord, "6", "96", "+1.884"
    ],
    leafTexts,
    overflowLeaves: [],
    rootText,
    errorBoundaryCount: 0,
    unknownWidgetCount: 0,
    failures:      [],
    pageErrors:    [],
    consoleErrors: [],
    nativeSize:    "800x480",
    // Window-bar geometry
    barRect,
    windowZoneMeasured,
    windowMarkerAttr:      "none",
    windowZoneActiveAttrs: ["false", "false", "false"],
    windowNoticeText:      "NO SC WINDOW SOURCE",
    // Restart-status (excluded from spec.values per DEFECT RC-13/2)
    restartStatusText:         restartWord,
    restartStatusFontSize:     40,
    restartStatusTextRngTop:   12,   // positive at native (no glyph overflow)
    restartStatusRect:    measured(restartStBox),
    statusHeaderRect:     measured(statusBox),
    // Restart-zone omission
    restartZoneText:           "--",
    restartZoneNoticeText:     "NO RESTART ZONE SOURCE",
    restartZoneAvailable:      "false",
    // Amber density scope
    alertChipRects,
    // Not at app layout — these would only be checked at app
    trainRowsAttr:    null,
    trainAvailable:   null,
    trainNoticeText:  null
  }
}

function nativeEntry(state = "silent") {
  return RC13_CAPTURE_MATRIX.find((e) => e.state === state && e.size.width === 800)
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

test("the governed RC-13 matrix covers every viewport in every governed state", () => {
  assert.equal(CAPTURE_SIZES.length, 6)
  assert.deepEqual([...CAPTURE_STATES], ["silent", "restart-imminent"])
  assert.equal(RC13_CAPTURE_MATRIX.length, CAPTURE_SIZES.length * CAPTURE_STATES.length)
  for (const entry of RC13_CAPTURE_MATRIX) {
    assert.equal(entry.size.layout, expectedLayoutForBox(entry.size.width, entry.size.height))
    assert.equal(entry.size.compactMode, expectedCompactModeForBox(entry.size.width, entry.size.height))
  }
  const ri = RC13_CAPTURE_MATRIX.filter((e) => e.state === "restart-imminent")
  assert.equal(ri.length, 6)
  for (const entry of ri) assert.deepEqual(entry.required[0], ["alerts", "restartImminent"])
  const silent = RC13_CAPTURE_MATRIX.filter((e) => e.state === "silent")
  for (const entry of silent) assert.deepEqual(entry.required[0], ["alerts", "silent"])
})

// ── Hue families ────────────────────────────────────────────────────────────────────────────

test("RC-13 colour tokens classify to the expected hue families", () => {
  assert.equal(hueFamilyOfHex(RC13_DANGER_HEX),    "red")     // #FF3B30
  assert.equal(hueFamilyOfHex(RC13_SIGNATURE_HEX), "amber")   // #FFD100
  assert.equal(hueFamilyOfHex(RC13_CAUTION_HEX),   "amber")   // #FFC400
})

// ── Happy-path validations ───────────────────────────────────────────────────────────────────

test("a faithful native silent fixture validates and returns type scale and bar geometry", () => {
  const audit = validateCaptureMetrics(nativeMetrics("silent"), nativeEntry("silent"))
  assert.deepEqual(audit.knownDefects, [])
  assert.ok(audit.typeScale.length >= 4)
  assert.equal(audit.typeScale[0].label, "sc-delta")
  assert.equal(audit.typeScale[0].fontSize, 80)
  assert.ok(audit.barGeometry, "barGeometry must be returned")
  assert.equal(audit.barGeometry.zones.length, 3)
})

test("a faithful native restart-imminent fixture validates with the alert chip present", () => {
  validateCaptureMetrics(nativeMetrics("restart-imminent"), nativeEntry("restart-imminent"))
  // alerts=silent in restart-imminent state fails
  assertRejects(
    (m) => { m.stateAttributes.alerts = "silent" },
    /data-rc13-alerts must be "restartImminent"/,
    "restart-imminent"
  )
  // No alert chip in restart-imminent fails
  assertRejects(
    (m) => { m.counted[11].count = 0 },
    /rc13-alert-restartImminent chip count must be 1/,
    "restart-imminent"
  )
})

// ── Type scale ───────────────────────────────────────────────────────────────────────────────

test("a tie anywhere in the strict type-scale ladder is a failure", () => {
  // sc-delta = gap-ahead (tie)
  assertRejects((m) => { m.values[0].fontSize = 64 }, /type-scale hierarchy does not hold/)
  // gap-ahead = restart-block (tie — restart-status sits between them)
  assertRejects((m) => { m.restartStatusFontSize = 64 ; m.values[0].fontSize = 64 }, /type-scale hierarchy does not hold/)
})

// ── Window-bar geometry ──────────────────────────────────────────────────────────────────────

test("window-bar zone fractions outside the declared 0/34/66/100 tolerance are rejected", () => {
  // Shift the 'over' zone far right — startFrac becomes 0.05, tolerance ≈ 0.00424
  assertRejects(
    (m) => {
      m.windowZoneMeasured[0].rect.left = m.barRect.left + 24  // 5% of 472 ≈ 24 px offset
    },
    /start fraction .* deviates more than/
  )
})

test("window-bar zone word centres that differ from declared 17/50/83 are rejected", () => {
  assertRejects(
    (m) => { m.windowZoneMeasured[0].centre = 20 },   // 'over' zone centre must be 17
    /data-rc13-window-zone-centre must be 17/
  )
})

test("window-bar zone width fraction outside tolerance is rejected", () => {
  assertRejects(
    (m) => {
      // Shrink 'over' zone width to ~20 % of bar (should be 34 %)
      m.windowZoneMeasured[0].rect.width = m.barRect.width * 0.20
    },
    /width fraction .* deviates more than/
  )
})

test("a window marker rendered with no SC delta channel fails closed (omission: scDeltaChannel)", () => {
  assertRejects(
    (m) => { m.counted[2].count = 1 },
    /window marker.*rendered with no SC delta channel/
  )
})

test("data-rc13-window-marker must be 'none' with no SC delta channel", () => {
  assertRejects(
    (m) => { m.windowMarkerAttr = "0.5" },
    /data-rc13-window-marker must be "none"/
  )
})

test("a window zone marked active fails closed (omission: scWindowTargetChannel)", () => {
  assertRejects(
    (m) => { m.windowZoneActiveAttrs[1] = "true" },
    /window zone published data-rc13-window-zone-active="true"/
  )
})

test("data-rc13-window-zone must be 'none' with no SC window target channel", () => {
  assertRejects(
    (m) => { m.stateAttributes["window-zone"] = "in" },
    /data-rc13-window-zone must be "none"/
  )
})

test("a restart-zone value that is not '--' fails closed (omission: restartZoneChannel)", () => {
  assertRejects(
    (m) => { m.restartZoneText = "42" },
    /restart-zone reads .* instead of "--"/
  )
})

// ── Packet omissions ─────────────────────────────────────────────────────────────────────────

test("a digit in the SC delta readout fails closed (omission: scDeltaChannel)", () => {
  assertRejects(
    (m) => { m.values[0].text = "+2.4" },
    /sc-delta reads .* instead of .* "--.-"/
  )
})

test("a train row rendered fails closed (omission: queueTrainChannel)", () => {
  // At native layout, any train element must be absent
  assertRejects(
    (m) => { m.counted[5].count = 1 },
    /rc13-train subtree must be absent outside the app layout/
  )
})

test("a shift-LED element present fails closed (omission: shiftLedZone)", () => {
  assertRejects(
    (m) => { m.forbidden[0].count = 1 },
    /shift LED.*must not be rendered/
  )
})

// -- REGRESSION GUARD RC-13/1 - restart-status compact-phone overflow fixed -------------------

function compactPhoneRestartMetrics(width = 393, height = 759) {
  const m = nativeMetrics("restart-imminent")
  m.viewport  = { width, height, dpr: 1 }
  m.page      = { scrollWidth: width, clientWidth: width }
  m.root      = rect(0, 0, width, height)
  m.shell     = measured(rect(0, 0, width, height))
  m.canvas    = { ...measured(rect(0, 0, width, height)), transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } }
  m.dashboardElement = measured(rect(0, 0, width, height))
  m.widget    = measured(rect(0, 0, width, height))
  m.dashboard = measured(rect(0, 0, width, height))
  m.contentWidth  = String(width)
  m.contentHeight = String(height)
  m.layout    = "compact"
  m.compactMode = "phone"
  m.nativeSize  = null

  const statusBox = rect(0, 0, width, 80)
  const restartStBox = rect(4, 20, Math.min(180, width - 8), 40)
  m.zones = [
    zone("status",  statusBox),
    zone("window",  rect(0,  80, width,  80)),
    zone("queue",   rect(0, 160, width,  60)),
    zone("restart", rect(0, 220, width,  80)),
    zone("pace",    rect(0, 300, width, 180))
  ]
  m.restartStatusRect = measured(restartStBox)
  m.statusHeaderRect = measured(statusBox)
  m.containment[0] = owned("restart-status", statusBox, restartStBox)
  return m
}

test("restart-status overflow fails closed after compact-phone fix (REGRESSION GUARD RC-13/1)", () => {
  const compactPhoneEntry393 = RC13_CAPTURE_MATRIX.find(
    (e) => e.state === "restart-imminent" && e.size.width === 393
  )
  const m = compactPhoneRestartMetrics(393, 759)
  m.overflowLeaves = [
    {
      key: "rc13-restart-status",
      text: "RESTART IMMINENT",
      fontSize: 19.65,
      whiteSpace: "nowrap",
      clientWidth: 153,
      scrollWidth: 156,
      overflowX: 3,
      textLeft: 5,
      textRight: 161
    }
  ]
  assert.throws(
    () => validateCaptureMetrics(m, compactPhoneEntry393),
    (error) => {
      assert.ok(error instanceof CaptureSafetyError)
      assert.match(error.message, /rc13-restart-status .* overflows its own box by 3px/)
      return true
    }
  )
})

test("clean compact-phone restart-status metrics pass after RC-13/1 fix", () => {
  const compactPhoneEntry412 = RC13_CAPTURE_MATRIX.find(
    (e) => e.state === "restart-imminent" && e.size.width === 412
  )
  assert.doesNotThrow(() => validateCaptureMetrics(compactPhoneRestartMetrics(412, 867), compactPhoneEntry412))
})

// ── DEFECT RC-13/2 — glyph ascent overflow at app layout ────────────────────────────────────

test("glyph ascent overflow within budget at 1024x600 is accepted (DEFECT RC-13/2)", () => {
  const appEntry = RC13_CAPTURE_MATRIX.find((e) => e.state === "silent" && e.size.width === 1024)
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
  m.nativeSize  = null
  m.stateAttributes["app-only"] = "true"
  // App layout: train present with 0 rows + notice
  m.counted[5].count = 1   // train
  m.counted[7].count = 1   // train-notice
  m.trainRowsAttr  = "0"
  m.trainAvailable = "false"
  m.trainNoticeText = "NO QUEUE SOURCE"
  // App layout: restart-sketch present
  m.counted[10].count = 1  // restart-sketch
  // Rebuild window-bar for app layout width
  const { barRect: b2, zones: z2 } = windowBarMeasured(30, 600)
  m.barRect = b2
  m.windowZoneMeasured = z2
  // Glyph ascent at 1024x600: textRngTop = -3.109 (within budget=4)
  m.restartStatusTextRngTop = -3.109
  m.restartStatusFontSize   = 51.2
  // Update values to use app-scale sizes
  m.values[0].fontSize = 102.4  // sc-delta at app
  m.values[1].fontSize = 81.92
  m.values[2].fontSize = 40.96  // restart-block
  m.values[3].fontSize = 35.84  // position
  m.values[4].fontSize = 35.84  // speed
  m.values[5].fontSize = 35.84  // delta-best
  // Adjust zone and value rects to app size (approximate)
  const aStatusBox  = rect(0,   0, 1024,  100)
  const aWindowBox  = rect(0, 100, 1024,  100)
  const aQueueBox   = rect(0, 200, 1024,   80)
  const aRestartBox = rect(0, 280, 1024,  100)
  const aPaceBox    = rect(0, 380, 1024,  220)
  m.zones = [
    { name: "status",  selector: '[data-testid="rc13-panel-status"]',  present: true, display: "block", ...measured(aStatusBox) },
    { name: "window",  selector: '[data-testid="rc13-panel-window"]',  present: true, display: "block", ...measured(aWindowBox) },
    { name: "queue",   selector: '[data-testid="rc13-panel-queue"]',   present: true, display: "block", ...measured(aQueueBox) },
    { name: "restart", selector: '[data-testid="rc13-panel-restart"]', present: true, display: "block", ...measured(aRestartBox) },
    { name: "pace",    selector: '[data-testid="rc13-panel-pace"]',    present: true, display: "block", ...measured(aPaceBox) }
  ]
  m.statusHeaderRect = measured(aStatusBox)
  assert.doesNotThrow(() => validateCaptureMetrics(m, appEntry))
})

test("glyph ascent overflow past the recorded budget is rejected (DEFECT RC-13/2)", () => {
  const appEntry = RC13_CAPTURE_MATRIX.find((e) => e.state === "silent" && e.size.width === 1024)
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
  m.nativeSize  = null
  m.stateAttributes["app-only"] = "true"
  m.counted[5].count  = 1 ; m.counted[7].count = 1
  m.trainRowsAttr = "0" ; m.trainAvailable = "false" ; m.trainNoticeText = "NO QUEUE SOURCE"
  m.counted[10].count = 1
  const { barRect: b3, zones: z3 } = windowBarMeasured(30, 600)
  m.barRect = b3 ; m.windowZoneMeasured = z3
  m.restartStatusFontSize = 51.2
  m.values[0].fontSize = 102.4 ; m.values[1].fontSize = 81.92
  m.values[2].fontSize = 40.96 ; m.values[3].fontSize = 35.84
  m.values[4].fontSize = 35.84 ; m.values[5].fontSize = 35.84
  const aStatusBox2  = rect(0,   0, 1024, 100)
  const aWindowBox2  = rect(0, 100, 1024, 100)
  const aQueueBox2   = rect(0, 200, 1024,  80)
  const aRestartBox2 = rect(0, 280, 1024, 100)
  const aPaceBox2    = rect(0, 380, 1024, 220)
  m.zones = [
    { name: "status",  selector: '[data-testid="rc13-panel-status"]',  present: true, display: "block", ...measured(aStatusBox2) },
    { name: "window",  selector: '[data-testid="rc13-panel-window"]',  present: true, display: "block", ...measured(aWindowBox2) },
    { name: "queue",   selector: '[data-testid="rc13-panel-queue"]',   present: true, display: "block", ...measured(aQueueBox2) },
    { name: "restart", selector: '[data-testid="rc13-panel-restart"]', present: true, display: "block", ...measured(aRestartBox2) },
    { name: "pace",    selector: '[data-testid="rc13-panel-pace"]',    present: true, display: "block", ...measured(aPaceBox2) }
  ]
  m.statusHeaderRect = measured(aStatusBox2)
  // Overflow exceeds budget of 4 px
  m.restartStatusTextRngTop = -(RC13_GLYPH_OVERFLOW_BUDGET_PX + 1)
  assert.throws(
    () => validateCaptureMetrics(m, appEntry),
    (error) => {
      assert.ok(error instanceof CaptureSafetyError)
      assert.match(error.message, /glyph ascent overflow .* grew to|DEFECT RC-13\/2|exceeding the .* budget/)
      return true
    }
  )
})

// ── Modifier / state mismatches ──────────────────────────────────────────────────────────────

test("a wrong viewport / content-box modifier fails closed", () => {
  assertRejects((m) => { m.layout = "app" },       /layout modifier app does not match/)
  assertRejects((m) => { m.contentWidth = "801" },  /did not report its measured content box/)
  assertRejects((m) => { m.nativeSize = null },     /native content-box modifier/)
})

test("a wrong preset or widget id fails closed", () => {
  assertRejects((m) => { m.presetId = "other_preset" }, /did not resolve the unmodified racecon_rc13_dash preset/)
})

test("a wrong capture state fails closed", () => {
  assertRejects((m) => { m.captureState = "restart-imminent" }, /rendered the restart-imminent scenario while capturing silent/)
})

test("a non-accepted buffer state fails closed", () => {
  assertRejects((m) => { m.bufferState = "stale" }, /accepted live frame/)
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
 * Synthetic RC-13 capture PNG.
 *
 * Both states: canvas background + gray content + amber stripe (signature chrome).
 * strayRed: injects a forbidden red pixel.
 * blank: only canvas background.
 * chipFull: fills the alert-chip area with amber (simulates high density for restart-imminent proof).
 * noAmber: no amber pixels at all (should fail the "amber present" check).
 */
function capturePng(state, { strayRed = false, blank = false, chipFull = false, noAmber = false } = {}) {
  const size = CAPTURE_SIZES[0]
  const image = paintPng(size, CANVAS_RGB)

  if (!blank) {
    // Gray content makes the frame non-blank
    fillRect(image, rect(10, 10, 400, 300), GRAY_RGB)
    // Amber signature chrome: status border-bottom + window-bar dividers (small strips)
    if (!noAmber) {
      // Status border-bottom (2px rule)
      fillRect(image, rect(0, 78, 800, 2), AMBER_RGB)
      // Window-bar dividers (1px each at 34% and 66% of 472 px)
      fillRect(image, rect(190, 80, 1, 40), AMBER_RGB)
      fillRect(image, rect(341, 80, 1, 40), AMBER_RGB)
    }
  }

  if (chipFull) {
    // Fill the alert chip rect entirely with amber — simulates restart-imminent chip density
    fillRect(image, rect(400, 20, 160, 36), AMBER_RGB)
  }

  if (strayRed) {
    fillRect(image, rect(2, 2, 8, 8), DANGER_RGB)
  }

  return PNG.sync.write(image)
}

function silentMetricsForPixel() {
  const m = nativeMetrics("silent")
  // statusHeaderRect is the scope for the silent-state amber density proof
  m.statusHeaderRect = rect(0, 0, 800, 80)
  return m
}

function restartMetricsForPixel() {
  const m = nativeMetrics("restart-imminent")
  m.alertChipRects = [rect(400, 20, 160, 36)]
  return m
}

test("pixel audit accepts silent and restart-imminent frames (no red, amber present)", () => {
  // Silent: no red, amber present (signature chrome)
  const silentAudit = validateCapturePixels(capturePng("silent"), nativeEntry("silent"), silentMetricsForPixel())
  assert.equal(silentAudit.hueFamilies.red, 0)
  assert.ok(silentAudit.hueFamilies.amber >= RC13_MIN_AMBER_PIXELS,
    `silent frame must have ≥ ${RC13_MIN_AMBER_PIXELS} amber pixels from chrome`)
  // Restart-imminent: no red, amber present
  const riAudit = validateCapturePixels(
    capturePng("restart-imminent", { chipFull: true }),
    nativeEntry("restart-imminent"),
    restartMetricsForPixel()
  )
  assert.equal(riAudit.hueFamilies.red, 0)
  assert.ok(riAudit.hueFamilies.amber > 0)
})

test("a blank frame fails closed", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { blank: true }), nativeEntry("silent"), silentMetricsForPixel()),
    /capture is blank/
  )
})

test("any RED pixel is rejected in BOTH states (window-violation alert is unreachable from fixture)", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { strayRed: true }), nativeEntry("silent"), silentMetricsForPixel()),
    /must be absent/
  )
  assert.throws(
    () => validateCapturePixels(
      capturePng("restart-imminent", { chipFull: true, strayRed: true }),
      nativeEntry("restart-imminent"),
      restartMetricsForPixel()
    ),
    /must be absent/
  )
})

test("AMBER must NOT be rejected on a silent frame (standing chrome signature is lit at rest)", () => {
  // The amber chrome pixels must not trigger the absent-check; we confirm the audit does not throw
  assert.doesNotThrow(
    () => validateCapturePixels(capturePng("silent"), nativeEntry("silent"), silentMetricsForPixel())
  )
})

test("amber density ceiling — alert chip filled on a silent frame is rejected", () => {
  // If the alert chip is fully amber on a silent frame, the status-header density exceeds the resting ceiling
  const m = silentMetricsForPixel()
  // Use the full status-header rect as scope (matches chipFull=true paint area inside status header)
  m.statusHeaderRect = rect(400, 20, 160, 36)  // small scope matching chip area
  const chipPng = capturePng("silent", { chipFull: true })
  // This should exceed the resting ceiling of 12 %
  assert.throws(
    () => validateCapturePixels(chipPng, nativeEntry("silent"), m),
    (error) => {
      assert.ok(error instanceof CaptureSafetyError)
      assert.match(error.message, /resting ceiling|alert surface is painted/)
      return true
    }
  )
})

test("amber density floor — alert chip bare on restart-imminent frame is rejected", () => {
  // A restart-imminent frame without the chip amber fill should fail the engaged-floor check
  const m = restartMetricsForPixel()
  // Use a large scope where the amber density will be LOW (no chip fill)
  m.alertChipRects = [rect(400, 20, 160, 36)]
  // capturePng without chipFull: only amber chrome (border + dividers), giving very low density
  const nochipPng = capturePng("restart-imminent")
  assert.throws(
    () => validateCapturePixels(nochipPng, nativeEntry("restart-imminent"), m),
    (error) => {
      assert.ok(error instanceof CaptureSafetyError)
      assert.match(error.message, /engaged floor|alert did not paint its surface/)
      return true
    }
  )
})

test("a frame without any amber pixels fails the 'amber present' check", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { noAmber: true }), nativeEntry("silent"), silentMetricsForPixel()),
    /must be painted/
  )
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
