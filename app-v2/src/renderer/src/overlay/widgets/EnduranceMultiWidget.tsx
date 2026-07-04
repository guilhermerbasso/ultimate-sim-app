// EnduranceMultiWidget — a compact endurance strategy multi-panel, rebuilt on the v2.39
// instrument KIT. One root <svg> (fixed viewBox + preserveAspectRatio); every stint /
// fuel / temperature readout and both tyre corner grids are DataFields laid out on an
// explicit grid — so nothing is sized from an element's height via CSS clamp() (the old
// overflow bug). Skin-token only. A null snapshot degrades each readout to "—".
import type { ReactElement } from 'react'
import type { TyreInfo } from '../../../../shared/telemetry'
import type { WidgetProps } from './types'
import { fuelLaps } from './gt3Telemetry'
import { formatTime } from './format'
import { resolveSkin, FitText } from '../../skins'
import { DataField, type FieldState } from '../../instruments'

export const ENDURANCE_MULTI_STREAM_SAFE = true

const KPA_TO_PSI = 0.1450377

function dims(config: WidgetProps['config']): { W: number; H: number } {
  const w = config?.position?.width
  const h = config?.position?.height
  return {
    W: typeof w === 'number' && w > 0 ? w : 380,
    H: typeof h === 'number' && h > 0 ? h : 320
  }
}

function n0(v: number | undefined): string {
  return v === undefined || !Number.isFinite(v) ? '—' : String(Math.round(v))
}
function n1(v: number | undefined): string {
  return v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(1)
}
function n2(v: number | undefined): string {
  return v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(2)
}

function tempState(c: number | undefined, warn: number, crit: number, cold?: number): FieldState {
  if (c === undefined || !Number.isFinite(c)) return 'normal'
  if (c >= crit) return 'crit'
  if (c >= warn) return 'warn'
  if (cold !== undefined && c < cold) return 'info'
  return 'normal'
}

function tyreTemp(t: TyreInfo | undefined): number | undefined {
  const v = t?.tempC
  return v !== undefined && Number.isFinite(v) ? v : undefined
}
function tyrePsi(t: TyreInfo | undefined): number | undefined {
  const v = t?.pressureKpa
  return v !== undefined && Number.isFinite(v) ? v * KPA_TO_PSI : undefined
}

export function EnduranceMultiWidget({ snapshot, config }: WidgetProps): ReactElement {
  const s = snapshot
  const skin = resolveSkin('gt3', 'generic')
  const { palette } = skin
  const { W, H } = dims(config)

  const laps = fuelLaps(s)
  const fuelState: FieldState = laps === undefined ? 'normal' : laps <= 2 ? 'crit' : laps <= 3.5 ? 'warn' : 'ok'
  const ty = s?.tyres

  const P = Math.max(8, Math.round(Math.min(W, H) * 0.028))
  const G = Math.max(5, Math.round(Math.min(W, H) * 0.02))
  const innerW = W - 2 * P
  const headH = Math.max(18, Math.round(H * 0.07))
  const headY = P
  const rowH = Math.max(46, Math.round(H * 0.16))
  const row3Y = headY + headH + G
  const row4Y = row3Y + rowH + G
  const tyreY = row4Y + rowH + G
  const tyreH = H - P - tyreY

  const w3 = (innerW - 2 * G) / 3
  const x3 = (i: number): number => P + i * (w3 + G)
  const w4 = (innerW - 3 * G) / 4
  const x4 = (i: number): number => P + i * (w4 + G)

  const gridW = (innerW - G) / 2
  const gridHeadH = Math.max(15, tyreH * 0.18)
  const gridCellsY = tyreY + gridHeadH
  const gridCellsH = tyreH - gridHeadH
  const cW = (gridW - G) / 2
  const cH = (gridCellsH - G) / 2

  const df = (
    x: number, y: number, w: number, h: number,
    label: string, value: string, st: FieldState = 'normal', unit?: string
  ): ReactElement => (
    <DataField x={x} y={y} width={w} height={h} label={label} value={value} unit={unit} state={st} ghost={false} skin={skin} />
  )

  const grid = (gx: number, cells: Array<{ label: string; value: string; st: FieldState }>, unit: string): ReactElement[] => {
    const p = [
      { x: gx, y: gridCellsY },
      { x: gx + cW + G, y: gridCellsY },
      { x: gx, y: gridCellsY + cH + G },
      { x: gx + cW + G, y: gridCellsY + cH + G }
    ]
    return cells.map((c, i) => (
      <DataField key={c.label} x={p[i].x} y={p[i].y} width={cW} height={cH} label={c.label} value={c.value} unit={unit} state={c.st} ghost={false} skin={skin} />
    ))
  }

  const header = (gx: number, text: string): ReactElement => (
    <FitText x={gx + gridW / 2} y={tyreY + gridHeadH / 2} boxW={gridW * 0.9} boxH={gridHeadH * 0.82} text={text} anchor="middle" baseline="middle" fontFamily={skin.typography.label} fill={palette.textDim} minFontPx={11} maxFontPx={Math.max(12, gridHeadH * 0.7)} weight={700} letterSpacing={2} />
  )

  return (
    <div className="overlay-card dr-root rd-endurance-multi" data-overlay-id={config?.id} data-widget="enduranceMulti" style={{ width: '100%', height: '100%', overflow: 'hidden', background: palette.bg }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" width="100%" height="100%" style={{ display: 'block' }}>
        <rect x={0} y={0} width={W} height={H} rx={skin.material.radius} fill={palette.bg} />

        <FitText x={P} y={headY + headH / 2} boxW={innerW * 0.9} boxH={headH * 0.82} text="ENDURANCE · STINT" anchor="start" baseline="middle" fontFamily={skin.typography.label} fill={palette.textDim} minFontPx={11} maxFontPx={Math.max(12, headH * 0.7)} weight={800} letterSpacing={2} />

        {df(x3(0), row3Y, w3, rowH, 'STINT', formatTime(s?.sessionTimeRemainingSec), 'warn')}
        {df(x3(1), row3Y, w3, rowH, 'FUEL', n1(s?.fuelLiters), fuelState, 'L')}
        {df(x3(2), row3Y, w3, rowH, 'LAPS FUEL', n1(laps), fuelState)}

        {df(x4(0), row4Y, w4, rowH, 'L/LAP', n2(s?.fuelPerLap))}
        {df(x4(1), row4Y, w4, rowH, 'LAPS LEFT', n0(s?.lapsRemaining), 'accent')}
        {df(x4(2), row4Y, w4, rowH, 'WATER', n0(s?.waterTempC), tempState(s?.waterTempC, 100, 115), '°')}
        {df(x4(3), row4Y, w4, rowH, 'OIL', n0(s?.oilTempC), tempState(s?.oilTempC, 110, 130), '°')}

        {header(P, 'TYRE °C')}
        {grid(P, [
          { label: 'LF', value: n0(tyreTemp(ty?.lf)), st: tempState(tyreTemp(ty?.lf), 95, 105, 70) },
          { label: 'RF', value: n0(tyreTemp(ty?.rf)), st: tempState(tyreTemp(ty?.rf), 95, 105, 70) },
          { label: 'LR', value: n0(tyreTemp(ty?.lr)), st: tempState(tyreTemp(ty?.lr), 95, 105, 70) },
          { label: 'RR', value: n0(tyreTemp(ty?.rr)), st: tempState(tyreTemp(ty?.rr), 95, 105, 70) }
        ], '°')}
        {header(P + gridW + G, 'PRESS PSI')}
        {grid(P + gridW + G, [
          { label: 'LF', value: n1(tyrePsi(ty?.lf)), st: 'normal' },
          { label: 'RF', value: n1(tyrePsi(ty?.rf)), st: 'normal' },
          { label: 'LR', value: n1(tyrePsi(ty?.lr)), st: 'normal' },
          { label: 'RR', value: n1(tyrePsi(ty?.rr)), st: 'normal' }
        ], '')}
      </svg>
    </div>
  )
}
