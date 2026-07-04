// ── TelltaleIcon / TelltaleBank ───────────────────────────────────────────────
// FIA / warning telltale lamps reusing the existing motorsport icon registry
// (icons/motorsport). Active lamps glow (feGaussianBlur bloom) in their warm/state
// colour; inactive lamps are dimmed with NO glow. TelltaleBank lays a row/grid of
// lamps. Pure.
//
// Props (TelltaleIcon): { icon, active?, size?, activeColor?, inactiveColor?,
//                         glow?, label?, idPrefix? }
// Props (TelltaleBank): { lamps[], size?, gap?, columns?, glow?, idPrefix? }

import { type ReactElement } from 'react'
import {
  MOTORSPORT_ICONS,
  type MotorsportIconId
} from '../icons/motorsport'
import { INSTRUMENT_COLORS, safe } from './tokens'
import { bloomFilter, useUid } from './defs'

export interface TelltaleIconProps {
  icon: MotorsportIconId
  active?: boolean
  /** Box size in px (default 28). */
  size?: number
  /** Colour when lit (default warm chrome / amber). */
  activeColor?: string
  /** Colour when dark (default muted). */
  inactiveColor?: string
  /** Glow when lit (default true). Glow only ever appears on active lamps. */
  glow?: boolean
  label?: string
  idPrefix?: string
}

export function TelltaleIcon({
  icon,
  active = false,
  size = 28,
  activeColor = INSTRUMENT_COLORS.warn,
  inactiveColor = INSTRUMENT_COLORS.textMuted,
  glow = true,
  label,
  idPrefix
}: TelltaleIconProps): ReactElement {
  const uid = useUid(idPrefix)
  const s = Math.max(8, safe(size, 28))
  const Glyph = MOTORSPORT_ICONS[icon]
  const color = active ? activeColor : inactiveColor
  const bloomId = `${uid}-tt-bloom`
  const showGlow = active && glow

  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      role="img"
      aria-label={label ?? icon}
      aria-pressed={active}
      style={{ display: 'block', overflow: 'visible' }}
    >
      {showGlow ? <defs>{bloomFilter(bloomId, 1.1, 0.8)}</defs> : null}
      <g
        color={color}
        opacity={active ? 1 : 0.5}
        filter={showGlow ? `url(#${bloomId})` : undefined}
      >
        {Glyph ? <Glyph width={24} height={24} /> : null}
      </g>
    </svg>
  )
}

export interface TelltaleLamp {
  icon: MotorsportIconId
  active?: boolean
  activeColor?: string
  label?: string
}

export interface TelltaleBankProps {
  lamps: TelltaleLamp[]
  /** Per-lamp box size in px (default 28). */
  size?: number
  gap?: number
  /** Columns; default = all lamps in one row. */
  columns?: number
  glow?: boolean
  idPrefix?: string
}

export function TelltaleBank({
  lamps,
  size = 28,
  gap = 6,
  columns,
  glow = true,
  idPrefix
}: TelltaleBankProps): ReactElement {
  const uid = useUid(idPrefix)
  const s = Math.max(8, safe(size, 28))
  const g = Math.max(0, safe(gap, 6))
  const items = Array.isArray(lamps) ? lamps : []
  const cols = Math.max(1, Math.trunc(safe(columns, items.length || 1)) || 1)
  const rows = Math.max(1, Math.ceil(items.length / cols))
  const w = cols * s + (cols - 1) * g
  const h = rows * s + (rows - 1) * g

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="group" aria-label="telltales" style={{ display: 'block', overflow: 'visible' }}>
      {items.map((lamp, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        const x = col * (s + g)
        const y = row * (s + g)
        return (
          <g key={i} transform={`translate(${x},${y})`}>
            <TelltaleIcon
              icon={lamp.icon}
              active={lamp.active}
              activeColor={lamp.activeColor}
              size={s}
              glow={glow}
              label={lamp.label}
              idPrefix={`${uid}-l${i}`}
            />
          </g>
        )
      })}
    </svg>
  )
}
