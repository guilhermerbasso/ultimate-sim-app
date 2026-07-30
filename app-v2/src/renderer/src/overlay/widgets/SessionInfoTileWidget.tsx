// SESSION INFO overlay — a compact GT3 pit-board tile: session type + clock, laps
// left (or current lap), running order, incident sheet and Strength of Field.
// Rendered as ONE root <svg> (fixed viewBox + preserveAspectRatio="meet") so nothing
// clips. Incidents ramp green→amber→red toward the session limit — all skin tokens.

import type { ReactElement } from 'react'
import type { WidgetProps } from './types'
import { resolveSkin, FitText } from '../../skins'
import { DataField } from '../../instruments'

export const SESSION_INFO_TILE_STREAM_SAFE = true

const DEFAULT_W = 360
const DEFAULT_H = 150

type FieldState = 'normal' | 'ok' | 'warn' | 'crit'

function finite(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function formatClock(sec: number | undefined): string {
  if (!finite(sec) || sec < 0) return '—'
  const total = Math.floor(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

function incidentState(count: number | undefined, limit: number | undefined): FieldState {
  if (!finite(count)) return 'normal'
  if (finite(limit) && limit > 0) {
    const ratio = count / limit
    if (ratio >= 0.85) return 'crit'
    if (ratio >= 0.6) return 'warn'
    return 'ok'
  }
  return count <= 0 ? 'ok' : 'normal'
}

export function SessionInfoTileWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const W = Math.max(1, Math.round(config?.position?.width ?? DEFAULT_W))
  const H = Math.max(1, Math.round(config?.position?.height ?? DEFAULT_H))

  const s = snapshot
  const sessionType = s?.sessionType?.trim()
  const sessionLabel = sessionType && sessionType.length ? sessionType.toUpperCase() : '—'
  const clock = formatClock(s?.sessionTimeRemainingSec)
  const lapsLeft = s?.lapsRemaining
  const lapStr = finite(lapsLeft) ? String(Math.round(lapsLeft)) : finite(s?.currentLap) ? String(Math.round(s.currentLap as number)) : '—'
  const lapLabel = finite(lapsLeft) ? 'LAPS LEFT' : 'LAP'
  const posStr = finite(s?.position) ? String(Math.round(s.position as number)) : '—'
  const posUnit = finite(s?.totalCars) ? `/ ${Math.round(s.totalCars as number)}` : undefined
  const incStr = finite(s?.incidentCount) ? String(Math.round(s.incidentCount as number)) : '—'
  const incUnit = finite(s?.incidentLimit) && (s?.incidentLimit as number) > 0 ? `x / ${Math.round(s.incidentLimit as number)}` : incStr === '—' ? undefined : 'x'
  const incState = incidentState(s?.incidentCount, s?.incidentLimit)
  const sof = finite(s?.strengthOfField) ? Math.round(s.strengthOfField as number) : undefined

  const pad = 10
  const gap = 6
  const headerH = 20
  const gridY = pad + headerH + 4
  const gridH = H - gridY - pad
  const cellW = (W - pad * 2 - gap) / 2
  const cellH = (gridH - gap) / 2
  const col1 = pad + cellW + gap
  const row1 = gridY + cellH + gap

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      data-widget="sessionInfoTile"
      role="img" aria-label="Session information"
      style={{ display: 'block' }}
    >
      {s?.sessionState !== undefined ? <rect x={pad} y={pad + 2} width={10} height={12} rx={2} fill={skin.palette.accent} /> : null}
      <FitText x={s?.sessionState !== undefined ? pad + 16 : pad} y={pad + 10} boxW={W * 0.45} boxH={16} text={sessionLabel} anchor="start" fontFamily={skin.typography.label} fill={skin.palette.text} minFontPx={11} maxFontPx={18} letterSpacing={1} />
      {sof !== undefined ? <FitText x={W - pad} y={pad + 10} boxW={W * 0.46} boxH={16} text={`SOF ${sof}`} anchor="end" fontFamily={skin.typography.label} fill={skin.palette.textDim} minFontPx={9} maxFontPx={14} /> : null}

      <DataField x={pad} y={gridY} width={cellW} height={cellH} label="TIME LEFT" value={clock} panel={false} skin={skin} />
      <DataField x={col1} y={gridY} width={cellW} height={cellH} label={lapLabel} value={lapStr} panel={false} skin={skin} />
      <DataField x={pad} y={row1} width={cellW} height={cellH} label="POS" value={posStr} unit={posUnit} panel={false} skin={skin} />
      <DataField x={col1} y={row1} width={cellW} height={cellH} label="INC" value={incStr} unit={incUnit} state={incState} panel={false} skin={skin} />
    </svg>
  )
}
