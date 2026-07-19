import type { ActionBinding, ActionDefinition, HidButtonControl } from './actions'
import {
  ALERT_TYPE_DEFAULTS,
  type AlertOutput,
  type AlertRuleConfig,
  type AlertSeverity,
  type AlertsConfig,
  type AlertType
} from './alerts'
import { COACH_CHANNELS, type CoachConfig } from './coach'
import { ENGINEER_CHANNELS, type EngineerButtonBinding, type EngineerConfig } from './engineer-ipc'
import { HAPTICS_EFFECT_IDS, type HapticsConfig, type HapticsEffectId } from './haptics'
import {
  HAPTIC_EVENT_IDS,
  HAPTIC_ZONE_IDS,
  type HapticEventId,
  type HapticsZonalConfig
} from './haptics-zonal'
import {
  OVERLAY_WIDGETS,
  type OverlayTrigger,
  type OverlayWidgetDefinition,
  type OverlayWidgetConfig,
  type OverlaysConfig
} from './overlays'
import { sanitizeRaceProfileSnapshot, type RaceProfile } from './raceprofiles'
import { CALLOUT_CATALOG, type CalloutId, type SpotterConfig } from './spotter'
import type { Spotter3DConfig } from './spotter3d'
import type { SoundsConfig } from './soundshift'

export type ContextDebtSource =
  | 'alert'
  | 'overlay'
  | 'sound'
  | 'spotter'
  | 'spotter3d'
  | 'engineer'
  | 'coach'
  | 'haptics'
  | 'haptics-zonal'
  | 'control'

export type ContextDebtModality = 'visual' | 'audio' | 'haptic' | 'control'
export type ContextDebtDeviceKind = 'audio' | 'serial' | 'display' | 'gamepad'
export type ContextDebtScanStatus = 'success' | 'failed' | 'not-run'
export type ContextDebtBand = 'clear' | 'watch' | 'high' | 'incomplete'
export type ContextDebtIssueKind =
  | 'competing-cue'
  | 'duplicate-route'
  | 'unknown-device'
  | 'control-conflict'
  | 'threshold-exceeded'
  | 'source-missing'
  | 'scan-incomplete'

export type ContextDebtSuggestionKind =
  | 'dedupe-route'
  | 'trim-cue'
  | 'trim-overlays'
  | 'trim-audio'
  | 'trim-haptics'
  | 'repair-device'
  | 'resolve-control'

export type ContextDebtSourceFamily =
  | 'alerts'
  | 'overlays'
  | 'sounds'
  | 'haptics'
  | 'zonalHaptics'
  | 'controls'
  | 'spotter'
  | 'spotter3d'
  | 'engineer'
  | 'coach'

export interface ContextDebtProfileRef {
  key: string
  name: string
  source: 'live' | 'race-profile'
}

export interface ContextDebtDeviceInventory {
  audioOutputIds?: readonly string[]
  serialDeviceIds?: readonly string[]
  displayIds?: readonly (string | number)[]
  gamepadIds?: readonly string[]
  scanStatus?: Partial<Record<ContextDebtDeviceKind, ContextDebtScanStatus>>
}

export interface ContextDebtThresholds {
  maxRoutesPerCue: number
  maxModalitiesPerCue: number
  maxOverlays: number
  maxAudioRoutes: number
  maxHapticRoutes: number
  maxTotalRoutes: number
  warningScore: number
  highScore: number
}

export const DEFAULT_CONTEXT_DEBT_THRESHOLDS: ContextDebtThresholds = {
  maxRoutesPerCue: 2,
  maxModalitiesPerCue: 2,
  maxOverlays: 6,
  maxAudioRoutes: 18,
  maxHapticRoutes: 6,
  maxTotalRoutes: 36,
  warningScore: 4,
  highScore: 10
}

export const CONTEXT_DEBT_THRESHOLD_BOUNDS: Record<
  keyof ContextDebtThresholds,
  { min: number; max: number }
> = {
  maxRoutesPerCue: { min: 1, max: 8 },
  maxModalitiesPerCue: { min: 1, max: 4 },
  maxOverlays: { min: 0, max: 30 },
  maxAudioRoutes: { min: 0, max: 60 },
  maxHapticRoutes: { min: 0, max: 30 },
  maxTotalRoutes: { min: 1, max: 120 },
  warningScore: { min: 1, max: 100 },
  highScore: { min: 2, max: 200 }
}

export const CONTEXT_DEBT_EXPERIMENT = {
  id: 'SP-07',
  evidence: 'N=0',
  allocation: '10% SPEC',
  targetOverlapReductionPct: 40,
  targetCriticalDrops: 0,
  targetAnalysisP95Ms: 50,
  targetDecisionCoveragePct: 95
} as const

export interface ContextDebtAnalysisInput {
  profile: ContextDebtProfileRef
  alerts?: AlertsConfig | null
  overlays?: OverlaysConfig | null
  sounds?: SoundsConfig | null
  haptics?: HapticsConfig | null
  zonalHaptics?: HapticsZonalConfig | null
  bindings?: ActionBinding[] | null
  spotter?: SpotterConfig | null
  spotter3d?: Spotter3DConfig | null
  engineer?: EngineerConfig | null
  coach?: CoachConfig | null
  devices?: ContextDebtDeviceInventory
  sourceAvailability?: Partial<Record<ContextDebtSourceFamily, boolean>>
  thresholds?: Partial<ContextDebtThresholds>
}

export interface ContextDebtRoute {
  id: string
  configurationId: string
  signalId: string
  label: string
  source: ContextDebtSource
  sourceId: string
  modality: ContextDebtModality
  target: string
  settingPath: string
  navigateTo: string
  critical: boolean
  priority: number
  device?: {
    kind: ContextDebtDeviceKind
    id: string
  }
}

export interface ContextDebtIssue {
  id: string
  kind: ContextDebtIssueKind
  severity: 'info' | 'warning' | 'high'
  signalId?: string
  routeIds: string[]
  details: Record<string, string | number>
}

export interface ContextDebtSuggestion {
  id: string
  kind: ContextDebtSuggestionKind
  signalId?: string
  routeIds: string[]
  navigateTo: string
  estimatedRouteReduction: number
  reversible: true
  details: Record<string, string | number>
}

export interface ContextDebtCounts {
  competingCues: number
  alerts: number
  overlays: number
  audio: number
  haptics: number
  controlConflicts: number
  duplicateRoutes: number
  unknownDevices: number
  totalRoutes: number
  criticalRoutes: number
}

export interface ContextDebtMetrics {
  eligibleRoutes: number
  overlapRoutes: number
  overlapRatePct: number
  criticalRoutesProtectedPct: number
  sourceCoveragePct: number
  hardwareScanCoveragePct: number
  debtPoints: number
}

export interface ContextDebtReport {
  profile: ContextDebtProfileRef
  thresholds: ContextDebtThresholds
  routes: ContextDebtRoute[]
  issues: ContextDebtIssue[]
  suggestions: ContextDebtSuggestion[]
  counts: ContextDebtCounts
  metrics: ContextDebtMetrics
  band: ContextDebtBand
  fingerprint: string
  missingSources: ContextDebtSourceFamily[]
  incompleteScans: ContextDebtDeviceKind[]
}

export interface ContextDebtFingerprintInput {
  profileKey: string
  thresholds: ContextDebtThresholds
  routes: ContextDebtRoute[]
  suggestions: ContextDebtSuggestion[]
  missingSources?: ContextDebtSourceFamily[]
  incompleteScans?: ContextDebtDeviceKind[]
}

export interface ContextDebtPreview {
  suggestionIds: string[]
  removedRoutes: ContextDebtRoute[]
  blockedCriticalRoutes: ContextDebtRoute[]
  beforeRouteCount: number
  afterRouteCount: number
  routeReductionPct: number
  beforeOverlapRoutes: number
  afterOverlapRoutes: number
  overlapReductionPct: number
  criticalRoutesBefore: number
  criticalRoutesAfter: number
  criticalDrops: number
  safe: boolean
}

export interface ContextDebtPreviewSelection {
  profileKey: string
  fingerprint: string
  suggestionId: string | null
}

export interface ContextDebtConfigSnapshot {
  alerts?: AlertsConfig | null
  overlays?: OverlaysConfig | null
  sounds?: SoundsConfig | null
  haptics?: HapticsConfig | null
  zonalHaptics?: HapticsZonalConfig | null
  bindings?: ActionBinding[] | null
  spotter?: SpotterConfig | null
  spotter3d?: Spotter3DConfig | null
  engineer?: EngineerConfig | null
  coach?: CoachConfig | null
}

export interface ContextDebtSourceSnapshotMap {
  alerts: AlertsConfig
  overlays: OverlaysConfig
  sounds: SoundsConfig
  haptics: HapticsConfig
  zonalHaptics: HapticsZonalConfig
  controls: ActionBinding[]
  spotter: SpotterConfig
  spotter3d: Spotter3DConfig
  engineer: EngineerConfig
  coach: CoachConfig
}

const EXPECTED_SOURCES: readonly ContextDebtSourceFamily[] = [
  'alerts',
  'overlays',
  'sounds',
  'haptics',
  'zonalHaptics',
  'controls',
  'spotter',
  'spotter3d',
  'engineer',
  'coach'
]

const CONTEXT_DEBT_DEVICE_KINDS: readonly ContextDebtDeviceKind[] = [
  'audio',
  'serial',
  'display',
  'gamepad'
]

const ALERT_RULES: ReadonlyArray<{
  key: keyof AlertsConfig
  type: AlertType
  signalId: string
  label: string
}> = [
  { key: 'pitLimiter', type: 'pitLimiter', signalId: 'pit-limiter', label: 'Pit limiter' },
  { key: 'flags', type: 'flag', signalId: 'flags', label: 'Flags' },
  { key: 'lowFuel', type: 'lowFuel', signalId: 'fuel', label: 'Low fuel' },
  { key: 'shiftPoint', type: 'shiftPoint', signalId: 'shift', label: 'Shift point' },
  { key: 'incidentLimit', type: 'incidentLimit', signalId: 'incident-limit', label: 'Incident limit' },
  { key: 'tyrePressure', type: 'tyrePressure', signalId: 'tyre-pressure', label: 'Tyre pressure' },
  { key: 'tyreTemp', type: 'tyreTemp', signalId: 'tyre-temperature', label: 'Tyre temperature' },
  { key: 'brakeTemp', type: 'brakeTemp', signalId: 'brake-temperature', label: 'Brake temperature' },
  { key: 'drsAvailable', type: 'drsAvailable', signalId: 'drs', label: 'DRS available' },
  { key: 'blueFlag', type: 'blueFlag', signalId: 'blue-flag', label: 'Blue flag' }
]

const OVERLAY_DEFINITION_BY_ID = new Map(OVERLAY_WIDGETS.map((definition) => [definition.id, definition]))

const OVERLAY_SIGNAL_BY_EXACT_METADATA = new Map<string, string>([
  ['fuel', 'fuel'],
  ['stint', 'fuel'],
  ['flag', 'flags'],
  ['flags', 'flags'],
  ['race-control', 'flags'],
  ['shift', 'shift'],
  ['rev', 'shift'],
  ['revs', 'shift'],
  ['revlights', 'shift'],
  ['rpm', 'shift'],
  ['gear', 'shift'],
  ['sessionbanner', 'flags'],
  ['pacerestart', 'flags'],
  ['proximity', 'proximity'],
  ['radar', 'proximity'],
  ['relative', 'proximity'],
  ['traffic', 'proximity'],
  ['sidecar', 'proximity'],
  ['sideproximity', 'proximity'],
  ['tyre-pressure', 'tyre-pressure'],
  ['tire-pressure', 'tyre-pressure'],
  ['tyrepressure', 'tyre-pressure'],
  ['tirepressure', 'tyre-pressure'],
  ['coldpressure', 'tyre-pressure'],
  ['tyre', 'tyres'],
  ['tire', 'tyres'],
  ['tyres', 'tyres'],
  ['tires', 'tyres'],
  ['brake-temperature', 'brake-temperature'],
  ['brake-temp', 'brake-temperature'],
  ['brake-heat', 'brake-temperature'],
  ['braketemp', 'brake-temperature'],
  ['brakeheat', 'brake-temperature'],
  ['abs', 'abs'],
  ['tc', 'traction-control'],
  ['traction-control', 'traction-control'],
  ['tractioncontrol', 'traction-control'],
  ['engine', 'engine'],
  ['weather', 'weather'],
  ['wet', 'weather'],
  ['rain', 'weather'],
  ['surface', 'weather']
])

const OVERLAY_SIGNAL_BY_EXACT_ID = new Map<string, string>([
  ['revlights', 'shift'],
  ['sessionbanner', 'flags'],
  ['pacerestart', 'flags'],
  ['sideproximity', 'proximity'],
  ['percornertyrepressure', 'tyre-pressure'],
  ['braketempcorners', 'brake-temperature'],
  ['fueldeltatile', 'fuel'],
  ['shiftpointbar', 'shift'],
  ['enginevitalsdial', 'engine'],
  ['predpaceprojected', 'pace']
])

const CRITICAL_SIGNAL_IDS = new Set([
  'flags',
  'blue-flag',
  'fuel',
  'incident-limit',
  'proximity',
  'pit-speeding',
  'pit-limiter',
  'engine-warning',
  'water-temperature-critical',
  'oil-temperature-critical',
  'oil-pressure-low',
  'bad-surface',
  'tyre-temperature-critical',
  'brake-pressure-low'
])

function isSemanticCriticalSignal(signalId: string): boolean {
  return CRITICAL_SIGNAL_IDS.has(signalId)
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  const candidate = Number.isFinite(numeric) ? Math.round(numeric) : fallback
  return Math.max(min, Math.min(max, candidate))
}

export function mergeContextDebtThresholds(
  patch: Partial<ContextDebtThresholds> | undefined
): ContextDebtThresholds {
  const base = DEFAULT_CONTEXT_DEBT_THRESHOLDS
  const bounds = CONTEXT_DEBT_THRESHOLD_BOUNDS
  const warningScore = clampInteger(
    patch?.warningScore,
    bounds.warningScore.min,
    bounds.warningScore.max,
    base.warningScore
  )
  return {
    maxRoutesPerCue: clampInteger(
      patch?.maxRoutesPerCue,
      bounds.maxRoutesPerCue.min,
      bounds.maxRoutesPerCue.max,
      base.maxRoutesPerCue
    ),
    maxModalitiesPerCue: clampInteger(
      patch?.maxModalitiesPerCue,
      bounds.maxModalitiesPerCue.min,
      bounds.maxModalitiesPerCue.max,
      base.maxModalitiesPerCue
    ),
    maxOverlays: clampInteger(
      patch?.maxOverlays,
      bounds.maxOverlays.min,
      bounds.maxOverlays.max,
      base.maxOverlays
    ),
    maxAudioRoutes: clampInteger(
      patch?.maxAudioRoutes,
      bounds.maxAudioRoutes.min,
      bounds.maxAudioRoutes.max,
      base.maxAudioRoutes
    ),
    maxHapticRoutes: clampInteger(
      patch?.maxHapticRoutes,
      bounds.maxHapticRoutes.min,
      bounds.maxHapticRoutes.max,
      base.maxHapticRoutes
    ),
    maxTotalRoutes: clampInteger(
      patch?.maxTotalRoutes,
      bounds.maxTotalRoutes.min,
      bounds.maxTotalRoutes.max,
      base.maxTotalRoutes
    ),
    warningScore,
    highScore: clampInteger(
      patch?.highScore,
      Math.max(bounds.highScore.min, warningScore + 1),
      bounds.highScore.max,
      base.highScore
    )
  }
}

export function updateContextDebtThreshold(
  current: ContextDebtThresholds,
  key: keyof ContextDebtThresholds,
  value: number
): ContextDebtThresholds {
  return mergeContextDebtThresholds({ ...current, [key]: value })
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown'
}

function routeId(...parts: Array<string | number>): string {
  return parts.map((part) => slug(String(part))).join(':')
}

function alertSeverity(type: AlertType, rule: AlertRuleConfig): AlertSeverity {
  return rule.severity ?? ALERT_TYPE_DEFAULTS[type].severity
}

function asAlertRule(value: unknown): AlertRuleConfig | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<AlertRuleConfig>
  return typeof candidate.enabled === 'boolean' ? candidate as AlertRuleConfig : null
}

function outputTarget(output: AlertOutput): {
  modality: ContextDebtModality
  target: string
  device?: ContextDebtRoute['device']
} {
  switch (output.kind) {
    case 'buttonbox':
      return {
        modality: 'visual',
        target: `buttonbox:${output.preset}`,
        device: { kind: 'serial', id: 'primary' }
      }
    case 'serial': {
      const id = output.deviceId?.trim() || 'primary'
      return {
        modality: 'visual',
        target: `serial:${id}:${output.template.trim()}`,
        device: { kind: 'serial', id }
      }
    }
    case 'secondScreen':
      return { modality: 'visual', target: `second-screen:${output.slot.trim() || 'default'}` }
    case 'sound':
      return { modality: 'audio', target: 'alerts-audio' }
  }
}

function addAlertRoutes(input: AlertsConfig, routes: ContextDebtRoute[]): number {
  let enabledRules = 0

  for (const meta of ALERT_RULES) {
    const rule = asAlertRule(input[meta.key])
    if (!rule?.enabled) continue
    enabledRules += 1
    const severity = alertSeverity(meta.type, rule)
    const critical = severity === 'critical' || isSemanticCriticalSignal(meta.signalId)
    const priority = severity === 'critical' ? 100 : severity === 'warning' ? 75 : 45
    const configurationId = `alert:${String(meta.key)}`

    routes.push({
      id: routeId(configurationId, 'feed'),
      configurationId,
      signalId: meta.signalId,
      label: `${meta.label} · feed`,
      source: 'alert',
      sourceId: String(meta.key),
      modality: 'visual',
      target: 'alerts-feed',
      settingPath: `alerts.${String(meta.key)}.enabled`,
      navigateTo: 'alerts',
      critical,
      priority
    })

    const outputs = (rule.outputs ?? [])
      .map((output, index) => ({ output, index }))
      .filter(({ output }) => output.enabled !== false)
    const soundOutputs = outputs.filter(({ output }) => output.kind === 'sound')
    if (input.audioEnabled) {
      if (soundOutputs.length === 0) {
        routes.push({
          id: routeId(configurationId, 'default-audio'),
          configurationId,
          signalId: meta.signalId,
          label: `${meta.label} · alert tone`,
          source: 'alert',
          sourceId: String(meta.key),
          modality: 'audio',
          target: 'alerts-audio',
          settingPath: 'alerts.audioEnabled',
          navigateTo: 'alerts',
          critical,
          priority
        })
      } else {
        soundOutputs.forEach(({ index }, ordinal) => {
          routes.push({
            id: routeId(configurationId, 'sound', index),
            configurationId,
            signalId: meta.signalId,
            label: `${meta.label} · custom tone ${ordinal + 1}`,
            source: 'alert',
            sourceId: String(meta.key),
            modality: 'audio',
            target: 'alerts-audio',
            settingPath: `alerts.${String(meta.key)}.outputs.${index}`,
            navigateTo: 'alerts',
            critical,
            priority
          })
        })
      }
    }

    outputs
      .filter(({ output }) => output.kind !== 'sound')
      .forEach(({ output, index }) => {
        const target = outputTarget(output)
        routes.push({
          id: routeId(configurationId, output.kind, index),
          configurationId,
          signalId: meta.signalId,
          label: `${meta.label} · ${output.kind}`,
          source: 'alert',
          sourceId: String(meta.key),
          modality: target.modality,
          target: target.target,
          settingPath: `alerts.${String(meta.key)}.outputs.${index}`,
          navigateTo: 'alerts',
          critical,
          priority,
          ...(target.device ? { device: target.device } : {})
        })
      })
  }

  return enabledRules
}

function signalFromOverlayTrigger(trigger: OverlayTrigger | null | undefined): string | null {
  if (!trigger) return null
  if (trigger.kind === 'semantic') {
    switch (trigger.semantic) {
      case 'paceFlags':
      case 'raceControlFlags':
      case 'paceMode':
      case 'paceFormation':
        return 'flags'
      case 'pitFuelToAdd':
        return 'fuel'
      case 'sideProximity':
        return 'proximity'
      case 'drs':
        return 'drs'
      case 'engineWarnings':
      case 'alert2EngineWarning':
        return 'engine-warning'
      case 'absActive':
      case 'absCut':
        return 'abs'
      case 'tcActive':
        return 'traction-control'
      case 'pitLimiter':
        return 'pit-limiter'
      case 'alert2BlueFlag':
        return 'blue-flag'
      case 'alert2WaterTempCritical':
        return 'water-temperature-critical'
      case 'alert2OilTempCritical':
        return 'oil-temperature-critical'
      case 'alert2OilPressureLow':
        return 'oil-pressure-low'
      case 'alert2BadSurface':
        return 'bad-surface'
      case 'alert2TyreTempCritical':
        return 'tyre-temperature-critical'
      case 'alert2BrakePressureLow':
        return 'brake-pressure-low'
      case 'incidentCounts':
        return 'incident-limit'
      case 'onPitRoad':
      case 'inPitStall':
      case 'pitStopActive':
      case 'pitServiceStatus':
      case 'pitServicesSelected':
      case 'pitsOpen':
        return 'pit'
      case 'precipitation':
      case 'trackWetness':
      case 'declaredWet':
        return 'weather'
      default:
        return trigger.semantic ?? null
    }
  }

  switch (trigger.kind) {
    case 'flag':
      return 'flags'
    case 'lowFuel':
      return 'fuel'
    case 'shiftPoint':
      return 'shift'
    case 'pitLimiter':
      return 'pit-limiter'
    case 'carLeft':
    case 'carRight':
    case 'carLeftOrRight':
    case 'proximity':
      return 'proximity'
    default:
      return null
  }
}

function overlayClassificationTokens(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function signalFromOverlayId(
  id: string,
  definition?: Pick<OverlayWidgetDefinition, 'category' | 'tags'>
): string {
  const metadata = [definition?.category, ...(definition?.tags ?? [])]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  for (const value of metadata) {
    const signal = OVERLAY_SIGNAL_BY_EXACT_METADATA.get(slug(value))
    if (signal) return signal
  }

  const normalizedId = id.trim().toLowerCase()
  const exactIdSignal = OVERLAY_SIGNAL_BY_EXACT_ID.get(normalizedId)
  if (exactIdSignal) return exactIdSignal

  const tokens = new Set([id, ...metadata].flatMap(overlayClassificationTokens))
  const has = (...values: string[]): boolean => values.some((value) => tokens.has(value))
  if (has('tyre', 'tire') && has('pressure')) return 'tyre-pressure'
  if (has('coldpressure', 'tyrepressure', 'tirepressure')) return 'tyre-pressure'
  if (has('brake') && has('temp', 'temperature', 'heat')) return 'brake-temperature'
  if (has('braketemp', 'brakeheat')) return 'brake-temperature'
  if (has('traction') && has('control')) return 'traction-control'
  if (has('tractioncontrol')) return 'traction-control'

  for (const token of tokens) {
    const signal = OVERLAY_SIGNAL_BY_EXACT_METADATA.get(token)
    if (signal) return signal
  }
  if (definition?.category) return slug(definition.category)
  return `overlay-${slug(id)}`
}

function overlayRoute(
  id: string,
  label: string,
  config: Pick<OverlayWidgetConfig, 'role' | 'trigger' | 'display' | 'favorite'>,
  definition?: Pick<OverlayWidgetDefinition, 'category' | 'tags'>
): ContextDebtRoute {
  const triggerSignal = signalFromOverlayTrigger(config.trigger)
  const signalId = triggerSignal ?? signalFromOverlayId(id, definition)
  const displayId = config.display?.id
  const critical = config.role === 'alert' || isSemanticCriticalSignal(signalId)
  return {
    id: routeId('overlay', id),
    configurationId: `overlay:${id}`,
    signalId,
    label,
    source: 'overlay',
    sourceId: id,
    modality: 'visual',
    target: displayId == null ? 'display:default' : `display:${displayId}`,
    settingPath: `overlays.${id}.enabled`,
    navigateTo: 'overlays',
    critical,
    priority: critical ? 90 : config.favorite ? 55 : 30,
    ...(displayId == null ? {} : { device: { kind: 'display' as const, id: String(displayId) } })
  }
}

function addOverlayRoutes(input: OverlaysConfig, routes: ContextDebtRoute[]): number {
  let count = 0
  for (const config of Object.values(input.widgets)) {
    if (!config?.enabled) continue
    count += 1
    const definition = OVERLAY_DEFINITION_BY_ID.get(config.id)
    routes.push(overlayRoute(config.id, definition?.title ?? config.id, config, definition))
  }

  for (const custom of input.customOverlays ?? []) {
    if (!custom?.enabled) continue
    count += 1
    routes.push(overlayRoute(custom.id, custom.title || custom.id, custom, undefined))
  }
  return count
}

function addAudioRoute(
  routes: ContextDebtRoute[],
  route: Omit<ContextDebtRoute, 'modality'>
): void {
  routes.push({ ...route, modality: 'audio' })
}

function addSoundRoutes(input: SoundsConfig, routes: ContextDebtRoute[]): void {
  const outputId = input.outputDeviceId?.trim() || 'default'
  const device = outputId === 'default' ? undefined : { kind: 'audio' as const, id: outputId }
  const entries: Array<{
    id: keyof Pick<SoundsConfig, 'soundshift' | 'incident' | 'abs' | 'tcs'>
    signalId: string
    label: string
  }> = [
    { id: 'soundshift', signalId: 'shift', label: 'Soundshift' },
    { id: 'incident', signalId: 'incident', label: 'Incident sound' },
    { id: 'abs', signalId: 'abs', label: 'ABS sound' },
    { id: 'tcs', signalId: 'traction-control', label: 'TCS sound' }
  ]

  for (const entry of entries) {
    const config = input[entry.id]
    if (!config?.enabled) continue
    addAudioRoute(routes, {
      id: routeId('sound', entry.id),
      configurationId: `sound:${entry.id}`,
      signalId: entry.signalId,
      label: entry.label,
      source: 'sound',
      sourceId: entry.id,
      target: `audio:${outputId}`,
      settingPath: `sounds.${entry.id}.enabled`,
      navigateTo: 'sounds',
      critical: false,
      priority: entry.id === 'incident' ? 55 : 35,
      ...(device ? { device } : {})
    })
  }
}

function signalFromSpotterCallout(id: CalloutId): string {
  if (id.startsWith('flag.')) return id === 'flag.blue' ? 'blue-flag' : 'flags'
  if (id.startsWith('fuel.')) return 'fuel'
  if (id === 'pit.speeding') return 'pit-speeding'
  if (id.startsWith('pit.')) return 'pit'
  if (id === 'proximity.spotter') return 'proximity'
  if (id.startsWith('gap.')) return 'proximity'
  if (id.startsWith('incident.')) return 'incident-limit'
  if (id === 'shift.point') return 'shift'
  if (id.startsWith('lap.')) return 'lap'
  return id.replace('.', '-')
}

function addSpotterRoutes(input: SpotterConfig, routes: ContextDebtRoute[]): void {
  if (!input.enabled || input.muted || input.masterVolume <= 0) return
  const outputId = input.outputDeviceId?.trim() || 'default'
  const device = outputId === 'default' ? undefined : { kind: 'audio' as const, id: outputId }
  for (const meta of CALLOUT_CATALOG) {
    const config = input.callouts[meta.id]
    if (!config?.enabled || config.volume <= 0) continue
    const signalId = signalFromSpotterCallout(meta.id)
    const critical = isSemanticCriticalSignal(signalId)
    addAudioRoute(routes, {
      id: routeId('spotter', meta.id),
      configurationId: `spotter:${meta.id}`,
      signalId,
      label: `Voice spotter · ${meta.label}`,
      source: 'spotter',
      sourceId: meta.id,
      target: `audio:${outputId}`,
      settingPath: `spotter.callouts.${meta.id}.enabled`,
      navigateTo: 'engineer',
      critical,
      priority: 40 + config.priority,
      ...(device ? { device } : {})
    })
  }
}

function addSpotter3dRoutes(input: Spotter3DConfig, routes: ContextDebtRoute[]): void {
  if (!input.enabled || input.masterVolume <= 0) return
  addAudioRoute(routes, {
    id: routeId('spotter3d', 'proximity'),
    configurationId: 'spotter3d:proximity',
    signalId: 'proximity',
    label: '3D proximity spotter',
    source: 'spotter3d',
    sourceId: 'proximity',
    target: 'audio:default',
    settingPath: 'spotter3d.enabled',
    navigateTo: 'spotter-3d',
    critical: true,
    priority: 98
  })
}

function addCoachAndEngineerRoutes(
  coach: CoachConfig | null | undefined,
  engineer: EngineerConfig | null | undefined,
  routes: ContextDebtRoute[]
): void {
  if (engineer?.enabled && engineer.proactiveCoaching) {
    addAudioRoute(routes, {
      id: routeId('engineer', 'proactive'),
      configurationId: 'engineer:proactive',
      signalId: 'coaching',
      label: 'AI Engineer · proactive coaching',
      source: 'engineer',
      sourceId: ENGINEER_CHANNELS.proactive,
      target: 'audio:default',
      settingPath: 'engineer.proactiveCoaching',
      navigateTo: 'engineer',
      critical: false,
      priority: 28
    })
  }

  if (coach?.enabled && coach.speakTopTip) {
    addAudioRoute(routes, {
      id: routeId('coach', 'top-tip'),
      configurationId: 'coach:top-tip',
      signalId: 'coaching',
      label: 'Live Coach · top tip',
      source: 'coach',
      sourceId: COACH_CHANNELS.speak,
      target: 'audio:default',
      settingPath: 'coach.speakTopTip',
      navigateTo: 'coach',
      critical: false,
      priority: 26
    })
  }
}

function signalFromHapticsEffect(id: HapticsEffectId | HapticEventId): string {
  switch (id) {
    case 'gearShift':
    case 'gearGrind':
    case 'gearshift':
    case 'redline':
      return 'shift'
    case 'abs':
    case 'lockup':
    case 'wheelLock':
      return 'abs'
    case 'tcCut':
    case 'wheelspin':
      return 'traction-control'
    case 'kerb':
    case 'roadTexture':
    case 'suspension':
      return 'surface'
    case 'impact':
    case 'contact':
      return 'impact'
    case 'engine':
      return 'engine'
  }
}

function addHapticsRoutes(input: HapticsConfig, routes: ContextDebtRoute[]): number {
  if (!input.enabled || input.muted || input.masterGain <= 0) return 0
  let count = 0
  const outputId = input.outputDeviceId?.trim() || 'default'
  const audioDevice = outputId === 'default' ? undefined : { kind: 'audio' as const, id: outputId }
  for (const id of HAPTICS_EFFECT_IDS) {
    const config = input.effects[id]
    if (!config?.enabled || config.intensity <= 0) continue
    count += 1
    const configurationId = `haptics:${id}`
    routes.push({
      id: routeId(configurationId, 'shaker'),
      configurationId,
      signalId: signalFromHapticsEffect(id),
      label: `Haptics · ${id}`,
      source: 'haptics',
      sourceId: id,
      modality: 'haptic',
      target: `haptics-audio:${outputId}`,
      settingPath: `haptics.effects.${id}.enabled`,
      navigateTo: 'haptics',
      critical: false,
      priority: id === 'impact' || id === 'abs' ? 58 : 32,
      ...(audioDevice ? { device: audioDevice } : {})
    })

    if (input.arduino.enabled && config.arduino) {
      const serialId = input.arduino.deviceId?.trim() || 'unknown'
      routes.push({
        id: routeId(configurationId, 'arduino'),
        configurationId,
        signalId: signalFromHapticsEffect(id),
        label: `Haptics · ${id} · Arduino`,
        source: 'haptics',
        sourceId: id,
        modality: 'haptic',
        target: `haptics-serial:${serialId}`,
        settingPath: `haptics.effects.${id}.arduino`,
        navigateTo: 'haptics',
        critical: false,
        priority: 30,
        device: { kind: 'serial', id: serialId }
      })
    }
  }
  return count
}

function addZonalHapticsRoutes(input: HapticsZonalConfig, routes: ContextDebtRoute[]): number {
  if (!input.enabled || input.muted || input.masterGain <= 0) return 0
  let count = 0
  for (const id of HAPTIC_EVENT_IDS) {
    const config = input.events[id]
    if (!config?.enabled || config.gain <= 0) continue
    const activeZones = HAPTIC_ZONE_IDS.filter(
      (zoneId) => input.zones[zoneId]?.enabled && input.zones[zoneId].gain > 0 && config.zones[zoneId] > 0
    )
    if (activeZones.length === 0) continue
    count += 1
    const configurationId = `haptics-zonal:${id}`
    routes.push({
      id: routeId(configurationId, 'zones'),
      configurationId,
      signalId: signalFromHapticsEffect(id),
      label: `Zonal haptics · ${id}`,
      source: 'haptics-zonal',
      sourceId: id,
      modality: 'haptic',
      target: `haptics-zones:${activeZones.join('+')}`,
      settingPath: `hapticsZonal.events.${id}.enabled`,
      navigateTo: 'haptics-zonal',
      critical: false,
      priority: id === 'contact' || id === 'lockup' ? 56 : 34
    })

    if (input.arduino.enabled) {
      const serialId = input.arduino.deviceId?.trim() || 'unknown'
      routes.push({
        id: routeId(configurationId, 'arduino'),
        configurationId,
        signalId: signalFromHapticsEffect(id),
        label: `Zonal haptics · ${id} · Arduino`,
        source: 'haptics-zonal',
        sourceId: id,
        modality: 'haptic',
        target: `haptics-zonal-serial:${serialId}`,
        settingPath: 'hapticsZonal.arduino.enabled',
        navigateTo: 'haptics-zonal',
        critical: false,
        priority: 30,
        device: { kind: 'serial', id: serialId }
      })
    }
  }
  return count
}

function controlKey(control: Pick<HidButtonControl, 'gamepadId' | 'gamepadIndex' | 'buttonIndex'>): string {
  const gamepadId = control.gamepadId?.trim() || 'any'
  const gamepadIndex = control.gamepadIndex ?? 'any'
  return `gamepad:id:${gamepadId}:index:${gamepadIndex}:button:${control.buttonIndex}`
}

function actionKey(action: ActionDefinition): string {
  switch (action.type) {
    case 'keyboard':
      return `keyboard:${action.command.mode}:${action.command.keys.map((key) => key.trim().toLowerCase()).join('+')}`
    case 'gamepad':
      return `virtual-gamepad:${action.command.mode}:${String(action.command.button)}:${action.command.value ?? 1}`
    case 'iracing':
      return `iracing:${action.command.name}:${action.command.fuelLiters ?? ''}`
    case 'app':
      return `app:${action.command.name}:${action.command.pageIndex ?? action.command.overlayId ?? ''}`
  }
}

function engineerControlKey(binding: EngineerButtonBinding): string {
  return controlKey({
    gamepadId: binding.gamepadId,
    gamepadIndex: binding.gamepadIndex,
    buttonIndex: binding.buttonIndex
  })
}

interface ControlRouteRef {
  controlKey: string
  actionKey: string
  route: ContextDebtRoute
}

function addControlRoutes(
  bindings: ActionBinding[],
  engineer: EngineerConfig | null | undefined,
  routes: ContextDebtRoute[]
): ControlRouteRef[] {
  const refs: ControlRouteRef[] = []

  for (const binding of bindings) {
    if (!binding?.enabled) continue
    const sourceKey = controlKey(binding.control)
    const targetKey = actionKey(binding.action)
    const configurationId = `control:${sourceKey}:${targetKey}`
    const gamepadId = binding.control.gamepadId?.trim()
    const route: ContextDebtRoute = {
      id: routeId('control', binding.id),
      configurationId,
      signalId: `control-${slug(sourceKey)}`,
      label: binding.label || targetKey,
      source: 'control',
      sourceId: binding.id,
      modality: 'control',
      target: targetKey,
      settingPath: `actions.bindings.${binding.id}`,
      navigateTo: 'controls',
      critical: false,
      priority: 40,
      ...(gamepadId ? { device: { kind: 'gamepad' as const, id: gamepadId } } : {})
    }
    routes.push(route)
    refs.push({ controlKey: sourceKey, actionKey: targetKey, route })
  }

  if (engineer?.enabled) {
    const addEngineerBinding = (id: string, label: string, binding: EngineerButtonBinding | null | undefined): void => {
      if (!binding) return
      const sourceKey = engineerControlKey(binding)
      const targetKey = `engineer:${id}`
      const configurationId = `control:${sourceKey}:${targetKey}`
      const gamepadId = binding.gamepadId?.trim()
      const route: ContextDebtRoute = {
        id: routeId('engineer-control', id),
        configurationId,
        signalId: `control-${slug(sourceKey)}`,
        label,
        source: 'control',
        sourceId: id,
        modality: 'control',
        target: targetKey,
        settingPath: `engineer.buttonBindings.${id}`,
        navigateTo: 'engineer',
        critical: false,
        priority: 42,
        ...(gamepadId ? { device: { kind: 'gamepad' as const, id: gamepadId } } : {})
      }
      routes.push(route)
      refs.push({ controlKey: sourceKey, actionKey: targetKey, route })
    }

    addEngineerBinding('push-to-talk', 'Engineer push-to-talk', engineer.buttonBindings.pushToTalk)
    for (const preset of engineer.presetQuestions) {
      addEngineerBinding(`preset-${preset.id}`, `Engineer preset · ${preset.label}`, engineer.buttonBindings.presets[preset.id])
    }
  }

  return refs
}

function sourceAvailable(input: ContextDebtAnalysisInput, source: ContextDebtSourceFamily): boolean {
  const override = input.sourceAvailability?.[source]
  if (typeof override === 'boolean') return override
  switch (source) {
    case 'alerts':
      return input.alerts != null
    case 'overlays':
      return input.overlays != null
    case 'sounds':
      return input.sounds != null
    case 'haptics':
      return input.haptics != null
    case 'zonalHaptics':
      return input.zonalHaptics != null
    case 'controls':
      return input.bindings != null
    case 'spotter':
      return input.spotter != null
    case 'spotter3d':
      return input.spotter3d != null
    case 'engineer':
      return input.engineer != null
    case 'coach':
      return input.coach != null
  }
}

function duplicateKey(route: ContextDebtRoute): string {
  return [
    route.configurationId,
    route.modality,
    route.target,
    route.device?.kind ?? '',
    route.device?.id ?? ''
  ].join('|')
}

function groupBy<T>(values: readonly T[], keyOf: (value: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>()
  for (const value of values) {
    const key = keyOf(value)
    const current = result.get(key)
    if (current) current.push(value)
    else result.set(key, [value])
  }
  return result
}

function scanComplete(inventory: ContextDebtDeviceInventory | undefined, kind: ContextDebtDeviceKind): boolean {
  return inventory?.scanStatus?.[kind] === 'success'
}

function deviceIds(inventory: ContextDebtDeviceInventory | undefined, kind: ContextDebtDeviceKind): Set<string> {
  if (!inventory) return new Set()
  if (kind === 'audio') return new Set((inventory.audioOutputIds ?? []).map(String))
  if (kind === 'serial') return new Set((inventory.serialDeviceIds ?? []).map(String))
  if (kind === 'display') return new Set((inventory.displayIds ?? []).map(String))
  return new Set((inventory.gamepadIds ?? []).map(String))
}

function deviceIsImplicitlyKnown(kind: ContextDebtDeviceKind, id: string): boolean {
  const normalized = id.trim().toLowerCase()
  if (kind === 'audio') return normalized === '' || normalized === 'default' || normalized === 'system-default'
  if (kind === 'serial') return normalized === ''
  return false
}

function routePrioritySort(a: ContextDebtRoute, b: ContextDebtRoute): number {
  return Number(b.critical) - Number(a.critical) || b.priority - a.priority || a.id.localeCompare(b.id)
}

function routesToRemoveForCue(routes: ContextDebtRoute[], thresholds: ContextDebtThresholds): ContextDebtRoute[] {
  const sorted = [...routes].sort(routePrioritySort)
  const keep: ContextDebtRoute[] = []
  const modalities = new Set<ContextDebtModality>()

  for (const route of sorted) {
    if (keep.length >= thresholds.maxRoutesPerCue) break
    if (modalities.size < thresholds.maxModalitiesPerCue && !modalities.has(route.modality)) {
      keep.push(route)
      modalities.add(route.modality)
    }
  }
  for (const route of sorted) {
    if (keep.length >= thresholds.maxRoutesPerCue) break
    if (!keep.includes(route) && modalities.has(route.modality)) keep.push(route)
  }
  const keepIds = new Set(keep.map((route) => route.id))
  return sorted.filter((route) => !keepIds.has(route.id))
}

function addRouteSuggestionsByOwner(
  suggestions: ContextDebtSuggestion[],
  base: {
    id: string
    kind: ContextDebtSuggestionKind
    signalId?: string
    routes: ContextDebtRoute[]
    details: Record<string, string | number>
  }
): void {
  const groups = [...groupBy(base.routes, (route) => route.navigateTo).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
  for (const [owner, routes] of groups) {
    suggestions.push({
      id: `${base.id}:${slug(owner)}`,
      kind: base.kind,
      ...(base.signalId ? { signalId: base.signalId } : {}),
      routeIds: routes.map((route) => route.id),
      navigateTo: owner,
      estimatedRouteReduction: routes.length,
      reversible: true,
      details: { ...base.details, owner }
    })
  }
}

function overlapCount(routes: readonly ContextDebtRoute[], thresholds: ContextDebtThresholds): number {
  let count = 0
  for (const group of groupBy(routes.filter((route) => route.modality !== 'control'), (route) => route.signalId).values()) {
    const modalities = new Set(group.map((route) => route.modality))
    const routeExcess = Math.max(0, group.length - thresholds.maxRoutesPerCue)
    const modalityExcess = Math.max(0, modalities.size - thresholds.maxModalitiesPerCue)
    count += Math.max(routeExcess, modalityExcess)
  }
  return count
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.round((numerator / denominator) * 1000) / 10
}

function sortedDetails(details: Record<string, string | number>): Array<[string, string | number]> {
  return Object.entries(details).sort(([a], [b]) => a.localeCompare(b))
}

export function fingerprintContextDebtDecisionState(input: ContextDebtFingerprintInput): string {
  const serialized = JSON.stringify({
    profileKey: input.profileKey,
    thresholds: input.thresholds,
    missingSources: [...(input.missingSources ?? [])].sort(),
    incompleteScans: [...(input.incompleteScans ?? [])].sort(),
    routes: [...input.routes]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((route) => [
        route.id,
        route.configurationId,
        route.signalId,
        route.label,
        route.source,
        route.sourceId,
        route.modality,
        route.target,
        route.settingPath,
        route.navigateTo,
        route.critical,
        route.priority,
        route.device?.kind,
        route.device?.id
      ]),
    suggestions: [...input.suggestions]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((suggestion) => [
        suggestion.id,
        suggestion.kind,
        suggestion.signalId,
        suggestion.routeIds,
        suggestion.navigateTo,
        suggestion.estimatedRouteReduction,
        suggestion.reversible,
        sortedDetails(suggestion.details)
      ])
  })
  let hash = 0x811c9dc5
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `cdm-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function analyzeContextDebt(input: ContextDebtAnalysisInput): ContextDebtReport {
  const thresholds = mergeContextDebtThresholds(input.thresholds)
  const routes: ContextDebtRoute[] = []
  let alertCount = 0
  let overlayCount = 0
  let hapticsCount = 0

  if (input.alerts) alertCount = addAlertRoutes(input.alerts, routes)
  if (input.overlays) overlayCount = addOverlayRoutes(input.overlays, routes)
  if (input.sounds) addSoundRoutes(input.sounds, routes)
  if (input.spotter) addSpotterRoutes(input.spotter, routes)
  if (input.spotter3d) addSpotter3dRoutes(input.spotter3d, routes)
  addCoachAndEngineerRoutes(input.coach, input.engineer, routes)
  if (input.haptics) hapticsCount += addHapticsRoutes(input.haptics, routes)
  if (input.zonalHaptics) hapticsCount += addZonalHapticsRoutes(input.zonalHaptics, routes)
  const controlRefs = addControlRoutes(input.bindings ?? [], input.engineer, routes)
  for (const route of routes) {
    if (!isSemanticCriticalSignal(route.signalId)) continue
    route.critical = true
  }

  const issues: ContextDebtIssue[] = []
  const suggestions: ContextDebtSuggestion[] = []
  const suggestedRouteIds = new Set<string>()
  const missingSources = EXPECTED_SOURCES.filter((source) => !sourceAvailable(input, source))
  const incompleteScans = CONTEXT_DEBT_DEVICE_KINDS.filter((kind) => {
    const status = input.devices?.scanStatus?.[kind]
    return status !== undefined && status !== 'success'
  })

  for (const source of missingSources) {
    issues.push({
      id: `source-missing:${source}`,
      kind: 'source-missing',
      severity: 'info',
      routeIds: [],
      details: { source }
    })
  }

  for (const kind of incompleteScans) {
    const status = input.devices?.scanStatus?.[kind] ?? 'not-run'
    const affectedRoutes = routes.filter((route) => route.device?.kind === kind)
    issues.push({
      id: `scan-incomplete:${kind}`,
      kind: 'scan-incomplete',
      severity: 'warning',
      routeIds: affectedRoutes.map((route) => route.id),
      details: { kind, status, routes: affectedRoutes.length }
    })
  }

  const duplicateGroups = [...groupBy(routes, duplicateKey).entries()].filter(([, group]) => group.length > 1)
  for (const [key, group] of duplicateGroups) {
    issues.push({
      id: `duplicate-route:${slug(key)}`,
      kind: 'duplicate-route',
      severity: group.some((route) => route.critical) ? 'high' : 'warning',
      signalId: group[0].signalId,
      routeIds: group.map((route) => route.id),
      details: {
        label: group[0].label,
        count: group.length,
        target: group[0].target
      }
    })

    if (!group.some((route) => route.critical)) {
      const sorted = group
        .filter((route) => !suggestedRouteIds.has(route.id))
        .sort(routePrioritySort)
      const remove = sorted.slice(1).filter((route) => !suggestedRouteIds.has(route.id))
      if (remove.length > 0) {
        remove.forEach((route) => suggestedRouteIds.add(route.id))
        suggestions.push({
          id: `dedupe-route:${slug(key)}`,
          kind: 'dedupe-route',
          signalId: group[0].signalId,
          routeIds: remove.map((route) => route.id),
          navigateTo: remove[0].navigateTo,
          estimatedRouteReduction: remove.length,
          reversible: true,
          details: {
            label: group[0].label,
            target: group[0].target,
            kept: sorted[0].label
          }
        })
      }
    }
  }

  const cueGroups = [...groupBy(
    routes.filter((route) => route.modality !== 'control'),
    (route) => route.signalId
  ).entries()]
  const competingGroups = cueGroups.filter(([, group]) => {
    const modalities = new Set(group.map((route) => route.modality))
    return group.length > thresholds.maxRoutesPerCue || modalities.size > thresholds.maxModalitiesPerCue
  })

  for (const [signalId, group] of competingGroups) {
    const modalities = new Set(group.map((route) => route.modality))
    issues.push({
      id: `competing-cue:${slug(signalId)}`,
      kind: 'competing-cue',
      severity: group.some((route) => route.critical) ? 'high' : 'warning',
      signalId,
      routeIds: group.map((route) => route.id),
      details: {
        signal: signalId,
        routes: group.length,
        modalities: modalities.size,
        criticalLocked: group.some((route) => route.critical) ? 1 : 0
      }
    })

    if (group.some((route) => route.critical)) continue
    const remainingGroup = group.filter((route) => !suggestedRouteIds.has(route.id))
    const remove = routesToRemoveForCue(remainingGroup, thresholds)
    if (remove.length === 0) continue
    const alreadySuggested = group.length - remainingGroup.length
    remove.forEach((route) => suggestedRouteIds.add(route.id))
    addRouteSuggestionsByOwner(suggestions, {
      id: `trim-cue:${slug(signalId)}`,
      kind: 'trim-cue',
      signalId,
      routes: remove,
      details: {
        signal: signalId,
        before: group.length,
        after: group.length - alreadySuggested - remove.length
      }
    })
  }

  const unknownGroups = new Map<string, ContextDebtRoute[]>()
  for (const route of routes) {
    const device = route.device
    if (!device || deviceIsImplicitlyKnown(device.kind, device.id) || !scanComplete(input.devices, device.kind)) continue
    if (deviceIds(input.devices, device.kind).has(device.id)) continue
    const key = `${device.kind}:${device.id}`
    const group = unknownGroups.get(key)
    if (group) group.push(route)
    else unknownGroups.set(key, [route])
  }

  for (const [key, group] of unknownGroups) {
    const [kind, ...idParts] = key.split(':')
    const id = idParts.join(':')
    issues.push({
      id: `unknown-device:${slug(key)}`,
      kind: 'unknown-device',
      severity: group.some((route) => route.critical) ? 'high' : 'warning',
      signalId: group[0].signalId,
      routeIds: group.map((route) => route.id),
      details: { kind, deviceId: id, routes: group.length }
    })
    for (const [owner, ownerRoutes] of groupBy(group, (route) => route.navigateTo)) {
      suggestions.push({
        id: `repair-device:${slug(key)}:${slug(owner)}`,
        kind: 'repair-device',
        signalId: ownerRoutes[0].signalId,
        routeIds: [],
        navigateTo: owner,
        estimatedRouteReduction: 0,
        reversible: true,
        details: { kind, deviceId: id, routes: ownerRoutes.length, owner }
      })
    }
  }

  const controlGroups = groupBy(controlRefs, (ref) => ref.controlKey)
  const controlConflicts = [...controlGroups.entries()].filter(([, group]) => new Set(group.map((ref) => ref.actionKey)).size > 1)
  for (const [control, group] of controlConflicts) {
    issues.push({
      id: `control-conflict:${slug(control)}`,
      kind: 'control-conflict',
      severity: 'high',
      routeIds: group.map((ref) => ref.route.id),
      details: {
        control,
        actions: new Set(group.map((ref) => ref.actionKey)).size,
        routes: group.length
      }
    })
    suggestions.push({
      id: `resolve-control:${slug(control)}`,
      kind: 'resolve-control',
      routeIds: [],
      navigateTo: 'controls',
      estimatedRouteReduction: 0,
      reversible: true,
      details: {
        control,
        actions: new Set(group.map((ref) => ref.actionKey)).size
      }
    })
  }

  const audioRoutes = routes.filter((route) => route.modality === 'audio')
  const hapticRoutes = routes.filter((route) => route.modality === 'haptic')
  const overlayRoutes = routes.filter((route) => route.source === 'overlay')

  const thresholdChecks: Array<{
    key: 'overlays' | 'audio' | 'haptics' | 'total'
    actual: number
    limit: number
    candidates: ContextDebtRoute[]
    suggestionKind?: ContextDebtSuggestionKind
  }> = [
    {
      key: 'overlays',
      actual: overlayCount,
      limit: thresholds.maxOverlays,
      candidates: overlayRoutes,
      suggestionKind: 'trim-overlays'
    },
    {
      key: 'audio',
      actual: audioRoutes.length,
      limit: thresholds.maxAudioRoutes,
      candidates: audioRoutes,
      suggestionKind: 'trim-audio'
    },
    {
      key: 'haptics',
      actual: hapticsCount,
      limit: thresholds.maxHapticRoutes,
      candidates: hapticRoutes,
      suggestionKind: 'trim-haptics'
    },
    {
      key: 'total',
      actual: routes.length,
      limit: thresholds.maxTotalRoutes,
      candidates: []
    }
  ]

  for (const check of thresholdChecks) {
    if (check.actual <= check.limit) continue
    issues.push({
      id: `threshold-exceeded:${check.key}`,
      kind: 'threshold-exceeded',
      severity: check.key === 'total' ? 'high' : 'warning',
      routeIds: check.candidates.map((route) => route.id),
      details: { metric: check.key, actual: check.actual, limit: check.limit }
    })

    if (!check.suggestionKind) continue
    const remainingCandidates = check.candidates.filter((route) => !suggestedRouteIds.has(route.id))
    const alreadySuggested = check.candidates.length - remainingCandidates.length
    const needed = Math.max(0, check.actual - alreadySuggested - check.limit)
    const removable = remainingCandidates
      .filter((route) => !route.critical)
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
      .slice(0, needed)
    if (removable.length === 0) continue
    removable.forEach((route) => suggestedRouteIds.add(route.id))
    addRouteSuggestionsByOwner(suggestions, {
      id: `${check.suggestionKind}:threshold`,
      kind: check.suggestionKind,
      routes: removable,
      details: {
        metric: check.key,
        before: check.actual,
        target: check.limit
      }
    })
  }

  const duplicateRouteCount = duplicateGroups.reduce((total, [, group]) => total + group.length - 1, 0)
  const overlapRoutes = overlapCount(routes, thresholds)
  const thresholdDebt = thresholdChecks.reduce(
    (total, check) => total + Math.max(0, check.actual - check.limit),
    0
  )
  const debtPoints =
    competingGroups.length * 2 +
    duplicateRouteCount * 2 +
    unknownGroups.size * 2 +
    controlConflicts.length * 3 +
    Math.ceil(thresholdDebt / 3)
  const sourceCoveragePct = pct(EXPECTED_SOURCES.length - missingSources.length, EXPECTED_SOURCES.length)
  const successfulScans = CONTEXT_DEBT_DEVICE_KINDS.filter(
    (kind) => input.devices?.scanStatus?.[kind] === 'success'
  ).length
  const hardwareScanCoveragePct = input.devices?.scanStatus
    ? pct(successfulScans, CONTEXT_DEBT_DEVICE_KINDS.length)
    : 0
  const band: ContextDebtBand =
    missingSources.length > 0 || incompleteScans.length > 0
      ? 'incomplete'
      : debtPoints >= thresholds.highScore
        ? 'high'
        : debtPoints >= thresholds.warningScore
          ? 'watch'
          : 'clear'

  const criticalRoutes = routes.filter((route) => route.critical).length
  const counts: ContextDebtCounts = {
    competingCues: competingGroups.length,
    alerts: alertCount,
    overlays: overlayCount,
    audio: audioRoutes.length,
    haptics: hapticsCount,
    controlConflicts: controlConflicts.length,
    duplicateRoutes: duplicateRouteCount,
    unknownDevices: unknownGroups.size,
    totalRoutes: routes.length,
    criticalRoutes
  }

  const metrics: ContextDebtMetrics = {
    eligibleRoutes: routes.length,
    overlapRoutes,
    overlapRatePct: pct(overlapRoutes, routes.length),
    criticalRoutesProtectedPct: 100,
    sourceCoveragePct,
    hardwareScanCoveragePct,
    debtPoints
  }

  return {
    profile: input.profile,
    thresholds,
    routes,
    issues,
    suggestions,
    counts,
    metrics,
    band,
    fingerprint: fingerprintContextDebtDecisionState({
      profileKey: input.profile.key,
      thresholds,
      routes,
      suggestions,
      missingSources,
      incompleteScans
    }),
    missingSources,
    incompleteScans
  }
}

export function previewContextDebtSuggestions(
  report: ContextDebtReport,
  suggestionIds: readonly string[]
): ContextDebtPreview {
  const selected = new Set(suggestionIds)
  const requestedRouteIds = new Set(
    report.suggestions
      .filter((suggestion) => selected.has(suggestion.id))
      .flatMap((suggestion) => suggestion.routeIds)
  )
  const blockedCriticalRoutes = report.routes.filter(
    (route) => requestedRouteIds.has(route.id) && route.critical
  )
  const blockedIds = new Set(blockedCriticalRoutes.map((route) => route.id))
  const removedRoutes = report.routes.filter(
    (route) => requestedRouteIds.has(route.id) && !blockedIds.has(route.id) && !route.critical
  )
  const removedIds = new Set(removedRoutes.map((route) => route.id))
  const afterRoutes = report.routes.filter((route) => !removedIds.has(route.id))
  const beforeCritical = report.routes.filter((route) => route.critical).length
  const afterCritical = afterRoutes.filter((route) => route.critical).length
  const beforeOverlap = overlapCount(report.routes, report.thresholds)
  const afterOverlap = overlapCount(afterRoutes, report.thresholds)

  return {
    suggestionIds: [...selected],
    removedRoutes,
    blockedCriticalRoutes,
    beforeRouteCount: report.routes.length,
    afterRouteCount: afterRoutes.length,
    routeReductionPct: pct(removedRoutes.length, report.routes.length),
    beforeOverlapRoutes: beforeOverlap,
    afterOverlapRoutes: afterOverlap,
    overlapReductionPct: beforeOverlap <= 0 ? 0 : pct(beforeOverlap - afterOverlap, beforeOverlap),
    criticalRoutesBefore: beforeCritical,
    criticalRoutesAfter: afterCritical,
    criticalDrops: beforeCritical - afterCritical,
    safe: blockedCriticalRoutes.length === 0 && beforeCritical === afterCritical
  }
}

export function reconcileContextDebtPreviewSelection(
  current: ContextDebtPreviewSelection | null,
  report: Pick<ContextDebtReport, 'profile' | 'fingerprint'>
): ContextDebtPreviewSelection {
  if (!current || current.profileKey !== report.profile.key || current.fingerprint !== report.fingerprint) {
    return {
      profileKey: report.profile.key,
      fingerprint: report.fingerprint,
      suggestionId: null
    }
  }
  return current
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean'
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isAlertOutputLike(value: unknown): value is AlertOutput {
  if (!isRecord(value) || !isOptionalBoolean(value.enabled)) return false
  switch (value.kind) {
    case 'buttonbox':
      return typeof value.preset === 'string'
    case 'serial':
      return typeof value.template === 'string' && isOptionalString(value.deviceId)
    case 'secondScreen':
      return typeof value.slot === 'string'
    case 'sound':
      return true
    default:
      return false
  }
}

function isAlertRuleLike(value: unknown): value is AlertRuleConfig {
  if (!isRecord(value) || typeof value.enabled !== 'boolean') return false
  if (
    value.severity !== undefined &&
    value.severity !== 'info' &&
    value.severity !== 'warning' &&
    value.severity !== 'critical'
  ) {
    return false
  }
  return value.outputs === undefined || (
    Array.isArray(value.outputs) &&
    value.outputs.every(isAlertOutputLike)
  )
}

function isAlertsConfigLike(value: unknown): value is AlertsConfig {
  if (!isRecord(value) || typeof value.audioEnabled !== 'boolean') return false
  const requiredRules = ['pitLimiter', 'flags', 'lowFuel', 'shiftPoint', 'incidentLimit']
  if (!requiredRules.every((key) => isAlertRuleLike(value[key]))) return false
  return ALERT_RULES.every(({ key }) => value[key] === undefined || isAlertRuleLike(value[key]))
}

const OVERLAY_TRIGGER_KINDS = new Set([
  'always',
  'never',
  'semantic',
  'carLeft',
  'carRight',
  'carLeftOrRight',
  'proximity',
  'shiftPoint',
  'pitLimiter',
  'flag',
  'lowFuel'
])

function isOverlayTriggerLike(value: unknown): value is OverlayTrigger {
  if (!isRecord(value) || typeof value.kind !== 'string' || !OVERLAY_TRIGGER_KINDS.has(value.kind)) {
    return false
  }
  return value.kind !== 'semantic' || (typeof value.semantic === 'string' && value.semantic.length > 0)
}

function isOverlayConfigLike(value: unknown): boolean {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.enabled !== 'boolean') return false
  if (!isOptionalBoolean(value.favorite)) return false
  if (value.role !== undefined && value.role !== 'alert' && value.role !== 'ordinary') return false
  if (value.trigger !== undefined && value.trigger !== null && !isOverlayTriggerLike(value.trigger)) return false
  if (value.display !== undefined && value.display !== null) {
    if (!isRecord(value.display) || !isFiniteNumber(value.display.id)) return false
  }
  return true
}

function isOverlaysConfigLike(value: unknown): value is OverlaysConfig {
  return (
    isRecord(value) &&
    isRecord(value.widgets) &&
    Object.values(value.widgets).every(isOverlayConfigLike) &&
    Array.isArray(value.customOverlays) &&
    value.customOverlays.every(isOverlayConfigLike)
  )
}

function isActionBindingLike(value: unknown): value is ActionBinding {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.enabled !== 'boolean') return false
  if (
    !isRecord(value.control) ||
    value.control.source !== 'gamepad' ||
    !isFiniteNumber(value.control.buttonIndex) ||
    !isOptionalString(value.control.gamepadId) ||
    (value.control.gamepadIndex !== undefined && !isFiniteNumber(value.control.gamepadIndex))
  ) {
    return false
  }
  if (!isRecord(value.action) || typeof value.action.type !== 'string' || !isRecord(value.action.command)) return false
  switch (value.action.type) {
    case 'keyboard':
      return (
        Array.isArray(value.action.command.keys) &&
        value.action.command.keys.every((key) => typeof key === 'string') &&
        typeof value.action.command.mode === 'string'
      )
    case 'gamepad':
      return (
        (typeof value.action.command.button === 'number' || typeof value.action.command.button === 'string') &&
        typeof value.action.command.mode === 'string'
      )
    case 'iracing':
      return typeof value.action.command.name === 'string'
    case 'app':
      return typeof value.action.command.name === 'string'
    default:
      return false
  }
}

function isSoundsConfigLike(value: unknown): value is SoundsConfig {
  if (!isRecord(value) || !isOptionalString(value.outputDeviceId)) return false
  return ['soundshift', 'incident', 'abs', 'tcs'].every((key) => {
    const config = value[key]
    return isRecord(config) && typeof config.enabled === 'boolean'
  })
}

function isHapticsConfigLike(value: unknown): value is HapticsConfig {
  if (
    !isRecord(value) ||
    typeof value.enabled !== 'boolean' ||
    typeof value.muted !== 'boolean' ||
    !isFiniteNumber(value.masterGain) ||
    !isOptionalString(value.outputDeviceId) ||
    !isRecord(value.effects) ||
    !isRecord(value.arduino) ||
    typeof value.arduino.enabled !== 'boolean' ||
    !isOptionalString(value.arduino.deviceId)
  ) {
    return false
  }
  const effects = value.effects as Record<string, unknown>
  return HAPTICS_EFFECT_IDS.every((id) => {
    const effect = effects[id]
    return (
      isRecord(effect) &&
      typeof effect.enabled === 'boolean' &&
      isFiniteNumber(effect.intensity) &&
      typeof effect.arduino === 'boolean'
    )
  })
}

function isZonalHapticsConfigLike(value: unknown): value is HapticsZonalConfig {
  if (
    !isRecord(value) ||
    typeof value.enabled !== 'boolean' ||
    typeof value.muted !== 'boolean' ||
    !isFiniteNumber(value.masterGain) ||
    !isRecord(value.events) ||
    !isRecord(value.zones) ||
    !isRecord(value.arduino) ||
    typeof value.arduino.enabled !== 'boolean' ||
    !isOptionalString(value.arduino.deviceId)
  ) {
    return false
  }
  const events = value.events as Record<string, unknown>
  const zones = value.zones as Record<string, unknown>
  if (!HAPTIC_ZONE_IDS.every((id) => {
    const zone = zones[id]
    return isRecord(zone) && typeof zone.enabled === 'boolean' && isFiniteNumber(zone.gain)
  })) {
    return false
  }
  return HAPTIC_EVENT_IDS.every((id) => {
    const event = events[id]
    const eventZones = isRecord(event) && isRecord(event.zones)
      ? event.zones as Record<string, unknown>
      : null
    return (
      isRecord(event) &&
      typeof event.enabled === 'boolean' &&
      isFiniteNumber(event.gain) &&
      eventZones !== null &&
      HAPTIC_ZONE_IDS.every((zoneId) => isFiniteNumber(eventZones[zoneId]))
    )
  })
}

function isSpotterConfigLike(value: unknown): value is SpotterConfig {
  if (
    !isRecord(value) ||
    typeof value.enabled !== 'boolean' ||
    typeof value.muted !== 'boolean' ||
    !isFiniteNumber(value.masterVolume) ||
    !isOptionalString(value.outputDeviceId) ||
    !isRecord(value.callouts)
  ) {
    return false
  }
  const callouts = value.callouts as Record<string, unknown>
  return CALLOUT_CATALOG.every(({ id }) => {
    const callout = callouts[id]
    return (
      isRecord(callout) &&
      typeof callout.enabled === 'boolean' &&
      isFiniteNumber(callout.volume) &&
      isFiniteNumber(callout.priority)
    )
  })
}

function isSpotter3dConfigLike(value: unknown): value is Spotter3DConfig {
  return (
    isRecord(value) &&
    typeof value.enabled === 'boolean' &&
    isFiniteNumber(value.masterVolume)
  )
}

function isEngineerButtonBindingLike(value: unknown): boolean {
  return (
    isRecord(value) &&
    isFiniteNumber(value.buttonIndex) &&
    isOptionalString(value.gamepadId) &&
    (value.gamepadIndex === undefined || isFiniteNumber(value.gamepadIndex))
  )
}

function isEngineerConfigLike(value: unknown): value is EngineerConfig {
  if (
    !isRecord(value) ||
    typeof value.enabled !== 'boolean' ||
    typeof value.proactiveCoaching !== 'boolean' ||
    !Array.isArray(value.presetQuestions) ||
    !isRecord(value.buttonBindings) ||
    !isRecord(value.buttonBindings.presets)
  ) {
    return false
  }
  if (
    value.buttonBindings.pushToTalk !== null &&
    !isEngineerButtonBindingLike(value.buttonBindings.pushToTalk)
  ) {
    return false
  }
  if (!Object.values(value.buttonBindings.presets).every(isEngineerButtonBindingLike)) return false
  return value.presetQuestions.every((preset) => (
    isRecord(preset) &&
    typeof preset.id === 'string' &&
    typeof preset.label === 'string'
  ))
}

function isCoachConfigLike(value: unknown): value is CoachConfig {
  return (
    isRecord(value) &&
    typeof value.enabled === 'boolean' &&
    typeof value.speakTopTip === 'boolean'
  )
}

function isContextDebtSourceSnapshotLike(
  source: ContextDebtSourceFamily,
  value: unknown
): boolean {
  switch (source) {
    case 'alerts':
      return isAlertsConfigLike(value)
    case 'overlays':
      return isOverlaysConfigLike(value)
    case 'sounds':
      return isSoundsConfigLike(value)
    case 'haptics':
      return isHapticsConfigLike(value)
    case 'zonalHaptics':
      return isZonalHapticsConfigLike(value)
    case 'controls':
      return Array.isArray(value) && value.every(isActionBindingLike)
    case 'spotter':
      return isSpotterConfigLike(value)
    case 'spotter3d':
      return isSpotter3dConfigLike(value)
    case 'engineer':
      return isEngineerConfigLike(value)
    case 'coach':
      return isCoachConfigLike(value)
  }
}

export function sanitizeContextDebtSourceSnapshot<Source extends ContextDebtSourceFamily>(
  source: Source,
  value: unknown
): ContextDebtSourceSnapshotMap[Source] | undefined {
  const sanitized = sanitizeRaceProfileSnapshot(value)
  if (sanitized === undefined || !isContextDebtSourceSnapshotLike(source, sanitized)) return undefined
  return sanitized as ContextDebtSourceSnapshotMap[Source]
}

function withProfileHapticsGains(
  haptics: HapticsConfig | null | undefined,
  gains: RaceProfile['hapticsGains']
): HapticsConfig | null | undefined {
  if (!haptics || !gains) return haptics
  const sanitized = sanitizeRaceProfileSnapshot(gains)
  if (!isRecord(sanitized)) return haptics
  const effects = { ...haptics.effects }
  for (const [id, intensity] of Object.entries(sanitized)) {
    if (!(id in effects) || typeof intensity !== 'number' || !Number.isFinite(intensity)) continue
    const effectId = id as HapticsEffectId
    effects[effectId] = { ...effects[effectId], intensity: Math.max(0, Math.min(1, intensity)) }
  }
  return { ...haptics, effects }
}

export function selectContextDebtProfileSnapshot(
  live: ContextDebtConfigSnapshot,
  profile: RaceProfile | null | undefined
): ContextDebtConfigSnapshot {
  if (!profile) return live
  const alerts = sanitizeContextDebtSourceSnapshot('alerts', profile.alerts)
  const overlays = sanitizeContextDebtSourceSnapshot('overlays', profile.overlays)
  const bindings = sanitizeContextDebtSourceSnapshot('controls', profile.bindings)
  return {
    ...live,
    alerts: alerts ?? live.alerts,
    overlays: overlays ?? live.overlays,
    bindings: bindings ?? live.bindings,
    haptics: withProfileHapticsGains(live.haptics, profile.hapticsGains)
  }
}
