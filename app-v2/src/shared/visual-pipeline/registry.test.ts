import { describe, expect, it } from 'vitest'
import { COMPLEX_TELEMETRY_DESCRIPTORS } from '../../renderer/src/hifi/widgets/variants/complex-descriptors'
import { TELEMETRY_DESCRIPTORS } from '../../renderer/src/hifi/widgets/variants/descriptors'
import { SNAPSHOT_GAP_DESCRIPTORS } from '../../renderer/src/hifi/widgets/variants/snapshot-gap-descriptors'
import {
  TELEMETRY_CAPABILITY_REGISTRY,
  TELEMETRY_CAPABILITY_SUMMARY,
  TELEMETRY_REPRESENTATION_STYLES,
  filterTriggerOnlyTelemetryCapabilities,
  filterVisualizableTelemetryCapabilities,
  getTelemetryCapability,
  validateNormalizedTelemetryTags,
  validateTelemetryCapabilityTags
} from './index'

const GENERATED_DESCRIPTORS = [
  ...TELEMETRY_DESCRIPTORS,
  ...SNAPSHOT_GAP_DESCRIPTORS,
  ...COMPLEX_TELEMETRY_DESCRIPTORS
]

const TRIGGER_ONLY_IDS = [
  'engineWarnings',
  'drs',
  'pushToPassState',
  'absActive',
  'absCut',
  'tcActive',
  'replayState',
  'replayTimeline',
  'paceMode',
  'paceFlags',
  'paceFormation',
  'raceFlags',
  'proximity',
  'fogLevel',
  'trackWetness',
  'precipitation',
  'declaredWet',
  'onPitRoad',
  'pitLimiter',
  'pitServicesSelected',
  'pitTyreTargets',
  'pitFuelToAdd',
  'repairTime',
  'optionalRepairTime',
  'pitStopActive',
  'pitsOpen',
  'inPitStall',
  'pitServiceStatus',
  'repairRequirement',
  'incidentCounts'
] as const

const SEMANTIC_TRIGGER_IDS = [
  'paceFlags',
  'pitFuelToAdd',
  'precipitation',
  'repairTime',
  'optionalRepairTime',
  'incidentCounts',
  'repairRequirement',
  'pitServiceStatus',
  'pitsOpen',
  'pitServicesSelected',
  'trackWetness',
  'fogLevel',
  'sideProximity',
  'raceControlFlags',
  'drs',
  'engineWarnings',
  'pushToPassState',
  'absActive',
  'absCut',
  'tcActive',
  'declaredWet',
  'paceMode',
  'paceFormation',
  'onPitRoad',
  'pitLimiter',
  'inPitStall',
  'pitStopActive',
  'pitTyreTargets',
  'replayState',
  'replayTimeline',
  'alert2EngineWarning',
  'alert2WaterTempCritical',
  'alert2OilTempCritical',
  'alert2OilPressureLow',
  'alert2BadSurface',
  'alert2BlueFlag',
  'alert2TyreTempCritical',
  'alert2BrakePressureLow'
] as const

function semanticPolicy(
  capabilityId: string,
  semantic: string
) {
  return getTelemetryCapability(capabilityId)?.trigger.policies.find(
    (policy) =>
      policy.source.kind === 'semantic' &&
      policy.source.semantic === semantic
  )
}

describe('visual telemetry capability registry', () => {
  it('contains exactly 143 stable concepts while reporting 142 visualizable', () => {
    expect(TELEMETRY_CAPABILITY_REGISTRY).toHaveLength(143)
    expect(TELEMETRY_CAPABILITY_SUMMARY).toEqual({
      total: 143,
      visualizable: 142,
      generatedThreeVariant: 141,
      generatedRepresentations: 423,
      dedicated: 1,
      blocked: 1,
      dashboardWidget: 142,
      ordinaryOverlay: 112,
      triggerOnly: 30,
      alertCandidates: 10
    })

    const ids = TELEMETRY_CAPABILITY_REGISTRY.map(
      (capability) => capability.id
    )
    expect(new Set(ids).size).toBe(ids.length)
    expect(filterVisualizableTelemetryCapabilities()).toHaveLength(142)
    expect(getTelemetryCapability('speed')?.label).toBe('Speed')
    expect(getTelemetryCapability('not-a-capability')).toBeUndefined()
  })

  it('stays aligned with the existing 141 descriptor concepts', () => {
    expect(GENERATED_DESCRIPTORS).toHaveLength(141)

    const generated = TELEMETRY_CAPABILITY_REGISTRY.filter(
      (capability) =>
        capability.implementation.mode === 'generated-three-variant'
    )
    expect(generated.map((capability) => capability.id).sort()).toEqual(
      GENERATED_DESCRIPTORS.map((descriptor) => descriptor.id).sort()
    )

    for (const descriptor of GENERATED_DESCRIPTORS) {
      const capability = getTelemetryCapability(descriptor.id)
      expect(capability?.implementation.mode).toBe(
        'generated-three-variant'
      )
      expect(capability?.label).toBe(descriptor.label)
      expect(capability?.category).toBe(descriptor.category)
      expect(capability?.focus).toBe(descriptor.focus)
      expect(capability?.requiredSnapshotFields).toEqual(
        descriptor.requires
      )
      expect(capability?.tags).toEqual(
        expect.arrayContaining([...(descriptor.tags ?? [])])
      )
      expect(capability?.surfaces.ordinaryOverlay).toBe(
        descriptor.visibility?.role === 'alert'
          ? 'trigger-only'
          : 'supported'
      )
    }
  })

  it('keeps dedicated and blocked concepts honest', () => {
    const shiftLights = getTelemetryCapability('shiftLights')
    expect(shiftLights?.implementation).toEqual({
      mode: 'dedicated-shared-rev-lights',
      sharedModule: 'revlights'
    })
    expect(shiftLights?.surfaces).toEqual({
      dashboardWidget: 'supported',
      ordinaryOverlay: 'supported'
    })
    expect(shiftLights && 'representations' in shiftLights).toBe(false)

    const perCarSteering = getTelemetryCapability('perCarSteering')
    expect(perCarSteering?.implementation.mode).toBe('blocked')
    expect(perCarSteering?.surfaces).toEqual({
      dashboardWidget: 'blocked',
      ordinaryOverlay: 'blocked'
    })
    expect(perCarSteering?.requiredSnapshotFields).toEqual([])
    expect(perCarSteering?.rawIracingHints).toEqual(['CarIdxSteer'])
    expect(
      perCarSteering?.implementation.mode === 'blocked' &&
        perCarSteering.implementation.reason
    ).toContain('provider does not normalize')
    expect(
      perCarSteering && 'representations' in perCarSteering
    ).toBe(false)
  })

  it('exposes exactly competition, futuristic, and ddu for generated rows', () => {
    for (const capability of TELEMETRY_CAPABILITY_REGISTRY) {
      if (!('representations' in capability)) {
        expect(capability.implementation.mode).not.toBe(
          'generated-three-variant'
        )
        continue
      }

      expect(capability.implementation.mode).toBe(
        'generated-three-variant'
      )
      expect(Object.keys(capability.representations)).toEqual(
        TELEMETRY_REPRESENTATION_STYLES
      )
      expect(
        Object.values(capability.representations).every(Boolean)
      ).toBe(true)
    }
  })

  it('does not claim unsupported dashboard or ordinary-overlay surfaces', () => {
    for (const capability of TELEMETRY_CAPABILITY_REGISTRY) {
      const blocked = capability.implementation.mode === 'blocked'
      expect(
        capability.surfaces.dashboardWidget === 'blocked'
      ).toBe(blocked)
      expect(
        capability.surfaces.ordinaryOverlay === 'blocked'
      ).toBe(blocked)
      expect(
        capability.surfaces.ordinaryOverlay === 'trigger-only'
      ).toBe(capability.trigger.classification === 'trigger-only')
    }
  })

  it('classifies every evidence-backed trigger and temporal hold', () => {
    expect(
      filterTriggerOnlyTelemetryCapabilities().map(
        (capability) => capability.id
      )
    ).toEqual(TRIGGER_ONLY_IDS)

    const semanticIds = new Set(
      TELEMETRY_CAPABILITY_REGISTRY.flatMap((capability) =>
        capability.trigger.policies.flatMap((policy) =>
          policy.source.kind === 'semantic'
            ? [policy.source.semantic]
            : []
        )
      )
    )
    expect([...semanticIds].sort()).toEqual(
      [...SEMANTIC_TRIGGER_IDS].sort()
    )

    expect(semanticPolicy('paceFlags', 'paceFlags')).toMatchObject({
      mode: 'level-with-falling-hold',
      ttlMs: 5000
    })
    expect(semanticPolicy('pitsOpen', 'pitsOpen')).toMatchObject({
      mode: 'rising-edge-hold',
      ttlMs: 5000
    })
    expect(
      semanticPolicy('pitServiceStatus', 'pitServiceStatus')
    ).toMatchObject({
      mode: 'level-with-falling-hold',
      ttlMs: 4000
    })
    expect(semanticPolicy('drs', 'drs')).toMatchObject({
      mode: 'level-with-falling-hold',
      ttlMs: 5000
    })
    expect(
      semanticPolicy('pitFuelToAdd', 'pitFuelToAdd')?.predicate
    ).toContain('does not test the amount')

    const builtInKinds = new Set(
      TELEMETRY_CAPABILITY_REGISTRY.flatMap((capability) =>
        capability.trigger.policies.flatMap((policy) =>
          policy.source.kind === 'semantic'
            ? []
            : [policy.source.kind]
        )
      )
    )
    expect([...builtInKinds].sort()).toEqual([
      'lowFuel',
      'proximity',
      'shiftPoint'
    ])
  })

  it('keeps tags normalized and controlled', () => {
    for (const capability of TELEMETRY_CAPABILITY_REGISTRY) {
      expect(validateTelemetryCapabilityTags(capability)).toEqual({
        valid: true,
        duplicates: [],
        invalid: []
      })
    }

    expect(
      validateNormalizedTelemetryTags(['telemetry', 'telemetry'])
    ).toMatchObject({
      valid: false,
      duplicates: ['telemetry']
    })
    expect(
      validateNormalizedTelemetryTags([' telemetry'])
    ).toMatchObject({
      valid: false,
      invalid: [' telemetry']
    })
  })

  it('does not expose opponent steering or invented opponent controls', () => {
    const visualizable = filterVisualizableTelemetryCapabilities()
    expect(
      visualizable.some((capability) =>
        capability.rawIracingHints.includes('CarIdxSteer')
      )
    ).toBe(false)

    const opponentHints = TELEMETRY_CAPABILITY_REGISTRY.flatMap(
      (capability) => capability.rawIracingHints
    )
    expect(opponentHints).not.toContain('CarIdxThrottle')
    expect(opponentHints).not.toContain('CarIdxBrake')

    for (const capability of visualizable.filter((entry) =>
      entry.id.startsWith('perCar')
    )) {
      expect(
        capability.requiredSnapshotFields.some((field) =>
          String(field).toLowerCase().includes('steer')
        )
      ).toBe(false)
    }
  })
})
