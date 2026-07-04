// GT3ClusterWidget — a compact GT3 race cluster (RPM ledbar + hero gear + fuel/laps/
// delta), rebuilt on the v2.39 instrument KIT. One root <svg> (fixed viewBox +
// preserveAspectRatio); the shift band is the shared RevLedBar, the hero gear is auto-
// fit FitText (or the AnalogDial face for the analog family) and every readout is a
// DataField — so nothing is sized from an element's height via CSS clamp() (the old
// overflow bug). The design family (config.stylePreset → overlayDesignFamily) still
// drives the accent and the dial-vs-box hero so the presets stay distinct. Skin-token
// only. A null snapshot degrades every readout to "—" and never emits NaN / Infinity.
import type { ReactElement } from 'react'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import type { WidgetProps } from './types'
import { formatDelta, formatGear, formatTime, numberOrDash, pct } from './format'
import { fuelLaps, fuelLevelPct, GT3_STREAM_SAFE } from './gt3Telemetry'
import { overlayDesignFamily, type OverlayDesignFamily } from '../../../../shared/overlays'
import { resolveSkin, FitText, zoneColor } from '../../skins'
import { RevLedBar, AnalogDial, DataField, type FieldState } from '../../instruments'

export const GT3_CLUSTER_STREAM_SAFE = GT3_STREAM_SAFE

function dims(config: WidgetProps['config']): { W: number; H: number } {
  const w = config?.position?.width
  const h = config?.position?.height
  return {
    W: typeof w === 'number' && w > 0 ? w : 540,
    H: typeof h === 'number' && h > 0 ? h : 220
  }
}

function familyAccent(family: OverlayDesignFamily, fallback: string): string {
  switch (family) {
    case 'neon':
      return '#00E0FF'
    case 'terminal':
      return '#39FF87'
    case 'heatmap':
      return '#FF8C2B'
    case 'bauhaus':
      return '#FFB000'
    case 'broadcast':
      return '#38BDF8'
    case 'analog':
      return '#E8EDF2'
    default:
      return fallback
  }
}

interface ClusterModel {
  shiftPct: number
  redline: boolean
  gear: string
  speed?: number
  fuelLiters?: number
  laps?: number
  fuelPct?: number
  delta?: number
  deltaState: FieldState
  lapTime: string
  status: string
}

function buildModel(snapshot: TelemetrySnapshot | null): ClusterModel {
  const shiftPct = pct(snapshot?.shiftIndicatorPct ?? (snapshot?.rpm ?? 0) / (snapshot?.maxRpm ?? 9000))
  const delta = snapshot?.deltaToBestSec ?? snapshot?.deltaToSessionBestSec
  const speedRaw = snapshot?.speedKmh
  return {
    shiftPct,
    redline: shiftPct >= 0.95,
    gear: formatGear(snapshot?.gear),
    speed: speedRaw !== undefined && Number.isFinite(speedRaw) ? Math.round(speedRaw) : undefined,
    fuelLiters: snapshot?.fuelLiters,
    laps: fuelLaps(snapshot),
    fuelPct: fuelLevelPct(snapshot),
    delta,
    deltaState: delta === undefined || !Number.isFinite(delta) ? 'normal' : delta <= 0 ? 'ok' : 'warn',
    lapTime: formatTime(snapshot?.currentLapTimeSec),
    status: snapshot?.connected ? 'RACE' : 'STANDBY'
  }
}

export function GT3ClusterWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const { palette } = skin
  const { W, H } = dims(config)
  const family = overlayDesignFamily(config?.stylePreset)
  const accent = familyAccent(family, palette.accent)
  const m = buildModel(snapshot)
  const heroColor = m.redline ? palette.crit : zoneColor(skin.led, m.shiftPct)

  const P = Math.max(8, Math.round(Math.min(W, H) * 0.04))
  const G = Math.max(6, Math.round(Math.min(W, H) * 0.035))
  const innerW = W - 2 * P
  const ledH = Math.max(18, Math.round(H * 0.12))
  const ledY = P
  const bodyY = ledY + ledH + G
  const bodyH = H - P - bodyY

  const leftW = Math.round(innerW * 0.26)
  const rightW = Math.round(innerW * 0.28)
  const midX = P + leftW + G
  const midW = innerW - leftW - rightW - 2 * G
  const rightX = midX + midW + G

  const leftH = (bodyH - G) / 2
  const rightH = (bodyH - 2 * G) / 3

  const speedH = Math.max(40, Math.round(bodyH * 0.3))
  const heroY = bodyY
  const heroH = bodyH - speedH - G
  const heroCx = midX + midW / 2
  const heroCy = heroY + heroH / 2
  const dialSize = Math.max(80, Math.min(midW, heroH))
  const useDial = family === 'analog'

  const df = (
    x: number, y: number, w: number, h: number,
    label: string, value: string, st: FieldState = 'normal', unit?: string
  ): ReactElement => (
    <DataField x={x} y={y} width={w} height={h} label={label} value={value} unit={unit} state={st} ghost={false} skin={skin} />
  )

  return (
    <div className="overlay-card dr-root rd-gt3-cluster" data-overlay-id={config?.id} data-widget="gt3Cluster" data-family={family} style={{ width: '100%', height: '100%', overflow: 'hidden', background: palette.bg }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" width="100%" height="100%" style={{ display: 'block' }}>
        <rect x={0} y={0} width={W} height={H} rx={skin.material.radius} fill={palette.bg} />

        <RevLedBar pct={m.shiftPct} profile={skin.led} x={P} y={ledY} width={innerW} height={ledH} flashOn={m.redline} />

        {/* Left: fuel + laps */}
        {df(P, bodyY, leftW, leftH, 'FUEL', numberOrDash(m.fuelLiters, 1), 'normal', 'L')}
        {df(P, bodyY + leftH + G, leftW, leftH, 'LAPS', numberOrDash(m.laps, 1), 'accent')}

        {/* Centre hero: dial (analog) or gear box, + speed */}
        {useDial ? (
          <g transform={`translate(${heroCx - dialSize / 2}, ${heroCy - dialSize / 2})`}>
            <AnalogDial value={m.shiftPct} min={0} max={1} size={dialSize} startAngleDeg={-135} endAngleDeg={135} showTicks={false} showValue={false} bezel="thin" material="carbon" needleColor={heroColor} warnFrom={0.5} redlineFrom={0.78} idPrefix="gt3-cluster-dial" />
          </g>
        ) : (
          <rect x={midX} y={heroY} width={midW} height={heroH} rx={skin.material.radius} fill={palette.bg} stroke={m.redline ? palette.crit : accent} strokeWidth={skin.material.borderWidth} />
        )}
        <FitText x={heroCx} y={heroCy} boxW={(useDial ? dialSize : midW) * 0.5} boxH={heroH * 0.6} text={m.gear} anchor="middle" baseline="middle" fontFamily={/^\d$/.test(m.gear) ? skin.segment.numeric : skin.segment.alpha} fill={heroColor} minFontPx={24} maxFontPx={heroH * 0.6} />
        {df(midX, bodyY + bodyH - speedH, midW, speedH, 'SPEED', numberOrDash(m.speed, 0), 'normal', 'KMH')}

        {/* Right: delta + lap + status */}
        {df(rightX, bodyY, rightW, rightH, 'DELTA', formatDelta(m.delta), m.deltaState, 's')}
        {df(rightX, bodyY + rightH + G, rightW, rightH, 'LAP', m.lapTime, 'info')}
        {df(rightX, bodyY + 2 * (rightH + G), rightW, rightH, 'MODE', m.status)}
      </svg>
    </div>
  )
}
