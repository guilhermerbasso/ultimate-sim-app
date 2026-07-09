// ─── Hi-fi DIAGNOSTICS / DYNAMICS composition dashboards ──────────────────────
// 1024×600 dashboards composed from the hi-fi per-telemetry widgets, showcasing
// the derived/combined channels (irDerived) alongside vitals so EVERY surfaced
// iRacing channel has a home on a full dashboard. Self-contained: imports only the
// composition kit (which imports only TYPES from ./dashboards). Spread into
// BUILTIN_PRESETS.
import { bg, comp, dashboard, hifiEl, revTop, type HifiCompPreset } from './dashboards-hifi-kit'

// Uniform 3×2 grid of 328×230 boxes below the edge-to-edge rev strip. Every box is
// ≥ 75% of the 420×240 widget default (so widgets never render below spec) and the
// columns/rows never overlap.
const A = { x: 12, y: 108, w: 328, h: 230 }
const B = { x: 348, y: 108, w: 328, h: 230 }
const C = { x: 684, y: 108, w: 328, h: 230 }
const D = { x: 12, y: 356, w: 328, h: 230 }
const E = { x: 348, y: 356, w: 328, h: 230 }
const F = { x: 684, y: 356, w: 328, h: 230 }

function slot(moduleId: string, s: { x: number; y: number; w: number; h: number }) {
  return hifiEl(moduleId, s.x, s.y, s.w, s.h)
}

export const HIFI_DIAG_PRESETS: HifiCompPreset[] = [
  comp(
    'hifi_diag_chassis_dynamics',
    'Chassis Dynamics',
    'Car-dynamics page: slip angle and body rotation rates, attitude horizon, steering lock, shift point and spotter.',
    ['chassis', 'dynamics', 'slip', 'attitude', 'rotation', 'steering', 'derived', 'diagnostics'],
    () =>
      dashboard('Chassis Dynamics', 'Slip, rotation, attitude and steering dynamics.', [
        bg(),
        revTop('revlightsLedStrip'),
        slot('slipAngle', A),
        slot('rotationRates', B),
        slot('carAttitude', C),
        slot('steeringLock', D),
        slot('shiftPoint', E),
        slot('spotterRaw', F)
      ])
  ),
  comp(
    'hifi_diag_engineer',
    'Engineer Diagnostics',
    'Engineer page: engine telltale, shift point, decoded race-control flags, session id, GPS heading and brake pressures.',
    ['engineer', 'diagnostics', 'engine', 'flags', 'shift', 'gps', 'brake', 'derived'],
    () =>
      dashboard('Engineer Diagnostics', 'Engine, flags and diagnostics.', [
        bg(),
        revTop('revlightsGradient'),
        slot('engineTelltale', A),
        slot('shiftPoint', B),
        slot('raceControlFlags', C),
        slot('sessionTag', D),
        slot('gpsHeading', E),
        slot('brakeLinePress', F)
      ])
  ),
  comp(
    'hifi_diag_endurance_strategy',
    'Endurance Strategy',
    'Stint strategy page: fuel laps-left, fuel level and burn rate, brake-line pressures, sun position and sky state.',
    ['endurance', 'strategy', 'fuel', 'laps-left', 'brake', 'weather', 'sun', 'derived'],
    () =>
      dashboard('Endurance Strategy', 'Fuel range, brakes and daylight window.', [
        bg(),
        revTop('revlightsLedBar'),
        slot('fuelLapsLeft', A),
        slot('fuelLevelPct', B),
        slot('fuelRate', C),
        slot('brakeLinePress', D),
        slot('sunPosition', E),
        slot('skies', F)
      ])
  ),
  comp(
    'hifi_diag_environment',
    'Environment & Race Control',
    'Track-state page: sun position, sky state, decoded race-control flags, GPS heading, session id and spotter.',
    ['environment', 'weather', 'flags', 'race-control', 'sun', 'gps', 'session', 'derived'],
    () =>
      dashboard('Environment & Race Control', 'Weather, flags and track state.', [
        bg(),
        revTop('revlightsLedStrip'),
        slot('sunPosition', A),
        slot('skies', B),
        slot('raceControlFlags', C),
        slot('gpsHeading', D),
        slot('sessionTag', E),
        slot('carsAlongside', F)
      ])
  ),
  comp(
    'hifi_diag_navigation',
    'Navigation & Spotter',
    'Spatial page: GPS heading compass, attitude horizon, slip angle, raw spotter proximity, cars alongside and steering lock.',
    ['navigation', 'gps', 'heading', 'attitude', 'slip', 'spotter', 'derived'],
    () =>
      dashboard('Navigation & Spotter', 'GPS heading, attitude and proximity.', [
        bg(),
        revTop('revlightsGradient'),
        slot('gpsHeading', A),
        slot('carAttitude', B),
        slot('slipAngle', C),
        slot('spotterRaw', D),
        slot('carsAlongside', E),
        slot('steeringLock', F)
      ])
  )
]
