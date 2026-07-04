// TEAM FUEL overlay — the team's fuel room: how many cars are in the box and each
// team-mate's fuel-on-board / laps-remaining. Rendered as ONE root <svg> (fixed
// viewBox + preserveAspectRatio="meet"). Data is REUSED from the team-fuel IPC room
// (subscribe/state) exactly as before; only the visuals change. Few laps of fuel =
// warm/red, plenty = green — all via skin tokens. Empty room reads "room offline".

import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { TEAM_FUEL_CHANNELS, type TeamFuelPeer } from '../../../../shared/team-fuel'
import type { WidgetProps } from './types'
import { numberOrDash } from './format'
import { resolveSkin, FitText } from '../../skins'
import { DataField } from '../../instruments'

const DEFAULT_W = 420
const DEFAULT_H = 190

function ageLabel(ts: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000))
  return seconds <= 1 ? 'now' : `${seconds}s`
}

function fuelColor(laps: number | undefined, skin: ReturnType<typeof resolveSkin>): string {
  if (typeof laps !== 'number' || !Number.isFinite(laps)) return skin.palette.textDim
  if (laps < 2) return skin.palette.crit
  if (laps < 5) return skin.palette.warn
  return skin.palette.ok
}

export function TeamFuelWidget({ config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const glass = skin.id === 'hud'
  const W = Math.max(1, Math.round(config?.position?.width ?? DEFAULT_W))
  const H = Math.max(1, Math.round(config?.position?.height ?? DEFAULT_H))

  const [peers, setPeers] = useState<TeamFuelPeer[]>([])
  useEffect(() => {
    const unsubscribe = window.ipc.subscribe<TeamFuelPeer[]>(TEAM_FUEL_CHANNELS.updated, setPeers)
    void window.ipc.invoke<TeamFuelPeer[]>(TEAM_FUEL_CHANNELS.state).then(setPeers).catch(() => undefined)
    return unsubscribe
  }, [])

  const shown = peers.slice(0, 5)
  const empty = shown.length === 0
  const lowFuel = shown.some((p) => typeof p.lapsRemaining === 'number' && Number.isFinite(p.lapsRemaining) && p.lapsRemaining < 2)

  const pad = 12
  const heroW = Math.min(120, W * 0.32)
  const heroX = pad
  const heroY = 34
  const heroH = H - heroY - pad
  const listX = heroX + heroW + 10
  const listW = W - listX - pad
  const listY = heroY
  const listH = heroH
  const rows = Math.max(1, shown.length)
  const rowH = listH / Math.max(rows, 1)

  const colName = listX + 4
  const colL = listX + listW * 0.58
  const colLap = listX + listW * 0.98

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      data-widget="teamFuel"
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

      <FitText x={pad} y={20} boxW={W * 0.6} boxH={16} text="TEAM FUEL" anchor="start" fontFamily={skin.typography.label} fill={skin.palette.textDim} minFontPx={11} maxFontPx={16} letterSpacing={2} />
      {lowFuel ? <circle cx={W - pad - 6} cy={18} r={6} fill={skin.palette.crit} /> : null}

      <DataField x={heroX} y={heroY} width={heroW} height={heroH} label="TEAM" value={String(peers.length)} state={lowFuel ? 'crit' : 'warn'} skin={skin} />

      {empty ? (
        <FitText x={listX + listW / 2} y={listY + listH / 2} boxW={listW - 8} boxH={Math.min(listH - 8, 28)} text="room offline" anchor="middle" fontFamily={skin.typography.label} fill={skin.palette.textDim} minFontPx={12} maxFontPx={22} />
      ) : (
        shown.map((p, i) => {
          const cy = listY + rowH * i + rowH / 2
          const c = fuelColor(p.lapsRemaining, skin)
          const name = `${p.driverName}${p.local ? ' ·me' : ''}`
          return (
            <g key={p.peerId}>
              {i > 0 ? <line x1={listX} y1={listY + rowH * i} x2={listX + listW} y2={listY + rowH * i} stroke={skin.material.border} strokeWidth={1} opacity={0.5} /> : null}
              <FitText x={colName} y={cy} boxW={listW * 0.5} boxH={rowH * 0.7} text={name} anchor="start" fontFamily={skin.typography.label} fill={skin.palette.text} minFontPx={11} maxFontPx={18} overflowStrategy="ellipsis" />
              <FitText x={colL} y={cy} boxW={listW * 0.24} boxH={rowH * 0.7} text={`${numberOrDash(p.fuelLiters, 1)}L`} anchor="end" fontFamily={skin.segment.numeric} fill={skin.palette.textDim} minFontPx={11} maxFontPx={16} />
              <FitText x={colLap} y={cy} boxW={listW * 0.28} boxH={rowH * 0.7} text={`${numberOrDash(p.lapsRemaining, 1)}v`} anchor="end" fontFamily={skin.segment.numeric} fill={c} minFontPx={11} maxFontPx={16} />
            </g>
          )
        })
      )}
    </svg>
  )
}
