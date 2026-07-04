// ─── RACE · SUN catalogue (dry-race GT3 dashboards) ───────────────────────────
// Twenty original 1024×600 race dashboards tuned for a DRY RACE (sunny, slick
// tyres, no rain). They COMPOSE the shared semantic widgets (gear / shift /
// speed / delta / laptiming / fuel / tyres / relatives / standings / track map /
// weather) into balanced race layouts: lap times, tyre thermals, fuel/stint,
// relatives + standings and predictive delta all live on the same warm surface.
//
// This module is SELF-CONTAINED: it imports ONLY the exported dashboard helpers
// (and colour/font tokens) plus the Dashboard TYPE from `./dashboards`. It does
// NOT touch the preset registry — `RACE_SUN_PRESETS` is exported for whoever
// wants to spread it into a gallery, exactly like R16_PRESETS. Because it only
// imports value helpers + erased types, there is no runtime import cycle.
//
// COLOUR RULE (Gui): warm GT3 palette — amber/gold/white drive the chrome and
// accents; GREEN is reserved for genuinely "good" live states only (a faster
// delta, grip on target, a gap you are closing). RED flags incidents/danger,
// CYAN is used sparingly for neutral track/map information.
//
// Every dashboard is MANDATED to carry: a top RevLights bar (`topRevBar`), the
// dominant central gear (`heroGear`), a track MAP (`trackmap-clean`/`trackmini`),
// Position, Incidents and Fuel readouts, and a Track+weather tell (the `weather`
// widget or a trackTemp/airTemp/grip trio). The FIRST element is always the
// RACE_BG backplate rect.

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
import type { Dashboard, DashboardElement, DashboardElementStyle } from './dashboards'

type S = Partial<DashboardElementStyle>

// ── Shared building blocks (compose ONLY the exported primitives) ─────────────

// The mandatory first element on every dashboard.
function bg(): DashboardElement {
  return w('rect', 0, 0, 1024, 600, { background: RACE_BG, borderWidth: 0, radius: 0 }, { name: 'Backplate' })
}

// A borderless, transparent style for the floating "clean" widgets.
function clear(extra: S = {}): DashboardElementStyle {
  return { background: 'transparent', borderWidth: 0, radius: 0, color: TEXT, fontFamily: FONT_NUM, ...extra }
}

// ── Mandatory readouts (exact bindings/labels/accents the brief requires) ─────
function posTile(x: number, y: number, wd: number, ht: number, o: S = {}): DashboardElement {
  return cv('position', x, y, wd, ht, 'POS', { accentColor: AMBER, minFontSize: 20, maxFontSize: 60, ...o })
}
function incTile(x: number, y: number, wd: number, ht: number, o: S = {}): DashboardElement {
  return cv('incidentCount', x, y, wd, ht, 'INC', { accentColor: RED, minFontSize: 20, maxFontSize: 60, ...o })
}
function fuelTile(x: number, y: number, wd: number, ht: number, o: S = {}): DashboardElement {
  return cv('fuelLitersStr', x, y, wd, ht, 'FUEL', { accentColor: AMBER, minFontSize: 18, maxFontSize: 52, ...o })
}

// ── Secondary readouts (dry-race theme: lap times + delta + speed) ────────────
function speedTile(x: number, y: number, wd: number, ht: number, o: S = {}): DashboardElement {
  return cv('speedKmh', x, y, wd, ht, '', { fontFamily: FONT_NUM, suffix: 'km/h', minFontSize: 24, maxFontSize: 72, ...o })
}
function deltaTile(x: number, y: number, wd: number, ht: number, o: S = {}): DashboardElement {
  return cv('deltaSec', x, y, wd, ht, 'DELTA', { accentColor: GREEN, minFontSize: 22, maxFontSize: 60, ...o })
}
function lastTile(x: number, y: number, wd: number, ht: number, o: S = {}): DashboardElement {
  return cv('lastLapFmt', x, y, wd, ht, 'LAST', { accentColor: TEXT, minFontSize: 18, maxFontSize: 52, ...o })
}
function bestTile(x: number, y: number, wd: number, ht: number, o: S = {}): DashboardElement {
  return cv('bestLapFmt', x, y, wd, ht, 'BEST', { accentColor: MUTED, minFontSize: 18, maxFontSize: 48, ...o })
}

// ── Track map (mandatory) — borderless clean map or framed mini map ───────────
function mapClean(x: number, y: number, wd: number, ht: number, o: S = {}): DashboardElement {
  return w('trackmap-clean', x, y, wd, ht, clear({ accentColor: CYAN, color: MUTED, showIcon: false, ...o }), { binding: 'lapDistPct', name: 'TrackMap' })
}
function mapMini(x: number, y: number, wd: number, ht: number, o: S = {}): DashboardElement {
  return w('trackmini', x, y, wd, ht, style({ radius: 10, accentColor: CYAN, ...o }), { binding: 'lapDistPct', name: 'TrackMini' })
}

// ── Track + weather (mandatory) — the self-contained widget OR a temp/grip trio ─
function weatherWidget(x: number, y: number, wd: number, ht: number, o: S = {}): DashboardElement {
  return w('weather', x, y, wd, ht, style({ radius: 10, accentColor: CYAN, title: 'TRACK', ...o }), { name: 'Weather' })
}
function weatherTrio(x: number, y: number, wd: number, ht: number, gap = 8): DashboardElement[] {
  const cwd = Math.floor((wd - gap * 2) / 3)
  const x2 = x + cwd + gap
  const x3 = x + (cwd + gap) * 2
  return [
    cv('trackTempC', x, y, cwd, ht, 'TRACK', { accentColor: AMBER, suffix: '°', minFontSize: 13, maxFontSize: 32 }),
    cv('airTempC', x2, y, cwd, ht, 'AIR', { accentColor: MUTED, suffix: '°', minFontSize: 13, maxFontSize: 32 }),
    cv('gripPct', x3, y, wd - (cwd + gap) * 2, ht, 'GRIP', { accentColor: GREEN, suffix: '%', minFontSize: 13, maxFontSize: 32 })
  ]
}

// ── Composite race widgets ────────────────────────────────────────────────────
function relClean(x: number, y: number, wd: number, ht: number, o: S = {}): DashboardElement {
  return w('relatives-clean', x, y, wd, ht, clear({ accentColor: AMBER, minFontSize: 14, maxFontSize: 26, showIcon: false, reference: '±1 CAR', ...o }), { name: 'Relatives' })
}
function relElaborate(x: number, y: number, wd: number, ht: number, o: S = {}): DashboardElement {
  return w('relatives-elaborate', x, y, wd, ht, clear({ accentColor: AMBER, minFontSize: 14, maxFontSize: 32, showIcon: false, reference: 'NAME / GAP / LAST', ...o }), { name: 'RelativesEl' })
}
function lapStack(x: number, y: number, wd: number, ht: number, o: S = {}): DashboardElement {
  return w('laptiming', x, y, wd, ht, style({ title: 'TIMING', showCurrent: true, showLast: true, showBest: true, accentColor: CYAN, ...o }), { name: 'LapTiming' })
}
function stint(x: number, y: number, wd: number, ht: number, o: S = {}): DashboardElement {
  return w('fuelstint', x, y, wd, ht, style({ title: 'STINT', enduranceMode: true, reserveLaps: 2, warnAtLaps: 3, accentColor: AMBER, ...o }), { name: 'FuelStint' })
}
function tyreTemp(x: number, y: number, wd: number, ht: number, o: S = {}): DashboardElement {
  return w('tyregrid', x, y, wd, ht, style({ gridMode: 'temp', showAverage: true, showLabels: true, title: 'TYRE °C', accentColor: AMBER, ...o }), { name: 'TyreTemp' })
}
function tyrePress(x: number, y: number, wd: number, ht: number, o: S = {}): DashboardElement {
  return w('tyregrid', x, y, wd, ht, style({ gridMode: 'pressure', targetValue: 165, tolerance: 7, title: 'PRESS', accentColor: CYAN, ...o }), { name: 'TyrePress' })
}
function brakes(x: number, y: number, wd: number, ht: number, o: S = {}): DashboardElement {
  return w('brakegrid', x, y, wd, ht, style({ showAverage: true, title: 'BRK °C', accentColor: RED, ...o }), { name: 'Brakes' })
}
function cornerHealth(x: number, y: number, wd: number, ht: number, o: S = {}): DashboardElement {
  return w('cornerstack', x, y, wd, ht, style({ title: 'CORNER', targetValue: 165, tolerance: 7, accentColor: AMBER, ...o }), { name: 'CornerStack' })
}
function pedals(x: number, y: number, wd: number, ht: number, o: S = {}): DashboardElement {
  return w('inputbars', x, y, wd, ht, style({ channels: ['throttle', 'brake'], accentColor: CYAN, ...o }), { name: 'Pedals' })
}
function standingsRel(x: number, y: number, wd: number, ht: number, rows = 3, o: S = {}): DashboardElement {
  return w('standings', x, y, wd, ht, style({ tableColumns: ['pos', 'number', 'name', 'gap'], tableMaxRows: rows, showHeader: false, highlightPlayer: true, fontSize: 13, radius: 8, accentColor: AMBER, ...o }), { name: 'Standings' })
}
function standingsTower(x: number, y: number, wd: number, ht: number, rows = 9, o: S = {}): DashboardElement {
  return w('standings', x, y, wd, ht, style({ tableColumns: ['pos', 'number', 'name', 'gap', 'class'], tableMaxRows: rows, showHeader: true, highlightPlayer: true, fontSize: 14, radius: 10, accentColor: AMBER, ...o }), { name: 'StandingsTower' })
}
function deltaBar(x: number, y: number, wd: number, ht: number, o: S = {}): DashboardElement {
  return w('deltabar', x, y, wd, ht, style({ background: '#000000', radius: 999, fillColor: GREEN, dangerColor: RED, deltaRangeSec: 1, ...o }), { binding: 'deltaSec', name: 'DeltaBar' })
}
function deltaTileW(x: number, y: number, wd: number, ht: number, o: S = {}): DashboardElement {
  return w('deltatile', x, y, wd, ht, style({ title: 'DELTA', deltaReference: 'session', deltaRangeSec: 1, accentColor: GREEN, ...o }), { name: 'DeltaTile' })
}
function posGaps(x: number, y: number, wd: number, ht: number, o: S = {}): DashboardElement {
  return w('positiongaps', x, y, wd, ht, style({ showTotal: true, accentColor: AMBER, minFontSize: 18, maxFontSize: 44, ...o }), { name: 'PositionGaps' })
}

// ══════════════════════════════════════════════════════════════════════════════
// 1 — Dense endurance DDU: relatives, timing + stint, packed status/lap band.
// ══════════════════════════════════════════════════════════════════════════════
function raceSunDenseDdu(): Dashboard {
  const els: DashboardElement[] = [
    bg(),
    topRevBar(14, 10, 996, 22, 26),
    relClean(14, 44, 300, 250),
    heroGear(352, 40, 320, 234),
    speedTile(372, 282, 280, 56, { minFontSize: 26, maxFontSize: 60 }),
    lapStack(704, 44, 306, 118),
    stint(704, 172, 306, 116, { title: 'STINT FUEL' }),
    hairline(14, 344, 996, 1),
    posTile(14, 352, 150, 104),
    incTile(172, 352, 150, 104),
    fuelTile(330, 352, 150, 104),
    deltaTile(488, 352, 160, 104),
    lastTile(656, 352, 160, 104),
    bestTile(824, 352, 186, 104),
    tyreTemp(14, 464, 160, 122),
    mapClean(184, 464, 280, 122),
    weatherWidget(474, 464, 170, 122),
    standingsRel(654, 464, 356, 122, 3)
  ]
  return dashboard('Race Sun · Dense DDU', 1024, 600, 'Dense dry-race DDU: relatives, lap timing and stint fuel up top, then a packed status/lap band and a tyre-temp / track-map / weather / standings strip. Warm amber chrome with green reserved for a good delta.', els)
}

// ══════════════════════════════════════════════════════════════════════════════
// 2 — Clean wheel: dominant gear, flanking delta/last, minimal status strip.
// ══════════════════════════════════════════════════════════════════════════════
function raceSunCleanWheel(): Dashboard {
  const els: DashboardElement[] = [
    bg(),
    topRevBar(112, 34, 800, 26, 22),
    deltaTile(40, 118, 300, 150, { minFontSize: 40, maxFontSize: 92 }),
    lastTile(684, 118, 300, 150, { minFontSize: 30, maxFontSize: 64 }),
    heroGear(392, 86, 240, 300),
    speedTile(392, 392, 240, 84, { minFontSize: 30, maxFontSize: 72 }),
    mapClean(40, 300, 300, 140),
    relClean(684, 300, 300, 140),
    hairline(40, 496, 944, 1),
    posTile(40, 506, 150, 80),
    incTile(198, 506, 150, 80),
    fuelTile(356, 506, 150, 80),
    ...weatherTrio(520, 506, 464, 80)
  ]
  return dashboard('Race Sun · Clean Wheel', 1024, 600, 'Minimal steering-wheel dry-race screen: one dominant gear, big flanking delta and last-lap, a borderless track map and relatives, and a tight position / incidents / fuel / track-temp band along the bottom.', els)
}

// ══════════════════════════════════════════════════════════════════════════════
// 3 — Endurance stint: big fuel calculator, lap stack, per-lap + clock readouts.
// ══════════════════════════════════════════════════════════════════════════════
function raceSunEnduranceStint(): Dashboard {
  const els: DashboardElement[] = [
    bg(),
    topRevBar(16, 12, 992, 24, 24),
    stint(16, 52, 320, 240, { title: 'STINT FUEL', maxFontSize: 56 }),
    heroGear(372, 60, 280, 220),
    speedTile(372, 288, 280, 56, { minFontSize: 24, maxFontSize: 58 }),
    w('laptiming', 688, 52, 320, 130, style({ title: 'LAP STACK', showCurrent: true, showLast: true, showBest: true, showEstimated: true, accentColor: CYAN }), { name: 'LapStack' }),
    relClean(688, 190, 320, 102),
    hairline(16, 360, 992, 1),
    posTile(16, 372, 150, 100),
    incTile(174, 372, 150, 100),
    fuelTile(332, 372, 150, 100),
    deltaTile(490, 372, 160, 100),
    weatherWidget(658, 372, 350, 100),
    tyrePress(16, 480, 160, 104),
    mapClean(184, 480, 300, 104),
    cv('fuelPerLapStr', 492, 480, 160, 104, 'L/LAP', { accentColor: AMBER, minFontSize: 18, maxFontSize: 40 }),
    cv('sessionTimeLeftFmt', 658, 480, 172, 104, 'TIME', { accentColor: CYAN, minFontSize: 18, maxFontSize: 40 }),
    cv('fuelLapsLeftStr', 838, 480, 172, 104, 'LAPS', { accentColor: TEXT, minFontSize: 18, maxFontSize: 40 })
  ]
  return dashboard('Race Sun · Endurance Stint', 1024, 600, 'Endurance dry-race stint board: a large fuel/stint calculator, a full lap stack, and a fuel-per-lap / time-left / laps-left row backed by tyre pressures, track map and the live weather panel.', els)
}

// ══════════════════════════════════════════════════════════════════════════════
// 4 — Sprint attack: predictive delta tile + bar, timing, flanked hero gear.
// ══════════════════════════════════════════════════════════════════════════════
function raceSunSprintAttack(): Dashboard {
  const els: DashboardElement[] = [
    bg(),
    topRevBar(20, 16, 984, 40, 28),
    deltaTileW(20, 70, 320, 150),
    lapStack(360, 70, 340, 150),
    relClean(712, 70, 292, 150),
    speedTile(40, 250, 300, 120, { minFontSize: 34, maxFontSize: 96 }),
    heroGear(392, 236, 240, 210),
    lastTile(684, 250, 300, 120, { minFontSize: 30, maxFontSize: 64 }),
    deltaBar(260, 456, 504, 24),
    hairline(20, 496, 984, 1),
    posTile(20, 506, 150, 80),
    incTile(178, 506, 150, 80),
    fuelTile(336, 506, 150, 80),
    mapMini(494, 506, 150, 80),
    ...weatherTrio(660, 506, 344, 80)
  ]
  return dashboard('Race Sun · Sprint Attack', 1024, 600, 'Sprint dry-race layout built around attack: a big predictive delta tile and delta bar, a live timing stack, big flanking speed and last-lap, and a compact status / mini-map / track-temp footer.', els)
}

// ══════════════════════════════════════════════════════════════════════════════
// 5 — Tyre thermal: temp + pressure grids, brakes, corner health, inputs.
// ══════════════════════════════════════════════════════════════════════════════
function raceSunTyreThermal(): Dashboard {
  const els: DashboardElement[] = [
    bg(),
    topRevBar(16, 12, 992, 22, 24),
    tyreTemp(16, 48, 250, 250),
    tyrePress(276, 48, 210, 250),
    brakes(496, 48, 190, 250),
    heroGear(700, 48, 220, 220),
    speedTile(924, 48, 84, 60, { minFontSize: 14, maxFontSize: 26 }),
    speedTile(700, 276, 220, 56, { minFontSize: 22, maxFontSize: 52 }),
    hairline(16, 348, 992, 1),
    posTile(16, 360, 150, 110),
    incTile(174, 360, 150, 110),
    fuelTile(332, 360, 150, 110),
    deltaTile(490, 360, 160, 110),
    lastTile(658, 360, 160, 110),
    weatherWidget(826, 360, 184, 110),
    cornerHealth(16, 478, 300, 108),
    mapClean(326, 478, 300, 108),
    w('temps-clean', 636, 478, 190, 108, style({ accentColor: AMBER, minFontSize: 14, maxFontSize: 30, title: 'ENGINE' }), { name: 'EngineTemps' }),
    pedals(836, 478, 174, 108)
  ]
  return dashboard('Race Sun · Tyre Thermal', 1024, 600, 'Engineering dry-race board for slick management: side-by-side tyre temperature and pressure grids, brake temps, corner health and pedals, with the mandatory gear, map, status and weather kept readable.', els)
}

// ══════════════════════════════════════════════════════════════════════════════
// 6 — Standings tower: 9-row tower right, gear left, timing + relatives.
// ══════════════════════════════════════════════════════════════════════════════
function raceSunStandingsTower(): Dashboard {
  const els: DashboardElement[] = [
    bg(),
    topRevBar(16, 12, 700, 22, 22),
    standingsTower(724, 12, 284, 470, 9),
    deltaTile(16, 60, 200, 120, { minFontSize: 30, maxFontSize: 70 }),
    w('laptiming', 16, 190, 200, 178, style({ title: 'TIMING', showCurrent: true, showLast: true, showBest: true, showEstimated: true, accentColor: CYAN }), { name: 'LapStack' }),
    heroGear(240, 60, 240, 240),
    speedTile(240, 308, 240, 60, { minFontSize: 24, maxFontSize: 58 }),
    relClean(500, 60, 208, 240),
    hairline(16, 380, 692, 1),
    posTile(16, 392, 160, 100),
    incTile(184, 392, 160, 100),
    fuelTile(352, 392, 160, 100),
    mapMini(520, 392, 188, 100),
    ...weatherTrio(16, 500, 360, 86),
    bestTile(384, 500, 160, 86),
    lastTile(548, 500, 160, 86)
  ]
  return dashboard('Race Sun · Standings Tower', 1024, 600, 'Race-control dry board with a full nine-row standings tower on the right, a central gear and timing/delta stack on the left, plus relatives, mini map, best/last laps and a track-temp trio.', els)
}

// ══════════════════════════════════════════════════════════════════════════════
// 7 — Relatives traffic: big relatives + track map + radar, gear + gaps.
// ══════════════════════════════════════════════════════════════════════════════
function raceSunRelativesTraffic(): Dashboard {
  const els: DashboardElement[] = [
    bg(),
    topRevBar(22, 14, 980, 22, 24),
    relElaborate(22, 50, 430, 220),
    mapClean(470, 50, 300, 260),
    standingsRel(786, 50, 216, 220, 5),
    w('radar-clean', 470, 320, 300, 158, clear({ accentColor: AMBER, showIcon: false }), { name: 'Radar' }),
    heroGear(22, 290, 200, 180),
    speedTile(238, 290, 214, 84, { minFontSize: 26, maxFontSize: 56 }),
    deltaTile(238, 384, 214, 86),
    posGaps(786, 290, 216, 100),
    stint(786, 398, 216, 88, { title: 'STINT' }),
    hairline(22, 486, 980, 1),
    posTile(22, 496, 150, 90),
    incTile(180, 496, 150, 90),
    fuelTile(338, 496, 150, 90),
    lastTile(496, 496, 150, 90),
    weatherWidget(654, 496, 348, 90)
  ]
  return dashboard('Race Sun · Relatives Traffic', 1024, 600, 'Traffic-management dry board: a dominant relatives table with radar and interactive track map, position gaps and stint fuel on the right, and the core gear / delta / status / weather kept compact below.', els)
}

// ══════════════════════════════════════════════════════════════════════════════
// 8 — Delta hero: oversized delta tile + bar, gear right, timing, status.
// ══════════════════════════════════════════════════════════════════════════════
function raceSunDeltaHero(): Dashboard {
  const els: DashboardElement[] = [
    bg(),
    topRevBar(20, 14, 984, 30, 26),
    deltaTileW(20, 56, 500, 180),
    heroGear(560, 56, 240, 200),
    speedTile(560, 264, 240, 60, { minFontSize: 24, maxFontSize: 56 }),
    lapStack(820, 56, 184, 200),
    deltaBar(20, 250, 500, 30),
    lastTile(20, 292, 250, 70),
    bestTile(280, 292, 240, 70),
    hairline(20, 380, 984, 1),
    posTile(20, 392, 160, 90),
    incTile(188, 392, 160, 90),
    fuelTile(356, 392, 160, 90),
    mapClean(524, 392, 300, 90),
    relClean(832, 392, 172, 90),
    ...weatherTrio(20, 490, 470, 96),
    tyreTemp(500, 490, 150, 96, { title: 'TYRE' }),
    standingsRel(660, 490, 344, 96, 2)
  ]
  return dashboard('Race Sun · Delta Hero', 1024, 600, 'Qualifying-into-race dry board dominated by a huge predictive delta tile and bar, with best/last laps, a right-hand gear and timing, then a full status / map / tyre / standings / weather deck below.', els)
}

// ══════════════════════════════════════════════════════════════════════════════
// 9 — Classic cup: Porsche-Cup homage — hero gear, speed, delta/last, tells.
// ══════════════════════════════════════════════════════════════════════════════
function raceSunClassicCup(): Dashboard {
  const els: DashboardElement[] = [
    bg(),
    topRevBar(60, 30, 904, 30, 24),
    cv('flagLabel', 16, 26, 40, 40, '', { accentColor: AMBER, minFontSize: 14, maxFontSize: 26 }),
    cv('pitLimiter', 968, 26, 40, 40, '', { accentColor: CYAN, minFontSize: 14, maxFontSize: 26 }),
    heroGear(390, 96, 244, 320),
    speedTile(60, 190, 300, 150, { minFontSize: 60, maxFontSize: 140 }),
    deltaTile(664, 160, 300, 110, { minFontSize: 40, maxFontSize: 90 }),
    lastTile(664, 280, 300, 100, { minFontSize: 30, maxFontSize: 60 }),
    hairline(60, 430, 904, 1),
    posTile(64, 442, 200, 140, { maxFontSize: 96 }),
    incTile(280, 442, 180, 140, { maxFontSize: 88 }),
    fuelTile(476, 442, 180, 140, { maxFontSize: 72 }),
    mapMini(672, 442, 150, 140),
    weatherWidget(838, 442, 170, 140)
  ]
  return dashboard('Race Sun · Classic Cup', 1024, 600, 'A dry-race homage to the 911 GT3 Cup cluster: deep black, one dominant gear with flag/limiter tells flanking the rev bar, big speed and delta/last, and a hairline-split position / incidents / fuel / map / weather base.', els)
}

// ══════════════════════════════════════════════════════════════════════════════
// 10 — Compact status: AMG-style — gear centre, ABS/TC/PIT left, status right.
// ══════════════════════════════════════════════════════════════════════════════
function raceSunCompactStatus(): Dashboard {
  const els: DashboardElement[] = [
    bg(),
    topRevBar(51, 26, 922, 26, 20),
    heroGear(384, 84, 256, 280),
    speedTile(384, 372, 256, 90, { minFontSize: 30, maxFontSize: 72 }),
    cv('absActive', 51, 92, 192, 80, 'ABS', { accentColor: AMBER, minFontSize: 20, maxFontSize: 40 }),
    cv('tcActive', 51, 180, 192, 80, 'TC', { accentColor: AMBER, minFontSize: 20, maxFontSize: 40 }),
    cv('pitLimiter', 51, 268, 192, 80, 'PIT', { accentColor: CYAN, minFontSize: 18, maxFontSize: 36 }),
    posTile(781, 92, 192, 80, { maxFontSize: 52 }),
    incTile(781, 180, 192, 80, { maxFontSize: 52 }),
    fuelTile(781, 268, 192, 80, { maxFontSize: 44 }),
    hairline(51, 474, 922, 1),
    relClean(51, 486, 300, 100),
    lastTile(364, 486, 150, 100),
    deltaTile(524, 486, 150, 100),
    mapMini(684, 486, 130, 100),
    weatherWidget(824, 486, 149, 100)
  ]
  return dashboard('Race Sun · Compact Status', 1024, 600, 'Mercedes-AMG-style compact dry dash: a big central gear anchor with ABS/TC/pit tells on the left and position/incidents/fuel on the right, then relatives, last-lap, delta, mini map and weather along the bottom.', els)
}

// ══════════════════════════════════════════════════════════════════════════════
// 11 — Fuel strategy: big stint plan, per-lap/laps/time row, status + map.
// ══════════════════════════════════════════════════════════════════════════════
function raceSunFuelStrategy(): Dashboard {
  const els: DashboardElement[] = [
    bg(),
    topRevBar(16, 12, 992, 22, 24),
    stint(16, 48, 300, 250, { title: 'STINT PLAN', maxFontSize: 58 }),
    heroGear(360, 56, 300, 240),
    speedTile(360, 304, 300, 56, { minFontSize: 24, maxFontSize: 58 }),
    w('laptiming', 704, 48, 304, 130, style({ title: 'TIMING', showCurrent: true, showLast: true, showBest: true, showEstimated: true, accentColor: CYAN }), { name: 'LapStack' }),
    relClean(704, 186, 304, 112),
    hairline(16, 366, 992, 1),
    cv('fuelPerLapStr', 16, 378, 170, 96, 'L/LAP', { accentColor: AMBER, minFontSize: 18, maxFontSize: 40 }),
    cv('fuelLapsLeftStr', 194, 378, 170, 96, 'LAPS', { accentColor: TEXT, minFontSize: 18, maxFontSize: 40 }),
    cv('sessionTimeLeftFmt', 372, 378, 170, 96, 'TIME', { accentColor: CYAN, minFontSize: 18, maxFontSize: 40 }),
    deltaTile(550, 378, 160, 96),
    lastTile(718, 378, 150, 96),
    bestTile(876, 378, 132, 96),
    posTile(16, 482, 160, 104),
    incTile(184, 482, 160, 104),
    fuelTile(352, 482, 160, 104),
    mapClean(520, 482, 300, 104),
    weatherWidget(828, 482, 180, 104)
  ]
  return dashboard('Race Sun · Fuel Strategy', 1024, 600, 'Strategy-first dry board: a large stint plan with fuel-per-lap, laps-left and time-left readouts, live timing and relatives, and a full position / incidents / fuel / map / weather base row.', els)
}

// ══════════════════════════════════════════════════════════════════════════════
// 12 — Lap timing focus: big lap stack, gear, delta/best, laps + status.
// ══════════════════════════════════════════════════════════════════════════════
function raceSunLaptimingFocus(): Dashboard {
  const els: DashboardElement[] = [
    bg(),
    topRevBar(20, 14, 984, 24, 24),
    w('laptiming', 20, 54, 420, 220, style({ title: 'LAP / LAST / BEST', showCurrent: true, showLast: true, showBest: true, showEstimated: true, accentColor: CYAN, maxFontSize: 60 }), { name: 'LapStack' }),
    heroGear(470, 54, 240, 220),
    speedTile(470, 282, 240, 60, { minFontSize: 24, maxFontSize: 58 }),
    deltaTile(740, 54, 264, 130, { minFontSize: 40, maxFontSize: 90 }),
    bestTile(740, 190, 264, 84),
    hairline(20, 358, 984, 1),
    lastTile(20, 370, 200, 96),
    posTile(232, 370, 150, 96),
    incTile(394, 370, 150, 96),
    fuelTile(556, 370, 150, 96),
    mapMini(718, 370, 150, 96),
    relClean(20, 478, 340, 108),
    standingsRel(372, 478, 334, 108, 2),
    weatherWidget(718, 478, 286, 108)
  ]
  return dashboard('Race Sun · Lap Timing', 1024, 600, 'Timing-centric dry board: an oversized current/last/best/estimated lap stack next to the gear, a big delta and best lap, then last-lap, status tiles, mini map, relatives, standings and weather.', els)
}

// ══════════════════════════════════════════════════════════════════════════════
// 13 — Dual column: symmetric tyre/relatives + timing/stint flanking the gear.
// ══════════════════════════════════════════════════════════════════════════════
function raceSunDualColumn(): Dashboard {
  const els: DashboardElement[] = [
    bg(),
    topRevBar(16, 12, 992, 24, 26),
    heroGear(392, 60, 240, 260),
    speedTile(392, 326, 240, 64, { minFontSize: 26, maxFontSize: 64 }),
    relClean(16, 52, 340, 150),
    tyreTemp(16, 210, 165, 180),
    tyrePress(191, 210, 165, 180),
    lapStack(668, 52, 340, 150),
    stint(668, 210, 165, 180, { title: 'STINT' }),
    brakes(843, 210, 165, 180),
    hairline(16, 404, 992, 1),
    posTile(16, 416, 160, 80),
    incTile(184, 416, 160, 80),
    fuelTile(352, 416, 160, 80),
    deltaTile(520, 416, 160, 80),
    lastTile(688, 416, 160, 80),
    bestTile(856, 416, 152, 80),
    mapClean(16, 504, 340, 82),
    deltaBar(368, 512, 300, 60),
    ...weatherTrio(680, 504, 328, 82)
  ]
  return dashboard('Race Sun · Dual Column', 1024, 600, 'Symmetric dry board: relatives and tyre temp/pressure fill the left column, timing, stint and brakes the right, all flanking a central gear, with a status/lap band and map / delta bar / track-temp footer.', els)
}

// ══════════════════════════════════════════════════════════════════════════════
// 14 — Hero gear wide: a giant gear with peripheral corner readouts.
// ══════════════════════════════════════════════════════════════════════════════
function raceSunHeroGearWide(): Dashboard {
  const els: DashboardElement[] = [
    bg(),
    topRevBar(20, 16, 984, 34, 28),
    heroGear(300, 70, 424, 420),
    posTile(20, 70, 250, 120, { maxFontSize: 88 }),
    deltaTile(20, 200, 250, 120, { maxFontSize: 84 }),
    lastTile(20, 330, 250, 120, { maxFontSize: 72 }),
    incTile(754, 70, 250, 120, { maxFontSize: 88 }),
    fuelTile(754, 200, 250, 120, { maxFontSize: 72 }),
    bestTile(754, 330, 250, 120, { maxFontSize: 68 }),
    hairline(20, 480, 984, 1),
    speedTile(20, 496, 250, 90, { minFontSize: 30, maxFontSize: 76 }),
    mapMini(290, 496, 150, 90),
    relClean(452, 496, 300, 90),
    weatherWidget(764, 496, 240, 90)
  ]
  return dashboard('Race Sun · Hero Gear Wide', 1024, 600, 'A minimalist dry board built around a giant central gear, with position/delta/last down the left edge, incidents/fuel/best down the right, and a speed / mini-map / relatives / weather strip beneath.', els)
}

// ══════════════════════════════════════════════════════════════════════════════
// 15 — Engineer grid: tyres/brakes/temps top, corner/inputs/timing/stint mid.
// ══════════════════════════════════════════════════════════════════════════════
function raceSunEngineerGrid(): Dashboard {
  const els: DashboardElement[] = [
    bg(),
    topRevBar(14, 10, 996, 20, 24),
    tyreTemp(14, 40, 200, 200),
    tyrePress(222, 40, 200, 200),
    brakes(430, 40, 180, 200),
    heroGear(630, 40, 200, 200),
    w('temps-clean', 838, 40, 172, 200, style({ accentColor: AMBER, minFontSize: 14, maxFontSize: 30, title: 'ENGINE' }), { name: 'EngineTemps' }),
    cornerHealth(14, 250, 300, 150),
    w('inputbars', 322, 250, 120, 150, style({ channels: ['throttle', 'brake', 'clutch'], accentColor: CYAN }), { name: 'Pedals' }),
    w('laptiming', 450, 250, 280, 150, style({ title: 'TIMING', showCurrent: true, showLast: true, showBest: true, showEstimated: true, accentColor: CYAN }), { name: 'LapStack' }),
    stint(738, 250, 272, 150, { title: 'STINT' }),
    hairline(14, 410, 996, 1),
    posTile(14, 420, 150, 80),
    incTile(172, 420, 150, 80),
    fuelTile(330, 420, 150, 80),
    speedTile(488, 420, 150, 80, { minFontSize: 22, maxFontSize: 52 }),
    deltaTile(646, 420, 150, 80),
    lastTile(804, 420, 206, 80),
    mapClean(14, 508, 320, 78),
    w('setupstrip', 342, 508, 388, 78, style({ fields: ['abs', 'tc', 'map', 'bb', 'limiter', 'inc'], accentColor: AMBER }), { name: 'SetupStrip' }),
    weatherWidget(738, 508, 272, 78)
  ]
  return dashboard('Race Sun · Engineer Grid', 1024, 600, 'A data-dense dry engineering board: tyre temp/pressure, brakes, engine temps and corner health up top, pedals, timing and stint mid, then status, setup strip, map and weather — every mandatory readout present.', els)
}

// ══════════════════════════════════════════════════════════════════════════════
// 16 — Night endurance: stint range, gear, position/flag, timing, tyres + map.
// ══════════════════════════════════════════════════════════════════════════════
function raceSunNightEndurance(): Dashboard {
  const els: DashboardElement[] = [
    bg(),
    topRevBar(31, 20, 962, 34, 24),
    stint(31, 66, 302, 200, { title: 'STINT RANGE', maxFontSize: 56 }),
    heroGear(364, 66, 296, 220),
    speedTile(364, 294, 296, 60, { minFontSize: 24, maxFontSize: 58 }),
    posTile(691, 66, 302, 92, { maxFontSize: 60 }),
    incTile(691, 166, 148, 92, { maxFontSize: 52 }),
    fuelTile(843, 166, 150, 92, { maxFontSize: 48 }),
    hairline(31, 360, 962, 1),
    w('laptiming', 31, 372, 320, 96, style({ title: 'LAP', showCurrent: true, showLast: true, showBest: true, accentColor: CYAN }), { name: 'LapStack' }),
    deltaTile(361, 372, 160, 96),
    lastTile(529, 372, 160, 96),
    cv('sessionTimeLeftFmt', 697, 372, 148, 96, 'TIME', { accentColor: CYAN, minFontSize: 16, maxFontSize: 38 }),
    cv('fuelLapsLeftStr', 853, 372, 140, 96, 'LAPS', { accentColor: TEXT, minFontSize: 16, maxFontSize: 38 }),
    w('tyres-clean', 31, 478, 300, 108, clear({ accentColor: AMBER, minFontSize: 14, maxFontSize: 30, reference: 'TEMP / PRESS' }), { name: 'Tyres' }),
    mapClean(339, 478, 300, 108),
    relClean(647, 478, 200, 108),
    weatherWidget(855, 478, 138, 108)
  ]
  return dashboard('Race Sun · Night Endurance', 1024, 600, 'A long-run dry endurance board: stint range and gear up top with position/incidents/fuel, a lap / delta / time-left / laps-left band, and a tyres / map / relatives / weather base for constant traffic and pit awareness.', els)
}

// ══════════════════════════════════════════════════════════════════════════════
// 17 — Minimal amber: giant gear, big delta/last, sparse footer.
// ══════════════════════════════════════════════════════════════════════════════
function raceSunMinimalAmber(): Dashboard {
  const els: DashboardElement[] = [
    bg(),
    topRevBar(212, 40, 600, 22, 20),
    heroGear(372, 92, 280, 320),
    speedTile(372, 418, 280, 90, { minFontSize: 30, maxFontSize: 72 }),
    deltaTile(40, 150, 280, 150, { minFontSize: 40, maxFontSize: 96 }),
    lastTile(704, 150, 280, 150, { minFontSize: 30, maxFontSize: 64 }),
    mapClean(40, 320, 280, 150),
    relClean(704, 320, 280, 150),
    hairline(40, 508, 944, 1),
    posTile(40, 520, 150, 66),
    incTile(206, 520, 130, 66),
    fuelTile(352, 520, 150, 66),
    mapMini(518, 520, 120, 66),
    ...weatherTrio(654, 520, 330, 66)
  ]
  return dashboard('Race Sun · Minimal Amber', 1024, 600, 'A restrained warm dry board: a giant gear with speed, big flanking delta and last-lap, a borderless map and relatives, and a single sparse position / incidents / fuel / mini-map / track-temp footer.', els)
}

// ══════════════════════════════════════════════════════════════════════════════
// 18 — Triple band: status band, core band, detail band.
// ══════════════════════════════════════════════════════════════════════════════
function raceSunTripleBand(): Dashboard {
  const els: DashboardElement[] = [
    bg(),
    topRevBar(16, 10, 992, 20, 26),
    // Band 1 — status
    posTile(16, 40, 150, 90),
    incTile(174, 40, 150, 90),
    fuelTile(332, 40, 150, 90),
    cv('flagLabel', 490, 40, 150, 90, 'FLAG', { accentColor: AMBER, minFontSize: 16, maxFontSize: 36 }),
    cv('pitLimiter', 648, 40, 150, 90, 'PIT', { accentColor: CYAN, minFontSize: 16, maxFontSize: 36 }),
    cv('absActive', 806, 40, 100, 90, 'ABS', { accentColor: AMBER, minFontSize: 16, maxFontSize: 34 }),
    cv('tcActive', 914, 40, 94, 90, 'TC', { accentColor: AMBER, minFontSize: 16, maxFontSize: 34 }),
    // Band 2 — core
    deltaTile(16, 140, 220, 190, { minFontSize: 40, maxFontSize: 96 }),
    speedTile(256, 210, 130, 120, { minFontSize: 26, maxFontSize: 58 }),
    heroGear(392, 140, 240, 190),
    lastTile(652, 150, 200, 90),
    bestTile(652, 244, 200, 86),
    mapClean(864, 140, 144, 190),
    // Band 3 — detail
    lapStack(16, 340, 320, 150),
    stint(16, 496, 320, 90, { title: 'STINT' }),
    relClean(348, 340, 320, 150),
    standingsRel(348, 496, 320, 90, 2),
    tyreTemp(680, 340, 160, 246, { title: 'TYRE' }),
    weatherWidget(852, 340, 156, 120),
    brakes(852, 466, 156, 120)
  ]
  return dashboard('Race Sun · Triple Band', 1024, 600, 'A dry board organised into three horizontal bands: a full status/flag/aids strip, a core gear + delta + speed + laps + map band, and a detail band of timing, stint, relatives, standings, tyres, brakes and weather.', els)
}

// ══════════════════════════════════════════════════════════════════════════════
// 19 — Gaps battle: position gaps + relatives, ahead/behind, gear, timing, map.
// ══════════════════════════════════════════════════════════════════════════════
function raceSunGapsBattle(): Dashboard {
  const els: DashboardElement[] = [
    bg(),
    topRevBar(20, 14, 984, 22, 24),
    posGaps(20, 50, 340, 120),
    relElaborate(20, 182, 340, 220),
    heroGear(392, 60, 240, 220),
    speedTile(392, 288, 240, 60, { minFontSize: 24, maxFontSize: 58 }),
    cv('gapAheadFmt', 392, 356, 116, 90, 'AHEAD', { accentColor: GREEN, minFontSize: 16, maxFontSize: 38 }),
    cv('gapBehindFmt', 516, 356, 116, 90, 'BEHIND', { accentColor: RED, minFontSize: 16, maxFontSize: 38 }),
    deltaTile(664, 60, 340, 120, { minFontSize: 40, maxFontSize: 90 }),
    lapStack(664, 192, 340, 120),
    mapClean(664, 324, 340, 122),
    hairline(20, 456, 984, 1),
    posTile(20, 466, 160, 120, { maxFontSize: 88 }),
    incTile(188, 466, 160, 120, { maxFontSize: 84 }),
    fuelTile(356, 466, 160, 120, { maxFontSize: 68 }),
    lastTile(524, 466, 160, 120),
    weatherWidget(692, 466, 312, 120)
  ]
  return dashboard('Race Sun · Gaps Battle', 1024, 600, 'A wheel-to-wheel dry board: position gaps and a rich relatives table on the left, gap-ahead/behind under the gear, delta, timing and track map on the right, and a big position / incidents / fuel / last / weather base.', els)
}

// ══════════════════════════════════════════════════════════════════════════════
// 20 — Panoramic: balanced full-canvas coverage of every subsystem.
// ══════════════════════════════════════════════════════════════════════════════
function raceSunPanoramic(): Dashboard {
  const els: DashboardElement[] = [
    bg(),
    topRevBar(16, 10, 992, 26, 30),
    heroGear(412, 48, 200, 210),
    speedTile(412, 264, 200, 54, { minFontSize: 22, maxFontSize: 50 }),
    deltaTile(412, 324, 200, 90),
    relClean(16, 46, 380, 150),
    tyreTemp(16, 206, 185, 150, { title: 'TYRE' }),
    brakes(205, 206, 191, 150),
    w('laptiming', 628, 46, 380, 150, style({ title: 'TIMING', showCurrent: true, showLast: true, showBest: true, showEstimated: true, accentColor: CYAN }), { name: 'LapStack' }),
    stint(628, 206, 185, 150, { title: 'STINT' }),
    tyrePress(817, 206, 191, 150),
    lastTile(16, 362, 190, 60),
    bestTile(210, 362, 186, 60),
    weatherWidget(628, 362, 380, 60),
    hairline(16, 428, 992, 1),
    posTile(16, 438, 190, 148),
    incTile(214, 438, 190, 148),
    fuelTile(412, 438, 150, 148),
    mapClean(570, 438, 200, 148),
    standingsRel(778, 438, 230, 148, 3)
  ]
  return dashboard('Race Sun · Panoramic', 1024, 600, 'A balanced panoramic dry board that fills the canvas: central gear/speed/delta flanked by relatives + tyres + brakes and timing + stint + pressures, with best/last, weather and a position / incidents / fuel / map / standings base.', els)
}

// ── Public catalogue ──────────────────────────────────────────────────────────
export const RACE_SUN_PRESETS: Array<{ id: string; name: string; build: () => Dashboard; tags?: string[] }> = [
  { id: 'race-sun-ddu-dense', name: 'Race Sun · Dense DDU · 1024×600', build: raceSunDenseDdu, tags: ['race', 'sun', 'dry', 'gt3', 'ddu', 'dense', 'endurance', 'warm'] },
  { id: 'race-sun-clean-wheel', name: 'Race Sun · Clean Wheel · 1024×600', build: raceSunCleanWheel, tags: ['race', 'sun', 'dry', 'gt3', 'clean', 'minimal', 'wheel'] },
  { id: 'race-sun-endurance-stint', name: 'Race Sun · Endurance Stint · 1024×600', build: raceSunEnduranceStint, tags: ['race', 'sun', 'dry', 'gt3', 'endurance', 'stint', 'fuel'] },
  { id: 'race-sun-sprint-attack', name: 'Race Sun · Sprint Attack · 1024×600', build: raceSunSprintAttack, tags: ['race', 'sun', 'dry', 'gt3', 'sprint', 'delta', 'attack'] },
  { id: 'race-sun-tyre-thermal', name: 'Race Sun · Tyre Thermal · 1024×600', build: raceSunTyreThermal, tags: ['race', 'sun', 'dry', 'gt3', 'tyres', 'brakes', 'engineering'] },
  { id: 'race-sun-standings-tower', name: 'Race Sun · Standings Tower · 1024×600', build: raceSunStandingsTower, tags: ['race', 'sun', 'dry', 'gt3', 'standings', 'tower', 'timing'] },
  { id: 'race-sun-relatives-traffic', name: 'Race Sun · Relatives Traffic · 1024×600', build: raceSunRelativesTraffic, tags: ['race', 'sun', 'dry', 'gt3', 'relatives', 'radar', 'traffic'] },
  { id: 'race-sun-delta-hero', name: 'Race Sun · Delta Hero · 1024×600', build: raceSunDeltaHero, tags: ['race', 'sun', 'dry', 'gt3', 'delta', 'timing', 'qualy'] },
  { id: 'race-sun-classic-cup', name: 'Race Sun · Classic Cup · 1024×600', build: raceSunClassicCup, tags: ['race', 'sun', 'dry', 'gt3', 'cup', 'classic', 'clean'] },
  { id: 'race-sun-compact-status', name: 'Race Sun · Compact Status · 1024×600', build: raceSunCompactStatus, tags: ['race', 'sun', 'dry', 'gt3', 'amg', 'compact', 'status'] },
  { id: 'race-sun-fuel-strategy', name: 'Race Sun · Fuel Strategy · 1024×600', build: raceSunFuelStrategy, tags: ['race', 'sun', 'dry', 'gt3', 'fuel', 'strategy', 'stint'] },
  { id: 'race-sun-laptiming-focus', name: 'Race Sun · Lap Timing · 1024×600', build: raceSunLaptimingFocus, tags: ['race', 'sun', 'dry', 'gt3', 'laptiming', 'delta', 'timing'] },
  { id: 'race-sun-dual-column', name: 'Race Sun · Dual Column · 1024×600', build: raceSunDualColumn, tags: ['race', 'sun', 'dry', 'gt3', 'symmetric', 'tyres', 'stint'] },
  { id: 'race-sun-hero-gear-wide', name: 'Race Sun · Hero Gear Wide · 1024×600', build: raceSunHeroGearWide, tags: ['race', 'sun', 'dry', 'gt3', 'gear', 'minimal', 'wide'] },
  { id: 'race-sun-engineer-grid', name: 'Race Sun · Engineer Grid · 1024×600', build: raceSunEngineerGrid, tags: ['race', 'sun', 'dry', 'gt3', 'engineering', 'dense', 'setup'] },
  { id: 'race-sun-night-endurance', name: 'Race Sun · Night Endurance · 1024×600', build: raceSunNightEndurance, tags: ['race', 'sun', 'dry', 'gt3', 'endurance', 'stint', 'traffic'] },
  { id: 'race-sun-minimal-amber', name: 'Race Sun · Minimal Amber · 1024×600', build: raceSunMinimalAmber, tags: ['race', 'sun', 'dry', 'gt3', 'minimal', 'amber', 'clean'] },
  { id: 'race-sun-triple-band', name: 'Race Sun · Triple Band · 1024×600', build: raceSunTripleBand, tags: ['race', 'sun', 'dry', 'gt3', 'bands', 'dense', 'status'] },
  { id: 'race-sun-gaps-battle', name: 'Race Sun · Gaps Battle · 1024×600', build: raceSunGapsBattle, tags: ['race', 'sun', 'dry', 'gt3', 'gaps', 'relatives', 'battle'] },
  { id: 'race-sun-panoramic', name: 'Race Sun · Panoramic · 1024×600', build: raceSunPanoramic, tags: ['race', 'sun', 'dry', 'gt3', 'panoramic', 'balanced', 'dense'] }
]

export const RACE_SUN_PRESET_IDS: string[] = RACE_SUN_PRESETS.map((p) => p.id)
