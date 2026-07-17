import { describe, expect, it } from 'vitest'
import {
  CUE_MANIFESTS,
  DEAF_HOH_CUE_PROFILE,
  DEFAULT_ACCESSIBILITY_CUE_STORE,
  LOW_VISION_BLIND_CUE_PROFILE,
  STANDARD_CUE_PROFILE,
  activateCueProfile,
  analyzeCueProfile,
  cloneCueProfile,
  getActiveCueProfile,
  hardwareOutputsForCueRoute,
  parseAccessibilityCueStore,
  routeSemanticCue,
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
    id,
    message: 'Existing alert meaning',
    severity: id === 'alert.lowFuel' ? 'critical' : 'warning',
    timestamp: 1000,
    source,
    position: 'center',
    ...patch
  }
}

describe('semantic accessibility cue manifests', () => {
  it('keeps every manifest unique and color-independent', () => {
    expect(new Set(CUE_MANIFESTS.map((cue) => cue.eventId)).size).toBe(
      CUE_MANIFESTS.length
    )
    for (const cue of CUE_MANIFESTS) {
      expect(cue.symbol.token.length).toBeGreaterThan(1)
      expect(cue.symbol.label.length).toBeGreaterThan(0)
      expect(cue.led.patternLabel.length).toBeGreaterThan(0)
      expect(cue.led.pattern).not.toBe(cue.led.color)
    }
  })

  it('preserves modality parity through one semantic id and message', () => {
    const route = routeSemanticCue(
      event('alert.flag'),
      {
        ...STANDARD_CUE_PROFILE,
        modalities: {
          caption: true,
          audio: true,
          symbol: true,
          led: true,
          haptic: true
        }
      },
      allAvailable
    )

    expect(route.outputs).toHaveLength(5)
    expect(new Set(route.outputs.map((output) => output.semanticId))).toEqual(
      new Set(['alert.flag'])
    )
    expect(new Set(route.outputs.map((output) => output.message))).toEqual(
      new Set(['Existing alert meaning'])
    )
    expect(route.outputs.every((output) => output.accessibleLabel.includes(route.message))).toBe(
      true
    )
  })
})

describe('accessibility profiles and routing', () => {
  it('applies low-vision/blind scaling, contrast, spatial audio, and haptic redundancy', () => {
    const route = routeSemanticCue(
      event('alert.tyrePressure', 'live', {
        severity: 'warning',
        position: 'left'
      }),
      LOW_VISION_BLIND_CUE_PROFILE,
      allAvailable
    )

    expect(route.presentation).toMatchObject({
      profileKind: 'low-vision-blind',
      highContrast: true,
      textScale: 1.45,
      reducedMotion: true
    })
    expect(route.outputs.map((output) => output.modality)).toEqual([
      'caption',
      'audio',
      'symbol',
      'haptic'
    ])
    expect(
      route.outputs.find((output) => output.modality === 'audio')?.spatialPan
    ).toBeLessThan(0)
  })

  it('applies Deaf/HoH persistent captions and visual-haptic redundancy without audio', () => {
    const route = routeSemanticCue(
      event('alert.flag'),
      DEAF_HOH_CUE_PROFILE,
      allAvailable
    )
    expect(route.presentation.persistentCaptions).toBe(true)
    expect(route.outputs.map((output) => output.modality)).toEqual([
      'caption',
      'symbol',
      'led',
      'haptic'
    ])
    expect(route.outputs.some((output) => output.modality === 'audio')).toBe(false)
  })

  it('preserves a critical cue when an override disables every modality', () => {
    const profile: CueProfile = {
      ...cloneCueProfile(STANDARD_CUE_PROFILE),
      modalities: {
        caption: false,
        audio: false,
        symbol: false,
        led: false,
        haptic: false
      },
      overrides: {
        'alert.lowFuel': {
          modalities: {
            caption: false,
            audio: false,
            symbol: false,
            led: false,
            haptic: false
          }
        }
      }
    }
    const route = routeSemanticCue(event(), profile, {
      ...allAvailable,
      led: false,
      haptic: false
    })

    expect(route.outputs).toHaveLength(2)
    expect(route.outputs.map((output) => output.modality)).toEqual([
      'caption',
      'symbol'
    ])
    expect(
      route.issues.filter((issue) => issue.code === 'critical-modality-preserved')
    ).toHaveLength(2)
  })

  it('fails closed for disabled hardware and preserves critical visual meaning', () => {
    const route = routeSemanticCue(event(), DEAF_HOH_CUE_PROFILE, {
      ...allAvailable,
      led: false,
      haptic: false
    })

    expect(hardwareOutputsForCueRoute(route)).toEqual([])
    expect(route.outputs.map((output) => output.modality)).toEqual([
      'caption',
      'symbol'
    ])
    expect(
      route.issues.filter((issue) => issue.code === 'modality-unavailable').map(
        (issue) => issue.modality
      )
    ).toEqual(expect.arrayContaining(['led', 'haptic']))
  })

  it('keeps preview hardware isolated while still teaching configured patterns', () => {
    const route = routeSemanticCue(
      event('alert.flag', 'preview'),
      DEAF_HOH_CUE_PROFILE,
      allAvailable
    )

    expect(hardwareOutputsForCueRoute(route)).toEqual([])
    expect(
      route.outputs
        .filter((output) => output.modality === 'led' || output.modality === 'haptic')
        .every((output) => output.delivery === 'simulated')
    ).toBe(true)
    expect(
      route.issues.filter((issue) => issue.code === 'preview-hardware-simulated')
    ).toHaveLength(2)
  })

  it('blocks LED and haptic side effects at the replay boundary but allows them live', () => {
    const live = routeSemanticCue(
      event('alert.flag', 'live'),
      DEAF_HOH_CUE_PROFILE,
      allAvailable
    )
    const replay = routeSemanticCue(
      event('alert.flag', 'replay'),
      DEAF_HOH_CUE_PROFILE,
      allAvailable
    )

    expect(hardwareOutputsForCueRoute(live).map((output) => output.modality)).toEqual([
      'led',
      'haptic'
    ])
    expect(hardwareOutputsForCueRoute(replay)).toEqual([])
    expect(replay.outputs.map((output) => output.modality)).toEqual([
      'caption',
      'symbol'
    ])
    expect(
      replay.issues.filter((issue) => issue.code === 'replay-hardware-blocked')
    ).toHaveLength(2)
  })

  it('routes LED meaning with a pattern and OLED text rather than color alone', () => {
    const route = routeSemanticCue(
      event('alert.flag'),
      DEAF_HOH_CUE_PROFILE,
      allAvailable
    )
    const led = route.outputs.find((output) => output.modality === 'led')
    const symbol = route.outputs.find((output) => output.modality === 'symbol')

    expect(led).toMatchObject({
      pattern: 'double-pulse',
      patternLabel: 'Two distinct pulses',
      oledText: 'Existing alert meaning'
    })
    expect(symbol?.symbol).toBe('FLAG')
  })

  it('blocks unknown events without any output', () => {
    const route = routeSemanticCue(
      event('alert.futureUnknown'),
      STANDARD_CUE_PROFILE,
      allAvailable
    )
    expect(route.status).toBe('blocked')
    expect(route.outputs).toEqual([])
    expect(route.issues).toEqual([
      expect.objectContaining({ code: 'unknown-event' })
    ])
  })
})

describe('per-user profile persistence and conflicts', () => {
  it('round-trips active profiles and event overrides deterministically', () => {
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

  it('reports unknown overrides and critical under-specification', () => {
    const profile: CueProfile = {
      ...cloneCueProfile(STANDARD_CUE_PROFILE),
      modalities: {
        caption: false,
        audio: false,
        symbol: false,
        led: true,
        haptic: false
      },
      overrides: {
        'alert.unknown': { modalities: { caption: true } }
      }
    }
    const conflicts = analyzeCueProfile(profile)
    expect(conflicts.map((conflict) => conflict.code)).toEqual(
      expect.arrayContaining([
        'unknown-override-event',
        'critical-insufficient-redundancy',
        'critical-hardware-only'
      ])
    )
  })
})
