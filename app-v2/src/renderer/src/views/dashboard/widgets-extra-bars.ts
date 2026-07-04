// Self-contained extra BAR / SEGMENT-BAR / INPUT widget catalog variants.
//
// 50 NEW `WidgetVariant`s built with the shared `nx(...)` factory. This module is
// purely additive and self-contained: it does NOT touch the registry
// (widget-catalog-data.ts) — it only imports the exported `nx` helper and the
// `WidgetVariant` type. Nothing here is wired into the gallery unless a consumer
// chooses to spread `EXTRA_BAR_VARIANTS` into a category.
//
// Every entry reuses ONLY element types + bindings already present in the catalog
// file and varies along: binding × bar-style × segment count × warn/danger
// thresholds × color × orientation × size. All ids are unique and prefixed `x3-`.

import { nx } from './widget-nx'
import type { WidgetVariant } from './widget-catalog-data'

// Palette (mirrors the catalog constants so this file stays self-contained).
const GREEN = '#2FFF67'
const AMBER = '#FFB000'
const GOLD = '#D4A000'
const ORANGE = '#FF7A00'
const RED = '#FF2436'
const CYAN = '#00E7FF'

export const EXTRA_BAR_VARIANTS: WidgetVariant[] = [
  // ── SEGMENT BARS — segmented block bars over a 0..1 channel ──────────────────
  nx('x3-seg-throttle-16', 'Throttle segment bar · 16', 'segmentbars', 280, 90, 'Inputs', 'bar', 'throttle', { label: 'THROTTLE', suffix: '%', segments: 16, accentColor: GREEN }, ['throttle', 'segments', 'bar', 'input']),
  nx('x3-seg-brake-16', 'Brake segment bar · 16', 'segmentbars', 280, 90, 'Inputs', 'bar', 'brake', { label: 'BRAKE', suffix: '%', segments: 16, accentColor: RED }, ['brake', 'segments', 'bar', 'input']),
  nx('x3-seg-rpm-20', 'RPM segment bar · 20', 'segmentbars', 320, 80, 'Speed/Engine', 'bar', 'rpmPct', { label: 'RPM', segments: 20, warnAt: 0.6, dangerAt: 0.85, flashAt: 0.97, accentColor: GREEN }, ['rpm', 'segments', 'bar', 'shift']),
  nx('x3-seg-rpm-24', 'RPM segment bar · 24', 'segmentbars', 360, 72, 'Speed/Engine', 'bar', 'rpmPct', { label: 'RPM', segments: 24, warnAt: 0.7, dangerAt: 0.9, flashAt: 0.98, accentColor: AMBER }, ['rpm', 'segments', 'bar', 'dense']),
  nx('x3-seg-fuel-12', 'Fuel segment bar · 12', 'segmentbars', 260, 84, 'Fuel', 'bar', 'fuelPct', { label: 'FUEL', suffix: '%', segments: 12, warnAt: 0.3, dangerAt: 0.12, accentColor: GOLD }, ['fuel', 'segments', 'bar']),
  nx('x3-seg-shift-18', 'Shift segment bar · 18', 'segmentbars', 340, 76, 'Speed/Engine', 'bar', 'shiftPct', { label: 'SHIFT', segments: 18, flashAt: 0.97, accentColor: ORANGE }, ['shift', 'segments', 'bar', 'rpm']),
  nx('x3-seg-speed-30', 'Speed segment bar · 30', 'segmentbars', 400, 70, 'Speed/Engine', 'bar', 'speedKmh', { label: 'SPEED', suffix: 'km/h', segments: 30, gaugeMax: 320, accentColor: GOLD }, ['speed', 'segments', 'bar']),
  nx('x3-seg-grip-14', 'Grip segment bar · 14', 'segmentbars', 260, 84, 'Track/Radar', 'bar', 'gripPct', { label: 'GRIP', suffix: '%', segments: 14, accentColor: CYAN }, ['grip', 'segments', 'bar', 'track']),
  nx('x3-seg-wet-16', 'Wetness segment bar · 16', 'segmentbars', 280, 84, 'Track/Radar', 'bar', 'trackWetnessPct', { label: 'WET', suffix: '%', segments: 16, warnAt: 0.4, dangerAt: 0.7, accentColor: CYAN }, ['wet', 'rain', 'segments', 'bar']),
  nx('x3-seg-throttle-24', 'Throttle segment bar · 24', 'segmentbars', 360, 64, 'Inputs', 'bar', 'throttle', { label: 'THR', suffix: '%', segments: 24, accentColor: GREEN }, ['throttle', 'segments', 'bar', 'dense']),

  // ── VALUE BARS — big value with a hairline progress bar (bounded 0..1) ───────
  nx('x3-vbar-throttle', 'Value bar · Throttle', 'valuebar', 200, 104, 'Inputs', 'bar', 'throttle', { label: 'THROTTLE', suffix: '%', accentColor: GREEN }, ['throttle', 'valuebar', 'input']),
  nx('x3-vbar-brake', 'Value bar · Brake', 'valuebar', 200, 104, 'Inputs', 'bar', 'brake', { label: 'BRAKE', suffix: '%', accentColor: RED }, ['brake', 'valuebar', 'input']),
  nx('x3-vbar-rpm', 'Value bar · RPM %', 'valuebar', 220, 104, 'Speed/Engine', 'bar', 'rpmPct', { label: 'RPM', suffix: '%', warnAt: 0.8, dangerAt: 0.9, accentColor: AMBER }, ['rpm', 'valuebar']),
  nx('x3-vbar-fuel', 'Value bar · Fuel %', 'valuebar', 200, 104, 'Fuel', 'bar', 'fuelPct', { label: 'FUEL', suffix: '%', accentColor: GREEN }, ['fuel', 'valuebar']),
  nx('x3-vbar-grip', 'Value bar · Grip', 'valuebar', 200, 100, 'Track/Radar', 'bar', 'gripPct', { label: 'GRIP', suffix: '%', accentColor: CYAN }, ['grip', 'valuebar', 'track']),
  nx('x3-vbar-wet', 'Value bar · Wetness', 'valuebar', 200, 100, 'Track/Radar', 'bar', 'trackWetnessPct', { label: 'WET', suffix: '%', warnAt: 0.4, dangerAt: 0.7, accentColor: CYAN }, ['wet', 'rain', 'valuebar']),
  nx('x3-vbar-lapdist', 'Value bar · Lap %', 'valuebar', 220, 100, 'Track/Radar', 'bar', 'lapDistPct', { label: 'LAP', suffix: '%', accentColor: GOLD }, ['lap', 'progress', 'valuebar']),
  nx('x3-vbar-shift', 'Value bar · Shift', 'valuebar', 220, 104, 'Speed/Engine', 'bar', 'shiftPct', { label: 'SHIFT', suffix: '%', warnAt: 0.7, dangerAt: 0.9, accentColor: ORANGE }, ['shift', 'valuebar', 'rpm']),

  // ── VALUE GAUGES — value inside a minimal 270° arc (bounded 0..1) ────────────
  nx('x3-vgauge-rpm', 'Value gauge · RPM %', 'valuegauge', 150, 150, 'Speed/Engine', 'gauge', 'rpmPct', { label: 'RPM %', suffix: '%', warnAt: 0.55, dangerAt: 0.8, accentColor: AMBER }, ['rpm', 'valuegauge', 'arc']),
  nx('x3-vgauge-fuel', 'Value gauge · Fuel %', 'valuegauge', 150, 150, 'Fuel', 'gauge', 'fuelPct', { label: 'FUEL', suffix: '%', accentColor: GREEN }, ['fuel', 'valuegauge', 'arc']),
  nx('x3-vgauge-throttle', 'Value gauge · Throttle', 'valuegauge', 140, 140, 'Inputs', 'gauge', 'throttle', { label: 'THR', suffix: '%', accentColor: GREEN }, ['throttle', 'valuegauge', 'arc']),

  // ── GENERIC BARS — horizontal fill with warn/danger ramp ─────────────────────
  nx('x3-bar-throttle', 'Bar · Throttle', 'bar', 240, 24, 'Inputs', 'bar', 'throttle', { background: '#0a0c10', radius: 8, fillColor: GREEN, warnColor: AMBER, dangerColor: RED, warnAt: 0.7, dangerAt: 0.9 }, ['throttle', 'bar', 'input']),
  nx('x3-bar-brake', 'Bar · Brake', 'bar', 240, 24, 'Inputs', 'bar', 'brake', { background: '#0a0c10', radius: 8, fillColor: RED, warnColor: ORANGE, dangerColor: RED, warnAt: 0.6, dangerAt: 0.85 }, ['brake', 'bar', 'input']),
  nx('x3-bar-rpm', 'Bar · RPM %', 'bar', 260, 26, 'Speed/Engine', 'bar', 'rpmPct', { background: '#0a0c10', radius: 6, fillColor: AMBER, warnColor: ORANGE, dangerColor: RED, warnAt: 0.7, dangerAt: 0.9 }, ['rpm', 'bar']),
  nx('x3-bar-fuel', 'Bar · Fuel %', 'bar', 240, 22, 'Fuel', 'bar', 'fuelPct', { background: '#0a0c10', radius: 8, fillColor: GOLD, warnColor: AMBER, dangerColor: RED, warnAt: 0.3, dangerAt: 0.12 }, ['fuel', 'bar']),
  nx('x3-bar-lapdist', 'Bar · Lap %', 'bar', 300, 20, 'Track/Radar', 'bar', 'lapDistPct', { background: '#0a0c10', radius: 10, fillColor: CYAN }, ['lap', 'progress', 'bar']),

  // ── VERTICAL BARS — bottom-up fill (with reverse variant) ────────────────────
  nx('x3-barv-throttle', 'Vertical bar · Throttle', 'barv', 40, 200, 'Inputs', 'bar', 'throttle', { background: '#0a0c10', radius: 6, fillColor: GREEN }, ['throttle', 'barv', 'vertical', 'input']),
  nx('x3-barv-brake', 'Vertical bar · Brake', 'barv', 40, 200, 'Inputs', 'bar', 'brake', { background: '#0a0c10', radius: 6, fillColor: RED }, ['brake', 'barv', 'vertical', 'input']),
  nx('x3-barv-rpm', 'Vertical bar · RPM %', 'barv', 48, 220, 'Speed/Engine', 'bar', 'rpmPct', { background: '#0a0c10', radius: 6, fillColor: AMBER, warnColor: ORANGE, dangerColor: RED, warnAt: 0.7, dangerAt: 0.9 }, ['rpm', 'barv', 'vertical']),
  nx('x3-barv-fuel', 'Vertical bar · Fuel % (reverse)', 'barv', 44, 200, 'Fuel', 'bar', 'fuelPct', { background: '#0a0c10', radius: 6, fillColor: GOLD, reverse: true }, ['fuel', 'barv', 'vertical', 'reverse']),

  // ── DUAL BARS — throttle + brake (primary + secondary channel) ───────────────
  nx('x3-dualbar-tb', 'Dual bar · Throttle/Brake', 'dualbar', 160, 120, 'Inputs', 'bar', 'throttle', { radius: 8, fillColor: GREEN, secondaryBinding: 'brake', secondaryColor: RED }, ['throttle', 'brake', 'dualbar', 'input']),
  nx('x3-dualbar-tb-wide', 'Dual bar · Throttle/Brake wide', 'dualbar', 220, 90, 'Inputs', 'bar', 'throttle', { radius: 6, fillColor: CYAN, secondaryBinding: 'brake', secondaryColor: AMBER }, ['throttle', 'brake', 'dualbar', 'wide']),

  // ── DELTA BARS — ± pointer around session best ───────────────────────────────
  nx('x3-deltabar-1s', 'Delta bar · ±1.0s', 'deltabar', 320, 28, 'Timing/Delta', 'bar', 'deltaToSessionBestSec', { background: '#000000', radius: 999, fillColor: GREEN, dangerColor: RED, deltaRangeSec: 1 }, ['delta', 'deltabar', 'timing']),
  nx('x3-deltabar-08s', 'Delta bar · ±0.8s', 'deltabar', 280, 26, 'Timing/Delta', 'bar', 'deltaToSessionBestSec', { background: '#000000', radius: 999, fillColor: AMBER, dangerColor: RED, deltaRangeSec: 0.8 }, ['delta', 'deltabar', 'attack']),
  nx('x3-deltabar-2s', 'Delta bar · ±2.0s', 'deltabar', 360, 30, 'Timing/Delta', 'bar', 'deltaToSessionBestSec', { background: '#000000', radius: 999, fillColor: CYAN, dangerColor: RED, deltaRangeSec: 2 }, ['delta', 'deltabar', 'wide']),

  // ── SHIFT BARS — segmented RPM/shift with flash + glow ───────────────────────
  nx('x3-shiftbar-rpm-15', 'Shift bar · RPM 15 LED', 'shiftbar', 600, 48, 'Speed/Engine', 'led', 'rpmPct', { segments: 15, flashAt: 0.97, glow: true, segmentShape: 'led', radius: 8 }, ['rpm', 'shiftbar', 'led']),
  nx('x3-shiftbar-rpm-20', 'Shift bar · RPM 20 bar', 'shiftbar', 720, 44, 'Speed/Engine', 'led', 'rpmPct', { segments: 20, flashAt: 0.98, glow: true, segmentShape: 'bar', radius: 6 }, ['rpm', 'shiftbar', 'wide']),
  nx('x3-shiftbar-shift-18', 'Shift bar · Shift 18 LED', 'shiftbar', 760, 44, 'Speed/Engine', 'led', 'shiftPct', { segments: 18, flashAt: 0.98, glow: true, segmentShape: 'led', radius: 8 }, ['shift', 'shiftbar', 'led']),
  nx('x3-shiftbar-shift-24', 'Shift bar · Shift 24 trapezoid', 'shiftbar', 900, 40, 'Speed/Engine', 'led', 'shiftPct', { segments: 24, flashAt: 0.98, glow: true, segmentShape: 'trapezoid', radius: 6 }, ['shift', 'shiftbar', 'dense']),

  // ── SHIFT LIGHTS — legacy LED strip with green/amber/red zones ───────────────
  nx('x3-shiftlights-rpm-12', 'Shift lights · RPM 12', 'shiftlights', 600, 48, 'Speed/Engine', 'led', 'rpmPct', { background: '#0a0c10', radius: 10, segments: 12, fillColor: GREEN, warnColor: AMBER, dangerColor: RED, warnAt: 0.6, dangerAt: 0.85 }, ['rpm', 'shiftlights', 'led']),
  nx('x3-shiftlights-shift-15', 'Shift lights · Shift 15', 'shiftlights', 640, 44, 'Speed/Engine', 'led', 'shiftPct', { background: '#0a0c10', radius: 10, segments: 15, fillColor: GREEN, warnColor: AMBER, dangerColor: RED, warnAt: 0.65, dangerAt: 0.9 }, ['shift', 'shiftlights', 'led']),

  // ── LED BARS — generic segmented LED, horizontal & vertical ──────────────────
  nx('x3-led-rpm-h', 'LED bar · RPM (h)', 'ledbar', 360, 56, 'Speed/Engine', 'led', 'rpmPct', { label: 'RPM', segments: 18, warnAt: 0.6, dangerAt: 0.85, flashAt: 0.97, accentColor: GREEN, orientation: 'h' }, ['rpm', 'led', 'horizontal']),
  nx('x3-led-throttle-v', 'LED column · Throttle (v)', 'ledbar', 80, 200, 'Inputs', 'led', 'throttle', { label: 'THR', segments: 14, accentColor: GREEN, orientation: 'v' }, ['throttle', 'led', 'vertical', 'input']),
  nx('x3-led-brake-v', 'LED column · Brake (v)', 'ledbar', 80, 200, 'Inputs', 'led', 'brake', { label: 'BRK', segments: 14, accentColor: RED, orientation: 'v' }, ['brake', 'led', 'vertical', 'input']),
  nx('x3-led-fuel-h', 'LED bar · Fuel (h)', 'ledbar', 300, 50, 'Fuel', 'led', 'fuelPct', { label: 'FUEL', segments: 16, accentColor: GOLD, orientation: 'h' }, ['fuel', 'led', 'horizontal']),
  nx('x3-led-shift-h', 'LED bar · Shift (h)', 'ledbar', 380, 54, 'Speed/Engine', 'led', 'shiftPct', { label: 'SHIFT', segments: 20, warnAt: 0.7, dangerAt: 0.9, accentColor: ORANGE, orientation: 'h' }, ['shift', 'led', 'horizontal']),

  // ── INPUT BARS — vertical throttle/brake/clutch pedal columns ────────────────
  nx('x3-inputbars-tbc', 'Input bars · Thr/Brk/Clutch', 'inputbars', 180, 160, 'Inputs', 'bar', undefined, { radius: 12, channels: ['throttle', 'brake', 'clutch'] }, ['throttle', 'brake', 'clutch', 'inputbars', 'pedals']),
  nx('x3-inputbars-tb', 'Input bars · Thr/Brk', 'inputbars', 140, 150, 'Inputs', 'bar', undefined, { radius: 10, channels: ['throttle', 'brake'] }, ['throttle', 'brake', 'inputbars', 'pedals']),

  // ── INPUT TRACES — rolling multi-channel pedal trace ─────────────────────────
  nx('x3-inputtrace-tbc', 'Input trace · Thr/Brk/Clutch', 'inputtrace', 340, 140, 'Inputs', 'graph', undefined, { radius: 10, channels: ['throttle', 'brake', 'clutch'], traceLength: 180, traceWidth: 1.8 }, ['throttle', 'brake', 'clutch', 'inputtrace', 'trace']),
  nx('x3-inputtrace-tb', 'Input trace · Thr/Brk', 'inputtrace', 320, 130, 'Inputs', 'graph', undefined, { radius: 10, channels: ['throttle', 'brake'], traceLength: 160, traceWidth: 1.6 }, ['throttle', 'brake', 'inputtrace', 'trace'])
]
