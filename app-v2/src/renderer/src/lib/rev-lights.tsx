import { type ReactElement } from 'react'
import { DEFAULT_ALERTS_CONFIG } from '../../../shared/alerts'
import { resolveShiftNow } from '../../../shared/revlights'

export const SHIFT_STROBE_BLUE = '#1e63ff'
export const SHIFT_PCT = DEFAULT_ALERTS_CONFIG.shiftPoint.shiftIndicatorPct

export interface RevLightState {
  pct: number
  atShiftPoint: boolean
}

function finiteOr(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function clampRevLightPct(value: number | null | undefined): number {
  return Math.max(0, Math.min(1, finiteOr(value, 0)))
}

export function resolveRevLightState(
  value: number | null | undefined,
  blink?: boolean,
  shiftPct = SHIFT_PCT
): RevLightState {
  const pct = clampRevLightPct(value)
  const threshold = clampRevLightPct(finiteOr(shiftPct, SHIFT_PCT))
  return { pct, atShiftPoint: resolveShiftNow(blink, pct >= threshold) }
}

export function atShiftPoint(
  value: number | null | undefined,
  blink?: boolean,
  shiftPct = SHIFT_PCT
): boolean {
  return resolveRevLightState(value, blink, shiftPct).atShiftPoint
}

export function revFill(baseColor: string, atShift: boolean): string {
  return atShift ? SHIFT_STROBE_BLUE : baseColor
}

export function ShiftStrobe({ active }: { active: boolean }): ReactElement | null {
  if (!active) return null
  return (
    <animate
      attributeName="opacity"
      values="1;0.08;1"
      keyTimes="0;0.5;1"
      dur="0.14s"
      repeatCount="indefinite"
    />
  )
}

export interface RevLightRowLayoutOptions {
  gap?: number
  paddingX?: number
  paddingY?: number
  heightRatio?: number
  minLedHeight?: number
  maxLedHeight?: number
}

export interface RevLightRowLayout {
  width: number
  height: number
  count: number
  gap: number
  ledWidth: number
  ledHeight: number
  y: number
  positions: number[]
}

export function revLightRowLayout(
  width: number | null | undefined,
  height: number | null | undefined,
  count: number | null | undefined,
  options: RevLightRowLayoutOptions = {}
): RevLightRowLayout {
  const safeWidth = Math.max(1, finiteOr(width, 1))
  const safeHeight = Math.max(1, finiteOr(height, 1))
  const safeCount = Math.max(1, Math.min(128, Math.trunc(finiteOr(count, 1)) || 1))

  const paddingX = Math.min(
    Math.max(0, finiteOr(options.paddingX, 0)),
    Math.max(0, (safeWidth - 1) / 2)
  )
  const paddingY = Math.min(
    Math.max(0, finiteOr(options.paddingY, 0)),
    Math.max(0, (safeHeight - 1) / 2)
  )
  const innerWidth = Math.max(1, safeWidth - paddingX * 2)
  const innerHeight = Math.max(1, safeHeight - paddingY * 2)

  const requestedGap = Math.max(
    0,
    finiteOr(options.gap, Math.max(2, innerWidth / (safeCount * 10)))
  )
  const maxGap = safeCount > 1
    ? innerWidth / (safeCount - 1 + safeCount * 0.25)
    : 0
  const gap = Math.min(requestedGap, maxGap)
  const ledWidth = (innerWidth - gap * (safeCount - 1)) / safeCount

  const heightRatio = clampRevLightPct(finiteOr(options.heightRatio, 1))
  const minLedHeight = Math.min(
    innerHeight,
    Math.max(0.5, finiteOr(options.minLedHeight, 1))
  )
  const maxLedHeight = Math.min(
    innerHeight,
    Math.max(minLedHeight, finiteOr(options.maxLedHeight, innerHeight))
  )
  const ledHeight = Math.min(
    maxLedHeight,
    Math.max(minLedHeight, innerHeight * heightRatio)
  )
  const y = paddingY + (innerHeight - ledHeight) / 2
  const positions = Array.from(
    { length: safeCount },
    (_, index) => paddingX + index * (ledWidth + gap)
  )

  return {
    width: safeWidth,
    height: safeHeight,
    count: safeCount,
    gap,
    ledWidth,
    ledHeight,
    y,
    positions
  }
}
