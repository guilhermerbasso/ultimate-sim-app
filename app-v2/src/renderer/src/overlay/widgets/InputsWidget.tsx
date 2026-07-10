// INPUTS overlay — throttle / brake / clutch as ONE graphic: three clean vertical
// pedal bars plus readouts. A null/invalid snapshot degrades to "—" and 0 %-height
// bars — never NaN / undefined / Infinity.
//
// The design family (config.stylePreset) is collapsed to a single skin-driven layout;
// the legacy `rc-fam-*` class is retained on the root purely as a styling/test hook.

import type { ReactElement } from 'react'
import { overlayDesignFamily } from '../../../../shared/overlays'
import { resolveSkin, FitText } from '../../skins'
import { SegmentReadout } from '../../instruments'
import { FONT_COND } from './dashboard-tiles'
import type { WidgetProps } from './types'
import { pct } from './format'

interface InputSample {
  throttle: number
  brake: number
  clutch: number
}

// Domain-standard pedal-trace colours: throttle green (on-power), brake red (braking
// effort), clutch a neutral steel chrome (not a cool "good" hue).
const CH = { thr: '#18d27b', brk: '#ff3b30', clt: '#cdd6e2' }

function finitePct(value?: number): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return pct(value)
}

function readoutValue(value: number | undefined): string | number {
  return value === undefined ? '—' : Math.round(value * 100)
}

function ariaValue(value: number | undefined): string {
  return value === undefined ? '—' : String(Math.round(value * 100))
}

export function InputsWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const hud = skin.id === 'hud'
  const family = overlayDesignFamily(config.stylePreset)
  const W = Math.max(160, config.position?.width || 360)
  const H = Math.max(90, config.position?.height || 200)

  const live: InputSample = {
    throttle: pct(snapshot?.throttle),
    brake: pct(snapshot?.brake),
    clutch: pct(snapshot?.clutch)
  }

  const channels: Array<{ key: keyof InputSample; label: string; color: string; live: number; known: number | undefined }> = [
    { key: 'throttle', label: 'THR', color: CH.thr, live: live.throttle, known: finitePct(snapshot?.throttle) },
    { key: 'brake', label: 'BRK', color: CH.brk, live: live.brake, known: finitePct(snapshot?.brake) },
    { key: 'clutch', label: 'CLT', color: CH.clt, live: live.clutch, known: finitePct(snapshot?.clutch) }
  ]

  const pad = Math.max(6, Math.round(Math.min(W, H) * 0.05))
  const gap = Math.max(4, Math.round(H * 0.03))

  const colsY = pad
  const colsH = Math.max(44, H - pad * 2)
  const labelBandH = Math.max(12, Math.round(colsH * 0.14))
  const readoutBandH = Math.max(18, Math.round(colsH * 0.24))
  const inset = Math.max(2, Math.round(colsH * 0.04))
  const barTop = colsY + labelBandH + inset
  const barBottom = colsY + colsH - readoutBandH - inset
  const barH = Math.max(6, barBottom - barTop)
  const readoutY = barBottom + inset
  const segH = Math.max(12, readoutBandH - 2)

  const n = channels.length
  const colGap = gap
  const colW = (W - pad * 2 - colGap * (n - 1)) / n
  const barW = Math.max(6, Math.min(colW * 0.5, 30))

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      role="img"
      aria-label="Pedal inputs"
      data-widget="inputs"
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
        stroke={skin.material.border}
        strokeWidth={skin.material.borderWidth}
        fillOpacity={hud ? 0.72 : 1}
      />

      {/* Pedal bars — the only graphic in this overlay. */}
      {channels.map((ch, i) => {
        const colX = pad + i * (colW + colGap)
        const barX = colX + (colW - barW) / 2
        const fillH = Math.max(0, Math.min(1, ch.live)) * barH
        return (
          <g key={ch.key} role="img" aria-label={`${ch.label} ${ariaValue(ch.known)}`}>
            <FitText
              x={colX + colW / 2}
              y={colsY + labelBandH / 2}
              boxW={colW}
              boxH={labelBandH}
              text={ch.label}
              anchor="middle"
              baseline="middle"
              fontFamily={FONT_COND}
              fill={ch.color}
              weight={800}
              minFontPx={11}
              maxFontPx={labelBandH}
              letterSpacing={1}
            />
            <rect x={barX} y={barTop} width={barW} height={barH} rx={3} fill={skin.palette.bg} stroke={skin.material.border} strokeWidth={1} />
            <rect x={barX} y={barBottom - fillH} width={barW} height={fillH} rx={3} fill={ch.color} />
            <g transform={`translate(${colX},${readoutY})`}>
              <SegmentReadout value={readoutValue(ch.known)} ghost={false} height={segH} width={colW} align="center" color={ch.color} idPrefix={`inputs-${ch.label.toLowerCase()}`} />
            </g>
          </g>
        )
      })}
    </svg>
  )
}
