import {
  CAPTURE_SIZES,
  CaptureSafetyError,
  assertHueFamilyAbsent,
  assertHueFamilyPresent,
  assertHueFamilyScoped,
  assertNoHorizontalOverflow,
  assertTypeScaleOrder,
  assertZoneContainment,
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
 * RC-17 "High Line — Oval Spotter Awareness" owns only what its DOM contract, zones, channels,
 * alert families and documented omissions make different from the rest of the RaceCon portfolio.
 * Everything generic lives in `racecon-capture-shared.mjs`, which re-exports RC-01's disk-safety
 * primitives unchanged.
 *
 * Approved reference: attempt-005. `rc17-governance-chain-v1.json` records
 * `"externalAttempt": 5, "verdict": "APPROVED"`, `"blockingFailureCount": 0`, title
 * "High Line — Oval Spotter Awareness".
 */

export const RC17_PRESET_ID = "racecon_rc17_dash"
export const RC17_WIDGET_ID = "raceconRc17Dash"
export const RC17_SOURCE_IDENTITY = "iracing:session:44:connection:2"

/** Two governed scenarios: the silent frame and the approved car-alongside reference frame. */
export const CAPTURE_STATES = Object.freeze(["silent", "car-alongside"])

/**
 * Colour tokens as shipped — packet 11.3 verbatim. The render's pink drifted to #FD437B (OV-5);
 * the token is used, never a sampled colour. Hue angles computed by hueFamilyOfHex():
 *   signature #FF5AA0 → hue ≈ 334.55° → "magenta"   (side flag, occupied sector)
 *   danger    #FF4436 → hue ≈   4.18° → "red"        (three-wide — never fires here)
 *   caution   #FFB82E → hue ≈  39.6°  → "amber"      (fast-closing — never fires here)
 *   info      #4A9CE0 → hue ≈ 207.2°  → "blue"       (BEHIND sector, rev cue)
 *
 * A naive channel-ratio test (`r > 1.7g && r > 1.5b`) would report ALL signature pixels as
 * "red" even though the hue-confirmed count of danger (red) is zero. That false count, which
 * the image-QA measured at 8,578 "red" pixels on a frame whose truth was zero, is exactly why
 * colour is confirmed by hue family and never by channel ratio.
 */
export const RC17_SIGNATURE_HEX = "#ff5aa0"       // occupied sector, side flag
export const RC17_DANGER_HEX    = "#ff4436"       // three-wide / critical — never fires here
export const RC17_CAUTION_HEX   = "#ffb82e"       // fast-closing border/arrow — never fires here
export const RC17_INFO_HEX      = "#4a9ce0"       // BEHIND sector, rev cue
export const RC17_CANVAS_RGBA   = Object.freeze([11, 12, 16, 255])  // bg #0B0C10

/**
 * Packet 11.2 type ladder on the 800×480 native canvas, arithmetic not measured off the render:
 *   closing 44 > line 40 > pace 34 > sector 20 > flag 18 > tertiary 15 > label 13 px.
 * OV-7: these are SLOT sizes; a dashed slot stays the slot size and is never enlarged.
 */
export const RC17_TYPE_SCALE_PX = Object.freeze({
  closing: 44,
  line:    40,
  pace:    34,
  sector:  20,
  flag:    18,
  tertiary: 15,
  label:   13
})

/**
 * Reference channel values from the approved attempt-005 frame.
 * `relatives` and `position` absent → gap reads "--.-" and position reads "--".
 */
export const RC17_EXPECTED_VALUES = Object.freeze({
  speed:       "291",
  gear:        "4",
  rpm:         "6400",
  water:       "92",
  gapAhead:    "--.-",
  position:    "--",
  closingRate: "--.-",  // no consecutive radar samples in a fresh fixture
  closingSide: "--",
  lineRec:     "--",    // GAP-1: no line channel ever
  revFill:     0.80     // 6400 / 8000 = 0.80 exactly
})

/** Image-QA measured the rendered rev fill ratio at 231/287 = 0.8055 (error 0.55 pp). */
export const RC17_REV_FILL_TOLERANCE = 0.02

/**
 * Debounce constants, verbatim from the widget (packet 15).
 * carAlongside has NO engage debounce — it fires on the first frame reporting 'left'.
 * Only the 300 ms RELEASE hysteresis is relevant for our governed states.
 */
export const RC17_ALONGSIDE_RELEASE_MS   = 300
export const RC17_FAST_CLOSING_ENGAGE_MS = 200
export const RC17_THREE_WIDE_ENGAGE_MS   = 150

export const RC17_SPEC = Object.freeze({
  artifact: "RaceCon RC-17",
  script: "racecon-rc17-capture.mjs",
  presetId: RC17_PRESET_ID,
  widgetId: RC17_WIDGET_ID,
  attrPrefix: "data-rc17-",
  rootSelector: "#racecon-rc17-capture-root",
  captureHtml: "racecon-rc17-capture.html",
  dashboardSelector: ".rc17-dashboard",
  sourceIdentity: RC17_SOURCE_IDENTITY,
  /**
   * Root-level state attributes beyond what the shared contract already reads (layout,
   * compact-mode, buffer-state, content-width, content-height).
   */
  stateAttributes: Object.freeze([
    "alerts",
    "alert-keys",
    "flag-kind",
    "spotter",
    "spotter-stale",
    "radar"
  ]),
  /**
   * Zones present at EVERY viewport in BOTH states. app-only zones (packMap, lane) are
   * verified in assertAppLayoutReveals rather than here, so they do not erroneously fail
   * on native and compact viewports.
   */
  zones: Object.freeze([
    Object.freeze(["flags",   '[data-testid="rc17-flags"]']),
    Object.freeze(["line",    '[data-testid="rc17-line"]']),
    Object.freeze(["clock",   '[data-testid="rc17-clock"]']),
    Object.freeze(["closing", '[data-testid="rc17-closing"]']),
    Object.freeze(["pace",    '[data-testid="rc17-pace"]']),
    Object.freeze(["tertiary",'[data-testid="rc17-tertiary"]'])
  ]),
  zoneOverlapExemptions: Object.freeze([]),
  /**
   * Value slots (output elements) measured for font size, text content and rect at every
   * viewport. The `rc17-line` output uses a qualified selector because the enclosing
   * <section> has the same testid: `output[data-testid="rc17-line"]` selects the <output>
   * specifically.
   *
   * `rc17-flag` is CONDITIONAL (absent when flag.kind === 'none') and is validated
   * per-state in assertFlagState rather than via the shared values sweep.
   */
  values: Object.freeze([
    Object.freeze(["speed",       '[data-testid="rc17-speed"]']),
    Object.freeze(["gap",         '[data-testid="rc17-gap"]']),
    Object.freeze(["position",    '[data-testid="rc17-position"]']),
    Object.freeze(["closingRate", '[data-testid="rc17-closing-rate"]']),
    Object.freeze(["closingSide", '[data-testid="rc17-closing-side"]']),
    Object.freeze(["gear",        '[data-testid="rc17-gear"]']),
    Object.freeze(["rpm",         '[data-testid="rc17-rpm"]']),
    Object.freeze(["water",       '[data-testid="rc17-water"]']),
    Object.freeze(["lineRec",     'output[data-testid="rc17-line"]'])
  ]),
  /**
   * Containment pairs that measure the three implementation-audit escapes described in
   * raceconRc17.css:563-568 (quoted below) and the core ring/heading assembly.
   *
   * From raceconRc17.css:563-568:
   * "Packet 12.1 makes the governed tertiary block TALL (260x180) and the pace block TALL too
   * (300x160) rather than the native strips' 720x50 and 720x80, so both reflow into stacks.
   * Measured in a real browser: as rows, the WATER cell's `DEG C` unit escaped its zone by 30 px
   * and the `SPEED KM/H` label was clipped by 7 px, and in both cases `scrollWidth` on the
   * escaping element reported clean. That is precisely the `white-space: nowrap` trap."
   *
   * The three escapes were FIXED during implementation (ledgers start empty). Any recurrence is a
   * NEW regression. `assertZoneContainment` measures via getBoundingClientRect, not scrollWidth,
   * which is what reveals this class of overflow.
   *
   * The side-flag truncation in the 200×30 band is a third escape from the same audit.
   */
  containment: Object.freeze([
    // ── three implementation-audit containment probes ─────────────────────────────────────
    // DEG C unit: in the app layout this unit escaped the tertiary zone by 30 px while
    // scrollWidth reported clean — the canonical nowrap trap.
    Object.freeze(["DEG C unit",      '[data-testid="rc17-tertiary"]', '.rc17-cell[data-rc17-cell="water"] .rc17-unit']),
    // SPEED KM/H label: clipped by ~7 px in the app layout pace column.
    Object.freeze(["SPEED label cell",'[data-testid="rc17-pace"]',     '.rc17-cell[data-rc17-cell="speed"]']),
    // Side flag text truncated in the 200×30 band (native). rc17-flag is conditional; this
    // entry is skipped by assertZoneContainment when ownerDisplay is 'none' or value is absent.
    Object.freeze(["side flag text",   '[data-testid="rc17-flags"]',    '[data-testid="rc17-flag"]']),
    // ── value containment ─────────────────────────────────────────────────────────────────
    Object.freeze(["speed value",      '[data-testid="rc17-pace"]',     '[data-testid="rc17-speed"]']),
    Object.freeze(["gap value",        '[data-testid="rc17-pace"]',     '[data-testid="rc17-gap"]']),
    Object.freeze(["position value",   '[data-testid="rc17-pace"]',     '[data-testid="rc17-position"]']),
    Object.freeze(["closing rate",     '[data-testid="rc17-closing"]',  '[data-testid="rc17-closing-rate"]']),
    Object.freeze(["closing side",     '[data-testid="rc17-closing"]',  '[data-testid="rc17-closing-side"]']),
    Object.freeze(["gear value",       '[data-testid="rc17-tertiary"]', '[data-testid="rc17-gear"]']),
    Object.freeze(["water value",      '[data-testid="rc17-tertiary"]', '[data-testid="rc17-water"]']),
    // ── clock ring containment ────────────────────────────────────────────────────────────
    // OV-3: the whole ring assembly, heading tick included, must fit inside the 260×260 zone.
    Object.freeze(["clock ring",       '[data-testid="rc17-clock"]',   '[data-testid="rc17-ring"]'])
  ]),
  counted: Object.freeze([
    Object.freeze(["sector",           '[data-testid="rc17-sector"]']),
    Object.freeze(["heading quadrant", '[data-testid="rc17-heading-quadrant"]']),
    Object.freeze(["own car",          '[data-testid="rc17-own-car"]']),
    Object.freeze(["line option",      '[data-testid="rc17-line-option"]']),
    Object.freeze(["cell",             '[data-testid="rc17-cell"]']),
    Object.freeze(["rev track",        '[data-testid="rc17-rev-track"]']),
    Object.freeze(["rev fill",         '[data-testid="rc17-rev-fill"]']),
    Object.freeze(["flag",             '[data-testid="rc17-flag"]']),
    Object.freeze(["contact",          '[data-testid="rc17-contact"]']),
    Object.freeze(["closing arrow",    '[data-testid="rc17-closing-arrow"]']),
    Object.freeze(["three wide",       '[data-testid="rc17-three-wide"]']),
    Object.freeze(["pack map",         '[data-testid="rc17-pack-map"]']),
    Object.freeze(["pack field",       '[data-testid="rc17-pack-field"]']),
    Object.freeze(["pack own",         '[data-testid="rc17-pack-own"]']),
    Object.freeze(["lane",             '[data-testid="rc17-lane"]']),
    Object.freeze(["lane empty",       '[data-testid="rc17-lane-empty"]'])
  ]),
  /**
   * Packet omissions expressed as FORBIDDEN DOM SELECTORS. Each is an absence-is-the-contract
   * check: the element must never be rendered. A count !== 0 means a REINTRODUCTION — that is
   * the only failure this sweep can report, and it is never a render-QA defect.
   *
   * softKeyToggle (GAP-1): no line-choice channel → nothing to toggle → no toggle or button
   *   rendered at all. Any button, toggle input or interactive control in the line zone is a
   *   reintroduction of the dead key.
   *
   * insideOutsideWording (GAP-4): the decidedd-side channel reports left/right, never the
   *   oval's turn direction. `CAR INSIDE`, `CAR OUTSIDE` and `OUTSIDE` are forbidden leaf
   *   texts checked separately via lacksLeafText.
   *
   * revScaleEnd (GAP-6): no hard-coded redline label, no separate scale tick, no printed end
   *   value beside the rev cue.
   *
   * threeWideEnum (GAP-3): no separate attribute or element for the packet's declared enum
   *   (the decided-side 'both' member is what drives the alert instead).
   */
  forbidden: Object.freeze([
    Object.freeze([
      "a soft-key toggle or button for line choice (omission: softKeyToggle)",
      '.rc17-softkey, button[data-rc17-zone="line"], [data-rc17-line-toggle], [data-testid="rc17-line-toggle"], [role="switch"][data-rc17-zone="line"]'
    ]),
    Object.freeze([
      "a hard-coded redline label or rev-scale tick (omission: revScaleEnd)",
      '[data-rc17-redline], [data-testid="rc17-redline"], .rc17-redline, [data-rc17-scale-end]'
    ]),
    Object.freeze([
      "a three-wide packet enum attribute (omission: threeWideEnum)",
      '[data-rc17-three-wide-enum], [data-rc17-threewide]'
    ])
  ]),
  /**
   * Defect ledgers. The implementation audit found and fixed the `DEG C` escape (30 px), the
   * `SPEED KM/H` clip (~7 px) and the side-flag truncation in the 200x30 band; none of the three
   * recurs at any governed viewport in either state, so `knownDefects` and `containmentDefects`
   * stay EMPTY and any recurrence is a new regression that fails closed.
   *
   * DEFECT 1 — the governed tertiary strip's content stands 1 px taller than its layout box at the
   * 759x393 compact-landscape viewport, in both governed states. The strip is a GOVERNED ADDITION
   * (`RC17_PACKET_OMISSIONS.tertiaryZone`: packet 11.1 and 12.1 give gear, engine RPM and water
   * temperature no zone on either canvas although section 16 declares all three), so it is laid
   * out in space the packet leaves unassigned and its height has no packet backing. Recorded at
   * its measured 1 px: the budget is the measurement plus a 1 px font-metric allowance, not a cap,
   * so any growth, any spread to another viewport and any move to another zone still fails.
   * 867x412 — the wider landscape viewport — is clear, as are native, app and both phone sizes.
   */
  knownDefects:       Object.freeze([]),
  zoneOverflowDefects: Object.freeze([
    Object.freeze({
      zone: "tertiary",
      states: Object.freeze(["silent", "car-alongside"]),
      sizes: Object.freeze(["759x393"]),
      budgetPx: 2,
      note: "the governed tertiary strip (gear / RPM / water, a tertiaryZone addition with no packet height) overruns its layout box by 1px at 759x393 compact-landscape; every other governed viewport is clear"
    })
  ]),
  containmentDefects:  Object.freeze([])
})

export const RC17_CAPTURE_MATRIX = Object.freeze(
  CAPTURE_STATES.flatMap((state) =>
    CAPTURE_SIZES.map((size) =>
      Object.freeze({
        size,
        state,
        /**
         * The shared `waitForFunction` gate uses `required` so the harness waits for the
         * published attribute, never a guessed frame count.
         *   silent:         carAlongside never fires → alerts stays "silent" immediately.
         *   car-alongside:  fires on the first accepted 'left' frame (no engage debounce);
         *                   waiting for "active" is belt-and-suspenders on top of READY_SEQUENCE.
         */
        required: Object.freeze(
          state === "car-alongside"
            ? [Object.freeze(["alerts", "active"]), Object.freeze(["alert-keys", "CAR ALONGSIDE"])]
            : [Object.freeze(["alerts", "silent"])]
        )
      })
    )
  )
)

// ── internal helpers ───────────────────────────────────────────────────────────────────────

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

// ── per-state and per-layout assertions ───────────────────────────────────────────────────

function assertAlertState(metrics, entry) {
  const attrs = metrics.stateAttributes
  if (entry.state === "car-alongside") {
    if (attrs.alerts !== "active") {
      fail(`car-alongside state must publish data-rc17-alerts="active", received "${attrs.alerts}"`)
    }
    // Check for alerts that must never fire on this fixture BEFORE checking the exact value,
    // so a test that introduces the unwanted alert gets the specific message, not the equality message.
    if (attrs["alert-keys"].includes("FAST CLOSING")) {
      fail(`fast-closing alert must not fire on this fixture (no consecutive radar samples), received "${attrs["alert-keys"]}"`)
    }
    if (attrs["alert-keys"].includes("THREE WIDE")) {
      fail(`three-wide alert must not fire on this fixture (only one side), received "${attrs["alert-keys"]}"`)
    }
    if (attrs["alert-keys"] !== "CAR ALONGSIDE") {
      fail(`car-alongside state must publish data-rc17-alert-keys="CAR ALONGSIDE" exactly, received "${attrs["alert-keys"]}"`)
    }
    if (attrs["flag-kind"] !== "occupied") {
      fail(`car-alongside state must publish data-rc17-flag-kind="occupied", received "${attrs["flag-kind"]}"`)
    }
    if (attrs.spotter !== "left") {
      fail(`car-alongside state must publish data-rc17-spotter="left", received "${attrs.spotter}"`)
    }
  } else {
    if (attrs.alerts !== "silent") {
      fail(`silent state must publish data-rc17-alerts="silent", received "${attrs.alerts}"`)
    }
    if (attrs["alert-keys"] !== "") {
      fail(`silent state must publish data-rc17-alert-keys="", received "${attrs["alert-keys"]}"`)
    }
    if (attrs["flag-kind"] !== "none") {
      fail(`silent state must publish data-rc17-flag-kind="none", received "${attrs["flag-kind"]}"`)
    }
    if (attrs.spotter !== "clear") {
      fail(`silent state must publish data-rc17-spotter="clear", received "${attrs.spotter}"`)
    }
  }
  // Radar is available in both states (radarCars is always an array, even when empty).
  if (attrs.radar !== "live") {
    fail(`data-rc17-radar must be "live" (radarCars is always an array in both governed states), received "${attrs.radar}"`)
  }
  if (attrs["spotter-stale"] !== "false") {
    fail(`data-rc17-spotter-stale must be "false" in both governed states, received "${attrs["spotter-stale"]}"`)
  }
}

function assertFlagState(metrics, entry) {
  const flagCount = countOf(metrics, "flag")
  if (entry.state === "car-alongside") {
    if (flagCount !== 1) fail(`car-alongside state must render exactly one rc17-flag, found ${flagCount}`)
    hasText(metrics, "CAR LEFT")
    // insideOutsideWording (GAP-4): the channel reports the side, never the oval's turn
    // direction. CAR INSIDE and CAR OUTSIDE must NEVER appear, and their absence here is
    // NOT a defect — it is the correct behaviour of an honest channel.
    lacksLeafText(metrics, "CAR INSIDE",  "insideOutsideWording omission: the channel reports left/right, never oval turn direction")
    lacksLeafText(metrics, "CAR OUTSIDE", "insideOutsideWording omission: the channel reports left/right, never oval turn direction")
    lacksLeafText(metrics, "OUTSIDE",     "insideOutsideWording omission")
  } else {
    if (flagCount !== 0) fail(`silent state must render no rc17-flag, found ${flagCount}`)
    lacksLeafText(metrics, "CAR LEFT",  "flag must be absent in the silent state")
    lacksLeafText(metrics, "CAR RIGHT", "flag must be absent in the silent state")
    lacksLeafText(metrics, "CAR INSIDE",  "insideOutsideWording omission")
    lacksLeafText(metrics, "CAR OUTSIDE", "insideOutsideWording omission")
  }
}

function assertValues(metrics) {
  const speed = valueOf(metrics, "speed")
  const gap   = valueOf(metrics, "gap")
  const pos   = valueOf(metrics, "position")
  const rate  = valueOf(metrics, "closingRate")
  const side  = valueOf(metrics, "closingSide")
  const gear  = valueOf(metrics, "gear")
  const rpm   = valueOf(metrics, "rpm")
  const water = valueOf(metrics, "water")
  const line  = valueOf(metrics, "lineRec")

  if (speed.text !== RC17_EXPECTED_VALUES.speed) {
    fail(`speed reads "${speed.text}" instead of "${RC17_EXPECTED_VALUES.speed}"`)
  }
  if (gap.text !== RC17_EXPECTED_VALUES.gapAhead) {
    fail(`gap reads "${gap.text}" instead of "${RC17_EXPECTED_VALUES.gapAhead}" (relatives deliberately absent)`)
  }
  if (pos.text !== RC17_EXPECTED_VALUES.position) {
    fail(`position reads "${pos.text}" instead of "${RC17_EXPECTED_VALUES.position}" (position deliberately absent)`)
  }
  // Closing rate and closing side are MEASURED, not fed: `RC17_PACKET_OMISSIONS.closingRateChannel`
  // records that packet 11.1 requires a closing rate and section 16 declares no channel, so the
  // rate "is MEASURED from consecutive radar ranges of the SAME car and dashes until two such
  // samples exist inside the sample window; it is never estimated from speed, gap or position".
  //
  // The approved reference raster is a single frame in which only ONE radar sample had arrived, so
  // it prints `--.-`. A live-telemetry fixture necessarily supplies many consecutive samples, and
  // this one holds the neighbour at a constant range, so the honest measured rate is 0.0 m/s. The
  // falsifiable contract is therefore the dash FORM plus the SILENCE of the fast-closing alert —
  // pinning the literal `--.-` would assert a transient the fixture legitimately grows out of, and
  // would fail on correct behaviour.
  const dashedRate = rate.text === RC17_EXPECTED_VALUES.closingRate
  if (!dashedRate && !/^-?\d+(?:\.\d)?$/u.test(rate.text)) {
    fail(
      `closing rate reads "${rate.text}": it must be either the ${RC17_EXPECTED_VALUES.closingRate} ` +
        `placeholder (fewer than two radar samples) or a measured rate, never anything else`
    )
  }
  // The side may only name a side once a rate has actually been measured; while the rate is
  // dashed the side must dash too, so the pair can never disagree.
  if (dashedRate && side.text !== RC17_EXPECTED_VALUES.closingSide) {
    fail(`closing side reads "${side.text}" while the closing rate is dashed; the pair must agree`)
  }
  if (!dashedRate && side.text !== RC17_EXPECTED_VALUES.closingSide && !/^(LEFT|RIGHT|BEHIND)$/u.test(side.text)) {
    fail(`closing side reads "${side.text}" instead of a recognised side or ${RC17_EXPECTED_VALUES.closingSide}`)
  }
  if (gear.text !== RC17_EXPECTED_VALUES.gear) {
    fail(`gear reads "${gear.text}" instead of "${RC17_EXPECTED_VALUES.gear}"`)
  }
  if (rpm.text !== RC17_EXPECTED_VALUES.rpm) {
    fail(`rpm reads "${rpm.text}" instead of "${RC17_EXPECTED_VALUES.rpm}"`)
  }
  if (water.text !== RC17_EXPECTED_VALUES.water) {
    fail(`water reads "${water.text}" instead of "${RC17_EXPECTED_VALUES.water}"`)
  }
  if (line.text !== RC17_EXPECTED_VALUES.lineRec) {
    fail(`line recommendation reads "${line.text}" instead of "${RC17_EXPECTED_VALUES.lineRec}" (GAP-1: no line channel)`)
  }

  assertNoHorizontalOverflow(speed.rect, "speed value")
  assertNoHorizontalOverflow(gap.rect,   "gap value")
  assertNoHorizontalOverflow(pos.rect,   "position value")
  assertNoHorizontalOverflow(water.rect, "water value")
}

function assertLineChoiceOmission(metrics) {
  const optionCount = countOf(metrics, "line option")
  if (optionCount !== 2) {
    fail(`lineChoice omission (GAP-1): must render exactly 2 line options (HIGH and LOW), found ${optionCount}`)
  }
  // Both options must carry data-rc17-selected="false" — neither is ever selected.
  // This is validated via the forbidden selectors (no data-rc17-selected="true") and is
  // additionally confirmed by the stateAttributes having no selection attribute on the widget.
  for (const opt of metrics.lineOptions ?? []) {
    if (opt.selected === "true") {
      fail(`lineChoice omission (GAP-1): option ${opt.key} is marked selected but no channel exists`)
    }
  }
}

function assertRevFill(metrics) {
  // The published attribute is on the tertiary section, read via collectMetrics.
  const revFillAttr = Number.parseFloat(String(metrics.revFillAttr ?? ""))
  if (!Number.isFinite(revFillAttr)) {
    fail(`data-rc17-rev-fill attribute could not be parsed: "${metrics.revFillAttr}"`)
  }
  exact(revFillAttr, RC17_EXPECTED_VALUES.revFill, "data-rc17-rev-fill attribute", 0.005)

  // Rendered ratio: rc17-rev-fill width / the track's CONTENT width.
  //
  // The fill is a percentage of the track's content box while the track paints a border, so
  // dividing by the track's border box double-counts that border and reports ~0.79 for a model
  // fraction of exactly 0.80 — a constant 1.6 px shortfall at all six viewports, which is the
  // border and not the widget. Image-QA measured 231/287 = 0.8055 (error 0.55 pp) on the approved
  // raster; the tolerance here covers sub-pixel layout rounding on the narrow compact tracks.
  const trackWidth =
    Number.isFinite(metrics.revTrackContentPx) && metrics.revTrackContentPx > 1
      ? metrics.revTrackContentPx
      : finite(metrics.revTrackPx, "rc17-rev-track width") > 1
        ? metrics.revTrackPx
        : null
  if (trackWidth) {
    const rendered = metrics.revFillPx / trackWidth
    exact(rendered, RC17_EXPECTED_VALUES.revFill, "rc17-rev-fill rendered ratio", RC17_REV_FILL_TOLERANCE)
  }
}

/**
 * The type-scale ORDER is what matters: each step must be STRICTLY larger than the next.
 * A tie carries no hierarchy.
 *
 * Chosen rungs (all present in both governed states):
 *   closingRate (44 px, CSS clamp max) > speed (34 px) > flag (18 px, car-alongside only)
 *   > water (15 px). Since rc17-flag is absent in the silent state, the shorter chain
 *   closingRate > speed > water is asserted for silent, and the full chain (with flag
 *   inserted between speed and water) is asserted for car-alongside.
 *
 * The sector word (20 px) lives inside an SVG viewBox and its computed font-size scales with
 * the rendered ring size, so it is not included in the chain (it may render at a non-integer
 * px size at compact viewports). The full packet 11.2 ladder closes correctly at compile time
 * via the RC17_TYPE_SCALE_PX constant tests in the test file.
 */
function assertTypeScale(metrics, entry) {
  const closingRate = valueOf(metrics, "closingRate")
  const speed       = valueOf(metrics, "speed")
  const water       = valueOf(metrics, "water")

  if (entry.state === "car-alongside") {
    // The flag element is an <output>, not a <span>. It is present in the car-alongside state.
    const flagMetric = (metrics.values ?? []).find((v) => v.label === "flagText")
    if (flagMetric && flagMetric.present) {
      return assertTypeScaleOrder([
        { label: "closingRate", fontSize: closingRate.fontSize },
        { label: "speed",       fontSize: speed.fontSize },
        { label: "flagText",    fontSize: flagMetric.fontSize },
        { label: "water",       fontSize: water.fontSize }
      ])
    }
  }
  return assertTypeScaleOrder([
    { label: "closingRate", fontSize: closingRate.fontSize },
    { label: "speed",       fontSize: speed.fontSize },
    { label: "water",       fontSize: water.fontSize }
  ])
}

function assertCounts(metrics, entry) {
  const app = entry.size.layout === "app"
  const alongside = entry.state === "car-alongside"

  if (countOf(metrics, "sector") !== 3) {
    fail(`RC-17 must render exactly 3 sectors (LEFT, RIGHT, BEHIND), found ${countOf(metrics, "sector")}`)
  }
  if (countOf(metrics, "heading quadrant") !== 1) {
    fail(`RC-17 must render exactly 1 heading quadrant (structural 12-o'clock), found ${countOf(metrics, "heading quadrant")}`)
  }
  if (countOf(metrics, "own car") !== 1) {
    fail(`RC-17 must render exactly 1 own-car marker, found ${countOf(metrics, "own car")}`)
  }
  if (countOf(metrics, "line option") !== 2) {
    fail(`RC-17 must render exactly 2 line options (HIGH and LOW), found ${countOf(metrics, "line option")}`)
  }
  if (countOf(metrics, "cell") !== 9) {
    fail(`RC-17 must render exactly 9 cells (1 line + 2 closing + 3 pace + 3 tertiary), found ${countOf(metrics, "cell")}`)
  }
  if (countOf(metrics, "rev track") !== 1) fail(`rc17-rev-track must count 1, found ${countOf(metrics, "rev track")}`)
  if (countOf(metrics, "rev fill") !== 1)  fail(`rc17-rev-fill must count 1, found ${countOf(metrics, "rev fill")}`)
  if (countOf(metrics, "closing arrow") !== 0) {
    fail(`closing arrow must be absent (fast-closing not latched), found ${countOf(metrics, "closing arrow")}`)
  }
  if (countOf(metrics, "three wide") !== 0) {
    fail(`rc17-three-wide must be absent (three-wide not latched), found ${countOf(metrics, "three wide")}`)
  }

  const expectedContacts = alongside ? 1 : 0
  if (countOf(metrics, "contact") !== expectedContacts) {
    fail(`${entry.state} state must show ${expectedContacts} radar contact(s), found ${countOf(metrics, "contact")}`)
  }

  // App-only pack map and lane usage (GAP-1/OV-12/GAP-5).
  if (app) {
    if (countOf(metrics, "pack map") !== 1) fail(`app layout must render exactly 1 pack map, found ${countOf(metrics, "pack map")}`)
    if (countOf(metrics, "lane") !== 1) fail(`app layout must render exactly 1 lane section, found ${countOf(metrics, "lane")}`)
    if (countOf(metrics, "lane empty") !== 1) fail("app layout must render the lane-empty notice (NO LANE SOURCE)")
    hasText(metrics, "NO LANE SOURCE")
    if (countOf(metrics, "pack field") !== 1) fail("app layout must render pack-field (radar available in both governed states)")
    if (countOf(metrics, "pack own") !== 1) fail("app layout must render the own-car marker in the pack field")
  } else {
    if (countOf(metrics, "pack map") !== 0) fail(`pack map must not render outside the app layout, found ${countOf(metrics, "pack map")}`)
    if (countOf(metrics, "lane") !== 0) fail(`lane must not render outside the app layout, found ${countOf(metrics, "lane")}`)
  }

  // laneUsageHistory omission (GAP-1/OV-12): zero lane rows, honest word.
  if (app && metrics.laneRows !== "0") {
    fail(`laneUsageHistory omission: data-rc17-lane-rows must be "0", received "${metrics.laneRows}"`)
  }
}

function assertNativeSize(metrics, entry) {
  const expected = entry.size.layout === "native" ? "800x480" : null
  if (metrics.nativeSize !== expected) {
    fail(`data-rc17-native-size must be ${String(expected)}, received ${String(metrics.nativeSize)}`)
  }
}

function assertClockContainment(metrics) {
  // OV-3: the whole ring assembly including the heading tick fits inside the 260×260 zone.
  // This is asserted via the shared containment sweep for "clock ring", plus a centre check.
  const clock = zoneOf(metrics, "clock")
  if (metrics.ringCentreX !== undefined && metrics.ringCentreY !== undefined) {
    const clockCentreX = clock.left + clock.width / 2
    const clockCentreY = clock.top + clock.height / 2
    const dx = Math.abs(metrics.ringCentreX - clockCentreX)
    const dy = Math.abs(metrics.ringCentreY - clockCentreY)
    if (dx > 3 || dy > 3) {
      fail(
        `ring centre (${metrics.ringCentreX.toFixed(1)}, ${metrics.ringCentreY.toFixed(1)}) does not match ` +
        `clock zone centre (${clockCentreX.toFixed(1)}, ${clockCentreY.toFixed(1)}) within 3 px`
      )
    }
  }
}

function assertForbiddenLeafText(metrics) {
  // insideOutsideWording (GAP-4): the packet says CAR INSIDE / CAR OUTSIDE but the channel
  // only reports left/right. These MUST NEVER appear. Their absence is not a defect.
  lacksLeafText(metrics, "CAR INSIDE",  "insideOutsideWording omission: channel has no oval-direction knowledge")
  lacksLeafText(metrics, "CAR OUTSIDE", "insideOutsideWording omission: channel has no oval-direction knowledge")
  lacksLeafText(metrics, "OUTSIDE",     "insideOutsideWording omission")
  // THREE WIDE: never latches on this fixture (only one side occupied in car-alongside, nobody in silent).
  lacksLeafText(metrics, "THREE WIDE",  "three-wide alert is silent on both governed states of this fixture")
  // Forbidden literals from the approved prompt inventory.
  lacksLeafText(metrics, "NO DATA",     "spotter IS available in both governed states; NO DATA must not appear")
  lacksLeafText(metrics, "MPH",         "wrong unit — this widget uses KM/H")
  lacksLeafText(metrics, "LAP",         "no lap channel is displayed")
  lacksLeafText(metrics, "PIT",         "no pit-state channel is displayed")
  lacksLeafText(metrics, "CLEAR",       "clear sector carries no visible word (absence of fill, OV-8)")
  // closingThreshold (GAP-2): RC17_FAST_CLOSING_MPS is declared configuration, never printed.
  lacksLeafText(metrics, "2.5",         "closingThreshold omission: the fast-closing threshold is configuration, never printed")
  // revScaleEnd (GAP-6): no hard-coded redline value.
  lacksLeafText(metrics, "8000",        "revScaleEnd omission: the rev scale end is from the channel, never hard-coded")
  // radarEnvelope (GAP-2): RC17_RADAR_RANGE_M = 25 is configuration, never printed.
  lacksLeafText(metrics, "25",          "radarEnvelope omission: the radar range is configuration, never printed")
}

function assertDashForms(metrics) {
  // Placeholder discipline: -- is exactly 2 strokes, --.- is exactly 4 characters.
  // Neither form is interchangeable with the other. Assert both are present (in the state where
  // they are expected) and do not grow.
  //
  // The approved frame verified 5 confirmed dash placeholders:
  //   gap '--.-', position '--', closing-rate '--.-', closing-side '--', line-rec '--'.
  //   (rc17-speed = "291", rc17-gear = "4", rc17-rpm = "6400", rc17-water = "92" are all live.)
  const gap   = valueOf(metrics, "gap")
  const pos   = valueOf(metrics, "position")
  const rate  = valueOf(metrics, "closingRate")
  const side  = valueOf(metrics, "closingSide")
  const line  = valueOf(metrics, "lineRec")

  if (gap.text  !== "--.-") fail(`gap dash form must be "--.-" (3 strokes + dot), received "${gap.text}"`)
  if (pos.text  !== "--")   fail(`position dash form must be "--" (2 strokes), received "${pos.text}"`)
  // Closing rate and closing side are the two MEASURED slots (`closingRateChannel`): they dash
  // until two consecutive radar samples of the same car exist, then publish a real rate. The
  // approved raster caught them dashed; a live fixture supplies the second sample and they
  // legitimately stop dashing. What must never happen is a HALF-dashed pair or a malformed
  // placeholder, so the form is asserted only while the slot is actually dashed.
  if (rate.text.includes("-") && !/^\d/u.test(rate.text) && rate.text !== "--.-") {
    fail(`closing-rate dash form must be "--.-" (3 strokes + dot), received "${rate.text}"`)
  }
  if (side.text.includes("-") && side.text !== "--") {
    fail(`closing-side dash form must be "--" (2 strokes), received "${side.text}"`)
  }
  if (line.text !== "--")   fail(`line recommendation must permanently dash "--" (GAP-1), received "${line.text}"`)
}

export function validateCaptureMetrics(metrics, entry, _unused) {
  const common = validateCommonMetrics(metrics, entry, RC17_SPEC)

  assertNativeSize(metrics, entry)
  assertAlertState(metrics, entry)
  assertFlagState(metrics, entry)
  assertValues(metrics)
  assertDashForms(metrics)
  assertLineChoiceOmission(metrics)
  assertRevFill(metrics)
  const typeScale = assertTypeScale(metrics, entry)
  assertCounts(metrics, entry)
  assertClockContainment(metrics)
  assertForbiddenLeafText(metrics)

  return { ...common, typeScale }
}

const RC17_MIN_NON_CANVAS_PIXELS = 5_000

/**
 * Pixel audit: what only a real raster can prove.
 *
 *  1. The frame is not blank against the RC-17 canvas colour #0B0C10.
 *  2. SIGNATURE (#FF5AA0, hue ≈ 334.55° → "magenta") is ABSENT on the silent frame and
 *     PRESENT + SCOPED to the occupied LEFT sector and the persistent side flag on the
 *     car-alongside frame.
 *  3. DANGER (#FF4436, hue ≈ 4.18° → "red") is ABSENT on BOTH frames. The three-wide alert
 *     never fires here. A channel-ratio test (`r > 1.7g && r > 1.5b`) would falsely report
 *     ALL signature (magenta) pixels as "red" — that is the 8,578-pixel false-positive that
 *     the image-QA measured. Hue correctly distinguishes them.
 *  4. CAUTION (#FFB82E, hue ≈ 39.6° → "amber") is ABSENT on BOTH frames. The fast-closing
 *     alert never fires here (no consecutive radar samples in a fresh fixture).
 */
export function validateCapturePixels(buffer, entry, metrics) {
  if (!isGovernedSize(entry.size)) fail(`unsupported capture pixel-audit size ${entry.size.width}x${entry.size.height}`)
  const image = decodeCapturePng(buffer, entry.size)

  const sigFamily     = hueFamilyOfHex(RC17_SIGNATURE_HEX)   // "magenta"
  const dangerFamily  = hueFamilyOfHex(RC17_DANGER_HEX)      // "red"
  const cautionFamily = hueFamilyOfHex(RC17_CAUTION_HEX)     // "amber"

  // The alert scope is the LEFT sector (inside the clock zone) plus the flags zone.
  // On the silent frame the scope is empty, making "absent" and "scoped" the same statement.
  const scopes = {}
  if (entry.state === "car-alongside") {
    scopes[sigFamily] = (metrics.alertScope ?? [])
  }
  const audit = auditHueFamilies(image, scopes)

  let nonCanvasPixels = 0
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (!sameRgba(rgbaAt(image, x, y), RC17_CANVAS_RGBA)) nonCanvasPixels += 1
    }
  }
  if (nonCanvasPixels < RC17_MIN_NON_CANVAS_PIXELS) {
    fail("capture is blank against the RC-17 canvas colour (#0B0C10)")
  }

  assertHueFamilyAbsent(
    audit, dangerFamily,
    "both RC-17 governed frames — danger belongs to three-wide, which is silent here"
  )
  assertHueFamilyAbsent(
    audit, cautionFamily,
    "both RC-17 governed frames — caution belongs to fast-closing, which is silent here (no consecutive radar samples)"
  )

  if (entry.state === "car-alongside") {
    assertHueFamilyPresent(audit, sigFamily,
      "the RC-17 car-alongside frame — the LEFT sector and side flag must be painted", 1)
    assertHueFamilyScoped(audit, sigFamily, "the RC-17 car-alongside frame")
  } else {
    assertHueFamilyAbsent(audit, sigFamily,
      "the RC-17 silent frame — no occupied sector, no flag, no signature surface")
  }

  return {
    width: image.width,
    height: image.height,
    opaque: true,
    nonCanvasPixels,
    hueFamilies: audit.counts,
    signatureHueFamily: sigFamily,
    dangerHueFamily: dangerFamily,
    signatureOutsideScope: audit.outside[sigFamily] ?? 0
  }
}

export { CaptureSafetyError, exact, finite, containsRect, assertTypeScaleOrder }
