// ── QUALI preset library (single-lap attack) ─────────────────────────────────
// Twenty self-contained qualifying dashboards for the 1024×600 GT3 canvas. Every
// board is a "lap attack" layout: it prominently surfaces the best/session-best
// references, the live predictive delta, and the current/last/estimated lap so a
// driver hunting a single fast lap sees improvement at a glance.
//
// This file only COMPOSES the exported primitives from ./dashboards (dashboard,
// w, cv, heroGear, topRevBar, hairline, style + the shared colour tokens). It
// never touches the built-in registry — callers wire QUALI_PRESETS in themselves.
//
// Mandatory chrome present on EVERY board (motorsport must-haves):
//   • RevLights via topRevBar(...)          • Gear via heroGear(...)
//   • Track map (trackmap-clean/mini/elab)  • Position / Incidents / Fuel tiles
//   • Track conditions + weather (WET/TRK/AIR trio or the 'weather' widget)
// Quali timing theme on every board: best (bestLapFmt), delta-to-best
// (deltaBestFmt), delta-to-session-best (deltaSessionBestFmt), last (lastLapFmt),
// current (currentLapFmt), estimated (estLapFmt) and a big live delta (deltaSec).

import {
  dashboard,
  w,
  cv,
  heroGear,
  topRevBar,
  hairline,
  style,
  RACE_BG,
  TEXT,
  MUTED,
  CYAN,
  GREEN,
  AMBER,
  RED,
  FONT_NUM
} from './dashboards'
import type { Dashboard, DashboardElement } from './dashboards'

// ── Local composition helpers ────────────────────────────────────────────────
// These only call the shared primitives above; they exist to keep the twenty
// layouts terse while guaranteeing the mandatory widgets are always present.

// The required first element: pure-black full-canvas backplate.
function bg(): DashboardElement {
  return w('rect', 0, 0, 1024, 600, { background: RACE_BG, borderWidth: 0, radius: 0 }, { name: 'BG' })
}

// Secondary speed readout under the hero gear (7-seg numeric, km/h).
function speedUnder(x: number, y: number, wd: number, ht: number, maxFontSize = 60): DashboardElement {
  return cv('speedKmh', x, y, wd, ht, '', { fontFamily: FONT_NUM, suffix: 'km/h', minFontSize: 22, maxFontSize })
}

// Vertical lap stack: current / last / best / estimated (the DDU timing column).
function lapCol(x: number, y: number, cw: number, rh: number, gap: number, accentBest: string): DashboardElement[] {
  return [
    cv('currentLapFmt', x, y + 0 * (rh + gap), cw, rh, 'LAP', { accentColor: TEXT, minFontSize: 15, maxFontSize: 42 }),
    cv('lastLapFmt', x, y + 1 * (rh + gap), cw, rh, 'LAST', { accentColor: MUTED, minFontSize: 15, maxFontSize: 42 }),
    cv('bestLapFmt', x, y + 2 * (rh + gap), cw, rh, 'BEST', { accentColor: accentBest, minFontSize: 15, maxFontSize: 42 }),
    cv('estLapFmt', x, y + 3 * (rh + gap), cw, rh, 'EST', { accentColor: TEXT, minFontSize: 15, maxFontSize: 42 })
  ]
}

// Horizontal lap row: current / last / best / estimated across the top edge.
function lapRow(x: number, y: number, cw: number, rh: number, gap: number, accentBest: string): DashboardElement[] {
  return [
    cv('currentLapFmt', x + 0 * (cw + gap), y, cw, rh, 'LAP', { accentColor: TEXT, minFontSize: 14, maxFontSize: 40 }),
    cv('lastLapFmt', x + 1 * (cw + gap), y, cw, rh, 'LAST', { accentColor: MUTED, minFontSize: 14, maxFontSize: 40 }),
    cv('bestLapFmt', x + 2 * (cw + gap), y, cw, rh, 'BEST', { accentColor: accentBest, minFontSize: 14, maxFontSize: 40 }),
    cv('estLapFmt', x + 3 * (cw + gap), y, cw, rh, 'EST', { accentColor: TEXT, minFontSize: 14, maxFontSize: 40 })
  ]
}

// The two reference deltas side by side: Δ to best and Δ to session best.
function deltaPairRow(x: number, y: number, cw: number, rh: number, gap: number): DashboardElement[] {
  return [
    cv('deltaBestFmt', x, y, cw, rh, 'Δ BEST', { accentColor: MUTED, minFontSize: 14, maxFontSize: 36 }),
    cv('deltaSessionBestFmt', x + cw + gap, y, cw, rh, 'Δ SES', { accentColor: MUTED, minFontSize: 14, maxFontSize: 36 })
  ]
}

// The two reference deltas stacked vertically.
function deltaPairCol(x: number, y: number, cw: number, rh: number, gap: number): DashboardElement[] {
  return [
    cv('deltaBestFmt', x, y, cw, rh, 'Δ BEST', { accentColor: MUTED, minFontSize: 14, maxFontSize: 40 }),
    cv('deltaSessionBestFmt', x, y + rh + gap, cw, rh, 'Δ SES', { accentColor: MUTED, minFontSize: 14, maxFontSize: 40 })
  ]
}

// Big live predictive-delta hero as a borderless numeric (green = gaining).
function deltaHeroValue(x: number, y: number, wd: number, ht: number, accent: string): DashboardElement {
  return cv('deltaSec', x, y, wd, ht, 'DELTA', { accentColor: accent, minFontSize: 34, maxFontSize: 128 })
}

// Big live delta as the curated clean tile.
function deltaHeroClean(x: number, y: number, wd: number, ht: number, accent: string, ref: 'best' | 'session' | 'last' = 'session'): DashboardElement {
  return w('delta-clean', x, y, wd, ht, style({ title: 'DELTA', deltaReference: ref, deltaRangeSec: 1, accentColor: accent, radius: 12, minFontSize: 20, maxFontSize: 92 }), { binding: 'deltaSec', name: 'DeltaHero' })
}

// Big live delta as the curated elaborate tile (bar + number).
function deltaHeroElab(x: number, y: number, wd: number, ht: number, accent: string, ref: 'best' | 'session' | 'last' = 'session'): DashboardElement {
  return w('delta-elaborate', x, y, wd, ht, style({ title: 'DELTA', deltaReference: ref, deltaRangeSec: 1, accentColor: accent, radius: 12, minFontSize: 20, maxFontSize: 92 }), { binding: 'deltaSec', name: 'DeltaHero' })
}

// Big live delta as the semantic predictive delta tile.
function deltaHeroTile(x: number, y: number, wd: number, ht: number, accent: string, ref: 'best' | 'session' | 'last' = 'best'): DashboardElement {
  return w('deltatile', x, y, wd, ht, style({ title: 'DELTA', deltaReference: ref, deltaRangeSec: 1, accentColor: accent, radius: 12, minFontSize: 18, maxFontSize: 84 }), { name: 'DeltaTile' })
}

// Semantic lap-timing cluster (current/last/best/estimated in one widget).
function lapTimingWidget(x: number, y: number, wd: number, ht: number, accent: string): DashboardElement {
  return w(
    'laptiming',
    x,
    y,
    wd,
    ht,
    style({ title: 'LAP / LAST / BEST / EST', showCurrent: true, showLast: true, showBest: true, showEstimated: true, radius: 12, accentColor: accent, minFontSize: 14, maxFontSize: 40 }),
    { name: 'Timing' }
  )
}

// Track map variants (all bound to lap distance so the marker tracks the car).
function mapClean(x: number, y: number, wd: number, ht: number, accent: string): DashboardElement {
  return w('trackmap-clean', x, y, wd, ht, style({ background: 'transparent', borderWidth: 0, accentColor: accent, color: MUTED, showIcon: false }), { binding: 'lapDistPct', name: 'Map' })
}
function mapMini(x: number, y: number, wd: number, ht: number, accent: string): DashboardElement {
  return w('trackmini', x, y, wd, ht, style({ radius: 10, accentColor: accent }), { binding: 'lapDistPct', name: 'Map' })
}
function mapElab(x: number, y: number, wd: number, ht: number, accent: string): DashboardElement {
  return w('trackmap-elaborate', x, y, wd, ht, style({ background: 'transparent', borderWidth: 0, accentColor: accent, color: MUTED, showIcon: false }), { binding: 'lapDistPct', name: 'Map' })
}

// Track conditions + weather as three floating readouts: wetness / track / air.
function wxTrio(x: number, y: number, cw: number, ht: number, gap: number, accent: string): DashboardElement[] {
  return [
    cv('trackWetnessPct', x + 0 * (cw + gap), y, cw, ht, 'WET', { accentColor: accent, minFontSize: 12, maxFontSize: 30 }),
    cv('trackTempC', x + 1 * (cw + gap), y, cw, ht, 'TRK', { accentColor: accent, suffix: '°', minFontSize: 12, maxFontSize: 30 }),
    cv('airTempC', x + 2 * (cw + gap), y, cw, ht, 'AIR', { accentColor: accent, suffix: '°', minFontSize: 12, maxFontSize: 30 })
  ]
}

// Track conditions + weather as the semantic weather widget.
function wxWidget(x: number, y: number, wd: number, ht: number, accent: string): DashboardElement {
  return w('weather', x, y, wd, ht, style({ title: 'TRACK', radius: 12, accentColor: accent, minFontSize: 12, maxFontSize: 28 }), { name: 'Weather' })
}

// Position / Incidents / Fuel across a row (accents fixed per the house style).
function pif(x: number, y: number, cw: number, ht: number, gap: number): DashboardElement[] {
  return [
    cv('position', x + 0 * (cw + gap), y, cw, ht, 'POS', { accentColor: AMBER, minFontSize: 16, maxFontSize: 52 }),
    cv('incidentCount', x + 1 * (cw + gap), y, cw, ht, 'INC', { accentColor: RED, minFontSize: 16, maxFontSize: 52 }),
    cv('fuelLitersStr', x + 2 * (cw + gap), y, cw, ht, 'FUEL', { accentColor: AMBER, minFontSize: 14, maxFontSize: 44 })
  ]
}

// Position / Incidents / Fuel stacked in a vertical rail.
function pifV(x: number, y: number, cw: number, rh: number, gap: number): DashboardElement[] {
  return [
    cv('position', x, y + 0 * (rh + gap), cw, rh, 'POS', { accentColor: AMBER, minFontSize: 16, maxFontSize: 48 }),
    cv('incidentCount', x, y + 1 * (rh + gap), cw, rh, 'INC', { accentColor: RED, minFontSize: 16, maxFontSize: 48 }),
    cv('fuelLitersStr', x, y + 2 * (rh + gap), cw, rh, 'FUEL', { accentColor: AMBER, minFontSize: 14, maxFontSize: 40 })
  ]
}

// ── 1 · Attack 1 — cool, central gear, left lap column, right delta hero ──────
function createQuali1(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(60, 22, 904, 30, 24),
    cv('flagLabel', 16, 20, 36, 34, '', { accentColor: AMBER, minFontSize: 12, maxFontSize: 24 }),
    cv('pitLimiter', 972, 20, 36, 34, '', { accentColor: CYAN, minFontSize: 12, maxFontSize: 24 }),
    heroGear(412, 78, 200, 266),
    speedUnder(412, 350, 200, 78, 56),
    ...lapCol(36, 74, 300, 64, 8, CYAN),
    deltaHeroValue(688, 74, 300, 150, GREEN),
    ...deltaPairRow(688, 234, 146, 60, 8),
    mapClean(688, 302, 300, 120, CYAN),
    hairline(36, 440, 952, 1),
    ...pif(36, 452, 150, 92, 14),
    ...wxTrio(560, 466, 132, 76, 14, CYAN)
  ]
  return dashboard('Quali · Attack 1', 1024, 600, 'Cool lap-attack board: central gear anchor, a left current/last/best/estimated lap column, and a dominant live delta with the two reference deltas and track map stacked on the right.', elements)
}

// ── 2 · Attack 2 — warm, left gear, laptiming cluster, delta-elaborate hero ───
function createQuali2(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(290, 20, 710, 26, 22),
    heroGear(28, 64, 250, 300),
    speedUnder(28, 370, 250, 78, 58),
    lapTimingWidget(296, 60, 356, 160, AMBER),
    ...deltaPairRow(296, 232, 172, 64, 12),
    deltaHeroElab(664, 60, 340, 176, RED, 'session'),
    cv('estLapFmt', 664, 248, 340, 56, 'EST', { accentColor: TEXT, minFontSize: 16, maxFontSize: 40 }),
    mapElab(296, 308, 356, 150, AMBER),
    ...pif(664, 316, 108, 92, 8),
    wxWidget(296, 470, 708, 100, AMBER)
  ]
  return dashboard('Quali · Attack 2', 1024, 600, 'Warm lap-attack board: big left gear, a central lap-timing cluster over the reference deltas and an elaborate delta hero on the right, with a wide weather strip along the bottom.', elements)
}

// ── 3 · Apex Cool — right gear, semantic delta tile, mini map corner ──────────
function createQuali3(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(40, 22, 640, 24, 20),
    heroGear(724, 66, 280, 314),
    speedUnder(724, 386, 280, 80, 62),
    ...lapCol(32, 66, 300, 62, 8, CYAN),
    deltaHeroTile(356, 66, 340, 188, GREEN, 'best'),
    ...deltaPairRow(356, 264, 165, 60, 10),
    mapMini(32, 356, 130, 118, CYAN),
    ...pif(356, 336, 110, 84, 10),
    ...wxTrio(356, 430, 112, 72, 12, CYAN)
  ]
  return dashboard('Quali · Apex Cool', 1024, 600, 'Cool board with the gear anchored right, a left lap column, a semantic predictive-delta tile centred over the reference deltas, plus a mini track map and weather trio filling the lower left.', elements)
}

// ── 4 · Apex Warm — central gear, top lap row, delta-clean hero, wide weather ─
function createQuali4(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(52, 22, 920, 28, 22),
    ...lapRow(40, 62, 232, 58, 8, AMBER),
    heroGear(392, 138, 240, 246),
    speedUnder(392, 390, 240, 74, 58),
    deltaHeroClean(40, 152, 320, 150, RED, 'session'),
    ...deltaPairCol(40, 312, 320, 60, 8),
    mapClean(664, 152, 320, 150, AMBER),
    ...pif(664, 314, 100, 84, 10),
    hairline(40, 458, 944, 1),
    ...wxTrio(40, 470, 300, 84, 20, AMBER)
  ]
  return dashboard('Quali · Apex Warm', 1024, 600, 'Warm board with a full-width lap row across the top, a central gear, a clean delta hero and stacked reference deltas on the left, and the track map with position/incidents/fuel on the right.', elements)
}

// ── 5 · Ice Minimal — big central gear, left delta + laptiming, clean cool ─────
function createQuali5(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(160, 26, 704, 22, 18),
    heroGear(372, 92, 280, 300),
    speedUnder(372, 398, 280, 74, 60),
    deltaHeroValue(24, 104, 320, 190, GREEN),
    lapTimingWidget(24, 306, 320, 166, CYAN),
    ...deltaPairCol(680, 104, 320, 92, 12),
    mapClean(680, 308, 320, 164, CYAN),
    ...pif(24, 486, 150, 88, 14),
    ...wxTrio(560, 498, 140, 72, 14, CYAN)
  ]
  return dashboard('Quali · Ice Minimal', 1024, 600, 'Minimal cool board: oversized central gear, an outsized live delta over a lap-timing cluster on the left, and the reference deltas above the track map on the right.', elements)
}

// ── 6 · Ember Minimal — big central gear, warm, mirrored of Ice ───────────────
function createQuali6(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(160, 26, 704, 22, 18),
    heroGear(372, 92, 280, 300),
    speedUnder(372, 398, 280, 74, 60),
    deltaHeroClean(680, 104, 320, 190, RED, 'session'),
    lapTimingWidget(680, 306, 320, 166, AMBER),
    ...deltaPairCol(24, 104, 320, 92, 12),
    mapElab(24, 308, 320, 164, AMBER),
    ...pif(24, 486, 150, 88, 14),
    ...wxTrio(560, 498, 140, 72, 14, AMBER)
  ]
  return dashboard('Quali · Ember Minimal', 1024, 600, 'Minimal warm board mirroring Ice: central gear with a clean delta hero over a lap-timing cluster on the right and the reference deltas above an elaborate track map on the left.', elements)
}

// ── 7 · Delta Band — delta-first: wide delta hero band up top, gear below ──────
function createQuali7(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(40, 20, 944, 20, 26),
    deltaHeroElab(332, 46, 360, 150, GREEN, 'session'),
    heroGear(420, 206, 184, 190),
    speedUnder(420, 400, 184, 56, 44),
    ...lapCol(28, 54, 288, 58, 7, CYAN),
    ...deltaPairCol(716, 54, 288, 58, 7),
    mapClean(716, 190, 288, 150, CYAN),
    hairline(28, 470, 976, 1),
    ...pif(28, 480, 150, 100, 14),
    ...wxTrio(560, 492, 132, 80, 14, CYAN)
  ]
  return dashboard('Quali · Delta Band', 1024, 600, 'Delta-first cool board: a prominent elaborate delta hero over the central gear, a left lap column, reference deltas and the track map on the right, and the mandatory tiles along the bottom.', elements)
}

// ── 8 · Session Hunter — cool, left gear, session-best emphasis ───────────────
function createQuali8(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(300, 22, 700, 26, 22),
    heroGear(28, 66, 240, 292),
    speedUnder(28, 364, 240, 74, 56),
    cv('deltaSessionBestFmt', 296, 60, 380, 150, 'Δ SESSION BEST', { accentColor: CYAN, minFontSize: 30, maxFontSize: 96 }),
    deltaHeroValue(296, 220, 380, 130, GREEN),
    cv('deltaBestFmt', 296, 360, 185, 70, 'Δ BEST', { accentColor: MUTED, minFontSize: 16, maxFontSize: 44 }),
    cv('estLapFmt', 491, 360, 185, 70, 'EST', { accentColor: TEXT, minFontSize: 16, maxFontSize: 44 }),
    cv('currentLapFmt', 696, 60, 308, 64, 'LAP', { accentColor: TEXT, minFontSize: 16, maxFontSize: 44 }),
    cv('lastLapFmt', 696, 132, 308, 64, 'LAST', { accentColor: MUTED, minFontSize: 16, maxFontSize: 44 }),
    cv('bestLapFmt', 696, 204, 308, 64, 'BEST', { accentColor: CYAN, minFontSize: 16, maxFontSize: 44 }),
    mapClean(696, 280, 308, 150, CYAN),
    hairline(28, 452, 976, 1),
    ...pif(28, 462, 150, 96, 14),
    ...wxTrio(560, 474, 132, 76, 14, CYAN)
  ]
  return dashboard('Quali · Session Hunter', 1024, 600, 'Cool board built around the delta to the session best: a huge session-best delta and live delta hero centre, current/last/best lap and track map right, and the mandatory tiles across the bottom.', elements)
}

// ── 9 · Best Chaser — warm, right gear, personal-best emphasis ────────────────
function createQuali9(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(24, 22, 700, 26, 22),
    heroGear(756, 66, 240, 292),
    speedUnder(756, 364, 240, 74, 56),
    cv('currentLapFmt', 20, 60, 300, 64, 'LAP', { accentColor: TEXT, minFontSize: 16, maxFontSize: 44 }),
    cv('lastLapFmt', 20, 132, 300, 64, 'LAST', { accentColor: MUTED, minFontSize: 16, maxFontSize: 44 }),
    cv('bestLapFmt', 20, 204, 300, 64, 'BEST', { accentColor: AMBER, minFontSize: 16, maxFontSize: 44 }),
    mapElab(20, 280, 300, 150, AMBER),
    cv('deltaBestFmt', 340, 60, 388, 150, 'Δ BEST', { accentColor: AMBER, minFontSize: 30, maxFontSize: 96 }),
    deltaHeroClean(340, 220, 388, 130, RED, 'best'),
    cv('deltaSessionBestFmt', 340, 360, 190, 70, 'Δ SES', { accentColor: MUTED, minFontSize: 16, maxFontSize: 44 }),
    cv('estLapFmt', 534, 360, 194, 70, 'EST', { accentColor: TEXT, minFontSize: 16, maxFontSize: 44 }),
    hairline(20, 452, 984, 1),
    ...pif(20, 462, 150, 96, 14),
    ...wxTrio(552, 474, 132, 76, 14, AMBER)
  ]
  return dashboard('Quali · Best Chaser', 1024, 600, 'Warm board built around the delta to your personal best: gear right, current/last/best lap and elaborate map left, and a giant best delta over the live delta hero in the centre.', elements)
}

// ── 10 · Dense Cool — DDU-packed, left gear, right telemetry rail + mini map ──
function createQuali10(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(40, 18, 944, 22, 26),
    heroGear(24, 60, 220, 260),
    speedUnder(24, 326, 220, 70, 52),
    lapTimingWidget(264, 56, 344, 160, CYAN),
    deltaHeroTile(264, 228, 344, 168, GREEN, 'best'),
    ...deltaPairRow(264, 408, 168, 56, 8),
    ...pifV(628, 56, 180, 84, 10),
    wxWidget(628, 338, 180, 92, CYAN),
    mapMini(828, 56, 176, 176, CYAN),
    ...deltaPairCol(828, 244, 176, 84, 12)
  ]
  return dashboard('Quali · Dense Cool', 1024, 600, 'Dense cool DDU: left gear, a central lap-timing cluster over a predictive delta tile, a right position/incidents/fuel rail with the weather widget, and a mini map above the reference deltas.', elements)
}

// ── 11 · Dense Warm — DDU-packed, right gear, left telemetry rail + mini map ──
function createQuali11(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(40, 18, 944, 22, 26),
    heroGear(780, 60, 220, 260),
    speedUnder(780, 326, 220, 70, 52),
    lapTimingWidget(416, 56, 344, 160, AMBER),
    deltaHeroElab(416, 228, 344, 168, RED, 'session'),
    ...deltaPairRow(416, 408, 168, 56, 8),
    ...pifV(216, 56, 180, 84, 10),
    wxWidget(216, 338, 180, 92, AMBER),
    mapMini(20, 56, 176, 176, AMBER),
    ...deltaPairCol(20, 244, 176, 84, 12)
  ]
  return dashboard('Quali · Dense Warm', 1024, 600, 'Dense warm DDU mirroring Dense Cool: right gear, a central lap-timing cluster over an elaborate delta, a left position/incidents/fuel rail with the weather widget, and a mini map above the reference deltas.', elements)
}

// ── 12 · Split Screen — timing half vs gear+delta half ────────────────────────
function createQuali12(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(32, 22, 960, 26, 24),
    ...lapCol(32, 72, 452, 70, 10, CYAN),
    ...deltaPairRow(32, 396, 222, 74, 8),
    heroGear(560, 72, 220, 244),
    speedUnder(560, 322, 220, 70, 54),
    deltaHeroValue(800, 72, 204, 150, GREEN),
    mapClean(800, 232, 204, 160, CYAN),
    hairline(32, 486, 960, 1),
    ...pif(32, 496, 156, 92, 14),
    ...wxTrio(560, 508, 140, 76, 14, CYAN)
  ]
  return dashboard('Quali · Split Screen', 1024, 600, 'Cool split layout: a wide left half devoted to the current/last/best/estimated lap column and reference deltas, and a right half with the gear, live delta hero and track map.', elements)
}

// ── 13 · Estimator — cool, estimated-lap emphasis ─────────────────────────────
function createQuali13(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(52, 22, 920, 26, 22),
    heroGear(400, 96, 224, 268),
    speedUnder(400, 370, 224, 74, 56),
    cv('estLapFmt', 36, 72, 320, 150, 'EST LAP', { accentColor: CYAN, minFontSize: 30, maxFontSize: 92 }),
    deltaHeroValue(36, 232, 320, 132, RED),
    cv('currentLapFmt', 36, 374, 156, 70, 'LAP', { accentColor: TEXT, minFontSize: 15, maxFontSize: 42 }),
    cv('lastLapFmt', 200, 374, 156, 70, 'LAST', { accentColor: MUTED, minFontSize: 15, maxFontSize: 42 }),
    cv('bestLapFmt', 668, 72, 336, 76, 'BEST', { accentColor: CYAN, minFontSize: 18, maxFontSize: 48 }),
    ...deltaPairRow(668, 158, 164, 76, 8),
    mapClean(668, 244, 336, 148, CYAN),
    hairline(36, 456, 968, 1),
    ...pif(36, 466, 150, 96, 14),
    ...wxTrio(560, 478, 132, 76, 14, CYAN)
  ]
  return dashboard('Quali · Estimator', 1024, 600, 'Cool board that foregrounds the estimated lap: a big estimated time over the live delta on the left, a central gear, and best plus the reference deltas above the track map on the right.', elements)
}

// ── 14 · Right Rail — warm, left gear, tall right readout rail ─────────────────
function createQuali14(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(24, 22, 620, 24, 20),
    heroGear(28, 66, 300, 320),
    speedUnder(28, 392, 300, 78, 60),
    deltaHeroElab(356, 66, 380, 200, RED, 'session'),
    lapTimingWidget(356, 282, 380, 150, AMBER),
    ...pifV(756, 66, 248, 84, 10),
    ...deltaPairCol(756, 338, 248, 60, 8),
    mapMini(356, 448, 130, 128, AMBER),
    wxWidget(508, 448, 228, 128, AMBER)
  ]
  return dashboard('Quali · Right Rail', 1024, 600, 'Warm board with a big left gear, an elaborate delta over a lap-timing cluster in the centre, and a tall right rail of position/incidents/fuel above the reference deltas, with map and weather along the lower centre.', elements)
}

// ── 15 · Left Rail — cool, right gear, tall left readout rail ──────────────────
function createQuali15(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(380, 22, 620, 24, 20),
    heroGear(696, 66, 300, 320),
    speedUnder(696, 392, 300, 78, 60),
    deltaHeroValue(288, 66, 380, 200, GREEN),
    lapTimingWidget(288, 282, 380, 150, CYAN),
    ...pifV(20, 66, 248, 84, 10),
    ...deltaPairCol(20, 338, 248, 60, 8),
    mapMini(288, 448, 130, 128, CYAN),
    wxWidget(440, 448, 228, 128, CYAN)
  ]
  return dashboard('Quali · Left Rail', 1024, 600, 'Cool board with a big right gear, a live delta over a lap-timing cluster in the centre, and a tall left rail of position/incidents/fuel above the reference deltas, with map and weather along the lower centre.', elements)
}

// ── 16 · Center Stack — warm, symmetric stack around the gear ─────────────────
function createQuali16(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(40, 20, 944, 24, 26),
    ...lapRow(40, 58, 232, 56, 8, AMBER),
    ...pifV(40, 130, 180, 78, 10),
    mapClean(40, 392, 180, 150, AMBER),
    heroGear(412, 128, 200, 220),
    speedUnder(412, 354, 200, 66, 50),
    deltaHeroClean(292, 430, 440, 150, RED, 'session'),
    ...deltaPairCol(804, 130, 180, 78, 10),
    cv('bestLapFmt', 804, 296, 180, 76, 'BEST', { accentColor: AMBER, minFontSize: 16, maxFontSize: 46 }),
    wxWidget(804, 384, 180, 138, AMBER)
  ]
  return dashboard('Quali · Center Stack', 1024, 600, 'Warm symmetric board: lap row and a position/incidents/fuel rail with map on the left, gear centred over a wide clean delta hero, and the reference deltas, best lap and weather on the right.', elements)
}

// ── 17 · Wide Timing — cool, full-width lap cluster on top ─────────────────────
function createQuali17(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(40, 20, 944, 22, 26),
    lapTimingWidget(40, 50, 944, 150, CYAN),
    heroGear(412, 214, 200, 214),
    speedUnder(412, 432, 200, 60, 48),
    deltaHeroValue(40, 214, 344, 170, GREEN),
    ...deltaPairCol(40, 396, 344, 46, 8),
    ...deltaPairCol(640, 214, 344, 60, 10),
    cv('bestLapFmt', 640, 346, 344, 76, 'BEST', { accentColor: CYAN, minFontSize: 18, maxFontSize: 48 }),
    mapClean(640, 434, 200, 150, CYAN),
    ...pif(40, 500, 150, 84, 12),
    wxWidget(856, 434, 150, 150, CYAN)
  ]
  return dashboard('Quali · Wide Timing', 1024, 600, 'Cool board with a full-width lap-timing cluster across the top, a central gear, a live delta hero and reference deltas on the left, and best lap, map and weather on the right.', elements)
}

// ── 18 · Delta Twin — warm, twin delta tiles flanking the gear ────────────────
function createQuali18(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(52, 20, 920, 22, 22),
    ...lapRow(28, 48, 232, 44, 8, AMBER),
    deltaHeroTile(28, 104, 384, 146, AMBER, 'best'),
    deltaHeroTile(612, 104, 384, 146, RED, 'session'),
    heroGear(452, 104, 120, 180),
    speedUnder(452, 290, 120, 52, 44),
    cv('bestLapFmt', 28, 262, 384, 64, 'BEST', { accentColor: AMBER, minFontSize: 18, maxFontSize: 48 }),
    cv('estLapFmt', 612, 262, 384, 64, 'EST', { accentColor: TEXT, minFontSize: 18, maxFontSize: 48 }),
    ...deltaPairRow(28, 392, 220, 58, 12),
    mapElab(700, 392, 296, 140, AMBER),
    ...pif(28, 470, 150, 100, 12),
    wxWidget(522, 470, 168, 100, AMBER)
  ]
  return dashboard('Quali · Delta Twin', 1024, 600, 'Warm board with twin predictive-delta tiles (to best and to session best) flanking the gear over best and estimated laps, a lap row up top, and the reference deltas, map and mandatory tiles across the bottom.', elements)
}

// ── 19 · Clean Cool 2 — airy cool minimal ─────────────────────────────────────
function createQuali19(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(200, 26, 624, 20, 18),
    heroGear(392, 84, 240, 250),
    speedUnder(392, 340, 240, 70, 56),
    deltaHeroValue(40, 96, 300, 180, GREEN),
    cv('bestLapFmt', 40, 288, 300, 84, 'BEST', { accentColor: CYAN, minFontSize: 20, maxFontSize: 56 }),
    lapTimingWidget(684, 96, 300, 150, CYAN),
    ...deltaPairCol(684, 262, 300, 54, 10),
    mapClean(392, 428, 240, 150, CYAN),
    ...pif(40, 420, 110, 88, 10),
    ...wxTrio(684, 430, 96, 76, 12, CYAN)
  ]
  return dashboard('Quali · Clean Cool 2', 1024, 600, 'Airy cool minimal: a central gear, a large live delta over best on the left, a compact lap-timing cluster above the reference deltas on the right, and map plus mandatory tiles below.', elements)
}

// ── 20 · Clean Warm 2 — airy warm minimal ─────────────────────────────────────
function createQuali20(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(200, 26, 624, 20, 18),
    heroGear(392, 84, 240, 250),
    speedUnder(392, 340, 240, 70, 56),
    deltaHeroClean(684, 96, 300, 180, RED, 'session'),
    cv('bestLapFmt', 684, 288, 300, 84, 'BEST', { accentColor: AMBER, minFontSize: 20, maxFontSize: 56 }),
    lapTimingWidget(40, 96, 300, 150, AMBER),
    ...deltaPairCol(40, 262, 300, 54, 10),
    mapElab(392, 428, 240, 150, AMBER),
    ...pif(688, 470, 100, 92, 10),
    ...wxTrio(40, 430, 96, 76, 12, AMBER)
  ]
  return dashboard('Quali · Clean Warm 2', 1024, 600, 'Airy warm minimal mirroring Clean Cool 2: a central gear, a clean delta hero over best on the right, a compact lap-timing cluster above the reference deltas on the left, and map plus mandatory tiles below.', elements)
}

// ── Registry payload (callers spread this into the built-in preset list) ───────
export const QUALI_PRESETS: Array<{ id: string; name: string; build: () => Dashboard; tags?: string[] }> = [
  { id: 'quali-attack-1', name: 'Quali · Attack 1', build: createQuali1, tags: ['quali', 'lap-attack', 'delta', 'motorsport', 'cool', 'center-gear'] },
  { id: 'quali-attack-2', name: 'Quali · Attack 2', build: createQuali2, tags: ['quali', 'lap-attack', 'delta', 'motorsport', 'warm', 'laptiming'] },
  { id: 'quali-apex-cool', name: 'Quali · Apex Cool', build: createQuali3, tags: ['quali', 'lap-attack', 'delta', 'motorsport', 'cool', 'deltatile'] },
  { id: 'quali-apex-warm', name: 'Quali · Apex Warm', build: createQuali4, tags: ['quali', 'lap-attack', 'delta', 'motorsport', 'warm', 'lap-row'] },
  { id: 'quali-ice-minimal', name: 'Quali · Ice Minimal', build: createQuali5, tags: ['quali', 'lap-attack', 'delta', 'motorsport', 'cool', 'minimal'] },
  { id: 'quali-ember-minimal', name: 'Quali · Ember Minimal', build: createQuali6, tags: ['quali', 'lap-attack', 'delta', 'motorsport', 'warm', 'minimal'] },
  { id: 'quali-delta-band', name: 'Quali · Delta Band', build: createQuali7, tags: ['quali', 'lap-attack', 'delta', 'motorsport', 'cool', 'delta-first'] },
  { id: 'quali-session-hunter', name: 'Quali · Session Hunter', build: createQuali8, tags: ['quali', 'lap-attack', 'delta', 'motorsport', 'cool', 'session-best'] },
  { id: 'quali-best-chaser', name: 'Quali · Best Chaser', build: createQuali9, tags: ['quali', 'lap-attack', 'delta', 'motorsport', 'warm', 'personal-best'] },
  { id: 'quali-dense-cool', name: 'Quali · Dense Cool', build: createQuali10, tags: ['quali', 'lap-attack', 'delta', 'motorsport', 'cool', 'dense'] },
  { id: 'quali-dense-warm', name: 'Quali · Dense Warm', build: createQuali11, tags: ['quali', 'lap-attack', 'delta', 'motorsport', 'warm', 'dense'] },
  { id: 'quali-split-screen', name: 'Quali · Split Screen', build: createQuali12, tags: ['quali', 'lap-attack', 'delta', 'motorsport', 'cool', 'split'] },
  { id: 'quali-estimator', name: 'Quali · Estimator', build: createQuali13, tags: ['quali', 'lap-attack', 'delta', 'motorsport', 'cool', 'estimated'] },
  { id: 'quali-right-rail', name: 'Quali · Right Rail', build: createQuali14, tags: ['quali', 'lap-attack', 'delta', 'motorsport', 'warm', 'rail'] },
  { id: 'quali-left-rail', name: 'Quali · Left Rail', build: createQuali15, tags: ['quali', 'lap-attack', 'delta', 'motorsport', 'cool', 'rail'] },
  { id: 'quali-center-stack', name: 'Quali · Center Stack', build: createQuali16, tags: ['quali', 'lap-attack', 'delta', 'motorsport', 'warm', 'stack'] },
  { id: 'quali-wide-timing', name: 'Quali · Wide Timing', build: createQuali17, tags: ['quali', 'lap-attack', 'delta', 'motorsport', 'cool', 'wide'] },
  { id: 'quali-delta-twin', name: 'Quali · Delta Twin', build: createQuali18, tags: ['quali', 'lap-attack', 'delta', 'motorsport', 'warm', 'twin'] },
  { id: 'quali-clean-cool-2', name: 'Quali · Clean Cool 2', build: createQuali19, tags: ['quali', 'lap-attack', 'delta', 'motorsport', 'cool', 'clean'] },
  { id: 'quali-clean-warm-2', name: 'Quali · Clean Warm 2', build: createQuali20, tags: ['quali', 'lap-attack', 'delta', 'motorsport', 'warm', 'clean'] }
]
