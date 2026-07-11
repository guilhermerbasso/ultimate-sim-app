// WEATHER overlay — a compact climate strip: sky condition (dry/rain), air & track
// temperature, grip and track wetness. Rendered as ONE root <svg> (fixed viewBox +
// preserveAspectRatio="meet") so nothing clips. Rain/headlight lamps expose state via
// data-rain / data-headlight. Grip ramps green→amber→red; hot track/air use skin
// tokens. Missing weather never fabricates a confident "Dry" / 0% wet / 100% grip.

import type { ReactElement } from 'react'
import type { WidgetProps } from './types'
import { pctOrUndefined } from './format'
import { resolveSkin, FitText } from '../../skins'
import { DataField } from '../../instruments'
import { useUnitSystem } from '../../lib/units'
import { formatMeasurement } from '../../../../shared/units'

const DEFAULT_W = 360
const DEFAULT_H = 115

type FieldState = 'normal' | 'ok' | 'warn' | 'crit'

function finite(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNight(seconds?: number): boolean {
  if (!finite(seconds)) return false
  const day = ((seconds % 86400) + 86400) % 86400
  return day < 6 * 3600 || day >= 18 * 3600
}

export function WeatherWidget({ snapshot, config }: WidgetProps): ReactElement {
  const unitSystem = useUnitSystem()
  const skin = resolveSkin('gt3', 'generic')
  const glass = skin.id === 'hud'
  const W = Math.max(1, Math.round(config?.position?.width ?? DEFAULT_W))
  const H = Math.max(1, Math.round(config?.position?.height ?? DEFAULT_H))

  const rainingRaw = snapshot?.isRaining
  const raining = rainingRaw === true
  const wetFrac = pctOrUndefined(snapshot?.trackWetnessPct)
  const gripFrac = pctOrUndefined(snapshot?.gripPct)
  const wetN = wetFrac === undefined ? undefined : Math.round(wetFrac * 100)
  const gripN = gripFrac === undefined ? undefined : Math.round(gripFrac * 100)
  const wetStr = wetN === undefined ? '—' : `${wetN}%`
  const gripStr = gripN === undefined ? '—' : `${gripN}%`
  const air = formatMeasurement(snapshot?.airTempC, 'temperature-c', unitSystem, { decimals: 0 })
  const track = formatMeasurement(snapshot?.trackTempC, 'temperature-c', unitSystem, { decimals: 0 })
  const cond = rainingRaw === undefined ? '—' : raining ? 'Rain' : 'Dry'
  const night = isNight(snapshot?.sessionTimeOfDay)
  const rainLampActive = raining || snapshot?.weatherDeclaredWet === true || (wetN !== undefined && wetN > 10)
  const headlightActive = night || raining
  const airHot = finite(snapshot?.airTempC) && (snapshot?.airTempC as number) >= 34
  const trackHot = finite(snapshot?.trackTempC) && (snapshot?.trackTempC as number) >= 45

  const condColor = rainingRaw === undefined ? skin.palette.textDim : raining ? skin.palette.warn : skin.palette.text
  const gripState: FieldState = gripFrac === undefined ? 'normal' : gripFrac >= 0.9 ? 'ok' : gripFrac >= 0.6 ? 'warn' : 'crit'
  const wetState: FieldState = wetN === undefined ? 'normal' : wetN > 30 ? 'warn' : 'normal'
  const airState: FieldState = airHot ? 'warn' : 'normal'
  const trackState: FieldState = !finite(snapshot?.trackTempC) ? 'normal' : trackHot ? 'crit' : (snapshot?.trackTempC as number) > 38 ? 'warn' : 'normal'

  const pad = 10
  const gap = 6
  const headerH = 18
  const gridY = pad + headerH + 4
  const gridH = H - gridY - pad
  const cellW = (W - pad * 2 - gap * 3) / 4
  const x0 = pad
  const x1 = pad + (cellW + gap)
  const x2 = pad + (cellW + gap) * 2
  const x3 = pad + (cellW + gap) * 3

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      data-widget="weather"
      data-rain={rainLampActive ? '1' : '0'}
      data-headlight={headlightActive ? '1' : '0'}
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

      <FitText x={pad} y={pad + 8} boxW={W * 0.4} boxH={16} text={cond} anchor="start" fontFamily={skin.typography.label} fill={condColor} minFontPx={11} maxFontPx={16} letterSpacing={1} />
      <circle cx={W - pad - 18} cy={pad + 6} r={5} fill={rainLampActive ? skin.palette.info : skin.palette.surface} stroke={skin.material.border} strokeWidth={1} />
      <circle cx={W - pad - 4} cy={pad + 6} r={5} fill={headlightActive ? skin.palette.warn : skin.palette.surface} stroke={skin.material.border} strokeWidth={1} />

      <DataField x={x0} y={gridY} width={cellW} height={gridH} label="AIR" value={air.display} unit={air.value === undefined ? undefined : air.unit} state={airState} skin={skin} />
      <DataField x={x1} y={gridY} width={cellW} height={gridH} label="TRACK" value={track.display} unit={track.value === undefined ? undefined : track.unit} state={trackState} skin={skin} />
      <DataField x={x2} y={gridY} width={cellW} height={gridH} label="GRIP" value={gripStr} state={gripState} skin={skin} />
      <DataField x={x3} y={gridY} width={cellW} height={gridH} label="WET" value={wetStr} state={wetState} skin={skin} />
    </svg>
  )
}
