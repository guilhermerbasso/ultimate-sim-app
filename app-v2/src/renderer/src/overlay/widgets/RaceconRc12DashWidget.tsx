import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { WidgetProps } from './types'
import { raceconDisplayClockFrozen, useRaceconDisplayClock } from './raceconDisplayClock'
import type { Rc01Field } from './raceconRc01Core'
import { Rc01LiveTelemetryBuffer, type Rc01MonotonicClock, rc01MonotonicNow } from './raceconRc01Core'
import {
  RC12_APP_ONLY_MODULES,
  RC12_DASH,
  RC12_GAP_UNIT,
  RC12_NO_BATTLE_LABEL,
  RC12_NO_TIMING_LABEL,
  RC12_ROW_COLUMNS,
  RC12_SAFE_FRAME_PX,
  RC12_TIMING_DELAY_LABEL,
  RC12_TAG_REFERENCE_GLYPHS,
  RC12_TYPE_SCALE_PX,
  type Rc12BattleCar,
  type Rc12DashboardModel,
  type Rc12Rect,
  type Rc12Row,
  Rc12TimingBuffer,
  advanceRc12Alerts,
  clearInvalidRc12Alerts,
  createRc12AlertState,
  createRc12DashboardModel,
  rc12AlertInputForFrame,
  rc12BattleDescription,
  rc12CompactModeForContentBox,
  rc12LayoutForContentBox,
  rc12PhoneGeometryForContentBox,
  rc12RectPercent,
  rc12RowColumnInsetCqw,
  rc12RowCountForLayout,
  rc12RowDescription,
  rc12SilentObservation,
  rc12TimingEntries,
  rc12TagRungCqw,
  rc12TypeScaleCqw,
  rc12ZoneStyle,
  rc12ZonesForLayout,
  RC12_NATIVE_WIDTH_PX,
  RC12_NATIVE_HEIGHT_PX
} from './raceconRc12Core'
import './raceconRc12.css'

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

    // The dashboard canvas can be transformed relative to its authored size, so the composition size
    // is the transformed bounding rect, not the content box.
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

function zoneStyle(rect: Rc12Rect | undefined): CSSProperties | undefined {
  const style = rc12ZoneStyle(rect)
  return style ? (style as CSSProperties) : undefined
}

function fieldClass(base: string, value: Rc01Field): string {
  return `${base}${value.unavailable ? ' is-unavailable' : ''}${value.stale ? ' is-stale' : ''}`
}

const COLUMN_CLASS: Readonly<Record<string, string>> = {
  position: 'rc12-cell-position',
  badge: 'rc12-cell-badge',
  gap: 'rc12-cell-gap',
  lastLap: 'rc12-cell-last'
}

/**
 * One ranked row. The four packet 11.1 columns each own an explicit share of the row width with
 * `min-width: 0`, so a `nowrap` glyph is clipped by its own column instead of widening it — the
 * sizing trap that makes `scrollWidth` checks useless.
 */
function BoardRow({ row, alternate }: { row: Rc12Row; alternate: boolean }): ReactElement {
  const values: Readonly<Record<string, Rc01Field>> = {
    position: row.position,
    badge: row.badge,
    gap: row.gap,
    lastLap: row.lastLap
  }
  const empty = row.carIdx === null
  return (
    <div
      className={`rc12-row${alternate ? ' is-alt' : ''}${empty ? ' is-empty' : ''}${row.fastestLap ? ' is-fastest' : ''}${row.leadChange ? ' is-lead' : ''}`}
      data-testid="rc12-row"
      data-rc12-rank={row.rank}
      data-rc12-row-populated={empty ? 'false' : 'true'}
      data-rc12-row-featured={row.isFeatured ? 'true' : 'false'}
      data-rc12-row-fastest={row.fastestLap ? 'true' : 'false'}
      data-rc12-row-lead={row.leadChange ? 'true' : 'false'}
      data-rc12-row-change={row.change ?? 'none'}
      role="row"
      aria-label={rc12RowDescription(row)}
    >
      <div className="rc12-row-columns" role="none">
        {RC12_ROW_COLUMNS.map((column) => {
          const value = values[column.id]
          return (
            <span
              key={column.id}
              className={fieldClass(`rc12-cell ${COLUMN_CLASS[column.id]}${column.align === 'right' ? ' is-right' : ''}`, value)}
              data-testid={`rc12-cell-${column.id}`}
              data-rc12-column={column.id}
              data-tone={value.tone}
              style={{ flex: `0 0 ${((column.end - column.start) * 100).toFixed(3)}%` }}
              role="cell"
            >
              {value.value}
              {column.id === 'position' && row.leadChange ? (
                <span className="rc12-lead-tag" data-testid="rc12-lead-tag">
                  LEAD
                </span>
              ) : null}
              {column.id === 'position' && row.change ? (
                <span className="rc12-change" data-testid="rc12-change" data-rc12-change={row.change}>
                  <span aria-hidden="true">{row.change === 'gain' ? '\u25B2' : '\u25BC'}</span>
                  <span>{row.change === 'gain' ? 'GAIN' : 'LOSS'}</span>
                </span>
              ) : null}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function BattleCar({
  car,
  side,
  showAppOnly
}: {
  car: Rc12BattleCar
  side: 'lead' | 'trail'
  showAppOnly: boolean
}): ReactElement {
  return (
    <div className={`rc12-battle-car is-${side}`} data-testid={`rc12-battle-${side}`} data-rc12-battle-side={side}>
      <span className={fieldClass('rc12-battle-position', car.position)} data-testid="rc12-battle-position">
        {car.position.value}
      </span>
      <span className={fieldClass('rc12-battle-badge', car.badge)} data-testid="rc12-battle-badge">
        {car.badge.value}
      </span>
      <span className="rc12-battle-last">
        <span className="rc12-battle-last-label">LAST</span>
        <span className={fieldClass('rc12-battle-last-value', car.lastLap)} data-testid="rc12-battle-last">
          {car.lastLap.value}
        </span>
      </span>
      {/*
        Packet 12.1 driver tags. Gap behind and Best lap time have section 16 channels but no
        800x480 zone, so this is their ONLY surface and it is app-only by construction.
      */}
      {showAppOnly ? (
        <span className="rc12-driver-tag" data-testid="rc12-driver-tag" data-rc12-driver-tag={side}>
          <span>BEHIND</span>
          <span className={fieldClass('rc12-driver-tag-value', car.gapBehind)} data-testid="rc12-driver-tag-behind">
            {car.gapBehind.value}
          </span>
          <span>BEST</span>
          <span className={fieldClass('rc12-driver-tag-value', car.bestLap)} data-testid="rc12-driver-tag-best">
            {car.bestLap.value}
          </span>
        </span>
      ) : null}
    </div>
  )
}

export interface RaceconRc12DashWidgetProps extends WidgetProps {
  monotonicClock?: Rc01MonotonicClock
}

export function RaceconRc12DashWidget({
  snapshot,
  config,
  preview,
  monotonicClock = rc01MonotonicNow
}: RaceconRc12DashWidgetProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const bufferRef = useRef(new Rc01LiveTelemetryBuffer())
  const timingRef = useRef(new Rc12TimingBuffer())
  const alertsRef = useRef(createRc12AlertState())
  const nowMs = useRaceconDisplayClock(monotonicClock, raceconDisplayClockFrozen(preview))
  const box = useContentBox(rootRef, config)

  // A receipt timestamp, not a display clock: it advances only when a new snapshot object or
  // provider timestamp arrives, so a freshness tick cannot make a stale frame look fresh.
  const arrivalMs = useMemo(() => monotonicClock(), [monotonicClock, snapshot, snapshot?.timestamp])

  // Rendering mutates isolated candidates only; they are committed in the layout phase so StrictMode
  // double-renders and abandoned concurrent renders cannot advance real state.
  const candidate = bufferRef.current.clone()
  const outcome = candidate.ingest(snapshot, arrivalMs)
  const timing = timingRef.current.clone()
  let observation = rc12SilentObservation()
  if (outcome.accepted) {
    observation = timing.ingest(candidate.latestSnapshot(), arrivalMs)
  } else if (!outcome.renderable) {
    // Fail closed: anything the buffer refuses also invalidates the observed running order, the
    // observed session best and the recorded gap history, so a new source never inherits the
    // previous session's board or fires an editorial highlight from it.
    timing.reset()
  }

  const renderSnapshot = outcome.renderable ? candidate.latestSnapshot() : null
  const layout = rc12LayoutForContentBox(box.width, box.height)
  const compactMode = rc12CompactModeForContentBox(box.width, box.height)
  const showApp = layout === 'app'
  const rowCount = rc12RowCountForLayout(layout, compactMode)

  const alertInput = rc12AlertInputForFrame(observation, timing, nowMs)
  const entries = rc12TimingEntries(renderSnapshot)
  const alerts = clearInvalidRc12Alerts(advanceRc12Alerts(alertsRef.current, alertInput), entries)

  const model: Rc12DashboardModel = createRc12DashboardModel(renderSnapshot, timing, nowMs, {
    rowCount,
    alerts,
    history: timing.history(),
    timingStale: alertInput.timingStale && alertInput.hasFeed,
    includeAppOnly: showApp
  })

  const zones = rc12ZonesForLayout(layout, compactMode, box)
  const phoneGeometry = rc12PhoneGeometryForContentBox(box.width, box.height)
  const safeFrame = rc12RectPercent(RC12_SAFE_FRAME_PX, RC12_NATIVE_WIDTH_PX, RC12_NATIVE_HEIGHT_PX)

  const responsiveStyle = {
    // Normative override `typeScale`: the ladder is arithmetic. Because the app canvas is exactly
    // 1.28x the native canvas, ONE cqw ladder gives 72/24/22/16 px at 800 wide and
    // 92.16/30.72/28.16/20.48 px at 1024 wide, and the row tier always fits its own row pitch.
    '--rc12-type-battle-gap': `${rc12TypeScaleCqw(RC12_TYPE_SCALE_PX.battleGap)}cqw`,
    '--rc12-type-gap': `${rc12TypeScaleCqw(RC12_TYPE_SCALE_PX.gap)}cqw`,
    '--rc12-type-position': `${rc12TypeScaleCqw(RC12_TYPE_SCALE_PX.position)}cqw`,
    '--rc12-type-badge': `${rc12TypeScaleCqw(RC12_TYPE_SCALE_PX.badge)}cqw`,
    '--rc12-type-last': `${rc12TypeScaleCqw(RC12_TYPE_SCALE_PX.lastLap)}cqw`,
    '--rc12-type-ribbon': `${rc12TypeScaleCqw(RC12_TYPE_SCALE_PX.ribbon)}cqw`,
    // The packet's tag box is fixed while the three strings inside it are not, so the tag rung is
    // the packet rung capped by the arithmetic fit of the zone the packet publishes.
    '--rc12-type-tag': `${rc12TagRungCqw(
      zones.fastestLapTag?.width ?? 25,
      Math.max(
        RC12_TAG_REFERENCE_GLYPHS,
        model.tag.label.length + model.tag.position.length + model.tag.lapTime.length
      ),
      box.width
    )}cqw`,
    // Normative override `fastestLapTagOverlap`: the row columns stop short of the packet's tag box.
    '--rc12-row-inset-right': `${rc12RowColumnInsetCqw(layout)}cqw`,
    ...(phoneGeometry
      ? {
          '--rc12-phone-inset': `${phoneGeometry.inset}px`,
          '--rc12-phone-ribbon-height': `${phoneGeometry.ribbonHeight}px`,
          '--rc12-phone-row-min-height': `${phoneGeometry.rowMinHeight}px`,
          '--rc12-phone-tag-height': `${phoneGeometry.tagHeight}px`
        }
      : {})
  } as CSSProperties

  useLayoutEffect(() => {
    bufferRef.current = candidate
    timingRef.current = timing
    alertsRef.current = alerts
  }, [candidate, timing, alerts])

  const alertsActive =
    model.tag.showing || model.leadTag.showing || model.timingDelay || model.rows.some((row) => row.change !== null)

  return (
    <div
      ref={rootRef}
      className="rc12-widget"
      data-widget="raceconRc12Dash"
      data-rc12-layout={layout}
      data-rc12-compact-mode={layout === 'compact' ? compactMode : undefined}
      data-rc12-buffer-state={outcome.reason}
      data-rc12-alerts={alertsActive ? 'active' : 'silent'}
      data-rc12-timing={model.timingDelay ? 'delayed' : model.hasFeed ? 'live' : 'absent'}
      data-rc12-rows={model.rowCount}
      data-rc12-field={model.fieldSize}
      data-rc12-measured-gaps={model.measuredGapCount}
      data-rc12-app-only={showApp ? RC12_APP_ONLY_MODULES.join(' ') : ''}
      data-rc12-content-width={Math.round(box.width)}
      data-rc12-content-height={Math.round(box.height)}
      style={responsiveStyle}
    >
      <main
        className="rc12-broadcast"
        aria-label="RaceCon RC-12 on air, broadcast timing presentation"
        data-rc12-native-size={layout === 'native' ? '800x480' : undefined}
      >
        {/* Normative override `sessionClockTitleSafe`: the TV title-safe guide, top redefined to y=8. */}
        {layout === 'native' ? (
          <div
            className="rc12-safe-frame"
            data-testid="rc12-safe-frame"
            style={zoneStyle(safeFrame)}
            aria-hidden="true"
          />
        ) : null}

        {/*
          Packet 11.1 zone 4. RC12_PACKET_OMISSIONS.sessionClockChannel: section 16 defines neither a
          session-time nor a lap-count channel, so both readouts dash forever and the snapshot's own
          session clock is deliberately never read.
        */}
        <div
          className="rc12-zone rc12-ribbon"
          data-testid="rc12-ribbon"
          data-rc12-zone="sessionClock"
          style={zoneStyle(zones.sessionClock)}
          role="group"
          aria-label={`Session clock unavailable, no session time or lap count channel. ${RC12_DASH.sessionTime}`}
        >
          <span className="rc12-ribbon-group">
            <span className="rc12-ribbon-label">SESSION</span>
            <span className="rc12-ribbon-value" data-testid="rc12-session-time" data-tone={model.sessionClock.time.tone}>
              {model.sessionClock.time.value}
            </span>
          </span>
          <span className="rc12-ribbon-group">
            <span className="rc12-ribbon-label">LAP</span>
            <span className="rc12-ribbon-value" data-testid="rc12-session-laps-done">
              {model.sessionClock.lapsDone.value}
            </span>
            <span className="rc12-ribbon-label">/</span>
            <span className="rc12-ribbon-value" data-testid="rc12-session-laps-total">
              {model.sessionClock.lapsTotal.value}
            </span>
          </span>
          <span className="rc12-ribbon-spacer" />
          {!model.hasFeed ? (
            <span className="rc12-ribbon-value" data-testid="rc12-no-timing">
              {RC12_NO_TIMING_LABEL}
            </span>
          ) : null}
        </div>

        {/*
          Packet 11.1 zone 1. Exactly `rowCount` rows at every breakpoint so the positional axis can
          never collapse; a rank the feed does not fill renders the complete dash row.
        */}
        <div
          className="rc12-zone rc12-panel rc12-board"
          data-testid="rc12-board"
          data-rc12-zone="leaderboard"
          style={zoneStyle(zones.leaderboard)}
          role="table"
          aria-label="Broadcast leaderboard band"
        >
          {model.rows.map((row, index) => (
            <BoardRow key={row.rank} row={row} alternate={index % 2 === 1} />
          ))}
        </div>

        {/* Packet 11.1 zone 2, the lower third. */}
        <div
          className="rc12-zone rc12-panel rc12-battle"
          data-testid="rc12-battle"
          data-rc12-zone="battleStrip"
          data-rc12-battle-available={model.battle.available ? 'true' : 'false'}
          style={zoneStyle(zones.battleStrip)}
          role="group"
          aria-label={rc12BattleDescription(model.battle)}
        >
          {model.battle.available ? (
            <>
              <BattleCar car={model.battle.lead} side="lead" showAppOnly={showApp} />
              <div className="rc12-battle-gap" data-testid="rc12-battle-gap">
                <span className="rc12-battle-gap-label">GAP</span>
                <span
                  className={`rc12-battle-gap-value${model.battle.gap.unavailable ? ' is-unavailable' : ''}${model.battle.gap.stale ? ' is-stale' : ''}`}
                  data-testid="rc12-battle-gap-value"
                  data-tone={model.battle.gap.tone}
                >
                  {model.battle.gap.value}
                  <span className="rc12-battle-gap-unit">{RC12_GAP_UNIT}</span>
                </span>
                <span
                  className="rc12-trend"
                  data-testid="rc12-trend"
                  data-rc12-trend={model.battle.trend}
                  data-rc12-trend-token={model.battle.trendToken}
                >
                  <span className="rc12-trend-glyph" aria-hidden="true">
                    {model.battle.trendGlyph}
                  </span>
                  <span>{model.battle.trendLabel}</span>
                </span>
              </div>
              <BattleCar car={model.battle.trail} side="trail" showAppOnly={showApp} />
            </>
          ) : (
            <span className="rc12-battle-empty" data-testid="rc12-battle-empty">
              {RC12_NO_BATTLE_LABEL}
            </span>
          )}
        </div>

        {/* Packet 12.1's app-only reveal: the featured pair's recent measured gap trend. */}
        {showApp ? (
          <div
            className="rc12-zone rc12-panel rc12-history"
            data-testid="rc12-history"
            data-rc12-zone="battleHistory"
            data-rc12-history-points={model.history.length}
            style={zoneStyle(zones.battleHistory)}
            role="img"
            aria-label={`Featured battle gap history, ${model.history.length} measured samples.`}
          >
            <span className="rc12-history-title">GAP HISTORY</span>
            {model.history.length >= 2 ? (
              <svg
                className="rc12-history-plot"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                data-testid="rc12-history-plot"
              >
                <polyline
                  className="rc12-history-line"
                  data-testid="rc12-history-line"
                  points={model.history.map((point) => `${point.x},${point.y}`).join(' ')}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            ) : (
              <span className="rc12-history-empty" data-testid="rc12-history-empty">
                {RC12_DASH.gap}
              </span>
            )}
          </div>
        ) : null}

        {/*
          Packet 11.1 zone 3 and packet 15 alert 1. Trigger-only: the tag exists in the DOM only
          while the fastest-lap highlight is latched, and it retires on its own after 5 s.
        */}
        {model.tag.showing ? (
          <div
            className="rc12-zone rc12-tag"
            data-testid="rc12-tag"
            data-rc12-zone="fastestLapTag"
            data-rc12-alert="fastest-lap"
            style={zoneStyle(zones.fastestLapTag)}
            role="status"
          >
            <span>{model.tag.label}</span>
            <span>{model.tag.position}</span>
            <span>{model.tag.lapTime}</span>
          </div>
        ) : null}

        {/* Packet 15 unavailable-data behaviour: the board freezes and says so, in the tag's zone. */}
        {model.timingDelay ? (
          <div
            className="rc12-zone rc12-delay"
            data-testid="rc12-delay"
            data-rc12-alert="timing-delay"
            style={zoneStyle(zones.fastestLapTag)}
            role="status"
          >
            {RC12_TIMING_DELAY_LABEL}
          </div>
        ) : null}
      </main>
      </div>
  )
}
