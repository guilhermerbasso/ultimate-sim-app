// ─── RACE "FIRST PLACE / DEFEND" dashboard catalogue ──────────────────────────
// Twenty original 1024×600 race dashboards built for the driver who is LEADING
// and defending position. Where a normal chase dash fixates on the car AHEAD,
// this family flips the strategic emphasis onto the car BEHIND: a prominent gap
// to the car behind (`gapBehindFmt`, "BEHIND"), your projected pace
// (`estLapFmt`, "PACE"), the delta to the session-best lap
// (`deltaSessionBestFmt`) and a relatives strip highlighting the threat behind —
// so the leader can manage the gap to P2 lap after lap.
//
// This module is SELF-CONTAINED and does NOT touch the BUILTIN_PRESETS registry.
// It only imports the shared authoring helpers + colour tokens (values) and the
// Dashboard type from `./dashboards`, so it is a one-way dependency
// (dashboards-race-first.ts → dashboards.ts) with no runtime import cycle. Every
// widget type + binding used here exists in the shared widget catalogue
// (widget-catalog-data.ts) and/or the reference presets in dashboards.ts.
//
// MANDATORY on every dashboard: RevLights (topRevBar), a dominant Gear
// (heroGear), a track MAP (trackmap-clean / trackmini), Position (POS, amber),
// Incidents (INC, red), Fuel (FUEL) and a Track + weather tile pair. The first
// element is always the RACE_BG backplate rect.

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

const W = 1024
const H = 600

// ── Shared authoring helpers ─────────────────────────────────────────────────
// Small factories that guarantee the mandatory bindings / labels / accents stay
// correct across all twenty layouts; each preset varies only the geometry and the
// optional strategic clusters it composes, so every layout stays visually
// distinct while the mandatory contract is centralised here.

// MANDATORY first element on every dashboard: the pure-black backplate.
function bg(): DashboardElement {
  return w('rect', 0, 0, W, H, { background: RACE_BG, borderWidth: 0, radius: 0 }, { name: 'Backplate' })
}

// The prominent DELTA to the car behind — the strategic heart of a defend dash.
function behind(x: number, y: number, width: number, height: number, max = 120, accent = AMBER): DashboardElement {
  return cv('gapBehindFmt', x, y, width, height, 'BEHIND', { accentColor: accent, minFontSize: 28, maxFontSize: max })
}

// Projected / estimated lap pace.
function pace(x: number, y: number, width: number, height: number, max = 64): DashboardElement {
  return cv('estLapFmt', x, y, width, height, 'PACE', { accentColor: CYAN, minFontSize: 18, maxFontSize: max })
}

// Delta to the session-best lap (green = up on the benchmark).
function sessBest(x: number, y: number, width: number, height: number, max = 50): DashboardElement {
  return cv('deltaSessionBestFmt', x, y, width, height, 'SESS BEST', { accentColor: GREEN, minFontSize: 16, maxFontSize: max })
}

function lastLap(x: number, y: number, width: number, height: number, max = 50): DashboardElement {
  return cv('lastLapFmt', x, y, width, height, 'LAST', { accentColor: TEXT, minFontSize: 16, maxFontSize: max })
}

function bestLap(x: number, y: number, width: number, height: number, max = 48): DashboardElement {
  return cv('bestLapFmt', x, y, width, height, 'BEST', { accentColor: MUTED, minFontSize: 15, maxFontSize: max })
}

// MANDATORY Position readout (POS, amber).
function pos(x: number, y: number, width: number, height: number, max = 60): DashboardElement {
  return cv('position', x, y, width, height, 'POS', { accentColor: AMBER, minFontSize: 20, maxFontSize: max })
}

// MANDATORY Incidents readout (INC, red).
function inc(x: number, y: number, width: number, height: number, max = 56): DashboardElement {
  return cv('incidentCount', x, y, width, height, 'INC', { accentColor: RED, minFontSize: 18, maxFontSize: max })
}

// MANDATORY Fuel readout (FUEL).
function fuel(x: number, y: number, width: number, height: number, max = 48): DashboardElement {
  return cv('fuelLitersStr', x, y, width, height, 'FUEL', { accentColor: AMBER, minFontSize: 16, maxFontSize: max })
}

function speed(x: number, y: number, width: number, height: number, max = 72): DashboardElement {
  return cv('speedKmh', x, y, width, height, '', { fontFamily: FONT_NUM, suffix: 'km/h', minFontSize: 22, maxFontSize: max })
}

// MANDATORY weather tile (track/air/wet/grip condition).
function weatherTile(x: number, y: number, width: number, height: number, accent = CYAN, max = 24): DashboardElement {
  return w(
    'weather',
    x,
    y,
    width,
    height,
    style({ title: 'TRACK', background: 'transparent', borderWidth: 0, radius: 8, accentColor: accent, maxFontSize: max }),
    { name: 'Weather' }
  )
}

// MANDATORY track-temperature tile (pairs with the weather widget).
function trackTemp(
  x: number,
  y: number,
  width: number,
  height: number,
  binding = 'trackTempC',
  label = 'TRK°',
  accent = CYAN,
  max = 42
): DashboardElement {
  return cv(binding, x, y, width, height, label, { accentColor: accent, suffix: '°', minFontSize: 14, maxFontSize: max })
}

// MANDATORY MAP — clean interactive track map.
function mapClean(x: number, y: number, width: number, height: number, accent = CYAN): DashboardElement {
  return w(
    'trackmap-clean',
    x,
    y,
    width,
    height,
    style({ background: 'transparent', borderWidth: 0, radius: 0, accentColor: accent, color: MUTED, showIcon: false }),
    { binding: 'lapDistPct', name: 'TrackMap' }
  )
}

// MANDATORY MAP — compact loop progress mini-map.
function mapMini(x: number, y: number, width: number, height: number, accent = CYAN): DashboardElement {
  return w('trackmini', x, y, width, height, style({ radius: 8, accentColor: accent }), { binding: 'lapDistPct', name: 'TrackProgress' })
}

// Relatives strip highlighting the car behind (clean variant).
function relClean(x: number, y: number, width: number, height: number, accent = AMBER, min = 13, max = 26): DashboardElement {
  return w(
    'relatives-clean',
    x,
    y,
    width,
    height,
    style({ background: 'transparent', borderWidth: 0, radius: 0, accentColor: accent, reference: 'BEHIND', showIcon: false, minFontSize: min, maxFontSize: max }),
    { name: 'RelativesBehind' }
  )
}

// Relatives strip highlighting the car behind (elaborate name/gap/last variant).
function relElab(x: number, y: number, width: number, height: number, accent = AMBER, min = 13, max = 26): DashboardElement {
  return w(
    'relatives-elaborate',
    x,
    y,
    width,
    height,
    style({ radius: 6, accentColor: accent, reference: 'NAME / GAP / LAST', minFontSize: min, maxFontSize: max }),
    { name: 'RelativesBehind' }
  )
}

function radar(x: number, y: number, width: number, height: number, accent = CYAN): DashboardElement {
  return w(
    'radar-clean',
    x,
    y,
    width,
    height,
    style({ background: 'transparent', borderWidth: 0, radius: 0, accentColor: accent, showIcon: false }),
    { name: 'Radar' }
  )
}

// ── 1) Leader Wide ────────────────────────────────────────────────────────────
function createLeaderWidePreset(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(16, 12, 992, 22, 24),
    relClean(16, 48, 336, 176, AMBER, 14, 26),
    pos(16, 236, 160, 96, 56),
    inc(192, 236, 160, 96, 56),
    heroGear(376, 44, 272, 300),
    speed(376, 352, 272, 84, 60),
    behind(672, 48, 336, 150, 120, AMBER),
    pace(672, 210, 160, 122, 64),
    sessBest(848, 210, 160, 122, 48),
    hairline(16, 448, 992, 1),
    mapClean(16, 456, 200, 130, CYAN),
    lastLap(232, 456, 150, 130, 48),
    bestLap(392, 456, 150, 130, 44),
    fuel(552, 456, 140, 130, 46),
    weatherTile(702, 456, 150, 130, CYAN, 24),
    trackTemp(862, 456, 146, 130, 'trackTempC', 'TRK°', CYAN, 40)
  ]
  return dashboard(
    'Race First · Leader Wide',
    W,
    H,
    'Leader / defend dash: big central gear, a dominant BEHIND gap top-right, projected PACE and session-best delta, plus a behind-focused relatives rail on the left.',
    elements
  )
}

// ── 2) Defend Split ───────────────────────────────────────────────────────────
function createDefendSplitPreset(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(16, 12, 992, 20, 22),
    behind(16, 40, 320, 150, 110, AMBER),
    relElab(16, 200, 320, 250, AMBER, 13, 26),
    pos(16, 462, 152, 120, 56),
    inc(184, 462, 152, 120, 56),
    heroGear(356, 70, 300, 320),
    speed(356, 398, 300, 70, 56),
    pace(676, 40, 332, 120, 72),
    sessBest(676, 172, 160, 110, 48),
    lastLap(844, 172, 164, 110, 46),
    bestLap(676, 294, 160, 100, 44),
    fuel(844, 294, 164, 100, 46),
    mapMini(676, 406, 100, 176, CYAN),
    weatherTile(786, 406, 110, 176, CYAN, 22),
    trackTemp(906, 406, 102, 176, 'airTempC', 'AIR°', CYAN, 40)
  ]
  return dashboard(
    'Race First · Defend Split',
    W,
    H,
    'Split leader dash: BEHIND gap and an elaborate behind-relatives fill the left third, the gear anchors the centre, and a lap/pace/fuel stack with mini map + weather sits right.',
    elements
  )
}

// ── 3) Behind Hero ────────────────────────────────────────────────────────────
function createBehindHeroPreset(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(24, 14, 976, 26, 24),
    behind(150, 50, 724, 160, 150, AMBER),
    pos(24, 50, 110, 160, 64),
    inc(896, 50, 104, 78, 44),
    fuel(896, 132, 104, 78, 40),
    heroGear(400, 224, 224, 236),
    pace(24, 224, 168, 112, 60),
    sessBest(24, 344, 168, 116, 48),
    lastLap(832, 224, 168, 112, 48),
    bestLap(832, 344, 168, 116, 44),
    relClean(24, 474, 470, 112, AMBER, 13, 24),
    mapClean(506, 474, 150, 112, CYAN),
    speed(666, 474, 150, 112, 52),
    weatherTile(826, 474, 86, 112, CYAN, 20),
    trackTemp(918, 474, 82, 112, 'trackTempC', 'TRK°', CYAN, 34)
  ]
  return dashboard(
    'Race First · Behind Hero',
    W,
    H,
    'The gap to the car BEHIND is the giant full-width hero under the revlights; gear and pace flank below, with a behind-relatives strip, map, speed and track/weather across the base.',
    elements
  )
}

// ── 4) Pace Tower ─────────────────────────────────────────────────────────────
function createPaceTowerPreset(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(51, 24, 922, 28, 22),
    heroGear(60, 80, 260, 300),
    speed(60, 388, 260, 80, 60),
    relElab(340, 80, 300, 220, AMBER, 13, 26),
    pos(340, 312, 145, 90, 52),
    inc(495, 312, 145, 90, 52),
    pace(664, 80, 344, 150, 120),
    behind(664, 242, 344, 120, 90, AMBER),
    sessBest(664, 374, 170, 110, 48),
    bestLap(842, 374, 166, 110, 44),
    hairline(60, 496, 948, 1),
    fuel(60, 504, 180, 82, 44),
    lastLap(252, 504, 180, 82, 44),
    mapMini(444, 504, 120, 82, CYAN),
    weatherTile(576, 504, 150, 82, CYAN, 22),
    trackTemp(738, 504, 130, 82, 'trackTempC', 'TRK°', CYAN, 36),
    cv('sessionTimeLeftFmt', 880, 504, 128, 82, 'TIME', { accentColor: TEXT, minFontSize: 16, maxFontSize: 34 })
  ]
  return dashboard(
    'Race First · Pace Tower',
    W,
    H,
    'Pace-led leader dash: a tall right tower stacks projected PACE over the BEHIND gap, session-best and best lap; gear + speed left, behind-relatives centre, tiles along the base.',
    elements
  )
}

// ── 5) Mirror Left (gear right) ───────────────────────────────────────────────
function createMirrorLeftPreset(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(16, 12, 992, 22, 24),
    heroGear(700, 60, 280, 320),
    speed(700, 388, 280, 80, 60),
    behind(16, 52, 360, 160, 130, AMBER),
    relClean(16, 224, 360, 180, AMBER, 14, 26),
    pos(16, 416, 116, 80, 50),
    inc(138, 416, 116, 80, 50),
    fuel(260, 416, 116, 80, 44),
    pace(392, 60, 290, 120, 64),
    sessBest(392, 192, 290, 110, 48),
    lastLap(392, 314, 140, 110, 46),
    bestLap(538, 314, 144, 110, 44),
    mapClean(392, 436, 140, 150, CYAN),
    weatherTile(538, 436, 144, 150, CYAN, 22),
    trackTemp(16, 508, 360, 78, 'airTempC', 'AIR°', CYAN, 40)
  ]
  return dashboard(
    'Race First · Mirror Left',
    W,
    H,
    'Mirror layout with the gear anchored right: the BEHIND gap and a behind-relatives block dominate the left "mirror", with pace, session-best and lap times threaded up the centre.',
    elements
  )
}

// ── 6) Mirror Right (gear left) ───────────────────────────────────────────────
function createMirrorRightPreset(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(16, 12, 992, 22, 24),
    heroGear(44, 60, 280, 320),
    speed(44, 388, 280, 80, 60),
    pace(340, 60, 300, 120, 64),
    sessBest(340, 192, 300, 110, 48),
    mapClean(340, 314, 140, 150, CYAN),
    weatherTile(486, 314, 154, 150, CYAN, 22),
    behind(660, 52, 348, 160, 130, AMBER),
    relElab(660, 224, 348, 190, AMBER, 13, 26),
    pos(660, 424, 110, 78, 50),
    inc(779, 424, 110, 78, 50),
    fuel(898, 424, 110, 78, 44),
    lastLap(340, 476, 150, 110, 46),
    bestLap(496, 476, 144, 110, 44),
    trackTemp(660, 512, 348, 74, 'trackTempC', 'TRK°', CYAN, 40)
  ]
  return dashboard(
    'Race First · Mirror Right',
    W,
    H,
    'Gear anchored left; the entire right column becomes the defend "mirror" — a big BEHIND gap over an elaborate behind-relatives list, with POS/INC/FUEL and a track band underneath.',
    elements
  )
}

// ── 7) Predictor ──────────────────────────────────────────────────────────────
function createPredictorPreset(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(24, 14, 976, 26, 24),
    heroGear(400, 60, 224, 260),
    speed(400, 330, 224, 74, 56),
    w(
      'pred-caught-behind-futuristic',
      664,
      52,
      344,
      150,
      style({ radius: 12, accentColor: AMBER, label: 'THREAT BEHIND', maxFontSize: 40 }),
      { name: 'ThreatBehind' }
    ),
    behind(664, 214, 170, 120, 80, AMBER),
    pace(838, 214, 170, 120, 64),
    w(
      'pred-pace-minimal',
      664,
      346,
      344,
      90,
      style({ radius: 10, accentColor: CYAN, label: 'PROJECTED PACE', maxFontSize: 30 }),
      { name: 'ProjPace' }
    ),
    relClean(24, 52, 360, 200, AMBER, 14, 26),
    pos(24, 264, 116, 80, 50),
    inc(146, 264, 116, 80, 50),
    fuel(268, 264, 116, 80, 44),
    sessBest(24, 352, 180, 84, 44),
    lastLap(210, 352, 174, 84, 44),
    hairline(24, 450, 976, 1),
    mapClean(24, 458, 200, 128, CYAN),
    bestLap(232, 458, 160, 128, 44),
    weatherTile(400, 458, 160, 128, CYAN, 24),
    trackTemp(568, 458, 150, 128, 'trackTempC', 'TRK°', CYAN, 40),
    cv('sessionTimeLeftFmt', 726, 458, 282, 128, 'TIME LEFT', { accentColor: TEXT, minFontSize: 18, maxFontSize: 52 })
  ]
  return dashboard(
    'Race First · Predictor',
    W,
    H,
    'Predictive defend dash: a "threat behind" predictor and projected-pace widget frame the exact BEHIND gap and PACE numbers, backed by a behind-relatives block and full base tiles.',
    elements
  )
}

// ── 8) Relatives Rail (left rail) ─────────────────────────────────────────────
function createRelativesRailPreset(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(24, 14, 976, 24, 24),
    relElab(24, 50, 300, 536, AMBER, 14, 30),
    heroGear(360, 60, 300, 320),
    speed(360, 388, 300, 80, 60),
    pos(360, 478, 96, 108, 48),
    inc(462, 478, 96, 108, 48),
    fuel(564, 478, 96, 108, 44),
    behind(684, 50, 324, 150, 120, AMBER),
    pace(684, 212, 160, 120, 64),
    sessBest(852, 212, 156, 120, 48),
    lastLap(684, 344, 160, 110, 46),
    bestLap(852, 344, 156, 110, 44),
    mapMini(684, 466, 100, 120, CYAN),
    weatherTile(792, 466, 108, 120, CYAN, 22),
    trackTemp(908, 466, 100, 120, 'trackTempC', 'TRK°', CYAN, 34)
  ]
  return dashboard(
    'Race First · Relatives Rail',
    W,
    H,
    'A full-height behind-relatives rail on the left keeps every chasing car in view; gear + speed centre, and the BEHIND gap / pace / lap-time / map cluster stacks down the right.',
    elements
  )
}

// ── 9) Elaborate Right (right rail) ───────────────────────────────────────────
function createElaborateRightPreset(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(24, 14, 976, 24, 24),
    relElab(700, 50, 308, 536, AMBER, 14, 30),
    heroGear(44, 60, 300, 320),
    speed(44, 388, 300, 80, 60),
    behind(360, 50, 320, 150, 120, AMBER),
    pace(360, 212, 155, 120, 64),
    sessBest(525, 212, 155, 120, 48),
    lastLap(360, 344, 155, 110, 46),
    bestLap(525, 344, 155, 110, 44),
    mapClean(360, 466, 120, 120, CYAN),
    weatherTile(486, 466, 110, 120, CYAN, 20),
    trackTemp(602, 466, 78, 120, 'trackTempC', 'TRK°', CYAN, 32),
    pos(44, 478, 96, 108, 48),
    inc(146, 478, 96, 108, 48),
    fuel(248, 478, 96, 108, 44)
  ]
  return dashboard(
    'Race First · Elaborate Right',
    W,
    H,
    'Gear left, a full-height elaborate behind-relatives rail right, and a central defend column: BEHIND gap over pace, session-best and lap times with a compact map + track/weather.',
    elements
  )
}

// ── 10) Bottom Band ───────────────────────────────────────────────────────────
function createBottomBandPreset(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(16, 12, 992, 26, 24),
    heroGear(392, 48, 240, 240),
    speed(392, 296, 240, 78, 58),
    behind(16, 48, 360, 150, 120, AMBER),
    relClean(16, 210, 360, 150, AMBER, 13, 24),
    pace(664, 48, 344, 120, 72),
    sessBest(664, 180, 170, 90, 44),
    lastLap(838, 180, 170, 90, 44),
    bestLap(664, 278, 170, 84, 44),
    cv('deltaSec', 838, 278, 170, 84, 'DELTA', { accentColor: GREEN, minFontSize: 18, maxFontSize: 44 }),
    hairline(16, 384, 992, 1),
    pos(16, 392, 120, 120, 56),
    inc(148, 392, 120, 120, 56),
    fuel(280, 392, 120, 120, 48),
    mapClean(412, 392, 180, 120, CYAN),
    weatherTile(604, 392, 150, 120, CYAN, 24),
    trackTemp(766, 392, 120, 120, 'trackTempC', 'TRK°', CYAN, 40),
    cv('sessionTimeLeftFmt', 898, 392, 110, 120, 'TIME', { accentColor: TEXT, minFontSize: 16, maxFontSize: 40 }),
    cv('lapsRemaining', 16, 520, 150, 66, 'LAPS', { accentColor: TEXT, minFontSize: 16, maxFontSize: 34 }),
    cv('gapAheadFmt', 176, 520, 180, 66, 'AHEAD', { accentColor: GREEN, minFontSize: 16, maxFontSize: 34 }),
    w('flagoverlay', 372, 520, 636, 66, style({ compact: true, includeIncidents: true, radius: 8, accentColor: AMBER }), { name: 'FlagStrip' })
  ]
  return dashboard(
    'Race First · Bottom Band',
    W,
    H,
    'Compact gear + speed up top with the BEHIND gap and behind-relatives left, a pace/delta stack right, and a wide instrument band (POS/INC/FUEL, map, track/weather, clock, flags).',
    elements
  )
}

// ── 11) Trackmini Corner ──────────────────────────────────────────────────────
function createTrackminiCornerPreset(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(24, 14, 976, 24, 24),
    heroGear(392, 60, 240, 260),
    speed(392, 330, 240, 74, 56),
    behind(672, 52, 336, 160, 130, AMBER),
    radar(672, 224, 160, 180, CYAN),
    pace(844, 224, 164, 90, 52),
    sessBest(844, 322, 164, 82, 44),
    relClean(24, 52, 352, 200, AMBER, 14, 26),
    pos(24, 264, 112, 80, 50),
    inc(144, 264, 112, 80, 50),
    fuel(264, 264, 112, 80, 44),
    lastLap(24, 352, 172, 84, 44),
    bestLap(204, 352, 172, 84, 44),
    hairline(24, 450, 976, 1),
    mapMini(24, 458, 150, 128, CYAN),
    weatherTile(184, 458, 150, 128, CYAN, 24),
    trackTemp(342, 458, 140, 128, 'airTempC', 'AIR°', CYAN, 40),
    cv('sessionTimeLeftFmt', 490, 458, 200, 128, 'TIME LEFT', { accentColor: TEXT, minFontSize: 18, maxFontSize: 52 }),
    cv('deltaSec', 698, 458, 150, 128, 'DELTA', { accentColor: GREEN, minFontSize: 18, maxFontSize: 56 }),
    cv('gapAheadFmt', 856, 458, 152, 128, 'AHEAD', { accentColor: GREEN, minFontSize: 18, maxFontSize: 52 })
  ]
  return dashboard(
    'Race First · Trackmini Corner',
    W,
    H,
    'Spatial defend dash: a proximity radar sits under the BEHIND gap so you can see the chaser close up, with a mini progress map in the corner and behind-relatives + laps on the left.',
    elements
  )
}

// ── 12) Gap Stack ─────────────────────────────────────────────────────────────
function createGapStackPreset(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(16, 12, 992, 22, 24),
    behind(392, 48, 240, 150, 110, AMBER),
    pace(392, 206, 240, 110, 60),
    sessBest(392, 324, 240, 90, 44),
    heroGear(40, 60, 320, 360),
    speed(40, 430, 320, 80, 60),
    relElab(664, 48, 344, 230, AMBER, 13, 26),
    lastLap(664, 290, 170, 100, 46),
    bestLap(838, 290, 170, 100, 44),
    pos(664, 402, 110, 84, 50),
    inc(783, 402, 110, 84, 50),
    fuel(902, 402, 106, 84, 44),
    hairline(392, 500, 616, 1),
    mapClean(392, 424, 110, 160, CYAN),
    weatherTile(510, 424, 122, 160, CYAN, 22),
    trackTemp(664, 500, 344, 84, 'trackTempC', 'TRK°', CYAN, 44)
  ]
  return dashboard(
    'Race First · Gap Stack',
    W,
    H,
    'A vertical defend stack down the middle — BEHIND gap over PACE over session-best — beside a dominant gear/speed; behind-relatives and lap times fill the right, map + track below.',
    elements
  )
}

// ── 13) Endurance Lead ────────────────────────────────────────────────────────
function createEnduranceLeadPreset(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(16, 10, 992, 20, 22),
    w('flagoverlay', 16, 40, 992, 30, style({ compact: true, includeIncidents: true, radius: 6, accentColor: AMBER }), { name: 'FlagBanner' }),
    w('laptiming', 16, 80, 320, 150, style({ title: 'LAP / LAST / BEST', showCurrent: true, showLast: true, showBest: true, showEstimated: true, accentColor: CYAN }), { name: 'LapStack' }),
    relElab(352, 80, 320, 150, AMBER, 13, 26),
    lastLap(688, 80, 160, 72, 40),
    pace(688, 158, 160, 72, 44),
    bestLap(864, 80, 144, 72, 40),
    sessBest(864, 158, 144, 72, 44),
    behind(16, 246, 320, 182, 120, AMBER),
    heroGear(384, 240, 256, 196),
    speed(704, 246, 304, 90, 64),
    pos(704, 344, 96, 84, 48),
    inc(806, 344, 96, 84, 48),
    fuel(908, 344, 100, 84, 44),
    hairline(16, 432, 992, 1),
    mapClean(16, 440, 220, 146, CYAN),
    weatherTile(248, 440, 150, 146, CYAN, 24),
    trackTemp(410, 440, 130, 146, 'trackTempC', 'TRK°', CYAN, 40),
    w('positiongaps', 552, 440, 220, 146, style({ showTotal: true, accentColor: AMBER, minFontSize: 16, maxFontSize: 40 }), { name: 'PositionGaps' }),
    w('standings', 784, 440, 224, 146, style({ tableMaxRows: 4, highlightPlayer: true, tableColumns: ['pos', 'name', 'gap'], accentColor: AMBER }), { name: 'Standings' })
  ]
  return dashboard(
    'Race First · Endurance Lead',
    W,
    H,
    'Dense endurance leader page: lap-timing + behind-relatives + pace/best up top, the BEHIND gap and gear mid, and a base row of map, track/weather, position gaps and standings.',
    elements
  )
}

// ── 14) Sprint Lead ───────────────────────────────────────────────────────────
function createSprintLeadPreset(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(60, 30, 904, 34, 24),
    heroGear(392, 90, 240, 300),
    speed(392, 398, 240, 80, 60),
    behind(664, 110, 344, 150, 130, AMBER),
    pace(664, 272, 344, 110, 72),
    sessBest(664, 394, 344, 74, 44),
    relClean(60, 110, 300, 200, AMBER, 14, 28),
    pos(60, 326, 140, 90, 56),
    inc(220, 326, 140, 90, 56),
    hairline(60, 470, 904, 1),
    mapClean(60, 480, 180, 106, CYAN),
    fuel(252, 480, 140, 106, 48),
    lastLap(404, 480, 140, 106, 46),
    bestLap(556, 480, 140, 106, 44),
    weatherTile(708, 480, 130, 106, CYAN, 24),
    trackTemp(850, 480, 114, 106, 'trackTempC', 'TRK°', CYAN, 40)
  ]
  return dashboard(
    'Race First · Sprint Lead',
    W,
    H,
    'Lean sprint leader dash: dominant gear, a bold BEHIND gap with projected pace and session-best on the right, behind-relatives on the left and a single tidy row of race tiles.',
    elements
  )
}

// ── 15) Clean Center ──────────────────────────────────────────────────────────
function createCleanCenterPreset(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(60, 32, 904, 32, 24),
    cv('flagLabel', 16, 26, 40, 40, '', { accentColor: AMBER, minFontSize: 14, maxFontSize: 26 }),
    cv('pitLimiter', 968, 26, 40, 40, '', { accentColor: CYAN, minFontSize: 14, maxFontSize: 26 }),
    heroGear(390, 96, 244, 320),
    speed(60, 196, 300, 150, 140),
    relClean(60, 356, 300, 140, AMBER, 13, 24),
    pos(60, 504, 140, 80, 54),
    inc(208, 504, 152, 80, 54),
    fuel(390, 424, 244, 80, 44),
    behind(664, 96, 344, 130, 110, AMBER),
    pace(664, 232, 170, 96, 60),
    sessBest(838, 232, 170, 96, 48),
    lastLap(664, 334, 170, 90, 46),
    bestLap(838, 334, 170, 90, 44),
    mapMini(664, 430, 100, 150, CYAN),
    weatherTile(772, 430, 116, 150, CYAN, 22),
    trackTemp(896, 430, 112, 150, 'trackTempC', 'TRK°', CYAN, 34)
  ]
  return dashboard(
    'Race First · Clean Center',
    W,
    H,
    'Porsche-Cup-clean defend dash: one dominant central gear, big left speed, flag/limiter tells, a BEHIND gap and pace/lap column on the right, and behind-relatives lower-left.',
    elements
  )
}

// ── 16) Dual Delta ────────────────────────────────────────────────────────────
function createDualDeltaPreset(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(24, 14, 976, 24, 24),
    w('deltatile', 664, 50, 344, 200, style({ title: 'Δ SESSION', deltaReference: 'session', deltaRangeSec: 1, accentColor: GREEN }), { name: 'DeltaSession' }),
    behind(664, 262, 344, 110, 90, AMBER),
    heroGear(392, 60, 240, 260),
    speed(392, 330, 240, 74, 56),
    relElab(24, 50, 352, 220, AMBER, 13, 26),
    pos(24, 282, 116, 80, 50),
    inc(146, 282, 116, 80, 50),
    fuel(268, 282, 116, 80, 44),
    pace(24, 370, 180, 84, 52),
    sessBest(210, 370, 166, 84, 44),
    hairline(24, 462, 976, 1),
    mapClean(24, 470, 200, 116, CYAN),
    lastLap(232, 470, 160, 116, 48),
    bestLap(400, 470, 160, 116, 44),
    weatherTile(568, 470, 150, 116, CYAN, 24),
    trackTemp(726, 470, 130, 116, 'trackTempC', 'TRK°', CYAN, 40),
    cv('sessionTimeLeftFmt', 864, 470, 144, 116, 'TIME', { accentColor: TEXT, minFontSize: 16, maxFontSize: 44 })
  ]
  return dashboard(
    'Race First · Dual Delta',
    W,
    H,
    'A big predictive session-delta tile sits over the BEHIND gap on the right, pairing your own pace/session-best on the left with an elaborate behind-relatives block and full base tiles.',
    elements
  )
}

// ── 17) Threat Radar ──────────────────────────────────────────────────────────
function createThreatRadarPreset(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(24, 14, 976, 24, 24),
    behind(24, 52, 320, 170, 140, AMBER),
    relElab(24, 232, 320, 240, AMBER, 13, 26),
    pos(24, 482, 150, 104, 56),
    inc(178, 482, 166, 104, 56),
    heroGear(364, 60, 280, 300),
    speed(364, 368, 280, 74, 56),
    fuel(364, 446, 280, 68, 44),
    mapMini(364, 522, 280, 64, CYAN),
    radar(664, 52, 344, 220, CYAN),
    pace(664, 284, 170, 90, 52),
    sessBest(838, 284, 170, 90, 44),
    lastLap(664, 384, 170, 84, 44),
    bestLap(838, 384, 170, 84, 44),
    weatherTile(664, 478, 160, 108, CYAN, 24),
    trackTemp(832, 478, 176, 108, 'trackTempC', 'TRK°', CYAN, 42)
  ]
  return dashboard(
    'Race First · Threat Radar',
    W,
    H,
    'Awareness-first defend dash: the BEHIND gap and behind-relatives own the left, a large proximity radar tracks the chaser on the right, and gear/speed/fuel/map hold the centre.',
    elements
  )
}

// ── 18) P1 Console ────────────────────────────────────────────────────────────
function createP1ConsolePreset(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(16, 10, 992, 18, 22),
    w('standings', 16, 40, 320, 300, style({ tableMaxRows: 8, highlightPlayer: true, tableColumns: ['pos', 'name', 'gap'], accentColor: AMBER }), { name: 'Standings' }),
    relElab(16, 350, 320, 150, AMBER, 13, 24),
    pos(16, 510, 150, 76, 50),
    inc(178, 510, 158, 76, 50),
    heroGear(360, 60, 280, 240),
    speed(360, 308, 280, 72, 56),
    fuel(360, 388, 280, 72, 44),
    mapClean(360, 468, 280, 118, CYAN),
    behind(664, 40, 344, 150, 120, AMBER),
    pace(664, 202, 170, 100, 64),
    sessBest(838, 202, 170, 100, 48),
    lastLap(664, 312, 170, 90, 46),
    bestLap(838, 312, 170, 90, 44),
    w('positiongaps', 664, 414, 344, 60, style({ showTotal: true, accentColor: AMBER, minFontSize: 16, maxFontSize: 34 }), { name: 'PositionGaps' }),
    weatherTile(664, 486, 166, 100, CYAN, 24),
    trackTemp(838, 486, 170, 100, 'trackTempC', 'TRK°', CYAN, 42)
  ]
  return dashboard(
    'Race First · P1 Console',
    W,
    H,
    'A leader "console": live standings and behind-relatives left, gear/fuel/map centre, and the BEHIND gap with pace, session-best, lap times and position gaps stacked on the right.',
    elements
  )
}

// ── 19) Minimal Defend ────────────────────────────────────────────────────────
function createMinimalDefendPreset(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(160, 40, 704, 20, 20),
    heroGear(412, 90, 200, 240),
    speed(412, 338, 200, 64, 52),
    behind(120, 110, 320, 150, 120, AMBER),
    pace(120, 272, 320, 90, 60),
    relClean(584, 110, 320, 150, AMBER, 14, 26),
    sessBest(584, 272, 320, 84, 48),
    bestLap(584, 366, 320, 44, 34),
    hairline(120, 420, 784, 1),
    pos(120, 436, 140, 120, 60),
    inc(276, 436, 140, 120, 60),
    fuel(432, 436, 160, 120, 52),
    mapMini(608, 436, 120, 120, CYAN),
    weatherTile(744, 436, 80, 120, CYAN, 20),
    trackTemp(840, 436, 120, 120, 'trackTempC', 'TRK°', CYAN, 36)
  ]
  return dashboard(
    'Race First · Minimal Defend',
    W,
    H,
    'Restrained, generously spaced defend dash: a centred gear, the BEHIND gap and pace on the left, a behind-relatives + session-best block on the right, and one quiet row of essentials.',
    elements
  )
}

// ── 20) Strategist ────────────────────────────────────────────────────────────
function createStrategistPreset(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(16, 12, 992, 22, 24),
    heroGear(704, 70, 280, 300),
    speed(704, 378, 280, 80, 60),
    behind(16, 48, 340, 160, 130, AMBER),
    relElab(16, 220, 340, 220, AMBER, 13, 26),
    pace(16, 452, 170, 134, 72),
    sessBest(198, 452, 158, 134, 48),
    w('laptiming', 372, 48, 312, 160, style({ title: 'LAP / LAST / BEST', showCurrent: true, showLast: true, showBest: true, showEstimated: true, accentColor: CYAN }), { name: 'LapStack' }),
    lastLap(372, 220, 150, 90, 46),
    bestLap(534, 220, 150, 90, 44),
    pos(372, 322, 96, 84, 48),
    inc(474, 322, 96, 84, 48),
    fuel(576, 322, 108, 84, 44),
    mapClean(372, 418, 150, 168, CYAN),
    weatherTile(534, 418, 150, 168, CYAN, 24),
    trackTemp(704, 468, 280, 118, 'trackTempC', 'TRK°', CYAN, 44)
  ]
  return dashboard(
    'Race First · Strategist',
    W,
    H,
    'Strategy-desk defend dash: the BEHIND gap, behind-relatives and pace/session-best own the left, a lap-timing + times/POS/INC/FUEL/map grid fills the centre, gear anchors the right.',
    elements
  )
}

// ── Registry-shaped export (NOT wired into BUILTIN_PRESETS by this module) ─────
export const RACE_FIRST_PRESETS: Array<{ id: string; name: string; build: () => Dashboard; tags?: string[] }> = [
  { id: 'race-first-leader-wide', name: 'Race First · Leader Wide · 1024×600', build: createLeaderWidePreset, tags: ['race', 'first', 'lead', 'defend', 'behind', 'pace', 'relatives', 'motorsport'] },
  { id: 'race-first-defend-split', name: 'Race First · Defend Split · 1024×600', build: createDefendSplitPreset, tags: ['race', 'first', 'lead', 'defend', 'behind', 'split', 'relatives', 'motorsport'] },
  { id: 'race-first-behind-hero', name: 'Race First · Behind Hero · 1024×600', build: createBehindHeroPreset, tags: ['race', 'first', 'lead', 'defend', 'behind', 'hero', 'gap', 'motorsport'] },
  { id: 'race-first-pace-tower', name: 'Race First · Pace Tower · 1024×600', build: createPaceTowerPreset, tags: ['race', 'first', 'lead', 'defend', 'pace', 'behind', 'tower', 'motorsport'] },
  { id: 'race-first-mirror-left', name: 'Race First · Mirror Left · 1024×600', build: createMirrorLeftPreset, tags: ['race', 'first', 'lead', 'defend', 'behind', 'mirror', 'relatives', 'motorsport'] },
  { id: 'race-first-mirror-right', name: 'Race First · Mirror Right · 1024×600', build: createMirrorRightPreset, tags: ['race', 'first', 'lead', 'defend', 'behind', 'mirror', 'relatives', 'motorsport'] },
  { id: 'race-first-predictor', name: 'Race First · Predictor · 1024×600', build: createPredictorPreset, tags: ['race', 'first', 'lead', 'defend', 'behind', 'predictor', 'pace', 'motorsport'] },
  { id: 'race-first-relatives-rail', name: 'Race First · Relatives Rail · 1024×600', build: createRelativesRailPreset, tags: ['race', 'first', 'lead', 'defend', 'behind', 'relatives', 'rail', 'motorsport'] },
  { id: 'race-first-elaborate-right', name: 'Race First · Elaborate Right · 1024×600', build: createElaborateRightPreset, tags: ['race', 'first', 'lead', 'defend', 'behind', 'relatives', 'elaborate', 'motorsport'] },
  { id: 'race-first-bottom-band', name: 'Race First · Bottom Band · 1024×600', build: createBottomBandPreset, tags: ['race', 'first', 'lead', 'defend', 'behind', 'band', 'tiles', 'motorsport'] },
  { id: 'race-first-trackmini-corner', name: 'Race First · Trackmini Corner · 1024×600', build: createTrackminiCornerPreset, tags: ['race', 'first', 'lead', 'defend', 'behind', 'radar', 'trackmini', 'motorsport'] },
  { id: 'race-first-gap-stack', name: 'Race First · Gap Stack · 1024×600', build: createGapStackPreset, tags: ['race', 'first', 'lead', 'defend', 'behind', 'pace', 'stack', 'motorsport'] },
  { id: 'race-first-endurance-lead', name: 'Race First · Endurance Lead · 1024×600', build: createEnduranceLeadPreset, tags: ['race', 'first', 'lead', 'defend', 'behind', 'endurance', 'standings', 'motorsport'] },
  { id: 'race-first-sprint-lead', name: 'Race First · Sprint Lead · 1024×600', build: createSprintLeadPreset, tags: ['race', 'first', 'lead', 'defend', 'behind', 'sprint', 'minimal', 'motorsport'] },
  { id: 'race-first-clean-center', name: 'Race First · Clean Center · 1024×600', build: createCleanCenterPreset, tags: ['race', 'first', 'lead', 'defend', 'behind', 'clean', 'porsche', 'motorsport'] },
  { id: 'race-first-dual-delta', name: 'Race First · Dual Delta · 1024×600', build: createDualDeltaPreset, tags: ['race', 'first', 'lead', 'defend', 'behind', 'delta', 'session', 'motorsport'] },
  { id: 'race-first-threat-radar', name: 'Race First · Threat Radar · 1024×600', build: createThreatRadarPreset, tags: ['race', 'first', 'lead', 'defend', 'behind', 'radar', 'awareness', 'motorsport'] },
  { id: 'race-first-p1-console', name: 'Race First · P1 Console · 1024×600', build: createP1ConsolePreset, tags: ['race', 'first', 'lead', 'defend', 'behind', 'standings', 'console', 'motorsport'] },
  { id: 'race-first-minimal-defend', name: 'Race First · Minimal Defend · 1024×600', build: createMinimalDefendPreset, tags: ['race', 'first', 'lead', 'defend', 'behind', 'minimal', 'clean', 'motorsport'] },
  { id: 'race-first-strategist', name: 'Race First · Strategist · 1024×600', build: createStrategistPreset, tags: ['race', 'first', 'lead', 'defend', 'behind', 'pace', 'strategy', 'motorsport'] }
]

export const RACE_FIRST_PRESET_IDS: string[] = RACE_FIRST_PRESETS.map((p) => p.id)
