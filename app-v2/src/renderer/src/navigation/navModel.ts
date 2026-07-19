export interface NavSection {
  title: string
  viewIds: string[]
}

export const navSections: NavSection[] = [
  { title: 'Race Hub', viewIds: ['telemetry', 'alerts', 'context-debt', 'story-engine'] },
  { title: 'Drive', viewIds: ['dashboards', 'streaming', 'touch-controls', 'dashboard-adaptive', 'oled-dash', 'overlays', 'spotter-3d', 'sounds', 'haptics', 'haptics-zonal', 'biometrics'] },
  { title: 'Streaming', viewIds: ['streaming-mobile-editor'] },
  { title: 'IA & Coaching', viewIds: ['engineer', 'coach', 'mission-rehearsal', 'dashboard-builder', 'voice', 'search'] },
  { title: 'Strategy', viewIds: ['fuel', 'tire', 'strategy'] },
  { title: 'Broadcast', viewIds: ['social-connectors'] },
  { title: 'Garage', viewIds: ['setups', 'setup-experiment', 'race-profiles', 'community', 'raceops-blueprints'] },
  { title: 'League Ops', viewIds: ['steward-desk'] },
  { title: 'Hardware', viewIds: ['rig-preflight', 'devices', 'arduinos', 'revlights', 'inputs', 'controls', 'pinout'] },
  { title: 'System', viewIds: ['accessibility-cues', 'settings', 'collaboration', 'about', 'expr', 'profiles', 'career'] }
]
