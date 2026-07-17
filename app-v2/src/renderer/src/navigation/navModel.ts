export interface NavSection {
  title: string
  viewIds: string[]
}

export const navSections: NavSection[] = [
  { title: 'Race Hub', viewIds: ['telemetry', 'alerts'] },
  { title: 'Drive', viewIds: ['dashboards', 'touch-controls', 'dashboard-adaptive', 'oled-dash', 'overlays', 'spotter-3d', 'sounds', 'haptics', 'haptics-zonal', 'biometrics'] },
  { title: 'IA & Coaching', viewIds: ['engineer', 'coach', 'dashboard-builder', 'voice', 'search'] },
  { title: 'Strategy', viewIds: ['fuel', 'tire', 'strategy'] },
  { title: 'Garage', viewIds: ['setups', 'race-profiles', 'community'] },
  { title: 'League Ops', viewIds: ['steward-desk'] },
  { title: 'Hardware', viewIds: ['devices', 'arduinos', 'revlights', 'inputs', 'controls', 'pinout'] },
  { title: 'System', viewIds: ['settings', 'about', 'expr', 'profiles', 'career'] }
]
