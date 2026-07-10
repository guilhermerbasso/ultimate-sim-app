// INPUTS TRACE overlay — throttle / brake / clutch + steering as ONE graphic: a
// live multi-channel oscilloscope trace. A null/invalid snapshot degrades to "—"
// in the accessible label — never NaN / undefined / Infinity.
//
// The design family (config.stylePreset) is collapsed to a single skin-driven layout;
// the legacy `rd2-fam-*` class is retained on the root purely as a styling/test hook.

import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { overlayDesignFamily } from '../../../../shared/overlays'
import { resolveSkin } from '../../skins'
import type { WidgetProps } from './types'
import { pct } from './format'

interface TracePoint {
  throttle: number
  brake: number
  clutch: number
  steer: number
}

const MAX_POINTS = 56
const TRACE_VB_H = 40

// Warm-chrome rule: throttle = go (green), brake = warm (red), clutch = steel chrome,
// steer = amber. Cool/blue is never used here.
const CHANNELS: Array<{ key: keyof TracePoint; label: string; color: string }> = [
  { key: 'throttle', label: 'THR', color: '#2ee06a' },
  { key: 'brake', label: 'BRK', color: '#ff4d3d' },
  { key: 'clutch', label: 'CLT', color: '#cdd6e2' },
  { key: 'steer', label: 'STR', color: '#ffb000' }
]

function finitePct(value?: number): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return pct(value)
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

export function InputsTraceWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const hud = skin.id === 'hud'
  const family = overlayDesignFamily(config?.stylePreset)
  const W = Math.max(160, config.position?.width || 360)
  const H = Math.max(90, config.position?.height || 200)

  const steerRaw = snapshot?.steerAngleDeg
  const steer = Number.isFinite(steerRaw) ? Math.max(-1, Math.min(1, (steerRaw as number) / 540)) : 0
  const steerNorm = (steer + 1) / 2

  const live: Record<keyof TracePoint, number> = {
    throttle: pct(snapshot?.throttle),
    brake: pct(snapshot?.brake),
    clutch: pct(snapshot?.clutch),
    steer: steerNorm
  }
  const known: Record<keyof TracePoint, number | undefined> = {
    throttle: finitePct(snapshot?.throttle),
    brake: finitePct(snapshot?.brake),
    clutch: finitePct(snapshot?.clutch),
    steer: Number.isFinite(steerRaw) ? steerNorm : undefined
  }

  const [points, setPoints] = useState<TracePoint[]>([])
  useEffect(() => {
    setPoints((items) => [...items.slice(-(MAX_POINTS - 1)), { ...live }])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.throttle, live.brake, live.clutch, live.steer])

  const pad = Math.max(6, Math.round(Math.min(W, H) * 0.05))
  const traceY = pad
  const traceH = Math.max(18, H - pad * 2)
  const traceW = W - pad * 2
  const aria = `Input trace ${CHANNELS.map((ch) => `${ch.label} ${ariaValue(known[ch.key])}`).join(' ')}`

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      role="img"
      aria-label={aria}
      data-widget="inputsTrace"
      data-family={family}
      className={`rd2-fam-${family}`}
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

      <title>{aria}</title>

      {/* Live multi-channel trace — the only graphic in this overlay. */}
      <rect x={pad} y={traceY} width={traceW} height={traceH} rx={4} fill={skin.palette.surface} stroke={skin.material.border} strokeWidth={1} />
      <svg x={pad} y={traceY} width={traceW} height={traceH} viewBox={`0 0 100 ${TRACE_VB_H}`} preserveAspectRatio="none">
        <line x1={0} y1={TRACE_VB_H / 2} x2={100} y2={TRACE_VB_H / 2} stroke={skin.material.border} strokeWidth={0.7} opacity={0.55} />
        {CHANNELS.map((ch) => (
          <path key={ch.key} d={toLine(points.map((p) => p[ch.key]))} fill="none" stroke={ch.color} strokeWidth={ch.key === 'clutch' ? 1.2 : 1.4} />
        ))}
      </svg>
    </svg>
  )
}
