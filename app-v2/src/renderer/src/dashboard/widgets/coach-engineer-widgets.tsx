// WS-WIDGETS — NEW Live-Coach + AI-Engineer DASHBOARD widgets (v2.39 KIT).
//
// A LEAF registry (imports the skin KIT, the shared wave-16 frame helper and the
// pure lib helpers — never gt3-widgets) so it slots into the `renderGt3Widget`
// fallback chain WITHOUT an import cycle, exactly like coach-heatmap-widget.tsx /
// new-widgets-predictions.tsx. Dispatches on the RAW type string so it compiles
// regardless of whether the ids are wired into `DashboardElementType` yet.
//
// Four widgets:
//   • coach-tips         — latest 1–3 actionable Live-Coach tips as text
//   • coach-findings     — condensed findings list
//   • coach-sector-graph — per-sector delta bar graph (pure SVG)
//   • engineer-feed      — latest AI-Engineer radio messages, newest-first
//
// Structural contract: each widget renders ONE root <svg> (fixed viewBox +
// preserveAspectRatio) via WidgetFrame and routes EVERY line of guidance text
// through the skin-aware FitText (overflowStrategy='ellipsis' for long phrases),
// so overflow / clipping / tiny-text are structurally impossible. The list length
// is capped to the rows that actually fit the cell.
//
// COLOUR RULE (fleet-wide): warm tokens (amber/orange/red) flag something to
// improve; cool green is reserved for the `good` state only.

import type { ReactElement, ReactNode } from 'react'
import type { DashboardElement } from '../../../../shared/dashboards'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import type { CoachFinding } from '../../../../shared/coach'
import { useCoachReport } from '../../lib/coach-heatmap'
import {
  type CoachTone,
  type SectorDeltaBar,
  coachFindings,
  findingScope,
  findingTone,
  sectorDeltaBars,
  topCoachTips
} from '../../lib/coach-insights'
import { feedClock, useEngineerFeed, type EngineerFeedItem } from '../../lib/engineer-feed'
import { FitText, resolveElementSkin } from '../../skins'
import type { SkinToken } from '../../skins'
import { Caption, WidgetFrame, hexAlpha } from './new-widgets-minimal'
import {
  COOL_GREEN,
  WARM_AMBER,
  WARM_ORANGE,
  WARM_RED,
  accentOf,
  type NewWidgetProps
} from './new-widgets-kit'

function clampNum(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

// ── Tone → colour (warm to fix, green only for good) ─────────────────────────
function toneColor(tone: CoachTone): string {
  switch (tone) {
    case 'good':
      return COOL_GREEN
    case 'improve':
      return WARM_AMBER
    case 'warn':
      return WARM_ORANGE
    case 'critical':
      return WARM_RED
    default:
      return WARM_AMBER
  }
}

interface Layout {
  skin: SkinToken
  accent: string
  W: number
  H: number
  pad: number
  headerH: number
  bodyX: number
  bodyY: number
  bodyW: number
  bodyH: number
}

function layoutOf(element: DashboardElement): Layout {
  const skin = resolveElementSkin(element.style)
  const accent = accentOf(element.style, skin.palette.accent)
  const W = element.w
  const H = element.h
  const pad = clampNum(Math.min(W, H) * 0.06, 8, 14)
  const headerH = clampNum(H * 0.16, 12, 22)
  const gapTop = clampNum(H * 0.03, 3, 8)
  const bodyY = pad + headerH + gapTop
  return { skin, accent, W, H, pad, headerH, bodyX: pad, bodyY, bodyW: Math.max(1, W - pad * 2), bodyH: Math.max(1, H - bodyY - pad) }
}

// A shell: root <svg> panel + a header caption. Body content is drawn by the
// caller into the reserved body rect (already overflow-safe).
function CoachShell({
  element,
  layout,
  header,
  children
}: {
  element: DashboardElement
  layout: Layout
  header: string
  children: ReactNode
}): ReactElement {
  const { skin, accent, pad, bodyX, bodyW, headerH } = layout
  return (
    <WidgetFrame element={element} skin={skin} variant="futuristic" accent={accent}>
      <Caption skin={skin} x={bodyX} y={pad} w={bodyW} h={headerH} text={header} fill={hexAlpha(accent, 0.95)} anchor="start" />
      {children}
    </WidgetFrame>
  )
}

// One-line note centred in the body rect (graceful empty state).
function EmptyNote({ layout, text }: { layout: Layout; text: string }): ReactElement {
  const { skin, bodyX, bodyY, bodyW, bodyH } = layout
  const h = clampNum(bodyH, 12, 26)
  return (
    <FitText
      x={bodyX}
      y={bodyY + bodyH / 2}
      boxW={bodyW}
      boxH={h}
      text={text}
      anchor="start"
      baseline="middle"
      fontFamily={skin.typography.label}
      fill={skin.palette.textDim}
      minFontPx={Math.max(1, skin.typography.minFontPx)}
      maxFontPx={Math.max(skin.typography.minFontPx, Math.min(15, h))}
      overflowStrategy="ellipsis"
    />
  )
}

// Rows that fit the body rect at a legible row height.
function rowPlan(layout: Layout, count: number, desiredRowH: number): { rowH: number; rowGap: number; rows: number; y: (i: number) => number } {
  const rowGap = clampNum(layout.bodyH * 0.04, 2, 6)
  const rowH = clampNum(desiredRowH, Math.max(12, layout.skin.typography.minFontPx + 2), 26)
  const rows = Math.max(1, Math.min(count, Math.floor((layout.bodyH + rowGap) / (rowH + rowGap))))
  return { rowH, rowGap, rows, y: (i: number) => layout.bodyY + i * (rowH + rowGap) }
}

// ── coach-tips ───────────────────────────────────────────────────────────────
function CoachTips({ element }: NewWidgetProps): ReactElement {
  const report = useCoachReport()
  const tips = topCoachTips(report, 3)
  const layout = layoutOf(element)
  const { skin } = layout
  const plan = rowPlan(layout, tips.length, layout.bodyH * 0.32)
  const scopeW = clampNum(layout.bodyW * 0.24, 40, 96)
  return (
    <CoachShell element={element} layout={layout} header="Dicas do coach">
      {tips.length === 0 ? (
        <EmptyNote layout={layout} text="Sem dicas ainda" />
      ) : (
        tips.slice(0, plan.rows).map((tip, i) => {
          const color = toneColor(findingTone(tip.severity))
          const y = plan.y(i)
          const cy = y + plan.rowH / 2
          const titleX = layout.bodyX + 7 + scopeW + 6
          const titleW = Math.max(1, layout.bodyX + layout.bodyW - titleX)
          return (
            <g key={tip.id}>
              <rect x={layout.bodyX} y={y + 1} width={3} height={plan.rowH - 2} rx={1.5} fill={color} />
              <Caption skin={skin} x={layout.bodyX + 7} y={y} w={scopeW} h={plan.rowH} text={findingScope(tip)} fill={color} anchor="start" />
              <FitText x={titleX} y={cy} boxW={titleW} boxH={plan.rowH} text={tip.title} anchor="start" baseline="middle" fontFamily={skin.typography.value} fill={skin.palette.text} weight={600} minFontPx={Math.max(1, skin.typography.minFontPx)} maxFontPx={Math.max(skin.typography.minFontPx, Math.min(16, plan.rowH))} overflowStrategy="ellipsis" />
            </g>
          )
        })
      )}
    </CoachShell>
  )
}

// ── coach-findings ───────────────────────────────────────────────────────────
function CoachFindingsList({ element }: NewWidgetProps): ReactElement {
  const report = useCoachReport()
  const findings = coachFindings(report, 16)
  const layout = layoutOf(element)
  const { skin } = layout
  const plan = rowPlan(layout, findings.length, layout.bodyH * 0.16)
  const scopeW = clampNum(layout.bodyW * 0.2, 40, 90)
  const lossW = clampNum(layout.bodyW * 0.16, 34, 70)
  const dot = 6
  return (
    <CoachShell element={element} layout={layout} header="Achados do coach">
      {findings.length === 0 ? (
        <EmptyNote layout={layout} text="Sem análise ainda" />
      ) : (
        findings.slice(0, plan.rows).map((f: CoachFinding, i) => {
          const color = toneColor(findingTone(f.severity))
          const y = plan.y(i)
          const cy = y + plan.rowH / 2
          const hasLoss = Number.isFinite(f.estTimeLossSec) && f.estTimeLossSec > 0
          const scopeX = layout.bodyX + dot + 6
          const titleX = scopeX + scopeW + 4
          const titleRight = layout.bodyX + layout.bodyW - (hasLoss ? lossW + 4 : 0)
          const titleW = Math.max(1, titleRight - titleX)
          return (
            <g key={f.id}>
              <circle cx={layout.bodyX + dot / 2} cy={cy} r={dot / 2} fill={color} />
              <Caption skin={skin} x={scopeX} y={y} w={scopeW} h={plan.rowH} text={findingScope(f)} fill={color} anchor="start" />
              <FitText x={titleX} y={cy} boxW={titleW} boxH={plan.rowH} text={f.title} anchor="start" baseline="middle" fontFamily={skin.typography.value} fill={skin.palette.text} minFontPx={Math.max(1, skin.typography.minFontPx)} maxFontPx={Math.max(skin.typography.minFontPx, Math.min(14, plan.rowH))} overflowStrategy="ellipsis" />
              {hasLoss ? (
                <FitText x={layout.bodyX + layout.bodyW} y={cy} boxW={lossW} boxH={plan.rowH} text={`-${f.estTimeLossSec.toFixed(2)}s`} anchor="end" baseline="middle" fontFamily={skin.typography.value} fill={color} minFontPx={Math.max(1, skin.typography.minFontPx)} maxFontPx={Math.max(skin.typography.minFontPx, Math.min(13, plan.rowH))} overflowStrategy="ellipsis" />
              ) : null}
            </g>
          )
        })
      )}
    </CoachShell>
  )
}

// ── coach-sector-graph ───────────────────────────────────────────────────────
function CoachSectorGraph({ element }: NewWidgetProps): ReactElement {
  const report = useCoachReport()
  const bars = sectorDeltaBars(report)
  const layout = layoutOf(element)
  return (
    <CoachShell element={element} layout={layout} header="Setores · perda">
      {bars.length === 0 ? <EmptyNote layout={layout} text="Sem setores ainda" /> : <SectorBars bars={bars} layout={layout} />}
    </CoachShell>
  )
}

function SectorBars({ bars, layout }: { bars: SectorDeltaBar[]; layout: Layout }): ReactElement {
  const { skin, bodyX, bodyY, bodyW, bodyH } = layout
  const labelH = clampNum(bodyH * 0.2, 9, 16)
  const baseY = bodyY + bodyH - labelH
  const usableH = Math.max(2, baseY - bodyY)
  const maxLoss = Math.max(0.05, ...bars.map((b) => (Number.isFinite(b.timeLossSec) ? b.timeLossSec : 0)))
  const slot = bodyW / bars.length
  const barW = Math.max(2, slot * 0.6)
  return (
    <>
      <line x1={bodyX} y1={baseY} x2={bodyX + bodyW} y2={baseY} stroke={hexAlpha(skin.palette.textDim, 0.4)} strokeWidth={1} />
      {bars.map((b, i) => {
        const color = b.good ? COOL_GREEN : WARM_ORANGE
        const loss = Number.isFinite(b.timeLossSec) ? b.timeLossSec : 0
        const h = b.good ? Math.min(usableH, 4) : clampNum((loss / maxLoss) * usableH, 3, usableH)
        const x = bodyX + i * slot + (slot - barW) / 2
        const y = baseY - h
        return (
          <g key={b.sector}>
            <rect x={x} y={y} width={barW} height={h} rx={1} fill={color} opacity={b.good ? 0.85 : 0.94} />
            <Caption skin={skin} x={bodyX + i * slot} y={baseY + 1} w={slot} h={labelH} text={`S${b.sector}`} fill={skin.palette.textDim} anchor="middle" />
          </g>
        )
      })}
    </>
  )
}

// ── engineer-feed ────────────────────────────────────────────────────────────
function EngineerFeed({ element }: NewWidgetProps): ReactElement {
  const feed = useEngineerFeed(6)
  const layout = layoutOf(element)
  const { skin, accent } = layout
  const plan = rowPlan(layout, feed.length, layout.bodyH * 0.2)
  const scopeW = clampNum(layout.bodyW * 0.24, 44, 96)
  const clockW = clampNum(layout.bodyW * 0.16, 30, 60)
  return (
    <CoachShell element={element} layout={layout} header="Engenheiro · rádio">
      {feed.length === 0 ? (
        <EmptyNote layout={layout} text="Sem mensagens ainda" />
      ) : (
        feed.slice(0, plan.rows).map((item: EngineerFeedItem, i) => {
          const tone = item.source === 'proactive' && item.severity ? toneColor(findingTone(item.severity)) : accent
          const clock = feedClock(item.at)
          const scopeText = item.source === 'proactive' ? `Setor ${item.sector ?? '—'}` : 'Resposta'
          const y = plan.y(i)
          const cy = y + plan.rowH / 2
          const textX = layout.bodyX + 7 + scopeW + 6
          const textRight = layout.bodyX + layout.bodyW - (clock ? clockW + 4 : 0)
          const textW = Math.max(1, textRight - textX)
          return (
            <g key={item.id}>
              <rect x={layout.bodyX} y={y + 1} width={3} height={plan.rowH - 2} rx={1.5} fill={tone} />
              <Caption skin={skin} x={layout.bodyX + 7} y={y} w={scopeW} h={plan.rowH} text={scopeText} fill={tone} anchor="start" />
              <FitText x={textX} y={cy} boxW={textW} boxH={plan.rowH} text={item.text} anchor="start" baseline="middle" fontFamily={skin.typography.value} fill={skin.palette.text} minFontPx={Math.max(1, skin.typography.minFontPx)} maxFontPx={Math.max(skin.typography.minFontPx, Math.min(14, plan.rowH))} overflowStrategy="ellipsis" />
              {clock ? (
                <FitText x={layout.bodyX + layout.bodyW} y={cy} boxW={clockW} boxH={plan.rowH} text={clock} anchor="end" baseline="middle" fontFamily={skin.typography.value} fill={skin.palette.textDim} minFontPx={Math.max(1, skin.typography.minFontPx)} maxFontPx={Math.max(skin.typography.minFontPx, Math.min(12, plan.rowH))} overflowStrategy="ellipsis" />
              ) : null}
            </g>
          )
        })
      )}
    </CoachShell>
  )
}

// ── Registry + dispatch ──────────────────────────────────────────────────────
export const COACH_ENGINEER_WIDGET_TYPES = [
  'coach-tips',
  'coach-findings',
  'coach-sector-graph',
  'engineer-feed'
] as const

export function renderCoachEngineerWidget(props: {
  element: DashboardElement
  snapshot: TelemetrySnapshot | null
}): ReactElement | null {
  // Switch on the raw type string so this leaf registry compiles + dispatches
  // regardless of whether the id is in DashboardElementType yet.
  const type: string = props.element.type
  switch (type) {
    case 'coach-tips':
      return <CoachTips {...props} />
    case 'coach-findings':
      return <CoachFindingsList {...props} />
    case 'coach-sector-graph':
      return <CoachSectorGraph {...props} />
    case 'engineer-feed':
      return <EngineerFeed {...props} />
    default:
      return null
  }
}
