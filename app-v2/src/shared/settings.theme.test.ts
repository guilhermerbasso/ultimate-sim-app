import { describe, expect, it } from 'vitest'
import { APP_THEMES, APP_THEME_PRESETS, type AppThemeTokens } from './settings'

const GLASS_THEMES = ['auroraGlass', 'neonNoir', 'carbonGlow', 'royalGlass'] as const

const REQUIRED_BASE_FIELDS: Array<keyof AppThemeTokens> = [
  'accent',
  'bg',
  'bgDeep',
  'panel',
  'panelStrong',
  'text',
  'muted',
  'line',
  'danger',
  'success'
]

describe('app theme registry', () => {
  it('registers every preset in the selectable theme list', () => {
    for (const name of Object.keys(APP_THEME_PRESETS)) {
      expect(APP_THEMES).toContain(name)
    }
  })

  it('gives every preset the full base token set', () => {
    for (const tokens of Object.values(APP_THEME_PRESETS)) {
      for (const field of REQUIRED_BASE_FIELDS) {
        expect(tokens[field], `${field} should be defined`).toBeTruthy()
      }
      expect(tokens.accent).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('exposes the four modern glass themes with the glass feel tokens', () => {
    for (const name of GLASS_THEMES) {
      expect(APP_THEMES).toContain(name)
      const tokens = APP_THEME_PRESETS[name]
      expect(tokens.surfaceStyle).toBe('glass')
      expect(tokens.glow).toBe(true)
      expect(tokens.glassBlur).toBeTruthy()
      expect(tokens.radiusLg).toBeTruthy()
      expect(tokens.shadowCard).toBeTruthy()
      expect(tokens.bodyGradient).toBeTruthy()
      // Surface/border/text tokens are declared so the whole app reskins.
      expect(tokens.surfaceRaised).toBeTruthy()
      expect(tokens.borderDefault).toBeTruthy()
      expect(tokens.textPrimary).toBeTruthy()
    }
  })
})
