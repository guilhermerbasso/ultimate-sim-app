// DELTA / LAP overlay — a broadcast-style delta readout rendered as ONE root <svg>
// (fixed viewBox + preserveAspectRatio="meet") so nothing clips. A centre-zero delta
// bar slides green (faster) / red (slower); the signed delta is a big DSEG readout;
// current/last/best lap times are labelled DataFields. All colour via skin tokens.

import type { ReactElement } from 'react'
import type { WidgetProps } from './types'
import { formatDelta, formatTime } from './format'
import { resolveSkin, FitText } from '../../skins'
import { DataField } from '../../instruments'

const MAX_DELTA = 2 // seconds of bar travel each way
const DEFAULT_W = 380
const DEFAULT_H = 150

export function DeltaLapWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const glass = skin.id === 'hud'
  const W = Math.max(1, Math.round(config?.position?.width ?? DEFAULT_W))
  const H = Math.max(1, Math.round(config?.position?.height ?? DEFAULT_H))

  const delta = snapshot?.deltaToBestSec ?? snapshot?.deltaToSessionBestSec
  const known = delta !== undefined && Number.isFinite(delta)
  const good = known && (delta as number) <= 0
  const deltaStr = formatDelta(delta)
  const cur = formatTime(snapshot?.currentLapTimeSec)
  const lst = formatTime(snapshot?.lastLapTimeSec)
  const bst = formatTime(snapshot?.bestLapTimeSec)

  const deltaFill = !known ? skin.palette.textDim : good ? skin.palette.deltaFaster : skin.palette.deltaSlower

  // centre-zero bar geometry
  const barX = 20
  const barY = 74
  const barW = W - 40
  const barH = 14
  const midX = barX + barW / 2
  const frac = known ? Math.max(-1, Math.min(1, (delta as number) / MAX_DELTA)) : 0
  const half = barW / 2
  const fillW = Math.abs(frac) * half
  const fillX = frac <= 0 ? midX - fillW : midX

  const tileW = (W - 32 - 24) / 3
  const tileY = 96
  const tileH = H - tileY - 12

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      data-widget="deltaLap"
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

      <FitText x={20} y={22} boxW={120} boxH={16} text="DELTA" anchor="start" fontFamily={skin.typography.label} fill={skin.palette.textDim} minFontPx={11} maxFontPx={16} letterSpacing={2} />

      <FitText x={W / 2} y={46} boxW={W - 60} boxH={40} text={deltaStr} anchor="middle" fontFamily={skin.segment.numeric} fill={deltaFill} weight={700} minFontPx={14} maxFontPx={44} />

      <rect x={barX} y={barY} width={barW} height={barH} rx={barH / 2} fill={skin.palette.surface} stroke={skin.material.border} strokeWidth={1} />
      {known && fillW > 0.5 ? (
        <rect x={fillX} y={barY} width={fillW} height={barH} rx={barH / 2} fill={deltaFill} />
      ) : null}
      <line x1={midX} y1={barY - 3} x2={midX} y2={barY + barH + 3} stroke={skin.palette.text} strokeWidth={2} />

      <DataField x={16} y={tileY} width={tileW} height={tileH} label="ATUAL" value={cur} skin={skin} state="normal" />
      <DataField x={16 + tileW + 12} y={tileY} width={tileW} height={tileH} label="ÚLTIMO" value={lst} skin={skin} state="normal" />
      <DataField x={16 + (tileW + 12) * 2} y={tileY} width={tileW} height={tileH} label="MELHOR" value={bst} skin={skin} state="accent" />
    </svg>
  )
}
