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
  hueFamilyOfHex,
  isGovernedSize,
  lacksLeafText,
  rgbaAt,
  sameRgba,
  validateCommonMetrics
} from "./racecon-capture-shared.mjs"

export { CAPTURE_SIZES }

/**
 * RC-12 "On Air — Broadcast Timing Presentation" — render-QA capture harness.
 *
 * Only what RC-12's own DOM contract, zones, channels, alert families and documented packet
 * omissions make different from the portfolio lives here. Everything generic — the breakpoint
 * contract, the geometry helpers, the common metric contract and the capture lifecycle — comes
 * from `racecon-capture-shared.mjs`, which re-exports RC-01's safety primitives unchanged.
 *
 * Governance: approved attempt-004 (rc12-governance-chain-v1 verdict APPROVED).
 */

export const RC12_PRESET_ID = "racecon_rc12_dash"
export const RC12_WIDGET_ID = "raceconRc12Dash"
export const RC12_SOURCE_IDENTITY = "iracing:session:124:connection:6"

/** Two governed scenarios: the silent frame and the latched FASTEST LAP alert. */
export const CAPTURE_STATES = Object.freeze(["silent", "fastest-lap"])

/**
 * The eight-car field the fixture supplies; the player sits at P5 and the only measured pair
 * is P4 (ahead) and P6 (behind). Everything else dashes, which is the documented
 * `fieldWideIntervalChannel` omission rather than a defect.
 */
export const RC12_FIELD_SIZE = 8

/**
 * Packet 11.3 tokens — bg and danger / caution / signature are asserted in the pixel audit.
 * `caution` and `danger` carry their full-saturation packet values; even an antialiased pixel of
 * either token lands firmly in the amber or red family.
 */
export const RC12_CANVAS_RGBA = Object.freeze([10, 14, 26, 255]) // bg #0A0E1A
export const RC12_CAUTION_HEX = "#FFC93C"   // caution amber — absent from BOTH states in this fixture
export const RC12_DANGER_HEX = "#FF5470"    // danger red  — absent from BOTH states in this fixture
export const RC12_SIGNATURE_HEX = "#00E0C6" // signature cyan — absent from silent, present+scoped in fastest-lap

/**
 * Measured across the six governed viewports in both states (cyan family = signature #00E0C6):
 *   silent     red 0, amber 0, green 0, cyan 0, blue 2 819–6 614
 *   fastest-lap  red 0, amber 0, green 0, cyan 1 621–8 623, blue 2 819–6 611
 *
 * Cyan is strictly absent from every silent frame and strictly present in every fastest-lap
 * frame. The entire cyan budget is owned by the fastest-lap tag zone and the highlighted row.
 */
export const RC12_MIN_NON_CANVAS_PIXELS = 5_000

/**
 * Measured row counts from data-rc12-rows at each layout:
 *   native          8    (RC12_NATIVE_ROW_COUNT)
 *   app            16    (RC12_APP_ROW_COUNT)
 *   compact-phone  10    (RC12_PHONE_ROW_COUNT)
 *   compact-landscape 6  (RC12_LANDSCAPE_ROW_COUNT)
 *   compact-standard  8  (RC12_NATIVE_ROW_COUNT)
 *
 * Because the field has 8 cars, populated rows = min(RC12_FIELD_SIZE, rowCount).
 */
export const RC12_EXPECTED_ROW_COUNTS = Object.freeze({
  "800x480":  Object.freeze({ layout: "native",    rowCount: 8  }),
  "1024x600": Object.freeze({ layout: "app",       rowCount: 16 }),
  "393x759":  Object.freeze({ layout: "compact",   rowCount: 10, compactMode: "phone"      }),
  "412x867":  Object.freeze({ layout: "compact",   rowCount: 10, compactMode: "phone"      }),
  "759x393":  Object.freeze({ layout: "compact",   rowCount: 6,  compactMode: "landscape"  }),
  "867x412":  Object.freeze({ layout: "compact",   rowCount: 6,  compactMode: "landscape"  })
})

/**
 * The readout selector RC-12 requires in place of the default `<output>` search. RC-12 publishes
 * NO `<output>` element anywhere: its leaderboard cells are `<span>`s and so are the ribbon and
 * battle readouts. The shared module routes this selector through `querySelectorAll` in
 * `__rcCommon`, so every matched element is collected and the "none may be empty" check covers
 * the full column sweep rather than just the first cell per column.
 */
export const RC12_READOUT_SELECTOR = [
  '[data-testid="rc12-cell-position"]',
  '[data-testid="rc12-cell-badge"]',
  '[data-testid="rc12-cell-gap"]',
  '[data-testid="rc12-cell-lastLap"]',
  '[data-testid="rc12-session-time"]',
  '[data-testid="rc12-session-laps-done"]',
  '[data-testid="rc12-session-laps-total"]',
  '[data-testid="rc12-battle-gap-value"]'
].join(", ")

export const RC12_SPEC = Object.freeze({
  artifact: "RaceCon RC-12",
  script: "racecon-rc12-capture.mjs",
  presetId: RC12_PRESET_ID,
  widgetId: RC12_WIDGET_ID,
  attrPrefix: "data-rc12-",
  rootSelector: "#racecon-rc12-capture-root",
  captureHtml: "racecon-rc12-capture.html",
  /**
   * CRITICAL — `dashboardSelector`. The top-level broadcast container is `.rc12-broadcast`
   * (not `.rc12-dashboard`). `<main class="rc12-broadcast" data-rc12-native-size="800x480">` is
   * only painted at the native breakpoint.
   */
  dashboardSelector: ".rc12-broadcast",
  readoutSelector: RC12_READOUT_SELECTOR,
  sourceIdentity: RC12_SOURCE_IDENTITY,
  stateAttributes: Object.freeze([
    "alerts",
    "timing",
    "rows",
    "field",
    "measured-gaps",
    "app-only"
  ]),
  /**
   * The three zones present at every governed viewport. The gap-history zone (`rc12-history`) is
   * an app-only reveal checked separately in `assertAppOnlyReveals`, and the fastest-lap tag
   * (`rc12-tag`) is a trigger-only element that is absent from the DOM on silent frames.
   * The native safe-frame (`rc12-safe-frame`) is native-only and checked separately.
   */
  zones: Object.freeze([
    Object.freeze(["ribbon", '[data-testid="rc12-ribbon"]']),
    Object.freeze(["board", '[data-testid="rc12-board"]']),
    Object.freeze(["battle", '[data-testid="rc12-battle"]'])
  ]),
  zoneOverlapExemptions: Object.freeze([]),
  values: Object.freeze([
    Object.freeze(["battle gap",    '[data-testid="rc12-battle-gap-value"]']),
    Object.freeze(["cell gap",      '[data-testid="rc12-cell-gap"]']),
    Object.freeze(["cell position", '[data-testid="rc12-cell-position"]']),
    Object.freeze(["cell badge",    '[data-testid="rc12-cell-badge"]']),
    Object.freeze(["cell last lap", '[data-testid="rc12-cell-lastLap"]']),
    Object.freeze(["session time",  '[data-testid="rc12-session-time"]']),
    Object.freeze(["session laps done",  '[data-testid="rc12-session-laps-done"]']),
    Object.freeze(["session laps total", '[data-testid="rc12-session-laps-total"]'])
  ]),
  containment: Object.freeze([
    Object.freeze(["session time in ribbon", '[data-testid="rc12-ribbon"]',        '[data-testid="rc12-session-time"]']),
    Object.freeze(["battle gap in battle",   '[data-testid="rc12-battle"]',         '[data-testid="rc12-battle-gap-value"]'])
  ]),
  counted: Object.freeze([
    Object.freeze(["row",             '[data-testid="rc12-row"]']),
    Object.freeze(["populated row",   '[data-rc12-row-populated="true"]']),
    Object.freeze(["fastest row",     '[data-rc12-row-fastest="true"]']),
    Object.freeze(["history zone",    '[data-testid="rc12-history"]']),
    Object.freeze(["tag zone",        '[data-testid="rc12-tag"]']),
    Object.freeze(["change arrow",    '[data-testid="rc12-change"]']),
    Object.freeze(["lead tag",        '[data-testid="rc12-lead-tag"]']),
    Object.freeze(["battle empty",    '[data-testid="rc12-battle-empty"]']),
    Object.freeze(["safe frame",      '[data-testid="rc12-safe-frame"]'])
  ]),
  /**
   * RC12_PACKET_OMISSIONS.sectorAndRollingSplit — packet 16's sector and rolling-split channels
   * have no zone in 11.1 or 12.1 at any breakpoint: neither element may ever be introduced.
   *
   * RC12_PACKET_OMISSIONS.tyreAgeAndPitStatus — section 10 lists tyre age and pit status as
   * tertiary telemetry and section 16 gives neither a channel. Neither is drawn.
   *
   * RC12_PACKET_OMISSIONS.pitLimiterChannel — packet 16 hides the pit limiter when the status
   * channel is absent; a broadcast board has no per-car ECU limiter feed, so it stays hidden.
   *
   * [data-testid="rc12-no-timing"] — the NO TIMING SOURCE banner is absent because the fixture
   * supplies a live drivers feed. NOTE: its absence is conditional on the feed being present.
   * With no `drivers` array, the widget sits honestly on "NO TIMING SOURCE" and the banner
   * would be the only rendered element; asserting it absent here is only valid because the
   * fixture deliberately provides a full eight-car field.
   */
  forbidden: Object.freeze([
    Object.freeze([
      "a sector or rolling-split readout (omission: sectorAndRollingSplit)",
      '[data-testid="rc12-sector-split"], [data-testid="rc12-rolling-split"], [data-rc12-zone="sectorSplit"], [data-rc12-zone="rollingSplit"]'
    ]),
    Object.freeze([
      "tyre age or pit-status readout (omission: tyreAgeAndPitStatus)",
      '[data-testid="rc12-tyre-age"], [data-testid="rc12-pit-status"], [data-rc12-zone="tyreAge"], [data-rc12-zone="pitStatus"]'
    ]),
    Object.freeze([
      "a pit-limiter readout (omission: pitLimiterChannel)",
      '[data-testid="rc12-pit-limiter"], [data-rc12-zone="pitLimiter"]'
    ]),
    Object.freeze([
      'the NO TIMING SOURCE banner (the fixture supplies a live feed; absent only while drivers are present)',
      '[data-testid="rc12-no-timing"]'
    ])
  ]),
  /**
   * DEFECT RC-12/B — fastest-lap tag text overflow (800x480 and 1024x600 only, fastest-lap state).
   *
   * The three bare `<span>` children of `[data-testid="rc12-tag"]` have no testid and no class,
   * so the shared overflow sweep identifies them by tag name: key = "span". Measured with
   * getBoundingClientRect, fastest-lap state:
   *
   *   800x480   "FASTEST LAP" +20 px (clientWidth 96)
   *             "P7"          +4 px  (clientWidth 19)
   *             "1:37.106"    +16 px (clientWidth 73)
   *   1024x600  "FASTEST LAP" +18 px (clientWidth 131)
   *             "P7"          +4 px  (clientWidth 26)
   *             "1:37.106"    +13 px (clientWidth 100)
   *
   * The four compact viewports are clean (the tag zone spans the full content width there, giving
   * each span enough room at the proportionally smaller font size).
   *
   * Separately measured via getBoundingClientRect at 800x480: the tag's painted label "FASTEST
   * LAP" physically escapes the tag's own right edge (tag.right - span.right ≈ −20 px), yet the
   * tag div itself remains inside the board zone. The approved normative override
   * `fastestLapTagOverlap` documents an 8,000 px area overlap between the tag packet box and the
   * leaderboard band — the shipped widget places the tag in the right column of the band and the
   * row columns stop at x = 548, so no row text can sit under the tag. The tag label overflows
   * its own div but NOT the board container.
   */
  knownDefects: Object.freeze([
    Object.freeze({
      key: "span",
      states: Object.freeze(["fastest-lap"]),
      sizes: Object.freeze(["800x480", "1024x600"]),
      budgetPx: 20,
      note:
        "fastest-lap tag bare child spans overflow their allocated column at native and app: " +
        '"FASTEST LAP" +20/+18 px, "P7" +4/+4 px, "1:37.106" +16/+13 px; compact viewports are clean'
    })
  ]),
  zoneOverflowDefects: Object.freeze([]),
  containmentDefects: Object.freeze([])
})

export const RC12_CAPTURE_MATRIX = Object.freeze(
  CAPTURE_STATES.flatMap((state) =>
    CAPTURE_SIZES.map((size) =>
      Object.freeze({
        size,
        state,
        required: Object.freeze(
          state === "fastest-lap"
            ? [Object.freeze(["alerts", "active"])]
            : [Object.freeze(["alerts", "silent"])]
        )
      })
    )
  )
)

// ─────────────────────────────────────────────── metric validation helpers

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

// ─────────────────────────────────────────────── assertions

/**
 * omission sessionClockChannel — packet 11.1/12.1/17 demand a session clock ribbon but section 16
 * defines no session-time and no lap-count channel. The ribbon is drawn and BOTH readouts dash
 * forever; the snapshot's own session clock is deliberately NOT read.
 *
 * Assert each readout reads exactly "--" and carries NO digit — a digit is a reintroduction of
 * the channel the packet has not yet provided.
 */
function assertSessionClockOmission(metrics) {
  const time = valueOf(metrics, "session time")
  const lapsDone = valueOf(metrics, "session laps done")
  const lapsTotal = valueOf(metrics, "session laps total")

  for (const [label, value] of [["session time", time], ["session laps done", lapsDone], ["session laps total", lapsTotal]]) {
    if (value.text !== "--") {
      fail(
        `${label} reads "${value.text}" instead of "--" ` +
          "(omission: sessionClockChannel — no session-time or lap-count channel in section 16)"
      )
    }
    if (/[0-9]/u.test(value.text)) {
      fail(
        `${label} "${value.text}" contains a digit — this reintroduces omission sessionClockChannel`
      )
    }
  }
}

/**
 * omission entrantIdentityChannel — packet 11.1/17/20 demand a name badge per row but section 16
 * defines no entrant-identity channel and section 20 forbids real entrants. Every badge is the
 * neutral placeholder "CAR --"; no car number or driver name from the fixture may appear.
 *
 * The fixture deliberately supplies names ("ENTRANT 1"…"ENTRANT 8") that the widget must refuse
 * to print — this assertion proves that refusal.
 */
function assertEntrantIdentityOmission(metrics) {
  const badgeCells = (metrics.rootText ?? "")
  // Assert CAR -- appears as many times as there are rows (it's the only badge text)
  // and that no fixture entrant identity leaks through.
  for (let pos = 1; pos <= RC12_FIELD_SIZE; pos += 1) {
    if (badgeCells.includes(`ENTRANT ${pos}`)) {
      fail(
        `capture text contains "ENTRANT ${pos}" — entrant identity must not be printed ` +
          "(omission: entrantIdentityChannel)"
      )
    }
  }
  // Leaf texts: every rc12-cell-badge must read exactly "CAR --"
  const allLeafTexts = metrics.leafTexts ?? []
  // All badge-column leaf texts come from cells reading "CAR --"
  // We verify via rootText that no digit-only car-number or entrant name appears
  if (/ENTRANT/u.test(metrics.rootText ?? "")) {
    fail('capture text contains an entrant name — omission entrantIdentityChannel was reintroduced')
  }
}

/**
 * omission fieldWideIntervalChannel — packet 16 gap ahead is an interval the app measures only
 * across the player pair (P4 ahead of P5 and P6 behind P5). Every other row dashes rather than
 * differencing a wrapped on-track relative.
 *
 * Assert exactly 2 gap cells carry a numeral and every other gap cell reads exactly "--.-".
 * Count is derived from the DOM, never hard-coded to a row index.
 */
function assertFieldWideIntervalOmission(metrics, numeralGapCount) {
  if (numeralGapCount !== 2) {
    fail(
      `exactly 2 gap cells must carry a numeral (the measured player pair); found ${numeralGapCount} ` +
        "(omission: fieldWideIntervalChannel)"
    )
  }
}

/**
 * `data-rc12-measured-gaps` must agree with the fixture: 2, from the player's pair only.
 */
function assertMeasuredGaps(metrics) {
  const measuredGaps = metrics.stateAttributes["measured-gaps"]
  if (measuredGaps !== "2") {
    fail(`data-rc12-measured-gaps must be "2" (player pair only), received "${measuredGaps}"`)
  }
}

/**
 * `data-rc12-field` must equal 8 (the fixture supplies a full eight-car field at every viewport).
 */
function assertFieldSize(metrics) {
  const field = metrics.stateAttributes.field
  if (field !== String(RC12_FIELD_SIZE)) {
    fail(`data-rc12-field must be "${RC12_FIELD_SIZE}", received "${field}"`)
  }
}

/**
 * Row count: assert the published data-rc12-rows attribute AND the querySelectorAll count agree
 * with the expected layout-specific value. Also assert data-rc12-row-populated="true" on exactly
 * min(field, rowCount) rows at every viewport.
 */
function assertRowCounts(metrics, entry) {
  const sizeKey = `${entry.size.width}x${entry.size.height}`
  const expected = RC12_EXPECTED_ROW_COUNTS[sizeKey]
  if (!expected) fail(`no expected row count for ${sizeKey}`)

  const publishedRowCount = metrics.stateAttributes.rows
  if (publishedRowCount !== String(expected.rowCount)) {
    fail(`data-rc12-rows must be "${expected.rowCount}" at ${sizeKey}, received "${publishedRowCount}"`)
  }
  const actualRows = countOf(metrics, "row")
  if (actualRows !== expected.rowCount) {
    fail(`querySelectorAll rc12-row must find ${expected.rowCount} at ${sizeKey}, found ${actualRows}`)
  }

  const expectedPopulated = Math.min(RC12_FIELD_SIZE, expected.rowCount)
  const actualPopulated = countOf(metrics, "populated row")
  if (actualPopulated !== expectedPopulated) {
    fail(
      `data-rc12-row-populated="true" must appear on ${expectedPopulated} rows at ${sizeKey}, found ${actualPopulated}`
    )
  }
}

/** The native-size modifier must be present only at 800x480, absent elsewhere. */
function assertNativeSize(metrics, entry) {
  const expectedNativeSize = entry.size.layout === "native" ? "800x480" : null
  if (metrics.nativeSize !== expectedNativeSize) {
    fail(
      `data-rc12-native-size must be ${String(expectedNativeSize)} at ${entry.size.width}x${entry.size.height}, ` +
        `received ${String(metrics.nativeSize)}`
    )
  }
}

/**
 * The timing channel must be "live" in both states because the fixture supplies a connected feed.
 * "delayed" or "absent" would indicate a freshness problem with the deterministic fixture.
 */
function assertTimingState(metrics) {
  const timing = metrics.stateAttributes.timing
  if (timing !== "live") {
    fail(`data-rc12-timing must be "live" with a connected fixture feed, received "${timing}"`)
  }
}

/**
 * Alert state for both scenarios.
 * silent:      data-rc12-alerts must be "silent"; no tag and no fastest-row.
 * fastest-lap: data-rc12-alerts must be "active"; exactly one tag must show.
 *              The fastest-row highlight is conditional: the fixture's fastest-lap car is P7.
 *              At compact-landscape (6 rows) P7 is beyond the visible row range, so no row is
 *              marked — the tag still shows, but the row highlight is absent. At every other
 *              layout (≥8 rows) P7 is visible and exactly one row must be marked.
 */
const RC12_FASTEST_LAP_POSITION = 7 // P7 in this fixture

function assertAlertState(metrics, entry) {
  const alerts = metrics.stateAttributes.alerts
  const rowCount = parseInt(metrics.stateAttributes.rows ?? "0", 10)
  // Whether P7 falls within the rendered rows at this viewport.
  const fastestRowVisible = rowCount >= RC12_FASTEST_LAP_POSITION

  if (entry.state === "fastest-lap") {
    if (alerts !== "active") {
      fail(`fastest-lap state must publish data-rc12-alerts="active", received "${alerts}"`)
    }
    if (countOf(metrics, "tag zone") !== 1) {
      fail(`the fastest-lap state must render exactly one rc12-tag element, found ${countOf(metrics, "tag zone")}`)
    }
    // The highlighted row is only expected when P7 is within the rowCount.
    const expectedFastestRows = fastestRowVisible ? 1 : 0
    if (countOf(metrics, "fastest row") !== expectedFastestRows) {
      fail(
        `fastest-lap state: expected ${expectedFastestRows} row(s) with data-rc12-row-fastest="true" ` +
          `(rowCount=${rowCount}, fastestLapPosition=P${RC12_FASTEST_LAP_POSITION}), found ${countOf(metrics, "fastest row")}`
      )
    }
  } else {
    if (alerts !== "silent") {
      fail(`silent state must publish data-rc12-alerts="silent", received "${alerts}"`)
    }
    if (countOf(metrics, "tag zone") !== 0) {
      fail(`the silent frame must render no rc12-tag element; found ${countOf(metrics, "tag zone")}`)
    }
    if (countOf(metrics, "fastest row") !== 0) {
      fail(`the silent frame must mark no row data-rc12-row-fastest="true"; found ${countOf(metrics, "fastest row")}`)
    }
  }
  // Neither position changes nor lead changes fire in this fixture (fixed field order).
  if (countOf(metrics, "change arrow") !== 0) {
    fail(
      `this fixture has a fixed field order; no rc12-change arrow may render, found ${countOf(metrics, "change arrow")}`
    )
  }
  if (countOf(metrics, "lead tag") !== 0) {
    fail(
      `this fixture has a fixed leader (P1 never changes); no rc12-lead-tag may render, found ${countOf(metrics, "lead tag")}`
    )
  }
}

/**
 * App-only reveals: the gap-history zone must exist at app layout only, and the safe-frame must
 * exist at native only.
 */
function assertAppOnlyReveals(metrics, entry) {
  const isApp = entry.size.layout === "app"
  const isNative = entry.size.layout === "native"
  if (countOf(metrics, "history zone") !== (isApp ? 1 : 0)) {
    fail(
      `rc12-history must exist only at app layout; found ${countOf(metrics, "history zone")} at ${entry.size.layout}`
    )
  }
  if (countOf(metrics, "safe frame") !== (isNative ? 1 : 0)) {
    fail(
      `rc12-safe-frame must exist only at native layout; found ${countOf(metrics, "safe frame")} at ${entry.size.layout}`
    )
  }
}

/**
 * The battle strip must be available (the fixture always supplies relatives) and must never be
 * in its empty state within these governed captures.
 */
function assertBattleAvailable(metrics) {
  if (countOf(metrics, "battle empty") !== 0) {
    fail(
      "the battle strip must be available for this fixture; found rc12-battle-empty, " +
        "which means neither measured gap was accepted"
    )
  }
}

// ─────────────────────────────────────────────── type-scale ladder

/**
 * The governed type ladder, from the packet 11.2 normative override `typeScale`.
 *
 * Strict descending order (passed to assertTypeScaleOrder):
 *   battle gap (72 px native) > cell gap (24 px) > cell position (22 px) > ribbon (12 px)
 *   … with the fastest-lap tag (18 px) inserted between cell position and ribbon when present.
 *
 * Separate check (NOT in the strict ladder because they tie):
 *   cell badge == cell last lap — DEFECT A, recorded in RC12_TYPE_RANK_DEFECTS.
 *
 * The ribbon (`rc12-session-time`, 12 px native) closes the ladder. Cell badge (16) and
 * cell last lap (16) sit between cell position and ribbon but are excluded from the strict
 * ladder because they tie at every viewport and both states — the defect is recorded rather
 * than tolerated. Separate strict assertions confirm:
 *   - badge < cell-position  (22 > 16 at native)
 *   - ribbon < badge         (12 < 16 at native)
 *
 * `rc12-tag` only exists in the fastest-lap state, so it can only be a ladder step there.
 */

/**
 * DEFECT RC-12/A — type-scale tie: badge == lastLap at every viewport, both states.
 *
 * Packet 11.2 puts badge and lastLap at the same scaled rung (16 px at 800x480). Both use
 * `2 cqw` from the normative override `typeScale`, so they are byte-identical at every canvas
 * width. A tie is a failure — two readouts at the same size carry no hierarchy.
 *
 * Measured at all six viewports and both states:
 *   800x480   badge 16 px   == lastLap 16 px
 *   1024x600  20.48 px      == 20.48 px
 *   393x759   7.86 px       == 7.86 px
 *   412x867   8.24 px       == 8.24 px
 *   759x393   15.18 px      == 15.18 px
 *   867x412   17.34 px      == 17.34 px
 *
 * The ledger covers all six viewports and both states; the check STILL FAILS if the tie spreads
 * to another viewport (it already covers all six) or if the rank INVERTS.
 */
const RC12_TYPE_RANK_DEFECTS = Object.freeze([
  Object.freeze({
    label: "badge over last lap",
    states: Object.freeze(["silent", "fastest-lap"]),
    sizes: Object.freeze(["800x480", "1024x600", "393x759", "412x867", "759x393", "867x412"]),
    note:
      "raceconRc12.css applies the same 2 cqw font-size to badge (.rc12-type-badge) and last lap " +
      "(.rc12-type-last) at every breakpoint: the two tier-4 columns share a single packet rung " +
      "and render at exactly the same pixel size at every canvas width (badge 16 == lastLap 16 at " +
      "native; 20.48 == 20.48 at app; 7.86 == 7.86 at compact-phone 393; etc.)"
  })
])

function assertTypeScale(metrics, entry) {
  const battleGapPx = valueOf(metrics, "battle gap").fontSize
  const cellGapPx = valueOf(metrics, "cell gap").fontSize
  const cellPositionPx = valueOf(metrics, "cell position").fontSize
  const badgePx = valueOf(metrics, "cell badge").fontSize
  const lastLapPx = valueOf(metrics, "cell last lap").fontSize
  const ribbonPx = valueOf(metrics, "session time").fontSize

  // ── Strict ladder (unambiguously descending steps) ───────────────────────────
  // In the fastest-lap state the tag element exists and belongs between cell-position and ribbon.
  // In the silent state no tag is rendered and we skip the tag step.
  const tagPx = metrics.tagFontSize ?? null

  const steps = [
    { label: "battle gap", fontSize: battleGapPx },
    { label: "cell gap",      fontSize: cellGapPx },
    { label: "cell position", fontSize: cellPositionPx }
  ]

  if (entry.state === "fastest-lap") {
    if (typeof tagPx !== "number" || !Number.isFinite(tagPx) || tagPx <= 0) {
      fail("fastest-lap state must render the rc12-tag with a measurable font size")
    }
    steps.push({ label: "tag", fontSize: tagPx })
  }

  steps.push({ label: "ribbon", fontSize: ribbonPx })

  // At compact-phone (393x759) the cqw unit is 3.93 px so cell-gap (3 cqw = 11.79 px) and
  // cell-position (2.75 cqw = 10.8075 px) are genuinely hierarchical but only 0.98 px apart —
  // below the default 1 px threshold. Using 0.5 px correctly accepts this narrow-but-real gap
  // while still catching any true tie (diff = 0).
  const scale = assertTypeScaleOrder(steps, 0.5)

  // ── Separately assert the badge/lastLap relationship ─────────────────────────
  // badge must be strictly BELOW cell-position.
  if (!(badgePx < cellPositionPx)) {
    fail(
      `type-scale hierarchy does not hold: cell-position ${cellPositionPx}px must be strictly ` +
        `larger than badge ${badgePx}px`
    )
  }
  // ribbon must be strictly BELOW badge.
  if (!(ribbonPx < badgePx)) {
    fail(
      `type-scale hierarchy does not hold: badge ${badgePx}px must be strictly larger than ribbon ${ribbonPx}px`
    )
  }

  // ── Badge == lastLap tie (DEFECT A) ──────────────────────────────────────────
  const sizeKey = `${entry.size.width}x${entry.size.height}`
  const rankDefects = []
  if (!(badgePx > lastLapPx)) {
    const waiver = RC12_TYPE_RANK_DEFECTS.find(
      (candidate) => candidate.states.includes(entry.state) && candidate.sizes.includes(sizeKey)
    )
    if (!waiver) {
      fail(
        `type-scale hierarchy does not hold: badge ${badgePx}px must be strictly larger than ` +
          `last-lap ${lastLapPx}px`
      )
    }
    // A recorded tie is never a licence to invert the rank.
    if (lastLapPx > badgePx) {
      fail(
        `last-lap ${lastLapPx}px is LARGER than badge ${badgePx}px, past the recorded tie: ${waiver.note}`
      )
    }
    rankDefects.push({
      label: waiver.label,
      state: entry.state,
      size: sizeKey,
      badgePx,
      lastLapPx,
      note: waiver.note
    })
  }

  return { steps: scale, rankDefects }
}

// ─────────────────────────────────────────────── exported validators

export function validateCaptureMetrics(metrics, entry) {
  const common = validateCommonMetrics(metrics, entry, RC12_SPEC)

  assertNativeSize(metrics, entry)
  assertTimingState(metrics)
  assertFieldSize(metrics)
  assertMeasuredGaps(metrics)
  assertRowCounts(metrics, entry)
  assertAlertState(metrics, entry)
  assertAppOnlyReveals(metrics, entry)
  assertBattleAvailable(metrics)
  assertSessionClockOmission(metrics)
  assertEntrantIdentityOmission(metrics)

  // Derive the count of gap cells that carry a numeral from the collected leaf texts.
  // Gap cells render either a numeral (e.g. "0.8") or exactly "--.-".
  // `metrics.numeralGapCount` is collected in collectMetrics.
  assertFieldWideIntervalOmission(metrics, metrics.numeralGapCount ?? 0)

  // Verify that the leaf texts for gap cells are exactly "--.-" except for the measured pair.
  if (Array.isArray(metrics.gapLeafTexts)) {
    const nonDash = metrics.gapLeafTexts.filter((text) => text !== "--.-" && /[0-9]/u.test(text))
    if (nonDash.length !== 2) {
      fail(
        `gap cells: expected exactly 2 cells with a numeral ("${nonDash.join('", "')}" found ${nonDash.length}) ` +
          "and all others reading exactly \"--.-\""
      )
    }
    const invalidDash = metrics.gapLeafTexts.filter((text) => text !== "--.-" && !/[0-9]/u.test(text))
    if (invalidDash.length !== 0) {
      fail(
        `gap cells contain unexpected non-numeral, non-dash text: "${invalidDash.join('", "')}" — ` +
          'every dashed gap cell must read exactly "--.-"'
      )
    }
  }

  // Forbidden leaf texts — omissions must never leak as printed values.
  lacksLeafText(metrics, "ENTRANT 1", "would reintroduce the omitted entrantIdentityChannel")
  lacksLeafText(metrics, "CAR 5", "would reintroduce entrant carNumber (omission: entrantIdentityChannel)")

  const { steps, rankDefects } = assertTypeScale(metrics, entry)
  return { ...common, typeScale: steps, typeRankDefects: rankDefects }
}

/**
 * The pixel audit proves:
 *  1. The frame is not blank against the RC-12 canvas colour #0A0E1A.
 *  2. CAUTION (amber #FFC93C) and DANGER (red #FF5470) are absent from EVERY frame in both states.
 *     - Caution is the TIMING DELAY indicator; this fixture has a live feed.
 *     - Danger is the position-loss arrow; this fixture has a fixed field order.
 *  3. CYAN (signature #00E0C6, the fastest-lap surface):
 *     - Must be ABSENT from every silent frame.
 *     - Must be PRESENT in every fastest-lap frame.
 *     - Must be SCOPED: every cyan pixel must fall inside the [data-testid="rc12-tag"] rectangle
 *       or the [data-rc12-row-fastest="true"] row rectangle. Stray cyan (if any) must be
 *       investigated and documented before widening the scope.
 */
export function validateCapturePixels(buffer, entry, metrics) {
  if (!isGovernedSize(entry.size)) fail(`unsupported capture pixel-audit size ${entry.size.width}x${entry.size.height}`)
  const image = decodeCapturePng(buffer, entry.size)

  const cyanScopes = Array.isArray(metrics.cyanScopes) ? metrics.cyanScopes : []
  const audit = auditHueFamilies(image, { cyan: cyanScopes })

  // 1. Frame-blank check against RC-12 canvas colour.
  let nonCanvasPixels = 0
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (!sameRgba(rgbaAt(image, x, y), RC12_CANVAS_RGBA)) nonCanvasPixels += 1
    }
  }
  if (nonCanvasPixels < RC12_MIN_NON_CANVAS_PIXELS) {
    fail("capture is blank against the RC-12 canvas colour (#0A0E1A)")
  }

  // 2. Caution absent — no TIMING DELAY note fires in this fixture.
  const amberFamily = hueFamilyOfHex(RC12_CAUTION_HEX)
  assertHueFamilyAbsent(
    audit,
    amberFamily,
    "the RC-12 frame (no TIMING DELAY and no caution alert fires from this fixture)"
  )

  // 3. Danger absent — no position-loss arrow fires in this fixture (fixed field order).
  const redFamily = hueFamilyOfHex(RC12_DANGER_HEX)
  assertHueFamilyAbsent(
    audit,
    redFamily,
    "the RC-12 frame (no position-loss arrow fires from this fixture)"
  )

  // 4. Cyan — signature #00E0C6, hue ≈173°, family "cyan".
  if (entry.state === "fastest-lap") {
    // Present and scoped.
    assertHueFamilyPresent(
      audit,
      "cyan",
      "the RC-12 fastest-lap frame — the fastest-lap tag and its highlighted row must be painted",
      1
    )
    assertHueFamilyScoped(audit, "cyan", "the RC-12 fastest-lap frame (tag + fastest row must own all cyan)")
  } else {
    // Absent — no alert fires in the silent state.
    assertHueFamilyAbsent(audit, "cyan", "the RC-12 silent frame (no alert is active)")
  }

  return {
    width: image.width,
    height: image.height,
    opaque: true,
    nonCanvasPixels,
    hueFamilies: audit.counts,
    cyanOutside: audit.outside?.cyan ?? 0
  }
}

export { CaptureSafetyError, exact, finite }
