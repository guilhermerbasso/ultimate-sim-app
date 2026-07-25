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
  RC06_EMPTY_PLAN,
  RC06_LIFT_MODE_EVENT,
  RC06_PLAN_EVENT,
  Rc06AuxBuffer,
  type Rc06DashboardModel,
  type Rc06Field,
  Rc06LapLedger,
  type Rc06LiftMode,
  type Rc06Plan,
  type Rc06Rect,
  advanceRc06Alerts,
  clearInvalidRc06Alerts,
  createRc06AlertState,
  createRc06DashboardModel,
  rc06AlertInputForModel,
  rc06AlertLines,
  rc06AuxChannelValue,
  rc06Balance,
  rc06BalanceDescription,
  rc06CompactModeForContentBox,
  rc06LayoutForContentBox,
  rc06LiftModeFromEvent,
  rc06PhoneGeometryForContentBox,
  rc06PlanFromEvent,
  rc06PlanLaps,
  rc06RefuelSignal,
  rc06TrackPercent,
  rc06ZoneStyle,
  rc06ZonesForLayout
} from './raceconRc06Core'
import './raceconRc06.css'

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

function zoneStyle(rect: Rc06Rect | undefined): CSSProperties | undefined {
  const style = rc06ZoneStyle(rect)
  return style ? (style as CSSProperties) : undefined
}

/**
 * One ledger row: an explicit uppercase label above a value, exactly the packet 11.2
 * label-to-value ratio. The unit is a separate dim glyph so it can never be mistaken for a
 * digit of the value.
 */
function LedgerRow({
  label,
  value,
  unit,
  description,
  zone,
  size = 'row'
}: {
  label: string
  value: Rc06Field
  unit?: string
  description?: string
  zone: string
  size?: 'row' | 'hero'
}): ReactElement {
  return (
    <div className={`rc06-row rc06-row-${size}`} data-testid="rc06-row" data-rc06-row={zone}>
      <span className="rc06-label">{label}</span>
      <span className="rc06-row-value">
        <output
          className={`rc06-value${value.stale ? ' is-stale' : ''}${value.unavailable ? ' is-unavailable' : ''}`}
          data-tone={value.tone}
          aria-label={rc01FieldDescription(description ?? label, value)}
        >
          {value.value}
        </output>
        {unit ? (
          <span className="rc06-unit" aria-hidden="true">
            {unit}
          </span>
        ) : null}
      </span>
    </div>
  )
}

/**
 * RC-06 is an overlay-widget-owned, live-only fuel-strategy ledger. It shares RC-01's
 * fail-closed ingest buffer, so mock and replay telemetry are refused and a source or session
 * discontinuity clears the per-lap accounting ledger and every latched plan alert.
 *
 * `plan` carries the engineer's strategy constants. It is deliberately a separate input from
 * the telemetry snapshot: packet section 16 has no channel for a target burn, a plan lap count
 * or a pit lap, and the ledger dashes all three until a plan is actually loaded.
 */
export interface RaceconRc06DashWidgetProps extends WidgetProps {
  monotonicClock?: Rc01MonotonicClock
  plan?: Rc06Plan
}

export function RaceconRc06DashWidget({
  snapshot,
  config,
  monotonicClock = rc01MonotonicNow,
  plan: planProp
}: RaceconRc06DashWidgetProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const bufferRef = useRef(new Rc01LiveTelemetryBuffer())
  const auxRef = useRef(new Rc06AuxBuffer())
  const ledgerRef = useRef(new Rc06LapLedger())
  const alertsRef = useRef(createRc06AlertState())
  const [nowMs, setNowMs] = useState(() => monotonicClock())
  const [liftMode, setLiftMode] = useState<Rc06LiftMode>('liters')
  const [eventPlan, setEventPlan] = useState<Rc06Plan | null>(null)
  const box = useContentBox(rootRef, config)

  const plan = planProp ?? eventPlan ?? RC06_EMPTY_PLAN

  // A receipt timestamp, not a display clock: it advances only when a new snapshot object or
  // provider timestamp arrives, so a freshness tick cannot make a stale frame look fresh.
  const arrivalMs = useMemo(() => monotonicClock(), [monotonicClock, snapshot, snapshot?.timestamp])

  // Rendering mutates isolated candidates only; they are committed in the layout phase so
  // StrictMode double-renders and abandoned concurrent renders cannot advance real state.
  const candidate = bufferRef.current.clone()
  const outcome = candidate.ingest(snapshot, arrivalMs)
  const aux = auxRef.current.clone()
  const ledger = ledgerRef.current.clone()
  if (outcome.accepted) {
    const accepted = candidate.latestSnapshot()
    aux.ingest(accepted, arrivalMs)
    // The accounting cadence is MEASURED from observed lap boundaries on this frame's own
    // channels, so a lap whose burn rate was silent records a null rather than an older value.
    const lap = accepted ? rc06AuxChannelValue(accepted, 'currentLap') : null
    const burn = accepted ? rc06AuxChannelValue(accepted, 'burnRate') : null
    const laps = accepted ? rc06AuxChannelValue(accepted, 'lapsRemaining') : null
    const fuelLevelL = accepted ? rc06AuxChannelValue(accepted, 'fuelLevel') : null
    ledger.observe({
      lap,
      fuelLevelL,
      burn,
      balance: rc06Balance(laps, rc06PlanLaps(plan.pitLap, lap)),
      refuelSignal: rc06RefuelSignal(accepted)
    })
  } else if (!outcome.renderable) {
    // Fail closed: anything the buffer refuses also invalidates the aux receipts and the
    // measured accounting ledger, so a new source never inherits the previous car's plan.
    aux.reset()
    ledger.reset()
  }

  const renderSnapshot = outcome.renderable ? candidate.latestSnapshot() : null

  // Two passes: the first builds the model the alert layer reads, the second re-renders it
  // with whatever the alert layer actually latched, so no surface can escalate for an alert
  // that was cleared in the same frame.
  const provisional = createRc06DashboardModel(renderSnapshot, candidate.receipts(), aux.receipts(), nowMs, {
    plan,
    alerts: alertsRef.current,
    liftMode,
    ledger: ledger.history()
  })
  const advanced = advanceRc06Alerts(alertsRef.current, rc06AlertInputForModel(provisional, ledger.latest(), nowMs))
  const alerts = clearInvalidRc06Alerts(advanced, provisional)
  const model: Rc06DashboardModel = createRc06DashboardModel(
    renderSnapshot,
    candidate.receipts(),
    aux.receipts(),
    nowMs,
    { plan, alerts, liftMode, ledger: ledger.history() }
  )

  const layout = rc06LayoutForContentBox(box.width, box.height)
  const compactMode = rc06CompactModeForContentBox(box.width, box.height)
  const zones = rc06ZonesForLayout(layout, compactMode)
  const phoneGeometry = rc06PhoneGeometryForContentBox(box.width, box.height)
  const alertLines = rc06AlertLines(model)

  const responsiveStyle = phoneGeometry
    ? ({
        '--rc06-phone-inset': `${phoneGeometry.inset}px`,
        '--rc06-phone-balance-height': `${phoneGeometry.balanceHeight}px`,
        '--rc06-phone-column-height': `${phoneGeometry.columnHeight}px`,
        '--rc06-phone-delta-height': `${phoneGeometry.deltaHeight}px`,
        '--rc06-phone-lift-height': `${phoneGeometry.liftHeight}px`,
        '--rc06-phone-track-height': `${phoneGeometry.trackHeight}px`,
        '--rc06-phone-toggle-size': `${phoneGeometry.toggleSize}px`
      } as CSSProperties)
    : ({} as CSSProperties)

  useLayoutEffect(() => {
    bufferRef.current = candidate
    auxRef.current = aux
    ledgerRef.current = ledger
    alertsRef.current = alerts
  }, [candidate, aux, ledger, alerts])

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(monotonicClock()), 100)
    return () => window.clearInterval(timer)
  }, [monotonicClock])

  // Packet 11.5: the soft-key toggles the lift cue between litres-to-plan and
  // distance-to-plan. An unrecognised payload never changes the mode.
  useEffect(() => {
    const handler = (event: Event): void => {
      const next = rc06LiftModeFromEvent((event as CustomEvent).detail)
      if (next !== null) setLiftMode(next)
    }
    window.addEventListener(RC06_LIFT_MODE_EVENT, handler)
    return () => window.removeEventListener(RC06_LIFT_MODE_EVENT, handler)
  }, [])

  // The engineer's plan arrives on its own event so it can be set, revised or cleared
  // mid-stint. An unrecognised payload never mutates the loaded plan.
  useEffect(() => {
    const handler = (event: Event): void => {
      const next = rc06PlanFromEvent((event as CustomEvent).detail)
      if (next !== null) setEventPlan(next)
    }
    window.addEventListener(RC06_PLAN_EVENT, handler)
    return () => window.removeEventListener(RC06_PLAN_EVENT, handler)
  }, [])

  const toggleLiftMode = useCallback(
    () => setLiftMode((current) => (current === 'liters' ? 'distance' : 'liters')),
    []
  )

  const markerFraction = model.lift.markerFraction

  return (
    <div
      ref={rootRef}
      className="rc06-widget"
      data-widget="raceconRc06Dash"
      data-rc06-layout={layout}
      data-rc06-compact-mode={layout === 'compact' ? compactMode : undefined}
      data-rc06-buffer-state={outcome.reason}
      data-rc06-lift-mode={liftMode}
      data-rc06-plan={model.planLoaded ? 'loaded' : 'none'}
      data-rc06-fuel-model={model.fuelModelValid ? 'valid' : 'invalid'}
      data-rc06-balance-tone={model.balance.tone}
      data-rc06-alerts={alertLines.length > 0 ? 'active' : 'silent'}
      data-rc06-alert-keys={alertLines.join(',')}
      data-rc06-ledger={model.trendMeasured ? 'measured' : 'pending'}
      data-rc06-content-width={Math.round(box.width)}
      data-rc06-content-height={Math.round(box.height)}
      style={responsiveStyle}
    >
      <main
        className="rc06-dashboard"
        aria-label="RaceCon RC-06 fuel save mode and lift-and-coast strategy ledger"
        data-rc06-native-size={layout === 'native' ? '800x480' : undefined}
      >
        {/*
          Packet section 10 tertiary channels. Packet 11.1 and 12.1 allocate them no zone, so
          they live in the band above the ledger that the packet leaves unallocated and carry
          their truth-table dash states rather than being dropped. The amber fuel-model note
          rides here too, so it has a visible surface at every breakpoint.
        */}
        <section
          className="rc06-peripheral"
          data-testid="rc06-peripheral"
          data-rc06-zone="peripheral"
          style={zoneStyle(zones.peripheral)}
          aria-label="Peripheral context"
        >
          <LedgerRow label="POS" value={model.position} description="Race position" zone="position" />
          <LedgerRow label="SPEED" value={model.speed} unit="KM/H" description="Speed" zone="speed" />
          <LedgerRow label="WATER" value={model.waterTemp} unit="C" description="Water temperature" zone="water" />
          {model.alerts.fuelModelInvalid ? (
            <p className="rc06-note" data-testid="rc06-fuel-model-note" role="alert">
              FUEL MODEL INVALID
            </p>
          ) : null}
        </section>

        {/*
          Packet 11.1 left column. Every value here is an engineer-set STRATEGY PLAN INPUT, not
          telemetry: packet section 16 declares no channel for a target burn, a plan lap count
          or a pit lap, so all three dash until a plan is loaded and none is inferred from the
          car. `plan laps` additionally needs the live lap counter.
        */}
        <section
          className="rc06-column rc06-target"
          data-testid="rc06-target"
          data-rc06-zone="target"
          data-rc06-source="plan"
          style={zoneStyle(zones.target)}
          aria-label="Target fuel plan ledger"
        >
          <header className="rc06-column-head">
            <h2 className="rc06-column-title" data-testid="rc06-column-title">
              TARGET
            </h2>
            <span className="rc06-column-rule" data-testid="rc06-column-rule" aria-hidden="true" />
          </header>
          <LedgerRow
            label="L/LAP"
            value={model.targetBurn}
            description="Target fuel per lap"
            zone="target-burn"
            size="hero"
          />
          <LedgerRow
            label="LAPS"
            value={model.planLaps}
            description="Plan laps to the pit lap"
            zone="plan-laps"
            size="hero"
          />
          <LedgerRow label="PIT LAP" value={model.pitLap} description="Planned pit lap" zone="pit-lap" />
          {/*
            Packet 12.1: the wider app column gains the projected pit ladder. The projected dry
            lap is bound to the measured laps-remaining model and the live lap counter, so it
            dashes rather than assuming a nominal stint.
          */}
          <div className="rc06-ladder" data-testid="rc06-ladder" aria-label="Projected pit ladder">
            <LedgerRow label="DRY LAP" value={model.projectedDryLap} description="Projected dry lap" zone="dry-lap" />
          </div>
        </section>

        {/*
          Packet 11.1 hero: the signed running balance. Packet 19 requires sign, arrow and
          colour to agree, so the numeral always carries its own '+' or '-' and the arrow is a
          filled triangle, not a hue.
        */}
        <section
          className="rc06-balance"
          data-testid="rc06-balance"
          data-rc06-zone="balance"
          data-rc06-sign={model.balance.sign}
          data-rc06-arrow={model.balance.arrow}
          data-rc06-tone={model.balance.tone}
          style={zoneStyle(zones.balance)}
          aria-label="Fuel balance to plan"
        >
          <span className="rc06-label rc06-balance-label">BALANCE</span>
          <div className="rc06-balance-line">
            {model.balance.arrow !== 'none' ? (
              <svg
                className="rc06-balance-arrow"
                data-testid="rc06-balance-arrow"
                data-rc06-arrow={model.balance.arrow}
                viewBox="0 0 20 20"
                aria-hidden="true"
                focusable="false"
              >
                <polygon points={model.balance.arrow === 'up' ? '10,3 19,17 1,17' : '1,3 19,3 10,17'} />
              </svg>
            ) : null}
            <output
              className={`rc06-balance-value${model.balance.field.stale ? ' is-stale' : ''}${
                model.balance.field.unavailable ? ' is-unavailable' : ''
              }`}
              data-testid="rc06-balance-value"
              aria-label={rc06BalanceDescription(model.balance)}
            >
              {model.balance.field.value}
            </output>
          </div>
          <span className="rc06-unit rc06-balance-unit" aria-hidden="true">
            LAPS
          </span>
          {/* Packet section 15: the red 'SAVE MORE' line exists only while the alert is latched. */}
          {model.alerts.behindPlan ? (
            <p className="rc06-save-more" data-testid="rc06-save-more" role="alert">
              SAVE MORE
            </p>
          ) : null}
        </section>

        {/*
          Packet 11.1 delta mini: the time cost of saving. Packet 12.1 gives it no app zone of
          its own, so at 1024x600 its rect is nested strictly inside the enlarged balance hero.
        */}
        <section
          className="rc06-delta"
          data-testid="rc06-delta"
          data-rc06-zone="delta"
          data-rc06-folded={layout === 'app' ? 'balance' : undefined}
          style={zoneStyle(zones.delta)}
          aria-label="Time cost of saving"
        >
          <LedgerRow label="DELTA" value={model.delta} unit="S" description="Delta to best lap" zone="delta" />
          <LedgerRow label="BEST" value={model.bestLap} description="Best lap time" zone="best" />
        </section>

        {/* Packet 11.1 right column: the measured side of the ledger. */}
        <section
          className="rc06-column rc06-actual"
          data-testid="rc06-actual"
          data-rc06-zone="actual"
          data-rc06-source="telemetry"
          style={zoneStyle(zones.actual)}
          aria-label="Actual fuel ledger"
        >
          <header className="rc06-column-head">
            <h2 className="rc06-column-title" data-testid="rc06-column-title">
              ACTUAL
            </h2>
            <span className="rc06-column-rule" data-testid="rc06-column-rule" aria-hidden="true" />
          </header>
          <LedgerRow
            label="L/LAP"
            value={model.actualBurn}
            description="Measured fuel per lap"
            zone="actual-burn"
            size="hero"
          />
          <LedgerRow
            label="LAPS"
            value={model.lapsRemaining}
            description="Fuel laps remaining"
            zone="laps-remaining"
            size="hero"
          />
          <LedgerRow label="FUEL" value={model.fuelLevel} unit="L" description="Fuel level" zone="fuel-level" />
        </section>

        {/*
          Packet 12.1 ledger-trend-reveal: this per-lap burn trend exists ONLY in the 1024x600
          app view. Its content is measured from observed lap boundaries, never synthesised — a
          stint with no observed boundary stays dashed rather than drawing a plausible curve.
        */}
        {zones.trend ? (
          <section
            className="rc06-trend"
            data-testid="rc06-trend"
            data-rc06-zone="trend"
            data-rc06-measured={model.trendMeasured ? 'true' : 'false'}
            style={zoneStyle(zones.trend)}
            aria-label="Per-lap fuel burn trend against the target"
          >
            <span className="rc06-label rc06-trend-title">BURN / LAP</span>
            <div className="rc06-trend-rows">
              {model.trendMeasured ? (
                model.trend.map((sample) => (
                  <span
                    key={sample.lap}
                    className={`rc06-trend-point${sample.burn === null ? ' is-unavailable' : ''}`}
                    data-testid="rc06-trend-point"
                    data-rc06-lap={sample.lap}
                  >
                    {sample.burn === null ? '--' : sample.burn.toFixed(2)}
                  </span>
                ))
              ) : (
                <span className="rc06-trend-point is-unavailable" data-testid="rc06-trend-point">
                  --
                </span>
              )}
            </div>
            <span className="rc06-trend-target" data-testid="rc06-trend-target">
              <span className="rc06-label">TARGET</span>
              <output
                className={`rc06-value${model.targetBurn.unavailable ? ' is-unavailable' : ''}`}
                aria-label={rc01FieldDescription('Target fuel per lap', model.targetBurn)}
              >
                {model.targetBurn.value}
              </output>
            </span>
          </section>
        ) : null}

        {/*
          Packet 11.1 lift-and-coast cue bar. image-qa-v1 residual 1 is normative: the plan
          datum is placed at exactly 50 % of the track and the marker is computed
          arithmetically, never traced from the reference (which drew the datum at unit 40).

          Packet 11.4's slim rev cue / short-shift marker is deliberately absent: packet section
          16 declares no RPM channel, so it would have no source, unit or staleness rule.
        */}
        <section
          className="rc06-lift"
          data-testid="rc06-lift"
          data-rc06-zone="lift"
          data-rc06-coach={model.lift.coach ?? 'none'}
          style={zoneStyle(zones.lift)}
          aria-label="Lift and coast coaching bar"
        >
          <LedgerRow label="GEAR" value={model.gear} description="Gear" zone="gear" />
          <div className="rc06-lift-cue">
            <span className="rc06-label">LIFT</span>
            <span className="rc06-label rc06-lift-mode" data-testid="rc06-lift-mode">
              {model.lift.modeLabel}
            </span>
            <output
              className={`rc06-value rc06-lift-value${model.lift.value.stale ? ' is-stale' : ''}${
                model.lift.value.unavailable ? ' is-unavailable' : ''
              }`}
              data-testid="rc06-lift-value"
              data-tone={model.lift.value.tone}
              aria-label={rc01FieldDescription(
                model.lift.mode === 'liters' ? 'Litres to plan' : 'Distance to plan',
                model.lift.value
              )}
            >
              {model.lift.value.value}
            </output>
            <span className="rc06-unit" aria-hidden="true">
              {model.lift.unit}
            </span>
          </div>
          <div
            className="rc06-lift-track"
            data-testid="rc06-lift-track"
            role="img"
            aria-label={
              markerFraction === null
                ? 'Lift and coast track, saving unavailable'
                : `Lift and coast track, plan datum at the centre, saving marker at ${Math.round(
                    markerFraction * 100
                  )} percent`
            }
          >
            <span
              className="rc06-lift-datum"
              data-testid="rc06-lift-datum"
              style={{ left: rc06TrackPercent(model.lift.planFraction) }}
            />
            {markerFraction !== null ? (
              <span
                className="rc06-lift-marker"
                data-testid="rc06-lift-marker"
                data-rc06-side={markerFraction >= model.lift.planFraction ? 'ahead' : 'behind'}
                style={{ left: rc06TrackPercent(markerFraction) }}
              />
            ) : null}
          </div>
          {/*
            Packet 11.5's distance-to-plan lift point. Packet section 16 defines NO lap-distance
            channel, so this field is permanently the two-character placeholder: no distance, no
            unit and no plausible fake number is ever drawn.
          */}
          <LedgerRow label="LIFT PT" value={model.lift.point} description="Lift point distance to plan" zone="lift-point" />
          {/* Packet section 15: the cyan 'PUSH OK' hint exists only while over-saving is latched. */}
          {model.alerts.overSaving ? (
            <p className="rc06-push-ok" data-testid="rc06-push-ok" role="status">
              PUSH OK
            </p>
          ) : null}
          <button
            type="button"
            className="rc06-soft-key"
            data-testid="rc06-soft-key"
            onClick={toggleLiftMode}
            aria-label={
              liftMode === 'liters'
                ? 'Switch the lift cue to distance to plan'
                : 'Switch the lift cue to litres to plan'
            }
          >
            {liftMode === 'liters' ? 'L' : 'M'}
          </button>
        </section>
      </main>
    </div>
  )
}
