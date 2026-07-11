import type { CSSProperties, ReactElement } from 'react'
import type { CoachReport, CoachSeverity } from '../../../../shared/coach'
import type { UnitSystem } from '../../../../shared/units'
import type { HifiAiContext, HifiAiSeverity } from '../../hifi/widgets/types'
import { HIFI_WIDGETS_BY_ID } from '../../hifi/widgets/registry'
import { useCoachReport } from '../../lib/coach-heatmap'
import { coachFindings, topCoachTips } from '../../lib/coach-insights'
import { useEngineerFeed, type EngineerFeedItem } from '../../lib/engineer-feed'
import type { WidgetProps } from './types'
import { useUnitSystem } from '../../lib/units'

const BOX_FILL_STRIP_IDS = new Set([
  'rpmBar',
  'revlights',
  'revlightsGradient',
  'revlightsLedStrip',
  'revlightsLedBar',
  'revlightsMustang',
  'revLightsBar',
  'alertShiftFlash',
  'revThemedFerrari',
  'revThemedPorsche',
  'revThemedAmg',
  'revThemedMclaren',
  'revThemedCorvette',
  'revThemedLambo',
  'cvRevLights',
  'f296RevLights',
  'f488RevLights',
  'lhRevLights',
  'pcupRevBar'
])

function moduleIdFromConfig(config: WidgetProps['config']): string {
  return config.hifiModuleId ?? (config.id.startsWith('hifi:') ? config.id.slice(5) : config.id)
}

function severityToHifi(severity: CoachSeverity): HifiAiSeverity {
  if (severity === 'high') return 'high'
  if (severity === 'med') return 'med'
  return 'low'
}

function proactiveLevel(severity: CoachSeverity | undefined): 'info' | 'warn' | 'crit' {
  if (severity === 'high') return 'crit'
  if (severity === 'med') return 'warn'
  return 'info'
}

export const PREVIEW_COACH_REPORT: CoachReport = {
  generatedAt: 0,
  lapNumber: 12,
  lapTimeSec: 138.452,
  bestLapTimeSec: 137.911,
  deltaToBestSec: 0.541,
  sampleCount: 96,
  sectors: [
    { sector: 1, timeLossSec: 0.18, minSpeedKmh: 112, brakePct: 0.22, coastPct: 0.08, throttlePct: 0.7, absSec: 0.2, tcSec: 0.1, benchmark: false },
    { sector: 2, timeLossSec: 0, minSpeedKmh: 126, brakePct: 0.18, coastPct: 0.04, throttlePct: 0.78, absSec: 0, tcSec: 0, benchmark: true }
  ],
  findings: [{
    id: 'preview-coach-t4',
    kind: 'brake-late',
    sector: 1,
    corner: 4,
    zonePctStart: 0.35,
    zonePctEnd: 0.42,
    severity: 'med',
    estTimeLossSec: 0.18,
    title: 'Brake release at T4',
    detail: 'Release the brake earlier and carry apex speed.',
    evidence: 'Static preview fixture',
    metrics: {}
  }],
  corners: [],
  cornerMetrics: [],
  summary: 'Consistent GT3 preview lap.'
}

export const PREVIEW_ENGINEER_FEED: EngineerFeedItem[] = [
  { id: 'preview-proactive', at: 0, text: 'Tyres stable; keep this pace.', source: 'proactive', sector: 2, severity: 'low' },
  { id: 'preview-answer', at: 0, text: 'Box in three laps for fuel.', source: 'answer', question: 'Strategy?' }
]

function buildAiContext(
  report: CoachReport | null,
  engineerFeed: readonly EngineerFeedItem[]
): HifiAiContext {
  const topTip = topCoachTips(report, 1)[0]
  const findings = coachFindings(report, 8)
  const latestEngineer = engineerFeed[0]
  const latestProactive = engineerFeed.find((item) => item.source === 'proactive')
  // Surface a strategy call ONLY from a real engineer/proactive message that is
  // clearly strategic (pit/stint/fuel/tyre/under-overcut). Never fabricate one.
  const strategyMsg = engineerFeed.find((item) =>
    /\b(pit|box|stint|under-?cut|over-?cut|strateg|fuel save|save fuel|lift and coast)\b/i.test(item.text)
  )
  const confidence = report && report.sampleCount > 0
    ? Math.min(1, Math.max(0.35, report.sampleCount / 120))
    : null

  return {
    coachTip: topTip
      ? {
          text: topTip.detail || topTip.title || report?.summary || '',
          corner: topTip.corner ? `T${topTip.corner}` : undefined,
          confidence: confidence ?? undefined
        }
      : null,
    coachFindings: findings.length > 0
      ? findings.map((finding) => ({
          label: finding.title || finding.detail || finding.kind,
          severity: severityToHifi(finding.severity)
        }))
      : null,
    engineerRadio: latestEngineer ? { text: latestEngineer.text, at: latestEngineer.at } : null,
    proactiveAlert: latestProactive
      ? { text: latestProactive.text, level: proactiveLevel(latestProactive.severity) }
      : null,
    strategy: strategyMsg ? { text: strategyMsg.text } : null,
    confidence
  }
}

const PREVIEW_AI_CONTEXT = buildAiContext(PREVIEW_COACH_REPORT, PREVIEW_ENGINEER_FEED)

function HifiWidgetView({ props, ai, unitSystem }: { props: WidgetProps; ai: HifiAiContext; unitSystem: UnitSystem }): ReactElement {
  const moduleId = moduleIdFromConfig(props.config)
  const mod = HIFI_WIDGETS_BY_ID[moduleId]

  if (!mod) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,0.48)', fontSize: 12 }}>
        Hi-fi widget unavailable
      </div>
    )
  }

  // Most hi-fi widgets keep their authored aspect ratio. Horizontal rev/RPM strips
  // are the exception: render them in a transparent placed box so wide-short
  // layouts fill the full width instead of inheriting panel chrome or letterboxing.
  const fillBox = BOX_FILL_STRIP_IDS.has(mod.id)
  const dw = Math.max(1, Math.round(fillBox ? props.config.position.width : mod.defaultSize.w))
  const dh = Math.max(1, Math.round(fillBox ? props.config.position.height : mod.defaultSize.h))
  const content = mod.render({ snapshot: props.snapshot, ai, width: dw, height: dh, unitSystem })
  const style = props.config.style
  const borderColor = style.borderColor ?? style.border
  const borderWidth = Math.max(0, Math.round(style.borderWidth ?? (borderColor && borderColor !== 'transparent' ? 1 : 0)))
  const opacity = Number.isFinite(style.opacity) ? Math.max(0, Math.min(1, style.opacity ?? 1)) : 1
  const lines = style.lines?.filter((line) => line.color.trim()) ?? []
  const dividerLines = !fillBox && style.showDivider ? (lines.length === 0 ? [{ color: borderColor || style.accent }] : lines) : []
  const hostStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    overflow: 'hidden',
    display: 'block',
    background: fillBox ? 'transparent' : style.background || 'transparent',
    border: !fillBox && borderWidth > 0 ? `${borderWidth}px solid ${borderColor || style.accent}` : 'none',
    borderRadius: fillBox ? 0 : Math.max(0, style.radius ?? 0),
    fontFamily: style.fontFamily,
    color: style.accent,
    opacity,
    ['--overlay-bg' as string]: style.background,
    ['--overlay-accent' as string]: style.accent,
    ['--overlay-border' as string]: borderColor,
    ['--overlay-radius' as string]: `${Math.max(0, style.radius ?? 0)}px`,
    ['--overlay-font' as string]: style.fontFamily
  } as CSSProperties

  return (
    <div style={hostStyle}>
      <svg
        viewBox={`0 0 ${dw} ${dh}`}
        width="100%"
        height="100%"
        preserveAspectRatio={fillBox ? 'none' : 'xMidYMid meet'}
        style={{ display: 'block' }}
        role="img"
      >
        {content}
      </svg>
      {dividerLines.map((line, index) => (
        <div
          key={`${line.color}-${index}`}
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: `${((index + 1) / (dividerLines.length + 1)) * 100}%`,
            height: 1,
            background: line.color,
            opacity: 0.85,
            pointerEvents: 'none'
          }}
        />
      ))}
    </div>
  )
}

function LiveHifiWidgetHost({ props, unitSystem }: { props: WidgetProps; unitSystem: UnitSystem }): ReactElement {
  const coachReport = useCoachReport()
  const engineerFeed = useEngineerFeed()
  return <HifiWidgetView props={props} ai={buildAiContext(coachReport, engineerFeed)} unitSystem={unitSystem} />
}

export interface HifiWidgetHostProps extends WidgetProps {
  preview?: 'inert'
}

export function HifiWidgetHost({ preview, ...props }: HifiWidgetHostProps): ReactElement {
  const unitSystem = useUnitSystem()
  if (preview === 'inert') {
    return <HifiWidgetView props={props} ai={PREVIEW_AI_CONTEXT} unitSystem={unitSystem} />
  }
  return <LiveHifiWidgetHost props={props} unitSystem={unitSystem} />
}
