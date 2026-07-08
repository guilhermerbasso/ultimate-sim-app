// ─── Hi-fi RACE composition dashboards ────────────────────────────────────────
// Sprint / qualifying / wet / fuel-save / race-start scenarios, composed from the
// hi-fi per-telemetry widgets. Self-contained: imports only the composition kit
// (which imports only TYPES from ./dashboards). Spread into BUILTIN_PRESETS.
//
// Author more presets by pushing `comp(id, name, description, tags, build)` onto
// HIFI_RACE_PRESETS. Valid widget ids come from `HIFI_WIDGETS_BY_ID` (registry).
import { bg, comp, dashboard, hifiEl, type HifiCompPreset } from './dashboards-hifi-kit'

export const HIFI_RACE_PRESETS: HifiCompPreset[] = [
  comp(
    'hifi_race_sprint_core',
    'Sprint — Race Core',
    'Sprint-race core: shift lights, hero gear + speed, live delta, position, fuel-laps, tyre temps and the gap to the car ahead/behind.',
    ['gt3', 'sprint', 'race', 'delta', 'gap', 'tyre-temp', 'fuel', 'clean'],
    () =>
      dashboard('Sprint — Race Core', 'Sprint race core cluster.', [
        bg(),
        hifiEl('revlights', 16, 12, 992, 44),
        hifiEl('gear', 432, 84, 160, 220),
        hifiEl('speed', 40, 92, 236, 120),
        hifiEl('deltaBest', 40, 224, 236, 120),
        hifiEl('position', 748, 92, 236, 120),
        hifiEl('fuelLaps', 748, 224, 236, 120),
        hifiEl('tyreTemp', 40, 372, 300, 196),
        hifiEl('gapAhead', 360, 372, 152, 196),
        hifiEl('gapBehind', 520, 372, 152, 196),
        hifiEl('lapLast', 700, 372, 284, 92),
        hifiEl('lapBest', 700, 476, 284, 92)
      ])
  )
]
