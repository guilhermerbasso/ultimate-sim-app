import type { TelemetryCapabilityId } from './capabilities'
import { deepFreeze, freezeArrayCopy } from './immutability'
import type {
  ReadonlyTriggerOnlyFamily,
  TriggerOnlyFamily,
  TriggerOnlyFamilyRegistrySummary,
  TriggerOnlyFixtures
} from './trigger-types'

function fixtures(id: string, held = false): TriggerOnlyFixtures {
  return {
    active: `${id}:active`,
    inactive: `${id}:inactive`,
    unknown: `${id}:unknown`,
    disconnected: `${id}:disconnected`,
    ...(held ? { held: `${id}:held` } : {})
  }
}

function family<const Id extends string>(definition: TriggerOnlyFamily & { id: Id }): TriggerOnlyFamily & { id: Id } {
  return definition
}

export const TRIGGER_ONLY_FAMILY_REGISTRY = deepFreeze([
  family({
    id: 'car-left',
    ordinal: 1,
    origin: 'dedicated-widget',
    conceptIds: ['proximity'],
    role: 'trigger-only',
    severity: 'warning',
    rules: [
      {
        id: 'car-left-active',
        trigger: { kind: 'carLeft' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/renderer/src/hifi/widgets/alerts/widgets.tsx#alertCarLeft|app-v2/src/shared/telemetry.ts#carLeftRightStateFromEnum',
        provenanceHash: 'sha256:4d1f9c81be4bb89bec0500205fae038f51cc147a979faec800f3503d60e13fcb',
        unknownBehavior: 'hidden',
        policyRef: 'SDK CarLeftRight resolves to left or both',
        fixtures: fixtures('car-left-active')
      }
    ]
  }),
  family({
    id: 'car-right',
    ordinal: 2,
    origin: 'dedicated-widget',
    conceptIds: ['proximity'],
    role: 'trigger-only',
    severity: 'warning',
    rules: [
      {
        id: 'car-right-active',
        trigger: { kind: 'carRight' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/renderer/src/hifi/widgets/alerts/widgets.tsx#alertCarRight|app-v2/src/shared/telemetry.ts#carLeftRightStateFromEnum',
        provenanceHash: 'sha256:3f81bb3dde63163b9410f88df003fced11430a1e68651ac04370fa7800aa4359',
        unknownBehavior: 'hidden',
        policyRef: 'SDK CarLeftRight resolves to right or both',
        fixtures: fixtures('car-right-active')
      }
    ]
  }),
  family({
    id: 'gap-proximity',
    ordinal: 3,
    origin: 'dedicated-widget',
    conceptIds: ['perCarRelativeTime'],
    role: 'trigger-only',
    severity: 'warning',
    rules: [
      {
        id: 'configured-gap-proximity',
        trigger: { kind: 'proximity' },
        temporalMode: 'level',
        thresholdSource: 'user-config',
        provenance: 'app-v2/src/renderer/src/hifi/widgets/alerts/widgets.tsx#alertProximityRadar|app-v2/src/shared/overlay-trigger.ts#evaluateOverlayTrigger.proximity',
        provenanceHash: 'sha256:1436042adaf994d75c9fef0887060ca9b9b973602d1ad5f8116de4a5293f8d8d',
        unknownBehavior: 'hidden',
        policyRef: 'Overlay configuration supplies the relative-gap threshold',
        sourceConstraint: 'The registry does not assert a universal gap threshold; the adapter must supply reviewed user configuration.',
        fixtures: fixtures('configured-gap-proximity')
      }
    ]
  }),
  family({
    id: 'shift-point',
    ordinal: 4,
    origin: 'dedicated-widget',
    conceptIds: ['shiftLights'],
    role: 'trigger-only',
    severity: 'info',
    rules: [
      {
        id: 'configured-shift-point',
        trigger: { kind: 'shiftPoint' },
        temporalMode: 'level',
        thresholdSource: 'user-config',
        provenance: 'app-v2/src/renderer/src/hifi/widgets/alerts/widgets.tsx#alertShiftFlash|app-v2/src/shared/alerts.ts#AlertsConfig.shiftPoint|app-v2/src/shared/overlay-trigger.ts#shiftPointActive',
        provenanceHash: 'sha256:abbf7e64c88c72f6cab0fd473ff62ef829e70852b4df2c4dabf513abd6031ba7',
        unknownBehavior: 'hidden',
        policyRef: 'AlertsConfig.shiftPoint.shiftIndicatorPct and rpmPct',
        sourceConstraint: 'The registry does not encode a universal shift percentage or RPM percentage.',
        fixtures: fixtures('configured-shift-point')
      }
    ]
  }),
  family({
    id: 'pit-limiter',
    ordinal: 5,
    origin: 'dedicated-widget',
    conceptIds: ['pitLimiter'],
    role: 'trigger-only',
    severity: 'info',
    rules: [
      {
        id: 'pit-limiter-active',
        trigger: { kind: 'pitLimiter' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/renderer/src/hifi/widgets/alerts/widgets.tsx#alertPitLimiter|app-v2/src/shared/overlay-trigger.ts#evaluateOverlayTrigger.pitLimiter',
        provenanceHash: 'sha256:11d43ea4d6b2cc7b63d1db08f8ec8609c77b1a3b297506f70fda2e587d367289',
        unknownBehavior: 'hidden',
        policyRef: 'Normalized pitLimiter is true',
        fixtures: fixtures('pit-limiter-active')
      }
    ]
  }),
  family({
    id: 'race-flag',
    ordinal: 6,
    origin: 'dedicated-widget',
    conceptIds: ['raceFlags'],
    role: 'trigger-only',
    severity: 'warning',
    rules: [
      {
        id: 'race-control-flag-active',
        trigger: { kind: 'flag' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/renderer/src/hifi/widgets/alerts/widgets.tsx#alertFlag|app-v2/src/shared/overlay-trigger.ts#activeRaceControlFlags',
        provenanceHash: 'sha256:5f93289d82b87f43834c5d565b601743a36f3e9d8af72c2f21ce11f0eec8e945',
        unknownBehavior: 'hidden',
        policyRef: 'Any decoded non-green race-control flag is active',
        fixtures: fixtures('race-control-flag-active')
      }
    ]
  }),
  family({
    id: 'low-fuel',
    ordinal: 7,
    origin: 'dedicated-widget',
    conceptIds: ['fuelLevel'],
    role: 'trigger-only',
    severity: 'critical',
    rules: [
      {
        id: 'configured-low-fuel-laps',
        trigger: { kind: 'lowFuel' },
        temporalMode: 'level',
        thresholdSource: 'user-config',
        provenance: 'app-v2/src/main/alerts/detector.ts#AlertDetector.detectLowFuel|app-v2/src/shared/alerts.ts#AlertsConfig.lowFuel.lapsThreshold',
        provenanceHash: 'sha256:366967ebc7ad7db283bad90d31d5e2f7bf0e5e496c42930f24acfae8e201f86a',
        unknownBehavior: 'hidden',
        policyRef: 'App low-fuel semantic using the configured laps-remaining threshold',
        sourceConstraint: 'The registry delegates to AlertDetector and a unit-consistent laps-remaining adapter. The generic overlay-trigger fallback is not an accepted implementation for this governed rule.',
        fixtures: fixtures('configured-low-fuel-laps')
      }
    ]
  }),
  family({
    id: 'engine-warning',
    ordinal: 8,
    origin: 'dedicated-widget',
    conceptIds: ['engineWarnings'],
    role: 'trigger-only',
    severity: 'critical',
    rules: [
      {
        id: 'engine-warning-active',
        trigger: { kind: 'semantic', semantic: 'alert2EngineWarning' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/renderer/src/hifi/widgets/alerts2/widgets.tsx#alert2EngineWarning|app-v2/src/shared/overlay-trigger.ts#POLICIES.alert2EngineWarning',
        provenanceHash: 'sha256:75af4c552fc587c1c036a738e2387012de63626b36318ef67ec477f4acc43987',
        unknownBehavior: 'hidden',
        policyRef: 'Any decoded SDK engine-warning bit is active',
        fixtures: fixtures('engine-warning-active')
      }
    ]
  }),
  family({
    id: 'water-temperature',
    ordinal: 9,
    origin: 'dedicated-widget',
    conceptIds: ['coolantTemperature', 'engineWarnings'],
    role: 'trigger-only',
    severity: 'critical',
    rules: [
      {
        id: 'sdk-water-temperature-warning',
        trigger: { kind: 'semantic', semantic: 'alert2WaterTempCritical' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/renderer/src/hifi/widgets/alerts2/widgets.tsx#alert2WaterTempCritical|app-v2/src/shared/telemetry.ts#ENGINE_WARNING_BITS.waterTemp|app-v2/src/shared/overlay-trigger.ts#POLICIES.alert2WaterTempCritical',
        provenanceHash: 'sha256:c6c39df8df5828c8ad401f947494503b538ed780811fc5298a6b3935fc3363d7',
        unknownBehavior: 'hidden',
        policyRef: 'SDK EngineWarnings.waterTemp bit; live temperature is display-only',
        fixtures: fixtures('sdk-water-temperature-warning')
      }
    ]
  }),
  family({
    id: 'oil-temperature',
    ordinal: 10,
    origin: 'dedicated-widget',
    conceptIds: ['oilTemperature', 'engineWarnings'],
    role: 'trigger-only',
    severity: 'critical',
    rules: [
      {
        id: 'sdk-oil-temperature-warning',
        trigger: { kind: 'semantic', semantic: 'alert2OilTempCritical' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/renderer/src/hifi/widgets/alerts2/widgets.tsx#alert2OilTempCritical|app-v2/src/shared/telemetry.ts#ENGINE_WARNING_BITS.oilTemp|app-v2/src/shared/overlay-trigger.ts#POLICIES.alert2OilTempCritical',
        provenanceHash: 'sha256:cc189510908b344f2a29f8403e364b09abef270de70cb7b0f4453131c880e128',
        unknownBehavior: 'hidden',
        policyRef: 'SDK EngineWarnings.oilTemp bit; live temperature is display-only',
        fixtures: fixtures('sdk-oil-temperature-warning')
      }
    ]
  }),
  family({
    id: 'oil-pressure',
    ordinal: 11,
    origin: 'dedicated-widget',
    conceptIds: ['oilPressure', 'engineWarnings'],
    role: 'trigger-only',
    severity: 'critical',
    rules: [
      {
        id: 'sdk-oil-pressure-warning',
        trigger: { kind: 'semantic', semantic: 'alert2OilPressureLow' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/renderer/src/hifi/widgets/alerts2/widgets.tsx#alert2OilPressureLow|app-v2/src/shared/telemetry.ts#ENGINE_WARNING_BITS.oilPressure|app-v2/src/shared/overlay-trigger.ts#POLICIES.alert2OilPressureLow',
        provenanceHash: 'sha256:0c1aa2784fea5c308f6042c7068ed36eaffd282d593fc85cc808a34fbefd897a',
        unknownBehavior: 'hidden',
        policyRef: 'SDK EngineWarnings.oilPressure bit; live pressure is display-only',
        fixtures: fixtures('sdk-oil-pressure-warning')
      }
    ]
  }),
  family({
    id: 'bad-surface',
    ordinal: 12,
    origin: 'dedicated-widget',
    conceptIds: ['playerSurfaceMaterial'],
    role: 'trigger-only',
    severity: 'warning',
    rules: [
      {
        id: 'reviewed-bad-surface-policy',
        trigger: { kind: 'semantic', semantic: 'alert2BadSurface' },
        temporalMode: 'level',
        thresholdSource: 'reviewed-policy',
        provenance: 'app-v2/src/renderer/src/hifi/widgets/alerts2/widgets.tsx#alert2BadSurface|app-v2/src/shared/overlay-trigger.ts#POLICIES.alert2BadSurface',
        provenanceHash: 'sha256:21f39991452fc5905bf1de2e4d309305b2db2f5b1f98581f9632de5d6b21a2e5',
        unknownBehavior: 'hidden',
        policyRef: 'Reviewed non-racing-surface material classification',
        fixtures: fixtures('reviewed-bad-surface-policy')
      }
    ]
  }),
  family({
    id: 'blue-flag',
    ordinal: 13,
    origin: 'dedicated-widget',
    conceptIds: ['raceFlags'],
    role: 'trigger-only',
    severity: 'warning',
    rules: [
      {
        id: 'blue-flag-active',
        trigger: { kind: 'semantic', semantic: 'alert2BlueFlag' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/renderer/src/hifi/widgets/alerts2/widgets.tsx#alert2BlueFlag|app-v2/src/shared/overlay-trigger.ts#POLICIES.alert2BlueFlag',
        provenanceHash: 'sha256:062bc5fc71e52f4b166ee465358c151aafeb2389513ea045165291eb7187e2d7',
        unknownBehavior: 'hidden',
        policyRef: 'Decoded SDK blue flag is active',
        fixtures: fixtures('blue-flag-active')
      }
    ]
  }),
  family({
    id: 'tyre-temperature',
    ordinal: 14,
    origin: 'dedicated-widget',
    conceptIds: ['tyreCarcassTemperature', 'tyreSurfaceTemperature'],
    role: 'trigger-only',
    severity: 'critical',
    rules: [
      {
        id: 'configured-tyre-temperature',
        trigger: { kind: 'semantic', semantic: 'alert2TyreTempCritical' },
        temporalMode: 'level',
        thresholdSource: 'user-config',
        provenance: 'app-v2/src/renderer/src/hifi/widgets/alerts2/widgets.tsx#alert2TyreTempCritical|app-v2/src/shared/alerts.ts#AlertsConfig.tyreTemp.maxC|app-v2/src/shared/overlay-trigger.ts#hottestTyre',
        provenanceHash: 'sha256:e6891f0c72a1179f5c6b686fe23fc791532787bb462f0138b4d34ca05a88c508',
        unknownBehavior: 'hidden',
        policyRef: 'AlertsConfig.tyreTemp.maxC',
        fixtures: fixtures('configured-tyre-temperature')
      }
    ]
  }),
  family({
    id: 'brake-pressure',
    ordinal: 15,
    origin: 'dedicated-widget',
    conceptIds: ['brake', 'brakeLinePressure'],
    role: 'trigger-only',
    severity: 'critical',
    rules: [
      {
        id: 'configured-brake-pressure',
        trigger: { kind: 'semantic', semantic: 'alert2BrakePressureLow' },
        temporalMode: 'level',
        thresholdSource: 'user-config',
        provenance: 'app-v2/src/renderer/src/hifi/widgets/alerts2/widgets.tsx#alert2BrakePressureLow|app-v2/src/shared/alerts.ts#AlertsConfig.brakePressureLow|app-v2/src/shared/overlay-trigger.ts#brakePressureLow',
        provenanceHash: 'sha256:b758cba0c989906776ba22c58883841c846d0dacb1d5cc7f695dbfe22480ef01',
        unknownBehavior: 'hidden',
        policyRef: 'AlertsConfig.brakePressureLow.brakeInputMin and maxLinePressureBar',
        fixtures: fixtures('configured-brake-pressure')
      }
    ]
  }),
  family({
    id: 'semantic-pace-flags',
    ordinal: 16,
    origin: 'semantic-overlay',
    conceptIds: ['paceFlags'],
    role: 'trigger-only',
    severity: 'info',
    rules: [
      {
        id: 'pace-car-active',
        trigger: { kind: 'semantic', semantic: 'paceFlags' },
        temporalMode: 'level',
        thresholdSource: 'reviewed-policy',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.paceFlags.level',
        provenanceHash: 'sha256:d712fb3af7232ddefc8151488d81e554b94eb3280208278154a0c85211ffdb27',
        unknownBehavior: 'hidden',
        policyRef: 'SessionInfo pace car is identified and out of the pits',
        fixtures: fixtures('pace-car-active')
      },
      {
        id: 'pace-clear-hold',
        trigger: { kind: 'semantic', semantic: 'paceFlags' },
        temporalMode: 'falling',
        ttlMs: 5000,
        thresholdSource: 'reviewed-policy',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.paceFlags.clear',
        provenanceHash: 'sha256:59b0b4454904a76e9ef428fbe2696dd3d50ce4df87b0811adeb1794adf39ec77',
        unknownBehavior: 'hidden',
        policyRef: 'Hold the pace-clear phase after the pace car returns to pit road',
        fixtures: fixtures('pace-clear-hold', true)
      }
    ]
  }),
  family({
    id: 'semantic-pit-fuel-to-add',
    ordinal: 17,
    origin: 'semantic-overlay',
    conceptIds: ['pitFuelToAdd'],
    role: 'trigger-only',
    severity: 'info',
    rules: [
      {
        id: 'pit-fuel-context',
        trigger: { kind: 'semantic', semantic: 'pitFuelToAdd' },
        temporalMode: 'level',
        thresholdSource: 'reviewed-policy',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.pitFuelToAdd',
        provenanceHash: 'sha256:0632acc28ef318079d52bdcd095aeab6edcd3d86f34d26865e461a3969846355',
        unknownBehavior: 'hidden',
        policyRef: 'Show the requested fuel amount while the player is on pit road',
        sourceConstraint: 'Visibility is pit-context based; it does not assert that the requested amount is positive.',
        fixtures: fixtures('pit-fuel-context')
      }
    ]
  }),
  family({
    id: 'semantic-precipitation',
    ordinal: 18,
    origin: 'semantic-overlay',
    conceptIds: ['precipitation'],
    role: 'trigger-only',
    severity: 'warning',
    rules: [
      {
        id: 'precipitation-active',
        trigger: { kind: 'semantic', semantic: 'precipitation' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.precipitation',
        provenanceHash: 'sha256:6b1e4434621e1c7caaf832f7f4693642fec5731e4f59b637c6baec0a6aa5cbc0',
        unknownBehavior: 'hidden',
        policyRef: 'Normalized precipitation or raining state is active',
        fixtures: fixtures('precipitation-active')
      }
    ]
  }),
  family({
    id: 'semantic-repair-time',
    ordinal: 19,
    origin: 'semantic-overlay',
    conceptIds: ['repairTime'],
    role: 'trigger-only',
    severity: 'critical',
    rules: [
      {
        id: 'required-repair-active',
        trigger: { kind: 'semantic', semantic: 'repairTime' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.repairTime',
        provenanceHash: 'sha256:0c689c0f843d3be8b62fb41844ab6adfc198eeeca31ec345d859c93c22ca985a',
        unknownBehavior: 'hidden',
        policyRef: 'Required repair context is active',
        fixtures: fixtures('required-repair-active')
      }
    ]
  }),
  family({
    id: 'semantic-optional-repair-time',
    ordinal: 20,
    origin: 'semantic-overlay',
    conceptIds: ['optionalRepairTime'],
    role: 'trigger-only',
    severity: 'warning',
    rules: [
      {
        id: 'optional-repair-active',
        trigger: { kind: 'semantic', semantic: 'optionalRepairTime' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.optionalRepairTime',
        provenanceHash: 'sha256:37bb83e5e1868f1205c669773a8241263659454bb2968ad778ef8a26b6f545d1',
        unknownBehavior: 'hidden',
        policyRef: 'Optional repair context is active',
        fixtures: fixtures('optional-repair-active')
      }
    ]
  }),
  family({
    id: 'semantic-incident-counts',
    ordinal: 21,
    origin: 'semantic-overlay',
    conceptIds: ['incidentCounts'],
    role: 'trigger-only',
    severity: 'warning',
    rules: [
      {
        id: 'incident-count-active',
        trigger: { kind: 'semantic', semantic: 'incidentCounts' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.incidentCounts',
        provenanceHash: 'sha256:3cf5568974609cb8dea042699b06bf792be520092a8b7dc5ea9567be301a74ab',
        unknownBehavior: 'hidden',
        policyRef: 'A known player, team, or aggregate incident count is active',
        fixtures: fixtures('incident-count-active')
      }
    ]
  }),
  family({
    id: 'semantic-repair-requirement',
    ordinal: 22,
    origin: 'semantic-overlay',
    conceptIds: ['repairRequirement'],
    role: 'trigger-only',
    severity: 'critical',
    rules: [
      {
        id: 'repair-required',
        trigger: { kind: 'semantic', semantic: 'repairRequirement' },
        temporalMode: 'level',
        thresholdSource: 'reviewed-policy',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.repairRequirement',
        provenanceHash: 'sha256:f68e00bee381fb9b1d6ce01a2bf6168c4f85ebdbfe31e48de7dfb007f6f97221',
        unknownBehavior: 'hidden',
        policyRef: 'Normalized required or optional repair state is active',
        fixtures: fixtures('repair-required')
      }
    ]
  }),
  family({
    id: 'semantic-pit-service-status',
    ordinal: 23,
    origin: 'semantic-overlay',
    conceptIds: ['pitServiceStatus'],
    role: 'trigger-only',
    severity: 'info',
    rules: [
      {
        id: 'pit-service-active',
        trigger: { kind: 'semantic', semantic: 'pitServiceStatus' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.pitServiceStatus.level',
        provenanceHash: 'sha256:6ab195563411f12960d50b4c9755efe345e8d721779c10a9aa00ca58d6d078c8',
        unknownBehavior: 'hidden',
        policyRef: 'Player pit-service context is active',
        fixtures: fixtures('pit-service-active')
      },
      {
        id: 'pit-service-done-hold',
        trigger: { kind: 'semantic', semantic: 'pitServiceStatus' },
        temporalMode: 'falling',
        ttlMs: 4000,
        thresholdSource: 'reviewed-policy',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.pitServiceStatus.done',
        provenanceHash: 'sha256:553f2eac7c3cb2778aab96e81aba9b03ced8db6c1880ace907372a3ff3ddb2a2',
        unknownBehavior: 'hidden',
        policyRef: 'Hold service-done after pending service clears',
        fixtures: fixtures('pit-service-done-hold', true)
      }
    ]
  }),
  family({
    id: 'semantic-pits-open',
    ordinal: 24,
    origin: 'semantic-overlay',
    conceptIds: ['pitsOpen'],
    role: 'trigger-only',
    severity: 'info',
    rules: [
      {
        id: 'pits-open-pulse',
        trigger: { kind: 'semantic', semantic: 'pitsOpen' },
        temporalMode: 'rising',
        ttlMs: 5000,
        thresholdSource: 'reviewed-policy',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.pitsOpen',
        provenanceHash: 'sha256:76fce3439f83c847dca4299ac7f64c70d56061d6180e734ae918c9188e826698',
        unknownBehavior: 'hidden',
        policyRef: 'Pits-open state changes from false to true',
        fixtures: fixtures('pits-open-pulse', true)
      }
    ]
  }),
  family({
    id: 'semantic-pit-services-selected',
    ordinal: 25,
    origin: 'semantic-overlay',
    conceptIds: ['pitServicesSelected'],
    role: 'trigger-only',
    severity: 'info',
    rules: [
      {
        id: 'selected-pit-services',
        trigger: { kind: 'semantic', semantic: 'pitServicesSelected' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.pitServicesSelected',
        provenanceHash: 'sha256:217400e936a98bc5cd4c439cea4e5973d9116b2e0324f48ae91896e33433c738',
        unknownBehavior: 'hidden',
        policyRef: 'Selected pit services are shown in pit-road context',
        fixtures: fixtures('selected-pit-services')
      }
    ]
  }),
  family({
    id: 'semantic-track-wetness',
    ordinal: 26,
    origin: 'semantic-overlay',
    conceptIds: ['trackWetness'],
    role: 'trigger-only',
    severity: 'warning',
    rules: [
      {
        id: 'track-wetness-active',
        trigger: { kind: 'semantic', semantic: 'trackWetness' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.trackWetness',
        provenanceHash: 'sha256:5111edfbe501ae810e5e99687710fae4b20874a09bb2475676aa729414f45ddf',
        unknownBehavior: 'hidden',
        policyRef: 'Normalized track wetness is active',
        fixtures: fixtures('track-wetness-active')
      }
    ]
  }),
  family({
    id: 'semantic-fog-level',
    ordinal: 27,
    origin: 'semantic-overlay',
    conceptIds: ['fogLevel'],
    role: 'trigger-only',
    severity: 'warning',
    rules: [
      {
        id: 'fog-active',
        trigger: { kind: 'semantic', semantic: 'fogLevel' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.fogLevel',
        provenanceHash: 'sha256:cfa673d5167fdd1dd4d259a933ee3b3a52406a4358c9f5e323b924351d0947e0',
        unknownBehavior: 'hidden',
        policyRef: 'Normalized fog level is active',
        fixtures: fixtures('fog-active')
      }
    ]
  }),
  family({
    id: 'semantic-side-proximity',
    ordinal: 28,
    origin: 'semantic-overlay',
    conceptIds: ['proximity'],
    role: 'trigger-only',
    severity: 'warning',
    rules: [
      {
        id: 'side-proximity-active',
        trigger: { kind: 'semantic', semantic: 'sideProximity' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.sideProximity',
        provenanceHash: 'sha256:730ae68ef41a2c2ebc367ce5d177a8f7a408ccc8a7d21e2862f76a387a44abfb',
        unknownBehavior: 'hidden',
        policyRef: 'SDK CarLeftRight is not clear',
        fixtures: fixtures('side-proximity-active')
      }
    ]
  }),
  family({
    id: 'semantic-race-control-flags',
    ordinal: 29,
    origin: 'semantic-overlay',
    conceptIds: ['raceFlags'],
    role: 'trigger-only',
    severity: 'warning',
    rules: [
      {
        id: 'race-control-active',
        trigger: { kind: 'semantic', semantic: 'raceControlFlags' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.raceControlFlags',
        provenanceHash: 'sha256:4107ced5f1ab790c538efc17bcef1e9886926acf6eae45a2c1b3860cb33f34b3',
        unknownBehavior: 'hidden',
        policyRef: 'Any decoded non-green race-control flag is active',
        fixtures: fixtures('race-control-active')
      }
    ]
  }),
  family({
    id: 'semantic-drs',
    ordinal: 30,
    origin: 'semantic-overlay',
    conceptIds: ['drs'],
    role: 'trigger-only',
    severity: 'info',
    rules: [
      {
        id: 'drs-state-active',
        trigger: { kind: 'semantic', semantic: 'drs' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.drs.level',
        provenanceHash: 'sha256:3f6d6880d289e4d4e5d6f8b12fe3dee6195eb8405a25d61df5007ada7c9db5e2',
        unknownBehavior: 'hidden',
        policyRef: 'A known DRS state is available, in-zone, or active',
        fixtures: fixtures('drs-state-active')
      },
      {
        id: 'drs-deactivated-hold',
        trigger: { kind: 'semantic', semantic: 'drs' },
        temporalMode: 'falling',
        ttlMs: 5000,
        thresholdSource: 'reviewed-policy',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.drs.deactivated',
        provenanceHash: 'sha256:3123a481c394f10851d6a7cbdbc92c60deb41a0b36934191726904e41e79d95c',
        unknownBehavior: 'hidden',
        policyRef: 'Hold the DRS-deactivated phase after active state clears',
        fixtures: fixtures('drs-deactivated-hold', true)
      }
    ]
  }),
  family({
    id: 'semantic-engine-warnings',
    ordinal: 31,
    origin: 'semantic-overlay',
    conceptIds: ['engineWarnings'],
    role: 'trigger-only',
    severity: 'critical',
    rules: [
      {
        id: 'semantic-engine-warning',
        trigger: { kind: 'semantic', semantic: 'engineWarnings' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.engineWarnings',
        provenanceHash: 'sha256:9f76fc5a6635557caa9a865ad48a053b934ef361baee1b2031abe258d20933c5',
        unknownBehavior: 'hidden',
        policyRef: 'Any decoded SDK engine-warning bit is active',
        fixtures: fixtures('semantic-engine-warning')
      }
    ]
  }),
  family({
    id: 'semantic-push-to-pass',
    ordinal: 32,
    origin: 'semantic-overlay',
    conceptIds: ['pushToPassState'],
    role: 'trigger-only',
    severity: 'info',
    rules: [
      {
        id: 'push-to-pass-active',
        trigger: { kind: 'semantic', semantic: 'pushToPassState' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.pushToPassState',
        provenanceHash: 'sha256:bf567ff8a0b686366c4dadb67d4233982ef5cd26c415b2e863e11f5943a3098b',
        unknownBehavior: 'hidden',
        policyRef: 'Normalized push-to-pass state is active',
        fixtures: fixtures('push-to-pass-active')
      }
    ]
  }),
  family({
    id: 'semantic-abs-active',
    ordinal: 33,
    origin: 'semantic-overlay',
    conceptIds: ['absActive'],
    role: 'trigger-only',
    severity: 'info',
    rules: [
      {
        id: 'abs-active',
        trigger: { kind: 'semantic', semantic: 'absActive' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.absActive',
        provenanceHash: 'sha256:55480aec2162c152a0eb5a6b86221cd99526cad0add54cd3b43b15e92b88bccf',
        unknownBehavior: 'hidden',
        policyRef: 'Normalized ABS intervention is active',
        fixtures: fixtures('abs-active')
      }
    ]
  }),
  family({
    id: 'semantic-abs-cut',
    ordinal: 34,
    origin: 'semantic-overlay',
    conceptIds: ['absCut'],
    role: 'trigger-only',
    severity: 'info',
    rules: [
      {
        id: 'abs-cut-active',
        trigger: { kind: 'semantic', semantic: 'absCut' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.absCut',
        provenanceHash: 'sha256:ae9a19c0f4ec2951821c1e54ad08e64c2325221b820fbadb67f9597909e0a34b',
        unknownBehavior: 'hidden',
        policyRef: 'Normalized ABS pressure-cut state is active',
        fixtures: fixtures('abs-cut-active')
      }
    ]
  }),
  family({
    id: 'semantic-tc-active',
    ordinal: 35,
    origin: 'semantic-overlay',
    conceptIds: ['tcActive'],
    role: 'trigger-only',
    severity: 'info',
    rules: [
      {
        id: 'tc-derived-active',
        trigger: { kind: 'semantic', semantic: 'tcActive' },
        temporalMode: 'level',
        thresholdSource: 'reviewed-policy',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.tcActive|app-v2/src/shared/telemetry.ts#deriveTcActive',
        provenanceHash: 'sha256:c1d51d1179b832122d8fcb2a790267e14651d5feb43866e69651e8e109dc1a98',
        unknownBehavior: 'hidden',
        policyRef: 'Reviewed derived traction-control intervention is active',
        fixtures: fixtures('tc-derived-active')
      }
    ]
  }),
  family({
    id: 'semantic-declared-wet',
    ordinal: 36,
    origin: 'semantic-overlay',
    conceptIds: ['declaredWet'],
    role: 'trigger-only',
    severity: 'warning',
    rules: [
      {
        id: 'declared-wet-active',
        trigger: { kind: 'semantic', semantic: 'declaredWet' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.declaredWet',
        provenanceHash: 'sha256:5fbeab5d7bd8ff0821d1387e7b734f7ae05e5ff5f37a74ba823e07af7de5a1c3',
        unknownBehavior: 'hidden',
        policyRef: 'Race control declares wet weather',
        fixtures: fixtures('declared-wet-active')
      }
    ]
  }),
  family({
    id: 'semantic-pace-mode',
    ordinal: 37,
    origin: 'semantic-overlay',
    conceptIds: ['paceMode'],
    role: 'trigger-only',
    severity: 'info',
    rules: [
      {
        id: 'pace-mode-active',
        trigger: { kind: 'semantic', semantic: 'paceMode' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.paceMode',
        provenanceHash: 'sha256:9417d7fffcaa252fee5e66c77ff07cac28c4deb5d6773ead7de44073b4b3766b',
        unknownBehavior: 'hidden',
        policyRef: 'Normalized pace mode is active',
        fixtures: fixtures('pace-mode-active')
      }
    ]
  }),
  family({
    id: 'semantic-pace-formation',
    ordinal: 38,
    origin: 'semantic-overlay',
    conceptIds: ['paceFormation'],
    role: 'trigger-only',
    severity: 'info',
    rules: [
      {
        id: 'pace-formation-active',
        trigger: { kind: 'semantic', semantic: 'paceFormation' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.paceFormation',
        provenanceHash: 'sha256:9a5df7de7c27219225037db762e1c108a8d4db97be1f5a1ef855a90e9bb21571',
        unknownBehavior: 'hidden',
        policyRef: 'Pace formation is active',
        fixtures: fixtures('pace-formation-active')
      }
    ]
  }),
  family({
    id: 'semantic-on-pit-road',
    ordinal: 39,
    origin: 'semantic-overlay',
    conceptIds: ['onPitRoad'],
    role: 'trigger-only',
    severity: 'info',
    rules: [
      {
        id: 'on-pit-road-active',
        trigger: { kind: 'semantic', semantic: 'onPitRoad' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.onPitRoad',
        provenanceHash: 'sha256:2bd86bf70f643f6480d5eb8dfcf515abcfbf0f5c9456231793bb97a43cbfad60',
        unknownBehavior: 'hidden',
        policyRef: 'Player is on pit road',
        fixtures: fixtures('on-pit-road-active')
      }
    ]
  }),
  family({
    id: 'semantic-pit-limiter',
    ordinal: 40,
    origin: 'semantic-overlay',
    conceptIds: ['pitLimiter'],
    role: 'trigger-only',
    severity: 'info',
    rules: [
      {
        id: 'semantic-pit-limiter-active',
        trigger: { kind: 'semantic', semantic: 'pitLimiter' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.pitLimiter',
        provenanceHash: 'sha256:e93aed0270cfbe0fbd5e0d51ef89748f8dfc4d7e4c4c6cdf5d84ddf8332b03f4',
        unknownBehavior: 'hidden',
        policyRef: 'Normalized pit limiter is active',
        fixtures: fixtures('semantic-pit-limiter-active')
      }
    ]
  }),
  family({
    id: 'semantic-in-pit-stall',
    ordinal: 41,
    origin: 'semantic-overlay',
    conceptIds: ['inPitStall'],
    role: 'trigger-only',
    severity: 'info',
    rules: [
      {
        id: 'in-pit-stall-active',
        trigger: { kind: 'semantic', semantic: 'inPitStall' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.inPitStall',
        provenanceHash: 'sha256:1065cca01a9860f085539d8a33ad545fb668858f2a8b35953fe2429952fdedae',
        unknownBehavior: 'hidden',
        policyRef: 'Player is in the pit stall',
        fixtures: fixtures('in-pit-stall-active')
      }
    ]
  }),
  family({
    id: 'semantic-pit-stop-active',
    ordinal: 42,
    origin: 'semantic-overlay',
    conceptIds: ['pitStopActive'],
    role: 'trigger-only',
    severity: 'info',
    rules: [
      {
        id: 'pit-stop-active',
        trigger: { kind: 'semantic', semantic: 'pitStopActive' },
        temporalMode: 'level',
        thresholdSource: 'sdk',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.pitStopActive',
        provenanceHash: 'sha256:1b1b96ce470c7fdd2d94b7c7143126f7507a24b1553c77bc05f820fd650e71ec',
        unknownBehavior: 'hidden',
        policyRef: 'Normalized pit-stop state is active',
        fixtures: fixtures('pit-stop-active')
      }
    ]
  }),
  family({
    id: 'semantic-pit-tyre-targets',
    ordinal: 43,
    origin: 'semantic-overlay',
    conceptIds: ['pitTyreTargets'],
    role: 'trigger-only',
    severity: 'info',
    rules: [
      {
        id: 'pit-tyre-targets-context',
        trigger: { kind: 'semantic', semantic: 'pitTyreTargets' },
        temporalMode: 'level',
        thresholdSource: 'reviewed-policy',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.pitTyreTargets',
        provenanceHash: 'sha256:cbe8bb4f060ddd0cf7cc1de1e310d8b3b41b5c8489cb27a88a950540bed1d88d',
        unknownBehavior: 'hidden',
        policyRef: 'Pit tyre targets are shown in pit-road context',
        fixtures: fixtures('pit-tyre-targets-context')
      }
    ]
  }),
  family({
    id: 'semantic-replay-state',
    ordinal: 44,
    origin: 'semantic-overlay',
    conceptIds: ['replayState'],
    role: 'trigger-only',
    severity: 'info',
    rules: [
      {
        id: 'replay-active',
        trigger: { kind: 'semantic', semantic: 'replayState' },
        temporalMode: 'level',
        thresholdSource: 'reviewed-policy',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.replayState|app-v2/src/shared/replay.ts',
        provenanceHash: 'sha256:442b21199402572ad88d65f1bca191aa6d23a636e416442e2d758b040bff5d09',
        unknownBehavior: 'hidden',
        policyRef: 'Normalized replay context is active',
        fixtures: fixtures('replay-active')
      }
    ]
  }),
  family({
    id: 'semantic-replay-timeline',
    ordinal: 45,
    origin: 'semantic-overlay',
    conceptIds: ['replayTimeline'],
    role: 'trigger-only',
    severity: 'info',
    rules: [
      {
        id: 'replay-timeline-active',
        trigger: { kind: 'semantic', semantic: 'replayTimeline' },
        temporalMode: 'level',
        thresholdSource: 'reviewed-policy',
        provenance: 'app-v2/src/shared/overlay-trigger.ts#POLICIES.replayTimeline|app-v2/src/shared/replay.ts',
        provenanceHash: 'sha256:dba40063e973e7a6edc02941b7b5f40242f6b647061c96cf802ccd53856e1f2d',
        unknownBehavior: 'hidden',
        policyRef: 'Replay timeline is shown while replay context is active',
        fixtures: fixtures('replay-timeline-active')
      }
    ]
  })
] as const satisfies readonly TriggerOnlyFamily[])

export type TriggerOnlyFamilyId =
  (typeof TRIGGER_ONLY_FAMILY_REGISTRY)[number]['id']

const FAMILY_BY_ID = new Map<string, ReadonlyTriggerOnlyFamily>(
  TRIGGER_ONLY_FAMILY_REGISTRY.map((entry) => [entry.id, entry])
)

export function getTriggerOnlyFamily(
  id: TriggerOnlyFamilyId
): ReadonlyTriggerOnlyFamily
export function getTriggerOnlyFamily(
  id: string
): ReadonlyTriggerOnlyFamily | undefined
export function getTriggerOnlyFamily(
  id: string
): ReadonlyTriggerOnlyFamily | undefined {
  return FAMILY_BY_ID.get(id)
}

export function triggerOnlyFamiliesForConcept(
  conceptId: TelemetryCapabilityId,
  families: readonly ReadonlyTriggerOnlyFamily[] =
    TRIGGER_ONLY_FAMILY_REGISTRY
): readonly ReadonlyTriggerOnlyFamily[] {
  return freezeArrayCopy(
    families.filter((entry) => entry.conceptIds.includes(conceptId))
  )
}

export function summarizeTriggerOnlyFamilyRegistry(
  families: readonly ReadonlyTriggerOnlyFamily[] =
    TRIGGER_ONLY_FAMILY_REGISTRY
): TriggerOnlyFamilyRegistrySummary {
  return deepFreeze({
    families: families.length,
    rules: families.reduce((total, entry) => total + entry.rules.length, 0),
    dedicatedFamilies: families.filter((entry) => entry.origin === 'dedicated-widget').length,
    semanticFamilies: families.filter((entry) => entry.origin === 'semantic-overlay').length,
    temporalRules: families.flatMap((entry) => entry.rules).filter((entry) => entry.temporalMode !== 'level').length
  })
}

export const TRIGGER_ONLY_FAMILY_SUMMARY =
  summarizeTriggerOnlyFamilyRegistry()
