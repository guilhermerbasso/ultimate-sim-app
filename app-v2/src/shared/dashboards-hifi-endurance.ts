// ─── Hi-fi ENDURANCE composition dashboards ───────────────────────────────────
// Stint / fuel-strategy / tyre-life / traffic / multiclass / night scenarios,
// composed from the hi-fi per-telemetry widgets. Self-contained (kit imports only
// TYPES from ./dashboards). Spread into BUILTIN_PRESETS.
//
// Add presets by pushing `comp(id, name, description, tags, build)` onto
// HIFI_ENDURANCE_PRESETS. Valid widget ids come from `HIFI_WIDGETS_BY_ID`.
import { bg, comp, dashboard, hifiEl, type HifiCompPreset } from './dashboards-hifi-kit'

export const HIFI_ENDURANCE_PRESETS: HifiCompPreset[] = [
  comp(
    'hifi_endur_stint_core',
    'Endurance — Stint Core',
    'Endurance stint core: time and laps remaining, fuel state, laps-to-empty, tyre wear, race position and the immediate relative traffic list.',
    ['endurance', 'stint', 'fuel', 'fuel-laps', 'tyre-wear', 'position', 'relative', 'race'],
    () =>
      dashboard('Endurance — Stint Core', 'Endurance stint core cluster.', [
        bg(),
        hifiEl('timeRemaining', 16, 24, 232, 172),
        hifiEl('lapsRemaining', 16, 214, 232, 172),
        hifiEl('position', 16, 404, 232, 172),
        hifiEl('fuel', 260, 24, 370, 260),
        hifiEl('fuelLaps', 260, 304, 370, 260),
        hifiEl('tyreWear', 642, 24, 370, 276),
        hifiEl('relative', 642, 320, 370, 206)
      ])
  ),
  comp(
    'hifi_endur_double_stint',
    'Endurance — Double Stint',
    'Double-stint planning page with time, laps, fuel reserve, laps-to-empty, tyre wear and track position in six large balanced tiles.',
    ['endurance', 'double-stint', 'strategy', 'fuel', 'fuel-laps', 'tyre-wear', 'position'],
    () =>
      dashboard('Endurance — Double Stint', 'Double-stint endurance strategy page.', [
        bg(),
        hifiEl('timeRemaining', 16, 24, 232, 172),
        hifiEl('lapsRemaining', 16, 214, 232, 172),
        hifiEl('position', 16, 404, 232, 172),
        hifiEl('fuel', 260, 24, 370, 260),
        hifiEl('fuelLaps', 260, 304, 370, 260),
        hifiEl('tyreWear', 642, 24, 370, 276)
      ])
  ),
  comp(
    'hifi_endur_fuel_strategy',
    'Endurance — Fuel Strategy',
    'Fuel strategy page for endurance calls: fuel quantity, laps-to-empty, consumption per lap, fuel delta, time remaining and laps remaining.',
    ['endurance', 'fuel', 'fuel-strategy', 'fuel-delta', 'consumption', 'time-remaining', 'laps-remaining'],
    () =>
      dashboard('Endurance — Fuel Strategy', 'Fuel strategy endurance page.', [
        bg(),
        hifiEl('timeRemaining', 16, 24, 232, 172),
        hifiEl('lapsRemaining', 16, 214, 232, 172),
        hifiEl('fuel', 260, 24, 370, 260),
        hifiEl('fuelLaps', 642, 24, 370, 260),
        hifiEl('fuelPerLap', 260, 304, 370, 260),
        hifiEl('fuelDelta', 642, 304, 370, 260)
      ])
  ),
  comp(
    'hifi_endur_tyre_life',
    'Endurance — Tyre Life',
    'Tyre-life engineer page with detailed tyre state, temperature grid, wear grid, pressure grid and fuel laps for stint extension decisions.',
    ['endurance', 'tyres', 'tyre-life', 'tyre-temp', 'tyre-wear', 'tyre-pressure', 'tyre-detail', 'fuel-laps'],
    () =>
      dashboard('Endurance — Tyre Life', 'Tyre-life endurance engineering page.', [
        bg(),
        hifiEl('tyreDetail', 8, 16, 626, 260),
        hifiEl('fuelLaps', 646, 16, 370, 260),
        hifiEl('tyreTemp', 8, 304, 324, 276),
        hifiEl('tyreWear', 350, 304, 324, 276),
        hifiEl('tyrePressure', 692, 304, 324, 276)
      ])
  ),
  comp(
    'hifi_endur_traffic_multiclass',
    'Endurance — Traffic Multiclass',
    'Multiclass traffic page with standings, relative list, class position, direct gaps and radar for approaching mixed-class packs.',
    ['endurance', 'traffic', 'multiclass', 'standings', 'relative', 'class-position', 'gaps', 'radar'],
    () =>
      dashboard('Endurance — Traffic Multiclass', 'Multiclass traffic endurance page.', [
        bg(),
        hifiEl('standings', 24, 24, 360, 300),
        hifiEl('relative', 24, 348, 360, 220),
        hifiEl('radar', 408, 24, 260, 260),
        hifiEl('classPosition', 692, 24, 308, 172),
        hifiEl('gapAhead', 408, 308, 276, 196),
        hifiEl('gapBehind', 708, 308, 276, 196)
      ])
  ),
  comp(
    'hifi_endur_night_stint',
    'Endurance — Night Stint',
    'Night-stint cockpit page with shift lights, gear, speed, tyre temperature, water temperature, oil temperature and fuel laps.',
    ['endurance', 'night', 'stint', 'revlights', 'gear', 'speed', 'tyre-temp', 'engine-temps', 'fuel-laps'],
    () =>
      dashboard('Endurance — Night Stint', 'Night stint endurance cockpit page.', [
        bg(),
        hifiEl('revlights', 24, 16, 976, 52),
        hifiEl('gear', 16, 80, 200, 230),
        hifiEl('speed', 236, 80, 300, 230),
        hifiEl('fuelLaps', 556, 80, 420, 230),
        hifiEl('tyreTemp', 16, 322, 330, 260),
        hifiEl('waterTemp', 366, 322, 300, 260),
        hifiEl('oilTemp', 686, 322, 300, 260)
      ])
  ),
  comp(
    'hifi_endur_driver_swap',
    'Endurance — Driver Swap',
    'Driver-swap control page with remaining time, remaining laps, fuel, position, tyre wear and session state in a calm two-row grid.',
    ['endurance', 'driver-swap', 'stint', 'session', 'fuel', 'position', 'tyre-wear', 'time-remaining'],
    () =>
      dashboard('Endurance — Driver Swap', 'Driver swap endurance control page.', [
        bg(),
        hifiEl('timeRemaining', 16, 24, 232, 172),
        hifiEl('lapsRemaining', 16, 214, 232, 172),
        hifiEl('position', 16, 404, 232, 172),
        hifiEl('fuel', 260, 24, 370, 260),
        hifiEl('tyreWear', 642, 24, 370, 276),
        hifiEl('session', 260, 304, 264, 260)
      ])
  ),
  comp(
    'hifi_endur_pit_window',
    'Endurance — Pit Window',
    'Pit-window page for endurance race calls: fuel, fuel laps, pit limiter, tyre wear, time remaining and current position.',
    ['endurance', 'pit-window', 'pit-limiter', 'fuel', 'fuel-laps', 'tyre-wear', 'time-remaining', 'position'],
    () =>
      dashboard('Endurance — Pit Window', 'Pit window endurance strategy page.', [
        bg(),
        hifiEl('fuel', 150, 24, 420, 260),
        hifiEl('fuelLaps', 590, 24, 420, 260),
        hifiEl('timeRemaining', 16, 304, 232, 130),
        hifiEl('position', 16, 446, 232, 130),
        hifiEl('pitLimiter', 260, 304, 264, 252),
        hifiEl('tyreWear', 544, 304, 420, 276)
      ])
  ),
  comp(
    'hifi_endur_energy_hybrid',
    'Endurance — Energy Hybrid',
    'Hybrid energy page with ERS, engine map, TC, ABS, best delta and speed for long-run energy and drivability management.',
    ['endurance', 'hybrid', 'energy', 'ers', 'engine-map', 'tc', 'abs', 'delta', 'speed'],
    () =>
      dashboard('Endurance — Energy Hybrid', 'Hybrid energy endurance page.', [
        bg(),
        hifiEl('deltaBest', 16, 24, 300, 172),
        hifiEl('speed', 16, 214, 300, 172),
        hifiEl('ers', 336, 24, 332, 260),
        hifiEl('engineMap', 680, 24, 332, 260),
        hifiEl('tc', 336, 304, 332, 260),
        hifiEl('abs', 680, 304, 332, 260)
      ])
  ),
  comp(
    'hifi_endur_temps_watch',
    'Endurance — Temps Watch',
    'Temperature watch page with water temperature, oil temperature, oil pressure, brake temperature and tyre temperature for reliability management.',
    ['endurance', 'temperatures', 'engine', 'water-temp', 'oil-temp', 'oil-pressure', 'brake-temp', 'tyre-temp', 'reliability'],
    () =>
      dashboard('Endurance — Temps Watch', 'Endurance temperature watch page.', [
        bg(),
        hifiEl('waterTemp', 16, 24, 320, 260),
        hifiEl('oilTemp', 352, 24, 320, 260),
        hifiEl('oilPressure', 688, 24, 320, 260),
        hifiEl('brakeTemp', 16, 300, 420, 260),
        hifiEl('tyreTemp', 456, 300, 420, 260)
      ])
  ),
  comp(
    'hifi_endur_endurance_broadcast',
    'Endurance — Broadcast',
    'Broadcast-style endurance page with standings, overall and class position, gap ahead, best lap and a large race clock.',
    ['endurance', 'broadcast', 'standings', 'position', 'class-position', 'gap-ahead', 'lap-best', 'clock'],
    () =>
      dashboard('Endurance — Broadcast', 'Endurance broadcast composition page.', [
        bg(),
        hifiEl('standings', 24, 24, 380, 300),
        hifiEl('position', 428, 24, 276, 172),
        hifiEl('classPosition', 728, 24, 272, 172),
        hifiEl('gapAhead', 428, 220, 276, 172),
        hifiEl('lapBest', 728, 220, 272, 172),
        hifiEl('clock', 428, 416, 572, 160)
      ])
  ),
  comp(
    'hifi_endur_relative_traffic',
    'Endurance — Relative Traffic',
    'Relative traffic page with a wide relative list, radar, gap ahead, gap behind and position for clean multiclass racecraft.',
    ['endurance', 'relative', 'traffic', 'radar', 'gap-ahead', 'gap-behind', 'position', 'multiclass'],
    () =>
      dashboard('Endurance — Relative Traffic', 'Endurance relative traffic page.', [
        bg(),
        hifiEl('relative', 24, 24, 360, 236),
        hifiEl('position', 24, 284, 360, 172),
        hifiEl('radar', 408, 24, 260, 260),
        hifiEl('gapAhead', 692, 24, 308, 200),
        hifiEl('gapBehind', 692, 248, 308, 200)
      ])
  ),
  comp(
    'hifi_endur_stint_minimal',
    'Endurance — Stint Minimal',
    'Minimal endurance stint page with four large tiles: time remaining, fuel laps, position and tyre wear, leaving deliberate black negative space.',
    ['endurance', 'minimal', 'stint', 'time-remaining', 'fuel-laps', 'position', 'tyre-wear', 'clean'],
    () =>
      dashboard('Endurance — Stint Minimal', 'Minimal endurance stint page.', [
        bg(),
        hifiEl('timeRemaining', 24, 40, 448, 210),
        hifiEl('fuelLaps', 552, 24, 420, 260),
        hifiEl('position', 24, 330, 448, 210),
        hifiEl('tyreWear', 552, 304, 420, 276)
      ])
  )
]
