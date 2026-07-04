// ─── Wave-16 dashboard catalogue (futuristic + minimalist) ────────────────────
// Twenty-two original 1024×600 race dashboards that COMPOSE the wave-16 widgets
// (ERS / push-to-pass / weather / track-surface / BoP / cold-pressures / clock /
// pit-status plus the neon/grid futuristic and mono/typo minimalist kits) on top
// of the existing semantic widgets (gear / speed / shift / delta / laptiming /
// fuel / tyres / relatives / radar / trackmap …).
//
// These entries are spread into BUILTIN_PRESETS (see dashboards.ts) so they show
// up directly in the preset gallery. This module imports ONLY TYPES from
// `./dashboards` (erased at compile time) and generates element ids locally, so
// there is no runtime import cycle: dashboards.ts → dashboards-r16.ts is one-way.
//
// COLOUR RULE (Gui): warm tokens (gold / amber / orange / red) drive chrome and
// accents; cool tones (green / cyan / blue) are reserved for positive "good"
// states only — a faster delta, a charged ERS battery, push-to-pass available,
// grip/pressure on target. Futuristic = dense, neon, glow; Minimalist = restraint,
// generous whitespace, few elements, a single warm accent.

import type {
  Dashboard,
  DashboardElement,
  DashboardElementStyle,
  DashboardElementType,
  DashboardScaleMode
} from './dashboards'

const W = 1024
const H = 600

// ── Type fonts (mirrors the dashboards.ts stacks) ────────────────────────────
const FONT_TECH = '"Avenir Next", "Bahnschrift", "Segoe UI", system-ui, sans-serif'
const FONT_COND = '"Avenir Next Condensed", "DIN Condensed", "Arial Narrow", system-ui, sans-serif'
const FONT_NUM = '"DSEG7 Classic", "DS-Digital", "SF Mono", "Cascadia Mono", ui-monospace, monospace'

// ── Colour tokens ────────────────────────────────────────────────────────────
const WHITE = '#F4F4F4'
const MUTED = '#8A8A8A'
// Warm chrome / accents
const GOLD = '#D4A000'
const AMBER = '#FFB800'
const ORANGE = '#FF7A00'
const DORANGE = '#FF5500'
const RED = '#FF2200'
const CRIMSON = '#CC1133'
const RUST = '#C04010'
const COPPER = '#A05018'
const BRICK = '#B33000'
// Cool / "good" states only
const GREEN = '#1AFF6E'
const CYAN = '#00BFFF'
const BLUE = '#2E90FF'

const PANEL = '#070402'

// Deterministic per-dashboard element ids. Reset at the start of every build()
// so a rebuilt preset always yields the same ids (stable + unique within a dash).
let _eid = 0
function eid(): string {
  return `r16-el-${++_eid}`
}

function el(
  type: DashboardElementType,
  x: number,
  y: number,
  width: number,
  height: number,
  st: DashboardElementStyle,
  opts: { binding?: string; name?: string } = {}
): DashboardElement {
  return { id: eid(), type, x, y, w: width, h: height, style: st, binding: opts.binding, name: opts.name }
}

// Futuristic panel chrome: warm-dark fill, hairline accent border, glow handled
// internally by the wave-16 renderers when an accentColor is present.
function fx(accent: string, extra: DashboardElementStyle = {}): DashboardElementStyle {
  return { background: PANEL, border: accent, borderWidth: 1, radius: 16, color: WHITE, fontFamily: FONT_TECH, accentColor: accent, ...extra }
}

// Minimalist chrome: no box, no border — float on the black backplate.
function mn(extra: DashboardElementStyle = {}): DashboardElementStyle {
  return { background: 'transparent', borderWidth: 0, radius: 4, color: WHITE, fontFamily: FONT_TECH, ...extra }
}

function bg(): DashboardElement {
  return el('rect', 0, 0, W, H, { background: '#000000', borderWidth: 0, radius: 0 }, { name: 'Backplate' })
}

// Segmented rev/shift bar. Thin (h<24) drops the radius for a crisp LED rail.
function shift(x: number, y: number, width: number, height: number, accent = ORANGE, segments = 28, glow = true): DashboardElement {
  return el(
    'shiftbar',
    x,
    y,
    width,
    height,
    {
      background: 'transparent',
      borderWidth: 0,
      radius: height < 24 ? 2 : 8,
      segments,
      flashAt: 0.98,
      warnAt: 0.6,
      dangerAt: 0.84,
      glow,
      segmentShape: 'led',
      fillColor: GREEN,
      warnColor: AMBER,
      dangerColor: RED,
      flashColor: CYAN,
      accentColor: accent
    },
    { binding: 'shiftPct', name: 'Shift' }
  )
}

// Central gear/speed cluster anchor.
function gear(x: number, y: number, width: number, height: number, accent = ORANGE, showRpm = true, boxed = true): DashboardElement {
  return el(
    'gearcluster',
    x,
    y,
    width,
    height,
    {
      background: boxed ? '#000000' : 'transparent',
      border: boxed ? accent : undefined,
      borderWidth: boxed ? 1 : 0,
      radius: 18,
      accentColor: accent,
      showRpm,
      flashAt: 0.98,
      dangerAt: 0.86,
      unit: 'kmh',
      color: WHITE,
      fontFamily: FONT_COND
    },
    { name: 'Gear' }
  )
}

// Floating numeric readout (label + big value + optional unit).
function val(
  binding: string,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  accent = WHITE,
  opts: DashboardElementStyle = {},
  type: DashboardElementType = 'value'
): DashboardElement {
  return el(
    type,
    x,
    y,
    width,
    height,
    { background: 'transparent', borderWidth: 0, color: WHITE, fontFamily: FONT_NUM, label, accentColor: accent, ...opts },
    { binding, name: label || binding }
  )
}

interface PresetEntry {
  id: string
  name: string
  build: () => Dashboard
  tags?: string[]
}

const SCALE_FIT: DashboardScaleMode = 'fit'

function D(id: string, displayName: string, description: string, tags: string[], make: () => DashboardElement[]): PresetEntry {
  const name = `${displayName} · ${W}×${H}`
  return {
    id,
    name,
    tags,
    build: (): Dashboard => {
      _eid = 0
      const elements = make()
      const now = Date.now()
      return { id, name, width: W, height: H, bg: '#000000', scaleMode: SCALE_FIT, description, elements, createdAt: now, updatedAt: now }
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// FUTURISTIC — dense, neon, glow, warm chrome
// ══════════════════════════════════════════════════════════════════════════════

const FUTURISTIC: PresetEntry[] = [
  D(
    'race-hud-futuristic',
    'Neon Race HUD',
    'Neon race HUD: full-width rev rail, dominant centre gear/speed, ERS battery and push-to-pass flanks, predictive delta, position/timing/fuel rails.',
    ['futuristic', 'race', 'hud', 'neon', 'ers', 'p2p', 'gear', 'delta', 'motorsport'],
    () => [
      bg(),
      shift(16, 12, 992, 44, ORANGE, 30),
      gear(372, 68, 280, 300, ORANGE),
      val('speedKmh', 372, 376, 280, 78, 'KM/H', WHITE, { suffix: 'km/h', align: 'center', minFontSize: 26, maxFontSize: 72 }),
      el('deltatile', 372, 462, 280, 126, fx(ORANGE, { title: 'Δ', deltaReference: 'session', deltaRangeSec: 1, accentColor: GREEN, maxFontSize: 60 }), { binding: 'deltaSec', name: 'Delta' }),
      el('ers-bar-futuristic', 16, 68, 232, 168, fx(AMBER, { label: 'ERS' }), { name: 'Ers' }),
      el('neon-ring-futuristic', 16, 252, 232, 150, fx(AMBER, { label: 'ENGINE', suffix: 'RPM', gaugeMax: 8200 }), { binding: 'rpm', name: 'RpmRing' }),
      el('positiongaps', 16, 416, 232, 172, fx(GOLD, { showTotal: true, maxFontSize: 44 }), { name: 'Pos' }),
      el('p2p-futuristic', 776, 68, 232, 168, fx(ORANGE, { label: 'P2P' }), { name: 'P2p' }),
      el('laptiming', 776, 252, 232, 150, fx(AMBER, { title: 'TIMING', showCurrent: true, showLast: true, showBest: true }), { name: 'Lap' }),
      el('fuelstint', 776, 416, 232, 172, fx(GREEN, { title: 'FUEL', reserveLaps: 1, warnAtLaps: 2 }), { name: 'Fuel' })
    ]
  ),
  D(
    'endurance-futuristic',
    'Sci-Fi Endurance',
    'Sci-fi endurance command desk: session clock, stint fuel and pit-status left, gear/lap centre, cold pressures, tyre temps and weather right.',
    ['futuristic', 'endurance', 'fuel', 'pit', 'pressures', 'clock', 'weather', 'motorsport'],
    () => [
      bg(),
      shift(16, 12, 992, 32, GOLD, 24),
      el('clock-futuristic', 16, 56, 236, 120, fx(GOLD, { label: 'TIME OF DAY' }), { name: 'Clock' }),
      el('fuelstint', 16, 188, 236, 200, fx(GREEN, { title: 'STINT FUEL', enduranceMode: true, reserveLaps: 2, warnAtLaps: 3 }), { name: 'Fuel' }),
      el('pit-status-futuristic', 16, 400, 236, 188, fx(AMBER, { label: 'PIT' }), { name: 'Pit' }),
      gear(392, 56, 240, 230, AMBER),
      val('speedKmh', 392, 300, 240, 70, 'KM/H', WHITE, { suffix: 'km/h', align: 'center', maxFontSize: 60 }),
      el('laptiming', 392, 384, 240, 120, fx(CYAN, { title: 'LAP / LAST / BEST', showCurrent: true, showLast: true, showBest: true, showEstimated: true }), { name: 'Lap' }),
      el('positiongaps', 392, 518, 240, 70, fx(GOLD, { showTotal: true, compact: true, maxFontSize: 34 }), { name: 'Pos' }),
      el('cold-pressures-futuristic', 772, 56, 236, 220, fx(ORANGE, { label: 'COLD PRESSURE' }), { name: 'ColdP' }),
      el('tyregrid', 772, 288, 236, 160, fx(AMBER, { gridMode: 'temp', title: 'TYRE TEMP', showLabels: true }), { name: 'Tyres' }),
      el('weather-status-futuristic', 772, 460, 236, 128, fx(CYAN, { label: 'TRACK' }), { name: 'Weather' })
    ]
  ),
  D(
    'hybrid-gtp-futuristic',
    'Hybrid GTP Core',
    'Hybrid/GTP energy core: radial ERS deploy, centre gear/speed, push-to-pass and fuel ring right, wide sci-fi delta + timing band below.',
    ['futuristic', 'hybrid', 'gtp', 'ers', 'p2p', 'delta', 'fuel', 'motorsport'],
    () => [
      bg(),
      shift(16, 12, 992, 40, DORANGE, 30),
      el('ers-radial-futuristic', 16, 64, 300, 300, fx(CYAN, { label: 'ERS', radius: 18 }), { name: 'ErsRadial' }),
      gear(362, 64, 300, 250, ORANGE),
      val('speedKmh', 362, 322, 300, 84, 'SPEED', WHITE, { suffix: 'km/h', align: 'center', maxFontSize: 74 }),
      el('p2p-futuristic', 708, 64, 300, 140, fx(ORANGE, { label: 'PUSH TO PASS', radius: 18 }), { name: 'P2p' }),
      el('neon-ring-futuristic', 708, 216, 300, 148, fx(GOLD, { label: 'FUEL', suffix: 'L', gaugeMax: 120 }), { binding: 'fuelLiters', name: 'FuelRing' }),
      el('sci-fi-delta-futuristic', 16, 420, 620, 76, fx(GREEN, { label: 'DELTA', deltaRangeSec: 1 }), { binding: 'deltaSec', name: 'Delta' }),
      el('laptiming', 16, 506, 620, 82, fx(AMBER, { title: 'TIMING', showCurrent: true, showLast: true, showBest: true }), { name: 'Lap' }),
      el('positiongaps', 708, 420, 300, 76, fx(GOLD, { showTotal: true, compact: true }), { name: 'Pos' }),
      el('fuelstint', 708, 506, 300, 82, fx(GREEN, { title: 'STINT', reserveLaps: 1, compact: true }), { name: 'Fuel' })
    ]
  ),
  D(
    'relative-cockpit-futuristic',
    'Relative Cockpit',
    'Futuristic traffic cockpit: elaborate relatives left, radar + gear centre, track map, position gaps and predictive delta right.',
    ['futuristic', 'relatives', 'radar', 'traffic', 'cockpit', 'trackmap', 'motorsport'],
    () => [
      bg(),
      shift(16, 12, 992, 32, RUST, 26),
      el('relatives-elaborate', 16, 56, 360, 480, fx(ORANGE, { maxFontSize: 30 }), { name: 'Rel' }),
      el('radar-elaborate', 392, 56, 300, 270, fx(AMBER, { radius: 18, maxFontSize: 32 }), { name: 'Radar' }),
      gear(392, 336, 300, 170, ORANGE, false),
      val('speedKmh', 392, 514, 300, 74, 'KM/H', WHITE, { suffix: 'km/h', align: 'center', maxFontSize: 58 }),
      el('trackmap-elaborate', 708, 56, 300, 180, fx(ORANGE, { color: MUTED, maxFontSize: 26 }), { binding: 'lapDistPct', name: 'Track' }),
      el('positiongaps', 708, 248, 300, 108, fx(GOLD, { showTotal: true }), { name: 'Pos' }),
      el('deltatile', 708, 368, 300, 110, fx(ORANGE, { title: 'Δ', deltaReference: 'session', deltaRangeSec: 1, accentColor: GREEN }), { binding: 'deltaSec', name: 'Delta' }),
      val('incidentCount', 708, 490, 145, 98, 'INC', RED, { maxFontSize: 56 }),
      val('position', 863, 490, 145, 98, 'POS', GOLD, { maxFontSize: 56 })
    ]
  ),
  D(
    'data-wall-futuristic',
    'Data Wall',
    'A sci-fi data wall: two rows of neon ring / segmented / grid / HUD gauges over speed, engine, temps, pressures and fuel, with a gear + delta footer.',
    ['futuristic', 'data-wall', 'gauges', 'segmented', 'grid', 'engineering', 'motorsport'],
    () => [
      bg(),
      shift(16, 12, 992, 28, GOLD, 24),
      el('segmented-gauge-futuristic', 16, 52, 242, 184, fx(ORANGE, { label: 'SPEED', suffix: 'KMH', gaugeMax: 320, segments: 26 }), { binding: 'speedKmh', name: 'Speed' }),
      el('neon-ring-futuristic', 270, 52, 242, 184, fx(AMBER, { label: 'ENGINE', suffix: 'RPM', gaugeMax: 8200 }), { binding: 'rpm', name: 'Rpm' }),
      el('grid-gauge-futuristic', 524, 52, 242, 184, fx(RED, { label: 'WATER', suffix: '°C', gaugeMin: 40, gaugeMax: 130 }), { binding: 'waterTempC', name: 'Water' }),
      el('hud-tile-futuristic', 778, 52, 230, 184, fx(ORANGE, { label: 'OIL', suffix: '°C', gaugeMin: 40, gaugeMax: 150 }), { binding: 'oilTempC', name: 'Oil' }),
      el('grid-gauge-futuristic', 16, 252, 242, 184, fx(ORANGE, { label: 'OIL PRES', suffix: 'kPa', gaugeMax: 700 }), { binding: 'oilPressureKpa', name: 'OilP' }),
      el('neon-ring-futuristic', 270, 252, 242, 184, fx(GOLD, { label: 'FUEL', suffix: 'L', gaugeMax: 120 }), { binding: 'fuelLiters', name: 'Fuel' }),
      el('segmented-gauge-futuristic', 524, 252, 242, 184, fx(AMBER, { label: 'TRACK', suffix: '°C', gaugeMin: 10, gaugeMax: 60, segments: 22 }), { binding: 'trackTempC', name: 'Track' }),
      el('hud-tile-futuristic', 778, 252, 230, 184, fx(COPPER, { label: 'AIR', suffix: '°C', gaugeMin: 5, gaugeMax: 45 }), { binding: 'airTempC', name: 'Air' }),
      val('speedKmh', 16, 452, 242, 136, 'KM/H', WHITE, { suffix: 'km/h', align: 'center', maxFontSize: 60 }),
      gear(270, 448, 242, 140, ORANGE),
      el('sci-fi-delta-futuristic', 524, 452, 242, 136, fx(GREEN, { label: 'DELTA', deltaRangeSec: 1 }), { binding: 'deltaSec', name: 'Delta' }),
      el('hud-tile-futuristic', 778, 452, 230, 136, fx(GOLD, { label: 'POS' }), { binding: 'position', name: 'Pos' })
    ]
  ),
  D(
    'wet-attack-futuristic',
    'Wet Attack',
    'Wet-race attack HUD: weather + track-surface intelligence left, gear/speed/delta centre, track map, tyre pressures and pedals right, grip readout.',
    ['futuristic', 'wet', 'weather', 'surface', 'delta', 'rain', 'motorsport'],
    () => [
      bg(),
      shift(16, 12, 992, 36, AMBER, 28),
      el('weather-status-futuristic', 16, 60, 330, 210, fx(AMBER, { label: 'WEATHER', radius: 18 }), { name: 'Weather' }),
      el('track-surface-futuristic', 16, 282, 330, 210, fx(ORANGE, { label: 'SURFACE', radius: 18 }), { name: 'Surface' }),
      el('hud-tile-futuristic', 16, 504, 330, 84, fx(CYAN, { label: 'GRIP' }), { binding: 'gripPct', name: 'Grip' }),
      gear(370, 60, 284, 260, ORANGE),
      val('speedKmh', 370, 332, 284, 74, 'KM/H', WHITE, { suffix: 'km/h', align: 'center', maxFontSize: 62 }),
      el('deltatile', 370, 416, 284, 172, fx(ORANGE, { title: 'Δ', deltaReference: 'session', deltaRangeSec: 1, accentColor: GREEN, maxFontSize: 76 }), { binding: 'deltaSec', name: 'Delta' }),
      el('trackmap-elaborate', 678, 60, 330, 210, fx(ORANGE, { color: MUTED, maxFontSize: 28 }), { binding: 'lapDistPct', name: 'Track' }),
      el('tyregrid', 678, 282, 330, 150, fx(AMBER, { gridMode: 'pressure', title: 'TYRE PRESS', targetValue: 165, tolerance: 7 }), { name: 'TyreP' }),
      el('inputbars', 678, 444, 330, 144, fx(ORANGE, { channels: ['throttle', 'brake'] }), { name: 'Pedals' })
    ]
  ),
  D(
    'qualy-attack-futuristic',
    'Qualy Attack',
    'Qualifying attack HUD: oversized sci-fi predictive delta hero, full lap stack, gear/speed footer, engine ring, position gaps and push-to-pass right.',
    ['futuristic', 'qualifying', 'delta', 'laptime', 'attack', 'p2p', 'motorsport'],
    () => [
      bg(),
      shift(16, 12, 992, 48, RED, 32),
      el('sci-fi-delta-futuristic', 16, 72, 620, 200, fx(GREEN, { label: 'PREDICTED DELTA', deltaRangeSec: 1, radius: 18 }), { binding: 'deltaSec', name: 'DeltaHero' }),
      el('laptiming', 16, 288, 620, 150, fx(AMBER, { title: 'CURRENT / LAST / BEST', showCurrent: true, showLast: true, showBest: true, showEstimated: true, maxFontSize: 48 }), { name: 'Lap' }),
      gear(16, 454, 300, 134, ORANGE),
      val('speedKmh', 332, 454, 304, 134, 'KM/H', WHITE, { suffix: 'km/h', align: 'center', maxFontSize: 84 }),
      el('neon-ring-futuristic', 660, 72, 348, 200, fx(AMBER, { label: 'ENGINE', suffix: 'RPM', gaugeMax: 8200 }), { binding: 'rpm', name: 'Rpm' }),
      el('positiongaps', 660, 288, 348, 150, fx(GOLD, { showTotal: true }), { name: 'Pos' }),
      el('p2p-futuristic', 660, 454, 348, 134, fx(ORANGE, { label: 'P2P' }), { name: 'P2p' })
    ]
  ),
  D(
    'traffic-lock-futuristic',
    'Traffic Lock',
    'Traffic-control HUD: tall relatives left, radar + gear centre, push-to-pass, track map and position right, setup strip and delta footer.',
    ['futuristic', 'traffic', 'radar', 'relatives', 'p2p', 'setup', 'motorsport'],
    () => [
      bg(),
      shift(16, 12, 992, 28, COPPER, 24),
      el('relatives-elaborate', 16, 52, 330, 420, fx(ORANGE, { maxFontSize: 28 }), { name: 'Rel' }),
      el('setupstrip', 16, 484, 330, 104, fx(RED, { fields: ['tc', 'abs', 'bb'], compact: true }), { name: 'Setup' }),
      el('radar-elaborate', 362, 52, 300, 330, fx(AMBER, { radius: 18, maxFontSize: 34 }), { name: 'Radar' }),
      gear(362, 396, 300, 130, ORANGE, false),
      val('speedKmh', 362, 532, 300, 56, 'KM/H', WHITE, { suffix: 'km/h', align: 'center', maxFontSize: 46 }),
      el('p2p-futuristic', 678, 52, 330, 150, fx(ORANGE, { label: 'P2P' }), { name: 'P2p' }),
      el('trackmap-elaborate', 678, 214, 330, 168, fx(AMBER, { color: MUTED, maxFontSize: 28 }), { binding: 'lapDistPct', name: 'Track' }),
      el('positiongaps', 678, 394, 330, 96, fx(GOLD, { showTotal: true, compact: true }), { name: 'Pos' }),
      el('deltatile', 678, 500, 330, 88, fx(ORANGE, { title: 'Δ', deltaReference: 'session', deltaRangeSec: 1, accentColor: GREEN, compact: true }), { binding: 'deltaSec', name: 'Delta' })
    ]
  ),
  D(
    'hud-cluster-futuristic',
    'HUD Ring Cluster',
    'Circular HUD cluster: speed and engine neon rings flanking a centre gear, ERS radial and push-to-pass on the wings, a delta/gaps tile row and a timing/fuel/setup footer.',
    ['futuristic', 'hud', 'cluster', 'rings', 'gauges', 'ers', 'motorsport'],
    () => [
      bg(),
      shift(16, 12, 992, 30, GOLD, 26),
      el('ers-radial-futuristic', 16, 60, 176, 200, fx(CYAN, { label: 'ERS' }), { name: 'Ers' }),
      el('neon-ring-futuristic', 200, 60, 200, 200, fx(AMBER, { label: 'SPEED', suffix: 'KM/H', gaugeMax: 320 }), { binding: 'speedKmh', name: 'Speed' }),
      gear(412, 60, 200, 200, ORANGE),
      el('neon-ring-futuristic', 624, 60, 200, 200, fx(ORANGE, { label: 'RPM', suffix: 'RPM', gaugeMax: 8200 }), { binding: 'rpm', name: 'Rpm' }),
      el('p2p-futuristic', 832, 60, 176, 200, fx(ORANGE, { label: 'P2P' }), { name: 'P2p' }),
      el('hud-tile-futuristic', 16, 276, 192, 144, fx(GOLD, { label: 'POS' }), { binding: 'position', name: 'Pos' }),
      el('hud-tile-futuristic', 216, 276, 192, 144, fx(AMBER, { label: 'AHEAD', suffix: 's' }), { binding: 'gapAhead', name: 'Ahead' }),
      el('sci-fi-delta-futuristic', 416, 276, 192, 144, fx(GREEN, { label: 'DELTA', deltaRangeSec: 1 }), { binding: 'deltaSec', name: 'Delta' }),
      el('hud-tile-futuristic', 616, 276, 192, 144, fx(RED, { label: 'BEHIND', suffix: 's' }), { binding: 'gapBehind', name: 'Behind' }),
      el('hud-tile-futuristic', 816, 276, 192, 144, fx(RED, { label: 'INC' }), { binding: 'incidentCount', name: 'Inc' }),
      el('laptiming', 16, 436, 330, 152, fx(AMBER, { title: 'TIMING', showCurrent: true, showLast: true, showBest: true }), { name: 'Lap' }),
      el('segmented-gauge-futuristic', 362, 436, 300, 152, fx(GOLD, { label: 'FUEL', suffix: 'L', gaugeMax: 120 }), { binding: 'fuelLiters', name: 'Fuel' }),
      el('setupstrip', 678, 436, 330, 152, fx(ORANGE, { fields: ['tc', 'abs', 'bb', 'map', 'limiter'] }), { name: 'Setup' })
    ]
  ),
  D(
    'night-stint-futuristic',
    'Night Stint',
    'Endurance night stint: session clock, stint fuel and BoP left, position/gear/lap centre, pit-status, cold pressures and tyre temps right.',
    ['futuristic', 'night', 'endurance', 'stint', 'bop', 'pit', 'pressures', 'motorsport'],
    () => [
      bg(),
      shift(16, 12, 992, 26, GOLD, 22),
      el('clock-futuristic', 16, 50, 236, 110, fx(GOLD, { label: 'SESSION CLOCK' }), { name: 'Clock' }),
      el('fuelstint', 16, 172, 236, 210, fx(GREEN, { title: 'FUEL / STINT', enduranceMode: true, reserveLaps: 2, warnAtLaps: 3 }), { name: 'Fuel' }),
      el('bop-futuristic', 16, 394, 236, 194, fx(ORANGE, { label: 'BoP' }), { name: 'Bop' }),
      el('positiongaps', 272, 50, 360, 120, fx(GOLD, { showTotal: true }), { name: 'Pos' }),
      gear(272, 182, 360, 200, AMBER),
      el('laptiming', 272, 394, 360, 194, fx(CYAN, { title: 'LAP / LAST / BEST', showCurrent: true, showLast: true, showBest: true, showEstimated: true }), { name: 'Lap' }),
      el('pit-status-futuristic', 652, 50, 356, 160, fx(AMBER, { label: 'PIT' }), { name: 'Pit' }),
      el('cold-pressures-futuristic', 652, 222, 356, 180, fx(ORANGE, { label: 'COLD PRESSURE' }), { name: 'ColdP' }),
      el('tyregrid', 652, 414, 356, 174, fx(AMBER, { gridMode: 'temp', title: 'TYRE TEMP', showLabels: true }), { name: 'Tyres' })
    ]
  ),
  D(
    'vector-telemetry-futuristic',
    'Vector Telemetry',
    'Engineering HUD: g-force vector and input trace left, gear/speed/pedals centre, engine ring, water grid gauge and sci-fi delta right.',
    ['futuristic', 'gforce', 'inputs', 'trace', 'engineering', 'delta', 'motorsport'],
    () => [
      bg(),
      shift(16, 12, 992, 30, DORANGE, 28),
      el('gforcemeter', 16, 56, 300, 300, fx(ORANGE, { radius: 18, title: 'G-FORCE' }), { name: 'GForce' }),
      el('inputtrace', 16, 372, 300, 216, fx(AMBER, { channels: ['throttle', 'brake', 'clutch'], traceLength: 200 }), { name: 'Trace' }),
      gear(336, 56, 352, 250, ORANGE),
      val('speedKmh', 336, 318, 352, 80, 'KM/H', WHITE, { suffix: 'km/h', align: 'center', maxFontSize: 78 }),
      el('inputbars', 336, 410, 352, 178, fx(ORANGE, { channels: ['throttle', 'brake'] }), { name: 'Pedals' }),
      el('neon-ring-futuristic', 708, 56, 300, 170, fx(AMBER, { label: 'RPM', suffix: 'RPM', gaugeMax: 8200 }), { binding: 'rpm', name: 'Rpm' }),
      el('grid-gauge-futuristic', 708, 238, 300, 160, fx(RED, { label: 'WATER', suffix: '°C', gaugeMin: 40, gaugeMax: 130 }), { binding: 'waterTempC', name: 'Water' }),
      el('sci-fi-delta-futuristic', 708, 410, 300, 178, fx(GREEN, { label: 'DELTA', deltaRangeSec: 1 }), { binding: 'deltaSec', name: 'Delta' })
    ]
  )
]

// ══════════════════════════════════════════════════════════════════════════════
// MINIMALIST — restraint, whitespace, mono + a single warm accent
// ══════════════════════════════════════════════════════════════════════════════

const MINIMALIST: PresetEntry[] = [
  D(
    'primary-minimal',
    'Clean Cockpit',
    'Minimal primary cockpit: a single hairline shift rail, one dominant gear/speed cluster and four quiet readouts (delta, position, lap, fuel).',
    ['minimal', 'cockpit', 'clean', 'gear', 'delta', 'motorsport'],
    () => [
      bg(),
      el('shiftbar', 192, 40, 640, 12, { background: 'transparent', borderWidth: 0, radius: 1, segments: 18, flashAt: 0.96, glow: false, segmentShape: 'led', fillColor: GREEN, warnColor: AMBER, dangerColor: RED, accentColor: AMBER }, { binding: 'shiftPct', name: 'Shift' }),
      gear(320, 80, 384, 380, AMBER, false, false),
      el('stacked-readout-minimal', 96, 196, 200, 150, mn({ label: 'DELTA', accentColor: GREEN }), { binding: 'deltaSec', name: 'Delta' }),
      el('stacked-readout-minimal', 728, 196, 200, 150, mn({ label: 'POS', accentColor: GOLD }), { binding: 'position', name: 'Pos' }),
      el('typo-readout-minimal', 96, 372, 200, 120, mn({ label: 'LAP', accentColor: WHITE }), { binding: 'currentLap', name: 'Lap' }),
      el('typo-readout-minimal', 728, 372, 200, 120, mn({ label: 'FUEL', suffix: 'L', accentColor: GOLD }), { binding: 'fuelLiters', name: 'Fuel' })
    ]
  ),
  D(
    'typo-laps-minimal',
    'Typographic Laps',
    'Typographic lap & fuel dash: a giant current-lap readout, last/best beneath, and a mono row of fuel, consumption and delta.',
    ['minimal', 'typography', 'laptime', 'fuel', 'delta', 'motorsport'],
    () => [
      bg(),
      el('typo-readout-minimal', 64, 60, 896, 176, mn({ label: 'CURRENT LAP', accentColor: AMBER }), { binding: 'currentLapFmt', name: 'Current' }),
      el('stacked-readout-minimal', 64, 256, 430, 156, mn({ label: 'LAST', accentColor: WHITE }), { binding: 'lastLapFmt', name: 'Last' }),
      el('stacked-readout-minimal', 530, 256, 430, 156, mn({ label: 'BEST', accentColor: GOLD }), { binding: 'bestLapFmt', name: 'Best' }),
      el('mono-tile-minimal', 64, 440, 280, 120, mn({ label: 'FUEL', suffix: 'L', accentColor: GOLD }), { binding: 'fuelLiters', name: 'Fuel' }),
      el('mono-tile-minimal', 372, 440, 280, 120, mn({ label: 'L / LAP', accentColor: WHITE }), { binding: 'fuelPerLapStr', name: 'PerLap' }),
      el('mono-tile-minimal', 680, 440, 280, 120, mn({ label: 'DELTA', accentColor: GREEN }), { binding: 'deltaSec', name: 'Delta' })
    ]
  ),
  D(
    'endurance-minimal',
    'Quiet Endurance',
    'Quiet endurance dash: time-of-day clock and pit-status up top, stint fuel and lap stack, then position, speed and delta in a calm bottom row.',
    ['minimal', 'endurance', 'fuel', 'pit', 'clock', 'motorsport'],
    () => [
      bg(),
      el('clock-minimal', 64, 64, 400, 140, mn({ label: 'TIME OF DAY', accentColor: GOLD }), { name: 'Clock' }),
      el('pit-status-minimal', 560, 64, 400, 140, mn({ label: 'PIT', accentColor: AMBER }), { name: 'Pit' }),
      el('fuelstint', 64, 236, 430, 150, mn({ title: 'STINT FUEL', enduranceMode: true, reserveLaps: 2, accentColor: GREEN }), { name: 'Fuel' }),
      el('laptiming', 560, 236, 400, 150, mn({ title: 'LAP / LAST / BEST', showCurrent: true, showLast: true, showBest: true, accentColor: WHITE }), { name: 'Lap' }),
      el('stacked-readout-minimal', 64, 420, 280, 150, mn({ label: 'POS', accentColor: GOLD }), { binding: 'position', name: 'Pos' }),
      el('stacked-readout-minimal', 372, 420, 280, 150, mn({ label: 'KM/H', accentColor: WHITE }), { binding: 'speedKmh', name: 'Speed' }),
      el('stacked-readout-minimal', 680, 420, 280, 150, mn({ label: 'DELTA', accentColor: GREEN }), { binding: 'deltaSec', name: 'Delta' })
    ]
  ),
  D(
    'hybrid-glance-minimal',
    'Hybrid Glance',
    'Single-glance hybrid dash: a wide ERS battery bar, push-to-pass, an RPM arc and speed, a calm centre gear and quiet delta/position readouts.',
    ['minimal', 'hybrid', 'ers', 'p2p', 'gear', 'motorsport'],
    () => [
      bg(),
      el('ers-bar-minimal', 64, 80, 896, 90, mn({ label: 'ERS BATTERY', accentColor: CYAN }), { name: 'Ers' }),
      el('p2p-minimal', 64, 200, 430, 120, mn({ label: 'PUSH TO PASS', accentColor: AMBER }), { name: 'P2p' }),
      el('arc-minimal', 560, 188, 144, 144, mn({ label: 'RPM', accentColor: AMBER, gaugeMax: 8200 }), { binding: 'rpm', name: 'Rpm' }),
      el('stacked-readout-minimal', 720, 200, 240, 120, mn({ label: 'KM/H', accentColor: WHITE }), { binding: 'speedKmh', name: 'Speed' }),
      gear(360, 350, 304, 230, AMBER, false, false),
      el('stacked-readout-minimal', 64, 360, 260, 150, mn({ label: 'DELTA', accentColor: GREEN }), { binding: 'deltaSec', name: 'Delta' }),
      el('stacked-readout-minimal', 700, 360, 260, 150, mn({ label: 'POS', accentColor: GOLD }), { binding: 'position', name: 'Pos' })
    ]
  ),
  D(
    'tyres-pressures-minimal',
    'Tyres & Pressures',
    'Minimalist tyre engineer: cold pressures and tyre temps up top, hot pressures grid, track/air temps, a grip hairline and a quiet track-state line.',
    ['minimal', 'tyres', 'pressures', 'cold', 'weather', 'motorsport'],
    () => [
      bg(),
      el('cold-pressures-minimal', 64, 64, 430, 240, mn({ label: 'COLD PRESSURE', accentColor: AMBER }), { name: 'ColdP' }),
      el('tyregrid', 530, 64, 430, 240, mn({ gridMode: 'temp', title: 'TYRE TEMP', showLabels: true, accentColor: AMBER }), { name: 'Tyres' }),
      el('tyregrid', 64, 330, 430, 150, mn({ gridMode: 'pressure', title: 'HOT PRESSURE', targetValue: 165, tolerance: 7, accentColor: ORANGE }), { name: 'TyreP' }),
      el('mono-tile-minimal', 530, 330, 200, 95, mn({ label: 'TRACK', suffix: '°C', accentColor: AMBER }), { binding: 'trackTempC', name: 'Track' }),
      el('mono-tile-minimal', 760, 330, 200, 95, mn({ label: 'AIR', suffix: '°C', accentColor: WHITE }), { binding: 'airTempC', name: 'Air' }),
      el('hairline-bar-minimal', 530, 440, 430, 40, mn({ label: 'GRIP', accentColor: GREEN }), { binding: 'gripPct', name: 'Grip' }),
      el('weather-status-minimal', 64, 500, 896, 84, mn({ label: 'TRACK STATE', accentColor: AMBER }), { name: 'Weather' })
    ]
  ),
  D(
    'spotter-minimal',
    'Minimal Spotter',
    'Clean spotter: a tall relatives list and radar with a quiet centre gear, plus ahead/behind gaps and position — colour only marks closing/losing.',
    ['minimal', 'spotter', 'radar', 'relatives', 'traffic', 'motorsport'],
    () => [
      bg(),
      el('relatives-clean', 64, 64, 360, 470, mn({ accentColor: MUTED, reference: '', showIcon: false, maxFontSize: 28 }), { name: 'Rel' }),
      el('radar-clean', 640, 64, 320, 300, mn({ accentColor: AMBER, showIcon: false }), { name: 'Radar' }),
      gear(448, 140, 184, 300, AMBER, false, false),
      el('mono-tile-minimal', 448, 452, 184, 82, mn({ label: 'POS', accentColor: GOLD }), { binding: 'position', name: 'Pos' }),
      el('stacked-readout-minimal', 640, 392, 150, 142, mn({ label: 'AHEAD', accentColor: GREEN }), { binding: 'gapAheadFmt', name: 'Ahead' }),
      el('stacked-readout-minimal', 810, 392, 150, 142, mn({ label: 'BEHIND', accentColor: RED }), { binding: 'gapBehindFmt', name: 'Behind' })
    ]
  ),
  D(
    'delta-focus-minimal',
    'Delta Focus',
    'A single-purpose delta dash: one enormous predictive delta number over a thin delta bar, with current/last/best lap times beneath.',
    ['minimal', 'delta', 'laptime', 'focus', 'qualifying', 'motorsport'],
    () => [
      bg(),
      el('typo-readout-minimal', 64, 80, 896, 240, mn({ label: 'PREDICTED DELTA', accentColor: GREEN }), { binding: 'deltaSec', name: 'DeltaHero' }),
      el('deltabar', 64, 332, 896, 28, { background: PANEL, borderWidth: 0, radius: 999, fillColor: GREEN, dangerColor: RED, deltaRangeSec: 1 }, { binding: 'deltaSec', name: 'DeltaBar' }),
      el('stacked-readout-minimal', 64, 400, 290, 170, mn({ label: 'CURRENT', accentColor: WHITE }), { binding: 'currentLapFmt', name: 'Current' }),
      el('stacked-readout-minimal', 367, 400, 290, 170, mn({ label: 'LAST', accentColor: WHITE }), { binding: 'lastLapFmt', name: 'Last' }),
      el('stacked-readout-minimal', 670, 400, 290, 170, mn({ label: 'BEST', accentColor: GOLD }), { binding: 'bestLapFmt', name: 'Best' })
    ]
  ),
  D(
    'fuel-strategy-minimal',
    'Fuel Strategy',
    'Fuel-strategy dash: a big litres readout and a fuel arc, consumption / laps-left / laps-done tiles, plus time remaining and pit-status.',
    ['minimal', 'fuel', 'strategy', 'endurance', 'pit', 'motorsport'],
    () => [
      bg(),
      el('typo-readout-minimal', 64, 70, 500, 200, mn({ label: 'FUEL (L)', accentColor: GOLD }), { binding: 'fuelLitersStr', name: 'Fuel' }),
      el('arc-minimal', 620, 70, 260, 200, mn({ label: 'FUEL', suffix: 'L', accentColor: GOLD, gaugeMax: 120 }), { binding: 'fuelLiters', name: 'FuelArc' }),
      el('mono-tile-minimal', 64, 300, 290, 120, mn({ label: 'L / LAP', accentColor: WHITE }), { binding: 'fuelPerLapStr', name: 'PerLap' }),
      el('mono-tile-minimal', 367, 300, 290, 120, mn({ label: 'LAPS LEFT', accentColor: GREEN }), { binding: 'fuelLapsLeftStr', name: 'LapsLeft' }),
      el('mono-tile-minimal', 670, 300, 290, 120, mn({ label: 'LAPS DONE', accentColor: WHITE }), { binding: 'currentLap', name: 'LapsDone' }),
      el('stacked-readout-minimal', 64, 450, 430, 130, mn({ label: 'TIME REMAINING', accentColor: AMBER }), { binding: 'sessionTimeLeftFmt', name: 'TimeLeft' }),
      el('pit-status-minimal', 530, 450, 430, 130, mn({ label: 'PIT', accentColor: AMBER }), { name: 'Pit' })
    ]
  ),
  D(
    'energy-manager-minimal',
    'Energy Manager',
    'Hybrid energy manager: a radial ERS gauge, push-to-pass and BoP panels, a quiet centre gear and speed/delta readouts.',
    ['minimal', 'hybrid', 'ers', 'bop', 'energy', 'p2p', 'motorsport'],
    () => [
      bg(),
      el('ers-radial-minimal', 96, 80, 260, 260, mn({ label: 'ERS', accentColor: CYAN }), { name: 'Ers' }),
      el('p2p-minimal', 400, 80, 560, 120, mn({ label: 'PUSH TO PASS', accentColor: AMBER }), { name: 'P2p' }),
      el('bop-minimal', 400, 224, 560, 116, mn({ label: 'BALANCE OF PERFORMANCE', accentColor: ORANGE }), { name: 'Bop' }),
      gear(360, 360, 304, 220, AMBER, false, false),
      el('stacked-readout-minimal', 64, 380, 260, 150, mn({ label: 'KM/H', accentColor: WHITE }), { binding: 'speedKmh', name: 'Speed' }),
      el('stacked-readout-minimal', 700, 380, 260, 150, mn({ label: 'DELTA', accentColor: GREEN }), { binding: 'deltaSec', name: 'Delta' })
    ]
  ),
  D(
    'weather-watch-minimal',
    'Weather Watch',
    'Wet-weather watch: weather and track-surface panels, grip and wetness hairlines, track/air/speed tiles and quiet delta/position readouts.',
    ['minimal', 'weather', 'surface', 'wet', 'grip', 'motorsport'],
    () => [
      bg(),
      el('weather-status-minimal', 64, 72, 430, 200, mn({ label: 'WEATHER', accentColor: AMBER }), { name: 'Weather' }),
      el('track-surface-minimal', 530, 72, 430, 200, mn({ label: 'SURFACE', accentColor: ORANGE }), { name: 'Surface' }),
      el('hairline-bar-minimal', 64, 300, 430, 46, mn({ label: 'GRIP', accentColor: GREEN }), { binding: 'gripPct', name: 'Grip' }),
      el('hairline-bar-minimal', 530, 300, 430, 46, mn({ label: 'WETNESS', accentColor: AMBER }), { binding: 'trackWetnessPct', name: 'Wet' }),
      el('mono-tile-minimal', 64, 372, 290, 120, mn({ label: 'TRACK', suffix: '°C', accentColor: AMBER }), { binding: 'trackTempC', name: 'Track' }),
      el('mono-tile-minimal', 367, 372, 290, 120, mn({ label: 'AIR', suffix: '°C', accentColor: WHITE }), { binding: 'airTempC', name: 'Air' }),
      el('mono-tile-minimal', 670, 372, 290, 120, mn({ label: 'KM/H', accentColor: WHITE }), { binding: 'speedKmh', name: 'Speed' }),
      el('stacked-readout-minimal', 64, 508, 430, 80, mn({ label: 'DELTA', accentColor: GREEN }), { binding: 'deltaSec', name: 'Delta' }),
      el('stacked-readout-minimal', 530, 508, 430, 80, mn({ label: 'POS', accentColor: GOLD }), { binding: 'position', name: 'Pos' })
    ]
  ),
  D(
    'standings-minimal',
    'Quiet Standings',
    'Minimalist standings page: a clean class-standings table with a large position readout, ahead/behind gaps and a best-lap tile.',
    ['minimal', 'standings', 'position', 'gaps', 'motorsport'],
    () => [
      bg(),
      el('standings', 64, 64, 560, 470, mn({ tableColumns: ['pos', 'number', 'name', 'gap'], tableMaxRows: 10, showHeader: true, headerColor: AMBER, accentColor: AMBER }), { name: 'Standings' }),
      el('typo-readout-minimal', 680, 64, 280, 150, mn({ label: 'POSITION', accentColor: GOLD }), { binding: 'position', name: 'Pos' }),
      el('stacked-readout-minimal', 680, 230, 130, 150, mn({ label: 'AHEAD', accentColor: GREEN }), { binding: 'gapAheadFmt', name: 'Ahead' }),
      el('stacked-readout-minimal', 830, 230, 130, 150, mn({ label: 'BEHIND', accentColor: RED }), { binding: 'gapBehindFmt', name: 'Behind' }),
      el('mono-tile-minimal', 680, 396, 280, 138, mn({ label: 'BEST LAP', accentColor: GOLD }), { binding: 'bestLapFmt', name: 'Best' })
    ]
  )
]

// The wave-16 dashboards, spread into BUILTIN_PRESETS by dashboards.ts.
export const R16_PRESETS: PresetEntry[] = [...FUTURISTIC, ...MINIMALIST]

// Stable id lists (handy for tests / tooling).
export const R16_FUTURISTIC_IDS: string[] = FUTURISTIC.map((p) => p.id)
export const R16_MINIMALIST_IDS: string[] = MINIMALIST.map((p) => p.id)
