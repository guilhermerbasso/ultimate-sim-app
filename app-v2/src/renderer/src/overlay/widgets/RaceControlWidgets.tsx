// Race-control overlays — v2.39 KIT rebuild (single-root SVG per widget, all text
// via FitText/SegmentReadout, grid-snapped layout, no HTML/CSS bodies). Every
// widget renders ONE root <svg viewBox="0 0 W H" preserveAspectRatio="xMidYMid meet">
// sized from config.position.{width,height}. Chrome uses skin tokens so a later
// 'hud' swap is a one-object change; state colour discipline: ok/green for genuine
// good states (pits open, dry, on-track, clean BoP), warn/amber for cautions,
// crit/red for hard alerts. NaN/undefined/Infinity are guarded via '—' fallbacks.
import { type ReactElement } from 'react'
import { formatTimeOfDay, trackSurfaceMaterialLabel } from '../../../../shared/telemetry'
import type { PitStatus } from '../../../../shared/telemetry'
import {
  clamp,
  hasBop,
  hasAnyPressure,
  isNum,
  pitHeadline,
  pressureCorners,
  surfaceTone,
  timeOfDayInfo
} from './raceControl'
import type { WidgetProps } from './types'
import { resolveSkin, FitText, makeGrid } from '../../skins'
import type { SkinToken } from '../../skins'
import { AlarmStrip, DataTile, SegmentReadout } from '../../instruments'
import type { MotorsportIconId } from '../../icons/motorsport'

// ── Skin resolution (gt3 default; keeps hud swap open) ───────────────────────
function widgetSkin(): SkinToken {
  return resolveSkin('gt3', 'generic')
}

// Default sizes align with the shared/overlays.ts defaultPosition entries so a
// widget rendered without a bound position still lays out sensibly.
const SIZE = {
  pitStatusHud: { W: 380, H: 140 },
  pitTicket: { W: 260, H: 96 },
  wetRadar: { W: 300, H: 130 },
  wetTag: { W: 220, H: 100 },
  surfaceScope: { W: 200, H: 170 },
  surfaceTag: { W: 220, H: 96 },
  trackClock: { W: 230, H: 170 },
  sessionClock: { W: 200, H: 120 },
  bopBadge: { W: 250, H: 120 },
  coldPressureGrid: { W: 250, H: 230 },
  coldPressureCard: { W: 250, H: 130 }
} as const

function pos(config: WidgetProps['config'], fallback: { W: number; H: number }): { W: number; H: number } {
  const w = Math.max(1, Math.round(config?.position?.width ?? fallback.W))
  const h = Math.max(1, Math.round(config?.position?.height ?? fallback.H))
  return { W: w, H: h }
}

function panel(W: number, H: number, skin: SkinToken): ReactElement {
  const { material } = skin
  return (
    <rect
      x={0.5}
      y={0.5}
      width={Math.max(0, W - 1)}
      height={Math.max(0, H - 1)}
      rx={material.radius}
      fill={material.base}
      stroke={material.border}
      strokeWidth={material.borderWidth}
    />
  )
}

// ── PitStatus lamps ───────────────────────────────────────────────────────────
interface Lamp {
  key: string
  label: string
  on: boolean
  good: boolean
  icon: MotorsportIconId
}

function pitLamps(pit: PitStatus | undefined): Lamp[] {
  return [
    { key: 'pits', label: 'PITS', on: pit ? !pit.pitsOpen : false, good: pit ? pit.pitsOpen : false, icon: 'pit-limiter' },
    { key: 'repair', label: 'FIX', on: pit?.repairNeeded ?? false, good: false, icon: 'damage' },
    { key: 'opt', label: 'OPT', on: pit?.optRepairNeeded ?? false, good: false, icon: 'engine' },
    { key: 'stall', label: 'BOX', on: pit?.inPitStall ?? false, good: pit?.svStatus === 2, icon: 'brake' }
  ]
}

function lampColor(lamp: Lamp, skin: SkinToken): string {
  if (lamp.good) return skin.palette.ok
  if (lamp.on) return lamp.key === 'opt' ? skin.palette.warn : skin.palette.crit
  return skin.palette.textDim
}

function headlineColor(tone: ReturnType<typeof pitHeadline>['tone'], skin: SkinToken): string {
  switch (tone) {
    case 'good':
      return skin.palette.ok
    case 'warn':
      return skin.palette.warn
    case 'alert':
      return skin.palette.crit
    case 'info':
      return skin.palette.info
    default:
      return skin.palette.textDim
  }
}

export function PitStatusHudWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = widgetSkin()
  const { W, H } = pos(config, SIZE.pitStatusHud)
  const { palette, typography } = skin
  const pit = snapshot?.pit
  const head = pitHeadline(pit)
  const color = headlineColor(head.tone, skin)
  const lamps = pitLamps(pit)

  const grid = makeGrid(1, 2, W, H, 8)
  const headCell = grid.cell(0, 0)
  const lampCell = grid.cell(0, 1)

  const tagW = Math.min(headCell.w * 0.22, 60)
  const gap = 6
  const headlineX = headCell.x + tagW + gap
  const headlineW = Math.max(1, headCell.w - tagW - gap)
  const cy = headCell.y + headCell.h / 2

  const stripW = lampCell.w
  const stripH = Math.min(lampCell.h, 34)
  const stripY = lampCell.y + (lampCell.h - stripH) / 2

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      style={{ display: 'block' }}
      data-widget="pitStatusHud"
    >
      {panel(W, H, skin)}
      <FitText
        x={headCell.x + tagW / 2}
        y={cy}
        boxW={tagW}
        boxH={headCell.h * 0.7}
        text="PIT"
        anchor="middle"
        fontFamily={typography.label}
        fill={palette.textDim}
        weight={700}
        letterSpacing={1}
        minFontPx={12}
        maxFontPx={22}
      />
      <FitText
        x={headlineX}
        y={cy}
        boxW={headlineW}
        boxH={headCell.h * 0.82}
        text={head.text}
        anchor="start"
        fontFamily={typography.label}
        fill={color}
        weight={700}
        minFontPx={12}
        maxFontPx={26}
      />
      <g transform={`translate(${lampCell.x},${stripY})`}>
        <AlarmStrip
          alarms={lamps.map((l) => ({ label: l.label, active: l.on || l.good, color: lampColor(l, skin), icon: l.icon }))}
          width={stripW}
          height={stripH}
          gap={6}
          glow
          idPrefix="race-pit-alarms"
        />
      </g>
    </svg>
  )
}

// ── PitTicketWidget — compact pit headline chip ───────────────────────────────
export function PitTicketWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = widgetSkin()
  const { W, H } = pos(config, SIZE.pitTicket)
  const { palette, typography } = skin
  const head = pitHeadline(snapshot?.pit)
  const color = headlineColor(head.tone, skin)

  const grid = makeGrid(1, 2, W, H, 6)
  const topCell = grid.cell(0, 0)
  const bodyCell = grid.cell(0, 1)

  const dotR = Math.min(6, topCell.h * 0.35)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      style={{ display: 'block' }}
      data-widget="pitTicket"
    >
      {panel(W, H, skin)}
      <FitText
        x={topCell.x + 4}
        y={topCell.y + topCell.h / 2}
        boxW={Math.max(1, topCell.w - dotR * 2 - 12)}
        boxH={topCell.h * 0.9}
        text="PIT"
        anchor="start"
        fontFamily={typography.label}
        fill={palette.textDim}
        weight={700}
        letterSpacing={1}
        minFontPx={11}
        maxFontPx={16}
      />
      <circle cx={topCell.x + topCell.w - dotR - 2} cy={topCell.y + topCell.h / 2} r={dotR} fill={color} />
      <FitText
        x={bodyCell.x + bodyCell.w / 2}
        y={bodyCell.y + bodyCell.h / 2}
        boxW={bodyCell.w}
        boxH={bodyCell.h * 0.92}
        text={head.text}
        anchor="middle"
        fontFamily={typography.label}
        fill={color}
        weight={700}
        minFontPx={12}
        maxFontPx={32}
      />
    </svg>
  )
}

// ── Wet declaration helpers ───────────────────────────────────────────────────
function wetness(snapshot: WidgetProps['snapshot']): number | undefined {
  const wet = snapshot?.trackWetnessPct
  if (isNum(wet)) return clamp(wet)
  if (snapshot?.isRaining) return 0.6
  return undefined
}

function wetColor(wet: number | undefined, declared: boolean, skin: SkinToken): string {
  if (declared) return skin.palette.crit
  if (wet !== undefined && wet > 0.2) return skin.palette.warn
  if (wet === undefined) return skin.palette.textDim
  return skin.palette.ok
}

export function WetRadarWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = widgetSkin()
  const { W, H } = pos(config, SIZE.wetRadar)
  const { palette, typography, material } = skin
  const wet = wetness(snapshot)
  const declared = snapshot?.weatherDeclaredWet === true
  const isWet = declared || (wet !== undefined && wet > 0.2)
  const color = wetColor(wet, declared, skin)
  const pctTxt = wet === undefined ? '—' : String(Math.round(wet * 100))
  const status = declared ? 'WET DECLARED' : isWet ? 'pista molhada' : wet === undefined ? 'no signal' : 'pista seca'

  const grid = makeGrid(2, 2, W, H, 8)
  const labCell = grid.cell(0, 0)
  const valCell = grid.cell(1, 0)
  const statusCell = grid.cell(0, 1, 2, 1)

  const seg = { w: Math.max(40, valCell.w), h: Math.max(20, Math.min(valCell.h, 44)) }
  const segX = valCell.x + valCell.w - seg.w
  const segY = valCell.y + (valCell.h - (seg.h + seg.h * 0.32 + 4)) / 2

  const frac = wet ?? 0
  const barH = Math.min(6, Math.max(3, statusCell.h * 0.18))
  const barY = statusCell.y + statusCell.h - barH - 2
  const barW = statusCell.w
  const barX = statusCell.x

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      style={{ display: 'block' }}
      data-widget="wetRadar"
    >
      {panel(W, H, skin)}
      <FitText
        x={labCell.x + 2}
        y={labCell.y + labCell.h / 2}
        boxW={labCell.w}
        boxH={labCell.h * 0.8}
        text="PISTA"
        anchor="start"
        fontFamily={typography.label}
        fill={palette.textDim}
        weight={700}
        letterSpacing={1}
        minFontPx={11}
        maxFontPx={20}
      />
      <g transform={`translate(${segX},${segY})`}>
        <SegmentReadout
          value={pctTxt}
          mode={pctTxt === '—' ? '14' : '7'}
          unit="%"
          height={seg.h}
          width={seg.w}
          color={color}
          align="right"
          idPrefix="wet-pct"
        />
      </g>
      <FitText
        x={statusCell.x + 2}
        y={statusCell.y + (statusCell.h - barH) / 2}
        boxW={statusCell.w - 4}
        boxH={Math.max(11, (statusCell.h - barH) * 0.85)}
        text={status}
        anchor="start"
        fontFamily={typography.label}
        fill={color}
        weight={700}
        minFontPx={11}
        maxFontPx={20}
      />
      <rect x={barX} y={barY} width={barW} height={barH} rx={barH / 2} fill={material.base} stroke={material.border} strokeWidth={1} />
      {frac > 0 && (
        <rect x={barX} y={barY} width={Math.max(0, barW * frac)} height={barH} rx={barH / 2} fill={color} />
      )}
    </svg>
  )
}

// ── WetTagWidget — DRY/WET chip + percent ────────────────────────────────────
export function WetTagWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = widgetSkin()
  const { W, H } = pos(config, SIZE.wetTag)
  const { palette, typography } = skin
  const wet = wetness(snapshot)
  const declared = snapshot?.weatherDeclaredWet === true
  const isWet = declared || (wet !== undefined && wet > 0.2)
  const color = wetColor(wet, declared, skin)
  const word = wet === undefined ? '—' : isWet ? 'WET' : 'DRY'
  const pctTxt = wet === undefined ? '—' : `${Math.round(wet * 100)}%`

  const grid = makeGrid(2, 2, W, H, 6)
  const labCell = grid.cell(0, 0)
  const noteCell = grid.cell(1, 0)
  const wordCell = grid.cell(0, 1)
  const pctCell = grid.cell(1, 1)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      style={{ display: 'block' }}
      data-widget="wetTag"
    >
      {panel(W, H, skin)}
      <FitText
        x={labCell.x + 2}
        y={labCell.y + labCell.h / 2}
        boxW={labCell.w}
        boxH={labCell.h * 0.9}
        text="PISTA"
        anchor="start"
        fontFamily={typography.label}
        fill={palette.textDim}
        weight={700}
        letterSpacing={1}
        minFontPx={11}
        maxFontPx={16}
      />
      {declared && (
        <FitText
          x={noteCell.x + noteCell.w - 2}
          y={noteCell.y + noteCell.h / 2}
          boxW={noteCell.w}
          boxH={noteCell.h * 0.9}
          text="declarado"
          anchor="end"
          fontFamily={typography.label}
          fill={palette.crit}
          weight={600}
          minFontPx={11}
          maxFontPx={14}
        />
      )}
      <FitText
        x={wordCell.x + wordCell.w / 2}
        y={wordCell.y + wordCell.h / 2}
        boxW={wordCell.w}
        boxH={wordCell.h * 0.9}
        text={word}
        anchor="middle"
        fontFamily={typography.label}
        fill={color}
        weight={700}
        minFontPx={12}
        maxFontPx={30}
      />
      <FitText
        x={pctCell.x + pctCell.w / 2}
        y={pctCell.y + pctCell.h / 2}
        boxW={pctCell.w}
        boxH={pctCell.h * 0.9}
        text={pctTxt}
        anchor="middle"
        fontFamily={typography.label}
        fill={palette.text}
        weight={700}
        minFontPx={12}
        maxFontPx={26}
      />
    </svg>
  )
}

// ── Surface scope / tag ───────────────────────────────────────────────────────
function surfaceColor(tone: ReturnType<typeof surfaceTone>, skin: SkinToken): string {
  if (tone === 'track') return skin.palette.ok
  if (tone === 'kerb') return skin.palette.warn
  return skin.palette.crit
}

export function SurfaceScopeWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = widgetSkin()
  const { W, H } = pos(config, SIZE.surfaceScope)
  const { palette, typography } = skin
  const label = trackSurfaceMaterialLabel(snapshot?.trackSurfaceMaterial)
  const tone = surfaceTone(label)
  const color = surfaceColor(tone, skin)
  const up = label ? label.toUpperCase() : '—'
  const sub = tone === 'track' ? 'on track' : tone === 'kerb' ? 'kerb' : 'off track'

  const grid = makeGrid(1, 3, W, H, 6)
  const dotCell = grid.cell(0, 0)
  const tagCell = grid.cell(0, 1)
  const wordCell = grid.cell(0, 2)

  const dotR = Math.max(4, Math.min(dotCell.w, dotCell.h) / 2 - 4)
  const cx = dotCell.x + dotCell.w / 2
  const cy = dotCell.y + dotCell.h / 2

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      style={{ display: 'block' }}
      data-widget="surfaceScope"
    >
      {panel(W, H, skin)}
      <circle cx={cx} cy={cy} r={dotR} fill={color} opacity={0.85} />
      <circle cx={cx} cy={cy} r={Math.max(1, dotR - 4)} fill={color} />
      <FitText
        x={tagCell.x + tagCell.w / 2}
        y={tagCell.y + tagCell.h / 2}
        boxW={tagCell.w}
        boxH={tagCell.h * 0.9}
        text="SURF"
        anchor="middle"
        fontFamily={typography.label}
        fill={palette.textDim}
        weight={700}
        letterSpacing={1}
        minFontPx={11}
        maxFontPx={18}
      />
      <FitText
        x={wordCell.x + wordCell.w / 2}
        y={wordCell.y + wordCell.h / 2}
        boxW={wordCell.w}
        boxH={wordCell.h * 0.9}
        text={up}
        anchor="middle"
        fontFamily={typography.label}
        fill={color}
        weight={700}
        minFontPx={12}
        maxFontPx={22}
      />
      <title>{sub}</title>
    </svg>
  )
}

export function SurfaceTagWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = widgetSkin()
  const { W, H } = pos(config, SIZE.surfaceTag)
  const { palette, typography } = skin
  const label = trackSurfaceMaterialLabel(snapshot?.trackSurfaceMaterial)
  const tone = surfaceTone(label)
  const color = surfaceColor(tone, skin)
  const word = label ? label.toUpperCase() : '—'

  const grid = makeGrid(3, 1, W, H, 6)
  const tagCell = grid.cell(0, 0)
  const wordCell = grid.cell(1, 0)
  const dotCell = grid.cell(2, 0)
  const dotR = Math.min(8, Math.min(dotCell.w, dotCell.h) / 2 - 2)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      style={{ display: 'block' }}
      data-widget="surfaceTag"
    >
      {panel(W, H, skin)}
      <FitText
        x={tagCell.x + 2}
        y={tagCell.y + tagCell.h / 2}
        boxW={tagCell.w}
        boxH={tagCell.h * 0.85}
        text="SURFACE"
        anchor="start"
        fontFamily={typography.label}
        fill={palette.textDim}
        weight={700}
        letterSpacing={1}
        minFontPx={11}
        maxFontPx={16}
      />
      <FitText
        x={wordCell.x + wordCell.w / 2}
        y={wordCell.y + wordCell.h / 2}
        boxW={wordCell.w}
        boxH={wordCell.h * 0.9}
        text={word}
        anchor="middle"
        fontFamily={typography.label}
        fill={color}
        weight={700}
        minFontPx={12}
        maxFontPx={22}
      />
      <circle cx={dotCell.x + dotCell.w - dotR - 2} cy={dotCell.y + dotCell.h / 2} r={dotR} fill={color} />
    </svg>
  )
}

// ── Session time-of-day (Track/Session clocks) ────────────────────────────────
function clockAccent(night: boolean, phase: string | undefined, skin: SkinToken): string {
  if (night) return skin.palette.info
  if (phase === 'dawn' || phase === 'dusk') return skin.palette.warn
  return skin.palette.accent
}

interface ClockLayoutOptions {
  showArc: boolean
  glyph: string
}

function renderClock(
  { snapshot, config }: WidgetProps,
  fallback: { W: number; H: number },
  dataWidget: string,
  opts: ClockLayoutOptions
): ReactElement {
  const skin = widgetSkin()
  const { W, H } = pos(config, fallback)
  const { palette, typography, segment } = skin
  const info = timeOfDayInfo(snapshot?.sessionTimeOfDay)
  const time = formatTimeOfDay(snapshot?.sessionTimeOfDay) ?? '—'
  const night = info?.night ?? false
  const accent = clockAccent(night, info?.phase, skin)
  const phase = info?.phase ?? 'time of day'
  const fraction = info ? info.fraction : 0.5

  const grid = makeGrid(1, 3, W, H, 6)
  const topCell = grid.cell(0, 0)
  const midCell = grid.cell(0, 1)
  const botCell = grid.cell(0, 2)

  const glyphSize = Math.max(12, Math.min(topCell.h * 0.9, 22))
  const gx = topCell.x + topCell.w - glyphSize / 2 - 4

  const arcH = Math.min(botCell.h, 22)
  const arcW = botCell.w
  const arcX = botCell.x
  const arcY = botCell.y + botCell.h - arcH - 2
  const arcR = Math.max(4, Math.min(arcW / 2, arcH))
  const startX = arcX + Math.max(4, arcR * 0.1)
  const endX = arcX + arcW - Math.max(4, arcR * 0.1)
  const arcSpan = Math.max(0, endX - startX)
  const dotX = startX + arcSpan * clamp(fraction, 0, 1)
  const dotY = arcY + arcH

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      style={{ display: 'block' }}
      data-widget={dataWidget}
    >
      {panel(W, H, skin)}
      <FitText
        x={topCell.x + 4}
        y={topCell.y + topCell.h / 2}
        boxW={Math.max(1, topCell.w - glyphSize - 12)}
        boxH={topCell.h * 0.85}
        text="TIME"
        anchor="start"
        fontFamily={typography.label}
        fill={palette.textDim}
        weight={700}
        letterSpacing={1}
        minFontPx={11}
        maxFontPx={16}
      />
      <FitText
        x={gx}
        y={topCell.y + topCell.h / 2}
        boxW={glyphSize}
        boxH={glyphSize}
        text={opts.glyph}
        anchor="middle"
        fontFamily={typography.label}
        fill={accent}
        weight={700}
        minFontPx={11}
        maxFontPx={glyphSize}
      />
      <FitText
        x={midCell.x + midCell.w / 2}
        y={midCell.y + midCell.h / 2}
        boxW={midCell.w}
        boxH={midCell.h * 0.94}
        text={time}
        anchor="middle"
        fontFamily={segment.numeric}
        fill={palette.text}
        weight={700}
        minFontPx={14}
        maxFontPx={64}
      />
      {opts.showArc ? (
        <>
          <line x1={startX} y1={dotY} x2={endX} y2={dotY} stroke={palette.textDim} strokeWidth={1.5} opacity={0.4} strokeLinecap="round" />
          <line x1={startX} y1={dotY} x2={dotX} y2={dotY} stroke={accent} strokeWidth={2} strokeLinecap="round" />
          <circle cx={dotX} cy={dotY} r={Math.max(2, arcH * 0.18)} fill={accent} />
          <FitText
            x={botCell.x + botCell.w / 2}
            y={botCell.y + (botCell.h - arcH) / 2 + 2}
            boxW={botCell.w}
            boxH={Math.max(11, botCell.h - arcH - 4)}
            text={phase}
            anchor="middle"
            fontFamily={typography.label}
            fill={palette.textDim}
            weight={600}
            minFontPx={11}
            maxFontPx={16}
          />
        </>
      ) : (
        <FitText
          x={botCell.x + botCell.w / 2}
          y={botCell.y + botCell.h / 2}
          boxW={botCell.w}
          boxH={botCell.h * 0.9}
          text={phase}
          anchor="middle"
          fontFamily={typography.label}
          fill={palette.textDim}
          weight={600}
          minFontPx={11}
          maxFontPx={18}
        />
      )}
    </svg>
  )
}

export function TrackClockWidget(props: WidgetProps): ReactElement {
  const info = timeOfDayInfo(props.snapshot?.sessionTimeOfDay)
  const night = info?.night ?? false
  return renderClock(props, SIZE.trackClock, 'trackClock', { showArc: true, glyph: night ? '☾' : '☀' })
}

export function SessionClockWidget(props: WidgetProps): ReactElement {
  const info = timeOfDayInfo(props.snapshot?.sessionTimeOfDay)
  const night = info?.night ?? false
  return renderClock(props, SIZE.sessionClock, 'sessionClock', { showArc: false, glyph: night ? '☾' : '☀' })
}

// ── BoP badge (ballast + power adjust) ────────────────────────────────────────
function formatWeightTxt(weight: number | undefined): string {
  if (!isNum(weight)) return '—'
  return `${weight > 0 ? '+' : ''}${Math.round(weight)}`
}

function formatPowerTxt(power: number | undefined): string {
  if (!isNum(power)) return '—'
  return `${power > 0 ? '+' : ''}${power.toFixed(power % 1 === 0 ? 0 : 1)}`
}

export function BopBadgeWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = widgetSkin()
  const { W, H } = pos(config, SIZE.bopBadge)
  const { palette, typography } = skin
  const weight = snapshot?.weightPenaltyKg
  const power = snapshot?.powerAdjustPct
  const penalised = hasBop(weight, power)
  const known = isNum(weight) || isNum(power)
  const accent = !known ? palette.textDim : penalised ? palette.warn : palette.ok
  const weightTxt = formatWeightTxt(weight)
  const powerTxt = formatPowerTxt(power)
  const weightColor = isNum(weight) && Math.abs(weight) > 0 ? palette.warn : palette.text
  const powerColor = isNum(power) && power < 0 ? palette.warn : isNum(power) && power > 0 ? palette.ok : palette.text

  const headerH = Math.min(H * 0.28, 32)
  const grid = makeGrid(2, 1, W, Math.max(1, H - headerH), 8)
  const leftCell = grid.cell(0, 0)
  const rightCell = grid.cell(1, 0)
  const tileY = headerH

  const dotR = Math.max(3, Math.min(6, headerH * 0.28))

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      style={{ display: 'block' }}
      data-widget="bopBadge"
    >
      {panel(W, H, skin)}
      <FitText
        x={8}
        y={headerH / 2}
        boxW={W * 0.4}
        boxH={headerH * 0.85}
        text="BoP"
        anchor="start"
        fontFamily={typography.label}
        fill={palette.textDim}
        weight={700}
        letterSpacing={1}
        minFontPx={11}
        maxFontPx={18}
      />
      <circle cx={W - dotR - 8} cy={headerH / 2} r={dotR} fill={accent} />
      <g transform={`translate(${leftCell.x},${tileY + leftCell.y})`}>
        <DataTile
          label="LASTRO"
          value={weightTxt}
          unit="kg"
          width={leftCell.w}
          height={leftCell.h}
          color={weightColor}
          accent={palette.warn}
          material="matte"
          align="center"
          idPrefix="bop-weight"
        />
      </g>
      <g transform={`translate(${rightCell.x},${tileY + rightCell.y})`}>
        <DataTile
          label="POT"
          value={powerTxt}
          unit="%"
          width={rightCell.w}
          height={rightCell.h}
          color={powerColor}
          accent={palette.warn}
          material="matte"
          align="center"
          idPrefix="bop-power"
        />
      </g>
    </svg>
  )
}

// ── Cold tyre pressures (grid + card) ─────────────────────────────────────────
const CORNER_LABEL: Record<string, string> = { lf: 'LF', rf: 'RF', lr: 'LR', rr: 'RR' }

function psiTxt(psi: number | null): string {
  return psi === null ? '—' : psi.toFixed(1)
}

export function ColdPressureGridWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = widgetSkin()
  const { W, H } = pos(config, SIZE.coldPressureGrid)
  const { palette, typography, material } = skin
  const corners = pressureCorners(snapshot?.tireColdPressuresKpa)
  const present = hasAnyPressure(snapshot?.tireColdPressuresKpa)

  const headerH = Math.min(H * 0.16, 26)
  const headerCell = { x: 8, y: 4, w: Math.max(1, W - 16), h: headerH }
  const grid = makeGrid(4, 1, W, Math.max(1, H - headerH - 4), 6)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      style={{ display: 'block' }}
      data-widget="coldPressureGrid"
    >
      {panel(W, H, skin)}
      <FitText
        x={headerCell.x}
        y={headerCell.y + headerCell.h / 2}
        boxW={headerCell.w * 0.6}
        boxH={headerCell.h * 0.9}
        text="COLD PSI"
        anchor="start"
        fontFamily={typography.label}
        fill={palette.textDim}
        weight={700}
        letterSpacing={1}
        minFontPx={11}
        maxFontPx={18}
      />
      {!present && (
        <FitText
          x={headerCell.x + headerCell.w}
          y={headerCell.y + headerCell.h / 2}
          boxW={headerCell.w * 0.4}
          boxH={headerCell.h * 0.9}
          text="garagem"
          anchor="end"
          fontFamily={typography.label}
          fill={palette.textDim}
          weight={600}
          minFontPx={11}
          maxFontPx={14}
        />
      )}
      {corners.map((c, i) => {
        const cell = grid.cell(i, 0)
        const yOffset = headerH + 4
        const cy = cell.y + yOffset
        const labelH = Math.min(14, cell.h * 0.16)
        const valueH = Math.min(24, cell.h * 0.24)
        const barTop = cy
        const barBottom = cy + cell.h - labelH - valueH - 6
        const barH = Math.max(4, barBottom - barTop)
        const barW = Math.max(6, Math.min(16, cell.w * 0.5))
        const barX = cell.x + (cell.w - barW) / 2
        const fillH = c.kpa === null ? 0 : Math.max(1, barH * (0.2 + c.fill * 0.8))
        const fillY = barTop + (barH - fillH)
        const col = c.kpa === null ? palette.textDim : c.outlier ? palette.crit : palette.ok
        const valueY = barTop + barH + 4 + valueH / 2
        const labelY = valueY + valueH / 2 + labelH / 2

        return (
          <g key={c.key}>
            <rect x={barX} y={barTop} width={barW} height={barH} rx={barW / 3} fill={material.base} stroke={material.border} strokeWidth={1} />
            {c.kpa !== null && (
              <rect x={barX + 1} y={fillY} width={Math.max(0, barW - 2)} height={Math.max(0, fillH - 1)} rx={Math.max(0, (barW - 2) / 3)} fill={col} />
            )}
            <FitText
              x={cell.x + cell.w / 2}
              y={valueY}
              boxW={cell.w}
              boxH={valueH}
              text={psiTxt(c.psi)}
              anchor="middle"
              fontFamily={typography.label}
              fill={c.outlier ? palette.crit : palette.text}
              weight={700}
              minFontPx={11}
              maxFontPx={22}
            />
            <FitText
              x={cell.x + cell.w / 2}
              y={labelY}
              boxW={cell.w}
              boxH={labelH}
              text={CORNER_LABEL[c.key]}
              anchor="middle"
              fontFamily={typography.label}
              fill={palette.textDim}
              weight={600}
              letterSpacing={1}
              minFontPx={11}
              maxFontPx={14}
            />
          </g>
        )
      })}
    </svg>
  )
}

export function ColdPressureCardWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = widgetSkin()
  const { W, H } = pos(config, SIZE.coldPressureCard)
  const { palette, typography } = skin
  const corners = pressureCorners(snapshot?.tireColdPressuresKpa)
  const present = hasAnyPressure(snapshot?.tireColdPressuresKpa)
  const known = corners.filter((c) => c.kpa !== null)
  const coldest = known.length
    ? known.reduce((min, c) => ((c.kpa ?? Infinity) < (min.kpa ?? Infinity) ? c : min)).key
    : null

  const headerH = Math.min(H * 0.24, 28)
  const headerCell = { x: 8, y: 4, w: Math.max(1, W - 16), h: headerH }
  const grid = makeGrid(2, 2, W, Math.max(1, H - headerH - 4), 6)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      style={{ display: 'block' }}
      data-widget="coldPressureCard"
    >
      {panel(W, H, skin)}
      <FitText
        x={headerCell.x}
        y={headerCell.y + headerCell.h / 2}
        boxW={headerCell.w * 0.65}
        boxH={headerCell.h * 0.9}
        text="COLD PRESS"
        anchor="start"
        fontFamily={typography.label}
        fill={palette.textDim}
        weight={700}
        letterSpacing={1}
        minFontPx={11}
        maxFontPx={18}
      />
      <FitText
        x={headerCell.x + headerCell.w}
        y={headerCell.y + headerCell.h / 2}
        boxW={headerCell.w * 0.35}
        boxH={headerCell.h * 0.9}
        text={present ? 'psi' : 'garagem'}
        anchor="end"
        fontFamily={typography.label}
        fill={palette.textDim}
        weight={600}
        minFontPx={11}
        maxFontPx={14}
      />
      {corners.map((c, i) => {
        const col = i % 2
        const row = Math.floor(i / 2)
        const cell = grid.cell(col, row)
        const yOffset = headerH + 4
        const value = psiTxt(c.psi)
        const color = c.outlier ? palette.crit : c.key === coldest ? palette.warn : palette.text
        return (
          <g key={c.key} transform={`translate(${cell.x},${cell.y + yOffset})`}>
            <DataTile
              label={CORNER_LABEL[c.key]}
              value={value}
              width={cell.w}
              height={cell.h}
              color={color}
              accent={c.key === coldest ? palette.warn : palette.textDim}
              material="matte"
              align="center"
              idPrefix={`coldc-${c.key}`}
            />
          </g>
        )
      })}
    </svg>
  )
}
