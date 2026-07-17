import { describe, expect, it } from 'vitest'
import curatedFeed from '../../resources/raceops/curated-feed.json'
import {
  RACEOPS_BLUEPRINT_SCHEMA_VERSION,
  assertRaceOpsAppVersionCompatible,
  canonicalJson,
  dryRunRaceOpsBlueprint,
  migrateRaceOpsBlueprintManifest,
  parseRaceOpsBlueprintManifest,
  parseSignedRaceOpsBlueprintFeed,
  resolveRaceOpsBlueprintParameters
} from './raceops-blueprints'

function manifests() {
  return parseSignedRaceOpsBlueprintFeed(curatedFeed).payload.entries.map((entry) => entry.manifest)
}

describe('RaceOps declarative blueprints', () => {
  it('produces deterministic traces that match the signed fixtures', () => {
    for (const manifest of manifests()) {
      const first = dryRunRaceOpsBlueprint(manifest)
      const second = dryRunRaceOpsBlueprint(manifest)
      expect(first.matchesExpected, manifest.id).toBe(true)
      expect(second).toEqual(first)
      expect(canonicalJson(first.trace)).toBe(canonicalJson(first.expectedTrace))
    }
  })

  it('keeps parameterized fixture traces deterministic across constrained wizard values', () => {
    const pitWindow = manifests().find((manifest) => manifest.id === 'pit-window-readiness')
    const yellow = manifests().find((manifest) => manifest.id === 'yellow-flag-coordination')
    expect(pitWindow).toBeDefined()
    expect(yellow).toBeDefined()
    if (!pitWindow || !yellow) return

    const pitResult = dryRunRaceOpsBlueprint(pitWindow, {
      'pit-window-laps': 7,
      'require-window-open': false,
      'strategy-mode': 'driver-reminder'
    })
    expect(pitResult.matchesExpected).toBe(true)
    expect(pitResult.trace[0].payload).toMatchObject({ actual: 7, expected: 7 })
    expect(pitResult.trace[1].payload.message).toContain('driver-reminder')

    const yellowResult = dryRunRaceOpsBlueprint(yellow, { procedure: 'prepare-slow-zone' })
    expect(yellowResult.matchesExpected).toBe(true)
    expect(yellowResult.trace[1].payload.message).toContain('prepare-slow-zone')
  })

  it('migrates the supported v1 manifest shape to v2', () => {
    const current = manifests()[0]
    const legacy = {
      schemaVersion: 1,
      id: current.id,
      version: current.version,
      title: current.title,
      summary: current.summary,
      author: current.author,
      minimumAppVersion: current.compatibility.app.min,
      maximumAppVersion: current.compatibility.app.max,
      capabilities: current.capabilities,
      parameters: current.parameters,
      recipe: current.workflow,
      fixture: current.fixture,
      expectedTrace: current.expectedTrace
    }
    const migrated = migrateRaceOpsBlueprintManifest(legacy) as { schemaVersion: number }
    expect(migrated.schemaVersion).toBe(RACEOPS_BLUEPRINT_SCHEMA_VERSION)
    expect(parseRaceOpsBlueprintManifest(legacy)).toEqual(current)
  })

  it('fails closed on unknown manifest, runtime, feed, and signature versions', () => {
    const manifest = structuredClone(manifests()[0]) as unknown as Record<string, unknown>
    manifest.schemaVersion = 99
    expect(() => parseRaceOpsBlueprintManifest(manifest)).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_VERSION' })
    )

    const runtime = structuredClone(manifests()[0])
    ;(runtime.compatibility as { runtime: number }).runtime = 99
    expect(() => parseRaceOpsBlueprintManifest(runtime)).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_VERSION' })
    )

    const feedVersion = structuredClone(curatedFeed)
    feedVersion.payload.schemaVersion = 99
    expect(() => parseSignedRaceOpsBlueprintFeed(feedVersion)).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_VERSION' })
    )

    const signature = structuredClone(curatedFeed)
    ;(signature.signature as { algorithm: string }).algorithm = 'rsa'
    expect(() => parseSignedRaceOpsBlueprintFeed(signature)).toThrowError(
      expect.objectContaining({ code: 'UNKNOWN_SIGNATURE' })
    )
  })

  it('rejects unknown and undeclared capabilities before dry-run', () => {
    const unknown = structuredClone(manifests()[0]) as unknown as {
      capabilities: string[]
    }
    unknown.capabilities = [...unknown.capabilities, 'process.spawn']
    expect(() => parseRaceOpsBlueprintManifest(unknown)).toThrowError(
      expect.objectContaining({ code: 'UNKNOWN_CAPABILITY' })
    )

    const undeclared = structuredClone(manifests()[0])
    undeclared.capabilities = undeclared.capabilities.filter(
      (capability) => capability !== 'telemetry.session.read'
    )
    expect(() => parseRaceOpsBlueprintManifest(undeclared)).toThrowError(
      expect.objectContaining({ code: 'UNDECLARED_ACCESS' })
    )
  })

  it('rejects arbitrary-code fields instead of ignoring them', () => {
    const manifest = structuredClone(manifests()[0]) as unknown as Record<string, unknown>
    manifest.script = 'console.log("community code")'
    expect(() => parseRaceOpsBlueprintManifest(manifest)).toThrow(/unsupported fields/i)
  })

  it('enforces app ranges and constrained wizard parameters', () => {
    const pitWindow = manifests().find((manifest) => manifest.id === 'pit-window-readiness')
    expect(pitWindow).toBeDefined()
    if (!pitWindow) return

    expect(() => assertRaceOpsAppVersionCompatible(pitWindow, '2.53.1')).not.toThrow()
    expect(() => assertRaceOpsAppVersionCompatible(pitWindow, '3.0.0')).toThrowError(
      expect.objectContaining({ code: 'INCOMPATIBLE_APP' })
    )
    expect(() =>
      resolveRaceOpsBlueprintParameters(pitWindow, { 'pit-window-laps': 11 })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_PARAMETER' }))
    expect(() =>
      resolveRaceOpsBlueprintParameters(pitWindow, { undeclared: true })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_PARAMETER' }))
  })
})
