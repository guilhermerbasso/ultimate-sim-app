import {
  APP_THEME_PRESETS,
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type AppThemeTokens
} from '../../../shared/settings'

function normalizeAccent(hex: string): string {
  return /^#[0-9a-f]{6}$/i.test(hex) ? hex : DEFAULT_APP_SETTINGS.accentColor
}

function rgbTuple(hex: string): [number, number, number] {
  const value = Number.parseInt(normalizeAccent(hex).slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function hexToRgb(hex: string): string {
  const [r, g, b] = rgbTuple(hex)
  return `${r}, ${g}, ${b}`
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = rgbTuple(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function lighten(hex: string, amount: number): string {
  const [r, g, b] = rgbTuple(hex)
  const mix = (channel: number): string =>
    Math.round(channel + (255 - channel) * amount)
      .toString(16)
      .padStart(2, '0')
  return `#${mix(r)}${mix(g)}${mix(b)}`
}

function readableTextOn(hex: string): string {
  const [r, g, b] = rgbTuple(hex)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.5 ? '#0a0a0a' : '#f5f1e8'
}

export function getThemeTokens(settings: AppSettings): AppThemeTokens {
  const base = settings.theme === 'custom' ? APP_THEME_PRESETS.midnight : APP_THEME_PRESETS[settings.theme]
  return {
    ...base,
    accent: settings.theme === 'custom' ? normalizeAccent(settings.accentColor) : base.accent
  }
}

export function applyAppTheme(settings: AppSettings): void {
  const root = document.documentElement
  const tokens = getThemeTokens(settings)
  const accent = normalizeAccent(tokens.accent)

  // Resolve post-overhaul surface/text/border tokens, falling back to the
  // legacy preset fields so every theme still themes surfaces even when it
  // does not declare the new tokens explicitly.
  const surfaceCanvas = tokens.surfaceCanvas ?? tokens.bgDeep
  const surfaceBase = tokens.surfaceBase ?? tokens.bg
  const surfaceRaised = tokens.surfaceRaised ?? tokens.panel
  const surfaceOverlay = tokens.surfaceOverlay ?? tokens.panelStrong
  const surfaceSunken = tokens.surfaceSunken ?? tokens.bgDeep
  const surfaceHover = tokens.surfaceHover ?? 'rgba(255, 255, 255, 0.03)'
  const borderSubtle = tokens.borderSubtle ?? tokens.line
  const borderDefault = tokens.borderDefault ?? tokens.line
  const borderStrong = tokens.borderStrong ?? tokens.line
  const textPrimary = tokens.textPrimary ?? tokens.text
  const textSecondary = tokens.textSecondary ?? tokens.muted
  const textMuted = tokens.textMuted ?? tokens.muted
  const warning = tokens.warning ?? '#d4890a'

  // Accent-derived tokens are always computed from the chosen accent so a
  // custom accent re-colours the whole app (CTAs, nav, links, selection...).
  const accentDim = rgba(accent, 0.15)
  const accentBright = lighten(accent, 0.1)

  const set = (name: string, value: string): void => root.style.setProperty(name, value)

  root.dataset.theme = settings.theme

  // ── Glass / modern "feel" tokens ──
  // These drive the optional glassmorphism look (rounded elevated cards, soft
  // shadows, blur, neon glow). Flat themes leave them at their inert defaults
  // so the sharp motorsport look is unchanged.
  const surfaceStyle = tokens.surfaceStyle ?? 'flat'
  const glow = tokens.glow ?? false
  root.dataset.surfaceStyle = surfaceStyle

  if (tokens.radiusSm) set('--radius-sm', tokens.radiusSm)
  if (tokens.radiusMd) set('--radius-md', tokens.radiusMd)
  if (tokens.radiusLg) set('--radius-lg', tokens.radiusLg)
  set('--shadow-card', tokens.shadowCard ?? 'none')
  set('--shadow-raised', tokens.shadowRaised ?? tokens.shadowCard ?? 'none')
  set('--shadow-elevated', tokens.shadowElevated ?? tokens.shadowRaised ?? 'none')
  set('--glass-blur', tokens.glassBlur ?? '0px')
  set('--glass-border', tokens.glassBorder ?? borderDefault)
  set('--glass-tint', tokens.glassTint ?? 'transparent')
  set('--glass-bg', surfaceRaised)
  set('--body-gradient', tokens.bodyGradient ?? 'none')
  set(
    '--glow-accent',
    glow
      ? `0 0 0 1px ${rgba(accent, 0.5)}, 0 0 18px ${rgba(accent, 0.45)}, 0 0 40px ${rgba(accent, 0.2)}`
      : 'none'
  )
  set('--glow-accent-soft', glow ? `0 0 24px ${rgba(accent, 0.22)}` : 'none')
  set('--gradient-accent', `linear-gradient(135deg, ${accentBright}, ${accent})`)

  // ── New token system (consumed by styles/theme.css and the views) ──
  set('--accent-primary', accent)
  set('--accent-primary-dim', accentDim)
  set('--accent-primary-bright', accentBright)
  set('--accent-danger', tokens.danger)
  set('--accent-danger-dim', rgba(tokens.danger, 0.15))
  set('--accent-warning', warning)
  set('--accent-success', tokens.success)

  set('--surface-canvas', surfaceCanvas)
  set('--surface-base', surfaceBase)
  set('--surface-raised', surfaceRaised)
  set('--surface-overlay', surfaceOverlay)
  set('--surface-sunken', surfaceSunken)
  set('--surface-hover', surfaceHover)
  set('--surface-selected', rgba(accent, 0.1))

  set('--border-subtle', borderSubtle)
  set('--border-default', borderDefault)
  set('--border-strong', borderStrong)
  set('--border-accent', accent)

  set('--text-primary', textPrimary)
  set('--text-secondary', textSecondary)
  set('--text-muted', textMuted)
  set('--text-accent', accent)
  set('--text-danger', tokens.danger)
  set('--text-on-accent', readableTextOn(accent))

  set('--focus-ring', `0 0 0 1px ${accent}`)

  // ── Legacy aliases (harmless; kept for anything still reading them) ──
  set('--accent', accent)
  set('--accent-rgb', hexToRgb(accent))
  set('--accent-soft', accentDim)
  set('--accent-border', accent)
  set('--bg', surfaceBase)
  set('--bg-deep', surfaceCanvas)
  set('--panel', surfaceRaised)
  set('--panel-strong', surfaceOverlay)
  set('--text', textPrimary)
  set('--muted', textSecondary)
  set('--line', borderDefault)
  set('--danger', tokens.danger)
  set('--success', tokens.success)
  set('--success-rgb', hexToRgb(tokens.success))
}
