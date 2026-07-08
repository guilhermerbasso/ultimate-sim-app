// ─── Hi-fi FAMILY / STYLE composition dashboards ──────────────────────────────
// GT3-flavoured layouts plus broadcast / minimal / radar-HUD styles, composed
// from the hi-fi per-telemetry widgets. Self-contained; spread into BUILTIN_PRESETS.
//
// Add presets by pushing `comp(id, name, description, tags, build)` onto
// HIFI_FAMILY_PRESETS. Valid widget ids come from `HIFI_WIDGETS_BY_ID`.
import { bg, comp, dashboard, hifiEl, type HifiCompPreset } from './dashboards-hifi-kit'

export const HIFI_FAMILY_PRESETS: HifiCompPreset[] = [
  comp(
    'hifi_family_broadcast',
    'Broadcast — Standings HUD',
    'TV and stream broadcast layout with a tall leaderboard, race position, class position, gaps and lap timing blocks.',
    ['broadcast', 'stream', 'standings', 'leaderboard', 'gap', 'lap-times', 'race-control', 'clean'],
    () =>
      dashboard('Broadcast — Standings HUD', 'Broadcast standings HUD.', [
        bg(),
        hifiEl('standings', 24, 24, 338, 552),
        hifiEl('clock', 386, 24, 312, 252),
        hifiEl('position', 710, 24, 290, 172),
        hifiEl('classPosition', 710, 208, 290, 172),
        hifiEl('gapAhead', 386, 288, 290, 136),
        hifiEl('lapBest', 386, 436, 290, 140),
        hifiEl('gapBehind', 710, 404, 290, 172)
      ])
  ),
  comp(
    'hifi_family_minimal_focus',
    'Minimal Focus',
    'Sparse black-canvas driver focus page with huge gear, speed, best delta and position tiles.',
    ['minimal', 'focus', 'negative-space', 'driver', 'speed', 'gear', 'delta', 'position'],
    () =>
      dashboard('Minimal Focus', 'Minimal driver focus layout.', [
        bg(),
        hifiEl('gear', 140, 80, 360, 245),
        hifiEl('speed', 524, 80, 360, 245),
        hifiEl('deltaBest', 140, 357, 360, 180),
        hifiEl('position', 524, 357, 360, 180)
      ])
  ),
  comp(
    'hifi_family_radar_hud',
    'Radar HUD',
    'Traffic awareness display with central proximity radar, relative list, gap tiles and current position.',
    ['radar', 'hud', 'traffic', 'relative', 'gaps', 'proximity', 'position', 'clean'],
    () =>
      dashboard('Radar HUD', 'Radar and relative traffic display.', [
        bg(),
        hifiEl('relative', 24, 64, 338, 220),
        hifiEl('position', 24, 316, 338, 172),
        hifiEl('radar', 386, 64, 300, 300),
        hifiEl('gapAhead', 710, 64, 290, 172),
        hifiEl('gapBehind', 710, 248, 290, 172),
        hifiEl('classPosition', 710, 432, 290, 144)
      ])
  ),
  comp(
    'hifi_family_oled_strip',
    'OLED Strip',
    'Wide horizontal OLED-inspired strip with a full-width shift-light band and large row modules for pace, fuel and track position.',
    ['oled', 'strip', 'wide', 'shift-lights', 'speed-gear', 'delta', 'fuel', 'position'],
    () =>
      dashboard('OLED Strip', 'Wide OLED strip composition.', [
        bg(),
        hifiEl('revlights', 24, 24, 640, 216),
        hifiEl('position', 688, 24, 312, 216),
        hifiEl('speedGear', 24, 252, 315, 216),
        hifiEl('deltaBest', 351, 252, 315, 216),
        hifiEl('fuelLaps', 678, 252, 322, 216)
      ])
  ),
  comp(
    'hifi_family_dual_cluster',
    'Dual Cluster',
    'Two-cluster DDU concept: shift, gear, speed and RPM bar grouped left with fuel, delta and position data stacked right.',
    ['dual-cluster', 'ddu', 'rpm', 'shift-lights', 'gear', 'speed', 'fuel', 'delta', 'position'],
    () =>
      dashboard('Dual Cluster', 'Dual cluster DDU composition.', [
        bg(),
        hifiEl('revlights', 24, 24, 315, 216),
        hifiEl('gear', 351, 24, 315, 216),
        hifiEl('speed', 24, 252, 315, 216),
        hifiEl('rpmBar', 351, 252, 315, 216),
        hifiEl('deltaBest', 690, 24, 310, 140),
        hifiEl('position', 690, 176, 310, 132),
        hifiEl('fuelLaps', 678, 320, 322, 256)
      ])
  ),
  comp(
    'hifi_family_wide_cinematic',
    'Wide Cinematic',
    'Cinematic race view with a panoramic shift-light header, large central driving tiles and a thin right-side timing stack.',
    ['wide', 'cinematic', 'panoramic', 'shift-lights', 'gear', 'speed', 'delta', 'minimal'],
    () =>
      dashboard('Wide Cinematic', 'Cinematic wide race display.', [
        bg(),
        hifiEl('revlights', 24, 24, 976, 216),
        hifiEl('gear', 24, 252, 315, 216),
        hifiEl('speed', 351, 252, 315, 216),
        hifiEl('deltaBest', 678, 252, 322, 160),
        hifiEl('position', 678, 424, 322, 152)
      ])
  ),
  comp(
    'hifi_family_compact_ddu',
    'Compact DDU',
    'Tight but readable DDU cluster with shift lights, gear, speed, tyre temperature, fuel laps and race position.',
    ['compact', 'ddu', 'gt-style', 'shift-lights', 'gear', 'speed', 'tyres', 'fuel', 'position'],
    () =>
      dashboard('Compact DDU', 'Compact DDU cluster.', [
        bg(),
        hifiEl('revlights', 24, 24, 316, 216),
        hifiEl('gear', 354, 24, 316, 216),
        hifiEl('speed', 684, 24, 316, 216),
        hifiEl('tyreTemp', 24, 252, 316, 216),
        hifiEl('fuelLaps', 354, 252, 316, 216),
        hifiEl('position', 684, 252, 316, 216)
      ])
  ),
  comp(
    'hifi_family_standings_wall',
    'Standings Wall',
    'Large wall-style leaderboard with class position, gap ahead, gap behind and best lap support tiles.',
    ['standings', 'wall', 'leaderboard', 'class-position', 'gaps', 'lap-best', 'broadcast'],
    () =>
      dashboard('Standings Wall', 'Leaderboard wall composition.', [
        bg(),
        hifiEl('standings', 24, 24, 420, 552),
        hifiEl('classPosition', 468, 80, 258, 172),
        hifiEl('gapAhead', 742, 80, 258, 172),
        hifiEl('gapBehind', 468, 320, 258, 172),
        hifiEl('lapBest', 742, 320, 258, 172)
      ])
  ),
  comp(
    'hifi_family_delta_focus',
    'Delta Focus',
    'Pace-analysis page led by a large best-delta tile, with session delta, traffic deltas and best lap around it.',
    ['delta', 'pace', 'analysis', 'lap-best', 'gap-trends', 'timing', 'driver-coaching'],
    () =>
      dashboard('Delta Focus', 'Delta and timing focus layout.', [
        bg(),
        hifiEl('deltaBest', 24, 80, 480, 240),
        hifiEl('deltaSession', 520, 80, 480, 160),
        hifiEl('deltaAhead', 520, 252, 480, 160),
        hifiEl('deltaBehind', 24, 348, 480, 160),
        hifiEl('lapBest', 520, 424, 480, 152)
      ])
  ),
  comp(
    'hifi_family_vitals_board',
    'Vitals Board',
    'Engineering vitals display with water, oil, pressure and electronic control tiles in a clean service grid.',
    ['vitals', 'engineering', 'engine', 'oil', 'water', 'pressure', 'tc', 'abs', 'engine-map', 'brake-bias'],
    () =>
      dashboard('Vitals Board', 'Engine and electronic vitals board.', [
        bg(),
        hifiEl('waterTemp', 24, 72, 316, 216),
        hifiEl('oilTemp', 354, 72, 316, 216),
        hifiEl('oilPressure', 684, 72, 316, 216),
        hifiEl('tc', 24, 312, 316, 216),
        hifiEl('abs', 354, 312, 316, 216),
        hifiEl('engineMap', 684, 312, 316, 216)
      ])
  ),
  comp(
    'hifi_family_traffic_watch',
    'Traffic Watch',
    'Race-traffic monitor combining relative, standings, radar, gap ahead, gap behind and position information.',
    ['traffic', 'watch', 'relative', 'standings', 'radar', 'gaps', 'position', 'racecraft'],
    () =>
      dashboard('Traffic Watch', 'Traffic and racecraft watch layout.', [
        bg(),
        hifiEl('relative', 24, 24, 338, 206),
        hifiEl('standings', 24, 254, 338, 322),
        hifiEl('radar', 386, 50, 300, 300),
        hifiEl('gapAhead', 710, 50, 290, 160),
        hifiEl('gapBehind', 710, 222, 290, 160),
        hifiEl('position', 710, 404, 290, 172)
      ])
  ),
  comp(
    'hifi_family_gt3_flavored',
    'GT3 Flavoured',
    'Classic GT3-style sim-racing cluster with shift lights, gear, speed, tyre temperature, fuel laps, best delta and position.',
    ['gt3', 'gt-style', 'ddu', 'shift-lights', 'gear', 'speed', 'tyres', 'fuel', 'delta', 'position'],
    () =>
      dashboard('GT3 Flavoured', 'Classic GT3-style cluster.', [
        bg(),
        hifiEl('revlights', 24, 24, 316, 216),
        hifiEl('gear', 354, 24, 316, 216),
        hifiEl('speed', 684, 24, 316, 216),
        hifiEl('tyreTemp', 24, 252, 316, 216),
        hifiEl('fuelLaps', 354, 252, 316, 216),
        hifiEl('deltaBest', 684, 252, 316, 160),
        hifiEl('position', 684, 424, 316, 152)
      ])
  )
]
