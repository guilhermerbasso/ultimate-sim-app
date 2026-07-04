// Wave-16 general MINIMALIST widgets (v2.39 KIT) — clean thin lines, generous
// negative space, a HUD-palette feel. Every widget renders ONE root <svg> with a
// fixed viewBox + preserveAspectRatio and routes EVERY value/label through the
// skin-aware FitText primitive, so telemetry overflow is structurally impossible.
//
// This leaf also hosts the shared KIT consumer-helpers (WidgetFrame / FitValue /
// ValueUnit / hexAlpha) reused by the futuristic + prediction leaves — it imports
// only the skin/instrument KIT, the binding resolver, shared/dashboards helpers
// and the widget kit's instrument branches, never gt3-widgets (no import cycle).
//
// style.instrument opt-in keeps routing through the high-fidelity instrument
// primitives (DialInstrument / RevInstrument / SegmentInstrument / TileInstrument)
// exactly as before — only the base (no-instrument) look is the new KIT render.

import type { ReactElement, ReactNode } from 'react'
import type { DashboardElement } from '../../../../shared/dashboards'
import { applyDecimals, resolveSlotStyle } from '../../../../shared/dashboards'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { resolveBinding } from '../binding'
import { FitText, resolveElementSkin } from '../../skins'
import type { OverflowStrategy, SkinToken } from '../../skins'
import {
  GAUGE_START,
  GAUGE_SWEEP,
  accentOf,
  arcPath,
  clamp01,
  isFiniteNum,
  numFromBinding,
  usesInstrument,
  DialInstrument,
  RevInstrument,
  TileInstrument,
  SegmentInstrument,
  type NewWidgetProps
} from './new-widgets-kit'

function clampNum(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

// Append an 8-bit alpha to a #RRGGBB colour (leaves rgba()/named colours as-is).
export function hexAlpha(color: string, alpha: number): string {
  const a = Math.round(clamp01(alpha) * 255).toString(16).padStart(2, '0')
  return /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}${a}` : color
}

// ── Shared KIT frame + text primitives (reused across the wave-16 leaves) ──────

// The single root <svg> + panel surface every KIT widget draws into. `minimal`
// keeps a hairline accent border over lots of negative space (HUD feel);
// `futuristic` fills the material surface and (with a glowId) exposes an
// feGaussianBlur bloom filter the caller references on its accent geometry.
export function WidgetFrame({
  element,
  skin,
  variant,
  accent,
  glowId,
  children
}: {
  element: DashboardElement
  skin: SkinToken
  variant: 'minimal' | 'futuristic'
  accent: string
  glowId?: string
  children: ReactNode
}): ReactElement {
  const W = Math.max(1, element.w)
  const H = Math.max(1, element.h)
  const mat = skin.material
  const minimal = variant === 'minimal'
  const strokeW = minimal ? 1 : Math.max(1, mat.borderWidth)
  const stroke = minimal ? hexAlpha(accent, 0.34) : mat.border
  const surface = minimal ? (skin.id === 'hud' ? hexAlpha('#0B0E12', 0.32) : 'none') : mat.base
  const rad = clampNum(mat.radius, 0, Math.min(W, H) / 2)
  const blur = clampNum(Math.min(W, H) * 0.018, 0.6, 6)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" width="100%" height="100%" style={{ display: 'block' }}>
      {glowId ? (
        <defs>
          <filter id={glowId} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation={blur} result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      ) : null}
      <rect
        x={strokeW / 2}
        y={strokeW / 2}
        width={Math.max(0, W - strokeW)}
        height={Math.max(0, H - strokeW)}
        rx={rad}
        ry={rad}
        fill={surface}
        stroke={stroke}
        strokeWidth={strokeW}
      />
      {children}
    </svg>
  )
}

// Auto-fitting value text that honours the inspector's per-slot font overrides
// (style.slots[slot].{fontColor,fontSize,fontFamily,fontWeight}) via
// resolveSlotStyle. When a fontSize override is present it is rendered EXACTLY
// (min==max) so the editor's size control takes effect; otherwise the size
// auto-fits between the skin legibility floor and the cell height.
export function FitValue({
  element,
  slot = 'value',
  text,
  x,
  y,
  boxW,
  boxH,
  skin,
  fill,
  fontFamily,
  weight,
  anchor = 'middle',
  baseline = 'middle',
  overflowStrategy
}: {
  element: DashboardElement
  slot?: string
  text: string
  x: number
  y: number
  boxW: number
  boxH: number
  skin: SkinToken
  fill?: string
  fontFamily?: string
  weight?: number | string
  anchor?: 'start' | 'middle' | 'end'
  baseline?: 'auto' | 'middle' | 'central' | 'hanging' | 'text-after-edge' | 'text-before-edge'
  overflowStrategy?: OverflowStrategy
}): ReactElement | null {
  const ov = resolveSlotStyle(element.style, slot, {})
  const resolvedFill = ov.color ?? fill ?? skin.palette.text
  const resolvedFamily = ov.fontFamily ?? fontFamily ?? skin.typography.value
  const resolvedWeight = ov.fontWeight ?? weight
  const floor = Math.max(1, skin.typography.minFontPx)
  const hasSize = typeof ov.fontSize === 'number' && Number.isFinite(ov.fontSize) && ov.fontSize > 0
  const size = hasSize ? (ov.fontSize as number) : 0
  const bH = hasSize ? Math.max(boxH, size) : Math.max(1, boxH)
  const bW = hasSize ? Math.max(boxW, size * Math.max(1, text.length) * 0.62) : Math.max(1, boxW)
  const minF = hasSize ? size : floor
  const maxF = hasSize ? size : Math.max(floor, bH)
  return (
    <FitText
      x={x}
      y={y}
      boxW={bW}
      boxH={bH}
      text={text}
      fontFamily={resolvedFamily}
      fill={resolvedFill}
      minFontPx={minF}
      maxFontPx={maxF}
      weight={resolvedWeight}
      anchor={anchor}
      baseline={baseline}
      overflowStrategy={overflowStrategy}
    />
  )
}

// A value (slot-aware) plus an optional unit, laid out either in a row (unit to
// the right of the value) or stacked (unit under the value). Keeps the two from
// ever colliding by reserving a fixed sub-box for the unit.
export function ValueUnit({
  element,
  skin,
  x,
  y,
  w,
  h,
  text,
  unit,
  fill,
  weight = 700,
  family,
  layout = 'row',
  valueAnchor
}: {
  element: DashboardElement
  skin: SkinToken
  x: number
  y: number
  w: number
  h: number
  text: string
  unit?: string
  fill?: string
  weight?: number | string
  family?: string
  layout?: 'row' | 'stack'
  valueAnchor?: 'start' | 'middle' | 'end'
}): ReactElement {
  const hasUnit = Boolean(unit && unit.length)
  const unitFill = skin.palette.textDim
  const unitFamily = skin.typography.label
  const floor = Math.max(1, skin.typography.minFontPx)
  if (layout === 'stack') {
    const unitH = hasUnit ? clampNum(h * 0.26, 10, 22) : 0
    const uGap = hasUnit ? clampNum(h * 0.04, 0, 4) : 0
    const valH = Math.max(1, h - unitH - uGap)
    const anchor = valueAnchor ?? 'middle'
    const cx = anchor === 'start' ? x : anchor === 'end' ? x + w : x + w / 2
    return (
      <>
        <FitValue element={element} text={text} x={cx} y={y + valH / 2} boxW={w} boxH={valH} skin={skin} fill={fill} weight={weight} fontFamily={family} anchor={anchor} />
        {hasUnit ? (
          <FitText x={cx} y={y + valH + uGap + unitH / 2} boxW={w} boxH={unitH} text={unit as string} anchor={anchor} fontFamily={unitFamily} fill={unitFill} minFontPx={floor} maxFontPx={Math.max(floor, unitH)} weight={600} />
        ) : null}
      </>
    )
  }
  const unitW = hasUnit ? clampNum(w * 0.24, 16, 60) : 0
  const uGap = hasUnit ? clampNum(w * 0.03, 0, 6) : 0
  const valW = Math.max(1, w - unitW - uGap)
  const anchor = valueAnchor ?? 'start'
  const vx = anchor === 'end' ? x + valW : anchor === 'middle' ? x + valW / 2 : x
  const unitH = Math.max(1, h * 0.5)
  return (
    <>
      <FitValue element={element} text={text} x={vx} y={y + h / 2} boxW={valW} boxH={h} skin={skin} fill={fill} weight={weight} fontFamily={family} anchor={anchor} />
      {hasUnit ? (
        <FitText x={x + w} y={y + h * 0.6} boxW={unitW} boxH={unitH} text={unit as string} anchor="end" fontFamily={unitFamily} fill={unitFill} minFontPx={floor} maxFontPx={Math.max(floor, unitH)} weight={600} />
      ) : null}
    </>
  )
}

// A hairline caption (uppercased label) for the KIT widgets.
export function Caption({
  skin,
  x,
  y,
  w,
  h,
  text,
  fill,
  anchor = 'start'
}: {
  skin: SkinToken
  x: number
  y: number
  w: number
  h: number
  text: string
  fill?: string
  anchor?: 'start' | 'middle' | 'end'
}): ReactElement {
  return (
    <FitText
      x={anchor === 'end' ? x + w : anchor === 'middle' ? x + w / 2 : x}
      y={y + h / 2}
      boxW={w}
      boxH={h}
      text={text.toUpperCase()}
      anchor={anchor}
      fontFamily={skin.typography.label}
      fill={fill ?? skin.palette.textDim}
      minFontPx={Math.max(1, skin.typography.minFontPx)}
      maxFontPx={Math.max(skin.typography.minFontPx, h)}
      weight={600}
      letterSpacing={0.6}
      overflowStrategy="ellipsis"
    />
  )
}

// ── Channel resolution (unchanged data contract) ──────────────────────────────

function defaultMax(binding: string | undefined): number {
  switch (binding) {
    case 'speedKmh': return 320
    case 'speedMph': return 200
    case 'rpm': return 8200
    case 'waterTempC': return 130
    case 'oilTempC': return 150
    case 'oilPressureKpa': return 700
    case 'fuelLiters': return 120
    default: return 100
  }
}

interface ChannelValue { text: string; frac: number; bounded: boolean }

function channel(element: DashboardElement, snapshot: TelemetrySnapshot | null): ChannelValue {
  const s = element.style
  const r = resolveBinding(element.binding, snapshot)
  const body = applyDecimals(r.text && r.text.length ? r.text : '—', r.numeric, s.decimals)
  const text = body === '—' ? '—' : `${s.prefix ?? ''}${body}`
  if (s.gaugeMin !== undefined || s.gaugeMax !== undefined) {
    const min = s.gaugeMin ?? 0
    const max = s.gaugeMax ?? defaultMax(element.binding)
    const v = numFromBinding(element.binding, snapshot)
    return { text, frac: clamp01(((v ?? min) - min) / Math.max(1e-6, max - min)), bounded: true }
  }
  if (isFiniteNum(r.pct)) return { text, frac: clamp01(r.pct), bounded: true }
  return { text, frac: 0, bounded: false }
}

function dialParams(
  element: DashboardElement,
  snapshot: TelemetrySnapshot | null,
  frac: number,
  bounded: boolean
): { value: number; min: number; max: number; unit?: string } {
  const s = element.style
  if (s.gaugeMin !== undefined || s.gaugeMax !== undefined) {
    const min = s.gaugeMin ?? 0
    const max = s.gaugeMax ?? defaultMax(element.binding)
    const v = numFromBinding(element.binding, snapshot)
    return { value: v ?? NaN, min, max, unit: (s.suffix || undefined) as string | undefined }
  }
  if (bounded) return { value: frac * 100, min: 0, max: 100, unit: '%' }
  const v = numFromBinding(element.binding, snapshot)
  return { value: v ?? NaN, min: 0, max: defaultMax(element.binding), unit: (s.suffix || undefined) as string | undefined }
}

function str(v: unknown): string {
  return v === undefined || v === null ? '' : String(v)
}

// ═══════════════════════════════════════════════════════════════════════════
// Mono tile — hairline label, restrained value, thin foot fill
// ═══════════════════════════════════════════════════════════════════════════

function MonoTile({ element, snapshot }: NewWidgetProps): ReactElement {
  const s = element.style
  const { text, frac, bounded } = channel(element, snapshot)
  if (usesInstrument(element)) {
    return <TileInstrument element={element} value={text} label={s.label ? String(s.label) : undefined} />
  }
  const skin = resolveElementSkin(s)
  const accent = accentOf(s, skin.palette.accent)
  const W = element.w
  const H = element.h
  const pad = clampNum(Math.min(W, H) * 0.12, 8, 16)
  const label = str(s.label)
  const unit = str(s.suffix)
  const labelH = label ? clampNum(H * 0.2, 12, 26) : 0
  const footH = bounded ? 3 : 0
  const gap = 6
  const bandY = pad + (labelH ? labelH + gap : 0)
  const bandH = Math.max(12, H - pad - bandY - (footH ? footH + gap : 0))
  const innerW = Math.max(1, W - pad * 2)
  return (
    <WidgetFrame element={element} skin={skin} variant="minimal" accent={accent}>
      {label ? <Caption skin={skin} x={pad} y={pad} w={innerW} h={labelH} text={label} /> : null}
      <ValueUnit element={element} skin={skin} x={pad} y={bandY} w={innerW} h={bandH} text={text} unit={unit || undefined} fill={skin.palette.text} weight={600} valueAnchor="start" />
      {bounded ? (
        <>
          <rect x={pad} y={H - pad - footH} width={innerW} height={footH} rx={footH / 2} fill={hexAlpha(skin.palette.textDim, 0.25)} />
          {frac > 0 ? <rect x={pad} y={H - pad - footH} width={innerW * frac} height={footH} rx={footH / 2} fill={accent} /> : null}
        </>
      ) : null}
    </WidgetFrame>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Typographic readout — oversized centred value, hairline rule, tiny caption
// ═══════════════════════════════════════════════════════════════════════════

function TypoReadout({ element, snapshot }: NewWidgetProps): ReactElement {
  const s = element.style
  const { text } = channel(element, snapshot)
  if (usesInstrument(element)) {
    return <SegmentInstrument element={element} value={text} label={s.label ? String(s.label) : undefined} unit={s.suffix ? String(s.suffix) : undefined} />
  }
  const skin = resolveElementSkin(s)
  const accent = accentOf(s, skin.palette.accent)
  const W = element.w
  const H = element.h
  const pad = clampNum(Math.min(W, H) * 0.1, 8, 16)
  const label = str(s.label)
  const unit = str(s.suffix)
  const labelH = label ? clampNum(H * 0.16, 11, 22) : 0
  const ruleGap = 6
  const innerW = Math.max(1, W - pad * 2)
  const valueH = Math.max(12, H - pad * 2 - (labelH ? labelH + ruleGap : 0) - ruleGap)
  const ruleY = pad + valueH + ruleGap / 2
  return (
    <WidgetFrame element={element} skin={skin} variant="minimal" accent={accent}>
      <ValueUnit element={element} skin={skin} x={pad} y={pad} w={innerW} h={valueH} text={text} unit={unit || undefined} fill={skin.palette.text} weight={300} layout="stack" valueAnchor="middle" />
      <rect x={W / 2 - innerW * 0.19} y={ruleY} width={innerW * 0.38} height={1} fill={hexAlpha(accent, 0.5)} />
      {label ? <Caption skin={skin} x={pad} y={H - pad - labelH} w={innerW} h={labelH} text={label} anchor="middle" /> : null}
    </WidgetFrame>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Hairline bar — label + value on a row over an ultra-thin track
// ═══════════════════════════════════════════════════════════════════════════

function HairlineBar({ element, snapshot }: NewWidgetProps): ReactElement {
  const s = element.style
  const { text, frac } = channel(element, snapshot)
  if (usesInstrument(element)) {
    return <RevInstrument element={element} frac={frac} />
  }
  const skin = resolveElementSkin(s)
  const accent = accentOf(s, skin.palette.accent)
  const W = element.w
  const H = element.h
  const pad = clampNum(Math.min(W, H) * 0.12, 8, 16)
  const label = str(s.label)
  const unit = str(s.suffix)
  const innerW = Math.max(1, W - pad * 2)
  const trackH = 2
  const rowH = Math.max(12, H - pad * 2 - trackH - 10)
  const trackY = H - pad - trackH
  const halfW = innerW * 0.5
  return (
    <WidgetFrame element={element} skin={skin} variant="minimal" accent={accent}>
      {label ? <Caption skin={skin} x={pad} y={pad + rowH * 0.12} w={halfW} h={rowH * 0.6} text={label} /> : null}
      <ValueUnit element={element} skin={skin} x={pad + halfW} y={pad} w={halfW} h={rowH} text={text} unit={unit || undefined} fill={skin.palette.text} weight={600} valueAnchor="end" />
      <rect x={pad} y={trackY} width={innerW} height={trackH} rx={trackH / 2} fill={hexAlpha(skin.palette.textDim, 0.25)} />
      {frac > 0 ? <rect x={pad} y={trackY} width={innerW * frac} height={trackH} rx={trackH / 2} fill={accent} /> : null}
    </WidgetFrame>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Dot gauge — a row of hairline ticks filled to the value
// ═══════════════════════════════════════════════════════════════════════════

function DotGauge({ element, snapshot }: NewWidgetProps): ReactElement {
  const s = element.style
  const { text, frac } = channel(element, snapshot)
  if (usesInstrument(element)) {
    return <RevInstrument element={element} frac={frac} />
  }
  const skin = resolveElementSkin(s)
  const accent = accentOf(s, skin.palette.accent)
  const W = element.w
  const H = element.h
  const pad = clampNum(Math.min(W, H) * 0.12, 8, 16)
  const label = str(s.label)
  const dots = Math.max(5, Math.min(40, s.segments ?? 20))
  const lit = Math.round(frac * dots)
  const innerW = Math.max(1, W - pad * 2)
  const rowH = Math.max(12, H - pad * 2 - 14)
  const ticksY = H - pad - 8
  const ticksH = 6
  const gap = clampNum(innerW * 0.01, 1.5, 3)
  const cellW = Math.max(1, (innerW - gap * (dots - 1)) / dots)
  const halfW = innerW * 0.5
  return (
    <WidgetFrame element={element} skin={skin} variant="minimal" accent={accent}>
      {label ? <Caption skin={skin} x={pad} y={pad + rowH * 0.12} w={halfW} h={rowH * 0.6} text={label} /> : null}
      <ValueUnit element={element} skin={skin} x={pad + halfW} y={pad} w={halfW} h={rowH} text={text} fill={skin.palette.text} weight={600} valueAnchor="end" />
      {Array.from({ length: dots }, (_, i) => (
        <rect
          key={i}
          x={pad + i * (cellW + gap)}
          y={ticksY}
          width={cellW}
          height={ticksH}
          rx={1}
          fill={i < lit ? accent : hexAlpha(skin.palette.textDim, 0.22)}
        />
      ))}
    </WidgetFrame>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Stacked readout — a small label over a big restrained value
// ═══════════════════════════════════════════════════════════════════════════

function StackedReadout({ element, snapshot }: NewWidgetProps): ReactElement {
  const s = element.style
  const { text } = channel(element, snapshot)
  if (usesInstrument(element)) {
    return <TileInstrument element={element} value={text} label={s.label ? String(s.label) : undefined} />
  }
  const skin = resolveElementSkin(s)
  const accent = accentOf(s, skin.palette.accent)
  const W = element.w
  const H = element.h
  const pad = clampNum(Math.min(W, H) * 0.12, 8, 16)
  const label = str(s.label)
  const unit = str(s.suffix)
  const align = s.align ?? 'left'
  const anchor: 'start' | 'middle' | 'end' = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start'
  const innerW = Math.max(1, W - pad * 2)
  const labelH = label ? clampNum(H * 0.18, 11, 24) : 0
  const gap = 4
  const valueY = pad + (labelH ? labelH + gap : 0)
  const valueH = Math.max(12, H - pad - valueY)
  return (
    <WidgetFrame element={element} skin={skin} variant="minimal" accent={accent}>
      {label ? <Caption skin={skin} x={pad} y={pad} w={innerW} h={labelH} text={label} anchor={anchor} fill={hexAlpha(accent, 0.85)} /> : null}
      <ValueUnit element={element} skin={skin} x={pad} y={valueY} w={innerW} h={valueH} text={text} unit={unit || undefined} fill={skin.palette.text} weight={700} valueAnchor={anchor} />
    </WidgetFrame>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Minimal arc — thin 270° ring with a centred value
// ═══════════════════════════════════════════════════════════════════════════

function MinimalArc({ element, snapshot }: NewWidgetProps): ReactElement {
  const s = element.style
  const { text, frac, bounded } = channel(element, snapshot)
  if (usesInstrument(element)) {
    const d = dialParams(element, snapshot, frac, bounded)
    return <DialInstrument element={element} value={d.value} min={d.min} max={d.max} unit={d.unit} label={s.label ? String(s.label) : undefined} />
  }
  const skin = resolveElementSkin(s)
  const accent = accentOf(s, skin.palette.accent)
  const W = element.w
  const H = element.h
  const label = str(s.label)
  const unit = str(s.suffix)
  const cx = W / 2
  const cy = H / 2 + clampNum(H * 0.04, 0, 8)
  const r = Math.max(6, Math.min(W, H) / 2 - clampNum(Math.min(W, H) * 0.1, 6, 16))
  const thickness = clampNum(r * 0.09, 2, 5)
  const endDeg = GAUGE_START + frac * GAUGE_SWEEP
  const valBoxW = r * 1.4
  const valBoxH = r * 0.8
  const labelH = label ? clampNum(r * 0.28, 9, 16) : 0
  return (
    <WidgetFrame element={element} skin={skin} variant="minimal" accent={accent}>
      <path d={arcPath(cx, cy, r, GAUGE_START, GAUGE_START + GAUGE_SWEEP)} fill="none" stroke={hexAlpha(skin.palette.textDim, 0.28)} strokeWidth={thickness} strokeLinecap="round" />
      {frac > 0 ? <path d={arcPath(cx, cy, r, GAUGE_START, endDeg)} fill="none" stroke={accent} strokeWidth={thickness} strokeLinecap="round" /> : null}
      {label ? <Caption skin={skin} x={cx - valBoxW / 2} y={cy - r + clampNum(r * 0.14, 2, 10)} w={valBoxW} h={labelH} text={label} anchor="middle" /> : null}
      <ValueUnit element={element} skin={skin} x={cx - valBoxW / 2} y={cy - valBoxH / 2} w={valBoxW} h={valBoxH} text={text} unit={unit || undefined} fill={skin.palette.text} weight={500} layout="stack" valueAnchor="middle" />
    </WidgetFrame>
  )
}

// ── Registry + dispatch ──────────────────────────────────────────────────────
export const MINIMAL_WIDGET_TYPES = [
  'mono-tile-minimal',
  'typo-readout-minimal',
  'hairline-bar-minimal',
  'dot-gauge-minimal',
  'stacked-readout-minimal',
  'arc-minimal'
] as const

export function renderMinimalWidget(props: { element: DashboardElement; snapshot: TelemetrySnapshot | null }): ReactElement | null {
  switch (props.element.type) {
    case 'mono-tile-minimal': return <MonoTile {...props} />
    case 'typo-readout-minimal': return <TypoReadout {...props} />
    case 'hairline-bar-minimal': return <HairlineBar {...props} />
    case 'dot-gauge-minimal': return <DotGauge {...props} />
    case 'stacked-readout-minimal': return <StackedReadout {...props} />
    case 'arc-minimal': return <MinimalArc {...props} />
    default: return null
  }
}
