// Extra HUDs — v2.39 KIT rebuild. Each exported widget renders ONE root <svg>
// sized from config.position (with sane fallbacks), composed of KIT primitives
// (FitText / SegmentReadout / RevLedBar / TelltaleIcon) placed on a makeGrid
// safe area. Design families are collapsed by design: every family still renders
// valid markup because layout no longer branches on family. Chrome colours use
// skin tokens; severity/delta uses DASH tokens (asserted by dashboard-tiles
// contract). Pure + NaN-safe: null/extreme telemetry never emits NaN, undefined
// or Infinity — every value falls back to '—' via the format helpers.

import type { ReactElement } from 'react'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import type { WidgetProps } from './types'
import { formatDelta, formatGear, formatTime, numberOrDash, pct as clampPct } from './format'
import { resolveSkin, FitText, makeGrid, zoneColor, type SkinToken } from '../../skins'
import { RevLedBar, SegmentReadout, TelltaleIcon } from '../../instruments'
import { DASH, FONT_COND } from './dashboard-tiles'

// ── Local NaN-safe helpers ────────────────────────────────────────────────────

function safeNum(v: number | undefined | null, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function dims(config: WidgetProps['config'], fallbackW: number, fallbackH: number): { W: number; H: number } {
  const w = config?.position?.width
  const h = config?.position?.height
  return {
    W: typeof w === 'number' && Number.isFinite(w) && w > 0 ? Math.round(w) : fallbackW,
    H: typeof h === 'number' && Number.isFinite(h) && h > 0 ? Math.round(h) : fallbackH
  }
}

function shiftFrac(s: TelemetrySnapshot | null): number {
  const rpm = safeNum(s?.rpm, 0)
  const maxRpm = Math.max(1, safeNum(s?.maxRpm, 9000))
  const raw =
    typeof s?.shiftIndicatorPct === 'number' && Number.isFinite(s.shiftIndicatorPct)
      ? s.shiftIndicatorPct
      : rpm / maxRpm
  return clampPct(raw)
}

function gearFontFor(g: string, skin: SkinToken): string {
  return /^\d$/.test(g) ? skin.segment.numeric : skin.segment.alpha
}

function opaquePanelFill(skin: SkinToken): string {
  return skin.palette.bg || '#050608'
}

function fitSegmentHeight(value: string, boxW: number, maxH: number, unit = ''): number {
  const chars = Math.max(1, value.length)
  const widthPerPx = chars * 0.66 + 0.4 + unit.length * 0.66 * 0.55
  return Math.max(8, Math.min(maxH, Math.max(8, boxW) / widthPerPx))
}

// formatGear(NaN) returns the literal string 'NaN' (its guard only handles
// undefined) — wrap it here so a broken gear value still degrades cleanly to '—'.
function safeGear(gear: number | undefined | null): string {
  if (typeof gear !== 'number' || !Number.isFinite(gear)) return '—'
  return formatGear(gear)
}

// ═════════════════════════════════════════════════════════════════════════════
//  NeonGearBarWidget — rev-LED strip across the top, hero gear + labelled SPD
//  and SHIFT segment readouts below. Registry key: 'neonGearBar'.
// ═════════════════════════════════════════════════════════════════════════════
export function NeonGearBarWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const { palette, material } = skin
  const { W, H } = dims(config, 600, 120)

  const frac = shiftFrac(snapshot)
  const redline = frac >= 0.97
  const gear = safeGear(snapshot?.gear)
  const speedNum = safeNum(snapshot?.speedKmh, Number.NaN)
  const hasSpeed = Number.isFinite(speedNum)
  const speedStr = hasSpeed ? String(Math.round(speedNum)) : '—'
  const shiftStr = numberOrDash(frac * 100, 0)
  const gearColor = redline ? DASH.red : zoneColor(skin.led, frac)

  // Safe-area grid: LED strip spans the top row; 3-cell body below.
  const grid = makeGrid(3, 2, W, H, 6)
  const ledRect = grid.cell(0, 0, 3, 1)
  const gearCell = grid.cell(0, 1)
  const spdCell = grid.cell(1, 1)
  const shiftCell = grid.cell(2, 1)

  const readoutH = Math.max(16, Math.min(spdCell.h - 8, 36))
  const spdReadoutY = spdCell.y + Math.max(0, (spdCell.h - readoutH - 10) / 2)
  const shiftReadoutY = shiftCell.y + Math.max(0, (shiftCell.h - readoutH - 10) / 2)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      role="img"
      aria-label="Rev / gear / speed"
      data-widget="neonGearBar"
      style={{ display: 'block' }}
    >
      <rect
        x={0.5}
        y={0.5}
        width={W - 1}
        height={H - 1}
        rx={material.radius}
        fill={palette.bg}
        stroke={material.border}
        strokeWidth={material.borderWidth}
      />

      <RevLedBar
        pct={frac}
        profile={skin.led}
        x={ledRect.x}
        y={ledRect.y}
        width={ledRect.w}
        height={ledRect.h}
        flashOn={redline}
        idPrefix="ehw-neongear-led"
      />

      <rect
        x={gearCell.x}
        y={gearCell.y}
        width={gearCell.w}
        height={gearCell.h}
        rx={material.radius * 0.6}
        fill={palette.surface}
        stroke={redline ? DASH.red : material.border}
        strokeWidth={redline ? 2 : 1}
      />
      <FitText
        x={gearCell.x + gearCell.w / 2}
        y={gearCell.y + gearCell.h / 2}
        boxW={gearCell.w * 0.9}
        boxH={gearCell.h * 0.85}
        text={gear}
        anchor="middle"
        baseline="middle"
        fontFamily={gearFontFor(gear, skin)}
        fill={gearColor}
        minFontPx={16}
        maxFontPx={Math.max(20, gearCell.h * 0.85)}
        weight={700}
      />

      <g transform={`translate(${spdCell.x + 4},${spdReadoutY})`}>
        <SegmentReadout
          value={speedStr}
          label="SPD"
          unit={hasSpeed ? 'KM/H' : undefined}
          height={readoutH}
          color={palette.text}
          ghostColor={palette.textDim}
          align="left"
          idPrefix="ehw-neongear-spd"
        />
      </g>

      <g transform={`translate(${shiftCell.x + 4},${shiftReadoutY})`}>
        <SegmentReadout
          value={shiftStr}
          label="SHIFT"
          unit="%"
          height={readoutH}
          color={redline ? DASH.red : palette.textDim}
          ghostColor={palette.textDim}
          align="left"
          idPrefix="ehw-neongear-shift"
        />
      </g>
    </svg>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
//  ApexRadarWidget — proximity radar drawn inside the widget SVG (rings, cross,
//  self dot, blips) plus a TelltaleIcon lamp + status label. Registry key:
//  'apexRadar'. Threat = |Δx|≤4.5m ∧ |Δy|≤7m (matches spotter side rule).
// ═════════════════════════════════════════════════════════════════════════════
interface RadarBlip {
  x: number
  y: number
  threat: boolean
  color: string
}

function radarBlips(s: TelemetrySnapshot | null): RadarBlip[] {
  const cars = Array.isArray(s?.radarCars) ? s?.radarCars ?? [] : []
  return cars.slice(0, 12).map((car) => {
    const rx = safeNum(car.relativeX, 0)
    const ry = safeNum(car.relativeY, 0)
    const threat = Math.abs(rx) <= 4.5 && Math.abs(ry) <= 7
    return {
      x: 50 + Math.max(-1, Math.min(1, rx / 12)) * 44,
      y: 50 - Math.max(-1, Math.min(1, ry / 40)) * 44,
      threat,
      color: threat ? DASH.red : car.classColor ?? DASH.cyan
    }
  })
}

export function ApexRadarWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const { palette, material } = skin
  const { W, H } = dims(config, 300, 300)

  const blips = radarBlips(snapshot)
  const anyThreat = blips.some((b) => b.threat)
  const statusText = anyThreat ? 'ALONGSIDE' : 'CLEAR'
  const statusColor = anyThreat ? DASH.red : DASH.green

  // Safe-area grid: title row, radar scope (rowspan 4), status/icon row.
  const grid = makeGrid(1, 6, W, H, 6)
  const titleCell = grid.cell(0, 0)
  const scopeCell = grid.cell(0, 1, 1, 4)
  const statusCell = grid.cell(0, 5)

  const scopeCx = scopeCell.x + scopeCell.w / 2
  const scopeCy = scopeCell.y + scopeCell.h / 2
  const scopeR = Math.max(8, Math.min(scopeCell.w, scopeCell.h) / 2 - 4)

  const iconSize = Math.max(18, Math.min(statusCell.h * 0.9, 32))
  const iconX = statusCell.x + 4
  const iconY = statusCell.y + (statusCell.h - iconSize) / 2

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      role="img"
      aria-label="Proximity radar"
      data-widget="apexRadar"
      style={{ display: 'block' }}
    >
      <rect
        x={0.5}
        y={0.5}
        width={W - 1}
        height={H - 1}
        rx={material.radius}
        fill={palette.bg}
        stroke={material.border}
        strokeWidth={material.borderWidth}
      />

      <FitText
        x={titleCell.x + titleCell.w / 2}
        y={titleCell.y + titleCell.h / 2}
        boxW={titleCell.w * 0.9}
        boxH={titleCell.h * 0.85}
        text="RADAR"
        anchor="middle"
        baseline="middle"
        fontFamily={FONT_COND}
        fill={palette.textDim}
        minFontPx={11}
        maxFontPx={Math.max(12, titleCell.h * 0.85)}
        weight={600}
        letterSpacing={2}
      />

      <circle cx={scopeCx} cy={scopeCy} r={scopeR} fill={palette.surface} stroke={material.border} strokeWidth={material.borderWidth} />
      <circle cx={scopeCx} cy={scopeCy} r={scopeR * 0.66} fill="none" stroke={palette.textDim} strokeWidth={0.75} strokeDasharray="3 3" opacity={0.7} />
      <circle cx={scopeCx} cy={scopeCy} r={scopeR * 0.33} fill="none" stroke={palette.textDim} strokeWidth={0.75} strokeDasharray="3 3" opacity={0.5} />
      <line x1={scopeCx - scopeR} y1={scopeCy} x2={scopeCx + scopeR} y2={scopeCy} stroke={palette.textDim} strokeWidth={0.5} opacity={0.4} />
      <line x1={scopeCx} y1={scopeCy - scopeR} x2={scopeCx} y2={scopeCy + scopeR} stroke={palette.textDim} strokeWidth={0.5} opacity={0.4} />

      <circle cx={scopeCx} cy={scopeCy} r={Math.max(2, scopeR * 0.05)} fill={palette.text} />

      {blips.map((b, i) => {
        const bx = scopeCx + ((b.x - 50) / 50) * scopeR
        const by = scopeCy + ((b.y - 50) / 50) * scopeR
        return (
          <circle
            key={i}
            cx={bx}
            cy={by}
            r={Math.max(2, scopeR * 0.06)}
            fill={b.color}
            stroke={b.threat ? DASH.red : palette.bg}
            strokeWidth={b.threat ? 1 : 0.5}
          />
        )
      })}

      <g transform={`translate(${iconX},${iconY})`}>
        <TelltaleIcon
          icon="damage"
          active={anyThreat}
          activeColor={DASH.red}
          size={iconSize}
          label={statusText}
          idPrefix="ehw-apex-threat"
        />
      </g>

      <FitText
        x={statusCell.x + iconSize + 12}
        y={statusCell.y + statusCell.h / 2}
        boxW={Math.max(20, statusCell.w - iconSize - 16)}
        boxH={statusCell.h * 0.85}
        text={statusText}
        anchor="start"
        baseline="middle"
        fontFamily={FONT_COND}
        fill={statusColor}
        minFontPx={11}
        maxFontPx={Math.max(12, statusCell.h * 0.85)}
        weight={700}
        letterSpacing={1.5}
      />
    </svg>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
//  DeltaBarWidget — centre-zero delta bar under a big DSEG readout. Registry
//  key: 'deltaBar'. Green when faster, amber when slower (DASH tokens per
//  severity contract); '—' when the delta is unknown.
// ═════════════════════════════════════════════════════════════════════════════
function deltaOf(s: TelemetrySnapshot | null): number | null {
  const d = s?.deltaToBestSec ?? s?.deltaToSessionBestSec
  return typeof d === 'number' && Number.isFinite(d) ? d : null
}

export function DeltaBarWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const { palette, material } = skin
  const { W, H } = dims(config, 360, 90)

  const d = deltaOf(snapshot)
  const known = d !== null
  const faster = known && (d as number) < 0
  const mag = known ? Math.min(1, Math.abs(d as number) / 1.5) : 0
  const txt = known ? formatDelta(d as number) : '—'
  const fill = !known ? palette.textDim : faster ? DASH.green : DASH.amber

  // Safe-area grid: label row (small), value row (SegmentReadout), bar row.
  const grid = makeGrid(1, 3, W, H, 6)
  const labelCell = grid.cell(0, 0)
  const valueCell = grid.cell(0, 1)
  const barCell = grid.cell(0, 2)

  const barX = barCell.x + 4
  const barW = Math.max(20, barCell.w - 8)
  const barTrackH = Math.min(barCell.h, 12)
  const barY = barCell.y + (barCell.h - barTrackH) / 2
  const midX = barX + barW / 2
  const half = barW / 2
  const fillW = Math.max(0, mag * half)
  const fillX = faster ? midX - fillW : midX

  const readoutW = Math.max(24, valueCell.w - 8)
  const readoutH = fitSegmentHeight(txt, readoutW, Math.max(8, Math.min(valueCell.h - 8, 40)))
  const readoutY = valueCell.y + Math.max(0, (valueCell.h - (readoutH + 4)) / 2)
  const readoutX = valueCell.x + (valueCell.w - readoutW) / 2

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      role="img"
      aria-label="Delta to best"
      data-widget="deltaBar"
      style={{ display: 'block' }}
    >
      <rect
        x={0.5}
        y={0.5}
        width={W - 1}
        height={H - 1}
        rx={material.radius}
        fill={opaquePanelFill(skin)}
        fillOpacity={1}
        stroke={material.border}
        strokeWidth={material.borderWidth}
      />

      <FitText
        x={labelCell.x + labelCell.w / 2}
        y={labelCell.y + labelCell.h / 2}
        boxW={labelCell.w * 0.9}
        boxH={labelCell.h * 0.85}
        text="DELTA"
        anchor="middle"
        baseline="middle"
        fontFamily={FONT_COND}
        fill={palette.textDim}
        minFontPx={11}
        maxFontPx={Math.max(12, labelCell.h * 0.85)}
        weight={600}
        letterSpacing={2}
      />

      <g transform={`translate(${readoutX},${readoutY})`}>
        <SegmentReadout
          value={txt}
          height={readoutH}
          width={readoutW}
          color={fill}
          ghostColor={palette.textDim}
          align="center"
          idPrefix="ehw-delta-val"
        />
      </g>

      <rect x={barX} y={barY} width={barW} height={barTrackH} rx={barTrackH / 2} fill={palette.surface} stroke={material.border} strokeWidth={1} />
      {known && fillW > 0.5 ? (
        <rect x={fillX} y={barY} width={fillW} height={barTrackH} rx={barTrackH / 2} fill={fill} />
      ) : null}
      <line x1={midX} y1={barY - 3} x2={midX} y2={barY + barTrackH + 3} stroke={palette.text} strokeWidth={2} />
    </svg>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
//  LapReadoutWidget — LAST / BEST / Δ stacked rows. Registry key: 'lapReadout'.
//  BEST is accented (skin.palette.accent), Δ is state-coloured (DASH green/
//  amber) with '—' when unknown.
// ═════════════════════════════════════════════════════════════════════════════
export function LapReadoutWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const { palette, material } = skin
  const { W, H } = dims(config, 300, 150)

  const lastStr = formatTime(snapshot?.lastLapTimeSec)
  const bestStr = formatTime(snapshot?.bestLapTimeSec)
  const d = deltaOf(snapshot)
  const deltaStr = d === null ? '—' : formatDelta(d)
  const deltaColor = d === null ? palette.textDim : d < 0 ? DASH.green : DASH.amber

  const grid = makeGrid(1, 3, W, H, 6)
  const rows: Array<{ key: string; label: string; value: string; color: string; accent: boolean }> = [
    { key: 'last', label: 'LAST', value: lastStr, color: palette.text, accent: false },
    { key: 'best', label: 'BEST', value: bestStr, color: palette.accent, accent: true },
    { key: 'delta', label: 'Δ', value: deltaStr, color: deltaColor, accent: false }
  ]

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      role="img"
      aria-label="Lap readout"
      data-widget="lapReadout"
      style={{ display: 'block' }}
    >
      <rect
        x={0.5}
        y={0.5}
        width={W - 1}
        height={H - 1}
        rx={material.radius}
        fill={opaquePanelFill(skin)}
        fillOpacity={1}
        stroke={material.border}
        strokeWidth={material.borderWidth}
      />

      {rows.map((row, i) => {
        const cell = grid.cell(0, i)
        const labelW = Math.max(36, Math.min(cell.w * 0.22, 64))
        const valueX = cell.x + labelW + 8
        const valueW = Math.max(24, cell.w - labelW - 14)
        const readoutH = fitSegmentHeight(row.value, valueW, Math.max(8, Math.min(cell.h - 8, 32)))
        const readoutTop = cell.y + Math.max(0, (cell.h - (readoutH + 4)) / 2)
        return (
          <g key={row.key}>
            <rect
              x={cell.x}
              y={cell.y}
              width={cell.w}
              height={cell.h}
              rx={material.radius * 0.4}
              fill={opaquePanelFill(skin)}
              fillOpacity={1}
              stroke={row.accent ? row.color : material.border}
              strokeWidth={row.accent ? 1.5 : 1}
            />
            <FitText
              x={cell.x + 4 + labelW / 2}
              y={cell.y + cell.h / 2}
              boxW={labelW}
              boxH={cell.h * 0.75}
              text={row.label}
              anchor="middle"
              baseline="middle"
              fontFamily={FONT_COND}
              fill={palette.textDim}
              minFontPx={11}
              maxFontPx={Math.max(12, cell.h * 0.6)}
              weight={700}
              letterSpacing={1.5}
            />
            <g transform={`translate(${valueX},${readoutTop})`}>
              <SegmentReadout
                value={row.value}
                width={valueW}
                height={readoutH}
                color={row.color}
                ghostColor={palette.textDim}
                align="right"
                idPrefix={`ehw-lap-${row.key}`}
              />
            </g>
          </g>
        )
      })}
    </svg>
  )
}
