import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { WidgetProps } from './types'
import { raceconDisplayClockFrozen, useRaceconDisplayClock } from './raceconDisplayClock'
import { Rc01LiveTelemetryBuffer, type Rc01MonotonicClock, rc01FieldDescription, rc01MonotonicNow } from './raceconRc01Core'
import {
  RC03_BRIGHTNESS_SCALE,
  RC03_DISPLAY_SWITCH_EVENT,
  RC03_DEFAULT_BRIGHTNESS_PROFILE,
  RC03_PIT_WINDOW_LAPS,
  type Rc03BrightnessProfile,
  type Rc03DashboardModel,
  type Rc03Vital,
  type Rc03VitalsPage,
  Rc03AuxBuffer,
  Rc03StintFuelTracker,
  acknowledgeRc03Alarms,
  advanceRc03Alerts,
  clearInvalidRc03Alerts,
  createRc03AlertState,
  createRc03DashboardModel,
  rc03AlarmLines,
  rc03AlertInputForModel,
  rc03BrightnessFromDisplaySwitch,
  rc03CompactModeForContentBox,
  rc03FuelBarDescription,
  rc03LayoutForContentBox,
  rc03NextVitalsPage,
  rc03PhoneGeometryForContentBox,
  rc03RibbonDescription
} from './raceconRc03Core'
import './raceconRc03.css'

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

function Vital({ vital }: { vital: Rc03Vital }): ReactElement {
  return (
    <div className="rc03-vital" data-testid="rc03-vital" data-channel={vital.channel} data-alert={vital.alert ? 'true' : 'false'}>
      <dt className="rc03-label">{vital.label}</dt>
      <dd className="rc03-vital-value">
        <output
          className={`rc03-value rc03-tone-${vital.tone}${vital.stale ? ' is-stale' : ''}${vital.unavailable ? ' is-unavailable' : ''}`}
          aria-label={rc01FieldDescription(vital.label, vital)}
        >
          {vital.value}
        </output>
        <span className="rc03-unit" aria-hidden="true">
          {vital.unit}
        </span>
      </dd>
    </div>
  )
}

function RailRow({ label, value, unit }: { label: string; value: Rc03DashboardModel['averagePace']; unit?: string }): ReactElement {
  return (
    <div className="rc03-rail-row" data-testid="rc03-rail-row">
      <span className="rc03-label">{label}</span>
      <output
        className={`rc03-value${value.stale ? ' is-stale' : ''}${value.unavailable ? ' is-unavailable' : ''}`}
        aria-label={rc01FieldDescription(label, value)}
      >
        {value.value}
      </output>
      {unit ? (
        <span className="rc03-unit" aria-hidden="true">
          {unit}
        </span>
      ) : null}
    </div>
  )
}

/**
 * RC-03 is an overlay-widget-owned, live-only endurance night-stint dashboard. It shares
 * RC-01's fail-closed ingest buffer, so mock and replay telemetry are refused and a source or
 * session discontinuity clears the stint marker and the whole measured fuel model.
 */
export interface RaceconRc03DashWidgetProps extends WidgetProps {
  monotonicClock?: Rc01MonotonicClock
  /** Laps of fuel at which the pit window opens; the packet leaves this configurable. */
  pitWindowLaps?: number
}

export function RaceconRc03DashWidget({
  snapshot,
  config,
  preview,
  monotonicClock = rc01MonotonicNow,
  pitWindowLaps = RC03_PIT_WINDOW_LAPS
}: RaceconRc03DashWidgetProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const bufferRef = useRef(new Rc01LiveTelemetryBuffer())
  const auxRef = useRef(new Rc03AuxBuffer())
  const trackerRef = useRef(new Rc03StintFuelTracker())
  const alertsRef = useRef(createRc03AlertState())
  const appliedAckRef = useRef(0)
  const nowMs = useRaceconDisplayClock(monotonicClock, raceconDisplayClockFrozen(preview))
  const [vitalsPage, setVitalsPage] = useState<Rc03VitalsPage>('temps')
  const [brightness, setBrightness] = useState<Rc03BrightnessProfile>(RC03_DEFAULT_BRIGHTNESS_PROFILE)
  const [acknowledgeSeq, setAcknowledgeSeq] = useState(0)
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
  if (outcome.accepted) {
    const accepted = candidate.latestSnapshot()
    aux.ingest(accepted, arrivalMs)
    tracker.ingest({
      lapDistPct: typeof accepted?.lapDistPct === 'number' ? accepted.lapDistPct : null,
      currentLapTimeSec: typeof accepted?.currentLapTimeSec === 'number' ? accepted.currentLapTimeSec : null,
      fuelLiters: typeof accepted?.fuelLiters === 'number' ? accepted.fuelLiters : null,
      onPitRoad: typeof accepted?.onPitRoad === 'boolean' ? accepted.onPitRoad : null,
      refuelServiceActive: typeof accepted?.refuelServiceActive === 'boolean' ? accepted.refuelServiceActive : null,
      receivedAt: arrivalMs
    })
  } else if (!outcome.renderable) {
    // Fail closed: anything the buffer refuses also invalidates the stint marker and the model.
    aux.reset()
    tracker.reset()
  }

  const renderSnapshot = outcome.renderable ? candidate.latestSnapshot() : null
  const stintFuel = tracker.reading(nowMs)
  const sharedAlerts = candidate.alertState()

  // Two passes: the first builds the model the alert layer reads, the second re-renders it
  // with whatever the alert layer actually latched, so a gauge can never brighten for an
  // alert that was cleared in the same frame.
  const provisional = createRc03DashboardModel(renderSnapshot, candidate.receipts(), aux.receipts(), nowMs, {
    stintFuel,
    vitalsPage,
    alerts: alertsRef.current,
    overRevActive: sharedAlerts.overRev.active,
    pitWindowLaps
  })
  const advanced = advanceRc03Alerts(alertsRef.current, rc03AlertInputForModel(provisional, stintFuel, nowMs, pitWindowLaps))
  // The acknowledgement is applied exactly once per press and then lives in the committed
  // alert state, so a NEW engage after a reset re-arms the alarm line instead of staying silent.
  const acknowledged = acknowledgeSeq !== appliedAckRef.current ? acknowledgeRc03Alarms(advanced) : advanced
  const alerts = clearInvalidRc03Alerts(acknowledged, provisional)
  const model = createRc03DashboardModel(renderSnapshot, candidate.receipts(), aux.receipts(), nowMs, {
    stintFuel,
    vitalsPage,
    alerts,
    overRevActive: sharedAlerts.overRev.active,
    pitWindowLaps
  })

  const layout = rc03LayoutForContentBox(box.width, box.height)
  const compactMode = rc03CompactModeForContentBox(box.width, box.height)
  const phoneGeometry = rc03PhoneGeometryForContentBox(box.width, box.height)
  const alarmLines = rc03AlarmLines(alerts)

  const responsiveStyle = {
    '--rc03-brightness': String(RC03_BRIGHTNESS_SCALE[brightness]),
    ...(phoneGeometry
      ? {
          '--rc03-phone-inset': `${phoneGeometry.inset}px`,
          '--rc03-phone-ribbon-top': `${phoneGeometry.ribbonTop}px`,
          '--rc03-phone-ribbon-height': `${phoneGeometry.ribbonHeight}px`,
          '--rc03-phone-pace-top': `${phoneGeometry.paceTop}px`,
          '--rc03-phone-pace-height': `${phoneGeometry.paceHeight}px`,
          '--rc03-phone-vitals-top': `${phoneGeometry.vitalsTop}px`,
          '--rc03-phone-vitals-height': `${phoneGeometry.vitalsHeight}px`,
          '--rc03-phone-fuel-top': `${phoneGeometry.fuelTop}px`,
          '--rc03-phone-fuel-height': `${phoneGeometry.fuelHeight}px`
        }
      : {})
  } as CSSProperties

  useLayoutEffect(() => {
    bufferRef.current = candidate
    auxRef.current = aux
    trackerRef.current = tracker
    alertsRef.current = alerts
    appliedAckRef.current = acknowledgeSeq
  }, [candidate, aux, tracker, alerts, acknowledgeSeq])

  // Packet 11.5 / 20: auto-brightness is a display-switch EVENT with a night profile default,
  // never an ambient reading the dashboard invents for itself.
  useEffect(() => {
    const handler = (event: Event): void => {
      setBrightness(rc03BrightnessFromDisplaySwitch((event as CustomEvent).detail))
    }
    window.addEventListener(RC03_DISPLAY_SWITCH_EVENT, handler)
    return () => window.removeEventListener(RC03_DISPLAY_SWITCH_EVENT, handler)
  }, [])

  const cycleVitals = useCallback(() => setVitalsPage((page) => rc03NextVitalsPage(page)), [])
  const resetAlarms = useCallback(() => setAcknowledgeSeq((value) => value + 1), [])

  const fuelFillPercent = model.fuelBar.unavailable ? 0 : model.fuelBar.fill * 100

  return (
    <div
      ref={rootRef}
      className="rc03-widget"
      data-widget="raceconRc03Dash"
      data-rc03-layout={layout}
      data-rc03-compact-mode={layout === 'compact' ? compactMode : undefined}
      data-rc03-buffer-state={outcome.reason}
      data-rc03-brightness={brightness}
      data-rc03-vitals-page={vitalsPage}
      data-rc03-fuel-window={alerts.fuelWindow.active ? 'true' : 'false'}
      data-rc03-oil-alarm={alerts.oilPressure.active ? 'true' : 'false'}
      data-rc03-overheat={alerts.overheat.active ? 'true' : 'false'}
      data-rc03-content-width={Math.round(box.width)}
      data-rc03-content-height={Math.round(box.height)}
      style={responsiveStyle}
    >
      <main
        className="rc03-dashboard"
        aria-label="RaceCon RC-03 endurance night stint dashboard"
        data-rc03-native-size={layout === 'native' ? '800x480' : undefined}
      >
        {/* One continuous ribbon, not discrete LEDs: no text, no ticks, no index marks. */}
        <section
          className="rc03-ribbon"
          data-testid="rc03-ribbon"
          data-tone={model.ribbon.tone}
          data-unavailable={model.ribbon.unavailable ? 'true' : 'false'}
          role="img"
          aria-label={rc03RibbonDescription(model.ribbon)}
        >
          <span
            className="rc03-ribbon-fill"
            data-testid="rc03-ribbon-fill"
            style={{ width: `${model.ribbon.fill * 100}%` }}
            aria-hidden="true"
          />
        </section>

        <section className="rc03-band rc03-pace" data-testid="rc03-pace" data-rc03-band="pace" aria-label="Pace band">
          <div className="rc03-cell rc03-cell-gear" data-rc03-zone="gear">
            <span className="rc03-label">GEAR</span>
            <output
              className={`rc03-value rc03-gear${model.gear.stale ? ' is-stale' : ''}${model.gear.unavailable ? ' is-unavailable' : ''}`}
              aria-label={rc01FieldDescription('Gear', model.gear)}
            >
              {model.gear.value}
            </output>
          </div>
          <div className="rc03-cell rc03-cell-delta" data-rc03-zone="delta">
            <span className="rc03-label">DELTA</span>
            <div className="rc03-value-row">
              <output
                className={`rc03-value rc03-delta${model.delta.stale ? ' is-stale' : ''}${model.delta.unavailable ? ' is-unavailable' : ''}`}
                aria-label={rc01FieldDescription('Delta to best lap', model.delta)}
              >
                {model.delta.value}
              </output>
              <span className="rc03-unit" aria-hidden="true">
                S
              </span>
            </div>
          </div>
          <div className="rc03-cell rc03-cell-speed" data-rc03-zone="speed">
            <span className="rc03-label">SPEED</span>
            <div className="rc03-value-row">
              <output
                className={`rc03-value rc03-speed${model.speed.stale ? ' is-stale' : ''}${model.speed.unavailable ? ' is-unavailable' : ''}`}
                aria-label={rc01FieldDescription('Speed', model.speed)}
              >
                {model.speed.value}
              </output>
              <span className="rc03-unit" aria-hidden="true">
                KM/H
              </span>
            </div>
          </div>
        </section>

        {/* Packet 11.1 places the stint clock in the pace-band corner as its own zone. */}
        <section className="rc03-stint-clock" data-testid="rc03-stint-clock" aria-label="Elapsed stint time">
          <span className="rc03-label">STINT</span>
          <output
            className={`rc03-value rc03-clock${model.stintClock.unavailable ? ' is-unavailable' : ''}`}
            aria-label={rc01FieldDescription('Stint timer', model.stintClock)}
          >
            {model.stintClock.value}
          </output>
        </section>

        <section
          className="rc03-band rc03-vitals"
          data-testid="rc03-vitals"
          data-rc03-band="vitals"
          data-rc03-alarm={alerts.oilPressure.active ? 'oil-pressure' : alerts.overheat.active ? 'overheat' : 'none'}
          aria-label="Engine vitals band"
        >
          <dl className="rc03-vitals-grid">
            {model.vitals.map((vital) => (
              <Vital key={vital.channel} vital={vital} />
            ))}
          </dl>
          {alarmLines.length > 0 && (
            <p className="rc03-alarm-line" data-testid="rc03-alarm-line" role="alert">
              <span>{alarmLines.join(' \u00B7 ')}</span>
              <button type="button" className="rc03-alarm-reset" data-testid="rc03-alarm-reset" onClick={resetAlarms}>
                RESET
              </button>
            </p>
          )}
          {/* Packet 11.5: a soft-key cycles the vitals band between temperatures and pressures. */}
          <button
            type="button"
            className="rc03-soft-key"
            data-testid="rc03-soft-key"
            onClick={cycleVitals}
            aria-label={`Vitals page: ${vitalsPage}. Activate to cycle temperatures and pressures.`}
          >
            {vitalsPage === 'temps' ? 'TEMPS' : 'PRESS'}
          </button>
        </section>

        <section
          className="rc03-band rc03-fuel"
          data-testid="rc03-fuel"
          data-rc03-band="fuel"
          data-rc03-window={alerts.fuelWindow.active ? 'open' : 'closed'}
          aria-label="Fuel and stint band"
        >
          <div className="rc03-cell rc03-cell-fuel-laps" data-rc03-zone="fuel-laps">
            <span className="rc03-label">FUEL LAPS</span>
            <output
              className={`rc03-value rc03-fuel-laps${model.fuelLaps.unavailable ? ' is-unavailable' : ''}`}
              aria-label={rc01FieldDescription('Fuel laps remaining', model.fuelLaps)}
            >
              {model.fuelLaps.value}
            </output>
          </div>

          <div className="rc03-fuel-bar-cell" data-rc03-zone="fuel-bar">
            <div
              className="rc03-fuel-bar"
              data-testid="rc03-fuel-bar"
              data-unavailable={model.fuelBar.unavailable ? 'true' : 'false'}
              role="img"
              aria-label={rc03FuelBarDescription(model.fuelBar, model.fuelLevel)}
            >
              <span
                className="rc03-fuel-bar-fill"
                data-testid="rc03-fuel-bar-fill"
                style={{ width: `${fuelFillPercent}%` }}
                aria-hidden="true"
              />
            </div>
            <div className="rc03-value-row">
              <output
                className={`rc03-value rc03-fuel-level${model.fuelLevel.stale ? ' is-stale' : ''}${model.fuelLevel.unavailable ? ' is-unavailable' : ''}`}
                aria-label={rc01FieldDescription('Fuel level', model.fuelLevel)}
              >
                {model.fuelLevel.value}
              </output>
              <span className="rc03-unit" aria-hidden="true">
                L
              </span>
            </div>
            {alerts.fuelWindow.active && (
              <span className="rc03-pit-window" data-testid="rc03-pit-window">
                PIT WINDOW
              </span>
            )}
          </div>

          <div className="rc03-cell rc03-cell-stint-lap" data-rc03-zone="stint-lap">
            <span className="rc03-label">STINT LAP</span>
            <output
              className={`rc03-value rc03-stint-lap${model.stintLap.unavailable ? ' is-unavailable' : ''}`}
              aria-label={rc01FieldDescription('Stint lap', model.stintLap)}
            >
              {model.stintLap.value}
            </output>
          </div>

          {/* Packet 12.1: the fuel-per-lap trend exists only in the 1024x600 reflow. */}
          <div className="rc03-fuel-trend" data-testid="rc03-fuel-trend" data-rc03-zone="fuel-trend">
            <span className="rc03-label">FUEL / LAP</span>
            <div className="rc03-value-row">
              <output
                className={`rc03-value${model.fuelPerLap.unavailable ? ' is-unavailable' : ''}`}
                aria-label={rc01FieldDescription('Fuel per lap', model.fuelPerLap)}
              >
                {model.fuelPerLap.value}
              </output>
              <span className="rc03-unit" aria-hidden="true">
                L
              </span>
            </div>
            <div className="rc03-trend-bars" aria-hidden="true">
              {model.fuelTrend.map((burn, index) => (
                <span
                  key={index}
                  className="rc03-trend-bar"
                  data-testid="rc03-trend-bar"
                  style={{ height: `${Math.min(100, (burn / Math.max(...model.fuelTrend)) * 100)}%` }}
                />
              ))}
            </div>
          </div>
        </section>

        {/* Packet 12.1: the stint-strategy rail is app-only and has no 800x480 equivalent. */}
        <aside className="rc03-rail" data-testid="rc03-rail" aria-label="Stint strategy rail">
          <RailRow label="FUEL WINDOW" value={model.pitWindowLaps} unit="LAPS" />
          <RailRow label="PIT LAP" value={model.projectedPitLap} />
          <RailRow label="AVG PACE" value={model.averagePace} />
        </aside>

        {alerts.fuelWindow.active && (
          <div className="rc03-sr-alert" role="status">
            Fuel window open, pit window reached
          </div>
        )}
        {alerts.oilPressure.active && (
          <div className="rc03-sr-alert" role="status">
            Low oil pressure alarm
          </div>
        )}
        {alerts.overheat.active && (
          <div className="rc03-sr-alert" role="status">
            Coolant overheat alarm
          </div>
        )}
      </main>
    </div>
  )
}
