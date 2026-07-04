// SHIFT POINT overlay — a standalone, oversized GT3 steering-wheel shift ladder rebuilt
// on the v2.39 KIT contract: ONE root <svg viewBox=W×H preserveAspectRatio="xMidYMid
// meet"> so nothing can overflow, every label auto-fits via <FitText> (no clamp()
// micro-type), the RPM + gear readouts render through the shared DSEG SegmentReadout
// (digits → 7-seg, N/R/— → 14-seg) and the ladder itself reuses the shared, data-driven
// LedShiftBar (green → amber → red, white redline full-flash). Skin tokens drive chrome
// so a P4/skin swap re-styles everything.
//
// The ladder is driven by shiftIndicatorPct (0..1 along the car's shift band — the
// correct signal, never rpm/maxRpm), falling back to revLights.pct. This is purely the
// on-screen VISUAL ladder; the RGB-matrix / firmware rev-light engine is untouched.
// Every input is optional and degrades to "—" so a null snapshot never renders NaN.

import type { ReactElement } from 'react'
import { resolveSkin, FitText } from '../../skins'
import { SegmentReadout } from '../../instruments'
import { LedShiftBar } from './LedShiftBar'
import { DASH, FONT_COND } from './dashboard-tiles'
import { formatGear } from './format'
import { MotorsportGlyph } from '../../icons/motorsport'
import type { WidgetProps } from './types'

export const SHIFT_POINT_BAR_STREAM_SAFE = true

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

export function ShiftPointBarWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const hud = skin.id === 'hud'
  const W = Math.max(160, config.position?.width || 360)
  const H = Math.max(120, config.position?.height || 200)

  const s = snapshot
  const shiftPct = clamp01(s?.shiftIndicatorPct ?? s?.revLights?.pct ?? 0)
  const redline = Boolean(s?.revLights?.blink) || shiftPct >= 0.985

  const gearNum = s?.gear
  const gearStr = formatGear(typeof gearNum === 'number' && Number.isFinite(gearNum) ? gearNum : undefined)
  const rpm = s?.rpm
  const rpmVal: string | number = typeof rpm === 'number' && Number.isFinite(rpm) ? Math.round(rpm) : '—'

  const accent = redline ? DASH.red : skin.palette.textDim
  const valueColor = redline ? DASH.red : skin.palette.text

  const pad = Math.max(6, Math.round(W * 0.025))
  const headerH = Math.max(18, Math.round(H * 0.16))
  const headerY = pad
  const glyph = Math.min(headerH, Math.max(14, Math.round(H * 0.1)))

  const gap = Math.max(5, Math.round(H * 0.035))
  const ladderY = headerY + headerH + gap
  const ladderH = Math.max(16, Math.round(H * 0.24))
  const ladderX = pad
  const ladderW = W - pad * 2

  const bottomY = ladderY + ladderH + gap
  const bottomH = Math.max(24, H - bottomY - pad)
  const colGap = gap
  const rpmW = (W - pad * 2 - colGap) * 0.58
  const gearW = W - pad * 2 - colGap - rpmW
  const rpmX = pad
  const gearX = pad + rpmW + colGap

  // Bottom panel: label band (top) + DSEG value (fills the rest).
  const panelLabelH = Math.max(11, Math.round(bottomH * 0.24))
  const segH = Math.max(16, Math.round(bottomH * 0.5))
  const segTotalH = segH + 4
  const segY = bottomY + panelLabelH + Math.max(0, (bottomH - panelLabelH - segTotalH) / 2)

  const panel = (x: number, w: number, labelText: string, value: string | number, idPrefix: string): ReactElement => (
    <g key={idPrefix}>
      <rect
        x={x}
        y={bottomY}
        width={w}
        height={bottomH}
        rx={Math.min(8, skin.material.radius)}
        fill={skin.palette.bg}
        stroke={redline ? DASH.red : skin.material.border}
        strokeWidth={redline ? 1.6 : skin.material.borderWidth}
      />
      <FitText
        x={x + w / 2}
        y={bottomY + panelLabelH / 2 + 1}
        boxW={w - 8}
        boxH={panelLabelH}
        text={labelText}
        anchor="middle"
        baseline="middle"
        fontFamily={FONT_COND}
        fill={skin.palette.textDim}
        weight={700}
        minFontPx={11}
        maxFontPx={panelLabelH}
        letterSpacing={1}
      />
      <g transform={`translate(${x + 4},${segY})`}>
        <SegmentReadout
          value={value}
          ghost={false}
          height={segH}
          width={w - 8}
          align="center"
          color={valueColor}
          idPrefix={idPrefix}
        />
      </g>
    </g>
  )

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      role="img"
      aria-label="Shift point ladder"
      data-widget="shiftPointBar"
    >
      <rect
        x={0.75}
        y={0.75}
        width={W - 1.5}
        height={H - 1.5}
        rx={skin.material.radius}
        fill={hud ? skin.palette.surface : skin.palette.bg}
        stroke={redline ? DASH.red : skin.material.border}
        strokeWidth={skin.material.borderWidth}
        fillOpacity={hud ? 0.72 : 1}
      />

      {/* Header: engine tell-tale + title, with a SHIFT alert tab on the redline. */}
      <g transform={`translate(${pad},${headerY + (headerH - glyph) / 2})`}>
        <MotorsportGlyph id="engine" width={glyph} height={glyph} style={{ color: redline ? DASH.red : skin.palette.textDim }} />
      </g>
      <FitText
        x={pad + glyph + 6}
        y={headerY + headerH / 2}
        boxW={W - pad * 2 - glyph - 6 - Math.round(W * 0.2)}
        boxH={headerH}
        text="Shift Point"
        anchor="start"
        baseline="middle"
        fontFamily={FONT_COND}
        fill={accent}
        weight={800}
        minFontPx={11}
        maxFontPx={Math.min(22, headerH)}
        letterSpacing={0.8}
      />
      {redline ? (
        <FitText
          x={W - pad}
          y={headerY + headerH / 2}
          boxW={Math.round(W * 0.2)}
          boxH={headerH}
          text="SHIFT"
          anchor="end"
          baseline="middle"
          fontFamily={FONT_COND}
          fill={DASH.red}
          weight={800}
          minFontPx={11}
          maxFontPx={Math.min(16, headerH)}
          letterSpacing={1.2}
        />
      ) : null}

      {/* Shift ladder — shared LED rig, wrapped so its bloom is clipped to the band. */}
      <rect
        x={ladderX - 2}
        y={ladderY - 2}
        width={ladderW + 4}
        height={ladderH + 4}
        rx={4}
        fill={DASH.black}
        stroke={redline ? DASH.red : skin.material.border}
        strokeWidth={redline ? 2 : 1}
      />
      <svg x={ladderX} y={ladderY} width={ladderW} height={ladderH}>
        <LedShiftBar pct={shiftPct} blink={redline} segments={skin.led.count} height={ladderH} />
      </svg>

      {/* Readouts — DSEG faces: digits route to 7-seg, N/R/— to 14-seg. */}
      {panel(rpmX, rpmW, 'RPM', rpmVal, 'shift-rpm')}
      {panel(gearX, gearW, 'GEAR', gearStr, 'shift-gear')}
    </svg>
  )
}
