import { describe, expect, it } from 'vitest'
import type { Dashboard } from './dashboards'
import { createButtonBoxPanel } from './touch-panel'
import {
  STREAM_DEVICE_PRESETS,
  createStreamPresentationProfile,
  dashboardForStreamPresentation,
  resolveStreamPresentation,
  resolveTouchPresentationLayout,
  streamPresentationTargetState,
  type StreamPresentationTargetDescriptor
} from './stream-presentation'

const iphoneTarget: StreamPresentationTargetDescriptor = {
  kind: 'dashboard',
  id: 'race',
  name: 'Race',
  revision: 'dashboard:epoch:1',
  width: 1024,
  height: 600,
  itemCount: 2,
  hidden: false
}

describe('mobile stream device presets', () => {
  it('covers iPad, iPhone, Android phone, and Android tablet families', () => {
    expect(STREAM_DEVICE_PRESETS.map((preset) => preset.id)).toEqual([
      'ipad-11',
      'iphone-15-pro',
      'android-phone',
      'android-tablet'
    ])
    expect(STREAM_DEVICE_PRESETS.filter((preset) => preset.formFactor === 'phone')).toHaveLength(2)
    expect(STREAM_DEVICE_PRESETS.filter((preset) => preset.formFactor === 'tablet')).toHaveLength(2)
  })

  it('rotates the exact viewport and safe-area insets together', () => {
    const profile = createStreamPresentationProfile(iphoneTarget, {
      presetId: 'iphone-15-pro',
      now: 10
    })
    profile.settings.orientation = 'landscape'

    const resolved = resolveStreamPresentation(profile)

    expect(resolved.viewport).toEqual({ width: 852, height: 393 })
    expect(resolved.safeArea).toEqual({ top: 0, right: 59, bottom: 0, left: 34 })
    expect(resolved.content).toEqual({ width: 759, height: 393 })
  })

  it('enforces platform minimum touch sizes', () => {
    const profile = createStreamPresentationProfile(iphoneTarget, {
      presetId: 'android-phone',
      now: 10
    })
    profile.settings.minimumTouchTarget = 44

    expect(resolveStreamPresentation(profile).minimumTouchTarget).toBe(48)
  })

  it('keeps touch cells at or above the configured minimum in fit and fill modes', () => {
    const profile = createStreamPresentationProfile({
      ...iphoneTarget,
      kind: 'touch',
      revision: 'touch:1:8x4:32'
    }, {
      presetId: 'iphone-15-pro',
      now: 10
    })
    profile.settings.minimumTouchTarget = 44
    const panel = createButtonBoxPanel({ columns: 8, rows: 4 })
    const fitted = resolveTouchPresentationLayout(panel, resolveStreamPresentation(profile))
    profile.settings.fitMode = 'fill'
    const filled = resolveTouchPresentationLayout(panel, resolveStreamPresentation(profile))

    expect(fitted.scale).toBeGreaterThanOrEqual(1)
    expect(fitted.width / panel.columns).toBeGreaterThanOrEqual(44)
    expect(filled.scale).toBeGreaterThanOrEqual(fitted.scale)
  })

  it('applies matching breakpoint framing and visibility without mutating the source dashboard', () => {
    const profile = createStreamPresentationProfile(iphoneTarget, {
      presetId: 'iphone-15-pro',
      now: 10
    })
    profile.settings.fitMode = 'fill'
    profile.settings.visibilityOverrides = [{ elementId: 'fuel', visible: false }]
    profile.settings.breakpoints = [{
      id: 'compact',
      name: 'Compact',
      maxWidth: 400,
      fitMode: 'fit',
      visibilityOverrides: [
        { elementId: 'fuel', visible: true },
        { elementId: 'relative', visible: false }
      ]
    }]
    const dashboard: Dashboard = {
      id: 'race',
      name: 'Race',
      width: 1024,
      height: 600,
      bg: '#000',
      elements: [
        { id: 'fuel', type: 'text', x: 0, y: 0, w: 100, h: 40, style: {} },
        { id: 'relative', type: 'text', x: 100, y: 0, w: 100, h: 40, style: {} }
      ]
    }

    const resolved = resolveStreamPresentation(profile)
    const presented = dashboardForStreamPresentation(dashboard, resolved)

    expect(resolved.activeBreakpointId).toBe('compact')
    expect(resolved.fitMode).toBe('fit')
    expect(presented.elements.map((element) => element.id)).toEqual(['fuel'])
    expect(dashboard.elements.map((element) => element.id)).toEqual(['fuel', 'relative'])
    expect(dashboard.scaleMode).toBeUndefined()
  })
})

describe('stream presentation target revisions', () => {
  it('distinguishes current, updated, and missing targets', () => {
    const profile = createStreamPresentationProfile(iphoneTarget, { now: 10 })

    expect(streamPresentationTargetState(profile, iphoneTarget)).toBe('current')
    expect(streamPresentationTargetState(profile, { ...iphoneTarget, revision: 'dashboard:epoch:2' })).toBe('stale')
    expect(streamPresentationTargetState(profile, null)).toBe('missing')
  })
})
