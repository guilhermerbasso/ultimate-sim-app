import {
  CAPTURE_SIZES,
  CaptureSafetyError,
  assertHueFamilyAbsent,
  assertHueFamilyDensityAtLeast,
  assertHueFamilyDensityBelow,
  assertHueFamilyPresent,
  assertHueFamilyScoped,
  assertNoHorizontalOverflow,
  assertTypeScaleOrder,
  auditHueFamilies,
  decodeCapturePng,
  exact,
  fail,
  finite,
  hasText,
  hueFamilyDensityInRects,
  hueFamilyOfHex,
  isGovernedSize,
  lacksLeafText,
  rgbaAt,
  sameRgba,
  validateCommonMetrics
} from "./racecon-capture-shared.mjs"

export { CAPTURE_SIZES }

/**
 * RC-10 "Clear Sight" — a high-contrast, colour-vision-safe driver display. Only what its own
 * DOM contract, zones, channels, alert families and documented omissions make different lives
 * here; everything generic comes from `racecon-capture-shared.mjs`.
 *
 * Governance: attempt-005, re-adjudicated and approved after attempt-006 regressed
 * (rc10-governance-chain-v1.json `approved.reAdjudicated: true`; the superseding verdict is
 * attempt-005/image-qa/image-qa-v2.md).
 */

export const RC10_PRESET_ID = "racecon_rc10_dash"
export const RC10_WIDGET_ID = "raceconRc10Dash"
export const RC10_SOURCE_IDENTITY = "iracing:session:102:connection:3"

/** Two governed scenarios: the silent frame and the FUEL LOW alert. */
export const CAPTURE_STATES = Object.freeze(["silent", "fuel-low"])

/**
 * Fixed element censuses. The approved image QA measured eight shift segments on the reference
 * render and recorded "render 9 shift segments in product" as a risk carried into
 * implementation; the shipped widget renders 9 (8 ramp + 1 over-rev cap), which is what the
 * packet mandates, so 9 is the number the harness enforces.
 */
export const RC10_SHIFT_SEGMENT_COUNT = 9
export const RC10_FUEL_SEGMENT_COUNT = 6
export const RC10_STATUS_CELL_COUNT = 3

/** Fuel-bar segments lit: 8.4 laps fills 4 of 6 at rest, 2.1 laps fills 1 under the alert. */
export const RC10_FUEL_LIT_SILENT = "4"
export const RC10_FUEL_LIT_LOW = "1"

/**
 * Colour families — and why absence cannot be used for RC-10's alerts.
 *
 * RC-10 uses the Okabe-Ito colour-vision-safe set. Under HSV hue classification that set
 * COLLAPSES three of its tokens into ONE family:
 *
 *     caution   #E69F00  hue 41.5 deg  -> amber
 *     danger    #D55E00  hue 26.5 deg  -> amber      (vermilion, not red)
 *     signature #F0E442  hue 55.9 deg  -> amber
 *
 * The resting fuel bar is painted in the signature yellow, so amber is present in quantity on
 * every silent frame — measured 1 652 … 4 116 pixels — and it goes DOWN under the alert
 * (614 … 1 087) because a low tank lights one segment instead of four. Neither absence, nor
 * scope, nor a rising density can prove this artifact's alert by hue. This is the same shape
 * of problem RC-08 recorded when its cold-tyre info blue shared a family with the WET palette.
 *
 * What CAN be proved, and is:
 *   - NOTHING in the Okabe-Ito set lands in the RED family, so red must measure exactly zero
 *     on every frame. A red pixel would mean a token outside the CVD-safe palette had been
 *     introduced, which is the one colour failure this artifact can actually suffer.
 *   - info #56B4E9 (blue, hue 201.6) and normal #009E73 (green, hue 163.7) are painted on
 *     every frame by the delta tile, the shift ramp and the status ranks.
 *   - the alert itself is proved the way a colour-vision-safe display is SUPPOSED to be
 *     proved: by its REDUNDANT NON-COLOUR ENCODING. The packet's own promise is a triangle
 *     glyph plus the words FUEL LOW, and packet omission `alertGlyphsWhileNormal` says the
 *     glyphs are omitted entirely while normal. So the harness asserts the shape census:
 *     three circles and no triangle at rest, one triangle and two circles under the alert.
 */
export const RC10_INFO_HEX = "#56b4e9"
export const RC10_NORMAL_HEX = "#009e73"
export const RC10_CAUTION_HEX = "#e69f00"
export const RC10_DANGER_HEX = "#d55e00"
export const RC10_SIGNATURE_HEX = "#f0e442"
export const RC10_CANVAS_RGBA = Object.freeze([0, 0, 0, 255]) // bg #000000

/**
 * The fuel tile is the surface that owns the FUEL LOW alert, and two hue measurements pin it.
 *
 * FIRST: amber is perfectly SCOPED. Measured at all six viewports in both states, the number of
 * amber pixels falling OUTSIDE the fuel tile is exactly ZERO — the shift ramp paints info blue
 * and normal green, the delta tile paints info blue, the status ranks paint green and white,
 * and every label is achromatic #DDDDDD. So the caution/danger/signature family never leaves
 * the one element entitled to carry it, and that IS assertable as a scope.
 *
 * SECOND: the density inside the tile separates the two states — DOWNWARDS. A full tank lights
 * four of six signature-yellow segments; a low tank lights one and adds the caution triangle.
 * Measured:
 *     silent     4.433 % · 4.439 % · 7.213 % · 7.790 % · 8.389 % · 9.025 %
 *     fuel-low   1.606 % · 1.805 % · 2.057 % · 2.131 % · 2.596 % · 3.068 %
 * The bounds sit inside that 3.068 % … 4.433 % gap so the check fails closed in BOTH
 * directions: a fuel bar that failed to drain under the alert, and a drained bar on a frame
 * that must be silent. A naive "the alert adds colour" test would have been exactly backwards
 * on this artifact.
 */
export const RC10_FUEL_TILE_AMBER_RESTING_FLOOR = 0.04
export const RC10_FUEL_TILE_AMBER_ENGAGED_CEILING = 0.036

export const RC10_SPEC = Object.freeze({
  artifact: "RaceCon RC-10",
  script: "racecon-rc10-capture.mjs",
  presetId: RC10_PRESET_ID,
  widgetId: RC10_WIDGET_ID,
  attrPrefix: "data-rc10-",
  rootSelector: "#racecon-rc10-capture-root",
  captureHtml: "racecon-rc10-capture.html",
  dashboardSelector: ".rc10-dashboard",
  sourceIdentity: RC10_SOURCE_IDENTITY,
  stateAttributes: Object.freeze(["alerts", "alert-keys", "emphasis", "delta-direction"]),
  /**
   * The four peer tiles that exist at every governed viewport. The fifth row is layout
   * conditional — a status row at native and compact, a plain-language line at app — so it is
   * verified in assertStatusCarrier rather than in the shared zone-overlap sweep, which cannot
   * compare a zone that does not exist.
   */
  zones: Object.freeze([
    Object.freeze(["gear", '[data-testid="rc10-gear"]']),
    Object.freeze(["speed", '[data-testid="rc10-speed"]']),
    Object.freeze(["delta", '[data-testid="rc10-delta"]']),
    Object.freeze(["fuel", '[data-testid="rc10-fuel"]'])
  ]),
  zoneOverlapExemptions: Object.freeze([]),
  values: Object.freeze([
    Object.freeze(["gear", '[data-testid="rc10-gear-value"]']),
    Object.freeze(["speed", '[data-testid="rc10-speed-value"]']),
    Object.freeze(["delta", '[data-testid="rc10-delta-value"]']),
    Object.freeze(["fuel", '[data-testid="rc10-fuel-value"]']),
    Object.freeze(["position", '[data-testid="rc10-position"]']),
    Object.freeze(["water", '[data-testid="rc10-water"]']),
    Object.freeze(["tc", '[data-testid="rc10-tc"]'])
  ]),
  containment: Object.freeze([
    Object.freeze(["gear value", '[data-testid="rc10-gear"]', '[data-testid="rc10-gear-value"]']),
    Object.freeze(["shift bar", '[data-testid="rc10-gear"]', '[data-testid="rc10-shift"]']),
    Object.freeze(["speed value", '[data-testid="rc10-speed"]', '[data-testid="rc10-speed-value"]']),
    Object.freeze(["delta value", '[data-testid="rc10-delta"]', '[data-testid="rc10-delta-value"]']),
    Object.freeze(["delta pattern", '[data-testid="rc10-delta"]', '[data-testid="rc10-delta-pattern"]']),
    Object.freeze(["fuel value", '[data-testid="rc10-fuel"]', '[data-testid="rc10-fuel-value"]']),
    Object.freeze(["fuel bar", '[data-testid="rc10-fuel"]', '[data-testid="rc10-fuel-bar"]'])
  ]),
  counted: Object.freeze([
    Object.freeze(["shift segment", '[data-testid="rc10-shift-seg"]']),
    Object.freeze(["fuel segment", '[data-testid="rc10-fuel-seg"]']),
    Object.freeze(["status cell", '[data-testid="rc10-status-cell"]']),
    Object.freeze(["status icon", '[data-testid="rc10-status-icon"]']),
    Object.freeze(["status row", '[data-testid="rc10-status"]']),
    Object.freeze(["plain line", '[data-testid="rc10-plain"]']),
    Object.freeze(["plain headline", '[data-testid="rc10-plain-headline"]']),
    Object.freeze(["fuel low word", '[data-testid="rc10-fuel-low"]']),
    Object.freeze(["over rev word", '[data-testid="rc10-over-rev"]']),
    Object.freeze(["overheat word", '[data-testid="rc10-overheat"]']),
    Object.freeze(["triangle glyph", '[data-testid="rc10-status-icon"][data-rc10-shape="triangle"]']),
    Object.freeze(["octagon glyph", '[data-testid="rc10-status-icon"][data-rc10-shape="octagon"]']),
    Object.freeze(["circle glyph", '[data-testid="rc10-status-icon"][data-rc10-shape="circle"]'])
  ]),
  /**
   * Packet omissions expressed as forbidden selectors — absence is the contract, so the only
   * outcome this check can report is a reintroduction.
   *
   * omission tyreTemperature: sections 11.1 and 12.1 allocate the tyre channel no zone in
   *   either grammar, so it is never drawn and never fabricated. `rc10TyreTemperature()`
   *   returns null unconditionally in the core.
   * omission rpmNumeral: section 11.1 defines no numeric zone for engine RPM, so RPM is
   *   expressed ONLY through the shift bar and no numeral is printed anywhere.
   * omission gearAwareShiftScaling: the normative override pins eight absolute thresholds, so
   *   no gear-aware rescaling attribute may appear on the shift bar.
   */
  forbidden: Object.freeze([
    Object.freeze([
      "a tyre-temperature readout (omission: tyreTemperature)",
      '.rc10-tyre, [data-rc10-zone="tyre"], [data-testid^="rc10-tyre"], [data-channel="tyreTemp"]'
    ]),
    Object.freeze([
      "an RPM numeral (omission: rpmNumeral)",
      '.rc10-rpm, [data-rc10-zone="rpm"], [data-testid="rc10-rpm"], [data-testid="rc10-rpm-value"], [data-channel="rpm"]'
    ]),
    Object.freeze([
      "a gear-aware shift rescaling marker (omission: gearAwareShiftScaling)",
      "[data-rc10-shift-gear], [data-rc10-shift-scaled]"
    ])
  ]),
  /**
   * The measured delta/fuel zone overflow and value containment defects have been corrected.
   * These ledger arrays are intentionally empty so the harness fails closed on recurrence - any
   * new overflow, zone overflow, or containment escape is an unconditional hard failure. Explicit
   * positive assertions are added to validateCaptureMetrics below.
   */
  knownDefects: Object.freeze([]),
  zoneOverflowDefects: Object.freeze([]),
  containmentDefects: Object.freeze([])

})

export const RC10_CAPTURE_MATRIX = Object.freeze(
  CAPTURE_STATES.flatMap((state) =>
    CAPTURE_SIZES.map((size) =>
      Object.freeze({
        size,
        state,
        // The harness waits on the published alert attributes, never on a guessed frame count.
        required: Object.freeze(
          state === "fuel-low"
            ? [Object.freeze(["alerts", "active"]), Object.freeze(["alert-keys", "FUEL LOW"])]
            : [Object.freeze(["alerts", "silent"]), Object.freeze(["alert-keys", ""])]
        )
      })
    )
  )
)

/** Reference readings from the fixture. */
const RC10_EXPECTED = Object.freeze({
  gear: "4",
  speed: "187",
  delta: "-0.284",
  fuelSilent: "8.4",
  fuelLow: "2.1",
  position: "7",
  water: "92",
  tc: "3"
})

/** The exact plain-language sentence the app layout must carry in each state. */
const RC10_PLAIN_HEADLINE = Object.freeze({
  silent: "FUEL OK - PUSH",
  "fuel-low": "FUEL LOW - SAVE FUEL"
})

function countOf(metrics, label) {
  const entry = (metrics.counted ?? []).find((candidate) => candidate.label === label)
  if (!entry) fail(`capture did not count ${label}`)
  return entry.count
}

function valueOf(metrics, label) {
  const value = (metrics.values ?? []).find((candidate) => candidate.label === label)
  if (!value || !value.present) fail(`capture is missing the ${label} readout`)
  return value
}

function zoneOf(metrics, name) {
  const zone = (metrics.zones ?? []).find((candidate) => candidate.name === name)
  if (!zone || !zone.present) fail(`capture is missing the ${name} zone`)
  return zone
}

function containmentOf(metrics, label) {
  const item = (metrics.containment ?? []).find((candidate) => candidate.label === label)
  if (!item) fail(`containment measurement for ${label} is missing`)
  if (!item.owner || !item.value) fail(`${label} has no measurable owner or value rect`)
  return item
}

function assertContainedRect(label, owner, value) {
  const escape = {
    left:   finite(owner.left, `${label} owner left`) - finite(value.left, `${label} value left`),
    right:  finite(value.left, `${label} value left`) + finite(value.width, `${label} value width`) -
            (finite(owner.left, `${label} owner left`) + finite(owner.width, `${label} owner width`)),
    top:    finite(owner.top, `${label} owner top`) - finite(value.top, `${label} value top`),
    bottom: finite(value.top, `${label} value top`) + finite(value.height, `${label} value height`) -
            (finite(owner.top, `${label} owner top`) + finite(owner.height, `${label} owner height`))
  }
  const worst = Math.max(...Object.values(escape))
  if (worst > 0.5) {
    const edge = Object.entries(escape).find(([, px]) => px === worst)[0]
    fail(`${label} escapes its tile on the ${edge} by ${worst.toFixed(2)}px - the value rect must stay inside its tile at every viewport and state`)
  }
}

function assertTileContentFits(metrics, zoneName, valueLabel) {
  const zone = zoneOf(metrics, zoneName)
  const overflow = finite(zone.scrollHeight, `${zoneName} scrollHeight`) - finite(zone.layoutHeight, `${zoneName} layoutHeight`)
  if (overflow > 0.5) {
    fail(
      `${zoneName} tile content height (${zone.scrollHeight.toFixed(2)}px) exceeds layout height ` +
        `(${zone.layoutHeight.toFixed(2)}px) by ${overflow.toFixed(2)}px - the tile must not overflow at any viewport or state`
    )
  }
  const item = containmentOf(metrics, valueLabel)
  assertContainedRect(valueLabel, item.owner, item.value)
}

function assertReadings(metrics, entry) {
  const expected = {
    gear: RC10_EXPECTED.gear,
    speed: RC10_EXPECTED.speed,
    delta: RC10_EXPECTED.delta,
    fuel: entry.state === "fuel-low" ? RC10_EXPECTED.fuelLow : RC10_EXPECTED.fuelSilent,
    position: RC10_EXPECTED.position,
    water: RC10_EXPECTED.water,
    tc: RC10_EXPECTED.tc
  }
  for (const [label, text] of Object.entries(expected)) {
    const value = valueOf(metrics, label)
    if (value.text !== text) fail(`${label} reads "${value.text}" instead of "${text}"`)
    assertNoHorizontalOverflow(value.rect, `${label} value`)
  }
}

/**
 * The fixed censuses. The shift bar is nine segments — eight ramp plus one over-rev cap — at
 * every viewport in every state, because the normative override pins eight absolute thresholds
 * and adds the cap; the fuel bar is six; the status carrier holds three cells.
 */
function assertCensus(metrics) {
  if (countOf(metrics, "shift segment") !== RC10_SHIFT_SEGMENT_COUNT) {
    fail(
      `the shift bar must render ${RC10_SHIFT_SEGMENT_COUNT} segments (8 ramp + 1 over-rev cap), ` +
        `found ${countOf(metrics, "shift segment")}`
    )
  }
  if (metrics.shiftSegments !== String(RC10_SHIFT_SEGMENT_COUNT)) {
    fail(`the shift bar must publish data-rc10-segments="${RC10_SHIFT_SEGMENT_COUNT}", received "${metrics.shiftSegments}"`)
  }
  if (countOf(metrics, "fuel segment") !== RC10_FUEL_SEGMENT_COUNT) {
    fail(`the fuel bar must render ${RC10_FUEL_SEGMENT_COUNT} segments, found ${countOf(metrics, "fuel segment")}`)
  }
  if (metrics.fuelSegments !== String(RC10_FUEL_SEGMENT_COUNT)) {
    fail(`the fuel bar must publish data-rc10-segments="${RC10_FUEL_SEGMENT_COUNT}", received "${metrics.fuelSegments}"`)
  }
  if (countOf(metrics, "status cell") !== RC10_STATUS_CELL_COUNT) {
    fail(`the status carrier must hold ${RC10_STATUS_CELL_COUNT} cells, found ${countOf(metrics, "status cell")}`)
  }
}

/**
 * omission appStatusRowZone — packet 12.1 defines no 1024x600 zone for position, water or TC,
 * so the 800x480 status row is OMITTED at app size and all three channels are carried by the
 * plain-language line instead. Absence is the contract in one direction and presence in the
 * other, and both are asserted so neither can be quietly dropped.
 */
function assertStatusCarrier(metrics, entry) {
  const app = entry.size.layout === "app"
  if (countOf(metrics, "status row") !== (app ? 0 : 1)) {
    fail(
      `the status row must be omitted at app size and present elsewhere (omission: appStatusRowZone); ` +
        `found ${countOf(metrics, "status row")} at ${entry.size.layout}`
    )
  }
  if (countOf(metrics, "plain line") !== (app ? 1 : 0)) {
    fail(`the plain-language line exists at app size only; found ${countOf(metrics, "plain line")} at ${entry.size.layout}`)
  }
  if (!app) {
    if (countOf(metrics, "plain headline") !== 0) fail("no plain-language headline may render outside the app layout")
    return
  }
  if (metrics.plainCarried !== "position,water,tc") {
    fail(`the app plain line must carry position, water and TC, received data-rc10-carried="${metrics.plainCarried}"`)
  }
  const expected = RC10_PLAIN_HEADLINE[entry.state]
  if (metrics.plainHeadline !== expected) {
    fail(`the app plain-language headline reads "${metrics.plainHeadline}" instead of "${expected}"`)
  }
}

/**
 * The FUEL LOW alert, and the redundant non-colour encoding that is the whole point of a
 * colour-vision-safe display.
 *
 * omission alertGlyphsWhileNormal — the triangle and octagon glyphs are OMITTED while normal
 * and the undocumented neutral rank is supplied as the hollow-ring / solid-circle ladder. So a
 * silent frame must carry three circles and NO triangle and NO octagon; the engaged frame adds
 * exactly one triangle beside the fuel tile and keeps the three status circles.
 */
function assertAlert(metrics, entry) {
  const alerts = metrics.stateAttributes.alerts
  const alertKeys = String(metrics.stateAttributes["alert-keys"] ?? "")
  const emphasis = metrics.stateAttributes.emphasis
  if (entry.state === "fuel-low") {
    if (alerts !== "active") fail(`the fuel-low state must publish data-rc10-alerts="active", received "${alerts}"`)
    if (alertKeys !== "FUEL LOW") {
      fail(`data-rc10-alert-keys must be exactly "FUEL LOW" in the fuel-low state, received "${alertKeys}"`)
    }
    if (emphasis !== "fuel") fail(`the fuel-low state must emphasise the fuel tile, received data-rc10-emphasis="${emphasis}"`)
    if (metrics.fuelEmphasised !== "true") {
      fail(`the fuel tile must publish data-rc10-emphasised="true" under its own alert, received "${metrics.fuelEmphasised}"`)
    }
    if (metrics.fuelLit !== RC10_FUEL_LIT_LOW) {
      fail(`the fuel bar must light ${RC10_FUEL_LIT_LOW} of ${RC10_FUEL_SEGMENT_COUNT} segments at 2.1 laps, received "${metrics.fuelLit}"`)
    }
    if (countOf(metrics, "fuel low word") !== 1) fail("the fuel-low state must print the FUEL LOW word exactly once")
    if (metrics.fuelLowText !== "FUEL LOW") {
      fail(`the fuel alert word reads "${metrics.fuelLowText}" instead of "FUEL LOW"`)
    }
    if (countOf(metrics, "triangle glyph") !== 1) {
      fail(`the fuel-low state must draw exactly one triangle glyph, found ${countOf(metrics, "triangle glyph")}`)
    }
    if (countOf(metrics, "circle glyph") !== RC10_STATUS_CELL_COUNT) {
      fail(`the three status ranks must stay circles under the fuel alert, found ${countOf(metrics, "circle glyph")}`)
    }
  } else {
    if (alerts !== "silent") fail(`the silent state must publish data-rc10-alerts="silent", received "${alerts}"`)
    if (alertKeys !== "") fail(`the silent state must publish empty alert-keys, received "${alertKeys}"`)
    if (emphasis !== "none") fail(`the silent state must emphasise nothing, received data-rc10-emphasis="${emphasis}"`)
    if (metrics.fuelEmphasised !== "false") {
      fail(`the silent fuel tile must publish data-rc10-emphasised="false", received "${metrics.fuelEmphasised}"`)
    }
    if (metrics.fuelLit !== RC10_FUEL_LIT_SILENT) {
      fail(`the fuel bar must light ${RC10_FUEL_LIT_SILENT} of ${RC10_FUEL_SEGMENT_COUNT} segments at 8.4 laps, received "${metrics.fuelLit}"`)
    }
    if (countOf(metrics, "fuel low word") !== 0) fail("the silent frame must print no FUEL LOW word")
    // omission alertGlyphsWhileNormal: no alert glyph exists at all while normal.
    if (countOf(metrics, "triangle glyph") !== 0) {
      fail(
        `${countOf(metrics, "triangle glyph")} triangle glyph(s) on a silent frame — ` +
          "this reintroduces omission alertGlyphsWhileNormal"
      )
    }
    if (countOf(metrics, "circle glyph") !== RC10_STATUS_CELL_COUNT) {
      fail(`the silent frame must draw ${RC10_STATUS_CELL_COUNT} neutral circle ranks, found ${countOf(metrics, "circle glyph")}`)
    }
  }
  // Neither over-rev nor overheat is reachable from this fixture: rpm/maxRpm holds at 0.72 and
  // water sits at 92 degC, well inside the 105 degC engage threshold.
  if (countOf(metrics, "octagon glyph") !== 0) {
    fail(`${countOf(metrics, "octagon glyph")} octagon glyph(s) rendered while water sits at 92 degC`)
  }
  if (countOf(metrics, "over rev word") !== 0) fail("this fixture holds rpm at 0.72 of maxRpm; no OVER REV word may render")
  if (countOf(metrics, "overheat word") !== 0) fail("this fixture holds water at 92 degC; no HOT word may render")
}

function assertNativeSize(metrics, entry) {
  const expected = entry.size.layout === "native" ? "800x480" : null
  if (metrics.nativeSize !== expected) {
    fail(`native content-box modifier must be ${String(expected)}, received ${String(metrics.nativeSize)}`)
  }
}

/**
 * The governed ladder, strictly descending at every breakpoint:
 *   gear digit > speed numeral > delta value > fuel value > status values.
 * Measured 210 > 150 > 86 > 72 > 44 at native and 240 > 180 > 102.19 > 88 > 56 at app, with
 * the same order holding at all four compact viewports. A tie is a failure.
 */
function assertTypeScale(metrics) {
  return assertTypeScaleOrder([
    { label: "gear", fontSize: valueOf(metrics, "gear").fontSize },
    { label: "speed", fontSize: valueOf(metrics, "speed").fontSize },
    { label: "delta", fontSize: valueOf(metrics, "delta").fontSize },
    { label: "fuel", fontSize: valueOf(metrics, "fuel").fontSize },
    { label: "status", fontSize: valueOf(metrics, "position").fontSize }
  ])
}

/**
 * REGRESSION GUARD - delta tile content and value rect must fit the delta tile.
 *
 * Fixed DEFECT RC-10/1: delta zone overflow at 800x480 (+3 px), 759x393 (+12 px) and
 * 867x412 (+21 px), with value bottom escape of 0.94 px, 9.91 px and 18.44 px. The fix tightens
 * `.rc10-delta-value` to the gear rung's 0.75 line-height and moves the compact-landscape
 * delta/fuel row to top 49 / height 28. This assertion runs at every viewport and state.
 */
function assertDeltaTileContentContained(metrics) {
  assertTileContentFits(metrics, "delta", "delta value")
}

/**
 * REGRESSION GUARD - fuel tile content and value rect must fit the fuel tile.
 *
 * Fixed DEFECT RC-10/1: fuel zone overflow at 867x412 (+4 px) and fuel value bottom escape of
 * 1.48 px in the silent state. The fix tightens `.rc10-fuel-value` to the gear rung's 0.75
 * line-height and moves the compact-landscape delta/fuel row to top 49 / height 28. This
 * assertion runs at every viewport and state.
 */
function assertFuelTileContentContained(metrics) {
  assertTileContentFits(metrics, "fuel", "fuel value")
}

const RC10_REQUIRED_TEXT_COMMON = Object.freeze(["GEAR", "SPEED", "KM/H", "DELTA", "FUEL", "LAPS", "POS", "WATER", "TC"])

/**
 * Leaf text that would prove an omitted channel had been invented. The tyre unit and an RPM
 * numeral are the tells: RC-10 prints neither anywhere, in any state, at any viewport.
 */
const RC10_FORBIDDEN_LEAF_TEXT = Object.freeze([
  Object.freeze(["RPM", "would reintroduce the omitted RPM numeral (RC10_PACKET_OMISSIONS.rpmNumeral)"]),
  Object.freeze(["TYRE", "would reintroduce the omitted tyre temperature (RC10_PACKET_OMISSIONS.tyreTemperature)"]),
  Object.freeze(["TYRES", "would reintroduce the omitted tyre temperature (RC10_PACKET_OMISSIONS.tyreTemperature)"])
])

export function validateCaptureMetrics(metrics, entry, _unused) {
  const common = validateCommonMetrics(metrics, entry, RC10_SPEC)

  assertNativeSize(metrics, entry)
  for (const expected of RC10_REQUIRED_TEXT_COMMON) hasText(metrics, expected)
  hasText(metrics, entry.state === "fuel-low" ? RC10_EXPECTED.fuelLow : RC10_EXPECTED.fuelSilent)
  if (entry.state === "fuel-low") hasText(metrics, "FUEL LOW")
  for (const [forbidden, why] of RC10_FORBIDDEN_LEAF_TEXT) lacksLeafText(metrics, forbidden, why)

  assertCensus(metrics)
  assertReadings(metrics, entry)
  assertStatusCarrier(metrics, entry)
  assertAlert(metrics, entry)

  assertDeltaTileContentContained(metrics)
  assertFuelTileContentContained(metrics)

  return { ...common, typeScale: assertTypeScale(metrics) }
}

const RC10_MIN_NON_CANVAS_PIXELS = 5_000

/**
 * The pixel audit proves:
 *  1. the frame is not blank against the RC-10 canvas #000000;
 *  2. the RED family measures exactly zero on EVERY frame. No Okabe-Ito token lands in the red
 *     family — danger #D55E00 is vermilion at hue 26.5 deg, which classifies as amber — so a
 *     single red pixel would mean a token from outside the colour-vision-safe palette had been
 *     introduced. That is the one colour failure this artifact can actually suffer, and it is
 *     asserted at every viewport in both states;
 *  3. info blue #56B4E9 and normal green #009E73 are painted on every frame;
 *  4. the amber family — caution, danger AND signature, which the Okabe-Ito set collapses into
 *     one hue — never leaves the fuel tile that owns it. Measured outside-scope count: exactly
 *     0 at every viewport in both states;
 *  5. the FUEL LOW alert changed that tile, measured as the amber density inside it: at least
 *     4 % at rest (four lit signature-yellow segments) and at most 3.6 % engaged (one lit
 *     segment plus the caution triangle). The direction is DOWNWARDS, which is why a naive
 *     "the alert adds colour" test would have been wrong here.
 *
 * Colour is confirmed by hue family, never by channel ratio: a `g,b < 0.62r` style test
 * measured 8 578 "red" pixels on a frame whose hue-confirmed truth was zero.
 */
export function validateCapturePixels(buffer, entry, metrics) {
  if (!isGovernedSize(entry.size)) fail(`unsupported capture pixel-audit size ${entry.size.width}x${entry.size.height}`)
  const image = decodeCapturePng(buffer, entry.size)
  if (!Array.isArray(metrics.fuelScope) || metrics.fuelScope.length !== 1) {
    fail("capture did not measure the fuel tile rectangle that owns the FUEL LOW alert")
  }
  const amberFamily = hueFamilyOfHex(RC10_SIGNATURE_HEX)
  const audit = auditHueFamilies(image, { [amberFamily]: metrics.fuelScope })

  let nonCanvasPixels = 0
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (!sameRgba(rgbaAt(image, x, y), RC10_CANVAS_RGBA)) nonCanvasPixels += 1
    }
  }
  if (nonCanvasPixels < RC10_MIN_NON_CANVAS_PIXELS) {
    fail("capture is blank against the RC-10 canvas colour (#000000)")
  }

  assertHueFamilyAbsent(
    audit,
    "red",
    "the RC-10 frame (no Okabe-Ito token is in the red family; danger #D55E00 is vermilion at hue 26.5 deg)"
  )
  assertHueFamilyPresent(audit, hueFamilyOfHex(RC10_INFO_HEX), "the RC-10 frame — the info blue surfaces must be painted", 1)
  assertHueFamilyPresent(audit, hueFamilyOfHex(RC10_NORMAL_HEX), "the RC-10 frame — the normal green surfaces must be painted", 1)
  assertHueFamilyScoped(audit, amberFamily, `the RC-10 ${entry.state} frame`)

  const fuelAmber = hueFamilyDensityInRects(image, amberFamily, metrics.fuelScope)
  if (entry.state === "fuel-low") {
    assertHueFamilyDensityBelow(fuelAmber, RC10_FUEL_TILE_AMBER_ENGAGED_CEILING, "the RC-10 fuel-low frame")
  } else {
    assertHueFamilyDensityAtLeast(fuelAmber, RC10_FUEL_TILE_AMBER_RESTING_FLOOR, "the RC-10 silent frame")
  }

  return {
    width: image.width,
    height: image.height,
    opaque: true,
    nonCanvasPixels,
    hueFamilies: audit.counts,
    fuelTileAmberDensity: Number((fuelAmber.density * 100).toFixed(3)),
    fuelTileAmberInside: fuelAmber.inside,
    amberOutsideFuelTile: fuelAmber.outside
  }
}

export { CaptureSafetyError, exact, finite }
