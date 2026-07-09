import type { AppLanguage } from '../../shared/settings'
import type { ViewDef } from './views/registry'

export const APP_SETTINGS_CHANGED_EVENT = 'usa:settings-changed'

export type ResolvedLanguage = Exclude<AppLanguage, 'auto'>

export const LANGUAGE_LABELS: Record<AppLanguage, string> = {
  auto: 'Auto (Windows)',
  'pt-BR': 'Português',
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  zh: '中文',
  ja: '日本語'
}

const LANGUAGE_ALIASES: Record<string, ResolvedLanguage> = {
  pt: 'pt-BR',
  'pt-br': 'pt-BR',
  en: 'en',
  'en-us': 'en',
  'en-gb': 'en',
  es: 'es',
  'es-es': 'es',
  'es-mx': 'es',
  fr: 'fr',
  'fr-fr': 'fr',
  de: 'de',
  'de-de': 'de',
  zh: 'zh',
  'zh-cn': 'zh',
  'zh-hans': 'zh',
  'zh-sg': 'zh',
  'zh-tw': 'zh',
  'zh-hant': 'zh',
  'zh-hk': 'zh',
  ja: 'ja',
  'ja-jp': 'ja'
}

function getNavigatorLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return []
  return navigator.languages.length ? navigator.languages : [navigator.language]
}

export function resolveAppLanguage(setting: AppLanguage, systemLanguages?: readonly string[]): ResolvedLanguage {
  if (setting !== 'auto') return setting
  const languages = systemLanguages ?? getNavigatorLanguages()
  for (const raw of languages) {
    const normalized = raw.toLowerCase()
    const exact = LANGUAGE_ALIASES[normalized]
    if (exact) return exact
    const base = LANGUAGE_ALIASES[normalized.split('-')[0]]
    if (base) return base
  }
  return 'en'
}

type ShellKey =
  | 'mainNav'
  | 'searchScreens'
  | 'favorites'
  | 'favoritesEmpty'
  | 'recents'
  | 'removeFavorite'
  | 'addFavorite'
  | 'simXConnected'
  | 'simXDisconnected'
  | 'connectInDevices'
  | 'supportAria'
  | 'supportTitle'
  | 'supportButton'
  | 'loadingScreen'
  | 'noResults'
  | 'languageHelp'
  | 'settingsSaved'
  | 'collapseSidebar'
  | 'expandSidebar'

const SHELL: Record<ResolvedLanguage, Record<ShellKey, string>> = {
  'pt-BR': {
    mainNav: 'Navegação principal',
    searchScreens: 'Buscar telas…',
    favorites: 'Favoritos',
    favoritesEmpty: 'Fixe telas com a estrela para acesso rápido.',
    recents: 'Recentes',
    removeFavorite: 'Remover {label} dos favoritos',
    addFavorite: 'Adicionar {label} aos favoritos',
    simXConnected: 'SIM-X conectado',
    simXDisconnected: 'SIM-X desconectado',
    connectInDevices: 'Conecte em Dispositivos',
    supportAria: 'Apoiar o projeto no Buy Me a Coffee',
    supportTitle: 'Apoiar o projeto',
    supportButton: '☕ Apoiar',
    loadingScreen: 'Carregando tela…',
    noResults: 'Nenhum resultado',
    languageHelp: 'Auto segue o idioma do Windows/app. Este primeiro rollout traduz o shell, a navegação e os metadados das telas; traduções tela a tela continuam evoluindo.',
    settingsSaved: 'Configurações salvas.',
    collapseSidebar: 'Recolher barra lateral',
    expandSidebar: 'Expandir barra lateral'
  },
  en: {
    mainNav: 'Main navigation',
    searchScreens: 'Search screens…',
    favorites: 'Favorites',
    favoritesEmpty: 'Pin screens with the star for quick access.',
    recents: 'Recent',
    removeFavorite: 'Remove {label} from favorites',
    addFavorite: 'Add {label} to favorites',
    simXConnected: 'SIM-X connected',
    simXDisconnected: 'SIM-X disconnected',
    connectInDevices: 'Connect in Devices',
    supportAria: 'Support the project on Buy Me a Coffee',
    supportTitle: 'Support the project',
    supportButton: '☕ Support',
    loadingScreen: 'Loading screen…',
    noResults: 'No results',
    languageHelp: 'Auto follows the Windows/app language. This first rollout localizes the app shell, navigation and screen metadata; screen-by-screen translations continue to expand over time.',
    settingsSaved: 'Settings saved.',
    collapseSidebar: 'Collapse sidebar',
    expandSidebar: 'Expand sidebar'
  },
  es: {
    mainNav: 'Navegación principal',
    searchScreens: 'Buscar pantallas…',
    favorites: 'Favoritos',
    favoritesEmpty: 'Fija pantallas con la estrella para acceso rápido.',
    recents: 'Recientes',
    removeFavorite: 'Quitar {label} de favoritos',
    addFavorite: 'Agregar {label} a favoritos',
    simXConnected: 'SIM-X conectado',
    simXDisconnected: 'SIM-X desconectado',
    connectInDevices: 'Conecta en Dispositivos',
    supportAria: 'Apoyar el proyecto en Buy Me a Coffee',
    supportTitle: 'Apoyar el proyecto',
    supportButton: '☕ Apoyar',
    loadingScreen: 'Cargando pantalla…',
    noResults: 'Sin resultados',
    languageHelp: 'Auto sigue el idioma de Windows/app. Este primer rollout traduce el shell, la navegación y los metadatos de las pantallas; las traducciones de cada pantalla seguirán ampliándose.',
    settingsSaved: 'Configuración guardada.',
    collapseSidebar: 'Contraer barra lateral',
    expandSidebar: 'Expandir barra lateral'
  },
  fr: {
    mainNav: 'Navigation principale',
    searchScreens: 'Rechercher des écrans…',
    favorites: 'Favoris',
    favoritesEmpty: 'Épinglez des écrans avec l’étoile pour un accès rapide.',
    recents: 'Récents',
    removeFavorite: 'Retirer {label} des favoris',
    addFavorite: 'Ajouter {label} aux favoris',
    simXConnected: 'SIM-X connecté',
    simXDisconnected: 'SIM-X déconnecté',
    connectInDevices: 'Connectez dans Appareils',
    supportAria: 'Soutenir le projet sur Buy Me a Coffee',
    supportTitle: 'Soutenir le projet',
    supportButton: '☕ Soutenir',
    loadingScreen: 'Chargement de l’écran…',
    noResults: 'Aucun résultat',
    languageHelp: 'Auto suit la langue de Windows/app. Cette première version traduit le shell, la navigation et les métadonnées des écrans; les traductions écran par écran continueront à s’étendre.',
    settingsSaved: 'Paramètres enregistrés.',
    collapseSidebar: 'Réduire la barre latérale',
    expandSidebar: 'Développer la barre latérale'
  },
  de: {
    mainNav: 'Hauptnavigation',
    searchScreens: 'Ansichten suchen…',
    favorites: 'Favoriten',
    favoritesEmpty: 'Hefte Ansichten mit dem Stern für schnellen Zugriff an.',
    recents: 'Zuletzt',
    removeFavorite: '{label} aus Favoriten entfernen',
    addFavorite: '{label} zu Favoriten hinzufügen',
    simXConnected: 'SIM-X verbunden',
    simXDisconnected: 'SIM-X getrennt',
    connectInDevices: 'Unter Geräte verbinden',
    supportAria: 'Projekt auf Buy Me a Coffee unterstützen',
    supportTitle: 'Projekt unterstützen',
    supportButton: '☕ Unterstützen',
    loadingScreen: 'Ansicht wird geladen…',
    noResults: 'Keine Ergebnisse',
    languageHelp: 'Auto folgt der Windows/App-Sprache. Dieser erste Rollout lokalisiert App-Shell, Navigation und Ansichtsmetadaten; Übersetzungen pro Ansicht werden weiter ausgebaut.',
    settingsSaved: 'Einstellungen gespeichert.',
    collapseSidebar: 'Seitenleiste einklappen',
    expandSidebar: 'Seitenleiste ausklappen'
  },
  zh: {
    mainNav: '主导航',
    searchScreens: '搜索页面…',
    favorites: '收藏',
    favoritesEmpty: '用星标固定页面以便快速访问。',
    recents: '最近',
    removeFavorite: '将 {label} 从收藏中移除',
    addFavorite: '将 {label} 添加到收藏',
    simXConnected: 'SIM-X 已连接',
    simXDisconnected: 'SIM-X 未连接',
    connectInDevices: '在“设备”中连接',
    supportAria: '在 Buy Me a Coffee 上支持该项目',
    supportTitle: '支持该项目',
    supportButton: '☕ 支持',
    loadingScreen: '正在加载页面…',
    noResults: '无结果',
    languageHelp: 'Auto 跟随 Windows/应用语言。此首个版本本地化了应用外壳、导航和页面元数据；各页面的翻译将持续完善。',
    settingsSaved: '设置已保存。',
    collapseSidebar: '收起侧边栏',
    expandSidebar: '展开侧边栏'
  },
  ja: {
    mainNav: 'メインナビゲーション',
    searchScreens: '画面を検索…',
    favorites: 'お気に入り',
    favoritesEmpty: 'スターで画面を固定するとすぐにアクセスできます。',
    recents: '最近',
    removeFavorite: '{label} をお気に入りから削除',
    addFavorite: '{label} をお気に入りに追加',
    simXConnected: 'SIM-X 接続済み',
    simXDisconnected: 'SIM-X 未接続',
    connectInDevices: '「デバイス」で接続',
    supportAria: 'Buy Me a Coffee でプロジェクトを支援',
    supportTitle: 'プロジェクトを支援',
    supportButton: '☕ 支援',
    loadingScreen: '画面を読み込み中…',
    noResults: '結果なし',
    languageHelp: 'Auto は Windows/アプリの言語に従います。この最初のロールアウトではアプリシェル、ナビゲーション、画面メタデータをローカライズします。画面ごとの翻訳は順次拡大します。',
    settingsSaved: '設定を保存しました。',
    collapseSidebar: 'サイドバーを折りたたむ',
    expandSidebar: 'サイドバーを展開'
  }
}

export function t(language: ResolvedLanguage, key: ShellKey, vars: Record<string, string> = {}): string {
  let value = SHELL[language][key] ?? SHELL.en[key]
  for (const [name, replacement] of Object.entries(vars)) value = value.replaceAll(`{${name}}`, replacement)
  return value
}

type ViewText = Pick<ViewDef, 'group' | 'label' | 'eyebrow' | 'description'>

const VIEW_TEXT: Record<ResolvedLanguage, Record<string, Partial<ViewText>>> = {
  'pt-BR': {},
  en: {
    telemetry: { label: 'Telemetry', eyebrow: 'Sim', description: 'Live telemetry source and overview.' },
    dashboards: { label: 'Dashboards', eyebrow: 'Monitor', description: 'Monitor windows, .simhubdash import, and dashboard builder.' },
    'touch-controls': { label: 'Touch Controls Dash', eyebrow: 'Cockpit', description: 'Touch pit panel and editable RGB button boxes for the cockpit screen.' },
    'oled-dash': { label: 'OLED Dashboard', eyebrow: 'Display', description: 'iRacing information presets for the OLED.' },
    overlays: { label: 'Overlays', eyebrow: 'Screen', description: 'Transparent overlays on top of the simulator.' },
    fuel: { label: 'Fuel', eyebrow: 'Strategy', description: 'Fuel calculation and strategy.' },
    tire: { label: 'Tyres', eyebrow: 'Strategy', description: 'Tyre wear, per-lap rate, and pit window.' },
    search: { label: 'Semantic Search', eyebrow: 'Local AI', description: 'Meaning-based search for setups, ghosts, notes, and findings.' },
    alerts: { label: 'Alerts', eyebrow: 'Warnings', description: 'Pit limiter, flags, fuel, and shift warnings.' },
    expr: { label: 'Expressions', eyebrow: 'Custom', description: 'Custom fields and conditions.' },
    'race-profiles': { label: 'Race Profiles', eyebrow: 'Car/Track', description: 'Car/track profiles with automatic switching.' },
    sounds: { label: 'Sounds', eyebrow: 'Audio', description: 'Soundshift, incident, ABS, and TCS audio cues.' },
    setups: { label: 'Setups', eyebrow: 'iRacing', description: 'Auto-install .sto setups from a folder or URL.' },
    career: { label: 'Career & Ratings', eyebrow: 'iRacing', description: 'iRating, Safety Rating, licenses, incidents, and results.' },
    engineer: { label: 'AI Engineer', eyebrow: 'Local LLM', description: 'Text race engineer for fuel, tyres, gaps, and strategy. Includes Voice Spotter.' },
    coach: { label: 'AI Coach', eyebrow: 'Local AI', description: 'Driving coach and lap analysis with corner findings, track map, and setup suggestions.' },
    strategy: { label: 'Strategy', eyebrow: 'Predictive', description: 'Pit window, fuel margin, undercut, and incident clips.' },
    'dashboard-builder': { label: 'AI Dashboard', eyebrow: 'Local LLM', description: 'Build dashboards by describing them in text.' },
    'dashboard-adaptive': { label: 'Adaptive Dashboard', eyebrow: 'Live', description: 'A single dashboard that reorganizes by session phase and lap moment.' },
    biometrics: { label: 'Biometrics', eyebrow: 'HR/AR', description: 'Heart rate, stress vs pace, and AR HUD.' },
    community: { label: 'Community', eyebrow: 'Local-first', description: 'Ghosts, telemetry, and setups via .simshare files.' },
    'haptics-zonal': { label: 'Zonal Haptics', eyebrow: 'Zones', description: 'Events to zones plus visual simulator.' },
    haptics: { label: 'Haptics', eyebrow: 'Bass shaker', description: 'ShakeIt-style tactile feedback: bass shaker audio plus haptics.' },
    'spotter-3d': { label: '3D Spotter', eyebrow: 'Spatial audio', description: 'HRTF positional cues for nearby cars.' },
    devices: { label: 'Devices', eyebrow: 'Connection', description: 'USB/serial detection and ButtonBox selection.' },
    arduinos: { label: 'Arduinos', eyebrow: 'Hardware', description: 'SimHub-style hardware hub for RGB, matrix, displays, gauges, controls, pinout, and firmware.' },
    revlights: { label: 'Rev Lights', eyebrow: 'LEDs', description: 'Rev light configuration and presets.' },
    inputs: { label: 'Input Monitor', eyebrow: 'Test', description: 'Live validation through the Web Gamepad API.' },
    profiles: { label: 'Profiles', eyebrow: 'Presets', description: 'Save and load race configurations.' },
    controls: { label: 'Controls & Keyboard', eyebrow: 'Bindings', description: 'Button to key, virtual gamepad, iRacing command, or app action.' },
    pinout: { label: 'Pinout Designer', eyebrow: 'Low-code', description: 'Drag-and-drop pin map plus firmware generation.' },
    settings: { label: 'Settings', eyebrow: 'App', description: 'Auto-start, telemetry source, language, and theme.' },
    about: { label: 'About / Credits', eyebrow: 'Open source', description: 'Licenses, fonts, and third-party components.' },
    voice: { label: 'Voice / TTS', eyebrow: 'Local TTS', description: 'Offline neural voices, system fallback, and wake-word.' }
  },
  es: {},
  fr: {},
  de: {},
  zh: {},
  ja: {}
}

for (const [id, text] of Object.entries(VIEW_TEXT.en)) {
  VIEW_TEXT.es[id] = { ...text }
  VIEW_TEXT.fr[id] = { ...text }
  VIEW_TEXT.de[id] = { ...text }
  VIEW_TEXT.zh[id] = { ...text }
  VIEW_TEXT.ja[id] = { ...text }
}

function patchViewText(language: ResolvedLanguage, patches: Record<string, Partial<ViewText>>): void {
  for (const [id, patch] of Object.entries(patches)) {
    VIEW_TEXT[language][id] = {
      ...(VIEW_TEXT[language][id] ?? {}),
      ...patch
    }
  }
}

patchViewText('es', {
  telemetry: { label: 'Telemetría', description: 'Fuente de telemetría en vivo y vista general.' },
  dashboards: { label: 'Dashboards', description: 'Ventanas de monitor, importación .simhubdash y constructor.' },
  overlays: { label: 'Overlays', eyebrow: 'Pantalla', description: 'Overlays transparentes sobre el simulador.' },
  fuel: { label: 'Combustible' },
  tire: { label: 'Neumáticos' },
  alerts: { label: 'Alertas' },
  engineer: { label: 'Ingeniero IA' },
  coach: { label: 'Coach IA' },
  haptics: { label: 'Háptica' },
  'haptics-zonal': { label: 'Háptica zonal' },
  strategy: { label: 'Estrategia' },
  devices: { label: 'Dispositivos' },
  settings: { label: 'Configuración', description: 'Autoarranque, telemetría, idioma y tema.' },
  about: { label: 'Acerca de / Créditos' }
})

patchViewText('fr', {
  telemetry: { label: 'Télémétrie', description: 'Source de télémétrie en direct et vue d’ensemble.' },
  overlays: { label: 'Overlays', eyebrow: 'Écran', description: 'Overlays transparents au-dessus du simulateur.' },
  fuel: { label: 'Carburant' },
  tire: { label: 'Pneus' },
  alerts: { label: 'Alertes' },
  engineer: { label: 'Ingénieur IA' },
  coach: { label: 'Coach IA' },
  haptics: { label: 'Haptique' },
  'haptics-zonal': { label: 'Haptique zonale' },
  strategy: { label: 'Stratégie' },
  devices: { label: 'Appareils' },
  settings: { label: 'Paramètres', description: 'Démarrage auto, télémétrie, langue et thème.' },
  about: { label: 'À propos / Crédits' }
})

patchViewText('de', {
  telemetry: { label: 'Telemetrie', description: 'Live-Telemetriequelle und Überblick.' },
  dashboards: { label: 'Dashboards' },
  overlays: { label: 'Overlays', eyebrow: 'Anzeige', description: 'Transparente Overlays über dem Simulator.' },
  fuel: { label: 'Kraftstoff' },
  tire: { label: 'Reifen' },
  alerts: { label: 'Warnungen' },
  engineer: { label: 'KI-Ingenieur' },
  coach: { label: 'KI-Coach' },
  haptics: { label: 'Haptik' },
  'haptics-zonal': { label: 'Zonen-Haptik' },
  strategy: { label: 'Strategie' },
  devices: { label: 'Geräte' },
  settings: { label: 'Einstellungen', description: 'Autostart, Telemetriequelle, Sprache und Theme.' },
  about: { label: 'Über / Credits' }
})

patchViewText('zh', {
  telemetry: { label: '遥测', eyebrow: '模拟器', description: '实时遥测源与总览。' },
  dashboards: { label: '仪表盘', eyebrow: '监视', description: '监视窗口、.simhubdash 导入与仪表盘构建器。' },
  'touch-controls': { label: '触控仪表盘', eyebrow: '座舱' },
  'oled-dash': { label: 'OLED 仪表盘', eyebrow: '显示' },
  overlays: { label: '叠加层', eyebrow: '屏幕', description: '模拟器之上的透明叠加层。' },
  fuel: { label: '燃油', eyebrow: '策略' },
  tire: { label: '轮胎', eyebrow: '策略' },
  alerts: { label: '警报' },
  engineer: { label: 'AI 工程师' },
  coach: { label: 'AI 教练' },
  strategy: { label: '策略' },
  haptics: { label: '触觉反馈' },
  'haptics-zonal': { label: '分区触觉' },
  devices: { label: '设备' },
  settings: { label: '设置', description: '自动启动、遥测源、语言与主题。' },
  about: { label: '关于 / 致谢' }
})

patchViewText('ja', {
  telemetry: { label: 'テレメトリー', eyebrow: 'シム', description: 'ライブのテレメトリーソースと概要。' },
  dashboards: { label: 'ダッシュボード', eyebrow: 'モニター', description: 'モニターウィンドウ、.simhubdash インポート、ビルダー。' },
  'touch-controls': { label: 'タッチダッシュ', eyebrow: 'コックピット' },
  'oled-dash': { label: 'OLED ダッシュ', eyebrow: 'ディスプレイ' },
  overlays: { label: 'オーバーレイ', eyebrow: '画面', description: 'シミュレーターの上に表示する透明オーバーレイ。' },
  fuel: { label: '燃料', eyebrow: '戦略' },
  tire: { label: 'タイヤ', eyebrow: '戦略' },
  alerts: { label: 'アラート' },
  engineer: { label: 'AI エンジニア' },
  coach: { label: 'AI コーチ' },
  strategy: { label: '戦略' },
  haptics: { label: 'ハプティクス' },
  'haptics-zonal': { label: 'ゾーンハプティクス' },
  devices: { label: 'デバイス' },
  settings: { label: '設定', description: '自動起動、テレメトリーソース、言語、テーマ。' },
  about: { label: '概要 / クレジット' }
})

const NAV_TITLES: Record<ResolvedLanguage, Record<string, string>> = {
  'pt-BR': {},
  en: {
    'IA & Coaching': 'AI & Coaching'
  },
  es: {
    'Race Hub': 'Centro de carrera',
    Drive: 'Conducción',
    'IA & Coaching': 'IA y coaching',
    Strategy: 'Estrategia',
    Garage: 'Garaje',
    Hardware: 'Hardware',
    System: 'Sistema'
  },
  fr: {
    'Race Hub': 'Centre de course',
    Drive: 'Pilotage',
    'IA & Coaching': 'IA et coaching',
    Strategy: 'Stratégie',
    Garage: 'Garage',
    Hardware: 'Matériel',
    System: 'Système'
  },
  de: {
    'Race Hub': 'Race Hub',
    Drive: 'Fahren',
    'IA & Coaching': 'KI & Coaching',
    Strategy: 'Strategie',
    Garage: 'Garage',
    Hardware: 'Hardware',
    System: 'System'
  },
  zh: {
    'Race Hub': '比赛中心',
    Drive: '驾驶',
    'IA & Coaching': 'AI 与教练',
    Strategy: '策略',
    Garage: '车库',
    Hardware: '硬件',
    System: '系统'
  },
  ja: {
    'Race Hub': 'レースハブ',
    Drive: 'ドライブ',
    'IA & Coaching': 'AI とコーチング',
    Strategy: '戦略',
    Garage: 'ガレージ',
    Hardware: 'ハードウェア',
    System: 'システム'
  }
}

const GROUP_TITLES: Record<ResolvedLanguage, Record<string, string>> = {
  'pt-BR': {},
  en: {
    'Sim Racing': 'Sim Racing',
    ButtonBox: 'ButtonBox',
    App: 'App'
  },
  es: {
    'Sim Racing': 'Sim Racing',
    ButtonBox: 'ButtonBox',
    App: 'App'
  },
  fr: {
    'Sim Racing': 'Sim Racing',
    ButtonBox: 'ButtonBox',
    App: 'App'
  },
  de: {
    'Sim Racing': 'Sim Racing',
    ButtonBox: 'ButtonBox',
    App: 'App'
  },
  zh: {
    'Sim Racing': 'Sim Racing',
    ButtonBox: 'ButtonBox',
    App: 'App'
  },
  ja: {
    'Sim Racing': 'Sim Racing',
    ButtonBox: 'ButtonBox',
    App: 'App'
  }
}

export function translateNavTitle(title: string, language: ResolvedLanguage): string {
  return NAV_TITLES[language][title] ?? title
}

export function translateGroupTitle(title: string, language: ResolvedLanguage): string {
  return GROUP_TITLES[language][title] ?? title
}

export function translateView(view: ViewDef, language: ResolvedLanguage): ViewDef {
  return {
    ...view,
    group: translateGroupTitle(view.group, language),
    ...(VIEW_TEXT[language][view.id] ?? {})
  }
}
