import { describe, expect, it } from 'vitest'
import type { ActionBinding } from './actions'
import { DEFAULT_ALERTS_CONFIG, type AlertsConfig } from './alerts'
import { DEFAULT_COACH_CONFIG } from './coach'
import {
  analyzeContextDebt,
  DEFAULT_CONTEXT_DEBT_THRESHOLDS,
  fingerprintContextDebtDecisionState,
  previewContextDebtSuggestions,
  reconcileContextDebtPreviewSelection,
  selectContextDebtProfileSnapshot,
  updateContextDebtThreshold,
  type ContextDebtAnalysisInput,
  type ContextDebtReport,
  type ContextDebtSourceFamily
} from './context-debt'
import { DEFAULT_ENGINEER_CONFIG } from './engineer-ipc'
import { DEFAULT_HAPTICS_CONFIG } from './haptics'
import { DEFAULT_HAPTICS_ZONAL_CONFIG } from './haptics-zonal'
import { createDefaultOverlaysConfig, type OverlaysConfig } from './overlays'
import type { RaceProfile } from './raceprofiles'
import { DEFAULT_SPOTTER_CONFIG } from './spotter'
import { DEFAULT_SPOTTER_3D_CONFIG } from './spotter3d'
import { DEFAULT_SOUNDS_CONFIG } from './soundshift'

const ALL_SOURCES: Partial<Record<ContextDebtSourceFamily, boolean>> = {
  alerts: true,
  overlays: true,
  sounds: true,
  haptics: true,
  zonalHaptics: true,
  controls: true,
  spotter: true,
  spotter3d: true,
  engineer: true,
  coach: true
}

function disabledAlerts(): AlertsConfig {
  return {
    ...DEFAULT_ALERTS_CONFIG,
    audioEnabled: false,
    pitLimiter: { ...DEFAULT_ALERTS_CONFIG.pitLimiter, enabled: false },
    flags: { ...DEFAULT_ALERTS_CONFIG.flags, enabled: false },
    lowFuel: { ...DEFAULT_ALERTS_CONFIG.lowFuel, enabled: false },
    shiftPoint: { ...DEFAULT_ALERTS_CONFIG.shiftPoint, enabled: false },
    incidentLimit: { ...DEFAULT_ALERTS_CONFIG.incidentLimit, enabled: false },
    tyrePressure: { ...DEFAULT_ALERTS_CONFIG.tyrePressure!, enabled: false },
    tyreTemp: { ...DEFAULT_ALERTS_CONFIG.tyreTemp!, enabled: false },
    brakeTemp: { ...DEFAULT_ALERTS_CONFIG.brakeTemp!, enabled: false },
    drsAvailable: { ...DEFAULT_ALERTS_CONFIG.drsAvailable!, enabled: false },
    blueFlag: { ...DEFAULT_ALERTS_CONFIG.blueFlag!, enabled: false }
  }
}

function baseInput(patch: Partial<ContextDebtAnalysisInput> = {}): ContextDebtAnalysisInput {
  return {
    profile: { key: 'live', name: 'Live', source: 'live' },
    alerts: disabledAlerts(),
    overlays: createDefaultOverlaysConfig(),
    sounds: {
      ...DEFAULT_SOUNDS_CONFIG,
      soundshift: { ...DEFAULT_SOUNDS_CONFIG.soundshift, enabled: false },
      incident: { ...DEFAULT_SOUNDS_CONFIG.incident, enabled: false },
      abs: { ...DEFAULT_SOUNDS_CONFIG.abs, enabled: false },
      tcs: { ...DEFAULT_SOUNDS_CONFIG.tcs, enabled: false }
    },
    haptics: { ...DEFAULT_HAPTICS_CONFIG, enabled: false },
    zonalHaptics: { ...DEFAULT_HAPTICS_ZONAL_CONFIG, enabled: false },
    bindings: [],
    spotter: { ...DEFAULT_SPOTTER_CONFIG, enabled: false },
    spotter3d: { ...DEFAULT_SPOTTER_3D_CONFIG, enabled: false },
    engineer: { ...DEFAULT_ENGINEER_CONFIG, enabled: false },
    coach: { ...DEFAULT_COACH_CONFIG, enabled: false },
    sourceAvailability: ALL_SOURCES,
    devices: {
      audioOutputIds: [],
      serialDeviceIds: [],
      displayIds: [],
      gamepadIds: [],
      scanStatus: { audio: 'success', serial: 'success', display: 'success', gamepad: 'success' }
    },
    ...patch
  }
}

describe('SP-07 context-debt analysis', () => {
  it('preserves every critical cue in generated plans and blocks a malicious preview', () => {
    const alerts = disabledAlerts()
    alerts.audioEnabled = true
    alerts.lowFuel = { ...alerts.lowFuel, enabled: true, severity: 'critical' }
    const report = analyzeContextDebt(baseInput({
      alerts,
      thresholds: { maxRoutesPerCue: 1, maxAudioRoutes: 0 }
    }))

    const criticalIds = new Set(report.routes.filter((route) => route.critical).map((route) => route.id))
    expect(criticalIds.size).toBeGreaterThan(0)
    for (const suggestion of report.suggestions) {
      expect(suggestion.routeIds.some((id) => criticalIds.has(id))).toBe(false)
    }

    const preview = previewContextDebtSuggestions(report, report.suggestions.map((suggestion) => suggestion.id))
    expect(preview.criticalDrops).toBe(0)
    expect(preview.criticalRoutesAfter).toBe(preview.criticalRoutesBefore)
    expect(preview.safe).toBe(true)

    const criticalRouteId = [...criticalIds][0]
    const malicious: ContextDebtReport = {
      ...report,
      suggestions: [
        ...report.suggestions,
        {
          id: 'malicious',
          kind: 'trim-cue',
          signalId: 'fuel',
          routeIds: [criticalRouteId],
          navigateTo: 'alerts',
          estimatedRouteReduction: 1,
          reversible: true,
          details: {}
        }
      ]
    }
    const blocked = previewContextDebtSuggestions(malicious, ['malicious'])
    expect(blocked.blockedCriticalRoutes.map((route) => route.id)).toContain(criticalRouteId)
    expect(blocked.criticalDrops).toBe(0)
    expect(blocked.safe).toBe(false)
  })

  it('treats flag routes as critical even when their configured severity is warning', () => {
    const alerts = disabledAlerts()
    alerts.flags = { enabled: true, severity: 'warning' }
    const report = analyzeContextDebt(baseInput({ alerts }))

    const flagRoutes = report.routes.filter((route) => route.signalId === 'flags')
    expect(flagRoutes.length).toBeGreaterThan(0)
    expect(flagRoutes.every((route) => route.critical)).toBe(true)
    expect(report.suggestions.flatMap((suggestion) => suggestion.routeIds))
      .not.toContain(flagRoutes[0].id)
  })

  it('locks blue flags and semantic critical overlays regardless of numeric priority', () => {
    const callouts = Object.fromEntries(
      Object.entries(DEFAULT_SPOTTER_CONFIG.callouts).map(([id, config]) => [
        id,
        { ...config, enabled: id === 'flag.blue', priority: 1 }
      ])
    ) as typeof DEFAULT_SPOTTER_CONFIG.callouts
    const overlays = createDefaultOverlaysConfig()
    overlays.widgets.customValue = {
      ...overlays.widgets.customValue,
      enabled: true,
      role: 'ordinary',
      trigger: { kind: 'semantic', semantic: 'alert2OilPressureLow' }
    }
    const report = analyzeContextDebt(baseInput({
      overlays,
      spotter: { ...DEFAULT_SPOTTER_CONFIG, enabled: true, muted: false, callouts },
      thresholds: { maxAudioRoutes: 0, maxOverlays: 0 }
    }))

    const locked = report.routes.filter((route) =>
      route.signalId === 'blue-flag' || route.signalId === 'oil-pressure-low'
    )
    expect(locked).toHaveLength(2)
    expect(locked.every((route) => route.critical)).toBe(true)
    const suggested = new Set(report.suggestions.flatMap((suggestion) => suggestion.routeIds))
    expect(locked.every((route) => !suggested.has(route.id))).toBe(true)
  })

  it('classifies overlay ids by exact metadata and whole tokens without substring collisions', () => {
    const overlays = createDefaultOverlaysConfig()
    overlays.widgets.engineerFeed = { ...overlays.widgets.engineerFeed, enabled: true }
    const base = overlays.widgets.customValue
    const customOverlay = (
      id: string
    ): OverlaysConfig['customOverlays'][number] => ({
      ...base,
      id,
      title: id,
      enabled: true,
      elements: []
    })
    overlays.customOverlays = [
      customOverlay('custom:absolute-timing'),
      customOverlay('custom:watch-panel'),
      customOverlay('custom:flagship-store'),
      customOverlay('custom:refuelish'),
      customOverlay('custom:brake-temp-warning'),
      customOverlay('custom:tc-warning')
    ]

    const report = analyzeContextDebt(baseInput({ overlays }))
    const signals = Object.fromEntries(
      report.routes
        .filter((route) => route.source === 'overlay')
        .map((route) => [route.sourceId, route.signalId])
    )

    expect(signals).toMatchObject({
      engineerFeed: 'overlay-engineerfeed',
      'custom:absolute-timing': 'overlay-custom-absolute-timing',
      'custom:watch-panel': 'overlay-custom-watch-panel',
      'custom:flagship-store': 'overlay-custom-flagship-store',
      'custom:refuelish': 'overlay-custom-refuelish',
      'custom:brake-temp-warning': 'brake-temperature',
      'custom:tc-warning': 'traction-control'
    })
  })

  it('reports configured routes that target an unknown device without disabling them', () => {
    const report = analyzeContextDebt(baseInput({
      sounds: {
        ...DEFAULT_SOUNDS_CONFIG,
        outputDeviceId: 'missing-headset',
        soundshift: { ...DEFAULT_SOUNDS_CONFIG.soundshift, enabled: true }
      }
    }))

    expect(report.counts.unknownDevices).toBe(1)
    expect(report.issues).toContainEqual(expect.objectContaining({
      kind: 'unknown-device',
      details: expect.objectContaining({ deviceId: 'missing-headset', kind: 'audio' })
    }))
    const repair = report.suggestions.find((suggestion) => suggestion.kind === 'repair-device')
    expect(repair?.routeIds).toEqual([])
    expect(repair?.navigateTo).toBe('sounds')
  })

  it('detects duplicate routes and previews removal of only the extra copy', () => {
    const alerts = disabledAlerts()
    alerts.shiftPoint = {
      ...alerts.shiftPoint,
      enabled: true,
      outputs: [
        { kind: 'secondScreen', enabled: true, slot: 'race-warning' },
        { kind: 'secondScreen', enabled: true, slot: 'race-warning' }
      ]
    }
    const report = analyzeContextDebt(baseInput({ alerts }))

    expect(report.counts.duplicateRoutes).toBe(1)
    const duplicate = report.issues.find((issue) => issue.kind === 'duplicate-route')
    expect(duplicate?.routeIds).toHaveLength(2)
    const suggestion = report.suggestions.find((candidate) => candidate.kind === 'dedupe-route')
    expect(suggestion?.routeIds).toHaveLength(1)
    const preview = previewContextDebtSuggestions(report, [suggestion!.id])
    expect(preview.removedRoutes).toHaveLength(1)
    expect(preview.criticalDrops).toBe(0)
  })

  it('resets safe preview state when the selected profile or its fingerprint changes', () => {
    const first = analyzeContextDebt(baseInput({
      profile: { key: 'race:a', name: 'A', source: 'race-profile' }
    }))
    const current = {
      profileKey: first.profile.key,
      fingerprint: first.fingerprint,
      suggestionId: 'trim-audio:threshold'
    }
    expect(reconcileContextDebtPreviewSelection(current, first)).toBe(current)

    const second = analyzeContextDebt(baseInput({
      profile: { key: 'race:b', name: 'B', source: 'race-profile' }
    }))
    expect(reconcileContextDebtPreviewSelection(current, second)).toEqual({
      profileKey: 'race:b',
      fingerprint: second.fingerprint,
      suggestionId: null
    })

    const changed = analyzeContextDebt(baseInput({
      profile: { key: 'race:a', name: 'A', source: 'race-profile' },
      sounds: {
        ...DEFAULT_SOUNDS_CONFIG,
        soundshift: { ...DEFAULT_SOUNDS_CONFIG.soundshift, enabled: true }
      }
    }))
    expect(reconcileContextDebtPreviewSelection(current, changed).suggestionId).toBeNull()
  })

  it('uses saved profile snapshots without mutating the live configuration', () => {
    const liveAlerts = disabledAlerts()
    const profileAlerts = { ...disabledAlerts(), flags: { enabled: true } }
    const liveOverlays = createDefaultOverlaysConfig()
    const profileOverlays = createDefaultOverlaysConfig()
    profileOverlays.widgets.revlights = { ...profileOverlays.widgets.revlights, enabled: true }
    const liveBindings: ActionBinding[] = []
    const profileBindings: ActionBinding[] = [{
      id: 'profile-action',
      label: 'Profile action',
      enabled: true,
      control: { source: 'gamepad', buttonIndex: 2 },
      action: { type: 'app', command: { name: 'dash:cycleNext' } },
      createdAt: '2026-07-17T00:00:00.000Z',
      updatedAt: '2026-07-17T00:00:00.000Z'
    }]
    const profile: RaceProfile = {
      id: 'race-a',
      name: 'Race A',
      alerts: profileAlerts,
      overlays: profileOverlays,
      bindings: profileBindings,
      hapticsGains: { engine: 0.25 }
    }
    const liveHaptics = {
      ...DEFAULT_HAPTICS_CONFIG,
      effects: {
        ...DEFAULT_HAPTICS_CONFIG.effects,
        engine: { ...DEFAULT_HAPTICS_CONFIG.effects.engine, intensity: 0.75 }
      }
    }
    const selected = selectContextDebtProfileSnapshot(
      { alerts: liveAlerts, overlays: liveOverlays, bindings: liveBindings, haptics: liveHaptics },
      profile
    )

    expect(selected.alerts).toEqual(profileAlerts)
    expect(selected.alerts).not.toBe(profileAlerts)
    expect(selected.overlays).toEqual(profileOverlays)
    expect(selected.overlays).not.toBe(profileOverlays)
    expect(selected.bindings).toStrictEqual(profileBindings)
    expect(selected.bindings).not.toBe(profileBindings)
    expect(selected.haptics?.effects.engine.intensity).toBe(0.25)
    expect(liveHaptics.effects.engine.intensity).toBe(0.75)
    expect(liveAlerts.flags.enabled).toBe(false)
    expect(liveBindings).toEqual([])
  })

  it('falls back to live data when an imported profile snapshot is malformed', () => {
    const liveOverlays = createDefaultOverlaysConfig()
    const liveAlerts = disabledAlerts()
    const selected = selectContextDebtProfileSnapshot(
      { overlays: liveOverlays, alerts: liveAlerts, bindings: [] },
      {
        id: 'broken',
        name: 'Broken import',
        overlays: { widgets: null },
        alerts: { audioEnabled: true },
        bindings: [{ enabled: true }]
      } as unknown as RaceProfile
    )

    expect(selected.overlays).toBe(liveOverlays)
    expect(selected.alerts).toBe(liveAlerts)
    expect(selected.bindings).toEqual([])
  })

  it('falls back atomically when a nested profile snapshot contains unsafe route data', () => {
    const liveAlerts = disabledAlerts()
    const liveOverlays = createDefaultOverlaysConfig()
    const selected = selectContextDebtProfileSnapshot(
      { alerts: liveAlerts, overlays: liveOverlays, bindings: [] },
      {
        id: 'nested-broken',
        name: 'Nested broken import',
        alerts: {
          ...disabledAlerts(),
          flags: {
            enabled: true,
            outputs: [{ kind: 'serial', template: 123 }]
          }
        },
        overlays: {
          ...createDefaultOverlaysConfig(),
          customOverlays: [{
            id: 'custom:unsafe',
            enabled: true,
            trigger: { kind: 'semantic', semantic: 42 }
          }]
        },
        bindings: [{
          id: 'unsafe-binding',
          enabled: true,
          control: { source: 'gamepad', buttonIndex: Number.NaN },
          action: { type: 'app', command: { name: 'dash:cycleNext' } }
        }]
      } as unknown as RaceProfile
    )

    expect(selected.alerts).toBe(liveAlerts)
    expect(selected.overlays).toBe(liveOverlays)
    expect(selected.bindings).toEqual([])
    expect(() => analyzeContextDebt(baseInput(selected))).not.toThrow()
  })

  it('treats thresholds as explicit boundaries rather than universal limits', () => {
    const sounds = {
      ...DEFAULT_SOUNDS_CONFIG,
      soundshift: { ...DEFAULT_SOUNDS_CONFIG.soundshift, enabled: true },
      incident: { ...DEFAULT_SOUNDS_CONFIG.incident, enabled: true }
    }
    const atBoundary = analyzeContextDebt(baseInput({
      sounds,
      thresholds: { maxAudioRoutes: 2 }
    }))
    expect(atBoundary.issues.some((issue) =>
      issue.kind === 'threshold-exceeded' && issue.details.metric === 'audio'
    )).toBe(false)

    const overBoundary = analyzeContextDebt(baseInput({
      sounds,
      thresholds: { maxAudioRoutes: 1 }
    }))
    expect(overBoundary.issues).toContainEqual(expect.objectContaining({
      kind: 'threshold-exceeded',
      details: expect.objectContaining({ metric: 'audio', actual: 2, limit: 1 })
    }))
  })

  it('normalizes every threshold update before it becomes UI or analysis state', () => {
    const routesClamped = updateContextDebtThreshold(
      DEFAULT_CONTEXT_DEBT_THRESHOLDS,
      'maxRoutesPerCue',
      -50
    )
    const audioClamped = updateContextDebtThreshold(
      routesClamped,
      'maxAudioRoutes',
      999
    )
    const invalidFallsBack = updateContextDebtThreshold(
      audioClamped,
      'maxOverlays',
      Number.NaN
    )
    const scoreClamped = updateContextDebtThreshold(
      invalidFallsBack,
      'warningScore',
      100
    )

    expect(routesClamped.maxRoutesPerCue).toBe(1)
    expect(audioClamped.maxAudioRoutes).toBe(60)
    expect(invalidFallsBack.maxOverlays).toBe(DEFAULT_CONTEXT_DEBT_THRESHOLDS.maxOverlays)
    expect(scoreClamped.highScore).toBeGreaterThan(scoreClamped.warningScore)
  })

  it('labels the meter incomplete when any configured evidence source is unavailable', () => {
    const report = analyzeContextDebt(baseInput({
      sourceAvailability: { ...ALL_SOURCES, overlays: false }
    }))
    expect(report.band).toBe('incomplete')
    expect(report.missingSources).toEqual(['overlays'])
  })

  it('keeps failed hardware scans incomplete instead of claiming devices are absent', () => {
    const report = analyzeContextDebt(baseInput({
      sounds: {
        ...DEFAULT_SOUNDS_CONFIG,
        outputDeviceId: 'unverified-headset',
        soundshift: { ...DEFAULT_SOUNDS_CONFIG.soundshift, enabled: true }
      },
      devices: {
        audioOutputIds: [],
        serialDeviceIds: [],
        displayIds: [],
        gamepadIds: [],
        scanStatus: { audio: 'failed', serial: 'success', display: 'success', gamepad: 'success' }
      }
    }))

    expect(report.band).toBe('incomplete')
    expect(report.incompleteScans).toEqual(['audio'])
    expect(report.issues).toContainEqual(expect.objectContaining({
      kind: 'scan-incomplete',
      details: expect.objectContaining({ kind: 'audio', status: 'failed' })
    }))
    expect(report.issues.some((issue) => issue.kind === 'unknown-device')).toBe(false)
  })

  it('mirrors physical input identity with index while ignoring switch interpretation', () => {
    const bindings: ActionBinding[] = [
      {
        id: 'a',
        label: 'A',
        enabled: true,
        control: { source: 'gamepad', gamepadId: 'wheel', gamepadIndex: 0, buttonIndex: 1, switchType: 'momentary' },
        action: { type: 'app', command: { name: 'dash:cycleNext' } },
        createdAt: '2026-07-17T00:00:00.000Z',
        updatedAt: '2026-07-17T00:00:00.000Z'
      },
      {
        id: 'b',
        label: 'B',
        enabled: true,
        control: { source: 'gamepad', gamepadId: 'wheel', gamepadIndex: 0, buttonIndex: 1, switchType: 'toggle' },
        action: { type: 'app', command: { name: 'dash:cyclePrev' } },
        createdAt: '2026-07-17T00:00:00.000Z',
        updatedAt: '2026-07-17T00:00:00.000Z'
      },
      {
        id: 'c',
        label: 'C',
        enabled: true,
        control: { source: 'gamepad', gamepadId: 'wheel', gamepadIndex: 1, buttonIndex: 1, switchType: 'momentary' },
        action: { type: 'app', command: { name: 'overlays:toggle', overlayId: 'relative' } },
        createdAt: '2026-07-17T00:00:00.000Z',
        updatedAt: '2026-07-17T00:00:00.000Z'
      }
    ]
    const report = analyzeContextDebt(baseInput({
      bindings,
      devices: {
        gamepadIds: ['wheel'],
        audioOutputIds: [],
        serialDeviceIds: [],
        displayIds: [],
        scanStatus: { gamepad: 'success', audio: 'success', serial: 'success', display: 'success' }
      }
    }))

    expect(report.counts.controlConflicts).toBe(1)
    const conflict = report.issues.find((issue) => issue.kind === 'control-conflict')
    expect(conflict?.details.control).toContain('index:0')
    expect(conflict?.details.control).not.toContain('switch')
    expect(report.suggestions).toContainEqual(expect.objectContaining({
      kind: 'resolve-control',
      routeIds: []
    }))
  })

  it('splits audio simplification plans by their owning screen', () => {
    const report = analyzeContextDebt(baseInput({
      sounds: {
        ...DEFAULT_SOUNDS_CONFIG,
        soundshift: { ...DEFAULT_SOUNDS_CONFIG.soundshift, enabled: true }
      },
      engineer: { ...DEFAULT_ENGINEER_CONFIG, enabled: true, proactiveCoaching: true },
      coach: { ...DEFAULT_COACH_CONFIG, enabled: true, speakTopTip: true },
      thresholds: { maxAudioRoutes: 0 }
    }))
    const plans = report.suggestions.filter((suggestion) => suggestion.kind === 'trim-audio')

    expect(plans.map((plan) => plan.navigateTo).sort()).toEqual(['coach', 'engineer', 'sounds'])
    for (const plan of plans) {
      const owners = new Set(
        plan.routeIds.map((id) => report.routes.find((route) => route.id === id)?.navigateTo)
      )
      expect(owners).toEqual(new Set([plan.navigateTo]))
    }
  })

  it('enforces the modality cap even when the per-cue route cap is higher', () => {
    const overlays = createDefaultOverlaysConfig()
    overlays.widgets.revlights = { ...overlays.widgets.revlights, enabled: true }
    const effects = Object.fromEntries(
      Object.entries(DEFAULT_HAPTICS_CONFIG.effects).map(([id, effect]) => [
        id,
        { ...effect, enabled: id === 'gearShift', intensity: 1 }
      ])
    ) as typeof DEFAULT_HAPTICS_CONFIG.effects
    const report = analyzeContextDebt(baseInput({
      overlays,
      sounds: {
        ...DEFAULT_SOUNDS_CONFIG,
        soundshift: { ...DEFAULT_SOUNDS_CONFIG.soundshift, enabled: true }
      },
      haptics: {
        ...DEFAULT_HAPTICS_CONFIG,
        enabled: true,
        muted: false,
        masterGain: 1,
        effects
      },
      thresholds: {
        maxRoutesPerCue: 4,
        maxModalitiesPerCue: 2,
        maxOverlays: 30,
        maxAudioRoutes: 60,
        maxHapticRoutes: 30,
        maxTotalRoutes: 120
      }
    }))
    const trimIds = report.suggestions
      .filter((suggestion) => suggestion.kind === 'trim-cue' && suggestion.signalId === 'shift')
      .map((suggestion) => suggestion.id)
    const preview = previewContextDebtSuggestions(report, trimIds)
    const remainingModalities = new Set(
      report.routes
        .filter((route) => route.signalId === 'shift')
        .filter((route) => !preview.removedRoutes.some((removed) => removed.id === route.id))
        .map((route) => route.modality)
    )

    expect(trimIds.length).toBeGreaterThan(0)
    expect(remainingModalities.size).toBeLessThanOrEqual(2)
  })

  it('recomputes later suggestion passes from routes already planned for removal', () => {
    const alerts = disabledAlerts()
    alerts.audioEnabled = true
    alerts.shiftPoint = { ...alerts.shiftPoint, enabled: true }
    const report = analyzeContextDebt(baseInput({
      alerts,
      sounds: {
        ...DEFAULT_SOUNDS_CONFIG,
        soundshift: { ...DEFAULT_SOUNDS_CONFIG.soundshift, enabled: true }
      },
      thresholds: {
        maxRoutesPerCue: 2,
        maxModalitiesPerCue: 2,
        maxAudioRoutes: 1
      }
    }))
    const plannedIds = report.suggestions.flatMap((suggestion) => suggestion.routeIds)
    const plannedAudioIds = plannedIds.filter((id) =>
      report.routes.find((route) => route.id === id)?.modality === 'audio'
    )
    const preview = previewContextDebtSuggestions(
      report,
      report.suggestions.map((suggestion) => suggestion.id)
    )

    expect(new Set(plannedAudioIds).size).toBe(1)
    expect(preview.afterRouteCount).toBe(report.routes.length - 1)
    expect(report.routes.filter((route) =>
      route.modality === 'audio' &&
      !preview.removedRoutes.some((removed) => removed.id === route.id)
    )).toHaveLength(1)
  })

  it('fingerprints route priorities and complete suggestion contents', () => {
    const callouts = Object.fromEntries(
      Object.entries(DEFAULT_SPOTTER_CONFIG.callouts).map(([id, config]) => [
        id,
        { ...config, enabled: id === 'lap.delta', priority: id === 'lap.delta' ? 2 : config.priority }
      ])
    ) as typeof DEFAULT_SPOTTER_CONFIG.callouts
    const first = analyzeContextDebt(baseInput({
      spotter: { ...DEFAULT_SPOTTER_CONFIG, enabled: true, muted: false, callouts },
      thresholds: { maxAudioRoutes: 0 }
    }))
    const second = analyzeContextDebt(baseInput({
      spotter: {
        ...DEFAULT_SPOTTER_CONFIG,
        enabled: true,
        muted: false,
        callouts: {
          ...callouts,
          'lap.delta': { ...callouts['lap.delta'], priority: 3 }
        }
      },
      thresholds: { maxAudioRoutes: 0 }
    }))
    expect(second.fingerprint).not.toBe(first.fingerprint)

    const changedSuggestion = first.suggestions.map((suggestion, index) => (
      index === 0
        ? { ...suggestion, details: { ...suggestion.details, auditRevision: 2 } }
        : suggestion
    ))
    expect(fingerprintContextDebtDecisionState({
      profileKey: first.profile.key,
      thresholds: first.thresholds,
      routes: first.routes,
      suggestions: changedSuggestion,
      missingSources: first.missingSources,
      incompleteScans: first.incompleteScans
    })).not.toBe(first.fingerprint)
  })
})
