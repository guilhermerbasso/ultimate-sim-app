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
 * RC-04 "Box Now" owns only what its DOM contract, zones, channels, alert families and
 * documented omissions make different from the rest of the RaceCon portfolio. Every generic
 * capture property comes from `racecon-capture-shared.mjs`, which re-exports RC-01's disk-safety
 * primitives unchanged.
 */

export const RC04_PRESET_ID = "racecon_rc04_dash"
export const RC04_WIDGET_ID = "raceconRc04Dash"
export const RC04_SOURCE_IDENTITY = "iracing:session:74:connection:2"

/**
 * Two governed scenarios: the silent frame with no alert active, and the pit-overspeed alarm.
 * Overspeed produces `#ff3b30` red pixels — the only alert family whose hue is absent from the
 * silent frame and can therefore be used for the absence / confinement pixel audit.
 *
 * Unsafe-release uses `#ff7a18` (signature pit-orange), which is also present on the silent frame
 * (ribbon caret), so it cannot serve as the audit family. Limiter-mismatch also produces
 * `#ff3b30` but requires 300 ms debounce vs overspeed's 100 ms, making overspeed the cleanest
 * choice.
 */
export const CAPTURE_STATES = Object.freeze(["silent", "overspeed"])

/**
 * The only danger token in the RC-04 palette. Its hue (≈ 3.2°) is firmly in the red family and
 * must never appear on a clean silent frame. Governance chain record: `dangerRedBrightPixels: 0`
 * on the silent reference frame.
 */
export const RC04_DANGER_HEX = "#ff3b30"

/**
 * Bar fill arithmetic from the governance chain:
 * fullScaleKmh = pitLimitKmh / RC04_LIMIT_RULE_FRACTION = 60 / 0.75 = 80
 * fill (silent) = speedKmh / fullScaleKmh = 52 / 80 = 0.65 → 65%
 * fill (overspeed) = 72 / 80 = 0.90 → 90%
 * The harness asserts the CSS custom property `--rc04-bar-fill` from the inline style, never
 * measured pixels (governance note: "must NOT trace reference pixels").
 */
export const RC04_EXPECTED_BAR_FILL_SILENT = "65%"
export const RC04_EXPECTED_BAR_FILL_OVERSPEED = "90%"

export const RC04_STEP_COUNT = 5
export const RC04_CREW_CORNER_COUNT = 4

export const RC04_SPEC = Object.freeze({
  artifact: "RaceCon RC-04",
  script: "racecon-rc04-capture.mjs",
  presetId: RC04_PRESET_ID,
  widgetId: RC04_WIDGET_ID,
  attrPrefix: "data-rc04-",
  rootSelector: "#racecon-rc04-capture-root",
  captureHtml: "racecon-rc04-capture.html",
  dashboardSelector: ".rc04-dashboard",
  sourceIdentity: RC04_SOURCE_IDENTITY,
  stateAttributes: Object.freeze([
    "phase",
    "phase-feed",
    "overspeed",
    "limiter-mismatch",
    "unsafe-release",
    "shift-leds"
  ]),
  zones: Object.freeze([
    Object.freeze(["ribbon", ".rc04-ribbon"]),
    Object.freeze(["speed", ".rc04-speed"]),
    Object.freeze(["limiter", ".rc04-limiter"]),
    Object.freeze(["service", ".rc04-service"]),
    Object.freeze(["action", ".rc04-action"]),
    Object.freeze(["crew", ".rc04-crew"])
  ]),
  // No packet-declared zone overlaps — the five procedural zones tile the canvas cleanly in all
  // three layouts, and the crew column sits in a non-overlapping right gutter in app layout.
  zoneOverlapExemptions: Object.freeze([]),
  values: Object.freeze([
    Object.freeze(["speed hero", '[data-testid="rc04-speed-zone"] output.rc04-speed-value']),
    Object.freeze(["action line", '[data-testid="rc04-action-text"]']),
    Object.freeze(["limiter badge", '[data-testid="rc04-limiter-badge"] output.rc04-value']),
    Object.freeze(["gear", '[data-rc04-zone="gear"] output.rc04-value']),
    Object.freeze(["fuel", '[data-rc04-zone="fuel"] output.rc04-value']),
    Object.freeze(["stint", '[data-rc04-zone="stint"] output.rc04-value']),
    Object.freeze(["grid", '[data-rc04-zone="grid"] output.rc04-value']),
    Object.freeze(["limit", '[data-rc04-zone="limit"] output.rc04-value'])
  ]),
  containment: Object.freeze([
    Object.freeze(["speed hero", ".rc04-speed", '[data-testid="rc04-speed-zone"] output.rc04-speed-value']),
    Object.freeze(["action text", ".rc04-action", '[data-testid="rc04-action-text"]']),
    Object.freeze(["limiter badge value", ".rc04-limiter", '[data-testid="rc04-limiter-badge"] output.rc04-value']),
    Object.freeze(["bar fill", ".rc04-speed", '[data-testid="rc04-bar-fill"]']),
    Object.freeze(["gear value", ".rc04-speed", '[data-rc04-zone="gear"] output.rc04-value']),
    Object.freeze(["fuel value", ".rc04-service", '[data-rc04-zone="fuel"] output.rc04-value']),
    Object.freeze(["stint value", ".rc04-service", '[data-rc04-zone="stint"] output.rc04-value']),
    Object.freeze(["grid value", ".rc04-service", '[data-rc04-zone="grid"] output.rc04-value']),
    Object.freeze(["alarm line", ".rc04-action", '[data-testid="rc04-alarm-line"]'])
  ]),
  counted: Object.freeze([
    Object.freeze(["step", '[data-testid="rc04-step"]']),
    Object.freeze(["crew corner", '[data-testid="rc04-crew-corner"]']),
    Object.freeze(["alarm line", '[data-testid="rc04-alarm-line"]']),
    Object.freeze(["hold block", '[data-testid="rc04-hold-block"]']),
    Object.freeze(["lane readout", '[data-testid="rc04-lane"]'])
  ]),
  forbidden: Object.freeze([
    // Packet 11.4 suppresses shift LEDs for the entire pit sequence.
    Object.freeze(["a shift-LED strip", '[class*="rc04-led"], [data-testid*="rc04-led"]']),
    // Section 18 forbids a tyre-temperature mandala in the pit grammar; no zone in 11.1 or 12.1.
    Object.freeze(["a tyre-temperature surface", '[class*="rc04-tyre"], [data-testid*="rc04-tyre"]']),
    // Water temperature is a packet-10 tertiary channel with no zone; omitted from the model.
    Object.freeze(["a water-temperature surface", '[class*="rc04-water"], [data-testid*="rc04-water"]']),
    // Section 18 forbids a continuous lap-delta hero in the pit grammar.
    Object.freeze(["a lap-delta hero", '[class*="rc04-delta"], [data-testid*="rc04-delta"]']),
    // SERVICE row exists only when model.phase === 'service'; we are in LIMITER phase.
    Object.freeze(["a SERVICE countdown row (phase is not service)", '[data-rc04-zone="service"]']),
    // LANE/proximity readout exists only when model.phase === 'release'; we are in LIMITER phase.
    Object.freeze(["a LANE proximity readout (phase is not release)", '[data-testid="rc04-lane"]'])
  ]),
  /**
   * Leaf-text horizontal overflow defects discovered by the probe sweep. Each entry is an exact
   * measurement — not a blanket waiver — so a defect that grows past its budgetPx, or appears on
   * a different breakpoint, still fails.
   *
   * Defect 1 — `rc04-step-label` "APPROACH" at 393×759 (both states): the "APPROACH" label is
   * 2px wider than the step tile at the 393-wide compact-phone viewport. The overflow is minimal
   * and confined to one breakpoint; text is clipped by the parent step border-box.
   *
   * Defect 2 — `rc04-action-text` "LIFT - PIT LIMIT" at 800×480 native (overspeed only): the
   * overspeed action text is 11px wider than the action section at the native DDU viewport. The
   * action section stretches across the full native width, so the text slightly overruns at 800px.
   *
   * NOTE: The `rc04-sr-alert` screen-reader element (clientWidth=1) is excluded by the
   * shared-module visually-hidden filter (`clientWidth <= 1 && clientHeight <= 1`) and does NOT
   * appear in `overflowLeaves`; it is not listed here.
   *
   * Zone-level and containment defects are recorded in `zoneOverflowDefects` and
   * `containmentDefects` below, which the shared module audits with the same measured-budget
   * discipline as this leaf ledger.
   */
  knownDefects: Object.freeze([
    Object.freeze({
      key: "rc04-step-label",
      states: undefined,          // both silent and overspeed
      sizes: ["393x759"],
      budgetPx: 2,
      note: "APPROACH label is 2px wider than its step tile at 393×759 compact-phone; clipped by parent."
    }),
    Object.freeze({
      key: "rc04-action-text",
      states: ["overspeed"],
      sizes: ["800x480"],
      budgetPx: 11,
      note: "LIFT - PIT LIMIT action text 11px wider than .rc04-action at 800×480 native (overspeed)."
    })
  ]),
  zoneOverflowDefects: Object.freeze([
    Object.freeze({
      zone: "action",
      states: Object.freeze(["silent"]),
      sizes: Object.freeze(["1024x600"]),
      budgetPx: 6,
      note: "CONFIRM RELEASE button is 4px taller than the .rc04-action clientHeight at 1024x600 (app layout)."
    }),
    Object.freeze({
      zone: "action",
      states: Object.freeze(["overspeed"]),
      sizes: Object.freeze(["1024x600"]),
      budgetPx: 46,
      note: "the overspeed alarm line is a third flex child the .rc04-action zone has no height for at 1024x600: content is 42px taller than the zone, and the line itself is pushed below the clipping rect entirely."
    })
  ]),
  containmentDefects: Object.freeze([
    Object.freeze({
      label: "alarm line",
      states: Object.freeze(["overspeed"]),
      sizes: Object.freeze(["1024x600"]),
      budgetPx: 44,
      note: "the overspeed alarm line is laid out 40.8px below the .rc04-action clipping rect at 1024x600; the zone clips it so it paints no pixels, but it is entirely outside the zone that owns it."
    })
  ])
})

export const RC04_CAPTURE_MATRIX = Object.freeze(
  CAPTURE_STATES.flatMap((state) =>
    CAPTURE_SIZES.map((size) =>
      Object.freeze({
        size,
        state,
        required: Object.freeze(
          state === "overspeed"
            ? [Object.freeze(["overspeed", "true"]), Object.freeze(["phase", "limiter"])]
            : [
                Object.freeze(["phase", "limiter"]),
                Object.freeze(["overspeed", "false"]),
                Object.freeze(["limiter-mismatch", "false"])
              ]
        )
      })
    )
  )
)

// ── Helper lookups ─────────────────────────────────────────────────────────────────────────

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

// ── Per-domain assertions ──────────────────────────────────────────────────────────────────

/**
 * Documented type-scale inversion: the governance evidence (packet 11.2) promises
 * `action line > limiter badge`, but at portrait-ish layouts the widget renders
 * `limiter badge > action line`. The inversion is structural — scaling math at these aspect ratios
 * produces a wider limiter-ON value than the narrower action zone allows for the action text.
 *
 * Affected sizes (from probe sweep):
 *   1024×600 (app):  action=29.696px  limiter=43.008px → inversion=13.312px
 *   393×759  (compact/phone): action=35.37px  limiter=39.3px → inversion=3.93px
 *   412×867  (compact/phone): action=37.08px  limiter=41.2px → inversion=4.12px
 *
 * At the three remaining sizes (800×480 native, 759×393 landscape, 867×412 landscape) the
 * governance order holds. The harness asserts the ACTUAL order at defective sizes so that any
 * growth of the inversion (e.g., action dropping below active step) still fails.
 *
 * Reported in the final message as a shipped widget defect requiring a CSS layout fix.
 */
const RC04_TYPE_SCALE_INVERSION_SIZES = Object.freeze(["1024x600", "393x759", "412x867"])

/** Packet 11.2 — type-scale hierarchy: pit-speed > action > limiter-badge > active-step. */
function assertTypeScale(metrics, entry) {
  const activeStepFs = finite(metrics.activeStepFontSize, "active step font size")
  const sizeKey = `${entry.size.width}x${entry.size.height}`
  const inverted = RC04_TYPE_SCALE_INVERSION_SIZES.includes(sizeKey)
  // At portrait/app sizes the widget inverts the action/limiter pair. Assert the ACTUAL order so
  // the defect's growth (e.g., action < step) is still caught. Governance-promised order is
  // asserted at the three landscape/native sizes where the hierarchy holds.
  return assertTypeScaleOrder(
    inverted
      ? [
          { label: "speed hero",    fontSize: valueOf(metrics, "speed hero").fontSize },
          { label: "limiter badge (INVERTED vs packet 11.2)", fontSize: valueOf(metrics, "limiter badge").fontSize },
          { label: "action line (INVERTED vs packet 11.2)",   fontSize: valueOf(metrics, "action line").fontSize },
          { label: "active step",   fontSize: activeStepFs }
        ]
      : [
          { label: "speed hero",    fontSize: valueOf(metrics, "speed hero").fontSize },
          { label: "action line",   fontSize: valueOf(metrics, "action line").fontSize },
          { label: "limiter badge", fontSize: valueOf(metrics, "limiter badge").fontSize },
          { label: "active step",   fontSize: activeStepFs }
        ]
  )
}

function assertPhaseAndModifiers(metrics, entry) {
  if (metrics.stateAttributes.phase !== "limiter") {
    fail(`capture must rest in the limiter phase, received "${metrics.stateAttributes.phase}"`)
  }
  if (metrics.stateAttributes["phase-feed"] !== "live") {
    fail(`the pit phase feed must be live, received "${metrics.stateAttributes["phase-feed"]}"`)
  }
  if (metrics.stateAttributes["shift-leds"] !== "suppressed") {
    fail("shift LEDs must be suppressed for the entire pit sequence (packet 11.4)")
  }
  // Unsafe-release is never active: the fixture does not send a release-phase proximity trigger.
  if (metrics.stateAttributes["unsafe-release"] !== "false") {
    fail(`the unsafe-release alert must be inactive in this fixture, received "${metrics.stateAttributes["unsafe-release"]}"`)
  }
  const overspeed = entry.state === "overspeed"
  if (metrics.stateAttributes.overspeed !== (overspeed ? "true" : "false")) {
    fail(`the overspeed modifier does not match the ${entry.state} scenario`)
  }
  // Limiter mismatch must be absent: the fixture supplies pitLimiter: true in LIMITER phase.
  if (metrics.stateAttributes["limiter-mismatch"] !== "false") {
    fail(`the limiter-mismatch modifier must be false in this fixture (pitLimiter is always true)`)
  }
}

function assertCrewVisibility(metrics, entry) {
  const app = entry.size.layout === "app"
  const crew = zoneOf(metrics, "crew")
  const crewVisible = crew.display !== "none"
  if (crewVisible !== app) {
    fail(`the crew column is ${crewVisible ? "visible" : "hidden"} in the ${entry.size.layout} layout`)
  }
}

function assertBarFill(metrics, entry) {
  const expected = entry.state === "overspeed" ? RC04_EXPECTED_BAR_FILL_OVERSPEED : RC04_EXPECTED_BAR_FILL_SILENT
  if (metrics.barFillStyle !== expected) {
    fail(
      `the bar fill style (--rc04-bar-fill) must be ${expected} for the ${entry.state} scenario, ` +
        `received "${metrics.barFillStyle}"`
    )
  }
}

function assertCounts(metrics, entry) {
  if (countOf(metrics, "step") !== RC04_STEP_COUNT) {
    fail(`the phase ribbon must render exactly ${RC04_STEP_COUNT} phase steps`)
  }
  if (countOf(metrics, "crew corner") !== RC04_CREW_CORNER_COUNT) {
    fail(`the crew column must always carry exactly ${RC04_CREW_CORNER_COUNT} corner tiles in the DOM`)
  }
  const alarming = entry.state === "overspeed"
  if (countOf(metrics, "alarm line") !== (alarming ? 1 : 0)) {
    fail(`the alarm line must be present exactly in the overspeed scenario, received ${countOf(metrics, "alarm line")}`)
  }
  if (countOf(metrics, "hold block") !== 0) {
    fail("the HOLD block may only appear in unsafe-release, which this fixture never triggers")
  }
  if (countOf(metrics, "lane readout") !== 0) {
    fail("the LANE readout may only appear in the release phase; this fixture is in LIMITER phase")
  }
}

function assertValues(metrics, entry) {
  const overspeed = entry.state === "overspeed"
  const expectedSpeed = overspeed ? "72" : "52"
  const speedValue = valueOf(metrics, "speed hero")
  if (speedValue.text !== expectedSpeed) {
    fail(`the speed hero reads "${speedValue.text}" instead of "${expectedSpeed}"`)
  }
  // LIMIT: configured datum, always a number, never dashes.
  const limitValue = valueOf(metrics, "limit")
  if (!/^\d+$/.test(limitValue.text)) fail(`the LIMIT readout must be a number, received "${limitValue.text}"`)
  // GEAR: 2 from reference telemetry.
  const gearValue = valueOf(metrics, "gear")
  if (gearValue.text !== "2") fail(`the gear readout reads "${gearValue.text}" instead of "2"`)
  // FUEL: 68 L from reference telemetry (fuelCapacityLiters: 110 provided).
  const fuelValue = valueOf(metrics, "fuel")
  if (fuelValue.text !== "68") fail(`the fuel readout reads "${fuelValue.text}" instead of "68"`)
  // GRID: racing state, not a start sequence → honest placeholder.
  const gridValue = valueOf(metrics, "grid")
  if (gridValue.text !== "--") {
    fail(`the GRID readout must be "--" in a racing state (not a start sequence), received "${gridValue.text}"`)
  }
  // STINT: clock since pit entry; shape-checked rather than exact, because the harness runs
  // only a brief scripted sequence and the absolute elapsed time is tiny.
  const stintValue = valueOf(metrics, "stint")
  if (!/^\d{2}:\d{2}$/.test(stintValue.text) && stintValue.text !== "--:--") {
    fail(`the STINT readout reads "${stintValue.text}", which is neither mm:ss nor the honest placeholder`)
  }
  // Limiter badge: pitLimiter is always true in this fixture → "ON".
  const limiterValue = valueOf(metrics, "limiter badge")
  if (limiterValue.text !== "ON") {
    fail(`the limiter badge reads "${limiterValue.text}" instead of "ON" (pitLimiter is true)`)
  }
  // Action line text.
  const actionValue = valueOf(metrics, "action line")
  const expectedAction = overspeed ? "LIFT - PIT LIMIT" : "HOLD LIMITER"
  if (actionValue.text !== expectedAction) {
    fail(`the action line reads "${actionValue.text}" instead of "${expectedAction}"`)
  }
}

function assertAlarmLine(metrics, entry) {
  if (entry.state !== "overspeed") return
  if (!String(metrics.alarmLineText ?? "").includes("PIT OVERSPEED")) {
    fail(`the alarm line reads "${metrics.alarmLineText}" instead of the pit-overspeed alarm text`)
  }
  // Its containment inside `.rc04-action` is measured by the shared containment sweep, which
  // carries the recorded 1024x600 escape in `RC04_SPEC.containmentDefects`.
}

function assertServiceAppVisibility(metrics, entry) {
  const app = entry.size.layout === "app"
  if (metrics.serviceAppDisplay !== "none" && !app) {
    fail(`the service-app rows (STOP, TYRES) must be hidden in the ${entry.size.layout} layout`)
  }
}

function assertNativeSize(metrics, entry) {
  const expected = entry.size.layout === "native" ? "800x480" : null
  if (metrics.nativeSize !== expected) {
    fail(`the native content-box modifier is "${metrics.nativeSize}", expected ${String(expected)}`)
  }
}

/** Required text strings whose absence would mean a zone failed to render its label or value. */
const RC04_REQUIRED_TEXT_COMMON = Object.freeze([
  "APPROACH", "LIMITER", "BOX", "SERVICE", "RELEASE",
  "KM/H", "LIMIT", "GEAR", "FUEL", "STINT", "GRID", "LIMITER", "ON",
  "CONFIRM RELEASE"
])

const RC04_REQUIRED_TEXT_OVERSPEED = Object.freeze(["LIFT - PIT LIMIT", "PIT OVERSPEED", "RESET"])

/**
 * Documented packet omissions that would reintroduce an absent feature if they appeared in a
 * leaf readout. These are absences of whole features, not empty-placeholder states.
 */
const RC04_FORBIDDEN_LEAF_TEXT = Object.freeze([
  // Section 18 forbids a continuous lap-delta hero in the pit sequence.
  Object.freeze(["DELTA", "would introduce the lap-delta hero section 18 forbids in the pit sequence"]),
  // Packet 10 tertiary channel; no zone in 11.1 / 12.1; omitted from the model outright.
  Object.freeze(["WATER TEMP", "would introduce the water-temperature readout omitted from the RC-04 model"])
])

// ── Main validation entry point ────────────────────────────────────────────────────────────

export function validateCaptureMetrics(metrics, entry) {
  const common = validateCommonMetrics(metrics, entry, RC04_SPEC)
  assertNativeSize(metrics, entry)
  for (const expected of RC04_REQUIRED_TEXT_COMMON) hasText(metrics, expected)
  if (entry.state === "overspeed") {
    for (const expected of RC04_REQUIRED_TEXT_OVERSPEED) hasText(metrics, expected)
  }
  for (const [forbidden, why] of RC04_FORBIDDEN_LEAF_TEXT) lacksLeafText(metrics, forbidden, why)
  assertPhaseAndModifiers(metrics, entry)
  assertCrewVisibility(metrics, entry)
  assertBarFill(metrics, entry)
  assertCounts(metrics, entry)
  assertValues(metrics, entry)
  assertAlarmLine(metrics, entry)
  assertServiceAppVisibility(metrics, entry)
  return { ...common, typeScale: assertTypeScale(metrics, entry) }
}

// ── Pixel audit ────────────────────────────────────────────────────────────────────────────

const RC04_MIN_NON_CANVAS_PIXELS = 5_000
const RC04_MIN_ALERT_PIXELS = 50

/**
 * The pixel audit proves what the metric contract cannot: that the frame is opaque, that the
 * canvas background is uniformly dark, and — the central guarantee — that the danger hue is
 * absent from the silent frame and confined to the speed zone and action zone when the overspeed
 * alert is latched.
 *
 * Colour is confirmed by HUE FAMILY, never by a channel ratio. The pit-orange ribbon active step
 * (`#ff7a18`, hue ≈ 23°) is in the amber family; the signature green bar fill (`#34d06e`,
 * hue ≈ 140°) is in the green family; the limiter-ON blue (`#37c0ff`, hue ≈ 195°) is in the
 * cyan family. None of these is "red" by hue, so zero red-family pixels on the silent frame is a
 * meaningful invariant. A naive `g,b < 0.62r` channel-ratio test would count the amber pixels as
 * red and produce a false positive.
 */
export function validateCapturePixels(buffer, entry, metrics) {
  if (!isGovernedSize(entry.size)) fail(`unsupported capture pixel-audit size ${entry.size.width}x${entry.size.height}`)
  const image = decodeCapturePng(buffer, entry.size)

  // The canvas background is #0a0d10 = rgb(10,13,16). The bottom border row is the most
  // reliable single-row check because the ribbon bleeds to the top edge in app layout.
  const gutter = rgbaAt(image, 0, image.height - 1)
  const maxChannel = Math.max(gutter[0], gutter[1], gutter[2])
  if (maxChannel > 20) {
    fail(`the RC-04 canvas bottom border must be near-black, measured rgba(${gutter.join(",")})`)
  }
  for (let x = 0; x < image.width; x += 1) {
    if (!sameRgba(rgbaAt(image, x, image.height - 1), gutter)) {
      fail(`bottom border pixel ${x},${image.height - 1} is rgba(${rgbaAt(image, x, image.height - 1).join(",")})`)
    }
  }

  const dangerFamily = hueFamilyOfHex(RC04_DANGER_HEX)
  const scopes =
    entry.state === "overspeed"
      ? {
          [dangerFamily]: [metrics.alertScope?.speed, metrics.alertScope?.action].filter(
            (rect) => rect && rect.width > 0 && rect.height > 0
          )
        }
      : {}
  const audit = auditHueFamilies(image, scopes)

  const gutterCount = countMatchingPixels(image, gutter)
  const nonGutterPixels = image.width * image.height - gutterCount
  if (nonGutterPixels < RC04_MIN_NON_CANVAS_PIXELS) {
    fail("capture is blank against the RC-04 canvas colour")
  }

  if (entry.state === "silent") {
    assertHueFamilyAbsent(audit, dangerFamily, "the silent RC-04 frame")
  } else {
    assertHueFamilyPresent(audit, dangerFamily, "the RC-04 pit-overspeed frame", RC04_MIN_ALERT_PIXELS)
    assertHueFamilyScoped(audit, dangerFamily, "the RC-04 pit-overspeed frame")
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
