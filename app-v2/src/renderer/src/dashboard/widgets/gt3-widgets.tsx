// Live renderers for the semantic motorsport dashboard widgets.
// Public contract is unchanged: DashboardRoot passes { element, snapshot } and
// dispatches by DashboardElement.type through renderGt3Widget.

import { isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import type { DashboardElement, DashboardElementStyle, ResolvedTextSlot } from '../../../../shared/dashboards'
import { applyDecimals, resolveSlotStyle } from '../../../../shared/dashboards'
import type { DriverEntry, RadarCarEntry, RelativeCarEntry, TelemetrySnapshot, TyreInfo } from '../../../../shared/telemetry'
import type { TrackMapData } from '../../../../shared/track-map'
import { TRACK_MAP_CHANNELS } from '../../../../shared/track-map'
import { RADAR_THREAT_COLORS, radarSideThreat, radarThreatColor, radarThreatLevel } from '../../../../shared/radar'
import { formatMeasurement, type UnitSystem } from '../../../../shared/units'
import { getActiveFlag, resolveBinding } from '../binding'
import { MotorsportGlyph, type MotorsportIconId } from '../../icons/motorsport'
import {
  buildTrackMap,
  getStartFinishMarker,
  trackMapDotRadius,
  trackMapStrokeWidth
} from '../../lib/track-map'
import { TrackMapCanvas } from '../../components/TrackMapCanvas'
import { EXTRA_WIDGET_TYPES, renderExtraWidget } from './extra-widgets'
import { TELEMETRY_WIDGET_TYPES, renderTelemetryWidget } from './new-widgets-telemetry'
import { FUTURISTIC_WIDGET_TYPES, renderFuturisticWidget } from './new-widgets-futuristic'
import { MINIMAL_WIDGET_TYPES, renderMinimalWidget } from './new-widgets-minimal'
import { PREDICTION_WIDGET_TYPES, renderPredictionWidget } from './new-widgets-predictions'
import { COACH_HEATMAP_WIDGET_TYPES, renderCoachHeatmapWidget } from './coach-heatmap-widget'
import { COACH_ENGINEER_WIDGET_TYPES, renderCoachEngineerWidget } from './coach-engineer-widgets'
import {
  BRUSHED_METAL_BACKGROUND,
  CORNER_LABEL,
  CORNER_ORDER,
  FONT_CONDENSED,
  FONT_MONO,
  FONT_TECH,
  GT3,
  GT3_RECESSED_BACKGROUND,
  brakeCorner,
  brakeTempColor,
  gearFont,
  panelChrome,
  pressureColor,
  readoutFont,
  rpmRampColor,
  tyreCorner,
  tyreTempColor,
  wearColor,
  type CornerKey
} from './gt3-theme'
import {
  AnalogDial,
  RevLedBar,
  SegmentReadout,
  BarGraph,
  DataField,
  type InstrumentColors,
  type LedShape,
  type BezelKind,
  type MaterialKind
} from '../../instruments'
import { resolveElementSkin, FitText, makeGrid, zoneColor } from '../../skins'
import type { SkinToken, Rect } from '../../skins'

export interface WidgetProps {
  element: DashboardElement
  snapshot: TelemetrySnapshot | null
  unitSystem?: UnitSystem
}

// ── Instrument-primitive bridge ───────────────────────────────────────────────
// The high-fidelity SVG instruments (renderer/src/instruments) are driven from the
// SAME flat DashboardElementStyle the legacy renderers use, PLUS the additive
// `style.instrument` fidelity sub-spec. These helpers translate a widget's existing
// colours / thresholds / material knobs into instrument props so a user's per-
// element edits (fillColor / warnColor / dangerColor / accentColor / instrument.*)
// keep driving the modelled LEDs, dials and segment readouts. Pure + side-effect
// free; absent knobs fall back to each primitive's own default.

// Map the user-editable colour fields onto the instrument colour-token overrides.
// Only explicitly-set fields are forwarded so the primitive defaults (GT3 ramp)
// stay intact otherwise.
export function instrumentColorsFor(s: DashboardElementStyle): Partial<InstrumentColors> {
  const o: Partial<InstrumentColors> = {}
  if (s.fillColor) o.good = resolveCssColor(s.fillColor)
  if (s.warnColor) o.warn = resolveCssColor(s.warnColor)
  if (s.dangerColor) o.danger = resolveCssColor(s.dangerColor)
  if (s.accentColor) o.accent = resolveCssColor(s.accentColor)
  if (s.flashColor) o.flash = resolveCssColor(s.flashColor)
  if (s.color) o.text = resolveCssColor(s.color)
  return o
}

export function instrumentBezel(s: DashboardElementStyle, fallback: BezelKind = 'chrome'): BezelKind {
  return s.instrument?.bezel ?? fallback
}

export function instrumentMaterial(s: DashboardElementStyle, fallback: MaterialKind = 'matte'): MaterialKind {
  return s.instrument?.material ?? fallback
}

// Glow is reserved for LEDs / alerts. Honour the master toggle (instrument.glow),
// then the legacy `glow`, defaulting ON for LED instruments.
export function instrumentGlow(s: DashboardElementStyle, fallback = true): boolean {
  return s.instrument?.glow ?? s.glow ?? fallback
}

// Shared RevLedBar prop builder for the shift-light family (ShiftBar + the generic
// ElementShiftLights primitive). Reads legacy fields and the instrument.parts.led
// fine knobs; a pit-limiter override recolours the lit LEDs to the pit blue.
export function revLedPropsFor(
  s: DashboardElementStyle,
  shiftPct: number,
  opts: { width: number; height: number; blink?: boolean; pit?: boolean }
): {
  pct: number
  segments: number
  shape: LedShape
  width: number
  height: number
  gap: number
  warnAt: number
  dangerAt: number
  flashAt: number
  flashOn: boolean
  glow: boolean
  bloom?: number
  colors?: Partial<InstrumentColors>
} {
  const led = s.instrument?.parts?.led
  const segments = Math.max(4, Math.min(32, led?.segments ?? s.segments ?? 12))
  const shape = (led?.shape ?? s.segmentShape ?? 'led') as LedShape
  const flashAt = led?.flashAt ?? s.flashAt ?? 0.97
  const blink = Boolean(opts.blink) || shiftPct >= flashAt
  const gap = Math.max(2, Math.round(opts.width / segments / 8))
  const colors = instrumentColorsFor(s)
  if (opts.pit) {
    // Pit limiter: drive every lit LED to the pit blue (legacy alternating pulse).
    colors.good = GT3.pitBlue
    colors.warn = GT3.pitBlue
    colors.danger = GT3.pitBlue
  }
  return {
    pct: shiftPct,
    segments,
    shape,
    width: opts.width,
    height: opts.height,
    gap,
    warnAt: led?.warnAt ?? s.warnAt ?? 0.6,
    dangerAt: led?.dangerAt ?? s.dangerAt ?? 0.85,
    flashAt,
    flashOn: blink,
    glow: instrumentGlow(s),
    bloom: led?.bloom,
    colors: Object.keys(colors).length ? colors : undefined
  }
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(1, Math.max(0, v))
}

// theme.css :root defaults for the accent custom properties. Used as the concrete
// fallback when the CSS variable is undefined at resolve time (the visual-audit
// harness + SSR/vitest never load theme.css, so `var(--accent-*)` has no value).
const ACCENT_TOKEN_DEFAULTS: Record<string, string> = {
  '--accent-primary': '#E86920',
  '--accent-primary-bright': '#F07830',
  '--accent-primary-dim': '#B5501A',
  '--accent-warning': '#D4890A',
  '--accent-danger': '#C41A1A',
  '--accent-success': '#1A8A3A'
}

// Catalog accent/colour fields are authored as CSS custom properties (e.g.
// 'var(--accent-warning)') so widgets follow the active theme. But SVG <paint>
// PRESENTATION ATTRIBUTES (`fill="…"`, `stroke="…"`) do NOT resolve var() — so a
// var() colour handed to FitText / <rect> / GlyphIcon paints BLACK, i.e. an
// invisible value on the black widget face (the v2.39 curated-metric regression).
// Resolve any `var(--token[, fallback])` to a concrete colour BEFORE it reaches
// the SVG layer: prefer the live themed value (real app, when the property is
// defined on :root), then an inline fallback, then the theme.css default map, then
// the caller's fallback. Concrete colours pass straight through untouched.
function resolveCssColor(color: string | undefined, fallback: string = GT3.cyan): string {
  if (typeof color !== 'string') return fallback
  const trimmed = color.trim()
  if (!trimmed.startsWith('var(')) return color
  const m = /^var\(\s*(--[A-Za-z0-9-]+)\s*(?:,\s*([^)]+))?\)$/.exec(trimmed)
  if (!m) return fallback
  const token = m[1]
  const inlineFallback = m[2]?.trim()
  if (typeof document !== 'undefined' && typeof getComputedStyle === 'function') {
    try {
      const live = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
      if (live && !live.startsWith('var(')) return live
    } catch {
      // no DOM (SSR) — fall through to the static resolution below
    }
  }
  if (inlineFallback && !inlineFallback.startsWith('var(')) return inlineFallback
  return ACCENT_TOKEN_DEFAULTS[token] ?? fallback
}

function pct(binding: string, snapshot: TelemetrySnapshot | null): number {
  const r = resolveBinding(binding, snapshot)
  return clamp01(r.pct ?? r.numeric ?? 0)
}

function Shell({ element, children, chrome, padding = 0, className }: {
  element: DashboardElement
  children: ReactNode
  chrome?: CSSProperties
  padding?: number
  className?: string
}): ReactElement {
  // Border configurável por widget: quando o chrome já desenha uma borda (widget
  // "boxed"), honramos a cor (style.border) e a espessura (style.borderWidth) do
  // elemento. Widgets borderless/plain (chrome.border === 'none') ficam intactos,
  // garantindo retro-compatibilidade (presets usam panelStroke == '#1F1F1F').
  const st = element.style
  const drawsBorder = Boolean(chrome && chrome.border && chrome.border !== 'none')
  const borderOverride = drawsBorder
    ? `${st.borderWidth ?? 1}px solid ${st.border ?? GT3.panelStroke}`
    : undefined
  const style: CSSProperties = {
    left: element.x,
    top: element.y,
    width: element.w,
    height: element.h,
    padding,
    fontFamily: FONT_TECH,
    color: element.style.color ?? GT3.textPrimary,
    ...chrome,
    ...(borderOverride ? { border: borderOverride } : {}),
    ...(st.opacity !== undefined ? { opacity: st.opacity } : {})
  }
  return (
    <div className={`dash-element gt3-widget ${className ?? ''}`} style={style}>
      {children}
    </div>
  )
}

// ── v2.39 SVG composition contract ────────────────────────────────────────────
// Every rebuilt widget renders ONE root <svg viewBox="0 0 W H"> that maps 1:1 to
// the element box (W=element.w, H=element.h). Because the viewBox equals the pixel
// box and preserveAspectRatio keeps it centred+meet, nothing can escape the tile
// (structural overflow=0) and every value/label is drawn with FitText/DataField/
// BarGraph so text never renders below its legibility floor (tiny_text≈0).
function SvgRoot({ element, skin, panel = 'auto', className, children }: {
  element: DashboardElement
  skin: SkinToken
  panel?: 'auto' | 'none' | 'panel'
  className?: string
  children: ReactNode
}): ReactElement {
  const st = element.style
  const W = Math.max(1, Math.round(element.w))
  const H = Math.max(1, Math.round(element.h))
  const plain = panel === 'none' || st.borderWidth === 0 || st.background === 'transparent'
  const drawPanel = panel === 'panel' || (panel === 'auto' && !plain)
  const bg = st.background && st.background !== 'transparent' ? st.background : skin.material.base
  const bw = drawPanel ? (st.borderWidth ?? skin.material.borderWidth ?? 1) : 0
  const border = st.border ?? skin.material.border
  const radius = st.radius ?? skin.material.radius ?? 2
  const divStyle: CSSProperties = { left: element.x, top: element.y, width: element.w, height: element.h }
  if (st.opacity !== undefined) divStyle.opacity = st.opacity
  return (
    <div className={`dash-element gt3-widget ${className ?? ''}`} style={divStyle}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
        {drawPanel && (
          <rect
            x={bw / 2}
            y={bw / 2}
            width={Math.max(0, W - bw)}
            height={Math.max(0, H - bw)}
            rx={radius}
            ry={radius}
            fill={bg}
            stroke={bw > 0 ? border : 'none'}
            strokeWidth={bw}
          />
        )}
        {children}
      </svg>
    </div>
  )
}

// Positions a self-sizing instrument primitive (RevLedBar / AnalogDial / …) at an
// exact rect inside the root svg via a nested <svg> viewport.
function Slot({ x, y, w, h, children }: { x: number; y: number; w: number; h: number; children: ReactNode }): ReactElement {
  return (
    <svg x={x} y={y} width={Math.max(0, w)} height={Math.max(0, h)} style={{ overflow: 'visible' }}>
      {children}
    </svg>
  )
}

// A labelled readout cell: small label on top, big auto-fit value beneath (with an
// optional unit rendered as its OWN FitText so it never becomes sub-legible micro
// text). All text is SVG, so it can never clip or overflow its rect.
function StatCell({
  rect,
  label,
  value,
  unit,
  valueColor,
  labelColor,
  unitColor,
  skin,
  valueFont = FONT_MONO,
  labelFont = FONT_CONDENSED,
  labelFrac = 0.3,
  valueMaxPx,
  unitMaxPx,
  unitFrac,
  minPx = 11
}: {
  rect: Rect
  label?: string
  value: string
  unit?: string
  valueColor: string
  labelColor?: string
  unitColor?: string
  skin: SkinToken
  valueFont?: string
  labelFont?: string
  labelFrac?: number
  valueMaxPx?: number
  unitMaxPx?: number
  unitFrac?: number
  minPx?: number
}): ReactElement {
  const { x, y, w, h } = rect
  const hasLabel = Boolean(label && label.length)
  const labelH = hasLabel ? Math.max(minPx + 2, Math.min(h * labelFrac, h * 0.5)) : 0
  const valY = y + labelH
  const valH = Math.max(1, h - labelH)
  const cx = x + w / 2
  const hasUnit = Boolean(unit && unit.length)
  const resolvedUnitFrac = unitFrac ?? (hasUnit && (unit as string).length >= 6 ? 0.52 : 0.34)
  const vBoxW = hasUnit ? w * (1 - resolvedUnitFrac) : w
  const uBoxW = hasUnit ? w - vBoxW : 0
  const vMax = Math.max(minPx, valueMaxPx !== undefined ? Math.min(valueMaxPx, valH) : valH * 0.8)
  return (
    <>
      {hasLabel && (
        <FitText
          x={cx}
          y={y + labelH / 2}
          boxW={w}
          boxH={labelH}
          text={label as string}
          fontFamily={labelFont}
          fill={labelColor ?? skin.palette.textDim}
          minFontPx={minPx}
          maxFontPx={Math.max(minPx, labelH)}
          anchor="middle"
          baseline="central"
        />
      )}
      <FitText
        x={hasUnit ? x + vBoxW / 2 : cx}
        y={valY + valH / 2}
        boxW={vBoxW}
        boxH={valH}
        text={value}
        fontFamily={valueFont}
        fill={valueColor}
        minFontPx={minPx}
        maxFontPx={vMax}
        anchor="middle"
        baseline="central"
      />
      {hasUnit && (
        <FitText
          x={x + vBoxW + 2}
          y={valY + valH / 2}
          boxW={Math.max(1, uBoxW - 2)}
          boxH={valH * 0.6}
          text={unit as string}
          fontFamily={labelFont}
          fill={unitColor ?? labelColor ?? skin.palette.textDim}
          minFontPx={minPx}
          maxFontPx={Math.max(minPx, Math.min(unitMaxPx ?? valH * 0.5, valH * 0.5))}
          anchor="start"
          baseline="central"
        />
      )}
    </>
  )
}

// Converte um slot resolvido em CSSProperties (sem fontSize — usado como maxSize
// pelo auto-fit). Vazio quando o slot no tem overrides relevantes.
function slotCss(ov: ResolvedTextSlot): CSSProperties {
  const out: CSSProperties = {}
  if (ov.fontFamily !== undefined) out.fontFamily = ov.fontFamily
  if (ov.color !== undefined) out.color = ov.color
  if (ov.fontWeight !== undefined) out.fontWeight = ov.fontWeight
  if (ov.align !== undefined) out.textAlign = ov.align
  if (ov.letterSpacing !== undefined) out.letterSpacing = ov.letterSpacing
  if (ov.textTransform !== undefined) out.textTransform = ov.textTransform
  if (ov.textShadow !== undefined) out.textShadow = ov.textShadow
  return out
}

function Label({ children, color = GT3.textMuted, size = 10, align = 'left', element, slot = 'label' }: {
  children: ReactNode
  color?: string
  size?: number
  align?: 'left' | 'center' | 'right'
  element?: DashboardElement
  slot?: string
}): ReactElement {
  const ov = resolveSlotStyle(element?.style, slot, { color, fontSize: size, align })
  return (
    <span
      className="gt3-label"
      style={{
        color: ov.color ?? color,
        fontSize: ov.fontSize ?? size,
        textAlign: ov.align ?? align,
        fontFamily: ov.fontFamily,
        fontWeight: ov.fontWeight,
        letterSpacing: ov.letterSpacing,
        textTransform: ov.textTransform,
        textShadow: ov.textShadow
      }}
    >
      {children}
    </span>
  )
}

function Value({ children, color = GT3.textPrimary, size = 24, mono = true, element, slot = 'value', fill = false }: {
  children: ReactNode
  color?: string
  size?: number
  mono?: boolean
  element?: DashboardElement
  slot?: string
  fill?: boolean
}): ReactElement {
  const ov = resolveSlotStyle(element?.style, slot, { color, fontSize: size })
  const baseFamily = mono ? FONT_MONO : FONT_CONDENSED
  // Default behaviour is to GROW the primary value to fill its tile. An explicit
  // authored slot fontSize is treated as a hard cap (no growth beyond it); an
  // authored maxFontSize bounds the fill ceiling, else GROW_CAP.
  const doFill = fill && !isExplicitSlotSize(element?.style, slot)
  const authoredMax = element?.style?.maxFontSize
  const fillCap = typeof authoredMax === 'number' && Number.isFinite(authoredMax) ? authoredMax : GROW_CAP
  return (
    <AutoFitText
      className="gt3-value"
      maxSize={doFill ? fillCap : (ov.fontSize ?? size)}
      minSize={12}
      fill={doFill}
      style={{ ...slotCss(ov), color: ov.color ?? color, fontFamily: ov.fontFamily ?? baseFamily }}
    >
      {children}
    </AutoFitText>
  )
}

// SVG <text> que honra um slot de fonte (família/tamanho/cor/peso/espaçamento/
// transform/sombra). Espelha o `SvgText` de extra-widgets: `size`/`family`/`fill`
// são os defaults do widget (no espaço do viewBox em SVG) e o slot os sobrepõe.
// Mantém retro-compatibilidade: sem override no slot, renderiza idêntico ao texto
// hard-coded que substitui.
function SvgSlotText({ element, slot, x, y, anchor = 'middle', family, size, fill, fontWeight, baseStyle, fitWidth, children }: {
  element: DashboardElement
  slot: string
  x: number | string
  y: number | string
  anchor?: 'start' | 'middle' | 'end'
  family: string
  size: number
  fill: string
  fontWeight?: number | string
  baseStyle?: CSSProperties
  // Available width (in the SVG's user/viewBox units) the text must fit inside.
  // When provided the glyphs are measured and scaled down to fit (clip via the
  // tile's overflow:hidden is only the last resort if scaling bottoms out).
  fitWidth?: number
  children: ReactNode
}): ReactElement {
  const ov = resolveSlotStyle(element.style, slot, { fontFamily: family, fontSize: size, color: fill, fontWeight })
  const baseSize = ov.fontSize ?? size
  const ref = useRef<SVGTextElement | null>(null)
  const [scale, setScale] = useState(1)
  const key = textContentKey(children)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node || !fitWidth || fitWidth <= 0) {
      setScale(1)
      return
    }
    let len = 0
    try {
      len = typeof node.getComputedTextLength === 'function' ? node.getComputedTextLength() : 0
    } catch {
      len = 0
    }
    if (len > fitWidth) setScale(Math.max(0.4, fitWidth / len))
    else setScale(1)
  }, [key, baseSize, fitWidth])
  const effSize = scale >= 0.999 ? baseSize : Math.max(1, Math.round(baseSize * scale * 100) / 100)
  const style: CSSProperties = { ...baseStyle }
  if (ov.letterSpacing !== undefined) style.letterSpacing = ov.letterSpacing
  if (ov.textTransform !== undefined) style.textTransform = ov.textTransform
  if (ov.textShadow !== undefined) style.textShadow = ov.textShadow
  return (
    <text ref={ref} x={x} y={y} textAnchor={anchor} fontFamily={ov.fontFamily ?? family} fontSize={effSize} fontWeight={ov.fontWeight ?? fontWeight} fill={ov.color ?? fill} style={style}>
      {children}
    </text>
  )
}

function textContentKey(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textContentKey).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return textContentKey(node.props.children)
  return ''
}

// Upper bound for fill growth. Generous enough for a hero gear numeral on a large
// DDU tile, but bounded so the binary search and first paint stay cheap.
const GROW_CAP = 520

// True when an authored slot explicitly pins a fontSize — that becomes a hard cap
// and disables the default "grow to fill" behaviour for that text.
function isExplicitSlotSize(style: DashboardElementStyle | undefined, slot: string): boolean {
  const sz = style?.slots?.[slot]?.fontSize
  return typeof sz === 'number' && Number.isFinite(sz)
}

// Resolve fill/maxSize for a hero AutoFitText call-site. When the slot pins an
// explicit fontSize, honour it as a hard cap (no growth, preserves authored intent
// + snapshot tests). Otherwise GROW to fill the tile, bounded by the authored
// `maxFontSize` cap when present (so existing presets keep their intended ceiling)
// or GROW_CAP as a generous default.
function fillProps(style: DashboardElementStyle | undefined, slot: string, explicitCap: number): { fill: boolean; maxSize: number } {
  if (isExplicitSlotSize(style, slot)) return { fill: false, maxSize: explicitCap }
  const authored = style?.maxFontSize
  return { fill: true, maxSize: typeof authored === 'number' && Number.isFinite(authored) ? authored : GROW_CAP }
}

// Measure the real space a value may occupy inside its tile. The immediate parent
// is often shrink-to-fit (its height follows the text), so a naive clientHeight
// would let the font run away. We probe small vs large font to find the nearest
// HEIGHT-bounded ancestor, then subtract sibling/label boxes that share the column
// so growing the value never overlaps them. Width comes from the bounded parent
// minus any row-siblings. Leaves `el` at `minSize` for the caller's search.
function measureAvail(el: HTMLElement, minSize: number): { availW: number; availH: number } {
  const tileRoot = el.closest('.dash-element') as HTMLElement | null
  const chain: HTMLElement[] = []
  let node: HTMLElement | null = el.parentElement
  while (node) {
    chain.push(node)
    if (node === tileRoot) break
    node = node.parentElement
  }
  if (chain.length === 0) {
    return { availW: Math.max(1, el.clientWidth), availH: Math.max(1, el.clientHeight) }
  }

  // Probe: which ancestors track the text height (shrink-to-fit) vs are bounded?
  el.style.fontSize = `${minSize}px`
  const small = chain.map((a) => a.clientHeight)
  el.style.fontSize = `${Math.max(minSize * 5, minSize + 48)}px`
  const large = chain.map((a) => a.clientHeight)
  el.style.fontSize = `${minSize}px`

  const threshold = Math.max(2, minSize * 0.5)
  let boundedIdx = chain.length - 1
  for (let i = 0; i < chain.length; i += 1) {
    if (large[i] - small[i] <= threshold) {
      boundedIdx = i
      break
    }
  }
  const anchor = chain[boundedIdx]
  const onPath = boundedIdx === 0 ? el : chain[boundedIdx - 1]
  const csA = typeof getComputedStyle === 'function' ? getComputedStyle(anchor) : null
  const colDir = !(csA && csA.display.includes('flex') && csA.flexDirection.startsWith('row'))
  let offH = 0
  for (const child of Array.from(anchor.children)) {
    if (child === onPath) continue
    if (colDir) offH += (child as HTMLElement).getBoundingClientRect().height
  }
  const padV = csA ? (parseFloat(csA.paddingTop) || 0) + (parseFloat(csA.paddingBottom) || 0) : 0
  const gapV = csA && colDir ? (parseFloat(csA.rowGap) || parseFloat(csA.gap) || 0) * Math.max(0, anchor.children.length - 1) : 0
  const availH = Math.max(1, anchor.clientHeight - offH - padV - gapV - 2)

  const box = el.parentElement as HTMLElement
  const csB = typeof getComputedStyle === 'function' ? getComputedStyle(box) : null
  const rowDir = !!csB && csB.display.includes('flex') && csB.flexDirection.startsWith('row')
  let offW = 0
  for (const child of Array.from(box.children)) {
    if (child === el) continue
    if (rowDir) offW += (child as HTMLElement).getBoundingClientRect().width
  }
  const padH = csB ? (parseFloat(csB.paddingLeft) || 0) + (parseFloat(csB.paddingRight) || 0) : 0
  const availW = Math.max(1, box.clientWidth - offW - padH - 2)
  return { availW, availH }
}

function AutoFitText({ children, className, maxSize, minSize = 10, style, textKey, fill = false }: {
  children: ReactNode
  className?: string
  maxSize: number
  minSize?: number
  style?: CSSProperties
  textKey?: string
  fill?: boolean
}): ReactElement {
  const ref = useRef<HTMLSpanElement | null>(null)
  const frameRef = useRef(0)
  const key = textKey ?? textContentKey(children)

  const fit = useCallback((): void => {
    const el = ref.current
    const box = el?.parentElement
    if (!el || !box) return

    window.cancelAnimationFrame(frameRef.current)
    frameRef.current = window.requestAnimationFrame(() => {
      el.style.letterSpacing = typeof style?.letterSpacing === 'string' ? style.letterSpacing : ''
      el.style.transform = ''

      const { availW, availH } = measureAvail(el, minSize)

      // Upper bound: for fill, grow up to the cap (and a sane multiple of the
      // available height); otherwise honour the authored cap. The binary search
      // finds the largest size that fits BOTH width and height.
      const hardMax = fill
        ? Math.max(minSize, Math.min(maxSize, GROW_CAP, Math.ceil(availH * 1.3)))
        : Math.max(minSize, maxSize)

      const fits = (px: number): boolean => {
        el.style.fontSize = `${px}px`
        return el.scrollWidth <= availW && el.scrollHeight <= availH
      }

      let lo = minSize
      let hi = hardMax
      let best = minSize
      for (let i = 0; i < 16 && lo <= hi; i += 1) {
        const mid = Math.floor((lo + hi) / 2)
        if (mid <= 0) break
        if (fits(mid)) {
          best = mid
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
      el.style.fontSize = `${best}px`

      // Last-resort legibility guards when even minSize overflows the width.
      if (el.scrollWidth > availW && best <= minSize) {
        const squeeze = Math.max(-0.1, (availW / Math.max(1, el.scrollWidth) - 1) * 0.28)
        el.style.letterSpacing = `${squeeze.toFixed(3)}em`
      }
      const finalScale = Math.min(1, availW / Math.max(1, el.scrollWidth), availH / Math.max(1, el.scrollHeight))
      if (finalScale < 0.995) {
        const origin = style?.textAlign === 'right' ? 'right center' : style?.textAlign === 'left' ? 'left center' : 'center center'
        el.style.transformOrigin = origin
        el.style.transform = `scale(${Math.max(0.6, finalScale * 0.99)})`
      }
    })
  }, [maxSize, minSize, fill, style?.fontFamily, style?.fontWeight, style?.letterSpacing, style?.textAlign])

  useLayoutEffect(() => {
    const box = ref.current?.parentElement
    if (!box) return

    fit()
    const ResizeObserverCtor = typeof ResizeObserver !== 'undefined' ? ResizeObserver : undefined
    const observer = ResizeObserverCtor ? new ResizeObserver(fit) : undefined
    observer?.observe(box)
    window.addEventListener('resize', fit)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', fit)
      window.cancelAnimationFrame(frameRef.current)
    }
  }, [fit])

  useLayoutEffect(() => {
    fit()
  }, [key, fit])

  return (
    <span
      ref={ref}
      className={className}
      style={{
        ...style,
        // Tabular figures keep every digit the same width, so a changing readout
        // (e.g. 111 → 888) doesn't re-trigger a different fit scale and visibly
        // jitter frame-to-frame.
        fontVariantNumeric: 'tabular-nums',
        display: 'inline-flex',
        alignItems: 'baseline',
        maxWidth: '100%',
        maxHeight: '100%',
        minWidth: 0,
        whiteSpace: 'nowrap',
        lineHeight: 1,
        overflow: 'visible',
        // Start small in fill mode so the first paint (before the fit RAF runs)
        // grows up to size instead of flashing an oversized glyph.
        fontSize: fill ? minSize : maxSize
      }}
    >
      {children}
    </span>
  )
}

function fmtDelta(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '±0.000'
  const sign = v > 0 ? '+' : v < 0 ? '−' : '±'
  return `${sign}${Math.abs(v).toFixed(3)}`
}

function fmtTime(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—:--.---'
  const minutes = Math.floor(Math.abs(seconds) / 60)
  const rest = Math.abs(seconds) - minutes * 60
  return `${minutes}:${rest.toFixed(3).padStart(6, '0')}`
}

function fitFont(element: DashboardElement, text: string, ratio = 0.5, min = 12, max?: number): number {
  const explicitMax = max ?? element.style.maxFontSize
  const hFit = element.h * ratio
  const wFit = (element.w * 1.78) / Math.max(2, text.length)
  return Math.round(Math.max(element.style.minFontSize ?? min, Math.min(explicitMax ?? 96, hFit, wFit)))
}

function fmtBool(on: boolean | undefined, onText = 'ON', offText = 'OFF'): string {
  return on ? onText : offText
}

function fmtPctValue(value: number | undefined, decimals = 0): string {
  return value !== undefined && Number.isFinite(value) ? `${value.toFixed(decimals)}%` : '—'
}

function styleVar(name: string, value: string): CSSProperties {
  return { [name]: value } as CSSProperties
}

// ── Automotive iconography ──────────────────────────────────────────────────
// Compact line glyphs that replace word labels. Each case returns SVG children
// drawn on a 64×64 grid so they share stroke weights and align optically.
type GlyphKind =
  | 'speed' | 'rpm' | 'gear' | 'fuel' | 'lap' | 'delta' | 'position' | 'flag'
  | 'abs' | 'tc' | 'map' | 'bb' | 'pit' | 'inc' | 'pedal' | 'drs'
  | 'tyre' | 'brake' | 'temp' | 'oil' | 'water' | 'weather' | 'radar'
  | 'relatives' | 'steering' | 'inputs'

// Glyph kinds that duplicate a canonical motorsport registry icon are rendered
// straight from the shared icon set (single source of truth) so warning lights
// and flags read identically across dashboards + overlays. The inline artwork
// below is reserved for pure gauge geometry that has no registry equivalent.
const GLYPH_TO_MOTORSPORT: Partial<Record<GlyphKind, MotorsportIconId>> = {
  fuel: 'fuel',
  abs: 'abs',
  tc: 'tc',
  bb: 'brake-bias',
  pit: 'pit-limiter',
  drs: 'drs',
  tyre: 'tyre',
  brake: 'brake',
  temp: 'temp',
  oil: 'oil-temp',
  water: 'water-temp',
  weather: 'rain'
}

// Inline gauge geometry for kinds with NO registry equivalent (speedo arc, gear
// shifter, lap timer, delta arrows, podium, generic flag, engine-map grid,
// incident triangle, pedal stack, proximity radar, relatives, steering wheel).
// Registry-backed kinds (see GLYPH_TO_MOTORSPORT) are drawn via MotorsportGlyph
// in GlyphIcon and are intentionally omitted here.
function glyphChildren(kind: GlyphKind, color: string): ReactNode {
  switch (kind) {
    case 'speed':
    case 'rpm':
      return <><path d="M9 45a23 23 0 0 1 46 0" /><path d="M32 45l14-13" /><circle cx="32" cy="45" r="3.4" fill={color} stroke="none" /></>
    case 'gear':
      return <><circle cx="32" cy="13" r="6" fill={color} stroke="none" /><path d="M32 19v26" /><path d="M17 30h30M17 30v15M32 30v15M47 30v15" /></>
    case 'lap':
      return <><circle cx="32" cy="36" r="18" /><path d="M32 36V25" /><path d="M26 8h12M32 8v6" /></>
    case 'delta':
      return <><path d="M32 12l13 18H19z" fill={color} stroke="none" opacity=".55" /><path d="M32 52l-13-18h26z" /></>
    case 'position':
      return <><path d="M20 12h24v8a12 12 0 0 1-24 0z" /><path d="M28 32h8l-1 10h-6z" /><path d="M22 52h20" /><path d="M20 16h-6a6 6 0 0 0 6 8M44 16h6a6 6 0 0 1-6 8" /></>
    case 'flag':
      return <><path d="M18 54V12" /><path d="M18 15c11-7 17 6 29 0v22c-12 6-18-7-29 0" fill={color} stroke="none" opacity=".5" /><path d="M18 15c11-7 17 6 29 0v22c-12 6-18-7-29 0" /></>
    case 'map':
      return <><rect x="20" y="20" width="24" height="24" rx="3" /><path d="M26 14v6M32 14v6M38 14v6M26 44v6M32 44v6M38 44v6M14 26h6M14 32h6M14 38h6M44 26h6M44 32h6M44 38h6" /></>
    case 'inc':
      return <><path d="M32 12l23 40H9z" /><path d="M32 27v12" /><circle cx="32" cy="45" r="1.6" fill={color} stroke="none" /></>
    case 'pedal':
    case 'inputs':
      return <><rect x="20" y="12" width="24" height="40" rx="8" /><path d="M27 22h10M27 32h10M27 42h10" /></>
    case 'radar':
      return <><circle cx="32" cy="32" r="22" /><circle cx="32" cy="32" r="12" /><path d="M32 10v44M10 32h44" /><circle cx="32" cy="32" r="3.4" fill={color} stroke="none" /></>
    case 'relatives':
      return <><rect x="14" y="10" width="16" height="20" rx="3" /><rect x="34" y="34" width="16" height="20" rx="3" fill={color} stroke="none" opacity=".4" /><rect x="34" y="34" width="16" height="20" rx="3" /></>
    case 'steering':
      return <><circle cx="32" cy="32" r="21" /><circle cx="32" cy="32" r="5" fill={color} stroke="none" /><path d="M13 32h14M37 32h14M32 37v14" /></>
    default:
      return null
  }
}

function GlyphIcon({ kind, color, size }: { kind: GlyphKind; color: string; size: number }): ReactElement {
  // Registry-backed kinds defer to the shared motorsport icon set so flags and
  // warning lights stay consistent everywhere. `color` drives `currentColor`
  // (preserving the caller's hue/active logic); `size` keeps the same footprint.
  const registryId = GLYPH_TO_MOTORSPORT[kind]
  if (registryId) {
    return <MotorsportGlyph id={registryId} width={size} height={size} style={{ display: 'block', flex: '0 0 auto', color }} />
  }
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" style={{ display: 'block', flex: '0 0 auto' }}>
      <g fill="none" stroke={color} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
        {glyphChildren(kind, color)}
      </g>
    </svg>
  )
}

// Slim widget header: an accent glyph on the left, an optional compact meta on
// the right (truncated). Replaces the old "TITLE ........ DESCRIPTION" pattern.
function WidgetHeader({ kind, color: colorRaw, meta, metaColor, element, ratio = 0.16, max = 22 }: {
  kind: GlyphKind
  color: string
  meta?: ReactNode
  metaColor?: string
  element: DashboardElement
  ratio?: number
  max?: number
}): ReactElement {
  const size = Math.round(Math.max(13, Math.min(max, element.h * ratio)))
  const color = resolveCssColor(colorRaw)
  const showIcon = element.style.showIcon !== false
  const hasMeta = meta !== undefined && meta !== ''
  if (!showIcon && !hasMeta) return <></>
  const ov = resolveSlotStyle(element.style, 'header', {
    color: metaColor ?? GT3.textMuted,
    fontSize: Math.round(Math.max(11, Math.min(14, element.h * 0.1)))
  })
  return (
    <div className="gt3-module-header">
      {showIcon && <span className="gt3-head-icon" style={{ color }}><GlyphIcon kind={kind} color={color} size={size} /></span>}
      {hasMeta && (
        <span className="gt3-head-meta" style={{ ...slotCss(ov), color: ov.color ?? (metaColor ?? GT3.textMuted), fontSize: ov.fontSize }}>{meta}</span>
      )}
    </div>
  )
}

function useTrackMapData(): TrackMapData | null {
  const [data, setData] = useState<TrackMapData | null>(null)
  useEffect(() => {
    const ipc = typeof window !== 'undefined' ? (window as unknown as { ipc?: { invoke<T>(channel: string): Promise<T>; subscribe<T>(channel: string, cb: (payload: T) => void): () => void } }).ipc : undefined
    if (!ipc) return
    let canceled = false
    void ipc.invoke<TrackMapData | null>(TRACK_MAP_CHANNELS.getForCurrentTrack).then((next) => {
      if (!canceled) setData(next ?? null)
    }).catch(() => undefined)
    const off = ipc.subscribe<TrackMapData | null>(TRACK_MAP_CHANNELS.updated, (next) => setData(next ?? null))
    return () => {
      canceled = true
      off()
    }
  }, [])
  return data
}

export function ShiftBar({ element, snapshot }: WidgetProps): ReactElement {
  const s = element.style
  // shiftPct resolves to the provider's per-car shift-light band (binding.ts),
  // so segments fill across the real band — never proportionally to RPM.
  const shift = pct(element.binding ?? 'shiftPct', snapshot)
  const flashAt = s.instrument?.parts?.led?.flashAt ?? s.flashAt ?? 0.975
  const flashing = Boolean(snapshot?.revLights?.blink) || shift >= flashAt
  const pit = s.pitLimiterOverride !== false && Boolean(snapshot?.pitLimiter)
  const shape = (s.instrument?.parts?.led?.shape ?? s.segmentShape ?? 'led') as LedShape
  const pad = Math.max(4, element.h * 0.12)
  // Reserve a slim row for the 0..7 rev scale, the rest is the modelled LED rail.
  const scaleH = Math.max(8, Math.round(element.h * 0.16))
  const railW = Math.max(8, element.w - pad * 2)
  const railH = Math.max(8, element.h - pad * 2 - scaleH)
  const ledProps = revLedPropsFor(s, shift, { width: railW, height: railH, blink: flashing, pit })

  return (
    <Shell element={element} chrome={panelChrome(s, { radius: s.radius ?? 10, glow: flashing ? GT3.whiteFlash : undefined })} padding={pad} className={`gt3-shiftbar gt3-shape-${shape}${flashing ? ' gt3-shiftbar-flashing' : ''}`}>
      <div className="gt3-rev-scale" style={{ height: scaleH }}>
        {Array.from({ length: 8 }, (_, i) => <span key={i}>{i}</span>)}
      </div>
      <div className="gt3-led-rail-instrument" style={{ width: railW, height: railH }}>
        <RevLedBar {...ledProps} />
      </div>
    </Shell>
  )
}

export function GearCluster({ element, snapshot, unitSystem = 'metric' }: WidgetProps): ReactElement {
  const s = element.style
  const skin = resolveElementSkin(s)
  const W = Math.max(1, Math.round(element.w))
  const H = Math.max(1, Math.round(element.h))
  const shift = pct('shiftPct', snapshot)
  const gear = resolveBinding('gearLabel', snapshot).text || '—'
  const speedReading = formatMeasurement(snapshot?.speedKmh, 'speed-kmh', unitSystem, { decimals: 0 })
  const speed = speedReading.display
  const rpm = resolveBinding('rpm', snapshot).text
  const rpmNumeric = resolveBinding('rpm', snapshot).numeric ?? 0
  const maxRpm = resolveBinding('maxRpm', snapshot).numeric ?? 8000
  const flash = shift >= (s.flashAt ?? 0.95)
  const gearColor = resolveSlotStyle(s, 'gear', { color: flash ? GT3.whiteFlash : skin.palette.text }).color ?? (flash ? GT3.whiteFlash : skin.palette.text)
  const speedColor = resolveSlotStyle(s, 'speed', { color: skin.palette.text }).color ?? skin.palette.text
  const speedUnit = speedReading.unit.toUpperCase()
  const pad = Math.max(4, Math.round(Math.min(W, H) * 0.04))
  const stripW = Math.max(8, W - pad * 2)
  const stripH = Math.max(8, Math.round(H * 0.14))
  const strip = revLedPropsFor(s, shift, { width: stripW, height: stripH, blink: flash })

  if (s.showRpm) {
    // Real analog tachometer: the AnalogDial (d3-arc track + damped needle) fills
    // the middle with the BIG gear numeral in its hub; a SPEED + RPM readout row
    // sits below. Tick labels are dropped (showTicks=false) so the scale can never
    // emit sub-legible micro text — the shift LEDs + needle already carry the rev.
    const rpmColor = resolveSlotStyle(s, 'value', { color: skin.palette.text }).color ?? skin.palette.text
    const warnFrom = maxRpm * (s.warnAt ?? 0.72)
    const redlineFrom = maxRpm * (s.dangerAt ?? 0.9)
    const bottomH = Math.max(28, Math.round(H * 0.2))
    const dialTop = pad + stripH + 4
    const dialAreaH = Math.max(40, H - dialTop - bottomH - pad)
    const dialSize = Math.max(48, Math.min(stripW, dialAreaH))
    const dialX = (W - dialSize) / 2
    const dialY = dialTop
    const rowY = H - bottomH
    const rowW = W - pad * 2
    const halfW = (rowW - 8) / 2
    return (
      <SvgRoot element={element} skin={skin} panel="panel" className={`gt3-gearcluster${flash ? ' gt3-cluster-flash' : ''}`}>
        <Slot x={pad} y={pad} w={stripW} h={stripH}><RevLedBar {...strip} /></Slot>
        <Slot x={dialX} y={dialY} w={dialSize} h={dialSize}>
          <AnalogDial
            value={rpmNumeric}
            min={0}
            max={maxRpm}
            size={dialSize}
            majorTicks={Math.max(2, Math.round(maxRpm / 1000) + 1)}
            minorPerMajor={4}
            showValue={false}
            showTicks={false}
            bezel={instrumentBezel(s)}
            material={instrumentMaterial(s)}
            needleColor={s.instrument?.parts?.needle?.color ?? s.needleColor ?? skin.palette.crit}
            damp={s.instrument?.parts?.dial?.damp ?? 0}
            warnFrom={s.instrument?.parts?.dial?.warnFrom ?? warnFrom}
            redlineFrom={s.instrument?.parts?.dial?.redlineFrom ?? redlineFrom}
            colors={instrumentColorsFor(s)}
          />
        </Slot>
        <FitText x={dialX + dialSize / 2} y={dialY + dialSize * 0.46} boxW={dialSize * 0.54} boxH={dialSize * 0.46} text={gear} fontFamily={FONT_MONO} fill={gearColor} minFontPx={14} maxFontPx={dialSize * 0.46} anchor="middle" baseline="central" />
        <StatCell rect={{ x: pad, y: rowY, w: halfW, h: bottomH - pad }} label={speedUnit} value={speed} valueColor={speedColor} labelColor={skin.palette.textDim} skin={skin} />
        <StatCell rect={{ x: pad + halfW + 8, y: rowY, w: halfW, h: bottomH - pad }} label="RPM" value={rpm} valueColor={rpmColor} labelColor={skin.palette.textDim} skin={skin} />
      </SvgRoot>
    )
  }

  // Bosch-style clean gear + speed: a big DSEG gear numeral and a DSEG speed
  // readout flank a hairline divider, with a modelled RevLedBar shift strip across
  // the top. Everything is auto-fit SVG text, so a tall/narrow or squat cluster can
  // never let a glyph spill past its cell. Slot colours stay user-editable.
  const contentTop = pad + stripH + 6
  const contentH = Math.max(24, H - contentTop - pad)
  const gearW = (W - pad * 2) * 0.56
  const speedX = pad + gearW + 8
  const speedW = W - pad - speedX
  return (
    <SvgRoot element={element} skin={skin} panel="panel" className={`gt3-gearcluster${flash ? ' gt3-cluster-flash' : ''}`}>
      <Slot x={pad} y={pad} w={stripW} h={stripH}><RevLedBar {...strip} /></Slot>
      <line x1={speedX - 4} y1={contentTop} x2={speedX - 4} y2={contentTop + contentH} stroke={skin.material.border} strokeWidth={1} />
      <StatCell rect={{ x: pad, y: contentTop, w: gearW, h: contentH }} label="GEAR" value={gear} valueColor={gearColor} labelColor={skin.palette.textDim} skin={skin} labelFrac={0.2} valueMaxPx={contentH * 0.82} />
      <StatCell rect={{ x: speedX, y: contentTop, w: speedW, h: contentH }} label={speedUnit} value={speed} valueColor={speedColor} labelColor={skin.palette.textDim} skin={skin} labelFrac={0.24} />
    </SvgRoot>
  )
}

function CornerGrid({ element, values, colorFor, fmt, unitLabel, icon, accent }: {
  element: DashboardElement
  values: Record<CornerKey, number | undefined>
  colorFor(v: number | undefined): string
  fmt(v: number | undefined): string
  unitLabel: string
  icon: GlyphKind
  accent: string
}): ReactElement {
  const s = element.style
  const skin = resolveElementSkin(s)
  const W = Math.max(1, Math.round(element.w))
  const H = Math.max(1, Math.round(element.h))
  const nums = CORNER_ORDER.map((c) => values[c]).filter((v): v is number => typeof v === 'number')
  const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : undefined
  const meta = s.showAverage ? `Ø ${fmt(avg)}${unitLabel}` : unitLabel
  const accentColor = resolveCssColor(s.accentColor ?? accent)

  // Header band (icon + meta), then a 2×2 grid whose cell VALUES fill their box via
  // FitText (StatCell) — so temps/pressures are as large as legibly fit and never
  // overflow. CORNER_ORDER = LF,RF,LR,RR → grid positions (col=i%2, row=i/2).
  const pad = Math.max(6, Math.round(Math.min(W, H) * 0.05))
  const headerH = Math.round(Math.min(24, Math.max(14, H * 0.13)))
  const gap = 7
  const gridY = pad + headerH
  const gridW = W - pad * 2
  const gridH = Math.max(2, H - gridY - pad)
  const cellW = (gridW - gap) / 2
  const cellH = (gridH - gap) / 2
  const showLabels = s.showLabels !== false
  const labelH = showLabels ? Math.min(14, cellH * 0.24) : 0

  return (
    <SvgRoot element={element} skin={skin} panel="auto" className="gt3-cornergrid">
      {element.style.showIcon !== false && (
        <Slot x={pad} y={pad} w={headerH} h={headerH}>
          <GlyphIcon kind={icon} color={accentColor} size={headerH} />
        </Slot>
      )}
      {meta && (
        <FitText
          x={W - pad}
          y={pad + headerH / 2}
          boxW={gridW * 0.62}
          boxH={headerH}
          text={String(meta)}
          fontFamily={FONT_CONDENSED}
          fill={skin.palette.textDim}
          anchor="end"
          baseline="central"
          minFontPx={10}
          maxFontPx={Math.min(16, headerH)}
          letterSpacing={0.5}
        />
      )}
      {CORNER_ORDER.map((corner, i) => {
        const col = i % 2
        const row = Math.floor(i / 2)
        const cx = pad + col * (cellW + gap)
        const cy = gridY + row * (cellH + gap)
        const color = resolveCssColor(colorFor(values[corner]))
        return (
          <g key={corner}>
            <rect x={cx} y={cy} width={cellW} height={cellH} rx={4} fill="#0A0A0A" />
            <rect x={cx} y={cy} width={3} height={cellH} rx={1.5} fill={color} />
            {showLabels && (
              <FitText
                x={cx + 8}
                y={cy + labelH / 2 + 3}
                boxW={cellW * 0.5}
                boxH={labelH}
                text={CORNER_LABEL[corner]}
                fontFamily={FONT_CONDENSED}
                fill={color}
                anchor="start"
                baseline="central"
                minFontPx={9}
                maxFontPx={Math.max(9, labelH)}
                weight={700}
                letterSpacing={0.5}
              />
            )}
            <StatCell
              rect={{ x: cx + 5, y: cy + labelH + 3, w: cellW - 10, h: cellH - labelH - 7 }}
              value={fmt(values[corner])}
              valueColor={color}
              skin={skin}
              valueFont={FONT_MONO}
              minPx={13}
            />
          </g>
        )
      })}
    </SvgRoot>
  )
}

export function TyreGrid({ element, snapshot, unitSystem = 'metric' }: WidgetProps): ReactElement {
  const s = element.style
  const mode = s.gridMode ?? 'temp'
  if (mode === 'pressure') {
    const values = Object.fromEntries(CORNER_ORDER.map((c) => [c, tyreCorner(snapshot, c, 'pressureKpa')])) as Record<CornerKey, number | undefined>
    return <CornerGrid element={element} values={values} colorFor={(v) => pressureColor(v, s.targetValue ?? 165, s.tolerance ?? 7)} fmt={(v) => formatMeasurement(v, 'pressure-kpa', unitSystem, { decimals: 1 }).display} unitLabel={formatMeasurement(undefined, 'pressure-kpa', unitSystem).unit} icon="tyre" accent={GT3.green} />
  }
  if (mode === 'wear') {
    const values = Object.fromEntries(CORNER_ORDER.map((c) => [c, tyreCorner(snapshot, c, 'wearPct')])) as Record<CornerKey, number | undefined>
    return <CornerGrid element={element} values={values} colorFor={wearColor} fmt={(v) => v === undefined ? '--' : Math.round(clamp01(v) * 100).toString()} unitLabel="%" icon="tyre" accent={GT3.green} />
  }
  const values = Object.fromEntries(CORNER_ORDER.map((c) => [c, tyreCorner(snapshot, c, 'tempC')])) as Record<CornerKey, number | undefined>
  return <CornerGrid element={element} values={values} colorFor={(v) => tyreTempColor(v, s)} fmt={(v) => formatMeasurement(v, 'temperature-c', unitSystem, { decimals: 0 }).display} unitLabel={formatMeasurement(undefined, 'temperature-c', unitSystem).unit} icon="tyre" accent={GT3.green} />
}

export function BrakeGrid({ element, snapshot, unitSystem = 'metric' }: WidgetProps): ReactElement {
  const s = element.style
  const values = Object.fromEntries(CORNER_ORDER.map((c) => [c, brakeCorner(snapshot, c)])) as Record<CornerKey, number | undefined>
  return <CornerGrid element={element} values={values} colorFor={(v) => brakeTempColor(v, s)} fmt={(v) => formatMeasurement(v, 'temperature-c', unitSystem, { decimals: 0 }).display} unitLabel={formatMeasurement(undefined, 'temperature-c', unitSystem).unit} icon="brake" accent={GT3.amber} />
}

// Per-corner health cards rewritten to the KIT single-root <svg> + StatCell
// pattern (mirrors CornerGrid): a 2×2 grid whose DOMINANT temp value FILLS the
// cell via FitText, with the wear mini-bar + pressure/brake kept as legible
// (≥11px) sub-values. All text is SVG so it can never clip/overflow its box.
export function CornerStack({ element, snapshot, unitSystem = 'metric' }: WidgetProps): ReactElement {
  const s = element.style
  const skin = resolveElementSkin(s)
  const W = Math.max(1, Math.round(element.w))
  const H = Math.max(1, Math.round(element.h))
  const pad = Math.max(6, Math.round(Math.min(W, H) * 0.05))
  const gap = 7
  const gridW = W - pad * 2
  const gridH = H - pad * 2
  const cellW = (gridW - gap) / 2
  const cellH = (gridH - gap) / 2
  const showLabels = s.showLabels !== false
  const labelH = showLabels ? Math.min(14, cellH * 0.2) : 0

  return (
    <SvgRoot element={element} skin={skin} panel="auto" className="gt3-cornerstack">
      {CORNER_ORDER.map((corner, i) => {
        const col = i % 2
        const row = Math.floor(i / 2)
        const cx = pad + col * (cellW + gap)
        const cy = pad + row * (cellH + gap)
        const temp = tyreCorner(snapshot, corner, 'tempC')
        const press = tyreCorner(snapshot, corner, 'pressureKpa')
        const wear = tyreCorner(snapshot, corner, 'wearPct')
        const brake = brakeCorner(snapshot, corner)
        const tColor = resolveCssColor(tyreTempColor(temp, s))
        const pColor = resolveCssColor(pressureColor(press, s.targetValue ?? 165, s.tolerance ?? 7))
        const bColor = resolveCssColor(brakeTempColor(brake, s))
        const wColor = resolveCssColor(wearColor(wear))
        const innerX = cx + 8
        const barW = cellW - 14
        const bottomPad = 4
        const subH = Math.max(13, Math.round(cellH * 0.15))
        const barH = Math.max(4, Math.round(cellH * 0.04))
        const barGap = 3
        const subCY = cy + cellH - bottomPad - subH / 2
        const barY = cy + cellH - bottomPad - subH - barGap - barH
        const tempTop = cy + labelH + 3
        const tempH = Math.max(12, barY - 3 - tempTop)
        return (
          <g key={corner}>
            <rect x={cx} y={cy} width={cellW} height={cellH} rx={4} fill="#0A0A0A" />
            <rect x={cx} y={cy} width={3} height={cellH} rx={1.5} fill={tColor} />
            {showLabels && (
              <FitText
                x={innerX}
                y={cy + labelH / 2 + 3}
                boxW={cellW * 0.5}
                boxH={labelH}
                text={CORNER_LABEL[corner]}
                fontFamily={FONT_CONDENSED}
                fill={tColor}
                anchor="start"
                baseline="central"
                minFontPx={9}
                maxFontPx={Math.max(9, labelH)}
                weight={700}
                letterSpacing={0.5}
              />
            )}
            <StatCell
              rect={{ x: cx + 5, y: tempTop, w: cellW - 10, h: tempH }}
              value={formatMeasurement(temp, 'temperature-c', unitSystem, { decimals: 0, includeUnit: true }).display}
              valueColor={tColor}
              skin={skin}
              valueFont={FONT_MONO}
              minPx={13}
            />
            <rect x={innerX} y={barY} width={barW} height={barH} rx={barH / 2} fill="#1C1C1C" />
            <rect x={innerX} y={barY} width={Math.max(0, barW * clamp01(wear ?? 0))} height={barH} rx={barH / 2} fill={wColor} />
            <FitText
              x={innerX}
              y={subCY}
              boxW={barW / 2 - 2}
              boxH={subH}
              text={formatMeasurement(press, 'pressure-kpa', unitSystem, { decimals: 1, includeUnit: true }).display}
              fontFamily={FONT_CONDENSED}
              fill={pColor}
              anchor="start"
              baseline="central"
              minFontPx={11}
              maxFontPx={Math.max(11, subH)}
              weight={600}
            />
            <FitText
              x={cx + cellW - 6}
              y={subCY}
              boxW={barW / 2 - 2}
              boxH={subH}
              text={`B ${formatMeasurement(brake, 'temperature-c', unitSystem, { decimals: 0, includeUnit: true }).display}`}
              fontFamily={FONT_CONDENSED}
              fill={bColor}
              anchor="end"
              baseline="central"
              minFontPx={11}
              maxFontPx={Math.max(11, subH)}
              weight={600}
            />
          </g>
        )
      })}
    </SvgRoot>
  )
}

const FUEL_STINT_PER_LAP_UNIT_FRAC = 0.55

export function FuelStint({ element, snapshot, unitSystem = 'metric' }: WidgetProps): ReactElement {
  const s = element.style
  const skin = resolveElementSkin(s)
  const W = Math.max(1, Math.round(element.w))
  const H = Math.max(1, Math.round(element.h))
  const liters = snapshot?.fuelLiters
  const cap = snapshot?.fuelCapacityLiters
  const perLap = snapshot?.fuelPerLap
  const lapsRem = snapshot?.lapsRemaining
  const reserve = s.reserveLaps ?? 1
  const warnAt = s.warnAtLaps ?? 2
  const lapsLeft = liters !== undefined && perLap && perLap > 0 ? liters / perLap : undefined
  const fill = liters !== undefined && cap && cap > 0 ? clamp01(liters / cap) : 0
  const needed = perLap !== undefined && lapsRem !== undefined ? (lapsRem + reserve) * perLap - (liters ?? 0) : undefined
  const lapColor = lapsLeft === undefined ? skin.palette.textDim : lapsLeft <= warnAt ? skin.palette.crit : lapsLeft <= warnAt * 2 ? skin.palette.warn : skin.palette.ok
  const valueOv = resolveSlotStyle(s, 'value', { color: lapColor })
  const lapsText = lapsLeft !== undefined ? lapsLeft.toFixed(1) : '—'
  const perLapReading = formatMeasurement(perLap, 'fuel-per-lap-l', unitSystem, { decimals: 2 })
  const addReading = formatMeasurement(needed, 'fuel-volume-l', unitSystem, { decimals: 1 })
  const perLapText = perLapReading.display
  const addText = needed === undefined ? '—' : needed > 0 ? `+${addReading.display}` : 'OK'
  const addColor = needed !== undefined && needed > 0 ? skin.palette.warn : skin.palette.ok
  const {
    pad,
    innerW,
    barH,
    topH,
    lapsW,
    sideX,
    columnGap,
    halfSide
  } = computeFuelStintLayout(W, H)
  return (
    <SvgRoot element={element} skin={skin} panel="panel" className="gt3-fuelstint">
      <StatCell
        rect={{ x: pad, y: pad, w: lapsW, h: topH }}
        label="FUEL"
        value={lapsText}
        unit="LAP"
        valueColor={valueOv.color ?? lapColor}
        labelColor={skin.palette.textDim}
        unitColor={skin.palette.textDim}
        valueFont={valueOv.fontFamily ?? FONT_MONO}
        valueMaxPx={valueOv.fontSize}
        skin={skin}
        labelFrac={0.26}
      />
      <StatCell
        rect={{ x: sideX, y: pad, w: halfSide, h: topH }}
        label="LAP"
        value={perLapText}
        unit={perLapReading.unit}
        valueColor={skin.palette.text}
        labelColor={skin.palette.textDim}
        skin={skin}
        labelFrac={0.3}
        unitFrac={FUEL_STINT_PER_LAP_UNIT_FRAC}
        unitMaxPx={Math.max(13, Math.min(16, topH * 0.24))}
        minPx={13}
      />
      <StatCell
        rect={{ x: sideX + halfSide + columnGap, y: pad, w: halfSide, h: topH }}
        label="ADD"
        value={addText}
        unit={needed !== undefined && needed > 0 ? addReading.unit : undefined}
        valueColor={addColor}
        labelColor={skin.palette.textDim}
        valueFont={readoutFont(addText)}
        skin={skin}
        labelFrac={0.3}
      />
      <BarGraph
        x={pad}
        y={pad + topH + 6}
        width={innerW}
        height={barH}
        fraction={fill}
        orientation="h"
        warnAt={0.32}
        critAt={0.16}
        invert
        skin={skin}
      />
    </SvgRoot>
  )
}

export function computeFuelStintLayout(W: number, H: number): {
  pad: number
  innerW: number
  barH: number
  topH: number
  lapsW: number
  sideX: number
  columnGap: number
  halfSide: number
  perLapUnitBoxW: number
  perLapUnitBoxH: number
} {
  const pad = Math.max(5, Math.round(Math.min(W, H) * 0.06))
  const innerW = W - pad * 2
  const innerH = H - pad * 2
  const barH = Math.max(6, Math.min(innerH * 0.2, 14))
  const topH = Math.max(14, innerH - barH - 6)
  const lapsW = innerW * 0.42
  const sideX = pad + lapsW + 8
  const sideW = W - pad - sideX
  const columnGap = Math.max(12, Math.min(18, Math.round(innerW * 0.05)))
  const halfSide = (sideW - columnGap) / 2
  const labelH = Math.max(15, Math.min(topH * 0.3, topH * 0.5))
  const valueH = Math.max(1, topH - labelH)

  return {
    pad,
    innerW,
    barH,
    topH,
    lapsW,
    sideX,
    columnGap,
    halfSide,
    perLapUnitBoxW: Math.max(1, halfSide * FUEL_STINT_PER_LAP_UNIT_FRAC - 2),
    perLapUnitBoxH: valueH * 0.6
  }
}

export function DeltaTile({ element, snapshot }: WidgetProps): ReactElement {
  const s = element.style
  const ref = s.deltaReference ?? 'session'
  const binding = element.binding ?? (ref === 'best' ? 'deltaToBestSec' : ref === 'last' ? 'lastLapDeltaSec' : 'deltaToSessionBestSec')
  const delta = resolveBinding(binding, snapshot).numeric
  const range = Math.max(0.05, s.deltaRangeSec ?? 1)
  const norm = Math.max(-1, Math.min(1, (delta ?? 0) / range))
  const color = delta === undefined ? GT3.textMuted : norm <= 0 ? GT3.green : GT3.red
  const deltaText = fmtDelta(delta)
  // Fit the value to the tile's OWN width as well as its height so a narrow tile
  // (e.g. 180px in the minimal preset) can't clip "−0.081" to "−0.0".
  const labelSize = Math.max(11, Math.min(20, element.h * 0.12))
  const deltaSize = Math.max(20, Math.floor(Math.min(element.h * 0.4, ((element.w - 32) * 0.94) / (Math.max(4, deltaText.length) * 0.6))))

  return (
    <Shell element={element} chrome={panelChrome(s, { radius: s.radius ?? 2, plain: true })} padding={0} className="gt3-deltatile">
      <div style={{
        flex: 1,
        background: GT3.bg1,
        border: `1px solid ${GT3.panelStroke}`,
        display: 'flex',
        flexDirection: 'column',
        padding: '12px 16px',
        justifyContent: 'space-between',
        boxSizing: 'border-box',
        overflow: 'hidden'
      }}>
        <div className="gt3-label" style={(() => { const ov = resolveSlotStyle(s, 'label', { color: GT3.textSecondary, fontSize: labelSize }); return { ...slotCss(ov), color: ov.color ?? GT3.textSecondary, fontSize: `${ov.fontSize ?? labelSize}px` } })()}>LAP Δ</div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: '4px' }}>
          {(() => {
            const ov = resolveSlotStyle(s, 'value', { color, fontSize: deltaSize })
            return <AutoFitText className="gt3-value" {...fillProps(s, 'value', ov.fontSize ?? deltaSize)} minSize={16} style={{ ...slotCss(ov), color: ov.color ?? color, fontFamily: ov.fontFamily ?? readoutFont(deltaText) }}>{deltaText}</AutoFitText>
          })()}
        </div>
      </div>
    </Shell>
  )
}

// One timing row rendered straight into the parent <svg>: a condensed label on
// the left and a right-aligned DSEG time on the right. The dim "all-segments"
// ghost shares the value's EXACT box/anchor/font/fit range, so it fits to the
// same size and sits perfectly behind the value — never clipped or offset (the
// old absolutely-positioned fixed-size ghost caused the left-cut/overlap bug).
function TimingRow({ element, label, value, color, rect, big = false, divider = true, valueSlot = 'value' }: {
  element: DashboardElement
  label: string
  value: string
  color: string
  rect: Rect
  big?: boolean
  divider?: boolean
  valueSlot?: string
}): ReactElement {
  const { x, y, w, h } = rect
  const text = value && value.length ? value : '--.---'
  const ov = resolveSlotStyle(element.style, valueSlot, { color })
  const valueColor = ov.color ?? color
  const valueFamily = ov.fontFamily ?? readoutFont(text)
  const ls = ov.letterSpacing ? Number.parseFloat(ov.letterSpacing) : undefined
  const cyRow = y + h / 2
  const labelBoxW = w * 0.32
  const valueBoxW = w * 0.64
  const valueBoxH = h * 0.86
  const valueMax = ov.fontSize ?? Math.max(13, valueBoxH * (big ? 1 : 0.82))
  const ghostText = text.replace(/[0-9]/g, '8')
  const rightX = x + w
  return (
    <g>
      <FitText
        x={x}
        y={cyRow}
        boxW={labelBoxW}
        boxH={Math.min(h * 0.7, 18)}
        text={label}
        fontFamily={FONT_CONDENSED}
        fill={GT3.textSecondary}
        anchor="start"
        baseline="central"
        minFontPx={11}
        maxFontPx={Math.max(11, Math.min(16, h * 0.5))}
        weight={600}
        letterSpacing={0.6}
      />
      <FitText
        x={rightX}
        y={cyRow}
        boxW={valueBoxW}
        boxH={valueBoxH}
        text={ghostText}
        fontFamily={valueFamily}
        fill={GT3.textPrimary}
        anchor="end"
        baseline="central"
        minFontPx={12}
        maxFontPx={valueMax}
        style={{ opacity: 0.07 }}
      />
      <FitText
        x={rightX}
        y={cyRow}
        boxW={valueBoxW}
        boxH={valueBoxH}
        text={text}
        fontFamily={valueFamily}
        fill={valueColor}
        anchor="end"
        baseline="central"
        minFontPx={12}
        maxFontPx={valueMax}
        weight={ov.fontWeight}
        letterSpacing={ls}
      />
      {divider && <line x1={x} y1={y + h} x2={x + w} y2={y + h} stroke={GT3.panelStroke} strokeWidth={1} />}
    </g>
  )
}

export function LapTiming({ element, snapshot }: WidgetProps): ReactElement {
  const s = element.style
  const skin = resolveElementSkin(s)
  const W = Math.max(1, Math.round(element.w))
  const H = Math.max(1, Math.round(element.h))
  const lastDelta = resolveBinding('lastLapDeltaSec', snapshot).numeric
  type Row = { key: string; label: string; value: string; color: string; slot: string; big: boolean }
  const defs: Row[] = []
  if (s.showCurrent !== false) defs.push({ key: 'cur', label: 'LAP', value: resolveBinding('currentLapFmt', snapshot).text, color: GT3.textPrimary, slot: 'current', big: true })
  if (s.showLast !== false) defs.push({ key: 'last', label: 'LAST', value: resolveBinding('lastLapFmt', snapshot).text, color: lastDelta !== undefined && lastDelta < 0 ? GT3.green : GT3.amber, slot: 'last', big: false })
  if (s.showBest !== false) defs.push({ key: 'best', label: 'BEST', value: resolveBinding('bestLapFmt', snapshot).text, color: GT3.textPrimary, slot: 'best', big: false })
  if (s.showEstimated === true) defs.push({ key: 'est', label: 'EST', value: resolveBinding('estLapFmt', snapshot).text, color: GT3.textSecondary, slot: 'est', big: false })
  const pad = Math.max(8, Math.round(Math.min(W, H) * 0.06))
  const innerX = pad
  const innerW = W - pad * 2
  const innerH = Math.max(1, H - pad * 2)
  const weightSum = defs.reduce((a, r) => a + (r.big ? 1.32 : 1), 0) || 1
  let acc = pad
  const rows = defs.map((r, i) => {
    const rowH = innerH * ((r.big ? 1.32 : 1) / weightSum)
    const rect: Rect = { x: innerX, y: acc, w: innerW, h: rowH }
    acc += rowH
    return <TimingRow key={r.key} element={element} label={r.label} value={r.value} color={r.color} rect={rect} big={r.big} divider={i < defs.length - 1} valueSlot={r.slot} />
  })
  return (
    <SvgRoot element={element} skin={skin} panel="none" className="gt3-laptiming">
      {rows}
    </SvgRoot>
  )
}

export function PositionGaps({ element, snapshot }: WidgetProps): ReactElement {
  const s = element.style
  const skin = resolveElementSkin(s)
  const W = Math.max(1, Math.round(element.w))
  const H = Math.max(1, Math.round(element.h))
  const pos = resolveBinding('position', snapshot).text
  const cls = resolveBinding('classPosition', snapshot).text
  const total = resolveBinding('totalCars', snapshot).text
  const player = snapshot?.drivers?.find((d) => d.isPlayer)
  const gapAhead = resolveBinding('gapAheadFmt', snapshot).text
  const gapBehind = resolveBinding('gapBehindFmt', snapshot).text
  const posOv = resolveSlotStyle(s, 'value', { color: skin.palette.text })
  const classColor = resolveSlotStyle(s, 'label', { color: player?.classColor ?? skin.palette.info }).color ?? (player?.classColor ?? skin.palette.info)
  const aheadOv = resolveSlotStyle(s, 'gap', { color: skin.palette.ok })
  const behindOv = resolveSlotStyle(s, 'gap', { color: skin.palette.crit })
  const pad = Math.max(5, Math.round(Math.min(W, H) * 0.06))
  const innerW = W - pad * 2
  const innerH = H - pad * 2
  const leftW = innerW * 0.44
  const rightX = pad + leftW + 8
  const rightW = W - pad - rightX
  const posH = innerH * 0.64
  const classH = Math.max(12, innerH - posH)
  const rowH = (innerH - 6) / 2
  return (
    <SvgRoot element={element} skin={skin} panel="panel" className="gt3-positiongaps">
      <StatCell
        rect={{ x: pad, y: pad, w: leftW, h: posH }}
        label="POS"
        value={pos || '—'}
        unit={s.showTotal !== false && total ? `/${total}` : undefined}
        valueColor={posOv.color ?? skin.palette.text}
        labelColor={skin.palette.textDim}
        unitColor={skin.palette.textDim}
        valueFont={posOv.fontFamily ?? readoutFont(pos || '—')}
        valueMaxPx={posOv.fontSize}
        skin={skin}
        labelFrac={0.24}
      />
      <FitText
        x={pad + leftW / 2}
        y={pad + posH + classH / 2}
        boxW={leftW}
        boxH={classH}
        text={`CLASS ${cls}`}
        fontFamily={FONT_CONDENSED}
        fill={classColor}
        minFontPx={11}
        maxFontPx={Math.max(11, classH * 0.9)}
        anchor="middle"
        baseline="central"
      />
      <StatCell
        rect={{ x: rightX, y: pad, w: rightW, h: rowH }}
        label="▲ AHEAD"
        value={gapAhead || '—'}
        valueColor={aheadOv.color ?? skin.palette.ok}
        labelColor={skin.palette.ok}
        valueFont={aheadOv.fontFamily ?? readoutFont(gapAhead || '—')}
        skin={skin}
        labelFrac={0.32}
      />
      <StatCell
        rect={{ x: rightX, y: pad + rowH + 6, w: rightW, h: rowH }}
        label="▼ BEHIND"
        value={gapBehind || '—'}
        valueColor={behindOv.color ?? skin.palette.crit}
        labelColor={skin.palette.crit}
        valueFont={behindOv.fontFamily ?? readoutFont(gapBehind || '—')}
        skin={skin}
        labelFrac={0.32}
      />
    </SvgRoot>
  )
}

export function FlagOverlay({ element, snapshot }: WidgetProps): ReactElement {
  const s = element.style
  const flag = getActiveFlag(snapshot)
  const pit = snapshot?.pitLimiter
  const onPit = snapshot?.onPitRoad
  const inc = s.includeIncidents && snapshot?.incidentCount !== undefined ? `  INC ${snapshot.incidentCount}${snapshot.incidentLimit ? `/${snapshot.incidentLimit}` : ''}` : ''
  let label = 'GREEN TRACK'
  let bg = 'rgba(15,24,33,0.65)'
  let fg: string = GT3.textSecondary
  let active = false
  if (flag) {
    label = flag.label
    bg = flag.color
    fg = flag.key === 'yellow' || flag.key === 'white' || flag.key === 'checkered' ? GT3.black : GT3.whiteFlash
    active = true
  } else if (pit) {
    label = 'PIT LIMITER'
    bg = GT3.pitBlue
    fg = GT3.whiteFlash
    active = true
  } else if (onPit) {
    label = 'PIT LANE'
    bg = BRUSHED_METAL_BACKGROUND
    fg = GT3.whiteFlash
    active = true
  }
  return (
    <Shell element={element} chrome={active ? { borderRadius: s.radius ?? 10 } : panelChrome(s, { radius: s.radius ?? 10 })} className={`gt3-flagoverlay${active ? ' active' : ''}`}>
      {(() => {
        const baseSize = Math.max(15, Math.floor(element.h * (s.compact ? 0.36 : 0.46)))
        const ov = resolveSlotStyle(s, 'value', { color: fg, fontSize: baseSize })
        return <div className="gt3-flag-face" style={{ ...slotCss(ov), background: bg, color: ov.color ?? fg, fontSize: ov.fontSize ?? baseSize }}>{label}{inc}</div>
      })()}
    </Shell>
  )
}

const INPUT_META: Record<string, { label: string; color: string }> = {
  throttle: { label: 'THR', color: GT3.green },
  brake: { label: 'BRK', color: GT3.red },
  clutch: { label: 'CLT', color: GT3.blue }
}

export function InputBars({ element, snapshot }: WidgetProps): ReactElement {
  const s = element.style
  const channels = (s.channels && s.channels.length > 0 ? s.channels : ['throttle', 'brake']).slice(0, 4)
  return (
    <Shell element={element} chrome={panelChrome(s, { radius: s.radius ?? 12 })} padding={8} className="gt3-inputbars">
      {channels.map((ch) => {
        const meta = INPUT_META[ch] ?? { label: ch.slice(0, 3).toUpperCase(), color: GT3.cyan }
        const v = pct(ch, snapshot)
        return (
          <div key={ch} className="gt3-input-channel">
            <div className="gt3-input-track">
              <div style={{ height: `${v * 100}%`, background: meta.color }} />
              {(() => {
                const ov = resolveSlotStyle(s, 'value', {})
                return <span style={{ ...slotCss(ov), fontSize: ov.fontSize, color: ov.color }}>{Math.round(v * 100)}</span>
              })()}
            </div>
            <Label element={element} color={meta.color}>{meta.label}</Label>
          </div>
        )
      })}
    </Shell>
  )
}

interface TraceChannelState { data: number[] }

function useMultiTrace(element: DashboardElement, snapshot: TelemetrySnapshot | null, channels: string[]): Map<string, number[]> {
  const len = Math.max(16, Math.min(2048, element.style.traceLength ?? 160))
  const ref = useRef<Map<string, TraceChannelState>>(new Map())
  const lastTs = useRef<number>(-1)
  if (snapshot && snapshot.timestamp !== lastTs.current) {
    lastTs.current = snapshot.timestamp
    for (const ch of channels) {
      let st = ref.current.get(ch)
      if (!st) {
        st = { data: [] }
        ref.current.set(ch, st)
      }
      const v = ch === 'steerAngleDeg' || ch === 'steering'
        ? clamp01(0.5 + (snapshot.steerAngleDeg ?? 0) / (2 * Math.max(1, element.style.maxDegrees ?? 540)))
        : pct(ch, snapshot)
      st.data.push(v)
      if (st.data.length > len) st.data.splice(0, st.data.length - len)
    }
  }
  const out = new Map<string, number[]>()
  for (const ch of channels) out.set(ch, ref.current.get(ch)?.data ?? [])
  return out
}

const TRACE_COLORS: Record<string, string> = { throttle: GT3.green, brake: GT3.red, clutch: GT3.blue, steerAngleDeg: GT3.cyan, steering: GT3.cyan, rpmPct: GT3.amber }

export function InputTrace({ element, snapshot }: WidgetProps): ReactElement {
  const s = element.style
  const channels = (s.channels && s.channels.length > 0 ? s.channels : ['throttle', 'brake']).slice(0, 4)
  const buffers = useMultiTrace(element, snapshot, channels)
  const len = Math.max(16, Math.min(2048, s.traceLength ?? 160))
  const stroke = s.traceWidth ?? 1.7
  function path(samples: number[]): string {
    // A single static frame (the visual-audit harness renders one snapshot) or the
    // very first live frame yields <2 samples, which previously produced an empty
    // path — the whole trace rendered blank. Draw the current value as a flat line
    // spanning the full width so every channel is always visible; real traces build
    // up over subsequent frames and use the right-aligned scrolling geometry below.
    if (samples.length < 2) {
      const v = clamp01(samples.length ? samples[samples.length - 1] : 0)
      const y = (100 - v * 100).toFixed(2)
      return `M0,${y} L100,${y}`
    }
    return samples.map((sample, i) => {
      const x = ((i + (len - samples.length)) / Math.max(1, len - 1)) * 100
      const y = 100 - clamp01(sample) * 100
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    }).join(' ')
  }
  return (
    <Shell element={element} chrome={panelChrome(s, { radius: s.radius ?? 12 })} padding={7} className="gt3-inputtrace">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d="M0 50 H100" className="grid" />
        {channels.map((ch) => {
          const d = path(buffers.get(ch) ?? [])
          return d ? <path key={ch} d={d} fill="none" stroke={TRACE_COLORS[ch] ?? GT3.cyan} strokeWidth={stroke} vectorEffect="non-scaling-stroke" /> : null
        })}
      </svg>
    </Shell>
  )
}

export function Steering({ element, snapshot }: WidgetProps): ReactElement {
  const s = element.style
  const deg = snapshot?.steerAngleDeg ?? 0
  const maxDeg = s.maxDegrees ?? 540
  const norm = Math.max(-1, Math.min(1, deg / Math.max(1, maxDeg)))
  const color = s.accentColor ?? GT3.cyan
  return (
    <Shell element={element} chrome={panelChrome(s, { radius: s.radius ?? 12 })} padding={9} className="gt3-steering">
      <div className="gt3-module-header"><Label element={element} color={color}>{s.title ?? 'STEERING'}</Label>{s.showNumeric !== false && <Value element={element} size={16}>{Math.round(deg)}°</Value>}</div>
      <div className="gt3-steer-bar"><span className="center" /><span style={{ left: `${norm < 0 ? 50 + norm * 50 : 50}%`, width: `${Math.abs(norm) * 50}%`, background: color }} /></div>
    </Shell>
  )
}

function SetupBox({ label, value, active, color = GT3.cyan, w, element }: { label: string; value: string; active?: boolean; color?: string; w: number; element?: DashboardElement }): ReactElement {
  return <div className={`gt3-setup-box${active ? ' active' : ''}`} style={{ flex: w, borderColor: active ? color : undefined, color: active ? color : undefined }}><Label element={element} color={active ? color : GT3.textMuted}>{label}</Label><Value element={element} color={active ? color : GT3.textPrimary} size={16}>{value}</Value></div>
}

export function SetupStrip({ element, snapshot }: WidgetProps): ReactElement {
  const s = element.style
  const fields = s.fields && s.fields.length > 0 ? s.fields : ['abs', 'tc', 'map', 'bb', 'inc']
  const incTxt = snapshot?.incidentCount !== undefined ? `${snapshot.incidentCount}${snapshot.incidentLimit ? `/${snapshot.incidentLimit}` : ''}` : '--'
  const incColor = snapshot?.incidentCount !== undefined && snapshot.incidentLimit ? (snapshot.incidentCount >= snapshot.incidentLimit - 4 ? GT3.red : snapshot.incidentCount >= snapshot.incidentLimit / 2 ? GT3.amber : GT3.green) : GT3.textPrimary
  const nodes: Record<string, ReactNode> = {
    abs: <SetupBox key="abs" element={element} label="ABS" value={s.bindingAbs ? resolveBinding(s.bindingAbs, snapshot).text : (snapshot?.absActive ? 'ON' : '--')} active={Boolean(snapshot?.absActive)} color={GT3.amber} w={1} />,
    tc: <SetupBox key="tc" element={element} label="TC" value={s.bindingTc ? resolveBinding(s.bindingTc, snapshot).text : (snapshot?.tcActive ? 'ON' : '--')} active={Boolean(snapshot?.tcActive)} color={GT3.blue} w={1} />,
    map: <SetupBox key="map" element={element} label="MAP" value={s.bindingMap ? resolveBinding(s.bindingMap, snapshot).text : '--'} w={1} />,
    bb: <SetupBox key="bb" element={element} label="BBAL" value={s.bindingBrakeBias ? resolveBinding(s.bindingBrakeBias, snapshot).text : '--'} w={1.2} />,
    limiter: <SetupBox key="limiter" element={element} label="LIM" value={snapshot?.pitLimiter ? 'ON' : '--'} active={Boolean(snapshot?.pitLimiter)} color={GT3.pitBlue} w={1} />,
    inc: <SetupBox key="inc" element={element} label="INC" value={incTxt} color={incColor} w={1.2} />
  }
  const vertical = element.h > element.w * 1.15
  return <Shell element={element} chrome={panelChrome(s, { radius: s.radius ?? 12 })} padding={6} className={`gt3-setupstrip${vertical ? ' gt3-setup-vertical' : ''}`}><div className="gt3-setup-row" style={{ flexDirection: vertical ? 'column' : 'row' }}>{fields.map((f) => nodes[f] ?? null)}</div></Shell>
}

export function EngineTemps({ element, snapshot, unitSystem = 'metric' }: WidgetProps): ReactElement {
  const s = element.style
  const skin = resolveElementSkin(s)
  const W = Math.max(1, Math.round(element.w))
  const H = Math.max(1, Math.round(element.h))
  const water = resolveBinding(s.bindingWater ?? 'var:waterTempC', snapshot)
  const oil = resolveBinding(s.bindingOil ?? 'var:oilTempC', snapshot)
  const oilP = resolveBinding(s.bindingOilPressure ?? 'var:oilPressureKpa', snapshot)
  const tColor = (v?: number, hot = 110, crit = 125): string => v === undefined ? skin.palette.textDim : v >= crit ? skin.palette.crit : v >= hot ? skin.palette.warn : skin.palette.ok
  const waterReading = formatMeasurement(water.numeric, 'temperature-c', unitSystem, { decimals: 0 })
  const oilReading = formatMeasurement(oil.numeric, 'temperature-c', unitSystem, { decimals: 0 })
  const oilPressureReading = formatMeasurement(oilP.numeric, 'pressure-kpa', unitSystem, { decimals: 1 })
  // Tall/narrow placements (e.g. 180×250) stack the three DataField-style cells
  // vertically; landscape lays them 1×3. Each cell is a labelled DSEG readout so
  // the label + value + unit each get their OWN auto-fit box and can never clip.
  const portrait = H > W
  const labelColor = resolveSlotStyle(s, 'label', { color: skin.palette.textDim }).color ?? skin.palette.textDim
  const unitColor = resolveSlotStyle(s, 'unit', { color: skin.palette.textDim }).color ?? skin.palette.textDim
  const cells = [
    { label: 'WATER', value: waterReading.display, unit: waterReading.unit, tc: tColor(water.numeric, s.hotAt ?? 108, s.criticalAt ?? 122) },
    { label: 'OIL', value: oilReading.display, unit: oilReading.unit, tc: tColor(oil.numeric, s.hotAt ?? 120, s.criticalAt ?? 140) },
    { label: 'OIL P', value: oilPressureReading.display, unit: oilPressureReading.unit, tc: oilP.numeric !== undefined && oilP.numeric < 100 ? skin.palette.crit : skin.palette.ok }
  ]
  const grid = portrait ? makeGrid(1, 3, W, H, 8) : makeGrid(3, 1, W, H, 8)
  return (
    <SvgRoot element={element} skin={skin} panel="panel" className="gt3-enginetemps">
      {cells.map((c, i) => {
        const rect = portrait ? grid.cell(0, i, 1, 1) : grid.cell(i, 0, 1, 1)
        const alarm = c.tc === skin.palette.crit
        const valueOv = resolveSlotStyle(s, 'value', { color: alarm ? skin.palette.text : c.tc })
        return (
          <g key={c.label}>
            <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={3} fill={alarm ? skin.palette.crit : skin.palette.surface} stroke={skin.material.border} strokeWidth={1} />
            <StatCell
              rect={grid.inset(rect, Math.min(8, rect.w * 0.08, rect.h * 0.08))}
              label={c.label}
              value={c.value}
              unit={c.unit}
              valueColor={valueOv.color ?? (alarm ? skin.palette.text : c.tc)}
              labelColor={alarm ? skin.palette.text : labelColor}
              unitColor={alarm ? skin.palette.text : unitColor}
              valueFont={valueOv.fontFamily ?? FONT_MONO}
              valueMaxPx={valueOv.fontSize}
              skin={skin}
              labelFrac={portrait ? 0.34 : 0.32}
            />
          </g>
        )
      })}
    </SvgRoot>
  )
}

export function Weather({ element, snapshot, unitSystem = 'metric' }: WidgetProps): ReactElement {
  const s = element.style
  const wet = clamp01(snapshot?.trackWetnessPct ?? 0)
  const grip = snapshot?.gripPct
  const raining = snapshot?.isRaining
  return (
    <Shell element={element} chrome={panelChrome(s, { radius: s.radius ?? 12 })} padding={8} className="gt3-weather">
      <WidgetHeader kind="weather" color={s.accentColor ?? GT3.cyan} meta={raining ? 'RAIN' : wet > 0.2 ? 'DAMP' : 'DRY'} metaColor={raining ? GT3.blue : wet > 0.2 ? GT3.cyan : GT3.green} element={element} />
      <div className="gt3-data-row">
        <span><Label element={element}>TRACK</Label><Value element={element} size={18}>{formatMeasurement(snapshot?.trackTempC, 'temperature-c', unitSystem, { decimals: 0, includeUnit: true }).display}</Value></span>
        <span><Label element={element}>AIR</Label><Value element={element} size={18}>{formatMeasurement(snapshot?.airTempC, 'temperature-c', unitSystem, { decimals: 0, includeUnit: true }).display}</Value></span>
        <span><Label element={element}>GRIP</Label><Value element={element} color={GT3.green} size={18}>{grip !== undefined ? Math.round(grip * 100) : '--'}%</Value></span>
      </div>
      <div className="gt3-fuel-bar wet"><div style={{ width: `${wet * 100}%`, background: wet > 0.5 ? GT3.blue : GT3.cyan }} /></div>
    </Shell>
  )
}

export function TrackMini({ element, snapshot }: WidgetProps): ReactElement {
  const s = element.style
  const progress = pct(element.binding ?? 'lapDistPct', snapshot) || clamp01(snapshot?.lapDistPct ?? 0)
  const accent = resolveCssColor(s.accentColor, GT3.cyan)
  const point = (p: number): { x: number; y: number } => {
    const a = -Math.PI / 2 + p * Math.PI * 2
    return { x: 50 + Math.cos(a) * 38, y: 50 + Math.sin(a) * 30 }
  }
  const player = point(progress)
  return (
    <Shell element={element} chrome={panelChrome(s, { radius: s.radius ?? 12 })} padding={6} className="gt3-trackmini">
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
        <ellipse cx="50" cy="50" rx="38" ry="30" className="track" />
        <ellipse cx="50" cy="50" rx="38" ry="30" className="track-dash" />
        {(snapshot?.drivers ?? []).filter((d) => !d.isPlayer && d.lapDistPct !== undefined).slice(0, 12).map((d) => {
          const pt = point(clamp01(d.lapDistPct ?? 0))
          return <circle key={d.carIdx} cx={pt.x} cy={pt.y} r="2.4" fill={d.classColor ?? GT3.amber} />
        })}
        <circle cx="50" cy="20" r="2.3" fill={GT3.whiteFlash} />
        <circle cx={player.x} cy={player.y} r="3.8" fill={accent} stroke={GT3.whiteFlash} strokeWidth="1" />
        <SvgSlotText element={element} slot="value" x="50" y="54" family={FONT_MONO} size={11} fill={GT3.textPrimary} fontWeight={900} fitWidth={70}>{Math.round(progress * 100)}%</SvgSlotText>
      </svg>
    </Shell>
  )
}

type VariantKind = 'clean' | 'elaborate'
type MetricKind = 'speed' | 'gear' | 'rpm' | 'delta' | 'fuel' | 'lap' | 'position' | 'flags' | 'abs' | 'tc' | 'map' | 'bb' | 'pitlimiter' | 'incidents' | 'clutch' | 'drs'

// Short identity label drawn (via FitText, ≥11px) at the top of every curated
// metric tile. Replaces the old icon-only header so abs/pit read their assist name
// legibly instead of relying on the sub-10px glyph text.
const KIND_TAG: Record<MetricKind, string> = {
  speed: 'SPEED',
  gear: 'GEAR',
  rpm: 'RPM',
  delta: 'DELTA',
  fuel: 'FUEL',
  lap: 'LAP',
  position: 'POS',
  flags: 'FLAG',
  abs: 'ABS',
  tc: 'TC',
  map: 'MAP',
  bb: 'BB',
  pitlimiter: 'PIT',
  incidents: 'INC',
  clutch: 'CLT',
  drs: 'DRS'
}

interface MetricData {
  value: string
  color: string
  icon: GlyphKind
  pct?: number
  active?: boolean
  unit?: string // tiny suffix beside the value (km/h, %, L…)
  tag?: string // short disambiguating label for assists (ABS/TC/MAP…)
  sub?: string // compact live secondary read-out (laps, class, last lap…)
}

function metricData(kind: MetricKind, snapshot: TelemetrySnapshot | null, element: DashboardElement, unitSystem: UnitSystem): MetricData {
  const s = element.style
  const accent = resolveCssColor(s.accentColor ?? s.color, GT3.cyan)
  switch (kind) {
    case 'speed': {
      const reading = formatMeasurement(snapshot?.speedKmh, 'speed-kmh', unitSystem, { decimals: 0 })
      return { value: reading.display, unit: reading.unit, pct: clamp01((snapshot?.speedKmh ?? 0) / 320), color: accent, icon: 'speed' }
    }
    case 'gear':
      return { value: resolveBinding('gearLabel', snapshot).text, pct: pct('shiftPct', snapshot), color: accent, icon: 'gear' }
    case 'rpm': {
      const rpmPct = pct('rpmPct', snapshot)
      const max = resolveBinding('maxRpm', snapshot).text
      return { value: resolveBinding('rpm', snapshot).text, sub: max && max !== '—' ? `/${max}` : undefined, pct: rpmPct, color: rpmRampColor(rpmPct, s), icon: 'rpm' }
    }
    case 'delta': {
      const delta = resolveBinding(element.binding ?? 'deltaSec', snapshot).numeric
      return { value: fmtDelta(delta), unit: 's', pct: clamp01(0.5 + (delta ?? 0) / (2 * (s.deltaRangeSec ?? 1))), color: delta === undefined ? GT3.textMuted : delta <= 0 ? GT3.green : GT3.red, icon: 'delta' }
    }
    case 'fuel': {
      const fill = snapshot?.fuelCapacityLiters ? clamp01((snapshot.fuelLiters ?? 0) / snapshot.fuelCapacityLiters) : 0
      const laps = resolveBinding('fuelLapsLeftStr', snapshot).text
      const reading = formatMeasurement(snapshot?.fuelLiters, 'fuel-volume-l', unitSystem, { decimals: 1 })
      return { value: reading.display, unit: reading.unit, sub: laps && laps !== '—' ? `${laps} lap` : undefined, pct: fill, color: fill < 0.16 ? GT3.red : fill < 0.32 ? GT3.amber : GT3.green, icon: 'fuel' }
    }
    case 'lap': {
      const last = resolveBinding('lastLapFmt', snapshot).text
      return { value: resolveBinding('currentLap', snapshot).text, sub: last && last !== '—:--.---' ? last : undefined, pct: clamp01(snapshot?.lapDistPct ?? 0), color: accent, icon: 'lap' }
    }
    case 'position': {
      const cls = resolveBinding('classPosition', snapshot).text
      const total = resolveBinding('totalCars', snapshot).text
      return { value: `P${resolveBinding('position', snapshot).text}`, sub: `C${cls}·${total}`, color: accent, icon: 'position' }
    }
    case 'flags': {
      const flag = getActiveFlag(snapshot)
      return { value: flag?.label ?? 'GREEN', active: Boolean(flag), color: flag?.color ?? GT3.green, icon: 'flag' }
    }
    case 'abs':
      return { value: snapshot?.absLevel !== undefined ? String(snapshot.absLevel) : fmtBool(snapshot?.absEnabled), tag: 'ABS', sub: snapshot?.absActive ? 'ON' : undefined, active: Boolean(snapshot?.absActive), color: snapshot?.absActive ? GT3.amber : accent, icon: 'abs' }
    case 'tc':
      return { value: snapshot?.tcLevel !== undefined ? String(snapshot.tcLevel) : fmtBool(snapshot?.tcEnabled), tag: 'TC', sub: snapshot?.tcActive ? 'ON' : undefined, active: Boolean(snapshot?.tcActive), color: snapshot?.tcActive ? GT3.blue : accent, icon: 'tc' }
    case 'map':
      return { value: snapshot?.engineMap !== undefined ? String(snapshot.engineMap) : '—', tag: 'MAP', color: accent, icon: 'map' }
    case 'bb':
      return { value: snapshot?.brakeBiasPct !== undefined ? snapshot.brakeBiasPct.toFixed(1) : '—', tag: 'BB', unit: '%', pct: clamp01(((snapshot?.brakeBiasPct ?? 50) - 45) / 15), color: accent, icon: 'bb' }
    case 'pitlimiter':
      return { value: fmtBool(snapshot?.pitLimiter, 'LIMIT', 'FREE'), tag: 'PIT', sub: snapshot?.onPitRoad ? 'LANE' : undefined, active: Boolean(snapshot?.pitLimiter), color: snapshot?.pitLimiter ? GT3.pitBlue : accent, icon: 'pit' }
    case 'incidents': {
      const count = snapshot?.incidentCount
      const limit = snapshot?.incidentLimit
      const warn = count !== undefined && limit !== undefined ? count >= limit - 4 : false
      return { value: count !== undefined ? String(count) : '—', tag: 'INC', sub: limit ? `/${limit}` : undefined, pct: limit ? clamp01((count ?? 0) / limit) : 0, color: warn ? GT3.red : (count ?? 0) > 0 ? GT3.amber : GT3.green, icon: 'inc' }
    }
    case 'clutch': {
      const clutch = clamp01(snapshot?.clutch ?? 0)
      return { value: `${Math.round(clutch * 100)}`, unit: '%', tag: 'CLT', pct: clutch, color: accent, icon: 'pedal' }
    }
    case 'drs':
      return { value: fmtBool(snapshot?.drs, 'OPEN', 'SHUT'), tag: 'DRS', active: Boolean(snapshot?.drs), color: snapshot?.drs ? GT3.green : accent, icon: 'drs' }
  }
}

function MetricWidget({ element, snapshot, unitSystem = 'metric', kind, variant }: WidgetProps & { kind: MetricKind; variant: VariantKind }): ReactElement {
  const s = element.style
  const skin = resolveElementSkin(s)
  const data = metricData(kind, snapshot, element, unitSystem)
  const elaborate = variant === 'elaborate'
  const W = Math.max(1, Math.round(element.w))
  const H = Math.max(1, Math.round(element.h))
  const pad = Math.max(6, Math.round(Math.min(W, H) * 0.06))
  const innerX = pad
  const innerY = pad
  const innerW = Math.max(1, W - pad * 2)
  const innerH = Math.max(1, H - pad * 2)

  const value = data.value
  const unit = data.unit ?? ''
  const hasBar = data.pct !== undefined
  // The abs / pit-limiter registry glyphs bake a hard-coded sub-10px <text> ("ABS"
  // /"PIT") into their 24-grid icon. The legibility linter reads the RAW font-size,
  // so no matter how large we draw the glyph that inner text stays 8/7px — and the
  // icon set is off-limits. Those two kinds therefore carry NO watermark glyph and
  // surface their assist tag through a first-class ≥11px FitText instead. Every other
  // kind keeps its registry / inline watermark (all path-only, fully legible).
  const unsafeGlyph = kind === 'abs' || kind === 'pitlimiter'

  const identity = (data.tag ?? KIND_TAG[kind] ?? kind.toUpperCase()).toString()
  const context = (s.reference ?? data.sub ?? '').toString()
  const hasContext = context.length > 0
  const hasLabel = identity.length > 0 || hasContext

  // Vertical bands: label (top) · value+unit (middle, dominant) · bar (bottom).
  const labelH = hasLabel ? Math.min(22, Math.max(12, innerH * 0.2)) : 0
  const barH = hasBar ? Math.min(16, Math.max(9, innerH * 0.14)) : 0
  const gapTop = hasLabel ? (innerH > 70 ? 4 : 2) : 0
  const gapBot = hasBar ? (innerH > 70 ? 4 : 2) : 0
  const valueY = innerY + labelH + gapTop
  const valueH = Math.max(16, innerH - labelH - barH - gapTop - gapBot)

  const valueOv = resolveSlotStyle(s, 'value', { color: data.color, fontFamily: kind === 'gear' ? gearFont(value) : readoutFont(value) })
  const headerOv = resolveSlotStyle(s, 'header', { color: data.tag ? data.color : GT3.textSecondary })
  const unitOv = resolveSlotStyle(s, 'unit', { color: GT3.textSecondary })
  const valueColor = valueOv.color ?? data.color
  const valueFont = valueOv.fontFamily ?? (kind === 'gear' ? gearFont(value) : readoutFont(value))
  const labelColor = headerOv.color ?? (data.tag ? data.color : GT3.textSecondary)
  const labelFont = headerOv.fontFamily ?? FONT_CONDENSED
  const labelMax = Math.max(11, Math.min(labelH, 18))

  return (
    <SvgRoot element={element} skin={skin} panel="auto" className={`gt3-curated gt3-curated-${variant}${data.active ? ' active' : ''}`}>
      {elaborate && !unsafeGlyph && (() => {
        const g = Math.round(Math.min(innerW, innerH) * (innerH > 108 ? 0.72 : 0.62))
        const gx = innerX + innerW - g * 0.9
        const gy = innerY + (innerH - g) / 2
        return (
          <g opacity={0.16}>
            <Slot x={gx} y={gy} w={g} h={g}>
              <GlyphIcon kind={data.icon} color={data.color} size={g} />
            </Slot>
          </g>
        )
      })()}
      {hasLabel && (
        <>
          <FitText
            x={innerX}
            y={innerY + labelH / 2}
            boxW={hasContext ? innerW * 0.56 : innerW}
            boxH={labelH}
            text={identity}
            fontFamily={labelFont}
            fill={labelColor}
            weight={700}
            minFontPx={11}
            maxFontPx={labelMax}
            anchor="start"
            baseline="central"
            letterSpacing={1}
          />
          {hasContext && (
            <FitText
              x={innerX + innerW}
              y={innerY + labelH / 2}
              boxW={innerW * 0.42}
              boxH={labelH}
              text={context}
              fontFamily={labelFont}
              fill={GT3.textSecondary}
              minFontPx={11}
              maxFontPx={labelMax}
              anchor="end"
              baseline="central"
            />
          )}
        </>
      )}
      <StatCell
        rect={{ x: innerX, y: valueY, w: innerW, h: valueH }}
        value={value}
        unit={unit || undefined}
        valueColor={valueColor}
        unitColor={unitOv.color ?? GT3.textSecondary}
        skin={skin}
        valueFont={valueFont}
        valueMaxPx={valueOv.fontSize}
        minPx={11}
      />
      {hasBar && (() => {
        const barY = innerY + innerH - barH
        const rad = Math.min(barH / 2, 6)
        return (
          <>
            <rect x={innerX} y={barY} width={innerW} height={barH} rx={rad} ry={rad} fill={skin.material.base} stroke={skin.material.border} strokeWidth={1} />
            <rect x={innerX} y={barY} width={Math.max(0, innerW * clamp01(data.pct ?? 0))} height={barH} rx={rad} ry={rad} fill={data.color} />
          </>
        )
      })()}
    </SvgRoot>
  )
}

function TyreShape({ corner, info, elaborate, cardH, style, element, unitSystem }: { corner: CornerKey; info: TyreInfo | undefined; elaborate: boolean; cardH: number; style: DashboardElement['style']; element?: DashboardElement; unitSystem: UnitSystem }): ReactElement {
  const temp = info?.tempC
  const press = info?.pressureKpa
  const wear = info?.wearPct
  const color = tyreTempColor(temp, style)
  const wearFill = clamp01(wear ?? 0)
  const tall = cardH > 64
  const tempSize = Math.max(16, Math.min(46, Math.round(cardH * (tall ? 0.42 : 0.6))))
  const showSub = cardH > 82
  const cornerOv = resolveSlotStyle(element?.style, 'label', { color })
  const subOv = resolveSlotStyle(element?.style, 'sub', {})
  return (
    <div className="gt3-tyre-card" style={styleVar('--tyre-color', color)}>
      <span className="gt3-corner-band" style={styleVar('--corner-color', color)} />
      {tall && (
        <svg viewBox="0 0 72 104" className="gt3-tyre-svg" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <rect x="17" y="5" width="38" height="94" rx="17" fill="rgba(0,0,0,.5)" stroke={color} strokeWidth="3" />
          {elaborate && Array.from({ length: 5 }, (_, i) => <path key={i} d={`M25 ${18 + i * 15}h22`} stroke="rgba(255,255,255,.16)" strokeWidth="4" strokeLinecap="round" />)}
          <rect x="17" y={5 + (1 - wearFill) * 94} width="38" height={wearFill * 94} rx="17" fill={color} opacity=".26" />
        </svg>
      )}
      <span className="gt3-tyre-corner" style={{ ...slotCss(cornerOv), color: cornerOv.color ?? color, fontSize: cornerOv.fontSize }}>{CORNER_LABEL[corner]}</span>
      <span className="gt3-tyre-temp" style={{ height: Math.round(cardH * 0.42) }}><Value element={element} color={color} size={tempSize} fill>{formatMeasurement(temp, 'temperature-c', unitSystem, { decimals: 0, includeUnit: true }).display}</Value></span>
      {showSub && <span className="gt3-tyre-sub" style={{ ...slotCss(subOv), color: subOv.color, fontSize: subOv.fontSize }}>{formatMeasurement(press, 'pressure-kpa', unitSystem, { decimals: 1 }).display}<i>·</i>{wear !== undefined ? `${Math.round(wear * 100)}%` : '—'}</span>}
    </div>
  )
}

export function TyresCurated({ element, snapshot, unitSystem = 'metric', variant }: WidgetProps & { variant: VariantKind }): ReactElement {
  const s = element.style
  const elaborate = variant === 'elaborate'
  const cardH = (element.h - 26) / 2
  return (
    <Shell element={element} chrome={panelChrome(s, { radius: s.radius ?? 14 })} padding={Math.max(6, element.h * 0.045)} className={`gt3-tyres-curated gt3-curated-${variant}`}>
      <WidgetHeader kind="tyre" color={s.accentColor ?? GT3.green} meta={s.reference ?? formatMeasurement(undefined, 'pressure-kpa', unitSystem).unit} element={element} />
      <div className="gt3-tyre-layout">
        {CORNER_ORDER.map((corner) => <TyreShape key={corner} corner={corner} info={snapshot?.tyres?.[corner]} elaborate={elaborate} cardH={cardH} style={s} element={element} unitSystem={unitSystem} />)}
      </div>
    </Shell>
  )
}

function relativeFallback(snapshot: TelemetrySnapshot | null, ahead: boolean): RelativeCarEntry | undefined {
  const drivers = snapshot?.drivers ?? []
  const sorted = drivers
    .filter((d) => !d.isPlayer && d.gapToPlayerSec !== undefined && (ahead ? d.gapToPlayerSec > 0 : d.gapToPlayerSec < 0))
    .sort((a, b) => ahead ? (a.gapToPlayerSec ?? 99) - (b.gapToPlayerSec ?? 99) : (b.gapToPlayerSec ?? -99) - (a.gapToPlayerSec ?? -99))
  const d = sorted[0]
  if (!d) return undefined
  return { carIdx: d.carIdx, name: d.name, carNumber: d.carNumber, position: d.position, classPosition: d.classPosition, gapSec: d.gapToPlayerSec, lastLapTimeSec: d.lastLapTimeSec, classColor: d.classColor }
}

type GapTrend = 'gain' | 'lose' | 'flat'

// Closing-rate tracker for the relatives rows. We derive Δgap/Δt entirely IN the
// widget — keeping the previous gap magnitude + timestamp in a per-row ref — so
// the shared telemetry provider stays untouched. `gain` means the separation is
// moving in the driver's favour: for the car AHEAD that is the gap SHRINKING
// (approaching), for the car BEHIND it is the gap GROWING (pulling away). A small
// deadband plus a state latch keeps the colour stable instead of flickering.
function useGapTrend(
  slot: 'ahead' | 'behind',
  car: RelativeCarEntry | undefined,
  snapshot: TelemetrySnapshot | null
): GapTrend {
  const ref = useRef<{ carIdx?: number; mag?: number; t?: number; state: GapTrend }>({ state: 'flat' })
  const st = ref.current
  const gap = car?.gapSec
  const t = snapshot?.timestamp
  if (car === undefined || gap === undefined || !Number.isFinite(gap) || t === undefined) {
    if (car === undefined) {
      st.carIdx = undefined
      st.mag = undefined
      st.t = undefined
      st.state = 'flat'
    }
    return st.state
  }
  // Same frame already processed (re-render / StrictMode double-invoke).
  if (st.t === t && st.carIdx === car.carIdx) return st.state
  const mag = Math.abs(gap)
  if (st.carIdx !== car.carIdx || st.mag === undefined || st.t === undefined) {
    // First sample for this car — establish a baseline, no trend yet.
    st.carIdx = car.carIdx
    st.mag = mag
    st.t = t
    return st.state
  }
  const dt = t - st.t
  st.carIdx = car.carIdx
  if (dt <= 0) {
    st.mag = mag
    st.t = t
    return st.state
  }
  const delta = mag - st.mag // + separation grew, − shrank
  st.mag = mag
  st.t = t
  const DEAD = 0.0008
  let trend: GapTrend
  if (slot === 'ahead') trend = delta < -DEAD ? 'gain' : delta > DEAD ? 'lose' : 'flat'
  else trend = delta > DEAD ? 'gain' : delta < -DEAD ? 'lose' : 'flat'
  if (trend !== 'flat') st.state = trend
  return st.state
}

function RelativeRow({ arrow, car, color, element }: { arrow: string; car?: RelativeCarEntry; color: string; element: DashboardElement }): ReactElement {
  const gap = car?.gapSec
  const gapText = gap === undefined ? '—' : `${gap > 0 ? '-' : '+'}${Math.abs(gap).toFixed(3)}`
  return (
    <div className="gt3-relative-row">
      <span className="gt3-rel-arrow" style={{ color }}>{arrow}</span>
      <Value element={element} size={fitFont(element, car?.name ?? '—', 0.18, 11, 22)} mono={false}>{car ? `${car.carNumber} ${car.name}` : '—'}</Value>
      <Value element={element} slot="gap" color={color} size={fitFont(element, gapText, 0.17, 11, 20)}>{gapText}</Value>
      <Label element={element}>{fmtTime(car?.lastLapTimeSec)}</Label>
    </div>
  )
}

export function RelativesCurated({ element, snapshot, variant }: WidgetProps & { variant: VariantKind }): ReactElement {
  const s = element.style
  const ahead = snapshot?.relatives?.ahead ?? relativeFallback(snapshot, true)
  const behind = snapshot?.relatives?.behind ?? relativeFallback(snapshot, false)
  // Approaching the car ahead → GREEN; pulling away from the car behind → GREEN.
  // A car behind that is catching you is the one threat worth a red accent.
  const aheadTrend = useGapTrend('ahead', ahead, snapshot)
  const behindTrend = useGapTrend('behind', behind, snapshot)
  const aheadColor = aheadTrend === 'gain' ? GT3.green : GT3.textSecondary
  const behindColor = behindTrend === 'gain' ? GT3.green : behindTrend === 'lose' ? GT3.red : GT3.textSecondary
  return (
    <Shell element={element} chrome={panelChrome(s, { radius: s.radius ?? 12 })} padding={8} className={`gt3-relatives gt3-curated-${variant}`}>
      <WidgetHeader kind="relatives" color={s.accentColor ?? GT3.amber} meta={s.reference} element={element} />
      <div className="gt3-relative-grid">
        <RelativeRow arrow="▲" car={ahead} color={aheadColor} element={element} />
        {variant === 'elaborate' && <div className="gt3-relative-player"><span /> YOU <span /></div>}
        <RelativeRow arrow="▼" car={behind} color={behindColor} element={element} />
      </div>
    </Shell>
  )
}

function radarFallback(snapshot: TelemetrySnapshot | null): RadarCarEntry[] {
  const speedMs = (snapshot?.speedKmh ?? 0) / 3.6
  return (snapshot?.drivers ?? []).filter((d) => !d.isPlayer && d.gapToPlayerSec !== undefined && Math.abs(d.gapToPlayerSec) < 3.5).map((d, i) => ({
    carIdx: d.carIdx,
    name: d.name,
    relativeX: i % 2 === 0 ? -3.2 : 3.2,
    relativeY: (d.gapToPlayerSec ?? 0) * Math.max(8, speedMs),
    gapSec: d.gapToPlayerSec,
    classColor: d.classColor
  }))
}

export function RadarCurated({ element, snapshot, variant }: WidgetProps & { variant: VariantKind }): ReactElement {
  const s = element.style
  const skin = resolveElementSkin(s)
  const W = Math.max(1, Math.round(element.w))
  const H = Math.max(1, Math.round(element.h))
  const cars = snapshot?.radarCars?.length ? snapshot.radarCars : radarFallback(snapshot)
  const rangeX = 10
  const rangeY = 35
  const accent = resolveCssColor(s.accentColor, GT3.cyan)
  const leftThreat = radarSideThreat(cars.filter((car) => car.relativeX < 0).map((car) => car.relativeY))
  const rightThreat = radarSideThreat(cars.filter((car) => car.relativeX > 0).map((car) => car.relativeY))
  const elaborate = variant === 'elaborate'
  // Everything is laid out in the tile's own pixel space (viewBox 0 0 W H), so the
  // corner threat labels are drawn with FitText at ≥11px design units instead of the
  // old 6px SvgSlotText that the legibility linter flagged.
  const labelH = Math.max(13, Math.min(20, H * 0.09))
  const cx = W / 2
  const cy = (H - labelH) / 2
  const ringR = Math.min(W, H - labelH) * 0.44
  const dot = (car: (typeof cars)[number]): { x: number; y: number; r: number; fill: string } => {
    const x = cx + Math.max(-1, Math.min(1, car.relativeX / rangeX)) * ringR * 0.9
    const y = cy - Math.max(-1, Math.min(1, car.relativeY / rangeY)) * ringR
    const threat = radarThreatLevel(car.relativeY)
    const danger = car.relativeX !== 0 && threat !== 'clear'
    return { x, y, r: danger ? ringR * 0.11 : ringR * 0.08, fill: danger ? radarThreatColor(car.relativeY) : (car.classColor ?? GT3.amber) }
  }
  const carW = ringR * 0.3
  const carHh = ringR * 0.22
  return (
    <SvgRoot element={element} skin={skin} panel="auto" className={`gt3-radar-curated gt3-curated-${variant}`}>
      <circle cx={cx} cy={cy} r={ringR} fill="none" stroke={GT3.panelStroke} strokeWidth={1} />
      {elaborate && <path d={`M${cx - ringR * 0.62} ${cy}h${ringR * 1.24}M${cx} ${cy - ringR}v${ringR * 2}`} stroke={GT3.panelStroke} strokeWidth={1} />}
      <path
        d={`M${cx - carW / 2} ${cy + carHh}h${carW}l${carW * 0.35} ${-carHh}l${-carW * 0.35} ${-carHh}h${-carW}l${-carW * 0.35} ${carHh}z`}
        fill={accent}
      />
      {cars.map((car) => {
        const d = dot(car)
        return <circle key={car.carIdx} cx={d.x} cy={d.y} r={d.r} fill={d.fill} />
      })}
      <FitText
        x={4}
        y={H - labelH / 2}
        boxW={W * 0.4}
        boxH={labelH}
        text={`L ${leftThreat === 'clear' ? 'CLEAR' : leftThreat.toUpperCase()}`}
        fontFamily={FONT_CONDENSED}
        fill={RADAR_THREAT_COLORS[leftThreat]}
        weight={900}
        minFontPx={11}
        maxFontPx={Math.max(11, Math.min(labelH, 16))}
        anchor="start"
        baseline="central"
      />
      <FitText
        x={W - 4}
        y={H - labelH / 2}
        boxW={W * 0.4}
        boxH={labelH}
        text={`R ${rightThreat === 'clear' ? 'CLEAR' : rightThreat.toUpperCase()}`}
        fontFamily={FONT_CONDENSED}
        fill={RADAR_THREAT_COLORS[rightThreat]}
        weight={900}
        minFontPx={11}
        maxFontPx={Math.max(11, Math.min(labelH, 16))}
        anchor="end"
        baseline="central"
      />
      {s.reference && (
        <FitText
          x={cx}
          y={H - labelH / 2}
          boxW={W * 0.24}
          boxH={labelH}
          text={s.reference.toString()}
          fontFamily={FONT_CONDENSED}
          fill={GT3.textMuted}
          weight={900}
          minFontPx={11}
          maxFontPx={Math.max(11, Math.min(labelH, 15))}
          anchor="middle"
          baseline="central"
        />
      )}
    </SvgRoot>
  )
}

export function TrackMapCurated({ element, snapshot, variant }: WidgetProps & { variant: VariantKind }): ReactElement {
  const s = element.style
  const trackData = useTrackMapData()
  const progress = pct(element.binding ?? 'lapDistPct', snapshot) || clamp01(snapshot?.lapDistPct ?? 0)
  const accent = resolveCssColor(s.accentColor, GT3.cyan)
  const chrome = panelChrome(s, { radius: s.radius ?? 14 })
  return (
    <Shell element={element} chrome={chrome} padding={6} className={`gt3-trackmap-curated gt3-curated-${variant}`}>
      <div className="gt3-trackmap-body">
        <TrackMapCanvas
          data={trackData}
          playerPct={progress}
          drivers={snapshot?.drivers}
          playerCarIdx={snapshot?.playerCarIdx}
          accent={accent}
          outlineColor={resolveCssColor(s.color, '#718091')}
          pitColor={resolveCssColor(s.warnColor, '#26313d')}
          startFinishColor={resolveCssColor(s.dangerColor, GT3.whiteFlash)}
          showProgress={variant === 'elaborate'}
          trackName={trackData?.trackName ?? snapshot?.trackName}
        />
      </div>
      {variant === 'elaborate' && <div className="gt3-trackmap-label"><Label element={element}>{trackData?.trackName ?? snapshot?.trackName ?? 'ACTIVE TRACK'}</Label></div>}
    </Shell>
  )
}

export function InputsCurated({ element, snapshot, variant }: WidgetProps & { variant: VariantKind }): ReactElement {
  const channels = element.style.channels ?? ['throttle', 'brake', 'clutch']
  return variant === 'clean'
    ? <InputBars element={{ ...element, style: { ...element.style, channels } }} snapshot={snapshot} />
    : <InputTrace element={{ ...element, style: { ...element.style, channels: [...channels, 'steering'], traceLength: element.style.traceLength ?? 220 } }} snapshot={snapshot} />
}

export function TempsCurated({ element, snapshot, unitSystem = 'metric', variant }: WidgetProps & { variant: VariantKind }): ReactElement {
  const s = element.style
  const values = [
    { label: 'WATER', value: snapshot?.waterTempC, hot: 108 },
    { label: 'OIL', value: snapshot?.oilTempC, hot: 120 },
    { label: 'OIL P', value: snapshot?.oilPressureKpa, hot: 0 }
  ]
  const tall = element.h > element.w * 1.05
  const valSize = tall
    ? Math.max(20, Math.min(38, Math.floor(element.w * 0.2)))
    : Math.max(16, Math.min(30, Math.floor(element.w * 0.085)))
  return (
    <Shell element={element} chrome={panelChrome(s, { radius: s.radius ?? 12 })} padding={8} className={`gt3-temps-curated gt3-curated-${variant}`}>
      <WidgetHeader kind="temp" color={s.accentColor ?? GT3.cyan} meta={s.reference} element={element} />
      <div className={tall ? 'gt3-temp-stack' : 'gt3-temp-row'}>
        {values.map((v) => {
          const color = v.value === undefined ? GT3.textMuted : v.hot && v.value >= v.hot ? GT3.amber : GT3.green
          const txt = v.label === 'OIL P'
            ? formatMeasurement(v.value, 'pressure-kpa', unitSystem, { decimals: 1, includeUnit: true }).display
            : formatMeasurement(v.value, 'temperature-c', unitSystem, { decimals: 0, includeUnit: true }).display
          return <div key={v.label} className="gt3-temp-card"><Label element={element}>{v.label}</Label><Value element={element} color={color} size={valSize}>{txt}</Value></div>
        })}
      </div>
    </Shell>
  )
}

// ── Generic clean channel widget ──────────────────────────────────────────────
// One bindable, minimal widget for any telemetry value: a tiny dim label, a big
// value and an optional small unit suffix on a flat-black face. `valuebar` adds
// a hairline progress track; `valuegauge` wraps the value in a 270° arc. All
// three obey the clean-black rule (no shadow / texture / gradient).
function ValueWidget({ element, snapshot, unitSystem = 'metric', mode }: WidgetProps & { mode: 'value' | 'bar' | 'gauge' }): ReactElement {
  const s = element.style
  const skin = resolveElementSkin(s)
  const W = Math.max(1, Math.round(element.w))
  const H = Math.max(1, Math.round(element.h))
  const r = resolveBinding(element.binding, snapshot, unitSystem)
  const body = applyDecimals(r.text && r.text.length ? r.text : '—', r.displayNumeric ?? r.numeric, s.decimals)
  const value = body === '—' ? '—' : `${s.prefix ?? ''}${body}`
  const label = (s.label ?? s.title ?? '').toString()
  const unit = (r.unit ?? s.suffix ?? '').toString()
  const rangeMin = s.gaugeMin
  const rangeMax = s.gaugeMax
  const rangedRatio =
    r.numeric !== undefined &&
    rangeMin !== undefined &&
    rangeMax !== undefined &&
    Number.isFinite(rangeMin) &&
    Number.isFinite(rangeMax) &&
    rangeMax > rangeMin
      ? (r.numeric - rangeMin) / (rangeMax - rangeMin)
      : undefined
  const ratio = clamp01(rangedRatio ?? r.pct ?? 0)
  const accent = resolveCssColor(s.accentColor, skin.palette.accent)
  const valueColor = resolveCssColor(s.color, skin.palette.text)
  // Content-aware VALUE font: numeric readouts render in DSEG (FONT_MONO),
  // textual/missing values ('—', words) in the condensed face. Never inherit the
  // root style fontFamily here — a catalog tile's "Segoe UI" must NOT override
  // DSEG, and DSEG must NOT be forced onto textual bindings. An explicit per-slot
  // value font (resolveSlotStyle below) still wins.
  const valueFont = readoutFont(value)
  const labelOv = resolveSlotStyle(s, 'label', { color: skin.palette.textDim })
  const valueOv = resolveSlotStyle(s, 'value', { color: valueColor, fontFamily: valueFont })
  const unitOv = resolveSlotStyle(s, 'unit', { color: skin.palette.textDim })
  const finalValueColor = valueOv.color ?? valueColor
  const finalValueFont = valueOv.fontFamily ?? valueFont
  const finalLabelColor = labelOv.color ?? skin.palette.textDim
  const finalUnitColor = unitOv.color ?? skin.palette.textDim
  const pad = Math.max(4, Math.round(Math.min(W, H) * 0.06))

  if (mode === 'gauge') {
    // Real analog dial: bezel + d3-arc track + damped Needle on a 0..100 sweep.
    // Tick labels + the dial's own centre value are switched OFF (they were the
    // source of the sub-legible tick micro-text); the value + unit + label are
    // redrawn as auto-fit SVG overlays that never drop below 11px.
    const dialSize = Math.max(48, Math.floor(Math.min(W, H)))
    const dialValue = (ratio || 0) * 100
    const dial = s.instrument?.parts?.dial
    const warnFrom = dial?.warnFrom ?? (s.warnAt !== undefined ? s.warnAt * 100 : undefined)
    const redlineFrom = dial?.redlineFrom ?? (s.dangerAt !== undefined ? s.dangerAt * 100 : undefined)
    const dialX = (W - dialSize) / 2
    const dialY = (H - dialSize) / 2
    const cx = dialX + dialSize / 2
    const cy = dialY + dialSize / 2
    const hasLabel = Boolean(label)
    const valBoxW = dialSize * 0.6
    const valBoxH = dialSize * 0.3
    return (
      <SvgRoot element={element} skin={skin} panel="none" className="gt3-valuewidget gt3-valuegauge">
        <Slot x={dialX} y={dialY} w={dialSize} h={dialSize}>
          <AnalogDial
            value={dialValue}
            min={0}
            max={100}
            size={dialSize}
            majorTicks={dial?.majorTicks ?? 9}
            minorPerMajor={dial?.minorPerMajor ?? 4}
            showValue={false}
            showTicks={false}
            bezel={instrumentBezel(s)}
            material={instrumentMaterial(s)}
            needleColor={s.instrument?.parts?.needle?.color ?? s.needleColor ?? accent}
            damp={dial?.damp ?? 0}
            warnFrom={warnFrom}
            redlineFrom={redlineFrom}
            colors={instrumentColorsFor(s)}
          />
        </Slot>
        <StatCell
          rect={{ x: cx - valBoxW / 2, y: cy - valBoxH * (hasLabel ? 0.62 : 0.5), w: valBoxW, h: valBoxH }}
          value={value}
          unit={unit || undefined}
          valueColor={finalValueColor}
          unitColor={finalUnitColor}
          skin={skin}
          valueFont={finalValueFont}
          valueMaxPx={valueOv.fontSize}
          minPx={11}
        />
        {hasLabel && (
          <FitText
            x={cx}
            y={cy + dialSize * 0.2}
            boxW={dialSize * 0.72}
            boxH={Math.max(12, dialSize * 0.12)}
            text={label}
            fontFamily={FONT_CONDENSED}
            fill={finalLabelColor}
            minFontPx={11}
            maxFontPx={Math.max(11, dialSize * 0.11)}
            anchor="middle"
            baseline="central"
          />
        )}
      </SvgRoot>
    )
  }

  // value + bar modes: optional label on top, a big auto-fit value (DSEG numerals
  // or condensed text) centred beneath it, with an optional skin-correct BarGraph
  // for the 'bar' mode. Everything is SVG so no glyph can clip its box.
  const isBar = mode === 'bar'
  const gridX = pad
  const gridY = pad
  const gridW = Math.max(1, W - pad * 2)
  const gridH = Math.max(1, H - pad * 2)
  const hasLabel = Boolean(label)
  const labelH = hasLabel ? Math.max(13, Math.min(gridH * 0.26, 22)) : 0
  const barH = isBar ? Math.max(6, Math.min(gridH * 0.18, 16)) : 0
  const barGap = isBar ? 6 : 0
  const cellY = gridY + labelH
  const cellH = Math.max(12, gridH - labelH - (isBar ? barH + barGap : 0))
  return (
    <SvgRoot element={element} skin={skin} panel="auto" className={`gt3-valuewidget gt3-value-${mode}`}>
      {hasLabel && (
        <FitText
          x={gridX + gridW / 2}
          y={gridY + labelH / 2}
          boxW={gridW}
          boxH={labelH}
          text={label}
          fontFamily={FONT_CONDENSED}
          fill={finalLabelColor}
          minFontPx={11}
          maxFontPx={Math.max(11, labelH)}
          anchor="middle"
          baseline="central"
        />
      )}
      <StatCell
        rect={{ x: gridX, y: cellY, w: gridW, h: cellH }}
        value={value}
        unit={unit || undefined}
        valueColor={finalValueColor}
        unitColor={finalUnitColor}
        skin={skin}
        valueFont={finalValueFont}
        valueMaxPx={valueOv.fontSize}
        minPx={11}
      />
      {isBar && (
        <BarGraph
          x={gridX}
          y={gridY + gridH - barH}
          width={gridW}
          height={barH}
          fraction={ratio}
          orientation="h"
          warnAt={s.warnAt}
          critAt={s.dangerAt}
          skin={skin}
        />
      )}
    </SvgRoot>
  )
}

function renderCurated(props: WidgetProps, type: string): ReactElement | null {
  const variant: VariantKind = type.endsWith('-elaborate') ? 'elaborate' : 'clean'
  const concept = type.replace(/-(clean|elaborate)$/, '')
  if (concept === 'tyres') return <TyresCurated {...props} variant={variant} />
  if (concept === 'relatives') return <RelativesCurated {...props} variant={variant} />
  if (concept === 'radar') return <RadarCurated {...props} variant={variant} />
  if (concept === 'trackmap') return <TrackMapCurated {...props} variant={variant} />
  if (concept === 'inputs') return <InputsCurated {...props} variant={variant} />
  if (concept === 'temps') return <TempsCurated {...props} variant={variant} />
  const metricKinds = ['speed', 'gear', 'rpm', 'delta', 'fuel', 'lap', 'position', 'flags', 'abs', 'tc', 'map', 'bb', 'pitlimiter', 'incidents', 'clutch', 'drs']
  if (metricKinds.includes(concept)) return <MetricWidget {...props} kind={concept as MetricKind} variant={variant} />
  return null
}

export const GT3_WIDGET_TYPES = [
  'shiftbar', 'gearcluster', 'tyregrid', 'brakegrid', 'cornerstack', 'fuelstint',
  'deltatile', 'laptiming', 'positiongaps', 'flagoverlay', 'inputbars', 'inputtrace',
  'steering', 'setupstrip', 'enginetemps', 'weather', 'trackmini',
  'tyres-clean', 'tyres-elaborate', 'abs-clean', 'abs-elaborate', 'tc-clean', 'tc-elaborate',
  'map-clean', 'map-elaborate', 'bb-clean', 'bb-elaborate', 'pitlimiter-clean', 'pitlimiter-elaborate',
  'incidents-clean', 'incidents-elaborate', 'relatives-clean', 'relatives-elaborate',
  'radar-clean', 'radar-elaborate', 'trackmap-clean', 'trackmap-elaborate',
  'speed-clean', 'speed-elaborate', 'gear-clean', 'gear-elaborate', 'rpm-clean', 'rpm-elaborate',
  'delta-clean', 'delta-elaborate', 'fuel-clean', 'fuel-elaborate', 'lap-clean', 'lap-elaborate',
  'position-clean', 'position-elaborate', 'flags-clean', 'flags-elaborate',
  'inputs-clean', 'inputs-elaborate', 'temps-clean', 'temps-elaborate', 'clutch-clean', 'clutch-elaborate',
  'drs-clean', 'drs-elaborate',
  'value', 'valuebar', 'valuegauge',
  ...EXTRA_WIDGET_TYPES,
  ...TELEMETRY_WIDGET_TYPES,
  ...FUTURISTIC_WIDGET_TYPES,
  ...MINIMAL_WIDGET_TYPES,
  ...PREDICTION_WIDGET_TYPES,
  ...COACH_ENGINEER_WIDGET_TYPES,
  ...COACH_HEATMAP_WIDGET_TYPES
] as const

export function renderGt3Widget(props: WidgetProps): ReactElement | null {
  switch (props.element.type) {
    case 'shiftbar': return <ShiftBar {...props} />
    case 'gearcluster': return <GearCluster {...props} />
    case 'tyregrid': return <TyreGrid {...props} />
    case 'brakegrid': return <BrakeGrid {...props} />
    case 'cornerstack': return <CornerStack {...props} />
    case 'fuelstint': return <FuelStint {...props} />
    case 'deltatile': return <DeltaTile {...props} />
    case 'laptiming': return <LapTiming {...props} />
    case 'positiongaps': return <PositionGaps {...props} />
    case 'flagoverlay': return <FlagOverlay {...props} />
    case 'inputbars': return <InputBars {...props} />
    case 'inputtrace': return <InputTrace {...props} />
    case 'steering': return <Steering {...props} />
    case 'setupstrip': return <SetupStrip {...props} />
    case 'enginetemps': return <EngineTemps {...props} />
    case 'weather': return <Weather {...props} />
    case 'trackmini': return <TrackMini {...props} />
    case 'value': return <ValueWidget {...props} mode="value" />
    case 'valuebar': return <ValueWidget {...props} mode="bar" />
    case 'valuegauge': return <ValueWidget {...props} mode="gauge" />
    default:
      return (
        renderExtraWidget(props) ??
        renderTelemetryWidget(props) ??
        renderFuturisticWidget(props) ??
        renderMinimalWidget(props) ??
        renderPredictionWidget(props) ??
        renderCoachHeatmapWidget(props) ??
        renderCoachEngineerWidget(props) ??
        renderCurated(props, props.element.type)
      )
  }
}
