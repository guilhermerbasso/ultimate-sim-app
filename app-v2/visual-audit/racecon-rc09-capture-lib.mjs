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
 * RC-09 "Stage Time" — rally stage and co-driver timing. Only what its own DOM contract,
 * zones, channels, alert families and documented omissions make different from the rest of the
 * portfolio lives here; everything generic comes from `racecon-capture-shared.mjs`.
 *
 * Governance: approved attempt-004 (rc09-governance-chain-v1.json verdict APPROVED).
 */

export const RC09_PRESET_ID = "racecon_rc09_dash"
export const RC09_WIDGET_ID = "raceconRc09Dash"
export const RC09_SOURCE_IDENTITY = "iracing:session:91:connection:2"

/** Two governed scenarios: the silent frame and the latched SPLIT LOSS alert. */
export const CAPTURE_STATES = Object.freeze(["silent", "split-loss"])

/** RC09_LED_COUNT — the shift arc always paints nine segments, lit or not. */
export const RC09_LED_COUNT = 9
/** The support strip carries exactly three minis: SPEED, GEAR, WATER. */
export const RC09_MINI_COUNT = 3

/**
 * Colour families.
 *
 * RC-09's grammar is warm end to end — bg #0C0A07, panel #1A140D, primary #F6EEDF, secondary
 * #B0997C — so labels, units, cell rules, the distance readout and the resting shift arc all
 * land in the AMBER family, and so does the SPLIT LOSS surface (caution #EEA82F, with the
 * unbound signature #E8B84B only 3.7 degrees of hue away). Amber is therefore present on the
 * silent frame in quantity: measured 450–602 pixels outside the split chip at every viewport.
 * `assertHueFamilyAbsent("amber")` would be a false alarm and `assertHueFamilyScoped("amber")`
 * measured 512 legitimate chrome pixels outside the alert scope on the very first run.
 *
 * DENSITY separates them cleanly. The alert paints a SURFACE across the split chip; the silent
 * frame only ever paints the SPLIT label and the S unit there. Measured across all six
 * viewports and both states:
 *     silent      0.005 % … 0.153 % of the chip
 *     split-loss  3.190 % … 12.714 % of the chip
 * a better than twenty-fold separation, and the amber OUTSIDE the chip is byte-identical in
 * both states — which is precisely the claim "the alert colour appears only under its own
 * alert scope". The thresholds below sit in the middle of that gap so the check fails closed
 * in both directions: an alert that never painted, and an alert surface on a silent frame.
 *
 * DANGER #E7452F is the red family and is carried only by the caution-waypoint tile and the
 * mechanical-fault line. This fixture triggers neither, so red must measure exactly zero on
 * every frame at every viewport.
 */
export const RC09_DANGER_HEX = "#e7452f"
export const RC09_CAUTION_HEX = "#eea82f"
export const RC09_SIGNATURE_HEX = "#e8b84b"
export const RC09_NORMAL_HEX = "#57c06a"
export const RC09_CANVAS_RGBA = Object.freeze([12, 10, 7, 255]) // bg #0C0A07

/** Measured 0.153 % worst case silent, 3.190 % best case engaged. */
export const RC09_SPLIT_AMBER_RESTING_CEILING = 0.01
export const RC09_SPLIT_AMBER_ENGAGED_FLOOR = 0.02

/**
 * The governed type ladder. RC09_TYPE_SCALE_PX declares `note: 40` and `support: 40` as the
 * SAME rank — the approved image QA measured "note 35 ~ support 36" and accepted it — so the
 * note value is deliberately NOT a step of the strict ladder. Asserting an inequality the
 * packet never claimed would manufacture a failure; asserting the band it must stay inside is
 * the real contract.
 */
export const RC09_TYPE_SCALE_STEPS = Object.freeze([
  "stage timer",
  "split value",
  "support value",
  "note distance",
  "distance to finish"
])

/** Documented omission placeholders. A digit in any of these is a reintroduction. */
export const RC09_DISTANCE_TO_FINISH_TEXT = "TO FIN --.- KM"
export const RC09_NOTE_DISTANCE_TEXT = "--- M"
export const RC09_STAGE_EMPTY_TEXT = "NO STAGE DISTANCE SOURCE"

/** The roadbook call the fixture loads, and the glyph family it selects. */
export const RC09_NOTE_TEXT = "LEFT 4 LONG"
export const RC09_NOTE_GLYPH = "left"

export const RC09_SPEC = Object.freeze({
  artifact: "RaceCon RC-09",
  script: "racecon-rc09-capture.mjs",
  presetId: RC09_PRESET_ID,
  widgetId: RC09_WIDGET_ID,
  attrPrefix: "data-rc09-",
  rootSelector: "#racecon-rc09-capture-root",
  captureHtml: "racecon-rc09-capture.html",
  dashboardSelector: ".rc09-dashboard",
  sourceIdentity: RC09_SOURCE_IDENTITY,
  stateAttributes: Object.freeze([
    "alerts",
    "alert-keys",
    "roadbook",
    "stage-source",
    "split-state"
  ]),
  /**
   * The five peer zones present at every governed viewport. The stage-profile strip is an
   * app-only reveal and is checked in assertAppOnlyReveals rather than in the shared
   * zone-overlap sweep, because a zone that does not exist cannot be compared.
   */
  zones: Object.freeze([
    Object.freeze(["timeline", '[data-testid="rc09-timeline"]']),
    Object.freeze(["clock", '[data-testid="rc09-clock"]']),
    Object.freeze(["split", '[data-testid="rc09-split"]']),
    Object.freeze(["note", '[data-testid="rc09-note"]']),
    Object.freeze(["support", '[data-testid="rc09-support"]'])
  ]),
  zoneOverlapExemptions: Object.freeze([]),
  values: Object.freeze([
    Object.freeze(["stage timer", '[data-testid="rc09-stage-timer"]']),
    Object.freeze(["split value", '[data-testid="rc09-split-value"]']),
    Object.freeze(["note value", '[data-testid="rc09-note-value"]']),
    Object.freeze(["note distance", '[data-testid="rc09-note-distance"]']),
    Object.freeze(["distance to finish", '[data-testid="rc09-distance-to-finish"]']),
    Object.freeze(["speed", '[data-testid="rc09-speed"]']),
    Object.freeze(["gear", '[data-testid="rc09-gear"]']),
    Object.freeze(["water", '[data-testid="rc09-water"]'])
  ]),
  containment: Object.freeze([
    Object.freeze(["stage timer", '[data-testid="rc09-clock"]', '[data-testid="rc09-stage-timer"]']),
    Object.freeze(["split value", '[data-testid="rc09-split"]', '[data-testid="rc09-split-value"]']),
    Object.freeze(["split arrow", '[data-testid="rc09-split"]', '[data-testid="rc09-split-arrow"]']),
    Object.freeze(["note value", '[data-testid="rc09-note"]', '[data-testid="rc09-note-value"]']),
    Object.freeze(["note distance", '[data-testid="rc09-note"]', '[data-testid="rc09-note-distance"]']),
    Object.freeze(["distance to finish", '[data-testid="rc09-timeline"]', '[data-testid="rc09-distance-to-finish"]']),
    Object.freeze(["stage empty line", '[data-testid="rc09-timeline"]', '[data-testid="rc09-timeline-empty"]']),
    Object.freeze(["shift arc", '[data-testid="rc09-support"]', '[data-testid="rc09-arc"]']),
    Object.freeze(["speed", '[data-testid="rc09-support"]', '[data-testid="rc09-speed"]']),
    Object.freeze(["water", '[data-testid="rc09-support"]', '[data-testid="rc09-water"]'])
  ]),
  counted: Object.freeze([
    Object.freeze(["led", '[data-testid="rc09-led"]']),
    Object.freeze(["mini", '[data-testid="rc09-mini"]']),
    Object.freeze(["timeline fill", '[data-testid="rc09-timeline-fill"]']),
    Object.freeze(["timeline marker", '[data-testid="rc09-timeline-marker"]']),
    Object.freeze(["timeline empty", '[data-testid="rc09-timeline-empty"]']),
    Object.freeze(["note glyph", '[data-testid="rc09-note-glyph"]']),
    Object.freeze(["split loss", '[data-testid="rc09-split-loss"]']),
    Object.freeze(["caution waypoint", '[data-testid="rc09-caution-waypoint"]']),
    Object.freeze(["mechanical", '[data-testid="rc09-mechanical"]']),
    Object.freeze(["mini fault line", '[data-testid^="rc09-mini-line"]']),
    Object.freeze(["profile", '[data-testid="rc09-profile"]']),
    Object.freeze(["profile bar", '[data-testid="rc09-profile-bar"]']),
    Object.freeze(["profile empty", '[data-testid="rc09-profile-empty"]'])
  ]),
  /**
   * omission fuelReadout: packet 16 fuel level is allocated no zone in either grammar, so no
   * fuel surface exists anywhere in the widget or its stylesheet. Absence is the contract:
   * a single matching element is a reintroduction, which is the only outcome this can report.
   */
  forbidden: Object.freeze([
    Object.freeze([
      "a fuel readout (omission: fuelReadout)",
      '.rc09-fuel, [data-rc09-zone="fuel"], [data-testid="rc09-fuel"], [data-channel="fuel"]'
    ])
  ]),
  knownDefects: Object.freeze([]),
  /**
   * DEFECT RC-09/1 — the split value escapes the bottom of the split chip.
   *
   * The split chip sizes its type from a container query while its own height comes from the
   * zone grid, and above the native breakpoint the two disagree: the value's layout box is
   * taller than the chip that clips it, so the reading paints past the bottom edge of its own
   * zone. Measured with getBoundingClientRect, silent and split-loss:
   *
   *     1024x600  app                 zone +2 px   value escapes bottom by  2.22 px (silent)
   *     759x393   compact/landscape   zone +4 px   value escapes bottom by  4.86 px (silent)
   *     867x412   compact/landscape   zone +11 px  value escapes bottom by 10.59 px (silent)
   *     867x412   compact/landscape   zone +6 px   value escapes bottom by  5.11 px (split-loss)
   *
   * 800x480 native and both compact-phone viewports are clean. The engaged frame is smaller at
   * 759x393 and 867x412 than the silent one because the SPLIT LOSS line re-flows the chip.
   *
   * Recorded, NOT suppressed: the budget is the measured maximum plus a small font-metric
   * allowance, so a defect that grows, spreads to another breakpoint or appears on another
   * element still fails closed.
   */
  zoneOverflowDefects: Object.freeze([
    Object.freeze({
      zone: "split",
      states: Object.freeze(["silent", "split-loss"]),
      sizes: Object.freeze(["1024x600", "759x393", "867x412"]),
      budgetPx: 13,
      note:
        "split chip vertical overflow above the native breakpoint: the container-query type scale sizes the split " +
        "value taller than the chip the zone grid allocates (app +2 px, compact-landscape +4…+11 px)"
    })
  ]),
  containmentDefects: Object.freeze([
    Object.freeze({
      label: "split value",
      states: Object.freeze(["silent", "split-loss"]),
      sizes: Object.freeze(["1024x600", "759x393", "867x412"]),
      budgetPx: 13,
      note:
        "the split value's box escapes the bottom edge of the split chip it belongs to " +
        "(1024x600 ≈2.22 px, 759x393 ≈4.86 px, 867x412 ≈10.59 px silent / ≈5.11 px engaged)"
    })
  ])
})

export const RC09_CAPTURE_MATRIX = Object.freeze(
  CAPTURE_STATES.flatMap((state) =>
    CAPTURE_SIZES.map((size) =>
      Object.freeze({
        size,
        state,
        // SPLIT LOSS latches after RC09_SPLIT_LOSS_ENGAGE_MS (1 000 ms) of delta above the
        // 2.0 s threshold; the harness waits on the published attribute, never a frame count.
        required: Object.freeze(
          state === "split-loss"
            ? [Object.freeze(["alerts", "active"]), Object.freeze(["roadbook", "loaded"])]
            : [Object.freeze(["alerts", "silent"]), Object.freeze(["roadbook", "loaded"])]
        )
      })
    )
  )
)

/** Reference readings from the fixture. */
const RC09_EXPECTED = Object.freeze({
  stageTimer: "02:34.8",
  splitSilent: "+0.4",
  splitLoss: "+3.3",
  speed: "112",
  gear: "4",
  water: "88"
})

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

/**
 * omission stageDistanceReadout — section 16 defines no stage-distance channel, so the
 * distance-to-finish readout dashes, the stage line names its missing source, and the travelled
 * fill and the position marker are WITHHELD rather than drawn at a guessed fraction.
 *
 * All three surfaces are asserted as absence-is-the-contract: a fill element, a marker element
 * or a digit in either readout is a reintroduction and fails.
 */
function assertStageOmission(metrics) {
  const finishText = valueOf(metrics, "distance to finish").text
  if (finishText !== RC09_DISTANCE_TO_FINISH_TEXT) {
    fail(
      `distance to finish reads "${finishText}" instead of the required "${RC09_DISTANCE_TO_FINISH_TEXT}" ` +
        "(omission: stageDistanceReadout)"
    )
  }
  if (/[0-9]/u.test(finishText)) {
    fail(`distance to finish contains a digit "${finishText}" — this reintroduces omission stageDistanceReadout`)
  }
  if (metrics.stateAttributes["stage-source"] !== "unavailable") {
    fail(
      `data-rc09-stage-source must be "unavailable" while no stage-distance channel exists, received ` +
        `"${metrics.stateAttributes["stage-source"]}"`
    )
  }
  if (countOf(metrics, "timeline empty") !== 1) {
    fail("the timeline must render exactly one empty-state line naming its missing source")
  }
  if (metrics.stageEmptyText !== RC09_STAGE_EMPTY_TEXT) {
    fail(`the stage empty line reads "${metrics.stageEmptyText}" instead of "${RC09_STAGE_EMPTY_TEXT}"`)
  }
  if (countOf(metrics, "timeline fill") !== 0) {
    fail(
      `${countOf(metrics, "timeline fill")} travelled-fill element(s) rendered with no stage-distance channel — ` +
        "this reintroduces omission stageDistanceReadout"
    )
  }
  if (countOf(metrics, "timeline marker") !== 0) {
    fail(
      `${countOf(metrics, "timeline marker")} stage marker(s) rendered with no stage-distance channel — ` +
        "this reintroduces omission stageDistanceReadout"
    )
  }
}

/**
 * omission noteDistanceReadout — section 16 defines no distance-to-waypoint channel, so the
 * distance beneath the note dashes even though a roadbook IS loaded. That separation is the
 * whole point: a loaded roadbook must not be allowed to imply a distance nobody measured.
 */
function assertNoteDistanceOmission(metrics) {
  const distance = valueOf(metrics, "note distance").text
  if (distance !== RC09_NOTE_DISTANCE_TEXT) {
    fail(`note distance reads "${distance}" instead of "${RC09_NOTE_DISTANCE_TEXT}" (omission: noteDistanceReadout)`)
  }
  if (/[0-9]/u.test(distance)) {
    fail(`note distance contains a digit "${distance}" — this reintroduces omission noteDistanceReadout`)
  }
}

/** The roadbook the fixture loads must be the reading on screen, with its own glyph family. */
function assertNoteCue(metrics) {
  if (metrics.stateAttributes.roadbook !== "loaded") {
    fail(`data-rc09-roadbook must be "loaded", received "${metrics.stateAttributes.roadbook}"`)
  }
  const note = valueOf(metrics, "note value")
  if (note.text !== RC09_NOTE_TEXT) fail(`note cue reads "${note.text}" instead of "${RC09_NOTE_TEXT}"`)
  if (metrics.noteState !== "loaded") fail(`the note tile must publish data-rc09-note="loaded", received "${metrics.noteState}"`)
  if (metrics.noteGlyph !== RC09_NOTE_GLYPH) {
    fail(`the note glyph family must be "${RC09_NOTE_GLYPH}" for a LEFT call, received "${metrics.noteGlyph}"`)
  }
  if (countOf(metrics, "note glyph") !== 1) fail("a loaded, non-blank note must draw exactly one glyph")
}

function assertSupportStrip(metrics) {
  if (countOf(metrics, "led") !== RC09_LED_COUNT) {
    fail(`the shift arc must paint exactly ${RC09_LED_COUNT} segments, found ${countOf(metrics, "led")}`)
  }
  if (countOf(metrics, "mini") !== RC09_MINI_COUNT) {
    fail(`the support strip must carry exactly ${RC09_MINI_COUNT} minis, found ${countOf(metrics, "mini")}`)
  }
  const speed = valueOf(metrics, "speed")
  const gear = valueOf(metrics, "gear")
  const water = valueOf(metrics, "water")
  if (speed.text !== RC09_EXPECTED.speed) fail(`speed reads "${speed.text}" instead of "${RC09_EXPECTED.speed}"`)
  if (gear.text !== RC09_EXPECTED.gear) fail(`gear reads "${gear.text}" instead of "${RC09_EXPECTED.gear}"`)
  if (water.text !== RC09_EXPECTED.water) fail(`water reads "${water.text}" instead of "${RC09_EXPECTED.water}"`)
  assertNoHorizontalOverflow(speed.rect, "speed value")
  assertNoHorizontalOverflow(gear.rect, "gear value")
  assertNoHorizontalOverflow(water.rect, "water value")
  // The fixture holds water and oil pressure inside their ranges, so no mini may be faulted.
  if (metrics.mechanicalState !== "false") {
    fail(`the support strip must not be faulted on this fixture, received data-rc09-mechanical="${metrics.mechanicalState}"`)
  }
  if (countOf(metrics, "mini fault line") !== 0) {
    fail(`${countOf(metrics, "mini fault line")} mini fault line(s) rendered while every channel sits in range`)
  }
}

function assertClock(metrics) {
  const timer = valueOf(metrics, "stage timer")
  if (timer.text !== RC09_EXPECTED.stageTimer) {
    fail(`stage clock reads "${timer.text}" instead of "${RC09_EXPECTED.stageTimer}"`)
  }
  assertNoHorizontalOverflow(timer.rect, "stage clock")
}

/**
 * The SPLIT LOSS alert. Silent frames must carry no alert surface at all — not merely an
 * un-triggered one — so the alert line, the caution line and the mechanical line are all
 * counted to zero, and the alert-keys attribute must be empty rather than absent.
 */
function assertSplit(metrics, entry) {
  const split = valueOf(metrics, "split value")
  const alertsActive = metrics.stateAttributes.alerts === "active"
  const alertKeys = String(metrics.stateAttributes["alert-keys"] ?? "")
  if (entry.state === "split-loss") {
    if (!alertsActive) fail("the split-loss state must latch data-rc09-alerts='active'")
    if (alertKeys !== "SPLIT LOSS") {
      fail(`data-rc09-alert-keys must be exactly "SPLIT LOSS" in the split-loss state, received "${alertKeys}"`)
    }
    if (split.text !== RC09_EXPECTED.splitLoss) {
      fail(`split reads "${split.text}" instead of "${RC09_EXPECTED.splitLoss}"`)
    }
    if (metrics.splitLoss !== "true") {
      fail(`the split chip must publish data-rc09-split-loss="true", received "${metrics.splitLoss}"`)
    }
    if (countOf(metrics, "split loss") !== 1) fail("the split-loss state must render exactly one SPLIT LOSS line")
  } else {
    if (alertsActive) fail(`silent state must publish data-rc09-alerts='silent', received "${metrics.stateAttributes.alerts}"`)
    if (alertKeys !== "") fail(`silent state must publish empty alert-keys, received "${alertKeys}"`)
    if (split.text !== RC09_EXPECTED.splitSilent) {
      fail(`split reads "${split.text}" instead of "${RC09_EXPECTED.splitSilent}"`)
    }
    if (metrics.splitLoss !== "false") {
      fail(`the silent split chip must publish data-rc09-split-loss="false", received "${metrics.splitLoss}"`)
    }
    if (countOf(metrics, "split loss") !== 0) fail("the silent frame must render no SPLIT LOSS line")
  }
  // Neither the caution waypoint nor a mechanical fault is reachable from this fixture, in
  // either state: the roadbook call is not a hazard and every mechanical channel sits in range.
  if (countOf(metrics, "caution waypoint") !== 0) {
    fail("this fixture loads a non-hazard roadbook call; no caution-waypoint line may render")
  }
  if (countOf(metrics, "mechanical") !== 0) {
    fail("this fixture holds water and oil pressure in range; no mechanical warning line may render")
  }
  if (metrics.cautionState !== "false") {
    fail(`the note tile must publish data-rc09-caution="false" on this fixture, received "${metrics.cautionState}"`)
  }
}

/** The stage-profile strip is revealed at app size only, and never at any other viewport. */
function assertAppOnlyReveals(metrics, entry) {
  const app = entry.size.layout === "app"
  if (countOf(metrics, "profile") !== (app ? 1 : 0)) {
    fail(`the stage-profile strip must exist only at app size; found ${countOf(metrics, "profile")} at ${entry.size.layout}`)
  }
  if (!app) {
    if (countOf(metrics, "profile bar") !== 0 || countOf(metrics, "profile empty") !== 0) {
      fail("no profile surface may render outside the app layout")
    }
    return
  }
  // One roadbook call is loaded, so the strip carries exactly one bar and no empty notice.
  if (countOf(metrics, "profile bar") !== 1) {
    fail(`the app profile strip must draw one bar for the single loaded call, found ${countOf(metrics, "profile bar")}`)
  }
  if (countOf(metrics, "profile empty") !== 0) {
    fail("the app profile strip must not render its NO ROADBOOK notice while a call is loaded")
  }
}

function assertNativeSize(metrics, entry) {
  const expected = entry.size.layout === "native" ? "800x480" : null
  if (metrics.nativeSize !== expected) {
    fail(`native content-box modifier must be ${String(expected)}, received ${String(metrics.nativeSize)}`)
  }
}

/**
 * Five strictly descending steps. `note value` is deliberately excluded from the strict ladder:
 * RC09_TYPE_SCALE_PX declares note and support as ONE rank (40 px each) and the approved image
 * QA measured "note 35 ~ support 36" and accepted it, so an inequality between them would be
 * invented rather than governed. What the packet DOES rank is split (64 px) above note (40 px),
 * and that is checked separately against the ledger below.
 *
 * DEFECT RC-09/2 — the split and note ranks collapse at compact-phone.
 *
 * raceconRc09.css gives `.rc09-split-value` and `.rc09-note-value` a SINGLE shared rule under
 * the compact-phone selector — `font-size: clamp(16px, 11cqw, 56px)` for both — so two distinct
 * packet type ranks render at exactly the same size:
 *
 *     393x759   split 43.23 px  ==  note 43.23 px
 *     412x867   split 45.32 px  ==  note 45.32 px
 *
 * Every other viewport keeps them apart (800x480 64 > 38.98, 1024x600 81.92 > 51.2,
 * 759x393 60.72 > 37.46, 867x412 69.36 > 42.8). A tie is a failure, so the collapse is recorded
 * rather than tolerated silently: the ledger names the exact viewports, and the check still
 * fails if the tie spreads to another breakpoint or if the note ever grows LARGER than the
 * split chip.
 */
const RC09_TYPE_RANK_DEFECTS = Object.freeze([
  Object.freeze({
    label: "split value over note value",
    states: Object.freeze(["silent", "split-loss"]),
    sizes: Object.freeze(["393x759", "412x867"]),
    note:
      "compact-phone collapses two packet type ranks into one: raceconRc09.css applies a single " +
      "font-size: clamp(16px, 11cqw, 56px) rule to .rc09-split-value and .rc09-note-value together"
  })
])

function assertTypeScale(metrics, entry) {
  const scale = assertTypeScaleOrder([
    { label: "stage timer", fontSize: valueOf(metrics, "stage timer").fontSize },
    { label: "split value", fontSize: valueOf(metrics, "split value").fontSize },
    { label: "support value", fontSize: valueOf(metrics, "speed").fontSize },
    { label: "note distance", fontSize: valueOf(metrics, "note distance").fontSize },
    { label: "distance to finish", fontSize: valueOf(metrics, "distance to finish").fontSize }
  ])
  const note = valueOf(metrics, "note value").fontSize
  const split = valueOf(metrics, "split value").fontSize
  const noteDistance = valueOf(metrics, "note distance").fontSize
  const rankDefects = []
  if (!(note < split)) {
    const sizeKey = `${entry.size.width}x${entry.size.height}`
    const waiver = RC09_TYPE_RANK_DEFECTS.find(
      (candidate) => candidate.states.includes(entry.state) && candidate.sizes.includes(sizeKey)
    )
    if (!waiver) {
      fail(
        `type-scale hierarchy does not hold: the split chip ${split}px must be strictly larger than ` +
          `the note cue ${note}px`
      )
    }
    // A recorded tie is never a licence to invert the rank.
    if (note > split) {
      fail(
        `the note cue ${note}px is LARGER than the split chip ${split}px, past the recorded tie: ${waiver.note}`
      )
    }
    rankDefects.push({
      label: waiver.label,
      state: entry.state,
      size: sizeKey,
      splitPx: split,
      notePx: note,
      note: waiver.note
    })
  }
  if (!(note > noteDistance)) {
    fail(`the note cue ${note}px must sit above the note distance ${noteDistance}px in the type ladder`)
  }
  return { steps: [...scale, { label: "note value", fontSize: note }], rankDefects }
}

const RC09_REQUIRED_TEXT_COMMON = Object.freeze([
  RC09_DISTANCE_TO_FINISH_TEXT,
  RC09_STAGE_EMPTY_TEXT,
  RC09_NOTE_DISTANCE_TEXT,
  RC09_NOTE_TEXT,
  RC09_EXPECTED.stageTimer,
  RC09_EXPECTED.speed,
  RC09_EXPECTED.water
])
const RC09_REQUIRED_TEXT_SILENT = Object.freeze([...RC09_REQUIRED_TEXT_COMMON, RC09_EXPECTED.splitSilent])
const RC09_REQUIRED_TEXT_LOSS = Object.freeze([...RC09_REQUIRED_TEXT_COMMON, RC09_EXPECTED.splitLoss, "SPLIT LOSS"])

/**
 * Leaf text that would prove an omitted channel had been invented. The stage-distance and
 * note-distance units are the tell: printing KM or M beside a NUMBER anywhere would mean a
 * distance had been synthesised, and the two threshold constants must never be printed either.
 */
const RC09_FORBIDDEN_LEAF_TEXT = Object.freeze([
  Object.freeze(["0.0 KM", "would reintroduce the omitted stage-distance readout (RC09_PACKET_OMISSIONS.stageDistanceReadout)"]),
  Object.freeze(["0 M", "would reintroduce the omitted distance-to-waypoint readout (RC09_PACKET_OMISSIONS.noteDistanceReadout)"]),
  Object.freeze(["FUEL", "would reintroduce the omitted fuel readout (RC09_PACKET_OMISSIONS.fuelReadout)"])
])

export function validateCaptureMetrics(metrics, entry, _unused) {
  const common = validateCommonMetrics(metrics, entry, RC09_SPEC)

  assertNativeSize(metrics, entry)
  for (const expected of entry.state === "split-loss" ? RC09_REQUIRED_TEXT_LOSS : RC09_REQUIRED_TEXT_SILENT) {
    hasText(metrics, expected)
  }
  for (const [forbidden, why] of RC09_FORBIDDEN_LEAF_TEXT) lacksLeafText(metrics, forbidden, why)

  assertStageOmission(metrics)
  assertNoteDistanceOmission(metrics)
  assertNoteCue(metrics)
  assertClock(metrics)
  assertSplit(metrics, entry)
  assertSupportStrip(metrics)
  assertAppOnlyReveals(metrics, entry)

  // Every value must also sit inside the zone that owns it, measured by rectangle.
  containsRect(zoneOf(metrics, "clock"), valueOf(metrics, "stage timer").rect, "stage clock in its zone", 0.5)
  containsRect(zoneOf(metrics, "note"), valueOf(metrics, "note value").rect, "note cue in its zone", 0.5)

  const { steps, rankDefects } = assertTypeScale(metrics, entry)
  return { ...common, typeScale: steps, typeRankDefects: rankDefects }
}

const RC09_MIN_NON_CANVAS_PIXELS = 5_000

/**
 * The pixel audit proves:
 *  1. the frame is not blank against the RC-09 canvas #0C0A07;
 *  2. DANGER (red family) measures exactly zero on EVERY frame — the caution-waypoint tile and
 *     the mechanical-fault line are the only red surfaces and neither is reachable from this
 *     fixture;
 *  3. NORMAL (green family) is painted on every frame by the resting shift arc;
 *  4. the SPLIT LOSS alert surface is present ONLY under its own alert scope, measured as the
 *     amber density inside the split chip: at most 1 % on a silent frame, at least 2 % when
 *     the alert is latched. See RC09_SPLIT_AMBER_* for why density rather than absence is the
 *     only honest test against a wholly warm palette.
 *
 * Colour is confirmed by hue family, never by channel ratio: a `g,b < 0.62r` style test
 * measured 8 578 "red" pixels on a frame whose hue-confirmed truth was zero.
 */
export function validateCapturePixels(buffer, entry, metrics) {
  if (!isGovernedSize(entry.size)) fail(`unsupported capture pixel-audit size ${entry.size.width}x${entry.size.height}`)
  const image = decodeCapturePng(buffer, entry.size)
  const audit = auditHueFamilies(image, {})

  let nonCanvasPixels = 0
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (!sameRgba(rgbaAt(image, x, y), RC09_CANVAS_RGBA)) nonCanvasPixels += 1
    }
  }
  if (nonCanvasPixels < RC09_MIN_NON_CANVAS_PIXELS) {
    fail("capture is blank against the RC-09 canvas colour (#0C0A07)")
  }

  const redFamily = hueFamilyOfHex(RC09_DANGER_HEX)
  assertHueFamilyAbsent(
    audit,
    redFamily,
    "the RC-09 frame (neither the caution waypoint nor a mechanical fault is reachable from this fixture)"
  )
  const greenFamily = hueFamilyOfHex(RC09_NORMAL_HEX)
  assertHueFamilyPresent(audit, greenFamily, "the RC-09 frame — the resting shift arc must be painted", 1)

  if (!Array.isArray(metrics.splitScope) || metrics.splitScope.length !== 1) {
    fail("capture did not measure the split chip rectangle that owns the SPLIT LOSS alert")
  }
  const splitAmber = hueFamilyDensityInRects(image, hueFamilyOfHex(RC09_CAUTION_HEX), metrics.splitScope)
  if (entry.state === "split-loss") {
    assertHueFamilyDensityAtLeast(splitAmber, RC09_SPLIT_AMBER_ENGAGED_FLOOR, "the RC-09 split-loss frame")
  } else {
    assertHueFamilyDensityBelow(splitAmber, RC09_SPLIT_AMBER_RESTING_CEILING, "the RC-09 silent frame")
  }

  return {
    width: image.width,
    height: image.height,
    opaque: true,
    nonCanvasPixels,
    hueFamilies: audit.counts,
    splitChipAmberDensity: Number((splitAmber.density * 100).toFixed(3)),
    splitChipAmberInside: splitAmber.inside,
    amberOutsideSplitChip: splitAmber.outside
  }
}

export { CaptureSafetyError, exact, finite }
