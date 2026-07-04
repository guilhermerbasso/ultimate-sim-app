// FitText — the auto-fit SVG <text> primitive that makes telemetry overflow
// structurally impossible. Because every widget's root <svg> uses a fixed
// viewBox + preserveAspectRatio, fitting happens once in DESIGN space and is
// scale-invariant (the browser scales the whole SVG uniformly afterwards).
//
// Contract (research opus.md §2.3, gemini.md §2.2):
//  • binary-search the font size in [minFontPx, maxFontPx] until the string fits
//    boxW×boxH (≤8 iters);
//  • degrade gracefully when SVG measurement APIs are absent (jsdom/SSR) via a
//    deterministic width estimate — never throws;
//  • if it can't reach minFontPx, report didFit=false and apply overflowStrategy
//    (squeeze via textLength / drop / ellipsis) — NEVER overflow;
//  • re-fit on text/box/font change and on document.fonts.ready (web-font swap).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'

export type OverflowStrategy = 'squeeze' | 'drop' | 'ellipsis'

export interface FitTextProps {
  x: number
  y: number
  /** Cell the text must fit inside, in SVG design units. */
  boxW: number
  boxH: number
  text: string
  fontFamily: string
  fill?: string
  minFontPx?: number
  maxFontPx?: number
  weight?: number | string
  anchor?: 'start' | 'middle' | 'end'
  baseline?: 'auto' | 'middle' | 'central' | 'hanging' | 'text-after-edge' | 'text-before-edge'
  letterSpacing?: number
  /** How to behave when the string can't fit even at minFontPx. Default 'squeeze'. */
  overflowStrategy?: OverflowStrategy
  className?: string
  style?: CSSProperties
  /** Reports (didFit, fittedFontPx) after each fit — used by the overflow linter. */
  onFit?: (didFit: boolean, fontPx: number) => void
}

// Average glyph advance for condensed/mono display faces (~0.58em). Only used as
// a deterministic fallback when getComputedTextLength is unavailable (tests/SSR).
const EST_ADVANCE = 0.58

function estimateWidth(text: string, fontPx: number): number {
  return text.length * fontPx * EST_ADVANCE
}

function measureWidth(el: SVGTextElement | null, text: string, fontPx: number): number {
  if (el && typeof el.getComputedTextLength === 'function') {
    el.setAttribute('font-size', String(fontPx))
    try {
      const w = el.getComputedTextLength()
      if (w > 0) return w
    } catch {
      // fall through to estimate
    }
  }
  return estimateWidth(text, fontPx)
}

interface FitResult {
  fontPx: number
  didFit: boolean
  shown: string
}

/**
 * Pure fit calculation (exported for tests). `el=null` uses the deterministic
 * width estimate, so this is fully testable without a DOM.
 */
export function computeFit(
  el: SVGTextElement | null,
  text: string,
  boxW: number,
  boxH: number,
  minPx: number,
  maxPx: number,
  strategy: OverflowStrategy
): FitResult {
  // Guard degenerate boxes so we never emit NaN or overflow a zero/negative cell.
  if (!(boxW > 0) || !(boxH > 0) || !text) {
    return { fontPx: Math.max(1, minPx), didFit: false, shown: strategy === 'drop' ? '' : text }
  }
  // Height binds fontPx: keep the glyph box within boxH (tabular numerics have no
  // descenders, so fontPx ≈ visual height is a safe conservative cap).
  const hiCap = Math.max(minPx, Math.min(maxPx, boxH))
  let lo = minPx
  let hi = hiCap
  let best = minPx
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2
    const w = measureWidth(el, text, mid)
    if (w <= boxW) {
      best = mid
      lo = mid
    } else {
      hi = mid
    }
  }
  const bestW = measureWidth(el, text, best)
  if (bestW <= boxW + 0.5) {
    return { fontPx: best, didFit: true, shown: text }
  }
  // Can't fit even at the legibility floor → apply strategy (never overflow width).
  if (strategy === 'drop') return { fontPx: minPx, didFit: false, shown: '' }
  if (strategy === 'ellipsis') {
    let s = text
    while (s.length > 0 && measureWidth(el, s + '…', minPx) > boxW) s = s.slice(0, -1)
    const shown = s.length === 0 ? '' : s.length < text.length ? s + '…' : s
    return { fontPx: minPx, didFit: false, shown }
  }
  // 'squeeze' — render at minPx and let textLength compress width (stays ≥ floor).
  return { fontPx: minPx, didFit: false, shown: text }
}

/** Auto-fitting SVG text. See file header for the contract. */
export function FitText(props: FitTextProps): ReactElement | null {
  const {
    x,
    y,
    boxW,
    boxH,
    text,
    fontFamily,
    fill,
    minFontPx = 11,
    maxFontPx = 400,
    weight,
    anchor = 'middle',
    baseline = 'middle',
    letterSpacing,
    overflowStrategy = 'squeeze',
    className,
    style,
    onFit
  } = props

  const ref = useRef<SVGTextElement>(null)
  const [fit, setFit] = useState<FitResult>({ fontPx: Math.min(maxFontPx, boxH), didFit: true, shown: text })

  const recompute = (): void => {
    const next = computeFit(ref.current, text, boxW, boxH, minFontPx, maxFontPx, overflowStrategy)
    setFit(next)
    onFit?.(next.didFit, next.fontPx)
  }

  useLayoutEffect(() => {
    recompute()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, boxW, boxH, minFontPx, maxFontPx, fontFamily, overflowStrategy])

  useEffect(() => {
    // Re-fit once web fonts finish loading (first paint measures fallback metrics).
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
    if (!fonts || !fonts.ready) return
    let cancelled = false
    void fonts.ready.then(() => {
      if (!cancelled) recompute()
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, boxW, boxH, fontFamily])

  if (!text || fit.shown === '') return null

  const squeeze = !fit.didFit && overflowStrategy === 'squeeze'

  return (
    <text
      ref={ref}
      x={x}
      y={y}
      className={className}
      textAnchor={anchor}
      dominantBaseline={baseline}
      fill={fill}
      fontFamily={fontFamily}
      fontWeight={weight}
      fontSize={fit.fontPx}
      letterSpacing={letterSpacing}
      textLength={squeeze ? boxW : undefined}
      lengthAdjust={squeeze ? 'spacingAndGlyphs' : undefined}
      data-fit="1"
      data-didfit={fit.didFit ? '1' : '0'}
      data-fitpx={Math.round(fit.fontPx)}
      style={style}
    >
      {fit.shown}
    </text>
  )
}
