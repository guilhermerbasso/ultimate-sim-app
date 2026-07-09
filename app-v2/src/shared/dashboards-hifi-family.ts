// ─── Hi-fi FAMILY / HERO composition dashboards ───────────────────────────────
// Clean v4 1024×600 hero pages composed only from registered hi-fi widget ids.
import { bg, comp, dashboard, hifiEl, revTop, type HifiCompPreset } from './dashboards-hifi-kit'

const BODY_TOP = 112
const ROW_H = 226
const ROW_2 = 350
const GAP = 14
const COL_W = 323
const X1 = 16
const X2 = X1 + COL_W + GAP
const X3 = X2 + COL_W + GAP

export const HIFI_FAMILY_PRESETS: HifiCompPreset[] = [
  comp(
    'hifi_family_compact_ddu',
    'Compact DDU',
    'Clean compact DDU hero with corner-to-corner rev lights, primary driver data, tyres, fuel and race position.',
    ['compact', 'ddu', 'gt-style', 'shift-lights', 'gear', 'speed', 'tyres', 'fuel', 'position', 'clean-v4'],
    () =>
      dashboard('Compact DDU', 'Clean compact DDU hero.', [
        bg(),
        revTop('revlightsLedStrip'),
        hifiEl('gear', X1, BODY_TOP, COL_W, ROW_H),
        hifiEl('speed', X2, BODY_TOP, COL_W, ROW_H),
        hifiEl('rpmBar', X3, BODY_TOP, COL_W, ROW_H),
        hifiEl('tyreTemp', X1, ROW_2, COL_W, ROW_H),
        hifiEl('fuelLaps', X2, ROW_2, COL_W, ROW_H),
        hifiEl('position', X3, ROW_2, COL_W, ROW_H)
      ])
  ),
  comp(
    'hifi_family_dual_cluster',
    'Dual Cluster',
    'Two balanced DDU clusters with a full-width rev strip, gear/speed drive core and timing/fuel support.',
    ['dual-cluster', 'ddu', 'rpm', 'shift-lights', 'gear', 'speed', 'fuel', 'delta', 'position', 'clean-v4'],
    () =>
      dashboard('Dual Cluster', 'Clean dual-cluster DDU hero.', [
        bg(),
        revTop('revlightsGradient'),
        hifiEl('gear', X1, BODY_TOP, COL_W, ROW_H),
        hifiEl('speed', X2, BODY_TOP, COL_W, ROW_H),
        hifiEl('rpmBar', X3, BODY_TOP, COL_W, ROW_H),
        hifiEl('fuelLaps', X1, ROW_2, COL_W, ROW_H),
        hifiEl('deltaBest', X2, ROW_2, COL_W, ROW_H),
        hifiEl('position', X3, ROW_2, COL_W, ROW_H)
      ])
  ),
  comp(
    'hifi_family_broadcast',
    'Broadcast Hero',
    'Broadcast-safe race hero with the middle filled by track map plus speed/gear, timing and class-position context.',
    ['broadcast', 'stream', 'track-map', 'speed-gear', 'leaderboard-style', 'position', 'race-control', 'clean-v4'],
    () =>
      dashboard('Broadcast Hero', 'Clean broadcast hero with no dead center.', [
        bg(),
        revTop('revlightsLedBar'),
        hifiEl('trackMap2D', 16, BODY_TOP, 316, 286),
        hifiEl('speedGear', 354, BODY_TOP, 316, 286),
        hifiEl('clock', 692, BODY_TOP, 316, 286),
        hifiEl('position', 16, 420, 236, 156),
        hifiEl('classPosition', 268, 420, 236, 156),
        hifiEl('lapBest', 520, 420, 236, 156),
        hifiEl('timeRemaining', 772, 420, 236, 156)
      ])
  ),
  comp(
    'hifi_family_minimal_focus',
    'Minimal Focus',
    'Sparse title-less focus page that still uses the whole canvas: rev strip, huge gear/speed and delta/position anchors.',
    ['minimal', 'focus', 'driver', 'speed', 'gear', 'delta', 'position', 'clean-v4'],
    () =>
      dashboard('Minimal Focus', 'Clean minimal focus hero.', [
        bg(),
        revTop('revlightsLedStrip'),
        hifiEl('gear', 94, BODY_TOP, 390, 250),
        hifiEl('speed', 540, BODY_TOP, 390, 250),
        hifiEl('deltaBest', 94, 392, 252, 184),
        hifiEl('lapBest', 386, 392, 252, 184),
        hifiEl('position', 678, 392, 252, 184)
      ])
  ),
  comp(
    'hifi_family_oled_strip',
    'OLED Strip',
    'Wide OLED-like race strip with edge-to-edge rev lights, a center driving band and compact race-management row.',
    ['oled', 'strip', 'wide', 'shift-lights', 'speed-gear', 'delta', 'fuel', 'position', 'clean-v4'],
    () =>
      dashboard('OLED Strip', 'Clean wide OLED strip hero.', [
        bg(),
        revTop('revlightsLedStrip'),
        hifiEl('speedGear', 16, 120, 480, 220),
        hifiEl('rpmBar', 528, 120, 480, 220),
        hifiEl('deltaBest', X1, 372, COL_W, 184),
        hifiEl('fuelLaps', X2, 372, COL_W, 216),
        hifiEl('position', X3, 372, COL_W, 184)
      ])
  ),
  comp(
    'hifi_family_radar_hud',
    'Radar HUD',
    'Traffic-awareness HUD with a large center proximity radar, side alerts, position and delta context.',
    ['radar', 'hud', 'traffic', 'proximity', 'alerts', 'position', 'delta', 'clean-v4'],
    () =>
      dashboard('Radar HUD', 'Clean radar and traffic HUD.', [
        bg(),
        revTop('revlightsGradient'),
        hifiEl('alertCarLeft', 36, 136, 220, 220),
        hifiEl('alertProximityRadar', 362, BODY_TOP, 300, 300),
        hifiEl('alertCarRight', 768, 136, 220, 220),
        hifiEl('position', 36, 424, 250, 152),
        hifiEl('deltaSession', 386, 424, 252, 152),
        hifiEl('classPosition', 738, 424, 250, 152)
      ])
  ),
  comp(
    'hifi_family_wide_cinematic',
    'Wide Cinematic',
    'Cinematic race page with a panoramic rev header, wide drive core and a tidy timing/fuel support rail.',
    ['wide', 'cinematic', 'panoramic', 'shift-lights', 'gear', 'speed', 'delta', 'minimal', 'clean-v4'],
    () =>
      dashboard('Wide Cinematic', 'Clean cinematic wide hero.', [
        bg(),
        revTop('revlightsLedBar'),
        hifiEl('gear', 16, BODY_TOP, 316, 236),
        hifiEl('speed', 354, BODY_TOP, 316, 236),
        hifiEl('rpm', 692, BODY_TOP, 316, 236),
        hifiEl('deltaBest', X1, 372, COL_W, 184),
        hifiEl('fuel', X2, 372, COL_W, 216),
        hifiEl('position', X3, 372, COL_W, 184)
      ])
  ),
  comp(
    'hifi_family_gt3_flavored',
    'GT3 Flavoured',
    'Classic GT3 DDU-flavoured composition with rev lights, drive state, tyres, electronics and fuel.',
    ['gt3', 'gt-style', 'ddu', 'shift-lights', 'gear', 'speed', 'tyres', 'fuel', 'tc', 'abs', 'clean-v4'],
    () =>
      dashboard('GT3 Flavoured', 'Clean GT3-flavoured hero.', [
        bg(),
        revTop('revlightsGradient'),
        hifiEl('speedGear', X1, BODY_TOP, COL_W, ROW_H),
        hifiEl('tyreTemp', X2, BODY_TOP, COL_W, ROW_H),
        hifiEl('fuelLaps', X3, BODY_TOP, COL_W, ROW_H),
        hifiEl('tc', X1, ROW_2, COL_W, ROW_H),
        hifiEl('abs', X2, ROW_2, COL_W, ROW_H),
        hifiEl('brakeBias', X3, ROW_2, COL_W, ROW_H)
      ])
  ),
  comp(
    'hifi_family_standings_wall',
    'Standings Wall',
    'Timing-wall style page using registered timing tiles: positions, laps, remaining time and best-lap context.',
    ['standings', 'wall', 'timing', 'class-position', 'laps', 'lap-best', 'broadcast', 'clean-v4'],
    () =>
      dashboard('Standings Wall', 'Clean timing-wall hero.', [
        bg(),
        revTop('revlightsLedStrip'),
        hifiEl('position', 16, BODY_TOP, 236, 184),
        hifiEl('classPosition', 268, BODY_TOP, 236, 184),
        hifiEl('lapNumber', 520, BODY_TOP, 236, 184),
        hifiEl('lapsRemaining', 772, BODY_TOP, 236, 184),
        hifiEl('lapCurrent', 16, 372, 236, 184),
        hifiEl('lapLast', 268, 372, 236, 184),
        hifiEl('lapBest', 520, 372, 236, 184),
        hifiEl('timeRemaining', 772, 372, 236, 184)
      ])
  ),
  comp(
    'hifi_family_traffic_watch',
    'Traffic Watch',
    'Racecraft monitor with radar, side-car alerts, flags, incident count and position/class context.',
    ['traffic', 'watch', 'radar', 'alerts', 'flag', 'incidents', 'position', 'racecraft', 'clean-v4'],
    () =>
      dashboard('Traffic Watch', 'Clean traffic-watch hero.', [
        bg(),
        revTop('revlightsLedBar'),
        hifiEl('alertProximityRadar', 16, BODY_TOP, 318, 318),
        hifiEl('flag', 356, BODY_TOP, 316, 252),
        hifiEl('incidents', 692, BODY_TOP, 316, 252),
        hifiEl('position', 356, 384, 316, 192),
        hifiEl('classPosition', 692, 384, 316, 192)
      ])
  ),
  comp(
    'hifi_family_vitals_board',
    'Vitals Board',
    'Engineering vitals board with engine temperatures, oil pressure, electronics and brake bias in a clean grid.',
    ['vitals', 'engineering', 'engine', 'oil', 'water', 'pressure', 'tc', 'abs', 'engine-map', 'brake-bias', 'clean-v4'],
    () =>
      dashboard('Vitals Board', 'Clean engineering vitals hero.', [
        bg(),
        revTop('revlightsGradient'),
        hifiEl('waterTemp', X1, BODY_TOP, COL_W, ROW_H),
        hifiEl('oilTemp', X2, BODY_TOP, COL_W, ROW_H),
        hifiEl('oilPressure', X3, BODY_TOP, COL_W, ROW_H),
        hifiEl('tc', X1, ROW_2, COL_W, ROW_H),
        hifiEl('abs', X2, ROW_2, COL_W, ROW_H),
        hifiEl('engineMap', X3, ROW_2, COL_W, ROW_H)
      ])
  ),
  comp(
    'hifi_family_delta_focus',
    'Delta Focus',
    'Pace-analysis hero with deltas, lap times and AI coaching context arranged around the rev header.',
    ['delta', 'pace', 'analysis', 'lap-best', 'timing', 'driver-coaching', 'ai', 'clean-v4'],
    () =>
      dashboard('Delta Focus', 'Clean delta and timing focus hero.', [
        bg(),
        revTop('revlightsLedStrip'),
        hifiEl('deltaBest', 16, BODY_TOP, 236, 184),
        hifiEl('deltaSession', 268, BODY_TOP, 236, 184),
        hifiEl('lapCurrent', 520, BODY_TOP, 236, 184),
        hifiEl('lapBest', 772, BODY_TOP, 236, 184),
        hifiEl('coachTip', 16, 372, 316, 204),
        hifiEl('coachFindings', 354, 372, 316, 204),
        hifiEl('aiConfidence', 692, 372, 316, 204)
      ])
  ),
  comp(
    'hifi_family_ferrari_hero',
    'Ferrari Hero',
    'Ferrari-themed hero with matching rev strip, signature cluster and support timing/tyre widgets.',
    ['themed', 'car', 'ferrari', 'gt3', 'rev-lights', 'cluster', 'clean-v4'],
    () =>
      dashboard('Ferrari Hero', 'Clean Ferrari-themed hero.', [
        bg(),
        revTop('revThemedFerrari'),
        hifiEl('clusterFerrari', 42, 136, 460, 300),
        hifiEl('tyreTemp', 540, 136, 420, 216),
        hifiEl('deltaBest', 540, 392, 192, 184),
        hifiEl('classPosition', 768, 392, 192, 184)
      ])
  ),
  comp(
    'hifi_family_porsche_hero',
    'Porsche Hero',
    'Porsche-themed hero with white-red rev strip, signature cluster, brake bias and timing context.',
    ['themed', 'car', 'porsche', 'cup', 'rev-lights', 'cluster', 'clean-v4'],
    () =>
      dashboard('Porsche Hero', 'Clean Porsche-themed hero.', [
        bg(),
        revTop('revThemedPorsche'),
        hifiEl('clusterPorsche', 42, 136, 460, 300),
        hifiEl('brakeBias', 540, 136, 420, 216),
        hifiEl('lapBest', 540, 392, 192, 184),
        hifiEl('classPosition', 768, 392, 192, 184)
      ])
  ),
  comp(
    'hifi_family_amg_hero',
    'AMG Hero',
    'AMG-themed hero with teal rev strip, signature cluster, electronics and fuel range.',
    ['themed', 'car', 'amg', 'gt3', 'rev-lights', 'cluster', 'clean-v4'],
    () =>
      dashboard('AMG Hero', 'Clean AMG-themed hero.', [
        bg(),
        revTop('revThemedAmg'),
        hifiEl('clusterAmg', 42, 136, 460, 300),
        hifiEl('engineMap', 540, 136, 420, 216),
        hifiEl('lapCurrent', 540, 392, 192, 184),
        hifiEl('classPosition', 768, 392, 192, 184)
      ])
  ),
  comp(
    'hifi_family_mclaren_hero',
    'McLaren Hero',
    'McLaren-themed papaya hero with thin rev strip, signature cluster, speed and delta support.',
    ['themed', 'car', 'mclaren', 'gt3', 'rev-lights', 'cluster', 'clean-v4'],
    () =>
      dashboard('McLaren Hero', 'Clean McLaren-themed hero.', [
        bg(),
        revTop('revThemedMclaren'),
        hifiEl('clusterMclaren', 42, 136, 460, 300),
        hifiEl('speed', 540, 136, 420, 216),
        hifiEl('deltaSession', 540, 392, 192, 184),
        hifiEl('classPosition', 768, 392, 192, 184)
      ])
  )
]
