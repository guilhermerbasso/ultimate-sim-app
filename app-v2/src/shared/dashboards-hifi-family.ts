// ─── Hi-fi FAMILY / STYLE composition dashboards ──────────────────────────────
// GT3 manufacturer-flavoured layouts (no branding — cosmetic accent families) plus
// broadcast / minimal / radar-HUD styles, composed from the hi-fi per-telemetry
// widgets. Self-contained; spread into BUILTIN_PRESETS.
//
// Add presets by pushing `comp(id, name, description, tags, build)` onto
// HIFI_FAMILY_PRESETS. Valid widget ids come from `HIFI_WIDGETS_BY_ID`.
import { bg, comp, dashboard, hifiEl, type HifiCompPreset } from './dashboards-hifi-kit'

export const HIFI_FAMILY_PRESETS: HifiCompPreset[] = [
  comp(
    'hifi_family_broadcast',
    'Broadcast — Standings HUD',
    'TV/stream broadcast layout: standings leaderboard, class position, gap ahead/behind, current + best lap and the session clock.',
    ['broadcast', 'stream', 'standings', 'gap', 'lap-times', 'clean'],
    () =>
      dashboard('Broadcast — Standings HUD', 'Broadcast standings HUD.', [
        bg(),
        hifiEl('standings', 24, 24, 420, 552),
        hifiEl('position', 468, 24, 258, 132),
        hifiEl('classPosition', 742, 24, 258, 132),
        hifiEl('gapAhead', 468, 172, 258, 132),
        hifiEl('gapBehind', 742, 172, 258, 132),
        hifiEl('lapCurrent', 468, 320, 532, 120),
        hifiEl('lapBest', 468, 452, 258, 124),
        hifiEl('clock', 742, 452, 258, 124)
      ])
  )
]
