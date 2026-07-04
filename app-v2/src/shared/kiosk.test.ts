import { describe, expect, it } from 'vitest'
import { applyDashboardQuery, buildDashboardQuery, buildKioskOpenOptions } from './kiosk'

describe('buildDashboardQuery', () => {
  it('always includes the dashboard id', () => {
    expect(buildDashboardQuery('dash-1')).toEqual({ dash: 'dash-1' })
  })

  it('omits kiosk when not requested', () => {
    expect(buildDashboardQuery('dash-1', false)).toEqual({ dash: 'dash-1' })
    expect(buildDashboardQuery('dash-1', undefined)).toEqual({ dash: 'dash-1' })
  })

  it('adds kiosk=1 when kiosk mode is requested', () => {
    expect(buildDashboardQuery('dash-1', true)).toEqual({ dash: 'dash-1', kiosk: '1' })
  })
})

describe('applyDashboardQuery', () => {
  it('sets the dash param on the url search params', () => {
    const url = applyDashboardQuery(new URL('http://localhost:5173/dashboard.html'), 'abc')
    expect(url.searchParams.get('dash')).toBe('abc')
    expect(url.searchParams.get('kiosk')).toBeNull()
  })

  it('appends kiosk=1 so getKioskFromQuery activates the touch layer', () => {
    const url = applyDashboardQuery(new URL('http://localhost:5173/dashboard.html'), 'abc', true)
    expect(url.searchParams.get('dash')).toBe('abc')
    expect(url.searchParams.get('kiosk')).toBe('1')
  })

  it('returns the same url instance for chaining', () => {
    const url = new URL('http://localhost:5173/dashboard.html')
    expect(applyDashboardQuery(url, 'x', true)).toBe(url)
  })
})

describe('buildKioskOpenOptions', () => {
  it('builds fullscreen kiosk open options for the given display', () => {
    expect(buildKioskOpenOptions(42)).toEqual({ displayId: 42, fullscreen: true, kiosk: true })
  })
})
