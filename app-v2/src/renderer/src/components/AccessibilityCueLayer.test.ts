import { describe, expect, it } from 'vitest'
import {
  MAX_VISUAL_CUE_ENTRIES,
  appendVisualCue,
  isCueRouteCurrent,
  reconcileVisualCuesForProfile,
  relocalizeVisualCues,
  visualCueAccessibility,
  visualCueEntry
} from './AccessibilityCueLayer'
import {
  STANDARD_CUE_PROFILE,
  cloneCueProfile,
  type CueModality,
  type CueProfile,
  type CueRoute,
  type RoutedCueOutput
} from '../../../shared/accessibility-cues'
import type {
  AlertEventContext
} from '../../../shared/alerts'

function output(modality: CueModality): RoutedCueOutput {
  return {
    modality,
    sensoryChannel:
      modality === 'audio'
        ? 'auditory'
        : modality === 'haptic'
          ? 'tactile'
          : 'visual',
    semanticId: 'alert.flag',
    messageKey: 'accessibilityCues.live.alert.flag.yellow',
    delivery:
      modality === 'led' || modality === 'haptic' ? 'hardware' : 'renderer',
    ...(modality === 'symbol'
      ? {
          symbol: 'FLAG',
          symbolLabelKey: 'accessibilityCues.symbol.alert.flag'
        }
      : {})
  }
}

function route(
  id: string,
  severity: CueRoute['severity'],
  modalities: CueModality[],
  persistentCaptions = false,
  timestamp = 1,
  eventId = 'alert.flag',
  messageKey = 'accessibilityCues.live.alert.flag.yellow',
  context?: AlertEventContext
): CueRoute {
  return {
    status: 'routed',
    instanceId: id,
    eventId,
    source: 'live',
    severity,
    timestamp,
    messageKey,
    context,
    outputs: modalities.map(output),
    issues: [],
    conflicts: [],
    presentation: {
      profileId: 'standard',
      profileKind: 'standard',
      textScale: 1,
      highContrast: false,
      persistentCaptions,
      captionDurationMs: 5000,
      reducedMotion: false
    }
  }
}

describe('AccessibilityCueLayer per-modality visual arbitration', () => {
  it('keeps a later flag visible beside a persistent critical caption', () => {
    const critical = visualCueEntry(
      route(
        'critical',
        'critical',
        ['caption', 'symbol'],
        true,
        1,
        'alert.lowFuel',
        'accessibilityCues.live.alert.lowFuel'
      ),
      'Critical fuel',
      'Low fuel symbol'
    )
    const flag = visualCueEntry(
      route('flag', 'warning', ['caption', 'symbol'], false, 2),
      'Yellow flag',
      'Race flag symbol'
    )
    expect(critical).not.toBeNull()
    expect(flag).not.toBeNull()

    const entries = appendVisualCue(
      appendVisualCue([], critical!),
      flag!
    )
    expect(entries.map((entry) => entry.id)).toEqual(['critical', 'flag'])
  })

  it('keeps symbol-only cues semantic without creating a caption', () => {
    const entry = visualCueEntry(
      route('symbol-only', 'warning', ['symbol']),
      'This must not render as caption text',
      'Race flag symbol'
    )
    expect(entry).toMatchObject({
      hasCaption: false,
      symbol: 'FLAG',
      symbolLabel: 'Race flag symbol'
    })
    expect(visualCueAccessibility(entry!)).toEqual({
      role: 'group',
      announceCaption: false
    })
  })

  it('does not drop duplicate-severity later cues', () => {
    const first = visualCueEntry(
      route('first', 'warning', ['caption'], false, 1),
      'First',
      undefined
    )!
    const second = visualCueEntry(
      route('second', 'warning', ['caption'], false, 2),
      'Second',
      undefined
    )!
    expect(
      appendVisualCue(appendVisualCue([], first), second).map((entry) => entry.id)
    ).toEqual(['first', 'second'])
  })

  it('replaces persistent captions by a stable semantic key', () => {
    const first = visualCueEntry(
      route('instance-1', 'warning', ['caption'], true, 1),
      'Yellow flag at 1',
      undefined
    )!
    const second = visualCueEntry(
      route('instance-2', 'warning', ['caption'], true, 2),
      'Yellow flag at 2',
      undefined
    )!

    const entries = appendVisualCue(appendVisualCue([], first), second)

    expect(first.renderKey).toBe(second.renderKey)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      id: 'instance-2',
      message: 'Yellow flag at 2',
      persistentCaption: true
    })
  })

  it('bounds visual cue history while retaining the newest equal-severity entries', () => {
    let entries = [] as ReturnType<typeof appendVisualCue>
    for (let index = 0; index < MAX_VISUAL_CUE_ENTRIES + 3; index += 1) {
      const entry = visualCueEntry(
        route(`cue-${index}`, 'warning', ['caption'], false, index),
        `Cue ${index}`,
        undefined
      )!
      entries = appendVisualCue(entries, entry)
    }

    expect(entries).toHaveLength(MAX_VISUAL_CUE_ENTRIES)
    expect(entries.map((entry) => entry.id)).toEqual(
      Array.from(
        { length: MAX_VISUAL_CUE_ENTRIES },
        (_, index) => `cue-${index + 3}`
      )
    )
  })

  it('does not evict a critical cue during a bounded warning burst', () => {
    const critical = visualCueEntry(
      route(
        'critical',
        'critical',
        ['caption'],
        true,
        1,
        'alert.lowFuel',
        'accessibilityCues.live.alert.lowFuel'
      ),
      'Critical fuel',
      undefined
    )!
    let entries = appendVisualCue([], critical)
    for (let index = 0; index < MAX_VISUAL_CUE_ENTRIES + 4; index += 1) {
      entries = appendVisualCue(
        entries,
        visualCueEntry(
          route(`warning-${index}`, 'warning', ['caption'], false, index + 2),
          `Warning ${index}`,
          undefined
        )!
      )
    }

    expect(entries).toHaveLength(MAX_VISUAL_CUE_ENTRIES)
    expect(entries[0].id).toBe('critical')
  })

  it('removes persistent captions when the active profile disables captions', () => {
    const entry = visualCueEntry(
      route('persistent', 'warning', ['caption', 'symbol'], true),
      'Yellow flag',
      'Race flag symbol'
    )!
    const profile: CueProfile = {
      ...cloneCueProfile(STANDARD_CUE_PROFILE),
      persistentCaptions: false,
      modalities: {
        ...STANDARD_CUE_PROFILE.modalities,
        caption: 'off'
      }
    }

    expect(reconcileVisualCuesForProfile([entry], profile)).toEqual([])
  })

  it('rejects queued routes from an older profile generation', () => {
    const stale = route('stale', 'warning', ['caption'])
    stale.presentation.profileRevision = 4

    expect(isCueRouteCurrent(stale, 'standard', 5)).toBe(false)
    expect(isCueRouteCurrent(stale, 'standard', 4)).toBe(true)
    expect(isCueRouteCurrent(stale, 'deaf-hoh', 4)).toBe(false)
  })

  it('relocalizes active persistent captions when language and units change', () => {
    const entry = visualCueEntry(
      route(
        'pressure',
        'warning',
        ['caption', 'symbol'],
        true,
        1,
        'alert.tyrePressure',
        'accessibilityCues.live.alert.tyrePressure.low',
        {
          corner: 'lf',
          direction: 'low',
          value: 149.6,
          unit: 'kPa'
        }
      ),
      'Low tyre pressure at front left: 150 kPa.',
      'Tyre pressure symbol'
    )!

    const [localized] = relocalizeVisualCues(
      [entry],
      'pt-BR',
      'imperial'
    )

    expect(localized.message).toContain('dianteiro esquerdo')
    expect(localized.message.toLowerCase()).toContain('psi')
    expect(localized.message).not.toBe(entry.message)
  })
})
