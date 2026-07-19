import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { AppViewProps } from '../App'

const AlertsView = lazy(() => import('./AlertsView'))
const ContextDebtView = lazy(() => import('./ContextDebtView'))
const AboutView = lazy(() => import('./AboutView'))
const ArduinosView = lazy(() => import('./ArduinosView'))
const ControlsView = lazy(() => import('./ControlsView'))
const PinoutDesignerView = lazy(() => import('./PinoutDesignerView'))
const DashboardsView = lazy(() => import('./DashboardsView'))
const StreamingView = lazy(() => import('./StreamingView'))
const DevicesView = lazy(() => import('./DevicesView'))
const ExpressionsView = lazy(() => import('./ExpressionsView'))
const FuelStrategyView = lazy(() => import('./FuelStrategyView'))
const InputMonitorView = lazy(() => import('./InputMonitorView'))
const OledDashboardView = lazy(() => import('./OledDashboardView'))
const OverlaysView = lazy(() => import('./OverlaysView'))
const ProfilesView = lazy(() => import('./ProfilesView'))
const RaceProfilesView = lazy(() => import('./RaceProfilesView'))
const RevlightsView = lazy(() => import('./RevlightsView'))
const SettingsView = lazy(() => import('./SettingsView'))
const VoiceSettingsView = lazy(() => import('./VoiceSettingsView'))
const SemanticSearchView = lazy(() => import('./SemanticSearchView'))
const SetupsView = lazy(() => import('./SetupsView'))
const SetupExperimentView = lazy(() => import('./SetupExperimentView'))
const CareerView = lazy(() => import('./CareerView'))
const EngineerView = lazy(() => import('./EngineerView'))
const CoachView = lazy(() => import('./CoachView'))
const StrategyView = lazy(() => import('./StrategyView'))
const CommunityView = lazy(() => import('./CommunityView'))
const DashboardBuilderView = lazy(() => import('./DashboardBuilderView'))
const AdaptiveDashboardView = lazy(() => import('./AdaptiveDashboardView'))
const BiometricsView = lazy(() => import('./BiometricsView'))
const HapticsZonalView = lazy(() => import('./HapticsZonalView'))
const Spotter3DView = lazy(() => import('./Spotter3DView'))
const HapticsView = lazy(() => import('./HapticsView'))
const SoundsView = lazy(() => import('./SoundsView'))
const TelemetryView = lazy(() => import('./TelemetryView'))
const TireStrategyView = lazy(() => import('./TireStrategyView'))
const TouchControlsView = lazy(() => import('./TouchControlsView'))
const StoryEngineView = lazy(() => import('./StoryEngineView'))
const StreamingMobileEditorView = lazy(() => import('./StreamingMobileEditorView'))
const MissionRehearsalView = lazy(() => import('./MissionRehearsalView'))
const SocialConnectorsView = lazy(() => import('./SocialConnectorsView'))

type ViewComponent = LazyExoticComponent<ComponentType<AppViewProps>>
export interface ViewDef {
  id: string
  group: string
  label: string
  eyebrow: string
  description: string
  shortcut: string
  Component: ViewComponent
}

// Pluggable screen registry. Each module fills its own view file;
// to add/change a screen, edit only this file plus the view file (without touching App).
export const viewRegistry: ViewDef[] = [
  { id: 'telemetry', group: 'Sim Racing', label: 'Telemetry', eyebrow: 'Sim', description: 'Live telemetry source and overview.', shortcut: 'T1', Component: TelemetryView },
  { id: 'dashboards', group: 'Sim Racing', label: 'Dashboards', eyebrow: 'Monitor', description: 'Windows on displays 1/2, .simhubdash import, and basic builder.', shortcut: 'T0', Component: DashboardsView },
  { id: 'streaming', group: 'Sim Racing', label: 'Streaming', eyebrow: 'Broadcast', description: 'Named read-only dashboard and touch-panel targets for OBS, phones, and tablets.', shortcut: 'TW', Component: StreamingView },
  { id: 'touch-controls', group: 'Sim Racing', label: 'Touch Controls Dash', eyebrow: 'Cockpit', description: 'Touch pit panel and editable RGB button boxes for the cockpit screen.', shortcut: 'TT', Component: TouchControlsView },
  { id: 'streaming-mobile-editor', group: 'Streaming', label: 'Mobile Stream Editor', eyebrow: 'Device preview', description: 'Non-destructive phone and tablet presentation profiles for saved dashboards and Touch Controls.', shortcut: 'TO', Component: StreamingMobileEditorView },
  { id: 'oled-dash', group: 'Sim Racing', label: 'OLED Dashboard', eyebrow: 'Display', description: 'iRacing information presets on the OLED.', shortcut: 'T2', Component: OledDashboardView },
  { id: 'overlays', group: 'Sim Racing', label: 'Overlays', eyebrow: 'Screen', description: 'Transparent overlays over the game.', shortcut: 'T3', Component: OverlaysView },
  { id: 'fuel', group: 'Sim Racing', label: 'Fuel', eyebrow: 'Strategy', description: 'Fuel calculation and strategy.', shortcut: 'T4', Component: FuelStrategyView },
  { id: 'tire', group: 'Sim Racing', label: 'Tires', eyebrow: 'Strategy', description: 'Tire wear, per-lap rate, and pit window.', shortcut: 'TC', Component: TireStrategyView },
  { id: 'search', group: 'Sim Racing', label: 'Semantic Search', eyebrow: 'Local AI', description: 'Meaning-based search across setups, ghosts, notes, and findings; keyword fallback.', shortcut: 'TS', Component: SemanticSearchView },
  { id: 'alerts', group: 'Sim Racing', label: 'Alerts', eyebrow: 'Warnings', description: 'Pit limiter, flags, fuel, shifting.', shortcut: 'T7', Component: AlertsView },
  { id: 'story-engine', group: 'Sim Racing', label: 'Story Engine', eyebrow: 'Post-race', description: 'Evidence-linked local story cards with destination previews and mandatory human approval.', shortcut: 'TY', Component: StoryEngineView },
  { id: 'context-debt', group: 'Sim Racing', label: 'Context-Debt Meter', eyebrow: 'SP-07 · N=0', description: 'Local pre-race audit of competing cues, routes, devices, and controls.', shortcut: 'TQ', Component: ContextDebtView },
  { id: 'expr', group: 'Sim Racing', label: 'Expressions', eyebrow: 'Custom', description: 'Custom fields and conditions.', shortcut: 'T8', Component: ExpressionsView },
  { id: 'race-profiles', group: 'Sim Racing', label: 'Race Profiles', eyebrow: 'Car/Track', description: 'Profiles by car/track with auto-switching.', shortcut: 'T9', Component: RaceProfilesView },
  { id: 'sounds', group: 'Sim Racing', label: 'Sounds', eyebrow: 'Audio', description: 'Soundshift (shift beep), Incident, ABS, and TCS.', shortcut: 'TA', Component: SoundsView },
  { id: 'setups', group: 'Sim Racing', label: 'Setups', eyebrow: 'iRacing', description: 'Auto-install setups (.sto) from folder or URL.', shortcut: 'TB', Component: SetupsView },
  { id: 'setup-experiment', group: 'Sim Racing', label: 'Setup Experiment', eyebrow: 'A-B-A', description: 'Local one-variable setup blocks with environment gates, bootstrap uncertainty, repeats, and abstention.', shortcut: 'TE', Component: SetupExperimentView },
  { id: 'career', group: 'Sim Racing', label: 'Career & Ratings', eyebrow: 'iRacing', description: 'iRating, Safety Rating, licenses, incidents, and results.', shortcut: 'TD', Component: CareerView },
  { id: 'engineer', group: 'Sim Racing', label: 'AI Engineer', eyebrow: 'LLM local', description: 'Race engineer with local AI (text): ask about fuel, tires, gaps, and strategy. Includes Voice Spotter (spoken alerts).', shortcut: 'TG', Component: EngineerView },
  { id: 'haptics', group: 'Sim Racing', label: 'Haptics', eyebrow: 'Bass shaker', description: 'ShakeIt-style haptic feedback: bass shaker (audio) + haptics.', shortcut: 'TF', Component: HapticsView },
  { id: 'coach', group: 'Sim Racing', label: 'AI Coach', eyebrow: 'Local AI', description: 'Driving coach + lap analysis: corner findings, track map, and suggested setup adjustments.', shortcut: 'T6', Component: CoachView },
  { id: 'mission-rehearsal', group: 'Sim Racing', label: 'Mission Rehearsal', eyebrow: 'Offline training', description: 'Author and run deterministic branching scenarios with synthetic events and blameless debriefs.', shortcut: 'TR', Component: MissionRehearsalView },
  { id: 'strategy', group: 'Sim Racing', label: 'Strategy', eyebrow: 'Predictive', description: 'Pit window, fuel margin, undercut, and incident clips.', shortcut: 'TH', Component: StrategyView },
  { id: 'dashboard-builder', group: 'Sim Racing', label: 'AI Dashboard', eyebrow: 'LLM local', description: 'Build dashboards by describing them in text; adaptive mode by session phase.', shortcut: 'TI', Component: DashboardBuilderView },
  { id: 'dashboard-adaptive', group: 'Sim Racing', label: 'Adaptive Dashboard', eyebrow: 'Live', description: 'Single panel that reorganizes itself by session phase and lap moment.', shortcut: 'TN', Component: AdaptiveDashboardView },
  { id: 'biometrics', group: 'Sim Racing', label: 'Biometrics', eyebrow: 'HR/AR', description: 'Heart rate, stress × pace, and AR HUD.', shortcut: 'TJ', Component: BiometricsView },
  { id: 'community', group: 'Sim Racing', label: 'Community', eyebrow: 'Local-first', description: 'Ghosts, telemetry, and setups via .simshare files; compare where you gain/lose.', shortcut: 'TK', Component: CommunityView },
  { id: 'haptics-zonal', group: 'Sim Racing', label: 'Haptics Zonal', eyebrow: 'Zones', description: 'Events→zones (seat/pedals/wheel) + visual simulator.', shortcut: 'TL', Component: HapticsZonalView },
  { id: 'spotter-3d', group: 'Sim Racing', label: '3D Spotter', eyebrow: 'Spatial audio', description: 'Positional HRTF cues for nearby cars.', shortcut: 'TM', Component: Spotter3DView },
  { id: 'social-connectors', group: 'Broadcast', label: 'Social Connectors', eyebrow: 'Mock conformance', description: 'Capability, policy and readiness matrix for Twitch, YouTube and Discord connector fixtures.', shortcut: 'SO', Component: SocialConnectorsView },
  { id: 'devices', group: 'ButtonBox', label: 'Devices', eyebrow: 'Connection', description: 'USB/serial detection and ButtonBox selection.', shortcut: '01', Component: DevicesView },
  { id: 'arduinos', group: 'ButtonBox', label: 'Arduinos', eyebrow: 'Hardware', description: 'SimHub-style hub: RGB, matrix, screens, gauges, controls, pinout, and firmware.', shortcut: '00', Component: ArduinosView },
  { id: 'revlights', group: 'ButtonBox', label: 'Rev Lights', eyebrow: 'LEDs', description: 'Rev lights configuration and presets.', shortcut: '06', Component: RevlightsView },
  { id: 'inputs', group: 'ButtonBox', label: 'Input Monitor', eyebrow: 'Test', description: 'Live validation via Web Gamepad API.', shortcut: '04', Component: InputMonitorView },
  { id: 'profiles', group: 'ButtonBox', label: 'Profiles', eyebrow: 'Presets', description: 'Save and load race configurations.', shortcut: '05', Component: ProfilesView },
  { id: 'controls', group: 'ButtonBox', label: 'Controls & Keyboard', eyebrow: 'Bindings', description: 'Button → key, virtual gamepad, iRacing command, or app action (dashboard/OLED/overlay).', shortcut: '08', Component: ControlsView },
  { id: 'pinout', group: 'ButtonBox', label: 'Pinout Designer', eyebrow: 'Low-code', description: 'Drag-and-drop pin map (LEDs, mux, encoders) + firmware generation.', shortcut: '0P', Component: PinoutDesignerView },
  { id: 'settings', group: 'App', label: 'Settings', eyebrow: 'App', description: 'Auto-start, telemetry source, theme.', shortcut: '09', Component: SettingsView },
  { id: 'about', group: 'App', label: 'About / Credits', eyebrow: 'Open source', description: 'Licenses, sources, and third-party components.', shortcut: '0A', Component: AboutView },
  { id: 'voice', group: 'Sim Racing', label: 'Voice / TTS', eyebrow: 'TTS local', description: 'Offline neural voices for Engineer/Spotter, on-demand download; system voice fallback; wake word "Hey, Engineer".', shortcut: 'TL', Component: VoiceSettingsView }
]
