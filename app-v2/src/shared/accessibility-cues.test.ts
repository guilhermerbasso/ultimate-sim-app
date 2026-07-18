import { describe, expect, it } from 'vitest'
import type { AlertEvent } from './alerts'
import {
  CUE_MANIFESTS,
  DEAF_HOH_CUE_PROFILE,
  DEFAULT_ACCESSIBILITY_CUE_STORE,
  LOW_VISION_BLIND_CUE_PROFILE,
  STANDARD_CUE_PROFILE,
  activateCueProfile,
  analyzeCueProfile,
  cloneCueProfile,
  effectiveCueModalities,
  getActiveCueProfile,
  hardwareOutputsForCueRoute,
  independentCueChannels,
  parseAccessibilityCueStore,
  routeSemanticCue,
  semanticCueEventFromAlert,
  serializeAccessibilityCueStore,
  upsertCueProfile,
  type CueCapabilities,
  type CueProfile,
  type CueSource,
  type SemanticCueEvent
} from './accessibility-cues'

const allAvailable: CueCapabilities = {
  caption: true,
  audio: true,
  symbol: true,
  led: true,
  haptic: true
}

function event(
  id = 'alert.lowFuel',
  source: CueSource = 'live',
  patch: Partial<SemanticCueEvent> = {}
): SemanticCueEvent {
  return {
    instanceId: `${source}-${id}-1`,
    id,
    messageKey: `accessibilityCues.live.${id}`,
    severity: id === 'alert.lowFuel' ? 'critical' : 'warning',
    timestamp: 1000,
    source,
    position: 'center',
    ...patch
  }
}

describe('truthful and reduced-motion-safe manifests', () => {
  it('teaches only the actual steady SIM-X lamp capability', () => {
    for (const cue of CUE_MANIFESTS) {
      expect(cue.led).toMatchObject({
        pattern: 'steady',
        color: 'device-default',
        patternLabelKey: 'accessibilityCues.pattern.led.steadyActual'
      })
      expect(cue.symbol.token.length).toBeGreaterThan(1)
    }
  })

  it('replaces rapid haptic patterns for the reduced-motion Deaf/HoH default', () => {
    const route = routeSemanticCue(
      event('alert.flag'),
      DEAF_HOH_CUE_PROFILE,
      allAvailable
    )
    const led = route.outputs.find((output) => output.modality === 'led')
    const haptic = route.outputs.find((output) => output.modality === 'haptic')

    expect(led?.pattern).toBe('steady')
    expect(haptic?.pattern).toBe('long')
    expect(route.issues).toContainEqual(
      expect.objectContaining({
        code: 'reduced-motion-pattern-substituted',
        modality: 'haptic'
      })
    )
  })
})

describe('manifest defaults and independent redundancy', () => {
  it('includes manifest defaults when a profile policy inherits', () => {
    expect(effectiveCueModalities(STANDARD_CUE_PROFILE, 'alert.lowFuel')).toMatchObject({
      caption: true,
      audio: true,
      symbol: true,
      led: false,
      haptic: false
    })
    expect(effectiveCueModalities(STANDARD_CUE_PROFILE, 'alert.flag').audio).toBe(false)
  })

  it('allows profile on/off policies and per-event overrides to supersede manifests', () => {
    const profile: CueProfile = {
      ...cloneCueProfile(STANDARD_CUE_PROFILE),
      modalities: {
        ...STANDARD_CUE_PROFILE.modalities,
        led: 'on',
        caption: 'off'
      },
      overrides: {
        'alert.flag': { modalities: { led: false, caption: true } }
      }
    }
    expect(effectiveCueModalities(profile, 'alert.lowFuel').caption).toBe(false)
    expect(effectiveCueModalities(profile, 'alert.lowFuel').led).toBe(true)
    expect(effectiveCueModalities(profile, 'alert.flag').caption).toBe(true)
    expect(effectiveCueModalities(profile, 'alert.flag').led).toBe(false)
  })

  it('counts caption and symbol in one window as one visual channel', () => {
    const route = routeSemanticCue(
      event(),
      {
        ...cloneCueProfile(STANDARD_CUE_PROFILE),
        modalities: {
          caption: 'on',
          audio: 'off',
          symbol: 'on',
          led: 'off',
          haptic: 'off'
        }
      },
      allAvailable
    )
    expect(route.outputs.map((output) => output.modality)).toEqual([
      'caption',
      'symbol'
    ])
    expect(independentCueChannels(route.outputs)).toEqual(new Set(['visual']))
    expect(route.issues).toContainEqual(
      expect.objectContaining({ code: 'critical-redundancy-unavailable' })
    )
  })

  it('preserves critical meaning without overriding an explicit caption-off policy', () => {
    const route = routeSemanticCue(
      event(),
      {
        ...cloneCueProfile(LOW_VISION_BLIND_CUE_PROFILE),
        modalities: {
          ...LOW_VISION_BLIND_CUE_PROFILE.modalities,
          caption: 'off'
        }
      },
      allAvailable
    )
    expect(route.outputs.some((output) => output.modality === 'caption')).toBe(false)
    expect(independentCueChannels(route.outputs).size).toBeGreaterThanOrEqual(2)
  })
})

describe('boundaries, hardware availability, and semantic payloads', () => {
  it('keeps preview hardware simulated and identical to the supported live pattern', () => {
    const preview = routeSemanticCue(
      event('alert.flag', 'preview'),
      DEAF_HOH_CUE_PROFILE,
      allAvailable
    )
    const live = routeSemanticCue(
      event('alert.flag', 'live'),
      DEAF_HOH_CUE_PROFILE,
      allAvailable
    )
    const previewLed = preview.outputs.find((output) => output.modality === 'led')
    const liveLed = live.outputs.find((output) => output.modality === 'led')

    expect(hardwareOutputsForCueRoute(preview)).toEqual([])
    expect(previewLed?.delivery).toBe('simulated')
    expect(previewLed?.pattern).toBe(liveLed?.pattern)
    expect(previewLed?.color).toBe(liveLed?.color)
    expect(previewLed?.hardwareTextToken).toBe(liveLed?.hardwareTextToken)
  })

  it('blocks hardware at replay boundaries and when devices are disabled', () => {
    const replay = routeSemanticCue(
      event('alert.flag', 'replay'),
      DEAF_HOH_CUE_PROFILE,
      allAvailable
    )
    const disabled = routeSemanticCue(
      event(),
      DEAF_HOH_CUE_PROFILE,
      { ...allAvailable, led: false, haptic: false }
    )

    expect(hardwareOutputsForCueRoute(replay)).toEqual([])
    expect(replay.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'replay-hardware-blocked', modality: 'led' }),
        expect.objectContaining({ code: 'replay-hardware-blocked', modality: 'haptic' })
      ])
    )
    expect(hardwareOutputsForCueRoute(disabled)).toEqual([])
    expect(disabled.issues).toContainEqual(
      expect.objectContaining({ code: 'critical-redundancy-unavailable' })
    )
  })

  it('routes semantic keys/context and never copies mixed detector prose', () => {
    const alert: AlertEvent = {
      id: 'alert-instance',
      type: 'tyrePressure',
      message: 'Pressure baixa on dianteiro esquerdo: 21.7 PSI',
      severity: 'warning',
      timestamp: 42,
      context: {
        corner: 'lf',
        direction: 'low',
        value: 149.6,
        threshold: 150,
        unit: 'kPa'
      }
    }
    const semantic = semanticCueEventFromAlert(alert)
    const route = routeSemanticCue(
      semantic,
      LOW_VISION_BLIND_CUE_PROFILE,
      allAvailable
    )

    expect(semantic.messageKey).toBe(
      'accessibilityCues.live.alert.tyrePressure.low'
    )
    expect(semantic).not.toHaveProperty('message')
    expect(JSON.stringify(route)).not.toContain('Pressure baixa')
    expect(route.context).toMatchObject({
      corner: 'lf',
      direction: 'low',
      value: 149.6
    })
  })

  it('blocks unknown semantic events fail closed', () => {
    const route = routeSemanticCue(
      event('alert.futureUnknown'),
      STANDARD_CUE_PROFILE,
      allAvailable
    )
    expect(route.status).toBe('blocked')
    expect(route.outputs).toEqual([])
    expect(route.issues).toContainEqual(
      expect.objectContaining({ code: 'unknown-event' })
    )
  })
})

describe('versioned profile persistence and migration', () => {
  it('round-trips revisions, active profile, and overrides', () => {
    const customized = upsertCueProfile(
      DEFAULT_ACCESSIBILITY_CUE_STORE,
      {
        ...DEAF_HOH_CUE_PROFILE,
        textScale: 1.6,
        overrides: {
          'alert.flag': {
            modalities: { audio: true, haptic: false }
          }
        }
      },
      1234
    )
    const active = activateCueProfile(customized, 'deaf-hoh', 1235)
    const serialized = serializeAccessibilityCueStore(active)
    const restored = parseAccessibilityCueStore(serialized)

    expect(restored.version).toBe(2)
    expect(restored.revision).toBe(2)
    expect(restored.activeProfileId).toBe('deaf-hoh')
    expect(getActiveCueProfile(restored)).toMatchObject({
      textScale: 1.6,
      overrides: {
        'alert.flag': {
          modalities: { audio: true, haptic: false }
        }
      }
    })
    expect(serializeAccessibilityCueStore(restored)).toBe(serialized)
  })

  it('migrates v1 boolean modality settings to explicit v2 policies', () => {
    const restored = parseAccessibilityCueStore(
      JSON.stringify({
        version: 1,
        activeProfileId: 'standard',
        profiles: [
          {
            ...STANDARD_CUE_PROFILE,
            version: 1,
            modalities: {
              caption: false,
              audio: true,
              symbol: true,
              led: false,
              haptic: false
            }
          }
        ]
      })
    )
    expect(getActiveCueProfile(restored).modalities).toEqual({
      caption: 'off',
      audio: 'on',
      symbol: 'on',
      led: 'off',
      haptic: 'off'
    })
  })

  it('reports unknown overrides and independent-channel conflicts', () => {
    const profile: CueProfile = {
      ...cloneCueProfile(STANDARD_CUE_PROFILE),
      modalities: {
        caption: 'on',
        audio: 'off',
        symbol: 'on',
        led: 'off',
        haptic: 'off'
      },
      overrides: {
        'alert.unknown': { modalities: { caption: true } }
      }
    }
    expect(analyzeCueProfile(profile).map((conflict) => conflict.code)).toEqual(
      expect.arrayContaining([
        'unknown-override-event',
        'critical-insufficient-independent-redundancy'
      ])
    )
  })
})
