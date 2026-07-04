import type { TelemetrySource } from './telemetry'
import type { TcSensitivity } from './telemetry'

export const APP_TELEMETRY_SOURCES = ['off', 'auto', 'mock', 'iracing', 'acc', 'ac', 'ams2', 'lmu'] as const
export const APP_LANGUAGES = ['auto', 'pt-BR', 'en', 'es', 'fr', 'de'] as const
export const APP_THEMES = [
  'raceRed',
  'amberGt',
  'mono',
  'midnight',
  'graphite',
  'azure',
  'ember',
  'lemans',
  'gulf',
  'synthwave',
  'carbon',
  'championship',
  'martini',
  'verde',
  'ice',
  'auroraGlass',
  'neonNoir',
  'carbonGlow',
  'royalGlass',
  'custom'
] as const

export type AppTelemetrySource = (typeof APP_TELEMETRY_SOURCES)[number]
export type AppLanguage = (typeof APP_LANGUAGES)[number]
export type AppTheme = (typeof APP_THEMES)[number]

export interface AppThemeTokens {
  accent: string
  bg: string
  bgDeep: string
  panel: string
  panelStrong: string
  text: string
  muted: string
  line: string
  danger: string
  success: string
  // Optional post-overhaul design tokens (mirror styles/theme.css :root).
  // When present they are applied verbatim; otherwise applyAppTheme derives
  // them from the legacy fields above. Accent-derived tokens are always
  // computed from `accent`, so a custom accent re-themes the whole app.
  surfaceCanvas?: string
  surfaceBase?: string
  surfaceRaised?: string
  surfaceOverlay?: string
  surfaceSunken?: string
  surfaceHover?: string
  borderSubtle?: string
  borderDefault?: string
  borderStrong?: string
  textPrimary?: string
  textSecondary?: string
  textMuted?: string
  warning?: string
  // ── Glass / modern "feel" tokens (optional) ──
  // Themes that opt into the glassmorphism look declare these so the whole
  // app gains rounded elevated cards, soft layered shadows, blur and neon
  // glow purely through CSS variables. Flat themes omit them and keep the
  // sharp motorsport look. See applyAppTheme + styles/glass.css.
  surfaceStyle?: 'flat' | 'glass'
  radiusSm?: string
  radiusMd?: string
  radiusLg?: string
  shadowCard?: string
  shadowRaised?: string
  shadowElevated?: string
  glassBlur?: string
  glassBorder?: string
  glassTint?: string
  bodyGradient?: string
  glow?: boolean
}

export interface AppSettings {
  autoStart: boolean
  startMinimized: boolean
  // Auto-connect the SIM-X Button Box and activate the rev-lights on app launch
  // (and keep retrying / reconnecting). Default ON.
  autoStartSimX: boolean
  // Auto-connect known generic serial devices flagged `autoConnect` (e.g. the
  // iFlag RGB matrix) on app launch — keep retrying until they appear and
  // reconnect if they drop. Independent of the SIM-X flag. Default ON.
  autoConnectDevices: boolean
  // Clicking the window's close button minimizes to the Windows system tray instead
  // of quitting (quit via the tray menu). Default ON.
  closeToTray: boolean
  // UI language. "auto" follows the OS/browser language exposed by Electron.
  language: AppLanguage
  theme: AppTheme
  accentColor: string
  defaultTelemetrySource: AppTelemetrySource
  // Sensitivity of the DERIVED iRacing TC-active indicator (iRacing exposes no native
  // TC-active var). 'off' disables the derivation (tcActive stays undefined); 'low' only
  // lights on strong wheelspin, 'high' is the most eager. See tcOptionsForSensitivity.
  tcSensitivity: TcSensitivity
}

export const APP_THEME_PRESETS: Record<Exclude<AppTheme, 'custom'>, AppThemeTokens> = {
  raceRed: {
    accent: '#ff3b1f',
    bg: '#050505',
    bgDeep: '#010101',
    panel: 'rgba(18, 14, 12, 0.84)',
    panelStrong: 'rgba(30, 20, 16, 0.94)',
    text: '#fff7ed',
    muted: '#b8aaa0',
    line: 'rgba(255, 133, 73, 0.2)',
    danger: '#ff1744',
    success: '#22c55e'
  },
  amberGt: {
    accent: '#ffb000',
    bg: '#060504',
    bgDeep: '#010101',
    panel: 'rgba(20, 16, 9, 0.84)',
    panelStrong: 'rgba(34, 25, 12, 0.94)',
    text: '#fff8e7',
    muted: '#b8aa8d',
    line: 'rgba(255, 184, 43, 0.2)',
    danger: '#ff2d2d',
    success: '#22c55e'
  },
  mono: {
    accent: '#f5f1e8',
    bg: '#050505',
    bgDeep: '#000000',
    panel: 'rgba(16, 16, 15, 0.86)',
    panelStrong: 'rgba(27, 26, 24, 0.95)',
    text: '#faf7f0',
    muted: '#aaa39a',
    line: 'rgba(245, 241, 232, 0.18)',
    danger: '#ff1744',
    success: '#22c55e'
  },
  midnight: {
    // Carbon Orange — canonical design system, mirrors styles/theme.css :root.
    accent: '#e86920',
    bg: '#0a0a0a',
    bgDeep: '#080808',
    panel: '#111111',
    panelStrong: '#191919',
    text: '#f0ebe0',
    muted: '#8a8a7a',
    line: '#252525',
    danger: '#c41a1a',
    success: '#1a8a3a',
    surfaceCanvas: '#080808',
    surfaceBase: '#0a0a0a',
    surfaceRaised: '#111111',
    surfaceOverlay: '#191919',
    surfaceSunken: '#060606',
    surfaceHover: 'rgba(255, 255, 255, 0.03)',
    borderSubtle: '#161616',
    borderDefault: '#252525',
    borderStrong: '#383838',
    textPrimary: '#f0ebe0',
    textSecondary: '#8a8a7a',
    textMuted: '#555550',
    warning: '#d4890a'
  },
  graphite: {
    accent: '#49c5b1',
    bg: '#0b0d10',
    bgDeep: '#050608',
    panel: 'rgba(24, 27, 31, 0.8)',
    panelStrong: 'rgba(32, 36, 42, 0.94)',
    text: '#f4f1ea',
    muted: '#a09a90',
    line: 'rgba(196, 185, 168, 0.18)',
    danger: '#ff1744',
    success: '#22c55e'
  },
  azure: {
    accent: '#0078d4',
    bg: '#07111c',
    bgDeep: '#03070d',
    panel: 'rgba(12, 27, 43, 0.8)',
    panelStrong: 'rgba(18, 42, 66, 0.94)',
    text: '#f3f8ff',
    muted: '#91a9bf',
    line: 'rgba(87, 150, 207, 0.22)',
    danger: '#ff1744',
    success: '#22c55e'
  },
  ember: {
    accent: '#ff8a3d',
    bg: '#120b08',
    bgDeep: '#070302',
    panel: 'rgba(35, 20, 14, 0.82)',
    panelStrong: 'rgba(48, 27, 18, 0.94)',
    text: '#fff4ec',
    muted: '#b89d8a',
    line: 'rgba(255, 151, 82, 0.2)',
    danger: '#ff1744',
    success: '#22c55e'
  },
  lemans: {
    accent: '#c88a2c',
    bg: '#07110d',
    bgDeep: '#030806',
    panel: '#0d1b15',
    panelStrong: '#14251d',
    text: '#f2efe4',
    muted: '#9aa89d',
    line: '#26382f',
    danger: '#d23a2e',
    success: '#22a45a',
    surfaceCanvas: '#030806',
    surfaceBase: '#07110d',
    surfaceRaised: '#0d1b15',
    surfaceOverlay: '#14251d',
    surfaceSunken: '#020604',
    surfaceHover: 'rgba(200, 138, 44, 0.07)',
    borderSubtle: '#15251e',
    borderDefault: '#26382f',
    borderStrong: '#3a5345',
    textPrimary: '#f2efe4',
    textSecondary: '#9aa89d',
    textMuted: '#65756b',
    warning: '#d49a32'
  },
  gulf: {
    accent: '#ff7a1a',
    bg: '#06151a',
    bgDeep: '#02090d',
    panel: '#0b222a',
    panelStrong: '#12313b',
    text: '#eef8fb',
    muted: '#92afba',
    line: '#24434d',
    danger: '#ff3b30',
    success: '#22a45a',
    surfaceCanvas: '#02090d',
    surfaceBase: '#06151a',
    surfaceRaised: '#0b222a',
    surfaceOverlay: '#12313b',
    surfaceSunken: '#031015',
    surfaceHover: 'rgba(255, 122, 26, 0.07)',
    borderSubtle: '#15323c',
    borderDefault: '#24434d',
    borderStrong: '#38606d',
    textPrimary: '#eef8fb',
    textSecondary: '#92afba',
    textMuted: '#5f7f8a',
    warning: '#d99a24'
  },
  synthwave: {
    accent: '#e04ccf',
    bg: '#10091a',
    bgDeep: '#07030f',
    panel: '#191027',
    panelStrong: '#241634',
    text: '#f6effa',
    muted: '#b6a4c4',
    line: '#3b294f',
    danger: '#ff3b5c',
    success: '#24a85a',
    surfaceCanvas: '#07030f',
    surfaceBase: '#10091a',
    surfaceRaised: '#191027',
    surfaceOverlay: '#241634',
    surfaceSunken: '#0a0612',
    surfaceHover: 'rgba(224, 76, 207, 0.07)',
    borderSubtle: '#271a37',
    borderDefault: '#3b294f',
    borderStrong: '#57406d',
    textPrimary: '#f6effa',
    textSecondary: '#b6a4c4',
    textMuted: '#7d6a8d',
    warning: '#d18a24'
  },
  carbon: {
    accent: '#b6c2cf',
    bg: '#070809',
    bgDeep: '#020303',
    panel: '#101214',
    panelStrong: '#191d21',
    text: '#f1f3f4',
    muted: '#9ca5ad',
    line: '#2a3036',
    danger: '#d63a31',
    success: '#249a52',
    surfaceCanvas: '#020303',
    surfaceBase: '#070809',
    surfaceRaised: '#101214',
    surfaceOverlay: '#191d21',
    surfaceSunken: '#050607',
    surfaceHover: 'rgba(182, 194, 207, 0.06)',
    borderSubtle: '#181c20',
    borderDefault: '#2a3036',
    borderStrong: '#424b54',
    textPrimary: '#f1f3f4',
    textSecondary: '#9ca5ad',
    textMuted: '#69737c',
    warning: '#cf8d1f'
  },
  championship: {
    accent: '#d6a13a',
    bg: '#0d0a06',
    bgDeep: '#050301',
    panel: '#171209',
    panelStrong: '#241b0d',
    text: '#f7f0df',
    muted: '#b2a37d',
    line: '#3a2d16',
    danger: '#d6312b',
    success: '#229a50',
    surfaceCanvas: '#050301',
    surfaceBase: '#0d0a06',
    surfaceRaised: '#171209',
    surfaceOverlay: '#241b0d',
    surfaceSunken: '#080501',
    surfaceHover: 'rgba(214, 161, 58, 0.08)',
    borderSubtle: '#241b0d',
    borderDefault: '#3a2d16',
    borderStrong: '#5b461f',
    textPrimary: '#f7f0df',
    textSecondary: '#b2a37d',
    textMuted: '#756846',
    warning: '#e0a128'
  },
  martini: {
    accent: '#e5333f',
    bg: '#070b12',
    bgDeep: '#03060a',
    panel: '#101722',
    panelStrong: '#172235',
    text: '#f0f4fb',
    muted: '#9ba9bf',
    line: '#2a3952',
    danger: '#e5333f',
    success: '#23a052',
    surfaceCanvas: '#03060a',
    surfaceBase: '#070b12',
    surfaceRaised: '#101722',
    surfaceOverlay: '#172235',
    surfaceSunken: '#05080e',
    surfaceHover: 'rgba(229, 51, 63, 0.07)',
    borderSubtle: '#1a2638',
    borderDefault: '#2a3952',
    borderStrong: '#455a7c',
    textPrimary: '#f0f4fb',
    textSecondary: '#9ba9bf',
    textMuted: '#68768e',
    warning: '#d69528'
  },
  verde: {
    accent: '#9bdc28',
    bg: '#071008',
    bgDeep: '#030603',
    panel: '#0d1a0f',
    panelStrong: '#142516',
    text: '#f0f6e8',
    muted: '#9cad91',
    line: '#283a25',
    danger: '#d6362f',
    success: '#22a45a',
    surfaceCanvas: '#030603',
    surfaceBase: '#071008',
    surfaceRaised: '#0d1a0f',
    surfaceOverlay: '#142516',
    surfaceSunken: '#040904',
    surfaceHover: 'rgba(155, 220, 40, 0.07)',
    borderSubtle: '#172416',
    borderDefault: '#283a25',
    borderStrong: '#435d38',
    textPrimary: '#f0f6e8',
    textSecondary: '#9cad91',
    textMuted: '#68775f',
    warning: '#d59a20'
  },
  ice: {
    accent: '#55c7e8',
    bg: '#071016',
    bgDeep: '#02070b',
    panel: '#0d1a23',
    panelStrong: '#152631',
    text: '#edf6fa',
    muted: '#9cafba',
    line: '#273d49',
    danger: '#dc3a32',
    success: '#22a45a',
    surfaceCanvas: '#02070b',
    surfaceBase: '#071016',
    surfaceRaised: '#0d1a23',
    surfaceOverlay: '#152631',
    surfaceSunken: '#040b10',
    surfaceHover: 'rgba(85, 199, 232, 0.07)',
    borderSubtle: '#172832',
    borderDefault: '#273d49',
    borderStrong: '#42616f',
    textPrimary: '#edf6fa',
    textSecondary: '#9cafba',
    textMuted: '#687c88',
    warning: '#d49128'
  },
  auroraGlass: {
    // PRINCIPAL modern glass theme — deep navy, elevated rounded glass cards,
    // soft layered shadows, subtle gradients, warm coral neon accent + glow.
    accent: '#ff6a3d',
    bg: '#0b1022',
    bgDeep: '#070a16',
    panel: 'rgba(24, 32, 58, 0.66)',
    panelStrong: 'rgba(30, 40, 72, 0.86)',
    text: '#eef2ff',
    muted: '#aeb8d4',
    line: 'rgba(140, 165, 220, 0.16)',
    danger: '#ff4d6a',
    success: '#2fd089',
    surfaceCanvas: '#070a16',
    surfaceBase: '#0b1022',
    surfaceRaised: 'rgba(24, 32, 58, 0.66)',
    surfaceOverlay: 'rgba(30, 40, 72, 0.86)',
    surfaceSunken: 'rgba(8, 12, 26, 0.6)',
    surfaceHover: 'rgba(255, 255, 255, 0.05)',
    borderSubtle: 'rgba(140, 165, 220, 0.10)',
    borderDefault: 'rgba(140, 165, 220, 0.16)',
    borderStrong: 'rgba(150, 175, 230, 0.30)',
    textPrimary: '#eef2ff',
    textSecondary: '#aeb8d4',
    textMuted: '#6f7aa0',
    warning: '#ffb02e',
    surfaceStyle: 'glass',
    radiusSm: '8px',
    radiusMd: '14px',
    radiusLg: '22px',
    shadowCard: '0 8px 24px rgba(4, 8, 22, 0.55)',
    shadowRaised: '0 18px 48px rgba(3, 6, 20, 0.6)',
    shadowElevated: '0 30px 80px rgba(2, 4, 16, 0.7)',
    glassBlur: '18px',
    glassBorder: 'rgba(160, 185, 240, 0.22)',
    glassTint:
      'linear-gradient(150deg, rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0.012) 42%, rgba(120, 140, 200, 0.04))',
    bodyGradient:
      'radial-gradient(circle at 12% 8%, rgba(255, 106, 61, 0.10), transparent 42%), radial-gradient(circle at 88% 0%, rgba(86, 112, 210, 0.16), transparent 45%), radial-gradient(circle at 50% 120%, rgba(60, 90, 180, 0.14), transparent 55%), linear-gradient(165deg, #0c1124 0%, #070a16 60%, #05070f 100%)',
    glow: true
  },
  neonNoir: {
    // Near-black charcoal glass with a hot warm-red neon accent.
    accent: '#ff2e46',
    bg: '#0a0a0d',
    bgDeep: '#050506',
    panel: 'rgba(20, 20, 26, 0.7)',
    panelStrong: 'rgba(28, 28, 36, 0.88)',
    text: '#f4f4f8',
    muted: '#a0a0b0',
    line: 'rgba(255, 255, 255, 0.10)',
    danger: '#ff1744',
    success: '#22c55e',
    surfaceCanvas: '#050506',
    surfaceBase: '#0a0a0d',
    surfaceRaised: 'rgba(20, 20, 26, 0.7)',
    surfaceOverlay: 'rgba(28, 28, 36, 0.88)',
    surfaceSunken: 'rgba(6, 6, 9, 0.6)',
    surfaceHover: 'rgba(255, 255, 255, 0.05)',
    borderSubtle: 'rgba(255, 255, 255, 0.07)',
    borderDefault: 'rgba(255, 255, 255, 0.12)',
    borderStrong: 'rgba(255, 255, 255, 0.22)',
    textPrimary: '#f4f4f8',
    textSecondary: '#a0a0b0',
    textMuted: '#666674',
    warning: '#ff9d2f',
    surfaceStyle: 'glass',
    radiusSm: '8px',
    radiusMd: '14px',
    radiusLg: '22px',
    shadowCard: '0 8px 24px rgba(0, 0, 0, 0.6)',
    shadowRaised: '0 18px 48px rgba(0, 0, 0, 0.66)',
    shadowElevated: '0 30px 80px rgba(0, 0, 0, 0.74)',
    glassBlur: '16px',
    glassBorder: 'rgba(255, 255, 255, 0.16)',
    glassTint:
      'linear-gradient(150deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.01) 45%, rgba(255, 46, 70, 0.03))',
    bodyGradient:
      'radial-gradient(circle at 85% 10%, rgba(255, 46, 70, 0.16), transparent 40%), radial-gradient(circle at 10% 90%, rgba(255, 90, 40, 0.10), transparent 45%), linear-gradient(160deg, #0c0c10 0%, #060608 70%, #040405 100%)',
    glow: true
  },
  carbonGlow: {
    // Graphite carbon glass with an amber/orange glow.
    accent: '#ff9d2f',
    bg: '#0e1115',
    bgDeep: '#0a0c0e',
    panel: 'rgba(22, 26, 31, 0.7)',
    panelStrong: 'rgba(30, 35, 41, 0.88)',
    text: '#eef1f4',
    muted: '#9aa4ae',
    line: 'rgba(180, 196, 210, 0.14)',
    danger: '#e0483b',
    success: '#33c06a',
    surfaceCanvas: '#0a0c0e',
    surfaceBase: '#0e1115',
    surfaceRaised: 'rgba(22, 26, 31, 0.7)',
    surfaceOverlay: 'rgba(30, 35, 41, 0.88)',
    surfaceSunken: 'rgba(7, 9, 11, 0.6)',
    surfaceHover: 'rgba(255, 255, 255, 0.04)',
    borderSubtle: 'rgba(180, 196, 210, 0.09)',
    borderDefault: 'rgba(180, 196, 210, 0.14)',
    borderStrong: 'rgba(190, 206, 220, 0.26)',
    textPrimary: '#eef1f4',
    textSecondary: '#9aa4ae',
    textMuted: '#646e78',
    warning: '#ffb02e',
    surfaceStyle: 'glass',
    radiusSm: '7px',
    radiusMd: '12px',
    radiusLg: '20px',
    shadowCard: '0 8px 24px rgba(2, 4, 6, 0.55)',
    shadowRaised: '0 18px 44px rgba(1, 2, 4, 0.62)',
    shadowElevated: '0 28px 72px rgba(0, 1, 2, 0.7)',
    glassBlur: '16px',
    glassBorder: 'rgba(200, 214, 228, 0.18)',
    glassTint:
      'linear-gradient(150deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.01) 45%, rgba(255, 157, 47, 0.03))',
    bodyGradient:
      'radial-gradient(circle at 15% 12%, rgba(255, 157, 47, 0.12), transparent 42%), radial-gradient(circle at 90% 85%, rgba(255, 120, 40, 0.10), transparent 45%), linear-gradient(165deg, #11151a 0%, #0a0c10 70%, #07090c 100%)',
    glow: true
  },
  royalGlass: {
    // Deep indigo/violet glass with a warm gold accent.
    accent: '#f5b53d',
    bg: '#120c26',
    bgDeep: '#0a0716',
    panel: 'rgba(34, 24, 60, 0.66)',
    panelStrong: 'rgba(44, 32, 74, 0.86)',
    text: '#f3eeff',
    muted: '#bcaedb',
    line: 'rgba(170, 140, 230, 0.16)',
    danger: '#ff4d6a',
    success: '#3ad29a',
    surfaceCanvas: '#0a0716',
    surfaceBase: '#120c26',
    surfaceRaised: 'rgba(34, 24, 60, 0.66)',
    surfaceOverlay: 'rgba(44, 32, 74, 0.86)',
    surfaceSunken: 'rgba(10, 7, 22, 0.6)',
    surfaceHover: 'rgba(255, 255, 255, 0.05)',
    borderSubtle: 'rgba(170, 140, 230, 0.10)',
    borderDefault: 'rgba(170, 140, 230, 0.16)',
    borderStrong: 'rgba(180, 150, 235, 0.30)',
    textPrimary: '#f3eeff',
    textSecondary: '#bcaedb',
    textMuted: '#7c6ca0',
    warning: '#f5b53d',
    surfaceStyle: 'glass',
    radiusSm: '8px',
    radiusMd: '14px',
    radiusLg: '22px',
    shadowCard: '0 8px 24px rgba(8, 4, 22, 0.55)',
    shadowRaised: '0 18px 48px rgba(6, 3, 18, 0.62)',
    shadowElevated: '0 30px 80px rgba(4, 2, 14, 0.72)',
    glassBlur: '18px',
    glassBorder: 'rgba(190, 160, 245, 0.22)',
    glassTint:
      'linear-gradient(150deg, rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0.012) 42%, rgba(150, 110, 230, 0.04))',
    bodyGradient:
      'radial-gradient(circle at 20% 8%, rgba(245, 181, 61, 0.10), transparent 40%), radial-gradient(circle at 85% 10%, rgba(150, 80, 230, 0.20), transparent 45%), radial-gradient(circle at 50% 120%, rgba(110, 60, 200, 0.16), transparent 55%), linear-gradient(165deg, #160e2e 0%, #0c0820 65%, #080514 100%)',
    glow: true
  }
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  autoStart: false,
  startMinimized: false,
  autoStartSimX: true,
  autoConnectDevices: true,
  closeToTray: true,
  language: 'auto',
  theme: 'midnight',
  accentColor: APP_THEME_PRESETS.midnight.accent,
  defaultTelemetrySource: 'off',
  tcSensitivity: 'medium'
}

export function isAppTelemetrySource(value: unknown): value is AppTelemetrySource {
  return APP_TELEMETRY_SOURCES.includes(value as AppTelemetrySource)
}

export function isAppLanguage(value: unknown): value is AppLanguage {
  return APP_LANGUAGES.includes(value as AppLanguage)
}

export function isAppTheme(value: unknown): value is AppTheme {
  return APP_THEMES.includes(value as AppTheme)
}

export function toTelemetrySource(value: AppTelemetrySource): TelemetrySource {
  return value
}

// Re-exported so the settings UI builds the TC-sensitivity control from one import.
export { TC_SENSITIVITIES, isTcSensitivity, type TcSensitivity } from './telemetry'
