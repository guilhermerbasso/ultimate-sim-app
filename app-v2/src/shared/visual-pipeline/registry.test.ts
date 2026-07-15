import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { COMPLEX_TELEMETRY_DESCRIPTORS } from '../../renderer/src/hifi/widgets/variants/complex-descriptors'
import { TELEMETRY_DESCRIPTORS } from '../../renderer/src/hifi/widgets/variants/descriptors'
import { SNAPSHOT_GAP_DESCRIPTORS } from '../../renderer/src/hifi/widgets/variants/snapshot-gap-descriptors'
import {
  TELEMETRY_CAPABILITY_REGISTRY,
  TELEMETRY_CAPABILITY_SUMMARY,
  TELEMETRY_REPRESENTATION_STYLES,
  TRIGGER_ONLY_FAMILY_REGISTRY,
  TRIGGER_ONLY_FAMILY_SUMMARY,
  filterVisualizableTelemetryCapabilities,
  getTelemetryCapability,
  getTriggerOnlyFamily,
  triggerOnlyFamiliesForConcept,
  validateNormalizedTelemetryTags,
  validateTelemetryCapabilityTags
} from './index'

const GENERATED_DESCRIPTORS = [
  ...TELEMETRY_DESCRIPTORS,
  ...SNAPSHOT_GAP_DESCRIPTORS,
  ...COMPLEX_TELEMETRY_DESCRIPTORS
]

const DEDICATED_TRIGGER_FAMILY_IDS = [
  'car-left',
  'car-right',
  'proximity',
  'shift-point',
  'pit-limiter',
  'race-flag',
  'low-fuel',
  'engine-warning',
  'water-temperature',
  'oil-temperature',
  'oil-pressure',
  'bad-surface',
  'blue-flag',
  'tyre-temperature',
  'brake-pressure'
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

describe('visual telemetry capability registry', () => {
  it('governs all 143 ordinary widget and overlay artifacts', () => {
    expect(TELEMETRY_CAPABILITY_REGISTRY).toHaveLength(143)
    expect(TELEMETRY_CAPABILITY_SUMMARY).toEqual({
      total: 143,
      currentlyVisualizable: 142,
      generatedThreeVariant: 141,
      generatedRepresentations: 423,
      dedicated: 1,
      unsupported: 1,
      plannedWidgets: 143,
      plannedOrdinaryOverlays: 143
    })

    const ids = TELEMETRY_CAPABILITY_REGISTRY.map(
      (capability) => capability.id
    )
    expect(new Set(ids).size).toBe(ids.length)
    expect(filterVisualizableTelemetryCapabilities()).toHaveLength(142)

    for (const capability of TELEMETRY_CAPABILITY_REGISTRY) {
      expect(capability.surfaces).toEqual({
        widget: true,
        ordinaryOverlay: true
      })
      expect('trigger' in capability).toBe(false)
      expect(capability.tags).not.toContain('trigger-only')
    }
  })

  it('stays aligned with the existing 141 generated descriptor concepts', () => {
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
    }
  })

  it('keeps shift lights visualizable and per-car steering explicitly unsupported', () => {
    const shiftLights = getTelemetryCapability('shiftLights')
    expect(shiftLights?.implementation).toEqual({
      mode: 'dedicated-shared-rev-lights',
      sharedModule: 'revlights'
    })
    expect(shiftLights?.runtime.availability).toBe('visualizable')

    const perCarSteering = getTelemetryCapability('perCarSteering')
    expect(perCarSteering?.implementation.mode).toBe(
      'unsupported-unavailable'
    )
    expect(perCarSteering?.runtime).toMatchObject({
      availability: 'unsupported',
      unavailablePresentation: 'explicit'
    })
    expect(perCarSteering?.surfaces).toEqual({
      widget: true,
      ordinaryOverlay: true
    })
    expect(perCarSteering?.requiredSnapshotFields).toEqual([])
    expect(perCarSteering?.rawIracingHints).toEqual(['CarIdxSteer'])
    expect(perCarSteering?.sourceConstraints).toEqual([
      expect.objectContaining({
        id: 'provider-normalization-missing'
      })
    ])
  })

  it('exposes exactly three representation styles only for generated rows', () => {
    for (const capability of TELEMETRY_CAPABILITY_REGISTRY) {
      if (!('representations' in capability)) {
        expect(capability.implementation.mode).not.toBe(
          'generated-three-variant'
        )
        continue
      }

      expect(Object.keys(capability.representations)).toEqual(
        TELEMETRY_REPRESENTATION_STYLES
      )
      expect(
        Object.values(capability.representations).every(Boolean)
      ).toBe(true)
    }
  })

  it('separates all dedicated and semantic alerts into trigger-only families', () => {
    expect(TRIGGER_ONLY_FAMILY_SUMMARY).toEqual({
      families: 45,
      rules: 48,
      dedicatedFamilies: 15,
      semanticFamilies: 30,
      temporalRules: 4
    })
    expect(
      TRIGGER_ONLY_FAMILY_REGISTRY.slice(0, 15).map(
        (family) => family.id
      )
    ).toEqual(DEDICATED_TRIGGER_FAMILY_IDS)
    expect(
      TRIGGER_ONLY_FAMILY_REGISTRY.map((family) => family.ordinal)
    ).toEqual(Array.from({ length: 45 }, (_, index) => index + 1))

    const familyIds = TRIGGER_ONLY_FAMILY_REGISTRY.map(
      (family) => family.id
    )
    const ruleIds = TRIGGER_ONLY_FAMILY_REGISTRY.flatMap((family) =>
      family.rules.map((rule) => rule.id)
    )
    expect(new Set(familyIds).size).toBe(familyIds.length)
    expect(new Set(ruleIds).size).toBe(ruleIds.length)

    for (const family of TRIGGER_ONLY_FAMILY_REGISTRY) {
      expect(family.role).toBe('trigger-only')
      for (const conceptId of family.conceptIds) {
        expect(getTelemetryCapability(conceptId)).toBeDefined()
      }
    }

    expect(getTriggerOnlyFamily('semantic-pace-flags')).toBeDefined()
    expect(getTriggerOnlyFamily('semantic-pits-open')).toBeDefined()
    expect(getTriggerOnlyFamily('semantic-pit-service-status')).toBeDefined()
    expect(getTriggerOnlyFamily('semantic-drs')).toBeDefined()
    expect(triggerOnlyFamiliesForConcept('raceFlags').length).toBeGreaterThan(1)
  })

  it('covers every semantic trigger without putting it on a capability', () => {
    const semanticIds = new Set(
      TRIGGER_ONLY_FAMILY_REGISTRY.flatMap((family) =>
        family.rules.flatMap((rule) =>
          rule.trigger.kind === 'semantic' && rule.trigger.semantic
            ? [rule.trigger.semantic]
            : []
        )
      )
    )
    expect([...semanticIds].sort()).toEqual(
      [...SEMANTIC_TRIGGER_IDS].sort()
    )

    expect(
      getTriggerOnlyFamily('semantic-pace-flags')?.rules
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'pace-clear-hold',
          temporalMode: 'falling',
          ttlMs: 5000
        })
      ])
    )
    expect(
      getTriggerOnlyFamily('semantic-pits-open')?.rules[0]
    ).toMatchObject({
      temporalMode: 'rising',
      ttlMs: 5000
    })
    expect(
      getTriggerOnlyFamily('semantic-pit-service-status')?.rules
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'pit-service-done-hold',
          temporalMode: 'falling',
          ttlMs: 4000
        })
      ])
    )
    expect(
      getTriggerOnlyFamily('semantic-drs')?.rules
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'drs-deactivated-hold',
          temporalMode: 'falling',
          ttlMs: 5000
        })
      ])
    )
  })

  it('requires provenance, hidden unknown behavior, temporal modes, and fixtures', () => {
    const temporalModes = new Set([
      'level',
      'rising',
      'falling',
      'pulse',
      'after-false'
    ])

    for (const family of TRIGGER_ONLY_FAMILY_REGISTRY) {
      for (const rule of family.rules) {
        expect(rule.thresholdSource).toMatch(
          /^(sdk|car-config|user-config|reviewed-policy)$/
        )
        expect(rule.unknownBehavior).toBe('hidden')
        expect(temporalModes.has(rule.temporalMode)).toBe(true)
        expect(rule.policyRef.length).toBeGreaterThan(0)
        expect(rule.provenanceHash).toBe(
          `sha256:${createHash('sha256')
            .update(rule.provenance)
            .digest('hex')}`
        )
        expect(rule.fixtures).toMatchObject({
          active: expect.any(String),
          inactive: expect.any(String),
          unknown: expect.any(String),
          disconnected: expect.any(String)
        })
        if (rule.ttlMs != null) {
          expect(rule.fixtures.held).toEqual(expect.any(String))
        }
      }
    }
  })

  it('delegates low fuel to configured laps policy without cross-unit math', () => {
    const lowFuel = getTriggerOnlyFamily('low-fuel')
    const rule = lowFuel?.rules[0]
    expect(lowFuel?.conceptIds).toEqual(['fuelLevel'])
    expect(rule?.trigger).toEqual({ kind: 'lowFuel' })
    expect(rule?.thresholdSource).toBe('user-config')
    expect(rule?.policyRef).toContain('configured laps-remaining')
    expect(rule?.sourceConstraint).toContain('unit-consistent')
    expect(rule?.trigger).not.toHaveProperty('lapsToEmpty')
    expect(JSON.stringify(rule)).not.toMatch(
      /fuelLiters\s*\/\s*fuelPerLap|litres?\s+divided\s+by\s+kg/i
    )
    expect(JSON.stringify(lowFuel)).not.toContain('fuelPerLap')
  })

  it('keeps engine-map sources distinct from throttle-map sources', () => {
    const engineMap = getTelemetryCapability('engineMap')
    const throttleMap = getTelemetryCapability('throttleMap')

    expect(engineMap?.rawIracingHints).toEqual([
      'dcFuelMixture',
      'dcEnginePower',
      'dcBoostLevel'
    ])
    expect(engineMap?.rawIracingHints).not.toContain('dcThrottleShape')
    expect(engineMap?.requiredSnapshotFields).toEqual(['engineMap'])
    expect(engineMap?.sourceConstraints).toEqual([
      expect.objectContaining({
        id: 'provider-fallback-ambiguous',
        detail: expect.stringContaining('dcThrottleShape')
      })
    ])

    expect(throttleMap?.rawIracingHints).toEqual(['dcThrottleShape'])
    expect(throttleMap?.requiredSnapshotFields).toEqual(['throttleMap'])
    expect(throttleMap?.sourceConstraints).toEqual([])
  })

  it('keeps tags controlled and opponent steering unavailable', () => {
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
      filterVisualizableTelemetryCapabilities().some((capability) =>
        capability.rawIracingHints.includes('CarIdxSteer')
      )
    ).toBe(false)
    const opponentHints = TELEMETRY_CAPABILITY_REGISTRY.flatMap(
      (capability) => capability.rawIracingHints
    )
    expect(opponentHints).not.toContain('CarIdxThrottle')
    expect(opponentHints).not.toContain('CarIdxBrake')
  })
})
