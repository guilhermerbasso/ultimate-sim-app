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
 * RC-05 "Thermal Window" owns only what its DOM contract, zones, channels, alert families and
 * documented omissions make different from the rest of the RaceCon portfolio. Every generic
 * capture property — the governed viewport matrix, the breakpoint contract, the geometry
 * measurement helpers, the shared metric contract, the pixel primitives and the whole capture
 * lifecycle including the disk-safety gates — comes from `racecon-capture-shared.mjs`, which
 * in turn re-exports RC-01's safety primitives unchanged.
 */

export const RC05_PRESET_ID = "racecon_rc05_dash"
export const RC05_WIDGET_ID = "raceconRc05Dash"
export const RC05_SOURCE_IDENTITY = "iracing:session:75:connection:1"

/** Two governed scenarios: the silent frame, and the LF corner overheat alert. */
export const CAPTURE_STATES = Object.freeze(["silent", "corner-overheat"])

export const RC05_CORNER_COUNT = 4
export const RC05_WINDOW_TICK_COUNT = 8   // 2 bracket ticks per gauge × 4 gauges
export const RC05_PRESSURE_RING_COUNT = 4  // background ring always drawn, even without TPMS
/** RR has no TPMS sensor in the reference frame. Pressure-band and -mark are absent on RR. */
export const RC05_PRESSURE_BAND_COUNT = 3  // LF, RF, LR only (Omission 6)
export const RC05_PRESSURE_MARK_COUNT = 3  // LF, RF, LR only (Omission 6)
export const RC05_TREND_ROW_COUNT = 4

/**
 * The danger-red token. Painted only on overheat/pressure-alert surfaces.
 * Hue ≈7.6° → red family in the shared classifier.
 */
export const RC05_DANGER_HEX = "#F04A32"

/**
 * The signature coral on the hot ramp arc. Always present — even in silent frames — and is NOT
 * an alert colour. The contract report claims hue ≈18° (amber), but the actual RGB components
 * (R=255, G=106, B=61) yield hue = 60×(106-61)/(255-61) ≈ 13.9°, which falls BELOW the 15°
 * red/amber boundary in the shared hue classifier. The coral arc is therefore RED-FAMILY, which
 * means the real render always produces many red pixels even in the silent state. Accordingly
 * validateCapturePixels does not assert "red absent from silent"; it instead asserts the green
 * and cyan colour invariants that survive in every state, and asserts "red present" only for
 * the overheat alert state (where danger-red surfaces add to the coral contribution).
 */
export const RC05_CORAL_HEX = "#FF6A3D"

/**
 * Zone-escape defect recorded in `RC05_SPEC.containmentDefects` and audited by the shared
 * containment sweep against this budget.
 *
 * When the overheat zoom animation is active, the LF corner article expands beyond the
 * mandala zone boundaries. Measured across all six breakpoints in the corner-overheat state:
 *   • left escape: max 7.73 px (867×412)
 *   • top  escape: max 6.24 px (1024×600)
 * The native 800×480 layout is unaffected (mandala = full viewport, so any corner position
 * is inside it). Root cause: the CSS scale transform on the corner article expands it outside
 * its grid cell. Budget: 9 px on any edge covers all measured escapes plus rounding variance.
 */
export const RC05_LF_CORNER_ZOOM_ESCAPE_BUDGET_PX = 9
export const RC05_MIN_ALERT_PIXELS = 30

export const RC05_SPEC = Object.freeze({
  artifact: "RaceCon RC-05",
  script: "racecon-rc05-capture.mjs",
  presetId: RC05_PRESET_ID,
  widgetId: RC05_WIDGET_ID,
  attrPrefix: "data-rc05-",
  rootSelector: "#racecon-rc05-capture-root",
  captureHtml: "racecon-rc05-capture.html",
  dashboardSelector: ".rc05-dashboard",
  sourceIdentity: RC05_SOURCE_IDENTITY,
  stateAttributes: Object.freeze(["emphasis", "alerts", "alert-corners", "trend"]),
  zones: Object.freeze([
    Object.freeze(["mandala", '[data-testid="rc05-mandala"]']),
    Object.freeze(["delta", '[data-testid="rc05-delta"]']),
    Object.freeze(["aids", '[data-testid="rc05-aids"]']),
    Object.freeze(["legend", '[data-testid="rc05-legend"]']),
    // trend and pressures are always in the DOM; CSS hides them outside app layout (Omission 2).
    Object.freeze(["trend", '[data-testid="rc05-trend"]']),
    Object.freeze(["pressures", '[data-testid="rc05-pressures"]']),
    Object.freeze(["peripheral", '[data-testid="rc05-peripheral"]'])
  ]),
  // Zone overlap exemptions.
  // In the native 800×480 layout the <section data-testid="rc05-mandala"> is the FULL-VIEWPORT
  // wrapper (rect 0,0,800,480) and all other visible zones are positioned inside or on top of
  // it. Every mandala/*-zone pair must therefore be exempted. In app and compact layouts the
  // mandala is the narrower centre column and does not physically overlap the side columns, so
  // these exemptions are never triggered there — they only prevent false failures in native.
  zoneOverlapExemptions: Object.freeze([
    Object.freeze(["mandala", "delta"]),
    Object.freeze(["mandala", "aids"]),
    Object.freeze(["mandala", "legend"]),
    Object.freeze(["mandala", "peripheral"]),
    // trend and pressures are CSS-hidden (zero size) in non-app layouts; in app layout the
    // mandala column does not reach them. Added for safety in case layout metrics shift.
    Object.freeze(["mandala", "trend"]),
    Object.freeze(["mandala", "pressures"])
  ]),
  values: Object.freeze([
    // Per-corner temperatures (hero numerals)
    Object.freeze(["lf-temp", 'article[data-rc05-corner="LF"] output.rc05-temp']),
    Object.freeze(["rf-temp", 'article[data-rc05-corner="RF"] output.rc05-temp']),
    Object.freeze(["lr-temp", 'article[data-rc05-corner="LR"] output.rc05-temp']),
    Object.freeze(["rr-temp", 'article[data-rc05-corner="RR"] output.rc05-temp']),
    // Per-corner pressures (smaller secondary numeral inside each gauge readout)
    Object.freeze(["lf-pressure", 'article[data-rc05-corner="LF"] output.rc05-pressure']),
    Object.freeze(["rf-pressure", 'article[data-rc05-corner="RF"] output.rc05-pressure']),
    Object.freeze(["lr-pressure", 'article[data-rc05-corner="LR"] output.rc05-pressure']),
    // RR pressure shows '--' because there is no TPMS sensor on that corner (Omission 6).
    Object.freeze(["rr-pressure", 'article[data-rc05-corner="RR"] output.rc05-pressure']),
    // Centre delta panel
    Object.freeze(["delta", ".rc05-delta-value"]),
    // Aids strip
    Object.freeze(["tc", 'div[data-rc05-zone="tc"] output.rc05-value']),
    Object.freeze(["brake-f", 'div[data-rc05-zone="brake-f"] output.rc05-value']),
    Object.freeze(["brake-r", 'div[data-rc05-zone="brake-r"] output.rc05-value']),
    // Peripheral strip
    Object.freeze(["gear", 'div[data-rc05-zone="gear"] output.rc05-value']),
    Object.freeze(["speed", 'div[data-rc05-zone="speed"] output.rc05-value']),
    Object.freeze(["fuel-laps", 'div[data-rc05-zone="fuel-laps"] output.rc05-value']),
    // A corner label — used only to anchor the type-scale fourth step (labels < pressure)
    Object.freeze(["corner-label", '[data-testid="rc05-corner-label"]'])
  ]),
  containment: Object.freeze([
    // All four corner articles must be inside the mandala section
    Object.freeze(["LF corner", '[data-testid="rc05-mandala"]', 'article[data-rc05-corner="LF"]']),
    Object.freeze(["RF corner", '[data-testid="rc05-mandala"]', 'article[data-rc05-corner="RF"]']),
    Object.freeze(["LR corner", '[data-testid="rc05-mandala"]', 'article[data-rc05-corner="LR"]']),
    Object.freeze(["RR corner", '[data-testid="rc05-mandala"]', 'article[data-rc05-corner="RR"]']),
    // Aid-strip rows are inside the aids aside
    Object.freeze(["TC readout", '[data-testid="rc05-aids"]', 'div[data-rc05-zone="tc"]']),
    Object.freeze(["brake-F readout", '[data-testid="rc05-aids"]', 'div[data-rc05-zone="brake-f"]']),
    Object.freeze(["brake-R readout", '[data-testid="rc05-aids"]', 'div[data-rc05-zone="brake-r"]']),
    // Peripheral rows are inside the peripheral section
    Object.freeze(["gear readout", '[data-testid="rc05-peripheral"]', 'div[data-rc05-zone="gear"]']),
    Object.freeze(["speed readout", '[data-testid="rc05-peripheral"]', 'div[data-rc05-zone="speed"]']),
    Object.freeze(["fuel-laps readout", '[data-testid="rc05-peripheral"]', 'div[data-rc05-zone="fuel-laps"]'])
  ]),
  counted: Object.freeze([
    Object.freeze(["corner", '[data-testid="rc05-corner"]']),
    Object.freeze(["corner-label", '[data-testid="rc05-corner-label"]']),
    Object.freeze(["gauge", '[data-testid="rc05-gauge"]']),
    Object.freeze(["window-band", '[data-testid="rc05-window-band"]']),
    Object.freeze(["window-tick", '[data-testid="rc05-window-tick"]']),
    Object.freeze(["pressure-ring", '[data-testid="rc05-pressure-ring"]']),
    // rc05-pointer: conditional — absent when tempC is null/stale
    Object.freeze(["pointer", '[data-testid="rc05-pointer"]']),
    // rc05-pressure-band/mark: absent on corners without TPMS (RR in reference frame — Omission 6)
    Object.freeze(["pressure-band", '[data-testid="rc05-pressure-band"]']),
    Object.freeze(["pressure-mark", '[data-testid="rc05-pressure-mark"]']),
    Object.freeze(["trend-row", '[data-testid="rc05-trend-row"]']),
    // rc05-alert-line: conditionally absent (not CSS-hidden) when no alerts latched (Omission 11)
    Object.freeze(["alert-line", '[data-testid="rc05-alert-line"]'])
  ]),
  // Omission 1: Packet §11.4 "optional shift edge cue" has no data source because packet §16
  // declares no RPM channel at all. No shift LEDs, rev cue or RPM indicator is ever drawn.
  forbidden: Object.freeze([
    Object.freeze(["a shift LED or rev indicator", '[class*="rc05-led"], [class*="rc05-rev"], [data-rc05-shift]'])
  ]),
  /**
   * Measured render defects in the shipped RC-05 build, recorded rather than suppressed.
   * Each budget is the measured overflow plus a 1 px allowance for font-metric variance,
   * so a defect that grows, spreads to another breakpoint or appears on another element
   * still fails.
   *
   * DEFECT (app 1024×600 — both states): four peripheral-strip labels and units overflow their
   * CSS-clamped boxes. The `.rc05-label` elements "SPEED" (19 px) and "FUEL" (15 px) and the
   * `.rc05-unit` elements "KM/H" (17 px) and "LAPS" (16 px) all use the same 15 px clamp that
   * the container enforces everywhere else. Root cause: the app-layout peripheral column is
   * narrower than the sum of label + value + unit widths at the 15 px floor, so the labels
   * cannot shrink further. The defect is confined to 1024×600 (smaller compact sizes do not
   * trigger it; native 800×480 uses a different peripheral geometry).
   */
  knownDefects: Object.freeze([
    Object.freeze({
      key: "rc05-label",
      states: Object.freeze(["silent", "corner-overheat"]),
      sizes: Object.freeze(["1024x600"]),
      budgetPx: 20,
      note: "app-layout peripheral labels (SPEED 19 px, FUEL 15 px) overflow their 15 px clamp box"
    }),
    Object.freeze({
      key: "rc05-unit",
      states: Object.freeze(["silent", "corner-overheat"]),
      sizes: Object.freeze(["1024x600"]),
      budgetPx: 18,
      note: "app-layout peripheral units (KM/H 17 px, LAPS 16 px) overflow their compact box alongside the label defect"
    }),
  ]),
  /**
   * Zone-escape defect: the LF corner's overheat scale transform expands the article past the
   * mandala zone it belongs to (left ≤ 7.73 px, top ≤ 6.24 px). The shared containment sweep
   * audits it against this budget, so an escape that grows or spreads still fails.
   */
  containmentDefects: Object.freeze([
    Object.freeze({
      label: "LF corner",
      states: Object.freeze(["corner-overheat"]),
      sizes: Object.freeze(["1024x600", "393x759", "412x867", "759x393", "867x412"]),
      budgetPx: RC05_LF_CORNER_ZOOM_ESCAPE_BUDGET_PX,
      note: "LF corner article escapes mandala zone (left ≤7.73 px, top ≤6.24 px) during overheat zoom animation; native layout unaffected (mandala = full viewport)"
    })
  ])
})

export const RC05_CAPTURE_MATRIX = Object.freeze(
  CAPTURE_STATES.flatMap((state) =>
    CAPTURE_SIZES.map((size) =>
      Object.freeze({
        size,
        state,
        required: Object.freeze(
          state === "corner-overheat"
            ? // Wait for the widget to publish the LF overheat latch rather than guessing a frame count.
              [Object.freeze(["alerts", "active"]), Object.freeze(["alert-corners", "LF"])]
            : // In the silent state the widget must carry zero latched alerts.
              [Object.freeze(["alerts", "silent"])]
        )
      })
    )
  )
)

/**
 * Values that are a pure function of the deterministic fixture are asserted exactly.
 * RR pressure shows '--' because there is no TPMS sensor on that corner (Omission 6).
 * LF temperature differs between states and is checked per-state in validateCaptureMetrics.
 */
const RC05_EXPECTED_VALUES = Object.freeze({
  // Per-corner temperatures (silent state; overheat state is checked separately)
  "rf-temp": "94",
  "lr-temp": "85",
  "rr-temp": "86",
  // Per-corner pressures
  "lf-pressure": "1.93",
  "rf-pressure": "1.97",
  "lr-pressure": "1.90",
  // RR has no TPMS — the honest empty state is '--' (Omission 6)
  "rr-pressure": "--",
  // Delta: positive delta → '+0.137'; tone attribute must be 'bad'
  delta: "+0.137",
  // Aid strip
  tc: "5",
  "brake-f": "412",
  "brake-r": "388",
  // Peripheral strip
  gear: "4",
  speed: "178",
  "fuel-laps": "14.8"
})

/** Text that must appear in the concatenated frame text for both governed states. */
const RC05_REQUIRED_TEXT = Object.freeze([
  // Corner labels — RC-05 is a tyre dashboard, so these are present and required
  "LF", "RF", "LR", "RR",
  // Temps that do not change between states
  "94", "85", "86",
  // Pressure values (LF pressure stays 1.93 in both states)
  "1.93", "1.97", "1.90",
  // Delta (with sign), speed, gear, fuel laps, wear
  "+0.137", "178", "4", "14.8", "18",
  // Aid strip
  "5", "412", "388"
])

/**
 * Omission 1 (normative): the rev-edge cue has no data source. The harness must never find
 * these strings as rendered readout leaves — only the absence is the correct state.
 */
const RC05_FORBIDDEN_LEAF_TEXT = Object.freeze([
  Object.freeze(["SHIFT", "would reintroduce the omitted shift-edge cue (Omission 1: no RPM channel)"]),
  Object.freeze(["RPM", "would label an engine-speed indicator RC-05 does not render (Omission 1)"])
])

/* ── Internal helpers ─────────────────────────────────────────────────────────────────── */

function countOf(metrics, label) {
  const entry = (metrics.counted ?? []).find((candidate) => candidate.label === label)
  if (!entry) fail(`capture did not count ${label}`)
  return entry.count
}

function valueOf(metrics, label) {
  const entry = (metrics.values ?? []).find((candidate) => candidate.label === label)
  if (!entry || !entry.present) fail(`capture is missing the ${label} output`)
  return entry
}

function zoneOf(metrics, name) {
  const zone = (metrics.zones ?? []).find((candidate) => candidate.name === name)
  if (!zone || !zone.present) fail(`capture is missing the ${name} zone`)
  return zone
}

/* ── Per-assertion functions ──────────────────────────────────────────────────────────── */

function assertCounts(metrics, entry) {
  const alarming = entry.state === "corner-overheat"
  if (countOf(metrics, "corner") !== RC05_CORNER_COUNT) {
    fail(`RC-05 must render exactly ${RC05_CORNER_COUNT} corner gauge articles`)
  }
  if (countOf(metrics, "corner-label") !== RC05_CORNER_COUNT) {
    fail(`RC-05 must render exactly ${RC05_CORNER_COUNT} corner labels`)
  }
  if (countOf(metrics, "gauge") !== RC05_CORNER_COUNT) {
    fail(`RC-05 must render exactly ${RC05_CORNER_COUNT} gauge SVGs`)
  }
  if (countOf(metrics, "window-band") !== RC05_CORNER_COUNT) {
    fail(`RC-05 must render exactly ${RC05_CORNER_COUNT} window-band arcs (always drawn)`)
  }
  if (countOf(metrics, "window-tick") !== RC05_WINDOW_TICK_COUNT) {
    fail(`RC-05 must render exactly ${RC05_WINDOW_TICK_COUNT} window-tick bracket marks (2 per gauge)`)
  }
  if (countOf(metrics, "pressure-ring") !== RC05_PRESSURE_RING_COUNT) {
    fail(`RC-05 must render exactly ${RC05_PRESSURE_RING_COUNT} pressure-ring backgrounds (always drawn)`)
  }
  // Pointers: present when tempC is known. All four temps are known in the reference frame.
  if (countOf(metrics, "pointer") !== RC05_CORNER_COUNT) {
    fail(`RC-05 must render exactly ${RC05_CORNER_COUNT} temperature pointers for the reference frame`)
  }
  // Pressure-band and -mark: absent on RR (Omission 6 — no TPMS sensor on that corner).
  if (countOf(metrics, "pressure-band") !== RC05_PRESSURE_BAND_COUNT) {
    fail(
      `RC-05 must render exactly ${RC05_PRESSURE_BAND_COUNT} pressure-band arcs (RR is absent — Omission 6)`
    )
  }
  if (countOf(metrics, "pressure-mark") !== RC05_PRESSURE_MARK_COUNT) {
    fail(
      `RC-05 must render exactly ${RC05_PRESSURE_MARK_COUNT} pressure-mark indicators (RR is absent — Omission 6)`
    )
  }
  if (countOf(metrics, "trend-row") !== RC05_TREND_ROW_COUNT) {
    fail(`RC-05 must render exactly ${RC05_TREND_ROW_COUNT} trend rows in the DOM`)
  }
  // Alert line: absent from DOM entirely when silent (Omission 11); exactly 1 when overheat.
  if (countOf(metrics, "alert-line") !== (alarming ? 1 : 0)) {
    fail(
      `the alert line must be ${alarming ? "present exactly once" : "absent from the DOM"} in the ${entry.state} scenario`
    )
  }
}

function assertCorners(metrics, entry) {
  const alarming = entry.state === "corner-overheat"
  const expected = [
    { id: "LF", band: alarming ? "hot" : "window", overheat: alarming ? "true" : "false", zoom: alarming ? "true" : "false" },
    { id: "RF", band: "window", overheat: "false", zoom: "false" },
    { id: "LR", band: "window", overheat: "false", zoom: "false" },
    { id: "RR", band: "window", overheat: "false", zoom: "false" }
  ]
  for (const exp of expected) {
    const corner = (metrics.corners ?? []).find((candidate) => candidate.id === exp.id)
    if (!corner) fail(`capture is missing the ${exp.id} corner article`)
    if (corner.band !== exp.band) {
      fail(`${exp.id} corner reports band=${corner.band} instead of ${exp.band} in the ${entry.state} scenario`)
    }
    if (corner.overheat !== exp.overheat) {
      fail(`${exp.id} corner reports overheat=${corner.overheat} instead of ${exp.overheat}`)
    }
    if (corner.zoom !== exp.zoom) {
      fail(`${exp.id} corner reports zoom=${corner.zoom} instead of ${exp.zoom}`)
    }
    if (corner.pressureAlert !== "none") {
      fail(`${exp.id} corner reports pressure-alert=${corner.pressureAlert}; the fixture must not trigger a pressure alert`)
    }
    if (corner.cold !== "false") {
      fail(`${exp.id} corner reports cold=${corner.cold}; the fixture must not trigger a cold-graining alert`)
    }
  }
  // RR: pressure-band must be 'unknown' because there is no TPMS sensor (Omission 6).
  const rr = (metrics.corners ?? []).find((candidate) => candidate.id === "RR")
  if (rr && rr.pressureBand !== "unknown") {
    fail(`RR corner must report pressure-band=unknown when no TPMS sensor is present (Omission 6)`)
  }
}

function assertValues(metrics, entry) {
  const alarming = entry.state === "corner-overheat"
  for (const [label, expected] of Object.entries(RC05_EXPECTED_VALUES)) {
    const entry_value = valueOf(metrics, label)
    if (entry_value.text !== expected) {
      fail(`${label} output reads "${entry_value.text}" instead of "${expected}"`)
    }
  }
  // LF temp differs between states
  const lfTemp = valueOf(metrics, "lf-temp")
  const expectedLfTemp = alarming ? "107" : "88"
  if (lfTemp.text !== expectedLfTemp) {
    fail(`LF temp output reads "${lfTemp.text}" instead of "${expectedLfTemp}" in the ${entry.state} scenario`)
  }
  // Delta tone must be 'bad' since deltaToBestSec = +0.137 (behind best lap)
  if (metrics.deltaTone !== "bad") {
    fail(`delta data-tone must be 'bad' for a positive delta, received ${metrics.deltaTone}`)
  }
  // Wear is a separate conditional element (not in spec.values): check it via metrics.wearText
  if (!metrics.wearPresent) {
    fail("the wear element must be present when all four wearPct values are provided")
  }
  if (metrics.wearText !== "18") {
    fail(`wear output reads "${metrics.wearText}" instead of "18"`)
  }
  // Soft-key must show 'TEMP' when emphasis is 'temperature'
  if (metrics.softKeyText !== "TEMP") {
    fail(`soft-key reads "${metrics.softKeyText}" instead of "TEMP" for temperature emphasis`)
  }
  // Verify the RR pressure unavailable class is set (Omission 6)
  const rrPressure = valueOf(metrics, "rr-pressure")
  if (!rrPressure.text.includes("-")) {
    fail(`RR pressure must show the honest empty state ('--') when no TPMS sensor is present (Omission 6)`)
  }
  // Assert horizontal overflow on all readout rects we can check
  for (const [label] of Object.entries(RC05_EXPECTED_VALUES)) {
    const v = valueOf(metrics, label)
    if (v.rect) assertNoHorizontalOverflow(v.rect, `${label} value`)
  }
}

function assertAlertSurfaces(metrics, entry) {
  const alarming = entry.state === "corner-overheat"
  const alertsAttr = metrics.stateAttributes.alerts
  const alertCornersAttr = metrics.stateAttributes["alert-corners"]
  if (alertsAttr !== (alarming ? "active" : "silent")) {
    fail(`data-rc05-alerts must be ${alarming ? "active" : "silent"} in the ${entry.state} scenario, got ${alertsAttr}`)
  }
  if (alertCornersAttr !== (alarming ? "LF" : "")) {
    fail(`data-rc05-alert-corners must be "${alarming ? "LF" : ""}" in the ${entry.state} scenario, got "${alertCornersAttr}"`)
  }
  if (alarming) {
    if (!String(metrics.alertLineText ?? "").includes("LF OVERHEAT")) {
      fail(`the alert line reads "${metrics.alertLineText}" instead of the LF overheat alert`)
    }
    // The alert banner is a full-width strip at the top of the viewport; it is not mandated
    // to be inside the mandala zone (which is narrower in app/compact layouts). Confirm it
    // is at least inside the viewport root.
    if (metrics.alertLineRect) {
      containsRect(metrics.root, metrics.alertLineRect, "alert line", 2)
    }
  }
}

function assertAppOnlyReveals(metrics, entry) {
  const app = entry.size.layout === "app"
  // Omission 2: the trend column is in the DOM but CSS-hidden outside app layout.
  const trendZone = zoneOf(metrics, "trend")
  if ((trendZone.display !== "none") !== app) {
    fail(`the trend column is ${trendZone.display !== "none" ? "visible" : "hidden"} in the ${entry.size.layout} layout`)
  }
  // Omission 2 same for pressures column.
  const pressuresZone = zoneOf(metrics, "pressures")
  if ((pressuresZone.display !== "none") !== app) {
    fail(`the pressures column is ${pressuresZone.display !== "none" ? "visible" : "hidden"} in the ${entry.size.layout} layout`)
  }
  // Trend must reach 'measured' after the lap-boundary crossing in the fixture (Omission 3).
  const trend = metrics.stateAttributes.trend
  if (trend !== "measured") {
    fail(`RC-05 trend must be 'measured' after the fixture crosses a lap boundary, received '${trend}'`)
  }
}

/**
 * image-qa-v2: the type-scale order is what the governance evidence proves and the absolute
 * sizes come from the CSS clamp declarations in the approved attempt-006 build. A tie at any
 * step is a failure — two readouts at the same size carry no hierarchy.
 *
 * Order: tyre temp > delta > pressure > corner labels.
 */
function assertTypeScale(metrics) {
  return assertTypeScaleOrder([
    { label: "lf-temp", fontSize: valueOf(metrics, "lf-temp").fontSize },
    { label: "delta", fontSize: valueOf(metrics, "delta").fontSize },
    { label: "lf-pressure", fontSize: valueOf(metrics, "lf-pressure").fontSize },
    { label: "corner-label", fontSize: valueOf(metrics, "corner-label").fontSize }
  ])
}

/* ── Public validators ────────────────────────────────────────────────────────────────── */

export function validateCaptureMetrics(metrics, entry) {
  const alarming = entry.state === "corner-overheat"

  const common = validateCommonMetrics(metrics, entry, RC05_SPEC)

  // Emphasis must be 'temperature' (the default; the harness never presses the soft-key)
  if (metrics.stateAttributes.emphasis !== "temperature") {
    fail(`RC-05 must rest on temperature emphasis, received ${metrics.stateAttributes.emphasis}`)
  }
  // Native-size modifier is only stamped in the native layout
  if (metrics.nativeSize !== (entry.size.layout === "native" ? "800x480" : null)) {
    fail("the native content-box modifier does not match the selected layout")
  }

  for (const expected of RC05_REQUIRED_TEXT) hasText(metrics, expected)
  // Omission 1: shift/RPM leaf text must never appear
  for (const [forbidden, why] of RC05_FORBIDDEN_LEAF_TEXT) lacksLeafText(metrics, forbidden, why)

  assertCounts(metrics, entry)
  assertCorners(metrics, entry)
  assertValues(metrics, entry)
  assertAlertSurfaces(metrics, entry)
  assertAppOnlyReveals(metrics, entry)

  // The LF corner's overheat scale transform expands the article past the mandala zone; the
  // shared containment sweep audits it against `RC05_SPEC.containmentDefects`.
  return { ...common, typeScale: assertTypeScale(metrics) }
}

const RC05_MAX_CANVAS_CHANNEL = 20

/**
 * The pixel audit proves what the metric contract cannot: the frame is opaque, the canvas
 * background is present, and the hue-family invariants are respected.
 *
 * Colour is confirmed by HUE FAMILY, never by a channel ratio.
 *
 * Coral (#FF6A3D) has hue ≈13.9° — BELOW the 15° red/amber boundary in the shared classifier —
 * so the coral hot-ramp arc IS red-family and is painted in every state, including silent.
 * A "red absent from silent" assertion would therefore fire on every real capture and is not
 * applied here. Instead the audit confirms the green window-band and cyan cold-arc invariants
 * (both must survive in every state), that the overheat state raises the red count above the
 * danger minimum, and — the scope guarantee this artifact CAN make — that every red-family pixel
 * lies inside one of the four corner articles. The thermal ramp and the overheat surface both
 * belong to a corner, so red leaking into the peripheral strip, the delta hero or the app-only
 * trend and pressure columns is a real failure and is caught.
 */
export function validateCapturePixels(buffer, entry, metrics) {
  if (!isGovernedSize(entry.size)) fail(`unsupported capture pixel-audit size ${entry.size.width}x${entry.size.height}`)
  const image = decodeCapturePng(buffer, entry.size)

  // Verify the canvas background row at the bottom of the frame (peripheral strip bottom edge)
  const gutter = rgbaAt(image, 0, image.height - 1)
  if (Math.max(gutter[0], gutter[1], gutter[2]) > RC05_MAX_CANVAS_CHANNEL) {
    fail(`the RC-05 canvas border must be the near-black canvas colour, measured rgba(${gutter.join(",")})`)
  }
  for (let x = 1; x < image.width; x += 1) {
    if (!sameRgba(rgbaAt(image, x, image.height - 1), gutter)) {
      fail(`bottom border pixel ${x},${image.height - 1} is rgba(${rgbaAt(image, x, image.height - 1).join(",")})`)
    }
  }

  const dangerFamily = hueFamilyOfHex(RC05_DANGER_HEX)
  const cornerScopes = (metrics.corners ?? []).map((corner) => corner.rect).filter((rect) => rect && rect.width > 0)
  // The thermal legend's HOT swatch is the same coral as the corner ramp, and the overheat alert
  // banner is itself an alert surface, so both own the red hue family when present.
  const redScopes = [
    ...cornerScopes,
    ...(metrics.legendRect ? [metrics.legendRect] : []),
    ...(metrics.alertLineRect ? [metrics.alertLineRect] : [])
  ]
  const audit = auditHueFamilies(image, cornerScopes.length === RC05_CORNER_COUNT ? { [dangerFamily]: redScopes } : {})

  const nonBlackPixels = countNonBackground(image, gutter)
  if (nonBlackPixels < 5_000) fail("capture is blank against the RC-05 canvas colour")

  // Green window-band and cyan cold-arc must be painted in every state
  assertHueFamilyPresent(audit, "green", "the RC-05 frame")
  assertHueFamilyPresent(audit, "cyan", "the RC-05 frame")

  if (cornerScopes.length !== RC05_CORNER_COUNT) fail("the pixel audit could not resolve all four corner scopes")
  assertHueFamilyScoped(audit, dangerFamily, `the RC-05 ${entry.state} frame`)
  if (entry.state === "corner-overheat") {
    assertHueFamilyPresent(audit, dangerFamily, "the RC-05 overheat frame", RC05_MIN_ALERT_PIXELS)
  }

  return {
    width: image.width,
    height: image.height,
    opaque: true,
    gutter: `rgba(${gutter.join(",")})`,
    nonBlackPixels,
    hueFamilies: audit.counts,
    alertHueFamily: dangerFamily,
    // The thermal ramp shares the danger hue family, so absence is not assertable; containment
    // inside the four corner articles is.
    alertHueScope: "corner articles, the thermal legend and the alert banner",
    alertHueOutsideScope: audit.outside[dangerFamily] ?? 0
  }
}

function countNonBackground(image, background) {
  let count = 0
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (!sameRgba(rgbaAt(image, x, y), background)) count += 1
    }
  }
  return count
}

export { CaptureSafetyError, exact }
