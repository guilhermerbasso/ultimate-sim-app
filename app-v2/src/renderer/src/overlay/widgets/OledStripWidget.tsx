// OLED / DDU cluster strip — a thin horizontal GT3 wheel-display readout rebuilt on
// the v2.39 KIT contract: ONE root <svg viewBox=W×H preserveAspectRatio="xMidYMid
// meet"> so it can never overflow, every label auto-fits via <FitText> (no clamp()
// micro-type), numerals render in the embedded DSEG7 face and the REV segment reuses
// the shared LedShiftBar LED rig. Skin tokens drive all chrome so a P4/skin swap
// re-styles everything; the hud skin renders a translucent glass bar.
//
// Reads snapshot.gear, speedKmh, shiftIndicatorPct||rpm/maxRpm, deltaToBestSec,
// fuelLiters. A null/absent snapshot degrades every segment to "—" — never NaN.

import type { ReactElement } from 'react'
import { resolveSkin, FitText } from '../../skins'
import { FONT_SEG7 } from '../../instruments'
import { LedShiftBar } from './LedShiftBar'
import { DASH, FONT_COND } from './dashboard-tiles'
import { formatDelta, formatGear, pct } from './format'
import type { WidgetProps } from './types'

export const OLED_STRIP_STREAM_SAFE = true

function deltaColor(delta: number | undefined): string {
  if (delta === undefined || !Number.isFinite(delta)) return DASH.textDim
  if (delta < 0) return DASH.green // faster than best → improving
  if (delta > 0) return DASH.amber // slower than best → losing time
  return DASH.textDim
}

interface Col {
  x: number
  w: number
}

export function OledStripWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const hud = skin.id === 'hud'
  const W = Math.max(120, config.position?.width || 720)
  const H = Math.max(36, config.position?.height || 72)

  const pad = Math.max(4, Math.round(H * 0.09))
  const labelH = Math.max(11, Math.min(16, Math.round(H * 0.24)))
  const labelY = pad + labelH / 2
  const valueY = pad + labelH + Math.max(2, Math.round(H * 0.04))
  const valueH = Math.max(12, H - valueY - pad)

  // Proportional columns: GEAR · SPEED · REV(led) · DELTA · FUEL.
  const gap = pad
  const weights = [0.95, 1.5, 2.5, 1.55, 1.5]
  const totalWt = weights.reduce((a, b) => a + b, 0)
  const usable = Math.max(0, W - pad * 2 - gap * (weights.length - 1))
  let cx = pad
  const cols: Col[] = weights.map((wt) => {
    const w = (usable * wt) / totalWt
    const c: Col = { x: cx, w }
    cx += w + gap
    return c
  })
  const [gearCol, speedCol, revCol, deltaCol, fuelCol] = cols

  const gearStr = formatGear(snapshot?.gear)
  const speed = snapshot?.speedKmh
  const speedStr = typeof speed === 'number' && Number.isFinite(speed) ? String(Math.round(speed)) : '—'
  const fuel = snapshot?.fuelLiters
  const fuelStr = typeof fuel === 'number' && Number.isFinite(fuel) ? fuel.toFixed(1) : '—'
  const delta = snapshot?.deltaToBestSec
  const deltaStr = formatDelta(delta)
  const dColor = deltaColor(delta)

  const rpm = snapshot?.rpm
  const maxRpm = snapshot?.maxRpm
  const shiftRaw =
    typeof snapshot?.shiftIndicatorPct === 'number' && Number.isFinite(snapshot.shiftIndicatorPct)
      ? snapshot.shiftIndicatorPct
      : typeof rpm === 'number' && typeof maxRpm === 'number' && maxRpm > 0
        ? rpm / maxRpm
        : undefined
  const shiftPct = pct(shiftRaw)
  const redline = shiftPct >= 0.99

  const barH = Math.max(8, Math.min(valueH, Math.round(H * 0.34)))
  const barY = valueY + Math.max(0, (valueH - barH) / 2)

  const label = (col: Col, text: string): ReactElement => (
    <FitText
      x={col.x + col.w / 2}
      y={labelY}
      boxW={col.w}
      boxH={labelH}
      text={text}
      anchor="middle"
      baseline="middle"
      fontFamily={FONT_COND}
      fill={skin.palette.textDim}
      weight={700}
      minFontPx={11}
      maxFontPx={labelH}
      letterSpacing={0.6}
    />
  )

  const numeral = (col: Col, text: string, fill: string, idKey: string): ReactElement => (
    <FitText
      key={idKey}
      x={col.x + col.w / 2}
      y={valueY + valueH / 2}
      boxW={col.w}
      boxH={valueH}
      text={text}
      anchor="middle"
      baseline="middle"
      fontFamily={FONT_SEG7}
      fill={fill}
      minFontPx={12}
      maxFontPx={valueH}
    />
  )

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      role="img"
      aria-label="OLED cluster strip"
      data-widget="oledStrip"
    >
      <rect
        x={0.75}
        y={0.75}
        width={W - 1.5}
        height={H - 1.5}
        rx={skin.material.radius}
        fill={hud ? skin.palette.surface : skin.palette.bg}
        stroke={skin.material.border}
        strokeWidth={skin.material.borderWidth}
        fillOpacity={hud ? 0.72 : 1}
      />

      {/* GEAR */}
      {label(gearCol, 'GEAR')}
      {numeral(gearCol, gearStr, redline ? DASH.red : skin.palette.text, 'gear')}

      {/* SPEED */}
      {label(speedCol, 'KM/H')}
      {numeral(speedCol, speedStr, skin.palette.text, 'spd')}

      {/* REV — shared LED rig, clipped to its column so bloom never escapes. */}
      {label(revCol, 'REV')}
      <svg x={revCol.x} y={barY} width={revCol.w} height={barH}>
        <LedShiftBar pct={shiftPct} blink={redline} segments={skin.led.count} height={barH} />
      </svg>

      {/* DELTA */}
      {label(deltaCol, 'DELTA')}
      {numeral(deltaCol, deltaStr, dColor, 'delta')}

      {/* FUEL */}
      {label(fuelCol, 'FUEL')}
      {numeral(fuelCol, fuelStr, skin.palette.text, 'fuel')}
    </svg>
  )
}
