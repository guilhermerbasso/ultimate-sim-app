// Round-7 extra dashboard/overlay widgets — varied visual styles (analog dials,
// 7-segment digitals, rolling graphs, bar/radial/donut charts, rings, LED bars,
// heatmaps and status lamps). Every widget is GENERIC + bindable to real
// telemetry and renders as a self-contained SVG/CSS React component.
//
// This module is intentionally LEAF-LEVEL: it imports only the pure theme/format
// helpers (gt3-theme) and the binding resolver (binding) — never gt3-widgets —
// so `gt3-widgets.tsx` can import `renderExtraWidget` for dispatch without an
// import cycle. Positioning replicates the GT3 `Shell` contract (an absolutely
// positioned `.dash-element.gt3-widget` box) so previews match production.

import { useRef } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { DashboardElement } from '../../../../shared/dashboards'
import { applyDecimals, resolveSlotStyle } from '../../../../shared/dashboards'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { getActiveFlag, resolveBinding } from '../binding'
import {
  DialInstrument,
  RevInstrument,
  SegmentInstrument,
  TelltaleInstrument,
  TileInstrument,
  usesInstrument
} from './new-widgets-kit'
import type { TelltaleLamp } from '../../instruments'
import {
  CORNER_LABEL,
  CORNER_ORDER,
  GT3,
  brakeCorner,
  brakeTempColor,
  readoutFont,
  tyreCorner,
  tyreTempColor,
  wearColor,
  type CornerKey
} from './gt3-theme'
import {
  FitText,
  makeGrid,
  resolveElementSkin,
  zoneColor,
  type OverflowStrategy,
  type SkinToken
} from '../../skins'

export interface ExtraWidgetProps {
  element: DashboardElement
  snapshot: TelemetrySnapshot | null
}

// Neutral chrome accent used by the tyre-pressure chart bars — kept as a literal
// so `chartBars` stays a pure style→bars function without a skin token in scope.
const CHROME = '#C9C5BC'

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(1, Math.max(0, v))
}

function clamp(lo: number, hi: number, v: number): number {
  return Math.min(hi, Math.max(lo, v))
}

// Like the finite checks the binding helpers use: any non-finite input (NaN,
// ±Infinity, null/undefined) collapses to 0 so it never reaches SVG geometry.
function finiteOr0(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function num(binding: string | undefined, snap: TelemetrySnapshot | null): number | undefined {
  const r = resolveBinding(binding, snap)
  if (typeof r.numeric === 'number' && Number.isFinite(r.numeric)) return r.numeric
  if (typeof r.pct === 'number' && Number.isFinite(r.pct)) return r.pct
  const f = Number.parseFloat(r.text)
  return Number.isFinite(f) ? f : undefined
}

// Accent = user override, else the resolved skin accent token (gt3 cyan / hud accent).
function accentOf(style: DashboardElement['style'], skin: SkinToken): string {
  return style.accentColor ?? skin.palette.accent
}

// Threshold ramp using skin tokens: white flash → crit → warn → base accent.
function rampToken(frac: number, s: DashboardElement['style'], skin: SkinToken, base: string): string {
  const p = clamp01(frac)
  if (s.flashAt !== undefined && p >= s.flashAt) return skin.palette.text
  if (s.dangerAt !== undefined && p >= s.dangerAt) return skin.palette.crit
  if (s.warnAt !== undefined && p >= s.warnAt) return skin.palette.warn
  return base
}

// Value typeface: real segmented DSEG for numeric GT3 readouts (condensed for
// alpha), the hud display face otherwise. Labels always use the skin label token.
function valueFont(text: string, skin: SkinToken): string {
  return skin.id === 'hud' ? skin.typography.value : readoutFont(text)
}

// A DSEG numeric readout's unit must render in a NORMAL condensed face (never the
// 7/14-segment face, which garbles letters). Explicit `style.suffix` wins;
// otherwise well-known speed bindings derive their unit. Empty ⇒ no unit.
function readoutUnit(style: DashboardElement['style'], binding: string | undefined): string {
  if (style.suffix !== undefined && style.suffix !== '') return String(style.suffix)
  if (binding === 'speedKmh') return 'km/h'
  if (binding === 'speedMph') return 'mph'
  return ''
}

function parsePx(v: string | undefined): number | undefined {
  if (!v) return undefined
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : undefined
}

function dims(element: DashboardElement): { W: number; H: number } {
  return { W: Math.max(1, element.w || 1), H: Math.max(1, element.h || 1) }
}

// Chromium reports an SVG <text> bounding box as the full font line-box, whose
// ascent (~0.85·F) sits above and descent (~0.65·F) below the middle-baseline
// anchor. The overflow linter measures every <text> rect against the element
// box, so a value/label centred near an edge escapes. `vSafeFont` caps the font
// so the line-box stays within [0,H] (≈1px inset) for text centred at `yc`.
const TXT_ASC = 0.9
const TXT_DESC = 0.7
function vSafeFont(yc: number, H: number, want: number): number {
  return Math.max(1, Math.min(want, (yc - 1) / TXT_ASC, (H - 1 - yc) / TXT_DESC))
}

// ── One-root-SVG frame ───────────────────────────────────────────────────────
// Positioned `.dash-element` wrapper (mirrors the GT3 Shell contract) holding a
// SINGLE root <svg> whose viewBox is the element's px size, so 1 user unit ≈ 1px
// and every FitText font-size attribute is measured in real pixels by the linter
// (this is what kills the "tiny_text" false-positives from the old 0-100 viewBox).
function WFrame({ element, skin, className, panel = true, children }: {
  element: DashboardElement
  skin: SkinToken
  className?: string
  panel?: boolean
  children: (ctx: { W: number; H: number; skin: SkinToken }) => ReactNode
}): ReactElement {
  const st = element.style
  const { W, H } = dims(element)
  const bw = st.borderWidth ?? skin.material.borderWidth
  const drawPanel = panel && st.background !== 'transparent'
  const inset = Math.max(0.5, bw / 2)
  return (
    <div
      className={`dash-element gt3-widget gt3-extra ${className ?? ''}`}
      style={{
        left: element.x,
        top: element.y,
        width: W,
        height: H,
        ...(st.opacity !== undefined ? { opacity: st.opacity } : {})
      }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" width="100%" height="100%" style={{ display: 'block' }}>
        {drawPanel && (
          <rect
            x={inset}
            y={inset}
            width={Math.max(0, W - inset * 2)}
            height={Math.max(0, H - inset * 2)}
            rx={st.radius ?? skin.material.radius}
            fill={st.background ?? skin.material.base}
            stroke={bw > 0 ? st.border ?? skin.material.border : 'none'}
            strokeWidth={bw}
          />
        )}
        {children({ W, H, skin })}
      </svg>
    </div>
  )
}

// Auto-fitting SVG text that honours a resolved font slot (family/size/colour/
// weight/letterSpacing). `size` becomes maxFontPx so an explicit slot size is
// respected; minFontPx (default 11) keeps every string above the linter's
// tiny-text floor. An explicit slot size inflates the fit box height so the
// server-rendered attribute equals the requested px exactly (editor round-trip).
function SlotFit({
  element,
  slot,
  x,
  y,
  boxW,
  boxH,
  text,
  family,
  size,
  color,
  weight,
  anchor = 'middle',
  baseline = 'middle',
  minFontPx = 11,
  letterSpacing,
  overflowStrategy
}: {
  element: DashboardElement
  slot: string
  x: number
  y: number
  boxW: number
  boxH: number
  text: string
  family: string
  size: number
  color: string
  weight?: number | string
  anchor?: 'start' | 'middle' | 'end'
  baseline?: 'auto' | 'middle' | 'central' | 'hanging' | 'text-after-edge' | 'text-before-edge'
  minFontPx?: number
  letterSpacing?: number
  overflowStrategy?: OverflowStrategy
}): ReactElement | null {
  const ov = resolveSlotStyle(element.style, slot, { fontFamily: family, fontSize: size, color })
  const maxFontPx = ov.fontSize ?? size
  const boxHfit = ov.fontSize !== undefined && ov.fontSize > boxH ? ov.fontSize : boxH
  const ls = parsePx(ov.letterSpacing) ?? letterSpacing
  return (
    <FitText
      x={x}
      y={y}
      boxW={boxW}
      boxH={boxHfit}
      text={text}
      fontFamily={ov.fontFamily ?? family}
      fill={ov.color ?? color}
      weight={ov.fontWeight ?? weight}
      minFontPx={minFontPx}
      maxFontPx={maxFontPx}
      anchor={anchor}
      baseline={baseline}
      letterSpacing={ls}
      overflowStrategy={overflowStrategy}
    />
  )
}

// ── geometry helpers (deg: 0 = up / 12 o'clock, clockwise positive) ──────────
function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) }
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  if (endDeg <= startDeg) return ''
  const s = polar(cx, cy, r, startDeg)
  const e = polar(cx, cy, r, endDeg)
  const large = endDeg - startDeg > 180 ? 1 : 0
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`
}

const GAUGE_START = -135
const GAUGE_SWEEP = 270

// ── Rolling history buffer (per mounted instance) ────────────────────────────
function useHistory(element: DashboardElement, snapshot: TelemetrySnapshot | null, value: number | undefined): number[] {
  const len = Math.max(16, Math.min(2048, element.style.traceLength ?? 160))
  const ref = useRef<number[]>([])
  const lastTs = useRef<number>(-1)
  if (snapshot && snapshot.timestamp !== lastTs.current) {
    lastTs.current = snapshot.timestamp
    ref.current.push(value ?? ref.current[ref.current.length - 1] ?? 0)
    if (ref.current.length > len) ref.current.splice(0, ref.current.length - len)
  }
  return ref.current
}

// A smooth faux series so graph widgets never look empty in previews / before the
// live buffer fills (cosmetic only; replaced by real samples within a few frames).
function fauxSeries(frac: number, n = 28): number[] {
  const base = clamp01(frac)
  return Array.from({ length: n }, (_, i) => clamp01(base * (0.55 + 0.45 * Math.sin((i / n) * Math.PI * 2.2 + base * 3))))
}

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

// ═══════════════════════════════════════════════════════════════════════════
// ANALOG
// ═══════════════════════════════════════════════════════════════════════════

export function AnalogGauge({ element, snapshot }: ExtraWidgetProps): ReactElement {
  const s = element.style
  const value = num(element.binding, snapshot)
  const min = s.gaugeMin ?? 0
  const max = s.gaugeMax ?? defaultMax(element.binding)
  if (usesInstrument(element)) {
    return <DialInstrument element={element} value={value} min={min} max={max} unit={(s.suffix || undefined) as string | undefined} label={s.label ? String(s.label) : undefined} />
  }
  const skin = resolveElementSkin(s)
  const frac = clamp01(((value ?? min) - min) / Math.max(1e-6, max - min))
  const base = accentOf(s, skin)
  const color = rampToken(frac, s, skin, base)
  const ticks = Math.max(2, Math.min(16, s.ticks ?? 8))
  const endDeg = GAUGE_START + frac * GAUGE_SWEEP
  const unit = (s.suffix ?? '').toString()
  const valueText = value === undefined ? '—' : Math.abs(max) >= 100 || Math.abs(value) >= 10 ? Math.round(value).toString() : value.toFixed(1)
  return (
    <WFrame element={element} skin={skin} className="gt3-analoggauge">
      {({ W, H }) => {
        const labelH = s.label ? Math.min(20, H * 0.15) : 0
        const cx = W / 2
        const top = labelH + 4
        const dialH = Math.max(1, H - top - 6)
        const r = Math.max(6, Math.min(W * 0.44, dialH * 0.5))
        const cy = top + dialH * 0.5
        const stroke = Math.max(3, r * 0.14)
        const needle = polar(cx, cy, r * 0.8, endDeg)
        const valH = Math.max(12, r * 0.62)
        return (
          <>
            <path d={arcPath(cx, cy, r, GAUGE_START, GAUGE_START + GAUGE_SWEEP)} fill="none" stroke={skin.material.border} strokeWidth={stroke} strokeLinecap="round" />
            {arcPath(cx, cy, r, GAUGE_START, endDeg) && (
              <path d={arcPath(cx, cy, r, GAUGE_START, endDeg)} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" />
            )}
            {Array.from({ length: ticks + 1 }, (_, i) => {
              const a = GAUGE_START + (i / ticks) * GAUGE_SWEEP
              const o = polar(cx, cy, r - stroke - 1, a)
              const inn = polar(cx, cy, r - stroke - r * 0.12, a)
              return <line key={i} x1={o.x} y1={o.y} x2={inn.x} y2={inn.y} stroke={skin.palette.textDim} strokeWidth={Math.max(1, r * 0.035)} />
            })}
            <line x1={cx} y1={cy} x2={needle.x} y2={needle.y} stroke={s.needleColor ?? skin.palette.text} strokeWidth={Math.max(1.5, r * 0.06)} strokeLinecap="round" />
            <circle cx={cx} cy={cy} r={Math.max(2.5, r * 0.1)} fill={s.needleColor ?? skin.palette.text} />
            <SlotFit element={element} slot="value" x={cx} y={cy + r * 0.05} boxW={r * 1.3} boxH={valH} text={valueText} family={valueFont(valueText, skin)} size={valH} color={color} />
            {unit && (
              <SlotFit element={element} slot="unit" x={cx} y={cy + r * 0.05 + valH * 0.66} boxW={r * 1.2} boxH={Math.max(9, r * 0.22)} text={unit.toUpperCase()} family={skin.typography.label} size={Math.max(11, r * 0.2)} color={skin.palette.textDim} letterSpacing={0.5} />
            )}
            {s.label && (
              <SlotFit element={element} slot="label" x={cx} y={top - labelH * 0.5} boxW={W * 0.86} boxH={Math.max(11, labelH)} text={String(s.label).toUpperCase()} family={skin.typography.label} size={vSafeFont(top - labelH * 0.5, H, Math.max(11, labelH))} color={skin.palette.textDim} weight={600} letterSpacing={0.6} />
            )}
          </>
        )
      }}
    </WFrame>
  )
}

export function LinearMeter({ element, snapshot }: ExtraWidgetProps): ReactElement {
  const s = element.style
  const value = num(element.binding, snapshot)
  const min = s.gaugeMin ?? 0
  const max = s.gaugeMax ?? defaultMax(element.binding)
  const frac = clamp01(((value ?? min) - min) / Math.max(1e-6, max - min))
  if (usesInstrument(element)) {
    return <RevInstrument element={element} frac={frac} />
  }
  const skin = resolveElementSkin(s)
  const color = rampToken(frac, s, skin, accentOf(s, skin))
  const ticks = Math.max(2, Math.min(20, s.ticks ?? 10))
  const unit = (s.suffix ?? '').toString()
  const valueText = value === undefined ? '—' : Math.abs(value) >= 10 ? Math.round(value).toString() : value.toFixed(1)
  const readout = unit ? `${valueText} ${unit}` : valueText
  return (
    <WFrame element={element} skin={skin} className="gt3-linearmeter">
      {({ W, H }) => {
        const pad = Math.max(6, Math.min(W, H) * 0.08)
        const headH = Math.max(12, Math.min(26, H * 0.32))
        const hasLabel = Boolean(s.label)
        const trackW = W - pad * 2
        const th = Math.max(6, Math.min(12, H * 0.1))
        const trackY = pad + headH + Math.max(4, (H - pad * 2 - headH - th) / 2)
        return (
          <>
            {hasLabel && (
              <SlotFit element={element} slot="label" x={pad} y={pad + headH / 2} boxW={trackW * 0.5} boxH={headH} text={String(s.label).toUpperCase()} family={skin.typography.label} size={headH * 0.82} color={skin.palette.textDim} weight={600} anchor="start" letterSpacing={0.6} />
            )}
            <SlotFit element={element} slot="value" x={W - pad} y={pad + headH / 2} boxW={hasLabel ? trackW * 0.46 : trackW} boxH={headH} text={readout} family={valueFont(valueText, skin)} size={headH} color={color} anchor="end" />
            <rect x={pad} y={trackY} width={trackW} height={th} rx={th / 2} fill={skin.material.base} stroke={skin.material.border} strokeWidth={1} />
            {frac > 0 && <rect x={pad} y={trackY} width={trackW * frac} height={th} rx={th / 2} fill={color} />}
            {Array.from({ length: ticks + 1 }, (_, i) => {
              const tx = pad + (i / ticks) * trackW
              return <line key={i} x1={tx} y1={trackY} x2={tx} y2={trackY + th} stroke={skin.palette.bg} strokeWidth={0.8} opacity={0.6} />
            })}
            <path d={`M ${pad + frac * trackW} ${trackY - 1} l -3.5 -5 l 7 0 z`} fill={s.needleColor ?? skin.palette.text} />
          </>
        )
      }}
    </WFrame>
  )
}

export function GForceMeter({ element, snapshot }: ExtraWidgetProps): ReactElement {
  const s = element.style
  const maxG = Math.max(1e-6, s.gaugeMax ?? 2)
  // Guard against non-finite accel channels (NaN/±Infinity slip past `??`, which
  // only catches null/undefined) so they can't poison the SVG coordinates.
  const lat = finiteOr0(snapshot?.latAccelG)
  const lon = finiteOr0(snapshot?.longAccelG)
  const skin = resolveElementSkin(s)
  const mag = Math.hypot(lat, lon)
  const base = accentOf(s, skin)
  const dotColor = mag > maxG * 0.85 ? skin.palette.crit : base
  const fx = clamp(-1, 1, lat / maxG)
  const fy = clamp(-1, 1, -lon / maxG)
  const gText = `${mag.toFixed(2)}g`
  return (
    <WFrame element={element} skin={skin} className="gt3-gforcemeter">
      {({ W, H }) => {
        const labelH = s.label ? Math.min(18, H * 0.13) : 0
        const footH = Math.max(12, H * 0.16)
        const cx = W / 2
        const areaTop = labelH + 2
        const areaH = Math.max(1, H - areaTop - footH)
        const cy = areaTop + areaH / 2
        const r = Math.max(6, Math.min(W * 0.46, areaH * 0.5) - 2)
        const px = cx + fx * r
        const py = cy + fy * r
        const dot = Math.max(3, r * 0.13)
        return (
          <>
            <circle cx={cx} cy={cy} r={r} fill="none" stroke={skin.material.border} strokeWidth={1.2} />
            <circle cx={cx} cy={cy} r={r * 0.5} fill="none" stroke={skin.material.border} strokeWidth={1} />
            <line x1={cx} y1={cy - r} x2={cx} y2={cy + r} stroke={skin.material.border} strokeWidth={0.8} />
            <line x1={cx - r} y1={cy} x2={cx + r} y2={cy} stroke={skin.material.border} strokeWidth={0.8} />
            <line x1={cx} y1={cy} x2={px} y2={py} stroke={dotColor} strokeWidth={1.6} opacity={0.5} />
            <circle cx={px} cy={py} r={dot} fill={dotColor} />
            <SlotFit element={element} slot="value" x={cx} y={H - footH / 2} boxW={W * 0.7} boxH={Math.max(11, footH * 0.8)} text={gText} family={valueFont(gText, skin)} size={vSafeFont(H - footH / 2, H, Math.max(11, footH * 0.7))} color={skin.palette.textDim} />
            {s.label && (
              <SlotFit element={element} slot="label" x={cx} y={labelH / 2 + 1} boxW={W * 0.86} boxH={Math.max(11, labelH)} text={String(s.label).toUpperCase()} family={skin.typography.label} size={vSafeFont(labelH / 2 + 1, H, Math.max(11, labelH))} color={skin.palette.textDim} weight={600} letterSpacing={0.6} />
            )}
          </>
        )
      }}
    </WFrame>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// DIGITAL (7-segment)
// ═══════════════════════════════════════════════════════════════════════════

function SevenSeg({ element, snapshot, timeMode }: ExtraWidgetProps & { timeMode?: boolean }): ReactElement {
  const s = element.style
  const r = resolveBinding(element.binding, snapshot)
  const raw = r.text && r.text.length ? r.text : (timeMode ? '0:00.000' : '0')
  // The numeric CORE (prefix + number) stays on the DSEG face; the unit is kept
  // SEPARATE so it never gets baked into the segment string and garbled. Clocks
  // (timeMode) never carry a unit.
  const core = `${s.prefix ?? ''}${timeMode ? raw : applyDecimals(raw, r.numeric, s.decimals)}`
  const unitStr = timeMode ? '' : readoutUnit(s, element.binding)
  if (usesInstrument(element)) {
    const has = Boolean(r.text && r.text.length)
    return <SegmentInstrument element={element} value={has ? core : '—'} unit={has && unitStr ? unitStr : undefined} label={s.label ? String(s.label) : undefined} />
  }
  const skin = resolveElementSkin(s)
  const base = timeMode ? skin.palette.info : accentOf(s, skin)
  const ghost = s.ghost !== false
  const mask = core.replace(/[0-9]/g, '8')
  const family = valueFont(core, skin)
  return (
    <WFrame element={element} skin={skin} className="gt3-sevenseg">
      {({ W, H }) => {
        const pad = Math.max(4, Math.min(W, H) * 0.06)
        const labelH = s.label ? Math.max(11, Math.min(20, H * 0.2)) : 0
        const areaTop = labelH || pad
        const availH = Math.max(12, H - areaTop - pad)
        const fullW = W - pad * 2
        // Reserve a right gutter for the condensed unit so the DSEG value keeps
        // its own box (value + unit never overlap; the unit stays ≥11px legible).
        const hasUnit = unitStr.length > 0
        const unitW = hasUnit ? Math.min(W * 0.3, Math.max(28, availH * 1.5)) : 0
        const vBoxW = fullW - unitW
        const vCx = pad + vBoxW / 2
        const maxF = Math.min(availH, s.maxFontSize ?? availH)
        const vY = areaTop + availH / 2
        const safeF = vSafeFont(vY, H, maxF)
        const unitSize = Math.max(11, Math.min(availH * 0.34, unitW * 0.5))
        return (
          <>
            {s.label && (
              <SlotFit element={element} slot="label" x={pad} y={pad + labelH / 2} boxW={fullW} boxH={labelH} text={String(s.label).toUpperCase()} family={skin.typography.label} size={labelH} color={skin.palette.textDim} weight={600} anchor="start" letterSpacing={0.6} />
            )}
            {ghost && (
              <FitText x={vCx} y={vY} boxW={vBoxW} boxH={availH} text={mask} fontFamily={family} fill={skin.palette.text} minFontPx={11} maxFontPx={safeF} anchor="middle" baseline="middle" style={{ opacity: skin.segment.ghostOpacity }} />
            )}
            <SlotFit element={element} slot="value" x={vCx} y={vY} boxW={vBoxW} boxH={availH} text={core} family={family} size={safeF} color={base} />
            {hasUnit && (
              <FitText x={W - pad} y={vY} boxW={Math.max(1, unitW - 4)} boxH={availH * 0.5} text={unitStr} fontFamily={skin.typography.label} fill={skin.palette.textDim} minFontPx={11} maxFontPx={unitSize} anchor="end" baseline="middle" weight={600} letterSpacing={0.3} />
            )}
          </>
        )
      }}
    </WFrame>
  )
}

export function Segment7(props: ExtraWidgetProps): ReactElement {
  return <SevenSeg {...props} />
}

export function DigitalClock(props: ExtraWidgetProps): ReactElement {
  return <SevenSeg {...props} timeMode />
}

export function BigText({ element, snapshot }: ExtraWidgetProps): ReactElement {
  const s = element.style
  const r = resolveBinding(element.binding, snapshot)
  const value = `${s.prefix ?? ''}${applyDecimals(r.text && r.text.length ? r.text : '—', r.numeric, s.decimals)}${s.suffix ?? ''}`
  if (usesInstrument(element)) {
    return <TileInstrument element={element} value={value} label={s.label ? String(s.label) : undefined} />
  }
  const skin = resolveElementSkin(s)
  const base = s.accentColor ?? s.color ?? skin.palette.text
  const align = s.align ?? 'center'
  const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle'
  return (
    <WFrame element={element} skin={skin} className="gt3-bigtext">
      {({ W, H }) => {
        const pad = Math.max(6, Math.min(W, H) * 0.08)
        const labelH = s.label ? Math.max(11, Math.min(20, H * 0.2)) : 0
        const ruleH = Math.max(3, H * 0.03)
        const areaTop = labelH || pad
        const availH = Math.max(12, H - areaTop - pad - ruleH - 4)
        const maxF = Math.min(availH, s.maxFontSize ?? availH)
        const vBoxW = W - pad * 2
        const ax = align === 'left' ? pad : align === 'right' ? W - pad : W / 2
        const vY = areaTop + availH / 2
        const ruleW = W * 0.34
        const rx = align === 'left' ? pad : align === 'right' ? W - pad - ruleW : (W - ruleW) / 2
        return (
          <>
            {s.label && (
              <SlotFit element={element} slot="label" x={ax} y={pad + labelH / 2} boxW={vBoxW} boxH={labelH} text={String(s.label).toUpperCase()} family={skin.typography.label} size={labelH} color={skin.palette.textDim} weight={600} anchor={anchor} letterSpacing={0.6} />
            )}
            <SlotFit element={element} slot="value" x={ax} y={vY} boxW={vBoxW} boxH={availH} text={value} family={valueFont(value, skin)} size={vSafeFont(vY, H, maxF)} color={base} weight={800} anchor={anchor} />
            <rect x={rx} y={areaTop + availH + 3} width={ruleW} height={ruleH} rx={ruleH / 2} fill={base} opacity={0.85} />
          </>
        )
      }}
    </WFrame>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// GRAPH
// ═══════════════════════════════════════════════════════════════════════════

export function HistoryGraph({ element, snapshot }: ExtraWidgetProps): ReactElement {
  const s = element.style
  const value = num(element.binding, snapshot)
  const buf = useHistory(element, snapshot, value)
  const mode = s.graphStyle ?? 'line'
  const skin = resolveElementSkin(s)
  const sparkline = mode === 'sparkline'
  const base = accentOf(s, skin)
  const stroke = sparkline ? skin.palette.textDim : base
  const fixed = s.gaugeMin !== undefined && s.gaugeMax !== undefined
  const series = buf.length >= 2 ? buf : fauxSeries(clamp01(value ?? 0.5))
  let lo: number
  let hi: number
  if (fixed) {
    lo = s.gaugeMin as number
    hi = s.gaugeMax as number
  } else {
    lo = Math.min(...series)
    hi = Math.max(...series)
    const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.1 || 1
    lo -= pad
    hi += pad
  }
  const span = Math.max(1e-6, hi - lo)
  const n = series.length
  const filled = mode === 'area' || s.graphFill
  const unit = (s.suffix ?? '').toString()
  const valueText = value === undefined ? '—' : Math.abs(value) >= 10 ? Math.round(value).toString() : value.toFixed(2)
  const readout = unit ? `${valueText} ${unit}` : valueText
  const gid = `hg-${element.id}`
  return (
    <WFrame element={element} skin={skin} className={`gt3-historygraph ${sparkline ? 'spark' : ''}`}>
      {({ W, H }) => {
        const pad = Math.max(4, Math.min(W, H) * (sparkline ? 0.05 : 0.07))
        const headH = sparkline ? 0 : Math.max(12, Math.min(24, H * 0.28))
        const gx = pad
        const gy = pad + headH
        const gw = Math.max(1, W - pad * 2)
        const gh = Math.max(1, H - gy - pad)
        const toXY = (v: number, i: number): string => {
          const x = gx + (i / Math.max(1, n - 1)) * gw
          const y = gy + (1 - clamp01((v - lo) / span)) * gh
          return `${x.toFixed(2)},${y.toFixed(2)}`
        }
        const pts = series.map(toXY)
        const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p}`).join(' ')
        const areaPath = `${line} L${(gx + gw).toFixed(2)},${(gy + gh).toFixed(2)} L${gx.toFixed(2)},${(gy + gh).toFixed(2)} Z`
        return (
          <>
            {!sparkline && (
              <>
                <SlotFit element={element} slot="label" x={gx} y={pad + headH / 2} boxW={gw * 0.5} boxH={headH} text={String(s.label ?? '').toUpperCase()} family={skin.typography.label} size={headH * 0.82} color={skin.palette.textDim} weight={600} anchor="start" letterSpacing={0.6} />
                <SlotFit element={element} slot="value" x={gx + gw} y={pad + headH / 2} boxW={gw * 0.46} boxH={headH} text={readout} family={valueFont(valueText, skin)} size={headH} color={base} anchor="end" />
              </>
            )}
            {filled && (
              <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={base} stopOpacity={0.42} />
                  <stop offset="100%" stopColor={base} stopOpacity={0.02} />
                </linearGradient>
              </defs>
            )}
            {!sparkline && <line x1={gx} y1={gy + gh / 2} x2={gx + gw} y2={gy + gh / 2} stroke={skin.material.border} strokeWidth={0.8} />}
            {filled && <path d={areaPath} fill={`url(#${gid})`} stroke="none" />}
            <path d={line} fill="none" stroke={stroke} strokeWidth={sparkline ? 1.6 : 2} strokeLinejoin="round" strokeLinecap="round" />
          </>
        )
      }}
    </WFrame>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// CHART
// ═══════════════════════════════════════════════════════════════════════════

interface Bar { label: string; value: number | undefined; frac: number; color: string; text: string }

function chartBars(source: string | undefined, snapshot: TelemetrySnapshot | null, style: DashboardElement['style']): Bar[] {
  const corners: CornerKey[] = CORNER_ORDER
  switch (source) {
    case 'tyrePressure':
      return corners.map((c) => {
        const v = tyreCorner(snapshot, c, 'pressureKpa')
        return { label: CORNER_LABEL[c], value: v, frac: clamp01(((v ?? 140) - 130) / 60), color: CHROME, text: v === undefined ? '—' : v.toFixed(0) }
      })
    case 'tyreWear':
      return corners.map((c) => {
        const v = tyreCorner(snapshot, c, 'wearPct')
        return { label: CORNER_LABEL[c], value: v, frac: clamp01(v ?? 0), color: wearColor(v), text: v === undefined ? '—' : `${Math.round(v * 100)}` }
      })
    case 'brakeTemp':
      return corners.map((c) => {
        const v = brakeCorner(snapshot, c)
        return { label: CORNER_LABEL[c], value: v, frac: clamp01((v ?? 0) / 1000), color: brakeTempColor(v, style), text: v === undefined ? '—' : v.toFixed(0) }
      })
    case 'inputs': {
      const t = clamp01(snapshot?.throttle ?? 0)
      const b = clamp01(snapshot?.brake ?? 0)
      const cl = clamp01(snapshot?.clutch ?? 0)
      return [
        { label: 'THR', value: t, frac: t, color: GT3.green, text: `${Math.round(t * 100)}` },
        { label: 'BRK', value: b, frac: b, color: GT3.red, text: `${Math.round(b * 100)}` },
        { label: 'CLT', value: cl, frac: cl, color: GT3.blue, text: `${Math.round(cl * 100)}` }
      ]
    }
    case 'tyreTemp':
    default:
      return corners.map((c) => {
        const v = tyreCorner(snapshot, c, 'tempC')
        return { label: CORNER_LABEL[c], value: v, frac: clamp01(((v ?? 0)) / 140), color: tyreTempColor(v, style), text: v === undefined ? '—' : v.toFixed(0) }
      })
  }
}

export function BarChart({ element, snapshot }: ExtraWidgetProps): ReactElement {
  const s = element.style
  const skin = resolveElementSkin(s)
  const bars = chartBars(s.chartSource, snapshot, s)
  return (
    <WFrame element={element} skin={skin} className="gt3-barchart">
      {({ W, H }) => {
        const pad = Math.max(5, Math.min(W, H) * 0.06)
        const titleH = s.label ? Math.max(11, Math.min(18, H * 0.16)) : 0
        const top = pad + titleH
        const valH = Math.max(11, Math.min(18, H * 0.16))
        const labH = Math.max(11, Math.min(16, H * 0.14))
        const cols = Math.max(1, bars.length)
        const gutter = Math.max(2, W * 0.02)
        const colW = (W - pad * 2 - gutter * (cols - 1)) / cols
        const trackTop = top + valH + 3
        const trackBottom = H - pad - labH - 3
        const trackH = Math.max(4, trackBottom - trackTop)
        const barW = Math.min(colW, colW * 0.7 + 6)
        return (
          <>
            {s.label && (
              <SlotFit element={element} slot="label" x={pad} y={pad + titleH / 2} boxW={W - pad * 2} boxH={titleH} text={String(s.label).toUpperCase()} family={skin.typography.label} size={titleH} color={skin.palette.textDim} weight={600} anchor="start" letterSpacing={0.6} />
            )}
            {bars.map((bar, i) => {
              const cxCol = pad + i * (colW + gutter) + colW / 2
              const bx = cxCol - barW / 2
              const fh = trackH * clamp01(bar.frac)
              return (
                <g key={i}>
                  <SlotFit element={element} slot="value" x={cxCol} y={top + valH / 2} boxW={colW} boxH={valH} text={bar.text} family={valueFont(bar.text, skin)} size={valH} color={bar.color} />
                  <rect x={bx} y={trackTop} width={barW} height={trackH} rx={Math.min(3, barW / 2)} fill={skin.material.base} stroke={skin.material.border} strokeWidth={1} />
                  {bar.frac > 0 && <rect x={bx} y={trackBottom - fh} width={barW} height={fh} rx={Math.min(3, barW / 2)} fill={bar.color} />}
                  <SlotFit element={element} slot="corner" x={cxCol} y={H - pad - labH / 2} boxW={colW} boxH={labH} text={bar.label} family={skin.typography.label} size={labH} color={skin.palette.textDim} weight={600} />
                </g>
              )
            })}
          </>
        )
      }}
    </WFrame>
  )
}

export function RadialBars({ element, snapshot }: ExtraWidgetProps): ReactElement {
  const s = element.style
  const skin = resolveElementSkin(s)
  const bars = chartBars(s.chartSource ?? 'tyreWear', snapshot, s)
  return (
    <WFrame element={element} skin={skin} className="gt3-radialbars">
      {({ W, H }) => {
        const cx = W / 2
        const cy = H / 2
        const rMax = Math.min(W, H) * 0.44
        const nb = Math.max(1, bars.length)
        const ringW = Math.max(3, (rMax * 0.78) / nb)
        const gap = ringW * 0.28
        return (
          <>
            {bars.map((bar, i) => {
              const r = rMax - i * (ringW + gap) - ringW / 2
              if (r < ringW / 2) return null
              const circ = 2 * Math.PI * r
              return (
                <g key={i} transform={`rotate(-90 ${cx} ${cy})`}>
                  <circle cx={cx} cy={cy} r={r} fill="none" stroke={skin.material.border} strokeWidth={ringW} />
                  {bar.frac > 0 && (
                    <circle cx={cx} cy={cy} r={r} fill="none" stroke={bar.color} strokeWidth={ringW} strokeLinecap="round" strokeDasharray={`${(clamp01(bar.frac) * circ).toFixed(2)} ${circ.toFixed(2)}`} />
                  )}
                </g>
              )
            })}
            {s.label && (
              <SlotFit element={element} slot="label" x={cx} y={cy} boxW={rMax} boxH={Math.max(11, rMax * 0.3)} text={String(s.label).toUpperCase()} family={skin.typography.label} size={Math.max(11, rMax * 0.28)} color={skin.palette.textDim} weight={600} letterSpacing={0.4} />
            )}
          </>
        )
      }}
    </WFrame>
  )
}

export function Donut({ element, snapshot }: ExtraWidgetProps): ReactElement {
  const s = element.style
  const r = resolveBinding(element.binding, snapshot)
  const frac = clamp01(r.pct ?? num(element.binding, snapshot) ?? 0)
  if (usesInstrument(element)) {
    const pctMode = r.pct !== undefined
    return (
      <DialInstrument
        element={element}
        value={pctMode ? frac * 100 : num(element.binding, snapshot)}
        min={0}
        max={pctMode ? 100 : s.gaugeMax ?? defaultMax(element.binding)}
        unit={pctMode ? '%' : ((s.suffix || undefined) as string | undefined)}
        label={s.label ? String(s.label) : undefined}
      />
    )
  }
  const skin = resolveElementSkin(s)
  const base = s.accentColor ?? skin.palette.ok
  const valueText = r.pct !== undefined ? `${Math.round(frac * 100)}%` : (r.text || '—')
  return (
    <WFrame element={element} skin={skin} className="gt3-donut">
      {({ W, H }) => {
        const cx = W / 2
        const labelH = s.label ? Math.max(11, Math.min(16, H * 0.14)) : 0
        const cy = (H - labelH) / 2
        const radius = Math.max(6, Math.min(W, H - labelH) * 0.4)
        const thickness = s.ringThickness ?? Math.max(5, radius * 0.26)
        const circ = 2 * Math.PI * radius
        const valH = Math.max(12, radius * 0.6)
        return (
          <>
            <g transform={`rotate(-90 ${cx} ${cy})`}>
              <circle cx={cx} cy={cy} r={radius} fill="none" stroke={skin.material.border} strokeWidth={thickness} />
              {frac > 0 && (
                <circle cx={cx} cy={cy} r={radius} fill="none" stroke={base} strokeWidth={thickness} strokeLinecap="round" strokeDasharray={`${(frac * circ).toFixed(2)} ${circ.toFixed(2)}`} />
              )}
            </g>
            <SlotFit element={element} slot="value" x={cx} y={cy} boxW={radius * 1.4} boxH={valH} text={valueText} family={valueFont(valueText, skin)} size={valH} color={base} />
            {s.label && (
              <SlotFit element={element} slot="label" x={cx} y={H - labelH / 2 - 2} boxW={W * 0.86} boxH={labelH} text={String(s.label).toUpperCase()} family={skin.typography.label} size={vSafeFont(H - labelH / 2 - 2, H, labelH)} color={skin.palette.textDim} weight={600} letterSpacing={0.5} />
            )}
          </>
        )
      }}
    </WFrame>
  )
}

export function SegmentBars({ element, snapshot }: ExtraWidgetProps): ReactElement {
  const s = element.style
  const r = resolveBinding(element.binding, snapshot)
  const frac = clamp01(r.pct ?? num(element.binding, snapshot) ?? 0)
  if (usesInstrument(element)) {
    return <RevInstrument element={element} frac={frac} />
  }
  const skin = resolveElementSkin(s)
  const segments = Math.max(5, Math.min(40, s.segments ?? 16))
  const lit = Math.round(frac * segments)
  const vertical = s.orientation === 'v'
  const base = accentOf(s, skin)
  const valueText = r.pct !== undefined ? `${Math.round(frac * 100)}` : (r.text || '—')
  return (
    <WFrame element={element} skin={skin} className="gt3-segmentbars">
      {({ W, H }) => {
        const pad = Math.max(5, Math.min(W, H) * 0.06)
        const headH = Math.max(12, Math.min(22, H * 0.24))
        const railTop = pad + headH + 4
        const railH = Math.max(6, H - railTop - pad)
        const railW = Math.max(6, W - pad * 2)
        const span = vertical ? railH : railW
        const gap = Math.max(1.5, span * 0.012)
        const cell = Math.max(1, (span - gap * (segments - 1)) / segments)
        return (
          <>
            <SlotFit element={element} slot="label" x={pad} y={pad + headH / 2} boxW={railW * 0.5} boxH={headH} text={String(s.label ?? '').toUpperCase()} family={skin.typography.label} size={headH * 0.82} color={skin.palette.textDim} weight={600} anchor="start" letterSpacing={0.6} />
            <SlotFit element={element} slot="value" x={pad + railW} y={pad + headH / 2} boxW={railW * 0.46} boxH={headH} text={valueText} family={valueFont(valueText, skin)} size={headH} color={base} anchor="end" />
            {Array.from({ length: segments }, (_, i) => {
              const segFrac = (i + 1) / segments
              const on = i < lit
              const color = on ? rampToken(segFrac, s, skin, base) : skin.material.border
              if (vertical) {
                const y = railTop + railH - (i + 1) * cell - i * gap
                return <rect key={i} x={pad} y={y} width={railW} height={cell} rx={Math.min(2, cell / 2)} fill={color} opacity={on ? 1 : 0.5} />
              }
              const x = pad + i * (cell + gap)
              return <rect key={i} x={x} y={railTop} width={cell} height={railH} rx={Math.min(2, cell / 2)} fill={color} opacity={on ? 1 : 0.5} />
            })}
          </>
        )
      }}
    </WFrame>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// RING
// ═══════════════════════════════════════════════════════════════════════════

export function RingGauge({ element, snapshot }: ExtraWidgetProps): ReactElement {
  const s = element.style
  const r = resolveBinding(element.binding, snapshot)
  const value = num(element.binding, snapshot)
  const min = s.gaugeMin
  const max = s.gaugeMax
  const frac = r.pct !== undefined && min === undefined
    ? clamp01(r.pct)
    : clamp01(((value ?? (min ?? 0)) - (min ?? 0)) / Math.max(1e-6, (max ?? defaultMax(element.binding)) - (min ?? 0)))
  if (usesInstrument(element)) {
    const pctMode = r.pct !== undefined && min === undefined
    return (
      <DialInstrument
        element={element}
        value={pctMode ? frac * 100 : value}
        min={pctMode ? 0 : min ?? 0}
        max={pctMode ? 100 : max ?? defaultMax(element.binding)}
        unit={pctMode ? '%' : ((s.suffix || undefined) as string | undefined)}
        label={s.label ? String(s.label) : undefined}
      />
    )
  }
  const skin = resolveElementSkin(s)
  const base = accentOf(s, skin)
  const color = rampToken(frac, s, skin, base)
  const unit = (s.suffix ?? '').toString()
  const valueText = r.pct !== undefined && min === undefined ? `${Math.round(frac * 100)}` : value === undefined ? '—' : Math.abs(value) >= 10 ? Math.round(value).toString() : value.toFixed(1)
  return (
    <WFrame element={element} skin={skin} className="gt3-ringgauge">
      {({ W, H }) => {
        const labelH = s.label ? Math.max(11, Math.min(16, H * 0.13)) : 0
        const cx = W / 2
        const radius = Math.max(8, Math.min(W, H - labelH) * 0.4)
        const cy = labelH + (H - labelH) / 2
        const thickness = s.ringThickness ?? Math.max(5, radius * 0.22)
        const endDeg = GAUGE_START + frac * GAUGE_SWEEP
        const track = arcPath(cx, cy, radius, GAUGE_START, GAUGE_START + GAUGE_SWEEP)
        const prog = arcPath(cx, cy, radius, GAUGE_START, endDeg)
        const valH = Math.max(13, radius * 0.62)
        const unitH = Math.max(11, radius * 0.26)
        return (
          <>
            <path d={track} fill="none" stroke={skin.material.border} strokeWidth={thickness} strokeLinecap="round" />
            {prog && <path d={prog} fill="none" stroke={color} strokeWidth={thickness} strokeLinecap="round" />}
            {s.label && (
              <SlotFit element={element} slot="label" x={cx} y={Math.max(11, labelH * 0.6)} boxW={W * 0.9} boxH={labelH} text={String(s.label).toUpperCase()} family={skin.typography.label} size={vSafeFont(Math.max(11, labelH * 0.6), H, labelH)} color={skin.palette.textDim} weight={600} letterSpacing={0.5} />
            )}
            <SlotFit element={element} slot="value" x={cx} y={cy - (unit ? unitH * 0.5 : 0)} boxW={radius * 1.5} boxH={valH} text={valueText} family={valueFont(valueText, skin)} size={valH} color={color} />
            {unit && (
              <SlotFit element={element} slot="unit" x={cx} y={cy + valH * 0.55} boxW={radius * 1.2} boxH={unitH} text={unit.toUpperCase()} family={skin.typography.label} size={unitH} color={skin.palette.textDim} weight={600} letterSpacing={0.6} />
            )}
          </>
        )
      }}
    </WFrame>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// LED bar
// ═══════════════════════════════════════════════════════════════════════════

export function LedBar({ element, snapshot }: ExtraWidgetProps): ReactElement {
  const s = element.style
  const r = resolveBinding(element.binding, snapshot)
  const frac = clamp01(r.pct ?? num(element.binding, snapshot) ?? 0)
  if (usesInstrument(element)) {
    return <RevInstrument element={element} frac={frac} />
  }
  const skin = resolveElementSkin(s)
  const segments = Math.max(6, Math.min(32, s.segments ?? 16))
  const lit = Math.round(frac * segments)
  const vertical = s.orientation === 'v'
  const base = accentOf(s, skin)
  return (
    <WFrame element={element} skin={skin} className={`gt3-ledbar ${vertical ? 'v' : 'h'}`}>
      {({ W, H }) => {
        const pad = Math.max(5, Math.min(W, H) * 0.06)
        const labelH = s.label ? Math.max(11, Math.min(18, H * 0.2)) : 0
        const railTop = pad + labelH + (labelH ? 4 : 0)
        const railW = Math.max(6, W - pad * 2)
        const railH = Math.max(6, H - railTop - pad)
        const span = vertical ? railH : railW
        const gap = Math.max(1.5, span * 0.02)
        const cell = Math.max(1, (span - gap * (segments - 1)) / segments)
        return (
          <>
            {s.label && (
              <SlotFit element={element} slot="label" x={pad} y={pad + labelH / 2} boxW={railW} boxH={labelH} text={String(s.label).toUpperCase()} family={skin.typography.label} size={labelH} color={skin.palette.textDim} weight={600} anchor="start" letterSpacing={0.6} />
            )}
            {Array.from({ length: segments }, (_, i) => {
              const idx = vertical ? segments - 1 - i : i
              const segFrac = (idx + 1) / segments
              const on = idx < lit
              const color = rampToken(segFrac, s, skin, base)
              if (vertical) {
                const y = railTop + i * (cell + gap)
                return <rect key={i} x={pad} y={y} width={railW} height={cell} rx={Math.min(2.5, cell / 2)} fill={on ? color : skin.material.border} opacity={on ? 1 : 0.45} />
              }
              const x = pad + i * (cell + gap)
              return <rect key={i} x={x} y={railTop} width={cell} height={railH} rx={Math.min(2.5, cell / 2)} fill={on ? color : skin.material.border} opacity={on ? 1 : 0.45} />
            })}
          </>
        )
      }}
    </WFrame>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// HEATMAP
// ═══════════════════════════════════════════════════════════════════════════

export function HeatMap({ element, snapshot }: ExtraWidgetProps): ReactElement {
  const s = element.style
  const skin = resolveElementSkin(s)
  const brake = s.heatSource === 'brake'
  return (
    <WFrame element={element} skin={skin} className="gt3-heatmap">
      {({ W, H }) => {
        const pad = Math.max(5, Math.min(W, H) * 0.05)
        const titleH = s.label ? Math.max(11, Math.min(16, H * 0.13)) : 0
        const gx = pad
        const gy = pad + titleH
        const gw = W - pad * 2
        const gh = H - gy - pad
        const grid = makeGrid(2, 2, gw, gh, Math.max(3, Math.min(W, H) * 0.03))
        return (
          <>
            {s.label && (
              <SlotFit element={element} slot="label" x={pad} y={pad + titleH / 2} boxW={gw} boxH={titleH} text={String(s.label).toUpperCase()} family={skin.typography.label} size={titleH} color={skin.palette.textDim} weight={600} anchor="start" letterSpacing={0.6} />
            )}
            {CORNER_ORDER.map((c, i) => {
              const v = brake ? brakeCorner(snapshot, c) : tyreCorner(snapshot, c, 'tempC')
              const color = brake ? brakeTempColor(v, s) : tyreTempColor(v, s)
              const cellRect = grid.cell(i % 2, Math.floor(i / 2))
              const cx0 = gx + cellRect.x
              const cy0 = gy + cellRect.y
              const cw = cellRect.w
              const ch = cellRect.h
              const cornerH = Math.max(10, Math.min(15, ch * 0.28))
              const valH = Math.max(12, Math.min(30, ch * 0.42))
              const valText = v === undefined ? '—' : `${Math.round(v)}°`
              return (
                <g key={c}>
                  <rect x={cx0} y={cy0} width={cw} height={ch} rx={Math.min(6, skin.material.radius)} fill={v === undefined ? skin.material.base : color} stroke={skin.material.border} strokeWidth={1} />
                  <SlotFit element={element} slot="corner" x={cx0 + cw / 2} y={cy0 + cornerH * 0.75} boxW={cw * 0.86} boxH={cornerH} text={CORNER_LABEL[c]} family={skin.typography.label} size={cornerH} color={skin.palette.text} weight={700} letterSpacing={0.4} />
                  <SlotFit element={element} slot="value" x={cx0 + cw / 2} y={cy0 + ch / 2 + cornerH * 0.4} boxW={cw * 0.9} boxH={valH} text={valText} family={valueFont(valText, skin)} size={valH} color={skin.palette.text} weight={700} />
                </g>
              )
            })}
          </>
        )
      }}
    </WFrame>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// STATUS lamp
// ═══════════════════════════════════════════════════════════════════════════

interface LampState { tag: string; on: boolean; color: string; state: string }

function lampState(kind: string | undefined, snapshot: TelemetrySnapshot | null): LampState {
  switch (kind) {
    case 'tc':
      return { tag: 'TC', on: Boolean(snapshot?.tcActive), color: GT3.blue, state: snapshot?.tcActive ? 'CUT' : 'OK' }
    case 'drs':
      return { tag: 'DRS', on: Boolean(snapshot?.drs), color: GT3.green, state: snapshot?.drs ? 'OPEN' : 'SHUT' }
    case 'pit':
    case 'limiter':
      return { tag: 'PIT', on: Boolean(snapshot?.pitLimiter), color: GT3.pitBlue, state: snapshot?.pitLimiter ? 'LIMIT' : 'FREE' }
    case 'rain':
      return { tag: 'RAIN', on: Boolean(snapshot?.isRaining), color: GT3.amber, state: snapshot?.isRaining ? 'WET' : 'DRY' }
    case 'flag': {
      const f = getActiveFlag(snapshot)
      return { tag: 'FLAG', on: Boolean(f), color: f?.color ?? GT3.green, state: f?.label ?? 'GREEN' }
    }
    case 'abs':
    default:
      return { tag: 'ABS', on: Boolean(snapshot?.absActive), color: GT3.amber, state: snapshot?.absActive ? 'ON' : 'OFF' }
  }
}

export function StatusLamp({ element, snapshot }: ExtraWidgetProps): ReactElement {
  const s = element.style
  const st = lampState(s.statusKind, snapshot)
  if (usesInstrument(element)) {
    const iconByKind: Record<string, TelltaleLamp['icon']> = {
      tc: 'tc', drs: 'drs', pit: 'pit-limiter', limiter: 'pit-limiter',
      rain: 'rain', flag: 'flag-green', abs: 'abs'
    }
    const icon = iconByKind[s.statusKind ?? 'abs'] ?? 'abs'
    const lamps: TelltaleLamp[] = [
      { icon, active: st.on, activeColor: st.color, label: s.label ? String(s.label) : st.tag }
    ]
    return <TelltaleInstrument element={element} lamps={lamps} columns={1} />
  }
  const skin = resolveElementSkin(s)
  const tag = s.label ? String(s.label).toUpperCase() : st.tag
  return (
    <WFrame element={element} skin={skin} className={`gt3-statuslamp ${st.on ? 'on' : ''}`}>
      {({ W, H }) => {
        const pad = Math.max(6, Math.min(W, H) * 0.08)
        const dotR = Math.max(5, Math.min(H - pad * 2, W * 0.24) * 0.5)
        const dotCx = pad + dotR
        const dotCy = H / 2
        const textX = dotCx + dotR + Math.max(6, W * 0.05)
        const textW = Math.max(1, W - textX - pad)
        const tagH = Math.max(11, Math.min(20, H * 0.3))
        const stateH = Math.max(13, Math.min(30, H * 0.4))
        const gapY = Math.min(6, H * 0.05)
        const blockH = tagH + stateH + gapY
        const top = (H - blockH) / 2
        return (
          <>
            {st.on && <circle cx={dotCx} cy={dotCy} r={dotR + 3} fill={st.color} opacity={0.22} />}
            <circle cx={dotCx} cy={dotCy} r={dotR} fill={st.on ? st.color : skin.material.base} stroke={st.on ? st.color : skin.material.border} strokeWidth={Math.max(1, dotR * 0.12)} />
            <SlotFit element={element} slot="label" x={textX} y={top + tagH / 2} boxW={textW} boxH={tagH} text={tag} family={skin.typography.label} size={tagH} color={st.on ? st.color : skin.palette.textDim} weight={700} anchor="start" letterSpacing={0.6} />
            <SlotFit element={element} slot="value" x={textX} y={top + tagH + gapY + stateH / 2} boxW={textW} boxH={stateH} text={st.state} family={valueFont(st.state, skin)} size={stateH} color={st.on ? skin.palette.text : skin.palette.textDim} weight={700} anchor="start" />
          </>
        )
      }}
    </WFrame>
  )
}

// ── Dispatch ─────────────────────────────────────────────────────────────────
export const EXTRA_WIDGET_TYPES = [
  'analoggauge', 'linearmeter', 'gforcemeter', 'segment7', 'digitalclock', 'bigtext',
  'historygraph', 'barchart', 'radialbars', 'donut', 'segmentbars', 'ringgauge',
  'ledbar', 'heatmap', 'statuslamp'
] as const

export function renderExtraWidget(props: ExtraWidgetProps): ReactElement | null {
  switch (props.element.type) {
    case 'analoggauge': return <AnalogGauge {...props} />
    case 'linearmeter': return <LinearMeter {...props} />
    case 'gforcemeter': return <GForceMeter {...props} />
    case 'segment7': return <Segment7 {...props} />
    case 'digitalclock': return <DigitalClock {...props} />
    case 'bigtext': return <BigText {...props} />
    case 'historygraph': return <HistoryGraph {...props} />
    case 'barchart': return <BarChart {...props} />
    case 'radialbars': return <RadialBars {...props} />
    case 'donut': return <Donut {...props} />
    case 'segmentbars': return <SegmentBars {...props} />
    case 'ringgauge': return <RingGauge {...props} />
    case 'ledbar': return <LedBar {...props} />
    case 'heatmap': return <HeatMap {...props} />
    case 'statuslamp': return <StatusLamp {...props} />
    default: return null
  }
}
