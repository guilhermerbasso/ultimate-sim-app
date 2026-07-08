// Self-contained catalog pack: 50 extra STRATEGY / TIMING-TABLES /
// TRACK-CONDITIONS / RELATIVES widget variants. Built with the shared `nx(...)`
// factory so every entry matches the WidgetVariant shape (category + styleFamily
// + tags + gt3 style). Uses ONLY element types and telemetry bindings that already
// exist in the catalog/binding layer. This module is intentionally NOT wired into
// the registry — it is an additive, importable pack.
import { nx } from './widget-nx'
import type { WidgetVariant } from './widget-catalog-data'

// Local palette (self-contained — mirrors the catalog's warm-chrome + live-state
// accents without importing the module-private constants).
const GOLD = '#D4A000'
const AMBER = '#FFB000'
const ORANGE = '#FF7A00'
const CHROME = '#C9C5BC'
const GREEN = '#2FFF67'
const CYAN = '#00E7FF'
const RED = '#FF2436'
const BLUE = '#158BFF'
const ACCENT = 'var(--accent-primary)'
const WARN = 'var(--accent-warning)'
const PANEL = '#000000'
const STROKE = '#1F1F1F'

export const EXTRA_STRATEGY_VARIANTS: WidgetVariant[] = [
  // ── Gap to car AHEAD (gapAheadFmt) ─────────────────────────────────────────
  nx('x4-gap-ahead-tile', 'Gap ahead · tile', 'value', 220, 96, 'Timing/Delta', 'clean', 'gapAheadFmt', { label: 'GAP AHEAD', accentColor: CYAN }, ['gap', 'ahead', 'interval', 'strategy']),
  nx('x4-gap-ahead-big', 'Gap ahead · big', 'bigtext', 240, 130, 'Timing/Delta', 'clean', 'gapAheadFmt', { label: 'AHEAD', background: PANEL, border: STROKE, accentColor: CYAN }, ['gap', 'ahead', 'big']),
  nx('x4-gap-ahead-seg', 'Gap ahead · 7-seg', 'segment7', 220, 120, 'Timing/Delta', 'digital', 'gapAheadFmt', { label: 'AHEAD', accentColor: GOLD }, ['gap', 'ahead', '7seg']),
  nx('x4-gap-ahead-front', 'Gap ahead · Δ front', 'value', 200, 88, 'Position/Standings', 'clean', 'gapAheadFmt', { label: 'Δ FRONT', accentColor: GOLD }, ['gap', 'ahead', 'relative']),

  // ── Gap to car BEHIND (gapBehindFmt) ───────────────────────────────────────
  nx('x4-gap-behind-tile', 'Gap behind · tile', 'value', 220, 96, 'Timing/Delta', 'clean', 'gapBehindFmt', { label: 'GAP BEHIND', accentColor: AMBER }, ['gap', 'behind', 'interval', 'strategy']),
  nx('x4-gap-behind-big', 'Gap behind · big', 'bigtext', 240, 130, 'Timing/Delta', 'clean', 'gapBehindFmt', { label: 'BEHIND', background: PANEL, border: STROKE, accentColor: AMBER }, ['gap', 'behind', 'big']),
  nx('x4-gap-behind-seg', 'Gap behind · 7-seg', 'segment7', 220, 120, 'Timing/Delta', 'digital', 'gapBehindFmt', { label: 'BEHIND', accentColor: ORANGE }, ['gap', 'behind', '7seg']),
  nx('x4-gap-behind-rear', 'Gap behind · Δ rear', 'value', 200, 88, 'Position/Standings', 'clean', 'gapBehindFmt', { label: 'Δ REAR', accentColor: RED }, ['gap', 'behind', 'relative']),

  // ── Delta to BEST lap (deltaBestFmt / deltaToBestSec) ──────────────────────
  nx('x4-delta-best-tile', 'Delta best · tile', 'value', 220, 96, 'Timing/Delta', 'clean', 'deltaBestFmt', { label: 'DELTA BEST', accentColor: CYAN }, ['delta', 'best', 'timing']),
  nx('x4-delta-best-big', 'Delta best · big', 'bigtext', 260, 140, 'Timing/Delta', 'clean', 'deltaBestFmt', { label: 'Δ BEST', background: PANEL, border: STROKE, accentColor: CYAN }, ['delta', 'best', 'big']),
  nx('x4-delta-best-graph', 'Delta best · history', 'historygraph', 320, 120, 'Timing/Delta', 'graph', 'deltaToBestSec', { label: 'Δ BEST', suffix: 's', graphStyle: 'line', accentColor: CYAN, traceLength: 240 }, ['delta', 'best', 'history']),
  nx('x4-deltatile-best', 'Delta tile · best', 'deltatile', 320, 96, 'Timing/Delta', 'clean', undefined, { radius: 14, deltaReference: 'best', deltaRangeSec: 1, title: 'Δ Best' }, ['delta', 'best', 'predictive']),

  // ── Delta to SESSION best (deltaSessionBestFmt / deltaToSessionBestSec) ────
  nx('x4-delta-sb-tile', 'Delta session best · tile', 'value', 220, 96, 'Timing/Delta', 'clean', 'deltaSessionBestFmt', { label: 'Δ SESSION', accentColor: BLUE }, ['delta', 'session', 'best']),
  nx('x4-delta-sb-big', 'Delta session best · big', 'bigtext', 260, 140, 'Timing/Delta', 'clean', 'deltaSessionBestFmt', { label: 'Δ SB', background: PANEL, border: STROKE, accentColor: BLUE }, ['delta', 'session', 'big']),
  nx('x4-delta-sb-graph', 'Delta session best · history', 'historygraph', 320, 120, 'Timing/Delta', 'graph', 'deltaToSessionBestSec', { label: 'Δ SB', suffix: 's', graphStyle: 'area', accentColor: BLUE, traceLength: 240 }, ['delta', 'session', 'history']),
  nx('x4-deltatile-session', 'Delta tile · session', 'deltatile', 360, 96, 'Timing/Delta', 'clean', undefined, { radius: 16, deltaReference: 'session', deltaRangeSec: 2, title: 'Δ Session' }, ['delta', 'session', 'predictive']),

  // ── Best / Last / Est / Current lap tiles + lap timing panels ──────────────
  nx('x4-lap-best-clock', 'Best lap · clock', 'digitalclock', 280, 120, 'Timing/Delta', 'digital', 'bestLapFmt', { label: 'BEST', accentColor: GREEN }, ['lap', 'best', 'clock']),
  nx('x4-lap-last-clock', 'Last lap · clock', 'digitalclock', 280, 120, 'Timing/Delta', 'digital', 'lastLapFmt', { label: 'LAST', accentColor: CYAN }, ['lap', 'last', 'clock']),
  nx('x4-lap-est-clock', 'Est lap · clock', 'digitalclock', 280, 120, 'Timing/Delta', 'digital', 'estLapFmt', { label: 'EST', accentColor: AMBER }, ['lap', 'estimated', 'clock']),
  nx('x4-lap-current-big', 'Current lap · big', 'bigtext', 240, 130, 'Timing/Delta', 'clean', 'currentLapFmt', { label: 'CURRENT', background: PANEL, border: STROKE, accentColor: GOLD }, ['lap', 'current', 'big']),
  nx('x4-laptiming-panel', 'Lap timing · panel', 'laptiming', 300, 96, 'Timing/Delta', 'clean', undefined, { showCurrent: true, showLast: true, showBest: true, title: 'Tempos' }, ['lap', 'timing', 'panel']),
  nx('x4-laptiming-wide', 'Lap timing · wide', 'laptiming', 360, 120, 'Timing/Delta', 'clean', undefined, { showCurrent: true, showLast: true, showBest: true, title: 'Lap Times', radius: 14 }, ['lap', 'timing', 'wide']),

  // ── Session time remaining ─────────────────────────────────────────────────
  nx('x4-session-clock', 'Session · time left', 'digitalclock', 300, 120, 'Timing/Delta', 'digital', 'sessionTimeLeftFmt', { label: 'TIME LEFT', accentColor: GOLD }, ['session', 'time', 'clock']),
  nx('x4-session-time-big', 'Session · big', 'bigtext', 260, 130, 'Timing/Delta', 'clean', 'sessionTimeLeftFmt', { label: 'SESSION', background: PANEL, border: STROKE, accentColor: CHROME }, ['session', 'time', 'big']),

  // ── Fuel / stint strategy ──────────────────────────────────────────────────
  nx('x4-fuelstint-tile', 'Fuel stint · tile', 'fuelstint', 300, 92, 'Fuel', 'clean', undefined, { reserveLaps: 1, warnAtLaps: 2, title: 'Fuel' }, ['fuel', 'stint', 'strategy']),
  nx('x4-fuelstint-wide', 'Fuel stint · wide', 'fuelstint', 340, 110, 'Fuel', 'clean', undefined, { reserveLaps: 2, warnAtLaps: 3, title: 'Fuel / Stint', radius: 14 }, ['fuel', 'stint', 'wide']),
  nx('x4-fuelstint-endurance', 'Fuel stint · endurance', 'fuelstint', 320, 120, 'Fuel', 'clean', undefined, { reserveLaps: 3, warnAtLaps: 4, title: 'Stint', radius: 16 }, ['fuel', 'stint', 'endurance']),
  nx('x4-fuel-perlap-tile', 'Fuel per lap · tile', 'value', 200, 96, 'Fuel', 'clean', 'fuelPerLapStr', { label: 'FUEL/LAP', suffix: ' L', accentColor: GOLD }, ['fuel', 'perlap', 'stint']),
  nx('x4-fuel-level-tile', 'Fuel level · tile', 'value', 200, 96, 'Fuel', 'clean', 'fuelLitersStr', { label: 'FUEL', suffix: ' L', accentColor: GREEN }, ['fuel', 'level', 'stint']),
  nx('x4-fuel-pct-ring', 'Fuel · ring', 'ringgauge', 180, 180, 'Fuel', 'ring', 'fuelPct', { label: 'FUEL', suffix: '%', accentColor: GREEN }, ['fuel', 'ring', 'stint']),

  // ── Standings / relatives / position gaps ──────────────────────────────────
  nx('x4-standings-relative3', 'Standings · relative 3', 'standings', 560, 92, 'Position/Standings', 'table', undefined, { radius: 10, fontSize: 13, tableColumns: ['pos', 'number', 'name', 'gap'], tableMaxRows: 3, showHeader: false, highlightPlayer: true }, ['standings', 'relative', 'table']),
  nx('x4-standings-tower6', 'Standings · tower 6', 'standings', 360, 360, 'Position/Standings', 'table', undefined, { radius: 12, fontSize: 14, tableColumns: ['pos', 'number', 'name', 'gap', 'class'], tableMaxRows: 6, showHeader: true, highlightPlayer: true }, ['standings', 'tower', 'table']),
  nx('x4-standings-tower12', 'Standings · tower 12', 'standings', 380, 560, 'Position/Standings', 'table', undefined, { radius: 12, fontSize: 14, tableColumns: ['pos', 'number', 'name', 'gap', 'last'], tableMaxRows: 12, showHeader: true, highlightPlayer: true }, ['standings', 'tower', 'endurance']),
  nx('x4-relatives-clean', 'Relatives · clean', 'relatives-clean', 420, 132, 'Position/Standings', 'table', undefined, { reference: '±1 CAR', accentColor: WARN }, ['relatives', 'radar', 'clean']),
  nx('x4-relatives-elaborate', 'Relatives · elaborate', 'relatives-elaborate', 520, 180, 'Position/Standings', 'table', undefined, { reference: 'NAME / GAP / LAST', accentColor: WARN }, ['relatives', 'radar', 'elaborate']),
  nx('x4-positiongaps-tile', 'Position + gaps · tile', 'positiongaps', 300, 92, 'Position/Standings', 'clean', undefined, { showTotal: true }, ['position', 'gaps', 'standings']),

  // ── Track maps / radar / mini map ──────────────────────────────────────────
  nx('x4-trackmap-clean', 'Track map · clean', 'trackmap-clean', 280, 220, 'Track/Radar', 'chart', undefined, { accentColor: ACCENT }, ['trackmap', 'map', 'clean']),
  nx('x4-trackmap-elaborate', 'Track map · elaborate', 'trackmap-elaborate', 380, 300, 'Track/Radar', 'chart', undefined, { accentColor: ACCENT }, ['trackmap', 'map', 'elaborate']),
  nx('x4-radar-clean', 'Radar · clean', 'radar-clean', 220, 220, 'Track/Radar', 'chart', undefined, { accentColor: AMBER }, ['radar', 'proximity', 'clean']),
  nx('x4-radar-elaborate', 'Radar · elaborate', 'radar-elaborate', 280, 280, 'Track/Radar', 'chart', undefined, { accentColor: AMBER }, ['radar', 'proximity', 'elaborate']),
  nx('x4-trackmini-map', 'Mini map · progress', 'trackmini', 200, 200, 'Track/Radar', 'chart', 'lapDistPct', { radius: 12, accentColor: ACCENT }, ['trackmap', 'mini', 'progress']),

  // ── Track condition + weather tiles ────────────────────────────────────────
  nx('x4-weather-panel', 'Weather · panel', 'weather', 300, 92, 'Track/Radar', 'status', undefined, { radius: 12, title: 'Clima' }, ['weather', 'track', 'condition']),
  nx('x4-weather-wide', 'Weather · wide', 'weather', 360, 110, 'Track/Radar', 'status', undefined, { radius: 14, title: 'Weather / Track' }, ['weather', 'track', 'wide']),
  nx('x4-track-temp-tile', 'Track temp · tile', 'value', 200, 96, 'Track/Radar', 'clean', 'trackTempC', { label: 'TRACK', suffix: '°C', accentColor: ORANGE }, ['track', 'temp', 'weather']),
  nx('x4-air-temp-tile', 'Air temp · tile', 'value', 200, 96, 'Track/Radar', 'clean', 'airTempC', { label: 'AIR', suffix: '°C', accentColor: CYAN }, ['air', 'temp', 'weather']),
  nx('x4-grip-ring', 'Grip · ring', 'ringgauge', 170, 170, 'Track/Radar', 'ring', 'gripPct', { label: 'GRIP', suffix: '%', accentColor: GREEN }, ['grip', 'track', 'condition']),
  nx('x4-wetness-donut', 'Wetness · donut', 'donut', 180, 180, 'Track/Radar', 'chart', 'trackWetnessPct', { label: 'WET', accentColor: CYAN }, ['wetness', 'rain', 'condition']),

  // ── Incidents ──────────────────────────────────────────────────────────────
  nx('x4-incidents-clean', 'Incidents · clean', 'incidents-clean', 180, 90, 'Flags/Status', 'status', undefined, { accentColor: RED }, ['incidents', 'race-control', 'clean']),
  nx('x4-incidents-elaborate', 'Incidents · elaborate', 'incidents-elaborate', 220, 130, 'Flags/Status', 'status', undefined, { accentColor: RED }, ['incidents', 'race-control', 'elaborate']),
  nx('x4-incidents-count', 'Incidents · count', 'value', 180, 96, 'Flags/Status', 'clean', 'incidentCount', { label: 'INCIDENTS', suffix: ' x', accentColor: ORANGE }, ['incidents', 'count', 'penalty'])
]
