import type { ReactElement } from 'react'
import type { CoachSeverity } from '../../../../shared/coach'
import type { HifiAiContext, HifiAiSeverity } from '../../hifi/widgets/types'
import { HIFI_WIDGETS_BY_ID } from '../../hifi/widgets/registry'
import { useCoachReport } from '../../lib/coach-heatmap'
import { coachFindings, topCoachTips } from '../../lib/coach-insights'
import { useEngineerFeed } from '../../lib/engineer-feed'
import type { WidgetProps } from './types'

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
    strategy: null,
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

  // Render every hi-fi widget in its intrinsic design coordinate space
  // (defaultSize) and letterbox it into whatever box it is placed in. The
  // widgets are authored with fixed SVG coordinates sized for their defaultSize,
  // so rendering at that size and scaling with preserveAspectRatio="xMidYMid meet"
  // guarantees they never clip or overflow at ANY dashboard/overlay box size or
  // aspect ratio (they scale down/up uniformly and centre instead).
  const dw = Math.max(1, Math.round(mod.defaultSize.w))
  const dh = Math.max(1, Math.round(mod.defaultSize.h))
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
