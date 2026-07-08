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
    'Endurance stint core: time + laps remaining, fuel remaining and laps-to-empty, fuel/lap, per-corner tyre temps and wear, engine vitals and position/gaps.',
    ['endurance', 'stint', 'fuel', 'tyre-temp', 'tyre-wear', 'engine', 'race'],
    () =>
      dashboard('Endurance — Stint Core', 'Endurance stint core cluster.', [
        bg(),
        hifiEl('timeRemaining', 40, 24, 300, 120),
        hifiEl('lapsRemaining', 40, 156, 300, 120),
        hifiEl('fuel', 360, 24, 304, 120),
        hifiEl('fuelLaps', 360, 156, 304, 120),
        hifiEl('fuelPerLap', 684, 24, 300, 120),
        hifiEl('position', 684, 156, 300, 120),
        hifiEl('tyreTemp', 40, 300, 300, 268),
        hifiEl('tyreWear', 360, 300, 304, 268),
        hifiEl('waterTemp', 684, 300, 148, 128),
        hifiEl('oilTemp', 836, 300, 148, 128),
        hifiEl('relative', 684, 440, 300, 128)
      ])
  )
]
