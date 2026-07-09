// ─── Hi-fi COMPARE composition dashboard ──────────────────────────────────────
// Full 1024×600 broadcast-style dual-driver telemetry comparison, mounting the
// cmpDash hi-fi module (built from concepts/refs/ref-dash-telemetry-compare.png).
// Because cmpDash is a hi-fi module it is also available as a floating overlay via
// the hifi-overlays bridge. Self-contained: imports only the composition kit.
import { bg, comp, dashboard, hifiEl, type HifiCompPreset } from './dashboards-hifi-kit'

export const HIFI_COMPARE_PRESETS: HifiCompPreset[] = [
  comp(
    'hifi_compare_telemetry',
    'Telemetry Comparison',
    'Broadcast-style dual-driver telemetry comparison: player vs the car ahead (or session best) with driver panels, driving-style bars, a speed-zone track map, a full-width speed trace and a delta trace.',
    ['compare', 'broadcast', 'analysis', 'delta', 'speed', 'map', 'ir'],
    () =>
      dashboard('Telemetry Comparison', 'Broadcast dual-driver telemetry comparison surface.', [
        bg(),
        hifiEl('cmpDash', 0, 0, 1024, 600)
      ])
  )
]
