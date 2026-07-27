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
  RC14_DASH,
  RC14_NO_FAULT_SOURCE_NOTICE,
  RC14_NO_ZONE_NOTICE,
  RC14_SILHOUETTE_PATH,
  RC14_TIMELINE_UNAVAILABLE_NOTICE,
  RC14_TYPE_SCALE_PX,
  RC14_UNMONITORED_NOTICE,
  Rc14AuxBuffer,
  type Rc14CornerState,
  type Rc14DashboardModel,
  type Rc14Decision,
  type Rc14FaultSourceId,
  type Rc14Rect,
  type Rc14SilhouetteZoneState,
  type Rc14SystemId,
  type Rc14SystemRow,
  type Rc14VitalState,
  acknowledgeRc14Fault,
  advanceRc14Alerts,
  clearInvalidRc14Alerts,
  createRc14AlertState,
  createRc14DashboardModel,
  rc14AlertInputForSnapshot,
  rc14CompactModeForContentBox,
  rc14DecisionDescription,
  rc14FormatFillPercent,
  rc14LayoutForContentBox,
  rc14SystemDescription,
  rc14TypeScaleCqw,
  rc14ZoneStyle,
  rc14ZonesForLayout
} from './raceconRc14Core'
import './raceconRc14.css'

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
    // size is the transformed bounding rect, not the content box. `scrollWidth` is never used:
    // `white-space: nowrap` makes a flex item's min-content width exceed its column, so
    // `overflow: hidden` never clips and `scrollWidth === clientWidth` while glyphs sit outside.
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

function zoneStyle(rect: Rc14Rect | undefined): CSSProperties | undefined {
  const style = rc14ZoneStyle(rect)
  return style ? (style as CSSProperties) : undefined
}

/**
 * One silhouette zone. Packet 19 and brief section 3: severity is chip WORD plus hue plus PATTERN,
 * never hue alone, and an UNMONITORED zone is outline-only in `secondary` rather than a filled OK
 * green — painting an uninspected corner green asserts health the app cannot know (gap G7).
 */
function SilhouetteZone({ zone }: { zone: Rc14SilhouetteZoneState }): ReactElement {
  return (
    <g
      className="rc14-zone"
      data-testid="rc14-zone"
      data-rc14-zone-id={zone.id}
      data-rc14-zone-monitored={zone.monitored ? 'true' : 'false'}
      data-rc14-zone-severity={zone.severity ?? 'unmonitored'}
      data-rc14-zone-token={zone.token}
      data-rc14-zone-pattern={zone.pattern}
      aria-label={zone.description}
    >
      <rect
        className="rc14-zone-rect"
        x={zone.rect.x}
        y={zone.rect.y}
        width={zone.rect.width}
        height={zone.rect.height}
        rx={2}
      />
      {zone.pattern === 'solid' || zone.pattern === 'outline' ? null : (
        <rect
          className="rc14-zone-pattern"
          data-testid="rc14-zone-pattern"
          x={zone.rect.x}
          y={zone.rect.y}
          width={zone.rect.width}
          height={zone.rect.height}
          rx={2}
        />
      )}
      <text className="rc14-zone-label" x={zone.rect.x + zone.rect.width / 2} y={zone.rect.y + zone.rect.height / 2}>
        {zone.label}
      </text>
    </g>
  )
}

/**
 * One prioritized fault row. The row exists ONLY because a real fault channel reported: packet 16's
 * "row hidden if the channel is absent" is implemented by never building the row at all, so an
 * unmonitored system can never contribute an OK.
 *
 * Packet 13 lists a fault acknowledge control and 11.5 describes a macro button for it, but neither
 * 11.1 nor 12.1 gives it a zone. The affordance therefore lives INSIDE the row — packet 11.5's own
 * "tapping a fault" — and no separate rectangle is invented.
 */
function FaultRow({
  row,
  selected,
  showTimestamp,
  onSelect,
  onAcknowledge
}: {
  row: Rc14SystemRow
  selected: boolean
  showTimestamp: boolean
  onSelect: (id: Rc14SystemId) => void
  onAcknowledge: (ids: readonly Rc14FaultSourceId[]) => void
}): ReactElement {
  return (
    <li
      className="rc14-fault-row"
      data-testid="rc14-fault-row"
      data-rc14-system={row.id}
      data-rc14-severity={row.severity}
      data-rc14-token={row.token}
      data-rc14-pattern={row.pattern}
      data-rc14-latched={row.latched ? 'true' : 'false'}
      data-rc14-selected={selected ? 'true' : 'false'}
    >
      <button
        type="button"
        className="rc14-fault-select"
        data-testid="rc14-fault-select"
        onClick={() => onSelect(row.id)}
        aria-pressed={selected}
        aria-label={rc14SystemDescription(row)}
      >
        <span className="rc14-fault-system">{row.label}</span>
        <span className="rc14-fault-chip" data-testid="rc14-fault-chip" data-rc14-chip={row.severity}>
          {row.chip}
        </span>
        <span className="rc14-fault-detail">{row.detail}</span>
        {row.zone === null ? (
          <span className="rc14-fault-nozone" data-testid="rc14-fault-nozone">
            {RC14_NO_ZONE_NOTICE}
          </span>
        ) : null}
        {showTimestamp ? (
          <span className="rc14-fault-stamp" data-testid="rc14-fault-stamp">
            {row.engagedAtMs === null ? RC14_DASH.chip : `T+${Math.round(row.engagedAtMs / 1000)}s`}
          </span>
        ) : null}
      </button>
      {row.acknowledgeable.length > 0 ? (
        <button
          type="button"
          className="rc14-fault-ack"
          data-testid="rc14-fault-ack"
          onClick={() => onAcknowledge(row.acknowledgeable)}
          aria-label={`Acknowledge ${row.label} ${row.chip}`}
        >
          ACK
        </button>
      ) : null}
    </li>
  )
}

/** One vitals gauge. A dashed vital draws its track with ZERO fill — never a last-known length. */
function VitalGauge({ vital }: { vital: Rc14VitalState }): ReactElement {
  return (
    <div
      className="rc14-vital"
      data-testid="rc14-vital"
      data-rc14-vital={vital.id}
      data-rc14-vital-unavailable={vital.field.unavailable ? 'true' : 'false'}
      data-rc14-vital-stale={vital.field.stale ? 'true' : 'false'}
      data-rc14-vital-alerting={vital.alerting ? 'true' : 'false'}
      data-rc14-vital-fill={vital.fill}
      aria-label={vital.description}
    >
      <span className="rc14-vital-label">{vital.label}</span>
      <span className="rc14-vital-value" data-testid="rc14-vital-value">
        {vital.field.value}
      </span>
      <span className="rc14-vital-unit">{vital.unit}</span>
      <span className="rc14-vital-track" data-testid="rc14-vital-track" aria-hidden="true">
        <span className="rc14-vital-fill" style={{ width: rc14FormatFillPercent(vital.fill) }} />
      </span>
    </div>
  )
}

function CornerTable({ corners }: { corners: readonly Rc14CornerState[] }): ReactElement {
  return (
    <table className="rc14-corner-table" data-testid="rc14-corner-table">
      <thead>
        <tr>
          <th scope="col" className="rc14-corner-rowhead">
            <span className="rc14-visually-hidden">Measurement</span>
          </th>
          {corners.map((corner) => (
            <th key={corner.corner} scope="col" className="rc14-corner-head" data-testid="rc14-corner-head">
              {corner.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr data-rc14-corner-row="brakeTemp">
          <th scope="row" className="rc14-corner-rowhead">
            BRK °C
          </th>
          {corners.map((corner) => (
            <td
              key={corner.corner}
              className="rc14-corner-value"
              data-testid="rc14-corner-brake"
              data-rc14-corner={corner.corner}
              data-rc14-unavailable={corner.brakeTemp.unavailable ? 'true' : 'false'}
              data-rc14-stale={corner.brakeTemp.stale ? 'true' : 'false'}
              aria-label={rc01FieldDescription(`${corner.label} brake temperature °C`, corner.brakeTemp)}
            >
              {corner.brakeTemp.value}
            </td>
          ))}
        </tr>
        <tr data-rc14-corner-row="tyrePressure">
          <th scope="row" className="rc14-corner-rowhead">
            PRS bar
          </th>
          {corners.map((corner) => (
            <td
              key={corner.corner}
              className="rc14-corner-value"
              data-testid="rc14-corner-pressure"
              data-rc14-corner={corner.corner}
              data-rc14-unavailable={corner.tyrePressure.unavailable ? 'true' : 'false'}
              data-rc14-stale={corner.tyrePressure.stale ? 'true' : 'false'}
              aria-label={rc01FieldDescription(`${corner.label} tyre pressure bar`, corner.tyrePressure)}
            >
              {corner.tyrePressure.value}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  )
}

function DecisionBlock({ decision }: { decision: Rc14Decision }): ReactElement {
  return (
    <div
      className="rc14-decision"
      data-testid="rc14-decision"
      data-rc14-decision={decision.word ?? 'unavailable'}
      data-rc14-decision-token={decision.token}
      data-rc14-decision-available={decision.available ? 'true' : 'false'}
      aria-label={rc14DecisionDescription(decision)}
    >
      <span className="rc14-decision-label">DECISION</span>
      <span className="rc14-decision-word" data-testid="rc14-decision-word">
        {decision.value}
      </span>
      <span className="rc14-decision-reason">{decision.reason}</span>
    </div>
  )
}

/**
 * RC-14 is an overlay-widget-owned, live-only triage page. It shares RC-01's fail-closed ingest
 * buffer, so mock and replay telemetry are refused outright and a source or session discontinuity
 * clears every channel receipt and unlatches every fault — a latched critical fault from a previous
 * session must never survive into a new one.
 */
export interface RaceconRc14DashWidgetProps extends WidgetProps {
  monotonicClock?: Rc01MonotonicClock
}

export function RaceconRc14DashWidget({
  snapshot,
  config,
  preview,
  monotonicClock = rc01MonotonicNow
}: RaceconRc14DashWidgetProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const bufferRef = useRef(new Rc01LiveTelemetryBuffer())
  const auxRef = useRef(new Rc14AuxBuffer())
  const alertsRef = useRef(createRc14AlertState())
  // The shared family display clock: it ticks every 100 ms while live and holds its mount value for
  // any preview mode. RC-14 ages hard against it — receipts stale, alerts debounce and latch, the
  // timeline window rolls — so a ticking clock in a static preview would walk one snapshot past its
  // own thresholds and mutate the rendered text with no new data behind it.
  const nowMs = useRaceconDisplayClock(monotonicClock, raceconDisplayClockFrozen(preview))
  const [selectedSystem, setSelectedSystem] = useState<Rc14SystemId | null>(null)
  const [acknowledged, setAcknowledged] = useState<readonly Rc14FaultSourceId[]>([])
  const box = useContentBox(rootRef, config)

  // A receipt timestamp, not a display clock: it advances only when a new snapshot object or
  // provider timestamp arrives, so a freshness tick cannot make a stale frame look fresh.
  const arrivalMs = useMemo(() => monotonicClock(), [monotonicClock, snapshot, snapshot?.timestamp])

  // Rendering mutates isolated candidates only; they are committed in the layout phase so
  // StrictMode double-renders and abandoned concurrent renders cannot advance real state.
  const candidate = bufferRef.current.clone()
  const outcome = candidate.ingest(snapshot, arrivalMs)
  const aux = auxRef.current.clone()
  if (outcome.accepted) {
    aux.ingest(candidate.latestSnapshot(), arrivalMs)
  } else if (!outcome.renderable) {
    // Fail closed: anything the buffer refuses also invalidates the channel receipts, so a new
    // source never inherits the previous session's vitals or its latched faults.
    aux.reset()
  }

  const renderSnapshot = outcome.renderable ? candidate.latestSnapshot() : null
  const layout = rc14LayoutForContentBox(box.width, box.height)
  const compactMode = rc14CompactModeForContentBox(box.width, box.height)
  const showApp = layout === 'app'
  const receipts = aux.receipts()

  // Two passes: the first builds the model the alert layer reads, the second re-renders it with
  // whatever the alert layer actually latched, so no surface can annotate a zone whose channel was
  // invalidated in the same frame.
  const seeded = acknowledged.reduce(
    (state, id) => acknowledgeRc14Fault(state, id),
    outcome.renderable ? alertsRef.current : createRc14AlertState()
  )
  const advanced = advanceRc14Alerts(seeded, rc14AlertInputForSnapshot(renderSnapshot, receipts, nowMs))
  const provisional = createRc14DashboardModel(renderSnapshot, receipts, nowMs, {
    alerts: advanced,
    includeTimeline: showApp
  })
  const alerts = clearInvalidRc14Alerts(advanced, provisional)
  const model: Rc14DashboardModel = createRc14DashboardModel(renderSnapshot, receipts, nowMs, {
    alerts,
    includeTimeline: showApp
  })

  const zones = rc14ZonesForLayout(layout, compactMode, box)

  const responsiveStyle = {
    // Normative override N2: the ladder is arithmetic, never measured off the render. Because the
    // app canvas is exactly 1.28x the native canvas, ONE cqw ladder gives 40/24/19/14/12 px at
    // 800 wide and 51.2/30.72/24.32/17.92/15.36 px at 1024 wide.
    '--rc14-type-vital': `${rc14TypeScaleCqw(RC14_TYPE_SCALE_PX.vitalValue)}cqw`,
    '--rc14-type-decision': `${rc14TypeScaleCqw(RC14_TYPE_SCALE_PX.decisionWord)}cqw`,
    '--rc14-type-system': `${rc14TypeScaleCqw(RC14_TYPE_SCALE_PX.faultSystem)}cqw`,
    '--rc14-type-chip': `${rc14TypeScaleCqw(RC14_TYPE_SCALE_PX.severityChip)}cqw`,
    '--rc14-type-zone': `${rc14TypeScaleCqw(RC14_TYPE_SCALE_PX.zoneLabel)}cqw`,
    '--rc14-type-corner': `${rc14TypeScaleCqw(RC14_TYPE_SCALE_PX.cornerValue)}cqw`,
    '--rc14-type-corner-head': `${rc14TypeScaleCqw(RC14_TYPE_SCALE_PX.cornerHeader)}cqw`
  } as CSSProperties

  useLayoutEffect(() => {
    bufferRef.current = candidate
    auxRef.current = aux
    alertsRef.current = alerts
    // An acknowledgement belongs to ONE fault. Once that fault has released, the acknowledgement is
    // dropped, so a fault that recurs later is never pre-cleared by a stale acknowledgement.
    setAcknowledged((current) => {
      const next = current.filter((id) => (alerts.sources[id]?.engagedAtMs ?? null) !== null)
      return next.length === current.length ? current : next
    })
  }, [candidate, aux, alerts])

  const onSelect = useCallback((id: Rc14SystemId) => {
    setSelectedSystem((current) => (current === id ? null : id))
  }, [])

  const onAcknowledge = useCallback((ids: readonly Rc14FaultSourceId[]) => {
    setAcknowledged((current) => {
      const next = ids.filter((id) => !current.includes(id))
      return next.length === 0 ? current : [...current, ...next]
    })
  }, [])

  const selectedZone = model.systems.find((row) => row.id === selectedSystem)?.zone ?? null
  const unmonitoredZones = model.zones.filter((zone) => !zone.monitored).length
  const decisionRect = showApp ? zones.decisionCorners : zones.decisionBanner

  return (
    <div
      ref={rootRef}
      className="rc14-widget"
      data-widget="raceconRc14Dash"
      data-rc14-layout={layout}
      data-rc14-compact-mode={layout === 'compact' ? compactMode : undefined}
      data-rc14-buffer-state={outcome.reason}
      data-rc14-alerts={model.alertsActive ? 'active' : 'silent'}
      data-rc14-decision={model.decision.word ?? 'unavailable'}
      data-rc14-monitored-systems={model.monitoredSystemCount}
      data-rc14-monitored-sources={model.monitoredSourceIds.length}
      data-rc14-selected-zone={selectedZone ?? undefined}
      data-rc14-content-width={Math.round(box.width)}
      data-rc14-content-height={Math.round(box.height)}
      style={responsiveStyle}
    >
      <main
        className="rc14-dashboard"
        aria-label="RaceCon RC-14 triage, vehicle health and damage assessment"
        data-rc14-native-size={layout === 'native' ? '800x480' : undefined}
      >
        {/* Packet 11.1 zone 2: the prioritized fault list. Highest severity on top, then a stable
            key so live re-ranking cannot flicker rows. */}
        <section
          className="rc14-panel rc14-panel-faults"
          data-testid="rc14-panel-faultList"
          data-rc14-zone="faultList"
          data-rc14-rows={model.systems.length}
          style={zoneStyle(zones.faultList)}
          aria-label="Prioritized fault list"
        >
          <span className="rc14-panel-title">FAULTS</span>
          {model.systems.length === 0 ? (
            <p className="rc14-empty" data-testid="rc14-fault-empty">
              {RC14_NO_FAULT_SOURCE_NOTICE}
            </p>
          ) : (
            <ul className="rc14-fault-list">
              {model.systems.map((row) => (
                <FaultRow
                  key={row.id}
                  row={row}
                  selected={row.id === selectedSystem}
                  showTimestamp={showApp}
                  onSelect={onSelect}
                  onAcknowledge={onAcknowledge}
                />
              ))}
            </ul>
          )}
        </section>

        {/* Packet 11.1 zone 1: the car silhouette fault map. All eight zones are always drawn; the
            six with no channel render unmonitored rather than being omitted. */}
        <section
          className="rc14-panel rc14-panel-silhouette"
          data-testid="rc14-panel-carSilhouette"
          data-rc14-zone="carSilhouette"
          data-rc14-zones={model.zones.length}
          data-rc14-unmonitored-zones={unmonitoredZones}
          style={zoneStyle(zones.carSilhouette)}
          aria-label="Car silhouette fault map"
        >
          <span className="rc14-panel-title">FAULT MAP</span>
          <svg
            className="rc14-silhouette"
            data-testid="rc14-silhouette"
            viewBox="0 0 100 100"
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label="Generic top-down car silhouette with eight labelled fault zones"
            focusable="false"
          >
            <defs>
              <pattern id="rc14-dots" width="4" height="4" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="0.7" />
              </pattern>
              <pattern id="rc14-stripes" width="4" height="4" patternUnits="userSpaceOnUse">
                <path d="M0 4 L4 0" strokeWidth="1.1" />
              </pattern>
              <pattern id="rc14-crosshatch" width="3" height="3" patternUnits="userSpaceOnUse">
                <path d="M0 3 L3 0 M0 0 L3 3" strokeWidth="1" />
              </pattern>
            </defs>
            <path
              className="rc14-silhouette-outline"
              data-testid="rc14-silhouette-outline"
              d={RC14_SILHOUETTE_PATH}
              vectorEffect="non-scaling-stroke"
            />
            {model.zones.map((zone) => (
              <SilhouetteZone key={zone.id} zone={zone} />
            ))}
          </svg>
          {unmonitoredZones > 0 ? (
            <p className="rc14-unmonitored" data-testid="rc14-unmonitored-notice">
              {unmonitoredZones} ZONES {RC14_UNMONITORED_NOTICE}
            </p>
          ) : null}
        </section>

        {/* Packet 11.1 zone 3: the vitals gauge column. */}
        <section
          className="rc14-panel rc14-panel-vitals"
          data-testid="rc14-panel-vitalsColumn"
          data-rc14-zone="vitalsColumn"
          style={zoneStyle(zones.vitalsColumn)}
          aria-label="Vitals gauge column"
        >
          <span className="rc14-panel-title">VITALS</span>
          <div className="rc14-vitals">
            {model.vitals.map((vital) => (
              <VitalGauge key={vital.id} vital={vital} />
            ))}
          </div>
        </section>

        {/* Packet 12.1 reflow: at 1024x600 the decision banner MOVES out of the centre and merges
            with corner status on the right. That is the packet's expansion model, not a scale. */}
        {showApp ? (
          <section
            className="rc14-panel rc14-panel-decision-corners"
            data-testid="rc14-panel-decisionCorners"
            data-rc14-zone="decisionCorners"
            style={zoneStyle(decisionRect)}
            aria-label="Decision and corner status"
          >
            <DecisionBlock decision={model.decision} />
            <CornerTable corners={model.corners} />
          </section>
        ) : (
          <>
            <section
              className="rc14-panel rc14-panel-decision"
              data-testid="rc14-panel-decisionBanner"
              data-rc14-zone="decisionBanner"
              style={zoneStyle(zones.decisionBanner)}
              aria-label="Continue, limp or pit decision"
            >
              <DecisionBlock decision={model.decision} />
            </section>
            <section
              className="rc14-panel rc14-panel-corners"
              data-testid="rc14-panel-cornerStatus"
              data-rc14-zone="cornerStatus"
              style={zoneStyle(zones.cornerStatus)}
              aria-label="Corner status quick view"
            >
              <CornerTable corners={model.corners} />
            </section>
          </>
        )}

        {/* Packet 12.1's app-only reveal. The engage time is OBSERVED, never reconstructed: a fault
            that engaged before this widget mounted has no observed time and no timeline entry. */}
        {showApp ? (
          <section
            className="rc14-panel rc14-panel-timeline"
            data-testid="rc14-panel-faultTimeline"
            data-rc14-zone="faultTimeline"
            data-rc14-timeline-entries={model.timeline.length}
            style={zoneStyle(zones.faultTimeline)}
            aria-label="Fault timeline, when each fault appeared"
          >
            <span className="rc14-panel-title">TIMELINE</span>
            {model.timeline.length === 0 ? (
              <p className="rc14-empty" data-testid="rc14-timeline-empty">
                {RC14_TIMELINE_UNAVAILABLE_NOTICE}
              </p>
            ) : (
              <div className="rc14-timeline-track" data-testid="rc14-timeline-track">
                {model.timeline.map((entry) => (
                  <span
                    key={entry.id}
                    className="rc14-timeline-mark"
                    data-testid="rc14-timeline-mark"
                    data-rc14-timeline-source={entry.id}
                    data-rc14-timeline-severity={entry.severity}
                    data-rc14-timeline-clamped={entry.clamped ? 'true' : 'false'}
                    style={{ left: `${entry.x}%` }}
                    aria-label={`${entry.label} engaged`}
                  >
                    <span className="rc14-timeline-label">{entry.label}</span>
                  </span>
                ))}
              </div>
            )}
          </section>
        ) : null}
      </main>
    </div>
  )
}
