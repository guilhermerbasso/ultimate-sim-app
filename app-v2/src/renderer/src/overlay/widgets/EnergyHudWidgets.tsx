// EnergyHudWidgets — ERS and Push-to-Pass overlays rebuilt on the v2.39 KIT
// (skins + instruments + FitText + makeGrid). Every widget renders as ONE root
// <svg viewBox="0 0 W H" preserveAspectRatio="none"> so the opaque panel always
// fills the placed widget box. Text is auto-fit into fixed grid cells and can
// NEVER overflow the frame. DSEG numerics go through <SegmentReadout> so the
// FONT_SEG7 face (DSEG7Classic-Regular) is always in the markup; labels go
// through <FitText> with minFontPx ≥ 11.
//
// Chrome (panel/border/textDim) uses the resolved skin token; state colours
// (good/warn/danger/deploy) use DASH tokens so severity stays consistent across
// the dashboard family. Registry keys + exported names + data bindings are
// unchanged — this is a pure render-layer rebuild.
import type { ReactElement } from 'react'
import { overlayDesignFamily, type OverlayDesignFamily } from '../../../../shared/overlays'
import type { WidgetProps } from './types'
import { DASH, FONT_COND } from './dashboard-tiles'
import { FitText, makeGrid, resolveSkin } from '../../skins'
import { RevLedBar, SegmentReadout, TelltaleIcon } from '../../instruments'
import { clamp, energyTone, pushToPassState, type PushToPassState } from './raceControl'

// ── Local tokens (state → DASH mapping keeps severity readable across families).
const ENERGY_STATE = {
  good: DASH.green,
  mid: DASH.amber,
  low: DASH.orange,
  empty: DASH.red
} as const

const P2P_COLOR: Record<PushToPassState, string> = {
  active: DASH.orange,
  ready: DASH.green,
  depleted: DASH.red,
  none: DASH.textDim
}

// ── NaN / Infinity / undefined-safe formatters (tests assert none leak into markup).
function pctText(pct: number | undefined): string {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return '—'
  return String(Math.round(clamp(pct) * 100))
}

function countText(count: number | undefined): string {
  if (typeof count !== 'number' || !Number.isFinite(count)) return '—'
  return String(Math.max(0, Math.trunc(count)))
}

function p2pLabel(state: PushToPassState): string {
  return state === 'active'
    ? 'BOOST'
    : state === 'depleted'
      ? 'NO USES'
      : state === 'none'
        ? 'N/A'
        : 'READY'
}

function energyStatus(pct: number | undefined): string {
  const tone = energyTone(pct)
  if (!tone) return 'NO ERS'
  return tone === 'good' ? 'CHARGED' : tone === 'empty' ? 'EMPTY' : tone === 'low' ? 'LOW' : 'MID'
}

// ── Design-family accent — keeps the seven presets visually distinct atop the
// shared skin chrome. Test doesn't require distinct family classnames, but per-
// family accent keeps the loop rendering meaningful for every family case.
function familyAccent(family: OverlayDesignFamily, fallback: string): string {
  switch (family) {
    case 'neon':
      return '#00E0FF'
    case 'terminal':
      return '#39FF87'
    case 'heatmap':
      return '#FF8C2B'
    case 'bauhaus':
      return '#FFB000'
    case 'broadcast':
      return '#38BDF8'
    case 'analog':
      return '#E8EDF2'
    default:
      return fallback
  }
}

// Reasonable design-size fallbacks match the widget defaults in shared/overlays.ts.
function dims(config: WidgetProps['config'], dw: number, dh: number): { W: number; H: number } {
  const w = config?.position?.width
  const h = config?.position?.height
  return {
    W: typeof w === 'number' && w > 0 ? w : dw,
    H: typeof h === 'number' && h > 0 ? h : dh
  }
}

// A stable id-prefix per widget instance keeps <defs> unique inside the SVG.
function idPrefix(id: string | undefined, key: string): string {
  return `energy-${key}-${id ?? 'default'}`
}

function opaquePanelFill(bg: string | undefined): string {
  const token = bg?.trim()
  if (!token) return '#050608'
  const rgba = /^rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)$/i.exec(token)
  return rgba ? `rgb(${rgba[1].trim()}, ${rgba[2].trim()}, ${rgba[3].trim()})` : token
}

function segmentFitHeight(boxW: number, boxH: number, value: string, unit?: string): number {
  const textLen = Math.max(1, value.length)
  const unitLen = unit?.length ?? 0
  const widthEm = textLen * 0.66 + (unitLen > 0 ? unitLen * 0.66 * 0.55 + 0.25 : 0) + 0.18
  return Math.max(8, Math.min(Math.max(8, boxH - 4), Math.max(8, (boxW - 4) / widthEm)))
}

// ─── ErsBarWidget ─────────────────────────────────────────────────────────────
// Compact label + value + LED bar (default 240×84).
export function ErsBarWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const { palette, material } = skin
  const family = overlayDesignFamily(config?.stylePreset)
  const { W, H } = dims(config, 240, 84)
  const accent = familyAccent(family, palette.accent)
  const panelFill = opaquePanelFill(palette.bg)

  const pct = snapshot?.ersBatteryPct
  const tone = energyTone(pct)
  const charge = clamp(pct ?? 0)
  const stateColor = tone ? ENERGY_STATE[tone] : DASH.textDim
  const txt = pctText(pct)

  const grid = makeGrid(4, 2, W, H, Math.max(4, Math.round(Math.min(W, H) * 0.05)))
  const labelCell = grid.cell(0, 0)
  const valueCell = grid.cell(1, 0, 3)
  const barCell = grid.cell(0, 1, 4)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      width="100%"
      height="100%"
      role="img"
      aria-label="ERS bar"
      data-widget="ersBar"
      data-family={family}
      style={{ display: 'block' }}
    >
      <rect x={0} y={0} width={W} height={H} rx={material.radius} fill={panelFill} fillOpacity={1} />
      <rect
        x={0.5}
        y={0.5}
        width={W - 1}
        height={H - 1}
        rx={material.radius}
        fill="none"
        stroke={tone ? stateColor : accent}
        strokeOpacity={0.6}
        strokeWidth={material.borderWidth}
      />

      <FitText
        x={labelCell.x + labelCell.w / 2}
        y={labelCell.y + labelCell.h / 2}
        boxW={labelCell.w}
        boxH={labelCell.h}
        text="ERS"
        anchor="middle"
        baseline="middle"
        fontFamily={FONT_COND}
        fill={palette.textDim}
        weight={700}
        letterSpacing={1}
        minFontPx={11}
        maxFontPx={labelCell.h}
      />

      <g transform={`translate(${valueCell.x} ${valueCell.y})`}>
        <SegmentReadout
          value={txt}
          unit="%"
          height={segmentFitHeight(valueCell.w, valueCell.h, txt, '%')}
          width={valueCell.w}
          align="right"
          color={stateColor}
          ghost={false}
          idPrefix={idPrefix(config?.id, 'ers-bar-value')}
        />
      </g>

      <RevLedBar
        pct={tone ? charge : 0}
        segments={14}
        shape="bar"
        gap={Math.max(2, Math.round(barCell.w / 120))}
        x={barCell.x}
        y={barCell.y}
        width={barCell.w}
        height={barCell.h}
        warnAt={0.34}
        dangerAt={0.06}
        redlineFlash={false}
        glow={!!tone}
        colors={{ good: DASH.green, warn: DASH.amber, danger: DASH.red }}
        idPrefix={idPrefix(config?.id, 'ers-bar-led')}
      />
    </svg>
  )
}

// ─── ErsBatteryWidget ─────────────────────────────────────────────────────────
// The iconic ERS pack — a 10-cell battery + big % readout + status (240×150).
export function ErsBatteryWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const { palette, material } = skin
  const family = overlayDesignFamily(config?.stylePreset)
  const { W, H } = dims(config, 240, 150)
  const accent = familyAccent(family, palette.accent)
  const panelFill = opaquePanelFill(palette.bg)

  const pct = snapshot?.ersBatteryPct
  const tone = energyTone(pct)
  const charge = clamp(pct ?? 0)
  const stateColor = tone ? ENERGY_STATE[tone] : DASH.textDim
  const txt = pctText(pct)
  const status = energyStatus(pct)
  const cells = 10
  const active = tone ? Math.round(charge * cells) : 0

  const grid = makeGrid(3, 3, W, H, Math.max(4, Math.round(Math.min(W, H) * 0.045)))
  const labelCell = grid.cell(0, 0)
  const valueCell = grid.cell(1, 0, 2)
  const packCell = grid.cell(0, 1, 3, 1)
  const statusCell = grid.cell(0, 2, 3)

  // Battery pack — a fixed row of cells + a cap on the right (drawn as SVG rects
  // inside a fixed box so nothing sizes to content).
  const capW = Math.max(6, Math.round(packCell.h * 0.28))
  const rowGap = Math.max(2, Math.round(packCell.w / 80))
  const packInnerW = packCell.w - capW - rowGap
  const cellW = Math.max(2, (packInnerW - rowGap * (cells - 1)) / cells)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      width="100%"
      height="100%"
      role="img"
      aria-label="ERS battery"
      data-widget="ersBattery"
      data-family={family}
      style={{ display: 'block' }}
    >
      <rect x={0} y={0} width={W} height={H} rx={material.radius} fill={panelFill} fillOpacity={1} />
      <rect
        x={0.5}
        y={0.5}
        width={W - 1}
        height={H - 1}
        rx={material.radius}
        fill="none"
        stroke={tone ? stateColor : accent}
        strokeOpacity={0.5}
        strokeWidth={material.borderWidth}
      />

      <FitText
        x={labelCell.x + labelCell.w / 2}
        y={labelCell.y + labelCell.h / 2}
        boxW={labelCell.w}
        boxH={labelCell.h}
        text="ERS"
        anchor="middle"
        baseline="middle"
        fontFamily={FONT_COND}
        fill={palette.textDim}
        weight={700}
        letterSpacing={1}
        minFontPx={11}
        maxFontPx={labelCell.h}
      />

      <g transform={`translate(${valueCell.x} ${valueCell.y})`}>
        <SegmentReadout
          value={txt}
          unit="%"
          height={segmentFitHeight(valueCell.w, valueCell.h, txt, '%')}
          width={valueCell.w}
          align="right"
          color={stateColor}
          ghost={false}
          idPrefix={idPrefix(config?.id, 'ers-batt-value')}
        />
      </g>

      {/* Battery pack shell */}
      <rect
        x={packCell.x + 0.5}
        y={packCell.y + 0.5}
        width={packCell.w - capW - rowGap - 1}
        height={packCell.h - 1}
        rx={3}
        fill="none"
        stroke={material.border}
        strokeWidth={material.borderWidth}
      />
      {/* Cells */}
      {Array.from({ length: cells }, (_, i) => {
        const isOn = i < active
        const cx = packCell.x + 3 + i * (cellW + rowGap)
        const cy = packCell.y + 3
        const ch = packCell.h - 6
        return (
          <rect
            key={i}
            x={cx}
            y={cy}
            width={Math.max(1, cellW - 2)}
            height={Math.max(1, ch)}
            rx={1.5}
            fill={isOn ? stateColor : palette.surface}
            fillOpacity={isOn ? 1 : 0.35}
          />
        )
      })}
      {/* Cap */}
      <rect
        x={packCell.x + packCell.w - capW}
        y={packCell.y + packCell.h * 0.28}
        width={capW}
        height={packCell.h * 0.44}
        rx={2}
        fill={material.border}
      />

      <FitText
        x={statusCell.x + statusCell.w / 2}
        y={statusCell.y + statusCell.h / 2}
        boxW={statusCell.w}
        boxH={statusCell.h}
        text={status}
        anchor="middle"
        baseline="middle"
        fontFamily={FONT_COND}
        fill={tone ? stateColor : palette.textDim}
        weight={600}
        letterSpacing={1.5}
        minFontPx={11}
        maxFontPx={statusCell.h}
      />
    </svg>
  )
}

// ─── ErsFlowWidget ────────────────────────────────────────────────────────────
// Wide deploy/harvest lane with a headline + big LED bar + % readout (380×84).
export function ErsFlowWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const { palette, material } = skin
  const family = overlayDesignFamily(config?.stylePreset)
  const { W, H } = dims(config, 380, 84)
  const accent = familyAccent(family, palette.accent)
  const panelFill = opaquePanelFill(palette.bg)

  const pct = snapshot?.ersBatteryPct
  const tone = energyTone(pct)
  const charge = clamp(pct ?? 0)
  const deploying = snapshot?.pushToPass === true
  const stateColor = deploying ? DASH.orange : tone ? ENERGY_STATE[tone] : DASH.textDim
  const txt = pctText(pct)
  const head = deploying ? 'DEPLOY' : 'ERS'

  const grid = makeGrid(8, 2, W, H, Math.max(4, Math.round(Math.min(W, H) * 0.05)))
  const headCell = grid.cell(0, 0, 2)
  const barCell = grid.cell(2, 0, 5)
  const iconCell = grid.cell(7, 0, 1, 2)
  const valueCell = grid.cell(0, 1, 7)

  // Lamp goes into a FIXED inner box (never sized to content).
  const iconSize = Math.max(16, Math.min(iconCell.w, iconCell.h))
  const iconX = iconCell.x + (iconCell.w - iconSize) / 2
  const iconY = iconCell.y + (iconCell.h - iconSize) / 2

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      width="100%"
      height="100%"
      role="img"
      aria-label="ERS flow"
      data-widget="ersFlow"
      data-family={family}
      style={{ display: 'block' }}
    >
      <rect x={0} y={0} width={W} height={H} rx={material.radius} fill={panelFill} fillOpacity={1} />
      <rect
        x={0.5}
        y={0.5}
        width={W - 1}
        height={H - 1}
        rx={material.radius}
        fill="none"
        stroke={deploying ? DASH.orange : tone ? stateColor : accent}
        strokeOpacity={deploying ? 1 : 0.55}
        strokeWidth={material.borderWidth}
      />

      <FitText
        x={headCell.x + headCell.w / 2}
        y={headCell.y + headCell.h / 2}
        boxW={headCell.w}
        boxH={headCell.h}
        text={head}
        anchor="middle"
        baseline="middle"
        fontFamily={FONT_COND}
        fill={deploying ? DASH.orange : palette.textDim}
        weight={700}
        letterSpacing={1}
        minFontPx={11}
        maxFontPx={headCell.h}
      />

      <RevLedBar
        pct={tone ? charge : 0}
        segments={22}
        shape="bar"
        gap={Math.max(2, Math.round(barCell.w / 180))}
        x={barCell.x}
        y={barCell.y}
        width={barCell.w}
        height={barCell.h}
        warnAt={0.34}
        dangerAt={0.06}
        redlineFlash={false}
        glow={!!tone || deploying}
        colors={{ good: DASH.green, warn: DASH.amber, danger: DASH.red }}
        idPrefix={idPrefix(config?.id, 'ers-flow-led')}
      />

      <g transform={`translate(${iconX} ${iconY})`}>
        <TelltaleIcon
          icon="ers"
          active={deploying || !!tone}
          activeColor={deploying ? DASH.orange : stateColor}
          size={iconSize}
          label={head}
          glow={deploying}
          idPrefix={idPrefix(config?.id, 'ers-flow-lamp')}
        />
      </g>

      <g transform={`translate(${valueCell.x} ${valueCell.y})`}>
        <SegmentReadout
          value={txt}
          unit="%"
          height={segmentFitHeight(valueCell.w, valueCell.h, txt, '%')}
          width={valueCell.w}
          align="right"
          color={stateColor}
          ghost={false}
          idPrefix={idPrefix(config?.id, 'ers-flow-value')}
        />
      </g>
    </svg>
  )
}

// ─── PushToPassHudWidget ──────────────────────────────────────────────────────
// Headline boost badge — big count + state + telltale (220×160).
export function PushToPassHudWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const { palette, material } = skin
  const family = overlayDesignFamily(config?.stylePreset)
  const { W, H } = dims(config, 220, 160)
  const accent = familyAccent(family, palette.accent)
  const panelFill = opaquePanelFill(palette.bg)

  const state = pushToPassState(snapshot?.pushToPass, snapshot?.pushToPassCount)
  const count = snapshot?.pushToPassCount
  const stateColor = P2P_COLOR[state]
  const label = p2pLabel(state)
  const countTxt = state === 'none' ? '—' : countText(count)

  const grid = makeGrid(3, 4, W, H, Math.max(4, Math.round(Math.min(W, H) * 0.04)))
  const labelCell = grid.cell(0, 0, 2)
  const iconCell = grid.cell(2, 0, 1, 2)
  const valueCell = grid.cell(0, 1, 2, 2)
  const stateCell = grid.cell(0, 3, 3)

  const iconSize = Math.max(20, Math.min(iconCell.w, iconCell.h))
  const iconX = iconCell.x + (iconCell.w - iconSize) / 2
  const iconY = iconCell.y + (iconCell.h - iconSize) / 2

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      width="100%"
      height="100%"
      role="img"
      aria-label="Push to pass"
      data-widget="pushToPassHud"
      data-family={family}
      style={{ display: 'block' }}
    >
      <rect x={0} y={0} width={W} height={H} rx={material.radius} fill={panelFill} fillOpacity={1} />
      <rect
        x={0.5}
        y={0.5}
        width={W - 1}
        height={H - 1}
        rx={material.radius}
        fill="none"
        stroke={state === 'none' ? accent : stateColor}
        strokeOpacity={state === 'active' ? 1 : 0.6}
        strokeWidth={material.borderWidth}
      />

      <FitText
        x={labelCell.x + labelCell.w / 2}
        y={labelCell.y + labelCell.h / 2}
        boxW={labelCell.w}
        boxH={labelCell.h}
        text="P2P"
        anchor="middle"
        baseline="middle"
        fontFamily={FONT_COND}
        fill={palette.textDim}
        weight={700}
        letterSpacing={1}
        minFontPx={11}
        maxFontPx={labelCell.h}
      />

      <g transform={`translate(${iconX} ${iconY})`}>
        <TelltaleIcon
          icon="push-to-pass"
          active={state === 'active' || state === 'ready'}
          activeColor={stateColor}
          size={iconSize}
          label={label}
          glow={state === 'active'}
          idPrefix={idPrefix(config?.id, 'p2p-hud-lamp')}
        />
      </g>

      <g transform={`translate(${valueCell.x} ${valueCell.y})`}>
        <SegmentReadout
          value={countTxt}
          height={segmentFitHeight(valueCell.w, valueCell.h, countTxt)}
          width={valueCell.w}
          align="center"
          color={stateColor}
          ghost={false}
          idPrefix={idPrefix(config?.id, 'p2p-hud-count')}
        />
      </g>

      <FitText
        x={stateCell.x + stateCell.w / 2}
        y={stateCell.y + stateCell.h / 2}
        boxW={stateCell.w}
        boxH={stateCell.h}
        text={label}
        anchor="middle"
        baseline="middle"
        fontFamily={FONT_COND}
        fill={state === 'none' ? palette.textDim : stateColor}
        weight={700}
        letterSpacing={2}
        minFontPx={11}
        maxFontPx={stateCell.h}
      />
    </svg>
  )
}

// ─── PushToPassPipsWidget ─────────────────────────────────────────────────────
// Remaining boosts as a discrete pip row (220×84).
export function PushToPassPipsWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const { palette, material } = skin
  const family = overlayDesignFamily(config?.stylePreset)
  const { W, H } = dims(config, 220, 84)
  const accent = familyAccent(family, palette.accent)
  const panelFill = opaquePanelFill(palette.bg)

  const state = pushToPassState(snapshot?.pushToPass, snapshot?.pushToPassCount)
  const count = snapshot?.pushToPassCount
  const total = 8
  const remaining =
    typeof count === 'number' && Number.isFinite(count)
      ? Math.max(0, Math.min(total, Math.round(count)))
      : 0
  const stateColor = P2P_COLOR[state]
  const valueTxt = state === 'none' ? '—' : countText(count)
  const shiftPctForBar = state === 'none' ? 0 : remaining / total

  const grid = makeGrid(4, 2, W, H, Math.max(4, Math.round(Math.min(W, H) * 0.05)))
  const labelCell = grid.cell(0, 0)
  const valueCell = grid.cell(1, 0, 3)
  const pipCell = grid.cell(0, 1, 4)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      width="100%"
      height="100%"
      role="img"
      aria-label="Push to pass pips"
      data-widget="pushToPassPips"
      data-family={family}
      style={{ display: 'block' }}
    >
      <rect x={0} y={0} width={W} height={H} rx={material.radius} fill={panelFill} fillOpacity={1} />
      <rect
        x={0.5}
        y={0.5}
        width={W - 1}
        height={H - 1}
        rx={material.radius}
        fill="none"
        stroke={state === 'none' ? accent : stateColor}
        strokeOpacity={0.55}
        strokeWidth={material.borderWidth}
      />

      <FitText
        x={labelCell.x + labelCell.w / 2}
        y={labelCell.y + labelCell.h / 2}
        boxW={labelCell.w}
        boxH={labelCell.h}
        text="P2P"
        anchor="middle"
        baseline="middle"
        fontFamily={FONT_COND}
        fill={palette.textDim}
        weight={700}
        letterSpacing={1}
        minFontPx={11}
        maxFontPx={labelCell.h}
      />

      <g transform={`translate(${valueCell.x} ${valueCell.y})`}>
        <SegmentReadout
          value={valueTxt}
          height={segmentFitHeight(valueCell.w, valueCell.h, valueTxt)}
          width={valueCell.w}
          align="right"
          color={stateColor}
          ghost={false}
          idPrefix={idPrefix(config?.id, 'p2p-pips-value')}
        />
      </g>

      {/* Pip row rendered with RevLedBar so we reuse the KIT primitive (no HTML
          flex, and no bespoke geometry). Fixed cell width => structural pips. */}
      <RevLedBar
        pct={shiftPctForBar}
        segments={total}
        shape="bar"
        gap={Math.max(3, Math.round(pipCell.w / 60))}
        x={pipCell.x}
        y={pipCell.y}
        width={pipCell.w}
        height={pipCell.h}
        warnAt={2 / total}
        dangerAt={1 / total}
        redlineFlash={false}
        glow={state === 'active' || state === 'ready'}
        colors={{ good: stateColor, warn: DASH.amber, danger: DASH.red }}
        idPrefix={idPrefix(config?.id, 'p2p-pips-bar')}
      />
    </svg>
  )
}

// Family accents are the only place where OverlayDesignFamily still drives visual
// distinction; every other visual axis is skin- and DASH-token driven now.
