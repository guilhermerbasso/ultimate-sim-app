import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import {
  type Rc01ChannelReceipt,
  type Rc01Field,
  rc01FieldDescription,
  rc01MonotonicNow,
  rc01ReceiptAgeMs
} from './raceconRc01Core'

/**
 * RaceCon RC-14 "Triage — Vehicle Health & Damage Assessment" core.
 *
 * This is a DIAGNOSTIC page, not a pace page. Packet section 10 suppresses shift LEDs and every
 * pace hero outright: the moment is "the car was hit, do I continue, limp or pit", so health
 * outranks lap time entirely. Area hierarchy is silhouette-driven (the fault map owns the centre);
 * type hierarchy is vitals-driven (the gauge numerals and the decision word are the tallest glyphs
 * in the frame, and the fault map's own zone labels are the SMALLEST text — deliberately, per
 * packet 11.2 and implementation brief gap G5).
 *
 * The live-only ingest buffer, identity binding, mock/replay refusal, out-of-order and
 * same-timestamp guards and the shared channel receipts are reused verbatim from `raceconRc01Core`:
 * that is telemetry-truth machinery, not RC-01 styling, and a fork would silently drift. RC-01's
 * alert layer is deliberately NOT driven from here — RC-01 debounces over-rev, delta-cliff,
 * zero-cross and pit-limiter, and RC-14's packet section 15 defines three completely different
 * alerts with latch-until-acknowledged semantics that RC-01 has no concept of.
 *
 * THE HARD REQUIREMENT IN THIS ARTIFACT is that a fault may never be invented. The app's telemetry
 * snapshot carries no per-zone damage channel at all — `damagePct` is one whole-car scalar and no
 * provider emits per-part damage — so six of the eight silhouette zones can never be tinted by
 * anything. They render UNMONITORED (outline only, dash chip), which is visually distinct from OK,
 * because painting an uninspected corner green asserts health the app cannot know. That distinction
 * is implementation brief gap G7 and it is the single most load-bearing decision in this build.
 *
 * Fourteen packet contradictions are resolved by OMISSION or by a declared normative override, and
 * every one is asserted by the suite through `RC14_PACKET_OMISSIONS`, so a later edit cannot quietly
 * reintroduce them.
 */

// ─────────────────────────────────────────────────────────── canvas + breakpoints

/** Packet section 11 native canvas, and the section 12.1 app reflow target. */
export const RC14_NATIVE_WIDTH_PX = 800
export const RC14_NATIVE_HEIGHT_PX = 480
export const RC14_NATIVE_TOLERANCE_PX = 1
export const RC14_APP_WIDTH_PX = 1024
export const RC14_APP_HEIGHT_PX = 600

export const RC14_PHONE_MIN_WIDTH_PX = 360
export const RC14_PHONE_MAX_WIDTH_PX = 480
export const RC14_PHONE_MIN_HEIGHT_PX = 650
export const RC14_LANDSCAPE_MIN_WIDTH_PX = 650
export const RC14_LANDSCAPE_MIN_HEIGHT_PX = 360
export const RC14_LANDSCAPE_MAX_HEIGHT_PX = 480

export type Rc14CompactMode = 'phone' | 'landscape' | 'standard'
export type Rc14Layout = 'native' | 'app' | 'compact'

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function round3(value: number): number {
  return Math.round(value * 1_000) / 1_000
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

// ─────────────────────────────────────────────────────────── packet omissions

/**
 * The packet requirements this build deliberately does NOT render, and the normative overrides it
 * applies instead, each with its reason. Every key is asserted by the suite: the omission is part of
 * the contract, not an oversight. The packet files themselves are left UNMODIFIED.
 */
export const RC14_PACKET_OMISSIONS = Object.freeze({
  speedAndDeltaZones:
    'packet 16 defines Speed (km/h, 100 ms) and Delta to best (s, per sample) with full source, unit, staleness and never-estimate rules and packet 10 lists both as tertiary, but neither 11.1 nor 12.1 defines any zone that can host them: neither channel is rendered at all, not even as a dash, and no corner is improvised for them',
  perZoneDamageChannel:
    "packet 16's damage/system fault map has no per-zone source in the app: damagePct is a single whole-car scalar and no provider emits per-part damage, so FRONT AERO, GEARBOX and all four CORNER zones have no fault channel and render permanently unmonitored, while the whole-car repair requirement is published as a CHASSIS row with NO silhouette zone rather than painted onto a location it cannot know",
  unmonitoredVersusOk:
    'packet 16 calls an item with no fault channel "hidden", which would make an unmonitored zone identical to an OK zone: an unmonitored zone is drawn outline-only in secondary with a dash chip and no list row, and only a zone with a live fault channel may ever be filled normal green',
  severityHueRamp:
    'packet 11.3 offers three status hues for four severity levels, so MINOR and MAJOR both bind caution and hue alone cannot separate them: the chip WORD and the fill PATTERN carry the difference and the hue ramp is documented as a coarse three-level ramp',
  infoSignatureSeparability:
    "packet 11.3's info #40B8D0 and signature #6EE7FF are 0.1 deg apart in hue (dE76 16.55) and cannot be told apart: info is retuned to hue ~205 deg for the gauge-bar fill so the bar and the silhouette outline are separable, and the packet file is left unmodified",
  systemsDetailPanel:
    'packet 12 prose promises the app view adds "a fault-timeline and a systems detail panel" but 12.1 defines a rectangle only for the timeline: the systems detail panel is not built, because inventing its rectangle would invent its content too',
  acknowledgeControlZone:
    'packet 13 lists a fault acknowledge control and 11.5 describes a macro button for it, but neither 11.1 nor 12.1 gives it a zone: the acknowledge affordance is carried INSIDE the fault-list row, which is packet 11.5 own "tapping a fault", and no separate macro-button rectangle is invented',
  cornerStatusTypeSize:
    'packet 11.2 defines no type size for corner status and its 208x70 px zone must carry four column headers, two row labels and eight values: the per-corner grain is KEPT because averaging two independent sensors into an axle is the mirroring packet 16 forbids, and the tier is declared here at 14 px values over 12 px headers',
  headerFooterBands:
    'packet 11.1 assigns only 71.46 % of the native canvas and defines neither a header nor a footer for the 50 px band above and below every zone: both bands are left bare rather than filled with a title or a session strip that has no zone',
  oilTempBarScale:
    'packet 16 defines oil temperature but neither the packet nor the brief gives its gauge scale, and the approved frame dashes it: the bar is scaled 60-150 degC and the choice is declared in RC14_VITAL_SCALE rather than traced off a render',
  vitalRangeThresholds:
    'packet 15 requires a vital out-of-range alert but neither the packet nor the brief defines any range: explicit bounds are declared in RC14_VITAL_RANGE and the alert binds oil pressure, water temperature and battery voltage only, never oil temperature, which packet 15 does not list',
  operatingLampsAreNotFaults:
    "the app's engineWarnings bitfield also carries revLimiter and pitLimiter, which are normal operating lamps rather than faults: they are excluded from the fault model entirely, because surfacing them would make the alert layer an always-on decoration that packet 15 forbids",
  decisionWithoutAnyFaultSource:
    'the brief says the decision banner always shows one of three plain words and is never blank, but packet 16 forbids asserting health without a channel: with zero monitored fault sources the banner renders the dash state and NO FAULT SOURCE rather than claiming CONTINUE',
  staleAcceptanceBoilerplate:
    'packet 21 and QA-CHECKLIST.md still assert "no raster/vector image file was produced for this concept" and metadata.json still reads image_generated false, both of which are stale pre-image boilerplate contradicted by the approved attempt-003 derivative: the packet is left unmodified and the line is flagged to the packet owner'
})

/** Modules the wider canvas reveals, which must be absent at 800x480. Packet 12.1 expansion model. */
export const RC14_APP_ONLY_MODULES = Object.freeze(['faultTimeline', 'faultTimestamps'] as const)

/**
 * The registration facts the SEPARATE catalog wiring PR must apply. They are declared here, and
 * asserted by this artifact's suite, precisely because this delivery does NOT touch a single shared
 * registration file: `overlays.ts`, `widgets/index.ts`, `dashboards.ts`, `widget-catalog-data.ts`,
 * `DashboardRoot.tsx`, the generated identity catalog and the family display-clock guard
 * `raceconDisplayClock.test.ts` all belong to the wiring PR, which registers every new widget at
 * once and bumps each shared counter to the correct sum.
 *
 * Until that PR lands the widget is intentionally NOT reachable from the catalog. The suite's
 * registration checks are therefore written to pass both before and after wiring: they assert the
 * component's own contract unconditionally, and the registry entry only once it exists.
 */
export const RC14_REGISTRATION = Object.freeze({
  widgetId: 'raceconRc14Dash',
  presetId: 'racecon_rc14_dash',
  catalogVariantId: 'dash-racecon_rc14_dash',
  name: 'RaceCon RC-14 Triage',
  description:
    'Full-screen RC-14 live vehicle-health triage: a car-silhouette fault map with unmonitored zones held honestly grey, a prioritized fault list, oil/water/battery/oil-temperature vitals, per-corner brake and tyre status, and a continue/limp/pit decision derived only from real fault channels.',
  tags: Object.freeze(['racecon', 'dashboard', 'fullscreen', 'telemetry', 'health', 'triage'] as const),
  scaleMode: 'stretch',
  /** Belongs in `RESPONSIVE_FULL_FRAME_WIDGET_IDS`: RC-14 reflows, it is never transform-resampled. */
  responsiveFullFrame: true,
  /** Belongs in `IDENTITY_SCOPED_WIDGET_IDS`: RC-14 refuses mock and replay telemetry outright. */
  identityScoped: true,
  /** Excluded from `OVERLAY_WIDGETS`: full-frame dashboards are not pickable floating overlays. */
  pickableOverlay: false,
  embedFamily: 'racecon',
  /**
   * Belongs in the `RACECON_WIDGETS` table of `raceconDisplayClock.test.ts`. RC-14 already consumes
   * the shared `useRaceconDisplayClock` hook and holds a preview frame static, but that guard types
   * its ids as `OverlayWidgetId`, so RC-14 cannot be added to it until the union member exists —
   * which makes the edit the wiring PR's, not this one's. This artifact's own suite covers the same
   * freeze-and-tick contract in the meantime.
   */
  displayClockFamilyGuard: true
})

// ─────────────────────────────────────────────────────────── tokens

/** Packet 11.3 tokens, verbatim. */
export const RC14_TOKENS = Object.freeze({
  bg: '#0D0F12',
  panel: '#171B20',
  primary: '#EAEDF0',
  secondary: '#8C97A2',
  info: '#40B8D0',
  normal: '#46C86E',
  caution: '#FFA82E',
  danger: '#FF3E30',
  signature: '#6EE7FF'
})

export type Rc14Token = keyof typeof RC14_TOKENS

/**
 * The one measured colour defect this build corrects rather than reproduces. The packet's `info` and
 * `signature` sit 0.1 degrees apart in hue at dE76 16.55 — indistinguishable — and the brief's own
 * recommendation is to move `info` toward blue at roughly 205 degrees. The gauge-bar fill therefore
 * renders the retuned value while the silhouette outline keeps `signature`. The packet is unmodified.
 */
export const RC14_INFO_RETUNE = Object.freeze({
  packet: RC14_TOKENS.info,
  applied: '#3F93CF',
  packetHueDeg: 190.0,
  appliedHueDeg: 205.0,
  signatureHueDeg: 189.9,
  packetDeltaE: 16.55,
  reason:
    'packet 11.3 info and signature are 0.1 deg apart in hue at dE76 16.55: info is retuned to ~205 deg so the gauge-bar fill is separable from the silhouette outline'
})

/**
 * The tokens that must measure ZERO pixels while every alert is silent. `normal` is deliberately NOT
 * one of them: an OK chip and an OK zone fill are STATUS, published because a real fault channel
 * reported clear, not alert-layer decoration. `caution` and `danger` are the alert tokens, and the
 * suite asserts the stylesheet binds them only inside a severity-scoped rule.
 */
export const RC14_ALERT_TOKENS = Object.freeze(['caution', 'danger'] as const)

// ─────────────────────────────────────────────────────────── severity

export type Rc14Severity = 'ok' | 'minor' | 'major' | 'critical'

/** Packet 11.3 / 19: severity is chip WORD plus hue plus PATTERN, never hue alone. */
export const RC14_SEVERITY_RANK: Readonly<Record<Rc14Severity, number>> = Object.freeze({
  ok: 0,
  minor: 1,
  major: 2,
  critical: 3
})

export const RC14_SEVERITY_CHIP: Readonly<Record<Rc14Severity, string>> = Object.freeze({
  ok: 'OK',
  minor: 'MINOR',
  major: 'MAJOR',
  critical: 'CRITICAL'
})

/**
 * Gap G2 made concrete: MINOR and MAJOR share `caution` because 11.3 supplies only three status
 * hues for four levels. The pattern is what actually separates them, and it also survives
 * protanopia, under which caution and danger converge.
 */
export const RC14_SEVERITY_TOKEN: Readonly<Record<Rc14Severity, Rc14Token>> = Object.freeze({
  ok: 'normal',
  minor: 'caution',
  major: 'caution',
  critical: 'danger'
})

export type Rc14Pattern = 'solid' | 'dots' | 'stripes' | 'crosshatch' | 'outline'

export const RC14_SEVERITY_PATTERN: Readonly<Record<Rc14Severity, Rc14Pattern>> = Object.freeze({
  ok: 'solid',
  minor: 'dots',
  major: 'stripes',
  critical: 'crosshatch'
})

/** Gap G7: an unmonitored zone is outline-only in `secondary`, never a filled OK green. */
export const RC14_UNMONITORED_PATTERN: Rc14Pattern = 'outline'
export const RC14_UNMONITORED_TOKEN: Rc14Token = 'secondary'

export function rc14SeverityRank(severity: Rc14Severity | null): number {
  return severity === null ? -1 : RC14_SEVERITY_RANK[severity]
}

export function rc14WorstSeverity(values: readonly (Rc14Severity | null)[]): Rc14Severity | null {
  let worst: Rc14Severity | null = null
  for (const value of values) {
    if (value !== null && rc14SeverityRank(value) > rc14SeverityRank(worst)) worst = value
  }
  return worst
}

// ─────────────────────────────────────────────────────────── type ladder

/**
 * Normative override N2. Packet 11.2's ladder in pixels on the 800x480 canvas, set ARITHMETICALLY
 * and never measured off the render: in the approved frame the chip word and the zone label both
 * measure an 11 px cap height, so the chip is not visibly larger than the smallest tier and the
 * chain collapses. The chip is pinned inside the fault-list tier and the zone labels below it.
 *
 * The ranked chain, largest first, is exactly the brief's:
 * vitals numerals = decision word > fault-list system names > severity chip words >
 * zone labels / vitals labels / vitals units / corner values > corner-status headers.
 */
export const RC14_TYPE_SCALE_PX = Object.freeze({
  vitalValue: 40,
  decisionWord: 40,
  faultSystem: 24,
  severityChip: 19,
  zoneLabel: 14,
  vitalLabel: 14,
  vitalUnit: 14,
  cornerValue: 14,
  cornerHeader: 12
})

/** Packet 12.1's type step: 1024 / 800. The ladder GROWS with the canvas, it does not re-rank. */
export const RC14_APP_TYPE_SCALE = RC14_APP_WIDTH_PX / RC14_NATIVE_WIDTH_PX

/** One container-query width unit is one hundredth of the native canvas: 800 / 100 = 8 px. */
export const RC14_CQW_PX = RC14_NATIVE_WIDTH_PX / 100

/**
 * The px ladder expressed in the container units the stylesheet actually uses. Because the app
 * canvas is exactly 1.28x the native canvas, ONE cqw ladder satisfies both breakpoints: 40 px at
 * 800 wide and 51.2 px at 1024 wide are the same 5 cqw. The suite asserts that identity.
 */
export function rc14TypeScaleCqw(px: number): number {
  return round3(px / RC14_CQW_PX)
}

/** The physical size a rung renders at on a given canvas width, for the arithmetic assertions. */
export function rc14TypeScalePxForWidth(px: number, canvasWidthPx: number): number {
  return round3((rc14TypeScaleCqw(px) * canvasWidthPx) / 100)
}

/**
 * THE SIZING TRAP, made arithmetic.
 *
 * `white-space: nowrap` raises a flex item's min-content width above its column, so `overflow:
 * hidden` never clips it and `scrollWidth === clientWidth` even while the glyphs are physically
 * outside their zone. A hero numeral can therefore escape and collide with a neighbour while every
 * `scrollWidth` check passes. The only honest checks are a real `getBoundingClientRect` in a laying
 * -out browser and this conservative arithmetic bound, which the suite runs at every breakpoint.
 *
 * 0.62 em per character is a deliberately pessimistic advance width for a condensed uppercase face
 * with tabular numerals; the real faces used here run nearer 0.50-0.55 em.
 */
export const RC14_ADVANCE_WIDTH_EM = 0.62

export function rc14TextWidthPx(text: string, fontSizePx: number, letterSpacingEm = 0): number {
  const glyphs = text.length
  if (glyphs === 0) return 0
  return round3(glyphs * fontSizePx * (RC14_ADVANCE_WIDTH_EM + letterSpacingEm))
}

export function rc14HeroFitsZone(
  text: string,
  fontSizePx: number,
  zoneWidthPx: number,
  paddingPx = 0,
  letterSpacingEm = 0
): boolean {
  return rc14TextWidthPx(text, fontSizePx, letterSpacingEm) <= zoneWidthPx - paddingPx
}

// ─────────────────────────────────────────────────────────── zones

export interface Rc14RectPx {
  x: number
  y: number
  width: number
  height: number
}

export interface Rc14Rect {
  left: number
  top: number
  width: number
  height: number
}

export type Rc14ZoneId =
  | 'faultList'
  | 'carSilhouette'
  | 'vitalsColumn'
  | 'decisionBanner'
  | 'cornerStatus'
  | 'faultTimeline'
  | 'decisionCorners'

export type Rc14ZoneMapPx = Readonly<Partial<Record<Rc14ZoneId, Rc14RectPx>>>
export type Rc14ZoneMap = Readonly<Partial<Record<Rc14ZoneId, Rc14Rect>>>

/**
 * Packet 11.1 verbatim, in the packet's own pixels. Audited zero-overlap, every stated percentage
 * correct to within 0.02 pp, no zone overflowing the canvas. Normative override N5 is explicit that
 * the approved frame's measured origins drift up to -4.00 pp horizontally: those pixels are never
 * traced, these are.
 */
export const RC14_NATIVE_ZONES_PX: Rc14ZoneMapPx = Object.freeze({
  faultList: Object.freeze({ x: 16, y: 50, width: 208, height: 380 }),
  carSilhouette: Object.freeze({ x: 240, y: 50, width: 320, height: 300 }),
  vitalsColumn: Object.freeze({ x: 576, y: 50, width: 208, height: 300 }),
  decisionBanner: Object.freeze({ x: 240, y: 360, width: 320, height: 70 }),
  cornerStatus: Object.freeze({ x: 576, y: 360, width: 208, height: 70 })
})

/**
 * Packet 12.1 verbatim, and NOT a uniform scale of 11.1. The expansion model is
 * `fault-timeline-reveal`: the extra width buys a fault timeline and a wider fault list carrying
 * per-fault timestamps, the silhouette keeps its 320 px width and gains 40 px of height only, and
 * the decision banner MOVES out of the centre and merges with corner status on the right. Adding a
 * new channel or a new gauge here would be a scale, not a reflow.
 */
export const RC14_APP_ZONES_PX: Rc14ZoneMapPx = Object.freeze({
  faultList: Object.freeze({ x: 24, y: 60, width: 300, height: 480 }),
  carSilhouette: Object.freeze({ x: 352, y: 60, width: 320, height: 340 }),
  vitalsColumn: Object.freeze({ x: 700, y: 60, width: 300, height: 300 }),
  faultTimeline: Object.freeze({ x: 352, y: 420, width: 320, height: 120 }),
  decisionCorners: Object.freeze({ x: 700, y: 372, width: 300, height: 168 })
})

export function rc14ZonesPxForLayout(layout: Rc14Layout): Rc14ZoneMapPx {
  return layout === 'app' ? RC14_APP_ZONES_PX : RC14_NATIVE_ZONES_PX
}

/** A packet pixel box as canvas percentages, which is what the DOM actually carries. */
export function rc14RectPercent(rect: Rc14RectPx, canvasWidth: number, canvasHeight: number): Rc14Rect {
  return {
    left: round6((rect.x / canvasWidth) * 100),
    top: round6((rect.y / canvasHeight) * 100),
    width: round6((rect.width / canvasWidth) * 100),
    height: round6((rect.height / canvasHeight) * 100)
  }
}

function canvasSizePx(layout: Rc14Layout): { width: number; height: number } {
  return layout === 'app'
    ? { width: RC14_APP_WIDTH_PX, height: RC14_APP_HEIGHT_PX }
    : { width: RC14_NATIVE_WIDTH_PX, height: RC14_NATIVE_HEIGHT_PX }
}

/**
 * The compact grammars are not packet-specified. They keep the triage structure — silhouette plus
 * prioritized list plus vitals plus decision plus corners — and drop only the app-only timeline, so
 * every alert keeps a visible surface at every size, which packet 15 requires.
 */
function rc14CompactZonesPx(mode: Rc14CompactMode, width: number, height: number): Rc14ZoneMapPx {
  if (mode === 'phone') {
    return Object.freeze({
      carSilhouette: Object.freeze({ x: 0.04 * width, y: 0.02 * height, width: 0.92 * width, height: 0.3 * height }),
      decisionBanner: Object.freeze({ x: 0.04 * width, y: 0.335 * height, width: 0.92 * width, height: 0.1 * height }),
      faultList: Object.freeze({ x: 0.04 * width, y: 0.45 * height, width: 0.92 * width, height: 0.24 * height }),
      vitalsColumn: Object.freeze({ x: 0.04 * width, y: 0.7 * height, width: 0.92 * width, height: 0.18 * height }),
      cornerStatus: Object.freeze({ x: 0.04 * width, y: 0.89 * height, width: 0.92 * width, height: 0.09 * height })
    })
  }
  if (mode === 'landscape') {
    return Object.freeze({
      faultList: Object.freeze({ x: 0.02 * width, y: 0.06 * height, width: 0.26 * width, height: 0.88 * height }),
      carSilhouette: Object.freeze({ x: 0.3 * width, y: 0.06 * height, width: 0.4 * width, height: 0.66 * height }),
      vitalsColumn: Object.freeze({ x: 0.72 * width, y: 0.06 * height, width: 0.26 * width, height: 0.66 * height }),
      decisionBanner: Object.freeze({ x: 0.3 * width, y: 0.74 * height, width: 0.4 * width, height: 0.2 * height }),
      cornerStatus: Object.freeze({ x: 0.72 * width, y: 0.74 * height, width: 0.26 * width, height: 0.2 * height })
    })
  }
  return Object.freeze({
    faultList: Object.freeze({ x: 0.02 * width, y: 0.05 * height, width: 0.26 * width, height: 0.9 * height }),
    carSilhouette: Object.freeze({ x: 0.3 * width, y: 0.05 * height, width: 0.4 * width, height: 0.62 * height }),
    vitalsColumn: Object.freeze({ x: 0.72 * width, y: 0.05 * height, width: 0.26 * width, height: 0.62 * height }),
    decisionBanner: Object.freeze({ x: 0.3 * width, y: 0.69 * height, width: 0.4 * width, height: 0.26 * height }),
    cornerStatus: Object.freeze({ x: 0.72 * width, y: 0.69 * height, width: 0.26 * width, height: 0.26 * height })
  })
}

export function rc14ZonesForLayout(
  layout: Rc14Layout,
  compactMode: Rc14CompactMode = 'standard',
  box: { width: number; height: number } = canvasSizePx(layout)
): Rc14ZoneMap {
  const size = layout === 'compact' ? box : canvasSizePx(layout)
  const zonesPx =
    layout === 'compact' ? rc14CompactZonesPx(compactMode, size.width, size.height) : rc14ZonesPxForLayout(layout)
  const entries = (Object.keys(zonesPx) as Rc14ZoneId[]).map((id) => [
    id,
    Object.freeze(rc14RectPercent(zonesPx[id] as Rc14RectPx, size.width, size.height))
  ])
  return Object.freeze(Object.fromEntries(entries)) as Rc14ZoneMap
}

export function rc14RectsOverlap(a: Rc14Rect, b: Rc14Rect): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  )
}

/**
 * Normative override N3: the fault-list row pitch is COMPUTED, never traced. `rowPitch = zoneHeight
 * / rowCount` — 380 / 6 = 63.333 px exactly at 800x480, every row identical. The approved frame
 * drifts from 62.0 px at the top to 56.0 px at the bottom (stdev 2.159) and that drift is not
 * reproduced: the stylesheet lays the list out as a uniform `1fr` grid so the pitch is identical by
 * construction rather than by measurement.
 */
export function rc14FaultRowPitchPx(zoneHeightPx: number, rowCount: number): number {
  if (!finite(zoneHeightPx) || !finite(rowCount) || rowCount <= 0) return 0
  return round3(zoneHeightPx / rowCount)
}

/**
 * The fault-list capacity each canvas can carry at the packet's row pitch. Six rows at 800x480 is
 * the approved frame's count; the app canvas is taller and carries eight. Nothing pads the list to
 * that capacity — it is an upper bound, and an empty list stays empty.
 */
export const RC14_NATIVE_FAULT_ROWS = 6
export const RC14_APP_FAULT_ROWS = 8

/**
 * The container-query height below which the compact grammar reduces the hero tier. It sits
 * deliberately BELOW the 480 px native canvas, so packet 11.2's ladder is never reduced at 800x480
 * or at 1024x600 — only in the unspecified short-and-wide compact grammar, where four stacked
 * gauges would otherwise clip a hero numeral in half.
 */
export const RC14_COMPACT_TYPE_MAX_HEIGHT_PX = 440

/** A 0..100 coordinate as a CSS percentage, without binary-float noise in the DOM. */
export function rc14Percent(value: number): string {
  return `${round3(finite(value) ? value : 0)}%`
}

export function rc14ZoneStyle(rect: Rc14Rect | undefined): {
  left: string
  top: string
  width: string
  height: string
} | null {
  if (!rect) return null
  return {
    left: rc14Percent(rect.left),
    top: rc14Percent(rect.top),
    width: rc14Percent(rect.width),
    height: rc14Percent(rect.height)
  }
}

// ─────────────────────────────────────────────────────────── layout resolution

export function rc14LayoutForContentBox(width: number, height: number): Rc14Layout {
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) return 'app'
  if (
    Math.abs(width - RC14_NATIVE_WIDTH_PX) <= RC14_NATIVE_TOLERANCE_PX &&
    Math.abs(height - RC14_NATIVE_HEIGHT_PX) <= RC14_NATIVE_TOLERANCE_PX
  ) {
    return 'native'
  }
  if (width >= RC14_APP_WIDTH_PX - 1 && height >= RC14_APP_HEIGHT_PX - 1) return 'app'
  return 'compact'
}

export function rc14CompactModeForContentBox(width: number, height: number): Rc14CompactMode {
  if (rc14LayoutForContentBox(width, height) !== 'compact') return 'standard'
  if (
    width >= RC14_PHONE_MIN_WIDTH_PX &&
    width <= RC14_PHONE_MAX_WIDTH_PX &&
    height >= RC14_PHONE_MIN_HEIGHT_PX &&
    height / width >= 1.5
  ) {
    return 'phone'
  }
  if (
    width >= RC14_LANDSCAPE_MIN_WIDTH_PX &&
    height >= RC14_LANDSCAPE_MIN_HEIGHT_PX &&
    height <= RC14_LANDSCAPE_MAX_HEIGHT_PX &&
    width / height >= 1.5
  ) {
    return 'landscape'
  }
  return 'standard'
}

// ─────────────────────────────────────────────────────────── silhouette geometry

export type Rc14SilhouetteZoneId =
  | 'aero'
  | 'engine'
  | 'electrical'
  | 'gearbox'
  | 'cornerLf'
  | 'cornerRf'
  | 'cornerLr'
  | 'cornerRr'

export interface Rc14SilhouetteRect {
  readonly id: Rc14SilhouetteZoneId
  readonly label: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * A generic top-down outline in a local 0..100 space, expressed as percentages of the silhouette
 * PANEL so the same numbers serve 320x300 at 800x480 and 320x340 at 1024x600. Four body bands nose
 * to tail and four wheel rectangles, per the brief's reading of the approved frame.
 *
 * Packet section 8 and the negative prompt both require an original generic shape with no real car
 * likeness: this is four rounded bands and four rectangles, not a traced silhouette.
 */
export const RC14_SILHOUETTE_ZONES: readonly Rc14SilhouetteRect[] = Object.freeze([
  Object.freeze({ id: 'aero' as const, label: 'AERO', x: 34, y: 4, width: 32, height: 18 }),
  Object.freeze({ id: 'engine' as const, label: 'ENG', x: 34, y: 24, width: 32, height: 22 }),
  Object.freeze({ id: 'electrical' as const, label: 'ELEC', x: 34, y: 48, width: 32, height: 18 }),
  Object.freeze({ id: 'gearbox' as const, label: 'GBX', x: 34, y: 68, width: 32, height: 22 }),
  Object.freeze({ id: 'cornerLf' as const, label: 'LF', x: 8, y: 12, width: 18, height: 13 }),
  Object.freeze({ id: 'cornerRf' as const, label: 'RF', x: 74, y: 12, width: 18, height: 13 }),
  Object.freeze({ id: 'cornerLr' as const, label: 'LR', x: 8, y: 70, width: 18, height: 13 }),
  Object.freeze({ id: 'cornerRr' as const, label: 'RR', x: 74, y: 70, width: 18, height: 13 })
])

/** The original generic body outline, in the same local 0..100 space. Stroked in `signature`. */
export const RC14_SILHOUETTE_PATH =
  'M50 1 L62 8 L66 22 L68 44 L68 66 L66 88 L60 97 L40 97 L34 88 L32 66 L32 44 L34 22 L38 8 Z'

// ─────────────────────────────────────────────────────────── channels

/**
 * Packet section 16 freshness budgets, verbatim. `faultMap` is packet 16's "event" cadence: a fault
 * channel is a latched state, not a stream, so it is held against the SNAPSHOT's own liveness rather
 * than against a millisecond budget of its own — but it still ages out with the frame, so a source
 * that goes quiet stops asserting health.
 */
export const RC14_CHANNEL_STALE_MS = {
  faultMap: 1_000,
  oilPressure: 200,
  waterTemp: 500,
  battery: 500,
  oilTemp: 500,
  brakeTempLf: 200,
  brakeTempRf: 200,
  brakeTempLr: 200,
  brakeTempRr: 200,
  tyrePressureLf: 1_000,
  tyrePressureRf: 1_000,
  tyrePressureLr: 1_000,
  tyrePressureRr: 1_000
} as const

export type Rc14Channel = keyof typeof RC14_CHANNEL_STALE_MS

/** Packet 16 dash states, verbatim, so the widget and the suite cannot drift from the table. */
export const RC14_DASH = Object.freeze({
  vital: '--',
  brakeTemp: '--',
  tyrePressure: '--',
  decision: '--',
  chip: '--'
})

export const RC14_NO_FAULT_SOURCE_NOTICE = 'NO FAULT SOURCE'
export const RC14_NO_ZONE_NOTICE = 'NO ZONE'
export const RC14_UNMONITORED_NOTICE = 'NO SOURCE'
export const RC14_TIMELINE_UNAVAILABLE_NOTICE = 'NO FAULT OBSERVED'

/**
 * Every RC-14 channel is read straight from its own declared source. Nothing is modelled, mirrored
 * or substituted: oil pressure never from RPM, coolant temperature never estimated, battery voltage
 * never assumed nominal, oil temperature never substituted from water, brake temperature never
 * inferred from usage, and no corner's tyre pressure ever mirrored from another corner.
 *
 * Oil pressure and tyre pressure carry the only unit conversions (kPa to bar), which is arithmetic
 * on a real reading and not an estimate.
 *
 * `tireColdPressuresKpa` is deliberately NOT read: it is the garage cold-pressure SETUP value, not a
 * live TPMS reading, and publishing it as a live corner pressure would be exactly the invention
 * packet 16 forbids.
 */
export function rc14ChannelValue(snapshot: TelemetrySnapshot, channel: Rc14Channel): number | null {
  switch (channel) {
    case 'faultMap':
      return rc14FaultSourceCount(snapshot) > 0 ? rc14FaultSourceCount(snapshot) : null
    case 'oilPressure':
      return finite(snapshot.oilPressureKpa) && snapshot.oilPressureKpa >= 0 ? snapshot.oilPressureKpa / 100 : null
    case 'waterTemp':
      return finite(snapshot.waterTempC) ? snapshot.waterTempC : null
    // A quiet electrical bus reads zero; packet 16 requires a dash rather than a nominal 12/13 V.
    case 'battery':
      return finite(snapshot.voltage) && snapshot.voltage > 0 ? snapshot.voltage : null
    case 'oilTemp':
      return finite(snapshot.oilTempC) ? snapshot.oilTempC : null
    case 'brakeTempLf':
      return finite(snapshot.brakeTempC?.lf) ? (snapshot.brakeTempC?.lf as number) : null
    case 'brakeTempRf':
      return finite(snapshot.brakeTempC?.rf) ? (snapshot.brakeTempC?.rf as number) : null
    case 'brakeTempLr':
      return finite(snapshot.brakeTempC?.lr) ? (snapshot.brakeTempC?.lr as number) : null
    case 'brakeTempRr':
      return finite(snapshot.brakeTempC?.rr) ? (snapshot.brakeTempC?.rr as number) : null
    case 'tyrePressureLf':
      return rc14TyrePressureBar(snapshot, 'lf')
    case 'tyrePressureRf':
      return rc14TyrePressureBar(snapshot, 'rf')
    case 'tyrePressureLr':
      return rc14TyrePressureBar(snapshot, 'lr')
    case 'tyrePressureRr':
      return rc14TyrePressureBar(snapshot, 'rr')
  }
  return null
}

export type Rc14Corner = 'lf' | 'rf' | 'lr' | 'rr'

export const RC14_CORNERS: readonly Rc14Corner[] = Object.freeze(['lf', 'rf', 'lr', 'rr'] as const)

export const RC14_CORNER_LABEL: Readonly<Record<Rc14Corner, string>> = Object.freeze({
  lf: 'LF',
  rf: 'RF',
  lr: 'LR',
  rr: 'RR'
})

function rc14TyrePressureBar(snapshot: TelemetrySnapshot, corner: Rc14Corner): number | null {
  const kpa = snapshot.tyres?.[corner]?.pressureKpa
  return finite(kpa) && kpa > 0 ? round3(kpa / 100) : null
}

/**
 * `RC14_PACKET_OMISSIONS.speedAndDeltaZones`, expressed as a function so the absence is MEASURED by
 * the suite rather than asserted about a comment. Packet 16 defines Speed and Delta to best in full,
 * but 11.1 and 12.1 give neither a zone, so RC-14 publishes neither — not even as a dash.
 */
export function rc14SpeedKmh(_snapshot: TelemetrySnapshot | null): number | null {
  return null
}

export function rc14DeltaToBestSec(_snapshot: TelemetrySnapshot | null): number | null {
  return null
}

/**
 * `RC14_PACKET_OMISSIONS.perZoneDamageChannel`, expressed the same way. The app's snapshot carries
 * no per-zone damage source at all: `damagePct` is a single whole-car scalar derived from repair
 * time, and no provider emits per-part damage. This returns null for every zone and every snapshot,
 * so no silhouette zone can ever be tinted from a location the app cannot know.
 */
export function rc14ZoneDamagePct(
  _snapshot: TelemetrySnapshot | null,
  _zone: Rc14SilhouetteZoneId
): number | null {
  return null
}

// ─────────────────────────────────────────────────────────── vitals

export type Rc14VitalId = 'oilPressure' | 'waterTemp' | 'battery' | 'oilTemp'

export const RC14_VITAL_IDS: readonly Rc14VitalId[] = Object.freeze([
  'oilPressure',
  'waterTemp',
  'battery',
  'oilTemp'
] as const)

export const RC14_VITAL_LABEL: Readonly<Record<Rc14VitalId, string>> = Object.freeze({
  oilPressure: 'OIL PRESS',
  waterTemp: 'WATER',
  battery: 'BATT',
  oilTemp: 'OIL TEMP'
})

export const RC14_VITAL_UNIT: Readonly<Record<Rc14VitalId, string>> = Object.freeze({
  oilPressure: 'bar',
  waterTemp: '°C',
  battery: 'V',
  oilTemp: '°C'
})

export const RC14_VITAL_DECIMALS: Readonly<Record<Rc14VitalId, number>> = Object.freeze({
  oilPressure: 1,
  waterTemp: 0,
  battery: 1,
  oilTemp: 0
})

/**
 * Bar-fill scales. Three come from the implementation brief's own arithmetic; oil temperature's is
 * declared here because neither the packet nor the brief supplies one — see
 * `RC14_PACKET_OMISSIONS.oilTempBarScale`. A bar is NEVER traced off a render: normative override N4
 * records that four consecutive reference renders overshot their fill by up to +5.30 pp.
 */
export const RC14_VITAL_SCALE: Readonly<Record<Rc14VitalId, { min: number; max: number }>> = Object.freeze({
  oilPressure: Object.freeze({ min: 0, max: 8 }),
  waterTemp: Object.freeze({ min: 60, max: 120 }),
  battery: Object.freeze({ min: 10, max: 16 }),
  oilTemp: Object.freeze({ min: 60, max: 150 })
})

/**
 * Packet 15's vital out-of-range alert requires ranges that neither the packet nor the brief ever
 * defines — see `RC14_PACKET_OMISSIONS.vitalRangeThresholds`. Oil temperature has NO entry on
 * purpose: packet 15 lists "oil / water / battery" only, and adding a fourth alert the packet never
 * asked for would be exactly the always-on decoration section 15 forbids.
 */
export const RC14_VITAL_RANGE: Readonly<Partial<Record<Rc14VitalId, { min: number; max: number }>>> =
  Object.freeze({
    oilPressure: Object.freeze({ min: 2, max: 8 }),
    waterTemp: Object.freeze({ min: 60, max: 110 }),
    battery: Object.freeze({ min: 11.5, max: 15.5 })
  })

export const RC14_VITAL_CHANNEL: Readonly<Record<Rc14VitalId, Rc14Channel>> = Object.freeze({
  oilPressure: 'oilPressure',
  waterTemp: 'waterTemp',
  battery: 'battery',
  oilTemp: 'oilTemp'
})

/** The silhouette zone a vital's out-of-range alert tints. Packet 15: "vital gauge red + zone tint". */
export const RC14_VITAL_ZONE: Readonly<Record<Rc14VitalId, Rc14SilhouetteZoneId | null>> = Object.freeze({
  oilPressure: 'engine',
  waterTemp: 'engine',
  battery: 'electrical',
  oilTemp: null
})

export function rc14FormatVital(id: Rc14VitalId, value: number | null): string {
  if (value === null || !finite(value)) return RC14_DASH.vital
  return value.toFixed(RC14_VITAL_DECIMALS[id])
}

/**
 * Brief section 4, verbatim: `clamp((value - min) / (max - min), 0, 1)`. A dashed vital draws its
 * track with ZERO fill — it never draws a "last known" length and it never borrows a neighbour's.
 */
export function rc14VitalFill(id: Rc14VitalId, value: number | null): number {
  if (value === null || !finite(value)) return 0
  const scale = RC14_VITAL_SCALE[id]
  return round3(clamp((value - scale.min) / (scale.max - scale.min), 0, 1))
}

export function rc14VitalOutOfRange(id: Rc14VitalId, value: number | null): boolean {
  const range = RC14_VITAL_RANGE[id]
  if (!range || value === null || !finite(value)) return false
  return value < range.min || value > range.max
}

// ─────────────────────────────────────────────────────────── fault sources

export type Rc14SystemId =
  | 'engine'
  | 'electrical'
  | 'chassis'
  | 'gearbox'
  | 'aero'
  | 'cornerLf'
  | 'cornerRf'
  | 'cornerLr'
  | 'cornerRr'

export type Rc14FaultSourceId =
  | 'engineOilPressureLamp'
  | 'engineWaterTempLamp'
  | 'engineOilTempLamp'
  | 'engineStalled'
  | 'engineFuelPressureLamp'
  | 'chassisMandatoryRepair'
  | 'chassisOptionalRepair'
  | 'vitalOilPressure'
  | 'vitalWaterTemp'
  | 'vitalBattery'

export type Rc14AlertId = 'criticalFault' | 'minorFault' | 'vitalRange'

export interface Rc14FaultSource {
  readonly id: Rc14FaultSourceId
  readonly system: Rc14SystemId
  readonly label: string
  readonly severity: Rc14Severity
  readonly alert: Rc14AlertId
}

/**
 * Packet 15's three alerts, with the debounce and latch semantics the packet states and nothing
 * else. Every one is SILENT until its trigger fires.
 *
 *  - `criticalFault` engages after 1 s and is LATCHED UNTIL ACKNOWLEDGED: it holds even after the
 *    fault channel clears, and only an acknowledgement plus a cleared channel releases it.
 *  - `minorFault` engages after 1 s and clears when the fault clears.
 *  - `vitalRange` engages after 3 s and clears the moment the value is back in range.
 *
 * All three unlatch immediately when their input goes stale or missing, which is packet 16's
 * "stale data is visibly degraded, not frozen" applied to the alert layer.
 */
export const RC14_ALERT_ENGAGE_MS: Readonly<Record<Rc14AlertId, number>> = Object.freeze({
  criticalFault: 1_000,
  minorFault: 1_000,
  vitalRange: 3_000
})

export const RC14_ALERT_LATCHED_UNTIL_ACK: Readonly<Record<Rc14AlertId, boolean>> = Object.freeze({
  criticalFault: true,
  minorFault: false,
  vitalRange: false
})

export const RC14_FAULT_SOURCES: readonly Rc14FaultSource[] = Object.freeze([
  Object.freeze({
    id: 'engineOilPressureLamp' as const,
    system: 'engine' as const,
    label: 'OIL PRESSURE',
    severity: 'critical' as const,
    alert: 'criticalFault' as const
  }),
  Object.freeze({
    id: 'engineWaterTempLamp' as const,
    system: 'engine' as const,
    label: 'COOLANT TEMP',
    severity: 'critical' as const,
    alert: 'criticalFault' as const
  }),
  Object.freeze({
    id: 'engineOilTempLamp' as const,
    system: 'engine' as const,
    label: 'OIL TEMP',
    severity: 'critical' as const,
    alert: 'criticalFault' as const
  }),
  Object.freeze({
    id: 'engineStalled' as const,
    system: 'engine' as const,
    label: 'ENGINE STALL',
    severity: 'critical' as const,
    alert: 'criticalFault' as const
  }),
  Object.freeze({
    id: 'engineFuelPressureLamp' as const,
    system: 'engine' as const,
    label: 'FUEL PRESSURE',
    severity: 'major' as const,
    alert: 'minorFault' as const
  }),
  Object.freeze({
    id: 'chassisMandatoryRepair' as const,
    system: 'chassis' as const,
    label: 'MANDATORY REPAIR',
    severity: 'critical' as const,
    alert: 'criticalFault' as const
  }),
  Object.freeze({
    id: 'chassisOptionalRepair' as const,
    system: 'chassis' as const,
    label: 'BODY REPAIR',
    severity: 'major' as const,
    alert: 'minorFault' as const
  }),
  Object.freeze({
    id: 'vitalOilPressure' as const,
    system: 'engine' as const,
    label: 'OIL PRESS RANGE',
    severity: 'critical' as const,
    alert: 'vitalRange' as const
  }),
  Object.freeze({
    id: 'vitalWaterTemp' as const,
    system: 'engine' as const,
    label: 'WATER RANGE',
    severity: 'critical' as const,
    alert: 'vitalRange' as const
  }),
  Object.freeze({
    id: 'vitalBattery' as const,
    system: 'electrical' as const,
    label: 'BATTERY RANGE',
    severity: 'major' as const,
    alert: 'vitalRange' as const
  })
])

export interface Rc14System {
  readonly id: Rc14SystemId
  readonly label: string
  readonly zone: Rc14SilhouetteZoneId | null
}

/**
 * Every system the packet's fault map names, INCLUDING the six that no channel can feed. They are
 * declared rather than dropped so the silhouette renders its full structure and the absence is
 * visible as an unmonitored zone rather than as a missing shape.
 *
 * `chassis` deliberately has NO zone: `mandRepair`, `pit.repairNeeded` and `repairTimeSec` are
 * whole-car repair state with no location, and assigning them to AERO or GBX would invent one.
 */
export const RC14_SYSTEMS: readonly Rc14System[] = Object.freeze([
  Object.freeze({ id: 'engine' as const, label: 'ENGINE', zone: 'engine' as const }),
  Object.freeze({ id: 'electrical' as const, label: 'ELECTRICAL', zone: 'electrical' as const }),
  Object.freeze({ id: 'chassis' as const, label: 'CHASSIS', zone: null }),
  Object.freeze({ id: 'gearbox' as const, label: 'GEARBOX', zone: 'gearbox' as const }),
  Object.freeze({ id: 'aero' as const, label: 'FRONT AERO', zone: 'aero' as const }),
  Object.freeze({ id: 'cornerLf' as const, label: 'CORNER LF', zone: 'cornerLf' as const }),
  Object.freeze({ id: 'cornerRf' as const, label: 'CORNER RF', zone: 'cornerRf' as const }),
  Object.freeze({ id: 'cornerLr' as const, label: 'CORNER LR', zone: 'cornerLr' as const }),
  Object.freeze({ id: 'cornerRr' as const, label: 'CORNER RR', zone: 'cornerRr' as const })
])

/**
 * Whether a fault source's backing channel is present in this snapshot at all.
 *
 * A source that is not available produces neither a fault nor an OK: its system stays unmonitored,
 * its zone stays outlined, and the decision banner cannot count it as evidence of health. This is
 * the whole of packet 16's "hidden if channel absent" and brief gap G7, in one predicate.
 */
export function rc14FaultSourceAvailable(
  snapshot: TelemetrySnapshot | null,
  id: Rc14FaultSourceId
): boolean {
  if (!snapshot) return false
  switch (id) {
    case 'engineOilPressureLamp':
    case 'engineWaterTempLamp':
    case 'engineOilTempLamp':
    case 'engineStalled':
    case 'engineFuelPressureLamp':
      return snapshot.engineWarnings !== undefined && snapshot.engineWarnings !== null
    case 'chassisMandatoryRepair':
      return (
        snapshot.engineWarnings !== undefined ||
        snapshot.pit !== undefined ||
        finite(snapshot.repairTimeSec) ||
        snapshot.flags !== undefined
      )
    case 'chassisOptionalRepair':
      return (
        snapshot.engineWarnings !== undefined ||
        snapshot.pit !== undefined ||
        finite(snapshot.optionalRepairTimeSec)
      )
    case 'vitalOilPressure':
      return rc14ChannelValue(snapshot, 'oilPressure') !== null
    case 'vitalWaterTemp':
      return rc14ChannelValue(snapshot, 'waterTemp') !== null
    case 'vitalBattery':
      return rc14ChannelValue(snapshot, 'battery') !== null
  }
  return false
}

/**
 * Whether a fault source is currently TRIGGERED. Never a guess: every branch reads a channel that
 * the provider genuinely publishes.
 *
 * `revLimiter` and `pitLimiter` are absent on purpose — see
 * `RC14_PACKET_OMISSIONS.operatingLampsAreNotFaults`. They are normal operating lamps and treating
 * them as faults would make the alert layer an always-on decoration.
 */
export function rc14FaultSourceRaw(
  snapshot: TelemetrySnapshot | null,
  id: Rc14FaultSourceId
): boolean | null {
  if (!snapshot || !rc14FaultSourceAvailable(snapshot, id)) return null
  const warnings = snapshot.engineWarnings
  switch (id) {
    case 'engineOilPressureLamp':
      return warnings?.oilPressure === true
    case 'engineWaterTempLamp':
      return warnings?.waterTemp === true
    case 'engineOilTempLamp':
      return warnings?.oilTemp === true
    case 'engineStalled':
      return warnings?.stalled === true
    case 'engineFuelPressureLamp':
      return warnings?.fuelPressure === true
    case 'chassisMandatoryRepair':
      return (
        warnings?.mandRepair === true ||
        snapshot.pit?.repairNeeded === true ||
        (finite(snapshot.repairTimeSec) && snapshot.repairTimeSec > 0) ||
        snapshot.flags?.meatball === true
      )
    case 'chassisOptionalRepair':
      return (
        warnings?.optRepair === true ||
        snapshot.pit?.optRepairNeeded === true ||
        (finite(snapshot.optionalRepairTimeSec) && snapshot.optionalRepairTimeSec > 0)
      )
    case 'vitalOilPressure':
      return rc14VitalOutOfRange('oilPressure', rc14ChannelValue(snapshot, 'oilPressure'))
    case 'vitalWaterTemp':
      return rc14VitalOutOfRange('waterTemp', rc14ChannelValue(snapshot, 'waterTemp'))
    case 'vitalBattery':
      return rc14VitalOutOfRange('battery', rc14ChannelValue(snapshot, 'battery'))
  }
  return null
}

export function rc14FaultSourceCount(snapshot: TelemetrySnapshot | null): number {
  return RC14_FAULT_SOURCES.filter((source) => rc14FaultSourceAvailable(snapshot, source.id)).length
}

// ─────────────────────────────────────────────────────────── receipts

/**
 * Receipts for RC-14's own channels, with exactly RC-01's semantics: a receipt is written only when
 * the channel actually reports, so a channel that falls silent ages out and degrades to its packet
 * dash state instead of freezing on its last value.
 *
 * This is deliberately NOT a second ingest buffer. It is only ever fed frames the shared RC-01
 * buffer has already accepted, so identity binding and mock/replay refusal stay in one place.
 */
export class Rc14AuxBuffer {
  private channelReceipts = new Map<Rc14Channel, Rc01ChannelReceipt>()

  clone(): Rc14AuxBuffer {
    const next = new Rc14AuxBuffer()
    next.channelReceipts = new Map(this.channelReceipts)
    return next
  }

  reset(): void {
    this.channelReceipts = new Map()
  }

  ingest(snapshot: TelemetrySnapshot | null | undefined, receivedAt = rc01MonotonicNow()): void {
    if (!snapshot || !snapshot.connected || !finite(snapshot.timestamp)) return
    const safeReceiptAt = finite(receivedAt) && receivedAt >= 0 ? receivedAt : rc01MonotonicNow()
    for (const channel of Object.keys(RC14_CHANNEL_STALE_MS) as Rc14Channel[]) {
      const value = rc14ChannelValue(snapshot, channel)
      if (value === null) continue
      this.channelReceipts.set(
        channel,
        Object.freeze({ value, snapshotTimestamp: snapshot.timestamp, receivedAt: safeReceiptAt })
      )
    }
  }

  receipts(): ReadonlyMap<Rc14Channel, Rc01ChannelReceipt> {
    return new Map(this.channelReceipts)
  }
}

export function createRc14AuxReceipts(
  snapshot: TelemetrySnapshot,
  receivedAt = rc01MonotonicNow()
): ReadonlyMap<Rc14Channel, Rc01ChannelReceipt> {
  const buffer = new Rc14AuxBuffer()
  buffer.ingest(snapshot, receivedAt)
  return buffer.receipts()
}

interface Rc14Reading {
  value: number | null
  stale: boolean
  unavailable: boolean
}

function reading(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc14Channel, Rc01ChannelReceipt>,
  channel: Rc14Channel,
  nowMs: number
): Rc14Reading {
  const raw = snapshot ? rc14ChannelValue(snapshot, channel) : null
  const receipt = receipts.get(channel)
  if (raw === null || !receipt) return { value: null, stale: false, unavailable: true }
  const stale = rc01ReceiptAgeMs(receipt, nowMs) > RC14_CHANNEL_STALE_MS[channel]
  return { value: stale ? null : raw, stale, unavailable: false }
}

function field(
  value: string,
  raw: number | string | null,
  stale = false,
  isUnavailable = false,
  tone: Rc01Field['tone'] = 'primary'
): Rc01Field {
  return { value, raw, stale, unavailable: isUnavailable, tone }
}

// ─────────────────────────────────────────────────────────── alert state

export interface Rc14SourceAlertState {
  readonly raisedSinceMs: number | null
  readonly engagedAtMs: number | null
  readonly acknowledged: boolean
}

export interface Rc14AlertState {
  readonly sources: Readonly<Record<Rc14FaultSourceId, Rc14SourceAlertState>>
}

const SILENT_SOURCE: Rc14SourceAlertState = Object.freeze({
  raisedSinceMs: null,
  engagedAtMs: null,
  acknowledged: false
})

export function createRc14AlertState(): Rc14AlertState {
  const sources = {} as Record<Rc14FaultSourceId, Rc14SourceAlertState>
  for (const source of RC14_FAULT_SOURCES) sources[source.id] = SILENT_SOURCE
  return { sources: Object.freeze(sources) }
}

export interface Rc14AlertInput {
  readonly nowMs: number
  /** `true` triggered, `false` clear, `null` the channel is unavailable or stale. */
  readonly raw: Readonly<Partial<Record<Rc14FaultSourceId, boolean | null>>>
}

/**
 * The whole alert layer, in one pure reduction.
 *
 * A source whose input is `null` — unavailable OR stale — is reset outright, latch and
 * acknowledgement included. That is deliberate: a latched critical fault whose channel has gone
 * quiet is not evidence of a fault any more, and holding it would be the frozen-stale-data failure
 * packet 16 exists to prevent.
 */
export function advanceRc14Alerts(state: Rc14AlertState, input: Rc14AlertInput): Rc14AlertState {
  const nowMs = finite(input.nowMs) ? input.nowMs : 0
  const sources = {} as Record<Rc14FaultSourceId, Rc14SourceAlertState>
  for (const source of RC14_FAULT_SOURCES) {
    const previous = state.sources[source.id] ?? SILENT_SOURCE
    const raw = input.raw[source.id] ?? null

    if (raw === null) {
      sources[source.id] = SILENT_SOURCE
      continue
    }

    if (raw === false) {
      const latched = RC14_ALERT_LATCHED_UNTIL_ACK[source.alert]
      const holds = latched && previous.engagedAtMs !== null && !previous.acknowledged
      sources[source.id] = holds
        ? { raisedSinceMs: null, engagedAtMs: previous.engagedAtMs, acknowledged: false }
        : SILENT_SOURCE
      continue
    }

    // A fault that goes away and comes back is a NEW fault, so a stale acknowledgement never
    // pre-clears it.
    const rearmed = previous.raisedSinceMs === null && previous.engagedAtMs === null
    const raisedSinceMs = previous.raisedSinceMs ?? nowMs
    const engaged =
      previous.engagedAtMs !== null
        ? previous.engagedAtMs
        : nowMs - raisedSinceMs >= RC14_ALERT_ENGAGE_MS[source.alert]
          ? nowMs
          : null
    sources[source.id] = {
      raisedSinceMs,
      engagedAtMs: engaged,
      acknowledged: rearmed ? false : previous.acknowledged
    }
  }
  return { sources: Object.freeze(sources) }
}

export function acknowledgeRc14Fault(state: Rc14AlertState, id: Rc14FaultSourceId): Rc14AlertState {
  const previous = state.sources[id]
  if (!previous || previous.engagedAtMs === null || previous.acknowledged) return state
  return {
    sources: Object.freeze({ ...state.sources, [id]: { ...previous, acknowledged: true } })
  }
}

export function rc14AlertActive(state: Rc14AlertState, id: Rc14FaultSourceId): boolean {
  return (state.sources[id]?.engagedAtMs ?? null) !== null
}

export function rc14ActiveFaultSources(state: Rc14AlertState): readonly Rc14FaultSource[] {
  return RC14_FAULT_SOURCES.filter((source) => rc14AlertActive(state, source.id))
}

// ─────────────────────────────────────────────────────────── model

export interface Rc14SystemRow {
  readonly id: Rc14SystemId
  readonly label: string
  readonly zone: Rc14SilhouetteZoneId | null
  readonly severity: Rc14Severity
  readonly chip: string
  readonly token: Rc14Token
  readonly pattern: Rc14Pattern
  readonly detail: string
  readonly faults: readonly Rc14FaultSourceId[]
  readonly latched: boolean
  readonly acknowledgeable: readonly Rc14FaultSourceId[]
  readonly engagedAtMs: number | null
  readonly stale: boolean
}

export interface Rc14SilhouetteZoneState {
  readonly id: Rc14SilhouetteZoneId
  readonly label: string
  readonly rect: Rc14SilhouetteRect
  readonly monitored: boolean
  readonly severity: Rc14Severity | null
  readonly chip: string
  readonly token: Rc14Token
  readonly pattern: Rc14Pattern
  readonly description: string
}

export interface Rc14VitalState {
  readonly id: Rc14VitalId
  readonly label: string
  readonly unit: string
  readonly field: Rc01Field
  readonly fill: number
  readonly outOfRange: boolean
  readonly alerting: boolean
  readonly scale: { readonly min: number; readonly max: number }
  readonly description: string
}

export interface Rc14CornerState {
  readonly corner: Rc14Corner
  readonly label: string
  readonly brakeTemp: Rc01Field
  readonly tyrePressure: Rc01Field
}

export type Rc14DecisionWord = 'CONTINUE' | 'LIMP' | 'PIT'

export interface Rc14Decision {
  readonly word: Rc14DecisionWord | null
  readonly value: string
  readonly token: Rc14Token
  readonly available: boolean
  readonly reason: string
}

export interface Rc14TimelineEntry {
  readonly id: Rc14FaultSourceId
  readonly label: string
  readonly severity: Rc14Severity
  readonly engagedAtMs: number
  readonly x: number
  readonly clamped: boolean
}

export interface Rc14DashboardModel {
  readonly systems: readonly Rc14SystemRow[]
  readonly zones: readonly Rc14SilhouetteZoneState[]
  readonly vitals: readonly Rc14VitalState[]
  readonly corners: readonly Rc14CornerState[]
  readonly decision: Rc14Decision
  readonly timeline: readonly Rc14TimelineEntry[]
  readonly monitoredSourceIds: readonly Rc14FaultSourceId[]
  readonly monitoredSystemCount: number
  readonly worstSeverity: Rc14Severity | null
  readonly alertsActive: boolean
}

export interface Rc14ModelOptions {
  readonly alerts?: Rc14AlertState
  readonly includeTimeline?: boolean
  readonly timelineWindowMs?: number
}

/** The app-only fault timeline's observation window. Faults older than it pin to the left edge. */
export const RC14_TIMELINE_WINDOW_MS = 120_000

/**
 * Whether a fault source's channel is CURRENTLY usable: present in the snapshot and inside its
 * freshness budget. A stale channel is not a silent fault and not a silent OK — it is nothing, and
 * every downstream surface treats it that way.
 */
function sourceUsable(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc14Channel, Rc01ChannelReceipt>,
  id: Rc14FaultSourceId,
  nowMs: number
): boolean {
  if (!rc14FaultSourceAvailable(snapshot, id)) return false
  switch (id) {
    case 'vitalOilPressure':
      return reading(snapshot, receipts, 'oilPressure', nowMs).value !== null
    case 'vitalWaterTemp':
      return reading(snapshot, receipts, 'waterTemp', nowMs).value !== null
    case 'vitalBattery':
      return reading(snapshot, receipts, 'battery', nowMs).value !== null
    default:
      return reading(snapshot, receipts, 'faultMap', nowMs).value !== null
  }
}

/**
 * The alert layer's input, derived from the SAME predicates the model renders from, so the two can
 * never drift: a source the model calls unusable is fed `null` and is unlatched on the spot.
 */
export function rc14AlertInputForSnapshot(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc14Channel, Rc01ChannelReceipt>,
  nowMs: number
): Rc14AlertInput {
  const raw: Partial<Record<Rc14FaultSourceId, boolean | null>> = {}
  for (const source of RC14_FAULT_SOURCES) {
    raw[source.id] = sourceUsable(snapshot, receipts, source.id, nowMs)
      ? rc14FaultSourceRaw(snapshot, source.id)
      : null
  }
  return { nowMs, raw }
}

/**
 * Render-phase invalidation, mirroring RC-01's `clearInvalidRc01CurrentAlerts`: any source whose
 * system the model has published as unmonitored is unlatched, so no surface can annotate a zone
 * whose channel was invalidated in the same frame.
 */
export function clearInvalidRc14Alerts(alerts: Rc14AlertState, model: Rc14DashboardModel): Rc14AlertState {
  const monitored = new Set(model.monitoredSourceIds)
  const sources = {} as Record<Rc14FaultSourceId, Rc14SourceAlertState>
  for (const source of RC14_FAULT_SOURCES) {
    sources[source.id] = monitored.has(source.id) ? (alerts.sources[source.id] ?? SILENT_SOURCE) : SILENT_SOURCE
  }
  return { sources: Object.freeze(sources) }
}

function severityDescription(severity: Rc14Severity | null): string {
  return severity === null ? RC14_UNMONITORED_NOTICE : RC14_SEVERITY_CHIP[severity]
}

export function createRc14DashboardModel(
  snapshot: TelemetrySnapshot | null,
  receipts: ReadonlyMap<Rc14Channel, Rc01ChannelReceipt>,
  nowMs: number,
  options: Rc14ModelOptions = {}
): Rc14DashboardModel {
  const alerts = options.alerts ?? createRc14AlertState()
  const timelineWindowMs = options.timelineWindowMs ?? RC14_TIMELINE_WINDOW_MS

  const monitoredSourceIds = RC14_FAULT_SOURCES.filter((source) =>
    sourceUsable(snapshot, receipts, source.id, nowMs)
  ).map((source) => source.id)
  const monitored = new Set(monitoredSourceIds)

  // ── systems: one row per MONITORED system, OK included. A system with no usable source has no
  // row at all, which is packet 16's "row hidden" and never a green OK it cannot justify.
  const systems: Rc14SystemRow[] = []
  for (const system of RC14_SYSTEMS) {
    const sources = RC14_FAULT_SOURCES.filter(
      (source) => source.system === system.id && monitored.has(source.id)
    )
    if (sources.length === 0) continue
    const active = sources.filter((source) => rc14AlertActive(alerts, source.id))
    const severity = rc14WorstSeverity(active.map((source) => source.severity)) ?? 'ok'
    const latched = active.some(
      (source) =>
        RC14_ALERT_LATCHED_UNTIL_ACK[source.alert] && !(alerts.sources[source.id]?.acknowledged ?? false)
    )
    const engagedAtMs = active.reduce<number | null>((earliest, source) => {
      const at = alerts.sources[source.id]?.engagedAtMs ?? null
      if (at === null) return earliest
      return earliest === null ? at : Math.min(earliest, at)
    }, null)
    systems.push({
      id: system.id,
      label: system.label,
      zone: system.zone,
      severity,
      chip: RC14_SEVERITY_CHIP[severity],
      token: RC14_SEVERITY_TOKEN[severity],
      pattern: RC14_SEVERITY_PATTERN[severity],
      detail: active.length > 0 ? active.map((source) => source.label).join(' · ') : 'NOMINAL',
      faults: active.map((source) => source.id),
      latched,
      acknowledgeable: active
        .filter(
          (source) =>
            RC14_ALERT_LATCHED_UNTIL_ACK[source.alert] && !(alerts.sources[source.id]?.acknowledged ?? false)
        )
        .map((source) => source.id),
      engagedAtMs,
      stale: false
    })
  }
  // Packet 7: highest severity on top, then a STABLE key, so live re-ranking cannot flicker rows.
  const order = new Map(RC14_SYSTEMS.map((system, index) => [system.id, index]))
  systems.sort(
    (a, b) =>
      rc14SeverityRank(b.severity) - rc14SeverityRank(a.severity) ||
      (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
  )

  // ── silhouette zones: all eight, always. Unmonitored is a first-class state.
  const severityByZone = new Map<Rc14SilhouetteZoneId, Rc14Severity>()
  const monitoredZones = new Set<Rc14SilhouetteZoneId>()
  for (const row of systems) {
    if (row.zone === null) continue
    monitoredZones.add(row.zone)
    const previous = severityByZone.get(row.zone) ?? null
    severityByZone.set(row.zone, rc14WorstSeverity([previous, row.severity]) ?? row.severity)
  }
  const zones: Rc14SilhouetteZoneState[] = RC14_SILHOUETTE_ZONES.map((rect) => {
    const isMonitored = monitoredZones.has(rect.id)
    const severity = isMonitored ? (severityByZone.get(rect.id) ?? 'ok') : null
    return {
      id: rect.id,
      label: rect.label,
      rect,
      monitored: isMonitored,
      severity,
      chip: severity === null ? RC14_DASH.chip : RC14_SEVERITY_CHIP[severity],
      token: severity === null ? RC14_UNMONITORED_TOKEN : RC14_SEVERITY_TOKEN[severity],
      pattern: severity === null ? RC14_UNMONITORED_PATTERN : RC14_SEVERITY_PATTERN[severity],
      description: `${rect.label} ${severityDescription(severity)}`
    }
  })

  // ── vitals
  const vitals: Rc14VitalState[] = RC14_VITAL_IDS.map((id) => {
    const channel = RC14_VITAL_CHANNEL[id]
    const state = reading(snapshot, receipts, channel, nowMs)
    const value = state.value
    const text = rc14FormatVital(id, value)
    const outOfRange = rc14VitalOutOfRange(id, value)
    const sourceId: Rc14FaultSourceId | null =
      id === 'oilPressure'
        ? 'vitalOilPressure'
        : id === 'waterTemp'
          ? 'vitalWaterTemp'
          : id === 'battery'
            ? 'vitalBattery'
            : null
    const alerting = sourceId !== null && rc14AlertActive(alerts, sourceId)
    const vitalField = field(
      text,
      value,
      state.stale,
      state.unavailable || value === null,
      value === null ? 'muted' : alerting ? 'bad' : 'primary'
    )
    return {
      id,
      label: RC14_VITAL_LABEL[id],
      unit: RC14_VITAL_UNIT[id],
      field: vitalField,
      fill: rc14VitalFill(id, value),
      outOfRange,
      alerting,
      scale: RC14_VITAL_SCALE[id],
      description: rc01FieldDescription(`${RC14_VITAL_LABEL[id]} ${RC14_VITAL_UNIT[id]}`, vitalField)
    }
  })

  // ── corner status
  const corners: Rc14CornerState[] = RC14_CORNERS.map((corner) => {
    const brakeChannel = `brakeTemp${corner.charAt(0).toUpperCase()}${corner.charAt(1)}` as Rc14Channel
    const pressureChannel = `tyrePressure${corner.charAt(0).toUpperCase()}${corner.charAt(1)}` as Rc14Channel
    const brake = reading(snapshot, receipts, brakeChannel, nowMs)
    const pressure = reading(snapshot, receipts, pressureChannel, nowMs)
    return {
      corner,
      label: RC14_CORNER_LABEL[corner],
      brakeTemp: field(
        brake.value === null ? RC14_DASH.brakeTemp : String(Math.round(brake.value)),
        brake.value,
        brake.stale,
        brake.unavailable || brake.value === null,
        brake.value === null ? 'muted' : 'primary'
      ),
      tyrePressure: field(
        pressure.value === null ? RC14_DASH.tyrePressure : pressure.value.toFixed(2),
        pressure.value,
        pressure.stale,
        pressure.unavailable || pressure.value === null,
        pressure.value === null ? 'muted' : 'primary'
      )
    }
  })

  // ── decision
  const worstSeverity = rc14WorstSeverity(systems.map((row) => row.severity))
  const decision: Rc14Decision =
    monitoredSourceIds.length === 0
      ? {
          word: null,
          value: RC14_DASH.decision,
          token: 'secondary',
          available: false,
          reason: RC14_NO_FAULT_SOURCE_NOTICE
        }
      : worstSeverity === 'critical'
        ? { word: 'PIT', value: 'PIT', token: 'danger', available: true, reason: 'CRITICAL FAULT LATCHED' }
        : worstSeverity === 'major'
          ? { word: 'LIMP', value: 'LIMP', token: 'caution', available: true, reason: 'MAJOR FAULT ON A VIABLE SYSTEM' }
          : { word: 'CONTINUE', value: 'CONTINUE', token: 'normal', available: true, reason: 'NO FAULT ON A MONITORED SYSTEM' }

  // ── fault timeline (app only). The engage time is OBSERVED, never reconstructed: a fault that
  // engaged before this widget mounted has no observed time and therefore no timeline entry.
  const timeline: Rc14TimelineEntry[] = []
  if (options.includeTimeline) {
    const windowStart = nowMs - timelineWindowMs
    for (const source of RC14_FAULT_SOURCES) {
      if (!monitored.has(source.id)) continue
      const engagedAtMs = alerts.sources[source.id]?.engagedAtMs ?? null
      if (engagedAtMs === null) continue
      const clamped = engagedAtMs < windowStart
      timeline.push({
        id: source.id,
        label: source.label,
        severity: source.severity,
        engagedAtMs,
        x: round3(clamp(((engagedAtMs - windowStart) / timelineWindowMs) * 100, 0, 100)),
        clamped
      })
    }
    timeline.sort((a, b) => a.engagedAtMs - b.engagedAtMs)
  }

  return {
    systems,
    zones,
    vitals,
    corners,
    decision,
    timeline,
    monitoredSourceIds,
    monitoredSystemCount: systems.length,
    worstSeverity,
    alertsActive: RC14_FAULT_SOURCES.some((source) => rc14AlertActive(alerts, source.id))
  }
}

// ─────────────────────────────────────────────────────────── accessible descriptions

export function rc14SystemDescription(row: Rc14SystemRow): string {
  const where = row.zone === null ? RC14_NO_ZONE_NOTICE.toLowerCase() : `${row.zone} zone`
  return `${row.label} ${row.chip}, ${where}, ${row.detail}`
}

export function rc14DecisionDescription(decision: Rc14Decision): string {
  return decision.available ? `Decision ${decision.value}, ${decision.reason}` : `Decision unavailable, ${decision.reason}`
}

export function rc14CornerDescription(corner: Rc14CornerState): string {
  return `${corner.label} ${rc01FieldDescription('brake temperature °C', corner.brakeTemp)}, ${rc01FieldDescription('tyre pressure bar', corner.tyrePressure)}`
}

export function rc14FormatFillPercent(fill: number): string {
  return `${round1(clamp(finite(fill) ? fill : 0, 0, 1) * 100)}%`
}
