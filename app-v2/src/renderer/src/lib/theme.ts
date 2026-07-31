import {
  APP_THEME_PRESETS,
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type AppThemeTokens
} from '../../../shared/settings'
import {
  contrastRatio,
  ensureContrast,
  lightest,
  mix,
  parseColor,
  toHex,
  WCAG_NON_TEXT_MIN,
  WCAG_TEXT_MIN,
  type Rgb
} from '../../../shared/color-contrast'

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
  const blend = (channel: number): string =>
    Math.round(channel + (255 - channel) * amount)
      .toString(16)
      .padStart(2, '0')
  return `#${blend(r)}${blend(g)}${blend(b)}`
}

const ON_ACCENT_INKS = ['#0a0a0a', '#f5f1e8'] as const

/** Resolves a declared token to sRGB, compositing any alpha over `backdrop`. */
function solid(value: string, backdrop: Rgb): Rgb {
  return parseColor(value, backdrop) ?? backdrop
}

/**
 * Label colour for text painted on a solid accent, danger or success fill.
 *
 * One token serves all three fills, so it picks the ink with the best WORST
 * case across them. The previous YIQ split (0.299/0.587/0.114 > 0.5) is a
 * perceived-brightness heuristic, not a contrast measure, and chose near-black
 * for mid-tone accents that then failed 4.5:1.
 */
function readableTextOn(fills: readonly Rgb[]): string {
  let best: string = ON_ACCENT_INKS[0]
  let bestWorst = -1
  for (const ink of ON_ACCENT_INKS) {
    const inkRgb = parseColor(ink) as Rgb
    const worst = Math.min(...fills.map((fill) => contrastRatio(inkRgb, fill)))
    if (worst > bestWorst) {
      bestWorst = worst
      best = ink
    }
  }
  return best
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
  const textDanger = tokens.textDanger ?? tokens.danger
  const warning = tokens.warning ?? '#d4890a'

  // ── WCAG 2.2 AA enforcement ──
  // Nineteen presets and a free-form custom accent feed this function, so
  // legibility cannot be a property of one hand-tuned palette. Every ink and
  // every control boundary is measured against the LIGHTEST surface it can be
  // drawn on — the worst case for light-on-dark — and nudged toward white or
  // black only as far as the threshold needs. A palette already clear of the
  // line is returned untouched, so a compliant theme renders exactly as its
  // author wrote it.
  const canvasRgb = solid(surfaceCanvas, [0, 0, 0])
  const baseRgb = solid(surfaceBase, canvasRgb)
  const raisedRgb = solid(surfaceRaised, baseRgb)
  const overlayRgb = solid(surfaceOverlay, baseRgb)
  const sunkenRgb = solid(surfaceSunken, baseRgb)
  const worstSurface = lightest([canvasRgb, baseRgb, raisedRgb, overlayRgb, sunkenRgb])

  const readable = (value: string, min: number): string =>
    toHex(ensureContrast(solid(value, worstSurface), worstSurface, min))

  /** The 15%-opacity wash of `fill` that status pills and dim buttons paint. */
  const tintOf = (fill: string): Rgb => mix(worstSurface, solid(fill, worstSurface), 0.15)

  /**
   * Ink that has to be legible both on the bare surface and on its own dim
   * wash — a tint made FROM the ink is the lightest background it ever meets,
   * so clearing the surface alone is not enough. Iterated because lifting the
   * ink also lifts the wash.
   */
  const readableOverOwnTint = (value: string, min: number): string => {
    let current = solid(value, worstSurface)
    for (let pass = 0; pass < 8; pass += 1) {
      const next = ensureContrast(
        ensureContrast(current, worstSurface, min),
        mix(worstSurface, current, 0.15),
        min
      )
      if (toHex(next) === toHex(current)) break
      current = next
    }
    return toHex(current)
  }

  const accentReadable = readableOverOwnTint(accent, WCAG_TEXT_MIN)
  const dangerFill = readable(tokens.danger, WCAG_TEXT_MIN)
  const successFill = readableOverOwnTint(tokens.success, WCAG_TEXT_MIN)
  const warningReadable = readableOverOwnTint(warning, WCAG_TEXT_MIN)

  // Body copy also lands on the hover and selection washes, which sit ON TOP of
  // the lightest surface and are therefore lighter still. Measuring the inks
  // against the bare surface would pass rows that are unreadable once
  // highlighted, which is exactly where a keyboard user spends their time.
  const worstTextBackground = lightest([
    worstSurface,
    solid(surfaceHover, worstSurface),
    mix(worstSurface, solid(accentReadable, worstSurface), 0.1)
  ])
  const onText = (value: string, min: number): string =>
    toHex(ensureContrast(solid(value, worstTextBackground), worstTextBackground, min))

  const dangerInk = toHex(
    ensureContrast(
      ensureContrast(solid(textDanger, worstTextBackground), worstTextBackground, WCAG_TEXT_MIN),
      tintOf(dangerFill),
      WCAG_TEXT_MIN
    )
  )
  const primaryInk = onText(textPrimary, WCAG_TEXT_MIN)
  const secondaryInk = onText(textSecondary, WCAG_TEXT_MIN)
  // Muted must clear the threshold AND stay a step below secondary, otherwise
  // lifting it to 4.5:1 quietly merges the two tiers of the type hierarchy.
  const mutedInk = onText(textMuted, WCAG_TEXT_MIN)
  const secondaryLifted =
    contrastRatio(solid(secondaryInk, worstTextBackground), solid(mutedInk, worstTextBackground)) >= 1.3
      ? secondaryInk
      : toHex(
          ensureContrast(
            solid(secondaryInk, worstTextBackground),
            solid(mutedInk, worstTextBackground),
            1.3
          )
        )

  const defaultEdge = toHex(
    ensureContrast(solid(borderDefault, worstSurface), worstSurface, WCAG_NON_TEXT_MIN)
  )
  const strongEdgeBase = toHex(
    ensureContrast(solid(borderStrong, worstSurface), worstSurface, WCAG_NON_TEXT_MIN)
  )
  // "Strong" has to keep reading as stronger than "default" after both are lifted.
  const strongEdge =
    contrastRatio(solid(strongEdgeBase, worstSurface), worstSurface) >
    contrastRatio(solid(defaultEdge, worstSurface), worstSurface)
      ? strongEdgeBase
      : toHex(mix(solid(defaultEdge, worstSurface), [255, 255, 255], 0.2))

  // Accent-derived tokens are always computed from the chosen accent so a
  // custom accent re-colours the whole app (CTAs, nav, links, selection...).
  const accentDim = rgba(accentReadable, 0.15)
  const accentBright = lighten(accentReadable, 0.1)
  const onAccent = readableTextOn([
    solid(accentReadable, worstSurface),
    solid(accentBright, worstSurface),
    solid(dangerFill, worstSurface),
    solid(successFill, worstSurface)
  ])

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
  set('--glass-border', tokens.glassBorder ?? defaultEdge)
  set('--glass-tint', tokens.glassTint ?? 'transparent')
  set('--glass-bg', surfaceRaised)
  set('--body-gradient', tokens.bodyGradient ?? 'none')
  set(
    '--glow-accent',
    glow
      ? `0 0 0 1px ${rgba(accentReadable, 0.5)}, 0 0 18px ${rgba(accentReadable, 0.45)}, 0 0 40px ${rgba(accentReadable, 0.2)}`
      : 'none'
  )
  set('--glow-accent-soft', glow ? `0 0 24px ${rgba(accentReadable, 0.22)}` : 'none')
  set('--gradient-accent', `linear-gradient(135deg, ${accentBright}, ${accentReadable})`)

  // ── New token system (consumed by styles/theme.css and the views) ──
  set('--accent-primary', accentReadable)
  set('--accent-primary-dim', accentDim)
  set('--accent-primary-bright', accentBright)
  set('--accent-danger', dangerFill)
  set('--accent-danger-dim', rgba(dangerFill, 0.15))
  set('--accent-warning', warningReadable)
  set('--accent-success', successFill)

  set('--surface-canvas', surfaceCanvas)
  set('--surface-base', surfaceBase)
  set('--surface-raised', surfaceRaised)
  set('--surface-overlay', surfaceOverlay)
  set('--surface-sunken', surfaceSunken)
  set('--surface-hover', surfaceHover)
  set('--surface-selected', rgba(accentReadable, 0.1))

  set('--border-subtle', borderSubtle)
  set('--border-default', defaultEdge)
  set('--border-strong', strongEdge)
  set('--border-accent', accentReadable)

  set('--text-primary', primaryInk)
  set('--text-secondary', secondaryLifted)
  set('--text-muted', mutedInk)
  set('--text-accent', accentReadable)
  set('--text-danger', dangerInk)
  set('--text-on-accent', onAccent)

  set('--focus-ring', `0 0 0 1px ${accentReadable}`)

  // ── Legacy aliases (harmless; kept for anything still reading them) ──
  set('--accent', accentReadable)
  set('--accent-rgb', hexToRgb(accentReadable))
  set('--accent-soft', accentDim)
  set('--accent-border', accentReadable)
  set('--bg', surfaceBase)
  set('--bg-deep', surfaceCanvas)
  set('--panel', surfaceRaised)
  set('--panel-strong', surfaceOverlay)
  set('--text', primaryInk)
  set('--muted', secondaryLifted)
  set('--line', defaultEdge)
  set('--danger', dangerFill)
  set('--success', successFill)
  set('--success-rgb', hexToRgb(successFill))
  // Tint bases for `rgba(var(--*-rgb), a)` backgrounds. Without these the
  // stylesheet's midnight values survive a theme switch, so status pills keep
  // painting a red or amber wash that no longer matches their own text.
  set('--danger-rgb', hexToRgb(dangerFill))
  set('--warning-rgb', hexToRgb(warningReadable))
}
