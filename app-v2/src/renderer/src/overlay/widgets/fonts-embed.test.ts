import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Abs } from '../../icons/motorsport'

const read = (rel: string): string =>
  readFileSync(new URL(rel, import.meta.url), 'utf8')

describe('display/7-seg font embedding', () => {
  it('embeds DSEG7 + Chakra Petch @font-face in the overlay stylesheet', () => {
    const css = read('./redesign-core.css')
    expect(css).toContain('@font-face')
    expect(css).toContain('DSEG7Classic-Regular')
    expect(css).toContain('Chakra Petch')
  })

  it('embeds DSEG7 + Chakra Petch @font-face app-wide in fonts.css', () => {
    const css = read('../../styles/fonts.css')
    expect(css).toContain('@font-face')
    expect(css).toContain('DSEG7Classic-Regular')
    expect(css).toContain('Chakra Petch')
  })

  it('defines the --rc-num token with the 7-seg face first', () => {
    const css = read('./redesign-core.css')
    expect(css).toMatch(/--rc-num:\s*'DSEG7Classic-Regular'/)
  })

  it('renders motorsport glyphs with the Chakra Petch stack, not Bahnschrift', () => {
    const out = renderToStaticMarkup(createElement(Abs))
    expect(out).toContain('Chakra Petch')
    expect(out).not.toContain('Bahnschrift')
  })
})

describe('condensed/display label fonts route to embedded faces (not system fallback)', () => {
  it('declares the condensed + display @font-face app-wide in redesign-core.css', () => {
    const css = read('./redesign-core.css')
    for (const face of ['Chakra Petch', 'Michroma', 'Rajdhani', 'Barlow Condensed']) {
      expect(css, face).toContain(face)
    }
  })

  it('leads the rd2 detail tokens with embedded condensed/display faces', () => {
    const css = read('./redesign-detail.css')
    // condensed labels -> Chakra Petch / Michroma before the unbundled Bahnschrift
    expect(css).toMatch(/--rd2-cond:\s*'Chakra Petch',\s*'Michroma',[^;]*'Bahnschrift'/)
    // display headlines -> Rajdhani / Barlow Condensed before the unbundled Bahnschrift
    expect(css).toMatch(/--rd2-disp:\s*'Rajdhani',\s*'Barlow Condensed',[^;]*'Bahnschrift'/)
  })

  it('leads the rd4 futuristic family card fonts with embedded faces', () => {
    const css = read('./redesign-futuristic.css')
    expect(css).toContain(
      "font-family: 'Chakra Petch', 'Michroma', 'Arial Narrow', 'Bahnschrift', 'Segoe UI', sans-serif;"
    )
    expect(css).toContain(
      "font-family: 'Rajdhani', 'Barlow Condensed', 'DIN Condensed', 'Bahnschrift', 'Segoe UI', sans-serif;"
    )
  })

  it('leads the rd5 r16 family card fonts with embedded faces', () => {
    const css = read('./redesign-r16.css')
    expect(css).toContain(
      "font-family: 'Rajdhani', 'Barlow Condensed', 'Bahnschrift', 'DIN Alternate', var(--overlay-font, 'Segoe UI'), sans-serif;"
    )
    expect(css).toContain(
      "font-family: 'Chakra Petch', 'Michroma', 'Arial Narrow', 'Bahnschrift', var(--overlay-font, 'Segoe UI'), sans-serif;"
    )
  })

  it('never leads a label card font with an unbundled condensed face', () => {
    // The `terminal` family mono (Cascadia) and the base `var(--overlay-font)`
    // surface font are intentional and excluded.
    const unbundledLead = /font-family:\s*'(Bahnschrift|Arial Narrow|DIN Condensed|DIN Alternate|Oswald|Impact|Haettenschweiler)'/
    for (const rel of ['./redesign-detail.css', './redesign-futuristic.css', './redesign-r16.css']) {
      expect(read(rel), rel).not.toMatch(unbundledLead)
    }
  })
})
