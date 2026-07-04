import type { CSSProperties, ReactNode } from 'react'
import { overlayDesignFamily } from '../../../../shared/overlays'
import type { WidgetProps } from './types'
import { TelltaleIcon } from '../../instruments'
import type { MotorsportIconId } from '../../icons/motorsport'
import './redesign-detail.css'
import { FLAG_PALETTE } from './FlagsWidget'

// Warning-light + FIA-flag glyphs come from the shared motorsport icon registry
// (src/renderer/src/icons/motorsport) — single source of truth, currentColor-driven.

export const SYMBOL_STATUS_STREAM_SAFE = true

const INACTIVE = 'rgba(182,196,216,0.46)'

interface SymItem {
  id: string
  short: string
  icon: MotorsportIconId
  active: boolean
  color: string
}

export function SymbolStatusWidget({ snapshot, config }: WidgetProps) {
  const family = overlayDesignFamily(config?.stylePreset)
  const flags = snapshot?.flags

  const fuelPct = snapshot?.fuelCapacityLiters && snapshot.fuelCapacityLiters > 0
    ? (snapshot.fuelLiters ?? 0) / snapshot.fuelCapacityLiters
    : undefined
  const lowFuel = (snapshot?.fuelLiters !== undefined && snapshot.fuelLiters < 5) || (fuelPct !== undefined && fuelPct < 0.08)

  const oilBar = snapshot?.oilPressureKpa !== undefined ? snapshot.oilPressureKpa / 100 : undefined
  const engineWarn = oilBar !== undefined && oilBar < 2.5 && (snapshot?.rpm ?? 0) > 1200

  const oilHot = (snapshot?.oilTempC ?? 0) >= 130
  const oilWarm = !oilHot && (snapshot?.oilTempC ?? 0) >= 115 && snapshot?.oilTempC !== undefined
  const waterHot = (snapshot?.waterTempC ?? 0) >= 110
  const waterWarm = !waterHot && (snapshot?.waterTempC ?? 0) >= 100 && snapshot?.waterTempC !== undefined

  const items: SymItem[] = [
    { id: 'tc', short: 'TC', icon: 'tc', active: !!snapshot?.tcActive, color: '#ffb000' },
    { id: 'abs', short: 'ABS', icon: 'abs', active: !!snapshot?.absActive, color: '#ffb000' },
    { id: 'pit', short: 'PIT', icon: 'pit-limiter', active: !!snapshot?.pitLimiter, color: '#ffb000' },
    { id: 'fuel', short: 'FUEL', icon: 'fuel', active: lowFuel, color: '#ff4d3d' },
    { id: 'eng', short: 'ENG', icon: 'engine', active: engineWarn, color: '#ff4d3d' },
    { id: 'oil', short: 'OIL', icon: 'oil-temp', active: oilHot || oilWarm, color: oilHot ? '#ff4d3d' : '#ffb000' },
    { id: 'h2o', short: 'H2O', icon: 'water-temp', active: waterHot || waterWarm, color: waterHot ? '#ff4d3d' : '#ffb000' },
    { id: 'fy', short: 'YEL', icon: 'flag-yellow', active: !!flags?.yellow, color: FLAG_PALETTE.yellow.color },
    { id: 'fb', short: 'BLU', icon: 'flag-blue', active: !!flags?.blue, color: FLAG_PALETTE.blue.color },
    { id: 'fw', short: 'WHT', icon: 'flag-white', active: !!flags?.white, color: FLAG_PALETTE.white.color },
    { id: 'fc', short: 'CHK', icon: 'flag-checkered', active: !!flags?.checkered, color: FLAG_PALETTE.checkered.color },
    { id: 'fr', short: 'RED', icon: 'flag-red', active: !!flags?.red, color: FLAG_PALETTE.red.color },
    { id: 'drs', short: 'DRS', icon: 'drs', active: !!snapshot?.drs, color: '#2ee06a' }
  ]

  const root = `overlay-card rd2-card rd2-fam-${family} rd2-sym rd2-sym-${family}`

  if (family === 'terminal') {
    return (
      <div className={root}>
        <div className="rd2-sym-trm">
          <div className="rd2-sym-trm-head">[ STATUS ]</div>
          <div className="rd2-sym-trm-grid">
            {items.map((it) => (
              <span key={it.id} className="rd2-sym-trm-cell" style={{ color: it.active ? it.color : INACTIVE }}>
                {it.short}:{it.active ? 'ON' : '--'}
              </span>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const lamp = (it: SymItem, size = 24): ReactNode => (
    <TelltaleIcon
      icon={it.icon}
      active={it.active}
      activeColor={it.color}
      inactiveColor={INACTIVE}
      size={size}
      glow={it.active}
      label={it.short}
      idPrefix={`symbol-${it.id}`}
    />
  )

  const iconBox = (it: SymItem, cls: string): ReactNode => (
    <div key={it.id} className={`${cls}${it.active ? ' is-on' : ''}`} title={it.short}
      style={{ color: it.active ? it.color : INACTIVE, '--rd2-sym': it.color } as CSSProperties}>
      <div className="rd2-sym-ico">{lamp(it)}</div>
    </div>
  )

  if (family === 'bauhaus') {
    return <div className={root}><div className="rd2-sym-bhs">{items.map((it) => (
      <div key={it.id} className={`rd2-sym-bhs-tile${it.active ? ' is-on' : ''}`} title={it.short}
        style={{ background: it.active ? it.color : '#0a0e14', color: it.active ? '#0a0e14' : INACTIVE }}>
        <div className="rd2-sym-ico">{lamp(it)}</div>
      </div>
    ))}</div></div>
  }

  if (family === 'heatmap') {
    return <div className={root}><div className="rd2-sym-hm">{items.map((it) => (
      <div key={it.id} className="rd2-sym-hm-cell" title={it.short}
        style={{ background: it.active ? `color-mix(in srgb, ${it.color} 38%, transparent)` : 'rgba(255,255,255,0.03)', borderColor: it.active ? it.color : 'var(--rd2-line)', color: it.active ? it.color : INACTIVE }}>
        <div className="rd2-sym-ico">{lamp(it)}</div>
        <em>{it.short}</em>
      </div>
    ))}</div></div>
  }

  if (family === 'analog') {
    return <div className={root}><div className="rd2-sym-ang">{items.map((it) => (
      <div key={it.id} className={`rd2-sym-ang-lamp${it.active ? ' is-on' : ''}`} title={it.short}
        style={{ color: it.active ? it.color : INACTIVE, '--rd2-sym': it.color } as CSSProperties}>
        <div className="rd2-sym-ico">{lamp(it, 26)}</div>
      </div>
    ))}</div></div>
  }

  if (family === 'broadcast') {
    return <div className={root}><div className="rd2-sym-bc">{items.map((it) => (
      <div key={it.id} className={`rd2-sym-bc-cell${it.active ? ' is-on' : ''}`} title={it.short}
        style={{ color: it.active ? it.color : INACTIVE, '--rd2-sym': it.color } as CSSProperties}>
        <div className="rd2-sym-ico">{lamp(it)}</div>
        <span className="rd2-sym-bc-label">{it.short}</span>
      </div>
    ))}</div></div>
  }

  if (family === 'glass') {
    return <div className={root}><div className="rd2-sym-row">{items.map((it) => iconBox(it, 'rd2-sym-glass-chip'))}</div></div>
  }

  if (family === 'neon') {
    return <div className={root}><div className="rd2-sym-row rd2-sym-neon-row">{items.map((it) => (
      <div key={it.id} className={`rd2-sym-neon-ico${it.active ? ' is-on' : ''}`} title={it.short}
        style={{ color: it.active ? it.color : INACTIVE, filter: it.active ? `drop-shadow(0 0 6px ${it.color})` : undefined }}>
        <div className="rd2-sym-ico">{lamp(it)}</div>
      </div>
    ))}</div></div>
  }

  // minimal
  return <div className={root}><div className="rd2-sym-row">{items.map((it) => (
    <div key={it.id} className="rd2-sym-min-ico" title={it.short} style={{ color: it.active ? it.color : INACTIVE }}>
      <div className="rd2-sym-ico">{lamp(it)}</div>
    </div>
  ))}</div></div>
}
