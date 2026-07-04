import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  FONT_CONDENSED,
  FONT_MONO,
  fmtPressure,
  fmtTemp,
  fmtVolume,
  gearFont,
  isNumericReadout,
  readoutFont
} from './gt3-theme'

// Reads gt3-theme.ts as raw text (no import) to guard the GT3 colour discipline at
// the source level: green must be documented as a positive STATE hue only, and the
// warm chrome/accent palette (amber/orange) must exist for decoration.
const SOURCE = readFileSync(fileURLToPath(new URL('./gt3-theme.ts', import.meta.url)), 'utf8')

describe('gt3-theme colour discipline', () => {
  it('documents green as a positive state hue only', () => {
    expect(SOURCE).toMatch(/green = positive state only/i)
  })

  it('documents the warm = chrome/accent rule', () => {
    expect(SOURCE).toMatch(/WARM tones[^\n]*chrome/i)
  })

  it('keeps every green token on the single state-good hue #1AFF6E', () => {
    for (const token of ['teal', 'green', 'lime', 'good', 'flagGreen']) {
      expect(SOURCE, `${token} must be the state-good hue`).toMatch(
        new RegExp(`${token}:\\s*'#1AFF6E'`)
      )
    }
  })

  it('exposes a single canonical good STATE token', () => {
    expect(SOURCE).toMatch(/good:\s*'#1AFF6E'/)
  })

  it('provides warm chrome/accent tokens (amber + orange)', () => {
    expect(SOURCE).toMatch(/amber:\s*'#FFB800'/)
    expect(SOURCE).toMatch(/orange:\s*'#FF7A00'/)
    expect(SOURCE).toMatch(/chrome:\s*'#FFB800'/)
    expect(SOURCE).toMatch(/accent:\s*'#FF7A00'/)
  })
})

describe('gt3-theme numeral-only font helpers', () => {
  it('classifies numeric readouts vs letters/dashes', () => {
    expect(isNumericReadout('123')).toBe(true)
    expect(isNumericReadout('-0.18')).toBe(true)
    expect(isNumericReadout('45%')).toBe(true)
    expect(isNumericReadout('—')).toBe(false)
    expect(isNumericReadout('OFF')).toBe(false)
    expect(isNumericReadout('N')).toBe(false)
  })

  it('routes text to condensed and numerals to DSEG (mono)', () => {
    expect(readoutFont('N')).toBe(FONT_CONDENSED)
    expect(readoutFont('OFF')).toBe(FONT_CONDENSED)
    expect(readoutFont('214')).toBe(FONT_MONO)
  })

  it('selects the gear font by digit vs letter', () => {
    expect(gearFont('3')).toBe(FONT_MONO)
    expect(gearFont('N')).toBe(FONT_CONDENSED)
  })
})

describe('gt3-theme numeric formatters guard missing input', () => {
  it('returns an em dash for missing/non-finite input', () => {
    expect(fmtTemp(undefined)).toBe('—')
    expect(fmtTemp(Number.NaN)).toBe('—')
    expect(fmtPressure(undefined)).toBe('—')
    expect(fmtPressure(Number.POSITIVE_INFINITY)).toBe('—')
    expect(fmtVolume(undefined)).toBe('—')
    expect(fmtVolume(Number.NaN)).toBe('—')
  })

  it('keeps finite-value formatting unchanged', () => {
    expect(fmtTemp(92)).toBe('92')
    expect(fmtPressure(165)).toBe('165')
    expect(fmtVolume(46.5)).toBe('46.5')
  })
})
