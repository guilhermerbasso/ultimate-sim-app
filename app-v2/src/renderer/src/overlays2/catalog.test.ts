import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../shared/telemetry-scenarios'
import { WIDGET_SPECS_BY_ID } from '../widgets2'
import { Overlay2Canvas } from './Overlay2Canvas'
import { OVERLAYS2 } from './catalog'

describe('overlays2 catalogue', () => {
  it('contains at least 50 overlays', () => {
    expect(OVERLAYS2.length).toBeGreaterThanOrEqual(50)
  })

  it('has unique overlay ids', () => {
    const ids = new Set(OVERLAYS2.map((overlay) => overlay.id))
    expect(ids.size).toBe(OVERLAYS2.length)
  })

  it('uses valid widget specs and at least five families per overlay', () => {
    for (const overlay of OVERLAYS2) {
      expect(overlay.families.length, overlay.id).toBeGreaterThanOrEqual(5)
      expect(overlay.specIds.length, overlay.id).toBeGreaterThanOrEqual(2)
      expect(overlay.specIds.length, overlay.id).toBeLessThanOrEqual(8)

      for (const specId of overlay.specIds) {
        expect(WIDGET_SPECS_BY_ID[specId], `${overlay.id}:${specId}`).toBeTruthy()
      }
    }
  })

  it('renders every overlay family to non-empty, finite markup', () => {
    const snapshot = baseSnapshot()

    for (const overlay of OVERLAYS2) {
      for (const family of overlay.families) {
        const html = renderToStaticMarkup(
          createElement(Overlay2Canvas, {
            overlay,
            family,
            snapshot,
            width: overlay.w,
            height: overlay.h
          })
        )

        expect(html.length, `${overlay.id}:${family}`).toBeGreaterThan(0)
        expect(html.includes('NaN'), `${overlay.id}:${family}`).toBe(false)
        expect(html.includes('undefined'), `${overlay.id}:${family}`).toBe(false)
        expect(html.includes('Infinity'), `${overlay.id}:${family}`).toBe(false)
      }
    }
  })
})
