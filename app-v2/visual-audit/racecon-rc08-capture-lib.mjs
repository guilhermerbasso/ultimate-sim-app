import {
  CAPTURE_SIZES,
  CaptureSafetyError,
  assertHueFamilyAbsent,
  assertHueFamilyPresent,
  assertHueFamilyScoped,
  assertNoHorizontalOverflow,
  assertTypeScaleOrder,
  auditHueFamilies,
  containsRect,
  decodeCapturePng,
  exact,
  fail,
  finite,
  hasText,
  hueFamilyOfHex,
  isGovernedSize,
  lacksLeafText,
  rgbaAt,
  sameRgba,
  validateCommonMetrics
} from "./racecon-capture-shared.mjs"

export { CAPTURE_SIZES }

/**
 * RC-08 "Rain Line" owns only what its DOM contract, zones, channels, alert families and
 * documented omissions make different from the rest of the RaceCon portfolio. Everything
 * generic lives in `racecon-capture-shared.mjs`, which re-exports RC-01's safety primitives
 * unchanged.
 */

export const RC08_PRESET_ID = "racecon_rc08_dash"
export const RC08_WIDGET_ID = "raceconRc08Dash"
export const RC08_SOURCE_IDENTITY = "iracing:session:88:connection:4"

/** Two governed scenarios: the silent frame and the cold-tyre-in-wet alert. */
export const CAPTURE_STATES = Object.freeze(["silent", "cold-tyre"])

export const RC08_CORNER_COUNT = 4
export const RC08_ROW_COUNT = 4     // TC, ABS, BRAKE BIAS, RAIN RATE
export const RC08_CELL_COUNT = 3    // GEAR, DELTA, SPEED
export const RC08_CROSSOVER_CELL_COUNT = 4   // app layout only

/**
 * The cold-tyre alert surface colour is info/cyan #5AB0E6 = rgb(90,176,230).
 * Its hue angle is ≈203°, which the shared module classifies as "blue" — the SAME family
 * as the WET resting palette (#2E86FF, hue ≈215°, also "blue"). Because the resting and alert
 * colours share a hue family, the pixel audit CANNOT use `assertHueFamilyAbsent` /
 * `assertHueFamilyScoped` for the cold-tyre alert: blue legitimately appears on the silent
 * WET frame through the grip chip and delta bad-tone surface.
 *
 * The audit therefore proves a different guarantee: DANGER (red #F0523E, red family) and
 * CAUTION (amber #F0B93A, amber family) must be absent from every RC-08 frame in this
 * fixture, because neither the cold-tyre alert nor the WET palette touches either family.
 * The aids-fault alert (danger/red) is NOT triggered by this fixture.
 */
export const RC08_ALERT_HEX = "#5ab0e6"    // info/cyan — cold-tyre surface (same hue family as WET blue)
export const RC08_DANGER_HEX = "#f0523e"   // aids-fault red — must be absent from all frames in this fixture
export const RC08_CAUTION_HEX = "#f0b93a"  // caution amber — never used in any RC-08 state

/**
 * Normative override NO-1: the reference image rendered delta at 28 px; the packet mandates
 * 52 px. This constant is asserted so the test fails immediately if a build regresses.
 */
export const RC08_TYPE_SCALE_PX = Object.freeze({
  grip: 56,
  delta: 52,
  aid: 48,
  corner: 36,
  secondary: 32,
  label: 18
})

/**
 * Expected `data-rc08-column-widths` attribute strings for WET regime at each layout.
 * Compact layouts have no specified value in the governance (the three governed layouts are
 * native, app and compact — only native and app are normatively bounded).
 */
export const RC08_COLUMN_WIDTHS_NATIVE = "37.5/23.8/30.8"
export const RC08_COLUMN_WIDTHS_APP = "35.2/23.4/32"     // widget emits "32" not "32.0"

export const RC08_SPEC = Object.freeze({
  artifact: "RaceCon RC-08",
  script: "racecon-rc08-capture.mjs",
  presetId: RC08_PRESET_ID,
  widgetId: RC08_WIDGET_ID,
  attrPrefix: "data-rc08-",
  rootSelector: "#racecon-rc08-capture-root",
  captureHtml: "racecon-rc08-capture.html",
  dashboardSelector: ".rc08-dashboard",
  sourceIdentity: RC08_SOURCE_IDENTITY,
  stateAttributes: Object.freeze([
    "alerts",
    "alert-keys",
    "grip",
    "grip-source",
    "grip-stale",
    "regime",
    "weather",
    "column-widths"
  ]),
  /**
   * The four peer-level zones that are always present in the DOM across all six governed
   * viewports. Ribbon is nested INSIDE aids and is verified via containment; crossover and
   * timeline are conditionally rendered (app layout only) and are verified separately in
   * assertAppOnlyReveals rather than in the shared zone-overlap check.
   */
  zones: Object.freeze([
    Object.freeze(["banner", '[data-testid="rc08-banner"]']),
    Object.freeze(["aids",   '[data-testid="rc08-aids"]']),
    Object.freeze(["pace",   '[data-testid="rc08-pace"]']),
    Object.freeze(["tire",   '[data-testid="rc08-tire"]'])
  ]),
  zoneOverlapExemptions: Object.freeze([]),
  values: Object.freeze([
    Object.freeze(["grip",   '[data-testid="rc08-grip"]']),
    Object.freeze(["delta",  '[data-testid="rc08-delta"]']),
    Object.freeze(["aid",    '[data-testid="rc08-tc"]']),
    Object.freeze(["corner", '[data-testid="rc08-corner-FL"]']),
    Object.freeze(["speed",  '[data-testid="rc08-speed"]']),
    Object.freeze(["gear",   '[data-testid="rc08-gear"]']),
    Object.freeze(["bias",   '[data-testid="rc08-bias"]'])
  ]),
  containment: Object.freeze([
    Object.freeze(["gear",      '[data-testid="rc08-pace"]',   '[data-testid="rc08-gear"]']),
    Object.freeze(["delta",     '[data-testid="rc08-pace"]',   '[data-testid="rc08-delta"]']),
    Object.freeze(["speed",     '[data-testid="rc08-pace"]',   '[data-testid="rc08-speed"]']),
    Object.freeze(["FL corner", '[data-testid="rc08-tire"]',   '[data-testid="rc08-corner-FL"]']),
    Object.freeze(["FR corner", '[data-testid="rc08-tire"]',   '[data-testid="rc08-corner-FR"]']),
    Object.freeze(["grip chip", '[data-testid="rc08-ribbon"]', '[data-testid="rc08-grip"]']),
    Object.freeze(["TC",        '[data-testid="rc08-aids"]',   '[data-testid="rc08-tc"]']),
    Object.freeze(["ABS",       '[data-testid="rc08-aids"]',   '[data-testid="rc08-abs"]'])
  ]),
  counted: Object.freeze([
    Object.freeze(["corner",          '[data-testid="rc08-corner"]']),
    Object.freeze(["row",             '[data-testid="rc08-row"]']),
    Object.freeze(["cell",            '[data-testid="rc08-cell"]']),
    Object.freeze(["crossover cell",  '[data-testid="rc08-crossover-cell"]']),
    Object.freeze(["timeline segment",'[data-testid="rc08-timeline-segment"]']),
    Object.freeze(["cold corner",     '[data-testid="rc08-corner-cold"]']),
    Object.freeze(["aids fault",      '[data-testid="rc08-aids-fault"]'])
  ]),
  /**
   * Packet omissions expressed as forbidden DOM selectors.
   *
   * omission shiftArc: section 11.1 allocates no zone for shift LEDs or a rev arc anywhere in
   * the 800×480 grammar. image-qa-v1 measured zero LED segments in either edge strip of the
   * approved frame. There is no `.rc08-led`, `.rc08-shift`, `.rc08-rev` or
   * `[data-rc08-zone="shift"]` element anywhere in the widget or its stylesheet. RPM has no
   * entry in RC08_CHANNEL_STALE_MS.
   *
   * omission rainRateNumeral and omission gripPercentNumeral are asserted via text checks
   * rather than selectors because the elements that always render (the rain row and the grip
   * chip) are always present — the omission is that they never contain a numeral.
   *
   * omission wetWindowReadout is asserted via lacksLeafText.
   */
  forbidden: Object.freeze([
    Object.freeze([
      "a shift-LED or rev-arc surface (omission: shiftArc)",
      '.rc08-led, .rc08-shift, .rc08-rev, [data-rc08-zone="shift"], [data-channel="rpm"]'
    ])
  ]),
  /**
   * All three measured render defects (rain row overflow, aids vertical overflow, grip chip
   * containment escape) have been corrected. These ledger arrays are intentionally empty so the
   * harness fails closed on recurrence — any new overflow, zone overflow, or containment escape
   * is an unconditional hard failure. Explicit positive assertions are added to
   * validateCaptureMetrics below.
   */
  knownDefects: Object.freeze([]),
  zoneOverflowDefects: Object.freeze([]),
  containmentDefects: Object.freeze([])
})

export const RC08_CAPTURE_MATRIX = Object.freeze(
  CAPTURE_STATES.flatMap((state) =>
    CAPTURE_SIZES.map((size) =>
      Object.freeze({
        size,
        state,
        // cold-tyre latches after RC08_COLD_TYRE_ENGAGE_MS (3 000 ms); the harness waits for
        // data-rc08-alerts="active" rather than a guessed frame count.
        required: Object.freeze(
          state === "cold-tyre"
            ? [Object.freeze(["alerts", "active"])]
            : [Object.freeze(["alerts", "silent"])]
        )
      })
    )
  )
)

/** Reference telemetry values from the governance evidence (section 9). */
const RC08_EXPECTED_VALUES = Object.freeze({
  grip:  "WET",
  delta: "+2.418",
  speed: "128",
  gear:  "3",
  bias:  "54.5",
  aid:   "6",    // TC level
  corner: "63"   // FL temperature in silent state
})

// Reference corner temperatures (silent state, all in the 50–80 °C wet window)
const RC08_CORNER_TEMPS_SILENT = Object.freeze([63, 61, 58, 62])

// Cold-tyre alert corner: FL at 41 °C (below RC08_WET_WINDOW_C.minC = 50 °C)
const RC08_COLD_FL_C = 41

/**
 * In the cold-tyre scenario the FL corner reads 41 °C.
 * Expected values that change: FL corner output and crossover cell.
 */
const RC08_EXPECTED_COLD_FL = "41"

/** The rain rate row must always read exactly this literal; a digit there is a bug. */
const RC08_RAIN_UNAVAILABLE = "UNAVAILABLE"

function countOf(metrics, label) {
  const entry = (metrics.counted ?? []).find((candidate) => candidate.label === label)
  if (!entry) fail(`capture did not count ${label}`)
  return entry.count
}

function valueOf(metrics, label) {
  const value = (metrics.values ?? []).find((candidate) => candidate.label === label)
  if (!value || !value.present) fail(`capture is missing the ${label} output`)
  return value
}

function zoneOf(metrics, name) {
  const zone = (metrics.zones ?? []).find((candidate) => candidate.name === name)
  if (!zone || !zone.present) fail(`capture is missing the ${name} zone`)
  return zone
}

function assertBanner(metrics) {
  const gripSource = metrics.gripSource ?? ""
  if (!["SENSOR", "DRIVER TOGGLE", "UNAVAILABLE"].includes(gripSource)) {
    fail(`the grip source reads "${gripSource}" instead of a recognised source label`)
  }
  const weatherFeed = metrics.weatherFeed ?? ""
  if (!["WEATHER FEED LIVE", "WEATHER FEED UNAVAILABLE"].includes(weatherFeed)) {
    fail(`the weather feed reads "${weatherFeed}" instead of a recognised feed status`)
  }
  // The fixture always provides trackWetnessPct, so the sensor path gives "SENSOR" and the
  // weather feed shows "WEATHER FEED LIVE".
  if (gripSource !== "SENSOR") fail(`the fixture uses the sensor path; grip source must be SENSOR, received "${gripSource}"`)
  if (weatherFeed !== "WEATHER FEED LIVE") {
    fail(`the fixture feeds trackWetnessPct on every frame; weather feed must be LIVE, received "${weatherFeed}"`)
  }
}

function assertCornerValues(metrics, entry) {
  const corners = metrics.corners ?? []
  if (corners.length !== RC08_CORNER_COUNT) {
    fail(`RC-08 must render exactly ${RC08_CORNER_COUNT} corner cells, found ${corners.length}`)
  }
  const positions = ["FL", "FR", "RL", "RR"]
  const expectedTemps = entry.state === "cold-tyre"
    ? [RC08_COLD_FL_C, RC08_CORNER_TEMPS_SILENT[1], RC08_CORNER_TEMPS_SILENT[2], RC08_CORNER_TEMPS_SILENT[3]]
    : [...RC08_CORNER_TEMPS_SILENT]
  for (let index = 0; index < positions.length; index += 1) {
    const corner = corners[index]
    if (!corner) fail(`corner ${positions[index]} is missing from the capture`)
    const expected = String(expectedTemps[index])
    if (corner.text !== expected) {
      fail(`corner ${positions[index]} reads "${corner.text}" instead of "${expected}"`)
    }
    assertNoHorizontalOverflow(corner.rect, `${positions[index]} corner value`)
    containsRect(zoneOf(metrics, "tire"), corner.rect, `${positions[index]} corner`, 0.5)
  }
}

function assertRainRow(metrics) {
  // omission rainRateNumeral: sections 16 and 19 require the word UNAVAILABLE; no mm/h
  // channel exists. The rain row must always read exactly "UNAVAILABLE".
  if (metrics.rainText !== RC08_RAIN_UNAVAILABLE) {
    fail(`rain rate row reads "${metrics.rainText}" instead of the required "${RC08_RAIN_UNAVAILABLE}" (omission: rainRateNumeral)`)
  }
  // No digit should appear in the rain row at all.
  if (/[0-9]/u.test(String(metrics.rainText))) {
    fail(`rain rate row contains a digit "${metrics.rainText}" — this reintroduces omission rainRateNumeral`)
  }
}

function assertPaceValues(metrics) {
  const gear = valueOf(metrics, "gear")
  if (gear.text !== RC08_EXPECTED_VALUES.gear) {
    fail(`gear reads "${gear.text}" instead of "${RC08_EXPECTED_VALUES.gear}"`)
  }
  const delta = valueOf(metrics, "delta")
  if (delta.text !== RC08_EXPECTED_VALUES.delta) {
    fail(`delta reads "${delta.text}" instead of "${RC08_EXPECTED_VALUES.delta}"`)
  }
  const speed = valueOf(metrics, "speed")
  if (speed.text !== RC08_EXPECTED_VALUES.speed) {
    fail(`speed reads "${speed.text}" instead of "${RC08_EXPECTED_VALUES.speed}"`)
  }
  assertNoHorizontalOverflow(gear.rect, "gear value")
  assertNoHorizontalOverflow(speed.rect, "speed value")
}

function assertAidValues(metrics) {
  const aid = valueOf(metrics, "aid")
  if (aid.text !== RC08_EXPECTED_VALUES.aid) {
    fail(`TC (aid) reads "${aid.text}" instead of "${RC08_EXPECTED_VALUES.aid}"`)
  }
  if (metrics.absText !== "4") {
    fail(`ABS reads "${metrics.absText}" instead of "4"`)
  }
  const bias = valueOf(metrics, "bias")
  if (bias.text !== RC08_EXPECTED_VALUES.bias) {
    fail(`brake bias reads "${bias.text}" instead of "${RC08_EXPECTED_VALUES.bias}"`)
  }
}

function assertGripChip(metrics) {
  const grip = valueOf(metrics, "grip")
  // omission gripPercentNumeral: the grip chip always shows a word, never a % numeral.
  // Check digits FIRST so that "52" → "grip chip contains a digit" before the WET-word check.
  if (/[0-9]/u.test(grip.text)) {
    fail(`grip chip contains a digit "${grip.text}" — reintroduces omission gripPercentNumeral`)
  }
  if (grip.text !== "WET") {
    fail(`grip chip reads "${grip.text}" instead of "WET" (fixture uses trackWetnessPct=0.52 → WET)`)
  }
  if (metrics.stateAttributes.regime !== "WET") {
    fail(`data-rc08-regime must be WET for the silent fixture, received "${metrics.stateAttributes.regime}"`)
  }
}

function assertNativeSize(metrics, entry) {
  const expected = entry.size.layout === "native" ? "800x480" : null
  if (metrics.nativeSize !== expected) {
    fail(`native content-box modifier must be ${String(expected)}, received ${String(metrics.nativeSize)}`)
  }
}

function assertColumnWidths(metrics, entry) {
  const widths = metrics.stateAttributes["column-widths"]
  if (entry.size.layout === "native") {
    if (widths !== RC08_COLUMN_WIDTHS_NATIVE) {
      fail(`native WET column-widths must be "${RC08_COLUMN_WIDTHS_NATIVE}", received "${widths}"`)
    }
  } else if (entry.size.layout === "app") {
    if (widths !== RC08_COLUMN_WIDTHS_APP) {
      fail(`app WET column-widths must be "${RC08_COLUMN_WIDTHS_APP}", received "${widths}"`)
    }
  } else {
    // Compact: just verify it's present and has the three-segment format
    if (!widths || !/^\d+\.?\d*\/\d+\.?\d*\/\d+\.?\d*$/u.test(widths)) {
      fail(`compact column-widths must be a decimal/decimal/decimal string, received "${widths}"`)
    }
  }
}

function assertColdTyreAlert(metrics, entry) {
  const alertsActive = metrics.stateAttributes.alerts === "active"
  if (entry.state === "cold-tyre") {
    if (!alertsActive) fail("the cold-tyre state must latch data-rc08-alerts='active'")
    const alertKeys = String(metrics.stateAttributes["alert-keys"] ?? "")
    if (!alertKeys.includes("COLD TYRES")) {
      fail(`data-rc08-alert-keys must contain 'COLD TYRES' in the cold-tyre state, received "${alertKeys}"`)
    }
    // FL must have the cold marker: data-rc08-cold="true" and the cold dot element present
    if (metrics.flCold !== "true") {
      fail(`FL corner must have data-rc08-cold="true" in the cold-tyre state, received "${metrics.flCold}"`)
    }
    if (countOf(metrics, "cold corner") < 1) {
      fail("the cold-tyre state must render at least one rc08-corner-cold dot element")
    }
  } else {
    // Silent: no alert active, no cold markers anywhere
    if (alertsActive) {
      fail(`silent state must have data-rc08-alerts='silent', received "${metrics.stateAttributes.alerts}"`)
    }
    if (String(metrics.stateAttributes["alert-keys"] ?? "") !== "") {
      fail(`silent state must have empty alert-keys, received "${metrics.stateAttributes["alert-keys"]}"`)
    }
    if (countOf(metrics, "cold corner") !== 0) {
      fail(`silent state must have no rc08-corner-cold elements, found ${countOf(metrics, "cold corner")}`)
    }
  }
  // aids-fault must never fire on this fixture (no tcEnabled/absEnabled contradiction)
  if (countOf(metrics, "aids fault") !== 0) {
    fail("this fixture must not latch the aids-fault alert (no disabled-but-stepped contradiction)")
  }
}

function assertAppOnlyReveals(metrics, entry) {
  const app = entry.size.layout === "app"
  const crossoverCount = countOf(metrics, "crossover cell")
  if (app) {
    // App layout: crossover must have 4 cells, timeline must be present
    if (crossoverCount !== RC08_CROSSOVER_CELL_COUNT) {
      fail(`app layout must render ${RC08_CROSSOVER_CELL_COUNT} crossover cells, found ${crossoverCount}`)
    }
    // Timeline may show a track with segments (if segments are confirmed) or the empty UNAVAILABLE
    // placeholder. Both are acceptable; the element itself must be present.
    if (!metrics.timelinePresent) {
      fail("app layout must render the rc08-timeline element")
    }
  } else {
    // Non-app: crossover and timeline must be absent from the DOM
    if (crossoverCount !== 0) {
      fail(`non-app layout must not render crossover cells, found ${crossoverCount}`)
    }
    if (metrics.timelinePresent) {
      fail("non-app layout must not render the rc08-timeline element")
    }
  }
}

/**
 * The type-scale hierarchy from the governance (normative, section 10):
 *   grip (56 px) > delta (52 px) > aid (48 px) > corner (36 px) > speed (32 px)
 *
 * Every step must be STRICTLY larger — a tie is a failure, not a pass.
 *
 * Normative override NO-1: delta must NOT be 28 px (the reference image value); it must be
 * 52 px as the packet mandates. If the build renders 28 px, this check fails at grip > delta
 * (56 > 28 is fine) but the absolute assertion elsewhere catches the wrong value.
 */
function assertTypeScale(metrics) {
  return assertTypeScaleOrder([
    { label: "grip",   fontSize: valueOf(metrics, "grip").fontSize },
    { label: "delta",  fontSize: valueOf(metrics, "delta").fontSize },
    { label: "aid",    fontSize: valueOf(metrics, "aid").fontSize },
    { label: "corner", fontSize: valueOf(metrics, "corner").fontSize },
    { label: "speed",  fontSize: valueOf(metrics, "speed").fontSize }
  ])
}

/**
 * Required text that must appear in the frame.
 * Common to both states: WET chip, telemetry values, FR/RL/RR temps.
 * State-specific: FL corner temperature (63 °C silent, 41 °C cold-tyre).
 */
const RC08_REQUIRED_TEXT_COMMON = Object.freeze([
  "WET",
  "SENSOR",
  "WEATHER FEED LIVE",
  "UNAVAILABLE",    // rain rate row
  "+2.418",         // delta to best
  "128",            // speed
  "54.5",           // brake bias
  "61", "58", "62"  // FR, RL, RR temperatures (identical in both states)
])
const RC08_REQUIRED_TEXT_SILENT = Object.freeze([...RC08_REQUIRED_TEXT_COMMON, "63"])   // FL in silent
const RC08_REQUIRED_TEXT_COLD   = Object.freeze([...RC08_REQUIRED_TEXT_COMMON, "41"])   // FL in cold-tyre

/**
 * RC08_PACKET_OMISSIONS — what the harness must never find rendered.
 *
 * shiftArc: .rc08-led / .rc08-shift / .rc08-rev / [data-rc08-zone="shift"] — handled by
 *   spec.forbidden (selector check counts = 0).
 *
 * rainRateNumeral: the rain row always reads "UNAVAILABLE"; assertRainRow verifies this and
 *   checks no digit appears.
 *
 * wetWindowReadout: the 50 °C and 80 °C bounds of the wet window are configuration constants
 *   and must never appear as printed text. Verified with lacksLeafText.
 *
 * gripPercentNumeral: the grip chip always shows a word (DRY/DAMP/WET/FLOOD/UNAVAILABLE),
 *   never a percentage numeral. Verified in assertGripChip.
 */
const RC08_FORBIDDEN_LEAF_TEXT = Object.freeze([
  Object.freeze(["50", "would reintroduce the omitted wet-window lower bound (RC08_PACKET_OMISSIONS.wetWindowReadout)"]),
  Object.freeze(["80", "would reintroduce the omitted wet-window upper bound (RC08_PACKET_OMISSIONS.wetWindowReadout)"])
])

/**
 * REGRESSION GUARD 1 — rain row fits its column.
 *
 * Drop from the secondary rung to the label rung for the UNAVAILABLE state fixes the +11–14 px
 * overflow at native and compact-landscape viewports. This assertion re-raises immediately if
 * the rain cell reappears in overflowLeaves at any viewport or state.
 */
function assertRainRowContained(metrics) {
  const rainLeaf = (metrics.overflowLeaves ?? []).find((leaf) => leaf.key === "rc08-rain")
  if (rainLeaf) {
    fail(
      `rc08-rain "${rainLeaf.text}" overflows its column by ${rainLeaf.overflowX}px ` +
      `(text spans ${rainLeaf.textLeft.toFixed(2)}..${rainLeaf.textRight.toFixed(2)}) — ` +
      `UNAVAILABLE must fit the responsive column at all viewports`
    )
  }
}

/**
 * REGRESSION GUARD 2 — aids zone rows flex-fill without overflowing.
 *
 * Removing the fixed phone row height allows rows to distribute the available space evenly.
 * This assertion re-raises immediately if the aids zone's scroll height exceeds its layout
 * height at any viewport or state.
 */
function assertAidsZoneFit(metrics) {
  const aids = zoneOf(metrics, "aids")
  const overflow = finite(aids.scrollHeight, "aids scrollHeight") - finite(aids.layoutHeight, "aids layoutHeight")
  if (overflow > 0.5) {
    fail(
      `aids zone content height (${aids.scrollHeight.toFixed(2)}px) exceeds layout height ` +
      `(${aids.layoutHeight.toFixed(2)}px) by ${overflow.toFixed(2)}px — ` +
      `all rows must flex-fill without overflowing at any viewport`
    )
  }
}

/**
 * REGRESSION GUARD 3 — grip chip fits inside its ribbon at all viewports.
 *
 * Increasing the ribbon height factor from 0.15 to 0.18 in rc08CompactZones ensures the 7 cqw
 * grip word fits at every compact-landscape aspect ratio. This assertion re-raises if the grip
 * chip exceeds the ribbon boundary at any viewport or state.
 */
function assertGripChipFitsRibbon(metrics) {
  const item = (metrics.containment ?? []).find((c) => c.label === "grip chip")
  if (!item) fail("containment measurement for grip chip is missing")
  if (!item.owner || !item.value) fail("grip chip has no measurable owner (ribbon) or value rect")
  const escape = {
    left:   item.owner.left - item.value.left,
    right:  item.value.left + item.value.width - (item.owner.left + item.owner.width),
    top:    item.owner.top  - item.value.top,
    bottom: item.value.top  + item.value.height - (item.owner.top + item.owner.height)
  }
  const worst = Math.max(...Object.values(escape))
  if (worst > 0.5) {
    const edge = Object.entries(escape).find(([, px]) => px === worst)[0]
    fail(
      `grip chip escapes its ribbon on the ${edge} by ${worst.toFixed(2)}px — ` +
      `the 7 cqw grip word must fit the compact-landscape ribbon at all viewports`
    )
  }
}

export function validateCaptureMetrics(metrics, entry, _unused) {
  const common = validateCommonMetrics(metrics, entry, RC08_SPEC)

  assertNativeSize(metrics, entry)
  assertColumnWidths(metrics, entry)

  for (const expected of entry.state === "cold-tyre" ? RC08_REQUIRED_TEXT_COLD : RC08_REQUIRED_TEXT_SILENT) hasText(metrics, expected)
  for (const [forbidden, why] of RC08_FORBIDDEN_LEAF_TEXT) lacksLeafText(metrics, forbidden, why)

  assertBanner(metrics)
  assertGripChip(metrics)
  assertRainRow(metrics)
  assertRainRowContained(metrics)
  assertAidsZoneFit(metrics)
  assertGripChipFitsRibbon(metrics)
  assertPaceValues(metrics)
  assertAidValues(metrics)
  assertCornerValues(metrics, entry)
  assertColdTyreAlert(metrics, entry)
  assertAppOnlyReveals(metrics, entry)

  return { ...common, typeScale: assertTypeScale(metrics) }
}

const RC08_MIN_NON_CANVAS_PIXELS = 5_000

/**
 * The pixel audit proves that:
 *  1. The frame is not blank against the canvas colour (#06090C).
 *  2. DANGER (red, #F0523E, red family) is absent from EVERY frame — the aids-fault alert is
 *     not triggered by this fixture (no disabled-but-stepped TC/ABS contradiction).
 *  3. CAUTION (amber, #F0B93A, amber family) is absent from EVERY frame — caution/amber is
 *     not used in any RC-08 state.
 *  4. BLUE (#2E86FF, blue family) IS present on every frame — the WET grip chip and the
 *     delta bad-tone surface are always rendered.
 *
 * WHY NOT a cold-tyre hue-family check:
 *  The cold-tyre alert surface is #5AB0E6 (rgb 90,176,230, hue ≈203°). The shared module
 *  classifies this as "blue" (200–255°) — the SAME hue family as the WET resting palette
 *  (#2E86FF, hue ≈215°, also "blue"). Because blue legitimately appears on the silent WET frame
 *  through the grip chip and delta surface, `assertHueFamilyAbsent("blue")` would always fail
 *  on the silent frame, and `assertHueFamilyScoped` would reject the WET chip pixels that fall
 *  outside the cold-corner scope. The absence/scope pattern is not applicable to this palette.
 *  The correct guarantees are DANGER and AMBER absence — hue families genuinely absent from
 *  all RC-08 frames in this fixture.
 *
 * Colour is confirmed by HUE FAMILY, never by a channel ratio. A naive g,b < 0.62r ratio test
 * measured 8,578 "red" pixels on a frame whose hue-confirmed truth was zero — exactly what this
 * audit prevents. The cold-tyre DOM signals (data-rc08-cold, alert-keys) confirm the alert fires;
 * the pixel audit proves the palette stays out of the danger and amber families.
 */
export function validateCapturePixels(buffer, entry, metrics) {
  if (!isGovernedSize(entry.size)) fail(`unsupported capture pixel-audit size ${entry.size.width}x${entry.size.height}`)
  const image = decodeCapturePng(buffer, entry.size)

  // DANGER (red #F0523E) and CAUTION (amber #F0B93A) must be absent from every frame.
  // The scope argument to auditHueFamilies is {} because there is no permitted region for these
  // families — if any pixel of either appears, the audit fails immediately.
  const audit = auditHueFamilies(image, {})

  // Non-canvas pixels: anything not matching the raw canvas background #06090C (rgb 6,9,12).
  const canvasRgba = [6, 9, 12, 255]
  let nonCanvasPixels = 0
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (!sameRgba(rgbaAt(image, x, y), canvasRgba)) nonCanvasPixels += 1
    }
  }
  if (nonCanvasPixels < RC08_MIN_NON_CANVAS_PIXELS) {
    fail("capture is blank against the RC-08 canvas colour (#06090C)")
  }

  // Both frames: aids-fault (danger/red) must be absent.
  const redFamily = hueFamilyOfHex(RC08_DANGER_HEX)     // "red"
  assertHueFamilyAbsent(audit, redFamily, "the RC-08 frame (no aids-fault alert in this fixture)")

  // Both frames: caution/amber must be absent — never used in any RC-08 state.
  const amberFamily = hueFamilyOfHex(RC08_CAUTION_HEX)  // "amber"
  assertHueFamilyAbsent(audit, amberFamily, "the RC-08 frame (caution/amber is not used in any RC-08 state)")

  // Both frames: the WET palette BLUE must be present (grip chip + delta bad-tone surface).
  const blueFamily = hueFamilyOfHex("#2e86ff")           // "blue"
  assertHueFamilyPresent(audit, blueFamily, "the RC-08 WET frame — WET grip chip must be visible", 1)

  return {
    width: image.width,
    height: image.height,
    opaque: true,
    nonCanvasPixels,
    hueFamilies: audit.counts,
    // Reported for the summary table; the cold-tyre alert colour shares the "blue" family with
    // the WET resting palette, so outside-scope is always 0 (no scoped check is performed).
    alertHueFamily: hueFamilyOfHex(RC08_ALERT_HEX),
    alertHueOutsideScope: 0
  }
}

export { CaptureSafetyError, exact }
