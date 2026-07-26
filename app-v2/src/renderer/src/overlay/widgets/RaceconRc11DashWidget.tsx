import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import type { WidgetProps } from './types'
import { raceconDisplayClockFrozen, useRaceconDisplayClock } from './raceconDisplayClock'
import {
  Rc01LiveTelemetryBuffer,
  type Rc01MonotonicClock,
  rc01MonotonicNow
} from './raceconRc01Core'
import {
  RC11_DATA_GAP_LABEL,
  RC11_SECTOR_UNAVAILABLE_NOTICE,
  RC11_TYPE_SCALE_PX,
  type Rc11GapBand,
  type Rc11Marker,
  type Rc11Plot,
  type Rc11PlotId,
  type Rc11Rect,
  type Rc11Series,
  Rc11AuxBuffer,
  type Rc11DashboardModel,
  Rc11TraceBuffer,
  advanceRc11Alerts,
  clearInvalidRc11Alerts,
  createRc11AlertState,
  createRc11DashboardModel,
  dismissRc11Marker,
  rc11AlertInputForModel,
  rc11CompactModeForContentBox,
  rc11CursorCanvasXPx,
  rc11CursorDescription,
  rc11LayoutForContentBox,
  rc11LegendPlacement,
  rc11PhoneGeometryForContentBox,
  rc11PlotInsetCqw,
  rc11PlotRegionPx,
  rc11SeriesDescription,
  rc11TileDescription,
  rc11TypeScaleCqw,
  rc11ZoneStyle,
  rc11ZonesForLayout
} from './raceconRc11Core'
import './raceconRc11.css'

function configSize(config: WidgetProps['config']): { width: number; height: number } {
  const width = config?.position?.width
  const height = config?.position?.height
  return {
    width: typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : 1024,
    height: typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : 600
  }
}

function useContentBox(
  ref: React.RefObject<HTMLDivElement | null>,
  config: WidgetProps['config']
): { width: number; height: number } {
  const fallback = configSize(config)
  const [box, setBox] = useState(fallback)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return

    // The dashboard canvas can be transformed relative to its authored size, so the
    // composition size is the transformed bounding rect, not the content box.
    const measure = (): boolean => {
      const rect = element.getBoundingClientRect()
      if (!Number.isFinite(rect.width) || rect.width <= 0 || !Number.isFinite(rect.height) || rect.height <= 0) {
        return false
      }
      setBox((current) =>
        current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height }
      )
      return true
    }

    if (!measure()) setBox(fallback)

    if (typeof ResizeObserver === 'undefined') return
    const shell = element.closest<HTMLElement>('.dashboard-shell')
    const observer = new ResizeObserver(() => {
      measure()
    })
    observer.observe(element)
    if (shell && shell !== element) observer.observe(shell)
    return () => observer.disconnect()
  }, [config?.position?.width, config?.position?.height, fallback.height, fallback.width])

  return box
}

function zoneStyle(rect: Rc11Rect | undefined): CSSProperties | undefined {
  const style = rc11ZoneStyle(rect)
  return style ? (style as CSSProperties) : undefined
}

function polylinePoints(points: readonly { x: number; y: number }[], stepped: boolean): string {
  if (!stepped) return points.map((point) => `${point.x},${point.y}`).join(' ')
  // The gear staircase holds its value until the next sample, which is what a discrete channel
  // genuinely does. It is a rendering of the same samples, never an extra invented sample.
  const parts: string[] = []
  points.forEach((point, index) => {
    if (index > 0) parts.push(`${point.x},${points[index - 1].y}`)
    parts.push(`${point.x},${point.y}`)
  })
  return parts.join(' ')
}

/**
 * One trace. A dropout ENDS a run and starts a new `<polyline>`, so the renderer physically cannot
 * draw a line across a gap. A channel that is entirely absent renders the packet's grey flatline
 * rather than disappearing, and the LINE PATTERN — solid versus dashed — is what separates the two
 * laps and the two pedals before any colour is perceived.
 */
function Trace({ series }: { series: Rc11Series }): ReactElement {
  return (
    <g
      className={`rc11-trace${series.available ? '' : ' is-flatline'}${series.stale ? ' is-stale' : ''}`}
      data-testid="rc11-trace"
      data-rc11-series={series.id}
      data-rc11-trace-token={series.token}
      data-rc11-trace-style={series.style}
      data-rc11-trace-available={series.available ? 'true' : 'false'}
      data-rc11-trace-segments={series.segments.length}
      aria-label={rc11SeriesDescription(series)}
    >
      {series.available ? (
        series.segments.map((segment, index) => (
          <polyline
            key={`${series.id}-${index}`}
            className="rc11-trace-line"
            data-testid="rc11-trace-line"
            points={polylinePoints(segment, series.stepped)}
            vectorEffect="non-scaling-stroke"
          />
        ))
      ) : (
        <polyline
          className="rc11-trace-line rc11-trace-flatline"
          data-testid="rc11-trace-flatline"
          points="0,50 100,50"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  )
}

/** Packet 14/15: the dropout span is greyed and LABELLED. It is never smoothed and never bridged. */
function GapBand({ band }: { band: Rc11GapBand }): ReactElement {
  return (
    <div
      className="rc11-gap"
      data-testid="rc11-gap"
      data-rc11-gap-channel={band.channel}
      style={{ left: `${band.fromX}%`, width: `${Math.max(0.4, band.toX - band.fromX)}%` }}
      role="status"
    >
      <span className="rc11-gap-label">{RC11_DATA_GAP_LABEL}</span>
    </div>
  )
}

/**
 * Packet 15 / 19: a computed anomaly marker is a GLYPH SHAPE plus a TEXT LABEL, and its clear
 * condition is the engineer dismissing it. There is no live alarm and no auto-clear.
 */
function AnomalyMarker({
  marker,
  onDismiss
}: {
  marker: Rc11Marker
  onDismiss: (id: string) => void
}): ReactElement {
  return (
    <button
      type="button"
      className="rc11-marker"
      data-testid="rc11-marker"
      data-rc11-marker={marker.alert}
      data-rc11-marker-glyph={marker.glyph}
      data-rc11-marker-channel={marker.channel}
      style={{ left: `${marker.x}%` }}
      onClick={() => onDismiss(marker.id)}
      aria-label={`${marker.label} marker on the ${marker.channel} trace, activate to dismiss`}
    >
      <span className="rc11-marker-glyph" data-rc11-glyph={marker.glyph} aria-hidden="true" />
      <span className="rc11-marker-label">{marker.label}</span>
    </button>
  )
}

interface TracePanelProps {
  plot: Rc11Plot
  rect: Rc11Rect | undefined
  insetCqw: { left: number; right: number }
  cursorFraction: number
  cursorCanvasX: number
  plotRegion: { x0: number; x1: number }
  onScrub: (fraction: number) => void
  onDismiss: (id: string) => void
  children?: ReactElement | null
  legend?: ReactElement | null
}

/**
 * Packet zone + normative override 2: ONE `panel` rectangle per zone, with the legend region held
 * inside the same rectangle and no visible divider. The plot is inset so that all four
 * distance-domain panels draw into the SAME canvas pixels — the single hardest requirement in the
 * artifact, and the reason three earlier attempts were rejected.
 */
function TracePanel({
  plot,
  rect,
  insetCqw,
  cursorFraction,
  cursorCanvasX,
  plotRegion,
  onScrub,
  onDismiss,
  children,
  legend
}: TracePanelProps): ReactElement {
  const scrub = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const target = event.currentTarget.getBoundingClientRect()
      if (!Number.isFinite(target.width) || target.width <= 0) return
      onScrub((event.clientX - target.left) / target.width)
    },
    [onScrub]
  )

  return (
    <section
      className="rc11-panel rc11-trace-panel"
      data-testid={`rc11-panel-${plot.id}`}
      data-rc11-zone={plot.id}
      data-rc11-panel="trace"
      style={{ ...zoneStyle(rect), '--rc11-plot-left': `${insetCqw.left}cqw`, '--rc11-plot-right': `${insetCqw.right}cqw` } as CSSProperties}
      aria-label={`${plot.label} versus distance`}
    >
      <span className="rc11-axis-title" data-testid={`rc11-title-${plot.id}`}>
        {plot.label}
        {plot.unit ? <em className="rc11-axis-unit">{plot.unit}</em> : null}
      </span>
      <div
        className="rc11-plot"
        data-testid="rc11-plot"
        data-rc11-plot={plot.id}
        data-rc11-plot-x0={plotRegion.x0}
        data-rc11-plot-x1={plotRegion.x1}
        data-rc11-cursor-x={cursorCanvasX}
        onPointerDown={scrub}
      >
        <span className="rc11-axis-label rc11-axis-top" aria-hidden="true">
          {plot.axis.labels[0]}
        </span>
        <span className="rc11-axis-label rc11-axis-bottom" aria-hidden="true">
          {plot.axis.labels[plot.axis.labels.length - 1]}
        </span>
        {plot.zeroRuleAt === null ? null : (
          <span
            className="rc11-zero-rule"
            data-testid="rc11-zero-rule"
            style={{ top: `${plot.zeroRuleAt}%` }}
            aria-hidden="true"
          />
        )}
        <svg
          className="rc11-plot-svg"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          role="img"
          aria-label={`${plot.label} trace`}
          focusable="false"
        >
          {plot.shading ? (
            <rect className="rc11-delta-shade" data-testid="rc11-delta-shade" x="0" y="0" width="100" height="100" />
          ) : null}
          {plot.series.map((series) => (
            <Trace key={series.id} series={series} />
          ))}
        </svg>
        {plot.gaps.map((band) => (
          <GapBand key={band.id} band={band} />
        ))}
        {plot.markers.map((marker) => (
          <AnomalyMarker key={marker.id} marker={marker} onDismiss={onDismiss} />
        ))}
        <span
          className="rc11-cursor"
          data-testid="rc11-cursor"
          data-rc11-cursor-panel={plot.id}
          data-rc11-cursor-fraction={cursorFraction}
          style={{ left: `${cursorFraction * 100}%` }}
          aria-hidden="true"
        />
        {children}
      </div>
      {legend}
    </section>
  )
}

/**
 * RC-11 is an overlay-widget-owned, live-only engineer analysis wall. It shares RC-01's fail-closed
 * ingest buffer, so mock and replay telemetry are refused and a source or session discontinuity
 * clears the acquired trace window, the recorded reference lap and every computed marker.
 */
export interface RaceconRc11DashWidgetProps extends WidgetProps {
  monotonicClock?: Rc01MonotonicClock
}

export function RaceconRc11DashWidget({
  snapshot,
  config,
  preview,
  monotonicClock = rc01MonotonicNow
}: RaceconRc11DashWidgetProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const bufferRef = useRef(new Rc01LiveTelemetryBuffer())
  const auxRef = useRef(new Rc11AuxBuffer())
  const traceRef = useRef(new Rc11TraceBuffer())
  const alertsRef = useRef(createRc11AlertState())
  const nowMs = useRaceconDisplayClock(monotonicClock, raceconDisplayClockFrozen(preview))
  const [cursorFraction, setCursorFraction] = useState(0.5)
  const [referenceEnabled, setReferenceEnabled] = useState(true)
  const [dismissed, setDismissed] = useState<readonly string[]>([])
  const box = useContentBox(rootRef, config)

  // A receipt timestamp, not a display clock: it advances only when a new snapshot object or
  // provider timestamp arrives, so a freshness tick cannot make a stale frame look fresh.
  const arrivalMs = useMemo(() => monotonicClock(), [monotonicClock, snapshot, snapshot?.timestamp])

  // Rendering mutates isolated candidates only; they are committed in the layout phase so
  // StrictMode double-renders and abandoned concurrent renders cannot advance real state.
  const candidate = bufferRef.current.clone()
  const outcome = candidate.ingest(snapshot, arrivalMs)
  const aux = auxRef.current.clone()
  const traces = traceRef.current.clone()
  if (outcome.accepted) {
    const accepted = candidate.latestSnapshot()
    aux.ingest(accepted, arrivalMs)
    traces.ingest(accepted, arrivalMs, candidate.latestSample()?.delta ?? null)
  } else if (!outcome.renderable) {
    // Fail closed: anything the buffer refuses also invalidates the aux receipts, the acquired
    // window and the recorded reference lap, so a new source never inherits the previous session's
    // channels or overlays a reference lap that was never driven on this run.
    aux.reset()
    traces.reset()
  }

  const renderSnapshot = outcome.renderable ? candidate.latestSnapshot() : null
  const layout = rc11LayoutForContentBox(box.width, box.height)
  const compactMode = rc11CompactModeForContentBox(box.width, box.height)
  const showApp = layout === 'app'
  const samples = traces.history()
  const reference = traces.reference()

  const modelOptions = {
    samples,
    reference,
    referenceBestLapSec: traces.referenceBestLapSec(),
    referenceEnabled,
    cursorFraction,
    includeSteering: showApp
  }

  // Two passes: the first builds the model the alert layer reads, the second re-renders it with
  // whatever the alert layer actually latched, so no surface can annotate a trace whose channel was
  // invalidated in the same frame.
  const provisional = createRc11DashboardModel(renderSnapshot, candidate.receipts(), aux.receipts(), nowMs, {
    ...modelOptions,
    alerts: alertsRef.current
  })
  const seeded = { ...alertsRef.current, dismissed }
  const advanced = advanceRc11Alerts(seeded, rc11AlertInputForModel(provisional, nowMs, samples, reference))
  const alerts = clearInvalidRc11Alerts(advanced, provisional)
  const model: Rc11DashboardModel = createRc11DashboardModel(
    renderSnapshot,
    candidate.receipts(),
    aux.receipts(),
    nowMs,
    { ...modelOptions, alerts }
  )

  const zones = rc11ZonesForLayout(layout, compactMode, box)
  const phoneGeometry = rc11PhoneGeometryForContentBox(box.width, box.height)
  const plotRegion = rc11PlotRegionPx(layout, box.width)
  const cursorCanvasX = rc11CursorCanvasXPx(cursorFraction, layout, box.width)

  const responsiveStyle = {
    // Normative override 3: the ladder is arithmetic. Because the app canvas is exactly 1.28x the
    // native canvas, ONE cqw ladder gives 28/22/16/14 px at 800 wide and 35.84/28.16/20.48/17.92 px
    // at 1024 wide, and the cursor readout is never sized from the trace legend.
    '--rc11-type-tile': `${rc11TypeScaleCqw(RC11_TYPE_SCALE_PX.tileValue)}cqw`,
    '--rc11-type-cursor': `${rc11TypeScaleCqw(RC11_TYPE_SCALE_PX.cursorReadout)}cqw`,
    '--rc11-type-legend': `${rc11TypeScaleCqw(RC11_TYPE_SCALE_PX.traceLegend)}cqw`,
    '--rc11-type-axis': `${rc11TypeScaleCqw(RC11_TYPE_SCALE_PX.axisLabel)}cqw`,
    ...(phoneGeometry
      ? {
          '--rc11-phone-inset': `${phoneGeometry.inset}px`,
          '--rc11-phone-legend-height': `${phoneGeometry.legendHeight}px`,
          '--rc11-phone-axis-height': `${phoneGeometry.axisHeight}px`,
          '--rc11-phone-tile-height': `${phoneGeometry.tileHeight}px`
        }
      : {})
  } as CSSProperties

  useLayoutEffect(() => {
    bufferRef.current = candidate
    auxRef.current = aux
    traceRef.current = traces
    alertsRef.current = alerts
  }, [candidate, aux, traces, alerts])

  const onScrub = useCallback((fraction: number) => {
    if (!Number.isFinite(fraction)) return
    setCursorFraction(Math.min(1, Math.max(0, fraction)))
  }, [])

  const onDismiss = useCallback((markerId: string) => {
    setDismissed((current) =>
      current.includes(markerId) ? current : dismissRc11Marker({ ...createRc11AlertState(), dismissed: current }, markerId).dismissed
    )
  }, [])

  const plotById = (id: Rc11PlotId): Rc11Plot => model.plots.find((plot) => plot.id === id) ?? model.plots[0]
  const panelInset = (id: Rc11PlotId): { left: number; right: number } => {
    const rect = zones[id]
    return rect ? rc11PlotInsetCqw(rect, layout) : { left: 0, right: 0 }
  }

  return (
    <div
      ref={rootRef}
      className="rc11-widget"
      data-widget="raceconRc11Dash"
      data-rc11-layout={layout}
      data-rc11-compact-mode={layout === 'compact' ? compactMode : undefined}
      data-rc11-buffer-state={outcome.reason}
      data-rc11-alerts={model.markers.length > 0 || model.gapBands.length > 0 ? 'active' : 'silent'}
      data-rc11-reference={model.reference.enabled ? (model.reference.recorded ? 'overlaid' : 'armed') : 'off'}
      data-rc11-cursor-x={cursorCanvasX}
      data-rc11-samples={model.sampleCount}
      data-rc11-content-width={Math.round(box.width)}
      data-rc11-content-height={Math.round(box.height)}
      style={responsiveStyle}
    >
      <main
        className="rc11-dashboard"
        aria-label="RaceCon RC-11 trace room, race engineer analysis wall"
        data-rc11-native-size={layout === 'native' ? '800x480' : undefined}
      >
        {/*
          Packet 11.1 zone 1. The plot is inset on the right and the residual strip carries the lap
          legend and the cursor readout — one panel, no divider (normative override 2).
        */}
        <TracePanel
          plot={plotById('speed')}
          rect={zones.speed}
          insetCqw={panelInset('speed')}
          cursorFraction={cursorFraction}
          cursorCanvasX={cursorCanvasX}
          plotRegion={plotRegion}
          onScrub={onScrub}
          onDismiss={onDismiss}
          legend={
            <div className="rc11-legend rc11-legend-speed" data-testid="rc11-legend-speed" data-rc11-legend-placement={rc11LegendPlacement(zones.speed, layout)}>
              {plotById('speed').series.map((series) => (
                <span
                  key={series.id}
                  className="rc11-legend-entry"
                  data-testid="rc11-legend-entry"
                  data-rc11-legend={series.id}
                  data-rc11-legend-style={series.style}
                  data-rc11-legend-token={series.token}
                >
                  <span className="rc11-legend-swatch" aria-hidden="true" />
                  <span className="rc11-legend-label">{series.label}</span>
                </span>
              ))}
              <button
                type="button"
                className="rc11-reference-toggle"
                data-testid="rc11-reference-toggle"
                data-rc11-reference-enabled={model.reference.enabled ? 'true' : 'false'}
                onClick={() => setReferenceEnabled((current) => !current)}
                aria-pressed={model.reference.enabled}
              >
                REFERENCE {model.reference.enabled ? 'ON' : 'OFF'}
              </button>
              <span className="rc11-cursor-caption">CURSOR</span>
              <output
                className={`rc11-cursor-readout${model.cursor.speed.stale ? ' is-stale' : ''}${model.cursor.speed.unavailable ? ' is-unavailable' : ''}`}
                data-testid="rc11-cursor-speed"
                data-tone={model.cursor.speed.tone}
                aria-label={rc11CursorDescription(model)}
              >
                {model.cursor.speed.value}
              </output>
            </div>
          }
        />

        {/* Packet 11.1 zone 2. Throttle solid cyan, brake dashed near-white; steering is app-only. */}
        <TracePanel
          plot={plotById('inputs')}
          rect={zones.inputs}
          insetCqw={panelInset('inputs')}
          cursorFraction={cursorFraction}
          cursorCanvasX={cursorCanvasX}
          plotRegion={plotRegion}
          onScrub={onScrub}
          onDismiss={onDismiss}
          legend={
            <div className="rc11-legend rc11-legend-inputs" data-testid="rc11-legend-inputs" data-rc11-legend-placement={rc11LegendPlacement(zones.inputs, layout)}>
              {plotById('inputs').series.map((series) => (
                <span
                  key={series.id}
                  className="rc11-legend-entry"
                  data-testid="rc11-legend-entry"
                  data-rc11-legend={series.id}
                  data-rc11-legend-style={series.style}
                  data-rc11-legend-token={series.token}
                >
                  <span className="rc11-legend-swatch" aria-hidden="true" />
                  <span className="rc11-legend-label">{series.label}</span>
                </span>
              ))}
            </div>
          }
        />

        {/* Packet 11.1 zone 3: the stepped gear staircase, never derived from RPM or speed. */}
        <TracePanel
          plot={plotById('gear')}
          rect={zones.gear}
          insetCqw={panelInset('gear')}
          cursorFraction={cursorFraction}
          cursorCanvasX={cursorCanvasX}
          plotRegion={plotRegion}
          onScrub={onScrub}
          onDismiss={onDismiss}
        />

        {/*
          Packet 11.1 zone 4. Hard rule 1: the delta trace is `info` cyan along its WHOLE length,
          above and below the zero rule — never traffic-light coloured. The shared distance axis
          lives at the foot of this panel, and every one of its ticks is a dash because section 16
          defines no lap-distance channel.
        */}
        <TracePanel
          plot={plotById('delta')}
          rect={zones.delta}
          insetCqw={panelInset('delta')}
          cursorFraction={cursorFraction}
          cursorCanvasX={cursorCanvasX}
          plotRegion={plotRegion}
          onScrub={onScrub}
          onDismiss={onDismiss}
        >
          <output
            className={`rc11-cursor-readout rc11-delta-readout${model.cursor.delta.stale ? ' is-stale' : ''}${model.cursor.delta.unavailable ? ' is-unavailable' : ''}`}
            data-testid="rc11-cursor-delta"
            data-tone={model.cursor.delta.tone}
            aria-label={rc11CursorDescription(model)}
          >
            {model.cursor.delta.value}
          </output>
        </TracePanel>

        <div
          className="rc11-distance-axis"
          data-testid="rc11-distance-axis"
          style={
            {
              ...zoneStyle(zones.delta),
              '--rc11-plot-left': `${panelInset('delta').left}cqw`,
              '--rc11-plot-right': `${panelInset('delta').right}cqw`
            } as CSSProperties
          }
          aria-label="Shared distance axis, no lap-distance channel available"
        >
          <span className="rc11-axis-title">DISTANCE</span>
          <div className="rc11-distance-ticks">
            {model.distanceTicks.map((tick) => (
              <span
                key={tick.index}
                className="rc11-distance-tick is-unavailable"
                data-testid="rc11-distance-tick"
                data-rc11-tick={tick.index}
                style={{ left: `${tick.x}%` }}
              >
                {tick.label}
              </span>
            ))}
          </div>
        </div>

        {/*
          Packet 11.1 zone 5. Normative override 4: identical units per g on both axes, TRUE circles
          for the guide rings and a labelled g scale. A sample is drawn only when both IMU axes
          report — an invalid IMU hides the sample rather than plotting a half-truth.
        */}
        <section
          className="rc11-panel rc11-gg"
          data-testid="rc11-panel-gg"
          data-rc11-zone="gg"
          data-rc11-panel="gg"
          data-rc11-gg-available={model.ggAvailable ? 'true' : 'false'}
          data-rc11-gg-points={model.ggPoints.length}
          style={zoneStyle(zones.gg)}
          aria-label="Lateral versus longitudinal G scatter"
        >
          <span className="rc11-axis-title rc11-gg-long">LONG G</span>
          <div className="rc11-gg-square" data-testid="rc11-gg-square">
            <svg
              className="rc11-gg-svg"
              viewBox="0 0 100 100"
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label="G-G scatter, plus or minus 2.0 g on both axes"
              focusable="false"
            >
              <line className="rc11-gg-rule" x1="0" y1="50" x2="100" y2="50" />
              <line className="rc11-gg-rule" x1="50" y1="0" x2="50" y2="100" />
              {model.ggRings.map((ring) => (
                <circle
                  key={ring.g}
                  className="rc11-gg-ring"
                  data-testid="rc11-gg-ring"
                  data-rc11-ring-g={ring.g}
                  cx="50"
                  cy="50"
                  r={ring.diameterPct / 2}
                />
              ))}
              {model.ggPoints.map((point, index) => (
                <circle
                  key={`gg-${index}`}
                  className="rc11-gg-dot"
                  data-testid="rc11-gg-dot"
                  cx={point.x}
                  cy={point.y}
                  r="1.1"
                />
              ))}
            </svg>
            {model.ggRings.map((ring) => (
              <span
                key={`label-${ring.g}`}
                className="rc11-gg-ring-label"
                data-testid="rc11-gg-ring-label"
                style={{ left: `${50 + ring.diameterPct / 2}%` }}
              >
                {ring.label}
              </span>
            ))}
          </div>
          <span className="rc11-axis-title rc11-gg-lat">LAT G</span>
        </section>

        {/*
          Packet 11.1 zone 6. Numeral hierarchy is tile-driven: these are the tallest glyphs in the
          frame. Each corner is independent — packet 16 forbids mirroring one corner onto another —
          and the front brake temperature exists only when both front corners report.
        */}
        <section
          className="rc11-panel rc11-tiles"
          data-testid="rc11-panel-tiles"
          data-rc11-zone="tiles"
          data-rc11-panel="tiles"
          style={zoneStyle(zones.tiles)}
          aria-label="Tyre and brake window tiles"
        >
          {model.tiles.map((entry) => (
            <div
              key={entry.id}
              className="rc11-tile"
              data-testid="rc11-tile"
              data-rc11-tile={entry.id}
              data-rc11-tile-available={entry.value.unavailable ? 'false' : 'true'}
            >
              <span className="rc11-tile-label">{entry.label}</span>
              <span className="rc11-tile-row">
                <output
                  className={`rc11-tile-value${entry.value.stale ? ' is-stale' : ''}${entry.value.unavailable ? ' is-unavailable' : ''}`}
                  data-testid={`rc11-${entry.id}`}
                  data-tone={entry.value.tone}
                  aria-label={rc11TileDescription(entry)}
                >
                  {entry.value.value}
                </output>
                <span className="rc11-tile-unit">{entry.unit}</span>
              </span>
            </div>
          ))}
        </section>

        {/*
          Packet 12.1's app-only reveal. A mini-sector needs a lap-distance or sector channel to
          bound it and section 16 defines neither, so the table publishes NO ROWS and states its own
          unavailability in words: a row count would itself be an invented number.
        */}
        {showApp ? (
          <section
            className="rc11-panel rc11-sectors"
            data-testid="rc11-panel-sectors"
            data-rc11-zone="sectors"
            data-rc11-panel="sectors"
            data-rc11-sectors-available={model.sectorsAvailable ? 'true' : 'false'}
            data-rc11-sector-rows={model.sectorRows.length}
            style={zoneStyle(zones.sectors)}
            aria-label="Corner-by-corner time loss table"
          >
            <span className="rc11-axis-title">MINI SECTORS</span>
            {model.sectorRows.map((row) => (
              <span key={row.id} className="rc11-sector-row" data-testid="rc11-sector-row">
                <span className="rc11-sector-label">{row.label}</span>
                <span className="rc11-sector-value">{row.value}</span>
              </span>
            ))}
            <p className="rc11-sector-notice" data-testid="rc11-sector-notice">
              {RC11_SECTOR_UNAVAILABLE_NOTICE}
            </p>
          </section>
        ) : null}
      </main>
    </div>
  )
}
