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
 * RC-15 "On The Nose — Brake & Chassis Balance" owns only what its DOM contract, zones, channels,
 * alert families and documented omissions make different from the rest of the RaceCon portfolio.
 * Everything generic lives in `racecon-capture-shared.mjs`, which re-exports RC-01's disk-safety
 * primitives unchanged.
 *
 * Approved reference: attempt-001. `rc15-governance-chain-v1.json` records
 * `"externalAttempt": 1, "verdict": "APPROVED"` and the re-adjudication note "attempt-001 is
 * therefore re-adjudicated from REJECTED to APPROVED and image-qa-v2.md supersedes
 * image-qa-v1.md" — attempts 002…006 exist but none of them is the approved frame.
 */

export const RC15_PRESET_ID = "racecon_rc15_dash"
export const RC15_WIDGET_ID = "raceconRc15Dash"
export const RC15_SOURCE_IDENTITY = "iracing:session:41:connection:3"

/** Two governed scenarios: the approved silent frame and the front-axle brake-overheat alert. */
export const CAPTURE_STATES = Object.freeze(["silent", "brake-hot"])

export const RC15_CORNER_COLUMNS = 6
export const RC15_BRAKE_BAR_CELLS = 10
export const RC15_PAN_COUNT = 2
export const RC15_TOTAL_PAN_CELLS = RC15_BRAKE_BAR_CELLS * RC15_PAN_COUNT

/**
 * Colour tokens as SHIPPED, which is not the same thing as the packet's tokens.
 *
 * Normative override 4 (`RC15_PACKET_OMISSIONS.dangerSignatureSeparability`) records that the
 * packet's danger `#FF3B2E` sits ΔE76 12.95 and 7.23° of hue from signature `#FF5E3A`, so routine
 * brake heat read as the alarm. Danger was retuned to `#FF1F5B` (ΔE76 32.9, 27.0° of hue). That
 * retune is an UNRATIFIED decision, so this harness asserts what shipped rather than what the
 * packet said, and separately proves the packet token never reappears.
 *
 * The retune is what makes a hue-family proof possible at all:
 *   signature #FF5E3A → hue ≈ 10.96° → "red"      (brake heat; present on EVERY frame)
 *   danger    #FF1F5B → hue ≈ 343.93° → "magenta" (alert only; zero pixels while silent)
 *   caution   #FF9E2C → hue ≈ 32.4°  → "amber"    (balance-extreme / bias-unavailable only)
 * The packet's danger #FF3B2E would have landed in the SAME "red" family as signature, and no
 * hue test could then have told the alarm apart from routine brake heat.
 */
export const RC15_SIGNATURE_HEX = "#ff5e3a"        // brake heat — always painted
export const RC15_DANGER_HEX = "#ff1f5b"           // shipped alarm — magenta family
export const RC15_CAUTION_HEX = "#ff9e2c"          // balance-extreme / bias-unavailable only
export const RC15_PACKET_DANGER_HEX = "#ff3b2e"    // packet token; must never ship
export const RC15_INFO_HEX = "#3fb0d2"             // COMPUTED chip, current-corner underline
export const RC15_CANVAS_RGBA = Object.freeze([15, 12, 12, 255])   // bg #0F0C0C

/**
 * Packet 11.2 type ladder, implemented at override 3's cap heights. The harness asserts the ORDER
 * strictly (a tie is a failure); the pixel sizes are recorded here so a silent re-spacing is
 * visible in review.
 */
export const RC15_TYPE_SCALE_PX = Object.freeze({
  bias: 72,
  balanceIndex: 48,
  brakeTemp: 44,
  cornerStrip: 30
})

/**
 * Reference channel values. The axle numeral is the MEAN of its two measured corners, so
 * (430 + 426) / 2 = 428 °C front and (393 + 389) / 2 = 391 °C rear.
 */
export const RC15_EXPECTED_VALUES = Object.freeze({
  frontPan: "428",
  rearPan: "391",
  bias: "56.4",
  steering: "38",
  latG: "1.32",
  balanceWord: "UNDER"
})

/** The front axle in the brake-hot scenario: (542 + 534) / 2 = 538 °C. */
export const RC15_HOT_FRONT_C = 538
export const RC15_EXPECTED_HOT_FRONT = "538"

/**
 * Normative override 8 (`heatBarSegmentCounts`): the approved image lit 9 of 11 front cells and
 * 6 of 9 rear against printed 428 and 391 °C, and six attempts disagreed with each other. The
 * shipped rule is ten equal cells per pan lit `min(10, floor(t / 50))`, so the bar and the numeral
 * can never contradict one channel.
 *
 *   428 °C → floor(428 / 50) =  8 lit
 *   391 °C → floor(391 / 50) =  7 lit
 *   538 °C → min(10, 10)     = 10 lit (pegged; the bar full-scale IS the 500 °C hot limit, so a
 *                                      pegged bar and a fired alert are by construction the same
 *                                      event — `heatBarScaleUnbacked`)
 */
export const RC15_LIT_CELLS_SILENT_FRONT = 8
export const RC15_LIT_CELLS_SILENT_REAR = 7
export const RC15_LIT_CELLS_HOT_FRONT = 10

/** Beam rule from the approved brief: "beam tilt = index x 12 deg full travel". */
export const RC15_BEAM_FULL_TRAVEL_DEG = 12
export const RC15_BEAM_TOLERANCE_DEG = 0.05

export const RC15_SPEC = Object.freeze({
  artifact: "RaceCon RC-15",
  script: "racecon-rc15-capture.mjs",
  presetId: RC15_PRESET_ID,
  widgetId: RC15_WIDGET_ID,
  attrPrefix: "data-rc15-",
  rootSelector: "#racecon-rc15-capture-root",
  captureHtml: "racecon-rc15-capture.html",
  dashboardSelector: ".rc15-dashboard",
  sourceIdentity: RC15_SOURCE_IDENTITY,
  /**
   * RC-15 publishes no `alert-keys`; its `alerts` attribute IS the key list, either the literal
   * "silent" or a fixed-order space-joined subset of
   * "brake-hot-front brake-hot-rear balance-extreme bias-unavailable".
   */
  stateAttributes: Object.freeze([
    "alerts",
    "balance",
    "beam-deg",
    "beam-pegged",
    "scored-corners"
  ]),
  /**
   * The four zones present in every governed viewport. The per-corner strip is native + compact
   * only and the corner map and brake-temp trend are app only, so those three are verified in
   * `assertLayoutOnlyReveals` instead of the shared always-present zone sweep.
   */
  zones: Object.freeze([
    Object.freeze(["beam",     '[data-testid="rc15-panel-beam"]']),
    Object.freeze(["frontPan", '[data-testid="rc15-panel-front-pan"]']),
    Object.freeze(["rearPan",  '[data-testid="rc15-panel-rear-pan"]']),
    Object.freeze(["bias",     '[data-testid="rc15-panel-bias"]'])
  ]),
  zoneOverlapExemptions: Object.freeze([]),
  values: Object.freeze([
    Object.freeze(["bias",         '[data-testid="rc15-bias-value"]']),
    Object.freeze(["balanceIndex", '[data-testid="rc15-balance-index"]']),
    Object.freeze(["brakeTemp",    '[data-testid="rc15-pan-value-front"]']),
    Object.freeze(["rearTemp",     '[data-testid="rc15-pan-value-rear"]']),
    Object.freeze(["cornerIndex",  '[data-testid="rc15-corner-index"]']),
    Object.freeze(["balanceWord",  '[data-testid="rc15-balance-word"]']),
    Object.freeze(["steering",     '[data-testid="rc15-steering"]']),
    Object.freeze(["latG",         '[data-testid="rc15-latg"]'])
  ]),
  containment: Object.freeze([
    Object.freeze(["balance index", '[data-testid="rc15-panel-beam"]',      '[data-testid="rc15-balance-index"]']),
    Object.freeze(["balance word",  '[data-testid="rc15-panel-beam"]',      '[data-testid="rc15-balance-word"]']),
    Object.freeze(["computed chip", '[data-testid="rc15-panel-beam"]',      '[data-testid="rc15-computed-chip"]']),
    Object.freeze(["beam bar",      '[data-testid="rc15-beam-stage"]',      '[data-testid="rc15-beam-bar"]']),
    Object.freeze(["bias value",    '[data-testid="rc15-panel-bias"]',      '[data-testid="rc15-bias-value"]']),
    Object.freeze(["bias hint",     '[data-testid="rc15-panel-bias"]',      '[data-testid="rc15-bias-hint"]']),
    Object.freeze(["front numeral", '[data-testid="rc15-panel-front-pan"]', '[data-testid="rc15-pan-value-front"]']),
    Object.freeze(["front bar",     '[data-testid="rc15-panel-front-pan"]', '[data-testid="rc15-pan-bar-front"]']),
    Object.freeze(["rear numeral",  '[data-testid="rc15-panel-rear-pan"]',  '[data-testid="rc15-pan-value-rear"]']),
    Object.freeze(["rear bar",      '[data-testid="rc15-panel-rear-pan"]',  '[data-testid="rc15-pan-bar-rear"]']),
    Object.freeze(["corner index",  '[data-testid="rc15-corner"]',          '[data-testid="rc15-corner-index"]']),
    Object.freeze(["corner pair",   '[data-testid="rc15-corner"]',          '[data-testid="rc15-corner-pair"]']),
    Object.freeze(["corner marker", '[data-testid="rc15-corner-track"]',    '[data-testid="rc15-corner-datum"]'])
  ]),
  counted: Object.freeze([
    Object.freeze(["corner",        '[data-testid="rc15-corner"]']),
    Object.freeze(["pan cell",      '[data-testid="rc15-pan-cell"]']),
    Object.freeze(["lit cell",      '[data-rc15-cell-lit="true"]']),
    Object.freeze(["front lit",     '[data-testid="rc15-panel-front-pan"] [data-rc15-cell-lit="true"]']),
    Object.freeze(["rear lit",      '[data-testid="rc15-panel-rear-pan"] [data-rc15-cell-lit="true"]']),
    Object.freeze(["front alert",   '[data-testid="rc15-pan-alert-front"]']),
    Object.freeze(["rear alert",    '[data-testid="rc15-pan-alert-rear"]']),
    Object.freeze(["corner marker", '[data-testid="rc15-corner-marker"]']),
    Object.freeze(["strip",         '[data-testid="rc15-panel-strip"]']),
    Object.freeze(["corner map",    '[data-testid="rc15-panel-corner-map"]']),
    Object.freeze(["brake trend",   '[data-testid="rc15-panel-brake-trend"]']),
    Object.freeze(["context line",  '[data-testid="rc15-context"]']),
    Object.freeze(["map notice",    '[data-testid="rc15-corner-map-notice"]']),
    Object.freeze(["trend notice",  '[data-testid="rc15-trend-notice"]']),
    Object.freeze(["strip notice",  '[data-testid="rc15-strip-notice"]'])
  ]),
  /**
   * Packet omissions expressed as forbidden DOM selectors. These are ABSENCE-IS-THE-CONTRACT
   * checks: a documented omission renders nothing, so the only failure this sweep can report is a
   * REINTRODUCTION. None of them may ever be reported as a render-QA defect.
   *
   * revCue — `RC15_PACKET_OMISSIONS.revCue`: packet 11.4 asks for a small over-rev edge segment
   *   but section 16 defines no RPM or rev-limit channel, so nothing is drawn: no LED, no bar, no
   *   numeral. RPM has no entry in the RC-15 stale map.
   *
   * tyreGearSpeedZones — tertiary tyre temperature, gear and speed have section 16 channels but no
   *   zone in 11.1 or 12.1: none of the three is read, drawn or dashed anywhere, and the negative
   *   prompt separately forbids a tyre thermal mandala.
   *
   * deltaToBestZone — packet 10 makes delta-to-best secondary and 16 gives it a channel, but
   *   neither 11.1 nor 12.1 defines a zone: it is omitted outright rather than squeezed in.
   *
   * cornerStripSoftKey — packet 11.5 offers a soft key switching the strip between brake temps and
   *   balance index; the strip carries both rows at once, so there is no control and no mode state.
   *
   * focus/selector surfaces are RC-16's problem, not RC-15's; nothing here is layout-conditional,
   * so every selector must count zero at every viewport in every state.
   */
  forbidden: Object.freeze([
    Object.freeze([
      "a shift-LED, rev-arc or RPM surface (omission: revCue)",
      '.rc15-led, .rc15-shift, .rc15-rev, [data-rc15-zone="shift"], [data-rc15-zone="rev"], [data-channel="rpm"]'
    ]),
    Object.freeze([
      "a tyre, gear or speed readout (omission: tyreGearSpeedZones)",
      '.rc15-tyre, .rc15-tire, .rc15-gear, .rc15-speed, [data-rc15-zone="tyre"], [data-rc15-zone="gear"], [data-rc15-zone="speed"], [data-testid^="rc15-tyre"], [data-testid^="rc15-gear"], [data-testid^="rc15-speed"]'
    ]),
    Object.freeze([
      "a delta-to-best readout (omission: deltaToBestZone)",
      '.rc15-delta, [data-rc15-zone="delta"], [data-testid^="rc15-delta"]'
    ]),
    Object.freeze([
      "a corner-strip soft key (omission: cornerStripSoftKey)",
      '.rc15-softkey, [data-rc15-strip-mode], [data-testid^="rc15-softkey"], [data-testid="rc15-strip-toggle"]'
    ])
  ]),
  /**
   * The defect ledgers are EMPTY, so every measured overflow now fails closed.
   *
   * `knownDefects` used to record the strip column headers overflowing their 70 px label column at
   * the 1024x600 app canvas in both governed states — `BRAKE F / R` by 28 px and `BALANCE` by 2 px.
   * `.rc15-strip-labels` sat at `flex: 0 0 12%` of `.rc15-strip-rows`, and the app reflow makes
   * that row NARROWER (581.63 px against the native 753.22 px) while growing the shared 1.6cqw
   * label step from 12.8 px to 16.38 px, so a header needing 98.27 px was given 69.78 px. The
   * column is now sized from its own max-content (`flex: 0 0 auto`), which fits every header at
   * every canvas by construction. Deleting the ledger is the regression guard: any recurrence, at
   * any viewport, in any state, on any leaf, is unrecorded and fails.
   */
  knownDefects: Object.freeze([]),
  /**
   * `zoneOverflowDefects` used to record the bias block standing 7 px taller than its 108 px app
   * zone at 1024x600 in both governed states.
   *
   * `RC15_PACKET_OMISSIONS.biasBlockAppReflow` records the original — "packet 12.1 grows the bias
   * zone 1.058x while 11.2 grows the type ladder 1.28x, so a three-row bias stack measurably
   * overflows 110 px at 1024x600" — and the first mitigation reflowed the LAST ADJ hint beside the
   * numeral instead of beneath it. That reduced the overrun without clearing it, because the block
   * is CENTRED in its zone: the governing inequality is
   * `clientHeight >= 2 * content.scrollHeight - content.height`, which measured 2 * 107 - 92.02 =
   * 121.98 px against a 108 px content box. Override 2, which already grew the undersized NATIVE
   * bias zone, is now extended to the app canvas as well: 12.1's (280, 252, 464, 110) becomes
   * (280, 242, 464, 130) using the bare canvas the packet leaves between the beam floor and the
   * corner map, giving a 128 px content box and 6.02 px of measured headroom.
   *
   * NOT recorded here, because they are the design rather than a defect: every RC-15 hero numeral
   * carries `line-height: 0.75` under normative override 3
   * (`RC15_PACKET_OMISSIONS.typeScaleAsCapHeights` — "the 11.2 sizes are implemented as cap
   * heights at 0.75 of the stated em, because as line boxes the beam zone would need 154.6 px
   * inside 150 px"). A sub-1 line-height makes `scrollHeight` structurally exceed `clientHeight`
   * on the numeral itself at every viewport, and makes the font's natural line box taller than the
   * painted glyphs. The shared leaf sweep is HORIZONTAL only for exactly this reason, and the
   * numerals are therefore not reported: their ink fits, only their line box does not.
   */
  zoneOverflowDefects: Object.freeze([]),
  containmentDefects: Object.freeze([])
})

export const RC15_CAPTURE_MATRIX = Object.freeze(
  CAPTURE_STATES.flatMap((state) =>
    CAPTURE_SIZES.map((size) =>
      Object.freeze({
        size,
        state,
        // The brake-hot alert latches after RC15_BRAKE_HOT_ENGAGE_MS (2 000 ms); the harness waits
        // for the published attribute rather than a guessed frame count. Only the FRONT axle is
        // driven hot, so the whole grammar is the single token.
        required: Object.freeze(
          state === "brake-hot"
            ? [Object.freeze(["alerts", "brake-hot-front"])]
            : [Object.freeze(["alerts", "silent"])]
        )
      })
    )
  )
)

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

function assertBalance(metrics) {
  const word = valueOf(metrics, "balanceWord")
  if (word.text !== RC15_EXPECTED_VALUES.balanceWord) {
    fail(`balance word reads "${word.text}" instead of "${RC15_EXPECTED_VALUES.balanceWord}"`)
  }
  if (metrics.stateAttributes.balance !== RC15_EXPECTED_VALUES.balanceWord) {
    fail(`data-rc15-balance must be ${RC15_EXPECTED_VALUES.balanceWord}, received "${metrics.stateAttributes.balance}"`)
  }
  const index = valueOf(metrics, "balanceIndex")
  const parsed = Number.parseFloat(index.text)
  if (!Number.isFinite(parsed)) fail(`balance index reads "${index.text}", which is not a number`)
  if (parsed >= 0) fail(`the reference frame tends UNDER, so the balance index must be negative, received ${parsed}`)
  if (parsed < -1 || parsed > 1) fail(`balance index ${parsed} is outside the published [-1, 1] range`)

  // The approved brief's beam rule: "beam tilt = index x 12 deg full travel; -0.34 -> 4.08 deg
  // front-down". Cross-checking the two PUBLISHED values against each other is what catches a
  // beam that drifts away from the numeral it is supposed to visualise.
  const beamDeg = Number.parseFloat(String(metrics.stateAttributes["beam-deg"]))
  if (!Number.isFinite(beamDeg)) fail(`data-rc15-beam-deg reads "${metrics.stateAttributes["beam-deg"]}"`)
  const expectedMagnitude = Math.abs(parsed) * RC15_BEAM_FULL_TRAVEL_DEG
  if (Math.abs(Math.abs(beamDeg) - expectedMagnitude) > RC15_BEAM_TOLERANCE_DEG) {
    fail(
      `the beam is laid out at ${beamDeg}deg but the balance index ${parsed} demands ` +
        `${expectedMagnitude.toFixed(2)}deg of travel (index x ${RC15_BEAM_FULL_TRAVEL_DEG})`
    )
  }
  if (Math.abs(beamDeg) > RC15_BEAM_FULL_TRAVEL_DEG + RC15_BEAM_TOLERANCE_DEG) {
    fail(`the beam exceeds its ${RC15_BEAM_FULL_TRAVEL_DEG}deg full travel at ${beamDeg}deg`)
  }
  // The balance-extreme alert is armed and silent in both governed states, so the beam is never
  // pegged and the beam word is routine accessibility chrome rather than an alert surface.
  if (metrics.stateAttributes["beam-pegged"] !== "false") {
    fail(`the beam must not be pegged while balance-extreme is silent, received "${metrics.stateAttributes["beam-pegged"]}"`)
  }
  return { index: parsed, beamDeg }
}

function assertPans(metrics, entry) {
  const hot = entry.state === "brake-hot"
  const front = valueOf(metrics, "brakeTemp")
  const rear = valueOf(metrics, "rearTemp")
  const expectedFront = hot ? RC15_EXPECTED_HOT_FRONT : RC15_EXPECTED_VALUES.frontPan
  if (front.text !== expectedFront) {
    fail(`front axle reads "${front.text}" instead of "${expectedFront}"`)
  }
  if (rear.text !== RC15_EXPECTED_VALUES.rearPan) {
    fail(`rear axle reads "${rear.text}" instead of "${RC15_EXPECTED_VALUES.rearPan}"`)
  }
  assertNoHorizontalOverflow(front.rect, "front axle numeral")
  assertNoHorizontalOverflow(rear.rect, "rear axle numeral")

  // Normative override 8: exactly ten equal cells in BOTH pans, at every viewport.
  const cells = countOf(metrics, "pan cell")
  if (cells !== RC15_TOTAL_PAN_CELLS) {
    fail(`RC-15 must render ${RC15_TOTAL_PAN_CELLS} heat cells (${RC15_BRAKE_BAR_CELLS} per pan), found ${cells}`)
  }
  const expectedFrontLit = hot ? RC15_LIT_CELLS_HOT_FRONT : RC15_LIT_CELLS_SILENT_FRONT
  const frontLit = countOf(metrics, "front lit")
  const rearLit = countOf(metrics, "rear lit")
  if (frontLit !== expectedFrontLit) {
    fail(
      `the front pan lights ${frontLit} cells, but min(10, floor(${hot ? RC15_HOT_FRONT_C : 428} / 50)) = ` +
        `${expectedFrontLit} — the bar and the numeral contradict one channel (override 8)`
    )
  }
  if (rearLit !== RC15_LIT_CELLS_SILENT_REAR) {
    fail(
      `the rear pan lights ${rearLit} cells, but min(10, floor(391 / 50)) = ${RC15_LIT_CELLS_SILENT_REAR} ` +
        `— the bar and the numeral contradict one channel (override 8)`
    )
  }
  if (countOf(metrics, "lit cell") !== frontLit + rearLit) {
    fail("the lit-cell total does not equal the sum of the two pans")
  }
  // The pans are symmetric about the canvas centre on the native canvas (override 1 moved them
  // outward to x=60 and x=620 with equal 60 px outer margins, so the widths must match exactly).
  const frontZone = zoneOf(metrics, "frontPan")
  const rearZone = zoneOf(metrics, "rearPan")
  if (Math.abs(frontZone.width - rearZone.width) > 0.5 || Math.abs(frontZone.height - rearZone.height) > 0.5) {
    fail(
      `the pans are not symmetric: front ${frontZone.width.toFixed(2)}x${frontZone.height.toFixed(2)}, ` +
        `rear ${rearZone.width.toFixed(2)}x${rearZone.height.toFixed(2)}`
    )
  }
  return { frontLit, rearLit }
}

function assertBrakeHotAlert(metrics, entry) {
  const alerts = String(metrics.stateAttributes.alerts ?? "")
  const frontBadges = countOf(metrics, "front alert")
  const rearBadges = countOf(metrics, "rear alert")
  if (entry.state === "brake-hot") {
    if (!alerts.split(" ").includes("brake-hot-front")) {
      fail(`the brake-hot state must publish brake-hot-front in data-rc15-alerts, received "${alerts}"`)
    }
    if (alerts.includes("brake-hot-rear")) {
      fail(`only the front axle is driven hot; data-rc15-alerts must not carry brake-hot-rear, received "${alerts}"`)
    }
    if (frontBadges !== 1) fail(`the brake-hot state must render exactly one front BRAKE HOT badge, found ${frontBadges}`)
    if (rearBadges !== 0) fail(`the rear axle is not hot, so no rear BRAKE HOT badge may render, found ${rearBadges}`)
    hasText(metrics, "BRAKE HOT")
  } else {
    if (alerts !== "silent") {
      fail(`the silent state must publish data-rc15-alerts="silent", received "${alerts}"`)
    }
    if (frontBadges !== 0 || rearBadges !== 0) {
      fail(`the silent state must render no BRAKE HOT badge, found ${frontBadges} front and ${rearBadges} rear`)
    }
  }
  // balance-extreme and bias-unavailable are armed and silent in BOTH governed states.
  if (alerts.includes("balance-extreme")) fail("this fixture must not latch the balance-extreme alert")
  if (alerts.includes("bias-unavailable")) fail("this fixture must not latch the bias-unavailable alert")
}

function assertBiasBlock(metrics) {
  const bias = valueOf(metrics, "bias")
  if (bias.text !== RC15_EXPECTED_VALUES.bias) {
    fail(`brake bias reads "${bias.text}" instead of "${RC15_EXPECTED_VALUES.bias}"`)
  }
  assertNoHorizontalOverflow(bias.rect, "bias numeral")
  hasText(metrics, "% FRONT")
  // The bias-unavailable alert is silent, so the readout is a number and never a dash.
  if (bias.text.includes("-")) fail(`bias reads "${bias.text}"; a dashed bias means bias-unavailable has fired`)
}

function assertContextLine(metrics, entry) {
  const steering = valueOf(metrics, "steering")
  const latG = valueOf(metrics, "latG")
  if (steering.text !== RC15_EXPECTED_VALUES.steering) {
    fail(`steering reads "${steering.text}" instead of "${RC15_EXPECTED_VALUES.steering}"`)
  }
  if (latG.text !== RC15_EXPECTED_VALUES.latG) {
    fail(`lateral G reads "${latG.text}" instead of "${RC15_EXPECTED_VALUES.latG}"`)
  }
  // `steerLatGAtApp`: packet 12.1 drops the per-corner strip and hosts these two nowhere else, so
  // they move onto the corner-map header — which means the app canvas renders the line TWICE.
  const lines = countOf(metrics, "context line")
  const expected = entry.size.layout === "app" ? 2 : 1
  if (lines !== expected) {
    fail(`the ${entry.size.layout} layout must render ${expected} context line(s), found ${lines}`)
  }
}

/**
 * The per-corner strip is native + compact; the corner map and brake-temp trend are app only.
 * Each app-only panel carries an honest empty state rather than a fabricated one, and the harness
 * asserts the empty state as the contract:
 *
 *   `cornerMapGeometry` — section 16 defines no track geometry, position or lap-distance channel,
 *      so the app panel renders the observed corner sequence and states NO TRACK MAP SOURCE. The
 *      notice is therefore REQUIRED at 1024x600 and FORBIDDEN everywhere else, and its absence
 *      would mean a spatial claim had been invented.
 *
 *   `brakeTrendLapAxis` — section 16 defines no lap channel, so the trend runs over the
 *      acquisition window with dashed ticks and no lap numeral. The panel must therefore either
 *      plot measured points or state NO BRAKE TREND SOURCE; never neither, never both.
 */
function assertLayoutOnlyReveals(metrics, entry) {
  const app = entry.size.layout === "app"
  const strip = countOf(metrics, "strip")
  const map = countOf(metrics, "corner map")
  const trend = countOf(metrics, "brake trend")
  if (app) {
    if (strip !== 0) fail(`the app layout replaces the per-corner strip with the corner map, found ${strip} strip(s)`)
    if (map !== 1) fail(`the app layout must render exactly one corner map, found ${map}`)
    if (trend !== 1) fail(`the app layout must render exactly one brake-temp trend, found ${trend}`)
    if (countOf(metrics, "map notice") !== 1) {
      fail("the app corner map must state NO TRACK MAP SOURCE (omission: cornerMapGeometry)")
    }
    hasText(metrics, "NO TRACK MAP SOURCE")
    const trendNotice = countOf(metrics, "trend notice")
    const trendPoints = Number.parseInt(String(metrics.trendPoints ?? ""), 10)
    if (!Number.isFinite(trendPoints) || trendPoints < 0) {
      fail(`the brake-temp trend must publish its measured point count, received "${metrics.trendPoints}"`)
    }
    if (trendPoints === 0 && trendNotice !== 1) {
      fail("the brake-temp trend has no points and must state NO BRAKE TREND SOURCE (omission: brakeTrendLapAxis)")
    }
    if (trendPoints > 0 && trendNotice !== 0) {
      fail(`the brake-temp trend plots ${trendPoints} points yet still states NO BRAKE TREND SOURCE`)
    }
  } else {
    if (strip !== 1) fail(`the ${entry.size.layout} layout must render exactly one per-corner strip, found ${strip}`)
    if (map !== 0) fail(`the corner map is app-only, found ${map} outside the app layout`)
    if (trend !== 0) fail(`the brake-temp trend is app-only, found ${trend} outside the app layout`)
    if (countOf(metrics, "map notice") !== 0) fail("NO TRACK MAP SOURCE must not render outside the app layout")
  }
  // Six observation-ordinal columns at every viewport in both layouts (`cornerIdentity`: they are
  // never track turn numbers).
  const corners = countOf(metrics, "corner")
  if (corners !== RC15_CORNER_COLUMNS) {
    fail(`RC-15 must render exactly ${RC15_CORNER_COLUMNS} corner columns, found ${corners}`)
  }
  // A marker only exists for a scored corner; an unscored slot draws the datum tick and no marker.
  const markers = countOf(metrics, "corner marker")
  const scored = Number.parseInt(String(metrics.stateAttributes["scored-corners"]), 10)
  if (!Number.isFinite(scored) || scored < 0) {
    fail(`data-rc15-scored-corners reads "${metrics.stateAttributes["scored-corners"]}"`)
  }
  if (markers > Math.min(scored, RC15_CORNER_COLUMNS)) {
    fail(`${markers} corner markers are drawn but only ${scored} corners have been scored`)
  }
  return { corners, markers, scored }
}

function assertNativeSize(metrics, entry) {
  const expected = entry.size.layout === "native" ? "800x480" : null
  if (metrics.nativeSize !== expected) {
    fail(`native content-box modifier must be ${String(expected)}, received ${String(metrics.nativeSize)}`)
  }
}

/**
 * Packet 11.2, at override 3's cap heights:
 *   bias (72 px) > balance index (48 px) > brake temp (44 px) > corner index (30 px)
 *
 * Every step must be STRICTLY larger. Override 5 (`balanceOverBrakeTempRatio`) records that the
 * packet's 48/44 = 1.091x ratio is not reliably renderable and downgrades the promise to "the
 * balance index is at least as tall as the brake temperature" — but "at least as tall" would
 * accept a TIE, and a tie carries no hierarchy at all. The shipped ladder is 48 vs 44, so this
 * harness holds the strict inequality and a regression to a tie fails.
 */
function assertTypeScale(metrics) {
  return assertTypeScaleOrder([
    { label: "bias",         fontSize: valueOf(metrics, "bias").fontSize },
    { label: "balanceIndex", fontSize: valueOf(metrics, "balanceIndex").fontSize },
    { label: "brakeTemp",    fontSize: valueOf(metrics, "brakeTemp").fontSize },
    { label: "cornerIndex",  fontSize: valueOf(metrics, "cornerIndex").fontSize }
  ])
}

const RC15_REQUIRED_TEXT_COMMON = Object.freeze([
  "CHASSIS BALANCE",
  "COMPUTED",
  "UNDER",
  "FRONT",
  "REAR",
  "DEG C",
  "BRAKE BIAS",
  "56.4",
  "% FRONT",
  "LAST ADJ",
  "CORNER",
  "BALANCE",
  "INDEX",
  "BRAKE F / R",
  "391",
  "38",
  "1.32"
])
const RC15_REQUIRED_TEXT_SILENT = Object.freeze([...RC15_REQUIRED_TEXT_COMMON, "428"])
const RC15_REQUIRED_TEXT_HOT = Object.freeze([...RC15_REQUIRED_TEXT_COMMON, "538", "BRAKE HOT"])

/**
 * Leaf text that would reintroduce an omission or a threshold the packet never ratified.
 *
 * `alertThresholdValues` — packet 15 names a brake hot limit and an under/over balance threshold
 *   but gives neither a value or a unit. 500 °C and index 0.50 are DECLARED CONFIGURATION here,
 *   published so the packet owner can ratify or correct them, and configuration is never printed.
 *
 * `heatBarScaleUnbacked` — the 0..500 °C ten-cell scale has no packet backing, so no separate
 *   scale, tick numeral or full-scale caption may be drawn beside the bar.
 */
const RC15_FORBIDDEN_LEAF_TEXT = Object.freeze([
  Object.freeze(["500", "would print the unratified brake hot limit (RC15_PACKET_OMISSIONS.alertThresholdValues)"]),
  Object.freeze(["0.50", "would print the unratified balance-extreme threshold (RC15_PACKET_OMISSIONS.alertThresholdValues)"]),
  Object.freeze(["0..500", "would print the unbacked heat-bar scale (RC15_PACKET_OMISSIONS.heatBarScaleUnbacked)"])
])

export function validateCaptureMetrics(metrics, entry, _unused) {
  const common = validateCommonMetrics(metrics, entry, RC15_SPEC)

  assertNativeSize(metrics, entry)

  for (const expected of entry.state === "brake-hot" ? RC15_REQUIRED_TEXT_HOT : RC15_REQUIRED_TEXT_SILENT) {
    hasText(metrics, expected)
  }
  for (const [forbidden, why] of RC15_FORBIDDEN_LEAF_TEXT) lacksLeafText(metrics, forbidden, why)

  const balance = assertBalance(metrics)
  const pans = assertPans(metrics, entry)
  assertBrakeHotAlert(metrics, entry)
  assertBiasBlock(metrics)
  assertContextLine(metrics, entry)
  const reveals = assertLayoutOnlyReveals(metrics, entry)

  return { ...common, typeScale: assertTypeScale(metrics), balance, pans, reveals }
}

const RC15_MIN_NON_CANVAS_PIXELS = 5_000

/**
 * The pixel audit proves what only a real raster can prove.
 *
 *  1. The frame is not blank against the RC-15 canvas colour #0F0C0C.
 *  2. SIGNATURE (#FF5E3A, hue ≈ 10.96° → "red") is PRESENT on every frame: brake heat is the
 *     artifact's resting identity and a frame without it has lost its hero surface.
 *  3. DANGER (#FF1F5B, hue ≈ 343.93° → "magenta") is ABSENT from the silent frame and, on the
 *     brake-hot frame, SCOPED to the front pan that owns the alert. This is only decidable
 *     BECAUSE of normative override 4: the packet's danger #FF3B2E would have classified as
 *     "red", the same family as routine brake heat, and no hue test could have separated them.
 *  4. CAUTION (#FF9E2C, hue ≈ 32.4° → "amber") is absent from BOTH frames: it belongs to
 *     balance-extreme and bias-unavailable, and this fixture latches neither.
 *
 * Colour is confirmed by HUE FAMILY, never by a channel ratio. A naive `g,b < 0.62r` ratio test
 * measured 8 578 "red" pixels on a RaceCon frame whose hue-confirmed truth was zero; hue also
 * survives the `filter: brightness()` several RaceCon dashboards apply, because scaling every
 * channel by the same factor leaves the hue angle unchanged.
 */
export function validateCapturePixels(buffer, entry, metrics) {
  if (!isGovernedSize(entry.size)) fail(`unsupported capture pixel-audit size ${entry.size.width}x${entry.size.height}`)
  const image = decodeCapturePng(buffer, entry.size)

  const dangerFamily = hueFamilyOfHex(RC15_DANGER_HEX)         // "magenta"
  const cautionFamily = hueFamilyOfHex(RC15_CAUTION_HEX)       // "amber"
  const signatureFamily = hueFamilyOfHex(RC15_SIGNATURE_HEX)   // "red"

  // The alert scope is the front pan and nothing else. On the silent frame the scope is empty,
  // which makes "absent" and "scoped" the same statement.
  const scopes = entry.state === "brake-hot" ? { [dangerFamily]: metrics.alertScope ?? [] } : {}
  const audit = auditHueFamilies(image, scopes)

  let nonCanvasPixels = 0
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (!sameRgba(rgbaAt(image, x, y), RC15_CANVAS_RGBA)) nonCanvasPixels += 1
    }
  }
  if (nonCanvasPixels < RC15_MIN_NON_CANVAS_PIXELS) {
    fail("capture is blank against the RC-15 canvas colour (#0F0C0C)")
  }

  assertHueFamilyPresent(audit, signatureFamily, "the RC-15 frame — brake heat is always painted", 1)
  assertHueFamilyAbsent(
    audit,
    cautionFamily,
    "the RC-15 frame (caution belongs to balance-extreme and bias-unavailable, both silent here)"
  )
  if (entry.state === "brake-hot") {
    assertHueFamilyPresent(audit, dangerFamily, "the RC-15 brake-hot frame — the alarm must be painted", 1)
    assertHueFamilyScoped(audit, dangerFamily, "the RC-15 brake-hot frame")
  } else {
    assertHueFamilyAbsent(audit, dangerFamily, "the RC-15 silent frame (danger is an alert-only token)")
  }

  return {
    width: image.width,
    height: image.height,
    opaque: true,
    nonCanvasPixels,
    hueFamilies: audit.counts,
    dangerHueFamily: dangerFamily,
    signatureHueFamily: signatureFamily,
    dangerOutsideScope: audit.outside[dangerFamily] ?? 0
  }
}

export { CaptureSafetyError, exact, finite, containsRect, assertTypeScaleOrder }
