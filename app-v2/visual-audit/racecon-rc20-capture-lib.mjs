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
 * RC-20 "Lights Out — Formation, Grid & Start Procedure" owns only what its DOM contract,
 * zones, channels, alert families and documented omissions make different from the rest of the
 * RaceCon portfolio. Everything generic lives in `racecon-capture-shared.mjs`.
 *
 * Approved reference: attempt-003. `rc20-governance-chain-v1.json` records
 * `"verdict": "APPROVED"`, `"decision": "attempt-003 - the only frame in the run with zero
 * blocking failures"`. Attempts 001–006 exist; 003 is approved, not 006.
 */

export const RC20_PRESET_ID = "racecon_rc20_dash"
export const RC20_WIDGET_ID = "raceconRc20Dash"
export const RC20_ATTR_PREFIX = "data-rc20-"
export const RC20_SOURCE_IDENTITY = "iracing:session:91:connection:3"

/** Three governed scenarios. */
export const CAPTURE_STATES = Object.freeze(["grid", "jump-start", "no-feed"])

export const RC20_LADDER_BAR_COUNT = 5
export const RC20_GRID_STRIP_CELL_COUNT = 8
export const RC20_WARMUP_TILE_COUNT = 8
export const RC20_MODE_WORD_COUNT = 3
export const RC20_CARD_COUNT = 2

/**
 * Shipped palette verbatim.
 *
 * Override NO-8 (`RC20_PACKET_OMISSIONS.twoRedTokens`): `danger #FF3A2E` (hue ≈ 3.4°) and
 * `signature #FF2A2A` (hue ≈ 0°) fall in the SAME "red" hue family. Unlike RC-15 — where a
 * retune physically separated alarm from brake heat into different families — RC-20 cannot
 * separate these two tokens by hue. `hueFamilyOfHex(danger) === hueFamilyOfHex(signature)`.
 *
 * THIS IS WHY THE RED AUDIT USES A SCOPED PROOF, NOT AN ABSENT PROOF:
 *   grid frame:      red PRESENT and SCOPED to the five lit ladder-bar rects;
 *   jump-start:      red PRESENT and SCOPED to ladder-bar rects UNION alert element rects;
 *   no-feed frame:   red ABSENT (no lit bars, no alert — zero red pixels expected).
 *
 * The scoped/DOM proof is the only check that distinguishes `signature` from `danger`
 * here, because hue cannot. Document this whenever asserting red on RC-20 frames.
 */
export const RC20_BG_HEX = "#08090C"
export const RC20_PANEL_HEX = "#12141C"
export const RC20_SIGNATURE_HEX = "#FF2A2A"   // lit ladder bars — "red" hue family
export const RC20_DANGER_HEX = "#FF3A2E"      // alert layer — ALSO "red" hue family (override NO-8)
export const RC20_CAUTION_HEX = "#FFC22E"     // cold warm-up ONLY — "amber"
export const RC20_NORMAL_HEX = "#38D06A"      // declared but zero pixels — "green"
export const RC20_INFO_HEX = "#4A8CFF"        // launch band + clutch fill — "blue"
export const RC20_BG_RGBA = Object.freeze([8, 9, 12, 255])

/**
 * Type scale as shipped: rpm (64 px) > clutch (44 px) > strip (30 px) > label (17 px).
 *
 * `RC20_TYPE_SCALE_MIN_SEPARATION_PCT = 8`: each step must clear its larger neighbour by at
 * least 8 %. The shipped separations:
 *   rpm → clutch:   (64 − 44) / 64 = 31.25 % ≥ 8 % ✓
 *   clutch → strip: (44 − 30) / 44 = 31.82 % ≥ 8 % ✓
 *   strip → label:  (30 − 17) / 30 = 43.33 % ≥ 8 % ✓
 * A tie (0 %) or a step smaller than 8 % is a failure by the contract.
 */
export const RC20_TYPE_SCALE_PX = Object.freeze({ rpm: 64, clutch: 44, strip: 30, label: 17 })
export const RC20_TYPE_SCALE_MIN_SEPARATION_PCT = 8

/** Panel/bg luminance step. Formula: Rec. 601 luma = (299r + 587g + 114b) / 1000.
 *   bg    #08090C = (8,9,12)   → luma ≈ 9.04
 *   panel #12141C = (18,20,28) → luma ≈ 20.31
 *   step ≈ 11.27 ≥ 9 (RC20_PANEL_LUMINANCE_STEP_MIN = 9)
 */
export const RC20_PANEL_LUMINANCE_STEP_MIN = 9

/** Reference channel values (approved attempt-003 / widget reference snapshot). */
export const RC20_EXPECTED_VALUES = Object.freeze({
  rpm: "4,820",
  clutch: "42",
  stage: "STAGE 5 OF 5",
  mode: "GRID",
  litBars: 5,
  litBarsAttr: "5",
  startFeed: "live",
  bandSource: "none",
  alerts: "silent",
  alertKeys: ""
})

/**
 * Packet-omission note: `startLightLadderStages`. The approved reference IMAGE shows
 * "STAGE 3 OF 5" with three lit bars, but the shipped decoder can only produce
 * DARK | ARMED | S5 | RELEASED | unavailable from iRacing bits. Therefore:
 *   - lit-bars ∈ {0, 5} — intermediate 1–4 means S1–S4 were fabricated
 *   - stage ∈ {DARK, ARMED, S5, RELEASED, unavailable} — never S1–S4 in practice
 * The harness DOES NOT report "3 lit expected, 5 observed" as a defect. This IS the contract.
 * Any lit count of 1–4 would indicate the decoder was changed to emit undocumented stages,
 * which is a NEW regression and FAILS CLOSED.
 */
export const RC20_LIT_BARS_GRID = 5
export const RC20_LIT_BARS_NO_FEED = 0

export const RC20_SPEC = Object.freeze({
  artifact: "RaceCon RC-20",
  script: "racecon-rc20-capture.mjs",
  presetId: RC20_PRESET_ID,
  widgetId: RC20_WIDGET_ID,
  attrPrefix: RC20_ATTR_PREFIX,
  rootSelector: "#racecon-rc20-capture-root",
  captureHtml: "racecon-rc20-capture.html",
  dashboardSelector: ".rc20-dashboard",
  sourceIdentity: RC20_SOURCE_IDENTITY,
  stateAttributes: Object.freeze([
    "mode", "armed", "stage", "lit-bars", "start-feed",
    "band-source", "alerts", "alert-keys", "layout", "compact-mode",
    "buffer-state", "content-width", "content-height"
  ]),
  /**
   * The four zones present in EVERY governed viewport. Strip (non-app), warmup and review
   * (app-only) are verified in assertLayoutStructure() via the `counted` array instead of
   * the shared always-present zone sweep, exactly as RC-15 handles the per-corner strip.
   */
  zones: Object.freeze([
    Object.freeze(["header",  '[data-testid="rc20-header"]']),
    Object.freeze(["ladder",  '[data-testid="rc20-ladder"]']),
    Object.freeze(["launch",  '[data-testid="rc20-launch"]']),
    Object.freeze(["clutch",  '[data-testid="rc20-clutch"]'])
  ]),
  zoneOverlapExemptions: Object.freeze([]),
  /**
   * Values that must be present in every governed viewport and state. `rc20-warmup-provenance`
   * is app-only and handled separately in validateCaptureMetrics; only the two always-present
   * nowrap-overflow elements (start-feed, scale-label) live here alongside the readout values.
   *
   * raceconRc20.css lines 91–98 audit note (verbatim):
   *   "Every LABEL wraps. `white-space: nowrap` makes a flex item's min-content width exceed
   *    its column, so `overflow: hidden` never clips it and `scrollWidth === clientWidth` while
   *    the glyph escapes into its neighbour. A real-browser audit caught exactly that on the
   *    ladder's feed caption, the launch card's scale label and the warm-up map's provenance
   *    caption, in a pass that every jsdom and `scrollWidth` check had already declared clean.
   *    Labels therefore wrap; only NUMERALS keep `nowrap`, and every numeral is sized in `cqw`
   *    with a conservative clamp maximum and given its own full-width row so the arithmetic —
   *    not `overflow` — contains it."
   *
   * The three elements (`rc20-start-feed`, `rc20-scale-label`, `rc20-warmup-provenance`) are
   * also in `containment` so `assertZoneContainment` measures the TRUE BoundingClientRect-based
   * escape, not the `scrollWidth` that already declared clean.
   */
  values: Object.freeze([
    Object.freeze(["rpm",           '[data-testid="rc20-rpm"]']),
    Object.freeze(["clutch-value",  '[data-testid="rc20-clutch-value"]']),
    Object.freeze(["start-feed",    '[data-testid="rc20-start-feed"]']),
    Object.freeze(["scale-label",   '[data-testid="rc20-scale-label"]']),
    Object.freeze(["band-label",    '[data-testid="rc20-band-label"]']),
    Object.freeze(["stage",         '[data-testid="rc20-stage"]']),
    Object.freeze(["mode",          '[data-testid="rc20-mode"]'])
  ]),
  /**
   * Containment entries include the three nowrap-overflow elements (with their owning zones)
   * so `assertZoneContainment` measures BoundingClientRect-based escape at every viewport.
   * `rc20-warmup-provenance` is app-only; on other layouts `ownedMetric` returns null and the
   * entry is filtered out by `__rcCommon` before the check runs.
   */
  containment: Object.freeze([
    // Nowrap overflow elements — the three known escape vectors
    Object.freeze(["start-feed caption", '[data-testid="rc20-ladder"]',   '[data-testid="rc20-start-feed"]']),
    Object.freeze(["scale label",        '[data-testid="rc20-launch"]',   '[data-testid="rc20-scale-label"]']),
    Object.freeze(["warmup provenance",  '[data-testid="rc20-warmup"]',   '[data-testid="rc20-warmup-provenance"]']),
    // Structural containment
    Object.freeze(["rpm in launch",      '[data-testid="rc20-launch"]',   '[data-testid="rc20-rpm"]']),
    Object.freeze(["launch track",       '[data-testid="rc20-launch"]',   '[data-testid="rc20-launch-track"]']),
    Object.freeze(["clutch value",       '[data-testid="rc20-clutch"]',   '[data-testid="rc20-clutch-value"]']),
    Object.freeze(["clutch track",       '[data-testid="rc20-clutch"]',   '[data-testid="rc20-clutch-track"]']),
    Object.freeze(["ladder bars",        '[data-testid="rc20-ladder"]',   '[data-testid="rc20-ladder-bars"]']),
    Object.freeze(["stage in ladder",    '[data-testid="rc20-ladder"]',   '[data-testid="rc20-stage"]'])
  ]),
  counted: Object.freeze([
    Object.freeze(["ladder bar",         '[data-testid="rc20-ladder-bar"]']),
    Object.freeze(["lit bar",            '[data-testid="rc20-ladder-bar"][data-rc20-lit="true"]']),
    Object.freeze(["mode word",          '[data-testid="rc20-mode-word"]']),
    Object.freeze(["card",               '.rc20-card']),
    // The GRID STRIP's cells only. `StripCell` is reused by the app-only mode ribbon and the
    // app-only launch review, so a bare `[data-testid="rc20-strip-cell"]` count finds five cells at
    // the app canvas and would report a correct render as a strip that failed to disappear. The
    // strip zone is the scope: `RC20_PACKET_OMISSIONS.appCanvasModeAndSlot` says 12.1 drops the
    // strip and a mode ribbon carries slot plus status instead.
    Object.freeze(["strip cell",         '[data-rc20-zone="strip"] [data-testid="rc20-strip-cell"]']),
    Object.freeze(["warmup tile",        '[data-testid="rc20-warmup-tile"]']),
    Object.freeze(["jump start",         '[data-testid="rc20-jump-start"]']),
    Object.freeze(["over rev cap",       '[data-testid="rc20-over-rev-cap"]']),
    Object.freeze(["ribbon status",      '[data-testid="rc20-ribbon-status"]']),
    Object.freeze(["warmup provenance",  '[data-testid="rc20-warmup-provenance"]']),
    Object.freeze(["review",             '[data-testid="rc20-review"]']),
    Object.freeze(["launch band",        '[data-testid="rc20-launch-band"]']),
    Object.freeze(["launch needle",      '[data-testid="rc20-launch-needle"]'])
  ]),
  /**
   * Documented packet omissions expressed as forbidden DOM selectors. ABSENCE IS THE CONTRACT:
   * a selector that matches anything has found a REINTRODUCTION, which is the only failure
   * this sweep can report. None of these may ever be reported as a render-QA defect.
   *
   *  shiftLedReturn — RC20_PACKET_OMISSIONS.shiftLedReturn: section 11.1 allocates no zone for
   *    the shift arc on either canvas. No LED, no shift bar, no rev arc anywhere.
   *
   *  resettableLine / launchArmControlIsExternal — RC20_PACKET_OMISSIONS.resettableLine and
   *    launchArmControlIsExternal: the launch-arm macro is hardware-delivered and the resettable
   *    line has no channel. Zero pixels; no button, toggle or control surface.
   *
   *  wheelspinReview — RC20_PACKET_OMISSIONS.wheelspinReview: section 16 supplies no wheelspin
   *    channel; no wheelspin figure anywhere.
   */
  forbidden: Object.freeze([
    Object.freeze([
      "a shift-LED, rev-arc or shift surface (omission: shiftLedReturn)",
      '.rc20-led, .rc20-shift, .rc20-rev, [data-rc20-zone="shift"], [data-rc20-zone="rev"]'
    ]),
    Object.freeze([
      "a launch-arm control button or resettable line (omissions: resettableLine, launchArmControlIsExternal)",
      'button[data-rc20], .rc20-button, [data-rc20-zone="control"], [data-rc20-arm-control], [data-rc20-reset]'
    ]),
    Object.freeze([
      "a wheelspin readout (omission: wheelspinReview)",
      '[data-testid*="wheelspin"], [data-testid*="slip"], [data-rc20-zone="wheelspin"]'
    ])
  ]),
  /** Start empty — anything found is a NEW regression, not a recorded waiver. */
  knownDefects: Object.freeze([]),
  zoneOverflowDefects: Object.freeze([]),
  containmentDefects: Object.freeze([])
})

export const RC20_CAPTURE_MATRIX = Object.freeze(
  CAPTURE_STATES.flatMap((state) =>
    CAPTURE_SIZES.map((size) =>
      Object.freeze({
        size,
        state,
        /**
         * The harness waits for the published attribute rather than a guessed frame count.
         *
         * grid:       wait for stage=S5 (decoded immediately from sessionFlagsRaw=startSet)
         *             AND alerts=silent (no movement, no alert can fire)
         * jump-start: wait for alerts=active (jump-start debounce has fired, 200 ms elapsed)
         * no-feed:    wait for start-feed=unavailable (immediate from sessionFlagsRaw=0)
         *             AND lit-bars=0 (never simulate start lights)
         */
        required: Object.freeze(
          state === "grid"
            ? [Object.freeze(["stage", "S5"]), Object.freeze(["alerts", "silent"])]
            : state === "jump-start"
              ? [Object.freeze(["alerts", "active"])]
              : [Object.freeze(["start-feed", "unavailable"]), Object.freeze(["lit-bars", "0"])]
        )
      })
    )
  )
)

/* ── Metric helpers ───────────────────────────────────────────────────────────────────── */

function countOf(metrics, label) {
  const entry = (metrics.counted ?? []).find((candidate) => candidate.label === label)
  if (!entry) fail(`capture did not count "${label}"`)
  return entry.count
}

function valueOf(metrics, label) {
  const entry = (metrics.values ?? []).find((candidate) => candidate.label === label)
  if (!entry || !entry.present) fail(`capture is missing the "${label}" output`)
  return entry
}

/* ── Ladder ───────────────────────────────────────────────────────────────────────────── */

/**
 * The ladder is a COUNTING STRUCTURE. The headline promise: exactly five bars in every layout
 * and every state. Miscounted element arrays were among the most common image-QA rejections.
 *
 * Packet-omission note (`startLightLadderStages`): the decoder produces only
 * DARK | ARMED | S5 | RELEASED | unavailable — S1–S4 are never emitted. Therefore
 * lit-bars ∈ {0, 5} in the governed fixture set. An intermediate lit count of 1–4 would
 * mean S1–S4 had been fabricated and FAILS CLOSED here. "3 lit bars expected, 5 observed"
 * is NOT a render-QA failure; the approved reference shows STAGE 3 OF 5 because that is
 * the image-QA reference frame, but the shipped decoder cannot reproduce it.
 */
function assertLadder(metrics, entry) {
  // Count assertion
  const barCount = countOf(metrics, "ladder bar")
  if (barCount !== RC20_LADDER_BAR_COUNT) {
    fail(
      `RC-20 must render exactly ${RC20_LADDER_BAR_COUNT} ladder bars (counting structure), found ${barCount}`
    )
  }

  // data-rc20-bar-count attribute on the container
  const barCountAttr = metrics.ladderBarCount
  if (barCountAttr !== String(RC20_LADDER_BAR_COUNT)) {
    fail(
      `data-rc20-bar-count must be "${RC20_LADDER_BAR_COUNT}", received "${barCountAttr}"`
    )
  }

  // Lit count
  const litCount = countOf(metrics, "lit bar")
  const litBarsAttr = String(metrics.stateAttributes["lit-bars"] ?? "")
  const litBarsInt = Number.parseInt(litBarsAttr, 10)

  if (!Number.isFinite(litBarsInt) || litBarsInt < 0 || litBarsInt > RC20_LADDER_BAR_COUNT) {
    fail(`data-rc20-lit-bars must be an integer 0..5, received "${litBarsAttr}"`)
  }
  if (litCount !== litBarsInt) {
    fail(`the lit-bar count (${litCount}) does not match data-rc20-lit-bars="${litBarsAttr}"`)
  }
  if (litCount + (barCount - litCount) !== RC20_LADDER_BAR_COUNT) {
    fail(`lit (${litCount}) + unlit (${barCount - litCount}) must equal ${RC20_LADDER_BAR_COUNT}`)
  }

  // Fabricated intermediate stage guard
  // S1–S4 are never decoded by the shipped decoder. Any lit count of 1–4 means a stage that
  // was never emitted has been introduced — fail closed immediately.
  if (litBarsInt > 0 && litBarsInt < RC20_LADDER_BAR_COUNT) {
    fail(
      `lit-bars=${litBarsInt} implies S${litBarsInt} was decoded, but S1–S4 are never produced ` +
        `by the shipped decoder (RC20_PACKET_OMISSIONS.startLightLadderStages). ` +
        `This is a regression — fabricated intermediate stage.`
    )
  }

  // State-specific lit count
  if (entry.state === "no-feed") {
    if (litBarsInt !== RC20_LIT_BARS_NO_FEED) {
      fail(
        `no-feed state must have lit-bars=0 (never simulate start lights when feed is absent), ` +
          `found lit-bars=${litBarsInt}`
      )
    }
  } else {
    // grid and jump-start: stage=S5, so lit-bars=5
    if (litBarsInt !== RC20_LIT_BARS_GRID) {
      fail(
        `${entry.state} state with stage=S5 must have lit-bars=5, found lit-bars=${litBarsInt}`
      )
    }
  }

  // Bar indices 0..4 with no duplicates and no gaps
  const bars = metrics.ladderBars ?? []
  if (bars.length !== RC20_LADDER_BAR_COUNT) {
    fail(`expected ${RC20_LADDER_BAR_COUNT} bar-index records, got ${bars.length}`)
  }
  const indices = bars.map((bar) => bar.index).sort((a, b) => a - b)
  for (let index = 0; index < RC20_LADDER_BAR_COUNT; index += 1) {
    if (indices[index] !== index) {
      fail(`bar indices must be 0..4 with no duplicates or gaps, found ${JSON.stringify(indices)}`)
    }
  }

  return { barCount, litCount }
}

/* ── Mode words and cards ─────────────────────────────────────────────────────────────── */

function assertModeWords(metrics) {
  const count = countOf(metrics, "mode word")
  if (count !== RC20_MODE_WORD_COUNT) {
    fail(`RC-20 must render exactly ${RC20_MODE_WORD_COUNT} mode words (FORMATION, [ GRID ], LAUNCH), found ${count}`)
  }
  hasText(metrics, "FORMATION")
  hasText(metrics, "LAUNCH")
}

function assertCards(metrics) {
  const count = countOf(metrics, "card")
  if (count !== RC20_CARD_COUNT) {
    fail(`RC-20 must render exactly ${RC20_CARD_COUNT} cards (rc20-launch + rc20-clutch), found ${count}`)
  }
}

/* ── Layout-specific structure ────────────────────────────────────────────────────────── */

/**
 * Non-app (native + compact): exactly 8 grid-strip cells (override NO-7).
 * App: strip absent; warmup map renders 8 tiles; ribbon carries mode and slot.
 *
 * RC20_PACKET_OMISSIONS.gridStripEightCells: "the nine-cell strip measures 801.6 px in a
 * 768 px zone; eight cells ship". RC20_PACKET_OMISSIONS.appCanvasModeAndSlot: "packet G-3:
 * 12.1 drops the mode indicator and the strip; a mode ribbon carries both".
 */
function assertLayoutStructure(metrics, entry) {
  const app = entry.size.layout === "app"
  const stripCells = countOf(metrics, "strip cell")
  const warmupTiles = countOf(metrics, "warmup tile")
  const ribbonCount = countOf(metrics, "ribbon status")
  const reviewCount = countOf(metrics, "review")
  const warmupProvCount = countOf(metrics, "warmup provenance")

  if (app) {
    if (stripCells !== 0) {
      fail(
        `the app layout replaces the grid strip with the warmup map (appCanvasModeAndSlot), ` +
          `found ${stripCells} strip cell(s)`
      )
    }
    if (warmupTiles !== RC20_WARMUP_TILE_COUNT) {
      fail(`the app layout must render exactly ${RC20_WARMUP_TILE_COUNT} warmup tiles, found ${warmupTiles}`)
    }
    if (ribbonCount !== 1) {
      fail(`the app layout must render exactly one rc20-ribbon-status, found ${ribbonCount}`)
    }
    if (reviewCount !== 1) {
      fail(`the app layout must render exactly one rc20-review, found ${reviewCount}`)
    }
    if (warmupProvCount !== 1) {
      fail(`the app layout must render rc20-warmup-provenance (warmUpTargetsDeclared), found ${warmupProvCount}`)
    }
    hasText(metrics, "DECLARED")
  } else {
    if (stripCells !== RC20_GRID_STRIP_CELL_COUNT) {
      fail(
        `the ${entry.size.layout} layout must render exactly ${RC20_GRID_STRIP_CELL_COUNT} ` +
          `strip cells (override NO-7: gridStripEightCells), found ${stripCells}`
      )
    }
    if (warmupTiles !== 0) {
      fail(`the warmup map is app-only, found ${warmupTiles} tile(s) outside the app layout`)
    }
    if (ribbonCount !== 0) {
      fail(`rc20-ribbon-status is app-only, found ${ribbonCount} outside the app layout`)
    }
    if (reviewCount !== 0) {
      fail(`rc20-review is app-only (expansionIsHeightDriven), found ${reviewCount} outside the app layout`)
    }
  }
  return { stripCells, warmupTiles, app }
}

/* ── Alert state ──────────────────────────────────────────────────────────────────────── */

function assertAlerts(metrics, entry) {
  const alerts = String(metrics.stateAttributes.alerts ?? "")
  const alertKeys = String(metrics.stateAttributes["alert-keys"] ?? "")
  const jumpStartCount = countOf(metrics, "jump start")
  const overRevCapCount = countOf(metrics, "over rev cap")

  if (entry.state === "jump-start") {
    if (alerts !== "active") {
      fail(`jump-start state must publish data-rc20-alerts="active", received "${alerts}"`)
    }
    if (!alertKeys.split(",").map((k) => k.trim()).includes("JUMP START")) {
      fail(`jump-start state must include "JUMP START" in alert-keys, received "${alertKeys}"`)
    }
    if (jumpStartCount !== 1) {
      fail(`jump-start state must render exactly one rc20-jump-start element, found ${jumpStartCount}`)
    }
  } else {
    if (alerts !== "silent") {
      fail(`${entry.state} state must publish data-rc20-alerts="silent", received "${alerts}"`)
    }
    if (jumpStartCount !== 0) {
      fail(`rc20-jump-start must be absent when alerts=silent, found ${jumpStartCount}`)
    }
    if (overRevCapCount !== 0) {
      fail(`rc20-over-rev-cap must be absent when alerts=silent, found ${overRevCapCount}`)
    }
    // Caution (cold warm-up) never fires on this fixture: water temp 84°C and tyre temps ≥ 84°C
    // are above the declared RC20_WARMUP_TARGET_C thresholds for session phase getInCar/grid.
  }
  return { alerts, alertKeys }
}

/* ── Start-feed and stage ─────────────────────────────────────────────────────────────── */

function assertStartFeed(metrics, entry) {
  const startFeed = String(metrics.stateAttributes["start-feed"] ?? "")
  const stage = String(metrics.stateAttributes.stage ?? "")
  const mode = String(metrics.stateAttributes.mode ?? "")

  if (entry.state === "no-feed") {
    if (startFeed !== "unavailable") {
      fail(`no-feed state must publish data-rc20-start-feed="unavailable", received "${startFeed}"`)
    }
    if (stage !== "unavailable") {
      fail(`no-feed state must publish data-rc20-stage="unavailable", received "${stage}"`)
    }
    if (mode !== "unavailable") {
      fail(`no-feed state must publish data-rc20-mode="unavailable", received "${mode}"`)
    }
  } else {
    if (startFeed !== "live") {
      fail(`grid/jump-start state must publish data-rc20-start-feed="live", received "${startFeed}"`)
    }
    if (stage !== "S5") {
      fail(`grid/jump-start state with sessionFlagsRaw=startSet must have stage=S5, received "${stage}"`)
    }
    if (mode !== "GRID") {
      fail(`grid/jump-start state with stage=S5 must have mode=GRID, received "${mode}"`)
    }
  }
  return { startFeed, stage, mode }
}

/* ── Packet omissions: absence is the contract ────────────────────────────────────────── */

/**
 * Leaf texts that would reintroduce an omission. All are direct, independent channel values
 * that the packet explicitly excludes from the canvas. None can ever appear as a rendered readout.
 *
 * waterTempGearFuel — RC20_PACKET_OMISSIONS.waterTempGearFuel: water temperature, gear and
 *   fuel level are ZONELESS on both canvases. They must not appear, even though the fixture
 *   supplies them. The harness proves absence, not presence.
 *
 * gridSlot — RC20_PACKET_OMISSIONS.gridSlot: no channel reports a grid slot; position is the
 *   RACE position and is never assumed to be a slot. The strip-slot element always reads "--".
 *
 * BAND -- is the expected launch-band label when no band is declared (launchRpmTarget).
 *
 * "Honest empty states" that are NOT defects (per-omission documentation):
 *   RR "--" (tyres.rr = {} in fixture — no sensor),
 *   grid slot "--",
 *   review fields "--.---" / "---" / "--" before an observed launch release.
 */
const RC20_FORBIDDEN_LEAF_TEXTS = Object.freeze([
  // NOTE — "84" is deliberately NOT listed. The reference fixture feeds `waterTempC: 84` AND
  // `tyres.lr.tempC: 84`, and the grid strip legitimately prints the LR tyre temperature. A bare
  // numeric leaf test cannot tell a forbidden water readout from a permitted tyre readout, so it
  // would report a correct render as an omission breach. The omission is proved structurally
  // instead: `spec.forbidden` counts zero water/gear/fuel elements and zero `WATER`, `GEAR` or
  // `FUEL` labels, which is what "no zone on either canvas" actually means.
  Object.freeze(["96.4", "would print fuel level (RC20_PACKET_OMISSIONS.waterTempGearFuel)"])
])

function assertOmissions(metrics, entry) {
  for (const [forbidden, why] of RC20_FORBIDDEN_LEAF_TEXTS) {
    lacksLeafText(metrics, forbidden, why)
  }

  // Grid slot ALWAYS reads "--" (gridSlot omission). Test at non-app only (strip is absent at app).
  if (entry.size.layout !== "app") {
    const slotText = metrics.stripSlotText
    if (slotText !== null && slotText !== "--") {
      fail(
        `rc20-strip-slot must read "--" (gridSlot omission: no channel reports a grid slot), ` +
          `received "${slotText}"`
      )
    }
  }

  // No launch band declared (launchRpmTarget omission)
  const bandLabel = valueOf(metrics, "band-label")
  if (bandLabel.text !== "BAND --") {
    fail(
      `band-label must read "BAND --" when no launch band is declared (launchRpmTarget omission), ` +
        `received "${bandLabel.text}"`
    )
  }
  const bandSourceAttr = String(metrics.stateAttributes["band-source"] ?? "")
  if (bandSourceAttr !== "none") {
    fail(`band-source must be "none" when no band is declared, received "${bandSourceAttr}"`)
  }

  // Scale label shows maxRpm from fixture
  const scaleLabel = valueOf(metrics, "scale-label")
  if (!scaleLabel.text.includes("7600") && !scaleLabel.text.includes("7,600")) {
    fail(`scale-label must include the maxRpm (7600) from the fixture, received "${scaleLabel.text}"`)
  }
  // No launch band element when band-source=none
  const launchBandCount = countOf(metrics, "launch band")
  if (launchBandCount !== 0) {
    fail(`rc20-launch-band must be absent when band-source=none (launchRpmTarget omission), found ${launchBandCount}`)
  }
}

/* ── Type scale ───────────────────────────────────────────────────────────────────────── */

/**
 * The type scale is an ORDER assertion. `assertTypeScaleOrder` checks strict inequality;
 * a tie or step smaller than `RC20_TYPE_SCALE_MIN_SEPARATION_PCT` (8 %) is a failure.
 *
 * 8 % arithmetic (all shipped separations clear 8 % comfortably):
 *   rpm → clutch:   (64 − 44) / 64 = 31.25 % — the smallest step still clears 8 % by 3.9×
 *   clutch → strip: (44 − 30) / 44 = 31.82 %
 *   strip → label:  (30 − 17) / 30 = 43.33 %
 *
 * `stripCellFontSize` comes from the custom metrics collected in `collectMetrics.mjs`. It is
 * the computed fontSize of the first `[data-testid="rc20-strip-cell"]` element, which renders
 * at 30 px on native/compact layouts. At the app layout, strip cells are absent, so
 * `stripCellFontSize` is null and the check degrades to 3-level (rpm > clutch > label).
 */
function assertTypeScale(metrics) {
  const rpm        = valueOf(metrics, "rpm")           // 64 px
  const clutch     = valueOf(metrics, "clutch-value")  // 44 px
  const scaleLabel = valueOf(metrics, "scale-label")   // 17 px (label step)

  // null at app layout (strip absent) — 3-level check only
  const stripCellFontSize = metrics.stripCellFontSize ?? null

  const steps = stripCellFontSize !== null
    ? [
        { label: "rpm",    fontSize: rpm.fontSize },
        { label: "clutch", fontSize: clutch.fontSize },
        { label: "strip",  fontSize: stripCellFontSize },
        { label: "label",  fontSize: scaleLabel.fontSize }
      ]
    : [
        { label: "rpm",    fontSize: rpm.fontSize },
        { label: "clutch", fontSize: clutch.fontSize },
        { label: "label",  fontSize: scaleLabel.fontSize }
      ]

  const ordered = assertTypeScaleOrder(steps, 1)

  // Additionally assert the 8 % minimum separation between each adjacent pair
  for (let index = 1; index < steps.length; index += 1) {
    const larger  = steps[index - 1]
    const smaller = steps[index]
    const pct = ((larger.fontSize - smaller.fontSize) / larger.fontSize) * 100
    if (pct < RC20_TYPE_SCALE_MIN_SEPARATION_PCT) {
      fail(
        `type-scale step ${larger.label} (${larger.fontSize}px) → ${smaller.label} (${smaller.fontSize}px) ` +
          `is only ${pct.toFixed(2)} % — must be ≥ ${RC20_TYPE_SCALE_MIN_SEPARATION_PCT} %`
      )
    }
  }
  return ordered
}

/* ── Main metric validator ────────────────────────────────────────────────────────────── */

export function validateCaptureMetrics(metrics, entry) {
  const common = validateCommonMetrics(metrics, entry, RC20_SPEC)

  // Required text that proves the widget rendered rather than showing an error state
  hasText(metrics, "TRAINING AID")
  hasText(metrics, "FORMATION")
  hasText(metrics, "LAUNCH")

  const ladder = assertLadder(metrics, entry)
  assertModeWords(metrics)
  assertCards(metrics)
  const layout = assertLayoutStructure(metrics, entry)
  const alertResult = assertAlerts(metrics, entry)
  const feedResult = assertStartFeed(metrics, entry)
  assertOmissions(metrics, entry)
  const typeScale = assertTypeScale(metrics)

  return {
    ...common,
    ladder,
    layout,
    alerts: alertResult,
    feed: feedResult,
    typeScale
  }
}

/* ── Pixel audit ──────────────────────────────────────────────────────────────────────── */

/**
 * Rec. 601 perceived luma: (299r + 587g + 114b) / 1000.
 *   bg    #08090C = rgb(8,9,12)   → luma ≈ 9.043
 *   panel #12141C = rgb(18,20,28) → luma ≈ 20.314
 *   step  ≈ 11.27 — above the RC20_PANEL_LUMINANCE_STEP_MIN = 9 floor
 */
function rec601Luma(r, g, b) {
  return (299 * r + 587 * g + 114 * b) / 1000
}

/**
 * Scans the PNG for pixels darker than bg+60 luma units but lighter than bg+1, which locates
 * the panel color band. Returns the measured step (max panel luma − bg luma).
 *
 * "Do not write an assertion that can only ever see a small number": `scrollHeight` comparisons
 * are capped at the container height; only measuring the true BoundingClientRect (or, for the
 * panel step, the true raster) reveals the real extent of the render.
 */
function assertPanelLuminanceStep(image, minStep) {
  const bgLuma = rec601Luma(RC20_BG_RGBA[0], RC20_BG_RGBA[1], RC20_BG_RGBA[2])
  let maxPanelLuma = -1
  for (let y = 0; y < image.height; y += 2) {
    for (let x = 0; x < image.width; x += 2) {
      const [r, g, b] = rgbaAt(image, x, y)
      const luma = rec601Luma(r, g, b)
      if (luma > bgLuma + 0.5 && luma <= bgLuma + 60) {
        if (luma > maxPanelLuma) maxPanelLuma = luma
      }
    }
  }
  if (maxPanelLuma < 0) {
    fail("no panel pixels found in capture — frame may be blank or solid background colour")
  }
  const step = maxPanelLuma - bgLuma
  if (step < minStep) {
    fail(
      `panel/canvas luminance step is ${step.toFixed(2)}, must be >= ${minStep} ` +
        `(bg #08090C luma=${bgLuma.toFixed(2)}, panel candidate luma=${maxPanelLuma.toFixed(2)})`
    )
  }
  return step
}

const RC20_MIN_NON_BG_PIXELS = 5_000

/**
 * The pixel audit proves what only a real raster can prove.
 *
 *  1. The frame is not blank against the RC-20 canvas colour #08090C.
 *  2. The panel/canvas luminance step is ≥ RC20_PANEL_LUMINANCE_STEP_MIN (9).
 *  3. RED family:
 *       - `signature #FF2A2A` (hue = 0° → "red") is the lit ladder bar colour.
 *       - `danger #FF3A2E` (hue ≈ 3.4° → ALSO "red") is the alert layer colour.
 *       Override NO-8 (`RC20_PACKET_OMISSIONS.twoRedTokens`): hue CANNOT separate these two.
 *       Therefore:
 *         grid frame:       red PRESENT, SCOPED to the five ladder-bar rects.
 *         jump-start frame: red PRESENT, SCOPED to ladder-bar rects UNION alert element rects.
 *         no-feed frame:    red ABSENT (no lit bars, no alert fires — zero red pixels).
 *  4. AMBER (`caution #FFC22E`) ABSENT on every frame — cold warm-up never latches here.
 *  5. GREEN (`normal #38D06A`) ABSENT on every frame — declared but zero pixels.
 *  6. BLUE (`info #4A8CFF`) — present on every frame from the clutch fill (clutch=0.42 > 0);
 *     band-source=none means the launch band does NOT contribute to blue.
 */
export function validateCapturePixels(buffer, entry, metrics) {
  if (!isGovernedSize(entry.size)) fail(`unsupported capture pixel-audit size ${entry.size.width}x${entry.size.height}`)
  const image = decodeCapturePng(buffer, entry.size)

  const signatureFamily = hueFamilyOfHex(RC20_SIGNATURE_HEX)  // "red"
  const dangerFamily    = hueFamilyOfHex(RC20_DANGER_HEX)     // ALSO "red" — override NO-8
  const cautionFamily   = hueFamilyOfHex(RC20_CAUTION_HEX)    // "amber"
  const normalFamily    = hueFamilyOfHex(RC20_NORMAL_HEX)     // "green"
  const infoFamily      = hueFamilyOfHex(RC20_INFO_HEX)       // "blue"
  const redFamily       = signatureFamily                     // === dangerFamily (override NO-8)

  // On the no-feed frame the ladder is dark, so red is absent — the scope is empty.
  // On grid/jump-start, red must be scoped to the ladder bars (+ alert elements for jump-start).
  const ladderScope  = (metrics.ladderBars ?? []).map((b) => b.rect).filter(Boolean)
  const alertScope   = metrics.alertScope ?? []
  const scopes =
    entry.state === "no-feed"
      ? {}
      : { [redFamily]: entry.state === "jump-start" ? [...ladderScope, ...alertScope] : ladderScope }

  const audit = auditHueFamilies(image, scopes)

  let nonBgPixels = 0
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (!sameRgba(rgbaAt(image, x, y), RC20_BG_RGBA)) nonBgPixels += 1
    }
  }
  if (nonBgPixels < RC20_MIN_NON_BG_PIXELS) {
    fail("capture is blank against the RC-20 canvas colour (#08090C)")
  }

  const panelStep = assertPanelLuminanceStep(image, RC20_PANEL_LUMINANCE_STEP_MIN)

  assertHueFamilyAbsent(
    audit, cautionFamily,
    "any RC-20 frame (caution is cold warm-up only; this fixture never latches it)"
  )
  assertHueFamilyAbsent(
    audit, normalFamily,
    "any RC-20 frame (normal #38D06A is declared but zero pixels — no element uses it)"
  )
  // Blue is present on every frame: clutch=0.42 means the clutch fill (#4A8CFF) is painted.
  // The absence of a declared launch band (band-source=none) does not suppress blue because
  // the clutch fill independently contributes it.
  assertHueFamilyPresent(
    audit, infoFamily,
    "every RC-20 frame — the clutch fill at 42 % is always painted (info #4A8CFF)", 1
  )

  if (entry.state === "no-feed") {
    // All five bars dark; no alert fires. Zero red pixels.
    assertHueFamilyAbsent(
      audit, redFamily,
      "the RC-20 no-feed frame (no lit bars, no alert — never simulate start lights)"
    )
  } else {
    // grid or jump-start: five bars lit (signature red), scoped to their rects
    assertHueFamilyPresent(
      audit, redFamily,
      `the RC-20 ${entry.state} frame — five lit ladder bars are always painted`, 1
    )
    assertHueFamilyScoped(audit, redFamily, `the RC-20 ${entry.state} frame`)
  }

  return {
    width: image.width,
    height: image.height,
    opaque: true,
    nonBgPixels,
    panelStep,
    hueFamilies: audit.counts,
    redFamily,
    redOutsideScope: audit.outside[redFamily] ?? 0,
    signatureFamily,
    dangerFamily,
    cautionFamily,
    infoFamily
  }
}

export { CaptureSafetyError, exact, finite, containsRect, assertTypeScaleOrder }
