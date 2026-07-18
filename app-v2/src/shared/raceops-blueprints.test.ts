import { describe, expect, it } from 'vitest'
import curatedFeed from '../../resources/raceops/curated-feed.json'
import {
  RACEOPS_BLUEPRINT_SCHEMA_VERSION,
  assertRaceOpsAppVersionCompatible,
  canonicalJson,
  compareRaceOpsSemver,
  createRaceOpsBlueprintSelectionRequest,
  dryRunRaceOpsBlueprint,
  fingerprintRaceOpsBlueprintRequest,
  migrateRaceOpsBlueprintManifest,
  parseRaceOpsBlueprintManifest,
  parseRaceOpsRfc3339,
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

describe('RaceOps standards and operation identity', () => {
  it('implements SemVer 2.0.0 prerelease precedence and ignores build metadata', () => {
    const precedence = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0'
    ]
    for (let index = 1; index < precedence.length; index += 1) {
      expect(compareRaceOpsSemver(precedence[index - 1], precedence[index])).toBeLessThan(0)
    }
    expect(compareRaceOpsSemver('1.0.0+build.1', '1.0.0+build.99')).toBe(0)
    expect(compareRaceOpsSemver('999999999999999999999.0.0', '2.0.0')).toBeGreaterThan(0)
  })

  it('rejects non-compliant SemVer forms', () => {
    for (const invalid of ['01.0.0', '1.0', '1.0.0-alpha.01', '1.0.0-', ' 1.0.0']) {
      expect(() => compareRaceOpsSemver(invalid, '1.0.0'), invalid).toThrow(
        /SemVer|leading zero|exact non-empty/
      )
    }
  })

  it('accepts strict RFC3339 offsets and rejects normalized or timezone-less dates', () => {
    expect(parseRaceOpsRfc3339('2026-07-18T10:00:00Z')).toBe(
      parseRaceOpsRfc3339('2026-07-18T07:00:00-03:00')
    )
    expect(parseRaceOpsRfc3339('2016-12-31T23:59:60Z')).toBe(
      parseRaceOpsRfc3339('2017-01-01T00:00:00Z')
    )
    for (const invalid of [
      '2026-02-30T10:00:00Z',
      '2026-07-18 10:00:00Z',
      '2026-07-18T10:00:00',
      '2026-07-18T24:00:00Z',
      '2026-07-18T10:00:00+24:00',
      '2026-07-18T10:00:60Z',
      ' 2026-07-18T10:00:00Z'
    ]) {
      expect(() => parseRaceOpsRfc3339(invalid), invalid).toThrow(
        /RFC3339|calendar|component|exact non-empty|leap second/
      )
    }
    const invalidFeed = structuredClone(curatedFeed)
    invalidFeed.payload.issuedAt = '2026-02-30T10:00:00Z'
    expect(() => parseSignedRaceOpsBlueprintFeed(invalidFeed)).toThrow(/calendar/)
  })

  it('binds request fingerprints to exact version, manifest hash, and parameters', () => {
    const identity = {
      feedId: 'feed',
      blueprintId: 'blueprint',
      blueprintVersion: '1.0.0',
      manifestSha256: 'a'.repeat(64)
    }
    const request = createRaceOpsBlueprintSelectionRequest(identity, { b: true, a: 2 })
    expect(request.requestFingerprint).toBe(
      fingerprintRaceOpsBlueprintRequest({ ...identity, parameters: { a: 2, b: true } })
    )
    expect(
      createRaceOpsBlueprintSelectionRequest(
        { ...identity, blueprintVersion: '1.0.1' },
        { a: 2, b: true }
      ).requestFingerprint
    ).not.toBe(request.requestFingerprint)
    expect(
      createRaceOpsBlueprintSelectionRequest(
        { ...identity, manifestSha256: 'b'.repeat(64) },
        { a: 2, b: true }
      ).requestFingerprint
    ).not.toBe(request.requestFingerprint)
    expect(
      createRaceOpsBlueprintSelectionRequest(identity, { a: 3, b: true }).requestFingerprint
    ).not.toBe(request.requestFingerprint)
  })
})
