import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
  RC19_CONFIRM_EVENT,
  RC19_DASH,
  RC19_TYPE_SCALE_PX,
  RC19_WIDGET_ID,
  Rc19ChannelBuffer,
  Rc19ChecklistBoard,
  type Rc19ChecklistRow,
  type Rc19DashboardModel,
  type Rc19Field,
  type Rc19Rect,
  Rc19StintTracker,
  advanceRc19Alerts,
  clearInvalidRc19Alerts,
  createRc19AlertState,
  createRc19DashboardModel,
  rc19AlertInputForModel,
  rc19AlertLines,
  rc19ChecklistDescription,
  rc19CompactModeForContentBox,
  rc19CrewCommandFromEvent,
  rc19LayoutForContentBox,
  rc19NestedRect,
  rc19PhoneGeometryForContentBox,
  rc19ReadinessDescription,
  rc19TypeScaleCqw,
  rc19ZoneStyle,
  rc19ZonesForLayout
} from './raceconRc19Core'
import './raceconRc19.css'

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

function zoneStyle(rect: Rc19Rect | undefined): CSSProperties | undefined {
  const style = rc19ZoneStyle(rect)
  return style ? (style as CSSProperties) : undefined
}

/**
 * Normative override OV-10: the car-state column is laid out as INLINE label+value pairs, not
 * as a stack of label-above-value rows, because stacking every packet 11.1 car-state field at
 * the packet 11.2 scale needs 404 px in a 374 px column.
 */
function Row({
  label,
  unit,
  value,
  description,
  zone
}: {
  label: string
  unit?: string
  value: Rc19Field
  description?: string
  zone: string
}): ReactElement {
  return (
    <div className="rc19-row" data-testid="rc19-row" data-rc19-row={zone}>
      <span className="rc19-label">
        {label}
        {unit ? <span className="rc19-unit">{unit}</span> : null}
      </span>
      <output
        className={`rc19-value${value.stale ? ' is-stale' : ''}${value.unavailable ? ' is-unavailable' : ''}`}
        data-testid={`rc19-${zone}`}
        data-tone={value.tone}
        aria-label={rc01FieldDescription(description ?? label, value)}
      >
        {value.value}
      </output>
    </div>
  )
}

/** One cell of a 2x2 grid: label above value, so a narrow column never wraps the pair. */
function Cell({
  label,
  value,
  description,
  zone
}: {
  label: string
  value: Rc19Field
  description?: string
  zone: string
}): ReactElement {
  return (
    <div className="rc19-cell" data-testid="rc19-cell" data-rc19-cell={zone}>
      <span className="rc19-label">{label}</span>
      <output
        className={`rc19-value${value.stale ? ' is-stale' : ''}${value.unavailable ? ' is-unavailable' : ''}`}
        data-testid={`rc19-${zone}`}
        data-tone={value.tone}
        aria-label={rc01FieldDescription(description ?? label, value)}
      >
        {value.value}
      </output>
    </div>
  )
}

/**
 * One checklist row. Packet 19: state is a glyph AND a word AND a hue, never colour alone,
 * because packet 11.3's `info` and `normal` tokens have a luminance gap of exactly zero.
 * Packet 14 reserves highlight for unconfirmed CRITICAL items, so a pending non-critical item
 * is `secondary` grey and never amber.
 */
function CheckRow({ row }: { row: Rc19ChecklistRow }): ReactElement {
  return (
    <div
      className={`rc19-check-row${row.blocking ? ' is-blocking' : ''}`}
      data-testid="rc19-check-row"
      data-rc19-item={row.id}
      data-rc19-state={row.state}
      data-rc19-critical={row.critical ? 'true' : 'false'}
      data-rc19-blocking={row.blocking ? 'true' : 'false'}
      aria-label={rc19ChecklistDescription(row)}
    >
      <span className="rc19-check-glyph" data-testid={`rc19-glyph-${row.id}`} aria-hidden="true">
        {row.glyph}
      </span>
      <span className="rc19-check-item">{row.label}</span>
      <output className="rc19-check-state" data-testid={`rc19-state-${row.id}`}>
        {row.state}
      </output>
    </div>
  )
}

/**
 * RC-19 is an overlay-widget-owned, live-only handover display. It shares RC-01's fail-closed
 * ingest buffer, so mock and replay telemetry are refused and a source or session discontinuity
 * resets the crew checklist board, the measured stint boundary and every latched alert — a new
 * car never inherits the previous crew's confirmations.
 */
export interface RaceconRc19DashWidgetProps extends WidgetProps {
  monotonicClock?: Rc01MonotonicClock
}

export function RaceconRc19DashWidget({
  snapshot,
  config,
  preview,
  monotonicClock = rc01MonotonicNow
}: RaceconRc19DashWidgetProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const bufferRef = useRef(new Rc01LiveTelemetryBuffer())
  const channelsRef = useRef(new Rc19ChannelBuffer())
  const stintRef = useRef(new Rc19StintTracker())
  const alertsRef = useRef(createRc19AlertState())
  const nowMs = useRaceconDisplayClock(monotonicClock, raceconDisplayClockFrozen(preview))
  const [board, setBoard] = useState(() => new Rc19ChecklistBoard())
  const box = useContentBox(rootRef, config)

  // A receipt timestamp, not a display clock: it advances only when a new snapshot object or
  // provider timestamp arrives, so a freshness tick cannot make a stale frame look fresh.
  const arrivalMs = useMemo(() => monotonicClock(), [monotonicClock, snapshot, snapshot?.timestamp])

  // Rendering mutates isolated candidates only; they are committed in the layout phase so
  // StrictMode double-renders and abandoned concurrent renders cannot advance real state.
  const candidate = bufferRef.current.clone()
  const outcome = candidate.ingest(snapshot, arrivalMs)
  const channels = channelsRef.current.clone()
  const stint = stintRef.current.clone()
  if (outcome.accepted) {
    channels.ingest(candidate.latestSnapshot(), arrivalMs)
    stint.observe(candidate.latestSnapshot())
  } else if (!outcome.renderable) {
    // Fail closed: anything the buffer refuses also invalidates the channel receipts and the
    // measured stint boundary, so a refused source cannot leave a number on screen.
    channels.reset()
    stint.reset()
  }

  const renderSnapshot = outcome.renderable ? candidate.latestSnapshot() : null
  // GAP-1: the crew board is not telemetry, but it is bound to the telemetry SOURCE. A refused
  // frame renders an empty board, so a confirmation never survives a source the buffer rejects.
  const activeBoard = outcome.renderable ? board : new Rc19ChecklistBoard()

  // Two passes: the first builds the model the alert layer reads, the second re-renders it with
  // whatever the alert layer actually latched, so no surface can escalate for an alert that was
  // cleared in the same frame.
  const provisional = createRc19DashboardModel(renderSnapshot, channels.receipts(), nowMs, {
    board: activeBoard,
    alerts: alertsRef.current,
    stint
  })
  const advanced = advanceRc19Alerts(alertsRef.current, rc19AlertInputForModel(provisional, nowMs, activeBoard))
  const alerts = clearInvalidRc19Alerts(advanced, provisional)
  const model: Rc19DashboardModel = createRc19DashboardModel(renderSnapshot, channels.receipts(), nowMs, {
    board: activeBoard,
    alerts,
    stint
  })

  const layout = rc19LayoutForContentBox(box.width, box.height)
  const compactMode = rc19CompactModeForContentBox(box.width, box.height)
  const zones = rc19ZonesForLayout(layout, compactMode)
  const phoneGeometry = rc19PhoneGeometryForContentBox(box.width, box.height)
  const alertLines = rc19AlertLines(model)
  const showApp = layout === 'app'
  const sourceIdentity = candidate.sourceIdentity()

  const responsiveStyle = {
    '--rc19-type-readiness': `${rc19TypeScaleCqw(RC19_TYPE_SCALE_PX.readiness)}cqw`,
    '--rc19-type-value': `${rc19TypeScaleCqw(RC19_TYPE_SCALE_PX.value)}cqw`,
    '--rc19-type-item': `${rc19TypeScaleCqw(RC19_TYPE_SCALE_PX.item)}cqw`,
    '--rc19-type-label': `${rc19TypeScaleCqw(RC19_TYPE_SCALE_PX.label)}cqw`,
    ...(phoneGeometry
      ? {
          '--rc19-phone-inset': `${phoneGeometry.inset}px`,
          '--rc19-phone-header-height': `${phoneGeometry.headerHeight}px`,
          '--rc19-phone-row-height': `${phoneGeometry.rowHeight}px`,
          '--rc19-phone-check-height': `${phoneGeometry.checkRowHeight}px`,
          '--rc19-phone-confirm-height': `${phoneGeometry.confirmHeight}px`
        }
      : {})
  } as CSSProperties

  useLayoutEffect(() => {
    bufferRef.current = candidate
    channelsRef.current = channels
    stintRef.current = stint
    alertsRef.current = alerts
  }, [candidate, channels, stint, alerts])

  // A new telemetry source is a new car: packet 20 forbids auto-confirming anything, so the
  // board is emptied rather than carried across the discontinuity.
  useEffect(() => {
    setBoard(new Rc19ChecklistBoard())
  }, [sourceIdentity])

  // Packet 11.5 and 20: items move pending -> confirmed ONLY via a crew macro input. An
  // unrecognised payload never changes the board, and nothing on this page auto-confirms.
  useEffect(() => {
    const handler = (event: Event): void => {
      const command = rc19CrewCommandFromEvent((event as CustomEvent).detail)
      if (command === null) return
      setBoard((current) => current.apply(command))
    }
    window.addEventListener(RC19_CONFIRM_EVENT, handler)
    return () => window.removeEventListener(RC19_CONFIRM_EVENT, handler)
  }, [])

  const confirmRect =
    zones.confirm && zones.checklist ? rc19NestedRect(zones.confirm, zones.checklist) : undefined
  const listRect =
    zones.checklistList && zones.checklist ? rc19NestedRect(zones.checklistList, zones.checklist) : undefined
  const bodyRect =
    zones.carStateBody && zones.carState ? rc19NestedRect(zones.carStateBody, zones.carState) : undefined
  const tertiaryRect =
    showApp && zones.tertiary && zones.carState ? rc19NestedRect(zones.tertiary, zones.carState) : undefined

  return (
    <div
      ref={rootRef}
      className="rc19-widget"
      data-widget={RC19_WIDGET_ID}
      data-rc19-layout={layout}
      data-rc19-compact-mode={layout === 'compact' ? compactMode : undefined}
      data-rc19-buffer-state={outcome.reason}
      data-rc19-ready={model.readiness.ready ? 'true' : 'false'}
      data-rc19-outstanding={model.readiness.outstandingCount}
      data-rc19-handover={model.handover.inBox === null ? 'unavailable' : model.handover.inBox ? 'in-box' : 'on-track'}
      data-rc19-alerts={alertLines.length > 0 ? 'active' : 'silent'}
      data-rc19-alert-keys={alertLines.join(',')}
      data-rc19-content-width={Math.round(box.width)}
      data-rc19-content-height={Math.round(box.height)}
      style={responsiveStyle}
    >
      <main
        className="rc19-dashboard"
        aria-label="RaceCon RC-19 hand over, endurance driver-swap handover"
        data-rc19-native-size={layout === 'native' ? '800x480' : undefined}
      >
        {/*
          Packet 11.1 readiness header. Packet 11.5 makes this a GATE, not an alert, so it is
          rendered in `primary` off-white and never in `caution` or `danger`. OV-12: the word
          and the count are one derived quantity, computed arithmetically from the item states.
          OV-9: uppercase only — a descender would not fit the 44 px band.
        */}
        <section
          className="rc19-header"
          data-testid="rc19-header"
          data-rc19-zone="header"
          style={zoneStyle(zones.header)}
          aria-label={rc19ReadinessDescription(model.readiness)}
        >
          <output className="rc19-readiness" data-testid="rc19-readiness" data-rc19-ready={model.readiness.ready ? 'true' : 'false'}>
            {model.readiness.word}
          </output>
          <output className="rc19-outstanding" data-testid="rc19-outstanding">
            {model.readiness.outstandingCount} OUTSTANDING
          </output>
        </section>

        {/* Packet 11.1 car-state column: what is being handed over to the incoming driver. */}
        <section
          className="rc19-column rc19-car-state"
          data-testid="rc19-car-state"
          data-rc19-zone="carState"
          style={zoneStyle(zones.carState)}
          aria-label="Car state at handover"
        >
          <div className="rc19-column-body" data-testid="rc19-car-state-body" style={zoneStyle(bodyRect)}>
            <h2 className="rc19-title">CAR STATE</h2>
            <Row label="FUEL LAPS" value={model.fuelLaps} description="Fuel laps remaining" zone="fuel-laps" />

            {/*
              Packet 11.1 tyre grid, packet 16 in bar. A corner without its own TPMS reading
              shows the grey dash and NEVER its neighbour's number: mirroring a corner is the
              single most tempting fabrication on this page and section 16 forbids it outright.
            */}
            <div className="rc19-grid" data-testid="rc19-tyre-grid" data-rc19-grid="tyres">
              <span className="rc19-grid-title">TIRE PRESS BAR</span>
              <div className="rc19-grid-cells">
                {model.tyres.map((corner) => (
                  <Cell
                    key={corner.corner}
                    label={corner.corner}
                    value={corner.field}
                    description={`${corner.corner} tyre pressure`}
                    zone={`tyre-${corner.corner}`}
                  />
                ))}
              </div>
            </div>

            {/*
              Packet 11.1 settings grid. Only TC has a section 16 channel (GAP-3): ABS, MAP and
              BIAS render the dash rather than a value section 16 never sanctioned. See
              RC19_PACKET_OMISSIONS.absStep / engineMapStep / brakeBiasStep.
            */}
            <div className="rc19-grid" data-testid="rc19-settings-grid" data-rc19-grid="settings">
              <div className="rc19-grid-cells">
                <Cell label="TC" value={model.tc} description="Traction control level" zone="tc" />
                <Cell label="ABS" value={model.abs} description="ABS level" zone="abs" />
                <Cell label="MAP" value={model.engineMap} description="Engine map" zone="map" />
                <Cell label="BIAS" value={model.brakeBias} description="Brake bias" zone="bias" />
              </div>
            </div>

            <Row label="STINT LAPS" value={model.stintLaps} description="Stint lap count" zone="stint-laps" />

            {/*
              Packet 15 carried-fault surface. A present channel reporting zero faults reads
              NONE ACTIVE; a display with no fault channel says so in words rather than drawing
              an unmonitored car as healthy. Nothing here is ever invented.
            */}
            <div
              className={`rc19-faults${model.alerts.carriedFault ? ' is-active' : ''}`}
              data-testid="rc19-faults"
              data-rc19-fault-source={model.faults.available ? 'live' : 'unavailable'}
              data-rc19-fault-active={model.alerts.carriedFault ? 'true' : 'false'}
            >
              <span className="rc19-label">FAULTS</span>
              <output
                className={`rc19-fault-value${model.faults.available ? '' : ' is-unavailable'}${model.faults.stale ? ' is-stale' : ''}`}
                data-testid="rc19-fault-value"
              >
                {model.faults.label}
              </output>
            </div>
          </div>

          {/*
            OV-6: packet 10's tertiary tier (water temperature, battery voltage) has no zone on
            either canvas. The app canvas has the room, so it carries them; the native canvas
            hides them rather than crowding the packet's own fields.
          */}
          {showApp ? (
            <div
              className="rc19-tertiary"
              data-testid="rc19-tertiary"
              data-rc19-zone="tertiary"
              style={zoneStyle(tertiaryRect)}
              aria-label="Tertiary channels"
            >
              <Row label="WATER" unit="C" value={model.waterTemp} description="Water temperature" zone="water-temp" />
              <Row label="BATTERY" unit="V" value={model.voltage} description="Battery voltage" zone="voltage" />
            </div>
          ) : null}
        </section>

        {/*
          Packet 11.1 swap-checklist column — the artifact's spine. Six rows, each a glyph AND a
          word AND a hue. Rows never auto-confirm: they are PENDING until a crew macro input
          says otherwise, which is the whole point of GAP-1.
        */}
        <section
          className="rc19-column rc19-checklist"
          data-testid="rc19-checklist"
          data-rc19-zone="checklist"
          style={zoneStyle(zones.checklist)}
          aria-label="Swap checklist"
        >
          <div className="rc19-check-list" data-testid="rc19-check-list" style={zoneStyle(listRect)}>
            <h2 className="rc19-title">SWAP CHECKLIST</h2>
            {model.checklist.map((row) => (
              <CheckRow key={row.id} row={row} />
            ))}
          </div>

          {/*
            OV-1 and OV-2: the confirm control is a CHILD of the checklist column on BOTH
            canvases — packet 12.1 gives it no app zone at all, and without one it would vanish
            at 1024x600. It is inert while anything is outstanding, so READY is always gated.
          */}
          <div
            className={`rc19-confirm${model.confirmEnabled ? ' is-enabled' : ''}${model.readiness.latched ? ' is-latched' : ''}`}
            data-testid="rc19-confirm"
            data-rc19-zone="confirm"
            data-rc19-confirm-state={model.readiness.latched ? 'latched' : model.confirmEnabled ? 'armed' : 'gated'}
            style={zoneStyle(confirmRect)}
            aria-label={`${model.confirmLabel}, ${model.readiness.latched ? 'latched' : model.confirmEnabled ? 'armed' : 'gated'}`}
          >
            <output className="rc19-confirm-label" data-testid="rc19-confirm-label">
              {model.confirmLabel}
            </output>
          </div>
        </section>

        {/*
          Packet 11.1 next-stint column. GAP-4: section 16 defines NO channel for target laps,
          the fuel plan, the tyre plan or the weather note, so four of the five rows are the
          honest dash. The fifth, the measured burn rate, is the only real number here and is
          the model packet 15's "fuel plan invalid" alert is evaluated against.
        */}
        <section
          className="rc19-column rc19-next-stint"
          data-testid="rc19-next-stint"
          data-rc19-zone="nextStint"
          style={zoneStyle(zones.nextStint)}
          aria-label="Next stint plan"
        >
          <h2 className="rc19-title">NEXT STINT</h2>
          <Row label="TARGET LAPS" value={model.targetLaps} description="Target laps" zone="target-laps" />
          <Row label="FUEL PER LAP" unit="L" value={model.fuelPerLap} description="Fuel per lap" zone="fuel-per-lap" />
          <Row label="FUEL PLAN" value={model.fuelPlan} description="Fuel plan" zone="fuel-plan" />
          {model.alerts.fuelPlanInvalid ? (
            <p className="rc19-note" data-testid="rc19-fuel-plan-note">
              NO MEASURED BURN MODEL
            </p>
          ) : null}
          <Row label="TIRE PLAN" value={model.tyrePlan} description="Tyre plan" zone="tire-plan" />
          <Row label="WEATHER" value={model.weatherNote} description="Weather note" zone="weather" />
        </section>

        {/*
          Packet 12.1's app-only stint-plan timeline. GAP-4 leaves it no channel at all, so the
          zone renders its structure and the honest empty state rather than a drawn strategy.
          See RC19_PACKET_OMISSIONS.stintPlanTimeline.
        */}
        {showApp ? (
          <section
            className="rc19-timeline"
            data-testid="rc19-timeline"
            data-rc19-zone="timeline"
            data-rc19-timeline-segments={model.timelineSegments.length}
            style={zoneStyle(zones.timeline)}
            aria-label="Stint plan timeline"
          >
            <h2 className="rc19-title">STINT PLAN</h2>
            <div className="rc19-timeline-track" data-testid="rc19-timeline-track" />
            <output className="rc19-timeline-empty is-unavailable" data-testid="rc19-timeline-empty">
              {model.timelineLabel}
            </output>
          </section>
        ) : null}

        {/*
          Packet 15's alert surface. It carries every engaged alert in WORDS, at every
          breakpoint, so no alert can be visible on one canvas and silent on another. In a
          silent frame it renders nothing at all — it is never a decoration.
        */}
        {alertLines.length > 0 ? (
          <output className="rc19-alerts" data-testid="rc19-alerts" role="status">
            {alertLines.join(' \u00b7 ')}
          </output>
        ) : null}

        <span className="rc19-sr" data-testid="rc19-sr-state">
          {`Handover ${model.readiness.word}. ${model.readiness.outstandingCount} outstanding. Faults ${model.faults.label}. Fuel laps ${model.fuelLaps.value === RC19_DASH ? 'unavailable' : model.fuelLaps.value}.`}
        </span>
      </main>
    </div>
  )
}
