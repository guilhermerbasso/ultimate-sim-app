import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { WidgetProps } from './types'
import { raceconDisplayClockFrozen, useRaceconDisplayClock } from './raceconDisplayClock'
import {
  Rc01LiveTelemetryBuffer,
  type Rc01MonotonicClock,
  buildRc01LedStates,
  createRc01DashboardModel,
  rc01CompactModeForContentBox,
  rc01FieldDescription,
  rc01LayoutForContentBox,
  rc01MonotonicNow,
  rc01PhoneGeometryForContentBox
} from './raceconRc01Core'
import './raceconRc01.css'

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

    // The dashboard canvas can be transformed relative to its authored size. The
    // root's client/content box is therefore not the display size used for RC-01
    // composition; its bounding rect is.
    const measure = (): boolean => {
      const rect = element.getBoundingClientRect()
      if (!Number.isFinite(rect.width) || rect.width <= 0 || !Number.isFinite(rect.height) || rect.height <= 0) return false
      setBox((current) => current.width === rect.width && current.height === rect.height
        ? current
        : { width: rect.width, height: rect.height })
      return true
    }

    // Retain the authored widget size only while the element has no rendered box.
    // This also gives SSR/static markup a deterministic composition.
    if (!measure()) setBox(fallback)

    if (typeof ResizeObserver === 'undefined') return
    const shell = element.closest<HTMLElement>('.dashboard-shell')
    // A canvas transform does not alter ResizeObserver's contentRect. Observe the
    // root and its viewport shell, then always re-read the transformed root rect.
    const observer = new ResizeObserver(() => { measure() })
    observer.observe(element)
    if (shell && shell !== element) observer.observe(shell)
    return () => observer.disconnect()
  }, [config?.position?.width, config?.position?.height, fallback.height, fallback.width])

  return box
}

function sparklinePoints(values: readonly number[]): string | null {
  if (values.length < 2) return null
  const extent = Math.max(0.01, ...values.map((value) => Math.abs(value)))
  return values.map((value, index) => {
    const x = (index / (values.length - 1)) * 100
    const y = 50 - (value / extent) * 42
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')
}

function Metric({ label, value }: { label: string; value: ReturnType<typeof createRc01DashboardModel>['tc'] }): ReactElement {
  return (
    <div className="rc01-metric">
      <dt>{label}</dt>
      <dd className={`rc01-value rc01-tone-${value.tone}${value.stale ? ' is-stale' : ''}${value.unavailable ? ' is-unavailable' : ''}`} aria-label={rc01FieldDescription(label, value)}>{value.value}</dd>
    </div>
  )
}

/**
 * RC-01 is an overlay-widget-owned, live telemetry dashboard. Its bounded history
 * accepts only the supplied TelemetrySnapshot stream; it has no mock or scenario path.
 */
export interface RaceconRc01DashWidgetProps extends WidgetProps {
  monotonicClock?: Rc01MonotonicClock
}

export function RaceconRc01DashWidget({
  snapshot,
  config,
  preview,
  monotonicClock = rc01MonotonicNow
}: RaceconRc01DashWidgetProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const bufferRef = useRef(new Rc01LiveTelemetryBuffer())
  const nowMs = useRaceconDisplayClock(monotonicClock, raceconDisplayClockFrozen(preview))
  const [detail, setDetail] = useState<'fuel' | 'tyres'>('fuel')
  const box = useContentBox(rootRef, config)
  // This is a receipt timestamp, not a display-clock timestamp. It changes only
  // when a new snapshot object (or its provider timestamp) arrives; a freshness
  // tick therefore cannot make the current frame look newly received.
  const arrivalMs = useMemo(
    () => monotonicClock(),
    [monotonicClock, snapshot, snapshot?.timestamp]
  )

  // Rendering only mutates an isolated candidate. It becomes the committed history
  // in the layout phase, so StrictMode and abandoned concurrent renders cannot advance it.
  const candidate = bufferRef.current.clone()
  const outcome = candidate.ingest(snapshot, arrivalMs)
  const renderSnapshot = outcome.renderable ? candidate.latestSnapshot() : null
  const model = createRc01DashboardModel(renderSnapshot, candidate.receipts(), nowMs)
  // Alert transitions and trace reduction happen only when ingest accepts a compact sample.
  // Freshness invalidation is written to this render-local candidate before its
  // layout-effect commit, preventing stale continuity from being resurrected.
  const alerts = candidate.clearInvalidCurrentAlerts(model)
  const leds = buildRc01LedStates(model.rpmRatio, model.rpmFresh, alerts.overRev.active, model.shiftGear)
  const trace = sparklinePoints(candidate.traceValues())
  const layout = rc01LayoutForContentBox(box.width, box.height)
  const compactMode = rc01CompactModeForContentBox(box.width, box.height)
  const phoneGeometry = rc01PhoneGeometryForContentBox(box.width, box.height)
  const responsiveStyle = phoneGeometry
    ? {
        '--rc01-phone-inset': `${phoneGeometry.inset}px`,
        '--rc01-phone-led-top': `${phoneGeometry.ledTop}px`,
        '--rc01-phone-led-height': `${phoneGeometry.ledHeight}px`,
        '--rc01-phone-hero-top': `${phoneGeometry.heroTop}px`,
        '--rc01-phone-hero-height': `${phoneGeometry.heroHeight}px`,
        '--rc01-phone-delta-top': `${phoneGeometry.deltaTop}px`,
        '--rc01-phone-delta-height': `${phoneGeometry.deltaHeight}px`,
        '--rc01-phone-status-top': `${phoneGeometry.statusTop}px`,
        '--rc01-phone-status-height': `${phoneGeometry.statusHeight}px`,
        '--rc01-phone-toggle-size': `${phoneGeometry.toggleSize}px`
      } as CSSProperties
    : undefined

  useLayoutEffect(() => {
    bufferRef.current = candidate
  }, [candidate])

  const deltaChevron = model.delta.direction === 'down' ? '\u25C0' : model.delta.direction === 'up' ? '\u25B6' : '\u2014'
  const deltaDescription = model.delta.unavailable
    ? 'Delta unavailable because no fresh valid best lap is available'
    : `${model.delta.direction === 'down' ? 'Ahead of' : model.delta.direction === 'up' ? 'Behind' : 'Equal to'} best lap, ${model.delta.value}`

  return (
    <div
      ref={rootRef}
      className="rc01-widget"
      data-widget="raceconRc01Dash"
      data-rc01-layout={layout}
      data-rc01-compact-mode={layout === 'compact' ? compactMode : undefined}
      data-rc01-buffer-state={outcome.reason}
      data-rc01-content-width={Math.round(box.width)}
      data-rc01-content-height={Math.round(box.height)}
      style={responsiveStyle}
    >
      <main
        className={`rc01-dashboard rc01-detail-${detail}${alerts.overRev.active ? ' rc01-over-rev' : ''}${alerts.deltaZeroCross.active ? ' rc01-delta-zero-cross' : ''}`}
        aria-label="RaceCon RC-01 live race dashboard"
        data-rc01-detail={detail}
        data-rc01-native-size={layout === 'native' ? '800x480' : undefined}
      >
        <section className="rc01-led-arc" data-testid="rc01-led-arc" role="img" aria-label={`Engine shift lights, ${leds.filter((led) => led.active).length} of ${leds.length} active`}>
          {leds.map((led) => <span key={led.index} data-testid="rc01-led" data-tone={led.tone} className={`rc01-led${led.active ? ' is-active' : ''}`} aria-hidden="true" />)}
        </section>

        <section className="rc01-hero rc01-speed" aria-label="Vehicle speed" data-rc01-hero-zone="speed">
          <span className="rc01-hero-label">SPEED</span>
          <output className={`rc01-value rc01-tone-${model.speed.tone}${model.speed.stale ? ' is-stale' : ''}${model.speed.unavailable ? ' is-unavailable' : ''}`} aria-label={rc01FieldDescription('Speed', model.speed)}>{model.speed.value}</output>
          <span className="rc01-unit">KM/H</span>
        </section>
        <section className="rc01-hero rc01-gear" aria-label="Transmission gear" data-rc01-hero-zone="gear">
          <output className={`rc01-value rc01-tone-${model.gear.tone}${model.gear.stale ? ' is-stale' : ''}${model.gear.unavailable ? ' is-unavailable' : ''}`} aria-label={rc01FieldDescription('Gear', model.gear)}>{model.gear.value}</output>
        </section>
        <section className="rc01-hero rc01-rpm" aria-label="Engine revolutions" data-rc01-hero-zone="rpm">
          <span className="rc01-hero-label">RPM</span>
          <output className={`rc01-value rc01-tone-${model.rpm.tone}${model.rpm.stale ? ' is-stale' : ''}${model.rpm.unavailable ? ' is-unavailable' : ''}`} aria-label={rc01FieldDescription('Engine speed', model.rpm)}>{model.rpm.value}</output>
          <span className="rc01-rpm-tick" aria-hidden="true" />
        </section>

        <section className={`rc01-delta${alerts.deltaCliff.active ? ' is-cliff' : ''}${alerts.deltaZeroCross.active ? ' is-zero-cross' : ''}`} aria-label={`${deltaDescription}; ${rc01FieldDescription('Delta', model.delta)}`} aria-live="polite">
          <span className="rc01-delta-label">DELTA</span>
          <output className={`rc01-value rc01-tone-${alerts.deltaCliff.active ? 'bad' : alerts.deltaZeroCross.active ? 'primary' : model.delta.tone}${model.delta.stale ? ' is-stale' : ''}${model.delta.unavailable ? ' is-unavailable' : ''}`} aria-label={rc01FieldDescription('Delta', model.delta)}>{model.delta.value}</output>
          <span className="rc01-delta-chevron" aria-hidden="true">{deltaChevron}</span>
        </section>

        <section className="rc01-status" aria-label="Attack status">
          <dl className="rc01-status-grid"><Metric label="TC" value={model.tc} /><Metric label="POS" value={model.position} /><Metric label="FUEL" value={model.fuel} /></dl>
          <dl className="rc01-tyre-grid" aria-label="Individual tyre temperatures">
            {model.tyres.map((tyre) => <div className="rc01-tyre" key={tyre.corner}><dt>{tyre.corner}</dt><dd className={`rc01-value rc01-tone-${tyre.tone}${tyre.stale ? ' is-stale' : ''}${tyre.unavailable ? ' is-unavailable' : ''}`} aria-label={rc01FieldDescription(`${tyre.corner} tyre temperature`, tyre)}>{tyre.value}</dd></div>)}
          </dl>
          <button
            className="rc01-status-toggle rc01-soft-key"
            data-testid="rc01-soft-key"
            type="button"
            aria-label={detail === 'fuel' ? 'Show tyre summary' : 'Show fuel status'}
            onClick={() => setDetail((current) => current === 'fuel' ? 'tyres' : 'fuel')}
          />
          {alerts.pitLimiter.active && <div className="rc01-pit-alert" role="status" aria-live="assertive">PIT LIMITER</div>}
        </section>

        <aside className="rc01-attack-rail" aria-label="Attack side rail">
          <span className="rc01-rail-label">ATTACK</span>
          <section className="rc01-trace" aria-label={trace ? 'Delta history from accepted live telemetry' : 'Delta history unavailable: accepted live history is not yet available'}>
            <span>DELTA TRACE</span>
            {trace ? <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Recent accepted delta history"><polyline points={trace} /></svg> : <span className="rc01-trace-unavailable">--</span>}
          </section>
          <dl className="rc01-rail-metrics"><Metric label="GAP AHEAD" value={model.gapAhead} /><Metric label="BEST" value={model.best} /></dl>
        </aside>
        {alerts.deltaCliff.active && <div className="rc01-sr-alert" role="status" aria-live="polite" aria-label="Delta cliff active">Delta cliff active</div>}
        {alerts.deltaZeroCross.active && <div className="rc01-sr-alert" role="status" aria-live="polite" aria-label="Delta zero-cross alert active">Delta zero-cross alert active</div>}
        {alerts.overRev.active && <div className="rc01-sr-alert" role="status">Over-rev active</div>}
      </main>
    </div>
  )
}
