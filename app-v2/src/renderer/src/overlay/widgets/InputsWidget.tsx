// INPUTS overlay — throttle / brake / clutch rebuilt on the v2.39 KIT contract: ONE
// root <svg viewBox=W×H preserveAspectRatio="xMidYMid meet"> so nothing overflows, a
// live oscilloscope trace band on top, three clean vertical pedal bars below and every
// numeral in the embedded DSEG7 face via SegmentReadout. Each channel is wrapped in an
// aria-labelled group ("THR 62") for screen-readers. A null/invalid snapshot degrades to
// "—" and 0 %-height bars — never NaN / undefined / Infinity.
//
// The design family (config.stylePreset) is collapsed to a single skin-driven layout;
// the legacy `rc-fam-*` class is retained on the root purely as a styling/test hook.

import { useEffect, useRef, useState } from 'react'
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

const MAX_SAMPLES = 100
const SAMPLE_MS = 50
const TRACE_VB_H = 40

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

function toLine(values: number[]): string {
  if (values.length === 0) return ''
  return values
    .map((value, index) => {
      const x = values.length === 1 ? 100 : (index / (values.length - 1)) * 100
      const y = TRACE_VB_H - value * TRACE_VB_H
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

export function InputsWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const hud = skin.id === 'hud'
  const family = overlayDesignFamily(config.stylePreset)
  const W = Math.max(160, config.position?.width || 360)
  const H = Math.max(90, config.position?.height || 200)

  const [samples, setSamples] = useState<InputSample[]>([])
  const latest = useRef<InputSample>({ throttle: 0, brake: 0, clutch: 0 })
  latest.current = {
    throttle: pct(snapshot?.throttle),
    brake: pct(snapshot?.brake),
    clutch: pct(snapshot?.clutch)
  }
  useEffect(() => {
    const timer = setInterval(() => {
      setSamples((items) => [...items.slice(-(MAX_SAMPLES - 1)), latest.current])
    }, SAMPLE_MS)
    return () => clearInterval(timer)
  }, [])

  const channels: Array<{ key: keyof InputSample; label: string; color: string; live: number; known: number | undefined }> = [
    { key: 'throttle', label: 'THR', color: CH.thr, live: latest.current.throttle, known: finitePct(snapshot?.throttle) },
    { key: 'brake', label: 'BRK', color: CH.brk, live: latest.current.brake, known: finitePct(snapshot?.brake) },
    { key: 'clutch', label: 'CLT', color: CH.clt, live: latest.current.clutch, known: finitePct(snapshot?.clutch) }
  ]

  const pad = Math.max(6, Math.round(Math.min(W, H) * 0.05))
  const gap = Math.max(4, Math.round(H * 0.03))
  const traceY = pad
  const traceH = Math.max(18, Math.round(H * 0.3))
  const traceW = W - pad * 2

  const colsY = traceY + traceH + gap
  const colsH = Math.max(30, H - colsY - pad)
  const labelBandH = Math.max(11, Math.round(colsH * 0.18))
  const readoutBandH = Math.max(14, Math.round(colsH * 0.3))
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

      {/* Live oscilloscope trace (empty until sampled — SSR-safe). */}
      <rect x={pad} y={traceY} width={traceW} height={traceH} rx={4} fill={skin.palette.surface} stroke={skin.material.border} strokeWidth={1} />
      <svg x={pad} y={traceY} width={traceW} height={traceH} viewBox={`0 0 100 ${TRACE_VB_H}`} preserveAspectRatio="none">
        <path d={toLine(samples.map((s) => s.clutch))} fill="none" stroke={CH.clt} strokeWidth={1.2} />
        <path d={toLine(samples.map((s) => s.brake))} fill="none" stroke={CH.brk} strokeWidth={1.4} />
        <path d={toLine(samples.map((s) => s.throttle))} fill="none" stroke={CH.thr} strokeWidth={1.4} />
      </svg>

      {/* Pedal bars — clean vertical fills with a DSEG readout per channel. */}
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
