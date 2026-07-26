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
  RC07_RADAR_RANGES_M,
  RC07_RADAR_RANGE_EVENT,
  Rc07AuxBuffer,
  type Rc07Blip,
  Rc07ClosingTracker,
  type Rc07DashboardModel,
  type Rc07Field,
  type Rc07GapPanel,
  type Rc07Rect,
  type Rc07TowerRow,
  advanceRc07Alerts,
  clearInvalidRc07Alerts,
  createRc07AlertState,
  createRc07DashboardModel,
  rc07AlertInputForModel,
  rc07AlertLines,
  rc07AuxChannelValue,
  rc07BlipDescription,
  rc07ClassLabel,
  rc07ClassTone,
  rc07CompactModeForContentBox,
  rc07GapDescription,
  rc07Interval,
  rc07LayoutForContentBox,
  rc07Percent,
  rc07PhoneGeometryForContentBox,
  rc07RangeIndexFromEvent,
  rc07ZoneStyle,
  rc07ZonesForLayout
} from './raceconRc07Core'
import './raceconRc07.css'

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

function zoneStyle(rect: Rc07Rect | undefined): CSSProperties | undefined {
  const style = rc07ZoneStyle(rect)
  return style ? (style as CSSProperties) : undefined
}

/** One self-strip cell: an uppercase label above its value, packet 11.2's label-to-value ratio. */
function SelfCell({
  label,
  value,
  description,
  zone
}: {
  label: string
  value: Rc07Field
  description?: string
  zone: string
}): ReactElement {
  return (
    <div className="rc07-cell" data-testid="rc07-cell" data-rc07-cell={zone}>
      <span className="rc07-label">{label}</span>
      <output
        className={`rc07-value${value.stale ? ' is-stale' : ''}${value.unavailable ? ' is-unavailable' : ''}`}
        data-tone={value.tone}
        aria-label={rc01FieldDescription(description ?? label, value)}
      >
        {value.value}
      </output>
    </div>
  )
}

/**
 * A class badge. Packet 19: the letter and the badge outline carry the class, so the hue is
 * never the only channel, and an unknown class shows the dash rather than a guessed letter.
 */
function ClassBadge({ code, label, tone }: { code: string | null; label: string; tone: string }): ReactElement {
  return (
    <span
      className="rc07-class-badge"
      data-testid="rc07-class-badge"
      data-rc07-class={code ?? 'unknown'}
      data-tone={tone}
      aria-label={code === null ? 'Class unknown' : `Class ${code}`}
    >
      {label}
    </span>
  )
}

/**
 * A gap panel: class badge, the interval hero and the direction glyph.
 *
 * Packet contradiction 2 lives here. Sections 11.1 and 15 reference a closing rate that
 * section 16 defines no channel for, so the glyph is derived from the SIGN of the interval's
 * first difference and carries no numeral at all; its meaning is spelled out in text for
 * assistive technology instead of being implied by an unlabelled arrow.
 */
function GapPanel({
  label,
  panel,
  zone,
  style,
  testId
}: {
  label: string
  panel: Rc07GapPanel
  zone: 'behind' | 'ahead'
  style?: CSSProperties
  testId: string
}): ReactElement {
  return (
    <section
      className="rc07-gap"
      data-testid={testId}
      data-rc07-zone={zone}
      data-rc07-class={panel.classCode ?? 'unknown'}
      data-rc07-direction={panel.direction}
      data-rc07-highlight={panel.highlight ? 'true' : 'false'}
      style={style}
      aria-label={rc07GapDescription(label, panel)}
    >
      <span className="rc07-label rc07-gap-label">{label}</span>
      <div className="rc07-gap-line">
        <ClassBadge code={panel.classCode} label={panel.classLabel} tone={panel.classTone} />
        <output
          className={`rc07-gap-value${panel.field.stale ? ' is-stale' : ''}${panel.field.unavailable ? ' is-unavailable' : ''}`}
          data-testid={`${testId}-value`}
          data-tone={panel.field.tone}
          aria-label={rc01FieldDescription(`${label} interval`, panel.field)}
        >
          {panel.field.value}
        </output>
        <span className="rc07-unit" aria-hidden="true">
          S
        </span>
        <span
          className="rc07-direction"
          data-testid={`${testId}-direction`}
          data-rc07-direction={panel.direction}
          title={panel.directionLabel}
          aria-label={panel.directionLabel}
          role="img"
        >
          {panel.directionGlyph}
        </span>
      </div>
    </section>
  )
}

/** One radar contact. Its radius was computed from its distance; nothing here is traced. */
function RadarBlip({ blip }: { blip: Rc07Blip }): ReactElement {
  return (
    <span
      className="rc07-blip"
      data-testid="rc07-blip"
      data-rc07-class={blip.classCode ?? 'unknown'}
      data-tone={rc07ClassTone(blip.classCode)}
      data-rc07-side={blip.side}
      data-rc07-longitudinal={blip.longitudinal}
      data-rc07-critical={blip.critical ? 'true' : 'false'}
      data-rc07-radius={blip.radiusUnits.toFixed(2)}
      data-rc07-rank={blip.rank}
      style={{ left: rc07Percent(blip.xPercent), top: rc07Percent(blip.yPercent) }}
      aria-label={rc07BlipDescription(blip)}
      role="img"
    >
      <span className="rc07-blip-arrow" aria-hidden="true">
        {blip.arrow}
      </span>
      <span className="rc07-blip-code" aria-hidden="true">
        {rc07ClassLabel(blip.classCode)}
      </span>
    </span>
  )
}

/** One nearest-cars tower row, app-only per packet 12.1. */
function TowerRow({ row }: { row: Rc07TowerRow }): ReactElement {
  return (
    <li className="rc07-tower-row" data-testid="rc07-tower-row" data-rc07-class={row.classCode ?? 'unknown'}>
      <ClassBadge code={row.classCode} label={row.classLabel} tone={row.classTone} />
      <span className="rc07-tower-car" aria-hidden="true">
        {row.carNumber}
      </span>
      <output
        className="rc07-tower-gap"
        data-tone={row.gapField.tone}
        aria-label={rc01FieldDescription(`Car ${row.carNumber} interval`, row.gapField)}
      >
        {row.gapField.value}
      </output>
    </li>
  )
}

/**
 * RC-07 is an overlay-widget-owned, live-only multiclass awareness display. It shares RC-01's
 * fail-closed ingest buffer, so mock and replay telemetry are refused and a source or session
 * discontinuity clears the measured closing-interval window and every latched alert.
 */
export interface RaceconRc07DashWidgetProps extends WidgetProps {
  monotonicClock?: Rc01MonotonicClock
}

export function RaceconRc07DashWidget({
  snapshot,
  config,
  monotonicClock = rc01MonotonicNow
}: RaceconRc07DashWidgetProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const bufferRef = useRef(new Rc01LiveTelemetryBuffer())
  const auxRef = useRef(new Rc07AuxBuffer())
  const closingRef = useRef(new Rc07ClosingTracker())
  const alertsRef = useRef(createRc07AlertState())
  const [nowMs, setNowMs] = useState(() => monotonicClock())
  const [rangeIndex, setRangeIndex] = useState<number | 'auto'>('auto')
  const box = useContentBox(rootRef, config)

  // A receipt timestamp, not a display clock: it advances only when a new snapshot object or
  // provider timestamp arrives, so a freshness tick cannot make a stale frame look fresh.
  const arrivalMs = useMemo(() => monotonicClock(), [monotonicClock, snapshot, snapshot?.timestamp])

  // Rendering mutates isolated candidates only; they are committed in the layout phase so
  // StrictMode double-renders and abandoned concurrent renders cannot advance real state.
  const candidate = bufferRef.current.clone()
  const outcome = candidate.ingest(snapshot, arrivalMs)
  const aux = auxRef.current.clone()
  const closing = closingRef.current.clone()
  if (outcome.accepted) {
    const accepted = candidate.latestSnapshot()
    aux.ingest(accepted, arrivalMs)
    // The closing window is MEASURED from this frame's own interval channels, so a frame whose
    // timing feed was silent records a null rather than reusing an older interval.
    closing.observe({
      nowMs: arrivalMs,
      behind: accepted ? rc07Interval(rc07AuxChannelValue(accepted, 'gapBehind')) : null,
      ahead: accepted ? rc07Interval(rc07AuxChannelValue(accepted, 'gapAhead')) : null
    })
  } else if (!outcome.renderable) {
    // Fail closed: anything the buffer refuses also invalidates the aux receipts and the
    // measured closing window, so a new source never inherits the previous car's traffic.
    aux.reset()
    closing.reset()
  }

  const renderSnapshot = outcome.renderable ? candidate.latestSnapshot() : null
  const behindDirection = closing.direction('behind')
  const aheadDirection = closing.direction('ahead')

  // Two passes: the first builds the model the alert layer reads, the second re-renders it
  // with whatever the alert layer actually latched, so no surface can escalate for an alert
  // that was cleared in the same frame.
  const provisional = createRc07DashboardModel(renderSnapshot, candidate.receipts(), aux.receipts(), nowMs, {
    alerts: alertsRef.current,
    rangeIndex,
    behindDirection,
    aheadDirection
  })
  const advanced = advanceRc07Alerts(
    alertsRef.current,
    rc07AlertInputForModel(provisional, closing.rate('behind'), nowMs)
  )
  const alerts = clearInvalidRc07Alerts(advanced, provisional)
  const model: Rc07DashboardModel = createRc07DashboardModel(
    renderSnapshot,
    candidate.receipts(),
    aux.receipts(),
    nowMs,
    { alerts, rangeIndex, behindDirection, aheadDirection }
  )

  const layout = rc07LayoutForContentBox(box.width, box.height)
  const compactMode = rc07CompactModeForContentBox(box.width, box.height)
  const zones = rc07ZonesForLayout(layout, compactMode)
  const phoneGeometry = rc07PhoneGeometryForContentBox(box.width, box.height)
  const alertLines = rc07AlertLines(model)

  const responsiveStyle = {
    '--rc07-radar-inner': `${(model.radar.innerRingUnits / model.radar.plotUnits) * 100}%`,
    '--rc07-radar-outer': `${(model.radar.outerRingUnits / model.radar.plotUnits) * 100}%`,
    ...(phoneGeometry
      ? {
          '--rc07-phone-inset': `${phoneGeometry.inset}px`,
          '--rc07-phone-flag-height': `${phoneGeometry.flagHeight}px`,
          '--rc07-phone-radar-size': `${phoneGeometry.radarSize}px`,
          '--rc07-phone-gap-height': `${phoneGeometry.gapHeight}px`,
          '--rc07-phone-self-height': `${phoneGeometry.selfHeight}px`,
          '--rc07-phone-soft-key-size': `${phoneGeometry.softKeySize}px`
        }
      : {})
  } as CSSProperties

  useLayoutEffect(() => {
    bufferRef.current = candidate
    auxRef.current = aux
    closingRef.current = closing
    alertsRef.current = alerts
  }, [candidate, aux, closing, alerts])

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(monotonicClock()), 100)
    return () => window.clearInterval(timer)
  }, [monotonicClock])

  // Packet 11.5: a soft-key toggles the radar range. Packet 11.1 allocates it no legend zone,
  // so the key is bound and unlabelled. An unrecognised payload never changes the range.
  useEffect(() => {
    const handler = (event: Event): void => {
      const next = rc07RangeIndexFromEvent((event as CustomEvent).detail)
      if (next !== null) setRangeIndex(next)
    }
    window.addEventListener(RC07_RADAR_RANGE_EVENT, handler)
    return () => window.removeEventListener(RC07_RADAR_RANGE_EVENT, handler)
  }, [])

  const cycleRange = useCallback(() => {
    setRangeIndex((current) =>
      current === 'auto' ? 0 : current + 1 >= RC07_RADAR_RANGES_M.length ? 'auto' : current + 1
    )
  }, [])

  const showTower = layout === 'app'
  const criticalSide = model.alerts.imminent ? model.radar.criticalSide : null

  return (
    <div
      ref={rootRef}
      className="rc07-widget"
      data-widget="raceconRc07Dash"
      data-rc07-layout={layout}
      data-rc07-compact-mode={layout === 'compact' ? compactMode : undefined}
      data-rc07-buffer-state={outcome.reason}
      data-rc07-radar={model.radar.available ? 'live' : 'no-data'}
      data-rc07-radar-range={model.radar.rangeM}
      data-rc07-radar-range-source={model.radar.rangeSource}
      data-rc07-flag={model.flag.code ?? 'no-signal'}
      data-rc07-alerts={alertLines.length > 0 ? 'active' : 'silent'}
      data-rc07-alert-keys={alertLines.join(',')}
      data-rc07-critical-side={criticalSide ?? 'none'}
      data-rc07-content-width={Math.round(box.width)}
      data-rc07-content-height={Math.round(box.height)}
      style={responsiveStyle}
    >
      <main
        className="rc07-dashboard"
        aria-label="RaceCon RC-07 blue flags, dense traffic and multiclass awareness"
        data-rc07-native-size={layout === 'native' ? '800x480' : undefined}
      >
        {/*
          Packet 11.1 flag ribbon. Packet section 16 forbids assuming green: a missing or
          unrecognised race-control feed renders NO SIGNAL, and the BLUE gate chip and its
          yield arrow appear only while the packet 15 duty alert is latched.
        */}
        <section
          className="rc07-flag"
          data-testid="rc07-flag"
          data-rc07-zone="flag"
          data-rc07-flag={model.flag.code ?? 'no-signal'}
          data-tone={model.flag.tone}
          data-rc07-duty={model.flag.duty ? 'true' : 'false'}
          style={zoneStyle(zones.flag)}
          aria-label={`Track flag ${model.flag.label}`}
        >
          <span className="rc07-label">FLAG</span>
          <output
            className={`rc07-flag-state${model.flag.stale ? ' is-stale' : ''}${model.flag.unavailable ? ' is-unavailable' : ''}`}
            data-testid="rc07-flag-state"
            data-tone={model.flag.tone}
          >
            {model.flag.label}
          </output>
          {model.alerts.blueFlag ? (
            <span className="rc07-flag-duty" data-testid="rc07-flag-duty" role="alert">
              <span className="rc07-flag-duty-word">BLUE</span>
              <span className="rc07-flag-duty-arrow" aria-hidden="true">
                {model.spotter.zone === 'right' ? '\u25C0' : '\u25B6'}
              </span>
              <span className="rc07-sr">
                {model.spotter.zone === 'right' ? 'yield left' : 'yield right'}
              </span>
            </span>
          ) : null}
        </section>

        {/*
          Packet 11.1 radar. Every blip's radius is computed arithmetically from its own
          distance and then separated by rank, so the ordering can never collapse the way
          reference attempts 001 and 003 did. An absent radar source hides the plot and shows
          NO DATA — a phantom car is never drawn.
        */}
        <section
          className="rc07-radar"
          data-testid="rc07-radar"
          data-rc07-zone="radar"
          data-rc07-status={model.radar.available ? 'live' : 'no-data'}
          data-rc07-contacts={model.radar.contactCount}
          data-rc07-critical-side={criticalSide ?? 'none'}
          style={zoneStyle(zones.radar)}
          aria-label="Proximity radar"
        >
          <header className="rc07-radar-head">
            <span className="rc07-label">RADAR</span>
            <span
              className="rc07-spotter"
              data-testid="rc07-spotter"
              data-rc07-spotter={model.spotter.zone ?? 'no-data'}
            >
              {model.spotter.label}
            </span>
          </header>
          {model.radar.available ? (
            <div
              className="rc07-radar-plot"
              data-testid="rc07-radar-plot"
              // The soft-key has no packet legend zone, so it is the plot itself.
              onClick={cycleRange}
              role="presentation"
            >
              <span className="rc07-ring rc07-ring-inner" data-testid="rc07-ring" data-rc07-ring="inner" aria-hidden="true" />
              <span className="rc07-ring rc07-ring-outer" data-testid="rc07-ring" data-rc07-ring="outer" aria-hidden="true" />
              <span className="rc07-own-car" data-testid="rc07-own-car" aria-hidden="true" />
              {model.radar.blips.map((blip, index) => (
                <RadarBlip key={`${blip.carIdx ?? 'x'}-${index}`} blip={blip} />
              ))}
            </div>
          ) : (
            <p className="rc07-radar-nodata" data-testid="rc07-radar-nodata">
              NO DATA
            </p>
          )}
          {model.alerts.imminent ? (
            <span
              className="rc07-radar-edge"
              data-testid="rc07-radar-edge"
              data-rc07-side={model.radar.criticalSide ?? 'none'}
              role="alert"
            >
              <span className="rc07-sr">Imminent proximity {model.radar.criticalSide}</span>
            </span>
          ) : null}
        </section>

        <GapPanel
          label="BEHIND"
          panel={model.behind}
          zone="behind"
          style={zoneStyle(zones.behind)}
          testId="rc07-behind"
        />
        <GapPanel
          label="AHEAD"
          panel={model.ahead}
          zone="ahead"
          style={zoneStyle(zones.ahead)}
          testId="rc07-ahead"
        />

        {/*
          Packet 11.1 self strip: the driver's own numbers are deliberately tertiary here. The
          app canvas (packet 12.1) is taller and additionally carries the flag word, speed and
          fuel laps, all of which read their own truth-table dash state.
        */}
        <section
          className="rc07-self"
          data-testid="rc07-self"
          data-rc07-zone="self"
          style={zoneStyle(zones.self)}
          aria-label="Own position, delta and gear"
        >
          <SelfCell label="POS" value={model.position} description="Race position" zone="position" />
          <SelfCell label="DELTA" value={model.delta} description="Delta to best lap" zone="delta" />
          <SelfCell label="GEAR" value={model.gear} description="Gear" zone="gear" />
          {showTower ? (
            <>
              <SelfCell label="SPEED" value={model.speed} description="Speed" zone="speed" />
              <SelfCell label="FUEL" value={model.fuelLaps} description="Fuel laps remaining" zone="fuel" />
              <div className="rc07-cell" data-testid="rc07-cell" data-rc07-cell="flag">
                <span className="rc07-label">FLAG</span>
                <output
                  className={`rc07-value${model.flag.unavailable ? ' is-unavailable' : ''}`}
                  data-tone={model.flag.tone}
                  aria-label={`Track flag ${model.flag.label}`}
                >
                  {model.flag.label}
                </output>
              </div>
            </>
          ) : null}
        </section>

        {/*
          Packet 12.1 tower-reveal: the width buys a class-coded nearest-cars tower that the
          800x480 canvas cannot fit. It is a TIMING tower — the rows are the timing feed's own
          intervals to the player — so it is empty rather than reconstructed from the radar.
        */}
        {showTower ? (
          <section
            className="rc07-tower"
            data-testid="rc07-tower"
            data-rc07-zone="tower"
            data-rc07-rows={model.tower.length}
            style={zoneStyle(zones.tower)}
            aria-label="Nearest cars by interval"
          >
            <span className="rc07-label">NEAREST</span>
            {model.towerAvailable ? (
              <ol className="rc07-tower-list">
                {model.tower.map((row, index) => (
                  <TowerRow key={`${row.carIdx ?? 'x'}-${index}`} row={row} />
                ))}
              </ol>
            ) : (
              <p className="rc07-tower-empty" data-testid="rc07-tower-empty">
                --
              </p>
            )}
          </section>
        ) : null}
      </main>
    </div>
  )
}
