// Self-contained GAUGES & DIALS & RINGS catalog extension (round-x2). React-free
// and DOM-free — mirrors the conventions in widget-catalog-data.ts and reuses its
// `nx(...)` factory + `WidgetVariant` shape so every entry is a fully-categorised,
// telemetry-bound catalog variant. NOT wired into WIDGET_CATALOG / NEW_VARIANTS
// (the registry is intentionally left untouched); import EXTRA_GAUGE_VARIANTS where
// these circular/analog instruments are needed.
//
// Every entry uses ONLY element types and bindings already present in the base
// catalog so they render through renderGt3Widget (extra-widgets.tsx):
//   • analoggauge — 270° needle dial          (styleFamily 'analog')
//   • linearmeter — horizontal needle sweep    (styleFamily 'analog')
//   • gforcemeter — 2D g-force dot             (styleFamily 'analog')
//   • ringgauge   — thick arc/ring gauge        (styleFamily 'ring')
//   • valuegauge  — value inside a minimal arc  (styleFamily 'gauge')
//   • gauge       — generic mostrador           (styleFamily 'gauge')
//   • donut       — donut progress ring         (styleFamily 'chart')
//
// The 50 variants vary across binding × dial-style × color × min/max/warn/danger ×
// size, covering rpm, speed, fuel, water/oil temp, oil pressure, brake bias, track
// wetness, grip, throttle, brake, lap progress and tyre temperature.

import { nx } from './widget-nx'
import type { WidgetVariant } from './widget-catalog-data'

// Warm-chrome + measured-state palette (mirrors widget-catalog-data.ts hexes;
// those consts are module-private there, so we redeclare the values locally).
const GOLD = '#D4A000'
const AMBER = '#FFB000'
const ORANGE = '#FF7A00'
const CHROME = '#C9C5BC'
const CHROME_DIM = '#9A8C6E'
const GREEN = '#2FFF67'
const CYAN = '#00E7FF'
const RED = '#FF2436'
const BLUE = '#158BFF'

export const EXTRA_GAUGE_VARIANTS: WidgetVariant[] = [
  // ── DIALS · analoggauge (270° needle) ──────────────────────────────────────
  nx('x2-dial-rpm-82', 'RPM dial · 8.2k', 'analoggauge', 200, 200, 'Speed/Engine', 'analog', 'rpm', { label: 'RPM', gaugeMax: 8200, warnAt: 0.8, dangerAt: 0.9, flashAt: 0.97, accentColor: AMBER, ticks: 9 }, ['rpm', 'dial', 'needle', 'tacho']),
  nx('x2-dial-rpm-95', 'RPM dial · 9.5k', 'analoggauge', 220, 220, 'Speed/Engine', 'analog', 'rpm', { label: 'RPM', gaugeMax: 9500, warnAt: 0.82, dangerAt: 0.92, flashAt: 0.98, accentColor: ORANGE, ticks: 10 }, ['rpm', 'dial', 'needle']),
  nx('x2-dial-speed-320', 'Speed dial · 320', 'analoggauge', 200, 200, 'Speed/Engine', 'analog', 'speedKmh', { label: 'SPEED', suffix: 'km/h', gaugeMax: 320, accentColor: GOLD, ticks: 8 }, ['speed', 'dial', 'kmh']),
  nx('x2-dial-speed-360', 'Speed dial · 360', 'analoggauge', 210, 210, 'Speed/Engine', 'analog', 'speedKmh', { label: 'SPEED', suffix: 'km/h', gaugeMax: 360, accentColor: CYAN, ticks: 9 }, ['speed', 'dial', 'kmh']),
  nx('x2-dial-speed-mph', 'Speed dial · mph', 'analoggauge', 200, 200, 'Speed/Engine', 'analog', 'speedMph', { label: 'SPEED', suffix: 'mph', gaugeMax: 200, accentColor: GOLD, ticks: 8 }, ['speed', 'dial', 'mph']),
  nx('x2-dial-water', 'Water temp dial', 'analoggauge', 180, 180, 'Speed/Engine', 'analog', 'waterTempC', { label: 'WATER', suffix: '°C', gaugeMin: 40, gaugeMax: 130, warnAt: 0.7, dangerAt: 0.85, accentColor: GOLD }, ['water', 'temp', 'dial', 'engine']),
  nx('x2-dial-water-hot', 'Water dial · hot zone', 'analoggauge', 190, 190, 'Speed/Engine', 'analog', 'waterTempC', { label: 'WATER', suffix: '°C', gaugeMin: 60, gaugeMax: 140, warnAt: 0.6, dangerAt: 0.8, accentColor: RED }, ['water', 'temp', 'dial']),
  nx('x2-dial-oil-temp', 'Oil temp dial', 'analoggauge', 180, 180, 'Speed/Engine', 'analog', 'oilTempC', { label: 'OIL', suffix: '°C', gaugeMin: 40, gaugeMax: 150, warnAt: 0.7, dangerAt: 0.88, accentColor: GOLD }, ['oil', 'temp', 'dial']),
  nx('x2-dial-oil-press', 'Oil pressure dial', 'analoggauge', 180, 180, 'Speed/Engine', 'analog', 'oilPressureKpa', { label: 'OIL P', suffix: 'kPa', gaugeMax: 700, accentColor: CHROME }, ['oil', 'pressure', 'dial']),
  nx('x2-dial-oil-press-hi', 'Oil pressure · 1000', 'analoggauge', 200, 200, 'Speed/Engine', 'analog', 'oilPressureKpa', { label: 'OIL P', suffix: 'kPa', gaugeMax: 1000, warnAt: 0.85, dangerAt: 0.95, accentColor: CHROME_DIM, ticks: 10 }, ['oil', 'pressure', 'dial']),
  nx('x2-dial-fuel-120', 'Fuel dial · 120L', 'analoggauge', 180, 180, 'Fuel', 'analog', 'fuelLiters', { label: 'FUEL', suffix: 'L', gaugeMax: 120, accentColor: GREEN, ticks: 6 }, ['fuel', 'dial', 'needle']),
  nx('x2-dial-fuel-80', 'Fuel dial · 80L', 'analoggauge', 180, 180, 'Fuel', 'analog', 'fuelLiters', { label: 'FUEL', suffix: 'L', gaugeMax: 80, accentColor: GOLD, ticks: 8 }, ['fuel', 'dial']),
  nx('x2-dial-tyre-lf', 'LF tyre temp dial', 'analoggauge', 180, 180, 'Tyres/Brakes', 'analog', 'tyreLfTempC', { label: 'LF', suffix: '°C', gaugeMin: 40, gaugeMax: 120, warnAt: 0.7, dangerAt: 0.85, accentColor: AMBER }, ['tyre', 'temp', 'dial']),
  nx('x2-dial-bbias', 'Brake bias dial', 'analoggauge', 180, 180, 'Inputs', 'analog', 'ir:dcBrakeBias', { label: 'BIAS', suffix: '%', gaugeMin: 0, gaugeMax: 100, accentColor: CHROME }, ['brake', 'bias', 'dial', 'bb']),

  // ── SWEEP METERS · linearmeter (horizontal needle) ─────────────────────────
  nx('x2-lin-rpm', 'RPM sweep meter', 'linearmeter', 300, 96, 'Analog', 'analog', 'rpm', { label: 'RPM', gaugeMax: 8200, warnAt: 0.8, dangerAt: 0.9, flashAt: 0.97, accentColor: AMBER, ticks: 10 }, ['rpm', 'sweep', 'meter']),
  nx('x2-lin-speed', 'Speed sweep meter', 'linearmeter', 300, 96, 'Analog', 'analog', 'speedKmh', { label: 'SPEED', suffix: 'km/h', gaugeMax: 320, accentColor: GOLD, ticks: 10 }, ['speed', 'sweep', 'meter']),
  nx('x2-lin-speed-mph', 'Speed sweep · mph', 'linearmeter', 300, 96, 'Analog', 'analog', 'speedMph', { label: 'SPEED', suffix: 'mph', gaugeMax: 200, accentColor: CYAN, ticks: 8 }, ['speed', 'sweep', 'mph']),
  nx('x2-lin-water', 'Water sweep meter', 'linearmeter', 280, 90, 'Analog', 'analog', 'waterTempC', { label: 'WATER', suffix: '°C', gaugeMin: 40, gaugeMax: 130, warnAt: 0.7, dangerAt: 0.85, accentColor: GOLD, ticks: 9 }, ['water', 'sweep']),
  nx('x2-lin-oil', 'Oil temp sweep', 'linearmeter', 280, 90, 'Analog', 'analog', 'oilTempC', { label: 'OIL', suffix: '°C', gaugeMin: 40, gaugeMax: 150, warnAt: 0.7, dangerAt: 0.88, accentColor: ORANGE, ticks: 9 }, ['oil', 'sweep']),
  nx('x2-lin-fuel', 'Fuel sweep meter', 'linearmeter', 280, 96, 'Fuel', 'analog', 'fuelLiters', { label: 'FUEL', suffix: 'L', gaugeMax: 120, accentColor: GREEN, ticks: 10 }, ['fuel', 'sweep']),
  nx('x2-lin-oilpress', 'Oil pressure sweep', 'linearmeter', 280, 90, 'Analog', 'analog', 'oilPressureKpa', { label: 'OIL P', suffix: 'kPa', gaugeMax: 700, accentColor: CHROME, ticks: 7 }, ['oil', 'pressure', 'sweep']),
  nx('x2-lin-tyre', 'LF tyre temp sweep', 'linearmeter', 280, 90, 'Tyres/Brakes', 'analog', 'tyreLfTempC', { label: 'LF', suffix: '°C', gaugeMin: 40, gaugeMax: 120, warnAt: 0.72, dangerAt: 0.86, accentColor: AMBER, ticks: 8 }, ['tyre', 'temp', 'sweep']),

  // ── RINGS · ringgauge (thick arc, 0..1 channels) ───────────────────────────
  nx('x2-ring-rpm', 'RPM ring', 'ringgauge', 180, 180, 'Speed/Engine', 'ring', 'rpmPct', { label: 'RPM', warnAt: 0.8, dangerAt: 0.9, flashAt: 0.97, accentColor: GOLD, ringThickness: 10 }, ['rpm', 'ring', 'arc']),
  nx('x2-ring-rpm-thick', 'RPM ring · thick', 'ringgauge', 200, 200, 'Speed/Engine', 'ring', 'rpmPct', { label: 'RPM', warnAt: 0.75, dangerAt: 0.88, flashAt: 0.97, accentColor: ORANGE, ringThickness: 18 }, ['rpm', 'ring', 'thick']),
  nx('x2-ring-rpm-teal', 'RPM ring · teal', 'ringgauge', 160, 160, 'Speed/Engine', 'ring', 'rpmPct', { label: 'RPM', warnAt: 0.7, dangerAt: 0.9, accentColor: CYAN, ringThickness: 8 }, ['rpm', 'ring']),
  nx('x2-ring-fuel', 'Fuel ring', 'ringgauge', 180, 180, 'Fuel', 'ring', 'fuelPct', { label: 'FUEL', suffix: '%', accentColor: GREEN, ringThickness: 12 }, ['fuel', 'ring']),
  nx('x2-ring-fuel-low', 'Fuel ring · low warn', 'ringgauge', 170, 170, 'Fuel', 'ring', 'fuelPct', { label: 'FUEL', suffix: '%', warnAt: 0.3, dangerAt: 0.12, accentColor: AMBER, ringThickness: 10 }, ['fuel', 'ring', 'low']),
  nx('x2-ring-throttle', 'Throttle ring', 'ringgauge', 170, 170, 'Inputs', 'ring', 'throttle', { label: 'THR', suffix: '%', accentColor: GREEN, ringThickness: 10 }, ['throttle', 'ring']),
  nx('x2-ring-throttle-thin', 'Throttle ring · thin', 'ringgauge', 150, 150, 'Inputs', 'ring', 'throttle', { label: 'THR', suffix: '%', accentColor: GREEN, ringThickness: 6 }, ['throttle', 'ring', 'thin']),
  nx('x2-ring-brake', 'Brake ring', 'ringgauge', 170, 170, 'Inputs', 'ring', 'brake', { label: 'BRK', suffix: '%', accentColor: RED, ringThickness: 10 }, ['brake', 'ring']),
  nx('x2-ring-grip', 'Grip ring', 'ringgauge', 170, 170, 'Track/Radar', 'ring', 'gripPct', { label: 'GRIP', suffix: '%', accentColor: GREEN, ringThickness: 12 }, ['grip', 'ring']),
  nx('x2-ring-wet', 'Wetness ring', 'ringgauge', 170, 170, 'Track/Radar', 'ring', 'trackWetnessPct', { label: 'WET', suffix: '%', accentColor: CYAN, ringThickness: 12 }, ['wet', 'rain', 'ring']),
  nx('x2-ring-wet-warn', 'Wetness ring · warn', 'ringgauge', 180, 180, 'Track/Radar', 'ring', 'trackWetnessPct', { label: 'WET', suffix: '%', warnAt: 0.4, dangerAt: 0.7, accentColor: BLUE, ringThickness: 14 }, ['wet', 'rain', 'ring']),
  nx('x2-ring-lap', 'Lap progress ring', 'ringgauge', 170, 170, 'Track/Radar', 'ring', 'lapDistPct', { label: 'LAP', suffix: '%', accentColor: CYAN, ringThickness: 10 }, ['lap', 'progress', 'ring']),

  // ── ARC GAUGES · valuegauge (minimal 270° arc, 0..1 channels) ──────────────
  nx('x2-vg-rpm', 'RPM value gauge', 'valuegauge', 150, 150, 'Speed/Engine', 'gauge', 'rpmPct', { label: 'RPM %', suffix: '%', warnAt: 0.55, dangerAt: 0.8, accentColor: AMBER }, ['rpm', 'gauge', 'arc']),
  nx('x2-vg-fuel', 'Fuel value gauge', 'valuegauge', 150, 150, 'Fuel', 'gauge', 'fuelPct', { label: 'FUEL', suffix: '%', accentColor: GREEN }, ['fuel', 'gauge']),
  nx('x2-vg-throttle', 'Throttle value gauge', 'valuegauge', 150, 150, 'Inputs', 'gauge', 'throttle', { label: 'THR', suffix: '%', accentColor: GREEN }, ['throttle', 'gauge']),
  nx('x2-vg-brake', 'Brake value gauge', 'valuegauge', 150, 150, 'Inputs', 'gauge', 'brake', { label: 'BRK', suffix: '%', accentColor: RED }, ['brake', 'gauge']),
  nx('x2-vg-grip', 'Grip value gauge', 'valuegauge', 160, 160, 'Track/Radar', 'gauge', 'gripPct', { label: 'GRIP', suffix: '%', warnAt: 0.4, dangerAt: 0.25, accentColor: GREEN }, ['grip', 'gauge']),
  nx('x2-vg-wet', 'Wetness value gauge', 'valuegauge', 150, 150, 'Track/Radar', 'gauge', 'trackWetnessPct', { label: 'WET', suffix: '%', accentColor: CYAN }, ['wet', 'gauge']),
  nx('x2-vg-lap', 'Lap value gauge', 'valuegauge', 150, 150, 'Track/Radar', 'gauge', 'lapDistPct', { label: 'LAP', suffix: '%', accentColor: BLUE }, ['lap', 'gauge']),

  // ── DONUT RINGS · donut (center value, 0..1 channels) ──────────────────────
  nx('x2-donut-fuel', 'Fuel donut', 'donut', 180, 180, 'Fuel', 'chart', 'fuelPct', { label: 'FUEL', accentColor: GREEN }, ['fuel', 'donut', 'ring']),
  nx('x2-donut-rpm', 'RPM donut', 'donut', 180, 180, 'Speed/Engine', 'chart', 'rpmPct', { label: 'RPM', warnAt: 0.7, dangerAt: 0.9, accentColor: AMBER }, ['rpm', 'donut', 'ring']),
  nx('x2-donut-lap', 'Lap progress donut', 'donut', 180, 180, 'Track/Radar', 'chart', 'lapDistPct', { label: 'LAP', accentColor: CYAN }, ['lap', 'donut']),
  nx('x2-donut-wet', 'Track wetness donut', 'donut', 180, 180, 'Track/Radar', 'chart', 'trackWetnessPct', { label: 'WET', accentColor: CYAN }, ['wet', 'rain', 'donut']),
  nx('x2-donut-grip', 'Grip donut', 'donut', 190, 190, 'Track/Radar', 'chart', 'gripPct', { label: 'GRIP', accentColor: GREEN }, ['grip', 'donut']),

  // ── GENERIC GAUGES · gauge (mostrador, fill/warn/danger ramp) ──────────────
  nx('x2-gauge-rpm', 'RPM gauge', 'gauge', 200, 120, 'Charts/Graphs', 'gauge', 'rpmPct', { label: 'RPM', fillColor: AMBER, warnColor: ORANGE, dangerColor: RED, warnAt: 0.7, dangerAt: 0.9, accentColor: AMBER }, ['rpm', 'gauge', 'mostrador']),
  nx('x2-gauge-throttle', 'Throttle gauge', 'gauge', 200, 120, 'Inputs', 'gauge', 'throttle', { label: 'THR', fillColor: GREEN, warnColor: GOLD, dangerColor: RED, accentColor: GREEN }, ['throttle', 'gauge', 'mostrador']),
  nx('x2-gauge-brake', 'Brake gauge', 'gauge', 200, 120, 'Inputs', 'gauge', 'brake', { label: 'BRK', fillColor: RED, warnColor: ORANGE, dangerColor: RED, accentColor: RED }, ['brake', 'gauge', 'mostrador']),

  // ── G-FORCE · gforcemeter (2D dot, telemetry-driven, no single binding) ────
  nx('x2-gforce', 'G-force meter', 'gforcemeter', 200, 200, 'Analog', 'analog', undefined, { label: 'G-FORCE', gaugeMax: 2.5, accentColor: AMBER }, ['gforce', 'gg', 'accel', 'dial'])
]
