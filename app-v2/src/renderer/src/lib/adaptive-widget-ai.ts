import type { TelemetrySnapshot } from '../../../shared/telemetry'
import type { RaceMomentState } from '../../../shared/race-moment'
import { HIFI_WIDGETS, hifiWidgetTags } from '../hifi/widgets/registry'
import type { HifiAiContext, HifiWidgetModule } from '../hifi/widgets/types'

export interface AdaptiveWidgetAiInput {
  snapshot?: TelemetrySnapshot | null
  ai?: HifiAiContext | null
  moment?: RaceMomentState | string | null
  maxSlots: number
}

interface ScoredWidget {
  id: string
  score: number
  category: string
  index: number
}

const CATEGORY_CAP = 2
const AI_CATEGORY_CAP = 1

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function hasValue(value: unknown): boolean {
  if (value == null) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

function fieldPresent(snapshot: TelemetrySnapshot | null | undefined, field: keyof TelemetrySnapshot): boolean {
  return Boolean(snapshot && hasValue(snapshot[field]))
}

function requiredPresence(module: HifiWidgetModule, snapshot: TelemetrySnapshot | null | undefined): number {
  if (module.requires.length === 0) return 1
  const present = module.requires.filter((field) => fieldPresent(snapshot, field)).length
  return present / module.requires.length
}

function moduleText(module: HifiWidgetModule): string {
  return [module.id, module.title, module.description, module.category, ...hifiWidgetTags(module)].join(' ').toLowerCase()
}

function matches(module: HifiWidgetModule, needles: readonly string[]): boolean {
  const haystack = moduleText(module)
  return needles.some((needle) => haystack.includes(needle))
}

function boost(scores: Map<string, number>, module: HifiWidgetModule, amount: number, needles: readonly string[]): void {
  if (matches(module, needles)) scores.set(module.id, (scores.get(module.id) ?? 0) + amount)
}

function fuelLaps(snapshot: TelemetrySnapshot | null | undefined): number | undefined {
  const fuel = finite(snapshot?.fuelLiters)
  const perLap = finite(snapshot?.fuelPerLap)
  return fuel != null && perLap != null && perLap > 0 ? fuel / perLap : undefined
}

function tyreValues(snapshot: TelemetrySnapshot | null | undefined, picker: (corner: NonNullable<TelemetrySnapshot['tyres']>[keyof NonNullable<TelemetrySnapshot['tyres']>]) => number | undefined): number[] {
  const tyres = snapshot?.tyres
  if (!tyres) return []
  return [tyres.lf, tyres.rf, tyres.lr, tyres.rr].map(picker).filter((v): v is number => v != null && Number.isFinite(v))
}

function cornerValues<T>(corners: { lf: T; rf: T; lr: T; rr: T } | undefined): T[] {
  return corners ? [corners.lf, corners.rf, corners.lr, corners.rr] : []
}

function aiHasContent(ai: HifiAiContext | null | undefined): boolean {
  return Boolean(
    text(ai?.coachTip?.text) ||
      (ai?.coachFindings?.length ?? 0) > 0 ||
      text(ai?.engineerRadio?.text) ||
      text(ai?.proactiveAlert?.text) ||
      text(ai?.strategy?.text) ||
      finite(ai?.confidence) != null
  )
}

function aiSignalText(ai: HifiAiContext | null | undefined): string {
  return [
    ai?.coachTip?.text,
    ...(ai?.coachFindings?.map((f) => f.label) ?? []),
    ai?.engineerRadio?.text,
    ai?.proactiveAlert?.text,
    ai?.strategy?.text
  ]
    .map(text)
    .filter(Boolean)
    .join(' ')
}

function momentId(moment: AdaptiveWidgetAiInput['moment']): string {
  if (!moment) return ''
  return typeof moment === 'string' ? moment : moment.moment
}

function addTelemetrySalience(scores: Map<string, number>, module: HifiWidgetModule, snapshot: TelemetrySnapshot | null | undefined): void {
  const fuelFraction =
    finite(snapshot?.fuelLiters) != null && finite(snapshot?.fuelCapacityLiters) != null && (snapshot?.fuelCapacityLiters ?? 0) > 0
      ? (snapshot?.fuelLiters ?? 0) / (snapshot?.fuelCapacityLiters ?? 1)
      : undefined
  const laps = fuelLaps(snapshot)
  const fuelMargin = laps != null && finite(snapshot?.lapsRemaining) != null ? laps - (snapshot?.lapsRemaining ?? 0) : undefined
  if ((fuelFraction != null && fuelFraction <= 0.18) || (laps != null && laps <= 2.2) || (fuelMargin != null && fuelMargin <= 1)) {
    boost(scores, module, 58, ['fuel', 'strategy', 'pit'])
  }

  const tyreTemps = tyreValues(snapshot, (t) => finite(t?.tempC))
  const tyreWear = tyreValues(snapshot, (t) => finite(t?.wearPct)).map((w) => (w <= 1 ? w * 100 : w))
  const tyrePressure = tyreValues(snapshot, (t) => finite(t?.pressureKpa)).map((kpa) => kpa * 0.1450377377)
  if (
    tyreTemps.some((v) => v < 72 || v > 105) ||
    tyreWear.some((v) => v <= 58) ||
    tyrePressure.some((v) => v < 26.5 || v > 28.8)
  ) {
    boost(scores, module, 48, ['tyre', 'tire', 'pressure', 'wear'])
  }

  const brakeTemps = cornerValues(snapshot?.brakeTempC).map(finite).filter((v): v is number => v != null)
  if (brakeTemps.some((v) => v >= 650)) boost(scores, module, 48, ['brake'])

  const ahead = finite(snapshot?.relatives?.ahead?.gapSec)
  const behind = finite(snapshot?.relatives?.behind?.gapSec)
  const hasRadar = (snapshot?.radarCars?.length ?? 0) > 0 || (snapshot?.carLeftRight != null && snapshot.carLeftRight !== 'clear')
  if ((ahead != null && Math.abs(ahead) <= 0.6) || (behind != null && Math.abs(behind) <= 0.6) || hasRadar) {
    boost(scores, module, 52, ['gap', 'relative', 'radar', 'proximity', 'standings'])
  }
  if (behind != null && Math.abs(behind) <= 0.6) boost(scores, module, 12, ['behind', 'radar', 'relative'])
  if (ahead != null && Math.abs(ahead) <= 0.6) boost(scores, module, 12, ['ahead', 'radar', 'relative'])

  const delta = finite(snapshot?.deltaToBestSec) ?? finite(snapshot?.deltaToSessionBestSec)
  if (delta != null && Math.abs(delta) >= 0.25) boost(scores, module, 42, ['delta', 'lap', 'sector', 'input', 'brake', 'throttle'])

  if ((snapshot?.incidentCount ?? 0) > 0 || (snapshot?.incidentCountMy ?? 0) > 0) boost(scores, module, 40, ['incident', 'flag'])
  if (snapshot?.flags?.yellow || snapshot?.flags?.blue || snapshot?.flags?.white || snapshot?.flags?.red) boost(scores, module, 44, ['flag', 'position', 'gap'])

  if (snapshot?.isRaining || snapshot?.weatherDeclaredWet || (snapshot?.trackWetnessPct ?? 0) > 0.04 || (snapshot?.gripPct ?? 1) < 0.9) {
    boost(scores, module, 44, ['weather', 'wetness', 'grip', 'tyre'])
  }

  if (snapshot?.drs || snapshot?.pushToPass || finite(snapshot?.ersBatteryPct) != null) boost(scores, module, 36, ['ers', 'drs', 'push', 'hybrid'])
  if ((snapshot?.waterTempC ?? 0) >= 105 || (snapshot?.oilTempC ?? 0) >= 125 || snapshot?.engineWarnings) {
    boost(scores, module, 34, ['water', 'oil', 'engine', 'pressure'])
  }
  if (snapshot?.onPitRoad || snapshot?.pitLimiter || snapshot?.pit?.inPitStall) boost(scores, module, 46, ['pit', 'fuel', 'tyre', 'strategy'])
}

function addMomentWeight(scores: Map<string, number>, module: HifiWidgetModule, moment: string): void {
  if (!moment) return
  if (['race-start', 'formation', 'green'].includes(moment)) boost(scores, module, 38, ['input', 'gap', 'relative', 'radar', 'position', 'gear', 'rpm'])
  if (['qualifying', 'qualifying-lap', 'push-now'].includes(moment)) boost(scores, module, 42, ['delta', 'input', 'sector', 'lap', 'brake', 'throttle'])
  if (['out-lap', 'in-lap', 'in-pit', 'pit-window-open', 'pit-approach'].includes(moment)) boost(scores, module, 42, ['fuel', 'tyre', 'tire', 'pit', 'brake', 'strategy'])
  if (['safety-car', 'yellow-sector', 'blue-flag', 'being-lapped', 'incident-recovery'].includes(moment)) boost(scores, module, 44, ['flag', 'position', 'gap', 'relative', 'radar', 'incident'])
  if (['final-laps', 'last-lap'].includes(moment)) boost(scores, module, 40, ['position', 'gap', 'relative', 'radar', 'fuel', 'flag'])
  if (['defending', 'under-pressure'].includes(moment)) boost(scores, module, 42, ['behind', 'relative', 'radar', 'gap', 'position'])
  if (['attacking', 'traffic-ahead', 'overtake-window'].includes(moment)) boost(scores, module, 42, ['ahead', 'relative', 'radar', 'gap', 'delta'])
  if (['fuel-save', 'fuel-critical'].includes(moment)) boost(scores, module, 48, ['fuel', 'strategy', 'pit'])
  if (['tyre-cliff', 'tire-pressure-low', 'tire-optimal-temp'].includes(moment)) boost(scores, module, 44, ['tyre', 'tire', 'pressure', 'wear'])
  if (['braking-zone', 'mid-corner', 'corner-exit'].includes(moment)) boost(scores, module, 34, ['input', 'brake', 'throttle', 'steering', 'delta'])
  if (moment === 'drs') boost(scores, module, 36, ['ers', 'drs', 'push', 'hybrid'])
}

function addAiWeight(scores: Map<string, number>, module: HifiWidgetModule, ai: HifiAiContext | null | undefined): void {
  if (!aiHasContent(ai)) return
  boost(scores, module, 45, ['coach', 'engineer', 'ai', 'strategy', 'alert'])
  const signal = aiSignalText(ai)
  if (/(brak|trail|pedal|abs)/.test(signal)) boost(scores, module, 36, ['brake', 'input', 'delta'])
  if (/(throttle|traction|exit|tc|wheelspin)/.test(signal)) boost(scores, module, 34, ['throttle', 'input', 'tc', 'delta'])
  if (/(line|apex|entry|sector|corner)/.test(signal)) boost(scores, module, 30, ['delta', 'sector', 'lap', 'steering'])
  if (/(fuel|save|consumption|splash)/.test(signal)) boost(scores, module, 42, ['fuel', 'strategy'])
  if (/(tyre|tire|pressure|wear|degradation)/.test(signal)) boost(scores, module, 42, ['tyre', 'tire', 'pressure', 'wear', 'strategy'])
  if (/(strategy|box|pit|undercut|overcut)/.test(signal)) boost(scores, module, 42, ['strategy', 'pit', 'fuel', 'tyre'])
}

export function selectAdaptiveWidgets(input: AdaptiveWidgetAiInput): string[] {
  const maxSlots = Number.isFinite(input.maxSlots) ? Math.max(0, Math.floor(input.maxSlots)) : 0
  if (maxSlots === 0) return []

  const scored = HIFI_WIDGETS.map((module, index): ScoredWidget => {
    const scores = new Map<string, number>([[module.id, 10]])
    const presence = requiredPresence(module, input.snapshot)
    scores.set(module.id, (scores.get(module.id) ?? 0) + presence * 16 - (presence === 0 && module.requires.length > 0 ? 18 : 0))
    if (['drive', 'timing', 'gaps'].includes(module.category)) scores.set(module.id, (scores.get(module.id) ?? 0) + 3)
    addTelemetrySalience(scores, module, input.snapshot)
    addMomentWeight(scores, module, momentId(input.moment))
    addAiWeight(scores, module, input.ai)
    return { id: module.id, score: scores.get(module.id) ?? 0, category: module.category, index }
  }).sort((a, b) => b.score - a.score || a.category.localeCompare(b.category) || a.index - b.index)

  const selected: string[] = []
  const categoryCounts = new Map<string, number>()
  for (const item of scored) {
    const cap = item.category === 'ai' ? AI_CATEGORY_CAP : CATEGORY_CAP
    const count = categoryCounts.get(item.category) ?? 0
    if (count >= cap) continue
    selected.push(item.id)
    categoryCounts.set(item.category, count + 1)
    if (selected.length >= maxSlots) break
  }

  if (aiHasContent(input.ai) && !selected.some((id) => HIFI_WIDGETS.find((w) => w.id === id)?.category === 'ai')) {
    const aiWidget = scored.find((item) => item.category === 'ai')
    if (aiWidget) {
      if (selected.length >= maxSlots) selected.pop()
      selected.push(aiWidget.id)
    }
  }

  return selected
}
