import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  FONT_COND,
  FONT_NUM,
  StatTile,
  gearFont,
  isNumericReadout,
  readoutFont
} from './dashboard-tiles'

describe('isNumericReadout', () => {
  it('is true for pure digit-leading numeric strings', () => {
    expect(isNumericReadout('123')).toBe(true)
    expect(isNumericReadout('-0.18')).toBe(true)
    expect(isNumericReadout('1:24.501')).toBe(true)
  })

  it('is false for symbols DSEG7 cannot render (%, +, ±)', () => {
    // DSEG7 has no glyph for these — they must route away from the 7-seg face.
    expect(isNumericReadout('45%')).toBe(false)
    expect(isNumericReadout('+0.183')).toBe(false)
    expect(isNumericReadout('±0.000')).toBe(false)
  })

  it('is false for dashes, empty and alphabetic text', () => {
    expect(isNumericReadout('—')).toBe(false)
    expect(isNumericReadout('')).toBe(false)
    expect(isNumericReadout('OFF')).toBe(false)
    expect(isNumericReadout('N')).toBe(false)
    expect(isNumericReadout('MAP 1')).toBe(false)
  })
})

describe('readoutFont', () => {
  it('routes letters and %/+/± to condensed, pure numerals to DSEG', () => {
    expect(readoutFont('N')).toBe(FONT_COND)
    expect(readoutFont('OFF')).toBe(FONT_COND)
    expect(readoutFont('45%')).toBe(FONT_COND)
    expect(readoutFont('+0.18')).toBe(FONT_COND)
    expect(readoutFont('214')).toBe(FONT_NUM)
  })

  it('treats non-string nodes as numeric (DSEG)', () => {
    expect(readoutFont(214)).toBe(FONT_NUM)
  })
})

describe('gearFont', () => {
  it('uses DSEG for single digits and condensed for letters', () => {
    expect(gearFont('3')).toBe(FONT_NUM)
    expect(gearFont('N')).toBe(FONT_COND)
    expect(gearFont('R')).toBe(FONT_COND)
  })
})

describe('StatTile font selection', () => {
  it('renders text values with the condensed face', () => {
    const markup = renderToStaticMarkup(createElement(StatTile, { label: 'TC', value: 'OFF' }))
    expect(markup).toContain('Chakra Petch')
  })

  it('renders numeric values with the DSEG face', () => {
    const markup = renderToStaticMarkup(createElement(StatTile, { label: 'SPD', value: '214' }))
    expect(markup).toContain('DSEG7Classic')
  })

  it('honours an explicit valueFont override', () => {
    const markup = renderToStaticMarkup(
      createElement(StatTile, { label: 'SPD', value: 'OFF', valueFont: FONT_NUM })
    )
    expect(markup).toContain('DSEG7Classic')
  })
})
