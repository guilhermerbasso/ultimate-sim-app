import { describe, expect, it } from 'vitest'
import { DASHBOARDS2 } from './catalog'
import type { DashboardElementType } from '../dashboards'

const VALID_TYPES = new Set<DashboardElementType>([
  'text',
  'rect',
  'bar',
  'barv',
  'dualbar',
  'deltabar',
  'gauge',
  'shiftlights',
  'map',
  'radar',
  'image',
  'table',
  'standings',
  'flag',
  'trace',
  'overlaywidget'
])

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return Math.max(a.x, b.x) < Math.min(a.x + a.w, b.x + b.w) && Math.max(a.y, b.y) < Math.min(a.y + a.h, b.y + b.h)
}

describe('dashboards2 catalogue', () => {
  it('ships at least 50 dashboards with unique ids', () => {
    const ids = DASHBOARDS2.map((dashboard) => dashboard.id)
    expect(DASHBOARDS2.length).toBeGreaterThanOrEqual(50)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('uses at least five bound telemetry variables per dashboard', () => {
    for (const dashboard of DASHBOARDS2) {
      const bindings = new Set(dashboard.elements.map((element) => element.binding).filter((binding): binding is string => Boolean(binding)))
      expect(dashboard.elements.length, dashboard.id).toBeGreaterThanOrEqual(5)
      expect(bindings.size, dashboard.id).toBeGreaterThanOrEqual(5)
    }
  })

  it('only uses valid element types and keeps every element on the canvas with a style', () => {
    for (const dashboard of DASHBOARDS2) {
      for (const element of dashboard.elements) {
        expect(VALID_TYPES.has(element.type), `${dashboard.id}: ${element.type}`).toBe(true)
        expect(element.x, `${dashboard.id}: ${element.id} x`).toBeGreaterThanOrEqual(0)
        expect(element.y, `${dashboard.id}: ${element.id} y`).toBeGreaterThanOrEqual(0)
        expect(element.w, `${dashboard.id}: ${element.id} w`).toBeGreaterThan(0)
        expect(element.h, `${dashboard.id}: ${element.id} h`).toBeGreaterThan(0)
        expect(element.x + element.w, `${dashboard.id}: ${element.id} width overflow`).toBeLessThanOrEqual(dashboard.width)
        expect(element.y + element.h, `${dashboard.id}: ${element.id} height overflow`).toBeLessThanOrEqual(dashboard.height)
        expect(element.style, `${dashboard.id}: ${element.id} style`).toBeTruthy()
      }
    }
  })

  it('keeps foreground elements from overlapping', () => {
    for (const dashboard of DASHBOARDS2) {
      const foreground = dashboard.elements.filter((element) => !(element.type === 'rect' && element.w === dashboard.width && element.h === dashboard.height))
      for (let i = 0; i < foreground.length; i += 1) {
        for (let j = i + 1; j < foreground.length; j += 1) {
          expect(overlaps(foreground[i], foreground[j]), `${dashboard.id}: ${foreground[i].id} overlaps ${foreground[j].id}`).toBe(false)
        }
      }
    }
  })
})
