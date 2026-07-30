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
 * RC-03 "Long Night" owns only what its DOM contract, zones, channels, alert families and
 * documented omissions make different from the rest of the RaceCon portfolio. Every generic
 * capture property — the governed viewport matrix, the breakpoint contract, the geometry
 * measurement helpers, the shared metric contract, the pixel primitives and the whole capture
 * lifecycle including the disk-safety gates — comes from `racecon-capture-shared.mjs`, which in
 * turn re-exports RC-01's safety primitives unchanged.
 */

export const RC03_PRESET_ID = "racecon_rc03_dash"
export const RC03_WIDGET_ID = "raceconRc03Dash"
export const RC03_SOURCE_IDENTITY = "iracing:session:88:connection:4"

/** Two governed scenarios: the silent frame, and the low-oil-pressure alarm. */
export const CAPTURE_STATES = Object.freeze(["silent", "oil-alarm"])

export const RC03_VITAL_COUNT = 4
export const RC03_RAIL_ROW_COUNT = 3
export const RC03_BURN_HISTORY_LIMIT = 5

/** image-qa-v2 note 1: the bar fraction is the telemetry ratio, never a pixel from the reference. */
export const RC03_EXPECTED_FUEL_FILL = 41.8 / 110
/** The ribbon is the only RPM surface, so its fill must be exactly the engine-speed ratio. */
export const RC03_EXPECTED_RIBBON_FILL = 6_048 / 8_400

/** The only red token in the RC-03 palette. It may never be painted on a silent frame. */
export const RC03_DANGER_HEX = "#e24438"

export const RC03_SPEC = Object.freeze({
  artifact: "RaceCon RC-03",
  script: "racecon-rc03-capture.mjs",
  presetId: RC03_PRESET_ID,
  widgetId: RC03_WIDGET_ID,
  attrPrefix: "data-rc03-",
  rootSelector: "#racecon-rc03-capture-root",
  captureHtml: "racecon-rc03-capture.html",
  dashboardSelector: ".rc03-dashboard",
  sourceIdentity: RC03_SOURCE_IDENTITY,
  stateAttributes: Object.freeze(["brightness", "vitals-page", "fuel-window", "oil-alarm", "overheat"]),
  zones: Object.freeze([
    Object.freeze(["ribbon", ".rc03-ribbon"]),
    Object.freeze(["pace", ".rc03-pace"]),
    Object.freeze(["stint-clock", ".rc03-stint-clock"]),
    Object.freeze(["vitals", ".rc03-vitals"]),
    Object.freeze(["fuel", ".rc03-fuel"]),
    Object.freeze(["rail", ".rc03-rail"])
  ]),
  // Packet 11.1 places the stint clock over the pace band's reserved right corner. The band
  // declares `padding-right` for exactly that overlap, so the pair is exempt and every other
  // pair stays a real overlap check.
  zoneOverlapExemptions: Object.freeze([Object.freeze(["pace", "stint-clock"])]),
  values: Object.freeze([
    Object.freeze(["gear", '[data-rc03-zone="gear"] .rc03-gear']),
    Object.freeze(["delta", '[data-rc03-zone="delta"] .rc03-delta']),
    Object.freeze(["speed", '[data-rc03-zone="speed"] .rc03-speed']),
    Object.freeze(["stint clock", ".rc03-stint-clock .rc03-clock"]),
    Object.freeze(["fuel laps", '[data-rc03-zone="fuel-laps"] .rc03-fuel-laps']),
    Object.freeze(["fuel level", '[data-rc03-zone="fuel-bar"] .rc03-fuel-level']),
    Object.freeze(["stint lap", '[data-rc03-zone="stint-lap"] .rc03-stint-lap'])
  ]),
  containment: Object.freeze([
    Object.freeze(["gear", ".rc03-pace", '[data-rc03-zone="gear"] .rc03-gear']),
    Object.freeze(["delta", ".rc03-pace", '[data-rc03-zone="delta"] .rc03-delta']),
    Object.freeze(["speed", ".rc03-pace", '[data-rc03-zone="speed"] .rc03-speed']),
    Object.freeze(["stint clock", ".rc03-stint-clock", ".rc03-stint-clock .rc03-clock"]),
    Object.freeze(["fuel laps", ".rc03-fuel", '[data-rc03-zone="fuel-laps"] .rc03-fuel-laps']),
    Object.freeze(["fuel level", ".rc03-fuel", '[data-rc03-zone="fuel-bar"] .rc03-fuel-level']),
    Object.freeze(["stint lap", ".rc03-fuel", '[data-rc03-zone="stint-lap"] .rc03-stint-lap']),
    Object.freeze(["fuel per lap", ".rc03-fuel-trend", '[data-rc03-zone="fuel-trend"] .rc03-value']),
    Object.freeze(["fuel bar", ".rc03-fuel", '[data-testid="rc03-fuel-bar"]']),
    Object.freeze(["ribbon fill", ".rc03-ribbon", '[data-testid="rc03-ribbon-fill"]'])
  ]),
  counted: Object.freeze([
    Object.freeze(["vital", '[data-testid="rc03-vital"]']),
    Object.freeze(["rail row", '[data-testid="rc03-rail-row"]']),
    Object.freeze(["ribbon fill", '[data-testid="rc03-ribbon-fill"]']),
    Object.freeze(["fuel bar fill", '[data-testid="rc03-fuel-bar-fill"]']),
    Object.freeze(["alarm line", '[data-testid="rc03-alarm-line"]']),
    Object.freeze(["pit window", '[data-testid="rc03-pit-window"]']),
    Object.freeze(["trend bar", '[data-testid="rc03-trend-bar"]'])
  ]),
  forbidden: Object.freeze([
    Object.freeze(["a tyre-temperature surface", '[class*="tyre"], [class*="tire"], [data-testid*="tyre"]']),
    Object.freeze(["an engine-speed numeral", '[data-channel="rpm"], [data-rc03-zone="rpm"], .rc03-rpm'])
  ]),
  /**
   * The defect ledger is EMPTY, so every measured overflow now fails closed.
   *
   * It used to record four compact-phone overruns: the delta numeral paid 15px past its 100px
   * cell and its glyphs reached x=176.8 while the speed cell began at x=172.3 — a real ~4.5px
   * collision — with speed (+3..4px), the fuel-laps hero (+3px) and the unit labels (+1..2px)
   * alongside it. The cause was a pace band that reserved a flat `padding-right: 36%` for a stint
   * clock only 32% wide while the type scale was still sized from `cqw` on the FULL container
   * width. The gutter is now derived from the clock, the portrait cell shares are budgeted from
   * what each cell must paint, the delta step is 9cqw and a unit no longer shrinks below its own
   * text. Deleting the ledger is the regression guard: any recurrence is unrecorded and fails.
   */
  knownDefects: Object.freeze([])
})

export const RC03_CAPTURE_MATRIX = Object.freeze(
  CAPTURE_STATES.flatMap((state) =>
    CAPTURE_SIZES.map((size) =>
      Object.freeze({
        size,
        state,
        // The alarm engages 1500 ms after the pressure drops, so the harness waits for the
        // widget to publish the latch rather than for a frame count it guessed.
        required: Object.freeze(
          state === "oil-alarm"
            ? [Object.freeze(["oil-alarm", "true"]), Object.freeze(["overheat", "false"])]
            : [
                Object.freeze(["oil-alarm", "false"]),
                Object.freeze(["overheat", "false"]),
                Object.freeze(["fuel-window", "false"])
              ]
        )
      })
    )
  )
)

/**
 * Values that are a pure function of the deterministic fixture are asserted exactly. Values the
 * widget MEASURES from the scripted laps — the stint clock, the stint lap, the burn model — are
 * asserted by shape and by tolerance, because freezing a measured string would only prove the
 * fixture was replayed at the same instant, not that the widget measured correctly.
 */
const RC03_EXPECTED_VALUES = Object.freeze({
  gear: "4",
  delta: "-0.112",
  speed: "218",
  "fuel level": "41.8"
})

const RC03_STINT_CLOCK = /^\d{2}:\d{2}$/u
const RC03_STINT_LAP = /^\d+$/u
const RC03_FUEL_LAPS = /^\d+\.\d$/u
const RC03_FUEL_PER_LAP = /^\d+\.\d{2}$/u
const RC03_LAP_TIME = /^(?:--:--\.---|\d+:\d{2}\.\d{3})$/u

const RC03_VITALS_TEMPS = Object.freeze([
  Object.freeze({ channel: "waterTemp", label: "WATER", unit: "C", value: "92" }),
  Object.freeze({ channel: "oilPressure", label: "OIL P", unit: "BAR", value: "4.6", alarmValue: "1.0" }),
  Object.freeze({ channel: "oilTemp", label: "OIL T", unit: "C", value: "108" }),
  Object.freeze({ channel: "battery", label: "BATT", unit: "V", value: "13.4" })
])

const RC03_REQUIRED_TEXT = Object.freeze([
  "GEAR", "4", "DELTA", "-0.112", "S", "SPEED", "218", "KM/H", "STINT",
  "WATER", "92", "C", "OIL P", "OIL T", "108", "BATT", "13.4", "V",
  "FUEL LAPS", "41.8", "L", "STINT LAP"
])

/**
 * The RC-03 omissions are absences of whole features rather than empty placeholders, so they are
 * asserted as readouts that may never appear. Tyre temperature has no zone in either the 800x480
 * grammar or the 1024x600 reflow and is omitted from the model entirely; the raw engine speed is
 * deliberately never printed because the continuous ribbon is its only visual surface.
 */
const RC03_FORBIDDEN_LEAF_TEXT = Object.freeze([
  Object.freeze(["LF", "would reintroduce the omitted tyre-temperature corners"]),
  Object.freeze(["RF", "would reintroduce the omitted tyre-temperature corners"]),
  Object.freeze(["LR", "would reintroduce the omitted tyre-temperature corners"]),
  Object.freeze(["RR", "would reintroduce the omitted tyre-temperature corners"]),
  Object.freeze(["TIRE C", "would reintroduce the omitted tyre-temperature corners"]),
  Object.freeze(["6048", "would print the RPM numeral the ribbon deliberately replaces"]),
  Object.freeze(["6,048", "would print the RPM numeral the ribbon deliberately replaces"]),
  Object.freeze(["RPM", "would label an engine-speed numeral RC-03 does not render"])
])

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

function assertRibbon(metrics) {
  if (countOf(metrics, "ribbon fill") !== 1) fail("the shift ribbon must render exactly one continuous fill")
  if (metrics.ribbon.unavailable !== "false") fail("the shift ribbon must be available for a fresh engine-speed frame")
  if (metrics.ribbon.tone === "danger") fail("the shift ribbon must not latch its over-rev tone on this fixture")
  if (metrics.ribbon.tone !== "dark" && metrics.ribbon.tone !== "caution") {
    fail(`the shift ribbon reports an unknown tone ${metrics.ribbon.tone}`)
  }
  const track = finite(metrics.ribbon.rect?.width, "ribbon width")
  const fill = finite(metrics.ribbon.fill?.width, "ribbon fill width")
  if (Math.abs(fill / track - RC03_EXPECTED_RIBBON_FILL) > 0.01) {
    fail(`the shift ribbon fills ${(fill / track).toFixed(4)} of its track instead of the ${RC03_EXPECTED_RIBBON_FILL.toFixed(4)} engine-speed ratio`)
  }
  if (metrics.ribbon.textLength !== 0) fail("packet 11.4 forbids text, ticks and index marks inside the shift ribbon")
}

function assertFuelBar(metrics) {
  if (countOf(metrics, "fuel bar fill") !== 1) fail("the fuel bar must render exactly one fill")
  if (metrics.fuelBar.unavailable !== "false") fail("the fuel bar must be available for a live fuel level")
  const track = finite(metrics.fuelBar.rect?.width, "fuel bar width")
  const fill = finite(metrics.fuelBar.fill?.width, "fuel bar fill width")
  // image-qa-v2 note 1 is normative: the reference image draws 43.48% and the build must draw
  // the telemetry ratio instead, so the bar and the litre readout can never disagree.
  if (Math.abs(fill / track - RC03_EXPECTED_FUEL_FILL) > 0.01) {
    fail(`the fuel bar fills ${(fill / track).toFixed(4)} of its track instead of the ${RC03_EXPECTED_FUEL_FILL.toFixed(4)} level/capacity ratio`)
  }
}

function assertVitals(metrics, entry) {
  if (countOf(metrics, "vital") !== RC03_VITAL_COUNT) {
    fail(`RC-03 must render exactly ${RC03_VITAL_COUNT} engine vitals`)
  }
  if (metrics.stateAttributes["vitals-page"] !== "temps") {
    fail(`the capture must rest on the temps vitals page, received ${metrics.stateAttributes["vitals-page"]}`)
  }
  const alarming = entry.state === "oil-alarm"
  for (let index = 0; index < RC03_VITALS_TEMPS.length; index += 1) {
    const expected = RC03_VITALS_TEMPS[index]
    const vital = metrics.vitals[index]
    if (!vital || vital.channel !== expected.channel) {
      fail(`vital ${index + 1} must be the ${expected.channel} channel`)
    }
    if (vital.label !== expected.label) fail(`vital ${index + 1} must be labelled ${expected.label}`)
    const text = alarming && expected.alarmValue ? expected.alarmValue : expected.value
    if (vital.text !== text) fail(`the ${expected.label} vital reads "${vital.text}" instead of "${text}"`)
    const shouldAlert = alarming && expected.channel === "oilPressure"
    if (vital.alert !== (shouldAlert ? "true" : "false")) {
      fail(`the ${expected.label} vital reports alert=${vital.alert} in the ${entry.state} scenario`)
    }
    assertNoHorizontalOverflow(vital.valueRect, `${expected.label} vital value`)
    containsRect(zoneOf(metrics, "vitals"), vital.rect, `${expected.label} vital`, 0.5)
  }
  const expectedAlarm = alarming ? "oil-pressure" : "none"
  if (metrics.vitalsAlarm !== expectedAlarm) {
    fail(`the vitals band reports alarm ${metrics.vitalsAlarm} in the ${entry.state} scenario`)
  }
}

function assertAlertSurfaces(metrics, entry) {
  const alarming = entry.state === "oil-alarm"
  if (metrics.stateAttributes["oil-alarm"] !== (alarming ? "true" : "false")) {
    fail(`the oil alarm modifier does not match the ${entry.state} scenario`)
  }
  if (metrics.stateAttributes.overheat !== "false") fail("this fixture must never latch the overheat alarm")
  if (metrics.stateAttributes["fuel-window"] !== "false") {
    fail("this fixture holds twelve laps of fuel and must never open the pit window")
  }
  if (countOf(metrics, "pit window") !== 0) fail("the PIT WINDOW chip may only render with an open fuel window")
  if (countOf(metrics, "alarm line") !== (alarming ? 1 : 0)) {
    fail(`the alarm line must be present exactly in the alarm scenario, received ${countOf(metrics, "alarm line")}`)
  }
  if (alarming) {
    if (!String(metrics.alarmLineText ?? "").includes("LOW OIL PRESS")) {
      fail(`the alarm line reads "${metrics.alarmLineText}" instead of the low oil pressure alarm`)
    }
    containsRect(zoneOf(metrics, "vitals"), metrics.alarmLineRect, "alarm line", 0.5)
  }
}

function assertAppOnlyReveals(metrics, entry) {
  const app = entry.size.layout === "app"
  if (countOf(metrics, "rail row") !== RC03_RAIL_ROW_COUNT) {
    fail(`the strategy rail must always carry ${RC03_RAIL_ROW_COUNT} rows in the DOM`)
  }
  const rail = zoneOf(metrics, "rail")
  const railVisible = rail.display !== "none"
  if (railVisible !== app) fail(`the strategy rail is ${railVisible ? "visible" : "hidden"} in the ${entry.size.layout} layout`)
  const trendVisible = metrics.fuelTrend.display !== "none"
  if (trendVisible !== app) {
    fail(`the fuel-per-lap trend is ${trendVisible ? "visible" : "hidden"} in the ${entry.size.layout} layout`)
  }
  const trendBars = countOf(metrics, "trend bar")
  if (trendBars < 0 || trendBars > RC03_BURN_HISTORY_LIMIT) {
    fail(`the burn trend renders ${trendBars} bars, outside the ${RC03_BURN_HISTORY_LIMIT}-lap rolling window`)
  }
  if (app) {
    for (const row of metrics.railRows ?? []) {
      assertNoHorizontalOverflow(row.rect, `strategy rail row ${row.label}`)
      containsRect(rail, row.rect, `strategy rail row ${row.label}`, 0.5)
    }
    const pace = (metrics.railRows ?? []).find((row) => row.label === "AVG PACE")
    if (!pace || !RC03_LAP_TIME.test(pace.text)) {
      fail(`the average-pace row reads "${pace?.text}", which is neither a lap time nor the honest placeholder`)
    }
    if (!RC03_FUEL_PER_LAP.test(String(metrics.fuelPerLapText))) {
      fail(`the fuel-per-lap readout reads "${metrics.fuelPerLapText}", which is not a measured burn rate`)
    }
  }
}

function assertMeasuredValues(metrics) {
  for (const [label, text] of Object.entries(RC03_EXPECTED_VALUES)) {
    const value = valueOf(metrics, label)
    if (value.text !== text) fail(`${label} output reads "${value.text}" instead of "${text}"`)
  }
  const clock = valueOf(metrics, "stint clock")
  if (!RC03_STINT_CLOCK.test(clock.text)) {
    fail(`the stint clock reads "${clock.text}", which is neither the honest placeholder nor mm:ss`)
  }
  const stintLap = valueOf(metrics, "stint lap")
  if (!RC03_STINT_LAP.test(stintLap.text)) fail(`the stint lap reads "${stintLap.text}", which is not a measured lap count`)
  const fuelLaps = valueOf(metrics, "fuel laps")
  if (!RC03_FUEL_LAPS.test(fuelLaps.text)) {
    fail(`the fuel-laps hero reads "${fuelLaps.text}", which is not a measured range`)
  }
  // 41.8 L at the measured 3.37 L/lap burn is 12.4 laps; a wider drift means the burn model or
  // the level readout disagree with each other.
  if (Math.abs(Number.parseFloat(fuelLaps.text) - 41.8 / 3.37) > 0.3) {
    fail(`the fuel-laps hero reads ${fuelLaps.text} against a 41.8 L level and a 3.37 L/lap burn`)
  }
}

/**
 * image-qa-v2 note 3 is normative: the order is what the reference proves, and the absolute
 * sizes come from packet section 11.2. Note 2 pushes speed down to the vitals scale, so the
 * hierarchy is four strict steps and a tie anywhere in it is a failure.
 */
function assertTypeScale(metrics) {
  return assertTypeScaleOrder([
    { label: "gear", fontSize: valueOf(metrics, "gear").fontSize },
    { label: "fuel laps", fontSize: valueOf(metrics, "fuel laps").fontSize },
    { label: "delta", fontSize: valueOf(metrics, "delta").fontSize },
    { label: "speed", fontSize: valueOf(metrics, "speed").fontSize }
  ])
}

export const RC03_CELL_TOLERANCE_PX = 0.5

/**
 * The regression guard for the compact-phone pace-band collision.
 *
 * Neither the leaf sweep nor `scrollWidth` is enough on its own here. `white-space: nowrap` sizes
 * a numeral to its own text, so a cell can be exactly as wide as its glyphs — `scrollWidth ===
 * clientWidth`, zero reported overflow — while the NEXT cell begins to the left of where those
 * glyphs stop painting. Only the RANGE rectangle against the neighbouring cell's layout box sees
 * that, so the two readouts either side of the reserved clock gutter are compared directly.
 */
function assertReadoutsPaintInsideTheirCells(metrics) {
  for (const value of metrics.values ?? []) {
    if (!value.present || value.display === "none") continue
    const paintedRight = finite(value.textRect.left, `${value.label} text left`) + value.textRect.width
    const cellRight = finite(value.rect.left, `${value.label} cell left`) + value.rect.width
    if (paintedRight - cellRight > RC03_CELL_TOLERANCE_PX) {
      fail(
        `the ${value.label} readout "${value.text}" paints ${(paintedRight - cellRight).toFixed(2)}px past its own ` +
          `cell (glyphs reach x=${paintedRight.toFixed(2)}, cell ends at x=${cellRight.toFixed(2)})`
      )
    }
    if (value.rect.left - value.textRect.left > RC03_CELL_TOLERANCE_PX) {
      fail(`the ${value.label} readout "${value.text}" paints past the left edge of its own cell`)
    }
  }

  const delta = valueOf(metrics, "delta")
  const speed = valueOf(metrics, "speed")
  const deltaRight = delta.textRect.left + delta.textRect.width
  if (deltaRight > speed.rect.left - RC03_CELL_TOLERANCE_PX) {
    fail(
      `the delta numeral "${delta.text}" reaches x=${deltaRight.toFixed(2)} while the speed cell begins at ` +
        `x=${speed.rect.left.toFixed(2)}: the pace band's cells collide`
    )
  }
}

export function validateCaptureMetrics(metrics, entry) {
  const common = validateCommonMetrics(metrics, entry, RC03_SPEC)
  if (metrics.stateAttributes.brightness !== "night") {
    fail(`RC-03 must rest in its night brightness profile, received ${metrics.stateAttributes.brightness}`)
  }
  if (metrics.nativeSize !== (entry.size.layout === "native" ? "800x480" : null)) {
    fail("the native content-box modifier does not match the selected layout")
  }
  for (const expected of RC03_REQUIRED_TEXT) hasText(metrics, expected)
  for (const [forbidden, why] of RC03_FORBIDDEN_LEAF_TEXT) lacksLeafText(metrics, forbidden, why)
  assertRibbon(metrics)
  assertFuelBar(metrics)
  assertVitals(metrics, entry)
  assertAlertSurfaces(metrics, entry)
  assertAppOnlyReveals(metrics, entry)
  assertMeasuredValues(metrics)
  assertReadoutsPaintInsideTheirCells(metrics)
  return { ...common, typeScale: assertTypeScale(metrics) }
}

const RC03_MIN_NON_CANVAS_PIXELS = 5_000
const RC03_MIN_ALERT_PIXELS = 30
const RC03_MAX_CANVAS_CHANNEL = 24

/**
 * The pixel audit proves what the metric contract cannot: that the frame is opaque, that the
 * reserved canvas gutter is untouched, that the frame is not blank, and — the point of the whole
 * exercise — that the danger hue is absent from the silent frame and confined to the vitals band
 * when the alarm is latched.
 *
 * Colour is confirmed by HUE FAMILY, never by a channel ratio. RC-03 rests on an amber ribbon
 * and amber fuel typography whose green and blue channels both sit far below their red channel,
 * so a naive `g,b < 0.62r` red test would report thousands of "red" pixels on a frame whose
 * hue-confirmed red count is zero. Hue also survives the `filter: brightness(0.78)` night
 * profile, because scaling every channel by the same factor leaves the hue angle unchanged.
 */
export function validateCapturePixels(buffer, entry, metrics) {
  if (!isGovernedSize(entry.size)) fail(`unsupported capture pixel-audit size ${entry.size.width}x${entry.size.height}`)
  const image = decodeCapturePng(buffer, entry.size)

  // Packet 11.1 leaves a gutter under the fuel band in every layout, and packet 12.1 bleeds the
  // ribbon to the top edge of the app reflow, so the bottom row — not the whole border — is the
  // gutter this artifact actually reserves.
  const gutter = rgbaAt(image, 0, image.height - 1)
  if (Math.max(gutter[0], gutter[1], gutter[2]) > RC03_MAX_CANVAS_CHANNEL) {
    fail(`the RC-03 gutter must stay a night-profile black, measured rgba(${gutter.join(",")})`)
  }
  for (let x = 0; x < image.width; x += 1) {
    if (!sameRgba(rgbaAt(image, x, image.height - 1), gutter)) {
      fail(`bottom gutter pixel ${x},${image.height - 1} is rgba(${rgbaAt(image, x, image.height - 1).join(",")})`)
    }
  }

  const dangerFamily = hueFamilyOfHex(RC03_DANGER_HEX)
  const scopes = entry.state === "oil-alarm" ? { [dangerFamily]: [metrics.alertScope] } : {}
  const audit = auditHueFamilies(image, scopes)
  const nonGutterPixels = image.width * image.height - countMatchingPixels(image, gutter)
  if (nonGutterPixels < RC03_MIN_NON_CANVAS_PIXELS) fail("capture is blank against the RC-03 canvas colour")

  if (entry.state === "silent") {
    assertHueFamilyAbsent(audit, dangerFamily, "the silent RC-03 frame")
  } else {
    assertHueFamilyPresent(audit, dangerFamily, "the RC-03 low-oil-pressure frame", RC03_MIN_ALERT_PIXELS)
    assertHueFamilyScoped(audit, dangerFamily, "the RC-03 low-oil-pressure frame")
  }

  return {
    width: image.width,
    height: image.height,
    opaque: true,
    gutter: `rgba(${gutter.join(",")})`,
    nonGutterPixels,
    hueFamilies: audit.counts,
    alertHueFamily: dangerFamily,
    alertHueOutsideScope: audit.outside[dangerFamily] ?? 0
  }
}

function countMatchingPixels(image, expected) {
  let count = 0
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (sameRgba(rgbaAt(image, x, y), expected)) count += 1
    }
  }
  return count
}

export { CaptureSafetyError, exact }
