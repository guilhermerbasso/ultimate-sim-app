import {
  CAPTURE_SIZES,
  CaptureSafetyError,
  assertHueFamilyAbsent,
  assertHueFamilyPresent,
  assertHueFamilyScoped,
  assertTypeScaleOrder,
  auditHueFamilies,
  decodeCapturePng,
  exact,
  fail,
  finite,
  hasText,
  hueFamilyOfHex,
  isGovernedSize,
  lacksLeafText,
  validateCommonMetrics
} from "./racecon-capture-shared.mjs"

export { CAPTURE_SIZES }

/**
 * RC-07 "Blue Flags" owns only what its DOM contract, zones, channels, alert families and
 * documented omissions make different from the rest of the RaceCon portfolio. Every generic
 * capture property — the governed viewport matrix, the breakpoint contract, the geometry
 * measurement helpers, the shared metric contract, the pixel primitives and the whole capture
 * lifecycle — comes from `racecon-capture-shared.mjs`, which re-exports RC-01's safety
 * primitives unchanged.
 */

export const RC07_PRESET_ID = "racecon_rc07_dash"
export const RC07_WIDGET_ID = "raceconRc07Dash"
/**
 * Source identity derived from the reference fixture: sessionUniqueId=77, connectionEpoch=1.
 * The ingest buffer uses these two fields to produce "iracing:session:77:connection:1".
 */
export const RC07_SOURCE_IDENTITY = "iracing:session:77:connection:1"

/** Two governed scenarios: the silent (clear-track) frame and the imminent-proximity alert. */
export const CAPTURE_STATES = Object.freeze(["silent", "proximity"])

export const RC07_RADAR_INNER_RING_UNITS = 20
export const RC07_RADAR_OUTER_RING_UNITS = 40
export const RC07_RADAR_CONTACT_LIMIT = 8
export const RC07_TOWER_ROW_LIMIT = 5

/**
 * The blip spread lower bound from the approved governance evidence. The reference frame of
 * four contacts spans 19.9 units; the harness requires >= 12 to allow for fixture variation
 * while still catching a collapsed radial ordering (Attempt 001 had spread 1.5, Attempt 003
 * had spread 6.2 — both below this threshold).
 */
export const RC07_BLIP_SPREAD_MIN_UNITS = 12

/** The imminent-proximity danger token. Its hue family "red" is what the pixel audit tests. */
export const RC07_DANGER_HEX = "#FF4234"

export const RC07_SPEC = Object.freeze({
  artifact: "RaceCon RC-07",
  script: "racecon-rc07-capture.mjs",
  presetId: RC07_PRESET_ID,
  widgetId: RC07_WIDGET_ID,
  attrPrefix: "data-rc07-",
  rootSelector: "#racecon-rc07-capture-root",
  captureHtml: "racecon-rc07-capture.html",
  dashboardSelector: ".rc07-dashboard",
  sourceIdentity: RC07_SOURCE_IDENTITY,
  /**
   * State attributes collected by __rcCommon into metrics.stateAttributes.
   * layout, compact-mode, buffer-state, content-width, content-height are handled
   * separately by __rcCommon and are NOT listed here.
   */
  stateAttributes: Object.freeze([
    "radar",
    "radar-range",
    "radar-range-source",
    "flag",
    "alerts",
    "alert-keys",
    "critical-side"
  ]),
  /**
   * Always-present zones. The tower is conditionally rendered (absent from DOM entirely in
   * native and compact layouts via {showTower ? … : null}), so it is NOT listed here —
   * validateCommonMetrics would fail on present:false. Tower visibility is asserted
   * separately in validateCaptureMetrics.
   */
  zones: Object.freeze([
    Object.freeze(["flag", ".rc07-flag"]),
    Object.freeze(["radar", ".rc07-radar"]),
    Object.freeze(["behind", '[data-rc07-zone="behind"]']),
    Object.freeze(["ahead", '[data-rc07-zone="ahead"]']),
    Object.freeze(["self", ".rc07-self"])
  ]),
  /**
   * Always-present value outputs. Speed, fuel, and flag self-cells are app-only (1024×600
   * only) and are asserted separately in validateCaptureMetrics.
   */
  values: Object.freeze([
    Object.freeze(["flag state", '[data-testid="rc07-flag-state"]']),
    Object.freeze(["gap behind", '[data-testid="rc07-behind-value"]']),
    Object.freeze(["gap ahead", '[data-testid="rc07-ahead-value"]']),
    Object.freeze(["position", '.rc07-cell[data-rc07-cell="position"] output']),
    Object.freeze(["delta", '.rc07-cell[data-rc07-cell="delta"] output']),
    Object.freeze(["gear", '.rc07-cell[data-rc07-cell="gear"] output'])
  ]),
  containment: Object.freeze([
    Object.freeze(["flag state", ".rc07-flag", '[data-testid="rc07-flag-state"]']),
    Object.freeze(["gap behind", '[data-rc07-zone="behind"]', '[data-testid="rc07-behind-value"]']),
    Object.freeze(["gap ahead", '[data-rc07-zone="ahead"]', '[data-testid="rc07-ahead-value"]']),
    Object.freeze(["position", ".rc07-self", '.rc07-cell[data-rc07-cell="position"] output']),
    Object.freeze(["delta", ".rc07-self", '.rc07-cell[data-rc07-cell="delta"] output']),
    Object.freeze(["gear", ".rc07-self", '.rc07-cell[data-rc07-cell="gear"] output'])
  ]),
  counted: Object.freeze([
    Object.freeze(["blip", '[data-testid="rc07-blip"]']),
    Object.freeze(["ring", '[data-testid="rc07-ring"]']),
    Object.freeze(["tower row", '[data-testid="rc07-tower-row"]']),
    Object.freeze(["tower empty", '[data-testid="rc07-tower-empty"]']),
    Object.freeze(["flag duty", '[data-testid="rc07-flag-duty"]']),
    Object.freeze(["radar edge", '[data-testid="rc07-radar-edge"]'])
  ]),
  /**
   * RC07_PACKET_OMISSIONS — elements that must NOT be rendered.
   *
   * shiftCue: packet 11.4 shift/over-rev edge cue omitted because section 16 defines no
   *   engine-speed channel. No shift-LED, no rev bar, no over-rev segment exists.
   *
   * rangeSoftKeyLegend: packet 11.5 radar-range soft-key is bound but unlabelled because
   *   packet 11.1 allocates no legend zone. No label element exists.
   *
   * passAdvice and closingRateNumeral are asserted via leaf text below, not DOM selectors.
   */
  forbidden: Object.freeze([
    Object.freeze([
      "a shift-LED or over-rev element (shiftCue omission: section 16 defines no rpm channel)",
      '[class*="rc07-shift"], [class*="rc07-led"], [class*="rc07-rev-"], [class*="rc07-over-rev"], [data-rc07-zone="rpm"]'
    ]),
    Object.freeze([
      "a radar-range legend label (rangeSoftKeyLegend omission: packet 11.1 allocates no legend zone)",
      '[data-testid="rc07-radar-range-legend"], [class*="rc07-range-legend"]'
    ])
  ]),
  /**
   * Known render defects in the shipped RC-07 widget. Each entry carries exact measurements;
   * a defect that GROWS (delta exceeds budget), SPREADS to another breakpoint, or appears on
   * another element still fails.
   */
  knownDefects: Object.freeze([
    Object.freeze({
      id: "app-ahead-shorter-than-self",
      description:
        "In the app layout (1024×600) the ahead strip is shorter than the self strip " +
        "(measured ahead≈150px, self≈156px). The tower zone redistributes height in a way " +
        "that compresses ahead below self, violating the normative behind>ahead>self ordering. " +
        "Affects: app layout only. Budget: self−ahead ≤ 8 px. Diagnosis: app layout adds the " +
        "tower zone to the right column; the proportional allocation used for native/compact " +
        "does not account for the tower's reserved rows, causing ahead to lose ≈56 px relative " +
        "to its normative 205 px while self is only compressed to ≈156 px.",
      affectedBreakpoints: Object.freeze(["1024x600"]),
      budget: Object.freeze({ selfMinusAheadMaxPx: 8 })
    }),
    Object.freeze({
      id: "compact-landscape-ahead-shorter-than-self",
      description:
        "In compact/landscape layouts (759×393: ahead≈102px, self≈110px, delta≈7.86px; " +
        "867×412: ahead≈107px, self≈115px, delta≈8.25px) the ahead strip is shorter than " +
        "the self strip, violating the normative behind>ahead>self ordering. Budget: " +
        "self−ahead ≤ 9 px. Diagnosis: in landscape compact the gap panels and self strip are " +
        "arranged vertically on the right side of the radar; the CSS flex allocation gives self " +
        "the same height percentage as behind (both use flex:1) while ahead uses a smaller flex " +
        "weight, causing self to equal behind in height and exceed ahead.",
      affectedBreakpoints: Object.freeze(["759x393", "867x412"]),
      budget: Object.freeze({ selfMinusAheadMaxPx: 9 })
    }),
    Object.freeze({
      id: "app-type-scale-badge-exceeds-self",
      description:
        "In the app layout (1024×600) the class-badge font-size (measured ≈28px) exceeds " +
        "the self-value font-size (measured ≈26.624px), inverting the normative " +
        "self-value > class-badge ordering by ≈1.4px. Budget: badge−selfValue ≤ 2.0px. " +
        "Diagnosis: at 1024×600 the dashboard's scale function allocates class-badge a fixed " +
        "28px while the self-value output uses a viewport-relative unit that resolves to a " +
        "slightly smaller size, producing the inversion.",
      affectedBreakpoints: Object.freeze(["1024x600"]),
      budget: Object.freeze({ badgeMinusSelfMaxPx: 2.0 })
    }),
    Object.freeze({
      id: "compact-phone-type-scale-self-badge-tie",
      description:
        "In compact/phone layouts (393×759 and 412×867) the self-value (position/gear output) " +
        "and class-badge font-sizes are exactly equal (17.685px and 18.54px respectively), " +
        "producing a TIE that violates the normative self-value > class-badge ordering. " +
        "Budget: badge−selfValue ≤ 0.5px (only the tie is tolerated; any positive inversion " +
        "fails). Diagnosis: in the phone compact layout both self-value and class-badge use " +
        "clamp() units whose resolved values happen to coincide at the phone viewport width.",
      affectedBreakpoints: Object.freeze(["393x759", "412x867"]),
      budget: Object.freeze({ badgeMinusSelfMaxPx: 0.5 })
    }),
    Object.freeze({
      id: "compact-landscape-type-scale-badge-exceeds-self",
      description:
        "In compact/landscape layouts (759×393: badge≈26.57px, selfValue≈22.77px, delta≈3.8px; " +
        "867×412: badge=28px, selfValue=26px, delta=2px) the class-badge font-size exceeds the " +
        "self-value font-size, inverting the normative self-value > class-badge ordering. " +
        "Budget: badge−selfValue ≤ 4.0px. Diagnosis: the compact landscape scale function " +
        "resolves class-badge through the same CSS clamp as app/native breakpoints (giving it " +
        "a larger size) while self-value uses a tighter clamp that produces a smaller resolved " +
        "size at landscape compact dimensions.",
      affectedBreakpoints: Object.freeze(["759x393", "867x412"]),
      budget: Object.freeze({ badgeMinusSelfMaxPx: 4.0 })
    })
  ])
})

export const RC07_CAPTURE_MATRIX = Object.freeze(
  CAPTURE_STATES.flatMap((state) =>
    CAPTURE_SIZES.map((size) =>
      Object.freeze({
        size,
        state,
        required: Object.freeze(
          state === "proximity"
            ? [Object.freeze(["alerts", "active"])]
            : [Object.freeze(["alerts", "silent"])]
        )
      })
    )
  )
)

/* ── Forbidden leaf-text assertions (packet omissions) ──────────────────────────────── */

/**
 * RC07_PACKET_OMISSIONS expressed as leaf-text absence requirements.
 *
 *  closingRateNumeral  — direction glyphs may only be Unicode shapes; if any digit reaches a
 *                        leaf node the numeral is back. (The DOM-level check in
 *                        assertDirectionGlyphsAreGlyphsOnly enforces the specific direction
 *                        element; the leaf text guard is a belt-and-suspenders check.)
 *  passAdvice          — packet 11.1 defines no PASS/HOLD decision rule; these strings must
 *                        never appear as rendered readouts anywhere in the widget.
 *  shiftCue            — "RPM" as a label would accompany an engine-speed numeral that is
 *                        deliberately not rendered.
 *
 *  rangeSoftKeyLegend is asserted via the forbidden DOM selector rather than leaf text
 *  because we cannot know the exact string the legend would use.
 */
const RC07_FORBIDDEN_LEAF_TEXT = Object.freeze([
  Object.freeze(["PASS", "would reintroduce the omitted pass-advice readout (passAdvice omission)"]),
  Object.freeze(["HOLD", "would reintroduce the omitted pass-advice readout (passAdvice omission)"]),
  Object.freeze(["RPM", "would label an engine-speed numeral the shiftCue omission forbids"])
])

/* ── Assertion helpers ──────────────────────────────────────────────────────────────── */

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

/**
 * The governance evidence gives the zone height ordering: gap-behind is tallest, gap-ahead
 * second, self strip shortest (37.5% > 34.3% > 19.8%). This ordering must hold across all
 * six governed viewports WITH these documented exceptions:
 *
 *  compact/phone — behind and ahead are rendered SIDE-BY-SIDE (not stacked) using a shared
 *    `--rc07-phone-gap-height` CSS variable; their heights are intentionally equal. The
 *    `behind > ahead` check is skipped for this layout. The `ahead > self` check still runs.
 *
 *  app + compact/landscape — the `ahead > self` ordering is violated (see knownDefects). The
 *    violation is tolerated within the recorded budget; a growing delta still fails.
 */
function assertZoneHeightOrdering(metrics, entry) {
  const { width, height } = entry.size
  const isCompact = entry.size.layout === "compact"
  const isCompactPhone = isCompact && height > width
  const isCompactLandscape = isCompact && width > height
  const isApp = entry.size.layout === "app"

  const behind = zoneOf(metrics, "behind")
  const ahead = zoneOf(metrics, "ahead")
  const self = zoneOf(metrics, "self")

  // Compact/phone: behind and ahead are side-by-side — skip the between-gap height check.
  if (!isCompactPhone) {
    if (behind.height <= ahead.height) {
      fail(
        `zone height ordering does not hold: behind ${behind.height.toFixed(2)}px must be ` +
          `strictly taller than ahead ${ahead.height.toFixed(2)}px`
      )
    }
  }

  if (ahead.height <= self.height) {
    const delta = self.height - ahead.height
    const defectId = isApp
      ? "app-ahead-shorter-than-self"
      : isCompactLandscape
        ? "compact-landscape-ahead-shorter-than-self"
        : null
    const defect = defectId ? RC07_SPEC.knownDefects.find((d) => d.id === defectId) : null
    const budget = defect?.budget?.selfMinusAheadMaxPx ?? 0
    const exempt = defect && delta <= budget
    if (!exempt) {
      fail(
        `zone height ordering does not hold: ahead ${ahead.height.toFixed(2)}px must be ` +
          `strictly taller than self ${self.height.toFixed(2)}px` +
          (defect && delta > budget
            ? ` (known defect budget is ${budget} px but delta grew to ${delta.toFixed(2)} px)`
            : "")
      )
    }
  }
}

/**
 * The tower zone (`.rc07-tower`) is only rendered in the app layout (1024×600). In all other
 * layouts it is completely absent from the DOM (not just display:none). Assert its presence or
 * absence matches the current layout.
 */
function assertTowerVisibility(metrics, entry) {
  const isApp = entry.size.layout === "app"
  if (isApp) {
    if (!metrics.towerPresent) fail("the tower zone must be present in the app (1024x600) layout")
    if (metrics.towerDisplay === "none") fail("the tower zone must be visible in the app layout")
  } else {
    if (metrics.towerPresent) {
      fail(
        `the tower zone must be absent from the DOM in the ${entry.size.layout} layout; ` +
          `it is conditionally rendered via showTower and must never appear outside app`
      )
    }
  }
}

/**
 * Radar geometry assertions:
 *  - Two concentric rings (inner and outer) must be present when radar is live.
 *  - All blips must be contained within the radar plot bounds.
 *  - Silent frame: exactly 4 blips, spread ≥ 12 units, none inside the critical zone.
 *  - Proximity frame: ≥ 1 blip, that blip is critical.
 */
function assertRadarGeometry(metrics, entry) {
  if (metrics.stateAttributes.radar !== "live") {
    fail(`radar must be live for a connected fixture, received ${metrics.stateAttributes.radar}`)
  }
  if (countOf(metrics, "ring") !== 2) {
    fail("the radar plot must render exactly two concentric rings (inner and outer)")
  }

  const blips = metrics.blips ?? []
  const blipCount = blips.length
  const radarPlotRect = metrics.radarPlotRect
  if (!radarPlotRect || radarPlotRect.width <= 0 || radarPlotRect.height <= 0) {
    fail("the radar plot must have a measurable bounding box")
  }

  // Blip containment: every blip's centre must lie within the radar plot.
  for (let index = 0; index < blips.length; index += 1) {
    const blip = blips[index]
    if (!blip.rect) fail(`blip ${index} has no measurable rect`)
    const cx = blip.rect.left + blip.rect.width / 2
    const cy = blip.rect.top + blip.rect.height / 2
    const tolerance = 2
    if (
      cx < radarPlotRect.left - tolerance ||
      cy < radarPlotRect.top - tolerance ||
      cx > radarPlotRect.left + radarPlotRect.width + tolerance ||
      cy > radarPlotRect.top + radarPlotRect.height + tolerance
    ) {
      fail(
        `blip ${index} centre (${cx.toFixed(2)}, ${cy.toFixed(2)}) escapes the ` +
          `radar plot at (${radarPlotRect.left.toFixed(2)}, ${radarPlotRect.top.toFixed(2)}) ` +
          `${radarPlotRect.width.toFixed(2)}x${radarPlotRect.height.toFixed(2)}`
      )
    }
  }

  if (entry.state === "silent") {
    if (blipCount !== 4) {
      fail(`the silent reference frame must render exactly 4 blips, rendered ${blipCount}`)
    }
    const radii = blips.map((b) => b.radius).sort((a, b) => a - b)
    for (const radius of radii) {
      if (!Number.isFinite(radius) || radius <= 0) {
        fail(`silent frame blip has invalid radius ${radius}`)
      }
      // No blip inside the critical zone (inner ring at 20 units)
      if (radius < RC07_RADAR_INNER_RING_UNITS) {
        fail(
          `silent frame must have 0 critical blips; blip at radius ${radius.toFixed(2)} is ` +
            `inside the ${RC07_RADAR_INNER_RING_UNITS}-unit critical zone`
        )
      }
    }
    const spread = radii[radii.length - 1] - radii[0]
    if (spread < RC07_BLIP_SPREAD_MIN_UNITS) {
      fail(
        `blip radial spread ${spread.toFixed(2)} units is below the ${RC07_BLIP_SPREAD_MIN_UNITS}-unit ` +
          `lower bound; a collapsed radial ordering like Attempt 001 (spread 1.5) would fail here`
      )
    }
    // Radii must be strictly monotonic (sorted ascending by distance)
    for (let i = 1; i < radii.length; i += 1) {
      if (radii[i] <= radii[i - 1]) {
        fail(`blip radii are not strictly monotonically increasing: ${radii.join(", ")}`)
      }
    }
    // Confirm no blip has data-rc07-critical="true"
    const criticalCount = blips.filter((b) => b.critical).length
    if (criticalCount !== 0) {
      fail(`silent frame must have 0 critical blips, found ${criticalCount}`)
    }
  } else if (entry.state === "proximity") {
    if (blipCount < 1) {
      fail("the proximity frame must render at least 1 blip (the critical contact)")
    }
    const criticalBlips = blips.filter((b) => b.critical)
    if (criticalBlips.length < 1) {
      fail(
        `the proximity frame must have at least 1 critical blip (inside the ${RC07_RADAR_INNER_RING_UNITS}-unit zone)`
      )
    }
    for (const blip of criticalBlips) {
      if (blip.radius >= RC07_RADAR_INNER_RING_UNITS) {
        fail(
          `critical blip has radius ${blip.radius.toFixed(2)} which is NOT inside ` +
            `the ${RC07_RADAR_INNER_RING_UNITS}-unit critical zone`
        )
      }
    }
  }
}

/**
 * Alert surfaces per state:
 *  silent    — no active alert markers (no flag-duty, no radar-edge, alerts="silent")
 *  proximity — radar edge present, critical-side matches, alerts="active" with "PROXIMITY"
 */
function assertAlertSurfaces(metrics, entry) {
  const { state } = entry
  const alerts = metrics.stateAttributes.alerts
  const alertKeys = metrics.stateAttributes["alert-keys"]
  const criticalSide = metrics.stateAttributes["critical-side"]

  if (state === "silent") {
    if (alerts !== "silent") fail(`silent capture must have data-rc07-alerts="silent", got "${alerts}"`)
    if (alertKeys !== "") fail(`silent capture must have empty alert-keys, got "${alertKeys}"`)
    if (criticalSide !== "none") {
      fail(`silent capture must have data-rc07-critical-side="none", got "${criticalSide}"`)
    }
    if (countOf(metrics, "flag duty") !== 0) {
      fail('rc07-flag-duty must be absent from a silent (no blue-flag) frame')
    }
    if (countOf(metrics, "radar edge") !== 0) {
      fail('rc07-radar-edge must be absent from a silent (no critical contact) frame')
    }
  } else if (state === "proximity") {
    if (alerts !== "active") fail(`proximity capture must have data-rc07-alerts="active", got "${alerts}"`)
    if (!String(alertKeys).includes("PROXIMITY")) {
      fail(`proximity capture must have "PROXIMITY" in data-rc07-alert-keys, got "${alertKeys}"`)
    }
    if (!["left", "right", "both"].includes(criticalSide)) {
      fail(
        `proximity capture must have data-rc07-critical-side of left/right/both, got "${criticalSide}"`
      )
    }
    if (countOf(metrics, "radar edge") === 0) {
      fail("rc07-radar-edge must be present when the proximity alert is active")
    }
    if (metrics.radarEdgeSide !== criticalSide) {
      fail(
        `radar edge data-rc07-side "${metrics.radarEdgeSide}" must match root critical-side "${criticalSide}"`
      )
    }
  }
}

/**
 * Packet omission: closingRateNumeral — the direction glyph must never contain a digit.
 * The widget derives direction from the SIGN of the gap first difference (▲/▼/▬/–), never
 * from a numeral. If a digit reaches the direction element the omission has been reintroduced.
 */
function assertDirectionGlyphsAreGlyphsOnly(metrics) {
  for (const [label, text] of [
    ["behind direction glyph", metrics.behindDirectionText],
    ["ahead direction glyph", metrics.aheadDirectionText]
  ]) {
    if (text !== null && /\d/.test(text)) {
      fail(
        `${label} contains a numeral "${text}"; the closingRateNumeral omission requires ` +
          `a direction-only Unicode glyph (▲/▼/▬/–), never a closing-rate number`
      )
    }
  }
}

/**
 * App-only self-strip cells (SPEED, FUEL, FLAG) must be present in the app layout and absent
 * (no such element in the DOM) in all other layouts.
 */
function assertAppOnlyCells(metrics, entry) {
  const isApp = entry.size.layout === "app"
  const appCells = ["speed", "fuel", "flag"]
  for (const cell of appCells) {
    const present = metrics.appCells?.[cell]?.present ?? false
    if (isApp && !present) {
      fail(`the ${cell} self-strip cell must be present in the app (1024x600) layout`)
    }
    if (!isApp && present) {
      fail(`the ${cell} self-strip cell must be absent outside the app layout, found at ${entry.size.width}x${entry.size.height}`)
    }
  }
  if (isApp) {
    // Speed must show the reference value (178 km/h)
    const speed = metrics.appCells?.speed
    if (speed && speed.present && speed.text !== "178") {
      fail(`speed cell reads "${speed.text}" instead of "178" (km/h from the fixture)`)
    }
    // Fuel shows "--" (no fuelPerLapLiters in fixture)
    const fuel = metrics.appCells?.fuel
    if (fuel && fuel.present && fuel.text !== "--") {
      fail(`fuel cell reads "${fuel.text}" instead of "--" (no fuelPerLapLiters in fixture)`)
    }
  }
}

/**
 * Type-scale hierarchy: gap-value > self-value > class-badge > label.
 * A tie anywhere is a failure, not a pass.
 *
 * Known defects across layouts (all recorded in RC07_SPEC.knownDefects):
 *  app (1024×600)                — badge slightly exceeds self-value (≈+1.4px), budget 2px
 *  compact/phone (393×759,412×867) — badge exactly ties self-value (delta=0), budget 0.5px
 *  compact/landscape (759×393,867×412) — badge exceeds self-value (≈+2–3.8px), budget 4px
 *
 * For non-affected layouts the shared assertTypeScaleOrder enforces strict ordering.
 */
function assertTypeScale(metrics, entry) {
  const { width, height, layout } = entry.size
  const isCompact = layout === "compact"
  const isApp = layout === "app"
  const isCompactPhone = isCompact && height > width
  const isCompactLandscape = isCompact && width > height

  const gap   = { label: "gap value",   fontSize: finite(metrics.gapValueFontSize,   "gap value font size") }
  const selfV = { label: "self value",  fontSize: finite(metrics.selfValueFontSize,  "self value font size") }
  const badge = { label: "class badge", fontSize: finite(metrics.classBadgeFontSize, "class badge font size") }
  const label = { label: "label",       fontSize: finite(metrics.labelFontSize,      "label font size") }

  // Native layout: strict ordering on all pairs.
  if (!isApp && !isCompact) return assertTypeScaleOrder([gap, selfV, badge, label])

  // All other layouts: check gap > selfV strictly, then apply per-layout budget for selfV vs badge.
  if (gap.fontSize <= selfV.fontSize) {
    fail(
      `type-scale hierarchy does not hold: gap value ${gap.fontSize}px must be strictly ` +
        `larger than self value ${selfV.fontSize}px`
    )
  }

  const selfBadgeDelta = badge.fontSize - selfV.fontSize  // positive → badge exceeds selfV
  const defectId = isApp
    ? "app-type-scale-badge-exceeds-self"
    : isCompactPhone
      ? "compact-phone-type-scale-self-badge-tie"
      : isCompactLandscape
        ? "compact-landscape-type-scale-badge-exceeds-self"
        : null

  if (selfV.fontSize <= badge.fontSize) {
    // selfV <= badge: either tie (delta=0) or inversion (delta>0).
    const defect = defectId ? RC07_SPEC.knownDefects.find((d) => d.id === defectId) : null
    const budget = defect?.budget?.badgeMinusSelfMaxPx ?? 0
    // Exempt only a strict inversion (not a tie) within budget for the phone-tie defect;
    // for other defect IDs, the budget covers both tie and inversion.
    const exempt = defect && selfBadgeDelta <= budget && (defectId !== "compact-phone-type-scale-self-badge-tie" || selfBadgeDelta >= 0)
    if (!exempt) {
      fail(
        `type-scale hierarchy does not hold: self value ${selfV.fontSize}px must be strictly ` +
          `larger than class badge ${badge.fontSize}px` +
          (defect && selfBadgeDelta > budget
            ? ` (known defect budget is ${budget}px but delta grew to ${selfBadgeDelta.toFixed(3)}px)`
            : "")
      )
    }
  }

  if (badge.fontSize <= label.fontSize) {
    fail(
      `type-scale hierarchy does not hold: class badge ${badge.fontSize}px must be strictly ` +
        `larger than label ${label.fontSize}px`
    )
  }

  return [gap, selfV, badge, label]
}

/**
 * Expected text content checks for the silent fixture values.
 */
function assertMeasuredValues(metrics, entry) {
  const flagState = valueOf(metrics, "flag state")
  if (flagState.text !== "GREEN") {
    fail(`flag-state output reads "${flagState.text}" instead of "GREEN" for the green-flag fixture`)
  }
  if (entry.state === "silent") {
    const gapBehind = valueOf(metrics, "gap behind")
    // gapSec = -0.8, Math.abs → "0.8"
    if (gapBehind.text !== "0.8") {
      fail(`gap-behind reads "${gapBehind.text}" instead of "0.8"`)
    }
    const gapAhead = valueOf(metrics, "gap ahead")
    // gapSec = 1.4 → "1.4"
    if (gapAhead.text !== "1.4") {
      fail(`gap-ahead reads "${gapAhead.text}" instead of "1.4"`)
    }
  }
  const position = valueOf(metrics, "position")
  if (position.text !== "14") fail(`position reads "${position.text}" instead of "14"`)
  const gear = valueOf(metrics, "gear")
  if (gear.text !== "4") fail(`gear reads "${gear.text}" instead of "4"`)
  // Delta: no bestLapTimeSec in fixture → "--.---"
  const delta = valueOf(metrics, "delta")
  if (delta.text !== "--.---") {
    fail(`delta reads "${delta.text}" instead of "--.---" (no bestLapTimeSec in fixture)`)
  }
}

export function validateCaptureMetrics(metrics, entry) {
  const common = validateCommonMetrics(metrics, entry, RC07_SPEC)

  for (const [forbidden, why] of RC07_FORBIDDEN_LEAF_TEXT) lacksLeafText(metrics, forbidden, why)

  assertZoneHeightOrdering(metrics, entry)
  assertTowerVisibility(metrics, entry)
  assertRadarGeometry(metrics, entry)
  assertAlertSurfaces(metrics, entry)
  assertDirectionGlyphsAreGlyphsOnly(metrics)
  assertAppOnlyCells(metrics, entry)
  assertMeasuredValues(metrics, entry)

  return { ...common, typeScale: assertTypeScale(metrics, entry) }
}

/* ── Pixel audit ─────────────────────────────────────────────────────────────────────── */

/**
 * Minimum non-neutral pixels required to reject a blank capture. A real RC-07 render has
 * thousands of coloured pixels; a blank frame (all canvas #0A0C10) has zero. The threshold
 * is kept low so synthetic unit-test PNGs (which paint only a few representative zones) pass
 * without needing to flood-fill an entire 800×480 canvas.
 */
const RC07_MIN_NON_CANVAS_PIXELS = 100

/**
 * The pixel audit proves colour containment by hue family, never by channel ratio.
 *
 * The danger hue (#FF4234, family "red") is the only alert colour that appears exclusively
 * on an alert frame. The silent frame must have zero red pixels; the proximity frame must
 * have red pixels, all of them inside the radar zone (the radar edge element and critical
 * blip outlines both live there).
 *
 * A channel-ratio test (r > g, r > b) would misclassify orange class-C badge pixels (#FF8C1A)
 * as red on the silent frame, producing false positives. Hue does not.
 *
 * Canvas background for RC-07 is #0A0C10 (rgb 10, 12, 16). The top row is a safe gutter.
 */
export function validateCapturePixels(buffer, entry, metrics) {
  if (!isGovernedSize(entry.size)) {
    fail(`unsupported capture pixel-audit size ${entry.size.width}x${entry.size.height}`)
  }
  const image = decodeCapturePng(buffer, entry.size)

  const dangerFamily = hueFamilyOfHex(RC07_DANGER_HEX)
  const scopes = entry.state === "proximity" ? { [dangerFamily]: [metrics.alertScope] } : {}
  const audit = auditHueFamilies(image, scopes)

  // Confirm the canvas is not blank against the RC-07 background (#0A0C10 = rgb 10,12,16).
  const totalPixels = image.width * image.height
  const neutralPixels = audit.counts.neutral ?? 0
  if (totalPixels - neutralPixels < RC07_MIN_NON_CANVAS_PIXELS) {
    fail(
      `capture appears blank: only ${totalPixels - neutralPixels} non-neutral pixels ` +
        `(threshold ${RC07_MIN_NON_CANVAS_PIXELS})`
    )
  }

  if (entry.state === "silent") {
    // The approved reference measures 0 danger-family pixels on the silent frame.
    assertHueFamilyAbsent(audit, dangerFamily, "the silent RC-07 frame")
  } else if (entry.state === "proximity") {
    assertHueFamilyPresent(audit, dangerFamily, "the RC-07 proximity frame", 1)
    assertHueFamilyScoped(audit, dangerFamily, "the RC-07 proximity frame")
  }

  return {
    width: image.width,
    height: image.height,
    opaque: true,
    hueFamilies: audit.counts,
    alertHueFamily: dangerFamily,
    alertHueOutsideScope: audit.outside[dangerFamily] ?? 0
  }
}

export { CaptureSafetyError, exact }
