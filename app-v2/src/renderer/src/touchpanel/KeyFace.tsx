import { useEffect, useRef, useState, type ReactElement } from 'react'
import { FitText } from '../skins'
import { KeyIcon, hasIcon } from './icons'

// Auto-fitting icon+label overlay for a key. Measures the actual cell (ResizeObserver)
// and renders an SVG whose viewBox == the measured pixel box, so FitText fits the label
// in real px for ANY aspect ratio — overflow/tiny-text is structurally impossible.

const LABEL_FONT = "'Segoe UI', 'Segoe UI Variable', system-ui, -apple-system, sans-serif"

export interface KeyFaceProps {
  label: string
  icon?: string
  /** Label colour. */
  textColor: string
  /** Icon colour (usually the neon border/accent). */
  iconColor: string
  /** Place a label-only key's text in the bottom band (for images / rotary knobs). */
  bottomLabel?: boolean
  /** Soft upper bound for the label font (the user's chosen size); never overflows. */
  maxFont?: number
}

interface Size {
  w: number
  h: number
}

export function KeyFace({ label, icon, textColor, iconColor, bottomLabel = false, maxFont }: KeyFaceProps): ReactElement {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Size>({ w: 200, h: 120 })

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (r && r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { w, h } = size
  const showIcon = hasIcon(icon) && !!icon
  const showLabel = label.trim().length > 0
  const pad = Math.min(w, h) * 0.08
  const cap = (v: number): number => (maxFont && maxFont > 0 ? Math.min(v, maxFont) : v)

  const nodes: ReactElement[] = []

  if (showIcon && showLabel) {
    const labelH = Math.max(14, Math.min(h * 0.34, h * 0.42))
    const iconAreaH = Math.max(8, h - labelH - pad)
    const iconSize = Math.max(12, Math.min(w * 0.66, iconAreaH * 0.94))
    nodes.push(
      <KeyIcon
        key="i"
        id={icon as string}
        x={(w - iconSize) / 2}
        y={pad * 0.5 + (iconAreaH - iconSize) / 2}
        size={iconSize}
        color={iconColor}
        strokeWidth={2}
      />
    )
    nodes.push(
      <FitText
        key="l"
        x={w / 2}
        y={h - labelH / 2 - pad * 0.25}
        boxW={w * 0.9}
        boxH={labelH * 0.9}
        text={label}
        fontFamily={LABEL_FONT}
        fill={textColor}
        weight={800}
        minFontPx={10}
        maxFontPx={cap(labelH)}
        anchor="middle"
        baseline="middle"
      />
    )
  } else if (showIcon) {
    const iconSize = Math.max(12, Math.min(w, h) * 0.6)
    nodes.push(
      <KeyIcon
        key="i"
        id={icon as string}
        x={(w - iconSize) / 2}
        y={(h - iconSize) / 2}
        size={iconSize}
        color={iconColor}
        strokeWidth={2}
      />
    )
  } else if (showLabel) {
    const bottom = bottomLabel
    const labelH = bottom ? Math.max(14, Math.min(h * 0.34, h * 0.42)) : h * 0.66
    nodes.push(
      <FitText
        key="l"
        x={w / 2}
        y={bottom ? h - labelH / 2 - pad * 0.25 : h / 2}
        boxW={w * 0.9}
        boxH={bottom ? labelH * 0.9 : h * 0.66}
        text={label}
        fontFamily={LABEL_FONT}
        fill={textColor}
        weight={800}
        minFontPx={10}
        maxFontPx={cap(bottom ? labelH : h)}
        anchor="middle"
        baseline="middle"
      />
    )
  }

  return (
    <div ref={wrapRef} className="bb-face-wrap" aria-hidden="true">
      <svg className="bb-face" width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        {nodes}
      </svg>
    </div>
  )
}
