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
import type { WidgetProps } from './types'

export const SHIFT_POINT_BAR_STREAM_SAFE = true

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

export function ShiftPointBarWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const W = Math.max(160, config.position?.width || 360)
  const H = Math.max(120, config.position?.height || 200)

  const s = snapshot
  const shiftPct = clamp01(s?.shiftIndicatorPct ?? s?.revLights?.pct ?? 0)
  const redline = Boolean(s?.revLights?.blink) || shiftPct >= 0.985

  const gearNum = s?.gear
  const gearStr = formatGear(typeof gearNum === 'number' && Number.isFinite(gearNum) ? gearNum : undefined)
  const rpm = s?.rpm
  const rpmVal: string | number = typeof rpm === 'number' && Number.isFinite(rpm) ? Math.round(rpm) : '—'

  const valueColor = redline ? DASH.red : skin.palette.text

  const pad = Math.max(6, Math.round(W * 0.025))
  const gap = Math.max(5, Math.round(H * 0.035))
  const ladderY = pad
  const ladderH = Math.max(18, Math.round(H * 0.3))
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
  const segmentFitHeight = (value: string | number, w: number): number => {
    const len = Math.max(1, String(value).length)
    return Math.max(14, Math.min(Math.round(bottomH * 0.52), Math.floor((w - 10) / (len * 0.66))))
  }

  const panel = (x: number, w: number, labelText: string, value: string | number, idPrefix: string): ReactElement => (
    (() => {
      const segH = segmentFitHeight(value, w)
      const segTotalH = segH + 4
      const segY = bottomY + panelLabelH + Math.max(0, (bottomH - panelLabelH - segTotalH) / 2)
      return (
        <g key={idPrefix}>
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
          <g transform={`translate(${x + 5},${segY})`}>
            <SegmentReadout
              value={value}
              ghost={false}
              height={segH}
              width={w - 10}
              align="center"
              color={valueColor}
              idPrefix={idPrefix}
            />
          </g>
        </g>
      )
    })()
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
      {/* Shift ladder — shared LED rig, wrapped so its bloom is clipped to the band. */}
      <svg x={ladderX} y={ladderY} width={ladderW} height={ladderH} preserveAspectRatio="none">
        <LedShiftBar pct={shiftPct} blink={redline} segments={skin.led.count} height={ladderH} />
      </svg>

      {/* Readouts — DSEG faces: digits route to 7-seg, N/R/— to 14-seg. */}
      {panel(rpmX, rpmW, 'RPM', rpmVal, 'shift-rpm')}
      {panel(gearX, gearW, 'GEAR', gearStr, 'shift-gear')}
    </svg>
  )
}
