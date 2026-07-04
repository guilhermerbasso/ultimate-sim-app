import { type CSSProperties, type ReactElement } from 'react'
import type { Flags, TelemetrySnapshot } from '../../../../shared/telemetry'
import type { StressState } from '../../../../shared/biometrics'
import { formatDelta, formatGear, numberOrDash } from '../widgets/format'
import './ar-hud.css'

// AR HUD VIEW — a standalone, high-contrast HUD layout for AR glasses /
// passthrough. It is purely presentational: feed it a telemetry snapshot and an
// optional live HR reading and it renders edge-anchored, oversized readouts with
// the thinnest possible chrome. This does NOT touch the overlays system; the
// BiometricsView embeds it as a preview, and the same component can later back a
// dedicated transparent AR window (see REGISTRATION NEEDED in the module).

export interface ArHudHeartRate {
  bpm?: number
  state?: StressState
  baselineBpm?: number
}

export interface ArHudViewProps {
  snapshot: TelemetrySnapshot | null
  hr?: ArHudHeartRate
  /** Renders inside a rounded card (BiometricsView preview) vs full-bleed. */
  preview?: boolean
  style?: CSSProperties
}

type Tone = 'good' | 'cool' | 'warn' | 'bad' | 'dim' | 'neutral'

const toneClass: Record<Tone, string> = {
  good: 'arhud-good',
  cool: 'arhud-cool',
  warn: 'arhud-warn',
  bad: 'arhud-bad',
  dim: 'arhud-dim',
  neutral: ''
}

/** Dominant flag → label + tone. Cool/green is reserved for the green flag. */
function flagDisplay(flags?: Flags): { label: string; tone: Tone } | null {
  if (!flags) return null
  if (flags.checkered) return { label: 'Checkered', tone: 'neutral' }
  if (flags.red) return { label: 'Red', tone: 'bad' }
  if (flags.black) return { label: 'Black', tone: 'bad' }
  if (flags.meatball) return { label: 'Damage', tone: 'warn' }
  if (flags.yellow) return { label: 'Yellow', tone: 'warn' }
  if (flags.blue) return { label: 'Blue', tone: 'cool' }
  if (flags.white) return { label: 'White', tone: 'neutral' }
  if (flags.green) return { label: 'Green', tone: 'good' }
  return null
}

/** Faster than reference (negative delta) is GOOD → cool green. */
function deltaTone(delta?: number): Tone {
  if (delta === undefined || !Number.isFinite(delta)) return 'dim'
  if (delta < -0.02) return 'good'
  if (delta > 0.02) return 'bad'
  return 'neutral'
}

function hrTone(state?: StressState): Tone {
  if (state === 'calm') return 'good'
  if (state === 'elevated') return 'warn'
  if (state === 'stressed') return 'bad'
  return 'neutral'
}

function fuelLapsLeft(snapshot: TelemetrySnapshot | null): number | undefined {
  if (!snapshot?.fuelLiters || !snapshot.fuelPerLap || snapshot.fuelPerLap <= 0) return undefined
  return snapshot.fuelLiters / snapshot.fuelPerLap
}

function fuelTone(laps?: number): Tone {
  if (laps === undefined) return 'dim'
  if (laps < 2) return 'bad'
  if (laps < 4) return 'warn'
  return 'neutral'
}

export function ArHudView({ snapshot, hr, preview, style }: ArHudViewProps): ReactElement {
  const connected = Boolean(snapshot?.connected)
  const gear = formatGear(snapshot?.gear)
  const speed = Math.round(snapshot?.speedKmh ?? 0)
  const position = snapshot?.position
  const totalCars = snapshot?.totalCars
  const delta = snapshot?.deltaToBestSec ?? snapshot?.deltaToSessionBestSec
  const flag = flagDisplay(snapshot?.flags)
  const laps = fuelLapsLeft(snapshot)
  const hrBpm = hr?.bpm

  const rootClass = `arhud${preview ? ' arhud--preview' : ''}${connected ? '' : ' arhud-stale'}`

  return (
    <div className={rootClass} style={style} data-testid="ar-hud">
      {/* Top-left: position + flag */}
      <div className="arhud-zone arhud-zone--tl">
        <div className="arhud-block">
          <span className="arhud-label">Pos</span>
          <span className="arhud-value arhud-value--md">
            {position !== undefined ? `P${position}` : '—'}
            {totalCars ? <span className="arhud-unit">/{totalCars}</span> : null}
          </span>
        </div>
        {flag ? <span className={`arhud-flag ${toneClass[flag.tone]}`}>{flag.label}</span> : null}
      </div>

      {/* Top-right: heart rate */}
      <div className="arhud-zone arhud-zone--tr">
        <div className="arhud-block arhud-block--right">
          <span className="arhud-label">Heart rate</span>
          <span className={`arhud-hr ${toneClass[hrTone(hr?.state)]}`}>
            <span className="arhud-hr-beat">{hrBpm !== undefined ? hrBpm : '—'}</span>
            <span className="arhud-unit">BPM</span>
          </span>
        </div>
      </div>

      {/* Center: gear + speed (the primary glance value) */}
      <div className="arhud-zone arhud-zone--center">
        <span className={`arhud-gear ${connected ? '' : 'arhud-dim'}`}>{gear}</span>
        <span className="arhud-value arhud-value--lg arhud-speed">
          {speed}
          <span className="arhud-unit">KM/H</span>
        </span>
      </div>

      {/* Bottom-center: delta to reference lap */}
      <div className="arhud-zone arhud-zone--bottom">
        <span className="arhud-label">Delta</span>
        <span className={`arhud-value arhud-delta ${toneClass[deltaTone(delta)]}`}>{formatDelta(delta)}</span>
      </div>

      {/* Bottom-left: fuel */}
      <div className="arhud-zone arhud-zone--bl">
        <div className="arhud-block">
          <span className="arhud-label">Fuel laps</span>
          <span className={`arhud-value arhud-value--md ${toneClass[fuelTone(laps)]}`}>
            {laps !== undefined ? laps.toFixed(1) : '—'}
          </span>
        </div>
      </div>

      {/* Bottom-right: fuel volume + lap */}
      <div className="arhud-zone arhud-zone--br">
        <div className="arhud-block arhud-block--right">
          <span className="arhud-label">Lap</span>
          <span className="arhud-value arhud-value--md">{numberOrDash(snapshot?.currentLap, 0)}</span>
        </div>
      </div>
    </div>
  )
}

export default ArHudView
