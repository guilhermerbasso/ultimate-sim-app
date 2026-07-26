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
 * RC-06 "Save Mode" owns only what its DOM contract, zones, channels, alert families and
 * documented omissions make different from the rest of the RaceCon portfolio. Every generic
 * capture property comes from `racecon-capture-shared.mjs`, which re-exports RC-01's safety
 * primitives unchanged.
 */

export const RC06_PRESET_ID = "racecon_rc06_dash"
export const RC06_WIDGET_ID = "raceconRc06Dash"
export const RC06_SOURCE_IDENTITY = "iracing:session:76:connection:1"

/** Two governed scenarios: the silent frame, and the behind-plan (SAVE MORE) alarm. */
export const CAPTURE_STATES = Object.freeze(["silent", "save-more"])

export const RC06_COLUMN_COUNT = 2
export const RC06_COLUMN_RULE_COUNT = 2

/**
 * The only red token in the RC-06 palette. It may never appear on a silent frame.
 * Hue ≈ 9° — hueFamily returns "red". The naive channel-ratio test `g,b < 0.62r` also
 * classifies caution amber (#E8C233, g/r ≈ 0.84) as red, so the hue audit exists to prevent
 * that false positive. A fuel dashboard legitimately rests on amber typography; amber and red
 * are different hue families and the audit already separates them.
 */
export const RC06_DANGER_HEX = "#E5533A"

export const RC06_SPEC = Object.freeze({
  artifact: "RaceCon RC-06",
  script: "racecon-rc06-capture.mjs",
  presetId: RC06_PRESET_ID,
  widgetId: RC06_WIDGET_ID,
  attrPrefix: "data-rc06-",
  rootSelector: "#racecon-rc06-capture-root",
  captureHtml: "racecon-rc06-capture.html",
  dashboardSelector: ".rc06-dashboard",
  sourceIdentity: RC06_SOURCE_IDENTITY,
  stateAttributes: Object.freeze(["lift-mode", "plan", "fuel-model", "balance-tone", "alerts", "alert-keys", "ledger"]),
  zones: Object.freeze([
    // Omission 3 note: rc06-trend is NOT listed here because it is absent from the DOM at
    // non-app layouts. validateCommonMetrics would fail for any absent zone. It is checked
    // separately in validateCaptureMetrics.
    Object.freeze(["peripheral", '[data-testid="rc06-peripheral"]']),
    Object.freeze(["target", '[data-testid="rc06-target"]']),
    Object.freeze(["balance", '[data-testid="rc06-balance"]']),
    Object.freeze(["delta", '[data-testid="rc06-delta"]']),
    Object.freeze(["actual", '[data-testid="rc06-actual"]']),
    Object.freeze(["lift", '[data-testid="rc06-lift"]'])
  ]),
  /**
   * At app (1024×600) layout, packet 12.1 places the delta zone rect strictly inside the
   * balance zone rect (delta top=38%, balance bottom=53.3%). In native layout the two zones
   * do not overlap. The exemption covers both layouts without softening any other pair.
   */
  zoneOverlapExemptions: Object.freeze([Object.freeze(["balance", "delta"])]),
  values: Object.freeze([
    Object.freeze(["balance", '[data-testid="rc06-balance-value"]']),
    Object.freeze(["laps remaining", '[data-rc06-row="laps-remaining"] output']),
    Object.freeze(["actual burn", '[data-rc06-row="actual-burn"] output']),
    Object.freeze(["lift cue", '[data-testid="rc06-lift-value"]']),
    // Omission 2: LIFT PT always "--" — no lap-distance channel is declared in packet 16.
    // The widget ignores lapDistanceM entirely; the output always carries unavailable: true.
    Object.freeze(["lift point", '[data-rc06-row="lift-point"] output']),
    Object.freeze(["target burn", '[data-rc06-row="target-burn"] output']),
    Object.freeze(["plan laps", '[data-rc06-row="plan-laps"] output']),
    Object.freeze(["pit lap", '[data-rc06-row="pit-lap"] output']),
    Object.freeze(["gear", '[data-rc06-row="gear"] output']),
    Object.freeze(["speed", '[data-rc06-row="speed"] output']),
    Object.freeze(["water temp", '[data-rc06-row="water"] output']),
    Object.freeze(["position", '[data-rc06-row="position"] output']),
    Object.freeze(["delta time", '[data-rc06-row="delta"] output']),
    Object.freeze(["best lap", '[data-rc06-row="best"] output']),
    Object.freeze(["fuel level", '[data-rc06-row="fuel-level"] output']),
    // Representative for the "labels" tier of the type scale (column title font size).
    Object.freeze(["column title", '[data-testid="rc06-column-title"]'])
  ]),
  containment: Object.freeze([
    Object.freeze(["balance value", '[data-testid="rc06-balance"]', '[data-testid="rc06-balance-value"]']),
    Object.freeze(["lift value", '[data-testid="rc06-lift"]', '[data-testid="rc06-lift-value"]']),
    Object.freeze(["target burn", '[data-testid="rc06-target"]', '[data-rc06-row="target-burn"] output']),
    Object.freeze(["actual burn", '[data-testid="rc06-actual"]', '[data-rc06-row="actual-burn"] output']),
    Object.freeze(["laps remaining", '[data-testid="rc06-actual"]', '[data-rc06-row="laps-remaining"] output']),
    Object.freeze(["fuel level", '[data-testid="rc06-actual"]', '[data-rc06-row="fuel-level"] output'])
  ]),
  counted: Object.freeze([
    Object.freeze(["column title", '[data-testid="rc06-column-title"]']),
    Object.freeze(["column rule", '[data-testid="rc06-column-rule"]']),
    Object.freeze(["ledger row", '[data-testid="rc06-row"]']),
    Object.freeze(["trend section", '[data-testid="rc06-trend"]']),
    Object.freeze(["trend point", '[data-testid="rc06-trend-point"]']),
    Object.freeze(["save more", '[data-testid="rc06-save-more"]']),
    Object.freeze(["push ok", '[data-testid="rc06-push-ok"]']),
    Object.freeze(["fuel model note", '[data-testid="rc06-fuel-model-note"]'])
  ]),
  forbidden: Object.freeze([
    /**
     * Omission 1: Packet 16 declares no RPM channel. Drawing a rev cue or short-shift marker
     * would display a value with no source. The element is absent from the DOM entirely —
     * not dashed, not hidden.
     */
    Object.freeze(["a rev-LED or shift-light element", '[class*="rc06-led"]:not([class*="rc06-ledger"])']),
    Object.freeze(["a shift-marker or rev-cue element", '[data-rc06-shift], [class*="rc06-shift"], [class*="rc06-rev"]'])
  ]),
  /**
   * No render defects have been recorded for RC-06. Any future defect must be added here
   * with exact measurements; the ledger is not a blanket exemption.
   */
  knownDefects: Object.freeze([])
})

export const RC06_CAPTURE_MATRIX = Object.freeze(
  CAPTURE_STATES.flatMap((state) =>
    CAPTURE_SIZES.map((size) =>
      Object.freeze({
        size,
        state,
        required: Object.freeze(
          state === "save-more"
            ? [Object.freeze(["balance-tone", "danger"]), Object.freeze(["alerts", "active"])]
            : [
                Object.freeze(["alerts", "silent"]),
                Object.freeze(["fuel-model", "valid"]),
                Object.freeze(["ledger", "measured"])
              ]
        )
      })
    )
  )
)

/**
 * Values that are a pure function of the deterministic fixture are asserted exactly.
 * Values the widget derives from the per-lap ledger (trend chart burn history) are asserted
 * by shape and by count, because freezing measured strings would only prove the fixture ran
 * at the same instant, not that the widget measured correctly.
 */
const RC06_REFERENCE_VALUES_SILENT = Object.freeze({
  "target burn": "2.75",
  "plan laps": "14",
  "pit lap": "41",
  "actual burn": "2.65",
  "fuel level": "38.4",
  "laps remaining": "14.5",
  balance: "+0.5",
  "lift cue": "+0.10",
  gear: "4",
  speed: "214",
  "water temp": "88",
  "delta time": "+0.42",
  "best lap": "01:52.418"
})

/** Lift point is always "--" regardless of state — documented omission 2. */
const RC06_LIFT_POINT_PLACEHOLDER = "--"

/**
 * Texts that must appear in the frame root in both states. State-specific value assertions
 * live in assertValues() below, which branches on entry.state.
 */
const RC06_REQUIRED_TEXT_COMMON = Object.freeze([
  "TARGET", "ACTUAL",
  "BALANCE", "LIFT",
  "2.75",     // target burn (plan value, identical in both states)
  "41",       // pit lap (plan value)
  "214",      // speed (reference telemetry, same in both states)
  "88",       // water temp
  "+0.42",    // delta
  "01:52.418" // best lap
])

/**
 * Omission 1: The rev cue, short-shift marker, and RPM numeral do not exist anywhere in
 * RC-06. These are the leaf-level readouts that would prove a reintroduction; the omission
 * is architectural (no RPM channel in packet 16) not a CSS hide.
 */
const RC06_FORBIDDEN_LEAF_TEXT = Object.freeze([
  Object.freeze(["SHIFT", "would reintroduce the omitted rev cue / short-shift marker (RC-06 omission 1)"]),
  Object.freeze(["RPM", "would label an engine-speed numeral RC-06 does not render (RC-06 omission 1)"])
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

function assertColumnCounts(metrics) {
  if (countOf(metrics, "column title") !== RC06_COLUMN_COUNT) {
    fail(`RC-06 must render exactly ${RC06_COLUMN_COUNT} column titles (TARGET + ACTUAL)`)
  }
  if (countOf(metrics, "column rule") !== RC06_COLUMN_RULE_COUNT) {
    fail(`RC-06 must render exactly ${RC06_COLUMN_RULE_COUNT} signature column rules`)
  }
}

function assertLedgerRows(metrics) {
  const count = countOf(metrics, "ledger row")
  // 3 peripheral (position, speed, water) + 3 target (target-burn, plan-laps, pit-lap)
  // + 1 target-ladder (dry-lap) + 3 actual (actual-burn, laps-remaining, fuel-level)
  // + 2 delta (delta, best) + 2 lift (gear, lift-point) = 14 in DOM always
  if (count < 13) fail(`RC-06 must render at least 13 ledger rows, found ${count}`)
}

function assertValues(metrics, entry) {
  // Lift point is always "--" regardless of state — omission 2 is normative.
  const liftPoint = valueOf(metrics, "lift point")
  if (liftPoint.text !== RC06_LIFT_POINT_PLACEHOLDER) {
    fail(
      `LIFT PT must always read "${RC06_LIFT_POINT_PLACEHOLDER}" — packet 16 declares no lap-distance channel ` +
        `(RC-06 omission 2). The widget ignores lapDistanceM. Received: "${liftPoint.text}"`
    )
  }

  if (entry.state === "silent") {
    for (const [label, expected] of Object.entries(RC06_REFERENCE_VALUES_SILENT)) {
      const value = valueOf(metrics, label)
      if (value.text !== expected) {
        fail(`${label} output reads "${value.text}" instead of the reference "${expected}"`)
      }
    }
  }

  if (entry.state === "save-more") {
    // At the save-more plateau: lap 27, burn=3.1 L/lap, fuel=37.5 L, lapsRemaining≈12.10
    // balance = 12.10 - 14 = -1.90 → "-1.9"
    // lift = 2.75 - 3.1 = -0.35 → "-0.35"
    const actualBurn = valueOf(metrics, "actual burn")
    if (actualBurn.text !== "3.10") {
      fail(`actual burn reads "${actualBurn.text}" in save-more state, expected "3.10"`)
    }
    const fuelLevel = valueOf(metrics, "fuel level")
    if (fuelLevel.text !== "37.5") {
      fail(`fuel level reads "${fuelLevel.text}" in save-more state, expected "37.5"`)
    }
    const balance = valueOf(metrics, "balance")
    // Balance is negative in save-more (behind plan)
    if (!balance.text.startsWith("-")) {
      fail(`balance reads "${balance.text}" in save-more state — must be negative (behind plan)`)
    }
    const liftCue = valueOf(metrics, "lift cue")
    if (liftCue.text !== "-0.35") {
      fail(`lift cue reads "${liftCue.text}" in save-more state, expected "-0.35"`)
    }
    // Plan values remain the same
    if (valueOf(metrics, "target burn").text !== "2.75") fail('target burn must be "2.75" in save-more state')
    if (valueOf(metrics, "pit lap").text !== "41") fail('pit lap must be "41" in save-more state')
  }
}

function assertAlertSurfaces(metrics, entry) {
  const saving = entry.state === "save-more"

  if (metrics.stateAttributes["plan"] !== "loaded") {
    fail("the engineer plan must be loaded — dispatch racecon:save-mode-plan before capture")
  }
  if (metrics.stateAttributes["ledger"] !== "measured") {
    fail("the per-lap ledger must be measured — the fixture must cross at least one lap boundary")
  }
  if (metrics.stateAttributes["fuel-model"] !== "valid") {
    fail(
      `the fuel model reports ${metrics.stateAttributes["fuel-model"]} in the ${entry.state} scenario — ` +
        "provide fuelPerLapLiters and fuelLiters in every frame"
    )
  }

  if (saving) {
    if (metrics.stateAttributes["alerts"] !== "active") {
      fail("data-rc06-alerts must be active in the save-more scenario")
    }
    if (!String(metrics.stateAttributes["alert-keys"] ?? "").includes("SAVE MORE")) {
      fail(`data-rc06-alert-keys "${metrics.stateAttributes["alert-keys"]}" must contain "SAVE MORE"`)
    }
    if (metrics.stateAttributes["balance-tone"] !== "danger") {
      fail(`data-rc06-balance-tone must be danger in save-more, received "${metrics.stateAttributes["balance-tone"]}"`)
    }
    if (countOf(metrics, "save more") !== 1) {
      fail("the SAVE MORE element must be rendered exactly once in the save-more scenario")
    }
  } else {
    if (metrics.stateAttributes["alerts"] !== "silent") {
      fail(`data-rc06-alerts must be silent, received "${metrics.stateAttributes["alerts"]}"`)
    }
    if (metrics.stateAttributes["alert-keys"] !== "") {
      fail(`data-rc06-alert-keys must be empty in silent state, received "${metrics.stateAttributes["alert-keys"]}"`)
    }
    if (metrics.stateAttributes["balance-tone"] === "danger") {
      fail("balance-tone must not be danger in the silent scenario")
    }
    if (countOf(metrics, "save more") !== 0) {
      fail("the SAVE MORE element must not be rendered in the silent scenario")
    }
  }

  // PUSH OK and FUEL MODEL NOTE are absent in both governed states.
  if (countOf(metrics, "push ok") !== 0) {
    fail("the PUSH OK element must not be rendered — this fixture does not trigger the over-saving alert")
  }
  if (countOf(metrics, "fuel model note") !== 0) {
    fail("the FUEL MODEL INVALID note must not be rendered — this fixture always provides valid fuel channels")
  }
}

function assertTrendZone(metrics, entry) {
  const isApp = entry.size.layout === "app"
  const trendPresent = metrics.trendZone?.present ?? false
  const trendPoints = countOf(metrics, "trend point")

  if (isApp) {
    if (!trendPresent) {
      fail("the fuel trend section must be present at app (1024×600) layout")
    }
    // The trend section must have at least one burn point (the fixture drives 2 lap boundaries).
    if (trendPoints < 1) {
      fail(`the fuel trend must render at least 1 burn point in app layout, found ${trendPoints}`)
    }
    // Trend section count from the counted array (always 0 at non-app, ≥1 at app from DOM)
    if (countOf(metrics, "trend section") !== 1) {
      fail("the fuel trend section must appear exactly once in the DOM at app layout")
    }
  } else {
    /**
     * Omission 3: Packet 12.1 marks the trend chart as app-only (1024×600). It does not
     * exist in native or compact layouts. Its absence is the contract, not a missing element.
     */
    if (trendPresent) {
      fail("the fuel trend section must be absent from the DOM at non-app layouts (RC-06 omission 3)")
    }
    if (trendPoints !== 0) {
      fail(`the fuel trend must not render any burn points at non-app layout, found ${trendPoints}`)
    }
  }
}

/**
 * image-qa-v1 ordering assertion: balance > laps > L/lap > lift > labels
 * A tie is a failure — two readouts at the same size carry no hierarchy.
 */
function assertTypeScale(metrics) {
  return assertTypeScaleOrder([
    { label: "balance", fontSize: valueOf(metrics, "balance").fontSize },
    { label: "laps remaining", fontSize: valueOf(metrics, "laps remaining").fontSize },
    { label: "actual burn", fontSize: valueOf(metrics, "actual burn").fontSize },
    { label: "lift cue", fontSize: valueOf(metrics, "lift cue").fontSize },
    { label: "column title", fontSize: valueOf(metrics, "column title").fontSize }
  ])
}

export function validateCaptureMetrics(metrics, entry) {
  const common = validateCommonMetrics(metrics, entry, RC06_SPEC)

  // Native content-box modifier — absent at non-native layouts.
  if (metrics.nativeSize !== (entry.size.layout === "native" ? "800x480" : null)) {
    fail("the native content-box modifier does not match the selected layout")
  }

  for (const expected of RC06_REQUIRED_TEXT_COMMON) hasText(metrics, expected)

  /**
   * Omission 1 leaf text: SHIFT and RPM must not appear as readouts.
   * Adjacent text nodes can produce "LFUEL" etc., so this checks at the leaf level.
   */
  for (const [forbidden, why] of RC06_FORBIDDEN_LEAF_TEXT) lacksLeafText(metrics, forbidden, why)

  assertColumnCounts(metrics)
  assertLedgerRows(metrics)
  assertValues(metrics, entry)
  assertAlertSurfaces(metrics, entry)
  assertTrendZone(metrics, entry)

  return { ...common, typeScale: assertTypeScale(metrics) }
}

const RC06_MIN_NON_CANVAS_PIXELS = 5_000
const RC06_MIN_ALERT_PIXELS = 30
const RC06_CANVAS_RGB = [11, 13, 10]

/**
 * The pixel audit proves what the metric contract cannot: that the frame is opaque, that it
 * is not blank, and — the point of the exercise — that the danger hue is absent from the
 * silent frame and confined to the balance zone when the behind-plan alert is latched.
 *
 * Colour is confirmed by HUE FAMILY, never by a channel ratio. RC-06 rests on an amber
 * caution palette (balance-tone="caution") and a green surplus palette; amber and red have
 * different hue angles and the audit already separates them.
 */
export function validateCapturePixels(buffer, entry, metrics) {
  if (!isGovernedSize(entry.size)) fail(`unsupported capture pixel-audit size ${entry.size.width}x${entry.size.height}`)
  const image = decodeCapturePng(buffer, entry.size)

  const dangerFamily = hueFamilyOfHex(RC06_DANGER_HEX)

  // The SAVE MORE text, the balance numeral and the balance arrow are all inside the
  // balance zone (.rc06-balance). Any danger pixel outside that rect is a leak.
  const scopes = entry.state === "save-more" ? { [dangerFamily]: [metrics.alertScope] } : {}
  const audit = auditHueFamilies(image, scopes)

  // Verify the frame is not blank by counting non-canvas pixels.
  let nonCanvasPixels = 0
  const canvasRgba = [...RC06_CANVAS_RGB, 255]
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (!sameRgba(rgbaAt(image, x, y), canvasRgba)) nonCanvasPixels += 1
    }
  }
  if (nonCanvasPixels < RC06_MIN_NON_CANVAS_PIXELS) {
    fail("capture is blank against the RC-06 canvas colour")
  }

  if (entry.state === "silent") {
    assertHueFamilyAbsent(audit, dangerFamily, "the silent RC-06 frame")
  } else {
    assertHueFamilyPresent(audit, dangerFamily, "the RC-06 behind-plan frame", RC06_MIN_ALERT_PIXELS)
    assertHueFamilyScoped(audit, dangerFamily, "the RC-06 behind-plan frame")
  }

  return {
    width: image.width,
    height: image.height,
    opaque: true,
    nonCanvasPixels,
    hueFamilies: audit.counts,
    alertHueFamily: dangerFamily,
    alertHueOutsideScope: audit.outside[dangerFamily] ?? 0
  }
}

export { CaptureSafetyError, exact }
