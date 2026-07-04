// Reusable, presentational track-map renderer shared by the overlay widget and
// the dashboard track-map widget.
//
// It takes a `TrackMapData` (the IPC payload) and draws whichever flavour is
// available, in this priority order:
//
//   1. A finished map — the official iRacing SVG layers OR a learned, closed
//      polyline — with the live car marker placed by `lapDistPct`, the other
//      cars, and the start/finish tick.
//   2. The LIVE recording trace — the partial polyline the learner has captured
//      so far this lap (SimHub-style), with a leading marker at the car and a
//      real recording-progress badge.
//   3. A neutral oval fallback (only momentarily, before the first samples land)
//      so the widget is never empty.
//
// The component is purely presentational: callers own the data subscription and
// pass the latest `data`, the player's `playerPct`, and the `drivers`. This
// keeps it trivially reusable from both the overlay and the dashboard.

import { useMemo } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { DriverEntry } from '../../../shared/telemetry'
import type { TrackMapData, TrackMapPoint } from '../../../shared/track-map'
import {
  buildTrackMap,
  getStartFinishMarker,
  trackMapDotRadius,
  trackMapStrokeWidth
} from '../lib/track-map'

export interface TrackMapCanvasProps {
  data: TrackMapData | null | undefined
  // Player lap progress, 0..1 (telemetry `lapDistPct`).
  playerPct?: number
  // Other cars to plot. Only used once a finished map exists (their position on
  // a partial recording trace is undefined).
  drivers?: DriverEntry[]
  playerCarIdx?: number
  // Colours.
  accent?: string
  outlineColor?: string
  pitColor?: string
  startFinishColor?: string
  recordingColor?: string
  // Show the recording-progress badge while the learner is capturing a lap.
  showProgress?: boolean
  // Optional label (track name) for the badge; falls back to `data.trackName`.
  trackName?: string
  className?: string
  style?: CSSProperties
}

const DEFAULTS = {
  accent: 'var(--accent-primary)',
  outline: '#3a4d63',
  pit: '#26313d',
  startFinish: '#f6fbff',
  recording: 'var(--accent-warning)'
} as const

export function TrackMapCanvas({
  data,
  playerPct = 0,
  drivers = [],
  playerCarIdx,
  accent = DEFAULTS.accent,
  outlineColor = DEFAULTS.outline,
  pitColor = DEFAULTS.pit,
  startFinishColor = DEFAULTS.startFinish,
  recordingColor = DEFAULTS.recording,
  showProgress = true,
  trackName,
  className,
  style
}: TrackMapCanvasProps): ReactElement {
  const map = useMemo(() => buildTrackMap(data), [data])

  const rootStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    ...style
  }

  const progress = clamp01(playerPct)
  const recording = map?.recording ?? null
  const label = trackName ?? data?.trackName ?? undefined

  const hasOfficial = Boolean(
    map && map.source === 'iracing-svg' && (map.svgLayers.length > 0 || map.outlinePathD)
  )
  const hasLearned = Boolean(
    map && map.source === 'learned' && map.outlinePathD && map.totalLength > 0
  )
  const hasMap = hasOfficial || hasLearned

  // ── 1. Finished map ───────────────────────────────────────────────────────
  if (map && hasMap) {
    const vb = map.viewBox
    const outlineStroke = trackMapStrokeWidth(vb)
    const pitStroke = trackMapStrokeWidth(vb, 0.55)
    const otherR = trackMapDotRadius(vb, 0.78)
    const playerR = trackMapDotRadius(vb, 1.1)
    const sfStroke = trackMapStrokeWidth(vb, 1.3)

    const playerPt = map.sample(progress)
    const sfMarker = getStartFinishMarker(map)
    const otherCars = drivers
      .filter((d) => !d.isPlayer && d.carIdx !== playerCarIdx && Number.isFinite(d.lapDistPct ?? NaN))
      .map((driver) => ({ driver, pt: map.sample(driver.lapDistPct ?? 0) }))
      .filter((row): row is { driver: DriverEntry; pt: { x: number; y: number } } => row.pt !== null)

    return (
      <div className={className} style={rootStyle}>
        <svg
          viewBox={`${vb[0]} ${vb[1]} ${vb[2]} ${vb[3]}`}
          preserveAspectRatio="xMidYMid meet"
          style={svgStyle}
        >
          {map.source === 'iracing-svg' &&
            map.svgLayers.map((layer) => (
              <svg
                key={layer.key}
                x={vb[0]}
                y={vb[1]}
                width={vb[2]}
                height={vb[3]}
                viewBox={`${layer.viewBox?.[0] ?? vb[0]} ${layer.viewBox?.[1] ?? vb[1]} ${layer.viewBox?.[2] ?? vb[2]} ${layer.viewBox?.[3] ?? vb[3]}`}
                preserveAspectRatio="none"
                style={{ overflow: 'visible' }}
                dangerouslySetInnerHTML={{ __html: layer.innerHtml }}
              />
            ))}

          {map.source !== 'iracing-svg' && map.pitroadPathD && (
            <path
              d={map.pitroadPathD}
              fill="none"
              stroke={pitColor}
              strokeWidth={pitStroke}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.6}
            />
          )}

          {/* The learned map (and the iRacing fallback path when no layers were
              parseable) is drawn as a plain outline. */}
          {((map.source === 'learned') ||
            (map.source === 'iracing-svg' && map.svgLayers.length === 0)) &&
            map.outlinePathD && (
              <path
                d={map.outlinePathD}
                fill="none"
                stroke={outlineColor}
                strokeWidth={outlineStroke}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

          {sfMarker && (
            <line
              x1={sfMarker.x1}
              y1={sfMarker.y1}
              x2={sfMarker.x2}
              y2={sfMarker.y2}
              stroke={startFinishColor}
              strokeWidth={sfStroke}
              strokeLinecap="round"
              opacity={0.9}
            />
          )}

          {otherCars.map(({ driver, pt }) => (
            <circle
              key={driver.carIdx}
              cx={pt.x}
              cy={pt.y}
              r={otherR}
              fill={driver.classColor ?? '#e7f2ff'}
              stroke="#05121f"
              strokeWidth={outlineStroke * 0.4}
              opacity={0.95}
            >
              <title>{`P${driver.position ?? '—'} ${driver.name}`}</title>
            </circle>
          ))}

          {playerPt && (
            <circle
              cx={playerPt.x}
              cy={playerPt.y}
              r={playerR}
              fill={accent}
              stroke="#ffffff"
              strokeWidth={outlineStroke * 0.55}
            >
              <animate attributeName="opacity" values="1;0.7;1" dur="1.4s" repeatCount="indefinite" />
            </circle>
          )}
        </svg>
      </div>
    )
  }

  // ── 2. Live recording trace ───────────────────────────────────────────────
  if (recording && recording.pathD) {
    const vb = recording.viewBox
    const traceStroke = trackMapStrokeWidth(vb, 1.1)
    const headR = trackMapDotRadius(vb, 1.15)
    const head = lastPoint(data?.recording?.polyline)

    return (
      <div className={className} style={rootStyle}>
        <svg
          viewBox={`${vb[0]} ${vb[1]} ${vb[2]} ${vb[3]}`}
          preserveAspectRatio="xMidYMid meet"
          style={svgStyle}
        >
          <path
            d={recording.pathD}
            fill="none"
            stroke={recordingColor}
            strokeWidth={traceStroke}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.95}
          />
          {head && (
            <circle cx={head.x} cy={head.y} r={headR} fill={accent} stroke="#ffffff" strokeWidth={traceStroke * 0.5}>
              <animate attributeName="opacity" values="1;0.6;1" dur="1s" repeatCount="indefinite" />
            </circle>
          )}
        </svg>
        {showProgress && (
          <RecordingBadge label={label} progress={recording.progress} color={recordingColor} />
        )}
      </div>
    )
  }

  // ── 3. Neutral fallback (pre-first-sample) ────────────────────────────────
  const fallbackPlayer = ovalPoint(progress)
  const fallbackCars = drivers
    .filter((d) => !d.isPlayer && d.carIdx !== playerCarIdx && Number.isFinite(d.lapDistPct ?? NaN))
    .slice(0, 12)

  return (
    <div className={className} style={rootStyle}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style={svgStyle}>
        <ellipse cx="50" cy="50" rx="38" ry="30" fill="none" stroke={outlineColor} strokeWidth={1.4} opacity={0.7} />
        <ellipse
          cx="50"
          cy="50"
          rx="38"
          ry="30"
          fill="none"
          stroke={recording ? recordingColor : outlineColor}
          strokeWidth={1}
          strokeDasharray="3 4"
          opacity={0.5}
        />
        {fallbackCars.map((d) => {
          const pt = ovalPoint(clamp01(d.lapDistPct ?? 0))
          return <circle key={d.carIdx} cx={pt.x} cy={pt.y} r={2.4} fill={d.classColor ?? '#e7f2ff'} />
        })}
        <circle cx={50} cy={20} r={2.2} fill={startFinishColor} />
        <circle cx={fallbackPlayer.x} cy={fallbackPlayer.y} r={3.6} fill={accent} stroke="#ffffff" strokeWidth={1}>
          <animate attributeName="opacity" values="1;0.7;1" dur="1.4s" repeatCount="indefinite" />
        </circle>
      </svg>
      {showProgress && (
        <RecordingBadge
          label={label}
          progress={recording?.progress ?? progress}
          color={recording ? recordingColor : accent}
          waiting={!recording}
        />
      )}
    </div>
  )
}

const svgStyle: CSSProperties = { width: '100%', height: '100%', display: 'block', overflow: 'visible' }

function RecordingBadge({
  label,
  progress,
  color,
  waiting = false
}: {
  label?: string
  progress: number
  color: string
  waiting?: boolean
}): ReactElement {
  return (
    <div style={badgeStyles.wrap}>
      <span style={{ ...badgeStyles.dot, background: color }} />
      <span style={badgeStyles.text}>
        {waiting ? 'waiting for a clean lap' : `recording map · ${Math.round(clamp01(progress) * 100)}%`}
      </span>
      {label && <span style={badgeStyles.track}>{label}</span>}
    </div>
  )
}

const badgeStyles: Record<string, CSSProperties> = {
  wrap: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 8px',
    borderRadius: 'var(--radius-sm)',
    background: 'rgba(4, 12, 20, 0.62)',
    color: '#e7f2ff',
    fontSize: 11,
    fontWeight: 800,
    pointerEvents: 'none',
    maxWidth: '92%',
    overflow: 'hidden'
  },
  dot: { width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto' },
  text: { whiteSpace: 'nowrap' },
  track: {
    opacity: 0.7,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  }
}

function lastPoint(points: TrackMapPoint[] | undefined): TrackMapPoint | null {
  if (!points || points.length === 0) return null
  const p = points[points.length - 1]
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null
  return p
}

// Position on the neutral fallback oval (viewBox 0..100), start/finish at top.
function ovalPoint(p: number): { x: number; y: number } {
  const a = -Math.PI / 2 + clamp01(p) * Math.PI * 2
  return { x: 50 + Math.cos(a) * 38, y: 50 + Math.sin(a) * 30 }
}

function clamp01(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}
