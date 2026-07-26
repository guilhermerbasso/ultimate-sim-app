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
  RC20_GRID_STRIP_CELL_COUNT,
  RC20_LADDER_BAR_COUNT,
  RC20_LAUNCH_CONTROL_EVENT,
  RC20_MODES,
  RC20_TYPE_SCALE_PX,
  RC20_TYPE_WEIGHTS,
  RC20_WARMUP_TARGET_C,
  Rc20AuxBuffer,
  type Rc20DashboardModel,
  type Rc20Field,
  type Rc20LaunchControl,
  Rc20LaunchReviewBuffer,
  type Rc20Rect,
  type Rc20WarmupCell,
  advanceRc20Alerts,
  clearInvalidRc20Alerts,
  createRc20AlertState,
  createRc20DashboardModel,
  createRc20LaunchControl,
  rc20AlertInputForModel,
  rc20AlertLines,
  rc20CompactModeForContentBox,
  rc20LaunchControlFromEvent,
  rc20LayoutForContentBox,
  rc20Percent,
  rc20StageIsReleased,
  rc20TypeScaleCqw,
  rc20WarmupDescription,
  rc20ZoneStyle,
  rc20ZonesForLayout
} from './raceconRc20Core'
import './raceconRc20.css'

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

function zoneStyle(rect: Rc20Rect | undefined): CSSProperties | undefined {
  const style = rc20ZoneStyle(rect)
  return style ? (style as CSSProperties) : undefined
}

/** One grid-strip cell. Override NO-7 caps the strip at exactly eight of these. */
function StripCell({
  label,
  value,
  description,
  cold,
  testid
}: {
  label: string
  value: Rc20Field | null
  description?: string
  cold?: boolean
  testid: string
}): ReactElement {
  return (
    <div
      className={`rc20-strip-cell${cold ? ' is-cold' : ''}`}
      data-testid="rc20-strip-cell"
      data-rc20-cell={testid}
      data-rc20-cold={cold ? 'true' : 'false'}
    >
      <span className="rc20-label">{label}</span>
      {value ? (
        <output
          className={`rc20-strip-value${value.stale ? ' is-stale' : ''}${value.unavailable ? ' is-unavailable' : ''}`}
          data-testid={`rc20-strip-${testid}`}
          data-tone={value.tone}
          aria-label={rc01FieldDescription(description ?? label, value)}
        >
          {value.value}
        </output>
      ) : null}
    </div>
  )
}

/**
 * One warm-up tile in the 1024x600 map. The measured temperature is telemetry; the target
 * beside it is DECLARED CONFIGURATION (gap G-4) and says so, so the two can never be confused.
 */
function WarmupTile({ cell }: { cell: Rc20WarmupCell }): ReactElement {
  return (
    <div
      className={`rc20-warmup-tile${cell.cold ? ' is-cold' : ''}`}
      data-testid="rc20-warmup-tile"
      data-rc20-location={cell.location}
      data-rc20-kind={cell.kind}
      data-rc20-cold={cell.cold ? 'true' : 'false'}
    >
      <span className="rc20-label">{cell.location}</span>
      <output
        className={`rc20-warmup-value${cell.field.stale ? ' is-stale' : ''}${cell.field.unavailable ? ' is-unavailable' : ''}`}
        data-testid={`rc20-warmup-${cell.kind}-${cell.location}`}
        data-tone={cell.field.tone}
        aria-label={rc20WarmupDescription(cell)}
      >
        {cell.field.value}
      </output>
      <span className="rc20-warmup-target" data-testid="rc20-warmup-target">
        {`TGT ${cell.targetC}`}
      </span>
    </div>
  )
}

/**
 * RC-20 is an overlay-widget-owned, live-only race-start display. It shares RC-01's fail-closed
 * ingest buffer, so mock and replay telemetry are refused and a source or session discontinuity
 * clears the measured launch review and every latched alert.
 */
export interface RaceconRc20DashWidgetProps extends WidgetProps {
  monotonicClock?: Rc01MonotonicClock
}

export function RaceconRc20DashWidget({
  snapshot,
  config,
  preview,
  monotonicClock = rc01MonotonicNow
}: RaceconRc20DashWidgetProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const bufferRef = useRef(new Rc01LiveTelemetryBuffer())
  const auxRef = useRef(new Rc20AuxBuffer())
  const reviewRef = useRef(new Rc20LaunchReviewBuffer())
  const alertsRef = useRef(createRc20AlertState())
  // A preview is one static snapshot with no IPC behind it, so its clock is frozen at mount:
  // a ticking clock would walk a start sequence past its own debounce windows and mutate the
  // rendered text with no new data. Any non-live render freezes.
  const nowMs = useRaceconDisplayClock(monotonicClock, raceconDisplayClockFrozen(preview))
  const [control, setControl] = useState<Rc20LaunchControl>(createRc20LaunchControl)
  const box = useContentBox(rootRef, config)

  // A receipt timestamp, not a display clock: it advances only when a new snapshot object or
  // provider timestamp arrives, so a freshness tick cannot make a stale frame look fresh.
  const arrivalMs = useMemo(() => monotonicClock(), [monotonicClock, snapshot, snapshot?.timestamp])

  // Rendering mutates isolated candidates only; they are committed in the layout phase so
  // StrictMode double-renders and abandoned concurrent renders cannot advance real state.
  const candidate = bufferRef.current.clone()
  const outcome = candidate.ingest(snapshot, arrivalMs)
  const aux = auxRef.current.clone()
  const review = reviewRef.current.clone()
  if (outcome.accepted) {
    aux.ingest(candidate.latestSnapshot(), arrivalMs)
  } else if (!outcome.renderable) {
    // Fail closed: anything the buffer refuses also invalidates the aux receipts and the
    // measured launch review, so a new source never inherits the previous car's start.
    aux.reset()
    review.reset()
  }

  const renderSnapshot = outcome.renderable ? candidate.latestSnapshot() : null

  // Two passes: the first builds the model the alert layer reads, the second re-renders it with
  // whatever the alert layer actually latched, so no surface can escalate for an alert that was
  // cleared in the same frame.
  const provisional = createRc20DashboardModel(renderSnapshot, candidate.receipts(), aux.receipts(), nowMs, {
    alerts: alertsRef.current,
    control,
    review: review.review()
  })
  const advanced = advanceRc20Alerts(alertsRef.current, rc20AlertInputForModel(provisional, nowMs))
  const alerts = clearInvalidRc20Alerts(advanced, provisional)

  // The review is MEASURED: it records a reaction only when this mount saw both the frame
  // before the release AND the first movement after it. A mid-launch mount writes nothing.
  if (outcome.accepted) {
    review.observe({
      nowMs: arrivalMs,
      released: rc20StageIsReleased(provisional.stage),
      speedKmh: provisional.speedKmh,
      rpm: typeof provisional.rpm.raw === 'number' ? provisional.rpm.raw : null,
      clutchPct: provisional.clutchPct
    })
  }

  const model: Rc20DashboardModel = createRc20DashboardModel(
    renderSnapshot,
    candidate.receipts(),
    aux.receipts(),
    nowMs,
    { alerts, control, review: review.review() }
  )

  const layout = rc20LayoutForContentBox(box.width, box.height)
  const compactMode = rc20CompactModeForContentBox(box.width, box.height)
  const zones = rc20ZonesForLayout(layout, compactMode)
  const alertLines = rc20AlertLines(model)
  const showApp = layout === 'app'

  const responsiveStyle = {
    '--rc20-type-rpm': `${rc20TypeScaleCqw(RC20_TYPE_SCALE_PX.rpm)}cqw`,
    '--rc20-type-clutch': `${rc20TypeScaleCqw(RC20_TYPE_SCALE_PX.clutch)}cqw`,
    '--rc20-type-strip': `${rc20TypeScaleCqw(RC20_TYPE_SCALE_PX.strip)}cqw`,
    '--rc20-type-label': `${rc20TypeScaleCqw(RC20_TYPE_SCALE_PX.label)}cqw`,
    '--rc20-weight-rpm': String(RC20_TYPE_WEIGHTS.rpm),
    '--rc20-weight-clutch': String(RC20_TYPE_WEIGHTS.clutch),
    '--rc20-weight-strip': String(RC20_TYPE_WEIGHTS.strip),
    '--rc20-weight-label': String(RC20_TYPE_WEIGHTS.label)
  } as CSSProperties

  useLayoutEffect(() => {
    bufferRef.current = candidate
    auxRef.current = aux
    reviewRef.current = review
    alertsRef.current = alerts
  }, [candidate, aux, review, alerts])

  // Packet 11.5 / gap G-7: the launch-arm macro is a HARDWARE control with no zone on either
  // canvas, so it arrives as a window event. An unrecognised payload never changes the control,
  // so a stray event can neither arm the launch cues nor invent a launch band.
  useEffect(() => {
    const handler = (event: Event): void => {
      setControl((current) => rc20LaunchControlFromEvent((event as CustomEvent).detail, current) ?? current)
    }
    window.addEventListener(RC20_LAUNCH_CONTROL_EVENT, handler)
    return () => window.removeEventListener(RC20_LAUNCH_CONTROL_EVENT, handler)
  }, [])

  const bandLow = model.bandModel.lowFraction
  const bandHigh = model.bandModel.highFraction
  const bandVisible = bandLow !== null && bandHigh !== null && bandHigh > bandLow

  return (
    <div
      ref={rootRef}
      className="rc20-widget"
      data-widget="raceconRc20Dash"
      data-rc20-layout={layout}
      data-rc20-compact-mode={layout === 'compact' ? compactMode : undefined}
      data-rc20-buffer-state={outcome.reason}
      data-rc20-mode={model.mode ?? 'unavailable'}
      data-rc20-armed={model.armed ? 'true' : 'false'}
      data-rc20-stage={model.stage ?? 'unavailable'}
      data-rc20-lit-bars={model.ladder.litBars}
      data-rc20-start-feed={model.stage === null ? 'unavailable' : 'live'}
      data-rc20-band-source={model.bandModel.source}
      data-rc20-alerts={alertLines.length > 0 ? 'active' : 'silent'}
      data-rc20-alert-keys={alertLines.join(',')}
      data-rc20-content-width={Math.round(box.width)}
      data-rc20-content-height={Math.round(box.height)}
      style={responsiveStyle}
    >
      <main
        className="rc20-dashboard"
        aria-label="RaceCon RC-20 lights out, formation, grid and start procedure"
        data-rc20-native-size={layout === 'native' ? '800x480' : undefined}
      >
        {/*
          Packet 11.1 mode header. Packet 19 makes the spelled-out mode an accessibility
          requirement, so all three words are always present and the live one is bracketed.
          Gap G-3: packet 12.1 drops this zone entirely, so the 1024x600 ribbon adds it back and
          also carries the slot and start status the 800x480 strip carries.
        */}
        <section
          className="rc20-header"
          data-testid="rc20-header"
          data-rc20-zone="header"
          data-rc20-mode={model.mode ?? 'unavailable'}
          style={zoneStyle(zones.header)}
          aria-label="Start procedure mode"
        >
          <div className="rc20-mode-words" data-testid="rc20-mode-words">
            {RC20_MODES.map((word) => (
              <span
                key={word}
                className={`rc20-mode-word${model.mode === word ? ' is-active' : ''}`}
                data-testid="rc20-mode-word"
                data-rc20-mode-word={word}
                data-rc20-active={model.mode === word ? 'true' : 'false'}
              >
                {model.mode === word ? `[ ${word} ]` : word}
              </span>
            ))}
          </div>
          <output className="rc20-mode-state" data-testid="rc20-mode" data-rc20-mode={model.mode ?? 'unavailable'}>
            {model.modeLabel}
          </output>
          {showApp ? (
            <div className="rc20-ribbon-status" data-testid="rc20-ribbon-status">
              <StripCell label="SLOT" value={model.gridSlot} description="Grid slot" testid="ribbon-slot" />
              <StripCell label="START" value={model.startStatus} description="Start status" testid="ribbon-status" />
            </div>
          ) : null}
        </section>

        {/*
          Packet 11.1's start-light ladder — five bars, always five, lit only by a real feed.
          Section 16 is absolute: never simulate start lights, keep the ladder dark if the feed
          is absent. Section 11.5/19: it is labelled a generic TRAINING AID on every frame and
          never claims to be an official start signal.
        */}
        <section
          className="rc20-ladder"
          data-testid="rc20-ladder"
          data-rc20-zone="ladder"
          data-rc20-stage={model.stage ?? 'unavailable'}
          data-rc20-lit-bars={model.ladder.litBars}
          style={zoneStyle(zones.ladder)}
          aria-label="Generic start light ladder, training aid"
        >
          <span className="rc20-label rc20-ladder-caption" data-testid="rc20-ladder-caption">
            {model.ladder.disclaimer}
          </span>
          <div
            className="rc20-ladder-bars"
            data-testid="rc20-ladder-bars"
            data-rc20-bar-count={RC20_LADDER_BAR_COUNT}
            role="img"
            aria-label={model.ladder.stageLabel}
          >
            {model.ladder.bars.map((bar) => (
              <span
                key={bar.index}
                className={`rc20-ladder-bar${bar.lit ? ' is-lit' : ''}`}
                data-testid="rc20-ladder-bar"
                data-rc20-bar={bar.index}
                data-rc20-lit={bar.lit ? 'true' : 'false'}
              />
            ))}
          </div>
          <output
            className={`rc20-stage${model.ladder.unavailable ? ' is-unavailable' : ''}`}
            data-testid="rc20-stage"
            data-rc20-stage={model.stage ?? 'unavailable'}
          >
            {model.ladder.stageLabel}
          </output>
          <span
            className={`rc20-label rc20-feed${model.ladder.unavailable ? ' is-unavailable' : ''}`}
            data-testid="rc20-start-feed"
          >
            {model.ladder.feedLabel}
          </span>
          {/* Packet 15 jump-start surface. Silent until the trigger fires; never a decoration. */}
          {model.alerts.jumpStart ? (
            <p className="rc20-hold" data-testid="rc20-jump-start" role="alert">
              HOLD
            </p>
          ) : null}
        </section>

        {/*
          Packet 11.1 launch-RPM card. The ACTUAL is the shared RC-01 RPM projection, whose
          200 ms budget and freeze-plus-grey degradation are section 16's rule verbatim. The
          TARGET band has no ECU channel on any provider (RC20_PACKET_OMISSIONS.launchRpmTarget)
          so it stays hidden until an operator declares it, and the declared bounds are printed
          so the over-rev ceiling is auditable. Override NO-4: every edge is COMPUTED.
        */}
        <section
          className="rc20-card rc20-launch"
          data-testid="rc20-launch"
          data-rc20-zone="launch"
          data-rc20-band={model.bandModel.source}
          data-rc20-over-rev={model.alerts.launchOverRev ? 'true' : 'false'}
          style={zoneStyle(zones.launch)}
          aria-label="Launch RPM against the declared target band"
        >
          <span className="rc20-label">
            LAUNCH RPM<span className="rc20-unit">1/MIN</span>
          </span>
          <output
            className={`rc20-hero${model.rpm.stale ? ' is-stale' : ''}${model.rpm.unavailable ? ' is-unavailable' : ''}`}
            data-testid="rc20-rpm"
            data-tone={model.rpm.tone}
            aria-label={rc01FieldDescription('Engine RPM', model.rpm)}
          >
            {model.rpm.value}
          </output>
          <div className="rc20-track" data-testid="rc20-launch-track" data-rc20-scaled={model.scaleMaxRpm === null ? 'false' : 'true'}>
            {bandVisible ? (
              <span
                className="rc20-track-band"
                data-testid="rc20-launch-band"
                style={{ left: rc20Percent(bandLow! * 100), width: rc20Percent((bandHigh! - bandLow!) * 100) }}
              />
            ) : null}
            {model.rpmFraction !== null ? (
              <span
                className="rc20-track-needle"
                data-testid="rc20-launch-needle"
                style={{ left: rc20Percent(model.rpmFraction * 100) }}
              />
            ) : null}
            {/* Packet 11.4/15: the red cap is the over-rev surface and only ever the alert layer. */}
            {model.alerts.launchOverRev && bandVisible ? (
              <span className="rc20-track-cap" data-testid="rc20-over-rev-cap" style={{ left: rc20Percent(bandHigh! * 100) }} />
            ) : null}
          </div>
          <div className="rc20-card-foot">
            <span className="rc20-label" data-testid="rc20-band-label">
              {model.bandModel.label}
            </span>
            <span className="rc20-label" data-testid="rc20-scale-label">
              {model.scaleLabel}
            </span>
          </div>
          {model.alerts.launchOverRev ? (
            <p className="rc20-alert-line" data-testid="rc20-over-rev" role="alert">
              HOLD RPM
            </p>
          ) : null}
        </section>

        {/*
          Packet 11.1 clutch-bite card, the exact mirror of the launch card about x 50 %.
          Section 16: the clutch is the position sensor or the grey dash; it is never estimated.
          Override NO-4: the fill is clutchPct / 100 and agrees with the numeral beside it.
        */}
        <section
          className="rc20-card rc20-clutch"
          data-testid="rc20-clutch"
          data-rc20-zone="clutch"
          style={zoneStyle(zones.clutch)}
          aria-label="Clutch bite position"
        >
          <span className="rc20-label">
            CLUTCH<span className="rc20-unit">%</span>
          </span>
          <output
            className={`rc20-clutch-value${model.clutch.stale ? ' is-stale' : ''}${model.clutch.unavailable ? ' is-unavailable' : ''}`}
            data-testid="rc20-clutch-value"
            data-tone={model.clutch.tone}
            aria-label={rc01FieldDescription('Clutch bite percent', model.clutch)}
          >
            {model.clutch.value}
          </output>
          <div className="rc20-track" data-testid="rc20-clutch-track">
            {model.clutchFraction !== null ? (
              <span
                className="rc20-track-fill"
                data-testid="rc20-clutch-fill"
                style={{ width: rc20Percent(model.clutchFraction * 100) }}
              />
            ) : null}
          </div>
          <div className="rc20-card-foot">
            <span className="rc20-label" data-testid="rc20-clutch-scale">
              {model.clutchScaleLabel}
            </span>
          </div>
        </section>

        {/*
          Packet 11.1 grid / formation strip. Override NO-7: exactly eight cells — the slot, the
          four tyre corners, the two brake axles and one DEG C unit tag. The nine-cell row with
          group tags measures 801.6 px in a 768 px zone and does not fit. Gap G-8: the slot half
          of the packet's mixed channel has no source at all and is the grey dash for ever.
          This strip is also the cold-warm-up alert's surface on every non-app canvas.
        */}
        {!showApp ? (
          <section
            className="rc20-strip"
            data-testid="rc20-strip"
            data-rc20-zone="strip"
            data-rc20-cells={RC20_GRID_STRIP_CELL_COUNT}
            data-rc20-cold={model.alerts.coldWarmup ? 'true' : 'false'}
            style={zoneStyle(zones.strip)}
            aria-label="Grid slot and formation warm-up temperatures"
          >
            <StripCell label="SLOT" value={model.gridSlot} description="Grid slot" testid="slot" />
            {model.tyres.map((cell) => (
              <StripCell
                key={cell.location}
                label={cell.location}
                value={cell.field}
                description={`Tyre ${cell.location} temperature`}
                cold={cell.cold}
                testid={`tyre-${cell.location}`}
              />
            ))}
            {model.brakeAxles.map((cell) => (
              <StripCell
                key={cell.location}
                label={cell.location}
                value={cell.field}
                description={`Brake ${cell.location} temperature`}
                cold={cell.cold}
                testid={`brake-${cell.location}`}
              />
            ))}
            <StripCell label="DEG C" value={null} testid="unit" />
          </section>
        ) : null}

        {/*
          Packet 12.1 formation warm-up map — app only, and never present on the 800x480 canvas.
          Every corner is strictly its own sensor, including the four brake corners the eight-cell
          strip cannot fit. The target beside each measurement is DECLARED CONFIGURATION (gap
          G-4) and is captioned as such. This is the cold-warm-up alert's surface at 1024x600.
        */}
        {showApp ? (
          <section
            className="rc20-warmup"
            data-testid="rc20-warmup"
            data-rc20-zone="warmup"
            data-rc20-cold={model.alerts.coldWarmup ? 'true' : 'false'}
            style={zoneStyle(zones.warmup)}
            aria-label="Formation warm-up targets by corner"
          >
            <header className="rc20-warmup-head">
              <span className="rc20-label">
                WARM-UP MAP<span className="rc20-unit">DEG C</span>
              </span>
              <span className="rc20-label" data-testid="rc20-warmup-provenance">
                {`DECLARED TGT ${RC20_WARMUP_TARGET_C.tyreC} / ${RC20_WARMUP_TARGET_C.brakeC}`}
              </span>
            </header>
            <div className="rc20-warmup-grid" data-testid="rc20-warmup-grid">
              {model.warmup.map((cell) => (
                <WarmupTile key={`${cell.kind}-${cell.location}`} cell={cell} />
              ))}
            </div>
          </section>
        ) : null}

        {/*
          Packet 12.1 post-start launch review — app only. It is MEASURED: a reaction is recorded
          only when this mount saw the frame before the release AND the first movement after it,
          so a mid-launch mount dashes instead of misreporting the driver. Section 16 supplies no
          wheelspin channel (RC20_PACKET_OMISSIONS.wheelspinReview), so none is ever published.
        */}
        {showApp ? (
          <section
            className="rc20-review"
            data-testid="rc20-review"
            data-rc20-zone="review"
            data-rc20-observed={model.review.releaseObserved ? 'true' : 'false'}
            style={zoneStyle(zones.review)}
            aria-label="Post start launch review"
          >
            <span className="rc20-label">LAUNCH REVIEW</span>
            <div className="rc20-review-rows">
              <StripCell
                label="REACTION S"
                value={model.reviewFields.reaction}
                description="Reaction from release to first movement"
                testid="review-reaction"
              />
              <StripCell
                label="RPM AT GO"
                value={model.reviewFields.rpm}
                description="Engine RPM at the observed release"
                testid="review-rpm"
              />
              <StripCell
                label="CLUTCH AT GO"
                value={model.reviewFields.clutch}
                description="Clutch bite percent at the observed release"
                testid="review-clutch"
              />
            </div>
          </section>
        ) : null}
      </main>
    </div>
  )
}
