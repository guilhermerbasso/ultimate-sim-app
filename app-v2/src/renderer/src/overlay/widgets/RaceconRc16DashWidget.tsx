import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { WidgetProps } from './types'
import { raceconDisplayClockFrozen, useRaceconDisplayClock } from './raceconDisplayClock'
import {
  Rc01LiveTelemetryBuffer,
  type Rc01MonotonicClock,
  rc01FieldDescription,
  rc01MonotonicNow
} from './raceconRc01Core'
import {
  RC16_CONSISTENCY_GATE_NOTICE,
  RC16_LABEL_PX,
  RC16_NO_CUE_NOTICE,
  RC16_SMOOTHNESS_GATE_NOTICE,
  RC16_TYPE_SCALE_PX,
  RC16_WIDGET_ID,
  type Rc16DashboardModel,
  type Rc16FocusArea,
  type Rc16HistoryPoint,
  type Rc16Rect,
  type Rc16SummaryRow,
  Rc16CoachingBuffer,
  advanceRc16Alerts,
  clearInvalidRc16Alerts,
  createRc16AlertState,
  createRc16DashboardModel,
  rc16AlertInputForModel,
  rc16CompactModeForContentBox,
  rc16CueDescription,
  rc16LayoutForContentBox,
  rc16NextFocusArea,
  rc16RingDescription,
  rc16RingViewBoxRadius,
  rc16SummaryDescription,
  rc16TypeScaleCqw,
  rc16ZoneStyle,
  rc16ZonesForLayout
} from './raceconRc16Core'
import './raceconRc16.css'

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

function zoneStyle(rect: Rc16Rect | undefined): CSSProperties | undefined {
  const style = rc16ZoneStyle(rect)
  return style ? (style as CSSProperties) : undefined
}

/**
 * The consistency ring. Three concentric TRUE circles drawn straight onto the calm background — no
 * rectangular tile behind them (brief section 1). `preserveAspectRatio` keeps them circular in a
 * non-square zone, and the mint ring is simply ABSENT when the >= 3-lap gate has not opened, because
 * on this artifact a radius is the value.
 */
function ConsistencyRing({ model, rect }: { model: Rc16DashboardModel; rect: Rc16Rect | undefined }): ReactElement {
  const ring = model.ring
  return (
    <section
      className="rc16-ring"
      data-testid="rc16-ring"
      data-rc16-zone="ring"
      data-rc16-ring-available={ring.available ? 'true' : 'false'}
      data-rc16-ring-mid={ring.midRadiusPct ?? ''}
      data-rc16-ring-gap={ring.gapPct ?? ''}
      style={zoneStyle(rect)}
      aria-label={rc16RingDescription(model)}
    >
      <svg
        className="rc16-ring-svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-hidden="true"
        focusable="false"
      >
        <circle
          className="rc16-ring-guide"
          data-testid="rc16-ring-guide"
          cx="50"
          cy="50"
          r={rc16RingViewBoxRadius(ring.guideRadiusPct)}
        />
        {ring.available && ring.midRadiusPct !== null ? (
          <circle
            className="rc16-ring-band"
            data-testid="rc16-ring-band"
            cx="50"
            cy="50"
            r={rc16RingViewBoxRadius(ring.midRadiusPct)}
            strokeWidth={rc16RingViewBoxRadius(ring.strokePct)}
          />
        ) : null}
        <circle
          className="rc16-ring-disc"
          data-testid="rc16-ring-disc"
          cx="50"
          cy="50"
          r={rc16RingViewBoxRadius(ring.discRadiusPct)}
        />
      </svg>
      <div className="rc16-ring-centre">
        <span className="rc16-label">BAND</span>
        <output
          className={`rc16-ring-value${model.consistency.stale ? ' is-stale' : ''}${
            model.consistency.unavailable ? ' is-unavailable' : ''
          }`}
          data-testid="rc16-consistency"
          data-tone={model.consistency.tone}
          aria-label={rc01FieldDescription('Consistency band', model.consistency)}
        >
          {model.consistency.value}
        </output>
        <span className="rc16-ring-unit">
          {model.consistency.unavailable ? RC16_CONSISTENCY_GATE_NOTICE : 'S'}
        </span>
      </div>
    </section>
  )
}

/**
 * The smoothness meter. One continuous vertical fill bar and one numeral, both bound to the SAME
 * model number, so the bar can never disagree with what is printed beside it.
 */
function SmoothnessMeter({ model, rect }: { model: Rc16DashboardModel; rect: Rc16Rect | undefined }): ReactElement {
  return (
    <section
      className="rc16-panel rc16-smoothness"
      data-testid="rc16-smoothness-panel"
      data-rc16-zone="smoothness"
      data-rc16-smoothness-available={model.smoothness.unavailable ? 'false' : 'true'}
      data-rc16-smoothness-fill={model.smoothnessFillPct}
      style={zoneStyle(rect)}
      aria-label="Throttle smoothness meter"
    >
      <span className="rc16-label">SMOOTHNESS</span>
      <div className="rc16-smoothness-body">
        <div className="rc16-smoothness-track" data-testid="rc16-smoothness-track">
          <div
            className="rc16-smoothness-fill"
            data-testid="rc16-smoothness-fill"
            style={{ height: `${model.smoothnessFillPct}%` }}
          />
        </div>
        <output
          className={`rc16-smoothness-value${model.smoothness.stale ? ' is-stale' : ''}${
            model.smoothness.unavailable ? ' is-unavailable' : ''
          }`}
          data-testid="rc16-smoothness"
          data-tone={model.smoothness.tone}
          aria-label={rc01FieldDescription('Throttle smoothness', model.smoothness)}
        >
          {model.smoothness.value}
        </output>
      </div>
      {model.smoothness.unavailable ? (
        <p className="rc16-notice" data-testid="rc16-smoothness-notice">
          {RC16_SMOOTHNESS_GATE_NOTICE}
        </p>
      ) : null}
    </section>
  )
}

/**
 * The coaching cue card. Exactly one cue, ever (packet 11.5). The card itself is a packet 11.1
 * LAYOUT zone carrying the section 14 Normal-state encouragement; only `data-rc16-cue-alert` and the
 * caution accent belong to the alert layer, and both are silent until a trigger fires.
 */
function CueCard({ model, rect }: { model: Rc16DashboardModel; rect: Rc16Rect | undefined }): ReactElement {
  return (
    <section
      className={`rc16-panel rc16-cue${model.cue.alert ? ' is-alert' : ''}`}
      data-testid="rc16-cue-panel"
      data-rc16-zone="cue"
      data-rc16-cue={model.cue.id}
      data-rc16-cue-alert={model.cue.alert ? 'true' : 'false'}
      data-rc16-cue-available={model.cue.available ? 'true' : 'false'}
      style={zoneStyle(rect)}
      aria-label={rc16CueDescription(model.cue)}
    >
      <span className="rc16-label">NEXT STEP</span>
      <span className="rc16-cue-icon" data-testid="rc16-cue-icon" data-rc16-icon={model.cue.icon} aria-hidden="true" />
      <p className="rc16-cue-lines" data-testid="rc16-cue-lines">
        <span className="rc16-cue-line">{model.cue.lines[0]}</span>
        <span className="rc16-cue-line">{model.cue.lines[1]}</span>
      </p>
      {model.cue.notice ? (
        <span className="rc16-notice" data-testid="rc16-cue-notice">
          {model.cue.notice}
        </span>
      ) : null}
    </section>
  )
}

/**
 * Delta calm. OV-7: the 60 px native zone cannot hold a 44 px value above a stacked label, so label,
 * value and unit sit on ONE inline row, and the placeholder carries the same two decimals the value
 * does. The numeral is `primary` whatever its sign — packet 11.3 allows no harsh red for a learner,
 * so the sign character alone carries direction.
 */
function DeltaCalm({ model, rect }: { model: Rc16DashboardModel; rect: Rc16Rect | undefined }): ReactElement {
  return (
    <section
      className="rc16-panel rc16-delta"
      data-testid="rc16-delta-panel"
      data-rc16-zone="delta"
      data-rc16-delta-available={model.delta.unavailable ? 'false' : 'true'}
      style={zoneStyle(rect)}
      aria-label="Lap delta to best"
    >
      <span className="rc16-label">DELTA</span>
      <output
        className={`rc16-delta-value${model.delta.stale ? ' is-stale' : ''}${
          model.delta.unavailable ? ' is-unavailable' : ''
        }`}
        data-testid="rc16-delta"
        data-tone={model.delta.tone}
        aria-label={rc01FieldDescription('Delta to best', model.delta)}
      >
        {model.delta.value}
      </output>
      <span className="rc16-delta-unit">S</span>
    </section>
  )
}

/** Lap summary: exactly two label/value rows (brief section 1). */
function LapSummary({
  rows,
  rect
}: {
  rows: readonly Rc16SummaryRow[]
  rect: Rc16Rect | undefined
}): ReactElement {
  return (
    <section
      className="rc16-panel rc16-summary"
      data-testid="rc16-summary-panel"
      data-rc16-zone="summary"
      data-rc16-summary-rows={rows.length}
      style={zoneStyle(rect)}
      aria-label="Lap summary"
    >
      {rows.map((row) => (
        <span key={row.id} className="rc16-summary-row" data-testid="rc16-summary-row" data-rc16-summary={row.id}>
          <span className="rc16-label">{row.label}</span>
          <output
            className={`rc16-summary-value${row.value.stale ? ' is-stale' : ''}${
              row.value.unavailable ? ' is-unavailable' : ''
            }`}
            data-testid={`rc16-summary-${row.id}`}
            data-tone={row.value.tone}
            aria-label={rc16SummaryDescription(row)}
          >
            {row.value.value}
          </output>
          {row.unit ? <span className="rc16-summary-unit">{row.unit}</span> : null}
        </span>
      ))}
    </section>
  )
}

/**
 * Packet 12.1's app-only reveal. A lap the widget never observed is published as an explicit GAP
 * column, never bridged, and every column inherits the >= 3-lap gate (ZG-5).
 */
function ConsistencyHistory({
  points,
  notice,
  rect
}: {
  points: readonly Rc16HistoryPoint[]
  notice: string | null
  rect: Rc16Rect | undefined
}): ReactElement {
  return (
    <section
      className="rc16-panel rc16-history"
      data-testid="rc16-history-panel"
      data-rc16-zone="history"
      data-rc16-history-points={points.length}
      data-rc16-history-available={points.some((point) => point.available) ? 'true' : 'false'}
      style={zoneStyle(rect)}
      aria-label="Lap by lap consistency history"
    >
      <span className="rc16-label">CONSISTENCY HISTORY</span>
      <div className="rc16-history-track">
        {points.map((point) => (
          <span
            key={point.lap}
            className={`rc16-history-point${point.gap ? ' is-gap' : ''}${point.available ? '' : ' is-unavailable'}`}
            data-testid="rc16-history-point"
            data-rc16-history-lap={point.lap}
            data-rc16-history-gap={point.gap ? 'true' : 'false'}
            style={
              point.available && point.dispersionSec !== null
                ? ({ '--rc16-history-band': `${Math.min(100, (point.dispersionSec / 1.5) * 100)}%` } as CSSProperties)
                : undefined
            }
          />
        ))}
      </div>
      {notice ? (
        <p className="rc16-notice" data-testid="rc16-history-notice">
          {notice}
        </p>
      ) : null}
    </section>
  )
}

/**
 * RC-16 is an overlay-widget-owned, live-only coaching page. It shares RC-01's fail-closed ingest
 * buffer, so mock and replay telemetry are refused and a source or session discontinuity clears the
 * lap ledger, the dispersion window and every latched coaching alert.
 */
export interface RaceconRc16DashWidgetProps extends WidgetProps {
  monotonicClock?: Rc01MonotonicClock
}

export function RaceconRc16DashWidget({
  snapshot,
  config,
  preview,
  monotonicClock = rc01MonotonicNow
}: RaceconRc16DashWidgetProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const bufferRef = useRef(new Rc01LiveTelemetryBuffer())
  const coachingRef = useRef(new Rc16CoachingBuffer())
  const alertsRef = useRef(createRc16AlertState())
  const nowMs = useRaceconDisplayClock(monotonicClock, raceconDisplayClockFrozen(preview))
  const [focusArea, setFocusArea] = useState<Rc16FocusArea>('braking')
  const box = useContentBox(rootRef, config)

  // A receipt timestamp, not a display clock: it advances only when a new snapshot object or
  // provider timestamp arrives, so a freshness tick cannot make a stale frame look fresh.
  const arrivalMs = useMemo(() => monotonicClock(), [monotonicClock, snapshot, snapshot?.timestamp])

  // Rendering mutates isolated candidates only; they are committed in the layout phase so
  // StrictMode double-renders and abandoned concurrent renders cannot advance real state.
  const candidate = bufferRef.current.clone()
  const outcome = candidate.ingest(snapshot, arrivalMs)
  const coaching = coachingRef.current.clone()
  if (outcome.accepted) {
    coaching.ingest(candidate.latestSnapshot(), arrivalMs)
  } else if (!outcome.renderable) {
    // Fail closed: anything the buffer refuses also drops the lap ledger, so a new source never
    // inherits the previous session's laps and never carries a stale last lap across the boundary.
    coaching.reset()
  }

  const renderSnapshot = outcome.renderable ? candidate.latestSnapshot() : null
  const layout = rc16LayoutForContentBox(box.width, box.height)
  const compactMode = rc16CompactModeForContentBox(box.width, box.height)
  const showApp = layout === 'app'
  const laps = coaching.laps()

  const modelOptions = { laps, focusArea, includeHistory: showApp }

  // Two passes: the first builds the model the alert layer reads, the second re-renders it with
  // whatever the alert layer actually latched, so no surface can show a cue whose driving channel
  // was invalidated in the same frame.
  const provisional = createRc16DashboardModel(renderSnapshot, candidate.receipts(), coaching.receipts(), nowMs, {
    ...modelOptions,
    alerts: alertsRef.current
  })
  const advanced = advanceRc16Alerts(alertsRef.current, rc16AlertInputForModel(provisional, nowMs))
  const alerts = clearInvalidRc16Alerts(advanced, provisional)
  const model: Rc16DashboardModel = createRc16DashboardModel(
    renderSnapshot,
    candidate.receipts(),
    coaching.receipts(),
    nowMs,
    { ...modelOptions, alerts }
  )

  const zones = rc16ZonesForLayout(layout, compactMode, box)

  const responsiveStyle = {
    // Packet 11.2 implemented as arithmetic (OV-4): 56 / 44 / 40 / 34 / 28 px on the 800x480 canvas
    // is 7 / 5.5 / 5 / 4.25 / 3.5 cqw, and one cqw ladder carries the same ranking to every canvas.
    '--rc16-type-ring': `${rc16TypeScaleCqw(RC16_TYPE_SCALE_PX.ringValue)}cqw`,
    '--rc16-type-delta': `${rc16TypeScaleCqw(RC16_TYPE_SCALE_PX.delta)}cqw`,
    '--rc16-type-smoothness': `${rc16TypeScaleCqw(RC16_TYPE_SCALE_PX.smoothness)}cqw`,
    '--rc16-type-cue': `${rc16TypeScaleCqw(RC16_TYPE_SCALE_PX.cue)}cqw`,
    '--rc16-type-summary': `${rc16TypeScaleCqw(RC16_TYPE_SCALE_PX.summary)}cqw`,
    '--rc16-type-label': `${rc16TypeScaleCqw(RC16_LABEL_PX)}cqw`
  } as CSSProperties

  useLayoutEffect(() => {
    bufferRef.current = candidate
    coachingRef.current = coaching
    alertsRef.current = alerts
  }, [candidate, coaching, alerts])

  const cycleFocus = useCallback(() => {
    setFocusArea((current) => rc16NextFocusArea(current))
  }, [])

  return (
    <div
      ref={rootRef}
      className="rc16-widget"
      data-widget={RC16_WIDGET_ID}
      data-rc16-layout={layout}
      data-rc16-compact-mode={layout === 'compact' ? compactMode : undefined}
      data-rc16-buffer-state={outcome.reason}
      data-rc16-alerts={model.alertsSilent ? 'silent' : 'active'}
      data-rc16-focus={model.focusArea}
      data-rc16-laps={model.lapCount}
      data-rc16-content-width={Math.round(box.width)}
      data-rc16-content-height={Math.round(box.height)}
      style={responsiveStyle}
    >
      <main
        className="rc16-dashboard"
        aria-label="RaceCon RC-16 Learn Lines - Novice Coaching and Consistency"
        data-rc16-native-size={layout === 'native' ? '800x480' : undefined}
      >
        {/* Packet 11.1 zone: the central consistency ring, the hero of the composition. */}
        <ConsistencyRing model={model} rect={zones.ring} />

        {/* Packet 11.1 zone: left input-smoothness meter. */}
        <SmoothnessMeter model={model} rect={zones.smoothness} />

        {/* Packet 11.1 zone: right coaching cue card, one cue at a time. */}
        <CueCard model={model} rect={zones.cue} />

        {/* Packet 11.1 zone (and the 12.1 zone RC-16 publishes for OV-2): gentle lap delta. */}
        <DeltaCalm model={model} rect={zones.delta} />

        {/* Packet 11.1 zone: last lap and the consistency band recap, one bound field (OV-6). */}
        <LapSummary rows={model.summaryRows} rect={zones.summary} />

        {/* Packet 12.1's `coaching-history-reveal`: app canvas only, never at 800x480. */}
        {showApp ? (
          <ConsistencyHistory points={model.history} notice={model.historyNotice} rect={zones.history} />
        ) : null}

        {/*
          Packet 11.5's macro button. ZG-6: neither 11.1 nor 12.1 gives the focus-area selector a
          zone, so it is a purely off-screen input and the five-zone geometry is preserved intact.
        */}
        <button
          type="button"
          className="rc16-focus-selector"
          data-testid="rc16-focus-selector"
          data-rc16-focus-area={model.focusArea}
          onClick={cycleFocus}
          aria-label={`Coaching focus area, ${model.focusArea}, activate to cycle`}
        >
          {model.focusArea.toUpperCase()}
        </button>

        {model.cue.available ? null : (
          <span className="rc16-sr-only" data-testid="rc16-source-notice">
            {RC16_NO_CUE_NOTICE}
          </span>
        )}
      </main>
    </div>
  )
}
