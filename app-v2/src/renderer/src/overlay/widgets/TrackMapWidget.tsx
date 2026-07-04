// TRACK MAP overlay — the live circuit trace with the player + nearby cars. Rendered
// as ONE root <svg> (fixed viewBox + preserveAspectRatio="meet") so the frame + lap
// readouts never clip. The map itself stays a real <canvas> (shared TrackMapCanvas)
// hosted in a <foreignObject>; all data is REUSED unchanged (useTrackMapData +
// nearbyDrivers). Chrome (track name, lap %, car count) uses skin tokens + FitText.

import { type ReactElement } from 'react'
import type { DriverEntry } from '../../../../shared/telemetry'
import { overlayDesignFamily, type OverlayDesignFamily } from '../../../../shared/overlays'
import { TrackMapCanvas } from '../../components/TrackMapCanvas'
import { useTrackMapData } from '../../lib/track-map'
import type { WidgetProps } from './types'
import { pct } from './format'
import { resolveSkin, FitText } from '../../skins'
import { DataField } from '../../instruments'

const DEFAULT_W = 500
const DEFAULT_H = 210

// Keep the player + a window of the closest cars so a busy grid doesn't turn the
// map into confetti.
function nearbyDrivers(drivers: DriverEntry[], playerCarIdx?: number): DriverEntry[] {
  const player = drivers.find((driver) => driver.isPlayer || driver.carIdx === playerCarIdx)
  const filtered = drivers.filter((d) => d.lapDistPct !== undefined && Number.isFinite(d.lapDistPct))
  if (!player || player.lapDistPct === undefined) return filtered.slice(0, 18)
  return [...filtered]
    .sort(
      (a, b) =>
        Math.abs((a.lapDistPct ?? 0) - (player.lapDistPct as number)) -
        Math.abs((b.lapDistPct ?? 0) - (player.lapDistPct as number))
    )
    .slice(0, 18)
}

function safeLapPct(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function pctText(value: number | undefined): string {
  return value === undefined ? '—' : `${Math.round(value * 100)}%`
}

function recordingText(progress: number | undefined): string {
  return progress === undefined || !Number.isFinite(progress) ? 'recording —' : `recording ${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`
}

// Per-family stroke weight + marker treatment for the map polyline. Geometry is
// untouched — only the line's heft and colour change.
function mapOutline(family: OverlayDesignFamily, border: string): string {
  switch (family) {
    case 'minimal':
      return 'rgba(180, 198, 220, 0.34)'
    case 'terminal':
      return 'rgba(120, 255, 170, 0.42)'
    case 'broadcast':
      return 'rgba(225, 232, 240, 0.62)'
    case 'bauhaus':
      return 'rgba(245, 247, 250, 0.9)'
    case 'analog':
      return 'rgba(206, 170, 110, 0.55)'
    default:
      return border
  }
}

export function TrackMapWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const glass = skin.id === 'hud'
  const W = Math.max(1, Math.round(config?.position?.width ?? DEFAULT_W))
  const H = Math.max(1, Math.round(config?.position?.height ?? DEFAULT_H))

  const family = overlayDesignFamily(config.stylePreset)
  const { data: trackData, status: trackStatus } = useTrackMapData()

  const drivers = nearbyDrivers(snapshot?.drivers ?? [], snapshot?.playerCarIdx)
  const rawPlayerPct = safeLapPct(snapshot?.lapDistPct)
  const playerPct = pct(rawPlayerPct)
  const accent = config.style?.accent ?? '#ff6a00'
  const outline = mapOutline(family, config.style?.border ?? '#24445d')

  const source = trackData?.source
  const recording = trackData?.recording
  const metaRight =
    source === 'iracing-svg'
      ? 'iRacing SVG'
      : source === 'learned'
        ? 'learned map'
        : recording?.active
          ? recordingText(recording.progress)
          : trackStatus?.auth === 'unconfigured'
            ? 'add iRacing login or drive one clean lap'
            : 'waiting for telemetry'

  const trackName = trackData?.trackName ?? trackStatus?.currentTrackName ?? snapshot?.trackName ?? 'Track'
  const lapText = pctText(rawPlayerPct)
  const lapValue = lapText.endsWith('%') ? lapText.slice(0, -1) : lapText
  const hasLap = lapValue !== '—'

  const pad = 8
  const headerH = 22
  const footH = 42
  const mapX = pad
  const mapY = pad + headerH
  const mapW = W - pad * 2
  const mapH = Math.max(20, H - mapY - footH - pad)
  const footY = H - footH
  const tileW = 92
  const tileH = footH - pad

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      data-widget="trackMap"
      role="img"
      style={{ display: 'block' }}
    >
      <rect
        x={1}
        y={1}
        width={W - 2}
        height={H - 2}
        rx={skin.material.radius}
        fill={skin.material.base}
        stroke={skin.material.border}
        strokeWidth={skin.material.borderWidth}
        opacity={glass ? skin.material.panelAlpha ?? 1 : 1}
      />

      <FitText x={pad + 2} y={pad + 9} boxW={W * 0.55} boxH={16} text={trackName} anchor="start" fontFamily={skin.typography.label} fill={skin.palette.text} minFontPx={11} maxFontPx={16} overflowStrategy="ellipsis" />
      <FitText x={W - pad - 2} y={pad + 9} boxW={W * 0.3} boxH={14} text={metaRight} anchor="end" fontFamily={skin.typography.label} fill={skin.palette.textDim} minFontPx={11} maxFontPx={13} overflowStrategy="ellipsis" />

      <g aria-label="track map material frame">
        <rect x={mapX} y={mapY} width={mapW} height={mapH} rx={8} fill={skin.palette.bg} stroke={skin.material.border} strokeWidth={1} />
        <rect x={mapX + 2.5} y={mapY + 2.5} width={mapW - 5} height={mapH - 5} rx={6} fill="none" stroke={skin.palette.surface} strokeWidth={1} opacity={0.8} />
      </g>

      <foreignObject x={mapX + 3} y={mapY + 3} width={mapW - 6} height={mapH - 6}>
        <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', borderRadius: 6 }}>
          <TrackMapCanvas
            data={trackData}
            playerPct={playerPct}
            drivers={drivers}
            playerCarIdx={snapshot?.playerCarIdx}
            accent={accent}
            outlineColor={outline}
            className="rd3-map-canvas"
            showProgress
          />
        </div>
      </foreignObject>

      <DataField x={pad} y={footY} width={tileW} height={tileH} label="LAP" value={lapValue} unit={hasLap ? '%' : undefined} skin={skin} />
      <DataField x={pad + tileW + 8} y={footY} width={tileW * 0.75} height={tileH} label="CARS" value={String(drivers.length)} skin={skin} />
    </svg>
  )
}
