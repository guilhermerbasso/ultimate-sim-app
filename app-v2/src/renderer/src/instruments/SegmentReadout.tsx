// ── SegmentReadout ────────────────────────────────────────────────────────────
// A DSEG 7/14-segment numeric readout reusing the embedded DSEG fonts. Numerals are
// rendered in DSEG 7-seg (mode '7'); strings containing letters are routed to the
// 14-seg (mode '14') / condensed face so the 7-seg never renders garbled glyphs.
// An optional faded "8.8.8" ghost backdrop emulates an unlit LCD. Pure + NaN-safe.
//
// Props: { value, mode?, digits?, ghost?, decimals?, color?, ghostColor?, height?,
//          width?, align?, unit?, label?, idPrefix? }

import { type ReactElement } from 'react'
import { fmtNum, isNumericReadout, safe, FONT_SEG7, FONT_SEG14, FONT_COND } from './tokens'
import { INSTRUMENT_COLORS } from './tokens'
import { useUid } from './defs'

export type SegmentMode = '7' | '14'

export interface SegmentReadoutProps {
  value: string | number
  /** Force a face; default auto: numerals→7-seg, text→14-seg. */
  mode?: SegmentMode
  /** Ghost-backdrop digit count (default = rendered length). */
  digits?: number
  /** Draw the faded "888" backdrop (default true). */
  ghost?: boolean
  decimals?: number
  color?: string
  ghostColor?: string
  /** Glyph height in px (default 48). */
  height?: number
  /** Optional fixed SVG width (defaults to fit). */
  width?: number
  align?: 'left' | 'center' | 'right'
  unit?: string
  label?: string
  idPrefix?: string
}

function formatValue(value: string | number, decimals?: number): string {
  if (typeof value === 'number') {
    return fmtNum(value, typeof decimals === 'number' ? decimals : 0)
  }
  return value ?? ''
}

// DSEG 7/14-seg renders letters as garbled segment soup, so a value that carries
// a trailing unit (e.g. "214 KM/H") must never reach the segment face intact.
// Split a numeric HEAD from a trailing alpha unit so the head stays DSEG and the
// unit is routed to the condensed face. Returns null when there is no numeric
// head or no alpha tail (e.g. "PIT", "—", "1234", "0:47.360") — those are left
// untouched so existing behaviour is preserved.
function splitTrailingUnit(t: string): { head: string; unit: string } | null {
  const m = /^(\s*[-−+]?\d[\d.,:\s]*?)\s*([A-Za-z°%/][A-Za-z°%/.\s]*)$/.exec(t)
  if (!m) return null
  const head = m[1].trim()
  const unit = m[2].trim()
  return head && unit ? { head, unit } : null
}

export function SegmentReadout({
  value,
  mode,
  digits,
  ghost = true,
  decimals,
  color = INSTRUMENT_COLORS.text,
  ghostColor,
  height = 48,
  width,
  align = 'right',
  unit,
  label,
  idPrefix
}: SegmentReadoutProps): ReactElement {
  const uid = useUid(idPrefix)
  const h = Math.max(8, safe(height, 48))
  const rawText = formatValue(value, decimals)
  // Only auto-split when the caller did NOT pass an explicit unit and the value
  // is a raw string that baked one in (numbers are already pure numerics).
  const autoSplit = !unit && typeof value === 'string' ? splitTrailingUnit(rawText) : null
  const text = autoSplit ? autoSplit.head : rawText
  const effUnit = unit ?? autoSplit?.unit
  // 7-seg only safely renders digits/+/-/./:/space; anything else → 14-seg.
  const numericFace = mode ? mode === '7' : isNumericReadout(text) || /^[\d.\-: ]*$/.test(text)
  const face = numericFace ? FONT_SEG7 : FONT_SEG14
  const fontSize = h
  // DSEG glyphs are ~0.62em wide; ghost width tracks the larger of value/digits.
  const charW = fontSize * 0.66
  const valueLen = text.length || 1
  const ghostLen = Math.max(valueLen, Math.max(0, Math.trunc(safe(digits, valueLen))))
  const ghostText = numericFace ? '8'.repeat(ghostLen) : '~'.repeat(ghostLen)
  const labelH = label ? fontSize * 0.32 : 0
  const w = width ?? ghostLen * charW + fontSize * 0.4 + (effUnit ? effUnit.length * charW * 0.55 : 0)
  const totalH = h + labelH + 4

  const anchor = align === 'left' ? 'start' : align === 'center' ? 'middle' : 'end'
  const tx = align === 'left' ? 2 : align === 'center' ? w / 2 : w - 2
  const baseY = labelH + h * 0.82

  return (
    <svg
      width={w}
      height={totalH}
      viewBox={`0 0 ${w} ${totalH}`}
      role="img"
      aria-label={label ? `${label} ${rawText}` : rawText}
      style={{ display: 'block' }}
    >
      {label ? (
        <text
          x={tx}
          y={labelH * 0.6}
          fill={ghostColor ?? INSTRUMENT_COLORS.textDim}
          fontSize={labelH}
          fontFamily={FONT_COND}
          fontWeight={600}
          textAnchor={anchor}
          dominantBaseline="central"
          letterSpacing={1}
        >
          {label.toUpperCase()}
        </text>
      ) : null}
      {ghost ? (
        <text
          x={tx}
          y={baseY}
          fill={ghostColor ?? color}
          fillOpacity={0.1}
          fontSize={fontSize}
          fontFamily={face}
          textAnchor={anchor}
          dominantBaseline="alphabetic"
        >
          {ghostText}
        </text>
      ) : null}
      <text
        x={effUnit ? tx - (align === 'right' ? effUnit.length * charW * 0.55 : 0) : tx}
        y={baseY}
        fill={color}
        fontSize={fontSize}
        fontFamily={face}
        textAnchor={anchor}
        dominantBaseline="alphabetic"
      >
        {text}
      </text>
      {effUnit ? (
        <text
          x={w - 2}
          y={baseY}
          fill={INSTRUMENT_COLORS.textDim}
          fontSize={fontSize * 0.42}
          fontFamily={FONT_COND}
          fontWeight={600}
          textAnchor="end"
          dominantBaseline="alphabetic"
        >
          {effUnit}
        </text>
      ) : null}
    </svg>
  )
}
