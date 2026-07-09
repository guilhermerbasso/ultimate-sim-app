import { type ReactElement, type ReactNode } from 'react'
import type { HifiWidgetProps } from '../types'
import { C, CleanTile, FONT_BIG, FONT_LABEL, FONT_NUM, LEGIBLE, VBar, Bar, clamp01, fixed, frac, legibleStroke, num } from '../kit'

export const SINGLE_W = 180
export const SINGLE_H = 220
export const COMBO_W = 320
export const COMBO_H = 220

export function pctValue(value: unknown): number | undefined {
  const v = num(value)
  return v == null ? undefined : clamp01(v) * 100
}

export function pctFrac(value: unknown): number {
  const v = num(value)
  return v == null ? 0 : frac(v, 0, 1)
}

export function inputPctText(value: unknown): string {
  return fixed(pctValue(value), 0)
}

export function valueColor(value: number | undefined, color: string): string {
  return value == null ? C.dim : color
}

export function WidgetSvg({
  w,
  h,
  label,
  children
}: {
  w: number
  h: number
  label: string
  accent: string
  children: ReactNode
}): ReactElement {
  return (
    <CleanTile width={w} height={h}>
      <defs>
        <filter id={`${label}-soft`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
      {children}
    </CleanTile>
  )
}

export function PercentBarWidget({
  label,
  color,
  value,
  width,
  height
}: HifiWidgetProps & {
  label: string
  color: string
  value: unknown
}): ReactElement {
  const w = width ?? SINGLE_W
  const h = height ?? SINGLE_H
  const pct = pctValue(value)
  const f = pctFrac(value)
  const barX = 38
  const barY = 50
  const barW = 34
  const barH = 130
  return (
    <WidgetSvg w={w} h={h} label={label} accent={color}>
      <g>
        {[0, 25, 50, 75, 100].map((tick) => {
          const y = barY + barH - (tick / 100) * barH
          return (
            <g key={tick}>
              <line x1={barX - 7} x2={barX - 2} y1={y} y2={y} stroke={C.dim} strokeWidth={1} />
              <text x={barX - 10} y={y + 4} textAnchor="end" fill={C.text} fontFamily={FONT_NUM} fontSize={10} {...LEGIBLE}>
                {tick}
              </text>
            </g>
          )
        })}
        <VBar x={barX} y={barY} w={barW} h={barH} f={f} color={color} />
        <rect x={barX + 3} y={barY + 3} width={barW - 6} height={barH - 6} rx={(barW - 6) / 2} fill="none" stroke="rgba(255,255,255,0.18)" />
        <rect x={barX + 5} y={barY + barH - Math.max(0, barH * f) - 10} width={barW - 10} height={14} rx={7} fill={color} opacity={pct == null ? 0 : 0.35} filter={`url(#${label}-soft)`} />
        <text x={w - 42} y={118} textAnchor="middle" fill={valueColor(pct, C.text)} fontFamily={FONT_BIG} fontSize={46} fontWeight={800} {...legibleStroke(46)}>
          {inputPctText(value)}
        </text>
        <text x={w - 42} y={148} textAnchor="middle" fill={valueColor(pct, color)} fontFamily={FONT_LABEL} fontSize={24} fontWeight={800} {...LEGIBLE}>
          %
        </text>
      </g>
    </WidgetSvg>
  )
}

export function MiniVBar({
  x,
  y,
  w,
  h,
  label,
  color,
  value
}: {
  x: number
  y: number
  w: number
  h: number
  label: string
  color: string
  value: unknown
}): ReactElement {
  const f = pctFrac(value)
  const pct = pctValue(value)
  return (
    <g>
      <text x={x + w / 2} y={y - 12} textAnchor="middle" fill={valueColor(pct, color)} fontFamily={FONT_LABEL} fontSize={13} fontWeight={800} letterSpacing={1.6} {...LEGIBLE}>
        {label}
      </text>
      <VBar x={x} y={y} w={w} h={h} f={f} color={color} />
      <rect x={x + 3} y={y + 3} width={w - 6} height={h - 6} rx={(w - 6) / 2} fill="none" stroke="rgba(255,255,255,0.18)" />
      <text x={x + w / 2} y={y + h + 22} textAnchor="middle" fill={C.text} fontFamily={FONT_NUM} fontSize={15} fontWeight={800} {...LEGIBLE}>
        {inputPctText(value)}%
      </text>
    </g>
  )
}

export function TraceBar({
  x,
  y,
  w,
  label,
  color,
  value
}: {
  x: number
  y: number
  w: number
  label: string
  color: string
  value: unknown
}): ReactElement {
  const pct = pctValue(value)
  const barX = x + 58
  const barW = Math.max(24, w - 58)
  return (
    <g>
      <text x={x} y={y + 16} fill={valueColor(pct, color)} fontFamily={FONT_LABEL} fontSize={14} fontWeight={800} letterSpacing={1.8} {...LEGIBLE}>
        {label}
      </text>
      <Bar x={barX} y={y} w={barW} h={22} f={pctFrac(value)} color={color} />
      <text x={x + w - 8} y={y + 16} textAnchor="end" fill={C.text} fontFamily={FONT_NUM} fontSize={14} fontWeight={800} {...LEGIBLE}>
        {inputPctText(value)}%
      </text>
    </g>
  )
}
