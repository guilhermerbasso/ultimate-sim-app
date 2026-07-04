// ── DataTile / AlarmStrip ─────────────────────────────────────────────────────
// Material data tiles (label / value / unit) and an alert strip. Tiles use a matte,
// carbon-weave or brushed-metal material fill with a hairline stroke; the value can
// render in DSEG (numeric) or the condensed face. AlarmStrip lays a row of alert
// chips that glow ONLY when active. Pure + NaN-safe.
//
// Props (DataTile):  { label?, value, unit?, width?, height?, color?, accent?,
//                      material?, align?, numeric?, idPrefix? }
// Props (AlarmStrip): { alarms[], width?, height?, gap?, glow?, idPrefix? }

import { type ReactElement } from 'react'
import {
  fmtNum,
  isNumericReadout,
  resolveColors,
  safe,
  FONT_SEG7,
  FONT_COND,
  type InstrumentColors,
  type MaterialKind
} from './tokens'
import { MOTORSPORT_ICONS, type MotorsportIconId } from '../icons/motorsport'
import { bloomFilter, materialFill, useUid } from './defs'

export interface DataTileProps {
  label?: string
  value: string | number
  unit?: string
  width?: number
  height?: number
  /** Value colour (state-coded by caller). Defaults to text. */
  color?: string
  /** Accent for the label / left rule. */
  accent?: string
  material?: MaterialKind
  align?: 'left' | 'center' | 'right'
  /** Force DSEG numeric face (default: auto-detect). */
  numeric?: boolean
  decimals?: number
  colors?: Partial<InstrumentColors>
  idPrefix?: string
}

export function DataTile({
  label,
  value,
  unit,
  width = 132,
  height = 76,
  color,
  accent,
  material = 'matte',
  align = 'left',
  numeric,
  decimals,
  colors: colorOverrides,
  idPrefix
}: DataTileProps): ReactElement {
  const uid = useUid(idPrefix)
  const colors = resolveColors(colorOverrides)
  const w = Math.max(16, safe(width, 132))
  const h = Math.max(16, safe(height, 76))
  const text = typeof value === 'number' ? fmtNum(value, typeof decimals === 'number' ? decimals : 0) : value ?? '—'
  const useSeg = numeric ?? isNumericReadout(text)
  const mat = materialFill(material, uid, colors)
  const valueColor = color ?? colors.text
  const acc = accent ?? colors.chrome

  const anchor = align === 'left' ? 'start' : align === 'center' ? 'middle' : 'end'
  const tx = align === 'left' ? 12 : align === 'center' ? w / 2 : w - 12
  const valueSize = Math.min(h * 0.5, w * 0.34)

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label ? `${label} ${text}` : text} style={{ display: 'block' }}>
      <defs>{mat.defs}</defs>
      <rect x={0.5} y={0.5} width={w - 1} height={h - 1} rx={3} fill={mat.fill} stroke={colors.stroke} strokeWidth={1} />
      {/* Accent left rule (warm chrome). */}
      <rect x={0.5} y={0.5} width={2.5} height={h - 1} rx={1} fill={acc} fillOpacity={0.85} />
      {label ? (
        <text
          x={tx}
          y={h * 0.26}
          fill={colors.textDim}
          fontSize={Math.max(7, h * 0.16)}
          fontFamily={FONT_COND}
          fontWeight={600}
          letterSpacing={1}
          textAnchor={anchor}
          dominantBaseline="central"
        >
          {label.toUpperCase()}
        </text>
      ) : null}
      <text
        x={tx}
        y={h * 0.66}
        fill={valueColor}
        fontSize={valueSize}
        fontFamily={useSeg ? FONT_SEG7 : FONT_COND}
        fontWeight={useSeg ? undefined : 700}
        textAnchor={anchor}
        dominantBaseline="central"
      >
        {text}
        {unit ? (
          <tspan fontFamily={FONT_COND} fontWeight={600} fontSize={valueSize * 0.5} fill={colors.textDim} dx={w * 0.02}>
            {unit}
          </tspan>
        ) : null}
      </text>
    </svg>
  )
}

export interface AlarmChip {
  label: string
  active?: boolean
  color?: string
  icon?: MotorsportIconId
}

export interface AlarmStripProps {
  alarms: AlarmChip[]
  width?: number
  height?: number
  gap?: number
  /** Glow active chips (default true). Glow only ever appears on active chips. */
  glow?: boolean
  colors?: Partial<InstrumentColors>
  idPrefix?: string
}

export function AlarmStrip({
  alarms,
  width = 320,
  height = 30,
  gap = 6,
  glow = true,
  colors: colorOverrides,
  idPrefix
}: AlarmStripProps): ReactElement {
  const uid = useUid(idPrefix)
  const colors = resolveColors(colorOverrides)
  const items = Array.isArray(alarms) ? alarms : []
  const n = Math.max(1, items.length)
  const w = Math.max(16, safe(width, 320))
  const h = Math.max(12, safe(height, 30))
  const g = Math.max(0, safe(gap, 6))
  const chipW = (w - g * (n - 1)) / n
  const bloomId = `${uid}-alarm-bloom`
  const anyGlow = glow && items.some((a) => a.active)

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="group" aria-label="alarms" style={{ display: 'block', overflow: 'visible' }}>
      <defs>{anyGlow ? bloomFilter(bloomId, 2, 0.7) : null}</defs>
      {items.map((a, i) => {
        const x = i * (chipW + g)
        const c = a.color ?? colors.danger
        const active = !!a.active
        const Glyph = a.icon ? MOTORSPORT_ICONS[a.icon] : null
        const iconSize = h * 0.6
        const hasIcon = !!Glyph
        return (
          <g key={i} filter={active && glow ? `url(#${bloomId})` : undefined}>
            <rect
              x={x + 0.5}
              y={0.5}
              width={chipW - 1}
              height={h - 1}
              rx={3}
              fill={active ? c : colors.recess}
              fillOpacity={active ? 0.22 : 1}
              stroke={active ? c : colors.stroke}
              strokeWidth={active ? 1.5 : 1}
            />
            {hasIcon ? (
              <g
                transform={`translate(${x + 6},${(h - iconSize) / 2})`}
                color={active ? c : colors.textMuted}
              >
                <Glyph width={iconSize} height={iconSize} />
              </g>
            ) : null}
            <text
              x={x + chipW / 2 + (hasIcon ? iconSize * 0.4 : 0)}
              y={h / 2}
              fill={active ? c : colors.textMuted}
              fontSize={Math.max(7, h * 0.4)}
              fontFamily={FONT_COND}
              fontWeight={700}
              letterSpacing={0.5}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {(a.label ?? '').toUpperCase()}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
