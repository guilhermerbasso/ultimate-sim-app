import { describe, expect, it } from 'vitest'
import type { ActionBinding } from './actions'
import { DEFAULT_ALERTS_CONFIG, type AlertsConfig } from './alerts'
import { DEFAULT_COACH_CONFIG } from './coach'
import {
  analyzeContextDebt,
  previewContextDebtSuggestions,
  reconcileContextDebtPreviewSelection,
  selectContextDebtProfileSnapshot,
  type ContextDebtAnalysisInput,
  type ContextDebtReport,
  type ContextDebtSourceFamily
} from './context-debt'
import { DEFAULT_ENGINEER_CONFIG } from './engineer-ipc'
import { DEFAULT_HAPTICS_CONFIG } from './haptics'
import { DEFAULT_HAPTICS_ZONAL_CONFIG } from './haptics-zonal'
import { createDefaultOverlaysConfig } from './overlays'
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
      scanned: { audio: true, serial: true, display: true, gamepad: true }
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
    alerts.pitLimiter = {
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
      { alerts: liveAlerts, bindings: liveBindings, haptics: liveHaptics },
      profile
    )

    expect(selected.alerts).toBe(profileAlerts)
    expect(selected.bindings).toStrictEqual(profileBindings)
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

  it('labels the meter incomplete when any configured evidence source is unavailable', () => {
    const report = analyzeContextDebt(baseInput({
      sourceAvailability: { ...ALL_SOURCES, overlays: false }
    }))
    expect(report.band).toBe('incomplete')
    expect(report.missingSources).toEqual(['overlays'])
  })

  it('finds conflicting controls while keeping exact duplicate actions separate', () => {
    const bindings: ActionBinding[] = [
      {
        id: 'a',
        label: 'A',
        enabled: true,
        control: { source: 'gamepad', gamepadId: 'wheel', buttonIndex: 1 },
        action: { type: 'app', command: { name: 'dash:cycleNext' } },
        createdAt: '2026-07-17T00:00:00.000Z',
        updatedAt: '2026-07-17T00:00:00.000Z'
      },
      {
        id: 'b',
        label: 'B',
        enabled: true,
        control: { source: 'gamepad', gamepadId: 'wheel', buttonIndex: 1 },
        action: { type: 'app', command: { name: 'dash:cyclePrev' } },
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
        scanned: { gamepad: true, audio: true, serial: true, display: true }
      }
    }))

    expect(report.counts.controlConflicts).toBe(1)
    expect(report.suggestions).toContainEqual(expect.objectContaining({
      kind: 'resolve-control',
      routeIds: []
    }))
  })
})
