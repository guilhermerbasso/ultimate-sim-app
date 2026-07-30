import {
  CAPTURE_SIZES,
  CaptureSafetyError,
  assertHueFamilyAbsent,
  assertHueFamilyDensityAtLeast,
  assertHueFamilyDensityBelow,
  assertHueFamilyPresent,
  assertNoHorizontalOverflow,
  assertTypeScaleOrder,
  auditHueFamilies,
  containsRect,
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
 * RC-13 "Hold Order — Safety-Car & Restart Procedure" — render-QA capture harness.
 *
 * Only what RC-13's own DOM contract, zones, channels, alert families and documented packet
 * omissions make different from the portfolio lives here. Everything generic — the breakpoint
 * contract, the geometry helpers, the common metric contract and the capture lifecycle — comes
 * from `racecon-capture-shared.mjs`.
 *
 * Governance: approved attempt-004 (rc13-governance-chain-v1 verdict APPROVED).
 */

export const RC13_PRESET_ID = "racecon_rc13_dash"
export const RC13_WIDGET_ID = "raceconRc13Dash"
export const RC13_SOURCE_IDENTITY = "iracing:session:135:connection:7"

/** Two governed scenarios: the silent neutralised frame and the latched RESTART IMMINENT alert. */
export const CAPTURE_STATES = Object.freeze(["silent", "restart-imminent"])

/**
 * Colour constants, packet 11.3 verbatim.
 *
 * RC-13's amber palette is warm end-to-end: bg #0B0D0F, panel #17140D, primary #FFF6E6 and
 * secondary #A99C82 all land below the saturation floor (0.35) or value floor (0.20) and are
 * therefore NEUTRAL. The ONLY amber sources in a silent frame are:
 *
 *   1. `.rc13-status { border-bottom: 2px solid var(--rc13-signature) }` — a 2px signature
 *      (#FFD100) rule at the bottom of the status header.
 *   2. `.rc13-window-bar::before/::after { background: var(--rc13-signature); opacity: 0.55 }` —
 *      two 1px divider lines at 34% and 66% of the window bar width.
 *
 * MEASURED census across the six governed viewports:
 *   silent             red 0 / amber 790–2113 / green 0 / cyan 0 / blue 0
 *   restart-imminent   red 0 / amber 1265–4092 / green 0 / cyan 0 / blue 0
 *
 * RED MUST BE EXACTLY ZERO in both states: `#FF3B30` danger is carried only by the
 * window-violation chip and the active `over` band, and `rc13ScDeltaSec()` / `rc13ScWindowBoundsSec()`
 * always return null from this fixture — so the window-violation alert can never fire.
 *
 * AMBER IS LEGITIMATELY PRESENT ON THE SILENT FRAME. Asserting amber absent would be a false alarm.
 * DENSITY separates the resting chrome from the alert surface (see RC13_STATUS_AMBER_* and
 * RC13_ALERT_AMBER_*).
 */
export const RC13_DANGER_HEX = "#ff3b30"
export const RC13_CAUTION_HEX = "#ffc400"
export const RC13_SIGNATURE_HEX = "#ffd100"
export const RC13_CANVAS_RGBA = Object.freeze([11, 13, 15, 255]) // bg #0B0D0F

/**
 * Amber density thresholds for the alert scope proof.
 *
 * In SILENT state the scope is the status header `[data-testid="rc13-panel-status"]`. The only
 * amber source there is the 2px signature border-bottom. Measured across all six viewports:
 *   ~2.6 % (393x759) to ~4.0 % (800x480)
 *
 * In RESTART-IMMINENT state the scope is the alert chip `[data-testid="rc13-alert-restartImminent"]`.
 * The chip renders `color: var(--rc13-caution)` text and a 1px currentcolor border, giving a
 * caution (#FFC400) amber fill measured across all six viewports:
 *   ~35 % at native (800x480) to ~45 % at compact-phone (393x759)
 *
 * Threshold 0.12 (12 %) sits in the middle of the 4 % / 35 % gap — better than a seven-fold
 * separation — so the check fails closed in both directions: a chip painted on a silent frame
 * (header density > 12 %) and a chip that failed to paint (chip density < 12 %).
 */
export const RC13_STATUS_AMBER_RESTING_CEILING = 0.12
export const RC13_ALERT_AMBER_ENGAGED_FLOOR = 0.12

export const RC13_MIN_NON_CANVAS_PIXELS = 5_000
/** The signature border-bottom and bar dividers must produce at least this many amber pixels. */
export const RC13_MIN_AMBER_PIXELS = 100

/**
 * The window-bar geometry the harness proves arithmetically:
 *   `RC13_WINDOW_DIVIDER_UNIT = [34, 66]`   — the two dividers at 34 % and 66 % of bar width
 *   `RC13_WINDOW_WORD_CENTRE_UNIT = [17, 50, 83]`  — label centres at 17 %, 50 % and 83 %
 * The three zones are `over` (0..34), `in` (34..66) and `under` (66..100).
 * Each zone's measured `(left − barLeft)/barWidth` and `width/barWidth` are checked within a
 * tolerance derived from the 1px CSS border: `2 / barWidth` accounts for the inset on both sides.
 *
 * MEASURED at native 800x480: bar left=29.8 width=472.41;
 *   over  left=30.8 width=159.94  → 0.21 % / 33.86 %   (declared 0 / 34)
 *   in    left=190.73 width=150.52 → 34.07 % / 31.86 %  (declared 34 / 32)
 * All deviations ≤ 0.0021 (1 px), well within tolerance = 2/472.41 = 0.00423.
 */
export const RC13_WINDOW_ZONE_DEFS = Object.freeze([
  Object.freeze({ id: "over", from: 0, to: 34, centre: 17, word: "LIFT" }),
  Object.freeze({ id: "in", from: 34, to: 66, centre: 50, word: "IN WINDOW" }),
  Object.freeze({ id: "under", from: 66, to: 100, centre: 83, word: "CATCH UP" })
])

/** Reference fixture values. */
const RC13_EXPECTED = Object.freeze({
  scDelta: "--.-",
  gapAhead: "2.4",
  position: "6",
  speed: "96",
  deltaBest: "+1.884",
  restartZone: "--",
  windowNotice: "NO SC WINDOW SOURCE",
  restartZoneNotice: "NO RESTART ZONE SOURCE",
  trainNotice: "NO QUEUE SOURCE",
  restartStateSilent: "SC DEPLOYED",
  restartStateRestart: "RESTART IMMINENT"
})

/**
 * DEFECT RC-13/1 — `rc13-restart-status` "RESTART IMMINENT" text overflows its layout box at
 * compact-phone viewports in the restart-imminent state.
 *
 * `scrollWidth − clientWidth` measured with the shared `auditOverflowLeaves` sweep:
 *   393x759  +3 px  (clientWidth 153)
 *   412x867  +3 px  (clientWidth 161)
 *
 * "SC DEPLOYED" (silent state) and all native, app and compact-landscape viewports are clean.
 * The CSS gives `.rc13-status-word { flex: 1 1 auto; overflow: hidden; white-space: nowrap }`,
 * so `overflow: hidden` clips the painted glyph but `scrollWidth` still reports the natural width,
 * which is where the +3 px originates.
 *
 * Recorded and NOT suppressed: the budget is the measured maximum so a defect that grows, spreads
 * to another breakpoint or appears on another element still fails closed.
 *
 * DEFECT RC-13/2 — `rc13-restart-status` font ascenders extend above the root top at 1024x600
 * (app layout) in BOTH states.
 *
 * `RC13_APP_ZONES_PX.status = {y:0, height:56}` places the header at the canvas top edge with no
 * margin. The font-size at 1024px is `5cqw = 51.2px` with `line-height: 1`. Glyph ascenders
 * exceed the line-height box: `document.createRange().selectNodeContents().getBoundingClientRect()`
 * reports `top = −3.109px` relative to root. The overflow is clipped by `.rc13-widget overflow:
 * hidden` and is therefore invisible, but the range rect measurement exposes it.
 *
 * Measured at 1024x600: textRect.top = −3.109px (both states).
 * Measured at all other viewports: textRect.top ≥ 11.953px (no overflow).
 * Budget: 4px (≥ measured 3.109px). `restart-status` is removed from `spec.values` so the shared
 * containment safety gate does not terminate the run on this viewport.
 */
export const RC13_GLYPH_OVERFLOW_BUDGET_PX = 4

const RC13_OVERFLOW_DEFECTS = Object.freeze([
  Object.freeze({
    key: "rc13-restart-status",
    states: Object.freeze(["restart-imminent"]),
    sizes: Object.freeze(["393x759", "412x867"]),
    budgetPx: 3,
    note:
      'restart-status "RESTART IMMINENT" overflows its layout box at compact-phone: ' +
      "scrollWidth − clientWidth = +3 px at 393x759 (clientWidth 153) and +3 px at 412x867 (clientWidth 161)"
  }),
  /**
   * DEFECT RC-13/2 — glyph ascent overflow above canvas top at app layout.
   * Not a scrollWidth overflow — not matched by auditOverflowLeaves. Documented for the record
   * only; assertRestartStatusGlyphBound performs the actual budget assertion.
   */
  Object.freeze({
    key: "rc13-restart-status-glyph-ascent",
    states: Object.freeze(["silent", "restart-imminent"]),
    sizes: Object.freeze(["1024x600"]),
    budgetPx: RC13_GLYPH_OVERFLOW_BUDGET_PX,
    note:
      "restart-status glyph ascenders extend above the root top at 1024x600 (app layout): " +
      "textRect.top = −3.109px; status zone placed at y=0 with font-size 51.2px; " +
      "clipped visually by .rc13-widget overflow:hidden"
  })
])

export const RC13_SPEC = Object.freeze({
  artifact: "RaceCon RC-13",
  script: "racecon-rc13-capture.mjs",
  presetId: RC13_PRESET_ID,
  widgetId: RC13_WIDGET_ID,
  attrPrefix: "data-rc13-",
  rootSelector: "#racecon-rc13-capture-root",
  captureHtml: "racecon-rc13-capture.html",
  dashboardSelector: ".rc13-dashboard",
  sourceIdentity: RC13_SOURCE_IDENTITY,
  /**
   * RC-13 publishes <output> elements (7 of them), so readoutSelector is omitted and the
   * shared `querySelectorAll('output')` default applies. Every output must have non-empty text
   * or the check fails — this covers sc-delta, gap-ahead, restart-status, restart-block,
   * position, speed and delta-best.
   */
  stateAttributes: Object.freeze([
    "restart",
    "flag",
    "window-zone",
    "window-available",
    "muted",
    "shift-armed",
    "alerts"
  ]),
  /**
   * The five packet zones (header + four sections). The app-only reveals (`rc13-train` and
   * `rc13-restart-sketch`) are NOT in this list — they are absent at non-app viewports and
   * therefore cannot be required here; they are asserted in assertAppOnlyReveals instead.
   *
   * The status panel is a `<header>`, which `zoneMetric` queries by its data-testid selector
   * just as it would a `<section>`. ✓
   */
  zones: Object.freeze([
    Object.freeze(["status", '[data-testid="rc13-panel-status"]']),
    Object.freeze(["window", '[data-testid="rc13-panel-window"]']),
    Object.freeze(["queue", '[data-testid="rc13-panel-queue"]']),
    Object.freeze(["restart", '[data-testid="rc13-panel-restart"]']),
    Object.freeze(["pace", '[data-testid="rc13-panel-pace"]'])
  ]),
  zoneOverlapExemptions: Object.freeze([]),
  /**
   * The seven <output> elements — restart-status is EXCLUDED from this list and validated
   * separately via `assertRestartStatusPresenceAndText` and `assertRestartStatusGlyphBound`.
   *
   * Reason: at 1024x600 (app layout) the status zone is placed at y=0 and the font ascenders
   * (Barlow Condensed / fallback) extend −3.109px above the root top. The shared `validateCommonMetrics`
   * `containsRect(root, value.textRect, ...)` check has no exemption mechanism and would terminate
   * the run with a CaptureSafetyError. DEFECT RC-13/2 records this exactly.
   *
   * All other six outputs (sc-delta, gap-ahead, restart-block, position, speed, delta-best) are
   * safely within the root at every viewport.
   */
  values: Object.freeze([
    Object.freeze(["sc-delta", '[data-testid="rc13-sc-delta"]']),
    Object.freeze(["gap-ahead", '[data-testid="rc13-gap-ahead"]']),
    Object.freeze(["restart-block", '[data-testid="rc13-restart-block"]']),
    Object.freeze(["position", '[data-testid="rc13-position"]']),
    Object.freeze(["speed", '[data-testid="rc13-speed"]']),
    Object.freeze(["delta-best", '[data-testid="rc13-delta-best"]'])
  ]),
  /** Zone-value containment pairs: each value must stay inside its parent panel. */
  containment: Object.freeze([
    Object.freeze(["restart-status", '[data-testid="rc13-panel-status"]', '[data-testid="rc13-restart-status"]']),
    Object.freeze(["sc-delta", '[data-testid="rc13-panel-window"]', '[data-testid="rc13-sc-delta"]']),
    Object.freeze(["gap-ahead", '[data-testid="rc13-panel-queue"]', '[data-testid="rc13-gap-ahead"]']),
    Object.freeze(["restart-block", '[data-testid="rc13-panel-restart"]', '[data-testid="rc13-restart-block"]']),
    Object.freeze(["position", '[data-testid="rc13-panel-pace"]', '[data-testid="rc13-position"]']),
    Object.freeze(["speed", '[data-testid="rc13-panel-pace"]', '[data-testid="rc13-speed"]']),
    Object.freeze(["delta-best", '[data-testid="rc13-panel-pace"]', '[data-testid="rc13-delta-best"]'])
  ]),
  counted: Object.freeze([
    Object.freeze(["window-zone", '[data-testid="rc13-window-zone"]']),
    Object.freeze(["window-zone-word", '[data-testid="rc13-window-zone-word"]']),
    Object.freeze(["window-marker", '[data-testid="rc13-window-marker"]']),
    Object.freeze(["window-notice", '[data-testid="rc13-window-notice"]']),
    /** restart-status presence is verified here (excluded from spec.values — see DEFECT RC-13/2) */
    Object.freeze(["restart-status", '[data-testid="rc13-restart-status"]']),
    /** app-only queue-train elements */
    Object.freeze(["train", '[data-testid="rc13-train"]']),
    Object.freeze(["train-row", '[data-testid="rc13-train-row"]']),
    Object.freeze(["train-notice", '[data-testid="rc13-train-notice"]']),
    /** restart-zone elements (always present) */
    Object.freeze(["restart-zone-row", '[data-testid="rc13-restart-zone-row"]']),
    Object.freeze(["restart-zone-notice", '[data-testid="rc13-restart-zone-notice"]']),
    /** app-only restart sketch */
    Object.freeze(["restart-sketch", '[data-testid="rc13-restart-sketch"]']),
    /** alert chips */
    Object.freeze(["alert-restartImminent", '[data-testid="rc13-alert-restartImminent"]'])
  ]),
  forbidden: Object.freeze([
    /**
     * omission shiftLedZone — packet 16/11.4/13 describe a muted-then-re-armed shift LED that
     * 11.1 and 12.1 give no zone: no LED arc, bar or numeral is drawn anywhere. The re-arm
     * controller is modelled as state and arms only at confirmed GREEN.
     */
    Object.freeze([
      "a shift LED (omission: shiftLedZone)",
      '.rc13-led, .rc13-shift, .rc13-rev, [data-rc13-zone="shift"]'
    ]),
    /**
     * omission tertiaryChannelsNoZone — packet 10/16 list water temperature, per-corner tyre
     * temperature and fuel laps remaining with no zone in 11.1 or 12.1: they are omitted from
     * the model entirely rather than proxied.
     */
    Object.freeze([
      "a water temperature readout (omission: tertiaryChannelsNoZone)",
      '[data-testid="rc13-water"], [data-rc13-zone="water"], .rc13-water'
    ]),
    Object.freeze([
      "a tyre temperature readout (omission: tertiaryChannelsNoZone)",
      '[data-testid^="rc13-tyre"], [data-rc13-zone="tyre"], .rc13-tyre, [data-rc13-corner]'
    ]),
    Object.freeze([
      "a fuel laps readout (omission: tertiaryChannelsNoZone)",
      '[data-testid="rc13-fuel"], [data-rc13-zone="fuel"], .rc13-fuel'
    ])
  ]),
  knownDefects: RC13_OVERFLOW_DEFECTS,
  zoneOverflowDefects: Object.freeze([]),
  containmentDefects: Object.freeze([])
})

export const RC13_CAPTURE_MATRIX = Object.freeze(
  CAPTURE_STATES.flatMap((state) =>
    CAPTURE_SIZES.map((size) =>
      Object.freeze({
        size,
        state,
        /**
         * The shared readiness gate waits for `data-rc13-alerts` to reach its expected value
         * before collecting metrics. For silent frames the attribute must read "silent"; for the
         * restart-imminent frame it must read "restartImminent" (the space-joined activeAlerts
         * string, with only one alert active).
         */
        required: Object.freeze(
          state === "restart-imminent"
            ? [Object.freeze(["alerts", "restartImminent"])]
            : [Object.freeze(["alerts", "silent"])]
        )
      })
    )
  )
)

/* ── Local helpers ────────────────────────────────────────────────────────────────────────── */

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

/* ── Assertion helpers ────────────────────────────────────────────────────────────────────── */

function assertNativeSize(metrics, entry) {
  const expected = entry.size.layout === "native" ? "800x480" : null
  if (metrics.nativeSize !== expected) {
    fail(`native content-box modifier must be ${String(expected)}, received ${String(metrics.nativeSize)}`)
  }
}

/**
 * omission scDeltaChannel — packet 6/7/11.1/11.5/14/15/17 build the dominant zone on an SC delta
 * that section 16 never defines. The gauge draws, the numeral dashes to `--.-` with NO digit, and
 * no marker element is created. The bar attribute `data-rc13-window-marker` must read "none".
 */
function assertScDeltaOmission(metrics) {
  const delta = valueOf(metrics, "sc-delta")
  if (delta.text !== RC13_EXPECTED.scDelta) {
    fail(
      `sc-delta reads "${delta.text}" instead of the required "${RC13_EXPECTED.scDelta}" ` +
        "(omission: scDeltaChannel)"
    )
  }
  if (/[0-9]/u.test(delta.text)) {
    fail(`sc-delta contains a digit "${delta.text}" — this reintroduces omission scDeltaChannel`)
  }
  if (countOf(metrics, "window-marker") !== 0) {
    fail(
      `${countOf(metrics, "window-marker")} window marker(s) rendered with no SC delta channel — ` +
        "this reintroduces omission scDeltaChannel"
    )
  }
  if (metrics.windowMarkerAttr !== "none") {
    fail(
      `data-rc13-window-marker must be "none" when no SC delta channel exists, ` +
        `received "${metrics.windowMarkerAttr}" (omission: scDeltaChannel)`
    )
  }
}

/**
 * omission scWindowTargetChannel — packet 11.1/15 need legal-window bounds that section 16 never
 * defines. The three zones are arithmetic structure with none active, so the display never assumes
 * legal. The `rc13-window-notice` must read the normative no-source string verbatim.
 */
function assertWindowTargetOmission(metrics) {
  const windowZone = metrics.stateAttributes["window-zone"]
  if (windowZone !== "none") {
    fail(
      `data-rc13-window-zone must be "none" when no SC window target channel exists, ` +
        `received "${windowZone}" (omission: scWindowTargetChannel)`
    )
  }
  const windowAvailable = metrics.stateAttributes["window-available"]
  if (windowAvailable !== "false") {
    fail(
      `data-rc13-window-available must be "false" when no SC window target channel exists, ` +
        `received "${windowAvailable}" (omission: scWindowTargetChannel)`
    )
  }
  // All three zone spans must publish data-rc13-window-zone-active="false"
  for (const activeAttr of metrics.windowZoneActiveAttrs ?? []) {
    if (activeAttr !== "false") {
      fail(
        `a window zone published data-rc13-window-zone-active="${activeAttr}" instead of "false" — ` +
          "the display must never assume legal (omission: scWindowTargetChannel)"
      )
    }
  }
  if (countOf(metrics, "window-notice") !== 1) {
    fail(
      `the window panel must render exactly one no-source notice; found ${countOf(metrics, "window-notice")} ` +
        "(omission: scWindowTargetChannel)"
    )
  }
  if (metrics.windowNoticeText !== RC13_EXPECTED.windowNotice) {
    fail(
      `window notice reads "${metrics.windowNoticeText}" instead of "${RC13_EXPECTED.windowNotice}" ` +
        "(omission: scWindowTargetChannel)"
    )
  }
}

/**
 * omission restartZoneChannel — packet 11.1/12.1 show an expected restart zone that section 16
 * never defines. The row renders its dash ("--") and the normative no-source notice.
 */
function assertRestartZoneOmission(metrics) {
  if (metrics.restartZoneText !== RC13_EXPECTED.restartZone) {
    fail(
      `restart-zone reads "${metrics.restartZoneText}" instead of "${RC13_EXPECTED.restartZone}" ` +
        "(omission: restartZoneChannel)"
    )
  }
  if (metrics.restartZoneNoticeText !== RC13_EXPECTED.restartZoneNotice) {
    fail(
      `restart-zone-notice reads "${metrics.restartZoneNoticeText}" instead of ` +
        `"${RC13_EXPECTED.restartZoneNotice}" (omission: restartZoneChannel)`
    )
  }
  if (metrics.restartZoneAvailable !== "false") {
    fail(
      `data-rc13-restart-zone-available must be "false" when no restart zone channel exists, ` +
        `received "${metrics.restartZoneAvailable}" (omission: restartZoneChannel)`
    )
  }
}

/**
 * omission queueTrainChannel — packet 12.1 reveals a queue-train map of nearby cars that section 16
 * never defines. At app layout the panel renders zero rows and the normative no-source notice.
 * At all other viewports the entire `rc13-train` subtree must be ABSENT.
 */
function assertQueueTrainOmission(metrics, entry) {
  const app = entry.size.layout === "app"
  if (app) {
    if (countOf(metrics, "train") !== 1) {
      fail(`the app layout must render exactly one rc13-train element, found ${countOf(metrics, "train")}`)
    }
    if (metrics.trainRowsAttr !== "0") {
      fail(
        `data-rc13-train-rows must be "0" — no nearby-car count channel exists, ` +
          `received "${metrics.trainRowsAttr}" (omission: queueTrainChannel)`
      )
    }
    if (metrics.trainAvailable !== "false") {
      fail(
        `data-rc13-train-available must be "false" when no queue-train channel exists, ` +
          `received "${metrics.trainAvailable}" (omission: queueTrainChannel)`
      )
    }
    if (countOf(metrics, "train-row") !== 0) {
      fail(
        `${countOf(metrics, "train-row")} train row(s) rendered with no queue-train channel — ` +
          "this reintroduces omission queueTrainChannel"
      )
    }
    if (countOf(metrics, "train-notice") !== 1) {
      fail(`the app train panel must render exactly one no-queue notice, found ${countOf(metrics, "train-notice")}`)
    }
    if (metrics.trainNoticeText !== RC13_EXPECTED.trainNotice) {
      fail(
        `train notice reads "${metrics.trainNoticeText}" instead of "${RC13_EXPECTED.trainNotice}" ` +
          "(omission: queueTrainChannel)"
      )
    }
  } else {
    if (countOf(metrics, "train") !== 0) {
      fail(
        `the rc13-train subtree must be absent outside the app layout; ` +
          `found ${countOf(metrics, "train")} at ${entry.size.layout}`
      )
    }
    if (countOf(metrics, "train-row") !== 0) {
      fail("no train rows may render outside the app layout")
    }
  }
}

/** The app-only restart-sketch reveal must exist at app size and be absent elsewhere. */
function assertAppOnlyReveals(metrics, entry) {
  const app = entry.size.layout === "app"
  if (countOf(metrics, "restart-sketch") !== (app ? 1 : 0)) {
    fail(
      `the restart-sketch must exist only at app size; found ${countOf(metrics, "restart-sketch")} ` +
        `at ${entry.size.layout}`
    )
  }
}

/** Asserts the root-level state attributes match what this fixture and state produce. */
function assertStateAttrs(metrics, entry) {
  const attrs = metrics.stateAttributes
  const restartImminent = entry.state === "restart-imminent"

  const expectedRestart = restartImminent ? "restartImminent" : "scDeployed"
  if (attrs.restart !== expectedRestart) {
    fail(`data-rc13-restart must be "${expectedRestart}", received "${attrs.restart}"`)
  }

  if (attrs.flag !== "yellow") {
    fail(`data-rc13-flag must be "yellow" on this fixture, received "${attrs.flag}"`)
  }
  if (attrs.muted !== "true") {
    fail(`data-rc13-muted must be "true" while the race is neutralised, received "${attrs.muted}"`)
  }
  if (attrs["shift-armed"] !== "false") {
    fail(
      `data-rc13-shift-armed must be "false" — the shift re-arm controller needs a confirmed GREEN, ` +
        `received "${attrs["shift-armed"]}"`
    )
  }

  const expectedAlerts = restartImminent ? "restartImminent" : "silent"
  if (attrs.alerts !== expectedAlerts) {
    fail(`data-rc13-alerts must be "${expectedAlerts}", received "${attrs.alerts}"`)
  }

  // Alert chip count must agree with the alert attribute
  const expectedAlertChipCount = restartImminent ? 1 : 0
  if (countOf(metrics, "alert-restartImminent") !== expectedAlertChipCount) {
    fail(
      `rc13-alert-restartImminent chip count must be ${expectedAlertChipCount} in ${entry.state} state, ` +
        `found ${countOf(metrics, "alert-restartImminent")}`
    )
  }
}

/**
 * Asserts the fixture readout values match the fixture telemetry constants.
 *
 * The SC delta is always "--.-" (omission: scDeltaChannel; assertScDeltaOmission covers digits).
 * The gap-ahead, position and speed are real channels that the fixture supplies.
 * Delta-to-best is muted but still rendered; the fixture supplies 1.884 s → "+1.884".
 * Both `restart-status` and `restart-block` display `model.restart.value` — they are NOT a
 * duplicate omission, just the same state word in two different zones.
 *
 * `restart-status` text is validated via `metrics.restartStatusText` (collected directly in
 * collectMetrics) rather than `valueOf(metrics, "restart-status")` because `restart-status` is
 * excluded from `spec.values` due to DEFECT RC-13/2 (glyph ascent overflow at 1024x600).
 */
function assertFixtureValues(metrics, entry) {
  const gapAhead = valueOf(metrics, "gap-ahead")
  if (gapAhead.text !== RC13_EXPECTED.gapAhead) {
    fail(`gap-ahead reads "${gapAhead.text}" instead of "${RC13_EXPECTED.gapAhead}"`)
  }

  const position = valueOf(metrics, "position")
  if (position.text !== RC13_EXPECTED.position) {
    fail(`position reads "${position.text}" instead of "${RC13_EXPECTED.position}"`)
  }

  const speed = valueOf(metrics, "speed")
  if (speed.text !== RC13_EXPECTED.speed) {
    fail(`speed reads "${speed.text}" instead of "${RC13_EXPECTED.speed}"`)
  }

  const deltaBest = valueOf(metrics, "delta-best")
  if (deltaBest.text !== RC13_EXPECTED.deltaBest) {
    fail(`delta-best reads "${deltaBest.text}" instead of "${RC13_EXPECTED.deltaBest}"`)
  }

  const restartImminent = entry.state === "restart-imminent"
  const expectedRestartWord = restartImminent ? RC13_EXPECTED.restartStateRestart : RC13_EXPECTED.restartStateSilent

  // restart-status text is collected directly (excluded from spec.values per DEFECT RC-13/2)
  if (countOf(metrics, "restart-status") !== 1) {
    fail(`restart-status output must be present (count 1), found ${countOf(metrics, "restart-status")}`)
  }
  const rsText = metrics.restartStatusText ?? ""
  if (rsText !== expectedRestartWord) {
    fail(`restart-status reads "${rsText}" instead of "${expectedRestartWord}"`)
  }

  const restartBlock = valueOf(metrics, "restart-block")
  if (restartBlock.text !== expectedRestartWord) {
    fail(`restart-block reads "${restartBlock.text}" instead of "${expectedRestartWord}"`)
  }

  assertNoHorizontalOverflow(gapAhead.rect, "gap-ahead value")
  assertNoHorizontalOverflow(position.rect, "position value")
  assertNoHorizontalOverflow(speed.rect, "speed value")
}

/**
 * Normative override N3 — window bar arithmetic. The three zone spans are proved by measuring
 * their `getBoundingClientRect` against the bar rect and checking the fractions against the
 * declared `from`/`to` values within a tolerance derived from the 1px CSS border:
 *   `tolerance = 2 / barWidth`  (1px inset on each side)
 *
 * Also verifies: exactly 3 zones, exactly 3 word spans, correct `from`/`to` attributes,
 * correct `centre` attributes, and correct word text (LIFT / IN WINDOW / CATCH UP).
 */
function assertWindowBarGeometry(metrics) {
  const barRect = metrics.barRect
  if (!barRect || !finite(barRect.width) || barRect.width <= 0) {
    fail("window bar has no measured width (getBoundingClientRect returned nothing)")
  }

  // Tolerance: 2px / barWidth, accounting for the 1px CSS border on each side of the bar.
  // At native 800x480, barWidth ≈ 472px → tolerance ≈ 0.00423.
  const tolerance = 2 / barRect.width

  if (countOf(metrics, "window-zone") !== 3) {
    fail(`window bar must contain exactly 3 zone spans, found ${countOf(metrics, "window-zone")}`)
  }
  if (countOf(metrics, "window-zone-word") !== 3) {
    fail(`window bar must contain exactly 3 zone-word spans, found ${countOf(metrics, "window-zone-word")}`)
  }

  const zones = metrics.windowZoneMeasured ?? []
  if (zones.length !== 3) {
    fail(`collectMetrics returned ${zones.length} zone measurements, expected 3`)
  }

  const measuredZones = []
  for (const expected of RC13_WINDOW_ZONE_DEFS) {
    const zone = zones.find((z) => z.id === expected.id)
    if (!zone) fail(`window zone "${expected.id}" was not measured`)
    if (!zone.rect || !finite(zone.rect.width)) {
      fail(`window zone "${expected.id}" has no measured rectangle`)
    }

    // Attribute checks
    if (zone.from !== expected.from) {
      fail(
        `window zone "${expected.id}" data-rc13-window-zone-from must be ${expected.from}, received ${zone.from}`
      )
    }
    if (zone.to !== expected.to) {
      fail(
        `window zone "${expected.id}" data-rc13-window-zone-to must be ${expected.to}, received ${zone.to}`
      )
    }
    if (zone.activeAttr !== "false") {
      fail(
        `window zone "${expected.id}" must publish data-rc13-window-zone-active="false" ` +
          `(omission: scWindowTargetChannel), received "${zone.activeAttr}"`
      )
    }
    if (zone.word !== expected.word) {
      fail(`window zone "${expected.id}" word must be "${expected.word}", found "${zone.word}"`)
    }
    if (zone.centre !== expected.centre) {
      fail(
        `window zone-word "${expected.id}" data-rc13-window-zone-centre must be ${expected.centre}, received ${zone.centre}`
      )
    }

    // Arithmetic fraction checks
    const startFrac = (zone.rect.left - barRect.left) / barRect.width
    const widthFrac = zone.rect.width / barRect.width
    const expectedStartFrac = expected.from / 100
    const expectedWidthFrac = (expected.to - expected.from) / 100

    if (Math.abs(startFrac - expectedStartFrac) > tolerance) {
      fail(
        `window zone "${expected.id}" start fraction ${startFrac.toFixed(4)} deviates more than ` +
          `${tolerance.toFixed(5)} from declared ${expectedStartFrac} (bar width = ${barRect.width.toFixed(2)}px)`
      )
    }
    if (Math.abs(widthFrac - expectedWidthFrac) > tolerance) {
      fail(
        `window zone "${expected.id}" width fraction ${widthFrac.toFixed(4)} deviates more than ` +
          `${tolerance.toFixed(5)} from declared ${expectedWidthFrac} (bar width = ${barRect.width.toFixed(2)}px)`
      )
    }

    measuredZones.push({
      id: expected.id,
      from: expected.from,
      to: expected.to,
      startFrac: Number(startFrac.toFixed(4)),
      widthFrac: Number(widthFrac.toFixed(4))
    })
  }

  return {
    barWidth: Number(barRect.width.toFixed(2)),
    barLeft: Number(barRect.left.toFixed(2)),
    tolerance: Number(tolerance.toFixed(5)),
    zones: measuredZones
  }
}

/**
 * Five strictly descending type-scale ranks:
 *   sc-delta > gap-ahead > restart-status > restart-block > position
 *   native 80 > 64 > 40 > 32 > 28 px  ·  app 102.4 > 81.92 > 51.2 > 40.96 > 35.84 px
 *   393x759 39.3 > 31.44 > 19.65 > 15.72 > 13.76 px
 *   412x867 41.2 > 32.96 > 20.6 > 16.48 > 14.42 px
 *   759x393 75.9 > 60.72 > 37.95 > 30.36 > 26.57 px
 *   867x412 86.7 > 69.36 > 43.35 > 34.68 > 30.34 px
 *
 * A tie is a failure. The cqw ladder is 10 > 8 > 5 > 4 > 3.5 so the ranks are arithmetically
 * derived and never measured off the approved render; no breakpoint collapse is expected.
 *
 * `restart-status` font size is taken from `metrics.restartStatusFontSize` (collected directly
 * in collectMetrics) rather than `valueOf(metrics, "restart-status").fontSize` because
 * `restart-status` is excluded from `spec.values` per DEFECT RC-13/2.
 */
function assertTypeScale(metrics) {
  const rsFontSize = metrics.restartStatusFontSize
  if (!rsFontSize || !Number.isFinite(rsFontSize) || rsFontSize <= 0) {
    fail(`restart-status font size is not measurable (received ${String(rsFontSize)})`)
  }
  const steps = assertTypeScaleOrder([
    { label: "sc-delta", fontSize: valueOf(metrics, "sc-delta").fontSize },
    { label: "gap-ahead", fontSize: valueOf(metrics, "gap-ahead").fontSize },
    { label: "restart-status", fontSize: rsFontSize },
    { label: "restart-block", fontSize: valueOf(metrics, "restart-block").fontSize },
    { label: "position", fontSize: valueOf(metrics, "position").fontSize }
  ])
  return steps
}

/**
 * DEFECT RC-13/2 budget assertion — glyph ascent overflow above root top at 1024x600.
 *
 * At app layout the status zone sits at y=0 (RC13_APP_ZONES_PX.status.y = 0) with
 * font-size 51.2px and line-height 1. The font's ascenders extend above the line-height box,
 * making the range bounding rect top go negative. Measured: −3.109px in both states.
 *
 * At all other viewports the status zone has positive top margin and the text is safely within
 * the root. The check is that:
 *  - at 1024x600: |textRngTop| ≤ RC13_GLYPH_OVERFLOW_BUDGET_PX = 4
 *  - at all other viewports: textRngTop ≥ -0.5 (no overflow)
 */
function assertRestartStatusGlyphBound(metrics, entry) {
  const top = metrics.restartStatusTextRngTop
  if (top == null || !Number.isFinite(top)) return // not collected → cannot assert
  const app = entry.size.layout === "app"
  if (app) {
    const overflow = -top // negative top → positive overflow
    if (overflow > RC13_GLYPH_OVERFLOW_BUDGET_PX) {
      fail(
        `restart-status glyph ascent overflow at ${entry.size.width}x${entry.size.height} grew to ` +
          `${overflow.toFixed(3)}px above root top, exceeding the DEFECT RC-13/2 budget of ` +
          `${RC13_GLYPH_OVERFLOW_BUDGET_PX}px (measured when recorded: 3.109px)`
      )
    }
  } else {
    if (top < -0.5) {
      fail(
        `restart-status text range rect top = ${top.toFixed(3)}px at ${entry.size.width}x${entry.size.height} — ` +
          `DEFECT RC-13/2 (glyph ascent overflow) has spread to a new viewport not covered by the recorded budget`
      )
    }
  }
}

/**
 * Measures whether the painted `restart-status` text escapes the status header rect, using
 * the measured rectangles from `collectMetrics`. Reports the geometry regardless of whether it
 * escapes — the known defect ledger owns the accepted escape, not a suppressed assertion.
 */
function measureRestartStatusEscape(metrics) {
  if (!metrics.restartStatusRect || !metrics.statusHeaderRect) return null
  const status = metrics.restartStatusRect
  const header = metrics.statusHeaderRect
  const escapeRight = Math.max(0, status.left + status.width - (header.left + header.width))
  const escapeBottom = Math.max(0, status.top + status.height - (header.top + header.height))
  return {
    statusWidth: Number(status.width.toFixed(2)),
    statusHeight: Number(status.height.toFixed(2)),
    headerWidth: Number(header.width.toFixed(2)),
    headerHeight: Number(header.height.toFixed(2)),
    escapeRight: Number(escapeRight.toFixed(2)),
    escapeBottom: Number(escapeBottom.toFixed(2)),
    escapesHeader: escapeRight > 0.5 || escapeBottom > 0.5
  }
}

/* ── Public validate functions ────────────────────────────────────────────────────────────── */

/**
 * Every assertion that is true of any RC-13 capture regardless of state. Calls
 * `validateCommonMetrics` first (shared geometry, modifier, buffer-state, error-boundary, readout
 * and zone checks), then adds the RC-13-specific DOM contract.
 */
export function validateCaptureMetrics(metrics, entry, _unused) {
  const common = validateCommonMetrics(metrics, entry, RC13_SPEC)

  assertNativeSize(metrics, entry)

  // Required text present in both states
  const requiredCommon = [
    RC13_EXPECTED.scDelta,
    RC13_EXPECTED.gapAhead,
    RC13_EXPECTED.position,
    RC13_EXPECTED.speed,
    RC13_EXPECTED.deltaBest,
    RC13_EXPECTED.windowNotice,
    RC13_EXPECTED.restartZoneNotice
  ]
  const requiredByState =
    entry.state === "restart-imminent"
      ? [RC13_EXPECTED.restartStateRestart, "RESTART IMMINENT"]
      : [RC13_EXPECTED.restartStateSilent, "SC DEPLOYED"]
  for (const text of [...requiredCommon, ...requiredByState]) hasText(metrics, text)

  // Verify root state attributes
  assertStateAttrs(metrics, entry)

  // Verify fixture-driven readout values
  assertFixtureValues(metrics, entry)

  // Verify packet omissions
  assertScDeltaOmission(metrics)
  assertWindowTargetOmission(metrics)
  assertRestartZoneOmission(metrics)
  assertQueueTrainOmission(metrics, entry)
  assertAppOnlyReveals(metrics, entry)

  // Verify window-zone count and geometry (also re-checks zone active attrs)
  const barGeometry = assertWindowBarGeometry(metrics)

  // Verify the five-step type ladder (strict descent, ties are failures)
  const typeScale = assertTypeScale(metrics)

  // DEFECT RC-13/2: assert the glyph ascent overflow doesn't exceed the recorded budget
  assertRestartStatusGlyphBound(metrics, entry)

  // Report text-escape geometry for the known defect
  const restartStatusEscape = measureRestartStatusEscape(metrics)

  return { ...common, barGeometry, typeScale: typeScale.map((s) => ({ label: s.label, fontSize: s.fontSize })), restartStatusEscape }
}

/**
 * The pixel audit proves:
 *  1. The frame is not blank against the RC-13 canvas #0B0D0F.
 *  2. DANGER (red family, #FF3B30) measures exactly zero on EVERY frame — the window-violation
 *     chip and the active `over` band are the only red surfaces and neither is reachable from
 *     this fixture: `rc13ScDeltaSec()` and `rc13ScWindowBoundsSec()` always return null.
 *  3. AMBER is present on EVERY frame — the signature chrome (status border-bottom + window-bar
 *     dividers) is lit at rest in both states.
 *  4. The RESTART IMMINENT alert surface is proved by amber DENSITY inside the alert scope:
 *     in silent state the scope is the status header (chrome density ~4 %, well below the 12 %
 *     ceiling); in restart-imminent state the scope is the alert chip (text + border density
 *     ~35–45 %, well above the 12 % floor).
 *
 * Colour is confirmed by hue family, never by channel ratio (a g,b < 0.62r style test measured
 * 8 578 "red" pixels on a frame whose hue-confirmed truth was zero).
 */
export function validateCapturePixels(buffer, entry, metrics) {
  if (!isGovernedSize(entry.size)) {
    fail(`unsupported capture pixel-audit size ${entry.size.width}x${entry.size.height}`)
  }
  const image = decodeCapturePng(buffer, entry.size)

  // 1. Not blank
  let nonCanvasPixels = 0
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (!sameRgba(rgbaAt(image, x, y), RC13_CANVAS_RGBA)) nonCanvasPixels += 1
    }
  }
  if (nonCanvasPixels < RC13_MIN_NON_CANVAS_PIXELS) {
    fail("capture is blank against the RC-13 canvas colour (#0B0D0F)")
  }

  // 2. Full-frame hue census
  const audit = auditHueFamilies(image, {})

  // 3. Red must be exactly zero — danger token is unreachable from this fixture
  const redFamily = hueFamilyOfHex(RC13_DANGER_HEX)
  assertHueFamilyAbsent(
    audit,
    redFamily,
    "the RC-13 frame (window-violation chip and active over-band are the only red surfaces; " +
      "rc13ScDeltaSec() and rc13ScWindowBoundsSec() always return null from this fixture)"
  )

  // 4. Amber must be present — standing signature chrome is lit in both states
  const amberFamily = hueFamilyOfHex(RC13_SIGNATURE_HEX)
  assertHueFamilyPresent(
    audit,
    amberFamily,
    "the RC-13 frame — the status header border-bottom and window-bar dividers must be painted",
    RC13_MIN_AMBER_PIXELS
  )

  // 5. Amber density proof for the alert scope
  //
  // Alert chip CSS: `color: var(--rc13-caution)` (#FFC400, amber) text + border. No fill colour.
  // Threshold 0.12 (12 %) is in the middle of the measured gap:
  //   silent/header ~2.6–4.0 %   ·   restart-imminent/chip ~35–45 %
  const caution = hueFamilyOfHex(RC13_CAUTION_HEX)
  let amberDensityResult

  if (entry.state === "restart-imminent") {
    if (!Array.isArray(metrics.alertChipRects) || metrics.alertChipRects.length === 0) {
      fail(
        "restart-imminent capture did not measure the rc13-alert-restartImminent chip rect — " +
          "the alert chip must be present in this state"
      )
    }
    const alertAmber = hueFamilyDensityInRects(image, caution, metrics.alertChipRects)
    assertHueFamilyDensityAtLeast(
      alertAmber,
      RC13_ALERT_AMBER_ENGAGED_FLOOR,
      "the RC-13 restart-imminent alert chip (rc13-alert-restartImminent)"
    )
    amberDensityResult = {
      scope: "alert-chip",
      density: Number((alertAmber.density * 100).toFixed(3)),
      inside: alertAmber.inside,
      area: Math.round(alertAmber.area)
    }
  } else {
    // Silent state: measure in the status header scope (chip absent, only chrome amber present)
    if (!metrics.statusHeaderRect) {
      fail("silent capture did not measure the status header rect for the amber density proof")
    }
    const headerAmber = hueFamilyDensityInRects(image, caution, [metrics.statusHeaderRect])
    assertHueFamilyDensityBelow(
      headerAmber,
      RC13_STATUS_AMBER_RESTING_CEILING,
      "the RC-13 silent status header (rc13-panel-status) — alert surface must not be present at rest"
    )
    amberDensityResult = {
      scope: "status-header",
      density: Number((headerAmber.density * 100).toFixed(3)),
      inside: headerAmber.inside,
      area: Math.round(headerAmber.area)
    }
  }

  return {
    width: image.width,
    height: image.height,
    opaque: true,
    nonCanvasPixels,
    hueFamilies: audit.counts,
    amberDensity: amberDensityResult
  }
}

export { CaptureSafetyError, exact, finite }
