import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { WidgetProps } from './types'
import { raceconDisplayClockFrozen, useRaceconDisplayClock } from './raceconDisplayClock'
import {
  Rc01LiveTelemetryBuffer,
  type Rc01Field,
  type Rc01MonotonicClock,
  rc01MonotonicNow
} from './raceconRc01Core'
import {
  RC18_BASELINE_LOCK_EVENT,
  RC18_MIRROR_AXIS_PCT,
  RC18_SIDE_LABELS,
  RC18_SIDE_LINE_BANDS,
  RC18_SPINE_HALF_SPAN_PCT,
  RC18_TYPE_SCALE_PX,
  type Rc18DashboardModel,
  type Rc18MetricPair,
  type Rc18Rect,
  Rc18RunRecorder,
  type Rc18SectorVerdict,
  type Rc18Side,
  advanceRc18Alerts,
  clearInvalidRc18Alerts,
  createRc18AlertState,
  createRc18DashboardModel,
  rc18AlertInputForModel,
  rc18AlertLines,
  rc18BaselineCommandFromEvent,
  rc18CompactModeForContentBox,
  rc18LayoutForContentBox,
  rc18NestedRect,
  rc18Percent,
  rc18RowsForLayout,
  rc18SampleFromSnapshot,
  rc18SideDescription,
  rc18TypeScaleCqw,
  rc18ZoneStyle,
  rc18ZonesForLayout
} from './raceconRc18Core'
import './raceconRc18.css'

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

function zoneStyle(rect: Rc18Rect | undefined): CSSProperties | undefined {
  const style = rc18ZoneStyle(rect)
  return style ? (style as CSSProperties) : undefined
}

function valueClass(value: Rc01Field): string {
  return `rc18-value${value.stale ? ' is-stale' : ''}${value.unavailable ? ' is-unavailable' : ''}`
}

/**
 * One mirrored metric row. The SAME `Rc18MetricPair` renders both halves — only `side` differs —
 * so the two columns cannot drift out of symmetry and the pair-level INCOMPARABLE tag lands on
 * both sides at once, exactly as the brief requires (neither side may read as healthy).
 */
function Row({ pair, side }: { pair: Rc18MetricPair; side: Rc18Side }): ReactElement {
  const value = side === 'a' ? pair.a : pair.b
  return (
    <div
      className="rc18-row"
      data-testid="rc18-row"
      data-rc18-row={pair.key}
      data-rc18-rung={pair.rung}
      data-rc18-side={side}
      data-rc18-incomparable={pair.incomparable ? 'true' : 'false'}
    >
      <span className="rc18-label">
        {pair.label}
        <span className="rc18-unit">{pair.unit}</span>
        {pair.incomparable ? <span className="rc18-incomparable-tag">INCOMPARABLE</span> : null}
      </span>
      <output
        className={valueClass(value)}
        data-testid={`rc18-${side}-${pair.key}`}
        data-tone={value.tone}
        aria-label={rc18SideDescription(side, pair.label, value)}
      >
        {value.value}
      </output>
    </div>
  )
}

function SetupColumn({
  side,
  pairs,
  rect,
  locked
}: {
  side: Rc18Side
  pairs: readonly Rc18MetricPair[]
  rect: Rc18Rect | undefined
  locked: boolean
}): ReactElement {
  return (
    <section
      className="rc18-column"
      data-testid={`rc18-column-${side}`}
      data-rc18-zone={side === 'a' ? 'columnA' : 'columnB'}
      data-rc18-side={side}
      data-rc18-rows={pairs.length}
      style={zoneStyle(rect)}
      aria-label={`${RC18_SIDE_LABELS[side]} matched lap metrics`}
    >
      <header className="rc18-column-head">
        <span className="rc18-column-name" data-testid={`rc18-name-${side}`}>
          {RC18_SIDE_LABELS[side]}
          {side === 'a' && locked ? ' \u25A0' : ''}
        </span>
        {/*
          Normative override NO-6: A carries ONE identity line, B carries TWO. The count is the
          non-colour pattern that keeps the two setups separable for a colour-blind reader.
        */}
        <span
          className="rc18-identity"
          data-testid={`rc18-identity-${side}`}
          data-rc18-line-bands={RC18_SIDE_LINE_BANDS[side]}
          aria-hidden="true"
        >
          {Array.from({ length: RC18_SIDE_LINE_BANDS[side] }, (_, index) => (
            <span key={index} className="rc18-identity-line" />
          ))}
        </span>
      </header>
      <div className="rc18-rows">
        {pairs.map((pair) => (
          <Row key={pair.key} pair={pair} side={side} />
        ))}
      </div>
    </section>
  )
}

/**
 * One delta row of the verdict spine. The bar is anchored to the SHARED datum at 50 % of the
 * track and its length is `rc18BarLengthPct` — normative override NO-2 arithmetic — so all
 * three bars sit on one axis and none is ever eyeballed from the reference render.
 */
function DeltaRow({ verdict }: { verdict: Rc18SectorVerdict }): ReactElement {
  const arrow = verdict.fasterSide === 'a' ? '\u25C0' : verdict.fasterSide === 'b' ? '\u25B6' : '\u2013'
  return (
    <div
      className="rc18-delta-row"
      data-testid={`rc18-delta-${verdict.label}`}
      data-rc18-sector={verdict.label}
      data-rc18-highlight={verdict.highlighted ? 'true' : 'false'}
      data-rc18-muted={verdict.muted ? 'true' : 'false'}
      data-rc18-faster={verdict.fasterSide ?? 'none'}
      data-rc18-incomparable={verdict.incomparable ? 'true' : 'false'}
      data-rc18-clamped={verdict.clamped ? 'true' : 'false'}
      data-rc18-length-pct={verdict.lengthPct.toFixed(4)}
    >
      <div className="rc18-delta-head">
        <span className="rc18-label rc18-delta-label">{verdict.label}</span>
        <span className="rc18-delta-arrow" data-testid={`rc18-arrow-${verdict.label}`} aria-hidden="true">
          {arrow}
        </span>
      </div>
      <output
        className="rc18-delta-value"
        data-testid={`rc18-delta-value-${verdict.label}`}
        aria-label={`${verdict.label} setup B minus setup A ${
          verdict.incomparable ? 'unavailable' : verdict.value
        }`}
      >
        {verdict.value}
      </output>
      <div className="rc18-delta-track" data-testid={`rc18-track-${verdict.label}`}>
        <span className="rc18-delta-datum" data-testid={`rc18-datum-${verdict.label}`} aria-hidden="true" />
        {verdict.fasterSide && !verdict.incomparable ? (
          <span
            className="rc18-delta-bar"
            data-testid={`rc18-bar-${verdict.label}`}
            data-rc18-lean={verdict.fasterSide}
            style={{ '--rc18-bar-length': rc18Percent(verdict.lengthPct) } as CSSProperties}
            aria-hidden="true"
          />
        ) : null}
      </div>
    </div>
  )
}

function TracePlot({ model }: { model: Rc18DashboardModel }): ReactElement {
  if (!model.trace.available) {
    return (
      <p className="rc18-trace-empty" data-testid="rc18-trace-empty">
        NO MATCHED SPEED TRACE
      </p>
    )
  }
  const path = (side: Rc18Side): string =>
    model.trace.points[side].map(([x, y]) => `${(x * 100).toFixed(2)},${((1 - y) * 100).toFixed(2)}`).join(' ')
  return (
    <svg
      className="rc18-trace-plot"
      data-testid="rc18-trace-plot"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      role="img"
      aria-label="Setup A versus setup B speed against lap distance"
    >
      <polyline className="rc18-trace-line" data-rc18-side="a" points={path('a')} />
      <polyline className="rc18-trace-line" data-rc18-side="b" points={path('b')} />
    </svg>
  )
}

/**
 * RC-18 is an overlay-widget-owned, live-only setup A/B comparison. It shares RC-01's
 * fail-closed ingest buffer, so mock and replay telemetry are refused and a source or session
 * discontinuity discards every matched lap rather than comparing two different cars.
 *
 * There is no channel that identifies a car setup, so A and B are two MATCHED LAPS from the same
 * live stream: A is the locked baseline (or the oldest matched lap held) and B the latest. That
 * limitation is published in `RC18_PACKET_OMISSIONS.configurationIdentityChannel` and the widget
 * never claims to be watching two cars at once.
 */
export interface RaceconRc18DashWidgetProps extends WidgetProps {
  monotonicClock?: Rc01MonotonicClock
}

export function RaceconRc18DashWidget({
  snapshot,
  config,
  preview,
  monotonicClock = rc01MonotonicNow
}: RaceconRc18DashWidgetProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const bufferRef = useRef(new Rc01LiveTelemetryBuffer())
  const recorderRef = useRef(new Rc18RunRecorder())
  const alertsRef = useRef(createRc18AlertState())
  const [baselineOrdinal, setBaselineOrdinal] = useState<number | null>(null)
  const nowMs = useRaceconDisplayClock(monotonicClock, raceconDisplayClockFrozen(preview))
  const box = useContentBox(rootRef, config)

  // A receipt timestamp, not a display clock: it advances only when a new snapshot object or
  // provider timestamp arrives, so a freshness tick cannot make a stale frame look fresh.
  const arrivalMs = useMemo(() => monotonicClock(), [monotonicClock, snapshot, snapshot?.timestamp])

  // Rendering mutates isolated candidates only; they are committed in the layout phase so
  // StrictMode double-renders and abandoned concurrent renders cannot advance real state.
  const candidate = bufferRef.current.clone()
  const outcome = candidate.ingest(snapshot, arrivalMs)
  const recorder = recorderRef.current.clone()
  if (outcome.accepted) {
    const sample = rc18SampleFromSnapshot(candidate.latestSnapshot(), candidate.receipts(), arrivalMs)
    if (sample) recorder.ingest(sample)
  } else if (!outcome.renderable) {
    // Fail closed: anything the buffer refuses also discards every matched lap, so a new source
    // or a replay stream can never be compared against the previous car's laps.
    recorder.reset()
  }

  const layout = rc18LayoutForContentBox(box.width, box.height)
  const compactMode = rc18CompactModeForContentBox(box.width, box.height)
  const zones = rc18ZonesForLayout(layout, compactMode)
  const rows = rc18RowsForLayout(layout, compactMode)
  const runs = recorder.laps()
  const modelOptions = {
    rows,
    includeTrace: layout === 'app',
    baselineOrdinal,
    feedFresh: recorder.feedFresh(nowMs),
    hasTimingFeed: recorder.hasTimingFeed()
  }

  // Two passes: the first builds the model the alert layer reads, the second re-renders it with
  // whatever the alert layer actually latched, so no surface can escalate for an alert that was
  // cleared in the same frame.
  const provisional = createRc18DashboardModel(runs, nowMs, { ...modelOptions, alerts: alertsRef.current })
  const advanced = advanceRc18Alerts(alertsRef.current, rc18AlertInputForModel(provisional, nowMs))
  const alerts = clearInvalidRc18Alerts(advanced, provisional.pairAvailable)
  const model = createRc18DashboardModel(runs, nowMs, { ...modelOptions, alerts })

  useLayoutEffect(() => {
    bufferRef.current = candidate
    recorderRef.current = recorder
    alertsRef.current = alerts
  }, [candidate, recorder, alerts])

  // Packet 11.5 and 13: the matched laps are toggled and a setup is locked as the baseline. No
  // zone hosts a control on either canvas (gap G6), so the command is a window event.
  useEffect(() => {
    const handler = (event: Event): void => {
      const command = rc18BaselineCommandFromEvent((event as CustomEvent).detail)
      if (command === null) return
      if (command === 'release') setBaselineOrdinal(null)
      else if (command === 'lock') setBaselineOrdinal(recorderRef.current.laps()[0]?.lapOrdinal ?? null)
      else setBaselineOrdinal((current) => current)
    }
    window.addEventListener(RC18_BASELINE_LOCK_EVENT, handler)
    return () => window.removeEventListener(RC18_BASELINE_LOCK_EVENT, handler)
  }, [])

  const alertLines = rc18AlertLines(model.alerts)
  const stabilityRect = zones.stability && zones.spine ? rc18NestedRect(zones.stability, zones.spine) : undefined
  const deltaStackRect = zones.deltaStack && zones.spine ? rc18NestedRect(zones.deltaStack, zones.spine) : undefined

  const responsiveStyle = {
    '--rc18-type-verdict': `${rc18TypeScaleCqw(RC18_TYPE_SCALE_PX.verdict)}cqw`,
    '--rc18-type-sector': `${rc18TypeScaleCqw(RC18_TYPE_SCALE_PX.sector)}cqw`,
    '--rc18-type-summary': `${rc18TypeScaleCqw(RC18_TYPE_SCALE_PX.summary)}cqw`,
    '--rc18-type-secondary': `${rc18TypeScaleCqw(RC18_TYPE_SCALE_PX.secondary)}cqw`,
    '--rc18-type-label': `${rc18TypeScaleCqw(RC18_TYPE_SCALE_PX.label)}cqw`
  } as CSSProperties

  return (
    <div
      ref={rootRef}
      className="rc18-widget"
      data-widget="raceconRc18Dash"
      data-rc18-layout={layout}
      data-rc18-compact-mode={layout === 'compact' ? compactMode : undefined}
      data-rc18-buffer-state={outcome.reason}
      data-rc18-pair={model.pairAvailable ? 'matched' : 'unavailable'}
      data-rc18-baseline={model.baselineLocked ? 'locked' : 'auto'}
      data-rc18-feed={model.feed}
      data-rc18-faster={model.summary.fasterSide ?? 'none'}
      data-rc18-alerts={alertLines.length > 0 ? 'active' : 'silent'}
      data-rc18-alert-keys={alertLines.join(',')}
      data-rc18-incomparable={model.incomparableKeys.length}
      data-rc18-rows={rows.length}
      data-rc18-mirror-axis-pct={RC18_MIRROR_AXIS_PCT}
      data-rc18-half-span-pct={RC18_SPINE_HALF_SPAN_PCT.toFixed(4)}
      data-rc18-content-width={Math.round(box.width)}
      data-rc18-content-height={Math.round(box.height)}
      style={responsiveStyle}
    >
      <main
        className="rc18-dashboard"
        aria-label="RaceCon RC-18 split test, setup A versus setup B practice comparison"
        data-rc18-native-size={layout === 'native' ? '800x480' : undefined}
      >
        {/* Packet 11.1 summary header: which setup is faster overall and by how much. */}
        <section
          className="rc18-summary"
          data-testid="rc18-summary"
          data-rc18-zone="summary"
          style={zoneStyle(zones.summary)}
          aria-label="Overall verdict"
        >
          <output
            className={`rc18-summary-verdict${model.summary.unavailable ? ' is-unavailable' : ''}`}
            data-testid="rc18-verdict"
            data-rc18-faster={model.summary.fasterSide ?? 'none'}
          >
            {model.summary.text}
          </output>
          <span className="rc18-summary-lock" data-testid="rc18-baseline">
            {model.baselineLocked ? 'BASELINE LOCKED' : 'BASELINE AUTO'}
          </span>
          {/*
            Trigger-only, and the alert surface that survives every reflow: the phone breakpoint
            drops the tyre and brake modules, so their INCOMPARABLE state is carried here.
          */}
          {alertLines.length > 0 ? (
            <output className="rc18-summary-alert" data-testid="rc18-alert-chip">
              {model.alerts.incomparable
                ? `INCOMPARABLE ${model.incomparableKeys.length}`
                : model.alerts.stability
                  ? 'STABILITY GAP'
                  : 'SECTOR GAP'}
            </output>
          ) : null}
        </section>

        <SetupColumn side="a" pairs={model.pairs} rect={zones.columnA} locked={model.baselineLocked} />

        {/*
          Packet 11.1 verdict spine. It is the mirror axis, so it carries no panel fill of its
          own; the delta stack and the nested stability row are the only surfaces inside it, and
          the packet's own 100 % overlap between them (gap G3) is resolved by the 4 px gutter.
        */}
        <section
          className="rc18-spine"
          data-testid="rc18-spine"
          data-rc18-zone="spine"
          style={zoneStyle(zones.spine)}
          aria-label="Per-sector A versus B verdict"
        >
          <div className="rc18-delta-stack" data-testid="rc18-delta-stack" style={zoneStyle(deltaStackRect)}>
            <span className="rc18-label rc18-spine-title">VERDICT</span>
            <div className="rc18-delta-rows">
              {model.verdicts.map((verdict) => (
                <DeltaRow key={verdict.label} verdict={verdict} />
              ))}
            </div>
          </div>

          <div
            className="rc18-stability"
            data-testid="rc18-stability"
            data-rc18-zone="stability"
            data-rc18-highlight={model.stability.highlighted ? 'true' : 'false'}
            data-rc18-available={model.stability.available ? 'true' : 'false'}
            style={zoneStyle(stabilityRect)}
          >
            <div className="rc18-stability-head">
              <span className="rc18-label">BALANCE</span>
              <span className="rc18-stability-source" data-testid="rc18-balance-source">
                {model.stability.sourceLabel}
              </span>
            </div>
            <div className="rc18-stability-lines">
              {(['a', 'b'] as const).map((side) => {
                const value = side === 'a' ? model.stability.a : model.stability.b
                return (
                  <div key={side} className="rc18-stability-line" data-rc18-side={side}>
                    <span className="rc18-label">{side.toUpperCase()}</span>
                    <output
                      className={valueClass(value)}
                      data-testid={`rc18-balance-${side}`}
                      data-tone={value.tone}
                      aria-label={rc18SideDescription(side, 'chassis balance index', value)}
                    >
                      {value.value}
                    </output>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        <SetupColumn side="b" pairs={model.pairs} rect={zones.columnB} locked={model.baselineLocked} />

        {/*
          Packet 12.1 expansion `ab-trace-reveal`. It exists on the 1024x600 canvas ONLY — the
          800x480 canvas has no zone for speed at all (gap G9), so no speed value appears there.
        */}
        {layout === 'app' && zones.trace ? (
          <section
            className="rc18-trace"
            data-testid="rc18-trace"
            data-rc18-zone="trace"
            data-rc18-available={model.trace.available ? 'true' : 'false'}
            style={zoneStyle(zones.trace)}
            aria-label="Setup A versus setup B speed trace"
          >
            <div className="rc18-trace-head">
              <span className="rc18-label">
                A / B SPEED
                <span className="rc18-unit">KM/H</span>
              </span>
              <span className="rc18-stability-source" data-testid="rc18-trace-range">
                {model.trace.available
                  ? `${Math.round(model.trace.minKmh as number)}\u2013${Math.round(model.trace.maxKmh as number)}`
                  : '--'}
              </span>
            </div>
            <TracePlot model={model} />
          </section>
        ) : null}
      </main>
    </div>
  )
}
