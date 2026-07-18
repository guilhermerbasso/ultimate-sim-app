import { describe, expect, it } from 'vitest'
import {
  appendVisualCue,
  visualCueAccessibility,
  visualCueEntry
} from './AccessibilityCueLayer'
import type {
  CueModality,
  CueRoute,
  RoutedCueOutput
} from '../../../shared/accessibility-cues'

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
  timestamp = 1
): CueRoute {
  return {
    status: 'routed',
    instanceId: id,
    eventId: 'alert.flag',
    source: 'live',
    severity,
    timestamp,
    messageKey: 'accessibilityCues.live.alert.flag.yellow',
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
      route('critical', 'critical', ['caption', 'symbol'], true, 1),
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
})
