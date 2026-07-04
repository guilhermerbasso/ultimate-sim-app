// REV LIGHTS overlay — the on-screen shift ladder rebuilt on the v2.39 KIT contract:
// ONE root <svg viewBox=W×H preserveAspectRatio="xMidYMid meet"> so it can never
// overflow, every label auto-fits via <FitText> (no clamp() micro-type) and the ladder
// itself is the shared, skin-driven RevLedBar (green → amber → red, BLUE redline flash
// for skin profiles). Skin tokens drive every colour so a P4/skin swap re-styles it; the
// hud skin renders a translucent glass bar.
//
// The ladder is driven by shiftIndicatorPct (0..1 along the car's shift band — the
// correct signal, never rpm/maxRpm), falling back to revLights.pct. This is purely the
// VISUAL overlay; the RGB-matrix / firmware rev-light engine is untouched. Every input is
// optional and degrades to 0 % so a null snapshot never renders NaN.

import type { ReactElement } from 'react'
import { resolveSkin, FitText } from '../../skins'
import { RevLedBar } from '../../instruments'
import { overlayDesignFamily } from '../../../../shared/overlays'
import { pct } from './format'
import type { WidgetProps } from './types'

export function RevLightsWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const hud = skin.id === 'hud'
  const family = overlayDesignFamily(config.stylePreset)
  const W = Math.max(120, config.position?.width || 360)
  const H = Math.max(48, config.position?.height || 120)

  const shiftPct = pct(snapshot?.shiftIndicatorPct ?? snapshot?.revLights?.pct ?? 0)
  const flash = Boolean(snapshot?.revLights?.blink) || shiftPct >= 0.97
  const pctTxt = `${Math.round(shiftPct * 100)}%`

  const redlineColor = skin.led.redline.color
  const headerColor = flash ? redlineColor : skin.palette.accent
  const label = flash ? 'SHIFT' : 'REV'

  const pad = Math.max(6, Math.round(Math.min(W, H) * 0.06))
  const headerH = Math.max(14, Math.round(H * 0.3))
  const headerY = pad
  const gap = Math.max(4, Math.round(H * 0.05))
  const ladderY = headerY + headerH + gap
  const ladderH = Math.max(12, H - ladderY - pad)
  const ladderW = W - pad * 2
  const pctBoxW = Math.max(48, Math.round(W * 0.28))

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      role="img"
      aria-label="Rev lights"
      data-widget="revlights"
      data-family={family}
      className={`rc-fam-${family}`}
    >
      <rect
        x={0.75}
        y={0.75}
        width={W - 1.5}
        height={H - 1.5}
        rx={skin.material.radius}
        fill={hud ? skin.palette.surface : skin.palette.bg}
        stroke={flash ? redlineColor : skin.material.border}
        strokeWidth={skin.material.borderWidth}
        fillOpacity={hud ? 0.72 : 1}
      />

      {/* Header: REV / SHIFT tell-tale + big % readout. */}
      <FitText
        x={pad}
        y={headerY + headerH / 2}
        boxW={W - pad * 2 - pctBoxW - 6}
        boxH={headerH}
        text={label}
        anchor="start"
        baseline="middle"
        fontFamily={skin.typography.label}
        fill={headerColor}
        weight={800}
        minFontPx={skin.typography.minFontPx}
        maxFontPx={Math.min(headerH, 26)}
        letterSpacing={1.5}
      />
      <FitText
        x={W - pad}
        y={headerY + headerH / 2}
        boxW={pctBoxW}
        boxH={headerH}
        text={pctTxt}
        anchor="end"
        baseline="middle"
        fontFamily={skin.typography.value}
        fill={flash ? redlineColor : skin.palette.text}
        weight={800}
        minFontPx={skin.typography.minFontPx}
        maxFontPx={Math.min(headerH, 30)}
      />

      {/* Ladder — the shared, skin-driven LED rig (blue redline flash). */}
      <RevLedBar
        pct={shiftPct}
        profile={skin.led}
        x={pad}
        y={ladderY}
        width={ladderW}
        height={ladderH}
        redlineFlash
        flashOn={flash}
        idPrefix="revlights"
      />
    </svg>
  )
}
