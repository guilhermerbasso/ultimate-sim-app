import {
  resolveStreamPresentation,
  resolveTouchPresentationLayout,
  type ResolvedStreamPresentation,
  type StreamPresentationProfile,
  type StreamSafeAreaInsets
} from '../../../shared/stream-presentation'
import type { ButtonBoxPanel } from '../../../shared/touch-panel'

export interface StreamPresentationFrameMeasurement {
  hostWidth: number
  hostHeight: number
  viewport: {
    x: number
    y: number
    width: number
    height: number
  }
  safeArea: StreamSafeAreaInsets
}

export interface StreamPresentationFrameLayout {
  measured: boolean
  scale: number
  containScale: number
  left: number
  top: number
  renderedWidth: number
  renderedHeight: number
  surfaceWidth: number
  surfaceHeight: number
  scrollable: boolean
}

export interface StreamPresentationFrameLayoutOptions {
  gutter?: number
  minimumScale?: number
}

const ZERO_SAFE_AREA: StreamSafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 }
const EPSILON = 0.01
const TOUCH_LAYOUT_EPSILON = 1.01

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

export function emptyStreamPresentationFrameMeasurement(): StreamPresentationFrameMeasurement {
  return {
    hostWidth: 0,
    hostHeight: 0,
    viewport: { x: 0, y: 0, width: 0, height: 0 },
    safeArea: { ...ZERO_SAFE_AREA }
  }
}

export function streamPresentationFrameMeasurementsEqual(
  left: StreamPresentationFrameMeasurement,
  right: StreamPresentationFrameMeasurement
): boolean {
  return left.hostWidth === right.hostWidth &&
    left.hostHeight === right.hostHeight &&
    left.viewport.x === right.viewport.x &&
    left.viewport.y === right.viewport.y &&
    left.viewport.width === right.viewport.width &&
    left.viewport.height === right.viewport.height &&
    left.safeArea.top === right.safeArea.top &&
    left.safeArea.right === right.safeArea.right &&
    left.safeArea.bottom === right.safeArea.bottom &&
    left.safeArea.left === right.safeArea.left
}

export function calculateStreamPresentationFrameLayout(
  measurement: StreamPresentationFrameMeasurement,
  stage: { width: number; height: number },
  options: StreamPresentationFrameLayoutOptions = {}
): StreamPresentationFrameLayout {
  const hostWidth = finiteNonNegative(measurement.hostWidth)
  const hostHeight = finiteNonNegative(measurement.hostHeight)
  const viewportWidth = finiteNonNegative(measurement.viewport.width)
  const viewportHeight = finiteNonNegative(measurement.viewport.height)
  const stageWidth = finiteNonNegative(stage.width)
  const stageHeight = finiteNonNegative(stage.height)
  const requestedGutter = finiteNonNegative(options.gutter ?? 0)
  const gutter = Math.min(requestedGutter, viewportWidth / 2, viewportHeight / 2)
  const availableWidth = Math.max(0, viewportWidth - gutter * 2)
  const availableHeight = Math.max(0, viewportHeight - gutter * 2)
  const measured = hostWidth > 0 && hostHeight > 0 &&
    availableWidth > 0 && availableHeight > 0 && stageWidth > 0 && stageHeight > 0

  if (!measured) {
    return {
      measured: false,
      scale: 0,
      containScale: 0,
      left: 0,
      top: 0,
      renderedWidth: 0,
      renderedHeight: 0,
      surfaceWidth: hostWidth,
      surfaceHeight: hostHeight,
      scrollable: false
    }
  }

  const containScale = Math.min(availableWidth / stageWidth, availableHeight / stageHeight)
  const requestedMinimumScale = finiteNonNegative(options.minimumScale ?? 0)
  const scale = Math.max(containScale, requestedMinimumScale)
  const renderedWidth = stageWidth * scale
  const renderedHeight = stageHeight * scale
  const scrollable = renderedWidth > availableWidth + EPSILON || renderedHeight > availableHeight + EPSILON
  const surfaceWidth = scrollable
    ? Math.max(hostWidth, renderedWidth + gutter * 2)
    : hostWidth
  const surfaceHeight = scrollable
    ? Math.max(hostHeight, renderedHeight + gutter * 2)
    : hostHeight
  const left = scrollable
    ? Math.max(gutter, (surfaceWidth - renderedWidth) / 2)
    : measurement.viewport.x + gutter + (availableWidth - renderedWidth) / 2
  const top = scrollable
    ? Math.max(gutter, (surfaceHeight - renderedHeight) / 2)
    : measurement.viewport.y + gutter + (availableHeight - renderedHeight) / 2

  return {
    measured: true,
    scale,
    containScale,
    left,
    top,
    renderedWidth,
    renderedHeight,
    surfaceWidth,
    surfaceHeight,
    scrollable
  }
}

function clampSafeArea(
  safeArea: StreamSafeAreaInsets,
  viewport: { width: number; height: number }
): StreamSafeAreaInsets {
  const top = Math.min(finiteNonNegative(safeArea.top), Math.max(0, viewport.height - 1))
  const right = Math.min(finiteNonNegative(safeArea.right), Math.max(0, viewport.width - 1))
  const bottom = Math.min(
    finiteNonNegative(safeArea.bottom),
    Math.max(0, viewport.height - top - 1)
  )
  const left = Math.min(
    finiteNonNegative(safeArea.left),
    Math.max(0, viewport.width - right - 1)
  )
  return { top, right, bottom, left }
}

export function streamPresentationStageClearance(
  measurement: StreamPresentationFrameMeasurement,
  layout: StreamPresentationFrameLayout
): StreamSafeAreaInsets {
  if (!layout.measured) return { top: 0, right: 0, bottom: 0, left: 0 }
  const viewportRight = measurement.viewport.x + measurement.viewport.width
  const viewportBottom = measurement.viewport.y + measurement.viewport.height
  return {
    top: finiteNonNegative(layout.top - measurement.viewport.y),
    right: finiteNonNegative(viewportRight - (layout.left + layout.renderedWidth)),
    bottom: finiteNonNegative(viewportBottom - (layout.top + layout.renderedHeight)),
    left: finiteNonNegative(layout.left - measurement.viewport.x)
  }
}

export function effectiveStreamPresentationSafeArea(
  profileSafeArea: StreamSafeAreaInsets,
  cssSafeArea: StreamSafeAreaInsets,
  scale: number,
  viewport: { width: number; height: number },
  stageClearance: StreamSafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 }
): StreamSafeAreaInsets {
  if (!Number.isFinite(scale) || scale <= 0) return clampSafeArea(profileSafeArea, viewport)
  const mappedCssSafeArea: StreamSafeAreaInsets = {
    top: Math.ceil(
      Math.max(0, finiteNonNegative(cssSafeArea.top) - finiteNonNegative(stageClearance.top)) / scale
    ),
    right: Math.ceil(
      Math.max(0, finiteNonNegative(cssSafeArea.right) - finiteNonNegative(stageClearance.right)) / scale
    ),
    bottom: Math.ceil(
      Math.max(0, finiteNonNegative(cssSafeArea.bottom) - finiteNonNegative(stageClearance.bottom)) / scale
    ),
    left: Math.ceil(
      Math.max(0, finiteNonNegative(cssSafeArea.left) - finiteNonNegative(stageClearance.left)) / scale
    )
  }
  // Preset insets simulate the authored device. Runtime CSS insets can raise an
  // overlapping edge, never add to it, so a matching notch is not applied twice.
  return clampSafeArea({
    top: Math.max(profileSafeArea.top, mappedCssSafeArea.top),
    right: Math.max(profileSafeArea.right, mappedCssSafeArea.right),
    bottom: Math.max(profileSafeArea.bottom, mappedCssSafeArea.bottom),
    left: Math.max(profileSafeArea.left, mappedCssSafeArea.left)
  }, viewport)
}

export function withStreamPresentationSafeArea(
  profile: StreamPresentationProfile,
  resolved: ResolvedStreamPresentation,
  safeArea: StreamSafeAreaInsets | undefined
): ResolvedStreamPresentation {
  if (!safeArea) return resolved
  const effective = clampSafeArea(safeArea, resolved.viewport)
  if (
    effective.top === resolved.safeArea.top &&
    effective.right === resolved.safeArea.right &&
    effective.bottom === resolved.safeArea.bottom &&
    effective.left === resolved.safeArea.left
  ) return resolved

  // Profile safe areas are authored in portrait coordinates. Convert the
  // effective canonical insets back before resolving so fit, visibility and
  // minimum-target breakpoints use the actual safe content width.
  const authoredSafeArea = profile.settings.orientation === 'landscape'
    ? {
        top: effective.right,
        right: effective.bottom,
        bottom: effective.left,
        left: effective.top
      }
    : effective
  return resolveStreamPresentation({
    ...profile,
    settings: {
      ...profile.settings,
      safeArea: authoredSafeArea
    }
  })
}

export function touchPresentationFitsSafeArea(
  panel: ButtonBoxPanel,
  resolved: ResolvedStreamPresentation
): boolean {
  const layout = resolveTouchPresentationLayout(panel, resolved)
  const right = layout.left + layout.width * layout.scale
  const bottom = layout.top + layout.height * layout.scale
  return layout.left >= -TOUCH_LAYOUT_EPSILON &&
    layout.top >= -TOUCH_LAYOUT_EPSILON &&
    right <= resolved.content.width + TOUCH_LAYOUT_EPSILON &&
    bottom <= resolved.content.height + TOUCH_LAYOUT_EPSILON
}
