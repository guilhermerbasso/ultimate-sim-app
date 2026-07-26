import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { WidgetProps } from './types'
import { raceconDisplayClockFrozen, useRaceconDisplayClock } from './raceconDisplayClock'
import {
  Rc01LiveTelemetryBuffer,
  type Rc01MonotonicClock,
  advanceRc01Alerts,
  createRc01AlertState,
  createRc01DashboardModel,
  rc01FieldDescription,
  rc01MonotonicNow
} from './raceconRc01Core'
import {
  RC10_ALERT_WORDS,
  RC10_SHIFT_BAR_HEIGHT_PX,
  RC10_TYPE_SCALE_PX,
  Rc10AuxBuffer,
  type Rc10DashboardModel,
  type Rc10Field,
  type Rc10FuelSegment,
  type Rc10Rect,
  type Rc10ShiftSegment,
  type Rc10StatusCell,
  type Rc10StatusShape,
  advanceRc10Alerts,
  clearInvalidRc10Alerts,
  createRc10AlertState,
  createRc10DashboardModel,
  rc10AlertInputForModel,
  rc10AlertLines,
  rc10CompactModeForContentBox,
  rc10DeltaDescription,
  rc10EmphasisTarget,
  rc10EmphasisZoneForLayout,
  rc10FuelDescription,
  rc10GearDescription,
  rc10LayoutForContentBox,
  rc10Percent,
  rc10PhoneGeometryForContentBox,
  rc10PlainLanguage,
  rc10RungCqw,
  rc10StatusDescription,
  rc10TypeScaleCqw,
  rc10ZoneStyle,
  rc10ZonesForLayout
} from './raceconRc10Core'
import './raceconRc10.css'

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

function zoneStyle(rect: Rc10Rect | undefined): CSSProperties | undefined {
  const style = rc10ZoneStyle(rect)
  return style ? (style as CSSProperties) : undefined
}

/**
 * The severity ladder's glyph. Shape FIRST, colour second: a hollow ring for no data, a solid
 * circle for normal, a triangle for caution and an octagon for critical. A driver with any
 * colour-vision deficiency reads the rank from the outline alone, which is the whole thesis of
 * this artifact.
 */
function StatusIcon({ shape, filled }: { shape: Rc10StatusShape; filled: boolean }): ReactElement {
  return (
    <svg
      className="rc10-icon"
      data-testid="rc10-status-icon"
      data-rc10-shape={shape}
      data-rc10-filled={filled ? 'true' : 'false'}
      viewBox="0 0 32 32"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      {shape === 'ring' ? <circle cx="16" cy="16" r="12" className="rc10-icon-hollow" /> : null}
      {shape === 'circle' ? <circle cx="16" cy="16" r="12" className="rc10-icon-solid" /> : null}
      {shape === 'triangle' ? <path d="M16 3 L30 28 H2 Z" className="rc10-icon-solid" /> : null}
      {shape === 'octagon' ? (
        <path d="M11 3 H21 L29 11 V21 L21 29 H11 L3 21 V11 Z" className="rc10-icon-solid" />
      ) : null}
    </svg>
  )
}

/**
 * Packet 11.1 and 11.4: the shift bar lives INSIDE the gear tile, above the digit. Nine segments —
 * eight ramp plus one over-rev cap — whose lit count is arithmetic, never traced. Every segment is
 * dark whenever the RPM channel is invalid or stale, and the cap lights only while the debounced
 * over-rev alert is genuinely latched.
 */
function ShiftBar({ segments, lit }: { segments: readonly Rc10ShiftSegment[]; lit: number }): ReactElement {
  return (
    <div
      className="rc10-shift"
      data-testid="rc10-shift"
      data-rc10-lit={lit}
      data-rc10-segments={segments.length}
      aria-hidden="true"
    >
      {segments.map((segment) => (
        <span
          key={segment.index}
          className={`rc10-shift-seg${segment.active ? ' is-active' : ''}${segment.kind === 'cap' ? ' is-cap' : ''}`}
          data-testid="rc10-shift-seg"
          data-rc10-seg-index={segment.index}
          data-rc10-seg-kind={segment.kind}
          data-rc10-seg-tone={segment.tone}
          data-rc10-seg-pattern={segment.pattern}
        />
      ))}
    </div>
  )
}

/**
 * Packet 11.1's segmented fuel bar. Normative override N5, and the defect that got attempt-004
 * rejected: the lit count is `floor(laps / 2.0)` and therefore always AGREES with the numeral
 * printed above it. With no measured burn rate every segment is dark and the numeral is `--`.
 */
function FuelBar({ segments, lit }: { segments: readonly Rc10FuelSegment[]; lit: number }): ReactElement {
  return (
    <div
      className="rc10-fuel-bar"
      data-testid="rc10-fuel-bar"
      data-rc10-lit={lit}
      data-rc10-segments={segments.length}
      aria-hidden="true"
    >
      {segments.map((segment) => (
        <span
          key={segment.index}
          className={`rc10-fuel-seg${segment.active ? ' is-active' : ''}`}
          data-testid="rc10-fuel-seg"
          data-rc10-seg-index={segment.index}
          data-rc10-seg-from={segment.fromLaps}
          data-rc10-seg-to={segment.toLaps}
        />
      ))}
    </div>
  )
}

/** One status cell: icon shape, label, value and unit on a single baseline. Packet 11.1. */
function StatusCell({ cell }: { cell: Rc10StatusCell }): ReactElement {
  return (
    <div
      className="rc10-status-cell"
      data-testid="rc10-status-cell"
      data-rc10-cell={cell.id}
      data-rc10-rank={cell.rank}
      data-rc10-shape={cell.rung.shape}
    >
      <StatusIcon shape={cell.rung.shape} filled={cell.rung.filled} />
      <span className="rc10-label">{cell.label}</span>
      <output
        className={`rc10-status-value${cell.value.stale ? ' is-stale' : ''}${cell.value.unavailable ? ' is-unavailable' : ''}`}
        data-testid={`rc10-${cell.id}`}
        data-tone={cell.value.tone}
        aria-label={rc10StatusDescription(cell)}
      >
        {cell.value.value}
      </output>
      {cell.unit ? <span className="rc10-unit">{cell.unit}</span> : null}
    </div>
  )
}

/**
 * RC-10 is an overlay-widget-owned, live-only accessibility-first driver display. It shares
 * RC-01's fail-closed ingest buffer, so mock and replay telemetry are refused and a source or
 * session discontinuity clears every latched alert.
 */
export interface RaceconRc10DashWidgetProps extends WidgetProps {
  monotonicClock?: Rc01MonotonicClock
}

export function RaceconRc10DashWidget({
  snapshot,
  config,
  preview,
  monotonicClock = rc01MonotonicNow
}: RaceconRc10DashWidgetProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const bufferRef = useRef(new Rc01LiveTelemetryBuffer())
  const auxRef = useRef(new Rc10AuxBuffer())
  const alertsRef = useRef(createRc10AlertState())
  const sharedAlertsRef = useRef(createRc01AlertState())
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
  if (outcome.accepted) {
    aux.ingest(candidate.latestSnapshot(), arrivalMs)
  } else if (!outcome.renderable) {
    // Fail closed: anything the buffer refuses also invalidates the aux receipts, so a new source
    // never inherits the previous session's channels.
    aux.reset()
  }

  const renderSnapshot = outcome.renderable ? candidate.latestSnapshot() : null

  // Over-rev is the SHARED RC-01 alert: packet 15's 99 % trigger, 60 ms debounce, 95 % clear and
  // 250 ms hysteresis are already implemented there, verbatim. Only the RPM inputs are supplied,
  // so no other RC-01 alert can ever engage from this widget.
  const rc01Model = createRc01DashboardModel(renderSnapshot, candidate.receipts(), nowMs)
  const sharedAlerts = advanceRc01Alerts(sharedAlertsRef.current, {
    nowMs,
    rpmRatio: rc01Model.rpmRatio,
    rpmFresh: rc01Model.rpmFresh,
    delta: null,
    deltaTwoSecondsAgo: null,
    pitLimiter: null
  })

  // Two passes: the first builds the model the alert layer reads, the second re-renders it with
  // whatever the alert layer actually latched, so no surface can escalate for an alert that was
  // cleared in the same frame.
  const provisional = createRc10DashboardModel(renderSnapshot, candidate.receipts(), aux.receipts(), nowMs, {
    alerts: alertsRef.current,
    sharedAlerts
  })
  const advanced = advanceRc10Alerts(alertsRef.current, rc10AlertInputForModel(provisional, nowMs))
  const alerts = clearInvalidRc10Alerts(advanced, provisional)
  const model: Rc10DashboardModel = createRc10DashboardModel(
    renderSnapshot,
    candidate.receipts(),
    aux.receipts(),
    nowMs,
    { alerts, sharedAlerts }
  )

  const layout = rc10LayoutForContentBox(box.width, box.height)
  const compactMode = rc10CompactModeForContentBox(box.width, box.height)
  const zones = rc10ZonesForLayout(layout, compactMode)
  const phoneGeometry = rc10PhoneGeometryForContentBox(box.width, box.height)
  const alertLines = rc10AlertLines(model)
  const showApp = layout === 'app'
  const plain = rc10PlainLanguage(model)
  // Packet 11.5: only ONE tile may be emphasised at a time, and none while the layer is silent.
  const emphasis = rc10EmphasisZoneForLayout(rc10EmphasisTarget(model), layout)

  // Packet 11.2 rungs, capped by each zone's own arithmetic fit so a hero numeral cannot escape
  // its zone. The delta value gets its own column because the tile also carries the pattern block,
  // the chevron and the unit.
  const gearWidth = zones.gear?.width ?? 47.5
  const speedWidth = zones.speed?.width ?? 46.5
  const deltaWidth = (zones.delta?.width ?? 63.8) * 0.62
  const fuelWidth = zones.fuel?.width ?? 30.5
  const statusWidth = (zones.status?.width ?? zones.plain?.width ?? 96) / 3
  const responsiveStyle = {
    '--rc10-type-gear': `${rc10RungCqw(RC10_TYPE_SCALE_PX.gear, gearWidth, Math.max(1, model.gear.value.length))}cqw`,
    '--rc10-type-speed': `${rc10RungCqw(RC10_TYPE_SCALE_PX.speed, speedWidth, Math.max(3, model.speed.value.length))}cqw`,
    '--rc10-type-delta': `${rc10RungCqw(RC10_TYPE_SCALE_PX.delta, deltaWidth, Math.max(6, model.delta.value.length))}cqw`,
    '--rc10-type-fuel': `${rc10RungCqw(RC10_TYPE_SCALE_PX.fuel, fuelWidth, Math.max(3, model.fuel.value.length))}cqw`,
    '--rc10-type-status': `${rc10RungCqw(RC10_TYPE_SCALE_PX.status, statusWidth, 6)}cqw`,
    '--rc10-type-label': `${rc10TypeScaleCqw(RC10_TYPE_SCALE_PX.label)}cqw`,
    '--rc10-shift-bar-height': `${rc10TypeScaleCqw(RC10_SHIFT_BAR_HEIGHT_PX)}cqw`,
    ...(phoneGeometry
      ? {
          '--rc10-phone-inset': `${phoneGeometry.inset}px`,
          '--rc10-phone-shift-height': `${phoneGeometry.shiftBarHeight}px`,
          '--rc10-phone-gear-height': `${phoneGeometry.gearHeight}px`,
          '--rc10-phone-status-height': `${phoneGeometry.statusHeight}px`,
          '--rc10-phone-icon': `${phoneGeometry.iconSize}px`
        }
      : {})
  } as CSSProperties

  useLayoutEffect(() => {
    bufferRef.current = candidate
    auxRef.current = aux
    alertsRef.current = alerts
    sharedAlertsRef.current = sharedAlerts
  }, [candidate, aux, alerts, sharedAlerts])

  return (
    <div
      ref={rootRef}
      className="rc10-widget"
      data-widget="raceconRc10Dash"
      data-rc10-layout={layout}
      data-rc10-compact-mode={layout === 'compact' ? compactMode : undefined}
      data-rc10-buffer-state={outcome.reason}
      data-rc10-alerts={alertLines.length > 0 ? 'active' : 'silent'}
      data-rc10-alert-keys={alertLines.join(',')}
      data-rc10-emphasis={emphasis ?? 'none'}
      data-rc10-delta-direction={model.deltaCue.direction}
      data-rc10-content-width={Math.round(box.width)}
      data-rc10-content-height={Math.round(box.height)}
      style={responsiveStyle}
    >
      <main
        className="rc10-dashboard"
        aria-label="RaceCon RC-10 clear sight, high-contrast colour-vision-safe driver display"
        data-rc10-native-size={layout === 'native' ? '800x480' : undefined}
      >
        {/*
          Packet 11.1 gear tile — the hero of the whole display, with the shift bar inset above the
          digit and the label in the bottom-left corner. Packet 15's over-rev surface lives here:
          the solid cap segment plus, per packet 7 and 11.5, the word that keeps the state readable
          without any colour perception at all.
        */}
        <section
          className={`rc10-tile rc10-gear${emphasis === 'gear' ? ' is-emphasised' : ''}`}
          data-testid="rc10-gear"
          data-rc10-zone="gear"
          data-rc10-emphasised={emphasis === 'gear' ? 'true' : 'false'}
          style={zoneStyle(zones.gear)}
          aria-label="Gear and shift indicator"
        >
          <ShiftBar segments={model.shiftSegments} lit={model.shiftLitRamp} />
          <output
            className={`rc10-gear-value${model.gear.stale ? ' is-stale' : ''}${model.gear.unavailable ? ' is-unavailable' : ''}`}
            data-testid="rc10-gear-value"
            data-tone={model.gear.tone}
            aria-label={rc10GearDescription(model)}
          >
            {model.gear.value}
          </output>
          <span className="rc10-label rc10-gear-label">GEAR</span>
          {model.alerts.overRev ? (
            <p className="rc10-alert-word" data-testid="rc10-over-rev" role="alert">
              {RC10_ALERT_WORDS.overRev}
            </p>
          ) : null}
        </section>

        {/* Packet 11.1 speed tile. Packet 16: km/h from its own source, never RPM times a ratio. */}
        <section
          className="rc10-tile rc10-speed"
          data-testid="rc10-speed"
          data-rc10-zone="speed"
          style={zoneStyle(zones.speed)}
          aria-label="Speed"
        >
          <span className="rc10-label">SPEED</span>
          <output
            className={`rc10-speed-value${model.speed.stale ? ' is-stale' : ''}${model.speed.unavailable ? ' is-unavailable' : ''}`}
            data-testid="rc10-speed-value"
            data-tone={model.speed.tone}
            aria-label={rc01FieldDescription('Speed', model.speed)}
          >
            {model.speed.value}
          </output>
          <span className="rc10-unit rc10-speed-unit">KM/H</span>
        </section>

        {/*
          Packet 11.1 delta tile, deliberately 2.1x the fuel tile because delta to best is primary
          and fuel laps is secondary. Packet 19's redundancy: an explicit sign character, an
          up/down chevron, a fill pattern (diagonal hatch faster, dotted slower) and a hue — three
          of the four survive total colour blindness.
        */}
        <section
          className="rc10-tile rc10-delta"
          data-testid="rc10-delta"
          data-rc10-zone="delta"
          data-rc10-delta-direction={model.deltaCue.direction}
          data-rc10-delta-pattern={model.deltaCue.pattern}
          style={zoneStyle(zones.delta)}
          aria-label="Delta to best lap"
        >
          <span
            className="rc10-delta-pattern"
            data-testid="rc10-delta-pattern"
            data-rc10-pattern={model.deltaCue.pattern}
            aria-hidden="true"
          />
          <div className="rc10-delta-body">
            <span className="rc10-label">DELTA</span>
            <div className="rc10-delta-row">
              <span
                className="rc10-chevron"
                data-testid="rc10-delta-chevron"
                data-rc10-chevron={model.deltaCue.chevron}
                aria-hidden="true"
              />
              <output
                className={`rc10-delta-value${model.delta.stale ? ' is-stale' : ''}${model.delta.unavailable ? ' is-unavailable' : ''}`}
                data-testid="rc10-delta-value"
                data-tone={model.delta.tone}
                aria-label={rc10DeltaDescription(model)}
              >
                {model.delta.value}
              </output>
              <span className="rc10-unit">S</span>
            </div>
          </div>
        </section>

        {/*
          Packet 11.1 fuel tile. Packet 19's redundancy: the segment count, the numeral and the
          word LAPS all state the same quantity, and the bar can never disagree with the numeral.
          Packet 15's fuel-low surface — triangle icon plus the word — lives here.
        */}
        <section
          className={`rc10-tile rc10-fuel${emphasis === 'fuel' ? ' is-emphasised' : ''}`}
          data-testid="rc10-fuel"
          data-rc10-zone="fuel"
          data-rc10-emphasised={emphasis === 'fuel' ? 'true' : 'false'}
          data-rc10-fuel-lit={model.fuelLitSegments}
          style={zoneStyle(zones.fuel)}
          aria-label="Fuel laps remaining"
        >
          <span className="rc10-label">FUEL</span>
          <div className="rc10-fuel-row">
            {model.alerts.fuelLow ? <StatusIcon shape="triangle" filled /> : null}
            <output
              className={`rc10-fuel-value${model.fuel.stale ? ' is-stale' : ''}${model.fuel.unavailable ? ' is-unavailable' : ''}`}
              data-testid="rc10-fuel-value"
              data-tone={model.fuel.tone}
              aria-label={rc10FuelDescription(model)}
            >
              {model.fuel.value}
            </output>
            <span className="rc10-unit">LAPS</span>
          </div>
          <FuelBar segments={model.fuelSegments} lit={model.fuelLitSegments} />
          {model.alerts.fuelLow ? (
            <p className="rc10-alert-word" data-testid="rc10-fuel-low" role="alert">
              {RC10_ALERT_WORDS.fuelLow}
            </p>
          ) : null}
        </section>

        {/*
          Packet 11.1 status row: three equal cells of icon, label, value and unit. Packet 15's
          overheat surface — octagon icon plus the word HOT — lives here. At 1024x600 this row has
          no packet 12.1 zone (gap G1), so the plain-language line below carries the same three
          channels instead of dropping them.
        */}
        {zones.status ? (
          <section
            className={`rc10-tile rc10-status${emphasis === 'status' ? ' is-emphasised' : ''}`}
            data-testid="rc10-status"
            data-rc10-zone="status"
            data-rc10-emphasised={emphasis === 'status' ? 'true' : 'false'}
            style={zoneStyle(zones.status)}
            aria-label="Position, water temperature and traction control"
          >
            {model.statusCells.map((cell) => (
              <StatusCell key={cell.id} cell={cell} />
            ))}
            {model.alerts.overheat ? (
              <p className="rc10-alert-word rc10-status-alert" data-testid="rc10-overheat" role="alert">
                {RC10_ALERT_WORDS.overheat}
              </p>
            ) : null}
          </section>
        ) : null}

        {/*
          Packet 12.1 `legibility-grow-reveal`: the app width buys BIGGER TILES and ONE plain
          language status sentence — never a new channel, never a denser grid. Gap G1's resolution
          lives here too: position, water and TC keep their cells and their icon ranks, because
          section 12.1 gives them no zone of their own and dropping them would be silent data loss.
        */}
        {showApp ? (
          <section
            className={`rc10-tile rc10-plain${emphasis === 'plain' ? ' is-emphasised' : ''}`}
            data-testid="rc10-plain"
            data-rc10-zone="plain"
            data-rc10-emphasised={emphasis === 'plain' ? 'true' : 'false'}
            data-rc10-carried={plain.carried.join(',')}
            style={zoneStyle(zones.plain)}
            aria-label="Plain-language status, position, water temperature and traction control"
          >
            <p className="rc10-plain-headline" data-testid="rc10-plain-headline">
              {plain.headline}
            </p>
            <div className="rc10-plain-cells">
              {model.statusCells.map((cell) => (
                <StatusCell key={cell.id} cell={cell} />
              ))}
            </div>
            {model.alerts.overheat ? (
              <p className="rc10-alert-word rc10-status-alert" data-testid="rc10-overheat" role="alert">
                {RC10_ALERT_WORDS.overheat}
              </p>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  )
}

export type { Rc10Field }
