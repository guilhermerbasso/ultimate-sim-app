import { describe, expect, it } from 'vitest'
import type { DashboardPlaylistItem } from '../../shared/dashboards'
import { buttonPanelPlaylistItem } from '../../shared/touch-panel'
import {
  openablePlaylistItems,
  resolveCycleStep,
  sameCockpitTarget,
  touchPanelIdOf
} from './manager'

// Regression coverage for the "touch panels dead in the playlist" blocker. The
// pure routing helpers below are what the DashboardManager uses to keep + route
// touch-panel items instead of filtering them out against the dashboard store.

const dash = (id: string): DashboardPlaylistItem => ({ dashboardId: id })
const panel = (id: string): DashboardPlaylistItem => buttonPanelPlaylistItem(id)

describe('touchPanelIdOf', () => {
  it('prefers touchPanelId, falling back to dashboardId', () => {
    expect(touchPanelIdOf({ dashboardId: 'p1', touchPanelId: 'p1', kind: 'touch-panel' })).toBe('p1')
    expect(touchPanelIdOf({ dashboardId: 'p2', kind: 'touch-panel' })).toBe('p2')
  })
})

describe('openablePlaylistItems', () => {
  const items = [dash('d1'), panel('p1'), dash('missing'), panel('gone')]
  const hasDashboard = (id: string): boolean => id === 'd1'
  const hasTouchPanel = (id: string): boolean => id === 'p1'

  it('keeps dashboards that exist AND touch panels that exist', () => {
    const kept = openablePlaylistItems(items, hasDashboard, hasTouchPanel)
    expect(kept.map((i) => i.dashboardId)).toEqual(['d1', 'p1'])
  })

  it('does NOT drop a touch panel just because it is not a known dashboard', () => {
    // The bug: filtering every item against the dashboard store removed panels.
    const kept = openablePlaylistItems([panel('p1')], () => false, hasTouchPanel)
    expect(kept).toHaveLength(1)
    expect(kept[0].kind).toBe('touch-panel')
  })

  it('drops touch panels whose panel id no longer exists', () => {
    const kept = openablePlaylistItems([panel('gone')], hasDashboard, () => false)
    expect(kept).toHaveLength(0)
  })
})

describe('sameCockpitTarget', () => {
  it('treats any two touch panels as the same (single reused window)', () => {
    expect(sameCockpitTarget(panel('a'), panel('b'))).toBe(true)
  })
  it('treats same dashboard id as same, different ids as different', () => {
    expect(sameCockpitTarget(dash('d1'), dash('d1'))).toBe(true)
    expect(sameCockpitTarget(dash('d1'), dash('d2'))).toBe(false)
  })
  it('treats a dashboard and a touch panel as different', () => {
    expect(sameCockpitTarget(dash('d1'), panel('p1'))).toBe(false)
  })
})

describe('resolveCycleStep', () => {
  const items = [dash('d1'), panel('p1'), dash('d2')]

  it('opens the first item when nothing is open', () => {
    const step = resolveCycleStep(items, -1, () => false, 'next')
    expect(step).not.toBeNull()
    expect(step!.current).toBeNull()
    expect(step!.nextIndex).toBe(0)
    expect(step!.next).toEqual(items[0])
  })

  it('advances to the next item — including a touch panel — and reports the one to close', () => {
    const step = resolveCycleStep(items, 0, (i) => i.dashboardId === 'd1', 'next')
    expect(step!.currentIndex).toBe(0)
    expect(step!.current).toEqual(dash('d1'))
    expect(step!.nextIndex).toBe(1)
    expect(step!.next.kind).toBe('touch-panel')
    expect(touchPanelIdOf(step!.next)).toBe('p1')
  })

  it('routes forward FROM an open touch panel to the following dashboard', () => {
    const step = resolveCycleStep(items, 1, (i) => i.kind === 'touch-panel', 'next')
    expect(step!.current!.kind).toBe('touch-panel')
    expect(step!.nextIndex).toBe(2)
    expect(step!.next).toEqual(dash('d2'))
  })

  it('wraps around with prev', () => {
    const step = resolveCycleStep(items, 0, (i) => i.dashboardId === 'd1', 'prev')
    expect(step!.nextIndex).toBe(2)
    expect(step!.next).toEqual(dash('d2'))
  })

  it('recovers the index when the tracked item is no longer open', () => {
    // currentIndex points at d1 but the actually-open item is the touch panel.
    const step = resolveCycleStep(items, 0, (i) => i.kind === 'touch-panel', 'next')
    expect(step!.currentIndex).toBe(1)
    expect(step!.nextIndex).toBe(2)
  })

  it('returns null for an empty playlist', () => {
    expect(resolveCycleStep([], -1, () => false, 'next')).toBeNull()
  })
})
