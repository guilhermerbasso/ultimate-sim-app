// Extra readouts & timing catalog variants (round "x1"). Self-contained data-only
// module: it reuses the EXPORTED `nx(...)` factory + `WidgetVariant` shape from
// widget-catalog-data.ts so every entry matches the existing catalog contract.
// The registry is wired up elsewhere — this file only authors the variants.
//
// Every element `type` and telemetry `binding` used here already appears in
// widget-catalog-data.ts (and resolves in dashboard/binding.ts), so all 50
// widgets render with live telemetry. Each variant varies binding × style ×
// label × accent × size to stay genuinely distinct and useful.

import { nx } from './widget-nx'
import type { WidgetVariant } from './widget-catalog-data'

// Local accent palette (hex values mirror widget-catalog-data.ts so the look is
// consistent). Kept local to keep this module self-contained.
const ACCENT = 'var(--accent-primary)'
const GOLD = '#D4A000'
const AMBER = '#FFB000'
const ORANGE = '#FF7A00'
const CHROME = '#C9C5BC'
const GREEN = '#2FFF67'
const CYAN = '#00E7FF'
const RED = '#FF2436'
const BLUE = '#158BFF'
const TEXT_FG = '#f6fbff'

export const EXTRA_READOUT_VARIANTS: WidgetVariant[] = [
  // ── SPEED (8) ──────────────────────────────────────────────────────────────
  nx('x1-speed-seg7-kmh', 'Speed · 7-seg (km/h)', 'segment7', 220, 120, 'Speed/Engine', 'digital', 'speedKmh', { label: 'SPEED', accentColor: GOLD }, ['speed', '7seg', 'digital', 'kmh']),
  nx('x1-speed-big-kmh', 'Speed · big (km/h)', 'bigtext', 240, 140, 'Speed/Engine', 'clean', 'speedKmh', { label: 'KM/H', accentColor: TEXT_FG }, ['speed', 'big', 'clean', 'kmh']),
  nx('x1-speed-value-kmh', 'Speed · value (km/h)', 'value', 200, 96, 'Speed/Engine', 'clean', 'speedKmh', { label: 'SPEED', suffix: ' km/h', accentColor: CYAN }, ['speed', 'value', 'clean']),
  nx('x1-speed-dial-kmh', 'Speed · dial (km/h)', 'analoggauge', 200, 200, 'Speed/Engine', 'analog', 'speedKmh', { label: 'SPEED', suffix: 'km/h', gaugeMax: 320, ticks: 8, accentColor: GOLD }, ['speed', 'dial', 'needle', 'kmh']),
  nx('x1-speed-linear-kmh', 'Speed · sweep (km/h)', 'linearmeter', 300, 96, 'Analog', 'analog', 'speedKmh', { label: 'SPEED', suffix: 'km/h', gaugeMax: 320, ticks: 10, accentColor: AMBER }, ['speed', 'sweep', 'analog']),
  nx('x1-speed-trace-kmh', 'Speed · trace (km/h)', 'historygraph', 320, 130, 'Charts/Graphs', 'graph', 'speedKmh', { label: 'SPEED', suffix: 'km/h', graphStyle: 'line', traceLength: 200, accentColor: GOLD }, ['speed', 'trace', 'graph']),
  nx('x1-speed-dial-mph', 'Speed · dial (mph)', 'analoggauge', 200, 200, 'Speed/Engine', 'analog', 'speedMph', { label: 'SPEED', suffix: 'mph', gaugeMax: 200, ticks: 8, accentColor: CHROME }, ['speed', 'dial', 'mph']),
  nx('x1-speed-clean', 'Speed · clean (curated)', 'speed-clean', 220, 96, 'Speed/Engine', 'clean', undefined, { label: 'SPEED', accentColor: ACCENT }, ['speed', 'clean', 'curated']),

  // ── RPM & SHIFT (8) ─────────────────────────────────────────────────────────
  nx('x1-rpm-seg7', 'RPM · 7-seg', 'segment7', 240, 120, 'Speed/Engine', 'digital', 'rpm', { label: 'RPM', accentColor: AMBER }, ['rpm', '7seg', 'digital']),
  nx('x1-rpm-big', 'RPM · big', 'bigtext', 240, 140, 'Speed/Engine', 'clean', 'rpm', { label: 'RPM', accentColor: AMBER }, ['rpm', 'big', 'clean']),
  nx('x1-rpm-dial', 'RPM · dial', 'analoggauge', 200, 200, 'Speed/Engine', 'analog', 'rpm', { label: 'RPM', gaugeMax: 8200, warnAt: 0.8, dangerAt: 0.9, flashAt: 0.97, ticks: 9, accentColor: AMBER }, ['rpm', 'tacho', 'dial']),
  nx('x1-rpm-linear', 'RPM · sweep', 'linearmeter', 300, 96, 'Analog', 'analog', 'rpm', { label: 'RPM', gaugeMax: 8200, warnAt: 0.8, dangerAt: 0.9, flashAt: 0.97, ticks: 10, accentColor: ORANGE }, ['rpm', 'sweep', 'analog']),
  nx('x1-rpm-ring-pct', 'RPM % · ring', 'ringgauge', 180, 180, 'Speed/Engine', 'ring', 'rpmPct', { label: 'RPM', warnAt: 0.8, dangerAt: 0.9, flashAt: 0.97, ringThickness: 10, accentColor: GOLD }, ['rpm', 'ring', 'arc']),
  nx('x1-rpm-gauge-pct', 'RPM % · value gauge', 'valuegauge', 150, 150, 'Speed/Engine', 'gauge', 'rpmPct', { label: 'RPM %', suffix: '%', warnAt: 0.55, dangerAt: 0.8, accentColor: AMBER }, ['rpm', 'gauge', 'arc']),
  nx('x1-rpm-segbar-pct', 'RPM % · segment bar', 'segmentbars', 320, 80, 'Speed/Engine', 'bar', 'rpmPct', { label: 'RPM', segments: 20, warnAt: 0.6, dangerAt: 0.85, flashAt: 0.97, accentColor: GREEN }, ['rpm', 'segments', 'bar']),
  nx('x1-shift-bar-pct', 'Shift % · value bar', 'valuebar', 220, 104, 'Speed/Engine', 'bar', 'shiftPct', { label: 'SHIFT', suffix: '%', accentColor: ORANGE }, ['shift', 'rpm', 'bar']),

  // ── GEAR (5) ─────────────────────────────────────────────────────────────────
  nx('x1-gear-seg7', 'Gear · 7-seg', 'segment7', 150, 170, 'Speed/Engine', 'digital', 'gearLabel', { label: 'GEAR', accentColor: AMBER }, ['gear', '7seg', 'digital']),
  nx('x1-gear-big', 'Gear · big', 'bigtext', 160, 160, 'Speed/Engine', 'clean', 'gearLabel', { label: 'GEAR', accentColor: AMBER }, ['gear', 'big', 'clean']),
  nx('x1-gear-value', 'Gear · value', 'value', 140, 140, 'Speed/Engine', 'clean', 'gearLabel', { label: 'GEAR', maxFontSize: 120, accentColor: GOLD }, ['gear', 'value', 'clean']),
  nx('x1-gear-clean', 'Gear · clean (curated)', 'gear-clean', 160, 140, 'Speed/Engine', 'digital', undefined, { label: 'GEAR', accentColor: AMBER }, ['gear', 'clean', 'curated']),
  nx('x1-gear-elaborate', 'Gear · elaborate (curated)', 'gear-elaborate', 220, 180, 'Speed/Engine', 'clean', undefined, { label: 'GEAR', accentColor: AMBER }, ['gear', 'elaborate', 'curated']),

  // ── FUEL (5) ─────────────────────────────────────────────────────────────────
  nx('x1-fuel-value-l', 'Fuel · value (L)', 'value', 220, 96, 'Fuel', 'clean', 'fuelLitersStr', { label: 'FUEL', suffix: ' L', accentColor: GREEN }, ['fuel', 'value', 'clean']),
  nx('x1-fuel-big-l', 'Fuel · big (L)', 'bigtext', 220, 130, 'Fuel', 'clean', 'fuelLitersStr', { label: 'FUEL', suffix: ' L', accentColor: GREEN }, ['fuel', 'big', 'clean']),
  nx('x1-fuel-ring-pct', 'Fuel % · ring', 'ringgauge', 180, 180, 'Fuel', 'ring', 'fuelPct', { label: 'FUEL', suffix: '%', accentColor: GREEN }, ['fuel', 'ring', 'arc']),
  nx('x1-fuel-donut-pct', 'Fuel % · donut', 'donut', 180, 180, 'Fuel', 'chart', 'fuelPct', { label: 'FUEL', accentColor: GREEN }, ['fuel', 'donut', 'pie']),
  nx('x1-fuel-clean', 'Fuel · clean (curated)', 'fuel-clean', 220, 96, 'Fuel', 'clean', undefined, { label: 'FUEL', accentColor: GOLD }, ['fuel', 'clean', 'curated']),

  // ── POSITION (5) ─────────────────────────────────────────────────────────────
  nx('x1-pos-seg7', 'Position · 7-seg', 'segment7', 160, 150, 'Position/Standings', 'digital', 'position', { label: 'POS', prefix: 'P', accentColor: AMBER }, ['position', '7seg', 'digital']),
  nx('x1-pos-big', 'Position · big', 'bigtext', 200, 140, 'Position/Standings', 'clean', 'position', { label: 'POSITION', prefix: 'P', accentColor: AMBER }, ['position', 'big', 'clean']),
  nx('x1-pos-value-class', 'Class position · value', 'value', 180, 96, 'Position/Standings', 'clean', 'classPosition', { label: 'CLASS', prefix: 'P', accentColor: GOLD }, ['position', 'class', 'value']),
  nx('x1-pos-clean', 'Position · clean (curated)', 'position-clean', 220, 96, 'Position/Standings', 'clean', undefined, { label: 'POS', accentColor: AMBER }, ['position', 'clean', 'curated']),
  nx('x1-pos-elaborate', 'Position · elaborate (curated)', 'position-elaborate', 280, 140, 'Position/Standings', 'clean', undefined, { label: 'POS', accentColor: AMBER }, ['position', 'elaborate', 'curated']),

  // ── INCIDENTS (3) ────────────────────────────────────────────────────────────
  nx('x1-inc-seg7', 'Incidents · 7-seg', 'segment7', 180, 120, 'Flags/Status', 'digital', 'incidentCount', { label: 'INC', accentColor: ORANGE }, ['incidents', '7seg', 'digital']),
  nx('x1-inc-value', 'Incidents · value', 'value', 200, 96, 'Flags/Status', 'clean', 'incidentCount', { label: 'INCIDENTS', suffix: 'x', accentColor: RED }, ['incidents', 'value', 'clean']),
  nx('x1-inc-clean', 'Incidents · clean (curated)', 'incidents-clean', 180, 90, 'Flags/Status', 'status', undefined, { label: 'INC', accentColor: RED }, ['incidents', 'clean', 'curated']),

  // ── LAPS REMAINING & PROGRESS (3) ────────────────────────────────────────────
  nx('x1-laps-seg7', 'Laps left · 7-seg', 'segment7', 200, 120, 'Timing/Delta', 'digital', 'lapsRemaining', { label: 'LAPS', accentColor: GOLD }, ['laps', '7seg', 'digital']),
  nx('x1-laps-value', 'Laps left · value', 'value', 200, 96, 'Timing/Delta', 'clean', 'lapsRemaining', { label: 'LAPS LEFT', accentColor: CYAN }, ['laps', 'value', 'clean']),
  nx('x1-lap-progress-donut', 'Lap progress · donut', 'donut', 180, 180, 'Track/Radar', 'chart', 'lapDistPct', { label: 'LAP', accentColor: CYAN }, ['lap', 'progress', 'donut']),

  // ── LAP TIMES (6) ────────────────────────────────────────────────────────────
  nx('x1-lap-current-clock', 'Current lap · clock', 'digitalclock', 280, 120, 'Timing/Delta', 'digital', 'currentLapFmt', { label: 'CURRENT', accentColor: CYAN }, ['lap', 'clock', 'current']),
  nx('x1-lap-last-clock', 'Last lap · clock', 'digitalclock', 280, 120, 'Timing/Delta', 'digital', 'lastLapFmt', { label: 'LAST', accentColor: CYAN }, ['lap', 'clock', 'last']),
  nx('x1-lap-best-clock', 'Best lap · clock', 'digitalclock', 280, 120, 'Timing/Delta', 'digital', 'bestLapFmt', { label: 'BEST', accentColor: GREEN }, ['lap', 'clock', 'best']),
  nx('x1-lap-est-clock', 'Est. lap · clock', 'digitalclock', 280, 120, 'Timing/Delta', 'digital', 'estLapFmt', { label: 'EST', accentColor: GOLD }, ['lap', 'clock', 'estimated']),
  nx('x1-lap-best-value', 'Best lap · value', 'value', 240, 96, 'Timing/Delta', 'clean', 'bestLapFmt', { label: 'BEST LAP', accentColor: GREEN }, ['lap', 'best', 'value']),
  nx('x1-laptiming-tile', 'Lap timing · tile', 'laptiming', 300, 96, 'Timing/Delta', 'clean', undefined, { title: 'Tempos', showCurrent: true, showLast: true, showBest: true, accentColor: ACCENT }, ['lap', 'timing', 'tile']),

  // ── DELTAS & GAPS (7) ────────────────────────────────────────────────────────
  nx('x1-delta-best-value', 'Delta to best · value', 'value', 240, 96, 'Timing/Delta', 'clean', 'deltaBestFmt', { label: 'DELTA', accentColor: CYAN }, ['delta', 'best', 'value']),
  nx('x1-delta-sb-value', 'Delta to session best · value', 'value', 240, 96, 'Timing/Delta', 'clean', 'deltaSessionBestFmt', { label: 'DELTA SB', accentColor: CYAN }, ['delta', 'session', 'value']),
  nx('x1-delta-trace', 'Delta · history graph', 'historygraph', 320, 120, 'Timing/Delta', 'graph', 'deltaSec', { label: 'DELTA', suffix: 's', graphStyle: 'line', traceLength: 240, accentColor: CYAN }, ['delta', 'history', 'graph']),
  nx('x1-delta-tile', 'Delta · predictive tile', 'deltatile', 320, 96, 'Timing/Delta', 'clean', undefined, { title: 'Delta', deltaReference: 'session', deltaRangeSec: 1, accentColor: ACCENT }, ['delta', 'tile', 'predictive']),
  nx('x1-delta-elaborate', 'Delta · elaborate (curated)', 'delta-elaborate', 300, 140, 'Timing/Delta', 'clean', undefined, { label: 'DELTA', accentColor: BLUE }, ['delta', 'elaborate', 'curated']),
  nx('x1-gap-ahead-value', 'Gap ahead · value', 'value', 200, 96, 'Position/Standings', 'clean', 'gapAheadFmt', { label: 'GAP AHEAD', accentColor: GREEN }, ['gap', 'ahead', 'value']),
  nx('x1-gap-behind-value', 'Gap behind · value', 'value', 200, 96, 'Position/Standings', 'clean', 'gapBehindFmt', { label: 'GAP BEHIND', accentColor: RED }, ['gap', 'behind', 'value'])
]
