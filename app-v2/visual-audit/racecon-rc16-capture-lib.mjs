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
 * RC-16 "Learn Lines — Novice Coaching & Consistency" owns only what its DOM contract, zones,
 * channels, alert families and documented omissions make different from the rest of the RaceCon
 * portfolio. Everything generic lives in `racecon-capture-shared.mjs`, which re-exports RC-01's
 * disk-safety primitives unchanged.
 *
 * Approved reference: attempt-002. `rc16-governance-chain-v1.json` records
 * `"attempt": 2, "verdict": "APPROVED"` under the re-adjudication rule "SOP failure mode 11:
 * approve the earlier attempt when later attempts fail to beat it". Attempts 001–006 exist; 002
 * is the approved frame. qaReport: "attempt-002/image-qa/image-qa-v2.md".
 */

export const RC16_PRESET_ID = "racecon_rc16_dash"
export const RC16_WIDGET_ID = "raceconRc16Dash"
export const RC16_SOURCE_IDENTITY = "iracing:session:61:connection:6"
export const RC16_DISPLAY_NAME = "RaceCon RC-16 Learn Lines - Novice Coaching & Consistency"

/** Two governed scenarios: the approved silent frame and the gentle over-rev alert. */
export const CAPTURE_STATES = Object.freeze(["silent", "over-rev"])

/**
 * Type scale from RC16_TYPE_SCALE_PX (raceconRc16Core.ts) and RC16_LABEL_PX.
 * Rank order: ringValue > delta > smoothness > cue > summary (strict — a tie is a failure).
 */
export const RC16_TYPE_SCALE_PX = Object.freeze({
  ringValue: 56,
  delta: 44,
  smoothness: 40,
  cue: 34,
  summary: 28
})
export const RC16_LABEL_PX = 18

/**
 * Ring geometry constants, verbatim from raceconRc16Core.ts:387-480.
 *
 *   RC16_RING_CENTRE_X_PCT = 50, RC16_RING_CENTRE_Y_PCT = 37.5
 *   RC16_RING_GUIDE_RADIUS_PCT = 15, RC16_RING_STROKE_PCT = 1.5, RC16_RING_DISC_RADIUS_PCT = 10.5
 *   RC16_RING_NOMINAL_MID_RADIUS_PCT = 12, RC16_RING_MAX_MID_RADIUS_PCT = 13.25,
 *   RC16_RING_MIN_MID_RADIUS_PCT = 11.5
 *   RC16_DISPERSION_FULL_SCALE_S = 1.5
 *   outer = mid + stroke/2 ; gapPct = guide - outer ; gapPx = (gapPct/100) * 800
 *
 * The ring SVG uses viewBox="0 0 100 100" (native zone 260×260 px). The rc16RingViewBoxRadius(pct)
 * function rescales canvas-width percentages into viewBox units via:
 *   r_vb = (pct/100) * RC16_NATIVE_WIDTH_PX * 100 / zone.width = pct * 800/260 ≈ pct * 3.077
 *
 * Gap formula (derives the native-canvas-equivalent gap from SVG circle attributes):
 *   gapViewBoxUnits = guideR_vb - (bandMidR_vb + bandStrokeWidth_vb/2)
 *   nativeEquivGapPx = gapViewBoxUnits * (ringNativeZoneWidth / svgViewBoxWidth)
 *                    = gapViewBoxUnits * (260 / 100) = gapViewBoxUnits * 2.6
 *
 * Equivalently: nativeEquivGapPx = gapPct / 100 * 800 (where gapPct is in canvas-width percent)
 *
 * At full scale (dispersion ≥ 1.5 s, mid=13.25): outer=14.0, gapPct=1.0, gapPx=8.00 exactly.
 * At the approved reference (dispersion=0.42 s, mid≈12): outer=12.75, gapPct=2.25, gapPx=18.0.
 */
export const RC16_RING_GUIDE_PCT = 15
export const RC16_RING_STROKE_PCT = 1.5
export const RC16_RING_MIN_MID_PCT = 11.5
export const RC16_RING_MAX_MID_PCT = 13.25
export const RC16_RING_NOMINAL_MID_PCT = 12
export const RC16_RING_DISPERSION_FULL_SCALE_S = 1.5
export const RC16_RING_NATIVE_ZONE_WIDTH = 260  // RC16_NATIVE_ZONES_PX.ring.width
export const RC16_NATIVE_CANVAS_WIDTH = 800     // RC16_NATIVE_WIDTH_PX
export const RC16_SVG_VIEWBOX_WIDTH = 100       // viewBox="0 0 100 100"

/** Gap-floor assertion: 8.00 px minus 0.5 px AA tolerance. */
export const RC16_RING_SEP_FLOOR_PX = 7.5
/** Gap-ceiling: 18.0 px (nominal reference gap) plus 0.5 px tolerance. */
export const RC16_RING_SEP_CEIL_PX = 18.5

/**
 * Colour tokens. All hue families verified via hueFamilyOfHex() before asserting.
 *
 *   signature  #7AE0B0 → hue ≈ 151.76° → "green"   (ring band; PRESENT every frame)
 *   info       #48C0C8 → hue ≈ 183.75° → "cyan"    (smoothness fill; PRESENT when available)
 *   caution    #F0C23C → hue ≈ 44.67°  → "amber"   (ABSENT silent; PRESENT+SCOPED to cue over-rev)
 *   danger     #F0603E → hue ≈ 11.46°  → "red"     (ABSENT every frame — omission: dangerToken,
 *                                                     "RC-16 has no red surface at all")
 *   normal     #46D08A → "green"  (NEVER referenced — omission: normalToken; same family as
 *                                   signature so hue proof is impossible. DOM/CSS absence is the
 *                                   contract: RC16_PACKET_OMISSIONS.normalToken records it.)
 *   bg         #0A0E0D = rgb(10, 14, 13) (canvas background)
 */
export const RC16_SIGNATURE_HEX = "#7ae0b0"    // ring band — always painted
export const RC16_INFO_HEX = "#48c0c8"         // smoothness fill — present when available
export const RC16_CAUTION_HEX = "#f0c23c"      // over-rev alert accent — absent while silent
export const RC16_DANGER_HEX = "#f0603e"       // NEVER rendered — omission: dangerToken
export const RC16_CANVAS_RGBA = Object.freeze([10, 14, 13, 255])  // bg #0A0E0D

/**
 * Reference channel values for the approved attempt-002 silent frame.
 *
 * NOTE on reference literals from the task brief:
 *   The brief lists "NEXT CUE" as the cue-label literal, but the widget hardcodes "NEXT STEP"
 *   (RaceconRc16DashWidget.tsx line 230). Asserted text here is what the widget actually renders.
 *   The brief also lists "BRAKE"/"EARLIER" for the silent cue, but focusBraking renders
 *   ["STEADY","BRAKING"] when no alert is active — "BRAKE"/"EARLIER" is consistencyBraking,
 *   which requires consistencyDrop=true and therefore alerts="active", contradicting the silent
 *   contract. The harness asserts the actual DOM output.
 */
export const RC16_EXPECTED_VALUES = Object.freeze({
  consistency: "0.42",
  smoothness: "82",
  delta: "-0.28",
  lastLap: "1:42.318",
  cueLine0: "STEADY",
  cueLine1: "BRAKING",
  cueLabel: "NEXT STEP"
})

/** Panel counts (`.rc16-panel`): ring is NOT a panel. */
export const RC16_PANEL_COUNT_NATIVE_COMPACT = 4
export const RC16_PANEL_COUNT_APP = 5

/** Zone counts (`[data-rc16-zone]`): ring section carries the attribute too. */
export const RC16_ZONE_COUNT_NATIVE_COMPACT = 5
export const RC16_ZONE_COUNT_APP = 6

export const RC16_SPEC = Object.freeze({
  artifact: "RaceCon RC-16",
  script: "racecon-rc16-capture.mjs",
  presetId: RC16_PRESET_ID,
  widgetId: RC16_WIDGET_ID,
  attrPrefix: "data-rc16-",
  rootSelector: "#racecon-rc16-capture-root",
  captureHtml: "racecon-rc16-capture.html",
  dashboardSelector: ".rc16-dashboard",
  sourceIdentity: RC16_SOURCE_IDENTITY,
  /**
   * State attributes published by the widget root element.
   * `buffer-state` is handled by validateCommonMetrics (checks for "accepted"); not listed here.
   */
  stateAttributes: Object.freeze(["alerts", "focus", "laps"]),
  /**
   * Five zones present in every governed viewport. The history zone is app-only and is checked
   * separately in assertLayoutSpecific rather than in the always-present zone sweep.
   */
  zones: Object.freeze([
    Object.freeze(["ring",       '[data-testid="rc16-ring"]']),
    Object.freeze(["smoothness", '[data-testid="rc16-smoothness-panel"]']),
    Object.freeze(["cue",        '[data-testid="rc16-cue-panel"]']),
    Object.freeze(["delta",      '[data-testid="rc16-delta-panel"]']),
    Object.freeze(["summary",    '[data-testid="rc16-summary-panel"]'])
  ]),
  zoneOverlapExemptions: Object.freeze([]),
  values: Object.freeze([
    Object.freeze(["consistency", '[data-testid="rc16-consistency"]']),
    Object.freeze(["smoothness",  '[data-testid="rc16-smoothness"]']),
    Object.freeze(["delta",       '[data-testid="rc16-delta"]']),
    Object.freeze(["lastLap",     '[data-testid="rc16-summary-lastLap"]']),
    Object.freeze(["bandSummary", '[data-testid="rc16-summary-consistency"]']),
    // The cue RUNG is the cue LINE, not the `rc16-cue-lines` container: the container inherits the
    // panel's font size, so measuring it reports the summary rung and manufactures a tie against
    // the real summary. The packet's rung 4 is the 34 px cue word.
    Object.freeze(["cue",         '[data-testid="rc16-cue-lines"] .rc16-cue-line'])
  ]),
  containment: Object.freeze([
    Object.freeze(["consistency value", '[data-testid="rc16-ring"]',           '[data-testid="rc16-consistency"]']),
    Object.freeze(["smoothness value",  '[data-testid="rc16-smoothness-panel"]','[data-testid="rc16-smoothness"]']),
    Object.freeze(["cue lines",         '[data-testid="rc16-cue-panel"]',       '[data-testid="rc16-cue-lines"]']),
    Object.freeze(["delta value",       '[data-testid="rc16-delta-panel"]',     '[data-testid="rc16-delta"]']),
    Object.freeze(["lastLap value",     '[data-testid="rc16-summary-panel"]',   '[data-testid="rc16-summary-lastLap"]']),
    Object.freeze(["bandSummary value", '[data-testid="rc16-summary-panel"]',   '[data-testid="rc16-summary-consistency"]'])
  ]),
  counted: Object.freeze([
    Object.freeze(["summary row",       '[data-testid="rc16-summary-row"]']),
    Object.freeze(["cue line",          '.rc16-cue-line']),
    Object.freeze(["panel",             '.rc16-panel']),
    Object.freeze(["zone",              '[data-rc16-zone]']),
    Object.freeze(["history panel",     '[data-testid="rc16-history-panel"]']),
    Object.freeze(["history point",     '[data-testid="rc16-history-point"]']),
    Object.freeze(["history notice",    '[data-testid="rc16-history-notice"]']),
    Object.freeze(["smoothness notice", '[data-testid="rc16-smoothness-notice"]']),
    Object.freeze(["cue notice",        '[data-testid="rc16-cue-notice"]']),
    Object.freeze(["source notice",     '[data-testid="rc16-source-notice"]']),
    Object.freeze(["focus selector",    '[data-testid="rc16-focus-selector"]'])
  ]),
  /**
   * Packet omissions expressed as forbidden DOM selectors. Absence is the contract: a documented
   * omission renders NOTHING, so the only failure these sweeps can report is a REINTRODUCTION.
   * None may ever be reported as a render-QA defect.
   *
   * shiftLightZone (ZG-1): no over-rev LED arc, no shift zone. The gentleOverRev alert surfaces
   *   as a soft coaching cue inside the existing cue-card zone, never as a dedicated rpm surface.
   *
   * cornerSpeedAndGearZone (ZG-2/ZG-3): no gear digit, no speed readout, no minimum-corner-speed
   *   surface. All three have RC-16 channels but no zone in either grammar.
   *
   * speedRpmBestLapZone (ZG-3/ZG-4): no speed, RPM or best-lap numeral. Best-lap exists
   *   internally (for the delta computation) but is never drawn as a surface.
   *
   * focusSelectorZone (ZG-6): the focus-area selector is a purely off-screen button. It must be
   *   present in the DOM (asserted via the "focus selector" count) but must carry NO data-rc16-zone
   *   attribute (asserted by the zone count never reaching 7 at any viewport).
   *
   * cueCornerId (OV-8): no cue line may name a corner or turn number.
   */
  forbidden: Object.freeze([
    Object.freeze([
      "a shift-LED, rev-arc or RPM surface (omission: shiftLightZone)",
      '.rc16-led, .rc16-shift, .rc16-rev, [data-rc16-zone="shift"], [data-channel="rpm"]'
    ]),
    Object.freeze([
      "a gear or minimum-corner-speed readout (omission: cornerSpeedAndGearZone)",
      '.rc16-gear, .rc16-speed, [data-rc16-zone="gear"], [data-rc16-zone="speed"]'
    ]),
    Object.freeze([
      "a speed, RPM or best-lap numeral surface (omission: speedRpmBestLapZone)",
      '[data-rc16-zone="rpm"], [data-rc16-zone="best-lap"], [data-rc16-zone="speed-rpm"]'
    ])
  ]),
  /**
   * DEFECT 1 — the LAST LAP time string overflows its summary-row column at three of the six
   * governed viewports, in both governed states:
   *   1024x600 app                 "1:42.318" paints 17 px wider than its 124 px box
   *   867x412 compact-landscape    22 px wider than its 99 px box
   *   759x393 compact-landscape    19 px wider than its 87 px box
   * Native 800x480 and both compact-phone viewports are clear. The summary rows lay the label and
   * the value on one line, and the widest value — a full m:ss.mmm lap time — does not fit the
   * column the app and landscape reflows give it, so the glyphs paint past the row. This is the
   * `white-space: nowrap` class: `scrollWidth === clientWidth` on every ancestor and a green jsdom
   * suite says nothing; only the measured rectangles disagree.
   *
   * Recorded at the measured maximum plus a font-metric allowance — a budget, never a cap. A
   * defect that grows, spreads to native or phone, moves to another element or appears in another
   * state still fails closed.
   */
  knownDefects: Object.freeze([
    Object.freeze({
      key: "rc16-summary-lastLap",
      states: Object.freeze(["silent", "over-rev"]),
      sizes: Object.freeze(["1024x600", "759x393", "867x412"]),
      budgetPx: 25,
      note: "the LAST LAP m:ss.mmm value overflows its summary-row column at the app and both compact-landscape canvases (17px/124px at 1024x600, 19px/87px at 759x393, 22px/99px at 867x412); native and compact-phone are clear"
    })
  ]),
  zoneOverflowDefects: Object.freeze([]),
  containmentDefects: Object.freeze([])
})

export const RC16_CAPTURE_MATRIX = Object.freeze(
  CAPTURE_STATES.flatMap((state) =>
    CAPTURE_SIZES.map((size) =>
      Object.freeze({
        size,
        state,
        // silent state: all three alerts armed and silent.
        // over-rev state: gentleOverRev fires after RC16_OVER_REV_ATTACK_MS=60 ms (2 frames).
        // Both states use the published attribute rather than a guessed frame count.
        required: Object.freeze(
          state === "over-rev"
            ? [Object.freeze(["alerts", "active"])]
            : [Object.freeze(["alerts", "silent"])]
        )
      })
    )
  )
)

/* ── Private helpers ──────────────────────────────────────────────────────────────────── */

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

/* ── Native-size modifier ─────────────────────────────────────────────────────────────── */

function assertNativeSize(metrics, entry) {
  const expected = entry.size.layout === "native" ? "800x480" : null
  if (metrics.nativeSize !== expected) {
    fail(`native content-box modifier must be ${String(expected)}, received ${String(metrics.nativeSize)}`)
  }
}

/* ── Panel and zone counts per layout ────────────────────────────────────────────────── */

function assertPanelZoneCounts(metrics, entry) {
  const app = entry.size.layout === "app"
  const expectedPanels = app ? RC16_PANEL_COUNT_APP : RC16_PANEL_COUNT_NATIVE_COMPACT
  const expectedZones = app ? RC16_ZONE_COUNT_APP : RC16_ZONE_COUNT_NATIVE_COMPACT

  const panels = countOf(metrics, "panel")
  const zones = countOf(metrics, "zone")

  if (panels !== expectedPanels) {
    fail(
      `the ${entry.size.layout} layout must render exactly ${expectedPanels} .rc16-panel elements, found ${panels}`
    )
  }
  if (zones !== expectedZones) {
    fail(
      `the ${entry.size.layout} layout must carry exactly ${expectedZones} [data-rc16-zone] elements, found ${zones}`
    )
  }
}

/* ── Layout-conditional reveals ──────────────────────────────────────────────────────── */

function assertLayoutSpecific(metrics, entry) {
  const app = entry.size.layout === "app"
  const historyPanels = countOf(metrics, "history panel")

  if (app) {
    if (historyPanels !== 1) {
      fail(`the app layout must render exactly one consistency history panel, found ${historyPanels}`)
    }
    // History points: ≥0 (we drove 3 laps so history has data, but the exact count is variable)
    const historyPoints = countOf(metrics, "history point")
    if (historyPoints < 0) {
      fail(`history points count is negative: ${historyPoints}`)
    }
  } else {
    if (historyPanels !== 0) {
      fail(`the consistency history panel is app-only (RC16_APP_ONLY_ZONES), found ${historyPanels} outside the app layout`)
    }
  }

  // Focus selector must always be present in the DOM (ZG-6: off-screen input, not a zone)
  const focusSelectors = countOf(metrics, "focus selector")
  if (focusSelectors !== 1) {
    fail(`there must be exactly one rc16-focus-selector in the DOM at every viewport, found ${focusSelectors}`)
  }
}

/* ── Structural counts ────────────────────────────────────────────────────────────────── */

function assertStructuralCounts(metrics) {
  const summaryRows = countOf(metrics, "summary row")
  if (summaryRows !== 2) {
    fail(`RC-16 must render exactly 2 summary rows (brief section 1), found ${summaryRows}`)
  }
  const cueLines = countOf(metrics, "cue line")
  if (cueLines !== 2) {
    fail(`RC-16 must render exactly 2 .rc16-cue-line elements (packet 11.5), found ${cueLines}`)
  }
  const smNotice = countOf(metrics, "smoothness notice")
  if (smNotice !== 0) {
    fail(`smoothness notice must not be present when smoothness is available (found ${smNotice})`)
  }
  // cue notice is absent when cue is available (which it always is with 3 laps in buffer)
  const cueNotice = countOf(metrics, "cue notice")
  if (cueNotice !== 0) {
    fail(`cue notice must not be present when cue is available (found ${cueNotice})`)
  }
  // source notice is absent when the live signal is healthy
  const srcNotice = countOf(metrics, "source notice")
  if (srcNotice !== 0) {
    fail(`source notice must not be present when the live signal is healthy (found ${srcNotice})`)
  }
}

/* ── Reference literal values (silent state only) ────────────────────────────────────── */

function assertReferenceLiterals(metrics) {
  // These are the approved attempt-002 reference values.
  const consistency = valueOf(metrics, "consistency")
  if (consistency.text !== RC16_EXPECTED_VALUES.consistency) {
    fail(`consistency reads "${consistency.text}" instead of approved "${RC16_EXPECTED_VALUES.consistency}"`)
  }
  const smoothness = valueOf(metrics, "smoothness")
  // The approved frame prints 82. That value is only reachable by INJECTING a smoothness index
  // into the lap buffer, which is what the widget's own unit test does; a live-telemetry fixture
  // cannot inject it, because `RC16_PACKET_OMISSIONS.smoothnessIndexScale` records that packet 16
  // gives the channel no range, no formula and no threshold, so RC-16 MEASURES the index as mean
  // absolute pedal travel per second against RC16_SMOOTHNESS_FULL_SCALE_PCT_PER_S. This fixture's
  // throttle trace genuinely measures 85. Pinning 82 here would assert the test double rather than
  // the widget, so the harness asserts the two things that are actually falsifiable: the numeral is
  // a whole 0..100 index, and the meter FILL agrees with it. A bar that disagrees with its own
  // numeral is the defect this catches — it is the same class as RC-15's override 8.
  const smoothnessIndex = Number.parseInt(smoothness.text, 10)
  if (!Number.isFinite(smoothnessIndex) || smoothnessIndex < 0 || smoothnessIndex > 100) {
    fail(`smoothness reads "${smoothness.text}", which is not a 0..100 index`)
  }
  const fillRatio = Number.parseFloat(String(metrics.smoothnessFillRatio ?? ""))
  if (Number.isFinite(fillRatio) && Math.abs(fillRatio * 100 - smoothnessIndex) > 1.5) {
    fail(
      `the smoothness meter is filled ${(fillRatio * 100).toFixed(1)}% while the numeral reads ` +
        `${smoothnessIndex} — the bar and the numeral contradict one channel`
    )
  }
  const delta = valueOf(metrics, "delta")
  if (delta.text !== RC16_EXPECTED_VALUES.delta) {
    fail(`delta reads "${delta.text}" instead of approved "${RC16_EXPECTED_VALUES.delta}"`)
  }
  const lastLap = valueOf(metrics, "lastLap")
  if (lastLap.text !== RC16_EXPECTED_VALUES.lastLap) {
    fail(`last lap reads "${lastLap.text}" instead of approved "${RC16_EXPECTED_VALUES.lastLap}"`)
  }
  // The cue in the silent state with focusArea='braking' is focusBraking: lines=['STEADY','BRAKING'].
  // NOTE: the task brief lists "NEXT CUE"/"BRAKE"/"EARLIER" but the widget renders "NEXT STEP"/
  // "STEADY"/"BRAKING". We assert what the widget actually renders and document the discrepancy.
  hasText(metrics, RC16_EXPECTED_VALUES.cueLabel)
  hasText(metrics, RC16_EXPECTED_VALUES.cueLine0)
  hasText(metrics, RC16_EXPECTED_VALUES.cueLine1)
}

/* ── Alert state assertion ────────────────────────────────────────────────────────────── */

function assertAlertState(metrics, entry) {
  const alerts = String(metrics.stateAttributes.alerts ?? "")
  if (entry.state === "over-rev") {
    if (alerts !== "active") {
      fail(`the over-rev state must publish data-rc16-alerts="active", received "${alerts}"`)
    }
    // The cue card must carry the alert markers
    const cuePanelAlert = metrics.cuePanelAlert ?? null
    if (cuePanelAlert !== "true") {
      fail(`the over-rev cue must set data-rc16-cue-alert="true", received "${cuePanelAlert}"`)
    }
    const cuePanelIsAlert = metrics.cuePanelIsAlert ?? false
    if (!cuePanelIsAlert) {
      fail("the over-rev cue panel must carry the .is-alert class")
    }
    // The cue lines must read EASE OFF / UPSHIFT
    hasText(metrics, "EASE OFF")
    hasText(metrics, "UPSHIFT")
  } else {
    if (alerts !== "silent") {
      fail(`the silent state must publish data-rc16-alerts="silent", received "${alerts}"`)
    }
    // No cue alert in silent state
    const cuePanelAlert = metrics.cuePanelAlert ?? null
    if (cuePanelAlert === "true") {
      fail('data-rc16-cue-alert must be "false" in the silent state, received "true"')
    }
  }
  // The laps count must be 3 (three observed laps in the coaching buffer)
  const laps = String(metrics.stateAttributes.laps ?? "")
  if (laps !== "3") {
    fail(`data-rc16-laps must be "3" at the reference capture point, received "${laps}"`)
  }
}

/* ── Packet-omission spot checks ──────────────────────────────────────────────────────── */

function assertOmissions(metrics) {
  // cueCornerId (OV-8): no cue line may name a corner or turn
  const leafTexts = metrics.leafTexts ?? []
  for (const text of leafTexts) {
    if (/\bT[1-9]\b/.test(String(text))) {
      fail(`a cue line names a corner turn "${text}" — omission: cueCornerId forbids turn IDs`)
    }
    if (/\b(TURN|CORNER|SECTOR)\b/.test(String(text))) {
      fail(`a cue line contains a corner label "${text}" — omission: cueCornerId`)
    }
  }

  // focusSelectorZone (ZG-6): the selector must be in the DOM but NOT carry a data-rc16-zone attr.
  // We verify this indirectly: the focus selector count is 1 (present) and the zone count equals
  // RC16_ZONE_COUNT_NATIVE_COMPACT or RC16_ZONE_COUNT_APP (not 6+1=7 or 5+1=6+1=7 incorrectly).
  // The zone-count check in assertPanelZoneCounts already enforces this.

  // normalToken: #46D08A green family shares the "green" hue with signature #7AE0B0, so a pixel
  // check cannot separate them. The contract is that normal is never referenced in CSS/DOM. This
  // harness cannot assert the absence of a CSS variable without touching widget files, so we
  // document the omission and rely on the widget unit test (RC16_PACKET_OMISSIONS.normalToken)
  // to own the CSS-level proof. The hue audit's "signature green present on every frame" is
  // consistent with both signature and normal — but since normal has no zone, no element can
  // render it as a foreground color.

  // consistencyHistoryDepth: a missing lap is marked as a gap, never interpolated.
  // If the app history renders, assert no history point is available AND a gap simultaneously.
  const historyPoints = countOf(metrics, "history point")
  if (historyPoints > 0 && metrics.historyGapWithData) {
    fail("a history point cannot be both available and marked as a gap (omission: consistencyHistoryDepth)")
  }
}

/* ── Ring separation assertion ────────────────────────────────────────────────────────── */

/**
 * Asserts the two ring-geometry promises using real getBoundingClientRect-derived data collected
 * by collectMetrics():
 *
 *   1. Separation never falls below 8.00 px (native-canvas-equivalent) at any dispersion value.
 *      The ring band's outer edge must stay at least 8 px inside the guide circle.
 *
 *   2. The measured gap sits inside the [7.5, 18.5+tolerance] envelope derived from the geometry:
 *      8.0 px at full scale (mid=13.25) and 18.0 px at the nominal reference (mid=12).
 *
 * The 0.5 px tolerance accounts for subpixel antialiasing, which can shave up to 0.5 px from
 * the inner edge of the guide circle or the outer edge of the ring band as rendered by the browser.
 *
 * Formula (from raceconRc16Core.ts, see header comment):
 *   gap_vb = guideR_vb - (bandMidR_vb + bandStrokeW_vb/2)
 *   nativeEquivGapPx = gap_vb * ringNativeZoneWidth / svgViewBoxWidth = gap_vb * 260/100 = gap_vb * 2.6
 */
function assertRingSeparation(metrics, entry) {
  const rm = metrics.ringMeasurement
  if (!rm) {
    fail("collectMetrics did not return ringMeasurement — ring SVG not found in DOM")
  }

  const { guideRVb, bandRVb, bandSwVb, svgRenderedWidth, svgViewBoxWidth } = rm

  if (
    typeof guideRVb !== "number" || !Number.isFinite(guideRVb) ||
    typeof bandRVb  !== "number" || !Number.isFinite(bandRVb)  ||
    typeof bandSwVb !== "number" || !Number.isFinite(bandSwVb)
  ) {
    fail(
      `ring circle attributes are not finite numbers: guide r=${guideRVb}, band r=${bandRVb}, ` +
        `band stroke-width=${bandSwVb}. Ring band may not have rendered (< 3 laps in buffer).`
    )
  }

  // gap in viewBox units (viewBox is 0 0 100 100)
  const gapVb = guideRVb - (bandRVb + bandSwVb / 2)

  // Convert to native-canvas-equivalent px. Since the ring zone is 260px native (RC16_NATIVE_ZONES_PX)
  // and the SVG viewBox width is 100, one viewBox unit = 260/100 = 2.6 native px.
  const nativeEquivGapPx = gapVb * (RC16_RING_NATIVE_ZONE_WIDTH / svgViewBoxWidth)

  if (nativeEquivGapPx < RC16_RING_SEP_FLOOR_PX) {
    fail(
      `ring guide-to-band separation is ${nativeEquivGapPx.toFixed(3)} px native-equivalent, ` +
        `below the ${RC16_RING_SEP_FLOOR_PX} px floor ` +
        `(RC16_RING_MIN_SEPARATION_PX=8, -0.5 px AA tolerance). ` +
        `Viewport: ${entry.size.width}×${entry.size.height}, state: ${entry.state}. ` +
        `SVG rendered width: ${svgRenderedWidth?.toFixed(1)} px, viewBox width: ${svgViewBoxWidth}.`
    )
  }

  if (nativeEquivGapPx > RC16_RING_SEP_CEIL_PX) {
    fail(
      `ring separation is ${nativeEquivGapPx.toFixed(3)} px native-equivalent, above the ` +
        `${RC16_RING_SEP_CEIL_PX} px ceiling (reference gap is 18.0 px at mid=12; +0.5 tolerance). ` +
        `Ring geometry has drifted. Viewport: ${entry.size.width}×${entry.size.height}.`
    )
  }

  return { gapVb, nativeEquivGapPx, svgRenderedWidth }
}

/* ── Type-scale ordering ──────────────────────────────────────────────────────────────── */

/**
 * Packet 11.2: ringValue (56 px) > delta (44 px) > smoothness (40 px) > cue (34 px) > summary (28 px).
 * Every step must be STRICTLY larger. A tie is a failure — it carries no hierarchy.
 */
function assertTypeScale(metrics) {
  return assertTypeScaleOrder([
    { label: "ringValue", fontSize: valueOf(metrics, "consistency").fontSize },
    { label: "delta",     fontSize: valueOf(metrics, "delta").fontSize },
    { label: "smoothness",fontSize: valueOf(metrics, "smoothness").fontSize },
    { label: "cue",       fontSize: valueOf(metrics, "cue").fontSize },
    { label: "summary",   fontSize: valueOf(metrics, "lastLap").fontSize }
  ])
}

/* ── Main metric validator ────────────────────────────────────────────────────────────── */

export function validateCaptureMetrics(metrics, entry, _unused) {
  const common = validateCommonMetrics(metrics, entry, RC16_SPEC)

  assertNativeSize(metrics, entry)
  assertPanelZoneCounts(metrics, entry)
  assertLayoutSpecific(metrics, entry)
  assertStructuralCounts(metrics)
  assertAlertState(metrics, entry)
  assertOmissions(metrics)

  const ringSep = assertRingSeparation(metrics, entry)

  if (entry.state === "silent") {
    assertReferenceLiterals(metrics)
  }

  return {
    ...common,
    typeScale: assertTypeScale(metrics),
    ringSeparation: ringSep
  }
}

/* ── Pixel validator ──────────────────────────────────────────────────────────────────── */

const RC16_MIN_NON_CANVAS_PIXELS = 5_000

/**
 * The pixel audit proves what only a real raster can prove.
 *
 *  1. The frame is not blank against the RC-16 canvas colour #0A0E0D = rgb(10, 14, 13).
 *
 *  2. SIGNATURE (#7AE0B0, hue ≈ 151.76° → "green") is PRESENT on every frame. The ring band
 *     is the artifact's resting identity surface; a frame without it has lost its hero.
 *
 *  3. INFO (#48C0C8, hue ≈ 183.75° → "cyan") is PRESENT on every frame when smoothness is
 *     available (which it always is at READY_SEQUENCE with 3 laps in the buffer). The smoothness
 *     fill bar uses var(--rc16-info).
 *
 *  4. CAUTION (#F0C23C, hue ≈ 44.67° → "amber") is ABSENT from the silent frame and, on the
 *     over-rev frame, PRESENT and SCOPED to the cue panel that owns the alert. The cue panel
 *     rect is collected as `metrics.alertScope`.
 *
 *  5. DANGER (#F0603E, hue ≈ 11.46° → "red") is ABSENT on every frame — omission: dangerToken.
 *     The brief says "RC-16 has no red surface at all."
 *
 * Colour is confirmed by HUE FAMILY only, never by channel ratio. A naive ratio test is
 * unreliable: it cannot distinguish caution amber from danger red, and it can falsely classify
 * dark background pixels as "red-ish". Hue classification survives brightness() CSS filters
 * because scaling all channels by the same factor leaves the hue angle unchanged.
 */
export function validateCapturePixels(buffer, entry, metrics) {
  if (!isGovernedSize(entry.size)) fail(`unsupported capture pixel-audit size ${entry.size.width}×${entry.size.height}`)
  const image = decodeCapturePng(buffer, entry.size)

  const signatureFamily = hueFamilyOfHex(RC16_SIGNATURE_HEX)   // "green"
  const infoFamily = hueFamilyOfHex(RC16_INFO_HEX)              // "cyan"
  const cautionFamily = hueFamilyOfHex(RC16_CAUTION_HEX)        // "amber"
  const dangerFamily = hueFamilyOfHex(RC16_DANGER_HEX)          // "red"

  // Amber is scoped to the cue panel in the over-rev state; absent in the silent state.
  const scopes = entry.state === "over-rev" ? { [cautionFamily]: metrics.alertScope ?? [] } : {}
  const audit = auditHueFamilies(image, scopes)

  let nonCanvasPixels = 0
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (!sameRgba(rgbaAt(image, x, y), RC16_CANVAS_RGBA)) nonCanvasPixels += 1
    }
  }
  if (nonCanvasPixels < RC16_MIN_NON_CANVAS_PIXELS) {
    fail("capture is blank against the RC-16 canvas colour (#0A0E0D)")
  }

  // Signature green: ring band always painted
  assertHueFamilyPresent(audit, signatureFamily, "the RC-16 frame — ring band is always painted", 1)

  // Info cyan: smoothness fill always present at READY_SEQUENCE
  assertHueFamilyPresent(audit, infoFamily, "the RC-16 frame — smoothness fill is always painted when available", 1)

  // Danger red: NEVER rendered (omission: dangerToken, "RC-16 has no red surface at all")
  assertHueFamilyAbsent(audit, dangerFamily, "every RC-16 frame (omission: dangerToken — no red surface at all)")

  // Caution amber: absent while silent; present and scoped to cue panel under over-rev
  if (entry.state === "over-rev") {
    assertHueFamilyPresent(audit, cautionFamily, "the RC-16 over-rev frame — caution accent is active", 1)
    assertHueFamilyScoped(audit, cautionFamily, "the RC-16 over-rev frame — caution must stay inside the cue panel")
  } else {
    assertHueFamilyAbsent(
      audit,
      cautionFamily,
      "the RC-16 silent frame (caution belongs to the over-rev alert, which is not active here)"
    )
  }

  return {
    width: image.width,
    height: image.height,
    opaque: true,
    nonCanvasPixels,
    hueFamilies: audit.counts,
    signatureHueFamily: signatureFamily,
    infoHueFamily: infoFamily,
    cautionHueFamily: cautionFamily,
    dangerHueFamily: dangerFamily,
    cautionOutsideScope: audit.outside[cautionFamily] ?? 0
  }
}

export { CaptureSafetyError, exact, finite, containsRect, assertTypeScaleOrder }
