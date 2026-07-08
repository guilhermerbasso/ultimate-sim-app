// ─── Hi-fi RACE composition dashboards ────────────────────────────────────────
// Race-scenario 1024×600 dashboards composed from the hi-fi per-telemetry widgets.
// Self-contained: imports only the composition kit (which imports only TYPES from
// ./dashboards). Spread into BUILTIN_PRESETS.
import { bg, comp, dashboard, hifiEl, revTop, type HifiCompPreset } from './dashboards-hifi-kit'

export const HIFI_RACE_PRESETS: HifiCompPreset[] = [
  comp(
    'hifi_race_sprint_core',
    'Sprint Race Core',
    'Sprint-race core with hero gear and speed, clean position, fuel range, tyre temperature and attack gaps.',
    ['gt3', 'sprint', 'race', 'core', 'revlights', 'delta', 'gap', 'tyre-temp', 'fuel', 'position', 'clean'],
    () =>
      dashboard('Sprint Race Core', 'Sprint race core cluster.', [
        bg(),
        revTop('revlightsLedStrip'),
        hifiEl('speedGear', 24, 112, 420, 240),
        hifiEl('position', 464, 112, 220, 184),
        hifiEl('fuelLaps', 704, 112, 320, 240),
        hifiEl('tyreTemp', 24, 360, 420, 220),
        hifiEl('gapAhead', 464, 372, 232, 172),
        hifiEl('deltaBest', 716, 372, 276, 184)
      ])
  ),
  comp(
    'hifi_race_qualifying_hotlap',
    'Qualifying Hotlap',
    'Qualifying focus with best and session deltas, current and best lap timing, tyre temperature balance and pedal traces.',
    ['gt3', 'qualifying', 'hotlap', 'revlights', 'delta', 'session-best', 'lap-time', 'tyre-temp', 'inputs', 'pedals'],
    () =>
      dashboard('Qualifying Hotlap', 'Qualifying delta and tyre window.', [
        bg(),
        revTop('revlightsGradient'),
        hifiEl('deltaBest', 24, 112, 276, 184),
        hifiEl('deltaSession', 316, 112, 276, 184),
        hifiEl('lapCurrent', 608, 112, 256, 184),
        hifiEl('lapBest', 24, 332, 256, 184),
        hifiEl('tyreTemp', 300, 332, 420, 240),
        hifiEl('inputsCombo', 740, 332, 284, 220)
      ])
  ),
  comp(
    'hifi_race_wet_race',
    'Wet Race Control',
    'Wet-race control page for weather, surface wetness, tyre temperature, position, remaining time and rain-safe pace.',
    ['gt3', 'wet', 'rain', 'race-control', 'revlights', 'weather', 'wetness', 'position', 'time', 'tyre-temp'],
    () =>
      dashboard('Wet Race Control', 'Wet race environment and risk page.', [
        bg(),
        revTop('revlightsLedStrip'),
        hifiEl('weather', 16, 112, 264, 260),
        hifiEl('wetness', 292, 112, 264, 260),
        hifiEl('tyreTemp', 584, 112, 420, 260),
        hifiEl('position', 24, 396, 292, 172),
        hifiEl('timeRemaining', 340, 396, 256, 172),
        hifiEl('deltaBest', 620, 396, 276, 184)
      ])
  ),
  comp(
    'hifi_race_fuel_save',
    'Fuel Save Stint',
    'Fuel-save stint page with fuel level, laps remaining, burn rate, fuel delta and best-lap delta.',
    ['gt3', 'fuel-save', 'stint', 'revlights', 'fuel', 'fuel-laps', 'fuel-delta', 'delta', 'endurance'],
    () =>
      dashboard('Fuel Save Stint', 'Fuel economy and pace trade-off.', [
        bg(),
        revTop('revlightsLedBar'),
        hifiEl('fuel', 16, 112, 330, 260),
        hifiEl('fuelLaps', 362, 112, 330, 260),
        hifiEl('deltaBest', 724, 112, 276, 184),
        hifiEl('fuelDelta', 16, 376, 420, 216),
        hifiEl('fuelPerLap', 452, 376, 420, 216)
      ])
  ),
  comp(
    'hifi_race_tyre_management',
    'Tyre Management',
    'Tyre-management page with temperatures, pressures, detailed corner data and fuel laps for stint range.',
    ['gt3', 'tyre-management', 'tyres', 'revlights', 'tyre-temp', 'tyre-pressure', 'tyre-detail', 'stint', 'fuel-laps'],
    () =>
      dashboard('Tyre Management', 'Tyre condition and stint-range dashboard.', [
        bg(),
        revTop('revlightsGradient'),
        hifiEl('tyreTemp', 16, 112, 420, 220),
        hifiEl('tyrePressure', 456, 112, 420, 220),
        hifiEl('tyreDetail', 16, 356, 680, 220),
        hifiEl('fuelLaps', 704, 356, 320, 220)
      ])
  ),
  comp(
    'hifi_race_attack_delta',
    'Attack Delta',
    'Attack page for closing the car ahead with speed, gap-ahead, delta-ahead trend, relative list and best delta.',
    ['gt3', 'attack', 'overtake', 'revlights', 'delta-ahead', 'gap-ahead', 'relative', 'delta', 'speed'],
    () =>
      dashboard('Attack Delta', 'Car-ahead pressure and pace view.', [
        bg(),
        revTop('revlightsLedStrip'),
        hifiEl('speedGear', 24, 112, 420, 240),
        hifiEl('gapAhead', 464, 112, 232, 172),
        hifiEl('deltaAhead', 716, 112, 276, 172),
        hifiEl('relative', 24, 372, 338, 206),
        hifiEl('deltaBest', 382, 372, 276, 184),
        hifiEl('position', 680, 372, 292, 172)
      ])
  ),
  comp(
    'hifi_race_defend_gaps',
    'Defend Gaps',
    'Defensive race page with rear gap, delta behind, relative list, proximity radar and position.',
    ['gt3', 'defend', 'traffic', 'revlights', 'gap-behind', 'delta-behind', 'relative', 'radar', 'position'],
    () =>
      dashboard('Defend Gaps', 'Rear-pressure and proximity dashboard.', [
        bg(),
        revTop('revlightsLedBar'),
        hifiEl('speed', 24, 112, 420, 240),
        hifiEl('gapBehind', 464, 112, 232, 172),
        hifiEl('deltaBehind', 716, 112, 276, 172),
        hifiEl('relative', 24, 372, 338, 206),
        hifiEl('radar', 464, 342, 258, 258),
        hifiEl('position', 732, 384, 292, 172)
      ])
  ),
  comp(
    'hifi_race_final_laps',
    'Final Laps Push',
    'Final-laps push page with position, front and rear gaps, fuel laps, laps remaining and best-lap delta.',
    ['gt3', 'final-laps', 'push', 'revlights', 'position', 'gap', 'fuel-laps', 'laps-remaining', 'delta'],
    () =>
      dashboard('Final Laps Push', 'Late-race gaps and range page.', [
        bg(),
        revTop('revlightsGradient'),
        hifiEl('position', 24, 112, 292, 172),
        hifiEl('lapsRemaining', 340, 112, 232, 172),
        hifiEl('fuelLaps', 604, 112, 420, 260),
        hifiEl('gapAhead', 24, 392, 232, 172),
        hifiEl('gapBehind', 276, 392, 232, 172),
        hifiEl('deltaBest', 528, 392, 276, 184),
        hifiEl('timeRemaining', 824, 392, 200, 172)
      ])
  ),
  comp(
    'hifi_race_restart_sprint',
    'Restart Sprint',
    'Restart sprint page with hero gear and speed, pressure gaps, brake-throttle trace, position and flag awareness.',
    ['gt3', 'restart', 'sprint', 'revlights', 'gear', 'speed', 'gap', 'delta', 'attack', 'inputs'],
    () =>
      dashboard('Restart Sprint', 'Green-flag restart focus.', [
        bg(),
        revTop('revlightsLedBar'),
        hifiEl('speedGear', 24, 112, 420, 260),
        hifiEl('gapAhead', 464, 112, 232, 172),
        hifiEl('deltaAhead', 716, 112, 276, 172),
        hifiEl('inputsBrakeThrottle', 24, 392, 320, 190),
        hifiEl('position', 384, 392, 292, 172),
        hifiEl('alertFlag', 724, 360, 300, 220)
      ])
  ),
  comp(
    'hifi_race_safety_car',
    'Safety Car Queue',
    'Safety-car queue page with flag state, pit limiter, position, race gaps, remaining time and fuel status.',
    ['gt3', 'safety-car', 'caution', 'revlights', 'flag', 'pit-limiter', 'position', 'gap', 'time', 'fuel'],
    () =>
      dashboard('Safety Car Queue', 'Caution-period control dashboard.', [
        bg(),
        revTop('revlightsGradient'),
        hifiEl('flag', 16, 112, 264, 260),
        hifiEl('pitLimiter', 296, 112, 264, 260),
        hifiEl('fuel', 584, 112, 420, 260),
        hifiEl('position', 24, 392, 292, 172),
        hifiEl('timeRemaining', 340, 392, 256, 172),
        hifiEl('gapAhead', 620, 392, 232, 172)
      ])
  ),
  comp(
    'hifi_race_ferrari',
    'Ferrari GT3 Race',
    'Ferrari-themed GT3 race page with signature cluster, Ferrari rev lights, best delta, gap ahead and class position.',
    ['ferrari', 'gt3', 'themed', 'race', 'revlights', 'cluster', 'delta', 'gap'],
    () =>
      dashboard('Ferrari GT3 Race', 'Ferrari-themed race cluster.', [
        bg(),
        revTop('revThemedFerrari'),
        hifiEl('clusterFerrari', 24, 112, 460, 300),
        hifiEl('deltaBest', 508, 112, 256, 184),
        hifiEl('gapAhead', 788, 112, 232, 172),
        hifiEl('position', 508, 332, 292, 172),
        hifiEl('lapLast', 24, 428, 256, 172)
      ])
  ),
  comp(
    'hifi_race_porsche',
    'Porsche GT3 Race',
    'Porsche-themed GT3 race page with signature cluster, Porsche rev lights, fuel laps, session delta and attack gap.',
    ['porsche', 'gt3', 'themed', 'race', 'revlights', 'cluster', 'fuel-laps', 'delta', 'gap'],
    () =>
      dashboard('Porsche GT3 Race', 'Porsche-themed race cluster.', [
        bg(),
        revTop('revThemedPorsche'),
        hifiEl('clusterPorsche', 24, 112, 460, 300),
        hifiEl('fuelLaps', 508, 112, 420, 240),
        hifiEl('deltaSession', 508, 376, 256, 184),
        hifiEl('gapAhead', 792, 376, 232, 172)
      ])
  ),
  comp(
    'hifi_race_amg',
    'Mercedes-AMG GT3 Race',
    'Mercedes-AMG themed GT3 race page with AMG cluster, tyre pressure, brake bias and final-lap position.',
    ['amg', 'mercedes', 'gt3', 'themed', 'race', 'revlights', 'cluster', 'tyre-pressure', 'brake-bias'],
    () =>
      dashboard('Mercedes-AMG GT3 Race', 'Mercedes-AMG themed race cluster.', [
        bg(),
        revTop('revThemedAmg'),
        hifiEl('clusterAmg', 24, 112, 460, 300),
        hifiEl('tyrePressure', 508, 112, 420, 240),
        hifiEl('brakeBias', 508, 376, 420, 216),
        hifiEl('lapsRemaining', 24, 428, 232, 172)
      ])
  ),
  comp(
    'hifi_race_mclaren',
    'McLaren GT3 Race',
    'McLaren-themed GT3 race page with papaya cluster, McLaren rev strip, pedal trace, delta ahead and gap ahead.',
    ['mclaren', 'gt3', 'themed', 'race', 'revlights', 'cluster', 'inputs', 'delta-ahead', 'gap-ahead'],
    () =>
      dashboard('McLaren GT3 Race', 'McLaren-themed race cluster.', [
        bg(),
        revTop('revThemedMclaren'),
        hifiEl('clusterMclaren', 24, 112, 460, 300),
        hifiEl('inputsCombo', 508, 112, 320, 220),
        hifiEl('deltaAhead', 508, 364, 276, 172),
        hifiEl('gapAhead', 792, 364, 232, 172)
      ])
  )
]

