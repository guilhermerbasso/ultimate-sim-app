// ─── Hi-fi ENDURANCE composition dashboards ───────────────────────────────────
// Clean v4 endurance pages: black stage, corner-to-corner rev strip where useful,
// and title-less self-explanatory hi-fi widgets only.
import { bg, comp, dashboard, hifiEl, revTop, type HifiCompPreset } from './dashboards-hifi-kit'

export const HIFI_ENDURANCE_PRESETS: HifiCompPreset[] = [
  comp(
    'hifi_endur_stint_core',
    'Endurance — Stint Core',
    'Core endurance stint page with fuel range, stint countdown, position and immediate traffic under a full-width rev strip.',
    ['endurance', 'stint', 'fuel', 'fuel-laps', 'time-remaining', 'position', 'relative', 'revlights'],
    () =>
      dashboard('Endurance — Stint Core', 'Clean endurance stint core page.', [
        bg(),
        revTop('revlightsLedStrip'),
        hifiEl('fuel', 72, 112, 420, 286),
        hifiEl('fuelLaps', 532, 112, 420, 286),
        hifiEl('relative', 16, 416, 338, 172),
        hifiEl('timeRemaining', 378, 416, 256, 172),
        hifiEl('position', 660, 416, 292, 172)
      ])
  ),
  comp(
    'hifi_endur_stint_minimal',
    'Endurance — Stint Minimal',
    'Minimal endurance page with only the essentials: remaining time, fuel range, position and tyre wear.',
    ['endurance', 'minimal', 'stint', 'time-remaining', 'fuel-laps', 'position', 'tyre-wear', 'clean', 'revlights'],
    () =>
      dashboard('Endurance — Stint Minimal', 'Clean minimal endurance stint page.', [
        bg(),
        revTop('revlightsLedStrip'),
        hifiEl('fuelLaps', 72, 112, 420, 286),
        hifiEl('tyreWear', 532, 112, 420, 286),
        hifiEl('timeRemaining', 176, 416, 292, 172),
        hifiEl('position', 556, 416, 292, 172)
      ])
  ),
  comp(
    'hifi_endur_fuel_strategy',
    'Endurance — Fuel Strategy',
    'Fuel strategy page with full-size fuel quantity, laps-to-empty, consumption and a widened fuel-delta tile with generous right margin.',
    ['endurance', 'fuel', 'fuel-strategy', 'fuel-delta', 'consumption', 'no-overflow'],
    () =>
      dashboard('Endurance — Fuel Strategy', 'Clean endurance fuel strategy page.', [
        bg(),
        hifiEl('fuel', 80, 16, 420, 270),
        hifiEl('fuelLaps', 524, 16, 420, 270),
        hifiEl('fuelPerLap', 80, 314, 420, 270),
        hifiEl('fuelDelta', 524, 314, 420, 270)
      ])
  ),
  comp(
    'hifi_endur_double_stint',
    'Endurance — Double Stint',
    'Double-stint planning page focused on tyre wear, fuel range, remaining stint time and track position.',
    ['endurance', 'double-stint', 'strategy', 'fuel-laps', 'tyre-wear', 'position', 'revlights'],
    () =>
      dashboard('Endurance — Double Stint', 'Clean double-stint endurance page.', [
        bg(),
        revTop('revlightsLedBar'),
        hifiEl('fuelLaps', 72, 112, 420, 286),
        hifiEl('tyreWear', 532, 112, 420, 286),
        hifiEl('timeRemaining', 32, 416, 256, 172),
        hifiEl('lapsRemaining', 312, 416, 232, 172),
        hifiEl('position', 568, 416, 292, 172)
      ])
  ),
  comp(
    'hifi_endur_night_stint',
    'Endurance — Night Stint',
    'Night stint cockpit page with high-contrast revs, speed/gear, fuel range, deltas and radar.',
    ['endurance', 'night', 'stint', 'speed-gear', 'fuel-laps', 'delta', 'radar', 'revlights'],
    () =>
      dashboard('Endurance — Night Stint', 'Clean night-stint endurance cockpit page.', [
        bg(),
        revTop('revlightsGradient'),
        hifiEl('speedGear', 72, 112, 420, 286),
        hifiEl('fuelLaps', 532, 112, 420, 286),
        hifiEl('deltaBest', 206, 416, 256, 172),
        hifiEl('deltaSession', 562, 416, 256, 172)
      ])
  ),
  comp(
    'hifi_endur_driver_swap',
    'Endurance — Driver Swap',
    'Driver-swap control page with fuel, session state, remaining time, laps and position.',
    ['endurance', 'driver-swap', 'stint', 'session', 'fuel', 'position', 'time-remaining', 'revlights'],
    () =>
      dashboard('Endurance — Driver Swap', 'Clean driver-swap endurance control page.', [
        bg(),
        revTop('revlightsLedStrip'),
        hifiEl('fuel', 72, 112, 420, 286),
        hifiEl('session', 596, 112, 264, 336),
        hifiEl('timeRemaining', 32, 416, 256, 172),
        hifiEl('lapsRemaining', 312, 416, 232, 172)
      ])
  ),
  comp(
    'hifi_endur_pit_window',
    'Endurance — Pit Window',
    'Pit-window page for call timing with fuel range, tyre wear, limiter state, time remaining and position.',
    ['endurance', 'pit-window', 'pit-limiter', 'fuel-laps', 'tyre-wear', 'time-remaining', 'position'],
    () =>
      dashboard('Endurance — Pit Window', 'Clean pit-window endurance strategy page.', [
        bg(),
        hifiEl('fuelLaps', 72, 16, 420, 276),
        hifiEl('tyreWear', 532, 16, 420, 276),
        hifiEl('pitLimiter', 80, 308, 264, 276),
        hifiEl('timeRemaining', 380, 360, 256, 172),
        hifiEl('position', 700, 360, 292, 172)
      ])
  ),
  comp(
    'hifi_endur_energy_hybrid',
    'Endurance — Energy Hybrid',
    'Hybrid endurance page for ERS, engine map, traction settings and lap delta.',
    ['endurance', 'hybrid', 'energy', 'ers', 'engine-map', 'tc', 'abs'],
    () =>
      dashboard('Endurance — Energy Hybrid', 'Clean hybrid endurance energy page.', [
        bg(),
        hifiEl('ers', 72, 16, 420, 276),
        hifiEl('engineMap', 532, 16, 420, 276),
        hifiEl('tc', 72, 308, 420, 276),
        hifiEl('abs', 532, 308, 420, 276)
      ])
  ),
  comp(
    'hifi_endur_temps_watch',
    'Endurance — Temps Watch',
    'Reliability watch page for engine, brake and tyre temperatures in a clean two-by-two grid.',
    ['endurance', 'temperatures', 'engine', 'water-temp', 'oil-temp', 'brake-temp', 'tyre-temp', 'reliability'],
    () =>
      dashboard('Endurance — Temps Watch', 'Clean endurance temperature watch page.', [
        bg(),
        hifiEl('waterTemp', 72, 16, 420, 276),
        hifiEl('oilTemp', 532, 16, 420, 276),
        hifiEl('brakeTemp', 72, 308, 420, 276),
        hifiEl('tyreTemp', 532, 308, 420, 276)
      ])
  ),
  comp(
    'hifi_endur_relative_traffic',
    'Endurance — Relative Traffic',
    'Relative traffic page with a large relative list, radar, gap ahead, gap behind and race position.',
    ['endurance', 'relative', 'traffic', 'radar', 'gap-ahead', 'gap-behind', 'position', 'revlights'],
    () =>
      dashboard('Endurance — Relative Traffic', 'Clean endurance relative traffic page.', [
        bg(),
        revTop('revlightsLedStrip'),
        hifiEl('relative', 48, 116, 420, 250),
        hifiEl('radar', 548, 112, 300, 300),
        hifiEl('gapAhead', 48, 430, 276, 158),
        hifiEl('position', 374, 430, 292, 158),
        hifiEl('gapBehind', 716, 430, 276, 158)
      ])
  ),
  comp(
    'hifi_endur_multiclass_traffic',
    'Endurance — Multiclass Traffic',
    'Multiclass traffic page with standings, class position, radar and direct gaps for mixed-class packs.',
    ['endurance', 'traffic', 'multiclass', 'standings', 'class-position', 'gaps', 'radar', 'revlights'],
    () =>
      dashboard('Endurance — Multiclass Traffic', 'Clean multiclass traffic endurance page.', [
        bg(),
        revTop('revlightsLedStrip'),
        hifiEl('standings', 48, 112, 420, 286),
        hifiEl('radar', 548, 112, 300, 300),
        hifiEl('gapAhead', 48, 430, 276, 158),
        hifiEl('classPosition', 374, 430, 232, 158),
        hifiEl('gapBehind', 716, 430, 276, 158)
      ])
  ),
  comp(
    'hifi_endur_broadcast',
    'Endurance — Broadcast',
    'Broadcast-style endurance page with standings, clock, overall and class position plus race gaps.',
    ['endurance', 'broadcast', 'standings', 'clock', 'position', 'class-position', 'gap-ahead', 'gap-behind', 'revlights'],
    () =>
      dashboard('Endurance — Broadcast', 'Clean endurance broadcast composition page.', [
        bg(),
        revTop('revlightsLedBar'),
        hifiEl('standings', 48, 112, 420, 286),
        hifiEl('clock', 556, 112, 312, 286),
        hifiEl('position', 48, 416, 292, 172),
        hifiEl('classPosition', 390, 416, 232, 172),
        hifiEl('gapAhead', 712, 416, 276, 172)
      ])
  ),
  comp(
    'hifi_endur_ferrari_stint',
    'Endurance — Ferrari Stint',
    'Ferrari-themed endurance page pairing the Ferrari rev strip and signature cluster with fuel range and stint traffic.',
    ['endurance', 'themed', 'ferrari', 'gt3', 'fuel-laps', 'relative', 'stint'],
    () =>
      dashboard('Endurance — Ferrari Stint', 'Ferrari-themed endurance stint page.', [
        bg(),
        revTop('revThemedFerrari'),
        hifiEl('clusterFerrari', 48, 120, 460, 300),
        hifiEl('fuelLaps', 556, 112, 420, 286),
        hifiEl('relative', 48, 432, 338, 156),
        hifiEl('timeRemaining', 420, 432, 256, 156),
        hifiEl('position', 700, 416, 292, 172)
      ])
  ),
  comp(
    'hifi_endur_porsche_traffic',
    'Endurance — Porsche Traffic',
    'Porsche-themed endurance traffic page with branded revs and cluster plus fuel, relatives and gap control.',
    ['endurance', 'themed', 'porsche', 'gt3', 'fuel', 'relative', 'traffic'],
    () =>
      dashboard('Endurance — Porsche Traffic', 'Porsche-themed endurance traffic page.', [
        bg(),
        revTop('revThemedPorsche'),
        hifiEl('clusterPorsche', 48, 120, 460, 300),
        hifiEl('fuel', 556, 112, 420, 286),
        hifiEl('relative', 48, 432, 338, 156),
        hifiEl('gapAhead', 420, 432, 276, 156),
        hifiEl('gapBehind', 716, 432, 276, 156)
      ])
  ),
  comp(
    'hifi_endur_amg_strategy',
    'Endurance — AMG Strategy',
    'AMG-themed endurance strategy page with branded cluster, fuel delta, fuel laps and stint countdown.',
    ['endurance', 'themed', 'amg', 'gt3', 'fuel-delta', 'fuel-laps', 'strategy'],
    () =>
      dashboard('Endurance — AMG Strategy', 'AMG-themed endurance strategy page.', [
        bg(),
        revTop('revThemedAmg'),
        hifiEl('clusterAmg', 48, 120, 460, 300),
        hifiEl('fuelDelta', 556, 112, 420, 286),
        hifiEl('timeRemaining', 556, 416, 256, 172),
        hifiEl('lapsRemaining', 836, 416, 174, 172)
      ])
  ),
  comp(
    'hifi_endur_mclaren_relative',
    'Endurance — McLaren Relative',
    'McLaren-themed endurance page with papaya rev strip, signature cluster, fuel range and relative traffic.',
    ['endurance', 'themed', 'mclaren', 'gt3', 'fuel-laps', 'relative', 'traffic'],
    () =>
      dashboard('Endurance — McLaren Relative', 'McLaren-themed endurance relative page.', [
        bg(),
        revTop('revThemedMclaren'),
        hifiEl('clusterMclaren', 48, 120, 460, 300),
        hifiEl('fuelLaps', 556, 112, 420, 286),
        hifiEl('relative', 48, 432, 338, 156),
        hifiEl('position', 700, 416, 292, 172)
      ])
  )
]
