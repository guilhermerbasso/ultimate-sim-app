import type { ReactElement } from 'react'
import type { CoachSeverity } from '../../../../shared/coach'
import type { HifiAiContext, HifiAiSeverity } from '../../hifi/widgets/types'
import { HIFI_WIDGETS_BY_ID } from '../../hifi/widgets/registry'
import { useCoachReport } from '../../lib/coach-heatmap'
import { coachFindings, topCoachTips } from '../../lib/coach-insights'
import { useEngineerFeed } from '../../lib/engineer-feed'
import type { WidgetProps } from './types'

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
  'revThemedLambo'
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

function buildAiContext(
  report: ReturnType<typeof useCoachReport>,
  engineerFeed: ReturnType<typeof useEngineerFeed>
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

export function HifiWidgetHost(props: WidgetProps): ReactElement {
  const coachReport = useCoachReport()
  const engineerFeed = useEngineerFeed()
  const moduleId = moduleIdFromConfig(props.config)
  const mod = HIFI_WIDGETS_BY_ID[moduleId]
  const ai = buildAiContext(coachReport, engineerFeed)

  if (!mod) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,0.48)', fontSize: 12 }}>
        Hi-fi widget unavailable
      </div>
    )
  }

  // Most hi-fi widgets keep their authored aspect ratio. Horizontal rev/RPM strips
  // are the exception: render them in the placed box so wide-short layouts fill
  // the full width instead of letterboxing to the default aspect ratio.
  const fillBox = BOX_FILL_STRIP_IDS.has(mod.id)
  const dw = Math.max(1, Math.round(fillBox ? props.config.position.width : mod.defaultSize.w))
  const dh = Math.max(1, Math.round(fillBox ? props.config.position.height : mod.defaultSize.h))
  const content = mod.render({ snapshot: props.snapshot, ai, width: dw, height: dh })

  return (
    <svg
      viewBox={`0 0 ${dw} ${dh}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block' }}
      role="img"
    >
      {content}
    </svg>
  )
}
