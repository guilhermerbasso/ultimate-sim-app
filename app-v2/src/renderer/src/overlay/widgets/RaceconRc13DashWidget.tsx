import { useLayoutEffect, useMemo, useRef, useState } from 'react'
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
  RC13_ALERT_LABELS,
  RC13_NO_QUEUE_SOURCE,
  RC13_TYPE_SCALE_PX,
  type Rc13AlertId,
  Rc13AuxBuffer,
  type Rc13DashboardModel,
  Rc13QueueBuffer,
  type Rc13Rect,
  type Rc13WindowZone,
  type Rc13ZoneId,
  advanceRc13Alerts,
  clearInvalidRc13Alerts,
  createRc13AlertState,
  createRc13DashboardModel,
  rc13AlertInputForModel,
  rc13CompactModeForContentBox,
  rc13FlagDescription,
  rc13LayoutForContentBox,
  rc13PhoneGeometryForContentBox,
  rc13RestartDescription,
  rc13TypeScaleCqw,
  rc13WindowDescription,
  rc13ZoneStyle,
  rc13ZonesForLayout
} from './raceconRc13Core'
import './raceconRc13.css'

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

function zoneStyle(rect: Rc13Rect | undefined): CSSProperties | undefined {
  const style = rc13ZoneStyle(rect)
  return style ? (style as CSSProperties) : undefined
}

function valueClass(base: string, value: { stale: boolean; unavailable: boolean }): string {
  return `${base}${value.stale ? ' is-stale' : ''}${value.unavailable ? ' is-unavailable' : ''}`
}

/**
 * Packet 15 alert surfaces. The element exists ONLY while its trigger is engaged — there is no hidden
 * always-present node — so a silent frame contains no alert markup and therefore no alert-token pixel.
 * Packet 19: the alert is a WORD, and the colour is redundant reinforcement.
 */
function Alert({ alert }: { alert: Rc13AlertId }): ReactElement {
  return (
    <span
      className="rc13-alert"
      data-testid={`rc13-alert-${alert}`}
      data-rc13-alert={alert}
      role="status"
    >
      {RC13_ALERT_LABELS[alert]}
    </span>
  )
}

/**
 * Normative override N3, rendered as arithmetic. The band is placed from the zone's own declared bar
 * units and the word from its own declared centre, so both numbers are visible in the DOM and are
 * asserted by the suite rather than baked into a gradient nobody can measure.
 */
function WindowBand({ zone, active }: { zone: Rc13WindowZone; active: boolean }): ReactElement {
  return (
    <span
      className="rc13-window-zone"
      data-testid="rc13-window-zone"
      data-rc13-window-zone-id={zone.id}
      data-rc13-window-zone-active={active ? 'true' : 'false'}
      data-rc13-window-zone-from={zone.from}
      data-rc13-window-zone-to={zone.to}
      style={{ left: `${zone.from}%`, width: `${zone.to - zone.from}%` }}
    >
      <span
        className="rc13-window-zone-word"
        data-testid="rc13-window-zone-word"
        data-rc13-window-zone-centre={zone.centre}
        style={{ left: `${((zone.centre - zone.from) / (zone.to - zone.from)) * 100}%` }}
      >
        {zone.word}
      </span>
    </span>
  )
}

/**
 * RC-13 is an overlay-widget-owned, live-only safety-car procedure page. It shares RC-01's fail-closed
 * ingest buffer, so mock and replay telemetry are refused and a source or session discontinuity clears
 * the aux receipts and the observed queue-gap history rather than carrying a previous session's
 * closing trend into a new one.
 *
 * It also shares the family display clock. RC-13 ages hard against it — the restart state and the
 * track flag both degrade to their no-feed words at 2 s, the queue gap and the position at 1 s and
 * the speed at 500 ms — so a ticking clock over one static preview frame would walk SC DEPLOYED to
 * UNKNOWN with no new data behind it. `raceconDisplayClockFrozen` holds the mount value for every
 * non-live render mode.
 */
export interface RaceconRc13DashWidgetProps extends WidgetProps {
  monotonicClock?: Rc01MonotonicClock
}

export function RaceconRc13DashWidget({
  snapshot,
  config,
  preview,
  monotonicClock = rc01MonotonicNow
}: RaceconRc13DashWidgetProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const bufferRef = useRef(new Rc01LiveTelemetryBuffer())
  const auxRef = useRef(new Rc13AuxBuffer())
  const queueRef = useRef(new Rc13QueueBuffer())
  const alertsRef = useRef(createRc13AlertState())
  const nowMs = useRaceconDisplayClock(monotonicClock, raceconDisplayClockFrozen(preview))
  const box = useContentBox(rootRef, config)

  // A receipt timestamp, not a display clock: it advances only when a new snapshot object or
  // provider timestamp arrives, so a freshness tick cannot make a stale frame look fresh.
  const arrivalMs = useMemo(() => monotonicClock(), [monotonicClock, snapshot, snapshot?.timestamp])

  // Rendering mutates isolated candidates only; they are committed in the layout phase so
  // StrictMode double-renders and abandoned concurrent renders cannot advance real state.
  const candidate = bufferRef.current.clone()
  const outcome = candidate.ingest(snapshot, arrivalMs)
  const aux = auxRef.current.clone()
  const queue = queueRef.current.clone()
  if (outcome.accepted) {
    const accepted = candidate.latestSnapshot()
    aux.ingest(accepted, arrivalMs)
    queue.ingest(accepted, arrivalMs)
  } else if (!outcome.renderable) {
    // Fail closed: anything the buffer refuses also invalidates the aux receipts and the observed
    // gap history, so a new source never inherits the previous session's restart state or its
    // closing trend — which is what would otherwise raise a NO OVERTAKING reminder out of nothing.
    aux.reset()
    queue.reset()
  }

  const renderSnapshot = outcome.renderable ? candidate.latestSnapshot() : null
  const layout = rc13LayoutForContentBox(box.width, box.height)
  const compactMode = rc13CompactModeForContentBox(box.width, box.height)
  const showApp = layout === 'app'
  const gapHistory = queue.history()

  const modelOptions = { gapHistory, includeQueueTrain: showApp }

  // Two passes: the first builds the model the alert layer reads, the second re-renders it with
  // whatever the alert layer actually latched, so no surface can annotate a channel that was
  // invalidated in the same frame.
  const provisional = createRc13DashboardModel(renderSnapshot, candidate.receipts(), aux.receipts(), nowMs, {
    ...modelOptions,
    alerts: alertsRef.current
  })
  const advanced = advanceRc13Alerts(alertsRef.current, rc13AlertInputForModel(provisional, nowMs, gapHistory))
  const alerts = clearInvalidRc13Alerts(advanced, provisional)
  const model: Rc13DashboardModel = createRc13DashboardModel(
    renderSnapshot,
    candidate.receipts(),
    aux.receipts(),
    nowMs,
    { ...modelOptions, alerts }
  )

  const zones = rc13ZonesForLayout(layout, compactMode, box)
  const phoneGeometry = rc13PhoneGeometryForContentBox(box.width, box.height)

  const responsiveStyle = {
    // Normative override N5: the ladder is arithmetic. Because the app canvas is exactly 1.28x the
    // native canvas, ONE cqw ladder gives 80/64/40/32/28 px at 800 wide and 102.4/81.92/51.2/40.96/
    // 35.84 px at 1024 wide, and no rung is ever measured off the approved render.
    '--rc13-type-window': `${rc13TypeScaleCqw(RC13_TYPE_SCALE_PX.windowDelta)}cqw`,
    '--rc13-type-gap': `${rc13TypeScaleCqw(RC13_TYPE_SCALE_PX.queueGap)}cqw`,
    '--rc13-type-status': `${rc13TypeScaleCqw(RC13_TYPE_SCALE_PX.scStatus)}cqw`,
    '--rc13-type-restart': `${rc13TypeScaleCqw(RC13_TYPE_SCALE_PX.restart)}cqw`,
    '--rc13-type-pace': `${rc13TypeScaleCqw(RC13_TYPE_SCALE_PX.pace)}cqw`,
    ...(phoneGeometry
      ? {
          '--rc13-phone-inset': `${phoneGeometry.inset}px`,
          '--rc13-phone-header-height': `${phoneGeometry.headerHeight}px`,
          '--rc13-phone-label-height': `${phoneGeometry.labelHeight}px`,
          '--rc13-phone-bar-height': `${phoneGeometry.barHeight}px`
        }
      : {})
  } as CSSProperties

  useLayoutEffect(() => {
    bufferRef.current = candidate
    auxRef.current = aux
    queueRef.current = queue
    alertsRef.current = alerts
  }, [candidate, aux, queue, alerts])

  const zoneFor = (id: Rc13ZoneId): Rc13Rect | undefined => zones[id]

  return (
    <div
      ref={rootRef}
      className="rc13-widget"
      data-widget="raceconRc13Dash"
      data-rc13-layout={layout}
      data-rc13-compact-mode={layout === 'compact' ? compactMode : undefined}
      data-rc13-buffer-state={outcome.reason}
      data-rc13-restart={model.restart.state}
      data-rc13-flag={model.flag.flag ?? 'no-signal'}
      data-rc13-window-zone={model.scWindow.zone ?? 'none'}
      data-rc13-window-available={model.scWindow.available ? 'true' : 'false'}
      data-rc13-muted={model.muted ? 'true' : 'false'}
      data-rc13-shift-armed={model.shiftArmed ? 'true' : 'false'}
      data-rc13-alerts={model.activeAlerts.length > 0 ? model.activeAlerts.join(' ') : 'silent'}
      data-rc13-content-width={Math.round(box.width)}
      data-rc13-content-height={Math.round(box.height)}
      style={responsiveStyle}
    >
      <main
        className="rc13-dashboard"
        aria-label="RaceCon RC-13 hold order, safety-car and restart procedure"
        data-rc13-native-size={layout === 'native' ? '800x480' : undefined}
      >
        {/*
          Packet 11.1 zone 1. The caution state is spelled out in words (packet 19) and never assumed:
          without a race-control feed the header reads UNKNOWN and the flag strip reads NO SIGNAL.
          The label is INLINE — `RC13_PACKET_OMISSIONS.statusHeaderTypeFit`.
        */}
        <header
          className="rc13-panel rc13-status"
          data-testid="rc13-panel-status"
          data-rc13-zone="status"
          style={zoneStyle(zoneFor('status'))}
        >
          <span className="rc13-zone-label">RACE CONTROL</span>
          <output
            className={valueClass('rc13-status-word', model.restart)}
            data-testid="rc13-restart-status"
            data-tone={model.restart.tone}
            aria-label={rc13RestartDescription(model)}
          >
            {model.restart.value}
          </output>
          <span
            className="rc13-status-flag"
            data-testid="rc13-flag"
            data-rc13-flag-state={model.flag.flag ?? 'no-signal'}
            aria-label={rc13FlagDescription(model)}
          >
            <span className="rc13-zone-label">FLAG</span>
            <span className={valueClass('rc13-status-flag-value', model.flag)}>{model.flag.value}</span>
          </span>
          {model.alerts.restartImminent ? <Alert alert="restartImminent" /> : null}
        </header>

        {/*
          Packet 11.1 zone 2 — the dominant zone, and the one section 16 cannot feed. Normative
          override N4: the delta renders `--.-`, NO marker element is created at all, and no band can
          become active, so the display physically cannot assume the car is legal.
        */}
        <section
          className="rc13-panel rc13-window"
          data-testid="rc13-panel-window"
          data-rc13-zone="window"
          data-rc13-window-available={model.scWindow.available ? 'true' : 'false'}
          style={zoneStyle(zoneFor('window'))}
          aria-label="Safety-car delta window"
        >
          <div className="rc13-window-head">
            <span className="rc13-zone-label">SC DELTA WINDOW</span>
            <span className="rc13-unit">S</span>
          </div>
          <output
            className={valueClass('rc13-window-delta', model.scWindow.delta)}
            data-testid="rc13-sc-delta"
            data-tone={model.scWindow.delta.tone}
            aria-label={rc13WindowDescription(model)}
          >
            {model.scWindow.delta.value}
          </output>
          <div
            className="rc13-window-bar"
            data-testid="rc13-window-bar"
            data-rc13-window-marker={model.scWindow.markerUnit ?? 'none'}
          >
            {model.scWindow.zones.map((zone) => (
              <WindowBand key={zone.id} zone={zone} active={model.scWindow.zone === zone.id} />
            ))}
            {model.scWindow.markerUnit === null ? null : (
              <span
                className="rc13-window-marker"
                data-testid="rc13-window-marker"
                style={{ left: `${model.scWindow.markerUnit}%` }}
              />
            )}
          </div>
          <div className="rc13-window-foot">
            {model.scWindow.available ? null : (
              <span className="rc13-notice" data-testid="rc13-window-notice">
                {model.scWindow.notice}
              </span>
            )}
            {model.alerts.windowViolation ? <Alert alert="windowViolation" /> : null}
          </div>
        </section>

        {/*
          Packet 11.1 zone 3. The gap comes from the timing feed's interval to the car ahead and from
          nowhere else — packet 16 forbids estimating it from closing speed. Packet 12.1's queue-train
          map is app-only and has no channel, so it reveals zero rows and says so.
        */}
        <section
          className="rc13-panel rc13-queue"
          data-testid="rc13-panel-queue"
          data-rc13-zone="queue"
          style={zoneStyle(zoneFor('queue'))}
          aria-label="Gap to the car ahead in the queue"
        >
          <span className="rc13-zone-label">GAP AHEAD</span>
          <div className="rc13-queue-row">
            <output
              className={valueClass('rc13-queue-gap', model.gapAhead)}
              data-testid="rc13-gap-ahead"
              data-tone={model.gapAhead.tone}
              aria-label={rc01FieldDescription('Gap ahead', model.gapAhead)}
            >
              {model.gapAhead.value}
            </output>
            <span className="rc13-unit">S</span>
          </div>
          {showApp ? (
            <div
              className="rc13-train"
              data-testid="rc13-train"
              data-rc13-train-rows={model.queueTrain.rows.length}
              data-rc13-train-available={model.queueTrain.available ? 'true' : 'false'}
            >
              <span className="rc13-zone-label">QUEUE TRAIN</span>
              {model.queueTrain.rows.length === 0 ? (
                <span className="rc13-notice" data-testid="rc13-train-notice">
                  {RC13_NO_QUEUE_SOURCE}
                </span>
              ) : (
                model.queueTrain.rows.map((row) => (
                  <span key={row.id} className="rc13-train-row" data-testid="rc13-train-row">
                    <span>{row.position}</span>
                    <span>{row.gap}</span>
                  </span>
                ))
              )}
            </div>
          ) : null}
        </section>

        {/*
          Packet 11.1 zone 4. The restart status, the expected restart zone — which section 16 never
          defined and which therefore dashes — and packet 15's do-not-overtake reminder, which is
          silent until its pattern engages and is hidden outright when the gap feed is absent.
        */}
        <section
          className="rc13-panel rc13-restart"
          data-testid="rc13-panel-restart"
          data-rc13-zone="restart"
          style={zoneStyle(zoneFor('restart'))}
          aria-label="Restart status block"
        >
          <div className="rc13-restart-row">
            <span className="rc13-zone-label">RESTART</span>
            <output
              className={valueClass('rc13-restart-value', model.restart)}
              data-testid="rc13-restart-block"
              data-tone={model.restart.tone}
              aria-label={rc13RestartDescription(model)}
            >
              {model.restart.value}
            </output>
            {model.alerts.overtakeReminder ? <Alert alert="overtakeReminder" /> : null}
          </div>
          <div
            className="rc13-restart-row"
            data-testid="rc13-restart-zone-row"
            data-rc13-restart-zone-available={model.restartZone.available ? 'true' : 'false'}
          >
            <span className="rc13-zone-label">EXPECTED ZONE</span>
            <span className="rc13-restart-zone-value" data-testid="rc13-restart-zone">
              {model.restartZone.value}
            </span>
            <span className="rc13-notice" data-testid="rc13-restart-zone-notice">
              {model.restartZone.notice}
            </span>
          </div>
          {showApp ? (
            <div
              className="rc13-restart-sketch"
              data-testid="rc13-restart-sketch"
              data-rc13-sketch-markers="0"
            >
              <span className="rc13-zone-label">RESTART ZONE</span>
              <span className="rc13-restart-track" aria-hidden="true" />
            </div>
          ) : null}
        </section>

        {/*
          Packet 11.1 zone 5. Racing telemetry, deliberately de-emphasised: packet 10 suppresses race
          pace because racing is not permitted until green, and the strip un-mutes only on a CONFIRMED
          green. Delta-to-best lives here — `RC13_PACKET_OMISSIONS.deltaBestNoZone` — never in the
          safety-car gauge.
        */}
        <section
          className="rc13-panel rc13-pace"
          data-testid="rc13-panel-pace"
          data-rc13-zone="pace"
          data-rc13-muted={model.muted ? 'true' : 'false'}
          style={zoneStyle(zoneFor('pace'))}
          aria-label="Muted pace telemetry"
        >
          <span className="rc13-pace-cell">
            <span className="rc13-zone-label">POS</span>
            <output
              className={valueClass('rc13-pace-value', model.position)}
              data-testid="rc13-position"
              data-tone={model.position.tone}
              aria-label={rc01FieldDescription('Position', model.position)}
            >
              {model.position.value}
            </output>
          </span>
          <span className="rc13-pace-cell">
            <span className="rc13-zone-label">SPEED</span>
            <output
              className={valueClass('rc13-pace-value', model.speed)}
              data-testid="rc13-speed"
              data-tone={model.speed.tone}
              aria-label={rc01FieldDescription('Speed', model.speed)}
            >
              {model.speed.value}
            </output>
            <span className="rc13-unit">KM/H</span>
          </span>
          <span className="rc13-pace-cell">
            <span className="rc13-zone-label">DELTA</span>
            <output
              className={valueClass('rc13-pace-value', model.deltaBest)}
              data-testid="rc13-delta-best"
              data-tone={model.deltaBest.tone}
              aria-label={rc01FieldDescription('Delta to best', model.deltaBest)}
            >
              {model.deltaBest.value}
            </output>
          </span>
        </section>
      </main>
    </div>
  )
}
