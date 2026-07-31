import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_THEME_PRESETS, DEFAULT_APP_SETTINGS, type AppTheme } from '../../../shared/settings'
import { applyAppTheme } from '../lib/theme'
import { contrastRatio, readRootTokens, resolveColor, type Rgb } from './contrast'

/**
 * WCAG 2.2 AA — 1.4.3 Contrast (Minimum) and 1.4.11 Non-text Contrast.
 *
 * The failure this guards against was measured, not guessed: `--text-muted` on
 * `--surface-overlay` computed to 4.06:1 from the stylesheet and 2.52:1 from the
 * default runtime theme, both below the 4.5:1 normal text needs. Fixing the two
 * hex literals was easy; keeping them fixed is the hard part, because every new
 * surface or state colour is one literal away from dropping back under the line.
 *
 * So this reads the real token definitions — the `:root` block the app ships in
 * theme.css, and the custom properties `applyAppTheme` actually writes onto the
 * document for every selectable theme — resolves `var()` indirection, composites
 * `rgba()` tints over the surface behind them, and computes the ratio for every
 * foreground/background pairing the app shell puts on screen. Each pairing
 * carries the rule that proves it is reachable, so the table cannot drift into
 * asserting combinations nobody renders.
 *
 * What this does NOT prove: that a screen reader announces anything, or that the
 * dashboard/overlay widget palettes (`--rc*`, `--rd*`, `--gt3-*`) are compliant.
 * Those are per-widget artistic palettes outside this token system.
 */

const THEME_CSS = join(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'theme.css')
const stylesheetTokens = readRootTokens(readFileSync(THEME_CSS, 'utf8'))

interface Pair {
  fg: string
  bg: string
  /** Opaque surface a translucent `bg` is painted over. */
  backdrop?: string
  /** 4.5 for normal text (1.4.3), 3 for non-text UI components (1.4.11). */
  min: 4.5 | 3
  /** The rule that puts this combination on screen. */
  evidence: string
}

const PAIRS: readonly Pair[] = [
  // Primary body copy over every opaque surface in the shell.
  { fg: '--text-primary', bg: '--surface-canvas', min: 4.5, evidence: 'theme.css body' },
  { fg: '--text-primary', bg: '--surface-base', min: 4.5, evidence: 'theme.css .content-panel' },
  { fg: '--text-primary', bg: '--surface-raised', min: 4.5, evidence: 'theme.css .sidebar/.panel-card' },
  { fg: '--text-primary', bg: '--surface-overlay', min: 4.5, evidence: 'theme.css .cmdk-panel/.toast' },
  { fg: '--text-primary', bg: '--surface-sunken', min: 4.5, evidence: 'theme.css .text-field' },
  { fg: '--text-primary', bg: '--surface-hover', backdrop: '--surface-raised', min: 4.5, evidence: 'ui.css .ui-segmented__item:hover' },

  // Secondary copy.
  { fg: '--text-secondary', bg: '--surface-canvas', min: 4.5, evidence: 'inherited over body' },
  { fg: '--text-secondary', bg: '--surface-base', min: 4.5, evidence: 'theme.css .chip-toggle/.segment' },
  { fg: '--text-secondary', bg: '--surface-raised', min: 4.5, evidence: 'theme.css .device-status-banner p' },
  { fg: '--text-secondary', bg: '--surface-overlay', min: 4.5, evidence: 'ui.css modal surface copy' },
  { fg: '--text-secondary', bg: '--surface-sunken', min: 4.5, evidence: 'theme.css .nav-search' },
  { fg: '--text-secondary', bg: '--surface-selected', backdrop: '--surface-raised', min: 4.5, evidence: 'theme.css .port-item.is-selected' },
  { fg: '--text-secondary', bg: 'rgba(255, 255, 255, 0.06)', backdrop: '--surface-raised', min: 4.5, evidence: 'theme.css .telemetry-chip/.conn-pill' },

  // Muted copy — the token the audit measured at 4.06:1 on --surface-overlay.
  { fg: '--text-muted', bg: '--surface-canvas', min: 4.5, evidence: 'body-level muted copy' },
  { fg: '--text-muted', bg: '--surface-base', min: 4.5, evidence: 'theme.css .sidebar-card p/.field-label' },
  { fg: '--text-muted', bg: '--surface-raised', min: 4.5, evidence: 'theme.css .nav-group-label/.mapping-head' },
  { fg: '--text-muted', bg: '--surface-overlay', min: 4.5, evidence: 'theme.css .cmdk-item-tag/.cmdk-empty' },
  { fg: '--text-muted', bg: '--surface-sunken', min: 4.5, evidence: 'theme.css .nav-search kbd' },
  { fg: '--text-muted', bg: '--surface-hover', backdrop: '--surface-raised', min: 4.5, evidence: 'theme.css .mapping-row:hover' },
  { fg: '--text-muted', bg: '--surface-selected', backdrop: '--surface-raised', min: 4.5, evidence: 'theme.css .cmdk-item.is-highlight' },

  // Error copy, including the tinted pills it sits in.
  { fg: '--text-danger', bg: '--surface-base', min: 4.5, evidence: 'theme.css error copy' },
  { fg: '--text-danger', bg: '--surface-raised', min: 4.5, evidence: 'onboarding.css error copy' },
  { fg: '--text-danger', bg: '--surface-overlay', min: 4.5, evidence: 'error copy inside modals' },
  { fg: '--text-danger', bg: 'rgba(var(--danger-rgb), 0.15)', backdrop: '--surface-raised', min: 4.5, evidence: 'theme.css .conn-pill.offline' },
  { fg: '--text-danger', bg: '--accent-danger-dim', backdrop: '--surface-raised', min: 4.5, evidence: 'theme.css .ghost-action.danger:hover' },

  // Status colours used as text through the --danger/--success aliases.
  { fg: '--accent-danger', bg: '--surface-base', min: 4.5, evidence: 'rig-preflight.css color: var(--danger)' },
  { fg: '--accent-danger', bg: '--surface-raised', min: 4.5, evidence: 'accessibility-cues.css color: var(--danger)' },
  { fg: '--accent-success', bg: '--surface-base', min: 4.5, evidence: 'rig-preflight.css color: var(--success)' },
  { fg: '--accent-success', bg: '--surface-raised', min: 4.5, evidence: 'steward-desk.css/.telemetry-chip.is-online' },
  { fg: '--accent-success', bg: '--surface-overlay', min: 4.5, evidence: 'status copy inside toasts' },
  { fg: '--accent-success', bg: 'rgba(var(--success-rgb), 0.15)', backdrop: '--surface-raised', min: 4.5, evidence: 'theme.css .telemetry-chip.is-online' },
  { fg: '--accent-success', bg: 'rgba(var(--success-rgb), 0.10)', backdrop: '--surface-raised', min: 4.5, evidence: 'theme.css .notice-card.success' },
  { fg: '--accent-warning', bg: '--surface-base', min: 4.5, evidence: 'warning copy on the content panel' },
  { fg: '--accent-warning', bg: '--surface-raised', min: 4.5, evidence: 'theme.css .notice-card.warning' },
  { fg: '--accent-warning', bg: '--surface-overlay', min: 4.5, evidence: 'warning copy inside toasts' },
  { fg: '--accent-warning', bg: 'rgba(var(--warning-rgb), 0.08)', backdrop: '--surface-raised', min: 4.5, evidence: 'theme.css .notice-card.warning' },

  // Accent used as link/label text.
  { fg: '--accent-primary', bg: '--surface-canvas', min: 4.5, evidence: 'theme.css .payload-preview' },
  { fg: '--accent-primary', bg: '--surface-base', min: 4.5, evidence: 'accent copy on the content panel' },
  { fg: '--accent-primary', bg: '--surface-raised', min: 4.5, evidence: 'navigation.css .nav-quick-count' },
  { fg: '--accent-primary', bg: '--surface-overlay', min: 4.5, evidence: 'theme.css .cmdk-input-icon' },
  { fg: '--accent-primary', bg: '--surface-sunken', min: 4.5, evidence: 'accent copy inside wells' },
  { fg: '--accent-primary', bg: '--accent-primary-dim', backdrop: '--surface-raised', min: 4.5, evidence: 'navigation.css .nav-pin.is-pinned' },
  { fg: '--accent-primary', bg: '--surface-hover', backdrop: '--surface-raised', min: 4.5, evidence: 'navigation.css .nav-pin:hover' },
  { fg: '--accent-primary', bg: '--surface-selected', backdrop: '--surface-raised', min: 4.5, evidence: 'theme.css .port-item.is-selected' },

  // Text painted on a solid accent fill.
  { fg: '--text-on-accent', bg: '--accent-primary', min: 4.5, evidence: 'theme.css .primary-action' },
  { fg: '--text-on-accent', bg: '--accent-primary-bright', min: 4.5, evidence: 'theme.css .primary-action:hover' },
  { fg: '--text-on-accent', bg: '--accent-danger', min: 4.5, evidence: 'HapticsView/SoundsView destructive buttons' },
  { fg: '--text-on-accent', bg: '--accent-success', min: 4.5, evidence: 'VoiceSettingsView default-voice button' },

  // SC 1.4.11 — non-text. Control boundaries and state indicators.
  { fg: '--border-default', bg: '--surface-base', min: 3, evidence: 'theme.css .text-field/.select-field boundary' },
  { fg: '--border-default', bg: '--surface-raised', min: 3, evidence: 'theme.css .nav-search boundary on the sidebar' },
  { fg: '--border-default', bg: '--surface-sunken', min: 3, evidence: 'theme.css .nav-search fill against its own border' },
  { fg: '--border-strong', bg: '--surface-base', min: 3, evidence: 'theme.css .segmented boundary' },
  { fg: '--border-strong', bg: '--surface-raised', min: 3, evidence: 'theme.css .keyboard-capture-banner' },
  { fg: '--border-strong', bg: '--surface-overlay', min: 3, evidence: 'theme.css .cmdk-panel' },
  { fg: '--accent-primary', bg: '--surface-base', min: 3, evidence: '--focus-ring on the content panel' },
  { fg: '--accent-primary', bg: '--surface-raised', min: 3, evidence: '--border-accent on active nav rows' },
  { fg: '--accent-danger', bg: '--surface-raised', min: 3, evidence: 'theme.css .status-dot offline' },
  { fg: '--accent-success', bg: '--surface-raised', min: 3, evidence: 'theme.css .sidebar-card.is-online .status-dot' },
  { fg: '--accent-warning', bg: '--surface-raised', min: 3, evidence: 'theme.css .keyboard-capture-banner edge' }
]

/**
 * Deliberately outside the matrix, with the reason. Anything not listed here and
 * not in PAIRS is simply a combination the shell does not render.
 */
const EXEMPT: readonly { token: string; reason: string }[] = [
  {
    token: '--border-subtle',
    reason:
      'Decorative hairline between two same-level surfaces (.nav-divider, the .content-header bottom ' +
      'edge, .cmdk-input-row). It never draws the boundary of a control, so SC 1.4.11 does not apply.'
  }
]

function failures(tokens: ReadonlyMap<string, string>): string[] {
  return PAIRS.map((pair) => {
    const backdrop: Rgb = pair.backdrop ? resolveColor(tokens, pair.backdrop) : [0, 0, 0]
    const background = resolveColor(tokens, pair.bg, backdrop)
    const ratio = contrastRatio(resolveColor(tokens, pair.fg, background), background)
    return { pair, ratio }
  })
    .filter(({ pair, ratio }) => ratio < pair.min)
    .map(
      ({ pair, ratio }) =>
        `${pair.fg} on ${pair.bg}${pair.backdrop ? ` over ${pair.backdrop}` : ''}: ` +
        `${ratio.toFixed(2)}:1 < ${pair.min}:1 — ${pair.evidence}`
    )
}

/**
 * The custom properties `applyAppTheme` really writes for `theme`, captured by
 * running it against a stub document. Reading the shipped function rather than
 * re-deriving its rules means the guard cannot drift from real behaviour.
 */
function runtimeTokens(theme: Exclude<AppTheme, 'custom'>): Map<string, string> {
  const applied = new Map<string, string>()
  const stub = {
    documentElement: {
      style: { setProperty: (name: string, value: string): void => void applied.set(name, value) },
      dataset: {} as Record<string, string>
    }
  }
  const owner = globalThis as { document?: unknown }
  const original = owner.document
  owner.document = stub
  try {
    applyAppTheme({ ...DEFAULT_APP_SETTINGS, theme })
  } finally {
    owner.document = original
  }
  return applied
}

const SELECTABLE = Object.keys(APP_THEME_PRESETS) as Exclude<AppTheme, 'custom'>[]

describe('design token contrast (WCAG 2.2 AA)', () => {
  it('reads real token definitions out of theme.css', () => {
    expect(stylesheetTokens.get('--text-muted')).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(stylesheetTokens.get('--surface-overlay')).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(PAIRS.length).toBeGreaterThanOrEqual(59)
    expect(SELECTABLE.length).toBeGreaterThanOrEqual(10)
  })

  it('computes the WCAG formula correctly on known values', () => {
    // Anchors from the specification: identical colours are 1:1, black on white 21:1.
    expect(contrastRatio([0, 0, 0], [0, 0, 0])).toBeCloseTo(1, 5)
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5)
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5)
    // The composited case: 15% orange over #111111 is a dark brown, not orange.
    expect(
      resolveColor(
        stylesheetTokens,
        '--accent-primary-dim',
        resolveColor(stylesheetTokens, '--surface-raised')
      )
    ).toEqual([49, 31, 20])
  })

  it('holds every stylesheet pair at or above its threshold', () => {
    const broken = failures(stylesheetTokens)
    expect(
      broken,
      `${broken.length} theme.css token pair(s) fall below WCAG 2.2 AA. Fix the token, not the call ` +
        `site:\n${broken.join('\n')}`
    ).toEqual([])
  })

  it.each(SELECTABLE)('holds every pair at or above its threshold in the %s theme', (theme) => {
    // applyAppTheme overwrites the stylesheet values at runtime, so a token
    // corrected only in theme.css is not corrected in the running app.
    const broken = failures(runtimeTokens(theme))
    expect(
      broken,
      `${broken.length} runtime token pair(s) fall below WCAG 2.2 AA in the "${theme}" theme. Fix the ` +
        `preset in shared/settings.ts:\n${broken.join('\n')}`
    ).toEqual([])
  })

  it('keeps the runtime default theme in step with the stylesheet it mirrors', () => {
    const runtime = runtimeTokens('midnight')
    for (const token of [
      '--surface-canvas',
      '--surface-base',
      '--surface-raised',
      '--surface-overlay',
      '--surface-sunken',
      '--border-subtle',
      '--border-default',
      '--border-strong',
      '--text-primary',
      '--text-secondary',
      '--text-muted',
      '--text-danger',
      '--accent-primary',
      '--accent-danger',
      '--accent-success',
      '--accent-warning'
    ]) {
      expect(
        resolveColor(runtime, token),
        `${token} drifted between APP_THEME_PRESETS.midnight and theme.css`
      ).toEqual(resolveColor(stylesheetTokens, token))
    }
  })

  it('keeps muted text visibly subordinate to secondary, and secondary to primary', () => {
    // Raising muted to 4.5:1 on its own is not enough: if it climbs to meet the
    // threshold while secondary stays put, the two tiers merge and the hierarchy
    // the design relies on disappears. Measured on --surface-overlay, the
    // lightest surface and therefore the tightest case.
    for (const [label, tokens] of [
      ['theme.css', stylesheetTokens] as const,
      ...SELECTABLE.map((theme) => [theme, runtimeTokens(theme)] as const)
    ]) {
      const overlay = resolveColor(tokens, '--surface-overlay')
      const primary = contrastRatio(resolveColor(tokens, '--text-primary'), overlay)
      const secondary = contrastRatio(resolveColor(tokens, '--text-secondary'), overlay)
      const muted = contrastRatio(resolveColor(tokens, '--text-muted'), overlay)

      expect(primary, `${label}: primary must outrank secondary`).toBeGreaterThan(secondary)
      expect(secondary, `${label}: secondary must outrank muted`).toBeGreaterThan(muted)
      // Each step must be a real step, not a rounding artefact.
      expect(
        contrastRatio(resolveColor(tokens, '--text-primary'), resolveColor(tokens, '--text-secondary')),
        `${label}: primary and secondary have merged`
      ).toBeGreaterThan(1.5)
      expect(
        contrastRatio(resolveColor(tokens, '--text-secondary'), resolveColor(tokens, '--text-muted')),
        `${label}: secondary and muted have merged`
      ).toBeGreaterThan(1.3)
    }
  })

  it('documents why a token is outside the matrix rather than silently dropping it', () => {
    for (const entry of EXEMPT) {
      expect(stylesheetTokens.has(entry.token), `${entry.token} no longer exists`).toBe(true)
      expect(entry.reason.length).toBeGreaterThan(40)
      expect(PAIRS.some((pair) => pair.fg === entry.token)).toBe(false)
    }
  })
})
