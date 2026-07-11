// ─── Race "Chase / Attack" dashboard catalogue (2nd-place-and-below) ──────────
// Twenty original 1024×600 race dashboards for when you are NOT leading: the
// whole layout is a mirror of a leader dash but re-pointed at the car AHEAD.
// The strategic story on every screen is "close the gap to the car in front":
//
//   • DELTA to the car ahead  →  gapAheadFmt   (label 'AHEAD', prominent)
//   • estimated pace          →  estLapFmt     (label 'PACE')
//   • gap to the session best →  deltaSessionBestFmt (label 'S.BEST')
//   • your last / best lap    →  lastLapFmt / bestLapFmt
//   • relatives strip         →  relatives-clean / relatives-elaborate
//
// The "pace of the car ahead" has no exact telemetry binding, so it is
// approximated with the relatives strip (which shows the ahead car's last lap)
// plus gapAhead trend (a deltabar bound to gapAhead on the busier layouts).
//
// This module is SELF-CONTAINED like `dashboards-r16.ts`: it imports ONLY the
// TYPES from `./dashboards` and defines its own colour tokens + element helpers
// locally (faithful mirrors of the `dashboards.ts` originals, identical names and
// signatures). That keeps it a one-way, compile-time-only leaf with no runtime
// import of the shared preset module, and immune to churn in that file.
// `dashboards.ts` spreads RACE_CHASE_PRESETS into BUILTIN_PRESETS.
//
// COLOUR RULE (Gui): warm tokens (amber/red) drive chrome, position and warning
// tells; cool/green tones are reserved for the positive "closing / good" states —
// a shrinking gap ahead, a faster estimated lap, a green delta.

import type {
  Dashboard,
  DashboardElement,
  DashboardElementStyle,
  DashboardElementType,
  DashboardPreset
} from './dashboards'

// ── Colour + type tokens (mirror the dashboards.ts values) ────────────────────
const RACE_BG = '#000000'
const PANEL = '#000000'
const STROKE = '#1F1F1F'
const TEXT = '#F4F4F4'
const MUTED = '#7A7A7A'
const CYAN = '#00BFFF'
const GREEN = '#1AFF6E'
const AMBER = '#FFB800'
const RED = '#FF2200'
const FONT_TECH = '"Avenir Next", "Bahnschrift", "Segoe UI", system-ui, sans-serif'
const FONT_COND = '"Avenir Next Condensed", "DIN Condensed", "Arial Narrow", system-ui, sans-serif'
const FONT_NUM = '"DSEG7 Classic", "DS-Digital", "SF Mono", "Cascadia Mono", ui-monospace, monospace'

const TARGET_W = 1024
const TARGET_H = 600

// ── Element helpers (faithful local copies of the dashboards.ts primitives) ───
function createDashboardId(): string {
  return `dash-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function createElementId(): string {
  return `el-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function style(extra: Partial<DashboardElementStyle> = {}): DashboardElementStyle {
  return { background: PANEL, border: STROKE, borderWidth: 1, radius: 12, color: TEXT, fontFamily: FONT_TECH, ...extra }
}

function w(
  type: DashboardElementType,
  x: number,
  y: number,
  width: number,
  height: number,
  st: DashboardElementStyle,
  options: { binding?: string; name?: string } = {}
): DashboardElement {
  return { id: createElementId(), type, x, y, w: width, h: height, style: st, binding: options.binding, name: options.name }
}

// Borderless floating value (the minimal readout): big value, optional tiny label.
function cv(
  binding: string,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  opts: Partial<DashboardElementStyle> = {},
  type: DashboardElementType = 'value'
): DashboardElement {
  return w(
    type,
    x,
    y,
    width,
    height,
    { background: 'transparent', borderWidth: 0, color: TEXT, fontFamily: FONT_NUM, label, ...opts },
    { binding, name: (label || binding).replace(/\s+/g, '') }
  )
}

// The single dominant gear numeral every GT3 dash is anchored on.
function heroGear(x: number, y: number, width: number, height: number): DashboardElement {
  return cv('gearLabel', x, y, width, height, '', { fontFamily: FONT_COND, color: TEXT, minFontSize: 80, maxFontSize: 460 })
}

// The one top RPM/shift bar — segmented green→amber→red, NO numbers, no box.
function topRevBar(x: number, y: number, width: number, height: number, segments = 22): DashboardElement {
  return w(
    'shiftbar',
    x,
    y,
    width,
    height,
    { background: 'transparent', borderWidth: 0, radius: 1, segments, flashAt: 0.97, warnAt: 0.55, dangerAt: 0.8, segmentShape: 'led', fillColor: GREEN, warnColor: AMBER, dangerColor: RED, accentColor: GREEN },
    { binding: 'shiftPct', name: 'TopRevBar' }
  )
}

// Hairline separator (1px) — the only permitted divider.
function hairline(x: number, y: number, width: number, height: number): DashboardElement {
  return w('rect', x, y, width, height, { background: STROKE, borderWidth: 0, radius: 0 }, { name: 'Hairline' })
}

function scaleStyleFonts(st: DashboardElementStyle, sf: number): DashboardElementStyle {
  if (sf === 1) return st
  const out: DashboardElementStyle = { ...st }
  if (typeof out.fontSize === 'number') out.fontSize = Math.max(8, Math.round(out.fontSize * sf))
  if (typeof out.minFontSize === 'number') out.minFontSize = Math.max(8, Math.round(out.minFontSize * sf))
  if (typeof out.maxFontSize === 'number') out.maxFontSize = Math.max(10, Math.round(out.maxFontSize * sf))
  return out
}

// Normalise a preset onto the single 1024×600 canvas (native = identity).
function dashboard(name: string, width: number, height: number, description: string, elements: DashboardElement[]): Dashboard {
  const now = Date.now()
  const sx = TARGET_W / width
  const sy = TARGET_H / height
  const sf = Math.min(sx, sy)
  const offsetX = Math.round((TARGET_W - width * sf) / 2)
  const offsetY = Math.round((TARGET_H - height * sf) / 2)
  const scaled =
    sf === 1 && offsetX === 0 && offsetY === 0
      ? elements
      : elements.map((el) => ({
          ...el,
          x: Math.round(el.x * sf) + offsetX,
          y: Math.round(el.y * sf) + offsetY,
          w: Math.round(el.w * sf),
          h: Math.round(el.h * sf),
          style: scaleStyleFonts(el.style, sf)
        }))
  const cleanName = name.replace(/\s*·\s*\d+\s*[×x]\s*\d+\s*$/i, '').trim()
  const finalName = `${cleanName} · ${TARGET_W}×${TARGET_H}`
  return { id: createDashboardId(), name: finalName, width: TARGET_W, height: TARGET_H, bg: RACE_BG, scaleMode: 'fit', description, elements: scaled, createdAt: now, updatedAt: now }
}

type Opts = Partial<DashboardElementStyle>

// ── Mandatory + chase atoms ───────────────────────────────────────────────────
// Every builder below composes from these so the mandatory set (rev / gear / map
// / position / incidents / fuel / weather+track) and the chaser story (AHEAD /
// PACE / S.BEST / LAST / BEST / relatives) is guaranteed present on all 20.

// First element of every dashboard: the pure-black backplate.
function bg(): DashboardElement {
  return w('rect', 0, 0, 1024, 600, { background: RACE_BG, borderWidth: 0, radius: 0 }, { name: 'Backplate' })
}

// RevLights — the single top segmented RPM/shift bar.
function rev(x: number, y: number, wd: number, ht: number, seg = 20): DashboardElement {
  return topRevBar(x, y, wd, ht, seg)
}

// Gear — the dominant central numeral.
function gear(x: number, y: number, wd: number, ht: number): DashboardElement {
  return heroGear(x, y, wd, ht)
}

// DELTA to the car AHEAD — the prominent chaser readout (green = closing).
function ahead(x: number, y: number, wd: number, ht: number, opts: Opts = {}): DashboardElement {
  return cv('gapAheadFmt', x, y, wd, ht, 'AHEAD', {
    accentColor: GREEN,
    fontFamily: FONT_NUM,
    minFontSize: 26,
    maxFontSize: 96,
    ...opts
  })
}

// Estimated pace (best proxy for the car-ahead pace target).
function pace(x: number, y: number, wd: number, ht: number, opts: Opts = {}): DashboardElement {
  return cv('estLapFmt', x, y, wd, ht, 'PACE', { accentColor: CYAN, minFontSize: 18, maxFontSize: 56, ...opts })
}

// Gap to the session best lap.
function sbest(x: number, y: number, wd: number, ht: number, opts: Opts = {}): DashboardElement {
  return cv('deltaSessionBestFmt', x, y, wd, ht, 'S.BEST', { accentColor: CYAN, minFontSize: 16, maxFontSize: 48, ...opts })
}

function last(x: number, y: number, wd: number, ht: number, opts: Opts = {}): DashboardElement {
  return cv('lastLapFmt', x, y, wd, ht, 'LAST', { accentColor: TEXT, minFontSize: 16, maxFontSize: 48, ...opts })
}

function best(x: number, y: number, wd: number, ht: number, opts: Opts = {}): DashboardElement {
  return cv('bestLapFmt', x, y, wd, ht, 'BEST', { accentColor: MUTED, minFontSize: 16, maxFontSize: 46, ...opts })
}

// Position — mandatory (amber).
function pos(x: number, y: number, wd: number, ht: number, opts: Opts = {}): DashboardElement {
  return cv('position', x, y, wd, ht, 'POS', { accentColor: AMBER, minFontSize: 22, maxFontSize: 72, ...opts })
}

// Incidents — mandatory (red).
function inc(x: number, y: number, wd: number, ht: number, opts: Opts = {}): DashboardElement {
  return cv('incidentCount', x, y, wd, ht, 'INC', { accentColor: RED, minFontSize: 20, maxFontSize: 56, ...opts })
}

// Fuel — mandatory.
function fuel(x: number, y: number, wd: number, ht: number, opts: Opts = {}): DashboardElement {
  return cv('fuelLitersStr', x, y, wd, ht, 'FUEL', { accentColor: AMBER, suffix: 'L', minFontSize: 18, maxFontSize: 52, ...opts })
}

function speed(x: number, y: number, wd: number, ht: number, opts: Opts = {}): DashboardElement {
  return cv('speedKmh', x, y, wd, ht, '', { fontFamily: FONT_NUM, suffix: 'km/h', minFontSize: 22, maxFontSize: 84, ...opts })
}

// Track + weather tiles.
function trackTemp(x: number, y: number, wd: number, ht: number, opts: Opts = {}): DashboardElement {
  return cv('trackTempC', x, y, wd, ht, 'TRACK', { accentColor: TEXT, suffix: '°', minFontSize: 16, maxFontSize: 46, ...opts })
}

function airTemp(x: number, y: number, wd: number, ht: number, opts: Opts = {}): DashboardElement {
  return cv('airTempC', x, y, wd, ht, 'AIR', { accentColor: MUTED, suffix: '°', minFontSize: 16, maxFontSize: 44, ...opts })
}

function weather(x: number, y: number, wd: number, ht: number, accent = CYAN): DashboardElement {
  return w('weather', x, y, wd, ht, style({ title: 'TRACK', radius: 12, accentColor: accent, minFontSize: 13, maxFontSize: 28 }), { name: 'Weather' })
}

// Contextual tiles (variety).
function delta(x: number, y: number, wd: number, ht: number, opts: Opts = {}): DashboardElement {
  return cv('deltaSec', x, y, wd, ht, 'DELTA', { accentColor: GREEN, minFontSize: 18, maxFontSize: 52, ...opts })
}

function behind(x: number, y: number, wd: number, ht: number, opts: Opts = {}): DashboardElement {
  return cv('gapBehindFmt', x, y, wd, ht, 'BEHIND', { accentColor: RED, minFontSize: 16, maxFontSize: 46, ...opts })
}

function timeLeft(x: number, y: number, wd: number, ht: number, opts: Opts = {}): DashboardElement {
  return cv('sessionTimeLeftFmt', x, y, wd, ht, 'TIME', { accentColor: TEXT, minFontSize: 16, maxFontSize: 42, ...opts })
}

function flagChip(x: number, y: number, wd: number, ht: number): DashboardElement {
  return cv('flagLabel', x, y, wd, ht, '', { accentColor: AMBER, minFontSize: 12, maxFontSize: 30 })
}

function pitChip(x: number, y: number, wd: number, ht: number): DashboardElement {
  return cv('pitLimiter', x, y, wd, ht, '', { accentColor: CYAN, minFontSize: 12, maxFontSize: 30 })
}

// MAP — the mandatory track map (clean / elaborate / mini variants).
function mapClean(x: number, y: number, wd: number, ht: number, accent = CYAN): DashboardElement {
  return w('trackmap-clean', x, y, wd, ht, { background: 'transparent', borderWidth: 0, radius: 0, accentColor: accent, color: MUTED, showIcon: false }, { binding: 'lapDistPct', name: 'TrackMap' })
}

function mapElaborate(x: number, y: number, wd: number, ht: number, accent = CYAN): DashboardElement {
  return w('trackmap-elaborate', x, y, wd, ht, { background: 'transparent', borderWidth: 0, radius: 0, accentColor: accent, color: MUTED, showIcon: false }, { binding: 'lapDistPct', name: 'TrackMapX' })
}

function mapMini(x: number, y: number, wd: number, ht: number, accent = CYAN): DashboardElement {
  return w('trackmini', x, y, wd, ht, style({ radius: 10, accentColor: accent }), { binding: 'lapDistPct', name: 'TrackMini' })
}

// Relatives strip — highlights the car AHEAD (±1 car / name·gap·last).
function relClean(x: number, y: number, wd: number, ht: number, accent = AMBER): DashboardElement {
  return w('relatives-clean', x, y, wd, ht, { background: 'transparent', borderWidth: 0, radius: 0, accentColor: accent, reference: 'AHEAD', showIcon: false, minFontSize: 13, maxFontSize: 26 }, { name: 'RelAhead' })
}

function relElaborate(x: number, y: number, wd: number, ht: number, accent = AMBER): DashboardElement {
  return w('relatives-elaborate', x, y, wd, ht, { background: 'transparent', borderWidth: 0, radius: 0, accentColor: accent, reference: 'NAME / GAP / LAST', showIcon: false, minFontSize: 13, maxFontSize: 26 }, { name: 'RelAheadX' })
}

function radar(x: number, y: number, wd: number, ht: number, accent = CYAN): DashboardElement {
  return w('radar-clean', x, y, wd, ht, { background: 'transparent', borderWidth: 0, radius: 0, accentColor: accent, showIcon: false }, { name: 'Radar' })
}

// Semantic GT3 cards used for layout variety.
function deltaCard(x: number, y: number, wd: number, ht: number, accent = GREEN): DashboardElement {
  return w('deltatile', x, y, wd, ht, style({ title: 'DELTA', deltaReference: 'session', deltaRangeSec: 1, radius: 12, accentColor: accent }), { name: 'DeltaTile' })
}

function lapCard(x: number, y: number, wd: number, ht: number, accent = CYAN): DashboardElement {
  return w('laptiming', x, y, wd, ht, style({ title: 'TIMING', showCurrent: true, showLast: true, showBest: true, showEstimated: true, radius: 12, accentColor: accent }), { name: 'LapTiming' })
}

function posGaps(x: number, y: number, wd: number, ht: number, accent = AMBER): DashboardElement {
  return w('positiongaps', x, y, wd, ht, style({ showTotal: true, radius: 12, accentColor: accent, minFontSize: 16, maxFontSize: 44 }), { name: 'PosGaps' })
}

function fuelCard(x: number, y: number, wd: number, ht: number, accent = AMBER): DashboardElement {
  return w('fuelstint', x, y, wd, ht, style({ title: 'FUEL', reserveLaps: 1, warnAtLaps: 2, radius: 12, accentColor: accent }), { name: 'FuelStint' })
}

// A deltabar bound to gapAhead — visualises closing on the car ahead.
function closeBar(x: number, y: number, wd: number, ht: number): DashboardElement {
  return w('deltabar', x, y, wd, ht, style({ background: '#000000', radius: 999, fillColor: GREEN, dangerColor: RED, deltaRangeSec: 2 }), { binding: 'gapAhead', name: 'AheadCloseBar' })
}

function setupStrip(x: number, y: number, wd: number, ht: number, accent = CYAN): DashboardElement {
  return w('setupstrip', x, y, wd, ht, style({ fields: ['abs', 'tc', 'map', 'bb', 'limiter'], radius: 10, accentColor: accent }), { name: 'SetupStrip' })
}

function flagStrip(x: number, y: number, wd: number, ht: number, accent = AMBER): DashboardElement {
  return w('flagoverlay', x, y, wd, ht, style({ compact: true, includeIncidents: true, radius: 10, accentColor: accent }), { name: 'FlagStrip' })
}

// ── 20 builders ───────────────────────────────────────────────────────────────

// #1 Apex — centre gear, left relatives, right map, bottom chase grid.
function d01(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    rev(16, 10, 992, 18, 20),
    relClean(16, 40, 320, 258, AMBER),
    gear(372, 40, 280, 224),
    speed(372, 270, 280, 28),
    mapClean(672, 40, 336, 196, CYAN),
    weather(672, 244, 164, 54, CYAN),
    trackTemp(844, 244, 164, 54),
    hairline(16, 308, 992, 1),
    ahead(16, 320, 300, 144, { maxFontSize: 92 }),
    pace(332, 320, 208, 144, { maxFontSize: 56 }),
    sbest(556, 320, 208, 144),
    last(772, 320, 236, 68),
    best(772, 396, 236, 68),
    hairline(16, 472, 992, 1),
    pos(16, 482, 300, 102),
    inc(332, 482, 208, 102),
    fuel(556, 482, 208, 102),
    delta(772, 482, 236, 102)
  ]
  return dashboard('Race Chase · Apex', 1024, 600, 'Chaser dash focused on the car ahead: centre gear, a car-ahead relatives rail on the left, live track map top-right and a bottom band led by a prominent AHEAD gap with PACE, session-best delta and your last/best lap.', elements)
}

// #2 Aggressor — big LEFT gear, right chase stack, bottom relatives + mini map.
function d02(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    rev(16, 12, 992, 22, 24),
    gear(16, 52, 300, 320),
    speed(16, 380, 300, 56),
    ahead(332, 52, 340, 150, { maxFontSize: 96 }),
    pace(688, 52, 320, 150),
    sbest(332, 214, 220, 110),
    last(560, 214, 220, 110),
    best(788, 214, 220, 110),
    pos(332, 336, 220, 120),
    inc(560, 336, 220, 120),
    fuel(788, 336, 220, 120),
    relElaborate(16, 468, 470, 116, AMBER),
    mapMini(500, 468, 300, 116, CYAN),
    weather(816, 468, 192, 56, CYAN),
    trackTemp(816, 528, 192, 56)
  ]
  return dashboard('Race Chase · Aggressor', 1024, 600, 'Attack layout with a dominant left gear anchor and a right-hand chase stack: AHEAD gap and PACE up top, then session-best delta with last/best and the position/incidents/fuel row, closed by a full car-ahead relatives strip and a mini map along the bottom.', elements)
}

// #3 Predator — big RIGHT gear, left chase column, relatives strip top, map bottom-left.
function d03(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    rev(16, 12, 992, 20, 22),
    relClean(16, 44, 640, 86, AMBER),
    gear(700, 44, 308, 320),
    speed(700, 372, 308, 54),
    ahead(16, 144, 300, 150, { maxFontSize: 92 }),
    pace(332, 144, 324, 72),
    sbest(332, 224, 324, 70),
    last(16, 304, 206, 84),
    best(232, 304, 206, 84),
    pos(440, 304, 216, 84),
    mapElaborate(16, 404, 320, 180, CYAN),
    weather(352, 404, 150, 84, CYAN),
    trackTemp(510, 404, 146, 84),
    inc(352, 496, 150, 88),
    fuel(510, 496, 146, 88),
    delta(700, 440, 308, 144)
  ]
  return dashboard('Race Chase · Predator', 1024, 600, 'Right-anchored gear with the whole left half turned into an attack column: a car-ahead relatives banner up top, a big AHEAD gap with PACE and session-best delta, your last/best/position, and an elaborate track map with weather and track-temp tiles bottom-left.', elements)
}

// #4 Slipstream — AHEAD banner across the top, gear centre, quad tiles below.
function d04(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    rev(16, 10, 992, 16, 20),
    ahead(16, 34, 560, 120, { maxFontSize: 104 }),
    pace(588, 34, 420, 120, { maxFontSize: 64 }),
    relElaborate(16, 166, 320, 220, AMBER),
    gear(372, 166, 280, 220),
    mapClean(688, 166, 320, 220, CYAN),
    sbest(16, 396, 236, 88),
    last(268, 396, 236, 88),
    best(520, 396, 236, 88),
    weather(772, 396, 236, 88, CYAN),
    pos(16, 492, 190, 92),
    inc(214, 492, 190, 92),
    fuel(412, 492, 190, 92),
    trackTemp(610, 492, 190, 92),
    speed(808, 492, 200, 92)
  ]
  return dashboard('Race Chase · Slipstream', 1024, 600, 'A top slipstream HUD: an oversized AHEAD gap and PACE banner spans the header, a relatives / gear / map trio sits mid-screen, and two clean tile rows carry session-best, last/best, position, incidents, fuel and the track weather.', elements)
}

// #5 Endurance — GT3 cards (delta / laptiming / positiongaps / fuelstint) + mandatory tiles.
function d05(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    rev(16, 12, 992, 20, 22),
    ahead(16, 44, 300, 150, { maxFontSize: 92 }),
    gear(360, 44, 180, 150),
    pace(560, 44, 220, 150),
    relClean(788, 44, 220, 150, AMBER),
    deltaCard(16, 206, 236, 150, GREEN),
    lapCard(268, 206, 236, 150, CYAN),
    posGaps(520, 206, 236, 150, AMBER),
    mapClean(772, 206, 236, 150, CYAN),
    hairline(16, 368, 992, 1),
    sbest(16, 378, 192, 94),
    last(216, 378, 192, 94),
    best(416, 378, 192, 94),
    weather(616, 378, 192, 94, CYAN),
    trackTemp(816, 378, 192, 94),
    pos(16, 480, 236, 104),
    inc(268, 480, 236, 104),
    fuel(520, 480, 236, 104),
    fuelCard(772, 480, 236, 104, AMBER)
  ]
  return dashboard('Race Chase · Endurance', 1024, 600, 'Endurance chase cluster: AHEAD gap, gear, PACE and a car-ahead relatives strip on top, then predictive-delta, lap-timing, position-gaps and track-map cards, with a full mandatory tile grid (session-best, last/best, position, incidents, fuel + stint) below.', elements)
}

// #6 Overtake — huge central AHEAD hero, gear left.
function d06(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    rev(16, 10, 992, 16, 20),
    gear(16, 40, 240, 260),
    speed(16, 306, 240, 60),
    ahead(288, 40, 448, 260, { maxFontSize: 150 }),
    pace(768, 40, 240, 124),
    sbest(768, 172, 240, 128),
    relClean(16, 378, 470, 96, AMBER),
    mapMini(500, 378, 240, 96, CYAN),
    weather(756, 378, 124, 96, CYAN),
    trackTemp(884, 378, 124, 96),
    last(16, 482, 190, 102),
    best(214, 482, 190, 102),
    pos(412, 482, 190, 102),
    inc(610, 482, 190, 102),
    fuel(808, 482, 200, 102)
  ]
  return dashboard('Race Chase · Overtake', 1024, 600, 'Overtake-mode dash: a giant central AHEAD gap dominates the screen with PACE and session-best delta beside it, gear/speed on the left, a car-ahead relatives strip and map mid, and last/best, position, incidents and fuel along the bottom.', elements)
}

// #7 Draft — big central track map, gear left, chase right.
function d07(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    rev(16, 12, 992, 20, 22),
    gear(16, 52, 220, 240),
    speed(16, 300, 220, 56),
    mapElaborate(252, 52, 520, 304, CYAN),
    ahead(788, 52, 220, 150, { maxFontSize: 80 }),
    pace(788, 214, 220, 142),
    relClean(16, 368, 360, 100, AMBER),
    weather(392, 368, 180, 100, CYAN),
    trackTemp(580, 368, 180, 100),
    sbest(776, 368, 232, 100),
    last(16, 478, 190, 106),
    best(214, 478, 190, 106),
    pos(412, 478, 190, 106),
    inc(610, 478, 190, 106),
    fuel(808, 478, 200, 106)
  ]
  return dashboard('Race Chase · Draft', 1024, 600, 'Map-centric drafting dash: a large elaborate track map fills the middle to plan the attack, gear/speed on the left, AHEAD gap and PACE stacked on the right, and relatives, weather, session-best plus the last/best/position/incidents/fuel row below.', elements)
}

// #8 Relative — radar + relatives rail left, gear centre, chase top-right.
function d08(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    rev(16, 10, 992, 16, 18),
    relClean(16, 36, 240, 300, AMBER),
    radar(16, 346, 240, 238, CYAN),
    gear(288, 36, 260, 240),
    speed(288, 282, 260, 54),
    ahead(580, 36, 428, 120, { maxFontSize: 96 }),
    pace(580, 164, 210, 112),
    sbest(796, 164, 212, 112),
    mapClean(288, 346, 300, 150, CYAN),
    delta(288, 500, 300, 84),
    weather(600, 346, 196, 72, CYAN),
    trackTemp(812, 346, 196, 72),
    last(600, 426, 196, 72),
    best(812, 426, 196, 72),
    pos(600, 506, 128, 78),
    inc(732, 506, 128, 78),
    fuel(864, 506, 144, 78)
  ]
  return dashboard('Race Chase · Relative', 1024, 600, 'Spotter-style attack dash: a car-ahead relatives rail over a proximity radar on the left, a centre gear, a wide AHEAD gap with PACE and session-best top-right, and a compact map + weather/track + last/best + position/incidents/fuel block bottom-right.', elements)
}

// #9 Vanguard — top chase HUD, gear low-centre.
function d09(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    rev(16, 12, 992, 24, 26),
    ahead(16, 50, 330, 150, { maxFontSize: 96 }),
    pace(362, 50, 320, 150),
    sbest(698, 50, 310, 150),
    relClean(16, 212, 480, 110, AMBER),
    mapElaborate(512, 212, 300, 110, CYAN),
    weather(828, 212, 180, 52, CYAN),
    trackTemp(828, 270, 180, 52),
    last(16, 336, 180, 96),
    best(16, 436, 180, 96),
    pos(204, 336, 180, 96),
    inc(204, 436, 180, 96),
    gear(392, 336, 240, 200),
    fuel(648, 336, 180, 96),
    delta(648, 436, 180, 96),
    speed(836, 336, 172, 196)
  ]
  return dashboard('Race Chase · Vanguard', 1024, 600, 'Top-heavy vanguard HUD: AHEAD gap, PACE and session-best delta run across the header, a relatives strip, map and weather sit mid, and a low band frames the gear with last/best, position/incidents, fuel/delta and a tall speed readout.', elements)
}

// #10 Columns — three vertical thirds.
function d10(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    rev(16, 12, 992, 18, 20),
    gear(16, 44, 320, 240),
    speed(16, 290, 320, 52),
    ahead(16, 350, 320, 110, { maxFontSize: 76 }),
    relElaborate(16, 468, 320, 116, AMBER),
    pace(352, 44, 320, 110),
    sbest(352, 160, 320, 110),
    mapClean(352, 276, 320, 180, CYAN),
    last(352, 462, 156, 122),
    best(512, 462, 160, 122),
    pos(688, 44, 320, 110),
    inc(688, 160, 156, 110),
    fuel(852, 160, 156, 110),
    weather(688, 276, 156, 180, CYAN),
    trackTemp(852, 276, 156, 88),
    delta(852, 368, 156, 88),
    behind(688, 462, 320, 122)
  ]
  return dashboard('Race Chase · Columns', 1024, 600, 'Three-column chaser: the left column stacks gear, speed, AHEAD gap and relatives; the centre holds PACE, session-best, map and last/best; the right column carries position, incidents/fuel, weather/track, delta and the car-behind gap for full race awareness.', elements)
}

// #11 Minimal — few big elements, dominant AHEAD.
function d11(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    rev(212, 18, 600, 16, 16),
    ahead(16, 44, 470, 190, { maxFontSize: 150 }),
    gear(520, 44, 240, 190),
    pace(788, 44, 220, 190),
    sbest(16, 250, 300, 120),
    relClean(332, 250, 360, 120, AMBER),
    mapMini(708, 250, 300, 120, CYAN),
    last(16, 384, 236, 86),
    best(268, 384, 236, 86),
    pos(520, 384, 236, 86),
    inc(772, 384, 236, 86),
    weather(16, 484, 300, 100, CYAN),
    trackTemp(332, 484, 168, 100),
    fuel(516, 484, 236, 100),
    speed(772, 484, 236, 100)
  ]
  return dashboard('Race Chase · Minimal', 1024, 600, 'Restrained minimal chaser: a dominant AHEAD gap next to gear and a big PACE, one row of session-best / relatives / map, then generously spaced last/best, position, incidents, weather, track, fuel and speed tiles — few elements, one job: close the gap.', elements)
}

// #12 Cockpit — dense tiles ringing the centre gear.
function d12(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    rev(16, 10, 992, 14, 22),
    pos(16, 40, 158, 72),
    inc(182, 40, 158, 72),
    fuel(348, 40, 158, 72),
    sbest(514, 40, 158, 72),
    last(680, 40, 158, 72),
    best(846, 40, 158, 72),
    ahead(16, 120, 200, 150, { maxFontSize: 80 }),
    pace(16, 278, 200, 130),
    mapMini(224, 120, 180, 180, CYAN),
    weather(224, 308, 180, 100, CYAN),
    gear(412, 120, 200, 240),
    speed(412, 364, 200, 44),
    trackTemp(620, 120, 180, 88),
    radar(620, 216, 184, 184, CYAN),
    relClean(808, 120, 200, 288, AMBER),
    closeBar(16, 470, 470, 26),
    delta(16, 504, 230, 80),
    behind(252, 504, 234, 80),
    airTemp(500, 416, 240, 80),
    timeLeft(500, 504, 240, 80),
    posGaps(756, 416, 252, 168, AMBER)
  ]
  return dashboard('Race Chase · Cockpit', 1024, 600, 'Dense cockpit: a full telemetry ring (position, incidents, fuel, session-best, last/best) around a centre gear, AHEAD/PACE on the left, mini map + radar + car-ahead relatives around it, and a closing-gap deltabar with delta, behind, air/track, time and position-gaps below.', elements)
}

// #13 Split — halved top (relatives | map), gear centre, chase bottom.
function d13(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    rev(16, 12, 992, 20, 22),
    relClean(16, 44, 488, 150, AMBER),
    mapElaborate(520, 44, 488, 150, CYAN),
    ahead(16, 206, 300, 150, { maxFontSize: 92 }),
    gear(392, 206, 240, 150),
    pace(708, 206, 300, 72),
    sbest(708, 284, 300, 72),
    hairline(16, 368, 992, 1),
    last(16, 378, 236, 96),
    best(268, 378, 236, 96),
    weather(520, 378, 236, 96, CYAN),
    trackTemp(772, 378, 236, 96),
    pos(16, 482, 190, 102),
    inc(214, 482, 190, 102),
    fuel(412, 482, 190, 102),
    speed(610, 482, 190, 102),
    delta(808, 482, 200, 102)
  ]
  return dashboard('Race Chase · Split', 1024, 600, 'Cleanly split chaser: a full car-ahead relatives half beside a track-map half up top, a centre gear flanked by AHEAD gap and PACE / session-best, then a hairline-divided grid of last/best, weather/track, position, incidents, fuel, speed and delta.', elements)
}

// #14 Rally — asymmetric: big left map, small top-right gear.
function d14(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    rev(16, 12, 992, 18, 20),
    mapElaborate(16, 44, 440, 300, CYAN),
    gear(788, 44, 220, 200),
    ahead(476, 44, 296, 150, { maxFontSize: 88 }),
    pace(476, 206, 296, 138),
    relClean(788, 258, 220, 86, AMBER),
    sbest(16, 358, 300, 100),
    last(332, 358, 220, 100),
    best(560, 358, 212, 100),
    weather(788, 358, 220, 100, CYAN),
    pos(16, 468, 236, 116),
    inc(268, 468, 236, 116),
    fuel(520, 468, 236, 116),
    trackTemp(772, 468, 118, 116),
    speed(898, 468, 110, 116)
  ]
  return dashboard('Race Chase · Rally', 1024, 600, 'Asymmetric rally chaser: a large elaborate map dominates the left, a compact gear sits top-right, the AHEAD gap and PACE fill the centre with a car-ahead relatives strip beneath the gear, and session-best, last/best, weather, position, incidents, fuel and speed line the base.', elements)
}

// #15 Closer — wide closing deltabar on the car ahead.
function d15(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    rev(16, 12, 992, 20, 22),
    gear(16, 52, 260, 280),
    speed(16, 338, 260, 56),
    pos(16, 402, 260, 86),
    inc(16, 494, 124, 90),
    fuel(152, 494, 124, 90),
    ahead(300, 52, 360, 160, { maxFontSize: 104 }),
    pace(684, 52, 324, 160),
    sbest(300, 222, 360, 110),
    relClean(684, 222, 324, 110, AMBER),
    mapClean(300, 344, 220, 120, CYAN),
    weather(536, 344, 124, 120, CYAN),
    last(684, 344, 158, 120),
    best(846, 344, 162, 120),
    closeBar(300, 478, 708, 30),
    trackTemp(300, 518, 224, 66),
    delta(540, 518, 224, 66),
    behind(780, 518, 228, 66)
  ]
  return dashboard('Race Chase · Closer', 1024, 600, 'Built around a wide closing-gap deltabar: gear, speed, position, incidents and fuel on the left, a big AHEAD gap and PACE up top, session-best and car-ahead relatives, map/weather and your last/best, then the gapAhead bar with track, delta and behind readouts.', elements)
}

// #16 Marshal — flag / pit tells + setup strip.
function d16(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    rev(16, 12, 992, 20, 22),
    flagChip(16, 44, 120, 80),
    setupStrip(148, 44, 712, 80, CYAN),
    pitChip(872, 44, 120, 80),
    ahead(16, 140, 180, 150, { maxFontSize: 76 }),
    pace(16, 298, 180, 116),
    sbest(204, 140, 196, 116),
    last(204, 266, 196, 148),
    gear(412, 140, 200, 220),
    speed(412, 364, 200, 50),
    relClean(628, 140, 380, 110, AMBER),
    mapClean(628, 258, 380, 156, CYAN),
    best(16, 424, 190, 72),
    pos(16, 504, 190, 80),
    inc(214, 424, 190, 72),
    fuel(214, 504, 190, 80),
    weather(412, 424, 236, 160, CYAN),
    trackTemp(656, 424, 170, 160),
    delta(834, 424, 174, 160)
  ]
  return dashboard('Race Chase · Marshal', 1024, 600, 'Race-control flavoured chaser: flag and pit-limiter tells flank a full ABS/TC/MAP/BB/limiter setup strip up top, then AHEAD gap, PACE, session-best and last, a centre gear, car-ahead relatives and map, and a base row of best/position, incidents/fuel, weather, track and delta.', elements)
}

// #17 Timing — laptiming card right, gear left, AHEAD top.
function d17(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    rev(16, 12, 992, 18, 20),
    ahead(16, 44, 470, 120, { maxFontSize: 96 }),
    pace(500, 44, 300, 120),
    sbest(812, 44, 196, 120),
    gear(16, 180, 300, 260),
    speed(16, 446, 300, 54),
    relClean(336, 180, 340, 120, AMBER),
    mapClean(336, 312, 340, 188, CYAN),
    lapCard(692, 180, 316, 150, CYAN),
    weather(692, 338, 156, 162, CYAN),
    trackTemp(852, 338, 156, 80),
    delta(852, 420, 156, 80),
    hairline(16, 512, 992, 1),
    last(16, 520, 190, 64),
    best(214, 520, 190, 64),
    pos(412, 520, 190, 64),
    inc(610, 520, 190, 64),
    fuel(808, 520, 200, 64)
  ]
  return dashboard('Race Chase · Timing', 1024, 600, 'Timing-forward chaser: AHEAD gap, PACE and session-best across the top, gear and speed on the left, car-ahead relatives over a track map in the centre, a full lap-timing card with weather/track/delta on the right, and a thin last/best/position/incidents/fuel footer.', elements)
}

// #18 Elaborate — big elaborate map right, chase column left.
function d18(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    rev(16, 12, 992, 20, 22),
    ahead(16, 44, 340, 150, { maxFontSize: 92 }),
    pace(16, 204, 340, 120),
    sbest(16, 332, 340, 110),
    gear(372, 44, 240, 220),
    speed(372, 272, 240, 60),
    relClean(372, 340, 240, 102, AMBER),
    mapElaborate(628, 44, 380, 300, CYAN),
    weather(628, 354, 190, 88, CYAN),
    trackTemp(824, 354, 184, 88),
    hairline(16, 446, 992, 1),
    last(16, 456, 190, 128),
    best(214, 456, 190, 128),
    pos(412, 456, 190, 128),
    inc(610, 456, 190, 128),
    fuel(808, 456, 200, 128)
  ]
  return dashboard('Race Chase · Elaborate', 1024, 600, 'A left chase column — AHEAD gap, PACE and session-best delta — beside a centre gear with speed and a car-ahead relatives strip, a large elaborate track map with weather/track tiles on the right, and a clean last/best/position/incidents/fuel base row.', elements)
}

// #19 Quad — symmetric quadrants around a centre gear.
function d19(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    rev(16, 12, 992, 18, 20),
    // Left chase quadrant.
    ahead(16, 42, 292, 120, { maxFontSize: 88 }),
    pace(16, 170, 292, 82),
    last(16, 260, 142, 78),
    best(166, 260, 142, 78),
    pos(16, 346, 142, 78),
    delta(166, 346, 142, 78),
    w('fuelstint', 16, 432, 292, 152, { background: 'transparent', borderWidth: 0, radius: 8, color: TEXT, accentColor: AMBER, title: 'FUEL', reserveLaps: 1, warnAtLaps: 2 }, { name: 'FuelStint' }),

    // Dense centre spine: primary gear first, then race status and car health.
    gear(320, 42, 360, 204),
    speed(320, 252, 360, 52),
    w('incidents-clean', 320, 312, 176, 80, { background: 'transparent', borderWidth: 0, radius: 6, color: TEXT, accentColor: RED, showIcon: false }, { name: 'IncidentCount' }),
    w('digitalclock', 504, 312, 176, 80, { background: 'transparent', borderWidth: 0, radius: 6, color: TEXT, accentColor: CYAN, fontFamily: FONT_NUM, label: 'TIME LEFT', minFontSize: 14, maxFontSize: 34, ghost: false }, { binding: 'sessionTimeLeftFmt', name: 'SessionClock' }),
    w('abs-clean', 320, 400, 176, 80, { background: 'transparent', borderWidth: 0, radius: 6, color: TEXT, accentColor: AMBER, showIcon: false }, { name: 'AbsIndicator' }),
    w('tc-clean', 504, 400, 176, 80, { background: 'transparent', borderWidth: 0, radius: 6, color: TEXT, accentColor: CYAN, showIcon: false }, { name: 'TcIndicator' }),
    w('enginetemps', 320, 488, 360, 96, { background: 'transparent', borderWidth: 0, radius: 6, color: TEXT, accentColor: GREEN, title: 'VITALS' }, { name: 'CarVitals' }),

    // Right traffic quadrant.
    relElaborate(692, 42, 316, 120, AMBER),
    mapClean(692, 170, 316, 206, CYAN),
    sbest(692, 384, 316, 80),
    weather(692, 472, 316, 112, CYAN)
  ]
  return dashboard('Race Chase · Quad', 1024, 600, 'Dense four-quadrant chaser around a centre gear: chase timing and fuelstint on the left; incidents-clean, session digitalclock, ABS/TC indicators and enginetemps in the centre; car-ahead relatives, trackmap-clean, session-best and weather on the right.', elements)
}

// #20 HUD — top-heavy: big rev, prominent AHEAD + PACE, gear right.
function d20(): Dashboard {
  const elements: DashboardElement[] = [
    bg(),
    rev(16, 20, 992, 44, 30),
    ahead(16, 80, 470, 180, { maxFontSize: 150 }),
    pace(500, 80, 280, 180, { maxFontSize: 96 }),
    gear(788, 80, 220, 180),
    sbest(16, 276, 300, 96),
    relElaborate(332, 276, 392, 96, AMBER),
    mapClean(740, 276, 268, 96, CYAN),
    last(16, 384, 190, 86),
    best(214, 384, 190, 86),
    pos(412, 384, 190, 86),
    inc(610, 384, 190, 86),
    fuel(808, 384, 200, 86),
    weather(16, 482, 320, 102, CYAN),
    trackTemp(352, 482, 168, 102),
    speed(536, 482, 220, 102),
    delta(772, 482, 236, 102)
  ]
  return dashboard('Race Chase · HUD', 1024, 600, 'A top-heavy race HUD: an oversized rev bar over a giant AHEAD gap and prominent PACE, gear on the right, session-best with an elaborate car-ahead relatives strip and map, then last/best, position, incidents, fuel and a weather / track / speed / delta base row.', elements)
}

// ── Registry-shaped export (spread into BUILTIN_PRESETS by dashboards.ts) ──────
export const RACE_CHASE_PRESETS: DashboardPreset[] = [
  { id: 'race-chase-apex', name: 'Race Chase · Apex', build: d01, tags: ['race', 'chase', 'attack', 'ahead', 'gt3'] },
  { id: 'race-chase-aggressor', name: 'Race Chase · Aggressor', build: d02, tags: ['race', 'chase', 'attack', 'ahead', 'gear'] },
  { id: 'race-chase-predator', name: 'Race Chase · Predator', build: d03, tags: ['race', 'chase', 'attack', 'ahead', 'map'] },
  { id: 'race-chase-slipstream', name: 'Race Chase · Slipstream', build: d04, tags: ['race', 'chase', 'attack', 'ahead', 'hud'] },
  { id: 'race-chase-endurance', name: 'Race Chase · Endurance', build: d05, tags: ['race', 'chase', 'attack', 'ahead', 'endurance'] },
  { id: 'race-chase-overtake', name: 'Race Chase · Overtake', build: d06, tags: ['race', 'chase', 'attack', 'ahead', 'hero'] },
  { id: 'race-chase-draft', name: 'Race Chase · Draft', build: d07, tags: ['race', 'chase', 'attack', 'ahead', 'map'] },
  { id: 'race-chase-relative', name: 'Race Chase · Relative', build: d08, tags: ['race', 'chase', 'attack', 'ahead', 'radar'] },
  { id: 'race-chase-vanguard', name: 'Race Chase · Vanguard', build: d09, tags: ['race', 'chase', 'attack', 'ahead', 'hud'] },
  { id: 'race-chase-columns', name: 'Race Chase · Columns', build: d10, tags: ['race', 'chase', 'attack', 'ahead', 'columns'] },
  { id: 'race-chase-minimal', name: 'Race Chase · Minimal', build: d11, tags: ['race', 'chase', 'attack', 'ahead', 'minimal'] },
  { id: 'race-chase-cockpit', name: 'Race Chase · Cockpit', build: d12, tags: ['race', 'chase', 'attack', 'ahead', 'dense'] },
  { id: 'race-chase-split', name: 'Race Chase · Split', build: d13, tags: ['race', 'chase', 'attack', 'ahead', 'split'] },
  { id: 'race-chase-rally', name: 'Race Chase · Rally', build: d14, tags: ['race', 'chase', 'attack', 'ahead', 'map'] },
  { id: 'race-chase-closer', name: 'Race Chase · Closer', build: d15, tags: ['race', 'chase', 'attack', 'ahead', 'deltabar'] },
  { id: 'race-chase-marshal', name: 'Race Chase · Marshal', build: d16, tags: ['race', 'chase', 'attack', 'ahead', 'flags'] },
  { id: 'race-chase-timing', name: 'Race Chase · Timing', build: d17, tags: ['race', 'chase', 'attack', 'ahead', 'laptiming'] },
  { id: 'race-chase-elaborate', name: 'Race Chase · Elaborate', build: d18, tags: ['race', 'chase', 'attack', 'ahead', 'map'] },
  { id: 'race-chase-quad', name: 'Race Chase · Quad', build: d19, tags: ['race', 'chase', 'attack', 'ahead', 'quad'] },
  { id: 'race-chase-hud', name: 'Race Chase · HUD', build: d20, tags: ['race', 'chase', 'attack', 'ahead', 'hud'] }
]
