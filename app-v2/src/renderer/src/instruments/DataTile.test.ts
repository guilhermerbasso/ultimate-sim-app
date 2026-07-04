import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DataTile, AlarmStrip } from './DataTile'

const renderTile = (props: Parameters<typeof DataTile>[0]): string =>
  renderToStaticMarkup(createElement(DataTile, props))
const renderStrip = (props: Parameters<typeof AlarmStrip>[0]): string =>
  renderToStaticMarkup(createElement(AlarmStrip, props))

describe('DataTile', () => {
  it('renders label, value and unit', () => {
    const markup = renderTile({ label: 'oil', value: 108, unit: 'C' })
    expect(markup).toContain('<svg')
    expect(markup).toContain('OIL')
    expect(markup).toContain('108')
    expect(markup).toContain('C')
  })

  it('uses DSEG for numeric values', () => {
    expect(renderTile({ value: 42 })).toContain('DSEG7Classic-Regular')
  })

  it('routes non-numeric values to the condensed face', () => {
    const markup = renderTile({ value: 'WET' })
    expect(markup).not.toContain('DSEG7Classic-Regular')
    expect(markup).toContain('WET')
  })

  it('applies a carbon material pattern', () => {
    expect(renderTile({ value: 1, material: 'carbon' })).toContain('<pattern')
  })

  it('guards NaN values to a dash', () => {
    const markup = renderTile({ label: 'x', value: Number.NaN })
    expect(markup).not.toContain('NaN')
    expect(markup).not.toContain('undefined')
    expect(markup).toContain('—')
  })
})

describe('AlarmStrip', () => {
  it('glows (feGaussianBlur) only when an alarm is active', () => {
    const active = renderStrip({ alarms: [{ label: 'LOW FUEL', active: true }] })
    expect(active).toContain('feGaussianBlur')
    const inactive = renderStrip({ alarms: [{ label: 'LOW FUEL', active: false }] })
    expect(inactive).not.toContain('feGaussianBlur')
  })

  it('renders an icon chip from the registry', () => {
    const markup = renderStrip({ alarms: [{ label: 'PIT', active: true, icon: 'pit-limiter' }] })
    expect(markup).toContain('PIT')
    expect(markup).toContain('<svg')
  })

  it('tolerates an empty alarm list without NaN', () => {
    const markup = renderStrip({ alarms: [] })
    expect(markup).toContain('<svg')
    expect(markup).not.toContain('NaN')
    expect(markup).not.toContain('undefined')
  })
})
