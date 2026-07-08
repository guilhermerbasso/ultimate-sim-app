// ─── Hi-fi RACE composition dashboards ────────────────────────────────────────
// Race-scenario 1024×600 dashboards composed from the hi-fi per-telemetry widgets.
// Self-contained: imports only the composition kit (which imports only TYPES from
// ./dashboards). Spread into BUILTIN_PRESETS.
import { bg, comp, dashboard, hifiEl, type HifiCompPreset } from './dashboards-hifi-kit'

export const HIFI_RACE_PRESETS: HifiCompPreset[] = [
  comp(
    'hifi_race_sprint_core',
    'Sprint Race Core',
    'Sprint-race core with hero gear and speed, delta, track position, fuel laps, tyre temperatures and clean race gaps.',
    ['gt3', 'sprint', 'race', 'core', 'delta', 'gap', 'tyre-temp', 'fuel', 'position', 'clean'],
    () =>
      dashboard('Sprint Race Core', 'Sprint race core cluster.', [
        bg(),
        hifiEl('speedGear', 24, 24, 420, 260),
        hifiEl('fuelLaps', 584, 24, 420, 260),
        hifiEl('tyreTemp', 24, 312, 420, 260),
        hifiEl('position', 464, 312, 220, 184),
        hifiEl('deltaBest', 704, 312, 300, 184)
      ])
  ),
  comp(
    'hifi_race_qualifying_hotlap',
    'Qualifying Hotlap',
    'Qualifying focus with best and session deltas, current and best lap timing, tyre temperature balance and combined pedal traces.',
    ['gt3', 'qualifying', 'hotlap', 'delta', 'session-best', 'lap-time', 'tyre-temp', 'inputs', 'pedals'],
    () =>
      dashboard('Qualifying Hotlap', 'Qualifying delta and tyre window.', [
        bg(),
        hifiEl('deltaBest', 24, 24, 260, 184),
        hifiEl('deltaSession', 24, 232, 260, 184),
        hifiEl('lapCurrent', 304, 24, 260, 184),
        hifiEl('lapBest', 304, 232, 260, 184),
        hifiEl('tyreTemp', 584, 24, 420, 286),
        hifiEl('inputsCombo', 584, 340, 420, 220)
      ])
  ),
  comp(
    'hifi_race_wet_race',
    'Wet Race Control',
    'Wet-race control page for weather, surface wetness, grip, incidents, position, remaining time and tyre temperature.',
    ['gt3', 'wet', 'rain', 'race-control', 'weather', 'wetness', 'grip', 'incidents', 'position', 'tyre-temp'],
    () =>
      dashboard('Wet Race Control', 'Wet race environment and risk page.', [
        bg(),
        hifiEl('weather', 16, 24, 264, 260),
        hifiEl('wetness', 292, 24, 264, 260),
        hifiEl('tyreTemp', 584, 24, 420, 260),
        hifiEl('grip', 16, 312, 264, 260),
        hifiEl('incidents', 292, 312, 198, 250),
        hifiEl('position', 506, 312, 220, 184),
        hifiEl('timeRemaining', 742, 312, 220, 184)
      ])
  ),
  comp(
    'hifi_race_fuel_save',
    'Fuel Save Stint',
    'Fuel-save stint page with fuel level, laps remaining, per-lap burn, fuel delta, best-lap delta and current position.',
    ['gt3', 'fuel-save', 'stint', 'fuel', 'fuel-laps', 'fuel-delta', 'delta', 'position', 'endurance'],
    () =>
      dashboard('Fuel Save Stint', 'Fuel economy and pace trade-off.', [
        bg(),
        hifiEl('fuel', 16, 24, 360, 260),
        hifiEl('fuelLaps', 392, 24, 380, 260),
        hifiEl('position', 788, 24, 220, 184),
        hifiEl('fuelDelta', 16, 312, 420, 260),
        hifiEl('fuelPerLap', 452, 312, 360, 260),
        hifiEl('deltaBest', 828, 312, 180, 184)
      ])
  ),
  comp(
    'hifi_race_tyre_management',
    'Tyre Management',
    'Tyre-management page with temperatures, wear, pressure, detailed corner data and fuel laps for stint range.',
    ['gt3', 'tyre-management', 'tyres', 'tyre-temp', 'tyre-wear', 'tyre-pressure', 'stint', 'fuel-laps'],
    () =>
      dashboard('Tyre Management', 'Tyre condition and stint-range dashboard.', [
        bg(),
        hifiEl('tyreTemp', 16, 24, 420, 260),
        hifiEl('tyrePressure', 456, 24, 420, 260),
        hifiEl('tyreDetail', 16, 312, 560, 260),
        hifiEl('fuelLaps', 604, 312, 420, 260)
      ])
  ),
  comp(
    'hifi_race_race_start',
    'Race Start Launch',
    'Race-start launch page with rev lights, gear, speed, clutch, brake-throttle inputs, position and the car ahead.',
    ['gt3', 'race-start', 'launch', 'revlights', 'gear', 'speed', 'clutch', 'inputs', 'position', 'gap-ahead'],
    () =>
      dashboard('Race Start Launch', 'Launch and first-corner awareness.', [
        bg(),
        hifiEl('revlights', 24, 24, 420, 250),
        hifiEl('gear', 464, 24, 180, 250),
        hifiEl('speed', 664, 24, 336, 250),
        hifiEl('clutch', 24, 302, 180, 220),
        hifiEl('inputsBrakeThrottle', 224, 302, 320, 220),
        hifiEl('position', 564, 302, 208, 220),
        hifiEl('gapAhead', 792, 302, 208, 220)
      ])
  ),
  comp(
    'hifi_race_cold_out_lap',
    'Cold Out Lap',
    'Cold out-lap warm-up page with tyre temperatures, pressures, brake temperatures, water, oil and current lap time.',
    ['gt3', 'out-lap', 'warm-up', 'cold-tyres', 'tyre-temp', 'tyre-pressure', 'brake-temp', 'engine', 'lap-time'],
    () =>
      dashboard('Cold Out Lap', 'Warm-up vitals for tyres, brakes and engine.', [
        bg(),
        hifiEl('tyreTemp', 16, 24, 420, 260),
        hifiEl('brakeTemp', 456, 24, 420, 260),
        hifiEl('waterTemp', 16, 312, 320, 260),
        hifiEl('oilTemp', 352, 312, 320, 260),
        hifiEl('lapCurrent', 688, 312, 320, 184)
      ])
  ),
  comp(
    'hifi_race_safety_car',
    'Safety Car Queue',
    'Safety-car queue page with flag state, pit limiter, position, race gaps, remaining time and fuel status.',
    ['gt3', 'safety-car', 'caution', 'flag', 'pit-limiter', 'position', 'gap', 'time', 'fuel'],
    () =>
      dashboard('Safety Car Queue', 'Caution-period control dashboard.', [
        bg(),
        hifiEl('flag', 16, 24, 320, 260),
        hifiEl('pitLimiter', 352, 24, 320, 260),
        hifiEl('position', 688, 24, 320, 184),
        hifiEl('gapAhead', 24, 312, 176, 184),
        hifiEl('gapBehind', 220, 312, 176, 184),
        hifiEl('timeRemaining', 416, 312, 220, 184),
        hifiEl('fuel', 648, 312, 376, 260)
      ])
  ),
  comp(
    'hifi_race_restart_sprint',
    'Restart Sprint',
    'Restart sprint page with rev lights, hero gear and speed, the gaps ahead and behind, and best-lap delta.',
    ['gt3', 'restart', 'sprint', 'revlights', 'gear', 'speed', 'gap', 'delta', 'attack'],
    () =>
      dashboard('Restart Sprint', 'Green-flag restart focus.', [
        bg(),
        hifiEl('revlights', 24, 24, 420, 250),
        hifiEl('gear', 464, 24, 180, 250),
        hifiEl('speed', 664, 24, 336, 250),
        hifiEl('gapAhead', 24, 312, 220, 184),
        hifiEl('gapBehind', 264, 312, 220, 184),
        hifiEl('deltaBest', 504, 312, 236, 184)
      ])
  ),
  comp(
    'hifi_race_final_laps',
    'Final Laps Push',
    'Final-laps push page with position, front and rear gaps, fuel laps, laps remaining and best-lap delta.',
    ['gt3', 'final-laps', 'push', 'position', 'gap', 'fuel-laps', 'laps-remaining', 'delta'],
    () =>
      dashboard('Final Laps Push', 'Late-race gaps and range page.', [
        bg(),
        hifiEl('position', 16, 24, 320, 184),
        hifiEl('lapsRemaining', 352, 24, 220, 184),
        hifiEl('fuelLaps', 604, 24, 420, 260),
        hifiEl('gapAhead', 24, 300, 220, 184),
        hifiEl('gapBehind', 264, 300, 220, 184),
        hifiEl('deltaBest', 504, 300, 312, 184)
      ])
  ),
  comp(
    'hifi_race_attack_delta',
    'Attack Delta',
    'Attack page for closing the car ahead with delta-ahead trend, gap-ahead, relative list, best delta and speed.',
    ['gt3', 'attack', 'overtake', 'delta-ahead', 'gap-ahead', 'relative', 'delta', 'speed'],
    () =>
      dashboard('Attack Delta', 'Car-ahead pressure and pace view.', [
        bg(),
        hifiEl('speed', 24, 24, 360, 250),
        hifiEl('deltaAhead', 404, 24, 276, 184),
        hifiEl('gapAhead', 704, 24, 296, 184),
        hifiEl('relative', 24, 312, 360, 240),
        hifiEl('deltaBest', 404, 312, 276, 184)
      ])
  ),
  comp(
    'hifi_race_defend_gaps',
    'Defend Gaps',
    'Defensive race page with rear gap, delta behind, relative list, proximity radar and position.',
    ['gt3', 'defend', 'traffic', 'gap-behind', 'delta-behind', 'relative', 'radar', 'position'],
    () =>
      dashboard('Defend Gaps', 'Rear-pressure and proximity dashboard.', [
        bg(),
        hifiEl('position', 24, 24, 292, 184),
        hifiEl('gapBehind', 336, 24, 292, 184),
        hifiEl('deltaBehind', 648, 24, 352, 184),
        hifiEl('relative', 24, 280, 360, 240),
        hifiEl('radar', 544, 252, 300, 300)
      ])
  ),
  comp(
    'hifi_race_clean_minimal',
    'Clean Minimal Race',
    'Minimal race page with large gear and speed, best delta, position and fuel laps with generous negative space.',
    ['gt3', 'minimal', 'clean', 'negative-space', 'gear', 'speed', 'delta', 'position', 'fuel-laps'],
    () =>
      dashboard('Clean Minimal Race', 'Minimal high-legibility race dashboard.', [
        bg(),
        hifiEl('gear', 64, 48, 320, 286),
        hifiEl('speed', 424, 48, 420, 286),
        hifiEl('position', 64, 380, 260, 172),
        hifiEl('deltaBest', 344, 380, 240, 184),
        hifiEl('fuelLaps', 604, 340, 420, 240)
      ])
  )
]
