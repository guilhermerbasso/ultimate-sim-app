// TRACK MAP overlay — clean map path only. No track title, learned-map status,
// lap percentage, car count, badges, or car markers.

import { useMemo, type ReactElement } from 'react'
import { overlayDesignFamily, type OverlayDesignFamily } from '../../../../shared/overlays'
import { buildTrackMap, trackMapStrokeWidth, useTrackMapData } from '../../lib/track-map'
import type { WidgetProps } from './types'
import { resolveSkin } from '../../skins'

const DEFAULT_W = 500
const DEFAULT_H = 210

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

export function TrackMapWidget({ config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const glass = skin.id === 'hud'
  const W = Math.max(1, Math.round(config?.position?.width ?? DEFAULT_W))
  const H = Math.max(1, Math.round(config?.position?.height ?? DEFAULT_H))

  const family = overlayDesignFamily(config.stylePreset)
  const { data: trackData } = useTrackMapData()
  const map = useMemo(() => buildTrackMap(trackData), [trackData])

  const accent = config.style?.accent ?? '#ff6a00'
  const outline = mapOutline(family, config.style?.border ?? '#24445d')

  const pad = 8
  const mapX = pad
  const mapY = pad
  const mapW = W - pad * 2
  const mapH = Math.max(20, H - pad * 2)
  const pathD = map?.outlinePathD ?? map?.recording?.pathD ?? null
  const vb = map?.outlinePathD ? map.viewBox : map?.recording?.viewBox
  const stroke = vb ? trackMapStrokeWidth(vb, 1.3) : 1.4

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      data-widget="trackMap"
      role="img"
      aria-label={pathD ? 'Track map path' : 'Track map unavailable'}
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
      <g aria-label="track map material frame">
        <rect x={mapX} y={mapY} width={mapW} height={mapH} rx={8} fill={skin.palette.bg} stroke={skin.material.border} strokeWidth={1} />
        <rect x={mapX + 2.5} y={mapY + 2.5} width={mapW - 5} height={mapH - 5} rx={6} fill="none" stroke={skin.palette.surface} strokeWidth={1} opacity={0.8} />
      </g>

      {pathD && vb ? (
        <svg x={mapX + 3} y={mapY + 3} width={mapW - 6} height={mapH - 6} viewBox={`${vb[0]} ${vb[1]} ${vb[2]} ${vb[3]}`} preserveAspectRatio="xMidYMid meet" overflow="visible">
          <path d={pathD} fill="none" stroke={pathD === map?.recording?.pathD ? accent : outline} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <ellipse cx={W / 2} cy={H / 2} rx={Math.max(10, mapW * 0.36)} ry={Math.max(8, mapH * 0.30)} fill="none" stroke={outline} strokeWidth={1.4} opacity={0.7} />
      )}
    </svg>
  )
}
