// ─── Hi-fi CAR real-dash composition dashboards ───────────────────────────────
// Full-dash 1024×600 dashboards that mount ONE car's faithful full-cluster hi-fi
// widget (built from the real dashboard reference). Each is registered as a preset
// and — because the full-dash widget is a hi-fi module — is also available as a
// floating overlay via the hifi-overlays bridge. Self-contained: imports only the
// composition kit. Spread into BUILTIN_PRESETS.
import { bg, comp, dashboard, hifiEl, type HifiCompPreset } from './dashboards-hifi-kit'

export const HIFI_CARS_PRESETS: HifiCompPreset[] = [
  comp(
    'hifi_car_ferrari296',
    'Ferrari 296 GT3 Cluster',
    'Faithful Ferrari 296 GT3 wheel cluster: top shift LEDs, dominant center gear, speed + RPM bar, fuel/TC on the left and last-lap/ABS/MAP on the right.',
    ['ferrari', 'ferrari-296-gt3', 'gt3', 'car', 'cluster', 'real-dash', 'ir'],
    () =>
      dashboard('Ferrari 296 GT3 Cluster', 'Ferrari 296 GT3 real-dash cluster.', [
        bg(),
        hifiEl('f296Dash', 0, 0, 1024, 600)
      ])
  ),
  comp(
    'hifi_car_porschecup',
    'Porsche 911 GT3 Cup Cluster',
    'Faithful Porsche 911 GT3 Cup (992) Cosworth ICD cluster: straight segmented rev bar, minimalist center gear, speed, fuel/oil and lap/delta.',
    ['porsche', 'porsche-911-gt3-cup', 'gt3-cup', 'car', 'cluster', 'real-dash', 'cosworth', 'ir'],
    () =>
      dashboard('Porsche 911 GT3 Cup Cluster', 'Porsche 911 GT3 Cup real-dash cluster.', [
        bg(),
        hifiEl('pcupDash', 0, 0, 1024, 600)
      ])
  ),
  comp(
    'hifi_car_mustanggtd',
    'Mustang GTD Cluster',
    'Faithful Ford Mustang GTD Track cluster: sweeping arc tach, center gear + speed, oil/water, tire pressures and TRACK mode.',
    ['ford', 'mustang', 'mustang-gtd', 'car', 'cluster', 'real-dash', 'ir'],
    () =>
      dashboard('Mustang GTD Cluster', 'Ford Mustang GTD real-dash cluster.', [
        bg(),
        hifiEl('gtdDash', 0, 0, 1024, 600)
      ])
  )
]
