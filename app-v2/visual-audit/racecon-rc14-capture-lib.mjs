import {
  CAPTURE_SIZES,
  assertHueFamilyAbsent,
  assertHueFamilyDensityBelow,
  assertHueFamilyPresent,
  assertHueFamilyScoped,
  assertTypeScaleOrder,
  auditHueFamilies,
  decodeCapturePng,
  exact,
  fail,
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
 * RC-14 "Triage — Vehicle Health & Damage Assessment". Only what its own DOM contract,
 * zones, channels, alert families and documented omissions make different from the rest of the
 * portfolio lives here; everything generic comes from `racecon-capture-shared.mjs`.
 *
 * THE HEADLINE DECISION: the app has no per-zone damage channel, so six of the eight silhouette
 * zones render UNMONITORED (outline-only, secondary token, dash chip, no fault-list row). That
 * distinction — unmonitored is NOT ok-green — is implementation brief gap G7 and every assertion
 * in this file exists to protect it or to report a deviation from it.
 */

export const RC14_PRESET_ID = "racecon_rc14_dash"
export const RC14_WIDGET_ID = "raceconRc14Dash"
export const RC14_SOURCE_IDENTITY = "iracing:session:146:connection:8"

/** Two governed scenarios. */
export const CAPTURE_STATES = Object.freeze(["silent", "critical-fault"])

// ── palette ────────────────────────────────────────────────────────────────────────────────────
// Tokens: bg #0D0F12, normal #46C86E (green), danger #FF3E30 (red), caution #FFA82E (amber),
// signature #6EE7FF (cyan), info (retune) #3F93CF (blue).
export const RC14_CANVAS_RGBA = Object.freeze([13, 15, 18, 255]) // bg #0D0F12
export const RC14_NORMAL_HEX = "#46C86E"
export const RC14_DANGER_HEX = "#FF3E30"
export const RC14_CAUTION_HEX = "#FFA82E"
export const RC14_SIGNATURE_HEX = "#6EE7FF"

// ── fixed counts (MEASURED) ────────────────────────────────────────────────────────────────────
export const RC14_ZONE_COUNT = 8
export const RC14_MONITORED_ZONE_COUNT = 2     // engine, electrical
export const RC14_UNMONITORED_ZONE_COUNT = 6   // aero, gearbox, cornerLf/Rf/Lr/Rr
export const RC14_VITAL_COUNT = 4
export const RC14_CORNER_COUNT = 4             // lf, rf, lr, rr
/**
 * Fault rows equals the MONITORED system count: ENGINE, ELECTRICAL, CHASSIS always have usable
 * fault sources from this fixture. GEARBOX, FRONT AERO, CORNER LF/RF/LR/RR have NONE
 * (omission: perZoneDamageChannel) and therefore never produce a row — not even an OK row.
 */
export const RC14_FAULT_ROW_COUNT = 3
export const RC14_MONITORED_SYSTEM_COUNT = 3
export const RC14_MONITORED_SOURCE_COUNT = 10
export const RC14_MIN_NON_CANVAS_PIXELS = 5_000

/**
 * System labels that belong to the SIX unmonitored zones. None of these must ever appear as a
 * fault-row system name (omission: perZoneDamageChannel).
 */
export const RC14_UNMONITORED_SYSTEM_LABELS = Object.freeze([
  "GEARBOX", "FRONT AERO", "CORNER LF", "CORNER RF", "CORNER LR", "CORNER RR"
])

/**
 * The green hue-family density ceiling inside the union of the six unmonitored zone rects.
 * Unmonitored zones are outline-only in secondary; no normal-green (#46C86E) fill must land
 * inside them. Measured noise floor (antialiasing): < 0.1 %. Ceiling set conservatively at
 * 0.5 % to survive minor rendering engine variation while still catching a filled green zone.
 * (omission: unmonitoredVersusOk)
 */
export const RC14_UNMONITORED_GREEN_CEILING = 0.005

export const RC14_SPEC = Object.freeze({
  artifact: "RaceCon RC-14",
  script: "racecon-rc14-capture.mjs",
  presetId: RC14_PRESET_ID,
  widgetId: RC14_WIDGET_ID,
  attrPrefix: "data-rc14-",
  rootSelector: "#racecon-rc14-capture-root",
  captureHtml: "racecon-rc14-capture.html",
  dashboardSelector: ".rc14-dashboard",
  sourceIdentity: RC14_SOURCE_IDENTITY,

  /**
   * RC-14 publishes NO <output> element. The readoutSelector covers the five live readout
   * families: vital values, the decision word, fault severity chips, corner brake temps, and
   * corner tyre pressures. Each instance must be non-empty.
   */
  readoutSelector: [
    '[data-testid="rc14-vital-value"]',
    '[data-testid="rc14-decision-word"]',
    '[data-testid="rc14-fault-chip"]',
    '[data-testid="rc14-corner-brake"]',
    '[data-testid="rc14-corner-pressure"]'
  ].join(", "),

  /**
   * State attributes published on the widget root (attrPrefix + name).
   * There is NO data-rc14-alert-keys — RC-14 uses per-source alert state, not a key list.
   */
  stateAttributes: Object.freeze(["alerts", "decision", "monitored-systems", "monitored-sources"]),

  /**
   * Zones present at EVERY governed viewport. Layout-conditional zones (decisionBanner,
   * cornerStatus, decisionCorners, faultTimeline) are verified in assertLayoutConditionalZones
   * outside the shared overlap sweep — a zone that does not exist cannot be compared.
   */
  zones: Object.freeze([
    Object.freeze(["faultList",      '[data-testid="rc14-panel-faultList"]']),
    Object.freeze(["carSilhouette",  '[data-testid="rc14-panel-carSilhouette"]']),
    Object.freeze(["vitalsColumn",   '[data-testid="rc14-panel-vitalsColumn"]'])
  ]),

  zoneOverlapExemptions: Object.freeze([]),

  /**
   * Values used by the shared presence + root-containment checks, and for font-size collection.
   * Multi-instance elements (vital-value, fault-chip, corner-head/brake/pressure) resolve to
   * their first instance via querySelector; all instances use the same CSS custom property.
   */
  values: Object.freeze([
    Object.freeze(["decision word",  '[data-testid="rc14-decision-word"]']),
    Object.freeze(["vital value",    '[data-testid="rc14-vital-value"]']),
    Object.freeze(["fault chip",     '[data-testid="rc14-fault-chip"]']),
    Object.freeze(["corner head",    '[data-testid="rc14-corner-head"]']),
    Object.freeze(["corner brake",   '[data-testid="rc14-corner-brake"]']),
    Object.freeze(["corner pressure",'[data-testid="rc14-corner-pressure"]'])
  ]),

  containment: Object.freeze([]),

  counted: Object.freeze([
    Object.freeze(["zone",                  '[data-testid="rc14-zone"]']),
    Object.freeze(["vital",                 '[data-testid="rc14-vital"]']),
    Object.freeze(["fault-row",             '[data-testid="rc14-fault-row"]']),
    Object.freeze(["fault-chip",            '[data-testid="rc14-fault-chip"]']),
    Object.freeze(["fault-ack",             '[data-testid="rc14-fault-ack"]']),
    Object.freeze(["fault-nozone",          '[data-testid="rc14-fault-nozone"]']),
    Object.freeze(["fault-empty",           '[data-testid="rc14-fault-empty"]']),
    Object.freeze(["corner-head",           '[data-testid="rc14-corner-head"]']),
    Object.freeze(["corner-brake",          '[data-testid="rc14-corner-brake"]']),
    Object.freeze(["corner-pressure",       '[data-testid="rc14-corner-pressure"]']),
    Object.freeze(["decision",              '[data-testid="rc14-decision"]']),
    Object.freeze(["unmonitored-notice",    '[data-testid="rc14-unmonitored-notice"]']),
    Object.freeze(["panel-faultTimeline",   '[data-testid="rc14-panel-faultTimeline"]']),
    Object.freeze(["panel-decisionCorners", '[data-testid="rc14-panel-decisionCorners"]']),
    Object.freeze(["panel-decisionBanner",  '[data-testid="rc14-panel-decisionBanner"]']),
    Object.freeze(["panel-cornerStatus",    '[data-testid="rc14-panel-cornerStatus"]']),
    Object.freeze(["timeline-empty",        '[data-testid="rc14-timeline-empty"]']),
    Object.freeze(["timeline-mark",         '[data-testid="rc14-timeline-mark"]'])
  ]),

  /**
   * omission speedAndDeltaZones — packet 16 defines Speed (km/h) and Delta to best (s) with
   * full source, unit, staleness and never-estimate rules, and packet 10 lists both as
   * tertiary, but neither 11.1 nor 12.1 defines any zone for them. Neither channel is
   * rendered at all, not even as a dash.
   *
   * omission systemsDetailPanel — packet 12 prose mentions "a systems detail panel" but 12.1
   * defines no rectangle for it. Not built, because inventing the rectangle would invent the
   * content too.
   */
  forbidden: Object.freeze([
    Object.freeze([
      "a speed or delta surface (omission: speedAndDeltaZones)",
      '.rc14-speed, .rc14-delta, [data-rc14-zone="speed"], [data-rc14-zone="delta"], ' +
      '[data-testid="rc14-speed"], [data-testid="rc14-delta"]'
    ]),
    Object.freeze([
      "a systems-detail panel (omission: systemsDetailPanel)",
      '[data-testid="rc14-systems-detail"], .rc14-systems-detail, [data-rc14-zone="systemsDetail"]'
    ])
  ]),

  /**
   * Both measured render defects have been corrected. These ledger arrays are intentionally empty
   * so the harness fails closed on recurrence; explicit positive regression guards run below.
   */
  knownDefects: Object.freeze([]),

  zoneOverflowDefects: Object.freeze([]),
  containmentDefects: Object.freeze([])
})

// ── capture matrix ─────────────────────────────────────────────────────────────────────────────

export const RC14_CAPTURE_MATRIX = Object.freeze(
  CAPTURE_STATES.flatMap((state) =>
    CAPTURE_SIZES.map((size) =>
      Object.freeze({
        size,
        state,
        required: Object.freeze(
          state === "critical-fault"
            ? [Object.freeze(["alerts", "active"]), Object.freeze(["decision", "PIT"])]
            : [Object.freeze(["alerts", "silent"])]
        )
      })
    )
  )
)

// ── type scale ─────────────────────────────────────────────────────────────────────────────────

/**
 * The declared type-rank equality is fixed and guarded at every governed viewport/state.
 */

// ── helpers ────────────────────────────────────────────────────────────────────────────────────

function countOf(metrics, label) {
  const entry = (metrics.counted ?? []).find((candidate) => candidate.label === label)
  if (!entry) fail(`capture did not count "${label}"`)
  return entry.count
}

function valueOf(metrics, label) {
  const value = (metrics.values ?? []).find((candidate) => candidate.label === label)
  if (!value || !value.present) fail(`capture is missing the "${label}" readout`)
  return value
}

// ── assertion functions ────────────────────────────────────────────────────────────────────────

function assertStateAttributes(metrics, entry) {
  const attrs = metrics.stateAttributes

  // Both states: 3 monitored systems, 10 monitored sources (ENGINE/ELECTRICAL/CHASSIS have
  // usable fault sources; GEARBOX/AERO/all CORNER systems have none — perZoneDamageChannel).
  if (attrs["monitored-systems"] !== String(RC14_MONITORED_SYSTEM_COUNT)) {
    fail(
      `data-rc14-monitored-systems must be "${RC14_MONITORED_SYSTEM_COUNT}", ` +
      `received "${attrs["monitored-systems"]}"`
    )
  }
  if (attrs["monitored-sources"] !== String(RC14_MONITORED_SOURCE_COUNT)) {
    fail(
      `data-rc14-monitored-sources must be "${RC14_MONITORED_SOURCE_COUNT}", ` +
      `received "${attrs["monitored-sources"]}"`
    )
  }

  if (entry.state === "critical-fault") {
    if (attrs.alerts !== "active") {
      fail(
        `critical-fault must publish data-rc14-alerts="active", received "${attrs.alerts}"`
      )
    }
    if (attrs.decision !== "PIT") {
      fail(
        `critical-fault must publish data-rc14-decision="PIT", received "${attrs.decision}" ` +
        "(ENGINE CRITICAL fault latches → worstSeverity=critical → PIT)"
      )
    }
  } else {
    if (attrs.alerts !== "silent") {
      fail(
        `silent state must publish data-rc14-alerts="silent", received "${attrs.alerts}"`
      )
    }
    if (attrs.decision !== "CONTINUE") {
      fail(
        `silent state must publish data-rc14-decision="CONTINUE", received "${attrs.decision}"`
      )
    }
  }
}

/**
 * Fixed counts that never vary with layout or state.
 */
function assertFixedCounts(metrics) {
  const checks = [
    ["vital",          RC14_VITAL_COUNT,  "vitals always render all four gauges"],
    ["corner-head",    RC14_CORNER_COUNT, "CornerTable always renders four column headers"],
    ["corner-brake",   RC14_CORNER_COUNT, "CornerTable always renders four brake-temp cells"],
    ["corner-pressure",RC14_CORNER_COUNT, "CornerTable always renders four tyre-pressure cells"]
  ]
  for (const [label, expected, why] of checks) {
    const actual = countOf(metrics, label)
    if (actual !== expected) {
      fail(`${label} count must be ${expected} (${why}), found ${actual}`)
    }
  }
}

/**
 * Silhouette zone counts and panel attributes.
 *
 * The carSilhouette panel must publish:
 *   data-rc14-zones="8"              — all eight zones always rendered
 *   data-rc14-unmonitored-zones="6"  — six without a live damage channel
 *
 * The unmonitored notice must read "6 ZONES NO SOURCE" (RC14_UNMONITORED_NOTICE = "NO SOURCE").
 */
function assertSilhouettePanel(metrics) {
  if (countOf(metrics, "zone") !== RC14_ZONE_COUNT) {
    fail(`exactly ${RC14_ZONE_COUNT} silhouette zones must be rendered, found ${countOf(metrics, "zone")}`)
  }

  const unmonitoredCount = (metrics.zoneStates ?? []).filter((z) => !z.monitored).length
  if (unmonitoredCount !== RC14_UNMONITORED_ZONE_COUNT) {
    fail(
      `exactly ${RC14_UNMONITORED_ZONE_COUNT} zones must publish monitored="false", found ${unmonitoredCount}`
    )
  }

  if (metrics.silhouetteZonesAttr !== String(RC14_ZONE_COUNT)) {
    fail(
      `rc14-panel-carSilhouette must publish data-rc14-zones="${RC14_ZONE_COUNT}", ` +
      `received "${metrics.silhouetteZonesAttr}"`
    )
  }
  if (metrics.silhouetteUnmonitoredAttr !== String(RC14_UNMONITORED_ZONE_COUNT)) {
    fail(
      `rc14-panel-carSilhouette must publish data-rc14-unmonitored-zones="${RC14_UNMONITORED_ZONE_COUNT}", ` +
      `received "${metrics.silhouetteUnmonitoredAttr}"`
    )
  }

  const expectedNotice = "6 ZONES NO SOURCE"
  if (metrics.unmonitoredNoticeText !== expectedNotice) {
    fail(
      `unmonitored notice must read "${expectedNotice}", received "${metrics.unmonitoredNoticeText}"`
    )
  }
  if (countOf(metrics, "unmonitored-notice") !== 1) {
    fail(
      `exactly 1 unmonitored notice must render, found ${countOf(metrics, "unmonitored-notice")}`
    )
  }
}

/**
 * THE HEADLINE ASSERTION — omission unmonitoredVersusOk.
 *
 * Every unmonitored zone must publish:
 *   data-rc14-zone-monitored="false"
 *   data-rc14-zone-severity="unmonitored"   (never "ok")
 *   data-rc14-zone-token="secondary"        (never "normal")
 *   data-rc14-zone-pattern="outline"        (never "solid")
 *
 * This is asserted at EVERY viewport in BOTH states because the unmonitored count is structural
 * (no damage channel exists for six zones regardless of telemetry state).
 */
function assertUnmonitoredZones(metrics) {
  const zones = metrics.zoneStates ?? []

  for (const zone of zones) {
    if (zone.monitored) continue

    if (zone.severity !== "unmonitored") {
      fail(
        `unmonitored zone "${zone.id}" must publish severity="unmonitored", ` +
        `received "${zone.severity}" — painting health the app cannot know ` +
        "(omission: unmonitoredVersusOk)"
      )
    }
    if (zone.token !== "secondary") {
      fail(
        `unmonitored zone "${zone.id}" must publish token="secondary", ` +
        `received "${zone.token}" — the normal (green) token must never appear ` +
        "on a zone with no live fault channel (omission: unmonitoredVersusOk)"
      )
    }
    if (zone.token === "normal") {
      fail(
        `unmonitored zone "${zone.id}" carries token="normal" — ` +
        "painting an uninspected zone ok-green asserts health the app cannot know " +
        "(omission: unmonitoredVersusOk)"
      )
    }
    if (zone.pattern !== "outline") {
      fail(
        `unmonitored zone "${zone.id}" must publish pattern="outline", ` +
        `received "${zone.pattern}" — only a zone with a live channel may be filled ` +
        "(omission: unmonitoredVersusOk)"
      )
    }
    if (zone.severity === "ok") {
      fail(
        `unmonitored zone "${zone.id}" carries severity="ok" — ` +
        "unmonitored must never be confused with ok (omission: unmonitoredVersusOk)"
      )
    }
    if (zone.pattern === "solid") {
      fail(
        `unmonitored zone "${zone.id}" carries pattern="solid" — ` +
        "solid fill asserts ok health the zone cannot claim (omission: unmonitoredVersusOk)"
      )
    }
  }

  // The two monitored zones must not carry unmonitored markers.
  for (const zone of zones) {
    if (!zone.monitored) continue
    if (zone.severity === "unmonitored" || zone.token === "secondary") {
      fail(
        `monitored zone "${zone.id}" must not carry unmonitored markers: ` +
        `severity="${zone.severity}" token="${zone.token}"`
      )
    }
  }
}

/**
 * Fault list assertions.
 *
 * — row count == monitored-system count (3): ENGINE, ELECTRICAL, CHASSIS. GEARBOX, FRONT AERO
 *   and all four CORNER systems have no usable fault source and therefore no row, not even OK.
 *   (omission: perZoneDamageChannel)
 *
 * — no unmonitored system label appears as a fault-row system name.
 *
 * — CHASSIS row carries exactly one `[data-testid="rc14-fault-nozone"]` reading "NO ZONE":
 *   repair state is whole-car with no silhouette location, so no zone is invented.
 *   (omission: perZoneDamageChannel)
 *
 * — ACK button: 0 in silent state (no latched faults), 1 in critical-fault state (ENGINE row).
 *
 * — No chip word reads "MINOR" or "MAJOR" on this fixture (no minor fault source triggered).
 */
function assertFaultList(metrics, entry) {
  if (countOf(metrics, "fault-row") !== RC14_FAULT_ROW_COUNT) {
    fail(
      `fault row count must be ${RC14_FAULT_ROW_COUNT} (ENGINE, ELECTRICAL, CHASSIS), ` +
      `found ${countOf(metrics, "fault-row")} — the six unmonitored systems must never ` +
      "produce a row (omission: perZoneDamageChannel)"
    )
  }

  // No unmonitored system label may appear in the fault list
  const systemNames = metrics.faultSystemNames ?? []
  for (const forbidden of RC14_UNMONITORED_SYSTEM_LABELS) {
    if (systemNames.includes(forbidden)) {
      fail(
        `fault list must not contain system "${forbidden}" — that system has no usable fault ` +
        "source (omission: perZoneDamageChannel)"
      )
    }
  }

  // CHASSIS has zone=null → exactly one rc14-fault-nozone reading "NO ZONE"
  if (countOf(metrics, "fault-nozone") !== 1) {
    fail(
      `exactly 1 fault-nozone must render (CHASSIS has no silhouette zone), ` +
      `found ${countOf(metrics, "fault-nozone")} (omission: perZoneDamageChannel)`
    )
  }
  hasText(metrics, "NO ZONE")

  // Silent: no latched faults → no ACK buttons
  // Critical-fault: ENGINE is latched critical → 1 ACK button
  const expectedAck = entry.state === "critical-fault" ? 1 : 0
  if (countOf(metrics, "fault-ack") !== expectedAck) {
    fail(
      `expected ${expectedAck} ACK button(s) in ${entry.state} state, ` +
      `found ${countOf(metrics, "fault-ack")}`
    )
  }

  // fault-empty must not appear when rows are present
  if (countOf(metrics, "fault-empty") !== 0) {
    fail(
      `fault-empty notice must not render when ${RC14_FAULT_ROW_COUNT} monitored systems exist, ` +
      `found ${countOf(metrics, "fault-empty")}`
    )
  }
}

/**
 * Vital omission assertions.
 *
 * omission vitalRangeThresholds — oil temperature has NO entry in RC14_VITAL_RANGE because
 * packet 15 lists "oil / water / battery" only. oilTemp must NEVER alert regardless of state.
 */
function assertVitalOmissions(metrics) {
  if (metrics.oilTempVitalAlerting !== "false") {
    fail(
      `oilTemp vital must always publish data-rc14-vital-alerting="false", ` +
      `received "${metrics.oilTempVitalAlerting}" (omission: vitalRangeThresholds — ` +
      "packet 15 does not list oil temperature as an alertable vital)"
    )
  }
}

/**
 * omission operatingLampsAreNotFaults — revLimiter and pitLimiter are normal operating lamps
 * and are excluded from the fault model entirely. They must never produce a fault-list row,
 * chip or timeline mark.
 */
function assertOperatingLamps(metrics) {
  lacksLeafText(
    metrics,
    "PIT LIMITER",
    "would reintroduce pitLimiter as a fault (omission: operatingLampsAreNotFaults)"
  )
  lacksLeafText(
    metrics,
    "REV LIMITER",
    "would reintroduce revLimiter as a fault (omission: operatingLampsAreNotFaults)"
  )
  // Also assert the chip words: this fixture raises only CRITICAL and OK chips
  const chipWords = metrics.faultChipWords ?? []
  for (const chip of chipWords) {
    if (chip === "MINOR" || chip === "MAJOR") {
      fail(
        `chip word "${chip}" must not appear on this fixture — ` +
        "no minor fault source is triggered (no MINOR or MAJOR alert engages)"
      )
    }
  }
}

/**
 * omission speedAndDeltaZones — the speed and delta channels are documented as absent. Assert
 * via leaf text that neither unit string can appear as a readout.
 */
function assertSpeedDeltaOmission(metrics) {
  lacksLeafText(
    metrics,
    "KM/H",
    "would reintroduce the speed readout (omission: speedAndDeltaZones)"
  )
  lacksLeafText(
    metrics,
    "DELTA",
    "would reintroduce the delta readout (omission: speedAndDeltaZones)"
  )
}

/**
 * REGRESSION GUARD 1 - RC-14/1 fault-system name has a real box and stays inside it.
 *
 * Moving detail/no-zone content onto full-width rows fixes the ENGINE label collapse measured at
 * 800x480 (clientWidth 0, +73 px nowrap text) and 1024x600 (clientWidth 7, +86 px) in the
 * critical-fault state. This assertion re-raises if any fault-system overflow, zero-width box, or
 * getBoundingClientRect escape returns at any viewport or state.
 */
function assertFaultSystemNameContained(metrics) {
  const overflow = (metrics.overflowLeaves ?? []).find((leaf) => leaf.key === "rc14-fault-system")
  if (overflow) {
    fail(
      `rc14-fault-system "${overflow.text}" overflows its box by ${overflow.overflowX}px - ` +
      "fault-system names must have real, contained boxes at every viewport"
    )
  }

  for (const [label, px] of [
    ["fault row", metrics.engineTextEscapeFromRow],
    ["fault-list panel", metrics.engineTextEscapeFromPanel]
  ]) {
    if (typeof px === "number" && px > 0.5) {
      fail(`ENGINE fault-system text escapes the ${label} by ${px.toFixed(2)}px`)
    }
  }
}

/**
 * REGRESSION GUARD 2 - RC-14/2 vital value equals decision word at every viewport/state.
 *
 * Sharing the 0.62 compact-height factor and 34 px clamp maximum fixes the compact-landscape
 * divergence measured at 759x393 (23.53 vs 27.32 px) and 867x412 (26.88 vs 31.21 px). The
 * declared RC14_TYPE_SCALE_PX equality now fails closed anywhere the difference exceeds 0.5 px.
 */
function assertVitalDecisionTypeEquality(metrics, entry) {
  const decisionWordPx = valueOf(metrics, "decision word").fontSize
  const vitalValuePx = valueOf(metrics, "vital value").fontSize
  if (Math.abs(vitalValuePx - decisionWordPx) > 0.5) {
    const sizeKey = `${entry.size.width}x${entry.size.height}`
    fail(
      `type-scale: vital value ${vitalValuePx}px must equal decision word ${decisionWordPx}px ` +
      `(declared RC14_TYPE_SCALE_PX.vitalValue == RC14_TYPE_SCALE_PX.decisionWord; ` +
      `difference ${Math.abs(vitalValuePx - decisionWordPx).toFixed(2)}px at ${sizeKey})`
    )
  }
}

/**
 * Layout-conditional zone presence. Handled outside the shared overlap sweep because a zone
 * that does not exist cannot be peer-compared.
 *
 *  App layout only  : faultTimeline, decisionCorners
 *  Non-app layouts  : decisionBanner, cornerStatus
 *
 * Timeline content: silent → no faults → empty notice; critical-fault → ENGINE engaged →
 * at least one timeline mark.
 */
function assertLayoutConditionalZones(metrics, entry) {
  const app = entry.size.layout === "app"

  if (countOf(metrics, "panel-faultTimeline") !== (app ? 1 : 0)) {
    fail(
      `faultTimeline must exist only at app layout; ` +
      `found ${countOf(metrics, "panel-faultTimeline")} at "${entry.size.layout}" ` +
      "(app-only expand module, packet 12.1)"
    )
  }
  if (countOf(metrics, "panel-decisionCorners") !== (app ? 1 : 0)) {
    fail(
      `decisionCorners must exist only at app layout; ` +
      `found ${countOf(metrics, "panel-decisionCorners")} at "${entry.size.layout}"`
    )
  }
  if (countOf(metrics, "panel-decisionBanner") !== (app ? 0 : 1)) {
    fail(
      `decisionBanner must exist only at non-app layouts; ` +
      `found ${countOf(metrics, "panel-decisionBanner")} at "${entry.size.layout}"`
    )
  }
  if (countOf(metrics, "panel-cornerStatus") !== (app ? 0 : 1)) {
    fail(
      `cornerStatus must exist only at non-app layouts; ` +
      `found ${countOf(metrics, "panel-cornerStatus")} at "${entry.size.layout}"`
    )
  }

  if (app) {
    if (entry.state === "silent") {
      // No faults were ever engaged → timeline is empty
      if (countOf(metrics, "timeline-empty") !== 1) {
        fail(
          `app layout / silent state: timeline must show its empty notice ` +
          `(no fault ever engaged), found ${countOf(metrics, "timeline-empty")} empty notice(s)`
        )
      }
      if (countOf(metrics, "timeline-mark") !== 0) {
        fail(
          `app layout / silent state: no timeline marks must render, ` +
          `found ${countOf(metrics, "timeline-mark")}`
        )
      }
    } else {
      // critical-fault: engineOilPressureLamp engaged during the fixture run → 1 mark
      if (countOf(metrics, "timeline-empty") !== 0) {
        fail(
          `app layout / critical-fault: timeline must not show its empty notice ` +
          `(engineOilPressureLamp was engaged during the fixture run), ` +
          `found ${countOf(metrics, "timeline-empty")} empty notice(s)`
        )
      }
      if (countOf(metrics, "timeline-mark") < 1) {
        fail(
          `app layout / critical-fault: at least 1 timeline mark must render ` +
          `(engineOilPressureLamp engaged), found ${countOf(metrics, "timeline-mark")}`
        )
      }
    }
    // timeline-empty must never appear outside the app layout
  } else {
    if (countOf(metrics, "timeline-empty") !== 0) {
      fail(
        `timeline-empty must not exist outside app layout, ` +
        `found ${countOf(metrics, "timeline-empty")} at "${entry.size.layout}"`
      )
    }
  }
}

/**
 * Type scale.
 *
 * The brief declares one STRICT descending ladder and one DECLARED EQUALITY:
 *
 *   STRICT: rc14-decision-word > rc14-fault-chip > rc14-corner-head
 *
 *   MEASURED — all strictly descending at every viewport:
 *     800x480   40.00  > 19.00  > 12.00
 *     1024x600  51.20  > 24.32  > 15.36
 *     393x759   19.65  >  9.33  >  6.00
 *     412x867   20.60  >  9.79  >  6.18
 *     759x393   23.53  > 18.03  > 11.38
 *     867x412   26.88  > 20.59  > 13.01
 *
 *   EQUALITY: rc14-vital-value == rc14-decision-word (declared in RC14_TYPE_SCALE_PX)
 *
 *   MEASURED vital vs decision:
 *     800x480   40.00  == 40.00   ✓
 *     1024x600  51.20  == 51.20   ✓
 *     393x759   19.65  == 19.65   ✓
 *     412x867   20.60  == 20.60   ✓
 *     759x393   23.53  == 23.53   OK
 *     867x412   26.88  == 26.88   OK
 */
function assertTypeScale(metrics, entry) {
  const decisionWordPx = valueOf(metrics, "decision word").fontSize
  const faultChipPx    = valueOf(metrics, "fault chip").fontSize
  const cornerHeadPx   = valueOf(metrics, "corner head").fontSize
  const vitalValuePx   = valueOf(metrics, "vital value").fontSize

  // Strict descending ladder: decision-word > fault-chip > corner-head
  const scale = assertTypeScaleOrder([
    { label: "decision word", fontSize: decisionWordPx },
    { label: "fault chip",    fontSize: faultChipPx    },
    { label: "corner head",   fontSize: cornerHeadPx   }
  ])

  assertVitalDecisionTypeEquality(metrics, entry)

  return { steps: scale, rankDefects: [] }
}

// ── exported validators ────────────────────────────────────────────────────────────────────────

export function validateCaptureMetrics(metrics, entry) {
  const common = validateCommonMetrics(metrics, entry, RC14_SPEC)

  assertStateAttributes(metrics, entry)
  assertFixedCounts(metrics)
  assertSilhouettePanel(metrics)
  assertUnmonitoredZones(metrics)
  assertFaultList(metrics, entry)
  assertVitalOmissions(metrics)
  assertOperatingLamps(metrics)
  assertSpeedDeltaOmission(metrics)
  assertLayoutConditionalZones(metrics, entry)
  assertFaultSystemNameContained(metrics)
  assertVitalDecisionTypeEquality(metrics, entry)

  // Required text common to both states
  hasText(metrics, "NO ZONE")       // CHASSIS fault-row nozone notice
  hasText(metrics, "FAULT MAP")     // carSilhouette panel title
  hasText(metrics, "FAULTS")        // faultList panel title
  hasText(metrics, "VITALS")        // vitalsColumn panel title

  if (entry.state === "critical-fault") {
    hasText(metrics, "PIT")
    hasText(metrics, "CRITICAL")
  } else {
    hasText(metrics, "CONTINUE")
  }

  const { steps, rankDefects } = assertTypeScale(metrics, entry)
  return { ...common, typeScale: steps, typeRankDefects: rankDefects }
}

/**
 * Pixel audit.
 *
 * 1. Frame not blank against #0D0F12.
 * 2. Red absent from every silent frame; present AND scoped in every critical-fault frame.
 *    Scoped to: critical fault rows, critical silhouette zones, decision element, alerting
 *    vitals (alerting vitals may be empty on this fixture — see below).
 * 3. Amber absent from every frame in both states (no minor fault is triggered).
 * 4. Green present on every frame (ELECTRICAL zone is ok-green in both states; ok chips).
 * 5. PIXEL PROOF that no unmonitored zone is green: measure the green density inside the
 *    union of the six unmonitored zone rects and assert it is below RC14_UNMONITORED_GREEN_CEILING
 *    (omission: unmonitoredVersusOk).
 *
 * NOTE on alerting vitals in critical-fault state:
 * The fixture gives the oilPressure vitalRange alert only 2600ms (65 frames × 40ms) while
 * RC14_ALERT_ENGAGE_MS.vitalRange = 3000ms, so NO vital is alerting on this fixture. The
 * engineOilPressureLamp criticalFault alert (1000ms threshold) IS engaged, so the ENGINE row,
 * ENG zone and PIT decision carry all the red pixels.
 *
 * MEASURED hue-family census across all 6 viewports:
 *   silent      : red 0,        amber 0,  green 7 729–25 515,  cyan 950–1 352,  blue 1 402–5 926
 *   critical-fault: red 3 174–13 330, amber 0,  green 3 303–11 088,  cyan 948–1 339,  blue 1 005–4 378
 */
export function validateCapturePixels(buffer, entry, metrics) {
  if (!isGovernedSize(entry.size)) {
    fail(`unsupported capture pixel-audit size ${entry.size.width}x${entry.size.height}`)
  }
  const image = decodeCapturePng(buffer, entry.size)

  // 1. Frame is not blank
  let nonCanvasPixels = 0
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (!sameRgba(rgbaAt(image, x, y), RC14_CANVAS_RGBA)) nonCanvasPixels += 1
    }
  }
  if (nonCanvasPixels < RC14_MIN_NON_CANVAS_PIXELS) {
    fail("capture is blank against the RC-14 canvas colour (#0D0F12)")
  }

  // 2 + 3. Hue-family audit (red scoped in critical-fault state, absent in silent)
  const redFamily   = hueFamilyOfHex(RC14_DANGER_HEX)
  const amberFamily = hueFamilyOfHex(RC14_CAUTION_HEX)
  const greenFamily = hueFamilyOfHex(RC14_NORMAL_HEX)

  const redRects = entry.state === "critical-fault"
    ? (metrics.redScopeRects ?? []).filter((r) => r && r.width > 0 && r.height > 0)
    : []

  const audit = auditHueFamilies(
    image,
    entry.state === "critical-fault" ? { [redFamily]: redRects } : {}
  )

  if (entry.state === "silent") {
    assertHueFamilyAbsent(
      audit,
      redFamily,
      "silent frame — no critical fault is latched on this fixture"
    )
  } else {
    // MEASURED floor: 3 174 minimum red pixels across governed viewports
    assertHueFamilyPresent(
      audit,
      redFamily,
      "critical-fault frame — ENGINE zone, fault row and PIT decision must paint danger red",
      500
    )
    assertHueFamilyScoped(
      audit,
      redFamily,
      "critical-fault frame — all red pixels must fall within the critical fault row, " +
      "critical silhouette zone, decision element, or alerting vital"
    )
  }

  // 3. Amber absent from every frame
  // This fixture triggers no MINOR or MAJOR fault source; caution (#FFA82E) never fires.
  assertHueFamilyAbsent(
    audit,
    amberFamily,
    "every frame on this fixture (no minor fault source is triggered in either state)"
  )

  // 4. Green present on every frame
  // ELECTRICAL zone is ok-green in both states; OK chips also carry green.
  // MEASURED floor: 3 303 minimum in critical-fault state.
  assertHueFamilyPresent(
    audit,
    greenFamily,
    "every frame — monitored-OK zones and fault-row chips must paint normal green",
    500
  )

  // 5. PIXEL PROOF — unmonitored zones must not be green.
  // Measured noise floor (antialiasing against secondary outlines): < 0.1 %.
  // Ceiling: 0.5 % (RC14_UNMONITORED_GREEN_CEILING).
  const unmonitoredRects = (metrics.unmonitoredZoneRects ?? []).filter(
    (r) => r && r.width > 0 && r.height > 0
  )
  let greenDensityInUnmonitoredZones = null
  if (unmonitoredRects.length > 0) {
    const greenDensity = hueFamilyDensityInRects(image, greenFamily, unmonitoredRects)
    assertHueFamilyDensityBelow(
      greenDensity,
      RC14_UNMONITORED_GREEN_CEILING,
      `unmonitored zone union (${unmonitoredRects.length} zones, ` +
      `total area ~${Math.round(greenDensity.area)} px²) — ` +
      "outline-only zones must never carry the normal (#46C86E) green fill; " +
      `measured ${(greenDensity.density * 100).toFixed(4)}% — ` +
      "ceiling 0.5% (omission: unmonitoredVersusOk)"
    )
    greenDensityInUnmonitoredZones = Number((greenDensity.density * 100).toFixed(4))
  }

  return {
    width: image.width,
    height: image.height,
    opaque: true,
    nonCanvasPixels,
    hueFamilies: audit.counts,
    redAbsentOrScoped: entry.state === "silent" ? "absent" : "scoped",
    unmonitoredZoneRectCount: unmonitoredRects.length,
    greenDensityInUnmonitoredZonesPct: greenDensityInUnmonitoredZones
  }
}
