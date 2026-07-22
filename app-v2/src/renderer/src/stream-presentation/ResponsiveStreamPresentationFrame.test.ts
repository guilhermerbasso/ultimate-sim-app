// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ALERTS_CONFIG } from '../../../shared/alerts'
import type { Dashboard } from '../../../shared/dashboards'
import {
  createStreamPresentationProfile,
  resolveStreamPresentation,
  type StreamPresentationTargetDescriptor
} from '../../../shared/stream-presentation'
import { createButtonBoxPanel, type ButtonBoxPanel } from '../../../shared/touch-panel'
import { ResponsiveStreamPresentationFrame } from './ResponsiveStreamPresentationFrame'
import {
  calculateStreamPresentationFrameLayout,
  effectiveStreamPresentationSafeArea,
  emptyStreamPresentationFrameMeasurement,
  streamPresentationStageClearance,
  withStreamPresentationSafeArea
} from './responsive-frame'

const dashboardTarget: StreamPresentationTargetDescriptor = {
  kind: 'dashboard',
  id: 'race',
  name: 'Race',
  revision: 'dashboard:race:1',
  width: 1024,
  height: 600,
  itemCount: 0,
  hidden: false
}

const touchTarget: StreamPresentationTargetDescriptor = {
  kind: 'touch',
  id: 'pit',
  name: 'Pit controls',
  revision: 'touch:pit:1',
  itemCount: 2,
  hidden: false
}

const dashboard: Dashboard = {
  id: 'race',
  name: 'Race',
  width: 1024,
  height: 600,
  bg: '#000',
  elements: []
}

function touchPanel(columns = 2): ButtonBoxPanel {
  return createButtonBoxPanel({
    id: 'pit',
    name: 'Pit controls',
    columns,
    rows: 1,
    buttons: Array.from({ length: columns }, (_, index) => ({
      id: `control-${index}`,
      label: `CONTROL ${index + 1}`,
      control: {
        kind: 'momentary' as const,
        action: { kind: 'none' as const }
      }
    }))
  })
}

function rect(width: number, height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({})
  } as DOMRect
}

class FakeVisualViewport extends EventTarget {
  width = 0
  height = 0
  offsetLeft = 0
  offsetTop = 0
  pageLeft = 0
  pageTop = 0
  scale = 1
  onresize: ((this: VisualViewport, ev: Event) => unknown) | null = null
  onscroll: ((this: VisualViewport, ev: Event) => unknown) | null = null
}

class FakeResizeObserver implements ResizeObserver {
  static instances: FakeResizeObserver[] = []
  readonly observe = vi.fn()
  readonly unobserve = vi.fn()
  readonly disconnect = vi.fn()

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this)
  }

  trigger(): void {
    this.callback([], this)
  }
}

let hostSize = { width: 390, height: 844 }
let cssSafeArea = { top: 0, right: 0, bottom: 0, left: 0 }
let visualViewport: FakeVisualViewport
let rectSpy: ReturnType<typeof vi.spyOn>
let computedStyleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  FakeResizeObserver.instances = []
  visualViewport = new FakeVisualViewport()
  visualViewport.width = hostSize.width
  visualViewport.height = hostSize.height
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  Object.defineProperty(window, 'ipc', {
    configurable: true,
    value: {
      subscribe: vi.fn(() => () => undefined),
      invoke: vi.fn(async () => DEFAULT_ALERTS_CONFIG)
    }
  })
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: visualViewport
  })
  rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('stream-presentation-frame')
      ? rect(hostSize.width, hostSize.height)
      : rect(0, 0)
  })
  const originalGetComputedStyle = window.getComputedStyle.bind(window)
  computedStyleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
    if (element.classList.contains('stream-presentation-safe-area-probe')) {
      return {
        paddingTop: `${cssSafeArea.top}px`,
        paddingRight: `${cssSafeArea.right}px`,
        paddingBottom: `${cssSafeArea.bottom}px`,
        paddingLeft: `${cssSafeArea.left}px`
      } as CSSStyleDeclaration
    }
    return originalGetComputedStyle(element)
  })
})

afterEach(() => {
  cleanup()
  rectSpy.mockRestore()
  computedStyleSpy.mockRestore()
  vi.unstubAllGlobals()
  hostSize = { width: 390, height: 844 }
  cssSafeArea = { top: 0, right: 0, bottom: 0, left: 0 }
})

function measurement(width: number, height: number) {
  return {
    ...emptyStreamPresentationFrameMeasurement(),
    hostWidth: width,
    hostHeight: height,
    viewport: { x: 0, y: 0, width, height }
  }
}

const VIEWPORTS = [
  [390, 844],
  [844, 390],
  [393, 852],
  [412, 915],
  [915, 412],
  [834, 1194],
  [1194, 834],
  [1024, 600]
] as const

describe('responsive presentation frame geometry', () => {
  for (const [width, height] of VIEWPORTS) {
    it(`contains and centers a canonical stage at ${width}x${height}`, () => {
      const stage = width >= height
        ? { width: 852, height: 393 }
        : { width: 393, height: 852 }
      const layout = calculateStreamPresentationFrameLayout(measurement(width, height), stage)

      expect(layout.measured).toBe(true)
      expect(layout.scale).toBeCloseTo(Math.min(width / stage.width, height / stage.height), 8)
      expect(layout.left).toBeGreaterThanOrEqual(-0.01)
      expect(layout.top).toBeGreaterThanOrEqual(-0.01)
      expect(layout.left + layout.renderedWidth).toBeLessThanOrEqual(width + 0.01)
      expect(layout.top + layout.renderedHeight).toBeLessThanOrEqual(height + 0.01)
      expect(layout.left + layout.renderedWidth / 2).toBeCloseTo(width / 2, 6)
      expect(layout.top + layout.renderedHeight / 2).toBeCloseTo(height / 2, 6)
      expect(layout.renderedWidth / layout.renderedHeight).toBeCloseTo(stage.width / stage.height, 8)
      expect(layout.scrollable).toBe(false)
    })
  }

  it('stays finite and hidden while the host is zero-sized', () => {
    const layout = calculateStreamPresentationFrameLayout(
      emptyStreamPresentationFrameMeasurement(),
      { width: 393, height: 852 }
    )
    expect(layout.measured).toBe(false)
    expect(layout.scale).toBe(0)
    expect(Object.values(layout).some((value) => typeof value === 'number' && Number.isNaN(value))).toBe(false)
  })

  it('maps CSS safe areas into canonical pixels without adding preset insets twice', () => {
    const effective = effectiveStreamPresentationSafeArea(
      { top: 59, right: 0, bottom: 34, left: 0 },
      { top: 40, right: 0, bottom: 20, left: 0 },
      0.5,
      { width: 393, height: 852 }
    )
    expect(effective).toEqual({ top: 80, right: 0, bottom: 40, left: 0 })
    expect(effective.top).not.toBe(139)
    expect(effective.bottom).not.toBe(74)
  })

  it('does not map a device inset that falls entirely inside letterboxing', () => {
    const frameMeasurement = measurement(844, 390)
    const layout = calculateStreamPresentationFrameLayout(
      frameMeasurement,
      { width: 393, height: 852 }
    )
    const clearance = streamPresentationStageClearance(frameMeasurement, layout)
    expect(clearance.left).toBeGreaterThan(80)

    expect(effectiveStreamPresentationSafeArea(
      { top: 59, right: 0, bottom: 34, left: 0 },
      { top: 0, right: 0, bottom: 0, left: 80 },
      layout.scale,
      { width: 393, height: 852 },
      clearance
    )).toEqual({ top: 59, right: 0, bottom: 34, left: 0 })
  })

  it('re-resolves presentation breakpoints against the effective safe content', () => {
    const profile = createStreamPresentationProfile(dashboardTarget, {
      id: 'profile-safe-breakpoint',
      presetId: 'iphone-15-pro',
      now: 10
    })
    profile.settings.breakpoints = [{
      id: 'narrow-safe-content',
      name: 'Narrow safe content',
      maxWidth: 350,
      fitMode: 'fill',
      minimumTouchTarget: 64
    }]
    const canonical = resolveStreamPresentation(profile)
    expect(canonical.activeBreakpointId).toBeNull()

    const effective = withStreamPresentationSafeArea(
      profile,
      canonical,
      { top: 80, right: 30, bottom: 40, left: 30 }
    )
    expect(effective.safeArea).toEqual({ top: 80, right: 30, bottom: 40, left: 30 })
    expect(effective.content.width).toBe(333)
    expect(effective.activeBreakpointId).toBe('narrow-safe-content')
    expect(effective.fitMode).toBe('fill')
    expect(effective.minimumTouchTarget).toBe(64)
  })

  it('preserves canonical safe-area edges when the authored profile is landscape', () => {
    const profile = createStreamPresentationProfile(dashboardTarget, {
      id: 'profile-landscape-safe',
      presetId: 'iphone-15-pro',
      now: 10
    })
    profile.settings.orientation = 'landscape'
    const canonical = resolveStreamPresentation(profile)
    const safeArea = { top: 11, right: 80, bottom: 22, left: 40 }

    expect(withStreamPresentationSafeArea(profile, canonical, safeArea).safeArea).toEqual(safeArea)
  })
})

describe('responsive presentation frame lifecycle', () => {
  it('renders both dashboard and touch canonical branches inside measured frames', () => {
    const dashboardProfile = createStreamPresentationProfile(dashboardTarget, {
      id: 'profile-dashboard',
      presetId: 'iphone-15-pro',
      now: 10
    })
    const dashboardResult = render(createElement(ResponsiveStreamPresentationFrame, {
      profile: dashboardProfile,
      dashboard,
      mode: 'runtime'
    }))
    expect(dashboardResult.container.querySelector('[data-presentation-target="dashboard:race"]')).toBeTruthy()
    expect(dashboardResult.container.querySelector('[data-frame-measured="true"]')).toBeTruthy()
    dashboardResult.unmount()

    const touchProfile = createStreamPresentationProfile(touchTarget, {
      id: 'profile-touch',
      presetId: 'android-phone',
      now: 10
    })
    const touchResult = render(createElement(ResponsiveStreamPresentationFrame, {
      profile: touchProfile,
      touchPanel: touchPanel(),
      mode: 'runtime'
    }))
    expect(touchResult.container.querySelector('[data-presentation-target="touch:pit"]')).toBeTruthy()
    expect(touchResult.container.querySelector('[data-frame-measured="true"]')).toBeTruthy()
  })

  it('updates on visual viewport rotation without remounting the canonical renderer', () => {
    const profile = createStreamPresentationProfile(dashboardTarget, {
      id: 'profile-dashboard',
      presetId: 'iphone-15-pro',
      now: 10
    })
    const { container } = render(createElement(ResponsiveStreamPresentationFrame, {
      profile,
      dashboard,
      mode: 'runtime'
    }))
    const rendererBefore = container.querySelector('[data-presentation-profile="profile-dashboard"]')
    const frame = container.querySelector('[data-presentation-frame="true"]') as HTMLElement
    expect(frame.dataset.frameViewport).toBe('390x844')

    hostSize = { width: 844, height: 390 }
    visualViewport.width = 844
    visualViewport.height = 390
    act(() => visualViewport.dispatchEvent(new Event('resize')))

    const rendererAfter = container.querySelector('[data-presentation-profile="profile-dashboard"]')
    expect(rendererAfter).toBe(rendererBefore)
    expect(frame.dataset.frameViewport).toBe('844x390')
    expect(Number(frame.dataset.stageLeft)).toBeGreaterThanOrEqual(0)
    expect(Number(frame.dataset.stageTop)).toBeGreaterThanOrEqual(0)
    expect(Number(frame.dataset.stageLeft) + Number(frame.dataset.stageWidth)).toBeLessThanOrEqual(844.01)
    expect(Number(frame.dataset.stageTop) + Number(frame.dataset.stageHeight)).toBeLessThanOrEqual(390.01)
  })

  it('uses the greater effective safe inset instead of summing CSS and profile values', () => {
    hostSize = { width: 393, height: 852 }
    visualViewport.width = 393
    visualViewport.height = 852
    cssSafeArea = { top: 80, right: 0, bottom: 40, left: 0 }
    const profile = createStreamPresentationProfile(dashboardTarget, {
      id: 'profile-safe',
      presetId: 'iphone-15-pro',
      now: 10
    })
    const { container } = render(createElement(ResponsiveStreamPresentationFrame, {
      profile,
      dashboard,
      mode: 'runtime'
    }))
    const frame = container.querySelector('[data-presentation-frame="true"]') as HTMLElement
    expect(frame.dataset.effectiveSafeArea).toBe('80/0/40/0')
    const content = container.querySelector('.stream-presentation-content') as HTMLElement
    expect(content.style.top).toBe('80px')
    expect(content.style.height).toBe('732px')
  })

  it('keeps authenticated touch targets full-sized and enables controlled scrolling', () => {
    const profile = createStreamPresentationProfile(touchTarget, {
      id: 'profile-touch-scroll',
      presetId: 'android-phone',
      now: 10
    })
    const resolved = resolveStreamPresentation(profile)
    const { container } = render(createElement(ResponsiveStreamPresentationFrame, {
      profile,
      touchPanel: touchPanel(),
      mode: 'runtime',
      interactiveTouch: true
    }))
    const frame = container.querySelector('[data-presentation-frame="true"]') as HTMLElement
    expect(frame.dataset.touchCompatibility).toBe('scroll')
    expect(Number(frame.dataset.frameScale)).toBe(1)
    expect(Number(frame.dataset.frameScale) * resolved.minimumTouchTarget)
      .toBeGreaterThanOrEqual(resolved.minimumTouchTarget)
    expect(frame.classList.contains('is-scrollable')).toBe(true)
    expect(screen.getByRole('status').textContent).toContain('Scroll to reach')
  })

  it('fails closed with an incompatibility warning when the panel itself cannot fit its safe area', () => {
    const profile = createStreamPresentationProfile(touchTarget, {
      id: 'profile-touch-incompatible',
      presetId: 'android-phone',
      now: 10
    })
    hostSize = { width: 412, height: 915 }
    visualViewport.width = 412
    visualViewport.height = 915
    const { container } = render(createElement(ResponsiveStreamPresentationFrame, {
      profile,
      touchPanel: touchPanel(12),
      mode: 'runtime',
      interactiveTouch: true
    }))
    const frame = container.querySelector('[data-presentation-frame="true"]') as HTMLElement
    expect(frame.dataset.touchCompatibility).toBe('incompatible')
    expect(screen.getByRole('status').textContent).toContain('cannot fit')
    const hits = [...container.querySelectorAll<HTMLButtonElement>('.bb-hit')]
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((hit) => hit.disabled)).toBe(true)
  })

  it('measures the editor preview container instead of the browser visual viewport', () => {
    hostSize = { width: 500, height: 360 }
    visualViewport.width = 390
    visualViewport.height = 844
    const profile = createStreamPresentationProfile(dashboardTarget, {
      id: 'profile-preview-container',
      presetId: 'iphone-15-pro',
      now: 10
    })
    const { container } = render(createElement(ResponsiveStreamPresentationFrame, {
      profile,
      dashboard,
      mode: 'preview',
      viewportAware: false
    }))
    const frame = container.querySelector('[data-presentation-frame="true"]') as HTMLElement
    const rendererBefore = container.querySelector('[data-presentation-profile="profile-preview-container"]')
    expect(frame.dataset.frameViewport).toBe('500x360')
    expect(Number(frame.dataset.frameScale)).toBeCloseTo(
      Math.min((500 - 44) / 393, (360 - 44) / 852),
      8
    )

    hostSize = { width: 460, height: 520 }
    act(() => FakeResizeObserver.instances[0].trigger())
    expect(frame.dataset.frameViewport).toBe('460x520')
    expect(container.querySelector('[data-presentation-profile="profile-preview-container"]'))
      .toBe(rendererBefore)
  })
  it('makes an undersized touch preview display-only instead of exposing tiny hit targets', () => {
    hostSize = { width: 500, height: 360 }
    const profile = createStreamPresentationProfile(touchTarget, {
      id: 'profile-touch-preview',
      presetId: 'android-phone',
      now: 10
    })
    const { container } = render(createElement(ResponsiveStreamPresentationFrame, {
      profile,
      touchPanel: touchPanel(),
      mode: 'preview',
      viewportAware: false,
      interactiveTouch: true
    }))
    const frame = container.querySelector('[data-presentation-frame="true"]') as HTMLElement
    expect(frame.dataset.touchCompatibility).toBe('preview-scaled')
    expect(screen.getByRole('status').textContent).toContain('display-only')
    const hits = [...container.querySelectorAll<HTMLButtonElement>('.bb-hit')]
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((hit) => hit.disabled)).toBe(true)
  })

  it('cleans resize and visual viewport subscriptions on unmount', () => {
    const profile = createStreamPresentationProfile(dashboardTarget, {
      id: 'profile-cleanup',
      presetId: 'iphone-15-pro',
      now: 10
    })
    const windowRemove = vi.spyOn(window, 'removeEventListener')
    const viewportRemove = vi.spyOn(visualViewport, 'removeEventListener')
    const result = render(createElement(ResponsiveStreamPresentationFrame, {
      profile,
      dashboard,
      mode: 'runtime'
    }))
    const observer = FakeResizeObserver.instances[0]
    expect(observer.observe).toHaveBeenCalled()
    result.unmount()
    expect(observer.disconnect).toHaveBeenCalledTimes(1)
    expect(windowRemove).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(windowRemove).toHaveBeenCalledWith('orientationchange', expect.any(Function))
    expect(viewportRemove).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(viewportRemove).toHaveBeenCalledWith('scroll', expect.any(Function))
    windowRemove.mockRestore()
    viewportRemove.mockRestore()
  })
})
