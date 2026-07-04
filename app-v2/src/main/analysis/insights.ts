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
      details.push(`Freando cedo na curva ~${pctLabel(point.fromPct)} — tente atrasar o ponto de freada.`)
    } else if (delta > BRAKE_ONSET_MARGIN_PCT) {
      details.push(`Freando tarde na curva ~${pctLabel(point.fromPct)} — antecipe um pouco para estabilizar a entrada.`)
    }
  }

  const minSpeedDelta = point.primaryMinSpeedKmh - point.bestMinSpeedKmh
  if (minSpeedDelta < -MIN_SPEED_MARGIN_KMH) {
    details.push(
      `Velocidade mínima baixa (${Math.round(point.primaryMinSpeedKmh)} vs ${Math.round(point.bestMinSpeedKmh)} km/h) — carregue mais velocidade na curva.`
    )
  }

  const throttleDelta = point.primaryAvgThrottle - point.bestAvgThrottle
  if (throttleDelta < -THROTTLE_MARGIN) {
    details.push(
      `Acelere mais cedo na saída (throttle médio ${Math.round(point.primaryAvgThrottle * 100)}% vs ${Math.round(point.bestAvgThrottle * 100)}%).`
    )
  }

  const brakeDelta = point.primaryMaxBrake - point.bestMaxBrake
  if (brakeDelta > BRAKE_MARGIN) {
    details.push(
      `Freio muito forte (${Math.round(point.primaryMaxBrake * 100)}% vs ${Math.round(point.bestMaxBrake * 100)}%) — experimente modular melhor para não matar velocidade.`
    )
  } else if (brakeDelta < -BRAKE_MARGIN) {
    details.push(
      `Freio abaixo da referência (${Math.round(point.primaryMaxBrake * 100)}% vs ${Math.round(point.bestMaxBrake * 100)}%) — pode estar faltando pressão inicial.`
    )
  }

  if (details.length === 0) {
    details.push(point.tips[0] ?? 'Perda concentrada aqui — compare traçado, marcha e uso dos pedais.')
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
    ? ['Sem regiões de perda relevantes vs referência — boa consistência nesta volta.']
    : ['Selecione uma referência ou uma melhor volta válida para gerar coaching offline.']

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
    `Perda total estimada vs referência: ${lapLoss.totalLossSec.toFixed(3)}s.`,
    topSectors.length > 0
      ? `Maiores perdas por sector: ${topSectors.map(([sector, loss]) => `S${sector} ${loss.toFixed(3)}s`).join(' · ')}.`
      : 'Sem perdas setoriais relevantes acima do limiar.',
    insights.length > 0
      ? `Prioridade: ${insights[0].title.toLowerCase()} em ~${pctLabel(insights[0].atPct)}.`
      : 'Nenhum insight acionável acima do limiar de 30 ms.'
  ]

  return { primaryLapId, referenceLapId: reference, totalLossSec: lapLoss.totalLossSec, insights, summary }
}
