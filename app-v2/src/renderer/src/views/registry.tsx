import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { AppViewProps } from '../App'

const AlertsView = lazy(() => import('./AlertsView'))
const AboutView = lazy(() => import('./AboutView'))
const ArduinosView = lazy(() => import('./ArduinosView'))
const ControlsView = lazy(() => import('./ControlsView'))
const PinoutDesignerView = lazy(() => import('./PinoutDesignerView'))
const DashboardsView = lazy(() => import('./DashboardsView'))
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

// Registro plugável de telas. Cada módulo preenche seu próprio arquivo de view;
// adicionar/alterar uma tela é só mexer aqui + no arquivo da view (sem tocar no App).
export const viewRegistry: ViewDef[] = [
  { id: 'telemetry', group: 'Sim Racing', label: 'Telemetria', eyebrow: 'Sim', description: 'Fonte de telemetria ao vivo e visão geral.', shortcut: 'T1', Component: TelemetryView },
  { id: 'dashboards', group: 'Sim Racing', label: 'Dashboards', eyebrow: 'Monitor', description: 'Janelas no monitor 1/2, importação .simhubdash e construtor básico.', shortcut: 'T0', Component: DashboardsView },
  { id: 'touch-controls', group: 'Sim Racing', label: 'Touch Controls Dash', eyebrow: 'Cockpit', description: 'Painel de Pit por toque e button boxes RGB editáveis para a tela do cockpit.', shortcut: 'TT', Component: TouchControlsView },
  { id: 'oled-dash', group: 'Sim Racing', label: 'OLED Dashboard', eyebrow: 'Display', description: 'Presets de informações do iRacing no OLED.', shortcut: 'T2', Component: OledDashboardView },
  { id: 'overlays', group: 'Sim Racing', label: 'Overlays', eyebrow: 'Tela', description: 'Overlays transparentes sobre o jogo.', shortcut: 'T3', Component: OverlaysView },
  { id: 'fuel', group: 'Sim Racing', label: 'Combustível', eyebrow: 'Estratégia', description: 'Cálculo de combustível e estratégia.', shortcut: 'T4', Component: FuelStrategyView },
  { id: 'tire', group: 'Sim Racing', label: 'Pneus', eyebrow: 'Estratégia', description: 'Desgaste de pneus, taxa por volta e janela de pit.', shortcut: 'TC', Component: TireStrategyView },
  { id: 'search', group: 'Sim Racing', label: 'Busca Semântica', eyebrow: 'IA local', description: 'Busca por significado em setups, ghosts, notas e achados; fallback por palavra-chave.', shortcut: 'TS', Component: SemanticSearchView },
  { id: 'alerts', group: 'Sim Racing', label: 'Alertas', eyebrow: 'Avisos', description: 'Pit limiter, bandeiras, combustível, troca.', shortcut: 'T7', Component: AlertsView },
  { id: 'expr', group: 'Sim Racing', label: 'Expressões', eyebrow: 'Custom', description: 'Campos e condições customizadas.', shortcut: 'T8', Component: ExpressionsView },
  { id: 'race-profiles', group: 'Sim Racing', label: 'Perfis Corrida', eyebrow: 'Carro/Pista', description: 'Perfis por carro/pista com auto-troca.', shortcut: 'T9', Component: RaceProfilesView },
  { id: 'sounds', group: 'Sim Racing', label: 'Sounds', eyebrow: 'Áudio', description: 'Soundshift (beep de troca), Incident, ABS e TCS.', shortcut: 'TA', Component: SoundsView },
  { id: 'setups', group: 'Sim Racing', label: 'Setups', eyebrow: 'iRacing', description: 'Auto-instalação de setups (.sto) de pasta ou URL.', shortcut: 'TB', Component: SetupsView },
  { id: 'career', group: 'Sim Racing', label: 'Carreira & Ratings', eyebrow: 'iRacing', description: 'iRating, Safety Rating, licenças, incidentes e resultados.', shortcut: 'TD', Component: CareerView },
  { id: 'engineer', group: 'Sim Racing', label: 'Engenheiro IA', eyebrow: 'LLM local', description: 'Engenheiro de corrida com IA local (texto): pergunte sobre combustível, pneus, gaps e estratégia. Inclui o Voice Spotter (avisos falados).', shortcut: 'TG', Component: EngineerView },
  { id: 'haptics', group: 'Sim Racing', label: 'Tátil', eyebrow: 'Bass shaker', description: 'Feedback tátil estilo ShakeIt: bass shaker (áudio) + haptics.', shortcut: 'TF', Component: HapticsView },
  { id: 'coach', group: 'Sim Racing', label: 'Coach IA', eyebrow: 'IA local', description: 'Coach de pilotagem + análise de voltas: achados por curva, mapa da pista e ajustes de setup sugeridos.', shortcut: 'T6', Component: CoachView },
  { id: 'strategy', group: 'Sim Racing', label: 'Estratégia', eyebrow: 'Preditiva', description: 'Janela de pit, margem de combustível, undercut e clipes de incidentes.', shortcut: 'TH', Component: StrategyView },
  { id: 'dashboard-builder', group: 'Sim Racing', label: 'Dashboard IA', eyebrow: 'LLM local', description: 'Monte dashboards descrevendo em texto; modo adaptativo por fase da sessão.', shortcut: 'TI', Component: DashboardBuilderView },
  { id: 'dashboard-adaptive', group: 'Sim Racing', label: 'Dashboard Adaptativo', eyebrow: 'Ao vivo', description: 'Painel único que se reorganiza sozinho por fase da sessão e momento da volta.', shortcut: 'TN', Component: AdaptiveDashboardView },
  { id: 'biometrics', group: 'Sim Racing', label: 'Biometria', eyebrow: 'HR/AR', description: 'Frequência cardíaca, estresse × ritmo e AR HUD.', shortcut: 'TJ', Component: BiometricsView },
  { id: 'community', group: 'Sim Racing', label: 'Comunidade', eyebrow: 'Local-first', description: 'Ghosts, telemetria e setups por arquivo .simshare; compare onde ganha/perde.', shortcut: 'TK', Component: CommunityView },
  { id: 'haptics-zonal', group: 'Sim Racing', label: 'Tátil Zonal', eyebrow: 'Zonas', description: 'Eventos→zonas (banco/pedais/volante) + simulador visual.', shortcut: 'TL', Component: HapticsZonalView },
  { id: 'spotter-3d', group: 'Sim Racing', label: 'Spotter 3D', eyebrow: 'Áudio espacial', description: 'Cues HRTF posicionais de carros próximos.', shortcut: 'TM', Component: Spotter3DView },
  { id: 'devices', group: 'ButtonBox', label: 'Dispositivos', eyebrow: 'Conexão', description: 'Detecção USB/serial e seleção do ButtonBox.', shortcut: '01', Component: DevicesView },
  { id: 'arduinos', group: 'ButtonBox', label: 'Arduinos', eyebrow: 'Hardware', description: 'Hub estilo SimHub: RGB, matriz, telas, gauges, controls, pinagem e firmware.', shortcut: '00', Component: ArduinosView },
  { id: 'revlights', group: 'ButtonBox', label: 'Rev Lights', eyebrow: 'LEDs', description: 'Configuração e presets das rev lights.', shortcut: '06', Component: RevlightsView },
  { id: 'inputs', group: 'ButtonBox', label: 'Monitor de Inputs', eyebrow: 'Teste', description: 'Validação ao vivo via Web Gamepad API.', shortcut: '04', Component: InputMonitorView },
  { id: 'profiles', group: 'ButtonBox', label: 'Perfis', eyebrow: 'Presets', description: 'Salvar e carregar configurações de corrida.', shortcut: '05', Component: ProfilesView },
  { id: 'controls', group: 'ButtonBox', label: 'Controls & Keyboard', eyebrow: 'Bindings', description: 'Botão → tecla, gamepad virtual, comando do iRacing ou ação do app (dashboard/OLED/overlay).', shortcut: '08', Component: ControlsView },
  { id: 'pinout', group: 'ButtonBox', label: 'Pinout Designer', eyebrow: 'Low-code', description: 'Mapa de pinos drag-and-drop (LEDs, mux, encoders) + geração de firmware.', shortcut: '0P', Component: PinoutDesignerView },
  { id: 'settings', group: 'App', label: 'Configurações', eyebrow: 'App', description: 'Auto-start, fonte de telemetria, tema.', shortcut: '09', Component: SettingsView },
  { id: 'about', group: 'App', label: 'Sobre / Créditos', eyebrow: 'Open source', description: 'Licenças, fontes e componentes de terceiros.', shortcut: '0A', Component: AboutView },
  { id: 'voice', group: 'Sim Racing', label: 'Voz / TTS', eyebrow: 'TTS local', description: 'Vozes neurais offline (pt-BR) do Engenheiro/Spotter, download sob demanda; fallback voz do sistema; wake-word "Oi, Engenheiro".', shortcut: 'TV', Component: VoiceSettingsView }
]
