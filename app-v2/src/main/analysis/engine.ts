import type {
  AnalysisLap,
  AnalysisLapDelta,
  AnalysisLapLosses,
  AnalysisLapSample,
  AnalysisOptimal,
  AnalysisOptimalSector,
  AnalysisProfile,
  AnalysisResult,
  LossPointInfo
} from '../../shared/recording'

// ─────────────────────────────────────────────────────────────────────────────
// Engine de análise de laps.
//
// Estratégia geral:
//   1. Cada `AnalysisLap` traz amostras já normalizadas (lapDistPct, speedKmh,
//      throttle, brake, currentLapTimeSec opcional, …) sem importar a origem
//      (.ibt do iRacing ou JSONL do recorder do app).
//   2. Reamostramos cada lap numa grade comum de distância (NUM_BINS) — assim
//      podemos sobrepor laps mesmo com sample rates diferentes e comparar
//      ponto-a-ponto por % da pista perrace.
//   3. Detectamos a "melhor lap" pela menor durationSec entre laps válidas;
//      caso nenhuma lap traga durationSec, usamos a integral de tempo
//      derivada de `currentLapTimeSec` (último menos primeiro) ou da integral
//      de 1/speed nas bins (best-effort).
//   4. Para cada lap, calculamos `cumTimeSec[i]` na grade e em seguida o
//      delta cumulativo vs a melhor (`deltaCum[i]`). O delta por bin
//      (`perBinDelta`) é o que classifica onde a lap perdeu tempo.
//   5. Agrupamos bins adjacentes acima do limiar em "regiões de perda" e
//      geramos dicas comparando brake/throttle/speed vs a melhor.
//   6. Para o profile "optimal lap", dividimos a pista em sectores fixos e
//      pegamos o menor tempo de cada sector entre todas as laps — soma é o
//      "tempo optimal".
//
// Tudo é best-effort: alguns sims/fontes não trazem `currentLapTimeSec`; nesse
// caso o engine cai numa estimativa por integração de speed — útil para
// visualização, mas não substitui um delta real cronometrado.
// ─────────────────────────────────────────────────────────────────────────────

const NUM_BINS = 200
const NUM_SECTORS = 20
const LOSS_BIN_THRESHOLD_SEC = 0.015 // perda por bin para entrar em "região"
const TOP_LOSS_REGIONS = 8
const BRAKE_ONSET_THRESHOLD = 0.18

const LAP_COLORS = [
  '#49C5B1',
  '#FFB900',
  '#B146C2',
  '#00BCF2',
  '#7FBA00',
  '#F7630C',
  '#E81123',
  '#0078D4'
]

export function colorForIndex(index: number): string {
  return LAP_COLORS[index % LAP_COLORS.length]
}

interface ResampledLap {
  lapId: string
  binSpeedKmh: number[]
  binThrottle: number[]
  binBrake: number[]
  binCumTimeSec: number[]
  totalSec: number
  sampleCount: number
}

interface ResolvedLap extends AnalysisLap {}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function safeNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function sortSamplesByDist(samples: AnalysisLapSample[]): AnalysisLapSample[] {
  return [...samples].sort((a, b) => a.lapDistPct - b.lapDistPct)
}

function interpolate(values: number[], dists: number[], targetDist: number): number {
  if (values.length === 0) return 0
  if (targetDist <= dists[0]) return values[0]
  if (targetDist >= dists[dists.length - 1]) return values[values.length - 1]
  let lo = 0
  let hi = dists.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (dists[mid] <= targetDist) lo = mid
    else hi = mid
  }
  const span = dists[hi] - dists[lo]
  if (span <= 0) return values[lo]
  const t = (targetDist - dists[lo]) / span
  return values[lo] + (values[hi] - values[lo]) * t
}

function interpolateOptional(
  values: Array<number | null>,
  dists: number[],
  targetDist: number
): number | null {
  if (values.length === 0) return null
  if (targetDist <= dists[0]) return values[0]
  if (targetDist >= dists[dists.length - 1]) return values[values.length - 1]
  let lo = 0
  let hi = dists.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (dists[mid] <= targetDist) lo = mid
    else hi = mid
  }
  const a = values[lo]
  const b = values[hi]
  if (a === null && b === null) return null
  if (a === null) return b
  if (b === null) return a
  const span = dists[hi] - dists[lo]
  if (span <= 0) return a
  const t = (targetDist - dists[lo]) / span
  return a + (b - a) * t
}

function buildCumTimeFromSpeed(binSpeedKmh: number[], totalSec: number): number[] {
  // Δt em cada bin ∝ 1/speed. Integramos e renormalizamos para totalSec.
  const inv = binSpeedKmh.map((s) => (s > 1 ? 1 / s : 1))
  const total = inv.reduce((acc, v) => acc + v, 0)
  if (total <= 0 || !Number.isFinite(total) || totalSec <= 0) {
    return binSpeedKmh.map((_, i) => (totalSec * (i + 1)) / binSpeedKmh.length)
  }
  const cum: number[] = []
  let acc = 0
  for (const v of inv) {
    acc += v
    cum.push((acc / total) * totalSec)
  }
  return cum
}

function estimateTotalSec(samples: AnalysisLapSample[], fallback?: number): number {
  // O `durationSec` da meta é a janela de lap autoritativa: para gravações ele
  // cobre os cruzamentos reais de largada/chegada, e para `.ibt` é o span de
  // SessionTime da lap. Preferimo-lo para que a escolha da melhor lap seja
  // consistente e não fique enviesada pelo recorte de cabeça/cauda das amostras
  // mantidas. Só caímos no delta de LapCurrentLapTime (que subestima pela fração
  // não amostrada em cada cruzamento de S/F) quando não há duração autoritativa.
  if (typeof fallback === 'number' && Number.isFinite(fallback) && fallback > 0) return fallback
  if (samples.length > 0) {
    const first = samples[0]
    const last = samples[samples.length - 1]
    if (
      first.currentLapTimeSec !== undefined &&
      last.currentLapTimeSec !== undefined &&
      Number.isFinite(first.currentLapTimeSec) &&
      Number.isFinite(last.currentLapTimeSec) &&
      last.currentLapTimeSec > first.currentLapTimeSec
    ) {
      return last.currentLapTimeSec - first.currentLapTimeSec
    }
  }
  if (samples.length === 0) return 0
  // Fallback bem grosseiro: assume speed média e perímetro de pista
  // arbitrário (3.5 km). Só serve para ordenar laps relativamente; consumidores
  // que dependem de tempos absolutos devem fornecer `durationSec` na lap meta.
  const avgSpeed = samples.reduce((acc, s) => acc + s.speedKmh, 0) / samples.length
  if (avgSpeed <= 0) return 0
  return (3500 / 1000) / avgSpeed * 3600
}

function resampleLap(lap: ResolvedLap): ResampledLap | null {
  if (lap.samples.length < 4) return null
  const samples = sortSamplesByDist(lap.samples)
  const dists = samples.map((s) => clamp01(s.lapDistPct))
  const speeds = samples.map((s) => Math.max(0, s.speedKmh))
  const throttles = samples.map((s) => Math.max(0, Math.min(1, s.throttle)))
  const brakes = samples.map((s) => Math.max(0, Math.min(1, s.brake)))
  const cumTimes: Array<number | null> = samples.map((s) =>
    s.currentLapTimeSec !== undefined && Number.isFinite(s.currentLapTimeSec) ? s.currentLapTimeSec : null
  )

  const binSpeedKmh: number[] = []
  const binThrottle: number[] = []
  const binBrake: number[] = []
  const binCumRaw: Array<number | null> = []
  for (let i = 0; i < NUM_BINS; i += 1) {
    const t = (i + 0.5) / NUM_BINS
    binSpeedKmh.push(interpolate(speeds, dists, t))
    binThrottle.push(interpolate(throttles, dists, t))
    binBrake.push(interpolate(brakes, dists, t))
    binCumRaw.push(interpolateOptional(cumTimes, dists, t))
  }

  const totalSec = estimateTotalSec(samples, lap.durationSec)
  const hasReliableCumTime = binCumRaw.every((v) => v !== null)

  let binCumTimeSec: number[]
  if (hasReliableCumTime) {
    binCumTimeSec = binCumRaw as number[]
  } else {
    binCumTimeSec = buildCumTimeFromSpeed(binSpeedKmh, totalSec)
  }

  return {
    lapId: lap.id,
    binSpeedKmh,
    binThrottle,
    binBrake,
    binCumTimeSec,
    totalSec,
    sampleCount: samples.length
  }
}

function pickBest(laps: ResolvedLap[], resampled: Map<string, ResampledLap>): ResolvedLap | null {
  const explicitBest = laps.find((lap) => lap.isBest && resampled.has(lap.id))
  if (explicitBest) return explicitBest

  // Preferimos a janela autoritativa da lap (`durationSec`) para que laps
  // próximas sejam ranqueadas pelos limites de S/F do sim, e não pelo delta de
  // amostras recortado na cabeça/cauda. Caímos no `totalSec` calculado pelo
  // engine quando não há duração dispolevel na meta.
  let best: ResolvedLap | null = null
  let bestSec = Number.POSITIVE_INFINITY
  for (const lap of laps) {
    const r = resampled.get(lap.id)
    if (!r) continue
    const candidate = lap.durationSec || r.totalSec || 0
    if (Number.isFinite(candidate) && candidate > 0 && candidate < bestSec) {
      bestSec = candidate
      best = lap
    }
  }
  return best
}

function brakeOnsetInRange(brake: number[], fromBin: number, toBin: number): number | null {
  // Procuramos o INÍCIO da frenagem em uma janela um pouco antes da região:
  // se o piloto começou a frear (brake > limiar) ainda antes da região, esse
  // bin é o "ponto de freada".
  const lookBack = Math.max(0, fromBin - 12)
  let inBrake = false
  let onset = -1
  for (let i = lookBack; i <= toBin; i += 1) {
    if (!inBrake && brake[i] >= BRAKE_ONSET_THRESHOLD) {
      inBrake = true
      onset = i
    }
    if (inBrake && brake[i] < BRAKE_ONSET_THRESHOLD * 0.5) inBrake = false
  }
  return onset >= 0 ? onset : null
}

function buildTips(point: Omit<LossPointInfo, 'tips'>): string[] {
  const tips: string[] = []
  const speedDelta = point.primaryMaxSpeedKmh - point.bestMaxSpeedKmh
  const minSpeedDelta = point.primaryMinSpeedKmh - point.bestMinSpeedKmh
  const throttleDelta = point.primaryAvgThrottle - point.bestAvgThrottle
  const brakeDelta = point.primaryMaxBrake - point.bestMaxBrake

  // Detecção de "freando cedo": só faz sentido se ambos têm um onset detectado.
  if (
    point.primaryBrakeOnsetPct !== null &&
    point.bestBrakeOnsetPct !== null &&
    point.primaryBrakeOnsetPct < point.bestBrakeOnsetPct - 0.01
  ) {
    const meters = Math.round((point.bestBrakeOnsetPct - point.primaryBrakeOnsetPct) * 1000) / 10
    tips.push(`Braking early (~${meters}% before the best lap)`)
  } else if (
    point.primaryBrakeOnsetPct !== null &&
    point.bestBrakeOnsetPct !== null &&
    point.primaryBrakeOnsetPct > point.bestBrakeOnsetPct + 0.01
  ) {
    tips.push(`Braking late — check brake release and corner entry`)
  }

  if (brakeDelta > 0.15) tips.push(`Freada mais forte (~+${Math.round(brakeDelta * 100)}%) — talvez travando rodas`)
  if (minSpeedDelta < -3) tips.push(`Minimum corner speed ${Math.round(minSpeedDelta)} km/h lower`)
  if (speedDelta < -3) tips.push(`Peak speed ${Math.round(speedDelta)} km/h lower (exit/straight)`)
  if (throttleDelta < -0.08) tips.push(`Average throttle ${Math.round(throttleDelta * 100)}% lower — late to throttle`)

  if (tips.length === 0) {
    tips.push(`Lost ~${(point.lossSec * 1000).toFixed(0)} ms here — compare line/gear`)
  }
  return tips
}

function buildLossPoints(
  lapId: string,
  perBinDelta: number[],
  primary: ResampledLap,
  best: ResampledLap
): { points: LossPointInfo[]; totalLossSec: number } {
  type Region = { start: number; end: number; loss: number }
  const regions: Region[] = []
  let current: Region | null = null
  for (let i = 0; i < perBinDelta.length; i += 1) {
    const v = perBinDelta[i]
    if (v >= LOSS_BIN_THRESHOLD_SEC) {
      if (!current) current = { start: i, end: i, loss: v }
      else {
        current.end = i
        current.loss += v
      }
    } else if (current) {
      regions.push(current)
      current = null
    }
  }
  if (current) regions.push(current)
  // Total loss reflects ALL detected regions, not just the displayed top-N.
  const totalLossSec = regions.reduce((acc, r) => acc + r.loss, 0)
  regions.sort((a, b) => b.loss - a.loss)
  const top = regions.slice(0, TOP_LOSS_REGIONS)
  // Re-ordena por distância para apresentar em ordem na lap
  top.sort((a, b) => a.start - b.start)

  const points: LossPointInfo[] = []
  let cumLoss = 0
  for (const region of top) {
    const fromPct = region.start / NUM_BINS
    const toPct = (region.end + 1) / NUM_BINS
    const primaryWindow = primary.binSpeedKmh.slice(region.start, region.end + 1)
    const bestWindow = best.binSpeedKmh.slice(region.start, region.end + 1)
    const primaryThrottleWin = primary.binThrottle.slice(region.start, region.end + 1)
    const bestThrottleWin = best.binThrottle.slice(region.start, region.end + 1)
    const primaryBrakeWin = primary.binBrake.slice(region.start, region.end + 1)
    const bestBrakeWin = best.binBrake.slice(region.start, region.end + 1)
    const primaryOnsetBin = brakeOnsetInRange(primary.binBrake, region.start, region.end)
    const bestOnsetBin = brakeOnsetInRange(best.binBrake, region.start, region.end)
    cumLoss += region.loss

    const base: Omit<LossPointInfo, 'tips'> = {
      lapId,
      fromPct,
      toPct,
      lossSec: region.loss,
      cumLossSec: cumLoss,
      primaryMaxSpeedKmh: Math.max(...primaryWindow),
      bestMaxSpeedKmh: Math.max(...bestWindow),
      primaryMinSpeedKmh: Math.min(...primaryWindow),
      bestMinSpeedKmh: Math.min(...bestWindow),
      primaryAvgThrottle: primaryThrottleWin.reduce((a, v) => a + v, 0) / primaryThrottleWin.length,
      bestAvgThrottle: bestThrottleWin.reduce((a, v) => a + v, 0) / bestThrottleWin.length,
      primaryMaxBrake: Math.max(...primaryBrakeWin),
      bestMaxBrake: Math.max(...bestBrakeWin),
      primaryBrakeOnsetPct: primaryOnsetBin !== null ? primaryOnsetBin / NUM_BINS : null,
      bestBrakeOnsetPct: bestOnsetBin !== null ? bestOnsetBin / NUM_BINS : null
    }
    points.push({ ...base, tips: buildTips(base) })
  }
  return { points, totalLossSec }
}

function buildOptimal(laps: ResolvedLap[], resampled: Map<string, ResampledLap>): AnalysisOptimal | null {
  const validLaps = laps.filter((l) => resampled.has(l.id))
  if (validLaps.length === 0) return null
  const sectors: AnalysisOptimalSector[] = []
  const binsPerSector = Math.max(1, Math.floor(NUM_BINS / NUM_SECTORS))
  let total = 0
  for (let s = 0; s < NUM_SECTORS; s += 1) {
    const fromBin = s * binsPerSector
    const toBin = s === NUM_SECTORS - 1 ? NUM_BINS - 1 : (s + 1) * binsPerSector - 1
    let bestSec = Number.POSITIVE_INFINITY
    let bestLapId = ''
    for (const lap of validLaps) {
      const r = resampled.get(lap.id)
      if (!r) continue
      const cumTo = r.binCumTimeSec[toBin]
      const cumFrom = fromBin === 0 ? 0 : r.binCumTimeSec[fromBin - 1]
      if (!Number.isFinite(cumTo) || !Number.isFinite(cumFrom)) continue
      const sec = cumTo - cumFrom
      if (sec > 0 && sec < bestSec) {
        bestSec = sec
        bestLapId = lap.id
      }
    }
    if (!Number.isFinite(bestSec) || !bestLapId) continue
    sectors.push({
      fromPct: fromBin / NUM_BINS,
      toPct: (toBin + 1) / NUM_BINS,
      bestLapId,
      bestSec
    })
    total += bestSec
  }
  if (sectors.length === 0) return null
  const bestLap = pickBest(validLaps, resampled)
  const bestLapSec = bestLap ? bestLap.durationSec ?? resampled.get(bestLap.id)?.totalSec ?? 0 : 0
  return {
    totalSec: total,
    bestLapSec,
    gainSec: bestLapSec > 0 ? Math.max(0, bestLapSec - total) : 0,
    sectors
  }
}

export function analyze(
  laps: AnalysisLap[],
  profile: AnalysisProfile,
  options?: { trackKey?: string; trackLabel?: string }
): AnalysisResult {
  const notes: string[] = []
  const valid: ResolvedLap[] = laps.filter((l) => l.samples.length > 0)
  if (valid.length === 0) {
    return {
      profile,
      trackKey: options?.trackKey,
      trackLabel: options?.trackLabel,
      laps,
      bestLapId: null,
      optimal: null,
      deltas: [],
      losses: [],
      notes: ['No lap has enough samples for analysis.']
    }
  }

  const resampled = new Map<string, ResampledLap>()
  for (const lap of valid) {
    const r = resampleLap(lap)
    if (r) resampled.set(lap.id, r)
    else notes.push(`Lap ${lap.label} ignored: insufficient samples (minimum 4).`)
  }

  const bestLap = pickBest(valid, resampled)
  if (!bestLap) {
    return {
      profile,
      trackKey: options?.trackKey,
      trackLabel: options?.trackLabel,
      laps: valid.map((lap) => ({ ...lap, isBest: false })),
      bestLapId: null,
      optimal: null,
      deltas: [],
      losses: [],
      notes: [...notes, 'Could not identify the best lap (no valid times).']
    }
  }
  const bestResampled = resampled.get(bestLap.id)!

  const annotatedLaps: AnalysisLap[] = valid.map((lap) => ({ ...lap, isBest: lap.id === bestLap.id }))

  const deltas: AnalysisLapDelta[] = []
  const losses: AnalysisLapLosses[] = []
  for (const lap of valid) {
    const r = resampled.get(lap.id)
    if (!r) continue
    const binsDelta: AnalysisLapDelta['bins'] = []
    for (let i = 0; i < NUM_BINS; i += 1) {
      // Anchor the displayed cumulative delta at 0 by removing each lap's own
      // bin-0 offset (sub-sample S/F crossing noise), WITHOUT mutating the
      // stored cumulative times used by perBinDelta and buildOptimal.
      const delta = (r.binCumTimeSec[i] - r.binCumTimeSec[0]) - (bestResampled.binCumTimeSec[i] - bestResampled.binCumTimeSec[0])
      binsDelta.push({ distancePct: (i + 0.5) / NUM_BINS, deltaSec: delta })
    }
    deltas.push({ lapId: lap.id, bins: binsDelta })

    if (lap.id !== bestLap.id) {
      const perBinDelta: number[] = []
      for (let i = 0; i < NUM_BINS; i += 1) {
        const cur = r.binCumTimeSec[i]
        const prev = i === 0 ? 0 : r.binCumTimeSec[i - 1]
        const bestCur = bestResampled.binCumTimeSec[i]
        const bestPrev = i === 0 ? 0 : bestResampled.binCumTimeSec[i - 1]
        perBinDelta.push((cur - prev) - (bestCur - bestPrev))
      }
      const { points, totalLossSec: totalLoss } = buildLossPoints(lap.id, perBinDelta, r, bestResampled)
      const summary: string[] = []
      if (points.length === 0) summary.push('No clear loss zones — lap is consistent against the best.')
      else summary.push(`${points.length} loss zones. Total ≈ ${(totalLoss * 1000).toFixed(0)} ms.`)
      losses.push({ lapId: lap.id, totalLossSec: totalLoss, points, summary })
    }
  }

  const optimal = profile === 'optimal' || profile === 'lossMap' ? buildOptimal(valid, resampled) : null
  if (profile === 'optimal' && optimal) {
    notes.push(
      `Optimal: ${optimal.totalSec.toFixed(3)}s · Best lap: ${optimal.bestLapSec.toFixed(3)}s · Possible gain: ${optimal.gainSec.toFixed(3)}s.`
    )
  }
  if (profile === 'compareBest') {
    notes.push(`Comparing ${valid.length - 1} lap(s) against the best.`)
  }
  if (profile === 'lossMap') {
    notes.push('Loss map: red zones show where the lap is slower than the best.')
  }

  // Garante que laps sem amostras suficientes apareçam zeradas no resultado
  const lapsWithoutResample = laps.filter((l) => !resampled.has(l.id))
  for (const lap of lapsWithoutResample) {
    if (!annotatedLaps.some((a) => a.id === lap.id)) {
      annotatedLaps.push({ ...lap, isBest: false })
    }
  }

  return {
    profile,
    trackKey: options?.trackKey,
    trackLabel: options?.trackLabel,
    laps: annotatedLaps,
    bestLapId: bestLap.id,
    optimal,
    deltas,
    losses,
    notes
  }
}

export const ANALYSIS_NUM_BINS = NUM_BINS
export const ANALYSIS_NUM_SECTORS = NUM_SECTORS
