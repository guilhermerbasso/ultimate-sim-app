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
  RC09_CAUTION_ACK_EVENT,
  RC09_ROADBOOK_EVENT,
  RC09_TYPE_SCALE_PX,
  Rc09AuxBuffer,
  type Rc09DashboardModel,
  type Rc09Field,
  type Rc09Led,
  Rc09NoteHistory,
  type Rc09NoteGlyph,
  type Rc09PaceNote,
  type Rc09ProfileBar,
  type Rc09Rect,
  advanceRc09Alerts,
  clearInvalidRc09Alerts,
  createRc09AlertState,
  createRc09DashboardModel,
  rc09AlertInputForModel,
  rc09AlertLines,
  rc09CompactModeForContentBox,
  rc09LayoutForContentBox,
  rc09LedLeftPct,
  rc09NoteDescription,
  rc09PaceNoteFromEvent,
  rc09Percent,
  rc09PhoneGeometryForContentBox,
  rc09ProfileBars,
  rc09RungCqw,
  rc09SplitDescription,
  rc09StageTimerDescription,
  rc09TypeScaleCqw,
  rc09ZoneStyle,
  rc09ZonesForLayout
} from './raceconRc09Core'
import './raceconRc09.css'

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

function zoneStyle(rect: Rc09Rect | undefined): CSSProperties | undefined {
  const style = rc09ZoneStyle(rect)
  return style ? (style as CSSProperties) : undefined
}

/**
 * A support-strip mini. Packet 11.2's label-to-value ratio, and packet 15's mechanical-warning
 * surface: the red line appears only while that alert is latched on this specific reading.
 */
function Mini({
  label,
  unit,
  value,
  description,
  zone,
  faulted
}: {
  label: string
  unit?: string
  value: Rc09Field
  description?: string
  zone: string
  faulted?: boolean
}): ReactElement {
  return (
    <div
      className={`rc09-mini${faulted ? ' is-faulted' : ''}`}
      data-testid="rc09-mini"
      data-rc09-mini={zone}
      data-rc09-faulted={faulted ? 'true' : 'false'}
    >
      <span className="rc09-label">{label}</span>
      <output
        className={`rc09-mini-value${value.stale ? ' is-stale' : ''}${value.unavailable ? ' is-unavailable' : ''}`}
        data-testid={`rc09-${zone}`}
        data-tone={value.tone}
        aria-label={rc01FieldDescription(description ?? label, value)}
      >
        {value.value}
      </output>
      {unit ? <span className="rc09-unit">{unit}</span> : null}
      {faulted ? (
        <span className="rc09-mini-line" data-testid={`rc09-mini-line-${zone}`} role="alert">
          <span className="rc09-sr">{`${label} out of range`}</span>
        </span>
      ) : null}
    </div>
  )
}

/**
 * Packet 11.4's shift arc, at the support-strip edge because the top of the canvas is owned by the
 * stage timeline. Normative override 3: a REAL shallow arc, not the reference's 1 px rise. Every
 * disc is dark whenever the RPM channel is invalid or stale — the arc is never a decoration.
 */
function ShiftArc({ leds }: { leds: readonly Rc09Led[] }): ReactElement {
  return (
    <div
      className="rc09-arc"
      data-testid="rc09-arc"
      data-rc09-lit={leds.filter((led) => led.active).length}
      aria-hidden="true"
    >
      {leds.map((led) => (
        <span
          key={led.index}
          className={`rc09-led${led.active ? ' is-active' : ''}`}
          data-testid="rc09-led"
          data-rc09-led-tone={led.tone}
          data-rc09-led-index={led.index}
          style={{ left: rc09Percent(rc09LedLeftPct(led.index)), bottom: rc09Percent(led.arcOffsetPct) }}
        />
      ))}
    </div>
  )
}

/**
 * The note cue's direction glyph. Packet 8 and 19: a generic shape, never roadbook symbology, and
 * always accompanied by the co-driver's own words so the cue is never carried by colour alone.
 */
function NoteGlyph({ glyph }: { glyph: Rc09NoteGlyph }): ReactElement | null {
  if (glyph === 'none') return null
  return (
    <svg
      className="rc09-note-glyph"
      data-testid="rc09-note-glyph"
      data-rc09-glyph={glyph}
      viewBox="0 0 32 32"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      {glyph === 'right' ? <path d="M8 28 V14 A6 6 0 0 1 14 8 H22" /> : null}
      {glyph === 'left' ? <path d="M24 28 V14 A6 6 0 0 0 18 8 H10" /> : null}
      {glyph === 'straight' ? <path d="M16 28 V6" /> : null}
      {glyph === 'right' || glyph === 'left' || glyph === 'straight' ? (
        <path
          d={
            glyph === 'right'
              ? 'M18 3 L26 8 L18 13 Z'
              : glyph === 'left'
                ? 'M14 3 L6 8 L14 13 Z'
                : 'M16 2 L22 10 L10 10 Z'
          }
          className="rc09-note-arrow"
        />
      ) : (
        <path d="M16 4 L29 27 H3 Z" className="rc09-note-hazard" />
      )}
    </svg>
  )
}

/** One measured pace-note segment of the app-only stage profile. Packet 12.1. */
function ProfileBar({ bar }: { bar: Rc09ProfileBar }): ReactElement {
  return (
    <span
      className="rc09-profile-bar"
      data-testid="rc09-profile-bar"
      data-rc09-severity={bar.severity ?? 'ungraded'}
      data-rc09-hazard={bar.hazard ? 'true' : 'false'}
      style={{
        left: rc09Percent(bar.leftPercent),
        width: rc09Percent(bar.widthPercent),
        height: rc09Percent(bar.heightPercent)
      }}
      role="img"
      aria-label={`${bar.text}${bar.severity === null ? ', ungraded' : ''}`}
    />
  )
}

/**
 * RC-09 is an overlay-widget-owned, live-only rally stage display. It shares RC-01's fail-closed
 * ingest buffer, so mock and replay telemetry are refused and a source or session discontinuity
 * clears the measured note profile and every latched alert.
 */
export interface RaceconRc09DashWidgetProps extends WidgetProps {
  monotonicClock?: Rc01MonotonicClock
}

export function RaceconRc09DashWidget({
  snapshot,
  config,
  preview,
  monotonicClock = rc01MonotonicNow
}: RaceconRc09DashWidgetProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const bufferRef = useRef(new Rc01LiveTelemetryBuffer())
  const auxRef = useRef(new Rc09AuxBuffer())
  const historyRef = useRef(new Rc09NoteHistory())
  const alertsRef = useRef(createRc09AlertState())
  const nowMs = useRaceconDisplayClock(monotonicClock, raceconDisplayClockFrozen(preview))
  const [paceNote, setPaceNote] = useState<Rc09PaceNote | null>(null)
  const [acknowledgedSequence, setAcknowledgedSequence] = useState<number | null>(null)
  const box = useContentBox(rootRef, config)

  // A receipt timestamp, not a display clock: it advances only when a new snapshot object or
  // provider timestamp arrives, so a freshness tick cannot make a stale frame look fresh.
  const arrivalMs = useMemo(() => monotonicClock(), [monotonicClock, snapshot, snapshot?.timestamp])

  // Rendering mutates isolated candidates only; they are committed in the layout phase so
  // StrictMode double-renders and abandoned concurrent renders cannot advance real state.
  const candidate = bufferRef.current.clone()
  const outcome = candidate.ingest(snapshot, arrivalMs)
  const aux = auxRef.current.clone()
  const history = historyRef.current.clone()
  if (outcome.accepted) {
    aux.ingest(candidate.latestSnapshot(), arrivalMs)
  } else if (!outcome.renderable) {
    // Fail closed: anything the buffer refuses also invalidates the aux receipts and the measured
    // note profile, so a new source never inherits the previous crew's roadbook history.
    aux.reset()
    history.reset()
  }

  const renderSnapshot = outcome.renderable ? candidate.latestSnapshot() : null

  // Two passes: the first builds the model the alert layer reads, the second re-renders it with
  // whatever the alert layer actually latched, so no surface can escalate for an alert that was
  // cleared in the same frame.
  const provisional = createRc09DashboardModel(renderSnapshot, candidate.receipts(), aux.receipts(), nowMs, {
    alerts: alertsRef.current,
    paceNote
  })
  const advanced = advanceRc09Alerts(
    alertsRef.current,
    rc09AlertInputForModel(provisional, nowMs, acknowledgedSequence)
  )
  const alerts = clearInvalidRc09Alerts(advanced, provisional)
  const model: Rc09DashboardModel = createRc09DashboardModel(
    renderSnapshot,
    candidate.receipts(),
    aux.receipts(),
    nowMs,
    { alerts, paceNote }
  )

  // The profile is MEASURED: only a note the roadbook actually delivered opens a segment, and only
  // while there is a renderable stage run to profile, so a refused source leaves a real gap
  // instead of carrying the previous crew's calls into a new session.
  if (outcome.renderable) history.observe(paceNote)

  const layout = rc09LayoutForContentBox(box.width, box.height)
  const compactMode = rc09CompactModeForContentBox(box.width, box.height)
  const zones = rc09ZonesForLayout(layout, compactMode)
  const phoneGeometry = rc09PhoneGeometryForContentBox(box.width, box.height)
  const alertLines = rc09AlertLines(model)
  const showApp = layout === 'app'
  const profile = showApp ? rc09ProfileBars(history.entries()) : []

  // Packet 11.2 rungs, capped by each zone's own arithmetic fit so a hero numeral cannot escape
  // its zone. The clock is the one rung the packet oversizes for its own box; see the core.
  const clockWidth = zones.clock?.width ?? 52.5
  const splitWidth = zones.split?.width ?? 41
  const noteWidth = zones.note?.width ?? 41
  const supportWidth = (zones.support?.width ?? 96) / 3
  const responsiveStyle = {
    '--rc09-type-clock': `${rc09RungCqw(RC09_TYPE_SCALE_PX.clock, clockWidth, Math.max(7, model.stageTimer.value.length))}cqw`,
    '--rc09-type-split': `${rc09RungCqw(RC09_TYPE_SCALE_PX.split, splitWidth, Math.max(6, model.split.value.length + 2))}cqw`,
    '--rc09-type-note': `${rc09RungCqw(RC09_TYPE_SCALE_PX.note, noteWidth, Math.max(9, model.note.text.length + 3))}cqw`,
    '--rc09-type-support': `${rc09RungCqw(RC09_TYPE_SCALE_PX.support, supportWidth, 4)}cqw`,
    '--rc09-type-label': `${rc09TypeScaleCqw(RC09_TYPE_SCALE_PX.label)}cqw`,
    ...(phoneGeometry
      ? {
          '--rc09-phone-inset': `${phoneGeometry.inset}px`,
          '--rc09-phone-timeline-height': `${phoneGeometry.timelineHeight}px`,
          '--rc09-phone-clock-height': `${phoneGeometry.clockHeight}px`,
          '--rc09-phone-chip-height': `${phoneGeometry.chipHeight}px`,
          '--rc09-phone-led-size': `${phoneGeometry.ledSize}px`
        }
      : {})
  } as CSSProperties

  useLayoutEffect(() => {
    bufferRef.current = candidate
    auxRef.current = aux
    historyRef.current = history
    alertsRef.current = alerts
  }, [candidate, aux, history, alerts])

  // Packet 11.5, 16 and 20: a pace note comes ONLY from a loaded roadbook. An unrecognised payload
  // never changes the cue, and an explicit clear unloads the roadbook back to the blank state.
  useEffect(() => {
    const handler = (event: Event): void => {
      const next = rc09PaceNoteFromEvent((event as CustomEvent).detail)
      if (next === null) return
      setPaceNote(next === 'clear' ? null : next)
      if (next === 'clear') setAcknowledgedSequence(null)
    }
    window.addEventListener(RC09_ROADBOOK_EVENT, handler)
    return () => window.removeEventListener(RC09_ROADBOOK_EVENT, handler)
  }, [])

  // Packet 11.5 and 13: the macro button marks a caution acknowledged. It dismisses the current
  // waypoint only, and never before the packet's 2 s minimum display has elapsed.
  useEffect(() => {
    const handler = (): void => {
      setAcknowledgedSequence(paceNote?.sequence ?? null)
    }
    window.addEventListener(RC09_CAUTION_ACK_EVENT, handler)
    return () => window.removeEventListener(RC09_CAUTION_ACK_EVENT, handler)
  }, [paceNote?.sequence])

  return (
    <div
      ref={rootRef}
      className="rc09-widget"
      data-widget="raceconRc09Dash"
      data-rc09-layout={layout}
      data-rc09-compact-mode={layout === 'compact' ? compactMode : undefined}
      data-rc09-buffer-state={outcome.reason}
      data-rc09-roadbook={model.roadbookLoaded ? 'loaded' : 'absent'}
      data-rc09-stage-source={model.stage.available ? 'live' : 'unavailable'}
      data-rc09-split-state={model.splitDirection}
      data-rc09-alerts={alertLines.length > 0 ? 'active' : 'silent'}
      data-rc09-alert-keys={alertLines.join(',')}
      data-rc09-content-width={Math.round(box.width)}
      data-rc09-content-height={Math.round(box.height)}
      style={responsiveStyle}
    >
      <main
        className="rc09-dashboard"
        aria-label="RaceCon RC-09 stage time, rally stage and co-driver timing"
        data-rc09-native-size={layout === 'native' ? '800x480' : undefined}
      >
        {/*
          Packet 11.1 stage timeline. The travelled fill and the distance marker are COMPUTED, not
          traced: with no stage-distance channel `model.stage.progress` is null, so the track stays
          empty and says so in words rather than parking a marker at the reference's 68 %.
        */}
        <section
          className="rc09-timeline"
          data-testid="rc09-timeline"
          data-rc09-zone="timeline"
          data-rc09-stage-source={model.stage.available ? 'live' : 'unavailable'}
          style={zoneStyle(zones.timeline)}
          aria-label="Stage progress toward the finish"
        >
          <header className="rc09-timeline-head">
            <span className="rc09-label">STAGE</span>
            <output
              className={`rc09-timeline-finish${model.distanceToFinish.unavailable ? ' is-unavailable' : ''}`}
              data-testid="rc09-distance-to-finish"
              aria-label={rc01FieldDescription('Distance to finish', model.distanceToFinish)}
            >
              TO FIN {model.distanceToFinish.value}
            </output>
          </header>
          <div className="rc09-timeline-track" data-testid="rc09-timeline-track">
            {model.stage.progress !== null ? (
              <>
                <span
                  className="rc09-timeline-fill"
                  data-testid="rc09-timeline-fill"
                  style={{ width: rc09Percent(model.stage.progress * 100) }}
                />
                <span
                  className="rc09-timeline-marker"
                  data-testid="rc09-timeline-marker"
                  style={{ left: rc09Percent(model.stage.progress * 100) }}
                  role="img"
                  aria-label={`Stage marker at ${Math.round(model.stage.progress * 100)} percent`}
                />
              </>
            ) : (
              <p className="rc09-timeline-empty" data-testid="rc09-timeline-empty">
                {model.stage.sourceLabel}
              </p>
            )}
          </div>
        </section>

        {/* Packet 11.1 stage clock — the hero of the frame, and a MEASURED elapsed time only. */}
        <section
          className="rc09-clock"
          data-testid="rc09-clock"
          data-rc09-zone="clock"
          style={zoneStyle(zones.clock)}
          aria-label="Stage time"
        >
          <span className="rc09-label">STAGE TIME</span>
          <output
            className={`rc09-clock-value${model.stageTimer.stale ? ' is-stale' : ''}${model.stageTimer.unavailable ? ' is-unavailable' : ''}`}
            data-testid="rc09-stage-timer"
            data-tone={model.stageTimer.tone}
            aria-label={rc09StageTimerDescription(model)}
          >
            {model.stageTimer.value}
          </output>
        </section>

        {/*
          Packet 11.1 split chip and packet 15's split-loss surface. The sign is a literal
          character and the direction is a solid triangle, so the split is never carried by hue.
        */}
        <section
          className={`rc09-split${model.alerts.splitLoss ? ' is-losing' : ''}`}
          data-testid="rc09-split"
          data-rc09-zone="split"
          data-rc09-split-state={model.splitDirection}
          data-rc09-split-loss={model.alerts.splitLoss ? 'true' : 'false'}
          style={zoneStyle(zones.split)}
          aria-label="Rolling split against the reference run"
        >
          <span className="rc09-label">SPLIT</span>
          <div className="rc09-split-row">
            <span
              className="rc09-split-arrow"
              data-testid="rc09-split-arrow"
              data-rc09-direction={model.splitDirection}
              aria-hidden="true"
            />
            <output
              className={`rc09-split-value${model.split.stale ? ' is-stale' : ''}${model.split.unavailable ? ' is-unavailable' : ''}`}
              data-testid="rc09-split-value"
              data-tone={model.split.tone}
              aria-label={rc09SplitDescription(model)}
            >
              {model.split.value}
            </output>
            <span className="rc09-unit">S</span>
          </div>
          {model.alerts.splitLoss ? (
            <p className="rc09-split-alert" data-testid="rc09-split-loss" role="alert">
              SPLIT LOSS
            </p>
          ) : null}
        </section>

        {/*
          Packet 11.1 note cue tile. Its height is 20.0 % rather than the packet's 25.0 %: the
          published rect overlaps the support strip by 20 px, and the approved reference resolves
          the overlap at exactly this height. Every other 11.1 coordinate is verbatim.

          Packet 16 and 20: the cue is BLANK until a roadbook is loaded and is never generated.
        */}
        <section
          className={`rc09-note${model.alerts.cautionWaypoint ? ' is-caution' : ''}`}
          data-testid="rc09-note"
          data-rc09-zone="note"
          data-rc09-note={model.note.blank ? 'blank' : 'loaded'}
          data-rc09-note-glyph={model.note.glyph}
          data-rc09-caution={model.alerts.cautionWaypoint ? 'true' : 'false'}
          style={zoneStyle(zones.note)}
          aria-label={rc09NoteDescription(model.note)}
        >
          <span className="rc09-label">NOTE</span>
          <div className="rc09-note-row">
            <NoteGlyph glyph={model.note.glyph} />
            <output
              className={`rc09-note-value${model.note.blank ? ' is-unavailable' : ''}`}
              data-testid="rc09-note-value"
              aria-label={rc09NoteDescription(model.note)}
            >
              {model.note.text}
            </output>
          </div>
          {/*
            RC09_PACKET_OMISSIONS.noteDistanceReadout: no distance-to-waypoint channel exists, so
            the tile's distance and the packet 15 caution countdown are the same honest dash.
          */}
          <output
            className="rc09-note-distance is-unavailable"
            data-testid="rc09-note-distance"
            aria-label={rc01FieldDescription('Distance to note', model.noteDistance)}
          >
            {model.noteDistance.value}
          </output>
          {model.alerts.cautionWaypoint ? (
            <p className="rc09-note-alert" data-testid="rc09-caution-waypoint" role="alert">
              CAUTION {model.noteDistance.value}
            </p>
          ) : null}
        </section>

        {/*
          Packet 11.1 support strip, carrying packet 11.4's shift arc at its edge and packet 15's
          mechanical-warning surface. Speed, gear and water are each strictly their own channel.
        */}
        <section
          className="rc09-support"
          data-testid="rc09-support"
          data-rc09-zone="support"
          data-rc09-mechanical={model.alerts.mechanical ? 'true' : 'false'}
          style={zoneStyle(zones.support)}
          aria-label="Speed, gear, water temperature and shift arc"
        >
          <ShiftArc leds={model.leds} />
          <div className="rc09-support-row">
            <Mini label="SPEED" unit="KM/H" value={model.speed} description="Speed" zone="speed" />
            <Mini label="GEAR" value={model.gear} description="Gear" zone="gear" />
            <Mini
              label="WATER"
              unit="degC"
              value={model.water}
              description="Water temperature"
              zone="water"
              faulted={model.mechanicalFaults.includes('WATER')}
            />
          </div>
          {model.alerts.mechanical ? (
            <p className="rc09-support-alert" data-testid="rc09-mechanical" role="alert">
              {`${model.mechanicalFaults.join(' ')} WARNING`}
            </p>
          ) : null}
        </section>

        {/*
          Packet 12.1 `stage-profile-reveal`: the app width buys a MEASURED severity profile of the
          notes the roadbook actually delivered. An ungraded call keeps a flat neutral stub and a
          stretch the crew never received leaves a real gap; with no roadbook at all the strip says
          so in words rather than drawing a plausible stage.
        */}
        {showApp ? (
          <section
            className="rc09-profile"
            data-testid="rc09-profile"
            data-rc09-zone="profile"
            data-rc09-bars={profile.length}
            style={zoneStyle(zones.profile)}
            aria-label="Stage severity profile from the loaded roadbook"
          >
            <span className="rc09-label">STAGE PROFILE</span>
            {profile.length > 0 ? (
              <div className="rc09-profile-track" data-testid="rc09-profile-track">
                {profile.map((bar) => (
                  <ProfileBar key={`${bar.sequence}-${bar.text}`} bar={bar} />
                ))}
              </div>
            ) : (
              <p className="rc09-profile-empty" data-testid="rc09-profile-empty">
                NO ROADBOOK
              </p>
            )}
          </section>
        ) : null}
      </main>
    </div>
  )
}
