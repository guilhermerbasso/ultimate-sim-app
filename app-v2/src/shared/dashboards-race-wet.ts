// ─── RACE-WET dashboard catalogue (rain / low-grip conditions) ────────────────
// Twenty original 1024×600 race dashboards tuned for WET running. The wet theme
// puts TRACK CONDITIONS front-and-centre: track wetness + grip, track/air temps,
// tyre temperatures (which run cooler in the rain) and careful pace tells (delta
// + fuel). Cooler cyan/blue accents signal the wet; green is reserved ONLY for
// genuinely good states (a positive/faster delta), never as a static accent.
//
// This module is SELF-CONTAINED: it only imports the exported preset kit + colour
// tokens from `./dashboards` (one-way, no import cycle) and is NOT wired into the
// registry. Callers can import { RACE_WET_PRESETS } and spread/register them.
//
// Every dashboard is authored on the native 1024×600 canvas and carries the full
// mandatory kit: a segmented RevLights bar, a dominant hero gear, an interactive
// track map, position / incidents / fuel readouts and a track+weather cluster.

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
import type { Dashboard, DashboardElement, DashboardElementStyle, DashboardElementType } from './dashboards'

type S = Partial<DashboardElementStyle>

// ── Local element helpers (terse, correct, restyle-able per preset) ───────────

// Mandatory background plate — identical on every preset, always the first item.
function bg(): DashboardElement {
  return w('rect', 0, 0, 1024, 600, { background: RACE_BG, borderWidth: 0, radius: 0 }, { name: 'BG' })
}

function posTile(x: number, y: number, wd: number, hd: number, extra: S = {}): DashboardElement {
  return cv('position', x, y, wd, hd, 'POS', { accentColor: AMBER, minFontSize: 22, maxFontSize: 62, ...extra })
}

function incTile(x: number, y: number, wd: number, hd: number, extra: S = {}): DashboardElement {
  return cv('incidentCount', x, y, wd, hd, 'INC', { accentColor: RED, minFontSize: 22, maxFontSize: 62, ...extra })
}

function fuelTile(x: number, y: number, wd: number, hd: number, extra: S = {}): DashboardElement {
  return cv('fuelLitersStr', x, y, wd, hd, 'FUEL', { accentColor: CYAN, suffix: ' L', minFontSize: 20, maxFontSize: 52, ...extra })
}

function deltaTile(x: number, y: number, wd: number, hd: number, extra: S = {}): DashboardElement {
  // GREEN accent: the ONE cool→good tell — the renderer greens a positive delta.
  return cv('deltaSec', x, y, wd, hd, 'DELTA', { accentColor: GREEN, minFontSize: 22, maxFontSize: 58, ...extra })
}

// Track wetness (0..1) — the headline wet channel. Cyan/blue accent.
function wetTile(x: number, y: number, wd: number, hd: number, type: DashboardElementType = 'valuebar', extra: S = {}): DashboardElement {
  return cv('trackWetnessPct', x, y, wd, hd, 'WET', { accentColor: CYAN, decimals: 2, minFontSize: 16, maxFontSize: 46, ...extra }, type)
}

// Track grip (0..1) — pairs with wetness. Cyan/blue accent.
function gripTile(x: number, y: number, wd: number, hd: number, type: DashboardElementType = 'valuebar', extra: S = {}): DashboardElement {
  return cv('gripPct', x, y, wd, hd, 'GRIP', { accentColor: CYAN, decimals: 2, minFontSize: 16, maxFontSize: 46, ...extra }, type)
}

function trackTempTile(x: number, y: number, wd: number, hd: number, extra: S = {}): DashboardElement {
  return cv('trackTempC', x, y, wd, hd, 'TRACK', { accentColor: TEXT, suffix: '°', fontFamily: FONT_NUM, minFontSize: 20, maxFontSize: 52, ...extra })
}

function airTempTile(x: number, y: number, wd: number, hd: number, extra: S = {}): DashboardElement {
  return cv('airTempC', x, y, wd, hd, 'AIR', { accentColor: MUTED, suffix: '°', fontFamily: FONT_NUM, minFontSize: 20, maxFontSize: 52, ...extra })
}

function mapClean(x: number, y: number, wd: number, hd: number, extra: S = {}): DashboardElement {
  return w(
    'trackmap-clean',
    x,
    y,
    wd,
    hd,
    { background: 'transparent', borderWidth: 0, radius: 0, accentColor: CYAN, color: MUTED, showIcon: false, ...extra },
    { binding: 'lapDistPct', name: 'TrackMap' }
  )
}

function miniMap(x: number, y: number, wd: number, hd: number, extra: S = {}): DashboardElement {
  return w('trackmini', x, y, wd, hd, style({ radius: 10, accentColor: CYAN, ...extra }), { binding: 'lapDistPct', name: 'TrackProgress' })
}

// Tyre temperatures — 2×2 thermal grid. Wet thresholds run cooler than slicks.
function tyreTemps(x: number, y: number, wd: number, hd: number, extra: S = {}): DashboardElement {
  return w(
    'tyregrid',
    x,
    y,
    wd,
    hd,
    style({ gridMode: 'temp', title: 'TYRE °C', showLabels: true, accentColor: CYAN, coldAt: 50, optimalAt: 70, hotAt: 88, criticalAt: 102, ...extra }),
    { name: 'TyreTemps' }
  )
}

function weatherBox(x: number, y: number, wd: number, hd: number, extra: S = {}): DashboardElement {
  return w('weather', x, y, wd, hd, style({ title: 'TRACK', accentColor: CYAN, ...extra }), { name: 'Weather' })
}

// ── 01 · Classic condition strip ──────────────────────────────────────────────
function buildClassicStrip(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(48, 22, 928, 30, 26),
    heroGear(400, 84, 224, 300),
    posTile(32, 84, 160, 96),
    incTile(32, 190, 160, 96),
    fuelTile(32, 296, 160, 96),
    mapClean(832, 84, 160, 140),
    tyreTemps(832, 232, 160, 160),
    hairline(32, 452, 960, 1),
    wetTile(32, 470, 180, 108, 'valuebar'),
    gripTile(220, 470, 180, 108, 'valuebar'),
    trackTempTile(408, 470, 150, 108),
    airTempTile(566, 470, 150, 108),
    deltaTile(724, 470, 268, 108)
  ]
  return dashboard('Race Wet Classic Strip', 1024, 600, 'Wet-weather race dash: dominant central gear, position/incidents/fuel rail, track map and tyre temps right, and a full-width WET/GRIP/TRACK/AIR condition strip with predictive delta along the bottom.', elements)
}

// ── 02 · Left condition rail ──────────────────────────────────────────────────
function buildLeftRail(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(24, 20, 976, 26, 26),
    wetTile(24, 72, 200, 116, 'valuegauge'),
    gripTile(24, 196, 200, 116, 'valuegauge'),
    trackTempTile(24, 320, 200, 116),
    airTempTile(24, 444, 200, 132),
    heroGear(300, 80, 300, 330),
    tyreTemps(300, 446, 320, 130),
    deltaTile(636, 446, 168, 130),
    posTile(812, 72, 188, 92),
    incTile(812, 172, 188, 92),
    fuelTile(812, 272, 188, 92),
    miniMap(812, 372, 188, 110)
  ]
  return dashboard('Race Wet Left Rail', 1024, 600, 'Wet dash with a full-height left rail of wetness/grip gauges and track/air temps, a big central gear, tyre temps and delta beneath it, and a right column of position/incidents/fuel above a live track-progress map.', elements)
}

// ── 03 · Weather hero ─────────────────────────────────────────────────────────
function buildWeatherHero(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(40, 22, 944, 30, 24),
    heroGear(60, 80, 320, 330),
    weatherBox(640, 76, 360, 250, { maxFontSize: 40 }),
    wetTile(640, 334, 175, 96, 'valuegauge'),
    gripTile(823, 334, 177, 96, 'valuegauge'),
    posTile(40, 440, 150, 120),
    incTile(198, 440, 150, 120),
    fuelTile(356, 440, 150, 120),
    mapClean(514, 440, 150, 120),
    tyreTemps(672, 440, 328, 120)
  ]
  return dashboard('Race Wet Weather Hero', 1024, 600, 'Wet dash built around a large weather panel (track/air/wet/grip) with dedicated wetness and grip gauges below it, a bold left gear, and a bottom row of position/incidents/fuel, track map and tyre temps.', elements)
}

// ── 04 · Split telemetry / conditions ─────────────────────────────────────────
function buildSplit(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(30, 18, 964, 28, 26),
    hairline(512, 64, 1, 512),
    heroGear(120, 80, 280, 300),
    posTile(40, 392, 140, 90),
    incTile(190, 392, 140, 90),
    fuelTile(340, 392, 150, 90),
    deltaTile(40, 490, 220, 86),
    miniMap(280, 490, 210, 86),
    wetTile(536, 80, 220, 150, 'valuegauge'),
    gripTile(766, 80, 220, 150, 'valuegauge'),
    trackTempTile(536, 244, 220, 120),
    airTempTile(766, 244, 220, 120),
    tyreTemps(536, 378, 450, 190)
  ]
  return dashboard('Race Wet Split', 1024, 600, 'Wet dash split by a hairline: the left half is car telemetry (gear, position/incidents/fuel, delta, map) while the right half is pure condition awareness — wetness/grip gauges, track/air temps and a wide tyre-temp grid.', elements)
}

// ── 05 · Bottom dock ──────────────────────────────────────────────────────────
function buildBottomDock(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(40, 20, 944, 26, 24),
    heroGear(400, 60, 224, 240),
    posTile(40, 64, 150, 100),
    incTile(40, 172, 150, 100),
    fuelTile(834, 64, 150, 100),
    mapClean(834, 172, 150, 128),
    wetTile(24, 320, 180, 150, 'valuegauge'),
    gripTile(212, 320, 180, 150, 'valuegauge'),
    trackTempTile(400, 320, 150, 150),
    airTempTile(558, 320, 150, 150),
    tyreTemps(716, 320, 284, 150),
    deltaTile(24, 478, 300, 100),
    w('laptiming', 332, 478, 340, 100, style({ title: 'TIMING', showLast: true, showBest: true, accentColor: CYAN }), { name: 'LapTiming' }),
    weatherBox(680, 478, 320, 100, { maxFontSize: 30 })
  ]
  return dashboard('Race Wet Bottom Dock', 1024, 600, 'Wet dash with a compact top cluster (gear, position/incidents, fuel, map) over a deep two-tier bottom dock: wetness/grip gauges, track/air temps and tyre temps up top, delta, lap timing and a weather panel below.', elements)
}

// ── 06 · Four corners ─────────────────────────────────────────────────────────
function buildCorners(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(260, 28, 504, 24, 20),
    wetTile(24, 24, 220, 150, 'valuegauge'),
    gripTile(780, 24, 220, 150, 'valuegauge'),
    trackTempTile(24, 426, 220, 150),
    airTempTile(780, 426, 220, 150),
    heroGear(402, 150, 220, 300),
    posTile(262, 150, 130, 90),
    incTile(262, 250, 130, 90),
    fuelTile(262, 350, 130, 90),
    miniMap(632, 150, 130, 110),
    tyreTemps(632, 270, 140, 170)
  ]
  return dashboard('Race Wet Corners', 1024, 600, 'Symmetric wet dash: wetness and grip gauges in the top corners, track and air temps in the bottom corners, a centred gear flanked by a position/incidents/fuel column and a track-progress map over tyre temps.', elements)
}

// ── 07 · Tyre focus ───────────────────────────────────────────────────────────
function buildTyreFocus(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(40, 20, 944, 28, 24),
    w('tyres-elaborate', 24, 74, 380, 300, style({ accentColor: CYAN, coldAt: 50, optimalAt: 70, hotAt: 88, criticalAt: 102, maxFontSize: 40 }), { name: 'TyresHero' }),
    heroGear(430, 80, 280, 300),
    posTile(760, 74, 224, 72),
    incTile(760, 152, 224, 72),
    fuelTile(760, 230, 224, 72),
    deltaTile(760, 308, 224, 72),
    wetTile(24, 388, 222, 184, 'valuegauge'),
    gripTile(254, 388, 222, 184, 'valuegauge'),
    trackTempTile(484, 388, 150, 184),
    airTempTile(642, 388, 150, 184),
    mapClean(800, 388, 184, 184)
  ]
  return dashboard('Race Wet Tyre Focus', 1024, 600, 'Wet dash anchored on a large elaborate tyre-temp cluster (cool wet thresholds) with a central gear, a right column of position/incidents/fuel/delta, and a bottom band of wetness/grip gauges, track/air temps and the track map.', elements)
}

// ── 08 · Grip gauge hero ──────────────────────────────────────────────────────
function buildGripGauge(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(40, 22, 944, 26, 24),
    heroGear(60, 80, 260, 300),
    cv('gripPct', 360, 70, 300, 260, 'GRIP', { accentColor: CYAN, decimals: 2, minFontSize: 40, maxFontSize: 120 }, 'valuegauge'),
    cv('trackWetnessPct', 360, 338, 300, 90, 'WET', { accentColor: CYAN, decimals: 2, minFontSize: 20, maxFontSize: 56 }, 'valuebar'),
    posTile(720, 70, 280, 84),
    incTile(720, 162, 280, 84),
    fuelTile(720, 254, 280, 84),
    mapClean(720, 346, 280, 90),
    trackTempTile(60, 440, 220, 130),
    airTempTile(288, 440, 220, 130),
    tyreTemps(516, 440, 300, 130),
    deltaTile(824, 440, 176, 130)
  ]
  return dashboard('Race Wet Grip Gauge', 1024, 600, 'Wet dash headlined by a big grip arc with a wetness bar beneath it, a left gear, a right column of position/incidents/fuel over the map, and a bottom row of track/air temps, tyre temps and delta.', elements)
}

// ── 09 · Minimal ──────────────────────────────────────────────────────────────
function buildMinimal(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(112, 30, 800, 18, 20),
    heroGear(372, 90, 280, 320),
    wetTile(60, 120, 240, 70, 'valuebar'),
    gripTile(724, 120, 240, 70, 'valuebar'),
    deltaTile(60, 220, 240, 120),
    miniMap(724, 220, 240, 120),
    posTile(40, 470, 140, 90),
    incTile(188, 470, 140, 90),
    fuelTile(336, 470, 150, 90),
    trackTempTile(494, 470, 140, 90),
    airTempTile(642, 470, 140, 90),
    tyreTemps(790, 470, 210, 90, { showLabels: false })
  ]
  return dashboard('Race Wet Minimal', 1024, 600, 'Restrained wet dash: a big central gear, wetness and grip bars in the upper corners, delta and a track-progress map mid-height, and a single quiet bottom row of position, incidents, fuel, track/air temps and compact tyre temps.', elements)
}

// ── 10 · Endurance ────────────────────────────────────────────────────────────
function buildEndurance(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(20, 14, 984, 34, 22),
    w('fuelstint', 20, 64, 300, 150, style({ title: 'STINT FUEL', enduranceMode: true, reserveLaps: 2, warnAtLaps: 3, accentColor: CYAN }), { name: 'StintFuel' }),
    w('laptiming', 340, 64, 344, 150, style({ title: 'LAP / LAST / BEST', showCurrent: true, showLast: true, showBest: true, accentColor: CYAN }), { name: 'LapTiming' }),
    weatherBox(704, 64, 300, 150, { maxFontSize: 34 }),
    wetTile(20, 224, 145, 100, 'valuegauge'),
    gripTile(175, 224, 145, 100, 'valuegauge'),
    trackTempTile(20, 334, 145, 100),
    airTempTile(175, 334, 145, 100),
    heroGear(360, 224, 304, 220),
    posTile(704, 224, 144, 100),
    incTile(858, 224, 142, 100),
    fuelTile(704, 334, 144, 100),
    deltaTile(858, 334, 142, 100),
    tyreTemps(20, 452, 470, 124),
    mapClean(510, 452, 230, 124),
    w('relatives-clean', 760, 452, 240, 124, style({ background: 'transparent', borderWidth: 0, accentColor: AMBER, minFontSize: 13, maxFontSize: 24 }), { name: 'Relatives' })
  ]
  return dashboard('Race Wet Endurance', 1024, 600, 'Long-run wet dash: stint fuel, lap timing and a weather panel across the top, wetness/grip gauges and track/air temps left, a central gear with position/incidents/fuel/delta right, and tyre temps, map and relatives along the bottom.', elements)
}

// ── 11 · Right condition stack ────────────────────────────────────────────────
function buildRightStack(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(24, 20, 976, 26, 26),
    heroGear(120, 80, 300, 340),
    posTile(452, 80, 150, 100),
    incTile(452, 190, 150, 100),
    fuelTile(452, 300, 150, 100),
    deltaTile(452, 410, 150, 100),
    wetTile(636, 80, 170, 120, 'valuegauge'),
    gripTile(636, 208, 170, 120, 'valuegauge'),
    trackTempTile(636, 336, 170, 120),
    miniMap(636, 464, 170, 112),
    airTempTile(816, 80, 184, 120),
    tyreTemps(816, 208, 184, 248),
    weatherBox(816, 464, 184, 112, { maxFontSize: 24 })
  ]
  return dashboard('Race Wet Right Stack', 1024, 600, 'Wet dash with a big left gear and a central telemetry column (position/incidents/fuel/delta), backed by a twin right stack of condition modules: wetness/grip gauges, track/air temps, a map, tall tyre temps and a weather panel.', elements)
}

// ── 12 · Twin gauges flanking the gear ────────────────────────────────────────
function buildTwinGauge(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(40, 20, 944, 28, 24),
    cv('trackWetnessPct', 60, 110, 280, 260, 'WET', { accentColor: CYAN, decimals: 2, minFontSize: 36, maxFontSize: 110 }, 'valuegauge'),
    heroGear(392, 90, 240, 300),
    cv('gripPct', 684, 110, 280, 260, 'GRIP', { accentColor: CYAN, decimals: 2, minFontSize: 36, maxFontSize: 110 }, 'valuegauge'),
    posTile(40, 440, 150, 130),
    incTile(198, 440, 150, 130),
    fuelTile(356, 440, 150, 130),
    trackTempTile(514, 440, 150, 62),
    airTempTile(514, 508, 150, 62),
    tyreTemps(672, 440, 150, 130, { showLabels: false }),
    mapClean(830, 440, 154, 130)
  ]
  return dashboard('Race Wet Twin Gauge', 1024, 600, 'Wet dash with the gear centred between two oversized gauges — wetness left, grip right — and a bottom row of position/incidents/fuel, stacked track/air temps, tyre temps and the track map.', elements)
}

// ── 13 · HUD condition band ───────────────────────────────────────────────────
function buildHudBand(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(40, 18, 944, 26, 24),
    posTile(40, 60, 150, 100),
    incTile(40, 168, 150, 100),
    fuelTile(40, 276, 150, 100),
    wetTile(210, 70, 170, 300, 'valuegauge'),
    heroGear(400, 70, 224, 260),
    gripTile(644, 70, 170, 300, 'valuegauge'),
    mapClean(834, 60, 150, 150),
    deltaTile(834, 218, 150, 110),
    weatherBox(40, 392, 634, 184, { maxFontSize: 40 }),
    tyreTemps(690, 392, 294, 184)
  ]
  return dashboard('Race Wet HUD Band', 1024, 600, 'Wet dash with tall wetness/grip gauges flanking a central gear, a left column of position/incidents/fuel, map and delta right, and a wide bottom weather HUD band beside a big tyre-temp grid.', elements)
}

// ── 14 · Mono-cyan grid ───────────────────────────────────────────────────────
function buildMonoGrid(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(24, 16, 976, 24, 26),
    wetTile(24, 56, 190, 120, 'valuebar'),
    gripTile(222, 56, 190, 120, 'valuebar'),
    trackTempTile(420, 56, 184, 120),
    airTempTile(612, 56, 190, 120),
    mapClean(810, 56, 190, 120),
    posTile(24, 188, 150, 100),
    incTile(24, 296, 150, 100),
    heroGear(300, 188, 424, 210),
    fuelTile(850, 188, 150, 100),
    deltaTile(850, 296, 150, 100),
    tyreTemps(24, 410, 300, 166),
    w('laptiming', 332, 410, 340, 166, style({ title: 'TIMING', showCurrent: true, showLast: true, showBest: true, accentColor: CYAN }), { name: 'LapTiming' }),
    weatherBox(680, 410, 320, 166, { maxFontSize: 34 })
  ]
  return dashboard('Race Wet Mono Grid', 1024, 600, 'Grid-structured wet dash in a cool cyan palette: a top row of wetness/grip/track/air/map, a wide central gear flanked by position/incidents and fuel/delta, and a bottom row of tyre temps, lap timing and a weather panel.', elements)
}

// ── 15 · Delta focus ──────────────────────────────────────────────────────────
function buildDeltaFocus(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(40, 20, 944, 28, 24),
    heroGear(60, 80, 320, 340),
    tyreTemps(392, 80, 160, 354),
    cv('deltaSec', 560, 80, 420, 220, 'DELTA', { accentColor: GREEN, minFontSize: 48, maxFontSize: 150 }),
    wetTile(560, 314, 205, 120, 'valuegauge'),
    gripTile(775, 314, 205, 120, 'valuegauge'),
    posTile(40, 446, 150, 128),
    incTile(198, 446, 150, 128),
    fuelTile(356, 446, 150, 128),
    trackTempTile(514, 446, 150, 128),
    airTempTile(672, 446, 150, 128),
    mapClean(830, 446, 154, 128)
  ]
  return dashboard('Race Wet Delta Focus', 1024, 600, 'Pace-first wet dash: a huge predictive delta dominates the right with wetness/grip gauges under it, a left gear beside a tall tyre-temp column, and a full bottom row of position/incidents/fuel, track/air temps and the map.', elements)
}

// ── 16 · Track-map hero ───────────────────────────────────────────────────────
function buildTrackmapHero(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(40, 20, 944, 26, 24),
    heroGear(60, 70, 320, 320),
    posTile(392, 70, 158, 96),
    incTile(392, 174, 158, 96),
    fuelTile(392, 278, 158, 96),
    w('trackmap-elaborate', 560, 70, 430, 300, style({ background: 'transparent', borderWidth: 0, accentColor: CYAN, color: MUTED, showIcon: false }), { binding: 'lapDistPct', name: 'TrackMap' }),
    wetTile(40, 388, 210, 186, 'valuegauge'),
    gripTile(258, 388, 210, 186, 'valuegauge'),
    trackTempTile(476, 388, 150, 186),
    airTempTile(634, 388, 150, 186),
    tyreTemps(792, 388, 208, 186)
  ]
  return dashboard('Race Wet Trackmap Hero', 1024, 600, 'Wet dash featuring a large elaborate track map with a left gear and a position/incidents/fuel column, over a bottom band of wetness/grip gauges, track/air temps and tyre temps.', elements)
}

// ── 17 · Pit / strategy window ────────────────────────────────────────────────
function buildPitWindow(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(20, 14, 984, 30, 22),
    w('fuelstint', 20, 60, 320, 220, style({ title: 'FUEL / STINT', reserveLaps: 2, warnAtLaps: 3, accentColor: CYAN }), { name: 'FuelStint' }),
    heroGear(380, 66, 264, 238),
    w('laptiming', 700, 60, 304, 220, style({ title: 'PACE', showCurrent: true, showLast: true, showBest: true, showEstimated: true, accentColor: CYAN }), { name: 'LapTiming' }),
    wetTile(20, 316, 235, 132, 'valuegauge'),
    gripTile(263, 316, 235, 132, 'valuegauge'),
    fuelTile(506, 316, 150, 132),
    deltaTile(664, 316, 150, 132),
    posTile(822, 316, 178, 132),
    incTile(20, 456, 150, 120),
    trackTempTile(178, 456, 150, 120),
    airTempTile(336, 456, 150, 120),
    tyreTemps(494, 456, 300, 120),
    mapClean(802, 456, 198, 120)
  ]
  return dashboard('Race Wet Pit Window', 1024, 600, 'Strategy-oriented wet dash: fuel/stint and pace panels flank the gear up top, wetness/grip gauges with fuel/delta/position mid-board, and incidents, track/air temps, tyre temps and the map along the bottom.', elements)
}

// ── 18 · Quad panels ──────────────────────────────────────────────────────────
function buildQuadPanels(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(284, 40, 456, 22, 20),
    wetTile(24, 56, 240, 210, 'valuegauge'),
    gripTile(760, 56, 240, 210, 'valuegauge'),
    tyreTemps(24, 320, 240, 256),
    weatherBox(760, 320, 240, 256, { maxFontSize: 44 }),
    heroGear(400, 150, 224, 240),
    posTile(284, 150, 112, 110),
    incTile(284, 270, 112, 110),
    fuelTile(284, 390, 112, 110),
    miniMap(628, 150, 112, 110),
    deltaTile(628, 270, 112, 110),
    airTempTile(628, 390, 112, 110)
  ]
  return dashboard('Race Wet Quad Panels', 1024, 600, 'Four big corner panels — wetness and grip gauges up top, tyre temps and a weather panel below — frame a central gear with inner columns of position/incidents/fuel and map/delta/air temp.', elements)
}

// ── 19 · Compact cluster ──────────────────────────────────────────────────────
function buildCompactCluster(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(30, 16, 964, 22, 26),
    posTile(40, 60, 120, 72),
    incTile(40, 140, 120, 88),
    cv('speedKmh', 300, 70, 120, 140, 'KMH', { fontFamily: FONT_NUM, minFontSize: 28, maxFontSize: 72 }),
    heroGear(430, 48, 164, 180),
    deltaTile(604, 70, 150, 140),
    fuelTile(864, 60, 120, 72),
    miniMap(864, 140, 120, 88),
    wetTile(40, 244, 300, 150, 'valuegauge'),
    gripTile(352, 244, 300, 150, 'valuegauge'),
    weatherBox(664, 244, 320, 150, { maxFontSize: 34 }),
    trackTempTile(40, 404, 180, 170),
    airTempTile(232, 404, 180, 170),
    tyreTemps(424, 404, 340, 170),
    w('relatives-clean', 776, 404, 208, 170, style({ background: 'transparent', borderWidth: 0, accentColor: AMBER, minFontSize: 13, maxFontSize: 24 }), { name: 'Relatives' })
  ]
  return dashboard('Race Wet Compact Cluster', 1024, 600, 'Wet dash with a tight top instrument cluster (speed, gear, delta, position/incidents, fuel, map), then wetness/grip gauges and a weather panel, over track/air temps, tyre temps and relatives.', elements)
}

// ── 20 · Storm ────────────────────────────────────────────────────────────────
function buildStorm(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    topRevBar(20, 14, 984, 40, 26),
    heroGear(40, 70, 300, 300),
    weatherBox(352, 70, 320, 240, { title: 'STORM', maxFontSize: 44 }),
    wetTile(352, 318, 155, 110, 'valuegauge'),
    gripTile(517, 318, 155, 110, 'valuegauge'),
    posTile(700, 70, 150, 90),
    incTile(858, 70, 142, 90),
    fuelTile(700, 168, 150, 90),
    deltaTile(858, 168, 142, 90),
    mapClean(700, 266, 300, 90),
    trackTempTile(40, 438, 180, 138),
    airTempTile(228, 438, 180, 138),
    tyreTemps(416, 438, 340, 138),
    w('laptiming', 764, 438, 240, 138, style({ title: 'PACE', showLast: true, showBest: true, accentColor: CYAN }), { name: 'LapTiming' })
  ]
  return dashboard('Race Wet Storm', 1024, 600, 'Dramatic full-wet dash: a bold left gear, a large STORM weather panel with wetness/grip gauges beneath, a right block of position/incidents/fuel/delta over the map, and a bottom row of track/air temps, tyre temps and pace.', elements)
}

// ── Registry-shaped export (NOT wired into dashboards.ts) ──────────────────────
export const RACE_WET_PRESETS: Array<{ id: string; name: string; build: () => Dashboard; tags?: string[] }> = [
  { id: 'race-wet-classic-strip', name: 'Race Wet — Classic Strip', build: buildClassicStrip, tags: ['race', 'wet', 'rain', 'strip', 'conditions'] },
  { id: 'race-wet-left-rail', name: 'Race Wet — Left Rail', build: buildLeftRail, tags: ['race', 'wet', 'rain', 'rail', 'gauges'] },
  { id: 'race-wet-weather-hero', name: 'Race Wet — Weather Hero', build: buildWeatherHero, tags: ['race', 'wet', 'rain', 'weather', 'hero'] },
  { id: 'race-wet-split', name: 'Race Wet — Split', build: buildSplit, tags: ['race', 'wet', 'rain', 'split', 'conditions'] },
  { id: 'race-wet-bottom-dock', name: 'Race Wet — Bottom Dock', build: buildBottomDock, tags: ['race', 'wet', 'rain', 'dock', 'timing'] },
  { id: 'race-wet-corners', name: 'Race Wet — Corners', build: buildCorners, tags: ['race', 'wet', 'rain', 'corners', 'symmetric'] },
  { id: 'race-wet-tyre-focus', name: 'Race Wet — Tyre Focus', build: buildTyreFocus, tags: ['race', 'wet', 'rain', 'tyres', 'temps'] },
  { id: 'race-wet-grip-gauge', name: 'Race Wet — Grip Gauge', build: buildGripGauge, tags: ['race', 'wet', 'rain', 'grip', 'gauge'] },
  { id: 'race-wet-minimal', name: 'Race Wet — Minimal', build: buildMinimal, tags: ['race', 'wet', 'rain', 'minimal', 'clean'] },
  { id: 'race-wet-endurance', name: 'Race Wet — Endurance', build: buildEndurance, tags: ['race', 'wet', 'rain', 'endurance', 'stint'] },
  { id: 'race-wet-right-stack', name: 'Race Wet — Right Stack', build: buildRightStack, tags: ['race', 'wet', 'rain', 'stack', 'conditions'] },
  { id: 'race-wet-twin-gauge', name: 'Race Wet — Twin Gauge', build: buildTwinGauge, tags: ['race', 'wet', 'rain', 'gauges', 'grip'] },
  { id: 'race-wet-hud-band', name: 'Race Wet — HUD Band', build: buildHudBand, tags: ['race', 'wet', 'rain', 'hud', 'weather'] },
  { id: 'race-wet-mono-grid', name: 'Race Wet — Mono Grid', build: buildMonoGrid, tags: ['race', 'wet', 'rain', 'grid', 'cyan'] },
  { id: 'race-wet-delta-focus', name: 'Race Wet — Delta Focus', build: buildDeltaFocus, tags: ['race', 'wet', 'rain', 'delta', 'pace'] },
  { id: 'race-wet-trackmap-hero', name: 'Race Wet — Trackmap Hero', build: buildTrackmapHero, tags: ['race', 'wet', 'rain', 'trackmap', 'hero'] },
  { id: 'race-wet-pit-window', name: 'Race Wet — Pit Window', build: buildPitWindow, tags: ['race', 'wet', 'rain', 'strategy', 'fuel'] },
  { id: 'race-wet-quad-panels', name: 'Race Wet — Quad Panels', build: buildQuadPanels, tags: ['race', 'wet', 'rain', 'quad', 'panels'] },
  { id: 'race-wet-compact-cluster', name: 'Race Wet — Compact Cluster', build: buildCompactCluster, tags: ['race', 'wet', 'rain', 'compact', 'cluster'] },
  { id: 'race-wet-storm', name: 'Race Wet — Storm', build: buildStorm, tags: ['race', 'wet', 'rain', 'storm', 'weather'] }
]
