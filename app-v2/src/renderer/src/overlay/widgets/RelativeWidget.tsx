// RELATIVE overlay — the cars immediately around you (player-centred ±4 positions)
// rendered as ONE root <svg> (fixed viewBox + preserveAspectRatio="meet") so rows
// never clip. Each cell is a <FitText>: position in the DSEG segment face, last name
// in the condensed label face with an ellipsis strategy, gap in the segment face.
// Proximity drives a hot→neutral threat colour (no decorative green — green stays
// reserved for genuinely good states); the player row is highlighted with the skin
// accent. All colour comes from skin tokens. Reuses the existing relative window sort.

import type { ReactElement } from 'react'
import type { DriverEntry } from '../../../../shared/telemetry'
import type { WidgetProps } from './types'
import { formatDelta } from './format'
import { resolveSkin, FitText } from '../../skins'
import type { SkinToken } from '../../skins'

const DEFAULT_W = 420
const DEFAULT_H = 390

function sortRelative(drivers: DriverEntry[], playerIdx?: number): DriverEntry[] {
  const player = drivers.find((driver) => driver.isPlayer || driver.carIdx === playerIdx)
  if (!player) return drivers.slice(0, 9)
  const byPosition = [...drivers].sort((a, b) => a.position - b.position)
  const playerIndex = byPosition.findIndex((driver) => driver.carIdx === player.carIdx)
  return byPosition.slice(Math.max(0, playerIndex - 4), playerIndex + 5)
}

function lastName(name?: string): string {
  return (name ?? '').split(' ').pop()?.toUpperCase() || '—'
}

// closeness 0..1 (1 = right on top of you) → hot; far = neutral/safe (no decorative
// green — green is reserved for genuinely good states).
function threatColor(gap: number | undefined, skin: SkinToken): string {
  if (gap === undefined || !Number.isFinite(gap)) return skin.palette.textDim
  const close = Math.max(0, Math.min(1, 1 - Math.abs(gap) / 3))
  if (close > 0.7) return skin.palette.crit
  if (close > 0.4) return skin.palette.warn
  return skin.palette.textDim
}

export function RelativeWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const glass = skin.id === 'hud'
  const W = Math.max(1, Math.round(config?.position?.width ?? DEFAULT_W))
  const H = Math.max(1, Math.round(config?.position?.height ?? DEFAULT_H))

  const drivers = sortRelative(snapshot?.drivers ?? [], snapshot?.playerCarIdx)

  const panel = (
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
  )
  const rootProps = {
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: 'xMidYMid meet' as const,
    width: '100%',
    height: '100%',
    'data-widget': 'relative',
    role: 'img',
    style: { display: 'block' as const }
  }

  const pad = 12
  const tw = W - pad * 2

  if (drivers.length === 0) {
    return (
      <svg {...rootProps}>
        {panel}
        <FitText x={W / 2} y={H / 2} boxW={tw} boxH={40} text="—" fontFamily={skin.typography.value} fill={skin.palette.textDim} minFontPx={16} maxFontPx={40} />
      </svg>
    )
  }

  const headH = 22
  const tableTop = pad + headH + 6
  const availH = H - tableTop - pad
  const rowH = Math.min(40, availH / drivers.length)

  const posW = 34
  const numX = pad + posW + 8
  const numW = 40
  const nameX = numX + numW + 8
  const gapW = 92
  const gapRight = pad + tw
  const nameW = Math.max(24, gapRight - gapW - nameX - 8)
  const cellH = Math.min(rowH - 8, 20)

  return (
    <svg {...rootProps}>
      {panel}
      <FitText
        x={pad}
        y={pad + headH / 2}
        boxW={tw}
        boxH={headH}
        text="Relativo"
        anchor="start"
        fontFamily={skin.typography.label}
        fill={skin.palette.textDim}
        weight={700}
        letterSpacing={1}
        minFontPx={11}
        maxFontPx={15}
      />
      {drivers.map((d, i) => {
        const isPlayer = !!(d.isPlayer || d.carIdx === snapshot?.playerCarIdx)
        const ry = tableTop + i * rowH
        const rcy = ry + rowH / 2
        const gapLabel = isPlayer ? 'VOCÊ' : formatDelta(d.gapToPlayerSec)
        const gapNumeric = /^[+\-−±]?\d/.test(gapLabel)
        const gc = isPlayer ? skin.palette.accent : threatColor(d.gapToPlayerSec, skin)
        return (
          <g key={d.carIdx}>
            {isPlayer && (
              <>
                <rect x={pad} y={ry + 1} width={tw} height={rowH - 2} rx={5} fill={skin.palette.accent} opacity={0.16} />
                <rect x={pad} y={ry + 1} width={3} height={rowH - 2} rx={1.5} fill={skin.palette.accent} />
              </>
            )}
            <FitText
              x={pad + posW / 2}
              y={rcy}
              boxW={posW - 8}
              boxH={cellH}
              text={String(d.position)}
              anchor="middle"
              fontFamily={skin.segment.numeric}
              fill={isPlayer ? skin.palette.accent : skin.palette.text}
              minFontPx={11}
              maxFontPx={16}
            />
            <FitText
              x={numX}
              y={rcy}
              boxW={numW}
              boxH={cellH}
              text={`#${d.carNumber}`}
              anchor="start"
              fontFamily={skin.typography.label}
              fill={skin.palette.textDim}
              weight={700}
              minFontPx={11}
              maxFontPx={15}
              overflowStrategy="squeeze"
            />
            <FitText
              x={nameX}
              y={rcy}
              boxW={nameW}
              boxH={cellH}
              text={lastName(d.name)}
              anchor="start"
              fontFamily={skin.typography.label}
              fill={skin.palette.text}
              weight={isPlayer ? 800 : 600}
              minFontPx={11}
              maxFontPx={15}
              overflowStrategy="ellipsis"
            />
            <FitText
              x={gapRight - 6}
              y={rcy}
              boxW={gapW - 10}
              boxH={cellH}
              text={gapLabel}
              anchor="end"
              fontFamily={gapNumeric ? skin.segment.numeric : skin.typography.label}
              fill={gc}
              weight={700}
              minFontPx={11}
              maxFontPx={15}
              overflowStrategy="squeeze"
            />
          </g>
        )
      })}
    </svg>
  )
}
