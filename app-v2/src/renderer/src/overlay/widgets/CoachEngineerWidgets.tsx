// WS-WIDGETS — NEW Live-Coach + AI-Engineer OVERLAY widgets (text + graph).
//
// Lean, transparent siblings of the dashboard widgets in
// dashboard/widgets/coach-engineer-widgets.tsx — same data, same colour rule,
// but glanceable for an in-game overlay window. They ride the EXISTING `coach:`
// (`useCoachReport`) and `engineer:` (`useEngineerFeed`) preload prefixes; the
// telemetry `snapshot` is unused (these surfaces are report/feed driven).
//
//   • coachTips        — latest 1–3 actionable tips as text
//   • coachFindings    — compact findings stack
//   • coachSectorGraph — per-sector delta bars (pure SVG)
//   • engineerFeed     — latest AI-Engineer radio messages, newest-first
//
// COLOUR RULE (fleet-wide): warm tokens flag something to fix; cool green is the
// `good` state only.

import type { CSSProperties, ReactElement } from 'react'
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
import { GOOD_GREEN, WARM_AMBER, WARM_ORANGE, WARM_RED } from './raceControl'
import { DataTile, SegmentReadout, TelltaleIcon } from '../../instruments'
import type { WidgetProps } from './types'

function toneColor(tone: CoachTone): string {
  switch (tone) {
    case 'good':
      return GOOD_GREEN
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

const MUTED = 'rgba(236, 236, 236, 0.62)'
const PRIMARY = 'rgba(245, 245, 245, 0.96)'

// Condensed/tech label font + DSEG seven-segment numeric font. Both resolve to the
// shared --rc-cond / --rc-num tokens (defined by the fonts layer) with literal
// fallbacks so the overlay keeps the motorsport look even before the tokens load
// — and never falls back to the generic Segoe UI sans.
const FONT_COND = "var(--rc-cond, 'Rajdhani', 'Barlow Condensed', sans-serif)"

// The shared overlay style presets seed every card with a generic "…Segoe UI, sans-serif"
// stack. The coach/engineer cards wear the condensed motorsport label font instead, so any
// preset that still leans on Segoe UI is swapped for the --rc-cond token. A family the user
// deliberately set to something distinct (e.g. a mono preset) is left untouched.
function resolveCardFont(family: string | undefined | null): string {
  if (!family || family.includes('Segoe UI')) return FONT_COND
  return family
}

function cardStyle(config: WidgetProps['config'] | undefined): CSSProperties {
  const s = config?.style
  return {
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    padding: '8px 10px',
    background: s?.background ?? 'rgba(8, 8, 10, 0.58)',
    border: `1px solid ${s?.border ?? 'rgba(255, 255, 255, 0.10)'}`,
    borderRadius: s?.radius ?? 10,
    fontFamily: resolveCardFont(s?.fontFamily),
    overflow: 'hidden'
  }
}

function Head({ accent, children }: { accent: string; children: string }): ReactElement {
  return (
    <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: accent, fontWeight: 600 }}>
      {children}
    </div>
  )
}

function Empty({ children }: { children: string }): ReactElement {
  return <div style={{ fontSize: 12, color: MUTED, display: 'flex', alignItems: 'center', flex: 1 }}>{children}</div>
}

function StatusRail({ label, value, active, color }: { label: string; value: string | number; active: boolean; color: string }): ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <DataTile label={label} value={value} width={86} height={38} color={color} accent={WARM_AMBER} material="matte" idPrefix={`coach-${label}`} />
      <TelltaleIcon icon="temp" active={active} activeColor={color} label={label} size={20} idPrefix={`coach-lamp-${label}`} />
    </div>
  )
}

// ── coachTips ────────────────────────────────────────────────────────────────
export function CoachTipsWidget({ config }: WidgetProps): ReactElement {
  const report = useCoachReport()
  const tips = topCoachTips(report, 3)
  const accent = config?.style?.accent ?? WARM_AMBER

  return (
    <div className="overlay-card" style={cardStyle(config)}>
      <Head accent={accent}>Dicas do coach</Head>
      <StatusRail label="TIPS" value={tips.length} active={tips.length > 0} color={tips.length > 0 ? WARM_AMBER : MUTED} />
      {tips.length === 0 ? (
        <Empty>No tips yet</Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minHeight: 0, flex: 1 }}>
          {tips.map((tip) => (
            <OverlayTip key={tip.id} finding={tip} />
          ))}
        </div>
      )}
    </div>
  )
}

function OverlayTip({ finding }: { finding: CoachFinding }): ReactElement {
  const color = toneColor(findingTone(finding.severity))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingLeft: 7, borderLeft: `3px solid ${color}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
        <span style={{ fontSize: 10, letterSpacing: '0.06em', color, textTransform: 'uppercase', flex: '0 0 auto' }}>
          {findingScope(finding)}
        </span>
        <span style={{ fontSize: 13, color: PRIMARY, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {finding.title}
        </span>
      </div>
      {finding.detail ? (
        <span style={{ fontSize: 11, color: MUTED, lineHeight: 1.25, overflow: 'hidden' }}>{finding.detail}</span>
      ) : null}
    </div>
  )
}

// ── coachFindings ────────────────────────────────────────────────────────────
export function CoachFindingsWidget({ config }: WidgetProps): ReactElement {
  const report = useCoachReport()
  const findings = coachFindings(report, 10)
  const accent = config?.style?.accent ?? WARM_AMBER

  return (
    <div className="overlay-card" style={cardStyle(config)}>
      <Head accent={accent}>Achados do coach</Head>
      <StatusRail label="FIND" value={findings.length} active={findings.length > 0} color={findings.length > 0 ? WARM_ORANGE : MUTED} />
      {findings.length === 0 ? (
        <Empty>No analysis yet</Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, overflowY: 'auto', minHeight: 0, flex: 1 }}>
          {findings.map((f) => (
            <OverlayFinding key={f.id} finding={f} />
          ))}
        </div>
      )}
    </div>
  )
}

function OverlayFinding({ finding }: { finding: CoachFinding }): ReactElement {
  const color = toneColor(findingTone(finding.severity))
  const loss = finding.estTimeLossSec > 0 ? `-${finding.estTimeLossSec.toFixed(2)}` : ''
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flex: '0 0 auto' }} />
      <span style={{ fontSize: 10, color, letterSpacing: '0.04em', flex: '0 0 auto', minWidth: 46 }}>{findingScope(finding)}</span>
      <span style={{ fontSize: 12, color: PRIMARY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
        {finding.title}
      </span>
      {loss ? <SegmentReadout value={loss} unit="s" height={12} color={color} idPrefix="coach-loss" /> : null}
    </div>
  )
}

// ── coachSectorGraph ─────────────────────────────────────────────────────────
export function CoachSectorGraphWidget({ config }: WidgetProps): ReactElement {
  const report = useCoachReport()
  const bars = sectorDeltaBars(report)
  const accent = config?.style?.accent ?? WARM_AMBER

  return (
    <div className="overlay-card" style={cardStyle(config)}>
      <Head accent={accent}>Sectors ? loss</Head>
      <StatusRail label="SECT" value={bars.length} active={bars.length > 0} color={bars.length > 0 ? WARM_AMBER : MUTED} />
      {bars.length === 0 ? (
        <Empty>No sectors yet</Empty>
      ) : (
        <div style={{ flex: 1, minHeight: 0 }}>
          <OverlaySectorBars bars={bars} />
        </div>
      )}
    </div>
  )
}

function OverlaySectorBars({ bars }: { bars: SectorDeltaBar[] }): ReactElement {
  const W = 100
  const H = 56
  const maxLoss = Math.max(0.05, ...bars.map((b) => b.timeLossSec))
  const slot = W / bars.length
  const barW = Math.max(2, slot * 0.6)
  const baseY = H - 11

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
      <line x1={0} y1={baseY} x2={W} y2={baseY} stroke="rgba(255,255,255,0.18)" strokeWidth={0.6} />
      {bars.map((b, i) => {
        const color = b.good ? GOOD_GREEN : WARM_ORANGE
        const h = b.good ? 4 : Math.max(3, (b.timeLossSec / maxLoss) * (baseY - 4))
        const x = i * slot + (slot - barW) / 2
        const y = baseY - h
        return (
          <g key={b.sector}>
            <rect x={x} y={y} width={barW} height={h} rx={1} fill={color} opacity={b.good ? 0.85 : 0.92} />
            <text x={x + barW / 2} y={H - 2} textAnchor="middle" fontSize={6} fill={MUTED}>
              S{b.sector}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ── engineerFeed ─────────────────────────────────────────────────────────────
export function EngineerFeedWidget({ config }: WidgetProps): ReactElement {
  const feed = useEngineerFeed(5)
  const accent = config?.style?.accent ?? WARM_AMBER

  return (
    <div className="overlay-card" style={cardStyle(config)}>
      <Head accent={accent}>Engineer ? radio</Head>
      <StatusRail label="RADIO" value={feed.length} active={feed.length > 0} color={feed.length > 0 ? accent : MUTED} />
      {feed.length === 0 ? (
        <Empty>No messages yet</Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', minHeight: 0, flex: 1 }}>
          {feed.map((item) => (
            <OverlayFeedRow key={item.id} item={item} accent={accent} />
          ))}
        </div>
      )}
    </div>
  )
}

function OverlayFeedRow({ item, accent }: { item: EngineerFeedItem; accent: string }): ReactElement {
  const tone = item.source === 'proactive' && item.severity ? toneColor(findingTone(item.severity)) : accent
  const clock = feedClock(item.at)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingLeft: 7, borderLeft: `3px solid ${tone}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 9, letterSpacing: '0.07em', color: tone, textTransform: 'uppercase' }}>
          {item.source === 'proactive' ? `Sector ${item.sector ?? '—'}` : 'Resposta'}
        </span>
        {clock ? <SegmentReadout value={clock} height={10} color={MUTED} idPrefix="engineer-clock" /> : null}
      </div>
      <span style={{ fontSize: 12, color: PRIMARY, lineHeight: 1.3 }}>{item.text}</span>
    </div>
  )
}
