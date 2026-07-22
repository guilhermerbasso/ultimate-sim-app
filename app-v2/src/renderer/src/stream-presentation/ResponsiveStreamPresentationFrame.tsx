import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type RefObject
} from 'react'
import { resolveStreamPresentation } from '../../../shared/stream-presentation'
import type { StreamSafeAreaInsets } from '../../../shared/stream-presentation'
import {
  StreamPresentationRenderer,
  type StreamPresentationRendererProps
} from './StreamPresentationRenderer'
import {
  calculateStreamPresentationFrameLayout,
  effectiveStreamPresentationSafeArea,
  emptyStreamPresentationFrameMeasurement,
  streamPresentationFrameMeasurementsEqual,
  streamPresentationStageClearance,
  touchPresentationFitsSafeArea,
  withStreamPresentationSafeArea,
  type StreamPresentationFrameMeasurement
} from './responsive-frame'
import './stream-presentation.css'

export type ResponsiveStreamPresentationFrameProps = Omit<
  StreamPresentationRendererProps,
  'safeAreaOverride'
> & {
  className?: string
  style?: CSSProperties
  gutter?: number
  viewportAware?: boolean
}

function finiteCssPixels(value: string | null | undefined): number {
  const parsed = Number.parseFloat(value ?? '')
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

function stablePixel(value: number): number {
  return Number.isFinite(value) ? Math.round(Math.max(0, value) * 1_000) / 1_000 : 0
}

function readCssSafeArea(probe: HTMLElement | null): StreamSafeAreaInsets {
  if (!probe) return { top: 0, right: 0, bottom: 0, left: 0 }
  const style = window.getComputedStyle(probe)
  return {
    top: stablePixel(finiteCssPixels(style.paddingTop)),
    right: stablePixel(finiteCssPixels(style.paddingRight)),
    bottom: stablePixel(finiteCssPixels(style.paddingBottom)),
    left: stablePixel(finiteCssPixels(style.paddingLeft))
  }
}

function measuredHost(
  host: HTMLElement,
  probe: HTMLElement | null,
  viewportAware: boolean
): StreamPresentationFrameMeasurement {
  const rect = host.getBoundingClientRect()
  const hostWidth = stablePixel(rect.width || host.clientWidth)
  const hostHeight = stablePixel(rect.height || host.clientHeight)
  let x = 0
  let y = 0
  let width = hostWidth
  let height = hostHeight
  const visualViewport = viewportAware ? window.visualViewport : null
  if (visualViewport && visualViewport.width > 0 && visualViewport.height > 0) {
    x = stablePixel(Math.min(hostWidth, Math.max(0, visualViewport.offsetLeft - rect.left)))
    y = stablePixel(Math.min(hostHeight, Math.max(0, visualViewport.offsetTop - rect.top)))
    width = stablePixel(Math.min(Math.max(0, hostWidth - x), visualViewport.width))
    height = stablePixel(Math.min(Math.max(0, hostHeight - y), visualViewport.height))
  }
  return {
    hostWidth,
    hostHeight,
    viewport: { x, y, width, height },
    safeArea: readCssSafeArea(probe)
  }
}

export function useStreamPresentationFrameMeasurement(
  hostRef: RefObject<HTMLDivElement | null>,
  safeAreaProbeRef: RefObject<HTMLSpanElement | null>,
  viewportAware: boolean
): StreamPresentationFrameMeasurement {
  const [measurement, setMeasurement] = useState<StreamPresentationFrameMeasurement>(
    emptyStreamPresentationFrameMeasurement
  )
  const measure = useCallback((): void => {
    const host = hostRef.current
    if (!host) return
    const next = measuredHost(host, safeAreaProbeRef.current, viewportAware)
    setMeasurement((current) => streamPresentationFrameMeasurementsEqual(current, next) ? current : next)
  }, [hostRef, safeAreaProbeRef, viewportAware])

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    measure()
    const ResizeObserverCtor = typeof ResizeObserver === 'undefined' ? null : ResizeObserver
    const observer = ResizeObserverCtor ? new ResizeObserverCtor(measure) : null
    observer?.observe(host)
    const visualViewport = viewportAware ? window.visualViewport : null
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    visualViewport?.addEventListener('resize', measure)
    visualViewport?.addEventListener('scroll', measure)
    const orientation = window.screen?.orientation
    orientation?.addEventListener?.('change', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
      visualViewport?.removeEventListener('resize', measure)
      visualViewport?.removeEventListener('scroll', measure)
      orientation?.removeEventListener?.('change', measure)
    }
  }, [hostRef, measure, viewportAware])

  return measurement
}

function safeAreaData(insets: StreamSafeAreaInsets): string {
  return `${insets.top}/${insets.right}/${insets.bottom}/${insets.left}`
}

export function ResponsiveStreamPresentationFrame({
  className = '',
  style,
  gutter,
  viewportAware,
  profile,
  dashboard = null,
  touchPanel = null,
  snapshot = null,
  mode,
  interactiveTouch = false,
  onTouchAction,
  reportTouchLifecycle = false,
  ariaLabel,
  unavailableLabel
}: ResponsiveStreamPresentationFrameProps): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)
  const safeAreaProbeRef = useRef<HTMLSpanElement>(null)
  const watchesVisualViewport = viewportAware ?? mode === 'runtime'
  const measurement = useStreamPresentationFrameMeasurement(
    hostRef,
    safeAreaProbeRef,
    watchesVisualViewport
  )
  const canonical = useMemo(() => resolveStreamPresentation(profile), [profile])
  const preservesRuntimeTouchTargets = mode === 'runtime' &&
    profile.target.kind === 'touch' && interactiveTouch
  const layout = useMemo(() => calculateStreamPresentationFrameLayout(
    measurement,
    canonical.viewport,
    {
      gutter: gutter ?? (mode === 'preview' ? 22 : 0),
      minimumScale: preservesRuntimeTouchTargets ? 1 : 0
    }
  ), [canonical.viewport, gutter, measurement, mode, preservesRuntimeTouchTargets])
  const stageClearance = useMemo(
    () => streamPresentationStageClearance(measurement, layout),
    [measurement, layout]
  )
  const effectiveSafeArea = useMemo(() => mode === 'runtime'
    ? effectiveStreamPresentationSafeArea(
        canonical.safeArea,
        measurement.safeArea,
        layout.scale,
        canonical.viewport,
        stageClearance
      )
    : canonical.safeArea,
  [canonical.safeArea, canonical.viewport, layout.scale, measurement.safeArea, mode, stageClearance])
  const effectiveResolved = useMemo(
    () => withStreamPresentationSafeArea(profile, canonical, effectiveSafeArea),
    [profile, canonical, effectiveSafeArea]
  )
  const touchLayoutCompatible = useMemo(() => !touchPanel ||
    touchPresentationFitsSafeArea(touchPanel, effectiveResolved),
  [effectiveResolved, touchPanel])
  const incompatibleTouch = preservesRuntimeTouchTargets && !touchLayoutCompatible
  const scrollableTouchFrame = preservesRuntimeTouchTargets && layout.scrollable
  const controlledTouchScroll = scrollableTouchFrame && !incompatibleTouch
  const scaledTouchPreview = mode === 'preview' &&
    profile.target.kind === 'touch' && interactiveTouch && layout.measured &&
    (layout.scale < 1 || !touchLayoutCompatible)
  const touchCompatibility = profile.target.kind !== 'touch'
    ? 'not-applicable'
    : incompatibleTouch
      ? 'incompatible'
      : controlledTouchScroll
        ? 'scroll'
        : scaledTouchPreview
          ? 'preview-scaled'
          : 'ready'
  const warning = incompatibleTouch
    ? `This Touch Controls layout cannot fit its presentation safe area at the ${effectiveResolved.minimumTouchTarget}px minimum. Edit the profile before using interactive controls.`
    : controlledTouchScroll
      ? `Touch targets remain at least ${effectiveResolved.minimumTouchTarget}px. Scroll to reach the complete presentation.`
      : scaledTouchPreview
        ? 'This editor preview is scaled to fit. Touch controls are display-only here; test them at full size on an authenticated receiver.'
        : null
  const frameClassName = [
    'stream-presentation-frame',
    `is-${mode}`,
    scrollableTouchFrame ? 'is-scrollable' : '',
    className
  ].filter(Boolean).join(' ')
  const surfaceStyle: CSSProperties = layout.measured
    ? { width: layout.surfaceWidth, height: layout.surfaceHeight }
    : { width: '100%', height: '100%' }
  const stageStyle: CSSProperties = {
    width: canonical.viewport.width,
    height: canonical.viewport.height,
    visibility: layout.measured ? 'visible' : 'hidden',
    transform: layout.measured
      ? `translate3d(${layout.left}px, ${layout.top}px, 0) scale(${layout.scale})`
      : 'translate3d(0, 0, 0) scale(0)'
  }

  return (
    <div
      ref={hostRef}
      className={frameClassName}
      style={style}
      data-presentation-frame="true"
      data-frame-measured={layout.measured ? 'true' : 'false'}
      data-frame-scale={layout.scale}
      data-frame-contain-scale={layout.containScale}
      data-stage-left={layout.left}
      data-stage-top={layout.top}
      data-stage-width={layout.renderedWidth}
      data-stage-height={layout.renderedHeight}
      data-frame-viewport={`${measurement.viewport.width}x${measurement.viewport.height}`}
      data-css-safe-area={safeAreaData(measurement.safeArea)}
      data-effective-safe-area={safeAreaData(effectiveSafeArea)}
      data-touch-compatibility={touchCompatibility}
    >
      <span ref={safeAreaProbeRef} className="stream-presentation-safe-area-probe" aria-hidden="true" />
      <div className="stream-presentation-frame-scroll" data-presentation-frame-scroll="true">
        <div className="stream-presentation-frame-surface" style={surfaceStyle}>
          <div className="stream-presentation-frame-stage" style={stageStyle}>
            <StreamPresentationRenderer
              profile={profile}
              dashboard={dashboard}
              touchPanel={touchPanel}
              snapshot={snapshot}
              mode={mode}
              interactiveTouch={interactiveTouch && !incompatibleTouch && !scaledTouchPreview}
              onTouchAction={onTouchAction}
              reportTouchLifecycle={reportTouchLifecycle}
              safeAreaOverride={mode === 'runtime' ? effectiveSafeArea : undefined}
              ariaLabel={ariaLabel}
              unavailableLabel={unavailableLabel}
            />
          </div>
        </div>
      </div>
      {warning ? (
        <div className={`stream-presentation-frame-warning is-${touchCompatibility}`} role="status">
          {warning}
        </div>
      ) : null}
    </div>
  )
}

export default ResponsiveStreamPresentationFrame
