// FUEL DELTA / margin overlay — a focused GT3 strategy tile: how much fuel margin is
// left to the flag. Shows the headline MARGIN (laps of surplus over what's needed),
// plus fuel on board, burn per lap, laps-to-empty and the litre delta to finish.
// Rendered as ONE root <svg> (fixed viewBox + preserveAspectRatio="meet") so every
// figure composes without clipping. Green = comfortable surplus, amber = on the edge,
// red = will run dry — all via skin tokens. Divisions are guarded (zero burn never
// yields Infinity); every input degrades to "—" so a null snapshot stays clean.

import type { ReactElement } from 'react'
import { numberOrDash } from './format'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import type { WidgetProps } from './types'
import { resolveSkin, FitText } from '../../skins'
import { DataField } from '../../instruments'

export const FUEL_DELTA_TILE_STREAM_SAFE = true

type Tone = 'good' | 'warn' | 'bad' | 'none'
const DEFAULT_W = 300
const DEFAULT_H = 180

function lapsToEmpty(s: TelemetrySnapshot | null): number | undefined {
  const fuel = s?.fuelLiters
  const perLap = s?.fuelPerLap
  if (fuel === undefined || perLap === undefined) return undefined
  if (!Number.isFinite(fuel) || !Number.isFinite(perLap) || perLap <= 0) return undefined
  return fuel / perLap
}

function marginLaps(s: TelemetrySnapshot | null): number | undefined {
  const toEmpty = lapsToEmpty(s)
  const left = s?.lapsRemaining
  if (toEmpty === undefined || left === undefined || !Number.isFinite(left)) return undefined
  return toEmpty - left
}

function deltaLiters(s: TelemetrySnapshot | null): number | undefined {
  const fuel = s?.fuelLiters
  const perLap = s?.fuelPerLap
  const left = s?.lapsRemaining
  if (fuel === undefined || perLap === undefined || left === undefined) return undefined
  if (!Number.isFinite(fuel) || !Number.isFinite(perLap) || !Number.isFinite(left)) return undefined
  return fuel - perLap * left
}

function tone(margin: number | undefined): Tone {
  if (margin === undefined || !Number.isFinite(margin)) return 'none'
  if (margin >= 1) return 'good'
  if (margin >= 0) return 'warn'
  return 'bad'
}

function signed(value: number | undefined, digits: number): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : value < 0 ? '-' : '±'
  return `${sign}${Math.abs(value).toFixed(digits)}`
}

export function FuelDeltaTileWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const glass = skin.id === 'hud'
  const W = Math.max(1, Math.round(config?.position?.width ?? DEFAULT_W))
  const H = Math.max(1, Math.round(config?.position?.height ?? DEFAULT_H))

  const s = snapshot ?? null
  const margin = marginLaps(s)
  const t = tone(margin)
  const toneHex = t === 'good' ? skin.palette.ok : t === 'warn' ? skin.palette.warn : t === 'bad' ? skin.palette.crit : skin.palette.textDim
  const toneState = t === 'good' ? 'ok' : t === 'warn' ? 'warn' : t === 'bad' ? 'crit' : 'normal'
  const chip = t === 'good' ? 'SAFE' : t === 'warn' ? 'TIGHT' : t === 'bad' ? 'SHORT' : '—'

  const pad = 12
  const heroY = 32
  const heroH = Math.max(34, H * 0.34)
  const gridY = heroY + heroH + 8
  const gridH = Math.max(24, H - gridY - 10)
  const cellW = (W - pad * 2 - 8) / 2
  const cellH = (gridH - 8) / 2
  const col1 = pad + cellW + 8
  const row1 = gridY + cellH + 8

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      data-widget="fuelDeltaTile"
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

      <FitText x={pad} y={20} boxW={W * 0.6} boxH={16} text="Fuel Delta" anchor="start" fontFamily={skin.typography.label} fill={skin.palette.textDim} minFontPx={11} maxFontPx={16} letterSpacing={1} />
      <FitText x={W - pad} y={20} boxW={W * 0.3} boxH={14} text={chip} anchor="end" fontFamily={skin.typography.label} fill={toneHex} minFontPx={11} maxFontPx={13} letterSpacing={1} />

      <DataField x={pad} y={heroY} width={W - pad * 2} height={heroH} label="MARGIN" value={signed(margin, 1)} unit="LAP" state={toneState} skin={skin} />

      <DataField x={pad} y={gridY} width={cellW} height={cellH} label="FUEL" value={numberOrDash(s?.fuelLiters, 1)} unit="L" skin={skin} />
      <DataField x={col1} y={gridY} width={cellW} height={cellH} label="L/LAP" value={numberOrDash(s?.fuelPerLap, 2)} skin={skin} />
      <DataField x={pad} y={row1} width={cellW} height={cellH} label="TO EMPTY" value={numberOrDash(lapsToEmpty(s), 1)} unit="LAP" skin={skin} />
      <DataField x={col1} y={row1} width={cellW} height={cellH} label="DELTA" value={signed(deltaLiters(s), 1)} unit="L" state={toneState} skin={skin} />
    </svg>
  )
}
