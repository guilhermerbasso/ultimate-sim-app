// Shared leaf-level primitives for the wave-16 dashboard widgets (futuristic +
// minimalist). Like extra-widgets.tsx this module is intentionally LEAF-LEVEL: it
// imports only the pure theme/format helpers (gt3-theme) and the binding resolver
// (binding) — never gt3-widgets — so `gt3-widgets.tsx` can import the per-family
// dispatchers without an import cycle.
//
// EVERY textual readout in the new widgets MUST route through these helpers
// (SlotText / SvgText / Cap), which resolve `style.slots[slot]` via
// `resolveSlotStyle` so the inspector's font family / COLOUR / SIZE / weight /
// align controls actually take effect (the round-15 rule). Defaults stay
// back-compatible: a widget with no `slots` renders exactly as its hard defaults.

import type { CSSProperties, ReactElement, ReactNode } from 'react'
import type { DashboardElement, ResolvedTextSlot, TextAlign } from '../../../../shared/dashboards'
import { resolveSlotStyle } from '../../../../shared/dashboards'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import type { UnitSystem } from '../../../../shared/units'
import { resolveBinding } from '../binding'
import { FONT_CONDENSED, FONT_MONO, FONT_TECH, GT3, panelChrome, readoutFont } from './gt3-theme'
import {
  AnalogDial,
  DataTile,
  INSTRUMENT_COLORS,
  RevLedBar,
  SegmentReadout,
  TelltaleBank,
  type InstrumentColors,
  type LedShape,
  type TelltaleLamp
} from '../../instruments'

export interface NewWidgetProps {
  element: DashboardElement
  snapshot: TelemetrySnapshot | null
  unitSystem?: UnitSystem
}

// Re-export theme tokens so the widget files import everything from one place.
export { FONT_CONDENSED, FONT_MONO, FONT_TECH, GT3, panelChrome, readoutFont }

// ── Colour tokens ────────────────────────────────────────────────────────────
// Warm tokens (gold/amber/orange/red) drive chrome, accents and highlights.
// Cool/green/blue are reserved for positive "good" states (battery full, pits
// open, dry, pressure on target, power boost) per the Gui colour rule.
export const WARM_GOLD = '#D4A000'
export const WARM_AMBER = GT3.amber
export const WARM_ORANGE = GT3.orange
export const WARM_RED = GT3.red
export const COOL_GREEN = GT3.green
export const COOL_BLUE = GT3.blue
export const COOL_CYAN = GT3.cyan
export const CHROME = '#C9C5BC'
export const GRID_LINE = '#171717'
export const TRACK = GT3.panelStroke

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(1, Math.max(0, v))
}

// Any non-finite input (NaN, ±Infinity, null/undefined) collapses to 0 so it
// never reaches SVG geometry (mirrors the extra-widgets guard).
export function finiteOr0(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

export function isFiniteNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

export function accentOf(style: DashboardElement['style'], fallback = WARM_GOLD): string {
  return style.accentColor ?? fallback
}

// Resolve a binding to a finite number (numeric, then pct, then parsed text).
export function numFromBinding(binding: string | undefined, snap: TelemetrySnapshot | null): number | undefined {
  const r = resolveBinding(binding, snap)
  if (typeof r.numeric === 'number' && Number.isFinite(r.numeric)) return r.numeric
  if (typeof r.pct === 'number' && Number.isFinite(r.pct)) return r.pct
  const f = Number.parseFloat(r.text)
  return Number.isFinite(f) ? f : undefined
}

// ── Positioned container (mirrors the GT3 Shell / extra-widgets Box contract) ──
export function Box({ element, children, chrome, padding = 0, className }: {
  element: DashboardElement
  children: ReactNode
  chrome?: CSSProperties
  padding?: number
  className?: string
}): ReactElement {
  const st = element.style
  const drawsBorder = Boolean(chrome && chrome.border && chrome.border !== 'none')
  const borderOverride = drawsBorder ? `${st.borderWidth ?? 1}px solid ${st.border ?? GT3.panelStroke}` : undefined
  const style: CSSProperties = {
    left: element.x,
    top: element.y,
    width: element.w,
    height: element.h,
    padding,
    fontFamily: FONT_TECH,
    color: st.color ?? GT3.textPrimary,
    ...chrome,
    ...(borderOverride ? { border: borderOverride } : {}),
    ...(st.opacity !== undefined ? { opacity: st.opacity } : {})
  }
  return (
    <div className={`dash-element gt3-widget gt3-new ${className ?? ''}`} style={style}>
      {children}
    </div>
  )
}

// Boxed chrome for the new widgets. GT3 discipline: panels are matte-black with a
// single 1px hairline — NO decorative neon halo on normal readouts. Glow is
// reserved for genuine LED/alert indicators, which the widgets draw inline (lit
// shift segments, status dots, tell-tales). The legacy `glow` option is therefore
// intentionally ignored at the panel level so the surface stays matte.
export function chromeOf(element: DashboardElement, opts: { radius?: number; glow?: string; plain?: boolean } = {}): CSSProperties {
  return { ...panelChrome(element.style, { radius: opts.radius, plain: opts.plain }) }
}

// CSS of a resolved slot (only the present fields) — applied to HTML text.
export function slotStyle(ov: ResolvedTextSlot): CSSProperties {
  const out: CSSProperties = {}
  if (ov.fontFamily !== undefined) out.fontFamily = ov.fontFamily
  if (ov.fontSize !== undefined) out.fontSize = ov.fontSize
  if (ov.color !== undefined) out.color = ov.color
  if (ov.fontWeight !== undefined) out.fontWeight = ov.fontWeight
  if (ov.align !== undefined) out.textAlign = ov.align
  if (ov.letterSpacing !== undefined) out.letterSpacing = ov.letterSpacing
  if (ov.textTransform !== undefined) out.textTransform = ov.textTransform
  if (ov.textShadow !== undefined) out.textShadow = ov.textShadow
  return out
}

// HTML text honouring a font slot (family/size/colour/weight/align/spacing/
// transform/shadow). `base` is the widget's fixed style; the defaults
// (family/size/colour/weight) are the fallback when the slot has no override.
export function SlotText({ element, slot, family, size, color, weight, base, className, children }: {
  element: DashboardElement
  slot: string
  family?: string
  size?: number
  color?: string
  weight?: number | string
  base?: CSSProperties
  className?: string
  children: ReactNode
}): ReactElement {
  const ov = resolveSlotStyle(element.style, slot, { fontFamily: family, fontSize: size, color, fontWeight: weight })
  return <span className={className} style={{ ...base, ...slotStyle(ov) }}>{children}</span>
}

// SVG <text> honouring a font slot. Size is interpreted in viewBox units (like
// the rest of the drawing). Alignment stays positional (textAnchor) so centred
// gauge readouts don't shift.
export function SvgText({ element, slot, x, y, anchor = 'middle', family, size, fill, weight, baseStyle, children }: {
  element: DashboardElement
  slot: string
  x: number | string
  y: number | string
  anchor?: 'start' | 'middle' | 'end'
  family: string
  size: number
  fill: string
  weight?: number | string
  baseStyle?: CSSProperties
  children: ReactNode
}): ReactElement {
  const ov = resolveSlotStyle(element.style, slot, { fontFamily: family, fontSize: size, color: fill, fontWeight: weight })
  const style: CSSProperties = { ...baseStyle }
  if (ov.letterSpacing !== undefined) style.letterSpacing = ov.letterSpacing
  if (ov.textTransform !== undefined) style.textTransform = ov.textTransform
  if (ov.textShadow !== undefined) style.textShadow = ov.textShadow
  return (
    <text x={x} y={y} textAnchor={anchor} fontFamily={ov.fontFamily ?? family} fontSize={ov.fontSize ?? size} fontWeight={ov.fontWeight ?? weight} fill={ov.color ?? fill} style={style}>
      {children}
    </text>
  )
}

// Small uppercase caption honouring a label-like slot.
export function Cap({ element, slot = 'label', color = GT3.textMuted, size, className, children }: {
  element: DashboardElement
  slot?: string
  color?: string
  size?: number
  className?: string
  children: ReactNode
}): ReactElement {
  const ov = resolveSlotStyle(element.style, slot, { color, fontSize: size })
  return (
    <span
      className={className}
      style={{
        fontFamily: FONT_TECH,
        fontSize: 12,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: GT3.textMuted,
        ...slotStyle(ov)
      }}
    >
      {children}
    </span>
  )
}

// ── Geometry (deg: 0 = up / 12 o'clock, clockwise positive) ──────────────────
export function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) }
}

export function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  if (endDeg <= startDeg) return ''
  const s = polar(cx, cy, r, startDeg)
  const e = polar(cx, cy, r, endDeg)
  const large = endDeg - startDeg > 180 ? 1 : 0
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`
}

export const GAUGE_START = -135
export const GAUGE_SWEEP = 270

// A full-bleed flex column wrapper so HTML widget bodies fill the Box regardless
// of the `.dash-element { display:flex; align-items:center }` base rule.
export function Stack({ children, gap = 0, justify = 'center', align = 'stretch', style }: {
  children: ReactNode
  gap?: number
  justify?: CSSProperties['justifyContent']
  align?: CSSProperties['alignItems']
  style?: CSSProperties
}): ReactElement {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: justify, alignItems: align, gap, minWidth: 0, ...style }}>
      {children}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Instrument-primitive routing (P1 high-fidelity rebuild)
// ───────────────────────────────────────────────────────────────────────────
// OPT-IN & NON-DESTRUCTIVE. When an element carries the additive
// `style.instrument` sub-spec, the convertible widget families route through the
// real-race-car SVG primitives in `../../instruments` (AnalogDial / RevLedBar /
// SegmentReadout / DataTile / TelltaleBank). When `instrument` is ABSENT the
// widget renders exactly as before (the slot-aware fallback below), so existing
// boards + the per-slot font editing contract are untouched. The primitives read
// BOTH the editable base style (accent/warn/danger colours, gauge bounds, warn/
// danger thresholds, segments, ghost…) AND the `style.instrument` fine knobs, so
// every converted widget stays fully editable. GT3 discipline: warm chrome, DSEG
// numerals, matte material + hairline, glow only on LEDs/alerts, missing → '—'.

// True when the element opted into the instrument-primitive renderer.
export function usesInstrument(element: DashboardElement): boolean {
  return element.style.instrument != null
}

// Map the editable base-style colours onto instrument tokens. Warm chrome stays
// the default (never forced cool/green); absent overrides fall through to the
// canonical INSTRUMENT_COLORS.
export function instColors(style: DashboardElement['style']): Partial<InstrumentColors> {
  const o: Partial<InstrumentColors> = {}
  const acc = style.fillColor ?? style.accentColor
  if (acc) o.accent = acc
  if (style.warnColor) o.warn = style.warnColor
  if (style.dangerColor) o.danger = style.dangerColor
  if (style.color) o.text = style.color
  return o
}

function alignOf(a: TextAlign | undefined, fallback: TextAlign): TextAlign {
  return a === 'left' || a === 'center' || a === 'right' ? a : fallback
}

// Positioned shell that centres an instrument SVG inside the standard element
// box (so it stays draggable/editable like every other widget).
function InstrumentShell({ element, radius, padding = 6, plain, className, children }: {
  element: DashboardElement
  radius?: number
  padding?: number
  plain?: boolean
  className?: string
  children: ReactNode
}): ReactElement {
  return (
    <Box element={element} chrome={chromeOf(element, { radius, plain })} padding={padding} className={`gt3-inst ${className ?? ''}`}>
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0, minHeight: 0 }}>
        {children}
      </div>
    </Box>
  )
}

// Circular gauge → AnalogDial (warm chrome bezel, DSEG centre readout). A missing
// value renders the needle at the sweep start and the readout as '—'.
export function DialInstrument({ element, value, min, max, unit, label, decimals }: {
  element: DashboardElement
  value: number | undefined
  min: number
  max: number
  unit?: string
  label?: string
  decimals?: number
}): ReactElement {
  const s = element.style
  const inst = s.instrument
  const dial = inst?.parts?.dial
  const size = Math.max(40, Math.min(element.w, element.h) - 8)
  const warnFrom = dial?.warnFrom ?? (s.warnAt !== undefined ? min + clamp01(s.warnAt) * (max - min) : undefined)
  const redlineFrom = dial?.redlineFrom ?? (s.dangerAt !== undefined ? min + clamp01(s.dangerAt) * (max - min) : undefined)
  return (
    <InstrumentShell element={element} radius={s.radius ?? 12} className="gt3-inst-dial">
      <AnalogDial
        value={value === undefined ? Number.NaN : value}
        min={min}
        max={max}
        size={size}
        unit={unit}
        label={label}
        decimals={decimals ?? s.decimals}
        showValue={s.showValue !== false}
        bezel={inst?.bezel ?? 'chrome'}
        material={inst?.material ?? 'matte'}
        startAngleDeg={dial?.startAngleDeg}
        endAngleDeg={dial?.endAngleDeg}
        majorTicks={dial?.majorTicks}
        minorPerMajor={dial?.minorPerMajor}
        damp={dial?.damp}
        warnFrom={warnFrom}
        redlineFrom={redlineFrom}
        needleColor={inst?.parts?.needle?.color ?? s.needleColor}
        colors={instColors(s)}
        idPrefix={`dial-${element.id}`}
      />
    </InstrumentShell>
  )
}

// Linear bar / shift / rev → RevLedBar (individually-modelled LEDs + bloom glow).
function isShiftBinding(binding: string | undefined): boolean {
  return binding === 'shiftPct' ||
    binding === 'shiftIndicatorPct' ||
    binding === 'ShiftIndicatorPct' ||
    binding === 'ir:ShiftIndicatorPct'
}

export function RevInstrument({ element, frac, snapshot }: { element: DashboardElement; frac: number; snapshot: TelemetrySnapshot | null }): ReactElement {
  const s = element.style
  const inst = s.instrument
  const led = inst?.parts?.led
  const w = Math.max(40, element.w - 16)
  const h = Math.max(14, Math.min(element.h - 16, 44))
  return (
    <InstrumentShell element={element} radius={s.radius ?? 8} className="gt3-inst-rev">
      <RevLedBar
        pct={clamp01(frac)}
        segments={led?.segments ?? s.segments}
        shape={(led?.shape ?? s.segmentShape) as LedShape | undefined}
        width={w}
        height={h}
        warnAt={led?.warnAt ?? s.warnAt}
        dangerAt={led?.dangerAt ?? s.dangerAt}
        flashAt={led?.flashAt ?? s.flashAt}
        bloom={led?.bloom}
        glow={inst?.glow ?? s.glow}
        shiftActive={isShiftBinding(element.binding) ? snapshot?.revLights?.blink : undefined}
        colors={instColors(s)}
        idPrefix={`rev-${element.id}`}
      />
    </InstrumentShell>
  )
}

// Numeric / time readout → SegmentReadout (DSEG 7/14-seg). Missing → '—'.
export function SegmentInstrument({ element, value, unit, label, decimals }: {
  element: DashboardElement
  value: string | number | undefined
  unit?: string
  label?: string
  decimals?: number
}): ReactElement {
  const s = element.style
  const seg = s.instrument?.parts?.segment
  const h = Math.max(16, Math.min(Math.round(element.h * 0.5), 72))
  const v = value === undefined || value === '' ? '—' : value
  return (
    <InstrumentShell element={element} radius={s.radius ?? 6} padding={8} className="gt3-inst-seg">
      <SegmentReadout
        value={v}
        mode={seg?.mode}
        ghost={seg?.ghost ?? s.ghost !== false}
        digits={seg?.digits ?? s.digits}
        decimals={decimals ?? s.decimals}
        height={h}
        unit={unit}
        label={label}
        color={s.color ?? s.accentColor ?? INSTRUMENT_COLORS.text}
        align={alignOf(s.align, 'center')}
        idPrefix={`seg-${element.id}`}
      />
    </InstrumentShell>
  )
}

// Label / value tile → DataTile (matte/carbon/brushed material + hairline). The
// tile IS the surface, so the shell stays borderless. Missing → '—'.
export function TileInstrument({ element, value, unit, label, color }: {
  element: DashboardElement
  value: string | number | undefined
  unit?: string
  label?: string
  color?: string
}): ReactElement {
  const s = element.style
  const inst = s.instrument
  const tile = inst?.parts?.tile
  const w = Math.max(24, element.w)
  const h = Math.max(24, element.h)
  return (
    <Box element={element} chrome={chromeOf(element, { radius: s.radius ?? 6, plain: true })} padding={0} className="gt3-inst gt3-inst-tile">
      <DataTile
        label={label}
        value={value === undefined ? '—' : value}
        unit={unit}
        width={w}
        height={h}
        color={color ?? s.color}
        accent={s.accentColor}
        material={inst?.material ?? 'matte'}
        align={alignOf(tile?.align ?? s.align, 'left')}
        numeric={tile?.numeric}
        decimals={s.decimals}
        colors={instColors(s)}
        idPrefix={`tile-${element.id}`}
      />
    </Box>
  )
}

// FIA / status lamps → TelltaleBank (glow only when lit). Caller supplies the
// resolved lamp list (icon + active + colour).
export function TelltaleInstrument({ element, lamps, label, columns }: {
  element: DashboardElement
  lamps: TelltaleLamp[]
  label?: string
  columns?: number
}): ReactElement {
  const s = element.style
  const inst = s.instrument
  const n = Math.max(1, lamps.length)
  const cols = Math.max(1, Math.min(n, columns ?? (n <= 3 ? n : Math.ceil(Math.sqrt(n)))))
  const rows = Math.ceil(n / cols)
  const size = Math.max(
    14,
    Math.min(
      Math.floor((element.w - 16) / cols) - 4,
      Math.floor((element.h - (label ? 22 : 8)) / rows) - 4,
      48
    )
  )
  return (
    <InstrumentShell element={element} radius={s.radius ?? 8} padding={8} className="gt3-inst-telltale">
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        {label ? <Cap element={element} slot="label" color={accentOf(s)}>{label}</Cap> : null}
        <TelltaleBank lamps={lamps} size={Math.max(14, size)} columns={cols} glow={inst?.glow ?? s.glow ?? true} idPrefix={`tt-${element.id}`} />
      </div>
    </InstrumentShell>
  )
}
