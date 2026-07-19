export interface NavSection {
  title: string
  viewIds: string[]
}

export const navSections: NavSection[] = [
  { title: 'Race Hub', viewIds: ['telemetry', 'alerts'] },
  { title: 'Drive', viewIds: ['dashboards', 'streaming', 'touch-controls', 'dashboard-adaptive', 'oled-dash', 'overlays', 'spotter-3d', 'sounds', 'haptics', 'haptics-zonal', 'biometrics'] },
  { title: 'Streaming', viewIds: ['streaming-mobile-editor'] },
  { title: 'IA & Coaching', viewIds: ['engineer', 'coach', 'mission-rehearsal', 'dashboard-builder', 'voice', 'search'] },
  { title: 'Strategy', viewIds: ['fuel', 'tire', 'strategy'] },
  { title: 'Garage', viewIds: ['setups', 'race-profiles', 'community'] },
  { title: 'Hardware', viewIds: ['devices', 'arduinos', 'revlights', 'inputs', 'controls', 'pinout'] },
  { title: 'System', viewIds: ['accessibility-cues', 'settings', 'about', 'expr', 'profiles', 'career'] }
]
