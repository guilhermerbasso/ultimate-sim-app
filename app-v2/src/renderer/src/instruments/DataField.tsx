// DataField — a labelled data cell like the real DDU bottom strip / side columns:
// a small top label + a big auto-fit DSEG value (+ optional unit), state-coloured,
// on a bezelled panel. Renders as a nested <svg x y width height viewBox> so it
// composes into any parent widget SVG at a grid cell. Consumes a skin token only.
import { type ReactElement } from 'react'
import type { SkinToken } from '../skins/tokens'
import { FitText } from '../skins/FitText'

export type FieldState = 'normal' | 'ok' | 'warn' | 'crit' | 'info' | 'accent'

export interface DataFieldProps {
  x?: number
  y?: number
  width: number
  height: number
  label: string
  value: string
  unit?: string
  state?: FieldState
  /** Draw the panel bezel (default true). */
  panel?: boolean
  /** Draw the dim "all-segments-on" DSEG ghost backing (default from skin). */
  ghost?: boolean
  skin: SkinToken
  align?: 'center' | 'left'
}

function stateColor(state: FieldState, skin: SkinToken): string {
  const p = skin.palette
  switch (state) {
    case 'ok':
      return p.ok
    case 'warn':
      return p.warn
    case 'crit':
      return p.crit
    case 'info':
      return p.info
    case 'accent':
      return p.accent
    default:
      return p.text
  }
}

export function DataField({
  x = 0,
  y = 0,
  width,
  height,
  label,
  value,
  unit,
  state = 'normal',
  panel = true,
  ghost,
  skin,
  align = 'center'
}: DataFieldProps): ReactElement {
  const { palette, typography, segment, material } = skin
  const showGhost = ghost ?? segment.ghost
  const valueColor = stateColor(state, skin)

  const pad = Math.max(2, Math.min(width, height) * 0.08)
  const iw = Math.max(1, width - pad * 2)
  const ih = Math.max(1, height - pad * 2)
  const labelH = Math.min(ih * 0.34, 18)
  const valueH = ih - labelH
  const anchor = align === 'left' ? 'start' : 'middle'
  const labelX = align === 'left' ? pad : width / 2
  const valueX = align === 'left' ? pad : width / 2

  const valueText = unit ? `${value}${unit}` : value
  // A dim all-on ghost string behind the DSEG value (real LCD look) — same char
  // count so it sits directly behind the live digits.
  const ghostStr = showGhost ? value.replace(/[0-9]/g, '8').replace(/[^\d.:+\- ]/g, '~') : ''

  return (
    <svg x={x} y={y} width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', overflow: 'visible' }}>
      {panel && (
        <rect
          x={0.5}
          y={0.5}
          width={width - 1}
          height={height - 1}
          rx={material.radius * 0.5}
          fill={material.base}
          stroke={material.border}
          strokeWidth={material.borderWidth}
        />
      )}
      <FitText
        x={labelX}
        y={pad + labelH / 2}
        boxW={iw}
        boxH={labelH}
        text={label.toUpperCase()}
        anchor={anchor}
        fontFamily={typography.label}
        fill={palette.textDim}
        minFontPx={8}
        maxFontPx={labelH}
        weight={600}
        letterSpacing={0.5}
      />
      {showGhost && ghostStr && (
        <text
          x={valueX}
          y={pad + labelH + valueH / 2}
          textAnchor={anchor}
          dominantBaseline="middle"
          fontFamily={segment.numeric}
          fontSize={Math.min(valueH, iw / Math.max(1, valueText.length) * 1.6)}
          fill={palette.text}
          opacity={segment.ghostOpacity}
        >
          {ghostStr}
        </text>
      )}
      <FitText
        x={valueX}
        y={pad + labelH + valueH / 2}
        boxW={iw}
        boxH={valueH}
        text={valueText}
        anchor={anchor}
        fontFamily={segment.numeric}
        fill={valueColor}
        minFontPx={11}
        maxFontPx={valueH}
      />
    </svg>
  )
}
