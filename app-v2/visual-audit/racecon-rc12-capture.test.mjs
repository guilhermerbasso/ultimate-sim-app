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
  hueFamilyOfHex
} from "./racecon-capture-shared.mjs"
import {
  CAPTURE_SIZES,
  CAPTURE_STATES,
  RC12_CANVAS_RGBA,
  RC12_CAPTURE_MATRIX,
  RC12_CAUTION_HEX,
  RC12_DANGER_HEX,
  RC12_EXPECTED_ROW_COUNTS,
  RC12_FIELD_SIZE,
  RC12_SIGNATURE_HEX,
  RC12_SPEC,
  validateCaptureMetrics,
  validateCapturePixels
} from "./racecon-rc12-capture-lib.mjs"

function temporaryDirectory() {
  return mkdtempSync(join(tmpdir(), "racecon-rc12-capture-test-"))
}

// RC-12 canvas: #0A0E1A = rgb(10, 14, 26)
const CANVAS_RGB  = [10, 14, 26]
// Signature cyan: #00E0C6 = rgb(0, 224, 198) → cyan family (hue ≈173°)
const CYAN_RGB    = [0, 224, 198]
// Danger red: #FF5470 = rgb(255, 84, 112) → red family
const DANGER_RGB  = [255, 84, 112]
// Caution amber: #FFC93C = rgb(255, 201, 60) → amber family
const AMBER_RGB   = [255, 201, 60]
// Neutral gray for non-cyan, non-canvas synthetic content
const GRAY_RGB    = [128, 128, 128]

function rect(left, top, width, height) {
  return { left, top, width, height }
}

function measured(box) {
  return { ...box, layoutWidth: box.width, layoutHeight: box.height, scrollWidth: box.width, scrollHeight: box.height }
}

function zone(name, box, display = "block") {
  return { name, selector: `[data-testid="rc12-${name}"]`, present: true, display, ...measured(box) }
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
    color: "rgb(228, 236, 248)",
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
 * Native 800×480 zone layout for RC-12.
 * Three non-overlapping zones: ribbon at top (full-width), board filling most of the height,
 * and battle at the bottom.
 */
function nativeZones() {
  const ribbonBox = rect(0,   0, 800,  60)
  const boardBox  = rect(0,  60, 800, 320)
  const battleBox = rect(0, 380, 800, 100)
  return { ribbonBox, boardBox, battleBox }
}

/**
 * Synthetic RC-12 metrics for the native 800×480 viewport.
 *
 * Type-scale ladder (native, both states):
 *   battle gap 72 > cell gap 24 > cell position 22 > [tag 18 fastest-lap only] > ribbon 12
 *   badge 16 < cell-position 22 (strict)
 *   ribbon 12 < badge 16 (strict)
 *   badge 16 > lastLap 14 (strict)
 */
function nativeMetrics(state = "silent") {
  const size = CAPTURE_SIZES[0]   // 800×480 native
  const { ribbonBox, boardBox, battleBox } = nativeZones()
  const fastestLap = state === "fastest-lap"

  // Approximate positions for value elements
  const battleGapBox   = rect(battleBox.left + 8,  battleBox.top + 14, 200, 72)
  const cellGapBox     = rect(boardBox.left + 300,  boardBox.top +  4,  50, 24)
  const cellPosBox     = rect(boardBox.left +   4,  boardBox.top +  4,  40, 22)
  const cellBadgeBox   = rect(boardBox.left +  60,  boardBox.top +  4, 120, 16)
  const cellLastLapBox = rect(boardBox.left + 450,  boardBox.top +  4,  90, 14)
  const sessionTimeBox = rect(ribbonBox.left + 4,  ribbonBox.top + 20, 100, 12)
  const sessionDoneBox = rect(ribbonBox.left + 120, ribbonBox.top + 20,  40, 12)
  const sessionTotBox  = rect(ribbonBox.left + 180, ribbonBox.top + 20,  40, 12)

  // In fastest-lap state, the tag exists in the board zone
  const tagBox = fastestLap ? rect(boardBox.left + 500, boardBox.top + 4, 200, 18) : null
  const fastestRowBox = fastestLap ? rect(boardBox.left, boardBox.top + 240, boardBox.width, 40) : null

  const cyanScopes = fastestLap ? [tagBox, fastestRowBox].filter(Boolean) : []
  const tagFontSize = fastestLap ? 18 : null

  // Gap cells: 2 numerals (P4 ahead, P6 behind), 6 dashes
  const gapLeafTexts = ["0.8", "1.3", "--.-", "--.-", "--.-", "--.-", "--.-", "--.-"]
  const numeralGapCount = 2

  // Leaf texts must not contain entrant names or car numbers
  const leafTexts = [
    "1", "2", "3", "4", "5", "6", "7", "8",       // position cells
    "CAR --", "CAR --", "CAR --", "CAR --", "CAR --", "CAR --", "CAR --", "CAR --", // badge cells
    "0.8", "1.3", "--.-", "--.-", "--.-", "--.-", "--.-", "--.-", // gap cells
    "1:38.4", "1:37.9", "1:38.2", "1:38.7", "1:38.1", "1:39.0", "1:39.5", "1:40.2", // last-lap
    "--", "--", "--",  // session clock (all dashed — omission: sessionClockChannel)
    ...(fastestLap ? ["FASTEST LAP", "P7", "1:37.106"] : [])
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
    presetId: RC12_SPEC.presetId,
    expectedWidgetId: RC12_SPEC.widgetId,
    renderedWidgetId: RC12_SPEC.widgetId,
    dashboardWidth: "1024",
    dashboardHeight: "600",
    sourceKind: "live-telemetry",
    sourceIdentity: RC12_SPEC.sourceIdentity,
    captureState: state,
    captureSequence: "200",
    layout: "native",
    compactMode: null,
    bufferState: "accepted",
    contentWidth: String(size.width),
    contentHeight: String(size.height),
    stateAttributes: {
      alerts:          fastestLap ? "active" : "silent",
      timing:          "live",
      rows:            "8",
      field:           "8",
      "measured-gaps": "2",
      "app-only":      null
    },
    zones: [
      zone("ribbon",  ribbonBox),
      zone("board",   boardBox),
      zone("battle",  battleBox)
    ],
    values: [
      value("battle gap",          '[data-testid="rc12-battle-gap-value"]',  "0.842",  battleGapBox,    72),
      value("cell gap",            '[data-testid="rc12-cell-gap"]',           "0.8",   cellGapBox,      24),
      value("cell position",       '[data-testid="rc12-cell-position"]',      "1",     cellPosBox,      22),
      value("cell badge",          '[data-testid="rc12-cell-badge"]',         "CAR --",cellBadgeBox,    16),
      value("cell last lap",       '[data-testid="rc12-cell-lastLap"]',       "1:38.4",cellLastLapBox,  14),
      value("session time",        '[data-testid="rc12-session-time"]',       "--",    sessionTimeBox,  12),
      value("session laps done",   '[data-testid="rc12-session-laps-done"]',  "--",    sessionDoneBox,  12),
      value("session laps total",  '[data-testid="rc12-session-laps-total"]', "--",    sessionTotBox,   12)
    ],
    containment: [
      owned("session time in ribbon",  ribbonBox,  sessionTimeBox),
      owned("battle gap in battle",    battleBox,  battleGapBox)
    ],
    forbidden: RC12_SPEC.forbidden.map(([label, selector]) => ({ label, selector, count: 0 })),
    counted: [
      counted("row",           '[data-testid="rc12-row"]',                8),
      counted("populated row", '[data-rc12-row-populated="true"]',        8),
      counted("fastest row",   '[data-rc12-row-fastest="true"]',          fastestLap ? 1 : 0),
      counted("history zone",  '[data-testid="rc12-history"]',            0),
      counted("tag zone",      '[data-testid="rc12-tag"]',                fastestLap ? 1 : 0),
      counted("change arrow",  '[data-testid="rc12-change"]',             0),
      counted("lead tag",      '[data-testid="rc12-lead-tag"]',           0),
      counted("battle empty",  '[data-testid="rc12-battle-empty"]',       0),
      counted("safe frame",    '[data-testid="rc12-safe-frame"]',         1)
    ],
    textOutputs: [
      "0.842", "0.8", "1", "CAR --", "1:38.4", "--", "--", "--",
      ...(fastestLap ? ["FASTEST LAP"] : [])
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
    tagFontSize,
    gapLeafTexts,
    numeralGapCount,
    cyanScopes
  }
}

function nativeEntry(state = "silent") {
  return RC12_CAPTURE_MATRIX.find((e) => e.state === state && e.size.width === 800)
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

test("the governed RC-12 matrix covers every viewport in every governed state", () => {
  assert.equal(CAPTURE_SIZES.length, 6)
  assert.deepEqual([...CAPTURE_STATES], ["silent", "fastest-lap"])
  assert.equal(RC12_CAPTURE_MATRIX.length, CAPTURE_SIZES.length * CAPTURE_STATES.length)
  for (const entry of RC12_CAPTURE_MATRIX) {
    assert.equal(entry.size.layout, expectedLayoutForBox(entry.size.width, entry.size.height))
    assert.equal(entry.size.compactMode, expectedCompactModeForBox(entry.size.width, entry.size.height))
  }
  const fastest = RC12_CAPTURE_MATRIX.filter((e) => e.state === "fastest-lap")
  assert.equal(fastest.length, 6)
  for (const entry of fastest) assert.deepEqual(entry.required[0], ["alerts", "active"])
  const silent = RC12_CAPTURE_MATRIX.filter((e) => e.state === "silent")
  for (const entry of silent) assert.deepEqual(entry.required[0], ["alerts", "silent"])
})

// ── Hue families ────────────────────────────────────────────────────────────────────────────

test("RC-12 colour tokens classify to the expected hue families", () => {
  assert.equal(hueFamilyOfHex(RC12_SIGNATURE_HEX), "cyan")    // #00E0C6
  assert.equal(hueFamilyOfHex(RC12_DANGER_HEX),    "red")     // #FF5470
  assert.equal(hueFamilyOfHex(RC12_CAUTION_HEX),   "amber")   // #FFC93C
})

// ── Happy-path validations ───────────────────────────────────────────────────────────────────

test("a faithful native silent fixture validates and reports its type scale", () => {
  const audit = validateCaptureMetrics(nativeMetrics("silent"), nativeEntry("silent"))
  assert.deepEqual(audit.typeRankDefects, [])
  // The strict ladder steps are returned
  assert.ok(audit.typeScale.length >= 4)
  assert.equal(audit.typeScale[0].label, "battle gap")
  assert.equal(audit.typeScale[0].fontSize, 72)
})

test("a faithful native fastest-lap fixture validates with the alert surfaces and tag present", () => {
  const audit = validateCaptureMetrics(nativeMetrics("fastest-lap"), nativeEntry("fastest-lap"))
  assert.deepEqual(audit.typeRankDefects, [])
  // Tag step appears in the fastest-lap ladder between cell-position and ribbon
  const tagStep = audit.typeScale.find((s) => s.label === "tag")
  assert.ok(tagStep, "tag step must appear in the fastest-lap type scale")
  // alerts=silent on fastest-lap fails
  assertRejects(
    (m) => { m.stateAttributes.alerts = "silent" },
    /fastest-lap state must publish data-rc12-alerts="active"/,
    "fastest-lap"
  )
  // tag absent on fastest-lap fails
  assertRejects(
    (m) => { m.counted[4].count = 0 },
    /the fastest-lap state must render exactly one rc12-tag/,
    "fastest-lap"
  )
})

// Type-scale badge/lastLap rank

test("badge/lastLap strict rank is accepted at all governed viewports", () => {
  // Each iteration builds scaled-to-viewport geometries so assertInsideFrame passes at every size.
  for (const entry of RC12_CAPTURE_MATRIX) {
    const { width, height } = entry.size
    const wScale = width / 800, hScale = height / 480
    const sr = (l, t, w, h) => rect(
      Math.floor(l * wScale), Math.floor(t * hScale),
      Math.max(1, Math.floor(w * wScale)), Math.max(1, Math.floor(h * hScale))
    )
    const ribbonBox  = sr(0,   0, 800,  60)
    const boardBox   = sr(0,  60, 800, 320)
    const battleBox  = sr(0, 380, 800, 100)
    const battGapBox = sr(8, 394, 200,  72)
    const cellGapBox = sr(300,  64,  50,  24)
    const cellPosBox = sr(4,    64,  40,  22)
    const cellBadge  = sr(60,   64, 120,  16)
    const cellLL     = sr(450,  64,  90,  14)
    const sesTimeBox = sr(4,    20, 100,  12)
    const sesDoneBox = sr(120,  20,  40,  12)
    const sesTotBox  = sr(180,  20,  40,  12)
    const fastestLap = entry.state === "fastest-lap"
    const tagBox     = fastestLap ? sr(500, 64, 200, 18) : null
    const fastestRow = fastestLap ? sr(0, 300, 800, 40)  : null
    const metrics = nativeMetrics(entry.state)
    metrics.viewport = { width, height, dpr: 1 }
    metrics.page = { scrollWidth: width, clientWidth: width }
    metrics.root = rect(0, 0, width, height)
    metrics.shell = measured(rect(0, 0, width, height))
    metrics.canvas = { ...measured(rect(0, 0, width, height)), transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } }
    metrics.dashboardElement = measured(rect(0, 0, width, height))
    metrics.widget = measured(rect(0, 0, width, height))
    metrics.dashboard = measured(rect(0, 0, width, height))
    metrics.contentWidth = String(width)
    metrics.contentHeight = String(height)
    metrics.layout = entry.size.layout
    metrics.compactMode = entry.size.compactMode ?? null
    metrics.nativeSize = entry.size.layout === "native" ? "800x480" : null
    metrics.zones = [
      zone("ribbon", ribbonBox),
      zone("board",  boardBox),
      zone("battle", battleBox)
    ]
    const baseValues = [
      value("battle gap",         '[data-testid="rc12-battle-gap-value"]', "0.842",   battGapBox, 72),
      value("cell gap",           '[data-testid="rc12-cell-gap"]',          "0.8",    cellGapBox, 24),
      value("cell position",      '[data-testid="rc12-cell-position"]',     "1",      cellPosBox, 22),
      value("cell badge",         '[data-testid="rc12-cell-badge"]',        "CAR --", cellBadge,  16),
      value("cell last lap",      '[data-testid="rc12-cell-lastLap"]',      "1:38.4", cellLL,     14),
      value("session time",       '[data-testid="rc12-session-time"]',      "--",     sesTimeBox, 12),
      value("session laps done",  '[data-testid="rc12-session-laps-done"]', "--",     sesDoneBox, 12),
      value("session laps total", '[data-testid="rc12-session-laps-total"]',"--",     sesTotBox,  12)
    ]
    if (fastestLap && tagBox) {
      baseValues.push(value("tag", '[data-testid="rc12-tag"]', "FASTEST LAP", tagBox, 18))
    }
    metrics.values = baseValues
    metrics.containment = [
      owned("session time in ribbon", ribbonBox, sesTimeBox),
      owned("battle gap in battle",   battleBox, battGapBox)
    ]
    metrics.cyanScopes = fastestLap ? [tagBox, fastestRow].filter(Boolean) : []
    metrics.tagFontSize = fastestLap ? 18 : null
    if (entry.size.layout === "app") metrics.stateAttributes["app-only"] = "true"
    metrics.counted[3].count = entry.size.layout === "app" ? 1 : 0   // history zone
    metrics.counted[8].count = entry.size.layout === "native" ? 1 : 0 // safe frame
    const sizeKey = `${width}x${height}`
    const expectedRows = RC12_EXPECTED_ROW_COUNTS[sizeKey]
    metrics.stateAttributes.rows = String(expectedRows.rowCount)
    const populated = Math.min(RC12_FIELD_SIZE, expectedRows.rowCount)
    metrics.counted[0].count = expectedRows.rowCount
    metrics.counted[1].count = populated
    metrics.counted[2].count = fastestLap ? (expectedRows.rowCount >= 7 ? 1 : 0) : 0
    assert.doesNotThrow(
      () => validateCaptureMetrics(metrics, entry),
      `badge must outrank lastLap at ${sizeKey} in ${entry.state} state`
    )
  }
})

test("badge/lastLap tie or inversion is rejected", () => {
  assert.throws(
    () => {
      const m = nativeMetrics("silent")
      m.values[4].fontSize = 16  // lastLap ties badge
      validateCaptureMetrics(m, nativeEntry("silent"))
    },
    (error) => {
      assert.ok(error instanceof CaptureSafetyError)
      assert.match(error.message, /badge .* must be strictly larger than last-lap/)
      return true
    }
  )
})

// ── Zone geometry ────────────────────────────────────────────────────────────────────────────

test("overlapping zones fail closed while non-overlapping zones pass", () => {
  // Push board up into ribbon territory
  assertRejects((m) => { m.zones[1].top = -10 }, /zone ribbon overlaps board/)
  // A clean layout validates
  const metrics = nativeMetrics()
  validateCaptureMetrics(metrics, nativeEntry())
})

test("a zone outside the frame fails closed", () => {
  assertRejects((m) => { m.zones[2].top = 500 }, /battle is out of frame/)
})

// ── Overflow ledger ──────────────────────────────────────────────────────────────────────────

test("an unrecorded overflow fails", () => {
  // Overflow on an element not in knownDefects → rejected
  assertRejects(
    (m) => {
      m.overflowLeaves = [
        { key: "rc12-cell-badge", text: "CAR --", fontSize: 16, whiteSpace: "nowrap",
          clientWidth: 80, scrollWidth: 110, overflowX: 30, textLeft: 10, textRight: 120 }
      ]
    },
    /paints 30px wider than its 80px box/
  )
})

test("badge/lastLap regression guard rejects a synthetic tie and accepts a clean rank", () => {
  assertRejects((m) => { m.values[4].fontSize = 16 }, /DEFECT RC-12\/A regression|badge .* strictly larger/)
  assert.doesNotThrow(() => validateCaptureMetrics(nativeMetrics("silent"), nativeEntry("silent")))
})

test("fastest-lap tag span regression guard rejects overflow and accepts contained spans", () => {
  assertRejects(
    (m) => {
      m.overflowLeaves = [
        { key: "span", text: "FASTEST LAP", fontSize: 14.472, whiteSpace: "nowrap",
          clientWidth: 96, scrollWidth: 97, overflowX: 1, textLeft: 500, textRight: 597 }
      ]
    },
    /DEFECT RC-12\/B regression: fastest-lap tag span "FASTEST LAP" overflows its 96px box by 1px/,
    "fastest-lap"
  )

  const clean = nativeMetrics("fastest-lap")
  clean.tagSpanOverflows = [
    { text: "FASTEST LAP", clientWidth: 116, scrollWidth: 116, overflowPx: 0 },
    { text: "P7", clientWidth: 23, scrollWidth: 23, overflowPx: 0 },
    { text: "1:37.106", clientWidth: 89, scrollWidth: 89, overflowPx: 0 }
  ]
  assert.doesNotThrow(() => validateCaptureMetrics(clean, nativeEntry("fastest-lap")))
})

// ── Packet omissions ─────────────────────────────────────────────────────────────────────────

test("a digit in session clock readouts fails closed (omission: sessionClockChannel)", () => {
  assertRejects((m) => { m.values[5].text = "1:23:45" }, /session time reads .* instead of "--"/)
  assertRejects((m) => { m.values[6].text = "42" }, /session laps done reads .* instead of "--"/)
  assertRejects((m) => { m.values[7].text = "60" }, /session laps total reads .* instead of "--"/)
})

test("a badge that is not 'CAR --' fails closed (omission: entrantIdentityChannel)", () => {
  // Entrant name in rootText fails
  assertRejects(
    (m) => { m.rootText = m.rootText + "ENTRANT 5" },
    /capture text contains "ENTRANT 5"/
  )
  // Any ENTRANT text fails
  assertRejects(
    (m) => { m.rootText = m.rootText + "ENTRANT" },
    /capture text contains an entrant name/
  )
})

test("an entrant name from the fixture in the frame fails closed", () => {
  // Leaf texts must not carry any entrant name
  assertRejects(
    (m) => { m.leafTexts.push("ENTRANT 3") ; m.rootText = m.rootText + "ENTRANT 3" },
    /ENTRANT/
  )
})

test("more than 2 measured gap numerals fails closed (omission: fieldWideIntervalChannel)", () => {
  assertRejects(
    (m) => { m.numeralGapCount = 3 },
    /exactly 2 gap cells must carry a numeral/
  )
  // Zero numerals also fails
  assertRejects(
    (m) => { m.numeralGapCount = 0 },
    /exactly 2 gap cells must carry a numeral/
  )
})

test("a sector/split, tyre-age/pit-status, or pit-limiter element present fails closed", () => {
  assertRejects(
    (m) => { m.forbidden[0].count = 1 },
    /a sector or rolling-split readout.*must not be rendered/
  )
  assertRejects(
    (m) => { m.forbidden[1].count = 1 },
    /tyre age or pit-status readout.*must not be rendered/
  )
  assertRejects(
    (m) => { m.forbidden[2].count = 1 },
    /a pit-limiter readout.*must not be rendered/
  )
})

test("the NO TIMING SOURCE banner must be absent while a live feed is present", () => {
  assertRejects(
    (m) => { m.forbidden[3].count = 1 },
    /NO TIMING SOURCE banner.*must not be rendered/
  )
})

// ── Modifier / state mismatches ──────────────────────────────────────────────────────────────

test("a modifier disagreeing with the content box fails closed", () => {
  assertRejects((m) => { m.layout = "app" },      /layout modifier app does not match/)
  assertRejects((m) => { m.contentWidth = "801" }, /did not report its measured content box/)
  assertRejects((m) => { m.nativeSize = null },    /data-rc12-native-size must be/)
  assertRejects((m) => { m.bufferState = "duplicate" }, /accepted live frame/)
})

test("wrong preset or widget id fails closed", () => {
  assertRejects((m) => { m.presetId = "other_preset" }, /did not resolve the unmodified racecon_rc12_dash preset/)
  assertRejects((m) => { m.renderedWidgetId = "raceconRc08Dash" }, /did not resolve the unmodified racecon_rc12_dash preset/)
})

test("wrong capture state fails closed", () => {
  assertRejects((m) => { m.captureState = "fastest-lap" }, /rendered the fastest-lap scenario while capturing silent/)
})

test("a non-accepted buffer state fails closed", () => {
  assertRejects((m) => { m.bufferState = "stale" }, /accepted live frame/)
})

test("an empty readout (empty textOutputs) fails closed", () => {
  assertRejects((m) => { m.textOutputs = [""] }, /empty telemetry readout/)
})

test("silent state with active alerts fails closed", () => {
  assertRejects((m) => { m.stateAttributes.alerts = "active" }, /silent state must publish data-rc12-alerts="silent"/)
})

test("wrong timing state fails closed (must be live with connected fixture)", () => {
  assertRejects((m) => { m.stateAttributes.timing = "delayed" }, /data-rc12-timing must be "live"/)
})

test("wrong field size fails closed", () => {
  assertRejects((m) => { m.stateAttributes.field = "6" }, /data-rc12-field must be "8"/)
})

test("wrong measured-gaps count fails closed", () => {
  assertRejects((m) => { m.stateAttributes["measured-gaps"] = "3" }, /data-rc12-measured-gaps must be "2"/)
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
 * Synthetic RC-12 capture PNG.
 *
 * silent: canvas + gray content (no cyan)
 * fastest-lap: canvas + gray content + cyan in the tag/row scope
 *
 * strayRed / strayAmber: inject a forbidden hue pixel outside any scope.
 * cyanOutside: inject a cyan pixel outside the tag/row scope (for scope-test).
 */
function capturePng(state, { strayRed = false, strayAmber = false, blank = false, cyanOutside = false } = {}) {
  const size = CAPTURE_SIZES[0]
  const image = paintPng(size, CANVAS_RGB)

  if (!blank) {
    // Background content (non-canvas, non-hue-family-alerting)
    fillRect(image, rect(10, 10, 300, 200), GRAY_RGB)
  }

  if (state === "fastest-lap" && !blank) {
    // Cyan in the tag+fastest-row scope (inside the metric's cyanScopes)
    fillRect(image, rect(500, 4, 200, 18), CYAN_RGB)   // tag zone
    fillRect(image, rect(0, 244, 800, 40), CYAN_RGB)   // fastest row
  }

  if (cyanOutside) {
    // Cyan pixel outside any permitted scope — proves the scoped check
    fillRect(image, rect(2, 2, 8, 8), CYAN_RGB)
  }

  if (strayRed) {
    fillRect(image, rect(50, 50, 8, 8), DANGER_RGB)
  }

  if (strayAmber) {
    fillRect(image, rect(50, 50, 8, 8), AMBER_RGB)
  }

  return PNG.sync.write(image)
}

function metricsForPixel(state) {
  const m = nativeMetrics(state)
  if (state === "fastest-lap") {
    m.cyanScopes = [
      rect(500, 4, 200, 18),    // tag zone
      rect(0, 244, 800, 40)     // fastest row
    ]
  }
  return m
}

test("pixel audit accepts silent (no cyan, no red, no amber) and fastest-lap (cyan present+scoped) frames", () => {
  // Silent: no cyan, no red, no amber
  const silentAudit = validateCapturePixels(capturePng("silent"), nativeEntry("silent"), metricsForPixel("silent"))
  assert.equal(silentAudit.hueFamilies.cyan, 0)
  assert.equal(silentAudit.hueFamilies.red, 0)
  assert.equal(silentAudit.hueFamilies.amber, 0)
  // Fastest-lap: cyan present and zero outside scope
  const fastestAudit = validateCapturePixels(capturePng("fastest-lap"), nativeEntry("fastest-lap"), metricsForPixel("fastest-lap"))
  assert.ok(fastestAudit.hueFamilies.cyan > 0, "cyan must be present on the fastest-lap frame")
  assert.equal(fastestAudit.cyanOutside, 0)
})

test("a blank frame fails closed", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { blank: true }), nativeEntry("silent"), metricsForPixel("silent")),
    /capture is blank/
  )
})

test("cyan present on a SILENT frame is rejected", () => {
  const m = metricsForPixel("silent")
  // silent has no cyanScopes, so any cyan pixel triggers the absent check
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { cyanOutside: true }), nativeEntry("silent"), m),
    /must be absent/
  )
})

test("cyan absent on a FASTEST-LAP frame is rejected", () => {
  // A fastest-lap frame without any cyan pixels must fail
  const size = CAPTURE_SIZES[0]
  const image = paintPng(size, CANVAS_RGB)
  fillRect(image, rect(10, 10, 300, 200), GRAY_RGB)
  // No cyan pixels added
  const buffer = PNG.sync.write(image)
  assert.throws(
    () => validateCapturePixels(buffer, nativeEntry("fastest-lap"), metricsForPixel("fastest-lap")),
    /must be painted/
  )
})

test("cyan outside the tag/fastest-row scope on a fastest-lap frame is rejected", () => {
  // cyanOutside=true injects a cyan pixel at (2,2) which is outside cyanScopes
  assert.throws(
    () => validateCapturePixels(capturePng("fastest-lap", { cyanOutside: true }), nativeEntry("fastest-lap"), metricsForPixel("fastest-lap")),
    /fall outside/
  )
})

test("any red pixel on any RC-12 frame is rejected", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { strayRed: true }), nativeEntry("silent"), metricsForPixel("silent")),
    /must be absent/
  )
  assert.throws(
    () => validateCapturePixels(capturePng("fastest-lap", { strayRed: true }), nativeEntry("fastest-lap"), metricsForPixel("fastest-lap")),
    /must be absent/
  )
})

test("any amber pixel on any RC-12 frame is rejected", () => {
  assert.throws(
    () => validateCapturePixels(capturePng("silent", { strayAmber: true }), nativeEntry("silent"), metricsForPixel("silent")),
    /must be absent/
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
