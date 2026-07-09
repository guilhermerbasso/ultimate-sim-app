// AnalogTachWidget — a round GT3-style analog tachometer, rebuilt on the v2.39
// instrument KIT. One root <svg> (fixed viewBox + preserveAspectRatio); the dial is the
// shared AnalogDial primitive and the header RPM plus the in-face gear/speed are auto-
// fit FitText — so nothing is sized from an element's height via CSS clamp() (the old
// overflow bug). Ticks are disabled on this small dial to keep every glyph ≥ 10px.
// Skin-token only. A null snapshot parks the needle at idle and shows "—".
import type { ReactElement } from 'react'
import type { WidgetProps } from './types'
import { formatGear, pctOrUndefined } from './format'
import { resolveSkin, FitText } from '../../skins'
import { AnalogDial } from '../../instruments'

export const ANALOG_TACH_STREAM_SAFE = true

const REDLINE_FRAC = 0.85

function dims(config: WidgetProps['config']): { W: number; H: number } {
  const w = config?.position?.width
  const h = config?.position?.height
  return {
    W: typeof w === 'number' && w > 0 ? w : 240,
    H: typeof h === 'number' && h > 0 ? h : 260
  }
}

export function AnalogTachWidget({ snapshot, config }: WidgetProps): ReactElement {
  const s = snapshot
  const skin = resolveSkin('gt3', 'generic')
  const { palette } = skin
  const { W, H } = dims(config)

  const rpm = s?.rpm
  const maxRpm = s?.maxRpm
  const hasRpm = rpm !== undefined && Number.isFinite(rpm) && maxRpm !== undefined && Number.isFinite(maxRpm) && maxRpm > 0
  const maxK = hasRpm ? (maxRpm as number) / 1000 : 9
  const frac = hasRpm ? Math.max(0, Math.min(1, (rpm as number) / (maxRpm as number))) : 0

  const shiftPct = pctOrUndefined(s?.shiftIndicatorPct)
  const inShiftBand = shiftPct !== undefined && shiftPct >= 0.85
  const redlining = frac >= REDLINE_FRAC || inShiftBand

  const gear = formatGear(s?.gear)
  const speed = s?.speedKmh
  const speedStr = speed !== undefined && Number.isFinite(speed) ? String(Math.round(speed)) : '—'
  const rpmStr = hasRpm ? ((rpm as number) / 1000).toFixed(1) : '—'

  const P = Math.max(8, Math.round(Math.min(W, H) * 0.04))
  const G = Math.max(4, Math.round(Math.min(W, H) * 0.02))
  const headH = Math.max(30, Math.round(H * 0.16))
  const headY = P
  const dialAreaY = headY + headH + G
  const dialAreaH = H - P - dialAreaY
  const dialSize = Math.max(120, Math.min(W - 2 * P, dialAreaH))
  const cx = W / 2
  const cy = dialAreaY + dialAreaH / 2
  const dialX = cx - dialSize / 2
  const dialY = cy - dialSize / 2

  const needleColor = redlining ? palette.crit : palette.accent
  const rpmColor = redlining ? palette.crit : palette.text

  return (
    <div className="overlay-card dr-root rd-analog-tach" data-overlay-id={config?.id} data-widget="analogTach" style={{ width: '100%', height: '100%', overflow: 'hidden', background: 'transparent', border: 'none', boxShadow: 'none', backdropFilter: 'none' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" width="100%" height="100%" style={{ display: 'block' }}>
        {/* RPM ×1000 */}
        <FitText x={W - P} y={headY + headH / 2} boxW={W * 0.4} boxH={headH * 0.82} text={rpmStr} anchor="end" baseline="middle" fontFamily={skin.segment.numeric} fill={rpmColor} minFontPx={12} maxFontPx={Math.max(14, headH * 0.72)} />
        <FitText x={W - P} y={headY + headH * 0.94} boxW={W * 0.4} boxH={headH * 0.24} text="×1000 RPM" anchor="end" baseline="middle" fontFamily={skin.typography.label} fill={palette.textDim} minFontPx={11} maxFontPx={13} weight={700} letterSpacing={1} />

        {/* Dial (ticks off on this small dial) */}
        <g transform={`translate(${dialX}, ${dialY})`}>
          <AnalogDial
            value={hasRpm ? (rpm as number) / 1000 : 0}
            min={0}
            max={maxK}
            size={dialSize}
            startAngleDeg={-135}
            endAngleDeg={135}
            majorTicks={Math.max(2, Math.round(maxK) + 1)}
            minorPerMajor={4}
            showValue={false}
            showTicks={false}
            bezel="double"
            material="carbon"
            needleColor={needleColor}
            warnFrom={maxK * 0.7}
            redlineFrom={maxK * REDLINE_FRAC}
            idPrefix="tach-dial"
          />
        </g>

        {/* In-face gear + speed */}
        <FitText x={cx} y={cy + dialSize * 0.04} boxW={dialSize * 0.4} boxH={dialSize * 0.34} text={gear} anchor="middle" baseline="middle" fontFamily={/^\d$/.test(gear) ? skin.segment.numeric : skin.segment.alpha} fill={redlining ? palette.crit : palette.text} minFontPx={20} maxFontPx={dialSize * 0.34} />
        <FitText x={cx} y={cy + dialSize * 0.3} boxW={dialSize * 0.4} boxH={dialSize * 0.14} text={speedStr} anchor="middle" baseline="middle" fontFamily={skin.segment.numeric} fill={palette.text} minFontPx={12} maxFontPx={dialSize * 0.13} />
        <FitText x={cx} y={cy + dialSize * 0.4} boxW={dialSize * 0.4} boxH={dialSize * 0.08} text="KM/H" anchor="middle" baseline="middle" fontFamily={skin.typography.label} fill={palette.textDim} minFontPx={11} maxFontPx={12} weight={700} letterSpacing={2} />
      </svg>
    </div>
  )
}
