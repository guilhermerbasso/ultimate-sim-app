// FUEL overlay — fuel on board as a labelled level bar + litres hero + per-lap burn
// and laps-of-autonomy DataFields. Rendered as ONE root <svg> (fixed viewBox +
// preserveAspectRatio="meet") so nothing clips. Cool/green only with healthy margin;
// warm/red when low — all via skin tokens. Unknown fuel/capacity reads as a neutral
// "—" tank (never a confident red 0% / "000%").

import type { ReactElement } from 'react'
import type { WidgetProps } from './types'
import { numberOrDash, pct } from './format'
import { resolveSkin, FitText } from '../../skins'
import { DataField, BarGraph } from '../../instruments'
import { formatMeasurement } from '../../../../shared/units'
import { useUnitSystem } from '../../lib/units'

const DEFAULT_W = 300
const DEFAULT_H = 160

type Tone = 'good' | 'warn' | 'bad' | 'none'

function fuelTone(level: number): 'good' | 'warn' | 'bad' {
  return level > 0.5 ? 'good' : level > 0.25 ? 'warn' : 'bad'
}

export function FuelWidget({ snapshot, config }: WidgetProps): ReactElement {
  const unitSystem = useUnitSystem()
  const skin = resolveSkin('gt3', 'generic')
  const glass = skin.id === 'hud'
  const W = Math.max(1, Math.round(config?.position?.width ?? DEFAULT_W))
  const H = Math.max(1, Math.round(config?.position?.height ?? DEFAULT_H))

  const fuel = snapshot?.fuelLiters
  const capacity = snapshot?.fuelCapacityLiters
  const perLap = snapshot?.fuelPerLap
  const laps = fuel !== undefined && perLap && perLap > 0 ? fuel / perLap : undefined
  const known = capacity !== undefined && capacity > 0 && fuel !== undefined && Number.isFinite(fuel)
  const levelOpt = known ? pct(fuel / (capacity as number)) : undefined
  const level = levelOpt ?? 0
  const tone: Tone = levelOpt === undefined ? 'none' : fuelTone(levelOpt)
  const pctTok = levelOpt === undefined ? '—' : `${(levelOpt * 100).toFixed(0)}%`
  const fuelReading = formatMeasurement(fuel, 'fuel-volume-l', unitSystem, { decimals: 1 })
  const perLapReading = formatMeasurement(perLap, 'fuel-per-lap-l', unitSystem, { decimals: 2 })
  const lapsStr = numberOrDash(laps, 1)

  const toneHex = tone === 'good' ? skin.palette.ok : tone === 'warn' ? skin.palette.warn : tone === 'bad' ? skin.palette.crit : skin.palette.textDim
  const toneState = tone === 'good' ? 'ok' : tone === 'warn' ? 'warn' : tone === 'bad' ? 'crit' : 'normal'

  const pad = 12
  const heroY = 28
  const heroH = Math.max(30, H * 0.28)
  const barY = heroY + heroH + 8
  const barH = Math.max(20, H * 0.18)
  const gridY = barY + barH + 8
  const gridH = Math.max(24, H - gridY - 10)
  const cellW = (W - pad * 2 - 8) / 2

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      data-widget="fuel"
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

      <FitText x={pad} y={19} boxW={W * 0.6} boxH={16} text="FUEL" anchor="start" fontFamily={skin.typography.label} fill={skin.palette.textDim} minFontPx={11} maxFontPx={16} letterSpacing={1} />
      <FitText x={W - pad} y={19} boxW={W * 0.3} boxH={16} text={pctTok} anchor="end" fontFamily={skin.segment.numeric} fill={toneHex} minFontPx={11} maxFontPx={16} />

      <DataField x={pad} y={heroY} width={W - pad * 2} height={heroH} label="FUEL" value={fuelReading.display} unit={fuelReading.unit} state={toneState} skin={skin} />

      <BarGraph
        x={pad}
        y={barY}
        width={W - pad * 2}
        height={barH}
        fraction={level}
        label="LEVEL"
        valueText={pctTok}
        orientation="h"
        invert
        warnAt={known ? 0.5 : undefined}
        critAt={known ? 0.25 : undefined}
        skin={skin}
      />

      <DataField x={pad} y={gridY} width={cellW} height={gridH} label="FUEL/LAP" value={perLapReading.display} unit={perLapReading.unit} skin={skin} />
      <DataField x={pad + cellW + 8} y={gridY} width={cellW} height={gridH} label="AUTONOMIA" value={lapsStr} unit="V" state={toneState} skin={skin} />
    </svg>
  )
}
