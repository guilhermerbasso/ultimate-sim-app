import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { WidgetProps } from './types'
import { Rc01LiveTelemetryBuffer, type Rc01MonotonicClock, rc01FieldDescription, rc01MonotonicNow } from './raceconRc01Core'
import {
  type Rc02DashboardModel,
  type Rc02Sector,
  Rc02SectorTracker,
  advanceRc02PbPace,
  clearInvalidRc02PbPace,
  createRc02DashboardModel,
  createRc02PbPaceState,
  rc02CompactModeForContentBox,
  rc02FormatLapTime,
  rc02LayoutForContentBox,
  rc02PbPaceDeltaForAlert,
  rc02PhoneGeometryForContentBox,
  rc02SectorDescription,
  rc02SpineDescription
} from './raceconRc02Core'
import './raceconRc02.css'

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

function SectorChip({ sector }: { sector: Rc02Sector }): ReactElement {
  return (
    <div className="rc02-sector" data-testid="rc02-sector" data-sector={sector.label} data-loss={sector.lossActive ? 'true' : 'false'}>
      <span className="rc02-chip-label">{sector.label}</span>
      <output
        className={`rc02-value${sector.unavailable ? ' is-unavailable' : ''}`}
        aria-label={rc02SectorDescription(sector)}
      >
        {sector.value}
      </output>
    </div>
  )
}

function Chip({ label, value, testId }: { label: string; value: Rc02DashboardModel['best']; testId: string }): ReactElement {
  return (
    <div className="rc02-chip" data-testid={testId}>
      <span className="rc02-chip-label">{label}</span>
      <output
        className={`rc02-value rc02-tone-${value.tone}${value.stale ? ' is-stale' : ''}${value.unavailable ? ' is-unavailable' : ''}`}
        aria-label={rc01FieldDescription(label, value)}
      >
        {value.value}
      </output>
    </div>
  )
}

/**
 * RC-02 is an overlay-widget-owned, live-only qualifying dashboard. It shares RC-01's
 * fail-closed ingest buffer, so mock and replay telemetry are refused and a source or
 * session discontinuity clears both the delta history and every measured sector.
 */
export interface RaceconRc02DashWidgetProps extends WidgetProps {
  monotonicClock?: Rc01MonotonicClock
}

export function RaceconRc02DashWidget({ snapshot, config, monotonicClock = rc01MonotonicNow }: RaceconRc02DashWidgetProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const bufferRef = useRef(new Rc01LiveTelemetryBuffer())
  const trackerRef = useRef(new Rc02SectorTracker())
  const pbPaceRef = useRef(createRc02PbPaceState())
  const [nowMs, setNowMs] = useState(() => monotonicClock())
  const box = useContentBox(rootRef, config)

  // A receipt timestamp, not a display clock: it advances only when a new snapshot object
  // or provider timestamp arrives, so a freshness tick cannot make a stale frame look fresh.
  const arrivalMs = useMemo(() => monotonicClock(), [monotonicClock, snapshot, snapshot?.timestamp])

  // Rendering mutates isolated candidates only; they are committed in the layout phase so
  // StrictMode double-renders and abandoned concurrent renders cannot advance real state.
  const candidate = bufferRef.current.clone()
  const outcome = candidate.ingest(snapshot, arrivalMs)
  const tracker = trackerRef.current.clone()
  if (outcome.accepted) {
    const accepted = candidate.latestSnapshot()
    tracker.ingest({
      lapDistPct: typeof accepted?.lapDistPct === 'number' ? accepted.lapDistPct : null,
      currentLapTimeSec: typeof accepted?.currentLapTimeSec === 'number' ? accepted.currentLapTimeSec : null,
      receivedAt: arrivalMs
    })
  } else if (!outcome.renderable) {
    // Fail closed: anything the buffer refuses also invalidates every measured sector.
    tracker.reset()
  }

  const renderSnapshot = outcome.renderable ? candidate.latestSnapshot() : null
  const latestSample = candidate.latestSample()
  const pbPaceCandidate = advanceRc02PbPace(pbPaceRef.current, {
    nowMs: arrivalMs,
    delta: latestSample && outcome.renderable ? rc02PbPaceDeltaForAlert(latestSample) : null
  })
  const sectors = tracker.sectors(nowMs)
  const alerts = candidate.alertState()
  const provisional = createRc02DashboardModel(renderSnapshot, candidate.receipts(), nowMs, sectors, pbPaceCandidate.active, alerts.overRev.active)
  const pbPace = clearInvalidRc02PbPace(pbPaceCandidate, provisional)
  const model = pbPace.active === pbPaceCandidate.active
    ? provisional
    : createRc02DashboardModel(renderSnapshot, candidate.receipts(), nowMs, sectors, pbPace.active, alerts.overRev.active)

  const layout = rc02LayoutForContentBox(box.width, box.height)
  const compactMode = rc02CompactModeForContentBox(box.width, box.height)
  const phoneGeometry = rc02PhoneGeometryForContentBox(box.width, box.height)
  const laps = tracker.laps()

  const responsiveStyle = phoneGeometry
    ? ({
        '--rc02-phone-inset': `${phoneGeometry.inset}px`,
        '--rc02-phone-head-top': `${phoneGeometry.headTop}px`,
        '--rc02-phone-head-height': `${phoneGeometry.headHeight}px`,
        '--rc02-phone-spine-top': `${phoneGeometry.spineTop}px`,
        '--rc02-phone-spine-height': `${phoneGeometry.spineHeight}px`,
        '--rc02-phone-bottom-top': `${phoneGeometry.bottomTop}px`,
        '--rc02-phone-bottom-height': `${phoneGeometry.bottomHeight}px`
      } as CSSProperties)
    : undefined

  useLayoutEffect(() => {
    bufferRef.current = candidate
    trackerRef.current = tracker
    pbPaceRef.current = pbPace
  }, [candidate, tracker, pbPace])

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(monotonicClock()), 100)
    return () => window.clearInterval(timer)
  }, [monotonicClock])

  const fillPercent = model.spine.unavailable ? 0 : model.spine.fill * 50
  const fillStyle: CSSProperties = model.spine.direction === 'down' ? { top: '50%', height: `${fillPercent}%` } : { bottom: '50%', height: `${fillPercent}%` }
  const capStyle: CSSProperties = model.spine.direction === 'down' ? { top: `calc(50% + ${fillPercent}%)` } : { bottom: `calc(50% + ${fillPercent}%)` }
  const chevron = model.spine.direction === 'up' ? '\u25B2' : model.spine.direction === 'down' ? '\u25BC' : '\u2014'
  const activeLeds = model.leds.filter((led) => led.active).length

  return (
    <div
      ref={rootRef}
      className="rc02-widget"
      data-widget="raceconRc02Dash"
      data-rc02-layout={layout}
      data-rc02-compact-mode={layout === 'compact' ? compactMode : undefined}
      data-rc02-buffer-state={outcome.reason}
      data-rc02-pb-pace={pbPace.active ? 'true' : 'false'}
      data-rc02-content-width={Math.round(box.width)}
      data-rc02-content-height={Math.round(box.height)}
      style={responsiveStyle}
    >
      <main className="rc02-dashboard" aria-label="RaceCon RC-02 qualifying dashboard" data-rc02-native-size={layout === 'native' ? '800x480' : undefined}>
        <section className="rc02-head" aria-label="Gear and shift head">
          <div
            className="rc02-led-row"
            data-testid="rc02-led-row"
            role="img"
            aria-label={`Engine shift lights, ${activeLeds} of ${model.leds.length} active`}
          >
            {model.leds.map((led) => (
              <span key={led.index} className="rc02-led" data-testid="rc02-led" data-tone={led.tone} aria-hidden="true" />
            ))}
          </div>
          <output
            className={`rc02-value rc02-gear rc02-tone-${model.gear.tone}${model.gear.stale ? ' is-stale' : ''}${model.gear.unavailable ? ' is-unavailable' : ''}`}
            aria-label={rc01FieldDescription('Gear', model.gear)}
          >
            {model.gear.value}
          </output>
          <span className="rc02-head-rule" aria-hidden="true" />
        </section>

        <section className="rc02-sectors" aria-label="Sector deltas versus best sectors">
          {model.sectors.map((sector) => (
            <SectorChip key={sector.label} sector={sector} />
          ))}
        </section>

        <section className="rc02-speed" aria-label="Vehicle speed">
          <span className="rc02-chip-label">SPEED</span>
          <output
            className={`rc02-value rc02-tone-${model.speed.tone}${model.speed.stale ? ' is-stale' : ''}${model.speed.unavailable ? ' is-unavailable' : ''}`}
            aria-label={rc01FieldDescription('Speed', model.speed)}
          >
            {model.speed.value}
          </output>
          <span className="rc02-unit">KM/H</span>
        </section>

        <section
          className="rc02-spine"
          data-testid="rc02-spine"
          data-direction={model.spine.direction}
          data-unavailable={model.spine.unavailable ? 'true' : 'false'}
          aria-label={rc02SpineDescription(model)}
          aria-live="polite"
        >
          <span className="rc02-chip-label">DELTA</span>
          <output
            className={`rc02-value rc02-spine-value rc02-tone-${model.delta.tone}${model.delta.stale ? ' is-stale' : ''}${model.delta.unavailable ? ' is-unavailable' : ''}`}
            aria-label={rc01FieldDescription('Delta', model.delta)}
          >
            {model.delta.value}
          </output>
          <span className="rc02-unit">S</span>
          <span className="rc02-spine-chevron" aria-hidden="true">
            {chevron}
          </span>
          <div className="rc02-spine-track" data-testid="rc02-spine-track">
            <span className="rc02-spine-datum" data-testid="rc02-spine-datum" aria-hidden="true" />
            {!model.spine.unavailable && model.spine.fill > 0 && (
              <span className="rc02-spine-fill" data-testid="rc02-spine-fill" style={fillStyle} aria-hidden="true" />
            )}
            {pbPace.active && <span className="rc02-spine-cap" data-testid="rc02-spine-cap" style={capStyle} aria-hidden="true" />}
            {pbPace.active && (
              <span className="rc02-spine-star" data-testid="rc02-spine-star" style={capStyle} aria-hidden="true">
                {'\u2605'}
              </span>
            )}
          </div>
        </section>

        <section className="rc02-targets" aria-label="Predicted lap and target lap">
          <Chip label="PRED" value={model.predicted} testId="rc02-pred" />
          <Chip label="BEST" value={model.best} testId="rc02-best" />
        </section>

        <section className="rc02-tyres" aria-label="Tire build-up per corner">
          <span className="rc02-chip-label">TIRE C</span>
          <dl className="rc02-tyre-grid">
            {model.tyres.map((tyre) => (
              <div className="rc02-tyre" key={tyre.corner}>
                <dt>{tyre.corner}</dt>
                <dd
                  className={`rc02-value rc02-tone-${tyre.tone}${tyre.stale ? ' is-stale' : ''}${tyre.unavailable ? ' is-unavailable' : ''}`}
                  aria-label={rc01FieldDescription(`${tyre.corner} tyre temperature`, tyre)}
                >
                  {tyre.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <aside className="rc02-ladder" data-testid="rc02-ladder" aria-label="Sector history across recent laps">
          <div className="rc02-ladder-row rc02-ladder-head" aria-hidden="true">
            <span className="rc02-chip-label">LAP</span>
            <span className="rc02-chip-label">S1</span>
            <span className="rc02-chip-label">S2</span>
            <span className="rc02-chip-label">S3</span>
            <span className="rc02-chip-label">TOTAL</span>
          </div>
          {/* The live row keeps the sector-loss alert surface present in the app layout, where
              the standalone sector chips are not part of the packet's five reflow zones. */}
          <div className="rc02-ladder-row rc02-ladder-now" data-testid="rc02-ladder-now">
            <span className="rc02-chip-label">NOW</span>
            {model.sectors.map((sector) => (
              <output
                key={sector.label}
                className={`rc02-value${sector.unavailable ? ' is-unavailable' : ''}`}
                data-testid="rc02-ladder-now-sector"
                data-sector={sector.label}
                data-loss={sector.lossActive ? 'true' : 'false'}
                aria-label={rc02SectorDescription(sector)}
              >
                {sector.value}
              </output>
            ))}
            <output className={`rc02-value${model.predicted.unavailable ? ' is-unavailable' : ''}`} aria-label={rc01FieldDescription('Predicted lap', model.predicted)}>
              {model.predicted.value}
            </output>
          </div>
          {laps.length === 0 ? (
            <div className="rc02-ladder-row" data-testid="rc02-ladder-empty">
              <span className="rc02-chip-label">--</span>
              <output className="rc02-value is-unavailable" aria-label="No completed lap history yet">--</output>
              <output className="rc02-value is-unavailable" aria-hidden="true">--</output>
              <output className="rc02-value is-unavailable" aria-hidden="true">--</output>
              <output className="rc02-value is-unavailable" aria-label="No completed lap total yet">--:--.---</output>
            </div>
          ) : (
            laps.map((lap) => (
              <div className="rc02-ladder-row" data-testid="rc02-ladder-row" key={lap.lapOrdinal}>
                <span className="rc02-chip-label">{lap.lapOrdinal}</span>
                {lap.sectors.map((value, index) => (
                  <output key={index} className={`rc02-value${value === null ? ' is-unavailable' : ''}`}>
                    {value === null ? '--' : value.toFixed(2)}
                  </output>
                ))}
                <output className={`rc02-value${lap.totalSec === null ? ' is-unavailable' : ''}`}>{rc02FormatLapTime(lap.totalSec)}</output>
              </div>
            ))
          )}
        </aside>

        {pbPace.active && (
          <div className="rc02-sr-alert" role="status" aria-live="polite">
            Personal best pace
          </div>
        )}
        {alerts.overRev.active && model.criticalFresh.rpm && (
          <div className="rc02-sr-alert" role="status">
            Over-rev active
          </div>
        )}
        {model.sectors.some((sector) => sector.lossActive) && (
          <div className="rc02-sr-alert" role="status" aria-live="polite">
            Sector loss
          </div>
        )}
      </main>
    </div>
  )
}
