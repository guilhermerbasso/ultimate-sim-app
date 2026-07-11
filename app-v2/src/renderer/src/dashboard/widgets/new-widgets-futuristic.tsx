// Wave-16 general FUTURISTIC widgets (v2.39 KIT) — neon/glow/segment/grid
// aesthetics over the two-skin token system. Every widget renders ONE root <svg>
// (fixed viewBox + preserveAspectRatio) and routes EVERY value/label through the
// skin-aware FitText primitive, so overflow is structurally impossible. The glow
// look comes from a shared feGaussianBlur bloom filter exposed by WidgetFrame.
//
// Leaf-level: imports the skin/instrument KIT, the binding resolver, the shared
// wave-16 helpers (from new-widgets-minimal) and the widget kit's instrument
// branches — never gt3-widgets (no import cycle). style.instrument opt-in still
// routes through the instrument primitives; only the base look is the new KIT.

import type { ReactElement } from 'react'
import type { DashboardElement } from '../../../../shared/dashboards'
import { applyDecimals } from '../../../../shared/dashboards'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import type { UnitSystem } from '../../../../shared/units'
import { resolveBinding } from '../binding'
import { resolveElementSkin } from '../../skins'
import type { SkinToken } from '../../skins'
import { Caption, FitValue, ValueUnit, WidgetFrame, hexAlpha } from './new-widgets-minimal'
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
  type NewWidgetProps
} from './new-widgets-kit'

function clampNum(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

// Threshold ramp (skin tokens): flash → crit → warn → accent.
function ramp(frac: number, s: DashboardElement['style'], skin: SkinToken, accent: string): string {
  const p = clamp01(frac)
  if (s.flashAt !== undefined && p >= s.flashAt) return skin.palette.text
  if (s.dangerAt !== undefined && p >= s.dangerAt) return skin.palette.crit
  if (s.warnAt !== undefined && p >= s.warnAt) return skin.palette.warn
  return accent
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

interface ChannelValue { text: string; frac: number; bounded: boolean; unit?: string }

function channel(element: DashboardElement, snapshot: TelemetrySnapshot | null, unitSystem: UnitSystem): ChannelValue {
  const s = element.style
  const r = resolveBinding(element.binding, snapshot, unitSystem)
  const body = applyDecimals(r.text && r.text.length ? r.text : '—', r.displayNumeric ?? r.numeric, s.decimals)
  const text = body === '—' ? '—' : `${s.prefix ?? ''}${body}`
  const unit = r.unit ?? ((s.suffix || undefined) as string | undefined)
  if (s.gaugeMin !== undefined || s.gaugeMax !== undefined) {
    const min = s.gaugeMin ?? 0
    const max = s.gaugeMax ?? defaultMax(element.binding)
    const v = numFromBinding(element.binding, snapshot)
    return { text, frac: clamp01(((v ?? min) - min) / Math.max(1e-6, max - min)), bounded: true, unit }
  }
  if (isFiniteNum(r.pct)) return { text, frac: clamp01(r.pct), bounded: true, unit }
  return { text, frac: 0, bounded: false, unit }
}

function dialParams(
  element: DashboardElement,
  snapshot: TelemetrySnapshot | null,
  frac: number,
  bounded: boolean,
  unit?: string
): { value: number; min: number; max: number; unit?: string } {
  const s = element.style
  if (s.gaugeMin !== undefined || s.gaugeMax !== undefined) {
    const min = s.gaugeMin ?? 0
    const max = s.gaugeMax ?? defaultMax(element.binding)
    const v = numFromBinding(element.binding, snapshot)
    return { value: v ?? NaN, min, max, unit }
  }
  if (bounded) return { value: frac * 100, min: 0, max: 100, unit: '%' }
  const v = numFromBinding(element.binding, snapshot)
  return { value: v ?? NaN, min: 0, max: defaultMax(element.binding), unit }
}

function str(v: unknown): string {
  return v === undefined || v === null ? '' : String(v)
}

function glowRef(element: DashboardElement): string {
  return `fx-${element.id}`
}

// ═══════════════════════════════════════════════════════════════════════════
// Neon ring gauge
// ═══════════════════════════════════════════════════════════════════════════

function NeonRing({ element, snapshot, unitSystem = 'metric' }: NewWidgetProps): ReactElement {
  const s = element.style
  const { text, frac, bounded, unit } = channel(element, snapshot, unitSystem)
  if (usesInstrument(element)) {
    const d = dialParams(element, snapshot, frac, bounded, unit)
    return <DialInstrument element={element} value={d.value} min={d.min} max={d.max} unit={d.unit} label={s.label ? String(s.label) : undefined} />
  }
  const skin = resolveElementSkin(s)
  const accent = accentOf(s, skin.palette.accent)
  const color = ramp(frac, s, skin, accent)
  const glowId = glowRef(element)
  const W = element.w
  const H = element.h
  const label = str(s.label)
  const cx = W / 2
  const cy = H / 2 + clampNum(H * 0.03, 0, 6)
  const r = Math.max(6, Math.min(W, H) / 2 - clampNum(Math.min(W, H) * 0.12, 6, 18))
  const thickness = clampNum(r * 0.16, 4, 12)
  const endDeg = GAUGE_START + frac * GAUGE_SWEEP
  const valBoxW = r * 1.4
  const valBoxH = r * 0.82
  const labelH = label ? clampNum(r * 0.26, 9, 16) : 0
  return (
    <WidgetFrame element={element} skin={skin} variant="futuristic" accent={accent} glowId={glowId}>
      <path d={arcPath(cx, cy, r, GAUGE_START, GAUGE_START + GAUGE_SWEEP)} fill="none" stroke={hexAlpha(skin.palette.textDim, 0.24)} strokeWidth={thickness} strokeLinecap="round" />
      {frac > 0 ? <path d={arcPath(cx, cy, r, GAUGE_START, endDeg)} fill="none" stroke={color} strokeWidth={thickness} strokeLinecap="round" filter={`url(#${glowId})`} /> : null}
      <circle cx={cx} cy={cy} r={Math.max(1, r - thickness - 3)} fill="none" stroke={hexAlpha(accent, 0.2)} strokeWidth={0.75} />
      {label ? <Caption skin={skin} x={cx - valBoxW / 2} y={cy - r + clampNum(r * 0.12, 2, 10)} w={valBoxW} h={labelH} text={label} anchor="middle" fill={hexAlpha(accent, 0.9)} /> : null}
      <ValueUnit element={element} skin={skin} x={cx - valBoxW / 2} y={cy - valBoxH / 2} w={valBoxW} h={valBoxH} text={text} unit={unit || undefined} fill={color} weight={700} layout="stack" valueAnchor="middle" />
    </WidgetFrame>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Segmented arc gauge
// ═══════════════════════════════════════════════════════════════════════════

function SegmentedGauge({ element, snapshot, unitSystem = 'metric' }: NewWidgetProps): ReactElement {
  const s = element.style
  const { text, frac, bounded, unit } = channel(element, snapshot, unitSystem)
  if (usesInstrument(element)) {
    const d = dialParams(element, snapshot, frac, bounded, unit)
    return <DialInstrument element={element} value={d.value} min={d.min} max={d.max} unit={d.unit} label={s.label ? String(s.label) : undefined} />
  }
  const skin = resolveElementSkin(s)
  const accent = accentOf(s, skin.palette.accent)
  const glowId = glowRef(element)
  const W = element.w
  const H = element.h
  const label = str(s.label)
  const cx = W / 2
  const cy = H / 2 + clampNum(H * 0.03, 0, 6)
  const r = Math.max(6, Math.min(W, H) / 2 - clampNum(Math.min(W, H) * 0.12, 6, 18))
  const segs = Math.max(8, Math.min(40, s.segments ?? 24))
  const lit = Math.round(frac * segs)
  const gap = 1.4
  const step = GAUGE_SWEEP / segs
  const thickness = clampNum(r * 0.16, 4, 11)
  const valBoxW = r * 1.4
  const valBoxH = r * 0.82
  const labelH = label ? clampNum(r * 0.26, 9, 16) : 0
  return (
    <WidgetFrame element={element} skin={skin} variant="futuristic" accent={accent} glowId={glowId}>
      {Array.from({ length: segs }, (_, i) => {
        const a0 = GAUGE_START + i * step + gap / 2
        const a1 = GAUGE_START + (i + 1) * step - gap / 2
        const on = i < lit
        const segColor = on ? ramp((i + 1) / segs, s, skin, accent) : hexAlpha(skin.palette.textDim, 0.22)
        return <path key={i} d={arcPath(cx, cy, r, a0, a1)} fill="none" stroke={segColor} strokeWidth={thickness} strokeLinecap="butt" filter={on ? `url(#${glowId})` : undefined} />
      })}
      {label ? <Caption skin={skin} x={cx - valBoxW / 2} y={cy - r + clampNum(r * 0.12, 2, 10)} w={valBoxW} h={labelH} text={label} anchor="middle" fill={hexAlpha(accent, 0.9)} /> : null}
      <ValueUnit element={element} skin={skin} x={cx - valBoxW / 2} y={cy - valBoxH / 2} w={valBoxW} h={valBoxH} text={text} unit={unit || undefined} fill={lit > 0 ? ramp(frac, s, skin, accent) : skin.palette.text} weight={700} layout="stack" valueAnchor="middle" />
    </WidgetFrame>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Sci-fi delta bar (bipolar pointer)
// ═══════════════════════════════════════════════════════════════════════════

function SciFiDelta({ element, snapshot }: NewWidgetProps): ReactElement {
  const s = element.style
  const r = resolveBinding(element.binding ?? 'deltaSec', snapshot)
  const raw = isFiniteNum(r.numeric) ? r.numeric : numFromBinding(element.binding ?? 'deltaSec', snapshot)
  const has = isFiniteNum(raw)
  const skin = resolveElementSkin(s)
  const accent = accentOf(s, skin.palette.accent)
  const glowId = glowRef(element)
  const range = s.deltaRangeSec ?? 1.0
  const norm = has ? Math.max(-1, Math.min(1, (raw as number) / Math.max(1e-6, range))) : 0
  const color = !has
    ? skin.palette.textDim
    : (raw as number) < -0.0005
      ? skin.palette.deltaFaster
      : (raw as number) > 0.0005
        ? skin.palette.deltaSlower
        : skin.palette.text
  const label = str(s.label) || 'DELTA'
  const sign = !has ? '' : (raw as number) > 0 ? '+' : (raw as number) < 0 ? '−' : '±'
  const text = has ? `${sign}${Math.abs(raw as number).toFixed(s.decimals ?? 3)}` : '—'
  const W = element.w
  const H = element.h
  const pad = clampNum(Math.min(W, H) * 0.12, 8, 16)
  const innerW = Math.max(1, W - pad * 2)
  const topH = Math.max(14, H * 0.42)
  const barY = pad + topH + clampNum(H * 0.06, 4, 12)
  const barH = Math.max(8, H - pad - barY)
  const midY = barY + barH / 2
  const cxTrack = pad + innerW / 2
  const pointerX = cxTrack + norm * (innerW / 2 - 3)
  const labelW = innerW * 0.42
  const valW = innerW - labelW
  return (
    <WidgetFrame element={element} skin={skin} variant="futuristic" accent={accent} glowId={glowId}>
      <Caption skin={skin} x={pad} y={pad + topH * 0.28} w={labelW} h={topH * 0.44} text={label} fill={hexAlpha(accent, 0.9)} />
      <ValueUnit element={element} skin={skin} x={pad + labelW} y={pad} w={valW} h={topH} text={text} fill={color} weight={800} valueAnchor="end" />
      <line x1={pad} y1={midY} x2={pad + innerW} y2={midY} stroke={hexAlpha(skin.palette.textDim, 0.3)} strokeWidth={2} strokeLinecap="round" />
      <line x1={cxTrack} y1={barY + 1} x2={cxTrack} y2={barY + barH - 1} stroke={hexAlpha(skin.palette.textDim, 0.5)} strokeWidth={1} />
      {has ? (
        <>
          <line x1={cxTrack} y1={midY} x2={pointerX} y2={midY} stroke={color} strokeWidth={3} strokeLinecap="round" filter={`url(#${glowId})`} />
          <circle cx={pointerX} cy={midY} r={clampNum(barH * 0.22, 2.5, 5)} fill={color} filter={`url(#${glowId})`} />
        </>
      ) : null}
    </WidgetFrame>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// HUD tile (corner brackets)
// ═══════════════════════════════════════════════════════════════════════════

function HudTile({ element, snapshot, unitSystem = 'metric' }: NewWidgetProps): ReactElement {
  const s = element.style
  const { text, frac, bounded, unit } = channel(element, snapshot, unitSystem)
  if (usesInstrument(element)) {
    return <TileInstrument element={element} value={text} label={s.label ? String(s.label) : undefined} />
  }
  const skin = resolveElementSkin(s)
  const accent = accentOf(s, skin.palette.accent)
  const color = bounded ? ramp(frac, s, skin, accent) : (s.color ?? skin.palette.text)
  const glowId = glowRef(element)
  const W = element.w
  const H = element.h
  const label = str(s.label)
  const m = clampNum(Math.min(W, H) * 0.06, 4, 12)
  const arm = clampNum(Math.min(W, H) * 0.16, 8, 26)
  const brk = (pts: string): ReactElement => <polyline points={pts} fill="none" stroke={accent} strokeWidth={1.5} strokeLinecap="round" filter={`url(#${glowId})`} />
  const pad = clampNum(Math.min(W, H) * 0.14, 10, 22)
  const innerW = Math.max(1, W - pad * 2)
  const labelH = label ? clampNum(H * 0.16, 10, 22) : 0
  const gap = 4
  const valueY = pad + (labelH ? labelH + gap : 0)
  const valueH = Math.max(12, H - pad - valueY)
  return (
    <WidgetFrame element={element} skin={skin} variant="futuristic" accent={accent} glowId={glowId}>
      {brk(`${m},${m + arm} ${m},${m} ${m + arm},${m}`)}
      {brk(`${W - m - arm},${m} ${W - m},${m} ${W - m},${m + arm}`)}
      {brk(`${W - m},${H - m - arm} ${W - m},${H - m} ${W - m - arm},${H - m}`)}
      {brk(`${m + arm},${H - m} ${m},${H - m} ${m},${H - m - arm}`)}
      {label ? <Caption skin={skin} x={pad} y={pad} w={innerW} h={labelH} text={label} anchor="middle" fill={hexAlpha(accent, 0.9)} /> : null}
      <ValueUnit element={element} skin={skin} x={pad} y={valueY} w={innerW} h={valueH} text={text} unit={unit || undefined} fill={color} weight={700} layout="stack" valueAnchor="middle" />
    </WidgetFrame>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Neon segmented bar
// ═══════════════════════════════════════════════════════════════════════════

function NeonBar({ element, snapshot, unitSystem = 'metric' }: NewWidgetProps): ReactElement {
  const s = element.style
  const { text, frac, unit } = channel(element, snapshot, unitSystem)
  if (usesInstrument(element)) {
    return <RevInstrument element={element} frac={frac} />
  }
  const skin = resolveElementSkin(s)
  const accent = accentOf(s, skin.palette.accent)
  const glowId = glowRef(element)
  const W = element.w
  const H = element.h
  const label = str(s.label)
  const vertical = s.orientation === 'v'
  const segs = Math.max(10, Math.min(48, s.segments ?? 24))
  const lit = Math.round(frac * segs)
  const pad = clampNum(Math.min(W, H) * 0.12, 8, 16)
  const innerW = Math.max(1, W - pad * 2)
  const rowH = clampNum(H * 0.32, 16, 44)
  const barY = pad + rowH + clampNum(H * 0.04, 3, 10)
  const barH = Math.max(8, H - pad - barY)
  const halfW = innerW * 0.5
  const gap = clampNum((vertical ? barH : innerW) * 0.012, 1, 3)
  const cellW = vertical ? innerW : Math.max(1, (innerW - gap * (segs - 1)) / segs)
  const cellH = vertical ? Math.max(1, (barH - gap * (segs - 1)) / segs) : barH
  return (
    <WidgetFrame element={element} skin={skin} variant="futuristic" accent={accent} glowId={glowId}>
      {label ? <Caption skin={skin} x={pad} y={pad + rowH * 0.14} w={halfW} h={rowH * 0.6} text={label} fill={hexAlpha(accent, 0.9)} /> : null}
      <ValueUnit element={element} skin={skin} x={pad + halfW} y={pad} w={halfW} h={rowH} text={text} unit={unit || undefined} fill={ramp(frac, s, skin, accent)} weight={700} valueAnchor="end" />
      {Array.from({ length: segs }, (_, i) => {
        const on = vertical ? i >= segs - lit : i < lit
        const cellFrac = (i + 1) / segs
        const color = on ? ramp(cellFrac, s, skin, accent) : hexAlpha(skin.palette.textDim, 0.2)
        const x = vertical ? pad : pad + i * (cellW + gap)
        const y = vertical ? barY + i * (cellH + gap) : barY
        return <rect key={i} x={x} y={y} width={cellW} height={cellH} rx={1} fill={color} filter={on ? `url(#${glowId})` : undefined} />
      })}
    </WidgetFrame>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Grid gauge (value over a sci-fi grid backdrop)
// ═══════════════════════════════════════════════════════════════════════════

function GridGauge({ element, snapshot, unitSystem = 'metric' }: NewWidgetProps): ReactElement {
  const s = element.style
  const { text, frac, bounded, unit } = channel(element, snapshot, unitSystem)
  if (usesInstrument(element)) {
    return <TileInstrument element={element} value={text} label={s.label ? String(s.label) : undefined} />
  }
  const skin = resolveElementSkin(s)
  const accent = accentOf(s, skin.palette.accent)
  const color = bounded ? ramp(frac, s, skin, accent) : (s.color ?? skin.palette.text)
  const glowId = glowRef(element)
  const W = element.w
  const H = element.h
  const label = str(s.label)
  const cols = Math.max(3, Math.round(W / 26))
  const rows = Math.max(2, Math.round(H / 26))
  const fillY = H * (1 - clamp01(frac))
  const pad = clampNum(Math.min(W, H) * 0.14, 10, 22)
  const innerW = Math.max(1, W - pad * 2)
  const labelH = label ? clampNum(H * 0.16, 10, 22) : 0
  const gap = 4
  const valueY = pad + (labelH ? labelH + gap : 0)
  const valueH = Math.max(12, H - pad - valueY)
  return (
    <WidgetFrame element={element} skin={skin} variant="futuristic" accent={accent} glowId={glowId}>
      {Array.from({ length: cols - 1 }, (_, i) => {
        const x = (W / cols) * (i + 1)
        return <line key={`v${i}`} x1={x} y1={0} x2={x} y2={H} stroke={hexAlpha(accent, 0.12)} strokeWidth={0.5} />
      })}
      {Array.from({ length: rows - 1 }, (_, i) => {
        const y = (H / rows) * (i + 1)
        return <line key={`h${i}`} x1={0} y1={y} x2={W} y2={y} stroke={hexAlpha(accent, 0.12)} strokeWidth={0.5} />
      })}
      {bounded && frac > 0 ? <rect x={0} y={fillY} width={W} height={H - fillY} fill={hexAlpha(color, 0.09)} /> : null}
      {bounded ? <line x1={0} y1={fillY} x2={W} y2={fillY} stroke={color} strokeWidth={1.25} filter={`url(#${glowId})`} /> : null}
      {label ? <Caption skin={skin} x={pad} y={pad} w={innerW} h={labelH} text={label} anchor="middle" fill={hexAlpha(accent, 0.9)} /> : null}
      <ValueUnit element={element} skin={skin} x={pad} y={valueY} w={innerW} h={valueH} text={text} unit={unit || undefined} fill={color} weight={800} layout="stack" valueAnchor="middle" />
    </WidgetFrame>
  )
}

// ── Registry + dispatch ──────────────────────────────────────────────────────
export const FUTURISTIC_WIDGET_TYPES = [
  'neon-ring-futuristic',
  'segmented-gauge-futuristic',
  'sci-fi-delta-futuristic',
  'hud-tile-futuristic',
  'neon-bar-futuristic',
  'grid-gauge-futuristic'
] as const

export function renderFuturisticWidget(props: { element: DashboardElement; snapshot: TelemetrySnapshot | null }): ReactElement | null {
  switch (props.element.type) {
    case 'neon-ring-futuristic': return <NeonRing {...props} />
    case 'segmented-gauge-futuristic': return <SegmentedGauge {...props} />
    case 'sci-fi-delta-futuristic': return <SciFiDelta {...props} />
    case 'hud-tile-futuristic': return <HudTile {...props} />
    case 'neon-bar-futuristic': return <NeonBar {...props} />
    case 'grid-gauge-futuristic': return <GridGauge {...props} />
    default: return null
  }
}
