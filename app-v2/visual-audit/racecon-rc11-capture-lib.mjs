import {
  CAPTURE_SIZES,
  CaptureSafetyError,
  assertHueFamilyAbsent,
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
  hueFamilyOfHex,
  isGovernedSize,
  lacksLeafText,
  rgbaAt,
  sameRgba,
  validateCommonMetrics
} from "./racecon-capture-shared.mjs"

export { CAPTURE_SIZES }

/**
 * RC-11 "Trace Room" — engineer analysis wall. Only what its own DOM contract, zones, channels,
 * alert families and documented packet omissions make different from the rest of the RaceCon
 * portfolio lives here. Everything generic comes from `racecon-capture-shared.mjs`.
 *
 * Governance: approved attempt-004 (rc11-governance-chain-v1.json verdict APPROVED).
 */

export const RC11_PRESET_ID = "racecon_rc11_dash"
export const RC11_WIDGET_ID = "raceconRc11Dash"
export const RC11_SOURCE_IDENTITY = "iracing:session:113:connection:5"

/** Two governed scenarios: the silent frame and the engaged DATA GAP frame. */
export const CAPTURE_STATES = Object.freeze(["silent", "data-gap"])

/**
 * RC-11 colour tokens, verbatim from raceconRc11Core.ts RC11_TOKENS:
 *   bg '#0E1116', panel '#171C24', primary '#E6EBF0', secondary '#8A97A6',
 *   info '#4FC3F7', normal '#66BB6A', caution '#FFB300', danger '#EF5350', signature '#AB47BC'.
 *
 * The three tokens that must measure ZERO pixels everywhere in both governed states (per
 * RC11_SILENT_TOKENS — this fixture never triggers lock-up, lift/coast or any alarm):
 *   - `normal`  #66BB6A (green  family)
 *   - `caution` #FFB300 (amber  family)
 *   - `danger`  #EF5350 (red    family)
 *
 * The token that proves the widget rendered a useful frame on every capture:
 *   - `info`    #4FC3F7 (cyan   family) — the current-speed trace is always painted.
 *
 * Measured hue-family census across all six viewports and both states:
 *   red 0, amber 0, green 0 everywhere; cyan 2 777–4 608; blue 1 050–2 015; violet 0–8.
 * The DATA GAP band is `#8a97a633` (neutral/transparent), so it does NOT land in any colour
 * family — its presence is proved from the DOM and from geometry, not from hue.
 */
export const RC11_CANVAS_RGBA = Object.freeze([14, 17, 22, 255]) // bg #0E1116
export const RC11_INFO_HEX = "#4FC3F7"      // cyan — current-speed trace, always painted
export const RC11_NORMAL_HEX = "#66BB6A"    // normal/green — must be absent (no alert triggers)
export const RC11_CAUTION_HEX = "#FFB300"   // caution/amber — must be absent (no alert triggers)
export const RC11_DANGER_HEX = "#EF5350"    // danger/red — must be absent (no alert triggers)

/** A blank frame has fewer than this many non-canvas pixels. */
export const RC11_MIN_NON_CANVAS_PIXELS = 5_000

/**
 * The governed type ladder (strictly descending, measured px values quoted verbatim from the task
 * brief — verified against running harness output):
 *
 *   rank 0  tile value     `rc11-tyreFl`          28 native / 35.84 app / 13.76 … 30.34 compact
 *   rank 1  cursor readout `rc11-cursor-speed`    22 native / 28.16 app / 10.81 … 23.84 compact
 *   rank 2  axis label     `rc11-distance-tick`   14 native / 17.92 app /  6.88 … 15.17 compact
 *
 * Each step is a STRICT inequality: a tie is a failure. If a tie is observed it must be recorded
 * as a defect (see RC09_TYPE_RANK_DEFECTS pattern) rather than tolerated silently.
 */
export const RC11_TYPE_SCALE_STEPS = Object.freeze([
  "tile value",
  "cursor readout",
  "axis label"
])

/**
 * THE most important numbers in RC-11: the four distance-domain panels share ONE axis so a
 * vertical cursor reads the SAME distance in all four. Packet 11 declares:
 *   native   x = 70 … 520 px  (450 px span on an 800 px canvas)
 *   app      x = 88 … 718 px  (630 px span on a 1024 px canvas)
 * MEASURED at native: all four `rc11-plot` elements have left=71, width=448 relative to the
 * capture root (a 1 px border inset each side of the declared 70..520). The harness asserts
 * equality across panels, NOT fixed absolute positions: what matters is that all four agree.
 */
export const RC11_NATIVE_PLOT_X0 = 70
export const RC11_NATIVE_PLOT_X1 = 520
export const RC11_APP_PLOT_X0 = 88
export const RC11_APP_PLOT_X1 = 718

/** Fixed DOM counts asserted on every frame at every viewport (task brief §"Fixed counts"). */
export const RC11_PLOT_COUNT = 4
export const RC11_CURSOR_COUNT = 4
export const RC11_DISTANCE_TICK_COUNT = 5
export const RC11_GG_RING_COUNT = 2
export const RC11_GG_RING_LABEL_COUNT = 2
export const RC11_TILE_COUNT = 3

/**
 * Legend entry counts per layout (task brief §"steeringAt800"):
 *   native / compact — 2 entries (throttle + brake)
 *   app             — 3 entries (throttle + brake + steering)
 */
export const RC11_LEGEND_ENTRIES_NATIVE_COMPACT = 2
export const RC11_LEGEND_ENTRIES_APP = 3

export const RC11_SPEC = Object.freeze({
  artifact: "RaceCon RC-11",
  script: "racecon-rc11-capture.mjs",
  presetId: RC11_PRESET_ID,
  widgetId: RC11_WIDGET_ID,
  attrPrefix: "data-rc11-",
  rootSelector: "#racecon-rc11-capture-root",
  captureHtml: "racecon-rc11-capture.html",
  dashboardSelector: ".rc11-dashboard",
  sourceIdentity: RC11_SOURCE_IDENTITY,
  stateAttributes: Object.freeze([
    "alerts",
    "reference"
  ]),
  /**
   * Six peer zones present at every governed viewport. `rc11-panel-sectors` is an app-only reveal
   * and is checked in `assertAppOnlyReveals` rather than in the shared zone-overlap sweep.
   */
  zones: Object.freeze([
    Object.freeze(["speed",  '[data-testid="rc11-panel-speed"]']),
    Object.freeze(["inputs", '[data-testid="rc11-panel-inputs"]']),
    Object.freeze(["gear",   '[data-testid="rc11-panel-gear"]']),
    Object.freeze(["delta",  '[data-testid="rc11-panel-delta"]']),
    Object.freeze(["gg",     '[data-testid="rc11-panel-gg"]']),
    Object.freeze(["tiles",  '[data-testid="rc11-panel-tiles"]'])
  ]),
  zoneOverlapExemptions: Object.freeze([]),
  /**
   * Values measured for the type ladder and readout text assertions.
   * The axis-label entry resolves the FIRST `rc11-distance-tick` in document order, which is
   * sufficient for the type ladder and for verifying that the text is the dash placeholder.
   * This artifact publishes <output> elements (spec.readoutSelector is NOT set).
   */
  values: Object.freeze([
    Object.freeze(["tile tyreFl",    '[data-testid="rc11-tyreFl"]']),
    Object.freeze(["cursor speed",   '[data-testid="rc11-cursor-speed"]']),
    Object.freeze(["cursor delta",   '[data-testid="rc11-cursor-delta"]']),
    Object.freeze(["tile tyreFr",    '[data-testid="rc11-tyreFr"]']),
    Object.freeze(["tile brakeTempF",'[data-testid="rc11-brakeTempF"]']),
    Object.freeze(["axis label",     '[data-testid="rc11-distance-tick"]'])
  ]),
  containment: Object.freeze([
    Object.freeze(["tile tyreFl",    '[data-testid="rc11-panel-tiles"]', '[data-testid="rc11-tyreFl"]']),
    Object.freeze(["tile tyreFr",    '[data-testid="rc11-panel-tiles"]', '[data-testid="rc11-tyreFr"]']),
    Object.freeze(["tile brakeTempF",'[data-testid="rc11-panel-tiles"]', '[data-testid="rc11-brakeTempF"]']),
    Object.freeze(["cursor speed",   '[data-testid="rc11-panel-speed"]',  '[data-testid="rc11-cursor-speed"]']),
    Object.freeze(["cursor delta",   '[data-testid="rc11-panel-delta"]',  '[data-testid="rc11-cursor-delta"]'])
  ]),
  counted: Object.freeze([
    Object.freeze(["plot",              '[data-testid="rc11-plot"]']),
    Object.freeze(["cursor",            '[data-testid="rc11-cursor"]']),
    Object.freeze(["distance tick",     '[data-testid="rc11-distance-tick"]']),
    Object.freeze(["gg ring",           '[data-testid="rc11-gg-ring"]']),
    Object.freeze(["gg ring label",     '[data-testid="rc11-gg-ring-label"]']),
    Object.freeze(["tile",              '[data-testid="rc11-tile"]']),
    Object.freeze(["sector row",        '[data-testid="rc11-sector-row"]']),
    Object.freeze(["sector notice",     '[data-testid="rc11-sector-notice"]']),
    Object.freeze(["gap band",          '[data-testid="rc11-gap"]']),
    // perWheelSpeedChannel omission: lock-up can never fire (no per-corner wheel speed channel).
    Object.freeze(["lockup marker",     '[data-testid="rc11-marker"][data-rc11-marker="lockUp"]']),
    // steeringAt800 omission: steering trace is app-only.
    Object.freeze(["steering series",   '[data-testid="rc11-panel-inputs"] [data-rc11-series="steering"]']),
    // Legend entry counts are checked per panel.
    Object.freeze(["speed legend entry",  '[data-testid="rc11-legend-speed"] [data-testid="rc11-legend-entry"]']),
    Object.freeze(["inputs legend entry", '[data-testid="rc11-legend-inputs"] [data-testid="rc11-legend-entry"]'])
  ]),
  /**
   * omission rpmZone: packet 16 RPM and packet 11.4 rpm-trace option have no zone in 11.1 or 12.1.
   * No trace, no numeral, and above all no LED arc.
   * omission legendDivider: normative override 2 — no visible divider between plot and legend regions.
   * omission fixedTroughCount: packet 17 specifies five braking troughs; trough count is DATA.
   */
  forbidden: Object.freeze([
    Object.freeze([
      "an rpm trace, numeral or LED arc (omission: rpmZone)",
      '[data-rc11-series="rpm"], [data-testid="rc11-panel-rpm"], .rc11-led, .rc11-rev, [data-rc11-zone="rpm"]'
    ]),
    Object.freeze([
      "a legend divider (omission: legendDivider)",
      ".rc11-legend-divider"
    ]),
    Object.freeze([
      "a trough element (omission: fixedTroughCount)",
      '[data-testid="rc11-trough"]'
    ])
  ]),
  /**
   * The measured DATA GAP label overflow has been corrected. This ledger is intentionally empty so
   * the harness fails closed on recurrence - any new overflow leaf is an unconditional hard failure.
   */
  knownDefects: Object.freeze([]),
  zoneOverflowDefects: Object.freeze([]),
  containmentDefects: Object.freeze([])
})

export const RC11_CAPTURE_MATRIX = Object.freeze(
  CAPTURE_STATES.flatMap((state) =>
    CAPTURE_SIZES.map((size) =>
      Object.freeze({
        size,
        state,
        // silent: the buffer has accepted frames but no gap bands → alerts attribute stays "silent".
        // data-gap: gap bands exist in the trace history → alerts attribute flips to "active".
        required: Object.freeze(
          state === "data-gap"
            ? [Object.freeze(["alerts", "active"])]
            : [Object.freeze(["alerts", "silent"])]
        )
      })
    )
  )
)

/* ── Helpers (mirrors RC-09 lib conventions) ──────────────────────────────────────────────── */

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

/* ── Native-size modifier ─────────────────────────────────────────────────────────────────── */

function assertNativeSize(metrics, entry) {
  const expected = entry.size.layout === "native" ? "800x480" : null
  if (metrics.nativeSize !== expected) {
    fail(`native content-box modifier must be ${String(expected)}, received ${String(metrics.nativeSize)}`)
  }
}

/* ── HEADLINE ASSERTION: shared plot axis ─────────────────────────────────────────────────── */

/**
 * RC-11's headline contract: all four distance-domain panels share ONE plot axis. The harness
 * PROVES it by measuring getBoundingClientRect on every rc11-plot element (not by trusting
 * attributes), then checking:
 *   (a) all four measured `left` values are equal within 0.02 px,
 *   (b) all four measured `width` values are equal within 0.02 px,
 *   (c) all four declared data-rc11-plot-x0 / data-rc11-plot-x1 strings are identical,
 *   (d) at native the declared pair is exactly "70"/"520"; at app exactly "88"/"718".
 *
 * Also asserts the four rc11-cursor elements share the same measured `left` (one scrub cursor
 * tying four panels) — the cursor `left` is measured, never trusted from data-rc11-cursor-x.
 */
function assertSharedAxis(metrics, entry) {
  const plots = metrics.plotRects ?? []
  if (plots.length !== RC11_PLOT_COUNT) {
    fail(`expected ${RC11_PLOT_COUNT} plot regions, found ${plots.length}`)
  }
  const cursors = metrics.cursorRects ?? []
  if (cursors.length !== RC11_CURSOR_COUNT) {
    fail(`expected ${RC11_CURSOR_COUNT} cursor elements, found ${cursors.length}`)
  }

  // (a)+(b) All four plot rects share the same measured left and width.
  const referenceLeft  = finite(plots[0].left,  "plot[0].left")
  const referenceWidth = finite(plots[0].width, "plot[0].width")
  for (let index = 1; index < plots.length; index += 1) {
    const plot = plots[index]
    if (Math.abs(plot.left  - referenceLeft)  > 0.02) {
      fail(
        `shared-axis violation: plot[${index}] (${plot.plotId}) left=${plot.left.toFixed(3)} differs ` +
        `from plot[0] (${plots[0].plotId}) left=${referenceLeft.toFixed(3)} by more than 0.02 px`
      )
    }
    if (Math.abs(plot.width - referenceWidth) > 0.02) {
      fail(
        `shared-axis violation: plot[${index}] (${plot.plotId}) width=${plot.width.toFixed(3)} differs ` +
        `from plot[0] (${plots[0].plotId}) width=${referenceWidth.toFixed(3)} by more than 0.02 px`
      )
    }
  }

  // (c) All four declared x0/x1 attribute strings are identical.
  const x0String = plots[0].attrX0
  const x1String = plots[0].attrX1
  for (let index = 1; index < plots.length; index += 1) {
    if (plots[index].attrX0 !== x0String) {
      fail(
        `shared-axis violation: plot[${index}] (${plots[index].plotId}) data-rc11-plot-x0="${plots[index].attrX0}" ` +
        `differs from plot[0] "${x0String}"`
      )
    }
    if (plots[index].attrX1 !== x1String) {
      fail(
        `shared-axis violation: plot[${index}] (${plots[index].plotId}) data-rc11-plot-x1="${plots[index].attrX1}" ` +
        `differs from plot[0] "${x1String}"`
      )
    }
  }

  // (d) At native the declared pair must be exactly "70"/"520"; at app exactly "88"/"718".
  if (entry.size.layout === "native") {
    if (x0String !== String(RC11_NATIVE_PLOT_X0) || x1String !== String(RC11_NATIVE_PLOT_X1)) {
      fail(
        `native shared-axis declaration must be "${RC11_NATIVE_PLOT_X0}"/"${RC11_NATIVE_PLOT_X1}", ` +
        `received "${x0String}"/"${x1String}"`
      )
    }
  } else if (entry.size.layout === "app") {
    if (x0String !== String(RC11_APP_PLOT_X0) || x1String !== String(RC11_APP_PLOT_X1)) {
      fail(
        `app shared-axis declaration must be "${RC11_APP_PLOT_X0}"/"${RC11_APP_PLOT_X1}", ` +
        `received "${x0String}"/"${x1String}"`
      )
    }
  }

  // Cursor left: all four rc11-cursor elements must share the same measured left value, so that a
  // vertical cursor line reads the same ordinate in every panel simultaneously.
  const cursorLeft = finite(cursors[0].left, "cursor[0].left")
  for (let index = 1; index < cursors.length; index += 1) {
    if (Math.abs(cursors[index].left - cursorLeft) > 0.02) {
      fail(
        `scrub-cursor alignment violation: cursor[${index}] (panel ${cursors[index].panelId}) ` +
        `left=${cursors[index].left.toFixed(3)} differs from cursor[0] (panel ${cursors[0].panelId}) ` +
        `left=${cursorLeft.toFixed(3)} by more than 0.02 px`
      )
    }
  }

  return {
    plotLeft:   referenceLeft,
    plotWidth:  referenceWidth,
    attrX0:     x0String,
    attrX1:     x1String,
    cursorLeft,
    allPlotRects: plots
  }
}

/* ── Packet omissions ─────────────────────────────────────────────────────────────────────── */

/**
 * omission lapDistanceChannel — section 16 defines no distance channel. The distance axis is
 * drawn but every one of its five ticks renders the "--" dash placeholder; no metre, kilometre,
 * lap or sector numeral appears anywhere in the frame. A digit in any tick is a reintroduction.
 */
function assertLapDistanceOmission(metrics) {
  const tickCount = countOf(metrics, "distance tick")
  if (tickCount !== RC11_DISTANCE_TICK_COUNT) {
    fail(
      `distance axis must render exactly ${RC11_DISTANCE_TICK_COUNT} ticks, found ${tickCount} ` +
        "(omission: lapDistanceChannel)"
    )
  }
  const ticks = metrics.distanceTickTexts ?? []
  for (let index = 0; index < ticks.length; index += 1) {
    const text = ticks[index]
    if (text !== "--") {
      fail(
        `distance tick ${index} reads "${text}" instead of "--" — ` +
          "a non-dash string reintroduces omission lapDistanceChannel"
      )
    }
    if (/[0-9]/u.test(text)) {
      fail(
        `distance tick ${index} contains a digit "${text}" — ` +
          "this reintroduces omission lapDistanceChannel"
      )
    }
  }
  // Also guard against any digit appearing in the full frame text (lap, sector or distance numeral).
  const distanceAxis = metrics.distanceAxisText ?? ""
  if (/\bDISTANCE\b/.test(distanceAxis)) {
    // The title "DISTANCE" is expected; a decimal numeral alongside it is not.
    const digits = distanceAxis.replace("DISTANCE", "").match(/[0-9]/u)
    if (digits) {
      fail(
        `distance axis contains a digit "${digits[0]}" alongside "DISTANCE" — ` +
          "this reintroduces omission lapDistanceChannel"
      )
    }
  }
}

/**
 * omission perWheelSpeedChannel — the lock-up flag can never fire. Assert 0 lock-up markers
 * in BOTH states.
 */
function assertPerWheelSpeedOmission(metrics) {
  const lockupCount = countOf(metrics, "lockup marker")
  if (lockupCount !== 0) {
    fail(
      `${lockupCount} lockUp marker(s) rendered — the per-wheel-speed channel is absent so the ` +
        "lock-up trigger is structurally unreachable (omission: perWheelSpeedChannel)"
    )
  }
}

/**
 * omission steeringAt800 — the steering trace is app-only (packet 11.1 gives it no 800x480 zone;
 * 12.1 adds it only at 1024x600). Assert series count = 0 at native and compact, = 1 at app.
 * Legend entries: 2 at native/compact (throttle + brake), 3 at app (+ steering).
 */
function assertSteeringOmission(metrics, entry) {
  const steeringCount = countOf(metrics, "steering series")
  const isApp = entry.size.layout === "app"
  const expectedSteering = isApp ? 1 : 0
  if (steeringCount !== expectedSteering) {
    fail(
      `steering series count must be ${expectedSteering} at ${entry.size.layout}, found ${steeringCount} ` +
        "(omission: steeringAt800)"
    )
  }
  // The inputs legend adds a steering entry at app size (throttle + brake → throttle + brake + steer).
  // The speed legend is always 2 entries (current + reference) at every layout.
  const expectedInputsLegendEntries = isApp ? RC11_LEGEND_ENTRIES_APP : RC11_LEGEND_ENTRIES_NATIVE_COMPACT
  const inputsLegendCount = countOf(metrics, "inputs legend entry")
  if (inputsLegendCount !== expectedInputsLegendEntries) {
    fail(
      `inputs legend must have ${expectedInputsLegendEntries} entries at ${entry.size.layout}, ` +
        `found ${inputsLegendCount} (omission: steeringAt800)`
    )
  }
  // Speed legend: always 2 (CURRENT + REFERENCE), regardless of layout.
  const speedLegendCount = countOf(metrics, "speed legend entry")
  if (speedLegendCount !== RC11_LEGEND_ENTRIES_NATIVE_COMPACT) {
    fail(
      `speed legend must always have ${RC11_LEGEND_ENTRIES_NATIVE_COMPACT} entries ` +
        `(CURRENT + REFERENCE), found ${speedLegendCount} at ${entry.size.layout}`
    )
  }
}

/* ── App-only reveals ─────────────────────────────────────────────────────────────────────── */

/**
 * The mini-sector table is revealed at app size only (packet 12.1). At every other viewport it
 * must be absent. When present, it must carry NO rows (section 16 defines no sector channel) and
 * must state its unavailability with the "NO SECTOR SOURCE" notice.
 */
function assertAppOnlyReveals(metrics, entry) {
  const isApp = entry.size.layout === "app"
  const sectorPanelCount = metrics.sectorPanelPresent ? 1 : 0
  const sectorRowCount   = countOf(metrics, "sector row")
  const sectorNoticeCount = countOf(metrics, "sector notice")

  if (isApp) {
    if (!metrics.sectorPanelPresent) {
      fail("the mini-sector table must be present at app size (packet 12.1 reveal)")
    }
    // RC11_PACKET_OMISSIONS.lapDistanceChannel: no sector channel → zero rows is the contract.
    if (sectorRowCount !== 0) {
      fail(
        `the mini-sector table must render 0 rows at app size (no sector channel — ` +
          `omission: lapDistanceChannel), found ${sectorRowCount}`
      )
    }
    if (sectorNoticeCount !== 1) {
      fail(
        `the mini-sector table must render exactly 1 unavailability notice ("NO SECTOR SOURCE"), ` +
          `found ${sectorNoticeCount}`
      )
    }
  } else {
    if (sectorPanelCount !== 0) {
      fail(
        `the mini-sector table must be absent outside the app layout, ` +
          `found ${sectorPanelCount} at ${entry.size.layout}`
      )
    }
    if (sectorRowCount !== 0) {
      fail(`no sector rows may render outside the app layout, found ${sectorRowCount}`)
    }
    if (sectorNoticeCount !== 0) {
      fail(`no sector notice may render outside the app layout, found ${sectorNoticeCount}`)
    }
  }
}

/* ── State-specific assertions ────────────────────────────────────────────────────────────── */

/**
 * `data-rc11-alerts` must agree with the governed state:
 *   silent   → "silent" (no gap bands in trace history)
 *   data-gap → "active" (gap bands exist in trace history)
 *
 * In the data-gap state, the DATA GAP band is proved from the DOM (`rc11-gap` elements) and from
 * the alert attribute, NOT from hue: the band is painted `#8a97a633` (neutral/transparent) and
 * carries no hue-family pixels.
 */
function assertAlertState(metrics, entry) {
  const alertsAttr = metrics.stateAttributes.alerts
  const gapCount   = countOf(metrics, "gap band")

  if (entry.state === "data-gap") {
    if (alertsAttr !== "active") {
      fail(
        `data-gap state must publish data-rc11-alerts="active", received "${alertsAttr}"`
      )
    }
    if (gapCount === 0) {
      fail(
        "data-gap state must have at least one rc11-gap element; none found — " +
          "the gap bands are the proof of the engaged state"
      )
    }
    // Prove the gap-band geometry: at least one rc11-gap element must have non-zero measured width.
    const gapRects = metrics.gapRects ?? []
    const anyVisible = gapRects.some((rect) => rect && rect.width > 0.5)
    if (!anyVisible) {
      fail(
        "data-gap state: no rc11-gap element has measurable width — " +
          "the DATA GAP band must have visible geometry"
      )
    }
  } else {
    if (alertsAttr !== "silent") {
      fail(
        `silent state must publish data-rc11-alerts="silent", received "${alertsAttr}"`
      )
    }
    if (gapCount !== 0) {
      fail(
        `silent state must not render gap-band elements; found ${gapCount}`
      )
    }
  }
}

/* ── Fixed counts ─────────────────────────────────────────────────────────────────────────── */

function assertFixedCounts(metrics) {
  const plotCount        = countOf(metrics, "plot")
  const cursorCount      = countOf(metrics, "cursor")
  const tickCount        = countOf(metrics, "distance tick")  // also asserted in assertLapDistanceOmission
  const ggRingCount      = countOf(metrics, "gg ring")
  const ggRingLabelCount = countOf(metrics, "gg ring label")
  const tileCount        = countOf(metrics, "tile")

  if (plotCount        !== RC11_PLOT_COUNT)           fail(`expected ${RC11_PLOT_COUNT} rc11-plot elements, found ${plotCount}`)
  if (cursorCount      !== RC11_CURSOR_COUNT)         fail(`expected ${RC11_CURSOR_COUNT} rc11-cursor elements, found ${cursorCount}`)
  if (tickCount        !== RC11_DISTANCE_TICK_COUNT)  fail(`expected ${RC11_DISTANCE_TICK_COUNT} rc11-distance-tick elements, found ${tickCount}`)
  if (ggRingCount      !== RC11_GG_RING_COUNT)        fail(`expected ${RC11_GG_RING_COUNT} rc11-gg-ring elements, found ${ggRingCount}`)
  if (ggRingLabelCount !== RC11_GG_RING_LABEL_COUNT)  fail(`expected ${RC11_GG_RING_LABEL_COUNT} rc11-gg-ring-label elements, found ${ggRingLabelCount}`)
  if (tileCount        !== RC11_TILE_COUNT)           fail(`expected ${RC11_TILE_COUNT} rc11-tile elements, found ${tileCount}`)
}

/* ── Type scale ───────────────────────────────────────────────────────────────────────────── */

/**
 * Three strictly descending steps: tile value > cursor readout > axis label.
 * A tie is a failure: two readouts at the same size carry no hierarchy.
 * RC-11 has no documented compact-phone rank collapse (unlike RC-09's split/note collapse).
 */
function assertTypeScale(metrics) {
  const tileValue    = valueOf(metrics, "tile tyreFl").fontSize
  const cursorSpeed  = valueOf(metrics, "cursor speed").fontSize
  const axisLabel    = valueOf(metrics, "axis label").fontSize

  return assertTypeScaleOrder([
    { label: "tile value",    fontSize: tileValue },
    { label: "cursor readout",fontSize: cursorSpeed },
    { label: "axis label",    fontSize: axisLabel }
  ])
}

/**
 * REGRESSION GUARD RC-11/1 - DATA GAP label stays inside its measured band.
 *
 * The label overflowed the band that owns it at all six governed viewports (800x480, 1024x600,
 * 393x759, 412x867, 759x393, 867x412) in the data-gap state. The fix makes the label read down
 * the band (`writing-mode: vertical-rl`, `max-block-size: 100%`), so `.rc11-gap-label` must never
 * appear in `metrics.overflowLeaves` at any viewport or state. If a capture exposes direct
 * gap-label geometry, the label rect must also be contained by the owning band rect.
 */
function assertGapLabelContained(metrics) {
  const gapLabelLeaf = (metrics.overflowLeaves ?? []).find((leaf) => leaf.key === "rc11-gap-label")
  if (gapLabelLeaf) {
    fail(
      `REGRESSION GUARD RC-11/1: rc11-gap-label "${gapLabelLeaf.text ?? "DATA GAP"}" ` +
      `overflows its DATA GAP band by ${finite(gapLabelLeaf.overflowX, "rc11-gap-label overflowX")}px - ` +
      "the vertical DATA GAP label must fit the band that owns it at every viewport and state"
    )
  }
}

/* ── Export: validateCaptureMetrics ──────────────────────────────────────────────────────── */

export function validateCaptureMetrics(metrics, entry) {
  assertGapLabelContained(metrics)

  const common = validateCommonMetrics(metrics, entry, RC11_SPEC)

  assertNativeSize(metrics, entry)
  assertFixedCounts(metrics)

  // Readout text: tile values must be non-dashed real numbers from the fixture.
  const tyreFl = valueOf(metrics, "tile tyreFl")
  const tyreFr = valueOf(metrics, "tile tyreFr")
  const brakeTempF = valueOf(metrics, "tile brakeTempF")
  assertNoHorizontalOverflow(tyreFl.rect, "tyreFl tile value")
  assertNoHorizontalOverflow(tyreFr.rect, "tyreFr tile value")
  assertNoHorizontalOverflow(brakeTempF.rect, "brakeTempF tile value")

  // Packet omissions — each asserts the absence-is-the-contract for its documented channel.
  assertLapDistanceOmission(metrics)
  assertPerWheelSpeedOmission(metrics)
  assertSteeringOmission(metrics, entry)

  // App-only reveals.
  assertAppOnlyReveals(metrics, entry)

  // Alert state vs governed capture state.
  assertAlertState(metrics, entry)

  // HEADLINE ASSERTION: the shared plot axis.
  const axisProof = assertSharedAxis(metrics, entry)

  // Type ladder.
  const typeScale = assertTypeScale(metrics)

  return {
    ...common,
    typeScale,
    sharedAxis: axisProof
  }
}

/* ── Export: validateCapturePixels ───────────────────────────────────────────────────────── */

/**
 * The pixel audit proves:
 *  1. the frame is not blank against the RC-11 canvas #0E1116;
 *  2. the CAUTION (amber #FFB300), DANGER (red #EF5350) and NORMAL (green #66BB6A) families
 *     measure exactly zero on EVERY frame in both states — no alert can fire from this fixture
 *     (RC11_SILENT_TOKENS = ['normal', 'caution', 'danger']), and the DATA GAP band is neutral;
 *  3. the INFO (cyan #4FC3F7) family is present on every frame — the current-speed trace always
 *     paints a solid cyan line across the full plot span.
 *
 * Hue families are confirmed by hue angle (hueFamilyOfHex), never by channel ratio.
 */
export function validateCapturePixels(buffer, entry, _metrics) {
  if (!isGovernedSize(entry.size)) fail(`unsupported capture pixel-audit size ${entry.size.width}x${entry.size.height}`)
  const image = decodeCapturePng(buffer, entry.size)
  const audit = auditHueFamilies(image, {})

  let nonCanvasPixels = 0
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (!sameRgba(rgbaAt(image, x, y), RC11_CANVAS_RGBA)) nonCanvasPixels += 1
    }
  }
  if (nonCanvasPixels < RC11_MIN_NON_CANVAS_PIXELS) {
    fail("capture is blank against the RC-11 canvas colour (#0E1116)")
  }

  // Caution/amber, danger/red and normal/green must ALL be absent: this fixture never triggers
  // a lock-up, lift/coast or any live alarm (RC11_SILENT_TOKENS), and the DATA GAP band is neutral.
  const cautionFamily = hueFamilyOfHex(RC11_CAUTION_HEX)  // "amber"
  const dangerFamily  = hueFamilyOfHex(RC11_DANGER_HEX)   // "red"
  const normalFamily  = hueFamilyOfHex(RC11_NORMAL_HEX)   // "green"
  const infoFamily    = hueFamilyOfHex(RC11_INFO_HEX)     // "cyan"

  assertHueFamilyAbsent(
    audit,
    cautionFamily,
    `the RC-11 frame (no caution alert fires from this fixture — RC11_SILENT_TOKENS.caution)`
  )
  assertHueFamilyAbsent(
    audit,
    dangerFamily,
    `the RC-11 frame (no danger alert fires from this fixture — RC11_SILENT_TOKENS.danger)`
  )
  assertHueFamilyAbsent(
    audit,
    normalFamily,
    `the RC-11 frame (no normal alert fires from this fixture — RC11_SILENT_TOKENS.normal)`
  )

  // The current-speed trace is info/cyan #4FC3F7 and is always drawn as a solid line across the
  // full shared plot span; measured 2 777–4 608 cyan pixels per frame across all viewports.
  assertHueFamilyPresent(
    audit,
    infoFamily,
    `the RC-11 frame — the current-speed trace (info #4FC3F7) must always be painted`,
    100
  )

  return {
    width:            image.width,
    height:           image.height,
    opaque:           true,
    nonCanvasPixels,
    hueFamilies:      audit.counts,
    cautionFamily,
    dangerFamily,
    normalFamily,
    infoFamily
  }
}

export { CaptureSafetyError, exact, finite }
