// RingDashWidget — full-frame GT3 circular-cluster dashboard rebuilt on the v2.39
// instrument KIT. One root <svg> (fixed viewBox + preserveAspectRatio); the central
// RPM/shift ring is the shared AnalogDial primitive, the gear hero is auto-fit FitText
// inside it, and every surrounding value is a DataField — so nothing is sized from an
// element's height via CSS clamp() (the old overflow bug). Brand-neutral, skin-token
// only. Null/partial snapshot degrades every readout to "—" (never NaN/Infinity).
import type { ReactElement } from 'react'
import type { TyreInfo } from '../../../../shared/telemetry'
import type { WidgetProps } from './types'
import { formatGear, formatTime } from './format'
import { resolveSkin, FitText, zoneColor, type SkinToken } from '../../skins'
import { AnalogDial, DataField, type FieldState } from '../../instruments'
import { formatMeasurement, measurementUnit } from '../../../../shared/units'
import { useUnitSystem } from '../../lib/units'
import {
  SHIFT_STROBE_BLUE,
  ShiftStrobe,
  atShiftPoint,
  resolveRevLightPct,
  resolveRpmGaugePct
} from '../../lib/rev-lights'

function dims(config: WidgetProps['config']): { W: number; H: number } {
  const w = config?.position?.width
  const h = config?.position?.height
  return {
    W: typeof w === 'number' && w > 0 ? w : 1024,
    H: typeof h === 'number' && h > 0 ? h : 600
  }
}

function n0(v: number | undefined): string {
  return v === undefined || !Number.isFinite(v) ? '—' : String(Math.round(v))
}
function n1(v: number | undefined): string {
  return v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(1)
}
function tempState(c: number | undefined, warn: number, crit: number, cold?: number): FieldState {
  if (c === undefined || !Number.isFinite(c)) return 'normal'
  if (c >= crit) return 'crit'
  if (c >= warn) return 'warn'
  if (cold !== undefined && c < cold) return 'info'
  return 'normal'
}

function levelText(v: number | string | undefined): string {
  if (v === undefined || v === null) return '—'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '—'
  const t = String(v).trim()
  return t.length ? t : '—'
}

function stateColor(state: FieldState, skin: SkinToken): string {
  const p = skin.palette
  return state === 'ok'
    ? p.ok
    : state === 'warn'
      ? p.warn
      : state === 'crit'
        ? p.crit
        : state === 'info'
          ? p.info
          : state === 'accent'
            ? p.accent
            : p.textDim
}

function vstack(x: number, y: number, w: number, h: number, count: number, gap: number): Array<{ x: number; y: number; w: number; h: number }> {
  const n = Math.max(1, count)
  const ch = (h - gap * (n - 1)) / n
  return Array.from({ length: n }, (_, i) => ({ x, y: y + i * (ch + gap), w, h: ch }))
}

function tempC(t: TyreInfo | undefined): number | undefined {
  return t?.tempC
}

export function RingDashWidget({ snapshot, config }: WidgetProps): ReactElement {
  const unitSystem = useUnitSystem()
  const s = snapshot
  const skin = resolveSkin('gt3', 'generic')
  const { palette } = skin
  const { W, H } = dims(config)

  const P = Math.max(6, Math.round(Math.min(W, H) * 0.02))
  const G = Math.max(4, Math.round(Math.min(W, H) * 0.014))

  const rpmPct = resolveRpmGaugePct(s)
  const shiftPct = resolveRevLightPct(s)
  const shiftActive = atShiftPoint(shiftPct, s?.revLights?.blink, 0.95)
  const gear = formatGear(s?.gear)
  const sessionLabel = (s?.sessionType ?? 'RACE').toUpperCase()
  const yellowFlag = !!s?.flags?.yellow
  const inPit = !!(s?.onPitRoad || s?.pitLimiter)
  const ty = s?.tyres
  const fuel = formatMeasurement(s?.fuelLiters, 'fuel-volume-l', unitSystem, { decimals: 1 })
  const fuelPerLap = formatMeasurement(s?.fuelPerLap, 'fuel-per-lap-l', unitSystem, { decimals: 2 })
  const speed = formatMeasurement(s?.speedKmh, 'speed-kmh', unitSystem, { decimals: 0 })
  const waterTemp = formatMeasurement(s?.waterTempC, 'temperature-c', unitSystem, { decimals: 0 })

  const topH = Math.max(46, Math.min(84, Math.round(H * 0.12)))
  const botH = Math.max(52, Math.min(112, Math.round(H * 0.16)))
  const cTop = P + topH + G
  const cBot = H - P - botH - G
  const cH = cBot - cTop

  const sideW = Math.max(150, Math.min(280, Math.round(W * 0.24)))
  const leftX = P
  const rightX = W - P - sideW
  const midX = leftX + sideW + G
  const midW = rightX - G - midX

  const [fuelR, flapR, spdR, watR] = vstack(leftX, cTop, sideW, cH, 4, G)

  const rightTopH = cH * 0.42
  const rightBotY = cTop + rightTopH + G
  const rightBotH = cBot - rightBotY
  const [lastR, bestR] = vstack(rightX, cTop, sideW, rightTopH, 2, G)
  const tCellW = (sideW - G) / 2
  const tCellH = (rightBotH - G) / 2

  const cx = midX + midW / 2
  const cy = cTop + cH / 2
  const dialSize = Math.max(120, Math.min(midW, cH))
  const dialX = cx - dialSize / 2
  const dialY = cy - dialSize / 2
  const ringColor = zoneColor(skin.led, rpmPct)

  const stripThirds = (W - 2 * P - 2 * G) / 3
  const pitR = { x: P, y: P, w: stripThirds, h: topH }
  const sessR = { x: P + stripThirds + G, y: P, w: stripThirds, h: topH }
  const fcyR = { x: P + 2 * (stripThirds + G), y: P, w: stripThirds, h: topH }

  const bCells = 4
  const bW = (W - 2 * P - G * (bCells - 1)) / bCells
  const bY = H - P - botH
  const bx = (i: number): number => P + i * (bW + G)

  const df = (
    r: { x: number; y: number; w: number; h: number },
    label: string,
    value: string,
    st: FieldState = 'normal',
    unit?: string
  ): ReactElement => (
    <DataField x={r.x} y={r.y} width={r.w} height={r.h} label={label} value={value} unit={unit} state={st} ghost={false} skin={skin} />
  )

  return (
    <div className="overlay-card dr-root rd-ring-dash" data-overlay-id={config?.id} data-widget="ringDash" style={{ width: '100%', height: '100%', overflow: 'hidden', background: palette.bg }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" width="100%" height="100%" style={{ display: 'block' }}>
        <rect x={0} y={0} width={W} height={H} fill={palette.bg} />

        {df(pitR, 'PIT', inPit ? 'IN' : 'OFF', inPit ? 'info' : 'normal')}
        <rect x={sessR.x} y={sessR.y} width={sessR.w} height={sessR.h} rx={skin.material.radius} fill={skin.material.base} stroke={palette.textDim} strokeWidth={skin.material.borderWidth} />
        <FitText
          x={sessR.x + sessR.w / 2}
          y={sessR.y + sessR.h / 2}
          boxW={sessR.w * 0.9}
          boxH={sessR.h * 0.7}
          text={sessionLabel}
          anchor="middle"
          baseline="middle"
          fontFamily={skin.typography.label}
          fill={palette.text}
          minFontPx={12}
          maxFontPx={Math.max(14, sessR.h * 0.5)}
          weight={700}
          letterSpacing={3}
          overflowStrategy="squeeze"
        />
        {df(fcyR, 'FCY', yellowFlag ? 'YELLOW' : 'GREEN', yellowFlag ? 'warn' : 'ok')}

        {df(fuelR, 'FUEL', fuel.display, 'normal', fuel.unit)}
        {df(flapR, 'FUEL/LAP', fuelPerLap.display, 'accent', fuelPerLap.unit)}
        {df(spdR, 'SPEED', speed.display, 'normal', speed.unit.toUpperCase())}
        {df(watR, 'WATER', waterTemp.display, tempState(s?.waterTempC, 108, 120), waterTemp.unit)}

        {df(lastR, 'LAST', formatTime(s?.lastLapTimeSec))}
        {df(bestR, 'BEST', formatTime(s?.bestLapTimeSec), 'info')}
        {df({ x: rightX, y: rightBotY, w: tCellW, h: tCellH }, 'LF', formatMeasurement(tempC(ty?.lf), 'temperature-c', unitSystem, { decimals: 0 }).display, tempState(tempC(ty?.lf), 100, 110, 70), measurementUnit('temperature-c', unitSystem))}
        {df({ x: rightX + tCellW + G, y: rightBotY, w: tCellW, h: tCellH }, 'RF', formatMeasurement(tempC(ty?.rf), 'temperature-c', unitSystem, { decimals: 0 }).display, tempState(tempC(ty?.rf), 100, 110, 70), measurementUnit('temperature-c', unitSystem))}
        {df({ x: rightX, y: rightBotY + tCellH + G, w: tCellW, h: tCellH }, 'LR', formatMeasurement(tempC(ty?.lr), 'temperature-c', unitSystem, { decimals: 0 }).display, tempState(tempC(ty?.lr), 100, 110, 70), measurementUnit('temperature-c', unitSystem))}
        {df({ x: rightX + tCellW + G, y: rightBotY + tCellH + G, w: tCellW, h: tCellH }, 'RR', formatMeasurement(tempC(ty?.rr), 'temperature-c', unitSystem, { decimals: 0 }).display, tempState(tempC(ty?.rr), 100, 110, 70), measurementUnit('temperature-c', unitSystem))}

        <g
          data-shift-cue="ring-needle-gear"
          data-shift-active={shiftActive ? 'true' : 'false'}
          data-rpm-pct={rpmPct.toFixed(4)}
        >
          <ShiftStrobe active={shiftActive} />
          <g data-shift-part="needle" transform={`translate(${dialX}, ${dialY})`}>
            <AnalogDial
              value={rpmPct * 100}
              min={0}
              max={100}
              size={dialSize}
              startAngleDeg={-135}
              endAngleDeg={135}
              showTicks
              majorTicks={11}
              minorPerMajor={1}
              showValue={false}
              bezel="thin"
              material="carbon"
              warnFrom={80}
              redlineFrom={95}
              needleColor={shiftActive ? SHIFT_STROBE_BLUE : ringColor}
              idPrefix="ring-dial"
            />
          </g>
          {shiftActive ? (
            <circle data-shift-part="ring" cx={cx} cy={cy} r={dialSize / 2 - 6} fill="none" stroke={SHIFT_STROBE_BLUE} strokeWidth={6} />
          ) : null}
          <g data-shift-part="gear">
            <FitText
              x={cx}
              y={cy - dialSize * 0.02}
              boxW={dialSize * 0.42}
              boxH={dialSize * 0.44}
              text={gear}
              anchor="middle"
              baseline="middle"
              fontFamily={/^\d$/.test(gear) ? skin.segment.numeric : skin.segment.alpha}
              fill={shiftActive ? SHIFT_STROBE_BLUE : palette.text}
              minFontPx={24}
              maxFontPx={dialSize * 0.44}
            />
          </g>
        </g>
        <FitText
          x={cx}
          y={cy + dialSize * 0.3}
          boxW={dialSize * 0.36}
          boxH={dialSize * 0.1}
          text="GT3"
          anchor="middle"
          baseline="middle"
          fontFamily={skin.typography.label}
          fill={palette.textDim}
          minFontPx={11}
          maxFontPx={Math.max(12, dialSize * 0.09)}
          weight={700}
          letterSpacing={4}
        />

        {df({ x: bx(0), y: bY, w: bW, h: botH }, 'LAP', n0(s?.currentLap), 'accent')}
        {df({ x: bx(1), y: bY, w: bW, h: botH }, 'TC', levelText(s?.tcLevel))}
        {df({ x: bx(2), y: bY, w: bW, h: botH }, 'ABS', levelText(s?.absLevel))}
        {df({ x: bx(3), y: bY, w: bW, h: botH }, 'BIAS', n1(s?.brakeBiasPct), 'normal', '%')}
      </svg>
    </div>
  )
}
