// Wave-16 telemetry widgets — futuristic + minimalist variants powered by the
// NEW iRacing telemetry (ERS/hybrid battery, push-to-pass, declared-wet weather,
// track-surface material, BoP weight/power, tyre cold pressures, session clock,
// pit status). Leaf-level: imports only gt3-theme, the binding resolver and the
// shared widget kit — never gt3-widgets — so it can be dispatched without a cycle.
//
// Colour rule: warm tokens (gold/amber/orange/red) for chrome/accents/penalties;
// cool/green/blue ONLY for positive "good" states (battery full, P2P available,
// dry track, on-asphalt, pressure on target, pits open, power boost).
//
// Every readout routes through the kit's SlotText / SvgText / Cap so the
// inspector's font family / colour / size controls always take effect.

import type { ReactElement, ReactNode } from 'react'
import type { DashboardElement } from '../../../../shared/dashboards'
import { formatTimeOfDay, trackSurfaceMaterialLabel } from '../../../../shared/telemetry'
import type { PitStatus, TelemetrySnapshot } from '../../../../shared/telemetry'
import { formatMeasurement } from '../../../../shared/units'
import { pressureColor } from './gt3-theme'
import {
  Box,
  Cap,
  COOL_BLUE,
  COOL_CYAN,
  COOL_GREEN,
  FONT_CONDENSED,
  FONT_TECH,
  GAUGE_START,
  GAUGE_SWEEP,
  GT3,
  SlotText,
  SvgText,
  TRACK,
  WARM_AMBER,
  WARM_GOLD,
  WARM_ORANGE,
  WARM_RED,
  accentOf,
  arcPath,
  chromeOf,
  clamp01,
  isFiniteNum,
  polar,
  readoutFont,
  usesInstrument,
  DialInstrument,
  RevInstrument,
  SegmentInstrument,
  TelltaleInstrument,
  type NewWidgetProps
} from './new-widgets-kit'
import type { TelltaleLamp } from '../../instruments'

type CornerKey = 'lf' | 'rf' | 'lr' | 'rr'
const COLD_CORNERS: CornerKey[] = ['lf', 'rf', 'lr', 'rr']
const COLD_LABEL: Record<CornerKey, string> = { lf: 'LF', rf: 'RF', lr: 'LR', rr: 'RR' }

// Battery/charge ramp: high charge is the "good" state (green), draining to amber
// then red as the reserve runs low.
function chargeColor(p: number): string {
  if (p >= 0.5) return COOL_GREEN
  if (p >= 0.2) return WARM_AMBER
  return WARM_RED
}

function pctText(p: number | undefined): string {
  return isFiniteNum(p) ? `${Math.round(clamp01(p) * 100)}` : '—'
}

// ═══════════════════════════════════════════════════════════════════════════
// ERS / hybrid battery — bar
// ═══════════════════════════════════════════════════════════════════════════

function ErsBar({ element, snapshot, variant }: NewWidgetProps & { variant: 'futuristic' | 'minimal' }): ReactElement {
  const s = element.style
  const raw = snapshot?.ersBatteryPct
  const has = isFiniteNum(raw)
  const p = clamp01(raw ?? 0)
  if (usesInstrument(element)) {
    return <RevInstrument element={element} frac={p} />
  }
  const color = has ? chargeColor(p) : GT3.textMuted
  const label = (s.label ?? 'ERS').toString()

  if (variant === 'minimal') {
    return (
      <Box element={element} chrome={chromeOf(element, { radius: s.radius ?? 2, plain: s.background === undefined })} padding={12} className="ers-bar-minimal">
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Cap element={element} slot="label">{label}</Cap>
            <span>
              <SlotText element={element} slot="value" family={FONT_CONDENSED} size={Math.max(18, Math.round(element.h * 0.34))} color={GT3.textPrimary} weight={600}>{pctText(raw)}</SlotText>
              <SlotText element={element} slot="unit" family={FONT_TECH} size={Math.max(11, Math.round(element.h * 0.14))} color={GT3.textMuted} base={{ marginLeft: 3 }}>%</SlotText>
            </span>
          </div>
          <div style={{ width: '100%', height: 3, background: TRACK }}>
            <div style={{ width: `${p * 100}%`, height: '100%', background: has ? color : 'transparent' }} />
          </div>
        </div>
      </Box>
    )
  }

  const segs = Math.max(8, Math.min(28, s.segments ?? 16))
  const lit = Math.round(p * segs)
  return (
    <Box element={element} chrome={chromeOf(element, { radius: s.radius ?? 6, glow: has ? color : undefined })} padding={12} className="ers-bar-futuristic">
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Cap element={element} slot="label" color={accentOf(s, WARM_GOLD)}>{label}</Cap>
          <span>
            <SlotText element={element} slot="value" family={readoutFont(pctText(raw))} size={Math.max(20, Math.round(element.h * 0.4))} color={color} weight={700}>{pctText(raw)}</SlotText>
            <SlotText element={element} slot="unit" family={FONT_TECH} size={Math.max(11, Math.round(element.h * 0.16))} color={GT3.textSecondary} base={{ marginLeft: 4 }}>%</SlotText>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 2, alignItems: 'stretch', height: Math.max(12, Math.round(element.h * 0.3)) }}>
          {Array.from({ length: segs }, (_, i) => {
            const on = i < lit
            return <span key={i} style={{ flex: 1, background: on ? color : TRACK, opacity: on ? 1 : 0.45, boxShadow: on ? `0 0 8px ${color}66` : 'none', borderRadius: 1 }} />
          })}
        </div>
      </div>
    </Box>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// ERS / hybrid battery — radial
// ═══════════════════════════════════════════════════════════════════════════

function ErsRadial({ element, snapshot, variant }: NewWidgetProps & { variant: 'futuristic' | 'minimal' }): ReactElement {
  const s = element.style
  const raw = snapshot?.ersBatteryPct
  const has = isFiniteNum(raw)
  const p = clamp01(raw ?? 0)
  if (usesInstrument(element)) {
    return <DialInstrument element={element} value={has ? p * 100 : NaN} min={0} max={100} unit="%" label={s.label ? String(s.label) : 'ERS'} />
  }
  const color = has ? chargeColor(p) : GT3.textMuted
  const label = (s.label ?? 'ERS').toString()
  const cx = 50
  const cy = 52
  const r = 38
  const endDeg = GAUGE_START + p * GAUGE_SWEEP
  const minimal = variant === 'minimal'
  const thickness = minimal ? 5 : 9
  return (
    <Box element={element} chrome={chromeOf(element, { radius: s.radius ?? (minimal ? 2 : 12), glow: !minimal && has ? color : undefined, plain: minimal && s.background === undefined })} padding={8} className={`ers-radial-${variant}`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
        <path d={arcPath(cx, cy, r, GAUGE_START, GAUGE_START + GAUGE_SWEEP)} fill="none" stroke={TRACK} strokeWidth={thickness} strokeLinecap="round" />
        {p > 0 && (
          <path d={arcPath(cx, cy, r, GAUGE_START, endDeg)} fill="none" stroke={color} strokeWidth={thickness} strokeLinecap="round" style={!minimal && has ? { filter: `drop-shadow(0 0 3px ${color})` } : undefined} />
        )}
        {!minimal && Array.from({ length: 11 }, (_, i) => {
          const tickDeg = GAUGE_START + (i / 10) * GAUGE_SWEEP
          const a = polar(cx, cy, r - thickness - 2, tickDeg)
          const b = polar(cx, cy, r - thickness - 5, tickDeg)
          return <line key={i} x1={a.x.toFixed(2)} y1={a.y.toFixed(2)} x2={b.x.toFixed(2)} y2={b.y.toFixed(2)} stroke={GT3.textMuted} strokeWidth={0.6} />
        })}
        <SvgText element={element} slot="value" x={cx} y={cy + 3} family={readoutFont(pctText(raw))} size={20} fill={color} weight={700} baseStyle={{ fontVariantNumeric: 'tabular-nums' }}>{pctText(raw)}</SvgText>
        <SvgText element={element} slot="unit" x={cx} y={cy + 14} family={FONT_TECH} size={7} fill={GT3.textSecondary}>%</SvgText>
        <SvgText element={element} slot="label" x={cx} y={cy - 14} family={FONT_TECH} size={8} fill={minimal ? GT3.textMuted : accentOf(s, WARM_GOLD)} baseStyle={{ letterSpacing: '0.16em' }}>{label.toUpperCase()}</SvgText>
      </svg>
    </Box>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Push-to-pass
// ═══════════════════════════════════════════════════════════════════════════

function PushToPass({ element, snapshot, variant }: NewWidgetProps & { variant: 'futuristic' | 'minimal' }): ReactElement {
  const s = element.style
  const active = snapshot?.pushToPass
  const count = snapshot?.pushToPassCount
  const hasCount = isFiniteNum(count)
  const depleted = hasCount && (count as number) <= 0
  // Active = good (green); available-with-uses = amber accent; depleted = red/dim.
  const color = active ? COOL_GREEN : depleted ? WARM_RED : WARM_AMBER
  const state = active === undefined ? '—' : active ? 'ACTIVE' : depleted ? 'EMPTY' : 'READY'
  const label = (s.label ?? 'P2P').toString()
  const countText = hasCount ? String(Math.max(0, Math.round(count as number))) : '—'
  if (usesInstrument(element)) {
    const lamps: TelltaleLamp[] = [
      { icon: 'push-to-pass', active: Boolean(active), activeColor: color, label: hasCount ? `${label} ${countText}` : label }
    ]
    return <TelltaleInstrument element={element} lamps={lamps} columns={1} />
  }

  if (variant === 'minimal') {
    return (
      <Box element={element} chrome={chromeOf(element, { radius: s.radius ?? 2, plain: s.background === undefined })} padding={12} className="p2p-minimal">
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: active ? color : 'transparent', border: `1.5px solid ${color}` }} />
            <Cap element={element} slot="label">{label}</Cap>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <SlotText element={element} slot="value" family={FONT_CONDENSED} size={Math.max(20, Math.round(element.h * 0.4))} color={GT3.textPrimary} weight={600}>{countText}</SlotText>
            <SlotText element={element} slot="status" family={FONT_TECH} size={Math.max(11, Math.round(element.h * 0.14))} color={color} base={{ letterSpacing: '0.12em' }}>{state}</SlotText>
          </div>
        </div>
      </Box>
    )
  }

  return (
    <Box element={element} chrome={chromeOf(element, { radius: s.radius ?? 8, glow: active ? color : undefined })} padding={10} className="p2p-futuristic">
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Cap element={element} slot="label" color={accentOf(s, WARM_GOLD)}>{label}</Cap>
          <SlotText element={element} slot="status" family={FONT_TECH} size={Math.max(11, Math.round(element.h * 0.16))} color={color} base={{ letterSpacing: '0.16em' }}>{state}</SlotText>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 8, flex: 1 }}>
          <SlotText element={element} slot="value" family={readoutFont(countText)} size={Math.max(28, Math.round(element.h * 0.6))} color={color} weight={800} base={{ lineHeight: 1 }}>{countText}</SlotText>
        </div>
        <div style={{ display: 'flex', gap: 3, justifyContent: 'center' }}>
          {Array.from({ length: 6 }, (_, i) => {
            const on = hasCount && i < Math.min(6, Math.round(count as number))
            return <span key={i} style={{ width: '14%', height: 4, background: on ? color : TRACK, boxShadow: on ? `0 0 6px ${color}` : 'none', borderRadius: 2 }} />
          })}
        </div>
      </div>
    </Box>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Weather / declared-wet status
// ═══════════════════════════════════════════════════════════════════════════

function WeatherStatus({ element, snapshot, variant }: NewWidgetProps & { variant: 'futuristic' | 'minimal' }): ReactElement {
  const s = element.style
  const declaredWet = snapshot?.weatherDeclaredWet
  const wetness = snapshot?.trackWetnessPct
  const raining = snapshot?.isRaining
  const wet = Boolean(declaredWet || raining || (isFiniteNum(wetness) && (wetness as number) > 0.25))
  // Dry is the "good" racing state (green); wet/declared-wet is a warm warning.
  const color = wet ? WARM_AMBER : COOL_GREEN
  const word = declaredWet ? 'WET' : wet ? 'DAMP' : 'DRY'
  const label = (s.label ?? 'TRACK').toString()
  const wp = clamp01(wetness ?? 0)
  const label2 = declaredWet ? 'DECLARED' : raining ? 'RAINING' : 'CLEAR'
  if (usesInstrument(element)) {
    const lamps: TelltaleLamp[] = [
      { icon: 'rain', active: wet, activeColor: color, label: `${label} ${word}` }
    ]
    return <TelltaleInstrument element={element} lamps={lamps} columns={1} />
  }

  if (variant === 'minimal') {
    return (
      <Box element={element} chrome={chromeOf(element, { radius: s.radius ?? 2, plain: s.background === undefined })} padding={12} className="weather-status-minimal">
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4 }}>
          <Cap element={element} slot="label">{label}</Cap>
          <SlotText element={element} slot="value" family={FONT_CONDENSED} size={Math.max(20, Math.round(element.h * 0.4))} color={color} weight={600}>{word}</SlotText>
          <SlotText element={element} slot="sub" family={FONT_TECH} size={Math.max(11, Math.round(element.h * 0.13))} color={GT3.textMuted}>{isFiniteNum(wetness) ? `${Math.round(wp * 100)}% wet` : label2.toLowerCase()}</SlotText>
        </div>
      </Box>
    )
  }

  return (
    <Box element={element} chrome={chromeOf(element, { radius: s.radius ?? 8, glow: wet ? color : undefined })} padding={12} className="weather-status-futuristic">
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Cap element={element} slot="label" color={accentOf(s, WARM_GOLD)}>{label}</Cap>
          <SlotText element={element} slot="sub" family={FONT_TECH} size={Math.max(11, Math.round(element.h * 0.13))} color={wet ? color : GT3.textSecondary} base={{ letterSpacing: '0.14em' }}>{label2}</SlotText>
        </div>
        <SlotText element={element} slot="value" family={FONT_CONDENSED} size={Math.max(26, Math.round(element.h * 0.46))} color={color} weight={800} base={{ letterSpacing: '0.04em' }}>{word}</SlotText>
        <div style={{ width: '100%', height: 5, background: TRACK, borderRadius: 2 }}>
          <div style={{ width: `${wp * 100}%`, height: '100%', background: isFiniteNum(wetness) ? color : 'transparent', boxShadow: wp > 0 ? `0 0 8px ${color}` : 'none', borderRadius: 2 }} />
        </div>
      </div>
    </Box>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Track-surface material
// ═══════════════════════════════════════════════════════════════════════════

const ON_TRACK_SURFACES = new Set(['asphalt', 'concrete', 'paint', 'kerb'])

function TrackSurface({ element, snapshot, variant }: NewWidgetProps & { variant: 'futuristic' | 'minimal' }): ReactElement {
  const s = element.style
  const mat = trackSurfaceMaterialLabel(snapshot?.trackSurfaceMaterial)
  const onTrack = mat ? ON_TRACK_SURFACES.has(mat) : undefined
  // On-track (asphalt/concrete/kerb) is the "good" state (green); off-track
  // surfaces (grass/dirt/gravel/sand) are a warm warning.
  const color = onTrack === undefined ? GT3.textSecondary : onTrack ? COOL_GREEN : WARM_ORANGE
  const word = mat ? mat.toUpperCase() : '—'
  const label = (s.label ?? 'SURFACE').toString()

  if (variant === 'minimal') {
    return (
      <Box element={element} chrome={chromeOf(element, { radius: s.radius ?? 2, plain: s.background === undefined })} padding={12} className="track-surface-minimal">
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
          <Cap element={element} slot="label">{label}</Cap>
          <SlotText element={element} slot="value" family={FONT_CONDENSED} size={Math.max(18, Math.round(element.h * 0.34))} color={color} weight={600}>{word}</SlotText>
        </div>
      </Box>
    )
  }

  return (
    <Box element={element} chrome={chromeOf(element, { radius: s.radius ?? 8, glow: onTrack === false ? color : undefined })} padding={12} className="track-surface-futuristic">
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 10, height: 10, background: color, boxShadow: `0 0 8px ${color}`, borderRadius: 2, transform: 'rotate(45deg)' }} />
          <Cap element={element} slot="label" color={accentOf(s, WARM_GOLD)}>{label}</Cap>
        </div>
        <SlotText element={element} slot="value" family={FONT_CONDENSED} size={Math.max(22, Math.round(element.h * 0.4))} color={color} weight={800} base={{ letterSpacing: '0.05em' }}>{word}</SlotText>
      </div>
    </Box>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// BoP — weight penalty + power adjust
// ═══════════════════════════════════════════════════════════════════════════

function BopCell({ element, slot, capSlot, cap, value, valueText, color, big }: {
  element: DashboardElement
  slot: string
  capSlot: string
  cap: string
  value: ReactNode
  valueText: string
  color: string
  big: number
}): ReactElement {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
      <Cap element={element} slot={capSlot}>{cap}</Cap>
      <SlotText element={element} slot={slot} family={readoutFont(valueText)} size={big} color={color} weight={700} base={{ lineHeight: 1 }}>{value}</SlotText>
    </div>
  )
}

function Bop({ element, snapshot, unitSystem = 'metric', variant }: NewWidgetProps & { variant: 'futuristic' | 'minimal' }): ReactElement {
  const s = element.style
  const kg = snapshot?.weightPenaltyKg
  const pw = snapshot?.powerAdjustPct
  const hasKg = isFiniteNum(kg)
  const hasPw = isFiniteNum(pw)
  // Ballast is always a penalty (warm); power boost (>0) is "good" (green),
  // a cut (<0) is a warm penalty.
  const kgColor = hasKg && (kg as number) > 0 ? WARM_AMBER : GT3.textPrimary
  const pwColor = !hasPw ? GT3.textPrimary : (pw as number) > 0 ? COOL_GREEN : (pw as number) < 0 ? WARM_RED : GT3.textPrimary
  const weight = formatMeasurement(kg, 'mass-kg', unitSystem, { decimals: 0, signed: true })
  const kgText = weight.display
  const pwText = hasPw ? `${(pw as number) > 0 ? '+' : ''}${(pw as number).toFixed(1)}` : '—'
  const label = (s.label ?? 'BoP').toString()

  if (variant === 'minimal') {
    return (
      <Box element={element} chrome={chromeOf(element, { radius: s.radius ?? 2, plain: s.background === undefined })} padding={12} className="bop-minimal">
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
          <Cap element={element} slot="label">{label}</Cap>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span>
              <SlotText element={element} slot="value" family={FONT_CONDENSED} size={Math.max(16, Math.round(element.h * 0.3))} color={kgColor} weight={600}>{kgText}</SlotText>
              <SlotText element={element} slot="unit" family={FONT_TECH} size={Math.max(11, Math.round(element.h * 0.12))} color={GT3.textMuted} base={{ marginLeft: 2 }}>{weight.unit}</SlotText>
            </span>
            <span>
              <SlotText element={element} slot="power" family={FONT_CONDENSED} size={Math.max(16, Math.round(element.h * 0.3))} color={pwColor} weight={600}>{pwText}</SlotText>
              <SlotText element={element} slot="unit" family={FONT_TECH} size={Math.max(11, Math.round(element.h * 0.12))} color={GT3.textMuted} base={{ marginLeft: 2 }}>%</SlotText>
            </span>
          </div>
        </div>
      </Box>
    )
  }

  const big = Math.max(20, Math.round(element.h * 0.34))
  return (
    <Box element={element} chrome={chromeOf(element, { radius: s.radius ?? 8 })} padding={10} className="bop-futuristic">
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Cap element={element} slot="label" color={accentOf(s, WARM_GOLD)}>{label}</Cap>
        <div style={{ flex: 1, display: 'flex', alignItems: 'stretch' }}>
          <BopCell element={element} slot="value" capSlot="capWeight" cap="WEIGHT" big={big} color={kgColor} valueText={kgText} value={<>{kgText}<span style={{ fontSize: '0.45em', color: GT3.textMuted, marginLeft: 2 }}>{weight.unit}</span></>} />
          <span style={{ width: 1, background: TRACK, margin: '6px 0' }} />
          <BopCell element={element} slot="power" capSlot="capPower" cap="POWER" big={big} color={pwColor} valueText={pwText} value={<>{pwText}<span style={{ fontSize: '0.45em', color: GT3.textMuted, marginLeft: 2 }}>%</span></>} />
        </div>
      </div>
    </Box>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Tyre cold pressures (2×2)
// ═══════════════════════════════════════════════════════════════════════════

function ColdPressures({ element, snapshot, unitSystem = 'metric', variant }: NewWidgetProps & { variant: 'futuristic' | 'minimal' }): ReactElement {
  const s = element.style
  const cp = snapshot?.tireColdPressuresKpa
  const unit = formatMeasurement(undefined, 'pressure-kpa', unitSystem).unit
  const target = s.targetValue ?? 165
  const tol = s.tolerance ?? 7
  const label = (s.label ?? 'COLD PRESSURE').toString()
  const minimal = variant === 'minimal'

  const cell = (c: CornerKey): ReactElement => {
    const v = cp?.[c]
    const has = isFiniteNum(v)
    const color = minimal ? GT3.textPrimary : has ? pressureColor(v as number, target, tol) : GT3.textMuted
    return (
      <div key={c} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, border: minimal ? 'none' : `1px solid ${TRACK}`, borderRadius: 3, padding: '2px 0' }}>
        <Cap element={element} slot="label" size={Math.max(11, Math.round(element.h * 0.08))}>{COLD_LABEL[c]}</Cap>
        <SlotText element={element} slot="value" family={readoutFont(has ? formatMeasurement(v, 'pressure-kpa', unitSystem, { decimals: 1 }).display : '—')} size={Math.max(13, Math.round(element.h * 0.18))} color={color} weight={600}>{formatMeasurement(v, 'pressure-kpa', unitSystem, { decimals: 1 }).display}</SlotText>
      </div>
    )
  }

  return (
    <Box element={element} chrome={chromeOf(element, { radius: s.radius ?? (minimal ? 2 : 8), plain: minimal && s.background === undefined })} padding={minimal ? 10 : 8} className={`cold-pressures-${variant}`}>
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <Cap element={element} slot="header" color={minimal ? GT3.textMuted : accentOf(s, WARM_GOLD)}>{label}</Cap>
          <SlotText element={element} slot="unit" family={FONT_TECH} size={Math.max(11, Math.round(element.h * 0.1))} color={GT3.textMuted}>{unit}</SlotText>
        </div>
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 4 }}>
          {COLD_CORNERS.map(cell)}
        </div>
      </div>
    </Box>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Session clock (time of day)
// ═══════════════════════════════════════════════════════════════════════════

function SessionClock({ element, snapshot, variant }: NewWidgetProps & { variant: 'futuristic' | 'minimal' }): ReactElement {
  const s = element.style
  const sec = snapshot?.sessionTimeOfDay
  const time = formatTimeOfDay(sec) ?? '--:--'
  if (usesInstrument(element)) {
    return <SegmentInstrument element={element} value={isFiniteNum(sec) ? time : '—'} label={s.label ? String(s.label) : 'TIME OF DAY'} />
  }
  const hh = isFiniteNum(sec) ? Math.floor(((sec % 86400) + 86400) % 86400 / 3600) : -1
  const daytime = hh >= 6 && hh < 19
  const label = (s.label ?? 'TIME OF DAY').toString()
  const accent = accentOf(s, WARM_GOLD)

  if (variant === 'minimal') {
    return (
      <Box element={element} chrome={chromeOf(element, { radius: s.radius ?? 2, plain: s.background === undefined })} padding={12} className="clock-minimal">
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4 }}>
          <Cap element={element} slot="label">{label}</Cap>
          <SlotText element={element} slot="value" family={FONT_CONDENSED} size={Math.max(24, Math.round(element.h * 0.46))} color={GT3.textPrimary} weight={600} base={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em' }}>{time}</SlotText>
        </div>
      </Box>
    )
  }

  return (
    <Box element={element} chrome={chromeOf(element, { radius: s.radius ?? 8 })} padding={10} className="clock-futuristic">
      <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 6 }}>
        <div style={{ position: 'absolute', top: 6, left: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: daytime ? COOL_CYAN : WARM_GOLD, boxShadow: `0 0 8px ${daytime ? COOL_CYAN : WARM_GOLD}` }} />
          <Cap element={element} slot="label" color={accent}>{label}</Cap>
        </div>
        <SlotText element={element} slot="value" family={readoutFont(time)} size={Math.max(28, Math.round(element.h * 0.5))} color={GT3.textPrimary} weight={700} base={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '0.04em' }}>{time}</SlotText>
      </div>
    </Box>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Pit status panel
// ═══════════════════════════════════════════════════════════════════════════

interface PitLamp { tag: string; on: boolean; color: string; state: string }

function pitLamps(pit: PitStatus | undefined): PitLamp[] {
  const open = pit?.pitsOpen
  return [
    // Pits open = good (green); closed = warm warning.
    { tag: 'PITS', on: Boolean(open), color: open ? COOL_GREEN : WARM_RED, state: open === undefined ? '—' : open ? 'OPEN' : 'SHUT' },
    // In the assigned stall = informational (blue).
    { tag: 'STALL', on: Boolean(pit?.inPitStall), color: COOL_BLUE, state: pit?.inPitStall ? 'IN' : 'OUT' },
    // Mandatory repair outstanding = warm danger.
    { tag: 'REPAIR', on: Boolean(pit?.repairNeeded), color: WARM_RED, state: pit?.repairNeeded ? 'REQ' : 'OK' },
    // Optional repair available = warm caution.
    { tag: 'OPT', on: Boolean(pit?.optRepairNeeded), color: WARM_AMBER, state: pit?.optRepairNeeded ? 'AVL' : 'OK' }
  ]
}

function PitStatusPanel({ element, snapshot, variant }: NewWidgetProps & { variant: 'futuristic' | 'minimal' }): ReactElement {
  const s = element.style
  const lamps = pitLamps(snapshot?.pit)
  const label = (s.label ?? 'PIT').toString()
  const minimal = variant === 'minimal'
  if (usesInstrument(element)) {
    const iconByTag: Record<string, TelltaleLamp['icon']> = {
      PITS: 'pit-limiter', STALL: 'fuel', REPAIR: 'damage', OPT: 'damage'
    }
    const tl: TelltaleLamp[] = lamps.map((l) => ({
      icon: iconByTag[l.tag] ?? 'pit-limiter',
      active: l.on,
      activeColor: l.color,
      label: l.tag
    }))
    return <TelltaleInstrument element={element} lamps={tl} columns={2} />
  }

  if (minimal) {
    return (
      <Box element={element} chrome={chromeOf(element, { radius: s.radius ?? 2, plain: s.background === undefined })} padding={12} className="pit-status-minimal">
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 5 }}>
          <Cap element={element} slot="label">{label}</Cap>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {lamps.map((l) => (
              <div key={l.tag} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Cap element={element} slot="tag" size={Math.max(11, Math.round(element.h * 0.09))}>{l.tag}</Cap>
                <SlotText element={element} slot="value" family={FONT_TECH} size={Math.max(12, Math.round(element.h * 0.1))} color={l.on ? l.color : GT3.textSecondary} base={{ letterSpacing: '0.1em' }}>{l.state}</SlotText>
              </div>
            ))}
          </div>
        </div>
      </Box>
    )
  }

  return (
    <Box element={element} chrome={chromeOf(element, { radius: s.radius ?? 8 })} padding={10} className="pit-status-futuristic">
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Cap element={element} slot="label" color={accentOf(s, WARM_GOLD)}>{label}</Cap>
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 5 }}>
          {lamps.map((l) => (
            <div key={l.tag} style={{ display: 'flex', alignItems: 'center', gap: 6, border: `1px solid ${l.on ? l.color : TRACK}`, borderRadius: 3, padding: '2px 6px', boxShadow: l.on ? `0 0 8px ${l.color}44, inset 0 0 6px ${l.color}22` : 'none' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', flex: '0 0 auto', background: l.on ? l.color : TRACK, boxShadow: l.on ? `0 0 6px ${l.color}` : 'none' }} />
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <Cap element={element} slot="tag" size={Math.max(11, Math.round(element.h * 0.08))}>{l.tag}</Cap>
                <SlotText element={element} slot="value" family={FONT_CONDENSED} size={Math.max(12, Math.round(element.h * 0.14))} color={l.on ? l.color : GT3.textSecondary} weight={700}>{l.state}</SlotText>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Box>
  )
}

// ── Registry + dispatch ──────────────────────────────────────────────────────
export const TELEMETRY_WIDGET_TYPES = [
  'ers-bar-futuristic', 'ers-bar-minimal',
  'ers-radial-futuristic', 'ers-radial-minimal',
  'p2p-futuristic', 'p2p-minimal',
  'weather-status-futuristic', 'weather-status-minimal',
  'track-surface-futuristic', 'track-surface-minimal',
  'bop-futuristic', 'bop-minimal',
  'cold-pressures-futuristic', 'cold-pressures-minimal',
  'clock-futuristic', 'clock-minimal',
  'pit-status-futuristic', 'pit-status-minimal'
] as const

export function renderTelemetryWidget(props: { element: DashboardElement; snapshot: TelemetrySnapshot | null }): ReactElement | null {
  switch (props.element.type) {
    case 'ers-bar-futuristic': return <ErsBar {...props} variant="futuristic" />
    case 'ers-bar-minimal': return <ErsBar {...props} variant="minimal" />
    case 'ers-radial-futuristic': return <ErsRadial {...props} variant="futuristic" />
    case 'ers-radial-minimal': return <ErsRadial {...props} variant="minimal" />
    case 'p2p-futuristic': return <PushToPass {...props} variant="futuristic" />
    case 'p2p-minimal': return <PushToPass {...props} variant="minimal" />
    case 'weather-status-futuristic': return <WeatherStatus {...props} variant="futuristic" />
    case 'weather-status-minimal': return <WeatherStatus {...props} variant="minimal" />
    case 'track-surface-futuristic': return <TrackSurface {...props} variant="futuristic" />
    case 'track-surface-minimal': return <TrackSurface {...props} variant="minimal" />
    case 'bop-futuristic': return <Bop {...props} variant="futuristic" />
    case 'bop-minimal': return <Bop {...props} variant="minimal" />
    case 'cold-pressures-futuristic': return <ColdPressures {...props} variant="futuristic" />
    case 'cold-pressures-minimal': return <ColdPressures {...props} variant="minimal" />
    case 'clock-futuristic': return <SessionClock {...props} variant="futuristic" />
    case 'clock-minimal': return <SessionClock {...props} variant="minimal" />
    case 'pit-status-futuristic': return <PitStatusPanel {...props} variant="futuristic" />
    case 'pit-status-minimal': return <PitStatusPanel {...props} variant="minimal" />
    default: return null
  }
}
