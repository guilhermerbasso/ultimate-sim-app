import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { WidgetProps } from './types'
import {
  Rc01LiveTelemetryBuffer,
  type Rc01MonotonicClock,
  rc01FieldDescription,
  rc01MonotonicNow
} from './raceconRc01Core'
import {
  RC08_GRIP_HISTORY_WINDOW_MS,
  RC08_GRIP_TOGGLE_EVENT,
  Rc08AuxBuffer,
  type Rc08CornerModel,
  type Rc08DashboardModel,
  type Rc08Field,
  type Rc08GripState,
  Rc08GripHistory,
  type Rc08Rect,
  type Rc08TimelineSegment,
  advanceRc08Alerts,
  clearInvalidRc08Alerts,
  createRc08AlertState,
  createRc08DashboardModel,
  rc08AlertInputForModel,
  rc08AlertLines,
  rc08ColumnScale,
  rc08ColumnWeights,
  rc08CornerDescription,
  rc08CompactModeForContentBox,
  rc08GripDescription,
  rc08GripStateFromEvent,
  rc08LayoutForContentBox,
  rc08NestedRect,
  rc08Percent,
  rc08PhoneGeometryForContentBox,
  rc08TimelineSegments,
  rc08TypeScaleCqw,
  RC08_TYPE_SCALE_PX,
  RC08_TYPE_WEIGHTS,
  rc08ZoneStyle,
  rc08ZonesForLayout
} from './raceconRc08Core'
import './raceconRc08.css'

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

function zoneStyle(rect: Rc08Rect | undefined): CSSProperties | undefined {
  const style = rc08ZoneStyle(rect)
  return style ? (style as CSSProperties) : undefined
}

/** A label / value row. Packet 11.2's label-to-value ratio, values right-aligned. */
function Row({
  label,
  unit,
  value,
  description,
  rung,
  zone,
  faulted
}: {
  label: string
  unit?: string
  value: Rc08Field
  description?: string
  rung: 'aid' | 'secondary'
  zone: string
  faulted?: boolean
}): ReactElement {
  return (
    <div
      className="rc08-row"
      data-testid="rc08-row"
      data-rc08-row={zone}
      data-rc08-rung={rung}
      data-rc08-faulted={faulted ? 'true' : 'false'}
    >
      <span className="rc08-label">
        {label}
        {unit ? <span className="rc08-unit">{unit}</span> : null}
      </span>
      <output
        className={`rc08-value${value.stale ? ' is-stale' : ''}${value.unavailable ? ' is-unavailable' : ''}`}
        data-testid={`rc08-${zone}`}
        data-tone={value.tone}
        aria-label={rc01FieldDescription(description ?? label, value)}
      >
        {value.value}
      </output>
    </div>
  )
}

/** A pace-column cell: the label above its value, so the narrow column never wraps a row. */
function PaceCell({
  label,
  unit,
  value,
  description,
  rung,
  zone
}: {
  label: string
  unit?: string
  value: Rc08Field
  description?: string
  rung: 'delta' | 'secondary'
  zone: string
}): ReactElement {
  return (
    <div className="rc08-cell" data-testid="rc08-cell" data-rc08-cell={zone} data-rc08-rung={rung}>
      <span className="rc08-label">
        {label}
        {unit ? <span className="rc08-unit">{unit}</span> : null}
      </span>
      <output
        className={`rc08-value${value.stale ? ' is-stale' : ''}${value.unavailable ? ' is-unavailable' : ''}`}
        data-testid={`rc08-${zone}`}
        data-tone={value.tone}
        aria-label={rc01FieldDescription(description ?? label, value)}
      >
        {value.value}
      </output>
    </div>
  )
}

/**
 * One tyre corner. Packet 16 forbids mirroring a corner: a corner without its own sensor shows
 * the grey dash and never its neighbour's number. The cold marker is the packet 15 alert
 * surface and appears only while that alert is latched on this specific corner.
 */
function CornerCell({ corner }: { corner: Rc08CornerModel }): ReactElement {
  return (
    <div
      className={`rc08-corner${corner.cold ? ' is-cold' : ''}`}
      data-testid="rc08-corner"
      data-rc08-corner={corner.corner}
      data-rc08-crossover={corner.crossover ?? 'none'}
      data-rc08-cold={corner.cold ? 'true' : 'false'}
    >
      <span className="rc08-label">{corner.corner}</span>
      <output
        className={`rc08-corner-value${corner.field.stale ? ' is-stale' : ''}${corner.field.unavailable ? ' is-unavailable' : ''}`}
        data-testid={`rc08-corner-${corner.corner}`}
        data-tone={corner.field.tone}
        aria-label={rc08CornerDescription(corner)}
      >
        {corner.field.value}
      </output>
      {corner.cold ? (
        <span className="rc08-corner-cold" data-testid="rc08-corner-cold" role="alert">
          <span className="rc08-sr">{corner.corner} cold in the wet</span>
        </span>
      ) : null}
    </div>
  )
}

/** One measured grip-history segment. App-only, packet 12.1. */
function TimelineSegment({ segment }: { segment: Rc08TimelineSegment }): ReactElement {
  return (
    <span
      className="rc08-timeline-segment"
      data-testid="rc08-timeline-segment"
      data-rc08-grip={segment.state}
      style={{ left: rc08Percent(segment.leftPercent), width: rc08Percent(segment.widthPercent) }}
      aria-label={`Grip ${segment.state}`}
      role="img"
    />
  )
}

/**
 * RC-08 is an overlay-widget-owned, live-only wet-conditions display. It shares RC-01's
 * fail-closed ingest buffer, so mock and replay telemetry are refused and a source or session
 * discontinuity clears the measured grip history and every latched alert.
 */
export interface RaceconRc08DashWidgetProps extends WidgetProps {
  monotonicClock?: Rc01MonotonicClock
}

export function RaceconRc08DashWidget({
  snapshot,
  config,
  monotonicClock = rc01MonotonicNow
}: RaceconRc08DashWidgetProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const bufferRef = useRef(new Rc01LiveTelemetryBuffer())
  const auxRef = useRef(new Rc08AuxBuffer())
  const historyRef = useRef(new Rc08GripHistory())
  const alertsRef = useRef(createRc08AlertState())
  const [nowMs, setNowMs] = useState(() => monotonicClock())
  const [driverGripState, setDriverGripState] = useState<Rc08GripState | 'auto'>('auto')
  const box = useContentBox(rootRef, config)

  // A receipt timestamp, not a display clock: it advances only when a new snapshot object or
  // provider timestamp arrives, so a freshness tick cannot make a stale frame look fresh.
  const arrivalMs = useMemo(() => monotonicClock(), [monotonicClock, snapshot, snapshot?.timestamp])

  // Rendering mutates isolated candidates only; they are committed in the layout phase so
  // StrictMode double-renders and abandoned concurrent renders cannot advance real state.
  const candidate = bufferRef.current.clone()
  const outcome = candidate.ingest(snapshot, arrivalMs)
  const aux = auxRef.current.clone()
  const history = historyRef.current.clone()
  if (outcome.accepted) {
    aux.ingest(candidate.latestSnapshot(), arrivalMs)
  } else if (!outcome.renderable) {
    // Fail closed: anything the buffer refuses also invalidates the aux receipts and the
    // measured grip history, so a new source never inherits the previous car's conditions.
    aux.reset()
    history.reset()
  }

  const renderSnapshot = outcome.renderable ? candidate.latestSnapshot() : null

  // Two passes: the first builds the model the alert layer reads, the second re-renders it with
  // whatever the alert layer actually latched, so no surface can escalate for an alert that was
  // cleared in the same frame.
  const provisional = createRc08DashboardModel(renderSnapshot, candidate.receipts(), aux.receipts(), nowMs, {
    alerts: alertsRef.current,
    driverGripState
  })
  const advanced = advanceRc08Alerts(alertsRef.current, rc08AlertInputForModel(provisional, nowMs))
  const alerts = clearInvalidRc08Alerts(advanced, provisional)
  const model: Rc08DashboardModel = createRc08DashboardModel(
    renderSnapshot,
    candidate.receipts(),
    aux.receipts(),
    nowMs,
    { alerts, driverGripState }
  )

  // The history is MEASURED: only a confirmed regime opens a segment, so a period without a
  // grip feed leaves a real gap in the track instead of being back-filled from its neighbour.
  if (outcome.accepted) history.observe({ nowMs: arrivalMs, state: model.regime })

  const layout = rc08LayoutForContentBox(box.width, box.height)
  const compactMode = rc08CompactModeForContentBox(box.width, box.height)
  const zones = rc08ZonesForLayout(layout, compactMode, model.regime)
  const weights = rc08ColumnWeights(layout === 'app' ? 'app' : 'native', model.regime)
  const scale = rc08ColumnScale(layout === 'app' ? 'app' : 'native', model.regime)
  const phoneGeometry = rc08PhoneGeometryForContentBox(box.width, box.height)
  const alertLines = rc08AlertLines(model)
  const showApp = layout === 'app'
  const timeline = showApp ? rc08TimelineSegments(history.entries(), nowMs, RC08_GRIP_HISTORY_WINDOW_MS) : []

  const responsiveStyle = {
    '--rc08-grip-hue': model.grip.hue ?? 'var(--rc08-secondary)',
    '--rc08-type-grip': `${rc08TypeScaleCqw(RC08_TYPE_SCALE_PX.grip)}cqw`,
    '--rc08-type-delta': `${rc08TypeScaleCqw(RC08_TYPE_SCALE_PX.delta)}cqw`,
    '--rc08-type-aid': `${rc08TypeScaleCqw(RC08_TYPE_SCALE_PX.aid)}cqw`,
    '--rc08-type-corner': `${rc08TypeScaleCqw(RC08_TYPE_SCALE_PX.corner)}cqw`,
    '--rc08-type-secondary': `${rc08TypeScaleCqw(RC08_TYPE_SCALE_PX.secondary)}cqw`,
    '--rc08-type-label': `${rc08TypeScaleCqw(RC08_TYPE_SCALE_PX.label)}cqw`,
    // Normative override 5: the delta keeps 11.2's larger SIZE while TC/ABS carry section 10's
    // primacy through weight, position and the width of the column they live in.
    '--rc08-weight-grip': String(RC08_TYPE_WEIGHTS.grip),
    '--rc08-weight-aid': String(RC08_TYPE_WEIGHTS.aid),
    '--rc08-weight-delta': String(RC08_TYPE_WEIGHTS.delta),
    '--rc08-scale-aids': String(scale.aids),
    '--rc08-scale-pace': String(scale.pace),
    '--rc08-scale-tire': String(scale.tire),
    ...(phoneGeometry
      ? {
          '--rc08-phone-inset': `${phoneGeometry.inset}px`,
          '--rc08-phone-banner-height': `${phoneGeometry.bannerHeight}px`,
          '--rc08-phone-ribbon-height': `${phoneGeometry.ribbonHeight}px`,
          '--rc08-phone-row-height': `${phoneGeometry.rowHeight}px`,
          '--rc08-phone-corner-height': `${phoneGeometry.cornerHeight}px`,
          '--rc08-phone-toggle-size': `${phoneGeometry.toggleSize}px`
        }
      : {})
  } as CSSProperties

  useLayoutEffect(() => {
    bufferRef.current = candidate
    auxRef.current = aux
    historyRef.current = history
    alertsRef.current = alerts
  }, [candidate, aux, history, alerts])

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(monotonicClock()), 100)
    return () => window.clearInterval(timer)
  }, [monotonicClock])

  // Packet 11.5 and 20: the grip state comes from a real sensor OR an explicit driver toggle.
  // An unrecognised payload never changes the state, and 'auto' hands the display back to the
  // measured track-condition feed rather than latching the driver's last assertion for ever.
  useEffect(() => {
    const handler = (event: Event): void => {
      const next = rc08GripStateFromEvent((event as CustomEvent).detail)
      if (next !== null) setDriverGripState(next)
    }
    window.addEventListener(RC08_GRIP_TOGGLE_EVENT, handler)
    return () => window.removeEventListener(RC08_GRIP_TOGGLE_EVENT, handler)
  }, [])

  const ribbonRect = zones.ribbon && zones.aids ? rc08NestedRect(zones.ribbon, zones.aids) : null
  const crossoverRect =
    showApp && zones.crossover && zones.tire ? rc08NestedRect(zones.crossover, zones.tire) : null

  return (
    <div
      ref={rootRef}
      className="rc08-widget"
      data-widget="raceconRc08Dash"
      data-rc08-layout={layout}
      data-rc08-compact-mode={layout === 'compact' ? compactMode : undefined}
      data-rc08-buffer-state={outcome.reason}
      data-rc08-grip={model.grip.state ?? 'unavailable'}
      data-rc08-grip-source={model.grip.source}
      data-rc08-grip-stale={model.grip.stale ? 'true' : 'false'}
      data-rc08-regime={model.regime ?? 'unknown'}
      data-rc08-weather={model.weatherFeed.available ? 'live' : 'unavailable'}
      data-rc08-column-widths={`${weights.aids}/${weights.pace}/${weights.tire}`}
      data-rc08-alerts={alertLines.length > 0 ? 'active' : 'silent'}
      data-rc08-alert-keys={alertLines.join(',')}
      data-rc08-content-width={Math.round(box.width)}
      data-rc08-content-height={Math.round(box.height)}
      style={responsiveStyle}
    >
      <main
        className="rc08-dashboard"
        aria-label="RaceCon RC-08 rain line, changing wet conditions"
        data-rc08-native-size={layout === 'native' ? '800x480' : undefined}
      >
        {/*
          Packet 11.1 honesty banner. It states which of the two lawful grip sources is in use
          and whether the weather feed exists at all. Packet 19: the answer is always a WORD.
        */}
        <section
          className="rc08-banner"
          data-testid="rc08-banner"
          data-rc08-zone="banner"
          data-rc08-weather={model.weatherFeed.available ? 'live' : 'unavailable'}
          style={zoneStyle(zones.banner)}
          aria-label="Grip source and weather feed status"
        >
          <span className="rc08-label">GRIP SOURCE</span>
          <output
            className={`rc08-banner-source${model.grip.source === 'none' ? ' is-unavailable' : ''}`}
            data-testid="rc08-grip-source"
            data-rc08-grip-source={model.grip.source}
          >
            {model.grip.sourceLabel}
          </output>
          <output
            className={`rc08-banner-feed${model.weatherFeed.available ? '' : ' is-unavailable'}`}
            data-testid="rc08-weather-feed"
          >
            {model.weatherFeed.label}
          </output>
        </section>

        {/*
          Packet 11.1 grip/aids column — the widest column in the wet and the narrowest in the
          dry. The width IS the artifact's thesis, so it is computed from the confirmed grip
          state; with no confirmed state the three columns go equal rather than implying a
          regime the display cannot measure.
        */}
        <section
          className="rc08-column rc08-aids"
          data-testid="rc08-aids"
          data-rc08-zone="aids"
          data-rc08-width={weights.aids}
          data-rc08-fault={model.alerts.aidsFault ? 'true' : 'false'}
          style={zoneStyle(zones.aids)}
          aria-label="Grip state and driver aids"
        >
          {/* Packet 11.1 grip-state ribbon, nested inside the aids column at its own 12.5 %. */}
          <section
            className="rc08-ribbon"
            data-testid="rc08-ribbon"
            data-rc08-zone="ribbon"
            data-rc08-grip={model.grip.state ?? 'unavailable'}
            style={ribbonRect ? { flexBasis: rc08Percent(ribbonRect.height) } : undefined}
            aria-label={rc08GripDescription(model.grip)}
          >
            <span className="rc08-label">GRIP STATE</span>
            <output
              className={`rc08-grip-word${model.grip.stale ? ' is-stale' : ''}${model.grip.unavailable ? ' is-unavailable' : ''}`}
              data-testid="rc08-grip"
              data-rc08-grip={model.grip.state ?? 'unavailable'}
              data-rc08-source={model.grip.source}
            >
              {model.grip.label}
            </output>
          </section>

          <div className="rc08-aids-rows">
            <Row label="TC" value={model.tc.field} description="Traction control step" rung="aid" zone="tc" faulted={model.tc.faulted} />
            <Row label="ABS" value={model.abs.field} description="ABS step" rung="aid" zone="abs" faulted={model.abs.faulted} />
            <Row
              label="BRAKE BIAS"
              unit="% FRONT"
              value={model.brakeBias}
              description="Brake bias percent front"
              rung="secondary"
              zone="bias"
            />
            {/*
              RC08_PACKET_OMISSIONS.rainRateNumeral: there is no mm/h channel anywhere in the
              app and section 16 forbids estimating one, so this row is the WORD for ever.
            */}
            <Row
              label="RAIN RATE"
              unit="MM/H"
              value={model.rainRate}
              description="Rain rate"
              rung="secondary"
              zone="rain"
            />
          </div>

          {model.alerts.aidsFault ? (
            <p className="rc08-aids-note" data-testid="rc08-aids-fault" role="alert">
              {`${model.faultedAids.join(' ')} FAULT`}
            </p>
          ) : null}
        </section>

        {/*
          Packet 11.1 pace column — deliberately the NARROWEST column in the wet, because
          chasing tenths on a wet line is the behaviour this artifact exists to discourage.
        */}
        <section
          className="rc08-column rc08-pace"
          data-testid="rc08-pace"
          data-rc08-zone="pace"
          data-rc08-width={weights.pace}
          style={zoneStyle(zones.pace)}
          aria-label="Gear, delta to best and speed"
        >
          <PaceCell label="GEAR" value={model.gear} description="Gear" rung="secondary" zone="gear" />
          <PaceCell
            label="DELTA TO BEST"
            unit="S"
            value={model.delta}
            description="Delta to best lap"
            rung="delta"
            zone="delta"
          />
          <PaceCell label="SPEED" unit="KM/H" value={model.speed} description="Speed" rung="secondary" zone="speed" />
        </section>

        {/*
          Packet 11.1 tyre-thermal column. Every corner is strictly its own sensor. At 1024x600
          packet 12.1 halves this column and adds the per-corner wet/dry crossover panel below
          the grid; neither exists on the 800x480 canvas.
        */}
        <section
          className="rc08-column rc08-tire"
          data-testid="rc08-tire"
          data-rc08-zone="tire"
          data-rc08-width={weights.tire}
          style={zoneStyle(zones.tire)}
          aria-label="Tyre temperatures by corner"
        >
          <header className="rc08-tire-head">
            <span className="rc08-label">
              TIRE TEMP<span className="rc08-unit">C</span>
            </span>
          </header>
          <div className="rc08-corner-grid" data-testid="rc08-corner-grid">
            {model.corners.map((corner) => (
              <CornerCell key={corner.corner} corner={corner} />
            ))}
          </div>
          {crossoverRect ? (
            <div
              className="rc08-crossover"
              data-testid="rc08-crossover"
              data-rc08-zone="crossover"
              style={{ flexBasis: rc08Percent(crossoverRect.height) }}
              aria-label="Per corner wet to dry crossover"
            >
              <span className="rc08-label">CROSSOVER</span>
              <div className="rc08-crossover-row">
                {model.corners.map((corner) => (
                  <span
                    key={corner.corner}
                    className="rc08-crossover-cell"
                    data-testid="rc08-crossover-cell"
                    data-rc08-corner={corner.corner}
                    data-rc08-crossover={corner.crossover ?? 'none'}
                    aria-label={rc08CornerDescription(corner)}
                  >
                    <span className="rc08-crossover-corner" aria-hidden="true">
                      {corner.corner}
                    </span>
                    <span className="rc08-crossover-state" aria-hidden="true">
                      {corner.crossoverLabel}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        {/*
          Packet 12.1 `adaptive-timeline-reveal`: the app width buys a MEASURED grip-state
          history. A period without a confirmed grip state leaves a genuine gap in the track,
          and a display that has never confirmed one at all says UNAVAILABLE instead.
        */}
        {showApp ? (
          <section
            className="rc08-timeline"
            data-testid="rc08-timeline"
            data-rc08-zone="timeline"
            data-rc08-segments={timeline.length}
            style={zoneStyle(zones.timeline)}
            aria-label="Recent grip state history"
          >
            <span className="rc08-label">GRIP HISTORY</span>
            {timeline.length > 0 ? (
              <div className="rc08-timeline-track" data-testid="rc08-timeline-track">
                {timeline.map((segment) => (
                  <TimelineSegment key={`${segment.state}-${segment.startedAtMs}`} segment={segment} />
                ))}
              </div>
            ) : (
              <p className="rc08-timeline-empty" data-testid="rc08-timeline-empty">
                UNAVAILABLE
              </p>
            )}
          </section>
        ) : null}
      </main>
    </div>
  )
}
