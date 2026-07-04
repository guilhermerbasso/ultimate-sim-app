import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SegmentReadout } from './SegmentReadout'

const render = (props: Parameters<typeof SegmentReadout>[0]): string =>
  renderToStaticMarkup(createElement(SegmentReadout, props))

describe('SegmentReadout', () => {
  it('renders numerals in the DSEG 7-segment face', () => {
    const markup = render({ value: 1234 })
    expect(markup).toContain('DSEG7Classic-Regular')
    expect(markup).toContain('1234')
  })

  it('routes lettered strings to the 14-segment / condensed face', () => {
    const markup = render({ value: 'PIT' })
    expect(markup).toContain('DSEG14Classic-Regular')
    expect(markup).toContain('PIT')
  })

  it('honours a forced mode', () => {
    expect(render({ value: 5, mode: '14' })).toContain('DSEG14Classic-Regular')
    expect(render({ value: '7', mode: '7' })).toContain('DSEG7Classic-Regular')
  })

  it('draws a ghost backdrop when enabled', () => {
    const markup = render({ value: 88, digits: 3, ghost: true })
    expect(markup).toContain('888')
    expect(markup).toContain('fill-opacity')
  })

  it('guards NaN/undefined to a dash and never emits NaN', () => {
    for (const value of [Number.NaN, Infinity, -Infinity]) {
      const markup = render({ value: value as number })
      expect(markup).not.toContain('NaN')
      expect(markup).not.toContain('undefined')
      expect(markup).toContain('—')
    }
  })

  it('formats with decimals', () => {
    expect(render({ value: 3.14159, decimals: 2 })).toContain('3.14')
  })
})
