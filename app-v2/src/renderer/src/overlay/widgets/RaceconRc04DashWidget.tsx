import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { WidgetProps } from './types'
import { raceconDisplayClockFrozen, useRaceconDisplayClock } from './raceconDisplayClock'
import { Rc01LiveTelemetryBuffer, type Rc01MonotonicClock, rc01FieldDescription, rc01MonotonicNow } from './raceconRc01Core'
import {
  RC04_DEFAULT_PIT_LIMIT_KMH,
  RC04_PHASE_EVENT,
  type Rc04DashboardModel,
  type Rc04Field,
  Rc04AuxBuffer,
  Rc04PitSequenceTracker,
  acknowledgeRc04Alarms,
  advanceRc04Alerts,
  clearInvalidRc04Alerts,
  createRc04AlertState,
  createRc04DashboardModel,
  rc04AlarmLines,
  rc04AlertInputForModel,
  rc04CompactModeForContentBox,
  rc04LayoutForContentBox,
  rc04PhaseDescription,
  rc04PhaseFromEvent,
  rc04PhoneGeometryForContentBox,
  rc04ServiceActive,
  rc04SpeedBarDescription
} from './raceconRc04Core'
import './raceconRc04.css'

function configSize(config: WidgetProps['config']): { width: number; height: number } {
  const width = config?.position?.width
  const height = config?.position?.height
  return {
    width: typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : 1024,
    height: typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : 600
  }
}

function useContentBox(ref: React.RefObject<HTMLDivElement | null>, config: WidgetProps['config']): { width: number; height: number } {
  const fallback = configSize(config)
  const [box, setBox] = useState(fallback)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return

    // The dashboard canvas can be transformed relative to its authored size, so the
    // composition size is the transformed bounding rect, not the content box.
    const measure = (): boolean => {
      const rect = element.getBoundingClientRect()
      if (!Number.isFinite(rect.width) || rect.width <= 0 || !Number.isFinite(rect.height) || rect.height <= 0) return false
      setBox((current) => (current.width === rect.width && current.height === rect.height ? current : { width: rect.width, height: rect.height }))
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
  value: Rc04Field
  unit?: string
  description?: string
  zone?: string
}): ReactElement {
  return (
    <div className="rc04-row" data-testid="rc04-row" data-rc04-zone={zone}>
      <span className="rc04-label">{label}</span>
      <output
        className={`rc04-value${value.stale ? ' is-stale' : ''}${value.unavailable ? ' is-unavailable' : ''}`}
        aria-label={rc01FieldDescription(description ?? label, value)}
      >
        {value.value}
      </output>
      {unit ? (
        <span className="rc04-unit" aria-hidden="true">
          {unit}
        </span>
      ) : null}
    </div>
  )
}

/**
 * RC-04 is an overlay-widget-owned, live-only pit-procedure dashboard. It shares RC-01's
 * fail-closed ingest buffer, so mock and replay telemetry are refused and a source or
 * session discontinuity clears the phase machine and the stint marker.
 */
export interface RaceconRc04DashWidgetProps extends WidgetProps {
  monotonicClock?: Rc01MonotonicClock
  /** The configured pit-lane speed limit; the packet makes the limit a configured datum. */
  pitLimitKmh?: number
}

export function RaceconRc04DashWidget({
  snapshot,
  config,
  preview,
  monotonicClock = rc01MonotonicNow,
  pitLimitKmh = RC04_DEFAULT_PIT_LIMIT_KMH
}: RaceconRc04DashWidgetProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const bufferRef = useRef(new Rc01LiveTelemetryBuffer())
  const auxRef = useRef(new Rc04AuxBuffer())
  const trackerRef = useRef(new Rc04PitSequenceTracker())
  const alertsRef = useRef(createRc04AlertState())
  const appliedAckRef = useRef(0)
  const nowMs = useRaceconDisplayClock(monotonicClock, raceconDisplayClockFrozen(preview))
  const [acknowledgeSeq, setAcknowledgeSeq] = useState(0)
  const [releaseAcknowledged, setReleaseAcknowledged] = useState(false)
  const [phaseOverride, setPhaseOverride] = useState<{ phase: ReturnType<typeof rc04PhaseFromEvent>; seq: number }>({
    phase: null,
    seq: 0
  })
  const appliedPhaseRef = useRef(0)
  const box = useContentBox(rootRef, config)

  // A receipt timestamp, not a display clock: it advances only when a new snapshot object
  // or provider timestamp arrives, so a freshness tick cannot make a stale frame look fresh.
  const arrivalMs = useMemo(() => monotonicClock(), [monotonicClock, snapshot, snapshot?.timestamp])

  // Rendering mutates isolated candidates only; they are committed in the layout phase so
  // StrictMode double-renders and abandoned concurrent renders cannot advance real state.
  const candidate = bufferRef.current.clone()
  const outcome = candidate.ingest(snapshot, arrivalMs)
  const aux = auxRef.current.clone()
  const tracker = trackerRef.current.clone()
  if (phaseOverride.phase !== null && phaseOverride.seq !== appliedPhaseRef.current) {
    tracker.setPhase(phaseOverride.phase, arrivalMs)
  }
  if (outcome.accepted) {
    const accepted = candidate.latestSnapshot()
    aux.ingest(accepted, arrivalMs)
    tracker.ingest({
      onPitRoad: typeof accepted?.onPitRoad === 'boolean' ? accepted.onPitRoad : null,
      pitLimiter: typeof accepted?.pitLimiter === 'boolean' ? accepted.pitLimiter : null,
      inPitStall: typeof accepted?.pit?.inPitStall === 'boolean' ? accepted.pit.inPitStall : null,
      serviceActive: rc04ServiceActive(accepted),
      receivedAt: arrivalMs
    })
  } else if (!outcome.renderable) {
    // Fail closed: anything the buffer refuses also invalidates the phase machine.
    aux.reset()
    tracker.reset()
  }

  const renderSnapshot = outcome.renderable ? candidate.latestSnapshot() : null
  const sequence = tracker.reading(nowMs)

  // Two passes: the first builds the model the alert layer reads, the second re-renders it
  // with whatever the alert layer actually latched, so no surface can escalate for an alert
  // that was cleared in the same frame.
  const provisional = createRc04DashboardModel(renderSnapshot, candidate.receipts(), aux.receipts(), nowMs, {
    sequence,
    alerts: alertsRef.current,
    pitLimitKmh,
    releaseAcknowledged
  })
  const advanced = advanceRc04Alerts(alertsRef.current, rc04AlertInputForModel(provisional, nowMs))
  // The acknowledgement is applied exactly once per press and then lives in the committed
  // alert state, so a NEW engage after a reset re-arms the alarm line instead of staying silent.
  const acknowledged = acknowledgeSeq !== appliedAckRef.current ? acknowledgeRc04Alarms(advanced, nowMs) : advanced
  const alerts = clearInvalidRc04Alerts(acknowledged, provisional)
  const model: Rc04DashboardModel = createRc04DashboardModel(
    renderSnapshot,
    candidate.receipts(),
    aux.receipts(),
    nowMs,
    { sequence, alerts, pitLimitKmh, releaseAcknowledged }
  )

  const layout = rc04LayoutForContentBox(box.width, box.height)
  const compactMode = rc04CompactModeForContentBox(box.width, box.height)
  const phoneGeometry = rc04PhoneGeometryForContentBox(box.width, box.height)
  const alarmLines = rc04AlarmLines(alerts)

  // Packet 11.1 bar geometry travels as custom properties on the inner element, so the fill
  // and the limit rule keep the packet's proportions independently of the hero type size.
  const responsiveStyle = {
    '--rc04-bar-fill': `${model.speedBar.fill * 100}%`,
    '--rc04-limit-rule': `${model.speedBar.limitFraction * 100}%`,
    ...(phoneGeometry
      ? {
          '--rc04-phone-inset': `${phoneGeometry.inset}px`,
          '--rc04-phone-ribbon-top': `${phoneGeometry.ribbonTop}px`,
          '--rc04-phone-ribbon-height': `${phoneGeometry.ribbonHeight}px`,
          '--rc04-phone-bar-top': `${phoneGeometry.barTop}px`,
          '--rc04-phone-bar-height': `${phoneGeometry.barHeight}px`,
          '--rc04-phone-limiter-top': `${phoneGeometry.limiterTop}px`,
          '--rc04-phone-limiter-height': `${phoneGeometry.limiterHeight}px`,
          '--rc04-phone-service-top': `${phoneGeometry.serviceTop}px`,
          '--rc04-phone-service-height': `${phoneGeometry.serviceHeight}px`,
          '--rc04-phone-action-top': `${phoneGeometry.actionTop}px`,
          '--rc04-phone-action-height': `${phoneGeometry.actionHeight}px`
        }
      : {})
  } as CSSProperties

  useLayoutEffect(() => {
    bufferRef.current = candidate
    auxRef.current = aux
    trackerRef.current = tracker
    alertsRef.current = alerts
    appliedAckRef.current = acknowledgeSeq
    appliedPhaseRef.current = phaseOverride.seq
  }, [candidate, aux, tracker, alerts, acknowledgeSeq, phaseOverride.seq])

  // The release acknowledgement belongs to one RELEASE step; leaving the step drops it so a
  // later stop can never inherit a stale "lane clear" confirmation.
  useEffect(() => {
    if (model.phase !== 'release') setReleaseAcknowledged(false)
  }, [model.phase])

  // Packet 11.5: the phase advances on a display-switch event as well as on the observed pit
  // signals. An unrecognised payload never moves the checklist.
  useEffect(() => {
    const handler = (event: Event): void => {
      const phase = rc04PhaseFromEvent((event as CustomEvent).detail)
      if (phase !== null) setPhaseOverride((current) => ({ phase, seq: current.seq + 1 }))
    }
    window.addEventListener(RC04_PHASE_EVENT, handler)
    return () => window.removeEventListener(RC04_PHASE_EVENT, handler)
  }, [])

  const resetAlarms = useCallback(() => setAcknowledgeSeq((value) => value + 1), [])
  const confirmRelease = useCallback(() => setReleaseAcknowledged(true), [])

  const releaseBlocked = alerts.unsafeRelease.active
  const macroEnabled = model.phase === 'release' && !releaseBlocked

  return (
    <div
      ref={rootRef}
      className="rc04-widget"
      data-widget="raceconRc04Dash"
      data-rc04-layout={layout}
      data-rc04-compact-mode={layout === 'compact' ? compactMode : undefined}
      data-rc04-buffer-state={outcome.reason}
      data-rc04-phase={model.phase}
      data-rc04-phase-feed={model.phaseLive ? 'live' : 'idle'}
      data-rc04-overspeed={alerts.overspeed.active ? 'true' : 'false'}
      data-rc04-limiter-mismatch={alerts.limiterMismatch.active ? 'true' : 'false'}
      data-rc04-unsafe-release={alerts.unsafeRelease.active ? 'true' : 'false'}
      data-rc04-shift-leds={model.shiftLedsSuppressed ? 'suppressed' : 'restored'}
      data-rc04-content-width={Math.round(box.width)}
      data-rc04-content-height={Math.round(box.height)}
      style={responsiveStyle}
    >
      <main
        className="rc04-dashboard"
        aria-label="RaceCon RC-04 pit entry, stop and exit sequence dashboard"
        data-rc04-native-size={layout === 'native' ? '800x480' : undefined}
      >
        {/* Packet 11.1: five discrete steps, only the active one enlarged. */}
        <section
          className="rc04-ribbon"
          data-testid="rc04-ribbon"
          role="list"
          aria-label={rc04PhaseDescription(model)}
        >
          {model.steps.map((step) => (
            <div
              key={step.phase}
              className="rc04-step"
              data-testid="rc04-step"
              data-rc04-step={step.phase}
              data-active={step.active ? 'true' : 'false'}
              data-done={step.done ? 'true' : 'false'}
              role="listitem"
              aria-current={step.active ? 'step' : undefined}
            >
              <span className="rc04-step-label">{step.label}</span>
              {/* Accessibility note 2: the active step is marked by size AND a caret. */}
              {step.active ? <span className="rc04-step-caret" data-testid="rc04-step-caret" aria-hidden="true" /> : null}
            </div>
          ))}
        </section>

        {/* Packet 11.1: the dominant speed-versus-limit safety bar. */}
        <section
          className="rc04-speed"
          data-testid="rc04-speed-zone"
          data-tone={model.speedBar.tone}
          data-unavailable={model.speedBar.unavailable ? 'true' : 'false'}
          data-alert={model.speedBar.alert ? 'true' : 'false'}
          aria-label="Pit speed versus pit limit"
        >
          <div className="rc04-speed-head">
            <span className="rc04-label rc04-speed-title">PIT SPEED</span>
            <div className="rc04-speed-meta">
              <Readout label="LIMIT" value={model.pitLimit} description="Pit speed limit" zone="limit" />
              <Readout label="GEAR" value={model.gear} description="Gear" zone="gear" />
            </div>
          </div>
          <div className="rc04-speed-hero">
            <output
              className={`rc04-value rc04-speed-value${model.pitSpeed.stale ? ' is-stale' : ''}${
                model.pitSpeed.unavailable ? ' is-unavailable' : ''
              }`}
              aria-label={rc01FieldDescription('Pit speed', model.pitSpeed)}
            >
              {model.pitSpeed.value}
            </output>
            <span className="rc04-unit rc04-speed-unit" aria-hidden="true">
              KM/H
            </span>
          </div>
          <div
            className="rc04-bar"
            data-testid="rc04-bar"
            role="img"
            aria-label={rc04SpeedBarDescription(model.speedBar, model.pitSpeed, model.pitLimit)}
          >
            <span className="rc04-bar-fill" data-testid="rc04-bar-fill" aria-hidden="true" />
            <span className="rc04-bar-rule" data-testid="rc04-limit-rule" aria-hidden="true" />
          </div>
        </section>

        {/* Packet 11.1: the limiter state block. A single pulse on engage, never a strobe. */}
        <section
          key={`limiter-${alerts.limiterMismatch.pulseSeq}`}
          className="rc04-limiter"
          data-testid="rc04-limiter-badge"
          data-state={model.limiter.unavailable ? 'unknown' : model.limiter.value ? 'on' : 'off'}
          data-mismatch={model.limiter.mismatch ? 'true' : 'false'}
          aria-label="Pit limiter state"
        >
          <span className="rc04-label">LIMITER</span>
          <output
            className={`rc04-value rc04-limiter-value${model.limiter.stale ? ' is-stale' : ''}${
              model.limiter.unavailable ? ' is-unavailable' : ''
            }`}
            aria-label={
              model.limiter.unavailable
                ? 'Pit limiter unavailable'
                : `Pit limiter ${model.limiter.label}${model.limiter.stale ? ' stale' : ''}`
            }
          >
            {model.limiter.label}
          </output>
        </section>

        {/* Packet 11.1 service tile; packet 12.1 turns it into the wider service summary. */}
        <section className="rc04-service" data-testid="rc04-service-tile" aria-label="Pit service status">
          <Readout label="FUEL" value={model.fuel} unit="L" description="Fuel level" zone="fuel" />
          <Readout label="STINT" value={model.stint} description="Stint timer" zone="stint" />
          <Readout label="GRID" value={model.gridSlot} description="Grid slot" zone="grid" />
          {/* Packet 14 Attention: the SERVICE phase surfaces the remaining service work. */}
          {model.phase === 'service' ? (
            <Readout
              label="SERVICE"
              value={model.serviceRemaining}
              description="Service work remaining"
              zone="service"
            />
          ) : null}
          <div className="rc04-service-app">
            <Readout label="STOP" value={model.stopClock} description="Elapsed stop time" zone="stop" />
            <Readout label="TYRES" value={model.tyresChanged} description="Tyres changed" zone="tyres" />
          </div>
        </section>

        {/* Packet 12.1 crew-column-reveal: width alone exposes the pit crew's own view. */}
        <aside className="rc04-crew" data-testid="rc04-crew-column" aria-label="Crew service status">
          <div className="rc04-crew-grid">
            {model.crew.map((corner) => (
              <div
                key={corner.corner}
                className="rc04-crew-corner"
                data-testid="rc04-crew-corner"
                data-corner={corner.corner}
                data-serviced={corner.unavailable ? 'unknown' : corner.value === 'SET' ? 'true' : 'false'}
              >
                <span className="rc04-label">{corner.corner}</span>
                <output
                  className={`rc04-value${corner.stale ? ' is-stale' : ''}${corner.unavailable ? ' is-unavailable' : ''}`}
                  aria-label={rc01FieldDescription(`${corner.corner} wheel service`, corner)}
                >
                  {corner.value}
                </output>
              </div>
            ))}
          </div>
          <Readout label="FUEL TGT" value={model.fuelTarget} unit="L" description="Fuel target" zone="fuel-target" />
        </aside>

        {/* Packet 11.1: exactly one imperative line for the current step. */}
        <section
          className="rc04-action"
          data-testid="rc04-action-line"
          data-tone={model.action.tone}
          aria-label="Current pit action"
        >
          <p className="rc04-action-text" data-testid="rc04-action-text">
            {model.action.text}
          </p>

          {/* The proximity readout only exists where it can be acted on: the RELEASE step. */}
          {model.phase === 'release' ? (
            <div className="rc04-lane" data-testid="rc04-lane">
              <Readout label="LANE" value={model.proximity} description="Spotter proximity zone" zone="proximity" />
            </div>
          ) : null}

          <button
            type="button"
            className="rc04-macro"
            data-testid="rc04-macro"
            onClick={confirmRelease}
            disabled={!macroEnabled}
            aria-disabled={!macroEnabled}
            aria-label={
              releaseBlocked
                ? 'Release acknowledgement blocked while the pit lane is not clear'
                : 'Acknowledge a release-safe pit exit'
            }
          >
            {releaseAcknowledged && model.phase === 'release' ? 'RELEASE OK' : 'CONFIRM RELEASE'}
          </button>

          {alarmLines.length > 0 ? (
            <p className="rc04-alarm-line" data-testid="rc04-alarm-line" role="alert">
              <span>{alarmLines.join(' \u00B7 ')}</span>
              <button type="button" className="rc04-alarm-reset" data-testid="rc04-alarm-reset" onClick={resetAlarms}>
                RESET
              </button>
            </p>
          ) : null}

          {/* Packet 15: the unsafe-release inhibitor sits OVER the action line, in every layout. */}
          {alerts.unsafeRelease.active ? (
            <div className="rc04-hold" data-testid="rc04-hold-block" role="alert">
              <span className="rc04-hold-text">HOLD</span>
              <span className="rc04-hold-detail">{model.proximity.value}</span>
            </div>
          ) : null}
        </section>

        {alerts.overspeed.active ? (
          <div className="rc04-sr-alert" role="status">
            Pit overspeed, lift for the pit limit
          </div>
        ) : null}
        {alerts.limiterMismatch.active ? (
          <div className="rc04-sr-alert" role="status">
            Pit limiter is off in the limiter phase
          </div>
        ) : null}
        {alerts.unsafeRelease.active ? (
          <div className="rc04-sr-alert" role="status">
            Unsafe release, hold in the box
          </div>
        ) : null}
      </main>
    </div>
  )
}
