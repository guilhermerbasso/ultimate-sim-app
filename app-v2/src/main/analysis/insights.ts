import type { AnalysisResult, CoachingInsight, InsightsResult, LossPointInfo } from '../../shared/recording'
import { ANALYSIS_NUM_SECTORS } from './engine'

const MIN_LOSS_SEC = 0.03
const HIGH_LOSS_SEC = 0.15
const MED_LOSS_SEC = 0.06
const BRAKE_ONSET_MARGIN_PCT = 0.01
const MIN_SPEED_MARGIN_KMH = 3
const THROTTLE_MARGIN = 0.08
const BRAKE_MARGIN = 0.15
const MAX_INSIGHTS = 8

function severityFor(lossSec: number): CoachingInsight['severity'] {
  if (lossSec >= HIGH_LOSS_SEC) return 'high'
  if (lossSec >= MED_LOSS_SEC) return 'med'
  return 'low'
}

function pctLabel(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function sectorFor(fromPct: number): number {
  return Math.max(1, Math.min(ANALYSIS_NUM_SECTORS, Math.floor(fromPct * ANALYSIS_NUM_SECTORS) + 1))
}

function buildPointText(point: LossPointInfo): { title: string; detail: string } {
  const details: string[] = []

  if (point.primaryBrakeOnsetPct !== null && point.bestBrakeOnsetPct !== null) {
    const delta = point.primaryBrakeOnsetPct - point.bestBrakeOnsetPct
    if (delta < -BRAKE_ONSET_MARGIN_PCT) {
      details.push(`Braking early in turn ~${pctLabel(point.fromPct)} — try braking later.`)
    } else if (delta > BRAKE_ONSET_MARGIN_PCT) {
      details.push(`Braking late in turn ~${pctLabel(point.fromPct)} — brake a little earlier to stabilize entry.`)
    }
  }

  const minSpeedDelta = point.primaryMinSpeedKmh - point.bestMinSpeedKmh
  if (minSpeedDelta < -MIN_SPEED_MARGIN_KMH) {
    details.push(
      `Low minimum speed (${Math.round(point.primaryMinSpeedKmh)} vs ${Math.round(point.bestMinSpeedKmh)} km/h) — carry more speed through the turn.`
    )
  }

  const throttleDelta = point.primaryAvgThrottle - point.bestAvgThrottle
  if (throttleDelta < -THROTTLE_MARGIN) {
    details.push(
      `Get to throttle earlier on exit (average throttle ${Math.round(point.primaryAvgThrottle * 100)}% vs ${Math.round(point.bestAvgThrottle * 100)}%).`
    )
  }

  const brakeDelta = point.primaryMaxBrake - point.bestMaxBrake
  if (brakeDelta > BRAKE_MARGIN) {
    details.push(
      `Braking too hard (${Math.round(point.primaryMaxBrake * 100)}% vs ${Math.round(point.bestMaxBrake * 100)}%) — try modulating better so you do not kill speed.`
    )
  } else if (brakeDelta < -BRAKE_MARGIN) {
    details.push(
      `Brake below reference (${Math.round(point.primaryMaxBrake * 100)}% vs ${Math.round(point.bestMaxBrake * 100)}%) — you may be missing initial pressure.`
    )
  }

  if (details.length === 0) {
    details.push(point.tips[0] ?? 'Loss is concentrated here — compare line, gear, and pedal use.')
  }

  const title = `Perda de ${(point.lossSec * 1000).toFixed(0)} ms no sector ${sectorFor(point.fromPct)}`
  return { title, detail: details.join(' ') }
}

export function buildInsights(
  result: AnalysisResult,
  primaryLapId: string,
  referenceLapId?: string | null
): InsightsResult {
  const reference = referenceLapId ?? result.bestLapId
  const emptySummary = reference
    ? ['No relevant loss zones against reference — good consistency this lap.']
    : ['Select a reference or a valid best lap to generate offline coaching.']

  if (!reference || reference === primaryLapId) {
    return { primaryLapId, referenceLapId: reference, totalLossSec: 0, insights: [], summary: emptySummary }
  }

  const lapLoss = result.losses.find((loss) => loss.lapId === primaryLapId)
  if (!lapLoss) {
    return { primaryLapId, referenceLapId: reference, totalLossSec: 0, insights: [], summary: emptySummary }
  }

  const points = lapLoss.points
    .filter((point) => point.lossSec >= MIN_LOSS_SEC)
    .sort((a, b) => b.lossSec - a.lossSec)
    .slice(0, MAX_INSIGHTS)

  const insights = points.map((point, index): CoachingInsight => {
    const text = buildPointText(point)
    return {
      id: `${primaryLapId}:loss:${index}:${point.fromPct.toFixed(3)}`,
      severity: severityFor(point.lossSec),
      lossSec: point.lossSec,
      atPct: point.fromPct,
      sector: sectorFor(point.fromPct),
      title: text.title,
      detail: text.detail
    }
  })

  const sectorLosses = new Map<number, number>()
  for (const point of lapLoss.points) {
    const sector = sectorFor(point.fromPct)
    sectorLosses.set(sector, (sectorLosses.get(sector) ?? 0) + point.lossSec)
  }
  const topSectors = Array.from(sectorLosses.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3)
  const summary = [
    `Estimated total loss against reference: ${lapLoss.totalLossSec.toFixed(3)}s.`,
    topSectors.length > 0
      ? `Maiores perdas por sector: ${topSectors.map(([sector, loss]) => `S${sector} ${loss.toFixed(3)}s`).join(' · ')}.`
      : 'Sem perdas sectoriais relevantes acima do limiar.',
    insights.length > 0
      ? `Prioridade: ${insights[0].title.toLowerCase()} em ~${pctLabel(insights[0].atPct)}.`
      : 'No actionable insight above the 30 ms threshold.'
  ]

  return { primaryLapId, referenceLapId: reference, totalLossSec: lapLoss.totalLossSec, insights, summary }
}
