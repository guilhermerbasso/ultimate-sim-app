import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { WidgetProps } from './types'
import { raceconDisplayClockFrozen, useRaceconDisplayClock } from './raceconDisplayClock'
import {
  Rc01LiveTelemetryBuffer,
  type Rc01Field,
  type Rc01MonotonicClock,
  rc01FieldDescription,
  rc01MonotonicNow
} from './raceconRc01Core'
import {
  RC15_APP_PAN_STACK_PX,
  RC15_BRAKE_BAR_CELLS,
  RC15_CORNER_COLUMNS,
  RC15_LABELS,
  RC15_TYPE_SCALE_PX,
  type Rc15CornerColumn,
  type Rc15DashboardModel,
  type Rc15Pan,
  type Rc15Rect,
  Rc15BiasTracker,
  Rc15ChannelBuffer,
  Rc15CornerBuffer,
  advanceRc15Alerts,
  clearInvalidRc15Alerts,
  createRc15AlertState,
  createRc15DashboardModel,
  rc15AlertInputForModel,
  rc15AlertTokens,
  rc15AxleTemperature,
  rc15BalanceDescription,
  rc15BalanceIndex,
  rc15ChannelValue,
  rc15CompactModeForContentBox,
  rc15CornerDescription,
  rc15LayoutForContentBox,
  rc15PanDescription,
  rc15PhoneGeometryForContentBox,
  rc15SmoothBalance,
  rc15TypeScaleCqw,
  rc15ZoneStyle,
  rc15ZonesForLayout
} from './raceconRc15Core'
import './raceconRc15.css'

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

    // The dashboard canvas can be transformed relative to its authored size, so the composition
    // size is the transformed bounding rect, not the content box.
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

function zoneStyle(rect: Rc15Rect | undefined): CSSProperties | undefined {
  const style = rc15ZoneStyle(rect)
  return style ? (style as CSSProperties) : undefined
}

function fieldClass(base: string, value: Rc01Field): string {
  return `${base}${value.stale ? ' is-stale' : ''}${value.unavailable ? ' is-unavailable' : ''}`
}

/**
 * A brake-temperature pan. Normative overrides 8 and 12: exactly ten equal cells, lit
 * `min(10, floor(t / 50))`, and the bar's full scale IS the section 15 hot limit — so the bar and
 * the numeral read one channel and can never contradict each other, and a pegged bar and a fired
 * `BRAKE HOT` are the same event. A pan with no sensor draws its ten unlit cells and the grey dash;
 * it is never estimated from brake usage and never mirrored from the other axle.
 */
function BrakePan({
  pan,
  rect,
  testId
}: {
  pan: Rc15Pan
  rect: Rc15Rect | undefined
  testId: string
}): ReactElement {
  return (
    <section
      className={`rc15-panel rc15-pan rc15-pan-${pan.axle}${pan.hot ? ' is-hot' : ''}`}
      data-testid={testId}
      data-rc15-zone={`${pan.axle}Pan`}
      data-rc15-pan={pan.axle}
      data-rc15-pan-available={pan.temperature.unavailable ? 'false' : 'true'}
      data-rc15-pan-cells={RC15_BRAKE_BAR_CELLS}
      data-rc15-pan-lit={pan.litCells}
      data-rc15-pan-hot={pan.hot ? 'true' : 'false'}
      style={zoneStyle(rect)}
      aria-label={rc15PanDescription(pan)}
    >
      <span className="rc15-pan-label">{pan.label}</span>
      <span className="rc15-pan-row">
        <output
          className={fieldClass('rc15-pan-value', pan.temperature)}
          data-testid={`rc15-pan-value-${pan.axle}`}
          data-tone={pan.temperature.tone}
        >
          {pan.temperature.value}
        </output>
        <span className="rc15-pan-unit">DEG C</span>
      </span>
      <span className="rc15-pan-bar" data-testid={`rc15-pan-bar-${pan.axle}`} aria-hidden="true">
        {pan.cells.map((cell) => (
          <span
            key={cell.index}
            className={`rc15-pan-cell${cell.lit ? ' is-lit' : ''}`}
            data-testid="rc15-pan-cell"
            data-rc15-cell-lit={cell.lit ? 'true' : 'false'}
          />
        ))}
      </span>
      {pan.hot ? (
        <span className="rc15-pan-alert" data-testid={`rc15-pan-alert-${pan.axle}`} role="status">
          {RC15_LABELS.brakeHot}
        </span>
      ) : null}
    </section>
  )
}

/**
 * One strip column. The column label is an OBSERVATION ORDINAL, never a track turn number: section
 * 16 defines no corner or track-position channel, so `C6` means "the newest corner this run actually
 * measured", and a slot with no corner behind it draws the datum tick with NO marker, a dashed index
 * and a dashed brake pair — the approved frame's own T4 dropout pattern.
 */
function CornerColumn({ column }: { column: Rc15CornerColumn }): ReactElement {
  return (
    <div
      className={`rc15-corner${column.current ? ' is-current' : ''}`}
      data-testid="rc15-corner"
      data-rc15-corner={column.id}
      data-rc15-corner-scored={column.scored ? 'true' : 'false'}
      data-rc15-corner-current={column.current ? 'true' : 'false'}
      data-rc15-corner-marker={column.markerOffsetPct === null ? 'none' : String(column.markerOffsetPct)}
      aria-label={rc15CornerDescription(column)}
    >
      <span className="rc15-corner-id">{column.label}</span>
      <span className="rc15-corner-track" data-testid="rc15-corner-track" aria-hidden="true">
        <span className="rc15-corner-datum" data-testid="rc15-corner-datum" />
        {column.markerOffsetPct === null ? null : (
          <span
            className="rc15-corner-marker"
            data-testid="rc15-corner-marker"
            style={{ left: `${50 + column.markerOffsetPct}%` }}
          />
        )}
      </span>
      <output
        className={fieldClass('rc15-corner-index', column.index)}
        data-testid="rc15-corner-index"
        data-tone={column.index.tone}
      >
        {column.index.value}
      </output>
      <span className="rc15-corner-pair" data-testid="rc15-corner-pair">
        <span className={fieldClass('rc15-corner-temp', column.frontTemp)}>{column.frontTemp.value}</span>
        <span className="rc15-corner-slash">/</span>
        <span className={fieldClass('rc15-corner-temp', column.rearTemp)}>{column.rearTemp.value}</span>
      </span>
    </div>
  )
}

/** Packet 11.1 zone 5 header: the two section 16 context channels, as numerals plus their units. */
function ContextLine({ model }: { model: Rc15DashboardModel }): ReactElement {
  return (
    <span className="rc15-context" data-testid="rc15-context">
      <span className="rc15-context-entry">
        <span className="rc15-context-label">{RC15_LABELS.steering}</span>
        <output
          className={fieldClass('rc15-context-value', model.steering)}
          data-testid="rc15-steering"
          aria-label={rc01FieldDescription('Steering angle', model.steering)}
        >
          {model.steering.value}
        </output>
        <span className="rc15-context-unit">DEG</span>
      </span>
      <span className="rc15-context-entry">
        <span className="rc15-context-label">{RC15_LABELS.latG}</span>
        <output
          className={fieldClass('rc15-context-value', model.latG)}
          data-testid="rc15-latg"
          aria-label={rc01FieldDescription('Lateral G', model.latG)}
        >
          {model.latG.value}
        </output>
        <span className="rc15-context-unit">G</span>
      </span>
    </span>
  )
}

/**
 * RC-15 is an overlay-widget-owned, live-only balance-tuning page. It shares RC-01's fail-closed
 * ingest buffer, so mock and replay telemetry are refused and a source or session discontinuity
 * clears the channel receipts, the scored-corner history, the bias-adjustment history and the
 * smoothed beam.
 */
export interface RaceconRc15DashWidgetProps extends WidgetProps {
  monotonicClock?: Rc01MonotonicClock
}

export function RaceconRc15DashWidget({
  snapshot,
  config,
  preview,
  monotonicClock = rc01MonotonicNow
}: RaceconRc15DashWidgetProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const bufferRef = useRef(new Rc01LiveTelemetryBuffer())
  const channelsRef = useRef(new Rc15ChannelBuffer())
  const cornersRef = useRef(new Rc15CornerBuffer())
  const biasRef = useRef(new Rc15BiasTracker())
  const alertsRef = useRef(createRc15AlertState())
  const smoothedRef = useRef<{ index: number | null; atMs: number }>({ index: null, atMs: 0 })
  const nowMs = useRaceconDisplayClock(monotonicClock, raceconDisplayClockFrozen(preview))
  const box = useContentBox(rootRef, config)

  // A receipt timestamp, not a display clock: it advances only when a new snapshot object or
  // provider timestamp arrives, so a freshness tick cannot make a stale frame look fresh.
  const arrivalMs = useMemo(() => monotonicClock(), [monotonicClock, snapshot, snapshot?.timestamp])

  // Rendering mutates isolated candidates only; they are committed in the layout phase so
  // StrictMode double-renders and abandoned concurrent renders cannot advance real state.
  const candidate = bufferRef.current.clone()
  const outcome = candidate.ingest(snapshot, arrivalMs)
  const channels = channelsRef.current.clone()
  const corners = cornersRef.current.clone()
  const biasTracker = biasRef.current.clone()
  let smoothed = smoothedRef.current

  if (outcome.accepted) {
    const accepted = candidate.latestSnapshot()
    channels.ingest(accepted, arrivalMs)
    const receipts = channels.receipts()
    const steeringDeg = accepted ? rc15ChannelValue(accepted, 'steering') : null
    const yawRateRadSec = accepted ? rc15ChannelValue(accepted, 'yawRate') : null
    const latG = accepted ? rc15ChannelValue(accepted, 'latG') : null
    const front = rc15AxleTemperature(accepted, receipts, 'front', arrivalMs)
    const rear = rc15AxleTemperature(accepted, receipts, 'rear', arrivalMs)
    const rawIndex = rc15BalanceIndex({ steeringDeg, yawRateRadSec, latG })

    // Packet 11.5's hysteresis controller. It is fed from the ACCEPTED sample's arrival, never from
    // the display clock, so the beam smooths over real telemetry time and a dropout breaks it
    // instead of being smoothed across.
    smoothed = {
      index: rc15SmoothBalance(smoothed.index, rawIndex, arrivalMs - smoothed.atMs),
      atMs: arrivalMs
    }

    biasTracker.ingest(accepted ? rc15ChannelValue(accepted, 'brakeBias') : null)
    corners.ingest({
      timestamp: accepted?.timestamp ?? arrivalMs,
      receivedAt: arrivalMs,
      latG,
      index: rawIndex,
      frontTempC: front.value,
      rearTempC: rear.value
    })
  } else if (!outcome.renderable) {
    // Fail closed: anything the buffer refuses also invalidates the receipts, the scored corners,
    // the observed bias adjustments and the smoothed beam, so a new source never inherits the
    // previous session's channels or scores a corner it did not drive.
    channels.reset()
    corners.reset()
    biasTracker.reset()
    smoothed = { index: null, atMs: 0 }
  }

  const renderSnapshot = outcome.renderable ? candidate.latestSnapshot() : null
  const layout = rc15LayoutForContentBox(box.width, box.height)
  const compactMode = rc15CompactModeForContentBox(box.width, box.height)
  const showApp = layout === 'app'
  const scoredCorners = corners.corners()
  const receipts = channels.receipts()

  const modelOptions = {
    smoothedIndex: smoothed.index,
    scoredCorners,
    biasAdjustment: biasTracker.lastAdjustment(),
    trendSamples: showApp
      ? scoredCorners.map((corner) => ({
          timestamp: corner.closedAt,
          receivedAt: corner.closedAt,
          latG: null,
          index: corner.index,
          frontTempC: corner.frontTempC,
          rearTempC: corner.rearTempC
        }))
      : []
  }

  // Two passes: the first builds the model the alert layer reads, the second re-renders it with
  // whatever the alert layer actually latched, so no surface can annotate a channel that was
  // invalidated in the same frame.
  const provisional = createRc15DashboardModel(renderSnapshot, receipts, nowMs, {
    ...modelOptions,
    alerts: alertsRef.current
  })
  const advanced = advanceRc15Alerts(
    alertsRef.current,
    rc15AlertInputForModel(provisional, nowMs, scoredCorners, biasTracker.everReported())
  )
  const alerts = clearInvalidRc15Alerts(advanced, provisional)
  const model = createRc15DashboardModel(renderSnapshot, receipts, nowMs, { ...modelOptions, alerts })

  const zones = rc15ZonesForLayout(layout, compactMode, box)
  const phoneGeometry = rc15PhoneGeometryForContentBox(box.width, box.height)

  const responsiveStyle = {
    // Normative override 3: the ladder is arithmetic and expressed in container units. Because the
    // app canvas is exactly 1.28x the native canvas, ONE cqw ladder gives 72/48/44/30 px at 800 wide
    // and the packet's 1.28 step at 1024 wide, and the clamp maxima keep the hero numeral inside its
    // own zone at every canvas the widget can be given.
    '--rc15-type-bias': `${rc15TypeScaleCqw(RC15_TYPE_SCALE_PX.bias)}cqw`,
    '--rc15-type-index': `${rc15TypeScaleCqw(RC15_TYPE_SCALE_PX.balanceIndex)}cqw`,
    '--rc15-type-temp': `${rc15TypeScaleCqw(RC15_TYPE_SCALE_PX.brakeTemp)}cqw`,
    '--rc15-type-strip': `${rc15TypeScaleCqw(RC15_TYPE_SCALE_PX.cornerStrip)}cqw`,
    '--rc15-beam-deg': `${model.balance.beamDeg}deg`,
    ...(phoneGeometry
      ? {
          '--rc15-phone-inset': `${phoneGeometry.inset}px`,
          '--rc15-phone-label-height': `${phoneGeometry.labelHeight}px`,
          '--rc15-phone-beam-height': `${phoneGeometry.beamHeight}px`,
          '--rc15-phone-row-height': `${phoneGeometry.stripRowHeight}px`
        }
      : {})
  } as CSSProperties

  useLayoutEffect(() => {
    bufferRef.current = candidate
    channelsRef.current = channels
    cornersRef.current = corners
    biasRef.current = biasTracker
    alertsRef.current = alerts
    smoothedRef.current = smoothed
  }, [candidate, channels, corners, biasTracker, alerts, smoothed])

  const alertTokens = rc15AlertTokens(model.alerts)

  return (
    <div
      ref={rootRef}
      className="rc15-widget"
      data-widget="raceconRc15Dash"
      data-rc15-layout={layout}
      data-rc15-compact-mode={layout === 'compact' ? compactMode : undefined}
      data-rc15-buffer-state={outcome.reason}
      data-rc15-alerts={alertTokens}
      data-rc15-balance={model.balance.available ? (model.balance.word ?? 'LEVEL') : 'unavailable'}
      data-rc15-beam-deg={model.balance.beamDeg}
      data-rc15-beam-pegged={model.balance.pegged ? 'true' : 'false'}
      data-rc15-scored-corners={model.scoredCornerCount}
      data-rc15-content-width={Math.round(box.width)}
      data-rc15-content-height={Math.round(box.height)}
      style={responsiveStyle}
    >
      <main
        className="rc15-dashboard"
        aria-label="RaceCon RC-15 on the nose, brake and chassis balance"
        data-rc15-native-size={layout === 'native' ? '800x480' : undefined}
      >
        {/*
          Packet 11.1 zone 2, the interpretive hero. The beam is a straight bar on a fulcrum whose
          tilt IS the computed index: left is front is understeer, right is rear is oversteer, at 12
          degrees of full travel. Packet 19 and normative override 7: the tilt and the UNDER / OVER
          word are routine accessibility chrome in `primary`, NOT the alert layer — only the pegged
          beam belongs to the balance-extreme alert.
        */}
        <section
          className={`rc15-panel rc15-beam-zone${model.balance.pegged ? ' is-pegged' : ''}`}
          data-testid="rc15-panel-beam"
          data-rc15-zone="beam"
          data-rc15-balance-available={model.balance.available ? 'true' : 'false'}
          style={zoneStyle(zones.beam)}
          aria-label={rc15BalanceDescription(model.balance)}
        >
          <span className="rc15-beam-head">
            <span className="rc15-beam-title">{RC15_LABELS.balance}</span>
            <span className="rc15-computed-chip" data-testid="rc15-computed-chip">
              {RC15_LABELS.computed}
            </span>
          </span>
          <span className="rc15-beam-read">
            <output
              className={fieldClass('rc15-beam-index', model.balance.index)}
              data-testid="rc15-balance-index"
              data-tone={model.balance.index.tone}
            >
              {model.balance.index.value}
            </output>
            <span className="rc15-beam-word" data-testid="rc15-balance-word">
              {model.balance.word ?? ''}
            </span>
          </span>
          <span className="rc15-beam-stage" data-testid="rc15-beam-stage">
            <span className="rc15-beam-datum" aria-hidden="true" />
            <span
              className="rc15-beam-bar"
              data-testid="rc15-beam-bar"
              data-rc15-beam-deg={model.balance.beamDeg}
              style={{ transform: `rotate(${model.balance.beamDeg}deg)` }}
              aria-hidden="true"
            />
            <span className="rc15-beam-fulcrum" aria-hidden="true" />
            <span className="rc15-beam-edge rc15-beam-edge-front" aria-hidden="true">
              {RC15_LABELS.frontAxle}
            </span>
            <span className="rc15-beam-edge rc15-beam-edge-rear" aria-hidden="true">
              {RC15_LABELS.rearAxle}
            </span>
          </span>
          {showApp ? <ContextLine model={model} /> : null}
        </section>

        {/* Packet 11.1 zones 1 and 3, moved outward by normative override 1 so neither overlaps the beam. */}
        <BrakePan pan={model.frontPan} rect={zones.frontPan} testId="rc15-panel-front-pan" />
        <BrakePan pan={model.rearPan} rect={zones.rearPan} testId="rc15-panel-rear-pan" />

        {/*
          Packet 11.1 zone 4, grown by normative override 2 because the declared 200 x 90 box cannot
          hold a 72 px numeral plus a label plus an adjust hint. The `LAST ADJ` hint is measured from
          the bias channel's own movement — never inferred from the balance reading, and never from
          pedal balance.
        */}
        <section
          className={`rc15-panel rc15-bias${model.bias.dashed ? ' is-dashed' : ''}`}
          data-testid="rc15-panel-bias"
          data-rc15-zone="bias"
          data-rc15-bias-available={model.bias.value.unavailable ? 'false' : 'true'}
          data-rc15-bias-dashed={model.bias.dashed ? 'true' : 'false'}
          style={zoneStyle(zones.bias)}
          aria-label={rc01FieldDescription('Brake bias percent front', model.bias.value)}
        >
          <span className="rc15-bias-main">
            <span className="rc15-bias-label">{RC15_LABELS.biasLabel}</span>
            <span className="rc15-bias-read">
              <output
                className={fieldClass('rc15-bias-value', model.bias.value)}
                data-testid="rc15-bias-value"
                data-tone={model.bias.value.tone}
              >
                {model.bias.value.value}
              </output>
              <span className="rc15-bias-unit">{model.bias.unit}</span>
            </span>
          </span>
          <span className="rc15-bias-hint" data-testid="rc15-bias-hint">
            <span className="rc15-bias-hint-label">{RC15_LABELS.lastAdjust}</span>
            <span
              className={fieldClass('rc15-bias-hint-value', model.bias.hint)}
              data-rc15-hint-direction={model.bias.direction ?? 'none'}
            >
              {model.bias.hint.value}
            </span>
          </span>
        </section>

        {/*
          Packet 11.1 zone 5. Six columns, right-aligned to the newest scored corner so the single
          current-corner underline is always on column 6. Both the index row and the brake-pair row
          are drawn at once, which is why packet 11.5's soft-key has nothing left to switch.
        */}
        {showApp ? null : (
          <section
            className="rc15-panel rc15-strip"
            data-testid="rc15-panel-strip"
            data-rc15-zone="strip"
            data-rc15-corner-columns={RC15_CORNER_COLUMNS}
            data-rc15-corners-scored={model.scoredCornerCount}
            style={zoneStyle(zones.strip)}
            aria-label="Per-corner balance strip"
          >
            <span className="rc15-strip-head">
              <span className="rc15-strip-title">
                {RC15_LABELS.cornerRow}
                <span className="rc15-strip-qualifier">{RC15_LABELS.observed}</span>
              </span>
              <ContextLine model={model} />
            </span>
            <div className="rc15-strip-rows">
              <div className="rc15-strip-labels" aria-hidden="true">
                <span className="rc15-strip-label">{RC15_LABELS.cornerRow}</span>
                <span className="rc15-strip-label">{RC15_LABELS.balanceRow}</span>
                <span className="rc15-strip-label">{RC15_LABELS.indexRow}</span>
                <span className="rc15-strip-label">{RC15_LABELS.brakeRow}</span>
              </div>
              <div className="rc15-strip-columns">
                {model.corners.map((column) => (
                  <CornerColumn key={column.id} column={column} />
                ))}
              </div>
            </div>
            {model.scoredCornerCount === 0 ? (
              <p className="rc15-notice" data-testid="rc15-strip-notice">
                {RC15_LABELS.noCorners}
              </p>
            ) : null}
          </section>
        )}

        {/*
          Packet 12.1's first reveal. It is NOT a track map: section 16 defines no track geometry,
          position or lap-distance channel, so no corner can be placed in space. What is genuinely
          available is the ORDER the corners were driven in, so the panel publishes that sequence and
          states its own unavailability as a map in words.
        */}
        {showApp ? (
          <section
            className="rc15-panel rc15-corner-map"
            data-testid="rc15-panel-corner-map"
            data-rc15-zone="cornerMap"
            data-rc15-map-available={model.cornerMapAvailable ? 'true' : 'false'}
            data-rc15-corner-columns={RC15_CORNER_COLUMNS}
            style={zoneStyle(zones.cornerMap)}
            aria-label="Observed corner balance sequence"
          >
            <span className="rc15-strip-head">
              <span className="rc15-strip-title">
                {RC15_LABELS.balanceRow}
                <span className="rc15-strip-qualifier">{RC15_LABELS.observed}</span>
              </span>
              <ContextLine model={model} />
            </span>
            <div className="rc15-strip-rows">
              <div className="rc15-strip-labels" aria-hidden="true">
                <span className="rc15-strip-label">{RC15_LABELS.cornerRow}</span>
                <span className="rc15-strip-label">{RC15_LABELS.balanceRow}</span>
                <span className="rc15-strip-label">{RC15_LABELS.indexRow}</span>
                <span className="rc15-strip-label">{RC15_LABELS.brakeRow}</span>
              </div>
              <div className="rc15-strip-columns">
                {model.corners.map((column) => (
                  <CornerColumn key={column.id} column={column} />
                ))}
              </div>
            </div>
            <p className="rc15-notice" data-testid="rc15-corner-map-notice">
              {RC15_LABELS.noTrackMap}
            </p>
          </section>
        ) : null}

        {/*
          Packet 12.1's second reveal. "Over recent laps" needs a lap channel section 16 never
          defines, so the trend runs over the scored-corner acquisition window instead: the ordinate
          is this widget's own acquisition state, never a lap or a distance claim, and no lap numeral
          is printed anywhere on it.
        */}
        {showApp ? (
          <section
            className="rc15-panel rc15-trend"
            data-testid="rc15-panel-brake-trend"
            data-rc15-zone="brakeTrend"
            data-rc15-trend-available={model.trendAvailable ? 'true' : 'false'}
            data-rc15-trend-points={model.trend.length}
            style={zoneStyle(zones.brakeTrend)}
            aria-label="Brake temperature trend over the acquisition window"
          >
            <span className="rc15-strip-title">BRAKE TREND</span>
            <svg
              className="rc15-trend-plot"
              data-testid="rc15-trend-plot"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polyline
                className="rc15-trend-line rc15-trend-front"
                data-testid="rc15-trend-front"
                points={model.trend
                  .filter((point) => point.frontY !== null)
                  .map((point) => `${point.x},${point.frontY}`)
                  .join(' ')}
                vectorEffect="non-scaling-stroke"
              />
              <polyline
                className="rc15-trend-line rc15-trend-rear"
                data-testid="rc15-trend-rear"
                points={model.trend
                  .filter((point) => point.rearY !== null)
                  .map((point) => `${point.x},${point.rearY}`)
                  .join(' ')}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <span className="rc15-trend-legend">
              <span className="rc15-trend-key rc15-trend-key-front">{RC15_LABELS.frontAxle}</span>
              <span className="rc15-trend-key rc15-trend-key-rear">{RC15_LABELS.rearAxle}</span>
            </span>
            {model.trendAvailable ? null : (
              <p className="rc15-notice" data-testid="rc15-trend-notice">
                {RC15_LABELS.noTrend}
              </p>
            )}
          </section>
        ) : null}
      </main>
      {/*
        Packet 12.1's declared composite pan box, recorded in the DOM so the suite can prove the two
        rendered pan panels union to exactly (40, 70, 240, 180) at 1024x600.
      */}
      <span
        className="rc15-visually-hidden"
        data-testid="rc15-app-pan-stack"
        data-rc15-pan-stack={`${RC15_APP_PAN_STACK_PX.x},${RC15_APP_PAN_STACK_PX.y},${RC15_APP_PAN_STACK_PX.width},${RC15_APP_PAN_STACK_PX.height}`}
      />
    </div>
  )
}
