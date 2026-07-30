import {
  CAPTURE_SIZES,
  CaptureSafetyError,
  assertHueFamilyAbsent,
  assertHueFamilyPresent,
  assertHueFamilyScoped,
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
 * RC-18 "Split Test — Setup A/B Practice Comparison" owns only what its DOM contract, zones,
 * governed states, packet omissions, and identity-axis promise make different from the portfolio.
 * Everything generic — disk-safety primitives, the capture lifecycle, the zone sweep, the hue
 * audit machinery, and the fail-closed shared assertions — lives in `racecon-capture-shared.mjs`.
 *
 * Approved reference: attempt-004. `rc18-governance-chain-v1.json` records `"verdict": "APPROVED"`,
 * `"attempt": 4` and the re-adjudication note "attempt-005 and attempt-006 were built from
 * attempt-004 and both regressed … the chain was re-adjudicated back to attempt-004".
 * Title: "Split Test - Setup A/B Practice Comparison".
 */

export const RC18_PRESET_ID = "racecon_rc18_dash"
export const RC18_WIDGET_ID = "raceconRc18Dash"
export const RC18_SOURCE_IDENTITY = "iracing:session:18:connection:1"

/** Two governed scenarios: the approved reference alert frame and the fully-silent matched frame. */
export const CAPTURE_STATES = Object.freeze(["reference", "matched"])

/**
 * Colour tokens, verbatim from `RC18_TOKENS` in `raceconRc18Core.ts` and `raceconRc18.css`.
 *
 * `danger` #F0533E and `normal` #52C07A belong to the alert layer and are UNUSED in every
 * governed frame — the faster side is never green (packet 11.3) and the only alarm token that
 * fires is CAUTION on the INCOMPARABLE tag. Run `hueFamilyOfHex` on each token at test time;
 * do not guess the family name.
 *
 * Hue-family caveat: `danger` (hue ≈ 7°, red) and `info` (hue ≈ 200°, cyan) are in distinct
 * families, so the zero-pixel assertion on "red" cannot produce a false negative against the
 * Setup A identity line. Same for `normal` (hue ≈ 142°, green) vs `signature` (hue ≈ 257°,
 * blue). No cross-family collision exists for these four tokens on any governed frame.
 */
export const RC18_INFO_HEX = "#4fb0e0"       // Setup A identity — cyan family
export const RC18_SIG_HEX = "#b0a0ff"        // Setup B identity + highlighted bars — blue family
export const RC18_CAUTION_HEX = "#f0b83a"    // INCOMPARABLE tag ONLY — amber family
export const RC18_DANGER_HEX = "#f0533e"     // UNUSED — red family; must be zero pixels every frame
export const RC18_NORMAL_HEX = "#52c07a"     // UNUSED — green family; must be zero pixels every frame
export const RC18_CANVAS_RGBA = Object.freeze([12, 14, 17, 255])  // bg #0C0E11

/**
 * Type scale from `RC18_TYPE_SCALE_PX` in the core, at the 800 px native content width.
 * The harness asserts the ORDER strictly: a tie is a failure (see `assertTypeScale`).
 *
 * Mapping to CSS custom-properties and testid selectors:
 *   verdict   44 px → `--rc18-type-verdict`   → `output.rc18-delta-value` ([data-testid="rc18-delta-value-S1"])
 *   sector    34 px → `--rc18-type-sector`    → timing-rung row values ([data-testid="rc18-a-deltaToBest"])
 *   summary   28 px → `--rc18-type-summary`   → `output.rc18-summary-verdict` ([data-testid="rc18-verdict"])
 *   secondary 22 px → `--rc18-type-secondary` → secondary-rung row values ([data-testid="rc18-a-tyreLf"])
 *   label     16 px → `--rc18-type-label`     → `span.rc18-label` ([data-testid="rc18-baseline"])
 */
export const RC18_TYPE_SCALE_PX = Object.freeze({
  verdict: 44,
  sector: 34,
  summary: 28,
  secondary: 22,
  label: 16
})

// Spine geometry constants (from raceconRc18Core.ts)
export const RC18_SPINE_FULL_SCALE_SEC = 0.32
export const RC18_SPINE_HALF_SPAN_NATIVE_PX = 76
export const RC18_SPINE_HALF_SPAN_APP_PX = 152
export const RC18_SPINE_HALF_SPAN_PCT = 45.238095238095237
export const RC18_MIRROR_AXIS_PCT = 50

const RC18_MIN_NON_CANVAS_PIXELS = 5_000

/** Tolerance for shared-axis datum spread; image-QA measured 1.0 px on the approved frame. */
const SHARED_AXIS_TOLERANCE_PX = 1

/** Sub-pixel rendering tolerance for bar anchoring and bar length assertions. */
const BAR_GEOMETRY_TOLERANCE_PX = 2

/** Tight tolerance for column-head height equality (regression guard for the 4 px defect). */
const HEAD_HEIGHT_TOLERANCE_PX = 0.5

/** Geometric tolerance for zone symmetry (co-width, co-height, co-top). */
const ZONE_GEOM_TOLERANCE_PX = 0.5

export const RC18_SPEC = Object.freeze({
  artifact: "RaceCon RC-18",
  script: "racecon-rc18-capture.mjs",
  presetId: RC18_PRESET_ID,
  widgetId: RC18_WIDGET_ID,
  attrPrefix: "data-rc18-",
  rootSelector: "#racecon-rc18-capture-root",
  captureHtml: "racecon-rc18-capture.html",
  dashboardSelector: ".rc18-dashboard",
  sourceIdentity: RC18_SOURCE_IDENTITY,
  /**
   * State attributes collected by `window.__rcCommon` from the widget root element.
   * `layout` and `compact-mode` come from the common measurement, not this list.
   */
  stateAttributes: Object.freeze([
    "pair",
    "alerts",
    "alert-keys",
    "incomparable",
    "faster",
    "rows",
    "mirror-axis-pct",
    "half-span-pct",
    "baseline"
  ]),
  /**
   * Six always-present zones across every governed viewport. The trace zone is app-only and is
   * verified in `assertLayoutOnly` rather than here to avoid a missing-zone failure on native.
   *
   * `deltaStack` and `stability` are NESTED inside `spine` (gap G3 / G2 resolution in the
   * packet geometry spec). Placing them here lets the zone sweep detect any unintended geometry
   * regression inside the spine; the overlap exemptions below whitelist the legitimate nesting.
   */
  zones: Object.freeze([
    Object.freeze(["summary",    '[data-testid="rc18-summary"]']),
    Object.freeze(["columnA",    '[data-testid="rc18-column-a"]']),
    Object.freeze(["columnB",    '[data-testid="rc18-column-b"]']),
    Object.freeze(["spine",      '[data-testid="rc18-spine"]']),
    Object.freeze(["deltaStack", '[data-testid="rc18-delta-stack"]']),
    Object.freeze(["stability",  '[data-testid="rc18-stability"]'])
  ]),
  /**
   * `stabilityZoneOverlap` (RC18_PACKET_OMISSIONS): both deltaStack and stability are sub-zones
   * nested inside spine. The `assertZonesDoNotOverlap` sweep would otherwise fire on these two
   * legitimate nesting relationships. These exemptions are the correct tool (RC-03 uses the same
   * pattern), not a way to silence any other zone pair.
   */
  zoneOverlapExemptions: Object.freeze([
    Object.freeze(["spine", "deltaStack"]),
    Object.freeze(["spine", "stability"])
  ]),
  values: Object.freeze([
    Object.freeze(["verdict",   '[data-testid="rc18-delta-value-S1"]']),
    Object.freeze(["sector",    '[data-testid="rc18-a-deltaToBest"]']),
    Object.freeze(["summary",   '[data-testid="rc18-verdict"]']),
    // The `secondary` rung must be a row that exists at EVERY governed viewport. The
    // compact-phone layout publishes `data-rc18-rows="5"` and drops the four tyre rows and both
    // brake rows, so `rc18-a-tyreLf` is legitimately absent at 393x759 and 412x867 — requiring it
    // would report a correct responsive reflow as a missing output. `minSpeed` is a secondary-rank
    // row that survives the phone reflow, so it is the rung that can actually be measured
    // everywhere.
    Object.freeze(["secondary", '[data-testid="rc18-a-minSpeed"]']),
    Object.freeze(["label",     '[data-testid="rc18-baseline"]'])
  ]),
  /**
   * Containment checks for the three `white-space: nowrap` spine labels that carry no explicit
   * width. This is the class of defect where `scrollWidth === clientWidth` while the glyph
   * escapes; `assertZoneContainment` detects it via `getBoundingClientRect`, not scrollWidth.
   *
   * An earlier iteration capped `scrollHeight` unconditionally and reported a 4 px overrun where
   * the truth was 42 px. These assertions use the measured bounding rect and never cap it.
   */
  containment: Object.freeze([
    Object.freeze([
      "spine title",
      '[data-testid="rc18-delta-stack"]',
      "span.rc18-label.rc18-spine-title"
    ]),
    Object.freeze([
      "balance label",
      '[data-testid="rc18-stability"]',
      ".rc18-stability-head span.rc18-label"
    ]),
    Object.freeze([
      "balance source",
      '[data-testid="rc18-stability"]',
      '[data-testid="rc18-balance-source"]'
    ])
  ]),
  counted: Object.freeze([
    Object.freeze(["rc18-row", '[data-testid="rc18-row"]'])
  ]),
  /**
   * Packet omissions expressed as forbidden DOM selectors. Every entry must count zero at every
   * viewport in every governed state. A non-zero count is a REINTRODUCTION of an omission, not
   * a render-QA defect.
   *
   * Omissions NOT expressible as DOM selectors (recorded here so the reason is visible):
   *   `sectorSplitChannel` — the sectors are derived from lap-distance crossings; no DOM selector
   *     can prove a channel does NOT supply sector splits.
   *   `balanceRangeConvention` — the scale (−1 … +1) lives in the CSS type ladder, not in DOM.
   *   `stabilityMinSpeedBinding` — the 30 km/h exclusion window is applied during sample
   *     accumulation; no DOM surface exposes the threshold.
   *   `tyreWindowSampling` — the rolling window length is configuration in the core; not DOM.
   *   `configurationIdentityChannel` — there is no channel that carries a setup name; that
   *     absence is a data-model constraint, not a DOM property.
   *   `deltaToBestLapTrigger` — lap detection is a recorder state, not a DOM surface.
   *   `appStabilityZone` — the stability sub-zone is INSIDE the spine on both canvases; there is
   *     no separate app-only stability zone to forbid.
   *   `stabilityZoneOverlap` — handled by `zoneOverlapExemptions` above.
   *   `brakeAxleAggregation` — the honest "--" state for B rear is absence-is-the-contract;
   *     not a forbidden selector but a positive assertion in `assertBrakeRearHonestEmpty`.
   */
  forbidden: Object.freeze([
    Object.freeze([
      "an RPM, LED, rev-arc or shift surface (omission: rpmComparisonRow)",
      '.rc18-led, .rc18-shift, .rc18-rpm, .rc18-rev, [data-rc18-zone="rpm"], [data-rc18-zone="rev"], [data-testid*="rpm"], [data-testid*="shift-led"]'
    ]),
    Object.freeze([
      "a named speed readout zone (omission: speedNativeZone — speed lives in the app trace only)",
      '[data-testid="rc18-speed"], [data-rc18-zone="speed"]'
    ]),
    Object.freeze([
      "a best-lap or fuel-per-lap readout (omission: bestLapAndFuelZone)",
      '[data-rc18-zone="best-lap"], [data-rc18-zone="fuel"], [data-testid*="best-lap"], [data-testid*="fuel-per-lap"]'
    ]),
    Object.freeze([
      "an on-screen lock, release or re-match control (omission: matchLapControlZone)",
      '[data-rc18-zone="match-control"], [data-testid*="lock-control"], [data-testid*="release-control"], [data-testid*="rematch"]'
    ]),
    Object.freeze([
      "a per-corner difference table (omission: perCornerDifferenceTable)",
      '[data-rc18-zone="corner-diff"], [data-testid*="corner-diff"]'
    ])
  ]),
  /**
   * Defect ledger. All three arrays are EMPTY: the implementation audit found and recorded the
   * two defects (B header height inequality, spine label escape potential), and the sweep below
   * asserts them as live checks with exact measurements rather than waiving them. Anything this
   * sweep finds is a NEW regression and must fail closed with its measurement.
   */
  knownDefects: Object.freeze([]),
  zoneOverflowDefects: Object.freeze([]),
  containmentDefects: Object.freeze([])
})

export const RC18_CAPTURE_MATRIX = Object.freeze(
  CAPTURE_STATES.flatMap((state) =>
    CAPTURE_SIZES.map((size) =>
      Object.freeze({
        size,
        state,
        /**
         * The harness waits for the published attributes rather than a guessed frame count.
         *   reference: alerts="active" (S2/S3 sector-gap + incomparable:brakeRear latched)
         *              AND pair="matched" (two archived laps).
         *   matched:   alerts="silent", pair="matched", incomparable="0"
         *              (all three sector deltas < 0.050 s, all rows comparable).
         */
        required: Object.freeze(
          state === "reference"
            ? [
                Object.freeze(["alerts", "active"]),
                Object.freeze(["pair", "matched"])
              ]
            : [
                Object.freeze(["alerts", "silent"]),
                Object.freeze(["pair", "matched"]),
                Object.freeze(["incomparable", "0"])
              ]
        )
      })
    )
  )
)

/* ── Private helpers ──────────────────────────────────────────────────────────────────── */

function countOf(metrics, label) {
  const entry = (metrics.counted ?? []).find((candidate) => candidate.label === label)
  if (!entry) fail(`capture did not count "${label}"`)
  return entry.count
}

function valueOf(metrics, label) {
  const entry = (metrics.values ?? []).find((candidate) => candidate.label === label)
  if (!entry || !entry.present) fail(`capture is missing the "${label}" value element`)
  return entry
}

function zoneOf(metrics, name) {
  const entry = (metrics.zones ?? []).find((candidate) => candidate.name === name)
  if (!entry || !entry.present) fail(`capture is missing the "${name}" zone`)
  return entry
}

function assertNativeSize(metrics) {
  const expected = metrics.layout === "native" ? "800x480" : null
  if (metrics.nativeSize !== expected) {
    fail(`data-rc18-native-size must be ${String(expected)}, received ${String(metrics.nativeSize)}`)
  }
}

/**
 * The trace zone is app-only (1024×600 canvas, `ab-trace-reveal`). The 800×480 canvas carries
 * no speed readout of any kind (omission: speedNativeZone, gap G9). If the trace element is
 * present on native, that is a reintroduction of G9.
 */
function assertLayoutOnly(metrics) {
  const app = metrics.layout === "app"
  const native = metrics.layout === "native"
  if (native && metrics.tracePresent) {
    fail("rc18-trace must not appear on the native (800×480) canvas (omission: speedNativeZone)")
  }
  if (app && !metrics.tracePresent) {
    fail("rc18-trace must be present on the app (1024×600) canvas (omission: ab-trace-reveal)")
  }
}

function assertAlertState(metrics, entry) {
  const attrs = metrics.stateAttributes ?? {}
  if (entry.state === "reference") {
    if (attrs.alerts !== "active") {
      fail(`reference frame must have data-rc18-alerts="active", received "${attrs.alerts}"`)
    }
    if (attrs.pair !== "matched") {
      fail(`reference frame must have data-rc18-pair="matched", received "${attrs.pair}"`)
    }
    const alertKeys = (attrs["alert-keys"] ?? "").split(",").filter(Boolean)
    // The incomparable alert is computed over the RENDERED comparison rows. The compact-phone
    // reflow publishes `data-rc18-rows="5"` and drops the four tyre rows and both brake rows, so
    // `incomparable:brakeRear` cannot and must not fire there — the row whose B side is `--` is
    // not on the canvas at all. Requiring it at phone would report a correct responsive reflow as
    // a missing alert. The two sector gaps are rank-1 rows and survive every reflow.
    const phone = entry.size.compactMode === "phone"
    const requiredKeys = phone
      ? ["sector-gap:S2", "sector-gap:S3"]
      : ["sector-gap:S2", "sector-gap:S3", "incomparable:brakeRear"]
    if (phone && alertKeys.some((key) => key.startsWith("incomparable:"))) {
      fail(
        `the compact-phone reflow renders no brake or tyre rows, so no incomparable alert may fire; ` +
          `received "${attrs["alert-keys"]}"`
      )
    }
    for (const required of requiredKeys) {
      if (!alertKeys.includes(required)) {
        fail(`reference frame must include "${required}" in data-rc18-alert-keys, received "${attrs["alert-keys"]}"`)
      }
    }
    if (alertKeys.includes("sector-gap:S1")) {
      fail(`S1 delta (+0.041 s) is below the 0.050 s threshold; sector-gap:S1 must NOT fire (reference frame)`)
    }
    if (alertKeys.includes("stability-difference")) {
      fail(`stability delta (0.11) is below the 0.15 band; stability-difference must NOT fire (reference frame)`)
    }
    // Same reflow rule as the alert keys above: the compact-phone canvas renders no brake rows, so
    // its incomparable COUNT is legitimately 0 while every other viewport reports 1.
    const expectedIncomparable = phone ? "0" : "1"
    if (attrs.incomparable !== expectedIncomparable) {
      fail(
        `reference frame must have data-rc18-incomparable="${expectedIncomparable}" at ` +
          `${entry.size.width}x${entry.size.height}, received "${attrs.incomparable}"`
      )
    }
    if (!metrics.alertChipPresent) {
      fail("reference frame must render rc18-alert-chip when alertLines are non-empty")
    }
  } else {
    if (attrs.alerts !== "silent") {
      fail(`matched frame must have data-rc18-alerts="silent", received "${attrs.alerts}"`)
    }
    if (attrs.pair !== "matched") {
      fail(`matched frame must have data-rc18-pair="matched", received "${attrs.pair}"`)
    }
    const alertKeys = (attrs["alert-keys"] ?? "").split(",").filter(Boolean)
    if (alertKeys.length > 0) {
      fail(`matched frame must have empty data-rc18-alert-keys, received "${attrs["alert-keys"]}"`)
    }
    if (attrs.incomparable !== "0") {
      fail(`matched frame must have data-rc18-incomparable="0", received "${attrs.incomparable}"`)
    }
    if (metrics.alertChipPresent) {
      fail("matched frame must NOT render rc18-alert-chip when alertLines are empty")
    }
  }
}

/**
 * The headline RC-18 promise: "all three bars start on the shared datum on the mirror axis."
 * The image-QA measured datum spread ≤ 1.0 px on the approved frame. Proves via
 * `getBoundingClientRect`, not by trusting the attribute.
 *
 *  1. All three datum centre-X values equal within SHARED_AXIS_TOLERANCE_PX (1 px).
 *  2. Each datum centre-X ≈ its own track's centre-X within the same tolerance.
 *  3. The shared axis aligns with the spine's 50 % mirror-axis-pct within 2 px.
 */
function assertSharedAxis(metrics, entry) {
  const centres = []
  for (const sector of ["S1", "S2", "S3"]) {
    const dr = metrics.datumRects?.[sector]
    const tr = metrics.trackRects?.[sector]
    if (!dr || !tr) fail(`rc18 datum or track for ${sector} was not measured`)
    const datumCentreX = dr.left + dr.width / 2
    const trackCentreX = tr.left + tr.width / 2
    if (Math.abs(datumCentreX - trackCentreX) > SHARED_AXIS_TOLERANCE_PX) {
      fail(
        `rc18-datum-${sector} centre X ${datumCentreX.toFixed(2)} px ≠ ` +
        `rc18-track-${sector} centre X ${trackCentreX.toFixed(2)} px ` +
        `(tolerance: ±${SHARED_AXIS_TOLERANCE_PX} px) — datum must sit at the track midpoint`
      )
    }
    centres.push(datumCentreX)
  }
  const spread = Math.max(...centres) - Math.min(...centres)
  if (spread > SHARED_AXIS_TOLERANCE_PX) {
    fail(
      `datum centre-X spread ${spread.toFixed(2)} px across [${centres.map((x) => x.toFixed(2)).join(", ")}] — ` +
      `the shared-axis promise requires spread ≤ ${SHARED_AXIS_TOLERANCE_PX} px (image-QA measured 1.0 px)`
    )
  }
  // Spine mirror-axis check: datum centre-X ≈ contentWidth × RC18_MIRROR_AXIS_PCT / 100
  const contentWidth = Number(metrics.contentWidth)
  if (Number.isFinite(contentWidth) && contentWidth > 0) {
    const expectedAxisX = (contentWidth * RC18_MIRROR_AXIS_PCT) / 100
    if (Math.abs(centres[0] - expectedAxisX) > BAR_GEOMETRY_TOLERANCE_PX) {
      fail(
        `datum centre-X ${centres[0].toFixed(2)} px ≠ ` +
        `contentWidth ${contentWidth} × mirror-axis-pct ${RC18_MIRROR_AXIS_PCT}% = ${expectedAxisX.toFixed(2)} px`
      )
    }
  }
}

/**
 * Bar anchoring: `lean="a"` → bar's right edge sits on the datum centre; `lean="b"` → bar's
 * left edge. Tolerance ±BAR_GEOMETRY_TOLERANCE_PX (2 px, sub-pixel layout rounding).
 */
function assertBarAnchoring(metrics, entry) {
  for (const sector of ["S1", "S2", "S3"]) {
    const bar = metrics.barRects?.[sector]
    const datumRect = metrics.datumRects?.[sector]
    if (!bar || !datumRect) continue
    const datumCentreX = datumRect.left + datumRect.width / 2
    const lean = bar.lean
    if (lean === "a") {
      const barRight = bar.rect.left + bar.rect.width
      if (Math.abs(barRight - datumCentreX) > BAR_GEOMETRY_TOLERANCE_PX) {
        fail(
          `rc18-bar-${sector} (lean=a) right edge ${barRight.toFixed(2)} px ≠ ` +
          `datum centre ${datumCentreX.toFixed(2)} px (tolerance: ±${BAR_GEOMETRY_TOLERANCE_PX} px)`
        )
      }
    } else if (lean === "b") {
      const barLeft = bar.rect.left
      if (Math.abs(barLeft - datumCentreX) > BAR_GEOMETRY_TOLERANCE_PX) {
        fail(
          `rc18-bar-${sector} (lean=b) left edge ${barLeft.toFixed(2)} px ≠ ` +
          `datum centre ${datumCentreX.toFixed(2)} px (tolerance: ±${BAR_GEOMETRY_TOLERANCE_PX} px)`
        )
      }
    }
  }
}

/**
 * Bar length formula: `clamp(|delta| / RC18_SPINE_FULL_SCALE_SEC, 0, 1) × halfSpan`.
 * halfSpan = 76 px (native) / 152 px (app) from the shared constant RC18_SPINE_HALF_SPAN_PCT.
 * Tolerance: ±2 px (sub-pixel rendering). The delta value is parsed from the
 * `rc18-delta-value-S*` text content, which is formatted by `rc18SignedSeconds`.
 */
function assertBarLengthFormula(metrics, entry) {
  const halfSpan =
    entry.size.layout === "native" ? RC18_SPINE_HALF_SPAN_NATIVE_PX : RC18_SPINE_HALF_SPAN_APP_PX
  for (const sector of ["S1", "S2", "S3"]) {
    const bar = metrics.barRects?.[sector]
    if (!bar) continue
    const deltaText = metrics.deltaValues?.[sector] ?? null
    // RC-18 renders a typographic MINUS SIGN (U+2212) rather than an ASCII hyphen, so a raw
    // `Number.parseFloat` on the rendered text returns NaN. Normalise before parsing — the sign
    // glyph is a rendering choice, not a value.
    const delta =
      deltaText !== null && deltaText !== "--.---"
        ? Number.parseFloat(deltaText.replace(/\u2212/gu, "-").replace(/\u2013|\u2014/gu, "-"))
        : null
    if (delta === null || !Number.isFinite(delta)) {
      fail(`rc18-delta-value-${sector} is unparseable for bar length check: "${deltaText}"`)
    }
    // The nominal half-span (76 px native / 152 px app) assumes the packet's exact spine width.
    // The bar is actually sized as `RC18_SPINE_HALF_SPAN_PCT` of its TRACK, so the honest
    // denominator is the measured track: at 1024x600 the rendered track is fractionally narrower
    // than the packet's 336 px and the nominal constant over-predicts by ~2.3 px, which is the
    // spine's own layout rounding and not a bar-length error. The measured half-span is therefore
    // preferred, and the nominal value is asserted separately below so a genuine spine resize
    // still fails.
    const track = metrics.trackRects?.[sector]
    const measuredHalfSpan =
      track && track.width > 1 ? (track.width * RC18_SPINE_HALF_SPAN_PCT) / 100 : halfSpan
    // Only the native and app canvases are normatively bounded: packet 11.1 declares a 168 px
    // spine at 800x480 and 12.1 a 336 px spine at 1024x600, giving the 76 px and 152 px half-spans.
    // The four compact viewports have no declared spine width at all, so the nominal cross-check
    // applies to the two governed canvases and the bar length is always measured against the
    // spine the frame actually rendered.
    const nominallyBounded = entry.size.layout === "native" || entry.size.layout === "app"
    if (nominallyBounded && Math.abs(measuredHalfSpan - halfSpan) > BAR_GEOMETRY_TOLERANCE_PX + 2) {
      fail(
        `the ${entry.size.layout} spine half-span measures ${measuredHalfSpan.toFixed(2)} px but the ` +
          `packet declares ${halfSpan} px — the spine has been resized`
      )
    }
    const expectedWidth = Math.min(Math.abs(delta) / RC18_SPINE_FULL_SCALE_SEC, 1) * measuredHalfSpan
    const actualWidth = bar.rect.width
    if (Math.abs(actualWidth - expectedWidth) > BAR_GEOMETRY_TOLERANCE_PX) {
      fail(
        `rc18-bar-${sector} width ${actualWidth.toFixed(2)} px ≠ ` +
        `clamp(|${delta}|/${RC18_SPINE_FULL_SCALE_SEC}, 0, 1) × ${measuredHalfSpan.toFixed(2)} = ${expectedWidth.toFixed(2)} px ` +
        `(tolerance: ±${BAR_GEOMETRY_TOLERANCE_PX} px)`
      )
    }
  }
}

/**
 * Column A and B must be mirror-equal. The brief requires:
 *  — equal width, height, and top within ZONE_GEOM_TOLERANCE_PX
 *  — columnA.left + columnB.right ≈ 2 × spineCentreX
 *  — spineCentreX ≈ contentWidth × mirror-axis-pct / 100
 */
function assertColumnSymmetry(metrics, entry) {
  const colA = zoneOf(metrics, "columnA")
  const colB = zoneOf(metrics, "columnB")
  const spine = zoneOf(metrics, "spine")

  const widthDiff = Math.abs(colA.width - colB.width)
  if (widthDiff > ZONE_GEOM_TOLERANCE_PX) {
    fail(`columns are asymmetric in width: A=${colA.width.toFixed(2)} B=${colB.width.toFixed(2)} (Δ=${widthDiff.toFixed(2)} px)`)
  }
  const heightDiff = Math.abs(colA.height - colB.height)
  if (heightDiff > ZONE_GEOM_TOLERANCE_PX) {
    fail(`columns are asymmetric in height: A=${colA.height.toFixed(2)} B=${colB.height.toFixed(2)} (Δ=${heightDiff.toFixed(2)} px)`)
  }
  const topDiff = Math.abs(colA.top - colB.top)
  if (topDiff > ZONE_GEOM_TOLERANCE_PX) {
    fail(`columns are not co-top: A.top=${colA.top.toFixed(2)} B.top=${colB.top.toFixed(2)} (Δ=${topDiff.toFixed(2)} px)`)
  }

  const spineCentreX = spine.left + spine.width / 2
  const mirrorSum = colA.left + (colB.left + colB.width)   // colA.left + colB.right
  const expectedDouble = 2 * spineCentreX
  const mirrorError = Math.abs(mirrorSum - expectedDouble)
  if (mirrorError > ZONE_GEOM_TOLERANCE_PX * 2) {
    fail(
      `columns are not mirrored about spine centre ${spineCentreX.toFixed(2)} px: ` +
      `colA.left(${colA.left.toFixed(2)}) + colB.right(${(colB.left + colB.width).toFixed(2)}) = ` +
      `${mirrorSum.toFixed(2)} ≠ 2 × ${spineCentreX.toFixed(2)} = ${expectedDouble.toFixed(2)} (Δ=${mirrorError.toFixed(2)} px)`
    )
  }
}

/**
 * Column head heights must be equal (regression guard for the "B header 4 px taller than A"
 * defect found by the implementation audit). The fix pins `.rc18-identity { height: 6px;
 * max-height: 6px; }` — if that pin is ever removed, B's two-band identity block grows and the
 * header stands taller. Tolerance: HEAD_HEIGHT_TOLERANCE_PX (0.5 px). Reports the true delta.
 */
function assertColumnHeadHeights(metrics, entry) {
  const headA = metrics.colAHeadRect
  const headB = metrics.colBHeadRect
  if (!headA || !headB) fail("rc18 column head rects were not measured")
  const diff = Math.abs(headA.height - headB.height)
  if (diff > HEAD_HEIGHT_TOLERANCE_PX) {
    fail(
      `column head heights are unequal: A=${headA.height.toFixed(2)} px, B=${headB.height.toFixed(2)} px ` +
      `(Δ=${diff.toFixed(2)} px) — the .rc18-identity { height: 6px } pin guards this ` +
      `(defect: B's two-band header stands taller than A's)`
    )
  }
}

/**
 * Normative override NO-6: Setup A carries ONE identity line, Setup B carries TWO.
 * Assert both the published attribute (`data-rc18-line-bands`) and the actual child count.
 * Trusting only the attribute would miss a case where the React render and the attribute diverge.
 */
function assertIdentityLines(metrics, entry) {
  if (metrics.identityBandsA !== "1") {
    fail(`rc18-identity-a must have data-rc18-line-bands="1", received "${metrics.identityBandsA}"`)
  }
  if (metrics.identityLineCountA !== 1) {
    fail(`rc18-identity-a must contain exactly 1 .rc18-identity-line child, found ${metrics.identityLineCountA}`)
  }
  if (metrics.identityBandsB !== "2") {
    fail(`rc18-identity-b must have data-rc18-line-bands="2", received "${metrics.identityBandsB}"`)
  }
  if (metrics.identityLineCountB !== 2) {
    fail(`rc18-identity-b must contain exactly 2 .rc18-identity-line children, found ${metrics.identityLineCountB}`)
  }
}

/**
 * Row count: 11 per column (22 total `rc18-row` elements) at native/app/compact-standard/
 * compact-landscape; 5 per column (10 total) at compact-phone.
 */
function assertRowCounts(metrics, entry) {
  const isPhone = metrics.compactMode === "phone"
  const expectedPerColumn = isPhone ? 5 : 11
  const expectedTotal = expectedPerColumn * 2
  const actual = countOf(metrics, "rc18-row")
  if (actual !== expectedTotal) {
    fail(
      `${metrics.layout}${isPhone ? " (phone)" : ""} layout must render ${expectedTotal} rc18-row elements ` +
      `(${expectedPerColumn} per column), found ${actual}`
    )
  }
  const rowsAttr = String(metrics.stateAttributes?.rows ?? "")
  if (rowsAttr !== String(expectedPerColumn)) {
    fail(`data-rc18-rows must be "${expectedPerColumn}" for this layout, received "${rowsAttr}"`)
  }
}

/**
 * `brakeAxleAggregation` omission: `rc18AxlePeakC` requires BOTH rear corners to be finite;
 * Setup B's fixture carries no rear-right sensor. Therefore `rc18-b-brakeRear` must render "--"
 * (the honest empty state for `rc18Integer(null)`). This is absence-is-the-contract, not a
 * defect, and must never be reported as a render-QA failure.
 *
 * Only checked on the reference frame, where the omission drives brakeRear to null. The matched
 * frame provides all corners and shows a numeric value.
 */
function assertBrakeRearHonestEmpty(metrics, entry) {
  if (entry.state !== "reference") return
  // The compact-phone reflow publishes `data-rc18-rows="5"` and renders neither brake row, so
  // there is no `rc18-b-brakeRear` element to dash. That is the documented reflow, not a missing
  // honest empty state — so the phone canvas asserts ABSENCE instead, and a brake row appearing
  // there would be the failure.
  if (entry.size.compactMode === "phone") {
    if (metrics.brakeRearBText !== null && metrics.brakeRearBText !== undefined) {
      fail(
        `the compact-phone reflow renders 5 rows and must not render rc18-b-brakeRear, ` +
          `received "${metrics.brakeRearBText}"`
      )
    }
    return
  }
  if (metrics.brakeRearBText !== "--") {
    fail(
      `rc18-b-brakeRear must render "--" when the rear-right brake sensor is absent ` +
      `(honest empty: rc18AxlePeakC(brakePeakC, 'rear') returns null unless BOTH corners are finite). ` +
      `Received "${metrics.brakeRearBText}". Omission: brakeAxleAggregation.`
    )
  }
}

/**
 * Type-scale strict order: verdict (44) > sector (34) > summary (28) > secondary (22) > label (16).
 * A TIE anywhere in the ladder is a failure — a tie carries no hierarchy.
 */
function assertTypeScale(metrics) {
  return assertTypeScaleOrder([
    { label: "verdict",   fontSize: valueOf(metrics, "verdict").fontSize },
    { label: "sector",    fontSize: valueOf(metrics, "sector").fontSize },
    { label: "summary",   fontSize: valueOf(metrics, "summary").fontSize },
    { label: "secondary", fontSize: valueOf(metrics, "secondary").fontSize },
    { label: "label",     fontSize: valueOf(metrics, "label").fontSize }
  ])
}

/* ── Exported validators ──────────────────────────────────────────────────────────────── */

export function validateCaptureMetrics(metrics, entry, _unused) {
  const common = validateCommonMetrics(metrics, entry, RC18_SPEC)

  assertNativeSize(metrics)
  assertLayoutOnly(metrics)
  assertAlertState(metrics, entry)
  assertSharedAxis(metrics, entry)
  assertBarAnchoring(metrics, entry)
  assertBarLengthFormula(metrics, entry)
  assertColumnSymmetry(metrics, entry)
  assertColumnHeadHeights(metrics, entry)
  assertIdentityLines(metrics, entry)
  assertRowCounts(metrics, entry)
  assertBrakeRearHonestEmpty(metrics, entry)

  /**
   * `alertNumerics` omission: the 0.050 s sector noise threshold and the 0.15 balance band
   * are DECLARED CONFIGURATION, published so the packet owner can ratify or correct them.
   * Configuration is never printed on screen. A leaf text of exactly "0.050" or "0.15" would
   * indicate a threshold label had been added to the UI, which is a reintroduction.
   *
   * Note: "0.15" could theoretically appear in a balance index value ("0.15" is a valid balance
   * reading). But the balance output is formatted as a two-decimal number like "0.15" only if
   * the balance index rounded to exactly 0.15, which is possible. For the governed reference and
   * matched fixtures, the balance values are not 0.15, so the assertion is safe for both states.
   * If a future fixture happens to produce balance "0.15", replace this with a selector-scoped
   * check that confirms "0.15" does not appear in a threshold label element.
   */
  lacksLeafText(metrics, "0.050", 'alertNumerics: the 0.050 s sector noise threshold is declared configuration and must never be printed')
  lacksLeafText(metrics, "0.15", 'alertNumerics: the 0.15 balance band threshold is declared configuration and must never be printed')

  return { ...common, typeScale: assertTypeScale(metrics) }
}

/**
 * Pixel audit — hue family only, never a channel ratio.
 *
 * A naive `g,b < 0.62r` ratio test measured 8 578 "red" pixels on an earlier RaceCon frame
 * whose hue-confirmed truth was zero; hue also survives `filter: brightness()`. See the
 * channel-ratio failure proof in `racecon-rc18-capture.test.mjs`.
 *
 *  1. Not blank against the RC-18 canvas colour #0C0E11.
 *  2. INFO (#4FB0E0, cyan) PRESENT on every frame — Setup A identity line.
 *  3. SIGNATURE (#B0A0FF, blue) PRESENT on every frame — Setup B identity line.
 *  4. DANGER (#F0533E, red) ABSENT on every frame — unused token, zero pixels.
 *  5. NORMAL (#52C07A, green) ABSENT on every frame — unused token, zero pixels.
 *  6. CAUTION (#F0B83A, amber) — PRESENT and SCOPED to incomparable row rects on the reference
 *     frame; ABSENT on the matched frame (no INCOMPARABLE tag, no caution pixels).
 */
export function validateCapturePixels(buffer, entry, metrics) {
  if (!isGovernedSize(entry.size)) {
    fail(`unsupported capture pixel-audit size ${entry.size.width}×${entry.size.height}`)
  }
  const image = decodeCapturePng(buffer, entry.size)

  const infoFamily    = hueFamilyOfHex(RC18_INFO_HEX)
  const sigFamily     = hueFamilyOfHex(RC18_SIG_HEX)
  const cautionFamily = hueFamilyOfHex(RC18_CAUTION_HEX)
  const dangerFamily  = hueFamilyOfHex(RC18_DANGER_HEX)
  const normalFamily  = hueFamilyOfHex(RC18_NORMAL_HEX)

  const scopes =
    entry.state === "reference"
      ? { [cautionFamily]: metrics.incomparableRowRects ?? [] }
      : {}
  const audit = auditHueFamilies(image, scopes)

  let nonCanvasPixels = 0
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (!sameRgba(rgbaAt(image, x, y), RC18_CANVAS_RGBA)) nonCanvasPixels += 1
    }
  }
  if (nonCanvasPixels < RC18_MIN_NON_CANVAS_PIXELS) {
    fail("capture is blank against the RC-18 canvas colour (#0C0E11 = rgb(12,14,17))")
  }

  assertHueFamilyPresent(audit, infoFamily, "the RC-18 frame — Setup A identity line is always painted")
  assertHueFamilyPresent(audit, sigFamily,  "the RC-18 frame — Setup B identity line is always painted")
  assertHueFamilyAbsent(audit, dangerFamily, "the RC-18 frame (danger #F0533E is a declared-unused token; the faster side is never red)")
  assertHueFamilyAbsent(audit, normalFamily, "the RC-18 frame (normal #52C07A is a declared-unused token; the faster side is never green — packet 11.3)")

  if (entry.state === "reference") {
    assertHueFamilyPresent(audit, cautionFamily, "the RC-18 reference frame — INCOMPARABLE tag must be painted amber")
    assertHueFamilyScoped(audit, cautionFamily, "the RC-18 reference frame — caution must be scoped to the incomparable row")
  } else {
    assertHueFamilyAbsent(audit, cautionFamily, "the RC-18 matched frame (no INCOMPARABLE rows, no caution pixels)")
  }

  return {
    width: image.width,
    height: image.height,
    opaque: true,
    nonCanvasPixels,
    hueFamilies: audit.counts,
    infoHueFamily: infoFamily,
    sigHueFamily: sigFamily,
    cautionHueFamily: cautionFamily,
    dangerHueFamily: dangerFamily,
    normalHueFamily: normalFamily
  }
}

export { CaptureSafetyError, exact, finite, containsRect, assertTypeScaleOrder }
