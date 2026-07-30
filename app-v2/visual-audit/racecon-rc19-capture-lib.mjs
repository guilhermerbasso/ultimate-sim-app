import {
  CAPTURE_SIZES,
  CaptureSafetyError,
  assertHueFamilyAbsent,
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
  hueFamilyOfHex,
  isGovernedSize,
  lacksLeafText,
  validateCommonMetrics
} from "./racecon-capture-shared.mjs"

export { CAPTURE_SIZES }

/**
 * RC-19 "Hand Over — Endurance Driver-Swap Handover" render-QA harness.
 *
 * Approved reference: attempt-003. `rc19-governance-chain-v1.json` records
 * `"approved": "attempt-003"`, `"verdict": "APPROVED"`,
 * `"approvedDerivative": { "attempt": "attempt-003" }`.
 * Title: "Hand Over — Endurance Driver-Swap Handover". Only attempts 001–003 exist.
 *
 * This module owns only what the RC-19 DOM contract, zones, channels, alert families and
 * documented packet omissions make different from the rest of the RaceCon portfolio. Every
 * generic mechanism — the viewport matrix, geometry helpers, the capture lifecycle, the
 * disk-safety primitives — comes from `racecon-capture-shared.mjs` unchanged.
 */

export const RC19_PRESET_ID = "racecon_rc19_dash"
export const RC19_WIDGET_ID = "raceconRc19Dash"
export const RC19_SOURCE_IDENTITY = "iracing:session:91:connection:7"
export const RC19_DASH = "--"

/** Three governed scenarios: the alert-strip geometry proof, the approved silent frame, and
 * the nine-not-eight cold-mount dash count proof. */
export const CAPTURE_STATES = Object.freeze(["cold-mount", "handover", "ready"])

// ─────────────────────────────────────────────────────────── colour tokens

/**
 * Packet 11.3 colour tokens as shipped.
 *
 *   bg        #0A0D11 → rgb(10,13,17)   → neutral (near-black)
 *   signature #34E0C0 → hue ≈ 168.8°   → "cyan"
 *   info      #40BEDC → hue ≈ 191.5°   → "cyan"  ← COLLISION WITH SIGNATURE
 *   normal    #46C86E → hue ≈ 138.5°   → "green"
 *   caution   #FFB52E → hue ≈ 38.7°    → "amber"
 *   danger    #FF3F30 → hue ≈ 4.35°    → "red"
 *
 * NOTE: `info (#40BEDC)` and `signature (#34E0C0)` both classify as "cyan" under the
 * `hueFamily` function. They cannot be separated by hue family alone. The harness asserts
 * the strongest true statement — "cyan is present" — rather than a per-token check that
 * can never fail. Their separation is proved by role (section titles vs outstanding/confirm),
 * never by hue, as the brief requires.
 *
 * NOTE: `info (#40BEDC)` and `normal (#46C86E)` have a luminance gap of EXACTLY ZERO
 * (≈ 0.648 vs 0.650 on the sRGB linear scale). A luminance threshold cannot separate them;
 * hue can — info is cyan, normal is green. The test suite includes a dedicated case that
 * demonstrates this and proves hue-family classification works where luminance fails.
 */
export const RC19_SIGNATURE_HEX = "#34E0C0"   // section titles — cyan
export const RC19_INFO_HEX      = "#40BEDC"   // outstanding count; armed confirm — also cyan
export const RC19_NORMAL_HEX    = "#46C86E"   // confirmed checklist glyph/state; latched confirm — green
export const RC19_CAUTION_HEX   = "#FFB52E"   // carried-fault chip; note surface — amber
export const RC19_DANGER_HEX    = "#FF3F30"   // alerts strip; blocking checklist rows — red
export const RC19_CANVAS_RGBA   = Object.freeze([10, 13, 17, 255])   // bg #0A0D11

/**
 * Packet 11.2 type scale as shipped.
 * Strict ordering: readiness (40) > value (30) > item (24) > label (15).
 * A tie anywhere is a failure — two readouts at the same size carry no hierarchy.
 */
export const RC19_TYPE_SCALE_PX = Object.freeze({
  readiness: 40,
  value:     30,
  item:      24,
  label:     15
})

// ─────────────────────────────────────────────────────────── expected values

/**
 * The approved attempt-003 reference channel values. These are the only values `validateCaptureMetrics`
 * is allowed to assert in the `ready` state.
 */
export const RC19_EXPECTED_VALUES = Object.freeze({
  outstanding:  "2 OUTSTANDING",
  fuelLaps:     "12.6",
  fuelPerLap:   "2.94",
  stintLaps:    "28",
  tc:           "4",
  faultsNone:   "NONE ACTIVE",
  confirmLabel: "CONFIRM READY",
  tyreLf:       "1.94",
  tyreRf:       "1.97",
  tyreLr:       "1.91",
  tyreRr:       RC19_DASH
})

/**
 * Cold-mount: 9 dashes. The 8 are the four GAP-3/GAP-4 cells (ABS, MAP, BIAS = 3 settings +
 * RR tyre) plus the four next-stint dashes (TARGET LAPS, FUEL PLAN, TIRE PLAN, WEATHER). STINT
 * LAPS is the 9th because no pit exit was ever observed. After an observed pit exit STINT LAPS
 * resolves to "28", leaving only 8 dashes.
 *
 * App layout adds rc19-water-temp and rc19-voltage which carry real values from the reference
 * snapshot (88°C and 13.4 V), so the app dash count is the same as native.
 */
export const RC19_COLD_MOUNT_DASH_COUNT = 9
export const RC19_READY_DASH_COUNT = 8

/** The minimum number of non-canvas-colour pixels; a value below this means the frame is blank. */
export const RC19_MIN_NON_CANVAS_PIXELS = 2_000

// ─────────────────────────────────────────────────────────── spec

export const RC19_SPEC = Object.freeze({
  artifact:          "RaceCon RC-19",
  script:            "racecon-rc19-capture.mjs",
  presetId:          RC19_PRESET_ID,
  widgetId:          RC19_WIDGET_ID,
  attrPrefix:        "data-rc19-",
  rootSelector:      "#racecon-rc19-capture-root",
  captureHtml:       "racecon-rc19-capture.html",
  dashboardSelector: ".rc19-dashboard",
  sourceIdentity:    RC19_SOURCE_IDENTITY,

  /**
   * RC-19-specific published attributes. The shared `__rcCommon` collector already handles
   * `layout`, `compact-mode`, `buffer-state`, `content-width` and `content-height`;
   * the state attributes below are the ones the capture-matrix readiness gate also reads.
   */
  stateAttributes: Object.freeze([
    "ready",
    "outstanding",
    "handover",
    "alerts",
    "alert-keys"
  ]),

  /**
   * Always-present peer zones. The confirm control (OV-1/OV-2) is 100 % contained inside the
   * checklist column on every canvas and is therefore overlapping by design — the one exempted
   * pair. carStateBody and checklistList are verified through containment pairs below rather
   * than as separate zone entries, to avoid a cascade of exemptions for architecturally
   * documented nesting.
   */
  zones: Object.freeze([
    Object.freeze(["header",    '[data-testid="rc19-header"]']),
    Object.freeze(["carState",  '[data-testid="rc19-car-state"]']),
    Object.freeze(["checklist", '[data-testid="rc19-checklist"]']),
    Object.freeze(["confirm",   '[data-testid="rc19-confirm"]']),
    Object.freeze(["nextStint", '[data-testid="rc19-next-stint"]'])
  ]),

  /** OV-1/OV-2: the confirm control is 100 % contained inside the checklist column on every canvas.
   * The overlap is documented in the brief: "Confirm control … 100 % contained … consuming 12.69 %". */
  zoneOverlapExemptions: Object.freeze([
    Object.freeze(["checklist", "confirm"])
  ]),

  /** Containment spot-checks — each is an [label, ownerSelector, valueSelector] triple. */
  values: Object.freeze([
    // NOTE — `readiness` is deliberately NOT in this list, and is measured bespoke in
    // `assertReadinessBand` instead.
    //
    // The shared value sweep requires each value's TEXT RANGE rect to sit inside the capture root.
    // The approved brief already flags the tension it trips over: "40 px word needs a 54 px line
    // box; ... 44 px native ... 52 px app". At 1024x600 the app header band starts at y=0 and is
    // 52 px tall, so the 53 px line box of the 40 px readiness word pokes 1 px above the top edge
    // of the frame. The ELEMENT box is fully inside; only the font's line box is not. Keeping
    // `readiness` in `values` would abort the sweep at that 1 px with no way to record the
    // measurement, so it is asserted separately against a measured budget and reported.
    Object.freeze(["outstanding",  '[data-testid="rc19-outstanding"]']),
    Object.freeze(["fuel-laps",    '[data-testid="rc19-fuel-laps"]']),
    Object.freeze(["stint-laps",   '[data-testid="rc19-stint-laps"]']),
    Object.freeze(["tc",           '[data-testid="rc19-tc"]']),
    Object.freeze(["abs",          '[data-testid="rc19-abs"]']),
    Object.freeze(["fault-value",  '[data-testid="rc19-fault-value"]']),
    Object.freeze(["fuel-per-lap", '[data-testid="rc19-fuel-per-lap"]']),
    Object.freeze(["confirm-label",'[data-testid="rc19-confirm-label"]']),
    Object.freeze(["row-label",    '[data-rc19-row="fuel-laps"] .rc19-label'])
  ]),

  containment: Object.freeze([
    Object.freeze(["readiness in header",     '[data-testid="rc19-header"]',    '[data-testid="rc19-readiness"]']),
    Object.freeze(["outstanding in header",   '[data-testid="rc19-header"]',    '[data-testid="rc19-outstanding"]']),
    Object.freeze(["fuel-laps in carState",   '[data-testid="rc19-car-state"]', '[data-testid="rc19-fuel-laps"]']),
    Object.freeze(["tc in carState",          '[data-testid="rc19-car-state"]', '[data-testid="rc19-tc"]']),
    Object.freeze(["fault-value in carState", '[data-testid="rc19-car-state"]', '[data-testid="rc19-fault-value"]']),
    Object.freeze(["confirm in checklist",    '[data-testid="rc19-checklist"]', '[data-testid="rc19-confirm"]']),
    Object.freeze(["confirm-label in confirm",'[data-testid="rc19-confirm"]',   '[data-testid="rc19-confirm-label"]']),
    Object.freeze(["fuel-per-lap in nextStint",'[data-testid="rc19-next-stint"]','[data-testid="rc19-fuel-per-lap"]'])
  ]),

  counted: Object.freeze([
    Object.freeze(["check-row",     '[data-testid="rc19-check-row"]']),
    Object.freeze(["glyph",         '[data-testid^="rc19-glyph-"]']),
    Object.freeze(["state-output",  '[data-testid^="rc19-state-"]']),
    Object.freeze(["cell",          '[data-testid="rc19-cell"]']),
    Object.freeze(["row",           '[data-testid="rc19-row"]']),
    Object.freeze(["alerts-strip",  '[data-testid="rc19-alerts"]']),
    Object.freeze(["fuel-plan-note",'[data-testid="rc19-fuel-plan-note"]']),
    Object.freeze(["water-temp",    '[data-testid="rc19-water-temp"]']),
    Object.freeze(["voltage",       '[data-testid="rc19-voltage"]']),
    Object.freeze(["timeline",      '[data-testid="rc19-timeline"]']),
    Object.freeze(["timeline-empty",'[data-testid="rc19-timeline-empty"]'])
  ]),

  /**
   * Packet omissions as forbidden DOM selectors. Each omission renders nothing;
   * a non-zero count here means the omission was reintroduced — the only failure this sweep
   * can report. "Dashes are a feature. Nothing unmonitored may render as healthy."
   *   — raceconRc19Core.ts, RC19_FAULTS_NO_SOURCE prose
   */
  forbidden: Object.freeze([
    Object.freeze([
      "a shift-LED, rev-arc or RPM surface (packet 11.4 and 10)",
      ".rc19-led, .rc19-shift, .rc19-rev, .rc19-rpm, [data-rc19-zone=\"shift\"], [data-rc19-zone=\"rev\"]"
    ]),
    Object.freeze([
      "a delta-to-best readout (omission: deltaToBest)",
      ".rc19-delta, [data-rc19-zone=\"delta\"], [data-testid^=\"rc19-delta\"]"
    ]),
    Object.freeze([
      "a driver name, stint number or handover countdown (omission: driverIdentity)",
      "[data-testid=\"rc19-driver\"], [data-testid=\"rc19-stint-number\"], [data-testid=\"rc19-countdown\"], .rc19-driver, .rc19-countdown"
    ]),
    Object.freeze([
      "a gear, speed or pace readout (packet 10 and 11.4 suppress live pace)",
      ".rc19-gear, .rc19-speed, .rc19-pace, [data-rc19-zone=\"gear\"], [data-rc19-zone=\"speed\"]"
    ])
  ]),

  /**
   * The defect ledger is EMPTY, so every measured overflow now fails closed.
   *
   * It used to record the FUEL PER LAP value overflowing its native column in all three governed
   * states — `rc19-fuel-per-lap` "2.94" painting 3 px wider than its 54 px box at 800x480 — the
   * `white-space: nowrap` class the RaceCon harnesses exist to catch: overflow clipped visually,
   * `scrollWidth === clientWidth` on the ancestors, and jsdom sees nothing.
   *
   * Beside it, and deliberately NOT recorded because this sweep structurally cannot observe it, a
   * real-browser sweep measured a next-stint row LABEL standing 5.45 px wider than its 105 px
   * column at 800x480. `.rc19-label` renders as
   * `<span class="rc19-label">{label}<span class="rc19-unit">{unit}</span></span>` wherever a unit
   * is present, so those instances carry a child element and the leaf sweep — which is
   * `childElementCount === 0` by construction — never looks at them. That observability gap is now
   * closed by `assertNextStintRowsPaintInsideTheirBoxes` below, which measures every next-stint
   * cell's RANGE rect against its own layout box at every viewport in every state.
   *
   * Both had one cause: the packet's 250 px native column leaves a 168 px row, and the label
   * needed 110.45 px of it at the shared 1.875cqw step against a 56.63 px numeral and a 9.6 px gap
   * — 176.68 px of demand in 168 px, which the flex algorithm split between the two. The
   * next-stint column now carries its own smaller label step (1.6cqw, 12.8 px at 800x480), derived
   * from the longest label it must print; the ladder's `row-label` rung is measured from the
   * car-state `FUEL LAPS` row and is untouched.
   */
  knownDefects:       Object.freeze([]),
  zoneOverflowDefects: Object.freeze([]),
  containmentDefects:  Object.freeze([])
})

// ─────────────────────────────────────────────────────────── capture matrix

export const RC19_CAPTURE_MATRIX = Object.freeze(
  CAPTURE_STATES.flatMap((state) =>
    CAPTURE_SIZES.map((size) =>
      Object.freeze({
        size,
        state,
        /**
         * The shared `ready` function always waits for `buffer-state=accepted` and layout match.
         * These per-state pairs add the DOM conditions specific to each scenario:
         *
         *   cold-mount — in-box pit channel has been accepted; safety alert fires immediately
         *     (RC19_SAFETY_ITEM_ENGAGE_MS=0) but we gate only on the pit context to keep the
         *     required spec orthogonal from the handover spec.
         *
         *   handover — additionally require `alerts=active` so the harness confirms the alert
         *     strip is rendered before measuring geometry.
         *
         *   ready — require both `alerts=silent` and `outstanding=2` so the harness confirms
         *     the crew confirmations have been processed and the safety alert has cleared.
         */
        required: Object.freeze(
          state === "ready"
            ? [Object.freeze(["alerts", "silent"]), Object.freeze(["outstanding", "2"])]
            : state === "handover"
              ? [Object.freeze(["alerts", "active"]), Object.freeze(["handover", "in-box"])]
              : [Object.freeze(["handover", "in-box"])]
        )
      })
    )
  )
)

// ─────────────────────────────────────────────────────────── metric helpers

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

function zoneOf(metrics, name) {
  const zone = (metrics.zones ?? []).find((candidate) => candidate.name === name)
  if (!zone || !zone.present) fail(`capture is missing the "${name}" zone`)
  return zone
}

// ─────────────────────────────────────────────────────────── state checks

function assertStateAttrs(metrics, entry) {
  const attrs = metrics.stateAttributes ?? {}
  const layout = metrics.layout
  const isHandover = entry.state === "handover"
  const isColdMount = entry.state === "cold-mount"
  const isReady = entry.state === "ready"

  if (attrs.handover !== "in-box") {
    fail(`data-rc19-handover must be "in-box" for this fixture, received "${attrs.handover}"`)
  }
  if (isReady) {
    if (attrs.alerts !== "silent") {
      fail(`data-rc19-alerts must be "silent" in the ready state, received "${attrs.alerts}"`)
    }
    if (attrs["alert-keys"] !== "") {
      fail(`data-rc19-alert-keys must be empty in the ready state, received "${attrs["alert-keys"]}"`)
    }
    if (attrs.outstanding !== "2") {
      fail(`data-rc19-outstanding must be "2" in the ready state, received "${attrs.outstanding}"`)
    }
  } else {
    if (attrs.alerts !== "active") {
      fail(`data-rc19-alerts must be "active" in the ${entry.state} state, received "${attrs.alerts}"`)
    }
    if (!(attrs["alert-keys"] ?? "").includes("SAFETY ITEM UNCONFIRMED")) {
      fail(
        `data-rc19-alert-keys must contain "SAFETY ITEM UNCONFIRMED" in the ${entry.state} state, ` +
          `received "${attrs["alert-keys"]}"`
      )
    }
    if (attrs.outstanding !== "6") {
      fail(`data-rc19-outstanding must be "6" in the ${entry.state} state, received "${attrs.outstanding}"`)
    }
  }

  const nativeSize = metrics.nativeSize ?? null
  const expectedNative = layout === "native" ? "800x480" : null
  if (nativeSize !== expectedNative) {
    fail(`data-rc19-native-size must be ${String(expectedNative)}, received ${String(nativeSize)}`)
  }
}

// ─────────────────────────────────────────────────────────── type scale

/**
 * The readiness word is measured bespoke rather than through the shared value sweep, so its 1 px
 * line-box overhang can be RECORDED with its measurement instead of aborting the sweep.
 *
 * The approved brief states the tension outright: "40 px word needs a 54 px line box; ... 44 px
 * native ... 52 px app". The shipped app header band starts at y=0 and is 52 px tall, so the
 * readiness line box stands 53 px and its top sits 1 px above the frame. The element box is fully
 * inside the frame at every viewport; only the font's line box is not, and only at 1024x600.
 *
 * The budget is the measured 1 px plus a 1 px font-metric allowance — a measurement, not a cap.
 * A larger overhang, an overhang at another viewport, or any escape of the ELEMENT box itself
 * still fails closed.
 */
const RC19_READINESS_LINE_BOX_BUDGET_PX = 2

function assertReadinessBand(metrics, entry) {
  const readiness = metrics.readiness
  if (!readiness || !readiness.rect) fail("capture is missing the readiness output")
  if (!readiness.text || readiness.text.length === 0) fail("the readiness output rendered no word")

  // The element box may never leave the frame, at any viewport, with no allowance at all.
  const root = metrics.root
  const box = readiness.rect
  if (
    box.left < -0.5 ||
    box.top < -0.5 ||
    box.left + box.width > root.width + 0.5 ||
    box.top + box.height > root.height + 0.5
  ) {
    fail(
      `the readiness element box ${box.left.toFixed(2)},${box.top.toFixed(2)} ` +
        `${box.width.toFixed(2)}x${box.height.toFixed(2)} leaves the ${root.width}x${root.height} frame`
    )
  }

  // The line box is allowed only the recorded overhang.
  const textRect = readiness.textRect
  if (!textRect) return { text: readiness.text, lineBoxOverhangPx: 0 }
  const overhang = Math.max(
    -textRect.top,
    -textRect.left,
    textRect.top + textRect.height - root.height,
    textRect.left + textRect.width - root.width
  )
  if (overhang > RC19_READINESS_LINE_BOX_BUDGET_PX) {
    fail(
      `the readiness line box escapes the frame by ${overhang.toFixed(2)}px, past the ` +
        `${RC19_READINESS_LINE_BOX_BUDGET_PX}px recorded for the known defect: the 40px readiness word ` +
        `needs a 54px line box and the app header band is 52px (approved brief, header band fit)`
    )
  }
  return { text: readiness.text, lineBoxOverhangPx: Number(Math.max(0, overhang).toFixed(2)) }
}

function assertTypeScale(metrics) {
  return assertTypeScaleOrder([
    { label: "readiness", fontSize: metrics.readiness?.fontSize ?? 0 },
    { label: "fuel-laps", fontSize: valueOf(metrics, "fuel-laps").fontSize },
    { label: "outstanding", fontSize: valueOf(metrics, "outstanding").fontSize },
    { label: "row-label", fontSize: valueOf(metrics, "row-label").fontSize }
  ])
}

// ─────────────────────────────────────────────────────────── element counts

function assertCounts(metrics, entry) {
  const app = entry.size.layout === "app"

  const checkRows = countOf(metrics, "check-row")
  if (checkRows !== 6) fail(`exactly 6 rc19-check-row elements required, found ${checkRows}`)

  const glyphs = countOf(metrics, "glyph")
  if (glyphs !== 6) fail(`exactly 6 glyph outputs required (one per checklist item), found ${glyphs}`)

  const stateOutputs = countOf(metrics, "state-output")
  if (stateOutputs !== 6) fail(`exactly 6 state outputs required (one per checklist item), found ${stateOutputs}`)

  const cells = countOf(metrics, "cell")
  if (cells !== 8) fail(`exactly 8 rc19-cell elements required (4 tyre + 4 settings), found ${cells}`)

  const rows = countOf(metrics, "row")
  const expectedRows = app ? 9 : 7
  if (rows !== expectedRows) {
    fail(`rc19-row count must be ${expectedRows} in ${entry.size.layout} layout, found ${rows}`)
  }

  // Tertiary (water-temp, voltage) appears only on the app canvas (GAP-6 / tertiaryOnNative).
  const waterTemp = countOf(metrics, "water-temp")
  const voltage = countOf(metrics, "voltage")
  if (app) {
    if (waterTemp !== 1) fail(`rc19-water-temp must be present exactly once in app layout, found ${waterTemp}`)
    if (voltage !== 1) fail(`rc19-voltage must be present exactly once in app layout, found ${voltage}`)
  } else {
    if (waterTemp !== 0) fail(`rc19-water-temp is app-only (omission: tertiaryOnNative), found ${waterTemp} at ${entry.size.layout}`)
    if (voltage !== 0) fail(`rc19-voltage is app-only (omission: tertiaryOnNative), found ${voltage} at ${entry.size.layout}`)
  }

  // Timeline is app-only (omission: stintPlanTimeline has no channel).
  const timeline = countOf(metrics, "timeline")
  if (app) {
    if (timeline !== 1) fail(`rc19-timeline must be present exactly once in app layout, found ${timeline}`)
    const timelineEmpty = countOf(metrics, "timeline-empty")
    if (timelineEmpty !== 1) fail(`rc19-timeline-empty must render the NO STINT PLAN SOURCE empty state, found ${timelineEmpty}`)
    // The timeline segment count must be zero: GAP-4 leaves it no channel.
    const segAttr = metrics.timelineSegments ?? null
    if (segAttr !== "0") fail(`data-rc19-timeline-segments must be "0" (GAP-4), received "${segAttr}"`)
    hasText(metrics, "NO STINT PLAN SOURCE")
  } else {
    if (timeline !== 0) fail(`rc19-timeline is app-only, found ${timeline} at ${entry.size.layout}`)
  }

  // The alert strip renders when alerts are active; not a decoration in the silent frame.
  const alertsStrip = countOf(metrics, "alerts-strip")
  if (entry.state === "ready") {
    if (alertsStrip !== 0) fail(`rc19-alerts must not render in the silent ready state, found ${alertsStrip}`)
  } else {
    if (alertsStrip !== 1) fail(`rc19-alerts must render exactly once in the ${entry.state} state, found ${alertsStrip}`)
  }

  // Fuel-plan note renders only when fuelPlanInvalid is active; the reference fixture has a
  // burn model present (fuelPerLapLiters=2.94), so the note must never appear here.
  const fuelPlanNote = countOf(metrics, "fuel-plan-note")
  if (fuelPlanNote !== 0) {
    fail(`rc19-fuel-plan-note must not render (burn model is valid in this fixture), found ${fuelPlanNote}`)
  }
}

// ─────────────────────────────────────────────────────────── outstanding agreement

function assertOutstandingAgreement(metrics) {
  const claimed = Number.parseInt(String(metrics.stateAttributes.outstanding ?? ""), 10)
  if (!Number.isFinite(claimed)) {
    fail(`data-rc19-outstanding is not a number: "${metrics.stateAttributes.outstanding}"`)
  }
  const pendingRows = (metrics.leafTexts ?? []).filter((text) => text === "PENDING").length
  // The six check-rows each publish their own state word. The outstanding count is derived
  // arithmetically from those rows (OV-12), so the two must agree.
  if (pendingRows !== claimed) {
    fail(
      `data-rc19-outstanding is ${claimed} but ${pendingRows} rows read "PENDING" — ` +
        `the DOM state and the published attribute disagree`
    )
  }
}

// ─────────────────────────────────────────────────────────── packet omissions (absence)

function assertPacketOmissions(metrics, entry) {
  // GAP-3: ABS, MAP and BIAS have no section 16 channel — they must always read "--".
  // "Dashes are a feature. Nothing unmonitored may render as healthy." — raceconRc19Core.ts
  // Only "abs" is tracked as a named value in the spec; MAP and BIAS are not in the value list
  // but are covered by the leaf-text dash count assertion.
  for (const zone of ["abs", "map", "bias"]) {
    const vEntry = (metrics.values ?? []).find((v) => v.label === zone)
    if (!vEntry || !vEntry.present) continue  // not in spec values; covered by dash-count assertion
    if (vEntry.text !== RC19_DASH) {
      fail(`${zone.toUpperCase()} must read "${RC19_DASH}" (GAP-3 omission: no section 16 channel), received "${vEntry.text}"`)
    }
  }

  // GAP-4: targetLaps, fuelPlan, tyrePlan, weatherNote have no channel — must always read "--".
  // None of these are in the spec value list; covered by the leaf-text dash count assertion.
  for (const zone of ["target-laps", "fuel-plan", "tire-plan", "weather"]) {
    const vEntry = (metrics.values ?? []).find((v) => v.label === zone)
    if (!vEntry || !vEntry.present) continue  // not in spec values; covered by dash-count assertion
    if (vEntry.text !== RC19_DASH) {
      fail(`${zone} must read "${RC19_DASH}" (GAP-4 omission: no channel), received "${vEntry.text}"`)
    }
  }

  // RR tyre: no pressureKpa in reference snapshot — covered by dash count (1 of the 8/9 dashes).
  // stintPlanTimeline: checked in assertCounts (segment attr and empty-state notice).
  // deltaToBest: forbidden selector checked by validateCommonMetrics.
  // driverIdentity: forbidden selector checked by validateCommonMetrics.
  // tertiaryOnNative: checked in assertCounts (water-temp, voltage absent on native/compact).
  // GAP-1 (checklistChannel): items are never auto-confirmed; every row must be PENDING on a
  // fresh mount with no crew macro input.
  if (entry.state !== "ready") {
    const confirmedCount = (metrics.leafTexts ?? []).filter((text) => text === "CONFIRMED").length
    if (confirmedCount !== 0) {
      fail(
        `GAP-1: checklist items are never auto-confirmed. ` +
          `Expected 0 CONFIRMED items in ${entry.state} state, found ${confirmedCount}`
      )
    }
  }
}

// ─────────────────────────────────────────────────────────── dash count

function assertDashCount(metrics, entry) {
  const expected = entry.state === "ready" ? RC19_READY_DASH_COUNT : RC19_COLD_MOUNT_DASH_COUNT
  // Count via exact equality, not substring: adjacent text nodes join without separators.
  const count = (metrics.leafTexts ?? []).filter((text) => text === RC19_DASH).length
  if (count !== expected) {
    fail(
      `expected exactly ${expected} leaf readouts equal to "${RC19_DASH}" in the ` +
        `${entry.state} state on ${entry.size.layout} layout, found ${count}. ` +
        (entry.state === "ready"
          ? "The 8 are: RR tyre + ABS + MAP + BIAS + TARGET LAPS + FUEL PLAN + TIRE PLAN + WEATHER"
          : "The 9 are: RR tyre + ABS + MAP + BIAS + TARGET LAPS + FUEL PLAN + TIRE PLAN + WEATHER + STINT LAPS")
    )
  }

  // Verify STINT LAPS value explicitly.
  const stintLapsEntry = (metrics.values ?? []).find((candidate) => candidate.label === "stint-laps")
  if (!stintLapsEntry || !stintLapsEntry.present) return
  if (entry.state === "ready") {
    if (stintLapsEntry.text !== RC19_EXPECTED_VALUES.stintLaps) {
      fail(`rc19-stint-laps must read "${RC19_EXPECTED_VALUES.stintLaps}" in ready state, received "${stintLapsEntry.text}"`)
    }
  } else {
    if (stintLapsEntry.text !== RC19_DASH) {
      fail(`rc19-stint-laps must read "${RC19_DASH}" in ${entry.state} (no pit exit observed), received "${stintLapsEntry.text}"`)
    }
  }
}

// ─────────────────────────────────────────────────────────── reference literals

function assertReferenceLiterals(metrics, entry) {
  if (entry.state !== "ready") return
  for (const expected of [
    RC19_EXPECTED_VALUES.fuelLaps,
    RC19_EXPECTED_VALUES.fuelPerLap,
    RC19_EXPECTED_VALUES.stintLaps,
    RC19_EXPECTED_VALUES.tc,
    RC19_EXPECTED_VALUES.faultsNone,
    RC19_EXPECTED_VALUES.confirmLabel,
    "2 OUTSTANDING",
    "NOT READY"  // outstanding remains — SEAT+BELTS+WHEEL+RADIO confirmed but not latched
  ]) {
    hasText(metrics, expected)
  }
}

// ─────────────────────────────────────────────────────────── alert-strip clearance

/**
 * The reserved alert floor band (RC19_COMPACT_ALERT_FLOOR_PCT = 9) ensures the alert strip
 * cannot occlude the FAULTS row or the CONFIRM READY label on compact canvases. This was the
 * regression: a real-browser audit measured the strip covering FAULTS and CONFIRM READY at
 * 812x375 and 640x520 before the geometry fix. The assertion is per-viewport so a compact-only
 * regression on a single breakpoint cannot hide behind native/app passes.
 *
 * Tolerance: 2 px to absorb sub-pixel antialiasing at fractional CSS percentages.
 */
const CLEARANCE_TOLERANCE_PX = 2

/**
 * The alert strip used to overlap the CONFIRM READY control by 3.47 px on the 800x480 native
 * canvas while an alert was up, and that overlap was recorded here as a waived defect.
 *
 * `RC19_COMPACT_ALERT_FLOOR_PCT = 9` reserved the floor band by shortening the COMPACT content
 * area (`const height = 100 - RC19_COMPACT_ALERT_FLOOR_PCT - top`) and did its job at all four
 * compact viewports; the app canvas is protected by the 36 px 12.1 leaves below its columns. Only
 * the native canvas had no reservation — its `confirm` zone ran to ~460 px of a 480 px frame while
 * the 24.50 px strip is anchored to `bottom: 0` and started at ~455.50 px. FAULTS cleared by
 * 2.70 px and the CONFIRM READY *label* by 9.41 px; the control's own box did not.
 *
 * `RC19_NATIVE_ALERT_FLOOR_PX = 30` now reserves the same band in pixels on the native canvas, so
 * the ledger is EMPTY: every occlusion, on every target, at every viewport, in every state, fails
 * closed against the 2 px sub-pixel tolerance alone.
 */
const RC19_ALERT_FLOOR_DEFECTS = Object.freeze([])

function findAlertFloorDefect(name, entry) {
  const sizeKey = `${entry.size.width}x${entry.size.height}`
  return RC19_ALERT_FLOOR_DEFECTS.find(
    (candidate) =>
      candidate.target === name &&
      candidate.states.includes(entry.state) &&
      candidate.sizes.includes(sizeKey)
  )
}

function assertAlertStripClearance(metrics, entry) {
  const { faultsRect, alertsRect, confirmRect, confirmLabelRect } = metrics.alertsClearance ?? {}
  if (!alertsRect) {
    // The alert strip is not in the DOM on this frame (e.g. unexpected silent state).
    fail(`alert-strip clearance: rc19-alerts element must be present in ${entry.state} at ${entry.size.width}x${entry.size.height}`)
  }

  const results = {}
  for (const [name, rect] of [["faults", faultsRect], ["confirm", confirmRect], ["confirmLabel", confirmLabelRect]]) {
    if (!rect) {
      fail(`alert-strip clearance: ${name} rect is missing at ${entry.size.width}x${entry.size.height}`)
    }
    const rectBottom = rect.top + rect.height
    const clearancePx = alertsRect.top - rectBottom
    results[name] = { clearancePx: Number(clearancePx.toFixed(2)), rects: { rect, alertsRect } }
    const waiver = findAlertFloorDefect(name, entry)
    const budget = waiver ? waiver.budgetPx : CLEARANCE_TOLERANCE_PX
    if (clearancePx < -budget) {
      fail(
        `alert-floor band broken: rc19-alerts occludes ${name} by ${(-clearancePx).toFixed(2)}px ` +
          `at ${entry.size.width}x${entry.size.height} in ${entry.state} state` +
          (waiver
            ? `, past the ${waiver.budgetPx}px recorded for the known defect: ${waiver.note}`
            : ` — RC19_COMPACT_ALERT_FLOOR_PCT reservation did not prevent occlusion`)
      )
    }
    if (waiver && clearancePx < -CLEARANCE_TOLERANCE_PX) {
      results[name].defect = waiver.note
    }
  }
  return results
}

// ─────────────────────────────────────────────────────────── next-stint row containment

export const RC19_ROW_TOLERANCE_PX = 1

/**
 * The regression guard for the next-stint row overruns.
 *
 * Neither the leaf sweep nor `scrollWidth` is enough here, and for the label neither is even
 * possible. `white-space: nowrap` sizes a cell to its own text, so `scrollWidth === clientWidth`
 * reports that a 110.45px label "fits" the 105px box the flex algorithm squeezed it into; and the
 * `FUEL PER LAP` label carries its `L` unit as an element child, so it is not a leaf at all and
 * the sweep never looks at it. Only the RANGE rectangle against the cell's own layout box sees
 * both, which is what this does — at every viewport, in every state, with no budget.
 */
function assertNextStintRowsPaintInsideTheirBoxes(metrics) {
  const cells = metrics.nextStintRows ?? []
  if (cells.length === 0) fail("capture collected no next-stint row cells")
  for (const cell of cells) {
    if (!cell.rect || !cell.textRect) {
      fail(`next-stint ${cell.kind} "${cell.text}" was measured without a rectangle`)
    }
    const boxRight = finite(cell.rect.left, `${cell.row} ${cell.kind} left`) + cell.rect.width
    const inkRight = finite(cell.textRect.left, `${cell.row} ${cell.kind} text left`) + cell.textRect.width
    if (inkRight - boxRight > RC19_ROW_TOLERANCE_PX) {
      fail(
        `the next-stint ${cell.kind} "${cell.text}" paints ${(inkRight - boxRight).toFixed(2)}px past its own ` +
          `${cell.rect.width.toFixed(2)}px box (glyphs reach x=${inkRight.toFixed(2)}, box ends at ` +
          `x=${boxRight.toFixed(2)})`
      )
    }
    if (cell.rect.left - cell.textRect.left > RC19_ROW_TOLERANCE_PX) {
      fail(`the next-stint ${cell.kind} "${cell.text}" paints past the left edge of its own box`)
    }
  }
}

// ─────────────────────────────────────────────────────────── required text

const RC19_REQUIRED_TEXT_COMMON = Object.freeze([
  "CAR STATE",
  "SWAP CHECKLIST",
  "NEXT STINT",
  "CONFIRM READY",
  "FUEL LAPS",
  "STINT LAPS",
  "FAULTS",
  "FUEL PER LAP"
])

const RC19_REQUIRED_TEXT_ALERT = Object.freeze([
  ...RC19_REQUIRED_TEXT_COMMON,
  "SAFETY ITEM UNCONFIRMED"
])

const RC19_REQUIRED_TEXT_READY = Object.freeze([
  ...RC19_REQUIRED_TEXT_COMMON,
  RC19_EXPECTED_VALUES.fuelLaps,
  RC19_EXPECTED_VALUES.fuelPerLap,
  RC19_EXPECTED_VALUES.stintLaps,
  RC19_EXPECTED_VALUES.faultsNone
])

/**
 * Leaf text that would reintroduce a documented omission or a channel section 16 never ratified.
 * The fuel-plan note "NO MEASURED BURN MODEL" must not appear because the reference snapshot
 * has a valid burn model (fuelPerLapLiters=2.94 > 0).
 */
const RC19_FORBIDDEN_LEAF_TEXT = Object.freeze([
  Object.freeze(["NO MEASURED BURN MODEL", "the burn model is valid in this fixture; the fuel-plan alert must not fire"]),
  Object.freeze(["READY", "READY without a latch is only valid when outstanding=0 and the crew latches — the reference frame has outstanding=2 (ready) or 6 (alert states)"])
])

// ─────────────────────────────────────────────────────────── main validation

export function validateCaptureMetrics(metrics, entry) {
  const common = validateCommonMetrics(metrics, entry, RC19_SPEC)

  assertStateAttrs(metrics, entry)

  const requiredText = entry.state === "ready" ? RC19_REQUIRED_TEXT_READY : RC19_REQUIRED_TEXT_ALERT
  for (const expected of requiredText) hasText(metrics, expected)

  // The one forbidden literal that is state-agnostic: NO MEASURED BURN MODEL must not appear
  // because the reference burn model is valid. "READY" should never appear as a leaf readout
  // because the checklist still has 2 (or 6) outstanding items.
  for (const [text, why] of RC19_FORBIDDEN_LEAF_TEXT) lacksLeafText(metrics, text, why)

  assertCounts(metrics, entry)
  assertOutstandingAgreement(metrics)
  assertPacketOmissions(metrics, entry)
  assertDashCount(metrics, entry)
  assertReferenceLiterals(metrics, entry)
  assertNextStintRowsPaintInsideTheirBoxes(metrics)

  const alertClearance =
    entry.state === "handover" ? assertAlertStripClearance(metrics, entry) : {}

  return {
    ...common,
    typeScale: assertTypeScale(metrics),
    readiness: assertReadinessBand(metrics, entry),
    dashCount: (metrics.leafTexts ?? []).filter((text) => text === RC19_DASH).length,
    alertClearance
  }
}

// ─────────────────────────────────────────────────────────── pixel audit

/**
 * The RC-19 pixel audit proves what only a real raster can prove.
 *
 *  1. The frame is not blank against the RC-19 canvas colour #0A0D11 = rgb(10,13,17).
 *
 *  2. SIGNATURE (#34E0C0 → "cyan") is present on every frame: section titles render signature
 *     colour and a frame without them has lost its identity. INFO (#40BEDC) also classifies as
 *     "cyan" (same hue band) — both tokens are asserted as a family, not per-token, because the
 *     two cannot be separated by hue alone.
 *
 *  3. DANGER (#FF3F30 → "red") is ABSENT from the ready frame and PRESENT + SCOPED to the
 *     alert strip plus blocking checklist rows in the handover and cold-mount frames. The scope
 *     is collected in `collectMetrics` via `alertScope`.
 *
 *  4. NORMAL (#46C86E → "green") is PRESENT in the ready frame (SEAT, BELTS, WHEEL, RADIO
 *     confirmed → green glyph/state) and ABSENT in the handover and cold-mount frames (all six
 *     items PENDING → secondary grey, never green).
 *
 *  5. CAUTION (#FFB52E → "amber") is ABSENT from every frame: the carried-fault alert never
 *     fires in this fixture because the reference snapshot reports zero active faults.
 *
 * Colour is confirmed by HUE FAMILY, never by a channel ratio. A naive `g < 0.62r && b < 0.62r`
 * ratio test measured 8 578 "red" pixels on a frame whose hue-confirmed truth was zero; hue
 * also survives `filter: brightness()` because scaling every channel by the same factor leaves
 * the hue angle unchanged.
 */
export function validateCapturePixels(buffer, entry, metrics) {
  if (!isGovernedSize(entry.size)) fail(`unsupported capture pixel-audit size ${entry.size.width}x${entry.size.height}`)
  const image = decodeCapturePng(buffer, entry.size)

  const dangerFamily   = hueFamilyOfHex(RC19_DANGER_HEX)     // "red"
  const cautionFamily  = hueFamilyOfHex(RC19_CAUTION_HEX)    // "amber"
  const signatureFamily= hueFamilyOfHex(RC19_SIGNATURE_HEX)  // "cyan"  (also matches info)
  const normalFamily   = hueFamilyOfHex(RC19_NORMAL_HEX)     // "green"

  const isAlert = entry.state !== "ready"
  const alertScope = metrics.alertScope ?? []

  const scopes = {}
  if (isAlert && alertScope.length > 0) {
    // Danger pixels must be scoped to the alert strip + blocking checklist rows in alert states.
    scopes[dangerFamily] = alertScope
  }
  const audit = auditHueFamilies(image, scopes)

  // Frame must not be blank.
  let nonCanvas = 0
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4
      if (
        image.data[offset]     !== RC19_CANVAS_RGBA[0] ||
        image.data[offset + 1] !== RC19_CANVAS_RGBA[1] ||
        image.data[offset + 2] !== RC19_CANVAS_RGBA[2]
      ) nonCanvas++
    }
  }
  if (nonCanvas < RC19_MIN_NON_CANVAS_PIXELS) {
    fail(`frame is blank against the RC-19 canvas colour rgb(${RC19_CANVAS_RGBA.slice(0, 3).join(",")})`)
  }

  // Signature/info (cyan): section titles use signature on every frame.
  assertHueFamilyPresent(audit, signatureFamily, "signature/info (cyan must be present — section titles and outstanding count)")

  // Danger (red): absent in ready, present+scoped in alert states.
  if (!isAlert) {
    assertHueFamilyAbsent(audit, dangerFamily, "danger #FF3F30 (red) in ready state")
  } else {
    assertHueFamilyPresent(audit, dangerFamily, "danger #FF3F30 (red) in alert state — alert strip must be painted")
    if (alertScope.length > 0) {
      assertHueFamilyScoped(audit, dangerFamily, "danger #FF3F30 (red) must be scoped to alert strip and blocking rows")
    }
  }

  // Normal (green): present in ready (confirmed items), absent in alert states (all PENDING).
  if (!isAlert) {
    assertHueFamilyPresent(audit, normalFamily, "normal #46C86E (green) in ready state — confirmed items must be green")
  } else {
    assertHueFamilyAbsent(audit, normalFamily, "normal #46C86E (green) in alert states — no items confirmed, no green pixels")
  }

  // Caution (amber): absent from every frame in this fixture.
  assertHueFamilyAbsent(audit, cautionFamily, "caution #FFB52E (amber) — carried-fault alert never fires in this fixture")

  return {
    width: image.width,
    height: image.height,
    hueFamilies: audit.counts,
    dangerHueFamily:    dangerFamily,
    signatureHueFamily: signatureFamily,
    normalHueFamily:    normalFamily,
    cautionHueFamily:   cautionFamily,
    dangerOutsideScope: audit.outside[dangerFamily] ?? 0
  }
}
