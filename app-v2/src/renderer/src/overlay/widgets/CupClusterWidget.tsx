// CupClusterWidget — a minimalist cup-car cluster (shift bar + hero gear + speed/delta),
// rebuilt on the v2.39 instrument KIT. One root <svg> (fixed viewBox + preserveAspect-
// Ratio); the shift band is the shared RevLedBar, the hero gear is auto-fit FitText and
// speed/delta are DataFields — so nothing is sized from an element's height via CSS
// clamp() (the old overflow bug). Skin-token only. A null snapshot shows "—" throughout.
import type { ReactElement } from 'react'
import type { WidgetProps } from './types'
import { formatDelta, formatGear, pct } from './format'
import { resolveSkin, FitText } from '../../skins'
import { RevLedBar, DataField, type FieldState } from '../../instruments'

export const CUP_CLUSTER_STREAM_SAFE = true

function dims(config: WidgetProps['config']): { W: number; H: number } {
  const w = config?.position?.width
  const h = config?.position?.height
  return {
    W: typeof w === 'number' && w > 0 ? w : 300,
    H: typeof h === 'number' && h > 0 ? h : 300
  }
}

export function CupClusterWidget({ snapshot, config }: WidgetProps): ReactElement {
  const s = snapshot
  const skin = resolveSkin('gt3', 'generic')
  const { palette } = skin
  const { W, H } = dims(config)

  const shiftPct = pct(s?.shiftIndicatorPct ?? (s?.rpm ?? 0) / (s?.maxRpm ?? 9000))
  const redline = shiftPct >= 0.95
  const gear = formatGear(s?.gear)
  const speed = s?.speedKmh
  const speedStr = speed !== undefined && Number.isFinite(speed) ? String(Math.round(speed)) : '—'
  const delta = s?.deltaToBestSec
  const deltaState: FieldState = delta === undefined || !Number.isFinite(delta) ? 'normal' : delta <= 0 ? 'ok' : 'warn'

  const P = Math.max(8, Math.round(Math.min(W, H) * 0.04))
  const G = Math.max(6, Math.round(Math.min(W, H) * 0.028))
  const ledH = Math.max(24, Math.round(H * 0.1))
  const ledY = P
  const footH = Math.max(56, Math.round(H * 0.22))
  const footY = H - P - footH
  const gearY = ledY + ledH + G
  const gearH = footY - G - gearY
  const cx = W / 2

  const fCols = 2
  const fW = (W - 2 * P - G) / fCols
  const fx = (i: number): number => P + i * (fW + G)

  return (
    <div className="overlay-card dr-root rd-cup-cluster" data-overlay-id={config?.id} data-widget="cupCluster" style={{ width: '100%', height: '100%', overflow: 'hidden', background: palette.bg }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" width="100%" height="100%" style={{ display: 'block' }}>
        <rect x={0} y={0} width={W} height={H} rx={skin.material.radius} fill={palette.bg} />

        <RevLedBar pct={shiftPct} profile={skin.led} x={P} y={ledY} width={W - 2 * P} height={ledH} flashOn={redline} />

        <rect x={P} y={gearY} width={W - 2 * P} height={gearH} rx={skin.material.radius} fill={palette.bg} stroke={redline ? palette.crit : palette.accent} strokeWidth={skin.material.borderWidth} />
        <FitText x={cx} y={gearY + gearH / 2} boxW={(W - 2 * P) * 0.6} boxH={gearH * 0.82} text={gear} anchor="middle" baseline="middle" fontFamily={/^\d$/.test(gear) ? skin.segment.numeric : skin.segment.alpha} fill={redline ? palette.crit : palette.text} minFontPx={28} maxFontPx={gearH * 0.82} />

        <DataField x={fx(0)} y={footY} width={fW} height={footH} label="SPEED" value={speedStr} unit="KMH" state="normal" ghost={false} skin={skin} />
        <DataField x={fx(1)} y={footY} width={fW} height={footH} label="DELTA" value={formatDelta(delta)} unit="s" state={deltaState} ghost={false} skin={skin} />
      </svg>
    </div>
  )
}
