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
  RC17_QUADRANTS,
  RC17_QUADRANT_ARCS,
  RC17_RADAR_RANGE_M,
  RC17_RING,
  RC17_TYPE_SCALE_PX,
  Rc17AuxBuffer,
  Rc17ClosingTracker,
  type Rc17DashboardModel,
  type Rc17Field,
  type Rc17RadarContact,
  type Rc17Rect,
  type Rc17SectorModel,
  advanceRc17Alerts,
  clearInvalidRc17Alerts,
  createRc17AlertState,
  createRc17DashboardModel,
  rc17AlertInputForModel,
  rc17AlertLines,
  rc17CompactModeForContentBox,
  rc17ContactPoint,
  rc17LayoutForContentBox,
  rc17Percent,
  rc17PhoneGeometryForContentBox,
  rc17QuadrantPath,
  rc17RadarContacts,
  rc17RingPoint,
  rc17SectorDescription,
  rc17TypeScaleCqw,
  rc17ZoneStyle,
  rc17ZonesForLayout
} from './raceconRc17Core'
import './raceconRc17.css'

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

function zoneStyle(rect: Rc17Rect | undefined): CSSProperties | undefined {
  const style = rc17ZoneStyle(rect)
  return style ? (style as CSSProperties) : undefined
}

/** A label above its value, so a narrow packet cell never has to wrap a row. */
function Cell({
  label,
  unit,
  value,
  description,
  rung,
  zone
}: {
  label: string
  unit?: string
  value: Rc17Field
  description?: string
  rung: 'pace' | 'tertiary' | 'closing' | 'line'
  zone: string
}): ReactElement {
  return (
    <div className="rc17-cell" data-testid="rc17-cell" data-rc17-cell={zone} data-rc17-rung={rung}>
      <span className="rc17-label">
        {label}
        {unit ? <span className="rc17-unit">{unit}</span> : null}
      </span>
      <output
        className={`rc17-value${value.stale ? ' is-stale' : ''}${value.unavailable ? ' is-unavailable' : ''}`}
        data-testid={`rc17-${zone}`}
        data-tone={value.tone}
        aria-label={rc01FieldDescription(description ?? label, value)}
      >
        {value.value}
      </output>
    </div>
  )
}

/**
 * One 90-degree quadrant of packet 11.1's proximity ring. A clear sector is the ABSENCE of fill
 * and is never green (OV-8); an un-addressable one carries an explicit dash (OV-9).
 */
function Sector({ sector }: { sector: Rc17SectorModel }): ReactElement {
  return (
    <g
      className="rc17-sector"
      data-testid="rc17-sector"
      data-rc17-sector={sector.sector}
      data-rc17-clock={sector.clockPosition}
      data-rc17-occupied={sector.occupied ? 'true' : 'false'}
      data-rc17-unavailable={sector.unavailable ? 'true' : 'false'}
      data-rc17-tone={sector.tone}
    >
      <path className="rc17-sector-arc" d={sector.path} />
      {sector.label ? (
        <text
          className="rc17-sector-word"
          x={sector.word.x}
          y={sector.word.y}
          textLength={sector.wordLength}
          lengthAdjust="spacingAndGlyphs"
        >
          {sector.label}
        </text>
      ) : null}
    </g>
  )
}

/** A real radar contact, plotted at its own measured range and angle. Never a phantom. */
function Contact({ contact, lit }: { contact: Rc17RadarContact; lit: boolean }): ReactElement {
  const point = rc17ContactPoint(contact)
  return (
    <circle
      className="rc17-contact"
      data-testid="rc17-contact"
      data-rc17-quadrant={contact.quadrant}
      data-rc17-lit={lit ? 'true' : 'false'}
      cx={point.x}
      cy={point.y}
      r={RC17_RING.contactRadius}
    />
  )
}

/**
 * RC-17 is an overlay-widget-owned, live-only oval spotter display. It shares RC-01's
 * fail-closed ingest buffer, so mock and replay telemetry are refused and a source or session
 * discontinuity clears the measured closing history and every latched alert.
 */
export interface RaceconRc17DashWidgetProps extends WidgetProps {
  monotonicClock?: Rc01MonotonicClock
}

export function RaceconRc17DashWidget({
  snapshot,
  config,
  preview,
  monotonicClock = rc01MonotonicNow
}: RaceconRc17DashWidgetProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const bufferRef = useRef(new Rc01LiveTelemetryBuffer())
  const auxRef = useRef(new Rc17AuxBuffer())
  const closingRef = useRef(new Rc17ClosingTracker())
  const alertsRef = useRef(createRc17AlertState())
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
  const closingTracker = closingRef.current.clone()
  if (outcome.accepted) {
    aux.ingest(candidate.latestSnapshot(), arrivalMs)
    // The closing rate is MEASURED, so it only ever advances on a genuinely new accepted frame.
    closingTracker.observe(arrivalMs, rc17RadarContacts(candidate.latestSnapshot()))
  } else if (!outcome.renderable) {
    // Fail closed: anything the buffer refuses also invalidates the aux receipts and the
    // measured closing history, so a new source never inherits the previous car's neighbours.
    aux.reset()
    closingTracker.reset()
  }

  const renderSnapshot = outcome.renderable ? candidate.latestSnapshot() : null
  const closingRates = closingTracker.rates(nowMs)

  // Two passes: the first builds the model the alert layer reads, the second re-renders it with
  // whatever the alert layer actually latched, so no surface can escalate for an alert that was
  // cleared in the same frame.
  const provisional = createRc17DashboardModel(renderSnapshot, candidate.receipts(), aux.receipts(), nowMs, {
    alerts: alertsRef.current,
    closingRates
  })
  const advanced = advanceRc17Alerts(alertsRef.current, rc17AlertInputForModel(provisional, nowMs, closingRates))
  const alerts = clearInvalidRc17Alerts(advanced, provisional)
  const model: Rc17DashboardModel = createRc17DashboardModel(
    renderSnapshot,
    candidate.receipts(),
    aux.receipts(),
    nowMs,
    { alerts, closingRates }
  )

  const layout = rc17LayoutForContentBox(box.width, box.height)
  const compactMode = rc17CompactModeForContentBox(box.width, box.height)
  const zones = rc17ZonesForLayout(layout, compactMode)
  const phoneGeometry = rc17PhoneGeometryForContentBox(box.width, box.height)
  const alertLines = rc17AlertLines(model)
  const showApp = layout === 'app'
  const litQuadrants = new Set<string>(model.sectors.filter((sector) => sector.occupied).map((sector) => sector.sector))

  const responsiveStyle = {
    '--rc17-type-closing': `${rc17TypeScaleCqw(RC17_TYPE_SCALE_PX.closing)}cqw`,
    '--rc17-type-line': `${rc17TypeScaleCqw(RC17_TYPE_SCALE_PX.line)}cqw`,
    '--rc17-type-pace': `${rc17TypeScaleCqw(RC17_TYPE_SCALE_PX.pace)}cqw`,
    '--rc17-type-flag': `${rc17TypeScaleCqw(RC17_TYPE_SCALE_PX.flag)}cqw`,
    '--rc17-type-tertiary': `${rc17TypeScaleCqw(RC17_TYPE_SCALE_PX.tertiary)}cqw`,
    '--rc17-type-label': `${rc17TypeScaleCqw(RC17_TYPE_SCALE_PX.label)}cqw`,
    // Packet 11.4: the cue's LENGTH carries the value. The brief's colour note is explicit that
    // `secondary` and `info` have a luminance gap of exactly zero, so colour never carries it.
    '--rc17-rev-fill': model.revFill === null ? '0%' : `${Math.round(model.revFill * 1_000) / 10}%`,
    ...(phoneGeometry
      ? {
          '--rc17-phone-inset': `${phoneGeometry.inset}px`,
          '--rc17-phone-flag-height': `${phoneGeometry.flagHeight}px`,
          '--rc17-phone-row-height': `${phoneGeometry.rowHeight}px`,
          '--rc17-phone-tertiary-height': `${phoneGeometry.tertiaryHeight}px`
        }
      : {})
  } as CSSProperties

  useLayoutEffect(() => {
    bufferRef.current = candidate
    auxRef.current = aux
    closingRef.current = closingTracker
    alertsRef.current = alerts
  }, [candidate, aux, closingTracker, alerts])

  return (
    <div
      ref={rootRef}
      className="rc17-widget"
      data-widget="raceconRc17Dash"
      data-rc17-layout={layout}
      data-rc17-compact-mode={layout === 'compact' ? compactMode : undefined}
      data-rc17-buffer-state={outcome.reason}
      data-rc17-spotter={model.spotter.zone ?? 'unavailable'}
      data-rc17-spotter-stale={model.spotter.stale ? 'true' : 'false'}
      data-rc17-radar={model.radar.available ? 'live' : 'unavailable'}
      data-rc17-flag-kind={model.flag.kind}
      data-rc17-alerts={alertLines.length > 0 ? 'active' : 'silent'}
      data-rc17-alert-keys={alertLines.join(',')}
      data-rc17-content-width={Math.round(box.width)}
      data-rc17-content-height={Math.round(box.height)}
      style={responsiveStyle}
    >
      <main
        className="rc17-dashboard"
        aria-label="RaceCon RC-17 high line, oval spotter awareness"
        data-rc17-native-size={layout === 'native' ? '800x480' : undefined}
      >
        {/*
          Packet 11.1 side flags. Packet 19 makes this the accessibility guarantee: the side is
          carried by the WORD, never by the colour. Packet 16 forbids a false 'clear', so a
          spotter channel that is absent or stale says NO DATA here instead of falling silent.
          Packet 12.1 drops this zone entirely; RC17_PACKET_OMISSIONS.sideFlagAppZone restores it.
        */}
        <section
          className="rc17-flags"
          data-testid="rc17-flags"
          data-rc17-zone="flags"
          data-rc17-flag-kind={model.flag.kind}
          style={zoneStyle(zones.flags)}
          aria-label="Persistent spotter side flag"
        >
          {model.flag.kind === 'none' ? null : (
            <output
              className={`rc17-flag${model.flag.kind === 'unavailable' ? ' is-unavailable' : ''}${model.flag.kind === 'three-wide' ? ' is-critical' : ''}`}
              data-testid="rc17-flag"
              data-rc17-flag-kind={model.flag.kind}
              role={model.flag.kind === 'unavailable' ? undefined : 'alert'}
            >
              {model.flag.text}
            </output>
          )}
        </section>

        {/*
          Packet 11.1 line-choice cue. RC17_PACKET_OMISSIONS.lineChoice: section 10 makes this
          PRIMARY and 11.2 gives it the 40 px slot, but no channel exists anywhere in the app, so
          the recommendation dashes for ever and HIGH and LOW render identically dim with no
          selection marker of any kind. Nothing here may read as a recommendation.
        */}
        <section
          className="rc17-line"
          data-testid="rc17-line"
          data-rc17-zone="line"
          data-rc17-line-source="none"
          style={zoneStyle(zones.line)}
          aria-label="Line choice guidance"
        >
          <Cell label="LINE" value={model.line.recommendation} description="Line choice" rung="line" zone="line" />
          <div className="rc17-line-options" data-testid="rc17-line-options">
            {model.line.options.map((option) => (
              <span
                key={option.key}
                className="rc17-line-option"
                data-testid="rc17-line-option"
                data-rc17-option={option.key}
                data-rc17-selected={option.selected ? 'true' : 'false'}
              >
                {option.key}
              </span>
            ))}
          </div>
        </section>

        {/*
          Packet 11.1 spotter clock — the hero. Four 90-degree quadrants; 12 o'clock is the
          driver's own heading tick and carries no data (OV-10). Left and right come from the
          decided-side channel; 6 o'clock comes from the radar's own geometry, because the
          declared enum cannot address it (RC17_PACKET_OMISSIONS.behindSectorSource). OV-2 and
          OV-3: the own car sits on the exact centre and the whole assembly fits its zone.
        */}
        <section
          className="rc17-clock"
          data-testid="rc17-clock"
          data-rc17-zone="clock"
          data-rc17-three-wide={model.alerts.threeWide ? 'true' : 'false'}
          style={zoneStyle(zones.clock)}
          aria-label="Spotter proximity clock"
        >
          <svg
            className="rc17-ring"
            data-testid="rc17-ring"
            viewBox={`0 0 ${RC17_RING.viewBox} ${RC17_RING.viewBox}`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label="Proximity ring, own car at the centre"
          >
            <path
              className="rc17-quadrant-structural"
              data-testid="rc17-heading-quadrant"
              d={rc17QuadrantPath('HEADING')}
            />
            {model.sectors.map((sector) => (
              <Sector key={sector.sector} sector={sector} />
            ))}
            {RC17_QUADRANTS.map((quadrant) => {
              const inner = rc17RingPoint(RC17_QUADRANT_ARCS[quadrant][0], RC17_RING.innerRadius)
              const outer = rc17RingPoint(RC17_QUADRANT_ARCS[quadrant][0], RC17_RING.outerRadius)
              return (
                <line
                  key={`divider-${quadrant}`}
                  className="rc17-divider"
                  x1={inner.x}
                  y1={inner.y}
                  x2={outer.x}
                  y2={outer.y}
                />
              )
            })}
            <line
              className="rc17-heading-tick"
              data-testid="rc17-heading-tick"
              x1={RC17_RING.centre}
              y1={RC17_RING.centre - RC17_RING.headingTickInner}
              x2={RC17_RING.centre}
              y2={RC17_RING.centre - RC17_RING.headingTickOuter}
            />
            {model.radar.contacts.map((contact) => (
              <Contact key={contact.carIdx} contact={contact} lit={litQuadrants.has(contact.quadrant)} />
            ))}
            <circle
              className="rc17-own-car"
              data-testid="rc17-own-car"
              cx={RC17_RING.centre}
              cy={RC17_RING.centre}
              r={RC17_RING.ownCarRadius}
            />
          </svg>
          {model.alerts.threeWide ? (
            <p className="rc17-three-wide" data-testid="rc17-three-wide" role="alert">
              THREE WIDE
            </p>
          ) : null}
          {/* Packet 19: every sector state is also available as a word, never as colour alone. */}
          <p className="rc17-sr" data-testid="rc17-sector-readout">
            {model.sectors.map((sector) => rc17SectorDescription(sector)).join('. ')}
          </p>
        </section>

        {/*
          Packet 11.1 closing panel. RC17_PACKET_OMISSIONS.closingRateChannel: the rate is
          MEASURED from consecutive radar ranges of the same car and dashes until two such
          samples exist. The highlight is packet 15's alert surface and appears only while the
          alert is latched — it is never an always-on decoration.
        */}
        <section
          className={`rc17-closing${model.closing.highlighted ? ' is-alert' : ''}`}
          data-testid="rc17-closing"
          data-rc17-zone="closing"
          data-rc17-closing-alert={model.closing.highlighted ? 'true' : 'false'}
          data-rc17-closing-arrow={model.closing.arrow || 'none'}
          style={zoneStyle(zones.closing)}
          aria-label="Closing car side and rate"
        >
          <Cell
            label="CLOSING"
            unit="M/S"
            value={model.closing.rate}
            description="Closing rate"
            rung="closing"
            zone="closing-rate"
          />
          <Cell
            label="SIDE"
            value={model.closing.side}
            description="Closing side"
            rung="closing"
            zone="closing-side"
          />
          {model.closing.highlighted ? (
            <span className="rc17-closing-arrow" data-testid="rc17-closing-arrow" role="alert">
              <span className="rc17-sr">{`Fast closing ${model.closing.arrow.toLowerCase()}`}</span>
            </span>
          ) : null}
        </section>

        {/*
          Packet 11.1 pace strip — secondary. Gap ahead and position dash TOGETHER because they
          share the timing feed, while speed keeps a real value from wheel speed or GPS. That is
          the visible proof that nothing is mirrored or estimated across sources.
        */}
        <section
          className="rc17-pace"
          data-testid="rc17-pace"
          data-rc17-zone="pace"
          style={zoneStyle(zones.pace)}
          aria-label="Speed, gap ahead and position"
        >
          <Cell label="SPEED" unit="KM/H" value={model.speed} description="Speed" rung="pace" zone="speed" />
          <Cell label="GAP" unit="S" value={model.gapAhead} description="Gap to car ahead" rung="pace" zone="gap" />
          <Cell label="POS" value={model.position} description="Race position" rung="pace" zone="position" />
        </section>

        {/*
          RC17_PACKET_OMISSIONS.tertiaryZone: gear, engine RPM and water temperature are declared
          channels and section 10 tertiary items with no zone on either canvas, so they get a
          governed strip in unassigned space. Packet 11.4 keeps the rev cue thin and minimal —
          side awareness, not revs, owns this display.
        */}
        <section
          className="rc17-tertiary"
          data-testid="rc17-tertiary"
          data-rc17-zone="tertiary"
          data-rc17-rev-fill={model.revFill === null ? 'unavailable' : model.revFill.toFixed(2)}
          style={zoneStyle(zones.tertiary)}
          aria-label="Gear, engine speed and water temperature"
        >
          <Cell label="GEAR" value={model.gear} description="Gear" rung="tertiary" zone="gear" />
          <div className="rc17-rev" data-testid="rc17-rev">
            <Cell label="RPM" value={model.rpm} description="Engine speed" rung="tertiary" zone="rpm" />
            <span className="rc17-rev-track" data-testid="rc17-rev-track" aria-hidden="true">
              <span className="rc17-rev-fill" data-testid="rc17-rev-fill" />
            </span>
          </div>
          <Cell label="WATER" unit="DEG C" value={model.water} description="Water temperature" rung="tertiary" zone="water" />
        </section>

        {/*
          Packet 12.1 `pack-map-reveal`, app only (OV-12). The same real radar feed plotted wider.
          Packet 18 forbids fabricated cars, so a missing radar renders ZERO markers and says so.
        */}
        {showApp ? (
          <section
            className="rc17-pack-map"
            data-testid="rc17-pack-map"
            data-rc17-zone="packMap"
            data-rc17-pack-available={model.packMap.available ? 'true' : 'false'}
            data-rc17-pack-contacts={model.packMap.contacts.length}
            style={zoneStyle(zones.packMap)}
            aria-label="Pack map of nearby cars"
          >
            <span className="rc17-label">PACK MAP</span>
            {model.packMap.available ? (
              <div className="rc17-pack-field" data-testid="rc17-pack-field">
                {model.packMap.contacts.map((contact) => (
                  <span
                    key={contact.carIdx}
                    className="rc17-pack-car"
                    data-testid="rc17-pack-car"
                    data-rc17-quadrant={contact.quadrant}
                    style={{
                      left: rc17Percent(50 + (contact.relativeXM / RC17_RADAR_RANGE_M) * 45),
                      top: rc17Percent(50 - (contact.relativeYM / RC17_RADAR_RANGE_M) * 45)
                    }}
                    aria-label={`Car ${contact.rangeM.toFixed(1)} metres, ${contact.quadrant.toLowerCase()}`}
                  />
                ))}
                <span className="rc17-pack-own" data-testid="rc17-pack-own" aria-label="Own car" />
              </div>
            ) : (
              <output className="rc17-empty is-unavailable" data-testid="rc17-pack-empty">
                {model.packMap.label}
              </output>
            )}
          </section>
        ) : null}

        {/*
          Packet 12.1 lane-usage history, app only. RC17_PACKET_OMISSIONS.laneUsageHistory: it
          depends on the same missing lane channel as the line cue, so the structure renders with
          ZERO rows and the honest word rather than a fabricated history.
        */}
        {showApp ? (
          <section
            className="rc17-lane"
            data-testid="rc17-lane"
            data-rc17-zone="lane"
            data-rc17-lane-available={model.lane.available ? 'true' : 'false'}
            data-rc17-lane-rows={model.lane.rows.length}
            style={zoneStyle(zones.lane)}
            aria-label="Recent lane usage"
          >
            <span className="rc17-label">LANE USAGE</span>
            <output className="rc17-empty is-unavailable" data-testid="rc17-lane-empty">
              {model.lane.label}
            </output>
          </section>
        ) : null}
      </main>
    </div>
  )
}
