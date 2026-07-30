// SESSION + WEATHER overlay — a compact strategy strip: session type + time left,
// track name, sky condition (dry/rain + wetness), plus current lap, lap time, the
// incident sheet and track temperature. Rendered as ONE root <svg> (fixed viewBox +
// preserveAspectRatio="meet") so nothing clips. Rain/headlight lamps expose their
// state via data-rain / data-headlight. Hot track + declared-wet use skin tokens.

import type { ReactElement } from 'react'
import type { WidgetProps } from './types'
import { formatTime, pctOrUndefined } from './format'
import { resolveSkin, FitText } from '../../skins'
import { DataField } from '../../instruments'
import { formatMeasurement } from '../../../../shared/units'
import { useUnitSystem } from '../../lib/units'

const DEFAULT_W = 430
const DEFAULT_H = 210

type FieldState = 'normal' | 'ok' | 'warn' | 'crit'

function finite(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function cleanText(value: string | undefined): string {
  const trimmed = value?.trim()
  return trimmed && trimmed.length ? trimmed : '—'
}

function formatRemaining(seconds?: number): string {
  if (!finite(seconds) || seconds < 0) return '—'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, '0')}`
  return `${minutes}m`
}

function formatLap(seconds?: number): string {
  return finite(seconds) ? formatTime(seconds) : '—'
}

function isNight(seconds?: number): boolean {
  if (!finite(seconds)) return false
  const day = ((seconds % 86400) + 86400) % 86400
  return day < 6 * 3600 || day >= 18 * 3600
}

export function SessionWeatherWidget({ snapshot, config }: WidgetProps): ReactElement {
  const unitSystem = useUnitSystem()
  const skin = resolveSkin('gt3', 'generic')
  const glass = skin.id === 'hud'
  const W = Math.max(1, Math.round(config?.position?.width ?? DEFAULT_W))
  const H = Math.max(1, Math.round(config?.position?.height ?? DEFAULT_H))

  const session = cleanText(snapshot?.sessionType)
  const remaining = formatRemaining(snapshot?.sessionTimeRemainingSec)
  const track = cleanText(snapshot?.trackName)
  const rainingRaw = snapshot?.isRaining
  const raining = rainingRaw === true
  const wetFrac = pctOrUndefined(snapshot?.trackWetnessPct)
  const wetN = wetFrac === undefined ? undefined : Math.round(wetFrac * 100)
  const condTxt = rainingRaw === undefined ? '—' : raining ? 'Rain' : 'Dry'
  const cond = `${condTxt} · Wet ${wetN === undefined ? '—' : `${wetN}%`}`
  const incidents = finite(snapshot?.incidentCount)
    ? `${Math.round(snapshot.incidentCount as number)}/${finite(snapshot?.incidentLimit) && (snapshot?.incidentLimit as number) > 0 ? Math.round(snapshot.incidentLimit as number) : '—'}`
    : '—'
  const trackHot = finite(snapshot?.trackTempC) && (snapshot?.trackTempC as number) >= 45
  const night = isNight(snapshot?.sessionTimeOfDay)
  const rainLampActive = raining || snapshot?.weatherDeclaredWet === true || (wetN !== undefined && wetN > 10)
  const headlightActive = night || raining

  const lapVal = finite(snapshot?.currentLap) ? String(Math.round(snapshot?.currentLap as number)) : '—'
  const atualVal = formatLap(snapshot?.currentLapTimeSec)
  const trackTemp = formatMeasurement(snapshot?.trackTempC, 'temperature-c', unitSystem, { decimals: 0 })
  const incState: FieldState = incidents.startsWith('0/') ? 'ok' : 'normal'
  const pistaState: FieldState = trackHot ? 'crit' : 'normal'
  const condColor = rainingRaw === undefined ? skin.palette.textDim : raining ? skin.palette.warn : skin.palette.text

  const pad = 12
  const gap = 6
  const infoY = 36
  const gridY = 62
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
      data-widget="sessionWeather"
      data-rain={rainLampActive ? '1' : '0'}
      data-headlight={headlightActive ? '1' : '0'}
      role="img" aria-label="Session and weather summary"
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

      <FitText x={pad} y={19} boxW={W * 0.6} boxH={18} text={session} anchor="start" fontFamily={skin.typography.label} fill={skin.palette.text} minFontPx={11} maxFontPx={18} letterSpacing={1} />
      <FitText x={W - pad} y={19} boxW={W * 0.3} boxH={16} text={remaining} anchor="end" fontFamily={skin.segment.numeric} fill={skin.palette.textDim} minFontPx={11} maxFontPx={16} />

      <FitText x={pad} y={infoY + 8} boxW={W * 0.5} boxH={16} text={track} anchor="start" fontFamily={skin.typography.label} fill={skin.palette.textDim} minFontPx={11} maxFontPx={15} overflowStrategy="ellipsis" />
      <circle cx={W - pad - 60} cy={infoY + 6} r={5} fill={rainLampActive ? skin.palette.info : skin.palette.surface} stroke={skin.material.border} strokeWidth={1} />
      <circle cx={W - pad - 44} cy={infoY + 6} r={5} fill={headlightActive ? skin.palette.warn : skin.palette.surface} stroke={skin.material.border} strokeWidth={1} />
      <FitText x={W - pad - 34} y={infoY + 6} boxW={W * 0.32} boxH={16} text={cond} anchor="start" fontFamily={skin.typography.label} fill={condColor} minFontPx={11} maxFontPx={14} overflowStrategy="ellipsis" />

      <DataField x={pad} y={gridY} width={cellW} height={cellH} label="Lap" value={lapVal} skin={skin} />
      <DataField x={col1} y={gridY} width={cellW} height={cellH} label="Atual" value={atualVal} skin={skin} />
      <DataField x={pad} y={row1} width={cellW} height={cellH} label="Inc." value={incidents} state={incState} skin={skin} />
      <DataField x={col1} y={row1} width={cellW} height={cellH} label="Pista" value={trackTemp.display} unit={trackTemp.value === undefined ? undefined : trackTemp.unit} state={pistaState} skin={skin} />
    </svg>
  )
}
