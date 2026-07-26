import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { WidgetProps } from './types'
import {
  Rc01LiveTelemetryBuffer,
  type Rc01MonotonicClock,
  rc01FieldDescription,
  rc01MonotonicNow
} from './raceconRc01Core'
import {
  RC05_EMPHASIS_EVENT,
  RC05_GAUGE_VIEWBOX,
  RC05_PRESSURE_ARC_RADIUS,
  RC05_PRESSURE_ARC_WIDTH,
  RC05_PRESSURE_MARK_INNER_RADIUS,
  RC05_PRESSURE_MARK_OUTER_RADIUS,
  RC05_PRESSURE_WINDOW_MAX_UNIT,
  RC05_PRESSURE_WINDOW_MIN_UNIT,
  RC05_TEMP_ARC_RADIUS,
  RC05_TEMP_ARC_WIDTH,
  RC05_TEMP_WINDOW_MAX_UNIT,
  RC05_TEMP_WINDOW_MIN_UNIT,
  RC05_TICK_INNER_RADIUS,
  RC05_TICK_OUTER_RADIUS,
  RC05_WINDOW_ARC_WIDTH,
  Rc05AuxBuffer,
  type Rc05Corner,
  type Rc05DashboardModel,
  type Rc05Emphasis,
  type Rc05Field,
  Rc05TrendRecorder,
  advanceRc05Alerts,
  clearInvalidRc05Alerts,
  createRc05AlertState,
  createRc05DashboardModel,
  rc05AlertInputForModel,
  rc05AlertLines,
  rc05ArcPath,
  rc05AuxChannelValue,
  rc05CompactModeForContentBox,
  rc05CornerDescription,
  rc05EmphasisFromEvent,
  rc05LayoutForContentBox,
  rc05PhoneGeometryForContentBox,
  rc05PointerPoints,
  rc05TickPath
} from './raceconRc05Core'
import './raceconRc05.css'

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

function Readout({
  label,
  value,
  unit,
  description,
  zone
}: {
  label: string
  value: Rc05Field
  unit?: string
  description?: string
  zone?: string
}): ReactElement {
  return (
    <div className="rc05-row" data-testid="rc05-row" data-rc05-zone={zone}>
      <span className="rc05-label">{label}</span>
      <output
        className={`rc05-value${value.stale ? ' is-stale' : ''}${value.unavailable ? ' is-unavailable' : ''}`}
        aria-label={rc01FieldDescription(description ?? label, value)}
      >
        {value.value}
      </output>
      {unit ? (
        <span className="rc05-unit" aria-hidden="true">
          {unit}
        </span>
      ) : null}
    </div>
  )
}

/**
 * One corner of the mandala. Every arc angle is computed from the declared 60-120 degC scale
 * (image-qa-v1 implementation note 1), never traced from the reference, so a 1 degC
 * difference always moves the pointer and two corners can never collapse onto one angle.
 *
 * The window is carried by a THICKER band plus two straight bracket ticks plus a filled
 * triangular pointer, so "in window" is a shape and not a colour (packet section 19).
 */
function CornerGauge({ corner, emphasis }: { corner: Rc05Corner; emphasis: Rc05Emphasis }): ReactElement {
  const tempKnown = corner.tempUnit !== null
  const pressureKnown = corner.pressureUnit !== null
  return (
    <article
      className="rc05-corner"
      data-testid="rc05-corner"
      data-rc05-corner={corner.corner}
      data-rc05-band={corner.tempBand}
      data-rc05-pressure-band={corner.pressureBand}
      data-rc05-overheat={corner.overheat ? 'true' : 'false'}
      data-rc05-cold={corner.coldGraining ? 'true' : 'false'}
      data-rc05-pressure-alert={corner.pressureAlert}
      data-rc05-zoom={corner.zoom ? 'true' : 'false'}
      aria-label={rc05CornerDescription(corner)}
    >
      <span className="rc05-corner-label" data-testid="rc05-corner-label">
        {corner.corner}
      </span>
      <svg
        className="rc05-gauge"
        data-testid="rc05-gauge"
        viewBox={`0 0 ${RC05_GAUGE_VIEWBOX} ${RC05_GAUGE_VIEWBOX}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
        focusable="false"
      >
        {/* The cold / window / hot thirds of the 240-degree ramp. */}
        <path
          className="rc05-ramp rc05-ramp-cold"
          d={rc05ArcPath(RC05_TEMP_ARC_RADIUS, 0, RC05_TEMP_WINDOW_MIN_UNIT)}
          strokeWidth={RC05_TEMP_ARC_WIDTH}
          fill="none"
        />
        <path
          className="rc05-ramp rc05-ramp-hot"
          d={rc05ArcPath(RC05_TEMP_ARC_RADIUS, RC05_TEMP_WINDOW_MAX_UNIT, 100)}
          strokeWidth={RC05_TEMP_ARC_WIDTH}
          fill="none"
        />
        {/* The target band: thicker than the ramp so the window reads as a shape. */}
        <path
          className="rc05-window-band"
          data-testid="rc05-window-band"
          d={rc05ArcPath(RC05_TEMP_ARC_RADIUS, RC05_TEMP_WINDOW_MIN_UNIT, RC05_TEMP_WINDOW_MAX_UNIT)}
          strokeWidth={RC05_WINDOW_ARC_WIDTH}
          fill="none"
        />
        {/* Bracket ticks at exactly the configured window bounds (image-qa-v1 note 2). */}
        <path
          className="rc05-window-tick"
          data-testid="rc05-window-tick"
          d={rc05TickPath(RC05_TICK_INNER_RADIUS, RC05_TICK_OUTER_RADIUS, RC05_TEMP_WINDOW_MIN_UNIT)}
          fill="none"
        />
        <path
          className="rc05-window-tick"
          data-testid="rc05-window-tick"
          d={rc05TickPath(RC05_TICK_INNER_RADIUS, RC05_TICK_OUTER_RADIUS, RC05_TEMP_WINDOW_MAX_UNIT)}
          fill="none"
        />
        {/* The inner pressure ring is always drawn; without TPMS it stays a bare grey ring. */}
        <path
          className="rc05-pressure-ring"
          data-testid="rc05-pressure-ring"
          d={rc05ArcPath(RC05_PRESSURE_ARC_RADIUS, 0, 100)}
          strokeWidth={RC05_PRESSURE_ARC_WIDTH}
          fill="none"
        />
        {pressureKnown ? (
          <path
            className="rc05-pressure-band"
            data-testid="rc05-pressure-band"
            d={rc05ArcPath(RC05_PRESSURE_ARC_RADIUS, RC05_PRESSURE_WINDOW_MIN_UNIT, RC05_PRESSURE_WINDOW_MAX_UNIT)}
            strokeWidth={RC05_PRESSURE_ARC_WIDTH}
            fill="none"
          />
        ) : null}
        {pressureKnown ? (
          <path
            className="rc05-pressure-mark"
            data-testid="rc05-pressure-mark"
            d={rc05TickPath(
              RC05_PRESSURE_MARK_INNER_RADIUS,
              RC05_PRESSURE_MARK_OUTER_RADIUS,
              corner.pressureUnit as number
            )}
            fill="none"
          />
        ) : null}
        {/* No pointer without a temperature: an absent sensor is never given an angle. */}
        {tempKnown ? (
          <polygon
            className="rc05-pointer"
            data-testid="rc05-pointer"
            points={rc05PointerPoints(corner.tempUnit as number)}
          />
        ) : null}
      </svg>
      <div className="rc05-gauge-readout" data-rc05-emphasis={emphasis}>
        <p className="rc05-temp-line">
          <output
            className={`rc05-value rc05-temp${corner.temp.stale ? ' is-stale' : ''}${
              corner.temp.unavailable ? ' is-unavailable' : ''
            }`}
            aria-label={rc01FieldDescription(`${corner.corner} tyre temperature`, corner.temp)}
          >
            {corner.temp.value}
          </output>
          <span className="rc05-unit rc05-temp-unit" aria-hidden="true">
            C
          </span>
        </p>
        <p className="rc05-pressure-line">
          <output
            className={`rc05-value rc05-pressure${corner.pressure.stale ? ' is-stale' : ''}${
              corner.pressure.unavailable ? ' is-unavailable' : ''
            }`}
            aria-label={rc01FieldDescription(`${corner.corner} tyre pressure`, corner.pressure)}
          >
            {corner.pressure.value}
          </output>
          <span className="rc05-unit rc05-pressure-unit" aria-hidden="true">
            BAR
          </span>
        </p>
      </div>
    </article>
  )
}

/**
 * RC-05 is an overlay-widget-owned, live-only tyre-thermal dashboard. It shares RC-01's
 * fail-closed ingest buffer, so mock and replay telemetry are refused and a source or
 * session discontinuity clears the per-corner alert latches and the measured lap trend.
 */
export interface RaceconRc05DashWidgetProps extends WidgetProps {
  monotonicClock?: Rc01MonotonicClock
}

export function RaceconRc05DashWidget({
  snapshot,
  config,
  monotonicClock = rc01MonotonicNow
}: RaceconRc05DashWidgetProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const bufferRef = useRef(new Rc01LiveTelemetryBuffer())
  const auxRef = useRef(new Rc05AuxBuffer())
  const trendRef = useRef(new Rc05TrendRecorder())
  const alertsRef = useRef(createRc05AlertState())
  const [nowMs, setNowMs] = useState(() => monotonicClock())
  const [emphasis, setEmphasis] = useState<Rc05Emphasis>('temperature')
  const box = useContentBox(rootRef, config)

  // A receipt timestamp, not a display clock: it advances only when a new snapshot object
  // or provider timestamp arrives, so a freshness tick cannot make a stale frame look fresh.
  const arrivalMs = useMemo(() => monotonicClock(), [monotonicClock, snapshot, snapshot?.timestamp])

  // Rendering mutates isolated candidates only; they are committed in the layout phase so
  // StrictMode double-renders and abandoned concurrent renders cannot advance real state.
  const candidate = bufferRef.current.clone()
  const outcome = candidate.ingest(snapshot, arrivalMs)
  const aux = auxRef.current.clone()
  const trend = trendRef.current.clone()
  if (outcome.accepted) {
    const accepted = candidate.latestSnapshot()
    aux.ingest(accepted, arrivalMs)
    // The trend samples the corner temperatures reported by THIS frame, so a corner whose
    // sensor was silent at the lap boundary records a null rather than an older reading.
    trend.observe(
      accepted && typeof accepted.currentLap === 'number' && Number.isFinite(accepted.currentLap)
        ? Math.trunc(accepted.currentLap)
        : null,
      {
        LF: accepted ? rc05AuxChannelValue(accepted, 'tyreTempLf') : null,
        RF: accepted ? rc05AuxChannelValue(accepted, 'tyreTempRf') : null,
        LR: accepted ? rc05AuxChannelValue(accepted, 'tyreTempLr') : null,
        RR: accepted ? rc05AuxChannelValue(accepted, 'tyreTempRr') : null
      }
    )
  } else if (!outcome.renderable) {
    // Fail closed: anything the buffer refuses also invalidates the aux receipts and the
    // measured lap trend, so a new source never inherits the previous car's history.
    aux.reset()
    trend.reset()
  }

  const renderSnapshot = outcome.renderable ? candidate.latestSnapshot() : null

  // Two passes: the first builds the model the alert layer reads, the second re-renders it
  // with whatever the alert layer actually latched, so no surface can escalate for an alert
  // that was cleared in the same frame.
  const provisional = createRc05DashboardModel(renderSnapshot, candidate.receipts(), aux.receipts(), nowMs, {
    alerts: alertsRef.current,
    emphasis,
    trend: trend.history()
  })
  const advanced = advanceRc05Alerts(alertsRef.current, rc05AlertInputForModel(provisional, nowMs))
  const alerts = clearInvalidRc05Alerts(advanced, provisional)
  const model: Rc05DashboardModel = createRc05DashboardModel(
    renderSnapshot,
    candidate.receipts(),
    aux.receipts(),
    nowMs,
    { alerts, emphasis, trend: trend.history() }
  )

  const layout = rc05LayoutForContentBox(box.width, box.height)
  const compactMode = rc05CompactModeForContentBox(box.width, box.height)
  const phoneGeometry = rc05PhoneGeometryForContentBox(box.width, box.height)
  const alertLines = rc05AlertLines(model)
  const alertedCorners = model.corners.filter((corner) => corner.zoom || corner.pressureAlert !== 'none')

  const responsiveStyle = phoneGeometry
    ? ({
        '--rc05-phone-inset': `${phoneGeometry.inset}px`,
        '--rc05-phone-mandala-top': `${phoneGeometry.mandalaTop}px`,
        '--rc05-phone-mandala-height': `${phoneGeometry.mandalaHeight}px`,
        '--rc05-phone-delta-top': `${phoneGeometry.deltaTop}px`,
        '--rc05-phone-delta-height': `${phoneGeometry.deltaHeight}px`,
        '--rc05-phone-context-top': `${phoneGeometry.contextTop}px`,
        '--rc05-phone-context-height': `${phoneGeometry.contextHeight}px`,
        '--rc05-phone-legend-top': `${phoneGeometry.legendTop}px`,
        '--rc05-phone-legend-height': `${phoneGeometry.legendHeight}px`,
        '--rc05-phone-toggle-size': `${phoneGeometry.toggleSize}px`
      } as CSSProperties)
    : ({} as CSSProperties)

  useLayoutEffect(() => {
    bufferRef.current = candidate
    auxRef.current = aux
    trendRef.current = trend
    alertsRef.current = alerts
  }, [candidate, aux, trend, alerts])

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(monotonicClock()), 100)
    return () => window.clearInterval(timer)
  }, [monotonicClock])

  // Packet 11.5: a soft-key toggles temperature / pressure emphasis. An unrecognised payload
  // never changes the emphasis.
  useEffect(() => {
    const handler = (event: Event): void => {
      const next = rc05EmphasisFromEvent((event as CustomEvent).detail)
      if (next !== null) setEmphasis(next)
    }
    window.addEventListener(RC05_EMPHASIS_EVENT, handler)
    return () => window.removeEventListener(RC05_EMPHASIS_EVENT, handler)
  }, [])

  const toggleEmphasis = useCallback(
    () => setEmphasis((current) => (current === 'temperature' ? 'pressure' : 'temperature')),
    []
  )

  return (
    <div
      ref={rootRef}
      className="rc05-widget"
      data-widget="raceconRc05Dash"
      data-rc05-layout={layout}
      data-rc05-compact-mode={layout === 'compact' ? compactMode : undefined}
      data-rc05-buffer-state={outcome.reason}
      data-rc05-emphasis={emphasis}
      data-rc05-alerts={alertLines.length > 0 ? 'active' : 'silent'}
      data-rc05-alert-corners={alertedCorners.map((corner) => corner.corner).join(',')}
      data-rc05-trend={model.trendMeasured ? 'measured' : 'pending'}
      data-rc05-content-width={Math.round(box.width)}
      data-rc05-content-height={Math.round(box.height)}
      style={responsiveStyle}
    >
      <main
        className="rc05-dashboard"
        aria-label="RaceCon RC-05 tyre temperature and pressure thermal window dashboard"
        data-rc05-native-size={layout === 'native' ? '800x480' : undefined}
      >
        {/* Packet 11.1: the four-corner mandala is the sole hero. */}
        <section className="rc05-mandala" data-testid="rc05-mandala" aria-label="Four-corner tyre thermal mandala">
          {model.corners.map((corner) => (
            <CornerGauge key={corner.corner} corner={corner} emphasis={model.emphasis} />
          ))}
        </section>

        {/* Packet 11.1: the centre delta links pace to tyre care. */}
        <section className="rc05-delta" data-testid="rc05-delta" aria-label="Lap delta to best">
          <span className="rc05-label">DELTA</span>
          <output
            className={`rc05-value rc05-delta-value${model.delta.stale ? ' is-stale' : ''}${
              model.delta.unavailable ? ' is-unavailable' : ''
            }`}
            data-tone={model.delta.tone}
            aria-label={rc01FieldDescription('Delta to best lap', model.delta)}
          >
            {model.delta.value}
          </output>
          <span className="rc05-unit" aria-hidden="true">
            S
          </span>
        </section>

        {/* Packet 11.1 left margin: TC step and brake temperatures. */}
        <aside className="rc05-aids" data-testid="rc05-aids" aria-label="Traction control and brake temperatures">
          <Readout label="TC" value={model.tc} description="Traction control step" zone="tc" />
          {model.brakes.map((axle) => (
            <Readout
              key={axle.axle}
              label={`BRK ${axle.axle}`}
              value={axle.value}
              unit="C"
              description={`${axle.axle === 'F' ? 'Front' : 'Rear'} axle brake temperature`}
              zone={`brake-${axle.axle.toLowerCase()}`}
            />
          ))}
        </aside>

        {/* Packet section 20: the wear estimate is labelled EST and hidden if uncalibrated. */}
        {model.wearAvailable ? (
          <aside className="rc05-wear" data-testid="rc05-wear" aria-label="Tyre wear estimate">
            <span className="rc05-label">WEAR EST</span>
            <output
              className={`rc05-value rc05-wear-value${model.wear.stale ? ' is-stale' : ''}`}
              aria-label={rc01FieldDescription('Tyre wear estimate', model.wear)}
            >
              {model.wear.value}
            </output>
            <span className="rc05-unit" aria-hidden="true">
              %
            </span>
          </aside>
        ) : null}

        {/* Packet section 19: the window legend uses three distinct SHAPES, not three hues. */}
        <aside className="rc05-legend" data-testid="rc05-legend" aria-label="Thermal window legend">
          <div className="rc05-legend-row" data-rc05-legend="cold">
            <svg className="rc05-legend-mark" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <polygon className="rc05-legend-cold" points="3,5 17,5 10,17" fill="none" />
            </svg>
            <span className="rc05-label">COLD</span>
          </div>
          <div className="rc05-legend-row" data-rc05-legend="window">
            <svg className="rc05-legend-mark" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path className="rc05-legend-window" d="M 7 4 L 3 4 L 3 16 L 7 16 M 13 4 L 17 4 L 17 16 L 13 16" fill="none" />
            </svg>
            <span className="rc05-label">IN</span>
          </div>
          <div className="rc05-legend-row" data-rc05-legend="hot">
            <svg className="rc05-legend-mark" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <polygon className="rc05-legend-hot" points="10,3 17,15 3,15" />
            </svg>
            <span className="rc05-label">HOT</span>
          </div>
        </aside>

        {/*
          Packet 12.1 trend-history-reveal: this column exists ONLY in the 1024x600 app view.
          Its content is measured, never synthesised — a corner with no observed lap boundary
          stays dashed rather than drawing a plausible curve.
        */}
        <aside
          className="rc05-trend"
          data-testid="rc05-trend"
          data-rc05-measured={model.trendMeasured ? 'true' : 'false'}
          aria-label="Per-corner tyre temperature trend over recent observed laps"
        >
          <span className="rc05-label rc05-trend-title">TREND / LAP</span>
          {model.trend.map((series) => (
            <div
              key={series.corner}
              className="rc05-trend-row"
              data-testid="rc05-trend-row"
              data-rc05-corner={series.corner}
              data-rc05-measured={series.measured ? 'true' : 'false'}
            >
              <span className="rc05-label">{series.corner}</span>
              <span className="rc05-trend-points">
                {series.measured ? (
                  series.points.map((point, index) => (
                    <span
                      key={`${series.corner}-${index}`}
                      className={`rc05-trend-point${point === null ? ' is-unavailable' : ''}`}
                      data-testid="rc05-trend-point"
                    >
                      {point === null ? '--' : String(Math.round(point))}
                    </span>
                  ))
                ) : (
                  <span className="rc05-trend-point is-unavailable" data-testid="rc05-trend-point">
                    --
                  </span>
                )}
              </span>
            </div>
          ))}
        </aside>

        {/* Packet 12.1 pressure column: the per-corner distance to the pressure window. */}
        <aside className="rc05-pressures" data-testid="rc05-pressures" aria-label="Per-corner tyre pressures">
          {model.corners.map((corner) => (
            <Readout
              key={corner.corner}
              label={corner.corner}
              value={corner.pressure}
              unit="BAR"
              description={`${corner.corner} tyre pressure`}
              zone={`pressure-${corner.corner.toLowerCase()}`}
            />
          ))}
        </aside>

        {/*
          Packet section 10 tertiary channels. They have no zone in the 11.1 grammar, so they
          live in the band the packet leaves unallocated below the mandala, and they carry the
          truth table's dash states rather than being dropped.
        */}
        <section className="rc05-peripheral" data-testid="rc05-peripheral" aria-label="Peripheral context">
          <Readout label="GEAR" value={model.gear} description="Gear" zone="gear" />
          <Readout label="SPEED" value={model.speed} unit="KM/H" description="Speed" zone="speed" />
          <Readout label="FUEL" value={model.fuelLaps} unit="LAPS" description="Fuel laps remaining" zone="fuel-laps" />
          <button
            type="button"
            className="rc05-soft-key"
            data-testid="rc05-soft-key"
            onClick={toggleEmphasis}
            aria-label={
              emphasis === 'temperature'
                ? 'Switch the corner gauges to pressure emphasis'
                : 'Switch the corner gauges to temperature emphasis'
            }
          >
            {emphasis === 'temperature' ? 'TEMP' : 'PRESS'}
          </button>
        </section>

        {/*
          Packet section 15: the alert banner is silent until a trigger fires. It carries every
          latched corner alert in every layout, so no breakpoint can hide an escalation.
        */}
        {alertLines.length > 0 ? (
          <p className="rc05-alert-line" data-testid="rc05-alert-line" role="alert">
            {alertLines.join(' \u00B7 ')}
          </p>
        ) : null}
      </main>
    </div>
  )
}
