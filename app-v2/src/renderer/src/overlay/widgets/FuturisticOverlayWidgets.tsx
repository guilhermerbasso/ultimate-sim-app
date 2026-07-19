// ═══════════════════════════════════════════════════════════════════════════════
// Futuristic overlay fleet — KIT rebuild (v2.39).
// ───────────────────────────────────────────────────────────────────────────────
// Every widget renders ONE root <svg viewBox="0 0 W H" preserveAspectRatio="…"
// width="100%" height="100%"> and composes with the shared design-system KIT:
//   • resolveSkin('gt3'|'hud') for palette/material/led/segment tokens
//   • makeGrid() for fixed grid cells (icons snap; never size to content)
//   • FitText for ALL text (minFontPx>=11; auto-fits into a box, never overflows)
//   • SegmentReadout for DSEG numeric values (wrapped in <g transform>)
//   • RevLedBar with skin.led profile for rev/shift LED strips (blue redline)
//   • AlarmStrip / TelltaleIcon / MOTORSPORT_ICONS for symbolic glyphs
// DASH tokens still drive severity/flag colours; skin tokens drive chrome.
// All numeric derivations are NaN/Infinity-safe → markup never contains
// NaN/undefined/Infinity even when telemetry is extreme (see test).
// ═══════════════════════════════════════════════════════════════════════════════

import { type ReactElement, type ReactNode } from 'react'
import type { DriverEntry, RadarCarEntry, TelemetrySnapshot, TyreInfo } from '../../../../shared/telemetry'
import type { OverlayDesignFamily } from '../../../../shared/overlays'
import { overlayDesignFamily } from '../../../../shared/overlays'
import { formatDelta, formatGear, pct as pct01 } from './format'
import { DASH } from './dashboard-tiles'
import { zoneColorAt, DEFAULT_SHIFT_ZONES } from './LedShiftBar'
import {
  AlarmStrip,
  BarGraph,
  DataField,
  DataTile,
  RevLedBar,
  SegmentReadout,
  TelltaleIcon
} from '../../instruments'
import {
  SHIFT_STROBE_BLUE,
  ShiftStrobe,
  atShiftPoint,
  resolveRevLightPct,
  resolveRevLightState
} from '../../lib/rev-lights'
import { FitText, makeGrid, resolveSkin, type SkinToken } from '../../skins'
import type { WidgetProps } from './types'
import { formatMeasurement } from '../../../../shared/units'
import { useUnitSystem } from '../../lib/units'

// ── DASH-derived state colours (preserve the exact test-asserted tokens) ─────
const WARM_RED = DASH.red
const WARM_ORANGE = DASH.orange
const WARM_AMBER = DASH.amber
const GOOD = DASH.green
const SHIFT_BLUE = DASH.blue
const STEEL = DASH.textDim

// ── NaN/Infinity-safe numeric helpers ────────────────────────────────────────
function clamp(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function finite(value: number | undefined | null, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function safeGear(gear: number | undefined): string {
  return Number.isFinite(gear) ? formatGear(gear) : '—'
}

function familyOf(config: WidgetProps['config']): OverlayDesignFamily {
  return overlayDesignFamily(config?.stylePreset)
}

/** Skin per family — neon/glass → HUD (glass), everything else → GT3 (carbon). */
function skinFor(family: OverlayDesignFamily): SkinToken {
  return resolveSkin(family === 'neon' || family === 'glass' ? 'hud' : 'gt3', 'generic')
}

interface Dims {
  W: number
  H: number
}

function dims(config: WidgetProps['config'], fw = 400, fh = 200): Dims {
  const p = config?.position
  const W = Math.max(80, Math.round(finite(p?.width, fw)))
  const H = Math.max(60, Math.round(finite(p?.height, fh)))
  return { W, H }
}

function placedDims(config: WidgetProps['config'], fw = 400, fh = 200, minH = 24): Dims {
  const p = config?.position
  const W = Math.max(80, Math.round(finite(p?.width, fw)))
  const H = Math.max(minH, Math.round(finite(p?.height, fh)))
  return { W, H }
}

function shiftPct(snapshot: TelemetrySnapshot | null): number {
  return resolveRevLightPct(snapshot)
}

function fuelFraction(snapshot: TelemetrySnapshot | null): number {
  const f = snapshot?.fuelLiters
  const c = snapshot?.fuelCapacityLiters
  if (!Number.isFinite(f) || !Number.isFinite(c) || !(c as number)) return 0
  return clamp((f as number) / (c as number))
}

function deltaSec(snapshot: TelemetrySnapshot | null): number {
  return finite(snapshot?.deltaToBestSec ?? snapshot?.deltaToSessionBestSec, 0)
}

function threatSides(snapshot: TelemetrySnapshot | null): {
  left: boolean
  right: boolean
  cars: RadarCarEntry[]
} {
  const cars = snapshot?.radarCars ?? []
  return {
    left: cars.some((car) => car.relativeX < 0 && Math.abs(car.relativeX) <= 5 && Math.abs(car.relativeY) <= 7),
    right: cars.some((car) => car.relativeX > 0 && Math.abs(car.relativeX) <= 5 && Math.abs(car.relativeY) <= 7),
    cars
  }
}

function closestDrivers(snapshot: TelemetrySnapshot | null): DriverEntry[] {
  const drivers = snapshot?.drivers ?? []
  const playerPct = finite(snapshot?.lapDistPct, 0)
  return [...drivers]
    .filter((driver) => driver.lapDistPct !== undefined && Number.isFinite(driver.lapDistPct))
    .sort((a, b) => Math.abs((a.lapDistPct ?? 0) - playerPct) - Math.abs((b.lapDistPct ?? 0) - playerPct))
    .slice(0, 9)
}

/** Warm/red for high load; green/cool for good state (per project colour rule). */
function loadColor(value: number, goodWhenHigh = false): string {
  const p = clamp(value)
  if (goodWhenHigh) return p > 0.66 ? GOOD : p > 0.34 ? WARM_AMBER : WARM_RED
  return p > 0.78 ? WARM_RED : p > 0.55 ? WARM_ORANGE : p > 0.32 ? WARM_AMBER : GOOD
}

function revTone(t: number): string {
  return zoneColorAt(clamp(t), DEFAULT_SHIFT_ZONES)
}

// ── Panel chrome — the outer bezel every widget draws first ──────────────────
function Panel({ W, H, skin }: { W: number; H: number; skin: SkinToken }): ReactElement {
  return (
    <rect
      x={0.5}
      y={0.5}
      width={Math.max(1, W - 1)}
      height={Math.max(1, H - 1)}
      rx={skin.material.radius}
      fill={skin.material.base}
      stroke={skin.material.border}
      strokeWidth={skin.material.borderWidth}
    />
  )
}

function ReadoutPanel({ x, y, width, height, skin, rx = 6 }: { x: number; y: number; width: number; height: number; skin: SkinToken; rx?: number }): ReactElement {
  return (
    <rect
      x={x}
      y={y}
      width={Math.max(1, width)}
      height={Math.max(1, height)}
      rx={rx}
      fill={skin.palette.bg}
      fillOpacity={1}
      stroke={skin.material.border}
      strokeWidth={1}
    />
  )
}

function segmentHeightFor(text: string, width: number, desired: number, min = 14, unit = ''): number {
  const chars = Math.max(1, text.length)
  const unitChars = Math.max(0, unit.length)
  const fit = (Math.max(1, width) - 4) / (chars * 0.66 + 0.4 + unitChars * 0.66 * 0.55)
  return Math.max(min, Math.min(desired, fit))
}

/** Wraps every widget in the canonical root <svg>. */
function Root({
  W,
  H,
  ariaLabel,
  children
}: {
  W: number
  H: number
  ariaLabel?: string
  children: ReactNode
}): ReactElement {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      role="img"
      aria-label={ariaLabel}
    >
      {children}
    </svg>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
//  Widgets — futuristic exports, names + registry keys unchanged.
// ═════════════════════════════════════════════════════════════════════════════

// ── RevCometWidget: full-width LED strip only (no numerics) ──────────────────
export function RevCometWidget({ snapshot, config }: WidgetProps): ReactElement {
  const { W, H } = placedDims(config, 600, 112)
  const skin = skinFor(familyOf(config))
  const state = resolveRevLightState(shiftPct(snapshot), snapshot?.revLights?.blink)
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      width="100%"
      height="100%"
      role="img"
      aria-label="rev comet"
      style={{ display: 'block', background: 'transparent' }}
    >
      <RevLedBar
        pct={state.pct}
        profile={skin.led}
        x={0}
        y={0}
        width={W}
        height={H}
        shiftActive={state.atShiftPoint}
        idPrefix="rd4-revcomet"
      />
    </svg>
  )
}

// ── SideRadarGlyphWidget: left/right threat pills flanking a self-marker ─────
export function SideRadarGlyphWidget({ snapshot, config }: WidgetProps): ReactElement {
  const { W, H } = dims(config, 260, 260)
  const skin = skinFor(familyOf(config))
  const { left, right } = threatSides(snapshot)
  const pad = 14
  const pillW = Math.max(20, (W - pad * 3 - 40) / 2)
  const pillH = Math.max(40, H - pad * 2 - 40)
  const cx = W / 2
  const cy = H / 2
  return (
    <Root W={W} H={H} ariaLabel="side radar">
      <Panel W={W} H={H} skin={skin} />
      <rect
        x={pad}
        y={pad + 20}
        width={pillW}
        height={pillH}
        rx={Math.min(pillW, pillH) / 2}
        fill={left ? WARM_RED : skin.material.base}
        stroke={left ? WARM_RED : skin.material.border}
        strokeWidth={2}
        fillOpacity={left ? 0.65 : 1}
      />
      <rect
        x={W - pad - pillW}
        y={pad + 20}
        width={pillW}
        height={pillH}
        rx={Math.min(pillW, pillH) / 2}
        fill={right ? WARM_RED : skin.material.base}
        stroke={right ? WARM_RED : skin.material.border}
        strokeWidth={2}
        fillOpacity={right ? 0.65 : 1}
      />
      <FitText
        x={pad + pillW / 2}
        y={pad + 12}
        boxW={Math.max(60, pillW)}
        boxH={16}
        text="LEFT"
        fontFamily={skin.typography.label}
        fill={skin.palette.textDim}
        minFontPx={11}
        maxFontPx={14}
        weight={700}
      />
      <FitText
        x={W - pad - pillW / 2}
        y={pad + 12}
        boxW={Math.max(60, pillW)}
        boxH={16}
        text="RIGHT"
        fontFamily={skin.typography.label}
        fill={skin.palette.textDim}
        minFontPx={11}
        maxFontPx={14}
        weight={700}
      />
      <rect x={cx - 10} y={cy - 22} width={20} height={44} rx={4} fill={skin.palette.accent} fillOpacity={0.85} />
      <FitText
        x={cx}
        y={H - pad}
        boxW={Math.max(80, W - pad * 2)}
        boxH={16}
        text={left && right ? 'BOTH SIDES' : left ? 'CAR LEFT' : right ? 'CAR RIGHT' : 'CLEAR'}
        fontFamily={skin.typography.label}
        fill={left || right ? WARM_AMBER : GOOD}
        minFontPx={11}
        maxFontPx={16}
        weight={700}
      />
    </Root>
  )
}

// ── OrbitRadarWidget: concentric rings + blips (no readouts) ─────────────────
export function OrbitRadarWidget({ snapshot, config }: WidgetProps): ReactElement {
  const { W, H } = dims(config, 320, 320)
  const skin = skinFor(familyOf(config))
  const { cars } = threatSides(snapshot)
  const cx = W / 2
  const cy = H / 2
  const rMax = Math.max(20, Math.min(W, H) / 2 - 14)
  return (
    <Root W={W} H={H} ariaLabel="orbit radar">
      <Panel W={W} H={H} skin={skin} />
      <circle cx={cx} cy={cy} r={rMax} fill="none" stroke={skin.material.border} strokeWidth={1} />
      <circle cx={cx} cy={cy} r={rMax * 0.66} fill="none" stroke={skin.material.border} strokeWidth={1} opacity={0.7} />
      <circle cx={cx} cy={cy} r={rMax * 0.33} fill="none" stroke={skin.material.border} strokeWidth={1} opacity={0.5} />
      <line x1={cx - rMax} y1={cy} x2={cx + rMax} y2={cy} stroke={skin.material.border} strokeWidth={1} opacity={0.5} />
      <line x1={cx} y1={cy - rMax} x2={cx} y2={cy + rMax} stroke={skin.material.border} strokeWidth={1} opacity={0.5} />
      <circle cx={cx} cy={cy} r={5} fill={skin.palette.accent} />
      {cars.slice(0, 10).map((car) => {
        const nx = clamp(car.relativeX / 10, -1, 1)
        const ny = clamp(car.relativeY / 35, -1, 1)
        const bx = cx + nx * (rMax - 8)
        const by = cy - ny * (rMax - 8)
        const threat = Math.abs(car.relativeX) <= 5 && Math.abs(car.relativeY) <= 7
        return (
          <circle
            key={car.carIdx}
            cx={bx}
            cy={by}
            r={threat ? 6 : 4}
            fill={threat ? WARM_RED : car.classColor ?? skin.palette.text}
          />
        )
      })}
    </Root>
  )
}

// ── RelativeBeaconsWidget: horizontal axis with car beacons ──────────────────
export function RelativeBeaconsWidget({ snapshot, config }: WidgetProps): ReactElement {
  const { W, H } = dims(config, 800, 86)
  const skin = skinFor(familyOf(config))
  const drivers = closestDrivers(snapshot)
  const player = finite(snapshot?.lapDistPct, 0)
  const pad = 16
  const axisY = H / 2 + 6
  const trackW = Math.max(40, W - pad * 2)
  return (
    <Root W={W} H={H} ariaLabel="relative beacons">
      <Panel W={W} H={H} skin={skin} />
      <line x1={pad} y1={axisY} x2={pad + trackW} y2={axisY} stroke={skin.material.border} strokeWidth={2} />
      {drivers.map((driver) => {
        const deltaPct = (((driver.lapDistPct ?? player) - player + 1.5) % 1) - 0.5
        const nx = clamp(0.5 + deltaPct * 0.86, 0.02, 0.98)
        const bx = pad + nx * trackW
        const isPlayer = !!driver.isPlayer
        return (
          <circle
            key={driver.carIdx}
            cx={bx}
            cy={axisY}
            r={isPlayer ? 9 : 6}
            fill={isPlayer ? WARM_ORANGE : driver.classColor ?? WARM_AMBER}
            stroke={isPlayer ? skin.palette.text : 'none'}
            strokeWidth={isPlayer ? 1.5 : 0}
          />
        )
      })}
      <FitText
        x={W / 2}
        y={H - 10}
        boxW={Math.max(120, W - pad * 2)}
        boxH={14}
        text="RELATIVE FIELD"
        fontFamily={skin.typography.label}
        fill={skin.palette.textDim}
        minFontPx={11}
        maxFontPx={12}
        weight={600}
        letterSpacing={2}
      />
    </Root>
  )
}

// ── RelativeLadderWidget: vertical rungs for ahead/behind gap ────────────────
export function RelativeLadderWidget({ snapshot, config }: WidgetProps): ReactElement {
  const { W, H } = dims(config, 110, 360)
  const skin = skinFor(familyOf(config))
  const ahead = snapshot?.relatives?.ahead
  const behind = snapshot?.relatives?.behind
  const aheadPct = clamp(Math.abs(finite(ahead?.gapSec, 0)) / 8)
  const behindPct = clamp(Math.abs(finite(behind?.gapSec, 0)) / 8)
  const pad = 12
  const axisX = W / 2
  const midY = H / 2
  const trackH = Math.max(40, H - pad * 2)
  const halfTrack = trackH / 2
  const aheadY = pad + halfTrack - aheadPct * halfTrack
  const behindY = midY + behindPct * halfTrack
  const rungW = Math.max(20, W - pad * 2)
  return (
    <Root W={W} H={H} ariaLabel="relative ladder">
      <Panel W={W} H={H} skin={skin} />
      <line x1={axisX} y1={pad} x2={axisX} y2={pad + trackH} stroke={skin.material.border} strokeWidth={2} />
      <line x1={axisX - Math.min(16, rungW / 2)} y1={midY} x2={axisX + Math.min(16, rungW / 2)} y2={midY} stroke={skin.palette.accent} strokeWidth={2} />
      <rect
        x={axisX - rungW / 2}
        y={aheadY - 6}
        width={rungW}
        height={12}
        rx={3}
        fill={ahead?.classColor ?? WARM_AMBER}
      />
      <rect
        x={axisX - rungW / 2}
        y={behindY - 6}
        width={rungW}
        height={12}
        rx={3}
        fill={behind?.classColor ?? WARM_ORANGE}
      />
      <FitText
        x={axisX}
        y={pad + halfTrack * 0.4}
        boxW={rungW}
        boxH={14}
        text="AHEAD"
        fontFamily={skin.typography.label}
        fill={skin.palette.textDim}
        minFontPx={11}
        maxFontPx={12}
        weight={600}
      />
      <FitText
        x={axisX}
        y={midY + halfTrack * 0.6}
        boxW={rungW}
        boxH={14}
        text="BEHIND"
        fontFamily={skin.typography.label}
        fill={skin.palette.textDim}
        minFontPx={11}
        maxFontPx={12}
        weight={600}
      />
    </Root>
  )
}

// ── DeltaNeedleWidget: arc + needle + delta readout ──────────────────────────
export function DeltaNeedleWidget({ snapshot, config }: WidgetProps): ReactElement {
  const { W, H } = dims(config, 360, 180)
  const skin = skinFor(familyOf(config))
  const d = deltaSec(snapshot)
  const good = d < -0.0005
  const tint = good ? GOOD : d > 0.0005 ? WARM_ORANGE : STEEL
  const cx = W / 2
  const arcR = Math.max(30, Math.min(W * 0.42, H * 0.75))
  const arcY = H * 0.72
  const startX = cx - arcR
  const endX = cx + arcR
  const topY = arcY - arcR
  const angleDeg = clamp(d / 2, -1, 1) * 78
  const rad = (angleDeg * Math.PI) / 180
  const needleLen = arcR * 0.9
  const needleX = cx + Math.sin(rad) * needleLen
  const needleY = arcY - Math.cos(rad) * needleLen
  const readoutText = formatDelta(d)
  const readoutW = Math.max(96, Math.min(W - 24, 190))
  const readoutH = segmentHeightFor(readoutText, readoutW, Math.max(18, Math.min(28, H * 0.16)), 14)
  const readoutBoxH = readoutH + 8
  const readoutX = cx - readoutW / 2
  const readoutY = H - readoutBoxH - 6
  return (
    <Root W={W} H={H} ariaLabel="delta needle">
      <Panel W={W} H={H} skin={skin} />
      <path
        d={`M ${startX} ${arcY} A ${arcR} ${arcR} 0 0 1 ${endX} ${arcY}`}
        fill="none"
        stroke={skin.material.border}
        strokeWidth={4}
      />
      <path
        d={`M ${startX} ${arcY} A ${arcR} ${arcR} 0 0 1 ${cx - 8} ${topY + 10}`}
        fill="none"
        stroke={GOOD}
        strokeWidth={3}
        opacity={0.55}
      />
      <path
        d={`M ${cx + 8} ${topY + 10} A ${arcR} ${arcR} 0 0 1 ${endX} ${arcY}`}
        fill="none"
        stroke={WARM_ORANGE}
        strokeWidth={3}
        opacity={0.55}
      />
      <line x1={cx} y1={arcY} x2={needleX} y2={needleY} stroke={tint} strokeWidth={4} strokeLinecap="round" />
      <circle cx={cx} cy={arcY} r={7} fill={tint} />
      <ReadoutPanel x={readoutX} y={readoutY} width={readoutW} height={readoutBoxH} skin={skin} />
      <g transform={`translate(${readoutX}, ${readoutY + 2})`}>
        <SegmentReadout
          value={readoutText}
          height={readoutH}
          width={readoutW}
          align="center"
          color={tint}
          idPrefix="rd4-delta-needle"
        />
      </g>
    </Root>
  )
}

// ── DeltaRibbonWidget: bipolar bar with a moving marker ──────────────────────
export function DeltaRibbonWidget({ snapshot, config }: WidgetProps): ReactElement {
  const { W, H } = dims(config, 520, 90)
  const skin = skinFor(familyOf(config))
  const d = deltaSec(snapshot)
  const good = d < -0.0005
  const tint = good ? GOOD : d > 0.0005 ? WARM_ORANGE : STEEL
  const pad = 14
  const ribbonH = 14
  const ribbonY = H * 0.36
  const ribbonW = Math.max(40, W - pad * 2)
  const nx = clamp(0.5 + clamp(d / 1.5, -1, 1) * 0.46, 0, 1)
  const markerX = pad + nx * ribbonW
  const readoutText = formatDelta(d)
  const readoutW = Math.max(96, Math.min(W - 24, 180))
  const readoutH = segmentHeightFor(readoutText, readoutW, Math.max(18, Math.min(28, H * 0.32)), 14)
  const readoutBoxH = readoutH + 8
  const readoutX = W / 2 - readoutW / 2
  const readoutY = H - readoutBoxH - 6
  return (
    <Root W={W} H={H} ariaLabel="delta ribbon">
      <Panel W={W} H={H} skin={skin} />
      <rect x={pad} y={ribbonY} width={ribbonW} height={ribbonH} rx={ribbonH / 2} fill={skin.material.border} />
      <line
        x1={pad + ribbonW / 2}
        y1={ribbonY - 4}
        x2={pad + ribbonW / 2}
        y2={ribbonY + ribbonH + 4}
        stroke={skin.palette.accent}
        strokeWidth={2}
      />
      <rect x={markerX - 4} y={ribbonY - 5} width={8} height={ribbonH + 10} rx={2} fill={tint} />
      <ReadoutPanel x={readoutX} y={readoutY} width={readoutW} height={readoutBoxH} skin={skin} />
      <g transform={`translate(${readoutX}, ${readoutY + 2})`}>
        <SegmentReadout
          value={readoutText}
          height={readoutH}
          width={readoutW}
          align="center"
          color={tint}
          idPrefix="rd4-delta-ribbon"
        />
      </g>
    </Root>
  )
}

// ── GearRingWidget: gigantic gear numeral centred in a rev-tinted ring ───────
export function GearRingWidget({ snapshot, config }: WidgetProps): ReactElement {
  const { W, H } = dims(config, 230, 230)
  const skin = skinFor(familyOf(config))
  const pct = shiftPct(snapshot)
  const flash = atShiftPoint(pct, snapshot?.revLights?.blink, 0.985)
  const color = flash ? SHIFT_STROBE_BLUE : revTone(pct)
  const gear = safeGear(snapshot?.gear)
  const cx = W / 2
  const cy = H / 2
  const rOuter = Math.max(30, Math.min(W, H) / 2 - 10)
  const rInner = Math.max(20, rOuter - 12)
  const sweep = clamp(pct) * Math.PI * 2
  const largeArc = sweep > Math.PI ? 1 : 0
  const arcEndX = cx + Math.sin(sweep) * rOuter
  const arcEndY = cy - Math.cos(sweep) * rOuter
  const gearH = Math.max(40, Math.min(rInner * 1.4, H * 0.7))
  const gearBoxW = Math.max(60, gearH * 0.9)
  return (
    <Root W={W} H={H} ariaLabel="gear ring">
      <Panel W={W} H={H} skin={skin} />
      <circle cx={cx} cy={cy} r={rOuter} fill="none" stroke={skin.material.border} strokeWidth={6} />
      <circle cx={cx} cy={cy} r={rInner} fill={skin.material.base} />
      <FitText
        x={cx}
        y={cy - rInner + 14}
        boxW={Math.max(60, rInner * 1.4)}
        boxH={16}
        text="GEAR"
        fontFamily={skin.typography.label}
        fill={skin.palette.textDim}
        minFontPx={11}
        maxFontPx={14}
        weight={700}
        letterSpacing={2}
      />
      <g data-shift-cue="gear-ring-progress-numeral" data-shift-active={flash ? 'true' : 'false'}>
        <ShiftStrobe active={flash} />
        {pct > 0 && sweep < Math.PI * 2 - 0.001 && (
          <path
            data-shift-part="progress-ring"
            d={`M ${cx} ${cy - rOuter} A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${arcEndX} ${arcEndY}`}
            fill="none"
            stroke={color}
            strokeWidth={6}
          />
        )}
        {sweep >= Math.PI * 2 - 0.001 && (
          <circle data-shift-part="progress-ring" cx={cx} cy={cy} r={rOuter} fill="none" stroke={color} strokeWidth={6} />
        )}
        <g data-shift-part="gear-numeral" transform={`translate(${cx - gearBoxW / 2}, ${cy - gearH / 2 + 4})`}>
          <SegmentReadout
            value={gear}
            height={gearH}
            width={gearBoxW}
            align="center"
            color={color}
            idPrefix="rd4-gearring"
          />
        </g>
      </g>
    </Root>
  )
}

// ── SpeedGlyphWidget: giant speed numerals + KM/H label + fill bar ───────────
export function SpeedGlyphWidget({ snapshot, config }: WidgetProps): ReactElement {
  const unitSystem = useUnitSystem()
  const { W, H } = dims(config, 360, 130)
  const skin = skinFor(familyOf(config))
  const canonicalSpeed = finite(snapshot?.speedKmh, 0)
  const speed = formatMeasurement(snapshot?.speedKmh, 'speed-kmh', unitSystem, { decimals: 0 })
  const pct = clamp(canonicalSpeed / 340)
  const pad = 12
  const grid = makeGrid(1, 2, W, H, 6)
  const numCell = grid.cell(0, 0)
  const barCell = grid.cell(0, 1)
  const numText = speed.display
  const numW = Math.max(80, W - pad * 2)
  const numH = segmentHeightFor(numText, numW, Math.max(24, Math.min(numCell.h - 18, 74)), 18)
  const numBoxH = numH + 8
  const numX = pad
  const numY = Math.max(numCell.y + 18, Math.min(numCell.y + numCell.h - numBoxH, numCell.y + (numCell.h - numBoxH) / 2 + 10))
  return (
    <Root W={W} H={H} ariaLabel="speed">
      <Panel W={W} H={H} skin={skin} />
      <FitText
        x={pad}
        y={pad + 10}
        boxW={80}
        boxH={16}
        text={speed.unit.toUpperCase()}
        anchor="start"
        fontFamily={skin.typography.label}
        fill={skin.palette.textDim}
        minFontPx={11}
        maxFontPx={14}
        weight={700}
        letterSpacing={2}
      />
      <ReadoutPanel x={numX} y={numY} width={numW} height={numBoxH} skin={skin} />
      <g transform={`translate(${numX}, ${numY + 2})`}>
        <SegmentReadout
          value={numText}
          height={numH}
          width={numW}
          align="center"
          color={WARM_ORANGE}
          idPrefix="rd4-speed"
        />
      </g>
      <BarGraph
        x={pad}
        y={barCell.y}
        width={Math.max(40, W - pad * 2)}
        height={Math.max(10, Math.min(barCell.h, 18))}
        fraction={pct}
        orientation="h"
        warnAt={0.7}
        critAt={0.9}
        skin={skin}
      />
    </Root>
  )
}

// ── FuelOrbWidget: circular gauge with % readout ─────────────────────────────
export function FuelOrbWidget({ snapshot, config }: WidgetProps): ReactElement {
  const { W, H } = dims(config, 180, 180)
  const skin = skinFor(familyOf(config))
  const pct = fuelFraction(snapshot)
  const cx = W / 2
  const cy = H / 2
  const rOuter = Math.max(20, Math.min(W, H) / 2 - 8)
  const rInner = Math.max(14, rOuter - 10)
  const color = loadColor(pct, true)
  const sweep = clamp(pct) * Math.PI * 2
  const largeArc = sweep > Math.PI ? 1 : 0
  const arcEndX = cx + Math.sin(sweep) * rOuter
  const arcEndY = cy - Math.cos(sweep) * rOuter
  const readoutText = String(Math.round(pct * 100))
  const readoutBoxW = Math.max(64, Math.min(W - 24, rInner * 1.8))
  const readoutH = segmentHeightFor(readoutText, readoutBoxW, Math.max(18, Math.min(36, rInner * 0.62)), 14)
  const readoutBoxH = readoutH + 8
  const readoutX = cx - readoutBoxW / 2
  const readoutY = cy - readoutBoxH / 2 + 2
  return (
    <Root W={W} H={H} ariaLabel="fuel orb">
      <Panel W={W} H={H} skin={skin} />
      <circle cx={cx} cy={cy} r={rOuter} fill="none" stroke={skin.material.border} strokeWidth={5} />
      {pct > 0 && sweep < Math.PI * 2 - 0.001 && (
        <path
          d={`M ${cx} ${cy - rOuter} A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${arcEndX} ${arcEndY}`}
          fill="none"
          stroke={color}
          strokeWidth={5}
        />
      )}
      {sweep >= Math.PI * 2 - 0.001 && (
        <circle cx={cx} cy={cy} r={rOuter} fill="none" stroke={color} strokeWidth={5} />
      )}
      <circle cx={cx} cy={cy} r={rInner} fill={skin.material.base} />
      <FitText
        x={cx}
        y={cy - rInner * 0.55}
        boxW={Math.max(60, rInner * 1.6)}
        boxH={14}
        text="FUEL"
        fontFamily={skin.typography.label}
        fill={skin.palette.textDim}
        minFontPx={11}
        maxFontPx={13}
        weight={700}
        letterSpacing={2}
      />
      <ReadoutPanel x={readoutX} y={readoutY} width={readoutBoxW} height={readoutBoxH} skin={skin} rx={Math.min(8, rInner / 3)} />
      <g transform={`translate(${readoutX}, ${readoutY + 2})`}>
        <SegmentReadout
          value={readoutText}
          height={readoutH}
          width={readoutBoxW}
          align="center"
          color={color}
          idPrefix="rd4-fuelorb"
        />
      </g>
      <FitText
        x={cx}
        y={cy + rInner * 0.55}
        boxW={Math.max(40, rInner * 1.2)}
        boxH={12}
        text="%"
        fontFamily={skin.typography.label}
        fill={skin.palette.textDim}
        minFontPx={11}
        maxFontPx={12}
        weight={700}
      />
    </Root>
  )
}

// ── FuelLapsPipsWidget: 12 pips + DataTile "FUEL LAPS" (aria-label anchor) ───
export function FuelLapsPipsWidget({ snapshot, config }: WidgetProps): ReactElement {
  const { W, H } = dims(config, 390, 92)
  const skin = skinFor(familyOf(config))
  const rawFuel = snapshot?.fuelLiters
  const rawBurn = snapshot?.fuelPerLap
  const hasFuel = Number.isFinite(rawFuel) && Number.isFinite(rawBurn) && (rawBurn as number) > 0
  const laps = hasFuel ? (rawFuel as number) / Math.max(0.1, rawBurn as number) : NaN
  const capped = Number.isFinite(laps) ? clamp(laps / 12) : 0
  const lapColor = loadColor(capped, true)
  const pipCount = 12
  const active = Math.round(capped * pipCount)
  const pad = 10
  const tileW = Math.max(120, Math.min(160, Math.floor(W * 0.42)))
  const tileH = Math.max(48, H - pad * 2)
  const tileX = W - tileW - pad
  const tileY = pad + (H - pad * 2 - tileH) / 2
  const pipsX = pad
  const pipsW = Math.max(40, tileX - pad * 2)
  const pipsY = pad
  const pipsH = H - pad * 2
  const gap = 4
  const cellW = Math.max(4, (pipsW - gap * (pipCount - 1)) / pipCount)
  return (
    <Root W={W} H={H} ariaLabel="fuel pips">
      <Panel W={W} H={H} skin={skin} />
      <FitText
        x={pipsX}
        y={pipsY + 8}
        boxW={Math.max(80, pipsW)}
        boxH={14}
        text="LAPS LEFT"
        anchor="start"
        fontFamily={skin.typography.label}
        fill={skin.palette.textDim}
        minFontPx={11}
        maxFontPx={13}
        weight={700}
        letterSpacing={1.5}
      />
      {Array.from({ length: pipCount }, (_, i) => {
        const on = i < active
        return (
          <rect
            key={i}
            x={pipsX + i * (cellW + gap)}
            y={pipsY + 22}
            width={cellW}
            height={Math.max(10, pipsH - 26)}
            rx={2}
            fill={on ? lapColor : skin.material.border}
            fillOpacity={on ? 1 : 0.6}
          />
        )
      })}
      <g transform={`translate(${tileX}, ${tileY})`}>
        <DataTile
          label="FUEL LAPS"
          value={hasFuel && Number.isFinite(laps) ? laps.toFixed(1) : '—'}
          unit="LAP"
          width={tileW}
          height={tileH}
          color={lapColor}
          accent={WARM_AMBER}
          material="carbon"
          idPrefix="rd4-fuel-laps"
        />
      </g>
    </Root>
  )
}

// ── InputsVectorWidget: 3 pedal bars (T/B/C) + steering marker ───────────────
export function InputsVectorWidget({ snapshot, config }: WidgetProps): ReactElement {
  const { W, H } = dims(config, 260, 220)
  const skin = skinFor(familyOf(config))
  const channels: Array<{ k: string; v: number; c: string }> = [
    { k: 'T', v: pct01(snapshot?.throttle), c: GOOD },
    { k: 'B', v: pct01(snapshot?.brake), c: WARM_RED },
    { k: 'C', v: pct01(snapshot?.clutch), c: WARM_AMBER }
  ]
  const steer = clamp(finite(snapshot?.steerAngleDeg, 0) / 180, -1, 1)
  const pad = 12
  const steerH = 16
  const barsArea = { x: pad, y: pad, w: W - pad * 2, h: H - pad * 2 - steerH - 12 }
  const colW = barsArea.w / channels.length
  return (
    <Root W={W} H={H} ariaLabel="inputs vector">
      <Panel W={W} H={H} skin={skin} />
      {channels.map((ch, i) => {
        const cx = barsArea.x + colW * i
        const barW = Math.max(8, colW * 0.55)
        const barX = cx + (colW - barW) / 2
        const barTop = barsArea.y
        const barBot = barsArea.y + barsArea.h - 18
        const barH = Math.max(1, barBot - barTop)
        const fillH = barH * clamp(ch.v)
        return (
          <g key={ch.k}>
            <rect x={barX} y={barTop} width={barW} height={barH} rx={3} fill={skin.material.border} />
            {ch.v > 0 && (
              <rect x={barX} y={barBot - fillH} width={barW} height={fillH} rx={3} fill={ch.c} />
            )}
            <FitText
              x={cx + colW / 2}
              y={barBot + 12}
              boxW={Math.max(30, colW)}
              boxH={14}
              text={ch.k}
              fontFamily={skin.typography.label}
              fill={ch.c}
              minFontPx={11}
              maxFontPx={14}
              weight={800}
            />
          </g>
        )
      })}
      <line
        x1={pad}
        y1={H - pad - steerH / 2}
        x2={W - pad}
        y2={H - pad - steerH / 2}
        stroke={skin.material.border}
        strokeWidth={2}
      />
      <circle
        cx={W / 2 + steer * ((W - pad * 2) / 2 - 8)}
        cy={H - pad - steerH / 2}
        r={6}
        fill={skin.palette.accent}
      />
    </Root>
  )
}

// ── InputsOscilloscopeWidget: 3 wave paths for T/B/C ─────────────────────────
export function InputsOscilloscopeWidget({ snapshot, config }: WidgetProps): ReactElement {
  const { W, H } = dims(config, 390, 180)
  const skin = skinFor(familyOf(config))
  const t = pct01(snapshot?.throttle)
  const b = pct01(snapshot?.brake)
  const c = pct01(snapshot?.clutch)
  const pad = 12
  const innerW = Math.max(40, W - pad * 2)
  const rowH = Math.max(12, (H - pad * 2) / 3)
  const wave = (value: number, baseY: number): string => {
    const points = Array.from({ length: 20 }, (_, i) => {
      const x = pad + (i / 19) * innerW
      const yOffset = Math.sin(i * 0.7 + value * 4) * (rowH * 0.14)
      const y = baseY - value * (rowH * 0.42) + yOffset
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    })
    return points.join(' ')
  }
  const rows: Array<{ key: string; v: number; color: string }> = [
    { key: 'T', v: t, color: GOOD },
    { key: 'B', v: b, color: WARM_RED },
    { key: 'C', v: c, color: WARM_AMBER }
  ]
  return (
    <Root W={W} H={H} ariaLabel="inputs scope">
      <Panel W={W} H={H} skin={skin} />
      {rows.map((row, i) => {
        const baseY = pad + rowH * (i + 0.75)
        return (
          <g key={row.key}>
            <line
              x1={pad}
              y1={baseY}
              x2={W - pad}
              y2={baseY}
              stroke={skin.material.border}
              strokeWidth={1}
              opacity={0.6}
            />
            <path d={wave(row.v, baseY)} fill="none" stroke={row.color} strokeWidth={2} />
            <FitText
              x={pad + 4}
              y={pad + rowH * (i + 0.25) + 6}
              boxW={30}
              boxH={12}
              text={row.key}
              anchor="start"
              fontFamily={skin.typography.label}
              fill={row.color}
              minFontPx={11}
              maxFontPx={12}
              weight={800}
            />
          </g>
        )
      })}
    </Root>
  )
}

// ── TyreHaloGridWidget: 2×2 grid of tyre corner DataFields ───────────────────
export function TyreHaloGridWidget({ snapshot, config }: WidgetProps): ReactElement {
  const { W, H } = dims(config, 260, 260)
  const skin = skinFor(familyOf(config))
  const tyres = snapshot?.tyres
  const data: Array<{ k: string; tyre?: TyreInfo; col: number; row: number }> = [
    { k: 'LF', tyre: tyres?.lf, col: 0, row: 0 },
    { k: 'RF', tyre: tyres?.rf, col: 1, row: 0 },
    { k: 'LR', tyre: tyres?.lr, col: 0, row: 1 },
    { k: 'RR', tyre: tyres?.rr, col: 1, row: 1 }
  ]
  const grid = makeGrid(2, 2, W, H, 10)
  return (
    <Root W={W} H={H} ariaLabel="tyre halo">
      <Panel W={W} H={H} skin={skin} />
      {data.map(({ k, tyre, col, row }) => {
        const cell = grid.cell(col, row)
        const temp = Number.isFinite(tyre?.tempC) ? Math.round(tyre?.tempC as number) : undefined
        const wear = Number.isFinite(tyre?.wearPct) ? clamp(tyre?.wearPct as number) : undefined
        const wearGood = wear === undefined ? 0.86 : wear
        const state: 'crit' | 'warn' | 'ok' | 'normal' =
          wearGood < 0.35 ? 'crit' : wearGood < 0.6 ? 'warn' : wearGood < 0.9 ? 'ok' : 'normal'
        return (
          <DataField
            key={k}
            x={cell.x}
            y={cell.y}
            width={cell.w}
            height={cell.h}
            label={k}
            value={temp === undefined ? '—' : String(temp)}
            unit={temp === undefined ? undefined : '°'}
            state={state}
            skin={skin}
          />
        )
      })}
    </Root>
  )
}

// ── BrakeHeatTilesWidget: 2×2 grid of brake corner DataFields ────────────────
export function BrakeHeatTilesWidget({ snapshot, config }: WidgetProps): ReactElement {
  const { W, H } = dims(config, 220, 220)
  const skin = skinFor(familyOf(config))
  const b = snapshot?.brakeTempC
  const data: Array<{ k: string; temp?: number; col: number; row: number }> = [
    { k: 'LF', temp: Number.isFinite(b?.lf) ? (b?.lf as number) : undefined, col: 0, row: 0 },
    { k: 'RF', temp: Number.isFinite(b?.rf) ? (b?.rf as number) : undefined, col: 1, row: 0 },
    { k: 'LR', temp: Number.isFinite(b?.lr) ? (b?.lr as number) : undefined, col: 0, row: 1 },
    { k: 'RR', temp: Number.isFinite(b?.rr) ? (b?.rr as number) : undefined, col: 1, row: 1 }
  ]
  const grid = makeGrid(2, 2, W, H, 10)
  return (
    <Root W={W} H={H} ariaLabel="brake heat">
      <Panel W={W} H={H} skin={skin} />
      {data.map(({ k, temp, col, row }) => {
        const cell = grid.cell(col, row)
        const state: 'crit' | 'warn' | 'ok' | 'normal' =
          temp === undefined ? 'normal' : temp > 620 ? 'crit' : temp > 480 ? 'warn' : temp > 220 ? 'ok' : 'normal'
        return (
          <DataField
            key={k}
            x={cell.x}
            y={cell.y}
            width={cell.w}
            height={cell.h}
            label={k}
            value={temp === undefined ? '—' : String(Math.round(temp))}
            unit={temp === undefined ? undefined : '°'}
            state={state}
            skin={skin}
          />
        )
      })}
    </Root>
  )
}

// ── TrackMapRibbonWidget: horizontal lap-progress bar with car markers ───────
export function TrackMapRibbonWidget({ snapshot, config }: WidgetProps): ReactElement {
  const { W, H } = dims(config, 540, 190)
  const skin = skinFor(familyOf(config))
  const pct = clamp(finite(snapshot?.lapDistPct, 0))
  const others = closestDrivers(snapshot).filter((driver) => !driver.isPlayer).slice(0, 6)
  const pad = 16
  const rail = { x: pad, y: H * 0.45, w: Math.max(40, W - pad * 2), h: 14 }
  return (
    <Root W={W} H={H} ariaLabel="track ribbon">
      <Panel W={W} H={H} skin={skin} />
      <FitText
        x={pad}
        y={pad + 8}
        boxW={Math.max(120, rail.w)}
        boxH={14}
        text="LAP PROGRESS"
        anchor="start"
        fontFamily={skin.typography.label}
        fill={skin.palette.textDim}
        minFontPx={11}
        maxFontPx={13}
        weight={700}
        letterSpacing={1.5}
      />
      <rect x={rail.x} y={rail.y} width={rail.w} height={rail.h} rx={rail.h / 2} fill={skin.material.border} />
      <rect
        x={rail.x}
        y={rail.y}
        width={rail.w * pct}
        height={rail.h}
        rx={rail.h / 2}
        fill={WARM_ORANGE}
        fillOpacity={0.75}
      />
      {others.map((driver) => {
        const dx = rail.x + rail.w * clamp(finite(driver.lapDistPct, 0))
        return (
          <circle
            key={driver.carIdx}
            cx={dx}
            cy={rail.y + rail.h / 2}
            r={6}
            fill={driver.classColor ?? WARM_AMBER}
            stroke={skin.material.base}
            strokeWidth={1}
          />
        )
      })}
      <circle cx={rail.x + rail.w * pct} cy={rail.y + rail.h / 2} r={9} fill={skin.palette.accent} stroke={skin.palette.text} strokeWidth={1.5} />
      <FitText
        x={W - pad}
        y={H - pad}
        boxW={100}
        boxH={22}
        text={`${Math.round(pct * 100)}%`}
        anchor="end"
        fontFamily={skin.typography.label}
        fill={WARM_AMBER}
        minFontPx={11}
        maxFontPx={22}
        weight={800}
      />
    </Root>
  )
}

// ── TrackSectorPulseWidget: N segment bars + SegmentReadout % ────────────────
export function TrackSectorPulseWidget({ snapshot, config }: WidgetProps): ReactElement {
  const { W, H } = dims(config, 700, 70)
  const skin = skinFor(familyOf(config))
  const pct = clamp(finite(snapshot?.lapDistPct, 0))
  const count = 20
  const readoutW = Math.min(120, Math.max(70, Math.floor(W * 0.16)))
  const pad = 10
  const gap = 4
  const barsX = pad
  const barsY = pad + 4
  const barsH = Math.max(14, H - pad * 2 - 8)
  const barsW = Math.max(40, W - pad * 2 - readoutW - 12)
  const cellW = Math.max(3, (barsW - gap * (count - 1)) / count)
  const active = Math.round(pct * count)
  const readoutH = Math.max(18, Math.min(H - pad * 2, 32))
  return (
    <Root W={W} H={H} ariaLabel="track sector pulse">
      <Panel W={W} H={H} skin={skin} />
      {Array.from({ length: count }, (_, i) => {
        const on = i < active
        return (
          <rect
            key={i}
            x={barsX + i * (cellW + gap)}
            y={barsY}
            width={cellW}
            height={barsH}
            rx={2}
            fill={on ? WARM_ORANGE : skin.material.border}
            fillOpacity={on ? 0.85 : 0.6}
          />
        )
      })}
      <g transform={`translate(${W - pad - readoutW}, ${(H - readoutH) / 2})`}>
        <SegmentReadout
          value={`${Math.round(pct * 100)}`}
          height={readoutH}
          width={readoutW}
          align="right"
          color={WARM_AMBER}
          unit="%"
          idPrefix="rd4-sector"
        />
      </g>
    </Root>
  )
}

// ── WeatherGripGlyphWidget: grip% readout + rain telltale when wet ───────────
export function WeatherGripGlyphWidget({ snapshot, config }: WidgetProps): ReactElement {
  const { W, H } = dims(config, 220, 160)
  const skin = skinFor(familyOf(config))
  const wetSeed = snapshot?.isRaining ? 0.7 : 0
  const wet = clamp(finite(snapshot?.trackWetnessPct, wetSeed))
  const grip = clamp(finite(snapshot?.gripPct, 1 - wet))
  const dry = wet <= 0.35
  const grid = makeGrid(1, 2, W, H, 8)
  const numCell = grid.cell(0, 0)
  const stateCell = grid.cell(0, 1)
  const gripText = String(Math.round(grip * 100))
  const readoutW = Math.max(96, Math.min(W - 24, 180))
  const readoutH = segmentHeightFor(gripText, readoutW, Math.max(20, Math.min(numCell.h - 20, 48)), 14, '%')
  const readoutBoxH = readoutH + 8
  const readoutX = (W - readoutW) / 2
  const readoutY = numCell.y + numCell.h - readoutBoxH
  return (
    <Root W={W} H={H} ariaLabel="weather grip">
      <Panel W={W} H={H} skin={skin} />
      <FitText
        x={W / 2}
        y={numCell.y + 10}
        boxW={Math.max(80, W - 24)}
        boxH={14}
        text="GRIP"
        fontFamily={skin.typography.label}
        fill={skin.palette.textDim}
        minFontPx={11}
        maxFontPx={13}
        weight={700}
        letterSpacing={2}
      />
      <ReadoutPanel x={readoutX} y={readoutY} width={readoutW} height={readoutBoxH} skin={skin} />
      <g transform={`translate(${readoutX}, ${readoutY + 2})`}>
        <SegmentReadout
          value={gripText}
          height={readoutH}
          width={readoutW}
          align="right"
          color={dry ? GOOD : WARM_AMBER}
          unit="%"
          idPrefix="rd4-grip"
        />
      </g>
      {dry ? (
        <FitText
          x={W / 2}
          y={stateCell.y + stateCell.h / 2}
          boxW={Math.max(80, W - 24)}
          boxH={Math.min(24, stateCell.h)}
          text="DRY"
          fontFamily={skin.typography.label}
          fill={GOOD}
          minFontPx={11}
          maxFontPx={20}
          weight={800}
          letterSpacing={2}
        />
      ) : (
        <g transform={`translate(${W / 2 - 40}, ${stateCell.y + Math.max(0, (stateCell.h - 24) / 2)})`}>
          <g transform="translate(0, 0)">
            <TelltaleIcon icon="rain" active activeColor={WARM_AMBER} size={24} label={`WET ${Math.round(wet * 100)}%`} idPrefix="rd4-weather-rain" />
          </g>
          <g transform="translate(30, 4)">
            <FitText
              x={0}
              y={10}
              boxW={60}
              boxH={16}
              text={`${Math.round(wet * 100)}%`}
              anchor="start"
              fontFamily={skin.typography.label}
              fill={WARM_AMBER}
              minFontPx={11}
              maxFontPx={16}
              weight={800}
            />
          </g>
        </g>
      )}
    </Root>
  )
}

// ── FlagIconStackWidget: AlarmStrip with flag chips (icon paths + DASH.blue) ─
export function FlagIconStackWidget({ snapshot, config }: WidgetProps): ReactElement {
  const { W, H } = dims(config, 480, 88)
  const skin = skinFor(familyOf(config))
  const flags = snapshot?.flags
  const items: Array<{ k: string; on: boolean; color: string; icon: 'flag-yellow' | 'flag-blue' | 'flag-red' | 'pit-limiter' }> = [
    { k: 'YEL', on: !!flags?.yellow, color: WARM_AMBER, icon: 'flag-yellow' },
    { k: 'BLU', on: !!flags?.blue, color: SHIFT_BLUE, icon: 'flag-blue' },
    { k: 'RED', on: !!(flags?.red || flags?.black || flags?.meatball), color: WARM_RED, icon: 'flag-red' },
    { k: 'LIM', on: !!snapshot?.pitLimiter, color: GOOD, icon: 'pit-limiter' }
  ]
  const pad = 10
  const stripW = Math.max(60, W - pad * 2)
  const stripH = Math.max(28, Math.min(H - pad * 2, 48))
  const stripY = (H - stripH) / 2
  return (
    <Root W={W} H={H} ariaLabel="flag icon stack">
      <Panel W={W} H={H} skin={skin} />
      <g transform={`translate(${pad}, ${stripY})`}>
        <AlarmStrip
          alarms={items.map((item) => ({ label: item.k, active: item.on, color: item.color, icon: item.icon }))}
          width={stripW}
          height={stripH}
          idPrefix="rd4-flags"
        />
      </g>
    </Root>
  )
}
