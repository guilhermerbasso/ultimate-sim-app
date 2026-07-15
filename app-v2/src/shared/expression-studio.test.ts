import { describe, expect, it } from 'vitest'
import {
  destinationStatus,
  migrateExpressionStudioPayload,
  normalizeExpressionStudioMutation,
  resolveExpressionDestinationPlacements,
  sourceBinding,
  unmappedIracingVariableReason,
  validateExpressionDestinationsForCapabilities,
  type ExpressionDestination,
  type ExpressionDestinationCapability,
  type ExpressionStudioPayload
} from './expression-studio'
import { IRACING_VARIABLES } from './iracing-vars'

const capabilities: ExpressionDestinationCapability[] = [
  {
    surface: 'dashboard',
    available: true,
    presentations: ['value', 'bar', 'gauge', 'status'],
    targets: [{ id: 'dash-exact', label: 'Race', width: 1024, height: 600, kind: 'dashboard' }]
  },
  {
    surface: 'overlay',
    available: true,
    presentations: ['value', 'bar', 'gauge', 'status'],
    targets: [{ id: 'custom:exact', label: 'HUD', width: 960, height: 320, kind: 'custom-overlay' }]
  },
  { surface: 'oled', available: false, reason: 'Deferred.', presentations: [], targets: [] },
  { surface: 'touch', available: false, reason: 'Deferred.', presentations: [], targets: [] }
]

function destination(partial: Partial<ExpressionDestination> = {}): ExpressionDestination {
  return {
    id: partial.id ?? 'dest-1',
    source: partial.source ?? { expressionId: 'expr-1' },
    surface: partial.surface ?? 'dashboard',
    targetId: partial.targetId ?? 'dash-exact',
    presentation: partial.presentation ?? 'value',
    geometry: partial.geometry ?? { x: 20, y: 20, width: 240, height: 100 },
    format: partial.format ?? { label: 'Speed', decimals: 1 },
    enabled: partial.enabled ?? true
  }
}

function mutation(overrides: Partial<ExpressionStudioPayload> = {}) {
  return {
    revision: overrides.revision ?? 0,
    expressions: overrides.expressions ?? [{ id: 'expr-1', name: 'Keep', expr: ' speedKmh * 2 ' }],
    enabledVars: overrides.enabledVars ?? ['Speed'],
    outputs: overrides.outputs ?? [],
    destinations: overrides.destinations ?? []
  }
}

describe('Expression Studio v3 migration', () => {
  it('migrates v1 atomically-shaped data without inventing destinations', () => {
    const result = migrateExpressionStudioPayload({
      version: 1,
      expressions: [{ id: 'stable-id', name: 'Fuel', expr: ' fuelLiters ' }],
      enabledVars: ['Speed', 'VelocityX']
    }, { now: '2026-07-14T00:00:00.000Z' })

    expect(result.migrated).toBe(true)
    expect(result.payload).toMatchObject({
      version: 3,
      revision: 0,
      expressions: [{ id: 'stable-id', name: 'Fuel', expr: ' fuelLiters ' }],
      enabledVars: ['Speed'],
      outputs: [],
      destinations: []
    })
  })

  it('converts every v2 legacy target into an output and never infers a visual destination', () => {
    const result = migrateExpressionStudioPayload({
      version: 2,
      expressions: [{
        id: 'expr-1',
        name: 'Alert',
        expr: 'rpm > 7000',
        outputName: 'ignored-name',
        targets: [
          { kind: 'overlay', name: 'legacy-value' },
          { kind: 'dashboard', dashboardId: 'dash-id', dashboardName: 'Dash' },
          { kind: 'serial', template: '${value}\n' },
          { kind: 'secondScreen', slot: 'main' }
        ]
      }],
      enabledVars: []
    })

    expect(result.payload.expressions).toEqual([{ id: 'expr-1', name: 'Alert', expr: 'rpm > 7000' }])
    expect(result.payload.destinations).toEqual([])
    expect(result.payload.outputs.map((output) => output.id)).toEqual([
      'expr:expr-1:overlay',
      'expr:expr-1:dashboard',
      'expr:expr-1:serial',
      'expr:expr-1:secondScreen'
    ])
    expect(result.payload.outputs.every((output) => output.source.kind === 'expression')).toBe(true)
  })

  it('disables imported outputs and destinations without changing exact target ids', () => {
    const raw = {
      version: 3,
      revision: 41,
      expressions: [{ id: 'expr-1', name: 'Alert', expr: 'rpm > 7000' }],
      enabledVars: ['Speed'],
      outputs: [{
        id: 'legacy-switch',
        name: 'Switch',
        enabled: true,
        source: { kind: 'expression', exprId: 'expr-1' },
        target: { kind: 'dashboard', dashboardId: 'missing-dash', dashboardName: 'Old name' },
        updatedAt: '2026-01-01T00:00:00.000Z'
      }],
      destinations: [destination({ targetId: 'missing-exact', enabled: true })],
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    const result = migrateExpressionStudioPayload(raw, { imported: true })

    expect(result.payload.outputs[0].enabled).toBe(false)
    expect(result.payload.destinations[0]).toMatchObject({ targetId: 'missing-exact', enabled: false })
  })

  it('preserves a mapped imported variable destination without auto-enabling the variable', () => {
    const result = migrateExpressionStudioPayload({
      version: 3,
      revision: 2,
      expressions: [],
      enabledVars: [],
      outputs: [],
      destinations: [destination({
        source: { variableId: 'Speed' },
        targetId: 'missing-exact',
        enabled: true
      })],
      updatedAt: '2026-01-01T00:00:00.000Z'
    }, { imported: true })

    expect(result.payload.enabledVars).toEqual([])
    expect(result.payload.destinations[0]).toMatchObject({
      source: { variableId: 'Speed' },
      enabled: false
    })
  })

  it('refuses to overwrite a future store version', () => {
    expect(() => migrateExpressionStudioPayload({ version: 4 })).toThrow(
      'Unsupported Expression Studio store version 4'
    )
  })
})

describe('Expression Studio v3 validation', () => {
  it('has exactly 57 visible-but-unmapped catalog fields and gives a source reason', () => {
    const unmapped = IRACING_VARIABLES.filter((item) => !item.telemetryField)
    expect(unmapped).toHaveLength(57)
    expect(unmapped.every((item) => unmappedIracingVariableReason(item.id)?.includes('no TelemetrySnapshot mapping'))).toBe(true)
  })

  it('accepts multiple destinations on the same surface but rejects duplicate destination ids', () => {
    const sameSurface = [
      destination({ id: 'one', geometry: { x: 0, y: 0, width: 200, height: 80 } }),
      destination({ id: 'two', geometry: { x: 220, y: 0, width: 200, height: 80 } })
    ]
    expect(normalizeExpressionStudioMutation(mutation({ destinations: sameSurface }), 0).destinations).toHaveLength(2)
    expect(() => normalizeExpressionStudioMutation(
      mutation({ destinations: [sameSurface[0], { ...sameSurface[1], id: 'one' }] }),
      0
    )).toThrow('duplicate id')
  })

  it('requires the exact {expressionId} or mapped {variableId} source shape', () => {
    expect(() => normalizeExpressionStudioMutation(mutation({
      destinations: [destination({
        source: { expressionId: 'expr-1', variableId: 'Speed' } as never
      })]
    }), 0)).toThrow('exactly {expressionId} or {variableId}')

    expect(() => normalizeExpressionStudioMutation(mutation({
      enabledVars: ['Speed'],
      destinations: [destination({ source: { variableId: 'VelocityX' } })]
    }), 0)).toThrow('no TelemetrySnapshot mapping')

    expect(() => normalizeExpressionStudioMutation(mutation({
      enabledVars: [],
      destinations: [destination({ source: { variableId: 'Speed' } })]
    }), 0)).toThrow('not enabled as a source')
  })

  it('validates presentation-specific format and exact target geometry', () => {
    expect(() => normalizeExpressionStudioMutation(mutation({
      destinations: [destination({ presentation: 'bar', format: { label: 'Bar', min: 100, max: 10 } })]
    }), 0)).toThrow('requires finite min < max')

    expect(() => normalizeExpressionStudioMutation(mutation({
      destinations: [destination({ presentation: 'status', format: { decimals: 2 } })]
    }), 0)).toThrow('status only supports')

    const next = normalizeExpressionStudioMutation(mutation({
      destinations: [destination({ geometry: { x: 900, y: 0, width: 200, height: 80 } })]
    }), 0)
    expect(() => validateExpressionDestinationsForCapabilities(next, capabilities)).toThrow('exceeds target')

    const unavailable = normalizeExpressionStudioMutation(mutation({
      destinations: [destination({ surface: 'oled', targetId: 'slot-1' })]
    }), 0)
    expect(() => validateExpressionDestinationsForCapabilities(unavailable, capabilities)).toThrow('Deferred')
  })

  it('rejects stale revisions', () => {
    expect(() => normalizeExpressionStudioMutation(mutation({ revision: 2 }), 3)).toThrow(
      'EXPRESSION_REVISION_CONFLICT'
    )
  })
})

describe('Expression destination resolver', () => {
  it('uses only expr:#id or exact ir variable bindings', () => {
    expect(sourceBinding({ expressionId: 'stable' })).toBe('expr:#stable')
    expect(sourceBinding({ variableId: 'Speed' })).toBe('ir:Speed')
  })

  it('resolves exact targets and supported value/bar/gauge/status placements', () => {
    const payload = normalizeExpressionStudioMutation(mutation({
      destinations: [
        destination({ id: 'value', presentation: 'value' }),
        destination({ id: 'bar', presentation: 'bar', format: { label: 'Bar', min: 0, max: 300 } }),
        destination({ id: 'gauge', presentation: 'gauge', format: { label: 'Gauge', min: 0, max: 300 } }),
        destination({ id: 'status', presentation: 'status', format: { label: 'Warn', trueText: 'WARN', falseText: 'OK' } })
      ]
    }), 0)
    const placements = resolveExpressionDestinationPlacements(payload, capabilities, {
      surface: 'dashboard',
      targetId: 'dash-exact'
    })

    expect(placements.map((item) => item.element.type)).toEqual(['value', 'valuebar', 'valuegauge', 'statuslamp'])
    expect(placements.every((item) => item.element.binding === 'expr:#expr-1')).toBe(true)
  })

  it('keeps a missing exact target unresolved and never falls back by label', () => {
    const unresolved = destination({ targetId: 'Race' })
    expect(destinationStatus(unresolved, capabilities)).toEqual({
      destinationId: 'dest-1',
      status: 'unresolved',
      reason: 'Exact dashboard target "Race" is missing.'
    })
  })
})
