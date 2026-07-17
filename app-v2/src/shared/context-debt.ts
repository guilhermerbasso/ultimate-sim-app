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
  type OverlayWidgetConfig,
  type OverlaysConfig
} from './overlays'
import type { RaceProfile } from './raceprofiles'
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
export type ContextDebtBand = 'clear' | 'watch' | 'high' | 'incomplete'
export type ContextDebtIssueKind =
  | 'competing-cue'
  | 'duplicate-route'
  | 'unknown-device'
  | 'control-conflict'
  | 'threshold-exceeded'
  | 'source-missing'

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
  scanned?: Partial<Record<ContextDebtDeviceKind, boolean>>
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

const CRITICAL_OVERLAY_SIGNALS = new Set([
  'flags',
  'blue-flag',
  'proximity',
  'pit-speeding',
  'engine-warning',
  'water-temperature-critical',
  'oil-temperature-critical',
  'oil-pressure-low',
  'bad-surface',
  'tyre-temperature-critical',
  'brake-pressure-low'
])

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(min, Math.min(max, Math.round(numeric)))
}

export function mergeContextDebtThresholds(
  patch: Partial<ContextDebtThresholds> | undefined
): ContextDebtThresholds {
  const base = DEFAULT_CONTEXT_DEBT_THRESHOLDS
  return {
    maxRoutesPerCue: clampInteger(patch?.maxRoutesPerCue, 1, 12, base.maxRoutesPerCue),
    maxModalitiesPerCue: clampInteger(patch?.maxModalitiesPerCue, 1, 4, base.maxModalitiesPerCue),
    maxOverlays: clampInteger(patch?.maxOverlays, 0, 100, base.maxOverlays),
    maxAudioRoutes: clampInteger(patch?.maxAudioRoutes, 0, 200, base.maxAudioRoutes),
    maxHapticRoutes: clampInteger(patch?.maxHapticRoutes, 0, 100, base.maxHapticRoutes),
    maxTotalRoutes: clampInteger(patch?.maxTotalRoutes, 1, 500, base.maxTotalRoutes),
    warningScore: clampInteger(patch?.warningScore, 1, 100, base.warningScore),
    highScore: clampInteger(
      patch?.highScore,
      clampInteger(patch?.warningScore, 1, 100, base.warningScore) + 1,
      200,
      base.highScore
    )
  }
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
    const critical = severity === 'critical' || meta.signalId === 'flags' || meta.signalId === 'blue-flag'
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

function signalFromOverlayId(id: string, category?: string): string {
  const normalized = id.toLowerCase()
  if (/(fuel|stint)/.test(normalized)) return 'fuel'
  if (/(flag|sessionbanner|pace)/.test(normalized)) return 'flags'
  if (/(shift|rev|gear)/.test(normalized)) return 'shift'
  if (/(proximity|radar|sidecar|sideproximity|relative)/.test(normalized)) return 'proximity'
  if (/(tyrepressure|tirepressure|coldpressure)/.test(normalized)) return 'tyre-pressure'
  if (/(tyre|tire)/.test(normalized)) return 'tyres'
  if (/(braketemp|brakeheat)/.test(normalized)) return 'brake-temperature'
  if (/(abs)/.test(normalized)) return 'abs'
  if (/(tc|traction)/.test(normalized)) return 'traction-control'
  if (/(engine|oil|water)/.test(normalized)) return 'engine'
  if (/(weather|wet|rain|surface)/.test(normalized)) return 'weather'
  if (category) return category
  return `overlay-${slug(id)}`
}

function overlayRoute(
  id: string,
  label: string,
  config: Pick<OverlayWidgetConfig, 'role' | 'trigger' | 'display' | 'favorite'>,
  category?: string
): ContextDebtRoute {
  const triggerSignal = signalFromOverlayTrigger(config.trigger)
  const signalId = triggerSignal ?? signalFromOverlayId(id, category)
  const displayId = config.display?.id
  const critical = config.role === 'alert' || CRITICAL_OVERLAY_SIGNALS.has(signalId)
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
    routes.push(overlayRoute(config.id, definition?.title ?? config.id, config, definition?.category))
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
    const critical = config.priority >= 8
    addAudioRoute(routes, {
      id: routeId('spotter', meta.id),
      configurationId: `spotter:${meta.id}`,
      signalId: signalFromSpotterCallout(meta.id),
      label: `Voice spotter · ${meta.label}`,
      source: 'spotter',
      sourceId: meta.id,
      target: `audio:${outputId}`,
      settingPath: `spotter.callouts.${meta.id}.enabled`,
      navigateTo: 'engineer',
      critical,
      priority: critical ? 95 : 40 + config.priority,
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

function controlKey(control: Pick<HidButtonControl, 'gamepadId' | 'gamepadIndex' | 'buttonIndex' | 'switchType'>): string {
  const device = control.gamepadId?.trim() || `index-${control.gamepadIndex ?? 'any'}`
  return `gamepad:${device}:button:${control.buttonIndex}:switch:${control.switchType ?? 'momentary'}`
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
    buttonIndex: binding.buttonIndex,
    switchType: 'momentary'
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
  const explicit = inventory?.scanned?.[kind]
  if (typeof explicit === 'boolean') return explicit
  if (!inventory) return false
  if (kind === 'audio') return inventory.audioOutputIds !== undefined
  if (kind === 'serial') return inventory.serialDeviceIds !== undefined
  if (kind === 'display') return inventory.displayIds !== undefined
  return inventory.gamepadIds !== undefined
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
  if (kind === 'serial') return normalized === '' || normalized === 'primary'
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
    if (!keep.includes(route)) keep.push(route)
  }
  const keepIds = new Set(keep.map((route) => route.id))
  return sorted.filter((route) => !keepIds.has(route.id))
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

function stableFingerprint(profileKey: string, thresholds: ContextDebtThresholds, routes: ContextDebtRoute[]): string {
  const serialized = JSON.stringify({
    profileKey,
    thresholds,
    routes: [...routes]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((route) => [
        route.id,
        route.configurationId,
        route.signalId,
        route.modality,
        route.target,
        route.critical,
        route.device?.kind,
        route.device?.id
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

  const issues: ContextDebtIssue[] = []
  const suggestions: ContextDebtSuggestion[] = []
  const suggestedRouteIds = new Set<string>()
  const missingSources = EXPECTED_SOURCES.filter((source) => !sourceAvailable(input, source))

  for (const source of missingSources) {
    issues.push({
      id: `source-missing:${source}`,
      kind: 'source-missing',
      severity: 'info',
      routeIds: [],
      details: { source }
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
      const sorted = [...group].sort(routePrioritySort)
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
    const remove = routesToRemoveForCue(group, thresholds)
      .filter((route) => !suggestedRouteIds.has(route.id))
    if (remove.length === 0) continue
    remove.forEach((route) => suggestedRouteIds.add(route.id))
    suggestions.push({
      id: `trim-cue:${slug(signalId)}`,
      kind: 'trim-cue',
      signalId,
      routeIds: remove.map((route) => route.id),
      navigateTo: remove[0].navigateTo,
      estimatedRouteReduction: remove.length,
      reversible: true,
      details: {
        signal: signalId,
        before: group.length,
        after: group.length - remove.length
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
    suggestions.push({
      id: `repair-device:${slug(key)}`,
      kind: 'repair-device',
      signalId: group[0].signalId,
      routeIds: [],
      navigateTo: group[0].navigateTo,
      estimatedRouteReduction: 0,
      reversible: true,
      details: { kind, deviceId: id, routes: group.length }
    })
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
    navigateTo?: string
  }> = [
    {
      key: 'overlays',
      actual: overlayCount,
      limit: thresholds.maxOverlays,
      candidates: overlayRoutes,
      suggestionKind: 'trim-overlays',
      navigateTo: 'overlays'
    },
    {
      key: 'audio',
      actual: audioRoutes.length,
      limit: thresholds.maxAudioRoutes,
      candidates: audioRoutes,
      suggestionKind: 'trim-audio',
      navigateTo: 'sounds'
    },
    {
      key: 'haptics',
      actual: hapticsCount,
      limit: thresholds.maxHapticRoutes,
      candidates: hapticRoutes,
      suggestionKind: 'trim-haptics',
      navigateTo: 'haptics'
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

    if (!check.suggestionKind || !check.navigateTo) continue
    const needed = check.actual - check.limit
    const removable = [...check.candidates]
      .filter((route) => !route.critical && !suggestedRouteIds.has(route.id))
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
      .slice(0, needed)
    if (removable.length === 0) continue
    removable.forEach((route) => suggestedRouteIds.add(route.id))
    suggestions.push({
      id: `${check.suggestionKind}:threshold`,
      kind: check.suggestionKind,
      routeIds: removable.map((route) => route.id),
      navigateTo: check.navigateTo,
      estimatedRouteReduction: removable.length,
      reversible: true,
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
  const band: ContextDebtBand =
    missingSources.length > 0
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
    fingerprint: stableFingerprint(input.profile.key, thresholds, routes),
    missingSources
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

function isAlertsConfigLike(value: unknown): value is AlertsConfig {
  if (!isRecord(value) || typeof value.audioEnabled !== 'boolean') return false
  return ['pitLimiter', 'flags', 'lowFuel', 'shiftPoint', 'incidentLimit'].every((key) => {
    const rule = value[key]
    return isRecord(rule) && typeof rule.enabled === 'boolean'
  })
}

function isOverlaysConfigLike(value: unknown): value is OverlaysConfig {
  return isRecord(value) && isRecord(value.widgets) && Array.isArray(value.customOverlays)
}

function isActionBindingLike(value: unknown): value is ActionBinding {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.enabled !== 'boolean') return false
  if (!isRecord(value.control) || typeof value.control.buttonIndex !== 'number') return false
  if (!isRecord(value.action) || typeof value.action.type !== 'string' || !isRecord(value.action.command)) return false
  switch (value.action.type) {
    case 'keyboard':
      return Array.isArray(value.action.command.keys) && typeof value.action.command.mode === 'string'
    case 'gamepad':
      return value.action.command.button !== undefined && typeof value.action.command.mode === 'string'
    case 'iracing':
      return typeof value.action.command.name === 'string'
    case 'app':
      return typeof value.action.command.name === 'string'
    default:
      return false
  }
}

function withProfileHapticsGains(
  haptics: HapticsConfig | null | undefined,
  gains: RaceProfile['hapticsGains']
): HapticsConfig | null | undefined {
  if (!haptics || !gains) return haptics
  const effects = { ...haptics.effects }
  for (const [id, intensity] of Object.entries(gains)) {
    if (!(id in effects) || typeof intensity !== 'number' || !Number.isFinite(intensity)) continue
    const effectId = id as HapticsEffectId
    effects[effectId] = { ...effects[effectId], intensity }
  }
  return { ...haptics, effects }
}

export function selectContextDebtProfileSnapshot(
  live: ContextDebtConfigSnapshot,
  profile: RaceProfile | null | undefined
): ContextDebtConfigSnapshot {
  if (!profile) return live
  return {
    ...live,
    alerts: isAlertsConfigLike(profile.alerts) ? profile.alerts : live.alerts,
    overlays: isOverlaysConfigLike(profile.overlays) ? profile.overlays : live.overlays,
    bindings: Array.isArray(profile.bindings)
      ? profile.bindings.filter(isActionBindingLike)
      : live.bindings,
    haptics: withProfileHapticsGains(live.haptics, profile.hapticsGains)
  }
}
